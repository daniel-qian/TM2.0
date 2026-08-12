# -*- coding: utf-8 -*-
"""feat-028 → #90 — /ingest must not block the event loop, now stated for the ASYNC deposit.

The feat-028 version of this gate monkeypatched `service.ingest_api.ingest_paths` slow and proved
`/health` stayed responsive while the handler's threadpool ran extraction. #90 removed extraction
from the request path entirely — `ingest_api` no longer even imports `ingest_paths` — so that
patch point is gone. The SAME hazard ("a minutes-long extraction freezes the single-worker loop,
the Docker HEALTHCHECK restarts the container mid-extraction") is now guarded by two sharper,
directly-measurable claims:

  1. POST /ingest returns WITHOUT waiting for extraction — a deposit under a 1.5s-slow extractor
     still answers in well under the block window (the whole point of #90's seam move).
  2. While the REAL worker thread is grinding that slow extraction, /health answers immediately —
     the worker is a daemon thread whose blocking sleep/IO releases the GIL, never the event loop.

This file is ALSO the real-thread integration gate: it flips AVERY_INGEST_WORKER back on (the
offline battery's tests/conftest.py autouse fixture turns it off for determinism) and proves the
lifespan-started thread claims + finishes a queued job end to end — deposit rows flip 'reading' →
terminal with NO run_pending_jobs() call anywhere in the test.
"""
from __future__ import annotations

import time

import pytest

pytest.importorskip("fastapi.testclient")
from fastapi.testclient import TestClient  # noqa: E402

BLOCK_S = 1.5          # how long the (monkeypatched) extraction grinds inside the worker
FAST_BUDGET_S = 0.7    # POST /ingest and /health must both answer well inside the block window
LAND_DEADLINE_S = 15.0  # the slow job must still LAND (thread liveness, not just non-blocking)


def test_slow_extraction_blocks_neither_the_deposit_nor_health(monkeypatch):
    monkeypatch.setenv("AVERY_BRAIN", "mock")
    # Force the offline heuristic so this gate is deterministic regardless of whether the dev .env
    # carries real extraction keys — the ONLY slowness is the monkeypatched extraction below.
    monkeypatch.setenv("AVERY_EXTRACTOR", "heuristic")
    monkeypatch.setenv("AVERY_EMBEDDINGS", "keyword")
    for k in ("AVERY_DB_URL", "PGVECTOR_URL"):
        monkeypatch.delenv(k, raising=False)
    # Override tests/conftest.py's autouse 'off': THIS gate wants the real worker thread — the
    # lifespan starts it, and the job must land with no synchronous drive anywhere in this test.
    monkeypatch.setenv("AVERY_INGEST_WORKER", "on")

    import service.app as app_mod
    import service.ingest_worker as iw
    from avery.ingest.registry import REGISTRY

    real_ingest_paths = iw.ingest_paths

    def slow_ingest(*args, **kwargs):
        time.sleep(BLOCK_S)          # stand in for a minutes-long extraction, INSIDE the worker
        return real_ingest_paths(*args, **kwargs)

    # Patch the symbol the WORKER actually calls (ingest_api no longer has one to patch).
    monkeypatch.setattr(iw, "ingest_paths", slow_ingest)

    REGISTRY.clear()
    try:
        with TestClient(app_mod.app) as client:   # lifespan: orphan recovery + worker thread start
            t0 = time.perf_counter()
            r = client.post("/ingest", files={
                "files": ("company.txt", b"a content line long enough to chunk on its own\n",
                          "text/plain")})
            deposit_elapsed = time.perf_counter() - t0
            assert r.status_code == 200, r.text[:300]
            assert deposit_elapsed < FAST_BUDGET_S, (
                f"POST /ingest took {deposit_elapsed:.2f}s under a {BLOCK_S}s-slow extractor — "
                f"the deposit is waiting for extraction, which is exactly what #90 removed")
            body = r.json()
            assert body["job"]["status"] == "queued"

            # The worker thread is now grinding the slow extraction. /health must not notice.
            t0 = time.perf_counter()
            h = client.get("/health")
            health_elapsed = time.perf_counter() - t0
            assert h.status_code == 200
            assert health_elapsed < FAST_BUDGET_S, (
                f"/health took {health_elapsed:.2f}s while the worker ground a slow extraction — "
                f"the worker is blocking the event loop (expected < {FAST_BUDGET_S}s)")

            # Real-thread liveness: the job LANDS with no run_pending_jobs() call in this test.
            hdr = {"X-Avery-Token": body["owner_token"]}
            deadline = time.monotonic() + LAND_DEADLINE_S
            last: dict = {}
            while time.monotonic() < deadline:
                last = client.get(f"/team/{body['context_id']}/files",
                                  headers=hdr).json().get("last_job", {})
                if last.get("status") in ("done", "failed"):
                    break
                time.sleep(0.05)
            assert last.get("status") == "done", (
                f"the worker thread never landed the queued job (last_job={last!r}) — "
                f"the lifespan thread is dead or never claimed it")
            statuses = [f["status"] for f in client.get(
                f"/team/{body['context_id']}/files", headers=hdr).json()["files"]]
            assert statuses and all(s != "reading" for s in statuses), (
                f"file rows stuck mid-flight after the job landed: {statuses}")
    finally:
        REGISTRY.clear()
