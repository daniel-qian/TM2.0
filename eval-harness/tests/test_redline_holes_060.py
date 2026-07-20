# -*- coding: utf-8 -*-
"""feat-060 — the two red-line holes the last wave shipped with, and the gates that keep them shut.

Both came off `lite-live-v02-0713/session-handoff.md` §仍开, and both are the kind that only shows
up on somebody else's document — which is the situation three external companies are about to
create by uploading their own files.

  HOLE 1  `name` was not on the red line's scan surface.
          `extract.py:801` (the resume path) falls back to the FILE NAME when it cannot find a
          name-like header, so `绩效8分.docx` becomes a person literally called 「绩效8分」. The two
          person scans in `redline_extract` both missed it, for two independent reasons:
            (a) `_scan_person_value` iterates `_person_text_fields`, which listed
                [role, tenure, team, owns, collaboration] — never `name`;
            (b) the CONTENT scan is guarded by `if blob.strip()`, and that blob was built from the
                same list. A resume with no detectable role/tenure/owns leaves it EMPTY, so for the
                file-name-fallback person — the exact one whose name came from a file — NOTHING was
                scanned at all.
          `name` is also the one person field `llm_extract` deliberately does NOT sanitise
          (`_strip_person_ratings` skips it), which is correct: you refuse the upload, you do not
          quietly rename somebody. Refusing requires seeing it first.

  HOLE 2  The `_NEG` negation table was still mostly BARE.
          B3 fixed 「别」 by making it a conjunction — not the tail of an X别 noun AND governing a
          verb — because 「别墅」 (villa) was switching person-scoring off for 32 characters. Nothing
          else in the table got the same treatment, and 别 was never the only cue with the disease.

MEASURED, and the measurements are the point of this file. See `_ORDINARY` / `_REAL_NEGATIONS`
below: a 66-word ordinary-vocabulary corpus and 50 real negations, all of it genuine Han text.
That last clause is not decoration — the previous wave's gate corpora were ASCII/pinyin stand-ins,
every gate was green, and the first real Chinese document broke them. Pinyin cannot exhibit any of
the failures in this file, because every one of them is a morpheme boundary that only exists in the
script.

  BEFORE:  16 / 66 ordinary words silently disarmed the gate
             不要紧 · 这事不要紧                        <- 不要
             不用了 · 不用功 · 不用心                    <- 不用
             好得不得了                                <- 不得  (不得不/不得已 were neutralised; 不得了 was not)
             不应期 · 不做不错                          <- 不应 / 不做
             不可避免 · 无法避免 · 难以避免 · 避免不了     <- 避免
             无法拒绝 · 拒绝不了                         <- 拒绝
             无需求分析                                 <- 无需
             宁缺勿滥                                   <- 勿
           6 / 50 real negations were falsely refused (未 / 莫 / 不可 / 以免 / 免得 absent entirely)
  AFTER:   0 and 0.
"""
from __future__ import annotations

import re

import pytest

from avery import redline
from avery.ingest import redline_extract
from avery.ingest.extract import ExtractionResult, PersonEntity
from avery.ingest.parse import ParsedDoc
from avery.ingest.pipeline import ingest_docs
from avery.ingest.redline_extract import validate_extraction


def _person(**kw) -> ExtractionResult:
    res = ExtractionResult()
    res.people.append(PersonEntity(id=kw.pop("id", "u_x"), **kw))
    return res


# =============================================================================================
# HOLE 1 — the `name` field
# =============================================================================================

# What the file-name fallback actually produces when the uploaded file is named after the REPORT
# rather than after the person, plus the shapes an LLM extractor hands back when it reads a roster
# column header as a name. Every one of these built a context with ok=True before feat-060.
_SCORING_NAMES = [
    "绩效8分",                 # the brief's own example — a resume named 绩效8分.docx
    "张三-KPI95",              # name + a score-shaped number, the structural scan's job
    "王五(离职风险高)",         # digit-free attrition label — content scan only
    "赵六 末位淘汰名单",        # digit-free tier label — content scan only
    "孙浩 绩效评级不合格",      # digit-free performance grade
    "员工画像-周雅婷",          # person-profiling compound
    "李四 8/10",               # bare N/M scale
    "KPI 95分",
    "Bob low performer",       # the English lexicon reaches `name` too
    "flight risk sarah",
]


@pytest.mark.parametrize("name", _SCORING_NAMES)
def test_a_scoring_name_alone_is_a_violation(name):
    """BORN RED, and red for the WORST version of the bug: this person has NOTHING but a name.

    That is not a contrived entity — it is what `extract.py`'s resume path emits for a document
    whose text yields no role, no tenure and no bullet list. The old `if blob.strip()` guard then
    skipped the content scan entirely, so the red line never ran on the person at all.

    MEASURED before the fix: all 10 -> ok=True, violations=[].
    """
    rl = validate_extraction(_person(name=name))
    assert not rl.ok, (
        f"a person whose NAME is {name!r} passed the extraction red line with nothing else set.\n"
        f"`name` was not in redline_extract._person_text_fields, so the structural scan never saw "
        f"it; and the content scan is gated on the blob built from that same list, which is empty "
        f"for a person who has only a name. The resume path names people after the FILE "
        f"(extract.py:801) — this is the shape that reaches the gate from a real upload."
    )


def test_name_is_gated_exactly_like_role():
    """The invariant behind hole 1, stated without reference to any lexicon — deliberately the same
    shape as feat-048 R3's `test_team_is_gated_exactly_like_role_H1`, because it is the same class
    of bug one field further left: WHICH FIELD person text landed in must not decide whether the
    red line sees it."""
    scored = "绩效 8/10 low performer"
    in_role = validate_extraction(_person(name="孙浩", role=scored))
    in_name = validate_extraction(_person(name=scored, role="餐饮部领班"))
    assert in_role.ok == in_name.ok, (
        f"the SAME text is a violation in `role` (ok={in_role.ok}) but clean in `name` "
        f"(ok={in_name.ok}). A red line that depends on which column the extractor wrote to is not "
        f"a red line."
    )


def test_a_scoring_name_is_caught_even_when_the_rest_of_the_card_is_populated():
    """The SECOND, independent half of hole 1 — and the one the `if blob.strip()` fix alone does
    NOT close, which is why both halves are asserted separately.

    `张三-KPI95` with a real role has a non-empty blob, so the content scan DID run before feat-060.
    It still leaked, because the content lexicon has no rule for a bare `KPI95` — that shape is the
    STRUCTURAL scan's (`_ZH_SCORE_NEAR_NUM`), and the structural scan iterates `_person_text_fields`
    and therefore never saw the name.

    MEASURED: name='张三-KPI95' role='销售顾问' -> ok=True before, ok=False after, and the surviving
    violation kind is `person-score-value` (structural), not `person-score-text`.
    """
    rl = validate_extraction(_person(name="张三-KPI95", role="销售顾问"))
    assert not rl.ok, "a score-shaped number in `name` survived a fully populated person card"
    assert any(v.kind == "person-score-value" for v in rl.violations), (
        f"expected the STRUCTURAL scan to be what catches this (it is the only scan that knows the "
        f"`KPI95` shape); got kinds {[v.kind for v in rl.violations]}. If only "
        f"`person-score-text` fires, `name` is reaching the content blob but still not the value "
        f"scan, and half of hole 1 is open."
    )


# The false-positive guard, and it matters more than it looks: `ok=False` is a HARD FAIL at
# pipeline.ingest_docs:130 — a false positive on a real name does not mis-render one card, it
# refuses the customer's entire upload. So this is parametrised over the ACTUAL 20-person Sanya
# roster (tests/test_cjk_team_axis_r4._SANYA_ORG), the English names the corpus and both stub
# transports emit, and — because that is where hole 1's text comes from — the shapes the FILE-NAME
# fallback really produces.
_REAL_NAMES = [
    # the real Sanya roster, all 20
    "陈思雨", "李明轩", "赵天宇", "吴梦洁", "郑伟豪", "周雅婷", "孙浩", "黄志强",
    "林晓彤", "徐国栋", "何静怡", "罗嘉明", "高子涵", "谢文博", "邓丽华", "曹俊杰",
    "韩雪松", "冯语嫣", "唐博文", "蒋依琳",
    # English names the corpus / stub transports emit
    "Marcus Reid", "Lena Park", "Aarav Patel", "Priya Sharma", "Sofia Alvarez",
    # file-name-derived names — the fallback path, with the shapes real uploads carry
    "陈思雨 简历", "marcus reid resume", "2024 述职报告 张三", "王小明-简历-2024",
    "三亚别墅酒店 花名册", "员工手册", "前厅部 李娜", "司龄8年 张伟", "入职3年",
    "团队成员 12 人",
]


@pytest.mark.parametrize("name", _REAL_NAMES)
def test_real_names_are_not_violations(name):
    """BORN GREEN and it MUST STAY GREEN — the guard against over-fixing hole 1.

    MUTATION-PROVEN, by running it: make `_scan_person_value` flag any non-empty field and all 35
    values go red. So a fix that buys hole 1 by treating every name as suspicious cannot pass here.

    The dates and tenures are in this list on purpose: `司龄8年 张伟` / `入职3年` / `2024 述职报告
    张三` are exactly the numbers the scans' year/tenure/count lookarounds exist to exclude, and a
    name is where they are most likely to arrive unescorted.
    """
    rl = validate_extraction(_person(name=name, role="销售顾问"))
    assert rl.ok, (
        f"the real name {name!r} was reported as a person-scoring violation: {rl.violations}.\n"
        f"This is a FALSE POSITIVE and it is not cosmetic — validate_extraction failing means "
        f"pipeline.ingest_docs refuses to build the context, so the WHOLE upload is rejected."
    )


def test_filename_fallback_resume_is_refused_end_to_end():
    """The whole machine, on the document the hole was reported about.

    HERMETIC — `ingest_docs(extractor=None)` resolves to the default `HeuristicExtractor`, so there
    is no key, no network and no flake. The red line is a MOAT; it does not get to be conditional on
    a model being reachable.

    MEASURED, all three branches run:
        绩效8分.docx     -> people=[绩效8分]     -> ok=False   (was True)
        张三-KPI95.pdf   -> people=[张三-KPI95]  -> ok=False   (was True)
        陈思雨.docx      -> people=[陈思雨]      -> ok=True    (the control — a clean name still ships)
    """
    body = "负责别墅销售与客户接待工作。\n- 带过三个团队"

    for fname in ("绩效8分.docx", "张三-KPI95.pdf"):
        doc = ParsedDoc(name=fname, text=body, doc_kind="resume", ext=fname.rsplit(".", 1)[1])
        report = ingest_docs([doc], name="三亚别墅酒店")
        assert not report.ok, (
            f"a resume file named {fname!r} BUILT A CONTEXT (ok=True, "
            f"redline={report.redline.summary()}). The resume path names the person after the file "
            f"when it finds no name header, so the person card reads 「{fname.rsplit('.', 1)[0]}」."
        )

    control = ParsedDoc(name="陈思雨.docx", text=body, doc_kind="resume", ext="docx")
    ok_report = ingest_docs([control], name="三亚别墅酒店")
    assert ok_report.ok, (
        f"the CONTROL was refused too ({ok_report.redline.summary()}) — 「陈思雨」 is an ordinary "
        f"name off the customer's own roster. Without this arm the two assertions above would pass "
        f"just as well for a gate that refuses every resume, which is a worse outage than the bug."
    )


def test_the_name_scan_is_load_bearing():
    """The mutation proof for hole 1, EXECUTED rather than described: put `_person_text_fields` back
    the way it was and every catch above must come back as a leak. If this ever fails, `name` has
    stopped being what closes the hole and the assertions above have become decoration."""
    original = redline_extract._person_text_fields
    try:
        redline_extract._person_text_fields = (
            lambda p: [p.role, p.tenure, p.team, *p.owns, *p.collaboration])
        leaked = [n for n in _SCORING_NAMES if validate_extraction(_person(name=n)).ok]
        assert leaked == _SCORING_NAMES, (
            f"with `name` off the scan surface these names are STILL caught: "
            f"{[n for n in _SCORING_NAMES if n not in leaked]}. They are therefore not proof that "
            f"putting `name` on the list is what fixed anything — find out what is catching them."
        )
    finally:
        redline_extract._person_text_fields = original
    assert not validate_extraction(_person(name=_SCORING_NAMES[0])).ok, (
        "the mutation was not restored — _person_text_fields is still patched")


# =============================================================================================
# HOLE 2 — the rest of the negation table
# =============================================================================================

# Person-scoring payloads that MUST fire. Same four shapes B3 used, so a regression that only
# rescues the digit-bearing one is visible: 绩效评分2分 is ALSO caught structurally, while the three
# digit-free labels are content-gate-only and are where a bad negation cue actually leaks.
_PAYLOADS = ["绩效评分2分", "离职风险高", "末位淘汰名单", "绩效评级不合格"]

# ORDINARY CHINESE that happens to CONTAIN a negation cue. None of it is a negation; all of it
# belongs in an HR document, a project note or a job title. Grouped by the cue it hides.
_ORDINARY = [
    # 不要 / 不用 / 不得 / 不应 / 不做 — the bigrams feat-029 shipped bare
    "不要紧", "这事不要紧", "不用了", "不用功", "不用心", "好得不得了", "不得已而为之",
    "不应期", "不做不错",
    # 避免 / 拒绝 — prohibition VERBS, and the negation OF one is affirmative
    "不可避免", "无法避免", "难以避免", "避免不了", "无法拒绝", "拒绝不了",
    # 无需 / 勿
    "无需求分析", "宁缺勿滥",
    # 不 — bare 不 is not a cue and must not become one (不动产/不锈钢/不良资产)
    "不动产", "不锈钢", "不良资产", "不准确", "不可思议", "不能上线", "不必要",
    # 未 — "not yet" vs. ordinary vocabulary. 日期未定 / 任务未分配 / 报告未看 are the ones that
    # make 未 impossible to add bare: they are 未 + a perfectly good verb.
    "未来规划", "未知领域", "未成年", "未婚", "未必如此", "未免太急", "日期未定",
    "任务未分配", "报告未看", "未雨绸缪", "周未加班",
    # 无
    "无锡分公司", "无论如何", "无法交付", "无奈之举", "无线网络", "无用功",
    "无关紧要", "无形资产", "虚无缥缈", "无数次",
    # 非 — including the X非 tails that are conditionals or affirmatives, not negations
    "非常好", "非法集资", "除非同意", "是非曲直", "非凡表现", "非要如此", "无非如此",
    "除非给出方案", "无非给点建议", "是非对错", "岂非把人当机器",
    # 莫
    "莫名其妙", "莫斯科项目", "莫过于此", "莫大帮助", "莫非如此", "莫非对她有意见",
    # the prohibition verbs, used about something other than scoring
    "禁止吸烟", "以免超时", "免得麻烦", "切忌浮躁",
]


def _row(word: str, payload: str) -> str:
    """'陈思雨,不用了,绩效评分2分' — the roster-row shape, with the cue-bearing word inside the
    32-char _negated window of the payload, which is the entire mechanism."""
    return f"陈思雨,{word},{payload}"


@pytest.mark.parametrize("payload", _PAYLOADS)
@pytest.mark.parametrize("word", _ORDINARY)
def test_ordinary_words_do_not_switch_the_gate_off(word, payload):
    """BORN RED for 16 of these 66 words (see the module docstring for the roll-call).

    `_negated(text, start, window=32)` asks exactly one question: is there an `_NEG` cue in the 32
    characters before the hit? It has no notion of clause or scope — Chinese gives it no spaces to
    find one with. So any bare cue hiding inside an ordinary word disarms everything after it, and
    it does so SILENTLY. That is the asymmetry that makes this direction the dangerous one: a missed
    negation is a noisy visible false refusal, an over-suppression ships a person score.
    """
    text = _row(word, payload)
    assert not redline.validate(text).passed, (
        f"「{word}」 suppressed a person score: {text!r}\n"
        f"It is an ordinary word, not a negation. Control: {_row('金牌顾问', payload)!r} correctly "
        f"FAILS — the only difference is the cue-bearing word."
    )


@pytest.mark.parametrize("payload", _PAYLOADS)
def test_the_payloads_fire_without_any_cue_word(payload):
    """BORN GREEN — the control arm, and without it every assertion above is worthless.

    If a payload simply never fired (a typo in 「末位淘汰名单」, a lexicon that does not carry
    「绩效评级不合格」) the test above would be green for MY reason rather than the gate's, and would
    stay green through a fix that does nothing."""
    text = _row("金牌顾问", payload)
    assert not redline.validate(text).passed, (
        f"control case unexpectedly PASSED: {text!r} — the payload 「{payload}」 does not fire even "
        f"with no cue word present, so the corpus above is measuring nothing.")


# REAL negations — advice AGAINST scoring a person. Every one must PASS; refusing these is the
# false-alarm direction, and it is what `_NEG` exists to prevent (a baseline was once flagged for
# telling a manager NOT to score a hire). Six of these were refused before feat-060.
_REAL_NEGATIONS = [
    # 不 + modal. 不准/不许/不能/不可/不必/不宜/不予/不再 were absent from the table entirely.
    "不要给她打分。", "不用给她评级。", "不应给他排名。", "不该对她做员工画像。",
    "不得给这位同事的绩效评分2分。", "不做人的考核评级。", "不搞末位淘汰名单。",
    "不给她打分：8/10。", "不准给她打分。", "不许给他排名。", "不能给她评级。",
    "不可给他定级为不合格。", "不必给她打分。", "不宜给他评级。", "不予给她评级。",
    "不再给她打分。",
    # 别 — B3's cue, kept honest here as well as in its own file
    "别给她打分：8/10。", "别把她标成离职风险。", "别对他做员工画像。",
    # 未 — absent before feat-060
    "未给她打分。", "未对他评级。", "未把她标成离职风险。", "尚未给她打分。",
    "从未给他排名。", "并未给她定级为不合格。", "未把他列入末位淘汰名单。",
    # 无
    "无需给她打分。", "无须给他评级。", "毋须给她排名。", "无打分。", "无排名。",
    # 非
    "而非给她打分。", "而不是给他排名。", "并非给她打分。", "绝非给他评级。", "非评分性质。",
    # 莫 / 勿 / 甭 — 莫 and 甭 were absent before feat-060
    "切莫给她打分。", "莫把他标成离职风险。", "莫给她评级。", "请勿给她评级。",
    "勿给他打分。", "甭给她打分。",
    # prohibition verbs — 以免/免得 were absent before feat-060
    "禁止给员工打分。", "严禁给她评级。", "切忌给他排名。",
    "以免给她贴上低绩效员工的标签。", "免得把他标成离职风险。",
    "避免把她标成离职风险。", "杜绝末位淘汰名单。", "拒绝给她打分。",
]


@pytest.mark.parametrize("text", _REAL_NEGATIONS)
def test_real_negations_still_pass(text):
    """The other wall of the corridor. Advice against scoring a person is not a person score.

    Six of these were BORN RED — 「未把她标成离职风险」「并未给她定级为不合格」「未把他列入末位淘汰
    名单」「莫把他标成离职风险」「以免给她贴上低绩效员工的标签」「免得把他标成离职风险」 — because
    未/莫/以免/免得 were not in the table at all. Adding them bare would have re-opened the direction
    above, which is why every cue is a conjunction.
    """
    res = redline.validate(text)
    assert res.passed, (
        f"中文否定式建议被误伤 ({res.summary()}): {text!r}\n"
        f"If this went red while narrowing a cue, the narrowing ate the cue instead of bounding it.")


# --- the mutation proofs: every piece of the rule is shown to carry weight, by execution --------

def _alt_imperative() -> str:
    alt = rf"(?:{redline._NEG_ZH_IMPERATIVE})(?={redline._NEG_GOVERNS})|"
    assert alt in redline._NEG.pattern, (
        "the imperative-cue alternative is no longer in _NEG as constructed from its own constants "
        "— the mutations below point at nothing and would pass vacuously. Re-derive them.")
    return alt


def _alt_plain() -> str:
    alt = (rf"(?<![{redline._NEG_非_COMPOUND}])(?:未|无|非)"
           rf"(?={redline._NEG_GOVERNS_TIGHT})|")
    assert alt in redline._NEG.pattern, (
        "the 未/无/非 alternative is no longer in _NEG as constructed from its own constants.")
    return alt


def _with_neg(pattern: str, fn):
    original = redline._NEG
    try:
        redline._NEG = re.compile(pattern, re.I)
        return fn()
    finally:
        redline._NEG = original


def _leaking_words() -> list[str]:
    return [w for w in _ORDINARY
            if any(redline.validate(_row(w, p)).passed for p in _PAYLOADS)]


def _false_alarms() -> list[str]:
    return [s for s in _REAL_NEGATIONS if not redline.validate(s).passed]


@pytest.mark.parametrize("half,mutate,expect", [
    ("the lookahead on the IMPERATIVE cues",
     lambda: redline._NEG.pattern.replace(
         _alt_imperative(), rf"(?:{redline._NEG_ZH_IMPERATIVE})|"),
     26),
    ("the lookahead on 未/无/非",
     lambda: redline._NEG.pattern.replace(_alt_plain(), r"(?:未|无|非)|"),
     35),
    ("the X非 lookbehind",
     lambda: redline._NEG.pattern.replace(
         _alt_plain(), rf"(?:未|无|非)(?={redline._NEG_GOVERNS_TIGHT})|"),
     5),
])
def test_each_half_of_the_negation_rule_is_load_bearing(half, mutate, expect):
    """BORN GREEN, and the justification for every cue being a CONJUNCTION rather than a plain list.

    Each parametrisation deletes ONE half and demands the over-suppression comes back. If a half
    ever stops mattering, this goes red and the rule should be SIMPLIFIED — a conjunction nobody can
    justify is just complexity. (That is not a hypothetical standard: the X非 lookbehind measured as
    dead weight on the first draft of this corpus and was very nearly deleted. It survived because
    adding 「除非给出方案」/「无非给点建议」/「是非对错」/「莫非对她有意见」/「岂非把人当机器」 —
    the X非 words followed by a COVERB rather than by a noun — put 5 leaks back.)

    MEASURED counts, over the 66-word corpus:
        shipped rule                    0 leaks
        imperative cues bare           26 leaks   (不要紧/不用了/好得不得了/莫名其妙/禁止吸烟…)
        未/无/非 bare                   35 leaks   (未来规划/日期未定/无锡分公司/非常好…)
        X非 lookbehind dropped          5 leaks   (除非给出方案/无非给点建议/是非对错…)
    """
    leaked = _with_neg(mutate(), _leaking_words)
    assert len(leaked) == expect, (
        f"dropping {half} produced {len(leaked)} leaking words, expected {expect}: {leaked}\n"
        f"Either that half stopped carrying weight (simplify the rule) or the corpus drifted and "
        f"the count above is stale. Both are worth a human look; neither is a reason to edit the "
        f"number until it matches."
    )


@pytest.mark.parametrize("alt,getter,expect", [
    ("the IMPERATIVE cues", _alt_imperative, 11),
    ("the 未/无/非 cues", _alt_plain, 3),
])
def test_each_cue_class_is_needed_by_a_real_negation(alt, getter, expect):
    """The reverse direction of the same proof: delete a cue class outright and count how many REAL
    negations start being refused. A cue that no sentence depends on should not be in the table.

    MEASURED:
        imperative cues removed  -> 11 false alarms (不该对她做员工画像 / 杜绝末位淘汰名单 / …)
        未/无/非 removed          ->  3 false alarms (未把她标成离职风险 / 并未给她定级为不合格 /
                                                     未把他列入末位淘汰名单)
    """
    alarms = _with_neg(redline._NEG.pattern.replace(getter(), ""), _false_alarms)
    assert len(alarms) == expect, (
        f"removing {alt} produced {len(alarms)} false alarms, expected {expect}: {alarms}")


def test_the_read_ahead_margin_is_load_bearing():
    """BORN GREEN — and it pins a hole the fix would otherwise have had, found by running the
    alignment rather than reasoning about it.

    Every ZH cue now ends in a LOOKAHEAD, and the thing it must govern is frequently the hit itself
    (「不搞│末位淘汰名单」, 「杜绝│末位淘汰」, 「不做人的│考核评级」, 「不给她│打分」). `_negated`
    used to slice the text dead at the hit, so those lookaheads read truncated text, the cue failed,
    and perfectly good advice was refused. `_NEG_AHEAD` is why that does not happen.

    The window is NOT widened by it: a lookahead is zero-width, so the cue BODY must still end at or
    before the hit. `test_negated_window_is_the_scope_of_a_real_cue` in the B3 file pins that.

    MEASURED: _NEG_AHEAD=10 -> 0 false alarms;  _NEG_AHEAD=0 -> 4.
    """
    original = redline._NEG_AHEAD
    try:
        redline._NEG_AHEAD = 0
        broken = _false_alarms()
        assert len(broken) == 4, (
            f"_NEG_AHEAD=0 produced {len(broken)} false alarms, expected 4: {broken}. If it "
            f"produced none the margin is dead weight and should be deleted rather than carried.")
    finally:
        redline._NEG_AHEAD = original
    assert not _false_alarms(), "the mutation was not restored — _NEG_AHEAD is still patched"


_AFFIRMATIVE_PROHIBITIONS = ["无法避免绩效评分", "不可避免地给她打分：8/10。",
                             "拒绝不了的绩效评分2分"]


def test_the_negation_of_a_prohibition_is_not_a_negation():
    """「不可避免」/「无法避免」/「拒绝不了」 are AFFIRMATIVE — 'cannot be avoided', 'could not be
    refused'. 「无法避免绩效评分」 says the performance scoring HAPPENED, so the 避免 inside it must
    not read as a cue. Same shape as feat-029's 不得不 / 不得已, and neutralised the same way, in the
    same length-preserving substitution — the 别 and 非 lookbehinds read the glyph before the cue, so
    a neutralisation that slid the text left would let them read the wrong neighbour.

    MEASURED: with `_NEG_AFFIRMATIVE` back at `不得不|不得已`, 「无法避免绩效评分」 leaks."""
    for text in _AFFIRMATIVE_PROHIBITIONS:
        assert not redline.validate(text).passed, f"an affirmative prohibition leaked: {text!r}"

    original = redline._NEG_AFFIRMATIVE
    try:
        redline._NEG_AFFIRMATIVE = re.compile(r"不得不|不得已")
        back = [t for t in _AFFIRMATIVE_PROHIBITIONS if redline.validate(t).passed]
        assert back, (
            "reverting _NEG_AFFIRMATIVE to feat-029's two entries leaks nothing, so the added "
            "entries are dead weight and should be deleted rather than carried.")
    finally:
        redline._NEG_AFFIRMATIVE = original
    assert not redline.validate(_AFFIRMATIVE_PROHIBITIONS[0]).passed, (
        "the mutation was not restored — _NEG_AFFIRMATIVE is still patched")


def test_bare_不_is_still_not_a_cue():
    """A standing constraint, not a new one, and the reason 不 is spelled out as bigrams: 不 lives
    inside 不合格 / 不在线 / 不动产 / 不锈钢, so a bare 不 would over-suppress on contact. feat-060
    EXTENDS the modal list (不准/不许/不能/不可/不必/不宜/不予/不再) and must not shortcut it to 不."""
    assert not redline._NEG.search("不"), "bare 不 became a negation cue — it must stay a bigram"
    assert not redline._NEG.search("不合格"), "「不合格」 must not read as a negation"
    assert not redline._NEG.search("不动产"), "「不动产」 must not read as a negation"


def test_the_corpus_is_actually_chinese():
    """The previous wave's gates were all green while every gate corpus was ASCII/pinyin, and the
    first real Chinese document broke them (see MEMORY: 'gate-corpus-all-ascii-blindspot'). Pinyin
    cannot exhibit a single failure in this file — every one of them is a morpheme boundary that
    only exists in the script. So the corpus is asserted to BE Chinese."""
    han = re.compile(r"[一-鿿]")
    for item in _ORDINARY + _REAL_NEGATIONS + _SCORING_NAMES[:8] + _PAYLOADS:
        assert han.search(item), f"corpus item carries no Han character: {item!r}"
    assert len(_ORDINARY) >= 60, f"ordinary-vocabulary corpus shrank to {len(_ORDINARY)}"
    assert len(_REAL_NEGATIONS) >= 45, f"negation corpus shrank to {len(_REAL_NEGATIONS)}"
