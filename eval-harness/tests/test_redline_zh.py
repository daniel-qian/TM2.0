# -*- coding: utf-8 -*-
"""feat-029 — the RED LINE in Chinese. maker != checker: these try to smuggle a person score past
the gate IN CHINESE, and (just as hard) they prove legitimate qualitative Chinese still passes.

Context: domestic users are Chinese companies feeding Chinese documents to MiniMax-M3. The red-line
gate was ENGLISH-ONLY (avery/redline.py + ingest/redline_extract.py), so a Chinese person score
(绩效评分 / 排名 / 画像 / 评级 / 潜力评估 / 情绪值 / 离职风险 …) BYPASSED every layer. This battery
closes that hole across all four layers WITHOUT weakening the English coverage and WITHOUT
false-positively rejecting legitimate qualitative Chinese (负责/主导/协作/入职18个月/带队/交付) or
project quantification (进度70% / 状态:有风险 — a project may be quantified; a PERSON may not).

The two hard contracts, in Chinese:
  1. it HARD-FAILS Chinese output that scores / ranks / grades / profiles a PERSON;
  2. it PASSES legitimate qualitative Chinese person text AND quantified PROJECT text.
"""
from __future__ import annotations

import pytest

from avery import redline
from avery.ingest import (
    validate_extraction, PersonEntity, ProjectEntity, SignalEntity, ExtractionResult,
    HeuristicExtractor, LLMExtractor,
)
from avery.ingest.redline_extract import validate_person_dict
from avery.ingest.parse import ParsedDoc
from avery.brain import BrainResponse


# =============================================================================================
# LAYER 4 — the RUNTIME advisor gate (redline.validate): a Chinese person score in ADVICE
# =============================================================================================

# CATCH — Chinese person-scoring advice MUST hard-fail.
ZH_PERSON_SCORE_ADVICE = [
    "综合来看，她这个季度的绩效评分是2分，明显偏低。",          # 绩效评分 + 评分紧邻数字
    "我建议把他的绩效评级定为不合格，写进季度考核。",            # 绩效评级 + 评级:不合格
    "给这位同事打分：8/10，在团队里排名倒数。",                 # 打分:8 + bare-scale w/ 同事
    "她属于高离职风险的人员，建议提前物色替补。",               # 离职风险
    "对他做一次员工画像，贴上『抗压差』的标签。",                # 员工画像
    "这位工程师本季度排名第3，已经踩到末位淘汰线。",            # 末位淘汰 + 排名第3
    "她的情绪值只有3，状态明显不在线，得盯一下。",              # 情绪值(+数字)
    "把张伟的KPI评分压到60分，其余人往上提。",                  # KPI评分 + 评分紧邻数字
    "他的潜力评级是C，短期不建议给核心项目。",                  # 潜力评级 + 评级
    "从考核结果看，她定级为丙等，属于末档。",                   # 考核结果 + 定级为丙
]


@pytest.mark.parametrize("text", ZH_PERSON_SCORE_ADVICE)
def test_zh_person_scoring_advice_hard_fails(text):
    res = redline.validate(text)
    assert not res.passed, f"中文人员评分逃过了红线闸: {text!r}"


# NEGATION — advising AGAINST scoring a person, in Chinese, must PASS (not itself a violation).
ZH_NEGATED_PASSES = [
    "不要给她的绩效打分，也不要排名，重点看她扛下了什么。",
    "别给团队成员评级，我们不做人的分数。",
    "无需对他做画像或贴标签，先把工作说清楚。",
    "避免把她标成离职风险，这只是正常的适应期。",
]


@pytest.mark.parametrize("text", ZH_NEGATED_PASSES)
def test_zh_negated_person_scoring_passes(text):
    res = redline.validate(text)
    assert res.passed, f"中文否定式建议被误伤 ({res.summary()}): {text!r}"


# NO-FALSE-POSITIVE — legitimate qualitative Chinese AND quantified project Chinese must PASS.
ZH_LEGIT_PASSES = [
    "项目进度70%，目前状态有风险，需要加派人手。",              # 项目量化 (进度/at-risk) — 允许
    "这个产品在同类评测里排名第一，口碑不错。",                 # 产品排名 (work) — 非人员
    "用户画像显示核心用户偏年轻化，主打移动端。",               # 用户画像 (客户) — 非团队成员
    "她主导了支付网关的交付，入职18个月，与设计团队紧密协作。",   # 纯定性人员描述 — 允许
    "他负责考勤系统的后端开发，带队交付了两个版本。",           # 负责/带队/交付 — 允许
    "市场情绪偏谨慎，但团队交付节奏一直很稳。",                 # 市场情绪 (work) — 非人员
    "她这周吸收了大量需求变更，压力不小，但都扛住了。",         # 情境描述 (carrying) — 允许
    "本次迭代覆盖率达到85%，比上个季度高不少。",               # 工作量化 — 允许
]


@pytest.mark.parametrize("text", ZH_LEGIT_PASSES)
def test_zh_legit_and_project_metrics_pass(text):
    res = redline.validate(text)
    assert res.passed, f"红线误伤合法中文 ({res.summary()}): {text!r}"


# =============================================================================================
# LAYER 1+2 — the EXTRACTION AFK gate (validate_extraction): a Chinese score on a PersonEntity
# =============================================================================================

# CATCH — a person entity carrying a Chinese score/rank/grade/profile MUST hard-fail the gate.
ZH_POISONED_PEOPLE = [
    ("绩效评分-数字", PersonEntity(id="u_1", name="王芳", role="后端工程师，绩效评分2分")),
    ("排名+评级", PersonEntity(id="u_2", name="李强", owns=["排名第2", "绩效评级：不合格"])),
    ("人才画像", PersonEntity(id="u_3", name="赵敏", role="A级人才", owns=["人才画像：进取型"])),
    ("离职风险", PersonEntity(id="u_4", name="孙宇", collaboration=["离职风险高，建议关注"])),
    ("潜力评估", PersonEntity(id="u_5", name="周洁", owns=["潜力评估：高潜"])),
    ("情绪状态值", PersonEntity(id="u_6", name="吴磊", collaboration=["情绪状态值3，状态偏低"])),
    ("KPI评分", PersonEntity(id="u_7", name="郑爽", role="产品", owns=["KPI评分88分"])),
    ("末位淘汰", PersonEntity(id="u_8", name="冯刚", collaboration=["处于末位淘汰边缘"])),
]


@pytest.mark.parametrize("label,person", ZH_POISONED_PEOPLE)
def test_zh_scored_person_hard_fails_extraction(label, person):
    res = validate_extraction(ExtractionResult(people=[person]))
    assert not res.ok, f"[{label}] 中文人员评分逃过了抽取红线闸"


# NO-FALSE-POSITIVE — a legitimate Chinese roster extracts CLEANLY (qualitative person text).
ZH_LEGIT_PEOPLE = [
    PersonEntity(id="u_a", name="李明", role="后端负责人（工程）", tenure="入职18个月",
                 owns=["负责支付网关", "主导限流改造"], collaboration=["与设计协作"]),
    PersonEntity(id="u_b", name="王芳", role="产品经理", tenure="8年经验",
                 owns=["主导支付改版", "带队交付v2"], collaboration=["与工程、设计紧密协作"]),
    PersonEntity(id="u_c", name="陈晨", role="设计负责人", tenure="入职3年",
                 owns=["负责设计系统", "参与用户画像调研"]),  # 参与"用户画像"调研 — 客户画像,不是给同事画像
]


@pytest.mark.parametrize("person", ZH_LEGIT_PEOPLE)
def test_zh_legit_person_passes_extraction(person):
    res = validate_extraction(ExtractionResult(people=[person]))
    assert res.ok, f"红线误伤合法中文人员卡 ({res.summary()}): {person.name}"


def test_zh_project_quantification_still_allowed():
    """A PROJECT may be quantified (进度/有风险) — the gate never scores a project."""
    proj = ProjectEntity(id="p_1", title="支付网关", status="at-risk", progress=70,
                         summary="进度70%，状态：有风险", blockers=["等待第三方接口", "排期第2优先级"])
    res = validate_extraction(ExtractionResult(projects=[proj]))
    assert res.ok, f"项目量化被红线误伤: {res.summary()}"


def test_zh_person_signal_scoring_caught_but_situational_passes():
    """A person-directed signal must stay at SITUATION; a Chinese scoring label is caught."""
    situational = SignalEntity(id="s_1", source_kind="doc", subjectType="person", subjectRef="u_a",
                               summary="她这周吸收了大量需求变更，交付压力较大。")
    assert validate_extraction(ExtractionResult(signals=[situational])).ok, "情境化人员信号应通过"

    scored = SignalEntity(id="s_2", source_kind="doc", subjectType="person", subjectRef="u_a",
                          summary="她绩效排名倒数第一，属于低绩效，建议纳入末位淘汰。")
    assert not validate_extraction(ExtractionResult(signals=[scored])).ok, "中文人员评分信号必须被抓"


# =============================================================================================
# LAYER 1 — structural: a Chinese scoring KEY on a raw person dict is rejected
# =============================================================================================

def test_zh_forbidden_person_keys_rejected():
    for bad in ({"name": "王芳", "绩效评分": 85}, {"name": "李强", "离职风险": "高"},
                {"name": "赵敏", "排名": 3}, {"name": "周洁", "画像": "进取型"}):
        assert validate_person_dict(bad["name"], bad), f"应拒绝中文评分键: {bad}"
    # a qualitative Chinese dict is clean
    assert not validate_person_dict("李明", {"name": "李明", "role": "后端", "tenure": "18个月",
                                             "owns": ["负责支付网关"]})


# =============================================================================================
# LAYER 3 — the LLM extractor: a smuggled Chinese person score is rejected (whole-doc fallback)
# =============================================================================================

class _FakeBrain:
    name = "fake"

    def __init__(self, payload):
        import json
        self._body = payload if isinstance(payload, str) else json.dumps(payload)

    def respond(self, system, conversation, tools):
        return BrainResponse(text=self._body)


_ROSTER_DOC = ParsedDoc(
    name="Team.xlsx",
    text="\n".join([
        "# sheet: Profile",
        "No. | Name | Title | Background",
        "1 | Lin Qing | Design Director | 8 years of B2B design",
        "2 | Chen Mingyuan | Founder / CEO | 10 years of design leadership",
    ]),
    doc_kind="roster", ext="xlsx")


def test_zh_scoring_lexicon_falls_back_whole_doc():
    """A model that smuggles a Chinese person score into a person field must not poison the payload:
    the red-line gate INSIDE the extractor catches it and the doc falls back to the heuristic."""
    payload = {
        "people": [
            {"name": "Lin Qing", "role": "Design Director",
             "owns": ["绩效评级：不合格", "排名倒数第一"], "line": 3},   # 中文人员评分
            {"name": "Chen Mingyuan", "role": "Founder / CEO", "owns": [], "line": 4},
        ],
        "projects": [], "signals": [],
    }
    res = LLMExtractor(_FakeBrain(payload), retry_backoff_s=0).extract(_ROSTER_DOC)
    baseline = HeuristicExtractor().extract(_ROSTER_DOC)
    assert {p.name for p in res.people} == {p.name for p in baseline.people}, "应回退到启发式"
    assert validate_extraction(res).ok, "回退后的产物必须通过同一道红线闸"
    blob = " ".join(o for p in res.people for o in p.owns)
    assert "不合格" not in blob and "倒数第一" not in blob, "中文评分不得泄漏进人员字段"
