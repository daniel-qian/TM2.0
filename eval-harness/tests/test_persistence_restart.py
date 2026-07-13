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
    """A REAL uvicorn subprocess (the production process shape), offline brains forced."""
    env = {**os.environ, **env_extra, "PYTHONUNBUFFERED": "1"}
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
        assert set(payload["source_files"]) == {SEED_XLSX.name, SEED_PDF.name}

        r_team = httpx.get(f"{base1}/team/{cid}", timeout=30)
        assert r_team.status_code == 200
        team_before = r_team.json()
    finally:
        _stop_hard(proc1, lf1)

    # ---- life 2: NEW process, NEW port, NEW data dir (fresh-machine semantics) ----------------
    port2 = _free_port()
    proc2, lf2, base2 = _start_service(
        port2, {**base_env, "AVERY_DATA_DIR": str(tmp_path / "data-life2")}, log)
    try:
        r_team2 = httpx.get(f"{base2}/team/{cid}", timeout=60)
        assert r_team2.status_code == 200, (
            f"the company VANISHED across a restart (HTTP {r_team2.status_code}) — "
            f"this is the pre-030 in-memory registry failure mode")
        assert r_team2.json() == team_before, "the team payload drifted across the restart"

        r_adv = httpx.post(f"{base2}/advise", json={
            "situation": "Give me a read on where the team stands from what I uploaded.",
            "company_context_id": cid,
            "stream": False,
        }, timeout=180)
        assert r_adv.status_code == 200, (
            f"a KNOWN context id 404'd after restart: {r_adv.status_code} {r_adv.text[:300]}")
        assert r_adv.json().get("contract_ok") is True

        # feat-028 behavior preserved: a ghost id is still a loud 404, not a silent demo answer.
        r_ghost = httpx.post(f"{base2}/advise", json={
            "situation": "Anything?", "company_context_id": "ctx_never_registered",
            "stream": False}, timeout=30)
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
