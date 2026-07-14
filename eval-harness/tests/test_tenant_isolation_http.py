# -*- coding: utf-8 -*-
"""feat-038 — tenant isolation over the HTTP surface (agent as first user), fully offline.

THE critical IDOR the readiness register (§2-A) flagged as the whole-register's highest risk: before
feat-038, anyone holding a `context_id` could read a company's entire workspace — /team, /files,
/notes, /advise were ZERO-authorization. This suite is the born-red -> green gate for that hole, run
with mock brain / keyword recall / heuristic extractor / NO database, so it lands in the default
zero-network suite. The Postgres-side credential persistence + restart story is the @needs_db contract
in test_registry_contract.py and test_persistence_restart.py.

The behavior contract (agent drives real HTTP):
  * /ingest mints an unguessable owner_token (~256-bit, url-safe) and returns it to the uploader;
  * the holder (token_A) reads A's team / files / notes / advise -> 200;
  * a DIFFERENT company's token (token_B), NO token, or a WRONG token reading A -> 404 on EVERY read
    path (A can't see B, B can't read A);
  * the 404 for a wrong token on an EXISTING id is byte-identical to the 404 for an unknown id — no
    existence oracle (no 403 that would confirm "this id exists, you just lack the key");
  * the token rides a HEADER only (X-Avery-Token OR Authorization: Bearer); a token placed in the URL
    query string does NOT authorize (privacy: URLs leak into logs/history);
  * the /team refetch never echoes the token back;
  * the interactive docs (/docs, /redoc, /openapi.json) and the token-burning /advise/sample demo
    are removed (404).
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


@pytest.fixture()
def client(monkeypatch):
    """Fully-offline app: mock brain, keyword recall, heuristic extractor, NO DB — the in-memory
    registry, regardless of a developer's .env."""
    monkeypatch.setenv("AVERY_BRAIN", "mock")
    monkeypatch.setenv("AVERY_EMBEDDINGS", "keyword")
    monkeypatch.setenv("AVERY_EXTRACTOR", "heuristic")
    monkeypatch.delenv("AVERY_DB_URL", raising=False)
    monkeypatch.delenv("PGVECTOR_URL", raising=False)
    monkeypatch.delenv("AVERY_ALLOW_PERSON_SCORING", raising=False)
    from avery.ingest.registry import REGISTRY
    REGISTRY.clear()
    from service.app import app
    with TestClient(app) as c:
        yield c
    REGISTRY.clear()


def _ingest(client):
    """Upload a company; return (context_id, owner_token)."""
    files = [("files", (p.name, p.read_bytes(), "application/octet-stream"))
             for p in (HANDBOOK, ROSTER)]
    r = client.post("/ingest", files=files)
    assert r.status_code == 200, f"/ingest failed: {r.text[:300]}"
    body = r.json()
    return body["context_id"], body["owner_token"]


def _read_paths(cid: str) -> list[tuple[str, str, dict | None]]:
    """Every gated READ on context `cid`: (method, url, json-body-or-None)."""
    return [
        ("GET", f"/team/{cid}", None),
        ("GET", f"/team/{cid}/notes", None),
        ("GET", f"/team/{cid}/files", None),
        ("GET", f"/team/{cid}/files/0", None),
        ("POST", "/advise", {"situation": "List everyone and what they own.",
                             "company_context_id": cid, "stream": False}),
    ]


def _do(client, method: str, url: str, body, headers=None):
    if method == "GET":
        return client.get(url, headers=headers)
    return client.post(url, json=body, headers=headers)


# ==============================================================================================
# 1) The token exists, is unguessable, and is NOT echoed by the refetch
# ==============================================================================================

def test_ingest_mints_an_unguessable_owner_token(client):
    cidA, tokA = _ingest(client)
    cidB, tokB = _ingest(client)
    assert tokA and tokB, "/ingest must return an owner_token"
    assert tokA != tokB, "two companies must get DIFFERENT tokens"
    assert len(tokA) >= 32, f"token too short to be unguessable: {len(tokA)} chars"


def test_team_refetch_does_not_echo_the_token(client):
    cid, tok = _ingest(client)
    body = client.get(f"/team/{cid}", headers={"X-Avery-Token": tok}).json()
    assert "owner_token" not in body, "the /team refetch must NOT leak the token back to callers"


# ==============================================================================================
# 2) The holder can read everything (X-Avery-Token AND Authorization: Bearer)
# ==============================================================================================

def test_holder_reads_all_paths_with_x_avery_token(client):
    cid, tok = _ingest(client)
    for method, url, body in _read_paths(cid):
        r = _do(client, method, url, body, headers={"X-Avery-Token": tok})
        assert r.status_code == 200, f"holder was denied {method} {url}: {r.status_code} {r.text[:200]}"


def test_holder_reads_with_bearer_authorization(client):
    cid, tok = _ingest(client)
    r = client.get(f"/team/{cid}", headers={"Authorization": f"Bearer {tok}"})
    assert r.status_code == 200, "Authorization: Bearer <token> must be accepted"


# ==============================================================================================
# 3) BORN-RED core: a foreign token / no token / wrong token reads A -> 404 on EVERY path
# ==============================================================================================

def test_foreign_token_cannot_read_another_company(client):
    """B's token must not read A, and A's token must not read B (both directions of the IDOR)."""
    cidA, tokA = _ingest(client)
    cidB, tokB = _ingest(client)
    for method, url, body in _read_paths(cidA):
        r = _do(client, method, url, body, headers={"X-Avery-Token": tokB})
        assert r.status_code == 404, (
            f"CROSS-TENANT LEAK: company B's token read A via {method} {url} ({r.status_code})")
    # symmetric: A cannot read B either
    r = client.get(f"/team/{cidB}", headers={"X-Avery-Token": tokA})
    assert r.status_code == 404, "CROSS-TENANT LEAK: company A's token read B"


def test_no_token_is_refused_on_every_read_path(client):
    cid, _tok = _ingest(client)
    for method, url, body in _read_paths(cid):
        r = _do(client, method, url, body, headers=None)
        assert r.status_code == 404, f"read with NO token succeeded on {method} {url} ({r.status_code})"


def test_wrong_token_is_refused_on_every_read_path(client):
    cid, _tok = _ingest(client)
    for method, url, body in _read_paths(cid):
        r = _do(client, method, url, body, headers={"X-Avery-Token": "not-the-real-token"})
        assert r.status_code == 404, f"read with a WRONG token succeeded on {method} {url}"


# ==============================================================================================
# 4) No existence oracle: a wrong token on an EXISTING id is indistinguishable from an unknown id
# ==============================================================================================

def test_wrong_token_404_is_indistinguishable_from_unknown_id(client):
    """The refusal must be a 404 whose body is byte-identical to the unknown-id 404 for that same id
    — never a 403 (which would confirm 'this id exists, you just lack the token' — an enumeration
    oracle). The message echoes the id the CALLER sent (which they already know), so it leaks nothing
    about whether that id is real."""
    cid, _tok = _ingest(client)
    wrong = client.get(f"/team/{cid}", headers={"X-Avery-Token": "wrong"})
    # what a truly-unknown id returns (with the same made-up id substituted into the template)
    ghost_id = "ctx_this_id_was_never_registered"
    unknown = client.get(f"/team/{ghost_id}", headers={"X-Avery-Token": "wrong"})
    assert wrong.status_code == unknown.status_code == 404
    assert wrong.json() == {"detail": f"unknown company_context_id: {cid}"}
    assert unknown.json() == {"detail": f"unknown company_context_id: {ghost_id}"}
    # Same shape/status/template on both -> no 403, no distinct "forbidden" body -> no oracle.


# ==============================================================================================
# 5) Header-only transport: a token in the URL query string does NOT authorize
# ==============================================================================================

def test_token_in_query_string_does_not_authorize(client):
    """Privacy rule: the token must ride a header, never the URL (query strings leak into access
    logs / Referer / browser history). A token supplied only as ?token=... must be ignored -> 404."""
    cid, tok = _ingest(client)
    r = client.get(f"/team/{cid}?token={tok}")
    assert r.status_code == 404, "a URL-query token authorized a read — the token must be header-only"
    r2 = client.get(f"/team/{cid}?owner_token={tok}&X-Avery-Token={tok}")
    assert r2.status_code == 404, "a URL-query token authorized a read — the token must be header-only"


# ==============================================================================================
# 6) Attack-surface reduction: interactive docs + the token-burning sample demo are gone
# ==============================================================================================

def test_interactive_docs_are_closed(client):
    for path in ("/docs", "/redoc", "/openapi.json"):
        assert client.get(path).status_code == 404, f"{path} must be closed (readiness §2-A)"


def test_advise_sample_is_removed(client):
    assert client.get("/advise/sample").status_code == 404, (
        "/advise/sample (unauth, token-burning) must be taken down")


# ==============================================================================================
# 7) The legitimate demo default is untouched: no context_id -> no token required
# ==============================================================================================

def test_demo_advise_without_a_context_needs_no_token(client):
    r = client.post("/advise", json={"situation": "How do I run a calm 1:1?", "stream": False})
    assert r.status_code == 200, "the no-context demo default must still work without any token"


# ==============================================================================================
# 12) feat-038 hardening: an empty/NULL owner_token FAILS CLOSED on the persistent (DB) registry,
#     while the in-memory registry keeps the empty-token back-compat (test/direct-caller seam).
# ==============================================================================================

import os  # noqa: E402


def _db_url() -> str | None:
    return (os.environ.get("AVERY_DB_URL") or os.environ.get("PGVECTOR_URL") or "").strip() or None


def test_inmemory_empty_token_stays_backcompat(monkeypatch, tmp_path):
    """The in-memory registry is a test/direct-caller seam, not a served path: an empty owner_token
    keeps the pre-038 no-token back-compat (authorize returns the context)."""
    from fastapi import HTTPException  # noqa: F401
    from service.ingest_api import authorize_context
    from avery.ingest.registry import ContextRegistry, CompanyContext, materialize_memory, new_context_id
    from avery.ingest.extract import ExtractionResult
    from avery.ingest.store import KeywordStore

    reg = ContextRegistry()
    ex = ExtractionResult(people=[], projects=[], signals=[], materials=[])
    d = tmp_path / "mem"; materialize_memory(ex, d)
    cid = new_context_id()
    reg.put(CompanyContext(context_id=cid, extraction=ex, store=KeywordStore(),
                           memory_dir=d, name="legacy", owner_token=""))
    assert getattr(reg, "persistent", False) is False
    # empty token + no caller token -> back-compat: returns the context (no raise).
    assert authorize_context(reg, cid, None).context_id == cid


@pytest.mark.needs_db
def test_persistent_empty_token_fails_closed(tmp_path):
    """A DB-backed context whose owner_token is NULL/empty is NEVER world-readable over the API:
    authorize_context must raise 404 on the persistent registry even though the context exists."""
    url = _db_url()
    if not url:
        pytest.skip("needs AVERY_DB_URL (or PGVECTOR_URL)")
    import psycopg
    from fastapi import HTTPException
    from service.ingest_api import authorize_context
    from avery.ingest.pg_registry import PostgresContextRegistry
    from avery.ingest.registry import CompanyContext, materialize_memory, new_context_id
    from avery.ingest.extract import ExtractionResult
    from avery.ingest.store import KeywordStore

    reg = PostgresContextRegistry(url, data_dir=tmp_path / "pgdata")
    assert getattr(reg, "persistent", False) is True
    ex = ExtractionResult(people=[], projects=[], signals=[], materials=[])
    d = tmp_path / "pgmem"; materialize_memory(ex, d)
    cid = new_context_id()
    # Persist a real context (mints/holds a token), then force the DB row's token to NULL (legacy state).
    reg.put(CompanyContext(context_id=cid, extraction=ex, store=KeywordStore(),
                           memory_dir=d, name="legacy", owner_token="tok_placeholder"))
    try:
        with psycopg.connect(url) as conn:
            conn.execute("UPDATE avery.contexts SET owner_token = NULL WHERE context_id = %s", (cid,))
        # get() maps NULL -> "" ; authorize must FAIL CLOSED (404), not return the context.
        with pytest.raises(HTTPException) as ei:
            authorize_context(reg, cid, None)
        assert ei.value.status_code == 404
        # and even a (any) supplied token is refused when the stored token is empty.
        with pytest.raises(HTTPException) as ei2:
            authorize_context(reg, cid, "anything")
        assert ei2.value.status_code == 404
    finally:
        reg.delete(cid)
