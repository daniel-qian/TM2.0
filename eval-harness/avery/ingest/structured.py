# -*- coding: utf-8 -*-
"""表格行 → 实体，**确定性映射，零抽取** —— onboarding-accounts-0805 ①（ADR-0034 拍板 1/2/3）。

`/ingest` 只有一条漏斗：文件 → parse → LLM/启发式抽取 → 实体。它约 100–120 秒且**有损**
（模型读一张表格，能读错列、能漏人）。而 7 张标准表本来就是结构化的：列名是我们自己印在
xlsx 上的，值是用户照着下拉选的。让模型再猜一遍是纯亏。本模块是那条捷径：

    表格行（列名 → 值） ──▶ 确定性映射 ──▶ ExtractionResult ──▶ （红线门）──▶ 同一个 CompanyContext

秒级、零损、可解释——每个字段能指回是哪张表哪一行哪一列来的。

## 三条不许动的边界

1. **不新建实体类型**（拍板 1，supersede 了 ADR-0030 的那一条否决点，其余不动）。
   `avery.entities` 的 kind CHECK 和 `0009_person_keys_allowlist` 的人身键 allowlist 一个字
   都没碰。01 表长人卡、02 表长项目卡、04/05 充实项目卡、03/06/07 进材料库——**与我们今天
   发出去的那份 xlsx 说明页（make-intake-xlsx.py 的 INTAKE）逐行相同**。表格入口不许比文件
   入口多长出任何东西。

2. **列名的唯一真源是 `intake_schema.json`**（由 `scripts/gen-intake-schema.py` 从
   make-intake-xlsx.py 的 FORMS 编译而来）。本模块只写「哪一列去哪个字段」这一层语义，
   绝不复述列名字符串——复述就是第二份会漂的表定义。映射表里出现的每个列键都被
   `tests/test_structured_intake_contract.py` 钉在真源上，写错一个字就红。

3. **红线与 /ingest 完全一致**（拍板 2）。01 表长出的 PersonEntity 走的就是 /ingest 那道
   `validate_extraction`，一个字节都没换。07 表另有一道（见 `scan_review_rows` 的注释）：
   它的行进的是材料库、不是人卡，而 `validate_extraction` 只扫人和人身信号，所以那张
   「整发拒」的承诺得由本模块显式兑现——用的仍是 redline_extract 的**同两把尺**，不是新词表。

## 一次提交 = 一个 context（拍板 3）

表格行与附带文件**合一发**：文件仍走 parse/extract，表格行走本模块，两份 ExtractionResult
在红线门之前合并，注册成同一个 CompanyContext。刻意**不做跨源去重**——票 #40 的验收判据就是
「人数 = 行人数 + 文件抽取人数」。理由是诚实：同一个人同时出现在名册表和某份简历里，机器无法
判断那是同一个人还是同名两人（`_person_key` 只认名字，中文重名远比英文常见），把两张卡合成
一张是在替用户下一个它不该下的判断。两张卡至少各自带着自己的出处。
"""
from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass, field
from pathlib import Path

from .extract import (
    ExtractionResult,
    MaterialChunk,
    PersonEntity,
    ProjectEntity,
    ProjectRisk,
    _OWNS_SPLIT_RE,
    _norm_status,
    _slug,
    norm_risk_level,
)
from .redline_extract import ExtractionViolation, scan_person_free_text

# ── 表定义（生成产物，见 scripts/gen-intake-schema.py）──────────────────────────────────────
# 与包同目录，随镜像走；漂移门在 tests/test_structured_intake_contract.py。
_SCHEMA_PATH = Path(__file__).with_name("intake_schema.json")


def _load_schema() -> dict:
    return json.loads(_SCHEMA_PATH.read_text(encoding="utf-8"))


INTAKE_SCHEMA: dict = _load_schema()
FORMS: list[dict] = INTAKE_SCHEMA["forms"]
FORM_IDS: tuple[str, ...] = tuple(f["id"] for f in FORMS)


def _norm_col(raw: object) -> str:
    """来客的列键 → 规范键。剥必填星号与首尾空白，ASCII 折小写。

    与 `gen-intake-schema.py::column_key` 同一条规则（星号 + 空白），另加 ASCII 大小写折叠——
    「人员ID」「人员id」是同一列，而中文没有大小写，所以这一步对汉字是恒等的。
    🔴 绝不剥汉字：`_canon_header` 的兜底靠汉字查表，动汉字等于让整列失联（旧账见
    make-intake-xlsx.py 文件头「带中文括号的表头抽出 0 人」）。
    """
    return str(raw or "").replace("*", "").strip().lower()


def _form_index() -> dict[str, dict]:
    """一张表可以用三种写法点名：编号（"01"）、sheet 全名、去编号的表名。都指同一张表。"""
    idx: dict[str, dict] = {}
    for form in FORMS:
        for alias in (form["id"], form["sheet"], form["title"]):
            idx[_norm_col(alias)] = form
    return idx


FORM_BY_ALIAS: dict[str, dict] = _form_index()


def _col_index(form: dict) -> dict[str, str]:
    """该表的「来客列键 → 规范列键」映射（表头原文与规范键都收）。"""
    idx: dict[str, str] = {}
    for col in form["columns"]:
        idx[_norm_col(col["key"])] = col["key"]
        idx[_norm_col(col["header"])] = col["key"]
    return idx


COLS_BY_FORM: dict[str, dict[str, str]] = {f["id"]: _col_index(f) for f in FORMS}
KEYS_BY_FORM: dict[str, list[str]] = {
    f["id"]: [c["key"] for c in f["columns"]] for f in FORMS
}


def max_rows_per_table() -> int:
    """每张表的行数上限（默认 500）。读 env，与 guards.py 同一条纪律：限额是部署期配置，
    别把源码默认值当生产真值（AGENTS.md 的 7/20 旧账）。"""
    try:
        return int(str(os.environ.get("AVERY_MAX_INTAKE_ROWS", "")).strip() or 500)
    except ValueError:
        return 500


# ── 结果容器 ────────────────────────────────────────────────────────────────────────────────
@dataclass
class IntakeCell:
    """一个可以指回界面的坐标：哪张表、第几行（1 起，数据行）、哪一列。

    前端 422 要把违规映射回具体的格（票 #41），而 `ExtractionViolation` 只有 person/detail——
    它是 /ingest 的形状，不能为了这个改。所以坐标走**并列的加法字段**，`violations` 数组本身
    与 /ingest 逐键相同（absent≠none 的房规）。
    """
    table: str
    row: int
    column: str
    detail: str = ""
    kind: str = ""
    rule_id: str = ""

    def as_dict(self) -> dict:
        return {"table": self.table, "row": self.row, "column": self.column,
                "detail": self.detail, "kind": self.kind, "rule_id": self.rule_id}


@dataclass
class StructuredIntake:
    """本模块的全部产出。`ok` 为假时 `violations` 非空，调用方整发 422（拍板 2）。"""
    result: ExtractionResult = field(default_factory=ExtractionResult)
    violations: list[ExtractionViolation] = field(default_factory=list)
    cells: list[IntakeCell] = field(default_factory=list)
    warnings: list[IntakeCell] = field(default_factory=list)
    row_count: int = 0

    @property
    def ok(self) -> bool:
        return not self.violations


class IntakeError(ValueError):
    """表结构本身不合法（未知表名、行数超限、行不是对象）——这不是红线，是请求格式错误。"""


# ── 行取值 ──────────────────────────────────────────────────────────────────────────────────
def _cell(row: dict[str, str], cols: dict[str, str], key: str) -> str:
    """按规范列键取值。行里的键先过 `_norm_col`，所以表头原文/去星/大小写都认。"""
    for raw, value in row.items():
        if cols.get(_norm_col(raw)) == key:
            return str(value if value is not None else "").strip()
    return ""


def _row_text(form: dict, row: dict[str, str], cols: dict[str, str]) -> str:
    """一行压平成一条材料文本：**按表定义的列序**取值、`' | '` 拼接。

    与 `parse.py::_parse_xlsx` 的 xlsx 口径同形（那边也是一行一条、单元格 `' | '` 分隔），
    所以表格入口与文件入口喂给 RAG 的材料长得一样——检索行为不因入口而变。
    按列序而不是按来客字典的键序取值：JSON 对象的键序不可靠，而列序是契约的一部分。
    """
    return " | ".join(_cell(row, cols, key) for key in KEYS_BY_FORM[form["id"]]).strip()


def _source(form_id: str, row_no: int | None = None) -> str:
    """出处串。每个实体、每条材料都必须有一个（票 #40 硬约束）。

    行号是**数据行**的 1 起序号（界面网格上显示的那个号），不是 xlsx 的物理行号——用户在 app
    里填表时看到的就是它，422 要指回哪一行，指的也得是他屏幕上那个号。
    """
    return f"表单录入:{form_id}" + (f":行{row_no}" if row_no else "")


# ── 01 组织与人员名册 → PersonEntity ────────────────────────────────────────────────────────
def _people(rows: list[dict], out: StructuredIntake) -> dict[str, PersonEntity]:
    """人员ID → 人卡。姓名为空的行**不长人卡**，只留材料。

    「姓名为空只进材料库」不是本模块的发明，是我们印在 xlsx 说明页上答应客户的话：
    「若贵司选择不提供该列，删掉整列即可，其余各表靠工号照常关联」。
    直属上级ID / 任职状态 / 入职日期三列**没有实体归宿**（人身键 allowlist 不许新键），
    所以它们只活在本行的材料文本里——这是票面如实写下的取舍，不是遗漏。
    """
    form = FORM_BY_ALIAS["01"]
    cols = COLS_BY_FORM["01"]
    by_id: dict[str, PersonEntity] = {}
    for i, row in enumerate(rows, start=1):
        name = _cell(row, cols, "姓名")
        if not name:
            continue
        emp_id = _cell(row, cols, "人员ID")
        owns_raw = _cell(row, cols, "主要负责")
        owns = [o.strip() for o in _OWNS_SPLIT_RE.split(owns_raw) if o.strip()]
        person = PersonEntity(
            # 工号是客户自己的稳定标识，02/04/05/06/07 全靠它互指——有就直接当 id 用，
            # 跨表引用才连得起来。没填就退回抽取器那条老路（名字 slug），此时跨表引用
            # 对不上会在下面记 warning，不硬拒。
            id=emp_id or _slug(name, "u"),
            name=name,
            role=_cell(row, cols, "岗位"),
            team=_cell(row, cols, "部门"),
            tenure=_cell(row, cols, "司龄"),
            owns=owns,
            source=_source("01", i),
        )
        if person.id in by_id:
            out.warnings.append(IntakeCell(
                table="01", row=i, column="人员ID", kind="duplicate-id",
                detail=f"人员ID「{person.id}」在本表里重复了，后一行不再单独长人卡"))
            continue
        by_id[person.id] = person
        out.result.people.append(person)
    _materials(form, rows, out)
    return by_id


# ── 02 项目台账 → ProjectEntity ─────────────────────────────────────────────────────────────
_PROGRESS_RE = re.compile(r"^\s*(\d{1,3})(?:\.0+)?\s*%?\s*$")


def _projects(rows: list[dict], people: dict[str, PersonEntity],
              out: StructuredIntake) -> dict[str, ProjectEntity]:
    form = FORM_BY_ALIAS["02"]
    cols = COLS_BY_FORM["02"]
    by_id: dict[str, ProjectEntity] = {}
    for i, row in enumerate(rows, start=1):
        title = _cell(row, cols, "项目名称")
        if not title:
            continue
        pid = _cell(row, cols, "项目ID") or _slug(title, "p")
        owner_id = _cell(row, cols, "负责人ID")
        owner = people.get(owner_id)
        if owner_id and owner is None:
            # 悬空的负责人ID **不硬拒**（票 #40 明写）：用户很可能先填 02 再回头补 01，
            # 或者这一批只交了项目表。ownerName 留空 = 卡上如实缺席，不编一个名字出来。
            out.warnings.append(IntakeCell(
                table="02", row=i, column="负责人ID", kind="dangling-ref",
                detail=f"负责人ID「{owner_id}」在 01 表里找不到，项目卡的负责人会留空"))
        progress: int | None = None
        raw_progress = _cell(row, cols, "完成进度")
        if raw_progress:
            m = _PROGRESS_RE.match(raw_progress)
            if m and 0 <= int(m.group(1)) <= 100:
                progress = int(m.group(1))
            else:
                out.warnings.append(IntakeCell(
                    table="02", row=i, column="完成进度", kind="unreadable-value",
                    detail=f"「{raw_progress}」不是 0–100 的整数，进度会留空（不猜）"))
        project = ProjectEntity(
            id=pid,
            title=title,
            ownerId=owner_id if owner else "",
            ownerName=owner.name if owner else "",
            # 中文状态词表复用抽取器的 `_norm_status`——一个词在两个入口必须读出同一个状态。
            # 「未开始」故意归空（计划态不是健康度），卡片显示「状态未知」，这是模板明写的
            # 故意行为，不是没读到（见 test_partner_intake_form_contract.py 门 1）。
            status=_norm_status(_cell(row, cols, "当前状态")),
            progress=progress,
            dueDate=_cell(row, cols, "计划完成日期"),
            summary=_cell(row, cols, "项目目标"),
            source=_source("02", i),
        )
        if project.id in by_id:
            out.warnings.append(IntakeCell(
                table="02", row=i, column="项目ID", kind="duplicate-id",
                detail=f"项目ID「{project.id}」在本表里重复了，后一行不再单独长项目卡"))
            continue
        by_id[project.id] = project
        out.result.projects.append(project)
    _materials(form, rows, out)
    return by_id


# ── 04 项目进度更新 → 充实项目卡的阻塞项 ─────────────────────────────────────────────────────
def _progress_updates(rows: list[dict], projects: dict[str, ProjectEntity],
                      out: StructuredIntake) -> None:
    """「当前阻塞」append 进对应项目的 blockers；其余列只进材料。

    xlsx 说明页答应的就是这一句：「『当前阻塞』进项目卡的阻塞项；其余进材料库」。
    """
    form = FORM_BY_ALIAS["04"]
    cols = COLS_BY_FORM["04"]
    for i, row in enumerate(rows, start=1):
        pid = _cell(row, cols, "项目ID")
        blocker = _cell(row, cols, "当前阻塞")
        if not blocker:
            continue
        project = projects.get(pid)
        if project is None:
            out.warnings.append(IntakeCell(
                table="04", row=i, column="项目ID", kind="dangling-ref",
                detail=f"项目ID「{pid}」在 02 表里找不到，这条阻塞只会进材料库"))
            continue
        if blocker not in project.blockers:
            project.blockers.append(blocker)
    _materials(form, rows, out)


# ── 05 风险与事项 → 充实项目卡的风险/阻塞 ────────────────────────────────────────────────────
_RISK_ORDER = {"high": 3, "medium": 2, "low": 1, "": 0}


def _issues(rows: list[dict], projects: dict[str, ProjectEntity],
            out: StructuredIntake) -> None:
    """类型∈{风险,阻塞} 充实项目卡；冲突/待决/客户反馈只进材料。

    一个项目有多条「风险」时保留**最重的那条**（high > medium > low），其余照常在材料库里
    可检索。ProjectEntity.risk 是单值槽（`{level, reason?}`，rich-align-0722/01），把三条风险
    拼成一句话会造出一条谁也没写过的描述；取最重的那条至少是用户真写下来的原话。
    """
    cols = COLS_BY_FORM["05"]
    for i, row in enumerate(rows, start=1):
        kind = _cell(row, cols, "事项类型")
        if kind not in ("风险", "阻塞"):
            continue
        pid = _cell(row, cols, "关联项目ID")
        fact = _cell(row, cols, "事实描述")
        project = projects.get(pid)
        if project is None:
            out.warnings.append(IntakeCell(
                table="05", row=i, column="关联项目ID", kind="dangling-ref",
                detail=f"关联项目ID「{pid or '（空）'}」对不上 02 表，这条{kind}只会进材料库"))
            continue
        if kind == "阻塞":
            if fact and fact not in project.blockers:
                project.blockers.append(fact)
            continue
        level = norm_risk_level(_cell(row, cols, "优先级"))
        if not level:
            out.warnings.append(IntakeCell(
                table="05", row=i, column="优先级", kind="unreadable-value",
                detail="优先级不在 高/中/低 里，这条风险不会写进项目卡的风险等级"))
            continue
        current = project.risk
        if current is None or _RISK_ORDER[level] > _RISK_ORDER.get(current.level, 0):
            project.risk = ProjectRisk(level=level, reason=fact)
    _materials(FORM_BY_ALIAS["05"], rows, out)


# ── 03 / 06 / 07 → 只进材料库 ───────────────────────────────────────────────────────────────
def _materials(form: dict, rows: list[dict], out: StructuredIntake) -> None:
    """整表进材料库：先一条表头行，再一行一条。

    表头也发一条，是因为 `parse.py` 的 xlsx 口径里表头本来就是独立一行——不发它，材料库里就
    只剩一串没有列名的值（"UPD-001 | PRJ-01 | 2026-07-24 | …"），检索命中了也读不懂是什么。
    """
    form_id = form["id"]
    cols = COLS_BY_FORM[form_id]
    header = " | ".join(KEYS_BY_FORM[form_id])
    body_rows: list[tuple[int, str]] = []
    for i, row in enumerate(rows, start=1):
        text = _row_text(form, row, cols)
        if not text.replace("|", "").strip():
            continue    # 整行空白：用户在网格里留的空行，不是数据
        body_rows.append((i, text))
    if not body_rows:
        return
    out.result.materials.append(MaterialChunk(
        id=_source(form_id) + ":表头", text=f"{form['sheet']}：{header}",
        source=_source(form_id), doc_kind="company"))
    for i, text in body_rows:
        out.result.materials.append(MaterialChunk(
            id=_source(form_id, i), text=text, source=_source(form_id, i), doc_kind="company"))


# ── 红线（拍板 2 的那条「整发拒」）───────────────────────────────────────────────────────────
# 01 里真正长成 PersonEntity 自由文本的那几列（= `_person_text_fields` 的表格侧对应物）。
_PERSON_TEXT_COLS = ("姓名", "岗位", "部门", "司龄", "主要负责")
# 07 的自由文本列：三列都是写给一位具名同事的评议正文。
# 🔴 **从表定义里取**，不在这里手抄一份列名。前端的单元格级拦截（票 #41）读的是同一个
# `redline: "hard"` 标记——手抄的话，两侧对"哪几格算红线"的理解会静默分家，而这条线上
# 分家的症状是最糟的那种：前端标红说"会被拒绝"、后端放行，或者反过来。
def _redline_cols(form_id: str, level: str) -> tuple[str, ...]:
    form = FORM_BY_ALIAS[form_id]
    return tuple(c["key"] for c in form["columns"] if c.get("redline") == level)


_REVIEW_TEXT_COLS = _redline_cols("07", "hard")


def scan_roster_rows(rows: list[dict], out: StructuredIntake) -> None:
    """01 表的人身自由文本逐格过红线——**为了坐标，不是为了多一道门**。

    01 的行长成 PersonEntity，所以它们本来就会被 /ingest 那道 `validate_extraction` 拦下
    （管线里那一道仍然是权威门，一个字节没换）。但那道门的 `ExtractionViolation` 只带
    person/detail，指不回「第 4 行的『主要负责』那一格」——而票 #41 要求 422 能映射回具体的格。
    所以这里在同样的两把尺下**逐格**再走一遍，拿到坐标后提前整发拒。

    两者的口径差一处，如实记在这里：`validate_extraction` 的内容扫描跑在**拼起来的**人身文本
    上（`"\\n".join(_person_text_fields(p))`），逐格扫看不见跨字段才成立的句子。那种情况下
    本函数放行、管线那道仍然拦得住——只是那一发 422 没有格坐标（响应里 `cells` 缺席）。
    宁可少一个坐标，也不要为了坐标把权威门搬到这里来重写一遍。
    """
    cols = COLS_BY_FORM["01"]
    for i, row in enumerate(rows, start=1):
        name = _cell(row, cols, "姓名")
        if not name:
            continue    # 没名字的行不长人卡，也就不在人身红线的扫描面上（与 /ingest 一致）
        for column in _PERSON_TEXT_COLS:
            text = _cell(row, cols, column)
            for v in scan_person_free_text(name, text):
                out.violations.append(v)
                out.cells.append(IntakeCell(
                    table="01", row=i, column=column,
                    detail=v.detail, kind=v.kind, rule_id=v.rule_id))


def scan_review_rows(rows: list[dict], people: dict[str, PersonEntity],
                     out: StructuredIntake) -> None:
    """07 表的自由文本逐格过红线；命中即**整发作废**（拍板 2）。

    为什么这一道必须显式存在：07 的行按拍板 1 进材料库、不长人卡，而 `validate_extraction`
    只扫 PersonEntity 与人身信号——materials 从来不在它的扫描面上。也就是说，如果只跑
    /ingest 那道门，「07 表写分数 → 整发上传被拒」这句**印在我们发出去的 xlsx 说明页上的
    承诺**在新入口上会静默失效。用户照着我们的话填，我们自己的新通道放行——这是最糟的一种
    不一致：两个入口对同一条铁律给出不同答案（ADR-0034 明确否决的「行级拒绝」是同一个病）。

    用的仍是 `redline_extract` 的同两把尺（`scan_person_free_text`），不是新词表：
    一把结构（分数形状的数字），一把内容（人身评分词表，带 ADR-0016 的工作/人身不对称）。

    🔴 只扫 07。05 的「事实描述」与 06 的述职列不在硬门上，是**刻意**的：那两张表的主语常常
    是项目和工作产物，而工作是可以被量化的（ADR-0016 的不对称；「转化率 12%」是业绩不是人身
    评分）。把它们也架上人身锚点会让一整发合法上传被拒——在这道门上，误杀比漏网贵得多。
    前端对 05/06 给的是黄色提醒（「这看起来像对人的打分」），不是「会被拒绝」——话说得住。
    """
    cols = COLS_BY_FORM["07"]
    for i, row in enumerate(rows, start=1):
        subject_id = _cell(row, cols, "被评议人员ID")
        subject = people.get(subject_id)
        who = subject.name if subject else (subject_id or "（未指名的同事）")
        for column in _REVIEW_TEXT_COLS:
            text = _cell(row, cols, column)
            for v in scan_person_free_text(who, text):
                out.violations.append(v)
                out.cells.append(IntakeCell(
                    table="07", row=i, column=column,
                    detail=v.detail, kind=v.kind, rule_id=v.rule_id))


# ── 入口 ────────────────────────────────────────────────────────────────────────────────────
def normalize_tables(raw: object) -> dict[str, list[dict]]:
    """来客的 `tables` → `{表编号: [行, …]}`。结构不合法就 `IntakeError`（400 级，不是红线）。"""
    if raw is None:
        return {}
    if not isinstance(raw, dict):
        raise IntakeError("tables 必须是一个对象：{表名: [行, …]}")
    limit = max_rows_per_table()
    out: dict[str, list[dict]] = {}
    for name, rows in raw.items():
        form = FORM_BY_ALIAS.get(_norm_col(name))
        if form is None:
            raise IntakeError(f"未知的表名：{name}（可用：{', '.join(FORM_IDS)}）")
        if rows is None:
            rows = []
        if not isinstance(rows, list):
            raise IntakeError(f"表 {form['id']} 的值必须是行数组")
        if len(rows) > limit:
            raise IntakeError(f"表 {form['id']} 有 {len(rows)} 行，超过每表 {limit} 行的上限")
        clean: list[dict] = []
        for i, row in enumerate(rows, start=1):
            if not isinstance(row, dict):
                raise IntakeError(f"表 {form['id']} 第 {i} 行不是对象")
            clean.append(row)
        # 同一张表被两个别名同时点名（"01" 和 "01 组织与人员名册"）时合并，不是后者覆盖前者。
        out.setdefault(form["id"], []).extend(clean)
    return out


def build_intake(raw_tables: object) -> StructuredIntake:
    """表格行 → `StructuredIntake`。调用方拿到后：`ok` 为假整发 422，为真则把
    `result` 合进本次提交的 ExtractionResult 再走 /ingest 那条老路（红线门 + 注册）。"""
    tables = normalize_tables(raw_tables)
    out = StructuredIntake()
    out.row_count = sum(len(rows) for rows in tables.values())

    people = _people(tables.get("01", []), out)
    projects = _projects(tables.get("02", []), people, out)
    _progress_updates(tables.get("04", []), projects, out)
    _issues(tables.get("05", []), projects, out)
    for form_id in ("03", "06", "07"):
        if tables.get(form_id):
            _materials(FORM_BY_ALIAS[form_id], tables[form_id], out)
    scan_roster_rows(tables.get("01", []), out)
    scan_review_rows(tables.get("07", []), people, out)
    return out
