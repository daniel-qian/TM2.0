"""The `company_context_id` <-> CompanyContext seam (feat-015 honor point).

`service/live_input.py::LiveSituation.company_context_id` is a stub: it threads an id through the
case file but nothing resolves it. THIS makes it real. Ingestion produces a `CompanyContext` and
registers it under an id; the advisor path resolves that id back to:

  * a `memory_dir` (materialized `facts.md` + `notes.md`) so the loop's EXISTING `avery.memory.recall`
    retrieves real company facts — the loop runs UNCHANGED (same seam `live_input` already uses), and
  * a `RetrievalStore` (keyword offline / vector real) for direct RAG queries, and
  * the extracted Your-team structures (people / project cards / briefing) for the frontend.

Why materialize facts.md rather than change recall(): the loop's memory + cite gate are already the
audited path (facts.md:<line> is what a cite() resolves to). Writing the extracted, red-line-clean,
line-addressable person/project/material facts INTO that file means every downstream gate (cite,
red line, 8-field projection) applies to ingested data with zero engine change. It is the honest
minimum: the advisor cites real lines that came from the manager's own uploads.
"""
from __future__ import annotations

import os
import tempfile
import uuid
from dataclasses import dataclass, field, replace
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Protocol

from .extract import (
    ExtractionResult,
    PersonEntity,
    ProjectEntity,
    ProjectMilestone,
    ProjectRisk,
    norm_milestone_status,
    norm_risk_level,
)
from .store import RetrievalStore, RetrievalHit, KeywordStore


@dataclass
class SourceDocument:
    """feat-032 — a persisted RAW upload: the original bytes + metadata, kept in the per-company
    file space so a manager can look back at what Avery's memory is built on (User Story 4).

    The bytes are UNTRUSTED content: stored and served for download, NEVER interpreted as
    instructions (readiness §2-I injection surface — this layer only stores/lists, it does not
    follow anything inside a file). `content` is held in memory by the in-memory registry and left
    None by the Postgres registry's metadata read (get()); the bytea is pulled on demand by the
    download seam (`source_document_bytes`). `storage_ref` is the feat-035 object-store seam
    (PRD: 'may include an object-store reference') — v1 keeps bytes inline in avery.source_documents.
    """
    filename: str
    source_key: str = ""                   # feat-032 P1: the DISAMBIGUATED per-document join key
                                           # (== the parsed doc's name == a material's '<key>:<line>'
                                           # source prefix). Distinct even when two uploads share a
                                           # `filename`, so n_chunks attributes per DOCUMENT, not per
                                           # display name. Empty -> fall back to `filename` (pre-032).
    mime: str = "application/octet-stream"
    size_bytes: int = 0
    doc_kind: str = "company"
    status: str = "ingested"               # feat-032 P2: 'ingested' | 'failed' (unparseable) |
                                           # 'empty' (parsed, produced no material). The manifest
                                           # surfaces it so a failed file is not disguised as valid.
    uploaded_at: str = ""                  # ISO8601 UTC; set at ingest, or read back from the DB
    content: bytes | None = None           # raw upload bytes (in-memory) / None (pg metadata read)
    storage_ref: str = ""                  # feat-035 seam: object-store pointer; inline bytea in v1


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass
class CompanyNote:
    """feat-033 — one agent-WRITTEN observation in the company's persistent, user-visible notebook.

    `text` is Avery's observation about the company (work-focused, never a person score — the write
    gate enforces that); `source_excerpt` is the ~60-char lead of the manager's question that
    triggered it (the notes surface shows 'From your question about <excerpt>'). Free text — the red
    line is a CONTENT scan run BEFORE this ever exists (see `gate_note_red_line`)."""
    id: str
    created_at: str          # ISO8601 UTC
    text: str
    source_excerpt: str = ""


def new_note_id() -> str:
    return "note_" + uuid.uuid4().hex[:16]


@dataclass
class AdviseRun:
    """issue #49 — one persisted room Q&A: the manager's question + Avery's final projected
    advice card (or the short-answer text; the two are mutually exclusive, mirroring the
    manifest contract). History surface reads new->old. `advice` is the contract-projected
    manifest.advice payload (service/contract.py) — NOT the raw transcript; the service hook
    only persists runs whose manifest carried redline_passed=True, so no gated content can
    land here. The question is the manager's own text echoed back to the same manager."""
    id: str
    created_at: str          # ISO8601 UTC
    question: str
    title: str = ""
    locale: str = "en"
    advice: dict | None = None
    answer: str = ""


def new_run_id() -> str:
    return "run_" + uuid.uuid4().hex[:16]


# rich-align-0722/05a · 真 CRUD 项目（手编赢 + 逐字段出处，ADR-0028）.
# provenance side-car source 对手编字段一律这句系统自证式短语（值本身仍活在实体字段，不双存）。
MANUAL_SOURCE = "手动编辑"
_PROJECT_STR_FIELDS = ("title", "ownerName", "status", "dueDate", "summary")
# rich-align-0722/06 · 人员手编 CRUD。🔴 只有**定性**字段可编辑——人身数字（负载/情绪/自述槽）
# 结构上不在这里，写侧红线（_redline_person_write + PersonIn extra=forbid）把带禁键的写请求挡在门外。
_PERSON_STR_FIELDS = ("name", "role", "team", "tenure")


def _apply_project_fields(pr: ProjectEntity, fields: dict) -> set:
    """把一份已 Pydantic 校验的字段 dict 应用到 ProjectEntity；返回**出现过**的字段名集合（供置
    manual 出处）。absent≠none 纪律：显式传 None 的字段 = 清空（progress→None / risk→None /
    milestones/blockers→空），绝不折算成 0/默认。项目字段全量可编辑——人身数字与项目无关，
    人身禁键在 06 侧执法（本函数不碰 person）。"""
    applied: set = set()
    for k in _PROJECT_STR_FIELDS:
        if k in fields:
            v = fields[k]
            setattr(pr, k, v.strip() if isinstance(v, str) else ("" if v is None else str(v)))
            applied.add(k)
    if "progress" in fields:
        v = fields["progress"]
        pr.progress = None if v is None else int(v)
        applied.add("progress")
    if "blockers" in fields:
        pr.blockers = [str(b).strip() for b in (fields["blockers"] or []) if str(b).strip()]
        applied.add("blockers")
    if "risk" in fields:
        v = fields["risk"]
        if v is None:
            pr.risk = None
        else:
            level = norm_risk_level(v.get("level")) or (v.get("level") or "")
            pr.risk = ProjectRisk(level=level, reason=(v.get("reason") or "").strip())
        applied.add("risk")
    if "milestones" in fields:
        out = []
        for m in (fields["milestones"] or []):
            name = (m.get("name") or "").strip()
            if not name:
                continue
            st_raw = (m.get("status") or "").strip()
            st = norm_milestone_status(st_raw)
            out.append(ProjectMilestone(name=name[:80], status=st or "other",
                                        statusRaw="" if st else st_raw[:40]))
        pr.milestones = out
        applied.add("milestones")
    return applied


def _mark_manual(pr, field_names) -> None:
    # 通用出处戳（ProjectEntity / PersonEntity 皆有 .provenance dict）——手编字段一律
    # origin='manual' + 系统自证式 source（'手动编辑'）。
    now = _now_iso()
    for k in field_names:
        pr.provenance[k] = {"origin": "manual", "source": MANUAL_SOURCE, "updated_at": now}


def _apply_person_fields(p, fields: dict) -> set:
    """把已 Pydantic 校验的**定性**字段 dict 应用到 PersonEntity；返回出现过的字段名集合（供置 manual 出处）。
    absent≠none：显式传 None 的字段=清空（str→''/list→空）。🔴 不碰 self_report——人身数字禁经手编通道，
    写侧红线（_redline_person_write + PersonIn extra=forbid）另守。"""
    applied: set = set()
    for k in _PERSON_STR_FIELDS:
        if k in fields:
            v = fields[k]
            setattr(p, k, v.strip() if isinstance(v, str) else ("" if v is None else str(v)))
            applied.add(k)
    for k in ("owns", "collaboration"):
        if k in fields:
            setattr(p, k, [str(x).strip() for x in (fields[k] or []) if str(x).strip()])
            applied.add(k)
    return applied


def _redline_person_write(p) -> None:
    """🔴 写侧红线（06·B3）：定性字段里夹带评分/排名/人身数字（role='绩效9分'、tenure='KPI 95'…）
    → ValueError → 端点 422。复用抽取红线的**值扫描**（redline_extract._scan_person_value，EN+ZH），
    不新增/削弱任何红线机制。人身禁键（负载/情绪/自述槽）由 PersonIn(extra='forbid') 结构上挡在门外；
    这里守的是「把数字藏进定性字段」。🔴 **不看开关**——经理手填他人分数=替人打分，恒禁（开关只管
    文档自述通道的投影，不解禁手填）。"""
    from . import redline_extract
    violations = redline_extract._scan_person_value(p)
    if violations:
        raise ValueError("；".join(v.detail for v in violations))


class ProjectWriteMixin:
    """rich-align-0722/05a · 项目手编 CRUD 的 duck-typed 写侧（内存 / pg 共用一套）。每个方法
    get→mutate→put：内存 put 存同一 ref（幂等），pg put 整体 JSON 重存——行为对齐（合约测试同扩）。
    未知 context_id → get 返 None → KeyError；未知 project_id → CompanyContext 抛 KeyError。
    端点把 KeyError 一律转**同体 404**（无存在性 oracle，同 authorize_context 姿态）。
    🔴 归档=软删标记可逆，本 mixin **不含任何物理删除路径**（销毁类人工闸哲学延伸到产品语义）。"""

    def _require_ctx(self, context_id: str) -> CompanyContext:
        ctx = self.get(context_id)
        if ctx is None:
            raise KeyError(context_id)
        return ctx

    def add_project(self, context_id: str, fields: dict) -> ProjectEntity:
        ctx = self._require_ctx(context_id)
        pr = ctx.add_manual_project(fields)
        self.put(ctx)
        return pr

    def patch_project(self, context_id: str, project_id: str, fields: dict) -> ProjectEntity:
        ctx = self._require_ctx(context_id)
        pr = ctx.patch_manual_project(project_id, fields)
        self.put(ctx)
        return pr

    def archive_project(self, context_id: str, project_id: str) -> ProjectEntity:
        ctx = self._require_ctx(context_id)
        pr = ctx.set_project_archived(project_id, True)
        self.put(ctx)
        return pr

    def restore_project(self, context_id: str, project_id: str) -> ProjectEntity:
        ctx = self._require_ctx(context_id)
        pr = ctx.set_project_archived(project_id, False)
        self.put(ctx)
        return pr

    # rich-align-0722/06 · 人员手编 CRUD——同一 get→mutate→put 骨架（05a 先例直接复用）。
    # 未知 context_id → KeyError；未知 person_id → CompanyContext 抛 KeyError；写侧红线 ValueError
    # （夹带人身数字）——端点分别转 404 / 422。停用=软删可逆，本 mixin 无物理删除路径。
    def add_person(self, context_id: str, fields: dict):
        ctx = self._require_ctx(context_id)
        p = ctx.add_manual_person(fields)
        self.put(ctx)
        return p

    def patch_person(self, context_id: str, person_id: str, fields: dict):
        ctx = self._require_ctx(context_id)
        p = ctx.patch_manual_person(person_id, fields)
        self.put(ctx)
        return p

    def archive_person(self, context_id: str, person_id: str):
        ctx = self._require_ctx(context_id)
        p = ctx.set_person_archived(person_id, True)
        self.put(ctx)
        return p

    def restore_person(self, context_id: str, person_id: str):
        ctx = self._require_ctx(context_id)
        p = ctx.set_person_archived(person_id, False)
        self.put(ctx)
        return p


def gate_note_red_line(text: str, source_excerpt: str = "") -> None:
    """🔴 The WRITE-SIDE red line for Avery's self-written notes — the moat's most load-bearing new
    face. Reuses the UNCHANGED advisor gate `avery.redline.validate` (EN+ZH); it does NOT add or
    weaken any red-line mechanism. A note that scores / ranks / profiles a PERSON (in the observation
    OR in the echoed question excerpt shown on the surface) raises ValueError, so NOTHING is stored —
    the self-written memory can never be a back door around 'no numbers on a person'.

    Both registries call this before persisting, and the service's post-advise hook re-checks
    independently (belt-and-suspenders, like feat-030's storage door).

    feat-033 (adversarial closure) — the observation and the echoed excerpt are validated
    SEPARATELY, never concatenated. Concatenating let a negation cue in one field bleed across the
    boundary and mask a real person-score in the other (e.g. an advice read ending '…never on the
    person' would suppress a scoring excerpt like '李雷:9分,排名第一'). Each field is displayed on its
    own, so each must independently pass — strictly stronger than the joined check.

    feat-033 (policy pivot, 2026-07-13) — when the operator has EXPLICITLY unblocked person scoring
    (`AVERY_ALLOW_PERSON_SCORING`, see avery.scoring_policy), the person-scoring raise is SKIPPED so a
    scoring note lands (both the in-memory and the Postgres append_note funnel through here, so one
    switch covers both). Default OFF keeps the moat: the detector (`avery.redline`) is untouched —
    only THIS enforcement decision consults the switch. The NUL / 0x00 storage-safety check is NOT a
    red-line policy and ALWAYS runs, switch or no switch."""
    from avery import redline   # core, offline, stdlib-only — safe for the offline path
    from avery.scoring_policy import person_scoring_allowed
    if not person_scoring_allowed():
        for part in (text, source_excerpt):
            if not part:
                continue
            rl = redline.validate(part)
            if not rl.passed:
                raise ValueError(f"red line: refusing to persist a scoring note ({rl.summary()})")
    if "\x00" in (text or "") or "\x00" in (source_excerpt or ""):
        raise ValueError("unsupported control character (NUL / 0x00) in a note — cannot be stored")


@dataclass
class CompanyContext:
    """The resolved company context an advisor retrieves against, keyed by `context_id`."""
    context_id: str
    extraction: ExtractionResult
    store: RetrievalStore
    memory_dir: Path                       # holds materialized facts.md / notes.md
    name: str = "company"
    source_files: list[str] = field(default_factory=list)
    source_documents: list[SourceDocument] = field(default_factory=list)  # feat-032 file space
    owner_token: str = ""                   # feat-038 tenant isolation: the unguessable holder
                                            # credential set at /ingest. A read path validates a
                                            # header token against this; empty == pre-038 / no auth
                                            # required (v1 back-compat — new /ingest always sets it).
                                            # NEVER travels in a URL (header only); the context_id
                                            # in the URL is not sufficient to read the data.

    # --- retrieval surface (what the advisor uses) --------------------------------------------

    def recall(self, query: str, limit: int = 8) -> list[RetrievalHit]:
        """RAG query over ingested material (keyword offline / vector real)."""
        return self.store.query(query, limit=limit)

    # --- Your-team structures (what the frontend renders) -------------------------------------

    def team_cards(self) -> list[dict]:
        """People cards for 'Your team' — QUALITATIVE by default. feat-017 renders these.

        rich-align-0722/03 — the ONE sanctioned numeric surface is `self_report` (the person's own
        reported load/mood), and it is **projection-gated on AVERY_ALLOW_PERSON_SCORING** (read live
        via avery.scoring_policy). Switch OFF → self_report is NOT projected, the card is byte-identical
        to the pre-03 qualitative shape (zero numbers, the shipped moat). Switch ON → self_report is
        projected WITH its caliber + source, so the UI can render the system-self-attesting caption
        「《<文档名>》记录的本人自述」 rather than asserting authorship the system cannot verify. Storage is
        NOT gated (the extraction always holds self_report — 母本不随开关重铸); only this projection is.
        DELIBERATELY still absent in BOTH worlds: moodPct/capacityPct/score/rank/tier as free keys."""
        from avery.scoring_policy import person_scoring_allowed
        allow_scoring = person_scoring_allowed()
        # rich-align-0722/06: 停用（软删）的人 EXCLUDED here — 走 archived_people_cards() 投给页尾折叠区。
        return [self._one_person_card(p, allow_scoring) for p in self.extraction.people
                if not getattr(p, "archived", False)]

    @staticmethod
    def _one_person_card(p, allow_scoring: bool) -> dict:
        """Project ONE PersonEntity onto the LivePersonCard shape — QUALITATIVE by default.
        rich-align-0722/03: self_report projected ONLY when allow_scoring (caliber+source travel with it).
        rich-align-0722/06: provenance side-car passed through (缺就不发键；手编字段带 origin='manual')."""
        card = {"id": p.id, "name": p.name, "role": p.role}
        if p.team:
            card["team"] = p.team
        if p.tenure:
            card["tenure"] = p.tenure
        if p.owns:
            card["owns"] = p.owns
        if p.collaboration:
            card["collaboration"] = p.collaboration
        # rich-align-0722/03 — self-reported load/mood, ONLY when the switch is on; caliber+source
        # travel with each metric so the render is forced to carry provenance (data-metric-source).
        # 🔴 A manually-added person carries NO self_report (禁经手编通道) → this block is inert for them.
        if allow_scoring and p.self_report:
            sr = {}
            if p.self_report.load:
                sr["load"] = {"value": p.self_report.load.value,
                              "caliber": p.self_report.load.caliber,
                              "source": p.self_report.load.source}
            if p.self_report.mood:
                mood = {"value": p.self_report.mood.value,
                        "caliber": p.self_report.mood.caliber,
                        "source": p.self_report.mood.source}
                if p.self_report.mood.valueRaw:      # out-of-vocab: echo the doc's own word
                    mood["valueRaw"] = p.self_report.mood.valueRaw
                sr["mood"] = mood
            if sr:
                card["self_report"] = sr
        # rich-align-0722/06: 字段级出处（ADR-0028）。缺就不发键（absent≠none）；手编字段带
        # origin='manual'/source='手动编辑'，前端据此渲染逐字段「手动编辑」出处角标。
        if getattr(p, "provenance", None):
            card["provenance"] = dict(p.provenance)
        return card

    def archived_people_cards(self) -> list[dict]:
        """rich-align-0722/06: 停用（软删）的人员卡，投给页尾折叠区（可恢复）。同卡形；前端灰化 + 恢复
        文字键。缺席=没人停用（payload 键在空时省略，absent≠none）。self_report 仍随开关（停用不改这条）。"""
        from avery.scoring_policy import person_scoring_allowed
        allow_scoring = person_scoring_allowed()
        return [self._one_person_card(p, allow_scoring) for p in self.extraction.people
                if getattr(p, "archived", False)]

    @staticmethod
    def _one_project_card(pr) -> dict:
        """Project ONE ProjectEntity onto the LiveProjectCard shape (absent≠none: no key when absent)."""
        card = {"id": pr.id, "title": pr.title}
        if pr.ownerId:
            card["ownerId"] = pr.ownerId
        if pr.ownerName:
            card["ownerName"] = pr.ownerName
        if pr.status:
            card["status"] = pr.status
        if pr.progress is not None:
            card["progress"] = pr.progress
        if pr.dueDate:
            card["dueDate"] = pr.dueDate
        if pr.summary:
            card["summary"] = pr.summary
        if pr.blockers:
            card["blockers"] = pr.blockers
        # rich-align-0722/01: 项目级风险徽章数据。缺就不发键（absent≠none 全链纪律）；
        # reason 省略时也不发（前端派生 riskReason 缺席=文档未给原因）。
        if pr.risk:
            risk_card = {"level": pr.risk.level}
            if pr.risk.reason:
                risk_card["reason"] = pr.risk.reason
            card["risk"] = risk_card
        # rich-align-0722/02: 里程碑列表。缺就不发键；statusRaw 只在 other（词表外）时发（回显原词）。
        if pr.milestones:
            card["milestones"] = [
                {"name": m.name, "status": m.status,
                 **({"statusRaw": m.statusRaw} if m.statusRaw else {})}
                for m in pr.milestones
            ]
        # rich-align-0722/05a: 字段级出处（ADR-0028）。缺就不发键（沿用 absent≠none）；手编字段
        # 带 origin='manual'/source='手动编辑'，前端据此渲染「手动编辑」出处角标。
        if getattr(pr, "provenance", None):
            card["provenance"] = dict(pr.provenance)
        return card

    def project_cards(self) -> list[dict]:
        """Active (non-archived) project cards for 'Your team'. Work may be quantified (progress)
        when the doc stated it; risk 4-dims / reportedStatus are left absent (R2 don't invent).
        rich-align-0722/05a: archived (soft-deleted) projects are EXCLUDED here — they go to the
        collapse drawer via archived_project_cards()."""
        return [self._one_project_card(pr) for pr in self._active_projects()]

    def _active_projects(self) -> list:
        """rich-align-0722/05a 软删（archived）的**唯一**过滤点。`project_cards()` 与
        `_decision_subjects()` 都从这里取。

        🔴 为什么收成一处：这条业务不变量抄第二份就一定会漂——而漂掉的后果是用户已经扔进
        折叠抽屉的项目，从今天页和「N 个值得多看一眼」里爬回来。收成一处之后，
        `test_project_crud_05a` 对 `project_cards()` 的既有门就**传递性**地守住了定级那条路。
        """
        return [pr for pr in self.extraction.projects if not getattr(pr, "archived", False)]

    def archived_project_cards(self) -> list[dict]:
        """rich-align-0722/05a: soft-deleted projects for the 'archived' collapse drawer (restorable).
        Same card shape as active; the frontend greys them + offers restore. Absent list = nothing
        archived (payload key omitted when empty, per absent≠none)."""
        return [self._one_project_card(pr) for pr in self.extraction.projects
                if getattr(pr, "archived", False)]

    @staticmethod
    def _one_playbook_card(pb) -> dict:
        """rich-align-0722/08: project ONE MethodCard onto the LivePlaybookCard shape (absent≠none:
        no description/tags key when empty). title always present (a card without a title is dropped
        upstream in the extractor)."""
        card = {"title": pb.title}
        if pb.description:
            card["description"] = pb.description
        if pb.tags:
            card["tags"] = list(pb.tags)
        return card

    def playbook_cards(self) -> list[dict]:
        """rich-align-0722/08: SOP `## 方法：` 小节抽出的只读方法卡（无 CRUD）——{title, description, tags}.
        缺席=没有 SOP 方法卡（payload 顶层键在空时省略，absent≠none）。纯 SOP 面，零人身评分。"""
        return [self._one_playbook_card(pb) for pb in getattr(self.extraction, "playbooks", [])]

    # --- rich-align-0722/05a · 项目手编 CRUD 的实体级 mutation（provenance side-car）--------------
    def _find_project(self, project_id: str) -> ProjectEntity:
        for pr in self.extraction.projects:
            if pr.id == project_id:
                return pr
        raise KeyError(project_id)

    def add_manual_project(self, fields: dict) -> ProjectEntity:
        """手动添加一个项目：新建实体 + 每个提供的字段置 origin='manual'（title 恒 manual，手加卡）。"""
        pid = "pm-" + uuid.uuid4().hex[:8]
        pr = ProjectEntity(id=pid, title="")
        applied = _apply_project_fields(pr, fields)
        _mark_manual(pr, applied | {"title"})
        self.extraction.projects.append(pr)
        return pr

    def patch_manual_project(self, project_id: str, fields: dict) -> ProjectEntity:
        """编辑既有项目：手编字段覆盖并置 origin='manual'（手编赢）。未知 id → KeyError。"""
        pr = self._find_project(project_id)
        applied = _apply_project_fields(pr, fields)
        _mark_manual(pr, applied)
        return pr

    def set_project_archived(self, project_id: str, archived: bool) -> ProjectEntity:
        """软删 / 恢复（可逆，绝不物理删除）。未知 id → KeyError。"""
        pr = self._find_project(project_id)
        pr.archived = bool(archived)
        return pr

    # --- rich-align-0722/06 · 人员手编 CRUD 的实体级 mutation（provenance side-car + 写侧红线）--------
    def _find_person(self, person_id: str) -> "PersonEntity":
        for p in self.extraction.people:
            if p.id == person_id:
                return p
        raise KeyError(person_id)

    def add_manual_person(self, fields: dict) -> "PersonEntity":
        """手动添加一名成员：新建**定性**实体 + 每个提供字段置 origin='manual'（name 恒 manual，手加卡）。
        🔴 写侧红线：定性字段夹带评分/人身数字 → ValueError → 422（手填即打分，恒禁）。"""
        pid = "um-" + uuid.uuid4().hex[:8]
        p = PersonEntity(id=pid, name="")
        applied = _apply_person_fields(p, fields)
        _redline_person_write(p)
        _mark_manual(p, applied | {"name"})
        self.extraction.people.append(p)
        return p

    def patch_manual_person(self, person_id: str, fields: dict) -> "PersonEntity":
        """编辑既有成员的定性字段（手编赢，origin='manual'）。未知 id → KeyError；夹带人身数字 → ValueError。
        🔴 先在**副本**上试应用 + 红线，通过后才落到真实体——内存 registry 是活引用，直接改再红线失败
        会把实体留在半改（已污染）状态，等于坏值落了库。"""
        import copy
        p = self._find_person(person_id)
        trial = copy.deepcopy(p)
        applied = _apply_person_fields(trial, fields)
        _redline_person_write(trial)   # 夹带评分/人身数字 → ValueError（此刻真实体一字未动）
        _apply_person_fields(p, fields)  # 红线通过 → 落真实体（同一批字段）
        _mark_manual(p, applied)
        return p

    def set_person_archived(self, person_id: str, archived: bool) -> "PersonEntity":
        """停用 / 恢复（可逆，绝不物理删除）。未知 id → KeyError。"""
        p = self._find_person(person_id)
        p.archived = bool(archived)
        return p

    def signal_cards(self) -> list[dict]:
        """Doc-derived signals. Person-directed ones stay at situation (gated upstream).

        🔴 NAMING TRAP (gap-design-0805 · B1): the key literally called `source` here is
        `SignalEntity.source_kind` — a CATEGORY ('doc' / 'figma' / 'feedback'), NOT the
        `'<source_key>:<line>'` document pointer. `SignalEntity.source` (the real pointer) is
        NOT projected. Anything joining a card back to its uploaded document must NOT read
        `card["source"]`; the decision path passes the pointer under a distinct `sourceRef`
        key (see `_decision_subjects`) precisely so a type word can never be silently
        mistaken for a document key — that mistake raises no error and turns no gate red.
        """
        return [{"id": s.id, "source": s.source_kind, "subjectType": s.subjectType,
                 "subjectId": s.subjectRef, "summary": s.summary, "tag": s.tag}
                for s in self.extraction.signals]

    def _decision_subjects(self) -> list[dict]:
        """gap-design-0805 · B1 —— 喂给定级引擎的项目卡：`project_cards()` 原样 + 一个
        `sourceRef`（实体的 `'<source_key>:<line>'` 出处）。

        为什么单开一条投影、不直接给 `_one_project_card` 加键：`sourceRef` 是**定级内部**要用的
        join key，前端 `LiveProjectCard` 一个消费者都没有。放进 `project_cards()` 等于把一个
        内部键塞进 /team 回帧的公开契约，以后想改就是破坏性变更。
        """
        return [{**self._one_project_card(pr), **({"sourceRef": pr.source} if pr.source else {})}
                for pr in self._active_projects()]

    def doc_timeline(self):
        """gap-design-0805 · B1 —— 这份 context 的资料上传时间轴（source_key → uploaded_at）。
        `decision_cards()` 与 `briefing()` **都**要吃它：两者共用同一张规则表，只喂一边会让
        今天页的卡片和它上面那句「N 个值得多看一眼」对不上——那正是 `briefing()` 那段长注释
        记着的旧伤（两套规则 = 同一屏自相矛盾）。"""
        from ..decision_grading import build_doc_timeline
        return build_doc_timeline(self.source_documents)

    def decision_cards(self, as_of=None) -> list[dict]:
        """feat-056 决策定级：给每个项目算一个 高风险/需确认/可推进，按严重度排好序。

        前端 feat-057 的「今天要决策的」直接吃这个列表（顺序即展示顺序）。等级由
        `avery/decision_rules.py` 的规则表算出——确定、可复现、可当场把口径表给客户看
        （`eval-harness/decision_grading_rules.md`）。Avery 的一句人话理由是在这之上的
        叠加层（`decision_grading.apply_review`），只许上调、不许下调；本方法产出的是
        纯规则版，reason_source == "rule"。

        `as_of` 不传则取今天——时间类规则（到期日）以它为准，显式传入即可复现。
        """
        from ..decision_grading import grade_projects
        return [d.to_dict() for d in grade_projects(self._decision_subjects(), self.signal_cards(),
                                                    as_of=as_of, timeline=self.doc_timeline())]

    def briefing(self, as_of=None) -> dict:
        """A calm, HONEST 'organization weather' briefing. Counts are real (people/projects); it
        emits NO invented aggregate health score (R2: real-or-nothing).

        🔴 The risk judgement is NOT this method's own. It is `avery.decision_grading` — the SAME
        rule table (`avery/decision_rules.py`, human-readable twin `decision_grading_rules.md`) that
        produces `decision_cards()`. Before 2026-07-18 this method carried a private, weaker rule
        (`status in ("at-risk", "blocked")`) that read NEITHER blockers NOR signals, so a project
        self-reporting on-track — or stating no status at all — while carrying an unresolved blocker
        (i.e. the ENTIRE premise of the 「多看一眼」 surface, and a case the rule table already
        models explicitly under its 「自报『正常』但挂着未解阻塞」 entry) fell straight through into
        'No risk signals surfaced from the documents.' — a sentence printed directly beneath
        'Everything below is drawn from your uploads — nothing invented.', while the very same
        payload's decision_cards said 需确认 and listed the blocker. Two rule sets = the surface
        contradicting itself one key apart. There is now exactly one.

        Signals get counted too, and separately from the graded projects. Every SignalEntity the
        extractor emits is a risk-shaped reading by construction (the four families: unresolved /
        no sign-off / rework / interrupt), so a non-empty `signal_cards()` and the sentence 'no risk
        signals' cannot both be true. Attribution of a signal to a project is a KNOWN blind spot of
        `_match_signals` (documented there: it would rather miss than blanket-escalate) — the loose
        ones therefore reach nobody's decision card, which is exactly why the briefing must not
        swallow them.

        🔴 De-duplication is by SIGNAL IDENTITY, via the SAME `_match_signals` the grader used —
        never by comparing rule-evidence strings. The first cut of this method did the latter (a
        signal counted as accounted only when its summary text appeared VERBATIM in some flagged
        project's rule evidence) and that read the wrong thing: rule evidence only contains signals
        that hit a KEYWORD FAMILY, so a signal explicitly naming an already-flagged project — same
        project, already on a decision card, already surfaced — landed in the evidence-free case and
        was added AGAIN as if it were a separate concern. Measured on a real POST /ingest of a
        10-line weekly: 1 project, 1 decision card, briefing said 'need a look = 3'. The ZH shell
        (the production default, see src/shared/briefing.ts) renders that count as 「其中 N 个项目
        值得多看一眼」 — so the surface named three projects while one project card was on screen,
        directly beneath 「没有一处是编的」. Same sentence, same spot, same lie as the original bug.

        `look_kind` / `look_projects` / `look_signals` ship the count's SHAPE, not just its size, so
        a localized surface can pick a truthful classifier instead of hard-coding 「个项目」:
          · "projects" — every counted thing IS a graded project. `look_signals == 0`, and the total
            can never exceed the project count. 「N 个项目」 is safe here and ONLY here.
          · "items"    — part of the count is a signal that reached no decision card. Calling those
            projects would invent projects (worst case: zero projects, two signals, 「2 个项目」).
          · "none"     — nothing flagged; the calm sentence is the honest one.

        `as_of` threads through to the date-sensitive rules (due dates) — pass it to reproduce a
        briefing exactly; omitted means today, same convention as `decision_cards()`.
        """
        from ..decision_grading import grade_projects
        from ..decision_rules import CAN_PROCEED

        n_people = len(self.extraction.people)
        n_proj = len(self.extraction.projects)

        signals = self.signal_cards()
        projects = self.project_cards()
        # 🔴 定级用的是带 `sourceRef` 的那份投影 + 时间轴，必须与 `decision_cards()` 逐字同口径；
        # 下面的 `_signals_no_decision_covers` 仍吃不带 sourceRef 的 `projects`（它只做信号归属）。
        decisions = grade_projects(self._decision_subjects(), signals,
                                   as_of=as_of, timeline=self.doc_timeline())
        flagged = [d for d in decisions if d.grade != CAN_PROCEED]
        loose_signals = self._signals_no_decision_covers(projects, signals, flagged)
        n_flagged, n_loose = len(flagged), len(loose_signals)
        n_look = n_flagged + n_loose
        look_kind = "none" if not n_look else ("items" if n_loose else "projects")

        metrics = [{"label": "people", "value": str(n_people)},
                   {"label": "active projects", "value": str(n_proj)}]
        if n_look:
            # Label kept VERBATIM ('need a look'): src/shared/briefing.ts maps the ZH surface off
            # this exact string, and its calm/risk branch is driven by whether this entry exists —
            # so emitting it is what keeps the Chinese subhead from denying what the metrics show.
            metrics.append({"label": "need a look", "value": str(n_look)})
        # feat-032 P2: reconcile with the file manifest. source_files counts only the PARSED docs;
        # source_documents counts everything UPLOADED (incl. parse-failures the manifest still shows).
        # Say "N of M" when they differ so the headline never claims fewer files than the manifest
        # lists. (No source_documents = pre-032 path -> just N.)
        n_ingested = len(self.source_files)
        n_uploaded = len(self.source_documents) or n_ingested
        files_phrase = f"{n_ingested} of {n_uploaded}" if n_uploaded != n_ingested else str(n_ingested)
        headline = f"Ingested {files_phrase} file(s): {n_people} people, {n_proj} projects."
        if look_kind == "none":
            tail = "No risk signals surfaced from the documents."
        elif look_kind == "items":
            # 'item(s)', not 'project(s)': part of this count is a signal that reached no decision
            # card, and calling it a project would be a small invention of exactly the kind this
            # method exists to stop. The all-projects case keeps the stronger word.
            tail = f"{n_look} item(s) worth a closer look."
        else:
            tail = f"{n_look} project(s) worth a closer look."
        subhead = "Everything below is drawn from your uploads — nothing invented. " + tail
        return {"tone": "alert" if n_look else "calm", "headline": headline, "subhead": subhead,
                "metrics": metrics, "look_kind": look_kind,
                "look_projects": n_flagged, "look_signals": n_loose}

    @staticmethod
    def _signal_identity(signal: dict) -> str:
        """A signal's identity for counting. `id` when the extractor gave one (it always does on the
        `signal_cards()` path); the summary text only as a defensive fallback, so a hand-built or
        legacy payload without ids still de-duplicates instead of inflating the count."""
        sid = str(signal.get("id") or "").strip()
        return sid if sid else "summary:" + str(signal.get("summary") or "").strip()

    @classmethod
    def _signals_no_decision_covers(cls, projects: list[dict], signals: list[dict],
                                    flagged) -> list[dict]:
        """Signals that no already-flagged project's decision card speaks for.

        A signal is covered when EITHER test says the manager is already being shown it. Both are
        needed; each alone under-counts one real case, and under-counting here means saying one
        project is several:

        ① ATTACHED — `decision_grading._match_signals` (the very function the grader ran, not a
           re-derivation) attributes the signal to a project whose card came back flagged. Delegating
           matters: two independently written attribution rules is the bug class this whole method
           exists to close — a private risk rule beside the rule table is what made the briefing deny
           its own payload — and a second one hiding in the de-duplication step is that same mistake
           one layer down. Test ② misses this case whenever the signal's wording hits no keyword
           family, because then it never becomes rule evidence even though its project is flagged.

        ② QUOTED — the signal's text appears VERBATIM in a flagged card's rule evidence, i.e. that
           exact sentence is already printed on screen under that project. Test ① misses this case
           routinely: the heuristic extractor stamps every doc signal with `subjectRef="the project"`
           (a literal, never a real reference — `extract.py::_signals_from_doc`), so doc signals
           attach to nothing, and a line that is simultaneously the project's blocker and its own
           signal would be counted twice.

        Everything else is returned. Those reach no decision card — the documented `_match_signals`
        blind spot, or a project the grader cleared — so dropping them would make the surface go
        silent about a risk-shaped reading out of the customer's own file. Empty-summary signals
        carry nothing to show a manager and are skipped.
        """
        from ..decision_grading import _match_signals

        flagged_subjects = {d.subject_id for d in flagged}
        covered: set[str] = set()
        for project in projects:
            # Mirrors `_Subject.subject_id` (id, else title) so the two sides key alike.
            subject_id = (str(project.get("id") or "").strip()
                          or str(project.get("title") or "").strip())
            if subject_id not in flagged_subjects:
                continue
            for signal in _match_signals(project, signals):
                covered.add(cls._signal_identity(signal))
        quoted = {ev for d in flagged for hit in d.matched_rules for ev in hit.evidence}

        out: list[dict] = []
        seen: set[str] = set()
        for signal in signals:
            summary = str(signal.get("summary") or "").strip()
            if not summary:
                continue
            key = cls._signal_identity(signal)
            if key in covered or summary in quoted or key in seen:
                continue
            seen.add(key)
            out.append(signal)
        return out

    # --- feat-032 file space (per-company uploaded-file manifest) ------------------------------

    def _chunks_per_file(self) -> dict[str, int]:
        """How many material chunks each parsed document contributed, keyed by a chunk's
        `<key>:<line>` source PREFIX (== the parsed doc's name == a SourceDocument.source_key). The
        prefix is per-DOCUMENT, so two uploads sharing a display `filename` do not merge their counts
        (feat-032 P1). Same cite seam the advisor uses."""
        counts: dict[str, int] = {}
        for m in self.extraction.materials:
            src = m.source or ""
            key = src.rsplit(":", 1)[0] if ":" in src else src
            if key:
                counts[key] = counts.get(key, 0) + 1
        return counts

    def file_cards(self) -> list[dict]:
        """The per-file manifest the 'your files' view renders — METADATA ONLY (no bytes): filename,
        size, mime, doc_kind, status, uploaded_at, and n_chunks (material chunks the file produced).
        n_chunks joins on source_key (the per-document key), falling back to filename for a pre-032
        row that has none. Content is untrusted data; the manifest lists it, the download seam serves
        the bytes separately."""
        counts = self._chunks_per_file()
        return [{"idx": i, "filename": sd.filename, "size_bytes": sd.size_bytes, "mime": sd.mime,
                 "doc_kind": sd.doc_kind, "status": sd.status, "uploaded_at": sd.uploaded_at,
                 "n_chunks": counts.get(sd.source_key or sd.filename, 0)}
                for i, sd in enumerate(self.source_documents)]


class ContextRegistry(ProjectWriteMixin):
    """In-memory id -> CompanyContext map. Process-local — the OFFLINE default (no external service,
    what the AFK suite runs). feat-030 delivered the promised DB-backed twin behind the same get/put
    API (`pg_registry.PostgresContextRegistry`); `active_registry()` picks between them by env."""

    # feat-031 cost gate: this registry does NOT persist a store's vectors and advise never reads its
    # in-memory CompanyContext.store, so embedding a corpus for it is pure spend with no reader. The
    # /ingest handler consults this flag to open the vector path ONLY behind a persistent registry.
    persistent = False

    def __init__(self) -> None:
        self._by_id: dict[str, CompanyContext] = {}
        self._notes: dict[str, list[CompanyNote]] = {}   # feat-033: agent-written notes, per context
        self._advise_runs: dict[str, list[AdviseRun]] = {}  # issue #49: persisted room Q&A, per context
        self._asks: dict[str, object] = {}               # feat-034: ask_id -> Ask (deep-copied)
        self._ask_tokens: dict[str, tuple[str, int]] = {}  # share_token -> (ask_id, recipient idx)
        self._form_templates: dict[str, dict[str, object]] = {}  # T1: ctx -> {tpl_id -> FormTemplate}
        self._form_submissions: dict[str, object] = {}   # T1: submission_id -> FormSubmission
        self._form_tokens: dict[str, str] = {}           # T1: share_token -> submission_id
        self._account_contexts: dict[str, list[str]] = {}  # feat-053: user_id -> [context_id]
        self._context_owner: dict[str, str] = {}           # feat-053: context_id -> user_id (1:1)
        self._ephemeral_at: dict[str, datetime] = {}       # gc-demo-clones-0724: clone_id -> created (UTC)

    def put(self, ctx: CompanyContext) -> str:
        self._by_id[ctx.context_id] = ctx
        return ctx.context_id

    # --- feat-033: Avery's notes (write-side, accumulating, user-visible) ----------------------

    def append_note(self, context_id: str, text: str, source_excerpt: str = "") -> CompanyNote:
        """Append one agent observation to this company's notebook. Runs the write-side red line
        FIRST (raises ValueError on a scoring/ranking/profiling note — nothing lands), then stores
        it in insertion order. In-memory holds the notes for the process; the Postgres twin persists
        them so they accumulate across sessions/restarts (same duck-typed API)."""
        gate_note_red_line(text, source_excerpt)
        note = CompanyNote(id=new_note_id(), created_at=_now_iso(), text=text,
                           source_excerpt=source_excerpt)
        self._notes.setdefault(context_id, []).append(note)
        return note

    def list_notes(self, context_id: str) -> list[CompanyNote]:
        """This company's notes, NEWEST FIRST (the notebook reads new->old)."""
        return list(reversed(self._notes.get(context_id, [])))

    # --- issue #49: advise-run history (the room's persisted Q&A) ------------------------------

    def append_advise_run(self, context_id: str, question: str, *, title: str = "",
                          locale: str = "en", advice: dict | None = None,
                          answer: str = "") -> AdviseRun:
        """Persist one completed room Q&A. No content gate here BY DESIGN (unlike append_note /
        put_ask): the advice payload already passed the advisor red line (the service hook only
        calls this for redline_passed manifests), and the question is the manager's own words
        shown back to the same manager — the surfaces that ship content to OTHER eyes (notes,
        asks) keep their storage-door scans unchanged. In-memory holds runs for the process;
        the Postgres twin persists them across restarts (same duck-typed API)."""
        import copy
        run = AdviseRun(id=new_run_id(), created_at=_now_iso(), question=question,
                        title=title or "", locale=locale or "en",
                        advice=copy.deepcopy(advice) if advice is not None else None,
                        answer=answer or "")
        self._advise_runs.setdefault(context_id, []).append(run)
        return copy.deepcopy(run)

    def list_advise_runs(self, context_id: str, limit: int = 50) -> list[AdviseRun]:
        """This company's persisted Q&A, NEWEST FIRST, capped at `limit` (the history drawer
        is a recency surface, not an archive export)."""
        import copy
        runs = self._advise_runs.get(context_id, [])
        return [copy.deepcopy(r) for r in list(reversed(runs))[: max(1, int(limit))]]

    # --- feat-034: Ask ("Quick ask") storage — the same seam style as notes ---------------------

    def put_ask(self, ask):
        """Store one ask snapshot (create or update). Runs the write-side red-line gate FIRST
        (raises ValueError on a person-scoring question — nothing lands), same storage-door
        discipline as append_note. Deep-copied both ways so a caller's later mutation can never
        silently edit the stored evidence."""
        import copy
        from .ask import gate_ask_red_line
        gate_ask_red_line(ask)
        snapshot = copy.deepcopy(ask)
        self._asks[snapshot.id] = snapshot
        # token index tracks the CURRENT snapshot only (re-share replaces cleanly)
        self._ask_tokens = {t: k for t, k in self._ask_tokens.items() if k[0] != snapshot.id}
        for i, r in enumerate(snapshot.recipients):
            if r.share_token:
                self._ask_tokens[r.share_token] = (snapshot.id, i)
        return copy.deepcopy(snapshot)

    def get_ask(self, ask_id: str):
        import copy
        ask = self._asks.get(ask_id)
        return copy.deepcopy(ask) if ask is not None else None

    def get_ask_by_token(self, share_token: str):
        """Resolve one employee link -> (ask, recipient index), or None (unknown token -> the
        loud 404). The token is the WHOLE credential — no enumeration path exists."""
        import copy
        hit = self._ask_tokens.get(share_token or "")
        if hit is None:
            return None
        ask_id, ridx = hit
        ask = self._asks.get(ask_id)
        if ask is None or ridx >= len(ask.recipients):
            return None
        return copy.deepcopy(ask), ridx

    def record_answer(self, share_token: str, answers: list, comment: str,
                      answered_at: str) -> str:
        """The answer-once lock: 'ok' when this FIRST answer lands, 'already' when the recipient
        answered before (nothing is overwritten — the evidence stays stable, PRD Q8), 'unknown'
        for a token that was never minted. Advances the stored status shared->collecting->closed."""
        hit = self._ask_tokens.get(share_token or "")
        if hit is None:
            return "unknown"
        ask_id, ridx = hit
        ask = self._asks.get(ask_id)
        if ask is None:
            return "unknown"
        rec = ask.recipients[ridx]
        if rec.answered_at:
            return "already"
        rec.answers = list(answers)
        rec.comment = comment or ""
        rec.answered_at = answered_at
        if ask.status in ("shared", "collecting"):
            done = sum(1 for r in ask.recipients if r.answered_at)
            ask.status = "closed" if done >= len(ask.recipients) else "collecting"
        return "ok"

    # --- T1 · form-backend-a1a: 常驻表单（模板 + 单人单链提交）—— 与 ask 同一条 seam style -----
    # ⚠ 这两组方法存的是「表单这个采集器」（模板长什么样、链接发给了谁、谁交了），**不是**资料的
    # 第二条存储通道：一次提交最终会变成一份与上传文件平权的 SourceDocument（T2 的活）。

    def put_form_template(self, template):
        """存一张模板快照（新建或覆盖）。写侧红线门 FIRST（题面给人打分就 ValueError，什么都不落），
        与 put_ask/append_note 同一道存储门。两头 deep-copy，调用方之后再改对象也污染不了库里的。"""
        import copy
        from .form import gate_form_red_line
        gate_form_red_line(template)
        snapshot = copy.deepcopy(template)
        self._form_templates.setdefault(snapshot.context_id, {})[snapshot.id] = snapshot
        return copy.deepcopy(snapshot)

    def get_form_template(self, context_id: str, template_id: str):
        import copy
        tpl = self._form_templates.get(context_id, {}).get(template_id)
        return copy.deepcopy(tpl) if tpl is not None else None

    def list_form_templates(self, context_id: str) -> list:
        """这家公司的模板，铸出顺序（内置的先铸，所以恒在前）。停用的也返回——经理要看得见它，
        「不再发新链接」和「从库里消失」不是一回事。"""
        import copy
        return [copy.deepcopy(t) for t in self._form_templates.get(context_id, {}).values()]

    def put_form_submission(self, submission):
        """存一条提交快照（铸链时建行，answers=None）。存储安全门 FIRST（NUL），但**不**扫红线——
        答案是员工本人的话（ADR-0023），保证在落点：它永不挂 avery.entities。"""
        import copy
        from .form import gate_submission_storage_safety
        gate_submission_storage_safety(submission)
        snapshot = copy.deepcopy(submission)
        self._form_submissions[snapshot.id] = snapshot
        # token 索引只跟当前快照走（重铸链干净替换）
        self._form_tokens = {t: sid for t, sid in self._form_tokens.items()
                             if sid != snapshot.id}
        if snapshot.share_token:
            self._form_tokens[snapshot.share_token] = snapshot.id
        return copy.deepcopy(snapshot)

    def get_form_submission(self, submission_id: str):
        import copy
        sub = self._form_submissions.get(submission_id)
        return copy.deepcopy(sub) if sub is not None else None

    def get_form_submission_by_token(self, share_token: str):
        """一条员工链接 -> 那一份提交，或 None（未知 token → 大声 404）。token 就是全部凭据，
        没有枚举面。"""
        import copy
        sid = self._form_tokens.get(share_token or "")
        if sid is None:
            return None
        sub = self._form_submissions.get(sid)
        return copy.deepcopy(sub) if sub is not None else None

    def list_form_submissions(self, context_id: str, template_id: str | None = None,
                              limit: int = 200) -> list:
        """这家公司的提交，NEWEST FIRST，可按模板过滤。「谁交了/谁没交」的唯一真相就是这张表——
        铸链即建行，所以没交的人在这里是 answers=None 的行，不是缺席。"""
        import copy
        rows = [s for s in self._form_submissions.values()
                if s.context_id == context_id
                and (template_id is None or s.template_id == template_id)]
        rows.sort(key=lambda s: (s.created_at or "", s.id), reverse=True)
        return [copy.deepcopy(s) for s in rows[: max(1, int(limit))]]

    def record_form_answers(self, share_token: str, answers: list,
                            submitted_at: str) -> str:
        """答一次锁：首答落地返回 'ok'，重复提交返回 'already'（**不覆盖**——证据必须稳得住，
        与 ask 回执同一条 PRD Q8 纪律），从未铸过的 token 返回 'unknown'。"""
        sid = self._form_tokens.get(share_token or "")
        if sid is None:
            return "unknown"
        sub = self._form_submissions.get(sid)
        if sub is None:
            return "unknown"
        if sub.submitted_at:
            return "already"
        sub.answers = list(answers)
        sub.submitted_at = submitted_at
        return "ok"

    # --- feat-053: the account seam (Supabase user id <-> context ownership) -------------------
    # ABOVE feat-038, never instead of it: owner_token stays the lower-layer credential and this map
    # is a SECOND, durable way to prove ownership of a context you already own. A context with no
    # entry here is anonymous and behaves exactly as it did pre-053 (the guest path).

    def link_account_context(self, user_id: str, context_id: str) -> bool:
        """Bind a context to an account. True when it is now bound to THIS user (including a
        re-link, which is idempotent), False when another account already owns it — one context has
        at most one owner account, which is the storage-layer half of "两个账号数据不串". The
        Postgres twin gets the same answer from a UNIQUE index (migration 0008)."""
        if not user_id or not context_id:
            return False
        current = self._context_owner.get(context_id)
        if current is not None and current != user_id:
            return False
        self._context_owner[context_id] = user_id
        ctxs = self._account_contexts.setdefault(user_id, [])
        if context_id not in ctxs:
            ctxs.append(context_id)
        # gc-demo-clones-0724: a linked context is a real owned workspace now — never GC'd.
        self._ephemeral_at.pop(context_id, None)
        return True

    def contexts_for_account(self, user_id: str) -> list[str]:
        """Every context this user owns, newest link first (the order the account picker shows)."""
        if not user_id:
            return []
        return list(reversed(self._account_contexts.get(user_id, [])))

    def account_for_context(self, context_id: str) -> str | None:
        """The account that owns this context, or None when it is still anonymous."""
        return self._context_owner.get(context_id)

    def account_owns(self, user_id: str | None, context_id: str) -> bool:
        """The authorization question: may THIS signed-in user read THIS context? Requires an exact
        match — an anonymous (unowned) context is never readable via the account path, only via its
        owner_token, so signing in can never hand you someone else's un-claimed workspace."""
        if not user_id or not context_id:
            return False
        return self._context_owner.get(context_id) == user_id

    def get(self, context_id: str) -> CompanyContext | None:
        return self._by_id.get(context_id)

    def resolve_memory_dir(self, context_id: str) -> Path | None:
        """The seam live_input wants: an id -> a memory_dir the loop's recall() reads."""
        ctx = self.get(context_id)
        return ctx.memory_dir if ctx else None

    def source_document_bytes(self, context_id: str, idx: int) -> bytes | None:
        """feat-032 download seam: the raw bytes of the idx-th uploaded file, or None (unknown
        context / out-of-range idx / no content). In-memory holds the bytes; the pg twin reads
        bytea. Same duck-typed API so the /team/{id}/files/{idx} handler is registry-agnostic."""
        ctx = self.get(context_id)
        if ctx is None or idx < 0 or idx >= len(ctx.source_documents):
            return None
        return ctx.source_documents[idx].content

    # --- input-side-0721 · 3A: clone (the one-click sample-team seam) --------------------------

    def clone_context(self, src_context_id: str, *, new_context_id: str,
                      new_owner_token: str, ephemeral: bool = True) -> bool:
        """Copy one context WHOLE into a new id with a NEW owner_token — the demo-claim seam.

        Why clone instead of sharing the demo master: /advise appends company notes and /ask lands
        rows, so a shared token means visitors dirty each other's sample workspace; and a read-only
        special case would have to be sprinkled into every write endpoint (and every FUTURE one).
        A clone gives each visitor a private twin behind the unchanged feat-038 token gate.

        No red-line re-scan here ON PURPOSE: every copied row already passed the storage-door gate
        on its way in (put()/append_note), and a byte-copy cannot manufacture new content. Notes are
        copied with FRESH ids (the pg twin's company_notes.id is globally unique) but keep their
        created_at — the pre-cast「实时数据缺位」story keeps its chronology. False = unknown source
        (the same clean no both registries give)."""
        import copy
        src = self._by_id.get(src_context_id)
        if src is None:
            return False
        extraction = copy.deepcopy(src.extraction)
        store = KeywordStore()
        store.add(extraction.materials)
        mem_dir = materialize_memory(extraction, data_root() / new_context_id)
        # 🔴 副本的 `uploaded_at` 重打成**此刻**（gap-design-0805 · B1）。母本是内容寻址的、
        # 一次铸成就常驻（`service/demo.py::_master_id`，sweep 明令不碰母本），所以它的上传时间
        # 冻在这台部署第一次铸母本那天。逐字继承会让「资料多久没更新」这条时间轴规则，在母本
        # 满 45 天之后，对每一位**三秒前刚领到示例团队、一个文件都没传过**的访客说
        # 「手上最新的一份资料也是 45 天以前上传的」——整块看板变黄，且他无论做什么都消不掉。
        # 对这位访客来说，这些文件确实是此刻才进他的工作区的。
        # （笔记的 `created_at` 仍逐字保留：那是「实时数据缺位」那段叙事的时间线，是内容不是元数据。）
        docs = copy.deepcopy(src.source_documents)
        stamped = _now_iso()
        for sd in docs:
            sd.uploaded_at = stamped
        twin = CompanyContext(
            context_id=new_context_id, extraction=extraction, store=store, memory_dir=mem_dir,
            name=src.name, source_files=list(src.source_files),
            source_documents=docs,
            owner_token=new_owner_token)
        self._by_id[new_context_id] = twin
        self._notes[new_context_id] = [replace(n, id=new_note_id())
                                       for n in self._notes.get(src_context_id, [])]
        # gc-demo-clones-0724: mark the twin ephemeral (default — the sole caller is /demo/claim) so
        # sweep_ephemeral can TTL-collect it. The SOURCE keeps its own flag; only the twin is marked.
        if ephemeral:
            self._ephemeral_at[new_context_id] = datetime.now(timezone.utc)
        return True

    def sweep_ephemeral(self, *, older_than_hours: int, limit: int = 50) -> int:
        """gc-demo-clones-0724 (the in-memory twin of PostgresContextRegistry.sweep_ephemeral): drop
        up to `limit` ephemeral clones older than `older_than_hours` that are NOT account-linked.
        Returns the count dropped. Never touches a master (never marked ephemeral) or an
        account-linked context (link_account_context clears the flag; the owner guard re-checks)."""
        hours = max(0, int(older_than_hours))
        batch = max(1, int(limit))
        cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)
        victims = [cid for cid, at in sorted(self._ephemeral_at.items(), key=lambda kv: kv[1])
                   if at < cutoff and cid not in self._context_owner][:batch]
        for cid in victims:
            self._by_id.pop(cid, None)
            self._notes.pop(cid, None)
            self._ephemeral_at.pop(cid, None)
            # T1: 表单跟着 context 走 —— pg 侧靠 0013 的 FK ON DELETE CASCADE，这里手工对齐。
            # （老的 _asks / _advise_runs 在这里没被清是本票之前就有的分歧，不在本票范围内动它。）
            for sid in [s.id for s in self._form_submissions.values() if s.context_id == cid]:
                sub = self._form_submissions.pop(sid, None)
                if sub is not None and getattr(sub, "share_token", ""):
                    self._form_tokens.pop(sub.share_token, None)
            self._form_templates.pop(cid, None)
        return len(victims)

    def __contains__(self, context_id: str) -> bool:
        return context_id in self._by_id

    def clear(self) -> None:
        self._by_id.clear()
        self._notes.clear()
        self._asks.clear()
        self._ask_tokens.clear()
        self._form_templates.clear()
        self._form_submissions.clear()
        self._form_tokens.clear()
        self._account_contexts.clear()
        self._context_owner.clear()
        self._ephemeral_at.clear()


# --- arch-0802: the registry seam, WRITTEN DOWN -----------------------------------------------
# Two adapters satisfy this seam (the in-memory ContextRegistry above; PostgresContextRegistry in
# pg_registry.py), but until now the interface existed nowhere in code: ~26 duck-typed members
# whose drift was only catchable by the @needs_db parity suite — which the offline battery skips
# by design (a pg-side gap shipped green on 2026-07-23 exactly this way; see the offline-guard
# block in tests/test_registry_contract.py). This Protocol is the seam's single written surface:
# tests/test_registry_protocol.py asserts OFFLINE that both adapters implement every member with
# an identical parameter list — method drift now goes red with no DB attached.
#
# Growing the seam: add the method HERE first, then to both adapters. The pg-only extra is
# deliberate and stays out: PostgresContextRegistry.delete() is shared-dev-DB hygiene the service
# never calls (the in-memory twin's clear() already drops everything).
class ContextRegistryProtocol(Protocol):
    """Everything a caller (HTTP layer, pipeline, gates) may rely on across BOTH adapters."""

    # company contexts
    def put(self, ctx: CompanyContext) -> str: ...
    def get(self, context_id: str) -> CompanyContext | None: ...
    def __contains__(self, context_id: str) -> bool: ...
    def clear(self) -> None: ...
    def resolve_memory_dir(self, context_id: str) -> Path | None: ...
    def source_document_bytes(self, context_id: str, idx: int) -> bytes | None: ...
    def clone_context(self, src_context_id: str, *, new_context_id: str,
                      new_owner_token: str, ephemeral: bool = True) -> bool: ...
    def sweep_ephemeral(self, *, older_than_hours: int, limit: int = 50) -> int: ...

    # Avery's notes (write side)
    def append_note(self, context_id: str, text: str, source_excerpt: str = "") -> CompanyNote: ...
    def list_notes(self, context_id: str) -> list[CompanyNote]: ...

    # advise-run history (issue #49)
    def append_advise_run(self, context_id: str, question: str, *, title: str = "",
                          locale: str = "en", advice: dict | None = None,
                          answer: str = "") -> AdviseRun: ...
    def list_advise_runs(self, context_id: str, limit: int = 50) -> list[AdviseRun]: ...

    # ask cards
    def put_ask(self, ask): ...
    def get_ask(self, ask_id: str): ...
    def get_ask_by_token(self, share_token: str): ...
    def record_answer(self, share_token: str, answers: list, comment: str,
                      answered_at: str) -> str: ...

    # 常驻表单（T1 · form-backend-a1a）: 模板 + 单人单链提交
    def put_form_template(self, template): ...
    def get_form_template(self, context_id: str, template_id: str): ...
    def list_form_templates(self, context_id: str) -> list: ...
    def put_form_submission(self, submission): ...
    def get_form_submission(self, submission_id: str): ...
    def get_form_submission_by_token(self, share_token: str): ...
    def list_form_submissions(self, context_id: str, template_id: str | None = None,
                              limit: int = 200) -> list: ...
    def record_form_answers(self, share_token: str, answers: list,
                            submitted_at: str) -> str: ...

    # account <-> context binding (feat-038 / feat-053)
    def link_account_context(self, user_id: str, context_id: str) -> bool: ...
    def contexts_for_account(self, user_id: str) -> list[str]: ...
    def account_for_context(self, context_id: str) -> str | None: ...
    def account_owns(self, user_id: str | None, context_id: str) -> bool: ...

    # manual CRUD (today via the shared ProjectWriteMixin; enumerated so the seam stays
    # complete even if an adapter ever stops inheriting the mixin)
    def add_project(self, context_id: str, fields: dict) -> ProjectEntity: ...
    def patch_project(self, context_id: str, project_id: str, fields: dict) -> ProjectEntity: ...
    def archive_project(self, context_id: str, project_id: str) -> ProjectEntity: ...
    def restore_project(self, context_id: str, project_id: str) -> ProjectEntity: ...
    def add_person(self, context_id: str, fields: dict): ...
    def patch_person(self, context_id: str, person_id: str, fields: dict): ...
    def archive_person(self, context_id: str, person_id: str): ...
    def restore_person(self, context_id: str, person_id: str): ...


# Process-wide default registry (the offline in-memory instance).
REGISTRY = ContextRegistry()


# --- feat-030: env-selected persistence -------------------------------------------------------

def db_url() -> str | None:
    """The persistence connection string: `AVERY_DB_URL`, with `PGVECTOR_URL` accepted as the alias
    that service/.env.example already names. Unset -> the in-memory registry (offline default)."""
    return (os.environ.get("AVERY_DB_URL") or os.environ.get("PGVECTOR_URL") or "").strip() or None


def data_root() -> Path:
    """Where materialized memory (facts.md/notes.md) lives: `AVERY_DATA_DIR` when set (a STABLE
    data dir — survives reboots; pair it with the DB registry so a restart re-materializes into
    it), else the pre-030 OS-temp default (fine for the ephemeral in-memory registry)."""
    env = (os.environ.get("AVERY_DATA_DIR") or "").strip()
    if env:
        return Path(env)
    return Path(tempfile.gettempdir()) / "avery-contexts"


_PG_REGISTRIES: dict[str, object] = {}   # url -> PostgresContextRegistry (per-process cache)


def active_registry() -> ContextRegistryProtocol:
    """THE registry the service should use right now. `AVERY_DB_URL`/`PGVECTOR_URL` set -> the
    Postgres-backed registry (company data survives restarts/redeploys); unset -> the in-memory
    REGISTRY (offline default, no external service, suite stays green with no DB).

    The DB module is imported lazily so the offline path NEVER needs psycopg installed."""
    url = db_url()
    if not url:
        return REGISTRY
    reg = _PG_REGISTRIES.get(url)
    if reg is None:
        from .pg_registry import PostgresContextRegistry  # lazy: offline suite never imports this
        from avery.embeddings import make_embedder_from_env  # feat-031: same gate the service uses
        # feat-031: a configured embedder turns the DB registry into real pgvector RAG (put() fills
        # embeddings, get() rebuilds a pgvector store). None (keyword / no key) -> KeywordStore.
        reg = _PG_REGISTRIES[url] = PostgresContextRegistry(url, embedder=make_embedder_from_env())
    return reg  # 契约面见 ContextRegistryProtocol；两适配器的一致性由 test_registry_protocol.py 离线钉住


def new_context_id() -> str:
    return "ctx_" + uuid.uuid4().hex[:12]


def materialize_memory(extraction: ExtractionResult, dest: Path) -> Path:
    """Write extracted, red-line-clean entities to facts.md / notes.md so the EXISTING loop recall +
    cite gate work over ingested data with no engine change. Each fact is one line (facts.md:<line>).
    """
    dest = Path(dest)
    dest.mkdir(parents=True, exist_ok=True)

    facts: list[str] = ["# Company facts (ingested from uploads — qualitative, red-line-clean)", ""]
    if extraction.people:
        facts.append("## People (qualitative only — no scores, no blood bars)")
        for p in extraction.people:
            facts += p.as_facts_lines()
        facts.append("")
    if extraction.projects:
        facts.append("## Projects")
        for pr in extraction.projects:
            facts += pr.as_facts_lines()
        facts.append("")
    if extraction.materials:
        facts.append("## Company material")
        seen: set[str] = set()
        for m in extraction.materials:
            if m.text in seen:
                continue
            seen.add(m.text)
            facts.append(m.text)
        facts.append("")
    (dest / "facts.md").write_text("\n".join(facts), encoding="utf-8")

    notes: list[str] = ["# Notes (doc-derived signals — situational, never a person label)", ""]
    for s in extraction.signals:
        notes += s.as_facts_lines()
    (dest / "notes.md").write_text("\n".join(notes) + "\n", encoding="utf-8")
    return dest
