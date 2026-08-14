"""feat-030 — the ContextRegistry persistence contract: ONE suite, TWO implementations.

The registry seam (`avery/ingest/registry.py::ContextRegistry`, feat-018: "a DB-backed registry
would plug in behind the same get/put API") gets its DB implementation here. Behavior, not
internals, is the contract:

  SHARED (memory + postgres both must pass — the offline suite runs the memory leg with no DB):
    * put -> get returns the same company: id, name, source_files, team/project/signal cards,
      briefing — byte-equal payloads;
    * unknown id -> None / not-contained / no memory_dir (the feat-028 404 depends on this);
    * recall over a stored context stays line-addressable (`<file>:<line>` — the cite seam);
    * team_cards carry NO scoring key and NO numeric-typed field (red line on the stored path:
      persistence must not open a hole the extraction gate closed);
    * `AVERY_DATA_DIR` routes materialized memory to a STABLE dir (not the OS temp dir the
      pre-030 pipeline used — a reboot-survivable location is the point of persistence).

  DURABILITY (@needs_db, postgres only — a process dict legitimately cannot pass these):
    * a context put by one registry instance is visible to a BRAND-NEW instance/connection
      (the restart claim at module level);
    * memory_dir re-materializes from the DB after the local files are wiped, byte-identical,
      and the loop's own `avery.memory.recall` works over the restored dir;
    * the DB itself refuses a person row carrying a scoring key (CHECK constraint — the red
      line is structural in the schema, not just in Python);
    * schema reserves the feat-031/038 seams: `materials.embedding vector` + `contexts.owner_token`.

`@needs_db` follows the @seedgate/@smoke convention: no AVERY_DB_URL/PGVECTOR_URL -> clean skip,
so the offline default suite stays green with no external service.
"""
from __future__ import annotations

import contextlib
import os
import re
import shutil
import uuid
from pathlib import Path

import pytest

from avery.ingest import ingest_paths
from avery.ingest.extract import FORBIDDEN_PERSON_KEYS
from avery.ingest.registry import ContextRegistry

HERE = Path(__file__).resolve().parent.parent          # eval-harness/
FIX = HERE / "tests" / "fixtures" / "ingest"
HANDBOOK = FIX / "Studio_Handbook.md"
ROSTER = FIX / "Team_Roster.xlsx"

needs_db = pytest.mark.needs_db


def _db_url() -> str | None:
    return (os.environ.get("AVERY_DB_URL") or os.environ.get("PGVECTOR_URL") or "").strip() or None


def _new_cid() -> str:
    return "ctx_test_" + uuid.uuid4().hex[:12]


class _Impl:
    """A registry implementation under contract. `fresh()` returns a handle onto the same
    underlying storage; `track(cid)` registers a context id for post-test DB hygiene."""

    def __init__(self, name: str, fresh):
        self.name = name
        self.fresh = fresh
        self.created: list[str] = []

    def track(self, cid: str) -> str:
        self.created.append(cid)
        return cid


def _pg_impl(tmp_path: Path) -> _Impl:
    url = _db_url()
    if not url:
        pytest.skip("needs AVERY_DB_URL (or PGVECTOR_URL) pointing at a Postgres — DB layer skipped")
    pytest.importorskip("psycopg")
    from avery.ingest.pg_registry import PostgresContextRegistry

    data_dir = tmp_path / "data"
    return _Impl("postgres", lambda: PostgresContextRegistry(url, data_dir=data_dir))


def _pg_cleanup(impl: _Impl) -> None:
    if impl.name != "postgres" or not impl.created:
        return
    reg = impl.fresh()
    for cid in impl.created:
        reg.delete(cid)


@pytest.fixture(params=["memory", pytest.param("postgres", marks=needs_db)])
def impl(request, tmp_path):
    """The two implementations behind ONE contract. Memory = the offline default (no DB, no skip);
    postgres = the feat-030 persistence layer (@needs_db, clean-skips without a URL)."""
    if request.param == "memory":
        reg = ContextRegistry()
        yield _Impl("memory", lambda: reg)
        return
    pg = _pg_impl(tmp_path)
    yield pg
    _pg_cleanup(pg)


def _ingest(impl: _Impl, work_dir: Path, files: list[Path] | None = None,
            source_documents=None, owner_token: str = ""):
    """Drive the REAL pipeline (parse -> extract -> red-line gate -> store -> put) at the registry
    under test — the contract exercises the same write path the service uses."""
    reg = impl.fresh()
    cid = impl.track(_new_cid())
    paths = [str(p) for p in (files or [HANDBOOK, ROSTER])]
    rep = ingest_paths(paths, registry=reg, work_dir=work_dir, context_id=cid, name="prism",
                       source_documents=source_documents, owner_token=owner_token)
    assert rep.ok, f"fixture ingest failed the red-line gate: {rep.redline.summary()}"
    return reg, cid, rep


def _sample_source_docs():
    """The raw uploads (bytes + metadata) a company's file space keeps (feat-032). Mirrors what the
    /ingest handler builds from `await f.read()`."""
    from avery.ingest.registry import SourceDocument
    return [
        SourceDocument(filename=HANDBOOK.name, mime="text/markdown",
                       size_bytes=HANDBOOK.stat().st_size, content=HANDBOOK.read_bytes()),
        SourceDocument(filename=ROSTER.name,
                       mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                       size_bytes=ROSTER.stat().st_size, content=ROSTER.read_bytes()),
    ]


# ==============================================================================================
# SHARED CONTRACT — memory + postgres
# ==============================================================================================

def test_put_then_get_returns_the_same_company(impl, tmp_path):
    reg, cid, rep = _ingest(impl, tmp_path / "mem")
    got = reg.get(cid)
    assert got is not None, "put -> get lost the context"
    assert got.context_id == cid
    assert got.name == "prism"
    assert got.source_files == [HANDBOOK.name, ROSTER.name]
    src = rep.context
    assert got.team_cards() == src.team_cards()
    assert got.project_cards() == src.project_cards()
    assert got.signal_cards() == src.signal_cards()
    assert got.briefing() == src.briefing()
    assert cid in reg


def test_unknown_id_resolves_to_nothing(impl):
    reg = impl.fresh()
    ghost = "ctx_never_registered"
    assert reg.get(ghost) is None
    assert ghost not in reg
    assert reg.resolve_memory_dir(ghost) is None


def test_source_document_keys_answers_without_pulling_the_archive(impl, tmp_path):
    """issue #99 —— 补传在抽取**之前**唯一需要的那次读，两条腿必须给同一个答案。

    这个方法存在的理由是时序（见 `file_append` 命门④）：整档 `get()` 一旦被握过那两三分钟，
    写回就会抹掉期间落地的手编。但它一旦**读漏一个 key**，换来的是另一种安静的坏：同名文档被
    当成新文档接纳，而 `<source_key>:<行号>` 是出处契约 —— 每文件块数、时间轴那一天、冲突卡
    引的那份资料三处一起指错，没有任何一道门会红（`existing_source_keys` 的 docstring）。
    所以这条合约钉三件事：**不存在→None**、**存在但没文档→空集合**、**有文档→就是那几个 key**。

    🔴 期望值**不由被测函数算出来**（尺子长在被量的东西上 = 函数一缩水期望值跟着缩水）：
    `literal` 是测试侧手写的常量，`existing_source_keys(get(...))` 是另一条独立的路（整档投影，
    补传路修改之前用的就是它）。三份必须同时相等。
    """
    from avery.ingest.file_append import existing_source_keys

    reg = impl.fresh()
    assert reg.source_document_keys("ctx_never_registered") is None, (
        "不存在的 context 必须与 get() 同义地回 None —— 回空集合等于把「档案没了」翻译成"
        "「档案是空的」，补传会照着往一个不存在的 id 上写")

    # 存在、但一份文档都没有（feat-032 之前的形状 / 直接建的 context）→ 空集合，不是 None
    bare_reg, bare_cid, _ = _ingest(impl, tmp_path / "bare")
    assert bare_reg.source_document_keys(bare_cid) == set(), (
        "「存在但没有文档」被答成了 None —— 与「档案不存在」混成了同一个答案")

    with_docs, cid, _ = _ingest(impl, tmp_path / "mem", source_documents=_sample_source_docs())
    literal = {HANDBOOK.name, ROSTER.name}          # 测试侧手写的那一份
    narrow = with_docs.source_document_keys(cid)
    wide = existing_source_keys(with_docs.get(cid))
    assert narrow == literal, f"窄读漏了/多了 key：{narrow} != {literal}"
    assert wide == literal, f"整档投影漏了/多了 key：{wide} != {literal}"


def test_recall_over_a_stored_context_stays_line_addressable(impl, tmp_path):
    reg, cid, _ = _ingest(impl, tmp_path / "mem")
    got = reg.get(cid)
    hits = got.recall("weekly written status update Friday")
    assert hits, "recall over a stored context returned nothing"
    for h in hits:
        assert re.match(r"^.+:\d+$", h.source), (
            f"hit source {h.source!r} is not line-addressable (<file>:<line>) — the cite seam breaks")
        assert h.text.strip()


def test_team_cards_from_storage_never_carry_scoring_keys(impl, tmp_path):
    """The red line survives the storage round-trip: no scoring key, no numeric-typed field on any
    person card (same rule the wire-level seed gate pins)."""
    reg, cid, _ = _ingest(impl, tmp_path / "mem")
    for card in reg.get(cid).team_cards():
        for key in card.keys():
            norm = re.sub(r"[^a-z0-9]", "", str(key).lower())
            assert norm not in FORBIDDEN_PERSON_KEYS, (
                f"forbidden scoring key on stored person card {card.get('name')!r}: {key!r}")
        numeric = [k for k, v in card.items()
                   if isinstance(v, (int, float)) and not isinstance(v, bool)]
        assert not numeric, (
            f"numeric-typed field on stored person card {card.get('name')!r}: {numeric} "
            f"(red line: person cards have no blood bar / score)")


def test_resolve_memory_dir_points_at_materialized_memory(impl, tmp_path):
    reg, cid, _ = _ingest(impl, tmp_path / "mem")
    mem = reg.resolve_memory_dir(cid)
    assert mem is not None
    assert (Path(mem) / "facts.md").exists(), "resolved memory_dir has no facts.md — recall would find nothing"


# ==============================================================================================
# feat-038 — the owner_token persistence contract (shared: memory + postgres). The tenant-isolation
# credential minted at /ingest must round-trip through put/get on BOTH backends, so the HTTP read
# gate (authorize_context) validates against a token that actually survived storage. A tokenless
# context (a pre-038 / direct caller) round-trips as "" (no auth required — v1 back-compat).
# ==============================================================================================

def test_owner_token_round_trips_through_storage(impl, tmp_path):
    reg, cid, _ = _ingest(impl, tmp_path / "mem", owner_token="tok_secret_holder_credential_xyz")
    got = reg.get(cid)
    assert got is not None
    assert got.owner_token == "tok_secret_holder_credential_xyz", (
        "owner_token did not survive the put/get round-trip — the read gate would validate against "
        "an empty token and let anyone in")


def test_tokenless_context_round_trips_as_empty(impl, tmp_path):
    """A context ingested WITHOUT an owner_token (the pre-038 / direct-caller path) reads back with
    an empty token — never a crash, never a spurious credential. Back-compat: such a context is
    readable without a token (the HTTP gate only enforces when owner_token is non-empty)."""
    reg, cid, _ = _ingest(impl, tmp_path / "mem")
    assert reg.get(cid).owner_token == ""


def test_ingest_materializes_under_avery_data_dir(monkeypatch, tmp_path):
    """No explicit work_dir + AVERY_DATA_DIR set -> memory materializes under the STABLE data dir,
    not the OS temp dir (pre-030 behavior). Registry-independent pipeline behavior."""
    stable = tmp_path / "stable-data"
    monkeypatch.setenv("AVERY_DATA_DIR", str(stable))
    reg = ContextRegistry()
    rep = ingest_paths([str(HANDBOOK)], registry=reg, context_id="ctx_datadir_gate")
    assert rep.ok
    mem = Path(rep.context.memory_dir).resolve()
    assert stable.resolve() in mem.parents, (
        f"memory materialized at {mem}, not under AVERY_DATA_DIR={stable} — a redeploy wipes it")


# ==============================================================================================
# feat-032 — the per-company FILE SPACE contract (shared: memory + postgres). The raw uploads are
# kept (bytes + metadata), a manifest projects them with n_chunks, and the bytes are retrievable.
# ==============================================================================================

def test_source_documents_round_trip(impl, tmp_path):
    """put(context with source_documents) -> get() returns the same file MANIFEST (filename / mime /
    size / doc_kind), each file's n_chunks links to the material chunks it produced, and the raw
    bytes are retrievable through the registry — the same behavior memory and postgres both owe."""
    src_docs = _sample_source_docs()
    reg, cid, _ = _ingest(impl, tmp_path / "mem", source_documents=src_docs)

    got = reg.get(cid)
    assert got is not None
    cards = got.file_cards()
    assert [c["filename"] for c in cards] == [HANDBOOK.name, ROSTER.name], (
        "the file manifest lost/ reordered the uploaded files")
    by_name = {c["filename"]: c for c in cards}
    assert by_name[HANDBOOK.name]["size_bytes"] == HANDBOOK.stat().st_size
    assert by_name[HANDBOOK.name]["mime"] == "text/markdown"
    # issue #74 — these fixtures carry NO source_key (the pre-032 row shape: the column defaults to
    # '' , not NULL). The manifest must publish the RESOLVED key, i.e. fall back to filename — an
    # empty string here would hand the client an id that matches no document at all.
    assert [c["source_key"] for c in cards] == [HANDBOOK.name, ROSTER.name], (
        f"a pre-032 row must fall back to its filename, never publish '': {cards}")
    # n_chunks links a file to the material chunks it produced (materials.source '<filename>:<line>').
    assert by_name[HANDBOOK.name]["n_chunks"] > 0, "handbook produced material but manifest shows 0"
    assert sum(c["n_chunks"] for c in cards) == len(got.extraction.materials), (
        "manifest n_chunks must account for every material chunk")

    # The raw bytes survive the round-trip and are retrievable by (context_id, idx) — memory holds
    # them, postgres reads them back from bytea. Both must return the ORIGINAL upload byte-for-byte.
    fresh = impl.fresh()
    assert fresh.source_document_bytes(cid, 0) == HANDBOOK.read_bytes()
    assert fresh.source_document_bytes(cid, 1) == ROSTER.read_bytes()
    assert fresh.source_document_bytes(cid, 99) is None, "out-of-range idx must be None, not a crash"


def test_manual_crud_does_not_destroy_the_uploaded_bytes(impl, tmp_path):
    """files-hub-0729/01 · An UNRELATED write (add a project by hand) must not wipe the raw uploads.

    The bug this pins: every manual-CRUD entry point is `get() -> mutate -> put()`
    (registry.py add_project / patch_project / add_person / archive_*), and the postgres `get()`
    deliberately does NOT pull the bytea (pg_registry.py, `content=None` — a multi-MB upload has no
    business loading just to read a roster). So `put()` used to re-INSERT `content=None` right after
    DELETEing the real rows: one "add a project" click permanently destroyed every original file the
    customer uploaded, and `GET /team/{id}/files/{idx}` 404'd forever after while the manifest kept
    listing the files with correct sizes.

    Two things ride on this, and the second is the heavier one:
      1. the file hub's per-file Download becomes a button that is visible, clickable and always
         fails — precisely the 「不建假按钮」 red line, arriving through the back door;
      2. the user's ORIGINAL uploads are gone, which is data loss independent of any UI.

    Memory passes trivially (it hands back the same objects); postgres is the real subject. Both owe
    the same contract, so the assertion lives in the shared section rather than under @needs_db —
    a future third implementation inherits it automatically."""
    src_docs = _sample_source_docs()
    reg, cid, _ = _ingest(impl, tmp_path / "mem", source_documents=src_docs)
    assert reg.source_document_bytes(cid, 0) == HANDBOOK.read_bytes(), "fixture precondition"

    # The most ordinary write there is — nothing to do with files.
    reg.add_project(cid, {"name": "Harbor refit", "status": "active"})

    fresh = impl.fresh()
    assert fresh.source_document_bytes(cid, 0) == HANDBOOK.read_bytes(), (
        "a manual project write destroyed the first upload's bytes")
    assert fresh.source_document_bytes(cid, 1) == ROSTER.read_bytes(), (
        "a manual project write destroyed the second upload's bytes")
    # The manifest must still agree with what is actually downloadable — a list that promises files
    # the download seam cannot serve is the same lie in a different place.
    got = fresh.get(cid)
    assert [c["filename"] for c in got.file_cards()] == [HANDBOOK.name, ROSTER.name]

    # And it must survive REPEATED writes, not just the first one (the round-trip re-reads what the
    # previous put wrote back, so a fix that only works once would pass the assertion above).
    reg.add_person(cid, {"name": "Wu Lei", "role": "Front office"})
    assert impl.fresh().source_document_bytes(cid, 0) == HANDBOOK.read_bytes(), (
        "the bytes survived one write but not two")


def test_source_documents_absent_is_empty_manifest(impl, tmp_path):
    """A context ingested WITHOUT source_documents (the pre-032 path) has an empty file manifest and
    None bytes — never a crash. Backward-compatible with every existing ingest."""
    reg, cid, _ = _ingest(impl, tmp_path / "mem")
    got = reg.get(cid)
    assert got.file_cards() == []
    assert impl.fresh().source_document_bytes(cid, 0) is None


def test_source_documents_with_duplicate_filenames_survive_the_round_trip(impl, tmp_path):
    """feat-032 P1 durability: two uploads sharing a display `filename` but with DISTINCT
    `source_key`s keep their OWN n_chunks and OWN bytes across the storage round-trip (postgres reads
    source_key back from the column; a filename-only join would silently MERGE them). This is the
    persisted twin of the /ingest-time repro."""
    from avery.ingest.registry import SourceDocument

    alpha = b"AlphaUnique line one is quite long enough\nalpha second line also long enough here\n"
    beta = b"BetaUnique line one is quite long enough now\nbeta second line also long enough here\n"
    up = tmp_path / "up"
    up.mkdir()
    # DISTINCT on-disk names (what the /ingest handler now writes) -> distinct ParsedDoc names ->
    # distinct material source prefixes; the SourceDocument.filename stays the shared display name.
    pa = up / "report.txt"
    pa.write_bytes(alpha)
    pb = up / "report(1).txt"
    pb.write_bytes(beta)
    src_docs = [
        SourceDocument(filename="report.txt", source_key="report.txt", mime="text/plain",
                       size_bytes=len(alpha), content=alpha),
        SourceDocument(filename="report.txt", source_key="report(1).txt", mime="text/plain",
                       size_bytes=len(beta), content=beta),
    ]
    reg, cid, _ = _ingest(impl, tmp_path / "mem", files=[pa, pb], source_documents=src_docs)

    got = reg.get(cid)
    cards = got.file_cards()
    assert [c["filename"] for c in cards] == ["report.txt", "report.txt"], (
        "duplicate-named uploads were dropped/reordered")
    # issue #74 — the manifest must PUBLISH the disambiguated key, not just join on it internally.
    # The display name is ambiguous by construction here; source_key is the only thing a client can
    # use to address the second document (an @ mention carrying the display name resolves to the
    # FIRST one, silently). Both adapters must round-trip it identically.
    assert [c["source_key"] for c in cards] == ["report.txt", "report(1).txt"], (
        f"the manifest hid the per-document key clients need to address these apart: {cards}")
    # Each row attributes ONLY its own document's chunks (>0 each); a filename merge would double one
    # row and zero the other, or sum both onto both.
    assert all(c["n_chunks"] > 0 for c in cards), f"a duplicate-named file lost its chunks: {cards}"
    assert sum(c["n_chunks"] for c in cards) == len(got.extraction.materials)
    assert cards[0]["n_chunks"] == cards[1]["n_chunks"], (
        "two equal-sized same-named files should each own an equal share of chunks")

    # Each file's OWN bytes survive, addressed by idx (postgres reads bytea back per row).
    fresh = impl.fresh()
    assert fresh.source_document_bytes(cid, 0) == alpha
    assert fresh.source_document_bytes(cid, 1) == beta


# ==============================================================================================
# 设计0810 · #86 — `empty_context()`：清空这份档案，但档案本身留着。ONE suite, TWO legs.
#
# 为什么它必须落在**这个**文件而不是只留在 test_context_empty_t86.py：清空的两条腿是两套完全
# 不同的机制（内存腿原地 mutate 一个活对象；pg 腿是库内显式 DELETE + 重写 memory_files），
# 「两边结果一样」在别处没有任何一条判据看着。而本文件的 `impl` 参数化正是为这件事存在的 ——
# memory 离线跑、postgres 挂 @needs_db，同一套断言跑两遍。
#
# ⚠ 与 pg 独有的 `delete()` 是**反面**：那个删 contexts 行本身（id/token 一起没）。
# `test_registry_protocol.py` 明令禁止内存腿长出 `delete()`，所以本方法换了名字。
# ==============================================================================================

def test_empty_context_clears_the_uploads_and_keeps_the_identity(impl, tmp_path):
    reg, cid, _ = _ingest(impl, tmp_path / "mem", source_documents=_sample_source_docs(),
                          owner_token="tok_empty_86")
    before = reg.get(cid)
    assert before.source_files and before.extraction.materials, "自证：种子自己就是空的"
    assert before.file_cards(), "自证：file space 是空的，下面的判据够不着"

    assert impl.fresh().empty_context(cid) is True

    got = impl.fresh().get(cid)
    assert got is not None, "清空把整份档案删了 —— 那是 delete()，不是 empty_context()"
    # 清掉的：文件与文件推出来的一切。
    assert got.source_files == [] and got.source_documents == []
    assert got.file_cards() == []
    assert got.extraction.materials == []
    assert got.extraction.people == [] and got.extraction.projects == []
    assert got.extraction.signals == [] and got.extraction.playbooks == []
    assert got.extraction.conflicts == []
    assert impl.fresh().source_document_bytes(cid, 0) is None, "原件字节还下载得到"
    # 留下的：档案的身份。这半边才是本票的意义所在。
    assert cid in impl.fresh()
    assert got.context_id == cid and got.name == "prism"
    assert got.owner_token == "tok_empty_86", "owner_token 没了 = 用户手上那份锚点作废"


def test_empty_context_materializes_the_same_empty_memory_on_both_legs(impl, tmp_path):
    """facts.md / notes.md 必须重物化成空，且**两条腿逐字节同一份**。

    内存腿走 `materialize_memory(空抽取)`（会写下两行标题），pg 腿把同一份文本写进
    `memory_files`。任何一边偷懒写成空串，这条在跑到另一条腿时就红。
    """
    from avery.ingest.extract import ExtractionResult
    from avery.ingest.registry import materialize_memory

    reg, cid, _ = _ingest(impl, tmp_path / "mem")
    mem_before = reg.get(cid).memory_dir
    assert "## People" in (mem_before / "facts.md").read_text(encoding="utf-8"), "自证：facts 是空的"

    assert impl.fresh().empty_context(cid) is True

    mem_dir = impl.fresh().get(cid).memory_dir
    want = tmp_path / "want"
    materialize_memory(ExtractionResult(), want)
    for name in ("facts.md", "notes.md"):
        assert (mem_dir / name).read_text(encoding="utf-8") == \
            (want / name).read_text(encoding="utf-8"), f"{name} 与空档案的重物化产物不一致"


def test_empty_context_keeps_notes_and_advise_runs(impl, tmp_path):
    """对话历史与 Avery 自己写的观察不是文件的衍生物 —— 清文件不带走它们。"""
    reg, cid, _ = _ingest(impl, tmp_path / "mem")
    reg.append_note(cid, "The onboarding backlog keeps landing on one squad — a load problem.")
    reg.append_advise_run(cid, "How should we staff next week?", answer="Cover the evening peak.",
                          thread_id="th_86")
    assert len(reg.list_notes(cid)) == 1 and len(reg.list_advise_runs(cid)) == 1

    assert impl.fresh().empty_context(cid) is True

    fresh = impl.fresh()
    notes = fresh.list_notes(cid)
    assert len(notes) == 1 and "onboarding backlog" in notes[0].text
    runs = fresh.list_advise_runs(cid)
    assert len(runs) == 1 and runs[0].question == "How should we staff next week?"
    assert runs[0].thread_id == "th_86"
    assert len(fresh.list_advise_threads(cid)) == 1


def test_empty_context_keeps_the_account_binding(impl, tmp_path):
    reg, cid, _ = _ingest(impl, tmp_path / "mem")
    user = "user_" + uuid.uuid4().hex[:10]
    assert reg.link_account_context(user, cid) is True

    assert impl.fresh().empty_context(cid) is True

    fresh = impl.fresh()
    assert fresh.contexts_for_account(user) == [cid]
    assert fresh.account_owns(user, cid) is True


# ── #100 · 一家公司多个账号：成员语义的两腿同一契约 ──────────────────────────────────────────
#
# 这一组跑在 `impl` 上（memory + postgres 各一遍）是本票的纪律要求：#100 改的是**授权**语义，
# 而两条腿此前是靠「pg 有唯一索引 / 内存有 1:1 字典」各自实现同一句承诺的。两边分头改就会造出
# 一片离线看不见的暗区 —— 离线套 4200+ 条判据几乎全跑在内存腿上，pg 腿独有的行为一条都照不到。


def test_a_context_carries_several_member_accounts(impl, tmp_path):
    """一份档案挂两个成员：两人各自 account_owns 为真、各自的公司列表都含它；第三个人一概够不着。

    这条同时是 0020 那个非唯一索引的行为面判据 —— 迁移前第二次 link 会被库拒（见
    `test_upgrade_path_from_the_single_owner_schema` 的第 3 步对照基准），迁移后必须真的收下。"""
    reg, cid, _ = _ingest(impl, tmp_path / "mem")
    alice = "user_" + uuid.uuid4().hex[:10]
    bob = "user_" + uuid.uuid4().hex[:10]
    carol = "user_" + uuid.uuid4().hex[:10]

    assert reg.link_account_context(alice, cid) is True                       # 创始成员
    assert reg.link_account_context(bob, cid, allow_shared=True) is True      # admin 加人

    fresh = impl.fresh()
    assert fresh.account_owns(alice, cid) is True
    assert fresh.account_owns(bob, cid) is True
    assert fresh.account_owns(carol, cid) is False, "没绑过的账号够着了这份档案"
    assert cid in fresh.contexts_for_account(alice)
    assert cid in fresh.contexts_for_account(bob)
    assert fresh.contexts_for_account(carol) == []
    # 花名册按最早绑上的在前 —— index 0 是创始成员，这是 accounts_for_context 唯一被承诺的顺序。
    assert fresh.accounts_for_context(cid) == [alice, bob]


def test_claim_still_refuses_a_context_owned_by_someone_else(impl, tmp_path):
    """`allow_shared` 是本票**唯一**的加人开关：默认拒绝（认领语义），显式传 True 才收。

    🔴 这条判据落在开关本身，不落在它的下游后果。产品决定（Danny 0814）：owner_token 是设备级
    凭据，不该当公司门票，所以 `/account/claim` 那条路必须继续拒 —— 0008 的唯一索引没了以后，
    这条拒绝的**唯一**执行者就是下面这个默认参数。"""
    reg, cid, _ = _ingest(impl, tmp_path / "mem")
    alice = "user_" + uuid.uuid4().hex[:10]
    intruder = "user_" + uuid.uuid4().hex[:10]
    assert reg.link_account_context(alice, cid) is True

    # 默认（= /account/claim 与上传路径走的那条）：别人的公司，拒。
    assert reg.link_account_context(intruder, cid) is False
    assert impl.fresh().account_owns(intruder, cid) is False, "被拒之后居然还是留下了成员行"
    assert impl.fresh().accounts_for_context(cid) == [alice]

    # 自己重绑自己：幂等，且不会在花名册里多出一行。
    assert reg.link_account_context(alice, cid) is True
    assert impl.fresh().accounts_for_context(cid) == [alice]

    # 显式 allow_shared（admin 脚本那条路）：同一个人、同一份档案，这次收。
    assert reg.link_account_context(intruder, cid, allow_shared=True) is True
    assert impl.fresh().account_owns(intruder, cid) is True


def test_an_anonymous_context_belongs_to_no_account(impl, tmp_path):
    """匿名档案：花名册为空，任何账号 account_owns 都为假。

    🔴 对照基准：先证明这份档案**真的存在**（`cid in reg`），否则「谁都够不着」在一个不存在的
       id 上恒真 —— 销毁类/否定类判据天生空真，必须配一个正向锚点。"""
    reg, cid, _ = _ingest(impl, tmp_path / "mem")
    assert cid in reg, "对照基准塌了：这份档案根本不在库里，下面的否定判据什么都证明不了"

    assert reg.accounts_for_context(cid) == []
    for who in ("user_nobody", "user_" + uuid.uuid4().hex[:10], ""):
        assert reg.account_owns(who, cid) is False
    # 空 user_id / 空 context_id 一律为假（授权问题上不许有「空即通过」的缝）。
    assert reg.account_owns(None, cid) is False
    assert reg.account_owns("user_x", "") is False


def test_empty_context_claims_an_ephemeral_clone(impl, tmp_path):
    """#88 · 清空＝这份档案从此归你：一次性克隆被亲手清空之后不再是一次性的。

    为什么这条非有不可（它补的是 #88 **自己造出来**的一条死胡同）：撤掉「新建一家公司」
    之后，领过示例团队的人没有别的路换成自己的资料——示例档案的上传口是封着的（补进去的
    会随 TTL 回收一起没），而「清空这份档案」是他唯一被指引去做的动作。`ephemeral` 若在
    清空后原样留着，他做完那个动作**什么也没解开**，而且 GC 迟早把他自己传的资料收走。

    🔴 对照基准不能省（销毁类判据天生空真）：先断言清空**之前**两份都真是 ephemeral，
       否则「清空后不是了」在一个本来就没打标的档案上恒真，这条测试会对着被删掉的产品
       代码继续全绿。同理留一份 `kept` 不清空——它同时钉住「别把别的克隆也一起认领了」。
    """
    reg, master, _ = _ingest(impl, tmp_path / "mem", owner_token="token-master")
    kept = _demo_clone(impl, master)        # 领了没动的那位访客
    claimed = _demo_clone(impl, master)     # 领完清空、换成自己资料的那位
    for c in (kept, claimed):               # 见 _backdate_clone：别赌墙上时钟
        _backdate_clone(impl, c, hours=1)

    assert impl.fresh().is_ephemeral(kept) is True
    assert impl.fresh().is_ephemeral(claimed) is True, "对照基准就不成立 —— 下面全是空真"

    assert impl.fresh().empty_context(claimed) is True

    assert impl.fresh().is_ephemeral(claimed) is False, \
        "清空之后它还是一次性克隆 —— 用户接管的档案会被 GC 收走"
    assert impl.fresh().is_ephemeral(kept) is True, "清空一份把别人的克隆也顺手认领了"

    # 🔴 判据落到**后果**上，不止那个 bool：ttl=0 该只收走没被清空的那一份。
    # 只断 is_ephemeral 的话，`sweep_ephemeral` 换一条选行口径（不读这一列）就照样全绿。
    assert impl.fresh().sweep_ephemeral(older_than_hours=0, limit=50) == 1
    fresh = impl.fresh()
    assert claimed in fresh, "用户亲手清空并接管的档案被 GC 收走了"
    assert kept not in fresh, "没被认领的克隆反倒活下来了 —— sweep 选错了行"


def test_empty_context_of_a_normal_archive_does_not_touch_the_ephemeral_flag(impl, tmp_path):
    """反向的一半：真人自己传出来的档案本来就不是 ephemeral，清空是一次无操作，
    绝不许因为「清空即认领」那一行反过来把它**标成** ephemeral（那就是把用户的正经档案
    送进 GC 的名单）。"""
    reg, cid, _ = _ingest(impl, tmp_path / "mem")
    assert impl.fresh().is_ephemeral(cid) is False

    assert impl.fresh().empty_context(cid) is True

    assert impl.fresh().is_ephemeral(cid) is False
    assert impl.fresh().sweep_ephemeral(older_than_hours=0, limit=50) == 0
    assert cid in impl.fresh(), "清空一份普通档案之后它被 GC 收走了"


def test_empty_context_of_an_unknown_id_is_false(impl):
    assert impl.fresh().empty_context("ctx_no_such_thing") is False
    assert "ctx_no_such_thing" not in impl.fresh(), "顺手把一个不存在的档案凭空造出来了"


def test_empty_context_leaves_an_archive_that_takes_new_files(impl, tmp_path):
    """清空 → 再往同一份档案里加文件。这就是「不要有新建」那句拍板的可执行形态。"""
    from avery.ingest.file_append import append_paths_to_context

    reg, cid, _ = _ingest(impl, tmp_path / "mem", source_documents=_sample_source_docs())
    assert impl.fresh().empty_context(cid) is True

    later = tmp_path / "later.md"
    later.write_text("# Later\n\n- Project: Night kitchen  Owner: Chen  Status: in progress\n",
                     encoding="utf-8")
    from avery.ingest.registry import SourceDocument
    sd = SourceDocument(filename="later.md", source_key="later.md", mime="text/markdown",
                        size_bytes=later.stat().st_size, content=later.read_bytes())
    assert append_paths_to_context(impl.fresh(), cid, [str(later)], [sd]).ok

    got = impl.fresh().get(cid)
    assert got.context_id == cid, "补料换了 id —— 单档案模型破了"
    assert [c["source_key"] for c in got.file_cards()] == ["later.md"]
    assert got.extraction.materials, "补进来的文件没切出块"
    assert impl.fresh().source_document_bytes(cid, 0) == later.read_bytes()


# ==============================================================================================
# feat-033 — the "Avery's notes" write-side contract (shared: memory + postgres). Agent-written
# observations accumulate, list new->old, and — the whole point — a person-scoring observation is
# REFUSED at append() before anything lands. The SAME red-line gate (`redline.validate`, EN+ZH) the
# advisor output passes governs the self-written note, so the new write path is not a back door
# around "no numbers on a person".
# ==============================================================================================

def test_notes_append_then_list_new_to_old(impl, tmp_path):
    reg, cid, _ = _ingest(impl, tmp_path / "mem")
    assert reg.list_notes(cid) == [], "a fresh context has no notes"
    n1 = reg.append_note(
        cid, "The onboarding backlog keeps landing on one squad — a load problem, not a person.",
        "the onboarding backlog")
    n2 = reg.append_note(
        cid, "Two handoffs bounced back this week; the coordination seam is where to look.",
        "the two bounced handoffs")
    got = reg.list_notes(cid)
    assert [n.text for n in got] == [n2.text, n1.text], "notes must list new->old (newest first)"
    assert got[0].source_excerpt == "the two bounced handoffs"
    assert all(n.id and n.created_at for n in got), "every note carries an id + created_at"
    assert got[0].id != got[1].id, "note ids are distinct"


@pytest.mark.parametrize("bad", [
    "She is a low performer — score her 2 out of 10 on delivery.",   # EN: two ALWAYS hits
    "综合来看，她这个季度的绩效评分是2分，明显偏低。",                    # ZH: 绩效评分 + 分数
])
def test_notes_redline_refuses_a_scoring_observation(impl, tmp_path, bad):
    """A self-written observation that scores/ranks a PERSON (EN or ZH) is refused at append_note —
    the same moat the advisor output crosses. Nothing lands; the notebook stays clean."""
    reg, cid, _ = _ingest(impl, tmp_path / "mem")
    with pytest.raises(ValueError, match="red line"):
        reg.append_note(cid, bad, "how is she doing this quarter")
    assert reg.list_notes(cid) == [], "a refused scoring observation must NOT land in the notebook"


def test_notes_redline_refuses_a_scoring_source_excerpt(impl, tmp_path):
    """The source excerpt is echoed onto the (user-visible) notes surface, so a person-score in the
    manager's OWN quoted question must not land there either — even with a clean observation. The
    notes surface never displays scoring text, regardless of origin."""
    reg, cid, _ = _ingest(impl, tmp_path / "mem")
    with pytest.raises(ValueError, match="red line"):
        reg.append_note(cid, "There is a real coordination gap worth a direct conversation.",
                        "why did I score her 2/10 last cycle")
    assert reg.list_notes(cid) == []


def test_notes_qualitative_observation_passes(impl, tmp_path):
    """The gate is not a blunt number-blocker: a qualitative, work-focused observation (the normal
    case) lands. Guards against the red-line write gate over-blocking legitimate notes."""
    reg, cid, _ = _ingest(impl, tmp_path / "mem")
    note = reg.append_note(
        cid, "Design and delivery keep colliding on the same week — worth a sequencing chat.",
        "the design/delivery overlap")
    assert reg.list_notes(cid)[0].text == note.text


# ==============================================================================================
# issue #49 — advise-run history (the room's persisted Q&A). SHARED contract: both registries
# honor the same append/list seam; the pg durability twin is under @needs_db below. No content
# gate here BY DESIGN (see AdviseRun docstring): the service hook only persists redline_passed
# manifests, and the question is the manager's own words echoed to the same manager.
# ==============================================================================================

_RUN_ADVICE = {
    "summary": "The onboarding backlog is a load problem, not a person problem.",
    "detected_signals": ["two handoffs bounced"], "diagnosis_hypotheses": [],
    "evidence": ["W33 weekly: the backlog landed on one squad twice"],
    "recommended_actions": ["rebalance the intake rotation"],
    "metrics_to_track": [], "conversation_script": "",
}


def test_advise_runs_append_then_list_new_to_old(impl, tmp_path):
    reg, cid, _ = _ingest(impl, tmp_path / "mem")
    assert reg.list_advise_runs(cid) == [], "a fresh context has no run history"
    r1 = reg.append_advise_run(cid, "How do I rebalance the onboarding backlog?",
                               title="onboarding", locale="en", advice=_RUN_ADVICE)
    r2 = reg.append_advise_run(cid, "谁的项目这周最需要我搭把手？", locale="zh",
                               answer="从文件看，二期市政配套对接卡在审批，最需要你出面。")
    got = reg.list_advise_runs(cid)
    assert [r.question for r in got] == [r2.question, r1.question], "runs must list new->old"
    assert got[0].answer and got[0].advice is None, "short-answer run: answer set, advice absent"
    assert got[1].advice == _RUN_ADVICE and got[1].answer == "", "advice run round-trips the payload"
    assert got[1].title == "onboarding" and got[1].locale == "en"
    assert all(r.id and r.created_at for r in got) and got[0].id != got[1].id


def test_advise_runs_list_caps_at_limit(impl, tmp_path):
    """The history drawer is a recency surface — the reader caps, oldest falls off the page."""
    reg, cid, _ = _ingest(impl, tmp_path / "mem")
    for i in range(5):
        reg.append_advise_run(cid, f"question {i}", answer=f"answer {i}")
    got = reg.list_advise_runs(cid, limit=3)
    assert [r.question for r in got] == ["question 4", "question 3", "question 2"]


# ---- issue #78 · 真线程：同一个 seam 上的「按场分组」读法（两腿共用一份契约）--------------

def test_advise_runs_round_trip_the_thread_id(impl, tmp_path):
    """thread_id 是 AdviseRun 的第八个字段，写进去什么读回来什么；不带就是空串。

    这条盯的是 pg 那边的**列序错位**：SELECT 列表与元组解包是手写对齐的，thread_id 插错位置
    是 text↔text 对调（question/title/locale/answer 互换），Postgres 一声不吭。
    所以判据落在「每个字段各自的值」上，不是「有八个字段」。
    """
    reg, cid, _ = _ingest(impl, tmp_path / "mem")
    r = reg.append_advise_run(cid, "带场的一问", title="标题", locale="zh",
                              answer="短答正文", thread_id="thr_abc123")
    assert r.thread_id == "thr_abc123"
    got = reg.list_advise_runs(cid)[0]
    assert (got.question, got.title, got.locale, got.answer, got.thread_id) == (
        "带场的一问", "标题", "zh", "短答正文", "thr_abc123"), "列序错位/字段串位"
    reg.append_advise_run(cid, "不带场的一问", answer="x")
    assert reg.list_advise_runs(cid)[0].thread_id == "", "不带 thread_id 读回来是空串，不是 None"


def test_advise_threads_group_by_thread_newest_activity_first(impl, tmp_path):
    """场按最近活动新->旧、场内按对话顺序（seq 升序）。

    两种假实现各钉一半：① 场内照抄平铺那条的 `ORDER BY seq DESC` → hydrate 出来的对话是倒着的；
    ② 场按**首轮**排 → 一个老场被追问之后仍沉在底下，而它恰恰是用户刚碰过的那一场。
    """
    reg, cid, _ = _ingest(impl, tmp_path / "mem")
    reg.append_advise_run(cid, "A1", answer="a1", thread_id="thr_a")
    reg.append_advise_run(cid, "B1", answer="b1", thread_id="thr_b")
    reg.append_advise_run(cid, "A2", answer="a2", thread_id="thr_a")

    threads = reg.list_advise_threads(cid)
    assert [t.thread_id for t in threads] == ["thr_a", "thr_b"], "A 被追问后要浮到最前"
    assert [r.question for r in threads[0].runs] == ["A1", "A2"], "场内是对话顺序，不是新->旧"
    assert [r.question for r in threads[1].runs] == ["B1"]


def test_advise_threads_limit_counts_threads_not_rows(impl, tmp_path):
    """🔴 limit 的单位是**场**不是行——而且返回的场必须是**整场**。

    沿用行数上限的实现会把最老那一场腰斩：调用方拿到半截对话却分辨不出「这场只有 2 轮」
    和「这场有 5 轮只给了 2 轮」，hydrate 出来就是一段没有开头的聊天记录。
    """
    reg, cid, _ = _ingest(impl, tmp_path / "mem")
    for i in range(5):
        reg.append_advise_run(cid, f"old{i}", answer="x", thread_id="thr_old")
    reg.append_advise_run(cid, "mid", answer="x", thread_id="thr_mid")
    for i in range(4):
        reg.append_advise_run(cid, f"new{i}", answer="x", thread_id="thr_new")

    got = reg.list_advise_threads(cid, limit=2)
    assert [t.thread_id for t in got] == ["thr_new", "thr_mid"], "limit=2 要的是最近两**场**"
    assert len(got[0].runs) == 4, "场必须整场回，不许被行数腰斩"
    # limit 放开之后最老那场也是整整五轮（不是被前面几场挤掉的残余）。
    full = reg.list_advise_threads(cid, limit=10)
    assert [len(t.runs) for t in full] == [4, 1, 5]


def test_advise_threads_treat_unthreaded_rows_as_standalone(impl, tmp_path):
    """存量行（thread_id 空 / 列侧 NULL）每条自成一场，绝不因为「共用空串这个键」被缝成一场。"""
    reg, cid, _ = _ingest(impl, tmp_path / "mem")
    reg.append_advise_run(cid, "老行一", answer="x")
    reg.append_advise_run(cid, "老行二", answer="x")
    reg.append_advise_run(cid, "新行", answer="x", thread_id="thr_new")

    threads = reg.list_advise_threads(cid)
    assert len(threads) == 3, f"两条老行 + 一条新行 = 三场，实得 {len(threads)}"
    assert [t.thread_id for t in threads] == ["thr_new", "", ""]
    assert [t.runs[0].question for t in threads] == ["新行", "老行二", "老行一"]
    assert all(len(t.runs) == 1 for t in threads)


def test_advise_threads_never_cross_contexts(impl, tmp_path):
    """两家公司用了同一个 thread_id：各读各的，一行都不串。"""
    reg, cid_a, _ = _ingest(impl, tmp_path / "a")
    reg, cid_b, _ = _ingest(impl, tmp_path / "b")
    reg.append_advise_run(cid_a, "A 的问题", answer="x", thread_id="thr_shared")
    reg.append_advise_run(cid_b, "B 的问题", answer="x", thread_id="thr_shared")

    a = reg.list_advise_threads(cid_a)
    b = reg.list_advise_threads(cid_b)
    assert len(a) == 1 and [r.question for r in a[0].runs] == ["A 的问题"]
    assert len(b) == 1 and [r.question for r in b[0].runs] == ["B 的问题"]


def test_memory_clear_drops_advise_runs():
    """issue #78 · `clear()` 此前漏了 `_advise_runs`（自 #49 起就漏）。没被咬到纯属运气：
    既有测试每次都用新铸的 context_id，残留够不着。补进来之后配这条门，免得下次又漏。

    只对内存腿有意义（pg 那边的清扫是另一件事：FK CASCADE + 测试的 track-and-delete），
    所以这条不进 `impl` 参数化 —— 它直接对着内存实现说话，也不需要真 ingest 一个 context
    （内存腿的 append 不校验 context 存在，pg 腿才有那道 FK）。"""
    reg = ContextRegistry()
    cid = _new_cid()
    reg.append_advise_run(cid, "问过的一句", answer="x", thread_id="thr_x")
    assert reg.list_advise_runs(cid), "自证：清之前确实有行"
    reg.clear()
    assert reg.list_advise_runs(cid) == [], "clear() 之后历史必须一起没"
    assert reg.list_advise_threads(cid) == []


# ==============================================================================================
# feat-033 POLICY PIVOT (2026-07-13) — the AVERY_ALLOW_PERSON_SCORING switch, tested BIDIRECTIONALLY
# at the storage door. The in-memory and Postgres registries share ONE gate (gate_note_red_line), so
# these prove BOTH honor the switch — the pg case (@needs_db) rules out a memory-only bypass. OFF (the
# shipped default) still blocks; ON persists the SAME observation; the detector stays untouched.
# ==============================================================================================

_SWITCH = "AVERY_ALLOW_PERSON_SCORING"
_SCORING_OBS = "She is a low performer — score her 2 out of 10 on delivery."


def test_notes_switch_off_still_blocks_a_scoring_observation(impl, tmp_path, monkeypatch):
    """Regression guard (fail-closed direction): with the switch UNSET the moat holds exactly as
    shipped — the scoring observation is refused and nothing lands."""
    monkeypatch.delenv(_SWITCH, raising=False)
    reg, cid, _ = _ingest(impl, tmp_path / "mem")
    with pytest.raises(ValueError, match="red line"):
        reg.append_note(cid, _SCORING_OBS, "how is she doing this quarter")
    assert reg.list_notes(cid) == [], "switch OFF must keep blocking a scoring observation"


def test_notes_switch_on_persists_a_scoring_observation(impl, tmp_path, monkeypatch):
    """Unblock direction: with the switch ON the SAME scoring observation — and a scoring excerpt —
    now lands and is user-visible. Runs against memory AND Postgres, so pg's append_note is proven to
    honor the switch through the shared gate (not a memory-only code path)."""
    monkeypatch.setenv(_SWITCH, "1")
    reg, cid, _ = _ingest(impl, tmp_path / "mem")
    note = reg.append_note(cid, _SCORING_OBS, "李雷:9分,排名第一")   # both fields would cross when OFF
    got = reg.list_notes(cid)
    assert len(got) == 1 and got[0].text == _SCORING_OBS, "switch ON must persist the scoring note"
    assert got[0].source_excerpt == "李雷:9分,排名第一", "a scoring excerpt persists too when unblocked"


def test_notes_switch_on_still_refuses_a_nul(impl, tmp_path, monkeypatch):
    """The switch unblocks the RED LINE only. A NUL (0x00) is a storage-safety guard (it crashes the
    Postgres text write), NOT a red-line policy, so it is STILL refused with scoring unblocked."""
    monkeypatch.setenv(_SWITCH, "1")
    reg, cid, _ = _ingest(impl, tmp_path / "mem")
    with pytest.raises(ValueError, match="control character|NUL"):
        reg.append_note(cid, "a note with a\x00hidden nul", "a real question")
    assert reg.list_notes(cid) == [], "a NUL note must never land, switch on or off"


# ==============================================================================================
# OFFLINE GUARD — runs with NO database. See the 2026-07-23 lesson: `not needs_db` makes the whole
# postgres layer invisible to the default suite, so a pg-only defect ships green and only surfaces
# on a deploy. The behavioral proof of this invariant is
# `test_manual_crud_does_not_destroy_the_uploaded_bytes` above (its postgres parametrization);
# this guard exists so the *offline* suite still fails when someone deletes the fix.
# ==============================================================================================

def test_pg_put_restores_bytes_that_get_deliberately_dropped():
    """files-hub-0729/01 · Structural pin on a two-method invariant that no single method owns.

    `PostgresContextRegistry.get()` intentionally returns `content=None` (not loading multi-MB
    uploads to read a roster). That is fine ONLY while `put()` compensates — otherwise the ordinary
    `get -> mutate -> put` of every manual CRUD call silently destroys the customer's originals.

    A source-level assertion is a poor substitute for behavior and is used here on purpose: the real
    thing needs a live database, and this suite must stay runnable without one. If this ever fights
    a legitimate refactor, the fix is to make the postgres behavioral test reachable — not to relax
    this into nothing."""
    import inspect
    from avery.ingest.pg_registry import PostgresContextRegistry

    get_src = inspect.getsource(PostgresContextRegistry.get)
    assert "content=None" in get_src.replace(" ", ""), (
        "get() no longer drops the bytea — re-check whether put()'s restore is still needed, and "
        "update this guard deliberately rather than deleting it")

    # arch-0802：restore 机制从 Python dict（prior_bytes）换成了纯 SQL（ON COMMIT DROP 临时表 +
    # UPDATE...FROM，字节不出库）。按本测试自己的规矩「更新守卫而不是删弱」——改钉新机制的
    # 三条不变量；行为面在真 PG 上由 test_manual_crud_does_not_destroy_the_uploaded_bytes（pg 腿）
    # 与 test_pg_manual_crud_roundtrip_erases_no_column_anywhere（全列守卫）双钉。
    put_src = inspect.getsource(PostgresContextRegistry.put)
    assert "_prior_src_bytes" in put_src, (
        "put() lost the prior-bytes restore: every manual CRUD write now NULLs avery.source_documents"
        ".content, permanently destroying uploaded originals and turning the file hub's Download into"
        " a button that always fails")
    assert "content IS NULL" in put_src, (
        "put() must only backfill rows whose NEW content is NULL — overwriting caller-supplied "
        "content would make a genuine re-ingest resurrect stale bytes")
    assert "NULLIF(source_key, '')" in put_src, (
        "the restore's join key must treat source_key='' as absent (COALESCE alone only skips NULL "
        "while INSERT never writes NULL there) — dropping NULLIF re-opens the exact bug the "
        "roundtrip guard caught on 2026-08-02: docs without a source_key lose their bytes")
    assert "_prior_mat_vecs" in put_src, (
        "put() lost the embedding restore: an embedder-less put over an embedded context now NULLs "
        "materials.embedding, silently degrading retrieval to keyword after any manual CRUD")


# ==============================================================================================
# DURABILITY CONTRACT — postgres only (@needs_db). A process dict cannot pass these; that gap is
# exactly what feat-030 closes.
# ==============================================================================================

@pytest.fixture()
def pg(tmp_path):
    impl = _pg_impl(tmp_path)
    yield impl
    _pg_cleanup(impl)


@needs_db
def test_pg_context_survives_a_new_registry_instance(pg, tmp_path):
    """A brand-new registry instance (new connections — the module-level restart) still resolves
    the context with byte-equal cards."""
    reg_a, cid, rep = _ingest(pg, tmp_path / "mem")
    reg_b = pg.fresh()
    assert cid in reg_b
    got = reg_b.get(cid)
    assert got is not None, "context vanished for a new registry instance — persistence is fake"
    assert got.team_cards() == rep.context.team_cards()
    assert got.project_cards() == rep.context.project_cards()
    assert got.source_files == rep.context.source_files


@needs_db
def test_pg_owner_token_survives_a_new_registry_instance(pg, tmp_path):
    """feat-038 the restart story for tenant isolation: the owner_token put by one registry instance
    is read back by a BRAND-NEW instance/connection (the redeploy). This is what lets a company still
    prove ownership after the service restarts — the credential lives in the DB, not process memory."""
    reg_a, cid, _ = _ingest(pg, tmp_path / "mem", owner_token="tok_survives_the_redeploy")
    reg_b = pg.fresh()
    assert reg_b.get(cid).owner_token == "tok_survives_the_redeploy", (
        "owner_token vanished across a new registry instance — isolation would reset to open on a "
        "redeploy")


@needs_db
def test_pg_source_documents_survive_a_new_registry_instance(pg, tmp_path):
    """feat-032 durability: the raw uploads (bytes + metadata) put by one registry instance are
    visible to a BRAND-NEW instance — metadata AND the bytea content — after a simulated restart."""
    src_docs = _sample_source_docs()
    reg_a, cid, _ = _ingest(pg, tmp_path / "mem", source_documents=src_docs)

    reg_b = pg.fresh()
    got = reg_b.get(cid)
    assert got is not None
    cards = got.file_cards()
    assert [c["filename"] for c in cards] == [HANDBOOK.name, ROSTER.name]
    # metadata read must NOT require pulling the bytea content (the manifest is metadata-only).
    assert all(sd.content is None for sd in got.source_documents), (
        "get() eagerly loaded bytea content — the manifest read should be metadata-only")
    # the bytes are still there, byte-for-byte, on a fresh instance (the restart claim).
    assert reg_b.source_document_bytes(cid, 0) == HANDBOOK.read_bytes()
    assert reg_b.source_document_bytes(cid, 1) == ROSTER.read_bytes()


@needs_db
def test_pg_advise_runs_survive_a_new_registry_instance(pg, tmp_path):
    """issue #49 the restart story for the room's history: runs appended by one registry instance
    are read back (new->old, payload intact) by a BRAND-NEW instance — the F5/redeploy claim that
    motivated the whole feature."""
    reg_a, cid, _ = _ingest(pg, tmp_path / "mem")
    reg_a.append_advise_run(cid, "How do I rebalance the onboarding backlog?",
                            title="onboarding", locale="en", advice=_RUN_ADVICE)
    reg_a.append_advise_run(cid, "谁的项目这周最需要我搭把手？", locale="zh",
                            answer="二期市政配套对接卡在审批，最需要你出面。")
    reg_b = pg.fresh()
    got = reg_b.list_advise_runs(cid)
    assert [r.question for r in got] == ["谁的项目这周最需要我搭把手？",
                                         "How do I rebalance the onboarding backlog?"], (
        "run history vanished/reordered across a new registry instance")
    assert got[1].advice == _RUN_ADVICE, "the stored advice payload must survive the restart intact"
    assert got[0].answer.startswith("二期"), "the short answer must survive the restart intact"


@needs_db
def test_pg_advise_threads_survive_a_new_registry_instance(pg, tmp_path):
    """issue #78 真线程的重启故事：一场对话（含它的顺序）跨新 registry 实例读回来还是一场。

    这条是**离线套看不到**的那一半：分组读法在 pg 侧是两趟 SQL（先定最近 N 场、再取整场）+
    `COALESCE(thread_id, 'run:' || id)` 的合成键，内存腿是 Python 字典分组 —— 两种完全不同的
    实现共用一份契约。0016 迁移本身也只有在这条腿上才真被执行过（_ensure_schema 全量重放）。
    """
    reg_a, cid, _ = _ingest(pg, tmp_path / "mem")
    reg_a.append_advise_run(cid, "A1 排班怎么排？", answer="a1", thread_id="thr_a")
    reg_a.append_advise_run(cid, "B1 谁需要搭把手？", answer="b1", thread_id="thr_b")
    reg_a.append_advise_run(cid, "A2 那先动哪一头？", answer="a2", thread_id="thr_a")
    reg_a.append_advise_run(cid, "没有场归属的一问", answer="legacy")   # thread_id 落成 NULL

    reg_b = pg.fresh()
    threads = reg_b.list_advise_threads(cid)
    assert [t.thread_id for t in threads] == ["", "thr_a", "thr_b"], (
        "最近活动新->旧：无场归属的那条最新、其次是被追问过的 A、最后是 B")
    assert [r.question for r in threads[1].runs] == ["A1 排班怎么排？", "A2 那先动哪一头？"], (
        "场内必须是对话顺序（seq 升序）——照抄平铺那条的 seq DESC 会让 hydrate 出来的对话倒着")
    assert len(threads[0].runs) == 1 and threads[0].runs[0].thread_id == "", (
        "NULL 列读回来是空串，且自成一场")
    # 0016 的列真在库上（而不是只在 dataclass 里）：平铺读法也带得回来。
    flat = {r.question: r.thread_id for r in reg_b.list_advise_runs(cid)}
    assert flat["A2 那先动哪一头？"] == "thr_a" and flat["没有场归属的一问"] == ""


@needs_db
def test_pg_notes_accumulate_and_survive_a_new_registry_instance(pg, tmp_path):
    """feat-033 the restart story for Avery's notes: observations appended by one registry instance
    are visible — in order, new->old — to a BRAND-NEW instance (the redeploy). This is what makes
    the notebook 'get thicker the longer you work together' across sessions, not just in-process."""
    reg_a, cid, _ = _ingest(pg, tmp_path / "mem")
    reg_a.append_note(cid, "First: the onboarding backlog concentrates on one squad.", "onboarding backlog")
    reg_a.append_note(cid, "Second: two handoffs bounced — a coordination seam to watch.", "bounced handoffs")

    reg_b = pg.fresh()   # a fresh instance / new connections — the simulated restart
    got = reg_b.list_notes(cid)
    assert [n.text for n in got] == [
        "Second: two handoffs bounced — a coordination seam to watch.",
        "First: the onboarding backlog concentrates on one squad.",
    ], "notes did not survive the restart in new->old order"
    # appending on the new instance keeps accumulating on top of the persisted history.
    reg_b.append_note(cid, "Third: sequencing design and delivery would ease the crunch.", "sequencing")
    assert reg_b.list_notes(cid)[0].text.startswith("Third"), "post-restart append did not accumulate"
    assert len(reg_b.list_notes(cid)) == 3


@needs_db
def test_pg_notes_refuse_a_scoring_observation_before_insert(pg, tmp_path):
    """feat-033: the Python storage gate on the notes write path runs the FULL red-line scan BEFORE
    any INSERT — a scoring self-written observation (EN or ZH) never touches the DB and never lands
    in the notebook. This is the moat feat-030's storage door promised the new write path inherits."""
    reg = pg.fresh()
    reg_seed, cid, _ = _ingest(pg, tmp_path / "mem")
    for bad in ("Give him a red rating and mark him a flight risk.",             # EN ALWAYS hits
                "把张伟的KPI评分压到60分，其余人往上提。"):                          # ZH KPI评分 + 分数
        with pytest.raises(ValueError, match="red line"):
            reg.append_note(cid, bad, "how is the team doing")
    assert reg.list_notes(cid) == [], "a scoring observation LANDED despite the append gate"


@needs_db
def test_pg_memory_dir_rematerializes_after_local_wipe(pg, tmp_path):
    """Wipe the materialized local files (what a redeploy/new machine does) -> get() rebuilds
    facts.md/notes.md from the DB byte-identically, and the loop's own recall works over the
    restored dir (the /advise seam after a restart)."""
    reg_a, cid, _ = _ingest(pg, tmp_path / "mem")
    mem_a = Path(reg_a.get(cid).memory_dir)
    facts_before = (mem_a / "facts.md").read_text(encoding="utf-8")
    notes_before = (mem_a / "notes.md").read_text(encoding="utf-8")
    assert facts_before.strip()

    shutil.rmtree(tmp_path / "data", ignore_errors=True)   # the local materialization cache
    shutil.rmtree(tmp_path / "mem", ignore_errors=True)    # the original ingest work_dir too
    reg_b = pg.fresh()
    mem_b = reg_b.resolve_memory_dir(cid)
    assert mem_b is not None and (Path(mem_b) / "facts.md").exists(), (
        "memory_dir did not re-materialize from the DB after a local wipe")
    assert (Path(mem_b) / "facts.md").read_text(encoding="utf-8") == facts_before
    assert (Path(mem_b) / "notes.md").read_text(encoding="utf-8") == notes_before

    from avery import memory
    hits = memory.recall("weekly written status update Friday", Path(mem_b))
    assert hits, "loop recall over the re-materialized memory_dir returned nothing"


@needs_db
def test_pg_schema_refuses_a_scoring_person_row(pg, tmp_path):
    """The red line is structural IN THE SCHEMA: a person payload with ANY key outside PersonEntity's
    own qualitative fields is refused by the DB itself (ALLOWLIST CHECK). feat-030 P1: this is an
    allowlist, not a denylist — so it catches Chinese scoring keys (绩效评分/排名/离职风险) and
    compound English keys (zscore/stack_rank/attrition_risk/nine_box) a wordlist would miss, by
    construction (the 'moat as a type' at the storage layer)."""
    import psycopg
    from psycopg.types.json import Jsonb

    reg, cid, _ = _ingest(pg, tmp_path / "mem")
    bad_payloads = [
        # the original denylist cases (must still be refused)
        {"name": "Mallory", "score": 88},
        {"name": "Mallory", "rank": 1},
        {"name": "Mallory", "tier": "B"},
        {"name": "Mallory", "moodPct": 40},
        {"name": "Mallory", "capacityPct": 90},
        # Chinese scoring keys — a denylist of English words misses these entirely
        {"name": "Mallory", "绩效评分": 88},
        {"name": "Mallory", "排名": 1},
        {"name": "Mallory", "离职风险": "high"},
        # compound English keys — substring/exact English denylists miss these
        {"name": "Mallory", "zscore": 1.4},
        {"name": "Mallory", "stack_rank": 3},
        {"name": "Mallory", "attrition_risk": 0.7},
        {"name": "Mallory", "nine_box": "1A"},
    ]
    with psycopg.connect(_db_url()) as conn:
        for bad in bad_payloads:
            with pytest.raises(psycopg.errors.CheckViolation):
                with conn.transaction():
                    conn.execute(
                        "INSERT INTO avery.entities (context_id, kind, idx, payload) "
                        "VALUES (%s, 'person', 9999, %s)", (cid, Jsonb(bad)))
    # a CLEAN person payload (only PersonEntity fields) must still be accepted.
    with psycopg.connect(_db_url()) as conn, conn.transaction():
        conn.execute(
            "INSERT INTO avery.entities (context_id, kind, idx, payload) "
            "VALUES (%s, 'person', 9998, %s)",
            (cid, Jsonb({"id": "u_ok", "name": "Ok Person", "role": "Engineer",
                         "team": "Eng", "tenure": "2 years", "owns": ["the flow"],
                         "collaboration": ["Design"], "source": "roster:2"})))
    # rich-align-0722/03+06 REGRESSION: pg_registry.put() writes asdict(PersonEntity), which ALWAYS
    # emits self_report/archived/provenance (even at defaults). The hand-built minimal dict above
    # never exercised that — so the stale 0002 allowlist rejected every REAL campaign-code person
    # write in prod while this DB test stayed green. Insert a FULL PersonEntity, self_report
    # populated (the 03 sanctioned slot), and REQUIRE acceptance (allowlist realigned in 0009).
    from dataclasses import asdict
    from avery.ingest.extract import PersonEntity, PersonSelfReport, SelfReportLoad
    rich = asdict(PersonEntity(
        id="u_full", name="Rich Person", role="Lead", team="Sales", tenure="3y",
        owns=["banquet ops"], collaboration=["Ops"], source="roster:3",
        self_report=PersonSelfReport(load=SelfReportLoad(value=70)),
        archived=False, provenance={"role": {"origin": "manual", "source": "手动编辑"}}))
    with psycopg.connect(_db_url()) as conn, conn.transaction():
        conn.execute(
            "INSERT INTO avery.entities (context_id, kind, idx, payload) "
            "VALUES (%s, 'person', 9997, %s)", (cid, Jsonb(rich)))


def test_person_keys_allowlist_covers_exactly_person_fields():
    """OFFLINE regression guard (no DB — runs in the standard `not needs_db` suite) for the class of
    bug that shipped in rich-align-0722. Two failure modes, both invisible offline (the in-memory
    registry never hits a real CHECK) and fatal in prod:
      (1) drift — pg_registry.put() writes asdict(PersonEntity), which ALWAYS emits every field, so a
          field added to PersonEntity without extending the allowlist REJECTS every person write;
      (2) replay-safety — _ensure_schema replays every migration and the ADD validates all rows WHEN
          IT FIRES, so a STALE allowlist ADD (a strict subset of the current fields) aborts the WHOLE
          bootstrap once any row carries a newer key (0002's pre-03 8-key ADD did exactly this after
          the demo's self_report rows existed).
    So EVERY ALTER-ADD of the allowlist — not just the last — must equal PersonEntity's fields. (Since
    gc-demo-clones-0724 the ADD is guarded to SKIP when the constraint is already present & correct —
    but it still fires on a fresh DB or an in-place edit, so the array must stay in sync regardless;
    the real-pg oid-stability check is test_pg_bootstrap_constraint_guard_skips_re_add.) A static parse
    of the migrations closes both gaps at commit time, no live DB required."""
    import dataclasses
    from avery.ingest.extract import PersonEntity
    person_fields = {f.name for f in dataclasses.fields(PersonEntity)}

    migrations = sorted((HERE / "db" / "migrations").glob("*.sql"))
    adds = []   # (migration, allowed set) for EVERY ALTER-ADD of the allowlist (all are re-validated)
    for path in migrations:
        sql = re.sub(r"--[^\n]*", "", path.read_text(encoding="utf-8"))   # strip comments (hold DDL prose)
        for m in re.finditer(
            r"ADD\s+CONSTRAINT\s+entities_person_keys_allowlist\b.*?payload\s*-\s*ARRAY\s*\[(.*?)\]",
            sql, re.S | re.I):
            adds.append((path.name, set(re.findall(r"'([^']+)'", m.group(1)))))
    assert adds, "no migration ADDs entities_person_keys_allowlist"

    bad = {name: sorted(s ^ person_fields) for name, s in adds if s != person_fields}
    assert not bad, (
        "A person-keys allowlist ADD is out of sync with PersonEntity. pg_registry writes "
        "asdict(PersonEntity) and _ensure_schema re-validates every ADD on each bootstrap, so a "
        "mismatch either rejects person writes or aborts bootstrap.\n"
        f"  PersonEntity fields: {sorted(person_fields)}\n"
        f"  out-of-sync ADDs (migration -> symmetric diff vs PersonEntity): {bad}\n"
        "Edit 0009's allowlist IN PLACE to match PersonEntity (never add a superseding migration).")


def test_entities_kind_check_covers_written_kinds():
    """OFFLINE regression guard (no DB) — sibling to the person-keys guard, same two failure modes
    (drift + replay-safety). entities_kind_check must allow EXACTLY the entity kinds pg_registry.put()
    writes (_ENTITY_KINDS); 08 added the "playbook" kind to the writer but not the CHECK, so real
    Postgres rejected the demo cast. Every ALTER-ADD of the CHECK validates rows WHEN IT FIRES (since
    gc-demo-clones-0724 it is guarded to skip when unchanged, but still fires on a fresh DB / in-place
    edit), so all must equal _ENTITY_KINDS. (0001's inline CREATE-TABLE CHECK is exempt — CREATE TABLE
    IF NOT EXISTS is a no-op on replay and never re-validates — so this inspects only `ADD CONSTRAINT`.)"""
    from avery.ingest.pg_registry import _ENTITY_KINDS
    kinds = set(_ENTITY_KINDS)

    migrations = sorted((HERE / "db" / "migrations").glob("*.sql"))
    adds = []   # (migration, allowed set) for every ALTER-ADD of entities_kind_check
    for path in migrations:
        sql = re.sub(r"--[^\n]*", "", path.read_text(encoding="utf-8"))
        for m in re.finditer(
            r"ADD\s+CONSTRAINT\s+entities_kind_check\b.*?ARRAY\s*\[([^\]]*)\]", sql, re.S | re.I):
            adds.append((path.name, set(re.findall(r"'([^']+)'", m.group(1)))))
    assert adds, "no migration ADDs entities_kind_check"

    bad = {name: sorted(s ^ kinds) for name, s in adds if s != kinds}
    assert not bad, (
        "An entities_kind_check ADD is out of sync with the kinds pg_registry.put() writes "
        "(_ENTITY_KINDS); _ensure_schema re-validates every ADD on each bootstrap.\n"
        f"  _ENTITY_KINDS: {sorted(kinds)}\n"
        f"  out-of-sync ADDs (migration -> symmetric diff): {bad}\n"
        "Edit the kind-check migration IN PLACE to match _ENTITY_KINDS.")


def test_entity_pg_roundtrip_coerces_nested_dataclasses():
    """OFFLINE regression guard (no DB) for the pg persistence round-trip. pg_registry stores
    asdict(entity) as JSONB and rebuilds via Entity(**payload) (_entity). Every nested-dataclass
    field — ProjectEntity.risk/milestones, PersonEntity.self_report — MUST coerce back to its type in
    __post_init__; otherwise consumers hit `dict.attr` (e.g. project.risk.level) on the PERSISTED read
    path, which the in-memory offline suite never exercises. rich-align/01/02 shipped exactly this:
    the demo claim 500'd on `'dict' object has no attribute 'level'`. Simulate the round-trip with
    asdict -> dict -> reconstruct and assert the nested fields come back typed, not as dicts."""
    from dataclasses import asdict
    from avery.ingest.extract import (
        PersonEntity, PersonSelfReport, SelfReportLoad, ProjectEntity, ProjectRisk, ProjectMilestone)

    proj = ProjectEntity(id="p1", title="Banquet", risk=ProjectRisk(level="high", reason="rain"),
                         milestones=[ProjectMilestone(name="tasting", status="done")])
    proj2 = ProjectEntity(**asdict(proj))    # the exact pg read: _entity(ProjectEntity, .., payload)
    assert isinstance(proj2.risk, ProjectRisk) and proj2.risk.level == "high"
    assert proj2.milestones and all(isinstance(m, ProjectMilestone) for m in proj2.milestones)
    assert proj2.milestones[0].status == "done"

    person = PersonEntity(id="u1", name="Z",
                          self_report=PersonSelfReport(load=SelfReportLoad(value=70)))
    person2 = PersonEntity(**asdict(person))
    assert isinstance(person2.self_report, PersonSelfReport)
    assert isinstance(person2.self_report.load, SelfReportLoad) and person2.self_report.load.value == 70


@needs_db
def test_pg_put_refuses_free_text_scoring(pg, tmp_path):
    """feat-030 P1: the Python storage gate is LOAD-BEARING and does the FULL red-line scan (value +
    free text), not just a key check — so a person whose qualitative fields SMUGGLE a score
    ('ranked 2/10', 'bottom quartile performer') is refused by put() before any INSERT. This is the
    gate feat-033 (Avery's self-written notes) will rely on when it adds a new write path."""
    from avery.ingest.extract import PersonEntity, MaterialChunk, ExtractionResult
    from avery.ingest.registry import CompanyContext, materialize_memory
    from avery.ingest.store import KeywordStore

    reg = pg.fresh()
    for owns, collab in (["ranked 2/10 on delivery"], []), ([], ["bottom quartile performer"]):
        cid = _new_cid()   # NOT tracked: the whole point is nothing lands
        person = PersonEntity(id="u_mal", name="Mallory", role="Engineer",
                              owns=owns, collaboration=collab)
        extraction = ExtractionResult(
            people=[person], materials=[MaterialChunk(id="m1", text="hello", source="x:1")])
        mem = materialize_memory(extraction, tmp_path / "leak" / cid)
        ctx = CompanyContext(context_id=cid, extraction=extraction, store=KeywordStore(),
                             memory_dir=mem, name="leaky", source_files=["x"])
        with pytest.raises(ValueError, match="red line"):
            reg.put(ctx)
        assert cid not in reg, "a scoring person's context LANDED despite the put() gate"


@needs_db
def test_pg_get_refreshes_stale_memory_dir(pg, tmp_path):
    """feat-030 P2: the DB is the source of truth for the (pure) materialized memory. If a reader
    host has a STALE local facts.md (older than a re-put over the same id), get() must overwrite it
    to match the DB — never serve the stale copy to the loop's recall/cite (split-brain)."""
    reg, cid, _ = _ingest(pg, tmp_path / "mem")
    mem = Path(reg.resolve_memory_dir(cid))
    truth = (mem / "facts.md").read_text(encoding="utf-8")
    assert truth.strip()

    # simulate a stale reader host: local file diverges from the DB truth.
    (mem / "facts.md").write_text("STALE — from an older ingest", encoding="utf-8")

    mem2 = Path(pg.fresh().resolve_memory_dir(cid))
    assert (mem2 / "facts.md").read_text(encoding="utf-8") == truth, (
        "get() served a STALE local facts.md instead of refreshing from the DB truth")


@needs_db
def test_pg_put_rejects_nul_bytes_cleanly(pg, tmp_path):
    """feat-030 P3: a NUL (0x00) that slipped past parse must fail put() with a clean ValueError
    (which /ingest maps to 422), NOT a raw psycopg DataError surfacing as an opaque HTTP 500."""
    from avery.ingest.extract import PersonEntity, MaterialChunk, ExtractionResult
    from avery.ingest.registry import CompanyContext, materialize_memory
    from avery.ingest.store import KeywordStore

    reg = pg.fresh()
    cid = _new_cid()   # not tracked — must not land
    extraction = ExtractionResult(
        people=[PersonEntity(id="u_a", name="Ann", role="Engineer")],
        materials=[MaterialChunk(id="m1", text="contains a \x00 null byte", source="x:1")])
    mem = materialize_memory(extraction, tmp_path / "nulbytes" / cid)
    ctx = CompanyContext(context_id=cid, extraction=extraction, store=KeywordStore(),
                         memory_dir=mem, name="nulcase", source_files=["x"])
    with pytest.raises(ValueError, match="control character"):
        reg.put(ctx)
    assert cid not in reg


@needs_db
def test_pg_schema_reserves_the_next_seams(pg, tmp_path):
    """feat-031 (embedding vector column, nullable, unfilled here) and feat-038 (owner_token, the
    tenant-isolation credential) are pinned in the schema so those features land on it."""
    import psycopg

    reg, cid, _ = _ingest(pg, tmp_path / "mem")   # also forces schema bootstrap on a blank DB
    with psycopg.connect(_db_url()) as conn:
        cols = {(r[0], r[1], r[2]) for r in conn.execute(
            "SELECT table_name, column_name, udt_name FROM information_schema.columns "
            "WHERE table_schema = 'avery'").fetchall()}
        emb_filled = conn.execute(
            "SELECT count(*) FROM avery.materials WHERE context_id = %s "
            "AND embedding IS NOT NULL", (cid,)).fetchone()[0]
    assert ("contexts", "owner_token", "text") in cols, "feat-038 seam missing: contexts.owner_token"
    assert ("materials", "embedding", "vector") in cols, "feat-031 seam missing: materials.embedding"
    assert emb_filled == 0, "feat-030 must NOT fill embeddings (that is feat-031's job)"


# ==============================================================================================
# CLONE CONTRACT — input-side-0721 · 3A 一键示例团队的底座（memory + postgres 同一张合约）
# ==============================================================================================
# 为什么是克隆：demo 母本是共享的，而 /advise 落笔记、/ask 落行——发同一个 owner_token 给所有
# 访客等于让他们互相写脏。clone_context 把母本整体复制成一个新 id + 新 token 的私有副本。
# pg 侧必须是 SQL 级 INSERT..SELECT：get()+put() 重组会 ① 重新烧一遍 embedding（纯花钱）、
# ② 丢 source_documents 的 bytea（get() 刻意不拉字节），两条都是这张合约要钉死的行为。


def test_clone_makes_a_readable_twin_with_its_own_credentials(impl, tmp_path):
    reg, cid, _ = _ingest(impl, tmp_path / "mem", source_documents=_sample_source_docs(),
                          owner_token="token-master")
    new_cid = impl.track(_new_cid())
    ok = reg.clone_context(cid, new_context_id=new_cid, new_owner_token="token-clone")
    assert ok is True, "母本存在时克隆必须成功"
    twin = reg.get(new_cid)
    assert twin is not None, "克隆出来的副本读不回来"
    assert twin.owner_token == "token-clone", "副本必须持有自己的 owner_token"
    master = reg.get(cid)
    assert master.owner_token == "token-master", "克隆不许动母本的凭据"
    assert [p.name for p in twin.extraction.people] == [p.name for p in master.extraction.people]
    assert [m.text for m in twin.extraction.materials] == [m.text for m in master.extraction.materials]
    assert twin.source_files == master.source_files


def test_clone_copies_source_document_bytes(impl, tmp_path):
    """file space 不缩水：副本的「你的文件」必须能下载到和母本一字不差的原始字节。
    （pg 陷阱：get() 刻意不拉 bytea——克隆若走 get()+put() 重组，这里就会拿到 None。）"""
    reg, cid, _ = _ingest(impl, tmp_path / "mem", source_documents=_sample_source_docs(),
                          owner_token="token-master")
    new_cid = impl.track(_new_cid())
    assert reg.clone_context(cid, new_context_id=new_cid, new_owner_token="token-clone")
    for idx in (0, 1):
        want = reg.source_document_bytes(cid, idx)
        got = reg.source_document_bytes(new_cid, idx)
        assert want, "合约前提：母本自己有字节"
        assert got == want, f"副本第 {idx} 份文件的字节丢了或变了"


def test_clone_copies_notes_then_isolates_them(impl, tmp_path):
    """预铸母本的「实时数据缺位」笔记要跟着副本走；克隆之后两边各写各的，互不可见。"""
    reg, cid, _ = _ingest(impl, tmp_path / "mem", owner_token="token-master")
    reg.append_note(cid, "示例工作区：实时数据还没接入。", "初始设置")
    new_cid = impl.track(_new_cid())
    assert reg.clone_context(cid, new_context_id=new_cid, new_owner_token="token-clone")
    twin_notes = reg.list_notes(new_cid)
    assert len(twin_notes) == 1 and "实时数据" in twin_notes[0].text, "预铸笔记没跟上副本"
    assert twin_notes[0].id != reg.list_notes(cid)[0].id, "副本笔记必须换新 id（company_notes.id 全局唯一）"
    reg.append_note(new_cid, "副本自己的新观察。", "")
    assert len(reg.list_notes(cid)) == 1, "副本的写入渗进了母本（克隆隔离失守）"
    reg.append_note(cid, "母本这边的新观察。", "")
    assert len(reg.list_notes(new_cid)) == 2, "母本的后续写入不该再影响已克隆的副本"


def test_clone_of_a_missing_context_is_a_clean_no(impl, tmp_path):
    reg = impl.fresh()
    assert reg.clone_context("ctx_never_existed", new_context_id=impl.track(_new_cid()),
                             new_owner_token="t") is False


# ==============================================================================================
# gc-demo-clones-0724 · 访客克隆的 TTL 回收（sweep_ephemeral）
# 每次 /demo/claim 把母本整体克隆成访客私有副本（三亚 seed = 16 人 + 12 项目 + 5 方法卡 + 212 材料/份），
# 永不回收就是 avery.contexts/entities/materials 无界增长，早晚拖慢 _ensure_schema 的 ADD CONSTRAINT。
# 克隆打 ephemeral 标（母本走 put() 不带标）；sweep 只删「够旧 + 未登账号」的 ephemeral 克隆——母本
# （ctx_demo_*）和 account_contexts 里的克隆一律豁免。两个 registry 走同一份合约。


def _demo_clone(impl, master_cid: str, *, ephemeral: bool = True) -> str:
    """A guest twin off a demo master (like /demo/claim), tracked for post-test DB cleanup."""
    reg = impl.fresh()
    new = impl.track(_new_cid())
    assert reg.clone_context(master_cid, new_context_id=new, new_owner_token="tok-" + new,
                             ephemeral=ephemeral)
    return new


def _backdate_clone(impl, cid: str, *, hours: float) -> None:
    """把一条 ephemeral 克隆的「创建时刻」往前拨 —— 两个实现各拨各的那份真相
    （pg 是 `avery.contexts.created_at`，内存是 `_ephemeral_at`）。

    🔴 为什么这些 sweep 测试非拨不可（2026-08-06 实测，别把它当装饰删掉）：
    `older_than_hours=0` 判的是 `created_at < now()`，于是「刚建好的行已经比现在旧」成了隐含前提。
    这个前提**依赖墙上时钟单调**，而本机 Docker 容器的时钟会**来回跳 ~115 秒**：跑一轮 needs_db
    的三分钟里，恰好在「跳到未来」窗口内建的那条克隆会拿到未来的 `created_at`，于是
    `created_at < now()` 恒假、它对 sweep 隐身 ~115 秒，`test_sweep_respects_the_batch_limit`
    就在 `sweep(limit=50) == 1` 上红成 `0 == 1`。产品代码没问题，是这条测试借了一个它根本不需要的
    前提。往前拨一小时之后，±115 秒的跳动再也影响不到判据 —— 测的还是同一件事（批量上限），
    只是不再赌时钟。"""
    reg = impl.fresh()
    if impl.name == "postgres":
        with reg._connect() as conn:
            conn.execute(
                "UPDATE avery.contexts SET created_at = now() - make_interval(secs => %s) "
                "WHERE context_id = %s", (float(hours) * 3600.0, cid))
        return
    from datetime import datetime, timedelta, timezone
    reg._ephemeral_at[cid] = datetime.now(timezone.utc) - timedelta(hours=hours)


def test_sweep_collects_only_old_unlinked_ephemeral_clones(impl, tmp_path):
    reg, master, _ = _ingest(impl, tmp_path / "mem", owner_token="token-master")
    guest = _demo_clone(impl, master)             # an anonymous demo guest clone
    linked = _demo_clone(impl, master)            # a guest who then signs in
    for c in (guest, linked):                     # 见 _backdate_clone：别赌墙上时钟
        _backdate_clone(impl, c, hours=1)
    assert reg.link_account_context("user_signed_in", linked)

    # a generous TTL collects nothing — none of these clones is old enough yet.
    assert reg.sweep_ephemeral(older_than_hours=99999, limit=50) == 0
    assert master in reg and guest in reg and linked in reg

    # ttl=0 = "collect every eligible ephemeral clone now": only the unlinked guest goes.
    assert reg.sweep_ephemeral(older_than_hours=0, limit=50) == 1
    assert guest not in reg, "过期访客克隆没被回收"
    assert master in reg, "母本（非 ephemeral）被误删"
    assert linked in reg, "已登账号的克隆被误删（link 应清 ephemeral 标 + sweep 有 account 守卫）"


def test_sweep_keeps_a_clone_that_has_several_members(impl, tmp_path):
    """#100 · GC 的账号守卫在多行世界里照样成立：挂了**两个**成员的克隆一样不被回收。

    为什么这条非有不可：pg 侧的守卫是 `NOT EXISTS (SELECT 1 FROM account_contexts WHERE ...)`，
    多行照样成立 —— 但这是**读代码论证**，而 0020 恰恰改了这张表能有几行。真正会坏的是内存腿：
    它此前写的是 `cid not in self._context_owner`（一个 1:1 字典），本票把那本账换成了
    `dict[str, list[str]]`，判空方式必须跟着从「有没有这个键」改成「这个键下面有没有人」，
    否则一条被拒绝的 link 留下的空列表就会让一份**无人认领**的克隆永久免疫 GC。

    🔴 对照基准（销毁类判据天生空真）：同一次 sweep 里必须有一个**没绑人**的克隆真的被收走。
       少了它，「两成员的克隆还在」在一个压根没删任何东西的 sweep 上恒真。"""
    reg, master, _ = _ingest(impl, tmp_path / "mem", owner_token="token-master")
    shared = _demo_clone(impl, master)      # 两个成员的公司
    orphan = _demo_clone(impl, master)      # 对照基准：谁都没绑
    for c in (shared, orphan):
        _backdate_clone(impl, c, hours=1)

    alice = "user_" + uuid.uuid4().hex[:10]
    bob = "user_" + uuid.uuid4().hex[:10]
    assert reg.link_account_context(alice, shared) is True
    assert reg.link_account_context(bob, shared, allow_shared=True) is True
    assert sorted(reg.accounts_for_context(shared)) == sorted([alice, bob])

    assert reg.sweep_ephemeral(older_than_hours=0, limit=50) == 1, (
        "对照基准塌了：这一次 sweep 该且只该收走那个没绑人的克隆")
    assert orphan not in reg, "没绑任何账号的过期克隆没被回收 —— GC 被这张票放松了"
    assert shared in reg, "挂着两个成员的公司被 GC 收走了 —— 多行世界里账号守卫失效"
    assert sorted(reg.accounts_for_context(shared)) == sorted([alice, bob])


def test_sweep_respects_the_batch_limit(impl, tmp_path):
    """A bounded sweep deletes at most `limit`, leaving the rest for the next claim's sweep — so an
    opportunistic claim-time GC is a small, cheap delete, never an unbounded one on the hot path."""
    reg, master, _ = _ingest(impl, tmp_path / "mem", owner_token="token-master")
    clones = [_demo_clone(impl, master) for _ in range(3)]
    for c in clones:                              # 见 _backdate_clone：别赌墙上时钟
        _backdate_clone(impl, c, hours=1)
    assert reg.sweep_ephemeral(older_than_hours=0, limit=2) == 2
    assert len([c for c in clones if c in reg]) == 1, "batch 上限没生效（应留 1 份给下次 claim 扫）"
    assert reg.sweep_ephemeral(older_than_hours=0, limit=50) == 1
    assert all(c not in reg for c in clones)


def test_a_bounded_sweep_collects_the_oldest_first(impl, tmp_path):
    """有上限就意味着「这一批收哪几个」是个**选择**，两个实现必须做同一个选择：**最旧的先收**。

    内存孪生一直是这个语义（`sorted(self._ephemeral_at...)`）；pg 侧此前是无序 `LIMIT`，删哪几条
    由规划器自由决定 —— 同一条被合约套双跑的缝，两边可以给出不同答案。这条把语义钉死。

    ⚠ 判据是**故意反着造**的：三个克隆按「最新 → 最旧」的顺序插入，所以物理/插入顺序与年龄顺序
    正好相反。无序 `LIMIT 1` 走顺序扫描会拿到物理上第一条（最年轻的那个），只有真的按
    `created_at` 排序才会拿到最旧的。顺着造就会「碰巧全绿」，量不出东西。"""
    reg, master, _ = _ingest(impl, tmp_path / "mem", owner_token="token-master")
    young = _demo_clone(impl, master)
    mid = _demo_clone(impl, master)
    old = _demo_clone(impl, master)
    _backdate_clone(impl, young, hours=1)
    _backdate_clone(impl, mid, hours=5)
    _backdate_clone(impl, old, hours=10)

    assert reg.sweep_ephemeral(older_than_hours=0, limit=1) == 1
    assert old not in reg, "有上限的 sweep 没有先收最旧的那一个"
    assert mid in reg and young in reg, "只该收走一个"

    assert reg.sweep_ephemeral(older_than_hours=0, limit=1) == 1
    assert mid not in reg, "第二轮该收次旧的"
    assert young in reg, "最年轻的应该留到最后"


def test_a_non_ephemeral_clone_is_never_swept(impl, tmp_path):
    """clone_context(ephemeral=False) — a real (non-demo) copy — is exempt from GC even when old."""
    reg, master, _ = _ingest(impl, tmp_path / "mem", owner_token="token-master")
    keep = _demo_clone(impl, master, ephemeral=False)
    assert reg.sweep_ephemeral(older_than_hours=0, limit=50) == 0
    assert keep in reg


@needs_db
def test_pg_ephemeral_flag_round_trips(pg, tmp_path):
    """The clone's ephemeral flag actually lands in avery.contexts (GC keys on it): a default clone is
    ephemeral=true, an ephemeral=False clone is false, and a master (put()) is false."""
    reg, master, _ = _ingest(pg, tmp_path / "mem", owner_token="tm")
    guest = _demo_clone(pg, master)
    plain = _demo_clone(pg, master, ephemeral=False)

    def _eph(cid: str):
        with reg._connect() as conn:
            return conn.execute("SELECT ephemeral FROM avery.contexts WHERE context_id = %s",
                                (cid,)).fetchone()[0]
    assert _eph(master) is False, "母本不该是 ephemeral"
    assert _eph(guest) is True, "默认克隆应是 ephemeral（可回收）"
    assert _eph(plain) is False, "ephemeral=False 克隆不该被标记"


@needs_db
def test_pg_sweep_honors_created_at_ttl(pg, tmp_path):
    """The REAL age gate over the created_at column (the shared ttl=0 test can't exercise it): a clone
    backdated past the 48h TTL is swept; a fresh one within the TTL survives."""
    reg, master, _ = _ingest(pg, tmp_path / "mem", owner_token="tm")
    old = _demo_clone(pg, master)
    fresh = _demo_clone(pg, master)
    with reg._connect() as conn:
        conn.execute("UPDATE avery.contexts SET created_at = now() - interval '72 hours' "
                     "WHERE context_id = %s", (old,))
    assert reg.sweep_ephemeral(older_than_hours=48, limit=50) == 1
    assert old not in reg, "超过 48h TTL 的克隆没被回收"
    assert fresh in reg, "48h 内的新克隆被误删"


@needs_db
def test_pg_link_clears_ephemeral_flag(pg, tmp_path):
    """A guest who signs in and links their demo clone: the ephemeral flag flips false, so a later
    sweep (even ttl=0) never touches it — belt-and-suspenders with the sweep's account guard."""
    reg, master, _ = _ingest(pg, tmp_path / "mem", owner_token="tm")
    clone = _demo_clone(pg, master)
    assert reg.link_account_context("user_a", clone)
    with reg._connect() as conn:
        flag = conn.execute("SELECT ephemeral FROM avery.contexts WHERE context_id = %s",
                            (clone,)).fetchone()[0]
    assert flag is False, "link 之后 ephemeral 标没清"
    assert reg.sweep_ephemeral(older_than_hours=0, limit=50) == 0
    assert clone in reg


@contextlib.contextmanager
def _throwaway_db():
    """一次性库：CREATE DATABASE → yield 它的 url → DROP DATABASE。

    为什么升级路径不能跑在共享的那个本机库上：这条测试要**造回旧世界的唯一索引**，而共享库同一轮
    里还有几十条 needs_db 判据在用同一张 `avery.account_contexts`。中途任何一处 assert 挂掉，那条
    唯一索引就留在原地，后面每一条绑第二个成员的判据全部连坐变红 —— 一条测试有能力污染整轮，
    它报的红就不再是自己的证据。一次性库把这个可能性从结构上去掉（#93「在一次性库上真跑」的原话）。"""
    import psycopg
    from urllib.parse import urlsplit, urlunsplit

    base = _db_url()
    name = "avery_upgrade_" + uuid.uuid4().hex[:12]
    with psycopg.connect(base, autocommit=True) as admin:
        admin.execute(f'CREATE DATABASE "{name}"')
    parts = urlsplit(base)
    try:
        yield urlunsplit((parts.scheme, parts.netloc, "/" + name, parts.query, parts.fragment))
    finally:
        with psycopg.connect(base, autocommit=True) as admin:
            admin.execute(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')


def _context_index_state(url: str) -> list[tuple[str, bool]]:
    """`avery.account_contexts` 上以 context_id 打头的索引：[(名字, 是否唯一)]，直接读 catalog。"""
    import psycopg
    with psycopg.connect(url) as conn:
        return [(r[0], r[1]) for r in conn.execute("""
            SELECT i.relname, x.indisunique
              FROM pg_class i
              JOIN pg_index x ON x.indexrelid = i.oid
              JOIN pg_namespace n ON n.oid = i.relnamespace
             WHERE n.nspname = 'avery' AND i.relname = 'account_contexts_context_key'
        """).fetchall()]


@needs_db
def test_upgrade_path_from_the_single_owner_schema(tmp_path):
    """#100 · 0020 的升级路径，七步在**一次性真库**上真跑（#93 纪律，常驻门）。

    这条门守的是「一份已经在生产上跑了几个月的旧库，装上新代码之后会发生什么」—— 而那是读代码
    永远证不出来的东西。七步逐条对应票面：

      1. 在跑的库（一次性库，新代码 bootstrap 一遍）
      2. 造回旧世界：唯一索引 + 一条存量单主人行
      3. 🔴 对照基准：**此状态下插第二人真被库拒**（落在存储层，不是读代码论证）
      4. 新代码 `_ensure_schema` 接管
      5. 复查索引已换（同名、不再唯一）
      6. 升级后的库上真绑第二人
      7. 全新实例回读两人都在

    ⚠ 第 3 步必须走 `psycopg.connect` **裸连**，一个 registry 方法都不许碰：registry 上每个公开
      方法都先调 `_ensure_schema()`，拿它去验对照组＝让自愈式迁移当场把自己的对照组治好，
      「旧世界 vs 新世界」变成「新世界 vs 新世界」，这条门会永远绿着而什么也没验。

    ⚠ 第 8 步（票面之外，2026-08-14 实收的真 bug 补的）：再重放两轮，钉死索引不会**变回唯一**。
      0008 那句 `CREATE UNIQUE INDEX IF NOT EXISTS account_contexts_context_key` 每次开机都会跑，
      排在 0020 前面；替换索引一旦改名，0008 就会把 UNIQUE 重建回来，而库里已有多成员数据时那句
      直接 UniqueViolation、**整个 bootstrap 炸掉**。第一版 0020 就是这么写的，八条 needs_db 判据
      连带炸掉才逮到。这一步是那条 bug 的常驻守卫。"""
    import psycopg
    from avery.ingest.pg_registry import PostgresContextRegistry

    with _throwaway_db() as url:
        impl = _Impl("postgres", lambda: PostgresContextRegistry(url, data_dir=tmp_path / "data"))

        # ── 1 · 在跑的库：真走一遍 ingest，拿到一份有内容的档案 ──────────────────────────
        _reg, cid, _ = _ingest(impl, tmp_path / "mem")
        alice, bob = "user_alice_100", "user_bob_100"

        # ── 2 · 造回旧世界：0008 的唯一索引 + 一条存量单主人行 ──────────────────────────
        with psycopg.connect(url, autocommit=True) as raw:
            raw.execute("DROP INDEX IF EXISTS avery.account_contexts_context_key")
            raw.execute("CREATE UNIQUE INDEX account_contexts_context_key "
                        "ON avery.account_contexts (context_id)")
            raw.execute("INSERT INTO avery.account_contexts (user_id, context_id) VALUES (%s, %s)",
                        (alice, cid))
        assert _context_index_state(url) == [("account_contexts_context_key", True)], (
            "旧世界没造起来：下面那条对照基准会对着一个已经升级过的库跑，证明不了任何事")

        # ── 3 · 🔴 对照基准：旧世界里插第二人**真被库拒**（裸连，绝不碰 _ensure_schema）──
        with psycopg.connect(url, autocommit=True) as raw:
            with pytest.raises(psycopg.errors.UniqueViolation):
                raw.execute(
                    "INSERT INTO avery.account_contexts (user_id, context_id) VALUES (%s, %s)",
                    (bob, cid))

        # ── 4 · 新代码接管（全新实例：_schema_ready 为 False 才会真重放）────────────────
        upgraded = PostgresContextRegistry(url, data_dir=tmp_path / "data")
        assert upgraded._schema_ready is False, "这个实例已经认为 schema 就绪，重放会被整段跳过"
        upgraded._ensure_schema()

        # ── 5 · 复查索引已换：同名还在，但不再唯一 ────────────────────────────────────
        assert _context_index_state(url) == [("account_contexts_context_key", False)], (
            "0020 没把唯一索引换掉 —— 升级路径断在这一步")

        # ── 6 · 升级后的库上真绑第二人（admin 那条路）───────────────────────────────────
        assert upgraded.link_account_context(bob, cid, allow_shared=True) is True
        # 存量那位没被动过，且认领语义仍然拒绝第三个人。
        assert upgraded.link_account_context("user_carol_100", cid) is False

        # ── 7 · 全新实例回读：两人都在，顺序按最早绑上的在前 ──────────────────────────
        fresh = PostgresContextRegistry(url, data_dir=tmp_path / "data")
        assert fresh.accounts_for_context(cid) == [alice, bob]
        assert fresh.account_owns(alice, cid) is True
        assert fresh.account_owns(bob, cid) is True
        assert fresh.account_owns("user_carol_100", cid) is False
        assert cid in fresh.contexts_for_account(alice)
        assert cid in fresh.contexts_for_account(bob)

        # ── 8 · 再重放两轮：索引不许变回唯一，bootstrap 不许炸（见 docstring 的红字）───
        for round_no in (1, 2):
            again = PostgresContextRegistry(url, data_dir=tmp_path / "data")
            again._ensure_schema()      # 0008 会再跑一次 CREATE UNIQUE INDEX IF NOT EXISTS
            assert _context_index_state(url) == [("account_contexts_context_key", False)], (
                f"第 {round_no} 轮重放之后索引变回唯一了 —— 0008 把它重建了回来，"
                f"下一次有多成员数据的开机会直接 UniqueViolation 炸掉整个 bootstrap")
            assert again.accounts_for_context(cid) == [alice, bob], "重放把成员行弄丢了"


@needs_db
def test_pg_bootstrap_constraint_guard_skips_re_add(pg, tmp_path):
    """Fix #2 Tier 2: 0009/0010's guarded ADD CONSTRAINT SKIPS the DROP+ADD (and its full-table
    re-validation under ACCESS EXCLUSIVE) when the constraint is already present & correct — proven by
    the constraint OID staying constant across a second _ensure_schema (a re-DROP would mint a new oid).
    This is also the real-pg check that 0009/0010's skip-comparison `want` matches Postgres's own
    rendering of the ADD: a mismatch would re-DROP every bootstrap and this oid would move."""
    reg = pg.fresh()
    reg._ensure_schema()

    def _oids() -> dict:
        with pg.fresh()._connect() as conn:
            return dict(conn.execute(
                "SELECT conname, oid::text FROM pg_constraint "
                "WHERE conrelid = 'avery.entities'::regclass "
                "AND conname IN ('entities_person_keys_allowlist', 'entities_kind_check')").fetchall())
    before = _oids()
    assert set(before) == {"entities_person_keys_allowlist", "entities_kind_check"}

    pg.fresh()._ensure_schema()   # a second bootstrap; the schema is already present & correct
    assert _oids() == before, (
        "guarded ADD CONSTRAINT re-DROPped an unchanged constraint — the skip comparison (`want`) is "
        "out of sync with pg_get_constraintdef, so every bootstrap re-validates the whole table")


@needs_db
def test_pg_manual_crud_roundtrip_erases_no_column_anywhere(pg, tmp_path):
    """arch-0802 — 关掉类而不是实例：put/get 不对称快照的全列守卫。

    get() 是有损投影（source_documents.content 刻意不拉 bytea、materials.embedding 不读回），
    put() 是整快照 DELETE+INSERT，而全部手编 CRUD 都是 get→改→put——投影丢掉的任何列都会被
    往返静默抹掉。bytes 列真踩过（files-hub-0729），当时的钉子只看 bytes 一列。本守卫在一次
    get→add_project→put 往返之后对 avery.* 里**每张带 context_id 的表逐列** diff（时间戳审计列
    updated_at/created_at 除外；uploaded_at 是业务数据，**不豁免**）：未来任何进快照的新列被
    往返抹掉，这里直接红——不需要有人预言是哪一列。

    ⚠ 两张表**该**变，各自单独判、判得比"逐字相同"更严（见下）：`entities`（多一行新卡）与
    `memory_files`（#93 收尾起手编 CRUD 会重物化 facts.md）。别顺手把它们从 diff 里划掉。
    """
    import psycopg

    reg, cid, _ = _ingest(pg, tmp_path / "mem", source_documents=_sample_source_docs())

    AUDIT_COLS = {"updated_at", "created_at"}

    def _norm(v):
        if isinstance(v, memoryview):
            return bytes(v)
        if hasattr(v, "isoformat"):
            return v.isoformat()
        return v

    def dump(conn) -> dict[str, list[dict]]:
        tables = [r[0] for r in conn.execute(
            "SELECT table_name FROM information_schema.tables WHERE table_schema='avery' "
            "AND table_type='BASE TABLE' ORDER BY table_name").fetchall()]
        snap: dict[str, list[dict]] = {}
        for t in tables:
            cols = [r[0] for r in conn.execute(
                "SELECT column_name FROM information_schema.columns "
                "WHERE table_schema='avery' AND table_name=%s ORDER BY ordinal_position",
                (t,)).fetchall()]
            if "context_id" not in cols:
                continue  # 与单个 context 快照无关的表（如迁移台账）不属于本守卫
            keep = [c for c in cols if c not in AUDIT_COLS]
            rows = conn.execute(
                f'SELECT {", ".join(keep)} FROM avery.{t} WHERE context_id = %s',
                (cid,)).fetchall()
            snap[t] = sorted(
                (dict(zip(keep, (_norm(v) for v in row))) for row in rows),
                key=lambda d: str(sorted((k, str(v)) for k, v in d.items())))
        return snap

    with psycopg.connect(_db_url()) as conn:
        before = dump(conn)
    assert any(r.get("content") for r in before.get("source_documents", [])), (
        "fixture胎里就没有字节——守卫没有测到东西")

    reg.add_project(cid, {"title": "Roundtrip Guard"})   # 最典型的 get→改→put 路径

    with psycopg.connect(_db_url()) as conn:
        after = dump(conn)

    # memory_files 本来就该跟着变（#93 收尾）：手编 CRUD 现在走 `ProjectWriteMixin._commit`，
    # **先重物化 facts.md 再 put()**。在那之前这张表在一次 add_project 后逐字不变——听着像
    # 「守卫全绿」，其实是「经理刚加的这张卡，议事室的 recall 一个字都不知道」，而 pg 腿的
    # `put()` 是从磁盘读 facts.md 存进库的，那份陈旧语料会被就地烤进数据库、下次 get() 再原样
    # 写回，不自愈。
    #
    # 🔴 所以这里不是把这张表从守卫里划掉（那会连"整列被抹掉"也一起放过），是换一条**更严的**：
    # notes.md 必须逐字不变（这一趟跟信号无关），facts.md 必须是**只增不减**——旧的每一行都还在，
    # 且新增的正好是新卡那一行。
    mem_before = {r["filename"]: r["content"] for r in before.pop("memory_files")}
    mem_after = {r["filename"]: r["content"] for r in after.pop("memory_files")}
    assert set(mem_before) == set(mem_after), "重物化改动了 memory_files 的文件集合"
    assert mem_after["notes.md"] == mem_before["notes.md"], "这一趟不该碰 notes.md"
    fb, fa = mem_before["facts.md"].splitlines(), mem_after["facts.md"].splitlines()
    assert [ln for ln in fb if ln not in fa] == [], "facts.md 里原有的行被重物化弄丢了"
    gained = [ln for ln in fa if ln not in fb]
    # 这份 fixture 语料本来一个项目都没有，所以除了卡那一行还会长出 `## Projects` 段标题。
    # 判据不写死行数（那会跟着语料形状漂），写成：新卡那行必须在，其余只许是段标题。
    assert "Project 'Roundtrip Guard':." in gained, f"新卡没进 facts.md：{gained}"
    assert [ln for ln in gained if not ln.startswith("## ")] == \
           ["Project 'Roundtrip Guard':."], f"facts.md 长出了新卡以外的内容：{gained}"

    # entities 本来就该多一行（新项目）：非 project 行必须逐列原样，project 旧行原样 +1 新行。
    ent_before = before.pop("entities")
    ent_after = after.pop("entities")
    assert [r for r in ent_before if r["kind"] != "project"] == \
           [r for r in ent_after if r["kind"] != "project"], "非 project 实体行被往返改写"
    pj_before = sorted((r for r in ent_before if r["kind"] == "project"), key=lambda r: r["idx"])
    pj_after = sorted((r for r in ent_after if r["kind"] == "project"), key=lambda r: r["idx"])
    assert len(pj_after) == len(pj_before) + 1 and pj_after[:-1] == pj_before, (
        "已有 project 行没有原样活过一次 add_project")
    assert pj_after[-1]["payload"].get("title") == "Roundtrip Guard"

    erased = {
        t: [k for k in {c for row in before[t] for c in row}
            if any(b.get(k) not in (None, "") for b in before[t])
            and all(a.get(k) in (None, "") for a in after[t])]
        for t in before if before[t] != after.get(t)
    }
    assert before == after, (
        f"get→改→put 往返改写了快照列。整列被抹掉的: { {t: v for t, v in erased.items() if v} }; "
        f"全部差异表: {sorted(t for t in before if before[t] != after.get(t))}")


@needs_db
@pytest.mark.parametrize("table", ["entities", "account_contexts"])
def test_steady_state_bootstrap_takes_no_table_lock(pg, monkeypatch, table):
    """README rule 2 and the `_ensure_schema` docstring both promise the STEADY-STATE bootstrap takes
    no ACCESS EXCLUSIVE lock on avery.entities. This is the test that makes the promise true instead
    of merely written down.

    #100 widened it from `entities` to a PARAMETRIZED pair, because 0020 made a second table
    lock-sensitive. `account_contexts` is read on EVERY authorized request (`account_owns`), and
    0020's retirement of the unique index is a `DROP INDEX` — the single most ACCESS-EXCLUSIVE
    statement in the repo. Written bare as `DROP INDEX IF EXISTS`, it would grab that lock on every
    boot forever (0002's header is the first-hand evidence that `IF EXISTS` decides nothing before it
    locks), which is the 2026-07-23 outage shape replayed on a different table. Widening the existing
    test rather than adding a sibling is deliberate: the invariant is "the steady-state boot locks
    NOTHING hot", and a per-table copy is how the next hot table gets forgotten.

    It was false in production shape until 0002 was guarded (2026-08-13): `ALTER TABLE ... DROP
    CONSTRAINT IF EXISTS` does not consult the catalog before locking, so 0002 grabbed ACCESS
    EXCLUSIVE on every single boot even though the constraint it names was retired long ago and the
    statement dropped nothing. Replaying each migration individually against a held ACCESS SHARE
    lock, 0002 was the ONLY file that failed. That is the 2026-07-23 outage shape: an orphaned
    idle-in-transaction /demo/claim holds entities, the bootstrap queues behind it, /demo/* 500s.

    Shape of the test: hold a real ACCESS SHARE lock (what any concurrent reader has) in a second
    connection, then run a full replay. ACCESS EXCLUSIVE conflicts with ACCESS SHARE, so any
    migration that reaches for it dies on lock_timeout rather than blocking the suite — retries are
    pinned to 1 so a regression fails in ~3s instead of backing off four times.

    🔴 The `lock_held()` assertions on BOTH sides are the point, not ceremony. If the blocker's
    transaction ended early — driver autocommit, an idle-timeout, a stray commit — the replay would
    sail through against an unlocked table and this test would report success for a bootstrap that
    was never actually contended. That is the exact false green this test exists to rule out, so it
    proves the lock was live before the replay AND still live after it."""
    import psycopg

    pg.fresh()._ensure_schema()          # reach steady state; boot #1 legitimately does lock

    monkeypatch.setenv("AVERY_BOOTSTRAP_LOCK_TIMEOUT_MS", "3000")
    monkeypatch.setenv("AVERY_BOOTSTRAP_RETRIES", "1")

    def lock_held() -> bool:
        with psycopg.connect(_db_url()) as probe:
            return probe.execute("""
                SELECT count(*) FROM pg_locks l
                  JOIN pg_class c ON c.oid = l.relation
                  JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE n.nspname = 'avery' AND c.relname = %s
                   AND l.mode = 'AccessShareLock' AND l.granted
            """, (table,)).fetchone()[0] > 0

    blocker = psycopg.connect(_db_url())          # NOT autocommit: the tx stays open below
    try:
        # takes ACCESS SHARE on the table under test, and holds it for the whole replay below.
        blocker.execute(f"SELECT count(*) FROM avery.{table}")
        assert lock_held(), (
            f"the blocking connection never actually took an ACCESS SHARE lock on avery.{table} — "
            "without it the replay below is uncontended and proves nothing")

        registry = pg.fresh()
        assert registry._schema_ready is False, (
            "a registry that already believes the schema is ready short-circuits _ensure_schema "
            "and would replay nothing at all")
        registry._ensure_schema()      # raises RuntimeError if any migration wants ACCESS EXCLUSIVE

        assert lock_held(), (
            "the ACCESS SHARE lock was gone by the end of the replay, so the run was not contended "
            "for its whole duration — treat the pass as unproven, not as evidence")
    finally:
        blocker.close()


@needs_db
def test_rls_enabled_on_every_avery_table(pg):
    """issue #98 / migration 0019 — every avery table carries ROW LEVEL SECURITY, and carries it in
    the deny-all shape: no policy, and NOT forced.

    Three separate assertions because the migration can fail in three different directions, and the
    third one is the dangerous one:

      - RLS OFF on a table is a hole in the deny-all floor. The realistic way to get one is drift:
        migrations replay in filename order, so a table created by a future 0020+ is created AFTER
        0019 has run and stays uncovered until the next bootstrap. 0019's header spells this out;
        this assertion is what makes the omission surface as a red test instead of a quiet gap.
        ⚠ KNOWN LIMIT, measured rather than assumed (2026-08-13): this clause only bites on a FRESH
        bootstrap. Verified by adding a throwaway 0020 that creates a table — against a brand-new DB
        the assertion goes red naming that table; run a SECOND time against the same DB it passes,
        because the `_ensure_schema()` call below replays 0019 and enables RLS on the now-existing
        table before the assertion is reached. Same reason a hand-disabled table cannot be used to
        exercise this clause: the replay heals it first. So this catches the drift where CI and new
        environments actually meet it (first boot), and cannot catch it on a long-lived DB.
      - A policy would turn deny-all into allow-something. 0019 deliberately ships none, so the
        expected count is a flat zero rather than anything derived from the schema.
      - 🔴 FORCE would subject the table OWNER to that empty policy set — deny-all pointed straight
        at the backend, which connects as the owner. Measured on a throwaway pg16 (2026-08-13):
        flip FORCE on and the real ingest path dies with `InsufficientPrivilege: new row violates
        row-level security policy for table "contexts"`, while the same run without FORCE is
        byte-identical to the pre-0019 baseline. This assertion is the tripwire on that mistake.

    The row-count floor is not decoration: every other assertion here is of the form "no row
    violates X", which a query matching NOTHING satisfies trivially — all three would go green at
    once against an empty result. It is a backstop for the query itself going wrong (a mistyped
    schema name, a relkind filter that excludes everything), not for an unprovisioned DB: that case
    is already loud, since `_ensure_schema()` below raises "avery schema is not provisioned" first.
    13 is the table count actually observed after replaying 0001..0019; it is a floor, so adding
    tables is fine and only removing one forces a deliberate edit here."""
    import psycopg

    pg.fresh()._ensure_schema()          # replay 0001..0019, including the migration under test
    with psycopg.connect(_db_url()) as conn:
        rows = conn.execute("""
            SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity,
                   (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid)
              FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = 'avery' AND c.relkind IN ('r', 'p')
             ORDER BY c.relname
        """).fetchall()

    assert len(rows) >= 13, (
        f"expected at least 13 avery tables after bootstrap, found {len(rows)}: "
        f"{[r[0] for r in rows]} — the RLS assertions below are vacuous against an empty result, "
        "so this is a broken probe (wrong schema? bootstrap skipped?), not a passing schema")

    no_rls = [r[0] for r in rows if not r[1]]
    forced = [r[0] for r in rows if r[2]]
    policied = [r[0] for r in rows if r[3]]

    assert not no_rls, (
        f"avery tables WITHOUT row level security: {no_rls} — 0019 enables it for every table in "
        "the schema; a table added by a later migration must enable it in that migration too "
        "(0019 runs before them and would only catch up on the NEXT bootstrap)")
    assert not forced, (
        f"🔴 avery tables with FORCE ROW LEVEL SECURITY: {forced} — FORCE applies the (empty) "
        "policy set to the table OWNER, which is the backend's own role: every read returns zero "
        "rows and every write is refused. 0019 must never set it.")
    assert not policied, (
        f"avery tables carrying a policy: {policied} — 0019 is deliberately policy-free (RLS on + "
        "zero policies = deny-all to non-owners). A policy here means someone widened access; that "
        "is a decision to make explicitly, not a drive-by.")
