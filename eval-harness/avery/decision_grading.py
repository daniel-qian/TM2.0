# -*- coding: utf-8 -*-
"""feat-056 · 决策定级引擎（规则算等级 + Avery 写理由）。

Danny 拍板 a+b：**等级归规则、文字归 Avery；Avery 只许上调、不许下调。**
口径（关键词族 / 阈值 / 规则条目）全部在 `avery/decision_rules.py`，人类可读版在
`eval-harness/decision_grading_rules.md`。本文件只做三件事：

1. `grade_project()` —— 纯函数、零 LLM、零网络、零随机：同一份 payload + 同一个 `as_of`
   进去，等级和命中规则**逐字节一致**。时间类规则（到期日）显式吃 `as_of` 参数，
   所以"同一份文件连跑两次结果一致"是结构上成立的，不是碰运气。
2. `apply_review()` —— 把 Avery 的一句人话理由贴上去，并**硬拦下调**：
   - 上调（severity 更高）+ 写明理由 → 采纳，标 `escalated`；
   - 上调但没写理由 → 拒绝（`escalation_rejected="missing_reason"`）；
   - 下调 → 一律拒绝，等级保持规则值，并连同它那句理由一起丢弃
     （理由是为它想判的那一档写的，贴在更高一档上会自相矛盾），标 `downgrade_blocked`。
3. `grade_projects()` —— 批量 + 排序，直接喂前端 feat-057 的「今天要决策的」。

🔴 红线：本模块只读**项目**字段和**信号原文**，不给人打分、不产出任何人身级别的判断。
person 型信号只在它指向某项目负责人时作为**项目**证据参与，原文照引（抽取层已做过
situationalize + 红线门），本模块不再复述、不加形容。
"""
from __future__ import annotations

import re
from dataclasses import dataclass, replace
from datetime import date

from .decision_rules import (
    BLOCKER_STACK_N,
    CAN_PROCEED,
    DUE_CRUNCH_DAYS,
    DUE_SOON_DAYS,
    GRADES,
    HIGH_RISK,
    KEYWORD_FAMILIES,
    LABEL_ZH,
    NEEDS_CONFIRMATION,
    PROGRESS_CRUNCH_PCT,
    PROGRESS_LOW_PCT,
    RULES,
    SEVERITY,
    STATUS_AT_RISK,
    STATUS_BLOCKED,
    STATUS_DONE,
    STATUS_STEADY,
    rule,
)

__all__ = [
    "AveryReview", "Decision", "RuleHit",
    "grade_project", "grade_projects", "apply_review", "parse_due_date",
]


# --- 到期日解析 -------------------------------------------------------------------------------
# dueDate 是**自由文本**（文档里怎么写就怎么抽）。只认能确定解析的写法；认不出来就当"未知"，
# 🔴 绝不猜、更绝不因为认不出来就当作"还早"。
_MONTHS = {m: i for i, m in enumerate(
    ("jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"), start=1)}

_RE_YMD = re.compile(r"(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})")
_RE_YM = re.compile(r"(\d{4})\s*[-/.年]\s*(\d{1,2})\s*月?(?!\s*[-/.]?\s*\d)")
_RE_MON_D_Y = re.compile(r"\b([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b")
_RE_D_MON_Y = re.compile(r"\b(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3,9})\.?,?\s+(\d{4})\b")
_RE_SLASH = re.compile(r"\b(\d{1,2})\s*/\s*(\d{1,2})\s*/\s*(\d{4})\b")


def _mk(year: int, month: int, day: int) -> date | None:
    try:
        return date(year, month, day)
    except ValueError:
        return None


def parse_due_date(text: str) -> date | None:
    """把一个自由文本 dueDate 解析成 date；认不出来返回 None（= 未知，不是"很远"）。

    支持 `2026-08-15` / `2026/8/15` / `2026年8月15日` / `2026年8月`（按当月 1 号，取**最早**
    可能日 —— 偏保守 = 偏向上调，符合"漏报比误报贵"）/ `Aug 15, 2026` / `15 Aug 2026`。
    `08/15/2026` 这种日月顺序有歧义的写法：只有当某一位 > 12（唯一解）时才认，否则判未知。
    """
    if not text:
        return None
    t = str(text).strip().lower()
    if not t:
        return None

    m = _RE_YMD.search(t)
    if m:
        return _mk(int(m.group(1)), int(m.group(2)), int(m.group(3)))

    m = _RE_MON_D_Y.search(t)
    if m and m.group(1)[:3] in _MONTHS:
        return _mk(int(m.group(3)), _MONTHS[m.group(1)[:3]], int(m.group(2)))

    m = _RE_D_MON_Y.search(t)
    if m and m.group(2)[:3] in _MONTHS:
        return _mk(int(m.group(3)), _MONTHS[m.group(2)[:3]], int(m.group(1)))

    m = _RE_SLASH.search(t)
    if m:
        a, b, year = int(m.group(1)), int(m.group(2)), int(m.group(3))
        if a > 12 >= b:          # 15/08/2026 → 日/月
            return _mk(year, b, a)
        if b > 12 >= a:          # 08/15/2026 → 月/日
            return _mk(year, a, b)
        return None              # 两位都 <= 12：歧义，判未知

    m = _RE_YM.search(t)
    if m:
        return _mk(int(m.group(1)), int(m.group(2)), 1)
    return None


# --- 输入归一 ---------------------------------------------------------------------------------

@dataclass(frozen=True)
class _Subject:
    """一个待定级的决策主体（当前只有项目一种）+ 它匹配到的信号，全部归一成规则好读的形状。"""
    subject_id: str
    title: str
    owner_name: str
    status: str
    progress: int | None
    due_raw: str
    due: date | None
    blockers: tuple[str, ...]
    signals: tuple[dict, ...]
    unknown_fields: tuple[str, ...]


def _norm_text(v) -> str:
    return str(v).strip() if v is not None else ""


def _match_signals(project: dict, signals: list[dict]) -> tuple[dict, ...]:
    """把信号挂到项目上。三条通道，任一命中即算：

      ① `subjectId` 等于项目 id 或标题（抽取层指名道姓的情况）；
      ② person 型信号且 `subjectId` 等于项目负责人 id/姓名（负责人的处境是项目的证据）；
      ③ 项目标题在信号原文里出现（抽取层没填 subjectId 时的兜底）。

    🔴 已知盲区（写进 decision_grading_rules.md，不藏）：既没指名、正文里也没提到项目标题的
    信号**不会算到任何项目头上**——规则宁可漏，也不给全体项目无差别加码。这类盲区正是
    Avery 上调的用武之地。
    """
    pid = _norm_text(project.get("id")).lower()
    title = _norm_text(project.get("title")).lower()
    owner_id = _norm_text(project.get("ownerId")).lower()
    owner_name = _norm_text(project.get("ownerName")).lower()
    out: list[dict] = []
    for s in signals or []:
        ref = _norm_text(s.get("subjectId")).lower()
        stype = _norm_text(s.get("subjectType")).lower()
        hit = False
        if ref and (ref == pid or (title and ref == title)):
            hit = True
        elif stype == "person" and ref and (
                (owner_id and ref == owner_id) or (owner_name and ref == owner_name)):
            hit = True
        elif len(title) >= 2 and title in _norm_text(s.get("summary")).lower():
            hit = True
        if hit:
            out.append(s)
    return tuple(out)


def _to_subject(project: dict, signals: list[dict], as_of: date) -> _Subject:
    status = _norm_text(project.get("status")).lower()
    progress = project.get("progress")
    if not isinstance(progress, int) or isinstance(progress, bool):
        progress = None
    due_raw = _norm_text(project.get("dueDate"))
    due = parse_due_date(due_raw)
    blockers = tuple(b for b in (_norm_text(x) for x in (project.get("blockers") or [])) if b)
    matched = _match_signals(project, signals)

    # 🔴 未知 ≠ 0/正常。前端 057 拿这个列表渲染「文档未提及」，绝不允许渲染成 0% 或空白。
    # 只收**标量**字段：它们缺失时前端会错渲成 0% / 空串 / "正常"，是真正会骗人的三个。
    # `blockers` 是列表字段，payload 本来就只在非空时才发，"没抽到阻塞行"是一个可接受的读法，
    # 放进未知列表只会让每个健康项目都挂一条「阻塞：未知」的噪音。全空的情形由 R-NO-EVIDENCE 兜。
    unknown: list[str] = []
    if not status:
        unknown.append("status")
    if progress is None:
        unknown.append("progress")
    if due is None:
        # 含"文档写了但解析不出来"（如"月底前"）——一样按未知处理，绝不当作"还早"。
        unknown.append("dueDate")

    return _Subject(
        subject_id=_norm_text(project.get("id")) or _norm_text(project.get("title")),
        title=_norm_text(project.get("title")),
        owner_name=_norm_text(project.get("ownerName")),
        status=status, progress=progress, due_raw=due_raw, due=due,
        blockers=blockers, signals=matched, unknown_fields=tuple(unknown),
    )


# --- 关键词命中 -------------------------------------------------------------------------------

def _signal_text(s: dict) -> str:
    return f"{_norm_text(s.get('summary'))} {_norm_text(s.get('tag'))}".lower()


def _family_evidence(subject: _Subject, family: str) -> list[str]:
    """命中某关键词族的信号原文（verbatim，不转述）——前端展开时逐条给经理看。"""
    words = KEYWORD_FAMILIES[family]
    out: list[str] = []
    for s in subject.signals:
        low = _signal_text(s)
        if any(w in low for w in words):
            text = _norm_text(s.get("summary"))
            if text and text not in out:
                out.append(text)
    # blockers 行同样过关键词（阻塞原文常写着"客户投诉""等法务"）
    for b in subject.blockers:
        if any(w in b.lower() for w in words) and b not in out:
            out.append(b)
    return out


# --- 规则匹配器 -------------------------------------------------------------------------------
# 每条 RULES 里的规则在这里恰好有一个匹配器；`test_every_rule_has_a_matcher` 双向校验。
# 匹配器返回证据列表（非空 = 命中），空列表/None = 未命中。

def _m_attrition(s: _Subject) -> list[str]:
    return _family_evidence(s, "attrition")


def _m_complaint(s: _Subject) -> list[str]:
    return _family_evidence(s, "complaint")


def _m_conflict(s: _Subject) -> list[str]:
    return _family_evidence(s, "conflict")


def _m_incident(s: _Subject) -> list[str]:
    return _family_evidence(s, "incident")


def _m_watch(s: _Subject) -> list[str]:
    return _family_evidence(s, "watch")


def _m_status_blocked(s: _Subject) -> list[str]:
    return [f'status="{s.status}"'] if s.status == STATUS_BLOCKED else []


def _m_status_at_risk(s: _Subject) -> list[str]:
    return [f'status="{s.status}"'] if s.status == STATUS_AT_RISK else []


def _m_blocker_stack(s: _Subject) -> list[str]:
    return list(s.blockers) if len(s.blockers) >= BLOCKER_STACK_N else []


def _m_blocker_one(s: _Subject) -> list[str]:
    return list(s.blockers) if len(s.blockers) == 1 else []


def _m_overdue(s: _Subject, as_of: date) -> list[str]:
    if s.due is not None and s.due < as_of and s.status != STATUS_DONE:
        return [f'dueDate="{s.due_raw}"（已过 {(as_of - s.due).days} 天）']
    return []


def _m_due_soon(s: _Subject, as_of: date) -> list[str]:
    if s.due is not None and s.status != STATUS_DONE:
        left = (s.due - as_of).days
        if 0 <= left <= DUE_SOON_DAYS:
            return [f'dueDate="{s.due_raw}"（还剩 {left} 天）']
    return []


def _m_due_vs_progress(s: _Subject, as_of: date) -> list[str]:
    if s.due is None or s.progress is None or s.status == STATUS_DONE:
        return []
    if (s.due - as_of).days <= DUE_CRUNCH_DAYS and s.progress < PROGRESS_CRUNCH_PCT:
        return [f'dueDate="{s.due_raw}" / progress={s.progress}%']
    return []


def _m_progress_low(s: _Subject) -> list[str]:
    if s.progress is not None and s.progress < PROGRESS_LOW_PCT and s.status != STATUS_DONE:
        return [f"progress={s.progress}%"]
    return []


def _m_self_report_mismatch(s: _Subject) -> list[str]:
    """自报「正常」却挂着阻塞——和前端 gapDerive.ts「多看一眼」同一个口径。"""
    if s.status in STATUS_STEADY and s.blockers:
        return [f'status="{s.status}"', *s.blockers]
    return []


def _m_no_evidence(s: _Subject) -> list[str]:
    """🔴 关键字段全缺 → 需确认，**不是**可推进。"文档没说"不等于"没风险"。"""
    if not s.status and not s.blockers and not s.signals and s.progress is None and s.due is None:
        return ["（status / blockers / progress / dueDate 全部缺失，且无关联信号）"]
    return []


def _risk_free(s: _Subject) -> bool:
    """没有任何高风险族 / 待办族信号，也没有阻塞。"""
    if s.blockers:
        return False
    return not any(_family_evidence(s, fam) for fam in KEYWORD_FAMILIES)


def _m_done(s: _Subject) -> list[str]:
    return [f'status="{s.status}"'] if s.status == STATUS_DONE and _risk_free(s) else []


def _m_clear(s: _Subject) -> list[str]:
    if s.status in STATUS_STEADY and _risk_free(s):
        return [f'status="{s.status}"（无阻塞、无风险信号）']
    return []


# 需要"今天是几号"的规则单独一张表，好让 grade_project 显式把 as_of 传进去。
_MATCHERS = {
    "R-SIGNAL-ATTRITION": _m_attrition,
    "R-SIGNAL-COMPLAINT": _m_complaint,
    "R-SIGNAL-CONFLICT": _m_conflict,
    "R-SIGNAL-INCIDENT": _m_incident,
    "R-SIGNAL-WATCH": _m_watch,
    "R-STATUS-BLOCKED": _m_status_blocked,
    "R-STATUS-AT-RISK": _m_status_at_risk,
    "R-BLOCKER-STACK": _m_blocker_stack,
    "R-BLOCKER-ONE": _m_blocker_one,
    "R-PROGRESS-LOW": _m_progress_low,
    "R-SELF-REPORT-MISMATCH": _m_self_report_mismatch,
    "R-NO-EVIDENCE": _m_no_evidence,
    "R-DONE": _m_done,
    "R-CLEAR": _m_clear,
}
_DATED_MATCHERS = {
    "R-OVERDUE": _m_overdue,
    "R-DUE-SOON": _m_due_soon,
    "R-DUE-VS-PROGRESS": _m_due_vs_progress,
}

# 命中规则的展示顺序 = 规则表顺序（同级内），保证输出稳定、可 diff。
RULE_ORDER: dict[str, int] = {r.id: i for i, r in enumerate(RULES)}


# --- 输出结构（feat-057 照着接）---------------------------------------------------------------

@dataclass(frozen=True)
class RuleHit:
    rule_id: str
    grade: str
    severity: int
    title: str
    basis: str
    evidence: tuple[str, ...]

    def to_dict(self) -> dict:
        return {"rule_id": self.rule_id, "grade": self.grade, "grade_label": LABEL_ZH[self.grade],
                "severity": self.severity, "title": self.title, "basis": self.basis,
                "evidence": list(self.evidence)}


@dataclass(frozen=True)
class Decision:
    subject_type: str
    subject_id: str
    subject_title: str
    owner_name: str
    grade: str                      # 最终等级（= rule_grade，除非 Avery 合法上调）
    rule_grade: str                 # 规则算出来的等级 —— 永远保留，可对账
    matched_rules: tuple[RuleHit, ...]
    unknown_fields: tuple[str, ...]
    reason: str
    reason_source: str = "rule"     # "rule"（机械拼装，可溯源）| "avery"（模型写的人话）
    escalated: bool = False
    escalation_reason: str = ""
    downgrade_blocked: bool = False
    rejected_grade: str = ""
    review_rejected: str = ""       # "" | "missing_reason" | "downgrade" | "unknown_grade"

    @property
    def severity(self) -> int:
        return SEVERITY[self.grade]

    def to_dict(self) -> dict:
        return {
            "subject_type": self.subject_type,
            "subject_id": self.subject_id,
            "subject_title": self.subject_title,
            "owner_name": self.owner_name,
            "grade": self.grade,
            "grade_label": LABEL_ZH[self.grade],
            "severity": self.severity,
            "rule_grade": self.rule_grade,
            "rule_grade_label": LABEL_ZH[self.rule_grade],
            "rule_severity": SEVERITY[self.rule_grade],
            "matched_rules": [h.to_dict() for h in self.matched_rules],
            "unknown_fields": list(self.unknown_fields),
            "reason": self.reason,
            "reason_source": self.reason_source,
            "escalated": self.escalated,
            "escalation_reason": self.escalation_reason,
            "downgrade_blocked": self.downgrade_blocked,
            "rejected_grade": self.rejected_grade,
            "review_rejected": self.review_rejected,
        }


_UNKNOWN_LABEL = {"status": "状态", "progress": "进度", "dueDate": "到期日", "blockers": "阻塞"}


def _compose_reason(subject: _Subject, grade: str, hits: tuple[RuleHit, ...]) -> str:
    """机械拼装的兜底理由：只由等级 + 命中规则的标题构成，一个字都不是编的。

    Avery 在线时会用一句更像人话的替换它（`apply_review`），但离线 / 无 key 时前端也必须
    有话可显示——🔴 这里绝不允许出现 canned 的"看起来像分析"的句子。
    """
    top = [h.title for h in hits if h.grade == grade]
    body = "；".join(top) if top else "（无命中规则）"
    text = f"按规则判为{LABEL_ZH[grade]}：{body}。"
    if subject.unknown_fields:
        missing = "、".join(_UNKNOWN_LABEL.get(f, f) for f in subject.unknown_fields)
        text += f"（文档未提及：{missing}——未知不等于没风险。）"
    return text


def grade_project(project: dict, signals: list[dict] | None = None, *,
                  as_of: date | None = None) -> Decision:
    """给一个项目卡定级。纯函数：同样的 (project, signals, as_of) → 同样的结果，永远。

    `project` 是 `CompanyContext.project_cards()` 的一项，`signals` 是 `signal_cards()` 全量
    （本函数自己挑出与该项目相关的）。`as_of` 不传则取 `date.today()` —— 传进来才是可复现的用法，
    测试和批量调用一律显式传。
    """
    today = as_of or date.today()
    subject = _to_subject(project, signals or [], today)

    hits: list[RuleHit] = []
    for r in RULES:
        matcher = _MATCHERS.get(r.id)
        evidence = (matcher(subject) if matcher
                    else _DATED_MATCHERS[r.id](subject, today))
        if evidence:
            hits.append(RuleHit(rule_id=r.id, grade=r.grade, severity=SEVERITY[r.grade],
                                title=r.title_zh, basis=r.basis, evidence=tuple(evidence)))

    if hits:
        rule_grade = max(hits, key=lambda h: h.severity).grade
    else:
        # 兜底：规则表理论上覆盖到底（R-CLEAR / R-NO-EVIDENCE），真掉到这里说明有既非"正常"
        # 也非"全空"的中间态（如 status 是抽取层没归一的词）。🔴 一律给 需确认，不给 可推进。
        rule_grade = NEEDS_CONFIRMATION
        hits.append(RuleHit(rule_id="R-NO-EVIDENCE", grade=NEEDS_CONFIRMATION,
                            severity=SEVERITY[NEEDS_CONFIRMATION],
                            title=rule("R-NO-EVIDENCE").title_zh,
                            basis=rule("R-NO-EVIDENCE").basis,
                            evidence=("（没有任何规则命中，按信息不足处理）",)))

    hits.sort(key=lambda h: (-h.severity, RULE_ORDER[h.rule_id]))
    frozen = tuple(hits)
    return Decision(
        subject_type="project",
        subject_id=subject.subject_id,
        subject_title=subject.title,
        owner_name=subject.owner_name,
        grade=rule_grade,
        rule_grade=rule_grade,
        matched_rules=frozen,
        unknown_fields=subject.unknown_fields,
        reason=_compose_reason(subject, rule_grade, frozen),
        reason_source="rule",
    )


def grade_projects(projects: list[dict], signals: list[dict] | None = None, *,
                   as_of: date | None = None) -> list[Decision]:
    """批量定级 + 排序。顺序即前端 057「今天要决策的」的展示顺序：

    先按等级从高到低，同级按标题字典序（稳定、可复现，绝不用 dict/set 迭代序）。
    """
    today = as_of or date.today()
    out = [grade_project(p, signals, as_of=today) for p in (projects or [])]
    out.sort(key=lambda d: (-d.severity, d.subject_title, d.subject_id))
    return out


# --- Avery 的复核（只许上调）------------------------------------------------------------------

@dataclass(frozen=True)
class AveryReview:
    """Avery 对一条决策的复核。它能做的只有两件事：写那句人话理由、（带理由地）往上调。

    `grade` 留空 = 不动等级，只换文字。
    """
    reason: str = ""
    grade: str = ""
    escalation_reason: str = ""
    subject_id: str = ""


def apply_review(decision: Decision, review: AveryReview | None) -> Decision:
    """把 Avery 的复核贴到一条决策上。

    🔴 **下调一律拦死**（Danny 明文：漏报比误报贵，对方拿真文件来试）。被拦时：
    等级保持 `rule_grade`，`downgrade_blocked=True`，`rejected_grade` 记下它想判的那档，
    并且**连它那句理由一起丢弃**——那句话是为更低一档写的，贴在高一档上会自相矛盾，
    经理会看到"高风险"配一句"问题不大"。宁可退回机械理由，也不显示自相矛盾的话。

    上调必须写明 `escalation_reason`（Danny 明文"必须写明为什么"）；没写就不给调。
    """
    if review is None:
        return decision

    reason = (review.reason or "").strip()
    proposed = (review.grade or "").strip()
    why = (review.escalation_reason or "").strip()

    if proposed and proposed not in GRADES:
        return _with(decision, review_rejected="unknown_grade")

    rule_sev = SEVERITY[decision.rule_grade]
    proposed_sev = SEVERITY[proposed] if proposed else rule_sev

    if proposed_sev < rule_sev:
        return _with(decision, downgrade_blocked=True, rejected_grade=proposed,
                     review_rejected="downgrade")

    if proposed_sev > rule_sev:
        if not why:
            # 上调但没说为什么 → 不给调；那句理由仍然可以留（它不与规则等级冲突：
            # 它论证的是"更严重"，贴在较低一档上只会显得保守，不会显得自相矛盾）。
            out = _with(decision, review_rejected="missing_reason")
            return _with(out, reason=reason, reason_source="avery") if reason else out
        out = _with(decision, grade=proposed, escalated=True, escalation_reason=why)
        return _with(out, reason=reason, reason_source="avery") if reason else out

    return _with(decision, reason=reason, reason_source="avery") if reason else decision


def _with(d: Decision, **changes) -> Decision:
    return replace(d, **changes)
