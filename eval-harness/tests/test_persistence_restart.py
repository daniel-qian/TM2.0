"""feat-030 — the integration-layer evidence: a company SURVIVES a real service restart.

Agent as first user, on the primary seam (HTTP): a REAL uvicorn pointed at a REAL Postgres
(AVERY_DB_URL — locally the Docker pgvector on :5433), the two OFFICIAL seed files really POSTed
to /ingest, then the process is HARD-KILLED (the redeploy/crash being simulated) and a brand-new
process — with a brand-new AVERY_DATA_DIR, i.e. fresh-machine semantics, no local file survives —
must still serve:

    * GET  /team/{id}   -> 200 with the byte-identical payload (the company is still there);
    * POST /advise      -> 200 + contract_ok over the SAME context id (the memory_dir
                           re-materialized from the DB; the loop's recall/cite ran over it);
    * unknown ids still 404 (feat-028 behavior preserved — persistence must not reopen the
                           silent-demo-fallback hole).

Pre-030 this is exactly what broke: the in-process REGISTRY died with the process and a company's
second visit was a 404 over their own context_id. Brain/extractor are forced offline (mock /
heuristic / keyword) — the claim under test is persistence, not LLM quality.

@needs_db: skips cleanly without AVERY_DB_URL/PGVECTOR_URL, so the offline suite stays autonomous.
"""
from __future__ import annotations

import os
import socket
import subprocess
import sys
import time
from pathlib import Path

import pytest

pytest.importorskip("httpx")
import httpx  # noqa: E402

from avery.env import load_dotenv
from conftest import SUBPROCESS_WORKER_ON, await_ingest_job   # #90 异步 deposit（理由见 conftest）

HERE = Path(__file__).resolve().parent
HARNESS = HERE.parent                      # eval-harness/
SEED_DIR = HERE / "fixtures" / "seed"
SEED_XLSX = SEED_DIR / "PrismDesign_TeamProfile_EN.xlsx"
SEED_PDF = SEED_DIR / "LogiPulse-Roadmap.pdf"

load_dotenv(HARNESS / ".env")

needs_db = pytest.mark.needs_db


def _db_url() -> str | None:
    return (os.environ.get("AVERY_DB_URL") or os.environ.get("PGVECTOR_URL") or "").strip() or None


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _start_service(port: int, env_extra: dict, log_path: Path):
    """A REAL uvicorn subprocess (the production process shape), offline brains forced.

    🔴 `SUBPROCESS_WORKER_ON` 是必须的，不是保险：`tests/conftest.py` 那条 autouse fixture 把
    `AVERY_INGEST_WORKER` 设成了 off（离线电池的确定性开关），而 `{**os.environ, ...}` 会把它
    **继承进子进程** —— 于是「生产进程形状」里的 worker 线程被按死，字节落库、job 排着队、
    没有任何人去跑它。#90 合入后本文件两条测试就是这么一直红的（#93 收尾时才扫出来）。
    """
    env = {**os.environ, **env_extra, **SUBPROCESS_WORKER_ON, "PYTHONUNBUFFERED": "1"}
    log_file = open(log_path, "a", encoding="utf-8", errors="replace")
    proc = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "service.app:app",
         "--host", "127.0.0.1", "--port", str(port), "--log-level", "warning"],
        cwd=str(HARNESS), env=env, stdout=log_file, stderr=subprocess.STDOUT)
    base = f"http://127.0.0.1:{port}"
    deadline = time.time() + 90
    last_err: Exception | None = None
    while time.time() < deadline:
        if proc.poll() is not None:
            log_file.flush()
            tail = log_path.read_text(encoding="utf-8", errors="replace")[-2000:]
            pytest.fail(f"uvicorn died on startup:\n{tail}")
        try:
            if httpx.get(f"{base}/health", timeout=5).status_code == 200:
                return proc, log_file, base
        except (httpx.HTTPError, OSError) as e:
            last_err = e
        time.sleep(0.4)
    proc.kill()
    log_file.close()
    pytest.fail(f"service never became healthy on {base}: {last_err}")


def _stop_hard(proc, log_file):
    """The crash being simulated: no graceful shutdown, no atexit — kill."""
    proc.kill()
    proc.wait(timeout=15)
    log_file.close()


@needs_db
def test_company_survives_a_service_restart(tmp_path):
    url = _db_url()
    if not url:
        pytest.skip("needs AVERY_DB_URL (or PGVECTOR_URL) — restart integration skipped")
    base_env = {
        "AVERY_DB_URL": url,
        "AVERY_BRAIN": "mock",             # persistence is the claim, not the LLM
        "AVERY_EXTRACTOR": "heuristic",
        "AVERY_EMBEDDINGS": "keyword",
    }
    log = tmp_path / "restart-uvicorn.log"
    cid = None

    # ---- life 1: ingest the official seeds, read the team ------------------------------------
    port1 = _free_port()
    proc1, lf1, base1 = _start_service(
        port1, {**base_env, "AVERY_DATA_DIR": str(tmp_path / "data-life1")}, log)
    try:
        files = [("files", (p.name, p.read_bytes(), "application/octet-stream"))
                 for p in (SEED_XLSX, SEED_PDF)]
        r = httpx.post(f"{base1}/ingest", files=files, timeout=300)
        assert r.status_code == 200, f"/ingest failed on the seeds: {r.text[:400]}"
        payload = r.json()
        cid = payload["context_id"]
        # feat-038: the owner_token minted here must persist to the DB and still authorize a read
        # from a BRAND-NEW process in life 2 (the restart) — the tenant-isolation restart story.
        hdr = {"X-Avery-Token": payload["owner_token"]}
        # #90：POST /ingest 现在只**存字节 + 排 job**，回执是「空骨架世界」（端点 docstring 明写）。
        # 所以这里等任务落地，再断言这家公司长出来了什么 —— 原来那句
        # `assert set(payload["source_files"]) == {...}` 断的是 POST 回执，#90 之后恒为空集。
        # ⚠ 判据从「回执里有」改成了「落地之后清单里有」，说的仍然是同一件事，
        # 而且比原来强：它现在证明的是**库里**真有这两份，不是响应体里抄了一遍。
        await_ingest_job(httpx, base1, cid, hdr)
        r_files1 = httpx.get(f"{base1}/team/{cid}/files", headers=hdr, timeout=30)
        assert r_files1.status_code == 200
        assert {f["filename"] for f in r_files1.json()["files"]} == {SEED_XLSX.name, SEED_PDF.name}

        r_team = httpx.get(f"{base1}/team/{cid}", headers=hdr, timeout=30)
        assert r_team.status_code == 200
        team_before = r_team.json()
    finally:
        _stop_hard(proc1, lf1)

    # ---- life 2: NEW process, NEW port, NEW data dir (fresh-machine semantics) ----------------
    port2 = _free_port()
    proc2, lf2, base2 = _start_service(
        port2, {**base_env, "AVERY_DATA_DIR": str(tmp_path / "data-life2")}, log)
    try:
        # feat-038: the SAME owner_token from life 1 authorizes the read in the new process (it came
        # back from the DB with the context) — proof the isolation credential survives the restart.
        r_team2 = httpx.get(f"{base2}/team/{cid}", headers=hdr, timeout=60)
        assert r_team2.status_code == 200, (
            f"the company VANISHED across a restart (HTTP {r_team2.status_code}) — "
            f"this is the pre-030 in-memory registry failure mode")
        assert r_team2.json() == team_before, "the team payload drifted across the restart"

        # feat-038: after a restart, the WRONG/absent token must still 404 (the credential is real,
        # persisted, and checked in the fresh process — not reset to open by the redeploy).
        assert httpx.get(f"{base2}/team/{cid}", timeout=30).status_code == 404, (
            "a read with NO token succeeded after restart — isolation did not survive the redeploy")
        assert httpx.get(f"{base2}/team/{cid}", headers={"X-Avery-Token": "wrong"},
                         timeout=30).status_code == 404

        r_adv = httpx.post(f"{base2}/advise", json={
            "situation": "Give me a read on where the team stands from what I uploaded.",
            "company_context_id": cid,
            "stream": False,
        }, headers=hdr, timeout=180)
        assert r_adv.status_code == 200, (
            f"a KNOWN context id 404'd after restart: {r_adv.status_code} {r_adv.text[:300]}")
        assert r_adv.json().get("contract_ok") is True

        # feat-028 behavior preserved: a ghost id is still a loud 404, not a silent demo answer.
        r_ghost = httpx.post(f"{base2}/advise", json={
            "situation": "Anything?", "company_context_id": "ctx_never_registered",
            "stream": False}, headers=hdr, timeout=30)
        assert r_ghost.status_code == 404
    finally:
        _stop_hard(proc2, lf2)
        # DB hygiene: drop the context this test created.
        if cid:
            try:
                from avery.ingest.pg_registry import PostgresContextRegistry
                PostgresContextRegistry(url, data_dir=tmp_path / "data-life2").delete(cid)
            except Exception:
                pass


@needs_db
def test_file_space_survives_a_service_restart(tmp_path):
    """feat-032 integration evidence (agent as first user, HTTP seam): a company's UPLOADED FILES —
    the manifest AND the raw bytes — survive a hard restart onto fresh-machine semantics.

      life 1: POST the two official seeds -> GET /team/{id}/files lists both with n_chunks>0, and
              GET /team/{id}/files/0 downloads the ORIGINAL bytes.
      HARD KILL (redeploy/crash).
      life 2: NEW process, NEW data dir -> the manifest is STILL there and the bytes STILL download,
              byte-identical. Pre-032 the upload was discarded at /ingest — nothing to look back on.
    """
    url = _db_url()
    if not url:
        pytest.skip("needs AVERY_DB_URL (or PGVECTOR_URL) — file-space restart integration skipped")
    base_env = {
        "AVERY_DB_URL": url,
        "AVERY_BRAIN": "mock",
        "AVERY_EXTRACTOR": "heuristic",
        "AVERY_EMBEDDINGS": "keyword",
    }
    log = tmp_path / "restart-files-uvicorn.log"
    cid = None
    xlsx_bytes = SEED_XLSX.read_bytes()

    # ---- life 1: ingest the seeds, read the file manifest + download the raw bytes --------------
    port1 = _free_port()
    proc1, lf1, base1 = _start_service(
        port1, {**base_env, "AVERY_DATA_DIR": str(tmp_path / "data-life1")}, log)
    try:
        files = [("files", (p.name, p.read_bytes(), "application/octet-stream"))
                 for p in (SEED_XLSX, SEED_PDF)]
        r = httpx.post(f"{base1}/ingest", files=files, timeout=300)
        assert r.status_code == 200, f"/ingest failed on the seeds: {r.text[:400]}"
        cid = r.json()["context_id"]
        hdr = {"X-Avery-Token": r.json()["owner_token"]}   # feat-038
        # #90：等抽取落地再读清单——`n_chunks` 是抽取的产物，deposit 那一刻它必然是 0
        # （下面那条 `sum(n_chunks) > 0` 正是本文件 #90 之后一直红的那一句）。
        await_ingest_job(httpx, base1, cid, hdr)

        r_files = httpx.get(f"{base1}/team/{cid}/files", headers=hdr, timeout=30)
        assert r_files.status_code == 200
        manifest_before = r_files.json()["files"]
        names = [f["filename"] for f in manifest_before]
        assert set(names) == {SEED_XLSX.name, SEED_PDF.name}, f"manifest missing a seed: {names}"
        assert all("size_bytes" in f and "mime" in f and "n_chunks" in f for f in manifest_before)
        assert sum(f["n_chunks"] for f in manifest_before) > 0, "no file linked to any material chunk"

        xlsx_idx = names.index(SEED_XLSX.name)
        r_dl = httpx.get(f"{base1}/team/{cid}/files/{xlsx_idx}", headers=hdr, timeout=30)
        assert r_dl.status_code == 200
        assert r_dl.content == xlsx_bytes, "downloaded bytes are not the uploaded file byte-for-byte"
        assert "attachment" in r_dl.headers.get("content-disposition", ""), (
            "untrusted upload must be served as an attachment, not rendered inline")
    finally:
        _stop_hard(proc1, lf1)

    # ---- life 2: NEW process, NEW data dir — the file space is STILL there --------------------
    port2 = _free_port()
    proc2, lf2, base2 = _start_service(
        port2, {**base_env, "AVERY_DATA_DIR": str(tmp_path / "data-life2")}, log)
    try:
        r_files2 = httpx.get(f"{base2}/team/{cid}/files", headers=hdr, timeout=60)   # feat-038 token
        assert r_files2.status_code == 200, (
            f"the file manifest VANISHED across a restart (HTTP {r_files2.status_code})")
        manifest_after = r_files2.json()["files"]
        assert [f["filename"] for f in manifest_after] == [f["filename"] for f in manifest_before]
        assert [f["n_chunks"] for f in manifest_after] == [f["n_chunks"] for f in manifest_before]

        names2 = [f["filename"] for f in manifest_after]
        xlsx_idx2 = names2.index(SEED_XLSX.name)
        r_dl2 = httpx.get(f"{base2}/team/{cid}/files/{xlsx_idx2}", headers=hdr, timeout=30)
        assert r_dl2.status_code == 200, "the raw bytes vanished across the restart"
        assert r_dl2.content == xlsx_bytes, "downloaded bytes drifted across the restart"

        # feat-038: the file download is gated in the fresh process too — no token / wrong token 404.
        assert httpx.get(f"{base2}/team/{cid}/files/{xlsx_idx2}",
                         timeout=30).status_code == 404, "file download open without a token post-restart"

        # unknown context id is still a loud 404 (feat-028 behavior preserved on the new endpoints).
        r_ghost = httpx.get(f"{base2}/team/ctx_never_registered/files", headers=hdr, timeout=30)
        assert r_ghost.status_code == 404
    finally:
        _stop_hard(proc2, lf2)
        if cid:
            try:
                from avery.ingest.pg_registry import PostgresContextRegistry
                PostgresContextRegistry(url, data_dir=tmp_path / "data-life2").delete(cid)
            except Exception:
                pass
