# -*- coding: utf-8 -*-
"""feat-034 stage C — the Ask ("Quick ask" / 快问) HTTP surface: manager endpoints + employee H5.

COMPOSE, not modify (the feat-018 discipline): this router rides the seams the persistence line
already built — `active_registry()` for storage, `authorize_context` / `extract_owner_token` for
the manager-side tenant gate, `brain_factory` + `llm_budget.BudgetedBrain` for server-side question
generation, and the UNCHANGED `avery.redline.validate` (via `ask.gate_ask_red_line`) as the
question door. Nothing in the frozen advisor engine changes.

Two token worlds, STRICTLY apart (stage-C docking contract):
  * owner_token — the MANAGER credential. Header only (X-Avery-Token / Bearer), never a URL.
    Every /ask endpoint requires it; unknown ask id and wrong/missing token raise the SAME 404
    ("unknown ask id: …") so the surface never confirms an ask exists (no enumeration oracle).
    feat-053 adds a SECOND way to satisfy that same gate: `X-Avery-Account` (a verified Supabase
    user who OWNS this context). It only ever WIDENS — every failure still lands on the identical
    404. Without it, "sign in on a new device" reads the team/notes/files fine and then 404s the
    moment you ask a question: the owner_token is minted once, on the machine that uploaded, so a
    second device has no way to hold it. (07-20 生产实测；progress.md Blockers 3.)
  * share_token — the EMPLOYEE credential, minted at /ask/{id}/share (secrets.token_urlsafe(32),
    one per recipient — PRD Q4 one-person-one-link). It rides the /r/{token} URL BY DESIGN: the
    only login-free path through an IM webview. It reads/writes exactly ONE recipient's answer.

The employee H5 is SERVER-RENDERED single-page HTML (PRD Q6): per-link OG meta, the ADR-0023
transparency triple (who is asking / what about / who sees the answer), big-button 1..5 and 是/否
inputs, an optional one-line comment — ZH default, `?lang=en` flips. Inline styles only, ZERO
external resources (IM webviews get nothing to block). Answered = locked (409 on a re-submit);
revoked = 410; expired / unknown token = loud 404 (feat-028 discipline).
"""
from __future__ import annotations

import json
import logging
import re
import secrets
from typing import Any

from fastapi import APIRouter, Header, HTTPException, Request
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field

from avery.ingest.ask import (
    DEFAULT_COMMENT_PROMPT, MAX_COMMENT_CHARS, SCALE_MAX, SCALE_MIN,
    Ask, AskQuestion, AskRecipient,
    default_expiry, effective_status, gate_ask_red_line, new_ask_id, now_iso,
    validate_ask_shape,
)
from avery.ingest.registry import active_registry

from . import account, brain_factory, h5, llm_budget
from .ingest_api import authorize_context, extract_owner_token

logger = logging.getLogger(__name__)

router = APIRouter()

SHARE_TOKEN_BYTES = 32     # same entropy class as the owner_token (~256 bits, url-safe)


def public_base() -> str:
    """The public origin employee links are minted under.

    Default = the LIVE backend origin (ADR-0024 single-target Frankfurt; it superseded PRD Q11's
    avery.ima-read.com, whose DNS never went live — a link minted on it 白屏s in the IM webview,
    2026-08-05 生产 P0). The default must always be a domain that actually serves /r/{token};
    deployments that front the service elsewhere set AVERY_PUBLIC_BASE explicitly.
    """
    import os
    return (os.environ.get("AVERY_PUBLIC_BASE") or "https://avery.dannyqian.com").rstrip("/")


# ── request bodies (a superset of the frontend AskDraft — unknown fields are ignored) ───────────

class QuestionIn(BaseModel):
    id: str | None = None
    kind: str = "scale"
    text: str = ""


class RecipientIn(BaseModel):
    id: str | None = None
    name: str = ""


class AskBody(BaseModel):
    company_context_id: str = Field(..., min_length=1)
    questions: list[QuestionIn] | None = None      # None/[] -> the server GENERATES (1..3)
    recipients: list[RecipientIn] = Field(default_factory=list)
    comment_prompt: str | None = None
    thread_hint: str | None = None
    situation: str | None = None                   # optional generation context (thread question)


# ── the manager-side auth seam (owner_token, 404-on-mismatch, no oracle) ────────────────────────

def authorize_ask(reg, ask_id: str, token: str | None,
                  account_user_id: str | None = None) -> Ask:
    """Resolve an ask the caller may operate on, or raise 404. Unknown id AND wrong/missing
    owner_token raise the IDENTICAL 404 (never the context-flavored one — that would confirm the
    ask exists and leak its context id). Reuses `authorize_context` (constant-time compare).

    `account_user_id` is an ALREADY-VERIFIED Supabase user id (verification lives in
    service/account.py; this function trusts its caller did that) — passed straight through to
    `authorize_context`, which owns the single decision of "does this user own this context".
    Ownership is NEVER re-derived here: two places deciding the same thing is how they drift apart.
    """
    unknown = HTTPException(status_code=404, detail=f"unknown ask id: {ask_id}")
    ask = reg.get_ask(ask_id)
    if ask is None:
        raise unknown
    try:
        authorize_context(reg, ask.context_id, token, account_user_id)
    except HTTPException:
        raise unknown from None
    return ask


# ── server-side question generation (the LLM spend gate applies) ────────────────────────────────

_GEN_SYSTEM = (
    "You draft quick self-report questions a manager sends to ONE teammate about a piece of WORK "
    "(a launch, a deadline, a handoff, a negotiation). The teammate answers in ten seconds.\n"
    "HARD RULES:\n"
    "- Ask about the WORK and the person's own read of it. NEVER rate, score, rank, or judge the "
    "person; never ask them to grade their own ability or performance.\n"
    "- 1 to 3 questions. kind 'scale' = answered 1..5 (their own confidence in the work); "
    "kind 'yesno' = answered yes/no.\n"
    "Reply with ONLY a JSON array, no prose: "
    '[{"kind": "scale", "text": "..."}, {"kind": "yesno", "text": "..."}]'
)


def _template_questions() -> list[AskQuestion]:
    """The deterministic, keyless fallback — clean by construction (asks about the work)."""
    return [
        AskQuestion(id="q1", kind="scale",
                    text="How confident are you that this piece of work lands as planned?"),
        AskQuestion(id="q2", kind="yesno",
                    text="Do you have everything you need to move it forward?"),
    ]


def _question_passes_gate(text: str) -> bool:
    """The two-tier question door, one text at a time (reused by generation to drop violators
    BEFORE anything goes out): work questions always pass; person-scoring only when the operator
    switch is on."""
    from avery import redline
    from avery.scoring_policy import person_scoring_allowed
    if person_scoring_allowed():
        return True
    return redline.validate(text).passed


def _parse_generated(text: str) -> list[AskQuestion]:
    m = re.search(r"\[.*\]", text or "", re.S)
    if not m:
        return []
    try:
        raw = json.loads(m.group(0))
    except json.JSONDecodeError:
        return []
    out: list[AskQuestion] = []
    for i, item in enumerate(raw if isinstance(raw, list) else []):
        if not isinstance(item, dict):
            continue
        kind = str(item.get("kind", "")).strip()
        qtext = str(item.get("text", "")).strip()
        if kind in ("scale", "yesno") and qtext:
            out.append(AskQuestion(id=f"q{i + 1}", kind=kind, text=qtext[:300]))
    return out[:3]


def generate_questions(thread_hint: str, situation: str) -> tuple[list[AskQuestion], str]:
    """Server-side question drafting. A LIVE brain (AVERY_BRAIN != mock, key present) is asked,
    THROUGH the feat-039 LLM spend gate (BudgetedBrain — the employee-facing loop must never be a
    denial-of-wallet vector); every generated question must pass the question door or is dropped.
    Anything short of a usable result — no key, budget exhausted, bad JSON, all questions gated —
    falls back to the deterministic template, HONESTLY labeled (returns ('template') so the client
    is told; never a silent fake-'llm')."""
    kind = brain_factory.resolve_brain_kind()
    if kind != "mock":
        try:
            brain = llm_budget.BudgetedBrain(brain_factory.make_brain(None, kind))
            user = "Draft the questions for this thread.\n"
            if thread_hint:
                user += f"What it is about: {thread_hint}\n"
            if situation:
                user += f"The manager's question: {situation}\n"
            resp = brain.respond(
                _GEN_SYSTEM, [{"role": "user", "content": [{"type": "text", "text": user}]}],
                tools=[])
            kept = [q for q in _parse_generated(getattr(resp, "text", "") or "")
                    if _question_passes_gate(q.text)]
            if kept:
                return kept, "llm"
            logger.info("feat-034: LLM question generation yielded nothing usable — template fallback")
        except Exception as e:   # missing key / budget exhausted / provider error -> honest fallback
            logger.info("feat-034: question generation degraded to template (%s: %s)",
                        type(e).__name__, e)
    return _template_questions(), "template"


# ── payload projection (the frontend AskDraft shape, status = SERVER-effective) ─────────────────

def _ask_payload(ask: Ask) -> dict[str, Any]:
    eff = effective_status(ask)
    base = public_base()
    recipients = []
    for r in ask.recipients:
        d: dict[str, Any] = {"id": r.id, "name": r.name}
        if r.share_token:
            d["token"] = r.share_token
            d["link"] = f"{base}/r/{r.share_token}"
        if r.answered_at:
            receipt: dict[str, Any] = {"answers": r.answers or [], "answered_at": r.answered_at}
            if r.comment:
                receipt["comment"] = r.comment
            d["receipt"] = receipt
        recipients.append(d)
    payload: dict[str, Any] = {
        "id": ask.id,
        "status": eff,
        "questions": [{"id": q.id, "kind": q.kind, "text": q.text} for q in ask.questions],
        "recipients": recipients,
        "comment_prompt": ask.comment_prompt or None,
        "company_context_id": ask.context_id,
        "created_at": ask.created_at,
        "expires_at": ask.expires_at,
        "generation_mode": ask.generation_mode,
    }
    if eff == "closed" and len(ask.recipients) > 1:
        summary = receipts_summary(ask)
        if summary:
            payload["receipts_summary"] = summary
    return payload


def receipts_summary(ask: Ask) -> str | None:
    """The MULTI-recipient roll-up — ADR-0023 boundary 3: one QUALITATIVE paragraph, never a
    per-person score row. Deterministic (no LLM call, nothing to hallucinate), digit-free by
    construction, and STILL passed through the unchanged red-line gate before it goes out — the
    same 'no new mechanism' discipline as the notes write side. Returns None (omit, render the
    plain count chip client-side) rather than ever emitting a crossing summary."""
    if len(ask.recipients) <= 1 or any(not r.answered_at for r in ask.recipients):
        return None
    kinds = {q.id: q.kind for q in ask.questions}
    scale_vals: list[float] = []
    yes = no = 0
    for r in ask.recipients:
        for a in (r.answers or []):
            kind = kinds.get(a.get("question_id"))
            v = a.get("value")
            if kind == "scale" and isinstance(v, (int, float)) and not isinstance(v, bool):
                scale_vals.append(float(v))
            elif kind == "yesno" and isinstance(v, bool):
                yes, no = yes + (1 if v else 0), no + (0 if v else 1)
    parts = ["Everyone replied."]
    if scale_vals:
        avg = sum(scale_vals) / len(scale_vals)
        if avg >= 4:
            parts.append("Taken together they sound broadly confident about the work itself.")
        elif avg >= 3:
            parts.append("Taken together they sound steady about the work itself, "
                         "with reservations worth hearing.")
        else:
            parts.append("Taken together they sound hesitant about the work itself.")
    if yes and no:
        parts.append("Views split on the yes/no question.")
    elif yes:
        parts.append("Everyone answered yes to the yes/no question.")
    elif no:
        parts.append("Everyone answered no to the yes/no question.")
    parts.append("Their own words are what they said about the work — not a reading of anyone.")
    text = " ".join(parts)
    from avery import redline
    return text if redline.validate(text).passed else None


# ── building an Ask from a request body (shape door + red-line door -> 422) ─────────────────────

def _build_ask(body: AskBody, *, ask_id: str, created_at: str, expires_at: str,
               context_id: str | None = None) -> Ask:
    # context binding is immutable after create: an edit MUST pass context_id=ask.context_id so a
    # crafted body.company_context_id can't rebind the ask into another tenant (adversarial finding
    # — owner lockout + cross-tenant injection). create passes None -> takes the (authorized) body.
    if body.questions:   # the manager wrote/kept questions -> verbatim, strictly validated below
        questions = [AskQuestion(id=(q.id or f"q{i + 1}"), kind=q.kind, text=(q.text or "").strip())
                     for i, q in enumerate(body.questions)]
        mode = "manager"
    else:                # no questions -> the server drafts them (honest generation_mode label)
        questions, mode = generate_questions((body.thread_hint or "").strip(),
                                             (body.situation or "").strip())
    recipients = [AskRecipient(id=(r.id or f"r{i + 1}"), name=(r.name or "").strip())
                  for i, r in enumerate(body.recipients)]
    comment_prompt = (body.comment_prompt or "").strip() or DEFAULT_COMMENT_PROMPT
    return Ask(id=ask_id, context_id=context_id or body.company_context_id, status="draft",
               questions=questions, recipients=recipients, comment_prompt=comment_prompt,
               thread_hint=(body.thread_hint or "").strip(), generation_mode=mode,
               created_at=created_at, expires_at=expires_at)


def _gate_or_422(ask: Ask) -> None:
    reason = validate_ask_shape(ask)
    if reason:
        raise HTTPException(status_code=422, detail={"error": "ask rejected", "reason": reason})
    try:
        gate_ask_red_line(ask)
    except ValueError as e:
        raise HTTPException(status_code=422, detail={"error": "ask rejected", "reason": str(e)})


# ── manager endpoints ───────────────────────────────────────────────────────────────────────────

@router.post("/ask")
def create_ask(body: AskBody,
               x_avery_token: str | None = Header(None),
               authorization: str | None = Header(None),
               x_avery_account: str | None = Header(None)) -> dict:
    """Create a quick-ask DRAFT. Auth first (owner_token against the context — 404 on mismatch),
    then questions: manager-provided ones are taken verbatim; an empty body gets 1..3 server-
    generated ones (LLM behind the spend gate, template fallback — generation_mode says which).
    EVERY question passes the two-tier red-line door or the whole ask is 422 with the reason.
    The id is SERVER-minted (a client-suggested id is ignored — no cross-tenant id squatting)."""
    reg = active_registry()
    authorize_context(reg, body.company_context_id,
                      extract_owner_token(x_avery_token, authorization),
                      account.resolve_account(x_avery_account))
    created = now_iso()
    ask = _build_ask(body, ask_id=new_ask_id(), created_at=created,
                     expires_at=default_expiry(created))
    _gate_or_422(ask)
    try:
        reg.put_ask(ask)
    except ValueError as e:   # the storage door (belt-and-suspenders) — surface clean, never a 500
        raise HTTPException(status_code=422, detail={"error": "ask rejected", "reason": str(e)})
    return _ask_payload(ask)


@router.post("/ask/{ask_id}")
def save_ask(ask_id: str, body: AskBody,
             x_avery_token: str | None = Header(None),
             authorization: str | None = Header(None),
             x_avery_account: str | None = Header(None)) -> dict:
    """Save an EDIT (re-validated through the same doors). Only a DRAFT is editable — once shared
    the questions are out the door and frozen (409)."""
    reg = active_registry()
    ask = authorize_ask(reg, ask_id, extract_owner_token(x_avery_token, authorization),
                        account.resolve_account(x_avery_account))
    if effective_status(ask) != "draft":
        raise HTTPException(status_code=409, detail={
            "error": "not editable",
            "reason": f"ask is {effective_status(ask)} — questions are frozen after sharing"})
    edited = _build_ask(body, ask_id=ask.id, created_at=ask.created_at, expires_at=ask.expires_at,
                        context_id=ask.context_id)  # pin: context is immutable on edit (see _build_ask)
    _gate_or_422(edited)
    try:
        reg.put_ask(edited)
    except ValueError as e:
        raise HTTPException(status_code=422, detail={"error": "ask rejected", "reason": str(e)})
    return _ask_payload(edited)


@router.post("/ask/{ask_id}/share")
def share_ask(ask_id: str,
              x_avery_token: str | None = Header(None),
              authorization: str | None = Header(None),
              x_avery_account: str | None = Header(None)) -> dict:
    """Mint ONE unguessable share token per recipient (PRD Q4) and return the full links. The
    manager pastes them by hand (share = the human gate). Idempotent on a live shared ask — a
    double click must never invalidate links already pasted into an IM. Revoked/expired/closed
    asks refuse (409)."""
    reg = active_registry()
    ask = authorize_ask(reg, ask_id, extract_owner_token(x_avery_token, authorization),
                        account.resolve_account(x_avery_account))
    eff = effective_status(ask)
    if eff in ("shared", "collecting"):
        return _ask_payload(ask)   # idempotent: same tokens, same links
    if eff != "draft":
        raise HTTPException(status_code=409, detail={
            "error": "not shareable", "reason": f"ask is {eff}"})
    for r in ask.recipients:
        r.share_token = secrets.token_urlsafe(SHARE_TOKEN_BYTES)
    ask.status = "shared"
    reg.put_ask(ask)
    return _ask_payload(ask)


@router.get("/ask/{ask_id}")
def get_ask(ask_id: str,
            x_avery_token: str | None = Header(None),
            authorization: str | None = Header(None),
            x_avery_account: str | None = Header(None)) -> dict:
    """Manager pull-refresh (PRD Q7): status + receipts (+ the qualitative multi-summary once all
    replies are in). Status is the SERVER-effective word — collecting/closed/expired derive here."""
    reg = active_registry()
    ask = authorize_ask(reg, ask_id, extract_owner_token(x_avery_token, authorization),
                        account.resolve_account(x_avery_account))
    return _ask_payload(ask)


@router.post("/ask/{ask_id}/revoke")
def revoke_ask(ask_id: str,
               x_avery_token: str | None = Header(None),
               authorization: str | None = Header(None),
               x_avery_account: str | None = Header(None)) -> dict:
    """Void the ask: every un-answered link flips to the revoked page. Idempotent. A CLOSED ask
    (all evidence in) refuses — a receipt cannot be un-happened (PRD Q8: evidence is stable)."""
    reg = active_registry()
    ask = authorize_ask(reg, ask_id, extract_owner_token(x_avery_token, authorization),
                        account.resolve_account(x_avery_account))
    eff = effective_status(ask)
    if eff == "revoked":
        return _ask_payload(ask)
    if eff == "closed":
        raise HTTPException(status_code=409, detail={
            "error": "not revocable", "reason": "all replies are in — a closed ask stays closed"})
    ask.status = "revoked"
    reg.put_ask(ask)
    return _ask_payload(ask)


# ── the employee H5 (server-rendered, ZH default, zero external resources) ──────────────────────

_COPY = {
    "zh": {
        "title": "快问 · Avery",
        "og_desc": "一条来自你负责人的快问 —— 你的回答会原样带回给发起人，10 秒点按即可。",
        "who_label": "谁在问",
        "who": "{company} 的负责人，通过 Avery 发起",
        "what_label": "问的什么事",
        "what_fallback": "一件正在进行的工作",
        "vis_label": "回答会给谁看",
        "vis": "原样交给发起这条快问的负责人 —— 这是你对这件事的说法，不是对你的评分。",
        "for_line": "这条链接是发给 {name} 的 —— 一人一链，答完即锁定。",
        "scale_hint": "1 = 把握不大 · 5 = 很有把握",
        "yes": "是", "no": "否",
        "submit": "提交回答",
        "answered_title": "你已答过",
        "answered_body": "回答提交后即锁定，无法修改 —— 这样你的原话才稳得住。",
        "answered_at": "回答时间",
        "thanks_title": "已提交，谢谢！",
        "thanks_body": "你的回答已原样带回给发起人。回答已锁定。",
        "revoked_title": "这条快问已撤回",
        "revoked_body": "发起人已将它作废，无需回答。",
        "expired_title": "这条快问已过期",
        "expired_body": "链接超过了有效期（7 天）。如仍需回答，请发起人重新发起。",
        "unknown_title": "链接不存在",
        "unknown_body": "没有找到这条快问 —— 请与发起人确认链接。",
        "invalid_title": "还差一步",
        "invalid_body": "每个问题都需要点选一个答案（短评可留空）。请返回上一页补齐后再提交。",
        "lang_switch": '<a class="h5-lang" href="?lang=en">English</a>',
    },
    "en": {
        "title": "Quick ask · Avery",
        "og_desc": "A quick ask from your manager — your answer goes back to them verbatim. "
                   "Ten seconds, tap and done.",
        "who_label": "Who is asking",
        "who": "Your manager at {company}, via Avery",
        "what_label": "What it's about",
        "what_fallback": "a piece of work in flight",
        "vis_label": "Who sees your answer",
        "vis": "It goes verbatim to the manager who sent this — your read of the work, "
               "not a rating of you.",
        "for_line": "This link was made for {name} — one person, one link; it locks once answered.",
        "scale_hint": "1 = shaky · 5 = very confident",
        "yes": "Yes", "no": "No",
        "submit": "Send my answer",
        "answered_title": "You already answered",
        "answered_body": "Answers lock on submit and can't be changed — that keeps your words yours.",
        "answered_at": "Answered",
        "thanks_title": "Sent — thank you!",
        "thanks_body": "Your answer went back to the sender verbatim. It is now locked.",
        "revoked_title": "This quick ask was withdrawn",
        "revoked_body": "The sender cancelled it — nothing to answer.",
        "expired_title": "This quick ask expired",
        "expired_body": "The link outlived its window (seven days). Ask the sender to send a new one.",
        "unknown_title": "Link not found",
        "unknown_body": "No quick ask lives at this link — check it with the sender.",
        "invalid_title": "One more step",
        "invalid_body": "Every question needs one tapped answer (the comment is optional). "
                        "Go back and complete it.",
        "lang_switch": '<a class="h5-lang" href="?lang=zh">中文</a>',
    },
}

# T1 提取：转义 / 内联 CSS / 页面模板搬去了 service/h5.py，两个员工页（快问 /r、表单 /f）共用同一
# 张壳。这里保留三个私有别名，调用点一个字没改，渲染出的 HTML 与提取前逐字节相同。
_H5_CSS = h5.H5_CSS
_esc = h5.esc
_page = h5.page


def _lang(lang: str | None) -> dict:
    return _COPY["en"] if (lang or "").lower().startswith("en") else _COPY["zh"]


def _status_page(L: dict, key: str, status_code: int, extra: str = "") -> HTMLResponse:
    body = (
        '<div class="h5-card h5-status">'
        f"<h1>{_esc(L[key + '_title'])}</h1>"
        f"<p>{_esc(L[key + '_body'])}</p>{extra}"
        "</div>"
    )
    return HTMLResponse(_page(L, L[key + "_title"], L["og_desc"], body,
                              "zh" if L is _COPY["zh"] else "en"),
                        status_code=status_code)


def _answered_extra(L: dict, rec: AskRecipient) -> str:
    when = _esc((rec.answered_at or "")[:16].replace("T", " "))
    return f'<p class="h5-meta">{_esc(L["answered_at"])}: {when} UTC</p>' if when else ""


def _form_page(L: dict, ask: Ask, rec: AskRecipient, company: str, token: str,
               lang: str | None) -> str:
    lead = ask.questions[0].text if ask.questions else ""
    about = ask.thread_hint or L["what_fallback"]
    action = f"/r/{_esc(token)}/answer" + ("?lang=en" if L is _COPY["en"] else "")
    rows: list[str] = []
    for q in ask.questions:
        rows.append(f'<p class="h5-q">{_esc(q.text)}</p>')
        if q.kind == "scale":
            rows.append(f'<p class="h5-hint">{_esc(L["scale_hint"])}</p><div class="h5-scale">')
            for v in range(SCALE_MIN, SCALE_MAX + 1):
                rid = f"q_{q.id}_{v}"
                rows.append(
                    f'<label for="{rid}">'
                    f'<input type="radio" id="{rid}" name="q_{_esc(q.id)}" value="{v}" required>'
                    f'<span class="h5-btn">{v}</span></label>')
            rows.append("</div>")
        else:
            rows.append('<div class="h5-yn">')
            for v, label in (("yes", L["yes"]), ("no", L["no"])):
                rid = f"q_{q.id}_{v}"
                rows.append(
                    f'<label for="{rid}">'
                    f'<input type="radio" id="{rid}" name="q_{_esc(q.id)}" value="{v}" required>'
                    f'<span class="h5-btn">{_esc(label)}</span></label>')
            rows.append("</div>")
    comment_label = ask.comment_prompt or DEFAULT_COMMENT_PROMPT
    body = (
        '<div class="h5-card">'
        f"<h1>{_esc(L['title'])}</h1>"
        f'<p class="h5-who"><b>{_esc(L["who_label"])}</b>：'
        f"{_esc(L['who'].format(company=company or 'company'))}</p>"
        f'<p class="h5-what"><b>{_esc(L["what_label"])}</b>：{_esc(about)}</p>'
        f'<p class="h5-visibility"><b>{_esc(L["vis_label"])}</b>：{_esc(L["vis"])}</p>'
        f'<p class="h5-for">{_esc(L["for_line"].format(name=rec.name))}</p>'
        f'<form method="post" action="{action}">'
        + "".join(rows)
        + f'<p class="h5-q">{_esc(comment_label)}</p>'
        f'<textarea name="comment" maxlength="{MAX_COMMENT_CHARS}"></textarea>'
        f'<button type="submit" class="h5-submit">{_esc(L["submit"])}</button>'
        "</form></div>"
    )
    return _page(L, lead, L["og_desc"], body, "zh" if L is _COPY["zh"] else "en")


def _resolve_link(token: str, L: dict):
    """Shared GET/POST resolution: -> (ask, ridx) or an HTMLResponse status page (loud, honest)."""
    reg = active_registry()
    hit = reg.get_ask_by_token(token)
    if hit is None:
        return _status_page(L, "unknown", 404)
    ask, ridx = hit
    eff = effective_status(ask)
    if eff == "revoked":
        return _status_page(L, "revoked", 410)
    if eff == "expired":
        return _status_page(L, "expired", 404)
    return ask, ridx


@router.get("/r/{token}", response_class=HTMLResponse)
def share_page(token: str, lang: str | None = None):
    """The employee answer page (login-free by design — the token IS the credential and reads
    exactly one recipient's slice). Renders THIS recipient only; the other links' people never
    appear here (Q4 one-person-one-link)."""
    L = _lang(lang)
    resolved = _resolve_link(token, L)
    if isinstance(resolved, HTMLResponse):
        return resolved
    ask, ridx = resolved
    rec = ask.recipients[ridx]
    if rec.answered_at:
        return _status_page(L, "answered", 200, _answered_extra(L, rec))
    reg = active_registry()
    ctx = reg.get(ask.context_id)
    company = getattr(ctx, "name", "") or "company"
    return HTMLResponse(_form_page(L, ask, rec, company, token, lang))


def _parse_answers(ask: Ask, form) -> tuple[list[dict] | None, str | None]:
    """Every question needs one in-range answer: scale in 1..5, yesno in {yes,no}. Anything else
    is a 422 (bad shapes never land server-side — the final door the frontend F3 mirrors)."""
    answers: list[dict] = []
    for q in ask.questions:
        raw = (form.get(f"q_{q.id}") or "").strip()
        if q.kind == "scale":
            # isdecimal() (not isdigit()): isdigit() is True for superscripts/enclosed
            # digits like ² ① that int() then rejects → guard against a crafted-POST 500
            # (adversarial finding F-1). Real H5 radios only emit 1–5; this is defense-in-depth.
            if not raw.isdecimal() or not (SCALE_MIN <= int(raw) <= SCALE_MAX):
                return None, f"question {q.id} needs a value {SCALE_MIN}..{SCALE_MAX}"
            answers.append({"question_id": q.id, "value": int(raw)})
        else:
            if raw not in ("yes", "no"):
                return None, f"question {q.id} needs yes or no"
            answers.append({"question_id": q.id, "value": raw == "yes"})
    return answers, None


def _clean_comment(raw: str | None) -> str:
    """The employee's optional one-liner: bounded, C0-control-scrubbed (storage safety), verbatim
    otherwise — it is THEIR voice (ADR-0023: never red-line-gated, never rewritten)."""
    text = (raw or "")[:MAX_COMMENT_CHARS]
    return "".join(ch for ch in text if ch == "\n" or ch == "\t" or ord(ch) >= 32).strip()


@router.post("/r/{token}/answer", response_class=HTMLResponse)
async def share_answer(token: str, request: Request, lang: str | None = None):
    """Record ONE answer, once. The lock is server-side and atomic (the registry's record_answer
    only lands where nothing landed before) — a repeat submit gets the 'already answered' page
    with a 409, and the FIRST answer stays untouched (PRD Q8: evidence is stable)."""
    L = _lang(lang)
    resolved = _resolve_link(token, L)
    if isinstance(resolved, HTMLResponse):
        return resolved
    ask, ridx = resolved
    rec = ask.recipients[ridx]
    if rec.answered_at:
        return _status_page(L, "answered", 409, _answered_extra(L, rec))
    form = await request.form()
    answers, err = _parse_answers(ask, form)
    if err:
        return _status_page(L, "invalid", 422)
    comment = _clean_comment(form.get("comment"))
    reg = active_registry()
    outcome = reg.record_answer(token, answers, comment, now_iso())
    if outcome == "already":
        return _status_page(L, "answered", 409)
    if outcome == "unknown":
        return _status_page(L, "unknown", 404)
    return _status_page(L, "thanks", 200)


# ── the ask-draft SSE frame (service-layer injection — the frozen engine is untouched) ──────────

def _latin_word_char(ch: str) -> bool:
    """#72 · 词边界只对「以字母连写成词」的文字有意义（拉丁/数字）。CJK 无空格、无词界——
    相邻汉字不构成"同一个词"的证据，所以汉字**永远不算**边界阻断字符。裸抄英文 `\\b` 的话
    Python 会把汉字也算 word char，「小王」在「问一下小王这周的排班」里就匹配不上了——
    词边界升级反手把中文触发整个杀死（该出的卡全没了）。"""
    if not ch:
        return False
    if "⺀" <= ch:   # CJK 及其后的东亚区段（含扩展/兼容区）——一律不算拉丁词字符
        return False
    return ch.isalnum()


def _name_mentioned(name: str, situation: str) -> bool:
    """#72 · 触发判据从裸子串升级为**文种感知的词边界匹配**（大小写不敏感）。

    病根（0808 演习 Danny 实测「一直弹」）：`p.name.lower() in hay` 是裸子串——两字符起步、
    不看边界，"Li" 命中 "the list"、"Marcus Reid" 命中 "Marcus Reidenbach"。16 人花名册下
    几乎问啥都中。

    规则：某次出现算命中，当且仅当匹配段的**拉丁字母边**没有紧贴着另一个拉丁字母/数字
    （那说明它只是长词的一截）。CJK 邻接不阻断（中文本来就连写）。已知边界：两个中文名
    互为前缀时（「王力」vs「王力宏」）仍会双中——中文无词界，不做分词猜测，宁多勿漏。"""
    hay = (situation or "").lower()
    needle = (name or "").lower()
    if not needle:
        return False
    start = 0
    while True:
        idx = hay.find(needle, start)
        if idx < 0:
            return False
        before = hay[idx - 1] if idx > 0 else ""
        after_i = idx + len(needle)
        after = hay[after_i] if after_i < len(hay) else ""
        blocked = (_latin_word_char(before) and _latin_word_char(needle[0])) or \
                  (_latin_word_char(after) and _latin_word_char(needle[-1]))
        if not blocked:
            return True
        start = idx + 1


def maybe_ask_draft_frame(company_context_id: str | None, situation: str | None,
                          manifest: dict | None = None) -> dict | None:
    """Decide (deterministically, honestly) whether this /advise warrants drafting a quick ask,
    and build the `manifest{kind:'ask-draft'}` frame if so. Two-part heuristic (#72 收敛):

      1. the manager's situation NAMES at least one roster person — word-boundary matched
         (`_name_mentioned`, script-aware; the pre-#72 bare-substring hit almost anything
         against a 16-person roster) — the exact case where the missing evidence lives in
         that person's own mouth;
      2. the run's terminal artifact is a JUDGMENT (advice), not a factual lookup: a run that
         ended in `answer_kind == 'answer'` read the fact straight out of the record — there
         is nothing to survey anyone about, so no card (#72 语义闸；此前短答后也弹卡，
         是「一直弹」的另一半病根).

    No hit -> no frame (never force a card). The draft is a PROPOSAL only — nothing persists
    until the manager confirms via POST /ask. Every question passed the two-tier gate before
    the frame goes out the door."""
    if not company_context_id or not (situation or "").strip():
        return None
    if manifest is not None and manifest.get("answer_kind") == "answer":
        return None
    try:
        reg = active_registry()
        ctx = reg.get(company_context_id)
    except Exception:
        return None
    if ctx is None:
        return None
    matched = [p for p in ctx.extraction.people
               if p.name and len(p.name) >= 2 and _name_mentioned(p.name, situation)]
    if not matched:
        return None
    questions, mode = generate_questions("", situation)
    questions = [q for q in questions if _question_passes_gate(q.text)]
    if not questions:
        return None   # honest: nothing clean to propose -> no card
    return {
        "type": "manifest",
        "kind": "ask-draft",
        "ask": {
            "id": new_ask_id(),
            "status": "draft",
            "questions": [{"id": q.id, "kind": q.kind, "text": q.text} for q in questions],
            "recipients": [{"id": p.id, "name": p.name} for p in matched[:5]],
            "comment_prompt": DEFAULT_COMMENT_PROMPT,
            "company_context_id": company_context_id,
            "created_at": now_iso(),
            "generation_mode": mode,
        },
    }
