# -*- coding: utf-8 -*-
"""issue #77 · 删掉一份已经传进来的资料——原件字节 + 它孵出的材料面，一起收走。

解的是这个死结：经理把一份带工资的表误传进来，今天**只能整库重开**（`FilesScreen.tsx`
v1 那条「后端写端点整批缺席，按不建假按钮红线 UI 上一个都不出现」）。本模块把写端点补上，
按钮才被允许上。

🔴 命门①（与 `file_append.py` 逐字同一条，arch-0802）：**绝不新造 `CompanyContext`。**
通道只有一条：`ctx = reg.get(context_id)` → 在**那个对象**上原地 mutate → `reg.put(ctx)`。
pg 侧的 put() 是 DELETE+INSERT 快照替换，靠临时表只回填「行还在、格子是 NULL」的单元，
补不回「整行不存在」——拿一个新造的 ctx 去 put，其余文档的原件字节会在一次写里永久蒸发。

🔴 命门②：**先查后改。** 所有能 raise 的事（context 不在、key 不在）做完，才碰 `ctx` 任何
一个字段。内存 registry 的 `get()` 返回的是**活引用**：删到一半再抛，坏状态已经落在库里了，
而且调用方收到的是异常、以为什么都没发生。

🔴 命门③：**`materialize_memory` 必须在 `put()` 之前。** pg 侧 facts.md 的正源是
`avery.memory_files` 表；只改磁盘不 put，下一次 `get()` 会把旧文本原样刷回来——议事室的
recall 面照旧引得到那份已经删掉的资料的原文。

## 删什么、不删什么（票内裁定，判据落在 tests/test_file_delete_t77.py）

**删**：原件字节与清单行（`source_documents`）、`source_files` 里那一项、这份文档切出的
材料块（`materials`）、它孵出的信号（`signals`，doc 派生的原始读数）、粒度闸对它那些候选
的裁决记录（`granularity`）、以及**任何一条把它当作一方的冲突**（`conflicts`）。

**不删**：人卡 / 项目卡 / 方法卡。不是偷懒，是**血缘不够**：`PersonEntity`/`ProjectEntity`
只有实体级单值 `source`，且归并是 keep-first（`file_append.merge_*` 不重写 source），多份
文档喂出来的卡 `source` 恒指第一份；字段级 `provenance` 只在补传/手编/表单回流时才 stamp，
**只 /ingest 过一次的公司整个是空 dict**。所以「按 source 判断就删卡」对多文档卡会误删，
「按 provenance 判断」对没补传过的公司一条都判不出来。删掉材料面之后，卡上的读数仍在、
但它的出处行没了——这是**诚实的降级**（前端删除确认文案要预告这一点），比误删一整张
经理手编过的卡好。要真做「卡随文档收缩」，前置是给实体加**来源文档集合**，那是另一张票。

🔴 **2026-08-10 · issue #87 更新了上面那段的前提，但没有更新本模块的行为。**
上一段点名的前置条件（「给实体加来源文档集合」）已经落地：`PersonEntity`/`ProjectEntity`
现在带一个 `lineage` side-car，`lineage["docs"]` 是**哪些文档提到过这张卡**、
`lineage["fields"][格子]["source"]` 是**这一格现在这个值是哪一份文档的哪一行给的**、
`prev` 是它顶掉的那条旧读数（形状与不变式写在 `extract.py` 的「#87 · 实体血缘」一节）。
两句「判不出来」从此都判得出来了。

**本模块仍然一格不动人卡/项目卡**，因为剩下的不是血缘问题，是三个**产品**问题（#87 票面
明写「本票只做地基」，它们归后续票）：
  1. **冲突要 retract 并重选胜者**——一条 `FieldConflict` 少了一方之后该由谁胜出，等于
     「替抽取器编一个它从没做过的判断」（见下一段），**需要产品拍板**；
  2. **`ownerName` 撤回不是一个字段**——`ownerId` 被清空后要由 `_link_owners` 重连，
     光写回名字，信号还挂在错的人身上；
  3. **并集字段被 `[:6]` 截断过**——prev 还原得回补料前那张列表，但那一趟被截掉的新条目
     谁也捡不回来（UI 就不该给这些字段撤回钮）。
在这三条有答案之前，删除仍然是「诚实的降级」——**但从今天起它是一个可以被写出来的降级，
不再是一个没有信息的降级**：血缘就在卡上，谁来做那张票都不用再重造一遍。

冲突为什么整条删而不是只摘掉那一方：`FieldConflict` 是一句「这两份资料对同一格给出了不同
读数」的陈述。一方没了，这句话就不再成立；留着它，今天页会拿一份经理刚删掉的文档跟他对质。
而「摘掉一方再重新推选胜者」等于**替抽取器编一个它从没做过的判断**——宁可整条收走。
"""
from __future__ import annotations

import logging

from dataclasses import dataclass, field

from .extract import doc_key_of
from .registry import SourceDocument, materialize_memory
from .store import KeywordStore

log = logging.getLogger("avery.ingest.file_delete")


@dataclass
class DeleteReport:
    """一次删除的回执。形状照 `AppendReport` 的先例——端点把它投给前端，回执里也照它写。"""
    ok: bool
    context: object | None = None
    removed: SourceDocument | None = None
    materials_removed: int = 0
    signals_removed: int = 0
    conflicts_removed: int = 0
    rulings_removed: int = 0
    remaining_documents: list[str] = field(default_factory=list)


def delete_document_from_context(reg, context_id: str, source_key: str) -> DeleteReport:
    """把 `source_key` 那一份资料从这家公司删掉。

    抛 `KeyError(context_id)`（公司不存在）/ `KeyError(source_key)`（这家公司没有这份资料），
    端点两条都转成**同体 404**（存在性不许被枚举出来——同 files 端点族既有姿态）。

    🔴 寻址用 `source_key` 不用 `idx`：`pg_registry.put()` 用 `enumerate` 重排 idx，删掉中间
    一份之后所有后续 idx 左移；而下载端点、draft-from-file 都按位置寻址。按 idx 删有 TOCTOU
    （拉清单 → 别人补传 → 删错一份），且删完之后前端手里的旧 idx 会**静默指向另一份文件**
    ——不是 404，是下错文件。`transport.ts` 那条「idx 不是稳定键，别缓存」的碑说的就是它。
    """
    ctx = reg.get(context_id)
    if ctx is None:
        raise KeyError(context_id)

    key = (source_key or "").strip()
    # 逐份算它的**有效**键——与 `file_cards()` 投给前端的那一格、与 `_chunks_per_file` 数块数
    # 的那一格，逐字符同一个表达式（ONE RULER）。
    target = next((sd for sd in ctx.source_documents
                   if (sd.source_key or sd.filename) == key), None)
    if target is None:
        raise KeyError(source_key)

    # ── 命门②的分界线：以上只读，以下才写 ────────────────────────────────────────────────
    before_materials = len(ctx.extraction.materials)
    before_signals = len(ctx.extraction.signals)
    before_conflicts = len(ctx.extraction.conflicts)
    before_rulings = len(ctx.extraction.granularity)

    ctx.source_documents.remove(target)
    # source_files 存的是 parse name（== source_key）——briefing 的 "Ingested N of M" 数它。
    ctx.source_files[:] = [n for n in ctx.source_files if n != key]

    # 🔴 必须调 `extract.doc_key_of`，禁手抄 rsplit：它决定「这条读数算哪份文档的」，一旦与
    # 清单数块数的那把尺漂开，删除就会漏切或多切，且没有任何一道门会红。
    ctx.extraction.materials[:] = [m for m in ctx.extraction.materials
                                   if doc_key_of(m.source) != key]
    ctx.extraction.signals[:] = [s for s in ctx.extraction.signals
                                 if doc_key_of(s.source) != key]
    ctx.extraction.granularity[:] = [r for r in ctx.extraction.granularity
                                     if doc_key_of(r.evidence) != key]
    # 冲突：只要有**任何一方**来自这份文档，整条收走（理由见模块 docstring）。
    # ⚠ `doc_key` 是 ConflictValue 上的现成字段（`doc_key_of(source)` 的产物），这里按它判；
    #    缺席时退回自己算一次，别让一条没打 doc_key 的老记录逃过。
    def _cites_target(conflict) -> bool:
        return any((v.doc_key or doc_key_of(v.source)) == key for v in conflict.values)

    ctx.extraction.conflicts[:] = [c for c in ctx.extraction.conflicts if not _cites_target(c)]

    _rebuild_store(ctx)

    # 命门③：先重物化，再 put。
    materialize_memory(ctx.extraction, ctx.memory_dir)
    reg.put(ctx)

    return DeleteReport(
        ok=True, context=ctx, removed=target,
        materials_removed=before_materials - len(ctx.extraction.materials),
        signals_removed=before_signals - len(ctx.extraction.signals),
        conflicts_removed=before_conflicts - len(ctx.extraction.conflicts),
        rulings_removed=before_rulings - len(ctx.extraction.granularity),
        remaining_documents=[(sd.source_key or sd.filename) for sd in ctx.source_documents])


def _rebuild_store(ctx) -> None:
    """检索面跟上：删除是 `add()` 的反面，而两个内存 store **都没有 remove**——只能整体重铸。

    🔴 分流必须按 `isinstance(ctx.store, PgVectorStore)`，不许用 `hasattr` 之类的鸭子探测：
    pg 环境下 `ctx.store` 是 `PgVectorStore`，它的 `add()` 是 no-op、**数据库自己才是 store**
    （行由 `pg_registry.put()` 的 DELETE+INSERT 快照一次写掉，删除在那一步已经生效）。这一支
    什么都不做才是对的；无脑重铸成 `KeywordStore` 的后果是把这家公司从向量检索**静默降级**
    到关键词——`query()` 照样返结果、所有现存门全绿，没有任何一处会红。

    另一条同族的雷：绝不许换成 `VectorStore` 重铸——那会把整份语料重嵌一遍，删一个文件付一次
    全量嵌入的钱（T2/#53 的老坑）。`KeywordStore` 是零成本的确定性重铸，与 `clone_context`
    里那一处的先例逐字相同。
    """
    from .store import PgVectorStore
    if isinstance(ctx.store, PgVectorStore):
        return
    store = KeywordStore()
    store.add(ctx.extraction.materials)
    ctx.store = store
