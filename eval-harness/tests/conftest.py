# -*- coding: utf-8 -*-
"""#90 · offline-battery determinism: keep the ingest worker THREAD out of every test by default.

`with TestClient(app)` runs the FastAPI lifespan, which would start the in-process ingest worker —
and a live thread racing the test over the job queue makes every "assert the job is still queued /
assert the world before extraction" criterion flaky. The battery instead drives jobs
DETERMINISTICALLY via `service.ingest_worker.run_pending_jobs()` (claiming is atomic on both
registry legs, so a test that sets the switch back on and runs the real thread — the dedicated
thread-path test does — can never double-execute a job).

autouse + monkeypatch: each test gets the switch set to 'off' before its body runs; a test that
NEEDS the real thread overrides it inside its own body (its later setenv wins).

🔴 **这个 autouse fixture 会被 `subprocess.Popen(env={**os.environ, ...})` 继承出去** —— 而那正是
#93 收尾时逮到的那片暗区（4 条 `@needs_db` 自 #90 合入起一直红，没人看见）。起真 uvicorn 的
集成测试拿 `os.environ` 当子进程 env 的底座，于是**生产进程形状**里的 worker 线程也被这条
「离线电池确定性」开关按死了：字节落库、job 排着队、没有任何人去跑它，而测试还按 #90 之前的
同步语义断言「POST 回来时库里就该有东西」。两条出路都写在下面 —— 进程内用
`drain_ingest_jobs()`，起真进程的用 `SUBPROCESS_WORKER_ON` + `await_ingest_job()`。
"""
import time

import pytest

# 起真 uvicorn 的集成测试**必须**把这一份合进子进程 env：它们要验的正是「生产进程形状」，
# 而 worker 线程是那个形状的一部分（`AVERY_INGEST_WORKER` 的默认值就是 on，见 ingest_worker
# 的 kill switch 注释）。上面那条 autouse 把它关成了 off 并且会被子进程继承 —— 显式打开是
# 这一层唯一诚实的写法，比「让子进程碰巧继承到对的值」可靠。
SUBPROCESS_WORKER_ON = {"AVERY_INGEST_WORKER": "on"}


@pytest.fixture(autouse=True)
def _ingest_worker_off(monkeypatch):
    monkeypatch.setenv("AVERY_INGEST_WORKER", "off")


def drain_ingest_jobs(limit: int = 100) -> int:
    """进程内地把排队的 job 跑完，返回跑了几个 —— TestClient 那条路的「等抽取落地」。

    与 `test_ingest_async_90.py` 的 `_drain()` 是同一条：worker 线程被上面那条 autouse 关掉了，
    所以任何「POST /ingest 之后断言库里有东西」的判据，中间**必须**有这一步。
    """
    from service import ingest_worker
    return ingest_worker.run_pending_jobs(limit=limit)


def drain_and_assert_landed(context_id: str, limit: int = 100):
    """跑干队列，然后断言**这一个 context 自己**那条 job 落到了 `done`，并把它返回。

    🔴 判据不许写成 `drain_ingest_jobs() == 1`。`claim_next_ingest_job` 是**全局**取队首
    （生产单队列，语义正确），而 `avery.ingest_jobs` 刻意没有 FK（审计设计：删 context 不删 job）
    —— 共享测试库里别的用例留下的排队行会一起被跑掉，计数恒不等于 1。实测就是这么红的：
    `assert 6 == 1`。判据要落在**自己那条 job 的终态**上，不落在全局计数上。
    """
    import pytest as _pytest
    drain_ingest_jobs(limit=limit)
    from avery.ingest.registry import active_registry
    job = active_registry().latest_ingest_job(context_id)
    if job is None or job.status != "done":
        _pytest.fail(f"this context's ingest job did not land as done: {job}")
    return job


def await_ingest_job(httpx_mod, base: str, context_id: str, headers: dict,
                     *, timeout_s: float = 120.0) -> dict:
    """起真进程那条路的「等抽取落地」：轮询 `GET /team/{id}/files` 的任务摘要到终态。

    返回那条 `last_job`（`status` 必为 `done`）。**terminal 但 failed 会当场 fail**，而不是让
    调用方接着去断言一个空世界 —— 「抽取失败」和「还没跑完」是两件事，混起来的下场就是
    #90 之后那四条红：它们看到的都是「库里 0 行」，而病因完全不同。

    🔴 判据落在**任务状态**上，不落在「睡够久了」上：睡是墙上时钟赌注（progress.md 的钟碑），
    而任务摘要是服务自己说的话。`last_job` 缺席也算没跑完（job 表刚落、摘要还没读到）。
    """
    deadline = time.time() + timeout_s
    last = None
    while time.time() < deadline:
        r = httpx_mod.get(f"{base}/team/{context_id}/files", headers=headers, timeout=30)
        if r.status_code == 200:
            last = (r.json() or {}).get("last_job")
            if last and last.get("status") == "done":
                return last
            if last and last.get("status") == "failed":
                pytest.fail(f"the ingest job FAILED rather than landing: {last}")
        time.sleep(0.3)
    pytest.fail(f"the ingest job never reached a terminal state within {timeout_s}s "
                f"(last seen: {last}) — is the worker running in the subprocess? "
                f"(the autouse fixture in this file sets AVERY_INGEST_WORKER=off and "
                f"subprocess env inherits it — merge SUBPROCESS_WORKER_ON into the child env)")
