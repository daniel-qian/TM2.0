# -*- coding: utf-8 -*-
"""feat-034 stage C — the Ask ("Quick ask" / 快问) domain objects + the write-side gates.

An Ask is the agent-drafted, manager-confirmed, one-person-one-link employee self-report loop
(PRD .issues/ask-card-0713/PRD.md; red-line boundaries ADR-0023). This module holds:

  * the dataclasses both registry twins round-trip (`Ask` / `AskQuestion` / `AskRecipient`) —
    deliberately mirroring the frontend `AskDraft` contract shape (src/lite/transport.ts);
  * the SERVER-OWNED status vocabulary (`ASK_STATUSES`) — stage-C F1: the six words are pinned
    here AND in the DB CHECK; `effective_status()` derives collecting/closed/expired so the
    stored base status can never drift from what the receipts actually say;
  * 🔴 the write-side red-line gate (`gate_ask_red_line`) — TWO-TIER, reusing the feat-033
    machinery verbatim (no new mechanism): a question about the WORK always passes the UNCHANGED
    `avery.redline.validate` (EN+ZH); a person-scoring question is refused UNLESS the operator
    switch `AVERY_ALLOW_PERSON_SCORING` (avery.scoring_policy) is on. The NUL/0x00 storage-safety
    check ALWAYS runs, switch or no switch (it is not a red-line policy).

The receipt (an employee's OWN answer about a piece of WORK) is deliberately NOT gated against the
red line: ADR-0023 allows the employee's own voice; the structural guarantee is placement — answers
hang off (ask, recipient), never off a person entity (the entities CHECK still stands).
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

# ── the server-owned vocabularies (F1: the frontend coerces, the server DEFINES) ────────────────
ASK_STATUSES = ("draft", "shared", "collecting", "closed", "revoked", "expired")
QUESTION_KINDS = ("scale", "yesno")
GENERATION_MODES = ("manager", "llm", "template")

MAX_QUESTIONS = 3
SCALE_MIN, SCALE_MAX = 1, 5
EXPIRY_DAYS = 7                    # PRD Q8
MAX_RECIPIENTS = 30                # hard gate: a quick ask is not a survey blast
MAX_QUESTION_CHARS = 300           # hard gates on manager-provided free text
MAX_HINT_CHARS = 500
MAX_COMMENT_CHARS = 2000           # employee one-liner (generous, but bounded)

DEFAULT_COMMENT_PROMPT = "Anything to add, in one line?"


@dataclass
class AskQuestion:
    id: str
    kind: str                      # 'scale' | 'yesno'
    text: str


@dataclass
class AskRecipient:
    id: str                        # the roster person id the manager picked (opaque to the server)
    name: str                      # a NAMED person (PRD Q4 — answers attribute to a person)
    share_token: str = ""          # minted at share ("" for a draft); unguessable, employee-side
    answers: list | None = None    # [{question_id, value}] — lands ONCE (answer-once lock)
    comment: str = ""              # the employee's own words, shown verbatim (ADR-0023)
    answered_at: str = ""          # ISO8601 UTC; "" until answered


@dataclass
class Ask:
    id: str
    context_id: str
    status: str = "draft"
    questions: list[AskQuestion] = field(default_factory=list)
    recipients: list[AskRecipient] = field(default_factory=list)
    comment_prompt: str = ""
    thread_hint: str = ""
    generation_mode: str = "manager"
    created_at: str = ""
    expires_at: str = ""


def new_ask_id() -> str:
    return "ask_" + uuid.uuid4().hex[:16]


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def default_expiry(created_at_iso: str) -> str:
    """created_at + 7 days (PRD Q8), same ISO8601 UTC shape."""
    dt = datetime.fromisoformat(created_at_iso)
    return (dt + timedelta(days=EXPIRY_DAYS)).isoformat()


def answered_count(ask: Ask) -> int:
    return sum(1 for r in ask.recipients if r.answered_at)


def effective_status(ask: Ask, now: datetime | None = None) -> str:
    """The status the SERVER vouches for right now. Terminal states (closed / revoked) hold;
    a live ask past its expires_at reads 'expired'; a shared ask derives collecting/closed from
    how many receipts are actually in — the stored base word can never overstate."""
    if ask.status in ("closed", "revoked"):
        return ask.status
    now = now or datetime.now(timezone.utc)
    if ask.expires_at:
        try:
            exp = datetime.fromisoformat(ask.expires_at)
            if exp.tzinfo is None:
                exp = exp.replace(tzinfo=timezone.utc)
            if now > exp:
                return "expired"
        except ValueError:
            pass   # an unparsable expiry never blocks reads; the ask just doesn't expire
    if ask.status in ("shared", "collecting"):
        n = answered_count(ask)
        if n == 0:
            return "shared"
        if n < len(ask.recipients):
            return "collecting"
        return "closed"
    return ask.status


# ── 🔴 the write-side gates (the storage door BOTH registry twins call) ─────────────────────────

def gate_ask_red_line(ask: Ask) -> None:
    """Refuse a person-scoring question/prompt/hint BEFORE anything lands — the same two-tier
    decision `gate_note_red_line` (feat-033) makes, against the same UNCHANGED detector:

      tier 1: text about the WORK passes `avery.redline.validate` (EN+ZH) — always allowed;
      tier 2: a person-scoring text fails validate -> refused, UNLESS the operator has explicitly
              unblocked person scoring (`AVERY_ALLOW_PERSON_SCORING`, avery.scoring_policy).

    Each outbound text field is validated SEPARATELY (feat-033 adversarial closure: no negation
    bleed across fields). Recipient names/comments are NOT red-line-gated here (a receipt is the
    employee's own voice — ADR-0023), but every text column is NUL-checked ALWAYS (storage safety
    is not a policy)."""
    from avery import redline                     # core, offline, stdlib-only
    from avery.scoring_policy import person_scoring_allowed

    outbound = [q.text for q in ask.questions] + [ask.comment_prompt, ask.thread_hint]
    if not person_scoring_allowed():
        for part in outbound:
            if not part:
                continue
            rl = redline.validate(part)
            if not rl.passed:
                raise ValueError(f"red line: refusing to store a person-scoring ask ({rl.summary()})")

    every_text = outbound + [ask.id, ask.context_id, ask.status, ask.generation_mode]
    for r in ask.recipients:
        every_text += [r.id, r.name, r.share_token, r.comment]
    if any("\x00" in (t or "") for t in every_text):
        raise ValueError("unsupported control character (NUL / 0x00) in an ask — cannot be stored")


def validate_ask_shape(ask: Ask) -> str | None:
    """Structural validation (the server is the FINAL door; frontend F3 mirrors it defensively).
    Returns a human reason or None when clean. Not a red-line concern — just 'bad shapes never
    land' (1..3 questions, known kinds, non-empty named recipients, bounded text)."""
    if not (1 <= len(ask.questions) <= MAX_QUESTIONS):
        return f"an ask carries 1 to {MAX_QUESTIONS} questions (got {len(ask.questions)})"
    for q in ask.questions:
        if q.kind not in QUESTION_KINDS:
            return f"unknown question kind {q.kind!r} (allowed: {', '.join(QUESTION_KINDS)})"
        if not (q.text or "").strip():
            return "a question with empty text"
        if len(q.text) > MAX_QUESTION_CHARS:
            return f"a question longer than {MAX_QUESTION_CHARS} characters"
    if not (1 <= len(ask.recipients) <= MAX_RECIPIENTS):
        return f"an ask goes to 1 to {MAX_RECIPIENTS} named people (got {len(ask.recipients)})"
    for r in ask.recipients:
        if not (r.name or "").strip():
            return "a recipient with an empty name"
    if len(ask.comment_prompt or "") > MAX_QUESTION_CHARS:
        return f"a comment prompt longer than {MAX_QUESTION_CHARS} characters"
    if len(ask.thread_hint or "") > MAX_HINT_CHARS:
        return f"a thread hint longer than {MAX_HINT_CHARS} characters"
    if ask.status not in ASK_STATUSES:
        return f"unknown status {ask.status!r}"
    return None
