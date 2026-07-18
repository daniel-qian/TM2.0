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

ROUND 2 — and the reason this docstring now has a round 2 is the more useful lesson of the two.
Round 1 shipped with all 376 assertions green and the hole still open, because the corpus had a
SHAPE it did not contain. `_ORDINARY` covered cue+verb (「日期未定」) and cue+ordinary-noun
(「无锡分公司」) but never once cue+SCORING-noun — which is the single shape the new lookahead
would accept. So the one form that could still disarm the gate was the one form nobody tested:

    「无绩效数据的部门里，陈思雨排名倒数第一，建议列入末位淘汰名单。」 -> PASSED, 0 violations
    「在新成立的部门里，  陈思雨排名倒数第一，建议列入末位淘汰名单。」 -> BLOCKED

Only the leading noun phrase differs. 「无绩效数据」/「非考核期间」/「未评级岗位」/「不能打分」 are
ordinary roster Chinese, and all of them read as NOUN PHRASES — 绩效 modifies 数据; nothing is
negated — while `_NEG_GOVERNS_TIGHT` counted the bare scoring noun as proof that an ACTION had been
negated. MEASURED: 22 such words x 4 payloads = 88/88 leaked, 64 of them BLOCKED before round 1,
i.e. a net regression. The fix is in `redline.py` (`_NEG_GOVERNS_ACTION`, and the modals split out
of the prohibition list into `_NEG_ZH_MODAL`); the guard against it recurring is `_NOMINALISED`
below, which is GENERATED from `redline._NEG_SCORE_NOUN` rather than hand-enumerated, so a scoring
word added to that table cannot arrive without its corpus rows.

The general lesson, recorded because it outlives this file: a mutation proof shows the rule works on
the shapes you thought of. It cannot show the rule is safe on the shapes you did not. Only the
corpus can, and only if the corpus is built from the RULE's own vocabulary instead of the author's
imagination.

STILL OPEN, on purpose and pinned by a test rather than left to be rediscovered: the clause-scope
class (「避免打分的团队里，她排名倒数第一。」) — see test_the_clause_scope_gap_is_still_open.
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
    # --- ROUND 2: cue + SCORING NOUN, the shape this corpus was missing --------------------------
    # Hand-written HR/roster Chinese, kept alongside the generated `_NOMINALISED` block because
    # these are the actual phrases the three customers' documents use and they read as sentences a
    # human can check. Every one of them is a NOUN PHRASE — 「无绩效数据」 is 'a department with no
    # perf data', not 'do not score'. All 18 leaked before round 2; 14 of them BLOCKED before
    # round 1, so round 1 regressed them.
    "无绩效数据", "无考核记录", "无评分标准", "无打分权限", "无排序需求", "无淘汰指标",
    "非考核期间", "非绩效面谈", "非评估范围", "未评级岗位", "未排名季度", "未考核完成",
    "不能打分", "不可评级", "不必排名", "不再打分", "不予考核", "不宜排名",
]

# The SAME shape, generated instead of imagined — the reason round 1's 376 green assertions did not
# catch anything. `_NEG_SCORE_NOUN` is the rule's own vocabulary, so crossing it with every
# nominalisable cue produces exactly the set of strings the lookahead could possibly accept, and it
# grows by itself when somebody adds a scoring word to `redline.py`.
#
# 「数据」 is the head noun for all of them on purpose: it is the most ordinary thing an HR column
# can be, it is not in any lexicon, and it makes every row a noun phrase rather than a clause.
#     MEASURED: 11 cues x 33 nouns = 363 rows. Round 1 leaked 363/363; round 2 leaks 0/363.
_NOMINALISABLE_CUES = ["未", "无", "非",
                       "不准", "不许", "不能", "不可", "不必", "不宜", "不予", "不再"]
_SCORE_NOUNS = redline._NEG_SCORE_NOUN.removeprefix("(?:").removesuffix(")").split("|")
_NOMINALISED = [f"{cue}{noun}数据" for cue in _NOMINALISABLE_CUES for noun in _SCORE_NOUNS]


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
@pytest.mark.parametrize("word", _NOMINALISED)
def test_a_nominalised_scoring_word_does_not_switch_the_gate_off(word, payload):
    """BORN RED — all 363 of them, and 363/363 is the whole point.

    A scoring word after 未/无/非 or a 不+modal is the HEAD OF A NOUN PHRASE, not a negated action:
    「无绩效数据」 is a department without performance data, and it says nothing whatsoever about
    whether the person after it was scored. Round 1's lookahead accepted it as proof that scoring
    had been prohibited, and so switched the person-scoring gate off for 32 characters.

    This block is GENERATED from `redline._NEG_SCORE_NOUN` rather than written out, which is the
    actual fix to the process failure: round 1 hand-enumerated its corpus and hand-enumeration is
    what let the one dangerous shape go missing. Add a word to `_NEG_SCORE_NOUN` and 11 new rows
    appear here automatically.
    """
    text = _row(word, payload)
    assert not redline.validate(text).passed, (
        f"「{word}」 suppressed a person score: {text!r}\n"
        f"It is a noun phrase (cue + scoring noun + head), not a prohibition. If this leaks, "
        f"`_NEG_GOVERNS_ACTION` has gone back to accepting a bare `_NEG_SCORE_NOUN` as evidence "
        f"that an action was negated. Control: {_row('金牌顾问', payload)!r} correctly FAILS."
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

def _alt(name: str, alt: str) -> str:
    assert alt in redline._NEG.pattern, (
        f"the {name} alternative is no longer in _NEG as constructed from its own constants — the "
        f"mutations below point at nothing and would pass VACUOUSLY. Re-derive them.")
    return alt


def _alt_prohibition() -> str:
    return _alt("prohibition-cue",
                rf"(?:{redline._NEG_ZH_PROHIBITION})(?={redline._NEG_GOVERNS})|")


def _alt_modal() -> str:
    return _alt("不+modal cue",
                rf"(?:{redline._NEG_ZH_MODAL})(?={redline._NEG_GOVERNS_ACTION})|")


def _alt_plain() -> str:
    return _alt("未/无/非",
                rf"(?<![{redline._NEG_非_COMPOUND}])(?:未|无|非)"
                rf"(?={redline._NEG_GOVERNS_ACTION})|")


# Round 1's lookahead for the nominalisable cues, kept here as the thing to mutate BACK to. This is
# the literal shipped-and-reviewed rule of commit 53f7041.
def _round1_tight() -> str:
    return (rf"(?:[{redline._NEG_COVERB}]|{redline._NEG_SCORE_NOUN}|"
            rf"{redline._NEG_PERSON_OBJ})")


def _with_neg(pattern: str, fn):
    original = redline._NEG
    try:
        redline._NEG = re.compile(pattern, re.I)
        return fn()
    finally:
        redline._NEG = original


def _leaking_words(corpus: list[str] | None = None) -> list[str]:
    return [w for w in (_ORDINARY if corpus is None else corpus)
            if any(redline.validate(_row(w, p)).passed for p in _PAYLOADS)]


def _false_alarms() -> list[str]:
    return [s for s in _REAL_NEGATIONS if not redline.validate(s).passed]


@pytest.mark.parametrize("half,mutate,expect", [
    ("the lookahead on the PROHIBITION cues",
     lambda: redline._NEG.pattern.replace(
         _alt_prohibition(), rf"(?:{redline._NEG_ZH_PROHIBITION})|"),
     22),
    ("the lookahead on the 不+modal cues",
     lambda: redline._NEG.pattern.replace(
         _alt_modal(), rf"(?:{redline._NEG_ZH_MODAL})|"),
     10),
    ("the lookahead on 未/无/非",
     lambda: redline._NEG.pattern.replace(_alt_plain(), r"(?:未|无|非)|"),
     47),
    ("the X非 lookbehind",
     lambda: redline._NEG.pattern.replace(
         _alt_plain(), rf"(?:未|无|非)(?={redline._NEG_GOVERNS_ACTION})|"),
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

    MEASURED counts, over the 84-word ordinary corpus:
        shipped rule                    0 leaks
        prohibition cues bare          22 leaks   (不要紧/不用了/好得不得了/莫名其妙/禁止吸烟…)
        不+modal cues bare             10 leaks   (不准确/不可思议/不能上线/不必要/不能打分…)
        未/无/非 bare                   47 leaks   (未来规划/日期未定/无锡分公司/非常好…)
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
    ("the PROHIBITION cues", _alt_prohibition, 10),
    ("the 不+modal cues", _alt_modal, 1),
    ("the 未/无/非 cues", _alt_plain, 3),
])
def test_each_cue_class_is_needed_by_a_real_negation(alt, getter, expect):
    """The reverse direction of the same proof: delete a cue class outright and count how many REAL
    negations start being refused. A cue that no sentence depends on should not be in the table.

    MEASURED:
        prohibition cues removed -> 10 false alarms (不该对她做员工画像 / 杜绝末位淘汰名单 / …)
        不+modal cues removed     ->  1 false alarm  (不可给他定级为不合格)
        未/无/非 removed          ->  3 false alarms (未把她标成离职风险 / 并未给她定级为不合格 /
                                                     未把他列入末位淘汰名单)

    The modal class earning exactly ONE sentence is worth stating plainly rather than rounding up:
    the eight 不准/不许/不能/… negations in `_REAL_NEGATIONS` are mostly VACUOUS (nothing in them
    fires even with `_NEG` switched off entirely), so 「不可给他定级为不合格。」 is the whole reason
    the class exists. That is a thin justification for a cue class, and the honest reading is that
    it is carried for the FALSE-ALARM direction on advice this corpus only barely samples — not
    that it is load-bearing the way the prohibition cues are.
    """
    alarms = _with_neg(redline._NEG.pattern.replace(getter(), ""), _false_alarms)
    assert len(alarms) == expect, (
        f"removing {alt} produced {len(alarms)} false alarms, expected {expect}: {alarms}")


@pytest.mark.parametrize("mutation,mutate,ordinary,nominalised", [
    ("the nominalisable cues accept a bare scoring noun again (round 1's _NEG_GOVERNS_TIGHT)",
     lambda: redline._NEG.pattern
     .replace(_alt_modal(), rf"(?:{redline._NEG_ZH_MODAL})(?={_round1_tight()})|")
     .replace(_alt_plain(),
              rf"(?<![{redline._NEG_非_COMPOUND}])(?:未|无|非)(?={_round1_tight()})|"),
     18, 363),
    ("the 不+modals are folded back into the prohibition list (round 1's single class)",
     lambda: redline._NEG.pattern.replace(_alt_modal(), "").replace(
         _alt_prohibition(),
         rf"(?:{redline._NEG_ZH_PROHIBITION}|{redline._NEG_ZH_MODAL})"
         rf"(?={redline._NEG_GOVERNS})|"),
     6, 264),
])
def test_round_2_is_load_bearing(mutation, mutate, ordinary, nominalised):
    """BORN GREEN, and it is the proof that round 2 fixed something rather than restating round 1.

    Each parametrisation reverts ONE half of the round-2 change to the rule that was actually
    shipped and reviewed in 53f7041, and demands the leaks come back. This is the test round 1 did
    not have: its own mutations all pointed at round-1 constructs, so every one of them stayed green
    while the gate was open.

    MEASURED:
        shipped rule                              0 ordinary,   0 nominalised
        bare scoring noun accepted again         18 ordinary, 363 nominalised
        modals folded back in with prohibitions   6 ordinary, 264 nominalised

    The nominalised counts are the load-bearing ones — 363/363 and 264/363 are total failures of the
    generated corpus, which is exactly what round 1 shipped and no test noticed.
    """
    pattern = mutate()
    leaked_ord = _with_neg(pattern, lambda: _leaking_words(_ORDINARY))
    leaked_nom = _with_neg(pattern, lambda: _leaking_words(_NOMINALISED))
    assert (len(leaked_ord), len(leaked_nom)) == (ordinary, nominalised), (
        f"reverting «{mutation}» produced {len(leaked_ord)} ordinary / {len(leaked_nom)} "
        f"nominalised leaks, expected {ordinary} / {nominalised}.\n"
        f"ordinary: {leaked_ord}\n"
        f"If both counts went to 0 the round-2 narrowing is dead weight and should be deleted "
        f"rather than carried. If they moved, the corpus drifted — look before editing the number."
    )


# --- the gap that is still open, pinned rather than left to be rediscovered ---------------------

# 避免/拒绝/杜绝/无须 + a scoring noun. These are REAL prohibitions ('avoid scoring', 'refuse to
# rank'), so no lookahead can reject them — the cue is correct and the sentence around it is not.
# What is wrong is SCOPE: the prohibition governs its own clause, and `_negated` has no notion of
# one, so it reaches 32 characters into the next clause and disarms a score that is really there.
_CLAUSE_SCOPE_LEAKS = ["避免打分", "拒绝打分", "杜绝排名", "无须评估"]


@pytest.mark.parametrize("word", _CLAUSE_SCOPE_LEAKS)
def test_the_clause_scope_gap_is_still_open(word):
    """CHARACTERIZATION — this test asserts a BUG IS PRESENT, and it is here so that the gap is a
    recorded decision instead of a thing the next reader has to find again.

    Same disease as the rest of this file, one layer up: 「避免打分的团队里，她排名倒数第一。」 has a
    genuine 避免打分 prohibition modifying 团队, and a genuine person score after it. PRE-EXISTING —
    OLD (53f7041) and NEW behave identically here, so round 2 neither caused nor fixed it.

    THE FIX IS KNOWN AND WAS MEASURED, then deliberately backed out: give `_negated` a clause /
    CSV-field boundary (a cue may not reach across 「，。；！？、」 or ASCII `,;!?`, but NOT a colon —
    「不给她打分：8/10。」 is one statement). That closes all four with 0 new false alarms on
    `_REAL_NEGATIONS`. It was backed out because it CONTRADICTS an explicit contract one file over —
    test_redline_villa_negation_b3.py::test_negated_window_is_the_scope_of_a_real_cue requires
    「别给她打分,绩效评分2分」 to PASS, i.e. requires a cue to reach across a comma — and because
    with the boundary in place `_row` goes VACUOUS (measured: bare cues leak 0/66 through it), so
    the whole corpus above would have to be rebuilt on punctuation-free rows in the same change.
    That is a design change to the moat with its own blast radius, including English. It needs its
    own line, not a quiet ride on this one.

    WHEN THAT LINE LANDS: delete this test rather than weakening it.
    """
    leaked = [p for p in _PAYLOADS if redline.validate(_row(word, p)).passed]
    assert leaked == _PAYLOADS, (
        f"「{word}」 no longer suppresses every payload (still leaking: {leaked}). If the clause-"
        f"scope fix landed, DELETE this characterization test — do not weaken it. If something else "
        f"changed, find out what: this file's other tests assume the gap is exactly this shape."
    )


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
    EXTENDS the modal list (不准/不许/不能/不可/不必/不宜/不予/不再) and must not shortcut it to 不.

    Round 2 adds the other half of the same constraint: those extended modals nominalise
    (「不能打分的实习生」), so the bigram alone is not enough either — it has to govern something
    ACTION-shaped. 「不能打分」 is asserted here as a NON-cue for that reason."""
    assert not redline._NEG.search("不"), "bare 不 became a negation cue — it must stay a bigram"
    assert not redline._NEG.search("不合格"), "「不合格」 must not read as a negation"
    assert not redline._NEG.search("不动产"), "「不动产」 must not read as a negation"
    assert not redline._NEG.search("不能打分"), (
        "「不能打分」 read as a negation cue. The 不+modal bigrams must govern an ACTION "
        "(_NEG_GOVERNS_ACTION), not a bare scoring noun — see test_round_2_is_load_bearing.")
    assert redline._NEG.search("不能给她打分"), (
        "「不能给她打分」 stopped reading as a negation — the round-2 narrowing ate the modal cue "
        "instead of bounding it. 给 is the coverb that makes this an action.")


def test_the_corpus_is_actually_chinese():
    """The previous wave's gates were all green while every gate corpus was ASCII/pinyin, and the
    first real Chinese document broke them (see MEMORY: 'gate-corpus-all-ascii-blindspot'). Pinyin
    cannot exhibit a single failure in this file — every one of them is a morpheme boundary that
    only exists in the script. So the corpus is asserted to BE Chinese."""
    han = re.compile(r"[一-鿿]")
    for item in (_ORDINARY + _NOMINALISED + _REAL_NEGATIONS + _SCORING_NAMES[:8] + _PAYLOADS
                 + _CLAUSE_SCOPE_LEAKS):
        assert han.search(item), f"corpus item carries no Han character: {item!r}"
    assert len(_ORDINARY) >= 80, f"ordinary-vocabulary corpus shrank to {len(_ORDINARY)}"
    assert len(_REAL_NEGATIONS) >= 45, f"negation corpus shrank to {len(_REAL_NEGATIONS)}"
    assert len(_NOMINALISED) >= 300, f"nominalised corpus shrank to {len(_NOMINALISED)}"


def test_the_nominalised_corpus_is_generated_from_the_rules_own_vocabulary():
    """The guard on the guard, and the actual lesson of round 2.

    `_NOMINALISED` is only worth anything if it is derived from `redline._NEG_SCORE_NOUN` — that is
    what makes it grow when the rule grows, and hand-enumeration is precisely what let round 1 ship
    a corpus with the one dangerous shape missing. If someone ever replaces the derivation with a
    frozen literal list, this goes red.

    It also pins the parse: `_NEG_SCORE_NOUN` is a `(?:a|b|c)` alternation, and if it ever stops
    being one, `_SCORE_NOUNS` would silently become a single junk string and the 363 rows would
    collapse to 11 meaningless ones.
    """
    assert len(_SCORE_NOUNS) >= 30, (
        f"_NEG_SCORE_NOUN parsed into {len(_SCORE_NOUNS)} entries ({_SCORE_NOUNS[:3]}…). It is no "
        f"longer a flat (?:a|b|c) alternation, so the generated corpus is not what it claims.")
    for noun in _SCORE_NOUNS:
        assert re.fullmatch(r"[一-鿿]+", noun), (
            f"parsed a non-word out of _NEG_SCORE_NOUN: {noun!r} — the alternation now carries "
            f"regex syntax and the generated rows are malformed.")
    assert len(_NOMINALISED) == len(_NOMINALISABLE_CUES) * len(_SCORE_NOUNS), (
        "the nominalised corpus is no longer the full cartesian product of the cues and the rule's "
        "own scoring vocabulary — it has been frozen or filtered, and the next scoring word added "
        "to redline.py will arrive without any corpus rows.")
