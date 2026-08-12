# -*- coding: utf-8 -*-
"""设计0810 · #86 ·「清空这份档案」—— registry 双腿 + HTTP 端点 + 真库那一层。

Danny 0810 拍板：**不要有「新建」的概念**。一个人从头到尾就一份档案——往里加文件、从里删
文件；真要从头来是**清空这一份**（`context_id` / `owner_token` 不变），不是另开一份。

判据分五段：

  §1 registry 语义（离线，内存腿）—— 清掉什么、**留下什么**。留的那一半才是这张票的全部
     意义：清掉一切很容易（`pg_registry.delete()` 早就在了），难的是清完之后**这份档案还在**。
  §2 记忆面 —— facts.md / notes.md 必须当场重物化成空。清单空了而磁盘上那份旧文本还在，
     议事室照旧引得到已经清掉的原文，正是这一票要防的失败形态（同 #77 的命门③）。
  §3 HTTP 端点 —— 鉴权门（无 token / 错 token 一律 404 且**什么都没被清**）、回执形状、
     **清空之后老 owner_token 仍然打得开这份档案**（这一条就是「档案还在」的可执行定义）。
  §4 🔴 那颗明知的雷 —— 留着员工答卷意味着 `POST /team/{id}/forms/{sub}/ingest` 之后还能把
     实体重新灌回来：「清空」**不会自己保持为空**。本段把这个语义**钉成正面判据**，
     免得下一个人把它当 bug 顺手「修」掉，或者反过来以为清空是永久的。
  §5 @needs_db —— 真库那一层。🔴 **离线层证明不了任何「真的没了」**：内存 registry 的
     `get()` 返回同一个活对象，「清空」在那里退化成「我改了这个对象然后又读了这个对象」。
     没有这一段，本票 100% 复刻仓里那条「pg 腿的洞绿着上线」的事故
     （`test_registry_contract.py` 的 offline-guard 块记着 2026-07-23 那一次）。

两条腿的**逐字一致性**不在本文件——它在 `test_registry_contract.py` 的 `impl` 参数化里
（memory 离线跑 + postgres 挂 @needs_db），那才是「一套判据两个实现」的正确落点。

零真 LLM：三件套缺一真烧钱。
"""
from __future__ import annotations

import os
import uuid
from dataclasses import fields as dataclass_fields
from pathlib import Path

import pytest

from avery import memory
from avery.ingest import ingest_paths
from avery.ingest.extract import ExtractionResult
from avery.ingest.form import (
    FormSubmission, default_expiry, new_submission_id, now_iso, weekly_template,
)
from avery.ingest.registry import ContextRegistry, SourceDocument, materialize_memory

needs_db = pytest.mark.needs_db


def _db_url() -> str | None:
    return (os.environ.get("AVERY_DB_URL") or os.environ.get("PGVECTOR_URL") or "").strip() or None


@pytest.fixture(autouse=True)
def _offline(monkeypatch):
    monkeypatch.setenv("AVERY_EMBEDDINGS", "keyword")
    monkeypatch.setenv("AVERY_BRAIN", "mock")
    monkeypatch.setenv("AVERY_EXTRACTOR", "heuristic")
    monkeypatch.delenv("AVERY_ALLOW_PERSON_SCORING", raising=False)


# 语料：两份文档，各带只属于自己的正文行。中文字节是刻意的（门语料全 ASCII 是老盲点），
# 但检索判据押在 ASCII token 上——`KeywordStore._tokens` 的词表是 `[a-z0-9]+`，对无空格中文
# 恒为空，拿中文串断言「清空后检索不到」会全绿而它证明的是「清空前也检索不到」（#77 实收）。
ROSTER = "\n".join([
    "# 别墅酒店 员工花名册", "",
    "姓名 | 人员ID | 部门 | 职位 | 司龄",
    "周雅婷 | MKT-001 | 市场推广部 | 市场专员 | 3年",
    "林小满 | FO-0422 | 前厅部 | 前厅主管 | 2年",
])
BEO = "\n".join([
    "# 婚宴通知单与协调会纪要", "",
    "## 宴会通知单",
    "- 通知单编号：BEO-2026-0808（宴会销售部存档）",
    "- 宴会日期：2026 年 8 月 8 日（周六）晚宴",
    "- 场地：阳光草坪主场地 + 多功能厅备用（雨天启用）", "",
    "## 项目：婚宴对接", "",
    "负责人：小马",
    "自报状态：进行中",
    "进度：60%",
    "截止：2026-09-30",
    "阻碍项：婚庆外部团队的进场时点还没跟法务对齐",
    "概述：以阳光草坪为载体承接婚礼旺季档，宴会销售牵头、餐饮与房务配合。",
])
BEO_ASCII_TOKEN = "beo-2026-0808"
BEO_ONLY_LINE = "场地：阳光草坪主场地 + 多功能厅备用（雨天启用）"
OWNER_TOKEN = "tok_owner_86"


def _write(tmp: Path, name: str, text: str) -> Path:
    p = tmp / name
    p.write_text(text, encoding="utf-8")
    return p


def _sd(p: Path) -> SourceDocument:
    return SourceDocument(filename=p.name, source_key=p.name, mime="text/markdown",
                          size_bytes=p.stat().st_size, content=p.read_bytes(),
                          uploaded_at="2026-08-01T09:00:00+00:00")


def _seed(tmp: Path, reg, cid: str | None = None) -> str:
    """一家灌好底料的公司。返回 context_id。"""
    cid = cid or ("ctx_e86_" + uuid.uuid4().hex[:12])
    files = [_write(tmp, "花名册.md", ROSTER), _write(tmp, "婚宴纪要.md", BEO)]
    rep = ingest_paths([str(p) for p in files], registry=reg, work_dir=tmp / "mem",
                       context_id=cid, name="别墅酒店", owner_token=OWNER_TOKEN,
                       source_documents=[_sd(p) for p in files])
    assert rep.ok, f"种子语料自己就没进去，下面全是空判据：{rep.parse_errors}"
    return cid


def _assert_seeded(ctx) -> None:
    """自证判据：清空**之前**，每一个要被清的面都真的非空。少了这一条，§1 全段可以对着
    一个从来就是空的 context 全绿。"""
    assert ctx.source_documents, "语料没进 file space"
    assert ctx.source_files, "语料没进 source_files"
    assert ctx.extraction.materials, "一个材料块都没切出来"
    assert ctx.extraction.people, "一张人卡都没长出来"
    assert ctx.extraction.projects, "一张项目卡都没长出来"


def _submitted(cid: str, *, name="周雅", person_id="P-0007", period="2026-W32") -> FormSubmission:
    created = now_iso()
    return FormSubmission(
        id=new_submission_id(), context_id=cid, template_id="tpl_weekly",
        person_id=person_id, person_name=name, period=period,
        share_token="tok_form_" + uuid.uuid4().hex,
        answers=[{"field_id": "done", "value": "晚市翻台压到 25 分钟，本周没再排加班。"},
                 {"field_id": "load", "value": 72},
                 {"field_id": "mood", "value": "偏紧"}],
        submitted_at="2026-08-06T10:00:00+00:00",
        created_at=created, expires_at=default_expiry(created))


# ==============================================================================================
# §1 · registry 语义（离线，内存腿）
# ==============================================================================================

def test_empty_clears_every_file_derived_surface(tmp_path):
    reg = ContextRegistry()
    cid = _seed(tmp_path, reg)
    _assert_seeded(reg.get(cid))

    assert reg.empty_context(cid) is True

    ctx = reg.get(cid)
    assert ctx.source_documents == [], ctx.source_documents
    assert ctx.source_files == [], ctx.source_files
    assert ctx.file_cards() == [], ctx.file_cards()
    assert ctx.team_cards() == [] and ctx.project_cards() == []
    assert ctx.signal_cards() == [] and ctx.playbook_cards() == []
    assert ctx.archived_people_cards() == [] and ctx.archived_project_cards() == []


class _Sentinel:
    """一颗放进任意抽取列表的哨兵。鸭子面只需满足 `materialize_memory` 会碰到的那两样
    （`as_facts_lines()` / `.text`），这样「漏清某一条列表」的失败形态是**判据红**，
    而不是重物化时一声 AttributeError（崩掉也算红，但读日志的人看到的是堆栈不是结论）。"""

    text = "sentinel"

    def as_facts_lines(self):
        return []


def test_empty_clears_every_list_on_the_extraction_including_ones_added_later(tmp_path):
    """🔴 判据故意写成**按 dataclass 字段遍历 + 逐条塞哨兵**，不逐个点名七条列表。

    两层意思：

    ① 逐个点名的测试与逐个点名的实现会**一起漏**：下一个人往 `ExtractionResult` 上加第八条
       列表（`granularity` 与 `conflicts` 就是这么先后长出来的），实现漏清、测试照旧全绿。
    ② 🔴 光遍历还不够——真语料只喂得饱 `people/projects/materials/granularity` 四条，
       `signals/playbooks/conflicts` 在这份语料上**天生为空**。于是「漏清 signals」这条变异
       在只看真语料的判据下**活得下来**（本票写门时实测：7 条列表里只有 4 条非空）。
       所以清空之前先把每一条都塞满：判据这才对着**七条里的每一条**都有牙。
    """
    reg = ContextRegistry()
    cid = _seed(tmp_path, reg)
    ex = reg.get(cid).extraction
    listy = [f.name for f in dataclass_fields(ex) if isinstance(getattr(ex, f.name), list)]
    assert len(listy) >= 7, f"ExtractionResult 的列表字段只剩 {listy}——先查是不是被改瘦了"
    for name in listy:
        getattr(ex, name).append(_Sentinel())
    # 自证：塞完之后**每一条**都非空（否则下面的「全空」对那一条就是废话）。
    empties = [n for n in listy if not getattr(ex, n)]
    assert not empties, f"这些列表塞不进哨兵，判据够不着：{empties}"

    assert reg.empty_context(cid) is True

    after = reg.get(cid).extraction
    leftovers = {n: len(getattr(after, n)) for n in listy if getattr(after, n)}
    assert not leftovers, f"这些抽取列表没被清空：{leftovers}"


def test_empty_keeps_the_archive_itself(tmp_path):
    """票面的中心句：清空**不是**删档案。id / token / 名字 / 可达性全部原样。"""
    reg = ContextRegistry()
    cid = _seed(tmp_path, reg)
    before = reg.get(cid)
    assert before.owner_token == OWNER_TOKEN and before.name == "别墅酒店"

    assert reg.empty_context(cid) is True

    assert cid in reg, "清空把档案本身也删了——那是 pg 的 delete()，不是本方法"
    ctx = reg.get(cid)
    assert ctx is not None
    assert ctx.context_id == cid
    assert ctx.owner_token == OWNER_TOKEN, "owner_token 没了 = 用户手上那份锚点作废，档案回不去了"
    assert ctx.name == "别墅酒店"
    assert reg.resolve_memory_dir(cid) is not None


def test_empty_keeps_the_conversation_history_and_the_notes(tmp_path):
    """对话历史与 Avery 自己写的观察**不是文件的衍生物**，清文件不该带走它们。

    （`company_notes` 的归属票面标了「存疑，倾向保留」——这里把「保留」钉成判据，
    确认文案里必须把这一条说给用户听。）"""
    reg = ContextRegistry()
    cid = _seed(tmp_path, reg)
    reg.append_advise_run(cid, "前厅这周排班怎么排？", title="排班", locale="zh",
                          answer="先把晚市顶上去。", thread_id="th_1")
    reg.append_note(cid, "经理更关心晚市翻台，不是早班。")
    assert len(reg.list_advise_runs(cid)) == 1 and len(reg.list_notes(cid)) == 1

    assert reg.empty_context(cid) is True

    runs = reg.list_advise_runs(cid)
    assert len(runs) == 1 and runs[0].question == "前厅这周排班怎么排？"
    assert runs[0].thread_id == "th_1", "场的归属也得留着，否则历史面会散架"
    assert len(reg.list_advise_threads(cid)) == 1
    notes = reg.list_notes(cid)
    assert len(notes) == 1 and "晚市翻台" in notes[0].text


def test_empty_keeps_the_form_templates_and_the_submissions(tmp_path):
    """员工已经交的答卷是**别人的话**，而且外面还挂着活的 H5 链接——清空一份档案不该
    替员工把他交过的东西撤回去。"""
    reg = ContextRegistry()
    cid = _seed(tmp_path, reg)
    reg.put_form_template(weekly_template(cid))
    sub = _submitted(cid)
    reg.put_form_submission(sub)
    assert len(reg.list_form_templates(cid)) == 1 and len(reg.list_form_submissions(cid)) == 1

    assert reg.empty_context(cid) is True

    assert [t.id for t in reg.list_form_templates(cid)] == ["tpl_weekly"]
    kept = reg.list_form_submissions(cid)
    assert [s.id for s in kept] == [sub.id]
    assert kept[0].answers, "答卷内容被清了——那是员工的话"
    # 外面那条活链接必须还能解析回同一份提交（H5 是发出去的，收不回来）。
    assert reg.get_form_submission_by_token(sub.share_token) is not None


def test_empty_keeps_the_account_binding(tmp_path):
    reg = ContextRegistry()
    cid = _seed(tmp_path, reg)
    assert reg.link_account_context("user_86", cid) is True

    assert reg.empty_context(cid) is True

    assert reg.contexts_for_account("user_86") == [cid]
    assert reg.account_owns("user_86", cid) is True


def test_empty_mutates_the_live_object_a_caller_is_already_holding(tmp_path):
    """命门（与 `file_delete.py` 命门① 同一条）：内存腿的 `get()` 返回的是库里那个**活引用**。

    换一个新的 `CompanyContext` 出来，正在跑的 advise / 刚拿到 ctx 准备投 payload 的端点
    看到的还是清空前的旧世界——屏上「点了没反应」，而库里其实已经空了。
    """
    reg = ContextRegistry()
    cid = _seed(tmp_path, reg)
    held = reg.get(cid)          # 调用方在清空**之前**就攥住了它

    assert reg.empty_context(cid) is True

    assert held is reg.get(cid), "empty_context 换了对象——攥着旧引用的调用方会看到旧世界"
    assert held.source_documents == [] and held.extraction.people == []


def test_empty_is_idempotent(tmp_path):
    reg = ContextRegistry()
    cid = _seed(tmp_path, reg)
    assert reg.empty_context(cid) is True
    assert reg.empty_context(cid) is True, "第二发应当是干净的空转，不是报错"
    assert reg.get(cid).source_files == []


def test_empty_of_an_unknown_context_is_false_and_creates_nothing(tmp_path):
    reg = ContextRegistry()
    assert reg.empty_context("ctx_nope") is False
    assert "ctx_nope" not in reg, "empty_context 顺手把一个不存在的档案凭空造出来了"


def test_empty_leaves_an_archive_that_takes_new_files(tmp_path):
    """清空 → 再传 —— 全程同一个 `context_id`。这就是「不要有新建」那句拍板的可执行形态。"""
    reg = ContextRegistry()
    cid = _seed(tmp_path, reg)
    assert reg.empty_context(cid) is True

    from avery.ingest.file_append import append_paths_to_context
    p = _write(tmp_path, "新周报.md", "# 新周报\n\n- 项目：夜宵档口　负责人：老陈　状态：进行中\n")
    rep = append_paths_to_context(reg, cid, [str(p)], [_sd(p)])
    assert rep.ok, rep

    ctx = reg.get(cid)
    assert ctx.context_id == cid and ctx.owner_token == OWNER_TOKEN
    assert [c["source_key"] for c in ctx.file_cards()] == ["新周报.md"]
    assert ctx.extraction.materials, "补进来的文件没切出块"


# ==============================================================================================
# §2 · 记忆面（facts.md / notes.md 必须当场重物化成空）
# ==============================================================================================

def test_empty_rematerializes_facts_and_notes(tmp_path):
    reg = ContextRegistry()
    cid = _seed(tmp_path, reg)
    mem_dir = reg.get(cid).memory_dir
    facts_before = (mem_dir / "facts.md").read_text(encoding="utf-8")
    assert BEO_ONLY_LINE in facts_before, "自证：清空前 facts.md 里真有那份文档的原文"

    assert reg.empty_context(cid) is True

    facts_after = (mem_dir / "facts.md").read_text(encoding="utf-8")
    assert BEO_ONLY_LINE not in facts_after, "facts.md 还留着已清掉的原文——议事室照旧引得到"
    assert "小马" not in facts_after, "项目卡的负责人还在 facts.md 上（重物化没跑）"

    # 逐字节等于「空抽取的重物化产物」——pg 腿写进 memory_files 的也必须是这一份（两腿同结果）。
    want_dir = tmp_path / "want"
    materialize_memory(ExtractionResult(), want_dir)
    assert facts_after == (want_dir / "facts.md").read_text(encoding="utf-8")
    assert (mem_dir / "notes.md").read_text(encoding="utf-8") == \
        (want_dir / "notes.md").read_text(encoding="utf-8")


def test_recall_cannot_reach_the_emptied_corpus(tmp_path):
    """判据落在**检索面**上，不落在「清单少了几行」。"""
    reg = ContextRegistry()
    cid = _seed(tmp_path, reg)
    ctx = reg.get(cid)
    assert ctx.recall(BEO_ASCII_TOKEN), "自证：清空前这个 token 真的召得回来"

    assert reg.empty_context(cid) is True

    assert reg.get(cid).recall(BEO_ASCII_TOKEN) == []
    # 议事室走的是 memory.recall（读 facts.md），与 store 是两条独立的路，两条都得断。
    hits = memory.recall(BEO_ASCII_TOKEN, memory_dir=reg.get(cid).memory_dir)
    assert not [h for h in hits if BEO_ASCII_TOKEN in str(getattr(h, "text", h)).lower()], hits


# ==============================================================================================
# §3 · HTTP 端点
# ==============================================================================================

@pytest.fixture()
def client():
    pytest.importorskip("fastapi.testclient")
    from fastapi.testclient import TestClient
    from service.app import app
    from avery.ingest.registry import REGISTRY
    REGISTRY.clear()
    with TestClient(app) as c:
        yield c
    REGISTRY.clear()


def _http_seed(client) -> tuple[str, str]:
    files = [("files", ("花名册.md", ROSTER.encode("utf-8"), "text/markdown")),
             ("files", ("婚宴纪要.md", BEO.encode("utf-8"), "text/markdown"))]
    res = client.post("/ingest", files=files)
    assert res.status_code == 200, res.text
    body = res.json()
    from service import ingest_worker
    ingest_worker.run_pending_jobs()   # #90: deposit is async — drive extraction to the terminal
    seeded = client.get(f"/team/{body['context_id']}",
                        headers={"X-Avery-Token": body["owner_token"]}).json()
    assert seeded["source_files"], "自证：种子上传自己就是空的"
    return body["context_id"], body["owner_token"]


def test_empty_endpoint_returns_the_emptied_payload(client):
    cid, tok = _http_seed(client)
    res = client.post(f"/team/{cid}/empty", headers={"X-Avery-Token": tok})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["emptied"] is True
    assert body["context_id"] == cid, "回执换了 context_id——那就是「新建」，正是本票要撤掉的东西"
    assert body["source_files"] == [] and body["people"] == [] and body["projects"] == []
    assert body["signals"] == []
    # 🔴 不重发 owner_token（凭据只在创建那一刻交出去一次，同 append / delete 的纪律）。
    assert "owner_token" not in body
    # briefing 也得跟着说实话，不能还挂着清空前的计数。
    assert "0 people, 0 projects" in body["briefing"]["headline"], body["briefing"]


def test_empty_endpoint_hands_back_an_archive_that_is_no_longer_a_demo_clone(client):
    """#88 · 集成层那一半：registry 把 `ephemeral` 摘掉还不够，**回执 payload 里那个字段**
    才是前端据以解封上传口的东西（`rawTeam.ephemeral` → `FilesScreen.uploadBlocked`）。

    只测 registry 的话，「端点投的是清空**前**的快照」这条 bug 会全绿溜过去——那正是
    下面 `test_empty_endpoint_reprojects_after_emptying_not_the_stale_snapshot` 逮到的
    同一类暗区，而 `ephemeral` 这一格恰好是**从 registry 现读**（`_registry_says_ephemeral`）
    而不是从 ctx 快照读的，两条路各错各的。

    🔴 对照基准不能省：先证明清空**之前**回执上确实写着 `ephemeral: true`。没有它，
       「清空后不是 true」在一个从来就没带过这个字段的回执上恒真。
    """
    # 🔴 走 `active_registry()`，**不要** `from avery.ingest.registry import REGISTRY`：
    #    后者是内存腿那个单例，而配了 `AVERY_DB_URL` 时服务端用的是 pg 腿。拿错那一份的症状
    #    是 `clone_context(...) is False`（母本压根不在内存里）——一条只在离线配置下跑得过的
    #    测试，正是本票要堵的那种暗区（写它的时候实测栽过一次）。
    from avery.ingest.registry import active_registry

    master, _tok = _http_seed(client)
    # 🔴 id 必须每跑一次都不同：配了 `AVERY_DB_URL` 时 `client` fixture 的 `REGISTRY.clear()`
    #    只清内存腿，真库里那一行会跨轮活下来。写死的 id 第二轮就是
    #    `UniqueViolation: Key (context_id)=(...) already exists`（实测栽过一次）。
    clone = "ctx_e88_" + uuid.uuid4().hex[:12]
    clone_tok = "tok-clone-" + clone
    assert active_registry().clone_context(
        master, new_context_id=clone, new_owner_token=clone_tok)
    head = {"X-Avery-Token": clone_tok}

    before = client.get(f"/team/{clone}", headers=head)
    assert before.status_code == 200, before.text
    assert before.json().get("ephemeral") is True, "对照基准不成立 —— 下面全是空真"

    res = client.post(f"/team/{clone}/empty", headers=head)
    assert res.status_code == 200, res.text
    assert res.json().get("emptied") is True
    assert res.json().get("ephemeral") is not True, \
        "清空回执还自称一次性克隆 —— 前端据此继续封着上传口，用户做完唯一被指引的动作仍无路可走"

    after = client.get(f"/team/{clone}", headers=head)
    assert after.status_code == 200, after.text
    assert after.json().get("ephemeral") is not True, "刷新一次又变回一次性了"
    # 档案本身照旧活着（#86 的那条主张，别被本条的改动带塌）。
    assert after.json()["context_id"] == clone


def test_empty_endpoint_reprojects_after_emptying_not_the_stale_snapshot(client, monkeypatch):
    """🔴 这条补的是一块**离线永远看不见**的暗区。

    端点的流程是 `ctx = authorize_context(...)` → `empty_context(...)` → 投 payload。
    内存腿的 `get()` 返回的是库里那个**活对象**，所以「投 ctx」与「清空后重新 get 再投」
    结果一模一样——写成前者，离线 20 条判据一条都不会红。而 pg 腿的 `get()` 每次重建一个
    **快照**，那份 ctx 是清空**之前**的世界：回执会把刚清掉的那一屏原样发回去，
    屏上表现为「点了没反应」。本票写门时实测：那条变异离线 20/20 全绿、挂上 AVERY_DB_URL
    才红一条——正是仓里那条「pg 腿的洞绿着上线」的事故形状。

    修法不是「再写一条 @needs_db」（默认电池照样反选它），而是**把 pg 的快照语义搬到离线来**：
    让内存腿的 `get()` 每次返回一份深拷贝。清空仍然改的是库里那个真对象，于是
    「投旧 ctx」与「重新 get」在这里也分得开了。
    """
    import copy
    from avery.ingest.registry import REGISTRY

    real_get = REGISTRY.get
    monkeypatch.setattr(REGISTRY, "get",
                        lambda cid: copy.deepcopy(real_get(cid)))

    cid, tok = _http_seed(client)
    res = client.post(f"/team/{cid}/empty", headers={"X-Avery-Token": tok})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["source_files"] == [], \
        f"回执投的是清空**之前**那份快照（pg 腿上就是「点了没反应」）：{body['source_files']}"
    assert body["people"] == [] and body["projects"] == []


def test_empty_endpoint_keeps_the_owner_token_working(client):
    """「档案还在」的可执行定义：**老 token 照旧打得开**。"""
    cid, tok = _http_seed(client)
    assert client.post(f"/team/{cid}/empty", headers={"X-Avery-Token": tok}).status_code == 200

    again = client.get(f"/team/{cid}", headers={"X-Avery-Token": tok})
    assert again.status_code == 200, again.text
    assert again.json()["context_id"] == cid
    assert again.json()["source_files"] == []
    listing = client.get(f"/team/{cid}/files", headers={"X-Avery-Token": tok})
    assert listing.status_code == 200 and listing.json()["files"] == []


def test_empty_endpoint_without_a_token_is_404_and_nothing_is_emptied(client):
    cid, tok = _http_seed(client)
    assert client.post(f"/team/{cid}/empty").status_code == 404
    assert client.post(f"/team/{cid}/empty",
                       headers={"X-Avery-Token": "tok-wrong"}).status_code == 404
    listing = client.get(f"/team/{cid}/files", headers={"X-Avery-Token": tok}).json()
    assert [f["source_key"] for f in listing["files"]] == ["花名册.md", "婚宴纪要.md"], \
        "鉴权失败的清空竟然真清了东西"


def test_empty_endpoint_unknown_context_is_404(client):
    assert client.post("/team/ctx_nope/empty", headers={"X-Avery-Token": "tok"}).status_code == 404


def test_empty_endpoint_keeps_history_and_submissions(client):
    cid, tok = _http_seed(client)
    hdr = {"X-Avery-Token": tok}
    note = client.post(f"/team/{cid}/notes", json={"text": "经理更关心晚市翻台。"}, headers=hdr)
    assert note.status_code == 200, note.text

    assert client.post(f"/team/{cid}/empty", headers=hdr).status_code == 200

    kept = client.get(f"/team/{cid}/notes", headers=hdr)
    assert kept.status_code == 200 and len(kept.json()["notes"]) == 1, kept.text


def test_empty_endpoint_can_be_followed_by_a_new_upload_into_the_same_archive(client):
    cid, tok = _http_seed(client)
    assert client.post(f"/team/{cid}/empty", headers={"X-Avery-Token": tok}).status_code == 200

    res = client.post(
        f"/team/{cid}/files",
        files=[("files", ("新周报.md", "# 新周报\n\n- 项目：夜宵档口　负责人：老陈　状态：进行中\n"
                          .encode("utf-8"), "text/markdown"))],
        headers={"X-Avery-Token": tok})
    assert res.status_code == 200, res.text
    assert res.json()["context_id"] == cid, "补料铸了一个新 context——单档案模型已经破了"
    listing = client.get(f"/team/{cid}/files", headers={"X-Avery-Token": tok}).json()
    assert [f["source_key"] for f in listing["files"]] == ["新周报.md"]


def test_empty_route_is_rate_limit_guarded(client):
    """ASGI 边缘的写闸必须认得这条路由。

    🔴 `_GUARDED` 是精确匹配的字典，带路径参数的路由永远命不中它——漏了这一条，全站唯一一个
    「一次调用抹掉整个资料库」的端点在边缘就是零防护。判据落在 `_route_for` / `is_guarded`
    这两个函数本身，不落在「限流真的触发了」（默认 rpm=0，触发不了）。
    """
    from service.upload_guard import _route_for, is_guarded
    assert _route_for("/team/ctx_x/empty") == "ingest"
    assert is_guarded(_route_for("/team/ctx_x/empty"), "POST") is True
    # 读侧照旧直通（同 #77 给下载留的那条）。
    assert is_guarded(_route_for("/team/ctx_x/empty"), "GET") is False


# ==============================================================================================
# §4 · 🔴 明知的雷：清空**不会自己保持为空**
# ==============================================================================================

def test_refiling_a_submission_after_empty_repopulates_the_archive(client):
    """留着员工答卷的代价，钉成正面判据。

    `POST /team/{id}/forms/{sub}/ingest`（T2 的修复面）会把一份已提交的答卷重新灌进资料库。
    清空之后再调它，实体就回来了——这**不是 bug**，是本票明文接受的语义边界：答卷不属于
    「经理上传的文件」那一类，它是别人的话。

    钉住它有两个用处：① 下一个人不会把它当漏洞顺手「修」成静默丢弃员工数据；
    ② 确认文案不许说「清空之后这份档案就永远是空的」——那是假话。
    """
    cid, tok = _http_seed(client)
    hdr = {"X-Avery-Token": tok}
    # ⚠ 必须走 `active_registry()`，不许直接摸 `REGISTRY`：配了 AVERY_DB_URL 跑同一份文件时，
    # 服务端用的是 pg 腿，而写进内存腿的那份提交端点根本看不见——症状是一条 404，读起来像
    # 「补灌端点坏了」。（本条不挂 @needs_db 是故意的：它在两种配置下都该成立。）
    from avery.ingest.registry import active_registry
    reg = active_registry()
    reg.put_form_template(weekly_template(cid))
    sub = _submitted(cid)
    reg.put_form_submission(sub)

    assert client.post(f"/team/{cid}/empty", headers=hdr).status_code == 200
    assert client.get(f"/team/{cid}/files", headers=hdr).json()["files"] == [], "自证：确实清空了"

    res = client.post(f"/team/{cid}/forms/{sub.id}/ingest", headers=hdr)
    assert res.status_code == 200, res.text
    assert res.json()["appended"] is True

    files = client.get(f"/team/{cid}/files", headers=hdr).json()["files"]
    assert len(files) == 1, f"补灌一份答卷之后资料库应当又有东西了：{files}"


# ==============================================================================================
# §5 · @needs_db —— 真库那一层
# ==============================================================================================

@pytest.fixture()
def pg(tmp_path):
    url = _db_url()
    if not url:
        pytest.skip("needs AVERY_DB_URL (or PGVECTOR_URL) pointing at a Postgres")
    pytest.importorskip("psycopg")
    from avery.ingest.pg_registry import PostgresContextRegistry

    data_dir = tmp_path / "pgdata"
    created: list[str] = []

    class _Handle:
        url = None

        def fresh(self):
            return PostgresContextRegistry(url, data_dir=data_dir)

        def track(self, cid: str) -> str:
            created.append(cid)
            return cid

    handle = _Handle()
    handle.url = url
    yield handle
    reg = PostgresContextRegistry(url, data_dir=data_dir)
    for cid in created:
        reg.delete(cid)


def _pg_counts(url: str, cid: str) -> dict[str, int]:
    import psycopg
    out = {}
    with psycopg.connect(url) as conn:
        for table in ("contexts", "entities", "materials", "source_documents", "memory_files",
                      "company_notes", "advise_runs", "form_submissions", "form_templates"):
            out[table] = conn.execute(
                f"SELECT count(*) FROM avery.{table} WHERE context_id = %s", (cid,)).fetchone()[0]
    return out


@needs_db
def test_pg_empty_really_deletes_the_rows_and_keeps_the_context_row(pg, tmp_path):
    """🔴 本段是这张票的**真判据**。内存腿证明不了「真的没了」（`get()` 返回同一个活对象）。"""
    reg = pg.fresh()
    cid = pg.track("ctx_e86_" + uuid.uuid4().hex[:12])
    files = [_write(tmp_path, "花名册.md", ROSTER), _write(tmp_path, "婚宴纪要.md", BEO)]
    rep = ingest_paths([str(p) for p in files], registry=reg, work_dir=tmp_path / "mem",
                       context_id=cid, name="别墅酒店", owner_token=OWNER_TOKEN,
                       source_documents=[_sd(p) for p in files])
    assert rep.ok
    reg.append_note(cid, "经理更关心晚市翻台。")
    reg.append_advise_run(cid, "前厅这周排班怎么排？", answer="先把晚市顶上去。")
    reg.put_form_template(weekly_template(cid))
    reg.put_form_submission(_submitted(cid))

    before = _pg_counts(pg.url, cid)
    assert before["entities"] and before["materials"] and before["source_documents"], before

    assert reg.empty_context(cid) is True

    after = _pg_counts(pg.url, cid)
    assert after["entities"] == 0, "entities 还有行——人卡/项目卡/信号/方法卡/冲突没清干净"
    assert after["materials"] == 0, "materials 还有行——议事室照旧检索得到"
    assert after["source_documents"] == 0, "原件字节还在库里"
    # 留下的那一半（本票的全部意义）。
    assert after["contexts"] == 1, "contexts 行没了——那是 delete()，不是 empty_context()"
    assert after["memory_files"] == 2, f"facts.md/notes.md 两行必须在（空内容）：{after}"
    assert after["company_notes"] == before["company_notes"] == 1
    assert after["advise_runs"] == before["advise_runs"] == 1
    assert after["form_templates"] == 1 and after["form_submissions"] == 1


@needs_db
def test_pg_empty_survives_a_brand_new_registry_instance(pg, tmp_path):
    """一个**全新连接**读到的必须也是空的（清空得穿过序列化那一层，不是进程内的假象）。"""
    reg = pg.fresh()
    cid = pg.track("ctx_e86_" + uuid.uuid4().hex[:12])
    files = [_write(tmp_path, "花名册.md", ROSTER), _write(tmp_path, "婚宴纪要.md", BEO)]
    assert ingest_paths([str(p) for p in files], registry=reg, work_dir=tmp_path / "mem",
                        context_id=cid, name="别墅酒店", owner_token=OWNER_TOKEN,
                        source_documents=[_sd(p) for p in files]).ok
    assert reg.empty_context(cid) is True

    other = pg.fresh()
    ctx = other.get(cid)
    assert ctx is not None, "清空把整份档案弄没了"
    assert ctx.owner_token == OWNER_TOKEN and ctx.name == "别墅酒店"
    assert ctx.source_files == [] and ctx.source_documents == []
    assert ctx.extraction.people == [] and ctx.extraction.projects == []
    assert ctx.extraction.materials == []
    assert other.source_document_bytes(cid, 0) is None, "原件字节还下载得到"
    # 重物化面：新实例把 DB 里那份空 facts.md 写回磁盘。
    assert BEO_ONLY_LINE not in (ctx.memory_dir / "facts.md").read_text(encoding="utf-8")


@needs_db
def test_pg_a_later_put_does_not_resurrect_the_emptied_bytes(pg, tmp_path):
    """🔴 反 `put()` 回填：清空之后任何一次 `get()→改→put()`（手编 CRUD 走的就是这条）
    都不许把旧字节/旧向量从临时表里捞回来。

    这一条是「为什么不能复用 put() 实现清空」的镜像判据——真出问题时它会先红。
    """
    reg = pg.fresh()
    cid = pg.track("ctx_e86_" + uuid.uuid4().hex[:12])
    files = [_write(tmp_path, "花名册.md", ROSTER), _write(tmp_path, "婚宴纪要.md", BEO)]
    assert ingest_paths([str(p) for p in files], registry=reg, work_dir=tmp_path / "mem",
                        context_id=cid, name="别墅酒店", owner_token=OWNER_TOKEN,
                        source_documents=[_sd(p) for p in files]).ok
    assert reg.empty_context(cid) is True

    ctx = reg.get(cid)
    reg.put(ctx)                      # 手编 CRUD 的写回路径

    after = _pg_counts(pg.url, cid)
    assert after["source_documents"] == 0, "put() 的字节回填把已清空的原件又插回来了"
    assert after["materials"] == 0 and after["entities"] == 0
    assert reg.get(cid).source_files == []
