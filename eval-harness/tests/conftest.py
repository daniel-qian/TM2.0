# -*- coding: utf-8 -*-
"""#90 · offline-battery determinism: keep the ingest worker THREAD out of every test by default.

`with TestClient(app)` runs the FastAPI lifespan, which would start the in-process ingest worker —
and a live thread racing the test over the job queue makes every "assert the job is still queued /
assert the world before extraction" criterion flaky. The battery instead drives jobs
DETERMINISTICALLY via `service.ingest_worker.run_pending_jobs()` (claiming is atomic on both
registry legs, so a test that sets the switch back on and runs the real thread — the dedicated
thread-path test does — can never double-execute a job).

autouse + monkeypatch: each test gets the switch set to 'off' before its body runs; a test that
NEEDS the real thread overrides it inside its own body (its later setenv wins).
"""
import pytest


@pytest.fixture(autouse=True)
def _ingest_worker_off(monkeypatch):
    monkeypatch.setenv("AVERY_INGEST_WORKER", "off")
