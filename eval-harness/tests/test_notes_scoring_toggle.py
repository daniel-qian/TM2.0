# -*- coding: utf-8 -*-
"""feat-033 (policy pivot, 2026-07-13) — the AVERY_ALLOW_PERSON_SCORING unblock switch, tested
BIDIRECTIONALLY at the non-frozen enforcement seams (the storage-door seam, memory + Postgres, lives
in test_registry_contract.py alongside the shared fixture).

Danny reversed the "a person is never scored / ranked / profiled" red line for real companies. The
switch (avery.scoring_policy) lets a scoring observation / extraction persist when EXPLICITLY on,
while default-OFF preserves the shipped moat verbatim. Every behavioral test here asserts BOTH
directions on the SAME input — OFF blocks, ON allows — so the switch can neither silently fail-open
(always allow) nor fail-closed (always block).

What is NOT unblocked (guards below): the detector itself (avery.redline / redline_extract) and the
frozen advisor engine are untouched; the switch builds no feature (person cards stay qualitative —
still no score fields); and it does NOT unblock non-red-line failures (a parse-failure ingest is
still refused).

Seams here:
  * switch parsing      avery.scoring_policy.person_scoring_allowed
  * post-advise hook    service.notes.write_note_from_manifest (observation AND echoed excerpt)
  * upload extraction   avery.ingest.pipeline.ingest_docs (a scored PersonEntity)
  * HTTP surface        POST /advise -> GET /team/{id}/notes
  * FREE score keys      CompanyContext.team_cards() NEVER emits a free moodPct/capacity/score key —
                         even with scoring on (rich-align-0722/03 later added the ONE sanctioned slot,
                         `self_report`, projected only when on; the free-key moat below is unchanged).
"""
from __future__ import annotations

from pathlib import Path

import pytest

from avery.ingest import ExtractionResult, PersonEntity, ContextRegistry, ingest_docs, parse_file
from avery.scoring_policy import ENV_VAR, person_scoring_allowed
from service import notes as notes_hook

HERE = Path(__file__).resolve().parent
FIX = HERE / "fixtures" / "ingest"
RESUME = FIX / "Lena_Park_Resume.docx"

# EN + ZH person-scoring forms the BASELINE red line genuinely catches (so OFF truly blocks and ON
# truly unblocks — a meaningful bidirectional pair, not a form the detector never saw).
SCORING_OBS = "She is a low performer — score her 2 out of 10 on delivery."
SCORING_OBS_ZH = "综合来看，她这个季度的绩效评分是2分，明显偏低。"
CLEAN_OBS = "The onboarding backlog keeps landing on one squad — a load problem, not a person."


# ==============================================================================================
# (0) the switch itself — truthy parsing, fail-closed on anything else, read live (no import cache)
# ==============================================================================================

@pytest.mark.parametrize("value,expected", [
    ("1", True), ("true", True), ("TRUE", True), ("  yes  ", True), ("on", True), ("On", True),
    ("0", False), ("false", False), ("off", False), ("no", False), ("", False),
    ("2", False), ("enabled", False), ("y", False), ("garbage", False),
])
def test_switch_parses_only_explicit_truthy(monkeypatch, value, expected):
    monkeypatch.setenv(ENV_VAR, value)
    assert person_scoring_allowed() is expected


def test_switch_defaults_off_when_unset(monkeypatch):
    monkeypatch.delenv(ENV_VAR, raising=False)
    assert person_scoring_allowed() is False, "an unset switch must fail closed (moat holds)"


# ==============================================================================================
# (1) post-advise hook — write_note_from_manifest DISCARDS (off) / PERSISTS (on), both fields
# ==============================================================================================

def _manifest(read: str) -> dict:
    return {"type": "manifest", "redline_passed": True,
            "transcript": {"advice": {"read": read, "move": "have the conversation",
                                      "framing": "open it kindly"}}}


@pytest.mark.parametrize("obs", [SCORING_OBS, SCORING_OBS_ZH])
def test_hook_discards_scoring_observation_when_off(monkeypatch, obs):
    monkeypatch.delenv(ENV_VAR, raising=False)
    reg = ContextRegistry()
    assert notes_hook.write_note_from_manifest(reg, "ctx_off", _manifest(obs), "how is she doing") is None
    assert reg.list_notes("ctx_off") == [], "switch OFF: a crossing observation must not land"


@pytest.mark.parametrize("obs", [SCORING_OBS, SCORING_OBS_ZH])
def test_hook_persists_scoring_observation_when_on(monkeypatch, obs):
    monkeypatch.setenv(ENV_VAR, "1")
    reg = ContextRegistry()
    note = notes_hook.write_note_from_manifest(reg, "ctx_on", _manifest(obs), "how is she doing")
    assert note is not None and note.text == obs, "switch ON: the scoring observation must persist"
    assert len(reg.list_notes("ctx_on")) == 1


def test_hook_scoring_excerpt_blocked_off_persisted_on(monkeypatch):
    """The SECOND note field — the echoed manager question (source_excerpt). A clean observation with
    a scoring excerpt is DISCARDED when off (the excerpt shows on the surface) and persists when on."""
    clean_read = "The team keeps colliding on the same week — worth a sequencing conversation."
    scoring_q = "why did I score her 2 out of 10 last cycle"

    monkeypatch.delenv(ENV_VAR, raising=False)
    reg_off = ContextRegistry()
    assert notes_hook.write_note_from_manifest(reg_off, "ctx", _manifest(clean_read), scoring_q) is None
    assert reg_off.list_notes("ctx") == []

    monkeypatch.setenv(ENV_VAR, "1")
    reg_on = ContextRegistry()
    note = notes_hook.write_note_from_manifest(reg_on, "ctx", _manifest(clean_read), scoring_q)
    assert note is not None and note.source_excerpt.startswith("why did I score")


def test_hook_clean_observation_lands_regardless_of_switch(monkeypatch):
    """Control both ways: a clean, work-focused observation lands whether the switch is on or off —
    the switch only ever RELAXES, it never blocks something that already passed."""
    for state in ("off", "on"):
        if state == "off":
            monkeypatch.delenv(ENV_VAR, raising=False)
        else:
            monkeypatch.setenv(ENV_VAR, "1")
        reg = ContextRegistry()
        note = notes_hook.write_note_from_manifest(reg, "ctx_clean", _manifest(CLEAN_OBS), "the backlog piles up")
        assert note is not None and note.text == CLEAN_OBS, f"[{state}] a clean observation must land"


# ==============================================================================================
# (2) upload extraction — ingest_docs refuses (off) / builds a context (on) a scored PersonEntity
# ==============================================================================================

class _ScoringExtractor:
    """A (hypothetical LLM) extractor that scored a person in a free-text field — the exact shape the
    frozen extraction gate hard-fails. Mirrors test_ingest.test_pipeline_refuses_to_publish_*."""
    def extract(self, doc):
        return ExtractionResult(people=[
            PersonEntity(id="u_bad", name="Marcus", role="Engineer, rated 9/10, top 5%")])


def test_ingest_refuses_a_scoring_extraction_when_off(monkeypatch):
    monkeypatch.delenv(ENV_VAR, raising=False)
    reg = ContextRegistry()
    rep = ingest_docs([parse_file(RESUME)], extractor=_ScoringExtractor(), registry=reg)
    assert not rep.ok and rep.context is None, "switch OFF: a scoring extraction must be refused"
    assert rep.violations, "the person-scoring violations must still be reported"
    assert len(reg._by_id) == 0, "no context is registered for a refused scoring extraction"


def test_ingest_allows_a_scoring_extraction_when_on(monkeypatch):
    monkeypatch.setenv(ENV_VAR, "1")
    reg = ContextRegistry()
    rep = ingest_docs([parse_file(RESUME)], extractor=_ScoringExtractor(), registry=reg)
    assert rep.ok and rep.context is not None, "switch ON: the scored document must build a context"
    assert rep.context_id, "an accepted ingest returns a context_id"
    assert len(reg._by_id) == 1, "the context is registered and retrievable"
    # The violations are still carried in the report for audit — allowing is not the same as blindness.
    assert rep.redline.violations, "the report still records the person-scoring violations it allowed"


def test_ingest_still_refuses_unparseable_batch_when_on(monkeypatch, tmp_path):
    """The switch unblocks PERSON-SCORING only. A batch with no parseable content is a different hard
    failure (the `paths and not docs` branch) and stays refused with the switch on."""
    monkeypatch.setenv(ENV_VAR, "1")
    from avery.ingest import ingest_paths
    junk = tmp_path / "mystery.xyz"
    junk.write_bytes(b"\x01\x02 not a parseable document \x03")
    rep = ingest_paths([str(junk)], registry=ContextRegistry())
    assert not rep.ok and rep.context is None, "an unparseable batch must stay refused (not a red-line case)"


# ==============================================================================================
# (3) NO FREE SCORE KEY — person cards never carry a free moodPct/capacity/score field, switch or not
#     (rich-align-0722/03 added the ONE sanctioned slot `self_report`; this fixture has none, and the
#      free-key moat asserted here is unchanged. The self_report contract is in
#      test_person_selfreport_switch_03.py.)
# ==============================================================================================

def test_team_cards_stay_qualitative_when_switch_on(monkeypatch):
    """Even with scoring persisted, the live person card carries NO free score/mood/capacity KEY.
    team_cards() omits them by construction (PersonEntity has no such numeric attribute), and the
    switch opens only the typed `self_report` slot — never a free scoring key (this fixture, a resume
    with no self-report lines, projects no self_report at all, in either world)."""
    monkeypatch.setenv(ENV_VAR, "1")
    reg = ContextRegistry()
    rep = ingest_docs([parse_file(RESUME)], extractor=_ScoringExtractor(), registry=reg)
    assert rep.ok
    for card in rep.context.team_cards():
        assert "moodPct" not in card and "capacityPct" not in card
        for key in card:
            assert key.lower() not in ("mood", "capacity", "score", "rating", "rank", "tier")


# ==============================================================================================
# (4) HTTP surface — POST /advise -> GET /team/{id}/notes: a scoring question's echoed excerpt is
#     dropped when off, persisted and user-visible when on. Offline (mock brain, keyword, no DB).
# ==============================================================================================

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


def _ingest_context(client):
    """feat-038: returns (context_id, owner-token header) — later reads/advise present the token."""
    files = [("files", (p.name, p.read_bytes(), "application/octet-stream"))
             for p in (FIX / "Studio_Handbook.md", FIX / "Team_Roster.xlsx")]
    body = client.post("/ingest", files=files).json()
    return body["context_id"], {"X-Avery-Token": body["owner_token"]}


# a question whose ~60-char lead (the echoed excerpt) carries a baseline-caught scoring form.
SCORING_QUESTION = "She is a low performer, score her 2/10 — how do I coach the whole team back up?"


def test_http_scoring_question_dropped_when_off(monkeypatch):
    pytest.importorskip("fastapi.testclient")
    monkeypatch.delenv(ENV_VAR, raising=False)
    client = _http_client(monkeypatch)
    cid, hdr = _ingest_context(client)
    assert client.post("/advise", json={"situation": SCORING_QUESTION,
                                        "company_context_id": cid, "stream": False},
                       headers=hdr).status_code == 200
    assert client.get(f"/team/{cid}/notes", headers=hdr).json()["notes"] == [], "switch OFF: no scoring note"


def test_http_scoring_question_persists_when_on(monkeypatch):
    pytest.importorskip("fastapi.testclient")
    monkeypatch.setenv(ENV_VAR, "1")
    client = _http_client(monkeypatch)
    cid, hdr = _ingest_context(client)
    assert client.post("/advise", json={"situation": SCORING_QUESTION,
                                        "company_context_id": cid, "stream": False},
                       headers=hdr).status_code == 200
    notes = client.get(f"/team/{cid}/notes", headers=hdr).json()["notes"]
    assert len(notes) == 1, "switch ON: the scoring question's note is persisted and user-visible"
    assert "score her 2/10" in notes[0]["source_excerpt"], "the scoring excerpt is what now shows"
