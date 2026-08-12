# -*- coding: utf-8 -*-
"""#90 — the async-deposit + content-idempotency gates (offline, in-memory leg).

Four families, one per ticket letter:

  A · content idempotency: identical bytes are recognized BY DIGEST (not by name), skipped without
      a temp file / parse / LLM call, and reported under the NEW `skipped_identical` field. The
      "no LLM call" criterion carries its own BASELINE (the counting extractor first proves a real
      upload DOES call it) — a destroy-shaped assertion without a baseline is vacuously green.
  B · async deposit: POST returns the skeleton in seconds (queued job, 'reading' rows, empty cards,
      NO extraction_mode); the worker lands the terminal world; a failed job collects its rows back
      out; startup orphan recovery marks mid-flight jobs failed and leaves queued ones alone.
  D · stage timing: one structured log line per pipeline stage (parse / extract / merge / persist).

The pg twin of the deposit/job seam is covered by tests/test_ingest_jobs_db_90.py (@needs_db);
protocol shape parity is automatic via tests/test_registry_protocol.py.
"""
from __future__ import annotations

import logging

import pytest

pytest.importorskip("fastapi.testclient")
from fastapi.testclient import TestClient  # noqa: E402

from avery.ingest.extract import HeuristicExtractor  # noqa: E402
from avery.ingest.file_append import existing_content_hashes  # noqa: E402
from avery.ingest.registry import REGISTRY, IngestJob, SourceDocument, new_job_id  # noqa: E402

ROSTER = "\n".join(["# 员工花名册", "", "姓名 | 部门 | 职位 | 司龄",
                    "老周 | 市场部 | 市场经理 | 3年",
                    "小马 | 市场部 | 专员 | 1年"])
WEEKLY = "\n".join(["# 项目周报", "", "## 婚宴对接",
                    "负责人：老周", "状态：进行中", "进度：40%",
                    "这一行是够长的散文，专门用来切出一块可引用的材料语料。"])
WEEKLY_V2 = WEEKLY.replace("进行中", "受阻").replace("40%", "55%")


@pytest.fixture()
def client(monkeypatch):
    monkeypatch.setenv("AVERY_BRAIN", "mock")
    monkeypatch.setenv("AVERY_EXTRACTOR", "heuristic")
    monkeypatch.setenv("AVERY_EMBEDDINGS", "keyword")
    for k in ("AVERY_DB_URL", "PGVECTOR_URL", "AVERY_ALLOW_PERSON_SCORING",
              "AVERY_RATE_INGEST_PER_MIN"):
        monkeypatch.delenv(k, raising=False)
    import service.app as app_mod
    from service import upload_guard
    REGISTRY.clear()
    upload_guard.reset_rate_limiter()
    with TestClient(app_mod.app) as c:
        yield c
    REGISTRY.clear()


def _drain() -> int:
    from service import ingest_worker
    return ingest_worker.run_pending_jobs()


def _seed(client) -> tuple[str, dict]:
    body = client.post("/ingest", files=[
        ("files", ("员工花名册.md", ROSTER.encode("utf-8"), "text/markdown")),
        ("files", ("项目周报.md", WEEKLY.encode("utf-8"), "text/markdown"))]).json()
    _drain()
    return body["context_id"], {"X-Avery-Token": body["owner_token"]}


class _CountingExtractor:
    """The spend probe: counts every extract() call, delegates to the offline heuristic."""

    def __init__(self):
        self.calls = 0
        self._inner = HeuristicExtractor()

    def extract(self, doc):
        self.calls += 1
        return self._inner.extract(doc)


@pytest.fixture()
def counting_extractor(monkeypatch):
    """Route the WORKER's extractor factory through a counting probe (one instance per make)."""
    from service import extractor_factory
    made: list[_CountingExtractor] = []

    def _make():
        ex = _CountingExtractor()
        made.append(ex)
        return ex

    monkeypatch.setattr(extractor_factory, "make_extractor", _make)
    return made


# ==============================================================================================
# A · content idempotency (sha256)
# ==============================================================================================

def test_identical_bytes_reupload_is_skipped_and_burns_zero_extraction(client, counting_extractor):
    """The retry-after-timeout amplifier, killed: the SAME bytes under a DIFFERENT name are
    recognized in the library and skipped — no job, no parse, no extractor call. 🔴 The zero is
    only meaningful against the baseline: the seeding upload must prove the counter counts."""
    cid, hdr = _seed(client)
    assert counting_extractor and counting_extractor[0].calls > 0, (
        "baseline failed: the seeding upload never hit the counting extractor — the 'zero calls "
        "on skip' assertion below would be measuring a dead probe")
    files_before = client.get(f"/team/{cid}/files", headers=hdr).json()
    calls_before = sum(ex.calls for ex in counting_extractor)
    makes_before = len(counting_extractor)

    r = client.post(f"/team/{cid}/files", headers=hdr, files=[
        ("files", ("改了个名字重传.md", ROSTER.encode("utf-8"), "text/markdown"))])
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["appended"]["documents"] == [], "identical bytes must not be accepted as new"
    assert body["appended"]["skipped_identical"] == [
        {"filename": "改了个名字重传.md", "matches_source_key": "员工花名册.md"}]
    assert "job" not in body, "an all-identical batch must not enqueue a job"
    assert _drain() == 0, "an all-identical batch left a queued job behind"
    assert sum(ex.calls for ex in counting_extractor) == calls_before, (
        "the skip path still called the extractor — the whole point of the digest was saving that")
    assert len(counting_extractor) == makes_before, "the skip path even built a new extractor"
    assert client.get(f"/team/{cid}/files", headers=hdr).json()["files"] == files_before["files"], (
        "the manifest changed on a skipped re-upload")


def test_same_name_different_bytes_is_accepted_not_skipped(client):
    """The digest is the ruler, the filename is not: an UPDATED weekly under the same display name
    must ingest as a new document (the incremental-upload story this whole ticket serves)."""
    cid, hdr = _seed(client)
    r = client.post(f"/team/{cid}/files", headers=hdr, files=[
        ("files", ("项目周报.md", WEEKLY_V2.encode("utf-8"), "text/markdown"))])
    assert r.status_code == 200, r.text
    assert r.json()["appended"]["documents"] == ["项目周报(1).md"]
    assert r.json()["appended"]["skipped_identical"] == []
    _drain()
    assert len(client.get(f"/team/{cid}/files", headers=hdr).json()["files"]) == 3


def test_mixed_batch_skips_the_identical_and_lands_the_new(client):
    cid, hdr = _seed(client)
    r = client.post(f"/team/{cid}/files", headers=hdr, files=[
        ("files", ("老周那份.md", ROSTER.encode("utf-8"), "text/markdown")),
        ("files", ("新周报.md", WEEKLY_V2.encode("utf-8"), "text/markdown"))])
    body = r.json()
    assert body["appended"]["documents"] == ["新周报.md"]
    assert [s["matches_source_key"] for s in body["appended"]["skipped_identical"]] == [
        "员工花名册.md"]
    assert body["job"]["status"] == "queued"
    _drain()
    manifest = client.get(f"/team/{cid}/files", headers=hdr).json()
    assert manifest["last_job"]["status"] == "done"
    assert {f["source_key"] for f in manifest["files"]} == {
        "员工花名册.md", "项目周报.md", "新周报.md"}


def test_ingest_batch_internal_duplicate_bytes_are_skipped(client):
    """/ingest has no library yet, but the SAME batch can carry the same bytes twice (double-added
    in the picker) — the second copy is skipped and reported on the deposit receipt."""
    r = client.post("/ingest", files=[
        ("files", ("花名册.md", ROSTER.encode("utf-8"), "text/markdown")),
        ("files", ("花名册副本.md", ROSTER.encode("utf-8"), "text/markdown"))])
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["skipped_identical"] == [
        {"filename": "花名册副本.md", "matches_source_key": "花名册.md"}]
    assert body["job"]["status"] == "queued"
    _drain()
    hdr = {"X-Avery-Token": body["owner_token"]}
    files = client.get(f"/team/{body['context_id']}/files", headers=hdr).json()["files"]
    assert [f["source_key"] for f in files] == ["花名册.md"], "the duplicate copy leaked in"


def test_existing_content_hashes_skips_rows_without_a_digest():
    """A pre-#90 row (no stored bytes -> no hash) must NOT match anything: an unknown digest is
    'cannot judge', never 'same'. keep-first: the FIRST holder of a digest names the match."""
    class _Ctx:
        source_documents = [
            SourceDocument(filename="老.md", source_key="老.md", content_sha256=""),
            SourceDocument(filename="a.md", source_key="a.md", content_sha256="d" * 64),
            SourceDocument(filename="b.md", source_key="b.md", content_sha256="d" * 64),
        ]
    table = existing_content_hashes(_Ctx())
    assert table == {"d" * 64: "a.md"}


def test_deposited_rows_carry_the_digest(client):
    """The hash is computed the moment read_capped read the bytes — every deposited row carries it
    (this is what the append-side idempotency map reads on the NEXT upload)."""
    cid, hdr = _seed(client)
    import hashlib
    want = hashlib.sha256(ROSTER.encode("utf-8")).hexdigest()
    ctx = REGISTRY.get(cid)
    by_key = {(sd.source_key or sd.filename): sd.content_sha256 for sd in ctx.source_documents}
    assert by_key["员工花名册.md"] == want


# ==============================================================================================
# B · async deposit: the second-scale receipt, the worker landing, failure semantics, recovery
# ==============================================================================================

def test_ingest_deposit_answers_with_the_skeleton_receipt(client):
    r = client.post("/ingest", files=[
        ("files", ("员工花名册.md", ROSTER.encode("utf-8"), "text/markdown"))])
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["owner_token"], "#90: the token must be durable and in hand BEFORE extraction"
    assert body["job"]["status"] == "queued" and body["job"]["kind"] == "ingest"
    assert body["people"] == [] and body["projects"] == [], "the receipt is the skeleton world"
    assert "extraction_mode" not in body, (
        "a deposit receipt claiming an extraction mode is a lie — extraction has not run")
    hdr = {"X-Avery-Token": body["owner_token"]}
    manifest = client.get(f"/team/{body['context_id']}/files", headers=hdr).json()
    assert [f["status"] for f in manifest["files"]] == ["reading"], (
        "the deposited file must be visible IMMEDIATELY as status='reading'")
    assert manifest["last_job"]["status"] == "queued"
    # the deposited bytes are already downloadable (they are the archive now)
    dl = client.get(f"/team/{body['context_id']}/files/0", headers=hdr)
    assert dl.status_code == 200 and dl.content == ROSTER.encode("utf-8")


def test_worker_lands_the_deposit_and_flips_the_terminal_states(client):
    r = client.post("/ingest", files=[
        ("files", ("员工花名册.md", ROSTER.encode("utf-8"), "text/markdown")),
        ("files", ("项目周报.md", WEEKLY.encode("utf-8"), "text/markdown"))])
    body = r.json()
    hdr = {"X-Avery-Token": body["owner_token"]}
    assert _drain() == 1, "exactly one queued job must run"
    team = client.get(f"/team/{body['context_id']}", headers=hdr).json()
    assert [p["name"] for p in team["people"]] == ["老周", "小马"]
    manifest = client.get(f"/team/{body['context_id']}/files", headers=hdr).json()
    assert all(f["status"] != "reading" for f in manifest["files"]), (
        f"rows stuck mid-flight: {[f['status'] for f in manifest['files']]}")
    assert manifest["last_job"]["status"] == "done"
    assert manifest["last_job"]["extraction_mode"] == "heuristic"
    assert manifest["last_job"]["id"] == body["job"]["id"], (
        "the /files summary must reconcile against the job handle the deposit returned")


def test_owner_token_survives_a_dropped_connection_by_construction(client):
    """The 暗伤①′ regression shape: the token answered at deposit time must open the door AFTER
    the worker lands — nothing about extraction re-mints or re-writes it."""
    r = client.post("/ingest", files=[
        ("files", ("员工花名册.md", ROSTER.encode("utf-8"), "text/markdown"))])
    tok = r.json()["owner_token"]
    cid = r.json()["context_id"]
    _drain()
    assert client.get(f"/team/{cid}", headers={"X-Avery-Token": tok}).status_code == 200
    assert REGISTRY.get(cid).owner_token == tok


def test_redline_ingest_fails_the_job_and_collects_the_rows(client):
    scored = "\n".join(["# 员工花名册", "", "姓名 | 部门 | 职位 | 司龄",
                        "老周 | 市场部 | 市场经理 | 综合评分 92 分"])
    r = client.post("/ingest", files=[
        ("files", ("员工花名册.md", scored.encode("utf-8"), "text/markdown"))])
    assert r.status_code == 200
    body = r.json()
    hdr = {"X-Avery-Token": body["owner_token"]}
    _drain()
    manifest = client.get(f"/team/{body['context_id']}/files", headers=hdr).json()
    assert manifest["last_job"]["status"] == "failed"
    assert "red line" in manifest["last_job"]["reason"]
    assert manifest["files"] == [], "failed = 这批文件没进资料库"
    assert client.get(f"/team/{body['context_id']}", headers=hdr).json()["people"] == []


def test_orphan_recovery_fails_processing_jobs_and_leaves_queued_alone(client):
    """The restart story, stated end to end: a job somebody was RUNNING when the process died is
    marked `failed: server restarted` and its 'reading' rows are collected; a job still QUEUED is
    untouched — its bytes are in the archive and the worker simply runs it after recovery."""
    cid, hdr = _seed(client)
    # a mid-flight job (claimed, then the process "died")
    r1 = client.post(f"/team/{cid}/files", headers=hdr, files=[
        ("files", ("死在半路.md", WEEKLY_V2.encode("utf-8"), "text/markdown"))])
    claimed = REGISTRY.claim_next_ingest_job()
    assert claimed is not None and claimed.id == r1.json()["job"]["id"]
    # a second job still queued at "restart"
    r2 = client.post(f"/team/{cid}/files", headers=hdr, files=[
        ("files", ("还在排队.md", (WEEKLY_V2 + "\n再多一行。").encode("utf-8"), "text/markdown"))])
    statuses = {f["source_key"]: f["status"]
                for f in client.get(f"/team/{cid}/files", headers=hdr).json()["files"]}
    assert statuses["死在半路.md"] == "reading" and statuses["还在排队.md"] == "reading"

    assert REGISTRY.recover_orphan_ingest_jobs() == 1, "exactly the processing job is an orphan"

    manifest = client.get(f"/team/{cid}/files", headers=hdr).json()
    keys = {f["source_key"] for f in manifest["files"]}
    assert "死在半路.md" not in keys, "the orphaned job's 'reading' row must be collected"
    assert "还在排队.md" in keys, "a queued job's rows must survive recovery untouched"
    # the queued job now simply runs
    assert _drain() == 1
    manifest = client.get(f"/team/{cid}/files", headers=hdr).json()
    assert manifest["last_job"]["status"] in ("done", "failed")
    by_key = {f["source_key"]: f["status"] for f in manifest["files"]}
    assert by_key.get("还在排队.md") == "ingested"
    # and the orphaned job's terminal state is readable off the registry
    dead = [j for j in REGISTRY._ingest_jobs.values() if j.id == claimed.id]
    assert dead and dead[0].status == "failed" and dead[0].reason == "server restarted"


def test_claim_is_exactly_once_and_finish_wants_a_terminal(client):
    cid, hdr = _seed(client)
    client.post(f"/team/{cid}/files", headers=hdr, files=[
        ("files", ("排队一.md", WEEKLY_V2.encode("utf-8"), "text/markdown"))])
    job = REGISTRY.claim_next_ingest_job()
    assert job is not None and job.status == "processing"
    assert REGISTRY.claim_next_ingest_job() is None, "one queued job must claim exactly once"
    with pytest.raises(ValueError):
        REGISTRY.finish_ingest_job(job.id, status="queued")
    with pytest.raises(KeyError):
        REGISTRY.finish_ingest_job("job_ghost", status="done")
    REGISTRY.finish_ingest_job(job.id, status="done", extraction_mode="heuristic")
    latest = REGISTRY.latest_ingest_job(cid)
    assert latest is not None and (latest.status, latest.extraction_mode) == ("done", "heuristic")


def test_deposit_append_404s_when_the_context_vanished(client):
    cid, hdr = _seed(client)
    src = [SourceDocument(filename="x.md", source_key="x.md", status="reading",
                          content=b"# x\n", content_sha256="a" * 64)]
    with pytest.raises(KeyError):
        REGISTRY.deposit_append("ctx_ghost", src,
                                IngestJob(id=new_job_id(), context_id="ctx_ghost", kind="append"))


# ==============================================================================================
# D · stage timing: parse / extract / merge / persist — one structured line each
# ==============================================================================================

def test_append_pipeline_logs_all_four_stages(client, caplog):
    cid, hdr = _seed(client)
    with caplog.at_level(logging.INFO):
        client.post(f"/team/{cid}/files", headers=hdr, files=[
            ("files", ("计时用周报.md", WEEKLY_V2.encode("utf-8"), "text/markdown"))])
        _drain()
    timing = [r.message for r in caplog.records if r.message.startswith("ingest-timing ")]
    stages = {m.split("stage=")[1].split()[0] for m in timing}
    assert {"parse", "extract", "merge", "persist"} <= stages, (
        f"the append pipeline must time all four stages; saw only {sorted(stages)}: {timing}")
    tagged = [m for m in timing if f"context_id={cid}" in m]
    assert len(tagged) >= 4, f"stage lines must carry the context_id: {timing}"
    assert all("files=" in m and "elapsed_ms=" in m for m in timing), timing


def test_ingest_pipeline_logs_parse_extract_and_persist(client, caplog):
    with caplog.at_level(logging.INFO):
        r = client.post("/ingest", files=[
            ("files", ("员工花名册.md", ROSTER.encode("utf-8"), "text/markdown"))])
        _drain()
    cid = r.json()["context_id"]
    timing = [m.message for m in caplog.records
              if m.message.startswith("ingest-timing ") and f"context_id={cid}" in m.message]
    stages = {m.split("stage=")[1].split()[0] for m in timing}
    assert {"parse", "extract", "persist"} <= stages, (
        f"the fresh-ingest pipeline must time parse/extract/persist; saw {sorted(stages)}")
