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
from datetime import date
from pathlib import Path

import pytest

from avery import decision_rules as R
from avery.decision_grading import (
    AveryReview,
    apply_review,
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
    for d in grade_projects(PROJECTS, SIGNALS, as_of=TODAY):
        assert d.matched_rules, f"{d.subject_title} 没有任何命中规则"
        for hit in d.matched_rules:
            assert hit.rule_id in R.RULE_IDS, f"未知规则号 {hit.rule_id}"
            assert hit.evidence, f"{hit.rule_id} 命中却没给证据"
            assert hit.title and hit.basis
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
    """"月底前"这种解析不了的到期日按未知处理，绝不当作"还早"。"""
    d = grade_project(proj(status="on-track", dueDate="月底前"), [], as_of=TODAY)
    assert "dueDate" in d.unknown_fields
    assert not any(h.rule_id in ("R-DUE-SOON", "R-OVERDUE") for h in d.matched_rules)


def test_unknown_fields_are_reported_for_the_frontend():
    """057 靠 unknown_fields 显示「文档未提及」，绝不能渲染成 0%。"""
    d = grade_project(proj(id="p_x", title="无字段项目"), [], as_of=TODAY)
    assert set(d.unknown_fields) == {"status", "progress", "dueDate"}
    d2 = grade_project(proj(status="on-track", progress=50, dueDate="2026-12-01"), [], as_of=TODAY)
    assert d2.unknown_fields == ()


def test_reason_flags_the_unknowns():
    d = grade_project(proj(id="p_y", title="半空项目", status="on-track"), [], as_of=TODAY)
    assert "未提及" in d.reason and "未知不等于没风险" in d.reason


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
                  "PROGRESS_LOW_PCT", "BLOCKER_STACK_N"):
        assert const in doc, f"阈值 {const} 没写进说明文档"
        assert str(getattr(R, const)) in doc, f"{const} 的值在文档里对不上"


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
    """机械拼装的理由要能过既有红线校验器——定级不许变成给人贴标签的后门。"""
    from avery import redline
    for d in grade_projects(PROJECTS, SIGNALS, as_of=TODAY):
        res = redline.validate(d.reason, cited_snippets=[e for h in d.matched_rules
                                                         for e in h.evidence])
        assert res.passed, f"定级理由触了红线：{d.reason} / {res}"


def test_decision_dict_has_no_person_score_keys():
    """输出结构里不许出现任何人身评分字段（结构性护栏，和人卡同一条红线）。"""
    banned = ("moodPct", "capacityPct", "score", "rating", "rank", "tier", "percentile")
    for d in grade_projects(PROJECTS, SIGNALS, as_of=TODAY):
        blob = json.dumps(d.to_dict(), ensure_ascii=False)
        for key in banned:
            assert f'"{key}"' not in blob


# --- 9. 与 payload 的接缝（057 照着接的就是这个）-----------------------------------------------

def test_payload_shape_for_feat_057():
    """输出契约：字段齐、类型对。057 前端按这个形状接。"""
    d = grade_project(PROJECTS[0], SIGNALS, as_of=TODAY).to_dict()
    assert set(d) == {
        "subject_type", "subject_id", "subject_title", "owner_name",
        "grade", "grade_label", "severity", "rule_grade", "rule_grade_label", "rule_severity",
        "matched_rules", "unknown_fields", "reason", "reason_source",
        "escalated", "escalation_reason", "downgrade_blocked", "rejected_grade",
        "review_rejected",
    }
    assert d["grade"] in R.GRADES and d["grade_label"] == R.LABEL_ZH[d["grade"]]
    hit = d["matched_rules"][0]
    assert set(hit) == {"rule_id", "grade", "grade_label", "severity", "title", "basis",
                        "evidence"}
    assert isinstance(hit["evidence"], list)
    json.dumps(d, ensure_ascii=False)  # 必须可 JSON 序列化（要过 HTTP）


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
