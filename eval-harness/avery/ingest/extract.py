"""Stage 2 — red-line-safe structured extraction: parsed text -> entities.

Turns `ParsedDoc`s into the entity shapes the frontend already knows (`src/data/fixtures.ts`):
  * PersonEntity   role / team / tenure / what-they-own / collaboration — QUALITATIVE ONLY.
  * ProjectEntity  status / progress? / owner / summary / blockers — work MAY be quantified.
  * SignalEntity   doc-derived signal ("12 unresolved comments", "acceptance not set"); a signal
                   pointing at a PERSON stops at situation ("she's carrying a week of change"),
                   never a negative label on the person.
  * MaterialChunk  company-doc snippet -> the vector/keyword RAG the advisor cites.

THE RED LINE lives structurally here, not just as a post-hoc scan:
  A PersonEntity has NO numeric/score field at all. The dataclass literally cannot hold a
  moodPct / capacityPct / rating / rank / tier — those attributes do not exist on it. That makes
  "a resume never becomes a person score" a property of the type, and `redline_extract.validate_
  extraction` is the AFK gate that also scans every person's free-text fields for smuggled scoring.

Extractor is pluggable (mirrors the pluggable brain):
  * HeuristicExtractor — deterministic, offline, NO model. Regex/keyword rules over the parsed
    text. This is what the AFK gate runs so the whole pipeline is green with no embedding/LLM
    service. It is intentionally conservative: it extracts what it can cite to a line and, by
    construction, emits person fields that are qualitative.
  * LLMExtractor (interface `Extractor`) — a real model does richer extraction in production.
    Whatever it returns is passed through the SAME red-line gate before it is allowed into a
    CompanyContext, so a hallucinated person-score is caught, not trusted.
"""
from __future__ import annotations

import hashlib
import os
import re
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict, dataclass, field, is_dataclass
from typing import Protocol

from .granularity import (Ruling, apply_gate, project_header_title, segment_projects,
                          strip_decoration)
from .parse import ParsedDoc

# The preset buckets _norm_team maps onto WHERE IT HONESTLY CAN; a department this startup taxonomy
# cannot express (前厅部, Growth) passes through verbatim rather than being squeezed or blanked —
# see _norm_team. NOT a closed set of the values `team` may hold: the consumer (src/lite2/teamData.ts
# `team?: string`) types it as free text and renders it as the group title. The old comment here
# claimed these "mirror the frontend Person['team'] union"; that union lives only in
# src/story/data/fixtures.ts, the old demo app, which does not consume ingest output (feat-048).
TEAMS = ("Founders", "Eng", "Product", "Design", "GTM", "Ops")

# Words that, if they appeared as a *person* attribute key, would be a red-line breach. Used both to
# keep the heuristic honest and (in redline_extract) to hard-fail any extractor's output.
FORBIDDEN_PERSON_KEYS = (
    "moodpct", "mood", "capacitypct", "capacity", "score", "scores", "scoring", "rating", "rated",
    "rank", "ranking", "ranked", "tier", "grade", "graded", "percentile", "rate", "performance",
    "potential", "risk", "flightrisk", "stars", "star",
)

# feat-029 — the same red line in Chinese. A person dict key CONTAINING any of these is a scoring
# key on a person (绩效评分 / 离职风险 / 排名 / 画像 / 潜力评级 …). Matched by substring on the
# CJK-preserving normalized key (see redline_extract.validate_person_dict), so 绩效评分 trips '评分'
# and 离职风险 trips '离职风险'. Person-QUALIFIED profiling only: '用户画像'/'客户画像' are customer
# artifacts and are NOT here (a person key would read '员工画像'/'人才画像', still tripped by '画像').
FORBIDDEN_PERSON_KEYS_ZH = (
    "评分", "打分", "得分", "评级", "定级", "分级", "评估", "排名", "排序", "画像",
    "绩效", "考核", "潜力", "情绪值", "情绪分", "产能", "工时利用", "利用率", "饱和度",
    "离职风险", "流失风险", "末位淘汰", "淘汰", "分数",
    # feat-029 round 2 — star ratings / ranking labels on a person. Traditional keys are folded to
    # Simplified before this substring match (redline_extract.validate_person_dict), so 星級/名次/評比
    # trip these too. (末流/垫底/差评 rank synonyms are caught as CONTENT by the advice gate, so they
    # stay out of the KEY list to keep it narrow.)
    "星级", "名次", "评比",
)


# --- entity shapes ----------------------------------------------------------------------------
# NOTE: PersonEntity deliberately has NO numeric field EXCEPT the one sanctioned slot below.

# rich-align-0722 · issue 03 — 人员负载/情绪·自述槽。人身数字红线（07-21 解禁 + 07-22 拍板）的
# 结构化表达：合法的人身数字**只能活在这个槽里**，且 caliber(口径)+source(出处) 必填。散落在 person
# 其他字段上的自由数字键仍被 redline_extract 全禁（self_report 不在 _person_text_fields 扫描面里，
# 也不是 FORBIDDEN_PERSON_KEYS——moat 靠结构成立，不靠新检测）。存储恒有自述数据（不随开关重铸，
# 内容寻址只看文件）；**投影随开关**（registry.team_cards 读 AVERY_ALLOW_PERSON_SCORING）。
_MOOD_SELFREPORT_MAP = {
    "如常": "steady", "正常": "steady", "平稳": "steady", "还好": "steady", "steady": "steady",
    "偏紧": "stretched", "紧张": "stretched", "有点紧": "stretched", "略紧": "stretched",
    "stretched": "stretched",
    "吃紧": "strained", "很紧": "strained", "超负荷": "strained", "透支": "strained",
    "strained": "strained",
}


def norm_mood_selfreport(raw: str | None) -> str:
    """情绪自述词表: 如常|偏紧|吃紧(+近义/英文) → steady/stretched/strained。词表外 → '' → 走 other。"""
    return _MOOD_SELFREPORT_MAP.get((raw or "").strip().lower(), "")


@dataclass
class SelfReportLoad:
    """负载自述（0..100）。value 是本人报的工作负载，caliber 恒『本人自述』，source=所在文档名:行。"""
    value: int
    caliber: str = "本人自述"
    source: str = ""


@dataclass
class SelfReportMood:
    """情绪自述。value=定性枚举 steady/stretched/strained/other；other 时 valueRaw 回显文档原词。"""
    value: str
    caliber: str = "本人自述"
    source: str = ""
    valueRaw: str = ""


def read_selfreport_load(raw: object, source: str) -> "SelfReportLoad | None":
    """一个负载读数的**唯一**判据：整数 0..100，越界即拒（不 clamp——absent≠none），读不出就 None。

    gap2 T11 —— 提出来是因为现在有两条路要用同一把尺：
      · `_selfreport_from_lines`（**上传的 06 表**那条路）—— 客户手写的周报里没有字段描述可读，
        只能靠正则去认 label 里的「××自述」，认到之后拿这里的判据读值；
      · `form_reflow.selfreport_from_marked_fields`（**表单提交**那条路）—— 哪一格是负载由
        `FormField.self_report` 这个结构化标记说了算，值仍旧走这里。
    识别方式可以有两种（一种认文案、一种认结构），**读数的判据只能有一把**：抄一份的下场是
    哪天上下界改了，两条路上的人卡会给出两个不同的数，而且没有一条门会红。
    """
    m = re.match(r"^(\d{1,3})\s*%?$", str(raw if raw is not None else "").strip())
    if not m:
        return None
    iv = int(m.group(1))
    return SelfReportLoad(value=iv, source=source) if 0 <= iv <= 100 else None


def read_selfreport_mood(raw: object, source: str) -> "SelfReportMood | None":
    """一个情绪读数的唯一判据：词表内 → 枚举；词表外 → `other` + 原词逐字回显（与里程碑/状态同
    姿态）；空 → None。两条路共用，理由同 `read_selfreport_load`。"""
    val = str(raw if raw is not None else "").strip()
    if not val:
        return None
    enum = norm_mood_selfreport(val)
    return SelfReportMood(value=enum or "other", source=source,
                          valueRaw="" if enum else val[:40])


@dataclass
class PersonSelfReport:
    """一个人的自述槽 {load?, mood?}。任一子槽缺 = 该维度文档未提及（absent≠none，前端不编 0）。"""
    load: "SelfReportLoad | None" = None
    mood: "SelfReportMood | None" = None

    def __post_init__(self) -> None:
        # asdict() round-trips (pg_registry) hand back plain dicts — coerce so consumers always see
        # dataclasses, never a raw dict. Production reads contexts back from Postgres, so this is the
        # load-bearing path, not a test convenience.
        if isinstance(self.load, dict):
            self.load = SelfReportLoad(**self.load)
        if isinstance(self.mood, dict):
            self.mood = SelfReportMood(**self.mood)


@dataclass
class PersonEntity:
    """A person card — QUALITATIVE ONLY. No number ever lives here (red line: no blood bar).

    THE ONE EXCEPTION is `self_report` (rich-align-0722/03): a sanctioned slot for the person's OWN
    reported load/mood, projected only when the operator has unblocked person scoring. It is a typed
    slot, not a free field, so the extraction red line (which scans _person_text_fields and forbidden
    KEYS) never sees it — the moat holds by construction, and a stray number on any other field is
    still rejected."""
    id: str
    name: str
    # 差距战役 T5/A2 · 工号（01 表「人员ID *」那一列 / 铸表单链时经理选人带上的那个 id）。
    # 归并的**第一把尺**：`_dedupe_entities` 有工号时按工号认人，姓名只做兜底——酒店里同名
    # （张伟/王芳）与花名（小周/周姐）都是常态，按名归并会把两个人并成一张卡。
    # 🔴 它是一把 join key，不是人卡上的一句话：**刻意不进** `as_facts_lines()`（不进 facts.md /
    # 议事室引用面）、**刻意不进** `team_cards()` 投影（前端一个消费者都没有）。也因此它**不在**
    # `redline_extract._person_text_fields` 的扫描面里——扫描面是「会被当成对这个人的描述读出来
    # 的自由文本」，而工号是 `MKT-001` 这种标识符，与 `PersonEntity.id` 同类。
    person_id: str = ""
    role: str = ""
    # FREE TEXT since feat-048 BUG-4, not a closed set: a department the TEAMS taxonomy cannot
    # express ('别墅销售组', 'Growth') reaches the page verbatim — see _norm_team, which maps onto a
    # TEAMS bucket only where that is honest. The consumer types it as free text and renders it as
    # the group title (src/lite2/teamData.ts `team?: string`).
    team: str = ""                              # the stated department, mapped where honest; "" if unknown — never guessed hard
    tenure: str = ""                            # free text: "18 months", "joined 14 months ago"
    owns: list[str] = field(default_factory=list)        # what they own / ship (qualitative)
    collaboration: list[str] = field(default_factory=list)  # who they work with / how
    source: str = ""                            # provenance: "<filename>:<line>" for a cite
    # rich-align-0722/03 — the ONE sanctioned numeric slot; None when the docs never self-reported.
    # DELIBERATELY out of as_facts_lines(): self-report never enters facts.md / the advisor's recall
    # path (the frozen engine stays byte-identical); it reaches the UI only via team_cards projection.
    self_report: "PersonSelfReport | None" = None
    # rich-align-0722/06 · 人员手编 CRUD（ADR-0028）. Additive, mirror ProjectEntity: both default to the
    # pre-06 shape so every extraction path stays byte-identical until a MANUAL write touches them.
    #   archived — 停用标记（软删可逆，绝不物理删除）；team_cards() 跳过 archived=True，archived_people_cards()
    #     单独投给页尾折叠区。
    #   provenance — 字段级出处 side-car：{field:{origin:'doc'|'manual', source, updated_at}}. 手编字段置
    #     origin='manual'/source='手动编辑'. 🔴 self_report **绝不**经手编通道产生（人身数字只能来自文档
    #     自述通道，写端点禁键→422），故 provenance 只覆定性字段（name/role/team/tenure/owns/collaboration）。
    archived: bool = False
    provenance: dict = field(default_factory=dict)
    # issue #87 · 实体血缘 —— 「这张卡来自哪几份文件、每一格是哪一份给的」。形状与两条不变式写在
    # 文件下半段「#87 · 实体血缘」一节（`_init_lineage` 上面那段长注释），**别在这里再抄一份**。
    # 🔴 它刻意**不在** `redline_extract._person_text_fields` 的扫描面里：装的是文档名与出处行
    # （`旺季排班协调纪要.md:12`），与 `source` / `person_id` 同类，不是「会被当成对这个人的描述
    # 读出来的自由文本」。
    lineage: dict = field(default_factory=dict)

    def __post_init__(self) -> None:
        # Coerce a dict (pg_registry asdict round-trip) into the dataclass; see PersonSelfReport.
        if isinstance(self.self_report, dict):
            self.self_report = PersonSelfReport(**self.self_report)
        _init_lineage(self, "person")

    def as_facts_lines(self) -> list[str]:
        """Render this person as line-addressable company-memory facts (qualitative sentences)."""
        bits = [f"{self.name} — {self.role}".strip(" —")]
        if self.team:
            bits[0] += f" ({self.team})"
        out = [bits[0] + "."]
        if self.tenure:
            out.append(f"{self.name}: {self.tenure}.")
        for o in self.owns:
            out.append(f"{self.name} owns/works on: {o}.")
        for c in self.collaboration:
            out.append(f"{self.name} — collaboration: {c}.")
        return out


# rich-align-0722 · issue 01 — project-level risk (PRD A1/A2). This is a PROJECT attribute
# (schedule / scope / resource), NEVER a person score: `risk`/`离职风险`/`流失风险` stay in the
# person 禁键表 (FORBIDDEN_PERSON_KEYS*) and are gated on people only. A project may carry risk the
# same way it may carry progress — R2: quantify work, never a person.
_RISK_LEVEL_MAP = {
    "高": "high", "中": "medium", "低": "low",
    "high": "high", "medium": "medium", "med": "medium", "low": "low",
}


def norm_risk_level(raw: str | None) -> str:
    """A2 词表: 高|中|低 + high|medium|low → high/medium/low. 词表外 → '' (整行不抽)."""
    return _RISK_LEVEL_MAP.get((raw or "").strip().lower(), "")


@dataclass
class ProjectRisk:
    """PRD A1: {level: high|medium|low, reason?}. reason 省略时为空串（投影层缺席不发）。"""
    level: str
    reason: str = ""


def parse_risk_value(text: str) -> "ProjectRisk | None":
    """A2 语法: `高/雨季无备选场地`（等级 + 可选原因，`/` 或 `——` 分隔）。词表外 → None（整行不抽）。"""
    body = (text or "").strip()
    # 等级与原因以 / ／ —— — 分隔；原因可省。非贪婪取第一个分隔符。
    m = re.match(r"^(.*?)\s*(?:[/／]|——|—)\s*(.+)$", body)
    if m:
        level_raw, reason = m.group(1), m.group(2)
    else:
        level_raw, reason = body, ""
    level = norm_risk_level(level_raw)
    if not level:
        return None
    return ProjectRisk(level=level, reason=reason.strip()[:180])


# rich-align-0722 · issue 02 — 里程碑（PRD A1/A2 第 3 行）。项目实体的一个列表字段，不是独立项目。
_MILESTONE_STATUS_MAP = {
    "已完成": "done", "完成": "done", "done": "done", "complete": "done", "completed": "done",
    "进行中": "active", "进行": "active", "active": "active", "in progress": "active", "ongoing": "active",
    "受阻": "blocked", "阻塞": "blocked", "blocked": "blocked", "stuck": "blocked",
    "未开始": "upcoming", "待开始": "upcoming", "upcoming": "upcoming", "planned": "upcoming",
    "not started": "upcoming",
}
# 会终结里程碑列表收集的字段标签（撞到下一标签即止，别把后续字段吞进列表）。
_FIELD_LABEL_STOP = re.compile(
    r"^(?:里程碑|milestones?|负责人|主负责人|项目负责人|责任人|牵头人|负责|状态|自报状态|当前状态|"
    r"项目状态|进展|进度|完成度|完成率|风险|风险等级|风险级别|risk|截止|到期|交付|阻塞|阻碍项|阻碍|"
    r"卡点|风险点|概述|摘要|目标|简述|进展摘要|owner|lead|dri|status|due|deadline|summary|overview)"
    r"\s*[：:]", re.I)


def norm_milestone_status(raw: str | None) -> str:
    """A2 词表: 已完成/进行中/受阻/未开始(+英文) → done/active/blocked/upcoming。词表外 → '' → 走 other。"""
    return _MILESTONE_STATUS_MAP.get((raw or "").strip().lower(), "")


@dataclass
class ProjectMilestone:
    """PRD A1: {name, status}. status ∈ done|active|blocked|upcoming|other；other 时 statusRaw 保留文档原词。"""
    name: str
    status: str
    statusRaw: str = ""


def milestones_from_lines(lines: list[str]) -> "list[ProjectMilestone]":
    """A2 语法多行解析：`里程碑：` 标签行后连续 `- 名称（状态）` 列表行；空行/下一标签行/非列表行即止。
    词表外状态 → status='other' + statusRaw 原样回显（不替客户改写措辞，与 status 的 other 同哲学）。"""
    out: list[ProjectMilestone] = []
    i, n = 0, len(lines)
    while i < n:
        s = strip_decoration(lines[i].strip())
        if re.match(r"^(?:里程碑|milestones?)\s*[：:]", s, re.I):
            j = i + 1
            while j < n:
                item = strip_decoration(lines[j].strip())
                if not item:
                    break
                if _FIELD_LABEL_STOP.match(item):
                    break
                body = item.lstrip("-*•・ ").strip()
                mm = re.match(r"^(.+?)\s*[（(]\s*([^）)]+?)\s*[）)]\s*$", body)
                if not mm:
                    break
                name = mm.group(1).strip()[:80]
                status_raw = mm.group(2).strip()
                status = norm_milestone_status(status_raw)
                out.append(ProjectMilestone(name=name, status=status or "other",
                                            statusRaw="" if status else status_raw[:40]))
                j += 1
            i = j
            continue
        i += 1
    return out[:12]


@dataclass
class ProjectEntity:
    """A project card. Work MAY be quantified (progress %) — that is not a person score."""
    id: str
    title: str
    ownerId: str = ""
    ownerName: str = ""
    status: str = ""                            # on-track / at-risk / blocked / done (if stated)
    progress: int | None = None                 # 0..100 if the doc states it, else None (R2: don't invent)
    dueDate: str = ""
    summary: str = ""
    blockers: list[str] = field(default_factory=list)
    dependsOn: list[str] = field(default_factory=list)
    risk: ProjectRisk | None = None             # rich-align-0722/01: {level, reason?} if stated, else None
    milestones: list[ProjectMilestone] = field(default_factory=list)  # rich-align-0722/02: 缺席=空列表
    source: str = ""
    # rich-align-0722/05a · 真 CRUD（ADR-0028）. Additive, both default to the pre-05a shape so every
    # extraction path (01/02, heuristic + LLM) is byte-identical until a MANUAL write touches them.
    #   archived — 软删标记（可逆，绝不物理删除）；project_cards() 投影时跳过 archived=True 的项目，
    #     archived_project_cards() 单独投给折叠区。
    #   provenance — 字段级出处 side-car：{field: {origin: 'doc'|'manual', source, updated_at}}. 未列
    #     的字段=doc 出处（source=本实体 self.source）；手编字段置 origin='manual', source='手动编辑'.
    #     value 仍活在实体本字段（不双存），前端读实体值 + provenance[field] 出处。
    archived: bool = False
    provenance: dict = field(default_factory=dict)
    # issue #87 · 实体血缘。人卡那一格的项目孪生——同一个形状、同一套不变式，说明只住在
    # `_init_lineage` 上面（ONE DEFINITION：两处各写一份注释就是下一次口径漂移的种子）。
    lineage: dict = field(default_factory=dict)

    def __post_init__(self) -> None:
        # pg_registry stores asdict(self); the DB read (_entity -> ProjectEntity(**payload)) hands the
        # nested fields back as plain dicts. Coerce them so consumers always see the typed dataclasses
        # (mirrors PersonEntity/self_report) — else `self.risk.level` / `ms.status` is an attribute
        # access on a dict and raises on the PERSISTED read path (a demo claim / any re-open of a
        # stored company). The in-memory extraction path already builds the objects, so the offline
        # suite (`not needs_db`) never sees it — this coercion is the load-bearing production path.
        if isinstance(self.risk, dict):
            self.risk = ProjectRisk(**self.risk)
        self.milestones = [
            ProjectMilestone(**m) if isinstance(m, dict) else m for m in self.milestones]
        # #87：血缘的播种放在**强转之后**——`risk`/`milestones` 在强转前是 dict/list-of-dict，
        # 播种要按「这一格说话了吗」判在场，两种形状下答案必须是同一个。
        _init_lineage(self, "project")

    def as_facts_lines(self) -> list[str]:
        head = f"Project '{self.title}'"
        if self.ownerName:
            head += f" (owner: {self.ownerName})"
        st = f" status {self.status}" if self.status else ""
        pr = f", progress {self.progress}%" if self.progress is not None else ""
        out = [f"{head}:{st}{pr}.".replace(": .", ".")]
        if self.summary:
            out.append(f"{self.title}: {self.summary}")
        if self.risk:
            rk = f"{self.title} — risk {self.risk.level}"
            out.append(f"{rk}: {self.risk.reason}" if self.risk.reason else rk)
        for ms in self.milestones:
            label = ms.statusRaw or ms.status
            out.append(f"{self.title} — milestone: {ms.name} ({label})")
        for b in self.blockers:
            out.append(f"{self.title} — blocker: {b}")
        return out


@dataclass
class SignalEntity:
    """A doc-derived signal. If subjectType == 'person' the summary STOPS at situation (red line):
    it describes what she is carrying, never a judgment/label/score of her."""
    id: str
    source_kind: str                            # figma / feedback / task / manual / doc
    subjectType: str                            # 'person' | 'project' | 'task'
    subjectRef: str                             # entity id or name the signal is about
    summary: str
    tag: str = ""
    source: str = ""

    def as_facts_lines(self) -> list[str]:
        return [f"Signal ({self.subjectType}) on {self.subjectRef}: {self.summary}"]


@dataclass
class MaterialChunk:
    """A company-material snippet for the RAG store (what the advisor cites)."""
    id: str
    text: str
    source: str = ""                            # "<filename>:<line>"
    doc_kind: str = "company"


# rich-align-0722/08 · playbooks 方法卡（PRD D）. SOP 文档的 `## 方法：<标题>` 小节 → 只读方法卡。
# 与 materials 并列的确定性结构轴，不含任何人身评分（不进 validate_extraction 的 person/signal 面）。
_METHOD_HEADER_RE = re.compile(r"^方法\s*[：:]\s*(.+)$")
_APPLIES_LABEL_RE = re.compile(r"^(?:适用范围|适用|applies\s*to|applies)\s*[：:]\s*(.+)$", re.I)
_TAGS_LABEL_RE = re.compile(r"^(?:标签|tags?)\s*[：:]\s*(.+)$", re.I)


@dataclass
class MethodCard:
    """PRD D: {title, description, tags}. 从 SOP `## 方法：` 小节抽取——适用行=description、
    标签行=tags（、分隔，复用 _OWNS_SPLIT_RE）；要点列表卡内不展开（留将来详情态）。只读产物，无 CRUD。"""
    title: str
    description: str = ""
    tags: list[str] = field(default_factory=list)
    source: str = ""


# 差距战役 T6/B2a · 跨文档字段冲突 —— 归并不再吃掉矛盾。
#
# 病灶（design-options.md §B2）：冲突信息**在归并那一刻就被吃掉了**。`_dedupe_entities` 对同一个人
# 的同一个格子「保留第一个非空」，花名册说「周雅婷 / 市场推广部」、周报说「周雅婷 / 前厅部」，合并
# 后只剩一个，**输的那个读数连同它的出处一起消失**——没有任何下游还有机会知道两份资料对不上。
# 这里不新写比较器，只让归并把**它自己丢掉的东西**记下来。
#
# v1 收窄到「确定性可比」的少数字段，且只报**两边都非空且完全不相等**的字符串。数值类（人数/进度）
# 一律不做：口径歧义大、假阳性高。同义不同写（「传菜组」vs「传菜」vs「前厅-传菜」）是已知的假阳性
# 来源，v1 不做归一化，交给 T7 卡面上的「可能只是叫法不同」关闭出口。
#
# 🔴 ADR-0033：这里只出**机器键**（field='team'）+ **verbatim 原值**，一个中文句子都不拼。
# 句子归前端 i18n（T7 的活）。
_CONFLICT_FIELD_ALLOWLIST: dict[str, tuple[str, ...]] = {
    "person": ("team",),                      # 部门/团队
    "project": ("status", "dueDate"),         # 项目状态 / 到期日
}

# 票面 v1 点名四个字段，上面只落地了三个。**第四个（人员在职状态）今天没有落脚点**：PersonEntity
# 通篇没有任职状态这个格子（见上面的 dataclass），`_ZH_HEADER_MAP` 也不认「任职状态」——合伙人
# 《标准管理信息填写表单》01 表确实有这一列（在职/试用期/待离职，make-intake-xlsx.py:97），但它从
# 表格走到人卡的那条路还没修，位置兜底只读到 cells[3]（司龄）为止，第 7 列根本够不着。
#
# 所以这里**不**在上面的表里放一个指向不存在字段的条目：那种条目是个静默 no-op，跑起来永远零命中，
# 在报告里却读作「四个字段都覆盖了」。改成一条会说话的门——`test_employment_status_has_no_home_yet`
# 断言 PersonEntity 至今没有这个格子；哪天 T1/T5 把它加上，那条门立刻变红并指回这里说「该把
# 'person' 那一行补上了」。不可达就明写不可达。
_CONFLICT_FIELD_WITHOUT_A_HOME = "人员在职状态"


def doc_key_of(source: str) -> str:
    """从 `"<文档名>:<行>"` 的出处串里切出**文档名**——即 `SourceDocument.source_key` 的那个 key。

    ONE RULER（feat-048 round 1 的老教训）：这个表达式在仓库里本来已经**手抄了两遍**——
    `pipeline.py` 的 `chunk_counts` 与 `registry.py._chunks_per_file`（文件清单的每文件块数就是按它
    归的）。T6 需要第三处，于是把它提成一个函数，那两处改成调它。**判据必须逐字符一致**：它决定
    「这条读数算哪份文档的」，一旦漂移，冲突卡引用的文档和清单上数块数的文档就会是两份不同的东西。
    所以这里刻意**不加** `.strip()` 之类的"顺手改进"——那会让新旧两种口径对带空白的出处给出不同答案。

    用 rsplit 取**最后**一个冒号：文档名自己带冒号时（Windows 路径、带冒号的中文标题）仍然切对。
    没有冒号就整串当文档名，空串照原样返回——绝不编一个不存在的文档名出来。
    """
    src = source or ""
    return src.rsplit(":", 1)[0] if ":" in src else src


@dataclass
class ConflictValue:
    """冲突里的**一个**读数：值 + 出处行 + 文档名。value 是 verbatim 原值，不做归一化。"""
    value: str
    source: str = ""                            # "<文档名>:<行>"，与实体的 source 同一形状
    doc_key: str = ""                           # 文档名，doc_key_of(source) 的产物


@dataclass
class FieldConflict:
    """两份及以上的资料，对同一主体的同一字段，给出了完全不相等的读数。

    `subject_ref` 是**活下来那条实体的 id**（人卡/项目卡就是按它作键的），不是姓名——姓名不在这里
    重复一遍，T7 顺着 id 去卡上取就行（少一处 verbatim 副本，也少一处口径漂移）。

    `values[0]` 恒为**胜出**的那个读数（即最终写在实体上的值），其后依次是被丢弃的读数，按文档到达
    顺序。三份资料各说一样就是三条 value。
    """
    subject_kind: str                           # 'person' | 'project'
    subject_ref: str                            # 活下来那条实体的 id
    field: str                                  # 机器键：'team' | 'status' | 'dueDate'
    values: list[ConflictValue] = field(default_factory=list)

    def __post_init__(self) -> None:
        # pg 往返回来是普通 dict（pg_registry 存 asdict、回读 FieldConflict(**payload)）——强转成
        # dataclass，否则消费方 `v.doc_key` 是在 dict 上取属性，只在**持久化**那条路上炸。
        # 与 PersonEntity.self_report / ProjectEntity.risk 同一张方子（rich-align-0722 的血教训）。
        self.values = [ConflictValue(**v) if isinstance(v, dict) else v for v in self.values]


@dataclass
class ExtractionResult:
    people: list[PersonEntity] = field(default_factory=list)
    projects: list[ProjectEntity] = field(default_factory=list)
    signals: list[SignalEntity] = field(default_factory=list)
    materials: list[MaterialChunk] = field(default_factory=list)
    playbooks: list[MethodCard] = field(default_factory=list)  # rich-align-0722/08: SOP 方法卡（缺席=空）
    # feat-054 — the granularity gate's audit trail: one Ruling per project candidate, kept AND
    # demoted, each citing the rule and document line behind the call. Populated by extract_docs;
    # an extractor's own per-doc result leaves it empty. NOT merged (see merge below).
    granularity: list[Ruling] = field(default_factory=list)
    # T6/B2a — 归并时被丢弃的读数。**只有 `_dedupe_entities` 往这里写**，而它一整轮抽取只跑一次
    # （extract_docs 里 apply_gate 之后、_link_owners 之前），所以单个 extractor 的 per-doc 结果这
    # 里恒为空——与 `granularity` 同一个道理，同样**不进 merge()**。
    conflicts: list[FieldConflict] = field(default_factory=list)

    def merge(self, other: "ExtractionResult") -> "ExtractionResult":
        # `granularity` is intentionally NOT concatenated: merge() folds together partial results
        # from before the gate has run, and the gate assigns the finished list once, post-merge.
        # `conflicts` is NOT concatenated for the same reason (see the field's comment): cross-doc
        # reconciliation happens once, after every merge() has already run.
        self.people += other.people
        self.projects += other.projects
        self.signals += other.signals
        self.materials += other.materials
        self.playbooks += other.playbooks
        return self


class Extractor(Protocol):
    """Pluggable extraction backend (heuristic offline / LLM in prod). Output is always gated."""
    def extract(self, doc: ParsedDoc) -> ExtractionResult: ...


# --- helpers ----------------------------------------------------------------------------------

# Whitespace with a Han character on BOTH sides — i.e. COLUMN PADDING, not a word separator
# (feat-048 round 3, H2). Chinese does not space words, so whitespace between two Han characters is
# a layout artifact: a roster pads 「孙　浩」with U+3000 to align it against 「李明轩」. Between Latin
# words the same whitespace IS a separator and must stay one, or 'Jo Anna' and 'Joanna' would become
# the same colleague — hence the TWO-SIDED lookaround rather than a blanket strip.
#
# That lookaround is also what makes the English contract safe BY CONSTRUCTION rather than by
# measurement: an ASCII string contains no Han character, so this pattern cannot match anywhere in
# one. _slug and _person_key both apply it, and both are byte-stable on ASCII as a result.
# (U+3000 is matched by `\s` — unicode-aware on str patterns — and is NOT itself inside [一-鿿];
# both verified rather than assumed.)
_HAN_PAD_RE = re.compile(r"(?<=[一-鿿])\s+(?=[一-鿿])")


def _slug(text: str, prefix: str) -> str:
    """Stable id from a name/title. MUST stay a pure function of `text` — no counters, no call
    ordering, no hashes-of-position: `_link_owners` re-derives a person's id from her name alone
    (`by_name`, below), so two calls with the same text must always agree.

    THE CHARACTER CLASS IS LORE, READ BEFORE TOUCHING IT (feat-048).
    This used to be `[^a-z0-9]+`, which is ASCII-only: every Han character fell outside the class,
    became '_', got shaved by .strip('_'), emptied the string and fired the 'x' fallback — so
    '陈思雨' '李明轩' '周雅婷' '孙浩' ALL became 'u_x'. 39 people, 1 id; every person card opened the
    same colleague. It survived 42 features because no Han character had ever entered a name field
    (the seed is *_EN.xlsx and both stub transports use pinyin), i.e. the gate was ASCII in disguise.

    `[\\W_]` — not the more obvious `[^\\w]` — is deliberate, and the difference is the whole point:
      * On str patterns Python 3's `\\w` is unicode-aware by default (no re.UNICODE needed), so
        `\\W` already lets Han/accented Latin/Cyrillic through. That is the fix.
      * But `\\w` also counts '_' as a word character, so a bare `[^\\w]+` would STOP folding
        underscores that sit next to a space or punctuation: 'Roadmap_ Q3' -> 'p_roadmap__q3'
        instead of 'p_roadmap_q3'. That is a byte-level change to ENGLISH ids, which the existing
        evidence rests on. Adding '_' back into the class restores the old folding exactly.
    So `[\\W_]` == "the old [^a-z0-9], plus unicode letters and digits" and nothing else.

    ON ASCII THIS IS AN IDENTITY, NOT A STATISTIC. After `.lower()`, `\\w` == [a-z0-9_], so
    [\\W_] == complement([a-z0-9_]) | {_} == complement([a-z0-9]) == the old class, character for
    character. Verified exhaustively over all 128 ASCII codepoints: 0 membership mismatches. The
    fuzz below only corroborates it; the proof is what makes the English contract safe.

    Measured (feat-048 round 2) — the numbers are meaningless without the POOL, which is why the
    two earlier figures in this comment's history (22,650 and 222,541) could not be reproduced and
    three verifiers independently got 23,765 / 24,754 / 57,587 instead:
        pool [A-Za-z0-9 _-.] (66 symbols, uniform), length uniform 1..24, inputs filtered to those
        containing at least one '_', seed 48, n = 300,000
      -> `[\\W_]+` vs the old `[^a-z0-9]+`:     0 differences (0.0%)  — as the proof above requires
      -> `[^\\w]+` vs the old `[^a-z0-9]+`: 25,924 differences (8.6%) — why the obvious fix is wrong
    test_cjk_identity.py pins both halves of this contract.

    HAN PADDING IS REMOVED FIRST (feat-048 round 3, H2) — and this closes a hole that ROUND 3 ITSELF
    OPENED, which is why it lands here rather than in a follow-up ticket. Widening _HAN_NAME_RE to
    accept 「孙　浩」made a padded name EXTRACTABLE for the first time; before that it was dropped at
    the door and never reached _slug, so the defect below was unreachable and no gate covers it:
        _slug('孙　浩') == 'u_孙_浩'   !=   _slug('孙浩') == 'u_孙浩'
    _dedupe_entities keeps the FIRST-SEEN record, so 孙浩's id flipped with DOCUMENT ORDER — measured,
    both ways, on the same two rosters:
        spaced roster first   -> ('u_孙_浩', '孙　浩')
        unspaced roster first -> ('u_孙浩',  '孙浩')
    English never had this problem: `[\\W_]+` folds a whitespace RUN into ONE '_', so 'Lena Park' and
    'Lena  Park' both give 'u_lena_park'. Han was strictly worse than English until this line, and
    padding is a COLUMN-LAYOUT artifact — it must not reach an identity. This also keeps _slug in
    agreement with _person_key, which removes the same padding for the same reason (one ruler).

    ON ASCII THE HAN STRIP IS A NO-OP, BY CONSTRUCTION AND BY MEASUREMENT. _HAN_PAD_RE requires a Han
    character on BOTH sides of the whitespace, and an ASCII string contains none, so it cannot match:
    the English contract above is preserved exactly, 'Roadmap_ Q3' -> 'p_roadmap_q3' included.
    Verified over all 128 ASCII codepoints (0 mismatches) and by fuzz against the pre-round-3 _slug
    (pool [A-Za-z0-9 _-.], length 1..24, seed 48, n = 300,000 -> 0 differences).
    """
    s = re.sub(r"[\W_]+", "_", _HAN_PAD_RE.sub("", text or "").lower()).strip("_")
    return f"{prefix}_{s[:32] or 'x'}"


# --- normalization keys (feat-048) -------------------------------------------------------------
# ONE definition each, shared by llm_extract._build (within-document dedup) and _dedupe_entities
# (cross-document dedup). Do NOT inline a second copy: the two key shapes below already drifted
# apart once (people fold whitespace only, projects also fold _ and -), and a hand-copied third
# variant is how within-doc and cross-doc dedup silently start disagreeing about who is who.
#
# These key on the NAME/TITLE, never on the id: `_slug` truncates at 32 chars, so two different long
# titles can share an id — keying on the id would merge two genuinely different projects into one.

def _person_key(name: str) -> str:
    """Identity key for a person. Han padding REMOVED, then whitespace-folded, case-folded.

    THE HAN STEP IS HALF OF feat-048 ROUND 3's H2, AND IT IS WHY H2 IS NOT A ONE-REGEX FIX. Widening
    _HAN_NAME_RE to accept 「孙　浩」without this line does not merely fail to help — it MANUFACTURES a
    duplicate, which is strictly worse than the bug it fixes. Measured under exactly that naive fix:
        people == [('u_孙_浩', '孙　浩'), ('u_孙浩', '孙浩')]      # two cards, one man
    because folding \\s+ COLLAPSES a whitespace run to one space, it does not REMOVE it:
        _person_key('孙　浩') == '孙 浩'  !=  _person_key('孙浩') == '孙浩'
    Today that duplicate is invisible only because 孙　浩 is dropped by the shape rule before he can
    collide — round 2's dedup gate is passing on a corpse, so it would not have caught this either.
    Both halves have to land together; test_sun_hao_is_one_person_across_spacing_and_zh_rosters_H2
    asserts PRESENT and SINGULAR at once for that reason.

    WHY REMOVE RATHER THAN FOLD, AND ONLY BETWEEN HAN: whitespace between Han characters is COLUMN
    PADDING (U+3000 aligning 「孙　浩」against 「李明轩」), not a word separator — Chinese does not
    space words. Between Latin words it IS a separator and must stay a separator, or 'Jo Anna' and
    'Joanna' would merge into one colleague. So the removal is scoped to a space with Han on BOTH
    sides, and everything else still folds exactly as before.

    THE ENGLISH CONTRACT IS UNTOUCHED BY CONSTRUCTION, not by measurement: the substitution requires
    a Han character on either side of the whitespace, and an ASCII string has none, so the regex
    cannot match anywhere in it — 'Lena  Park' -> 'lena park', byte-for-byte as before.

    Deliberately NOT punctuation-folded (unlike _project_key): a person's name is not a slug, and
    aggressive folding starts merging people who merely look alike. Known and accepted limitation:
    two DIFFERENT colleagues who share a name (张伟, 王芳 — far likelier in Chinese than English)
    merge into one card. Splitting them needs a real identity signal (email/employee id), which lite
    does not have; name-only is the same rule llm_extract._build has always used within a document.
    """
    text = _HAN_PAD_RE.sub("", name or "")
    return re.sub(r"\s+", " ", text.lower()).strip()


def _person_id_key(person_id: str) -> str:
    """差距战役 T5/A2 —— 工号的归一（`PersonEntity.person_id` → 归并用的键）。空 = 这份资料没说工号。

    折**全部**空白（不只是 Han 之间的），因为工号不是名字：`MKT-001` 与 `MKT- 001` 是同一个工号被
    Excel 换行/粘贴弄脏了，中间那个空格没有任何语义。大小写也折（`mkt-001` == `MKT-001`）。
    标点**不折**——`MKT-001` 与 `MKT_001` 在客户那边完全可以是两个不同的编号体系，替客户判定
    它们相等，就是拿两个人的卡赌一条我们没有证据的规则。
    """
    return re.sub(r"\s+", "", (person_id or "")).lower()


def _project_key(title: str) -> str:
    """Identity key for a project. Folds whitespace AND _ / - so 'Core-Flow' == 'core flow'."""
    return re.sub(r"[\s_\-]+", " ", (title or "").lower()).strip()


def _signal_key(subject_type: str, subject_ref: str, summary: str) -> tuple[str, str, str]:
    """Identity key for a signal: a LITERAL-CLONE key, on purpose.

    SignalEntity has no count/strength/weight field, so a repeated signal cannot mean "louder" — it
    renders as two identical cards, i.e. noise. But two documents PHRASING the same risk differently
    produce different keys and both survive, which is the behaviour we want: exact clones collapse,
    genuine restatements do not. Real reinforcement ("3 docs said this") is a schema change
    (occurrences: list[str]), not a dedup rule.

    Must be computed BEFORE _link_owners rewrites subjectRef from a name to an id — extract_docs
    already orders it that way.
    """
    return (
        (subject_type or "").strip().lower(),
        (subject_ref or "").strip().lower(),
        re.sub(r"\s+", " ", (summary or "").lower()).strip(),
    )


_ROLE_WORDS = (
    r"manager|lead|director|designer|engineer|developer|researcher|technologist|architect|"
    r"analyst|scientist|producer|owner|partner|executive|coordinator|specialist|strategist|"
    r"writer|marketer|ops|qa|prototyper|founder|cto|ceo|cpo|vp|head"
)
_ROLE_RE = re.compile(rf"\b((?:senior |lead |principal |staff |junior )?[A-Z][a-z]+ )?({_ROLE_WORDS})\b", re.I)

_TENURE_RE = re.compile(
    r"\b(\d+\+?\s*(?:years?|yrs?|months?|mos?))\b"
    r"|joined\s+[\w ]{0,20}?\b(\d+\s*(?:years?|months?)\s+ago)"
    r"|(\d+\s*(?:years?|months?))\s+(?:on the team|of tenure|at )",
    re.I)

# --- Chinese roster column headers (feat-049) --------------------------------------------------
# ONE LIST, TWO CONSUMERS. These words are needed in two places that must never disagree:
#   * _canon_header maps a header CELL onto the canonical key _people_from_roster looks up, so the
#     roster is read by what its header SAYS rather than by column position.
#   * _NOT_NAME (below) must contain every one of them, or the header ROW becomes a person card —
#     feat-039's "No." bug in Chinese.
# So _NOT_NAME is BUILT from this dict's keys rather than repeating them. feat-048 round 1's lesson
# was that duplicated identity/normalisation rules drift apart silently, and this pair would drift in
# both directions with nothing to notice: teaching the extractor 「岗位」without teaching the
# stop-list ships a colleague named 「岗位」; the reverse reads her column by position again.
#
# THE VALUES ARE KEYS THE EXTRACTOR ACTUALLY LOOKS UP, and that constraint is gated
# (test_the_zh_header_map_only_targets_keys_the_extractor_actually_reads_ONE_RULER). Mapping a column
# onto a key nothing reads is worse than not mapping it: the column is canonicalised into silence,
# and the next reader sees a mapping and assumes it works.
#
# THE OMISSIONS ARE THE DESIGN, so they are named rather than left to be re-derived:
#   * 负责人/負責人 is NOT here. 「负责」is what a person owns; 「负责人」is WHO owns it — a name
#     column in a roster, an owner column in a project table. Mapping it to 'owns' would file a
#     person's name as the thing she works on. It stays a plain stop-word, where it already was.
#   * 职责/職責 is NOT here, and that is symmetry rather than oversight: its ASCII sibling
#     'responsibilities' is on _NOT_NAME too but is NOT in _people_from_roster's owns lookup
#     (`owns|focus|projects`). Teaching Chinese a column English does not read would make the two
#     languages disagree about the same table. 负责 ≈ owns, 职责 ≈ responsibilities; both languages
#     read the first and neither reads the second.
#   * 入职时间/入職時間 is NOT mapped to tenure. It is a hire DATE ("2020-03-01"), while
#     PersonEntity.tenure is a duration in free text ("3 年", "joined 14 months ago"). 司龄/工龄 are
#     durations and are mapped; a date is a different fact wearing a similar hat.
# Simplified + Traditional throughout (a Sanya hotel takes HK/TW paperwork too).
_ZH_HEADER_MAP: dict[str, str] = {
    "姓名": "name", "名字": "name", "员工姓名": "name", "員工姓名": "name",
    "职位": "role", "職位": "role", "职务": "role", "職務": "role",
    "岗位": "role", "崗位": "role", "职称": "role", "職稱": "role",
    "部门": "team", "部門": "team", "团队": "team", "團隊": "team",
    "司龄": "tenure", "司齡": "tenure", "工龄": "tenure", "工齡": "tenure",
    "负责": "owns", "負責": "owns", "主要负责": "owns", "主要負責": "owns",
    "负责事项": "owns", "負責事項": "owns", "负责项目": "owns", "負責項目": "owns",
    "项目": "projects", "項目": "projects",
    # 差距战役 T5/A2 —— 工号列。合伙人《标准管理信息填写表单》01 表的「人员ID *」（示例 MKT-001，
    # 「全表不可重复……在其他所有表里都要用到」，make-intake-xlsx.py:92-94），加上它自己的说明文字
    # 里用的叫法「工号」，以及两者的繁体。**逐字，不放宽**：
    #   * 「人员」单独一个词**故意不在**这里——中文名册里「人员」这一列装的常常是姓名，把它映成
    #     工号会让整张表认不出人（而且它会被自动折进 _NOT_NAME，连姓名列都一起废掉）。
    #   * 大小写两版都列出来，因为 `_canon_header` 的直查发生在 `.lower()` 之前（键必须逐字命中）。
    "人员ID": "person_id", "人員ID": "person_id",
    "人员id": "person_id", "人員id": "person_id",
    "工号": "person_id", "工號": "person_id",
}

# The name-column headers, DERIVED (never hand-listed — see above). Substring-searched over the whole
# header row, which is the direct analogue of the ASCII `\bname\b` row search rather than a looser
# rule: Han has no word boundaries for `\b` to find, so 「员工姓名 | 职位」can only be reached by
# substring. It buys the same thing `\bname\b` buys for 'Full Name | Role' — the row is recognised,
# and the cell that did the recognising is canonicalised separately.
_ZH_NAME_HEADER_RE = re.compile("|".join(w for w, k in _ZH_HEADER_MAP.items() if k == "name"))

# Everything that is NOT a Han character. Used to reduce a BILINGUAL header cell (「姓名 Name」) to
# its Han half. A five-star hotel's roster copies its bilingual department signage, so 「姓名 Name |
# 职位 Title | 部门 Department」is the norm here, not a curiosity (Sanya_Bilingual_Roster.md).
# On an ASCII cell this yields "", which is why the bilingual step cannot touch English.
_NON_HAN_RE = re.compile(r"[^一-鿿]")


def _canon_header(cell: str) -> str:
    """A roster header cell -> the canonical key _people_from_roster looks up ('role', 'team', ...).

    This REPLACES the bare `c.strip().lower()` that built the header list, and on an ASCII cell it
    IS that expression, character for character — BY CONSTRUCTION, not by measurement, which is what
    lets the English contract survive a rule that changes how every roster is read:
      * every key of _ZH_HEADER_MAP CONTAINS A HAN CHARACTER, so an ASCII cell can never hit the map
        (it used to be "is Han"; T5's 「人员ID」/「人員id」 carry an ASCII tail, and the weaker claim is
        the one the identity actually needs — pinned by test_every_zh_header_key_contains_han);
      * _HAN_PAD_RE needs a Han character on BOTH sides of the whitespace (see _slug);
      * the bilingual step reduces the cell to its Han characters, which for ASCII is "" — falsy, so
        the lookup is skipped entirely rather than merely missing.
    Deliberately NO English aliases ('position' -> role, 'department' -> team). They would be an
    improvement to English behaviour, and English behaviour does not move in this round; a header
    cell the map does not know keeps passing through as its own lower-cased self, exactly as today.

    THE ASCII IDENTITY IS PROVEN, and the fuzz only corroborates the proof above:
        all 128 ASCII codepoints x 4 cell shapes (bare / embedded / doubled / padded): 0 mismatches
        fuzz vs `c.strip().lower()`, pool [A-Fa-f0-9 _-.#/], len 0..24, seed 49, n = 300,000:
            0 differences
    """
    text = _HAN_PAD_RE.sub("", (cell or "").strip())
    if text in _ZH_HEADER_MAP:
        return _ZH_HEADER_MAP[text]
    han = _NON_HAN_RE.sub("", text)
    if han and han in _ZH_HEADER_MAP:
        return _ZH_HEADER_MAP[han]
    return text.lower()


def _is_roster_header_row(row: str) -> bool:
    """Does this row NAME the columns, rather than hold a colleague?

    The ASCII branch is UNCHANGED and stays first — it is a row-level `\\bname\\b` search, loose on
    purpose ('Full Name | Role' must be recognised), and 42 features rest on exactly its behaviour.
    The Han branch is added beside it, never in place of it, and is gated on a NAME column
    specifically (not on any recognisable header word) for the same reason English is: a row of
    「项目 | 状态 | 负责人」is a project table, not a roster, and must keep falling through.
    """
    if re.search(r"\bname\b", row, re.I):
        return True
    return bool(_ZH_NAME_HEADER_RE.search(row))


def _strip_table_frame(ln: str, bars: str = "|") -> str:
    """GFM 标准表格行的边框竖线（`| 姓名 | 部门 |` 首尾那两根）→ 各去一根，内侧的一根不动 (#61)。

    没有这一步，标准 markdown 表格在 roster / 自述两条腿上都是**零命中且全静默**：
    `"| 周雅婷 | MKT |".split("|")` 的 cells[0] 是空串，`_looks_like_name('')` 为假，整行被当成
    「首格没填」丢掉——文件显示已读取、briefing 说 0 people，读起来像文档里本来就没有名册。
    而「把表格从别处复制成 markdown 再传」恰恰是最自然的动作（GFM 产出首尾都有竖线）。

    判据是**第 0 列就是竖线**，不是「strip 后以竖线开头」，这一字之差是安全边界而非洁癖：
    parse.py 的三个结构化生产者（docx/xlsx/csv）都用 `" | ".join(cells)` 造行，首格为空时产出
    ` | 周雅 | …` ——以**空格**开头。这种行今天被静默丢弃（首格空 ≠ 有人），而且必须继续被丢弃：
    值在第二列，那是 role/team 的位置，「客房部经理」这类 3~5 个汉字的岗位值恰好过
    _looks_like_name，一旦被顶进 cells[0] 就是 feat-039「No.」那类幽灵人卡。顶格判据让本函数
    对三个生产者的输出**构造上是 no-op**（join 的行首要么是首格内容要么是空格，永远不是竖线），
    代价是缩进 1~3 格的 GFM 表格照旧不认——GFM 允许缩进，但「缩进一格的表格行」与「首格为空的
    join 行」在字节上不可区分（` | a | b` 两读皆通），宁可漏（同 granularity.apply_gate 的取舍）。

    只各剥一根，空格子语义保位：`| 周雅 | | 前厅部 |` 中间的空格子还是空格子；`|| a |` 剥完剩
    `| a`，首格是空格子。尾侧竖线**不单独剥**——`周雅 | MKT |` 是 join 对「末格为空」的合法产出，
    它只在首竖线在场时跟着去掉。转义竖线 `\\|`、对齐语法 `:---:` 不在本函数职责内（票面明确不做；
    分隔行 `---` 靠 _looks_like_name 挡，不靠这里）。
    """
    if not ln or ln[0] not in bars:
        return ln
    body = ln[1:]
    tail = body.rstrip()
    if tail and tail[-1] in bars:
        return tail[:-1]
    return body


# Separators inside a single roster cell that lists several things ('a; b' / 「甲、乙」).
# 、(U+3001 IDEOGRAPHIC COMMA) is the point: enumerating a list is its ONLY job in Chinese — it is
# not a sentence comma — so 「客房夜床服务复核、布草间盘点」is unambiguously two things a colleague
# owns, and the ASCII-only `[;,]` rendered it as one run-on blob on her card. ；/， are the
# full-width forms of the two separators already here, widened with them because '「a, b」 splits but
# 「a，b」does not' is a distinction with nothing behind it; ，thereby inherits `,`'s known ambiguity
# (a sentence comma is not always a separator) rather than introducing a new one.
# ON ASCII THIS IS A NO-OP BY CONSTRUCTION: the three added code points are outside ASCII, so this
# class and the old `[;,]` partition an ASCII string identically. (Corroborated, not established, by
# fuzz: pool [A-Fa-f0-9 _-.#/;,], len 0..24, seed 49, n = 300,000 -> 0 differences in split output.)
_OWNS_SPLIT_RE = re.compile(r"[;,；，、]")

# STOP words for names — header cells / labels that are not people.
#
# THIS SET IS THE SOURCE OF TRUTH FOR BOTH EXTRACTION PATHS — edit it here and nowhere else.
# The heuristic reads it via _looks_like_name/_han_name_ok; the LLM path reads it via
# llm_extract._not_a_person (with _INDEX_TOKEN_RE below, which carries 序号/编号). A word added here
# is enforced on both. feat-048's round-2 follow-up wired that up after the two lists — kept in
# sync BY HAND — drifted apart in both languages: the LLM's copy had no Chinese at all, and was also
# missing ~18 English labels this set had grown (date/dept/designation/index/manager/roster/...).
#
# feat-039 (readiness §2-G2): the heuristic used to accept "No." (a common roster INDEX column header)
# as a person, so a degraded/keyless extraction rendered a fake exec card named "No." while /health
# claimed llm. That is the bug this set was born for; the Chinese entries below are the same bug in
# the first customer's language.
_NOT_NAME = {
    "name", "role", "team", "email", "tenure", "title", "person", "people", "member", "members",
    "roster", "directory", "project", "owner", "status", "notes", "department", "manager",
    # index / numbering column headers (the "No." bug) + common label cells:
    "no.", "no", "s.no", "s.no.", "sr", "sr.", "sl", "sl.", "sn", "s/n", "id", "index", "seq", "#",
    "background", "responsibilities", "current responsibilities", "profile", "total", "designation",
    "dept", "dept.", "date", "phone", "n/a", "na", "none", "unknown", "tbd",
    # feat-048 round 2 — the SAME stop-list in Chinese, and it is load-bearing rather than
    # decorative. Once _looks_like_name accepts Han (below), a Chinese roster's header row is
    # indistinguishable from its name column BY SHAPE: 「姓名」is exactly two Han characters and so
    # is the real colleague 「孙浩」, so no length/charset rule can separate them — only this list
    # can. Without it, widening for Han re-creates feat-039's "No." bug in Chinese and ships a
    # colleague called 「姓名」.
    #
    # THE COLUMN HEADERS THEMSELVES ARE NO LONGER LISTED HERE — they are folded in from
    # _ZH_HEADER_MAP at the bottom of this literal, because feat-049 needs the same words to also map
    # a header cell onto a canonical key, and two hand-kept copies of one list is the drift feat-048
    # round 1 already paid for. What stays below is everything that is a Chinese label but NOT a
    # mappable column: 负责人 (a name, not a thing owned), contact/index columns nothing reads, and
    # the summary/placeholder cells.
    #
    # HISTORICAL NOTE, because it was true for two rounds and is now false: this list used to be the
    # heuristic's ONLY defence against a Chinese header row, since _people_from_roster built its
    # `header` list only when row 0 matched `\bname\b` (ASCII) and so never ran its
    # `cells[0] in _NOT_NAME` guard on a Chinese document. feat-049 taught the header detector Han
    # (_is_roster_header_row), so that structural guard is live again and this list is now the
    # SECOND of two defences rather than the only one. It is not thereby less important: the guard
    # only fires on row 0 of a table, while _looks_like_name is what protects every other line of
    # every other document (banners, resume headers — see the round-3 block below).
    # Simplified + Traditional (a Sanya hotel takes HK/TW paperwork too); .lower() is a no-op on Han.
    # 「工号」「工號」曾经手列在这里；T5/A2 把它们教给了 _ZH_HEADER_MAP（→ person_id），于是它们
    # 从下面这行**移到**了那张表里，照旧被自动折进本集合（见本 literal 末尾的 | set(_ZH_HEADER_MAP)）。
    # 留两份抄本就是 feat-048 round 1 付过学费的那种漂移。
    "负责人", "負責人", "邮箱",
    "郵箱", "电话", "電話", "手机", "手機", "状态", "狀態", "备注", "備註",
    "日期", "入职", "入職", "入职时间", "入職時間", "性别", "性別", "年龄", "年齡", "合计", "合計",
    "总计", "總計", "小计", "小計", "未知", "无", "無", "暂无", "暫無", "待定", "其他", "简历",
    "履历", "履歷", "个人简历", "個人履歷", "职责", "職責", "主要职责", "主要職責",
    # feat-048 round 3 (H5b) — DOCUMENT BANNERS, not column headers. Round 2 populated the list
    # above from a ROSTER's header row and stopped there; the string that actually leads a Chinese
    # document is the confidentiality banner, and it is 4 Han characters, so the shape rule accepts
    # it as a name. Measured on round-2 code: _looks_like_name('内部资料') is True, and
    # Zhang_Wei_Resume_ZH.md ingested as people == [('u_内部资料', '内部资料')] — 张伟 the 餐饮总监
    # replaced by a colleague called "Internal Material". That is feat-039's "No." bug reborn in
    # Chinese, INSIDE the rule round 2 added to prevent it: _people_from_resume scans the first six
    # lines and takes the first name-shaped thing, and the banner leads the file.
    # Reachability is layout-dependent (the banner must stand ALONE on a line; written inline as
    # 「… · 内部资料 · 请勿外传」 the interpunct is not in _people_from_resume's split set, so the whole
    # line is tested as one string and fails the shape rule harmlessly) — but the over-acceptance
    # itself is unconditional, and a banner line followed by a blank is ordinary ZH typography.
    "内部资料", "內部資料", "请勿外传", "請勿外傳", "机密文件", "機密文件", "机密", "機密",
    "绝密", "絕密", "秘密", "保密", "内部文件", "內部文件", "内部", "內部", "制表说明", "製表說明",
    "制表", "製表", "制表人", "製表人", "填表说明", "填表說明", "注意事项", "注意事項",
    "免责声明", "免責聲明", "版权所有", "版權所有", "仅供参考", "僅供參考", "草稿", "附件",
} | set(_ZH_HEADER_MAP)   # feat-049: ONE list — see _ZH_HEADER_MAP. Never re-type these by hand.

# A real Chinese personal name, SEGMENT-WISE: runs of Han separated by optional internal whitespace
# ('孙　浩' / '欧阳　菲'). This does NOT try to be a name ORACLE: length is provably not one
# (「姓名」== 2 chars == 「孙浩」), so _NOT_NAME above is what actually separates a colleague from a
# label, and this only says "the right shape".
#
# WHY SEGMENT-WISE AND NOT `^[一-鿿\s]{2,5}$` (feat-048 round 3, H2) — the obvious one-character edit
# is BOTH unsafe and a non-fix, measured both ways:
#   * Non-fix: whitespace eats the length budget, so 「欧阳　菲」(5 chars incl. the space) stays
#     rejected — the very compound-surname case H2 is about.
#   * Unsafe at any budget: it says nothing about WHERE the space is, so it would admit any
#     Han/space soup that fits.
# The segments are what carry the rule, because each one can be checked against _NOT_NAME
# independently — which is the ONLY thing that keeps 「姓名 职位」out (see _looks_like_name).
#
# U+3000 IS THE POINT, NOT A TYPO. Padding a two-character name with an IDEOGRAPHIC SPACE to align it
# against a three-character name in the same column is standard Chinese roster typography. Round 2
# unified the identity ruler on _person_key (which folds \s+) and justified that work with exactly
# this convention — then shipped `^[一-鿿]{2,4}$`, which forbids internal whitespace and threw those
# names away at the door, so the ruler it was unified with was never reached. Both fixes were in the
# tree; the path they shared was dead. `\s` and str.split() are unicode-aware on str patterns, so
# both U+3000 and U+0020 are handled, and U+3000 is NOT inside [一-鿿] (verified).
_HAN_SEG = "[一-鿿]"
_HAN_NAME_RE = re.compile(rf"^{_HAN_SEG}{{1,5}}(?:\s+{_HAN_SEG}{{1,5}})*$")

# Han characters in a personal name, ignoring padding. 2 = 孙浩; 5 = 买买提艾力 (feat-048 round 3,
# H5): Uyghur/Mongolian/Kazakh transliterated names run to five Han characters as a matter of course
# and are ordinary Chinese citizens' legal names. Round 2's {2,4} dropped them.
_HAN_NAME_MIN, _HAN_NAME_MAX = 2, 5

# Function words — particles, adverbs, negations. THE discriminator that lets the bound move to 5.
#
# Length ALONE cannot go to 5: measured, `{2,5}` turns 「本周很顺利」/「项目已完成」/「大家辛苦了」/
# 「这周没问题」into colleagues. What separates those from 「买买提艾力」is not length but that each
# carries a function word (很/已/了/没), and Chinese personal names do not contain function words.
#
# EVERY ENTRY IS CHECKED AGAINST 百家姓 AND AGAINST GIVEN-NAME USE — a function word that is also a
# surname (or an ordinary given-name morpheme) would reject a REAL name, which is the one failure
# this list must not have, and it fails SILENTLY: the colleague is simply never extracted. So the
# list stays SHORT and boring rather than thorough. Deliberately EXCLUDED after checking:
#   于 (于洋), 和 (和平), 过, 都, 是, 太, 尚 (尚雯婕) — all real, if sometimes rare, SURNAMES.
#   其 (陈其美), 又, 更, 最, 每, 此, 该, 仍 — used, or plausibly used, as GIVEN-name morphemes.
# The four the fixtures actually turn on are 很/已/了/没; the rest are close cousins with the same
# non-name character. When in doubt an entry was LEFT OUT: a missed phrase is bounded by position
# (below), while a rejected name is a person who vanishes.
#
# THIS IS NOT A COMPLETE ORACLE AND IS NOT CLAIMED AS ONE. A 5-character function-word-free noun
# phrase — 「宴会动线图」— is NOT distinguishable from 「买买提艾力」by any rule at this layer: both are
# five content morphemes, and a 百家姓 gate fails too (买 is a rare surname, but 买买提 is phonetic
# Uyghur, not a Han surname, so the gate would reject the real name it exists to admit). No fixture
# asserts 「宴会动线图」, because a gate no honest rule can satisfy gets weakened later, and a weakened
# gate is worse than an absent one. The residual is bounded by POSITION, not shape: _looks_like_name
# only ever sees a table row's cells[0] and a resume's first six lines.
_HAN_FUNCTION_WORDS = frozenset("很已了没不也就还的地着请勿别")

# A bare index/numbering token ("No.", "S.No", "序号", "编号", "#3") is never a person.
_INDEX_TOKEN_RE = re.compile(r"^(?:no|s\.?\s*no|sl|sr|sn|seq|id|#\d*|序号|编号|序號|編號)\.?$", re.I)


def _han_name_ok(token: str) -> bool:
    """Does a Han-shaped token (already matched by _HAN_NAME_RE) read as a PERSON?

    Three tests, and the ORDER of the first two is the same design as _looks_like_name's: the
    stop-list decides, the shape rule only proposes.

      1. EVERY SEGMENT against _NOT_NAME — this is what makes internal whitespace safe to allow.
         A SPACED header PAIR is a string no upstream guard can catch: _people_from_roster's
         `cells[0] in _NOT_NAME` guard tests the whole cell, and 「姓名 职位」is not on the list (nor
         is its concatenation 「姓名职位」) — only the per-segment test below rejects it. Measured:
         without this, 「姓名 职位」/「部门 司龄」/「职位 部门」/「姓名 部门 司龄」all become colleagues
         and the roster grows a teammate called 「姓名 职位」. Per-SEGMENT is what closes it, and it
         closes it by rule rather than by example.
      2. The de-padded whole against _NOT_NAME, so a padded label 「姓　名」cannot slip past (1) by
         splitting a listed word in half.
      3. Function words (see _HAN_FUNCTION_WORDS) — what permits the length bound to reach 5 for
         「买买提艾力」without 「本周很顺利」coming with it.
    """
    segments = token.split()
    if any(s.lower() in _NOT_NAME for s in segments):
        return False
    bare = "".join(segments)
    if bare.lower() in _NOT_NAME:
        return False
    if not _HAN_NAME_MIN <= len(bare) <= _HAN_NAME_MAX:
        return False
    return not any(ch in _HAN_FUNCTION_WORDS for ch in bare)


def _looks_like_name(token: str) -> bool:
    """Is this cell a person, or is it a header/label? (feat-048 BUG-3.)

    THE STOP-LISTS RUN FIRST, AND THAT ORDER IS THE WHOLE DESIGN. Both shape rules below are
    permissive by construction, so 「姓名」/"No." are rejected because they are ON THE LIST, never
    because of their shape. Reversing the order, or reaching for a shape rule clever enough to
    exclude headers, is how the "No." bug (feat-039) and its Chinese twin get shipped.
    """
    token = token.strip()
    if not token or token.lower() in _NOT_NAME or _INDEX_TOKEN_RE.match(token):
        return False
    # Han names. Before feat-048 no Han name could reach here at all — the ASCII-uppercase rule below
    # rejected all of them, so a degraded/offline ingest handed the (all-Chinese) first customer an
    # empty team page. (feat-049 note: _NOT_NAME's Chinese column headers are now folded in from
    # _ZH_HEADER_MAP, so a word taught to the header mapper is rejected here automatically — one
    # list, two consumers. See _ZH_HEADER_MAP.)
    if _HAN_NAME_RE.match(token):
        return _han_name_ok(token)
    # 1-3 capitalized words, letters/space/dot/hyphen only. UNCHANGED — the English contract.
    return bool(re.match(r"^[A-Z][A-Za-z.\-]+(?: [A-Z][A-Za-z.\-]+){0,2}$", token))


_TEAM_ALIASES = {"engineering": "Eng", "design": "Design", "product": "Product",
                 "gtm": "GTM", "sales": "GTM", "go-to-market": "GTM", "operations": "Ops",
                 "ops": "Ops", "founder": "Founders", "founders": "Founders"}


def _norm_team(raw: str) -> str:
    """Map a stated team/department onto TEAMS where that is honest, and PASS IT THROUGH where it
    is not (feat-048 BUG-4). Two defects lived in the six lines this replaces:

      1. `for t in TEAMS: if raw in t.lower(): return t` — THE EMPTY STRING IS A SUBSTRING OF EVERY
         STRING, so _norm_team("") / ("  ") / (None) all returned TEAMS[0] == "Founders". A blank
         cell was silently promoted to the single most consequential bucket available: the owners.
      2. TEAMS is a STARTUP taxonomy. No real hotel department maps onto it, so 前厅部/客房部/餐饮部/
         市场推广部/销售部 all normalized to "" — and then, via (1), to "Founders". Observed on the
         real machine: 「陈思雨 项目负责人 · Founders」— a Sanya hotel's sales lead filed as a founder.

    PASS-THROUGH IS THE DESIGN CALL, and it is checked rather than assumed:
      * The consumer types team as FREE TEXT (src/lite2/teamData.ts:21 `team?: string`) and
        src/lite2/teamGroups.ts groups by that raw string and renders it AS the group title — so
        pass-through is what puts a 「前厅部」group on the page.
      * The strict `'Founders'|'Eng'|...` union lives only in src/story/data/fixtures.ts, the old
        demo app, which does not consume ingest output. The comment at the top of this file
        ("Teams mirror the frontend Person['team'] union") is a fossil of that.
      * The frontend already eats non-TEAMS values daily: the stub transports ship 'Engineering',
        'Operations', 'Sales'.
      * PASS-THROUGH MAKES `team` FREE TEXT, SO THE RED LINE MUST SCAN IT — and as of round 3 it
        does (`redline_extract._person_text_fields` includes `p.team`). Round 2 shipped this bullet
        asserting the exact opposite ("team is NOT part of the red line's scan surface ... so
        pass-through cannot smuggle text past that gate"). That was a correct observation wired to
        an inverted conclusion: not-scanned is not a defence, it is the hole, and it was THE hole —
        a roster with the performance column pasted into the department column built a context with
        ok=True. Pass-through is only safe BECAUSE the scan surface now follows the free text.
    The alternative — squeezing an unmappable department into the nearest bucket — would file
    前厅部/客房部/餐饮部 all under 'Ops': three real departments rendered as one group. That is the
    same information loss as the bug, only tidier.

    This DOES change English output for values TEAMS/aliases cannot express ('Growth', 'Marketing':
    "" -> themselves), and that is deliberate — an English startup's Growth team has no more
    business being dropped on the floor than 前厅部 does. The iron "English must not change" rule is
    about _slug's ids byte-for-byte and about the team values the real English corpus contains
    (Team_Roster.xlsx ships 'Design' and 'Eng'); every mapping the code already gets right is frozen
    in test_norm_team_english_mapping_is_frozen_BUG4.
    """
    text = (raw or "").strip()
    if not text:
        # Unknown is UNKNOWN — exactly what PersonEntity.team already documents ('"" if unknown —
        # never guessed hard'). This early return is what kills defect (1) at the root.
        return ""
    low = text.lower()
    for t in TEAMS:
        # WHOLE WORD, not substring (feat-048 round 3, H3). Round 2 killed the REVERSE direction of
        # this match (`raw in t.lower()`, where "" is a substring of every bucket -> Founders) and
        # kept the FORWARD direction on purpose. Both directions are the SAME BUG CLASS, and the
        # forward one bites a real customer: 'Eng' is a substring of 'Guest ENGagement', so a
        # bilingual five-star hotel's guest-relations department was filed under Engineering — a
        # department the hotel does not have. Measured before this line:
        #     _norm_team('Guest Engagement 宾客关系部') == 'Eng'
        #     _norm_team('Engagement Team')            == 'Eng'
        # `\b` is what separates the accidental match from the honest one: 'Design Team' still maps
        # to Design (design is a WORD there), while 'Engagement' no longer donates its first three
        # letters to Eng. Han is \w, so 'Eng宾客' has no boundary either and correctly does not match.
        #
        # THE ENGLISH SURFACE IS MOSTLY NOT HELD UP BY THIS LOOP — worth knowing before trusting the
        # freeze list. 'Engineering' -> 'Eng' does NOT survive via this loop (there is no word break
        # inside 'engineering'); it falls through to _TEAM_ALIASES below, which is what has always
        # mapped it. Of the frozen English mappings only 'Design'/'Design Team'/'Eng'/'Product'/
        # 'GTM'/'Ops'/'Founders' come through here. Verified against every team value the real corpus
        # and both stub transports actually emit (Design/design/Operations/Product/product/Marketing/
        # Growth/GTM/Engineering): all unchanged.
        if re.search(rf"\b{re.escape(t.lower())}\b", low):
            return t
    if low in _TEAM_ALIASES:
        return _TEAM_ALIASES[low]
    # Unmappable but STATED: the document knows something the taxonomy cannot express. Keep it.
    return text


# Chinese status vocabulary. THE ENGLISH-ONLY VERSION OF THIS FUNCTION COLLAPSED THE WHOLE
# GRADING LADDER ON CHINESE DOCUMENTS (feat-056 review, finding 2). Two of the three companies
# in this wave hand us Chinese weekly reports, where 「状态：进行中」 is the normal way to write
# it. Every one of those normalised to "" and two things followed downstream:
#   1. decision_grading's can_proceed rules (_m_done / _m_clear) BOTH require a normalised English
#      status, so no project in a Chinese-only document could ever reach 可推进 — the three-tier
#      ladder silently collapsed to two, which is precisely the partner-parity target we were
#      aligning to.
#   2. the project fell through to the no-evidence rule, whose reason text told the manager the
#      document never stated a status — while his own report says 进行中 in plain sight.
# Chinese has no word boundaries, so these are substring matches.
# 🔴 Precedence is deliberately risk-first (blocked > at-risk > done > on-track), matching the
# English arm: when a line supports two readings, take the one that gets the project LOOKED AT.
#
# --- negation: ONE mechanism, all four rungs --------------------------------------------------
# Each rung used to carry its own single-glyph lookbehind — (?<![未没待])完成, (?<![无没])风险,
# (?<![不异])正常 — and a one-character lookbehind can only see ONE glyph back. Chinese negates
# with PHRASES, so all three were sieves. Measured on the shipped code, every line real:
#     无法完成 / 未能完成 / 不能完成 / 没能完成 / 难以完成   -> "done"      <- the blocker
#     没有风险 / 未发现风险 / 无明显风险 / 无重大风险        -> "at-risk"   <- false alarm
#     未按计划推进 / 未能如期交付 / 进展不顺利 / 不太顺利    -> "on-track"  <- reversed
#     未受阻 / 没有卡住 / 不会停工                           -> "blocked"   <- false alarm
# The first row is why this was a blocker rather than a bug: status="done" is what decision_grading
# `_m_done` reads, so a project whose own weekly says 「本月无法完成」 was graded 可推进 with the
# reason 「项目自报已完成，且无风险信号」. Not a miss — the OPPOSITE of the document.
#
# The replacement is a BOUNDARY-EXACT backward scan, deliberately not a sliding window. B3
# (「别墅」 disarming the red line) is what a window does: redline._negated asks only whether a cue
# sits within 32 chars, so any nearby glyph suppresses everything after it. Here a negation counts
# only when it ENDS exactly where the keyword BEGINS. That is what lets 「未来风险」(future risk),
# 「非常正常」(perfectly normal) and 「不过完成了」(but it did finish) through untouched: 来 / 常 /
# 过 are not link glyphs, so the negator never reaches the keyword. All three are gated in
# tests/test_zh_status_negation.py, which measures both directions on real Han text.
_ZH_NEG_HEAD = r"(?:不|没|未|无|非)"
# Glyphs allowed BETWEEN the negator and the keyword without breaking the negation:
# 无【法】完成 · 没【有及时】完成 · 未【发现】风险 · 无【明显】风险 · 不【存在】延期.
# Longest alternatives first — the engine backtracks anyway, but the order states the intent.
#
# 【得】 IS LOAD-BEARING AND WAS THE ROUND-1 REGRESSION. Without it the commonest double negative in
# written Chinese, 「不得不」, was counted as ONE negation instead of two, which REVERSED the reading:
# 「不得不推迟上线」 went at-risk -> "" (and "" is rendered on-track by the frontend default, see the
# note on `_norm_status`). 不 sat flush against 推迟 so the inner 不 counted; scanning further back
# hit 得, which was not a link, so the outer 不 was never reached — depth 1, odd, suppressed. This is
# the same class of failure the whole block exists to stop, introduced by the fix for it. With 得 in
# the set 「不得不延期」 is depth 2 (= stated, at-risk) while 「不得延期」 stays depth 1 (a rule saying
# it may not slip — genuinely not a status). Both directions are gated in the test file.
_ZH_NEG_LINK = (r"(?:及时|按时|按期|如期|准时|存在|出现|发现|达到|明显|重大|实质|任何|完全"
                r"|办法|法子|把握|信心|可能|能|会|有|是|太|够|大|很|甚|算|予|再|曾|见|及|法"
                r"|从|力|得)")
# Negators that are not head+link runs. Each must still END exactly at the keyword.
#   难[以于]完成          — the round-1 form, kept verbatim.
#   很难 / 太难 / 极难    — 难 alone is NOT accepted, because 「克服困难完成了交付」 would then read
#                           as negated. A degree adverb is what makes 难 a negation rather than a
#                           noun ending; 困 / 灾 are not degree adverbs, so 困难 / 灾难 cannot match.
#   赶不上 / 来不及       — the V不C potential complement. 差不多 / 说不定 do not match: 多 and 定
#                           are not complements in this set.
#   不确定能否            — 能否 / 是否 is REQUIRED. Without it 「尚不确定风险是否可控」 would be
#                           suppressed to "", losing a risk the document states.
_ZH_NEG_DEGREE = r"(?:很|太|极|挺|颇|较|更|最|特|尤|非常)"
_ZH_NEG_ALT = (rf"难[以于]|{_ZH_NEG_DEGREE}难"
               r"|[一-鿿]不(?:了|上|及|起|动|完|下)"
               r"|(?:不|尚不|暂不|还不)(?:确定|清楚|知道)(?:能否|可否|是否|会不会)")
_ZH_NEG_RE = re.compile(rf"(?:{_ZH_NEG_HEAD}{_ZH_NEG_LINK}*|{_ZH_NEG_ALT})\Z")
_ZH_NEG_REACH = 12   # a head+links run longer than this does not occur in real prose

# Negation that TRAILS the keyword. Chinese puts the potential complement after the verb, so
# 「完成不了」 and 「验收通过不了」 are negations that a backward-only scan cannot see — and both read
# as done on the round-1 code. Boundary-exact in the same way: it must start exactly where the
# keyword ends. 「不成」 is deliberately EXCLUDED — 「按时完成不成问题」 means finishing on time is no
# problem, and treating it as a negation would reverse a sentence that is good news.
_ZH_POST_NEG_RE = re.compile(r"\A(?:不了|不完|不下去|不上去|不动)")


def _zh_negation_depth(t: str, start: int) -> int:
    """How many negations stack up immediately before the keyword at `start`.

    COUNTED, not flagged, because Chinese double-negates and the two readings are OPPOSITE:
    「并非没有风险」 means there IS risk. 非 governs 没有, depth 2, and depth 2 has to read exactly
    like depth 0 or the fix would newly break a sentence the old code happened to get right.
    """
    depth, pos = 0, start
    while pos > 0:
        lo = max(0, pos - _ZH_NEG_REACH)
        m = _ZH_NEG_RE.search(t[lo:pos])
        if m is None:
            break
        depth += 1
        pos = lo + m.start()   # strictly decreases: _ZH_NEG_RE cannot match empty
    return depth


def _zh_states(t: str, pattern: str, *, positive_claim: bool = False) -> bool:
    """True when `t` actually STATES `pattern` — at least one hit that negation does not cancel.

    Every hit is checked, not just the first: 「无法完成，风险已上报」 must still read as risk off
    its second clause even though its first clause's 完成 is negated away.

    `positive_claim=True` (the done / on-track rungs) demands depth 0 rather than merely even, and
    the asymmetry is deliberate — it is the same argument `risk_only` makes below. A double negative
    is a fine way to STATE RISK: 「并非没有风险」 is a manager saying there is risk, and it must
    reach at-risk. It is NOT a self-report of completion: 「并非无法完成」 means "we could still
    finish", which is a rebuttal, not 「已完成」. Reading it as done would hand out 可推进 with the
    reason 「项目自报已完成」 over a sentence that reports nothing of the sort — the exact failure
    this whole block exists to stop, one negation deeper.
    """
    for m in re.finditer(pattern, t):
        depth = _zh_negation_depth(t, m.start())
        if _ZH_POST_NEG_RE.match(t, m.end()):
            depth += 1   # 完成【不了】 — trailing negation counts like a leading one
        if depth == 0 or (not positive_claim and depth % 2 == 0):
            return True
    return False


# partner-docs-0728 · 「暂停」补进本行（漏网，不是新语义）。这一列原本就收了 中止|搁置|停滞
# ——「项目暂停了」和「项目搁置了」在管理语境里是同一件事，只有 暂停 不在，纯属清单没写全。
# 后果是可见的：合伙人《标准管理信息填写表单》表 02「当前状态」的四个选项里，
# 「已暂停」在补进来之前一个词表都不在 → _norm_status 返回 '' → projectView.ts:87 判成
# 'unknown' → 用户照着我们发的表认真填了「已暂停」，项目卡上写「状态未知」。
# 同一批里的「未开始」**有意不补**：它是计划态、不是健康度，留空并归到「状态未知」是对的
# （里程碑词表有 未开始→upcoming，那是另一个轴，别拿来对齐）。
# 否定照旧由 _zh_states 统一处理，所以「尚未暂停」不会被读成 blocked。
_ZH_BLOCKED = r"受阻|已阻断|阻塞|卡住|停滞|停工|中止|搁置|暂停|无法推进|推不动"
_ZH_AT_RISK = r"风险|延期|逾期|滞后|落后|推迟|拖期|告急|吃紧|超期"
# INABILITY is not absence. 「未完成」 is a neutral fact about a date — the thing is not finished
# yet, which is what "in progress" looks like — and it stays a blank. 「无法完成」 is the project
# telling its own manager it will MISS. Suppressing that to '' would be honest but deaf, and the
# blank then reaches decision_grading as "the document did not state a status", which is itself
# untrue of a document that said so in plain sight. So inability is READ (off the sentence, not
# invented) and routed to at-risk — the rung that drives 「多看一眼」. It is checked with the same
# negation scan as everything else, so 「并非无法完成」 does not fire it.
#
# THE HEAD LIST IS A WHITELIST, AND THAT IS ITS KNOWN LIMIT. Round 1 shipped six heads and the
# review found the customer's own phrasings sitting just outside them — 「没办法完成」「很难完成」
# 「不太可能完成」「完成不了」 all still reached done. Every one of those is ordinary weekly-report
# Chinese, not a corner case. The list below is the measured set; anything outside it degrades to
# "" (blank) rather than to done, because the negation scan above suppresses the completion word
# independently of whether this pattern recognises the phrase. Blank is wrong-but-quiet; done is
# wrong-and-loud. That two-layer arrangement is deliberate, not redundancy.
_ZH_CANNOT_DELIVER = (
    r"(?:无法|没法|没办法|无办法|未能|不能|没能|不会|难以|无从|无力"
    rf"|{_ZH_NEG_DEGREE}难|不太可能|不大可能|不可能|无把握|没把握|无信心|没信心"
    r"|不确定(?:能否|可否|是否)|来不及|赶不上)"
    r"(?:按时|按期|如期|准时|及时)?"
    r"(?:完成|交付|上线|结项|验收|完工|竣工|收尾|达成)"
    # trailing form: 完成不了 / 验收通过不了. 验收通过 must precede 验收 in the alternation or the
    # engine commits to 验收 and then fails on 通.
    r"|(?:验收通过|完成|交付|上线|结项|验收|完工|竣工|收尾|达成)(?:不了|不完|不下去)")
# 「未按计划推进」「进展不顺利」 are the document STATING that things are off plan. Round 1 stopped
# reading them as on-track (they were reversed before that) but landed them on "", and "" travels to
# the manager as 「没读到状态」 — telling a customer his file says nothing when line three of it says
# 进展不顺利. That is the same untruth in a different direction. These are read, off the sentence,
# onto at-risk: the rung that surfaces 多看一眼, which is exactly what "off plan" asks for.
# Guarded by the same scan, so 「并非不顺利」 and 「没有不顺利的地方」 do NOT fire it.
_ZH_OFF_PLAN = (r"(?:不太|不够|不很|不甚|不算|不大|不怎么|不)(?:顺利|理想|乐观)"
                r"|(?:未|没有|没|未能)按(?:原|既定)?(?:计划|进度|节点)")
# The two surviving lookbehinds are NOT negation and are deliberately kept out of the shared
# mechanism: 待 in 「待完成」 is "pending", 异 in 「异常」 is "abnormal". Neither is a negator, and
# neither can be reached by a negator scan.
_ZH_DONE = r"(?<![待])完成|已交付|已上线|已结项|已验收|验收通过"
_ZH_ON_TRACK = r"进行中|推进中|(?<![异])正常|按计划|如期|顺利|在轨"


def _norm_status(text: str, *, risk_only: bool = False) -> str:
    """Normalize a stated status onto on-track|at-risk|blocked|done, or '' when the document does not
    state one we can read honestly.

    The Chinese vocabulary is PURELY ADDITIVE — every ASCII branch below is untouched and runs
    first, so English output cannot move.

    `risk_only=True` suppresses the two POSITIVE readings. It is for the whole-document fallback
    (no 'Status:' line anywhere, so we are scanning prose). Downgrading a project on prose is not
    symmetric with escalating it: the grading rules require an EXPLICIT positive self-report to
    hand out 可推进, and the word 正常 happening to appear somewhere in a weekly report is not that
    project stating it is fine. Reading risk out of prose stays on, because there the bias points
    at getting a second look.

    ONE WORD IS DELIBERATELY LEFT UNMAPPED: 「待确认」 (pending confirmation), which the first
    customer's weekly uses for two of its six projects. It is tempting to call it at-risk, and that
    would be INVENTING RISK: "nobody has confirmed this yet" is not "this is in trouble", and
    at-risk is the status that drives「多看一眼」surfacing. A false alarm in front of a paying
    customer costs more than an honest blank. So 待确认 returns '' HERE.

    WHAT THE CARD ACTUALLY SHOWS IS NOT '' — and this docstring used to claim it was. Returning ''
    hands the decision to `_project_from_span`, which then sniffs the project's own block for a
    status (extract.py, `if not status:`). On the first customer's weekly that sniff finds real
    blocker lines — 「佣金测算 — 受阻」, 「…卡住」 — inside the very blocks that self-report 待确认,
    so 「销售绩效与佣金方案」 and 「新人带教与团队士气」 render BLOCKED, which is heavier than the
    at-risk this function refused to assign. The inference is documented and line-citable, not
    invented, so it stands for now; but the outcome is a product call, not a settled one, and the
    contradiction is recorded here rather than papered over. See
    test_pending_confirmation_falls_through_to_block_level_inference for the end-to-end behaviour
    this actually produces.
    """
    t = text.lower()
    if re.search(r"\bblocked\b", t) or _zh_states(t, _ZH_BLOCKED):
        return "blocked"
    if (re.search(r"\bat[\s-]?risk\b|behind|slipping|delayed", t)
            or _zh_states(t, _ZH_AT_RISK) or _zh_states(t, _ZH_CANNOT_DELIVER)
            or _zh_states(t, _ZH_OFF_PLAN)):
        return "at-risk"
    if risk_only:
        return ""
    if (re.search(r"\b(done|shipped|complete|launched)\b", t)
            or _zh_states(t, _ZH_DONE, positive_claim=True)):
        return "done"
    if (re.search(r"\bon[\s-]?track\b|on schedule", t)
            or _zh_states(t, _ZH_ON_TRACK, positive_claim=True)):
        return "on-track"
    # 054 and 056 each grew a Chinese ladder independently and the merge stacked them. The second
    # one is DELETED, not kept "for safety": it ran after this point with NO negative lookbehinds,
    # so 「无风险」 matched 风险 → at-risk and 「未完成」 matched 完成 → done. Every word it carried
    # is covered above (受阻 / 已阻断 were the only two missing and are now in _ZH_BLOCKED), and
    # the surviving ladder is the one that reads negation correctly.
    return ""


# --- the heuristic (offline, deterministic, NO model) -----------------------------------------

class HeuristicExtractor:
    """Deterministic rule-based extraction. This is what the AFK gate runs — no LLM, no embeddings.

    It is intentionally conservative and, by construction, red-line-safe: PersonEntity has no numeric
    field, and person free-text is drawn from role/tenure/ownership sentences, not from any rating.
    """

    def extract(self, doc: ParsedDoc) -> ExtractionResult:
        res = ExtractionResult()
        if doc.doc_kind == "roster":
            res.merge(self._people_from_roster(doc))
        elif doc.doc_kind == "resume":
            res.merge(self._people_from_resume(doc))
        elif doc.doc_kind in ("project", "roadmap"):
            res.merge(self._projects_from_doc(doc))
            res.merge(self._signals_from_doc(doc))
            # rich-align-0722/03: a weekly's 人员动态 self-report lines → person self_report slot.
            res.merge(self._selfreport_from_lines(doc))
        # rich-align-0722/08: SOP `## 方法：` 小节 → 方法卡. UNCONDITIONAL (like _materials): the SOP
        # fixture sniffs doc_kind='unknown', so gating this behind a kind branch would drop every card.
        res.merge(self._playbooks_from_doc(doc))
        # Every doc contributes material chunks to the RAG (including company handbooks).
        res.merge(self._materials(doc))
        return res

    # playbooks ------------------------------------------------------------

    def _playbooks_from_doc(self, doc: ParsedDoc) -> ExtractionResult:
        """SOP 方法库：每个 `## 方法：<标题>` 小节 → 一张 MethodCard。适用行=description、
        标签行=tags；小节边界止于下一个 `##`（含 `## 说明` 免责段，故不被误抽成卡）。
        要点列表卡内不展开（留将来详情态）。零人身评分——method 面不进红线人闸。"""
        res = ExtractionResult()
        lines = doc.lines
        n = len(lines)
        i = 0
        while i < n:
            head = _METHOD_HEADER_RE.match(strip_decoration(lines[i].strip()))
            if not head:
                i += 1
                continue
            title = head.group(1).strip()[:80]
            description = ""
            tags: list[str] = []
            j = i + 1
            while j < n:
                raw = lines[j].strip()
                if raw.startswith("##"):        # 下一小节（方法/说明/其它）——本卡到此为止
                    break
                s = strip_decoration(raw)
                am = _APPLIES_LABEL_RE.match(s)
                if am and not description:
                    description = am.group(1).strip()[:200]
                else:
                    tm = _TAGS_LABEL_RE.match(s)
                    if tm:
                        tags = [t.strip() for t in _OWNS_SPLIT_RE.split(tm.group(1)) if t.strip()][:8]
                j += 1
            if title:
                res.playbooks.append(MethodCard(
                    title=title, description=description, tags=tags, source=doc.name))
            i = j
        return res

    # people ---------------------------------------------------------------

    def _people_from_roster(self, doc: ParsedDoc) -> ExtractionResult:
        """Roster/CSV: 'Name | Role | Team | Tenure' style rows -> PersonEntity per row.

        THE HEADER ROW IS READ IN BOTH LANGUAGES (feat-049). Until then, `header` was built only when
        row 0 matched `\\bname\\b` — ASCII — so on the first customer's roster, whose header row reads
        「姓名 | 职位 | 部门 | 司龄 | 负责」, `header` stayed [] and three things followed:

          1. `col.get("owns")` was always None and owns has NO positional fallback, so the 「负责」
             column was never read: every Chinese colleague got owns=[]. That is not a missing field,
             it is the BODY of the person card — role/team/tenure are one header line and `owns` is
             everything under it. The degraded path handed a Sanya manager a team page of names with
             nothing beneath them.
          2. The `if header and cells[0] in _NOT_NAME` guard below never ran on a Chinese document.
             feat-048 round 2 moved that load onto _looks_like_name's stop-list, which works — but the
             structural guard was dead, and it is live again now.
          3. role/team/tenure survived only POSITIONALLY (cells[1]/cells[2]/cells[3]), so a roster
             whose columns are in a different order was SILENTLY mis-filed. Measured, on a real HR
             export ordered 姓名|部门|职位: 郑海燕 came out with role='客房部' (her department, as her
             job title) and team='客房部经理' (her job title, as her department — rendered as the
             heading of a department group that does not exist). Nothing reported it; the card was
             confidently wrong.

        The positional fallbacks BELOW ARE KEPT, and only their reachability changes: they are what a
        headerless table still runs on, and on a table WITH a header they are inert for any column
        the header names (col[k] and cells[n] are the same cell). They are not a second opinion — the
        header wins wherever it speaks.
        """
        res = ExtractionResult()
        rows = [ln for ln in doc.lines if "|" in ln]
        header: list[str] = []
        if rows and _is_roster_header_row(rows[0]):
            # #61: 表头与数据行必须用同一把尺剥边框。只剥一边，col 映射就整体偏一位——那是
            # docstring 第 3 条那种「卡片自信地全错且无人报告」的错位，比零命中更贵。
            header = [_canon_header(c) for c in _strip_table_frame(rows[0]).split("|")]
            rows = rows[1:]
        for i, ln in enumerate(doc.lines):
            if "|" not in ln:
                continue
            cells = [c.strip() for c in _strip_table_frame(ln).split("|")]
            if header and cells and cells[0].strip().lower() in _NOT_NAME:
                continue
            name = cells[0] if cells else ""
            if not _looks_like_name(name):
                continue
            col = {header[j]: cells[j] for j in range(min(len(header), len(cells)))} if header else {}
            role = col.get("role") or (cells[1] if len(cells) > 1 else "")
            team = _norm_team(col.get("team") or (cells[2] if len(cells) > 2 else ""))
            tenure = col.get("tenure") or (cells[3] if len(cells) > 3 else "")
            owns = []
            owns_val = col.get("owns") or col.get("focus") or col.get("projects")
            if owns_val:
                owns = [o.strip() for o in _OWNS_SPLIT_RE.split(owns_val) if o.strip()]
            # T5/A2 — 工号，**只从表头读，没有位置兜底**。这不是省事：01 表把「人员ID」放在第 6 列，
            # 而位置兜底只认 cells[1..3]；给它编一个位置，等于在一张列序不同的名册上把部门当工号
            # 存进归并的第一把尺——那比读不到工号糟得多（读不到只是退回按姓名归并，读错是把两个人
            # 判成同一个/把一个人判成两个）。表头没说工号，这一列就当没有。
            person_id = (col.get("person_id") or "").strip()
            res.people.append(PersonEntity(
                id=_slug(name, "u"), name=name, person_id=person_id, role=role.strip(), team=team,
                tenure=tenure.strip(), owns=owns, source=f"{doc.name}:{i + 1}"))
        return res

    def _people_from_resume(self, doc: ParsedDoc) -> ExtractionResult:
        """Resume: pull name (first non-empty header line), a role, tenure phrases, and 'owned'
        bullet lines. STAYS qualitative — never derives a rating even if the resume brags a metric."""
        res = ExtractionResult()
        name = ""
        for ln in doc.lines[:6]:
            s = ln.strip().lstrip("#").strip()
            # a header like "Marcus Reid — Senior Engineer" / "Lena Park, Product Designer":
            # take the part before a dash/comma and test that as the name.
            head = re.split(r"\s+[—\-–|,]\s+", s, maxsplit=1)[0].strip()
            if _looks_like_name(head):
                name = head
                break
            if _looks_like_name(s):
                name = s
                break
        if not name:
            name = re.sub(r"\.[a-z0-9]+$", "", doc.name).replace("_", " ").strip()
        role = ""
        mrole = _ROLE_RE.search(doc.text)
        if mrole:
            role = mrole.group(0).strip()
        tenure = ""
        mten = _TENURE_RE.search(doc.text)
        if mten:
            tenure = next((g for g in mten.groups() if g), "").strip()
        owns: list[str] = []
        for ln in doc.lines:
            s = ln.strip()
            if re.match(r"^[-*•]\s+", s) or re.match(r"^(led|owned|built|shipped|drove|designed|"
                                                     r"delivered|managed|created|maintained)\b", s, re.I):
                owns.append(re.sub(r"^[-*•]\s+", "", s)[:160])
            if len(owns) >= 6:
                break
        res.people.append(PersonEntity(
            id=_slug(name, "u"), name=name, role=role, tenure=tenure, owns=owns,
            source=f"{doc.name}:1"))
        return res

    def _selfreport_from_lines(self, doc: ParsedDoc) -> ExtractionResult:
        """rich-align-0722/03 — a weekly's 「人员动态」self-report lines → the person's self_report slot.

        SYNTAX (issue-01 定稿表第 4 行): `- 小王｜负载自述：85%｜情绪自述：吃紧`. ｜ or | separates cells;
        cell 0 is the name. **Only 自述-suffixed labels are read** — a bare 「负载：85%」 (no 自述) is
        NOT a self-report and is dropped, so a stray person number never becomes a score. Load is
        0..100 only (out-of-range rejected, not clamped); mood maps to the qualitative enum, out-of-
        vocab kept verbatim as `other` (parity with milestone/status). These people carry ONLY identity
        + self_report; roster/resume enrich the rest of the card at dedup.
        """
        res = ExtractionResult()
        for i, raw in enumerate(doc.lines):
            # #61: 剥边框必须发生在 strip 之前——strip_decoration 第一步就 .strip()，会把
            # ` | 周雅 | …`（join 对「首格为空」的产出）洗成顶格竖线，那种行必须继续被丢弃。
            # 边框字符集跟本函数自己的切格表一致（｜/|），与 roster 路各认各的尺。
            s = strip_decoration(_strip_table_frame(raw, "|｜").strip())
            if "自述" not in s:
                continue
            cells = re.split(r"[｜|]", s)
            if len(cells) < 2:
                continue
            name = cells[0].lstrip("-*•・ ").strip()
            if not _looks_like_name(name):
                continue
            src = f"{doc.name}:{i + 1}"
            load: "SelfReportLoad | None" = None
            mood: "SelfReportMood | None" = None
            for cell in cells[1:]:
                m = re.match(r"^\s*(.+?自述)\s*[：:]\s*(.+?)\s*$", cell)
                if not m:
                    continue
                label, val = m.group(1).strip(), m.group(2).strip()
                # 只有「哪一格是哪个槽」这一步认文案；值的判据走共用原语（gap2 T11 的
                # ONE RULER —— 表单那条路认结构化标记，但读出来的数必须是同一把尺量的）。
                if re.search(r"负载|工作量|工作负荷|饱和|负荷", label):
                    load = read_selfreport_load(val, src) or load
                elif re.search(r"情绪|心情|状态", label):
                    mood = read_selfreport_mood(val, src) or mood
            if load or mood:
                res.people.append(PersonEntity(
                    id=_slug(name, "u"), name=name,
                    self_report=PersonSelfReport(load=load, mood=mood), source=src))
        return res

    # projects & signals ---------------------------------------------------

    def _projects_from_doc(self, doc: ParsedDoc) -> ExtractionResult:
        """Project weekly / roadmap -> ONE ProjectEntity PER PROJECT THE DOCUMENT LABELS.

        feat-054 / H4 LAYER A — THE STRUCTURAL FIX. This function used to accumulate title / owner /
        status / progress into SCALAR locals across the whole document and append a single entity at
        the end, so every project but the last was overwritten in place. One document == one project,
        by construction, since the function was written. It was invisible in every ASCII fixture only
        because none of them had two projects in one file; a pure-English document with two
        `Project:` lines lost the first one exactly the same way (see test_zh_project_axis_gap.py).

        Now the document is SEGMENTED at its own project labels (`granularity.segment_projects`) and
        each span is scanned independently, so six projects come back as six.

        WHY A SINGLE BLOCK STILL SCANS THE WHOLE DOCUMENT: when a document labels exactly one
        project, the doc-per-project assumption is simply TRUE for it, and scanning the whole file
        keeps every pre-054 English fixture byte-identical — fields stated in a preamble above the
        `Project:` line (a `#` heading, a `Summary:`, a trailing blocker paragraph) are still picked
        up as they always were. Scoping only kicks in where it is the fix: 2+ labelled projects.
        A document with NO project label keeps the old heading/filename-titled single entity.
        """
        blocks = segment_projects(doc)
        res = ExtractionResult()
        if len(blocks) <= 1:
            spans: list[tuple[str, int, int]] = [
                (blocks[0].title if blocks else "", 0, len(doc.lines))]
        else:
            spans = [(b.title, b.start, b.end) for b in blocks]
        for labelled_title, lo, hi in spans:
            res.projects.append(self._project_from_span(doc, labelled_title, lo, hi,
                                                        whole_doc=len(blocks) <= 1))
        return res

    def _project_from_span(self, doc: ParsedDoc, labelled_title: str, lo: int, hi: int,
                           whole_doc: bool) -> ProjectEntity:
        """Read one project's fields out of one span of lines. Labels are read in BOTH languages
        (feat-054 / H4 LAYER B): 「负责人：/自报状态：/进度：/截止：/进展摘要：/阻碍项：」 next to the
        ASCII forms, so the first customer's weekly stops coming back blank-owned and blank-status."""
        title = labelled_title
        owner = ""
        status = ""
        progress: int | None = None
        summary = ""
        due = ""
        blockers: list[str] = []
        risk: ProjectRisk | None = None
        # rich-align-0722/02: 里程碑是「标签行 + 连续列表行」多行结构，单独扫这段 span（主循环
        # 的逐行匹配够不着多行）。列表项行不会撞任何单行字段（无字段冒号），不干扰主循环。
        milestones = milestones_from_lines(doc.lines[lo:min(hi, len(doc.lines))])
        for i in range(lo, min(hi, len(doc.lines))):
            raw = doc.lines[i].strip()
            # FIELD LABELS ARE READ WITHOUT THEIR MARKDOWN MARKUP (see granularity.strip_decoration).
            # Every label pattern below is `^`-anchored, so a weekly that writes its fields as a
            # bullet list — 「- 负责人：陈思雨」/「- 状态：进行中」, ordinary .md — matched NONE of them
            # and every project came back blank-owned and blank-status. That is not just a thin card:
            # `granularity._tracked_fields` reads exactly these fields, so an untracked-looking
            # project is demoted by R4 and vanishes from the screen entirely.
            s = strip_decoration(raw)
            # ONE RULER for "does this line declare a project?" — `granularity.project_header_title`,
            # the very function `segment_projects` cuts blocks with. Read ONCE and used twice below,
            # so this span's title and the segmentation that produced the span cannot disagree about
            # what a header IS.
            # This was two hand-copied regexes, and the EN copy had ALREADY drifted: it knew
            # 「project:／title:」 but not 「initiative:／workstream:」 nor the ordinal 「Project 2:」
            # that granularity accepts. The ZH copies were still identical, which reads as if the
            # pair were in sync — the worse failure, because it hides the EN gap. The drift was
            # masked rather than live (`segment_projects` passes `labelled_title` in, so the narrow
            # copy never had to match), which is exactly the feat-048 round-1 shape the
            # `_ZH_HEADER_MAP`／`_NOT_NAME` notes were written about: a copy that stays correct only
            # while nobody exercises it, and goes silently wrong the day somebody does.
            header_title = project_header_title(raw)
            # The `#`-heading title fallback still reads the RAW line, because it wants the markup —
            # but a heading that is ITSELF a project header (「## 项目：X」) must not be taken
            # literally as a project named 「项目：X」. `header_title` is what distinguishes them;
            # the branch just below then takes the real title out of it.
            m = re.match(r"^#+\s*(.+)$", raw)
            if m and not title and not header_title:
                title = m.group(1).strip()
                continue
            if header_title:
                title = header_title
            m = re.match(r"^(owner|lead|dri)\s*[:\-]\s*(.+)$", s, re.I)
            if m:
                owner = m.group(2).strip()
            # The Chinese label lines. 054 and 056 each grew their own set independently; this is
            # the UNION of both vocabularies. They stay separate patterns rather than extra
            # alternatives bolted onto the English ones, because they REQUIRE a colon:
            # 「截止」「负责」 are ordinary words that start ordinary sentences, and an optional
            # separator would let 「截止到目前为止…」 be read as a due date. The English arms keep
            # their optional separator so nothing about their behaviour changes.
            m = re.match(r"^(?:负责人|主负责人|项目负责人|责任人|牵头人|负责)\s*[:：]\s*(.+)$", s)
            if m:
                owner = m.group(1).strip()
            m = re.match(r"^status\s*[:\-]\s*(.+)$", s, re.I)
            if m:
                status = _norm_status(m.group(1)) or status
            # 状态 / 进展 + colon: the Chinese label line. Without it the only thing that could
            # see 「状态：进行中」 was the whole-document fallback below, which is risk_only and so
            # can never return the positive reading the line actually states.
            m = re.match(r"^(?:自报状态|当前状态|项目状态|状态|进展)\s*[:：]\s*(.+)$", s)
            if m:
                status = _norm_status(m.group(1)) or status
            # rich-align-0722/01: 超界拒收，不 clamp 成假值（PRD A2「仅收 0–100 有限数，0 合法」）。
            # \d{1,3} 能匹配到 999；>100 一律不落值（progress 留 None = 文档没给可用进度），
            # 与前端 projectView.progressOf 的 0..100 校验同口径（曾经 max/min clamp 会把 150 谎报成 100%）。
            m = re.search(r"\bprogress\s*[:\-]?\s*(\d{1,3})\s*%", s, re.I)
            if m:
                _p = int(m.group(1))
                if 0 <= _p <= 100:
                    progress = _p
            m = re.match(r"^(?:进度|完成度|完成率)\s*[:：]?\s*(\d{1,3})\s*%", s)
            if m:
                _p = int(m.group(1))
                if 0 <= _p <= 100:
                    progress = _p
            m = re.match(r"^(due|deadline|ship(?:s|ping)?)\s*[:\-]?\s*(.+)$", s, re.I)
            if m:
                due = m.group(2).strip()
            m = re.match(r"^(?:截止/关键节点|截止日?期?|到期日?|交付日期|关键节点|上线时间|完成时间)"
                         r"\s*[:：]\s*(.+)$", s)
            if m:
                due = m.group(1).strip()
            m = re.match(r"^(summary|overview|goal)\s*[:\-]\s*(.+)$", s, re.I)
            if m and not summary:
                summary = m.group(2).strip()
            m = re.match(r"^(?:进展摘要|摘要|概述|目标|简述)\s*[：:]\s*(.+)$", s)
            if m and not summary:
                summary = m.group(1).strip()
            m = re.match(r"^(?:阻碍项|阻碍|阻塞|卡点|风险点)\s*[：:]\s*(.+)$", s)
            if m:
                blockers.append(m.group(1).strip()[:180])
                continue
            # rich-align-0722/01: 项目级「风险：等级/原因」。长标签优先——`风险点：` 已在上面被
            # blockers 消费并 continue，永不到这；`^风险[：:]` 也匹配不到 `风险点：`（点隔在中间）。
            # 🔴 一旦是 `风险：` 行就 continue：哪怕等级词表外（parse 返回 None，整行不抽为 risk），
            # 也不能让下面的英文 blocker 嗅探把「风险：高/waiting on 供应商」误当卡点收走。
            m = re.match(r"^(?:风险|风险等级|风险级别|risk)\s*[：:]\s*(.+)$", s, re.I)
            if m:
                parsed = parse_risk_value(m.group(1))
                if parsed:
                    risk = parsed
                continue
            if re.search(r"\b(blocker|blocked|waiting on|stuck|unresolved|no sign-?off|"
                         r"acceptance (?:not|un)|not defined)\b", s, re.I):
                blockers.append(s.lstrip("-*• ").strip()[:180])
        if not title:
            title = re.sub(r"\.[a-z0-9]+$", "", doc.name).replace("_", " ").strip()
        if not status:
            # Two independent guards on the same fallback, one from each line — both kept:
            # 054: sniffing the WHOLE document for a status only makes sense when the document is
            #      about one project; across a segmented weekly it would smear project 3's
            #      「受阻」 onto all six. So scope the sniff to this project's own span.
            # 056: risk_only, because this is PROSE, not a self-report. Escalating on prose is
            #      fine (bias points at a second look); handing out 可推进 because the word 正常
            #      happens to appear somewhere in the weekly is not.
            status = _norm_status(doc.text if whole_doc
                                  else "\n".join(doc.lines[lo:min(hi, len(doc.lines))]),
                                  risk_only=True)
        if not summary:
            first = next((doc.lines[i].strip() for i in range(lo, min(hi, len(doc.lines)))
                          if doc.lines[i].strip() and not doc.lines[i].strip().startswith("#")), "")
            summary = first[:200]
        return ProjectEntity(
            id=_slug(title, "p"), title=title, ownerName=owner, status=status, progress=progress,
            dueDate=due, summary=summary, blockers=blockers[:6], risk=risk, milestones=milestones,
            source=f"{doc.name}:{lo + 1}")

    def _signals_from_doc(self, doc: ParsedDoc) -> ExtractionResult:
        """Doc-derived R1 signals: '12 unresolved comments', 'acceptance not set', 'reworked N days
        running'. A person-directed signal STAYS at situation (never a label on the person)."""
        res = ExtractionResult()
        proj_ref = ""
        # anchor person/project signals to the first project title if present
        for i, ln in enumerate(doc.lines):
            s = ln.strip()
            low = s.lower()
            sig_text = ""
            tag = ""
            if re.search(r"\b\d+\s+unresolved\b|\bunresolved (comments|feedback)\b", low):
                sig_text = s[:200]
                tag = "no-update"
            elif re.search(r"acceptance (criteria )?(?:not|un)|no sign-?off|definition of done", low):
                sig_text = s[:200]
                tag = "repeated-blocker"
            elif re.search(r"reworked|reopened|kept moving|changing (feedback|requirements)", low):
                sig_text = s[:200]
                tag = "stalled"
            elif re.search(r"\b(absorbed|took on|handled|carrying|soaked up)\b.*\b\d+\b|"
                           r"\b\d+\s+(?:new )?(?:client )?(?:change requests?|changes|interruptions?)\b",
                           low):
                # interrupt/workload line — usually person-directed (R1 doc-derived person signal)
                sig_text = s[:200]
                tag = "interrupt"
            if not sig_text:
                continue
            # is this signal about a PERSON? if it names one, keep it at SITUATION.
            person = self._first_person_name(s)
            if person:
                # red-line-safe framing: describe what she is carrying, not a judgment.
                res.signals.append(SignalEntity(
                    id=_slug(sig_text, "s"), source_kind="doc", subjectType="person",
                    subjectRef=person,
                    summary=self._situationalize(person, sig_text), tag="interrupt",
                    source=f"{doc.name}:{i + 1}"))
            else:
                res.signals.append(SignalEntity(
                    id=_slug(sig_text, "s"), source_kind="doc", subjectType="project",
                    subjectRef=proj_ref or "the project", summary=sig_text, tag=tag,
                    source=f"{doc.name}:{i + 1}"))
        return res

    @staticmethod
    def _first_person_name(text: str) -> str:
        # crude: a capitalized 1-2 word name followed by a verb like absorbed/spent/reworked/carried
        m = re.search(r"\b([A-Z][a-z]+(?: [A-Z][a-z]+)?)\b\s+(?:absorbed|spent|reworked|carried|"
                      r"took on|handled|is carrying|was)\b", text)
        if m and m.group(1).strip().lower() not in _NOT_NAME:
            return m.group(1).strip()
        return ""

    @staticmethod
    def _situationalize(person: str, text: str) -> str:
        """Force a person-directed signal into situation language (the red line for people-signals):
        it must read as 'what she is carrying', never as a rating/label on her."""
        # If the source already reads as situation ("absorbed a week of change"), keep it; otherwise
        # prefix a situational frame. Never emit a judgment word.
        return f"{text}".strip()

    # materials ------------------------------------------------------------

    def _materials(self, doc: ParsedDoc) -> ExtractionResult:
        """Chunk every doc into line-addressable material for the RAG. Skips pure header/table
        scaffolding lines; keeps sentence-ish content."""
        res = ExtractionResult()
        for i, ln in enumerate(doc.lines):
            s = ln.strip().lstrip("#").strip()
            if len(s) < 12:
                continue
            if s.lower() in _NOT_NAME:
                continue
            res.materials.append(MaterialChunk(
                id=f"{doc.name}:{i + 1}", text=s, source=f"{doc.name}:{i + 1}",
                doc_kind=doc.doc_kind))
        return res


def _default_max_workers() -> int:
    """Concurrency for document-level extraction. `AVERY_INGEST_CONCURRENCY` (default 4).

    The cap IS the rate-limit guardrail: LLM extraction fans out one blocking `brain.respond()` per
    doc, and a bursty fan-out is what tripped the earlier M3 429. Bounded on purpose."""
    try:
        n = int(os.environ.get("AVERY_INGEST_CONCURRENCY", "4"))
    except ValueError:
        n = 4
    return max(1, n)


def extract_docs(docs: list[ParsedDoc], extractor: Extractor | None = None,
                 max_workers: int | None = None) -> ExtractionResult:
    """Run an extractor across many docs and merge. Then resolve project ownerName -> ownerId
    against extracted people so cards link up.

    Documents are extracted CONCURRENTLY with a bounded ThreadPoolExecutor — each
    `extractor.extract(doc)` makes blocking `brain.respond()` HTTP calls (which release the GIL
    during network I/O), so a 10-file upload runs in ~max(one file) instead of ~sum. Concurrency is
    bounded by `max_workers` (env `AVERY_INGEST_CONCURRENCY`, default 4); the cap is the rate-limit
    guardrail. Results are merged in ORIGINAL input order, so the output is byte-identical to the
    sequential path — only wall-time changes. `_link_owners` runs ONCE, post-merge, single-threaded.

    Exception semantics are UNCHANGED from the sequential loop: a raising extractor propagates and
    sinks the batch (the pool surfaces the first exception via `future.result()`); errors are never
    newly swallowed. (In practice `LLMExtractor.extract` catches internally and falls back per-doc.)
    """
    ex = extractor or HeuristicExtractor()
    workers = max_workers if max_workers is not None else _default_max_workers()
    effective = min(workers, len(docs))

    out = ExtractionResult()
    if effective <= 1:
        # Sequential fast-path — byte-identical to the original loop (single doc / heuristic /
        # AVERY_INGEST_CONCURRENCY=1). No threads, no pool overhead.
        for d in docs:
            out.merge(ex.extract(d))
    else:
        # Concurrent across documents; merge in ORIGINAL order for deterministic output. Surface the
        # first exception (future.result re-raises) so behavior matches sequential except wall-time.
        with ThreadPoolExecutor(max_workers=effective) as pool:
            futures = [pool.submit(ex.extract, d) for d in docs]
            for f in futures:
                out.merge(f.result())

    # feat-054 — THE GRANULARITY GATE, before dedup on purpose: a milestone is judged against the
    # document that nested it, and after dedup that provenance is already merged away. Every
    # decision (kept and demoted alike) is recorded on the result so "why isn't this a project?"
    # has an answer that cites the document rather than a threshold.
    out.granularity = apply_gate(out, docs)

    _dedupe_entities(out)
    _link_owners(out)
    return out


def _note_conflicts(res: ExtractionResult, index: dict, kind: str, cur, incoming, key: str,
                    held_src: dict[tuple[str, str], str]) -> None:
    """T6/B2a — 在 `cur` 吸收 `incoming` **之前**，把这一轮将要被丢弃的读数记下来。

    必须在合并之前调用：合并之后 `cur` 上已经是胜出值，输家不复存在。

    判据（v1，三条一起成立才算冲突）：
      1. 新来的那个格子**非空**——空不是一个读数，是「这份文档没说这件事」；
      2. 已有的那个格子**非空**——否则这不是冲突，是 enrichment（空格子被填上）；
      3. 两者**完全不相等**——同义不同写不归这里管（T7 的 dismiss 出口）。

    🔴 判据用 `if not value` 而不是 `is None`，是因为这三个字段（team/status/dueDate）在
    dataclass 上都是 `str` 且缺席即 `""`；`_dedupe_entities` 对它们走的也正是 `or`。**不要把这个
    写法照抄给 `progress`**——那个字段 0 是合法读数，`not 0` 为真会把真读数当成缺席
    （test_project_progress_uses_is_None_so_ZERO_is_a_real_reading 钉着这件事）。
    """
    for fname in _CONFLICT_FIELD_ALLOWLIST[kind]:
        new = getattr(incoming, fname, "")
        if not new:
            continue
        held = getattr(cur, fname, "")
        if not held:
            # 空格子这一轮会被 `or` 填上——把出处一并记住，它才是这个值真正的来源文档。
            held_src[(key, fname)] = incoming.source
            continue
        if held == new:
            continue
        _append_conflict(res, index, kind, key, cur.id, fname,
                         held, held_src.get((key, fname), cur.source), new, incoming.source)


def _append_conflict(res: ExtractionResult, index: dict, kind: str, key: str, ref: str, fname: str,
                     held: str, held_source: str, new: str, new_source: str) -> None:
    """一个 (主体, 字段) 只长**一条** FieldConflict，第三份、第四份资料往 `values` 上追加。

    ⚠ 出处为什么不能直接用 `cur.source`：`cur.source` 自己也是 keep-first 的**整条**出处，而某个
    格子的值完全可能是后来某份文档补上的（enrichment）。拿 cur.source 当那个格子的出处，就会在卡
    上引用一份**从没说过这件事**的文档——比不报冲突更糟。所以逐 (主体,字段) 记 `held_src`。

    🔴 ONE RULER —— `index` 的键必须是**归并用的那把身份尺**（`key` = `_person_key`/`_project_key`
    的产物），**绝不能**用 `cur.id`。第一版用了 `cur.id`，是个真 bug，复现过：`_slug` 会折叠标点
    并在 32 字符处截断，而 `_project_key` 只折叠空白与 `_ -`。于是
    「别墅套餐推广（八月）」与「别墅套餐推广(八月)」（全角/半角括号，中文文档里再普通不过的排版差异）
    是**两个不同的项目卡**（_project_key 不同、各自独立存在），却**共用一个 id**。用 id 当索引键，
    两张卡各自的冲突会被**融成一条**：第一张卡凭空多出一条别的项目才有的读数，第二张卡自己的冲突
    整条消失。身份判据只能有一把尺子——就是归并本身用的那把。
    钉在 test_two_projects_sharing_a_slug_id_do_not_fuse_their_conflicts。

    `ref`（写进 `subject_ref` 给前端 join 卡片）仍然是 `cur.id`，因为卡就是按 id 渲染的；
    它只是**载荷**，不是索引键。
    """
    hit = index.get((kind, key, fname))
    if hit is not None:
        hit.values.append(ConflictValue(value=new, source=new_source,
                                        doc_key=doc_key_of(new_source)))
        return
    fresh = FieldConflict(
        subject_kind=kind, subject_ref=ref, field=fname,
        values=[
            ConflictValue(value=held, source=held_source, doc_key=doc_key_of(held_source)),
            ConflictValue(value=new, source=new_source, doc_key=doc_key_of(new_source)),
        ])
    index[(kind, key, fname)] = fresh
    res.conflicts.append(fresh)


def _disambiguate_person_ids(survivors: list[PersonEntity]) -> None:
    """差距战役 T5/A2 —— 同名不同工号的两张卡**不许撞 id**。

    `_slug` 只看姓名，所以 `_resolve_person_slot` 一旦按工号把两个同名的人分成两张卡，这两张卡的
    `id` 就是同一个字符串。`id` 是前端的 join key（`signal.subjectId === detail.id`、
    `project.ownerId`、卡片列表的 React key），撞了不会报错，只会让 A 的信号显示在 B 的详情里——
    正是 `_append_conflict` 那条 🔴 讲过的同一种静默错误，换了个主体。

    只在**真撞上**时改后来那张卡的 id，优先用工号重铸（稳定、可读、与姓名同源），工号也撞不出唯一
    值时再挂序号。今天仓库里没有任何语料会让两张人卡撞 id（同名恒被并成一张），所以这一趟对存量
    数据是 byte-identical 的 no-op。
    """
    seen: set[str] = set()
    for p in survivors:
        if p.id not in seen:
            seen.add(p.id)
            continue
        fresh = _slug(f"{p.name}-{p.person_id}", "u") if p.person_id else ""
        n = 2
        while not fresh or fresh in seen:
            fresh = f"{p.id}-{n}"
            n += 1
        p.id = fresh
        seen.add(fresh)


class PersonIndex:
    """差距战役 T5/A2 —— 「谁是谁」的那本索引：一批人员实体 → 归并用的格子。

    **工号第一，姓名兜底，两个不同的工号永不并成一个人。** `resolve()` 的四条规则，按顺序：

      1. 工号对上 → 就是这个人（哪怕两份资料叫她不同的名字：花名册写「周雅」、周报链接写「小周」，
         同一个 `MKT-001` 仍然是一张卡）。这是本票存在的一半理由。
      2. 工号对不上（或这条读数没工号）→ 退回姓名。**除非**双方工号都非空且不同 —— 那是两个恰好
         同名的人（张伟/王芳在中文名册里是常态），并成一张卡就是把 A 的负载挂到 B 的头上。
      3. 这个姓名底下**已经有不止一个人**（上一条已经把他们分开过）而这条读数**没有工号** →
         也不并。谁都对得上就是谁都对不上；从两个周雅里挑第一个，是一次不会报错的掷硬币，
         而掷出来的结果是把一个人的负载写到另一个人的卡上。宁可多一条认不出主人的记录。
      4. 都对不上 → 开新的一格。

    键的形状（`#id:` / `#name:` 前缀）只是内部命名空间，防止一个工号恰好等于另一个人的姓名键。

    🔴 **没有任何一份资料带工号时，`resolve()` 逐字退化成 `_person_key(p.name)` 那一行**：
    `by_id` 恒空、规则 2/3 的条件恒假（规则 3 要先有规则 2 分出来的同名两条），于是 key 恒为
    `"#name:" + _person_key(name)`，与旧代码一一对应。今天仓库里的全部语料都在这条路上——所以
    T6 的钉死门（test_dedupe_characterization_b2a）必须仍然全绿，它绿就是「旧行为一个字节没动」
    的证明。
    """

    def __init__(self, people=()):
        self.slots: dict[str, PersonEntity] = {}
        self._by_id: dict[str, str] = {}
        self._by_name: dict[str, str] = {}
        # 同一个姓名底下的**全部**格子（规则 3.5 要在候选之间按部门挑，只记「第一格」不够用）。
        self._name_keys: dict[str, list[str]] = {}
        self._dupe_names: set[str] = set()
        for p in people:
            self.place(self.resolve(p), p)

    def resolve(self, p: PersonEntity) -> str:
        ik = _person_id_key(p.person_id)
        nk = _person_key(p.name)
        if ik:
            hit = self._by_id.get(ik)
            if hit is not None:
                return hit
        hit = self._by_name.get(nk)
        if hit is not None and nk not in self._dupe_names:
            held = _person_id_key(self.slots[hit].person_id)
            if not (ik and held and ik != held):
                return hit
        # 规则 3.5（0807 HITL 补）：名字歧义、这条读数没工号，但**文档自己写了部门**。
        # 花名册里两位「林小满」（前厅部 / 康乐部），纪要上写「参会：…林小满（前厅部）」——
        # 这不是猜，是读：候选里恰好只有一位在前厅部，那句话说的就是她。
        # 🔴 只在**恰好一位**候选对得上时才认；对上两位（同名又同部门）或一位都对不上，
        #    立刻退回规则 3 的老口径（另开一格，宁可多一条认不出主人的记录）——
        #    有二次判据就用，没有就不猜，绝不把「像谁」当成「是谁」。
        if not ik and nk in self._dupe_names:
            team = (p.team or "").strip()
            if team:
                same = [k for k in self._name_keys.get(nk, ())
                        if (self.slots[k].team or "").strip() == team]
                if len(same) == 1:
                    return same[0]
        return f"#id:{ik}" if ik else f"#name:{nk}"

    def place(self, key: str, p: PersonEntity) -> None:
        """把 `p` 记成 `key` 这一格的住户（已有住户就什么都不做——住户是先到的那个）。"""
        if key in self.slots:
            return
        self.slots[key] = p
        if _person_id_key(p.person_id):
            self._by_id[_person_id_key(p.person_id)] = key
        nk = _person_key(p.name)
        self._name_keys.setdefault(nk, []).append(key)
        if nk in self._by_name:
            self._dupe_names.add(nk)     # 这个名字底下从此有两个人，不再是一把够用的尺
        else:
            self._by_name[nk] = key

    def adopt_id(self, key: str, person_id: str) -> None:
        """某一格补上了工号（花名册没写、表单带来了）——从此这一格按工号也认得出来。"""
        if _person_id_key(person_id):
            self._by_id[_person_id_key(person_id)] = key

    def name_is_ambiguous(self, name: str) -> bool:
        """这个姓名底下站着不止一个人吗？（规则 3 的判据，回流那边也要问同一个问题。）"""
        return _person_key(name) in self._dupe_names


def _absorb_self_report(cur: PersonEntity, p: PersonEntity) -> None:
    """rich-align-0722/03 —— self_report enriches across docs, keep-first PER sub-slot: a roster
    carries identity + no self-report, a weekly carries the self-report + no identity. Merge so
    the person who actually exists has both, without a later weekly clobbering an earlier one.

    T10 把它从 `_absorb_person` 里提出来，是因为补传路（`AppendLedger.absorb`）也要它，而
    「怎么合一个自述槽」在仓库里只许有一份定义 —— 人身数字是本仓最敏感的那一格，两处各写一遍
    等于给它开两条口径不同的入口。补传路上的「新的顶掉旧的」不在这里做：那是
    `form_reflow.clear_stale_self_report` 先把过期的槽清空，然后本函数照旧 keep-first 填回来
    （T5 定的那条路，只有一个「谁更新」的判据）。"""
    if not p.self_report:
        return
    if cur.self_report is None:
        cur.self_report = p.self_report
        return
    if cur.self_report.load is None:
        cur.self_report.load = p.self_report.load
    if cur.self_report.mood is None:
        cur.self_report.mood = p.self_report.mood


def _absorb_person(cur: PersonEntity, p: PersonEntity) -> bool:
    """`cur` 吸收 `p`（同一个人的另一条读数）。就地改 `cur`，返回「这一趟补上了工号吗」。

    ONE DEFINITION（T5/A2 把它从 `_dedupe_entities` 的循环体里提了出来）。两个调用方：
      · `_dedupe_entities` —— 整批语料的跨文档归并（上传那条路）；
      · `form_reflow.merge_person_reading` —— 表单回流时把**一条**新读数并进已经归并过的清单。
    提出来不是为了好看：两处各写一遍「怎么合一个人」，就是 `_person_key` / `_link_owners` 当年那种
    「两把尺量同一件事」的复发，而这一次两把尺分别长在上传路和表单路上，谁也不会在对方的门里红。

    #87：keep-first 的三个标量从 `cur.x = cur.x or p.x` 改写成显式的 if —— **结果逐字未变**
    （`test_dedupe_characterization_b2a` 是它的钉子），改的只是「这一格到底是不是 p 填的」现在
    有人问得出来，血缘才搬得动（`adopt_field_lineage`）。上传路**不记 prev**：keep-first 下
    活着的是先到那个值，没有任何读数被覆盖——输家去 `conflicts`，不去 prev。
    """
    grew_id = False
    # T5/A2 — 工号是**补上就补上**（花名册没工号、表单带工号），补上之后这条卡从此按工号认人。
    if not _person_id_key(cur.person_id) and _person_id_key(p.person_id):
        cur.person_id = p.person_id
        grew_id = True
    for fname in ("role", "team", "tenure"):
        if not getattr(cur, fname, "") and getattr(p, fname, ""):
            setattr(cur, fname, getattr(p, fname))
            adopt_field_lineage(cur, p, fname)
    cur.source = cur.source or p.source          # 实体级 keep-first 出处，不是某一格的血缘
    _absorb_self_report(cur, p)
    # union, order-preserving, capped at the same 6 _slist/_build use
    for fname in ("owns", "collaboration"):
        held = getattr(cur, fname)
        fresh = [x for x in getattr(p, fname) if x and x not in held]
        if fresh:
            setattr(cur, fname, (held + fresh)[:6])
            adopt_field_lineage(cur, p, fname)
    absorb_sources(cur, p)                       # 这份文档提到过这张卡（改不改得动一格都算数）
    return grew_id


def _absorb_project(cur: ProjectEntity, pr: ProjectEntity) -> None:
    """`cur` 吸收 `pr`（同一个项目的另一条读数）。就地改 `cur`。

    ONE DEFINITION（T10 把它从 `_dedupe_entities` 的循环体里提了出来，理由与 `_absorb_person`
    当年被提出来时**逐字**一样）：上传路（`_dedupe_entities`）与补传路（`merge_project_reading`）
    各写一遍「怎么合一个项目」，就是两把尺量同一件事，而这一次两把尺分别长在两条路上，
    谁也不会在对方的门里红。

    规则一个字节没动（钉在 test_dedupe_characterization_b2a）：
      · 标量 `or` 保留第一个非空；
      · `progress` 用 `is None` 而不是 `or`/`not` —— **0 是合法读数**
        （test_project_progress_uses_is_None_so_ZERO_is_a_real_reading）；
      · `risk` 整个对象 keep-first、`milestones` 整张列表 keep-first（rich-align-0722/01、02）；
      · blockers/dependsOn 保序并集，与 `_absorb_person` 的 owns/collaboration 同一个 6 上限；
      · `id` / `title` / `archived` / `provenance` **一个都不碰**。

    #87：与 `_absorb_person` 同一次改写——`or` 换成显式 if（结果逐字未变），只为让「这一格是不是
    pr 填的」问得出来，好把血缘搬过去。`ownerId` 刻意不记血缘：它是 `_link_owners` 解出来的派生
    join key，不是一条读数。
    """
    cur.ownerId = cur.ownerId or pr.ownerId   # 派生 join key —— 不是读数，不记血缘
    for fname in ("ownerName", "status", "dueDate", "summary"):
        if not getattr(cur, fname, "") and getattr(pr, fname, ""):
            setattr(cur, fname, getattr(pr, fname))
            adopt_field_lineage(cur, pr, fname)
    cur.source = cur.source or pr.source
    if cur.progress is None:
        cur.progress = pr.progress
        if pr.progress is not None:
            adopt_field_lineage(cur, pr, "progress")
    if cur.risk is None:                      # rich-align-0722/01: keep-first risk across docs
        cur.risk = pr.risk
        if pr.risk is not None:
            adopt_field_lineage(cur, pr, "risk")
    if not cur.milestones:                    # rich-align-0722/02: keep-first milestones across docs
        cur.milestones = pr.milestones
        if pr.milestones:
            adopt_field_lineage(cur, pr, "milestones")
    for fname in ("blockers", "dependsOn"):
        held = getattr(cur, fname)
        fresh = [x for x in getattr(pr, fname) if x and x not in held]
        if fresh:
            setattr(cur, fname, (held + fresh)[:6])
            adopt_field_lineage(cur, pr, fname)
    absorb_sources(cur, pr)                   # 这份文档提到过这张卡


def _disambiguate_project_ids(survivors: list[ProjectEntity]) -> None:
    """T10 —— 项目卡之间**不许撞 id**。`_disambiguate_person_ids` 的项目孪生，一字不差同一个理由。

    `_slug` 折叠标点并在 32 字符处截断，而 `_project_key` 只折叠空白与 `_ -`：
    「别墅套餐推广（八月）」与「别墅套餐推广(八月)」是**两张卡**（_project_key 不同），
    却**共用一个 id**（test_two_projects_sharing_a_slug_id_do_not_fuse_their_conflicts 里那对）。
    id 是前端的 join key（`signal.subjectId === detail.id`、`project.ownerId`、列表 React key），
    撞了不会报错，只会让 A 的信号显示在 B 的详情里。

    上传那条路今天靠 `_dedupe_entities` 之后没人再加卡而侥幸没炸；补传这条路会往一份**已经在用**
    的清单末尾追加新卡，撞 id 就成了必然。只在**真撞上**时改后来那张卡的 id（先到的那张不动——
    经理正对着它编辑/归档）。存量数据上是 byte-identical 的 no-op。
    """
    seen: set[str] = set()
    for pr in survivors:
        if pr.id not in seen:
            seen.add(pr.id)
            continue
        fresh = ""
        n = 2
        while not fresh or fresh in seen:
            fresh = f"{pr.id}-{n}"
            n += 1
        pr.id = fresh
        seen.add(fresh)


# ── T10 · append-upload（补资料）—— 把一批新资料的读数并进一份**已经在用**的 extraction ────────
#
# 上传路（`_dedupe_entities`）是一次性的：它对着一份刚建出来的 ExtractionResult 跑一遍，跑完这份
# 东西才第一次被人看见。补传路不是——它要动的那张表已经渲染在经理屏幕上、被手编 CRUD 改过、被
# 归档过，还挂着上一轮记下来的冲突。`merge_person_reading` 的 docstring 逐条列了直接重跑
# `_dedupe_entities` 会造成的四种伤；本节就是那四条各自的正面答案：
#
#   坑① 整表重写吞手编/软删/出处 → 本节只碰**点名**的那一个主体，`id`/`name`/`title`/`archived`/
#        `provenance` 一个都不改写，手编（origin='manual'）的格子恒不被文档顶掉。
#   坑② 旧冲突重复记账     → `AppendLedger` 的 conflict_index 从**持久化的** `extraction.conflicts`
#        重建（不是每次新建），同一 (主体,字段) 只长一条 FieldConflict；同一条读数（值+出处）
#        已经在里面就不再追加 —— 同一批语料补传两次，冲突行数不翻倍。
#   坑③ held_src 记错      → 逐字段出处走 `provenance` 侧车（本来就是为「这一格是谁给的」存在的、
#        且跨 `get()` 活着的那本账），只有侧车没有这一格时才退回实体级 `source`（正是 dataclass
#        注释里「未列的字段=doc 出处，source=本实体 self.source」那句话）。
#   坑④ signals 换尺重筛   → 见 `merge_signal_readings`：先把两边都换成 id，再按同一把尺去重。
#
# 🔴 拍板③「安静更新」（.issues/gap2-0807/tickets.md）在这里落成一句可执行的话：
# **只有在确凿地知道新资料更新时，才让新值顶掉旧值。** 不知道（哪一边的 uploaded_at 认不出来、
# 那份资料已经不在 source_documents 里）一律退回 keep-first —— 与 `clear_stale_self_report`
# （form_reflow.py）逐字同一条口径：绝不靠猜去改写一个有出处的读数。
DOC_PROVENANCE_ORIGIN = "doc"
MANUAL_PROVENANCE_ORIGIN = "manual"

# 一份更新的资料**可以改写**哪些格子。刻意与 `_CONFLICT_FIELD_ALLOWLIST` 分成两张表：那张答的是
# 「哪些分歧要记账、上今天页」，这张答的是「哪些格子允许被新资料顶掉」。两件事的答案不一样——
# `role`/`summary` 该安静更新但不值得上今天页，`team`/`status` 两件都要。
# 🔴 不在表里的字段恒不被改写：`id`/`name`/`title`（是身份，改了经理的卡就自己改名了）、
# `source`（实体级 keep-first 出处）、`archived`/`provenance`（手编领域）、`person_id`（工号只补不改，
# 见 `_absorb_person`：两个不同工号在 `PersonIndex` 里根本走不到同一格）。
_APPEND_REFRESHABLE: dict[str, tuple[str, ...]] = {
    "person": ("role", "team", "tenure"),
    "project": ("ownerName", "status", "dueDate", "summary", "progress", "risk", "milestones"),
}
# 并集字段：新读数只**添**不**顶**（两份资料各列一半阻塞是常态，不是分歧）。上限 6 与
# `_absorb_person`/`_absorb_project` 同一个数，不是第二把尺。
_APPEND_UNIONED: dict[str, tuple[str, ...]] = {
    "person": ("owns", "collaboration"),
    "project": ("blockers", "dependsOn"),
}
_APPEND_LIST_CAP = 6


def _reading_absent(value) -> bool:
    """「这份文档没说这件事」= 空串 / None / 空列表。

    🔴 判据是**逐类型的等值比较**，不是真值性：`progress=0` 是一条合法读数（文档真写了 0%），
    `not 0` 为真会把它当成缺席，正是 `_note_conflicts` 上那条 ⚠ 点名警告过的写法
    （test_project_progress_uses_is_None_so_ZERO_is_a_real_reading 钉着它）。
    """
    if value is None:
        return True
    if isinstance(value, str):
        return value.strip() == ""
    if isinstance(value, (list, tuple)):
        return len(value) == 0
    return False


# ── issue #87 · 实体血缘 —— 「这张卡来自哪几份文件、每一格是哪一份给的」 ───────────────────────
#
# 病（design-0810 §6.1 + `file_delete.py` 头）：Avery 读一份文件时干两件事——①把原文与切片存起来
# ②**从原文得出结论写到卡片上**。`delete_document_from_context` 只收走①，②留在卡上。于是删掉
# 《旺季排班协调纪要.md》之后：文件没了、原话搜不到了，**项目卡负责人还是「小马」**，
# `materialize_memory` 每次还把 `Project '婚宴对接' (owner: 小马)` 写回 facts.md，顾问继续引用它。
# #77 当时的裁定是「诚实的降级」，理由是**血缘不够**：实体只有一个**单值** `source`、归并是
# keep-first，删完只知道「少了一份来源」，不知道「少了之后该变成什么」。本节补的就是那句话，
# 也是「逐条撤回」（票 7）唯一缺的那块地基——旧值在 `AppendLedger.absorb` 里被 `setattr` 抹掉，
# `reg.put()` 是整快照 DELETE+INSERT，无历史无 journal。
#
# ## 形状
#   lineage = {
#     "docs":   ["旺季排班协调纪要.md", "项目台账.md"],       # 提到过这张卡的文档（doc_key 粒度）
#     "fields": {"ownerName": {"source": "旺季排班协调纪要.md:12",
#                              "batch_id": "b-…",            # 这一格是哪一批补传写的（首次上传没有）
#                              "seeded": True,               # 见下「推出来的 vs 记下来的」
#                              "prev": {"value": "老周", "source": "项目台账.md:7", "prev": {...}}}}
#   }
#
# ## 两个键回答**两个不同的问题**，别混着用
#   · `docs`   —— 「**哪些文档提到过这张卡**」。凡是有一条读数落到这张卡上（哪怕它一格都没改写、
#     哪怕它输给了 keep-first、哪怕手编赢了），那份文档就在这里。它答的是「删光之后这张卡还有没有
#     文档依据」，**不是**「删掉它卡上要改什么」。
#   · `fields` —— 「**这一格现在这个值是哪一份文档的哪一行给的**」。它才是「删掉之后该变成什么」
#     的判据。
#
# ## 推出来的 vs 记下来的（`seeded`）
# 一张卡刚被抽取器铸出来时，它每一格都来自 `source` 那一份文档——所以 `__post_init__` 就地播种
# 一次，那一趟是**精确**的。同一条路顺带把 **#87 之前落库的存量卡**接住（它们没有 lineage 键，
# 回读时照 `source` 推一次）。存量多文档卡上 enrichment 来的那几格可能记错文档，所以打 `seeded`
# 标：`docs` 只有一条时它恒精确，多于一条时消费方自己决定信不信。写路（归并/补传）真记下来的
# 记录**不带**这个标。
#
# ## 🔴 为什么不写进 `provenance`（订正 design-plan §7.2 的第一条建议——三条都是读码核过的）
#   1. `registry._one_person_card` / `_one_project_card` 把 `dict(pr.provenance)` **原样**投给
#      浏览器，而 `LiveFieldProvenance`（transport.ts:270）是 `{origin, source, updated_at}` 的
#      **闭**契约；往里塞 prev 链等于把一串旧值送上线，还要穿过 `stripPersonNumbers`
#      （它对 `provenance` 整键放行）。
#   2. **首次上传的格子根本没有 provenance**——`stamp()` 只在补传/手编/表单回流三处开火。而本票
#      要修的正是首次上传铸出来的那张卡：provenance 结构上装不下它。
#   3. `origin:'doc'` 在屏幕上的意思是「**被后来的上传顶掉过**」（`projectView.provenanceBadgeKind`
#      + `DetailOverlay.tsx:314`），也正是 #85 只读清单便宜的全部理由（design-plan §7.1①）。
#      首次上传就写 provenance，会把那枚角标变成一句集体谎话。
# 代价是**一次迁移**：`lineage` 是 `PersonEntity` 的顶层键，`0009` 的 allowlist 必须就地加上它
# （`test_person_keys_allowlist_covers_exactly_person_fields` 一加字段就红，那个红就是这句话的
# 可执行版本），而动了 pg 腿就必须跑 `@needs_db`。
#
# ⚠ 与 `provenance` 的分工：provenance 答「这一格现在归谁」（doc/manual/form，手编赢），
# lineage 答「这一格的**文档**出处是什么」。手编改一格**不动** lineage——那不是发明，是这两个问题
# 的正确答案：经理接管一格之后，那一格的文档血缘并没有变，只是不再由文档说了算。
_LINEAGE_CHAIN_DEPTH = 8


def _lineage_fields(kind: str) -> tuple[str, ...]:
    """血缘只跟**文档写得动的那些格子**——恰好是 `_APPEND_REFRESHABLE` + `_APPEND_UNIONED`。

    刻意不跟的：`id`/`name`/`title`（身份，不是读数，删掉一份文档也不该让一张卡改名）、
    `source`/`person_id`（join key）、`archived`/`provenance`（手编领域）、
    `ownerId`（派生 join key，由 `_link_owners` 解）、`self_report`（**自带出处**：
    `SelfReportLoad.source` / `SelfReportMood.source` 就是那一格的血缘，再记一份就是两份抄本）。
    """
    return _APPEND_REFRESHABLE.get(kind, ()) + _APPEND_UNIONED.get(kind, ())


def _jsonable(value):
    """把一个字段值拍平成 JSON 原生形状 —— `prev.value` 写进去之前必过这一道。

    🔴 理由是这个仓库吃过的那口：`pg_registry` 存 `asdict(entity)`、回读走 `ProjectEntity(**payload)`，
    于是内存里是 `ProjectRisk` 对象、库里回来是 dict。`risk`/`milestones` 当年就是这么在**持久化
    那条路上**炸的（rich-align-0722 的血教训，两个 `__post_init__` 强转是它的补丁）。血缘是
    side-car、没有强转的地方，所以只能在**写入那一刻**就消除这个差别：两条腿由构造相同。
    """
    if is_dataclass(value) and not isinstance(value, type):
        return asdict(value)
    if isinstance(value, (list, tuple)):
        return [_jsonable(v) for v in value]
    if isinstance(value, dict):
        return {k: _jsonable(v) for k, v in value.items()}
    return value


def _lineage_of(entity) -> dict:
    """拿到（必要时就地建出）这张卡的 lineage dict。脏数据（不是 dict）就重开一本，不炸。"""
    lin = getattr(entity, "lineage", None)
    if not isinstance(lin, dict):
        lin = {}
        try:
            entity.lineage = lin
        except Exception:                       # 只读对象——血缘记不下来，但绝不因此毁掉一次抽取
            return {}
    return lin


def note_source_doc(entity, source: str) -> None:
    """把 `source` 那份文档记进这张卡的**来源文档集合**（`lineage["docs"]`）。

    粒度是 `doc_key_of` 切出来的**文档名**——与 `file_delete` 逐条判「这条读数算哪份文档的」
    用的是同一把尺（ONE RULER；漂开的下场是删除漏切/多切且没有一道门会红）。
    保序、去重、**不设上限**：上限会让「这张卡不是这份文档喂的」变成一句假话，正是
    `_APPEND_LIST_CAP` 在并集字段上那条已知的、票面点名过的伤（第 7 项起不可恢复）。
    """
    key = doc_key_of(source or "")
    if not key:
        return
    lin = _lineage_of(entity)
    docs = lin.get("docs")
    if not isinstance(docs, list):
        docs = []
        lin["docs"] = docs
    if key not in docs:
        docs.append(key)


def _trim_chain(link: dict, budget: int) -> dict:
    """prev 链封顶：最多留 `budget` 环，砍掉**最老**的那一头（撤回从最新往回走，老的先失效）。

    🔴 砍掉的地方打 `truncated: True`。静默截断会让「第 N 次之前的旧值还在」读成一句真话——
    与 `[:6]` 那条并集截断同一族的错误，只是这一次我们自己有得选。
    """
    out = {k: v for k, v in link.items() if k != "prev"}
    inner = link.get("prev")
    if not isinstance(inner, dict):
        return out
    if budget <= 1:
        out["truncated"] = True
        return out
    out["prev"] = _trim_chain(inner, budget - 1)
    return out


def prev_link(entity, fname: str, held) -> dict:
    """把这一格**即将被毁掉**的读数打成一条 prev —— 必须在 `setattr` **之前**调。

    值取自实体（`held`，调用方手里那个即将被覆盖的值），出处取自 lineage 里这一格现有的记录；
    这一格原来那条 prev 自然接在后面成链。链在 `_LINEAGE_CHAIN_DEPTH` 处封顶。
    """
    rec = (_lineage_of(entity).get("fields") or {}).get(fname) or {}
    link: dict = {"value": _jsonable(held), "source": str(rec.get("source") or "")}
    for k in ("batch_id", "seeded"):
        if rec.get(k):
            link[k] = rec[k]
    inner = rec.get("prev")
    if isinstance(inner, dict):
        link["prev"] = inner
    return _trim_chain(link, _LINEAGE_CHAIN_DEPTH)


def note_field_source(entity, fname: str, source: str, *,
                      batch_id: str = "", prev: dict | None = None) -> None:
    """记下「**最后一次文档/表单读数**写这一格时，出处是 `source`」，被它顶掉的挂进 `prev`。

    🔴 口径要连读，别单读：手编写一格**不经过这里**（`_mark_manual` 只动 `provenance`），所以
    经理接管过的格子上，这条记录说的是「上一次由文档说了算时是谁说的」，**不是**「屏幕上那个值
    的出处」。判「这一格现在归谁」永远看 `provenance[f].origin`（doc/manual/form，手编赢）。
    两个 side-car 答两个问题，谁也不覆盖谁 —— 票 7 正好两个都要：origin 判该不该给撤回钮，
    lineage 判撤回之后写回什么。

    空 `source` 直接不记：编一个不存在的出处比没有出处坏得多（`doc_key_of` 的同一条纪律）。
    """
    src = (source or "").strip()
    if not fname or not src:
        return
    lin = _lineage_of(entity)
    fields = lin.get("fields")
    if not isinstance(fields, dict):
        fields = {}
        lin["fields"] = fields
    rec: dict = {"source": src}
    if batch_id:
        rec["batch_id"] = batch_id
    if isinstance(prev, dict):
        rec["prev"] = prev
    fields[fname] = rec
    note_source_doc(entity, src)


def adopt_field_lineage(cur, incoming, fname: str) -> None:
    """`cur` 这一格刚被 `incoming` 的读数填上 —— 把血缘一并搬过来（不是重新推一次）。

    🔴 出处取 `incoming` 那一格的血缘记录，取不到才退回 `incoming.source`。差别在 keep-first
    的 enrichment 上：花名册给了身份、周报补上了 owns，那一格的出处是**周报**那一行，不是
    活下来那条实体的整条 `source` —— 正是 `_append_conflict` 那条 ⚠ 讲的「引用一份从没说过
    这件事的文档」，换到血缘这一侧。
    搬过来的记录**不带** `seeded`：这是真记下来的，不是推出来的。
    """
    rec = (_lineage_of(incoming).get("fields") or {}).get(fname) or {}
    note_field_source(cur, fname, str(rec.get("source") or "")
                      or str(getattr(incoming, "source", "") or ""))


def absorb_sources(cur, incoming) -> None:
    """`incoming` 这条读数落到了 `cur` 上 —— 那份文档从此**提到过**这张卡。

    🔴 无条件调用，与「有没有改写任何一格」无关：keep-first 输掉的读数、手编赢挡下来的读数、
    逐字复述的读数，都证明那份文档谈的就是这个主体。`docs` 答的是「删光之后这张卡还有没有
    文档依据」——把输家漏掉，就会在删掉胜出文档时把一张仍有依据的卡判成无依据。
    """
    for key in list((_lineage_of(incoming).get("docs") or [])):
        note_source_doc(cur, key)
    note_source_doc(cur, str(getattr(incoming, "source", "") or ""))


def _init_lineage(entity, kind: str) -> None:
    """构造一张卡时播一次种：`docs` 的下限 + `fields` 的推定值。见本节顶部的长注释。

    两条不变式：
      · `docs` ⊇ {doc_key_of(source)} —— 恒成立，每次构造都补一次（幂等）。
      · `fields` 只在**整个 lineage 还没有这个键**时播种，播完的记录带 `seeded: True`。
        已经有 `fields` 的（写路记过、或 pg 回读的新数据）一个字节都不碰。

    🔴 手编/表单写过的格子不认领：`provenance[f].origin` 不是 'doc' 就跳过。否则一张文档卡上
    经理手填的那一格，会在下一次 `get()` 回读时被推成「某份文档说的」——一句凭空造出来的出处。
    """
    src = str(getattr(entity, "source", "") or "").strip()
    if not src:
        # 手编卡（`um-…`/`pm-…`，source 恒空）：血缘为空**就是**正确答案——没有任何文档喂过它，
        # 所以删光所有文档也不该动它一根汗毛。⚠ 空 lineage 有两种成因（手编卡 / 没有出处的老卡），
        # 区分它们要看 `provenance`，不要看这里。
        return
    lin = _lineage_of(entity)
    note_source_doc(entity, src)
    if "fields" in lin:
        return
    prov = getattr(entity, "provenance", None)
    prov = prov if isinstance(prov, dict) else {}
    seeded: dict = {}
    for fname in _lineage_fields(kind):
        if _reading_absent(getattr(entity, fname, None)):
            continue
        rec = prov.get(fname)
        origin = str((rec or {}).get("origin") or "") if isinstance(rec, dict) else ""
        if origin and origin != DOC_PROVENANCE_ORIGIN:
            continue
        seeded[fname] = {"source": src, "seeded": True}
    lin["fields"] = seeded


def batch_id_for(source_keys) -> str:
    """一次补传的批次号 —— 「这一批文件」的确定性名字，给票 7 的「撤回这一批」当抓手。

    刻意是**确定性**的（对 source_key 集合取哈希），不是 uuid：同一批文件重放出同一个 id，
    测试可以逐字断言它，也不给这条路引进一个墙上时钟/随机源（#82 的钟炸弹是同族教训）。
    空批次回空串 —— 缺就不发键（absent≠none，全仓姿态）。
    """
    names = sorted({(k or "").strip() for k in (source_keys or ()) if (k or "").strip()})
    if not names:
        return ""
    return "b-" + hashlib.sha1("\n".join(names).encode("utf-8")).hexdigest()[:12]


class AppendLedger:
    """补传这一趟的账本：「这一格现在的值是哪份资料给的」+「这个 (主体,字段) 已经开过冲突没有」。

    两本账都必须是**跨 `get()` 活着**的东西重建出来的，不能每次新建 —— 那正是坑②③。
    构造一次、整批读数共用一个实例：一批新文件里如果有两份都说同一个人的部门，第二份撞的是
    第一份刚写进去的值，账本自然把它记成同一条 FieldConflict 的第三个读数。
    """

    def __init__(self, extraction: "ExtractionResult", source_documents=(),
                 batch_keys=()) -> None:
        self.extraction = extraction
        # #87 · 这一趟是哪一批文件（**只有新来的那几份**，不是 source_documents 全表）。血缘里
        # 每条本趟写下的记录都带上它，票 7 的「撤回这一批」才有一个不用猜的抓手。
        self.batch_id = batch_id_for(batch_keys)
        # source_key -> (那份资料的上传瞬间 | None, 原始 uploaded_at 串)
        self._docs: dict[str, tuple[object, str]] = {}
        from ..decision_grading import _uploaded_moment   # 全仓唯一的 uploaded_at 解析器
        for sd in source_documents or ():
            key = (getattr(sd, "source_key", "") or getattr(sd, "filename", "") or "").strip()
            if not key:
                continue
            raw = str(getattr(sd, "uploaded_at", "") or "")
            self._docs[key] = (_uploaded_moment(raw), raw)
        self._conflicts: dict[tuple[str, str, str], FieldConflict] = {}
        self._adopt_existing_conflicts()

    # -- 账本重建 ---------------------------------------------------------------------------
    def _adopt_existing_conflicts(self) -> None:
        """把已经记在 `extraction.conflicts` 上的条目认领进索引，键用**归并身份尺**。

        `FieldConflict.subject_ref` 存的是实体 id（前端按它 join 卡片），而索引键必须是身份尺
        （`_append_conflict` 那条 🔴：`_slug` 会折叠标点并在 32 字符处截断，两个不同主体可以撞
        一个 id，用 id 当索引键会把两张卡的冲突融成一条）。所以这里 id→身份尺反查一次，
        **只在恰好反查到一个主体时**才认领：撞了 id 的、主体已经不在场的，宁可不认领
        （代价是那条旧冲突这一趟长不出新读数），也不把两张卡的账合成一本。
        """
        keys_by_ref: dict[tuple[str, str], list[str]] = {}
        for key, person in PersonIndex(self.extraction.people).slots.items():
            keys_by_ref.setdefault(("person", person.id), []).append(key)
        seen_projects: set[str] = set()
        for pr in self.extraction.projects:
            key = _project_key(pr.title)
            if key in seen_projects:
                continue
            seen_projects.add(key)
            keys_by_ref.setdefault(("project", pr.id), []).append(key)
        for c in self.extraction.conflicts:
            hits = keys_by_ref.get((c.subject_kind, c.subject_ref)) or []
            if len(hits) != 1:
                continue
            self._conflicts[(c.subject_kind, hits[0], c.field)] = c

    # -- 出处与新旧 -------------------------------------------------------------------------
    def held_source(self, entity, fname: str) -> tuple[str, str]:
        """这一格**现在这个值**的出处：`(出处串, origin)`。

        侧车里有这一格就用侧车（origin 可能是 'doc'/'manual'/'form'）；没有就退回实体级
        `source` 并按 'doc' 算 —— 这不是兜底发明，是 `PersonEntity.provenance` /
        `ProjectEntity.provenance` 的 dataclass 注释写死的口径：「未列的字段=doc 出处
        （source=本实体 self.source）」。
        """
        rec = (getattr(entity, "provenance", None) or {}).get(fname) or {}
        origin = str(rec.get("origin") or "")
        src = str(rec.get("source") or "")
        if origin and src:
            return src, origin
        return str(getattr(entity, "source", "") or ""), DOC_PROVENANCE_ORIGIN

    def is_manual(self, entity, fname: str) -> bool:
        """这一格是经理亲手写/亲手清空的吗？手编赢（registry.py 的「手编赢」口径），恒不被文档顶掉。"""
        return self.held_source(entity, fname)[1] == MANUAL_PROVENANCE_ORIGIN

    def outranks(self, entity, fname: str, incoming_source: str) -> bool:
        """新资料**确凿地**比这一格现在这个值所依据的资料新吗？不确定一律 False。

        三种「不确定」都退回 keep-first：手编（不参与新旧比较，手编恒赢）、新资料的上传时刻认不出、
        旧值那份资料已经不在 `source_documents` 里或时刻认不出。宁可显示一个有出处的旧读数，
        也不靠猜去顶掉它。
        """
        held_src, origin = self.held_source(entity, fname)
        if origin == MANUAL_PROVENANCE_ORIGIN:
            return False
        held_at = (self._docs.get(doc_key_of(held_src)) or (None, ""))[0]
        new_at = (self._docs.get(doc_key_of(incoming_source)) or (None, ""))[0]
        if held_at is None or new_at is None:
            return False
        return held_at < new_at

    def stamp(self, entity, fname: str, source: str) -> None:
        """这一格刚被一份资料写过 —— 把出处指到**那份资料**上（拍板③「出处指新资料」的落点）。

        origin 用 'doc'：线上那个联合类型是闭的（`transport.ts` 的 `'doc'|'manual'|'form'`），
        发明第四种取值会在前端悄悄落进「不挂角标」分支，而载荷已经违约。
        """
        rec = {"origin": DOC_PROVENANCE_ORIGIN, "source": source,
               "updated_at": (self._docs.get(doc_key_of(source)) or (None, ""))[1]}
        try:
            entity.provenance[fname] = rec
        except TypeError:                        # provenance 不是 dict（脏数据）——不为一条出处炸掉整次补传
            entity.provenance = {fname: rec}

    # -- 冲突记账 ---------------------------------------------------------------------------
    def note_conflict(self, kind: str, key: str, cur, fname: str,
                      held: str, held_source: str, new: str, new_source: str,
                      *, fresh_wins: bool) -> None:
        """一个 (主体, 字段) 只长**一条** FieldConflict —— 与 `_append_conflict` 同一条纪律，
        差别只有两处，都是补传特有的：

          · 索引从**持久化的** conflicts 重建（坑②），所以第二批、第三批资料是往同一条上追加；
          · `values[0]` 恒为**胜出**读数（FieldConflict 的 dataclass 契约）。补传路上新资料确凿
            更新时是新值胜出，所以它插在**队首**；被它顶掉的那些照旧按到达顺序排在后面
            （旧的胜出者本来就比后来的输家先到，所以插队首之后整条仍是「胜出 + 到达序」）。

        重复读数（值与出处都一样）不追加 —— 同一份文档被补传两次时，冲突行数不翻倍。
        """
        fresh = ConflictValue(value=new, source=new_source, doc_key=doc_key_of(new_source))
        hit = self._conflicts.get((kind, key, fname))
        if hit is not None:
            if any(v.value == fresh.value and v.source == fresh.source for v in hit.values):
                return
            if fresh_wins:
                hit.values.insert(0, fresh)
            else:
                hit.values.append(fresh)
            return
        old = ConflictValue(value=held, source=held_source, doc_key=doc_key_of(held_source))
        record = FieldConflict(subject_kind=kind, subject_ref=cur.id, field=fname,
                               values=[fresh, old] if fresh_wins else [old, fresh])
        self._conflicts[(kind, key, fname)] = record
        self.extraction.conflicts.append(record)

    # -- 逐格归并 ---------------------------------------------------------------------------
    def absorb(self, kind: str, key: str, cur, incoming) -> None:
        """把一条新读数并进已有主体 `cur`。就地改 `cur`，别的什么都不动。

        每一格三问，顺序不可换：
          1. 新资料这一格说话了吗（`_reading_absent`）—— 没说就什么都不做（absent≠none）；
          2. 这一格现在是空的吗 —— 是就直接填上，出处记新资料。这是 **enrichment 不是冲突**
             （`_note_conflicts` 的第 2 条判据，逐字同一句话）；
          3. 两边不一样吗 —— 一样就什么都不做（不为一次复述改出处）。不一样：**先记冲突再改值**
             （改完输的那条就不存在了，这是 `_note_conflicts` 那句「必须在合并之前」），
             然后只有 `outranks` 为真才让新值顶掉旧值。

        #87 血缘在这里落两笔，与上面三问**正交**（别把它们并进某一支）：
          · `absorb_sources` 无条件先记 —— 这份文档谈的就是这个主体，改不改得动一格都算数；
          · 每一处真 `setattr` 之前先 `prev_link` 把即将被毁掉的读数拍下来，写完再
            `note_field_source` 指到新资料上。**顺序不可换**：`setattr` 之后输的那条就不存在了，
            与「先记冲突再改值」逐字同一条纪律。
        """
        # 血缘第一笔：先于任何一问。手编赢挡下来的、逐字复述的、输给 keep-first 的读数，
        # 都证明这份文档提到过这张卡（见 `absorb_sources` 的 🔴）。
        absorb_sources(cur, incoming)
        conflict_fields = _CONFLICT_FIELD_ALLOWLIST.get(kind, ())
        for fname in _APPEND_REFRESHABLE.get(kind, ()):
            new = getattr(incoming, fname, None)
            if _reading_absent(new):
                continue
            if self.is_manual(cur, fname):
                # 手编赢。但**绝不静默吞掉**这条读数：够得着冲突口径的字段照样记账，
                # 经理在今天页看到的就是「你手填的 X ／ 新资料读到 Y」。
                held = getattr(cur, fname, None)
                if fname in conflict_fields and not _reading_absent(held) and held != new:
                    self.note_conflict(kind, key, cur, fname, str(held),
                                       self.held_source(cur, fname)[0], str(new),
                                       getattr(incoming, "source", ""), fresh_wins=False)
                continue
            held = getattr(cur, fname, None)
            if _reading_absent(held):
                setattr(cur, fname, new)
                self.stamp(cur, fname, getattr(incoming, "source", ""))
                # enrichment：空格子被填上，**没有任何读数被毁掉** → 不挂 prev（absent≠none）。
                note_field_source(cur, fname, getattr(incoming, "source", ""),
                                  batch_id=self.batch_id)
                continue
            if held == new:
                continue
            fresh_wins = self.outranks(cur, fname, getattr(incoming, "source", ""))
            if fname in conflict_fields:
                self.note_conflict(kind, key, cur, fname, str(held),
                                   self.held_source(cur, fname)[0], str(new),
                                   getattr(incoming, "source", ""), fresh_wins=fresh_wins)
            if not fresh_wins:
                continue
            # #87：**先拍照再毁尸**。这一行必须在 `setattr` 之前，理由与「先记冲突再改值」
            # 逐字相同——改完之后 `held` 在这张卡上就不存在了，而票 7 的撤回要的正是它。
            prev = prev_link(cur, fname, held)
            if fname == "ownerName":
                # 换了负责人：`ownerId` 是**派生**的 join key，不是独立读数——清空让 `_link_owners`
                # 按当前花名册重新解一次。留着旧 id 会让这张卡显示新名字、信号却还挂在旧人身上。
                # ⚠ 票 7 注意：撤回 ownerName **不是撤回一个字段**——写回名字之后 `ownerId` 仍是
                #   空的，得再跑一次 `_link_owners` 才把信号挂回原来那个人（回执里记着这笔账）。
                cur.ownerId = ""
            setattr(cur, fname, new)
            self.stamp(cur, fname, getattr(incoming, "source", ""))
            note_field_source(cur, fname, getattr(incoming, "source", ""),
                              batch_id=self.batch_id, prev=prev)
        for fname in _APPEND_UNIONED.get(kind, ()):
            new_items = getattr(incoming, fname, None) or []
            if not new_items or self.is_manual(cur, fname):
                # 手编过的列表整条不碰：`_absorb_person` 的并集是**无条件** [:6] 截断的，
                # 而手编没有长度上限——一次补传就能把经理列的第 7 条起悄悄剪掉。
                continue
            held_items = list(getattr(cur, fname, None) or [])
            fresh_items = [x for x in new_items if x and x not in held_items]
            if not fresh_items:
                continue
            # 并集也拍照：撤回一次补料要把整张列表还原成补料之前那张。
            # ⚠ 已知边界（票面点名、这里只是它的落点）：`[:_APPEND_LIST_CAP]` 会把第 7 项起**扔掉**，
            #   prev 存的是补料前那张完整列表（还原得回去），但这一趟被截掉的新条目谁也捡不回来。
            prev = prev_link(cur, fname, held_items) if held_items else None
            setattr(cur, fname, (held_items + fresh_items)[:_APPEND_LIST_CAP])
            self.stamp(cur, fname, getattr(incoming, "source", ""))
            note_field_source(cur, fname, getattr(incoming, "source", ""),
                              batch_id=self.batch_id, prev=prev)


def merge_project_reading(projects: list[ProjectEntity], incoming: ProjectEntity,
                          *, ledger: AppendLedger) -> ProjectEntity:
    """T10 —— 把**一条**新的项目读数并进一份已经归并过的项目清单，返回活下来那条。

    人卡侧的 `merge_person_reading` 的项目孪生。身份尺是 `_project_key(title)`，与
    `_dedupe_entities`、`form_reflow.find_bound_project` 同一把 —— 项目认人只许有一把尺。

    🔴 **归档的卡照样是候选**（与 `find_bound_project` 刻意相反，两处的活不一样）：那边是「这条
    表单链绑了哪张卡」，找不到就什么都不做才对；这边是**归并**，跳过归档卡的下场是给同一个
    `_project_key` 再开一张新卡，于是清单里同时躺着两张同名卡——`_dedupe_entities` 保证的唯一性
    当场破掉，下一次整表重建会把它们融回一张，经理那次归档就这么无声蒸发了。所以宁可让新读数
    落在一张他看不见的卡上（他自己归档的，恢复即见），也不破坏唯一性。

    标题为空的读数拒收：`_project_key("") == ""`，所有无标题的卡会被归成同一格
    （`find_bound_project` 早就在同一件事上守着这条）。
    """
    key = _project_key(incoming.title)
    if not key:
        raise ValueError("merge_project_reading needs a titled project reading — an empty title "
                         "collapses every untitled card into one bucket")
    cur = next((pr for pr in projects if _project_key(pr.title) == key), None)
    if cur is None:
        # 新项目：追加在**末尾**（同 `merge_person_reading` 的理由——活下来那条的 id 是前端
        # 编辑/归档的靶子，插在前面等于让经理刚改过的那张卡失联），然后解一次 id 碰撞。
        projects.append(incoming)
        _disambiguate_project_ids(projects)
        return incoming
    ledger.absorb("project", key, cur, incoming)
    return cur


def dedupe_signals_after_linking(extraction: "ExtractionResult") -> int:
    """把 `extraction.signals` 里**逐字重复**的克隆去掉，返回丢掉的条数。

    坑④的正面答案。`_dedupe_entities` 的信号去重按 `_signal_key(subjectType, subjectRef, summary)`，
    而**存量**信号的 `subjectRef` 早已是人卡 id（`_link_owners` 换过、表单回流直接写的就是 id），
    新抽出来的那批还是姓名——两边不是同一把尺，直接去重等于换尺重筛。

    所以顺序是：先照旧把新信号挂上去，由调用方跑一次 `_link_owners`（那是仓库里唯一那把
    姓名→id 的尺）把两边都换成 id，**然后**才用 `_signal_key` 去重。本函数只负责最后那一步，
    keep-first、保序、只删**逐字重复**的克隆——信号没有手编通道，所以这里没有手编可吞。
    同一批语料补传两次时，正是这一步让信号不翻倍。

    ⚠ 本函数**只在补传路上**被调用。上传路的那一遍在 `_dedupe_entities` 里，两处用的是同一个
    `_signal_key`，所以不是两把尺——是同一把尺在两个时点各量一次。
    """
    before = len(extraction.signals)
    seen: set[tuple[str, str, str]] = set()
    kept: list[SignalEntity] = []
    for s in extraction.signals:
        sig_key = _signal_key(s.subjectType, s.subjectRef, s.summary)
        if sig_key in seen:
            continue
        seen.add(sig_key)
        kept.append(s)
    extraction.signals = kept
    return before - len(kept)


def merge_person_reading(people: list[PersonEntity], incoming: PersonEntity,
                         *, ledger: AppendLedger | None = None) -> PersonEntity:
    """差距战役 T5/A2 —— 把**一条**新的人员读数并进一份**已经归并过**的人员清单，返回活下来那条。

    身份判据与吸收规则都直接复用 `_dedupe_entities` 的那两个零件（`_resolve_person_slot` /
    `_absorb_person`），所以「按人员ID归并、姓名兜底、两个不同工号永不并成一个人」在表单这条路上
    与上传那条路是同一句话，不是两份实现。

    🔴 为什么表单回流**不**直接调 `_dedupe_entities(ctx.extraction)`——四条都在代码里核过的伤：
      1. `_dedupe_entities` 结尾是 `res.people = list(...)` / `res.signals = kept`，**整表重写**。
         而 `ctx.extraction` 是一份已经跑过归并、之后还被手编 CRUD 改过的清单：手加的人
         （`um-…` id）一旦与抽取出来的同名，会在这一趟里被并掉，而 `archived`（软删）与
         `provenance`（手编出处）**根本不在合并规则里**——它们会连人带证据一起消失。
         一次员工提交不该有权删掉经理手动归档过的一张卡。
      2. `conflict_index` 是**每次调用新建**的，而 `res.conflicts` 是跨 `get()` 持久的：重跑一遍
         归并，凡是还能再撞一次的字段都会往 conflicts 上再追加一条重复记录（T7 会渲染两遍）。
      3. `held_src` 同理从零重建，会把某个格子的出处认成「活下来那条实体的整条 source」——
         正是 `_append_conflict` 那条 ⚠ 讲的「引用一份从没说过这件事的文档」。
      4. signals 那一段按 `_signal_key` 重新去重，而回流时信号的 `subjectRef` 已经是 id 不是
         姓名，重跑等于换一把尺再筛一遍。
    本函数只碰**一个人**：要么就地 enrich 一条已有实体，要么在**末尾**追加一条新的。别的什么都不动。

    ⚠ **不带 `ledger` 时** `incoming` 只许携带身份 + self_report。它若带着 T6 冲突口径里的字段
    （team/…），这里会拒绝——因为记录冲突需要 `_note_conflicts` 那一整套 `held_src` 账本，
    没有账本时本函数刻意不接；静默吞掉一条冲突读数，比拒绝写更糟。表单回流（T5）走的就是这条路，
    行为一个字节没变。

    ✅ **带 `ledger` 时**（T10 补传）账本在场，于是 `team` 成了合法载荷 —— 这不只是放宽一条断言：
    `PersonIndex` 的规则 3.5（0807 HITL 补的同名+部门消歧）读的**正是** `p.team`，所以在旧口径下
    那条规则从这个入口根本够不着（带部门的读数在 `resolve()` 跑起来之前就被拒了）。补传是它第一次
    真的能用上：纪要里「林小满（前厅部）」这条读数，账本在场时既能认出是哪一位，也能把
    「花名册说康乐部、纪要说前厅部」记成一条冲突而不是悄悄吃掉。
    """
    if ledger is None:
        dirty = [f for f in _CONFLICT_FIELD_ALLOWLIST["person"] if getattr(incoming, f, "")]
        if dirty:
            raise ValueError(
                f"merge_person_reading only takes identity + self-report readings; {dirty} would "
                f"need the conflict bookkeeping only _dedupe_entities has")
    index = PersonIndex(people)
    key = index.resolve(incoming)
    cur = index.slots.get(key)
    if cur is None:
        # 名册里没有这个人（新同事第一次交表）——追加在**末尾**。绝不插在前面：活下来那条的 id 是
        # 前端编辑/归档的靶子，把它换掉等于让经理刚改过的那张卡失联。
        people.append(incoming)
        _disambiguate_person_ids(people)
        return incoming
    if ledger is None:
        _absorb_person(cur, incoming)
        return cur
    # 补传路：定性格子走账本（安静更新 + 手编赢 + 冲突记账），身份与自述槽仍走上传路那两条规则，
    # 一个字节都不重写——「工号只补不改」与「自述槽 keep-first」在两条路上必须是同一句话。
    if not _person_id_key(cur.person_id) and _person_id_key(incoming.person_id):
        cur.person_id = incoming.person_id
    ledger.absorb("person", key, cur, incoming)
    _absorb_self_report(cur, incoming)
    return cur


def _dedupe_entities(res: ExtractionResult) -> None:
    """Collapse the SAME person/project seen in DIFFERENT documents into one record (feat-048).

    WHY HERE AND NOT IN `merge()`: merge() is also called 5x inside HeuristicExtractor.extract
    (above) to fold together disjoint categories of a SINGLE doc, where dedup is a no-op. Teaching
    merge() to dedup would overload "concatenate two partial results" with "reconcile identities
    across sources" — and would silently start dropping data the day someone adds a second
    people-producing branch to extract(). merge() stays a pure concat; identity reconciliation is
    one explicit pass over the finished corpus. (Same shape as materialize_memory, which likewise
    dedups at its own boundary rather than upstream.)

    WHY BEFORE `_link_owners`: _link_owners builds `by_name` as a dict, so it is last-wins — with
    duplicates present it can resolve an owner to whichever copy happened to land last. Dedup first,
    then link, and the two agree by construction.

    MERGE-ENRICH, NOT KEEP-FIRST — this is the load-bearing choice, and it is measured, not assumed.
    Sources are complementary by nature: a roster carries IDENTITY (role/team/tenure) and no
    ownership; a weekly/resume carries BEHAVIOUR (owns/status/blockers) and no identity. NEITHER
    RECORD IS COMPLETE. The English fixtures prove it independently of any CJK concern — Lena Park
    arrives twice, once as (team='Design', owns=0) and once as (team='', owns=3). keep-first drops
    the 3 things she owns (the entire body of her card); keep-last drops her team. Only enrichment
    yields the person who actually exists. It is also exactly what llm_extract._build already does
    across windows WITHIN a document ("same person across windows: enrich, don't duplicate") — this
    extends that established rule across documents rather than inventing a second one.

    "First non-empty wins" means INPUT ORDER decides when two docs both state a scalar. Lite does not
    parse document dates, so a stale progress from last week's report can beat this week's if it is
    uploaded first. Known limitation, recorded in the gate; fixing it needs doc recency, not a
    different dedup rule.

    MATERIALS ARE NEVER TOUCHED. Their ids are already `<doc>:<line>` (globally unique, so id-dedup
    is a no-op) and text-dedup is pure damage: the same line in two documents is two independently
    citable pieces of evidence. Chinese documents repeat headers/footers/disclaimers across files as
    a matter of course — text-dedup would delete that corpus from every file but the first, break
    the cite chain to the rest, and make registry.py's `_chunks_per_file` under-report chunk counts.
    """
    # people — enrich into the first record, preserving first-seen order
    # T5/A2 — 「谁是谁」交给 PersonIndex（工号第一、姓名兜底、同名不同工号绝不并）。
    index = PersonIndex()
    # T6/B2a — (身份key, 字段) -> 当前那个值**是哪份文档给的**。见 _append_conflict 的 ⚠。
    people_src: dict[tuple[str, str], str] = {}
    # T6/B2a — (kind, 身份key, 字段) -> 已开的那条 FieldConflict。键**必须**是归并用的身份尺，
    # 不是实体 id（_slug 会折叠标点+截断，两个不同主体可以撞 id）。见 _append_conflict 的 🔴。
    conflict_index: dict[tuple[str, str, str], FieldConflict] = {}
    for p in res.people:
        key = index.resolve(p)
        cur = index.slots.get(key)
        if cur is None:
            index.place(key, p)
            for fname in _CONFLICT_FIELD_ALLOWLIST["person"]:
                if getattr(p, fname, ""):
                    people_src[(key, fname)] = p.source
            continue
        _note_conflicts(res, conflict_index, "person", cur, p, key, people_src)   # T6/B2a: 必须在合并前
        if _absorb_person(cur, p):
            index.adopt_id(key, cur.person_id)
    res.people = list(index.slots.values())
    _disambiguate_person_ids(res.people)

    # projects — same rule; blockers/dependsOn union because two docs list complementary ones
    projects: dict[str, ProjectEntity] = {}
    # T6/B2a — 与人员那本分开：人名与项目标题的 key 命名空间可能撞（一个人叫 X、一个项目也叫 X）。
    projects_src: dict[tuple[str, str], str] = {}
    for pr in res.projects:
        key = _project_key(pr.title)
        cur = projects.get(key)
        if cur is None:
            projects[key] = pr
            for fname in _CONFLICT_FIELD_ALLOWLIST["project"]:
                if getattr(pr, fname, ""):
                    projects_src[(key, fname)] = pr.source
            continue
        _note_conflicts(res, conflict_index, "project", cur, pr, key, projects_src)   # T6/B2a: 必须在合并前
        _absorb_project(cur, pr)              # T10: ONE DEFINITION —— 补传路调的是同一个函数
    res.projects = list(projects.values())

    # signals — keep-first on literal clones only (see _signal_key); never enriched
    seen_signals: set[tuple[str, str, str]] = set()
    kept: list[SignalEntity] = []
    for s in res.signals:
        key = _signal_key(s.subjectType, s.subjectRef, s.summary)
        if key in seen_signals:
            continue
        seen_signals.add(key)
        kept.append(s)
    res.signals = kept

    # res.materials: INTENTIONALLY UNTOUCHED — see the docstring.


def _link_owners(res: ExtractionResult) -> None:
    """Best-effort: match a project's ownerName to an extracted person's id (Your-team wiring).

    ONE RULER (feat-048 round 2). `by_name` is built with `_person_key` — the SAME function
    _dedupe_entities uses to decide "same person". It used to fold nothing (`p.name.lower()`) while
    dedup folded whitespace, and two rulers for one identity is a silent data-loss bug:
    _dedupe_entities merges 「孙　浩」(U+3000 — the standard way a Chinese roster pads a two-character
    name into a three-character column) with 「孙 浩」and keeps the FIRST spelling, so by_name held
    only 「孙　浩」while the signal still pointed at 「孙 浩」. Miss. And a missed lookup here is
    SILENT: subjectRef just stays a name, the signal never reaches the person's card, and nothing
    reports it. Projects survived on luck (the first-name fallback below); signals have no fallback.

    AMBIGUOUS NAMES ARE DROPPED FROM `by_name` (T5/A2). Until工号 existed, two colleagues who share a
    name were merged into one card by `_dedupe_entities`, so `_person_key` was unique among survivors
    by construction and this dict could not lose anyone. `_resolve_person_slot` now keeps them apart
    when the documents give them different 工号 — and then a dict comprehension would silently pick
    **whichever 张伟 happened to be last**. A name that maps to two people is not a lookup miss, it is
    a question the data cannot answer; the honest answer is to link neither (the signal keeps its
    name and simply does not land on a card) rather than to land it on a coin-flip colleague.
    On every corpus without 工号 this is a no-op — nothing can be ambiguous there.
    """
    counts: dict[str, int] = {}
    for p in res.people:
        counts[_person_key(p.name)] = counts.get(_person_key(p.name), 0) + 1
    by_name = {_person_key(p.name): p.id for p in res.people if counts[_person_key(p.name)] == 1}
    for proj in res.projects:
        if proj.ownerName and not proj.ownerId:
            key = _person_key(proj.ownerName)
            if key in by_name:
                proj.ownerId = by_name[key]
            else:
                # try first-name match
                for nm, pid in by_name.items():
                    if nm.split(" ")[0] == key.split(" ")[0]:
                        proj.ownerId = pid
                        break
    # link person-signals to person ids too
    for sig in res.signals:
        if sig.subjectType == "person":
            key = _person_key(sig.subjectRef)
            if key in by_name:
                sig.subjectRef = by_name[key]
