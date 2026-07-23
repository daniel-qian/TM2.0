# -*- coding: utf-8 -*-
"""rich-align-0722 · issue 03 — person load/mood self-report behind the scoring switch.

The person-scoring red line was UNBLOCKED (07-21) then RATIFIED (07-22): a person number is allowed
ONLY when it is the person's OWN self-report, only when the operator flips AVERY_ALLOW_PERSON_SCORING,
and only carried WITH its caliber + source. This locks that contract end to end:

  * extraction — `- 小王｜负载自述：85%｜情绪自述：吃紧` → PersonEntity.self_report {load, mood};
    ONLY 自述-suffixed labels are read; load is 0..100 (out-of-range REJECTED, not clamped); mood maps
    to the qualitative enum, out-of-vocab kept verbatim as `other`; a bare 「负载：95%」 (no 自述) is NOT
    a self-report and produces NO person at all.
  * the moat holds — self_report is a typed slot, never in _person_text_fields, never a forbidden KEY,
    so validate_extraction stays green on it; a stray rating-shaped number on any OTHER field is STILL
    a hard fail (the switch does not weaken the detector).
  * projection is switch-gated (BOTH directions on the same input) — OFF: team_cards is byte-identical
    to the pre-03 qualitative card (no self_report), payload has no scoring_enabled; ON: self_report is
    projected with caliber+source and the payload carries scoring_enabled: true.
  * storage is NOT switch-gated — the extraction always holds self_report (母本不随开关重铸); only the
    projection reads the switch.
"""
from __future__ import annotations

import pytest

from avery.ingest import (
    ContextRegistry, ingest_docs, parse_bytes, validate_extraction, PersonEntity, ExtractionResult,
)
from avery.ingest.extract import HeuristicExtractor
from avery.scoring_policy import ENV_VAR


WEEKLY = "\n".join([
    "# 三亚湾营销部·本周周报",
    "## 项目：海棠湾婚宴中心筹备",
    "负责人：小王",
    "状态：进行中",
    "进度：58%",
    "## 人员动态",
    "- 小王｜负载自述：85%｜情绪自述：吃紧",
    "- 小张｜负载自述：40%｜情绪自述：如常",
    "- 小李｜情绪自述：还没定",
    "- 小赵｜负载：95%",
    "",
])


def _people(md_text: str) -> dict[str, PersonEntity]:
    doc = parse_bytes("weekly.md", md_text.encode("utf-8"))
    ex = HeuristicExtractor().extract(doc)
    return {p.name: p for p in ex.people}


def _team_cards(md_text: str, monkeypatch, *, allow: bool) -> list[dict]:
    if allow:
        monkeypatch.setenv(ENV_VAR, "1")
    else:
        monkeypatch.delenv(ENV_VAR, raising=False)
    reg = ContextRegistry()
    rep = ingest_docs([parse_bytes("weekly.md", md_text.encode("utf-8"))],
                      extractor=HeuristicExtractor(), registry=reg)
    return rep.context.team_cards()


# === extraction ================================================================================

def test_selfreport_load_and_mood_extracted():
    ppl = _people(WEEKLY)
    wang = ppl["小王"]
    assert wang.self_report is not None
    assert wang.self_report.load is not None
    assert wang.self_report.load.value == 85
    assert wang.self_report.load.caliber == "本人自述"
    assert wang.self_report.load.source.startswith("weekly.md:")
    assert wang.self_report.mood is not None
    assert wang.self_report.mood.value == "strained"   # 吃紧
    assert wang.self_report.mood.valueRaw == ""         # in-vocab: no raw echo


def test_selfreport_mood_vocab_maps():
    ppl = _people(WEEKLY)
    assert ppl["小张"].self_report.mood.value == "steady"     # 如常
    assert ppl["小张"].self_report.load.value == 40


def test_selfreport_out_of_vocab_mood_is_other_with_raw_echo():
    ppl = _people(WEEKLY)
    li = ppl["小李"]
    assert li.self_report.mood.value == "other"
    assert li.self_report.mood.valueRaw == "还没定"          # verbatim, not rewritten
    assert li.self_report.load is None                        # 只报了情绪 → 负载缺席


def test_bare_person_number_without_selfreport_suffix_yields_no_person():
    # 小赵 wrote 「负载：95%」 with NO 自述 suffix → NOT a self-report → NOT a person.
    ppl = _people(WEEKLY)
    assert "小赵" not in ppl


def test_load_out_of_range_is_rejected_not_clamped():
    ppl = _people("## 人员动态\n- 小钱｜负载自述：150%｜情绪自述：如常\n")
    qian = ppl["小钱"]
    # load rejected (超界不收), but mood still read → person exists with mood only.
    assert qian.self_report is not None
    assert qian.self_report.load is None
    assert qian.self_report.mood.value == "steady"


# === the moat still holds ======================================================================

def test_selfreport_passes_the_extraction_redline():
    doc = parse_bytes("weekly.md", WEEKLY.encode("utf-8"))
    res = HeuristicExtractor().extract(doc)
    gate = validate_extraction(res)
    assert gate.ok, gate.summary()


def test_stray_rating_number_on_a_person_field_still_hard_fails():
    # self_report is NOT a licence to smuggle a rating onto other person fields.
    res = ExtractionResult()
    res.people.append(PersonEntity(id="u_x", name="小王", role="综合评分 8/10 的销售"))
    gate = validate_extraction(res)
    assert not gate.ok
    assert any(v.kind in ("person-score-value", "person-score-text") for v in gate.violations)


# === projection is switch-gated (both directions) ==============================================

def test_projection_off_world_has_no_selfreport(monkeypatch):
    cards = {c["name"]: c for c in _team_cards(WEEKLY, monkeypatch, allow=False)}
    assert "self_report" not in cards["小王"]        # byte-identical to pre-03 qualitative card
    assert "self_report" not in cards["小张"]


def test_projection_on_world_projects_selfreport_with_provenance(monkeypatch):
    cards = {c["name"]: c for c in _team_cards(WEEKLY, monkeypatch, allow=True)}
    sr = cards["小王"]["self_report"]
    assert sr["load"]["value"] == 85
    assert sr["load"]["caliber"] == "本人自述"
    assert sr["load"]["source"].startswith("weekly.md:")
    assert sr["mood"]["value"] == "strained"
    # out-of-vocab mood echoes the doc word
    assert cards["小李"]["self_report"]["mood"]["valueRaw"] == "还没定"


def test_projection_on_world_still_omits_free_number_keys(monkeypatch):
    # ON only opens the self_report slot — no moodPct/capacityPct/score ever appears as a free key.
    cards = _team_cards(WEEKLY, monkeypatch, allow=True)
    for c in cards:
        for k in ("moodPct", "capacityPct", "mood", "capacity", "score", "rank", "rating", "tier"):
            assert k not in c


def test_payload_scoring_enabled_flag_is_switch_gated(monkeypatch):
    from service.ingest_api import _team_payload
    reg = ContextRegistry()
    rep = ingest_docs([parse_bytes("weekly.md", WEEKLY.encode("utf-8"))],
                      extractor=HeuristicExtractor(), registry=reg)
    monkeypatch.delenv(ENV_VAR, raising=False)
    off = _team_payload(rep.context)
    assert "scoring_enabled" not in off               # absent-when-false (account_linked semantics)
    monkeypatch.setenv(ENV_VAR, "1")
    on = _team_payload(rep.context)
    assert on["scoring_enabled"] is True


# === storage is not switch-gated ===============================================================

def test_extraction_holds_selfreport_regardless_of_switch(monkeypatch):
    # 母本不随开关重铸：the extraction always carries self_report; only projection reads the switch.
    monkeypatch.delenv(ENV_VAR, raising=False)
    ppl = _people(WEEKLY)
    assert ppl["小王"].self_report is not None
    monkeypatch.setenv(ENV_VAR, "1")
    ppl2 = _people(WEEKLY)
    assert ppl2["小王"].self_report is not None


# === heuristic / LLM shape parity ==============================================================

class _FakeBrain:
    name = "fake"

    def __init__(self, payload):
        self._payload = payload

    def respond(self, system, conversation, tools):
        import json
        from avery.brain import BrainResponse
        return BrainResponse(text=json.dumps(self._payload))


def _llm_people(payload) -> dict[str, PersonEntity]:
    from avery.ingest import LLMExtractor
    from avery.ingest.parse import ParsedDoc
    doc = ParsedDoc(name="weekly.md", text="# 周报\n人员动态\n- 小王 自述\n", doc_kind="project", ext="md")
    res = LLMExtractor(_FakeBrain(payload), retry_backoff_s=0).extract(doc)
    return {p.name: p for p in res.people}


def test_llm_selfreport_same_shape_as_heuristic():
    payload = {
        "people": [
            {"name": "小王", "role": "销售", "line": 3,
             "self_report": {"load": {"value": 85}, "mood": {"value": "吃紧"}}},
            {"name": "小李", "role": "运营", "line": 3,
             "self_report": {"mood": {"value": "还没定"}}},   # out-of-vocab → other + raw echo
        ],
        "projects": [], "signals": [],
    }
    ppl = _llm_people(payload)
    wang = ppl["小王"].self_report
    assert wang.load.value == 85 and wang.load.caliber == "本人自述"
    assert wang.mood.value == "strained" and wang.mood.valueRaw == ""
    li = ppl["小李"].self_report
    assert li.mood.value == "other" and li.mood.valueRaw == "还没定" and li.load is None


def test_llm_out_of_range_load_rejected_and_forbidden_key_still_dies():
    # out-of-range load dropped (not clamped); a forbidden free key on the person kills the record.
    payload = {
        "people": [
            {"name": "小张", "line": 3, "self_report": {"load": {"value": 150}}},
            {"name": "小赵", "line": 3, "mood": 90},   # free forbidden key → validate_person_dict drops it
        ],
        "projects": [], "signals": [],
    }
    ppl = _llm_people(payload)
    assert ppl["小张"].self_report is None            # 150 rejected → no surviving metric → slot None
    assert "小赵" not in ppl                           # free scoring key → whole record dropped
