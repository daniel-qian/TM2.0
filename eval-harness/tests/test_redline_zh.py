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

import contextlib
import re

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


# =============================================================================================
# feat-029 RED LINE (adversarial round 2) — the crafted-input battery that found REAL defects in
# BOTH directions: the ZH logic was simultaneously TOO BROAD (false-positives on legit rosters) and
# TOO NARROW (real Chinese scores bypassed it). Part A = false-positives to STOP; Part B = bypasses
# to CATCH. The reconciliation is WORK-SUPPRESSION + NUMBER-SHAPE: a score OF a person is caught; a
# person who BUILDS scoring / has a job grade / has a year-or-tenure number PASSES.
# =============================================================================================

# ---------------------------------------------------------------------------------------------
# PART A — FALSE-POSITIVES to STOP (legit inputs wrongly REJECTED; must PASS). Highest priority.
# ---------------------------------------------------------------------------------------------

# A1 — WORK-vs-PERSON: a score word bound to a WORK ARTIFACT (系统/体系/模型/算法/逻辑…) that the
# person BUILDS/OWNS is about their WORK, not a score OF them. Or the sentence explicitly says the
# person is not scored (本人不参与考核). Must PASS.
ZH_A1_WORK_NOT_PERSON = [
    "她负责设计绩效评分系统，本人不参与考核。",
    "他负责搭建绩效评审体系。",
    "她主导设计了KPI评分系统。",
    "他是评分模型的负责人，主导打分逻辑开发。",
    "她负责搜索排名算法的优化。",
]


@pytest.mark.parametrize("text", ZH_A1_WORK_NOT_PERSON)
def test_zh_work_artifact_not_person_score_passes(text):
    res = redline.validate(text)
    assert res.passed, f"人在建评分系统被误伤 ({res.summary()}): {text!r}"


# A2 — JOB-GRADE / leveling is NOT a performance score (P7/P8/高级工程师 on a career track). Must PASS.
ZH_A2_JOB_GRADE = [
    "把他定级为P7，走技术专家通道。",
    "这位同事的职级定级为P8。",
    "员工定级为高级工程师。",
]


@pytest.mark.parametrize("text", ZH_A2_JOB_GRADE)
def test_zh_job_grade_leveling_passes(text):
    res = redline.validate(text)
    assert res.passed, f"职级定级被误当人员评分 ({res.summary()}): {text!r}"


# A5 — OTHER-SUBJECT ranking with an incidental pronoun: the grammatical subject is 公司/项目, not
# the person. Must PASS.
ZH_A5_OTHER_SUBJECT = [
    "我们公司排名行业第一。",
    "这个项目排期第2优先级。",
]


@pytest.mark.parametrize("text", ZH_A5_OTHER_SUBJECT)
def test_zh_other_subject_ranking_passes(text):
    res = redline.validate(text)
    assert res.passed, f"公司/项目排名被误伤 ({res.summary()}): {text!r}"


# A1/A2/A3 on the EXTRACTION layer — the "she:" wrapper makes _has_person always true, so bare
# anchors used to fire for ANY person field mentioning 打分/评分/排名 as WORK. These must extract ok.
ZH_A_LEGIT_OWNS = [
    ["负责绩效评审系统", "搭建评估平台架构"],        # A1 — builds scoring systems
    ["负责排名算法优化"],                            # A1 — owns a ranking algorithm
    ["负责评分模型迭代"],                            # A1 — iterates a scoring model
    ["季度定级为P7"],                                # A2 — a job grade, not a score
    ["8年经验做过绩效体系"],                          # A3 — tenure number, not a rating
    ["服务5万用户"],                                 # A3 — a count, not a rating
]


@pytest.mark.parametrize("owns", ZH_A_LEGIT_OWNS)
def test_zh_legit_work_owns_extracts_ok(owns):
    res = validate_extraction(ExtractionResult(people=[PersonEntity(id="u_x", name="安某", owns=owns)]))
    assert res.ok, f"合法工作/职级/计数被抽取红线误伤 ({res.summary()}): {owns!r}"


def test_zh_number_adjacency_needs_score_shape():
    """A topic word near a digit fires ONLY if the number is SCORE-SHAPED (N分/N/M/%/满分/N星), NOT a
    year (2023), tenure (8年), or count (5万用户)."""
    for role, owns in (
        ("安全工程师", ["风险评估报告2023"]),           # a year, not a score
        ("", ["8年经验做过绩效体系"]),                   # tenure
        ("", ["服务5万用户"]),                          # count
    ):
        res = validate_extraction(ExtractionResult(people=[PersonEntity(id="u_y", name="安某", role=role, owns=owns)]))
        assert res.ok, f"年份/工龄/计数被误当评分数字 ({res.summary()}): role={role!r} owns={owns!r}"


# ---------------------------------------------------------------------------------------------
# PART B — BYPASSES to CATCH (real scores that currently slip; must now hard-FAIL/refuse).
# ---------------------------------------------------------------------------------------------

# B6 — Traditional Chinese: EVERY lexicon term in its Traditional glyphs must fire (dependency-free
# glyph normalization).
ZH_B6_TRADITIONAL = [
    "他的績效評分是2分。",
    "她屬於高離職風險人員。",
    "對他做一次員工畫像。",
    "他的潛力評級是C。",
    "她的情緒值只有3。",
    "把他列入末位淘汰名單。",
    "同事們給他評比墊底。",
]


@pytest.mark.parametrize("text", ZH_B6_TRADITIONAL)
def test_zh_traditional_person_scoring_hard_fails(text):
    res = redline.validate(text)
    assert not res.passed, f"繁体中文人员评分逃过了红线闸: {text!r}"


def test_zh_traditional_forbidden_keys_rejected():
    for bad in ({"name": "王芳", "績效評分": 85}, {"name": "李強", "離職風險": "高"}):
        assert validate_person_dict(bad["name"], bad), f"应拒绝繁体评分键: {bad}"


# B7 — negation-lookalikes: 不得不 / 不得已 are AFFIRMATIVE ("have no choice but to"), NOT negation.
ZH_B7_FALSE_NEGATION = [
    "我不得不给他评分：只有2分。",
    "不得已给他排名倒数第一。",
]


@pytest.mark.parametrize("text", ZH_B7_FALSE_NEGATION)
def test_zh_affirmative_budé_not_treated_as_negation(text):
    res = redline.validate(text)
    assert not res.passed, f"不得不/不得已被误当否定,评分逃逸: {text!r}"


# B8 — person + a pure score-number on the advice layer (no scoring verb needed).
ZH_B8_PERSON_NUMBER = [
    "王小明 92分，李雷 78分。",
    "他的分数是2。",
    "他的 KPI=90。",
]


@pytest.mark.parametrize("text", ZH_B8_PERSON_NUMBER)
def test_zh_person_plus_score_number_hard_fails(text):
    res = redline.validate(text)
    assert not res.passed, f"人+分数逃过了红线闸: {text!r}"


# B9 — ranking synonyms, person-anchored.
ZH_B9_RANK_SYNONYMS = [
    "他属于末流员工。",
    "同事们给他差评。",
    "他名列前茅，她垫底。",
]


@pytest.mark.parametrize("text", ZH_B9_RANK_SYNONYMS)
def test_zh_ranking_synonyms_hard_fail(text):
    res = redline.validate(text)
    assert not res.passed, f"排名同义词逃过了红线闸: {text!r}"


# B10 — star ratings on a person.
ZH_B10_STARS = [
    "他是五星员工，她是一星。",
    "给这位下属打三颗星。",
]


@pytest.mark.parametrize("text", ZH_B10_STARS)
def test_zh_star_ratings_hard_fail(text):
    res = redline.validate(text)
    assert not res.passed, f"星级评分逃过了红线闸: {text!r}"


def test_zh_star_and_ranking_forbidden_keys_rejected():
    for bad in ({"name": "A", "星级": 5}, {"name": "B", "名次": 3}, {"name": "C", "评比": "优"}):
        assert validate_person_dict(bad["name"], bad), f"应拒绝星级/名次/评比键: {bad}"


# xfail — space-separated glyphs (绩 效 评 分) are a documented residual: the gate matches contiguous
# lexicon glyphs, and chasing arbitrary interior whitespace would over-fire on legit prose. The LLM
# judge (011c) is the second hard-gate dimension for such exotic paraphrases.
@pytest.mark.xfail(reason="space-separated lexicon glyphs are a documented residual; caught by the LLM judge (011c), not this pattern gate", strict=True)
def test_zh_space_separated_glyphs_residual():
    # 绩 效 评 分 with interior spaces and no score number never reassembles into a contiguous
    # lexicon match; chasing arbitrary whitespace would over-fire on legit prose.
    assert not redline.validate("他 的 绩 效 评 分 很 低。").passed


# =============================================================================================
# feat-029 RED LINE (adversarial round 3) — the round-2 work-suppression machinery was OVER-BROAD:
# it started letting genuine Chinese person-scores slip (one a REGRESSION vs round-1) and its
# extraction layer diverged from the advice layer. Part A = TIGHTEN the over-broad suppression
# (real scores must hard-FAIL again); Part B = extraction⇄advice PARITY (legit work rosters must
# extract ok); Part C = lexicon gaps (评定/分级 verbs, letter-grade-after-score-word).
# =============================================================================================

# ---------------------------------------------------------------------------------------------
# PART A — over-broad suppression now lets real scores slip (must hard-FAIL). Highest priority.
# ---------------------------------------------------------------------------------------------

# A-r3.1 — _ZH_NOT_SCORED bare 本人不 was a wildcard: 本人不服 / 本人不同意 / 本人不知情 (I object /
# I disagree) suppressed ANY nearby person score. The not-scored cue must attach to a SCORING sense.
ZH_R3_NOT_SCORED_WILDCARD = [
    "她的绩效评分是2分，本人不服。",
    "他离职风险很高，本人不知情。",
    "他排名倒数第一，本人不服。",
]


@pytest.mark.parametrize("text", ZH_R3_NOT_SCORED_WILDCARD)
def test_zh_r3_bare_benren_bu_no_longer_suppresses(text):
    res = redline.validate(text)
    assert not res.passed, f"本人不X 被误当『未被评分』,人员评分逃逸: {text!r}"


def test_zh_r3_not_scored_wildcard_extraction():
    for owns, collab in ((["绩效评分2分，本人不服"], []), ([], ["离职风险高，本人不知情"])):
        res = validate_extraction(ExtractionResult(people=[
            PersonEntity(id="u_r3a", name="安某", owns=owns, collaboration=collab)]))
        assert not res.ok, f"本人不X 让抽取层漏抓人员评分: owns={owns!r} collab={collab!r}"


def test_zh_r3_specific_not_scored_cue_still_passes():
    # the SPECIFIC scoring-anchored cue still suppresses (person BUILDS scoring, opts out of it)
    assert redline.validate("她负责设计绩效评分系统，本人不参与考核。").passed


# A-r3.2 — _ZH_ARTIFACT bare morphemes 系/表现/标准/指标 collided with 系统性/表现/标准/指标 as SCORE
# continuations. Whole-word artifacts only, so these no longer read as artifacts.
ZH_R3_ARTIFACT_MORPHEME = [
    "他绩效评分系统性偏低。",
    "他的绩效评分表现很差。",
    "他绩效评级标准差。",
]


@pytest.mark.parametrize("text", ZH_R3_ARTIFACT_MORPHEME)
def test_zh_r3_artifact_morpheme_no_longer_suppresses(text):
    res = redline.validate(text)
    assert not res.passed, f"系统性/表现/标准 被误当工作产物,人员评分逃逸: {text!r}"


def test_zh_r3_artifact_morpheme_extraction():
    res = validate_extraction(ExtractionResult(people=[
        PersonEntity(id="u_r3b", name="安某", role="绩效评分表现差")]))
    assert not res.ok, "绩效评分表现差 应被抽取红线抓到"


ZH_R3_ARTIFACT_LEGIT = [
    "她负责设计绩效评分系统。",
    "他是评分模型的负责人。",
]


@pytest.mark.parametrize("text", ZH_R3_ARTIFACT_LEGIT)
def test_zh_r3_whole_word_artifact_still_passes(text):
    assert redline.validate(text).passed, f"人在建评分系统/模型被误伤: {text!r}"


# A-r3.3 — _zh_has_target anchored at verb end: a 为/被 connective pushed the verdict label out, so
# 定级为.../排名为.../评定为... found no target and the bare-verb violation dropped.
ZH_R3_CONNECTIVE_VERDICT = [
    "把他定级为不合格。",
    "他被定级为低绩效。",
    "把他排名为倒数。",
    "他定级为差。",
    "他的职级评定为差。",
]


@pytest.mark.parametrize("text", ZH_R3_CONNECTIVE_VERDICT)
def test_zh_r3_connective_verdict_label_hard_fails(text):
    res = redline.validate(text)
    assert not res.passed, f"定级为/排名为 + 结论标签逃逸: {text!r}"


ZH_R3_CONNECTIVE_JOBGRADE = [
    "把他定级为P7。",
    "员工定级为高级工程师。",
]


@pytest.mark.parametrize("text", ZH_R3_CONNECTIVE_JOBGRADE)
def test_zh_r3_connective_jobgrade_passes(text):
    assert redline.validate(text).passed, f"职级定级(P7/高级工程师)被误伤: {text!r}"


# ---------------------------------------------------------------------------------------------
# PART B — extraction⇄advice PARITY: legit work rosters must extract ok (work-suppression + a
# complete number-shape exclusion set, matching the advice gate). A genuine person-score still fails.
# ---------------------------------------------------------------------------------------------
ZH_R3_LEGIT_WORK_OWNS = [
    ["绩效系统2.0"],
    ["排名算法优化3成"],
    ["KPI体系迭代3版"],
    ["设计评分项5项"],
    ["排名报告3份"],
]


@pytest.mark.parametrize("owns", ZH_R3_LEGIT_WORK_OWNS)
def test_zh_r3_legit_work_owns_extracts_ok(owns):
    res = validate_extraction(ExtractionResult(people=[PersonEntity(id="u_r3c", name="安某", owns=owns)]))
    assert res.ok, f"合法工作交付被抽取红线误伤 ({res.summary()}): {owns!r}"


def test_zh_r3_scoring_group_role_passes():
    res = validate_extraction(ExtractionResult(people=[
        PersonEntity(id="u_r3d", name="安某", role="评分组第3组组长")]))
    assert res.ok, f"评分组组长(工作角色)被误伤: {res.summary()}"


def test_zh_r3_genuine_person_score_number_still_caught():
    res = validate_extraction(ExtractionResult(people=[
        PersonEntity(id="u_r3e", name="安某", owns=["绩效评分2分"])]))
    assert not res.ok, "真正的人员评分数字(绩效评分2分)必须仍被抓到"


# ---------------------------------------------------------------------------------------------
# PART C — lexicon gaps: 评定 / 分级 verbs (person-scoped), and a letter grade after a scoring word.
# Job grades (P7/T5/高级) must NOT be swept in by the letter-grade rule.
# ---------------------------------------------------------------------------------------------
ZH_R3_NEW_VERBS_AND_LETTERS = [
    "他绩效分级为差。",
    "他被评定为不合格。",
    "他绩效评分为C。",
    "他评定为D级。",
    "他KPI等级E。",
]


@pytest.mark.parametrize("text", ZH_R3_NEW_VERBS_AND_LETTERS)
def test_zh_r3_new_verbs_and_letter_grades_hard_fail(text):
    res = redline.validate(text)
    assert not res.passed, f"评定/分级/字母等级(人)逃逸: {text!r}"


def test_zh_r3_job_grade_not_swept_by_letter_rule():
    for text in ("把他定级为P7。", "员工定级为高级工程师。", "这位同事的职级定级为P8。"):
        assert redline.validate(text).passed, f"职级(P7/P8/高级)被字母等级规则误伤: {text!r}"


# =============================================================================================
# PART D (round-4) — reconcile the round-3 over/under-corrections found by adversarial verify.
#   D1: round-3 whole-word narrowing DROPPED 流程/规则 → legit HR-tooling builders wrongly rejected.
#   D2: superlative verdict labels (最差/最低档) + 评为 verb were missing.
#   D3: not-scored suppression was ±24-char window-blanket → a contrastive clause ("…但领导给他打了2分")
#       let a co-located real score slip. Bind the cue to the same clause (no 但/其实/然而 between).
# =============================================================================================

# D1 — legit work-builders whose artifact word (流程/规则/制度) round-3 dropped: must PASS.
ZH_R4_LEGIT_BUILDER_TEXTS = [
    "他负责员工评级流程的设计。",
    "他维护考核评分规则。",
    "她搭建了绩效评定制度。",
]


@pytest.mark.parametrize("text", ZH_R4_LEGIT_BUILDER_TEXTS)
def test_zh_r4_legit_process_ruleset_builder_passes_advice(text):
    assert redline.validate(text).passed, f"建评分流程/规则/制度的人被误伤(建议门): {text!r}"


ZH_R4_LEGIT_BUILDER_OWNS = [
    ["负责员工评级流程的设计"],
    ["维护考核评分规则"],
    ["搭建绩效评定制度"],
]


@pytest.mark.parametrize("owns", ZH_R4_LEGIT_BUILDER_OWNS)
def test_zh_r4_legit_process_ruleset_builder_passes_extraction(owns):
    res = validate_extraction(ExtractionResult(people=[PersonEntity(id="u_r4a", name="安某", owns=owns)]))
    assert res.ok, f"建评分流程/规则的人被抽取红线误伤: {owns!r} ({res.summary()})"


# D1-guard — the round-3 catches (系统性/表现/标准) must STAY caught after restoring 流程/规则.
ZH_R4_ARTIFACT_GUARD_STILL_FAIL = [
    "他绩效评分系统性偏低。",
    "他的绩效评分表现很差。",
    "他绩效评级标准差。",
]


@pytest.mark.parametrize("text", ZH_R4_ARTIFACT_GUARD_STILL_FAIL)
def test_zh_r4_artifact_morpheme_scores_still_fail(text):
    assert not redline.validate(text).passed, f"round-3 命中被 round-4 放松: {text!r}"


# D2 — superlative verdict labels + 评为: must FAIL (person); project subject still PASS.
ZH_R4_SUPERLATIVE_HARD_FAIL = [
    "他评定为最差。",
    "他绩效评为最差。",
    "他排名为最差。",
    "他评定为最低档。",
]


@pytest.mark.parametrize("text", ZH_R4_SUPERLATIVE_HARD_FAIL)
def test_zh_r4_superlative_verdict_hard_fail(text):
    assert not redline.validate(text).passed, f"超级比较级人员判决逃逸: {text!r}"


def test_zh_r4_superlative_on_project_passes():
    for text in ("这个方案评为最差。", "产品质量评为最低档。"):
        assert redline.validate(text).passed, f"项目/产品评价被人员规则误伤: {text!r}"


# D3 — not-scored window bypass: a contrastive clause must NOT suppress a co-located real score.
ZH_R4_NOTSCORED_BYPASS_HARD_FAIL = [
    "本人不参与考核，但领导仍给他打了2分。",
    "虽说不被打分，他其实排名末位。",
]


@pytest.mark.parametrize("text", ZH_R4_NOTSCORED_BYPASS_HARD_FAIL)
def test_zh_r4_notscored_contrast_bypass_hard_fail(text):
    assert not redline.validate(text).passed, f"否定+转折 掩护真分逃逸: {text!r}"


def test_zh_r4_legit_not_scored_still_passes():
    # the genuine "this person is not scored" cue (no contrast marker) must still suppress → PASS.
    for text in ("她负责设计绩效评分系统，本人不参与考核。",
                 "他负责搭建绩效评分体系，本人不参与考核。"):
        assert redline.validate(text).passed, f"合法'本人不参与考核'被 round-4 收紧误伤: {text!r}"


def test_zh_r4_colloquial_superlatives_hard_fail():
    # GAP-1 from adversarial verify: colloquial 最烂/最菜 person verdicts must also fail.
    for text in ("他评定为最烂。", "他绩效评为最菜。"):
        assert not redline.validate(text).passed, f"口语超级比较级人员判决逃逸: {text!r}"
    # project subject still passes.
    assert redline.validate("这个方案评为最烂。").passed, "项目'最烂'被人员规则误伤"


# =============================================================================================
# PART E (partner-docs-0728) — an IDENTIFIER is not a rating.
#
# 「KPI-001」 是合伙人《Avery 标准管理信息填写表单》表03 给出的指标ID **示例原文**，用户会照着填。
# 修复前 `PersonEntity(name='KPI-001')` 单独一条就 EXTRACTION-REDLINE FAIL[person-score-value]：
# '-' 落进 `_ZH_SCORE_NEAR_NUM` 那个 0-8 字符间隔，'001' 落进 `\d{1,3}`，而量词否定表（年/个月/人/
# 次/条/…）不含 ID 形状。这不是丢一个字段——`pipeline.ingest_docs:130` 上红线是整批硬拒，同一发上传
# 里**所有文件**一起失败。
#
# 两侧都要钉死：编号放行，真分数照抓。特别是 E-mixed —— 「KPI-001 得分 3 分」必须仍然失败，那正是
# "整段做一次 ID 预扫就跳过该 field" 那种改法会放过的串。
# =============================================================================================

# E1 — 编号形状：必须 PASS（含 name / role / owns 三种落点，name 是文件名兜底最常见的入口）。
ZH_E_IDENTIFIER_PEOPLE = [
    PersonEntity(id="u_e1", name="KPI-001"),                       # 表03 示例原文，孤条也曾硬拒
    PersonEntity(id="u_e2", name="KPI_2026"),                      # 下划线 + 年份
    PersonEntity(id="u_e3", name="OKR-01"),                        # 前导零
    PersonEntity(id="u_e4", name="张三-KPI-001"),                   # 文件名兜底: 张三-KPI-001.pdf
    PersonEntity(id="u_e5", name="安某", role="KPI-001 指标负责人"),
    PersonEntity(id="u_e6", name="安某", owns=["负责 KPI-012 与 KPI-013 两项指标"]),
    PersonEntity(id="u_e7", name="安某", owns=["考核-002 流程改造"]),  # 中文话题词 + 编号
    PersonEntity(id="u_e8", name="安某", owns=["KPI#001 数据看板"]),   # # 分隔符
]


@pytest.mark.parametrize("person", ZH_E_IDENTIFIER_PEOPLE, ids=lambda p: p.id)
def test_zh_e_identifier_shape_is_not_a_person_score(person):
    res = validate_extraction(ExtractionResult(people=[person]))
    assert res.ok, f"指标编号被误判成人身评分(整批上传会一起硬拒) ({res.summary()}): {person!r}"


def test_zh_e_identifier_does_not_fail_the_whole_batch():
    """整批语义：一个人带编号，同一发里的干净同事不该被连坐。修复前这整个 result 都 ok=False。"""
    res = validate_extraction(ExtractionResult(people=[
        PersonEntity(id="u_e9a", name="安某", owns=["KPI-001 指标口径梳理"]),
        PersonEntity(id="u_e9b", name="李某", role="后端工程师", tenure="入职18个月"),
    ]))
    assert res.ok, f"编号误判把同批干净人员一起拖失败: {res.summary()}"


# E2 — 真分数：必须仍然 FAIL（同一批话题词，只是没有编号形状 / 带分数单位）。
ZH_E_REAL_SCORES_STILL_CAUGHT = [
    ("KPI 3 分", PersonEntity(id="u_e10", name="安某", owns=["KPI 3 分"])),
    ("KPI：85", PersonEntity(id="u_e11", name="安某", owns=["KPI：85"])),
    ("绩效 2 分", PersonEntity(id="u_e12", name="安某", owns=["绩效 2 分"])),
    ("KPI-100分", PersonEntity(id="u_e13", name="安某", owns=["KPI-100分"])),   # 分数单位取消编号豁免
    ("KPI-3", PersonEntity(id="u_e14", name="安某", owns=["KPI-3"])),          # 短裸数：有意 fail-closed
    ("mixed", PersonEntity(id="u_e15", name="安某", owns=["KPI-001 得分 3 分"])),  # 编号 + 真分数混排
]


@pytest.mark.parametrize("label,person", ZH_E_REAL_SCORES_STILL_CAUGHT, ids=[
    p[0] for p in ZH_E_REAL_SCORES_STILL_CAUGHT])
def test_zh_e_real_person_scores_still_hard_fail(label, person):
    res = validate_extraction(ExtractionResult(people=[person]))
    assert not res.ok, f"编号豁免放过了真人身评分: {label!r}"


def test_zh_e_identifier_never_masks_a_later_score_in_the_same_field():
    """`finditer` 不重叠：被豁免的编号命中不能吃掉后面那个真分数的匹配位置。"""
    res = validate_extraction(ExtractionResult(people=[
        PersonEntity(id="u_e16", name="安某", owns=["KPI-001 得分 3 分"])]))
    assert any(v.kind == "person-score-value" for v in res.violations), (
        f"混排串没有在结构扫描层被抓到(只靠内容门兜底就说明豁免吃掉了后续匹配): {res.summary()}")


# =============================================================================================
# PART F (#97) — the DIAGNOSIS half of the red line, which existed only in ENGLISH.
#
# feat-029 ported SCORE / RISK / TIER to Chinese. It did NOT port `_ALWAYS_DIAGNOSIS` — the rule
# that catches a CHARACTER or CLINICAL verdict nailed to a person (lazy / toxic / incompetent /
# stupid / useless / unhinged / worthless). So the ZH side carried only the SCORING forms
# (情绪值/情绪分/心情值), and the product red line's OWN first example —「臆测偷懒」— was not gated
# in the language the domestic operator actually reads:
#
#     "Honestly he's lazy and probably toxic."   -> FAIL[PERSON-DIAGNOSIS]   (English, since day 1)
#     "我觉得他就是懒惰，这人有毒。"                -> PASS                     (Chinese, until #97)
#
# THE LINE IS 「诊断性标签钉在人身上」, NOT 「负面词」. Every row below is a PAIR, and the pairing is
# the measurement: the control sentence differs from the diagnosis sentence by ONE WORD and must
# PASS. Without the control, a red assertion only proves the gate dislikes the sentence — not that
# it dislikes the LABEL. (This is test_redline_villa_negation_b3.py's `_CONTROL_WORDS` doctrine:
# 「the control is what makes this a measurement of 「别」 rather than of the sentence」.)
# =============================================================================================

# (词条, 诊断句 — 必须拦, 对照句 — 必须放行). 对照句只换掉那个诊断词,句式/主语/语气全部不动。
ZH_F_DIAGNOSIS_PAIRS = [
    # 懒 / 摸鱼 —— 票面点名的第一族,对应英文 lazy
    ("偷懒",   "她最近老是偷懒，建议盯紧一点。",        "她最近老是加班，建议盯紧一点。"),
    ("懒惰",   "我觉得他就是懒惰，交上来的东西一直拖。", "我觉得他就是缺支持，交上来的东西一直拖。"),
    ("懒散",   "他懒散惯了，节奏一直提不起来。",        "他外派惯了，节奏一直提不起来。"),
    ("摸鱼",   "这人上班就是在摸鱼，一天写不了两行。",   "这人上班就是在救火，一天写不了两行。"),
    ("划水",   "他天天划水，活都是别人干的。",          "他天天出差，活都是别人干的。"),
    ("混日子", "他就是在混日子，没什么产出。",          "他就是在做支撑，没什么产出。"),
    ("好吃懒做", "这人好吃懒做，不适合留在这个岗位。",   "这人经验不足，不适合留在这个岗位。"),
    # 精神 / 心理 —— 票面点名的第二族,对应英文 unhinged
    ("精神状态不正常", "我看他精神状态不正常，先别派活。", "我看他手上压力不小，先别派活。"),
    ("心理有问题",     "她心理有问题，团队都受不了。",     "她沟通方式很冲，团队都受不了。"),
    ("脑子有问题",     "这人脑子有问题吧，方案根本讲不通。", "这人思路没对齐吧，方案根本讲不通。"),
    # 有毒 / 负能量 —— 票面点名的第三族,对应英文 toxic
    ("有毒",   "这人有毒，谁跟他搭档谁难受。",          "这人很急，谁跟他搭档谁难受。"),
    ("负能量", "他负能量太重，会影响整个组。",          "他抱怨太多，会影响整个组。"),
    ("毒瘤",   "他就是团队里的毒瘤。",                  "他就是团队里的老黄牛。"),
    # 其余英文词表的中文对应 —— useless / worthless / stupid / narcissist / burned-out
    ("废物",     "他就是个废物，交付一直不达标。",      "他就是个新人，交付一直不达标。"),
    ("一无是处", "在我看来他一无是处。",                "在我看来他还在爬坡。"),
    ("玻璃心",   "他玻璃心，反馈重一点就崩。",          "他压力大，反馈重一点就崩。"),
    ("巨婴",     "他就是个巨婴。",                      "他就是个新人。"),
    ("弱智",     "他就是弱智，这么简单都不会。",        "他就是没培训过，这么简单都不会。"),
    ("愚蠢",     "这么干太愚蠢了。",                    "这么干太冒险了。"),
    ("人品有问题", "他人品有问题，不能带新人。",        "他方法有问题，不能带新人。"),
    ("职业倦怠", "我判断他是职业倦怠。",                "我判断他是节奏太满。"),
]


@pytest.mark.parametrize("word,diagnosis,control", ZH_F_DIAGNOSIS_PAIRS,
                         ids=[p[0] for p in ZH_F_DIAGNOSIS_PAIRS])
def test_zh_f_person_diagnosis_hard_fails(word, diagnosis, control):
    """正样本：把诊断性标签钉在人身上,必须硬拦。"""
    res = redline.validate(diagnosis)
    assert not res.passed, (
        f"中文人身诊断标签「{word}」逃过了输出闸: {diagnosis!r}\n"
        f"英文侧同义句 (lazy / toxic / stupid …) 从第一天起就是 FAIL[PERSON-DIAGNOSIS];"
        f"这条线在中文部署里同样是产品红线,不是可选项。")
    assert "PERSON-DIAGNOSIS" in {v.rule_id for v in res.violations}, (
        f"「{word}」拦住了,但落的不是 PERSON-DIAGNOSIS 而是 "
        f"{[v.rule_id for v in res.violations]} —— 说明它是被旁边的规则顺手带走的,"
        f"这条判据并没有在验它自己。")


@pytest.mark.parametrize("word,diagnosis,control", ZH_F_DIAGNOSIS_PAIRS,
                         ids=[p[0] for p in ZH_F_DIAGNOSIS_PAIRS])
def test_zh_f_one_word_control_still_passes(word, diagnosis, control):
    """负样本(成对)：同一句话,只把诊断词换成一个正常说法,必须放行。

    这半边才是「宽度」的判据。红的那半边单独存在时,它可能是在拒绝整句话的语气、拒绝「他」、
    拒绝任何带负面色彩的句子 —— 那不是红线要的东西。一词之差的对照句放行,才说明闸判的是
    **标签**,不是情绪。
    """
    res = redline.validate(control)
    assert res.passed, (
        f"对照句被误伤 ({res.summary()}): {control!r}\n"
        f"它和 {diagnosis!r} 只差「{word}」一个词。对照句一旦也被拦,上面那条红就不再是"
        f"「拦住了诊断标签」的证据,只是「拦住了这句话」。")


# --- 宽度：一批带诊断词形、但根本不是在说人的普通中文 ------------------------------------------
# CJK 没有词边界,这是 B3「别墅」那一课换个词表重演：「懒」不是 lazy,它是 **懒加载** 的第一个字,
# 而懒加载就写在这个仓库自己的部署纪要里。下面每一句都是词表里某个守卫**专门**挡的那个碰撞。
ZH_F_WIDTH_MUST_PASS = [
    # 对事不对人 —— 票面点名必须放行的那两句,以及同族
    "这周节奏松散，下周把站会拉回来。",
    "项目拖延了两周，需要重新排期。",
    "交付质量没达到标准，这件事要直接跟他讲清楚。",
    # 技术词里的「懒」/「划水」/「摸鱼」
    "他负责首页图片的懒加载改造，性能提升明显。",
    "我们把列表改成了懒惰求值，内存占用下来了。",
    "这次是浑水摸鱼的第三方供应商，合同要收紧。",
    "他负责游泳课程的划水动作教学。",
    # 集体/抽象主语的「精神」「心理」—— 说的是文化,不是某个人
    "团队精神有问题，需要重建协作习惯。",
    "工匠精神是我们做产品的底色。",
    "公司很重视员工心理健康，开了咨询热线。",
    "用户心理研究显示大家更在意首屏速度。",
    # 「有毒」「废物」的本义,以及「精神病」「神经病」作为机构名/学科名
    "他负责有毒气体检测模块的开发。",
    "仓库里存放着有毒气体，必须单独隔离。",
    "危险废物处理是这个厂区的合规重点。",
    "我们做了一轮废物回收流程的梳理。",
    "他在精神病院做过两年信息化项目。",
    "他是神经病学方向的博士。",
]


@pytest.mark.parametrize("text", ZH_F_WIDTH_MUST_PASS)
def test_zh_f_ordinary_chinese_is_not_a_diagnosis(text):
    res = redline.validate(text)
    assert res.passed, f"新词表误伤了正常中文 ({res.summary()}): {text!r}"


# --- ADR-0016：果断的那一面不许被这批词带走 ----------------------------------------------------
ZH_F_DECISIVE_MUST_PASS = [
    "他不能胜任现在的岗位，建议启动绩效改进计划，必要时调岗。",
    "如果三个月后交付还是不达标，就该谈离开的事。",
    "这件事不能再拖了，本周就跟他把话说开。",
]


@pytest.mark.parametrize("text", ZH_F_DECISIVE_MUST_PASS)
def test_zh_f_decisive_call_stays_legal(text):
    """ADR-0016 的第二个方向：红线管的是**评价人**,不是**做决定**。

    「不胜任」是《劳动合同法》第40条的原话,也正是建议走绩效改进/调岗/离开时绕不开的措辞。
    把它扫进诊断词表,等于让护城河拒绝它本来就是为了放行的那种果断建议。
    """
    res = redline.validate(text)
    assert res.passed, f"果断建议被诊断词表误伤 ({res.summary()}): {text!r}"


# --- 否定语境：劝人**别**下诊断,本身不是诊断 ----------------------------------------------------
ZH_F_NEGATED_MUST_PASS = [
    "别说他偷懒，先看看是不是需求一直在变。",
    "不要给他贴懒惰的标签，先把工作说清楚。",
    "别把他当成摸鱼的人，他手上压着三个需求。",
    "别对他做精神状态的判断，我们只看交付。",
]


@pytest.mark.parametrize("text", ZH_F_NEGATED_MUST_PASS)
def test_zh_f_advice_against_diagnosing_passes(text):
    res = redline.validate(text)
    assert res.passed, f"劝阻下诊断的建议被误伤 ({res.summary()}): {text!r}"


# --- 繁体：同一批词的繁体写法必须同样被拦 -------------------------------------------------------
# `zh_normalize` 的字表按需扩了 懶魚廢貨腦殘質癡嬰 九个字。不扩就是在补丁内部又造一次中英式的
# 不对称：简体拦、繁体漏。
ZH_F_TRADITIONAL_MUST_FAIL = [
    "我覺得他就是懶惰。",
    "他上班一直在摸魚。",
    "他就是個廢物。",
    "他心理素質差。",
    "這人腦殘。",
    "他就是個巨嬰。",
    "他就是個白癡。",
]


@pytest.mark.parametrize("text", ZH_F_TRADITIONAL_MUST_FAIL)
def test_zh_f_traditional_diagnosis_hard_fails(text):
    res = redline.validate(text)
    assert not res.passed, f"繁体人身诊断标签逃过了输出闸: {text!r}"


# --- 抽取层：同一批词在人卡里的两个方向 ---------------------------------------------------------
# 这一层的误伤比建议层贵得多 —— `validate_extraction` 失败是 pipeline.ingest_docs 上的硬拒,
# 拒的是客户**整批**上传,不是一张卡。而且 redline_extract 会给每张人卡套一层「she:」前缀,
# `_has_person` 恒真,所以「靠人称锚定」在这一层等于没锚 —— 词表本身必须扛得住。
ZH_F_EXTRACTION_LEGIT_OWNS = [
    ["负责首页图片懒加载改造"],
    ["负责有毒气体检测模块"],
    ["搭建废物回收流程"],
    ["负责游泳课程划水动作教学"],
    ["把列表改成懒惰求值"],
]


@pytest.mark.parametrize("owns", ZH_F_EXTRACTION_LEGIT_OWNS)
def test_zh_f_legit_person_card_still_extracts(owns):
    res = validate_extraction(ExtractionResult(people=[
        PersonEntity(id="u_f1", name="安某", owns=owns)]))
    assert res.ok, f"诊断词表把一张合法人卡拒了(整批上传会一起硬拒) ({res.summary()}): {owns!r}"


@pytest.mark.parametrize("owns", [["工作态度差，天天摸鱼"], ["精神状态不正常"], ["就是个懒惰的人"]])
def test_zh_f_diagnosis_in_a_person_card_hard_fails(owns):
    res = validate_extraction(ExtractionResult(people=[
        PersonEntity(id="u_f2", name="安某", owns=owns)]))
    assert not res.ok, f"人卡里的诊断标签逃过了抽取红线: {owns!r}"


# =============================================================================================
# PART F 的变异证明 —— 每条新判据配一个**专属**变异,证明它真的有牙
#
# 一条判据绿着,可能是因为它验的东西成立,也可能是因为旁边有别的规则顺手把这句话拦了 —— 后一种
# 情况下这条判据是装饰,改坏了被测代码它照样绿。所以下面把规则**关掉**再问一遍:
#   * 整条 _ZH_DIAGNOSIS 关掉 -> 每个正样本都必须翻成 PASS。翻不过去的那句,说明它根本不是被这条
#     新规则拦的,它在搭旁边判据的便车。
#   * 每个守卫单独拆掉        -> 它挡的那句误伤必须回来。回不来的守卫是死重,应该删掉而不是留着。
# =============================================================================================

_NEVER = re.compile(r"(?!)")     # 永不匹配 —— 「这条规则不存在」的那个状态


@contextlib.contextmanager
def _zh_diagnosis_patched(mutant: re.Pattern):
    """把 _ZH_ALWAYS 里那一条换成 mutant,退出时还原。

    ⚠ 必须改 `_ZH_ALWAYS` 里的那个**元组**,不能只改 `redline._ZH_DIAGNOSIS`：这张表在模块加载时
    就把编译好的对象按引用抓走了,改模块属性对 `validate` 一点影响都没有,变异会静默地什么都没变
    而测试照样绿 —— 那正是 b3 那个文件里 `_别_rule()` 的断言在防的失败方式。
    """
    table = redline._ZH_ALWAYS
    idx = [i for i, (_r, rx, _n) in enumerate(table) if rx is redline._ZH_DIAGNOSIS]
    assert len(idx) == 1, (
        f"_ZH_ALWAYS 里的 _ZH_DIAGNOSIS 条目不是恰好一条 (找到 {idx}) —— 下面所有变异都指着空气,"
        f"会空真地通过。先把它接回去。")
    i = idx[0]
    rule_id, original, note = table[i]
    table[i] = (rule_id, mutant, note)
    try:
        yield
    finally:
        table[i] = (rule_id, original, note)


def _mutate_guard(find: str, replace: str) -> re.Pattern:
    """拆掉词表里的一个守卫,返回变异后的 pattern。`find` 必须真的在 pattern 里 —— 词表一改写法,
    这里就应该红,而不是安静地替换 0 处然后让变异证明变成空判。"""
    pattern = redline._ZH_DIAGNOSIS.pattern
    assert find in pattern, (
        f"守卫 {find!r} 已经不在 _ZH_DIAGNOSIS 里了 —— 这个变异指着空气,重新对着实现推导一遍。")
    mutated = pattern.replace(find, replace)
    assert mutated != pattern, f"变异没有改动 pattern: {find!r}"
    return re.compile(mutated, re.I)


@pytest.mark.parametrize("word,diagnosis,control", ZH_F_DIAGNOSIS_PAIRS,
                         ids=[p[0] for p in ZH_F_DIAGNOSIS_PAIRS])
def test_zh_f_each_positive_depends_on_the_new_rule(word, diagnosis, control):
    """专属变异：整条 _ZH_DIAGNOSIS 关掉后,这一句必须翻成 PASS。

    翻不过去 = 它本来就被别的规则(_ZH_SCORE/_ZH_TIER/英文 _ALWAYS_DIAGNOSIS/…)拦着,那么它在
    上面那条红里就不是 #97 的证据 —— 换句话说,把 #97 的实现整个删掉,那条判据照样绿。
    """
    with _zh_diagnosis_patched(_NEVER):
        res = redline.validate(diagnosis)
    assert res.passed, (
        f"「{word}」这句在 _ZH_DIAGNOSIS 关掉之后依然被拦 ({res.summary()}): {diagnosis!r}\n"
        f"所以它验的不是这次新增的词表,它搭了旁边判据的便车。换一个只落在新词条上的句子。")
    # 还原生效了 —— 否则本轮后面每条测试都在跑变异体
    assert not redline.validate(diagnosis).passed, "变异没还原 —— _ZH_ALWAYS 还挂着 mutant"


# (守卫, 拆法, 它挡的那句误伤). 拆掉守卫 -> 这句必须重新被误伤,证明守卫不是装饰。
ZH_F_GUARD_MUTATIONS = [
    ("懒惰-技术词", "懒惰(?!求值|计算|加载|初始化|删除|模式|单例)", "懒惰",
     "我们把列表改成了懒惰求值，内存占用下来了。"),
    ("摸鱼-浑水", "(?<!浑水)摸鱼", "摸鱼",
     "这次是浑水摸鱼的第三方供应商，合同要收紧。"),
    ("划水-游泳", "划水(?!动作|技术|训练|姿势|板|区|线)", "划水",
     "他负责游泳课程的划水动作教学。"),
    # ⚠ 这一行的探针句是换过的,原因值得留着：第一版用的是「他负责有毒气体检测模块的开发。」,
    # 拆掉守卫之后它**依然放行** —— 因为救它的根本不是这个守卫,是 `_zh_about_work`(前面有「负责」、
    # 后面有「模块」= 人在建工作产物)。用那句话做变异证明,证的是工作抑制,不是守卫;守卫真被删掉了
    # 它也不会红。探针句必须落在只有守卫能救的位置上。
    ("有毒-本义", "有毒(?!物质|气体|废|垃圾|有害|化学|试剂|材料|品|性|素|烟|尘)", "有毒",
     "仓库里存放着有毒气体，必须单独隔离。"),
    ("废物-本义", "废物(?!利用|回收|处理|处置|分类|管理)", "废物",
     "危险废物处理是这个厂区的合规重点。"),
    ("精神病-机构名", "精神病(?!学|院|科|区|房|理|床)", "精神病",
     "他在精神病院做过两年信息化项目。"),
    ("神经病-学科名", "神经病(?!学|理)", "神经病",
     "他是神经病学方向的博士。"),
]


@pytest.mark.parametrize("label,find,replace,false_positive", ZH_F_GUARD_MUTATIONS,
                         ids=[m[0] for m in ZH_F_GUARD_MUTATIONS])
def test_zh_f_each_guard_is_load_bearing(label, find, replace, false_positive):
    """专属变异,反方向：拆掉守卫,它挡的那句普通中文必须重新被误伤。

    守卫拆了还不误伤 = 这个守卫从来没挡住过任何东西,是死重,应该删掉而不是留在词表里假装严谨
    (b3 那个文件里 test_both_halves_of_the_别_rule_are_load_bearing 的同一条道理)。
    """
    assert redline.validate(false_positive).passed, (
        f"[{label}] 这句现在就被误伤了,变异证明无从谈起: {false_positive!r}")
    with _zh_diagnosis_patched(_mutate_guard(find, replace)):
        res = redline.validate(false_positive)
    assert not res.passed, (
        f"[{label}] 拆掉守卫 {find!r} 之后,{false_positive!r} 依然没被误伤 —— "
        f"这个守卫挡的是空气。要么它是死重该删,要么这句话早就不再依赖它,不能再当证据。")
    assert redline.validate(false_positive).passed, "变异没还原 —— _ZH_ALWAYS 还挂着 mutant"


def test_zh_f_collective_lookbehind_is_load_bearing():
    """「团队精神有问题」和「他精神有问题」的差别,全靠 _ZH_DIAG_COLLECTIVE 那个 lookbehind。

    这就是票面说的 对事不对人 —— 说团队文化有问题是**对事**,必须放行;说某个人精神有问题是
    **对人**,必须拦。拆掉 lookbehind,前者立刻被误伤,后者不变。
    """
    collective, personal = "团队精神有问题，需要重建协作习惯。", "他精神有问题，别让他带新人。"
    assert redline.validate(collective).passed, "对照前提不成立：集体主语句现在就被拦了"
    assert not redline.validate(personal).passed, "对照前提不成立：人身诊断句现在就没被拦"

    find = f"(?<![{redline._ZH_DIAG_COLLECTIVE}])"
    with _zh_diagnosis_patched(_mutate_guard(find, "")):
        assert not redline.validate(collective).passed, (
            f"拆掉 {find!r} 之后「{collective}」依然放行 —— 这个 lookbehind 挡的是空气。")
        assert not redline.validate(personal).passed, (
            "拆掉 lookbehind 之后人身诊断句反而放行了 —— 变异改坏了别的东西,证明无效。")
    assert redline.validate(collective).passed, "变异没还原 —— _ZH_ALWAYS 还挂着 mutant"


# --- 死针探测：新词表不许把任何一条**既有**判据变成空判 -----------------------------------------
_ZH_PREEXISTING_MUST_FAIL = [
    *ZH_PERSON_SCORE_ADVICE, *ZH_B6_TRADITIONAL, *ZH_B7_FALSE_NEGATION, *ZH_B8_PERSON_NUMBER,
    *ZH_B9_RANK_SYNONYMS, *ZH_B10_STARS, *ZH_R3_NOT_SCORED_WILDCARD, *ZH_R3_ARTIFACT_MORPHEME,
    *ZH_R3_CONNECTIVE_VERDICT, *ZH_R3_NEW_VERBS_AND_LETTERS, *ZH_R4_ARTIFACT_GUARD_STILL_FAIL,
    *ZH_R4_SUPERLATIVE_HARD_FAIL, *ZH_R4_NOTSCORED_BYPASS_HARD_FAIL,
]


@pytest.mark.parametrize("text", _ZH_PREEXISTING_MUST_FAIL)
def test_zh_f_new_lexicon_does_not_prop_up_an_existing_criterion(text):
    """加词表**不会**让既有判据变红 —— 那是看得见的。它让判据失明的方式是把判据**架起来**：
    一句本来靠 PERSON-SCORE 拦住的话,现在顺带撞上 PERSON-DIAGNOSIS,于是就算 PERSON-SCORE 被改坏
    了,那条判据照样绿。判据还在跑,只是不再判任何东西 —— 本仓管这叫死针。

    所以问题不是「套件红了吗」(没红),而是：把 _ZH_DIAGNOSIS 关掉,这些**既有**的必拦句还拦得住吗。

    实测(改动落地前跑的探针,覆盖全套件 5257 条含中文的非 docstring 字面量)：0 条死针,
    0 条被新词表新拦下的既有语料。这条测试把那次测量钉成回归。
    """
    with _zh_diagnosis_patched(_NEVER):
        res = redline.validate(text)
    assert not res.passed, (
        f"这条既有必拦句现在只剩 _ZH_DIAGNOSIS 在拦它: {text!r}\n"
        f"它原本要验的规则(评分/排名/风险/画像…)已经被新词表架空,改坏了也不会红。"
        f"要么这句语料该换,要么新词表收窄。")
