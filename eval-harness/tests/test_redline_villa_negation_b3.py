# -*- coding: utf-8 -*-
"""B3 — 「别」 is a negation cue AND the first two glyphs of 别墅 (villa). The first customer is a
三亚**别墅**酒店.

*** FIXED (R5). Everything described below as broken is now caught; this file is the regression
    gate for it, and the past tense is deliberate — the measurements are kept as the record of
    what was actually observed, not as a description of current behaviour. ***

THE FIX, in redline.py: the bare 「别」 alternative in _NEG became a CONJUNCTION —
    (?<![X别 compound formers])别(?=[verb])
i.e. 别 is "don't" only when it is NOT the tail of an X别 noun AND it governs a verb. Both halves
are required and each is mutation-proved below (test_both_halves_of_the_别_rule_are_load_bearing):
    bare 别 (the bug)      32/32 leak, 0 false positives
    delete 别 from _NEG    0 leak — but 19/25 REAL negations break. Not an option; see below.
    following-verb only    7 leak — 分别给/区别对/甄别给/级别分/组别对/判别标/职别对
    lookbehind only        6 leak — 别墅 (THE CUSTOMER'S OWN WORD), 别人, 别的
    BOTH (shipped)         0 leak, 0 false positives
「别墅」/「别人」/「别的」 are excluded BY CONSTRUCTION (墅/人/的 are not verbs) rather than by a
whitelist — which is the point, since a 别墅 whitelist would have fixed almost nothing.

WHAT WAS BROKEN, MEASURED (not reasoned):

    redline._NEG contains a BARE 「别」 (meaning "don't"). redline._negated(text, start, window=32)
    returns True when any _NEG cue sits in the 32 chars BEFORE a hit — so 「别墅」 anywhere in the
    preceding 32 chars SILENTLY SUPPRESSES every person-scoring violation after it.

    A/B, identical sentences, one word changed:
        '陈思雨,别墅销售顾问,绩效评分2分'  -> PASS   (leaks)
        '陈思雨,金牌销售顾问,绩效评分2分'  -> FAIL   (correct)
        '陈思雨,别墅销售顾问,离职风险高'   -> PASS   (leaks)
        '陈思雨,金牌销售顾问,离职风险高'   -> FAIL   (correct)

    The real Sanya roster has 20 people; 5 of them are 「别墅销售顾问」/「别墅顾问」 in the 职位
    column, and the whole 别墅销售组 department sits in the 部门 column. For those people the
    person-scoring content gate IS SIMPLY OFF.

    End-to-end, `pipeline.ingest_docs` on a roster whose 部门 column has been overwritten with a
    performance-review column:
        职位=别墅销售顾问 -> ok=True   <- the context PUBLISHES. This is the R3 document, and R3's
                                        fix does not hold for villa staff.
        职位=金牌销售顾问 -> ok=False  <- correctly refused.

SCOPE — WIDER THAN 别墅, ALSO MEASURED. 「别」 is a live morpheme inside 级别 / 类别 / 识别 / 性别 /
区别. Each one suppresses just the same, so a roster with a 性别 (gender) column — which is most
Chinese rosters — has a 32-char dead zone after it.

THIS IS NOT AN R1-R4 REGRESSION. It is pre-existing. Verified: the 别 alternative in _NEG predates
this line of work, and a villa-role person scores identically before and after R1-R4 (delta 0). It
is reported here because it is in the customer's NAME, not because this round caused it.

WHY 「别」 CANNOT SIMPLY BE DELETED — the reverse direction is real and this file gates it too.
「别」 genuinely means "don't": 「别把她标成离职风险」 is advice AGAINST scoring and must PASS. That
is what _NEG is FOR. So the fix must thread a needle Chinese makes narrow: no spaces, no tokenizer.
Both directions are gated below and BOTH must be green when this is fixed — a fix that deletes 别
from _NEG turns test_real_zh_negation_still_passes RED, and that is the point of it being here.

  *** A TRAP, FOUND BY RUNNING THE MUTATION RATHER THAN TRUSTING IT ***
  The obvious reverse-direction case 「别给人打分」 IS TOOTHLESS and is deliberately NOT used below.
  Measured: it PASSES with 别 in _NEG and it PASSES with 别 removed — because 「人」 alone is not in
  _PERSON_REF and 打分 has no scoring target, so the negation cue is never what saves it. It would
  sit here looking like protection while proving nothing. Only the four cases in
  _ZH_NEGATION_THAT_DEPENDS_ON_别 actually flip when 别 is removed; they were selected BY running
  that mutation, not by reading the regex.

  (R5 note: that four-case list UNDERSTATES the wall. On a corpus wider than this file's, deleting
  「别」 from _NEG breaks 19 of 25 real negations — 千万别把他排名倒数 / 别贴低绩效员工的标签 /
  别下结论说他离职风险高. The cheap fix was never close to viable.)
"""
from __future__ import annotations

import re

import pytest

from avery import redline
from avery.ingest.extract import ExtractionResult, PersonEntity
from avery.ingest.parse import ParsedDoc
from avery.ingest.pipeline import ingest_docs
from avery.ingest.redline_extract import validate_extraction


# =============================================================================================
# The 别-bearing vocabulary, and the control words that isolate it
# =============================================================================================

# Real job titles / departments off the actual Sanya roster (test_cjk_team_axis_r4._SANYA_ORG /
# _ROLE_BY_TEAM), plus the everyday 别-morpheme words the validator's note names. Each is paired
# with a CONTROL of the same shape and length that carries no 别 — the control is what makes this a
# measurement of 「别」 rather than of the sentence.
_VILLA_WORDS = ["别墅销售顾问", "别墅顾问", "别墅销售组", "别墅管家"]
_OTHER_别_WORDS = ["性别", "级别", "类别", "识别", "区别", "差别", "个别", "分别"]
_CONTROL_WORDS = ["金牌销售顾问", "金牌顾问", "渠道合作组", "年龄"]

# Person-scoring payloads that MUST fire. Deliberately spans all three shapes the ZH gate has, so a
# fix that only rescues one shape is visible:
#   * a digit-bearing score   (绩效评分2分)      — also caught structurally, so it is the WEAK one
#   * a digit-free label      (离职风险高)        — content gate ONLY; this is where villa staff leak
#   * a digit-free tier       (末位淘汰名单)      — content gate ONLY
_SCORE_PAYLOADS = ["绩效评分2分", "离职风险高", "末位淘汰名单", "绩效评级不合格"]


def _sentence(word: str, payload: str) -> str:
    """'陈思雨,别墅销售顾问,离职风险高' — the roster row shape, the 别-word within the 32-char
    _negated window of the payload, which is the entire mechanism."""
    return f"陈思雨,{word},{payload}"


# =============================================================================================
# BORN RED — the live hole
# =============================================================================================

@pytest.mark.parametrize("payload", _SCORE_PAYLOADS)
@pytest.mark.parametrize("word", _VILLA_WORDS)
def test_villa_job_title_does_not_suppress_a_person_score(word, payload):
    """BORN RED. The customer-facing half of B3.

    A 别墅 job title / department in a person's row must not switch the person-scoring gate off for
    the next 32 characters. 「别墅」 is a BUILDING, not the word "don't".

    This is not a hypothetical string: 5 of the 20 people on the real Sanya roster carry
    「别墅销售顾问」 in 职位 and all 20 sit under a 部门 that _norm_team now passes through verbatim
    (R2), so 「别墅销售组」 reaches the red line's scan surface as person text (redline_extract.
    _person_text_fields includes `team` — feat-048 round 3 H1 put it there).
    """
    text = _sentence(word, payload)
    res = redline.validate(text)
    assert not res.passed, (
        f"「{word}」 suppressed a person score — the gate is OFF for villa staff: {text!r}\n"
        f"_NEG contains a bare 「别」 (as in 「别做」/don't); 「别墅」 is a villa. _negated() only asks "
        f"whether a cue appears in the 32 chars before the hit, so any 别-word silently disarms "
        f"everything after it.\n"
        f"Control: {_sentence('金牌销售顾问', payload)!r} correctly FAILS — the only difference is 「别」."
    )


@pytest.mark.parametrize("payload", _SCORE_PAYLOADS)
@pytest.mark.parametrize("word", _OTHER_别_WORDS)
def test_ordinary_别_morpheme_words_do_not_suppress_a_person_score(word, payload):
    """BORN RED. The blast radius is not just villas.

    「别」 lives inside 性别 / 级别 / 类别 / 识别 / 区别 / 差别 / 个别 / 分别 — ordinary words that
    appear in ordinary HR documents. A roster with a 性别 column (i.e. most Chinese rosters) carries
    a 32-char hole after every gender cell, for every customer, not just this one.

    Gated separately from the villa cases on purpose: fixing 别墅 with a one-word 白名单 leaves this
    whole class red, and the two failing separately is what says so out loud.
    """
    text = _sentence(word, payload)
    res = redline.validate(text)
    assert not res.passed, (
        f"「{word}」 suppressed a person score: {text!r}\n"
        f"A 别-morpheme word is not a negation. A 白名单 of 别墅 alone does not fix this class."
    )


# Natural ADVICE sentences — not roster cells. Each is paired with a control that changes ONLY the
# 别-word. These are the advisor's OWN output shape, which is what redline.validate primarily gates.
_ADVICE_LEAKS = [
    ("个别员工的绩效评分是2分,建议重点观察。", "有些员工的绩效评分是2分,建议重点观察。"),
    ("从性别和司龄看,她的绩效评级是不合格。", "从年龄和司龄看,她的绩效评级是不合格。"),
    ("先识别问题,再说他的离职风险很高。", "先定位问题,再说他的离职风险很高。"),
    ("这两人的级别不同,但他排名倒数第一。", "这两人的职等不同,但他排名倒数第一。"),
]


@pytest.mark.parametrize("advice,control", _ADVICE_LEAKS)
def test_advice_layer_leaks_person_scores_after_a_别_word(advice, control):
    """BORN RED — and this is the WORST of B3, worse than the roster cases above.

    Everything else in this file is about document ingestion. This is about the ADVISOR'S OWN
    OUTPUT. redline.validate exists first and foremost to gate the final advice Avery gives a
    manager — it is 'the moat' in the module's own words, run identically over Avery and every
    baseline.

    「个别员工的绩效评分是2分,建议重点观察」 — 'a few employees score 2; watch them closely' — is a
    textbook person score, the exact sentence the red line was built to refuse. 「个别」 means 'a
    few'. It contains 「别」. The gate goes quiet.

    So the blast radius is not 'villa job titles at one customer'. It is any advice containing
    个别 / 性别 / 级别 / 类别 / 识别 / 区别 within 32 chars of a score — ordinary words that a
    Chinese-speaking model writes constantly. Each control below differs by ONE word and is
    correctly refused today.
    """
    assert not redline.validate(control).passed, (
        f"control failed to fire: {control!r} — the payload is broken, so the red case proves nothing")
    assert not redline.validate(advice).passed, (
        f"a person-scoring ADVICE sentence passed the red line: {advice!r}\n"
        f"The control {control!r} — identical but for the 别-word — is correctly refused.\n"
        f"This is the advisor's final-output gate, not an ingestion detail: the sentence would be "
        f"shown to a manager. 「个别」/「性别」/「级别」 are not negations."
    )


@pytest.mark.parametrize("word", _VILLA_WORDS + _OTHER_别_WORDS)
def test_extraction_gate_hard_fails_a_scored_villa_person(word):
    """BORN RED, at the layer that actually decides whether the customer's upload is refused.

    redline_extract.validate_extraction renders every person field into one blob and runs
    redline.validate over it. A villa role and a scoring department therefore land in the SAME blob,
    the role sits inside the department's 32-char window, and the gate goes quiet.

    Measured (this is the R3 scenario, run):
        role=别墅销售顾问 team=离职风险高   -> ok=True    LEAK
        role=金牌销售顾问 team=离职风险高   -> ok=False   caught
    """
    res = ExtractionResult()
    res.people.append(PersonEntity(id="u_chen", name="陈思雨", role=word, team="离职风险高"))
    rl = validate_extraction(res)
    assert not rl.ok, (
        f"a person whose role is 「{word}」 carried team='离职风险高' past the extraction red line "
        f"(ok=True). The same entity with role='金牌销售顾问' is refused. R3 put `team` on the scan "
        f"surface; 「别」 takes it back off for anyone whose title contains a 别-word."
    )


def test_villa_roster_with_a_scoring_column_is_refused_end_to_end():
    """BORN RED. The whole machine, the customer's actual document.

    R3's scenario — 人事 pastes the 绩效考核 column into the 部门 column — but with the roles the
    Sanya roster REALLY has. The digit-free labels are used deliberately: a digit-bearing score
    (绩效 8/10) is also caught by the STRUCTURAL scan (_scan_person_value), which never consults
    _negated, so it would mask this bug. Everything below is digit-free, so the content gate is the
    only thing standing there — and for villa staff it is not standing.

    MEASURED, both branches run:
        职位=别墅销售顾问 -> ingest_docs(...).ok is True   <- publishes
        职位=金牌销售顾问 -> ingest_docs(...).ok is False  <- refused

    HERMETIC — no key, no network, no flake: ingest_docs(extractor=None) resolves to
    extract.extract_docs's default, which is HeuristicExtractor() (extract.py:983), NOT an
    env-driven brain. This gate is fully deterministic and belongs in the default suite. The red
    line is a MOAT; it does not get to be conditional on a model being reachable.
    """
    doc = ParsedDoc(
        name="三亚别墅酒店_花名册.xlsx",
        text="\n".join([
            "# sheet: 花名册",
            "姓名 | 职位 | 部门 | 司龄",
            "陈思雨 | 别墅销售顾问 | 离职风险高 | 3 年",
            "李明轩 | 别墅销售顾问 | 末位淘汰名单 | 2 年",
            "赵天宇 | 别墅顾问 | 绩效评级不合格 | 5 年",
        ]),
        doc_kind="roster", ext="xlsx")

    report = ingest_docs([doc], name="三亚别墅酒店")
    assert not report.ok, (
        "a villa roster whose 部门 column holds a performance-review column BUILT A CONTEXT "
        f"(ok=True, redline={report.redline.summary()}).\n"
        "This is the exact document the red line exists to refuse, and R3 fixed it — for everyone "
        "except the people whose job title contains 「别墅」, which at this customer is the sales "
        "floor. The identical roster with role='金牌销售顾问' is correctly refused."
    )


@pytest.mark.parametrize("payload", _SCORE_PAYLOADS)
@pytest.mark.parametrize("control", _CONTROL_WORDS)
def test_control_words_prove_the_payloads_fire_without_别(control, payload):
    """BORN GREEN — the control arm, and without it every red assertion above is worthless.

    A born-red test only means something if it is red for the reason it claims. If a payload simply
    never fired — a typo in 「末位淘汰名单」, a lexicon that does not carry 「绩效评级不合格」 — then
    the villa tests above would be red because of MY mistake and would go green the moment someone
    'fixed' 「别」 in a way that does nothing.

    This asserts the other half of the A/B: the same sentence, same payload, a 别-free word in the
    same slot, MUST fail. All 16 cells fail today. So the delta between this test and the villa test
    above is exactly one morpheme, and that morpheme is the bug.
    """
    text = _sentence(control, payload)
    res = redline.validate(text)
    assert not res.passed, (
        f"control case unexpectedly PASSED: {text!r}\n"
        f"The payload 「{payload}」 does not fire even without a 别-word, so the born-red villa tests "
        f"using it are NOT measuring 「别」 — they are measuring a payload that never worked. Fix the "
        f"payload before trusting anything in this file."
    )


# =============================================================================================
# BORN GREEN — the reason _NEG has 「别」 at all. A fix must not eat this.
# =============================================================================================

# EVERY ONE OF THESE WAS SELECTED BY RUNNING THE MUTATION, NOT BY READING THE REGEX. Each PASSES
# today and FLIPS TO FAIL when the bare 「别」 is removed from _NEG — that flip is the proof that the
# assertion is load-bearing rather than decorative. See the docstring's note on 「别给人打分」, which
# looks like it belongs here, does not flip, and is therefore excluded.
_ZH_NEGATION_THAT_DEPENDS_ON_别 = [
    "别给她打分：8/10，我们不做人的分数。",
    "别把她标成离职风险，这只是正常的适应期。",
    "别对他做员工画像。",
    "别给这位同事的绩效评分2分。",
]


@pytest.mark.parametrize("text", _ZH_NEGATION_THAT_DEPENDS_ON_别)
def test_real_zh_negation_still_passes(text):
    """BORN GREEN, and it must STAY green through the fix.

    「别」 really is "don't". Advice AGAINST scoring a person is not a person score, and flagging it
    was a real observed false positive (a baseline got flagged for telling a manager NOT to score a
    hire — the note on _negated records it).

    This is the wall on the other side of the corridor. The cheap fix for B3 — delete 「别」 from
    _NEG — turns all four of these RED. A correct fix keeps both this and the born-red cases green,
    which is the only reason this file asserts both directions.

    MUTATION PROOF (run, not asserted from reading):
        _NEG: drop the bare `别` alternative
            -> all 4 go RED. So these assertions are held up by the 别 cue and nothing else.
        (The discarded case 「别给人打分」 does NOT go red under the same mutation — it is not
         protected by the cue at all. That is why it is not in this list.)
    """
    res = redline.validate(text)
    assert res.passed, (
        f"中文否定式建议被误伤 ({res.summary()}): {text!r}\n"
        f"「别」 as 'don't' must keep suppressing — advice AGAINST scoring a person is not a score. "
        f"If this went red while fixing B3, the fix removed the cue instead of narrowing it."
    )


def _别_rule() -> str:
    """The live 别 alternative, reconstructed from the implementation's own constants rather than
    hand-copied — so the mutations below cannot silently stop finding what they mutate. (The first
    version of this file hard-coded "|别|"; the fix changed the rule's shape and the mutation proof
    correctly went red rather than passing vacuously. That is the failure mode being avoided here.)
    """
    rule = rf"(?<![{redline._NEG_别_COMPOUND}])别(?=[{redline._NEG_别_VERB}])"
    assert rule in redline._NEG.pattern, (
        "the 别 rule is no longer in _NEG as constructed from _NEG_别_COMPOUND/_NEG_别_VERB — the "
        "mutation proofs below are pointing at nothing and would pass vacuously. Re-derive them.")
    return rule


def test_the_negation_mutation_actually_bites():
    """The mutation proof for the block above, EXECUTED IN-PROCESS rather than described in a
    comment, because a mutation proof that lives only in prose is a claim, not evidence.

    Removes the 「别」 alternative from _NEG entirely and asserts every sentence above flips
    PASS -> FAIL. If this test ever fails, the sentences in _ZH_NEGATION_THAT_DEPENDS_ON_别 have
    stopped depending on the cue and have become decoration — exactly what happened to 「别给人打分」.
    """
    original = redline._NEG
    try:
        mutated = original.pattern.replace(_别_rule() + "|", "")
        assert mutated != original.pattern, "the 别 alternative was not removed by the mutation"
        redline._NEG = re.compile(mutated, re.I)

        still_passing = [t for t in _ZH_NEGATION_THAT_DEPENDS_ON_别 if redline.validate(t).passed]
        assert not still_passing, (
            "these 'negation' cases pass even with 「别」 removed from _NEG, so they are NOT proof "
            f"that the cue works — they pass for some other reason: {still_passing}"
        )
    finally:
        redline._NEG = original

    # and the restore worked — otherwise every later test in the session runs against a mutant
    assert redline.validate(_ZH_NEGATION_THAT_DEPENDS_ON_别[0]).passed, (
        "the mutation was not restored — _NEG is still patched")


# =============================================================================================
# The FIX is a conjunction, and each half is proved to carry weight — by execution
# =============================================================================================

# Sentences that ONLY the lookbehind half saves (an X别 compound followed by a real verb), and
# sentences that ONLY the following-verb half saves (别 heading a noun). Neither half alone is a
# fix, and the brief's suggested direction — "别 requiring a following verb" — is the second column
# only. That is why this is measured rather than argued.
_ONLY_LOOKBEHIND_SAVES = ["分别给她打分：8/10。", "区别对待她的绩效评分2分。"]
_ONLY_VERB_REQ_SAVES = ["陈思雨,别墅销售顾问,离职风险高", "别人给她打分：8/10。"]


@pytest.mark.parametrize("half,drop,leaks", [
    ("the following-verb requirement",
     lambda r: rf"(?<![{redline._NEG_别_COMPOUND}])别", _ONLY_VERB_REQ_SAVES),
    ("the X别-compound lookbehind",
     lambda r: rf"别(?=[{redline._NEG_别_VERB}])", _ONLY_LOOKBEHIND_SAVES),
])
def test_both_halves_of_the_别_rule_are_load_bearing(half, drop, leaks):
    """BORN GREEN, and the justification for the fix being a CONJUNCTION rather than either obvious
    one-liner. Referenced by redline.py's own comment block, and executed here so that claim is
    evidence rather than prose.

    Each parametrisation deletes ONE half of the rule and demands that B3 comes back. If a half
    ever stops mattering, this goes red and the rule should be simplified — a conjunction nobody
    can justify is just complexity.

    MEASURED (this is what picked the fix, on a corpus wider than this file's):
        bare 别 (the bug)     32/32 leak, 0 false positives
        delete 别 from _NEG   0 leak, but 19/25 REAL negations break — the cue exists for those
        verb requirement only 7 leak  — 分别给/区别对/甄别给/级别分/组别对/判别标/职别对
        lookbehind only       6 leak  — 别墅 (the CUSTOMER'S OWN WORD), 别人, 别的
        BOTH (shipped)        0 leak, 0 false positives
    """
    original = redline._NEG
    try:
        mutated = original.pattern.replace(_别_rule(), drop(None))
        assert mutated != original.pattern, "the half-mutation did not change the pattern"
        redline._NEG = re.compile(mutated, re.I)
        back = [t for t in leaks if redline.validate(t).passed]
        assert back == leaks, (
            f"dropping {half} did NOT reintroduce the leak it is supposed to prevent "
            f"(still caught: {[t for t in leaks if t not in back]}).\n"
            f"Either that half is dead weight and the rule should be simplified, or these sentences "
            f"stopped depending on it and are no longer proof of anything."
        )
    finally:
        redline._NEG = original
    assert not redline.validate(_ONLY_VERB_REQ_SAVES[0]).passed, (
        "the mutation was not restored — _NEG is still patched")


# =============================================================================================
# The window semantics — pinned so a fix cannot quietly change the contract
# =============================================================================================

def test_negated_window_is_the_scope_of_a_real_cue():
    """CHARACTERIZATION, born green. A record of how _negated actually behaves.

    REPLACES this file's original test_negated_window_is_the_mechanism, on that test's OWN written
    instruction: it asserted that 「别墅」 suppresses a score at short range, i.e. it pinned THE BUG,
    and its precondition read "has B3 been fixed? If so, delete this characterization test rather
    than weakening it." B3 is fixed, so it is gone rather than softened. What was worth keeping is
    the WINDOW contract, which is re-pinned here with a REAL negation cue (「别给」 = "don't") — that
    survives the fix and is what the next reader actually needs.

    _negated(text, start, window=32) asks ONE question: is there an _NEG cue in the 32 chars before
    `start`? It has no notion of clause or scope — CJK gives it no spaces to find one with. All 8
    call sites in redline.py use the default window. The distance is real: a cue stops reaching past
    32 chars, which is why suppression is per-clause rather than per-document.
    """
    near = "别给她打分,绩效评分2分"                          # the cue is inside the window
    far = ("别给她打分,她在公司做了很多年的客户接待与销售支持工作一直很稳定,"
           "绩效评分2分")                                    # the cue is beyond it

    assert redline.validate(near).passed, (
        "a real 「别给」 negation stopped suppressing at short range — the cue the red line needs "
        "for '别给她打分' has broken; see test_real_zh_negation_still_passes.")
    assert not redline.validate(far).passed, (
        "a negation cue suppressed a score beyond the 32-char window — the window is not bounded "
        "and suppression now reaches across a whole document.")


def test_the_lookbehind_is_not_blinded_at_the_windows_left_edge():
    """BORN GREEN — and it pins a REAL hole the fix would otherwise have had, found by scanning the
    alignment rather than by reasoning about it.

    _negated slices the 32 chars before the hit and matches inside that slice. The 别 rule's
    lookbehind needs the glyph BEFORE the cue — so when a compound straddles the slice's left edge
    ('…差│别对待…', 差 one char outside), the lookbehind sees nothing, reads 「别对」 as "don't", and
    B3 comes back at exactly one offset. redline._NEG_MARGIN exists for this.

    MEASURED (digit-free payload on purpose — 「绩效评分2分」 would be caught structurally by
    _zh_person_score_number regardless and would MASK this entirely; that is why the first attempt
    to demonstrate it showed nothing):
        offset 32 exactly:  _NEG_MARGIN=2 -> caught      _NEG_MARGIN=0 -> LEAKS
        every other offset: identical
    One character wide, silent, and reachable with ordinary text. The mutation below is what proves
    the margin is load-bearing rather than superstition.
    """
    text = "差别对待" + ("x" * 27) + "她的离职风险"        # 别 exactly 32 chars before the hit
    assert not redline.validate(text).passed, (
        f"the 别 rule was blinded at the window's left edge: {text!r}\n"
        "「差别对待」 is 'treat differently', not 'don't'. _NEG_MARGIN is supposed to give the "
        "lookbehind the glyph it needs to see.")

    original = redline._NEG_MARGIN
    try:
        redline._NEG_MARGIN = 0
        assert redline.validate(text).passed, (
            "_NEG_MARGIN=0 no longer leaks, so the margin is dead weight and should be deleted "
            "rather than carried — or this alignment stopped being the edge case it was measured to "
            "be, and the demonstration above proves nothing.")
    finally:
        redline._NEG_MARGIN = original
    assert not redline.validate(text).passed, "the mutation was not restored — _NEG_MARGIN is patched"


def test_villa_no_longer_suppresses_at_any_distance():
    """BORN RED before the fix, green after — the epitaph for B3, kept at both distances.

    The original file measured that 「别墅」 suppressed WITHIN 32 chars and stopped beyond them, and
    used that distance-dependence to prove the window was the mechanism. Now 「别墅」 must not
    suppress at ANY distance, because it is not a negation at all — it is a building.
    """
    for text in ("别墅销售顾问,绩效评分2分",
                 "别墅销售顾问,他在公司做了很多年的客户接待与销售支持工作一直很稳,绩效评分2分"):
        assert not redline.validate(text).passed, (
            f"「别墅」 still suppresses a person score: {text!r}")
