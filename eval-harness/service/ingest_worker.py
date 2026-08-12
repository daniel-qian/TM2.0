# -*- coding: utf-8 -*-
"""#90 · the in-process ingest worker — "理解" runs here, decoupled from the HTTP request.

The deposit endpoints (POST /ingest · POST /team/{id}/files) land bytes + a `queued` IngestJob in
one atomic registry step and return in seconds; THIS module drives the other half of the seam:

    claim (queued -> processing) ──▶ rebuild the batch from stored bytes ──▶ parse ──▶
    extract (LLM) ──▶ merge ──▶ put  ──▶ finish (done / failed)

The engine functions are the UNCHANGED ones the synchronous era ran (`ingest_paths`,
`append_paths_to_context` — red-line gate, granularity gate, merge ledger all inside); the worker
only moved WHERE they run. `demo.py`'s master casting still calls `ingest_paths` directly and never
passes through here (票面明令：母本自铸保持同步).

FAILURE SEMANTICS — "failed = 这批文件没进资料库", the async twin of the synchronous 422:
a red-line refusal / an all-unparseable batch / an unexpected crash marks the job `failed` with an
honest reason AND drops this batch's still-'reading' file rows. The synchronous era answered 422
and persisted nothing; the async era answers via the job summary and keeps the manifest equally
clean. (A PARTIALLY unparseable batch keeps today's behavior exactly: the failed file lands as a
'failed' row via `_finalize_source_documents`, the rest ingest normally.)

THREADING — one daemon worker thread per process (the single-worker deploy constraint), plus
`run_pending_jobs()` as a synchronous driver: the offline battery calls it for determinism (no
thread, no race), ops can call it as a hand crank when the thread is disabled. Both paths share
`claim_next_ingest_job`, which is atomic on both registry legs (a lock in-memory, FOR UPDATE SKIP
LOCKED on pg) — a job can never double-execute.

`AVERY_INGEST_WORKER=off` is the ops kill switch (the AVERY_BRAIN_FAILOVER=off precedent): the
thread does not start and startup orphan recovery is skipped — "this process does not touch jobs".
Deposits still land (bytes are safe, jobs stay queued); flip it back on and the queue drains.
"""
from __future__ import annotations

import logging
import os
import tempfile
import threading
import time
from pathlib import Path

from avery.ingest import ingest_paths
from avery.ingest.file_append import append_paths_to_context
from avery.ingest.registry import IngestJob, SourceDocument, active_registry

from . import embedding_factory, extractor_factory

log = logging.getLogger("service.ingest_worker")

_POLL_SECONDS = 0.5     # idle claim cadence; wake() short-circuits it after every deposit


def worker_enabled() -> bool:
    """The AVERY_INGEST_WORKER kill switch — anything but 'off' means on (default on)."""
    return (os.environ.get("AVERY_INGEST_WORKER", "") or "").strip().lower() != "off"


# ── job execution ─────────────────────────────────────────────────────────────────────────────────

def _rebuild_batch(reg, ctx, file_keys: list[str]) -> list[SourceDocument]:
    """The worker-side copies of this job's deposited files: metadata from the 'reading' rows,
    content pulled through the download seam (the pg get() deliberately never carries bytea).
    A key whose bytes vanished (deleted mid-flight) is skipped — the batch degrades honestly."""
    keys = set(file_keys)
    out: list[SourceDocument] = []
    for idx, sd in enumerate(ctx.source_documents):
        key = sd.source_key or sd.filename
        if key not in keys or sd.status != "reading":
            continue
        data = sd.content if sd.content is not None else reg.source_document_bytes(
            ctx.context_id, idx)
        if data is None:
            log.warning("job batch key %r has no stored bytes — skipping that file", key)
            continue
        out.append(SourceDocument(
            filename=sd.filename, source_key=sd.source_key, mime=sd.mime,
            size_bytes=sd.size_bytes, doc_kind=sd.doc_kind, status="reading",
            uploaded_at=sd.uploaded_at, content=bytes(data),
            content_sha256=sd.content_sha256))
    return out


def _write_batch(tmp_dir: str, batch: list[SourceDocument]) -> list[Path]:
    """Deposited bytes -> on-disk files for the parser. The basename IS the source_key (already a
    safe, disambiguated basename from _unique_parse_names) — parse names and source_keys must be
    the same string, they are two halves of the '<key>:<line>' citation contract."""
    paths: list[Path] = []
    for sd in batch:
        dest = Path(tmp_dir) / (sd.source_key or sd.filename)
        dest.write_bytes(sd.content or b"")
        paths.append(dest)
    return paths


def _drop_reading_rows(reg, job: IngestJob) -> None:
    """failed = 这批文件没进资料库：collect this batch's still-'reading' rows back out of the
    manifest (the async twin of the synchronous 422 that persisted nothing). Terminal rows are
    real data and are never touched. In-place splice + put — the extraction was never mutated on
    a failure path (file_append 命门③), so the red-line gate re-passes by construction."""
    ctx = reg.get(job.context_id)
    if ctx is None:
        return
    keys = set(job.file_keys)
    kept = [sd for sd in ctx.source_documents
            if sd.status != "reading" or (sd.source_key or sd.filename) not in keys]
    if len(kept) == len(ctx.source_documents):
        return
    ctx.source_documents[:] = kept
    reg.put(ctx)


def _refusal_reason(report) -> str:
    """One honest sentence for the job row — same discrimination the synchronous 422 body made."""
    if report.violations:
        return "red line: a person-scoring/ranking field was extracted"
    reason = "no parseable content in the upload"
    errors = list(getattr(report, "parse_errors", []) or [])
    if errors:
        reason += " — " + "; ".join(str(e) for e in errors[:3])
    return reason[:500]


def _execute_ingest(reg, job: IngestJob) -> None:
    ctx = reg.get(job.context_id)
    if ctx is None:
        reg.finish_ingest_job(job.id, status="failed",
                              reason="context vanished before extraction")
        return
    batch = _rebuild_batch(reg, ctx, job.file_keys)
    if not batch:
        _drop_reading_rows(reg, job)
        reg.finish_ingest_job(job.id, status="failed",
                              reason="uploaded bytes are no longer available")
        return
    # Same factory pair the synchronous handler built (feat-023/031): extractor telemetry feeds the
    # honest #89 label; the vector path opens only for a persistent registry with an embedder.
    extractor = extractor_factory.make_extractor()
    embedder = embedding_factory.make_embedder()
    prefer_vector = embedder is not None and getattr(reg, "persistent", False)
    with tempfile.TemporaryDirectory(prefix="avery-job-") as tmp:
        paths = _write_batch(tmp, batch)
        report = ingest_paths(
            [str(p) for p in paths], registry=reg, name=ctx.name, extractor=extractor,
            embedder=embedder if prefer_vector else None, prefer_vector=prefer_vector,
            source_documents=batch, owner_token=ctx.owner_token, context_id=job.context_id)
    mode = extractor_factory.extraction_mode(extractor)
    if not report.ok or report.context is None:
        _drop_reading_rows(reg, job)
        reg.finish_ingest_job(job.id, status="failed", reason=_refusal_reason(report),
                              extraction_mode=mode)
        return
    reg.finish_ingest_job(job.id, status="done", extraction_mode=mode)


def _execute_append(reg, job: IngestJob) -> None:
    ctx = reg.get(job.context_id)
    if ctx is None:
        reg.finish_ingest_job(job.id, status="failed",
                              reason="context vanished before extraction")
        return
    batch = _rebuild_batch(reg, ctx, job.file_keys)
    if not batch:
        _drop_reading_rows(reg, job)
        reg.finish_ingest_job(job.id, status="failed",
                              reason="uploaded bytes are no longer available")
        return
    extractor = extractor_factory.make_extractor()
    with tempfile.TemporaryDirectory(prefix="avery-job-") as tmp:
        paths = _write_batch(tmp, batch)
        # reserved_keys: this batch's keys are OURS (pre-hung as 'reading'), not "already taken" —
        # append_docs_to_context swaps the skeleton rows for finalized ones (file_append #90 note).
        report = append_paths_to_context(
            reg, job.context_id, [str(p) for p in paths], batch, extractor=extractor,
            reserved_keys={(sd.source_key or sd.filename) for sd in batch})
    mode = extractor_factory.extraction_mode(extractor)
    if not report.ok or report.context is None:
        _drop_reading_rows(reg, job)
        reg.finish_ingest_job(job.id, status="failed", reason=_refusal_reason(report),
                              extraction_mode=mode)
        return
    reg.finish_ingest_job(job.id, status="done", extraction_mode=mode)


def _execute_job(job: IngestJob) -> None:
    """Run one claimed job to a terminal state. NEVER raises — an unexpected crash lands as an
    honest `failed` row (the whole point: no silent spinner, no stuck 'processing')."""
    reg = active_registry()
    t0 = time.perf_counter()
    try:
        if job.kind == "ingest":
            _execute_ingest(reg, job)
        elif job.kind == "append":
            _execute_append(reg, job)
        else:
            reg.finish_ingest_job(job.id, status="failed",
                                  reason=f"unknown job kind {job.kind!r}")
    except Exception as e:   # noqa: BLE001 — the terminal state must land no matter what broke
        log.exception("ingest job %s (%s) crashed", job.id, job.kind)
        try:
            _drop_reading_rows(reg, job)
            reg.finish_ingest_job(job.id, status="failed",
                                  reason=f"{type(e).__name__}: {str(e)[:300]}")
        except Exception:   # noqa: BLE001 — nothing left to do but say so
            log.exception("could not mark ingest job %s failed", job.id)
    final = None
    try:
        final = reg.latest_ingest_job(job.context_id)
    except Exception:   # noqa: BLE001 — the summary log must not mask the job outcome
        pass
    log.info("ingest-job job=%s kind=%s context_id=%s files=%d status=%s elapsed_ms=%.0f",
             job.id, job.kind, job.context_id, len(job.file_keys),
             final.status if final is not None and final.id == job.id else "unknown",
             (time.perf_counter() - t0) * 1000)


def run_pending_jobs(limit: int = 100) -> int:
    """Synchronously drain queued jobs (up to `limit`); returns how many ran. THE deterministic
    driver for the offline battery, and the ops hand crank when the thread is off. Safe next to a
    live worker thread: claiming is atomic on both legs, so a job runs exactly once."""
    ran = 0
    while ran < limit:
        job = active_registry().claim_next_ingest_job()
        if job is None:
            break
        _execute_job(job)
        ran += 1
    return ran


# ── the worker thread ─────────────────────────────────────────────────────────────────────────────

class _Worker(threading.Thread):
    daemon = True   # never blocks interpreter exit; lifespan stops it politely first

    def __init__(self) -> None:
        super().__init__(name="avery-ingest-worker")
        self.stop_event = threading.Event()
        self.wake_event = threading.Event()

    def run(self) -> None:   # pragma: no cover — the loop shell; execution paths are unit-driven
        log.info("ingest worker started")
        while not self.stop_event.is_set():
            try:
                job = active_registry().claim_next_ingest_job()
            except Exception:   # noqa: BLE001 — a DB hiccup must not kill the thread
                log.exception("claiming the next ingest job failed; retrying")
                job = None
            if job is not None:
                _execute_job(job)
                continue        # drain back-to-back without waiting
            self.wake_event.wait(_POLL_SECONDS)
            self.wake_event.clear()
        log.info("ingest worker stopped")


_worker: _Worker | None = None
_worker_lock = threading.Lock()


def ensure_worker_started() -> bool:
    """Start (or restart) the singleton worker thread. False when the kill switch is off."""
    global _worker
    if not worker_enabled():
        return False
    with _worker_lock:
        if _worker is None or not _worker.is_alive():
            _worker = _Worker()
            _worker.start()
    return True


def stop_worker(timeout: float = 2.0) -> None:
    """Politely stop the worker (lifespan shutdown). A mid-flight job keeps running on the daemon
    thread until process exit — if the process dies with it, startup orphan recovery marks it
    `failed: server restarted`, which is exactly the honest answer."""
    global _worker
    with _worker_lock:
        w = _worker
        _worker = None
    if w is not None and w.is_alive():
        w.stop_event.set()
        w.wake_event.set()
        w.join(timeout)


def wake() -> None:
    """Nudge the worker right after a deposit so the queue never waits out a poll interval."""
    w = _worker
    if w is not None:
        w.wake_event.set()
