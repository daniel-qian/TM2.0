"""feat-023 — LLMExtractor battery (offline, deterministic: a scripted fake brain, no network).

maker != checker with the 07-07 lesson applied: these tests do NOT certify extraction QUALITY on
real docs (that is the @seedgate integration layer with a real model); they certify the machine
around the model — the parts that must hold no matter what the model says:

  (a) entities are built from the model's JSON with SOURCE LINE refs that resolve (cite chain);
  (b) the red line is layered: a smuggled scoring key dies in the sanitizer; a rating inside
      free text makes the whole doc fall back to the heuristic (never a poisoned payload);
  (c) any model failure (garbage JSON, exception, empty result) falls back to the heuristic;
  (d) header cells / filename titles are refused even if the model emits them;
  (e) the factory: env knobs pick llm/heuristic, and keyless environments degrade to heuristic;
  (f) parse-level mojibake cleaning (U+FFFD / ligatures / soft hyphens never enter a ParsedDoc).
"""
from __future__ import annotations

import json

import pytest

from avery.brain import BrainResponse
from avery.ingest import LLMExtractor, FallbackExtractor, HeuristicExtractor
from avery.ingest.parse import ParsedDoc, parse_bytes

# --- scripted brains ---------------------------------------------------------------------------


class FakeBrain:
    """Returns a fixed JSON text once per respond() call (cycled if windowed)."""
    name = "fake"

    def __init__(self, payloads):
        self._payloads = list(payloads)
        self.calls = 0

    def respond(self, system, conversation, tools):
        self.calls += 1
        body = self._payloads[min(self.calls - 1, len(self._payloads) - 1)]
        return BrainResponse(text=body if isinstance(body, str) else json.dumps(body))


class ExplodingBrain:
    name = "exploding"

    def respond(self, system, conversation, tools):
        raise RuntimeError("model down")


ROSTER_DOC = ParsedDoc(
    name="Team.xlsx",
    text="\n".join([
        "# sheet: Profile",
        "No. | Name | Title | Background",
        "1 | Lin Qing | Design Director | 8 years of B2B design",
        "2 | Chen Mingyuan | Founder / CEO | 10 years of design leadership",
    ]),
    doc_kind="roster", ext="xlsx")


def _good_payload():
    return {
        "people": [
            {"name": "Lin Qing", "role": "Design Director", "team": "Design",
             "tenure": "8 years of B2B design", "owns": ["design reviews"], "line": 3},
            {"name": "Chen Mingyuan", "role": "Founder / CEO", "team": "Founders",
             "tenure": "10 years of design leadership", "owns": [], "line": 4},
        ],
        "projects": [
            {"title": "Phase 1 rollout", "status": "done", "progress": 100, "line": 2},
            {"title": "Phase 2 rollout", "status": "on-track", "progress": None, "line": 2},
        ],
        "signals": [],
    }


# --- (a) happy path: entities + resolvable line sources ----------------------------------------

def test_llm_entities_carry_resolvable_line_sources():
    ex = LLMExtractor(FakeBrain([_good_payload()]))
    res = ex.extract(ROSTER_DOC)
    names = {p.name for p in res.people}
    assert names == {"Lin Qing", "Chen Mingyuan"}
    lin = next(p for p in res.people if p.name == "Lin Qing")
    assert lin.source == "Team.xlsx:3"
    # the ref resolves against the actual doc line — the cite chain's ground truth
    fname, line = lin.source.rsplit(":", 1)
    assert "Lin Qing" in ROSTER_DOC.lines[int(line) - 1]
    assert [pr.title for pr in res.projects] == ["Phase 1 rollout", "Phase 2 rollout"]
    # materials (the citable RAG corpus) exist and are line-addressed deterministically
    assert res.materials and all(":" in m.source for m in res.materials)


def test_llm_line_out_of_range_is_clamped_not_crashed():
    bad = _good_payload()
    bad["people"][0]["line"] = 99999
    res = LLMExtractor(FakeBrain([bad])).extract(ROSTER_DOC)
    lin = next(p for p in res.people if p.name == "Lin Qing")
    assert int(lin.source.rsplit(":", 1)[1]) <= len(ROSTER_DOC.lines)


# --- (b) the layered red line -------------------------------------------------------------------

def test_smuggled_scoring_key_kills_the_record_only():
    bad = _good_payload()
    bad["people"][0]["moodPct"] = 24        # the hallucinated blood bar
    res = LLMExtractor(FakeBrain([bad])).extract(ROSTER_DOC)
    names = {p.name for p in res.people}
    assert "Lin Qing" not in names, "a person dict with a scoring key must not survive"
    assert "Chen Mingyuan" in names, "clean records in the same doc must survive"


def test_rating_in_free_text_falls_back_to_heuristic():
    bad = _good_payload()
    bad["people"][0]["role"] = "Design Director, performance 9/10"   # text-smuggled rating
    ex = LLMExtractor(FakeBrain([bad]))
    res = ex.extract(ROSTER_DOC)
    # the whole doc fell back to the (red-line-safe) heuristic — never a poisoned payload
    baseline = HeuristicExtractor().extract(ROSTER_DOC)
    assert {p.name for p in res.people} == {p.name for p in baseline.people}
    from avery.ingest import validate_extraction
    assert validate_extraction(res).ok


# --- (c) failure modes fall back ---------------------------------------------------------------

def test_garbage_json_falls_back():
    ex = LLMExtractor(FakeBrain(["I refuse to answer in JSON, here's prose instead."]))
    res = ex.extract(ROSTER_DOC)
    baseline = HeuristicExtractor().extract(ROSTER_DOC)
    assert {p.name for p in res.people} == {p.name for p in baseline.people}


def test_model_exception_falls_back():
    res = LLMExtractor(ExplodingBrain()).extract(ROSTER_DOC)
    baseline = HeuristicExtractor().extract(ROSTER_DOC)
    assert {p.name for p in res.people} == {p.name for p in baseline.people}


def test_empty_result_falls_back():
    res = LLMExtractor(FakeBrain([{"people": [], "projects": [], "signals": []}])).extract(ROSTER_DOC)
    baseline = HeuristicExtractor().extract(ROSTER_DOC)
    assert {p.name for p in res.people} == {p.name for p in baseline.people}


def test_fallback_extractor_with_no_primary_is_pure_heuristic():
    res = FallbackExtractor(None).extract(ROSTER_DOC)
    baseline = HeuristicExtractor().extract(ROSTER_DOC)
    assert {p.name for p in res.people} == {p.name for p in baseline.people}


# --- (d) header cells / filename titles refused -------------------------------------------------

def test_header_cells_and_filename_titles_refused_even_from_the_model():
    bad = _good_payload()
    bad["people"].insert(0, {"name": "No.", "role": "Founder", "line": 2})
    bad["people"].insert(1, {"name": "Case ID", "role": "", "line": 2})
    bad["projects"].insert(0, {"title": "Team", "line": 1})          # filename stem 'Team'
    res = LLMExtractor(FakeBrain([bad])).extract(ROSTER_DOC)
    names = {p.name for p in res.people}
    assert names == {"Lin Qing", "Chen Mingyuan"}
    assert all(pr.title.lower() != "team" for pr in res.projects)


# --- (e) factory knobs ---------------------------------------------------------------------------

def test_factory_forced_heuristic(monkeypatch):
    monkeypatch.setenv("AVERY_EXTRACTOR", "heuristic")
    from service import extractor_factory
    assert isinstance(extractor_factory.make_extractor(), HeuristicExtractor)
    assert extractor_factory.active_extractor() == "heuristic"


def test_factory_keyless_auto_degrades_to_heuristic(monkeypatch):
    monkeypatch.delenv("AVERY_EXTRACTOR", raising=False)
    monkeypatch.delenv("AVERY_EXTRACTOR_BRAIN", raising=False)
    monkeypatch.delenv("MINIMAX_API_KEY", raising=False)
    monkeypatch.delenv("DEEPSEEK_API_KEY", raising=False)
    from service import extractor_factory
    assert isinstance(extractor_factory.make_extractor(), HeuristicExtractor)
    assert extractor_factory.active_extractor() == "heuristic"


def test_factory_keyed_auto_is_llm(monkeypatch):
    monkeypatch.delenv("AVERY_EXTRACTOR", raising=False)
    monkeypatch.setenv("MINIMAX_API_KEY", "test-key-not-used")   # no network happens at build time
    from service import extractor_factory
    ex = extractor_factory.make_extractor()
    assert isinstance(ex, LLMExtractor)
    assert extractor_factory.active_extractor() == "llm:minimax"


# --- (f) parse-level mojibake cleaning -----------------------------------------------------------

def test_parse_strips_mojibake_and_ligatures():
    raw = "Ofﬁce workﬂow � broken sh­yphen".encode("utf-8")
    doc = parse_bytes("notes.txt", raw)
    assert "�" not in doc.text
    assert "Office workflow" in doc.text
    assert "shyphen" in doc.text          # soft hyphen removed, word intact
