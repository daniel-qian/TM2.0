# -*- coding: utf-8 -*-
"""T10 · append-upload —— 给一家**已经存在**的公司补资料：新文件原地 append 进当前 context。

拆掉的是那堵「每次上传 = 新开一家公司」的墙。`POST /ingest` 恒新建 context
（ingest_api.py），而 `pipeline.ingest_docs` 的 `context_id` 参数是**覆盖**语义不是追加：
它照旧只对这一批新文件跑抽取，然后**新造一个 CompanyContext** 拿去 put。

🔴 命门①（与 form_append.py 逐字同一条，arch-0802）：**绝不新造 `CompanyContext`，
绝不调 `ingest_paths` / `ingest_docs`。** 通道只有一条：`ctx = reg.get(context_id)` →
在**那个对象**上原地 mutate → `reg.put(ctx)`。pg 侧的 put() 是 DELETE+INSERT 快照替换，
靠两张 ON COMMIT DROP 临时表**只回填 NULL 单元**——回填补的是「行还在、格子是 NULL」，
补不回「整行不存在」。新造的 CompanyContext 里 source_documents 是空列表：拿它去 put，
老文档的原件字节、全部旧 chunk、全部实体会在一次写里永久蒸发。

🔴 命门②：**只对新文件跑抽取。** LLM 花费与新文件数成正比，不与公司资料总量成正比——
对整份语料重跑一遍抽取，第十次补传就要为前九批已经读过的文件再付一次钱，而且（更糟）
会把经理这十天里的手编 CRUD 全部推平。所以这里是 `extract_docs(新文件)` 之后**归并**，
不是 `extract_docs(全部文件)`。归并的四个坑与它们的答案写在 `extract.AppendLedger` 上面。

🔴 命门③：**先造后挂。** 能 raise 的事（解析、抽取、红线）全部做完，才碰 `ctx` 一个字段——
内存 registry 的 `get()` 返回的是**活引用**，改到一半再失败等于坏状态已经落在库里了。

## 补传与「新建一家公司」的分界（拍板③）
补传后卡片**安静更新**：新资料顶掉旧读数时卡直接显新值、逐字段出处指向新资料，不打扰；
只有互相矛盾/新的更糟才走今天页那条已经在线的双栏通道（跨资料对照的那两条定级规则，
口径与规则号只住在 `avery/decision_rules.py` / `decision_grading.py` /
`decision_grading_rules.md` 三处，这里刻意不抄一份——`test_no_rule_text_in_any_prompt` 扫全仓）。
本函数只负责往 `extraction.conflicts` 上诚实记账，判不判级、上不上今天页一概不归它管。

这也是本票不能砍半的原因：只把文件塞进资料库而不动卡片，时间轴会说「资料很新」
（于是那条「证据过期了」的提醒当场闭嘴），而卡片还挂着上个月的读数——产品在对着经理撒谎，
且那句本来会提醒他的话刚好被我们自己关掉了。
"""
from __future__ import annotations

import logging

from dataclasses import dataclass, field
from pathlib import Path

from avery.scoring_policy import person_scoring_allowed

from .extract import (
    AppendLedger, ExtractionResult, Extractor, _link_owners, _project_key,
    dedupe_signals_after_linking, extract_docs, merge_person_reading, merge_project_reading,
)
from .parse import ParsedDoc, ParseError, parse_file
from .pipeline import _finalize_source_documents
from .redline_extract import ExtractionRedlineResult, ExtractionViolation, validate_extraction
from .registry import SourceDocument, materialize_memory

log = logging.getLogger("avery.ingest.file_append")


@dataclass
class AppendReport:
    """一次补传的回执。形状照 `IngestReport` 的先例（同名字段同语义），多出来的三个计数是
    「这一趟到底动了什么」——端点把它投给前端，回执里也照它写。"""
    ok: bool
    context: object | None = None
    redline: ExtractionRedlineResult | None = None
    parsed: list[ParsedDoc] = field(default_factory=list)
    parse_errors: list[str] = field(default_factory=list)
    added_documents: list[SourceDocument] = field(default_factory=list)
    skipped_duplicates: list[str] = field(default_factory=list)
    people_touched: int = 0
    projects_touched: int = 0
    conflicts_added: int = 0

    @property
    def violations(self) -> list[ExtractionViolation]:
        return self.redline.violations if self.redline is not None else []


def existing_source_keys(ctx) -> set[str]:
    """这家公司资料库里已经占用的 source_key。

    补传必须拿它去给新文件重新起名（`_unique_parse_names` 的 `used` 种子）。不这么做的后果
    不是「两行同名」这种表面问题：`<source_key>:<行号>` 是**出处契约**，两份文档共用一个 key
    之后，`doc_key_of` 会把新文档的每一条读数算到**旧文档**头上——文件清单的每文件块数、
    时间轴的那一天、冲突卡上引用的那份资料，三处一起指错，而且没有任何一道门会红。
    """
    return {(sd.source_key or sd.filename) for sd in ctx.source_documents
            if (sd.source_key or sd.filename)}


def append_docs_to_context(reg, context_id: str, docs: list[ParsedDoc],
                           source_documents: list[SourceDocument],
                           *, extractor: Extractor | None = None,
                           parse_errors: list[str] | None = None) -> AppendReport:
    """把一批**已解析**的新文档 append 进 `context_id` 这家公司：抽取 → 红线 → 归并 → put。

    抛 KeyError（context 不存在，端点转同体 404）。红线不过按 `ok=False` 回执返回，
    **一个字段都不写**（端点转 422，与 /ingest 的姿态一致）。
    """
    ctx = reg.get(context_id)
    if ctx is None:
        raise KeyError(context_id)

    errors = list(parse_errors or [])

    # ── 调用方契约：每份 ParsedDoc 的 `name` 必须**就是**它那份 SourceDocument 的 source_key ──
    # 端点侧靠「把临时文件写成 parse_name」保证这件事（`parse_file` 用的就是那个基名）。写错的
    # 下场原本是**静默丢一份文档**：它不匹配任何 key，于是被下面的过滤悄悄滤掉，回执还是 200。
    # 宁可当场炸给调用方，也不让一份客户传上来的资料无声消失。
    supplied = {(sd.source_key or sd.filename) for sd in source_documents}
    stray = [d.name for d in docs if d.name not in supplied]
    if stray:
        raise ValueError(
            f"parsed documents {stray} have no matching SourceDocument.source_key — the parse name "
            f"and the source_key must be the same string (they are two halves of the "
            f"'<source_key>:<line>' citation contract)")

    # ── 幂等：这份资料的 key 已经在库里就不再落第二份 ────────────────────────────────────
    # 端点侧的 `_unique_parse_names(used=existing_source_keys(ctx))` 已经保证新 key 不撞老 key，
    # 所以这里通常一条都不命中；它守的是重试/并发那一发（同一个请求被送了两次）。
    taken = existing_source_keys(ctx)
    skipped = [sd.source_key or sd.filename for sd in source_documents
               if (sd.source_key or sd.filename) in taken]
    fresh_sds = [sd for sd in source_documents if (sd.source_key or sd.filename) not in taken]
    fresh_docs = [d for d in docs if d.name not in taken]

    if not fresh_docs:
        # 一份都读不出来（或全是重复）——照 `ingest_paths` 的 feat-032 P2 口径：宁可回一条
        # 诚实的失败，也不把一批读不到的字节挂进资料库然后答 200。
        empty = validate_extraction(ExtractionResult())
        return AppendReport(ok=False, context=None, redline=empty, parsed=[],
                            parse_errors=errors, skipped_duplicates=skipped)

    # ── 只对新文件跑抽取（命门②）────────────────────────────────────────────────────────
    # `extract_docs` 内部照旧跑 apply_gate → _dedupe_entities → _link_owners，但作用域是
    # **这一批**：新文件之间的跨文档归并与冲突在这里就地解决，然后才轮到与存量的归并。
    # ⚠ 已知边界：粒度闸（granularity.apply_gate）只看得见这一批文档，所以「新文档里的一条
    #    里程碑其实属于一个**存量**项目」这种跨批次误判它挡不住——把整份 ctx.extraction 连同
    #    单份新文档喂给它会让它拿一个缺了源文档的 docs 集合去重判每一张老卡，那是整表静默删除，
    #    比漏判坏得多。宁可漏，写在这里。
    fresh = extract_docs(fresh_docs, extractor=extractor)

    # ── 红线硬门：先造后挂（命门③）——这一步之前 ctx 一个字段都没动 ──────────────────────
    rl = validate_extraction(fresh)
    if not rl.ok and not person_scoring_allowed():
        return AppendReport(ok=False, context=None, redline=rl, parsed=fresh_docs,
                            parse_errors=errors, skipped_duplicates=skipped)

    # ── 从这里开始才碰 ctx ──────────────────────────────────────────────────────────────
    # 顺序有讲究：source_documents 必须**先**挂上去，账本才解得出新资料的上传时刻
    # （`AppendLedger` 按 source_key 建的那张时刻表就是从它来的）。
    finalized = _finalize_source_documents(fresh_sds, fresh_docs, fresh)
    ctx.source_documents.extend(finalized)
    for d in fresh_docs:
        if d.name not in ctx.source_files:
            # briefing 的 "Ingested N of M" 口径：source_files 数的是「parse 成功的」。
            ctx.source_files.append(d.name)

    ctx.extraction.materials.extend(fresh.materials)
    _extend_playbooks(ctx.extraction, fresh)
    ctx.extraction.granularity.extend(fresh.granularity)

    # 账本必须在**追加实体之前**构造：它要按当前这份清单反查「已经开过的冲突归哪个主体」，
    # 而新来的那些人/项目此刻还不该在清单里。
    # ⚠ 两个参数问的是**两件事**，别把 `finalized` 也传给第二个：`source_documents` 是「时刻表」
    # （账本要拿全表判新旧，只给新来的这几份会让每一次比较都退回 keep-first）；`batch_keys` 是
    # 「这一批是谁」（#87 血缘的 batch_id，票 7 靠它「撤回这一批」，传全表就等于每批都叫同一个名字）。
    ledger = AppendLedger(ctx.extraction, ctx.source_documents,
                          batch_keys=[(sd.source_key or sd.filename) for sd in finalized])
    conflicts_before = len(ctx.extraction.conflicts)

    for person in fresh.people:
        merge_person_reading(ctx.extraction.people, person, ledger=ledger)
    for project in fresh.projects:
        if not _project_key(project.title):
            # 无标题的项目卡：`_project_key("")` 会把所有无标题卡归成同一格。抽取器不该产出它，
            # 真产出了也只丢这一条，不连累整批资料。
            log.warning("skipping an untitled project reading from the appended batch")
            continue
        merge_project_reading(ctx.extraction.projects, project, ledger=ledger)

    ctx.extraction.signals.extend(fresh.signals)
    # 先 link 后去重（坑④）：`_link_owners` 是仓库里唯一那把姓名→id 的尺，跑完两边才是同一把尺，
    # 这时候用 `_signal_key` 去重才不是「换尺重筛」。顺带把新项目的 ownerId 解到存量花名册上。
    _link_owners(ctx.extraction)
    dedupe_signals_after_linking(ctx.extraction)

    # 与 pipeline / form_append 同一道门、同一个开关口径（材料本身刻意不扫 —— ADR-0023 只存不听；
    # 这里防的是「context 里既有的违规被本次写意外放行」）。
    whole = validate_extraction(ctx.extraction)
    if not whole.ok and not person_scoring_allowed():
        raise ValueError(
            f"red line: refusing to append into a scoring extraction ({whole.summary()})")

    # recall 面跟上：KeywordStore 真加块；PgVectorStore.add 是 no-op（put 落库后查询自然可见）；
    # in-memory VectorStore 只嵌新增这几块——**只嵌增量**正是命门②在花钱那一侧的落点。
    try:
        ctx.store.add(fresh.materials)
    except Exception as e:
        log.warning("adding %d appended chunks to the retrieval store failed (%s: %s) — the "
                    "documents still land; retrieval quality degrades until the next full ingest",
                    len(fresh.materials), type(e).__name__, str(e)[:200])

    # put() 只在 facts.md **不存在**时才重物化——get() 回来的 context 文件必然存在，所以这里必须
    # 自己重写，否则议事室的 recall 面（facts.md）读到的还是补传之前那份卡。
    materialize_memory(ctx.extraction, ctx.memory_dir)
    reg.put(ctx)

    return AppendReport(
        ok=True, context=ctx, redline=rl, parsed=fresh_docs, parse_errors=errors,
        added_documents=finalized, skipped_duplicates=skipped,
        people_touched=len(fresh.people), projects_touched=len(fresh.projects),
        conflicts_added=len(ctx.extraction.conflicts) - conflicts_before)


def _extend_playbooks(extraction: ExtractionResult, fresh: ExtractionResult) -> None:
    """方法卡按 (标题, 说明) keep-first 并进去。

    `MethodCard` 没有 id，也没有手编通道，所以这里只做一件事：同一批语料补传两次时，
    页面上的方法卡不翻倍。与信号那条去重同一个理由，只是尺子不同（方法卡没有主体）。
    """
    seen = {(m.title, m.description) for m in extraction.playbooks}
    for m in fresh.playbooks:
        if (m.title, m.description) in seen:
            continue
        seen.add((m.title, m.description))
        extraction.playbooks.append(m)


def append_paths_to_context(reg, context_id: str, paths: list[str | Path],
                            source_documents: list[SourceDocument],
                            *, extractor: Extractor | None = None) -> AppendReport:
    """磁盘上的一批新文件 → `append_docs_to_context`。`ingest_paths` 的补传孪生：
    逐份 parse、读不出来的跳过并记进 `parse_errors`，一份都读不出来时回一条诚实的失败。"""
    docs: list[ParsedDoc] = []
    errors: list[str] = []
    for p in paths:
        try:
            docs.append(parse_file(p))
        except ParseError as e:
            errors.append(str(e))
    return append_docs_to_context(reg, context_id, docs, source_documents,
                                  extractor=extractor, parse_errors=errors)
