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
    names = {f.name for f in fields(PersonEntity)}
    suspects = [n for n in names
                if "status" in n.lower() or "employ" in n.lower() or "active" in n.lower()]
    assert not suspects, (
        f"PersonEntity 长出了 {suspects} —— 如果其中之一是任职状态，说明 T6 v1 的第四个字段终于有家了："
        f"去 extract.py 的 _CONFLICT_FIELD_ALLOWLIST['person'] 补上它，再回来改这条门。"
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
