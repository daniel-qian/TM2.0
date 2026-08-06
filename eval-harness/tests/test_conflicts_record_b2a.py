"""差距战役 T6 · B2a 第二步 —— 归并把丢弃的读数记进 `ExtractionResult.conflicts`。

第一步（`test_dedupe_characterization_b2a.py`，独立 commit）把 `_dedupe_entities` 今天怎么合的逐字段
钉死了，其中一条专门拍下了案发现场：两份资料对同一个格子给出不同读数时，输的那个**连同它的出处一起
消失**。这个文件验的是收容所：输家不再蒸发，而是带着 value + source + doc_key 进 conflicts。

**v1 是刻意收窄的**，三条边界写在这里，免得后来人以为是漏做：
  * 字段只有三个（`_CONFLICT_FIELD_ALLOWLIST`）：部门/团队、项目状态、到期日。票面点了四个，第四个
    「人员在职状态」今天在数据模型里**没有落脚点**——见 `test_employment_status_still_has_no_home`。
  * 只报**两边都非空且完全不相等**的字符串。同义不同写（「传菜组」/「传菜」/「前厅-传菜」）不做归一化，
    是已知的假阳性来源，交给 T7 卡面上的关闭出口。
  * 数值类（人数/进度）不做。

**本票不做规则、不做前端**（T7 的活）：这里只有后端结构 + 落库，一个中文句子都不往载荷里拼（ADR-0033）。

门的三条腿，缺一条就是假绿：
  1. 离线单测（本文件大部分），语料含**真中文字节**；
  2. `asdict()` 往返 —— pg 存 asdict、回读 `FieldConflict(**payload)`，嵌套 dataclass 不强转就只在
     **持久化**那条路上炸（rich-align-0722 真炸过一次）；
  3. `@needs_db` 真库 —— 离线套用的是 in-memory registry，**整个 Postgres 持久层对它隐形**：真 CHECK
     从不被考、迁移从不真重放。新加一个 entity kind 而不跑真库 = 生产拒收，离线全绿。
"""
from __future__ import annotations

import os
import uuid
from dataclasses import asdict, fields
from pathlib import Path

import pytest

from avery.ingest import HeuristicExtractor, extract_docs, ingest_docs, parse_bytes
from avery.ingest.extract import (
    _CONFLICT_FIELD_ALLOWLIST,
    _CONFLICT_FIELD_WITHOUT_A_HOME,
    ConflictValue,
    ExtractionResult,
    FieldConflict,
    PersonEntity,
    ProjectEntity,
    _dedupe_entities,
    _slug,
    doc_key_of,
)

needs_db = pytest.mark.needs_db

ZHOU = "周雅婷"
ROSTER_TEAM = "市场推广部"
WEEKLY_TEAM = "前厅部"
ROSTER_DOC, WEEKLY_DOC = "员工花名册.md", "本周周报.md"


def _person(name: str = ZHOU, **kw) -> PersonEntity:
    kw.setdefault("id", f"u_{name}")
    return PersonEntity(name=name, **kw)


def _project(title: str = "别墅套餐推广", **kw) -> ProjectEntity:
    kw.setdefault("id", f"p_{title}")
    return ProjectEntity(title=title, **kw)


def _dedupe(*, people=(), projects=()) -> ExtractionResult:
    res = ExtractionResult(people=list(people), projects=list(projects))
    _dedupe_entities(res)
    return res


def _only(res: ExtractionResult) -> FieldConflict:
    assert len(res.conflicts) == 1, f"期望恰好一条冲突，得到 {res.conflicts}"
    return res.conflicts[0]


# === 1 · 字段表自身的完整性 ====================================================================
# 一个指向不存在字段的表项是**静默 no-op**：永远零命中，报告里却读作"这个字段覆盖了"。所以字段表
# 本身要被断言，而不是被信任。

def test_every_declared_conflict_field_is_a_real_attribute():
    """`_CONFLICT_FIELD_ALLOWLIST` 里的每个名字都必须是对应 dataclass 上真实存在的字段。

    拼错一个字母（'dueDate' 写成 'duedate'）不会报错，只会让那个字段**永远不产生冲突**——正是
    "判据够不着"型假绿。这条门让拼写错误当场变红。
    """
    by_kind = {"person": PersonEntity, "project": ProjectEntity}
    assert set(_CONFLICT_FIELD_ALLOWLIST) == set(by_kind), "字段表的 kind 与实体类对不上"
    for kind, names in _CONFLICT_FIELD_ALLOWLIST.items():
        real = {f.name for f in fields(by_kind[kind])}
        missing = [n for n in names if n not in real]
        assert not missing, f"{kind} 的冲突字段 {missing} 在 {by_kind[kind].__name__} 上不存在"
        assert names, f"{kind} 的冲突字段表是空的"


def test_declared_conflict_fields_are_all_plain_strings():
    """三个字段都必须是 `str` 类型的格子。

    判据用的是 `if not value`（空串=缺席）。哪天有人把一个 `int | None` 的字段加进这张表，`not 0`
    为真会把合法的 0 当成"没读到"——第一步钉的
    test_project_progress_uses_is_None_so_ZERO_is_a_real_reading 讲的就是这件事。这条门挡住它。
    """
    by_kind = {"person": PersonEntity, "project": ProjectEntity}
    for kind, names in _CONFLICT_FIELD_ALLOWLIST.items():
        types = {f.name: f.type for f in fields(by_kind[kind])}
        for n in names:
            assert "str" in str(types[n]) and "int" not in str(types[n]), (
                f"{kind}.{n} 的类型是 {types[n]!r} —— 非纯字符串字段不能用 `if not value` 当缺席判据"
            )


def test_employment_status_still_has_no_home():
    """票面 v1 的第四个字段「人员在职状态」**至今没有落脚点**，这条门就是那句话的可执行版本。

    合伙人《标准管理信息填写表单》01 表确实有「任职状态」一列（在职/试用期/待离职），但它从表格走到
    人卡的那条路还没修：`PersonEntity` 没有这个格子，`_ZH_HEADER_MAP` 不认这个表头，位置兜底只读到
    cells[3]（司龄）为止。与其在字段表里放一个指向空气的条目（静默 no-op，报告里读作"覆盖了"），
    不如让不可达**明写成不可达**。

    🔴 哪天 T1/T5 给 PersonEntity 加上任职状态，这条门会变红——那个红的意思是：
    「回 extract.py 的 `_CONFLICT_FIELD_ALLOWLIST`，把 'person' 那一行补上，然后来改这条门。」
    """
    assert _CONFLICT_FIELD_WITHOUT_A_HOME == "人员在职状态"
    # ⚠ 这条只是**提醒**，不是拦网 —— 别把它当成"新字段一定跑不掉"的保证。
    #
    # 真正 name-agnostic 的那道网在别处、而且已经存在：
    # `test_registry_contract.py::test_person_keys_allowlist_covers_exactly_person_fields`
    # 拿 `dataclasses.fields(PersonEntity)` 与迁移 0009 的 allowlist 做**对称差**，所以 PersonEntity
    # 无论新增什么名字的字段（status / duty / hireState / 随便什么）都会当场红，逼加字段的人回去动
    # 迁移。第四个字段**不可能**悄悄有家。
    #
    # 也正因为有那道网，这里刻意**不再抄一份 PersonEntity 的字段清单**当快照：那会是这个仓库反复吃
    # 亏的"同一份真相两份抄本"，而且抄本注定漂移。下面的子串检查只负责在最可能的命名上多说一句
    # 「记得回来接 T6」。
    names = {f.name for f in fields(PersonEntity)}
    suspects = [n for n in names
                if "status" in n.lower() or "employ" in n.lower() or "active" in n.lower()]
    assert not suspects, (
        f"PersonEntity 长出了 {suspects} —— 如果其中之一是任职状态，说明 T6 v1 的第四个字段终于有家了："
        f"去 extract.py 的 `_CONFLICT_FIELD_ALLOWLIST['person']` 补上它，再回来改这条门。"
    )


# === 2 · 人 · 部门冲突 ==========================================================================

def test_person_team_conflict_is_recorded_with_both_readings():
    res = _dedupe(people=[
        _person(team=ROSTER_TEAM, source=f"{ROSTER_DOC}:4"),
        _person(team=WEEKLY_TEAM, source=f"{WEEKLY_DOC}:9"),
    ])
    c = _only(res)
    assert (c.subject_kind, c.field, c.subject_ref) == ("person", "team", res.people[0].id)
    assert [(v.value, v.source, v.doc_key) for v in c.values] == [
        (ROSTER_TEAM, f"{ROSTER_DOC}:4", ROSTER_DOC),
        (WEEKLY_TEAM, f"{WEEKLY_DOC}:9", WEEKLY_DOC),
    ]


def test_values_zero_is_always_the_reading_that_SURVIVED_onto_the_entity():
    """`values[0]` 与人卡上那个值必须永远是同一个 —— T7 的卡面靠这条对齐"读到的"和"我们采信的"。"""
    for order in ((ROSTER_TEAM, WEEKLY_TEAM), (WEEKLY_TEAM, ROSTER_TEAM)):
        res = _dedupe(people=[_person(team=order[0], source="a.md:1"),
                              _person(team=order[1], source="b.md:2")])
        assert _only(res).values[0].value == res.people[0].team == order[0]


def test_a_third_document_appends_to_the_SAME_conflict_not_a_new_one():
    """三份资料三个读数 = **一条** FieldConflict 三条 value，不是两条冲突。

    一个 (主体, 字段) 只长一条，否则 T7 的卡面会把同一件事渲染两遍。
    """
    res = _dedupe(people=[
        _person(team=ROSTER_TEAM, source="a.md:1"),
        _person(team=WEEKLY_TEAM, source="b.md:2"),
        _person(team="餐饮部", source="c.md:3"),
    ])
    c = _only(res)
    assert [v.value for v in c.values] == [ROSTER_TEAM, WEEKLY_TEAM, "餐饮部"]
    assert [v.doc_key for v in c.values] == ["a.md", "b.md", "c.md"]


def test_two_documents_agreeing_with_each_other_against_the_survivor_both_get_recorded():
    """第二、三份都说「前厅部」而第一份说「市场推广部」：两条都记。

    这是**诚实**而不是噪音——"两份说 A、一份说 B"和"一份说 A、一份说 B"是不同的证据强度，
    结构里保留得住，T7 想合并展示随时可以合。
    """
    res = _dedupe(people=[
        _person(team=ROSTER_TEAM, source="a.md:1"),
        _person(team=WEEKLY_TEAM, source="b.md:2"),
        _person(team=WEEKLY_TEAM, source="c.md:3"),
    ])
    c = _only(res)
    assert [(v.value, v.doc_key) for v in c.values] == [
        (ROSTER_TEAM, "a.md"), (WEEKLY_TEAM, "b.md"), (WEEKLY_TEAM, "c.md")]


def test_a_later_document_agreeing_with_the_survivor_records_nothing():
    res = _dedupe(people=[
        _person(team=ROSTER_TEAM, source="a.md:1"),
        _person(team=WEEKLY_TEAM, source="b.md:2"),
        _person(team=ROSTER_TEAM, source="c.md:3"),
    ])
    assert [v.doc_key for v in _only(res).values] == ["a.md", "b.md"]


# === 3 · 什么**不是**冲突 =======================================================================

def test_identical_readings_are_not_a_conflict():
    res = _dedupe(people=[_person(team=ROSTER_TEAM, source="a.md:1"),
                          _person(team=ROSTER_TEAM, source="b.md:2")])
    assert res.conflicts == []


def test_an_absent_field_is_not_a_reading_in_either_direction():
    """空 = 「这份文档没说这件事」，不是一个读数。两个方向都不许记成冲突。"""
    filled = _dedupe(people=[_person(team="", source="a.md:1"),
                             _person(team=WEEKLY_TEAM, source="b.md:2")])
    assert filled.conflicts == [] and filled.people[0].team == WEEKLY_TEAM

    held = _dedupe(people=[_person(team=ROSTER_TEAM, source="a.md:1"),
                           _person(team="", source="b.md:2")])
    assert held.conflicts == [] and held.people[0].team == ROSTER_TEAM


def test_a_single_document_produces_no_conflicts():
    res = _dedupe(people=[_person(team=ROSTER_TEAM)], projects=[_project(status="进行中")])
    assert res.conflicts == []


def test_different_people_never_conflict_with_each_other():
    """两个不同的人各在各的部门 —— 这不是矛盾，是两个人。"""
    res = _dedupe(people=[_person("周雅婷", team=ROSTER_TEAM), _person("孙浩", team="餐饮部")])
    assert res.conflicts == []


def test_fields_outside_the_v1_allowlist_are_still_silently_dropped():
    """v1 收窄是**有意的**：role/tenure/summary 碰撞照旧静默丢弃，不记冲突。

    钉住它，免得有人以为"漏了"就顺手放宽——放宽字段是要重新评估假阳性的动作，不是补丁。
    """
    res = _dedupe(people=[_person(role="市场推广专员", tenure="2 年", source="a.md:1"),
                          _person(role="前厅接待", tenure="1 年", source="b.md:2")])
    assert res.conflicts == []


# === 4 · 项目 · 状态与到期日 ====================================================================

def test_project_status_and_dueDate_each_get_their_own_conflict():
    res = _dedupe(projects=[
        _project(status="进行中", dueDate="2026-09-30", source="项目台账.md:7"),
        _project(status="受阻", dueDate="2026-10-15", source="本周周报.md:12"),
    ])
    assert len(res.conflicts) == 2
    by_field = {c.field: c for c in res.conflicts}
    assert set(by_field) == {"status", "dueDate"}
    for c in res.conflicts:
        assert c.subject_kind == "project"
        assert c.subject_ref == res.projects[0].id
        assert [v.doc_key for v in c.values] == ["项目台账.md", "本周周报.md"]
    assert [v.value for v in by_field["status"].values] == ["进行中", "受阻"]
    assert [v.value for v in by_field["dueDate"].values] == ["2026-09-30", "2026-10-15"]


def test_two_projects_sharing_a_slug_id_do_not_fuse_their_conflicts():
    """回归门：冲突的累加索引用**归并那把身份尺**（`_project_key`/`_person_key`），不是实体 id。

    第一版用 `cur.id` 当索引键。`_slug` 折叠标点并在 32 字符处截断，而 `_project_key` 只折叠空白
    与 `_ -`，于是「别墅套餐推广（八月）」与「别墅套餐推广(八月)」——全角/半角括号，中文文档里
    再普通不过的排版差异——是**两个独立存在的项目卡**，却**共用一个 id**。用 id 当键：

      修复前实测：conflicts == 1，values == [on-track(a), blocked(b), at-risk(d)]
        → 一条记录里混进了**两个不同项目**的读数（at-risk 来自 d.md，那份文档谈的是另一个项目），
          直接违反 FieldConflict 自己的契约（"values[0] 是胜出读数，其后是**同一主体**被丢弃的读数"）。
      修复后：两条记录，各自 [胜出, 被丢弃] 配对正确。

    ⚠ **这条修的是分组，不是 id 碰撞本身**——诚实说清楚，免得下一票以为这里已经解决了：
    两条记录的 `subject_ref` **仍然相同**（因为那两个项目确实共用一个 `_slug` id）。id 碰撞是
    `_slug` 的既有限制，本票没动也不该动。给 T7 的实际影响：按 `subject_ref` 查卡时，**一个 id
    可能对应多于一条冲突记录**，而且极端情况下对应的是不同的项目。要根治得让 `_slug` 产出唯一 id
    （或让实体 id 直接派生自身份尺），那是独立一票。
    """
    t1, t2 = "别墅套餐推广（八月）", "别墅套餐推广(八月)"
    assert _slug(t1, "p") == _slug(t2, "p"), "前提失效：这两个标题不再撞 id 了，本门失去意义"

    res = _dedupe(projects=[
        ProjectEntity(id=_slug(t1, "p"), title=t1, status="on-track", source="a.md:1"),
        ProjectEntity(id=_slug(t1, "p"), title=t1, status="blocked", source="b.md:2"),
        ProjectEntity(id=_slug(t2, "p"), title=t2, status="done", source="c.md:3"),
        ProjectEntity(id=_slug(t2, "p"), title=t2, status="at-risk", source="d.md:4"),
    ])
    assert len(res.projects) == 2, "前提失效：这两个标题应当是两个独立项目"
    assert len(res.conflicts) == 2, f"两张卡的冲突被融成了一条：{res.conflicts}"
    got = sorted([[(v.value, v.doc_key) for v in c.values] for c in res.conflicts])
    assert got == sorted([
        [("on-track", "a.md"), ("blocked", "b.md")],
        [("done", "c.md"), ("at-risk", "d.md")],
    ]), f"两张卡的读数串味了：{got}"


def test_two_people_sharing_a_slug_id_do_not_fuse_their_conflicts():
    """人员侧的同一条规则（`_person_key` 不折叠标点，`_slug` 折叠）。"""
    n1, n2 = "周雅婷·前厅", "周雅婷-前厅"
    if _slug(n1, "u") != _slug(n2, "u"):
        pytest.skip("这两个名字在当前 _slug 下不撞 id —— 换语料才有意义")
    res = _dedupe(people=[
        PersonEntity(id=_slug(n1, "u"), name=n1, team="市场推广部", source="a.md:1"),
        PersonEntity(id=_slug(n1, "u"), name=n1, team="前厅部", source="b.md:2"),
        PersonEntity(id=_slug(n2, "u"), name=n2, team="餐饮部", source="c.md:3"),
        PersonEntity(id=_slug(n2, "u"), name=n2, team="客房部", source="d.md:4"),
    ])
    assert len(res.people) == 2
    assert len(res.conflicts) == 2, f"两个人的冲突被融成了一条：{res.conflicts}"


def test_person_and_project_sharing_a_name_do_not_cross_contaminate():
    """一个人叫「宴会」、一个项目也叫「宴会」：两本出处账必须分开。

    身份 key 是 `_person_key(name)` 与 `_project_key(title)`，两者的命名空间会撞。共用一本
    `(key, field)` 账就会串味。
    """
    res = _dedupe(
        people=[_person("宴会", team=ROSTER_TEAM, source="a.md:1"),
                _person("宴会", team=WEEKLY_TEAM, source="b.md:2")],
        projects=[_project("宴会", status="进行中", source="c.md:3"),
                  _project("宴会", status="受阻", source="d.md:4")],
    )
    assert len(res.conflicts) == 2
    person_c = next(c for c in res.conflicts if c.subject_kind == "person")
    project_c = next(c for c in res.conflicts if c.subject_kind == "project")
    assert [v.doc_key for v in person_c.values] == ["a.md", "b.md"]
    assert [v.doc_key for v in project_c.values] == ["c.md", "d.md"]


# === 5 · 出处精度（本票最容易做错的一处） =======================================================

def test_the_kept_reading_cites_the_document_that_ACTUALLY_stated_it():
    """🔴 三份文档：第一份没说部门、第二份说了、第三份说了个不一样的。

    冲突里"胜出方"的出处必须是**第二份**——那才是真说了这句话的文档。天真的写法会去拿
    `cur.source`（keep-first 的整条出处 = 第一份），于是卡面上引用一份**从没提过部门**的文档。
    那比不报冲突更糟：它是一条看起来有出处、实际撒谎的证据。
    """
    res = _dedupe(people=[
        _person(role="市场推广专员", source="花名册.md:4"),          # 只有身份，没说部门
        _person(team=ROSTER_TEAM, source="八月调整.md:2"),           # 部门从这里来
        _person(team=WEEKLY_TEAM, source="本周周报.md:9"),           # 和它对不上
    ])
    c = _only(res)
    assert c.values[0].value == ROSTER_TEAM
    assert c.values[0].source == "八月调整.md:2", (
        f"胜出读数的出处指到了 {c.values[0].source!r} —— 它必须指向真正说了这句话的那份文档，"
        f"而不是 keep-first 的整条 source（花名册.md:4，那份文档根本没提部门）"
    )
    assert c.values[0].doc_key == "八月调整.md"
    assert (c.values[1].value, c.values[1].doc_key) == (WEEKLY_TEAM, "本周周报.md")
    assert res.people[0].source == "花名册.md:4", "实体自己的 source 仍是 keep-first，没被动过"


def test_the_same_precision_holds_for_projects():
    res = _dedupe(projects=[
        _project(summary="别墅套餐三季度推广", source="台账.md:7"),   # 没说状态
        _project(status="进行中", source="九月周报.md:3"),
        _project(status="受阻", source="十月周报.md:5"),
    ])
    c = _only(res)
    assert (c.values[0].value, c.values[0].doc_key) == ("进行中", "九月周报.md")
    assert (c.values[1].value, c.values[1].doc_key) == ("受阻", "十月周报.md")


# === 6 · doc_key 的切法 =========================================================================

def test_doc_key_strips_the_line_suffix_and_survives_colons_in_the_name():
    assert doc_key_of("员工花名册.md:12") == "员工花名册.md"
    assert doc_key_of("员工花名册.md") == "员工花名册.md", "没有行号就整串是文档名"
    assert doc_key_of("") == "", "空出处不许编出一个文档名"
    assert doc_key_of("C:/上传/名册.md:3") == "C:/上传/名册.md", "取最后一个冒号"


def test_doc_key_is_ONE_RULER_shared_with_the_file_manifest():
    """`doc_key_of` 与文件清单数每文件块数用的是**同一把尺子**（都是它）。

    两把尺子对一个身份是这个仓库反复吃过亏的地方（feat-048 round 1）。冲突卡说"这条读数来自
    《员工花名册.md》"，清单说"《员工花名册.md》有 12 块"——两处的"哪份文档"必须是同一个判据，
    否则卡面引用的文档在清单里可能根本不存在。
    """
    import inspect

    from avery.ingest import pipeline, registry
    for mod in (pipeline, registry):
        src = inspect.getsource(mod)
        assert 'rsplit(":", 1)' not in src, (
            f"{mod.__name__} 里又出现了手抄的 rsplit 切法 —— 应当调 extract.doc_key_of"
        )
        assert "doc_key_of" in src


# === 6b · 落库侧的两处"第二副本"守卫 ============================================================
# 都是**离线**静态守卫（不需要真库），补的是 _ENTITY_KINDS 那条注释声称"只有一处"、而实际有三处
# 的缺口。三处必须同时改：_ENTITY_KINDS / put() 的 by_kind / 迁移 0010（它自己内部还有两处）。

def test_put_by_kind_covers_exactly_the_entity_kinds():
    """`put()` 里的 `by_kind` 字面量是 `_ENTITY_KINDS` 的**第二副本**，必须逐字对齐。

    少一个 key → `by_kind[kind]` 直接 KeyError，**每一次 put 全挂**（不是降级，是整个写路径死）。
    多一个 key → 那一路的行永远不会被写（`for kind in _ENTITY_KINDS` 遍历不到它），静默丢数据。
    `_ENTITY_KINDS` 上方的注释写着"the one place a new entity kind must be registered"，
    那句话在加 by_kind 之后就不完全成立了；这条门把它变成真的。
    """
    import inspect
    import re

    from avery.ingest import pg_registry

    src = inspect.getsource(pg_registry.PostgresContextRegistry.put)
    m = re.search(r"by_kind\s*=\s*\{(.*?)\}", src, re.S)
    assert m, "put() 里找不到 by_kind 字面量了 —— 结构变了，请更新本门"
    keys = set(re.findall(r"[\"']([a-z_]+)[\"']\s*:", m.group(1)))
    assert keys == set(pg_registry._ENTITY_KINDS), (
        f"by_kind 与 _ENTITY_KINDS 漂移了：by_kind={sorted(keys)} "
        f"_ENTITY_KINDS={sorted(pg_registry._ENTITY_KINDS)}"
    )


def test_migration_0010_guard_literal_matches_its_own_ADD():
    """迁移 0010 内部**自己有两处** kind 列表，既有的漂移门只看得见其中一处。

    0010 是"先比对再 ALTER"的守卫式迁移：`want` 是拿来和库里现状比对的**期望值**，下面的
    `ADD CONSTRAINT` 才是真正执行的语句。`test_entities_kind_check_covers_written_kinds`
    （test_registry_contract.py）只正则扫 `ADD CONSTRAINT ... ARRAY[...]`，**不看 `want`**。

    后果很具体：下一个人加第六个 kind 时，照着那条门的报错信息「Edit the kind-check migration
    IN PLACE」只改了 ADD，`want` 仍是五个。于是引导时 `have`(库里五个) 与 `want`(五个) 比对**相等**
    → 整个 IF 分支跳过 → 那条六 kind 的 ADD **永远不执行** → 库里 CHECK 停在五个 → 新 kind 的行
    被真 Postgres 拒收，而所有离线门全绿。这正是 08 的 playbook kind 当年翻车的同一种形状。

    本门把 `want` 也纳进来。（T6 加 'conflict' 时两处都改了，这条门就是那次改动的保险。）
    """
    import re
    from pathlib import Path

    from avery.ingest.pg_registry import _ENTITY_KINDS

    sql = (Path(__file__).resolve().parent.parent / "db" / "migrations"
           / "0010_entities_kind_playbook.sql").read_text(encoding="utf-8")
    body = re.sub(r"--[^\n]*", "", sql)

    want = re.search(r"want\s+text\s*:=\s*(.*?);", body, re.S)
    assert want, "0010 的 want 字面量不见了 —— 迁移结构变了，请更新本门"
    want_kinds = set(re.findall(r"''([a-z_]+)''", want.group(1)))

    add = re.search(r"ADD\s+CONSTRAINT\s+entities_kind_check\b.*?ARRAY\s*\[([^\]]*)\]", body, re.S)
    assert add, "0010 的 ADD CONSTRAINT 不见了"
    add_kinds = set(re.findall(r"'([^']+)'", add.group(1)))

    assert want_kinds == add_kinds == set(_ENTITY_KINDS), (
        f"0010 内部漂移了 —— want={sorted(want_kinds)} ADD={sorted(add_kinds)} "
        f"_ENTITY_KINDS={sorted(_ENTITY_KINDS)}。\n"
        f"三者必须完全一致：want 只用来比对，ADD 才真执行；want 落后会让 ALTER 整段被跳过，"
        f"库里 CHECK 停在旧集合，新 kind 的行被真库拒收而离线门全绿。"
    )


# === 7 · asdict 往返（持久化那条路的形状） ======================================================

def test_conflicts_survive_an_asdict_round_trip_with_nested_values_typed():
    """pg 存 `asdict(c)`、回读 `FieldConflict(**payload)` —— 嵌套的 values 必须**回来还是 dataclass**。

    不强转的话，`c.values[0].doc_key` 是在 dict 上取属性，**只在持久化那条路上**炸；离线套用
    in-memory registry，永远复现不出来。rich-align-0722 就是这样上线才发现 `pr.risk.level` 500 的。
    """
    res = _dedupe(people=[_person(team=ROSTER_TEAM, source=f"{ROSTER_DOC}:4"),
                          _person(team=WEEKLY_TEAM, source=f"{WEEKLY_DOC}:9")])
    payload = asdict(_only(res))
    assert payload["values"][0] == {
        "value": ROSTER_TEAM, "source": f"{ROSTER_DOC}:4", "doc_key": ROSTER_DOC}

    back = FieldConflict(**payload)
    assert all(isinstance(v, ConflictValue) for v in back.values), (
        "回读后 values 还是 dict —— __post_init__ 的强转没生效，消费方会在生产路上炸"
    )
    assert back.values[1].doc_key == WEEKLY_DOC
    assert asdict(back) == payload, "往返必须是恒等的"


def test_a_conflict_payload_carries_no_human_prose():
    """ADR-0033：载荷里只有**机器键** + **verbatim 原值**，一句话都不拼。

    `field` 必须是 python 属性名那种机器键（ASCII、无空格）；句子归前端 i18n（T7 的活）。
    value 是文档原值，中文当然可以——那是 verbatim，不是我们写的话。
    """
    res = _dedupe(people=[_person(team=ROSTER_TEAM, source="a.md:1"),
                          _person(team=WEEKLY_TEAM, source="b.md:2")])
    c = _only(res)
    # ⚠ 不要写成 `" " not in c.field is False` —— Python 的链式比较会把它拆成两个比较，
    # 断言恒真/恒假，门就变成摆设。分行写。
    assert c.field.isascii(), f"field 必须是机器键：{c.field!r}"
    assert c.field.isidentifier(), f"field 必须是 python 属性名那种形状：{c.field!r}"
    assert c.subject_kind in ("person", "project")
    for v in c.values:
        assert v.value in (ROSTER_TEAM, WEEKLY_TEAM), "value 必须是文档原值，不许改写"


# === 8 · 已知盲区（明写，不假装覆盖） ===========================================================

def test_two_readings_inside_ONE_document_still_conflict_and_share_a_doc_key():
    """同一份文档自己前后矛盾也照记 —— 但两条 value 的 `doc_key` 是**同一个**。

    这是真会发生的：一份花名册把同一个人列了两行、部门写得不一样。T7 渲染时不能假设
    「有冲突 ⇒ 至少两份不同的文档」，否则那张卡会说"两份资料对不上"而其实只有一份。
    """
    res = _dedupe(people=[_person(team=ROSTER_TEAM, source=f"{ROSTER_DOC}:4"),
                          _person(team=WEEKLY_TEAM, source=f"{ROSTER_DOC}:9")])
    c = _only(res)
    assert [v.doc_key for v in c.values] == [ROSTER_DOC, ROSTER_DOC]
    assert [v.source for v in c.values] == [f"{ROSTER_DOC}:4", f"{ROSTER_DOC}:9"]


def test_KNOWN_BLIND_SPOT_the_llm_path_drops_team_within_a_document():
    """🔴 明写的盲区：LLM 抽取路在**文档内部**跨窗口合并时，第二个窗口的 `team` 根本没被读。

    `llm_extract._build` 的 enrich 分支（llm_extract.py:424-438）只处理 owns / role / self_report，
    **没有 team 这一行**。所以同一份文档的两个窗口对部门给出不同读数时，第二个读数在
    `_dedupe_entities` 见到它之前就被丢掉了 —— T6 记不到它。

    跨文档（本票的靶心）不受影响：每份文档产出各自的 PersonEntity，碰撞发生在 `_dedupe_entities`
    里，那正是我们下手的地方。

    这条断言钉的是**源码事实**而不是行为，因为要造出这个行为得跑真模型。哪天有人给那个分支补上
    team 的 enrich，这条门会变红并指到这里——那时该做的是把这段盲区说明删掉、补一条真行为断言。
    """
    import inspect

    from avery.ingest import llm_extract

    src = inspect.getsource(llm_extract._build) if hasattr(llm_extract, "_build") else \
        inspect.getsource(llm_extract)
    enrich = src.split("same person across windows")[1].split("seen_titles")[0]
    assert "person.team" not in enrich, (
        "llm_extract 的跨窗口 enrich 分支现在会读 team 了 —— T6 的这块盲区说明已经过期，"
        "请改成一条真行为断言（同文档两窗口不同部门 → conflicts 里应当出现一条）。"
    )


def test_link_owners_runs_after_dedupe_and_leaves_conflicts_alone():
    """`_link_owners` 在 dedupe 之后跑（extract.py 的 extract_docs）并会改写 `project.ownerId`。

    它不许碰 conflicts —— 冲突里的 subject_ref 是**实体 id**，而 _link_owners 改的是 ownerId，
    两者不是一回事。整条走 `extract_docs` 验一遍，比只调 `_dedupe_entities` 更接近真路。
    """
    docs = [parse_bytes("a.md", _ROSTER_A.encode("utf-8")),
            parse_bytes("b.md", _ROSTER_B.encode("utf-8"))]
    res = extract_docs(docs, extractor=HeuristicExtractor())
    team_conflicts = [c for c in res.conflicts if c.field == "team"]
    assert team_conflicts, "真 pipeline 上没记到部门冲突"
    ids = {p.id for p in res.people}
    for c in team_conflicts:
        assert c.subject_ref in ids, (
            f"subject_ref={c.subject_ref!r} 在人员 id 里找不到 —— _link_owners 之后 id 对不上了"
        )


# === 9 · 真 pipeline 端到端 =====================================================================

_ROSTER_A = """# 三亚亚特兰蒂斯别墅酒店 — 员工花名册

姓名 | 职位 | 部门 | 司龄 | 负责
周雅婷 | 市场推广专员 | 市场推广部 | 2 年 | 别墅套餐推广物料
孙浩 | 餐饮部领班 | 餐饮部 | 4 年 | 宴会动线优化
"""

_ROSTER_B = """# 三亚亚特兰蒂斯别墅酒店 — 八月部门调整后名册

姓名 | 职位 | 部门 | 司龄 | 负责
周雅婷 | 前厅接待 | 前厅部 | 2 年 | 前台交接流程
"""


def _pipeline(*docs):
    parsed = [parse_bytes(n, t.encode("utf-8")) for n, t in docs]
    return extract_docs(parsed, extractor=HeuristicExtractor())


def test_the_real_offline_pipeline_records_the_conflict_end_to_end():
    """两份真中文花名册 → parse → HeuristicExtractor → extract_docs，冲突真的记下来了。

    这是第一步那条"案发现场"断言的正面版：人卡上依然只有胜出的那个部门（实体形状没变），
    而输掉的读数现在在 conflicts 里，带着它自己的文档名。
    """
    res = _pipeline(("roster_a.md", _ROSTER_A), ("roster_b.md", _ROSTER_B))

    zhou = next(p for p in res.people if p.name == ZHOU)
    assert zhou.team == ROSTER_TEAM, "实体上的胜出值不变 —— 本票没改归并结果，只改了记不记账"

    c = next(c for c in res.conflicts if c.subject_ref == zhou.id and c.field == "team")
    assert [v.value for v in c.values] == [ROSTER_TEAM, WEEKLY_TEAM]
    assert [v.doc_key for v in c.values] == ["roster_a.md", "roster_b.md"]
    assert all(v.source.startswith(v.doc_key + ":") for v in c.values), (
        "source 必须是 <文档名>:<行> 形状，doc_key 是它的前缀 —— T7 join uploaded_at 靠这个"
    )


_LEDGER_DOC = """# 项目台账

项目：别墅套餐推广
负责人：周雅婷
状态：进行中
截止：2026-09-30
"""

_LEDGER_LATER_DOC = """# 十月项目台账

项目：别墅套餐推广
负责人：周雅婷
状态：受阻
截止：2026-10-15
"""


def test_project_conflicts_are_REACHABLE_through_the_real_extractor():
    """项目侧的**可达性**确认：真中文台账走完整条路，断言的是抽取器**自己产出的归一化值**。

    为什么加：本节以外的项目断言都手搓实体，而手搓用的 `status="进行中"` 真抽取器根本产不出来
    —— `_norm_status` 把中文状态词映射成 on-track / at-risk / blocked / done。手搓语料和真语料
    对不上，是"判据够不着"型假绿的经典入口。

    ⚠ 措辞要诚实：这**不是**在补一个已经漏掉的洞。复核时实测过，项目冲突在改动前就已经能通过真
    管道命中——`_note_conflicts` 是**字段泛型**的（`for fname in _CONFLICT_FIELD_ALLOWLIST[kind]`
    + getattr + 纯字符串比较），没有任何分支看 value 的内容，所以 "进行中" 与 "on-track" 走的是
    逐字节相同的代码。这条门的价值是把"真语料上确实命中、且归一化词表没变"钉住，不是修 bug。
    """
    res = _pipeline(("台账_9月.md", _LEDGER_DOC), ("台账_10月.md", _LEDGER_LATER_DOC))
    assert len(res.projects) == 1, f"项目没合成一条：{[(p.title, p.status) for p in res.projects]}"

    by_field = {c.field: c for c in res.conflicts if c.subject_kind == "project"}
    assert "status" in by_field, f"真管道上没记到状态冲突：{res.conflicts}"
    assert "dueDate" in by_field, f"真管道上没记到到期日冲突：{res.conflicts}"

    status_vals = [v.value for v in by_field["status"].values]
    assert status_vals == ["on-track", "blocked"], (
        f"状态值不是抽取器的归一化词表产物：{status_vals} —— 手搓语料和真语料对不上了"
    )
    assert [v.value for v in by_field["dueDate"].values] == ["2026-09-30", "2026-10-15"]
    assert [v.doc_key for v in by_field["status"].values] == ["台账_9月.md", "台账_10月.md"]
    assert by_field["status"].subject_ref == res.projects[0].id


def test_KNOWN_FALSE_POSITIVE_same_date_written_two_ways_reports_as_a_disagreement():
    """已知假阳性，**按现状钉住**：同一个日期两种写法会被报成"对不上"。

    `dueDate` 是 verbatim 存的，v1 判据只有"完全不相等"，不做任何归一化。所以
    `2026年9月30日` 与 `2026-09-30` —— 同一天 —— 会生成一条冲突。

    这属于设计里**已经预见并接受**的那一类（design-options §B2：假阳性来源是同义不同写，v1 只报
    完全不相等，卡上给「这不是错，可能只是叫法不同」的关闭出口，沿用 flowStore 的 dismiss 分桶）。
    日期格式差异和「传菜组 / 传菜 / 前厅-传菜」是同一类，不是新问题。

    ⚠ 但 T7 必须知道它存在：卡面文案不能写成"两份资料矛盾"这种断言口吻，dismiss 出口不是可选的。
    真要消掉，得先决定日期归一化口径（那会改变"读到什么"的语义），是独立一票，不在 T6。
    """
    res = _pipeline(
        ("台账_a.md", "# 台账\n\n项目：别墅套餐推广\n状态：进行中\n截止：2026年9月30日\n"),
        ("台账_b.md", "# 台账\n\n项目：别墅套餐推广\n状态：进行中\n截止：2026-09-30\n"),
    )
    due = [c for c in res.conflicts if c.field == "dueDate"]
    assert len(due) == 1, "假阳性行为变了 —— 如果是有意加了日期归一化，改这条门并记进票尾"
    assert [v.value for v in due[0].values] == ["2026年9月30日", "2026-09-30"]
    assert not [c for c in res.conflicts if c.field == "status"], "状态两份一样，不该报冲突"


def test_KNOWN_LIMITATION_project_source_is_BLOCK_level_not_field_level():
    """🔴 给 T7 的警告，钉成可执行的：`ConflictValue.source` 的行号是**项目块的**行号，不是那个
    字段所在的行号；而且状态可以是**整篇推断**出来的，不需要文档里真有一行「状态：」。

    实测（真管道）：台账写明「状态：进行中」，周报**一个字都没提状态**、只有散文
    「摄影师档期迟迟没定下来…推进不了」，抽取器的整篇兜底把它读成 `blocked`，出处记作
    `周报.md:1` —— 那一行是标题 `# 本周周报`，不是证据所在。

    这不是 T6 引进的：`ProjectEntity.source` 本来就是实体级出处，T6 只是如实转述它。
    但它决定了 **T7 不能把 `source` 当成「逐字引用这一行」的凭据**：照那行取原文会引到标题。
    T7 要做双引文卡，得先解决字段级出处（那是改抽取器，独立一票）。

    ADR-0018 口径下这仍然是诚实的——我们确实"读到"了 blocked，卡面说"读到"没有撒谎；
    撒谎的是**指着标题行说这就是原句**。
    """
    res = _pipeline(
        ("台账.md", "# 项目台账\n\n项目：别墅套餐推广\n状态：进行中\n"),
        ("周报.md", "# 本周周报\n\n项目：别墅套餐推广\n摄影师档期迟迟没定下来，场地也卡住了，推进不了。\n"),
    )
    st = [c for c in res.conflicts if c.field == "status"]
    assert len(st) == 1, f"整篇推断出来的状态没进冲突：{res.conflicts}"
    vals = [(v.value, v.source) for v in st[0].values]
    assert vals[1][0] == "blocked", f"周报的推断状态变了：{vals}"
    assert vals[1][1].endswith(":1"), (
        f"出处不再指向块首行了：{vals[1][1]} —— 若是改成了字段级出处，那是好事，"
        f"请删掉这段限制说明并通知 T7"
    )


def test_孙浩_appears_in_only_one_document_and_produces_no_conflict():
    """只在一份文档里出现的人不产生冲突 —— 语料自检，防止上一条是"全都报冲突"蒙对的。"""
    res = _pipeline(("roster_a.md", _ROSTER_A), ("roster_b.md", _ROSTER_B))
    sun = next(p for p in res.people if p.name == "孙浩")
    assert not [c for c in res.conflicts if c.subject_ref == sun.id]


def test_reversing_upload_order_reverses_the_recorded_values_but_not_the_facts():
    """换个上传顺序，胜出方换人、values 顺序跟着换，但**两个读数一个不少**。

    这正是 conflicts 的价值：归并结果依然是顺序敏感的（本票没改那个），但"两份资料对不上"这件事
    从此**不再随顺序丢失**。
    """
    fwd = _pipeline(("roster_a.md", _ROSTER_A), ("roster_b.md", _ROSTER_B))
    rev = _pipeline(("roster_b.md", _ROSTER_B), ("roster_a.md", _ROSTER_A))
    fwd_c = next(c for c in fwd.conflicts if c.field == "team")
    rev_c = next(c for c in rev.conflicts if c.field == "team")
    assert [v.value for v in fwd_c.values] == [ROSTER_TEAM, WEEKLY_TEAM]
    assert [v.value for v in rev_c.values] == [WEEKLY_TEAM, ROSTER_TEAM]
    assert {v.value for v in fwd_c.values} == {v.value for v in rev_c.values}


def test_ingest_docs_publishes_a_context_carrying_the_conflicts():
    """走整条 `ingest_docs`（含红线硬门）——冲突结构不该把任何一份正常语料挡在门外。"""
    parsed = [parse_bytes(n, t.encode("utf-8"))
              for n, t in (("roster_a.md", _ROSTER_A), ("roster_b.md", _ROSTER_B))]
    rep = ingest_docs(parsed, extractor=HeuristicExtractor())
    assert rep.ok, f"红线门把带冲突的语料挡下了：{rep.violations}"
    assert rep.context is not None
    assert [c.field for c in rep.context.extraction.conflicts] == ["team"]


# === 10 · @needs_db · 真 Postgres ==============================================================
# 离线套用 in-memory registry，**整个持久层对它隐形**：真 CHECK 从不被考、迁移从不真重放、
# asdict→JSONB→回读 从不发生。新加一个 entity kind 而不跑真库 = 生产拒收、离线全绿（rich-align
# 就是这样一口气撞了 4 个只在真库现形的 bug）。

def _db_url() -> str | None:
    return (os.environ.get("AVERY_DB_URL") or os.environ.get("PGVECTOR_URL") or "").strip() or None


@needs_db
def test_conflicts_round_trip_through_a_REAL_postgres(tmp_path: Path):
    """put → 换一个全新的 registry 实例 get → 冲突回来了，且嵌套 values 是 dataclass。

    这条门同时考三件事，任何一件漏了都只在生产现形：
      ① `entities_kind_check` 认不认 `kind='conflict'`（迁移 0010 就地扩了没有）；
      ② put 的 `by_kind` 有没有这一路（少一个 key 直接 KeyError）；
      ③ get 重建 `ExtractionResult` 时读不读它（不读 = 静默丢失，`granularity` 就是活反面教材）。
    """
    url = _db_url()
    if not url:
        pytest.skip("needs AVERY_DB_URL (or PGVECTOR_URL) pointing at a Postgres")
    pytest.importorskip("psycopg")
    from avery.ingest.pg_registry import PostgresContextRegistry

    cid = "ctx_t6_" + uuid.uuid4().hex[:12]
    data_dir = tmp_path / "data"
    reg = PostgresContextRegistry(url, data_dir=data_dir)
    try:
        parsed = [parse_bytes(n, t.encode("utf-8"))
                  for n, t in (("roster_a.md", _ROSTER_A), ("roster_b.md", _ROSTER_B))]
        rep = ingest_docs(parsed, extractor=HeuristicExtractor(), registry=reg, context_id=cid)
        assert rep.ok, f"真库 ingest 被挡：{rep.violations}"
        assert [c.field for c in rep.context.extraction.conflicts] == ["team"]

        # 全新实例 + 全新连接 —— 这才是"重启之后还在"的那个断言。
        fresh = PostgresContextRegistry(url, data_dir=tmp_path / "data2")
        got = fresh.get(cid)
        assert got is not None, "context 没落库"

        conflicts = got.extraction.conflicts
        assert len(conflicts) == 1, f"冲突没往返回来：{conflicts}"
        c = conflicts[0]
        assert isinstance(c, FieldConflict)
        assert (c.subject_kind, c.field) == ("person", "team")
        assert all(isinstance(v, ConflictValue) for v in c.values), (
            "回读的 values 还是 dict —— __post_init__ 强转没生效（这正是离线套看不见的那类 bug）"
        )
        assert [v.value for v in c.values] == [ROSTER_TEAM, WEEKLY_TEAM]
        assert [v.doc_key for v in c.values] == ["roster_a.md", "roster_b.md"]

        zhou = next(p for p in got.extraction.people if p.name == ZHOU)
        assert c.subject_ref == zhou.id, "往返之后 subject_ref 与人卡 id 对不上了"
    finally:
        try:
            reg.delete(cid)
        except Exception:
            pass


@needs_db
def test_conflicts_survive_a_get_MUTATE_put_crud_round_trip(tmp_path: Path):
    """🔴 本仓库最毒的一类 bug 的位置：**读端省略某列 → 写端把它抹成 NULL**。

    全部手编 CRUD 都是 `get() → 改 → put()`（`ProjectWriteMixin`），而 `put()` 是
    DELETE + 全量重插。所以任何 `get()` **没读回来**的东西，都会被下一次「加一个项目」这种无关操作
    **永久销毁**——files-hub-0729 就是这样把用户上传的原始字节全写成 NULL 的（清单照列、下载 404）。
    `granularity` 今天正是这个状态（get 不读它），只是没人在意。

    conflicts 绝不能重蹈：这条门加一个项目，再用全新实例读回来，冲突必须一条不少、类型不丢。
    离线套的 in-memory registry 复现不出来（它 get 回来的是同一个对象），只有真库能考。
    """
    url = _db_url()
    if not url:
        pytest.skip("needs AVERY_DB_URL (or PGVECTOR_URL) pointing at a Postgres")
    pytest.importorskip("psycopg")
    from avery.ingest.pg_registry import PostgresContextRegistry

    cid = "ctx_t6_" + uuid.uuid4().hex[:12]
    reg = PostgresContextRegistry(url, data_dir=tmp_path / "data")
    try:
        parsed = [parse_bytes(n, t.encode("utf-8"))
                  for n, t in (("roster_a.md", _ROSTER_A), ("roster_b.md", _ROSTER_B))]
        rep = ingest_docs(parsed, extractor=HeuristicExtractor(), registry=reg, context_id=cid)
        assert rep.ok and rep.context.extraction.people, "语料自检：真库 ingest 没抽出人"
        assert len(rep.context.extraction.conflicts) == 1, "前提不成立：ingest 后就没有冲突"

        reg.add_project(cid, {"title": "手编项目", "status": "进行中"})   # get → mutate → put

        got = PostgresContextRegistry(url, data_dir=tmp_path / "data2").get(cid)
        assert "手编项目" in [p.title for p in got.extraction.projects], "手编项目没写进去"
        assert len(got.extraction.conflicts) == 1, (
            "一次无关的手编 CRUD 把冲突抹掉了 —— 这正是 files-hub-0729 那类读写不对称"
        )
        c = got.extraction.conflicts[0]
        assert all(isinstance(v, ConflictValue) for v in c.values)
        assert [v.value for v in c.values] == [ROSTER_TEAM, WEEKLY_TEAM]
    finally:
        try:
            reg.delete(cid)
        except Exception:
            pass


@needs_db
def test_a_context_with_NO_conflicts_still_round_trips(tmp_path: Path):
    """反面：没有冲突的 context 照常往返，`conflicts` 回来是空列表而不是炸。"""
    url = _db_url()
    if not url:
        pytest.skip("needs AVERY_DB_URL (or PGVECTOR_URL) pointing at a Postgres")
    pytest.importorskip("psycopg")
    from avery.ingest.pg_registry import PostgresContextRegistry

    cid = "ctx_t6_" + uuid.uuid4().hex[:12]
    reg = PostgresContextRegistry(url, data_dir=tmp_path / "data")
    try:
        parsed = [parse_bytes("roster_a.md", _ROSTER_A.encode("utf-8"))]
        rep = ingest_docs(parsed, extractor=HeuristicExtractor(), registry=reg, context_id=cid)
        assert rep.ok
        got = PostgresContextRegistry(url, data_dir=tmp_path / "data2").get(cid)
        assert got is not None and got.extraction.conflicts == []
        assert got.extraction.people, "语料自检：没冲突不等于没抽到人"
    finally:
        try:
            reg.delete(cid)
        except Exception:
            pass
