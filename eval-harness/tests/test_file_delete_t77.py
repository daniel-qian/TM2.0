# -*- coding: utf-8 -*-
"""issue #77 · 删除一份资料 —— 编排层 + HTTP 端点 + 真库那一层。

判据分四段：

  §1 编排层（离线）—— `delete_document_from_context`：材料面切干净、别人的一条不掉、
     检索面跟上、记忆面重物化。
  §2 「引用不到已删文档的原文行」—— 票面点名的那条判据。**不许只断言「文件行没了」**：
     清单收缩了而 facts.md / recall 面还留着那份资料的原文，正是这一票要防的失败形态。
  §3 HTTP 端点 —— 鉴权门（无 token / 错 token 一律 404 且**文件仍在**）、寻址用 source_key、
     回执形状。
  §4 @needs_db —— 真库那一层。🔴 **离线层证明不了任何删除判据**：内存 registry 的 `put()`
     是一次 dict 赋值、`get()` 返回**同一个活对象**，「删掉的东西真的没了」在那里是恒真的
     废话（根本没有序列化那一步）。没有这一段，这张票 100% 复刻「5 型真库 bug」。

零真 LLM：三件套缺一真烧钱；@needs_db 那几条自带显式 embedder，不靠 env。
"""
from __future__ import annotations

import os
from pathlib import Path

import pytest

from avery import memory
from avery.ingest import ingest_paths
from avery.ingest.file_append import append_paths_to_context
from avery.ingest.file_delete import delete_document_from_context
from avery.ingest.registry import ContextRegistry, SourceDocument

needs_db = pytest.mark.needs_db

# 两份文档各带**只属于自己**的正文行——判据全部落在这些行上。中文文件名是刻意的：
# `doc_key_of` 的 rsplit 对中文成立，但门语料全 ASCII 是老盲点，这里真跑一次。
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
    "- 场地：阳光草坪主场地 + 多功能厅备用（雨天启用）",
    "- 桌数与台型：主桌一席，圆桌二十七席",
])
# ⚠ 那个 ASCII 编号不是装饰，是**检索判据唯一够得着的抓手**：`store._tokens` 的词表是
# `[a-z0-9]+`（store.py:37），对无空格中文分词结果恒为空 —— `KeywordStore.query('桌数')`
# 在**任何**中文语料上都返回空列表。拿中文串去断言「删之后检索不到」会全绿，而它证明的是
# 「删之前也检索不到」。这条盲区是 keyword 后端自己的边界，不是本票要修的东西（记进回执）。
BEO_ASCII_TOKEN = "beo-2026-0808"
# 这三行只在婚宴纪要里出现，且**没有一个字**进得了人卡/项目卡的结构化读数——所以它们
# 在 facts.md / recall 面上出现，只可能来自「那份文档的材料块还在」。
BEO_ONLY = [
    "宴会日期：2026 年 8 月 8 日（周六）晚宴",
    "场地：阳光草坪主场地 + 多功能厅备用（雨天启用）",
    "桌数与台型：主桌一席，圆桌二十七席",
]
ROSTER_ONLY = ["周雅婷", "林小满"]

OLD_AT = "2026-08-01T09:00:00+00:00"


@pytest.fixture(autouse=True)
def _offline(monkeypatch):
    monkeypatch.setenv("AVERY_EMBEDDINGS", "keyword")
    monkeypatch.setenv("AVERY_BRAIN", "mock")
    monkeypatch.setenv("AVERY_EXTRACTOR", "heuristic")
    monkeypatch.delenv("AVERY_ALLOW_PERSON_SCORING", raising=False)


def _write(tmp: Path, name: str, text: str) -> Path:
    p = tmp / name
    p.write_text(text, encoding="utf-8")
    return p


def _sd(p: Path, at: str = OLD_AT, *, key: str | None = None) -> SourceDocument:
    return SourceDocument(filename=p.name, source_key=key or p.name, mime="text/markdown",
                          size_bytes=p.stat().st_size, content=p.read_bytes(), uploaded_at=at)


def _seed(tmp: Path, reg, cid: str = "ctx_del77") -> str:
    files = [_write(tmp, "花名册.md", ROSTER), _write(tmp, "婚宴纪要.md", BEO)]
    rep = ingest_paths([str(p) for p in files], registry=reg, work_dir=tmp / "mem",
                       context_id=cid, name="别墅酒店", owner_token="tok_del",
                       source_documents=[_sd(p) for p in files])
    assert rep.ok, f"种子语料自己就没进去，下面全是空判据：{rep.parse_errors}"
    ctx = reg.get(cid)
    # 自证：两份文档**各自**都真的切出了材料块。
    for key in ("花名册.md", "婚宴纪要.md"):
        chunks = [m for m in ctx.extraction.materials if (m.source or "").startswith(f"{key}:")]
        assert chunks, f"{key} 一个材料块都没有——判据够不着"
    return cid


# =============================================================================================
# §1 · 编排层（离线）
# =============================================================================================

def test_delete_removes_the_documents_row_and_its_chunks_only(tmp_path):
    """清单少一行、那份文档的块归零、**另一份的块数一条不掉**。"""
    reg = ContextRegistry()
    cid = _seed(tmp_path, reg)
    ctx = reg.get(cid)
    before = {c["source_key"]: c["n_chunks"] for c in ctx.file_cards()}
    assert before["花名册.md"] > 0 and before["婚宴纪要.md"] > 0

    rep = delete_document_from_context(reg, cid, "婚宴纪要.md")
    assert rep.ok and rep.materials_removed > 0

    cards = {c["source_key"]: c["n_chunks"] for c in reg.get(cid).file_cards()}
    assert list(cards) == ["花名册.md"], f"清单没收缩，或收错了行：{cards}"
    assert cards["花名册.md"] == before["花名册.md"], "删掉一份文档改变了另一份的块数"
    assert reg.get(cid).source_files == ["花名册.md"], reg.get(cid).source_files


def test_delete_addresses_by_source_key_not_position(tmp_path):
    """补传一份重名文件后，按各自的 source_key 删——删掉的必须是**指名那一份**。

    🔴 这条钉的是寻址口径本身：按 idx 删在这个语料上会「看起来也成功」（清单同样少一行），
    但少的是错的那一行。判据落在**剩下那份的原文块**上。
    """
    reg = ContextRegistry()
    cid = _seed(tmp_path, reg)
    p2 = _write(tmp_path, "婚宴纪要(1).md", BEO.replace("圆桌二十七席", "圆桌三十席"))
    sd2 = _sd(p2, key="婚宴纪要(1).md")
    sd2.filename = "婚宴纪要.md"                    # display 名同旧、source_key 被服务端消歧
    assert append_paths_to_context(reg, cid, [str(p2)], [sd2]).ok

    keys = [c["source_key"] for c in reg.get(cid).file_cards()]
    assert keys == ["花名册.md", "婚宴纪要.md", "婚宴纪要(1).md"], keys

    # 删**中间**那一份（idx=1）——按 idx 与按 key 在这里恰好一致，所以再删一次第二份重名的，
    # 按 idx 就会删错（原 idx=2 已左移成 1）。
    assert delete_document_from_context(reg, cid, "婚宴纪要.md").ok
    assert delete_document_from_context(reg, cid, "婚宴纪要(1).md").ok
    assert [c["source_key"] for c in reg.get(cid).file_cards()] == ["花名册.md"]


def test_delete_rebuilds_the_retrieval_store(tmp_path):
    """检索面跟上：删掉之后 store 里引不到那份文档的原文（两个内存 store 都没有 remove）。"""
    reg = ContextRegistry()
    cid = _seed(tmp_path, reg)
    ctx = reg.get(cid)
    hits = ctx.store.query(BEO_ASCII_TOKEN)
    assert any("通知单编号" in h.text for h in hits), "删之前就检索不到——判据在数一个恒空的东西"

    delete_document_from_context(reg, cid, "婚宴纪要.md")
    ctx = reg.get(cid)
    hits = ctx.store.query(BEO_ASCII_TOKEN)
    assert not any("通知单编号" in h.text for h in hits), \
        f"删掉的文档还在检索面上：{[h.text for h in hits]}"
    # 别人的还在（不是把 store 清空了事）——花名册里的 MKT-001 同样是 ASCII 抓手。
    assert any("周雅婷" in h.text for h in ctx.store.query("mkt-001"))


def test_delete_keeps_the_store_in_step_with_the_materials(tmp_path):
    """结构判据：store 装的块数必须与 `extraction.materials` 一致。

    与上一条不是重复：上一条走 `query()`，只够得着**带 ASCII 词**的那些块；这条数的是
    store 本身的大小，中文块漏切也会红。两把锁两道门。
    """
    reg = ContextRegistry()
    cid = _seed(tmp_path, reg)
    ctx = reg.get(cid)
    assert len(ctx.store) == len(ctx.extraction.materials), "种子阶段就对不上——判据够不着"

    delete_document_from_context(reg, cid, "婚宴纪要.md")
    ctx = reg.get(cid)
    assert len(ctx.store) == len(ctx.extraction.materials), \
        f"检索面没跟上：store {len(ctx.store)} 块 vs 材料 {len(ctx.extraction.materials)} 块"


def test_delete_keeps_the_person_cards(tmp_path):
    """票内裁定：只删材料行，人卡/项目卡一律保留（血缘不够——理由在模块 docstring）。"""
    reg = ContextRegistry()
    cid = _seed(tmp_path, reg)
    before = {p.name for p in reg.get(cid).extraction.people}
    assert before, "种子没抽出人——判据够不着"
    delete_document_from_context(reg, cid, "花名册.md")
    assert {p.name for p in reg.get(cid).extraction.people} == before, \
        "删文件顺手删了人卡——本票明确不做这件事（要做得先给实体加来源文档集合）"


def test_delete_refuses_unknown_key_without_touching_anything(tmp_path):
    """先查后改：key 不存在时抛 KeyError，且**一个字段都没动过**。"""
    reg = ContextRegistry()
    cid = _seed(tmp_path, reg)
    before_keys = [c["source_key"] for c in reg.get(cid).file_cards()]
    before_chunks = len(reg.get(cid).extraction.materials)
    with pytest.raises(KeyError):
        delete_document_from_context(reg, cid, "根本没有这份.md")
    assert [c["source_key"] for c in reg.get(cid).file_cards()] == before_keys
    assert len(reg.get(cid).extraction.materials) == before_chunks


def test_delete_refuses_unknown_context(tmp_path):
    reg = ContextRegistry()
    with pytest.raises(KeyError):
        delete_document_from_context(reg, "ctx_nope", "花名册.md")


# =============================================================================================
# §2 · 「引用不到已删文档的原文行」（票面点名的那条判据）
# =============================================================================================

def test_the_deleted_documents_lines_are_gone_from_the_memory_surface(tmp_path):
    """🔴 判据落在**原文行本身**上，不落在「文件行没了」这个下游后果上。

    facts.md 是议事室 recall 与 @ 引用共同的记忆面。清单收缩了而这里还留着那份资料的原话，
    正是这一票要防的失败形态——经理以为删干净了，Avery 还在读它。
    """
    reg = ContextRegistry()
    cid = _seed(tmp_path, reg)
    mem_dir = reg.get(cid).memory_dir
    facts_before = (Path(mem_dir) / "facts.md").read_text(encoding="utf-8")
    hit_before = [ln for ln in BEO_ONLY if ln in facts_before]
    assert len(hit_before) == len(BEO_ONLY), \
        f"删之前 facts.md 里就只有 {len(hit_before)}/{len(BEO_ONLY)} 行——判据够不着"

    delete_document_from_context(reg, cid, "婚宴纪要.md")

    facts_after = (Path(mem_dir) / "facts.md").read_text(encoding="utf-8")
    for line in BEO_ONLY:
        assert line not in facts_after, f"已删文档的原文行还在 facts.md 里：{line!r}"
    for line in ROSTER_ONLY:
        assert line in facts_after, f"删一份文档把别人的行也删了：{line!r}"


def test_at_reference_to_the_deleted_document_is_honestly_not_found(tmp_path):
    """@ 引用那份已删文档 → 诚实的 not-found，**不是静默引到别的文档**（#74 同域纪律）。"""
    from avery.ingest.references import build_reference_block
    reg = ContextRegistry()
    cid = _seed(tmp_path, reg)
    ctx = reg.get(cid)
    ok_block = build_reference_block(ctx, [{"kind": "file", "id": "婚宴纪要.md",
                                            "label": "婚宴纪要.md"}])
    assert any(ln in ok_block for ln in BEO_ONLY), "删之前就引不到原文——判据够不着"

    delete_document_from_context(reg, cid, "婚宴纪要.md")
    ctx = reg.get(cid)
    block = build_reference_block(ctx, [{"kind": "file", "id": "婚宴纪要.md",
                                         "label": "婚宴纪要.md"}])
    for line in BEO_ONLY:
        assert line not in block, f"引用块里还带着已删文档的原文：{line!r}"
    # 而且不许把别人的行冒名顶上来当这份文档的内容。
    assert not any(line in block for line in ROSTER_ONLY), \
        f"引一份不存在的文档，却拿到了另一份文档的内容：\n{block}"


def test_recall_cannot_surface_the_deleted_documents_text(tmp_path):
    """记忆面的另一条读法（`memory.recall` 直接读 facts.md）也必须够不着。"""
    reg = ContextRegistry()
    cid = _seed(tmp_path, reg)
    mem_dir = reg.get(cid).memory_dir
    before = memory.recall("宴会日期 场地 桌数", mem_dir, None)
    assert any("桌数与台型" in (h.text if hasattr(h, "text") else str(h)) for h in before), \
        "删之前 recall 就够不着——判据是空的"

    delete_document_from_context(reg, cid, "婚宴纪要.md")
    after = memory.recall("宴会日期 场地 桌数", mem_dir, None)
    assert not any("桌数与台型" in (h.text if hasattr(h, "text") else str(h)) for h in after), \
        f"recall 还召得回已删文档的原文：{after}"


# =============================================================================================
# §3 · HTTP 端点
# =============================================================================================

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


def _http_seed(client, tmp_path) -> tuple[str, str]:
    files = [("files", ("花名册.md", ROSTER.encode("utf-8"), "text/markdown")),
             ("files", ("婚宴纪要.md", BEO.encode("utf-8"), "text/markdown"))]
    res = client.post("/ingest", files=files)
    assert res.status_code == 200, res.text
    body = res.json()
    return body["context_id"], body["owner_token"]


def test_delete_endpoint_removes_the_file(client, tmp_path):
    cid, tok = _http_seed(client, tmp_path)
    res = client.delete(f"/team/{cid}/files/婚宴纪要.md", headers={"X-Avery-Token": tok})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["deleted"]["source_key"] == "婚宴纪要.md"
    assert body["deleted"]["remaining"] == ["花名册.md"]
    # 回执是整张 team payload（前端拿它整屏刷新）。
    assert body["context_id"] == cid and "source_files" in body
    # 🔴 不重发 owner_token（同 append 的纪律）。
    assert "owner_token" not in body

    listing = client.get(f"/team/{cid}/files", headers={"X-Avery-Token": tok}).json()
    assert [f["source_key"] for f in listing["files"]] == ["花名册.md"]


def test_delete_endpoint_without_token_is_404_and_the_file_survives(client, tmp_path):
    cid, tok = _http_seed(client, tmp_path)
    assert client.delete(f"/team/{cid}/files/婚宴纪要.md").status_code == 404
    assert client.delete(f"/team/{cid}/files/婚宴纪要.md",
                         headers={"X-Avery-Token": "tok-wrong"}).status_code == 404
    listing = client.get(f"/team/{cid}/files", headers={"X-Avery-Token": tok}).json()
    assert [f["source_key"] for f in listing["files"]] == ["花名册.md", "婚宴纪要.md"], \
        "鉴权失败的 DELETE 竟然真删了东西"


def test_delete_endpoint_unknown_key_is_404(client, tmp_path):
    cid, tok = _http_seed(client, tmp_path)
    res = client.delete(f"/team/{cid}/files/根本没有这份.md", headers={"X-Avery-Token": tok})
    assert res.status_code == 404


def test_delete_endpoint_unknown_context_is_404(client, tmp_path):
    res = client.delete("/team/ctx_nope/files/x.md", headers={"X-Avery-Token": "tok"})
    assert res.status_code == 404


def test_delete_route_is_rate_limit_guarded(client, tmp_path):
    """ASGI 边缘的写闸必须认得这条路由。

    🔴 `_GUARDED` 是精确匹配的字典，带路径参数的路由永远命不中它——漏了这一条，新端点在边缘
    就是零防护，而处理器内部的门照旧生效，「看起来有闸」正是这种漏法最难被发现的原因。
    判据落在 `_route_for` 这个函数本身，不落在「限流真的触发了」（默认 rpm=0，触发不了）。
    """
    from service.upload_guard import _route_for
    assert _route_for("/team/ctx_x/files/周报.md") == "ingest"
    assert _route_for("/team/ctx_x/files") == "ingest"


# =============================================================================================
# §4 · @needs_db —— 真库那一层
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
    """花费探针：删除**一次都不该嵌**（删是 add 的反面，重嵌整份语料是 T2/#53 的老坑）。"""

    def __init__(self, dim: int = 1024):
        from avery.ingest.store import HashingEmbedder
        self._inner = HashingEmbedder(dim)
        self.texts: list[list[str]] = []

    def embed(self, texts):
        self.texts.append(list(texts))
        return self._inner.embed(texts)


@needs_db
def test_delete_survives_a_restart_and_keeps_the_other_documents_bytes(tmp_path):
    """真库端到端：换一个 registry 实例读回来，删掉的真没了、别人的字节逐字节还在。

    离线层证明不了这条——内存 `put()` 是一次 dict 赋值、`get()` 返回同一个活对象。
    """
    url = _skip_without_db()
    from avery.ingest.pg_registry import PostgresContextRegistry
    emb = _CountingEmbedder()
    reg = PostgresContextRegistry(url, data_dir=tmp_path / "data", embedder=emb)
    cid = "ctx_del77_db"
    files = [_write(tmp_path, "花名册.md", ROSTER), _write(tmp_path, "婚宴纪要.md", BEO)]
    try:
        rep = ingest_paths([str(p) for p in files], registry=reg, work_dir=tmp_path / "mem",
                           context_id=cid, name="别墅酒店", owner_token="tok_db77",
                           embedder=emb, prefer_vector=True,
                           source_documents=[_sd(p) for p in files])
        assert rep.ok, rep.parse_errors
        roster_bytes = reg.source_document_bytes(cid, 0)
        assert roster_bytes, "种子的字节没落库——判据够不着"

        emb.texts.clear()
        out = delete_document_from_context(reg, cid, "婚宴纪要.md")
        assert out.ok
        # 🔴 删除一次都不该嵌。
        assert emb.texts == [], f"删除触发了重嵌（删一个文件付一次全量嵌入的钱）：{emb.texts}"

        fresh = PostgresContextRegistry(url, data_dir=tmp_path / "data2", embedder=emb)
        ctx = fresh.get(cid)
        assert [c["source_key"] for c in ctx.file_cards()] == ["花名册.md"], ctx.file_cards()
        assert fresh.source_document_bytes(cid, 0) == roster_bytes, \
            "另一份文档的原件字节在删除的那次 put 里被写坏了"
        # 材料面：那份文档的块在库里也没了。
        assert not [m for m in ctx.extraction.materials
                    if (m.source or "").startswith("婚宴纪要.md:")], "真库里还留着已删文档的块"
        assert [m for m in ctx.extraction.materials if (m.source or "").startswith("花名册.md:")]
    finally:
        reg.delete(cid)


@needs_db
def test_delete_keeps_the_vector_store_a_vector_store(tmp_path):
    """🔴 静默降级闸：pg 环境下 `ctx.store` 必须**仍然是** PgVectorStore。

    无脑重铸成 KeywordStore 的后果是把这家公司从向量检索降级到关键词——`query()` 照样返
    结果、所有现存门全绿，没有任何一处会红。所以判据落在 **store 的类型本身**上，不落在
    「还能检索到东西」这个下游后果上。
    """
    url = _skip_without_db()
    from avery.ingest.pg_registry import PostgresContextRegistry
    from avery.ingest.store import PgVectorStore
    emb = _CountingEmbedder()
    reg = PostgresContextRegistry(url, data_dir=tmp_path / "data", embedder=emb)
    cid = "ctx_del77_vec"
    files = [_write(tmp_path, "花名册.md", ROSTER), _write(tmp_path, "婚宴纪要.md", BEO)]
    try:
        assert ingest_paths([str(p) for p in files], registry=reg, work_dir=tmp_path / "mem",
                            context_id=cid, name="别墅酒店", owner_token="tok_vec77",
                            embedder=emb, prefer_vector=True,
                            source_documents=[_sd(p) for p in files]).ok
        ctx = reg.get(cid)
        assert isinstance(ctx.store, PgVectorStore), \
            f"这个环境下拿到的不是 PgVectorStore（{type(ctx.store).__name__}）——判据够不着"

        out = delete_document_from_context(reg, cid, "婚宴纪要.md")
        assert isinstance(out.context.store, PgVectorStore), \
            f"删除把向量检索静默降级成了 {type(out.context.store).__name__}"
        assert isinstance(reg.get(cid).store, PgVectorStore)
    finally:
        reg.delete(cid)


@needs_db
def test_delete_does_not_disturb_the_ephemeral_flag(tmp_path):
    """demo 克隆的打标（GC 按标不按 id）在删除往返之后必须原样——实现若走「整删再重建」这条会红。"""
    url = _skip_without_db()
    from avery.ingest.pg_registry import PostgresContextRegistry
    from avery.ingest.store import HashingEmbedder
    reg = PostgresContextRegistry(url, data_dir=tmp_path / "data", embedder=HashingEmbedder(1024))
    src, clone = "ctx_del77_master", "ctx_del77_clone"
    files = [_write(tmp_path, "花名册.md", ROSTER), _write(tmp_path, "婚宴纪要.md", BEO)]
    try:
        assert ingest_paths([str(p) for p in files], registry=reg, work_dir=tmp_path / "mem",
                            context_id=src, name="别墅酒店", owner_token="tok_m77",
                            source_documents=[_sd(p) for p in files]).ok
        assert reg.clone_context(src, new_context_id=clone, new_owner_token="tok_c77",
                                 ephemeral=True)
        assert reg.is_ephemeral(clone), "克隆没打上标——判据够不着"
        delete_document_from_context(reg, clone, "婚宴纪要.md")
        assert reg.is_ephemeral(clone), "删除把 ephemeral 标抹掉了（GC 从此扫不到这份克隆）"
    finally:
        reg.delete(clone)
        reg.delete(src)
