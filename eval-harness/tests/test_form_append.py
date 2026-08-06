# -*- coding: utf-8 -*-
"""T2 · form-append-a1b —— 表单提交进资料：渲染 / 转义 / 切块 / append 通道 / 增量嵌入。

判据对应票面三条命门 + 门（.issues/gap-design-0805/tickets.md · T2）：
  * 渲染契约：字段名 = 06 表表头逐字；自由文本区与自述行**分节**；自由文本里的 `｜`/`|`
    转义成 `¦` —— 员工在自由文本里模仿自述行语法（「张三｜负载自述：99」）在解析层眼里
    永远切不出第二格（`_selfreport_from_lines` 要求 ≥2 格），这条在这里直接对着解析器验。
  * 命门①（绝不新造 CompanyContext）不是一条测试能「证明」的——它靠 form_append 文件头注释 +
    这里的行为测：append 后**旧文档字节仍在**、旧 chunk 仍在、briefing 口径一致。
  * 命门②（零 chunk = 前端说「传了读不到」）：最简提交也必须切出非零 chunk（记录ID 行是
    结构保证），status 恒 'ingested'。
  * 成本命门（_material_vectors 复用）：@needs_db 里用计数 embedder 钉死「append 只嵌增量」——
    修前是全语料重嵌，每周 10 份周报 = 10 次全量计费。
  * 议事室面（A0-3）：advise 的引用面是 facts.md（tools.py 走 memory.recall），所以 recall
    命中的判据打在 facts.md 上，离线可跑（mock brain 口径）。

⚠ 语料含中文字节是故意的（MEMORY：门语料全 ASCII 盲点）；recall 的 keyword 路是 ASCII token，
所以查询押在数字 token 上（「25」「72」）——中文+数字混排本来就是真实周报的形状，上面那条
grep 过 Studio_Handbook.md 不含这些 token，命中即证明命中的是表单那份文档。
"""
from __future__ import annotations

import uuid
from pathlib import Path

import pytest

from avery import memory
from avery.ingest import ingest_paths
from avery.ingest.extract import HeuristicExtractor
from avery.ingest.form import (
    FormField, FormSubmission, FormTemplate, default_expiry, new_submission_id, now_iso,
    weekly_template,
)
from avery.ingest.form_append import (
    BAR_ESCAPE, append_submission_to_context, build_submission_document,
    render_submission_markdown,
)
from avery.ingest.parse import ParsedDoc
from avery.ingest.registry import ContextRegistry, SourceDocument

HERE = Path(__file__).resolve().parent.parent          # eval-harness/
FIX = HERE / "tests" / "fixtures" / "ingest"
HANDBOOK = FIX / "Studio_Handbook.md"

needs_db = pytest.mark.needs_db


def _db_url() -> str | None:
    import os
    return (os.environ.get("AVERY_DB_URL") or os.environ.get("PGVECTOR_URL") or "").strip() or None


@pytest.fixture(autouse=True)
def _offline_embeddings(monkeypatch):
    """三件套缺一真烧钱（MEMORY：门电池全离线配置）。needs_db 那几条自带**显式**构造的
    HashingEmbedder，不走 env——这里压掉的是「谁也没想调却真出网」的路径。"""
    monkeypatch.setenv("AVERY_EMBEDDINGS", "keyword")
    monkeypatch.setenv("AVERY_BRAIN", "mock")
    monkeypatch.setenv("AVERY_EXTRACTOR", "heuristic")
    monkeypatch.delenv("AVERY_ALLOW_PERSON_SCORING", raising=False)
    monkeypatch.delenv("AVERY_EMBED_DIM", raising=False)


_ANSWERS = [
    {"field_id": "done", "value": "晚市高峰传菜等位超 8 分钟，本周排了 3 次加班顶上去。"},
    {"field_id": "missed", "value": "宴会厅翻台没压到 25 分钟，缺一个人。"},
    {"field_id": "next_goal", "value": "把传菜动线改一版，下周试跑。"},
    {"field_id": "support", "value": "想借调一个人手到晚市。"},
    {"field_id": "load", "value": 72},
    {"field_id": "mood", "value": "偏紧"},
]


def _handbook_srcdocs() -> list[SourceDocument]:
    return [SourceDocument(filename=HANDBOOK.name, source_key=HANDBOOK.name,
                           mime="text/markdown", content=HANDBOOK.read_bytes())]


def _submitted(cid: str, *, answers=None, name="周雅", person_id="P-0007",
               period="2026-W32") -> FormSubmission:
    created = now_iso()
    return FormSubmission(
        id=new_submission_id(), context_id=cid, template_id="tpl_weekly",
        person_id=person_id, person_name=name, period=period,
        share_token="tok_form_" + uuid.uuid4().hex,
        answers=list(_ANSWERS) if answers is None else answers,
        submitted_at="2026-08-06T10:00:00+00:00",
        created_at=created, expires_at=default_expiry(created))


def _company(tmp_path: Path, reg) -> str:
    """一家已灌好底料的公司——source_documents 按 /ingest 的姿势带上（file space 才有旧文档
    可供「append 后旧字节仍在」这条命门判据咬）。"""
    cid = "ctx_t2_" + uuid.uuid4().hex[:12]
    rep = ingest_paths(
        [str(HANDBOOK)], registry=reg, work_dir=tmp_path / "mem", context_id=cid,
        name="别墅酒店", owner_token="tok_t2_owner",
        source_documents=[SourceDocument(filename=HANDBOOK.name, source_key=HANDBOOK.name,
                                         mime="text/markdown",
                                         content=HANDBOOK.read_bytes())])
    assert rep.ok
    return cid


# ==============================================================================================
# 渲染契约：06 表表头 / 分节 / 转义
# ==============================================================================================

def test_rendered_document_speaks_the_06_sheet_headers_verbatim():
    sub = _submitted("ctx_any")
    md = render_submission_markdown(weekly_template("ctx_any"), sub)
    # 自由文本四节的节名 = 06 表表头原文（weekly_template 的 label 本来就是表头，这里对齐到渲染面）
    for header in ("已完成事实", "未达成及原因", "下一周期目标", "需要支持"):
        assert f"## {header}" in md, f"渲染的文档丢了 06 表表头「{header}」"
    # 系统四列（form.INTAKE_06_SYSTEM_COLUMNS 的落点）
    assert f"记录ID：{sub.id}" in md
    assert "人员ID：P-0007" in md
    assert "述职周期：2026-W32" in md
    assert "提交日期：2026-08-06" in md
    # 自述行：单独一节、解析层认得的语法原文
    assert "## 本人自述" in md
    assert "周雅｜负载自述：72｜情绪自述：偏紧" in md


def test_free_text_and_selfreport_live_in_separate_sections():
    """分节的判据：自述行只出现在「本人自述」节里，自由文本节里一根竖线都不许有。"""
    md = render_submission_markdown(weekly_template("ctx_any"), _submitted("ctx_any"))
    bar_lines = [ln for ln in md.splitlines() if "｜" in ln or "|" in ln]
    assert len(bar_lines) == 1, f"渲染出的竖线行不止自述行一条：{bar_lines}"
    assert bar_lines[0].startswith("周雅｜")


def test_an_imitated_selfreport_line_in_free_text_is_escaped_and_unparseable():
    """T2 对 T5 模仿攻击门的地基：员工在自由文本里写出语法完整的自述行，渲染后必须
    （a）逐字保留原意但竖线换成 `¦`，（b）在 `_selfreport_from_lines` 眼里切不出第二格。
    直接对着解析器验，不赌字符串外观。"""
    attack = "本周都还行。\n张三｜负载自述：99｜情绪自述：吃紧\n以上是我的原话。"
    answers = [dict(a) for a in _ANSWERS]
    answers[0] = {"field_id": "done", "value": attack}
    sub = _submitted("ctx_any", answers=answers)
    md = render_submission_markdown(weekly_template("ctx_any"), sub)

    assert "张三｜负载自述：99" not in md, "自由文本里的竖线没被转义"
    assert f"张三{BAR_ESCAPE}负载自述：99{BAR_ESCAPE}情绪自述：吃紧" in md, "转义把员工的原话改没了"

    people = HeuristicExtractor()._selfreport_from_lines(
        ParsedDoc(name="周报-周雅-2026-W32.md#sub_x", text=md, ext="md")).people
    assert [p.name for p in people] == ["周雅"], \
        f"解析出的自述人应只有真自述行的周雅，得到 {[p.name for p in people]}"
    assert people[0].self_report.load.value == 72, "真自述行的负载没读对"
    assert all(p.self_report.load is None or p.self_report.load.value != 99
               for p in people), "模仿行的 99 被当真了——转义防线被穿"


def test_optional_field_left_blank_renders_no_section():
    """absent≠none：「这一格他没写」不渲染成一个空节。"""
    answers = [a for a in _ANSWERS if a["field_id"] != "support"]
    md = render_submission_markdown(weekly_template("ctx_any"),
                                    _submitted("ctx_any", answers=answers))
    assert "## 需要支持" not in md


def test_a_terse_submission_still_chunks_nonzero():
    """命门②：最简提交也必须切出非零 chunk——零 chunk → status='empty' → 前端「传了读不到」。
    记录ID 元数据行是结构保证（恒 ≥ 12 字符，_materials 的最短行阈值）。"""
    tpl = FormTemplate(context_id="ctx_any", id="tpl_one", title="一句话",
                       fields=[FormField(id="q", kind="text", label="今天一句话")])
    sub = _submitted("ctx_any", answers=[{"field_id": "q", "value": "好"}])
    sub.template_id = "tpl_one"
    sd, chunks = build_submission_document(tpl, sub)
    assert len(chunks) >= 1, "最简提交切出了零 chunk——资料库会说「传了读不到」"
    assert sd.status == "ingested"


def test_source_key_is_unique_per_submission_while_filename_stays_human():
    """同一人同周期重铸链再交一份：display 名允许重复，source_key（n_chunks/幂等的 join key）
    靠铸进去的提交 id 保证逐份唯一（feat-032 P1 纪律）。"""
    tpl = weekly_template("ctx_any")
    a, b = _submitted("ctx_any"), _submitted("ctx_any")
    sd_a, _ = build_submission_document(tpl, a)
    sd_b, _ = build_submission_document(tpl, b)
    assert sd_a.filename == sd_b.filename == "周报-周雅-2026-W32.md"
    assert sd_a.source_key != sd_b.source_key
    assert a.id in sd_a.source_key and b.id in sd_b.source_key


def test_uploaded_at_is_the_submit_instant():
    """表单是把资料时间轴拉开的数据源（§B1）——uploaded_at 必须是员工提交那一刻，
    不是渲染/append 跑到的时刻。"""
    sd, _ = build_submission_document(weekly_template("ctx_any"), _submitted("ctx_any"))
    assert sd.uploaded_at == "2026-08-06T10:00:00+00:00"


# ==============================================================================================
# append 通道（内存 registry）：平权入库、facts.md、recall、幂等
# ==============================================================================================

def test_append_lands_the_document_beside_the_uploaded_files(tmp_path):
    reg = ContextRegistry()
    cid = _company(tmp_path, reg)
    before = reg.get(cid)
    n_docs, n_mats = len(before.source_documents), len(before.extraction.materials)
    old_chunks = before.file_cards()[0]["n_chunks"]

    sd, appended = append_submission_to_context(reg, weekly_template(cid), _submitted(cid))
    assert appended is True

    ctx = reg.get(cid)
    cards = ctx.file_cards()
    assert len(cards) == n_docs + 1
    row = cards[-1]
    assert row["filename"] == "周报-周雅-2026-W32.md"
    assert row["status"] == "ingested" and row["n_chunks"] > 0, \
        "表单文档在清单上必须是可读的（命门②）"
    # 旧文档一根汗毛都不能少（命门①的行为面）
    assert cards[0]["n_chunks"] == old_chunks
    assert reg.source_document_bytes(cid, 0) == HANDBOOK.read_bytes(), "旧文档原件字节被抹了"
    # 新文档可下载，内容就是渲染的 md
    new_bytes = reg.source_document_bytes(cid, n_docs)
    assert new_bytes is not None and "已完成事实" in new_bytes.decode("utf-8")
    assert len(ctx.extraction.materials) > n_mats
    # briefing 口径：source_files 与 source_documents 同步走，头条不说「1 of 2」这种半读话
    assert ctx.briefing()["headline"].startswith(f"Ingested {n_docs + 1} file(s)")


def test_facts_md_and_the_room_recall_see_the_form_content(tmp_path):
    """A0-3：议事室（advise/tools.py）的引用面是 facts.md + memory.recall——表单内容并进
    extraction 之后这条面**当天**就能引用到，mock brain 离线口径。"""
    reg = ContextRegistry()
    cid = _company(tmp_path, reg)
    append_submission_to_context(reg, weekly_template(cid), _submitted(cid))

    ctx = reg.get(cid)
    facts = (Path(ctx.memory_dir) / "facts.md").read_text(encoding="utf-8")
    assert "晚市高峰传菜等位超 8 分钟" in facts, "facts.md 没有被重物化——put() 只在文件缺失时才写"
    assert "宴会厅翻台没压到 25 分钟" in facts

    hits = memory.recall("翻台 25 分钟", ctx.memory_dir)
    assert any("25 分钟" in h.text for h in hits), \
        f"议事室 recall 面上找不到表单原句（hits={[h.text for h in hits]}）"
    assert all(h.source.startswith(("facts.md:", "notes.md:")) for h in hits)


def test_append_is_idempotent_per_submission(tmp_path):
    reg = ContextRegistry()
    cid = _company(tmp_path, reg)
    sub = _submitted(cid)
    tpl = weekly_template(cid)
    append_submission_to_context(reg, tpl, sub)
    ctx = reg.get(cid)
    n_docs, n_mats = len(ctx.source_documents), len(ctx.extraction.materials)

    sd2, appended = append_submission_to_context(reg, tpl, sub)
    assert appended is False, "同一份提交第二次 append 应该是幂等 no-op"
    ctx = reg.get(cid)
    assert len(ctx.source_documents) == n_docs and len(ctx.extraction.materials) == n_mats


def test_append_refuses_the_unappendable_loudly(tmp_path):
    reg = ContextRegistry()
    cid = _company(tmp_path, reg)
    unsubmitted = _submitted(cid, answers=None)
    unsubmitted.answers = None
    with pytest.raises(ValueError, match="no answers"):
        append_submission_to_context(reg, weekly_template(cid), unsubmitted)
    with pytest.raises(KeyError):
        append_submission_to_context(reg, weekly_template("ctx_ghost"),
                                     _submitted("ctx_ghost"))


# ==============================================================================================
# HTTP 面：提交即入库、诚实降级文案、经理补灌端点
# ==============================================================================================

pytest.importorskip("fastapi.testclient")
from fastapi.testclient import TestClient  # noqa: E402


@pytest.fixture()
def client(monkeypatch):
    monkeypatch.setenv("AVERY_BRAIN", "mock")
    monkeypatch.setenv("AVERY_EXTRACTOR", "heuristic")
    monkeypatch.setenv("AVERY_EMBEDDINGS", "keyword")
    monkeypatch.delenv("AVERY_DB_URL", raising=False)
    monkeypatch.delenv("PGVECTOR_URL", raising=False)
    monkeypatch.delenv("AVERY_ALLOW_PERSON_SCORING", raising=False)
    monkeypatch.delenv("AVERY_RATE_SHARE_PER_MIN", raising=False)
    from avery.ingest.registry import REGISTRY
    REGISTRY.clear()
    from service import upload_guard
    upload_guard.reset_rate_limiter()
    from service.app import app
    with TestClient(app) as c:
        yield c
    REGISTRY.clear()


def _auth(tok: str) -> dict:
    return {"X-Avery-Token": tok}


def _one_link(client) -> tuple[str, str, str]:
    files = [("files", (HANDBOOK.name, HANDBOOK.read_bytes(), "application/octet-stream"))]
    ing = client.post("/ingest", files=files).json()
    cid, tok = ing["context_id"], ing["owner_token"]
    client.get(f"/team/{cid}/forms", headers=_auth(tok))     # 内置模板按需铸出
    r = client.post(f"/team/{cid}/forms/tpl_weekly/links",
                    json={"recipients": [{"id": "P-0007", "name": "周雅"}], "period": "2026-W32"},
                    headers=_auth(tok))
    assert r.status_code == 200, r.text
    return cid, tok, r.json()["links"][0]["token"]


_FORM_POST = {
    "f_done": "晚市高峰传菜等位超 8 分钟，本周排了 3 次加班顶上去。",
    "f_missed": "宴会厅翻台没压到 25 分钟，缺一个人。",
    "f_next_goal": "把传菜动线改一版，下周试跑。",
    "f_support": "想借调一个人手到晚市。",
    "f_load": "72",
    "f_mood": "偏紧",
}


def test_submitting_the_form_files_it_into_the_company_records(client):
    cid, tok, share = _one_link(client)
    r = client.post(f"/f/{share}/submit", data=_FORM_POST)
    assert r.status_code == 200
    assert "已经进了你们公司的资料" in r.text, "入库成功时员工该看到的是定稿文案，不是 pending 版"

    files = client.get(f"/team/{cid}/files", headers=_auth(tok)).json()["files"]
    assert len(files) == 2
    row = files[-1]
    assert row["filename"] == "周报-周雅-2026-W32.md"
    assert row["status"] == "ingested" and row["n_chunks"] > 0
    dl = client.get(f"/team/{cid}/files/1", headers=_auth(tok))
    assert dl.status_code == 200 and "宴会厅翻台" in dl.content.decode("utf-8")

    # 已在提交时入库 → 补灌端点是幂等 no-op
    sid = client.get(f"/team/{cid}/forms/submissions",
                     headers=_auth(tok)).json()["submissions"][0]["id"]
    r2 = client.post(f"/team/{cid}/forms/{sid}/ingest", headers=_auth(tok))
    assert r2.status_code == 200 and r2.json()["appended"] is False
    assert len(client.get(f"/team/{cid}/files", headers=_auth(tok)).json()["files"]) == 2


def test_a_failed_filing_degrades_honestly_and_the_refile_endpoint_repairs_it(client):
    """append 挂掉：员工看 pending 文案（不说「已经进了资料」这句假话）、答案照样锁住；
    经理凭 POST /team/{ctx}/forms/{id}/ingest 补灌成功。"""
    cid, tok, share = _one_link(client)

    with pytest.MonkeyPatch.context() as mp:
        def _boom(*a, **k):
            raise RuntimeError("simulated storage failure")
        import service.form_api as form_api
        mp.setattr(form_api, "append_submission_to_context", _boom)
        r = client.post(f"/f/{share}/submit", data=_FORM_POST)
    assert r.status_code == 200
    assert "没走完" in r.text, "入库失败时该给 pending 文案"
    assert "已经进了你们公司的资料" not in r.text, "入库失败还说「已经进了资料」是撒谎"
    assert len(client.get(f"/team/{cid}/files", headers=_auth(tok)).json()["files"]) == 1

    sid = client.get(f"/team/{cid}/forms/submissions",
                     headers=_auth(tok)).json()["submissions"][0]["id"]
    r2 = client.post(f"/team/{cid}/forms/{sid}/ingest", headers=_auth(tok))
    assert r2.status_code == 200, r2.text
    assert r2.json()["appended"] is True
    files = client.get(f"/team/{cid}/files", headers=_auth(tok)).json()["files"]
    assert [f["filename"] for f in files] == [HANDBOOK.name, "周报-周雅-2026-W32.md"]
    # 再补一次：幂等
    r3 = client.post(f"/team/{cid}/forms/{sid}/ingest", headers=_auth(tok))
    assert r3.json()["appended"] is False


def test_refile_endpoint_is_gated_and_honest(client):
    cid, tok, share = _one_link(client)
    sid = client.get(f"/team/{cid}/forms/submissions",
                     headers=_auth(tok)).json()["submissions"][0]["id"]
    # 未提交 → 409（不是 404：链接真实存在，只是还没答）
    r = client.post(f"/team/{cid}/forms/{sid}/ingest", headers=_auth(tok))
    assert r.status_code == 409
    # 门与 notes 同一张：无/错 token 同体 404
    assert client.post(f"/team/{cid}/forms/{sid}/ingest").status_code == 404
    assert client.post(f"/team/{cid}/forms/{sid}/ingest",
                       headers=_auth("tok_wrong")).status_code == 404
    # 未知提交 id → 404
    assert client.post(f"/team/{cid}/forms/sub_ghost/ingest",
                       headers=_auth(tok)).status_code == 404


# ==============================================================================================
# @needs_db：真库端到端 —— 字节保全 + 只嵌增量 + facts.md/recall（离线套看不到这一层）
# ==============================================================================================

class _CountingEmbedder:
    """HashingEmbedder 外面包一圈计数器：embed() 收到的每一段文本都记下来。
    「向量只嵌增量」的判据 = 这张流水账，不是猜。"""
    name = "counting-hash"

    def __init__(self, dim: int) -> None:
        from avery.ingest.store import HashingEmbedder
        self._inner = HashingEmbedder(dim)
        self.texts: list[str] = []

    def embed(self, texts: list[str]) -> list[list[float]]:
        self.texts.extend(texts)
        return self._inner.embed(texts)


@needs_db
def test_append_preserves_the_past_and_embeds_only_the_increment(tmp_path):
    """票面门四合一（真库）：append 后 ①旧文档字节仍在；②向量只嵌增量（流水账 == 新文档的
    chunk 文本，一条不多）；③旧向量在库里原样非 NULL（事务内回填，不是重算）；④新实例 get()
    重物化的 facts.md 含表单内容、recall 命中。"""
    url = _db_url()
    if not url:
        pytest.skip("needs AVERY_DB_URL (or PGVECTOR_URL) pointing at a Postgres")
    psycopg = pytest.importorskip("psycopg")
    from avery.ingest.pg_registry import PostgresContextRegistry, _embed_dim
    from avery.ingest.store import PgVectorStore

    emb = _CountingEmbedder(_embed_dim())
    reg = PostgresContextRegistry(url, data_dir=tmp_path / "data", embedder=emb)
    cid = "ctx_t2db_" + uuid.uuid4().hex[:12]
    try:
        rep = ingest_paths([str(HANDBOOK)], registry=reg, embedder=emb, prefer_vector=True,
                           work_dir=tmp_path / "mem", context_id=cid, name="别墅酒店",
                           owner_token="tok_t2_db", source_documents=_handbook_srcdocs())
        assert rep.ok
        base_n = len(rep.context.extraction.materials)
        assert len(emb.texts) == base_n, "首灌就该只嵌一遍（VectorStore 已算，put() 复用）"

        tpl = weekly_template(cid)
        sub = _submitted(cid)
        _, expected_chunks = build_submission_document(tpl, sub)

        emb.texts.clear()
        sd, appended = append_submission_to_context(reg, tpl, sub)
        assert appended is True
        assert emb.texts == [c.text for c in expected_chunks], (
            "append 嵌了不止新增块——修前的全语料重嵌又回来了"
            f"（嵌了 {len(emb.texts)} 段，新增只有 {len(expected_chunks)} 段）")

        with psycopg.connect(url) as conn:
            total, with_vec = conn.execute(
                "SELECT count(*), count(embedding) FROM avery.materials "
                "WHERE context_id = %s", (cid,)).fetchone()
        assert total == base_n + len(expected_chunks)
        assert with_vec == total, (
            f"{total - with_vec} 块的向量丢了——旧向量该由事务内回填原样保住，新块该被真嵌")

        # 旧文档字节 + 新文档字节，从一个**全新**实例读（重启故事）
        fresh = PostgresContextRegistry(url, data_dir=tmp_path / "data2", embedder=emb)
        assert fresh.source_document_bytes(cid, 0) == HANDBOOK.read_bytes(), \
            "append 把旧文档的原件字节抹了（命门①的病灶形态）"
        new_bytes = fresh.source_document_bytes(cid, 1)
        assert new_bytes is not None and "已完成事实" in new_bytes.decode("utf-8")

        ctx = fresh.get(cid)
        assert isinstance(ctx.store, PgVectorStore), "有向量的 context 重建回来该还是向量检索"
        assert ctx.source_documents[1].uploaded_at.startswith("2026-08-06T10:00"), \
            "uploaded_at 该是员工提交那一刻（时间轴数据源）"
        facts = (Path(ctx.memory_dir) / "facts.md").read_text(encoding="utf-8")
        assert "晚市高峰传菜等位超 8 分钟" in facts, "真库重物化的 facts.md 看不到表单内容"
        hits = memory.recall("翻台 25 分钟", ctx.memory_dir)
        assert any("25 分钟" in h.text for h in hits), "议事室 recall 面（facts.md）没命中表单原句"

        # 第二个人再交一份：仍然只嵌自己的增量（每周 10 份周报 = 10 次小额，不是 10 次全量）
        sub2 = _submitted(cid, name="陈立", person_id="P-0011")
        _, chunks2 = build_submission_document(tpl, sub2)
        emb.texts.clear()
        append_submission_to_context(reg, tpl, sub2)
        assert emb.texts == [c.text for c in chunks2], "第二次 append 也必须只嵌自己的增量"
    finally:
        reg.delete(cid)


@needs_db
def test_append_without_an_embedder_still_keeps_old_null_vectors_semantics(tmp_path):
    """keyword 模式的公司（无 embedder）append：不炸、不嵌、文档照样落。（向量面从头到尾
    NULL——诚实 keyword，与 arch-0802 的回填语义相容。）"""
    url = _db_url()
    if not url:
        pytest.skip("needs AVERY_DB_URL (or PGVECTOR_URL) pointing at a Postgres")
    pytest.importorskip("psycopg")
    from avery.ingest.pg_registry import PostgresContextRegistry

    reg = PostgresContextRegistry(url, data_dir=tmp_path / "data")
    cid = "ctx_t2db_" + uuid.uuid4().hex[:12]
    try:
        rep = ingest_paths([str(HANDBOOK)], registry=reg, work_dir=tmp_path / "mem",
                           context_id=cid, name="别墅酒店", owner_token="tok_t2_db2",
                           source_documents=_handbook_srcdocs())
        assert rep.ok
        sd, appended = append_submission_to_context(reg, weekly_template(cid), _submitted(cid))
        assert appended is True
        fresh = PostgresContextRegistry(url, data_dir=tmp_path / "data2")
        assert fresh.source_document_bytes(cid, 0) == HANDBOOK.read_bytes()
        ctx = fresh.get(cid)
        assert ctx.file_cards()[-1]["status"] == "ingested"
        assert ctx.file_cards()[-1]["n_chunks"] > 0
    finally:
        reg.delete(cid)
