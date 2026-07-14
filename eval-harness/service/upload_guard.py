"""feat-039 — the HTTP edge of the upload hard-gate: an ASGI guard middleware + handler helpers.

Two defences that must run at the EDGE (before the body is materialised) live in the ASGI middleware:

  * per-IP RATE LIMIT (in-memory token bucket) on POST /ingest (and optionally /advise) -> 429. Single
    worker => an in-process bucket keyed by client IP IS the limiter; no Redis needed. OPT-IN via env
    (default off) so the offline suite — many /ingest calls from one 'testclient' IP in one process —
    stays green; the ECS runbook sets `AVERY_RATE_INGEST_PER_MIN`.
  * total-body SIZE CAP on POST /ingest -> 413. A Content-Length pre-check refuses an oversize upload
    BEFORE a single byte is read into RAM (the honest-client path); a streamed byte counter is the
    backstop for a chunked / Content-Length-lying client. Guards the ~540M ECS box from OOM.

Per-FILE size / count / type / zip-bomb checks need the parsed multipart, so they run INSIDE the
handler (`enforce_file`, `read_capped`) and raise `HTTPException` — kept here so the handler stays thin
and the whole gate is unit-testable. All limits come from `avery.ingest.guards` (read dynamically).
"""
from __future__ import annotations

import json
import logging
import threading
import time

from fastapi import HTTPException, UploadFile

from avery.ingest import guards
from . import mem_sentinel

log = logging.getLogger("service.upload_guard")

# Guarded write paths -> the rate-limit "route" key (separate buckets/limits per route).
_GUARDED: dict[str, str] = {"/ingest": "ingest", "/advise": "advise"}


# ── per-IP token-bucket rate limiter (in-memory, single-worker) ───────────────────────────────────

_buckets: dict[tuple[str, str], list] = {}   # (route, ip) -> [tokens: float, last_monotonic: float]
_rl_lock = threading.Lock()


def _rate_config(route: str) -> tuple[int, int]:
    """(requests-per-minute, burst) for a route. rpm <= 0 disables the limiter (default)."""
    if route == "ingest":
        rpm = guards._int_env("AVERY_RATE_INGEST_PER_MIN", 0)
        burst = guards._int_env("AVERY_RATE_INGEST_BURST", rpm or 1)
    else:
        rpm = guards._int_env("AVERY_RATE_ADVISE_PER_MIN", 0)
        burst = guards._int_env("AVERY_RATE_ADVISE_BURST", rpm or 1)
    return rpm, max(1, burst)


def allow(route: str, ip: str) -> bool:
    """Consume one token for (route, ip). True if allowed, False if the bucket is empty (-> 429)."""
    rpm, burst = _rate_config(route)
    if rpm <= 0:
        return True  # disabled
    rate_per_s = rpm / 60.0
    now = time.monotonic()
    with _rl_lock:
        bucket = _buckets.get((route, ip))
        if bucket is None:
            bucket = [float(burst), now]
            _buckets[(route, ip)] = bucket
        tokens = min(float(burst), bucket[0] + (now - bucket[1]) * rate_per_s)
        bucket[1] = now
        if tokens >= 1.0:
            bucket[0] = tokens - 1.0
            return True
        bucket[0] = tokens
        return False


def reset_rate_limiter() -> None:
    """Drop all buckets (tests)."""
    with _rl_lock:
        _buckets.clear()


def _client_ip(scope) -> str:
    """The caller IP. Honours the FIRST X-Forwarded-For hop (the runbook terminates TLS at a reverse
    proxy that sets it), else the transport peer. XFF is spoofable if the deploy is NOT behind a
    trusted proxy — acceptable for a lean lead-gen box; documented in the session handoff."""
    headers = dict(scope.get("headers") or [])
    xff = headers.get(b"x-forwarded-for")
    if xff:
        first = xff.decode("latin-1").split(",")[0].strip()
        if first:
            return first
    client = scope.get("client")
    return client[0] if client else "unknown"


def _header(scope, name: bytes) -> bytes | None:
    for k, v in (scope.get("headers") or []):
        if k == name:
            return v
    return None


async def _send_json(send, status: int, payload: dict) -> None:
    body = json.dumps(payload).encode("utf-8")
    await send({"type": "http.response.start", "status": status,
                "headers": [(b"content-type", b"application/json"),
                            (b"content-length", str(len(body)).encode())]})
    await send({"type": "http.response.body", "body": body})


class _BodyTooLarge(Exception):
    pass


class IngestGuardMiddleware:
    """Edge guard: rate-limit + total-body cap on the guarded write paths. Pure ASGI so it can wrap
    `receive` to count streamed bytes (a BaseHTTPMiddleware cannot). Everything else passes through
    untouched (GET, /health, SSE /advise streaming)."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope.get("type") != "http":
            return await self.app(scope, receive, send)
        route = _GUARDED.get(scope.get("path", ""))
        if route is None or scope.get("method", "GET").upper() != "POST":
            return await self.app(scope, receive, send)

        # Opportunistic memory sample on write traffic (cheap; the /health hook also samples).
        try:
            mem_sentinel.sample()
        except Exception:  # pragma: no cover - never let the sentinel break a request
            pass

        # 1) rate limit (both guarded routes)
        if not allow(route, _client_ip(scope)):
            log.warning("rate limit: %s from %s -> 429", route, _client_ip(scope))
            return await _send_json(send, 429, {
                "error": "rate limited",
                "detail": f"too many {route} requests from your address — slow down and retry"})

        if route != "ingest":
            return await self.app(scope, receive, send)

        # 2) total-body size cap (ingest only)
        max_total = guards.max_total_bytes()
        cl = _header(scope, b"content-length")
        if cl is not None:
            try:
                if int(cl) > max_total:
                    log.warning("upload Content-Length %s > cap %s -> 413", int(cl), max_total)
                    return await _send_json(send, 413, {
                        "error": "upload too large",
                        "detail": (f"request body {int(cl)} bytes exceeds the {max_total}-byte "
                                   f"per-request limit")})
            except ValueError:
                pass

        # 2b) streamed backstop (chunked / lying Content-Length): count bytes, abort before RAM fills.
        counted = {"total": 0}
        started = {"v": False}

        async def guarded_receive():
            msg = await receive()
            if msg.get("type") == "http.request":
                counted["total"] += len(msg.get("body", b"") or b"")
                if counted["total"] > max_total:
                    raise _BodyTooLarge()
            return msg

        async def guarded_send(message):
            if message.get("type") == "http.response.start":
                started["v"] = True
            await send(message)

        try:
            return await self.app(scope, guarded_receive, guarded_send)
        except _BodyTooLarge:
            log.warning("upload streamed body exceeded cap %s -> 413", max_total)
            if not started["v"]:
                return await _send_json(send, 413, {
                    "error": "upload too large",
                    "detail": f"request body exceeded the {max_total}-byte per-request limit"})
            raise


# ── in-handler per-file enforcement (needs the parsed multipart) ──────────────────────────────────

async def read_capped(f: UploadFile, display: str, per_file: int) -> bytes:
    """Read an UploadFile in bounded chunks, refusing (413) the moment it exceeds the per-file cap —
    so a single oversize file never lands as one huge bytes object in RAM (at most cap + one chunk)."""
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = await f.read(65536)
        if not chunk:
            break
        total += len(chunk)
        if total > per_file:
            raise HTTPException(status_code=413, detail={
                "error": "file too large",
                "detail": f"'{display}' exceeds the {per_file}-byte per-file limit",
                "filename": display})
        chunks.append(chunk)
    return b"".join(chunks)


def enforce_count(n_files: int) -> None:
    """Refuse (413) a batch with more files than the per-request cap."""
    limit = guards.max_files()
    if n_files > limit:
        raise HTTPException(status_code=413, detail={
            "error": "too many files",
            "detail": f"{n_files} files exceeds the per-request limit of {limit}"})


def enforce_type_and_archive(display: str, data: bytes) -> None:
    """Refuse a DISGUISED type (415) or a zip/decompression bomb (413), before parse. An unsupported
    extension is left to the downstream parse-fail path (feat-032 marks it 'failed')."""
    reason = guards.check_type(display, data)
    if reason:
        raise HTTPException(status_code=415, detail={
            "error": "unsupported upload", "detail": reason, "filename": display})
    if guards.resolve_ext(display) in guards._ZIP_EXTS:
        bomb = guards.archive_reason(data)
        if bomb:
            raise HTTPException(status_code=413, detail={
                "error": "upload rejected", "detail": bomb, "filename": display})
