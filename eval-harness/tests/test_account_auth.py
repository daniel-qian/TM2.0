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
