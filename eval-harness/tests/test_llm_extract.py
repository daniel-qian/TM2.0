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
    ex = LLMExtractor(FakeBrain([_good_payload()]), retry_backoff_s=0)
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
    res = LLMExtractor(FakeBrain([bad]), retry_backoff_s=0).extract(ROSTER_DOC)
    lin = next(p for p in res.people if p.name == "Lin Qing")
    assert int(lin.source.rsplit(":", 1)[1]) <= len(ROSTER_DOC.lines)


# --- (b) the layered red line -------------------------------------------------------------------

def test_smuggled_scoring_key_kills_the_record_only():
    bad = _good_payload()
    bad["people"][0]["moodPct"] = 24        # the hallucinated blood bar
    res = LLMExtractor(FakeBrain([bad]), retry_backoff_s=0).extract(ROSTER_DOC)
    names = {p.name for p in res.people}
    assert "Lin Qing" not in names, "a person dict with a scoring key must not survive"
    assert "Chen Mingyuan" in names, "clean records in the same doc must survive"


def test_rating_shaped_numbers_are_stripped_not_fatal():
    """Real staffing tables put '80%' next to a person; the model sometimes copies it. The
    sanitizer STRIPS the rating-shaped number (person survives, qualitative text intact) instead
    of collapsing the whole doc to the heuristic — this exact shape flaked the seed gate live
    (LogiPulse pdf, 8 people with allocation %)."""
    bad = _good_payload()
    bad["people"][0]["role"] = "Design Director, performance 9/10"
    bad["people"][1]["tenure"] = "80% allocated, throughout"
    bad["people"][1]["owns"] = ["~10%", "project lead across Phase 1"]
    ex = LLMExtractor(FakeBrain([bad]), retry_backoff_s=0)
    res = ex.extract(ROSTER_DOC)
    by = {p.name: p for p in res.people}
    assert set(by) == {"Lin Qing", "Chen Mingyuan"}, "people must survive a smuggled percent"
    assert "9/10" not in by["Lin Qing"].role and "Design Director" in by["Lin Qing"].role
    assert "80%" not in by["Chen Mingyuan"].tenure
    assert by["Chen Mingyuan"].owns == ["project lead across Phase 1"]  # pure-% item dropped
    from avery.ingest import validate_extraction
    assert validate_extraction(res).ok, "stripped output must pass the same red-line gate"


def test_scoring_lexicon_still_falls_back_whole_doc():
    """Stripping covers number SHAPES only. A person-scoring LABEL (red-line lexicon) still
    rejects the doc into the heuristic — the gate inside the extractor is not weakened."""
    bad = _good_payload()
    bad["people"][0]["owns"] = ["flagged as a low performer in the review"]
    res = LLMExtractor(FakeBrain([bad]), retry_backoff_s=0).extract(ROSTER_DOC)
    baseline = HeuristicExtractor().extract(ROSTER_DOC)
    assert {p.name for p in res.people} == {p.name for p in baseline.people}
    from avery.ingest import validate_extraction
    assert validate_extraction(res).ok


# --- (c) failure modes fall back ---------------------------------------------------------------

def test_garbage_json_falls_back():
    ex = LLMExtractor(FakeBrain(["I refuse to answer in JSON, here's prose instead."]), retry_backoff_s=0)
    res = ex.extract(ROSTER_DOC)
    baseline = HeuristicExtractor().extract(ROSTER_DOC)
    assert {p.name for p in res.people} == {p.name for p in baseline.people}


def test_model_exception_falls_back():
    res = LLMExtractor(ExplodingBrain(), retry_backoff_s=0).extract(ROSTER_DOC)
    baseline = HeuristicExtractor().extract(ROSTER_DOC)
    assert {p.name for p in res.people} == {p.name for p in baseline.people}


def test_empty_result_falls_back():
    res = LLMExtractor(FakeBrain([{"people": [], "projects": [], "signals": []}]), retry_backoff_s=0).extract(ROSTER_DOC)
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
    res = LLMExtractor(FakeBrain([bad]), retry_backoff_s=0).extract(ROSTER_DOC)
    names = {p.name for p in res.people}
    assert names == {"Lin Qing", "Chen Mingyuan"}
    assert all(pr.title.lower() != "team" for pr in res.projects)


# --- (d2) the SAME header defence in Chinese (feat-048, round-2 follow-up) -----------------------
# _NOT_A_PERSON is the belt to the model's suspenders: the prompt (llm_extract.py:76-77) already
# tells the model 「姓名」/「序号」/「编号」are not people, and this guard is what catches it WHEN IT
# DISOBEYS — which is the only scenario the guard exists for, so it may not assume compliance.
# Until now that belt was ASCII-only, so a misbehaving model could still ship a colleague called
# 「姓名」on the all-Chinese first customer's roster. feat-048 round 2 closed the identical hole on
# the heuristic path (extract._NOT_NAME) and that list is the source of truth; these gates assert
# the LLM path CONSULTS it rather than carrying a second hand-copied one — the duplication between
# the two lists is exactly how they drifted apart.

ZH_ROSTER_DOC = ParsedDoc(
    name="团队花名册.xlsx",
    text="\n".join([
        "# sheet: 花名册",
        "序号 | 姓名 | 职位 | 部门",
        "1 | 陈思雨 | 项目负责人 | 市场推广部",
        "2 | 孙浩 | 前厅主管 | 前厅部",
    ]),
    doc_kind="roster", ext="xlsx")


def _zh_payload():
    return {
        "people": [
            {"name": "陈思雨", "role": "项目负责人", "team": "市场推广部", "line": 3},
            {"name": "孙浩", "role": "前厅主管", "team": "前厅部", "line": 4},
        ],
        "projects": [], "signals": [],
    }


@pytest.mark.parametrize("header", ["姓名", "职位", "部门", "序号"])
def test_chinese_header_cells_refused_even_from_the_model(header):
    """BOTH HALVES IN ONE ASSERTION, deliberately. The forward half: a model that emits the header
    row as a person must not grow a colleague called 「姓名」. The reverse half: the two real
    colleagues must still be there — so the cheap "fix" of rejecting anything Han turns this red
    instead of passing. 序号 is the odd one out: it is NOT in _NOT_NAME (it lives in
    extract._INDEX_TOKEN_RE, the other half of the heuristic's defence), so it fails unless the
    reuse picks up both — which is the point."""
    bad = _zh_payload()
    bad["people"].insert(0, {"name": header, "role": "项目负责人", "line": 2})
    res = LLMExtractor(FakeBrain([bad]), retry_backoff_s=0).extract(ZH_ROSTER_DOC)
    assert {p.name for p in res.people} == {"陈思雨", "孙浩"}, f"{header!r} is a column header"


def test_llm_path_reuses_the_whole_heuristic_stop_list():
    """THE GATE THAT ENFORCES ONE LIST RATHER THAN TWO THAT AGREE TODAY.

    Asserted as a RULE over every entry of extract._NOT_NAME, not as a handful of examples: an
    example-shaped gate is satisfied by pasting four Chinese words into the regex, which is the
    same hand-copy that drifted in the first place and would drift again on the next word added.
    This one can only be satisfied by consulting the list, and it keeps paying: a word added to
    _NOT_NAME tomorrow is covered on the LLM path for free.

    _build (not extract()) is the subject on purpose — a payload of nothing but headers builds an
    empty result, which extract() would hand to the heuristic fallback, so the fallback's own
    stop-list would answer and this gate would test the wrong path. Chunked at 40 because _build
    caps people at 40 per doc."""
    from avery.ingest.extract import _NOT_NAME
    ex = LLMExtractor(FakeBrain([{}]), retry_backoff_s=0)
    words = sorted(_NOT_NAME)
    leaked: list[str] = []
    for i in range(0, len(words), 40):
        chunk = words[i:i + 40]
        res = ex._build(ZH_ROSTER_DOC, {"people": [{"name": w, "line": 2} for w in chunk]})
        leaked += [p.name for p in res.people]
    assert not leaked, f"stop-listed labels became people on the LLM path: {leaked}"


@pytest.mark.parametrize(
    "token", ["No.", "Name", "Role", "Case ID", "case-id 7", "Sheet1", "sheet: Profile", "12",
              "n/a", "tbd", "Total"])
def test_llm_path_english_rejection_is_unchanged(token):
    """BORN GREEN — the safety catch. _NOT_A_PERSON carries three patterns that are regex-ONLY and
    have no literal on _NOT_NAME (`case-id.*`, `sheet.*`, `\\d+`); routing the check through the
    shared list must keep them, not trade one hole for another."""
    res = LLMExtractor(FakeBrain([{}]), retry_backoff_s=0)._build(
        ROSTER_DOC, {"people": [{"name": token, "role": "Founder", "line": 2}]})
    assert [p.name for p in res.people] == []


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
