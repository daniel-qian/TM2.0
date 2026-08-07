# -*- coding: utf-8 -*-
"""feat-056 · 决策定级的门。

验收（kickoff-dev.md §feat-056 / PRD G5）逐条对应：
  1. 同一份文件连跑两次等级完全一致  → test_same_input_same_output_twice / test_no_clock_leak
  2. 每条决策能展开看到命中了哪条规则 → test_every_decision_names_its_rules
  3. Avery 上调有测试覆盖             → test_avery_can_escalate_with_reason 等
  4. 下调被硬拦                        → test_avery_downgrade_is_blocked 等
  5. 口径落成可读文档、不埋 prompt     → test_rules_doc_in_sync / test_no_rule_text_in_any_prompt
  6. 🔴 缺 dueDate/progress 不许默认低危 → test_missing_due_and_progress_never_downgrades 等
"""
from __future__ import annotations

import json
import re
from datetime import date, timedelta
from pathlib import Path
from types import SimpleNamespace

import pytest

from avery import decision_rules as R
from avery.decision_grading import (
    AveryReview,
    apply_review,
    build_doc_timeline,
    grade_project,
    grade_projects,
    parse_due_date,
)

TODAY = date(2026, 7, 18)
RULES_DOC = Path(__file__).resolve().parents[1] / "decision_grading_rules.md"


# --- 语料（形状对齐 CompanyContext.project_cards() / signal_cards()）---------------------------

def proj(**kw) -> dict:
    base = {"id": "p1", "title": "别墅二期交付", "ownerName": "陈曦"}
    base.update(kw)
    return base


def sig(**kw) -> dict:
    base = {"id": "s1", "subjectType": "project", "subjectId": "p1", "summary": "", "tag": ""}
    base.update(kw)
    return base


# --- 1. 确定性 --------------------------------------------------------------------------------

PROJECTS = [
    proj(id="p_villa", title="别墅二期交付", status="on-track", progress=35,
         dueDate="2026年7月22日",
         blockers=["等待集团法务对合同模板签字", "精装分包商未确认进场时间"]),
    proj(id="p_pool", title="泳池翻新", ownerName="王磊", status="at-risk"),
    proj(id="p_brand", title="品牌升级", ownerName="李娜"),
    proj(id="p_crm", title="CRM 上线", ownerName="赵敏", status="on-track", progress=90,
         dueDate="2026-09-30"),
    proj(id="p_done", title="前台系统迁移", ownerName="孙杨", status="done", progress=100),
]
SIGNALS = [
    sig(id="s_pool", subjectId="p_pool", summary="两位业主投诉泳池施工噪音，已要求退订下半年会籍"),
    sig(id="s_owner", subjectType="person", subjectId="陈曦", summary="陈曦提出离职意向，交接尚未安排"),
]


def test_same_input_same_output_twice():
    """🔴 验收第一条：同一份文件连跑两次，等级和命中规则逐字节一致。"""
    a = json.dumps([d.to_dict() for d in grade_projects(PROJECTS, SIGNALS, as_of=TODAY)],
                   ensure_ascii=False, sort_keys=True)
    b = json.dumps([d.to_dict() for d in grade_projects(PROJECTS, SIGNALS, as_of=TODAY)],
                   ensure_ascii=False, sort_keys=True)
    assert a == b


def test_no_clock_leak():
    """时间只从 as_of 进来。同一份 payload 换一个 as_of 之外的因素，结果不动——
    也就是说规则里没有偷读 datetime.now() 的地方。"""
    far = grade_projects(PROJECTS, SIGNALS, as_of=date(2026, 1, 1))
    same_far = grade_projects(PROJECTS, SIGNALS, as_of=date(2026, 1, 1))
    assert [d.grade for d in far] == [d.grade for d in same_far]
    # 到期日过了之后确实会升级（真实世界变了），但那是 as_of 的函数，不是随机性。
    late = {d.subject_id: d.grade for d in grade_projects(PROJECTS, SIGNALS,
                                                          as_of=date(2027, 1, 1))}
    assert late["p_crm"] == R.HIGH_RISK, "到期日已过应升到高风险（R-OVERDUE）"


def test_ordering_is_severity_then_title():
    """排序即前端 057 的展示顺序：严重度降序，同级稳定。"""
    got = grade_projects(PROJECTS, SIGNALS, as_of=TODAY)
    sevs = [d.severity for d in got]
    assert sevs == sorted(sevs, reverse=True)
    assert [d.subject_id for d in got] == [d.subject_id for d in
                                           grade_projects(list(reversed(PROJECTS)), SIGNALS,
                                                          as_of=TODAY)], \
        "输入顺序不应影响输出顺序"


# --- 2. 可展开：每条决策都说得出命中了哪条规则 -----------------------------------------------

def test_every_decision_names_its_rules():
    """🔴 验收第二条：每条决策都能展开看到命中了哪条规则——matched_rules 永不为空，
    且每条都是规则表里真实存在的编号，带原文证据。"""
    from avery.decision_grading import _EVIDENCE_FREE_RULES
    for d in grade_projects(PROJECTS, SIGNALS, as_of=TODAY):
        assert d.matched_rules, f"{d.subject_title} 没有任何命中规则"
        for hit in d.matched_rules:
            assert hit.rule_id in R.RULE_IDS, f"未知规则号 {hit.rule_id}"
            # ADR-0033：两条规则的证据面**按定义为空**（一条是"四个字段一个都没读到"，
            # 一条是"跑完整张表都没命中"——都没有任何原文可引）。此前它们发的是后端编的
            # 一句中文冒充原文，正好印在写着"下面是文档原文"的那一节里。现在发空。
            if hit.rule_id in _EVIDENCE_FREE_RULES:
                assert hit.evidence == (), f"{hit.rule_id} 的证据面按定义应为空"
            else:
                assert hit.evidence, f"{hit.rule_id} 命中却没给证据"
            assert hit.title and hit.basis   # 仍喂 decision_grading_rules.md，只是不进载荷了
        # 最终等级必须真的由某条命中规则支撑（不是凭空来的）
        assert any(h.grade == d.rule_grade for h in d.matched_rules)


def test_top_grade_is_max_severity_of_hits():
    d = grade_project(PROJECTS[0], SIGNALS, as_of=TODAY)
    assert d.rule_grade == R.HIGH_RISK
    assert max(R.SEVERITY[h.grade] for h in d.matched_rules) == R.SEVERITY[R.HIGH_RISK]


def test_evidence_is_verbatim_from_source():
    """证据必须是原文，不能是转述——否则"可溯源"是空话。"""
    d = grade_project(PROJECTS[1], SIGNALS, as_of=TODAY)
    hit = next(h for h in d.matched_rules if h.rule_id == "R-SIGNAL-COMPLAINT")
    assert SIGNALS[0]["summary"] in hit.evidence


# --- 3. 🔴 缺数据绝不降级 ---------------------------------------------------------------------

def test_missing_due_and_progress_never_downgrades():
    """🔴 覆盖率现实：dueDate 7/17、progress 6/17。把这两个字段拿掉，等级绝不能变低。"""
    rich = proj(status="at-risk", progress=20, dueDate="2026-07-20",
                blockers=["等待甲方确认图纸"])
    stripped = {k: v for k, v in rich.items() if k not in ("progress", "dueDate")}
    assert (R.SEVERITY[grade_project(stripped, [], as_of=TODAY).rule_grade]
            >= R.SEVERITY[R.NEEDS_CONFIRMATION])
    assert grade_project(stripped, [], as_of=TODAY).rule_grade != R.CAN_PROCEED


def test_empty_project_is_needs_confirmation_not_can_proceed():
    """🔴 最容易搞错的一条：什么都没写 → 需确认，**不是**可推进。
    "文档没说"不等于"没风险"。"""
    d = grade_project(proj(id="p_bare", title="某个项目"), [], as_of=TODAY)
    assert d.rule_grade == R.NEEDS_CONFIRMATION
    assert any(h.rule_id == "R-NO-EVIDENCE" for h in d.matched_rules)


def test_can_proceed_requires_a_positive_statement():
    """可推进只能由**明确的正面自述**换来（on-track/steady/done），不能靠字段全空混过去。"""
    for card in (proj(status="on-track"), proj(status="steady"), proj(status="done")):
        assert grade_project(card, [], as_of=TODAY).rule_grade == R.CAN_PROCEED
    # 状态是抽取层没归一的词 → 落到兜底，给需确认而不是可推进
    weird = grade_project(proj(status="进行中ish"), [], as_of=TODAY)
    assert weird.rule_grade != R.CAN_PROCEED


def test_unparseable_due_date_is_unknown_not_far_away():
    """"月底前"这种定不到某一天的到期日绝不当作"还早"——但它属"读不准"，不是"文档没写"。"""
    d = grade_project(proj(status="on-track", dueDate="月底前"), [], as_of=TODAY)
    assert not any(h.rule_id in ("R-DUE-SOON", "R-OVERDUE") for h in d.matched_rules)
    assert d.unparsed_fields == (("dueDate", "月底前"),)
    assert "dueDate" not in d.unknown_fields


def test_unknown_fields_are_reported_for_the_frontend():
    """057 靠 unknown_fields 显示「文档未提及」，绝不能渲染成 0%。"""
    d = grade_project(proj(id="p_x", title="无字段项目"), [], as_of=TODAY)
    assert set(d.unknown_fields) == {"status", "progress", "dueDate"}
    d2 = grade_project(proj(status="on-track", progress=50, dueDate="2026-12-01"), [], as_of=TODAY)
    assert d2.unknown_fields == ()
    assert d2.unparsed_fields == ()


def test_reason_flags_the_unknowns():
    """ADR-0033 后这条测的是**结构**，不是句子。

    以前断言的是那句 `（未读到：进度、到期日——未知不等于没风险。）`。后端不再拼这句话了：
    它现在由前端 i18n 模板从 `unknown_fields` 渲染。所以这里守的是"那些字段确实被标成了未读到"
    ——句子那一半由 `test_decision_i18n_contract.py` 接着守（模板必须在 zh/en 两边都在，
    且措辞不许替客户断言）。🔴 两半缺一，这条链就有一段没人看着。
    """
    d = grade_project(proj(id="p_y", title="半空项目", status="on-track"), [], as_of=TODAY)
    assert set(d.unknown_fields) == {"progress", "dueDate"}
    assert d.reason == "" and d.reason_source == "rule", "规则版不许再产出人话"


# --- 3b. 🔴 绝不对客户自己的文档作失实陈述（复核 finding 1 / 2 的回归门）----------------------
# 这两条是本线唯一会**原样打到经理屏幕上**的文字。判错一档还能靠展开的证据自证；
# 当着客户的面否认他自己写过的字，这份说明书的说服力当场归零。

def test_a_written_but_unreadable_due_date_is_never_called_missing():
    """🔴 dueDate="8月15日" 写在周报上。系统可以说"我读不准"，绝不许说"文档未提及"。"""
    d = grade_project(proj(status="on-track", dueDate="8月底前"), [], as_of=TODAY)
    assert "dueDate" not in d.unknown_fields, "文档白纸黑字写了到期日，不许说没写"
    payload = d.to_dict()
    # ADR-0033：只发机器键 + **文档原文**。`field_label`（「到期日」）搬去了前端 i18n；
    # `raw` 留在这里而且永远原样——经理拿原件一对就知道系统读的是同一份文件，
    # 这一句是整份说明书的可信度支点，翻译它就等于编（决定 4 ← ADR-0018）。
    assert payload["unparsed_fields"] == [{"field": "dueDate", "raw": "8月底前"}]


def test_missing_and_unreadable_are_two_different_fields():
    """"文档没写"与"我读不准"必须分开——两者在 to_dict 里落到互斥的两个键。"""
    written = grade_project(proj(status="on-track", dueDate="第三季度末"), [], as_of=TODAY)
    absent = grade_project(proj(status="on-track"), [], as_of=TODAY)
    assert [f["field"] for f in written.to_dict()["unparsed_fields"]] == ["dueDate"]
    assert "dueDate" not in written.to_dict()["unknown_fields"]
    assert absent.to_dict()["unparsed_fields"] == []
    assert "dueDate" in absent.to_dict()["unknown_fields"]
    # 🔴 定级方向上两者一视同仁：都不许因此触发"还早"，也都不许降级
    for d in (written, absent):
        assert not any(h.rule_id in ("R-DUE-SOON", "R-OVERDUE") for h in d.matched_rules)


def test_year_omitted_chinese_due_dates_are_read():
    """中文周报写到期日几乎不写年份。年份由 as_of 推断，规则确定、可当场核对。"""
    # TODAY = 2026-07-18；"8月15日" → 今年的 8/15，28 天后 → 不算迫近但读得出来
    d = grade_project(proj(status="on-track", dueDate="8月15日"), [], as_of=TODAY)
    assert d.unparsed_fields == () and "dueDate" not in d.unknown_fields
    # 迫近的（7 天内）真能触发 R-DUE-SOON —— 中文侧不再对时间类规则全盲
    soon = grade_project(proj(status="on-track", dueDate="7月20日前"), [], as_of=TODAY)
    assert any(h.rule_id == "R-DUE-SOON" for h in soon.matched_rules)
    # 已过的 → 高风险
    late = grade_project(proj(status="on-track", dueDate="6月30号"), [], as_of=TODAY)
    assert any(h.rule_id == "R-OVERDUE" for h in late.matched_rules)
    # 落在过去太远 → 说的是明年的同一天，不谎称已逾期
    from avery.decision_grading import parse_due_date
    assert parse_due_date("1月10日", as_of=TODAY) == date(2027, 1, 10)
    # 🔴 不传 as_of 就认不出年份，绝不在函数内部偷偷读时钟
    assert parse_due_date("8月15日") is None


def test_chinese_status_is_understood_end_to_end():
    """🔴 中文文档必须能走到三档，不许塌成两档；也不许对写了状态的文档说"没读到状态"。"""
    from avery.ingest.extract import _norm_status
    assert _norm_status("进行中") == "on-track"
    assert _norm_status("正常推进") == "on-track"
    assert _norm_status("已完成") == "done"
    assert _norm_status("有风险") == "at-risk"
    assert _norm_status("已阻塞") == "blocked"
    # 否定式不许翻成正面：这两个一旦误判就是把有问题的项目说成没问题
    assert _norm_status("未完成") != "done"
    assert _norm_status("无风险") != "at-risk"
    # 三档在中文侧真的都够得着
    got = {grade_project(proj(status=_norm_status(zh)), [], as_of=TODAY).rule_grade
           for zh in ("进行中", "有风险", "已阻塞")}
    assert got == {R.CAN_PROCEED, R.NEEDS_CONFIRMATION, R.HIGH_RISK}
    # 状态读出来了，理由里就不许再说没读到状态
    d = grade_project(proj(status=_norm_status("进行中")), [], as_of=TODAY)
    assert "状态" not in d.reason.split("未读到")[-1].split("——")[0]


# --- 4. 规则逐条 ------------------------------------------------------------------------------

def test_status_rules():
    assert grade_project(proj(status="blocked"), [], as_of=TODAY).rule_grade == R.HIGH_RISK
    assert grade_project(proj(status="at-risk"), [], as_of=TODAY).rule_grade == \
        R.NEEDS_CONFIRMATION


def test_blocker_count_rules():
    one = grade_project(proj(status="at-risk", blockers=["等图纸"]), [], as_of=TODAY)
    assert any(h.rule_id == "R-BLOCKER-ONE" for h in one.matched_rules)
    two = grade_project(proj(status="at-risk", blockers=["等图纸", "等预算"]), [], as_of=TODAY)
    assert two.rule_grade == R.HIGH_RISK
    assert any(h.rule_id == "R-BLOCKER-STACK" for h in two.matched_rules)


def test_self_report_mismatch_matches_gap_derive_semantics():
    """自报正常却挂着阻塞——与前端 gapDerive.ts「多看一眼」同一个口径。"""
    d = grade_project(proj(status="on-track", blockers=["等待甲方签字"]), [], as_of=TODAY)
    assert any(h.rule_id == "R-SELF-REPORT-MISMATCH" for h in d.matched_rules)
    assert d.rule_grade != R.CAN_PROCEED


def test_due_date_rules():
    soon = grade_project(proj(status="on-track", dueDate="2026-07-22"), [], as_of=TODAY)
    assert any(h.rule_id == "R-DUE-SOON" for h in soon.matched_rules)
    over = grade_project(proj(status="on-track", dueDate="2026-07-01"), [], as_of=TODAY)
    assert over.rule_grade == R.HIGH_RISK
    crunch = grade_project(proj(status="on-track", dueDate="2026-07-25", progress=20), [],
                           as_of=TODAY)
    assert any(h.rule_id == "R-DUE-VS-PROGRESS" for h in crunch.matched_rules)


def test_done_project_is_not_dragged_by_dates():
    """已完成的项目不该因为到期日过了而报高风险。"""
    d = grade_project(proj(status="done", dueDate="2026-01-01", progress=100), [], as_of=TODAY)
    assert d.rule_grade == R.CAN_PROCEED


def test_done_project_still_escalates_on_a_complaint():
    """但交付完之后来的投诉是真事，照样高风险。"""
    d = grade_project(proj(id="p_d", title="宴会厅改造", status="done"),
                      [sig(subjectId="p_d", summary="客户投诉宴会厅隔音未达标，要求返工")],
                      as_of=TODAY)
    assert d.rule_grade == R.HIGH_RISK


@pytest.mark.parametrize("text,rule_id", [
    ("核心工程师提出离职，项目交接未定", "R-SIGNAL-ATTRITION"),
    ("business owner resigned last week", "R-SIGNAL-ATTRITION"),
    ("三组业主投诉交付延期", "R-SIGNAL-COMPLAINT"),
    ("client filed a formal complaint", "R-SIGNAL-COMPLAINT"),
    ("设计和施工两边一直在扯皮", "R-SIGNAL-CONFLICT"),
    ("ongoing friction between the two teams", "R-SIGNAL-CONFLICT"),
    ("工地因安全隐患停工三天", "R-SIGNAL-INCIDENT"),
    ("site shutdown after a safety incident", "R-SIGNAL-INCIDENT"),
])
def test_high_risk_keyword_families(text, rule_id):
    d = grade_project(proj(id="p_k", title="某工程", status="on-track"),
                      [sig(subjectId="p_k", summary=text)], as_of=TODAY)
    assert d.rule_grade == R.HIGH_RISK, f"{text} 应判高风险"
    assert any(h.rule_id == rule_id for h in d.matched_rules)


@pytest.mark.parametrize("text", ["交付时间可能延期两周", "waiting on the vendor to confirm"])
def test_watch_keywords_are_needs_confirmation(text):
    d = grade_project(proj(id="p_w", title="某工程", status="on-track"),
                      [sig(subjectId="p_w", summary=text)], as_of=TODAY)
    assert d.rule_grade == R.NEEDS_CONFIRMATION


def test_owner_person_signal_reaches_the_project():
    """负责人的处境是项目的证据（person 型信号按 ownerName 挂上来）。
    🔴 但输出仍然只讲项目和原文——不给人打分、不加形容。"""
    d = grade_project(PROJECTS[0], SIGNALS, as_of=TODAY)
    hit = next(h for h in d.matched_rules if h.rule_id == "R-SIGNAL-ATTRITION")
    assert hit.evidence == ("陈曦提出离职意向，交接尚未安排",), "证据必须是信号原文，不得转述"
    assert d.subject_type == "project"


def test_unattributed_signal_does_not_taint_every_project():
    """已知盲区（写在 decision_grading_rules.md 里）：没指名、正文也没提项目标题的信号，
    不算到任何项目头上——规则宁可漏，也不给全体项目无差别加码。"""
    orphan = [sig(subjectId="the project", summary="有人投诉了")]
    for card in PROJECTS:
        d = grade_project(card, orphan, as_of=TODAY)
        assert not any(h.rule_id == "R-SIGNAL-COMPLAINT" for h in d.matched_rules)


# --- 5. Avery 复核：只许上调 -------------------------------------------------------------------

def test_avery_can_rewrite_the_reason_without_touching_the_grade():
    base = grade_project(PROJECTS[3], SIGNALS, as_of=TODAY)
    out = apply_review(base, AveryReview(reason="进度九成、时间还宽裕，按原计划走就行。"))
    assert out.grade == base.rule_grade
    assert out.reason_source == "avery"
    assert out.reason.startswith("进度九成")


def test_avery_can_escalate_with_reason():
    """🔴 验收第三条：Avery 上调（补规则盲区）——必须写明为什么。"""
    base = grade_project(proj(id="p_e", title="融资材料", status="on-track"), [], as_of=TODAY)
    assert base.rule_grade == R.CAN_PROCEED
    out = apply_review(base, AveryReview(
        reason="这份材料的交付日文档里没写，但它卡着下一轮的时间表。",
        grade=R.HIGH_RISK,
        escalation_reason="文档未写 dueDate，正文两处都提到本月内要交割——规则看不到，人能看到。"))
    assert out.grade == R.HIGH_RISK
    assert out.escalated is True
    assert out.escalation_reason
    assert out.rule_grade == R.CAN_PROCEED, "规则原判必须保留，可对账"


def test_escalation_without_a_reason_is_refused():
    """"必须写明为什么"——没写就不给调。"""
    base = grade_project(proj(id="p_e2", title="融资材料", status="on-track"), [], as_of=TODAY)
    out = apply_review(base, AveryReview(reason="感觉不太妙", grade=R.HIGH_RISK))
    assert out.grade == R.CAN_PROCEED
    assert out.escalated is False
    assert out.review_rejected == "missing_reason"


def test_avery_downgrade_is_blocked():
    """🔴 验收第四条：下调被硬拦。漏报比误报贵。"""
    base = grade_project(PROJECTS[0], SIGNALS, as_of=TODAY)
    assert base.rule_grade == R.HIGH_RISK
    out = apply_review(base, AveryReview(
        reason="其实问题不大，可以推进。", grade=R.CAN_PROCEED,
        escalation_reason="就算写了理由也不许下调"))
    assert out.grade == R.HIGH_RISK, "下调必须无效"
    assert out.downgrade_blocked is True
    assert out.rejected_grade == R.CAN_PROCEED
    assert out.review_rejected == "downgrade"


def test_blocked_downgrade_also_discards_its_wording():
    """被拦的下调，那句理由一并丢弃——否则「高风险」会配上一句「问题不大」，自相矛盾。"""
    base = grade_project(PROJECTS[0], SIGNALS, as_of=TODAY)
    out = apply_review(base, AveryReview(reason="其实问题不大。", grade=R.CAN_PROCEED))
    assert out.reason_source == "rule"
    assert "问题不大" not in out.reason


@pytest.mark.parametrize("frm,to", [
    (R.HIGH_RISK, R.NEEDS_CONFIRMATION),
    (R.HIGH_RISK, R.CAN_PROCEED),
    (R.NEEDS_CONFIRMATION, R.CAN_PROCEED),
])
def test_every_downgrade_direction_is_blocked(frm, to):
    cards = {R.HIGH_RISK: proj(id="a", status="blocked"),
             R.NEEDS_CONFIRMATION: proj(id="b", status="at-risk")}
    base = grade_project(cards[frm], [], as_of=TODAY)
    assert base.rule_grade == frm
    out = apply_review(base, AveryReview(reason="r", grade=to, escalation_reason="why"))
    assert out.grade == frm and out.downgrade_blocked is True


def test_a_second_review_cannot_walk_an_escalation_back_down():
    """🔴 复核两次不是下调的后门。

    以前基线只取 `rule_grade`：一条 可推进 被合法上调到 高风险 之后，第二次复核提 需确认
    仍然算"相对规则原判的上调"，于是被采纳——等级实质从高风险掉回需确认，而且
    `downgrade_blocked` 还是 False，一点痕迹都不留。基线改成 max(规则原判, 当前等级) 后堵死。
    """
    base = grade_project(proj(id="p_up", status="on-track"), [], as_of=TODAY)
    assert base.rule_grade == R.CAN_PROCEED
    up = apply_review(base, AveryReview(grade=R.HIGH_RISK, escalation_reason="工地停工，规则没覆盖"))
    assert up.grade == R.HIGH_RISK and up.escalated is True
    back = apply_review(up, AveryReview(grade=R.NEEDS_CONFIRMATION, escalation_reason="想想还好"))
    assert back.grade == R.HIGH_RISK, "已上调的等级被第二次复核降回去了 —— 下调红线被绕过"
    assert back.downgrade_blocked is True and back.rejected_grade == R.NEEDS_CONFIRMATION


def test_unknown_grade_from_the_model_is_refused():
    """模型返回词表外的等级 → 整个复核作废，不给它任何改判效果。"""
    base = grade_project(PROJECTS[1], SIGNALS, as_of=TODAY)
    out = apply_review(base, AveryReview(reason="x", grade="catastrophic"))
    assert out.grade == base.rule_grade
    assert out.review_rejected == "unknown_grade"
    assert out.reason_source == "rule"


def test_review_none_is_a_noop():
    base = grade_project(PROJECTS[0], SIGNALS, as_of=TODAY)
    assert apply_review(base, None) == base


# --- 6. 口径落地：配置 / 文档 / 不埋 prompt ----------------------------------------------------

def test_rules_doc_in_sync():
    """🔴 口径必须落成一份可读文档。三家公司会问"凭什么说这条高风险"——
    要能当场把表给他看，而且那份表得跟代码一致。"""
    doc = RULES_DOC.read_text(encoding="utf-8")
    for rule_id in R.RULE_IDS:
        assert rule_id in doc, f"{rule_id} 没写进 decision_grading_rules.md（口径必须公开）"
    for grade in R.GRADES:
        assert grade in doc and R.LABEL_ZH[grade] in doc
    for family in R.KEYWORD_FAMILIES:
        assert family in doc, f"关键词族 {family} 没写进说明文档"
    for const in ("DUE_SOON_DAYS", "DUE_CRUNCH_DAYS", "PROGRESS_CRUNCH_PCT",
                  "PROGRESS_LOW_PCT", "BLOCKER_STACK_N", "DUE_YEAR_LOOKBACK_DAYS",
                  "STALE_EVIDENCE_DAYS", "FORM_DUE_SOON_HOURS"):
        assert const in doc, f"阈值 {const} 没写进说明文档"
        assert str(getattr(R, const)) in doc, f"{const} 的值在文档里对不上"


def test_no_rule_asserts_what_the_customers_document_does_not_contain():
    """🔴 用户面文字只许陈述"我读到/没读到什么"，不许替客户断言"你的文档里没写什么"。

    抽取层读不出来的原因很多（中文标签、非常规排版、我们还没支持的写法）。把这些一律说成
    "文档没写"，就是当着客户的面否认他自己写过的字——而他手上就有原件，一翻就露馅。
    """
    forbidden = ("文档没写", "文档未写", "文档里没有", "没有提到")
    for r in R.RULES:
        for bad in forbidden:
            assert bad not in r.title_zh, f"{r.id} 的措辞替客户断言了文档内容：{r.title_zh}"
    # 🔴 这条测试以前还有第二半：拿一张什么都没有的卡（最容易说过头的情形）跑一遍**兜底理由**，
    # 断言那句话也不越线。ADR-0033 之后兜底理由不在后端了（`reason` 恒为空串），
    # 那一半如果原样留着就变成了对空串断言——**恒真**，一条永远绿的假门。
    # 已经搬到 `test_decision_i18n_contract.py::test_frontend_rule_copy_never_asserts_absence`，
    # 对**前端 i18n 表里那几十条真文案**跑同一张禁词表。这里只留一条防回归的哨兵：
    bare = grade_project(proj(id="p_bare2", title="空卡"), [], as_of=TODAY)
    assert bare.reason == "", (
        "后端又开始产出兜底理由了。要么是有人撤销了 ADR-0033，要么是加回来的时候没人注意到"
        "——无论哪种，上面那半张禁词表得跟着搬回来，别让这句话没人看着就上屏。")


def test_every_rule_has_exactly_one_matcher():
    """规则表与匹配器双向对齐——不许有写在表里却没实现的规则（客户看得到、系统不认），
    也不许有实现了却没登记的暗规则（判了级但说不出依据）。"""
    from avery.decision_grading import _DATED_MATCHERS, _MATCHERS
    implemented = set(_MATCHERS) | set(_DATED_MATCHERS)
    assert implemented == set(R.RULE_IDS)
    assert not (set(_MATCHERS) & set(_DATED_MATCHERS))


def test_no_rule_text_in_any_prompt():
    """🔴 "不许埋进 prompt"：口径只许住在 decision_rules.py / decision_grading.py /
    decision_grading_rules.md 里。全仓扫一遍，规则号不得出现在别处的 prompt 文本中。"""
    root = Path(__file__).resolve().parents[1]
    allowed = {root / "avery" / "decision_rules.py",
               root / "avery" / "decision_grading.py",
               root / "decision_grading_rules.md",
               Path(__file__).resolve()}
    offenders = []
    for path in list(root.rglob("*.py")) + list(root.rglob("*.md")):
        if path.resolve() in allowed or "__pycache__" in path.parts:
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue
        for rule_id in R.RULE_IDS:
            if rule_id in text:
                offenders.append(f"{path}: {rule_id}")
    assert not offenders, "定级口径泄漏到了别的文件（prompt？）：" + "; ".join(offenders)


def test_grade_vocabulary_is_locked():
    """三档就是三档。多一档少一档都会让 057 的排序和说明书对不上。"""
    assert R.GRADES == (R.HIGH_RISK, R.NEEDS_CONFIRMATION, R.CAN_PROCEED)
    assert [R.LABEL_ZH[g] for g in R.GRADES] == ["高风险", "需确认", "可推进"]
    assert [R.SEVERITY[g] for g in R.GRADES] == [3, 2, 1]


# --- 7. 到期日解析 ----------------------------------------------------------------------------

@pytest.mark.parametrize("text,expected", [
    ("2026-08-15", date(2026, 8, 15)),
    ("2026/8/15", date(2026, 8, 15)),
    ("2026年8月15日", date(2026, 8, 15)),
    ("2026-08-15T09:00:00Z", date(2026, 8, 15)),
    ("Aug 15, 2026", date(2026, 8, 15)),
    ("15 August 2026", date(2026, 8, 15)),
    ("2026年8月", date(2026, 8, 1)),          # 只到月 → 取最早可能日（偏保守）
    ("15/08/2026", date(2026, 8, 15)),        # 日 > 12，唯一解
    ("08/15/2026", date(2026, 8, 15)),        # 月/日，唯一解
])
def test_parse_due_date_formats(text, expected):
    assert parse_due_date(text) == expected


@pytest.mark.parametrize("text", ["", "月底前", "TBD", "next quarter", "05/08/2026", "2026-13-45"])
def test_parse_due_date_unknown(text):
    """认不出来一律 None = 未知。🔴 未知绝不等于"还早"。"""
    assert parse_due_date(text) is None


# --- 8. 红线：定级产物不得给人打分 --------------------------------------------------------------

def test_composed_reasons_pass_the_red_line():
    """定级产出的**用户面文字**要能过红线校验器——定级不许变成给人贴标签的后门。

    ADR-0033 把那句话搬到了前端，所以这里改成对**规则标题**（`decision_grading_rules.md` 的
    同一份原文，也是前端 zh 文案的出处）跑红线。对 `d.reason` 跑就是对空串跑——恒绿。
    前端那几十条真文案由 `test_decision_i18n_contract.py::test_frontend_rule_copy_passes_the_red_line`
    过同一把尺。
    """
    from avery import redline
    for r in R.RULES:
        res = redline.validate(r.title_zh, cited_snippets=[])
        assert res.passed, f"规则标题触了红线：{r.id} / {r.title_zh} / {res}"


def test_decision_dict_has_no_person_score_keys():
    """输出结构里不许出现任何人身评分字段（结构性护栏，和人卡同一条红线）。"""
    banned = ("moodPct", "capacityPct", "score", "rating", "rank", "tier", "percentile")
    for d in grade_projects(PROJECTS, SIGNALS, as_of=TODAY):
        blob = json.dumps(d.to_dict(), ensure_ascii=False)
        for key in banned:
            assert f'"{key}"' not in blob


# --- 9. 与 payload 的接缝（057 照着接的就是这个）-----------------------------------------------

def test_payload_shape_for_feat_057():
    """输出契约：字段齐、类型对。057 前端按这个形状接。

    🔴 ADR-0033 一刀切改形（2026-08-03）：`grade_label` / `rule_grade_label` /
    命中里的 `title`+`basis` / `unparsed_fields[].field_label` **全部删掉**，不做新旧并存。
    并存会留下"后端仍在产出中文"的破口，而那正是那一票要铲掉的东西。
    """
    d = grade_project(PROJECTS[0], SIGNALS, as_of=TODAY).to_dict()
    assert set(d) == {
        "subject_type", "subject_id", "subject_title", "owner_name",
        "grade", "severity", "rule_grade", "rule_severity",
        "matched_rules", "unknown_fields", "unparsed_fields", "reason", "reason_source",
        "escalated", "escalation_reason", "downgrade_blocked", "rejected_grade",
        "review_rejected",
    }
    assert isinstance(d["unparsed_fields"], list)
    assert d["grade"] in R.GRADES
    hit = d["matched_rules"][0]
    assert set(hit) == {"rule_id", "grade", "severity", "params", "evidence"}
    assert isinstance(hit["evidence"], list) and isinstance(hit["params"], dict)
    json.dumps(d, ensure_ascii=False)  # 必须可 JSON 序列化（要过 HTTP）


def test_no_backend_prose_anywhere_in_the_payload():
    """🔴 ADR-0033 的结构性护栏：载荷里除了**文档原文**，不许再有一个中文句子。

    这条门是给"下一个人"写的：往 `to_dict()` 里加回一个 `grade_label`、给某条规则塞一句
    中文说明、给 evidence 补一句中文注解——每一种都会让英文用户重新看到中英夹杂的判读面板，
    而且都不会有别的东西变红。

    允许出现 CJK 的只有三处，各有各的理由：
      · `subject_title` / `owner_name` —— 客户文档里的名字，本来就该原样；
      · `unparsed_fields[].raw` —— 文档原文，翻译＝编（决定 4）；
      · `matched_rules[].evidence` —— 同上，逐字引用。
    其余任何一个值出现 CJK 都判红。
    """
    verbatim_keys = {"subject_title", "owner_name"}
    cjk = re.compile(r"[一-鿿　-〿＀-￯]")
    offenders: list[str] = []
    for d in grade_projects(PROJECTS, SIGNALS, as_of=TODAY):
        payload = d.to_dict()
        for key, value in payload.items():
            if key in verbatim_keys:
                continue
            if key == "unparsed_fields":
                for item in value:                       # 只放行 raw
                    if cjk.search(str(item["field"])):
                        offenders.append(f"unparsed_fields.field={item['field']!r}")
                continue
            if key == "matched_rules":
                for hit in value:                        # 只放行 evidence
                    for k, v in hit.items():
                        if k == "evidence":
                            continue
                        if cjk.search(json.dumps(v, ensure_ascii=False)):
                            offenders.append(f"matched_rules.{k}={v!r}")
                continue
            if cjk.search(json.dumps(value, ensure_ascii=False)):
                offenders.append(f"{key}={value!r}")
    assert not offenders, (
        "载荷里出现了后端产出的中文（ADR-0033 明令不许）：" + " · ".join(offenders))


# --- 10. 资料时间轴（gap-design-0805 · B1）-----------------------------------------------------
#
# 判据函数是纯离线的：构造几个"上传过的文件"就能跑，零模型调用、零网络、零真库。
# 🔴 语料一律用**中文文件名**——本仓栽过"门语料全 ASCII，中文字节从没真进过判据"的跟头。

def doc(source_key: str, uploaded_at: str, filename: str = "") -> SimpleNamespace:
    """一份上传过的资料。鸭子类型对齐 `registry.SourceDocument` 的三个属性（定级层不认识那个类）。"""
    return SimpleNamespace(source_key=source_key, filename=filename or source_key,
                           uploaded_at=uploaded_at)


# TODAY = 2026-07-18；阈值 45 天 → 分界线正好是 2026-06-03。
STALE_DAY = (TODAY - timedelta(days=R.STALE_EVIDENCE_DAYS)).isoformat()      # 恰好踩线
FRESH_DAY = (TODAY - timedelta(days=R.STALE_EVIDENCE_DAYS - 1)).isoformat()  # 差一天没到


def _stale_timeline():
    return build_doc_timeline([doc("别墅二期-5月月报.md", f"{STALE_DAY}T02:30:00+00:00")])


def _split_timeline():
    """两份资料：项目自己读自的那份很老，另一份昨天刚传（own_doc ≠ newest_doc）。

    🔴 这是 /ingest 的常态形状，也是本条规则那一刀（比**全库最新**那份、**不**比项目自己那份）
    唯一能被证伪的语料——单份语料下 own_doc 恒等于 newest_doc，任何门都分不出两种写法。
    """
    return build_doc_timeline([doc("别墅二期-3月月报.md", "2026-03-01T00:00:00+00:00"),
                               doc("七月总周报.md", f"{FRESH_DAY}T23:00:00+00:00")])


def test_a_fresh_upload_elsewhere_keeps_an_old_sourced_card_fresh():
    """🔴 判据是**全库最新**那份，绝不是项目自己那份。

    项目读自 3 月的月报，但昨天刚传过一份新周报 → 不命中。若按项目自己那份算，就会对客户说
    「资料 139 天没更新」，而他昨天刚传过——一句当场可证伪的假话。
    （`_m_stale_evidence` 那段红线注释就是为拦这个而写的；没有这条门，那段注释拦不住任何东西。）
    """
    d = grade_project(proj(id="p_t", status="on-track", sourceRef="别墅二期-3月月报.md:12"),
                      [], as_of=TODAY, timeline=_split_timeline())
    assert "R-STALE-EVIDENCE" not in [h.rule_id for h in d.matched_rules], d.matched_rules
    assert d.rule_grade == R.CAN_PROCEED


def test_stale_evidence_fires_only_past_the_threshold():
    """恰好到阈值那天命中，差一天不命中。🔴 边界要钉死：这是唯一一条要把服务端本地 date
    与带时区的 uploaded_at 对齐的规则，差一天就是屏幕上一句假话。"""
    card = proj(id="p_t", status="on-track", sourceRef="别墅二期-5月月报.md:12")  # 本来是「可推进」
    stale = grade_project(card, [], as_of=TODAY, timeline=_stale_timeline())
    fresh = grade_project(proj(id="p_t", status="on-track", sourceRef="别墅二期-6月周报.md:8"),
                          [], as_of=TODAY, timeline=build_doc_timeline(
        [doc("别墅二期-6月周报.md", f"{FRESH_DAY}T02:30:00+00:00")]))
    assert "R-STALE-EVIDENCE" in [h.rule_id for h in stale.matched_rules]
    assert "R-STALE-EVIDENCE" not in [h.rule_id for h in fresh.matched_rules]
    # 效果就是本票要的那一条：旧资料换来的「可推进」不再被展示成可推进。
    assert fresh.rule_grade == R.CAN_PROCEED
    assert stale.rule_grade == R.NEEDS_CONFIRMATION


def test_stale_evidence_never_drags_a_worse_card_down():
    """需确认级的命中只抬「可推进」，绝不动已经更严重的卡（等级取最严重的一档）。"""
    high = grade_project(proj(id="p_b", status="blocked", sourceRef="别墅二期-5月月报.md:3"),
                         [], as_of=TODAY, timeline=_stale_timeline())
    assert high.rule_grade == R.HIGH_RISK
    assert "R-STALE-EVIDENCE" in [h.rule_id for h in high.matched_rules]


def test_no_timeline_means_the_rule_simply_does_not_run():
    """不传时间轴 = 没有时间轴，这条规则一条都不命中（老调用方原样不受影响）。"""
    d = grade_project(proj(id="p_t", status="on-track", sourceRef="别墅二期-5月月报.md:12"),
                      [], as_of=TODAY)
    assert "R-STALE-EVIDENCE" not in [h.rule_id for h in d.matched_rules]
    assert d.rule_grade == R.CAN_PROCEED


def test_a_hand_added_card_is_never_told_its_evidence_is_stale():
    """🔴 手加的卡（`source` 恒空 → 连 sourceRef 键都不发）**不读自任何资料**，
    凭什么说它"依据的资料 45 天没更新"、还摆一份跟它毫无关系的月报当证据。

    这是经理一分钟前手敲进去的项目；这句话对它结构上不成立。
    """
    d = grade_project(proj(id="p_new", title="今天新开的项目", status="on-track"),
                      [], as_of=TODAY, timeline=_stale_timeline())
    assert "R-STALE-EVIDENCE" not in [h.rule_id for h in d.matched_rules], d.matched_rules
    assert d.rule_grade == R.CAN_PROCEED
    # 出处指向一份我们手上没有的资料，同样不成立（"读自它"这件事我们核不了）。
    gone = grade_project(proj(id="p_g", status="on-track", sourceRef="早就删了的文件.md:3"),
                         [], as_of=TODAY, timeline=_stale_timeline())
    assert "R-STALE-EVIDENCE" not in [h.rule_id for h in gone.matched_rules]


def test_a_finished_project_is_not_dragged_by_stale_material_either():
    """自报已完成的项目不被时间拖累——与本文件另外三条时间规则同一豁免
    （`test_done_project_is_not_dragged_by_dates` 是那条口径的原门）。做完了就是做完了。"""
    d = grade_project(proj(id="p_d", status="done", progress=100,
                           sourceRef="别墅二期-5月月报.md:9"),
                      [], as_of=TODAY, timeline=_stale_timeline())
    assert "R-STALE-EVIDENCE" not in [h.rule_id for h in d.matched_rules], d.matched_rules
    assert d.rule_grade == R.CAN_PROCEED


def test_a_file_we_could_not_read_is_never_called_our_newest_material():
    """🔴 解析失败 / 零 chunk 的上传**一个字都没被读到**，不算"我们读到的资料"。

    没有这一条，一份 2026-07-17 传上来、解析失败的扫描件会让整个 context 显得很新鲜
    （规则闭嘴，真正的陈旧被藏起来）；反过来在同批里它还会被 newest() 选中当证据，
    对客户点名一份文件清单页上明明标着「解析失败」的文件，说判断读自它。
    """
    tl = build_doc_timeline([
        doc("别墅二期-5月月报.md", f"{STALE_DAY}T00:00:00+00:00"),          # 真读到了
        SimpleNamespace(source_key="扫描件.pdf", filename="扫描件.pdf",
                        uploaded_at=f"{FRESH_DAY}T23:00:00+00:00", status="failed"),
        SimpleNamespace(source_key="空表.xlsx", filename="空表.xlsx",
                        uploaded_at=f"{FRESH_DAY}T23:30:00+00:00", status="empty"),
    ])
    assert tl.newest().source_key == "别墅二期-5月月报.md"
    d = grade_project(proj(id="p_t", status="on-track", sourceRef="别墅二期-5月月报.md:12"),
                      [], as_of=TODAY, timeline=tl)
    hit = next(h for h in d.matched_rules if h.rule_id == "R-STALE-EVIDENCE")
    joined = " ".join(hit.evidence)
    assert "扫描件" not in joined and "空表" not in joined, hit.evidence


@pytest.mark.parametrize("uploaded_at", ["", "   ", "不是时间", "2026-13-45T00:00:00+00:00", None])
def test_unreadable_upload_time_is_never_treated_as_old(uploaded_at):
    """🔴 读不出上传时间 → 不命中。"不知道资料多新"绝不能变成"资料很旧"——那是拿**我们自己的**
    元数据缺失去给客户的文档定性，和把"读不准"说成"文档没写"是同一类错。"""
    tl = build_doc_timeline([doc("花名册.csv", uploaded_at)])
    assert tl.newest() is None
    d = grade_project(proj(id="p_t", status="on-track", sourceRef="花名册.csv:2"),
                      [], as_of=TODAY, timeline=tl)
    assert "R-STALE-EVIDENCE" not in [h.rule_id for h in d.matched_rules]


def test_newest_document_wins_not_the_first_one():
    """判据是**最新**那份，不是列表里第一份——一份新资料就应该让整批重新变新鲜。"""
    tl = _split_timeline()
    assert tl.newest().source_key == "七月总周报.md"
    d = grade_project(proj(id="p_t", status="on-track", sourceRef="七月总周报.md:4"),
                      [], as_of=TODAY, timeline=tl)
    assert "R-STALE-EVIDENCE" not in [h.rule_id for h in d.matched_rules]


def test_evidence_prints_the_same_day_it_compared():
    """🔴 印一个、比另一个 = 本仓最经典的假话面。证据里那个日期必须就是判据用的那个日期，
    而且必须是**日期**——uploaded_at 原样是带微秒的 ISO8601，摆上屏是机器噪音不是读数。

    🔴 语料必须是**两份都超期、但不同天**：own_doc（3 月）≠ newest_doc（5 月）。
    单份语料下两者恒等，这条门就对它自己声称要防的那类 bug 结构上是瞎的。
    """
    tl = build_doc_timeline([doc("别墅二期-3月月报.md", "2026-03-01T00:00:00+00:00"),
                             doc("别墅二期-5月月报.md", f"{STALE_DAY}T02:30:00.926384+00:00")])
    d = grade_project(proj(id="p_t", status="on-track", sourceRef="别墅二期-3月月报.md:12"),
                      [], as_of=TODAY, timeline=tl)
    hit = next(h for h in d.matched_rules if h.rule_id == "R-STALE-EVIDENCE")
    joined = " ".join(hit.evidence)
    assert f'uploaded_at="{STALE_DAY}"' in joined, hit.evidence
    assert "926384" not in joined and "T02:30" not in joined, f"上传时间原样漏进证据：{hit.evidence}"
    assert 'newest_material="别墅二期-5月月报.md"' in joined
    assert "2026-03-01" not in joined, f"印的是项目自己那份、比的却是最新那份：{hit.evidence}"
    # 出处（ADR-0028 的 `<文档名>:<行号>`）是**项目自己那份**，与上面那行判据日期分属两份资料
    # ——正好把「印一个、比另一个」钉开。
    assert 'source="别墅二期-3月月报.md:12"' in joined


def test_evidence_is_exactly_these_two_lines():
    """行数与整行形状都钉死。只断言"包含某子串"挡不住多一行、少一行、或某行被复制一遍。"""
    d = grade_project(proj(id="p_t", status="on-track", sourceRef="别墅二期-5月月报.md:12"),
                      [], as_of=TODAY, timeline=_stale_timeline())
    hit = next(h for h in d.matched_rules if h.rule_id == "R-STALE-EVIDENCE")
    assert hit.evidence == (
        'source="别墅二期-5月月报.md:12"',
        f'newest_material="别墅二期-5月月报.md" uploaded_at="{STALE_DAY}"',
    ), hit.evidence


def test_manual_edits_never_become_document_provenance():
    """🔴 手编出处（`provenance[field].source == "手动编辑"`，一句**后端造的中文**）绝不许
    经 `sourceRef` 流进 evidence —— evidence 是 ADR-0033 载荷禁中文门唯一放行的槽，
    从这里漏进去两道硬门都看不见。

    守法不是拉一张禁词黑名单（那种门只挡得住它认识的那个词），而是把两条线钉开：
    `sourceRef` 恒取实体的 `source`（抽取层写的文档出处），**从不**读 `provenance`。
    手加的卡没有文档出处 → 干脆不发这个键。
    """
    from avery.ingest.registry import MANUAL_SOURCE

    ctx = _ctx_with_docs(f"{STALE_DAY}T02:30:00+00:00")
    ctx.patch_manual_project("p_a", {"status": "at-risk"})      # 手编一个字段
    manual = ctx.add_manual_project({"title": "手加的项目"})     # 整张卡都是手加的

    subjects = {s["id"]: s for s in ctx._decision_subjects()}
    assert ctx.extraction.projects[0].provenance["status"]["source"] == MANUAL_SOURCE
    # 手编过字段，但出处仍是那份真资料——不是手编标记。
    assert subjects["p_a"]["sourceRef"] == "别墅二期-5月月报.md:12"
    # 手加的卡没有任何文档出处 → 这个键根本不发（absent≠none）。
    assert "sourceRef" not in subjects[manual.id]

    for card in ctx.decision_cards(as_of=TODAY):
        for hit in card["matched_rules"]:
            for line in hit["evidence"]:
                assert MANUAL_SOURCE not in line, f"手编标记漏进证据：{line}"


def test_a_signal_kind_word_can_never_be_read_as_a_document_key():
    """🔴 命名陷阱的门：`signal_cards()` 里字面叫 `source` 的键装的是 source_kind（'doc'），
    不是文档引用。定级这一路走的是 `sourceRef`。

    所以哪怕真有一份资料**就叫 'doc'**、且它老得该命中，一张只挂着 `source='doc'` 信号、
    自己没有 `sourceRef` 的项目卡也绝不会被当成"读自那份资料"——一个字都不许命中。
    （若哪天有人图省事把匹配器改成读 `signal["source"]`，这条门会红；那个错误不报异常、
    别的门也全绿。）
    """
    tl = build_doc_timeline([doc("doc", f"{STALE_DAY}T00:00:00+00:00")])
    assert tl.stamp_for("doc") is not None          # 时间轴本身认得这个 key
    card = proj(id="p_t", status="on-track")        # 项目没有 sourceRef
    d = grade_project(card, [sig(source="doc", summary="随手一条")], as_of=TODAY, timeline=tl)
    assert "R-STALE-EVIDENCE" not in [h.rule_id for h in d.matched_rules], d.matched_rules


def test_pre_032_rows_without_a_source_key_still_join_by_filename():
    """feat-032 之前入库的行 `source_key=''`（`SourceDocument.source_key` 的注释明写这种行存在，
    pg 原样读回）。回退到 filename 是 `file_cards()` 数 chunk 的既有口径——去掉回退，
    这类老 context 的整条规则会**静默失效**，而"读不到上传时间所以不判"和"根本没有时间轴"
    在载荷上长得一模一样，没人看得出来。"""
    tl = build_doc_timeline([SimpleNamespace(source_key="", filename="老档案.md",
                                             uploaded_at=f"{STALE_DAY}T00:00:00+00:00")])
    assert tl.newest().source_key == "老档案.md"
    d = grade_project(proj(id="p_t", status="on-track", sourceRef="老档案.md:7"),
                      [], as_of=TODAY, timeline=tl)
    assert "R-STALE-EVIDENCE" in [h.rule_id for h in d.matched_rules]


def test_two_uploads_sharing_a_filename_stay_separate_documents():
    """生产常态：同批传两个「周报.md」，`_unique_parse_names` 给出不同的 source_key
    （「周报.md」/「周报(1).md」）而 filename **都是**「周报.md」。

    🔴 join key 必须是 source_key（filename 优先会让两份互相覆盖，第二份的出处静默查不到），
    而 evidence 里给经理看的名字必须是 **filename** —— 文件清单页只回 filename，
    印 source_key 就是给他一个在他自己文件页上根本不存在的名字。
    """
    # 🔴 让 filename ≠ source_key 的那一份成为**最新**（晚一天，不是晚一小时）——否则
    # newest 落在 source_key == filename 的那份上，这条门对"印错哪个字段"结构上是瞎的。
    tl = build_doc_timeline([
        SimpleNamespace(source_key="周报.md", filename="周报.md",
                        uploaded_at=f"{(TODAY - timedelta(days=R.STALE_EVIDENCE_DAYS + 1)).isoformat()}"
                                    f"T01:00:00+00:00"),
        SimpleNamespace(source_key="周报(1).md", filename="周报.md",
                        uploaded_at=f"{STALE_DAY}T02:00:00+00:00"),
    ])
    assert tl.newest().source_key == "周报(1).md"      # 最新那份正是同名的第二份
    assert tl.stamp_for("周报(1).md:5").source_key == "周报(1).md"   # 没被同名那份覆盖
    assert tl.stamp_for("周报.md:5").source_key == "周报.md"
    d = grade_project(proj(id="p_t", status="on-track", sourceRef="周报(1).md:5"),
                      [], as_of=TODAY, timeline=tl)
    hit = next(h for h in d.matched_rules if h.rule_id == "R-STALE-EVIDENCE")
    joined = " ".join(hit.evidence)
    assert 'newest_material="周报.md"' in joined, f"给经理看的应是文件名：{hit.evidence}"
    assert "newest_material=\"周报(1).md\"" not in joined


def test_stamp_for_splits_on_the_last_colon_only():
    """出处切法与 `registry._chunks_per_file()` 逐字一致：只切最后一个冒号，
    所以文件名自己含冒号（客户真会这么命名）也不会被切错。"""
    tl = build_doc_timeline([doc("2026:上半年:复盘.md", f"{STALE_DAY}T00:00:00+00:00")])
    assert tl.stamp_for("2026:上半年:复盘.md:47").source_key == "2026:上半年:复盘.md"
    assert tl.stamp_for("2026:上半年:复盘.md").source_key == "2026:上半年:复盘.md"
    assert tl.stamp_for("") is None
    assert tl.stamp_for("没见过的.md:1") is None


def test_timeline_normalises_every_zone_to_the_same_utc_day():
    """同一个瞬间无论写成哪个时区，折出来必须是同一天；Z 后缀也认。
    归一只发生在一处（`_uploaded_day`），不然早晚归出两个不同的日子。"""
    same = {build_doc_timeline([doc("周报.md", text)]).newest().day
            for text in ("2026-06-01T00:30:00+00:00", "2026-06-01T00:30:00Z",
                         "2026-06-01T08:30:00+08:00", "2026-05-31T20:30:00-04:00")}
    assert same == {date(2026, 6, 1)}
    # naive（没带时区）的历史行按字面日期认，不猜时区。
    assert build_doc_timeline(
        [doc("周报.md", "2026-06-01T00:30:00")]).newest().day == date(2026, 6, 1)


def test_stale_evidence_is_reproducible():
    """同一份输入连跑两次逐字节一致——时间轴不引入任何时钟/迭代序依赖。"""
    tl = _stale_timeline()
    card = proj(id="p_t", status="on-track", sourceRef="别墅二期-5月月报.md:12")
    assert (grade_project(card, [], as_of=TODAY, timeline=tl).to_dict()
            == grade_project(card, [], as_of=TODAY, timeline=tl).to_dict())


def test_same_day_uploads_pick_a_stable_newest():
    """同一天上传的多份资料（今天的常态：一批 /ingest 全进，彼此只差微秒）必须选出**定死**
    的那一份，否则证据行会随迭代序漂，"连跑两次一致"的承诺就破了。

    🔴 断言的是**具体是哪一份**，不是"两次调用彼此相等"：后者对着一个 `set` 迭代序实现
    也会在同一个进程里全绿（同一个 PYTHONHASHSEED），只有换进程才露馅——那种门是装饰。
    口径是 `max((day, source_key))`，所以同日里 source_key 字典序最大的那份胜出。
    """
    stamps = [doc("乙方补充材料.md", f"{STALE_DAY}T01:00:00+00:00"),
              doc("甲方来函.md", f"{STALE_DAY}T02:00:00+00:00"),
              doc("丙栋验收单.md", f"{STALE_DAY}T03:00:00+00:00")]
    expected = max(s.source_key for s in stamps)
    for order in (stamps, list(reversed(stamps)), [stamps[1], stamps[2], stamps[0]]):
        assert build_doc_timeline(order).newest().source_key == expected


def test_stale_evidence_payload_stays_free_of_backend_prose():
    """🔴 新规则的载荷仍须过 ADR-0033：中文只许出现在 evidence（文件名是客户自己的字），
    params 里只有数字。文档名图省事塞进 params 会让英文用户看到中文文件名当参数。"""
    cjk = re.compile(r"[一-鿿]")
    d = grade_project(proj(id="p_t", status="on-track", sourceRef="别墅二期-5月月报.md:12"),
                      [], as_of=TODAY, timeline=_stale_timeline()).to_dict()
    hit = next(h for h in d["matched_rules"] if h["rule_id"] == "R-STALE-EVIDENCE")
    assert hit["params"] == {"days": R.STALE_EVIDENCE_DAYS}
    assert not cjk.search(json.dumps(hit["params"], ensure_ascii=False))
    assert cjk.search(" ".join(hit["evidence"]))     # 中文确实走了 evidence 这条合法通道


# --- 11. 🔴 可达性：规则在**真链路**上跑得到吗 ------------------------------------------------
#
# 上面每一条都直接喂 grade_project()。它们全绿仍然可能是一条恒绿的假规则——只要
# CompanyContext 那一层忘了把时间轴传下去，线上就一次都不会命中，而单测一条都不会红。
# 本仓管这个叫"判据够不着 = 恒绿"。所以下面这两条从 CompanyContext 进、从 decision_cards()
# 出，中间一步不跳。

def _ctx_with_docs(uploaded_at: str):
    from avery.ingest.extract import ExtractionResult, ProjectEntity
    from avery.ingest.registry import CompanyContext, SourceDocument

    class _NullStore:
        def query(self, q, limit=8):
            return []

    ext = ExtractionResult(projects=[
        ProjectEntity(id="p_a", title="别墅二期交付", ownerName="陈曦", status="on-track",
                      source="别墅二期-5月月报.md:12")])
    return CompanyContext(
        context_id="c_time", extraction=ext, store=_NullStore(), memory_dir=Path("."),
        source_documents=[SourceDocument(filename="别墅二期-5月月报.md",
                                         source_key="别墅二期-5月月报.md",
                                         uploaded_at=uploaded_at)])


def test_decision_cards_really_carry_the_timeline_through():
    """🔴 真链路可达性：CompanyContext（带 source_documents）→ decision_cards() 必须真的命中。
    这条一红，说明 registry 那层没把时间轴喂下去——上面那一整节纯函数门届时全绿，
    线上却一次都不触发。"""
    stale = _ctx_with_docs(f"{STALE_DAY}T02:30:00.926384+00:00").decision_cards(as_of=TODAY)
    fresh = _ctx_with_docs(f"{FRESH_DAY}T02:30:00.926384+00:00").decision_cards(as_of=TODAY)
    assert [h["rule_id"] for h in stale[0]["matched_rules"] if h["rule_id"] == "R-STALE-EVIDENCE"]
    assert stale[0]["grade"] == R.NEEDS_CONFIRMATION
    # 同一条链路、只把上传时间挪新一天 → 不命中。一红一绿都验到，才不是"恒红/恒绿"。
    assert not [h for h in fresh[0]["matched_rules"] if h["rule_id"] == "R-STALE-EVIDENCE"]
    assert fresh[0]["grade"] == R.CAN_PROCEED
    # 出处也真的经投影到了定级层（sourceRef 这条线没断）。
    hit = next(h for h in stale[0]["matched_rules"] if h["rule_id"] == "R-STALE-EVIDENCE")
    assert 'source="别墅二期-5月月报.md:12"' in " ".join(hit["evidence"])


def test_briefing_and_decision_cards_agree_about_staleness():
    """🔴 briefing 与 decision_cards 共用同一张规则表，只喂一边就会让今天页的卡片和它上面
    那句「N 个值得多看一眼」对不上——那是 briefing() 长注释里记着的旧伤，别用新规则复发一次。"""
    ctx = _ctx_with_docs(f"{STALE_DAY}T02:30:00+00:00")
    cards = ctx.decision_cards(as_of=TODAY)
    assert [c["grade"] for c in cards] == [R.NEEDS_CONFIRMATION]
    look = [m for m in ctx.briefing(as_of=TODAY)["metrics"] if m["label"] == "need a look"]
    assert look and look[0]["value"] == "1", ctx.briefing(as_of=TODAY)["metrics"]


def test_project_source_ref_stays_out_of_the_public_project_card():
    """`sourceRef` 是定级内部的 join key，不该混进 /team 回帧的 LiveProjectCard 公开契约。"""
    ctx = _ctx_with_docs(f"{STALE_DAY}T02:30:00+00:00")
    assert "sourceRef" not in ctx.project_cards()[0]
    assert ctx._decision_subjects()[0]["sourceRef"] == "别墅二期-5月月报.md:12"


def test_soft_deleted_projects_leave_the_decision_path_too():
    """🔴 用户扔进折叠抽屉的项目，不许从今天页 / 「N 个值得多看一眼」里爬回来。

    定级现在吃的是 `_decision_subjects()`，它和 `project_cards()` 必须同一条 archived 口径。
    这条不变量此前只由 `project_cards()` 那侧的门守着；本票新开一条投影 = 抄了第二份，
    没有这条门，把过滤删掉全仓一条不红。
    """
    ctx = _ctx_with_docs(f"{STALE_DAY}T02:30:00+00:00")
    ctx.extraction.projects[0].status = "blocked"          # 归档前是高风险，最容易爬回来
    assert ctx.decision_cards(as_of=TODAY)                 # 归档前在场
    ctx.set_project_archived("p_a", True)
    assert ctx.project_cards() == []
    assert ctx._decision_subjects() == []
    assert ctx.decision_cards(as_of=TODAY) == []
    assert not [m for m in ctx.briefing(as_of=TODAY)["metrics"] if m["label"] == "need a look"]


def test_a_freshly_claimed_sample_team_is_not_told_its_material_is_stale():
    """🔴 demo 母本是内容寻址的、一次铸成就常驻，它的 `uploaded_at` 冻在这台部署首次铸母本那天。

    若克隆逐字继承那个时间戳，母本满 45 天之后，**每一位三秒前才领到示例团队、一个文件都没传过**
    的访客，一进门就是整块看板「需确认：手上最新的一份资料也是 45 天以前上传的」，
    而且他无论做什么都消不掉。所以 `clone_context` 给副本重打上传时间。
    """
    from avery.ingest.registry import ContextRegistry

    reg = ContextRegistry()
    master = _ctx_with_docs("2026-01-01T00:00:00+00:00")    # 母本：铸于很久以前
    master.context_id = "ctx_demo_master"
    reg.put(master)
    assert reg.clone_context("ctx_demo_master", new_context_id="ctx_visitor",
                             new_owner_token="tok-visitor")
    twin = reg.get("ctx_visitor")
    # 副本的资料对这位访客来说，确实是此刻才进他工作区的。
    assert twin.source_documents[0].uploaded_at != master.source_documents[0].uploaded_at
    from avery.decision_grading import _uploaded_day
    assert _uploaded_day(twin.source_documents[0].uploaded_at) == date.today()
    for card in twin.decision_cards():                      # as_of 走 date.today()，同生产
        assert "R-STALE-EVIDENCE" not in [h["rule_id"] for h in card["matched_rules"]], card


def test_company_context_emits_decision_cards():
    """CompanyContext.decision_cards() 是 /ingest 与 /team 回帧里 `decisions` 的来源。"""
    from avery.ingest.extract import ExtractionResult, ProjectEntity, SignalEntity
    from avery.ingest.registry import CompanyContext

    class _NullStore:
        def query(self, q, limit=8):
            return []

    ext = ExtractionResult(
        projects=[ProjectEntity(id="p_a", title="别墅二期交付", ownerName="陈曦",
                                status="on-track", blockers=["等待集团法务签字", "分包未进场"]),
                  ProjectEntity(id="p_b", title="CRM 上线", status="on-track")],
        signals=[SignalEntity(id="s_a", source_kind="doc", subjectType="project",
                              subjectRef="p_a", summary="业主投诉交付延期")])
    ctx = CompanyContext(context_id="c1", extraction=ext, store=_NullStore(),
                         memory_dir=Path("."))
    cards = ctx.decision_cards(as_of=TODAY)
    assert [c["subject_id"] for c in cards] == ["p_a", "p_b"]
    assert cards[0]["grade"] == R.HIGH_RISK and cards[1]["grade"] == R.CAN_PROCEED
    assert cards[0]["matched_rules"]


# --- 12. 跨资料冲突上卡（gap-design-0805 · B2b / #56）-----------------------------------------
#
# T6 让归并把丢弃的读数记进 `ExtractionResult.conflicts`，本节验两条规则把它送上今天页。
# 判据函数纯离线：鸭子构造几条冲突记录即可（定级层按 T6 交接口径只读六个属性），
# 零模型调用、零真库。🔴 语料沿用本文件纪律：中文文件名 + 中文读数必须真进判据。

def reading(value: str, source: str) -> SimpleNamespace:
    """一个被记下来的读数。doc_key 的切法与 `extract.doc_key_of` 逐字一致（rsplit 最后一个冒号）。"""
    return SimpleNamespace(value=value, source=source,
                           doc_key=source.rsplit(":", 1)[0] if ":" in source else source)


def conflict(kind: str, ref: str, fname: str, *values) -> SimpleNamespace:
    return SimpleNamespace(subject_kind=kind, subject_ref=ref, field=fname, values=list(values))


# 两份资料：花名册先传（6-28）、周报后传（7-10）。都在 45 天窗口内，R-STALE-EVIDENCE 不搅局。
ROSTER_DAY, WEEKLY_DAY = "2026-06-28", "2026-07-10"


def _two_doc_timeline():
    return build_doc_timeline([doc("花名册.xlsx", f"{ROSTER_DAY}T02:00:00+00:00"),
                               doc("周报-8月6日.md", f"{WEEKLY_DAY}T09:30:00+00:00")])


def test_cross_doc_conflict_puts_both_readings_with_their_docs_and_days_on_the_card():
    """票面那张双引文卡的后端半张：每个读数一行 evidence——字段 + verbatim 原值 + 文件名 +
    上传日，按上传日从旧到新排。🔴 断言**逐字整行**：行的形状就是前端双栏渲染的契约，
    也顺带钉死「印的日期 = 比较用的日期」（印一个比另一个是本仓最经典的假话面）。

    语料故意用 T6 钉过的已知假阳性（同一个日期两种写法）——它正是「可能只是叫法不同」
    dismiss 出口存在的理由，规则命中它是**设计内**行为，不是 bug。
    """
    c = conflict("project", "p_c", "dueDate",
                 reading("2026年9月30日", "花名册.xlsx:3"),
                 reading("2026-09-30", "周报-8月6日.md:7"))
    d = grade_project(proj(id="p_c", status="on-track", dueDate="2026-09-30"),
                      [], as_of=TODAY, timeline=_two_doc_timeline(), conflicts=[c])
    hit = next(h for h in d.matched_rules if h.rule_id == "R-CROSS-DOC-CONFLICT")
    assert list(hit.evidence) == [
        f'dueDate="2026年9月30日" doc="花名册.xlsx" uploaded_at="{ROSTER_DAY}"',
        f'dueDate="2026-09-30" doc="周报-8月6日.md" uploaded_at="{WEEKLY_DAY}"',
    ]
    # 本来 R-CLEAR 可推进的卡，因为两份资料对不上抬到需确认——第②句对客承诺的最小可证形状。
    assert d.rule_grade == R.NEEDS_CONFIRMATION


def test_owner_profile_conflict_reaches_the_owned_project_only():
    """票面头号例子：《花名册》读到周雅婷在前厅部、《周报》读到她在传菜组。person 型冲突
    只在指向**项目负责人**时作为项目证据进场（与 person 信号同一条红线，本引擎不给人打分），
    字段机器键带 `owner.` 前缀——卡上才分得清 status 是项目的、team 是负责人的。
    别人的项目（负责人不是她）一条都不沾。
    """
    c = conflict("person", "u_zhou", "team",
                 reading("前厅部", "花名册.xlsx:5"),
                 reading("传菜组", "周报-8月6日.md:2"))
    hers = grade_project(proj(id="p_h", title="前厅排班改版", ownerId="u_zhou",
                              ownerName="周雅婷", status="on-track"),
                         [], as_of=TODAY, timeline=_two_doc_timeline(), conflicts=[c])
    hit = next(h for h in hers.matched_rules if h.rule_id == "R-CROSS-DOC-CONFLICT")
    assert list(hit.evidence) == [
        f'owner.team="前厅部" doc="花名册.xlsx" uploaded_at="{ROSTER_DAY}"',
        f'owner.team="传菜组" doc="周报-8月6日.md" uploaded_at="{WEEKLY_DAY}"',
    ]
    others = grade_project(proj(id="p_o", title="泳池翻新", ownerId="u_wang", ownerName="王磊",
                                status="on-track"),
                           [], as_of=TODAY, timeline=_two_doc_timeline(), conflicts=[c])
    assert not [h for h in others.matched_rules
                if h.rule_id in ("R-CROSS-DOC-CONFLICT", "R-FRESH-CONTRADICTS-STALE")]


def test_a_disagreement_inside_one_document_is_not_called_cross_doc():
    """T6 钉过：两个读数可能来自**同一份**文档（花名册把同一个人列了两行）。规则号叫
    CROSS-DOC、文案说「不同资料」——对同一份文档内部的分歧说这句话就是撒谎，v1 明写不覆盖。"""
    c = conflict("person", "u_zhou", "team",
                 reading("前厅部", "花名册.xlsx:5"),
                 reading("传菜组", "花名册.xlsx:19"))
    d = grade_project(proj(id="p_h", ownerId="u_zhou", status="on-track"),
                      [], as_of=TODAY, timeline=_two_doc_timeline(), conflicts=[c])
    assert not [h for h in d.matched_rules
                if h.rule_id in ("R-CROSS-DOC-CONFLICT", "R-FRESH-CONTRADICTS-STALE")]
    assert d.rule_grade == R.CAN_PROCEED


def test_fresh_contradicts_stale_owns_the_time_directed_conflict():
    """T4 移交的第二条规则：两份上传日一早一晚、更新那份读到的状态更糟 → 归它，且**只**归它
    ——同一条冲突不在 R-CROSS-DOC-CONFLICT 里再印一遍（一份证据两张卡是给经理出阅读理解题）。"""
    c = conflict("project", "p_c", "status",
                 reading("on-track", "花名册.xlsx:3"),
                 reading("blocked", "周报-8月6日.md:7"))
    d = grade_project(proj(id="p_c", status="on-track"),
                      [], as_of=TODAY, timeline=_two_doc_timeline(), conflicts=[c])
    ids = [h.rule_id for h in d.matched_rules]
    assert "R-FRESH-CONTRADICTS-STALE" in ids and "R-CROSS-DOC-CONFLICT" not in ids
    hit = next(h for h in d.matched_rules if h.rule_id == "R-FRESH-CONTRADICTS-STALE")
    assert list(hit.evidence) == [
        f'status="on-track" doc="花名册.xlsx" uploaded_at="{ROSTER_DAY}"',
        f'status="blocked" doc="周报-8月6日.md" uploaded_at="{WEEKLY_DAY}"',
    ]
    assert d.rule_grade == R.NEEDS_CONFIRMATION


def test_same_day_uploads_never_claim_a_time_direction():
    """🔴 同批上传彼此只差微秒，谁先谁后是文件遍历顺序给的、不是事实给的（T4 交接红线：
    日期比较一律天粒度）。同一天的两份资料读数再糟也只报「对不上」，不报「新的更糟」。"""
    tl = build_doc_timeline([doc("花名册.xlsx", f"{WEEKLY_DAY}T02:00:00+00:00"),
                             doc("周报-8月6日.md", f"{WEEKLY_DAY}T02:00:01+00:00")])
    c = conflict("project", "p_c", "status",
                 reading("on-track", "花名册.xlsx:3"),
                 reading("blocked", "周报-8月6日.md:7"))
    d = grade_project(proj(id="p_c", status="on-track"), [], as_of=TODAY, timeline=tl,
                      conflicts=[c])
    ids = [h.rule_id for h in d.matched_rules]
    assert "R-CROSS-DOC-CONFLICT" in ids and "R-FRESH-CONTRADICTS-STALE" not in ids


@pytest.mark.parametrize("old_val,new_val", [
    ("blocked", "on-track"),     # 新的更好：方向不成立
    ("on-track", "已搁置"),       # 新读数没被归一：查表得 0，绝不猜方向
    ("at-risk", "at-risk2"),     # 同上，词表外的变体
])
def test_fresh_contradicts_requires_the_newer_reading_to_be_provably_worse(old_val, new_val):
    """方向判断只认 `STATUS_BADNESS`（blocked > at-risk > 其余）。新读数更好、或压根读不懂，
    都退回不看时间的 R-CROSS-DOC-CONFLICT——对着读不懂的词断言「更糟」比漏报这个方向贵。"""
    c = conflict("project", "p_c", "status",
                 reading(old_val, "花名册.xlsx:3"),
                 reading(new_val, "周报-8月6日.md:7"))
    d = grade_project(proj(id="p_c", status="on-track"),
                      [], as_of=TODAY, timeline=_two_doc_timeline(), conflicts=[c])
    ids = [h.rule_id for h in d.matched_rules]
    assert "R-CROSS-DOC-CONFLICT" in ids and "R-FRESH-CONTRADICTS-STALE" not in ids


def test_due_date_and_team_conflicts_never_claim_a_time_direction():
    """「更糟」只对项目状态有排序：dueDate 是自由文本、team 没有方向。哪怕上传日一早一晚，
    这两类字段的冲突也只报「对不上」。"""
    for c in (conflict("project", "p_c", "dueDate",
                       reading("8月15日", "花名册.xlsx:3"),
                       reading("9月30日", "周报-8月6日.md:7")),
              conflict("person", "u_zhou", "team",
                       reading("前厅部", "花名册.xlsx:5"),
                       reading("传菜组", "周报-8月6日.md:2"))):
        d = grade_project(proj(id="p_c", ownerId="u_zhou", status="on-track"),
                          [], as_of=TODAY, timeline=_two_doc_timeline(), conflicts=[c])
        ids = [h.rule_id for h in d.matched_rules]
        assert "R-CROSS-DOC-CONFLICT" in ids and "R-FRESH-CONTRADICTS-STALE" not in ids


def test_a_reading_we_cannot_date_still_reaches_the_card_without_a_time_claim():
    """时间轴里定位不到那份资料（元数据缺失 / 没时间轴）→ 读数照样上卡（冲突是真的），
    只是那一行不带 uploaded_at、也永远进不了「新的更糟」——不知道多新绝不能变成"更新"。"""
    c = conflict("project", "p_c", "status",
                 reading("on-track", "花名册.xlsx:3"),
                 reading("blocked", "没入库的扫描件.pdf:1"))
    d = grade_project(proj(id="p_c", status="on-track"),
                      [], as_of=TODAY, timeline=_two_doc_timeline(), conflicts=[c])
    hit = next(h for h in d.matched_rules if h.rule_id == "R-CROSS-DOC-CONFLICT")
    assert list(hit.evidence) == [
        f'status="on-track" doc="花名册.xlsx" uploaded_at="{ROSTER_DAY}"',
        'status="blocked" doc="没入库的扫描件.pdf"',
    ]
    assert not [h for h in d.matched_rules if h.rule_id == "R-FRESH-CONTRADICTS-STALE"]


def test_conflict_evidence_prints_the_display_filename_not_the_join_key():
    """🔴 evidence 印的是**给人看的文件名**（时间轴里的 filename），不是 join 用的 source_key。
    两者在生产里真的会不同（同批同名上传走 `_unique_parse_names` 改 key 不改显示名）。
    T4 的变异验证栽过这个坑：语料里两者恰好相等，「印错了哪个」的变异全绿通过——
    所以这条语料**必须**让它们不同，否则本节对 M6 类变异结构上是瞎的。"""
    tl = build_doc_timeline([doc("花名册.xlsx", f"{ROSTER_DAY}T02:00:00+00:00"),
                             doc("周报(1).md", f"{WEEKLY_DAY}T09:30:00+00:00",
                                 filename="周报.md")])
    c = conflict("project", "p_c", "dueDate",
                 reading("8月15日", "花名册.xlsx:3"),
                 reading("9月30日", "周报(1).md:7"))
    d = grade_project(proj(id="p_c", status="on-track"), [], as_of=TODAY, timeline=tl,
                      conflicts=[c])
    hit = next(h for h in d.matched_rules if h.rule_id == "R-CROSS-DOC-CONFLICT")
    assert hit.evidence[1] == f'dueDate="9月30日" doc="周报.md" uploaded_at="{WEEKLY_DAY}"'


def test_no_conflicts_argument_means_the_rules_simply_do_not_run():
    """不传 conflicts = 没有冲突记录，两条规则一条都不命中——老调用方原样不受影响。"""
    d = grade_project(proj(id="p_c", status="on-track"), [], as_of=TODAY,
                      timeline=_two_doc_timeline())
    assert not [h for h in d.matched_rules
                if h.rule_id in ("R-CROSS-DOC-CONFLICT", "R-FRESH-CONTRADICTS-STALE")]
    assert d.rule_grade == R.CAN_PROCEED


def test_the_two_conflict_rules_share_one_grade():
    """🔴 T4 交接明令：两条一起定级，别一高一低——「新文档白纸黑字推翻旧读数」不能显得比
    「关键词族信号」更轻或更重却说不出为什么。定案：同为需确认（理由见 decision_rules.py）。"""
    assert R.rule("R-CROSS-DOC-CONFLICT").grade == R.NEEDS_CONFIRMATION
    assert R.rule("R-FRESH-CONTRADICTS-STALE").grade == R.NEEDS_CONFIRMATION


def test_conflict_payload_stays_free_of_backend_prose():
    """🔴 ADR-0033：中文只许走 evidence（客户自己的读数和文件名），params 恒空（这两条规则
    没有静态阈值），其余键一个 CJK 字都不许有。文档名图省事塞进 params 的路在 T4 就被堵过。"""
    cjk = re.compile(r"[一-鿿]")
    c = conflict("project", "p_c", "status",
                 reading("进行中", "花名册.xlsx:3"),
                 reading("已阻塞", "周报-8月6日.md:7"))
    d = grade_project(proj(id="p_c", status="on-track"),
                      [], as_of=TODAY, timeline=_two_doc_timeline(), conflicts=[c]).to_dict()
    hit = next(h for h in d["matched_rules"] if h["rule_id"] == "R-CROSS-DOC-CONFLICT")
    assert hit["params"] == {}
    for key, value in hit.items():
        if key == "evidence":
            continue
        assert not cjk.search(json.dumps(value, ensure_ascii=False)), (key, value)
    assert cjk.search(" ".join(hit["evidence"]))   # 中文确实走了 evidence 这条合法通道


def test_conflict_grading_is_reproducible():
    """同一份输入连跑两次逐字节一致——冲突归属/排序不引入任何迭代序依赖。"""
    c = conflict("project", "p_c", "dueDate",
                 reading("8月15日", "花名册.xlsx:3"),
                 reading("9月30日", "周报-8月6日.md:7"))
    card = proj(id="p_c", status="on-track")
    assert (grade_project(card, [], as_of=TODAY, timeline=_two_doc_timeline(),
                          conflicts=[c]).to_dict()
            == grade_project(card, [], as_of=TODAY, timeline=_two_doc_timeline(),
                             conflicts=[c]).to_dict())


# --- 12b. 🔴 可达性：conflicts 在**真链路**上到得了今天页吗 ------------------------------------
#
# 上面全部直接喂 grade_project()。CompanyContext 那层忘了把 conflicts 传下去的话，
# 纯函数门全绿、线上一次都不命中（T4 那节的同款教训，"判据够不着 = 恒绿"）。
# 下面从 CompanyContext 进、decision_cards()/briefing() 出，中间一步不跳。

def _ctx_with_conflict():
    """票面头号例子的真实体版：周雅婷的部门在两份资料里对不上，她名下有一个项目。"""
    from avery.ingest.extract import ConflictValue, ExtractionResult, FieldConflict, ProjectEntity
    from avery.ingest.registry import CompanyContext, SourceDocument

    class _NullStore:
        def query(self, q, limit=8):
            return []

    ext = ExtractionResult(
        projects=[ProjectEntity(id="p_h", title="前厅排班改版", ownerId="u_zhou",
                                ownerName="周雅婷", status="on-track")],
        conflicts=[FieldConflict(
            subject_kind="person", subject_ref="u_zhou", field="team",
            values=[ConflictValue(value="前厅部", source="花名册.xlsx:5", doc_key="花名册.xlsx"),
                    ConflictValue(value="传菜组", source="周报-8月6日.md:2",
                                  doc_key="周报-8月6日.md")])])
    return CompanyContext(
        context_id="c_conf", extraction=ext, store=_NullStore(), memory_dir=Path("."),
        source_documents=[
            SourceDocument(filename="花名册.xlsx", source_key="花名册.xlsx",
                           uploaded_at=f"{ROSTER_DAY}T02:00:00+00:00"),
            SourceDocument(filename="周报-8月6日.md", source_key="周报-8月6日.md",
                           uploaded_at=f"{WEEKLY_DAY}T09:30:00+00:00")])


def test_decision_cards_really_carry_the_conflicts_through():
    """🔴 真链路可达性：CompanyContext（带 extraction.conflicts + source_documents）→
    decision_cards() 必须真的命中，证据行带文件名与上传日。这条一红 = registry 没喂 conflicts。"""
    cards = _ctx_with_conflict().decision_cards(as_of=TODAY)
    assert cards[0]["grade"] == R.NEEDS_CONFIRMATION
    hit = next(h for h in cards[0]["matched_rules"] if h["rule_id"] == "R-CROSS-DOC-CONFLICT")
    assert hit["evidence"] == [
        f'owner.team="前厅部" doc="花名册.xlsx" uploaded_at="{ROSTER_DAY}"',
        f'owner.team="传菜组" doc="周报-8月6日.md" uploaded_at="{WEEKLY_DAY}"',
    ]


def test_briefing_and_decision_cards_agree_about_conflicts():
    """🔴 briefing 与 decision_cards 共用同一张规则表，conflicts 只喂一边就会让今天页的卡片
    和「N 个值得多看一眼」对不上——B1 时间轴接线时的同款旧伤，别用新规则复发一次。"""
    ctx = _ctx_with_conflict()
    assert [c["grade"] for c in ctx.decision_cards(as_of=TODAY)] == [R.NEEDS_CONFIRMATION]
    look = [m for m in ctx.briefing(as_of=TODAY)["metrics"] if m["label"] == "need a look"]
    assert look and look[0]["value"] == "1", ctx.briefing(as_of=TODAY)["metrics"]
