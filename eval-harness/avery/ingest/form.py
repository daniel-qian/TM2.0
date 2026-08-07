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
# gap2 T11 —— `yesno` 是第四种控件，仿快问的姊妹实现（`avery.ingest.ask.QUESTION_KINDS`）：
# 线上值恒是 `yes`/`no` 两个 ASCII 词，存进 answers 的是 **bool**（`ask_api.py:608` 同一姿态），
# 员工眼前的「是 / 否」只是那一层的本地化文案。为什么不存成 choices=['是','否'] 的 choice：
# 那样一张表的「是」在中文壳和英文壳里就是两个不同的答案值，跨期对比会当成两个词。
FIELD_KINDS = ("text", "choice", "number", "yesno")

# 「1~5 分」不是新 kind —— 它就是 number 把 min/max 收窄（`validate_template_shape` 今天就放行）。
# 档数 ≤ 这个数时 H5 渲染成一排按钮（复用 `.h5-scale`，快问的 1..5 就长这样），再宽才给滑杆。
# 为什么按钮更好：滑杆**恒有值**（HTML range 没有「没选」这个态），一格 required=False 的滑杆
# 照样会交上来一个数；按钮组有真的未选态，`parse_submitted_answers` 的 absent≠none 才成立。
SCALE_MAX_STEPS = 5

# yesno 线上的两个值。**ASCII 且与页面语言无关**——员工眼前的「是 / 否」只是 `_COPY` 里那层文案，
# 提交上来的恒是这两个词，落库折成 bool（`ask_api.py:606-608` 同一姿态）。
YESNO_VALUES = ("yes", "no")

MAX_FIELDS = 12                 # 一张常驻表单不是问卷系统（**在问的**格数，停用的不算）
# 停用的格留在模板里（答案按 field.id 落，删了老答案就对不上号——form_api.py 的设计边界），
# 所以「存着几格」比「在问几格」宽。上界仍要有：一张只增不减的表迟早撑爆一行 JSONB。
MAX_STORED_FIELDS = MAX_FIELDS * 2
MAX_CHOICES = 8
MAX_TITLE_CHARS = 120
MAX_LABEL_CHARS = 120
MAX_HELP_CHARS = 400
MAX_CHOICE_CHARS = 40
MAX_TEXT_ANSWER_CHARS = 2000    # 员工自由文本，宽松但有界
MAX_RECIPIENTS_PER_MINT = 30    # 一次铸链不是群发
NUMBER_MIN_FLOOR, NUMBER_MAX_CEIL = 0, 100

EXPIRY_DAYS = 7                 # 拍板 #4：单人单链 + 7 天过期

# gap2 T11 · 自述标记 —— 人卡上那两个人身自述子槽（`extract.PersonSelfReport`）的**结构化**入口。
# `''` = 这一格的答案只进资料库那份提交文档（可检索、议事室引得到），不上任何卡。
SELF_REPORT_SLOTS = ("", "load", "mood")
# 负载读数在人卡上按**百分比**渲染（`extract.SelfReportLoad` 是 0..100），所以标了 load 的那一格
# 必须真是 0..100 的 number。允许一格 1..5 的「分」挂上 load，等于让卡上出现「自述负载 3%」。
LOAD_SELF_REPORT_RANGE = (NUMBER_MIN_FLOOR, NUMBER_MAX_CEIL)


@dataclass
class FormField:
    """一格。`kind` 决定它怎么渲染、怎么校验——渲染层与校验层都按 kind 查表，不认字段名。"""
    id: str                              # ASCII 稳定键（答案按它落，改 label 不动答案）
    kind: str                            # 'text' | 'choice' | 'number' | 'yesno'
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
    # gap2 T11 —— 这一格的答案是**本人自述**，回流成人卡上那两个自述子槽之一：
    #   'load' → `SelfReportLoad`（0..100 的数）· 'mood' → `SelfReportMood`（情绪枚举）· '' → 不上卡。
    #
    # 🔴 为什么是标记而不是认 label 文案（这一格是本票要修的隐患）：改这条腿之前，
    # 回流靠 `_selfreport_from_lines` 的正则去认渲染出来那行里带「自述」二字的 label
    # （extract.py:1419-1462）——**认文案不认结构**。于是经理把题面从「负载自述」改成
    # 「这一周有多忙」，回流就静默失灵：资料照进、卡上什么都不长，而且不报错。
    # 反过来，一个从没打算上卡的数字题只要被起名叫「产能自述」，那个数就会爬上人卡。
    # 拼装器（本票）让经理能随手改题面，那条腿必须先变成结构化的，否则第一天就断。
    # 正则老路**只**留给「上传的 06 表」那条路：客户手写的周报里没有字段描述可读，
    # 只能认文案（`_selfreport_from_lines` 一字未改）。
    self_report: str = ""
    # gap2 T11 —— 停用：这一格不再问了，但**留在模板里**。
    # 为什么不能直接删：答案是按 `field.id` 落的，删了这一格，去年那些提交的答案就对不上号
    # （form_api.py 的设计边界）。所以生命周期是「加题 / 停用」，不是「加题 / 删题」。
    # 停用的格：员工页不渲染、提交解析不要它的答案、回流不读它——但历史提交里那一格的答案
    # 照旧在资料库里逐字躺着，议事室照旧引得到。
    retired: bool = False


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
        every_text += [f.id, f.kind, f.self_report]
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


def live_fields(t: FormTemplate) -> list:
    """还在问的那几格（停用的不算）。渲染层 / 解析层 / 回流层 / 上限判据共用这一把尺——
    每一处各自写 `if not f.retired` 是四把会各自漂的尺子。"""
    return [f for f in t.fields if not f.retired]


def validate_template_shape(t: FormTemplate) -> str | None:
    """结构校验（服务端是最后一道门）。返回人话原因或 None。不是红线关切——只是「坏形状永不落库」。"""
    if not (t.title or "").strip():
        return "a form needs a title"
    if len(t.title) > MAX_TITLE_CHARS:
        return f"a form title longer than {MAX_TITLE_CHARS} characters"
    asked = live_fields(t)
    if not (1 <= len(asked) <= MAX_FIELDS):
        return (f"a form asks 1 to {MAX_FIELDS} questions "
                f"(got {len(asked)}, not counting retired ones)")
    if len(t.fields) > MAX_STORED_FIELDS:
        return (f"a form carries at most {MAX_STORED_FIELDS} fields including retired ones "
                f"(got {len(t.fields)})")
    # 一个槽只能有一格认领。两格都标 'load' 时「哪个数上卡」没有正确答案——挑一个就是掷硬币，
    # 两个都写等于后写的悄悄盖掉先写的。宁可在这里 422。
    claimed: dict[str, str] = {}
    seen: set[str] = set()
    for f in t.fields:
        if f.kind not in FIELD_KINDS:
            return f"unknown field kind {f.kind!r} (allowed: {', '.join(FIELD_KINDS)})"
        if f.self_report not in SELF_REPORT_SLOTS:
            return (f"unknown self-report slot {f.self_report!r} "
                    f"(allowed: {', '.join(repr(s) for s in SELF_REPORT_SLOTS)})")
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
        # ── gap2 T11 · 三个语义开关各自的落点判据 ───────────────────────────────────────────
        # 每一条防的都是同一件事：**开关标了、回流那一层却读不到**，界面上却像标成功了。
        # 静默失灵是这一族最贵的失败——经理以为卡会长出来，卡什么都不长，而且不报错。
        if f.situational and f.kind != "text":
            # `form_reflow.signals_from_submission` 只从 kind='text' 的格里取情境原句
            #（一句情境陈述是一段话，不是一个数、不是一个选项）。标在别的 kind 上是死开关。
            return (f"field {f.id!r} is {f.kind}, not text — only a free-text answer can be "
                    "marked as a situational statement")
        if f.self_report:
            if f.self_report in claimed:
                return (f"fields {claimed[f.self_report]!r} and {f.id!r} both claim the "
                        f"{f.self_report!r} self-report slot — a person card holds one of each")
            claimed[f.self_report] = f.id
        if f.self_report == "load":
            lo, hi = LOAD_SELF_REPORT_RANGE
            if f.kind != "number":
                return (f"field {f.id!r} is {f.kind}, not number — a load self-report is a "
                        f"number {lo}..{hi}")
            if (f.min, f.max) != (lo, hi):
                # 人卡把这个读数当**百分比**渲染。一格 1..5 的「分」挂上 load，卡上会印出
                # 「自述负载 3%」——一个谁都没说过的数。
                return (f"a load self-report reads {lo}..{hi} on the card — field {f.id!r} "
                        f"is {f.min}..{f.max}")
        if f.self_report == "mood" and f.kind != "choice":
            # 情绪是定性的（`_MOOD_SELFREPORT_MAP` 三个桶 + 词表外逐字留 other），不是数。
            return (f"field {f.id!r} is {f.kind}, not choice — a mood self-report is one of "
                    "a few words, never a number")
    return None


def gate_used_fields(stored: FormTemplate | None, incoming: FormTemplate,
                     used_ids: set[str]) -> str | None:
    """🔴 gap2 T11 —— 改一张**已经有人交过**的表时，被引用过的 `field.id` 禁改禁删。

    答案是按 `field.id` 落的、而且 `form_templates` 没有版本列（回流读的永远是**当时最新**那张
    模板，form_api.py:522/554）。所以：
      * 删掉一个被引用过的 id → 去年那份提交里的那格答案再也说不出自己在回答什么问题；
      * 把它的 kind 从 number 改成 choice → 同一个格里躺着的 `85` 会被当成一个选项文本。
    两种都不是「后果自负的编辑」，是**静默篡改历史**——所以这道门在服务端，不只在界面上。

    允许的：改 label / help / required / choices / min / max（答案不按这些落）、加新题、
    **停用**（`retired=True`，id 还在，历史答案仍对得上号）、撤下整张表（`active=False`）。

    `used_ids` 由调用方从这张模板**已提交**的答案里取（form_api.save_form）。
    `stored is None` = 这是一张新表，没有历史可篡改。
    """
    if stored is None or not used_ids:
        return None
    incoming_kind = {f.id: f.kind for f in incoming.fields}
    stored_kind = {f.id: f.kind for f in stored.fields}
    dropped = sorted(i for i in used_ids if i not in incoming_kind)
    if dropped:
        return ("someone has already answered " + ", ".join(repr(i) for i in dropped) +
                " — those questions can be retired but not deleted, or the answers already "
                "filed stop saying what they answered")
    retyped = sorted(i for i in used_ids
                     if i in stored_kind and incoming_kind[i] != stored_kind[i])
    if retyped:
        return ("someone has already answered " + ", ".join(repr(i) for i in retyped) +
                " — the answer type cannot change under a filed answer")
    return None


def answered_field_ids(submissions) -> set[str]:
    """这些提交的答案落在了哪些 `field.id` 上。`gate_used_fields` 的输入。"""
    used: set[str] = set()
    for sub in submissions or []:
        for a in (getattr(sub, "answers", None) or []):
            if isinstance(a, dict) and a.get("field_id"):
                used.add(str(a["field_id"]))
    return used


# ── 答案校验：按 kind 查表，与渲染层同一张字段描述 ────────────────────────────────────────────

def _clean_free_text(raw: str | None) -> str:
    """员工的自由文本：有界、剥掉 C0 控制字符（存储安全），其余**逐字保留**——那是他的原话
    （ADR-0023：不过红线、不改写）。"""
    text = (raw or "")[:MAX_TEXT_ANSWER_CHARS]
    return "".join(ch for ch in text if ch in "\n\t" or ord(ch) >= 32).strip()


def parse_submitted_answers(template: FormTemplate, get) -> tuple[list[dict] | None, str | None]:
    """把一次 POST 的表单体变成 `[{field_id, value}]`，或给出拒绝原因（→ 422）。

    `get(field_id) -> str | None` 是取值函数（HTTP 层传 `form.get`）。四种 kind 各有各的判据：
      * text   —— 必填时不许空白；有界；C0 剥净；其余逐字；
      * choice —— 值必须**恰好**是这一格给出的选项之一（不是「像」某个选项）；
      * number —— `isdecimal()`（不是 `isdigit()`：`²`/`①` 会让 `isdigit()` 为真而 `int()` 炸，
                  ask 侧 F-1 对抗性发现的同一个坑）且落在 [min, max] 内；
      * yesno  —— 线上只认 `yes`/`no` 两个 ASCII 词，落库存 **bool**（`ask_api.py:606-608`
                  逐字同一条）。存 bool 不存文案：同一张表在中文壳和英文壳上答的「是」，
                  跨期对比时必须是同一个值。

    可选（`required=False`）且留空的格：**不产出条目**（absent ≠ 空字符串 —— 前端/T2 渲染时
    「这一格他没写」和「他写了个空」不是一回事，别在这里折成同一个）。

    停用的格（`retired=True`）压根不问，所以也不收它的答案 —— 员工页没渲染它，POST 体里
    出现同名键只可能是有人手搓的（`live_fields` 是渲染层与这里共用的同一把尺）。"""
    answers: list[dict] = []
    for f in live_fields(template):
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
        elif f.kind == "yesno":
            picked = raw.strip()
            if not picked:
                if f.required:
                    return None, f"field {f.id} needs a yes or a no"
                continue
            if picked not in YESNO_VALUES:
                return None, f"field {f.id} needs a yes or a no"
            answers.append({"field_id": f.id, "value": picked == "yes"})
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
                self_report="load",
                help="这一周你自己感觉的忙碌程度：0 是很闲，100 是快扛不住了。"
                     "这是你本人的说法，会标明是你自述的。"),
            FormField(
                id="mood", kind="choice", label="情绪自述", required=True,
                choices=["如常", "偏紧", "吃紧"], self_report="mood",
                help="这一周的状态，挑一个最接近的。"),
        ],
    )


BUILTIN_TEMPLATE_BUILDERS = (weekly_template,)


def backfill_builtin_markers(stored: FormTemplate, fresh: FormTemplate) -> list[str]:
    """🔴 gap2 T11 · 存量回填 —— 把 `self_report` 标记补到**早就铸在库里**的内置模板上。
    就地改 `stored`，返回补了哪几格（空 = 什么都没动，调用方据此决定要不要回写）。

    为什么非做不可：`ensure_builtin_templates` 见到 `tpl_weekly` 已存在就原样复用、绝不覆盖
    （下面那个函数的注释讲了为什么——题面必须被快照住）。于是给内置模板加的新标记**只对
    从没打开过表单页的新公司生效**；生产上任何点开过一次的 context，库里的 fields 是老快照，
    标记永远是默认值，本票的新开关在那些公司上静默失灵，而且没有一道门会红。

    🔴 判据是「这一格还没被经理接管」，三条**同时**成立才补：
      1. 这一格的 id 在内置版里也有，且 kind 一样（不是同名的另一回事）；
      2. 库里那格还**没有**任何 self_report 标记（有了就是经理自己标的，不许覆盖）；
      3. label 与内置版**逐字相同**（题面一个字都没改过）。

    第 3 条是这件事能被称为「保持现状」而不是「替经理断言」的全部理由：label 没改过，说明
    改这条腿之前那格正被老正则（认 label 里的「××自述」）读着——补上标记只是把同一件事从
    认文案改成认结构，行为一字不变。改过题面的那些格，老正则**本来就已经读不到了**（那正是
    本票要修的隐患），这里不补 = 保持它们今天的行为，把要不要上卡交回给经理在拼装器里勾。
    """
    fresh_by_id = {f.id: f for f in fresh.fields}
    touched: list[str] = []
    for f in stored.fields:
        model = fresh_by_id.get(f.id)
        if model is None or not model.self_report:
            continue
        if f.self_report or f.kind != model.kind or f.label != model.label:
            continue
        f.self_report = model.self_report
        touched.append(f.id)
    return touched


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
            stored = existing.pop(tpl.id)
            # 唯一一处允许改动存量内置模板的地方，判据见 `backfill_builtin_markers`：
            # 只补「经理一个字都没碰过的那几格」的结构化标记，题面/必填/选项一律不动。
            if backfill_builtin_markers(stored, tpl):
                stored = reg.put_form_template(stored)
            minted.append(stored)
            continue
        minted.append(reg.put_form_template(tpl))
    return minted + list(existing.values())
