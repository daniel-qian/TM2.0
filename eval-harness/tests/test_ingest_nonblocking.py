"""feat-028 (demo-harden cluster-1, fix #2) — /ingest must not block the event loop.

`service/ingest_api.py::ingest` runs on the single-worker uvicorn event loop. If it calls the
SYNCHRONOUS `ingest_paths(...)` directly (minutes-long extraction), it freezes the whole loop — so
`/health` and every other request stall behind it, and the Docker HEALTHCHECK can then mark the
container unhealthy and restart it mid-extraction (wiping the in-memory registry).

This gate drives the real ASGI app over an in-process httpx ASGITransport. It fires a slow `/ingest`
(the extraction call monkeypatched to block ~1.5s) and, concurrently, a `/health`. If the handler
offloads the blocking work (run_in_threadpool / to_thread), `/health` returns in well under the
block window. If the handler blocks the loop, `/health` can only complete AFTER the block — its
end-to-end latency then approaches the full block and the assertion fails.

No pytest-asyncio in this env, so the scenario runs under an explicit `asyncio.run`.
"""
from __future__ import annotations

import asyncio
import time
from types import SimpleNamespace

import pytest

pytest.importorskip("httpx")
import httpx  # noqa: E402
from httpx import ASGITransport  # noqa: E402

BLOCK_S = 1.5          # how long the (monkeypatched) extraction blocks
HEALTH_BUDGET_S = 0.7  # /health must return well inside the block window if the loop is free


def _stub_report():
    """A minimal IngestReport-shaped object so the handler's success path (report.ok / .context /
    _team_payload) works without a real extraction."""
    ctx = SimpleNamespace(
        context_id="ctx_stub", source_files=[],
        team_cards=lambda: [], project_cards=lambda: [],
        briefing=lambda: {}, signal_cards=lambda: [],
        # feat-056: _team_payload now also projects the decision grades. This gate is about the
        # event loop, not payload shape — the fake just has to satisfy the same surface.
        decision_cards=lambda: [],
        # rich-align-0722/05a: _team_payload also projects the archived (soft-deleted) drawer.
        archived_project_cards=lambda: [],
    )
    return SimpleNamespace(ok=True, context=ctx, violations=[], parse_errors=[])


def test_slow_ingest_does_not_block_health(monkeypatch):
    monkeypatch.setenv("AVERY_BRAIN", "mock")
    # Force the offline heuristic so this gate is deterministic regardless of whether the dev .env
    # carries real extraction keys — the ONLY block is the monkeypatched slow ingest below.
    monkeypatch.setenv("AVERY_EXTRACTOR", "heuristic")
    import service.ingest_api as ingest_api
    from service.app import app

    def slow_ingest(*args, **kwargs):
        time.sleep(BLOCK_S)          # stand in for a minutes-long synchronous extraction
        return _stub_report()

    # Patch the symbol the handler actually calls.
    monkeypatch.setattr(ingest_api, "ingest_paths", slow_ingest)

    async def scenario():
        transport = ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            t0 = time.perf_counter()

            ingest_task = asyncio.create_task(client.post(
                "/ingest",
                files={"files": ("company.txt", b"hello world", "text/plain")},
            ))

            async def timed_health():
                # Small head start so the ingest handler is scheduled and reaches its blocking
                # extraction call FIRST; measure latency from the shared t0 so a blocked loop shows
                # up as the block window being charged to /health.
                await asyncio.sleep(0.15)
                r = await client.get("/health")
                return time.perf_counter() - t0, r.status_code

            health_task = asyncio.create_task(timed_health())
            ingest_resp, (health_latency, health_status) = await asyncio.gather(
                ingest_task, health_task)
            return ingest_resp.status_code, health_latency, health_status

    ingest_status, health_latency, health_status = asyncio.run(scenario())

    assert health_status == 200
    assert ingest_status == 200, "the ingest success path should still return the team payload"
    assert health_latency < HEALTH_BUDGET_S, (
        f"/health took {health_latency:.2f}s while a slow /ingest was in flight — the ingest "
        f"handler is blocking the event loop (expected < {HEALTH_BUDGET_S}s; the block was "
        f"{BLOCK_S}s). Offload the synchronous ingest_paths() call.")
