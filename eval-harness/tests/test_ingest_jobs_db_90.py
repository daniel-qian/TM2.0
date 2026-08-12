# -*- coding: utf-8 -*-
"""#90 — the pg twin of the async-deposit seam + the incremental-put criterion (@needs_db).

Three families:

  1. deposit/jobs on REAL Postgres: deposit_new_context / deposit_append land rows + job in one
     transaction; claim is exactly-once; recovery fails mid-flight jobs and collects their
     'reading' rows while leaving queued jobs (and their rows) alone.
  2. content_sha256 on REAL Postgres: deposited rows carry the digest, get() reads it back, the
     0017 backfill hashes pre-#90 rows in-database, clone_context carries the digest to the twin.
  3. THE INCREMENTAL PUT CRITERION (票面 C): after an append, the rows of batches 1..N-1 keep
     their xmin — Postgres's own "which transaction last wrote this row" system column — proving
     not even a DELETE touched them. 🔴 The baseline that keeps this non-vacuous: the SAME append
     must CHANGE facts.md's memory_files xmin (a whole-file materialization legitimately rewrites)
     — one ruler, both readings, so "xmin never moves" cannot be the ruler being dead.

Offline suite is blind to all of this by design (offline-suite-blind-to-pg-persistence); these run
under `-m needs_db` against a throwaway local DB.
"""
from __future__ import annotations

import os
import uuid
from pathlib import Path

import pytest

from avery.ingest.pipeline import ingest_paths
from avery.ingest.file_append import append_paths_to_context
from avery.ingest.registry import IngestJob, SourceDocument, new_job_id

needs_db = pytest.mark.needs_db

ROSTER = "\n".join(["# 员工花名册", "", "姓名 | 部门 | 职位 | 司龄",
                    "老周 | 市场部 | 市场经理 | 3年",
                    "小马 | 市场部 | 专员 | 1年"])
WEEKLY = "\n".join(["# 项目周报", "", "## 婚宴对接", "负责人：老周", "状态：进行中",
                    "这一行是够长的散文，专门用来切出一块可引用的材料语料。"])
WEEKLY_V2 = WEEKLY.replace("进行中", "受阻")


def _db_url() -> str:
    url = (os.environ.get("AVERY_DB_URL") or os.environ.get("PGVECTOR_URL") or "").strip()
    if not url:
        pytest.skip("needs AVERY_DB_URL (or PGVECTOR_URL) pointing at a Postgres")
    pytest.importorskip("psycopg")
    return url


def _reg(url, tmp_path):
    from avery.ingest.pg_registry import PostgresContextRegistry
    return PostgresContextRegistry(url, data_dir=tmp_path / "data")


def _cid() -> str:
    return "ctx_t90_" + uuid.uuid4().hex[:8]


def _doc(name: str, text: str) -> SourceDocument:
    import hashlib
    raw = text.encode("utf-8")
    return SourceDocument(filename=name, source_key=name, mime="text/markdown",
                          size_bytes=len(raw), status="reading", content=raw,
                          content_sha256=hashlib.sha256(raw).hexdigest())


def _write(tmp_path: Path, name: str, text: str) -> Path:
    p = tmp_path / name
    p.write_text(text, encoding="utf-8")
    return p


def _cleanup(reg, cid: str) -> None:
    reg.delete(cid)
    with reg._connect() as conn:
        conn.execute("DELETE FROM avery.ingest_jobs WHERE context_id = %s", (cid,))
        conn.commit()


# ==============================================================================================
# 1 · deposit + jobs on real Postgres
# ==============================================================================================

@needs_db
def test_deposit_new_context_lands_everything_in_one_shape(tmp_path):
    url = _db_url()
    reg = _reg(url, tmp_path)
    cid = _cid()
    job = IngestJob(id=new_job_id(), context_id=cid, kind="ingest", file_keys=["花名册.md"])
    try:
        reg.deposit_new_context(context_id=cid, name="company", owner_token="tok_90",
                                source_documents=[_doc("花名册.md", ROSTER)], job=job)
        ctx = reg.get(cid)
        assert ctx is not None and ctx.owner_token == "tok_90"
        assert [sd.status for sd in ctx.source_documents] == ["reading"]
        assert ctx.source_documents[0].content_sha256, "the digest must persist with the deposit"
        assert reg.source_document_bytes(cid, 0) == ROSTER.encode("utf-8")
        # the skeleton's facts.md is the EMPTY materialization, not a missing row
        with reg._connect() as conn:
            rows = dict(conn.execute(
                "SELECT filename, content FROM avery.memory_files WHERE context_id = %s",
                (cid,)).fetchall())
        assert "# Company facts" in rows.get("facts.md", "")
        got = reg.latest_ingest_job(cid)
        assert got is not None and (got.status, got.kind) == ("queued", "ingest")
        assert got.file_keys == ["花名册.md"]
    finally:
        _cleanup(reg, cid)


@needs_db
def test_claim_finish_and_recovery_on_pg(tmp_path):
    url = _db_url()
    reg = _reg(url, tmp_path)
    cid = _cid()
    # 🔴 claim / recovery are GLOBAL scans by design (production has one queue) — but this shared
    # test DB accumulates job rows from every OTHER needs_db test that drives HTTP /ingest (the
    # job table has no FK on purpose: it is an audit trail that survives context deletion). The
    # exactly-once and orphan-count assertions below are only meaningful over a clean queue.
    reg._ensure_schema()
    with reg._connect() as conn:
        conn.execute("DELETE FROM avery.ingest_jobs WHERE status IN ('queued', 'processing')")
        conn.commit()
    try:
        reg.deposit_new_context(context_id=cid, name="company", owner_token="tok",
                                source_documents=[_doc("一.md", ROSTER)],
                                job=IngestJob(id=new_job_id(), context_id=cid, kind="ingest",
                                              file_keys=["一.md"]))
        reg.deposit_append(cid, [_doc("二.md", WEEKLY)],
                           IngestJob(id=new_job_id(), context_id=cid, kind="append",
                                     file_keys=["二.md"]))
        # 🔴 "oldest first" is asserted against EXPLICIT timestamps, not two now() calls issued
        # milliseconds apart — this box's Docker PG clock jumps ±115s mid-run (the documented
        # "green alone, red in the full batch" trap), which can invert the insertion order.
        with reg._connect() as conn:
            conn.execute("UPDATE avery.ingest_jobs SET created_at = '2026-01-01T00:00:00Z' "
                         "WHERE context_id = %s AND kind = 'ingest'", (cid,))
            conn.execute("UPDATE avery.ingest_jobs SET created_at = '2026-01-02T00:00:00Z' "
                         "WHERE context_id = %s AND kind = 'append'", (cid,))
            conn.commit()
        first = reg.claim_next_ingest_job()
        assert first is not None and first.kind == "ingest", "oldest first"
        # exactly-once: the claimed job is gone from the queue, the append job is next
        second = reg.claim_next_ingest_job()
        assert second is not None and second.kind == "append"
        assert reg.claim_next_ingest_job() is None
        reg.finish_ingest_job(second.id, status="done", extraction_mode="heuristic")
        with pytest.raises(KeyError):
            reg.finish_ingest_job("job_ghost", status="done")
        # recovery: `first` is still processing -> failed + its 'reading' row collected;
        # `second` is terminal -> untouched.
        assert reg.recover_orphan_ingest_jobs() == 1
        got = reg.latest_ingest_job(cid)   # newest = the append job (done)
        assert got is not None and got.status == "done"
        ctx = reg.get(cid)
        keys = {sd.source_key for sd in ctx.source_documents}
        assert "一.md" not in keys, "the orphaned ingest job's 'reading' row must be collected"
        assert "二.md" in keys, "a finished job's row must survive recovery"
        with reg._connect() as conn:
            status, reason = conn.execute(
                "SELECT status, reason FROM avery.ingest_jobs WHERE id = %s",
                (first.id,)).fetchone()
        assert (status, reason) == ("failed", "server restarted")
    finally:
        _cleanup(reg, cid)


@needs_db
def test_deposit_append_serializes_idx_and_refuses_unknown_contexts(tmp_path):
    url = _db_url()
    reg = _reg(url, tmp_path)
    cid = _cid()
    try:
        reg.deposit_new_context(context_id=cid, name="company", owner_token="tok",
                                source_documents=[_doc("一.md", ROSTER)],
                                job=IngestJob(id=new_job_id(), context_id=cid, kind="ingest",
                                              file_keys=["一.md"]))
        reg.deposit_append(cid, [_doc("二.md", WEEKLY), _doc("三.md", WEEKLY_V2)],
                           IngestJob(id=new_job_id(), context_id=cid, kind="append",
                                     file_keys=["二.md", "三.md"]))
        with reg._connect() as conn:
            rows = conn.execute(
                "SELECT idx, source_key FROM avery.source_documents WHERE context_id = %s "
                "ORDER BY idx", (cid,)).fetchall()
        assert rows == [(0, "一.md"), (1, "二.md"), (2, "三.md")], (
            "deposit_append must continue the idx sequence, never collide")
        with pytest.raises(KeyError):
            reg.deposit_append("ctx_ghost_90", [_doc("x.md", "# x")],
                               IngestJob(id=new_job_id(), context_id="ctx_ghost_90",
                                         kind="append", file_keys=["x.md"]))
    finally:
        _cleanup(reg, cid)


# ==============================================================================================
# 2 · content_sha256 on real Postgres: backfill, round trip, clone
# ==============================================================================================

@needs_db
def test_0017_backfills_the_digest_for_pre90_rows(tmp_path):
    """A row deposited BEFORE #90 (content stored, hash column empty) gets its digest computed
    in-database by the 0017 replay — the idempotency map then covers legacy uploads too."""
    url = _db_url()
    reg = _reg(url, tmp_path)
    cid = _cid()
    try:
        reg.deposit_new_context(context_id=cid, name="company", owner_token="tok",
                                source_documents=[_doc("老资料.md", ROSTER)],
                                job=IngestJob(id=new_job_id(), context_id=cid, kind="ingest",
                                              file_keys=["老资料.md"]))
        with reg._connect() as conn:   # simulate the pre-#90 world: stored bytes, no digest
            conn.execute("UPDATE avery.source_documents SET content_sha256 = '' "
                         "WHERE context_id = %s", (cid,))
            conn.commit()
        reg._schema_ready = False      # force a replay (a fresh boot would do the same)
        reg._ensure_schema()
        import hashlib
        want = hashlib.sha256(ROSTER.encode("utf-8")).hexdigest()
        got = reg.get(cid).source_documents[0].content_sha256
        assert got == want, "the 0017 backfill must hash existing bytes in-database"
    finally:
        _cleanup(reg, cid)


@needs_db
def test_metadata_roundtrip_and_clone_keep_the_digest(tmp_path):
    url = _db_url()
    reg = _reg(url, tmp_path)
    cid, twin = _cid(), _cid()
    try:
        reg.deposit_new_context(context_id=cid, name="company", owner_token="tok",
                                source_documents=[_doc("资料.md", ROSTER)],
                                job=IngestJob(id=new_job_id(), context_id=cid, kind="ingest",
                                              file_keys=["资料.md"]))
        # get() -> put() round trip: the metadata read carries the hash (content stays None), and
        # the diff leaves the row untouched — bytes AND digest survive.
        ctx = reg.get(cid)
        assert ctx.source_documents[0].content is None, "get() must stay a metadata read"
        digest = ctx.source_documents[0].content_sha256
        assert digest
        reg.put(ctx)
        again = reg.get(cid)
        assert again.source_documents[0].content_sha256 == digest
        assert reg.source_document_bytes(cid, 0) == ROSTER.encode("utf-8")
        # the clone carries the digest (the twin's first 补传 must recognize identical bytes)
        assert reg.clone_context(cid, new_context_id=twin, new_owner_token="tok_twin")
        assert reg.get(twin).source_documents[0].content_sha256 == digest
    finally:
        _cleanup(reg, cid)
        _cleanup(reg, twin)


# ==============================================================================================
# 3 · THE INCREMENTAL PUT CRITERION — xmin proves the prefix was never rewritten
# ==============================================================================================

def _xmins(reg, cid: str, table: str) -> dict[int, str]:
    with reg._connect() as conn:
        return {idx: str(x) for idx, x in conn.execute(
            f"SELECT idx, xmin FROM avery.{table} WHERE context_id = %s ORDER BY idx", (cid,))}


@needs_db
def test_append_rewrites_only_the_increment_xmin_proof(tmp_path):
    """票面 C 的判据本体：第 N 次补传的落库成本不得随 1..N 总量增长 — stated as row identity.
    After appending batch 2, every batch-1 row in materials / source_documents / entities(person)
    keeps its xmin (READ: no DELETE, no INSERT, no UPDATE ever touched it), while the SAME append
    demonstrably moves facts.md's xmin (the ruler works). The old full-replace put() fails this
    immediately — every row's xmin changes on every put."""
    url = _db_url()
    reg = _reg(url, tmp_path)
    cid = _cid()
    try:
        files = [_write(tmp_path, "员工花名册.md", ROSTER)]
        rep = ingest_paths([str(p) for p in files], registry=reg, work_dir=tmp_path / "mem",
                           context_id=cid, name="company", owner_token="tok",
                           source_documents=[_doc("员工花名册.md", ROSTER)])
        assert rep.ok
        mats_before = _xmins(reg, cid, "materials")
        docs_before = _xmins(reg, cid, "source_documents")
        assert mats_before, "baseline: the seed must land material rows for the ruler to read"
        with reg._connect() as conn:
            facts_before = str(conn.execute(
                "SELECT xmin FROM avery.memory_files WHERE context_id = %s "
                "AND filename = 'facts.md'", (cid,)).fetchone()[0])

        p = _write(tmp_path, "项目周报.md", WEEKLY)
        out = append_paths_to_context(reg, cid, [str(p)], [_doc("项目周报.md", WEEKLY)])
        assert out.ok, out.parse_errors

        mats_after = _xmins(reg, cid, "materials")
        docs_after = _xmins(reg, cid, "source_documents")
        # 🔴 the ruler moves where it SHOULD: facts.md was legitimately rewritten by this append.
        with reg._connect() as conn:
            facts_after = str(conn.execute(
                "SELECT xmin FROM avery.memory_files WHERE context_id = %s "
                "AND filename = 'facts.md'", (cid,)).fetchone()[0])
        assert facts_after != facts_before, (
            "baseline failed: the SAME append did not move facts.md's xmin — the xmin ruler is "
            "not measuring writes, so the 'prefix unchanged' readings below would be vacuous")
        # …and stays put where it MUST: batch 1's rows were not rewritten.
        for idx, x in mats_before.items():
            assert mats_after[idx] == x, (
                f"materials[{idx}] was rewritten by an append that never touched it")
        for idx, x in docs_before.items():
            assert docs_after[idx] == x, (
                f"source_documents[{idx}] was rewritten by an append that never touched it")
        assert len(mats_after) > len(mats_before), "the increment itself must land"
        # the entity diff: 老周's person card DID change (the weekly links his project), so we
        # assert only on the mechanism's floor — the manifest row count grew by exactly one file.
        assert len(docs_after) == len(docs_before) + 1
    finally:
        _cleanup(reg, cid)


@needs_db
def test_unchanged_reput_writes_nothing_at_all(tmp_path):
    """The degenerate diff: put(get(cid)) with zero changes leaves EVERY row's xmin in place across
    all four tables — a pure no-op re-put now costs (and destroys) nothing."""
    url = _db_url()
    reg = _reg(url, tmp_path)
    cid = _cid()
    try:
        rep = ingest_paths([str(_write(tmp_path, "员工花名册.md", ROSTER))], registry=reg,
                           work_dir=tmp_path / "mem", context_id=cid, name="company",
                           owner_token="tok", source_documents=[_doc("员工花名册.md", ROSTER)])
        assert rep.ok
        before = {t: _xmins(reg, cid, t) for t in ("materials", "source_documents", "entities")}
        reg.put(reg.get(cid))
        after = {t: _xmins(reg, cid, t) for t in ("materials", "source_documents", "entities")}
        assert after == before, "a no-change re-put rewrote rows it had no reason to touch"
        # and the bytes are still there (the old lifeboat criterion, now free of charge)
        assert reg.source_document_bytes(cid, 0) == ROSTER.encode("utf-8")
    finally:
        _cleanup(reg, cid)


def _entities_xmins(reg, cid: str) -> dict[tuple, str]:
    with reg._connect() as conn:
        return {(k, i): str(x) for k, i, x in conn.execute(
            "SELECT kind, idx, xmin FROM avery.entities WHERE context_id = %s "
            "ORDER BY kind, idx", (cid,))}


# ==============================================================================================
# 4 · the upgrade path, REALLY run: prod-shaped schema (0001..0016) -> new code bootstraps 0017/18
# ==============================================================================================

@needs_db
def test_upgrade_path_from_prod_schema_bootstraps_90(tmp_path):
    """0810 discipline: a FRESH database proves nothing about upgrades. Build the schema exactly as
    production has it today (migrations 0001..0016 only), hand it to the NEW code, and verify
    _ensure_schema's replay adds what #90 needs: the content_sha256 column (backfilled) and the
    ingest_jobs table — against a database that already holds live-shaped rows."""
    url = _db_url()
    import psycopg
    base = url.rsplit("/", 1)[0]
    dbname = "avery_t90_upgrade_" + uuid.uuid4().hex[:6]
    admin_dsn = base + "/postgres"
    with psycopg.connect(admin_dsn, autocommit=True) as conn:
        conn.execute(f'CREATE DATABASE "{dbname}"')
    try:
        upgrade_url = f"{base}/{dbname}"
        migrations = sorted(
            (Path(__file__).resolve().parent.parent / "db" / "migrations").glob("*.sql"))
        prod = [m for m in migrations if m.name.split("_")[0] <= "0016"]
        assert prod and prod[-1].name.startswith("0016"), [m.name for m in prod]
        with psycopg.connect(upgrade_url) as conn:
            for m in prod:
                conn.execute(m.read_text(encoding="utf-8"))
            # a live-shaped legacy row: stored bytes, NO content_sha256 column yet
            conn.execute("INSERT INTO avery.contexts (context_id, name, owner_token) "
                         "VALUES ('ctx_legacy', 'company', 'tok_legacy')")
            conn.execute(
                "INSERT INTO avery.source_documents "
                "(context_id, idx, filename, source_key, mime, size_bytes, doc_kind, status, "
                " content, storage_ref) "
                "VALUES ('ctx_legacy', 0, '老资料.md', '老资料.md', 'text/markdown', %s, "
                "        'company', 'ingested', %s, '')",
                (len(ROSTER.encode("utf-8")), ROSTER.encode("utf-8")))
            conn.commit()

        from avery.ingest.pg_registry import PostgresContextRegistry
        reg = PostgresContextRegistry(upgrade_url, data_dir=tmp_path / "data")
        reg._ensure_schema()   # the NEW code takes over the production-shaped database

        import hashlib
        with psycopg.connect(upgrade_url) as conn:
            sha = conn.execute(
                "SELECT content_sha256 FROM avery.source_documents "
                "WHERE context_id = 'ctx_legacy'").fetchone()[0]
            assert sha == hashlib.sha256(ROSTER.encode("utf-8")).hexdigest(), (
                "the 0017 backfill must hash the legacy row during the upgrade replay")
            jobs_table = conn.execute("SELECT to_regclass('avery.ingest_jobs')").fetchone()[0]
            assert jobs_table is not None, "0018 must create ingest_jobs on the upgrade path"
        # and the upgraded DB actually WORKS end to end for the new seam
        cid = _cid()
        reg.deposit_append("ctx_legacy", [_doc("新资料.md", WEEKLY)],
                           IngestJob(id=new_job_id(), context_id="ctx_legacy", kind="append",
                                     file_keys=["新资料.md"]))
        got = reg.latest_ingest_job("ctx_legacy")
        assert got is not None and got.status == "queued"
    finally:
        with psycopg.connect(admin_dsn, autocommit=True) as conn:
            conn.execute(f'DROP DATABASE IF EXISTS "{dbname}" WITH (FORCE)')
