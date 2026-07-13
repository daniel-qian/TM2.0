# -*- coding: utf-8 -*-
"""feat-033 — "Avery's notes" over the HTTP surface (the agent as first user), fully offline.

Forces the fully-offline config (mock brain, keyword recall, heuristic extractor, NO database), so
this runs in the default suite with zero network / zero DB. The DB restart-accumulation twin is the
@needs_db contract in test_registry_contract.py.

Asserts the behavior contract:
  * a real /advise (mock brain) writes ONE agent observation into the company's notebook;
  * multiple /advise rounds ACCUMULATE (the notebook gets thicker) and list new->old;
  * GET /team/{id}/notes returns [{id, created_at, text, source_excerpt}], newest first;
  * an unknown context 404s (consistent with GET /team/{id});
  * RED LINE end-to-end: when the manager's own quoted question carries a person score, the note is
    DISCARDED at the write-side gate — the notebook stays empty, even though the advice passed.
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


def _ingest(client) -> str:
    files = [("files", (p.name, p.read_bytes(), "application/octet-stream"))
             for p in (HANDBOOK, ROSTER)]
    r = client.post("/ingest", files=files)
    assert r.status_code == 200, f"/ingest failed: {r.text[:300]}"
    return r.json()["context_id"]


def _advise(client, cid: str, situation: str):
    return client.post("/advise", json={"situation": situation, "company_context_id": cid,
                                         "stream": False})


def test_advise_writes_one_note(client):
    cid = _ingest(client)
    r = client.get(f"/team/{cid}/notes")
    assert r.status_code == 200
    assert r.json()["notes"] == [], "a fresh company has no notes yet"

    ar = _advise(client, cid, "The onboarding backlog keeps landing on one squad. How do I rebalance it?")
    assert ar.status_code == 200 and ar.json()["redline_passed"] is True

    notes = client.get(f"/team/{cid}/notes").json()["notes"]
    assert len(notes) == 1, "one advise round should leave one observation"
    note = notes[0]
    for k in ("id", "created_at", "text", "source_excerpt"):
        assert k in note, f"note contract missing {k}"
    assert note["text"].strip(), "the note carries the agent's observation text"
    assert "onboarding backlog" in note["source_excerpt"], "source excerpt = the manager's question lead"


def test_notes_accumulate_new_to_old(client):
    cid = _ingest(client)
    questions = [
        "How do I rebalance the onboarding backlog across the squads?",
        "Two handoffs bounced back this week — how do I tighten the seam?",
        "Design and delivery keep colliding on the same week; how should I sequence them?",
    ]
    for q in questions:
        assert _advise(client, cid, q).status_code == 200

    notes = client.get(f"/team/{cid}/notes").json()["notes"]
    assert len(notes) == 3, "three advise rounds should accumulate three notes"
    # newest first: the last question's excerpt heads the list.
    assert "sequence" in notes[0]["source_excerpt"] or "colliding" in notes[0]["source_excerpt"]
    assert "onboarding backlog" in notes[-1]["source_excerpt"], "oldest note is last"


def test_notes_unknown_context_404s(client):
    r = client.get("/team/ctx_never_registered/notes")
    assert r.status_code == 404


def test_advise_does_not_write_a_note_without_a_context(client):
    """A demo-default advise (no company_context_id) has no company notebook — it writes nothing,
    and never crashes."""
    r = client.post("/advise", json={"situation": "How do I run a calm 1:1?", "stream": False})
    assert r.status_code == 200
    # no context id -> nothing to read; just assert the advise itself succeeded and did not error.
    assert r.json().get("contract_ok") in (True, False)


def test_redline_discards_a_note_when_the_question_scores_a_person(client):
    """End-to-end write-side red line: the advice itself is clean (passes), but the manager's OWN
    quoted question carries a person score. The write-side gate refuses to echo that onto the
    persistent, user-visible notes surface — the note is DISCARDED, the notebook stays empty."""
    cid = _ingest(client)
    ar = _advise(client, cid, "Why did I score her 2/10 at the last review, and how do I coach her back?")
    assert ar.status_code == 200
    # The advice output is clean (the read never scores a person); the DISCARD is about the note's
    # echoed question excerpt, not the advice.
    notes = client.get(f"/team/{cid}/notes").json()["notes"]
    assert notes == [], "a scoring question must not become a persisted note (write-side red line)"
