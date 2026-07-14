# -*- coding: utf-8 -*-
"""feat-039 — the upload hard-gate over the HTTP surface (agent as first user), fully offline.

Readiness §2-D: before feat-039 `/ingest` was UNBOUNDED — a 400MB upload or a script loop OOM'd the
single ECS task (and its ImaRead neighbour) or burned the M3 budget, and a disguised/zip-bomb file
walked straight into the parser. This is the born-red -> green gate for those holes, driven as REAL
HTTP against the real ASGI app (mock brain / heuristic extractor / no DB — the offline zero-network
suite). Each boundary is asserted honestly: over-size -> 413, over-count -> 413, disguised type ->
415, zip bomb -> 413 (no OOM), over-frequency -> 429, and a normal upload still 200 with an honest
`extraction_mode`.
"""
from __future__ import annotations

import io
import logging
import zipfile
from pathlib import Path

import pytest

pytest.importorskip("fastapi.testclient")
from fastapi.testclient import TestClient  # noqa: E402

HERE = Path(__file__).resolve().parent.parent
FIX = HERE / "tests" / "fixtures" / "ingest"
HANDBOOK = FIX / "Studio_Handbook.md"


def _reset_all():
    from avery.ingest.registry import REGISTRY
    from service import upload_guard, llm_budget, mem_sentinel
    REGISTRY.clear()
    upload_guard.reset_rate_limiter()
    llm_budget.reset()
    mem_sentinel.reset()


@pytest.fixture()
def client(monkeypatch):
    """Fully-offline app: mock brain, keyword recall, heuristic extractor, NO DB. Limits/rate all at
    their defaults unless a test overrides via env (per-test monkeypatch)."""
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


def _txt(name: str, body: bytes):
    return ("files", (name, body, "text/plain"))


# ==============================================================================================
# 0) A normal upload still works — and now carries an honest extraction_mode.
# ==============================================================================================

def test_normal_upload_still_200_with_extraction_mode(client):
    r = client.post("/ingest", files=[("files", (HANDBOOK.name, HANDBOOK.read_bytes(), "text/plain"))])
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["context_id"]
    assert body["extraction_mode"] == "heuristic", (
        "an offline (keyless) deploy must honestly report 'heuristic', never claim llm")


# ==============================================================================================
# 1) Over-size — per-file, total-body, and count — all refused with 413 (before OOM).
# ==============================================================================================

def test_oversize_single_file_413(client, monkeypatch):
    monkeypatch.setenv("AVERY_MAX_UPLOAD_BYTES", "500")   # 500-byte per-file cap
    r = client.post("/ingest", files=[_txt("big.txt", b"x" * 2000)])
    assert r.status_code == 413, f"an oversize file was not refused: {r.status_code} {r.text[:200]}"
    assert "per-file" in str(r.json()).lower()


def test_total_body_cap_413_via_content_length(client, monkeypatch):
    """The total-body cap fires at the ASGI edge on Content-Length — BEFORE the body is read into
    RAM (the honest-client OOM guard on the 540M box)."""
    monkeypatch.setenv("AVERY_MAX_TOTAL_UPLOAD_BYTES", "1024")  # 1 KiB total
    r = client.post("/ingest", files=[_txt("a.txt", b"y" * 4000)])
    assert r.status_code == 413, f"an oversize BODY was not refused: {r.status_code}"
    assert "too large" in str(r.json()).lower()


def test_too_many_files_413(client, monkeypatch):
    monkeypatch.setenv("AVERY_MAX_FILES", "2")
    files = [_txt(f"f{i}.txt", b"content line long enough here\n") for i in range(3)]
    r = client.post("/ingest", files=files)
    assert r.status_code == 413, f"an over-count batch was not refused: {r.status_code}"
    assert "too many files" in str(r.json()).lower()


# ==============================================================================================
# 2) Disguised type — magic-byte mismatch — refused with 415 (not trusted on extension).
# ==============================================================================================

def test_pdf_bytes_disguised_as_txt_415(client):
    r = client.post("/ingest", files=[_txt("notes.txt", b"%PDF-1.7\n%hidden binary payload\x00\x01")])
    assert r.status_code == 415, f"a disguised binary (.txt) was accepted: {r.status_code}"
    assert "disguised" in str(r.json()).lower() or "binary" in str(r.json()).lower()


def test_garbage_disguised_as_xlsx_415(client):
    r = client.post("/ingest", files=[("files", ("book.xlsx", b"this is not a zip at all", "application/octet-stream"))])
    assert r.status_code == 415, f"a fake .xlsx was accepted: {r.status_code}"
    assert "office" in str(r.json()).lower() or "magic" in str(r.json()).lower()


def test_unsupported_extension_is_not_415_here(client):
    """An UNSUPPORTED extension is NOT a 415 (feat-032 marks it 'failed' in the manifest). The good
    file publishes; the .xyz is recorded as failed — the disguise gate must not regress that."""
    good = b"GoodContent line one is long enough to chunk\nsecond good line also long enough here\n"
    files = [_txt("good.txt", good),
             ("files", ("broken.xyz", b"\x89 not parseable as .xyz", "application/octet-stream"))]
    r = client.post("/ingest", files=files)
    assert r.status_code == 200, f"a mixed batch was wrongly refused: {r.status_code} {r.text[:200]}"


# ==============================================================================================
# 3) Zip bomb — a small OOXML that decompresses past the cap — refused with 413, NO OOM.
# ==============================================================================================

def test_zip_bomb_refused_without_oom(client, monkeypatch):
    monkeypatch.setenv("AVERY_MAX_ARCHIVE_UNCOMPRESSED_BYTES", str(100 * 1024))  # 100 KiB cap
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        # 5 MiB of zeros -> ~5 KiB compressed: tiny upload, huge decompression (a classic bomb shape).
        zf.writestr("xl/worksheets/sheet1.xml", b"\x00" * (5 * 1024 * 1024))
    bomb = buf.getvalue()
    assert len(bomb) < 100 * 1024, "the bomb's COMPRESSED size should be small (proves it's a bomb)"
    r = client.post("/ingest", files=[("files", ("bomb.xlsx", bomb, "application/octet-stream"))])
    assert r.status_code == 413, f"a zip bomb was not refused: {r.status_code} {r.text[:200]}"
    assert "bomb" in str(r.json()).lower()


# ==============================================================================================
# 4) Rate limit — over-frequency from one IP — refused with 429 (denial-of-service guard).
# ==============================================================================================

def test_rate_limit_429_over_frequency(client, monkeypatch):
    monkeypatch.setenv("AVERY_RATE_INGEST_PER_MIN", "2")
    monkeypatch.setenv("AVERY_RATE_INGEST_BURST", "2")
    from service import upload_guard
    upload_guard.reset_rate_limiter()   # start from a full, deterministic bucket
    ok = _txt("ok.txt", b"a content line long enough to chunk here\n")
    statuses = [client.post("/ingest", files=[ok]).status_code for _ in range(3)]
    assert statuses[:2] == [200, 200], f"the first two uploads should pass: {statuses}"
    assert statuses[2] == 429, f"the third rapid upload should be rate-limited: {statuses}"


def test_rate_limit_disabled_by_default(client):
    """Default (env unset) => the limiter is OFF, so the offline suite's many one-IP uploads never
    429. (The ECS runbook sets AVERY_RATE_INGEST_PER_MIN in production.)"""
    ok = _txt("ok.txt", b"a content line long enough to chunk here\n")
    statuses = [client.post("/ingest", files=[ok]).status_code for _ in range(6)]
    assert all(s == 200 for s in statuses), f"default deploy must not rate-limit: {statuses}"


def test_rate_limit_not_bypassed_by_spoofed_xff(client, monkeypatch):
    """P1 (HIGH): a rotating, attacker-forged X-Forwarded-For must NOT create a fresh rate-limit
    bucket per request. By default we key the limiter on the UNSPOOFABLE TCP peer, so a flood that
    changes X-Forwarded-For every call still trips the bucket (the 540M single-worker DoS guard)."""
    monkeypatch.setenv("AVERY_RATE_INGEST_PER_MIN", "2")
    monkeypatch.setenv("AVERY_RATE_INGEST_BURST", "2")
    monkeypatch.delenv("AVERY_TRUSTED_PROXY_HOPS", raising=False)   # default: trust only TCP peer
    from service import upload_guard
    upload_guard.reset_rate_limiter()
    ok = _txt("ok.txt", b"a content line long enough to chunk here\n")
    statuses = [client.post("/ingest", files=[ok],
                            headers={"X-Forwarded-For": f"203.0.113.{i}"}).status_code
                for i in range(6)]
    assert statuses[:2] == [200, 200], f"the burst of 2 should pass: {statuses}"
    assert 429 in statuses[2:], (
        f"a spoofed rotating XFF must not bypass the per-IP limit (all TCP peer 'testclient'): "
        f"{statuses}")


def test_trusted_proxy_hops_reads_rightmost_xff(client, monkeypatch):
    """P1: with AVERY_TRUSTED_PROXY_HOPS=1 (one trusted reverse proxy that APPENDS the real client on
    the RIGHT, per the nginx $proxy_add_x_forwarded_for recipe), the limiter keys on the RIGHTMOST
    XFF hop. A forged LEFT prefix that rotates but keeps the real client fixed on the right is still
    rate-limited; two genuinely different rightmost clients get independent buckets."""
    monkeypatch.setenv("AVERY_RATE_INGEST_PER_MIN", "2")
    monkeypatch.setenv("AVERY_RATE_INGEST_BURST", "2")
    monkeypatch.setenv("AVERY_TRUSTED_PROXY_HOPS", "1")
    from service import upload_guard
    upload_guard.reset_rate_limiter()
    ok = _txt("ok.txt", b"a content line long enough to chunk here\n")
    # attacker rotates the forged left prefix; the trusted proxy appended the same real client (right)
    spoofed = [client.post("/ingest", files=[ok],
                           headers={"X-Forwarded-For": f"66.66.66.{i}, 9.9.9.9"}).status_code
               for i in range(4)]
    assert spoofed[:2] == [200, 200] and 429 in spoofed[2:], (
        f"a fixed rightmost client must be limited despite a rotating forged left prefix: {spoofed}")
    # a genuinely different rightmost client has its own (full) bucket
    upload_guard.reset_rate_limiter()
    a = client.post("/ingest", files=[ok], headers={"X-Forwarded-For": "7.7.7.7"}).status_code
    b = client.post("/ingest", files=[ok], headers={"X-Forwarded-For": "8.8.8.8"}).status_code
    assert a == 200 and b == 200, f"distinct real clients must not share a bucket: {a}, {b}"


# ==============================================================================================
# 6) Streamed backstop — a chunked / no-Content-Length oversize body -> honest 413 (not 400).
# ==============================================================================================

def test_streamed_oversize_body_returns_413_not_400(client, monkeypatch):
    """P2 (LOW): a chunked upload with NO Content-Length that streams past the total-body cap must
    return an HONEST 413 'upload too large' at the ASGI edge — not FastAPI's generic 400 'error
    parsing the body' (the middleware sends the 413 itself instead of raising into the form parser)."""
    monkeypatch.setenv("AVERY_MAX_TOTAL_UPLOAD_BYTES", "2000")
    boundary = "----averystreamprobe"
    ct = f"multipart/form-data; boundary={boundary}"

    def body():
        yield (f"--{boundary}\r\n"
               'Content-Disposition: form-data; name="files"; filename="big.txt"\r\n'
               "Content-Type: text/plain\r\n\r\n").encode()
        for _ in range(20):
            yield b"x" * 500          # 10 000 bytes of payload >> the 2 000-byte cap
        yield (f"\r\n--{boundary}--\r\n").encode()

    r = client.post("/ingest", content=body(), headers={"Content-Type": ct})
    assert r.status_code == 413, (
        f"a streamed oversize body must be an honest 413, got {r.status_code}: {r.text[:160]}")
    assert "too large" in str(r.json()).lower()


# ==============================================================================================
# 7) /health honesty — an exhausted LLM budget (with llm configured) must not report a healthy llm.
# ==============================================================================================

def test_health_honest_when_llm_budget_exhausted(client, monkeypatch):
    """P3 (LOW): when a real extraction brain is configured but the per-process LLM spend budget is
    already spent, /health must NOT claim a healthy `llm:<brain>` with degraded=false. It reflects
    the denial-of-wallet fallback: extraction_mode 'degraded' + degraded=true. /health never calls
    the brain, so a fake key here touches no network."""
    monkeypatch.setenv("AVERY_EXTRACTOR", "llm")
    monkeypatch.setenv("AVERY_EXTRACTOR_BRAIN", "minimax")
    monkeypatch.setenv("MINIMAX_API_KEY", "sk-fake-present")
    monkeypatch.setenv("AVERY_LLM_CALL_BUDGET", "2")
    from service import llm_budget
    llm_budget.reset()
    llm_budget.charge(2)                                   # spend the whole budget
    body = client.get("/health").json()
    assert llm_budget.remaining() == 0
    assert body["extraction_mode"] == "degraded", body
    assert body["degraded"] is True, (
        "an exhausted LLM budget with a configured brain must flip /health degraded")


def test_health_reports_llm_mode_when_budget_available(client, monkeypatch):
    """The mirror of the above: budget still available -> /health honestly reports extraction_mode
    'llm' and is not degraded on that account."""
    monkeypatch.setenv("AVERY_EXTRACTOR", "llm")
    monkeypatch.setenv("AVERY_EXTRACTOR_BRAIN", "minimax")
    monkeypatch.setenv("MINIMAX_API_KEY", "sk-fake-present")
    monkeypatch.setenv("AVERY_LLM_CALL_BUDGET", "5")
    from service import llm_budget
    llm_budget.reset()
    body = client.get("/health").json()
    assert body["extraction_mode"] == "llm", body
    assert body["degraded"] is False


def test_health_extraction_mode_heuristic_offline(client):
    """A natively keyless (offline) deploy honestly reports extraction_mode 'heuristic' and is not
    degraded — an exhausted budget is moot when no LLM extractor is in play."""
    body = client.get("/health").json()
    assert body["extraction_mode"] == "heuristic", body
    assert body["degraded"] is False


# ==============================================================================================
# 5) Memory sentinel — RSS over the mark flips /health degraded + emits a WARN (Danny Q12).
# ==============================================================================================

def test_health_not_degraded_by_default(client):
    body = client.get("/health").json()
    assert body["degraded"] is False, "an idle deploy must not report degraded"
    assert body["memory"]["high"] is False


def test_health_degraded_when_rss_over_warn_mark(client, monkeypatch, caplog):
    monkeypatch.setenv("AVERY_MEM_WARN_MB", "1")   # 1 MiB — process RSS is always above this
    with caplog.at_level(logging.WARNING, logger="service.mem_sentinel"):
        body = client.get("/health").json()
    assert body["degraded"] is True, "RSS over the warn mark must flip /health degraded"
    assert body["memory"]["high"] is True
    assert any("MEMORY HIGH" in rec.message for rec in caplog.records), (
        "crossing the memory mark must emit a structured WARN (the 'upgrade ECS' bubble)")
