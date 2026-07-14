# -*- coding: utf-8 -*-
"""feat-034 stage C — the `manifest{kind:'ask-draft'}` SSE frame, injected at the SERVICE layer.

🔴 Placement is the point: the frame is appended in app.py's SSE assembly AFTER the engine's own
terminal manifest — the FROZEN advisor engine (loop/engine/tools/redline) is untouched. The frontend
already treats a missing `kind` as 'advice' (zero breakage) and adopts an 'ask-draft' frame into the
AskCard.

Heuristic (deterministic, honest — never force a card):
  * the situation names at least one ROSTER person (full-name hit against the ingested context's
    people) -> ONE ask-draft frame after the advice manifest, recipients = the matched people;
  * no roster name in the situation -> NO frame (don't invent a "who to ask");
  * no company_context_id -> NO frame (the demo company is not a roster).

The draft's questions are server-generated (template under mock/keyless — honestly labeled) and
every question passed the two-tier red-line gate BEFORE the frame goes out the door.
"""
from __future__ import annotations

import json
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
    monkeypatch.setenv("AVERY_BRAIN", "mock")
    monkeypatch.setenv("AVERY_EXTRACTOR", "heuristic")
    monkeypatch.delenv("AVERY_DB_URL", raising=False)
    monkeypatch.delenv("PGVECTOR_URL", raising=False)
    from avery.ingest.registry import REGISTRY
    REGISTRY.clear()
    from service.app import app
    with TestClient(app) as c:
        yield c
    REGISTRY.clear()


def _ingest(client):
    files = [("files", (p.name, p.read_bytes(), "application/octet-stream"))
             for p in (HANDBOOK, ROSTER)]
    body = client.post("/ingest", files=files).json()
    return body["context_id"], body["owner_token"]


def _sse_events(text: str) -> list[dict]:
    events = []
    for record in text.replace("\r\n", "\n").split("\n\n"):
        for line in record.split("\n"):
            if line.startswith("data:"):
                try:
                    events.append(json.loads(line[5:].strip()))
                except json.JSONDecodeError:
                    pass
    return events


def test_roster_name_hit_appends_one_ask_draft_frame(client):
    cid, tok = _ingest(client)
    r = client.post("/advise", json={
        "situation": "Can Marcus Reid own the vendor negotiation for the pilot?",
        "company_context_id": cid, "stream": True},
        headers={"X-Avery-Token": tok})
    assert r.status_code == 200
    events = _sse_events(r.text)

    advice = [e for e in events if e.get("type") == "manifest" and e.get("kind") in (None, "advice")]
    frames = [e for e in events if e.get("type") == "manifest" and e.get("kind") == "ask-draft"]
    assert len(advice) == 1, "the engine's own terminal manifest must still be there, exactly once"
    assert len(frames) == 1, "a roster-name situation must draft exactly ONE quick ask"
    # order: the ask-draft frame comes AFTER the advice manifest (the run completes on advice)
    assert events.index(frames[0]) > events.index(advice[0])

    ask = frames[0]["ask"]
    assert ask["id"].startswith("ask_")
    assert ask["status"] == "draft"
    assert ask["company_context_id"] == cid
    assert 1 <= len(ask["questions"]) <= 3
    assert all(q["kind"] in ("scale", "yesno") and q["text"].strip() for q in ask["questions"])
    # the matched roster person is preselected — this is WHY the card is offered
    assert [rec["name"] for rec in ask["recipients"]] == ["Marcus Reid"]
    assert all(rec.get("id") for rec in ask["recipients"])
    # every question crossed the gate BEFORE going out the door
    from avery import redline
    for q in ask["questions"]:
        assert redline.validate(q["text"]).passed, f"frame question crossed the red line: {q['text']}"
    # honest generation labeling (mock/keyless run -> template)
    assert ask.get("generation_mode") == "template"


def test_no_roster_name_no_frame(client):
    cid, tok = _ingest(client)
    r = client.post("/advise", json={
        "situation": "How is the studio pacing against the roadmap this quarter?",
        "company_context_id": cid, "stream": True},
        headers={"X-Avery-Token": tok})
    assert r.status_code == 200
    events = _sse_events(r.text)
    frames = [e for e in events if e.get("type") == "manifest" and e.get("kind") == "ask-draft"]
    assert frames == [], "no roster name -> no ask-draft frame (honesty: don't invent recipients)"


def test_no_context_no_frame(client):
    r = client.post("/advise", json={
        "situation": "Can Marcus Reid own the vendor negotiation?", "stream": True})
    assert r.status_code == 200
    events = _sse_events(r.text)
    frames = [e for e in events if e.get("type") == "manifest" and e.get("kind") == "ask-draft"]
    assert frames == [], "no company context -> no roster -> no frame"


def test_buffered_advise_still_picks_the_advice_manifest(client):
    """The buffered (stream=false) body must keep being built from the ADVICE manifest even when an
    ask-draft frame follows it in the event list (regression guard on the reversed() scan)."""
    cid, tok = _ingest(client)
    r = client.post("/advise", json={
        "situation": "Can Marcus Reid own the vendor negotiation for the pilot?",
        "company_context_id": cid, "stream": False},
        headers={"X-Avery-Token": tok})
    assert r.status_code == 200
    body = r.json()
    assert "advice" in body and body.get("kind") in (None, "advice"), \
        "the buffered manifest must be the ADVICE one, not the ask-draft frame"
    frames = [e for e in body.get("events", [])
              if e.get("type") == "manifest" and e.get("kind") == "ask-draft"]
    assert len(frames) == 1, "the buffered event list carries the frame too (one consistent contract)"
