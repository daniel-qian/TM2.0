# -*- coding: utf-8 -*-
"""issue #93 · 补传后**全档案**重跑粒度闸 —— 三道锁，缺一不可。

## 病
「一次全选 == 逐份补传」这个不变式，#92 只在一种形状上让它成立（R5-duty-column 是文档局部判定，
所以单批与全批必然同判）。R1/R3/R4 三条折叠规则**全部依赖跨文档证据池**，而补传路的
`extract_docs(fresh_docs)` 只喂得到这一批文件 —— 于是同一份语料，一次全选落 11 张项目卡、
逐份补传落 18 张（生产实测，exploration.md 症状③）。差的那 7 张不是「多给了用户一点东西」：
它们是里程碑/阶段/文件名冒充的项目卡，混在真项目里，经理分不出哪张是真的。

## 为什么这件事被推迟了两票
`file_append.py:133-136` 那段 ⚠ 写着「把整份 ctx.extraction 连同单份新文档喂给闸，会让它拿一个
缺了源文档的 docs 集合去重判每一张老卡，那是**整表静默删除**，比漏判坏得多」。那句话在写下时
是对的，它站在两个当时不成立的前提上：**字节重建不出全量 docs**、**卡的血缘查不到**。
两个前提都被 #87 推翻了（`registry.py` 的 content bytea 全在库、`extract.py` 的
`lineage["docs"]` 记着每张卡的来源文档），`file_delete.py:36-52` 已经为同一块碑立过第一个订正。
本模块是第二个 —— 但那句担忧**保留为实现约束**：本模块**一行都不删**。

## 三道锁（缺一不可，而且刻意是三道**不同的**门）
  ① **只折叠不删除**。降级的必要条件是 `ruling.parent_kind == "project"` 且那个 parent
     在**当下可见的**卡里找得到；命中就走 `_absorb_project` 把读数并进母卡，被折叠那张卡
     打 `folded_into=<parent.id>` 留在原地。无 parent 的规则（R2/R4）与 parent 是**人**的
     规则（R5）在这条路上一律禁开火 —— 没有「并去哪里」的答案，一开火就是纯删除。
     ⚠ 这是两把**分开的**锁，两道**分开的**门：`parent_kind` 管命名空间，pool 查找管在场性。
     写在一处会互相免疫变异（progress.md 0808：两把锁挂同一扇门，各自都变异不掉）。
  ② **血缘完整性前置断言**。判之前先算 ∪(待判卡.lineage["docs"])；这些文档里只要有一份
     **在档案里、字节却重建不出来**（拉不回 / content IS NULL 的存量行 / parse 失败），
     **整个重判放弃**，退回今天的行为，回执诚实记账。fail closed 的理由很朴素：重建不出来
     意味着我们不知道自己少看了什么，而「少看了什么」正是误判的唯一来源。
  ③ **软折叠**。`folded_into` 是新字段（Danny 0812 拍板不复用 `archived`，理由写在
     `ProjectEntity.folded_into` 上），只在投影层生效（`registry._active_projects()` 是唯一
     过滤点），**可逆** —— 清空这一格卡就回来，一个读数都没丢。

## 一个刻意的**非**对称，别当 bug 修
抽取路（`apply_gate`）对降级候选是**丢弃**，本路是**折叠+并入母卡**。所以「全选」与「逐传」
两条路跑完，`extraction.projects` 这张**原始列表**不等长（逐传那边多出被折叠的壳），而母卡的
并集字段可能多吸了几条。不变式落在**投影**上 —— `project_cards()` / `_active_projects()`，
也就是经理屏幕上真正看得见的那张表。这是对的取舍：抽取路那些候选是几秒钟前刚抽出来、
没有任何人见过的临时对象；补传路这些卡是经理正对着编辑、归档、引用的东西。

## 一个已知缺口，写在这里免得被读成「验过了」
被折叠的卡在**产品上今天是不可见的**（折叠抽屉 UI 不在 #93 票内），也仍然会进 `facts.md`
（`materialize_memory` 对 `archived` 从来也没过滤过，本票不动它 —— 改它会同时改归档语义）。
「为什么这张卡不见了」现在**答得出**（裁决随 context 落库，`Ruling.subject_id` 指到卡），
但今天只有后端答得出。
"""
from __future__ import annotations

import logging
import time

from dataclasses import dataclass, field, replace

from .extract import MANUAL_PROVENANCE_ORIGIN, _absorb_project, hidden_reason
# 🔴 ONE RULER：parent 的比对键必须与闸**判定 parent 存在**时用的那把尺逐字相同。
# `classify` 里 R3 是在 `project_titles`（按 `granularity._key` 建的）里找到 parent 的，
# R1 的 parent 是 `build_milestone_index` 按同一把尺索引出来的块标题。这里改用
# `extract._project_key`（归并那把尺，折叠标点的口径不同）就会出现「闸说 parent 在、
# 折叠说 parent 不在」的静默分裂：一整类降级从此永远走不到，而没有任何一道门会红。
from .granularity import _key as _title_key, judge_projects
from .parse import ParsedDoc, ParseError, parse_bytes

log = logging.getLogger("avery.ingest.rejudge")


@dataclass
class FoldRecord:
    """一次折叠的回执行：谁被并进了谁，凭哪条规则。"""
    subject_id: str
    title: str
    parent_id: str
    parent_title: str
    rule: str


@dataclass
class RejudgeReport:
    """一趟全档案重判的诚实记账 —— 跑没跑、判了几张、折了几张、**没折的为什么没折**。

    🔴 `active_before` / `active_after` 是**对照基准**，不是装饰：销毁/收缩类判据天生空真
    （「折叠后为 11」对着一个从来就只有 11 张卡的档案照样绿）。回执里这两个数一起出现，
    门才写得出「18 张 → 11 张」那种有牙的判据。
    """
    ran: bool = False
    reason: str = ""                                   # 没跑 / 中途放弃的原因（fail closed 记账）
    active_before: int = 0
    active_after: int = 0
    judged: int = 0
    folded: list[FoldRecord] = field(default_factory=list)
    # 判了但**没敢折**的：{"title","rule","parent","parent_kind","why"}。刻意不进
    # `extraction.granularity` —— 那张表是「这张卡为什么不见了」的答案簿，而这些卡还在屏幕上。
    refused: list[dict] = field(default_factory=list)
    skipped_no_lineage: int = 0                        # 手编卡 / #87 之前的存量卡：判不了，不折
    skipped_missing_docs: int = 0                      # 来源文档已被 #77 删掉：判不了，不折
    skipped_manual: int = 0                            # 经理手编过的卡：系统不收走（见 `_manually_touched`）
    docs_rebuilt: int = 0
    docs_unrebuilt: list[str] = field(default_factory=list)


def _card_docs(card) -> list[str]:
    """这张卡的来源文档集合（`lineage["docs"]`），脏数据一律当「没有」。

    空列表有两种成因，本模块**一视同仁**地当作「判不了」：手编卡（`pm-…`，从来没有文档喂过它）
    与 #87 之前落库的存量卡。区分它们要看 `provenance`（`_init_lineage` 上那条注释），而这里
    不需要区分 —— 两种都不该被一条它自己说不清出处的裁决折走。
    """
    lin = getattr(card, "lineage", None)
    docs = lin.get("docs") if isinstance(lin, dict) else None
    if not isinstance(docs, list):
        return []
    return [str(d).strip() for d in docs if str(d).strip()]


def _manually_touched(card) -> bool:
    """经理**亲手改过**这张卡吗（`provenance[格子].origin == 'manual'`）。

    🔴 改过的卡系统不收走。这一条不在票面上，是照着这个仓库自己的纪律推出来的：补传路
    「只有在确凿地知道新资料更新时才让新值顶掉旧值」，而手编格子**恒不被文档顶掉**
    （`_APPEND_REFRESHABLE` 那一节的 🔴）。折叠比顶掉一格重得多——它把整张卡从经理眼前收走。
    一个刚给某张卡填过负责人、改过摘要的人，第二天补一份周报就发现那张卡不见了，
    这是这条防线能造成的最坏的一次体验，而它换来的只是少折一张。宁可漏。

    ⚠ 判据是 `provenance` 不是 `lineage`：前者答「这一格现在归谁」（手编赢），后者答文档出处。
    手编卡本身（`pm-…`，source 恒空）走的是另一条路——它血缘为空，在上面那道 `_card_docs`
    就已经被排除了。
    """
    prov = getattr(card, "provenance", None)
    if not isinstance(prov, dict):
        return False
    return any(isinstance(rec, dict) and rec.get("origin") == MANUAL_PROVENANCE_ORIGIN
               for rec in prov.values())


def _archive_keys(ctx) -> list[str]:
    """档案里每一份资料的有效 key —— 与 `file_delete` / `_chunks_per_file` 逐字符同一个表达式。"""
    return [(sd.source_key or sd.filename) for sd in ctx.source_documents
            if (sd.source_key or sd.filename)]


def _rebuild_archive(reg, ctx, ready: dict[str, ParsedDoc],
                     required: set[str]) -> tuple[list[ParsedDoc], list[str], str]:
    """把整个档案从**存下来的字节**重建成 ParsedDoc 列表。

    返回 `(docs, unrebuilt_keys, abort_reason)`；`abort_reason` 非空 = 锁② 开火，调用方必须
    整个放弃重判（**不是**跳过这一份文档继续判）。

    `ready` 是这一趟刚 parse 过的那几份（key -> ParsedDoc）：直接复用，不重新拉字节也不重新
    parse。省的不只是时间 —— 重新 parse 一遍同样的字节，是给「两次 parse 结果可能不同」这件
    事开了一扇没有必要的门。

    ⚠ 只有 `required`（待判卡的来源文档）里那几份的失败才 fail closed。其余文档重建不出来
    只会让证据池变**小**，而证据池变小对本模块是安全方向：R1 少几条里程碑、R3 少几个候选母项目、
    R4 少几个文档身份 —— 三条规则**全部**因此更少开火，不会更多。所以那种失败记账、继续跑。
    """
    docs: list[ParsedDoc] = []
    unrebuilt: list[str] = []
    for sd in ctx.source_documents:
        key = (sd.source_key or sd.filename)
        if not key:
            continue
        if key in ready:
            docs.append(ready[key])
            continue
        data = sd.content
        if data is None:
            # get() 刻意不拉 bytea（pg_registry 那条「清单不许把每份文件拖进内存」的纪律），
            # 所以存量文档在这里必然走这条按需取字节的路。
            data = reg.source_document_bytes_by_key(ctx.context_id, key)
        if data is None:
            unrebuilt.append(key)
            if key in required:
                return [], unrebuilt, f"来源文档「{key}」的字节拉不回来（content 为 NULL 或已不可读）"
            continue
        try:
            docs.append(parse_bytes(key, data))
        except ParseError as e:
            unrebuilt.append(key)
            if key in required:
                return [], unrebuilt, f"来源文档「{key}」重新解析失败：{e}"
    return docs, unrebuilt, ""


def rejudge_archive(reg, ctx, ready: dict[str, ParsedDoc] | None = None) -> RejudgeReport:
    """补传结束前，拿**整个档案**重跑一遍粒度闸；能折的折，折不动的老老实实不动。

    调用方是 `file_append.append_docs_to_context`，位置在归并之后、整体红线与 `put()` 之前 ——
    折叠会改写母卡（`_absorb_project` 把读数并过去），所以整体红线必须看到折叠**之后**的样子。

    ⚠ 就地 mutate `ctx.extraction`（母卡吸收 + 被折卡打标 + 追加裁决记录），与补传路其余部分
    同一条纪律：`reg.get()` 回来的是活引用，所以能 raise 的事全在前面做完。本函数从
    `_absorb_project` 那一行起才第一次写东西，在那之前只读。
    """
    report = RejudgeReport()
    projects = list(getattr(ctx.extraction, "projects", []) or [])
    # 判的是**经理此刻看得见的那张表**：归档过的卡已经离开项目轴，被折过的卡读数已经在母卡上
    # —— 再判一次只会把它们折第二次。判据是 `extract.hidden_reason()` 那**一份**（#93 收尾把
    # 原先散在三处的同一条口径收了口，理由整段写在那个函数上方）。既是待判集，也是母卡池。
    visible = [pr for pr in projects if not hidden_reason(pr)]
    report.active_before = len(visible)
    report.active_after = len(visible)
    if not visible:
        report.reason = "这份档案没有可见的项目卡"
        return report

    archive = set(_archive_keys(ctx))
    judgeable: list = []
    for pr in visible:
        if _manually_touched(pr):
            report.skipped_manual += 1
            continue
        card_docs = _card_docs(pr)
        if not card_docs:
            report.skipped_no_lineage += 1
            continue
        if any(d not in archive for d in card_docs):
            # 来源文档被 #77 删掉了。这**不是**锁② 的那三种成因（字节拉不回 / content 为 NULL /
            # parse 失败）—— 那三种是存储完整性出了问题，我们不知道自己少看了什么；这一种是
            # 经理**自己**删的，#77 已经按「诚实的降级」结过案。把它升级成「整个重判放弃」，
            # 等于让一次删除永久地、静默地关掉这条防线；只把**这张卡**排除在待判之外，
            # 正好落在危险的那一点上：判一张卡时缺的是**它自己**那份文档才会误判。
            report.skipped_missing_docs += 1
            continue
        judgeable.append(pr)

    if not judgeable:
        report.reason = "没有一张判得了的卡（血缘为空 / 来源文档已删 / 经理手编过）"
        return report

    required = {d for pr in judgeable for d in _card_docs(pr)}
    docs, unrebuilt, abort = _rebuild_archive(reg, ctx, dict(ready or {}), required)
    report.docs_unrebuilt = unrebuilt
    if abort:
        # 锁②。整个重判放弃 = 退回今天的行为（本函数一个字段都没写过），回执把原因写出来。
        report.reason = abort
        log.warning("rejudge abandoned for context %s — %s", ctx.context_id, abort)
        return report
    report.docs_rebuilt = len(docs)

    rulings = judge_projects(judgeable, list(getattr(ctx.extraction, "people", []) or []), docs)
    report.judged = len(rulings)

    # 母卡池 = 这一轮**判完还是项目**的卡 + 判不了因而原地不动的卡。两件事：折叠目标必须仍然
    # 可见（并进一张经理看不见的卡 = 把读数搬进黑箱），且必须不是本轮的降级对象（否则 A→B、
    # B→C 会在同一趟里连锁，而每一环的理由都是对着折叠前那份快照说的）。
    demoted = {id(pr) for pr, r in zip(judgeable, rulings) if r.verdict != "project"}
    pool: dict[str, object] = {}
    for pr in visible:
        if id(pr) in demoted:
            continue
        pool.setdefault(_title_key(pr.title), pr)

    for pr, r in zip(judgeable, rulings):
        if r.verdict == "project":
            continue
        # ── 锁①-a：parent 的**命名空间**。R5 的 parent 是一个**人**（职责栏那一行的主人），
        # R2/R4 根本没有 parent。把人名拿到项目列表里查，遇上一家有同名项目的公司就会把职责格
        # 折进一个毫不相干的项目，而折叠理由读起来完全站得住。
        if r.parent_kind != "project":
            report.refused.append({"title": r.title, "rule": r.rule, "parent": r.parent,
                                   "parent_kind": r.parent_kind,
                                   "why": "这条规则没有指向一个项目的 parent，折过去等于纯删除"})
            continue
        # ── 锁①-b：parent 的**在场性**。闸是对着文档判的，它说的 parent 可能只存在于某份
        # 文档的标题里，而没有对应的卡（比如那个母项目从来没被抽成过卡）。
        parent = pool.get(_title_key(r.parent))
        if parent is None:
            report.refused.append({"title": r.title, "rule": r.rule, "parent": r.parent,
                                   "parent_kind": r.parent_kind,
                                   "why": "存量卡里找不到这个 parent"})
            continue
        _absorb_project(parent, pr)
        pr.folded_into = parent.id
        # 裁决落库（票面②）：这条记录是「为什么这张卡不见了」重启之后唯一的答案。
        # `subject_id` 只在这条路上记 —— 抽取路的 id 还没定稿（见 `Ruling.subject_id`）。
        ctx.extraction.granularity.append(replace(r, subject_id=pr.id))
        report.folded.append(FoldRecord(subject_id=pr.id, title=pr.title, parent_id=parent.id,
                                        parent_title=parent.title, rule=r.rule))

    report.ran = True
    report.active_after = report.active_before - len(report.folded)
    return report


def rejudge_after_append(reg, ctx, ready: dict[str, ParsedDoc] | None = None) -> RejudgeReport:
    """`rejudge_archive` + 一行分段计时（#90 的四段口径外挂的第五段）。

    单独一层是为了让计时**永远**跟着这条路走：全档案重跑的成本随档案线性涨（每份文件一次
    bytea 查询 + 一次 parse），CSV 秒级、大 PDF 不是，而「量出来再说」需要真的量。

    ⚠ `files=` 在这一行数的是**整个档案**重建出来的文档数，不是这一批新文件数——其余四段数的
    是后者。看着像口径不一致，实际上正是这一段要报的那个数：本段的成本与批次大小无关、只与
    档案大小有关，而「第 N 次补传为什么更慢」正是要靠这两个数并排放着才看得出来。
    字段名仍叫 `files=` 是因为 `ingest-timing` 是一条**逐字段固定**的日志契约
    （test_append_pipeline_logs_all_four_stages 扫每一行都得有 files= 与 elapsed_ms=）。
    """
    t0 = time.perf_counter()
    report = rejudge_archive(reg, ctx, ready)
    log.info("ingest-timing stage=rejudge context_id=%s files=%d judged=%d folded=%d ran=%s "
             "elapsed_ms=%.0f", ctx.context_id, report.docs_rebuilt, report.judged,
             len(report.folded), report.ran, (time.perf_counter() - t0) * 1000)
    return report
