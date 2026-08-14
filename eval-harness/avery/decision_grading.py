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
    FORM_DUE_SOON_HOURS,
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
    STATUS_BADNESS,
    STATUS_BLOCKED,
    STATUS_DONE,
    STATUS_STEADY,
    rule,
)

__all__ = [
    "AveryReview", "Decision", "DocStamp", "DocTimeline", "RuleHit",
    "build_doc_timeline", "grade_project", "grade_projects", "grade_form_period",
    "FORMS_SUBJECT_TYPE", "apply_review", "parse_due_date",
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


def _uploaded_moment(uploaded_at: str) -> datetime | None:
    """把 `SourceDocument.uploaded_at`（ISO8601，通常带 UTC 时区和微秒）解析成一个 UTC 瞬间。

    🔴 **全仓只有这一处**把 `uploaded_at` 解析并归一到 UTC。`_uploaded_day` 是它的一层薄壳，
    T5 的表单回流（`ingest/form_reflow.py`，判「哪一份自述更新」）也调它。多一处 `fromisoformat`
    + `astimezone`，早晚就是两套对带/不带时区、对 `Z` 后缀的不同答案。

    认不出来（空串、被截断、不是 ISO）→ `None` = **不知道**，绝不兜底成 `now` 或 `datetime.min`：
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
    return moment


def _uploaded_day(uploaded_at: str) -> date | None:
    """`uploaded_at` → 一个 UTC **日期**（天粒度）。

    🔴 本模块的时间归一只走这一处（它自己只走 `_uploaded_moment`），谁要算资料年龄都得走它。
    理由是这是本文件第一条跨 date/datetime 边界的规则：比较的另一头是 `as_of`，一个 naive
    `date`。两处各归一一次，早晚会归出两个不同的日子——**这条预言应验过一次，见 `today_utc()`。**

    ⚠ 天粒度是**定级这条路**的口径，理由是同一批上传彼此只差微秒，用原始时间戳等于让文件遍历
    顺序当判据。表单回流那条路刻意用 `_uploaded_moment` 的原始瞬间：两份提交的 `uploaded_at`
    是员工两次真的按下提交的时刻，同一天再交一份是**新读数**，不是同一批。
    """
    moment = _uploaded_moment(uploaded_at)
    return moment.date() if moment is not None else None


def _utc_now() -> datetime:
    """本模块**唯一**的挂钟读数。别处一律不许直接 `datetime.now()` / `date.today()`。

    只有一个函数读钟，才有一个地方可以在测试里把钟钉住（`_m_form_missing` 那条「快到期了」
    也走它）。这不是为了好看：本文件开头承诺的是「零随机、同一份 payload 进去逐字节一致」，
    而一个散落各处的挂钟读数正是把那句承诺变成空话的东西。
    """
    return datetime.now(timezone.utc)


def today_utc() -> date:
    """本模块的「今天」——**UTC** 日，和 `_uploaded_day` 同一条归一线。

    🔴 这里原本是 `date.today()`，即服务端**本地**的 naive 日期，而比较的另一头 `_uploaded_day`
    归一到 **UTC**。两个时区的日期直接相减，`_uploaded_day` 的 docstring 早就写下了这个预言
    （「两处各归一一次，早晚会归出两个不同的日子」），然后没人把它关上。

    实测（2026-08-14 00:29，UTC+8 的开发机）：

        一份**此刻**上传的资料 : 2026-08-13T16:29:40+00:00
        _uploaded_day(...)     : 2026-08-13     <- UTC 日
        date.today()           : 2026-08-14     <- 本地 naive 日
        (as_of - day).days     : 1              <- 凭空老了一天

    代价落在 `R-STALE-EVIDENCE` 上：**本地日期跑在 UTC 前面的那几个小时里，所有「今天」传的
    资料都被算老一天**。UTC+8 的机器上就是每天 00:00–08:00，8/24，确定性发生，不是 flake。
    极端情形是 `test_a_freshly_claimed_sample_team_is_not_told_its_material_is_stale` 钉的那个：
    三秒前才领到示例团队、一个文件都没传过的访客，一进门就被告知手上的资料已经旧了。

    ⚠ **生产当时没中**，这点要说准：`eval-harness/Dockerfile` 是 `python:3.11-slim`、没设 `TZ`，
    容器跑在 UTC，于是本地日 == UTC 日、两边碰巧一致。所以这条一直是**潜伏**的——离 UTC 一步之遥：
    任何一个 `TZ=Asia/Shanghai`（境内部署最顺手的那个动作）就让它上线。开发机上它已经是真红的。

    选 UTC 而不是本地，理由有三，都不是审美：
      1. `_uploaded_day` 已经是 UTC，改它要动 `_uploaded_moment` 的语义，而表单回流那条路
         （`ingest/form_reflow.py`）刻意吃它的**原始瞬间**——那是员工两次真按下提交的时刻；
      2. 全仓其余每一处读钟都已经是 UTC（`ingest/ask.py`、`ingest/form.py`、`ingest/registry.py`，
         以及本文件 `grade_form_period` 自己那行 `now or _utc_now()`）。`date.today()` 是这里唯一
         的异类，不是别处的规矩；
      3. 本地时间让结果**依赖服务器装在哪儿**——同一份 context 在杭州和斯德哥尔摩定出两个等级。
         那和本文件第一句「纯函数、零随机、逐字节一致」直接冲突。

    到期日（`_m_overdue` / `_m_due_soon`）也跟着走 UTC。这是有代价的、且是**保守**的那一边：
    本地日跑在 UTC 前面的那几个小时里，一件当天到期的事会显示成「还剩 1 天」而不是「今天到期」，
    早八点后自动归位。宁可晚一点说「逾期」，也不要早一点说——后者是对着客户的文件说瞎话。
    """
    return _utc_now().date()


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


# 只有这个状态的上传真的产出了可读内容。'failed'（解析不出）/ 'empty'（解析了但零 chunk）
# 的文件**一个字都没被读到**，所以它们不算"我们读到的资料"——把它们算进时间轴，就会让
# 「最新的一份资料」指向一份从没参与过任何判断的文件，等于拿一份解析失败的扫描件冒充依据。
# 缺 `status` 属性的（pre-032 行、鸭子类型的测试替身）按默认值 'ingested' 处理。
_READABLE_DOC_STATUS = "ingested"


def build_doc_timeline(source_documents) -> DocTimeline:
    """从 `CompanyContext.source_documents` 建时间轴。

    join key 用 `source_key or filename`，与 `registry.file_cards()` 数 chunk 的回退口径逐字一致
    （pre-032 的行没有 source_key）。两类行**整行跳过**：
      · 读不出上传时间的 —— 那是我们自己的元数据缺失，不该变成关于客户资料的任何断言；
      · 没读出内容的（status 不是 'ingested'）—— 见 `_READABLE_DOC_STATUS`。
    """
    stamps: list[DocStamp] = []
    for sd in source_documents or []:
        if _norm_text(getattr(sd, "status", _READABLE_DOC_STATUS)) != _READABLE_DOC_STATUS:
            continue
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


# --- 跨资料字段冲突（gap-design-0805 · B2b）----------------------------------------------------
# T6（conflicts-record-b2a）让归并把它自己丢弃的读数记进 `ExtractionResult.conflicts`。
# 🔴 本模块照旧不认识那个类型（鸭子类型：subject_kind / subject_ref / field /
# values[].value/source/doc_key 六个属性即可）——与 SourceDocument 同一条纪律，
# 定级层保持纯数据进出、离线可测。

@dataclass(frozen=True)
class _ConflictReading:
    """冲突里的一个读数：verbatim 原值 + 读自哪份资料 + 那份资料哪天上传。

    `day is None` = 时间轴里定位不到那份资料（没时间轴、或元数据缺失）——照样上卡，
    只是 evidence 行不带 uploaded_at、也不参与任何时间方向判断。
    """
    value: str
    filename: str
    day: date | None


@dataclass(frozen=True)
class _SubjectConflict:
    """归到某个决策主体头上的一条字段冲突。evidence 行直接照 readings 渲染。"""
    field: str                            # 机器键；负责人档案的冲突带 `owner.` 前缀
    readings: tuple[_ConflictReading, ...]


def _conflicts_for(project: dict, conflicts, timeline: "DocTimeline | None"
                   ) -> tuple[_SubjectConflict, ...]:
    """把 `ExtractionResult.conflicts` 里属于这个项目的条目归一成规则好读的形状。

    两条归属通道，与 `_match_signals` 的纪律同源：
      · `subject_kind == 'project'` 且 `subject_ref` 等于项目 id —— 项目自己的字段冲突；
      · `subject_kind == 'person'` 且 `subject_ref` 等于项目负责人 id —— 负责人档案（部门等）
        在资料间对不上，作为**项目**证据参与（本模块不给人打分，person 型读数只在指向
        负责人时进来，与信号同一条红线）。字段机器键加 `owner.` 前缀，evidence 上才分得清
        `status` 是项目的、`owner.team` 是负责人的。
    🔴 已知盲区（与 `_match_signals` 同款，宁可漏）：不指向任何在场项目/负责人的冲突
    （比如某个不管项目的员工的部门对不上）**不会算到任何卡头上**。

    两道**不进场**的闸，都是"这句话对这条记录不成立"：
      · 读数不足两个非空值 —— 不构成"对不上"；
      · 所有读数出自**同一份**文档（`doc_key` 集合大小 < 2）—— T6 钉过这种形状真实存在
        （一份花名册把同一个人列两行）。规则号叫 CROSS-DOC、文案说"不同资料"，
        对同一份文档内部的分歧说这句话就是撒谎。v1 明写不覆盖，不硬塞。

    readings 按上传日升序排（旧在前、新在后，定位不到的排最后），排序稳定——
    卡面读起来就是票面那句「《旧》里读到…《新》里读到…」的顺序。
    🔴 排序丢掉了 values[0]=胜出值 的信息，是故意的：哪个值胜出，项目卡自己那格写着，
    不在证据里重复一遍（少一处口径漂移）。
    """
    pid = _norm_text(project.get("id"))
    owner_id = _norm_text(project.get("ownerId"))
    out: list[_SubjectConflict] = []
    for c in conflicts or []:
        kind = _norm_text(getattr(c, "subject_kind", ""))
        ref = _norm_text(getattr(c, "subject_ref", ""))
        if not ref:
            continue
        if kind == "project" and ref == pid:
            prefix = ""
        elif kind == "person" and owner_id and ref == owner_id:
            prefix = "owner."
        else:
            continue
        readings: list[_ConflictReading] = []
        doc_keys: set[str] = set()
        for v in getattr(c, "values", None) or []:
            value = _norm_text(getattr(v, "value", ""))
            if not value:
                continue
            doc_key = _norm_text(getattr(v, "doc_key", ""))
            stamp = timeline.stamp_for(_norm_text(getattr(v, "source", ""))) \
                if timeline is not None else None
            readings.append(_ConflictReading(
                value=value,
                # 展示名走时间轴里的 filename（与 R-STALE-EVIDENCE 的 evidence 同一口径，
                # 那边有"印 source_key 而非 filename"的变异教训）；定位不到才退回 doc_key。
                filename=(stamp.filename if stamp is not None else doc_key),
                day=stamp.day if stamp is not None else None))
            doc_keys.add(doc_key)
        if len(readings) < 2 or len(doc_keys) < 2:
            continue
        readings.sort(key=lambda r: (r.day is None, r.day or date.min))
        out.append(_SubjectConflict(field=prefix + _norm_text(getattr(c, "field", "")),
                                    readings=tuple(readings)))
    return tuple(out)


def _conflict_evidence(c: _SubjectConflict) -> list[str]:
    """一条冲突 → 每个读数一行 evidence：`<字段>="<原值>" doc="<文件名>" uploaded_at="<上传日>"`。

    与本文件既有 evidence 纪律逐条对齐：机器键 + verbatim 原值（①②类）+ 我们自己的入库日（③类，
    B1 开的那道口子，边界原文见 `_EVIDENCE_FREE_RULES` 上方那段碑文）。
    🔴 这里印的 uploaded_at 必须**就是** `_fresh_contradicts` 比较过的那个 `day`——
    印一个、比另一个是本仓最经典的假话面（R-STALE-EVIDENCE 同款红线）。
    🔴 刻意**不带** `:<行号>` 出处：T6 钉死了实体出处的行号是块级兜底、可能指向标题行
    （`test_KNOWN_LIMITATION_project_source_is_BLOCK_level_not_field_level`）。印一个行号
    就是请经理去翻一行可能什么都没写的字——文档名 + 上传日是我们今天能背书的全部。
    """
    lines: list[str] = []
    for r in c.readings:
        line = f'{c.field}="{r.value}" doc="{r.filename}"'
        if r.day is not None:
            line += f' uploaded_at="{r.day.isoformat()}"'
        lines.append(line)
    return lines


def _fresh_contradicts(c: _SubjectConflict) -> bool:
    """这条冲突够不够得着「更新的那份读到更糟」——够得着归 R-FRESH-CONTRADICTS-STALE，
    其余全部归 R-CROSS-DOC-CONFLICT（一条冲突只上一条规则，同一份证据不印两遍）。

    v1 只认最窄的、每一步都背得住的形状，四个条件缺一即让位给不看时间的那条：
      · 字段是**项目状态**——唯一有"更糟"排序的字段（`STATUS_BADNESS`，词表归一是
        `_norm_status` 的产出）。dueDate 是自由文本、team 没有方向，都排不出糟不糟；
      · 恰好**两个**读数——三份资料各说各话时，"新的那份"指谁就不唯一了；
      · 两份都定位得到上传日，且**天粒度**上严格一早一晚——同批上传彼此只差微秒，
        用原始时间戳等于让文件遍历顺序当判据（T4 交接红线）；
      · 新读数按 `STATUS_BADNESS` 严格更糟——没归一的词查表得 0，不猜方向。
    """
    if c.field != "status" or len(c.readings) != 2:
        return False
    old, new = c.readings                    # _conflicts_for 已按上传日升序排好
    if old.day is None or new.day is None or old.day == new.day:
        return False
    return STATUS_BADNESS.get(new.value, 0) > STATUS_BADNESS.get(old.value, 0)


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
    # --- B2b 跨资料冲突（缺席 = 这个 context 没有冲突记录，两条冲突规则一律闭嘴）---
    conflicts: tuple[_SubjectConflict, ...] = ()
    # --- T9 本期表单收集（gap2 #58）---
    # 🔴 **项目主体上这两格恒为 None**，而且必须恒为 None：表单是按人铸的，一张项目卡说不出
    # 「本期还差几个人没交」这件公司级的事。只有 `grade_form_period` 造的那个主体带着它们。
    # 于是 `_m_form_missing` 在 `grade_project` 的每一次全表遍历里都干净地返回 []，
    # 不是靠 if 判断绕过去的——它读的那格本来就没有值。缺省 None 让所有老调用方一字不改。
    forms: object | None = None
    # 判「快到期了」比的是**瞬间**，不是 as_of 那个日期：链接按刻建行，同一天铸的两批可以差
    # 十几个小时。显式带进主体（而不是让匹配器自己 `datetime.now()`）是为了保住纯函数性——
    # 同样的主体永远算出同样的结果，测试与回放才可复现。
    now_moment: datetime | None = None


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
                timeline: "DocTimeline | None" = None,
                conflicts=None) -> _Subject:
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
        conflicts=_conflicts_for(project, conflicts, timeline),
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

    另外两道**不命中**的闸，都是"这句话对这张卡不成立"，不是降噪：
    · 这张卡**根本不读自任何我们手上的资料**（`own_doc is None`：手加的卡 `source` 恒空，
      出处指向一份已经不在的资料也算）→ 不命中。经理一分钟前手敲进去的项目，凭什么说它
      "依据的资料 45 天没更新"？还要摆一份与它毫无关系的月报当证据。
    · 项目**自报已完成**（`status == done`）→ 不命中，与本文件另外三条时间规则同一豁免
      （`test_done_project_is_not_dragged_by_dates` 钉着这条口径）。做完了就是做完了，
      时间过去不会把它变回没做完。
    """
    if s.newest_doc is None or s.own_doc is None or s.status == STATUS_DONE:
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


def _m_cross_doc_conflict(s: _Subject) -> list[str]:
    """gap-design-0805 · B2b：不同资料对同一件事读数对不上 → 需确认。

    进场闸（读数≥2、跨≥2 份文档、归属这张卡）全部在 `_conflicts_for`；这里只做一件事：
    把够得着时间方向的冲突让给 `R-FRESH-CONTRADICTS-STALE`（`_fresh_contradicts`），
    其余逐条铺 evidence。一条冲突只上一条规则——同一份证据印两遍是给经理出阅读理解题。
    """
    lines: list[str] = []
    for c in s.conflicts:
        if _fresh_contradicts(c):
            continue
        lines.extend(_conflict_evidence(c))
    return lines


def _m_fresh_contradicts_stale(s: _Subject) -> list[str]:
    """gap-design-0805 · B2b（T4 移交）：更新上传的那份资料读到了更糟的状态 → 需确认。

    与 R-CROSS-DOC-CONFLICT **同级**（T4 交接明令「别一高一低」，理由见 decision_rules.py
    那两条规则头上的注释）。🔴 刻意**不做** done 豁免：另外几条时间规则豁免 done 是因为
    「时间流逝不会把做完变回没做完」，而这条的触发根本不是时间流逝——是一份**更新的资料
    白纸黑字读出了更糟的状态**。卡面写着 done、最新资料读到 blocked，正是最该被确认的形状；
    方向判断交给 `STATUS_BADNESS`（done 排 0，新读数是 done 时永远判不出「更糟」）。
    """
    lines: list[str] = []
    for c in s.conflicts:
        if _fresh_contradicts(c):
            lines.extend(_conflict_evidence(c))
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


def _m_form_missing(s: _Subject) -> list[str]:
    """gap2 T9（#58）· 本期常驻表单还有人没交，而最早的一条链接就要到期了。

    🔴 **项目主体永远命不中这一条**，而且不是靠一句 `if` 绕过去的：`s.forms` 在项目主体上恒为
    None（`_Subject.forms` 的注释讲了为什么表单说不出项目级的事），所以第一行就干净地返回空。
    这条规则唯一的出场方式是 `grade_form_period()` 造的那个**公司级**主体。

    判据两条都要满足，缺一不响：
      ① 本期确实还有 open 行（没交的人是行，不是缺席——铸链即建行，`form_api.list_submissions`）；
      ② 这些行里**最早**的那条到期时刻落在 `FORM_DUE_SOON_HOURS` 之内。
    为什么要第二条：链接是 7 天期，刚铸出来就喊「还差 6 人没交」等于每周有五天在催人，
    经理会学会忽略这一屏。取最早那条而不是最晚：先过期的那条才是**真的要来不及**的那条。

    ⚠ 已经过期的行不算「还差他没交」——`form_period_status` 已经把它们分到 `expired` 里去了。
    催一条今天已经打不开的链接，是给经理派一件做不成的事；那种情况该做的是重新铸链，不是催。

    证据面 = 每个没交的人一行 `person="…" expires_at="…"`。这是 ADR-0033 evidence 三类里的
    第 ③ 类（我们自己的入库读数，与 `uploaded_at="2026-06-20"` 同族）：机器键 + 我们库里那一行的
    真值，语言中立、逐字可核（同一批人就摆在资料库「谁交了」那一段里，一眼能对上）。
    🔴 这一列的**长度就是**规则文案里那个 N（见 `_form_hit`）——不另算一个会漂的第二个数。
    """
    status = s.forms
    if status is None or not status.missing or s.now_moment is None:
        return []
    deadlines = [(_uploaded_moment(iso), name) for name, iso in status.missing]
    soonest = min((m for m, _ in deadlines if m is not None), default=None)
    if soonest is None:
        # 一条到期时刻都解析不出来 → 说不出"快到期了"，闭嘴。绝不因为读不出时间就当成"快到了"
        # （那是拿一个我们并不知道的事实去打扰经理），也不当成"还早"——前者更贵，两者都不猜。
        return []
    if (soonest - s.now_moment).total_seconds() > FORM_DUE_SOON_HOURS * 3600:
        return []
    lines = []
    for name, iso in status.missing:
        moment = _uploaded_moment(iso)
        when = moment.date().isoformat() if moment is not None else ""
        lines.append(f'person="{name}" expires_at="{when}"')
    return lines


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
# 🔴 gap-design-0805 · B1 起 evidence 里多了**第三种**东西，明写在这里免得下一个人拿它当先例：
#   ③ **我们自己的入库读数** —— `uploaded_at="2026-06-20"`（那份资料进 avery.source_documents
#      的日子）。它既不是文档原句，也不是从文档里读出来的字段值：客户翻开那份 5 月月报，
#      里面一个字都没有这个日期。放行它的理由是它仍然满足这一节真正要守的两条——语言中立、
#      且可溯源到一条确定的事实（文件清单页上就有同一个日期）。
#   前端把 evidence 渲染在「文件原文 / Straight from your files」标签下，所以这一格是**有代价**的：
#   它把一条系统元数据摆进了一个说"这些来自你的文件"的位置。这条边界只开到这里为止——
#   ⚠ 任何**后端算出来的数**（"已过 62 天"、"共 3 份"）仍然不许进 evidence，那是第四种东西，
#   而且是被 ADR-0033 明令删掉过一次的那种（见上面那段「（已过 12 天）」的碑）。
#
# 下面这两条规则的证据面按定义为空（一条没读到任何字段，一条是"跑完整张表都没命中"），
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
    "R-CROSS-DOC-CONFLICT": _m_cross_doc_conflict,
    "R-FRESH-CONTRADICTS-STALE": _m_fresh_contradicts_stale,
    "R-NO-EVIDENCE": _m_no_evidence,
    "R-UNCLASSIFIED": _m_unclassified,
    "R-DONE": _m_done,
    "R-CLEAR": _m_clear,
    # T9（#58）：登记在这里是为了满足「规则表与匹配器一一对应」那道门，而且它是**真的**匹配器
    # ——`grade_project` 每张项目卡都会调它一次，只是项目主体没有 `forms` 那一格，恒返回空。
    "R-FORM-MISSING": _m_form_missing,
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
    # T9（gap2 #58）· **每次命中都不同**的那几个占位符实参，形如 `(("n", 3),)`。
    # 存成 pairs 而不是 dict：`RuleHit` 是 frozen dataclass（自动生成 `__hash__`），挂一个 dict
    # 会让它在任何一次被哈希时炸掉，而那种炸法只在某条新代码第一次去 set 里放它时才出现。
    # 参数**名**必须先登记进 `decision_rules.RULE_DYNAMIC_PARAMS`（那张表是给 i18n 契约门看的
    # 声明；`test_dynamic_params_are_declared` 守住两边不脱节）。
    dynamic_params: tuple[tuple[str, int], ...] = ()

    def to_dict(self) -> dict:
        # `params` = 这条规则的模板占位符实参（句子归前端 i18n）。两个来源合并：
        #   · `RULE_PARAMS` —— **静态阈值**，归后端配置（Danny 调 DUE_SOON_DAYS 就该跟着变）；
        #   · `dynamic_params` —— 这一次命中算出来的数（今天只有 R-FORM-MISSING 的 `n`）。
        # 没有占位符的规则发 `{}`，形状恒定，前端不用做 in 判断。
        return {"rule_id": self.rule_id, "grade": self.grade, "severity": self.severity,
                "params": {**RULE_PARAMS.get(self.rule_id, {}), **dict(self.dynamic_params)},
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
                  timeline: DocTimeline | None = None,
                  conflicts=None) -> Decision:
    """给一个项目卡定级。纯函数：同样的 (project, signals, as_of, timeline, conflicts)
    → 同样的结果，永远。

    `project` 是 `CompanyContext.project_cards()` 的一项（定级这一路还额外带上 `sourceRef`，
    见 `_to_subject`），`signals` 是 `signal_cards()` 全量（本函数自己挑出与该项目相关的）。
    `as_of` 不传则取 `today_utc()`（**UTC** 日，与资料时间轴同一条归一线——见 `today_utc()`，
    这里曾经是 `date.today()` 并因此每天有 8 小时把资料算老一天）—— 传进来才是可复现的用法，
    测试和批量调用一律显式传。

    `timeline`（B1）是这份 context 的资料时间轴，由 `build_doc_timeline(ctx.source_documents)`
    建。**不传 = 没有时间轴**，时间轴类规则一条都不命中——它仍然是纯函数，只是判据面少一块。

    `conflicts`（B2b）是 `ExtractionResult.conflicts` 全量（本函数自己挑出归这张卡的，见
    `_conflicts_for`）。**不传 = 没有冲突记录**，两条冲突规则一条都不命中，老调用方原样不受影响。
    """
    today = as_of or today_utc()
    subject = _to_subject(project, signals or [], today, timeline, conflicts)

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


FORMS_SUBJECT_TYPE = "forms"


def grade_form_period(status, *, now: datetime | None = None) -> Decision | None:
    """gap2 T9（#58）· 给**一张模板的本期收集**定级，命不中返回 None。

    `status` 是 `avery.ingest.form_autofill.FormPeriodStatus`（只读聚合，本模块不去碰 registry）。

    🔴 为什么不走 `grade_project` 的那张全表遍历，而是只跑 R-FORM-MISSING 这一条：
    那张表的其余每一条问的都是**项目**的事（status / blockers / progress / dueDate / 跨资料冲突）。
    拿一个公司级主体去跑它们，第一个响的会是 `R-NO-EVIDENCE`——「没读到状态、阻塞、进度、到期日
    中的任何一项」。那句话对这张卡是**假的**：这张卡本来就不该有那四个字段，不是"没读到"。
    ADR-0018 的红线（只说读到/没读到什么，绝不替客户断言）正是拦这种话的。
    所以这里显式只问那一条，并且把"为什么只问一条"写在这儿，免得下一个人以为是漏了。

    `now` 不传则取此刻——传进来才是可复现的用法，测试与批量调用一律显式传（同 `as_of` 的约定）。
    """
    moment = now or _utc_now()
    subject = _Subject(
        subject_id=f"forms:{status.template_id}:{status.period}",
        title=status.template_title or status.template_id,
        owner_name="", status="", progress=None, due_raw="", due=None,
        blockers=(), signals=(), unknown_fields=(), unparsed_fields=(),
        forms=status, now_moment=moment)
    lines = _m_form_missing(subject)
    if not lines:
        return None
    r = rule("R-FORM-MISSING")
    hit = RuleHit(rule_id=r.id, grade=r.grade, severity=SEVERITY[r.grade],
                  title=r.title_zh, basis=r.basis, evidence=tuple(lines),
                  # 🔴 N **就是**证据行数，不是另算一遍的第二个数——句子说差几人，底下就正好
                  # 摆着几行「谁」。两者结构上不可能对不上。
                  dynamic_params=(("n", len(lines)),))
    return Decision(
        subject_type=FORMS_SUBJECT_TYPE,
        subject_id=subject.subject_id,
        subject_title=subject.title,
        owner_name="",
        grade=r.grade, rule_grade=r.grade,
        matched_rules=(hit,),
        unknown_fields=(), unparsed_fields=(),
        reason="", reason_source="rule")


def grade_projects(projects: list[dict], signals: list[dict] | None = None, *,
                   as_of: date | None = None,
                   timeline: DocTimeline | None = None,
                   conflicts=None, forms=None, now: datetime | None = None) -> list[Decision]:
    """批量定级 + 排序。顺序即前端 057「今天要决策的」的展示顺序：

    先按等级从高到低，同级按标题字典序（稳定、可复现，绝不用 dict/set 迭代序）。
    `timeline` / `conflicts` 语义同 `grade_project`：不传则对应规则不参评。

    `forms`（T9 · #58）是本期各张模板的收集进度（`form_autofill.form_period_status()` 的产出）。
    🔴 它产出的是**公司级**卡，与项目卡一起排序、一起返回——刻意不另开一条返回通道：
    `decision_cards()` 与 `briefing()` 必须看到**同一个**列表，否则今天页的卡片和它上面那句
    「N 个值得多看一眼」又会对不上（`registry.briefing()` 那段长注释记着的旧伤）。
    不传 = 没有表单数据，这条规则不参评，老调用方一字不受影响。
    """
    today = as_of or today_utc()
    out = [grade_project(p, signals, as_of=today, timeline=timeline, conflicts=conflicts)
           for p in (projects or [])]
    for status in (forms or []):
        decided = grade_form_period(status, now=now)
        if decided is not None:
            out.append(decided)
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
