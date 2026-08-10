# -*- coding: utf-8 -*-
"""issue #87 · 实体血缘地基 —— 「这张卡来自哪几份文件、每一格是哪一份给的」。

本票只做**地基**：把血缘记下来。消费它的两张票（「删文件收回结论」与「逐条撤回」）另开，
所以这里**没有**任何一条断言 `delete_document_from_context` 的行为变了——相反，§5 明写它
一格未动，并把「地基已经够用了」写成一条可执行的话（`test_the_lineage_now_answers_*`）。

判据分六段：

  §1 播种 —— 构造一张卡就等于记下它的血缘（含**存量卡回读时的兜底**与那条兜底的红线：
     手编过的格子绝不被推成「某份文档说的」）。
  §2 归并（上传路）—— 谁填的那一格就归谁；输给 keep-first 的读数**照样**进来源文档集合。
  §3 补传（记 prev）—— 每一次 `setattr` 之前先拍照。逐字段走遍 `_APPEND_REFRESHABLE` +
     `_APPEND_UNIONED`（**语料喂不饱的格子自己塞哨兵**，否则整条判据只对其中几格有牙）。
  §4 batch_id —— 「这一批」的确定性名字。
  §5 主链（离线集成）+ 与 #77 裁定的关系。
  §6 @needs_db —— 真库那一层。⚠ 离线套对 pg 持久层是瞎的，而且它会以「全绿」的形态骗你；
     `lineage` 是 `PersonEntity` 的**顶层**键，0009 的 allowlist 少一个字它就是一条只在
     生产上炸的写入（0002 的 8 键 allowlist 就这么炸过一次）。

零真 LLM：`AVERY_BRAIN=mock` + `AVERY_EXTRACTOR=heuristic` + `AVERY_EMBEDDINGS=keyword`
（三件套缺一真烧钱）。
"""
from __future__ import annotations

from dataclasses import asdict
from pathlib import Path

import pytest

from avery.ingest import ingest_paths
from avery.ingest.extract import (
    _APPEND_REFRESHABLE, _APPEND_UNIONED, _LINEAGE_CHAIN_DEPTH, AppendLedger, ExtractionResult,
    PersonEntity, PersonSelfReport, ProjectEntity, ProjectMilestone, ProjectRisk, SelfReportLoad,
    _dedupe_entities, _lineage_fields, batch_id_for, merge_person_reading, merge_project_reading,
)
from avery.ingest.file_append import append_paths_to_context
from avery.ingest.file_delete import delete_document_from_context
from avery.ingest.registry import ContextRegistry, SourceDocument

needs_db = pytest.mark.needs_db

OLD_DOC, NEW_DOC = "项目台账.md", "旺季排班协调纪要.md"
OLD_AT, NEW_AT = "2026-08-01T09:00:00+00:00", "2026-08-09T09:00:00+00:00"
TITLE = "婚宴对接"
OLD_OWNER, NEW_OWNER = "老周", "小马"


@pytest.fixture(autouse=True)
def _offline(monkeypatch):
    monkeypatch.setenv("AVERY_EMBEDDINGS", "keyword")
    monkeypatch.setenv("AVERY_BRAIN", "mock")
    monkeypatch.setenv("AVERY_EXTRACTOR", "heuristic")
    monkeypatch.delenv("AVERY_ALLOW_PERSON_SCORING", raising=False)


# --- 手搭件 -----------------------------------------------------------------------------------

def _sdoc(source_key: str, uploaded_at: str) -> SourceDocument:
    return SourceDocument(filename=source_key, source_key=source_key, mime="text/markdown",
                          size_bytes=1, doc_kind="company", status="ingested",
                          uploaded_at=uploaded_at)


def _ledger(extraction: ExtractionResult, *pairs, batch=()) -> AppendLedger:
    pairs = pairs or ((OLD_DOC, OLD_AT), (NEW_DOC, NEW_AT))
    return AppendLedger(extraction, [_sdoc(k, at) for k, at in pairs], batch_keys=batch)


def _person(name: str = "周雅婷", doc: str = OLD_DOC, line: int = 3, **kw) -> PersonEntity:
    kw.setdefault("id", "u_zhou")
    kw.setdefault("source", f"{doc}:{line}")
    return PersonEntity(name=name, **kw)


def _project(title: str = TITLE, doc: str = OLD_DOC, line: int = 7, **kw) -> ProjectEntity:
    kw.setdefault("id", "p_banquet")
    kw.setdefault("source", f"{doc}:{line}")
    return ProjectEntity(title=title, **kw)


def _docs(entity) -> list[str]:
    return list((entity.lineage or {}).get("docs") or [])


def _fields(entity) -> dict:
    return dict((entity.lineage or {}).get("fields") or {})


def _cell(entity, fname: str) -> dict:
    return dict(_fields(entity).get(fname) or {})


def _jsonish(value):
    """测试侧**独立**写一遍「JSON 原生形状」的期望。

    🔴 刻意**不** import `extract._jsonable`：拿被测函数自己去算期望值，是 fixture 自考自答
    —— 判据与实现同源，一起错就一起绿。这里手写一遍两个嵌套 dataclass 的形状，它们要是漂了，
    这条判据就该红。
    """
    if isinstance(value, ProjectRisk):
        return {"level": value.level, "reason": value.reason}
    if isinstance(value, ProjectMilestone):
        return {"name": value.name, "status": value.status, "statusRaw": value.statusRaw}
    if isinstance(value, (list, tuple)):
        return [_jsonish(v) for v in value]
    return value


# 逐字段哨兵：真语料喂不饱 `risk`/`milestones`/`dependsOn`/`collaboration` 这些格子，
# 而「按字段遍历」的全覆盖判据只对喂得饱的那几格有牙（#86 实收：漏清 signals 的变异活了下来）。
# 所以两套值全部手工造出来，每一格都有 A/B 两个互不相等的读数。
_SENTINEL_A: dict[str, dict] = {
    "person": {"role": "市场专员", "team": "市场推广部", "tenure": "3年",
               "owns": ["婚宴对接"], "collaboration": ["前厅部"]},
    "project": {"ownerName": OLD_OWNER, "status": "on-track", "dueDate": "2026-09-30",
                "summary": "别墅套餐三季度推广", "progress": 0,
                "risk": ProjectRisk(level="low", reason="备选场地已锁"),
                "milestones": [ProjectMilestone("一期", "done")],
                "blockers": ["等场地确认"], "dependsOn": ["市场部排期"]},
}
_SENTINEL_B: dict[str, dict] = {
    "person": {"role": "市场经理", "team": "前厅部", "tenure": "4年",
               "owns": ["宴会统筹"], "collaboration": ["康乐部"]},
    "project": {"ownerName": NEW_OWNER, "status": "blocked", "dueDate": "2026-10-15",
                "summary": "改口径后的推广摘要", "progress": 55,
                "risk": ProjectRisk(level="high", reason="雨季无备选场地"),
                "milestones": [ProjectMilestone("二期", "active")],
                "blockers": ["雨季无备选场地"], "dependsOn": ["工程部改造"]},
}


def _sentinels_cover_every_tracked_field() -> None:
    """哨兵表自己要先对得上 —— 判据够不着的格子等于没判（本文件多条断言的前提）。"""
    for kind in ("person", "project"):
        want = set(_lineage_fields(kind))
        for table, label in ((_SENTINEL_A, "A"), (_SENTINEL_B, "B")):
            missing = want - set(table[kind])
            assert not missing, f"哨兵表 {label} 漏了 {kind} 的 {sorted(missing)} —— 那几格无人判"


def _make(kind: str, table: dict, doc: str, line: int = 3):
    return (_person(doc=doc, line=line, **table[kind]) if kind == "person"
            else _project(doc=doc, line=line, **table[kind]))


# =============================================================================================
# §1 · 播种 —— 构造一张卡就等于记下它的血缘
# =============================================================================================

def test_a_freshly_extracted_card_knows_which_document_it_came_from():
    """血缘的下限：`docs` ⊇ {doc_key_of(source)}。粒度是**文档名**，与 `file_delete` 判
    「这条读数算哪份文档的」用的是同一把尺（`doc_key_of`）。"""
    assert _docs(_person(doc=OLD_DOC, line=4)) == [OLD_DOC]
    assert _docs(_project(doc=NEW_DOC, line=12)) == [NEW_DOC]


@pytest.mark.parametrize("kind", ["person", "project"])
def test_every_document_writable_cell_is_seeded_from_its_own_document(kind):
    """**逐格**：文档写得动的每一个格子，构造完就带血缘，而且指向自己那份文档。

    ⚠ 这条判据的牙全在哨兵表上 —— 真语料喂不饱 `risk`/`milestones`/`dependsOn`，
    光靠语料跑这一条，那几格永远是「没值 → 跳过 → 绿」。

    🔴 期望值取自**两张源表**（`_APPEND_REFRESHABLE` + `_APPEND_UNIONED` = 「一份文档写得动
    哪些格子」），不取自 `_lineage_fields`。变异实收：拿被测函数当尺子，它一缩水期望值就跟着
    缩水，「血缘只跟一半字段」这条变异当场全绿活下来（M14）。**尺子不能长在被量的东西上。**
    """
    _sentinels_cover_every_tracked_field()
    want = set(_APPEND_REFRESHABLE[kind]) | set(_APPEND_UNIONED[kind])
    assert set(_lineage_fields(kind)) == want, (
        "血缘跟踪面与「文档写得动的格子」漂开了 —— 两者按定义必须相等")
    entity = _make(kind, _SENTINEL_A, OLD_DOC, line=5)
    got = _fields(entity)
    assert set(got) == want, f"{kind} 的血缘漏了 {sorted(want - set(got))}"
    for fname, rec in got.items():
        assert rec == {"source": f"{OLD_DOC}:5", "seeded": True}, fname


def test_progress_zero_is_a_reading_not_an_absence():
    """`progress=0` 是文档真写了 0%。播种按 `_reading_absent` 判在场，写成真值性
    （`not 0` 为真）会把它当缺席跳过 —— 与 `_note_conflicts` 上那条 ⚠ 同一个坑。"""
    assert "progress" in _fields(_project(progress=0))
    assert "progress" not in _fields(_project())


def test_identity_and_derived_keys_are_deliberately_not_tracked():
    """身份与派生 join key **不进**血缘：删掉一份文档不该让一张卡改名，`ownerId` 是
    `_link_owners` 解出来的、不是一条读数，`self_report` **自带出处**（再记一份就是两份抄本）。"""
    pr = _project(ownerId="u_zhou", ownerName=OLD_OWNER)
    p = _person(person_id="MKT-001", archived=True,
                self_report=PersonSelfReport(load=SelfReportLoad(value=70, source=f"{OLD_DOC}:9")))
    forbidden = {"id", "name", "title", "source", "person_id", "ownerId", "archived",
                 "provenance", "lineage", "self_report"}
    assert not (set(_fields(pr)) & forbidden) and not (set(_fields(p)) & forbidden)
    assert "ownerName" in _fields(pr), "对照基准：真被跟的那一格确实在，上面那条不是空真"


def test_a_hand_added_card_has_no_document_lineage_at_all(tmp_path):
    """手编卡（`um-…`/`pm-…`，`source` 恒空）血缘为空 —— 这**就是**正确答案：没有任何文档
    喂过它，所以删光所有文档也不该动它一根汗毛。

    走**真的**手编端点（`add_person`/`add_project`），不是手搭一个空 dataclass：这一条要证的
    是那条产品路径上的性质。⚠ 空 lineage 有两种成因（手编卡 / 没有出处的老卡），区分它们要看
    `provenance`，不要看 lineage —— 这句话写在 `_init_lineage` 里，这里只钉手编那一半。
    """
    from avery.ingest.registry import CompanyContext
    from avery.ingest.store import KeywordStore
    reg = ContextRegistry()
    reg.put(CompanyContext(context_id="c_manual", extraction=ExtractionResult(),
                           store=KeywordStore(), memory_dir=tmp_path))
    p = reg.add_person("c_manual", {"name": "陈静", "role": "前厅主管"})
    pr = reg.add_project("c_manual", {"title": "手加的项目", "status": "on-track"})
    assert p.lineage == {} and pr.lineage == {}
    assert p.provenance["role"]["origin"] == "manual", (
        "对照基准：手编出处照旧要写下来 —— 血缘为空不是因为这条路什么都没记")


def test_a_stored_card_from_before_87_gets_its_lineage_backfilled_on_read():
    """存量兜底：#87 之前落库的卡没有 lineage 键，`_entity` 回读时走同一条播种路补上。

    ⚠ 打 `seeded` 标是因为它是**推**出来的：`docs` 只有一条时逐格精确，多于一条时
    enrichment 来的那几格可能记错文档 —— 消费方自己决定信不信。
    """
    legacy = {"id": "u_old", "name": "周雅婷", "role": "市场专员", "team": "市场推广部",
              "source": f"{OLD_DOC}:4"}                       # 没有 lineage 键 = #87 之前的行
    p = PersonEntity(**legacy)
    assert _docs(p) == [OLD_DOC]
    assert _cell(p, "role") == {"source": f"{OLD_DOC}:4", "seeded": True}


def test_a_hand_edited_cell_is_never_claimed_by_a_document_on_reload():
    """🔴 兜底的红线：手编/表单写过的格子**不认领**。

    否则一张文档卡上经理手填的那一格，会在下一次 `get()` 回读时被推成「某份文档说的」——
    一句凭空造出来的出处，而且它会一直待在卡上没人查得出来。
    """
    stored = {"id": "u_old", "name": "周雅婷", "role": "市场专员", "team": "前厅部",
              "source": f"{OLD_DOC}:4",
              "provenance": {"team": {"origin": "manual", "source": "手动编辑"}}}
    p = PersonEntity(**stored)
    assert "team" not in _fields(p), "经理手填的部门被推成了一份文档的读数"
    assert "role" in _fields(p), "对照基准：文档读到的那一格照旧要被推出来"


def test_seeding_never_overwrites_a_lineage_that_is_already_written():
    """写路记下来的记录（不带 `seeded`）必须原样活过一次 pg 往返。

    判据落在**记录本身**：`fields` 键在场就整段不碰。写成「只要 docs 非空就不播种」会在
    「只 absorb_sources 过、还没有 fields」的卡上永远不播种。
    """
    written = {"id": "u_old", "name": "周雅婷", "role": "市场经理", "source": f"{OLD_DOC}:4",
               "lineage": {"docs": [OLD_DOC, NEW_DOC],
                           "fields": {"role": {"source": f"{NEW_DOC}:9",
                                               "prev": {"value": "市场专员",
                                                        "source": f"{OLD_DOC}:4"}}}}}
    p = PersonEntity(**written)
    assert _cell(p, "role") == {"source": f"{NEW_DOC}:9",
                                "prev": {"value": "市场专员", "source": f"{OLD_DOC}:4"}}
    assert _docs(p) == [OLD_DOC, NEW_DOC]


def test_a_round_trip_through_asdict_is_byte_identical():
    """`pg_registry.put()` 写的是 `asdict(entity)`、回读走 `Entity(**payload)`。血缘在这条
    路上必须是不动点 —— 否则每存一次就漂一次，而离线套一个字都看不见。"""
    _sentinels_cover_every_tracked_field()
    for kind in ("person", "project"):
        cls = PersonEntity if kind == "person" else ProjectEntity
        one = _make(kind, _SENTINEL_A, OLD_DOC, line=5)
        two = cls(**asdict(one))
        three = cls(**asdict(two))
        assert one.lineage == two.lineage == three.lineage, kind


# =============================================================================================
# §2 · 归并（上传路）—— 谁填的那一格就归谁
# =============================================================================================

def test_the_document_that_enriched_a_cell_owns_that_cell():
    """keep-first 的 enrichment：花名册给了身份、纪要补上了部门 —— 那一格的血缘是**纪要**那一行。

    🔴 退回「活下来那条实体的整条 source」就是 `_append_conflict` 那条 ⚠ 讲的
    「引用一份从没说过这件事的文档」，换到血缘这一侧：卡上会说「部门来自项目台账」，
    而项目台账一个字都没提过部门。
    """
    res = ExtractionResult(people=[
        _person(role="市场专员", doc=OLD_DOC, line=4),
        _person(team="前厅部", doc=NEW_DOC, line=9),
    ])
    _dedupe_entities(res)
    survivor = res.people[0]
    assert survivor.role == "市场专员" and survivor.team == "前厅部"
    assert _cell(survivor, "role")["source"] == f"{OLD_DOC}:4"
    assert _cell(survivor, "team") == {"source": f"{NEW_DOC}:9"}, (
        "补上这一格的是纪要，而且这是**记**下来的不是推出来的（不带 seeded）")


def test_a_reading_that_lost_keep_first_still_names_its_document():
    """🔴 输给 keep-first 的读数**照样**把它那份文档记进 `docs`。

    `docs` 答的是「删光之后这张卡还有没有文档依据」。把输家漏掉，删掉胜出那份文档时，
    一张仍有依据的卡会被判成无依据。对照基准写成 1 → 2（销毁/收缩类判据必须有基准，
    否则「集合里有两条」这种断言在实现根本没跑时也能凑巧成立）。
    """
    res = ExtractionResult(people=[
        _person(team="市场推广部", doc=OLD_DOC, line=4),
        _person(team="前厅部", doc=NEW_DOC, line=9),      # 同一格、输掉、连出处一起蒸发
    ])
    assert _docs(res.people[0]) == [OLD_DOC], "基准：合并前只认得自己那一份"
    _dedupe_entities(res)
    survivor = res.people[0]
    assert survivor.team == "市场推广部", "keep-first 的行为一个字节都不许变"
    assert _docs(survivor) == [OLD_DOC, NEW_DOC]
    assert _cell(survivor, "team")["source"] == f"{OLD_DOC}:4", (
        "输家进 docs，但**不许**改写这一格的血缘 —— 卡上那个值仍是花名册给的")


@pytest.mark.parametrize("kind", ["person", "project"])
def test_every_unioned_cell_records_the_document_that_added_to_it(kind):
    """并集字段（owns/collaboration/blockers/dependsOn）：添了东西的那份文档接管这一格。"""
    _sentinels_cover_every_tracked_field()
    first = _make(kind, _SENTINEL_A, OLD_DOC, line=4)
    second = _make(kind, _SENTINEL_B, NEW_DOC, line=9)
    res = (ExtractionResult(people=[first, second]) if kind == "person"
           else ExtractionResult(projects=[first, second]))
    _dedupe_entities(res)
    survivor = (res.people if kind == "person" else res.projects)[0]
    for fname in _APPEND_UNIONED[kind]:
        assert _cell(survivor, fname) == {"source": f"{NEW_DOC}:9"}, fname
    for fname in _APPEND_REFRESHABLE[kind]:
        assert _cell(survivor, fname)["source"] == f"{OLD_DOC}:4", (
            f"{fname} 是 keep-first 赢下来的，血缘不该被后来的读数改写")


ROSTER = "\n".join([
    "# 别墅酒店 员工花名册", "",
    "姓名 | 人员ID | 部门 | 职位 | 司龄",
    "周雅婷 | MKT-001 | 市场推广部 | 市场专员 | 3年",
])
LEDGER_V1 = "\n".join([f"# {TITLE}", f"负责人：{OLD_OWNER}", "状态：进行中", "截止：2026-09-30"])
# ⚠ 最后那句散文行不是装饰：没有它这份文档**一个材料块都不切**（标签行全被项目卡吃掉了），
# 于是「删掉之后原话搜不到了」那条对照基准会退化成 0 → 0 的空真。票面的故事也正是这一句。
LEDGER_V2 = "\n".join([f"# {TITLE}", f"负责人：{NEW_OWNER}", "状态：受阻", "阻塞：雨季无备选场地",
                       "", f"本次旺季排班协调会决定，由宴会部{NEW_OWNER}接手{TITLE}的现场排班。"])


def _write(tmp: Path, name: str, text: str) -> Path:
    p = tmp / name
    p.write_text(text, encoding="utf-8")
    return p


def _sd(path: Path, uploaded_at: str, source_key: str | None = None) -> SourceDocument:
    return SourceDocument(filename=path.name, source_key=source_key or path.name,
                          mime="text/markdown", size_bytes=path.stat().st_size,
                          content=path.read_bytes(), uploaded_at=uploaded_at)


def _seed(tmp: Path, reg: ContextRegistry, cid: str = "ctx_t87") -> str:
    """第一批资料走**真正的** /ingest 那条路（`ingest_paths`）。"""
    files = [_write(tmp, "员工花名册.md", ROSTER), _write(tmp, OLD_DOC, LEDGER_V1)]
    rep = ingest_paths([str(p) for p in files], registry=reg, work_dir=tmp / "mem",
                       context_id=cid, name="别墅酒店", owner_token="tok_t87",
                       source_documents=[_sd(p, OLD_AT) for p in files])
    assert rep.ok, "种子语料自己就没进去，下面的断言什么都证明不了"
    ctx = reg.get(cid)
    assert ctx.extraction.people and ctx.extraction.projects, (
        "种子语料抽不出人/项目 —— 判据够不着，整段是假绿")
    return cid


def _append(tmp: Path, reg: ContextRegistry, cid: str, name: str, text: str, at: str = NEW_AT):
    p = _write(tmp, name, text)
    return append_paths_to_context(reg, cid, [str(p)], [_sd(p, at)])


def test_a_real_pipeline_run_writes_the_lineage_onto_a_real_card(tmp_path):
    """可达性证明：走**真 pipeline**（`ingest_paths` → 解析 → 抽取 → 归并），真中文资料喂出来的
    卡上血缘真的在。上面那些手搭 dataclass 的断言全靠这一条兜底 —— 否则整段可能只是在
    测一个真实链路上根本走不到的形状。"""
    reg = ContextRegistry()
    cid = _seed(tmp_path, reg)
    ctx = reg.get(cid)
    project = next(pr for pr in ctx.extraction.projects if pr.title == TITLE)
    assert _docs(project) == [OLD_DOC]
    assert _cell(project, "ownerName")["source"].startswith(f"{OLD_DOC}:")
    person = next(p for p in ctx.extraction.people if p.name == "周雅婷")
    assert _docs(person) == ["员工花名册.md"]
    assert _cell(person, "team")["source"].startswith("员工花名册.md:")


# =============================================================================================
# §3 · 补传 —— 每一次 setattr 之前先拍照（票 7「逐条撤回」的全部地基）
# =============================================================================================

def test_a_newer_document_records_the_reading_it_destroys():
    """票面那句话的可执行版本：旧值在 `absorb` 里被 `setattr` 抹掉，无历史无 journal。
    现在它被拍下来了 —— 值 + 它那份资料的哪一行。"""
    pr = _project(ownerName=OLD_OWNER, doc=OLD_DOC, line=7)
    res = ExtractionResult(projects=[pr])
    merge_project_reading([pr], _project(ownerName=NEW_OWNER, doc=NEW_DOC, line=12),
                          ledger=_ledger(res))
    assert pr.ownerName == NEW_OWNER, "安静更新的行为一个字节都不许变（拍板③）"
    assert _cell(pr, "ownerName")["source"] == f"{NEW_DOC}:12"
    assert _cell(pr, "ownerName")["prev"] == {
        "value": OLD_OWNER, "source": f"{OLD_DOC}:7", "seeded": True}


def test_enrichment_records_no_prev_because_nothing_was_destroyed():
    """空格子被填上不是覆盖，是补全 —— 没有任何读数被毁掉，就不该有 prev（absent≠none）。"""
    pr = _project(doc=OLD_DOC)
    res = ExtractionResult(projects=[pr])
    merge_project_reading([pr], _project(status="blocked", doc=NEW_DOC, line=12), ledger=_ledger(res))
    assert pr.status == "blocked"
    assert "prev" not in _cell(pr, "status") and _cell(pr, "status")["source"] == f"{NEW_DOC}:12"


def test_a_restated_value_does_not_churn_the_lineage():
    """一份新资料复述了同一个值 —— 什么都没变，血缘就不该动（与 provenance 同一条口径）。
    但那份文档**照样**进 `docs`：它确实谈过这张卡。"""
    pr = _project(status="on-track", doc=OLD_DOC, line=7)
    res = ExtractionResult(projects=[pr])
    merge_project_reading([pr], _project(status="on-track", doc=NEW_DOC, line=12), ledger=_ledger(res))
    assert _cell(pr, "status") == {"source": f"{OLD_DOC}:7", "seeded": True}
    assert _docs(pr) == [OLD_DOC, NEW_DOC]


def test_an_older_document_that_loses_leaves_the_lineage_alone():
    """补传的**不一定**是更新的资料。旧的顶不掉新的，血缘也不许被它改写 —— 否则卡上的值来自
    A、血缘却指着 B，比没有血缘更坏。"""
    pr = _project(status="blocked", doc=NEW_DOC, line=12)
    res = ExtractionResult(projects=[pr])
    merge_project_reading([pr], _project(status="on-track", doc=OLD_DOC, line=7),
                          ledger=_ledger(res))
    assert pr.status == "blocked"
    assert _cell(pr, "status") == {"source": f"{NEW_DOC}:12", "seeded": True}
    assert "prev" not in _cell(pr, "status")


def test_a_hand_edited_cell_keeps_its_document_lineage_and_gains_no_prev():
    """手编赢（ADR-0028）：文档顶不动这一格，所以毁掉的东西是零 —— 不记 prev。
    那份文档仍然进 `docs`（它谈过这张卡），而这一格的**文档**血缘原样不动
    （血缘答「文档出处」，provenance 答「现在归谁」，两个问题不许互相覆盖）。"""
    pr = _project(status="on-track", doc=OLD_DOC, line=7)
    pr.provenance["status"] = {"origin": "manual", "source": "手动编辑", "updated_at": ""}
    res = ExtractionResult(projects=[pr])
    merge_project_reading([pr], _project(status="blocked", doc=NEW_DOC, line=12), ledger=_ledger(res))
    assert pr.status == "on-track", "手编赢的行为一个字节都不许变"
    assert _cell(pr, "status") == {"source": f"{OLD_DOC}:7", "seeded": True}
    assert _docs(pr) == [OLD_DOC, NEW_DOC]


@pytest.mark.parametrize("kind", ["person", "project"])
def test_every_refreshable_cell_records_a_prev_when_a_newer_document_displaces_it(kind):
    """🔴 **逐格**：`_APPEND_REFRESHABLE` 里每一个格子被顶掉时都要留下旧值。

    一条变异红一条判据 ≠ 它也能红旁边那条（#86 实收）。所以这里不挑一个代表字段，
    而是把两套哨兵推进 `absorb`，对**每一格**各判一次：写成 `if fname == "ownerName"` 那种
    单格特判，或者漏掉 `risk`/`milestones`，都会在这里当场红。
    """
    _sentinels_cover_every_tracked_field()
    cur = _make(kind, _SENTINEL_A, OLD_DOC, line=4)
    res = (ExtractionResult(people=[cur]) if kind == "person" else ExtractionResult(projects=[cur]))
    merge = merge_person_reading if kind == "person" else merge_project_reading
    holder = res.people if kind == "person" else res.projects
    merge(holder, _make(kind, _SENTINEL_B, NEW_DOC, line=9), ledger=_ledger(res))
    for fname in _APPEND_REFRESHABLE[kind]:
        rec = _cell(cur, fname)
        assert rec.get("source") == f"{NEW_DOC}:9", f"{fname} 的血缘没指向新资料"
        prev = rec.get("prev") or {}
        assert prev.get("source") == f"{OLD_DOC}:4", f"{fname} 没记下被它毁掉的那条读数"
        assert prev.get("value") == _jsonish(_SENTINEL_A[kind][fname]), fname


@pytest.mark.parametrize("kind", ["person", "project"])
def test_every_unioned_cell_records_the_list_it_replaced(kind):
    """并集字段的 prev 是**补料之前那张完整列表** —— 撤回一次补料要还原成它。

    ⚠ 已知边界（票面点名）：`[:6]` 会把这一趟第 7 项起扔掉，prev 还原得回补料前那张，
    但被截掉的新条目谁也捡不回来。见 test_the_union_cap_is_lossy_forward_only。
    """
    _sentinels_cover_every_tracked_field()
    cur = _make(kind, _SENTINEL_A, OLD_DOC, line=4)
    res = (ExtractionResult(people=[cur]) if kind == "person" else ExtractionResult(projects=[cur]))
    merge = merge_person_reading if kind == "person" else merge_project_reading
    holder = res.people if kind == "person" else res.projects
    merge(holder, _make(kind, _SENTINEL_B, NEW_DOC, line=9), ledger=_ledger(res))
    for fname in _APPEND_UNIONED[kind]:
        prev = _cell(cur, fname).get("prev") or {}
        assert prev.get("value") == list(_SENTINEL_A[kind][fname]), fname
        assert getattr(cur, fname) == list(_SENTINEL_A[kind][fname]) + list(_SENTINEL_B[kind][fname])


def test_prev_holds_a_json_native_value_even_for_risk_and_milestones():
    """🔴 `prev.value` 必须与 jsonb 往返**对称**：内存里存 `ProjectRisk` 对象、库里回来是 dict，
    正是 `risk`/`milestones` 当年在持久化那条路上炸掉的形状（rich-align-0722）。血缘是没有
    强转的 side-car，所以只能在写入那一刻就拍平 —— 两条腿由构造相同。"""
    pr = _project(risk=ProjectRisk(level="low", reason="备选场地已锁"),
                  milestones=[ProjectMilestone("一期", "done")], doc=OLD_DOC, line=7)
    res = ExtractionResult(projects=[pr])
    merge_project_reading([pr], _project(risk=ProjectRisk(level="high", reason="雨季无备选场地"),
                                         milestones=[ProjectMilestone("二期", "active")],
                                         doc=NEW_DOC, line=12), ledger=_ledger(res))
    risk_prev = _cell(pr, "risk")["prev"]["value"]
    ms_prev = _cell(pr, "milestones")["prev"]["value"]
    assert risk_prev == {"level": "low", "reason": "备选场地已锁"}
    assert ms_prev == [{"name": "一期", "status": "done", "statusRaw": ""}]
    assert not any(hasattr(x, "__dataclass_fields__") for x in (risk_prev, *ms_prev))


def test_the_prev_chain_walks_back_through_three_appends_in_order():
    """三份资料先后改同一格 —— 链从最新往回走，一环一份资料。撤回一次就退一环。"""
    pr = _project(status="v1", doc="a.md", line=1)
    res = ExtractionResult(projects=[pr])
    stamps = (("a.md", "2026-08-01T00:00:00+00:00"), ("b.md", "2026-08-02T00:00:00+00:00"),
              ("c.md", "2026-08-03T00:00:00+00:00"))
    for doc, value in (("b.md", "v2"), ("c.md", "v3")):
        merge_project_reading([pr], _project(status=value, doc=doc, line=2),
                              ledger=_ledger(res, *stamps))
    assert pr.status == "v3"
    rec = _cell(pr, "status")
    assert (rec["source"], rec["prev"]["value"], rec["prev"]["source"]) == ("c.md:2", "v2", "b.md:2")
    assert (rec["prev"]["prev"]["value"], rec["prev"]["prev"]["source"]) == ("v1", "a.md:1")
    assert "prev" not in rec["prev"]["prev"], "链到第一份资料就到头了"


def test_the_chain_is_capped_and_says_so_where_it_cuts():
    """🔴 链有上限（jsonb 装得下不等于该无限长），砍掉的是**最老**的一头，砍处打
    `truncated: True`。

    静默截断会让「第 N 次之前的旧值还在」读成一句真话 —— 与 `[:6]` 那条并集截断同一族的
    错误，只是这一次我们自己有得选。所以判据不是「链不超过 N 环」，而是「超了要说出来」。
    """
    docs = [(f"d{i}.md", f"2026-08-{i + 1:02d}T00:00:00+00:00") for i in range(_LINEAGE_CHAIN_DEPTH + 3)]
    pr = _project(status="v0", doc=docs[0][0], line=1)
    res = ExtractionResult(projects=[pr])
    for i, (doc, _at) in enumerate(docs[1:], start=1):
        merge_project_reading([pr], _project(status=f"v{i}", doc=doc, line=1),
                              ledger=_ledger(res, *docs))
    depth, link, cut = 0, _cell(pr, "status").get("prev"), False
    while isinstance(link, dict):
        depth += 1
        cut = cut or bool(link.get("truncated"))
        link = link.get("prev")
    assert depth == _LINEAGE_CHAIN_DEPTH, f"链长 {depth}，上限是 {_LINEAGE_CHAIN_DEPTH}"
    assert cut, "链被砍了却没说 —— 消费方会以为最老那一环就是第一份资料"
    assert _cell(pr, "status")["prev"]["value"] == f"v{len(docs) - 2}", "砍的必须是最老那一头"


def test_the_union_cap_is_lossy_forward_and_the_prev_still_restores_the_old_list():
    """票面点名的那笔账，写成一条可执行的话：并集 `[:6]` 会把这一趟第 7 项起**扔掉**
    （撤回撤不回它们），但 prev 仍然还原得回补料**之前**那张列表。
    UI 上因此不该给这些字段一枚看起来无损的撤回钮。"""
    held = [f"旧{i}" for i in range(5)]
    pr = _project(blockers=list(held), doc=OLD_DOC, line=7)
    res = ExtractionResult(projects=[pr])
    merge_project_reading([pr], _project(blockers=["新A", "新B", "新C"], doc=NEW_DOC, line=12),
                          ledger=_ledger(res))
    assert pr.blockers == held + ["新A"], "6 上限：新来的第 2、3 条被静默扔掉了"
    assert _cell(pr, "blockers")["prev"]["value"] == held, "prev 还原得回补料前那张"
    assert "新B" not in repr(pr.lineage), "被截掉的那两条哪儿都没留下 —— 这就是那笔不可恢复的账"


def test_retracting_ownerName_is_not_one_field():
    """票面第二笔账的可执行版本：`ownerName` 被顶掉时 `ownerId` 一并被清空
    （由 `_link_owners` 重连）。票 7 光把名字写回去，信号还挂在错的人身上。"""
    pr = _project(ownerId="u_laozhou", ownerName=OLD_OWNER, doc=OLD_DOC, line=7)
    res = ExtractionResult(projects=[pr])
    merge_project_reading([pr], _project(ownerName=NEW_OWNER, doc=NEW_DOC, line=12),
                          ledger=_ledger(res))
    assert pr.ownerName == NEW_OWNER and pr.ownerId == "", "行为一个字节没变"
    assert _cell(pr, "ownerName")["prev"]["value"] == OLD_OWNER
    assert "ownerId" not in _fields(pr), (
        "ownerId 是派生 join key，不是一条读数 —— 它没有独立血缘，所以撤回不是写回一个字段")


# =============================================================================================
# §4 · batch_id —— 「这一批」的确定性名字（票 7 的「撤回这一批」靠它，不靠猜）
# =============================================================================================

def test_the_batch_id_is_deterministic_and_names_the_file_set():
    """确定性，不是 uuid：同一批文件重放出同一个 id。测试断得了它，也不给这条路引进一个
    墙上时钟／随机源（#82 的钟炸弹是同族教训）。"""
    assert batch_id_for(["b.md", "a.md"]) == batch_id_for(["a.md", "b.md"]) != ""
    assert batch_id_for(["a.md"]) != batch_id_for(["a.md", "b.md"])
    assert batch_id_for([]) == batch_id_for([" ", None]) == "", "空批次不发键（absent≠none）"


def test_only_the_cells_this_batch_wrote_carry_its_batch_id():
    """batch_id 只落在**这一趟真写过**的格子上。落在没写过的格子上，票 7 会把一格从没被
    这批资料碰过的值也算进「撤回这一批」。"""
    pr = _project(status="on-track", summary="老摘要", doc=OLD_DOC, line=7)
    res = ExtractionResult(projects=[pr])
    merge_project_reading([pr], _project(status="blocked", doc=NEW_DOC, line=12),
                          ledger=_ledger(res, batch=[NEW_DOC]))
    assert _cell(pr, "status")["batch_id"] == batch_id_for([NEW_DOC])
    assert "batch_id" not in _cell(pr, "summary"), "这一批没碰过摘要"


def test_the_ledger_batch_is_the_new_files_not_the_whole_library(tmp_path):
    """🔴 `AppendLedger` 的两个参数问的是**两件事**：`source_documents` 是时刻表（要全表，
    只给新来的会让每次比较都退回 keep-first），`batch_keys` 是「这一批是谁」。把全表传给
    第二个，每一批就都叫同一个名字，「撤回这一批」当场失效。"""
    reg = ContextRegistry()
    cid = _seed(tmp_path, reg)
    rep = _append(tmp_path, reg, cid, NEW_DOC, LEDGER_V2)
    assert rep.ok, rep.parse_errors
    pr = next(x for x in reg.get(cid).extraction.projects if x.title == TITLE)
    assert _cell(pr, "ownerName")["batch_id"] == batch_id_for([NEW_DOC]), (
        "批次号必须只认这一趟新来的那份文件")
    assert _cell(pr, "ownerName")["batch_id"] != batch_id_for(
        [sd.source_key for sd in reg.get(cid).source_documents])


# =============================================================================================
# §5 · 主链（离线集成）+ 与 #77 那条裁定的关系
# =============================================================================================

def test_the_real_append_chain_lands_the_lineage_on_the_stored_card(tmp_path):
    """走真链路：`append_paths_to_context` → get → 原地 mutate → put。血缘要活到
    `reg.get()` 回来的那一份上（写在活对象上却没落库，离线内存腿看不出差别）。"""
    reg = ContextRegistry()
    cid = _seed(tmp_path, reg)
    before = next(x for x in reg.get(cid).extraction.projects if x.title == TITLE)
    assert _docs(before) == [OLD_DOC] and before.ownerName == OLD_OWNER, "基准：补料之前"

    assert _append(tmp_path, reg, cid, NEW_DOC, LEDGER_V2).ok
    after = next(x for x in reg.get(cid).extraction.projects if x.title == TITLE)
    assert after.ownerName == NEW_OWNER
    assert _docs(after) == [OLD_DOC, NEW_DOC]
    rec = _cell(after, "ownerName")
    assert rec["source"].startswith(f"{NEW_DOC}:") and rec["prev"]["value"] == OLD_OWNER
    assert rec["prev"]["source"].startswith(f"{OLD_DOC}:")


def test_the_wire_contract_for_provenance_is_untouched(tmp_path):
    """🔴 血缘**没有**挤进 `provenance`，这条判据是那个决定的守门人。

    `_one_person_card`/`_one_project_card` 把 `dict(provenance)` **原样**投给浏览器，而
    `LiveFieldProvenance`（transport.ts）是 `{origin, source, updated_at}` 的闭契约；往里加键
    等于让载荷违约，而前端不报错、只是不显示。同时 `lineage` 也**不该**被投出去（本票是纯后端
    地基，投影归 #85／票 7）。
    """
    reg = ContextRegistry()
    cid = _seed(tmp_path, reg)
    assert _append(tmp_path, reg, cid, NEW_DOC, LEDGER_V2).ok
    ctx = reg.get(cid)
    cards = ctx.project_cards() + ctx.team_cards()
    assert cards, "一张卡都没投出来 —— 下面两条是空真"
    touched = [c for c in cards if c.get("provenance")]
    assert touched, "补料之后一张带出处的卡都没有 —— 判据够不着"
    for card in cards:
        for rec in (card.get("provenance") or {}).values():
            assert set(rec) <= {"origin", "source", "updated_at"}, f"provenance 载荷违约：{rec}"
        assert "lineage" not in card, "血缘是后端地基，本票不上线"


def test_deleting_a_document_still_keeps_the_cards_and_now_says_what_it_would_take(tmp_path):
    """#77 的裁定原样成立（本票只做地基），但它的**前提变了**——写成一条会说话的判据。

    删掉《旺季排班协调纪要.md》之后：
      · 卡还在、`ownerName` 还是「小马」——`test_file_delete_t77::test_delete_keeps_the_person_cards`
        钉的是同一件事，本票一个字节都没改它；
      · 但**收回它需要的全部信息现在就在卡上**：哪一格是那份文档给的、它顶掉的旧值是什么、
        那份文档还有没有别的格子。这就是「地基」两个字的可执行含义。
    剩下的三条（冲突重选胜者需要产品拍板 · ownerName 撤回不是一个字段 · 并集 [:6] 不可逆）
    写在 `file_delete.py` 头，是后续票的入口。
    """
    reg = ContextRegistry()
    cid = _seed(tmp_path, reg)
    assert _append(tmp_path, reg, cid, NEW_DOC, LEDGER_V2).ok
    ctx = reg.get(cid)
    before_materials = len(ctx.extraction.materials)

    rep = delete_document_from_context(reg, cid, NEW_DOC)
    assert rep.ok and rep.materials_removed > 0, "对照基准：材料面确实被收走了"
    ctx = reg.get(cid)
    assert len(ctx.extraction.materials) < before_materials

    pr = next(x for x in ctx.extraction.projects if x.title == TITLE)
    assert pr.ownerName == NEW_OWNER, "#77 的裁定：卡不随文档收缩（本票不改它）"
    assert f"Project '{TITLE}' (owner: {NEW_OWNER})" in \
        (ctx.memory_dir / "facts.md").read_text(encoding="utf-8"), \
        "票面那句话的原样复现：顾问仍然引得到一个证据已经删掉的结论"

    # ——— 而地基已经在了：删掉的那份文档在卡上留下了完整的、可执行的账 ———
    rec = _cell(pr, "ownerName")
    assert rec["source"].startswith(f"{NEW_DOC}:"), "这一格是被删那份文档给的"
    assert rec["prev"]["value"] == OLD_OWNER, "收回之后该退回哪个值，卡上写着"
    assert rec["prev"]["source"].startswith(f"{OLD_DOC}:"), "退回去之后出处指哪儿，卡上也写着"
    assert NEW_DOC in _docs(pr) and OLD_DOC in _docs(pr), (
        "这张卡还有别的文档撑着 —— 所以它该收缩而不是整张消失")


def test_a_card_backed_only_by_the_deleted_document_is_now_identifiable(tmp_path):
    """另一半：只由这一份文档喂出来的卡，删掉之后 `docs` 里除了它一无所有 —— 「整张该走」
    与「只该收缩一格」从此分得开。#77 当年分不开，所以两种都不动。"""
    reg = ContextRegistry()
    cid = _seed(tmp_path, reg)
    ctx = reg.get(cid)
    person = next(p for p in ctx.extraction.people if p.name == "周雅婷")
    project = next(x for x in ctx.extraction.projects if x.title == TITLE)
    assert _docs(person) == ["员工花名册.md"] and _docs(project) == [OLD_DOC]
    assert set(_docs(person)) != set(_docs(project)), (
        "两张卡各由不同的一份文档喂出来 —— 删掉其中一份，另一张不该被牵连")


# =============================================================================================
# §6 · @needs_db —— 真库那一层
#
# ⚠ 离线套对 pg 持久层是瞎的，而且它会以**全绿**的形态骗你（#86 又实收一次）。本节要证三件
#    离线永远证不了的事：① 0009 的 allowlist 认得 `lineage` 这个**顶层**键（少一个字就是一条
#    只在生产上炸的写入，0002 的 8 键 allowlist 就这么炸过）；② 血缘真的活过一次
#    DELETE+INSERT 快照替换；③ `prev.value` 在两条腿上是**同一个形状**（内存腿 dataclass、
#    pg 腿 dict 的那口老坑，`_jsonable` 就是为它写的）。
# =============================================================================================

def _db_url() -> str | None:
    import os
    return (os.environ.get("AVERY_DB_URL") or os.environ.get("PGVECTOR_URL") or "").strip() or None


def _skip_without_db() -> str:
    url = _db_url()
    if not url:
        pytest.skip("needs AVERY_DB_URL (or PGVECTOR_URL) pointing at a Postgres")
    pytest.importorskip("psycopg")
    return url


@needs_db
def test_the_person_allowlist_admits_a_full_person_carrying_lineage(tmp_path):
    """0009 的 CHECK 是**结构性红线**：不在 PersonEntity 字段表里的顶层键一律拒。
    `pg_registry.put()` 写的是 `asdict(PersonEntity)`——它**恒**发出每一个字段（`lineage` 哪怕
    是空 dict 也在），所以 allowlist 少一个字 = 每一条真人写入在生产上被库拒掉。"""
    url = _skip_without_db()
    import psycopg
    from psycopg.types.json import Jsonb
    from avery.ingest.pg_registry import PostgresContextRegistry
    reg = PostgresContextRegistry(url, data_dir=tmp_path / "data")
    cid = "ctx_t87_allow"
    files = [_write(tmp_path, "员工花名册.md", ROSTER)]
    try:
        assert ingest_paths([str(p) for p in files], registry=reg, work_dir=tmp_path / "mem",
                            context_id=cid, name="别墅酒店", owner_token="tok87",
                            source_documents=[_sd(p, OLD_AT) for p in files]).ok
        rich = asdict(PersonEntity(
            id="u_lineage", name="血缘先生", role="Lead", source=f"{OLD_DOC}:3",
            lineage={"docs": [OLD_DOC, NEW_DOC],
                     "fields": {"role": {"source": f"{NEW_DOC}:9", "batch_id": "b-deadbeef",
                                         "prev": {"value": "Analyst",
                                                  "source": f"{OLD_DOC}:3"}}}}))
        assert "lineage" in rich, "asdict 都没发出 lineage —— 这条判据在测一个不存在的键"
        with psycopg.connect(url) as conn, conn.transaction():
            conn.execute("INSERT INTO avery.entities (context_id, kind, idx, payload) "
                         "VALUES (%s, 'person', 9987, %s)", (cid, Jsonb(rich)))
        # 对照基准：护城河没被这次放宽捅漏 —— 表外的顶层键照旧被库拒掉。
        with psycopg.connect(url) as conn:
            with pytest.raises(psycopg.errors.CheckViolation):
                with conn.transaction():
                    conn.execute("INSERT INTO avery.entities (context_id, kind, idx, payload) "
                                 "VALUES (%s, 'person', 9986, %s)",
                                 (cid, Jsonb({"name": "Mallory", "绩效评分": 88})))
    finally:
        reg.delete(cid)


@needs_db
def test_lineage_survives_a_real_snapshot_replace(tmp_path):
    """`put()` 是 DELETE+INSERT 整快照替换、`get()` 走 `Entity(**payload)`。血缘要在这条路上
    逐字活下来 —— 内存腿的 `get()` 返回的是同一个活对象，「还在」是必然，证明不了任何事。"""
    url = _skip_without_db()
    from avery.ingest.pg_registry import PostgresContextRegistry
    reg = PostgresContextRegistry(url, data_dir=tmp_path / "data")
    cid = "ctx_t87_rt"
    try:
        _seed(tmp_path, reg, cid)
        assert _append(tmp_path, reg, cid, NEW_DOC, LEDGER_V2).ok
        fresh = PostgresContextRegistry(url, data_dir=tmp_path / "data2").get(cid)
        pr = next(x for x in fresh.extraction.projects if x.title == TITLE)
        assert _docs(pr) == [OLD_DOC, NEW_DOC], "来源文档集合没活过真库往返"
        rec = _cell(pr, "ownerName")
        assert rec["source"].startswith(f"{NEW_DOC}:")
        assert rec["prev"]["value"] == OLD_OWNER and rec["prev"]["source"].startswith(f"{OLD_DOC}:")
        assert rec["batch_id"] == batch_id_for([NEW_DOC])
        person = next(p for p in fresh.extraction.people if p.name == "周雅婷")
        assert _cell(person, "team")["source"].startswith("员工花名册.md:"), (
            "人卡那一侧也要活下来 —— 两个 kind 各写各的一列 payload")
    finally:
        reg.delete(cid)


@needs_db
def test_prev_holds_the_same_shape_on_both_legs(tmp_path):
    """🔴 `prev.value` 里的 `risk`/`milestones` 在**内存腿**与**pg 腿**上必须是同一个形状。

    这正是 rich-align-0722 那口老坑的形状：内存里是 dataclass、库里回来是 dict，于是消费方
    `v["level"]` 与 `v.level` 二选一，**只在持久化那条路上**炸。血缘是没有强转的 side-car，
    所以 `_jsonable` 在写入那一刻就消除这个差别 —— 这条判据是那句话的裁判。
    """
    url = _skip_without_db()
    from avery.ingest.pg_registry import PostgresContextRegistry
    reg = PostgresContextRegistry(url, data_dir=tmp_path / "data")
    cid = "ctx_t87_shape"
    try:
        _seed(tmp_path, reg, cid)
        ctx = reg.get(cid)
        pr = next(x for x in ctx.extraction.projects if x.title == TITLE)
        pr.risk = ProjectRisk(level="low", reason="备选场地已锁")
        pr.milestones = [ProjectMilestone("一期", "done")]
        res = ExtractionResult(projects=[pr])
        merge_project_reading(
            [pr], _project(title=TITLE, risk=ProjectRisk(level="high", reason="雨季无备选场地"),
                           milestones=[ProjectMilestone("二期", "active")], doc=NEW_DOC, line=12),
            ledger=_ledger(res, batch=[NEW_DOC]))
        in_memory = {f: _cell(pr, f)["prev"]["value"] for f in ("risk", "milestones")}
        reg.put(ctx)
        fresh = PostgresContextRegistry(url, data_dir=tmp_path / "data2").get(cid)
        again = next(x for x in fresh.extraction.projects if x.title == TITLE)
        on_disk = {f: _cell(again, f)["prev"]["value"] for f in ("risk", "milestones")}
        assert in_memory == on_disk, f"两条腿形状不同：内存 {in_memory} / 真库 {on_disk}"
        assert in_memory["risk"] == {"level": "low", "reason": "备选场地已锁"}
        assert in_memory["milestones"] == [{"name": "一期", "status": "done", "statusRaw": ""}]
    finally:
        reg.delete(cid)


def test_migration_0009_guard_literal_matches_its_own_ADD():
    """迁移 0009 内部**自己有两处**字段清单，既有的漂移门只看得见其中一处。

    `test_registry_contract.py::test_person_keys_allowlist_covers_exactly_person_fields` 正则扫的是
    `ADD CONSTRAINT ... payload - ARRAY[...]`，**不看 `want`**。而 0009 是「先比对再 ALTER」的
    守卫式迁移：`want` 是拿来和库里现状比对的期望值，`ADD` 才是真执行的语句。

    两种漂法各有各的坏：
      · 只改 ADD、`want` 落后 → 引导时 `have`(库里旧的) 与 `want`(旧的) **相等** → 整个 IF 被跳过
        → 那条新 ADD **永不执行** → 库里 CHECK 停在旧集合 → 带新键的人卡被真库拒收，而离线全绿。
        这正是 08 的 playbook kind 当年翻车的形状。
      · 只改 `want`、ADD 落后 → 每次引导都判「不相等」→ **每次**都 DROP+ADD+全表重验（ACCESS
        EXCLUSIVE 锁），正是 0724 那次把部署拖过 statement_timeout 的成本。

    `test_conflicts_record_b2a.py::test_migration_0010_guard_literal_matches_its_own_ADD` 早就为
    **0010** 关了这个洞；0009 一直没有孪生门（#87 是它的数组被就地改动的第一次，变异 M16b 实收
    ——「只改 want」在改这条门之前一条判据都不红）。这里补上。
    """
    import dataclasses
    import re

    sql = (Path(__file__).resolve().parent.parent / "db" / "migrations"
           / "0009_person_keys_allowlist_richalign.sql").read_text(encoding="utf-8")
    body = re.sub(r"--[^\n]*", "", sql)

    want = re.search(r"want\s+text\s*:=\s*(.*?);", body, re.S)
    assert want, "0009 的 want 字面量不见了 —— 迁移结构变了，请更新本门"
    # ⚠ 只取 want 里 `ARRAY[…]` 那一段：整条 want 前面还有 `kind <> ''person''`，不排除它的话
    #    'person' 会混进键集，让这条门对着两边完全一致的迁移**恒红**（写这条门时真踩了一次）。
    want_arr = re.search(r"ARRAY\s*\[(.*?)\]\s*::\s*text", want.group(1), re.S)
    assert want_arr, "0009 的 want 里找不到 ARRAY[…] —— 迁移结构变了，请更新本门"
    want_keys = set(re.findall(r"''([A-Za-z_][A-Za-z0-9_]*)''", want_arr.group(1)))

    add = re.search(r"ADD\s+CONSTRAINT\s+entities_person_keys_allowlist\b.*?"
                    r"payload\s*-\s*ARRAY\s*\[([^\]]*)\]", body, re.S)
    assert add, "0009 的 ADD CONSTRAINT 不见了"
    add_keys = set(re.findall(r"'([^']+)'", add.group(1)))

    person_fields = {f.name for f in dataclasses.fields(PersonEntity)}
    assert want_keys == add_keys == person_fields, (
        f"0009 内部漂移了 —— want={sorted(want_keys)} ADD={sorted(add_keys)} "
        f"PersonEntity={sorted(person_fields)}。\n"
        f"三者必须完全一致：want 只用来比对，ADD 才真执行。want 落后 → ALTER 整段被跳过、"
        f"库里 CHECK 停在旧集合、带新键的人卡被真库拒收而离线全绿；ADD 落后 → 每次引导都重验全表。")


def test_a_manual_edit_leaves_the_document_lineage_standing(tmp_path):
    """🔴 手编改一格**不动** lineage —— 这不是遗漏，是两个 side-car 各答各的问题。

    `provenance[f].origin` 答「这一格现在归谁」（手编赢）；`lineage.fields[f]` 答「上一次由
    文档说了算时是谁说的」。票 7 两个都要：origin 判该不该给这一格撤回钮（经理已经接管的不该给），
    lineage 判撤回之后写回什么。所以这条判据同时钉住**两句**：文档血缘还在，且 origin 变成 manual。

    ⚠ 连读的代价写在 `note_field_source` 上：单读 lineage 会把一个经理手填的值说成某份文档给的。
    """
    from avery.ingest.registry import CompanyContext
    from avery.ingest.store import KeywordStore
    reg = ContextRegistry()
    pr = _project(status="on-track", doc=OLD_DOC, line=7)
    reg.put(CompanyContext(context_id="c_edit", extraction=ExtractionResult(projects=[pr]),
                           store=KeywordStore(), memory_dir=tmp_path))
    assert _cell(pr, "status") == {"source": f"{OLD_DOC}:7", "seeded": True}, "基准：手编之前"
    reg.patch_project("c_edit", pr.id, {"status": "blocked"})
    again = reg.get("c_edit").extraction.projects[0]
    assert again.status == "blocked"
    assert again.provenance["status"]["origin"] == "manual", "谁拥有这一格：经理"
    assert _cell(again, "status") == {"source": f"{OLD_DOC}:7", "seeded": True}, (
        "文档血缘被手编抹掉了 —— 票 7 从此无从知道这一格原本是哪份资料给的")
