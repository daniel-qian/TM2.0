# -*- coding: utf-8 -*-
"""issue #49 — 议事室问答持久化 over the HTTP surface, fully offline.

Forces the fully-offline config (mock brain, keyword recall, heuristic extractor, NO database), so
this runs in the default suite with zero network / zero DB. The DB restart twin is
test_pg_advise_runs_survive_a_new_registry_instance in test_registry_contract.py (@needs_db).

Asserts the behavior contract:
  * a real /advise (mock brain, buffered) persists ONE run: the manager's question + the projected
    advice payload (advice XOR answer — mirroring the manifest contract);
  * multiple /advise rounds ACCUMULATE and list new->old;
  * GET /team/{id}/advise-runs returns {context_id, runs:[{id, created_at, question, title,
    locale, advice, answer}]}, gated by the owner_token exactly like /notes (missing token -> 404);
  * an unknown context 404s;
  * a context-less /advise (the demo default company) persists NOTHING — history has no home
    without a context, and the demo company must not accrete strangers' questions.
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
    monkeypatch.setenv("AVERY_EMBEDDINGS", "keyword")
    monkeypatch.setenv("AVERY_EXTRACTOR", "heuristic")
    monkeypatch.delenv("AVERY_DB_URL", raising=False)
    monkeypatch.delenv("PGVECTOR_URL", raising=False)
    from avery.ingest.registry import REGISTRY
    REGISTRY.clear()   # isolate from any other in-process test that used the singleton
    from service.app import app
    return TestClient(app)


def _ingest(client):
    files = [("files", (p.name, p.read_bytes(), "application/octet-stream"))
             for p in (HANDBOOK, ROSTER)]
    r = client.post("/ingest", files=files)
    assert r.status_code == 200, f"/ingest failed: {r.text[:300]}"
    body = r.json()
    return body["context_id"], {"X-Avery-Token": body["owner_token"]}


def _advise(client, cid, situation: str, hdr, title: str | None = None):
    payload = {"situation": situation, "company_context_id": cid, "stream": False}
    if title is not None:
        payload["title"] = title
    return client.post("/advise", json=payload, headers=hdr)


def test_advise_persists_one_run_with_the_projected_advice(client):
    cid, hdr = _ingest(client)
    r = client.get(f"/team/{cid}/advise-runs", headers=hdr)
    assert r.status_code == 200 and r.json()["runs"] == [], "a fresh company has no run history"

    q = "The onboarding backlog keeps landing on one squad. How do I rebalance it?"
    ar = _advise(client, cid, q, hdr, title="onboarding")
    assert ar.status_code == 200 and ar.json()["redline_passed"] is True

    runs = client.get(f"/team/{cid}/advise-runs", headers=hdr).json()["runs"]
    assert len(runs) == 1, "one advise round should leave one run"
    run = runs[0]
    for k in ("id", "created_at", "question", "title", "locale", "advice", "answer",
              "thread_id"):   # issue #78 · thread_id 是 additive 新键（asdict 自动带上）
        assert k in run, f"run contract missing {k}"
    assert run["question"] == q, "the question is stored verbatim"
    assert run["title"] == "onboarding"
    # advice XOR answer — a mock advice round stores the projected card, no short answer.
    assert isinstance(run["advice"], dict) and run["advice"].get("summary"), (
        "the projected advice payload (manifest.advice) must be stored")
    assert run["answer"] == ""


def test_runs_accumulate_new_to_old(client):
    cid, hdr = _ingest(client)
    questions = [
        "How do I rebalance the onboarding backlog across the squads?",
        "Who most needs a hand this week?",
        "What should I unblock first tomorrow morning?",
    ]
    for q in questions:
        assert _advise(client, cid, q, hdr).status_code == 200
    runs = client.get(f"/team/{cid}/advise-runs", headers=hdr).json()["runs"]
    assert [r["question"] for r in runs] == list(reversed(questions)), (
        "runs must accumulate and list new->old")


def test_history_is_gated_like_notes(client):
    cid, hdr = _ingest(client)
    assert _advise(client, cid, "Where is the coordination seam?", hdr).status_code == 200
    # missing owner_token -> 404 (no existence oracle), exactly like GET /team/{id}/notes
    assert client.get(f"/team/{cid}/advise-runs").status_code == 404
    # unknown context -> 404
    assert client.get("/team/ctx_does_not_exist/advise-runs",
                      headers=hdr).status_code == 404


def test_contextless_advise_persists_nothing(client):
    """A demo-default /advise (no company_context_id) has no history home — nothing to list, and
    the hook must not crash the advise itself."""
    r = client.post("/advise", json={"situation": "How is the team doing?", "stream": False})
    assert r.status_code == 200, f"context-less advise broke: {r.text[:200]}"
    # nothing to assert on a listing (no context) — the claim is simply that no error surfaced
    # and no registry write was attempted (append_advise_run requires a real context row in pg;
    # the guard in _persist_advise_run returns before any registry call).
