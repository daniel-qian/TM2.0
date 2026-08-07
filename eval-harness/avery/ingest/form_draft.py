# -*- coding: utf-8 -*-
"""gap2 T11 · form-draft —— 「Avery 读一份旧表格，起草一张表单」的那层。

用户故事：经理手上有一张用了三年的 Excel「周例会汇报表」，已经传进资料库了。他不想一格一格
重新打字，就点「让 Avery 读它起草」——Avery 把那张表的表头变成一份**提案**，进拼装器预览，
他改完确认，才走既有的 `POST /team/{id}/forms` 真落库。

🔴 命门①：**起草是提案，不是落库。** 本模块一个字都不写进 registry，只产出一个 `FormTemplate`
对象交给 HTTP 层投影出去。为什么这条这么要紧：起草的输入是**客户自己的旧表格**，而那张表很可能
带着我们不接受的东西（见命门②）。「读完直接建好了」意味着经理还没看过一眼，一张替他做了主的
表已经在库里了；而这张表是要发到员工手机上的。

🔴 命门②：**红线在起草层就落地，不许留到确认那一刻。**
`gate_form_red_line` 会把一张带评分类题面的模板整发 422（题面逐段过 `redline.validate`）。
旧表格里「本周表现评分」这种列**很常见**——如果起草层原样带过去，经理在拼装器里改了半天、
点确认，吃一个 422，而错在三步之前那份文档里。所以：逐格过门，不过的**丢掉并说清是哪一格、
为什么**（`DraftResult.dropped`），最后再拿真的 `validate_template_shape` + `gate_form_red_line`
对着提案空跑一遍——**确认那一刻不许再有惊喜**。

为什么是丢不是改写：改写等于我们替客户把「本周表现评分」重写成一句合规的话，那是替他断言。
丢掉 + 在预览里说明，经理自己决定要不要换个问法。

🔴 命门③：**降级要诚实。** 没有 key / 预算用尽 / 模型吐了一堆散文，都退回确定性的表头启发式，
并把 `origin` 如实标成 `'heading'`；一格都读不出来就是 `'none'` + 空提案，绝不假装 `'llm'`
（`ask_api.generate_questions` 的 `('llm'|'template')` 二元组是同一条纪律）。
"""
from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass, field as dc_field

from .form import (
    MAX_CHOICE_CHARS, MAX_CHOICES, MAX_FIELDS, MAX_HELP_CHARS, MAX_LABEL_CHARS, MAX_TITLE_CHARS,
    NUMBER_MAX_CEIL, NUMBER_MIN_FLOOR,
    FormField, FormTemplate, gate_form_red_line, validate_template_shape,
)

log = logging.getLogger("avery.ingest.form_draft")

# 起草只用文档最前面这些行。一张旧表格的表头在最上面；再往下是几百行数据，喂给模型既贵又没用。
HEAD_LINES = 60
HEAD_CHARS = 4000

# 表头行的分隔符：全角/半角竖线、制表符、逗号（csv/xlsx 解析出来的行长这样）。
_CELL_SPLIT = re.compile(r"[｜|\t,，]")
# 「字段名：」这种一行一格的老式表（word 里最常见）。
_LABEL_LINE = re.compile(r"^\s*[-*•·]?\s*(.{1,60}?)\s*[：:]\s*$")
# markdown 表格的分隔行 `|---|---|`，不是表头。
_RULE_ROW = re.compile(r"^[\s｜|:\-+=]+$")
# 06 表那种必填记号，起草时剥掉（它是那张表的记号，不是题面的一部分）。
_ASTERISK_TAIL = re.compile(r"\s*[*＊]\s*$")
# 「是否…」「有没有…」——旧表格里唯一一种能从表头本身**读出**控件类型的信号。
_YESNO_HEAD = re.compile(r"^\s*(是否|有没有|有无|是不是)|(是否|有无)\s*[?？]?\s*$")

DRAFT_ORIGINS = ("llm", "heading", "none")


@dataclass
class DraftResult:
    """一份提案。`template.id` 恒为空串——落不落库、落成哪个 id，是拼装器那一步的事。"""
    template: FormTemplate
    origin: str = "none"
    # 被起草层拿掉的东西：[{'label': 原文, 'reason': 人话}]。**必须**投到界面上——
    # 一个悄悄少了两列的提案，比一个明说「这两列我没带过来，因为…」的提案危险得多。
    dropped: list[dict] = dc_field(default_factory=list)


# ── 红线：与写侧同一台检测器，一段文本一问（feat-033 的对抗性收口）─────────────────────────────

def text_passes_the_red_line(text: str) -> bool:
    """一段外发文本过不过。与 `gate_form_red_line` 同一个两档判据、同一台**未改动**的检测器
    （`ask_api._question_passes_gate` 是它的孪生）。"""
    from avery import redline
    from avery.scoring_policy import person_scoring_allowed
    if person_scoring_allowed():
        return True
    return redline.validate(text or "").passed


def _field_passes(f: FormField) -> str:
    """这一格整格过不过；不过就返回一句人话原因（空串 = 过）。

    🔴 一格里任何一段不过，整格丢——不许只丢那一个选项。选项是题目语义的一半，偷偷少一个
    选项的题，问的已经不是同一个问题了。"""
    for part, what in [(f.label, "题面"), (f.help, "说明")] + [(c, "选项") for c in f.choices]:
        if part and not text_passes_the_red_line(part):
            return f"这一格的{what}读起来像在给人打分，Avery 不收（红线：不给人打分）"
    return ""


# ── 确定性起草：从表头读（无 key、无网络、无预算的那条路）─────────────────────────────────────

def _clean_label(raw: str) -> str:
    return _ASTERISK_TAIL.sub("", (raw or "").strip().strip("#").strip()).strip()


def _kind_for(label: str) -> str:
    """从表头本身能**读出来**的控件类型只有一种：「是否…」。

    其余一律 text。这不是偷懒——一列叫「本周产量」的表头，你无法从字面知道它是 0..100 的数、
    是一句话，还是一个下拉。猜错的代价是员工手机上出现一个填不进去的格子；而 text 永远填得进去，
    经理在拼装器里两下就能改成他要的控件。**宁可少断言。**"""
    return "yesno" if _YESNO_HEAD.search(label) else "text"


def draft_from_headings(lines: list[str]) -> list[FormField]:
    """确定性起草：优先认「一行多格」的表头行，认不到再认「字段名：」式的老表。

    表头行的判据是「同一行里 ≥2 个非空格子」——这正是一张表格被解析成文本之后长的样子。
    取**第一条**满足的行：旧表格的表头在最上面，再往下就是数据行了（数据行也可能 ≥2 格，
    所以只取第一条，不是取全部）。"""
    for raw in lines:
        s = (raw or "").strip()
        if not s or _RULE_ROW.match(s):
            continue
        cells = [_clean_label(c) for c in _CELL_SPLIT.split(s)]
        cells = [c for c in cells if c]
        if len(cells) >= 2:
            return _fields_from_labels(cells)
    labels = []
    for raw in lines:
        m = _LABEL_LINE.match(raw or "")
        if m:
            label = _clean_label(m.group(1))
            if label:
                labels.append(label)
    return _fields_from_labels(labels) if len(labels) >= 2 else []


def _fields_from_labels(labels: list[str]) -> list[FormField]:
    out: list[FormField] = []
    for i, label in enumerate(labels):
        out.append(FormField(id=f"q{i + 1}", kind=_kind_for(label),
                             label=label[:MAX_LABEL_CHARS], required=False))
    return out


# ── LLM 起草（真 brain 那条路；离线套靠注入替身走到）───────────────────────────────────────────

_DRAFT_SYSTEM = (
    "You turn a company's OLD paper/Excel form into a short standing form a manager sends to ONE "
    "teammate each period. The teammate fills it in on a phone.\n"
    "HARD RULES:\n"
    "- Keep the ORIGINAL wording of each question the document already asks. You are transcribing "
    "a form, not writing one. Do not invent questions the document does not ask.\n"
    "- Ask about the WORK and the person's own account of it. NEVER rate, score, rank or judge the "
    "person; drop any column that asks someone to grade a person.\n"
    f"- At most {MAX_FIELDS} questions.\n"
    "- kind is one of: 'text' (a sentence or a paragraph), 'choice' (2..8 given options), "
    "'number' (an integer in a range), 'yesno'.\n"
    "Reply with ONLY a JSON object, no prose: "
    '{"title": "...", "fields": [{"kind": "text", "label": "...", "help": "", "choices": [], '
    '"min": 0, "max": 100}]}'
)


def parse_drafted(text: str) -> tuple[str, list[FormField]]:
    """把模型吐出来的东西变成 (title, fields)。读不出来就 ('', [])，绝不抛。

    逐项白名单 + 逐项截断：模型是**不受信输入**（0004 的注入边界），一个 800 字的 label 或者一个
    没见过的 kind 都不许原样往下走。"""
    m = re.search(r"\{.*\}", text or "", re.S)
    if not m:
        return "", []
    try:
        raw = json.loads(m.group(0))
    except json.JSONDecodeError:
        return "", []
    if not isinstance(raw, dict):
        return "", []
    title = str(raw.get("title") or "").strip()[:MAX_TITLE_CHARS]
    out: list[FormField] = []
    for i, item in enumerate(raw.get("fields") or []):
        if not isinstance(item, dict):
            continue
        kind = str(item.get("kind") or "").strip()
        label = _clean_label(str(item.get("label") or ""))
        if kind not in ("text", "choice", "number", "yesno") or not label:
            continue
        choices = [str(c).strip()[:MAX_CHOICE_CHARS]
                   for c in (item.get("choices") or []) if str(c).strip()]
        # 去重保序：`validate_template_shape` 拒重复选项，让提案带着一个必被拒的形状出门
        # 就是把 422 推到经理点确认那一刻——正是命门②要消灭的那件事。
        choices = list(dict.fromkeys(choices))[:MAX_CHOICES]
        if kind == "choice" and len(choices) < 2:
            kind, choices = "text", []
        if kind != "choice":
            choices = []
        lo, hi = NUMBER_MIN_FLOOR, NUMBER_MAX_CEIL
        if kind == "number":
            lo, hi = _number_range(item)
        out.append(FormField(
            id=f"q{i + 1}", kind=kind, label=label[:MAX_LABEL_CHARS],
            help=str(item.get("help") or "").strip()[:MAX_HELP_CHARS],
            required=False, choices=choices, min=lo, max=hi))
    return title, out


def _number_range(item: dict) -> tuple[int, int]:
    """模型给的 min/max 收进服务端的地板/天花板；给不出可用的一对就退回 0..100。"""
    try:
        lo, hi = int(item.get("min", NUMBER_MIN_FLOOR)), int(item.get("max", NUMBER_MAX_CEIL))
    except (TypeError, ValueError):
        return NUMBER_MIN_FLOOR, NUMBER_MAX_CEIL
    lo = max(NUMBER_MIN_FLOOR, min(lo, NUMBER_MAX_CEIL))
    hi = max(NUMBER_MIN_FLOOR, min(hi, NUMBER_MAX_CEIL))
    return (lo, hi) if lo < hi else (NUMBER_MIN_FLOOR, NUMBER_MAX_CEIL)


def _ask_the_brain(head: str) -> tuple[str, list[FormField]]:
    """问一次真 brain。任何失败（没 key / 预算用尽 / provider 报错 / 吐了散文）都返回空，
    由调用方退回确定性那条路——**这里一个异常都不许漏出去**，起草失败不该变成 500。"""
    from service import brain_factory, llm_budget
    kind = brain_factory.resolve_brain_kind()
    if kind == "mock":
        return "", []
    try:
        brain = llm_budget.BudgetedBrain(brain_factory.make_brain(None, kind))
        resp = brain.respond(
            _DRAFT_SYSTEM,
            [{"role": "user", "content": [{"type": "text", "text": head}]}], tools=[])
        return parse_drafted(getattr(resp, "text", "") or "")
    except Exception as e:
        log.info("T11: drafting a form from a document degraded to the heading reader (%s: %s)",
                 type(e).__name__, e)
        return "", []


# ── 入口 ────────────────────────────────────────────────────────────────────────────────────────

def document_head(doc) -> str:
    """喂给模型的那一截：前 `HEAD_LINES` 行、至多 `HEAD_CHARS` 字。旧表格的表头在最上面，
    再往下是几百行数据——多喂既贵又只会让模型把数据当成题目。"""
    return "\n".join((doc.lines or [])[:HEAD_LINES])[:HEAD_CHARS]


def draft_template_from_doc(doc, context_id: str, *, title: str = "") -> DraftResult:
    """一份已在资料库里的文档 → 一份**提案**（不落库）。

    顺序是刻意的：先让真 brain 试（它读得懂「这一列是下拉、那一列是句话」），拿不到可用结果就
    退回表头启发式，两条路的产物走**同一套**收口——红线逐格过、上限逐条收、id 去重、最后拿真的
    两道写侧门空跑一遍。所以无论提案是谁起草的，「经理点确认不会吃 422」这句话都成立。
    """
    drafted_title, fields = _ask_the_brain(document_head(doc))
    origin = "llm" if fields else "none"
    if not fields:
        fields = draft_from_headings((doc.lines or [])[:HEAD_LINES])
        origin = "heading" if fields else "none"
        drafted_title = ""
    return _finish(context_id, title or drafted_title, fields, origin, doc)


def _finish(context_id: str, title: str, fields: list[FormField], origin: str,
            doc) -> DraftResult:
    dropped: list[dict] = []
    kept: list[FormField] = []
    seen: set[str] = set()
    for f in fields:
        reason = _field_passes(f)
        if reason:
            dropped.append({"label": f.label, "reason": reason})
            continue
        if len(kept) >= MAX_FIELDS:
            dropped.append({"label": f.label,
                            "reason": f"一张常驻表单最多 {MAX_FIELDS} 题，这一格没放下"})
            continue
        f.id = _unique_id(f.id, seen)
        seen.add(f.id)
        kept.append(f)

    title = (title or "").strip()[:MAX_TITLE_CHARS]
    if title and not text_passes_the_red_line(title):
        dropped.append({"label": title,
                        "reason": "这个表名读起来像在给人打分，Avery 不收（红线：不给人打分）"})
        title = ""

    result = DraftResult(
        template=FormTemplate(context_id=context_id, id="", title=title, fields=kept),
        origin=origin if kept else "none", dropped=dropped)
    _assert_the_manager_will_not_eat_a_422(result)
    return result


def _unique_id(want: str, seen: set[str]) -> str:
    base = want or "q"
    i, out = 2, base
    while out in seen:
        out, i = f"{base}_{i}", i + 1
    return out


def _assert_the_manager_will_not_eat_a_422(result: DraftResult) -> None:
    """命门②的执法者：拿**真的**两道写侧门对着提案空跑一遍。不过就把整份提案清空，
    宁可交一张白表 + 一句说明，也不交一份点下去必然报错的提案。

    ⚠ ONE RULER：这里调的是 `validate_template_shape` / `gate_form_red_line` 本身，不是抄一份
    它们的判据。抄一份的下场是哪天写侧门收紧了，起草层还在按旧尺子放行——预检说好、确认时 422，
    正是本函数存在的理由。

    标题为空是提案的**合法**状态（经理还没起名，拼装器会让他填），所以空跑时借一个永不外露的
    占位标题：这一步量的是**字段**的形状，不是标题填没填。"""
    probe = FormTemplate(context_id=result.template.context_id, id="probe",
                         title=result.template.title or "form",
                         fields=result.template.fields)
    reason = validate_template_shape(probe) if probe.fields else None
    if reason is None and probe.fields:
        try:
            gate_form_red_line(probe)
        except ValueError as e:
            reason = str(e)
    if reason is None:
        return
    log.warning("T11: a drafted form still fails the write-side doors (%s) — handing back an empty "
                "proposal instead of one that 422s on confirm", reason)
    result.dropped.append({"label": "", "reason": f"这份起草没能整体过关（{reason}），已清空"})
    result.template.fields = []
    result.origin = "none"
