# -*- coding: utf-8 -*-
"""T1 · form-backend-a1a —— 常驻表单的领域对象 + 写侧的门（gap-design-0805 §A1）。

一张**常驻表单**是公司长期挂着的一张模板（第一张是「周报」），经理按周给某一个人铸一条
`/f/<token>` 链接，员工手机打开填完提交。本模块持有：

  * 两个双胞胎 registry 都要往返的数据类（`FormField` / `FormTemplate` / `FormSubmission`）；
  * **字段描述**这个概念本身 —— `FormField.kind ∈ {text, choice, number}`。渲染层（service/
    form_api.py）是 `kind → 渲染函数` 的一张表，不是 if/else 硬拼。这是后续票（A2 回流人卡、
    A3 周期实例）不用重写渲染层的唯一前提；
  * 🔴 写侧红线门 `gate_form_red_line` —— **题面**过门，**答案**不过门。两档判据原样复用
    feat-033/034 的机器（`avery.redline.validate` + `avery.scoring_policy`，不新造机制）。

🔴 头号纪律（0805 拍板 #5，每一票都要守）：**表单只是与上传文件平权的又一路数据源。**
一次提交最终会变成一份带 `uploaded_at` 的 `SourceDocument`，走与上传文件完全相同的
chunk/出处/引用契约（T2 · `form_append.py`，提交时触发）。本模块因此**只**描述「表单这个
采集器」——模板长什么样、链接发给了谁、谁交了。它不是资料的第二条存储通道，也不许为表单
发明任何特殊旁路。

为什么不复用 `avery.asks`（快问）：见 `db/migrations/0013_form_templates.sql` 文件头（四处被红线门
钉死的形状 + 迁移 increment-only 纪律）。

答案为什么不过红线（与 ask 回执同一姿态，ADR-0023）：那是员工**本人的话**。结构保证在落点——
答案挂 (template, submission)，永远不挂 `avery.entities`，所以 0009 的人员键 allowlist CHECK 依旧
保证没有数字能落到人身行上。表单文本一律按**未受信内容**对待（0004 文件头的注入边界）：只存不听。
"""
from __future__ import annotations

import re
import uuid
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone

# ── 服务端拥有的词表与上限（前端/H5 只照做，服务端才是定义方）────────────────────────────────
FIELD_KINDS = ("text", "choice", "number")

MAX_FIELDS = 12                 # 一张常驻表单不是问卷系统
MAX_CHOICES = 8
MAX_TITLE_CHARS = 120
MAX_LABEL_CHARS = 120
MAX_HELP_CHARS = 400
MAX_CHOICE_CHARS = 40
MAX_TEXT_ANSWER_CHARS = 2000    # 员工自由文本，宽松但有界
MAX_RECIPIENTS_PER_MINT = 30    # 一次铸链不是群发
NUMBER_MIN_FLOOR, NUMBER_MAX_CEIL = 0, 100

EXPIRY_DAYS = 7                 # 拍板 #4：单人单链 + 7 天过期


@dataclass
class FormField:
    """一格。`kind` 决定它怎么渲染、怎么校验——渲染层与校验层都按 kind 查表，不认字段名。"""
    id: str                              # ASCII 稳定键（答案按它落，改 label 不动答案）
    kind: str                            # 'text' | 'choice' | 'number'
    label: str                           # 员工看到的题面（过红线门）
    help: str = ""                       # 题面下的一行说明（过红线门）
    required: bool = True
    choices: list[str] = field(default_factory=list)   # 仅 choice：单选按钮组的选项（过红线门）
    min: int = NUMBER_MIN_FLOOR                        # 仅 number
    max: int = NUMBER_MAX_CEIL                         # 仅 number
    # 差距战役 T5/A2 —— 这一格的答案是一句**情境陈述**（哪儿卡住了 / 缺什么），回流时：
    #   * 成为人卡上一条带出处的情境信号（`SignalEntity`，summary 停在情境，绝不是对人的判断）；
    #   * 表单若绑定了项目（`FormSubmission.project_ref`），同一句话追加成项目卡的阻塞原句。
    # 默认 False，而且**必须**默认 False：「已完成事实」是成绩、「下一周期目标」是计划，把它们
    # 当成情境信号，等于每人每周往卡上糊四条噪音，真正卡住的那一条反而看不见了。
    # 为什么是字段描述上的一个开关、而不是在回流代码里按 field.id 写死 `{'missed','support'}`：
    # 模板是可编辑的（`POST /team/{ctx}/forms`），按 id 写死意味着经理一改题面，回流就静默失灵。
    # 与 kind 同一条纪律——渲染层/校验层/回流层都读字段描述，谁都不认字段名（T1 文件头）。
    situational: bool = False


@dataclass
class FormTemplate:
    context_id: str
    id: str
    title: str
    fields: list[FormField] = field(default_factory=list)
    active: bool = True
    created_at: str = ""


@dataclass
class FormSubmission:
    """一次「发给某一个人的一份表单」。铸链即建行；answers 为 None 表示还没交。"""
    id: str
    context_id: str
    template_id: str
    person_id: str = ""
    person_name: str = ""
    period: str = ""
    # 差距战役 T5/A2 —— 这条链绑定到哪个项目（项目**名称**，即 02 表「项目名称」/`ProjectEntity.title`，
    # 因为 `_project_key(title)` 才是归并认项目的那把尺）。经理铸链时选，**员工改不了**：填的人不该
    # 能决定自己那句话挂到哪张项目卡上。空 = 这条链不绑项目 → 回流只走人卡，一个字都不往项目卡写。
    project_ref: str = ""
    share_token: str = ""
    answers: list | None = None          # [{field_id, value}]；None = 未提交
    submitted_at: str = ""
    created_at: str = ""
    expires_at: str = ""
    # T9（gap2 #58）—— 这条链是**自动补铸**出来的时候带的幂等键（见 `auto_mint_key`）；
    # 空串 = 经理手动铸的。库上那条唯一索引只盖 auto_key 非空的行（0015 迁移文件头讲了为什么），
    # 所以手动铸链的「重复调用等于再发一轮」一个字节没变。
    auto_key: str = ""


def person_key(person_id: str, person_name: str) -> str:
    """「本期这个人有没有已经拿到链接」认的那把尺。

    有工号就认工号（01 表人员ID，`FormSubmission.person_id`）——酒店有同名有花名，按名会并错人，
    这是 T5/A2 与 0807 HITL 都用血换过的口径。没工号才退回姓名。

    姓名的归一**只折排版噪音**：剥两侧空白、把连续空白压成一个。刻意**不**把内部空格删光
    （「周 雅」和「周雅」仍是两把不同的钥匙）——两种错的代价不对等：
      * 误合并（把两个人当成一个）＝ 其中一个人这一周**静默**收不到表单，没有任何一处会报错；
      * 误拆分（把一个人当成两个）＝ 他多收到一条链接，经理在「谁没交」那一段一眼就看见。
    宁可犯后者。同理不做大小写折叠 / 全半角折叠：那些都是"看起来像同一个人"的猜测。

    🔴 两个命名空间必须**显式分开**（`id:` / `name:` 前缀）：否则一个工号恰好等于另一个人姓名的
    公司，会把两个人判成同一个人而漏铸一条链接——那是「有人这期根本没收到表单」的静默形态。
    """
    pid = (person_id or "").strip()
    if pid:
        return "id:" + pid
    return "name:" + re.sub(r"\s+", " ", (person_name or "").strip())


def auto_mint_key(template_id: str, period: str, person_id: str, person_name: str) -> str:
    """自动补铸的幂等键 —— **唯一**的生成处（库上 0015 那条唯一索引比对的就是这个值）。

    形状 `<template_id>|<period>|<person_key>`。不含 context_id：索引的前导列就是它，
    拼进值里只是把同一个事实存两遍。

    🔴 分隔符 `|` 与三段各自的取值域：template_id 是 ASCII 稳定键（`tpl_weekly` / `tpl_<hex>`），
    period 是 `YYYY-Www`，person_key 带 `id:`/`name:` 前缀——都不含 `|`，所以拼接无歧义。
    姓名理论上可以含 `|`，但那只会让这个人**自己**的键变长，不会与别人撞（前缀已经分好命名空间）。
    """
    return f"{template_id}|{period}|{person_key(person_id, person_name)}"


# ── id / 时间 ────────────────────────────────────────────────────────────────────────────────

def new_template_id() -> str:
    return "tpl_" + uuid.uuid4().hex[:12]


def new_submission_id() -> str:
    return "sub_" + uuid.uuid4().hex[:16]


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def default_expiry(created_at_iso: str) -> str:
    """created_at + 7 天（拍板 #4），同一 ISO8601 UTC 形状。"""
    dt = datetime.fromisoformat(created_at_iso)
    return (dt + timedelta(days=EXPIRY_DAYS)).isoformat()


def current_period(today: date | None = None) -> str:
    """默认述职周期 = ISO 周（`2026-W32`），与 06 表「述职周期 *」列的示例同形。"""
    d = today or datetime.now(timezone.utc).date()
    year, week, _weekday = d.isocalendar()
    return f"{year}-W{week:02d}"


def effective_submission_status(sub: FormSubmission, now: datetime | None = None) -> str:
    """服务端此刻为这条链接背书的状态：`submitted`（已交，锁定）/ `expired`（过期）/ `open`。

    已提交是终态——过了期也仍然是 submitted（证据已经在了，不能因为时间到了就改口说链接失效）。"""
    if sub.submitted_at:
        return "submitted"
    if sub.expires_at:
        try:
            exp = datetime.fromisoformat(sub.expires_at)
            if exp.tzinfo is None:
                exp = exp.replace(tzinfo=timezone.utc)
            if (now or datetime.now(timezone.utc)) > exp:
                return "expired"
        except ValueError:
            pass   # 无法解析的过期时间从不阻塞读取，这条链接就是不过期
    return "open"


# ── 🔴 写侧的门（两个 registry 双胞胎都调的那道存储门）──────────────────────────────────────

def gate_form_red_line(template: FormTemplate) -> None:
    """在任何 INSERT 之前拒掉一张「给人打分」的模板 —— 与 `gate_ask_red_line`（feat-034）/
    `gate_note_red_line`（feat-033）完全同一个两档判据，复用同一台**未改动**的检测器：

      档 1：讲**工作**的题面过 `avery.redline.validate`（EN+ZH）—— 恒放行；
      档 2：给**人**打分的题面 validate 不过 → 拒，除非运营方显式开了 `AVERY_ALLOW_PERSON_SCORING`
            （`avery.scoring_policy`，公司开关口径，不是红线争议）。

    每一段外发文本**分别**校验（feat-033 的对抗性收口：否定词不许跨字段渗透）。
    NUL/0x00 检查**恒跑**，与开关无关——那是存储安全，不是红线政策。

    ⚠ 只门**题面**（title / label / help / choices —— 我们或经理写的、要送到员工眼前的字）。
    员工填进来的**答案**刻意不过这道门（ADR-0023：那是他本人的声音），保证在落点而不在词表。"""
    from avery import redline                     # core, offline, stdlib-only
    from avery.scoring_policy import person_scoring_allowed

    outbound = [template.title]
    for f in template.fields:
        outbound += [f.label, f.help, *f.choices]

    if not person_scoring_allowed():
        for part in outbound:
            if not part:
                continue
            rl = redline.validate(part)
            if not rl.passed:
                raise ValueError(
                    f"red line: refusing to store a person-scoring form ({rl.summary()})")

    every_text = outbound + [template.id, template.context_id]
    for f in template.fields:
        every_text += [f.id, f.kind]
    if any("\x00" in (t or "") for t in every_text):
        raise ValueError(
            "unsupported control character (NUL / 0x00) in a form template — cannot be stored")


def gate_submission_storage_safety(sub: FormSubmission) -> None:
    """提交侧**只**做存储安全（NUL/0x00），刻意不做红线扫描——答案是员工本人的话。"""
    texts = [sub.id, sub.context_id, sub.template_id, sub.person_id, sub.person_name,
             sub.period, sub.project_ref, sub.share_token, sub.auto_key]
    for a in (sub.answers or []):
        if isinstance(a, dict):
            texts += [str(a.get("field_id") or ""),
                      a.get("value") if isinstance(a.get("value"), str) else ""]
    if any("\x00" in (t or "") for t in texts):
        raise ValueError(
            "unsupported control character (NUL / 0x00) in a form submission — cannot be stored")


def validate_template_shape(t: FormTemplate) -> str | None:
    """结构校验（服务端是最后一道门）。返回人话原因或 None。不是红线关切——只是「坏形状永不落库」。"""
    if not (t.title or "").strip():
        return "a form needs a title"
    if len(t.title) > MAX_TITLE_CHARS:
        return f"a form title longer than {MAX_TITLE_CHARS} characters"
    if not (1 <= len(t.fields) <= MAX_FIELDS):
        return f"a form carries 1 to {MAX_FIELDS} fields (got {len(t.fields)})"
    seen: set[str] = set()
    for f in t.fields:
        if f.kind not in FIELD_KINDS:
            return f"unknown field kind {f.kind!r} (allowed: {', '.join(FIELD_KINDS)})"
        if not (f.id or "").strip():
            return "a field with an empty id"
        if f.id in seen:
            return f"two fields share the id {f.id!r} — answers would collide"
        seen.add(f.id)
        if not (f.label or "").strip():
            return "a field with an empty label"
        if len(f.label) > MAX_LABEL_CHARS:
            return f"a field label longer than {MAX_LABEL_CHARS} characters"
        if len(f.help or "") > MAX_HELP_CHARS:
            return f"a field help line longer than {MAX_HELP_CHARS} characters"
        if f.kind == "choice":
            if not (2 <= len(f.choices) <= MAX_CHOICES):
                return (f"a choice field offers 2 to {MAX_CHOICES} options "
                        f"(field {f.id!r} has {len(f.choices)})")
            if len(set(f.choices)) != len(f.choices):
                return f"choice field {f.id!r} repeats an option"
            for c in f.choices:
                if not (c or "").strip():
                    return f"choice field {f.id!r} has an empty option"
                if len(c) > MAX_CHOICE_CHARS:
                    return f"an option longer than {MAX_CHOICE_CHARS} characters"
        elif f.choices:
            return f"field {f.id!r} is {f.kind}, not choice — it must not carry options"
        if f.kind == "number":
            if not (NUMBER_MIN_FLOOR <= f.min < f.max <= NUMBER_MAX_CEIL):
                return (f"number field {f.id!r} needs {NUMBER_MIN_FLOOR} <= min < max <= "
                        f"{NUMBER_MAX_CEIL} (got {f.min}..{f.max})")
    return None


# ── 答案校验：按 kind 查表，与渲染层同一张字段描述 ────────────────────────────────────────────

def _clean_free_text(raw: str | None) -> str:
    """员工的自由文本：有界、剥掉 C0 控制字符（存储安全），其余**逐字保留**——那是他的原话
    （ADR-0023：不过红线、不改写）。"""
    text = (raw or "")[:MAX_TEXT_ANSWER_CHARS]
    return "".join(ch for ch in text if ch in "\n\t" or ord(ch) >= 32).strip()


def parse_submitted_answers(template: FormTemplate, get) -> tuple[list[dict] | None, str | None]:
    """把一次 POST 的表单体变成 `[{field_id, value}]`，或给出拒绝原因（→ 422）。

    `get(field_id) -> str | None` 是取值函数（HTTP 层传 `form.get`）。三种 kind 各有各的判据：
      * text   —— 必填时不许空白；有界；C0 剥净；其余逐字；
      * choice —— 值必须**恰好**是这一格给出的选项之一（不是「像」某个选项）；
      * number —— `isdecimal()`（不是 `isdigit()`：`²`/`①` 会让 `isdigit()` 为真而 `int()` 炸，
                  ask 侧 F-1 对抗性发现的同一个坑）且落在 [min, max] 内。

    可选（`required=False`）且留空的格：**不产出条目**（absent ≠ 空字符串 —— 前端/T2 渲染时
    「这一格他没写」和「他写了个空」不是一回事，别在这里折成同一个）。"""
    answers: list[dict] = []
    for f in template.fields:
        raw = get(f"f_{f.id}")
        raw = "" if raw is None else str(raw)
        if f.kind == "text":
            value = _clean_free_text(raw)
            if not value:
                if f.required:
                    return None, f"field {f.id} needs an answer"
                continue
            answers.append({"field_id": f.id, "value": value})
        elif f.kind == "choice":
            picked = raw.strip()
            if not picked:
                if f.required:
                    return None, f"field {f.id} needs one option picked"
                continue
            if picked not in f.choices:
                return None, f"field {f.id} got an option that is not on the form"
            answers.append({"field_id": f.id, "value": picked})
        else:  # number
            token = raw.strip()
            if not token:
                if f.required:
                    return None, f"field {f.id} needs a number {f.min}..{f.max}"
                continue
            if not token.isdecimal() or not (f.min <= int(token) <= f.max):
                return None, f"field {f.id} needs a number {f.min}..{f.max}"
            answers.append({"field_id": f.id, "value": int(token)})
    return answers, None


def answers_by_field(sub: FormSubmission) -> dict[str, object]:
    """`[{field_id, value}]` → `{field_id: value}`（读侧便利；缺席的格不出现在字典里）。"""
    out: dict[str, object] = {}
    for a in (sub.answers or []):
        if isinstance(a, dict) and a.get("field_id"):
            out[str(a["field_id"])] = a.get("value")
    return out


# ── 内置第一张模板「周报」——字段名与我们发出去的 xlsx 逐字一致 ──────────────────────────────
# scripts/make-intake-xlsx.py 的「06 周报与述职事实」表已经在客户手里了。所以这张表单的题面不是
# 新写的文案，而是**那张表的表头原文**（`*` 是那张表里的必填记号，不是题面的一部分）。
# 06 表八列里有四列是系统填的、不该问员工，映射写在 INTAKE_06_SYSTEM_COLUMNS —— 两张表加起来必须
# 把八列**盖全**，由 tests/test_form_intake_06_contract.py 逐字对峙（任一侧改动，那道门先红）。

INTAKE_SHEET_06 = "06 周报与述职事实"

INTAKE_06_SYSTEM_COLUMNS: dict[str, str] = {
    "记录ID": "FormSubmission.id",           # 铸链时服务端生成
    "人员ID": "FormSubmission.person_id",    # 经理选人时带上（01 表的人员ID，归并按它不按姓名）
    "述职周期": "FormSubmission.period",     # 铸链时定（默认当前 ISO 周）
    "提交日期": "FormSubmission.submitted_at",  # 员工按下提交时服务端盖章
}

WEEKLY_TEMPLATE_ID = "tpl_weekly"

_ASTERISK = re.compile(r"\s*\*\s*$")


def intake_header_base(header: str) -> str:
    """剥掉 06 表表头的必填记号：`已完成事实 *` → `已完成事实`。"""
    return _ASTERISK.sub("", (header or "").strip()).strip()


def weekly_template(context_id: str, *, created_at: str = "") -> FormTemplate:
    """内置「周报」模板。前四格的 label 是 06 表表头原文（逐字），required 跟着表头的 `*` 走。

    后两格（负载/情绪）**不在** 06 表里 —— 它们是人卡上唯一合法的两个人身自述子槽
    （`extract.py:93-124`，load 0-100 + mood 枚举）。用词刻意对齐解析层认得的那套：
    「负载自述」「情绪自述」，情绪三个选项 `如常 / 偏紧 / 吃紧` 正是
    `_MOOD_SELFREPORT_MAP`（`extract.py:79-90`）三个桶各自的头一个词，所以 T5 把它们渲染进
    文档时是 1:1 映射，不用再造一层翻译。⚠ 这两格是**本人自述**，不是对人的评分——题面里
    一个字都不许出现打分/排名（`gate_form_red_line` 是这句话的执法者）。

    T5/A2 —— 四个自由文本格里只有「未达成及原因」「需要支持」标了 `situational=True`：那两格问的
    就是「哪儿卡住了 / 缺什么」，回流成人卡上的情境信号与项目卡的阻塞原句刚好是同一件事。
    「已完成事实」是成绩、「下一周期目标」是计划，都不是需要经理今天去看一眼的情境——它们照旧
    逐字进资料库、议事室照旧引得到，只是不长成卡上的一条信号。"""
    return FormTemplate(
        context_id=context_id,
        id=WEEKLY_TEMPLATE_ID,
        title="周报",
        created_at=created_at or now_iso(),
        fields=[
            FormField(
                id="done", kind="text", label="已完成事实", required=True,
                help="具体做完的事，尽量带上数字和日期。写「完成了 3 场直播，累计观看 1.2 万」"
                     "比写「直播工作顺利推进」有用得多。"),
            FormField(
                id="missed", kind="text", label="未达成及原因", required=True,
                situational=True,
                help="哪些没做完、为什么。写客观情况，不用自我检讨——是资源不够、被别的事挤了，"
                     "还是外部原因没到位。"),
            FormField(
                id="next_goal", kind="text", label="下一周期目标", required=True,
                help="下个周期你要做完什么。"),
            FormField(
                id="support", kind="text", label="需要支持", required=False,
                situational=True,
                help="需要谁配合、需要什么资源。这一栏经常被留空，但它最能帮到你——写下来，"
                     "经理才知道该在哪儿使劲。"),
            FormField(
                id="load", kind="number", label="负载自述", required=True, min=0, max=100,
                help="这一周你自己感觉的忙碌程度：0 是很闲，100 是快扛不住了。"
                     "这是你本人的说法，会标明是你自述的。"),
            FormField(
                id="mood", kind="choice", label="情绪自述", required=True,
                choices=["如常", "偏紧", "吃紧"],
                help="这一周的状态，挑一个最接近的。"),
        ],
    )


BUILTIN_TEMPLATE_BUILDERS = (weekly_template,)


def ensure_builtin_templates(reg, context_id: str) -> list[FormTemplate]:
    """把内置模板按需铸进这家公司的表单库，返回该公司**全部**模板（内置的排在前）。

    为什么按需铸而不是迁移里 INSERT：迁移跑在建表那一刻，那时一家公司都还没有；而 demo 克隆
    （`clone_context`）刻意不复制表单表，克隆体也得拿得到内置模板。为什么铸成真行而不是每次
    从代码里现算：一次提交的答案是按 `field.id` 落的，**模板必须被快照住**——否则哪天代码里
    改了字段，去年的提交会跟着变意思。已存在则原样不动（经理改过的题面不会被内置版覆盖）。"""
    existing = {t.id: t for t in reg.list_form_templates(context_id)}
    minted: list[FormTemplate] = []
    for build in BUILTIN_TEMPLATE_BUILDERS:
        tpl = build(context_id)
        if tpl.id in existing:
            minted.append(existing.pop(tpl.id))
            continue
        minted.append(reg.put_form_template(tpl))
    return minted + list(existing.values())
