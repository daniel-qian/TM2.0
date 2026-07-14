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
