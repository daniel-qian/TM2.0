"""Service-side driver: run the advisor engine and yield think/tool/observe events for SSE.

`avery/loop.py::run_loop` runs a scenario to completion and returns one transcript — perfect for
the batch harness, but it does not surface steps mid-flight for streaming. Rather than fork or
rewrite the loop, this driver re-uses the engine's OWN primitives to walk the same think ->
tool-call -> observe cycle and `yield` each step as it happens:

    * the pluggable brain            avery/brain.py         (RealBrain / OpenAICompatBrain / Mock)
    * the four tools + cite gate     avery/tools.py::dispatch, ToolContext, Advice
    * the red-line gate + nudges     avery/redline.py::validate

The gates are applied identically to `run_loop` (cite-before-advice enforced tool-side; a red-line
crossing is pushed back once, then re-checked). The final event carries the same transcript dict
`run_loop` would have returned, so the batch tests and the streamed path share one contract shape.

We intentionally mirror `run_loop`'s logic here (a ~40-line cycle) instead of importing internals
that were not written to stream. `test_service_contract.py` asserts this driver's terminal
transcript matches `run_loop`'s on the same case, so the mirror can't silently drift.
"""
from __future__ import annotations

from dataclasses import asdict
from pathlib import Path
from typing import Any, Iterator

from avery import redline
from avery.brain import Brain
from avery.cases import Case
from avery.loop import MAX_ITERS, _delivered, _nudge
from avery.tools import ToolContext, ToolError, cited_snippets, dispatch

from . import contract
from .history import history_conversation_turns


def _anthropic_tools() -> list[dict]:
    from avery.tools import TOOL_SCHEMAS
    return TOOL_SCHEMAS


def stream_advice(brain: Brain, case: Case, system_prompt: str, *, agent_name: str,
                  scaffold: str, memory_dir: Path, enforce_chain: bool = True,
                  enforce_redline: bool = True, max_iters: int = MAX_ITERS, embedder=None,
                  preamble: str | None = None,
                  history: list[Any] | None = None) -> Iterator[dict[str, Any]]:
    """Drive one (brain, case) and yield events. Event `type` is one of:

        started   — run metadata (agent, case_id, prompt)
        think     — the model's assistant-text between tool calls (reasoning surface)
        tool      — a tool call the model is making (name + input)
        observe   — the observation returned for a tool call
        nudge     — a gate pushed the model back (chain or red line)
        manifest  — the final 8-field contract payload + gate/redline status + full transcript
        error     — an unrecoverable problem (e.g. brain/network failure)

    The terminal `manifest` event's `transcript` matches what `run_loop` returns for the same
    inputs; its `contract` block is the API-level 8-field projection + red-line re-validation.

    #64 `preamble`: extra context pinned into the OPENING user turn (after the leader's ask).
    This is the @-references guarantee point — unlike the case body (which the model only sees
    if it calls read_case) and unlike recall (which may miss), the opening turn is in the
    model's context unconditionally. Default None keeps the turn byte-identical to run_loop's
    (test_service_contract parity rides on that default). The started event / transcript
    `prompt` stays the manager's own words — the preamble is context, not the question.

    #71 `history`: the earlier turns of THIS conversation, prepended as plain user/assistant
    message pairs BEFORE the opening turn (quota + normalization in `service/history.py`,
    which this function calls itself — see that module's docstring for why the engine does
    not trust its caller). Default None prepends nothing, so the pre-#71 request produces the
    pre-#71 conversation byte for byte.

    How the two compose, since both add context and both are optional: `history` is EARLIER
    TURNS (its own messages, before the opening one), `preamble` is THIS turn's pinned records
    (appended inside the opening turn's text). Order in the final conversation is therefore
    history…, then `opening = scenario + this question + preamble`. They never touch each
    other's bytes; with both present the model sees the conversation so far, then the current
    question with its @-referenced records attached. The reference block is built from THIS
    turn's refs only — history turns do NOT re-inject their own (they already got their
    answer; re-pinning old records would crowd out the current ones under the same quota).
    """
    ctx = ToolContext(memory_dir=Path(memory_dir), case_path=case.path, case_id=case.case_id,
                      embedder=embedder)
    opening = f"Scenario id: {case.case_id}\n\nThe leader asks:\n{case.prompt}"
    if preamble:
        opening += f"\n\n{preamble}"
    conversation: list[dict] = [
        *history_conversation_turns(history),
        {"role": "user", "content": [{"type": "text", "text": opening}]},
    ]

    steps: list[dict] = []
    nudged_chain = nudged_redline = False
    stop_reason = "max_iters"

    yield {"type": "started", "agent": agent_name, "scaffold": scaffold,
           "case_id": case.case_id, "prompt": case.prompt}

    try:
        for _ in range(max_iters):
            resp = brain.respond(system_prompt, conversation, _anthropic_tools())

            if resp.tool_calls:
                assistant_blocks: list[dict] = []
                if resp.text:
                    assistant_blocks.append({"type": "text", "text": resp.text})
                    yield {"type": "think", "text": resp.text}
                for tc in resp.tool_calls:
                    assistant_blocks.append({"type": "tool_use", "id": tc.id,
                                             "name": tc.name, "input": tc.input})
                conversation.append({"role": "assistant", "content": assistant_blocks})

                result_blocks: list[dict] = []
                for tc in resp.tool_calls:
                    yield {"type": "tool", "name": tc.name, "input": tc.input}
                    try:
                        obs, is_err = dispatch(tc.name, tc.input, ctx), False
                    except ToolError as e:
                        obs, is_err = str(e), True
                    steps.append({"type": "tool_call", "name": tc.name, "input": tc.input,
                                  "observation": obs, "is_error": is_err})
                    yield {"type": "observe", "name": tc.name, "observation": obs,
                           "is_error": is_err}
                    result_blocks.append({"type": "tool_result", "tool_use_id": tc.id,
                                          "content": obs, "is_error": is_err})
                conversation.append({"role": "user", "content": result_blocks})
                continue

            # --- a final answer arrived: run the gates (identical to run_loop) -----------------
            final_text = _delivered(ctx, resp.text)
            if resp.text and resp.text.strip():
                yield {"type": "think", "text": resp.text}

            # 0729/03 分流：两个合法终局出口——draft_advice（判断类）或 answer_direct（事实查询）。
            if enforce_chain and ctx.advice is None and ctx.answer is None and not nudged_chain:
                nudged_chain = True
                msg = ("Deliver your answer through a tool — cite() your evidence first, then "
                       "either answer_direct(text) for a plain factual lookup, or "
                       "draft_advice(read, move, framing) for anything needing judgment. "
                       "Do not answer in free text.")
                conversation.append(_nudge(msg))
                yield {"type": "nudge", "gate": "chain", "message": msg}
                continue

            rl = redline.validate(final_text, cited_snippets(ctx))
            if enforce_redline and not rl.passed and not nudged_redline:
                nudged_redline = True
                crossed = "; ".join(f"{v.rule_id} («{v.snippet}»)" for v in rl.violations)
                msg = ("You crossed the red line: " + crossed + ". Never put a number, score, "
                       "rank, or label on a person. Describe the WORK and recommend the call "
                       "instead, then re-issue draft_advice.")
                conversation.append(_nudge(msg))
                yield {"type": "nudge", "gate": "redline", "message": msg,
                       "violations": [asdict(v) for v in rl.violations]}
                ctx.advice = None
                ctx.answer = None
                # #72 · 被打回的那版建议附带的追问一并作废——重发的 draft 会重写这个槽。
                ctx.followup_questions = []
                continue

            steps.append({"type": "final", "text": final_text})
            stop_reason = "ok"
            break
    except Exception as e:  # brain/network failure — surface, don't crash the stream
        yield {"type": "error", "error": f"{type(e).__name__}: {e}"}
        return

    transcript = _finish_transcript(ctx, steps, case, agent_name, scaffold, system_prompt,
                                    stop_reason)
    # 0729/03 分流：answer_direct 终局走短答契约（红线 + 非空 + cite 闸），不过 9 字段投影；
    # draft_advice 终局照旧走 advice 投影。manifest 用 answer_kind 区分，advice/answer 互斥。
    if ctx.answer is not None and ctx.advice is None:
        result = contract.enforce_answer(transcript, cited_snippets(ctx))
        yield {
            "type": "manifest",
            "answer_kind": "answer",
            "contract_ok": result.ok,
            "contract_reason": result.reason,
            "redline_passed": result.redline_passed,
            "redline_summary": result.redline_summary,
            "schema_ok": result.schema_ok,
            "missing_fields": result.missing_fields,
            "advice": None,
            "answer": result.payload,      # {"text": ...} — 一段话直答
            "gates": transcript["gates"],
            "cites": transcript["cites"],
            "transcript": transcript,
        }
        return

    result = contract.enforce(transcript, cited_snippets(ctx))

    yield {
        "type": "manifest",
        "answer_kind": "advice",
        "contract_ok": result.ok,
        "contract_reason": result.reason,
        "redline_passed": result.redline_passed,
        "redline_summary": result.redline_summary,
        "schema_ok": result.schema_ok,
        "missing_fields": result.missing_fields,
        "advice": result.payload,          # the slim contract payload (required trio + optionals)
        "gates": transcript["gates"],
        "cites": transcript["cites"],
        "transcript": transcript,          # full native transcript (parity with run_loop)
    }


def _finish_transcript(ctx: ToolContext, steps: list[dict], case: Case, agent_name: str,
                       scaffold: str, system_prompt: str, stop_reason: str) -> dict:
    """Assemble the same transcript dict `run_loop` returns, so both paths share one shape."""
    from avery.loop import _last_final
    final_answer = _last_final(steps) or _delivered(ctx, "")
    rl = redline.validate(final_answer, cited_snippets(ctx))
    return {
        "case_id": case.case_id,
        "agent": agent_name,
        "scaffold": scaffold,
        "prompt": case.prompt,
        "system_prompt_chars": len(system_prompt),
        "steps": steps,
        "cites": [asdict(c) for c in ctx.cites],
        "used_draft_advice": ctx.advice is not None,
        "advice": asdict(ctx.advice) if ctx.advice else None,
        # 0729/03：短答终局（answer_direct）。advice/answer 互斥；batch 侧 run_loop 不产出
        # 这个键（服务端专属路径），parity 测试只比对共有键。
        "answer": ctx.answer,
        # #72 · 建议追问（两个终局出口共用；沿 `answer` 键的先例——run_loop 不产出这个键）。
        # 红线逐条过滤在 contract 投影层，这里原样带出工具收到的形状归一结果。
        "followup_questions": list(ctx.followup_questions),
        "final_text": final_answer,
        "redline": {
            "passed": rl.passed,
            "summary": rl.summary(),
            "violations": [asdict(v) for v in rl.violations],
            "secondary": [asdict(v) for v in rl.secondary],
        },
        "gates": {
            "cite_gate_passed": any(c.resolved for c in ctx.cites),
            # 0729/03：合法终局 artifact = advice 或 answer（两出口都吃过 cite 闸）
            "artifact_gate_passed": ctx.advice is not None or ctx.answer is not None,
        },
        "stop_reason": stop_reason,
    }
