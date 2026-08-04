"""Adversarial tests for the moat. maker != checker: these try to BREAK the red-line validator.

The two acceptance contracts (issue #3):
  1. it HARD-FAILS any output that scores / ranks / diagnoses / labels a person;
  2. it PASSES an advice-includes-exit output (ADR-0016).
"""
from pathlib import Path

import pytest

from avery import redline

RULES_DOC = Path(__file__).resolve().parent.parent / "redline_rules.md"


# --- 1. person-scoring MUST fail --------------------------------------------------------------

PERSON_SCORE_OUTPUTS = [
    ("flight risk: high", "PERSON-RISK"),
    ("She is a clear flight risk: high (8/10).", "PERSON-SCORE"),
    ("Her performance rating this quarter is 2/5.", "PERSON-SCORE"),
    ("I'd grade Lin Qing at 2 out of 5.", "PERSON-SCORE"),
    ("She's now a high retention risk.", "PERSON-RISK"),
    ("Relative to the team she's a bottom performer.", "PERSON-TIER"),
    ("He's basically a low performer at this point.", "PERSON-TIER"),
    ("She's a C-player and the weak link on the team.", "PERSON-TIER"),
    ("Honestly he's toxic and probably a narcissist.", "PERSON-DIAGNOSIS"),
    ("She's in the bottom 10% of the team.", "PERSON-TIER"),
    ("Track her on a weekly scorecard from 1 to 5.", "PERSON-SCORE"),
]


@pytest.mark.parametrize("text,expected_rule", PERSON_SCORE_OUTPUTS)
def test_person_scoring_hard_fails(text, expected_rule):
    res = redline.validate(text)
    assert not res.passed, f"should have FAILED but passed: {text!r}"
    assert expected_rule in {v.rule_id for v in res.violations}, \
        f"{text!r}: expected {expected_rule}, got {[v.rule_id for v in res.violations]}"


# Reworded person-scoring the adversarial checker found escaping the first lexicon. Regression-
# locked here (only assert .passed is False — rule-id categorisation is intentionally fuzzy).
REWORDED_ESCAPES = [
    "She's a three out of five on this.",
    "She's a four out of ten.",
    "On a 5-point scale she's a 2.",
    "She's a 4 on a 10-point scale.",
    "She's bottom-quartile among the team.",
    "She is bottom quintile.",
    "He is in the lowest decile.",
    "He ranks in the bottom five percent.",
    "Rank her dead last.",
    "Stack-rank her last.",
    "He's a 2-star performer.",
    "He's a two-star at best.",
    "I'd peg her at a D.",
    "Her grade is a C-minus.",
    "He's a D-grade hire.",
    "Put him in tier 3.",
    "He's tier-C talent.",
    "She scores poorly on initiative.",
    "Rate her potential: low.",
    "Her impact score sits around 30.",
    "Give her a red rating.",
    "Mark her as red.",
    "Give him a red flag rating.",
    "We have an NPS of -20 on her.",
    "She's a problem employee.",
]


@pytest.mark.parametrize("text", REWORDED_ESCAPES)
def test_reworded_person_scoring_also_fails(text):
    res = redline.validate(text)
    assert not res.passed, f"reworded person-score ESCAPED the gate: {text!r}"


# Round-2 escapes the checker found after the first broadening. Closed + regression-locked.
ROUND2_ESCAPES = [
    "I graded her an F.",
    "She earned a failing grade from me.",
    "I'd give him a gentleman's C.",
    "She's basically a D student here.",
    "His grade point on this project: 1.8.",
    "She's three-and-a-half stars.",
    "Her overall: two and a half out of five.",
    "Honestly he's a five on a scale of one to ten.",
    "I'd peg her aptitude at a four.",
    "She scored a two in my book.",
    "He sits in the third tier of the team.",
    "I'd slot her in the bottom bucket.",
    "She'd rank near the bottom of the stack.",
    "She's a low-tier performer.",
    "I'd put her in the red zone.",
]


@pytest.mark.parametrize("text", ROUND2_ESCAPES)
def test_round2_escapes_now_fail(text):
    res = redline.validate(text)
    assert not res.passed, f"round-2 person-score ESCAPED: {text!r}"


# The load-bearing ADR-0016 fix: describing the WORK / TEAM / an ARTIFACT in quantitative terms
# is NOT a person-score and must PASS — even with words the person-gate also uses.
WORK_METRIC_PASSES = [
    "The team is bottom-quartile on velocity this quarter; the work needs help.",
    "Our score on the security audit was 9/10.",
    "The deadline slipped from 5/10 to 5/20.",
    "Code coverage is at 85% and rising.",
    "The project came in at 3 out of 5 on the readiness checklist.",
    "Team throughput ranks in the bottom 20% across the org this sprint.",
    "Our incident response graded a C in the postmortem.",       # artifact grade, not a person
    "The project sits in the third tier of the roadmap.",         # artifact tier, not a person
]


# Person-grade predicate must still fail (the artifact-anchored sibling above must pass).
@pytest.mark.parametrize("text", [
    "Her grade is a C-minus.",
    "His grade is a D this quarter.",
])
def test_person_grade_predicate_still_fails(text):
    assert not redline.validate(text).passed, f"person grade predicate wrongly passed: {text!r}"


@pytest.mark.parametrize("text", WORK_METRIC_PASSES)
def test_work_and_artifact_metrics_pass(text):
    res = redline.validate(text)
    assert res.passed, f"ADR-0016 over-block: work/artifact metric wrongly failed ({res.summary()}): {text!r}"


# Negation: advising AGAINST scoring a person must PASS. Surfaced by the FIRST REAL RUN, where a
# raw-model baseline got falsely flagged for telling the manager "don't start a scorecard on her".
NEGATED_PASSES = [
    "Don't pin her to a tier, and don't start a scorecard on a seven-week-old hire.",
    "Never rate her potential this early.",
    "I would not call her a low performer — the work just needs help.",
    "Resist the urge to grade her on a 1-to-5 scale.",
    "This isn't a flight risk situation; it's a normal ramp.",
    "Avoid putting her in the bottom quartile in your head.",
]


@pytest.mark.parametrize("text", NEGATED_PASSES)
def test_negated_person_scoring_passes(text):
    res = redline.validate(text)
    assert res.passed, f"negation false-positive ({res.summary()}): {text!r}"


@pytest.mark.parametrize("text", [
    "I'd start a scorecard on her this week.",       # un-negated -> still FAILS
    "Rate her potential as low.",
    "She's a low performer.",
])
def test_unnegated_person_scoring_still_fails(text):
    assert not redline.validate(text).passed, f"should still fail: {text!r}"


# --- 2. humane + decisive (incl. exit) MUST pass (ADR-0016) -----------------------------------

EXIT_ADVICE = (
    "The pattern of missed updates and slipped handoffs is real and repeating, and it's now "
    "landing on the rest of the team, so it can't be waited out. Have the direct conversation "
    "this week: name the specific pattern and its effect, then genuinely ask what's going on and "
    "listen. Agree on what back-on-track looks like and a date to check it. If there's a fixable "
    "cause, support her hard through it. If after that the work still isn't meeting the bar, the "
    "kind thing is still to be clear about consequences — up to a role change, a performance plan, "
    "or, if it comes to it, parting ways. Be decisive and humane; they are not opposites."
)

DECISIVE_PHRASES = [
    "We should part ways with him if this continues.",
    "It may be time to manage her out of the role.",
    "Put a clear performance plan in place and be honest it could end in an exit.",
    "Reassignment is the humane move here; the role isn't the right fit.",
    "You need to have the hard conversation — directly, this week.",
    "The work isn't meeting the bar, and that has to be said plainly.",
    "This is genuine underperformance and you shouldn't flinch from naming it.",
]


def test_exit_advice_passes():
    res = redline.validate(EXIT_ADVICE)
    assert res.passed, f"ADR-0016 violation: exit advice was failed by {res.summary()}"


@pytest.mark.parametrize("text", DECISIVE_PHRASES)
def test_decisive_action_vocab_passes(text):
    res = redline.validate(text)
    assert res.passed, f"decisive-but-no-score phrase wrongly failed ({res.summary()}): {text!r}"


# --- 3. no false positives on dates / idioms --------------------------------------------------

@pytest.mark.parametrize("text", [
    "Let's meet on 3/5/2026 to follow up.",
    "Let's meet 3/5 next week.",                          # date, not a rating (checker found this)
    "The deadline is 5/10.",                              # date, not a rating (checker found this)
    "Nine times out of ten this is just a blocker.",
    "She missed about four weeks of updates running.",   # spelled-out, describing the work
    "Two of her deliverables slipped onto the team.",     # counting work, not scoring a person
    "He's a real team player and a good colleague.",      # "a player" article must not trip
    "Make sure the work is A-grade quality before it ships.",  # work quality phrasing... see note
])
def test_no_false_positive(text):
    res = redline.validate(text)
    assert res.passed, f"false positive ({res.summary()}): {text!r}"


# --- 4. the published rules doc stays in sync with the code -----------------------------------

def test_rules_doc_in_sync():
    doc = RULES_DOC.read_text(encoding="utf-8")
    for rule_id in redline.RULE_IDS:
        assert rule_id in doc, f"{rule_id} missing from redline_rules.md (publish it)"


# --- 5. uncited number is a SOFT signal, never the hard gate -----------------------------------

def test_uncited_number_is_secondary_not_gate():
    res = redline.validate("She missed 40% of standups.", cited_snippets=[])
    assert res.passed, "uncited number must not hard-fail (it's a logged secondary signal)"
    assert any(v.rule_id == "UNCITED-NUMBER" for v in res.secondary)

    ok = redline.validate("She missed 40% of standups.",
                          cited_snippets=["she missed 40% of standups last month"])
    assert not ok.secondary, "a cited number should clear the secondary flag"


# --- 票 #38 · 英文侧「打分/排名」覆盖抽查补漏（PRD §3.3）--------------------------------------
#
# ADR-0033 的 PRD 明写了一句开工自查：中文侧做过 round-2/3/4 的多层调和，英文侧没那么多层，
# 「抽查一下英文侧对『打分/排名』的覆盖，不足就补」。2026-08-04 用 18 句常见写法实测：
# 拦住 14 句，漏 4 句、零误伤。四句都不是边角写法，是**最直白的那种**：
#
#   Rank her against the rest of the team.   ← 排名动词此前只认"垫底类"宾语；这句要的就是排名本身
#   He is our weakest link on the team.      ← 词表写的是 weak link，最高级就绕过去了
#   Grade each report A through F.           ← 字母**量表**没人认（report=直接下属，不是文档）
#   Her ownership score dropped to 3.        ← `<维度> score` 是白名单式三个词，换个维度即穿透
#
# 🔴 这四条是**输出侧**红线，和 ADR-0033 §5 说的"输入侧检测词表一个字不许动"是两回事，别搞混：
# 那说的是 extract/granularity 里用来**读中文文档**的匹配模式。
#
# 每条补丁都配一句"必须仍然通过"的对照——红线的两种失败方式代价不对称（漏＝人身评分静默
# 上屏；误伤＝一句正当建议被拒，很吵但看得见），但误伤照样会让人把闸关掉，所以两头都钉住。

_EN_MUST_HARD_FAIL = [
    "Rank her against the rest of the team.",
    "Rank them among their peers by output.",
    "He is our weakest link on the team.",
    "Grade each report A through F this quarter.",
    "Her ownership score dropped to 3.",
    "His collaboration score fell to 2.",
]

_EN_MUST_STILL_PASS = [
    # ADR-0016 的不对称：公司 / 工作产物的量化是**合法**的，一个都不许被这四条补丁带走。
    "Our audit score was 9 out of 10.",
    "Their compliance score dropped to 3 after the review.",
    "Their uptime score went to 4 nines last month.",
    "Team throughput ranks bottom 20% against last quarter.",
    "Rank the projects against each other by deadline risk.",
    "The postmortem is graded on rework, not on people.",
    "She raised the weak point in the handover process.",
    "Do not score her; talk to her instead.",
]


@pytest.mark.parametrize("text", _EN_MUST_HARD_FAIL)
def test_en_scoring_and_ranking_gaps_are_closed(text):
    res = redline.validate(text, cited_snippets=[])
    assert not res.passed, f"英文侧漏了一句人身打分/排名：{text!r}"


@pytest.mark.parametrize("text", _EN_MUST_STILL_PASS)
def test_en_gap_patches_do_not_touch_work_or_company_quantification(text):
    res = redline.validate(text, cited_snippets=[])
    assert res.passed, f"补漏把一句合法的工作/公司量化误伤了：{text!r} / {res.summary()}"
