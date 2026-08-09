# -*- coding: utf-8 -*-
"""T10 · append-upload —— 补资料：追加上传 + 实体增量归并 + 跨期对比接通。

本文件的判据分六段：

  §1 人卡增量归并 —— `merge_person_reading(..., ledger=)`。`merge_person_reading` docstring 里
     那**四个坑**（extract.py 的「为什么不直接调 _dedupe_entities」那一段）逐条转成一条断言：
       坑① 整表重写吞手编/软删/出处   → test_append_never_eats_*（三条）
       坑② 旧冲突重复记账             → test_the_same_corpus_appended_twice_does_not_double_*
       坑③ held_src 记错              → test_the_conflict_cites_the_document_that_ACTUALLY_*
       坑④ signals 换尺重筛           → test_signals_are_deduped_only_after_*
  §2 项目增量归并 —— 本票**新写**的原语（此前只有整表重建与手编 CRUD）。
  §3 安静更新与出处 —— 拍板③：新资料顶掉旧读数时显新值、出处指新资料；不确定就不顶。
  §4 补传主链（离线集成）—— get→原地 mutate→put，只对新文件跑抽取。
  §5 HTTP 端点 —— POST /team/{id}/files 的鉴权/闸/回执。
  §6 @needs_db —— 真库那一层（离线套看不到 pg 持久层，5 型真库 bug 的老坑）。

零真 LLM：全程 `AVERY_BRAIN=mock` + `AVERY_EXTRACTOR=heuristic` + `AVERY_EMBEDDINGS=keyword`
（三件套缺一真烧钱），@needs_db 那几条自带显式构造的 HashingEmbedder，不靠 env。
"""
from __future__ import annotations

import os
from dataclasses import replace
from pathlib import Path

import pytest

from avery.ingest import ingest_paths, parse_bytes
from avery.ingest.extract import (
    AppendLedger, ExtractionResult, FieldConflict, MethodCard, PersonEntity, PersonSelfReport,
    ProjectEntity, ProjectMilestone, ProjectRisk, SelfReportLoad, SignalEntity, _absorb_project,
    _dedupe_entities, _disambiguate_project_ids, _project_key, _slug,
    dedupe_signals_after_linking, merge_person_reading, merge_project_reading,
)
from avery.ingest.file_append import append_paths_to_context, existing_source_keys
from avery.ingest.registry import ContextRegistry, MANUAL_SOURCE, SourceDocument

needs_db = pytest.mark.needs_db

HERE = Path(__file__).resolve().parent.parent

OLD_DOC, NEW_DOC = "员工花名册.md", "本周周报.md"
OLD_AT, NEW_AT = "2026-08-01T09:00:00+00:00", "2026-08-08T09:00:00+00:00"
ZHOU = "周雅婷"
OLD_TEAM, NEW_TEAM = "市场推广部", "前厅部"
TITLE = "别墅套餐推广"


@pytest.fixture(autouse=True)
def _offline(monkeypatch):
    """三件套缺一真烧钱（AGENTS.md「后端全离线配置」）。@needs_db 那几条另外**显式**构造
    embedder，不依赖这里。"""
    monkeypatch.setenv("AVERY_EMBEDDINGS", "keyword")
    monkeypatch.setenv("AVERY_BRAIN", "mock")
    monkeypatch.setenv("AVERY_EXTRACTOR", "heuristic")
    monkeypatch.delenv("AVERY_ALLOW_PERSON_SCORING", raising=False)
    monkeypatch.delenv("AVERY_EMBED_DIM", raising=False)


# --- 手搭件：账本要的只有「哪份资料什么时候进来的」---------------------------------------------

def _doc(source_key: str, uploaded_at: str) -> SourceDocument:
    return SourceDocument(filename=source_key, source_key=source_key, mime="text/markdown",
                          size_bytes=1, doc_kind="company", status="ingested",
                          uploaded_at=uploaded_at)


def _stamps(*pairs: tuple[str, str]) -> list[SourceDocument]:
    return [_doc(k, at) for k, at in pairs]


def _ledger(extraction: ExtractionResult, *pairs: tuple[str, str]) -> AppendLedger:
    """默认时间轴：旧文档 2026-08-01、新文档 2026-08-08。"""
    return AppendLedger(extraction, _stamps(*(pairs or ((OLD_DOC, OLD_AT), (NEW_DOC, NEW_AT)))))


def _person(name: str = ZHOU, doc: str = OLD_DOC, line: int = 3, **kw) -> PersonEntity:
    kw.setdefault("id", _slug(name, "u"))
    kw.setdefault("source", f"{doc}:{line}")
    return PersonEntity(name=name, **kw)


def _project(title: str = TITLE, doc: str = OLD_DOC, line: int = 1, **kw) -> ProjectEntity:
    kw.setdefault("id", _slug(title, "p"))
    kw.setdefault("source", f"{doc}:{line}")
    return ProjectEntity(title=title, **kw)


def _conflict_values(res: ExtractionResult, field: str) -> list[tuple[str, str]]:
    hits = [c for c in res.conflicts if c.field == field]
    assert len(hits) == 1, f"期望恰好一条 {field} 冲突，得到 {res.conflicts}"
    return [(v.value, v.doc_key) for v in hits[0].values]


# =============================================================================================
# §1 · 人卡增量归并 —— merge_person_reading docstring 那四个坑，逐条一条判据
# =============================================================================================

def test_the_ledger_unlocks_team_which_the_old_guard_refused():
    """账本在场时 `team` 成了合法载荷 —— 这不是放宽一条断言，是让**规则 3.5 第一次够得着**。

    旧口径下 `merge_person_reading` 对任何非空 `team` 直接 ValueError，而 `PersonIndex` 的
    规则 3.5（0807 HITL 补的同名+部门消歧）读的**正是** `p.team`：带着部门的读数在 `resolve()`
    跑起来之前就被拒了。补传是它第一次真的能用上。
    """
    # 不带账本：旧行为一个字节没变（表单回流走的就是这条）。
    with pytest.raises(ValueError, match="conflict bookkeeping"):
        merge_person_reading([], _person(team=NEW_TEAM))
    # 带账本：收下，并且真的按部门认出了是哪一位。
    a = _person("林小满", person_id="FO-0422", team="前厅部")
    b = _person("林小满", person_id="REC-0906", team="康乐部")
    b.id = "u_lin2"
    people = [a, b]
    res = ExtractionResult(people=people)
    survivor = merge_person_reading(
        people, _person("林小满", doc=NEW_DOC, team="前厅部", role="前厅经理"),
        ledger=_ledger(res))
    assert survivor is a, "纪要写了「（前厅部）」，规则 3.5 应当认出是前厅部那一位"
    assert len(people) == 2, "不许因为一次补传多出第三张同名卡"


def test_append_never_eats_a_hand_edited_cell():
    """坑① —— 手编赢。经理手填的部门，绝不被一份新文档静默改写。

    `_dedupe_entities` 没有「手编赢」这条规则，因为它只对着刚建出来的 extraction 跑；补传路跑的
    是一张经理已经改过的表。少了这条，每传一次新资料就把经理的更正悄悄撤销一次——无报错、无门。
    """
    cur = _person(team=OLD_TEAM)
    cur.provenance["team"] = {"origin": "manual", "source": MANUAL_SOURCE,
                              "updated_at": "2026-08-05T00:00:00+00:00"}
    res = ExtractionResult(people=[cur])
    merge_person_reading([cur], _person(doc=NEW_DOC, team=NEW_TEAM), ledger=_ledger(res))
    assert cur.team == OLD_TEAM, "手编的格子被一份新文档顶掉了"
    assert cur.provenance["team"]["origin"] == "manual", "手编出处被改写成了 doc"


def test_a_reading_that_contradicts_a_hand_edit_is_recorded_not_swallowed():
    """手编赢，但**绝不静默吞掉**那条读数：够得着冲突口径的字段照样记账。

    「静默吞掉一条冲突读数，比拒绝写更糟」是 `merge_person_reading` 自己写下的口径。经理在今天页
    看到的是「你手填的 X ／ 新资料读到 Y」，而不是什么都没有。
    """
    cur = _person(team=OLD_TEAM)
    cur.provenance["team"] = {"origin": "manual", "source": MANUAL_SOURCE, "updated_at": ""}
    res = ExtractionResult(people=[cur])
    merge_person_reading([cur], _person(doc=NEW_DOC, team=NEW_TEAM), ledger=_ledger(res))
    assert _conflict_values(res, "team") == [(OLD_TEAM, MANUAL_SOURCE), (NEW_TEAM, NEW_DOC)], (
        "手编值必须留在胜出位（手编赢），新读数作为落败读数记在后面")


def test_append_never_eats_an_archived_card():
    """坑① —— 软删（`archived`）不许被一次补传抹掉，也不许因此长出第二张同名卡。"""
    cur = _person(role="市场经理", archived=True)
    res = ExtractionResult(people=[cur])
    survivor = merge_person_reading([cur], _person(doc=NEW_DOC, role="前厅经理"),
                                    ledger=_ledger(res))
    assert survivor is cur and cur.archived is True, "经理归档过的卡被补传复活了"


def test_append_never_eats_a_manually_added_person():
    """坑① —— 手加的人（`um-…`）在补传之后仍然在场，且 id 不变（前端按 id 编辑/归档）。"""
    manual = PersonEntity(id="um-abc12345", name="李工", role="工程主管")
    manual.provenance["name"] = {"origin": "manual", "source": MANUAL_SOURCE, "updated_at": ""}
    people = [manual]
    res = ExtractionResult(people=people)
    merge_person_reading(people, _person(doc=NEW_DOC, role="市场经理"), ledger=_ledger(res))
    assert [p.id for p in people] == ["um-abc12345", _slug(ZHOU, "u")], (
        "手加的人被并掉了，或者新人的 id 插到了前面")


def test_append_never_truncates_a_hand_curated_list():
    """坑① 的一个具体面 —— `_absorb_person` 的并集是**无条件** `[:6]` 截断，而手编列表没有上限。
    补传路必须整条不碰手编过的列表，否则经理列的第 7 条起会被一次上传悄悄剪掉。"""
    cur = _person(owns=[f"事项{i}" for i in range(1, 9)])
    cur.provenance["owns"] = {"origin": "manual", "source": MANUAL_SOURCE, "updated_at": ""}
    res = ExtractionResult(people=[cur])
    merge_person_reading([cur], _person(doc=NEW_DOC, owns=["新事项"]), ledger=_ledger(res))
    assert len(cur.owns) == 8 and "新事项" not in cur.owns, "手编的列表被截断/改写了"


def test_the_same_corpus_appended_twice_does_not_double_the_conflict_rows():
    """坑② —— 自证门：同一批语料补传**两次**，冲突行数不翻倍。

    `_dedupe_entities` 的 conflict_index 是每次调用新建的，而 `extraction.conflicts` 跨 `get()`
    持久：重跑一遍归并，凡是还能再撞一次的字段都会再追加一条重复记录（前端会渲染两遍）。
    `AppendLedger` 从持久化的 conflicts 重建索引，所以第二遍认得出「这条已经记过了」。
    """
    cur = _person(team=OLD_TEAM)
    res = ExtractionResult(people=[cur])
    reading = _person(doc=NEW_DOC, team=NEW_TEAM)
    merge_person_reading([cur], replace(reading), ledger=_ledger(res))
    first = [(c.field, len(c.values)) for c in res.conflicts]
    # 第二趟：新账本（补传是一次一本，和真实调用一样），同一条读数再来一遍。
    merge_person_reading([cur], replace(reading), ledger=_ledger(res))
    assert [(c.field, len(c.values)) for c in res.conflicts] == first == [("team", 2)], (
        "同一条读数被记了两遍——账本没有从持久化的 conflicts 重建")


def test_a_third_document_extends_the_same_conflict_instead_of_opening_a_second():
    """坑② 的另一半：**新的**第三份读数要追加进同一条 FieldConflict，而不是另开一条。"""
    cur = _person(team=OLD_TEAM)
    res = ExtractionResult(people=[cur])
    stamps = ((OLD_DOC, OLD_AT), (NEW_DOC, NEW_AT), ("纪要.md", "2026-08-09T09:00:00+00:00"))
    merge_person_reading([cur], _person(doc=NEW_DOC, team=NEW_TEAM), ledger=_ledger(res, *stamps))
    merge_person_reading([cur], _person(doc="纪要.md", team="康乐部"), ledger=_ledger(res, *stamps))
    assert len(res.conflicts) == 1, "三份资料各说一样应当是一条冲突三个读数"
    assert [v.value for v in res.conflicts[0].values] == ["康乐部", NEW_TEAM, OLD_TEAM], (
        "values[0] 必须是胜出读数（最新那份），其余按到达序")


def test_the_conflict_cites_the_document_that_ACTUALLY_stated_the_held_value():
    """坑③ —— 出处必须逐字段记，不能拿实体级 `source` 冒充。

    实体的 `source` 是 keep-first 的**整条**出处，而某个格子的值完全可能是后来某份文档补上的。
    拿它当那一格的出处，就会在卡上引用一份**从没说过这件事**的文档——比不报冲突更糟。
    这里：人是花名册来的（entity.source→花名册），但 `team` 这一格是**周报**填上的（enrichment），
    第三份资料再来撞时，落败读数必须引周报，不是花名册。
    """
    cur = _person(doc=OLD_DOC)                      # 实体级出处 = 花名册
    res = ExtractionResult(people=[cur])
    stamps = ((OLD_DOC, OLD_AT), (NEW_DOC, NEW_AT), ("纪要.md", "2026-08-09T09:00:00+00:00"))
    merge_person_reading([cur], _person(doc=NEW_DOC, team=NEW_TEAM), ledger=_ledger(res, *stamps))
    assert cur.team == NEW_TEAM and not res.conflicts, "空格子被填上是 enrichment，不是冲突"
    merge_person_reading([cur], _person(doc="纪要.md", team="康乐部"), ledger=_ledger(res, *stamps))
    assert _conflict_values(res, "team") == [("康乐部", "纪要.md"), (NEW_TEAM, NEW_DOC)], (
        f"落败读数引错了文档（应当是填了这一格的 {NEW_DOC}，不是实体级 source 的 {OLD_DOC}）")


def test_signals_are_deduped_only_after_both_sides_speak_ids():
    """坑④ —— 存量信号的 `subjectRef` 早已是人卡 id，新抽出来的还是姓名。先 link 后去重，
    两边才是同一把尺；否则就是换尺重筛（同一条信号在补传后变成两条）。"""
    res = ExtractionResult(signals=[
        SignalEntity(id="s1", source_kind="doc", subjectType="person", subjectRef="u_x",
                     summary="下周要交三份材料"),
        SignalEntity(id="s1", source_kind="doc", subjectType="person", subjectRef="u_x",
                     summary="下周要交三份材料"),
    ])
    assert dedupe_signals_after_linking(res) == 1
    assert len(res.signals) == 1


# =============================================================================================
# §2 · 项目增量归并 —— 本票新写的原语
# =============================================================================================

def test_an_unseen_project_lands_at_the_end_of_the_list():
    """新项目追加在**末尾**：活下来那条的 id 是前端编辑/归档的靶子，插在前面等于让经理刚改过的
    那张卡失联（`merge_person_reading` 的同一条理由）。"""
    first = _project("已有项目")
    projects = [first]
    res = ExtractionResult(projects=projects)
    fresh = _project("新项目", doc=NEW_DOC)
    assert merge_project_reading(projects, fresh, ledger=_ledger(res)) is fresh
    assert [p.title for p in projects] == ["已有项目", "新项目"]
    assert projects[0] is first, "已有卡的对象身份（连同它的 id）必须原样不动"


def test_an_untitled_reading_is_refused_rather_than_bucketed():
    """`_project_key("") == ""` —— 无标题的卡会被归成同一格。拒收，别把三个无名项目并成一个。"""
    res = ExtractionResult(projects=[])
    with pytest.raises(ValueError, match="titled project"):
        merge_project_reading([], _project(""), ledger=_ledger(res))


def test_a_fresh_reading_merges_into_an_archived_card_rather_than_forking_it():
    """归档卡照样是归并候选。

    跳过它的下场是给同一个 `_project_key` 再开一张卡：`_dedupe_entities` 保证的唯一性当场破掉，
    下一次整表重建会把两张融回一张，经理那次归档就这么无声蒸发了。宁可让新读数落在一张他看不见的
    卡上（他自己归档的，恢复即见）。
    """
    archived = _project(status="on-track", archived=True)
    projects = [archived]
    res = ExtractionResult(projects=projects)
    survivor = merge_project_reading(projects, _project(doc=NEW_DOC, status="blocked"),
                                     ledger=_ledger(res))
    assert survivor is archived and len(projects) == 1, "归档卡被绕过，长出了第二张同名卡"
    assert archived.archived is True, "补传把经理的归档撤销了"


def test_two_titles_sharing_a_slug_id_do_not_share_a_card_id_after_an_append():
    """`_slug` 折叠标点并在 32 字符处截断，`_project_key` 不折叠标点——两张**不同**的卡可以撞
    一个 id。id 是前端 join key（signal.subjectId / project.ownerId / React key），撞了不报错，
    只会让 A 的信号显示在 B 的详情里。补传会往一份在用的清单里追加卡，所以这里必须解碰撞。"""
    a = _project("别墅套餐推广（八月）")
    b = _project("别墅套餐推广(八月)", doc=NEW_DOC)
    assert a.id == b.id and _project_key(a.title) != _project_key(b.title), (
        "这条门的前提没了（_slug/_project_key 的差异被改过），判据要跟着重写")
    projects = [a]
    res = ExtractionResult(projects=projects)
    merge_project_reading(projects, b, ledger=_ledger(res))
    assert len({p.id for p in projects}) == 2, "两张卡补传之后仍然共用一个 id"
    assert projects[0].id == a.id, "先到的那张卡的 id 不许被改（经理正对着它编辑）"


def test_zero_progress_is_a_real_reading_not_an_absent_one():
    """`progress=0` 是文档真写了 0%。判据用真值性（`not 0`）会把它当成「文档没说」，
    于是一条真读数被一份更旧的资料顶掉。"""
    cur = _project(progress=0)
    res = ExtractionResult(projects=[cur])
    merge_project_reading([cur], _project(doc=NEW_DOC, progress=55), ledger=_ledger(res))
    assert cur.progress == 55, "新资料确凿更新，0 应当被顶掉成 55"
    cur2 = _project(progress=40)
    res2 = ExtractionResult(projects=[cur2])
    merge_project_reading([cur2], _project(doc=NEW_DOC, progress=0), ledger=_ledger(res2))
    assert cur2.progress == 0, "新资料读到 0% 是一条真读数，不许当缺席跳过"


def test_the_project_conflict_puts_the_winning_reading_first():
    """`FieldConflict` 的契约：`values[0]` 恒为**胜出**读数。补传路上新资料确凿更新时新值胜出，
    所以它插在队首；被顶掉的那条排后面。"""
    cur = _project(status="on-track", dueDate="2026-09-30")
    res = ExtractionResult(projects=[cur])
    merge_project_reading([cur], _project(doc=NEW_DOC, status="blocked", dueDate="2026-10-15"),
                          ledger=_ledger(res))
    assert cur.status == "blocked" and cur.dueDate == "2026-10-15"
    assert _conflict_values(res, "status") == [("blocked", NEW_DOC), ("on-track", OLD_DOC)]
    assert _conflict_values(res, "dueDate") == [("2026-10-15", NEW_DOC), ("2026-09-30", OLD_DOC)]


def test_blockers_are_unioned_not_replaced():
    """两份资料各列一半阻塞是常态，不是分歧——并集，且与 `_absorb_project` 同一个 6 上限。"""
    cur = _project(blockers=["雨季无备选场地"])
    res = ExtractionResult(projects=[cur])
    merge_project_reading([cur], _project(doc=NEW_DOC, blockers=["雨季无备选场地", "预算未批"]),
                          ledger=_ledger(res))
    assert cur.blockers == ["雨季无备选场地", "预算未批"]


def test_changing_the_owner_name_drops_the_stale_owner_id():
    """`ownerId` 是**派生**的 join key，不是独立读数。换了负责人还留着旧 id，卡上会显示新名字、
    信号却仍挂在旧人身上。清空让 `_link_owners` 按当前花名册重新解一次。"""
    cur = _project(ownerName="周雅婷", ownerId="u_zhou")
    res = ExtractionResult(projects=[cur])
    merge_project_reading([cur], _project(doc=NEW_DOC, ownerName="林小满"), ledger=_ledger(res))
    assert cur.ownerName == "林小满" and cur.ownerId == ""


def test_the_upload_path_and_the_append_path_absorb_a_project_the_same_way():
    """两条路共用 `_absorb_project` 这一个定义 —— 「怎么合一个项目」只许有一份实现。

    （`test_the_form_writer_and_the_pipeline_merge_a_person_the_same_way` 的项目孪生。）
    这里比的是**同一条规则**：两边都在「拿不准谁更新」时走 keep-first，所以结果必须逐字段相同。
    """
    a, b = _project(status="on-track"), _project(doc=NEW_DOC, status="blocked", summary="进场了")
    batch = ExtractionResult(projects=[replace(a), replace(b)])
    _dedupe_entities(batch)
    solo = replace(a)
    res = ExtractionResult(projects=[solo])
    # 时间轴故意留空 → `outranks` 恒 False → 补传路退回 keep-first，与上传路同一条规则。
    merge_project_reading([solo], replace(b), ledger=AppendLedger(res, []))
    kept = batch.projects[0]
    for field in ("title", "status", "dueDate", "summary", "progress", "ownerName"):
        assert getattr(solo, field) == getattr(kept, field), f"{field} 两条路给出了不同答案"


def test_absorb_project_still_keeps_first_for_risk_and_milestones():
    """`_absorb_project` 被提出来之后，规则一个字节没动（钉住提取重构本身）。"""
    cur = _project(risk=ProjectRisk(level="low"), milestones=[ProjectMilestone("一期", "done")])
    _absorb_project(cur, _project(risk=ProjectRisk(level="high"),
                                  milestones=[ProjectMilestone("二期", "active")]))
    assert cur.risk.level == "low" and [m.name for m in cur.milestones] == ["一期"]


# =============================================================================================
# §3 · 安静更新与出处（拍板③）—— 显新值 + 出处指新资料；拿不准就不顶
# =============================================================================================

def test_a_newer_document_quietly_refreshes_a_field_and_repoints_its_source():
    """拍板③ 的正面：新资料顶掉旧读数 → 卡上是新值，**逐字段出处指向新资料**，不打扰
    （`role` 不在冲突口径里，所以一条今天页记录都不该产生）。"""
    cur = _person(role="市场专员")
    res = ExtractionResult(people=[cur])
    merge_person_reading([cur], _person(doc=NEW_DOC, line=7, role="市场经理"), ledger=_ledger(res))
    assert cur.role == "市场经理"
    assert cur.provenance["role"] == {"origin": "doc", "source": f"{NEW_DOC}:7",
                                      "updated_at": NEW_AT}
    assert res.conflicts == [], "不在冲突口径里的字段安静更新，不该上今天页"


def test_an_older_document_never_overrides_a_newer_reading():
    """补传的**不一定**是更新的资料（客户翻出一份去年的表也走这个口子）。旧的不许顶掉新的。"""
    cur = _person(role="市场经理", doc=NEW_DOC)
    res = ExtractionResult(people=[cur])
    merge_person_reading([cur], _person(doc=OLD_DOC, role="市场专员"), ledger=_ledger(res))
    assert cur.role == "市场经理", "一份更旧的资料把新读数顶掉了"


def test_an_unresolvable_timestamp_falls_back_to_keep_first():
    """三种「不知道谁更新」——时间轴里没有那份资料、`uploaded_at` 解析不出、两边同一时刻——
    一律退回 keep-first。宁可显示一个有出处的旧读数，也不靠猜去改写它
    （`clear_stale_self_report` 逐字同一条口径）。"""
    for stamps in (
        ((OLD_DOC, OLD_AT),),                              # 新文档不在时间轴里
        ((OLD_DOC, "昨天"), (NEW_DOC, NEW_AT)),             # 旧文档的时刻认不出
        ((OLD_DOC, OLD_AT), (NEW_DOC, "")),                # 新文档没有 uploaded_at
        ((OLD_DOC, NEW_AT), (NEW_DOC, NEW_AT)),            # 同一时刻，谈不上更新
    ):
        cur = _person(role="市场专员")
        res = ExtractionResult(people=[cur])
        merge_person_reading([cur], _person(doc=NEW_DOC, role="市场经理"),
                             ledger=_ledger(res, *stamps))
        assert cur.role == "市场专员", f"时间轴 {stamps} 下不该改写一个有出处的读数"


def test_filling_an_empty_cell_is_enrichment_not_a_conflict():
    """空格子被填上不是「对不上」，是补全 —— 不记冲突，但出处要指向真正填了它的那份资料
    （坑③ 的另一半：`held_src` 在 enrichment 那一支也要跟着走）。"""
    cur = _person(team="")
    res = ExtractionResult(people=[cur])
    merge_person_reading([cur], _person(doc=NEW_DOC, line=9, team=NEW_TEAM), ledger=_ledger(res))
    assert cur.team == NEW_TEAM and res.conflicts == []
    assert cur.provenance["team"]["source"] == f"{NEW_DOC}:9"


def test_restating_the_same_value_does_not_churn_the_provenance():
    """一份新资料复述了同一个值 —— 什么都不做。改一次出处只是给「这一格什么时候变过」添噪音。"""
    cur = _person(team=OLD_TEAM)
    res = ExtractionResult(people=[cur])
    merge_person_reading([cur], _person(doc=NEW_DOC, team=OLD_TEAM), ledger=_ledger(res))
    assert "team" not in cur.provenance and res.conflicts == []


def test_the_provenance_origin_stays_inside_the_closed_wire_union():
    """线上那个联合类型是闭的（`transport.ts` 的 `'doc'|'manual'|'form'`）。发明第四种取值会在
    前端悄悄落进「不挂角标」分支，而载荷已经违约——不报错，只是不显示。"""
    cur = _project(status="on-track")
    res = ExtractionResult(projects=[cur])
    merge_project_reading([cur], _project(doc=NEW_DOC, status="blocked"), ledger=_ledger(res))
    assert {v["origin"] for v in cur.provenance.values()} <= {"doc", "manual", "form"}


# =============================================================================================
# §4 · 补传主链（离线集成）—— get → 原地 mutate → put，只对新文件跑抽取
# =============================================================================================

ROSTER_V1 = "\n".join([
    "# 别墅酒店 员工花名册", "",
    "姓名 | 人员ID | 部门 | 职位 | 司龄",
    f"{ZHOU} | MKT-001 | {OLD_TEAM} | 市场专员 | 3年",
    "林小满 | FO-0422 | 前厅部 | 前厅主管 | 2年",
])
ROSTER_V2 = "\n".join([
    "# 别墅酒店 员工花名册（八月）", "",
    "姓名 | 人员ID | 部门 | 职位 | 司龄",
    f"{ZHOU} | MKT-001 | {NEW_TEAM} | 市场经理 | 3年",
])
PROJECT_V1 = "\n".join([
    f"# {TITLE}",
    f"负责人：{ZHOU}",
    "状态：进行中",
    "截止：2026-09-30",
    "进度：40%",
])
PROJECT_V2 = "\n".join([
    f"# {TITLE}",
    f"负责人：{ZHOU}",
    "状态：受阻",
    "截止：2026-10-15",
    "进度：55%",
    "阻塞：雨季无备选场地",
])


def _write(tmp: Path, name: str, text: str) -> Path:
    p = tmp / name
    p.write_text(text, encoding="utf-8")
    return p


def _sd(path: Path, uploaded_at: str, source_key: str | None = None) -> SourceDocument:
    return SourceDocument(filename=path.name, source_key=source_key or path.name,
                          mime="text/markdown", size_bytes=path.stat().st_size,
                          content=path.read_bytes(), uploaded_at=uploaded_at)


def _seed(tmp: Path, reg: ContextRegistry, cid: str = "ctx_t10") -> str:
    """第一批资料 = 花名册 + 项目卡，走**真正的** /ingest 那条路（`ingest_paths`）。"""
    files = [_write(tmp, "员工花名册.md", ROSTER_V1), _write(tmp, "项目周报.md", PROJECT_V1)]
    rep = ingest_paths([str(p) for p in files], registry=reg, work_dir=tmp / "mem",
                       context_id=cid, name="别墅酒店", owner_token="tok_t10",
                       source_documents=[_sd(p, OLD_AT) for p in files])
    assert rep.ok, "种子语料自己就没进去，下面的断言什么都证明不了"
    ctx = reg.get(cid)
    assert ctx.extraction.people and ctx.extraction.projects, (
        "种子语料抽不出人/项目——判据够不着，整段是假绿")
    return cid


def _append(tmp: Path, reg: ContextRegistry, cid: str, name: str, text: str, at: str = NEW_AT,
            *, key: str | None = None):
    """端点侧把临时文件写成**去重后的 parse_name**，所以 `ParsedDoc.name == source_key` 是构造保证。
    这个替身照做（`key` 就是那个去重后的名字），否则测的就不是真实那条路。"""
    p = _write(tmp, key or name, text)
    sd = _sd(p, at, source_key=key)
    sd.filename = name                      # display 名保持原样（同 /ingest：filename ≠ source_key）
    return append_paths_to_context(reg, cid, [str(p)], [sd])


def test_append_lands_beside_the_existing_files_without_touching_them(tmp_path):
    """资料库多一行，旧的一行不动、旧的块不掉、头条计数跟着涨。"""
    reg = ContextRegistry()
    cid = _seed(tmp_path, reg)
    ctx = reg.get(cid)
    before_cards = ctx.file_cards()
    before_chunks = {c["filename"]: c["n_chunks"] for c in before_cards}
    before_bytes = reg.source_document_bytes(cid, 0)

    rep = _append(tmp_path, reg, cid, "本周周报.md", PROJECT_V2)
    assert rep.ok, rep.parse_errors

    ctx = reg.get(cid)
    cards = ctx.file_cards()
    assert len(cards) == len(before_cards) + 1
    for c in cards[:len(before_cards)]:
        assert c["n_chunks"] == before_chunks[c["filename"]], "旧文档的块数被这次补传改了"
    assert reg.source_document_bytes(cid, 0) == before_bytes, "旧文档的原件字节变了"
    assert ctx.briefing()["headline"].startswith(f"Ingested {len(cards)} file(s)")


def test_append_extracts_only_the_new_files(tmp_path):
    """命门② —— LLM 花费与**新文件**成正比，不与公司资料总量成正比。

    对整份语料重跑抽取，第十次补传要为前九批已经读过的文件再付一次钱，而且会把这十天里的
    手编 CRUD 全部推平。这条门数的就是「抽取器这一趟看见了几份文档」。
    """
    from avery.ingest.extract import HeuristicExtractor

    class _Counting(HeuristicExtractor):
        def __init__(self):
            super().__init__()
            self.seen: list[str] = []

        def extract(self, doc):
            self.seen.append(doc.name)
            return super().extract(doc)

    reg = ContextRegistry()
    cid = _seed(tmp_path, reg)
    counter = _Counting()
    p = _write(tmp_path, "本周周报.md", PROJECT_V2)
    rep = append_paths_to_context(reg, cid, [str(p)], [_sd(p, NEW_AT)], extractor=counter)
    assert rep.ok
    assert counter.seen == ["本周周报.md"], (
        f"补传把存量文档也重抽了一遍：{counter.seen}")


def test_the_card_shows_the_new_reading_after_an_append(tmp_path):
    """本票不许砍半的那一条 —— 只把文件塞进资料库而不动卡片，时间轴会说资料很新、卡片还是旧读数。

    这里走完整条链：真文件 → 真抽取 → 归并 → `put` → **投给前端的那张卡**。
    """
    reg = ContextRegistry()
    cid = _seed(tmp_path, reg)
    before = reg.get(cid).project_cards()[0]
    assert before["status"] == "on-track" and before["progress"] == 40

    assert _append(tmp_path, reg, cid, "本周周报.md", PROJECT_V2).ok

    card = reg.get(cid).project_cards()[0]
    assert card["status"] == "blocked", "补传之后卡片还挂着上一批的状态"
    assert card["progress"] == 55
    assert card["dueDate"] == "2026-10-15"
    assert "雨季无备选场地" in card["blockers"]
    assert card["provenance"]["status"]["source"].startswith("本周周报.md:"), (
        "出处没有指向新资料——「安静更新」的另一半没落地")


def test_the_person_card_shows_the_new_reading_and_records_the_department_conflict(tmp_path):
    """人卡这一侧的同一件事：职位安静更新，部门对不上则记一条冲突（今天页那条通道的入口）。"""
    reg = ContextRegistry()
    cid = _seed(tmp_path, reg)
    assert _append(tmp_path, reg, cid, "新花名册.md", ROSTER_V2).ok

    ctx = reg.get(cid)
    zhou = next(p for p in ctx.extraction.people if p.name == ZHOU)
    assert zhou.role == "市场经理", "职位没有安静更新到新读数"
    assert zhou.team == NEW_TEAM
    teams = [c for c in ctx.extraction.conflicts if c.field == "team"]
    assert len(teams) == 1 and [v.value for v in teams[0].values] == [NEW_TEAM, OLD_TEAM]
    assert len([p for p in ctx.extraction.people if p.name == ZHOU]) == 1, "同一个人裂成了两张卡"


def test_appending_the_same_corpus_twice_doubles_nothing(tmp_path):
    """自证门（票面点名的那条）——同一批语料补传两次：冲突行数不翻倍、人不翻倍、项目不翻倍、
    信号不翻倍。文档本身**会**多一行（那是真的多传了一份文件，不是重复记账）。"""
    reg = ContextRegistry()
    cid = _seed(tmp_path, reg)
    assert _append(tmp_path, reg, cid, "新花名册.md", ROSTER_V2).ok
    assert _append(tmp_path, reg, cid, "本周周报.md", PROJECT_V2).ok
    ctx = reg.get(cid)
    once = (len(ctx.extraction.conflicts), len(ctx.extraction.people),
            len(ctx.extraction.projects), len(ctx.extraction.signals),
            [len(c.values) for c in ctx.extraction.conflicts])

    # 同样的两份文件再传一遍（source_key 由端点侧去重，这里显式给一个新 key 模拟）。
    assert _append(tmp_path, reg, cid, "新花名册.md", ROSTER_V2, key="新花名册(1).md").ok
    assert _append(tmp_path, reg, cid, "本周周报.md", PROJECT_V2, key="本周周报(1).md").ok

    ctx = reg.get(cid)
    twice = (len(ctx.extraction.conflicts), len(ctx.extraction.people),
             len(ctx.extraction.projects), len(ctx.extraction.signals),
             [len(c.values) for c in ctx.extraction.conflicts])
    assert twice == once, f"补传两遍之后账翻倍了：{once} → {twice}"
    assert len(reg.get(cid).file_cards()) == 6, "文件行数应当照实增长（真的多传了文件）"


def test_a_second_file_with_the_same_name_gets_its_own_source_key(tmp_path):
    """`<source_key>:<行号>` 是出处契约的一半。两份文档共用一个 key 之后，新文档的每一条读数
    都会被算到旧文档头上——文件清单的块数、时间轴的那一天、冲突卡引用的资料，三处一起指错。"""
    reg = ContextRegistry()
    cid = _seed(tmp_path, reg)
    taken = existing_source_keys(reg.get(cid))
    assert "项目周报.md" in taken
    # 端点用 `_unique_parse_names(..., taken=)` 起名；这里直接验那个函数的口径。
    from service.ingest_api import _unique_parse_names
    assert _unique_parse_names(["项目周报.md"], taken=taken) == ["项目周报(1).md"]
    assert _unique_parse_names(["项目周报.md"]) == ["项目周报.md"], "不传 taken 时行为一字不变"


def test_append_refuses_the_unappendable_loudly(tmp_path):
    """未知 context → KeyError（端点转同体 404）；一份都读不出来 → ok=False，且**一个字段都没写**。"""
    reg = ContextRegistry()
    cid = _seed(tmp_path, reg)
    with pytest.raises(KeyError):
        _append(tmp_path, reg, "ctx_ghost", "本周周报.md", PROJECT_V2)

    ctx = reg.get(cid)
    before = (len(ctx.source_documents), len(ctx.extraction.materials))
    bad = tmp_path / "坏文件.xyz"
    bad.write_bytes(b"\x00\x01")
    rep = append_paths_to_context(reg, cid, [str(bad)],
                                  [SourceDocument(filename=bad.name, source_key=bad.name,
                                                  mime="application/octet-stream", size_bytes=2,
                                                  content=bad.read_bytes(), uploaded_at=NEW_AT)])
    assert rep.ok is False and rep.parse_errors
    ctx = reg.get(cid)
    assert (len(ctx.source_documents), len(ctx.extraction.materials)) == before, (
        "读不出来的一批把 context 改脏了（先造后挂被破坏）")


def test_facts_md_and_the_room_recall_see_the_appended_content(tmp_path):
    """`put()` 只在 facts.md **不存在**时才重物化，而 `get()` 回来的 context 文件必然存在——
    忘了自己重写，议事室的 recall 面就永远停在补传之前那份卡。"""
    from avery import memory
    reg = ContextRegistry()
    cid = _seed(tmp_path, reg)
    assert _append(tmp_path, reg, cid, "本周周报.md", PROJECT_V2).ok
    ctx = reg.get(cid)
    facts = (Path(ctx.memory_dir) / "facts.md").read_text(encoding="utf-8")
    assert "雨季无备选场地" in facts, "facts.md 没跟着补传重写"
    hits = memory.recall("雨季无备选场地", ctx.memory_dir)
    assert hits and any(h.source.startswith(("facts.md:", "notes.md:")) for h in hits)


def test_playbooks_do_not_double_on_a_repeat_append(tmp_path):
    """方法卡没有 id 也没有手编通道，去重只为一件事：同一批语料补传两次时页面上的卡不翻倍。"""
    from avery.ingest.file_append import _extend_playbooks
    ex = ExtractionResult(playbooks=[MethodCard(title="接待流程", description="三步走")])
    _extend_playbooks(ex, ExtractionResult(playbooks=[
        MethodCard(title="接待流程", description="三步走"),
        MethodCard(title="退房流程", description="两步走")]))
    assert [m.title for m in ex.playbooks] == ["接待流程", "退房流程"]


def test_a_parsed_doc_whose_name_is_not_a_supplied_key_is_refused_loudly(tmp_path):
    """静默丢一份客户资料是本仓最贵的那类 bug —— 名字对不上时当场炸，不许悄悄滤掉然后回 200。"""
    reg = ContextRegistry()
    cid = _seed(tmp_path, reg)
    p = _write(tmp_path, "本周周报.md", PROJECT_V2)
    with pytest.raises(ValueError, match="citation contract"):
        append_paths_to_context(reg, cid, [str(p)], [_sd(p, NEW_AT, source_key="别的名字.md")])


# =============================================================================================
# §5 · HTTP —— POST /team/{id}/files
# =============================================================================================

@pytest.fixture()
def client(monkeypatch):
    pytest.importorskip("fastapi.testclient")
    monkeypatch.setenv("AVERY_BRAIN", "mock")
    monkeypatch.setenv("AVERY_EXTRACTOR", "heuristic")
    monkeypatch.setenv("AVERY_EMBEDDINGS", "keyword")
    for k in ("AVERY_DB_URL", "PGVECTOR_URL", "AVERY_ALLOW_PERSON_SCORING",
              "AVERY_RATE_INGEST_PER_MIN"):
        monkeypatch.delenv(k, raising=False)
    from avery.ingest.registry import REGISTRY
    import service.app as app_mod
    from service import upload_guard
    REGISTRY.clear()
    upload_guard.reset_rate_limiter()
    from fastapi.testclient import TestClient
    with TestClient(app_mod.app) as c:
        yield c
    REGISTRY.clear()


def _ingest(client) -> tuple[str, dict]:
    res = client.post("/ingest", files=[
        ("files", ("员工花名册.md", ROSTER_V1.encode("utf-8"), "text/markdown")),
        ("files", ("项目周报.md", PROJECT_V1.encode("utf-8"), "text/markdown"))])
    assert res.status_code == 200, res.text
    body = res.json()
    return body["context_id"], {"X-Avery-Token": body["owner_token"]}


def test_the_append_endpoint_is_gated_exactly_like_the_read_path(client):
    """无 token / 错 token / 未知 id —— 三种一律同体 404，无存在性 oracle。"""
    cid, hdr = _ingest(client)
    payload = [("files", ("本周周报.md", PROJECT_V2.encode("utf-8"), "text/markdown"))]
    assert client.post(f"/team/{cid}/files", files=payload).status_code == 404
    assert client.post(f"/team/{cid}/files", files=payload,
                       headers={"X-Avery-Token": "nope"}).status_code == 404
    ghost = client.post("/team/ctx_ghost/files", files=payload, headers=hdr)
    assert ghost.status_code == 404


def test_the_append_endpoint_returns_the_refreshed_team_payload(client):
    """回执 = 与 `/team/{id}` 同一张 payload —— 前端拿它整屏刷新，卡片当场是新读数。
    🔴 **不发** owner_token：那是创建时才交出去一次的凭据，本端点没有新铸也不该重发一遍。"""
    cid, hdr = _ingest(client)
    res = client.post(f"/team/{cid}/files", headers=hdr, files=[
        ("files", ("本周周报.md", PROJECT_V2.encode("utf-8"), "text/markdown"))])
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["context_id"] == cid, "补传绝不新建 context"
    assert "owner_token" not in body
    assert body["projects"][0]["status"] == "blocked"
    assert body["appended"]["documents"] == ["本周周报.md"]
    # 状态与截止日两条都和上一批对不上 —— 安静更新到新值，同时各记一条冲突走今天页那条通道。
    assert body["appended"]["conflicts_added"] == 2
    assert len(client.get(f"/team/{cid}/files", headers=hdr).json()["files"]) == 3


def test_the_append_endpoint_disambiguates_against_the_existing_library(client):
    """同名文件补传第二次：新文档拿到自己的 key，块数各归各的文档。"""
    cid, hdr = _ingest(client)
    res = client.post(f"/team/{cid}/files", headers=hdr, files=[
        ("files", ("项目周报.md", PROJECT_V2.encode("utf-8"), "text/markdown"))])
    assert res.status_code == 200, res.text
    assert res.json()["appended"]["documents"] == ["项目周报(1).md"]
    cards = client.get(f"/team/{cid}/files", headers=hdr).json()["files"]
    assert [c["filename"] for c in cards].count("项目周报.md") == 2, "display 名允许重复"
    assert all(c["n_chunks"] > 0 for c in cards), "有文档的块被算到了别人头上"


def test_the_red_line_still_refuses_a_scoring_document_on_the_append_path(client):
    """红线硬门在补传这条路上原样生效 —— 一份给人打分的资料，不许靠「换个入口」进来。
    422 与 /ingest 同体；且**一个字段都没写**（先造后挂）。"""
    # 文件名保持「花名册」——`sniff_kind` 按它认出这是一张人员表，roster 那条解析路才会跑。
    # 换个名字（「员工评估表.md」）就抽不出人，于是**红线也不会响**：这条门测的就不是红线了。
    scored = "\n".join(["# 员工花名册（含评估）", "",
                        "姓名 | 部门 | 职位 | 司龄",
                        f"{ZHOU} | {OLD_TEAM} | 市场经理 | 综合评分 92 分"])
    cid, hdr = _ingest(client)
    before = client.get(f"/team/{cid}/files", headers=hdr).json()["files"]
    res = client.post(f"/team/{cid}/files", headers=hdr, files=[
        ("files", ("员工花名册.md", scored.encode("utf-8"), "text/markdown"))])
    assert res.status_code == 422, res.text
    body = res.json()["detail"]
    assert body["error"] == "extraction refused" and body["violations"]
    assert client.get(f"/team/{cid}/files", headers=hdr).json()["files"] == before, (
        "红线拒绝之后资料库还是被改了")


def test_the_append_endpoint_refuses_a_disguised_type_the_same_way_ingest_does(client):
    """伪装类型走 415，与 /ingest 逐字同一条（`enforce_type_and_archive`）。"""
    cid, hdr = _ingest(client)
    res = client.post(f"/team/{cid}/files", headers=hdr, files=[
        ("files", ("坏文件.md", b"\xff\xfe\x00\x00\x00", "text/markdown"))])
    assert res.status_code == 415, res.text


def test_the_append_endpoint_enforces_the_same_byte_gates_as_ingest(client, monkeypatch):
    """条数闸与逐文件大小闸一条都不许少（上传口的防护不该因为多开一个入口就少一份）。"""
    cid, hdr = _ingest(client)
    monkeypatch.setenv("AVERY_MAX_FILES", "1")
    two = [("files", ("a.md", b"# a\n\n" + b"x" * 40, "text/markdown")),
           ("files", ("b.md", b"# b\n\n" + b"y" * 40, "text/markdown"))]
    assert client.post(f"/team/{cid}/files", headers=hdr, files=two).status_code == 413
    monkeypatch.setenv("AVERY_MAX_UPLOAD_BYTES", "10")
    assert client.post(f"/team/{cid}/files", headers=hdr, files=[
        ("files", ("a.md", b"x" * 4096, "text/markdown"))]).status_code == 413


def test_the_edge_guard_actually_covers_the_new_route():
    """🔴 `_GUARDED` 是**精确匹配**字典，带路径参数的路由永远命不中它。漏了这条分支，新端点在
    ASGI 边缘就是零防护（无限流、无 Content-Length 预检、无流式总量兜底），而处理器内部的闸
    照旧生效——「看起来有闸」正是这种漏法最难被发现的原因。"""
    from service.upload_guard import _route_for, is_guarded
    assert _route_for("/team/ctx_abc/files") == "ingest"
    assert _route_for("/ingest") == "ingest"
    # issue #77 改判：`/team/{id}/files/{key}` 现在**也**归 'ingest' 表盘——DELETE 走这条路径，
    # 不认它就等于删除口在边缘零限流。判据同时改成落在**行为**上（route + method 的组合），
    # 不再落在 `_route_for` 的返回值上：被测的那件事一直是「读侧会不会被顺带闸住」，而
    # `_route_for` 只回答「属于哪个表盘」。旧写法让一次正当的路由扩张看起来像回归。
    assert _route_for("/team/ctx_abc/files/0") == "ingest"
    assert is_guarded("ingest", "POST") and is_guarded("ingest", "DELETE")
    # 🔴 读侧仍然直通：文件清单与逐份下载一个字节没变。
    assert not is_guarded("ingest", "GET")
    assert not is_guarded(None, "POST")


def test_the_team_payload_flags_a_disposable_clone(client):
    """T10 · 前端按 `ephemeral` 藏掉「补资料」入口，而这个判据必须禁得住刷新页面 ——
    所以它每次 `GET /team/{id}` 都在，不像 `demo` 那样只在领取的首帧出现。"""
    from avery.ingest.registry import REGISTRY
    cid, hdr = _ingest(client)
    assert "ephemeral" not in client.get(f"/team/{cid}", headers=hdr).json(), (
        "真公司不该带这个键（absent≠none）")
    assert REGISTRY.is_ephemeral(cid) is False
    assert REGISTRY.clone_context(cid, new_context_id="ctx_twin", new_owner_token="tok_twin")
    assert REGISTRY.is_ephemeral("ctx_twin") is True
    twin = client.get("/team/ctx_twin", headers={"X-Avery-Token": "tok_twin"}).json()
    assert twin["ephemeral"] is True


def test_a_registry_without_the_probe_reports_not_ephemeral(client):
    """Duck-typed + fail-open，且方向与 `account_owns_context` **相反**是故意的：那边答的是
    「要不要放行一次读」，出错必须拒绝；这边答的只是「入口要不要藏起来」，出错时少显示一个入口
    的代价是**真公司的经理补不了资料**。"""
    from service.ingest_api import _registry_says_ephemeral

    class _Old:
        pass

    class _Angry:
        def is_ephemeral(self, context_id):
            raise RuntimeError("db hiccup")

    assert _registry_says_ephemeral(_Old(), "ctx") is False
    assert _registry_says_ephemeral(_Angry(), "ctx") is False


# =============================================================================================
# §6 · @needs_db —— 真库那一层（离线套看不到 pg 持久层）
# =============================================================================================

def _db_url() -> str | None:
    return (os.environ.get("AVERY_DB_URL") or os.environ.get("PGVECTOR_URL") or "").strip() or None


def _skip_without_db() -> str:
    url = _db_url()
    if not url:
        pytest.skip("needs AVERY_DB_URL (or PGVECTOR_URL) pointing at a Postgres")
    pytest.importorskip("psycopg")
    return url


class _CountingEmbedder:
    """真库那条路上的花费探针：记下每一次 embed 收到的文本（`_material_vectors` 会调它）。"""

    def __init__(self, dim: int = 1024):
        from avery.ingest.store import HashingEmbedder
        self._inner = HashingEmbedder(dim)
        self.texts: list[list[str]] = []

    def embed(self, texts):
        self.texts.append(list(texts))
        return self._inner.embed(texts)


@needs_db
def test_append_preserves_the_past_and_embeds_only_the_increment(tmp_path):
    """真库端到端：旧文档字节保全 + **只嵌增量** + 重开一个 registry 实例还能读回来。

    离线套看不到这一层：内存 registry 的 `put` 是一次 dict 赋值，而 pg 的 put 是
    DELETE+INSERT 快照替换。这条门就是命门①在真库上的判据。
    """
    url = _skip_without_db()
    from avery.ingest.pg_registry import PostgresContextRegistry
    emb = _CountingEmbedder()
    reg = PostgresContextRegistry(url, data_dir=tmp_path / "data", embedder=emb)
    cid = "ctx_t10_db"
    files = [_write(tmp_path, "员工花名册.md", ROSTER_V1),
             _write(tmp_path, "项目周报.md", PROJECT_V1)]
    try:
        rep = ingest_paths([str(p) for p in files], registry=reg, work_dir=tmp_path / "mem",
                           context_id=cid, name="别墅酒店", owner_token="tok_db",
                           embedder=emb, prefer_vector=True,
                           source_documents=[_sd(p, OLD_AT) for p in files])
        assert rep.ok
        before_bytes = reg.source_document_bytes(cid, 0)
        before_chunks = {c["filename"]: c["n_chunks"] for c in reg.get(cid).file_cards()}

        emb.texts.clear()
        p = _write(tmp_path, "本周周报.md", PROJECT_V2)
        out = append_paths_to_context(reg, cid, [str(p)], [_sd(p, NEW_AT)])
        assert out.ok, out.parse_errors

        embedded = [t for batch in emb.texts for t in batch]
        assert embedded, "一次都没嵌——这条门在数一个恒空的东西"
        assert all("雨季" in t or "受阻" in t or "别墅套餐推广" in t or "周雅婷" in t or
                   "2026-10-15" in t or "55" in t or "进度" in t or "截止" in t or "负责人" in t
                   for t in embedded), (
            f"补传把存量语料也重嵌了一遍（花钱与资料总量成正比）：{embedded}")

        fresh = PostgresContextRegistry(url, data_dir=tmp_path / "data2", embedder=emb)
        ctx = fresh.get(cid)
        assert reg.source_document_bytes(cid, 0) == before_bytes, "旧文档的原件字节没了"
        cards = {c["filename"]: c["n_chunks"] for c in ctx.file_cards()}
        for name, n in before_chunks.items():
            assert cards[name] == n, f"{name} 的块数在补传之后变了"
        assert ctx.project_cards()[0]["status"] == "blocked", "真库读回来的卡还是旧读数"
    finally:
        reg.delete(cid)


@needs_db
def test_a_hand_edit_survives_an_append_across_a_real_round_trip(tmp_path):
    """票面点名的那条 needs_db 判据 —— **「补传后旧手编不丢」**。

    离线套证明不了它：内存 registry 的 `get()` 返回的是同一个活对象，手编字段「还在」是**必然**，
    因为根本没有序列化那一步。真库这一趟才会把实体 asdict 出去、DELETE、再 INSERT 回来——
    `provenance` / `archived` 少写一列或少读一列，都只在这里现形（5 型真库 bug 的老坑）。
    """
    url = _skip_without_db()
    from avery.ingest.pg_registry import PostgresContextRegistry
    reg = PostgresContextRegistry(url, data_dir=tmp_path / "data")
    cid = "ctx_t10_manual"
    files = [_write(tmp_path, "员工花名册.md", ROSTER_V1),
             _write(tmp_path, "项目周报.md", PROJECT_V1)]
    try:
        assert ingest_paths([str(p) for p in files], registry=reg, work_dir=tmp_path / "mem",
                            context_id=cid, name="别墅酒店", owner_token="tok_m",
                            source_documents=[_sd(p, OLD_AT) for p in files]).ok

        zhou = next(p for p in reg.get(cid).extraction.people if p.name == ZHOU)
        reg.patch_person(cid, zhou.id, {"team": "行政部", "role": "行政经理"})
        other = next(p for p in reg.get(cid).extraction.people if p.name != ZHOU)
        reg.archive_person(cid, other.id)
        reg.patch_project(cid, reg.get(cid).extraction.projects[0].id, {"summary": "经理手写的摘要"})

        p = _write(tmp_path, "新花名册.md", ROSTER_V2)
        assert append_paths_to_context(reg, cid, [str(p)], [_sd(p, NEW_AT)]).ok
        p2 = _write(tmp_path, "本周周报.md", PROJECT_V2)
        assert append_paths_to_context(reg, cid, [str(p2)], [_sd(p2, NEW_AT)]).ok

        fresh = PostgresContextRegistry(url, data_dir=tmp_path / "data2").get(cid)
        again = next(p for p in fresh.extraction.people if p.name == ZHOU)
        assert again.team == "行政部" and again.role == "行政经理", "补传把手编的人卡改回去了"
        assert again.provenance["team"]["origin"] == "manual", "手编出处在真库往返里丢了"
        assert [p.archived for p in fresh.extraction.people if p.name != ZHOU] == [True], (
            "经理归档过的人被补传复活了")
        proj = fresh.extraction.projects[0]
        assert proj.summary == "经理手写的摘要", "补传把手编的项目摘要顶掉了"
        assert proj.status == "blocked", "手编的摘要保住了，但文档该更新的格子没更新"
        assert proj.provenance["status"]["origin"] == "doc", "doc 出处在真库往返里丢了"
    finally:
        reg.delete(cid)


@needs_db
def test_conflicts_do_not_double_across_a_real_round_trip(tmp_path):
    """自证门在真库上再跑一遍 —— `conflicts` 是**跨 get() 持久**的那张表，账本从它重建。
    内存里绿、真库里翻倍，正是坑② 最可能的现形方式。"""
    url = _skip_without_db()
    from avery.ingest.pg_registry import PostgresContextRegistry
    reg = PostgresContextRegistry(url, data_dir=tmp_path / "data")
    cid = "ctx_t10_conf"
    files = [_write(tmp_path, "员工花名册.md", ROSTER_V1),
             _write(tmp_path, "项目周报.md", PROJECT_V1)]
    try:
        assert ingest_paths([str(p) for p in files], registry=reg, work_dir=tmp_path / "mem",
                            context_id=cid, name="别墅酒店", owner_token="tok_c",
                            source_documents=[_sd(p, OLD_AT) for p in files]).ok
        a = _write(tmp_path, "新花名册.md", ROSTER_V2)
        assert append_paths_to_context(reg, cid, [str(a)], [_sd(a, NEW_AT)]).ok
        once = [(c.subject_kind, c.field, len(c.values))
                for c in PostgresContextRegistry(url, data_dir=tmp_path / "d2")
                .get(cid).extraction.conflicts]
        assert once, "一条冲突都没记 —— 这条门在数一个恒空的东西"

        b = _write(tmp_path, "新花名册(1).md", ROSTER_V2)
        sd = _sd(b, NEW_AT)
        sd.filename = "新花名册.md"
        assert append_paths_to_context(reg, cid, [str(b)], [sd]).ok
        twice = [(c.subject_kind, c.field, len(c.values))
                 for c in PostgresContextRegistry(url, data_dir=tmp_path / "d3")
                 .get(cid).extraction.conflicts]
        assert twice == once, f"同一批语料补传两次，真库上冲突翻倍了：{once} → {twice}"
    finally:
        reg.delete(cid)


@needs_db
def test_the_pg_registry_answers_is_ephemeral_the_same_way_the_memory_twin_does(tmp_path):
    """双胞胎对齐：两个适配器对同一个问题必须给同一个答案（`ContextRegistryProtocol` 的口径）。"""
    url = _skip_without_db()
    from avery.ingest.pg_registry import PostgresContextRegistry
    reg = PostgresContextRegistry(url, data_dir=tmp_path / "data")
    cid, twin = "ctx_t10_eph", "ctx_t10_eph_twin"
    p = _write(tmp_path, "项目周报.md", PROJECT_V1)
    try:
        assert ingest_paths([str(p)], registry=reg, work_dir=tmp_path / "mem", context_id=cid,
                            name="别墅酒店", owner_token="tok_e",
                            source_documents=[_sd(p, OLD_AT)]).ok
        assert reg.is_ephemeral(cid) is False, "put() 建出来的母本不是一次性的"
        assert reg.is_ephemeral("ctx_never_existed") is False
        assert reg.clone_context(cid, new_context_id=twin, new_owner_token="tok_t")
        assert reg.is_ephemeral(twin) is True, "克隆没被标成一次性的，GC 也就收不走它"
    finally:
        reg.delete(twin)
        reg.delete(cid)

