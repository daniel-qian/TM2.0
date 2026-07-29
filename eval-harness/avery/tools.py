"""The four file-based tools: read_case, recall, cite, draft_advice.

All read/write plain files or in-memory registries — no DB, fully inspectable in the transcript.
The un-skippable evidence gate lives here, tool-side: `draft_advice` REFUSES to produce the
artifact when the cite registry is empty. That is what makes "shows its evidence" a property of
the loop rather than a request in the prompt.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from . import memory


@dataclass
class Cite:
    claim: str
    source_ref: str
    snippet: str | None  # the actual line the ref resolves to (None => unresolved/invalid ref)
    resolved: bool


@dataclass
class Advice:
    read: str
    move: str
    framing: str  # safeFraming — how to open the conversation

    def render(self) -> str:
        return (f"THE READ\n{self.read}\n\n"
                f"THE MOVE\n{self.move}\n\n"
                f"HOW TO OPEN IT (safe framing)\n{self.framing}")


@dataclass
class ToolContext:
    memory_dir: Path
    case_path: Path
    case_id: str
    cites: list[Cite] = field(default_factory=list)
    advice: Advice | None = None
    # 0729 输出形态战役 03（分流短答）：简单事实问的第二出口。与 advice 互斥地作为终局
    # artifact——同样吃 cite 闸（无凭据不许答），但不过 9 字段投影。
    answer: str | None = None
    read_case_called: bool = False
    # Optional embedder -> recall() ranks memory lines semantically (vs keyword). None = keyword.
    # Set by the service from env (key stays server-side); the offline gate leaves it None.
    embedder: Any = None


class ToolError(Exception):
    """A recoverable, model-visible tool error (returned as an observation, not a crash)."""


# --- tool schemas (Anthropic tool-use format; RealBrain passes these verbatim) ----------------

TOOL_SCHEMAS: list[dict[str, Any]] = [
    {
        "name": "read_case",
        "description": "Read the raw, messy inputs of the scenario you were asked about. "
                       "Always your first step — never answer from a summary.",
        "input_schema": {
            "type": "object",
            "properties": {"case_id": {"type": "string", "description": "the scenario id"}},
            "required": ["case_id"],
        },
    },
    {
        "name": "recall",
        "description": "Keyword search over company memory (facts.md + notes.md). Returns "
                       "line-addressable hits like 'facts.md:15' you can later cite().",
        "input_schema": {
            "type": "object",
            "properties": {"query": {"type": "string", "description": "keywords to search for"}},
            "required": ["query"],
        },
    },
    {
        "name": "cite",
        "description": "Bind one claim you intend to make to a specific line of evidence "
                       "(e.g. 'facts.md:16' or 'case:12'). MANDATORY before any advice — call "
                       "once per grounded claim. You cannot finish without at least one cite.",
        "input_schema": {
            "type": "object",
            "properties": {
                "claim": {"type": "string"},
                "source_ref": {"type": "string", "description": "<file>:<line>, e.g. facts.md:15"},
            },
            "required": ["claim", "source_ref"],
        },
    },
    {
        "name": "draft_advice",
        "description": "Produce the final, structured read. Refused if you have cited nothing. "
                       "Never score/label the person; name the work and recommend the call. "
                       "Use this ONLY for asks that need judgment — a situation to read, a call "
                       "to make, a person dynamic. For a plain factual lookup use answer_direct.",
        "input_schema": {
            "type": "object",
            "properties": {
                "read": {"type": "string", "description": "what is actually going on (the situation)"},
                "move": {"type": "string", "description": "the concrete, decisive next step"},
                "framing": {"type": "string", "description": "how to open the conversation (safe framing)"},
            },
            "required": ["read", "move", "framing"],
        },
    },
    # 0729/03 分流短答：简单事实问（几点/哪天/多少/谁负责这类查询）的直答出口。
    # 仍然吃 cite 闸——无凭据不许答；答案一到三句，不套读/招/开场白三件套。
    {
        "name": "answer_direct",
        "description": "Answer a plain factual lookup (a time, a date, a number, a name, a "
                       "status) in one to three sentences, grounded in what you cited. Refused "
                       "if you have cited nothing. Do NOT use this for anything needing "
                       "judgment — situations, people dynamics, and 'what should I do' asks go "
                       "through draft_advice.",
        "input_schema": {
            "type": "object",
            "properties": {
                "text": {"type": "string",
                         "description": "the direct answer, one to three sentences"},
            },
            "required": ["text"],
        },
    },
]

TOOL_NAMES = [t["name"] for t in TOOL_SCHEMAS]


# --- dispatch ---------------------------------------------------------------------------------

def dispatch(name: str, args: dict[str, Any], ctx: ToolContext) -> str:
    """Run a tool call, mutate ctx, and return the observation string the model will see."""
    if name == "read_case":
        return _read_case(args, ctx)
    if name == "recall":
        return _recall(args, ctx)
    if name == "cite":
        return _cite(args, ctx)
    if name == "draft_advice":
        return _draft_advice(args, ctx)
    if name == "answer_direct":
        return _answer_direct(args, ctx)
    raise ToolError(f"unknown tool: {name}")


def _read_case(args: dict, ctx: ToolContext) -> str:
    ctx.read_case_called = True
    return ctx.case_path.read_text(encoding="utf-8")


def _recall(args: dict, ctx: ToolContext) -> str:
    query = (args or {}).get("query", "")
    hits = memory.recall(query, ctx.memory_dir, embedder=ctx.embedder)
    if not hits:
        return f"(no memory lines matched '{query}')"
    return "\n".join(h.as_line() for h in hits)


def _cite(args: dict, ctx: ToolContext) -> str:
    claim = (args or {}).get("claim", "").strip()
    source_ref = (args or {}).get("source_ref", "").strip()
    if not claim or not source_ref:
        raise ToolError("cite needs both `claim` and `source_ref`.")
    snippet = memory.resolve_ref(source_ref, ctx.memory_dir, ctx.case_path)
    cite = Cite(claim=claim, source_ref=source_ref, snippet=snippet, resolved=snippet is not None)
    ctx.cites.append(cite)
    if not cite.resolved:
        return (f"⚠ recorded, but {source_ref} does not resolve to a real line. "
                f"Re-cite against a line you saw in read_case/recall.")
    return f"✓ cited: «{claim}» ⟵ {source_ref}  ({snippet})"


def _draft_advice(args: dict, ctx: ToolContext) -> str:
    # THE un-skippable evidence gate. Tool-side, not prompt-side.
    resolved = [c for c in ctx.cites if c.resolved]
    if not resolved:
        raise ToolError(
            "REFUSED: you have not cited any evidence yet. Call cite(claim, source_ref) for "
            "each thing you want to assert — at least one resolved cite — before draft_advice.")
    args = args or {}
    read, move, framing = args.get("read", ""), args.get("move", ""), args.get("framing", "")
    if not (read and move and framing):
        raise ToolError("draft_advice needs non-empty `read`, `move`, and `framing`.")
    ctx.advice = Advice(read=read.strip(), move=move.strip(), framing=framing.strip())
    return "✓ advice drafted. You may now give your final answer."


def _answer_direct(args: dict, ctx: ToolContext) -> str:
    # 0729/03：短答与 advice 同吃 cite 闸——凭据先行是链的地板，不因形态短而松。
    resolved = [c for c in ctx.cites if c.resolved]
    if not resolved:
        raise ToolError(
            "REFUSED: you have not cited any evidence yet. Call cite(claim, source_ref) — at "
            "least one resolved cite — before answer_direct.")
    text = ((args or {}).get("text") or "").strip()
    if not text:
        raise ToolError("answer_direct needs a non-empty `text`.")
    ctx.answer = text
    return "✓ answered. You may now finish."


def cited_snippets(ctx: ToolContext) -> list[str]:
    return [c.snippet for c in ctx.cites if c.resolved and c.snippet]
