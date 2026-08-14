"""The pluggable 'brain'. The loop is brain-agnostic; only this file knows about a provider.

  RealBrain  -> claude-opus-4-8 via anthropic-sdk-python. The model under test as "Avery".
  MockBrain  -> deterministic, no network. Follows a per-case scripted plan so the whole
                pipeline runs green AFK with no API key (011a/b/c all require "green on mock").

A Brain takes (system, conversation, tools) and returns a BrainResponse: either tool calls to
dispatch, or a final text answer. The conversation uses neutral Anthropic-shaped blocks; each
brain translates as needed (MockBrain ignores them and walks its plan).
"""
from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass, field
from typing import Any, Protocol

from .tools import Advice

DEFAULT_MODEL = "claude-opus-4-8"
# MiniMax OpenAI-compatible endpoint (https://platform.minimaxi.com/docs/api-reference/text-openai-api)
MINIMAX_BASE_URL = "https://api.minimaxi.com/v1"
MINIMAX_MODEL = "MiniMax-M3"

# #96 — OpenAI 官方端点（欧盟/海外部署路径）。这些常量存在的理由不只是「省一次 env 配置」：
# OpenAICompatBrain 的构造默认值全是 MiniMax 的（历史原因，它是为 M3 写的），所以任何走
# OpenAI 的构造点如果把 base_url/model 传成 None，就会**静默连到 MiniMax**——欧盟实例最不能
# 出的事。brain_factory / extractor_factory 一律显式传这里的值，不许依赖类默认。
OPENAI_BASE_URL = "https://api.openai.com/v1"
OPENAI_MODEL = "gpt-5.6-terra"          # advisor 位（#96 选型表；难案子可升 gpt-5.6-sol）
OPENAI_EXTRACT_MODEL = "gpt-5.6-luna"   # 抽取位（同表；更省可换 gpt-5-nano）

_THINK_RE = re.compile(r"<think>.*?</think>", re.S)


def strip_reasoning(text: str | None) -> str:
    """MiniMax-M3 is a reasoning model: without reasoning_split it wraps its private chain-of-
    thought in <think>...</think> inside `content`. Strip it so the red-line validator scores the
    ADVICE, not the model's thinking, and so JSON answers parse cleanly."""
    if not text:
        return ""
    return _THINK_RE.sub("", text).strip()


@dataclass
class ToolCall:
    id: str
    name: str
    input: dict[str, Any]


@dataclass
class BrainResponse:
    tool_calls: list[ToolCall] = field(default_factory=list)
    text: str | None = None  # set when the brain is giving its final answer (no tool calls)

    @property
    def is_final(self) -> bool:
        return not self.tool_calls


class Brain(Protocol):
    name: str
    def respond(self, system: str, conversation: list[dict], tools: list[dict]) -> BrainResponse: ...


# --- MockBrain ---------------------------------------------------------------------------------

@dataclass
class _Step:
    tool: ToolCall | None = None  # a tool call to make
    final: str | None = None      # OR a final text answer


class MockBrain:
    """Walks a precomputed step plan. One step per respond() call."""

    def __init__(self, name: str, plan: list[_Step]):
        self.name = name
        self._plan = plan
        self._i = 0

    def respond(self, system: str, conversation: list[dict], tools: list[dict]) -> BrainResponse:
        if self._i >= len(self._plan):
            # Plan exhausted without an explicit final — emit an empty final so the loop stops.
            return BrainResponse(text="")
        step = self._plan[self._i]
        self._i += 1
        if step.final is not None:
            return BrainResponse(text=step.final)
        return BrainResponse(tool_calls=[step.tool])


def _tc(idx: int, name: str, args: dict) -> ToolCall:
    return ToolCall(id=f"mock-{name}-{idx}", name=name, input=args)


def make_mock_brain(case, persona: str) -> MockBrain:
    """Build the deterministic plan for a persona from the case's MOCK block.

    persona: 'avery' (full chain, clean) | 'baseline_raw' | 'baseline_scaffold'.
    """
    mock = case.mock or {}
    plan: list[_Step] = []
    n = 0

    if persona == "avery":
        spec = mock.get("avery", {})
        plan.append(_Step(tool=_tc(n, "read_case", {"case_id": case.case_id}))); n += 1
        for q in spec.get("recall_queries", []):
            plan.append(_Step(tool=_tc(n, "recall", {"query": q}))); n += 1
        for c in spec.get("cites", []):
            plan.append(_Step(tool=_tc(n, "cite",
                        {"claim": c["claim"], "source_ref": c["source_ref"]}))); n += 1
        # 0729/03 分流：MOCK 块给了 answer 就走短答出口（answer_direct），否则照旧 advice。
        # #72：MOCK 块带 followup_questions 时随工具入参带上；没带则入参一个键都不多
        # （既有 case fixture 的计划逐字节不变）。
        ans = spec.get("answer")
        if ans:
            text = ans.get("text", "") if isinstance(ans, dict) else str(ans)
            args: dict = {"text": text}
            fu = ans.get("followup_questions") if isinstance(ans, dict) else None
            if fu:
                args["followup_questions"] = fu
            plan.append(_Step(tool=_tc(n, "answer_direct", args))); n += 1
            plan.append(_Step(final=text))
            return MockBrain("avery(mock)", plan)
        adv = spec.get("advice", {})
        adv_args: dict = {
            "read": adv.get("read", ""), "move": adv.get("move", ""),
            "framing": adv.get("framing", "")}
        if adv.get("followup_questions"):
            adv_args["followup_questions"] = adv.get("followup_questions")
        plan.append(_Step(tool=_tc(n, "draft_advice", adv_args))); n += 1
        final = Advice(adv.get("read", ""), adv.get("move", ""), adv.get("framing", "")).render()
        plan.append(_Step(final=final))
        return MockBrain("avery(mock)", plan)

    # baselines
    spec = mock.get(persona, {})
    if spec.get("read_case", True):
        plan.append(_Step(tool=_tc(n, "read_case", {"case_id": case.case_id}))); n += 1
    for q in spec.get("recall_queries", []):
        plan.append(_Step(tool=_tc(n, "recall", {"query": q}))); n += 1
    for c in spec.get("cites", []):
        plan.append(_Step(tool=_tc(n, "cite",
                    {"claim": c["claim"], "source_ref": c["source_ref"]}))); n += 1
    plan.append(_Step(final=spec.get("advice_text", "")))
    return MockBrain(f"{persona}(mock)", plan)


# --- RealBrain (claude-opus-4-8) --------------------------------------------------------------

class RealBrain:
    """Calls claude-opus-4-8 through anthropic-sdk-python. Only imported/instantiated when a
    real run is requested; mock runs never touch the SDK or the network."""

    def __init__(self, name: str = "avery-opus", model: str = DEFAULT_MODEL,
                 max_tokens: int = 2048):
        try:
            import anthropic  # noqa: F401  (deferred import — optional dep)
        except ImportError as e:  # pragma: no cover - environment dependent
            raise RuntimeError(
                "anthropic SDK not installed. `pip install anthropic` and set ANTHROPIC_API_KEY, "
                "or run in mock mode (the default).") from e
        if not os.environ.get("ANTHROPIC_API_KEY"):  # pragma: no cover
            raise RuntimeError("ANTHROPIC_API_KEY not set; cannot run RealBrain.")
        from anthropic import Anthropic
        self._client = Anthropic()
        self.name = name
        self._model = model
        self._max_tokens = max_tokens

    def respond(self, system: str, conversation: list[dict], tools: list[dict]) -> BrainResponse:  # pragma: no cover - needs network
        resp = self._client.messages.create(
            model=self._model, max_tokens=self._max_tokens, system=system,
            messages=conversation, tools=tools)
        tool_calls, text_parts = [], []
        for block in resp.content:
            if block.type == "tool_use":
                tool_calls.append(ToolCall(id=block.id, name=block.name, input=dict(block.input)))
            elif block.type == "text":
                text_parts.append(block.text)
        text = "".join(text_parts) if text_parts else None
        if tool_calls:
            return BrainResponse(tool_calls=tool_calls, text=text)
        return BrainResponse(text=text or "")


# --- OpenAICompatBrain (MiniMax & any OpenAI-compatible provider) ------------------------------

def _to_openai_tools(tools: list[dict]) -> list[dict]:
    return [{"type": "function",
             "function": {"name": t["name"], "description": t["description"],
                          "parameters": t["input_schema"]}} for t in tools]


def _to_openai_messages(system: str, conversation: list[dict]) -> list[dict]:
    """Translate the loop's neutral (Anthropic-shaped) conversation into OpenAI chat messages."""
    msgs: list[dict] = [{"role": "system", "content": system}]
    for turn in conversation:
        content = turn["content"]
        if turn["role"] == "user":
            tool_results = [b for b in content if b.get("type") == "tool_result"]
            if tool_results:
                for b in tool_results:
                    msgs.append({"role": "tool", "tool_call_id": b["tool_use_id"],
                                 "content": str(b["content"])})
            else:
                msgs.append({"role": "user",
                             "content": "".join(b.get("text", "") for b in content
                                                 if b.get("type") == "text")})
        else:  # assistant
            text = "".join(b.get("text", "") for b in content if b.get("type") == "text")
            tool_uses = [b for b in content if b.get("type") == "tool_use"]
            m: dict = {"role": "assistant", "content": text or None}
            if tool_uses:
                m["tool_calls"] = [{"id": b["id"], "type": "function",
                                    "function": {"name": b["name"],
                                                 "arguments": json.dumps(b["input"])}}
                                   for b in tool_uses]
            msgs.append(m)
    return msgs


class OpenAICompatBrain:
    """Any OpenAI-compatible chat-completions provider with tool calling. Used for a REAL run on
    MiniMax (MiniMax-M3 supports OpenAI-style `tools`/`tool_calls`). Reads base_url/model/key from
    env (MINIMAX_*) by default so a pasted .env key just works.

    #96 — 「OpenAI 兼容」在**参数层并不真的兼容**，所以请求形状是可配的（默认值 = 境内两家今天
    的原样行为，一个字节都没变）：

      * `token_param` — OpenAI 官方的推理模型（gpt-5 系）拒收 `max_tokens`，只认
        `max_completion_tokens`；MiniMax/DeepSeek 只认前者。
      * `temperature`  — 同一批模型只接受默认温度，显式传 0 会 400。`None` = 这个参数根本不发。
      * `reasoning_effort` — OpenAI 的推理预算旋钮。`None` = 不发（兼容端点见到未知参数会报错）。

    ⚠ 构造默认值全是 MiniMax 的（这个类是为 M3 写的）：`base_url=None` / `model=None` 会落回
    MINIMAX_*。走 OpenAI 的调用点必须显式传值，见 brain.OPENAI_BASE_URL 的碑。
    """

    def __init__(self, name: str = "minimax", model: str | None = None,
                 base_url: str | None = None, api_key: str | None = None,
                 api_key_env: str = "MINIMAX_API_KEY", max_tokens: int = 8192,
                 token_param: str = "max_tokens", temperature: float | None = 0.0,
                 reasoning_effort: str | None = None):
        try:
            from openai import OpenAI
        except ImportError as e:  # pragma: no cover - optional dep
            raise RuntimeError("openai SDK not installed. `pip install openai` for a real run.") from e
        api_key = api_key or os.environ.get(api_key_env)
        if not api_key:  # pragma: no cover - needs key
            raise RuntimeError(
                f"{api_key_env} not set. Paste your provider key into eval-harness/.env, "
                f"or run in mock mode (the default).")
        self.name = name
        self._model = model or os.environ.get("MINIMAX_MODEL", MINIMAX_MODEL)
        self._client = OpenAI(base_url=base_url or os.environ.get("MINIMAX_BASE_URL", MINIMAX_BASE_URL),
                              api_key=api_key)
        self._max_tokens = max_tokens
        self._token_param = token_param
        self._temperature = temperature
        self._reasoning_effort = reasoning_effort

    def _request_kwargs(self, tools: list[dict]) -> dict:
        """The provider-shaped knobs for one chat-completions call (see the class docstring)."""
        kwargs: dict = {self._token_param: self._max_tokens}
        if self._temperature is not None:
            kwargs["temperature"] = self._temperature
        if self._reasoning_effort:
            kwargs["reasoning_effort"] = self._reasoning_effort
        # #96 · 空工具列表**整个不发**。抽取走的就是这条路（llm_extract._call_once 传 tools=[]），
        # MiniMax/DeepSeek 收下 `"tools": []` 不吭声，OpenAI 官方拿它当 400：「Invalid 'tools':
        # empty array」。语义上「空数组」和「不给」本来就是一回事，省掉它对三家都对。
        if tools:
            kwargs["tools"] = _to_openai_tools(tools)
        return kwargs

    def respond(self, system: str, conversation: list[dict], tools: list[dict]) -> BrainResponse:
        resp = self._client.chat.completions.create(
            model=self._model, messages=_to_openai_messages(system, conversation),
            **self._request_kwargs(tools))
        choice = resp.choices[0]
        msg = choice.message
        text = strip_reasoning(msg.content)  # drop <think>...</think> chain-of-thought
        calls = getattr(msg, "tool_calls", None)

        # #96 — 输出预算耗尽必须是**错误**，不是一句空答复。MiniMax 把 <think> 计进 max_tokens；
        # OpenAI 把不可见的 reasoning tokens 计进 max_completion_tokens——两边都可能「全花在思考
        # 上、一个字没吐出来」。此时返回 BrainResponse(text="") 是无声的谎：/advise 会把空串当最终
        # 答案发出去，抽取会当成「这份文档没有实体」。抛出来，让 FallbackBrain 记账、让既有降级
        # 路径（heuristic / error 事件）接手。
        if getattr(choice, "finish_reason", None) == "length" and not text and not calls:
            raise RuntimeError(
                f"{self.name}: provider hit the output ceiling "
                f"({self._token_param}={self._max_tokens}) with no content — the whole budget went "
                f"to reasoning tokens. Raise the ceiling or lower the reasoning effort.")

        if calls:
            tool_calls = [ToolCall(id=tc.id, name=tc.function.name,
                                   input=json.loads(tc.function.arguments or "{}"))
                          for tc in calls]
            return BrainResponse(tool_calls=tool_calls, text=text or None)
        return BrainResponse(text=text)
