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
