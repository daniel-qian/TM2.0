# -*- coding: utf-8 -*-
"""feat-056 · 决策定级引擎（规则算等级 + Avery 写理由）。

Danny 拍板 a+b：**等级归规则、文字归 Avery；Avery 只许上调、不许下调。**
口径（关键词族 / 阈值 / 规则条目）全部在 `avery/decision_rules.py`，人类可读版在
`eval-harness/decision_grading_rules.md`。本文件只做三件事：

1. `grade_project()` —— 纯函数、零 LLM、零网络、零随机：同一份 payload + 同一个 `as_of`
   + 同一条 `timeline` 进去，等级和命中规则**逐字节一致**。时间类规则（到期日、资料新旧）
   显式吃 `as_of` / `timeline` 参数，所以"同一份文件连跑两次结果一致"是结构上成立的，
   不是碰运气。`timeline`（gap-design-0805 · B1）是这份 context 的资料上传时间轴，
   由 `build_doc_timeline()` 从 `source_documents` 建；不传则时间轴类规则不参评。
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
from datetime import date, datetime, timezone

from .decision_rules import (
    BLOCKER_STACK_N,
    CAN_PROCEED,
    DUE_CRUNCH_DAYS,
    DUE_SOON_DAYS,
    DUE_YEAR_LOOKBACK_DAYS,
    GRADES,
    HIGH_RISK,
    KEYWORD_FAMILIES,
    NEEDS_CONFIRMATION,
    PROGRESS_CRUNCH_PCT,
    PROGRESS_LOW_PCT,
    RULE_PARAMS,
    RULES,
    SEVERITY,
    STALE_EVIDENCE_DAYS,
    STATUS_AT_RISK,
    STATUS_BLOCKED,
    STATUS_DONE,
    STATUS_STEADY,
    rule,
)

__all__ = [
    "AveryReview", "Decision", "DocStamp", "DocTimeline", "RuleHit",
    "build_doc_timeline", "grade_project", "grade_projects", "apply_review", "parse_due_date",
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
# 年份省略的中文写法 —— 中文周报里 dueDate 的**常态**（"8月15日" / "8月15号" / "8月15日前"）。
# 中文月日顺序无歧义，所以只差一个年份；年份由 as_of 推断，规则见 _resolve_year。
_RE_MD_ZH = re.compile(r"(?<![\d年])\s*(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]")


def _mk(year: int, month: int, day: int) -> date | None:
    try:
        return date(year, month, day)
    except ValueError:
        return None


def _resolve_year(month: int, day: int, as_of: date) -> date | None:
    """给一个只有月/日的到期日补上年份。确定性：同一个 (month, day, as_of) 永远同一个结果。

    规则（写进 decision_grading_rules.md，客户可当场核对）：先按 `as_of` 当年算；如果算出来
    的日子已经过去超过 `DUE_YEAR_LOOKBACK_DAYS` 天，就认为文档说的是**下一年**的同一天。
    周报里写"8月15日"几乎不可能指三个月前，但很可能指下一个一月——这条规则两头都照顾到。
    """
    here = _mk(as_of.year, month, day)
    if here is None:                      # 2月30日 这种根本不存在的日子
        return None
    if (as_of - here).days > DUE_YEAR_LOOKBACK_DAYS:
        return _mk(as_of.year + 1, month, day)
    return here


def parse_due_date(text: str, *, as_of: date | None = None) -> date | None:
    """把一个自由文本 dueDate 解析成 date；认不出来返回 None（= 未知，不是"很远"）。

    支持 `2026-08-15` / `2026/8/15` / `2026年8月15日` / `2026年8月`（按当月 1 号，取**最早**
    可能日 —— 偏保守 = 偏向上调，符合"漏报比误报贵"）/ `Aug 15, 2026` / `15 Aug 2026`。
    `08/15/2026` 这种日月顺序有歧义的写法：只有当某一位 > 12（唯一解）时才认，否则判未知。

    **省略年份的中文写法（"8月15日" / "8月15号"）只在传了 `as_of` 时才认**——年份靠它推断
    （见 `_resolve_year`）。这是中文周报里最常见的写法；不认它会让每份中文文档的到期日
    都被标成"未知"，等于对着客户自己的文件说瞎话。不传 `as_of` 就老老实实返回 None，
    绝不拿 `date.today()` 在函数内部偷偷兜底（那会毁掉本模块的可复现性）。

    🔴 "月底前" / "第三季度末" / "下周五" 这类**没法定到某一天**的写法一律返回 None，
    调用方据此把它记进 `unparsed_fields`（= 文档写了、我读不准），而不是 `unknown_fields`
    （= 文档压根没写）。两者都绝不当作"还早"。
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

    # 年份省略的中文写法放在最后：上面每一条都要求写明年份，走到这里才说明文档确实没写年份。
    if as_of is not None:
        m = _RE_MD_ZH.search(t)
        if m:
            return _resolve_year(int(m.group(1)), int(m.group(2)), as_of)
    return None


# --- 资料时间轴（gap-design-0805 · B1）--------------------------------------------------------
# 「这条判断读自多久以前的资料」不需要任何新表、新字段：实体的 `source` 是 `"<source_key>:<line>"`
# （`ingest/extract.py` 拼的），而 `source_key` 正是 `SourceDocument` 的 join key，那张表上就带着
# `uploaded_at`。所以时间轴是一个字符串前缀 join，和 `registry._chunks_per_file()` 数 chunk 用的
# 是同一把切法（`rsplit(":", 1)`，source_key 自己含冒号也切不错）。
#
# 🔴 本模块不认识 `SourceDocument` 这个类型（鸭子类型：只要有 source_key / filename / uploaded_at
# 三个属性即可）。这样定级层仍然是**纯数据进、纯数据出**，离线可测，不把 ingest 层拖进来。

@dataclass(frozen=True)
class DocStamp:
    """一份上传资料在时间轴上的位置。`day` 是 `uploaded_at` 归一到 UTC 之后的**日期**。"""
    source_key: str
    filename: str
    day: date


def _uploaded_day(uploaded_at: str) -> date | None:
    """把 `SourceDocument.uploaded_at`（ISO8601，通常带 UTC 时区和微秒）折成一个 UTC 日期。

    🔴 全模块**只有这一处**做时间归一，谁要算资料年龄都得走它。理由是这是本文件第一条跨
    date/datetime 边界的规则：`as_of` 是服务端本地的 naive `date`（生产恒为 `date.today()`），
    而 `uploaded_at` 是带时区的瞬间。两处各归一一次，早晚会归出两个不同的日子。

    认不出来（空串、被截断、不是 ISO）→ `None` = **不知道**，绝不兜底成 `today` 或 `date.min`：
    前者让每份资料永远新鲜、后者让每份资料永远陈旧，两种假话各错一边。
    """
    text = str(uploaded_at or "").strip()
    if not text:
        return None
    try:
        moment = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None
    if moment.tzinfo is not None:
        moment = moment.astimezone(timezone.utc)
    return moment.date()


@dataclass(frozen=True)
class DocTimeline:
    """`source_key → DocStamp` 的只读时间轴。由 `build_doc_timeline()` 从一份 context 的
    `source_documents` 建出来，喂给定级；本身零 IO、零时钟，可离线构造。"""
    stamps: tuple[DocStamp, ...] = ()

    def newest(self) -> DocStamp | None:
        """手上**最新**的一份资料。同一天上传的多份按 source_key 取定（确定性优先于"哪份更像
        主文档"——本模块的可复现承诺不允许任何依赖字典/集合迭代序的选择）。"""
        if not self.stamps:
            return None
        return max(self.stamps, key=lambda s: (s.day, s.source_key))

    def stamp_for(self, source: str) -> DocStamp | None:
        """把一条实体出处（`"<source_key>:<line>"`）折回它那份资料；找不到 → `None`。

        找不到是**正常**情形，不是异常：手加的项目卡没有出处，历史 context 也可能没有
        `source_documents`。调用方据此不引这条出处，而不是引一个悬空的指针。
        """
        text = str(source or "").strip()
        if not text:
            return None
        by_key = {stamp.source_key: stamp for stamp in self.stamps}
        # 🔴 先按整串精确匹配，再退回"砍掉最后一段冒号"（`registry._chunks_per_file()` 的口径）。
        # 顺序不能反：客户真会把文件命名成 `2026:上半年:复盘.md`，而实体出处按构造总带 `:<行号>`
        # 后缀——先切再找，遇到这种文件名就会把 `:复盘.md` 当成行号砍掉，静默认不出这份资料。
        # 精确匹配在前是既有口径的**严格超集**：带行号的正常出处走的仍是同一条回退分支。
        if text in by_key:
            return by_key[text]
        if ":" in text:
            return by_key.get(text.rsplit(":", 1)[0])
        return None


def build_doc_timeline(source_documents) -> DocTimeline:
    """从 `CompanyContext.source_documents` 建时间轴。

    join key 用 `source_key or filename`，与 `registry.file_cards()` 数 chunk 的回退口径逐字一致
    （pre-032 的行没有 source_key）。读不出上传时间的行**整行跳过**——那是我们自己的元数据缺失，
    不该变成关于客户资料的任何断言。
    """
    stamps: list[DocStamp] = []
    for sd in source_documents or []:
        day = _uploaded_day(getattr(sd, "uploaded_at", ""))
        if day is None:
            continue
        key = _norm_text(getattr(sd, "source_key", "")) or _norm_text(getattr(sd, "filename", ""))
        if not key:
            continue
        stamps.append(DocStamp(source_key=key,
                               filename=_norm_text(getattr(sd, "filename", "")) or key,
                               day=day))
    return DocTimeline(stamps=tuple(stamps))


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
    # 🔴 与 unknown_fields **互斥**：文档确实写了、但我读不出一个能比较的值。
    # 每项是 (字段名, 文档原文)。分成两个字段是因为把它们混作一谈 = 对着客户自己的文件说
    # "文档未提及"，而他翻开周报白纸黑字写着——这份说明书的全部说服力就建立在"当场把表给他看"。
    unparsed_fields: tuple[tuple[str, str], ...]
    # --- B1 时间轴（缺席 = 这个 context 没有可用的上传时间，时间类新规则一律闭嘴）---
    # newest_doc：手上**最新**一份资料（全 context，不是这个项目自己那份，理由见 _m_stale_evidence）。
    # own_doc：这个项目读自的那份资料——**已经在时间轴里核过存在**，所以引它的出处不会是悬空指针。
    newest_doc: DocStamp | None = None
    own_doc: DocStamp | None = None
    own_source_ref: str = ""


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


def _to_subject(project: dict, signals: list[dict], as_of: date,
                timeline: "DocTimeline | None" = None) -> _Subject:
    status = _norm_text(project.get("status")).lower()
    progress = project.get("progress")
    if not isinstance(progress, int) or isinstance(progress, bool):
        progress = None
    due_raw = _norm_text(project.get("dueDate"))
    due = parse_due_date(due_raw, as_of=as_of)
    blockers = tuple(b for b in (_norm_text(x) for x in (project.get("blockers") or [])) if b)
    matched = _match_signals(project, signals)

    # 🔴 未知 ≠ 0/正常。前端 057 拿这个列表渲染「文档未提及」，绝不允许渲染成 0% 或空白。
    # 只收**标量**字段：它们缺失时前端会错渲成 0% / 空串 / "正常"，是真正会骗人的三个。
    # `blockers` 是列表字段，payload 本来就只在非空时才发，"没抽到阻塞行"是一个可接受的读法，
    # 放进未知列表只会让每个健康项目都挂一条「阻塞：未知」的噪音。全空的情形由 R-NO-EVIDENCE 兜。
    # 🔴 「文档没写」和「文档写了但我读不准」是两件事，绝不能混作一谈。前者说"文档未提及"是
    # 事实，后者说"文档未提及"是**对客户自己的文件作出的失实陈述**——他翻开周报就能当场证伪。
    # 定级方向上两者一视同仁（都不当作"还早"），只有给人看的措辞必须分开。
    unknown: list[str] = []
    unparsed: list[tuple[str, str]] = []
    if not status:
        unknown.append("status")
    if progress is None:
        unknown.append("progress")
    if due is None:
        if due_raw:
            unparsed.append(("dueDate", due_raw))   # "月底前" / "第三季度末"：写了，定不到某一天
        else:
            unknown.append("dueDate")

    # 🔴 出处键叫 `sourceRef` 不叫 `source`，是**故意**的：`signal_cards()` 里字面叫 "source"
    # 的键装的是 `source_kind`（'doc' / 'figma' 这种类型词，不是文档引用）。两种 dict 都流进
    # 本函数，重名会让"拿一个类型词去当日期比"变成一个不报错、门也全绿的静默错误。
    source_ref = _norm_text(project.get("sourceRef"))
    own_doc = timeline.stamp_for(source_ref) if timeline is not None else None

    return _Subject(
        subject_id=_norm_text(project.get("id")) or _norm_text(project.get("title")),
        title=_norm_text(project.get("title")),
        owner_name=_norm_text(project.get("ownerName")),
        status=status, progress=progress, due_raw=due_raw, due=due,
        blockers=blockers, signals=matched, unknown_fields=tuple(unknown),
        unparsed_fields=tuple(unparsed),
        newest_doc=timeline.newest() if timeline is not None else None,
        own_doc=own_doc,
        own_source_ref=source_ref if own_doc is not None else "",
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
        return [f'dueDate="{s.due_raw}"']
    return []


def _m_due_soon(s: _Subject, as_of: date) -> list[str]:
    if s.due is not None and s.status != STATUS_DONE:
        left = (s.due - as_of).days
        if 0 <= left <= DUE_SOON_DAYS:
            return [f'dueDate="{s.due_raw}"']
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


def _m_stale_evidence(s: _Subject, as_of: date) -> list[str]:
    """gap-design-0805 · B1：撑着这张卡的资料已经太久没更新了 → 需确认。

    🔴 判据取的是**全 context 最新一份**资料的上传日，不是这个项目自己那份。这一刀是为了
    可证伪性：归并是「首个非空槽胜出」（`ingest/extract.py::_dedupe_entities`），同一个项目的
    status 与 dueDate 完全可能读自两份不同的资料，而实体身上只留得下**一个** `source`。
    所以「关于这个项目、之后没读到更新的」这句话我们今天证不了——按项目自己那份算，一份
    昨晚刚传、只是没提到这个项目的周报，会让我们说出一句可当场证伪的假话。
    而「我们手上最新的一份资料也这么老了」与归并怎么洗无关，恒为真。宁可说一句证得住的话。
    （代价是命中面变粗：全 context 齐命中或齐不命中。等 T2 表单线把时间轴按人按周拉开、
    T6 让归并留下落败读数之后，这条才有条件收窄到按项目算。）

    🔴 拿不到任何上传时间（老 context、元数据缺失）→ 不命中。"不知道资料多新"绝不能变成
    "资料很旧"——那是拿我们自己的元数据缺失去给客户的文档定性。
    """
    if s.newest_doc is None:
        return []
    if (as_of - s.newest_doc.day).days < STALE_EVIDENCE_DAYS:
        return []
    lines: list[str] = []
    # 这个项目读自哪儿（ADR-0028 的出处契约，`<文档名>:<行号>`，客户可当场翻到那一行核对）。
    # 只在时间轴里真的找得到那份资料时才引——不引悬空指针。
    if s.own_source_ref:
        lines.append(f'source="{s.own_source_ref}"')
    # 判据本身：最新那份的**名字 + 上传日**。
    # 🔴 这里印的日期必须**就是**上面比较过的那个 `day`，绝不在这里再从 uploaded_at 推一次
    #    ——印一个、比另一个是本仓最经典的假话面。
    lines.append(f'newest_material="{s.newest_doc.filename}" '
                 f'uploaded_at="{s.newest_doc.day.isoformat()}"')
    return lines


def _m_self_report_mismatch(s: _Subject) -> list[str]:
    """自报「正常」却挂着阻塞——和前端 gapDerive.ts「多看一眼」同一个口径。"""
    if s.status in STATUS_STEADY and s.blockers:
        return [f'status="{s.status}"', *s.blockers]
    return []


def _m_no_evidence(s: _Subject) -> list[str]:
    """🔴 关键字段全缺 → 需确认，**不是**可推进。"文档没说"不等于"没风险"。

    返回的是一个**机器记号**，不是要上屏的句子——这条规则的证据面按定义是空的（没读到任何
    字段，就没有任何原文可引），记号只用来表达"命中了"。`_EVIDENCE_FREE_RULES` 会在建 RuleHit
    时把它抹成空 evidence，所以前端拿到的是"这条规则没有证据行"，而不是一句冒充原文的后端造句。
    """
    if not s.status and not s.blockers and not s.signals and s.progress is None and s.due is None:
        return ["@matched"]
    return []


def _m_unclassified(s: _Subject) -> list[str]:
    """占位匹配器——这条规则从不在这里命中，只登记进 `_MATCHERS` 以满足"规则表与匹配器
    一一对应"的门（`test_every_rule_has_exactly_one_matcher`）。

    真正的触发条件是"跑过一整张 RULES 表、一条都没命中"（`grade_project` 的 `else` 分支），
    这件事结构上没法在单条独立匹配器里复现——会变成把整张表在这里再判一遍。永远返回空列表；
    R-UNCLASSIFIED 唯一的出场方式就是那个手动兜底分支。"""
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
        return [f'status="{s.status}"']
    return []


# 🔴 ADR-0033 · evidence 面的语言纪律。
# evidence 里只许有两种东西，两种都与界面语言无关：
#   ① **文档原文**（信号原句 / 阻塞原句）—— 逐字引用，中文文档就是中文，英文界面下也不翻译
#      （决定 4：翻译＝编，直接违反 ADR-0018 可溯源红线）；
#   ② **字段读数**（`status="blocked"` / `dueDate="2026-07-10"` / `progress=30%`）—— 机器键 +
#      文档原文值，语言中立。
# 在此之前这里还有第三种：后端拼的中文注解（`（已过 12 天）`、`（无阻塞、无风险信号）`、
# `（status / blockers / progress / dueDate 全部缺失…）`）。它们**既不是原文也不是读数**，
# 却印在写着"下面这几行是文档原文，不是 Avery 的话"的那一节里——既是语言缺陷也是溯源缺陷。
# 全部拆掉：能进规则标题的进标题（由前端 i18n 出两种语言），进不去的（"已过 N 天"）就不说了
# ——到期日原样摆在那儿，经理自己会看日历。
#
# 这两条规则的证据面按定义为空（一条没读到任何字段，一条是"跑完整张表都没命中"），
# 匹配器返回的 `@matched` 只是"命中了"的记号，在建 RuleHit 时抹掉。
_EVIDENCE_FREE_RULES = frozenset({"R-NO-EVIDENCE", "R-UNCLASSIFIED"})


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
    "R-UNCLASSIFIED": _m_unclassified,
    "R-DONE": _m_done,
    "R-CLEAR": _m_clear,
}
_DATED_MATCHERS = {
    "R-OVERDUE": _m_overdue,
    "R-DUE-SOON": _m_due_soon,
    "R-DUE-VS-PROGRESS": _m_due_vs_progress,
    "R-STALE-EVIDENCE": _m_stale_evidence,
}

# 命中规则的展示顺序 = 规则表顺序（同级内），保证输出稳定、可 diff。
RULE_ORDER: dict[str, int] = {r.id: i for i, r in enumerate(RULES)}


# --- 输出结构（feat-057 照着接）---------------------------------------------------------------
#
# 🔴 ADR-0033 一刀切：本层**只回机器键 + 结构化字段**，一个人话句子都不发。
# 屏幕上那些句子（三档词、规则标题、"未读到：状态、进度"、"到期日写的是「月底前」"）
# 全部由前端 i18n 表按 `grade` / `rule_id` / 字段机器键渲染，zh/en 各一份。
# 删掉的字段：`grade_label` · `rule_grade_label` · 命中里的 `title`/`basis` ·
# `unparsed_fields[].field_label` · 规则版 `reason` 的句子（改回空串）。
# 不做新旧并存（D10）——并存等于留着"后端仍在产出中文"的破口，而那正是本票要铲掉的东西。

@dataclass(frozen=True)
class RuleHit:
    rule_id: str
    grade: str
    severity: int
    title: str          # 中文一行，**只喂 decision_grading_rules.md 那份客户口径说明书**，不进载荷
    basis: str          # 同上
    evidence: tuple[str, ...]

    def to_dict(self) -> dict:
        # `params` = 这条规则的模板占位符实参（阈值归后端配置，句子归前端 i18n）。
        # 没有占位符的规则发 `{}`，形状恒定，前端不用做 in 判断。
        return {"rule_id": self.rule_id, "grade": self.grade, "severity": self.severity,
                "params": dict(RULE_PARAMS.get(self.rule_id, {})),
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
    unknown_fields: tuple[str, ...]                     # 文档压根没写 → 057 显示「文档未提及」
    unparsed_fields: tuple[tuple[str, str], ...]        # 文档写了、读不准 → 显示原文 + 「读不准」
    reason: str                     # 🔴 ADR-0033：`rule` 版恒为空串，句子归前端 i18n 拼
    reason_source: str = "rule"     # "rule"（结构化事实，句子在前端）| "avery"（模型写的人话）
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
            "severity": self.severity,
            "rule_grade": self.rule_grade,
            "rule_severity": SEVERITY[self.rule_grade],
            "matched_rules": [h.to_dict() for h in self.matched_rules],
            "unknown_fields": list(self.unknown_fields),
            # 只发机器键 + 文档原文。字段名的人话（「到期日」/ "Due date"）归前端 i18n；
            # `raw` 是客户文档里原本写的那几个字，**永远原样**（ADR-0033 决定 4）。
            "unparsed_fields": [{"field": f, "raw": raw} for f, raw in self.unparsed_fields],
            "reason": self.reason,
            "reason_source": self.reason_source,
            "escalated": self.escalated,
            "escalation_reason": self.escalation_reason,
            "downgrade_blocked": self.downgrade_blocked,
            "rejected_grade": self.rejected_grade,
            "review_rejected": self.review_rejected,
        }


# 🔴 ADR-0033 拆掉的两块，留个碑，别照着旧样子加回来：
#
# ① `_FIELD_LABEL = {"status": "状态", ...}` —— 字段名的人话。现在只发机器键
#    （`unknown_fields` / `unparsed_fields[].field`），词表在 `src/shared/i18n/{en,zh}.ts`
#    的 `lite2.homeFieldStatus` 那一族，前端 `fieldLabel()` 查表。
#
# ② `_compose_reason()` —— 机械拼装那句「按规则判为高风险：X；Y。（未读到：状态、进度——
#    未知不等于没风险。）」。它本来就是**结构化事实的字符串拼接**：等级 + 命中规则标题 +
#    未读到的字段 + 读不准的字段。ADR-0033 之后这四样全部以结构化形式随载荷发下去，
#    句子由前端 `composeRuleReason()` 用 i18n 模板拼——同一句话，两种语言，一个事实源。
#    规则版决策的 `reason` 因此是**空串**（`reason_source == "rule"`）；只有 Avery 真写了
#    那句人话时 `reason` 才非空（`reason_source == "avery"`，语言由请求 locale 进 prompt 决定）。
#
# 🔴 措辞红线原地不动，只是搬了家：那句话仍然只许陈述"我读到/没读到什么"，绝不许替客户断言
# "你的文档里没有什么"——现在这条线由前端文案和 `test_no_rule_asserts_...` 一起守。


def grade_project(project: dict, signals: list[dict] | None = None, *,
                  as_of: date | None = None,
                  timeline: DocTimeline | None = None) -> Decision:
    """给一个项目卡定级。纯函数：同样的 (project, signals, as_of, timeline) → 同样的结果，永远。

    `project` 是 `CompanyContext.project_cards()` 的一项（定级这一路还额外带上 `sourceRef`，
    见 `_to_subject`），`signals` 是 `signal_cards()` 全量（本函数自己挑出与该项目相关的）。
    `as_of` 不传则取 `date.today()` —— 传进来才是可复现的用法，测试和批量调用一律显式传。

    `timeline`（B1）是这份 context 的资料时间轴，由 `build_doc_timeline(ctx.source_documents)`
    建。**不传 = 没有时间轴**，时间轴类规则一条都不命中——它仍然是纯函数，只是判据面少一块。
    """
    today = as_of or date.today()
    subject = _to_subject(project, signals or [], today, timeline)

    hits: list[RuleHit] = []
    for r in RULES:
        matcher = _MATCHERS.get(r.id)
        evidence = (matcher(subject) if matcher
                    else _DATED_MATCHERS[r.id](subject, today))
        if evidence:
            lines = () if r.id in _EVIDENCE_FREE_RULES else tuple(evidence)
            hits.append(RuleHit(rule_id=r.id, grade=r.grade, severity=SEVERITY[r.grade],
                                title=r.title_zh, basis=r.basis, evidence=lines))

    if hits:
        rule_grade = max(hits, key=lambda h: h.severity).grade
    else:
        # 兜底：规则表理论上覆盖到底（R-CLEAR / R-NO-EVIDENCE），真掉到这里说明有既非"正常"
        # 也非"全空"的中间态（如 status 是抽取层没归一的词）。🔴 一律给 需确认，不给 可推进。
        #
        # 🔴 对抗复审 fixB2：这里以前直接借用 `rule("R-NO-EVIDENCE")` 的标题/依据——但
        # R-NO-EVIDENCE 说的是"status/blockers/progress/dueDate 全部缺失"，这条分支恰恰
        # 是**那句话不成立**的情形（比如 progress=80、status 是没被归一的怪词）。真实案例：
        # 卡面印着「80%」，理由却写「没读到...进度中的任何一项」——等级判对了（需确认，
        # 不是可推进），但那句话本身是假的。给它自己的规则号/自己的措辞，不再借别人的名字。
        rule_grade = NEEDS_CONFIRMATION
        hits.append(RuleHit(rule_id="R-UNCLASSIFIED", grade=NEEDS_CONFIRMATION,
                            severity=SEVERITY[NEEDS_CONFIRMATION],
                            title=rule("R-UNCLASSIFIED").title_zh,
                            basis=rule("R-UNCLASSIFIED").basis,
                            evidence=()))   # 证据面按定义为空，见 _EVIDENCE_FREE_RULES

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
        unparsed_fields=subject.unparsed_fields,
        # ADR-0033：规则版不产出句子。前端拿 grade + matched_rules + unknown/unparsed_fields
        # 按 locale 拼出同一句话（`composeRuleReason()`）。见上面那块「拆掉的两块」的碑。
        reason="",
        reason_source="rule",
    )


def grade_projects(projects: list[dict], signals: list[dict] | None = None, *,
                   as_of: date | None = None,
                   timeline: DocTimeline | None = None) -> list[Decision]:
    """批量定级 + 排序。顺序即前端 057「今天要决策的」的展示顺序：

    先按等级从高到低，同级按标题字典序（稳定、可复现，绝不用 dict/set 迭代序）。
    `timeline` 语义同 `grade_project`：不传则时间轴类规则不参评。
    """
    today = as_of or date.today()
    out = [grade_project(p, signals, as_of=today, timeline=timeline) for p in (projects or [])]
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

    # 基线取「规则原判」和「当前等级」里更高的那个。只用 rule_grade 会漏掉一条缝：一条已被
    # 合法上调过的决策（rule_grade=可推进、grade=高风险）再复核一次，提"需确认"时算出来是
    # 相对 rule_grade 的上调，于是被采纳——等级实质从高风险掉到需确认，还不打 downgrade_blocked。
    # 那是把「下调一律硬拦」从后门走掉。当前没有调用方，但理由层一接回路就会踩到。
    rule_sev = max(SEVERITY[decision.rule_grade], SEVERITY[decision.grade])
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
