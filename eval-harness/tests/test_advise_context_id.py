"""feat-028 (demo-harden cluster-1, fix #4) — an UNKNOWN company_context_id must never silently
answer over the demo company (Isadora: "identity must never silently default").

`service/app.py::_resolve_memory_dir` fell back to the default demo MEMORY_DIR whenever an id could
not be resolved — which conflates two very different cases:

  * NO id given          -> demo memory is the legitimate, intended default (unchanged, fine);
  * an id GIVEN but not in the registry (e.g. after a restart wiped the in-memory registry) -> the
    advisor would answer over the SEED company and cite colleagues who don't exist in the manager's
    real company. That is a live correctness bug, not a graceful default.

This gate pins the three cases. The unknown-id case must surface a clear error (HTTP 404, consistent
with `GET /team/{id}` at ingest_api.py) rather than a silent 200 over demo memory.
"""
from __future__ import annotations

from pathlib import Path

import pytest

fastapi_testclient = pytest.importorskip("fastapi.testclient")
from fastapi.testclient import TestClient  # noqa: E402

HERE = Path(__file__).resolve().parent.parent
FIX = HERE / "tests" / "fixtures" / "ingest"
HANDBOOK = FIX / "Studio_Handbook.md"
ROSTER = FIX / "Team_Roster.xlsx"


@pytest.fixture()
def client(monkeypatch):
    monkeypatch.setenv("AVERY_BRAIN", "mock")
    # feat-030: pin the IN-MEMORY registry path — these gates register into the process-global
    # REGISTRY, so the service must resolve that same registry regardless of whether the machine
    # env carries a DB URL (the DB-backed path has its own contract + restart gates).
    monkeypatch.delenv("AVERY_DB_URL", raising=False)
    monkeypatch.delenv("PGVECTOR_URL", raising=False)
    from service.app import app
    return TestClient(app)


@pytest.fixture()
def clean_registry():
    """Isolate the process-global registry so a registered context can't leak across tests."""
    from avery.ingest.registry import REGISTRY
    REGISTRY.clear()
    yield REGISTRY
    REGISTRY.clear()


def test_unknown_context_id_is_an_error_not_a_silent_demo_answer(client, clean_registry):
    r = client.post("/advise", json={
        "situation": "How is my team doing on the core flow?",
        "company_context_id": "ctx_does_not_exist",
        "stream": False,
    })
    assert r.status_code == 404, (
        "an unknown company_context_id silently answered over the demo company instead of erroring "
        f"(got {r.status_code}); the advisor would cite colleagues who don't exist in the user's "
        "real company")
    # the streaming variant must also refuse, not open an SSE over the wrong company
    r_stream = client.post("/advise", json={
        "situation": "How is my team doing?",
        "company_context_id": "ctx_does_not_exist",
    })
    assert r_stream.status_code == 404


def test_no_context_id_still_uses_demo_memory(client, clean_registry):
    """The legitimate default: no id -> demo memory. This path must stay working (200 + manifest)."""
    r = client.post("/advise", json={
        "situation": "One of my engineers has gone quiet before deadlines. How do I raise it?",
        "stream": False,
    })
    assert r.status_code == 200
    body = r.json()
    assert body["contract_ok"] is True


def test_known_context_id_uses_that_context(client, clean_registry, tmp_path):
    """A registered id resolves to its ingested memory and advises successfully (200)."""
    from avery.ingest import ingest_paths
    rep = ingest_paths([str(HANDBOOK), str(ROSTER)], registry=clean_registry,
                       context_id="ctx_known", work_dir=tmp_path)
    assert rep.ok and "ctx_known" in clean_registry

    r = client.post("/advise", json={
        "situation": "Give me a read on where the team stands from what I uploaded.",
        "company_context_id": "ctx_known",
        "stream": False,
    })
    assert r.status_code == 200, f"a KNOWN context id should advise, got {r.status_code}: {r.text[:300]}"
    body = r.json()
    assert body["contract_ok"] is True
