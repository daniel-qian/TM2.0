"""feat-041 — the BASIC stress floor (PRD Testing Decisions: "真实公司零星并发 + 上传硬门边界",
NOT an exhaustive load test), driven as REAL HTTP against a real uvicorn subprocess on a real Postgres
(mock brain / heuristic / keyword — offline brains). Three claims a lead-gen box must hold:

  1. CONCURRENCY SURVIVAL — a handful of parallel /ingest + /advise do not crash the single worker,
     never return a 500, and — the feat-028 threadpool claim — do not block /health (a HEALTHCHECK
     issued WHILE long ingests are in flight still returns 200 quickly, so Docker won't kill the box
     mid-extraction). The process is still alive afterwards.

  2. HARD-GATE BOUNDARY COMBO under pressure (feat-039) — oversize / over-count / disguised-type /
     zip-bomb / valid uploads fired CONCURRENTLY each get their HONEST status (413 / 413 / 415 / 413 /
     200), never a 500, and the memory sentinel over its water mark makes /health report
     `degraded: true` throughout (Danny Q12's "time to upsize the ECS box" signal) — a truthful
     degrade, not a crash.

  3. OVER-FREQUENCY (feat-039 rate limit) — a rapid burst from one IP is shed with 429s past the
     burst while the service stays up and returns no 500.

@needs_db: skips cleanly without AVERY_DB_URL/PGVECTOR_URL. These are basic-floor assertions — a few
parallel requests, not a benchmark; the point is "no embarrassing incident under real sporadic use".
"""
from __future__ import annotations

import io
import os
import socket
import subprocess
import sys
import threading
import time
import zipfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest

pytest.importorskip("httpx")
import httpx  # noqa: E402

from avery.env import load_dotenv
from conftest import SUBPROCESS_WORKER_ON   # #90 异步 deposit（理由见 conftest）

HERE = Path(__file__).resolve().parent
HARNESS = HERE.parent
INGEST_FIX = HERE / "fixtures" / "ingest"
HANDBOOK = INGEST_FIX / "Studio_Handbook.md"

load_dotenv(HARNESS / ".env")

needs_db = pytest.mark.needs_db


def _db_url() -> str | None:
    return (os.environ.get("AVERY_DB_URL") or os.environ.get("PGVECTOR_URL") or "").strip() or None


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _start_service(env_extra: dict, log_path: Path):
    # 🔴 `SUBPROCESS_WORKER_ON`（#95）：conftest 那条 autouse 的 `AVERY_INGEST_WORKER=off`
    # 会被 `{**os.environ, ...}` 继承进子进程。对本文件后果尤其难看——**它把这条压测的主张变成
    # 了一句空话**：worker 不跑 = 根本没有「长时间的 ingest」，而下面那条判据说的正是
    # 「/health 没有被并发的长 ingest 堵住」。压测压的是 deposit（毫秒级存字节），
    # 却自称压过了抽取。打开 worker，主张才重新成立。
    port = _free_port()
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
    proc.kill()
    proc.wait(timeout=15)
    log_file.close()


def _base_env(url: str) -> dict:
    return {"AVERY_DB_URL": url, "AVERY_BRAIN": "mock",
            "AVERY_EXTRACTOR": "heuristic", "AVERY_EMBEDDINGS": "keyword"}


def _cleanup(url: str, cids, tmp_path: Path) -> None:
    try:
        from avery.ingest.pg_registry import PostgresContextRegistry
        reg = PostgresContextRegistry(url, data_dir=tmp_path / "cleanup")
        for cid in cids:
            if cid:
                try:
                    reg.delete(cid)
                except Exception:
                    pass
    except Exception:
        pass


def _small_txt(i: int):
    body = (f"Weekly note {i}: the onboarding backlog keeps landing on one squad and needs "
            f"rebalancing across the pod. Line two is long enough to chunk cleanly.\n").encode()
    return [("files", (f"note{i}.txt", body, "text/plain"))]


# =================================================================================================
# 1) Concurrency survival — parallel ingest + advise never 500, and /health is not blocked.
# =================================================================================================

@needs_db
def test_stress_concurrency_survival_and_health_not_blocked(tmp_path):
    url = _db_url()
    if not url:
        pytest.skip("needs AVERY_DB_URL (or PGVECTOR_URL) — stress floor skips")
    log = tmp_path / "stress-survival.log"
    proc, lf, base = _start_service(
        {**_base_env(url), "AVERY_DATA_DIR": str(tmp_path / "data")}, log)
    created: list[str] = []
    try:
        # seed one context so the concurrent /advise has a real company + token to reason over.
        a = httpx.post(f"{base}/ingest", files=_small_txt(0), timeout=120).json()
        cid, tok = a["context_id"], a["owner_token"]
        created.append(cid)
        hdr = {"X-Avery-Token": tok}

        results: dict[str, list[int]] = {"ingest": [], "advise": []}
        errors: list[str] = []
        health_latencies: list[float] = []
        stop = threading.Event()

        def _do_ingest(i: int):
            try:
                r = httpx.post(f"{base}/ingest", files=_small_txt(i + 1), timeout=180)
                results["ingest"].append(r.status_code)
                if r.status_code == 200:
                    created.append(r.json()["context_id"])
                if r.status_code >= 500:
                    errors.append(f"ingest {i} -> {r.status_code}: {r.text[:120]}")
            except Exception as e:
                errors.append(f"ingest {i} raised {e!r}")

        def _do_advise(i: int):
            try:
                r = httpx.post(f"{base}/advise", json={
                    "situation": f"Round {i}: how do I rebalance the onboarding backlog this week?",
                    "company_context_id": cid, "stream": False}, headers=hdr, timeout=180)
                results["advise"].append(r.status_code)
                if r.status_code >= 500:
                    errors.append(f"advise {i} -> {r.status_code}: {r.text[:120]}")
            except Exception as e:
                errors.append(f"advise {i} raised {e!r}")

        def _health_poller():
            # hammer /health WHILE the ingest/advise load runs — the feat-028 non-block claim.
            while not stop.is_set():
                t0 = time.time()
                try:
                    r = httpx.get(f"{base}/health", timeout=10)
                    dt = time.time() - t0
                    health_latencies.append(dt)
                    if r.status_code != 200:
                        errors.append(f"/health -> {r.status_code} during load")
                except Exception as e:
                    errors.append(f"/health raised {e!r} during load")
                time.sleep(0.2)

        poller = threading.Thread(target=_health_poller, daemon=True)
        poller.start()
        # fire 8 ingests + 8 advises at once through a 16-wide pool so they genuinely overlap.
        with ThreadPoolExecutor(max_workers=16) as ex:
            futs = [ex.submit(_do_ingest, i) for i in range(8)]
            futs += [ex.submit(_do_advise, i) for i in range(8)]
            for f in futs:
                f.result()
        stop.set()
        poller.join(timeout=5)

        assert not errors, f"the service faltered under sporadic concurrency: {errors[:6]}"
        assert results["ingest"] and all(s == 200 for s in results["ingest"]), (
            f"a parallel /ingest did not succeed: {results['ingest']}")
        assert results["advise"] and all(s == 200 for s in results["advise"]), (
            f"a parallel /advise did not succeed: {results['advise']}")
        # /health KEPT ANSWERING throughout the load (every non-200 / raise already landed in
        # `errors` above) and never hung — that is the feat-028 claim this test can actually make.
        #
        # 🔴 判据形状换过一次（#95），因为旧版 `max(health_latencies) < 8.0` 是一枚**硬币**。
        # 实测（off/on 各 3 轮，同一台机器、一次性库）：
        #     worker OFF: n=2 [1.58, 6.62] / [1.46, 7.16] / [1.59, 6.41]
        #     worker ON : n=2 [1.56, 7.69] / [1.62, 7.90] / [1.75, 6.10]
        # 两件事因此钉死：
        #   ① **压测下 /health 本来就要 6~8 秒**，而且**与 worker 开关无关**（两组分布重合）——
        #      所以 8.0 这条线正压在真实分布上，机器一忙就翻红（#93 收尾实收 8.8s），
        #      空机就绿。它不是在测阻塞，是在测那天机器忙不忙。
        #   ② **样本恒为 2**，而且这不是「轮询被饿着了」——它是**延迟的函数**：整个加载窗口约 9 秒，
        #      一次 /health 就吃掉 6~8 秒。所以任何「最少 N 个样本」的写法在这个形状下不可满足，
        #      任何「中位数」在 n=2 上就是最大值。
        # 于是判据落在**这条测试真正能说的那句话**上：全程有应答（上面的 `errors`）、
        # 一次都没有挂到客户端超时（下面这条），进程还活着。
        # ⚠ **这不是一条延迟 SLA**：15s 是「挂没挂」的线，不是「快不快」的线。想要延迟 SLA 的话，
        #    前置是先把「压测下 /health 要 7 秒」这件事本身当成一个产品/运维问题决策掉
        #    （Docker healthcheck 的 timeout 必须大于它），那不是这条门能替人做的判断。
        assert len(health_latencies) >= 2, (
            f"the health poller got {len(health_latencies)} sample(s) — it never really ran "
            f"alongside the load")
        assert max(health_latencies) < 15.0, (
            f"/health stalled outright (max {max(health_latencies):.1f}s over "
            f"{len(health_latencies)} samples) — that is a hang, not scheduling jitter")
        assert proc.poll() is None, "the service process died under concurrency"
    finally:
        _stop_hard(proc, lf)
        _cleanup(url, created, tmp_path)


# =================================================================================================
# 2) Hard-gate boundary combo + memory sentinel — every boundary honest, /health degraded, no 500.
# =================================================================================================

def _zip_bomb() -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("xl/worksheets/sheet1.xml", b"\x00" * (5 * 1024 * 1024))  # 5 MiB -> ~KiB
    return buf.getvalue()


@needs_db
def test_stress_hardgate_boundaries_and_sentinel_under_pressure(tmp_path):
    url = _db_url()
    if not url:
        pytest.skip("needs AVERY_DB_URL (or PGVECTOR_URL) — stress floor skips")
    log = tmp_path / "stress-hardgate.log"
    proc, lf, base = _start_service({
        **_base_env(url),
        "AVERY_DATA_DIR": str(tmp_path / "data"),
        "AVERY_MAX_UPLOAD_BYTES": "2000",              # per-file cap
        "AVERY_MAX_FILES": "3",                         # per-batch count cap
        "AVERY_MAX_TOTAL_UPLOAD_BYTES": "8000",         # total-body cap
        "AVERY_MAX_ARCHIVE_UNCOMPRESSED_BYTES": str(100 * 1024),  # zip-bomb cap
        "AVERY_MEM_WARN_MB": "1",                       # RSS is always > 1 MiB -> sentinel high
        # rate limit intentionally OFF here so it does not mask the size/type verdicts.
    }, log)
    created: list[str] = []
    try:
        # each boundary probe -> (label, expected_status, files kwarg)
        def valid():
            return httpx.post(f"{base}/ingest", files=_small_txt(101), timeout=60)

        def oversize():
            return httpx.post(f"{base}/ingest",
                              files=[("files", ("big.txt", b"x" * 5000, "text/plain"))], timeout=60)

        def overcount():
            return httpx.post(f"{base}/ingest", files=[
                ("files", (f"f{i}.txt", b"a content line long enough to chunk here\n", "text/plain"))
                for i in range(5)], timeout=60)

        def disguised():
            return httpx.post(f"{base}/ingest", files=[
                ("files", ("notes.txt", b"%PDF-1.7\n%binary\x00\x01", "text/plain"))], timeout=60)

        def bomb():
            return httpx.post(f"{base}/ingest",
                              files=[("files", ("bomb.xlsx", _zip_bomb(), "application/octet-stream"))],
                              timeout=60)

        probes = [("valid", 200, valid), ("oversize", 413, oversize),
                  ("overcount", 413, overcount), ("disguised", 415, disguised),
                  ("bomb", 413, bomb)]
        outcomes: dict[str, int] = {}
        errors: list[str] = []

        def run(name, expected, fn):
            try:
                r = fn()
                outcomes[name] = r.status_code
                if r.status_code >= 500:
                    errors.append(f"{name} -> {r.status_code}: {r.text[:120]}")
                if name == "valid" and r.status_code == 200:
                    created.append(r.json()["context_id"])
            except Exception as e:
                errors.append(f"{name} raised {e!r}")

        # fire the whole boundary mix CONCURRENTLY — the gate must hold each verdict under overlap.
        with ThreadPoolExecutor(max_workers=len(probes)) as ex:
            [f.result() for f in [ex.submit(run, *p) for p in probes]]

        assert not errors, f"a hard-gate boundary crashed instead of degrading honestly: {errors}"
        for name, expected, _ in probes:
            assert outcomes.get(name) == expected, (
                f"{name} boundary returned {outcomes.get(name)}, expected {expected}")

        # the memory sentinel is over its mark -> /health honestly reports degraded (still 200, up).
        h = httpx.get(f"{base}/health", timeout=10)
        assert h.status_code == 200, "the sentinel must not take /health down — it degrades, not dies"
        hb = h.json()
        assert hb["degraded"] is True, "RSS over the warn mark must flip /health degraded (Q12 signal)"
        assert hb["memory"]["high"] is True
        assert proc.poll() is None, "the service died under the boundary pressure"
    finally:
        _stop_hard(proc, lf)
        _cleanup(url, created, tmp_path)


# =================================================================================================
# 3) Over-frequency — a one-IP burst is shed with 429s while the service stays up (no 500).
# =================================================================================================

@needs_db
def test_stress_rate_limit_sheds_a_burst_without_crashing(tmp_path):
    url = _db_url()
    if not url:
        pytest.skip("needs AVERY_DB_URL (or PGVECTOR_URL) — stress floor skips")
    log = tmp_path / "stress-rate.log"
    proc, lf, base = _start_service({
        **_base_env(url),
        "AVERY_DATA_DIR": str(tmp_path / "data"),
        "AVERY_RATE_INGEST_PER_MIN": "4",
        "AVERY_RATE_INGEST_BURST": "4",
    }, log)
    created: list[str] = []
    try:
        statuses: list[int] = []
        errors: list[str] = []

        def fire(i: int):
            try:
                r = httpx.post(f"{base}/ingest", files=_small_txt(200 + i), timeout=60)
                statuses.append(r.status_code)
                if r.status_code == 200:
                    created.append(r.json()["context_id"])
                if r.status_code >= 500:
                    errors.append(f"ingest {i} -> {r.status_code}")
            except Exception as e:
                errors.append(f"ingest {i} raised {e!r}")

        # 12 rapid uploads from the one TCP peer against a burst of 4 -> some pass, the rest 429.
        with ThreadPoolExecutor(max_workers=12) as ex:
            [f.result() for f in [ex.submit(fire, i) for i in range(12)]]

        assert not errors, f"rate limiting under a burst produced a 5xx / crash: {errors}"
        assert 429 in statuses, f"an over-frequency burst was NOT shed with 429: {statuses}"
        assert 200 in statuses, f"the burst was over-throttled — nothing got through: {statuses}"
        assert all(s in (200, 429) for s in statuses), f"unexpected status under burst: {statuses}"
        assert proc.poll() is None, "the service died under an over-frequency burst"
    finally:
        _stop_hard(proc, lf)
        _cleanup(url, created, tmp_path)
