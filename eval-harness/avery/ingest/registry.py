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
import threading
import uuid
from dataclasses import dataclass, field, replace
from dataclasses import fields as dataclass_fields
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Protocol

from .extract import (
    ExtractionResult,
    PersonEntity,
    ProjectEntity,
    ProjectMilestone,
    doc_key_of,
    hidden_reason,
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
                                           # #90 adds 'reading': bytes are deposited, the async
                                           # worker has not finished extraction yet (a MID state —
                                           # the worker flips it to one of the three terminals).
    uploaded_at: str = ""                  # ISO8601 UTC; set at ingest, or read back from the DB
    content: bytes | None = None           # raw upload bytes (in-memory) / None (pg metadata read)
    storage_ref: str = ""                  # feat-035 seam: object-store pointer; inline bytea in v1
    content_sha256: str = ""               # #90 content idempotency: hex sha256 of the RAW bytes,
                                           # computed the moment read_capped read them. '' = unknown
                                           # (a pre-#90 row with NULL content); the idempotency map
                                           # skips empty hashes. Migration 0017 backfills stored rows.


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
    # issue #78 — 这一轮属于哪一「场」对话。"" ⟺ 列侧 NULL ⟺ **无场归属**：既包括 #78 之前
    # 的存量行，也包括任何没带 thread_id 的调用。读侧对这两者一视同仁（各自单轮成一场），
    # 所以这里不需要区分它们——统一成空串就够了，别为此再引一个 None 态。
    thread_id: str = ""


def new_run_id() -> str:
    return "run_" + uuid.uuid4().hex[:16]


def new_thread_id() -> str:
    """issue #78 — 一场对话的对外句柄。由**服务端**在 /advise 铸造并经 SSE 回传（理由见
    db/migrations/0016_advise_runs_thread.sql 头注：客户端自铸时「老后端忽略了这个键」没有
    任何信号）。同 new_run_id 的模子，前缀不同好在日志里一眼分得开。"""
    return "thr_" + uuid.uuid4().hex[:16]


@dataclass
class AdviseThread:
    """issue #78 — 一场对话：同一个 thread_id 下的全部轮次，**按对话顺序（seq 升序）**。

    `thread_id` 为空串表示「无场归属的单轮」（#78 之前的存量行，或任何没带 thread_id 的写入）。
    这类行每一条自成一个 AdviseThread、runs 恰好一条——绝不把它们并成一场假对话。
    调用方要一个稳定 key 时用 `thread_id or runs[0].id`（前端 LiteRoomHistory 就是这么 key 的）。"""
    thread_id: str
    runs: list[AdviseRun]


@dataclass
class IngestJob:
    """#90 — one async-deposit unit of work: "these deposited bytes still need understanding".

    Minted by the depositing endpoint (POST /ingest · POST /team/{id}/files) in the SAME
    transaction that lands the bytes, claimed by the in-process worker (queued -> processing),
    finished as done/failed. `file_keys` names the source_keys this job is responsible for — the
    startup orphan recovery uses it to drop the 'reading' file rows of a job whose worker died.

    `extraction_mode` is the honest #89 label (llm / heuristic / degraded), recorded at completion:
    the POST response returns BEFORE extraction starts, so the polling surface (the /files task
    summary) reads the final label from here instead."""
    id: str
    context_id: str
    kind: str                  # 'ingest' (fresh context) | 'append' (补传)
    status: str = "queued"     # queued -> processing -> done | failed
    reason: str = ""           # human-readable failure reason ('' while healthy)
    extraction_mode: str = ""  # recorded at completion; '' until then
    file_keys: list[str] = field(default_factory=list)
    created_at: str = ""       # ISO8601 UTC
    updated_at: str = ""


def new_job_id() -> str:
    return "job_" + uuid.uuid4().hex[:16]


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

    def _commit(self, ctx: CompanyContext) -> None:
        """手编 CRUD 的**唯一**落盘出口：先重物化公司记忆，再 `put()`。

        🔴 为什么加这一步（#93 收尾挖出来的真洞，不是整洁）：这个 mixin 的八个写法原来都是
        裸 `put()`，而 `put()` 一个字节都不碰 facts.md。于是——

          · 经理把一张卡扔进归档抽屉 → 卡从网格上消失了，`facts.md` 里那句
            「Project '停车场改造': …」原地不动 → 议事室的 recall 照旧引得到它，
            经理点不开、对不上，只会觉得这东西在胡说；
          · 更难看的是 pg 腿：`PostgresContextRegistry.put()` 是**从磁盘读** facts.md 存进
            DB 行的，所以陈旧的那份会被就地烤进数据库，下一次 `get()` 再原样写回磁盘。
            自愈是不会发生的——它反过来固化。

        改名/编辑字段是同一个洞的温和版本（卡上写着新名字，语料里还是旧的），所以八个写法一起
        走这个出口，而不是只给归档那两个打补丁。

        顺序不能反：pg 腿的 `put()` 读的是磁盘上那份，必须先写文件再 put。
        """
        materialize_memory(ctx.extraction, ctx.memory_dir)
        self.put(ctx)

    def add_project(self, context_id: str, fields: dict) -> ProjectEntity:
        ctx = self._require_ctx(context_id)
        pr = ctx.add_manual_project(fields)
        self._commit(ctx)
        return pr

    def patch_project(self, context_id: str, project_id: str, fields: dict) -> ProjectEntity:
        ctx = self._require_ctx(context_id)
        pr = ctx.patch_manual_project(project_id, fields)
        self._commit(ctx)
        return pr

    def archive_project(self, context_id: str, project_id: str) -> ProjectEntity:
        ctx = self._require_ctx(context_id)
        pr = ctx.set_project_archived(project_id, True)
        self._commit(ctx)
        return pr

    def restore_project(self, context_id: str, project_id: str) -> ProjectEntity:
        ctx = self._require_ctx(context_id)
        pr = ctx.set_project_archived(project_id, False)
        self._commit(ctx)
        return pr

    # rich-align-0722/06 · 人员手编 CRUD——同一 get→mutate→put 骨架（05a 先例直接复用）。
    # 未知 context_id → KeyError；未知 person_id → CompanyContext 抛 KeyError；写侧红线 ValueError
    # （夹带人身数字）——端点分别转 404 / 422。停用=软删可逆，本 mixin 无物理删除路径。
    def add_person(self, context_id: str, fields: dict):
        ctx = self._require_ctx(context_id)
        p = ctx.add_manual_person(fields)
        self._commit(ctx)
        return p

    def patch_person(self, context_id: str, person_id: str, fields: dict):
        ctx = self._require_ctx(context_id)
        p = ctx.patch_manual_person(person_id, fields)
        self._commit(ctx)
        return p

    def archive_person(self, context_id: str, person_id: str):
        ctx = self._require_ctx(context_id)
        p = ctx.set_person_archived(person_id, True)
        self._commit(ctx)
        return p

    def restore_person(self, context_id: str, person_id: str):
        ctx = self._require_ctx(context_id)
        p = ctx.set_person_archived(person_id, False)
        self._commit(ctx)
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
        # T5 的工号，0807 HITL 补投：`id` 是人卡的**内部键**，`person_id` 才是花名册上那个工号。
        # 以前不投，于是铸链界面只能送空工号（FilesScreen.tsx 那段长注释写着「跨后端的一刀」），
        # 同名两位同事交的周报永远认不出是谁、自述被诚实跳过——经理看到的是「交了却没反应」。
        # 缺就不发键（absent≠none，同下面 team/tenure 的口径）：没工号的公司一个字节都不多收。
        if getattr(p, "person_id", ""):
            card["person_id"] = p.person_id
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
        # #85 · 文档血缘 side-car（#87 建的那本）。缺就不发键（absent≠none，同 provenance）。
        # 这是「这次补料改了什么」那张只读清单的**唯一**数据源：`fields[f].prev` 给「从 X 改成 Y」
        # 的前一半，`added_in` 给「这批新增了谁」。原样透传、不在这里裁剪——见 _one_project_card
        # 上那段（口径只写一份）。
        if getattr(p, "lineage", None):
            card["lineage"] = dict(p.lineage)
        return card

    def archived_people_cards(self) -> list[dict]:
        """rich-align-0722/06: 停用（软删）的人员卡，投给页尾折叠区（可恢复）。同卡形；前端灰化 + 恢复
        文字键。缺席=没人停用（payload 键在空时省略，absent≠none）。self_report 仍随开关（停用不改这条）。"""
        from avery.scoring_policy import person_scoring_allowed
        allow_scoring = person_scoring_allowed()
        return [self._one_person_card(p, allow_scoring) for p in self.extraction.people
                if hidden_reason(p) == "archived"]

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
        # #85 · 文档血缘 side-car（#87 建的那本），投给「这次补料改了什么」那张只读清单。
        # 缺就不发键（absent≠none，同 provenance）。
        #
        # 🔴 为什么**整本原样透传**、不在这里挑出「变过的那几格」：
        #  ① 「变过」的判据要同时读 provenance（这一格现在归谁）与 lineage（它的文档血缘），
        #     两本账缺一不可（#87 §3 的分工）。在投影层复刻那条判据 = 同一条口径长在两处，
        #     而前端那份是屏幕上真正在用的那份 —— 这里挑漏一条，谁也不会红。
        #  ② `prev` 链是票 7（逐条撤回）要写回去的东西。现在裁掉，票 7 得把这条路重修一遍。
        # ⚠ 代价记明：链在 `_LINEAGE_CHAIN_DEPTH`(8) 处封顶，所以每格最坏 8 环旧值随卡上线。
        #    这是**用户自己公司的资料**、走 owner_token 同一道鉴权，与 provenance 同级。
        if getattr(pr, "lineage", None):
            card["lineage"] = dict(pr.lineage)
        return card

    def project_cards(self) -> list[dict]:
        """Active (non-archived) project cards for 'Your team'. Work may be quantified (progress)
        when the doc stated it; risk 4-dims / reportedStatus are left absent (R2 don't invent).
        rich-align-0722/05a: archived (soft-deleted) projects are EXCLUDED here — they go to the
        collapse drawer via archived_project_cards()."""
        return [self._one_project_card(pr) for pr in self._active_projects()]

    def _active_projects(self) -> list:
        """rich-align-0722/05a 软删（archived）+ issue #93 软折叠（folded_into）在**定级面**的过滤点。
        `project_cards()` 与 `_decision_subjects()` 都从这里取。

        🔴 判据本身住在 `extract.hidden_reason()`，不在这里——#93 收尾时发现这条口径当时长在
        三处（这里、`rejudge`、以及**漏掉的** `materialize_memory`），漏掉那处让顾问一直能引用
        屏幕上不存在的卡。理由整段写在那个函数上方，这里不复述（口径只写一份，注释也是）。

        收成一处之后，`test_project_crud_05a` 对 `project_cards()` 的既有门就**传递性**地
        守住了定级那条路。
        """
        return [pr for pr in self.extraction.projects if not hidden_reason(pr)]

    def archived_project_cards(self) -> list[dict]:
        """rich-align-0722/05a: soft-deleted projects for the 'archived' collapse drawer (restorable).
        Same card shape as active; the frontend greys them + offers restore. Absent list = nothing
        archived (payload key omitted when empty, per absent≠none)."""
        return [self._one_project_card(pr) for pr in self.extraction.projects
                if hidden_reason(pr) == "archived"]

    def folded_project_cards(self) -> list[dict]:
        """issue #93 · 被**系统**折叠进母卡的项目，投给「已并入」区。同卡形 + 四个 folded* 键。

        与归档抽屉并列，但不是一回事，UI 上也不该长得一样：`archived` 是经理自己收的、有恢复键；
        这里是粒度闸判的。这个区存在的唯一理由，是把「为什么这张卡不见了」变成经理自己看得到的
        一句话——#93 把裁决落了库，就是为了重启之后这句话还答得出，但当时没有任何界面读它。

        🔴 **故意不给恢复键**：`rejudge_archive` 每次补传都对全档案重判一遍，所以经理手动放回来
        的卡，下一次上传就会被原样再折一次——那是一个会自己撤销的按钮，比没有按钮更伤。真要给
        「放回来」，得连带把这张卡钉成手编领域（吃 `_manually_touched` 那条豁免），等于让经理给
        单张卡永久关掉粒度闸；那是一个独立的产品决定，不在 #93 里做。今天卡回来只有一条路而且
        是自动的：解释它的那份文档被删 → `file_delete._unfold_unexplained` 撤销折叠。

        `foldedIntoTitle` 按 id 查母卡。母卡此刻可能已被经理归档，那也照样查得到、照样显示——
        经理要的是「并去哪了」这个事实，不是母卡此刻在不在网格上。查不到就不发键。
        `foldedRule`/`foldedReason`/`foldedEvidence` 取 `granularity` 里 `subject_id` 指着这张卡的
        那条裁决；不变式保证它在（`file_delete._unfold_unexplained` 是唯一守卫），这里仍按
        absent≠none 缺就不发键，让万一的违约表现为「少一行字」而不是整个 /team 五百。
        """
        by_id = {pr.id: pr for pr in self.extraction.projects}
        rulings = {r.subject_id: r for r in getattr(self.extraction, "granularity", [])
                   if getattr(r, "subject_id", "")}
        out: list[dict] = []
        for pr in self.extraction.projects:
            if hidden_reason(pr) != "folded":
                continue
            card = self._one_project_card(pr)
            card["foldedInto"] = pr.folded_into
            parent = by_id.get(pr.folded_into)
            if parent is not None and parent.title:
                card["foldedIntoTitle"] = parent.title
            r = rulings.get(pr.id)
            if r is not None:
                if r.rule:
                    card["foldedRule"] = r.rule
                if r.reason:
                    card["foldedReason"] = r.reason
                if r.evidence:
                    card["foldedEvidence"] = r.evidence
            out.append(card)
        return out

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

        T5/A2 —— `sourceRef` 是那个**真**指针（`'<source_key>:<行>'`），键名与 `_decision_subjects`
        逐字一致，就是为了让「文档出处」在整个仓库里只有一个键名。缺席就不发这个键
        （absent≠none：手加的、旧 context 的信号没有出处，前端据此不引，而不是引一个空串）。
        为什么现在才补：在此之前每一条信号都来自上传文档，卡上不引出处只是少一句话；表单回流
        之后，卡上会出现「员工本人这周说的一句话」，而它跟一份八周前的文档长得一模一样——
        不说这句话是哪份资料来的，卡就在替我们撒一个关于时间的谎。
        """
        return [{"id": s.id, "source": s.source_kind, "subjectType": s.subjectType,
                 "subjectId": s.subjectRef, "summary": s.summary, "tag": s.tag,
                 **({"sourceRef": s.source} if s.source else {})}
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

    def decision_cards(self, as_of=None, *, forms=None, now=None) -> list[dict]:
        """feat-056 决策定级：给每个项目算一个 高风险/需确认/可推进，按严重度排好序。

        前端 feat-057 的「今天要决策的」直接吃这个列表（顺序即展示顺序）。等级由
        `avery/decision_rules.py` 的规则表算出——确定、可复现、可当场把口径表给客户看
        （`eval-harness/decision_grading_rules.md`）。Avery 的一句人话理由是在这之上的
        叠加层（`decision_grading.apply_review`），只许上调、不许下调；本方法产出的是
        纯规则版，reason_source == "rule"。

        `as_of` 不传则取**今天（UTC）**——时间类规则（到期日、资料新旧）以它为准，显式传入即可复现。
        🔴 是 UTC 不是服务端本地：比较的另一头（资料上传日）归一到 UTC，两头必须同一个时区，
        否则本地日跑在 UTC 前面的那几个小时里，今天传的资料会被算老一天。见
        `decision_grading.today_utc()`——生产走的正是这条不传 `as_of` 的默认路径。

        `forms` / `now`（gap2 T9 · #58）是本期表单收集进度与"此刻"，由服务层从 registry 读出来
        再喂进来（`CompanyContext` 自己不持有 registry 句柄，也不该为了这一条去持有）。
        不传 = 这条路上没有表单数据，「本期还差人没交」那条规则不参评。
        """
        from ..decision_grading import grade_projects
        # gap-design-0805 · B2b：conflicts（T6 归并记下的落败读数）与时间轴一样，decision_cards
        # 与 briefing() **两边都要喂**——只喂一边，今天页的卡片和「N 个值得多看一眼」就会对不上。
        # T9 的 forms 同一条纪律，同一个理由。
        return [d.to_dict() for d in grade_projects(self._decision_subjects(), self.signal_cards(),
                                                    as_of=as_of, timeline=self.doc_timeline(),
                                                    conflicts=getattr(self.extraction,
                                                                      "conflicts", None),
                                                    forms=forms, now=now)]

    def briefing(self, as_of=None, *, forms=None, now=None) -> dict:
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

        `as_of` threads through to the date-sensitive rules (due dates, material age) — pass it to
        reproduce a briefing exactly; omitted means today **in UTC**, same convention as
        `decision_cards()`. UTC and not server-local on purpose: the other side of that comparison
        (a document's upload day) is normalized to UTC, and mixing the two made everything uploaded
        "today" read a day older for the hours when the local date runs ahead of UTC. See
        `decision_grading.today_utc()`.
        """
        from ..decision_grading import grade_projects
        from ..decision_rules import CAN_PROCEED

        n_people = len(self.extraction.people)
        n_proj = len(self.extraction.projects)

        signals = self.signal_cards()
        projects = self.project_cards()
        # 🔴 定级用的是带 `sourceRef` 的那份投影 + 时间轴 + 冲突记录 + 本期表单，必须与
        # `decision_cards()` 逐字同口径；下面的 `_signals_no_decision_covers` 仍吃不带 sourceRef
        # 的 `projects`（它只做信号归属）。
        decisions = grade_projects(self._decision_subjects(), signals,
                                   as_of=as_of, timeline=self.doc_timeline(),
                                   conflicts=getattr(self.extraction, "conflicts", None),
                                   forms=forms, now=now)
        flagged = [d for d in decisions if d.grade != CAN_PROCEED]
        loose_signals = self._signals_no_decision_covers(projects, signals, flagged)
        n_flagged, n_loose = len(flagged), len(loose_signals)
        n_look = n_flagged + n_loose
        # 🔴 gap2 T9：`look_kind == "projects"` 这句话的全部内容是「数出来的每一样东西**都是**
        # 一张项目卡」，中文壳据此印「其中 N 个项目值得多看一眼」。T9 起 `decisions` 里可能混进
        # 一张**公司级**的表单卡（subject_type == 'forms'），它不是项目——不把它算进来判 kind，
        # 屏幕上就会出现「2 个项目」而只有 1 张项目卡在场。那正是这个方法的长注释里记着的、
        # 因为同一个原因栽过两次的那句谎（第一次是 loose signals，这是第三次的入口）。
        n_nonproject = sum(1 for d in flagged if d.subject_type != "project")
        look_kind = "none" if not n_look else (
            "items" if (n_loose or n_nonproject) else "projects")

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
            # T6/B2a — 这行原本是手抄的 rsplit 表达式；提成 extract.doc_key_of 后改调它（ONE RULER：
            # 冲突卡引用的文档必须和这里数块数的文档是同一个口径）。行为逐字符不变。
            key = doc_key_of(m.source)
            if key:
                counts[key] = counts.get(key, 0) + 1
        return counts

    def file_cards(self) -> list[dict]:
        """The per-file manifest the 'your files' view renders — METADATA ONLY (no bytes): filename,
        size, mime, doc_kind, status, uploaded_at, source_key, and n_chunks (material chunks the file
        produced). n_chunks joins on source_key (the per-document key), falling back to filename for a
        pre-032 row that has none. Content is untrusted data; the manifest lists it, the download seam
        serves the bytes separately.

        issue #74 — `source_key` is emitted RESOLVED (`sd.source_key or sd.filename`), i.e. the exact
        same expression n_chunks joins on and the exact string `references._file_entry` matches an @
        mention against. ONE RULER: the key the manifest hands the client is the key that resolves
        back to THIS document. Emitting the raw (possibly empty) field instead would hand a pre-032
        row an id that matches nothing. Two uploads sharing a `filename` get distinct source_keys from
        `_unique_parse_names`, which is what makes an @ reference to the second one resolvable at all —
        before this key was published the client had only `filename` and every mention of a duplicate
        name silently resolved to the FIRST document."""
        counts = self._chunks_per_file()
        return [{"idx": i, "filename": sd.filename, "source_key": sd.source_key or sd.filename,
                 "size_bytes": sd.size_bytes, "mime": sd.mime,
                 "doc_kind": sd.doc_kind, "status": sd.status, "uploaded_at": sd.uploaded_at,
                 "n_chunks": counts.get(sd.source_key or sd.filename, 0)}
                for i, sd in enumerate(self.source_documents)]


def _empty_extraction_in_place(extraction: ExtractionResult) -> None:
    """#86 —— 把一份 ExtractionResult 的每一条列表**原地**清空（`clear()`，不换对象）。

    两条都是刻意的：

    ① **原地**——`ctx.extraction` 这个对象可能被别人攥着（`briefing()` 的调用方、正在跑的
       advise）。整个换掉，他们手上还是清空前的旧世界。

    ② **按 dataclass 字段遍历，不逐个点名**——`ExtractionResult` 的每一条字段按定义都是
       「从上传的文件里推出来的东西」（人/项目/信号/材料/方法卡/粒度裁决/冲突），所以
       「全清」对**今天有的和明天新加的**都成立。逐个点名的写法会在下一个人往
       `ExtractionResult` 上加第八条列表时静默漏清一条，而不会有任何一道门红
       （pg 腿那边的漏清会被 @needs_db 的往返判据逮到，内存腿这边没有人看着）。
    """
    for f in dataclass_fields(extraction):
        value = getattr(extraction, f.name)
        if isinstance(value, list):
            value.clear()


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
        self._ingest_jobs: dict[str, IngestJob] = {}       # #90: job_id -> IngestJob (insert order = age)
        # #90: jobs are touched from TWO threads (the event-loop thread deposits, the worker thread
        # claims/finishes) — every compound read-modify-write on the job dict goes through this lock.
        self._jobs_lock = threading.Lock()

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
                          answer: str = "", thread_id: str = "") -> AdviseRun:
        """Persist one completed room Q&A. No content gate here BY DESIGN (unlike append_note /
        put_ask): the advice payload already passed the advisor red line (the service hook only
        calls this for redline_passed manifests), and the question is the manager's own words
        shown back to the same manager — the surfaces that ship content to OTHER eyes (notes,
        asks) keep their storage-door scans unchanged. In-memory holds runs for the process;
        the Postgres twin persists them across restarts (same duck-typed API).

        issue #78: `thread_id` 是这一轮所属的场（空串 = 无场归属，见 AdviseRun.thread_id）。
        这里**不校验它是否已在本 context 出现过**——被中止/被红线拦下的第一轮根本不落行，
        那时客户端已经握着 id，硬校验会把用户眼里的一场劈成两场。归属由写入方说了算。"""
        import copy
        run = AdviseRun(id=new_run_id(), created_at=_now_iso(), question=question,
                        title=title or "", locale=locale or "en",
                        advice=copy.deepcopy(advice) if advice is not None else None,
                        answer=answer or "", thread_id=thread_id or "")
        self._advise_runs.setdefault(context_id, []).append(run)
        return copy.deepcopy(run)

    def list_advise_runs(self, context_id: str, limit: int = 50) -> list[AdviseRun]:
        """This company's persisted Q&A, NEWEST FIRST, capped at `limit` (the history drawer
        is a recency surface, not an archive export)."""
        import copy
        runs = self._advise_runs.get(context_id, [])
        return [copy.deepcopy(r) for r in list(reversed(runs))[: max(1, int(limit))]]

    def list_advise_threads(self, context_id: str, limit: int = 20) -> list[AdviseThread]:
        """issue #78 — 这家公司的对话**按场分组**：场按最近活动新->旧，场内按 seq 升序（对话顺序）。

        🔴 `limit` 数的是**场**，不是行——这与 list_advise_runs 的 limit 是两种单位，故意的。
        沿用行数上限会让最老那一场被腰斩成半截：hydrate 出来就是一段没有开头的聊天记录，
        而调用方无从分辨「这场只有 3 轮」和「这场有 7 轮但只给了 3 轮」。先定场、再取整场。

        无场归属的行（thread_id 为空 = #78 之前的存量行）每条自成一场，绝不并成假对话。"""
        import copy
        runs = self._advise_runs.get(context_id, [])
        groups: dict[str, list[AdviseRun]] = {}
        last_at: dict[str, int] = {}   # 场 -> 场内最后一轮的全局序号
        for i, r in enumerate(runs):   # 存储顺序即 seq 升序
            # 空场归属：用 run id 造一个独立键。冒号保证撞不上任何真 thread_id（形状闸
            # service/threads.py 只放行 [A-Za-z0-9_-]）。pg 腿用同一个前缀，两腿分组键同解。
            key = r.thread_id or f"run:{r.id}"
            groups.setdefault(key, []).append(r)
            last_at[key] = i
        # 「最近活动」= 场内**最后一轮**的位置，不是首轮：一个老场被追问之后应当浮到最前面，
        # 按首轮排会让它永远沉在底下（而它恰恰是用户最可能想接着问的那一场）。
        ranked = sorted(groups, key=lambda k: last_at[k], reverse=True)[: max(1, int(limit))]
        return [AdviseThread(thread_id=groups[k][0].thread_id,
                             runs=[copy.deepcopy(r) for r in groups[k]])
                for k in ranked]

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
    # 第二条存储通道：一次提交在提交那一刻被 form_append.append_submission_to_context 渲染成
    # 一份与上传文件平权的 SourceDocument append 进 context（T2）。

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

    # --- T9 · gap2 #58：自动补铸要的两问一写 ------------------------------------------------
    # 为什么不复用 `list_form_submissions`：它有 limit（默认 200 / 上限 500）。自动补铸的第一问是
    # 「本期**有没有**行」——一个被截断的列表会把「有」答成「没有」，而那句错答的代价是给全公司
    # 每个人**再发一条链接**。判据要多少行就得读到多少行，不能骑在一个为了分页而存在的上限上。

    def list_form_submissions_in_period(self, context_id: str, template_id: str,
                                        period: str) -> list:
        """这家公司这张模板这一期的**全部**行（不截断、不分页）。顺序 oldest-first，稳定可 diff。"""
        import copy
        rows = [s for s in self._form_submissions.values()
                if s.context_id == context_id and s.template_id == template_id
                and (s.period or "") == period]
        rows.sort(key=lambda s: (s.created_at or "", s.id))
        return [copy.deepcopy(s) for s in rows]

    def latest_form_period_before(self, context_id: str, template_id: str,
                                  period: str) -> str | None:
        """这张模板在 `period` **之前**最近的一个有行的周期，没有则 None。

        比较用字符串序：ISO 周 `YYYY-Www` 的字典序就是时间序（年在前、周补零到两位）。空 period
        的行不参与——那是没写周期的历史行，拿它当「上期」会让自动补铸照着一份没有周期语义的名单发。
        """
        periods = {(s.period or "") for s in self._form_submissions.values()
                   if s.context_id == context_id and s.template_id == template_id}
        earlier = sorted(p for p in periods if p and p < period)
        return earlier[-1] if earlier else None

    def put_form_submission_if_absent(self, submission):
        """自动补铸专用的写：`auto_key` 没被占则落行并返回它，已被占则返回 **None**（不覆盖）。

        🔴 内存这一份是**单进程**的，它的「原子」只是 GIL 下的一次字典查改；真正顶住并发的是
        Postgres 那条唯一索引（0015）。两个双胞胎在**行为**上一致（第二次调用落空），但只有
        真库那条腿证明得了事务级——所以并发那道门是 `@needs_db`，不是离线门。
        """
        key = (submission.auto_key or "").strip()
        if not key:
            raise ValueError("put_form_submission_if_absent needs a non-empty auto_key")
        for s in self._form_submissions.values():
            if s.context_id == submission.context_id and (s.auto_key or "") == key:
                return None
        return self.put_form_submission(submission)

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

    def expire_form_submission(self, submission_id: str, at_iso: str) -> str:
        """T9 · 作废一条**还没交**的链接 = 把到期时刻拨到此刻。'ok' / 'already' / 'unknown'。

        🔴 为什么是「拨到期」而不是删行——三个理由，每一个单独都够：
          ① **已提交的一律不许动**（`submitted_at` 非空 → 'already'）。答案是员工本人的话，
             删掉它就是销毁证据。这条判据与首答锁同一条纪律（PRD Q8）。
          ② 删行会和自动补铸打架：护栏认的是「本期这个人有没有行」，行没了 → 下一次 GET 又给
             他铸一条，经理点一次作废、系统立刻发回来一条，无限循环。拨到期之后这一行仍在，
             仍算「他本期已经有过链接」，循环从结构上不存在。
          ③ 作废后员工手机上那条链接的表现是**现成的、诚实的**那一页——「这条链接已过期，
             如果还需要你填，请让负责人重新发一条」（`form_api._resolve_link` 的 404 过期页）。
             不需要为「被撤回」新造一种状态词、一张页、一套文案。
        """
        sub = self._form_submissions.get(submission_id)
        if sub is None:
            return "unknown"
        if sub.submitted_at:
            return "already"
        sub.expires_at = at_iso
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

    def source_document_keys(self, context_id: str) -> set[str] | None:
        """issue #99 —— 这家公司资料库里**已经占用的 source_key**，而**不把整份档案拿在手里**。

        补传原本是「`get()` 整档 → 抽取两三分钟 → `put()` 整档覆盖」，可抽取那一段其实只需要
        这一个集合（判「这份 key 库里是不是已经有了」）。握着整份快照跨过那两三分钟，等于把
        期间落地的任何手编改动排进了写回的销毁名单里（`avery.contexts` 没有版本列，`put()` 是
        快照替换）。这个方法就是那一段唯一需要的读：**够用，且拿不住**。

        🔴 `None` = 这个 context 不存在（与 `get()` 的 None 同义，调用方据此抛 KeyError → 同体
        404）；**空集合 = 存在但一份文档都没有**。两者绝不许混：混了就是把「档案没了」翻译成
        「档案是空的」，补传会照着往一个不存在的 id 上写。

        ⚠ 两个适配器各写一遍这个投影（这里是集合推导，pg 腿是一句 SQL）——duck-typed 双胞胎
        的固有代价，与本模块其余 ~26 个成员一样。它们与 `file_append.existing_source_keys`
        （整档投影那条老路）必须给出同一个答案，靠判据钉住，不靠共享代码：
        `test_source_document_keys_answers_without_pulling_the_archive`（合约套，两条腿都跑）。
        """
        ctx = self._by_id.get(context_id)
        if ctx is None:
            return None
        return {(sd.source_key or sd.filename) for sd in ctx.source_documents
                if (sd.source_key or sd.filename)}

    def source_document_bytes(self, context_id: str, idx: int) -> bytes | None:
        """feat-032 download seam: the raw bytes of the idx-th uploaded file, or None (unknown
        context / out-of-range idx / no content). In-memory holds the bytes; the pg twin reads
        bytea. Same duck-typed API so the /team/{id}/files/{idx} handler is registry-agnostic."""
        ctx = self.get(context_id)
        if ctx is None or idx < 0 or idx >= len(ctx.source_documents):
            return None
        return ctx.source_documents[idx].content

    def source_document_bytes_by_key(self, context_id: str, source_key: str) -> bytes | None:
        """issue #93 — the same bytes, addressed by `source_key` instead of by position.

        🔴 寻址用 key 不用 idx，与 `file_delete` 头上那条碑逐字同一个理由：`put()` 用 `enumerate`
        重排 idx，删掉中间一份之后所有后续 idx 左移。全档案重跑闸要在**补传进行中**（清单已经
        被这一趟改过、还没 put）把每一份存量文档的字节拉回来重建 —— 按位置寻址在这里不是
        「可能取错」，是**结构上**取错：调用方手里那份清单的下标与库里的 idx 此刻本来就不同。
        取错的下场尤其安静：拿 B 的字节当 A 重建，闸照跑、判据照绿，只是判错了。

        None 有三种成因，调用方**必须一视同仁地当作「重建不出来」**（#93 的血缘完整性前置断言
        就是靠这个返回值 fail closed）：这家公司没有这份 key；这一行的 content 是 NULL
        （0017 backfill 之前铸的存量行）；unknown context。
        """
        ctx = self.get(context_id)
        key = (source_key or "").strip()
        if ctx is None or not key:
            return None
        for sd in ctx.source_documents:
            if (sd.source_key or sd.filename) == key:
                return sd.content
        return None

    # --- #90 · async deposit: bytes land NOW, understanding is a background job -----------------
    # The deposit pair writes the uploaded bytes + a `queued` IngestJob in one atomic step (one SQL
    # transaction on the pg twin; one lock section here), so POST /ingest and POST /team/{id}/files
    # can return in seconds. The worker drives claim -> execute -> finish. `recover_orphan_ingest_jobs`
    # runs at process startup: a `processing` row then can only be a job whose worker died mid-flight
    # (this process hasn't claimed anything yet) — mark it failed and drop its 'reading' file rows,
    # the honest restart story the in-memory `_BUILD_LOCK` precedent never had.

    def _register_job(self, job: IngestJob) -> None:
        """Stamp + store one job (caller holds `_jobs_lock`). Stored by reference on purpose —
        claim/finish mutate the stored row; readers get deep copies."""
        import copy
        stored = copy.deepcopy(job)
        stored.created_at = stored.created_at or _now_iso()
        stored.updated_at = stored.updated_at or stored.created_at
        self._ingest_jobs[stored.id] = stored

    def deposit_new_context(self, *, context_id: str, name: str, owner_token: str,
                            source_documents: list[SourceDocument], job: IngestJob) -> None:
        """#90 · /ingest 的收字节半程：铸一个**骨架** context（空抽取、空检索面、空物化）+ 挂上
        status='reading' 的文件行 + 落一条 queued job —— 一步原子。owner_token 从这一刻起就是
        持久的（秒级回执把它交给上传者；断连也不再孤儿化——worker 完成后同一个 token 照常开门）。

        骨架的 facts.md/notes.md 是**空抽取的物化结果**（与 #86 empty_context 同一个产物）——
        不是缺文件：worker 完成前这份 context 就已经可以被 GET，投影层读到的必须是一个
        自洽的空世界。worker 完成时 `ingest_docs(context_id=...)` 整体快照替换。"""
        extraction = ExtractionResult()
        mem_dir = materialize_memory(extraction, data_root() / context_id)
        ctx = CompanyContext(
            context_id=context_id, extraction=extraction, store=KeywordStore(),
            memory_dir=mem_dir, name=name, source_files=[],
            source_documents=list(source_documents), owner_token=owner_token)
        with self._jobs_lock:
            self._by_id[context_id] = ctx
            self._register_job(job)

    def deposit_append(self, context_id: str, source_documents: list[SourceDocument],
                       job: IngestJob) -> None:
        """#90 · 补传的收字节半程：把 status='reading' 的文件行挂进**既有** context + 落一条
        queued job，一步原子。KeyError = context 不存在（端点转同体 404）。

        ⚠ 挂的是**原地 extend**（内存腿 get() 返回活引用——正在投影这份 ctx 的调用方立刻看得见
        reading 行，这正是「文件行秒级可见」的兑现点）。worker 完成时用 `reserved_keys` 把这些
        行换成 finalized 终态行（file_append.append_docs_to_context 的 #90 参数）。"""
        ctx = self._by_id.get(context_id)
        if ctx is None:
            raise KeyError(context_id)
        with self._jobs_lock:
            ctx.source_documents.extend(source_documents)
            self._register_job(job)

    def claim_next_ingest_job(self) -> IngestJob | None:
        """Atomically claim the OLDEST queued job (queued -> processing), or None. Deep-copied out —
        the caller's later mutation never edits the stored row (finish_ingest_job is the write path)."""
        import copy
        with self._jobs_lock:
            for job in self._ingest_jobs.values():   # insert order = age (oldest first)
                if job.status == "queued":
                    job.status = "processing"
                    job.updated_at = _now_iso()
                    return copy.deepcopy(job)
        return None

    def finish_ingest_job(self, job_id: str, *, status: str, reason: str = "",
                          extraction_mode: str = "") -> None:
        """Land a claimed job's terminal state (done / failed). KeyError for an unknown id — the
        worker only ever finishes a job it claimed, so an unknown id is a bug, not a race."""
        if status not in ("done", "failed"):
            raise ValueError(f"finish_ingest_job wants 'done' or 'failed', got {status!r}")
        with self._jobs_lock:
            job = self._ingest_jobs.get(job_id)
            if job is None:
                raise KeyError(job_id)
            job.status = status
            job.reason = reason or ""
            job.extraction_mode = extraction_mode or ""
            job.updated_at = _now_iso()

    def latest_ingest_job(self, context_id: str) -> IngestJob | None:
        """This context's NEWEST job (or None) — the /files task-summary read. Deep-copied out."""
        import copy
        with self._jobs_lock:
            for job in reversed(self._ingest_jobs.values()):
                if job.context_id == context_id:
                    return copy.deepcopy(job)
        return None

    def recover_orphan_ingest_jobs(self) -> int:
        """#90 · startup orphan recovery: every `processing` job at process start is a job whose
        worker died mid-flight (nothing in THIS process has claimed anything yet) — mark it
        `failed: server restarted` and drop its still-'reading' file rows, so the manager sees an
        honest failure + a clean manifest instead of a spinner that never lands. `queued` jobs are
        deliberately NOT touched: their bytes are already deposited, the worker simply runs them.

        Returns the number of jobs recovered. (On this in-memory twin a real restart wipes
        everything, so production recovery is the pg twin's job — this one exists so the RECOVERY
        BEHAVIOR itself is offline-testable against the same contract.)"""
        recovered = 0
        with self._jobs_lock:
            for job in self._ingest_jobs.values():
                if job.status != "processing":
                    continue
                job.status = "failed"
                job.reason = "server restarted"
                job.updated_at = _now_iso()
                ctx = self._by_id.get(job.context_id)
                if ctx is not None and job.file_keys:
                    keys = set(job.file_keys)
                    # Only the rows still mid-flight — a terminal row (this batch somehow landed
                    # before the crash) is real data and stays. In-place splice: callers hold the
                    # live list (file_delete 命门① 同款纪律).
                    ctx.source_documents[:] = [
                        sd for sd in ctx.source_documents
                        if sd.status != "reading" or (sd.source_key or sd.filename) not in keys]
                recovered += 1
        return recovered

    # --- 设计0810/#86: 清空这份档案（档案本身留着）-------------------------------------------

    def empty_context(self, context_id: str) -> bool:
        """#86 —— 把这家公司**上传来的一切**清掉，但**档案本身留着**：`context_id` 与
        `owner_token` 一个字节不动，浏览器里那份锚点、外面发出去的 H5 链接、绑定的账号全部继续有效。

        Danny 0810 拍板「不要有『新建』的概念」——一个人从头到尾就一份档案，加文件、删文件，
        真要从头来是**清空这一份**。它是今天**唯一能做干净**的纠错出口：逐份删文件受制于
        实体血缘不足（`file_delete.py` 的票内裁定：卡片只有实体级单值 source，删一份文档收不回
        它推导出来的人卡/项目卡），而**清空不需要血缘**——每一个实体都来自某份文件，全清一定是对的。

        清掉：`source_documents`（原件字节 + 清单）· `source_files` · `materials`（含向量）·
        `entities` 全部五类（人/项目/信号/方法卡/冲突）· `granularity` · 重物化成空的 facts/notes。

        **留下**（清的是「文件和文件推出来的东西」，不是这家公司）：
          · `owner_token` / `context_id` / `name` —— 档案的身份；
          · 对话历史 `advise_runs`（经理问过什么、Avery 答过什么，与文件无关）；
          · Avery 自己写的观察 `company_notes` —— **归属存疑但倾向保留**：那是 Avery 的话不是
            文件的衍生物（确认文案必须把这一条说给用户听，别让他以为「清空」把笔记也清了）；
          · 常驻表单模板 + **员工已交的答卷 `form_submissions`** —— 那是**别人的话**，而且外面
            还挂着活的 H5 链接，清掉等于替员工撤回他已经交的东西；
          · `asks` / `ask_recipients` · 账号归属 `account_contexts`。

        🔴 **`ephemeral` 标记是唯一的例外：清空会把它摘掉（#88，Danny 2026-08-10 拍板
        「清空＝这份档案从此归你」）。** 这不是顺手优化，是补一条 #88 造出来的死胡同——

          撤掉「新建一家公司」之后，领过示例团队的人**没有任何路**换成自己的资料：
          示例档案是一次性克隆（到期被 `sweep_ephemeral` 回收），前端因此**封掉**它的上传口
          （补进去的东西会随回收一起没，而经理会以为存下来了）；他今天的出路正是「新建一家
          公司」，而那个出口这一票砍了。清空之后若 `ephemeral` 原样留着，上传口照旧封着——
          用户做了唯一被指引的动作，却什么也没解开。

          语义上也说得通：一次性克隆之所以一次性，是因为**里面装的是我们的示例数据**。
          用户亲手把它清空 + 打了确认词，那份档案里再没有一个字节属于示例——它就是他的了。
          先例是 `link_account_context`（绑到账号即 `ephemeral = false`，gc-demo-clones-0724）：
          同一条判断「这份 context 已经归某个真人所有 → 不该被 GC 收走」，两个触发点。

        🔴 **留着答卷的代价（明知而为，不是疏漏）**：`POST /team/{id}/forms/{sub}/ingest` 会把一份
        已提交的答卷重新灌回资料库——所以「清空」**不会自己保持为空**，经理事后补灌一份答卷，
        实体就回来了。这是本票明文接受的语义（答卷不属于「上传来的文件」那一类），
        判据钉在 `tests/test_context_empty_t86.py::test_refiling_a_submission_after_empty_repopulates`。

        返回 False = 这个 id 不存在（与 `clone_context` 同一姿态；端点在此之前已经过了
        `authorize_context`，所以 False 在服务路径上等价于「刚被别人删掉了」）。

        🔴 **原地 mutate 那个活对象，绝不新造 `CompanyContext`**（与 `file_delete.py` 命门①
        逐字同一条）：内存腿的 `get()` 返回的就是库里那个引用，调用方（`_team_payload`、
        正在跑的 advise）手上很可能攥着同一个对象；换一个新对象出来，他们看到的还是清空前的旧世界。
        """
        ctx = self._by_id.get(context_id)
        if ctx is None:
            return False

        _empty_extraction_in_place(ctx.extraction)
        ctx.source_documents.clear()
        ctx.source_files.clear()
        # 检索面跟上。内存腿的 store 永远是 KeywordStore（pg 腿见它自己那份），重铸成空即可——
        # 两个内存 store 都没有 remove()，与 file_delete._rebuild_store 同一条理由。
        ctx.store = KeywordStore()
        # 命门③（同 file_delete）：facts.md / notes.md 必须**当场**重物化成空，否则议事室的
        # recall 会继续从磁盘上那份旧文本里引出已经清掉的原文。
        materialize_memory(ctx.extraction, ctx.memory_dir)
        # #88 · 清空即认领：这份档案里再没有一个字节属于示例，别让 GC 把它当一次性克隆收走
        # （理由见 docstring 那段🔴；pg 腿是同一句话的 SQL 版）。对本来就不是克隆的档案，
        # 这一行是无操作——`pop(..., None)`，不是「找不到就抛」。
        self._ephemeral_at.pop(context_id, None)
        return True

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

    def is_ephemeral(self, context_id: str) -> bool:
        """T10 —— 这份 context 是**一次性**的吗（示例团队的克隆副本，会被 TTL 回收）？

        补资料的入口按它禁用：往一份马上会被 GC 掉的克隆里补文件，经理会以为资料存下来了。
        「先禁入口不做语义」是本票的明确边界（克隆连表单表都没复制），而入口要禁得住刷新页面，
        判据就不能只活在前端内存里 —— 所以它是**服务端**这一问，和 `sweep_ephemeral` 认的是
        同一个标记，不是第二份口径。

        pg 侧同名方法读 `avery.contexts.ephemeral` 列。账号一绑（`link_account_context`）这个
        标记就会被清掉——那时它不再是一次性的，入口自然重新出现，这正是想要的语义。
        """
        return context_id in self._ephemeral_at

    def __contains__(self, context_id: str) -> bool:
        return context_id in self._by_id

    def clear(self) -> None:
        self._by_id.clear()
        self._notes.clear()
        # issue #78: `_advise_runs` 此前**不在这份清单里**（自 #49 起就漏了）。没被咬到纯属
        # 运气——现有测试每次都用新铸的 context_id，残留够不着。按场分组的测试一旦复用固定
        # cid 就会读到上一条测试的轮次，是假红/假绿的现成温床。补进来并配一条门。
        self._advise_runs.clear()
        self._asks.clear()
        self._ask_tokens.clear()
        self._form_templates.clear()
        self._form_submissions.clear()
        self._form_tokens.clear()
        self._account_contexts.clear()
        self._context_owner.clear()
        self._ephemeral_at.clear()
        with self._jobs_lock:
            self._ingest_jobs.clear()   # #90: 同 _advise_runs 那条注释的教训——漏清就是残留温床


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
    # issue #93 · 全档案重跑闸的字节入口（按 key，不按 idx —— 理由见内存腿那份实现）。
    def source_document_bytes_by_key(self, context_id: str, source_key: str) -> bytes | None: ...
    # issue #99 · 补传在抽取**之前**唯一需要的那次读：已占用的 key 集合，不留住档案。
    # None = context 不存在；空集合 = 存在但没有文档（两者不许混）。
    def source_document_keys(self, context_id: str) -> set[str] | None: ...
    def clone_context(self, src_context_id: str, *, new_context_id: str,
                      new_owner_token: str, ephemeral: bool = True) -> bool: ...
    # #86 · 清空这一份档案（id / owner_token 不变）。⚠ 与 pg 独有的 `delete()` 是**反面**：
    # 那个删的是 contexts 行本身，连 id 带 token 一起没；这个只清「文件和文件推出来的东西」。
    def empty_context(self, context_id: str) -> bool: ...
    def sweep_ephemeral(self, *, older_than_hours: int, limit: int = 50) -> int: ...
    def is_ephemeral(self, context_id: str) -> bool: ...

    # #90 · async deposit: bytes + a queued job land atomically; the worker drives the lifecycle.
    def deposit_new_context(self, *, context_id: str, name: str, owner_token: str,
                            source_documents: list[SourceDocument], job: IngestJob) -> None: ...
    def deposit_append(self, context_id: str, source_documents: list[SourceDocument],
                       job: IngestJob) -> None: ...
    def claim_next_ingest_job(self) -> IngestJob | None: ...
    def finish_ingest_job(self, job_id: str, *, status: str, reason: str = "",
                          extraction_mode: str = "") -> None: ...
    def latest_ingest_job(self, context_id: str) -> IngestJob | None: ...
    def recover_orphan_ingest_jobs(self) -> int: ...

    # Avery's notes (write side)
    def append_note(self, context_id: str, text: str, source_excerpt: str = "") -> CompanyNote: ...
    def list_notes(self, context_id: str) -> list[CompanyNote]: ...

    # advise-run history (issue #49; threads = issue #78)
    def append_advise_run(self, context_id: str, question: str, *, title: str = "",
                          locale: str = "en", advice: dict | None = None,
                          answer: str = "", thread_id: str = "") -> AdviseRun: ...
    def list_advise_runs(self, context_id: str, limit: int = 50) -> list[AdviseRun]: ...
    # ⚠ limit 在这两个方法上是**两种单位**：runs 数行、threads 数场。见实现的 docstring。
    def list_advise_threads(self, context_id: str, limit: int = 20) -> list[AdviseThread]: ...

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
    # T9 · gap2 #58：自动补铸（form_autofill.py）要的两问一写
    def list_form_submissions_in_period(self, context_id: str, template_id: str,
                                        period: str) -> list: ...
    def latest_form_period_before(self, context_id: str, template_id: str,
                                  period: str) -> str | None: ...
    def put_form_submission_if_absent(self, submission): ...
    def expire_form_submission(self, submission_id: str, at_iso: str) -> str: ...

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

    #93 收尾 · **收走的卡不写进来**。在这之前这个函数把 `extraction.people/projects` 原样全写，
    于是顾问引得到经理已经软删的项目（`archived`，rich-align-0722/05a 起就漏着）、停用的成员，
    以及 #93 新加的被系统折叠掉的卡。屏幕上没有、顾问却张口就来，是最难自证的一类错——经理没法
    点开那张卡去对，只会觉得这东西在胡说。判据用 `hidden_reason()` 这一份（不在这里抄第二份，
    理由整段写在它上面）。

    ⚠ 折叠掉的那张卡的**原文**并没有从检索里消失：文档正文照旧进 `materials` → RAG 分块
    （granularity 模块 docstring 里那条 “Their text survives in the RAG material chunks” 同理）。
    这里去掉的只是「存在一个叫 X 的项目」这句**由卡合成的断言**——而那张卡确实已经不存在了。
    """
    dest = Path(dest)
    dest.mkdir(parents=True, exist_ok=True)

    people = [p for p in extraction.people if not hidden_reason(p)]
    projects = [pr for pr in extraction.projects if not hidden_reason(pr)]

    facts: list[str] = ["# Company facts (ingested from uploads — qualitative, red-line-clean)", ""]
    if people:
        facts.append("## People (qualitative only — no scores, no blood bars)")
        for p in people:
            facts += p.as_facts_lines()
        facts.append("")
    if projects:
        facts.append("## Projects")
        for pr in projects:
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
