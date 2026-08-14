"""feat-053 — the account HTTP surface: which company does this signed-in user own, and how does
an anonymous workspace become theirs.

DESIGN (PRD G1: `Supabase user → 公司 context_id`, `owner_token` 保留在下层不动):
Supabase itself owns sign-up / sign-in / sign-out / session refresh — the browser talks to Supabase
directly with @supabase/supabase-js, and this service never sees a password and never mints a
session. All THIS layer does is answer two questions about an already-verified user:

  GET  /account/contexts   which company context(s) are mine? (the post-login restore path)
  POST /account/claim      make this anonymous context mine (proved by its owner_token)

WHY CLAIM RATHER THAN "sign in and start fresh" (the PRD's 二选一):
The guest path is mandatory — the demo must open without a login — so a manager will ALREADY have
uploaded documents and be looking at their team by the time they consider making an account. If
signing up created an empty context, the act of registering would throw away the work that just
convinced them to register. Claim keeps it. It also needs no new trust assumption: possession of the
owner_token is exactly the credential feat-038 already treats as proof of ownership, so "claim" is
"trade the credential you hold for a durable one you can log back in with" — not a new authority.

🔴 NO-EXISTENCE-ORACLE, same as feat-038: every claim failure (unknown context, wrong owner_token,
already owned by someone else) returns the SAME 404. A signed-in attacker must not be able to probe
which context ids exist, nor learn that a given id is already claimed.
"""
from __future__ import annotations

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from avery.ingest.registry import active_registry

from . import account
from .ingest_api import authorize_context, extract_owner_token

router = APIRouter()


class ClaimRequest(BaseModel):
    context_id: str = Field(..., min_length=1, description="The anonymous context to claim.")
    owner_token: str = Field(..., min_length=1,
                             description="That context's owner_token — the proof of ownership.")


def _require_account(x_avery_account: str | None) -> str:
    """The verified Supabase user id, or 401. Distinct from the 404s below on purpose: 'you are not
    signed in' is about the CALLER and leaks nothing about which contexts exist, whereas every
    question about a specific context answers 404. The client uses the 401 to know it should refresh
    its Supabase session rather than to conclude the workspace is gone."""
    user_id = account.resolve_account(x_avery_account)
    if not user_id:
        raise HTTPException(status_code=401, detail="not signed in")
    return user_id


@router.get("/account/status")
def account_status(x_avery_account: str | None = Header(None)) -> dict:
    """Is the account layer even switched on here, and is this caller signed in?

    Deliberately UNGATED and cheap: the frontend calls it to decide whether to show an account
    control at all. `configured: false` means this deploy has no Supabase keys — the client stays in
    guest mode and shows nothing, rather than offering a sign-in that could not possibly work.
    Returns no email and no token — only what the UI needs to pick a state."""
    configured = account.auth_configured()
    user_id = account.resolve_account(x_avery_account) if configured else None
    return {"configured": configured, "signed_in": bool(user_id)}


@router.get("/account/contexts")
def account_contexts(x_avery_account: str | None = Header(None)) -> dict:
    """This user's company context(s), newest first — the post-login restore path.

    Returns ONLY ids the caller owns, so it is not an enumeration surface. It does NOT return
    owner_tokens: an account-authorized caller never needs one (authorize_context takes the account
    path), and handing a long-lived credential back over an API is how tokens end up in logs.
    """
    user_id = _require_account(x_avery_account)
    reg = active_registry()
    listing = getattr(reg, "contexts_for_account", None)
    context_ids: list[str] = list(listing(user_id)) if listing is not None else []
    return {"context_ids": context_ids}


@router.post("/account/claim")
def account_claim(body: ClaimRequest, x_avery_account: str | None = Header(None)) -> dict:
    """Bind an anonymous context to this account, proving ownership with its owner_token.

    Order matters: verify the caller is signed in, THEN prove they hold the context's owner_token
    (via the unchanged feat-038 gate — a wrong token 404s there), and only then write the link. So a
    signed-in user cannot claim a context they never owned, and an owner_token holder cannot claim
    into someone else's account. Re-claiming your own context is idempotent.

    #100 · 认领不是「加入公司」的路径，而且这是个**产品决定**，不是遗留行为。一份档案现在挂得下
    多个成员账号（0020 退休了 0008 的唯一索引），所以「已有主人 → 拒绝」不再是库替我们做的判断
    —— 它现在是下面这行 `link(...)` 的默认参数 `allow_shared=False`。之所以保持拒绝（Danny 0814）：
    owner_token 是**设备级**凭据，不该当公司门票，任何翻到过那台电脑 localStorage 的人（离职员工、
    外包、修电脑的）否则都能把自己塞进这家公司，而且没有一个人会收到通知。加成员只走 admin 脚本
    `scripts/ops/link-account-context.py`，它是全仓唯一显式传 `allow_shared=True` 的调用点。"""
    user_id = _require_account(x_avery_account)
    reg = active_registry()
    # feat-038 gate, unchanged: proves possession of the owner_token. 404s on unknown id or bad token
    # with an identical body — no oracle. The owner_token is read from the BODY here rather than a
    # header because it is the subject of this call (the thing being traded in), not the credential
    # authorizing it; the account header is what authorizes.
    authorize_context(reg, body.context_id, body.owner_token.strip())
    link = getattr(reg, "link_account_context", None)
    if link is None or not link(user_id, body.context_id):
        # Already owned by a DIFFERENT account (or the registry refused). Same opaque 404 — a claim
        # probe must not reveal that this context exists and belongs to someone else.
        raise HTTPException(status_code=404,
                            detail=f"unknown company_context_id: {body.context_id}")
    return {"context_id": body.context_id, "claimed": True}
