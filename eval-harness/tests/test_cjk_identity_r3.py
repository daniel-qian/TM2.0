"""feat-048 ROUND 3 GATE — the red line's scan surface, Han name shape, and department mapping.

GATE-FIRST: every assertion below was run BEFORE any implementation change and is recorded here as
BORN RED or BORN GREEN + MUTATION-PROVEN. Nothing in tests/test_cjk_identity.py (round 2, 101
assertions) is deleted, edited, or weakened; this file is purely additive.

WHY A ROUND 3 EXISTS — the one-sentence version: round 2 fixed four bugs, and three of its fixes
each quietly invalidated a premise that something ELSE was relying on. None of the three is visible
by reading a diff, because in each case the two halves live in different files.

  H1  THE RED LINE HAS A HOLE, AND ROUND 2 OPENED IT.  redline_extract._person_text_fields is
      [role, tenure, owns, collaboration] — `team` is NOT scanned. That exclusion was SAFE for 42
      features for exactly one reason: `team` was a closed enumeration, so it could only ever hold
      "" or a TEAMS entry, and no free text could reach it. Round 2's BUG-4 pass-through turned
      `team` into OPEN FREE TEXT (any department string the document states now lands there
      verbatim) and did not widen the scan surface to match. The premise under the exclusion was
      revoked; the exclusion stayed.

      Round 2's own docstring argues the opposite, IN WRITING, at extract.py:360 —
        "team is NOT part of the red line's scan surface (redline_extract._person_text_fields is
         [role, tenure, owns, collaboration]), so pass-through cannot smuggle text past that gate."
      That reads the fact exactly backwards. Not-scanned is not "cannot smuggle text past the
      gate"; not-scanned is THE HOLE. The sentence is a correct observation wired to an inverted
      conclusion, and it is load-bearing: it is the stated justification for shipping pass-through.

      MEASURED, not reasoned (this file's first duty — the round-2 author reasoned and got it
      backwards, so every claim here is a run):
        team='绩效 8/10 low performer'  -> validate_extraction reports 0 violations
        role='绩效 8/10 low performer'  -> validate_extraction reports 3 violations
      Same text. Same person. One field apart. `role` is gated; `team` is a bypass.

  H2  TWO ROUND-2 FIXES CANCEL EACH OTHER ON ONE PATH.  BUG-3 added _HAN_NAME_RE = ^[一-鿿]{2,4}$,
      which forbids internal whitespace — while the RULER-MISMATCH fix (_person_key folding \\s+) is
      justified by, and only pays off under, the Chinese typographic convention of padding a
      two-character name with U+3000 to align it against a three-character one (「孙　浩」vs
      「李明轩」). BUG-3's shape rule drops 「孙　浩」at the door, so the ruler it was unified with is
      never consulted. The gate did not catch it because Spacing_Variant_Roster.md's 孙　浩 was
      silently dropped, and a dropped person raises no duplicate.

  H3  BUG-4 FIXED ONE DIRECTION OF A TWO-DIRECTION BUG.  _norm_team's reverse substring match
      (`raw in t.lower()`, the "" -> Founders defect) is gone. The FORWARD match (`t.lower() in low`)
      was kept deliberately, with a reason given — and it is the same bug class: 'Eng' is a
      substring of 'Guest Engagement 宾客关系部', so a bilingual five-star hotel's guest-relations
      department is filed under Engineering.

  H5  THE SHAPE RULE IS NOT AN ORACLE — AND IT ALREADY OVER-ACCEPTS AT 4.  Round 2's docstring says
      length is provably not a name oracle (「姓名」== 2 chars == 「孙浩」) and leans the whole defence
      on _NOT_NAME. That is right, and it is under-applied: _NOT_NAME enumerates ROSTER HEADER
      words, so it does not contain 「内部资料」/「请勿外传」— the confidentiality banner that leads
      EVERY Sanya fixture in this repo. Measured: _looks_like_name('内部资料') is True TODAY, and a
      Chinese resume ingests a colleague named 「内部资料」 (see test_zh_resume_names_the_person_*).
      This is feat-039's "No." bug, reborn in Chinese, inside the rule round 2 added to prevent it.
      H5's ask (widen {2,4} for 「买买提艾力」) therefore does not CREATE the name/phrase tension —
      it inherits one that is already live one character down.

WHAT THIS FILE DELIBERATELY DOES NOT GATE — see tests/test_zh_project_axis_gap.py for H4 (Chinese
project/signal extraction), which is quarantined with strict xfail and argued there.
"""
from __future__ import annotations

from pathlib import Path

import pytest

from avery.ingest import HeuristicExtractor, extract_docs, parse_file
from avery.ingest.extract import PersonEntity, ExtractionResult, _looks_like_name, _norm_team
from avery.ingest.pipeline import ingest_docs
from avery.ingest.redline_extract import validate_extraction

HERE = Path(__file__).resolve().parent
CJK = HERE / "fixtures" / "cjk"

ZH_ROSTER = CJK / "Sanya_Team_Roster_ZH.md"
SPACING_ROSTER = CJK / "Spacing_Variant_Roster.md"
SCORED_TEAM_ROSTER = CJK / "Sanya_Roster_Scored_Team_ZH.md"
BILINGUAL_ROSTER = CJK / "Sanya_Bilingual_Roster.md"
ZH_RESUME = CJK / "Zhang_Wei_Resume_ZH.md"


def _person(**kw) -> ExtractionResult:
    res = ExtractionResult()
    res.people.append(PersonEntity(id=kw.pop("id", "u_test"), name=kw.pop("name", "孙浩"), **kw))
    return res


def _heuristic(*paths: Path) -> ExtractionResult:
    return extract_docs([parse_file(p) for p in paths], extractor=HeuristicExtractor())


# =================================================================================================
# H1 — THE RED LINE. `team` is open free text now; the scan surface must follow it.
# =================================================================================================

# Real person-scoring text, in the shapes a Chinese HR export actually produces.
#
# EVERY VALUE HERE IS VERIFIED TO BE CAUGHT ALREADY WHEN IT SITS IN `role`, and that verification is
# the entry requirement for this list — it is what keeps this gate about ONE defect. H1 is a
# SCAN-SURFACE bug: the machinery to catch this text exists and works, and `team` is simply not shown
# to it. So the gate must only ever demand of `team` what `role` already delivers.
#
# Measured (violations when the same string sits in `role`):
#     '绩效 8/10 low performer' -> 3   ['PERSON-TIER', 'PERSON-SCORE']
#     '评分：4 星'               -> 3   ['PERSON-SCORE', 'PERSON-SCORE']
#     '考核 2 分'                -> 2   ['PERSON-SCORE']
#     '排名 3'                   -> 2   ['PERSON-SCORE']
#     'low performer'           -> 1   ['PERSON-TIER']
#
# TWO VALUES FROM THE BRIEF WERE REMOVED FROM THIS LIST AFTER MEASUREMENT — 「情绪低落」and
# 「潜力 A 类，建议重点培养」. They are NOT H1 cases: they score 0 violations in `role` TOO (see the
# H6 quarantine at the bottom of this file). They are a LEXICON gap in redline.validate, not a
# scan-surface gap, and demanding them here would have quietly required the implementer to expand
# the person-scoring lexicon — a far larger change with its own false-positive surface — as the
# price of a one-line scan-surface fix. A gate that bundles an unrelated, bigger fix into a blocker
# is how blockers stop landing.
SCORING_TEAM_VALUES = [
    "绩效 8/10 low performer",     # ZH label + N/M + English scoring lexicon
    "评分：4 星",                   # ZH rating word + star rating
    "low performer",               # pure English lexicon
    "考核 2 分",                    # ZH assessment + N分
    "排名 3",                       # ZH ranking + bare number
]


@pytest.mark.parametrize("scored", SCORING_TEAM_VALUES)
def test_person_scoring_text_in_team_is_a_violation_H1(scored):
    """BORN RED (measured: 0 violations for every value above).

    THE BLOCKER. `team` became free text in round 2 and the red line never learned. This is the
    highest-severity assertion in the round: AVERY_ALLOW_PERSON_SCORING defaults OFF, meaning the
    product's promise is that a person-scoring document CANNOT become a context. Today, moving the
    same text one field to the left honors that promise; moving it one field to the right breaks it
    silently, with `ok=True` and an empty violations list.
    """
    res = _person(name="孙浩", role="餐饮部领班", team=scored)
    rl = validate_extraction(res)
    assert not rl.ok, (
        f"person-scoring text {scored!r} sat in person.team and the red line reported "
        f"PASS. `team` is open free text since round 2's BUG-4 pass-through; "
        f"redline_extract._person_text_fields still scans only [role, tenure, owns, collaboration], "
        f"so team is an unguarded lane into a context. Violations: {rl.violations}"
    )


def test_team_is_gated_exactly_like_role_H1():
    """BORN RED. The invariant behind H1, stated without reference to any lexicon: for person free
    text, WHICH FIELD it landed in must not decide whether the red line sees it. Written this way so
    it cannot be satisfied by special-casing the seven strings above."""
    scored = "绩效 8/10 low performer"
    in_role = validate_extraction(_person(name="孙浩", role=scored))
    in_team = validate_extraction(_person(name="孙浩", team=scored))
    assert in_role.ok == in_team.ok, (
        f"the SAME text is a violation in `role` (ok={in_role.ok}) but clean in `team` "
        f"(ok={in_team.ok}). A red line that depends on which column HR pasted into is not a red "
        f"line."
    )


# Real departments — the false-positive guard. If H1's fix is a blunt "team always violates", or a
# lexicon so broad it fires on ordinary nouns, THIS is what catches it. Sanya's actual org chart
# plus every English value the shipped corpus and the two stub transports emit.
CLEAN_TEAM_VALUES = [
    "前厅部", "客房部", "餐饮部", "市场推广部", "销售部", "宾客关系部",
    "工程部", "人事部", "财务部", "安保部", "康乐部",
    "Design", "Eng", "Ops", "GTM", "Founders", "Product",
    "Engineering", "Operations", "Sales", "Growth", "Marketing",
    "Guest Engagement 宾客关系部", "Food & Beverage 餐饮部",
]


@pytest.mark.parametrize("clean", CLEAN_TEAM_VALUES)
def test_real_departments_in_team_are_not_violations_H1(clean):
    """BORN GREEN (today `team` is not scanned at all) and MUST STAY GREEN once it is.

    MUTATION-PROVEN — this assertion has teeth, verified by running the mutation, not by asserting
    it would work:
      * mutate redline_extract._person_text_fields to `return [p.team]` and have _scan_person_value
        flag any non-empty field ("team always violates") -> this test goes RED on all 24 values.
    So a fix that buys H1 by declaring every department a scoring violation cannot pass here.

    WHY IT MATTERS MORE THAN IT LOOKS: `ok=False` is a HARD FAIL in pipeline.ingest_docs:130 — the
    context is never built and the customer's whole upload is rejected. A false positive on 「前厅部」
    does not mis-render one card; it refuses the entire hotel. Over-fixing H1 is a worse outage than
    H1, which is why this guard is parametrized over the real org chart rather than a token case.

    MEASURED PRE-CONDITION: all 24 values are clean through redline.validate AND through both number
    scans today, so the honest fix (add team to the scan surface, change nothing else) passes this
    on arrival — there is no tension between H1's forward and reverse halves. That was checked, not
    hoped: an unmappable department is a NOUN, and the scan fires on rating shapes and a scoring
    lexicon, neither of which a department name contains.
    """
    rl = validate_extraction(_person(name="孙浩", role="餐饮部领班", team=clean))
    assert rl.ok, (
        f"the real department {clean!r} in person.team was reported as a person-scoring violation: "
        f"{rl.violations}. This is a FALSE POSITIVE, and it is not cosmetic — validate_extraction "
        f"failing means pipeline.ingest_docs refuses to build the context at all, so the whole "
        f"upload is rejected. Whatever H1's fix is, it must not treat a department name as a score."
    )


def test_ingest_docs_hard_fails_when_team_carries_a_score_H1(monkeypatch):
    """BORN RED. End-to-end through the REAL pipeline, not a hand-built entity: the fixture is a
    roster where HR pasted the performance-review column into the department column (the ordinary
    way this text reaches `team` — nobody types a rating into a field labelled 部门 on purpose).

    This is the assertion that matches the product promise: with AVERY_ALLOW_PERSON_SCORING off, a
    scored document must NOT become a CompanyContext.
    """
    monkeypatch.delenv("AVERY_ALLOW_PERSON_SCORING", raising=False)
    report = ingest_docs([parse_file(SCORED_TEAM_ROSTER)], extractor=HeuristicExtractor())
    teams = [p.team for p in report.extraction.people]
    assert not report.ok, (
        f"a roster carrying 「绩效 8/10 low performer」/「评分：4 星」/「情绪低落」 in its department "
        f"column built a context successfully. person.team values that got through: {teams}. "
        f"The red line's whole purpose is that this document cannot become a context."
    )
    assert report.context is None, (
        f"ingest reported not-ok but still handed back a context: {report.context}"
    )


def test_ingest_docs_still_accepts_a_clean_zh_roster_H1():
    """BORN GREEN, MUST STAY GREEN. The end-to-end twin of the false-positive guard: the ordinary
    Sanya roster (前厅部/客房部/餐饮部/市场推广部/销售部) must keep building a context. If H1's fix is
    too blunt, the first customer's real roster stops ingesting — this catches that at the pipeline
    boundary rather than at the unit boundary.

    MUTATION-PROVEN: with the "team always violates" mutation above, this goes RED.
    """
    report = ingest_docs([parse_file(ZH_ROSTER)], extractor=HeuristicExtractor())
    assert report.ok, (
        f"the plain Sanya roster stopped ingesting: {report.redline.violations}. Its department "
        f"column contains nothing but real department names."
    )
    assert report.context is not None


# =================================================================================================
# H2 — a Han name may contain internal whitespace. U+3000 alignment is a typographic convention,
# not a typo.
# =================================================================================================

@pytest.mark.parametrize("name,why", [
    ("孙　浩", "U+3000 IDEOGRAPHIC SPACE — the standard way to align a 2-char name against a 3-char one"),
    ("孙 浩", "U+0020 — the same convention typed by someone without a CJK-aware editor"),
    ("欧阳　菲", "U+3000 after a COMPOUND surname"),
])
def test_han_name_with_internal_space_is_a_name_H2(name, why):
    """BORN RED (measured: all False). _HAN_NAME_RE = ^[一-鿿]{2,4}$ has no whitespace in its class.

    THE TWO-FIX CANCELLATION. Round 2 unified the identity ruler on _person_key (which folds \\s+)
    and justified that work with exactly this convention — then shipped a shape rule that discards
    the names the ruler was unified to handle. The ruler is never reached. Both fixes are in the
    tree; the path they share is dead.
    """
    assert _looks_like_name(name), (
        f"_looks_like_name({name!r}) is False. {why}. A name padded to align a column is still a "
        f"name; the heuristic drops this colleague before _slug or _person_key ever sees him."
    )


def test_spacing_variant_roster_yields_sun_hao_through_heuristic_H2():
    """BORN RED (measured: the fixture yields ONLY 李明轩 — 孙　浩 is dropped, Lena Park is dropped by
    the separate `Lena  Park` double-space case round 2 already gates).

    Integration, through the real heuristic path — the one that runs when the LLM budget is
    exhausted (extractor_factory.py:87) or the model fails (llm_extract.py:216/222/227).
    """
    res = _heuristic(SPACING_ROSTER)
    names = [p.name for p in res.people]
    hits = [p for p in res.people if p.name.replace("　", "").replace(" ", "") == "孙浩"]
    assert hits, (
        f"孙　浩 (U+3000-padded, exactly as the 餐饮部 roster writes him) was not extracted at all. "
        f"People found: {names}. His row is well-formed; only the space in his name disqualifies him."
    )
    assert len(hits) == 1, f"孙浩 was extracted {len(hits)} times from one roster: {names}"
    assert hits[0].id, "孙浩 was extracted with an empty id"


def test_sun_hao_is_one_person_across_spacing_and_zh_rosters_H2():
    """BORN RED TODAY, AND RED AGAIN UNDER THE NAIVE FIX. This is the round's sharpest trap, and it
    is the reason H2 cannot be closed by editing one regex.

    Measured, in order:
      1. TODAY: Spacing_Variant_Roster (孙　浩) + Sanya_Team_Roster_ZH (孙浩) -> exactly ONE 孙浩.
         The gate looks green — but it is green BY DROP: 孙　浩 never becomes a person, and a person
         who does not exist cannot duplicate. Round 2's dedup gate is passing on a corpse.
      2. AFTER a naive `_HAN_NAME_RE` widening: 孙　浩 becomes extractable, and
              _person_key('孙　浩') == '孙 浩'  !=  _person_key('孙浩') == '孙浩'
         because folding \\s+ COLLAPSES runs of whitespace to one space, it does not REMOVE it. So
         the corpus grows a SECOND 孙浩 — ids u_孙_浩 and u_孙浩, two cards, one human. Fixing H2
         alone does not just fail to help; it manufactures the very cross-document duplicate that
         round 1's BUG-2 existed to kill.

    Hence both halves are asserted together: he must be PRESENT (fails today) and SINGULAR (fails
    under the naive fix). Only a fix that reconciles the shape rule AND the identity key passes.
    The assertion is on the OUTCOME (one 孙浩), not on any particular key implementation.

    THE PRESENCE HALF IS CHECKED ON THE SPACING ROSTER ALONE, AND THAT IS NOT A STYLE CHOICE — it is
    what makes this test born-red at all. Asserting only `len(sun_hao) == 1` over the merged corpus
    PASSES TODAY (verified), because ZH_ROSTER supplies an unspaced 孙浩 and the spaced one is
    dropped: the count is right for the wrong reason. Exactly the "green on a corpse" failure this
    test exists to name.
    """
    solo = _heuristic(SPACING_ROSTER)
    assert any(p.name.replace("　", "").replace(" ", "") == "孙浩" for p in solo.people), (
        f"孙　浩 is not extracted from his own roster at all, so any cross-document count of him is "
        f"meaningless. People in Spacing_Variant_Roster.md: {[p.name for p in solo.people]}"
    )
    res = _heuristic(SPACING_ROSTER, ZH_ROSTER)
    sun_hao = [p for p in res.people if p.name.replace("　", "").replace(" ", "") == "孙浩"]
    names = [(p.id, p.name) for p in res.people]
    assert sun_hao, (
        f"孙浩 is in BOTH rosters and came out of neither as a spaced name. People: {names}"
    )
    assert len(sun_hao) == 1, (
        f"孙浩 the 餐饮部领班 is ONE person, extracted as {len(sun_hao)}: "
        f"{[(p.id, p.name) for p in sun_hao]}. The 餐饮部 roster pads him with U+3000 and the 人事部 "
        f"roster does not; _person_key folds a whitespace RUN to a single space but never removes "
        f"it, so '孙 浩' and '孙浩' remain different keys and dedup cannot see through the padding. "
        f"Two cards, one man — BUG-2 rebuilt in the whitespace dimension."
    )


# The reverse half. A widened shape rule must not start eating table headers — and the pure-Han
# header PAIR is the exact string a whitespace-permissive rule newly admits.
NOT_NAMES_WITH_SPACE = ["姓名 职位", "部门 司龄", "姓名　职位", "职位 部门", "姓名 部门 司龄"]


@pytest.mark.parametrize("header", NOT_NAMES_WITH_SPACE)
def test_spaced_header_strings_are_not_names_H2(header):
    """BORN GREEN (the current rule rejects them because it forbids spaces at all) and MUST STAY
    GREEN once spaces are allowed. This one is a live trap, not a formality.

    MUTATION-PROVEN, against the fix shape that actually works — and getting there corrected a wrong
    claim, so both mutations are recorded:

      * `^[一-鿿\\s]{2,4}$` (adding \\s to the character class — the one-character edit) does NOT
        break this test, and the reason is worth knowing: the space CONSUMES the length budget, so
        「姓名 职位」is 5 characters and is rejected — by accident, not by rule. That same accident
        makes this mutation a NON-FIX: 「欧阳　菲」 is also 5 characters, so it stays rejected and
        test_han_name_with_internal_space_H2 keeps failing. A rule that only admits spaced names
        short enough to fit under 4 is not the convention; it is a coincidence.
      * `^[一-鿿]{1,4}(?:\\s+[一-鿿]{1,4})*$` (segment-wise — the shape that DOES close all three
        forward cases including 欧阳　菲) turns 「姓名 职位」, 「部门 司龄」, 「职位 部门」and
        「姓名 部门 司龄」into people. MEASURED under it: all 5 assertions here go RED and the roster
        grows a colleague called 「姓名 职位」. _NOT_NAME cannot save them — it holds 「姓名」and
        「职位」as SEPARATE entries, and 「姓名 职位」is neither; stripping the space first does not
        rescue it either, since 「姓名职位」is not on the list as a concatenation.

    So the only fix that passes this AND the forward half must check the SEGMENTS around the
    whitespace against _NOT_NAME (「姓名 职位」-> 姓名 is a header word -> reject; 「孙　浩」-> 孙/浩
    are not -> accept). That is a real rule, not a patch over these examples.
    """
    assert not _looks_like_name(header), (
        f"_looks_like_name({header!r}) is True — a table header row became a colleague. This is "
        f"feat-039's 'No.' bug in Chinese, and _looks_like_name is the ONLY thing standing between "
        f"this string and a person card: _people_from_roster's `cells[0] in _NOT_NAME` guard tests "
        f"the WHOLE cell, and 「姓名 职位」is not on _NOT_NAME (it holds 姓名 and 职位 as separate "
        f"entries), nor is its concatenation 「姓名职位」. Only the per-SEGMENT test rejects it. "
        f"(feat-049 taught the header detector Han, so that guard now runs on a Chinese roster where "
        f"it never used to — but it still cannot catch a spaced PAIR, which is what this gate is.)"
    )


# =================================================================================================
# H3 — department mapping. The forward substring match is the same bug as the reverse one.
# =================================================================================================

def test_bilingual_department_is_not_squeezed_into_eng_H3():
    """BORN RED (measured: _norm_team('Guest Engagement 宾客关系部') == 'Eng').

    'Eng' is a substring of 'Guest Engagement'. Round 2 killed the reverse direction of this
    substring match ("" is a substring of everything -> Founders) and kept the forward direction on
    purpose. Same class, same damage: a五-star hotel's guest-relations team is filed under
    Engineering — a department the hotel does not have.
    """
    got = _norm_team("Guest Engagement 宾客关系部")
    assert got != "Eng", (
        f"_norm_team('Guest Engagement 宾客关系部') == {got!r}. 'Eng' is a substring of 'Guest "
        f"ENGagement', so a bilingual department name gets swallowed by a bucket that has nothing "
        f"to do with it. 宾客关系部 is not Engineering; the hotel has no Engineering."
    )


@pytest.mark.parametrize("stated", [
    "Guest Engagement 宾客关系部",
    "Food & Beverage 餐饮部",
    "Front Office 前厅部",
    "Housekeeping 客房部",
    "Marketing 市场推广部",
    "Guest Relations",
    "Engagement Team",
])
def test_bilingual_department_is_preserved_or_left_alone_H3(stated):
    """BORN RED for the 'Eng'-bearing values; the rest pin the shape of an honest fix.

    The positive statement of H3: a department the TEAMS taxonomy cannot express must survive as
    itself — which is precisely the principle round 2 established for BUG-4 and then applied in only
    one direction. 'Marketing 市场推广部' is not Ops; 'Guest Relations' is not Eng.
    """
    got = _norm_team(stated)
    assert got == stated, (
        f"_norm_team({stated!r}) == {got!r}. The stated department is not expressible in TEAMS "
        f"(Founders/Eng/Product/Design/GTM/Ops), so per BUG-4's own pass-through principle it must "
        f"be kept verbatim, not squeezed into whichever bucket happens to appear as a substring."
    )


def test_bilingual_roster_departments_survive_through_heuristic_H3():
    """BORN RED. Integration: the bilingual roster is not a contrivance — a five-star hotel's
    department signage is bilingual and the roster copies the signage."""
    res = _heuristic(BILINGUAL_ROSTER)
    by_name = {p.name: p.team for p in res.people}
    assert by_name.get("陈思雨") == "Guest Engagement 宾客关系部", (
        f"陈思雨's department came out as {by_name.get('陈思雨')!r}. Roster says "
        f"「Guest Engagement 宾客关系部」."
    )
    assert by_name.get("李明轩") == "Housekeeping 客房部", f"got {by_name.get('李明轩')!r}"
    assert by_name.get("Lin Qing") == "Design", (
        f"the one genuinely-Design colleague stopped mapping to Design: {by_name.get('Lin Qing')!r}"
    )


# The English freeze, restated additively. Round 2 froze these in
# test_norm_team_english_mapping_is_frozen_BUG4; H3 changes _norm_team, so they are re-asserted here
# to fail loudly IN THIS FILE if H3's fix moves them. Round 2's copies are untouched and still run.
ENGLISH_TEAM_FREEZE = [
    ("Design", "Design"), ("Eng", "Eng"), ("Engineering", "Eng"), ("Sales", "GTM"),
    ("Operations", "Ops"), ("Founder", "Founders"), ("Founders", "Founders"),
    ("Design Team", "Design"), ("Product", "Product"), ("GTM", "GTM"), ("Ops", "Ops"),
    ("go-to-market", "GTM"), ("ops", "Ops"),
]


@pytest.mark.parametrize("raw,expected", ENGLISH_TEAM_FREEZE)
def test_english_team_mapping_stays_frozen_under_H3(raw, expected):
    """BORN GREEN, MUST STAY GREEN. The iron rule: English behavior does not move.

    MUTATION-PROVEN: replacing _norm_team's TEAMS loop with a strict `if low == t.lower()` (the
    over-tight fix for H3 — "just require equality") turns 'Design Team' -> 'Design Team' and this
    test goes RED. So H3 cannot be bought by demanding exact equality: it must keep the honest
    mappings while refusing the accidental substring ones.

    MEASURED PRECISELY, because the first version of this note over-claimed: under that mutation
    'Engineering' still -> 'Eng', rescued by _TEAM_ALIASES, which the mutation does not touch. Only
    'Design Team' actually breaks. One assertion's worth of teeth is enough to catch the mutation,
    but the list is not 13 independent guards against it — most of the English surface is held up by
    the alias table, not by the TEAMS loop H3 edits. Worth knowing before trusting this row of
    green: it means H3's real blast radius is narrower than it looks.
    """
    assert _norm_team(raw) == expected, (
        f"_norm_team({raw!r}) == {_norm_team(raw)!r}, expected {expected!r}. H3's fix moved a "
        f"FROZEN English mapping."
    )


# =================================================================================================
# H5 — the shape rule's length bound, and what actually separates a name from a phrase.
# =================================================================================================

@pytest.mark.parametrize("name", ["买买提艾力", "阿卜杜拉", "古丽娜扎", "帕尔哈提"])
def test_five_han_transliterated_name_is_a_name_H5(name):
    """BORN RED for 买买提艾力 (5 Han; {2,4} rejects it). The 4-char transliterations are BORN GREEN
    and are here to keep the fix from being a special case for one string.

    Uyghur/Mongolian/Kazakh transliterated names are 5+ Han characters as a matter of course, and
    they are ordinary Chinese citizens' legal names. Round 2 flagged the interpunct form
    「买买提·艾力」as a known gap; the far more common unpunctuated form was not flagged.
    """
    assert _looks_like_name(name), (
        f"_looks_like_name({name!r}) is False — _HAN_NAME_RE's {{2,4}} bound drops a real legal "
        f"name. A hotel in 三亚 employs people whose names transliterate to five characters."
    )


@pytest.mark.parametrize("phrase", ["本周很顺利", "项目已完成", "大家辛苦了", "这周没问题"])
def test_short_sentences_with_function_words_are_not_names_H5(phrase):
    """BORN GREEN (5 chars > the current {2,4} bound) and MUST STAY GREEN after the bound moves.

    MUTATION-PROVEN, and again the mutation is the obvious fix:
      * `_HAN_NAME_RE = re.compile(r"^[一-鿿]{2,5}$")` — the minimal edit H5 invites — makes all
        four of these names and turns this test RED.

    WHERE THE HONEST LINE IS, stated plainly because H5's two halves really are in tension and the
    tension does not fully resolve: every phrase here carries a FUNCTION WORD (很/已/了/没) — a
    particle, adverb or negation that Chinese personal names do not contain. That is a real
    discriminator with real grounding, and it is what these four assertions pin.

    IT IS NOT A COMPLETE ONE, AND THIS FILE WILL NOT PRETEND OTHERWISE. A 5-character
    function-word-free noun phrase — 「宴会动线图」(banquet flow diagram) — is NOT distinguishable
    from 「买买提艾力」by any rule available at this layer: both are five Han characters of content
    morphemes, and a surname check fails too (买 is a rare surname, but 买买提 is phonetic Uyghur, not
    a Han surname at all, so a 百家姓 gate rejects the real name it is meant to admit). NO ASSERTION
    IS WRITTEN FOR 「宴会动线图」, because a gate no honest rule can satisfy is a gate that will be
    weakened later, and a weakened gate is worse than an absent one. The residual risk is bounded by
    POSITION, not shape: _looks_like_name only ever sees cells[0] of a table row and a resume's
    first six lines — see the H5b tests below for where that bound actually leaks.
    """
    assert not _looks_like_name(phrase), (
        f"_looks_like_name({phrase!r}) is True — a sentence became a colleague. {phrase!r} contains "
        f"a function word (很/已/了/没); Chinese personal names do not. Widening the length bound "
        f"for 「买买提艾力」cannot be done on length alone."
    )


# --- H5b: the over-acceptance that is ALREADY LIVE at 4 characters -------------------------------

@pytest.mark.parametrize("banner", ["内部资料", "请勿外传", "个人简历", "制表说明", "机密文件"])
def test_document_banners_are_not_people_H5b(banner):
    """BORN RED for 内部资料/请勿外传/机密文件/制表说明 (measured: _looks_like_name('内部资料') is True
    TODAY). 个人简历 is BORN GREEN — it is already on _NOT_NAME — and is included to show the defence
    IS a list, and the list is simply missing the entries that matter most.

    NOT A HYPOTHETICAL, AND NOT INTRODUCED BY H5 — this is live on the round-2 code as it stands.
    Round 2's reasoning was right: length is not a name oracle, so _NOT_NAME is the only real
    defence. The gap is that _NOT_NAME was populated with ROSTER COLUMN HEADERS (姓名/职位/部门/司龄)
    while the string that actually leads a Chinese document is the CONFIDENTIALITY BANNER. Every
    fixture in this directory opens with 「三亚亚特兰蒂斯别墅酒店 · 内部资料 · 请勿外传」.
    """
    assert not _looks_like_name(banner), (
        f"_looks_like_name({banner!r}) is True. A document banner is 4 Han characters, so round 2's "
        f"{{2,4}} rule accepts it as a name, and _NOT_NAME does not list it — the list enumerates "
        f"roster headers, not document banners. This is feat-039's 'No.' bug reborn in Chinese, "
        f"inside the rule round 2 added to prevent exactly that."
    )


def test_zh_resume_names_the_person_not_the_banner_H5b():
    """BORN RED. The end-to-end proof that H5b is live and shipping, on the REAL heuristic path.

    Measured on round-2 code, with a Chinese resume under an ASCII filename (how a Chinese HR system
    exports — pinyin filename, Han content; note sniff_kind's own patterns are ASCII-only, so a file
    named 张伟_简历.md is routed to `unknown` and never extracted at all — a separate ZH gap, not
    gated here):
        people == [('u_内部资料', '内部资料')]
    张伟, the 餐饮总监, ingests as a colleague named 「内部资料」. _people_from_resume scans the first
    six lines and takes the first thing that looks like a name; the banner is on line 3 and the man
    is on line 5, so the banner wins. The customer gets a team page with a person called
    "Internal Material" and no 张伟.

    THE FIXTURE'S BANNER STANDS ON ITS OWN LINE, AND THAT IS LOAD-BEARING — reported here because it
    bounds the finding honestly. The first draft of this fixture wrote the banner the way the other
    Sanya files do, inline: 「三亚亚特兰蒂斯别墅酒店 · 内部资料 · 请勿外传」. That form does NOT leak —
    _people_from_resume splits on `\\s+[—\\-–|,]\\s+`, the interpunct `·` is not in that set, so the
    whole line is tested as one string and fails the shape rule harmlessly. The bug needs the banner
    ALONE on a line, which is itself an ordinary Chinese convention (banner line, blank, then the
    heading). So: the unit-level over-acceptance (_looks_like_name('内部资料') is True) is
    unconditional, while its end-to-end reachability depends on the document's layout. Both are
    real; only the second is layout-sensitive, and this test pins the layout that reaches it.
    """
    res = _heuristic(ZH_RESUME)
    names = [p.name for p in res.people]
    assert "内部资料" not in names, (
        f"the confidentiality banner 「内部资料」was extracted as a PERSON: {names}. It leads the "
        f"document, so _people_from_resume's first-six-lines scan reaches it before the real name."
    )
    assert "张伟" in names, (
        f"张伟 — the actual subject of the resume, on the line 「张伟 — 餐饮总监」— was not extracted. "
        f"People found: {names}"
    )


# =================================================================================================
# H6 QUARANTINE — a redline.validate LEXICON gap, found while measuring H1. NOT an H1 case, NOT a
# `team` case, and NOT this round's work. strict=True so it cannot rot: the day the lexicon learns
# these, pytest goes red here and this quarantine must be retired deliberately.
# =================================================================================================

@pytest.mark.xfail(strict=True, reason="H6 — redline.validate lexicon gap; NOT the H1 scan surface")
@pytest.mark.parametrize("qualitative", [
    "情绪低落",                       # a mood label on a person — the R3 red line's own subject matter
    "潜力 A 类，建议重点培养",          # potential TIERING with a letter grade instead of a digit
])
def test_qualitative_person_labels_are_violations_H6(qualitative):
    """MEASURED: 0 violations — IN `role`, the field that IS scanned. So this has nothing to do with
    H1's scan surface, and it is recorded here precisely so it is not mistaken for it.

    The brief listed 「情绪低落」as an H1 example. It is not one, and the difference matters: H1 is
    "the gate never sees `team`", while this is "the gate sees the text and has no rule for it".
    Both number scans need a DIGIT (情绪低落 has none; 潜力 A 类 has a LETTER grade), and
    redline.validate's person lexicon returns [] for both — these are qualitative labels whose
    scoring character is carried by meaning, not shape.

    THIS LIST IS EXACTLY TWO ENTRIES, AND IT SHRANK — the note is the point. It first also carried
    「绩效评级：不合格」and 「排名倒数第一」, on the assumption that a qualitative label with no digit
    must be a lexicon gap. MEASURED: they are 2 and 1 violations respectively — already caught, via
    the content gate, exactly as redline_extract.py's own module docstring states ("Qualitative
    labels with no digit ('绩效评级：不合格', '排名倒数第一') are NOT scanned here — the content gate
    catches them"). `strict=True` is what surfaced the mistake: both XPASSed and pytest failed them
    rather than letting a false "known gap" sit in the tree looking like a finding. Assuming instead
    of running is the exact failure this whole round exists to correct, so it is logged rather than
    quietly deleted. The real gap is narrow: a mood label, and a tier expressed as a LETTER.

    WHY IT IS NOT BEING FIXED HERE: the fix is lexicon expansion, whose whole risk lives in false
    positives, and its blast radius is the ADVICE gate (avery/redline.py), which every loop output
    already flows through — not the ingest layer this round touches. 「情绪低落」in particular is a
    genuinely hard call: 「客人情绪低落」(a guest is upset) is an ordinary, correct situational
    observation a hotel manager must be able to record, while 「孙浩情绪低落」is a mood rating on an
    employee. Separating them needs the person-anchoring work redline.py already does for other
    rules, done carefully, with its own corpus. That is a ticket, not a rider.

    SEVERITY, stated so the deferral is a decision and not an omission: this is a real hole in the
    person red line — 「绩效评级：不合格」in a person's role field builds a context today. It is
    narrower than H1 (it needs a qualitative label with no digit and no English lexicon hit, whereas
    H1 lets ANY scoring text through via one field), and unlike H1 it was not introduced by round 2.
    It should be the next red-line ticket after H1 lands.
    """
    res = _person(name="孙浩", role=qualitative)
    assert not validate_extraction(res).ok, f"{qualitative!r} in role was not a violation"
