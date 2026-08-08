"""#71 · Conversation history for a follow-up advise turn — the quota + normalization point.

The Room went from "one question, one run" to a conversation: a follow-up ships the earlier
turns so the model can resolve "那个项目" / "他" / "it" against what was just said. This module
owns the ONLY quota for that payload, for one reason: `history` is client-supplied and
unbounded by nature (a long chat), and it lands directly in the model context. Without a cap
here, a manager with a long session silently pays for — and eventually blows — a prompt that
grew without anyone deciding it should.

Design notes worth keeping:

  * `stream_advice` calls this ITSELF rather than trusting its caller. The service layer is not
    the only caller (tests drive the engine directly), and a quota that only exists on one call
    path is a quota with a hole in it.
  * Truncation is VISIBLE to the model — over-long text keeps a `…[truncated]` tail and dropped
    turns leave an `[earlier turns omitted]` note on the oldest surviving question. A silently
    shortened history reads to the model as a complete one, and it will happily assert things
    about a conversation it was only shown half of.
  * The marks are English on purpose: they are prompt scaffolding (same layer as the chain /
    red-line nudges in `avery/loop.py` and the `## Referenced records (@)` block), not manager-
    facing UI copy. They never reach a screen, so they never go through i18n.
  * Nothing here is persisted. `advise_runs` still stores one row per question with its own
    terminal artifact — history is a per-request assembly input and dies with the request.
    That is what makes this ticket zero-migration.

The frontend keeps a mirror of the turn/char caps in `src/lite2/askHistory.ts` (so a long
session doesn't ship kilobytes it knows will be cut). That mirror is a courtesy; THIS file is
the enforcement. Change one, change both.
"""
from __future__ import annotations

from typing import Any, Iterable

# 最多带几轮。超出丢**最早**的：追问要解析的指代（"那个项目"/"他"）几乎总是指最近几轮。
HISTORY_MAX_TURNS = 6
# 单轮问题 / 回答摘要的字数上限。回答给得比问题宽——问题是一句话，摘要是一段话。
HISTORY_MAX_QUESTION_CHARS = 400
HISTORY_MAX_ANSWER_CHARS = 800
# 整块封顶（最后一道闸）：即便每轮都没超单项上限，六轮 × 1200 也还是 7KB 量级。
# 从**最早**的一轮开始丢，直到装得下。
HISTORY_MAX_TOTAL_CHARS = 3000

TRUNCATION_MARK = "…[truncated]"
DROPPED_MARK = "[earlier turns omitted]"


def _clamp(text: Any, limit: int) -> str:
    s = (text or "")
    if not isinstance(s, str):
        s = str(s)
    s = s.strip()
    if len(s) <= limit:
        return s
    return s[:limit] + TRUNCATION_MARK


def _turn_field(turn: Any, name: str) -> Any:
    """Accept both the pydantic model (attribute access) and a plain dict (tests / direct
    engine callers). Anything else contributes nothing rather than raising — a malformed
    history entry must degrade to "less context", never to a failed advise turn (the same
    best-effort discipline `_build_reference_block` follows for @-references)."""
    if isinstance(turn, dict):
        return turn.get(name)
    return getattr(turn, name, None)


def normalize_history(raw: Iterable[Any] | None) -> list[dict[str, str]]:
    """Clamp a client-supplied history to the quota. Returns `[{'question','answer'}, ...]`,
    oldest first. Empty in, empty out — and `None` in, empty out, which is what makes the
    field additive-optional (a pre-#71 frontend sends nothing and gets the pre-#71 prompt,
    byte for byte)."""
    if not raw:
        return []

    turns: list[dict[str, str]] = []
    for item in raw:
        question = _clamp(_turn_field(item, "question"), HISTORY_MAX_QUESTION_CHARS)
        answer = _clamp(_turn_field(item, "answer"), HISTORY_MAX_ANSWER_CHARS)
        # 半截的一轮不进：只有问没有答，等于告诉模型"上一轮问了这个"却不说结果，
        # 它会去圆一个自己没看见的答案。宁可少一轮。
        if not question or not answer:
            continue
        turns.append({"question": question, "answer": answer})

    dropped = False
    if len(turns) > HISTORY_MAX_TURNS:
        turns = turns[-HISTORY_MAX_TURNS:]
        dropped = True

    # 整块封顶：从最早的一轮开始丢。留不下任何一轮时返回空（而不是留半轮）。
    def total(items: list[dict[str, str]]) -> int:
        return sum(len(t["question"]) + len(t["answer"]) for t in items)

    while turns and total(turns) > HISTORY_MAX_TOTAL_CHARS:
        turns = turns[1:]
        dropped = True

    if dropped and turns:
        # 标在**最早那一轮的问题**上：模型读到的第一句就说清"这不是对话的开头"。
        turns[0] = {**turns[0], "question": f"{DROPPED_MARK} {turns[0]['question']}"}
    return turns


def history_conversation_turns(raw: Iterable[Any] | None) -> list[dict]:
    """The Anthropic-shaped message turns to prepend BEFORE the opening user turn.

    Plain-text user/assistant pairs — deliberately NOT replayed as tool_use/tool_result
    blocks. Those blocks reference tool_use ids from a finished run; re-sending them would be
    both wrong (ids the current request never issued) and enormous (whole observations). The
    model needs to know what was asked and what was concluded, not how the last run got there.
    """
    turns: list[dict] = []
    for t in normalize_history(raw):
        turns.append({"role": "user", "content": [{"type": "text", "text": t["question"]}]})
        turns.append({"role": "assistant", "content": [{"type": "text", "text": t["answer"]}]})
    return turns
