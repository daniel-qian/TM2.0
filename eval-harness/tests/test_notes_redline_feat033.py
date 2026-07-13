# -*- coding: utf-8 -*-
"""feat-033 — END-TO-END closure of the CONFIRMED CRITICAL red-line hole (the three person-scoring
forms that slipped `avery.redline.validate`, would land in Avery's self-written notebook, and show on
the user-visible GET /team/{id}/notes). This proves the hardened gate now DROPS all three across
EVERY write path — the storage door (in-memory AND Postgres), the post-advise hook (observation body
AND echoed question excerpt), and the live HTTP notes surface — while a legitimate work observation
still lands (the gate is not a blunt number-blocker).

The three forms:
  1. EN name/pronoun ranking       — "rank: Marcus #1, Anna #5" / "Marcus ranks #1, Anna last"
  2. EN person blood-bar %         — "Her mood is at 30% and capacity 40%" / "Her capacity is 40%"
  3. ZH bare-name + score / rank    — "李雷:9分,排名第一" / "张三 排名第一" / "王五 末位" / "她的情绪30%"
"""
from __future__ import annotations

import os

import pytest

from avery.ingest.registry import ContextRegistry
from service import notes as notes_hook

needs_db = pytest.mark.needs_db


def _db_url() -> str | None:
    return (os.environ.get("AVERY_DB_URL") or os.environ.get("PGVECTOR_URL") or "").strip() or None


# The three escaping forms — each MUST be refused at every write path.
FEAT033_FORMS = [
    ("en-name-rank",   "rank: Marcus #1, Anna #5"),
    ("en-name-rank2",  "Marcus ranks #1, Anna last"),
    ("en-moodbar",     "Her mood is at 30% and capacity 40%."),
    ("en-moodbar2",    "Her capacity is 40%."),
    ("zh-name-score",  "李雷:9分,排名第一"),
    ("zh-name-rank",   "张三 排名第一"),
    ("zh-name-tier",   "王五 末位"),
    ("zh-moodbar",     "她的情绪30%"),
]

# a clean, work-focused observation that MUST still land (numbers on WORK are allowed — ADR-0016).
CLEAN_WORK_OBS = "The onboarding backlog is 40% cleared but keeps landing on one squad — a load problem."


# ============================================================================================
# STORAGE DOOR — registry.append_note() refuses each form (in-memory AND Postgres share one gate)
# ============================================================================================

@pytest.fixture(params=["memory", pytest.param("postgres", marks=needs_db)])
def registry(request, tmp_path):
    if request.param == "memory":
        yield ContextRegistry()
        return
    url = _db_url()
    if not url:
        pytest.skip("needs AVERY_DB_URL (or PGVECTOR_URL) pointing at a Postgres")
    pytest.importorskip("psycopg")
    from avery.ingest.pg_registry import PostgresContextRegistry
    yield PostgresContextRegistry(url, data_dir=tmp_path / "data")


@pytest.mark.parametrize("label,obs", FEAT033_FORMS)
def test_append_note_refuses_each_feat033_form(registry, label, obs):
    """The write-side gate raises BEFORE any storage happens (for Postgres, before it even connects),
    so a scoring/ranking observation never touches the notebook — memory or DB."""
    cid = "ctx_feat033_" + label.replace("-", "_")
    with pytest.raises(ValueError, match="red line"):
        registry.append_note(cid, obs, "how is the team doing")
    assert registry.list_notes(cid) == [], f"[{label}] a crossing observation LANDED: {obs!r}"


@pytest.mark.parametrize("label,form", FEAT033_FORMS)
def test_append_note_refuses_form_in_the_echoed_excerpt(registry, label, form):
    """The SECOND write path into a note — the echoed manager question (source_excerpt). A clean
    observation with a crossing excerpt must still be refused (the excerpt shows on the surface)."""
    cid = "ctx_feat033_ex_" + label.replace("-", "_")
    with pytest.raises(ValueError, match="red line"):
        registry.append_note(cid, "The team is colliding on the same week; worth a sequencing chat.", form)
    assert registry.list_notes(cid) == [], f"[{label}] a crossing EXCERPT LANDED: {form!r}"


# ============================================================================================
# POST-ADVISE HOOK — write_note_from_manifest() DISCARDS each form (both observation and excerpt)
# ============================================================================================

def _manifest(read: str) -> dict:
    return {"type": "manifest", "redline_passed": True,
            "transcript": {"advice": {"read": read, "move": "have the conversation",
                                      "framing": "open it kindly"}}}


@pytest.mark.parametrize("label,obs", FEAT033_FORMS)
def test_hook_discards_form_in_observation(label, obs):
    reg = ContextRegistry()
    result = notes_hook.write_note_from_manifest(reg, "ctx_hook", _manifest(obs), "how is she doing")
    assert result is None, f"[{label}] the hook persisted a crossing observation: {obs!r}"
    assert reg.list_notes("ctx_hook") == [], f"[{label}] a crossing observation LANDED via the hook"


@pytest.mark.parametrize("label,form", FEAT033_FORMS)
def test_hook_discards_form_in_source_excerpt(label, form):
    """A clean advice read but a crossing manager question (echoed as the excerpt) — the hook's
    independent re-validation of observation+excerpt DISCARDS it: no note, no nudge."""
    reg = ContextRegistry()
    clean_read = "The team keeps colliding on the same week — worth a sequencing conversation."
    result = notes_hook.write_note_from_manifest(reg, "ctx_hook_ex", _manifest(clean_read), form)
    assert result is None, f"[{label}] the hook persisted a crossing excerpt: {form!r}"
    assert reg.list_notes("ctx_hook_ex") == [], f"[{label}] a crossing excerpt LANDED via the hook"


def test_clean_work_observation_still_lands():
    """The gate is not a blunt number-blocker: a work-quantified observation (40% of the WORK) lands."""
    reg = ContextRegistry()
    note = notes_hook.write_note_from_manifest(reg, "ctx_clean", _manifest(CLEAN_WORK_OBS),
                                               "the onboarding backlog keeps piling up")
    assert note is not None and note.text == CLEAN_WORK_OBS
    assert len(reg.list_notes("ctx_clean")) == 1


# ============================================================================================
# HTTP SURFACE — POST /advise -> GET /team/{id}/notes: a crossing question never becomes a note
# ============================================================================================

def _http_client(monkeypatch):
    monkeypatch.setenv("AVERY_BRAIN", "mock")
    monkeypatch.setenv("AVERY_EMBEDDINGS", "keyword")
    monkeypatch.setenv("AVERY_EXTRACTOR", "heuristic")
    monkeypatch.delenv("AVERY_DB_URL", raising=False)
    monkeypatch.delenv("PGVECTOR_URL", raising=False)
    from avery.ingest.registry import REGISTRY
    REGISTRY.clear()
    from service.app import app
    from fastapi.testclient import TestClient
    return TestClient(app)


# HTTP questions whose ~60-char lead (the echoed source_excerpt) carries each form.
HTTP_FORM_QUESTIONS = [
    "rank: Marcus #1, Anna #5 — how do I coach the whole team back up?",
    "Her mood is at 30% and capacity 40% right now — how do I support her?",
    "李雷:9分,排名第一,我到底该怎么带好这个团队的节奏?",
]


@pytest.mark.parametrize("question", HTTP_FORM_QUESTIONS)
def test_http_crossing_question_never_becomes_a_note(monkeypatch, question):
    pytest.importorskip("fastapi.testclient")
    from pathlib import Path
    client = _http_client(monkeypatch)
    fix = Path(__file__).resolve().parent / "fixtures" / "ingest"
    files = [("files", (p.name, p.read_bytes(), "application/octet-stream"))
             for p in (fix / "Studio_Handbook.md", fix / "Team_Roster.xlsx")]
    cid = client.post("/ingest", files=files).json()["context_id"]

    ar = client.post("/advise", json={"situation": question, "company_context_id": cid, "stream": False})
    assert ar.status_code == 200
    notes = client.get(f"/team/{cid}/notes").json()["notes"]
    assert notes == [], f"a crossing question became a persisted note: {question!r}"


def test_http_clean_question_does_write_a_note(monkeypatch):
    """Control: a clean question DOES leave one note — proving the empty result above is the gate
    firing on the form, not a broken write path."""
    pytest.importorskip("fastapi.testclient")
    from pathlib import Path
    client = _http_client(monkeypatch)
    fix = Path(__file__).resolve().parent / "fixtures" / "ingest"
    files = [("files", (p.name, p.read_bytes(), "application/octet-stream"))
             for p in (fix / "Studio_Handbook.md", fix / "Team_Roster.xlsx")]
    cid = client.post("/ingest", files=files).json()["context_id"]
    client.post("/advise", json={"situation": "The onboarding backlog keeps landing on one squad; how do I rebalance?",
                                 "company_context_id": cid, "stream": False})
    notes = client.get(f"/team/{cid}/notes").json()["notes"]
    assert len(notes) == 1, "a clean question should leave exactly one note"
