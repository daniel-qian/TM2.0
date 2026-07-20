# -*- coding: utf-8 -*-
"""feat-053 — the account seam (Supabase user -> company context) over real HTTP, fully offline.

WHAT THIS PROVES (PRD G1 验收: 两个账号各自登录只见自己公司的人/项目；换账号数据不串):
  * a signed-in uploader's context is bound to their account at /ingest, and the account header
    ALONE (no owner_token) then reads it — the "log in on a new device" path;
  * account B presenting a perfectly valid session gets 404 on account A's context, on EVERY read
    path — the actual isolation claim;
  * the guest path is untouched: no account header anywhere still ingests and reads by owner_token,
    because gating that would put the whole demo behind a login wall;
  * claiming an anonymous context requires its owner_token, is idempotent for the owner, and 404s
    (never 403, never a distinct body) for a wrong token / another account's context — feat-038's
    no-existence-oracle discipline extended to the new surface;
  * with SUPABASE_* unset the whole layer is DORMANT — account headers are ignored rather than
    fatal, so a keyless deploy behaves exactly as it did pre-053.

Supabase itself is never contacted: `service.account.verify_access_token` is the seam, stubbed to a
fixed token->user map. That is the honest boundary — token VERIFICATION is Supabase's job (and is
exercised against the real thing only when keys exist); what this suite owns is everything we built
ON TOP of a verified user id. Mock brain / keyword recall / heuristic extractor / NO database, so it
lands in the default zero-network suite.
"""
from __future__ import annotations

import time
from pathlib import Path

import pytest

pytest.importorskip("fastapi.testclient")
from fastapi.testclient import TestClient  # noqa: E402

HERE = Path(__file__).resolve().parent.parent
FIX = HERE / "tests" / "fixtures" / "ingest"
HANDBOOK = FIX / "Studio_Handbook.md"
ROSTER = FIX / "Team_Roster.xlsx"

# The stubbed session table: access token -> Supabase user id.
TOKEN_A = "sb-access-token-alice"
TOKEN_B = "sb-access-token-bob"
USER_A = "11111111-1111-4111-8111-111111111111"
USER_B = "22222222-2222-4222-8222-222222222222"
_USERS = {TOKEN_A: USER_A, TOKEN_B: USER_B}


@pytest.fixture()
def client(monkeypatch):
    """Fully-offline app with the account layer CONFIGURED but Supabase stubbed out."""
    monkeypatch.setenv("AVERY_BRAIN", "mock")
    monkeypatch.setenv("AVERY_EMBEDDINGS", "keyword")
    monkeypatch.setenv("AVERY_EXTRACTOR", "heuristic")
    monkeypatch.delenv("AVERY_DB_URL", raising=False)
    monkeypatch.delenv("PGVECTOR_URL", raising=False)
    monkeypatch.delenv("AVERY_ALLOW_PERSON_SCORING", raising=False)
    # Configured => account.auth_configured() is True; verification itself is stubbed below.
    monkeypatch.setenv("SUPABASE_URL", "https://stub.supabase.co")
    monkeypatch.setenv("SUPABASE_ANON_KEY", "stub-anon-key")

    from service import account
    account.reset_cache()
    monkeypatch.setattr(account, "verify_access_token", lambda tok: _USERS.get(tok or ""))

    from avery.ingest.registry import REGISTRY
    REGISTRY.clear()
    from service.app import app
    with TestClient(app) as c:
        yield c
    REGISTRY.clear()
    account.reset_cache()


def _acct(token: str) -> dict:
    """The account header — a Supabase access token, header-only, never a URL param."""
    return {"X-Avery-Account": token}


def _ingest(client, headers: dict | None = None):
    """Upload a company; return the full payload."""
    files = [("files", (p.name, p.read_bytes(), "application/octet-stream"))
             for p in (HANDBOOK, ROSTER)]
    res = client.post("/ingest", files=files, headers=headers or {})
    assert res.status_code == 200, res.text
    return res.json()


def _read_paths(context_id: str) -> list[str]:
    """Every owner-gated read path for a context (the surface an IDOR would open)."""
    return [f"/team/{context_id}",
            f"/team/{context_id}/notes",
            f"/team/{context_id}/files",
            f"/team/{context_id}/files/0"]


# ── the acceptance criterion: two accounts, no crossing ─────────────────────────────────────────

def test_signed_in_ingest_binds_the_context_and_the_account_alone_can_read_it(client):
    """A signed-in upload links on the way out, and the account header alone (NO owner_token) then
    authorizes every read — the whole point: sign in elsewhere, your company is still there."""
    payload = _ingest(client, _acct(TOKEN_A))
    assert payload.get("account_linked") is True
    cid = payload["context_id"]

    for path in _read_paths(cid):
        res = client.get(path, headers=_acct(TOKEN_A))
        assert res.status_code == 200, f"{path} -> {res.status_code} {res.text[:200]}"

    # ...and the account is enough for /advise over that context too.
    res = client.post("/advise", json={"situation": "How is the team doing?",
                                       "company_context_id": cid, "stream": False},
                      headers=_acct(TOKEN_A))
    assert res.status_code == 200, res.text


def test_another_account_cannot_read_my_company_on_any_path(client):
    """两个账号各自登录只见自己公司 — B holds a perfectly valid session and still gets 404 on A's
    context, on every read path AND on /advise. This is the isolation claim itself."""
    cid_a = _ingest(client, _acct(TOKEN_A))["context_id"]

    for path in _read_paths(cid_a):
        res = client.get(path, headers=_acct(TOKEN_B))
        assert res.status_code == 404, f"{path} leaked to another account: {res.status_code}"

    res = client.post("/advise", json={"situation": "What is going on?",
                                       "company_context_id": cid_a, "stream": False},
                      headers=_acct(TOKEN_B))
    assert res.status_code == 404


def test_two_accounts_each_see_only_their_own_context_listing(client):
    """换账号数据不串 — each account's /account/contexts lists its own ids and nothing else."""
    cid_a = _ingest(client, _acct(TOKEN_A))["context_id"]
    cid_b = _ingest(client, _acct(TOKEN_B))["context_id"]
    assert cid_a != cid_b

    a = client.get("/account/contexts", headers=_acct(TOKEN_A)).json()["context_ids"]
    b = client.get("/account/contexts", headers=_acct(TOKEN_B)).json()["context_ids"]
    assert a == [cid_a]
    assert b == [cid_b]
    assert cid_b not in a and cid_a not in b


def test_a_valid_session_does_not_unlock_an_anonymous_context(client):
    """Signing in must not hand you a workspace nobody claimed. An anonymous context is owned by no
    account, so the account path never resolves it — only its owner_token does."""
    cid = _ingest(client)["context_id"]          # no account header -> anonymous
    for path in _read_paths(cid):
        assert client.get(path, headers=_acct(TOKEN_A)).status_code == 404


# ── the guest path must keep working (a login wall here = the feature is a regression) ──────────

def test_guest_ingest_and_read_still_work_with_no_account_at_all(client):
    """No account header anywhere: ingest succeeds, is NOT linked, and the owner_token reads it.
    This is the `?v=2&mode=live` direct link everyone else validates against."""
    payload = _ingest(client)
    assert "account_linked" not in payload
    cid, token = payload["context_id"], payload["owner_token"]
    for path in _read_paths(cid):
        res = client.get(path, headers={"X-Avery-Token": token})
        assert res.status_code == 200, f"{path} -> {res.status_code}"


def test_owner_token_still_reads_a_claimed_context(client):
    """Claiming must not REVOKE the owner_token — the uploader's own browser keeps working after
    they sign up, or signing up would log them out of their own workspace."""
    payload = _ingest(client, _acct(TOKEN_A))
    cid, token = payload["context_id"], payload["owner_token"]
    res = client.get(f"/team/{cid}", headers={"X-Avery-Token": token})
    assert res.status_code == 200


# ── the ask surface: the same account branch, or "sign in elsewhere" stops at asking ───────────
#
# 07-20 生产实测（progress.md Blockers 3）：换设备登录后团队 / 笔记 / 文件全 200，一发问就
# 「找不到这家公司」。根因是五个 manager 端点只解析 owner_token，压根不收 X-Avery-Account
# ——而换设备的浏览器手上没有 owner_token（那枚 token 服务端只返一次，留在上传那台机器上）。
#
# 🔴 为什么读端点全绿也盖不住这条：`_read_paths` 一个 /ask 都没有。一整条 manager 生命周期
# （建/改/发/查/撤）此前从未被账号支路的任何一条测试行使过——门看的那一屏，恰好是缺陷不在
# 的那一屏，与 07-20 纯度门那条同一结构类。

def _draft_body(cid: str) -> dict:
    """一份干净的 ask 草稿（问的是工作本身，永不给人打分——两层红线门照跑）。"""
    return {
        "company_context_id": cid,
        "questions": [
            {"kind": "scale",
             "text": "How confident are you that the pilot launch lands on the current date?"},
        ],
        "recipients": [{"id": "p1", "name": "Lena Park"}],
        "comment_prompt": "Anything to add, in one line?",
        "thread_hint": "the pilot launch date",
    }


def test_signed_in_account_alone_drives_the_whole_ask_lifecycle(client):
    """换设备登录后「快问一句」必须能用：账号 header 一个人（**没有 owner_token**）走完
    建 → 改 → 发 → 查 → 撤。这正是读端点已经做到、而 ask 端点做不到的那件事。"""
    cid = _ingest(client, _acct(TOKEN_A))["context_id"]
    acct = _acct(TOKEN_A)

    created = client.post("/ask", json=_draft_body(cid), headers=acct)
    assert created.status_code == 200, \
        f"POST /ask with the account header alone -> {created.status_code} {created.text[:200]}"
    ask_id = created.json()["id"]

    saved = client.post(f"/ask/{ask_id}", json=_draft_body(cid), headers=acct)
    assert saved.status_code == 200, f"POST /ask/{{id}} -> {saved.status_code} {saved.text[:200]}"

    shared = client.post(f"/ask/{ask_id}/share", headers=acct)
    assert shared.status_code == 200, f"share -> {shared.status_code} {shared.text[:200]}"

    got = client.get(f"/ask/{ask_id}", headers=acct)
    assert got.status_code == 200, f"GET /ask/{{id}} -> {got.status_code} {got.text[:200]}"

    revoked = client.post(f"/ask/{ask_id}/revoke", headers=acct)
    assert revoked.status_code == 200, f"revoke -> {revoked.status_code} {revoked.text[:200]}"
    assert revoked.json()["status"] == "revoked"


def test_another_account_cannot_touch_my_ask_on_any_path(client):
    """账号支路只许**加宽**到自己名下的公司。B 手持完全有效的会话，对 A 的 ask 每条路径都
    404（与未知 id 同一个 404，不做存在性预言机）。"""
    cid_a = _ingest(client, _acct(TOKEN_A))["context_id"]
    ask_id = client.post("/ask", json=_draft_body(cid_a),
                         headers=_acct(TOKEN_A)).json()["id"]

    b = _acct(TOKEN_B)
    assert client.post("/ask", json=_draft_body(cid_a), headers=b).status_code == 404
    assert client.post(f"/ask/{ask_id}", json=_draft_body(cid_a), headers=b).status_code == 404
    assert client.post(f"/ask/{ask_id}/share", headers=b).status_code == 404
    assert client.get(f"/ask/{ask_id}", headers=b).status_code == 404
    assert client.post(f"/ask/{ask_id}/revoke", headers=b).status_code == 404


def test_a_valid_session_does_not_unlock_asks_on_an_anonymous_context(client):
    """匿名 context 不归任何账号 —— 登录本身不该把它变成你的，ask 面同读面一样。"""
    payload = _ingest(client)                      # 无账号 header -> 匿名
    cid, token = payload["context_id"], payload["owner_token"]
    ask_id = client.post("/ask", json=_draft_body(cid),
                         headers={"X-Avery-Token": token}).json()["id"]

    assert client.post("/ask", json=_draft_body(cid), headers=_acct(TOKEN_A)).status_code == 404
    assert client.get(f"/ask/{ask_id}", headers=_acct(TOKEN_A)).status_code == 404


def test_owner_token_alone_still_drives_the_ask_lifecycle(client):
    """游客路径一个字不许动：没有任何账号 header 时，owner_token 照旧走完整条生命周期。
    这是 `?v=2&mode=live` 直链所有人验的那条路。"""
    payload = _ingest(client)
    cid, token = payload["context_id"], payload["owner_token"]
    tok = {"X-Avery-Token": token}

    ask_id = client.post("/ask", json=_draft_body(cid), headers=tok).json()["id"]
    assert client.post(f"/ask/{ask_id}", json=_draft_body(cid), headers=tok).status_code == 200
    assert client.post(f"/ask/{ask_id}/share", headers=tok).status_code == 200
    assert client.get(f"/ask/{ask_id}", headers=tok).status_code == 200
    assert client.post(f"/ask/{ask_id}/revoke", headers=tok).status_code == 200


def test_the_ask_account_token_in_the_url_does_not_authorize(client):
    """🔴 凭据只走 header。把 access token 塞进 query 必须一无所获（与 feat-053 读面同一条
    不变量，此处对 ask 面重申——两处各有一份，删掉任何一处都不该让另一处变绿）。"""
    cid = _ingest(client, _acct(TOKEN_A))["context_id"]
    res = client.post(f"/ask?account={TOKEN_A}", json=_draft_body(cid))
    assert res.status_code == 404


def test_every_owner_token_endpoint_also_accepts_the_account_header(client):
    """结构门：**凡是收 owner_token 的端点，必须同时收 X-Avery-Account。**

    Blockers 3 不是一个端点漏了，是一整族（五个）漏了两天——因为账号支路是逐个端点手写的，
    而"有没有写"这件事此前只能靠人逐个数。这条用 FastAPI 的路由签名把它变成机器判据：
    新加第六个 manager 端点时忘了接账号支路，这里当场红，不必等下一个换设备的客户来报。

    判据取 `x_avery_token`（owner_token 的 header 参数名）而不是路径前缀——按 `/ask` 之类的
    前缀列白名单，正是"列举会漂"那条老账：加一个新前缀，门自己就绕过去了。
    """
    import inspect
    from service.app import app

    missing: list[str] = []
    for route in app.routes:
        endpoint = getattr(route, "endpoint", None)
        if endpoint is None:
            continue
        params = inspect.signature(endpoint).parameters
        if "x_avery_token" not in params:
            continue        # 不是 owner_token 门后的端点（H5 走 share_token，不在此列）
        if "x_avery_account" not in params:
            missing.append(f"{sorted(getattr(route, 'methods', []) or [])} {route.path}")
    assert not missing, (
        "这些端点收 owner_token 却不收 X-Avery-Account —— 换设备登录的经理到这里就会 404：\n  "
        + "\n  ".join(missing))


def test_account_layer_is_dormant_when_supabase_is_unconfigured(monkeypatch):
    """Keys absent => the layer switches OFF rather than failing: /account/status says so, account
    headers are ignored, and the guest path is untouched. A deploy with no Supabase project still
    runs the product."""
    monkeypatch.setenv("AVERY_BRAIN", "mock")
    monkeypatch.setenv("AVERY_EMBEDDINGS", "keyword")
    monkeypatch.setenv("AVERY_EXTRACTOR", "heuristic")
    monkeypatch.delenv("AVERY_DB_URL", raising=False)
    monkeypatch.delenv("PGVECTOR_URL", raising=False)
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.delenv("SUPABASE_ANON_KEY", raising=False)
    from service import account
    account.reset_cache()
    from avery.ingest.registry import REGISTRY
    REGISTRY.clear()
    from service.app import app
    with TestClient(app) as c:
        status = c.get("/account/status").json()
        assert status == {"configured": False, "signed_in": False}
        # An account header is simply ignored — not an error.
        payload = _ingest(c, _acct(TOKEN_A))
        assert "account_linked" not in payload
        cid, token = payload["context_id"], payload["owner_token"]
        assert c.get(f"/team/{cid}", headers={"X-Avery-Token": token}).status_code == 200
        # ...and account endpoints refuse rather than pretending.
        assert c.get("/account/contexts", headers=_acct(TOKEN_A)).status_code == 401
    REGISTRY.clear()


# ── claim: the anonymous-context adoption path ──────────────────────────────────────────────────

def test_claim_adopts_an_anonymous_context_and_is_idempotent(client):
    """The guest-then-sign-up story: upload anonymously, make an account, claim what you built."""
    payload = _ingest(client)
    cid, token = payload["context_id"], payload["owner_token"]
    assert client.get(f"/team/{cid}", headers=_acct(TOKEN_A)).status_code == 404   # not yet mine

    res = client.post("/account/claim", json={"context_id": cid, "owner_token": token},
                      headers=_acct(TOKEN_A))
    assert res.status_code == 200, res.text
    assert res.json() == {"context_id": cid, "claimed": True}

    assert client.get(f"/team/{cid}", headers=_acct(TOKEN_A)).status_code == 200
    assert client.get("/account/contexts", headers=_acct(TOKEN_A)).json()["context_ids"] == [cid]

    # Re-claiming my own context is a no-op success, not a conflict.
    again = client.post("/account/claim", json={"context_id": cid, "owner_token": token},
                        headers=_acct(TOKEN_A))
    assert again.status_code == 200


def test_claim_without_the_owner_token_is_refused_with_no_oracle(client):
    """A wrong token, and an unknown id, must produce the SAME 404 body — a signed-in attacker must
    not be able to probe which context ids exist."""
    cid = _ingest(client)["context_id"]

    wrong = client.post("/account/claim",
                        json={"context_id": cid, "owner_token": "not-the-token"},
                        headers=_acct(TOKEN_A))
    unknown = client.post("/account/claim",
                          json={"context_id": "ctx_does_not_exist",
                                "owner_token": "not-the-token"},
                          headers=_acct(TOKEN_A))
    assert wrong.status_code == 404 and unknown.status_code == 404
    # Same SHAPE of answer (each names the id it was asked about, and nothing else).
    assert wrong.json() == {"detail": f"unknown company_context_id: {cid}"}
    assert unknown.json() == {"detail": "unknown company_context_id: ctx_does_not_exist"}
    # ...and nothing was linked.
    assert client.get("/account/contexts", headers=_acct(TOKEN_A)).json()["context_ids"] == []


def test_a_second_account_cannot_steal_an_already_claimed_context(client):
    """Even holding the owner_token, B cannot bind A's context to B's account — one context has at
    most one owner account, and the refusal is the same opaque 404."""
    payload = _ingest(client)
    cid, token = payload["context_id"], payload["owner_token"]
    assert client.post("/account/claim", json={"context_id": cid, "owner_token": token},
                       headers=_acct(TOKEN_A)).status_code == 200

    stolen = client.post("/account/claim", json={"context_id": cid, "owner_token": token},
                         headers=_acct(TOKEN_B))
    assert stolen.status_code == 404
    assert client.get("/account/contexts", headers=_acct(TOKEN_B)).json()["context_ids"] == []
    assert client.get(f"/team/{cid}", headers=_acct(TOKEN_B)).status_code == 404


def test_account_endpoints_require_a_session(client):
    """No/!valid session -> 401 (about the CALLER), distinct from the 404s about a context."""
    assert client.get("/account/contexts").status_code == 401
    assert client.get("/account/contexts", headers=_acct("garbage-token")).status_code == 401
    assert client.post("/account/claim",
                       json={"context_id": "ctx_x", "owner_token": "t"}).status_code == 401


def test_account_status_reports_the_session(client):
    assert client.get("/account/status").json() == {"configured": True, "signed_in": False}
    assert client.get("/account/status", headers=_acct(TOKEN_A)).json() == {
        "configured": True, "signed_in": True}


# ── the credential is header-only, and verification fails closed ────────────────────────────────

def test_account_token_in_the_url_does_not_authorize(client):
    """🔴 Same discipline as the owner_token: a credential in a URL leaks into Referer / access logs
    / CDN logs / browser history. Only the header counts."""
    cid = _ingest(client, _acct(TOKEN_A))["context_id"]
    assert client.get(f"/team/{cid}?account={TOKEN_A}").status_code == 404
    assert client.get(f"/team/{cid}?access_token={TOKEN_A}").status_code == 404


def test_extract_account_token_accepts_bare_and_bearer_forms():
    from service.account import extract_account_token
    assert extract_account_token("abc123") == "abc123"
    assert extract_account_token("Bearer abc123") == "abc123"
    assert extract_account_token("bearer   abc123  ") == "abc123"
    assert extract_account_token(None) is None
    assert extract_account_token("   ") is None
    assert extract_account_token("Bearer   ") is None


def test_verify_fails_closed_when_unconfigured(monkeypatch):
    """No keys => no user, without a network call. Every failure mode collapses to None so a
    verification outage can only ever DENY, never grant."""
    from service import account
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.delenv("SUPABASE_ANON_KEY", raising=False)
    account.reset_cache()
    assert account.auth_configured() is False
    assert account.verify_access_token("anything") is None
    assert account.resolve_account("Bearer anything") is None


def test_verify_fails_closed_on_a_supabase_error(monkeypatch):
    """Supabase unreachable / erroring => None (guest), never an exception into the handler."""
    from service import account
    monkeypatch.setenv("SUPABASE_URL", "https://stub.supabase.co")
    monkeypatch.setenv("SUPABASE_ANON_KEY", "stub-anon-key")
    account.reset_cache()

    import httpx

    def _boom(*a, **k):
        raise httpx.ConnectError("no network")

    monkeypatch.setattr(httpx, "get", _boom)
    assert account.verify_access_token("some-token") is None
    account.reset_cache()


# ── cache TTL is capped by the token's own exp (feat-053 复核 finding 3) ─────────────────────────
# The module docstring promises "a cached entry does NOT outlive the token". It used to be a lie:
# every verified token was cached for a flat 60s, so a token with 2s of life left kept authorizing
# reads for another 58. These tests hold the promise to the code.

def _jwt_with_exp(exp: float | None) -> str:
    """A structurally-real JWT whose payload carries `exp`. Never signed — nothing verifies it."""
    import base64 as _b64
    import json as _json

    def seg(obj: dict) -> str:
        raw = _json.dumps(obj).encode("utf-8")
        return _b64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")

    claims: dict = {"sub": USER_A}
    if exp is not None:
        claims["exp"] = exp
    return f"{seg({'alg': 'HS256', 'typ': 'JWT'})}.{seg(claims)}.not-a-real-signature"


def test_unverified_exp_reads_the_claim_without_a_signature():
    from service import account
    soon = time.time() + 42
    assert account._unverified_exp(_jwt_with_exp(soon)) == pytest.approx(soon)


@pytest.mark.parametrize("token", [
    "not-a-jwt",                  # opaque string
    "only.two",                   # wrong segment count
    "a.!!!not-base64!!!.c",       # undecodable payload
    _jwt_with_exp(None),          # valid JWT, no exp claim
])
def test_unverified_exp_is_none_for_anything_it_cannot_read(token):
    """Unreadable => None => fall back to the flat window. Never raises, never guesses."""
    from service import account
    assert account._unverified_exp(token) is None


def test_unverified_exp_rejects_a_non_numeric_exp():
    """`exp: true` is not an expiry — bool is an int subclass, so this needs its own guard, or
    `float(True)` would silently cap the cache at 1970."""
    import base64 as _b64
    import json as _json
    from service import account
    payload = _b64.urlsafe_b64encode(_json.dumps({"exp": True}).encode()).decode().rstrip("=")
    assert account._unverified_exp(f"h.{payload}.s") is None


def test_ttl_is_capped_by_a_short_lived_token():
    """The actual fix: 2 seconds left => cached for ~2 seconds, not for the flat 60."""
    from service import account
    ttl = account._cache_ttl_for(_jwt_with_exp(time.time() + 2))
    assert 0 < ttl <= 3, ttl


def test_ttl_falls_back_to_the_flat_window_for_a_long_lived_or_opaque_token():
    from service import account
    assert account._cache_ttl_for(_jwt_with_exp(time.time() + 86400)) == account._CACHE_TTL_S
    assert account._cache_ttl_for("opaque-token") == account._CACHE_TTL_S


def test_an_already_expired_token_is_never_remembered(monkeypatch):
    """Supabase said yes (so we answer this request), but we refuse to cache that answer: the very
    next request must re-ask rather than ride a dead token for the rest of the window."""
    from service import account
    monkeypatch.setenv("SUPABASE_URL", "https://stub.supabase.co")
    monkeypatch.setenv("SUPABASE_ANON_KEY", "stub-anon-key")
    account.reset_cache()

    expired = _jwt_with_exp(time.time() - 1)
    calls: list[str] = []

    class _Resp:
        status_code = 200

        @staticmethod
        def json() -> dict:
            return {"id": USER_A}

    import httpx

    def _fake_get(url, **kwargs):
        calls.append(url)
        return _Resp()

    monkeypatch.setattr(httpx, "get", _fake_get)
    assert account.verify_access_token(expired) == USER_A
    assert account.verify_access_token(expired) == USER_A
    assert len(calls) == 2, "an expired token must not be served from cache"

    # Control: a long-lived token IS cached, so the second call costs no round trip.
    calls.clear()
    fresh = _jwt_with_exp(time.time() + 3600)
    assert account.verify_access_token(fresh) == USER_A
    assert account.verify_access_token(fresh) == USER_A
    assert len(calls) == 1, "a live token should be cached"
    account.reset_cache()
