# -*- coding: utf-8 -*-
"""7/25 demo hardening — adversarial battery, ROUND 2: the matrix cases the parse-crash battery
(test_adversarial_parse_crash_battery.py) does not cover, and the existing suites
(test_upload_hardgate_http.py, test_tenant_isolation_http.py, test_token_oracle_nonascii.py,
test_file_truth_encoding.py, test_decode_never_invents.py) do not already pin.

Every test here is a REGULAR (non-xfail) assertion: it documents behavior that IS already correct,
closing gaps in what is checked rather than finding a new crash. Where the backend's honest answer
could plausibly be read as "phantom success", the assertion is on the SHAPE (manifest status, no
leaked token, no oracle) that proves it is not.

Covers, against the ADVERSARIAL MATRIX brief:
  * (6)  empty / whitespace-only file  -> manifest says 'empty', never 'ingested'
  * (9)  cross-tenant on /ask          -> the SAME authorize_context 404 the read paths get,
                                          extending test_tenant_isolation_http.py's coverage to a
                                          WRITE endpoint that suite does not touch
  * (10) a genuinely disguised binary (.docx that is really an .exe stub) -> 415, and the message
         is NOT confused with the password-protected-OLE2 message (upload_guard.py:308-320)
  * (11) duplicate submit -> two independent contexts/tokens; documents the owner_token-lost hazard
  * (12) all-unparseable batch -> 422 AND the registry gains zero new contexts (extends
         test_file_truth_encoding.py's 422-body assertion with the registry-side check)
  * (13) NUL in a text file: near the start -> 415 disguised-binary (guards.check_type's OWN 8192-
         byte head window catches it, so it never reaches parse/scrub at all); PAST that window ->
         200, no crash, and the NUL is scrubbed OUT of the citable corpus (avery/ingest/parse.py's
         `_C0_CONTROL_RE`) before it could ever be quoted back to a manager. The existing unit test
         (test_ingest.py::test_parse_strips_nul_and_c0_control_chars) proves the scrub at the
         parse_bytes() level; this file proves it holds over the REAL HTTP path end to end.
"""
from __future__ import annotations

from pathlib import Path

import pytest

pytest.importorskip("fastapi.testclient")
from fastapi.testclient import TestClient  # noqa: E402

HERE = Path(__file__).resolve().parent.parent


def _reset_all():
    from avery.ingest.registry import REGISTRY
    from service import upload_guard, llm_budget, mem_sentinel
    REGISTRY.clear()
    upload_guard.reset_rate_limiter()
    llm_budget.reset()
    mem_sentinel.reset()


@pytest.fixture()
def client(monkeypatch):
    """Fully-offline app: mock brain, keyword recall, heuristic extractor, NO DB — the in-memory
    registry regardless of a developer's .env (same fixture shape as the sibling adversarial/tenant
    suites)."""
    monkeypatch.setenv("AVERY_BRAIN", "mock")
    monkeypatch.setenv("AVERY_EMBEDDINGS", "keyword")
    monkeypatch.setenv("AVERY_EXTRACTOR", "heuristic")
    monkeypatch.delenv("AVERY_DB_URL", raising=False)
    monkeypatch.delenv("PGVECTOR_URL", raising=False)
    _reset_all()
    from service.app import app
    with TestClient(app) as c:
        yield c
    _reset_all()


def _registry():
    from avery.ingest.registry import REGISTRY
    return REGISTRY


# ==================================================================================================
# (6) Empty file / whitespace-only file: a context CAN be created (feat-032's honest 'empty' status
#     already exists for this), but it must never be dressed up as 'ingested' — that would be the
#     product speaking for the customer about a file it demonstrably did not read anything from.
# ==================================================================================================

def test_empty_file_alone_manifest_says_empty_not_ingested(client):
    r = client.post("/ingest", files=[("files", ("empty.txt", b"", "text/plain"))])
    assert r.status_code == 200, (
        f"an empty file is not itself an error — a 5xx/4xx here would be over-eager: {r.text[:200]}")
    body = r.json()
    manifest = client.get(f"/team/{body['context_id']}/files",
                          headers={"X-Avery-Token": body["owner_token"]})
    assert manifest.status_code == 200
    entry = manifest.json()["files"][0]
    assert entry["status"] == "empty", (
        f"a 0-byte upload must be manifest-status 'empty', never 'ingested' (phantom success): "
        f"{entry}")
    assert entry["n_chunks"] == 0
    assert body["people"] == [] and body["projects"] == [], (
        "an empty upload must not conjure people/projects out of nothing")


def test_whitespace_only_file_alone_manifest_says_empty_not_ingested(client):
    r = client.post("/ingest", files=[("files", ("ws.txt", b"   \n\t \n  ", "text/plain"))])
    assert r.status_code == 200, r.text[:200]
    body = r.json()
    manifest = client.get(f"/team/{body['context_id']}/files",
                          headers={"X-Avery-Token": body["owner_token"]})
    entry = manifest.json()["files"][0]
    assert entry["status"] == "empty", (
        f"whitespace-only content must normalize to empty and be marked 'empty', not 'ingested': "
        f"{entry}")
    assert entry["size_bytes"] > 0, "the manifest must still report the TRUE byte size uploaded"


# ==================================================================================================
# (11) Duplicate submit: two /ingest calls with byte-identical content mint two fully independent
#      contexts and tokens — there is no dedup, no idempotency key. Documented here as a HAZARD, not
#      a bug: if a caller re-uploads (retry after a dropped response, a second browser tab, ...) and
#      only keeps the SECOND owner_token, the first context still exists but is now unreachable by
#      anyone who lost that token — an orphaned, silently-inaccessible copy of the same data. That is
#      a real support-ticket shape for 7/25 ("I uploaded twice, now I only see one"), not a security
#      hole (cross-tenant isolation still holds, asserted below).
# ==================================================================================================

def test_duplicate_submit_mints_two_independent_contexts_and_tokens(client):
    body = (b"Weekly note: the onboarding backlog keeps landing on one squad and needs "
            b"rebalancing across the pod. This line is long enough to chunk on its own merit.\n")
    r1 = client.post("/ingest", files=[("files", ("note.txt", body, "text/plain"))])
    r2 = client.post("/ingest", files=[("files", ("note.txt", body, "text/plain"))])
    assert r1.status_code == 200 and r2.status_code == 200
    b1, b2 = r1.json(), r2.json()
    assert b1["context_id"] != b2["context_id"], "byte-identical uploads must NOT collapse into one"
    assert b1["owner_token"] != b2["owner_token"], "each ingest must mint its OWN owner_token"
    # the hazard is not a leak: token 1 still cannot open context 2 (isolation holds across the
    # "looks like the same upload" case, same as any other two tenants).
    cross = client.get(f"/team/{b2['context_id']}", headers={"X-Avery-Token": b1["owner_token"]})
    assert cross.status_code == 404, "duplicate content must not create a shared/aliased token"


# ==================================================================================================
# (12) All-unparseable batch: extends test_file_truth_encoding.py's 422-body assertion with the
#      registry-side check the brief specifically asks for — a batch that cannot be read at all must
#      leave ZERO trace in the registry, not just answer 422 while quietly keeping something.
# ==================================================================================================

def test_all_unparseable_batch_registers_no_context_and_mints_no_token(client):
    reg = _registry()
    before = len(reg._by_id)
    junk = bytes([0x80, 0x81, 0x8D, 0x90, 0x9D, 0xFF, 0xFE, 0x81]) * 4   # undecodable in every rung
    r = client.post("/ingest", files=[("files", ("坏文件.csv", junk, "text/csv"))])
    assert r.status_code == 422, r.text[:300]
    assert len(reg._by_id) == before, (
        "an all-unparseable batch must register NO context at all (feat-032 P2) — anything left "
        "behind here is an unreachable phantom (no token was returned for a caller to use it)")
    assert "owner_token" not in r.json(), "a 422 must never mint a token for content nobody can read"


# ==================================================================================================
# (10) A genuinely disguised binary — a .docx that is really an .exe/PE-shaped stub, the drag-drop-
#      bypasses-the-picker's-accept-filter case named in the brief. Must be 415, and — the sharper
#      assertion — must NOT reuse the password-protected-OLE2 wording (upload_guard.py:308-320),
#      which would falsely accuse an honestly-encrypted file's message of applying here, or (read the
#      other way) falsely tell a genuine forger that their disguise "just needs a password".
# ==================================================================================================

FAKE_EXE_AS_DOCX = (b"MZ\x90\x00\x03\x00\x00\x00\x04\x00\x00\x00\xff\xff\x00\x00\xb8\x00\x00\x00"
                    + bytes(range(256)) * 2)   # PE/DOS stub magic + arbitrary binary tail


def test_renamed_executable_as_docx_is_415_and_not_confused_with_password_protection(client):
    r = client.post("/ingest", files=[
        ("files", ("resume.docx", FAKE_EXE_AS_DOCX, "application/octet-stream"))])
    assert r.status_code == 415, f"an .exe renamed .docx must be refused: {r.status_code} {r.text[:200]}"
    detail = str(r.json()).lower()
    assert "password" not in detail, (
        f"a disguised executable must not be told it 'just' needs a password removed: {detail}")
    assert "office" in detail or "magic" in detail or "zip" in detail, (
        f"the refusal must say WHY (not an Office/zip file), not just refuse silently: {detail}")


# ==================================================================================================
# (9) Cross-tenant on /ask — the write-side gate. test_tenant_isolation_http.py's _read_paths and
#     test_token_oracle_nonascii.py's malformed-token matrix both stop at /team* + /advise; /ask
#     (service/ask_api.py) reuses the SAME authorize_context primitive (ask_api.py:46,306) but is a
#     WRITE endpoint (it creates a shareable ask on the company's behalf) and was not itself exercised
#     by either suite. Confirms the same no-oracle 404 holds here too.
# ==================================================================================================

def _ingest_one(client, name: str, body: bytes) -> tuple[str, str]:
    r = client.post("/ingest", files=[("files", (name, body, "text/plain"))])
    assert r.status_code == 200, r.text[:200]
    j = r.json()
    return j["context_id"], j["owner_token"]


def test_cross_tenant_token_cannot_create_an_ask_on_a_foreign_context(client):
    bodyA = b"Company A weekly note: the launch backlog needs rebalancing across the pod today.\n"
    bodyB = b"Company B weekly note: a totally different team's onboarding backlog this week.\n"
    cidA, tokA = _ingest_one(client, "a.txt", bodyA)
    cidB, tokB = _ingest_one(client, "b.txt", bodyB)

    ask_body = {"company_context_id": cidA, "situation": "how is the team doing this week"}

    foreign = client.post("/ask", json=ask_body, headers={"X-Avery-Token": tokB})
    assert foreign.status_code == 404, (
        f"company B's token created/reached an ask on company A's context: {foreign.status_code} "
        f"{foreign.text[:200]}")

    no_token = client.post("/ask", json=ask_body)
    assert no_token.status_code == 404, f"an unauthenticated /ask on a real context: {no_token.status_code}"

    # no existence oracle: the foreign-token 404 and the truly-unknown-id 404 must be the same shape
    ghost = client.post("/ask", json={**ask_body, "company_context_id": "ctx_never_registered"},
                        headers={"X-Avery-Token": tokB})
    assert ghost.status_code == 404
    assert set(foreign.json()) == set(ghost.json()), (
        f"cross-tenant /ask and unknown-id /ask must be indistinguishable: "
        f"{foreign.json()} vs {ghost.json()}")


# ==================================================================================================
# (13) NUL bytes in a text file: two positions, two honest (crash-free) outcomes.
# ==================================================================================================

def test_nul_near_the_start_of_a_text_file_is_415_disguise_not_a_crash(client):
    """Within guards.check_type's own 8192-byte head window (guards.py:115,125-126), a NUL is treated
    as positive evidence of a disguised binary and refused BEFORE parse ever runs — a deliberate,
    documented decision (not a bug): a stray NUL that early in a 'text' file is a stronger signal of
    'this is not text' than of 'a PDF/xlsx text layer leaked one byte'."""
    body = b"Alice\x00 owns onboarding revamp work here for testing purposes in this batch today\n"
    r = client.post("/ingest", files=[("files", ("dirty.txt", body, "text/plain"))])
    assert r.status_code == 415, f"a NUL near the start must be refused as disguised, not crash: {r.status_code}"
    assert "binary" in str(r.json()).lower()


_PAD_LINE = ("Filler line to push content past the eight-kilobyte disguise-gate scan window so the "
            "NUL below is never inspected by guards.check_type at all.\n")
_PADDING = (_PAD_LINE * (8192 // len(_PAD_LINE) + 5)).encode()
assert len(_PADDING) > 8192, "test setup: padding must exceed guards.check_type's head-scan window"


def test_nul_past_the_disguise_window_does_not_crash_and_is_scrubbed_from_the_citable_corpus(client):
    """Past the 8192-byte head window, guards.check_type never sees the NUL (it only scans `data[:
    8192]`), so the upload reaches parse.py, where `_C0_CONTROL_RE` (parse.py:196,201) scrubs it. This
    is the load-bearing assertion the parse-only unit test (test_ingest.py::
    test_parse_strips_nul_and_c0_control_chars) cannot make on its own: that it holds over the REAL
    HTTP path, and specifically in the CITABLE corpus (MaterialChunk.text) an advisor could quote back
    to a manager — not just on some intermediate string nobody reads."""
    tail = b"Alice owns the onboarding revamp project this quarter, all on one clean line here.\n"
    body = _PADDING + b"\x00" + tail
    r = client.post("/ingest", files=[("files", ("late_nul.txt", body, "text/plain"))])
    assert r.status_code == 200, f"a NUL past the disguise window must not crash: {r.status_code} {r.text[:200]}"
    j = r.json()
    manifest = client.get(f"/team/{j['context_id']}/files",
                          headers={"X-Avery-Token": j["owner_token"]})
    entry = manifest.json()["files"][0]
    assert entry["status"] == "ingested", f"real content past the NUL must still be ingested: {entry}"

    from service.ingest_api import active_registry
    chunks = active_registry().get(j["context_id"]).extraction.materials
    corpus = "\n".join(c.text for c in chunks)
    assert "\x00" not in corpus, "a NUL byte survived into the citable RAG corpus"
    assert "Alice owns the onboarding revamp project" in corpus, (
        f"the real content after the NUL must survive the scrub intact: {corpus[-200:]!r}")
