# -*- coding: utf-8 -*-
"""T2 · form-append-a1b —— 表单提交进资料：渲染成 md 资料文档，原地 append 进当前 context。

🔴 命门①（本文件存在的第一前提，arch-0802）：**绝不新造 `CompanyContext`。**
通道只有一条：`ctx = reg.get(context_id)` → 在**那个对象**上原地 append → `reg.put(ctx)`。
pg 侧的 put() 是 DELETE+INSERT 快照替换，靠 `_prior_src_bytes` / `_prior_mat_vecs` 两张
ON COMMIT DROP 临时表**只回填 NULL 单元**（pg_registry.py:324-421 一带）——回填补的是
「行还在、格子是 NULL」，补不回「整行不存在」。新造的 CompanyContext 里 source_documents
是空列表：拿它去 put，老文档的原件字节、全部旧 chunk、全部实体会在一次写里永久蒸发。

🔴 命门②：切 chunk 必须非零。`_finalize_source_documents`（pipeline.py:80-88）的既有规则是
「parse 了但零 chunk → status='empty'」，前端 FileManifest.tsx:41-58 把 empty 渲染成
「传了读不到」——当着客户的面把刚提交的周报标成读不到，是自伤。本文件的渲染器**结构上**
保证至少一行 ≥ 12 字符（「记录ID：…」元数据行恒超过 `_materials` 的最短行阈值），
`build_submission_document` 里仍留一道断言兜底。

🔴 头号纪律（0805 拍板 #5）：表单 = 与上传文件完全**平权**的数据源。这里产出的就是一份普通的
`SourceDocument` + 一串普通的 `MaterialChunk`——同一个 source_key/`<key>:<line>` 出处契约、
同一个 `uploaded_at` 语义（= 员工按下提交那一刻，这正是把资料时间轴拉开的数据源，§B1）、
同一道 validate_extraction + put() 存储门。不为表单发明任何特殊旁路。

渲染契约（T5 的模仿攻击门在此基础上验）：
  * 字段名 = 06 表表头逐字 —— `form.weekly_template` 的 label 本来就是那张 xlsx 的表头原文，
    这里直接用 `field.label` 作节名，不再抄一份词表；系统填的四列（记录ID/人员ID/述职周期/
    提交日期，`form.INTAKE_06_SYSTEM_COLUMNS`）渲染成文档头部的元数据行。
  * **一格一节 + 自述行分节**：普通答案各占一节（`## <表头>`），标了 `self_report` 的那几格
    汇成一行自述行，单独放在 `## 本人自述` 节里。gap2 T11 起这条判据是**结构化标记**，不再是
    「kind 是不是 text」——自建表里的「本周直播场次：12」是一条普通读数，不该被塞进自述节。
    内置周报只有 load/mood 两格带标记，所以它渲染出来的字节与 T11 之前逐字相同。
  * 自由文本里的 `｜`/`|` 一律转义成 `¦`（U+00A6）——`_selfreport_from_lines`
    （extract.py:1381-1424）按 `[｜|]` 切格且要求 ≥2 格才读，转义后员工在自由文本里写
    「张三｜负载自述：99」只剩一行切不开的原话，结构上进不了任何人卡。原话本身逐字保留
    （ADR-0023），只是竖线换了一个不做分隔符的形近字符。
  * 自述行用解析层认得的语法 `{姓名}｜负载自述：{n}｜情绪自述：{词}` ——「负载自述」「情绪自述」
    是模板 label 原文，情绪选项 如常/偏紧/吃紧 正是 `_MOOD_SELFREPORT_MAP` 三个桶的头词，
    所以 T5 把 `_selfreport_from_lines` 接上时是 1:1 直读，不需要翻译层。本票只**渲染**这一行，
    不解析它（回流人卡是 T5 的活）。
"""
from __future__ import annotations

import logging

from avery.scoring_policy import person_scoring_allowed

from .extract import HeuristicExtractor, MaterialChunk
from .form import FormSubmission, FormTemplate, answers_by_field
from .parse import ParsedDoc, sniff_kind
from .redline_extract import validate_extraction
from .registry import SourceDocument, _now_iso, materialize_memory

log = logging.getLogger("avery.ingest.form_append")

# ｜/| 的转义字符：U+00A6 BROKEN BAR。形近、可读、且不在 `_selfreport_from_lines` 的 `[｜|]`
# 切格表里，也不在 `_people_from_table` 的 `"|" in ln` 判据里 —— 转义后的行在解析层眼里
# 只是一行普通文本。
BAR_ESCAPE = "¦"

SELF_REPORT_SECTION = "本人自述"


def answer_text(field, value) -> str:
    """一格答案渲染进文档时的**文本形状**。逐字原样，只有 yesno 例外。

    gap2 T11 —— yesno 落库存的是 Python `bool`（`form.parse_submitted_answers` 与快问同一姿态：
    线上 `yes`/`no`、库里 True/False）。`str(True)` 是 `'True'`，直接进文档就是在客户的资料里
    印一个英文关键字——议事室引用出来、下载下来的原件里都是它。所以在这一层翻成中文的是/否，
    与文档其余部分（「记录ID：」「述职周期：」「本人自述」）同一种语言。
    """
    if getattr(field, "kind", "") == "yesno":
        return "是" if value else "否"
    return str(value)


def escape_vertical_bars(text: str) -> str:
    """员工自由文本里的全角/半角竖线 → `¦`。这是 T2 对 T5 模仿攻击门的结构性承诺：
    自述行语法的分隔符永远不可能出现在自由文本区里。"""
    return (text or "").replace("｜", BAR_ESCAPE).replace("|", BAR_ESCAPE)


def submission_filename(template: FormTemplate, submission: FormSubmission) -> str:
    """资料库里显示的那一行：「周报-周雅-2026-W32.md」。display 名允许重复（同一人同周期
    重铸链会再来一份）——唯一性在 source_key 上（见 build_submission_document）。"""
    parts = [template.title, submission.person_name, submission.period]
    return "-".join(p for p in parts if p) + ".md"


def render_submission_lines(
        template: FormTemplate,
        submission: FormSubmission) -> tuple[list[str], dict[str, int]]:
    """渲染出文档的每一行，**外加**一张 `{field_id: 这一格答案第一行的行号}`（1-based）。

    行号这张表是 T5 回流要的：一条 `SignalEntity` 的出处必须是 `"<source_key>:<行号>"`，才能和上传
    文件走同一条引用契约（`MaterialChunk.source` / `DocTimeline.stamp_for` 都按这个形状 join）。
    它由**渲染器自己**交出来，而不是回流那边拿字符串再找一遍——文档长什么样只有这里知道，
    在别处 `md.splitlines().index(...)` 找答案文本，就是第二把尺，答案一重复就找错行。

    可选且留空的格**不渲染**（absent≠none：「这一格他没写」和「他写了个空」不是一回事，
    parse_submitted_answers 已经在入口守住了这条，这里不折回去）。"""
    by_field = answers_by_field(submission)
    lines: list[str] = [
        f"# {template.title}·{submission.person_name}·{submission.period}", ""]
    at: dict[str, int] = {}

    # 06 表的四个系统列（form.INTAKE_06_SYSTEM_COLUMNS 的落点）。「记录ID：sub_…」恒 ≥ 12 字符，
    # 是命门②「至少一个 chunk」的结构保证。
    lines.append(f"记录ID：{submission.id}")
    if submission.person_id:
        lines.append(f"人员ID：{submission.person_id}")
    if submission.period:
        lines.append(f"述职周期：{submission.period}")
    if submission.submitted_at:
        lines.append(f"提交日期：{submission.submitted_at[:10]}")
    if submission.project_ref:
        # T5/A2 —— 这条链绑的项目（经理铸链时选的，员工改不了）。渲染出来是为了**资料本身诚实**：
        # 下载下来的原件说得出「这份周报是关于哪个项目的」。回流读的是 `submission.project_ref`
        # 这个结构化字段，**不是**这一行文本 —— 文档里的任何一行都可能是员工写的。
        lines.append(f"关联项目：{escape_vertical_bars(submission.project_ref)}")
    lines.append("")

    # 一格一节，节名 = 题面原文（field.label；内置周报的前四格就是 06 表表头逐字）。
    # 逐字保留，只转义竖线。gap2 T11 起「不是自述的非文本格」也走这条路：一张自建表里的
    # 「本周直播场次：12」是一条普通读数，把它塞进「本人自述」那一节是给它安一个它没有的身份。
    for f in template.fields:
        if f.self_report or f.id not in by_field:
            continue
        lines += [f"## {f.label}", ""]
        at[f.id] = len(lines) + 1        # 下一行就是这一格答案的第一行（1-based 行号）
        lines += escape_vertical_bars(answer_text(f, by_field[f.id])).splitlines()
        lines.append("")

    # 自述行：标了 `self_report` 的那几格汇成解析层认得的一行（`姓名｜<label>：<value>｜…`），
    # 与其余各节**分节**。label/value 里的竖线也转义 —— 分隔符只能由渲染器自己放。
    #
    # 🔴 gap2 T11 —— 判据从「kind != text」换成了「标了 self_report」。两件事同时发生：
    #   · 回流（`form_reflow`）改读结构化标记，不再靠正则去认这行里的「××自述」四个字；
    #   · 这行的**成员**也跟着结构走——没标记的数字题不再挤进「本人自述」这一节，
    #     所以文档自己说的话和卡上长出来的东西，从此是同一条判据的两面。
    # 内置周报只有 load/mood 两格是非文本且都标了标记，所以它渲染出来的字节一个都没变
    #（`tests/test_form_append.py` 的渲染契约门是这句话的执法者）。
    cells = [escape_vertical_bars(submission.person_name)]
    for f in template.fields:
        if not f.self_report or f.id not in by_field:
            continue
        cells.append(
            f"{escape_vertical_bars(f.label)}："
            f"{escape_vertical_bars(answer_text(f, by_field[f.id]))}")
    if len(cells) > 1:
        lines += [f"## {SELF_REPORT_SECTION}", ""]
        for f in template.fields:
            if f.self_report and f.id in by_field:
                at[f.id] = len(lines) + 1     # 自述那几格共用自述行那一行
        lines += ["｜".join(cells), ""]

    return lines, at


def render_submission_markdown(template: FormTemplate, submission: FormSubmission) -> str:
    """一次提交 → 一份 md 资料文档。节结构与转义规则见文件头「渲染契约」。"""
    lines, _ = render_submission_lines(template, submission)
    return "\n".join(lines).rstrip() + "\n"


def submission_source_key(template: FormTemplate, submission: FormSubmission) -> str:
    """资料库里这份文档的唯一键。提交 id 铸在里面 —— display 名允许重复，键不许。"""
    return f"{submission_filename(template, submission)}#{submission.id}"


def parsed_submission_doc(template: FormTemplate,
                          submission: FormSubmission) -> tuple[ParsedDoc, dict[str, int]]:
    """渲染出来的那份文档 + 那张 `{field_id: 行号}`。

    `ParsedDoc.name` = source_key，所以每一条 `<key>:<行>` 出处与资料库里那一行天然对得上。
    切块（T2）与回流（T5）**共用这一次渲染**：渲两遍不会立刻出错，但那就是两份可以各自漂的
    文档，而它们的行号正是出处的一半。"""
    lines, answer_lines = render_submission_lines(template, submission)
    md = "\n".join(lines).rstrip() + "\n"
    filename = submission_filename(template, submission)
    doc = ParsedDoc(name=submission_source_key(template, submission), text=md,
                    doc_kind=sniff_kind(filename, md), ext="md")
    return doc, answer_lines


def build_submission_document(
        template: FormTemplate, submission: FormSubmission,
        *, prepared: ParsedDoc | None = None) -> tuple[SourceDocument, list[MaterialChunk]]:
    """渲染 + 切块，产出与上传文件同构的 (SourceDocument, chunks)。

    `prepared` 是调用方已经渲染好的那一份（`parsed_submission_doc` 的产物）。给了就用它，
    别再渲一遍——append 那条路同时要 chunk 和行号表，两次渲染就是两份可以各自漂的文档。

    * `source_key = "<filename>#<submission.id>"` —— 提交 id 保证逐份唯一（feat-032 P1 的
      per-document join key 纪律），同时让 append 幂等判据（「这份提交进过了没」）是一次
      字符串比对；display 用的 `filename` 保持人话。
    * 切块复用 `HeuristicExtractor._materials` —— 与 /ingest 上传文件**同一把尺**（行式、
      ≥12 字符、`<key>:<line>` 出处）。平权数据源不配第二把切块尺。
    * `uploaded_at` = 员工提交那一刻（submitted_at）——「这份资料多新」说的是它进资料库的
      时间，正是表单把时间轴拉开的地方（design-options §B1）。"""
    doc = prepared if prepared is not None else parsed_submission_doc(template, submission)[0]
    md = doc.text
    filename = submission_filename(template, submission)
    source_key = doc.name
    chunks = HeuristicExtractor()._materials(doc).materials
    if not chunks:
        # 命门②：结构上到不了这里（记录ID 行恒 ≥ 12 字符）。真到了宁可拒绝 append，也不落一份
        # status='empty' 的文档让前端说「传了读不到」。
        raise ValueError(
            "form submission rendered to zero material chunks — refusing to append a document "
            "the manifest would have to call unreadable")
    content = md.encode("utf-8")
    sd = SourceDocument(
        filename=filename, source_key=source_key, mime="text/markdown",
        size_bytes=len(content), doc_kind=doc.doc_kind, status="ingested",
        uploaded_at=submission.submitted_at or _now_iso(), content=content)
    return sd, chunks


def append_submission_to_context(reg, template: FormTemplate,
                                 submission: FormSubmission) -> tuple[SourceDocument, bool]:
    """把一份**已提交**的表单 append 进它公司的 context：`get(ctx) → 原地 mutate → put(ctx)`，
    形状照抄手编 CRUD（ProjectWriteMixin）与 `POST /team/{id}/notes` 的先例。

    返回 (source_document, appended)。appended=False 表示这份提交早已在资料库里（幂等：
    按 source_key 判，提交 id 铸在 key 里）——重复触发绝不落第二份。

    抛：KeyError（context 不存在，端点转同体 404）、ValueError（未提交 / 零 chunk / 红线，
    端点转 422）。失败序设计成「先造后挂」：build 在任何 mutate 之前完成，能 raise 的红线判
    也在 put 之前 —— 内存 registry 的 get() 返回的是活引用，改到一半再失败等于坏状态已落库。
    """
    if submission.answers is None:
        raise ValueError("this submission has no answers yet — nothing to append")
    ctx = reg.get(submission.context_id)
    if ctx is None:
        raise KeyError(submission.context_id)

    doc, answer_lines = parsed_submission_doc(template, submission)
    sd, chunks = build_submission_document(template, submission, prepared=doc)
    for existing in ctx.source_documents:
        if (existing.source_key or existing.filename) == sd.source_key:
            return existing, False   # 这份提交已经进过资料库 —— 幂等，不 append 第二份

    ctx.source_documents.append(sd)
    ctx.extraction.materials.extend(chunks)

    # T5 · form-reflow-a2 —— 同一份文档再走一层解析：自述行 → 人卡自述槽，情境自由文本 → 带出处的
    # 情境信号，绑了项目的再追加项目卡阻塞原句。放在这里而不是别处有三个理由（form_reflow 文件头
    # 讲了细节）：幂等早返之后、`validate_extraction` 之前、`materialize_memory` 之前。
    # 回流失败**绝不**吃掉这份资料：文档已经在 `ctx` 上了，卡面产物是它之上的一层增益。
    from .form_reflow import reflow_submission
    try:
        reflowed = reflow_submission(ctx, template, submission, doc, answer_lines)
        log.info("form %s reflowed: %s", submission.id, reflowed)
    except Exception as e:
        log.exception("T5: reflowing submission %s onto the cards failed (%s) — the document is "
                      "still filed; the cards simply do not gain this week's reading",
                      submission.id, type(e).__name__)

    if sd.source_key not in ctx.source_files:
        # briefing 的 "Ingested N of M" 口径：source_files 数「parse 成功的」，本文档 chunk 非零
        # 即 parsed —— 不加这行，头条会永远少报一份。
        ctx.source_files.append(sd.source_key)

    # 与 pipeline 同一道门、同一个开关口径（材料本身刻意不扫 —— ADR-0023 只存不听；这里防的是
    # 「context 里既有的违规被本次写意外放行」，与 pg put() 内的存储门 belt-and-suspenders）。
    rl = validate_extraction(ctx.extraction)
    if not rl.ok and not person_scoring_allowed():
        raise ValueError(
            f"red line: refusing to append into a scoring extraction ({rl.summary()})")

    # recall 面跟上：KeywordStore 真加块；PgVectorStore.add 是 no-op（put 落库后查询自然可见）；
    # in-memory VectorStore 只嵌新增这几行。嵌入失败降级不阻塞 —— 资料必须落地。
    try:
        ctx.store.add(chunks)
    except Exception as e:
        log.warning("adding %d form chunks to the retrieval store failed (%s: %s) — the document "
                    "still lands; retrieval quality degrades until the next full ingest",
                    len(chunks), type(e).__name__, str(e)[:200])

    # put() 只在 facts.md **不存在**时才重物化（pg_registry.put:310-314）——get() 回来的 context
    # 文件必然存在，所以这里必须自己重写，否则议事室的 recall 面（facts.md）看不到表单内容。
    materialize_memory(ctx.extraction, ctx.memory_dir)
    reg.put(ctx)
    return sd, True
