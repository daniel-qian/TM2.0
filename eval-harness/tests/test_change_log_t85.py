# -*- coding: utf-8 -*-
"""issue #85 · 「这次补料改了什么」只读清单 —— **后端那一半**（Danny 拍板 B 的前半）。

本票的主体在前端（`src/lite2/changeLog.ts` + 资料库左栏那一区），后端只做两件事：

  ① `lineage["added_in"]` —— 新建的卡记下**出生批次**。#87 建的血缘只回答「这一格是谁写的」，
     而新卡一格都没被顶掉：它的 `fields` 全是 `seeded`、`provenance` 一个键都没有，于是
     「这批资料新增了两位同事」在卡上**结构性地留不下任何痕迹**（票面「缺的三样」之二）。
  ② `_one_person_card` / `_one_project_card` 把 `lineage` **原样**投给浏览器（additive key，
     缺就不发，同 `provenance`）。#87 刻意没投（它是纯地基），本票是它的第一个消费者。

🔴 §3 是本文件的重心，也是与前端唯一的契约面：**「这一格算不算一条改动」只许有一把尺**，
   而那把尺同时要读两本账（`provenance[f].origin` 判这一格现在归谁 · `lineage.fields[f]` 判
   它的文档血缘）。前端 `changeLog.ts` 照这把尺渲染，这里对着**同一份真 payload** 把四种格子
   逐类钉死——两边漂开时这一段先红。

⚠ 票面原方案是加一个 additive 的 `payload["conflicts"]`（旧值只覆盖 3/10 个字段）。#87 在
  2026-08-10 已落地并进了本地 main，它的 `fields[f].prev` 覆盖**全部 14 个**文档可写格子，
  所以本票改走血缘那条路——票面自己写着「要全部字段都给前后值就得等 #87」。回执 §2 记着这笔。

零真 LLM：`AVERY_BRAIN=mock` + `AVERY_EXTRACTOR=heuristic` + `AVERY_EMBEDDINGS=keyword`。
"""
from __future__ import annotations

from pathlib import Path

import pytest

from avery.ingest import ingest_paths
from avery.ingest.extract import (
    AppendLedger, ExtractionResult, PersonEntity, ProjectEntity,
    batch_id_for, merge_person_reading, merge_project_reading,
)
from avery.ingest.file_append import append_paths_to_context
from avery.ingest.registry import ContextRegistry, SourceDocument

needs_db = pytest.mark.needs_db

OLD_DOC, NEW_DOC = "项目台账.md", "旺季排班协调纪要.md"
OLD_AT, NEW_AT = "2026-08-01T09:00:00+00:00", "2026-08-09T09:00:00+00:00"
TITLE = "婚宴对接"
OLD_OWNER, NEW_OWNER = "老周", "小马"
NEW_TITLE = "春节值班排布"
NEW_PERSON = "林小满"


@pytest.fixture(autouse=True)
def _offline(monkeypatch):
    monkeypatch.setenv("AVERY_EMBEDDINGS", "keyword")
    monkeypatch.setenv("AVERY_BRAIN", "mock")
    monkeypatch.setenv("AVERY_EXTRACTOR", "heuristic")
    monkeypatch.delenv("AVERY_ALLOW_PERSON_SCORING", raising=False)


# --- 手搭件（与 test_entity_lineage_t87 同形，刻意不跨文件 import：那边是地基的判据，
#     这边是消费者的判据，共用一份 fixture 等于让两票的红绿绑在一起）-----------------------

def _sdoc(source_key: str, uploaded_at: str) -> SourceDocument:
    return SourceDocument(filename=source_key, source_key=source_key, mime="text/markdown",
                          size_bytes=1, doc_kind="company", status="ingested",
                          uploaded_at=uploaded_at)


def _ledger(extraction: ExtractionResult, batch=(NEW_DOC,)) -> AppendLedger:
    return AppendLedger(extraction, [_sdoc(OLD_DOC, OLD_AT), _sdoc(NEW_DOC, NEW_AT)],
                        batch_keys=batch)


def _lin(entity) -> dict:
    return dict(getattr(entity, "lineage", None) or {})


def _write(tmp: Path, name: str, text: str) -> Path:
    p = tmp / name
    p.write_text(text, encoding="utf-8")
    return p


def _sd(path: Path, uploaded_at: str) -> SourceDocument:
    return SourceDocument(filename=path.name, source_key=path.name, mime="text/markdown",
                          size_bytes=path.stat().st_size, content=path.read_bytes(),
                          uploaded_at=uploaded_at)


ROSTER = "\n".join([
    "# 别墅酒店 员工花名册", "",
    "姓名 | 人员ID | 部门 | 职位 | 司龄",
    "周雅婷 | MKT-001 | 市场推广部 | 市场专员 | 3年",
])
LEDGER_V1 = "\n".join([f"# {TITLE}", f"负责人：{OLD_OWNER}", "状态：进行中", "截止：2026-09-30"])
# ⚠ 一份文档 = **一张**项目卡（标题取第一个 `#`，后面的键行全并进同一张）。第一版语料把
# 「改写 + 新项目 + 新同事」塞进一个文件里，结果三件事融成一张卡：`ownerName` 被最后那行顶成
# 了另一个人，新项目/新同事一张都没长出来，六条判据以「主体不存在」的形态红。所以补料这一批
# 是**三份单一用途的文档**——顺带也正是这条流水在屏幕上的分组单位（一份文件一组）。
NEW_BATCH = {
    # ① 顶掉负责人/状态（→ prev）· 补上原来空着的阻塞（→ enrichment，无 prev）
    NEW_DOC: "\n".join([
        f"# {TITLE}", f"负责人：{NEW_OWNER}", "状态：受阻", "阻塞：雨季无备选场地", "",
        f"本次旺季排班协调会决定，由宴会部{NEW_OWNER}接手{TITLE}的现场排班。"]),
    # ② 名册上没有的一张新项目卡（→ added_in）
    f"{NEW_TITLE}.md": "\n".join([
        f"# {NEW_TITLE}", "负责人：周雅婷", "状态：进行中", "截止：2027-02-20"]),
    # ③ 名册上没有的一位新同事（→ added_in）
    "前厅部花名册.md": "\n".join([
        "# 别墅酒店 前厅部花名册", "",
        "姓名 | 人员ID | 部门 | 职位 | 司龄",
        f"{NEW_PERSON} | FO-0422 | 前厅部 | 前厅主管 | 2年"]),
}
BATCH_ID = batch_id_for(list(NEW_BATCH))


def _seed(tmp: Path, reg: ContextRegistry, cid: str = "ctx_t85") -> str:
    files = [_write(tmp, "员工花名册.md", ROSTER), _write(tmp, OLD_DOC, LEDGER_V1)]
    rep = ingest_paths([str(p) for p in files], registry=reg, work_dir=tmp / "mem",
                       context_id=cid, name="别墅酒店", owner_token="tok_t85",
                       source_documents=[_sd(p, OLD_AT) for p in files])
    assert rep.ok, "种子语料自己就没进去，下面的断言什么都证明不了"
    return cid


def _append(tmp: Path, reg: ContextRegistry, cid: str, batch: dict | None = None,
            at: str = NEW_AT):
    """补一整批（默认 `NEW_BATCH` 那三份）。批次号 = 这一批文件名的确定性哈希。"""
    paths = [_write(tmp, name, text) for name, text in (batch or NEW_BATCH).items()]
    return append_paths_to_context(reg, cid, [str(p) for p in paths],
                                   [_sd(p, at) for p in paths])


# =============================================================================================
# §1 · added_in —— 「这张卡是哪一批补传新建的」
# =============================================================================================

@pytest.mark.parametrize("kind", ["person", "project"])
def test_a_card_a_batch_created_records_the_batch_that_created_it(kind):
    """票面「缺的三样」之二的可执行版本：新建的卡此前在补料清单里**结构性地看不见**。"""
    res = ExtractionResult()
    ledger = _ledger(res)
    if kind == "person":
        merge_person_reading(res.people, PersonEntity(
            id="u_lin", name=NEW_PERSON, role="前厅主管", source=f"{NEW_DOC}:11"), ledger=ledger)
        made = res.people[0]
    else:
        merge_project_reading(res.projects, ProjectEntity(
            id="p_spring", title=NEW_TITLE, source=f"{NEW_DOC}:6"), ledger=ledger)
        made = res.projects[0]
    assert _lin(made).get("added_in") == batch_id_for([NEW_DOC])


@pytest.mark.parametrize("kind", ["person", "project"])
def test_being_mentioned_by_a_batch_is_not_being_born_in_it(kind):
    """🔴 出生 ≠ 被碰过。存量卡被这批资料改写了一格，`added_in` 仍然**不许**出现——否则
    「这次补料新增了谁」里会冒出一张三个月前的老卡，只因为今天有份文件提了它一句。
    （`fields[f].batch_id` 才是「最近一次被哪批写的」，两个键各答各的。）"""
    if kind == "person":
        cur = PersonEntity(id="u_zhou", name="周雅婷", team="市场推广部", source=f"{OLD_DOC}:3")
        res = ExtractionResult(people=[cur])
        merge_person_reading(res.people, PersonEntity(
            id="x", name="周雅婷", team="前厅部", source=f"{NEW_DOC}:3"), ledger=_ledger(res))
    else:
        cur = ProjectEntity(id="p_banquet", title=TITLE, ownerName=OLD_OWNER,
                            source=f"{OLD_DOC}:7")
        res = ExtractionResult(projects=[cur])
        merge_project_reading(res.projects, ProjectEntity(
            id="x", title=TITLE, ownerName=NEW_OWNER, source=f"{NEW_DOC}:7"), ledger=_ledger(res))
    assert "added_in" not in _lin(cur), "被改写的存量卡不是这一批生的"
    fields = _lin(cur).get("fields") or {}
    touched = [f for f, rec in fields.items() if rec.get("batch_id")]
    assert touched, "这一趟一格都没写进去 —— 上面那条断言是空真"


def test_a_first_upload_card_has_no_birth_batch(tmp_path):
    """首次 `/ingest` 没有账本、没有批次号 —— 一张卡都不该带 `added_in`。
    带上的话，第一次上传自己就会显示成一整屏「新增了…」的补料流水。"""
    reg = ContextRegistry()
    ctx = reg.get(_seed(tmp_path, reg))
    made = list(ctx.extraction.people) + list(ctx.extraction.projects)
    assert made, "种子语料一张卡都没抽出来 —— 判据够不着"
    assert all("added_in" not in _lin(e) for e in made)


def test_a_form_submission_creating_a_person_is_not_a_material_change():
    """表单回流建的新人卡**不进**这条流水：它没有账本，`note_added_in` 自己就不记。

    不是漏做——「这次补料改了什么」讲的是**文件**那条路，员工交表另有「谁交了」那一屏。
    这条判据把那个边界钉住，免得哪天顺手给回流路补个 ledger 就把两条流水混成一条。"""
    res = ExtractionResult()
    merge_person_reading(res.people, PersonEntity(
        id="u_new", name="新同事", source=""), ledger=None)
    assert _lin(res.people[0]).get("added_in") is None


def test_the_birth_batch_is_written_once_and_never_rewritten():
    """出生批次不跟着「最后一次被提到的批次」跑：第三批资料改了这张卡一格，它仍然属于
    生它的那一批。会改写的话，「这次补料新增了谁」里会年年冒出同一张老卡。

    ⚠ 这条判据真正钉住的是**调用点的位置**（只在 append 分支调），不是 `note_added_in`
    里那句「已经有就不改」——那一句在现行链路上够不着（见它的 docstring 与变异 M-B）。"""
    made = ProjectEntity(id="p_spring", title=NEW_TITLE, source=f"{NEW_DOC}:6")
    res = ExtractionResult()
    merge_project_reading(res.projects, made, ledger=_ledger(res))
    first = _lin(made).get("added_in")
    later = AppendLedger(res, [_sdoc(OLD_DOC, OLD_AT), _sdoc(NEW_DOC, NEW_AT)],
                         batch_keys=["第三批.md"])
    merge_project_reading(res.projects, ProjectEntity(
        id="x", title=NEW_TITLE, status="进行中", source="第三批.md:2"), ledger=later)
    assert _lin(made).get("added_in") == first == batch_id_for([NEW_DOC])


def test_the_real_append_chain_lands_the_birth_batch_on_the_stored_card(tmp_path):
    """走真链路（`append_paths_to_context` → get → 原地 mutate → put）：出生批次要活到
    `reg.get()` 回来的那一份上。只写在活对象上而没落库，内存腿看不出差别。"""
    reg = ContextRegistry()
    cid = _seed(tmp_path, reg)
    before = {pr.title for pr in reg.get(cid).extraction.projects}
    assert NEW_TITLE not in before, "基准：补料之前没有这张卡"

    assert _append(tmp_path, reg, cid).ok
    ctx = reg.get(cid)
    born = next(pr for pr in ctx.extraction.projects if pr.title == NEW_TITLE)
    assert _lin(born).get("added_in") == BATCH_ID
    old = next(pr for pr in ctx.extraction.projects if pr.title == TITLE)
    assert "added_in" not in _lin(old), "存量卡被改写了，但它不是这一批生的"


# =============================================================================================
# §2 · 投影 —— 血缘上线（#87 的 `assert "lineage" not in card` 由本票改判）
# =============================================================================================

@pytest.mark.parametrize("kind", ["person", "project"])
def test_the_card_carries_the_lineage_byte_for_byte(tmp_path, kind):
    """🔴 **原样**投出去，不在投影层挑「变过的那几格」。

    挑的话，「算不算一条改动」这条口径就同时长在投影层和前端两处，而屏幕上真正在用的是
    前端那份——这里挑漏一条，谁也不会红。判据落在**整本相等**上，不落在「有几个键」
    （后者对着一个偷偷砍掉 prev 链的投影照样全绿）。"""
    reg = ContextRegistry()
    cid = _seed(tmp_path, reg)
    assert _append(tmp_path, reg, cid).ok
    ctx = reg.get(cid)
    entities, cards = ((ctx.extraction.people, ctx.team_cards()) if kind == "person"
                       else (ctx.extraction.projects, ctx.project_cards()))
    by_id = {c["id"]: c for c in cards}
    assert by_id, "一张卡都没投出来 —— 下面是空真"
    checked = 0
    for e in entities:
        card = by_id.get(e.id)
        if card is None:              # 归档的卡走另一条投影，这一条不判它
            continue
        assert card.get("lineage") == (_lin(e) or None) or (
            not _lin(e) and "lineage" not in card), f"{e.id} 的血缘没有原样上线"
        checked += 1
    assert checked, "一条都没对上 —— 判据够不着"


def test_a_card_without_a_lineage_sends_no_key_at_all(tmp_path):
    """absent≠none（全仓姿态，同 provenance）：手编卡的血缘恒空，那就一个字节都不发。
    发个 `{}` 出去，前端「这张卡有没有文档依据」就得多认一种取值。"""
    reg = ContextRegistry()
    cid = _seed(tmp_path, reg)
    ctx = reg.get(cid)
    reg.add_person(cid, {"name": "手加的人", "role": "顾问"})
    ctx = reg.get(cid)
    hand = next(p for p in ctx.extraction.people if p.name == "手加的人")
    assert not _lin(hand), "手编卡本就该没有文档血缘（#87 的口径）"
    card = next(c for c in ctx.team_cards() if c["id"] == hand.id)
    assert "lineage" not in card


def test_no_person_number_can_ride_in_on_the_lineage(tmp_path):
    """🔴 红线兜底：人卡上不许出现任何人身数字，而 `lineage` 是个**对象**——
    `stripPersonNumbers` 只剥顶层裸数字，对象整键放行（provenance 就是这么过去的）。

    所以护栏必须长在**跟踪面**本身：`_lineage_fields('person')` 刻意不含 `self_report`
    （#87 §「刻意不跟的」），于是人卡血缘里结构上就没有数字的位置。这条判据扫真 payload
    的每一个叶子，哪天有人把自述加进跟踪面，它先红。"""
    reg = ContextRegistry()
    cid = _seed(tmp_path, reg)
    assert _append(tmp_path, reg, cid).ok
    cards = reg.get(cid).team_cards()
    seen = [c for c in cards if c.get("lineage")]
    assert seen, "补料之后一张带血缘的人卡都没有 —— 判据够不着"

    def leaves(node):
        if isinstance(node, dict):
            for v in node.values():
                yield from leaves(v)
        elif isinstance(node, (list, tuple)):
            for v in node:
                yield from leaves(v)
        else:
            yield node

    for card in seen:
        bad = [v for v in leaves(card["lineage"]) if isinstance(v, (int, float))
               and not isinstance(v, bool)]
        assert not bad, f"人卡血缘里混进了数字：{bad}"


# =============================================================================================
# §3 · 契约面 —— 「这一格算不算一条改动」的那把尺（前端 changeLog.ts 照它渲染）
# =============================================================================================
#
# 四类格子，对着**同一份真 payload** 逐类钉死。前端那份实现漂开时，这一段先红。
#   ① 被更新的资料顶掉      → origin=='doc' 且 lineage.fields[f].prev 在   → 一行「从 X 改成 Y」
#   ② 被补上（原来空着）    → origin=='doc' 且**没有** prev                 → 一行「补上了 Y」
#   ③ 首次上传就有的        → 根本没有 provenance                          → 不出现
#   ④ 经理手编过的          → origin=='manual'                             → 不出现（屏上那个
#      值不是文档写的，说成「资料把它改成了 Y」是假话；血缘里的 prev 照旧留着给票 7）

@pytest.fixture
def payload(tmp_path):
    """一次真补料之后的 `/team` 载荷 + 它背后的 context。"""
    reg = ContextRegistry()
    cid = _seed(tmp_path, reg)
    assert _append(tmp_path, reg, cid).ok
    ctx = reg.get(cid)
    return ctx, {c["id"]: c for c in ctx.project_cards()}, {c["id"]: c for c in ctx.team_cards()}


def _cell(card: dict, fname: str) -> tuple[str, dict]:
    """屏幕那把尺：(这一格现在归谁, 它的文档血缘记录)。"""
    origin = str(((card.get("provenance") or {}).get(fname) or {}).get("origin") or "")
    return origin, dict(((card.get("lineage") or {}).get("fields") or {}).get(fname) or {})


def test_an_overwritten_cell_carries_both_halves_of_from_x_to_y(payload):
    """①「从 X 改成 Y」：新值在卡上、旧值在 `prev.value`、两边各自的引文都带行号。
    ⚠ 判据落在**旧值那一半**上——只断言「有 prev 键」的话，一个恒发 `{}` 的实现照样全绿。"""
    _, projects, _ = payload
    card = next(c for c in projects.values() if c["title"] == TITLE)
    origin, rec = _cell(card, "ownerName")
    assert card["ownerName"] == NEW_OWNER
    assert origin == "doc"
    assert rec["prev"]["value"] == OLD_OWNER
    assert rec["source"].startswith(f"{NEW_DOC}:"), "新值的引文指新资料"
    assert rec["prev"]["source"].startswith(f"{OLD_DOC}:"), "旧值的引文指老资料"


def test_a_cell_filled_from_empty_is_a_change_with_no_old_half(payload):
    """②「补上了 Y」：enrichment 也是一条改动（空 → 有值），但它**没有毁掉任何读数**，
    所以不许挂 prev。挂上的话清单会说「从（空）改成 Y」，凭空发明一个旧读数。"""
    _, projects, _ = payload
    card = next(c for c in projects.values() if c["title"] == TITLE)
    origin, rec = _cell(card, "blockers")
    assert card["blockers"], "第二批资料本该补上阻塞 —— 判据够不着"
    assert origin == "doc"
    assert "prev" not in rec


def test_a_cell_only_the_first_upload_ever_wrote_stays_off_the_list(payload):
    """③ 首次上传的格子一条都不该进流水。它们**结构上**就没有 provenance
    （`stamp()` 只在补传/手编/表单回流三处开火）——这正是本票便宜的全部理由。"""
    _, _, people = payload
    card = next(c for c in people.values() if c["name"] == "周雅婷")
    origin, rec = _cell(card, "role")
    assert card["role"], "这一格得真有值，否则下面是空真"
    assert origin == "", "首次上传不盖 provenance 戳"
    assert rec.get("seeded") is True, "它的血缘是**推**出来的，不是写路记下来的"


def test_a_hand_edited_cell_drops_off_the_list_but_keeps_its_prev(tmp_path):
    """④ 经理手编之后这一格就**不再由文档说了算**（ADR-0028 手编赢）。

    清单必须放掉它：屏上那个值是经理写的，说成「《某文件》把它改成了 Y」是假话。
    但血缘里的 `prev` 照旧留着——票 7 的撤回要的正是它。两句话一条判据里都断，
    与 #87 的 `test_a_manual_edit_leaves_the_document_lineage_standing` 是同一条分工。"""
    reg = ContextRegistry()
    cid = _seed(tmp_path, reg)
    assert _append(tmp_path, reg, cid).ok
    ctx = reg.get(cid)
    pr = next(x for x in ctx.extraction.projects if x.title == TITLE)
    reg.patch_project(cid, pr.id, {"ownerName": "经理亲自填的"})
    ctx = reg.get(cid)
    card = next(c for c in ctx.project_cards() if c["id"] == pr.id)
    origin, rec = _cell(card, "ownerName")
    assert origin == "manual", "手编赢"
    assert rec["prev"]["value"] == OLD_OWNER, "文档血缘还站着（票 7 要写回的那一半）"


def test_a_born_card_is_visible_without_any_provenance_at_all(payload):
    """新建的卡走的是 `added_in` 那条路，与上面四类格子**正交**：它一格都没被顶掉，
    所以 provenance 恒空、`fields` 全是 seeded。没有 `added_in` 就彻底看不见。"""
    _, projects, people = payload
    born = next(c for c in projects.values() if c["title"] == NEW_TITLE)
    assert not born.get("provenance"), "新卡本来就没有出处戳"
    assert (born.get("lineage") or {}).get("added_in") == BATCH_ID
    joined = next((c for c in people.values() if c["name"] == NEW_PERSON), None)
    assert joined is not None, "第二批资料里那位新同事没抽出来 —— 判据够不着"
    assert (joined.get("lineage") or {}).get("added_in") == BATCH_ID


def test_every_row_can_name_the_file_it_came_from(payload):
    """流水按**文件**分组（引文就是那份文件的哪一行），所以每一条候选行都必须解得出文件名。
    解不出来的行只能挂在一个空标题下——那正是「兜底文案把一条都没召回伪装成正常」的形状。"""
    ctx, projects, people = payload
    rows = 0
    for card in list(projects.values()) + list(people.values()):
        for fname, rec in ((card.get("lineage") or {}).get("fields") or {}).items():
            origin = str(((card.get("provenance") or {}).get(fname) or {}).get("origin") or "")
            if origin != "doc":
                continue
            src = str(rec.get("source") or "")
            assert ":" in src and src.split(":", 1)[0], f"{card['id']}.{fname} 的引文没有文件名"
            rows += 1
        if (card.get("lineage") or {}).get("added_in"):
            docs = (card.get("lineage") or {}).get("docs") or []
            assert docs, f"{card['id']} 是新建卡却说不出来自哪份文件"
            rows += 1
    assert rows >= 4, f"真补料只解出 {rows} 条候选行 —— 语料喂不饱，上面几条都在空判"


# =============================================================================================
# §4 · 真库那一层 —— 离线套对 pg 持久层是瞎的，而且它以「全绿」的形态骗你
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
def test_the_birth_batch_survives_a_real_postgres_round_trip(tmp_path):
    """`added_in` 是 `lineage` **里面**的一个嵌套键，所以 0009 的顶层 allowlist 不用动
    （#87 已经把 `lineage` 加进去了）——但「不用动」是个读码推断，这条把它变成实测。

    内存腿的 `get()` 返回活引用，写进去的东西恒在；pg 腿是 `asdict` → jsonb → `Entity(**payload)`
    的往返，`__post_init__` 会在回读时再跑一次 `_init_lineage`。它要是把 `added_in` 洗掉，
    离线一条都不红。

    🔴 `get()` 用**另起一个** registry 实例：同一个实例可能把 context 留在进程内缓存里，
    那样「活过一次真往返」就退化成「内存里还在」（#87 §6 逐字同一条纪律）。"""
    url = _skip_without_db()
    from avery.ingest.pg_registry import PostgresContextRegistry
    reg = PostgresContextRegistry(url, data_dir=tmp_path / "data")
    cid = _seed(tmp_path, reg, cid="ctx_t85_db")
    try:
        assert _append(tmp_path, reg, cid).ok
        ctx = PostgresContextRegistry(url, data_dir=tmp_path / "data2").get(cid)
        born = next(pr for pr in ctx.extraction.projects if pr.title == NEW_TITLE)
        assert _lin(born).get("added_in") == BATCH_ID
        card = next(c for c in ctx.project_cards() if c["id"] == born.id)
        assert (card.get("lineage") or {}).get("added_in") == BATCH_ID
        old = next(pr for pr in ctx.extraction.projects if pr.title == TITLE)
        rec = (_lin(old).get("fields") or {}).get("ownerName") or {}
        assert rec["prev"]["value"] == OLD_OWNER, "prev 链也得活过一次真往返"
    finally:
        reg.delete(cid)
