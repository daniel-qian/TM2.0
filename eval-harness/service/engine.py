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


def _anthropic_tools() -> list[dict]:
    from avery.tools import TOOL_SCHEMAS
    return TOOL_SCHEMAS


def stream_advice(brain: Brain, case: Case, system_prompt: str, *, agent_name: str,
                  scaffold: str, memory_dir: Path, enforce_chain: bool = True,
                  enforce_redline: bool = True, max_iters: int = MAX_ITERS
                  ) -> Iterator[dict[str, Any]]:
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
    """
    ctx = ToolContext(memory_dir=Path(memory_dir), case_path=case.path, case_id=case.case_id)
    conversation: list[dict] = [{
        "role": "user",
        "content": [{"type": "text",
                     "text": f"Scenario id: {case.case_id}\n\nThe leader asks:\n{case.prompt}"}],
    }]

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

            if enforce_chain and ctx.advice is None and not nudged_chain:
                nudged_chain = True
                msg = ("Deliver your answer by calling draft_advice(read, move, framing) — and "
                       "cite() your evidence first. Do not answer in free text.")
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
                continue

            steps.append({"type": "final", "text": final_text})
            stop_reason = "ok"
            break
    except Exception as e:  # brain/network failure — surface, don't crash the stream
        yield {"type": "error", "error": f"{type(e).__name__}: {e}"}
        return

    transcript = _finish_transcript(ctx, steps, case, agent_name, scaffold, system_prompt,
                                    stop_reason)
    result = contract.enforce(transcript, cited_snippets(ctx))

    yield {
        "type": "manifest",
        "contract_ok": result.ok,
        "contract_reason": result.reason,
        "redline_passed": result.redline_passed,
        "redline_summary": result.redline_summary,
        "schema_ok": result.schema_ok,
        "missing_fields": result.missing_fields,
        "advice": result.payload,          # the 8-field AgentOutput contract payload
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
        "final_text": final_answer,
        "redline": {
            "passed": rl.passed,
            "summary": rl.summary(),
            "violations": [asdict(v) for v in rl.violations],
            "secondary": [asdict(v) for v in rl.secondary],
        },
        "gates": {
            "cite_gate_passed": any(c.resolved for c in ctx.cites),
            "artifact_gate_passed": ctx.advice is not None,
        },
        "stop_reason": stop_reason,
    }
