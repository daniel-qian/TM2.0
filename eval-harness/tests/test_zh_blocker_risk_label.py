# -*- coding: utf-8 -*-
"""中文「阻碍项 / 风险」标签行 —— extract.py 的 blockers 扫描只认英文的回归门。

*** FIXED for the labelled-line half. 见文件末尾「已知未修」一节：裸「风险：」标签、以及
    "positive 状态一命中、全文风险兜底扫描就不跑" 这个控制流问题，本文件**刻意不**声称修好。***

THE BUG (adversarial review 2026-07-20, item 2). `_projects_from_doc` 抓 blocker 的正则一直是
纯英文的（`\\b(blocker|blocked|waiting on|...)\\b`），中文标签行一条都进不去。所以

    状态：进行中
    阻碍项：等待法务确认
    风险：人手不足

这份文档，`blockers` 抽出来是空列表，decision_grading 判 `can_proceed`（那条"自报正常、
无未解阻塞、无风险信号"的规则）——文档明明白白写着一条法务阻塞，系统说可以推进。

THIS IS NOT A CHERRY-PICK. main 上对应的正则（`阻碍项|阻碍|阻塞|卡点|风险点`）字面上存在，
但只活在 `_project_from_span` 里——而那个函数是 feat-054 项目粒度闸（`segment_projects` /
`strip_decoration` / 多项目分段，一个和这五条缺陷无关的大功能）把 `_projects_from_doc` 整个
重写之后才有的新宿主。把 main 那行 diff 搬过来，等于把粒度闸也搬过来，违反最小子集纪律。
这里是一份独立的最小实现，安在没有粒度闸的 `_projects_from_doc` 里。

词表刻意与 main 逐字一致（`阻碍项|阻碍|阻塞|卡点|风险点`），不擅自加宽到裸「风险」，原因两条：
  1. 这份子集将来会被从 main 重新拉基线覆盖；词表和 main 不一致，今天能用的修复会在某次例行
     re-baseline 时被 main 的窄版本无声换掉，行为却没人注意到已经变了。
  2. 裸「风险」不是 main 的疏漏，是刻意避开的坑：defect 4 刚治好的反例——
     `无重大风险` / `无明显风险` / `没有风险` / 章节标题「风险与缓解」——每一条都会被裸「风险：」
     的标签正则重新点燃，从另一扇门把 defect 4 放回来。`风险点` 天然不命中这几句里的任何一句。
  裸「风险：人手不足」这类行仍然读不到，是**已知、故意保留**的缺口（main 自己也没盖住），
  详见文件末尾。
"""
from __future__ import annotations

import pytest

from avery.decision_grading import grade_projects
from avery.ingest.extract import HeuristicExtractor
from avery.ingest.parse import ParsedDoc

def _mk_doc(text: str, name: str = "weekly.md") -> ParsedDoc:
    return ParsedDoc(name=name, doc_kind="project", text=text)


def _project(text: str):
    ext = HeuristicExtractor()
    res = ext._projects_from_doc(_mk_doc(text))
    return res.projects[0]


# =============================================================================================
# 1. 中文标签行真的进了 blockers —— 五个词表条目逐一实测
# =============================================================================================

_LABELLED = [
    ("阻碍项：等待法务确认", "等待法务确认"),
    ("阻碍：等待法务确认", "等待法务确认"),
    ("阻塞：等待供应商回复", "等待供应商回复"),
    ("卡点：合同尚未盖章", "合同尚未盖章"),
    ("风险点：核心成员请假", "核心成员请假"),
]


@pytest.mark.parametrize("line, expected_value", _LABELLED)
def test_chinese_label_line_reaches_blockers(line, expected_value):
    p = _project(f"状态：进行中\n{line}\n")
    assert p.blockers == [expected_value], (
        f"{line!r} should have landed in blockers verbatim (label stripped); got {p.blockers!r}")


def test_english_blocker_scan_is_unaffected():
    """ASCII arm behaviour must not move: this is additive, not a replacement."""
    p = _project("Status: on-track\nBlocked: waiting on legal review\n")
    assert p.blockers == ["Blocked: waiting on legal review"]


def test_full_width_and_half_width_colon_both_work():
    p1 = _project("状态：进行中\n阻碍项：等待法务确认\n")
    p2 = _project("状态:进行中\n阻碍项:等待法务确认\n")
    assert p1.blockers == ["等待法务确认"]
    assert p2.blockers == ["等待法务确认"]


# =============================================================================================
# 2. defect-4 交互核验 —— 加了这条新门之后，defect 4 的反例绝不能被这扇新门重新点燃
# =============================================================================================

_DEFECT_4_NEGATIVES = ["无重大风险", "无明显风险", "没有风险", "风险与缓解"]


@pytest.mark.parametrize("line", _DEFECT_4_NEGATIVES)
def test_defect4_negatives_do_not_leak_into_blockers_via_the_new_label_regex(line):
    """The whole reason the vocabulary stops at `风险点` instead of bare `风险`: none of these four
    lines may become a blocker line through this new door. If this test goes red, the label regex
    was widened past `风险点` and defect 4 (无重大风险 misread as at-risk) has reopened elsewhere."""
    p = _project(f"状态：进行中\n{line}\n")
    assert p.blockers == [], f"{line!r} must NOT be captured as a blocker; got {p.blockers!r}"
    # and the status ladder itself (defect 1/4's fix) must still read this correctly on its own
    # axis — this file is not the one that re-verifies that, test_zh_status_negation.py is, but a
    # smoke check here catches a regression that would show up as a second symptom of the same bug.
    assert p.status == "on-track", f"{line!r} must not flip status away from on-track either"


def test_bare_risk_label_is_a_known_deliberate_gap():
    """`风险：人手不足` (no 点) is NOT captured — this is intentional, matches main, and is reported
    as a known limitation rather than silently patched. This test pins the gap so nobody closes it
    by accident without re-reading the defect-4 interaction above first."""
    p = _project("状态：进行中\n风险：人手不足\n")
    assert p.blockers == [], (
        "如果这条测试变红：说明有人把裸「风险」标签加回了词表——先看 test_defect4_negatives_"
        "do_not_leak_into_blockers_via_the_new_label_regex 会不会一起变红，那才是真正要担心的事。")


# =============================================================================================
# 3. 端到端：决策等级真的变了，不是只有 blockers 列表变了
# =============================================================================================

def test_end_to_end_grade_flips_from_can_proceed_to_needs_confirmation():
    """The review's headline scenario. Before this fix, `blockers=[]` and status='on-track' grades
    the calm "nothing outstanding" grade. After, the same document's blocker line is captured and
    the grade moves to the "needs a look" tier — the promise this fix makes is that the GRADE
    changes, not just that a string appears somewhere in a list nobody reads.

    🔴 Rule ids are deliberately NOT asserted here as literal strings (only decision_rules.py /
    decision_grading.py / decision_grading_rules.md / test_decision_grading.py may spell them —
    see that file's test_no_rule_text_in_any_prompt). Grade + matched-rule COUNT is enough to prove
    the value without leaking rule text into a file that could end up near a prompt."""
    doc_text = "状态：进行中\n阻碍项：等待法务确认\n风险：人手不足\n"
    p = _project(doc_text)

    # BEFORE: reconstruct the pre-fix card by hand (status parsed the same way — only the Chinese
    # blocker label was unrecognised, so `blockers` would have stayed empty).
    card_before = {"id": p.id, "title": p.title, "status": p.status}
    decisions_before = grade_projects([card_before], [])
    assert decisions_before[0].grade == "can_proceed"
    assert len(decisions_before[0].matched_rules) == 1  # the calm, no-evidence-of-risk rule only

    # AFTER: the actual card this fix produces.
    card_after = {"id": p.id, "title": p.title, "status": p.status, "blockers": p.blockers}
    decisions_after = grade_projects([card_after], [])
    assert decisions_after[0].grade == "needs_confirmation"
    # at least two independent rules now fire: one on the bare blocker count, one on the blocker
    # TEXT hitting the "watch" keyword family (「等待法务确认」 contains 「等待」) — two different
    # bases (`basis` in decision_rules.Rule), not one rule counted twice.
    assert len(decisions_after[0].matched_rules) >= 2
    bases = {r.basis for r in decisions_after[0].matched_rules}
    assert "blockers" in bases
    assert any("signals" in b for b in bases)


# =============================================================================================
# 已知未修 —— 如实报告，不假装治好
# =============================================================================================
#
# 1. 裸「风险：人手不足」（没有"点"字）仍然读不到任何字段。main 自己的正则也是 `风险点`，不是
#    `风险`，所以这不是本次子集独有的缺口——照抄 main 也治不好 review 举的这句例子。见上面
#    `test_bare_risk_label_is_a_known_deliberate_gap`。
#
# 2. "positive 状态一命中，全文风险兜底扫描永不运行" 这条控制流，本文件不修，因为：
#    (a) main 的 `_project_from_span` 里同一处逻辑是 `if not status: status = _norm_status(...,
#        risk_only=True)` —— 和这份子集现在的 `_projects_from_doc` 一模一样，main 自己也没有
#        改这个闸门，没有可移植的修复存在；
#    (b) 这条闸门只影响"风险信息只出现在自由行文里、不是任何标签行"的情况——上面
#        `test_end_to_end_grade_flips_from_can_proceed_to_needs_confirmation` 证明了 review 举的
#        主场景（阻碍项/风险点是标签行）完全不经过这个闸门就已经被上面的正则修好了，两者是
#        正交的：标签行扫描每一行都跑，不受 status 是否已经赋值影响。
#    独立"修"这个闸门（让 risk_only 全文扫描即使 status 已经从标签行读到也照跑）会是一个
#    main 都没做过的新产品行为改动，不在这次最小子集范围内。
