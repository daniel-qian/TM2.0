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
# input-side-0721: /demo/claim 也是无鉴权写面（每次 claim 都往库里落一份克隆）——给它自己的
# 表盘（AVERY_RATE_DEMO_PER_MIN，默认关，ECS runbook 调）。
_GUARDED: dict[str, str] = {"/ingest": "ingest", "/advise": "advise", "/demo/claim": "demo"}


# ── fixB/M2: the limits speak in units a person retypes ──────────────────────────────────────────
# The frontend used to carry its OWN copy of these numbers ("the server caps 10 files, 10MB each")
# and BOTH were wrong — the real caps are 15 files at 8 MiB, so the single-file number it printed was
# LARGER than the truth and a user obeying it retried into the same 413 forever. There is now one
# source of truth (guards.max_*), it is stated in the server's own 413 body, and the client repeats
# what the server said instead of remembering a third copy. Keeping the numbers human here is what
# makes that possible: "8388608-byte per-file limit" is not something anyone can act on.

def human_bytes(n: int) -> str:
    """A byte count as a person would say it ('8 MB', '32 MB', '900 KB')."""
    if n < 1024:
        return f"{n} B"
    for unit, scale in (("GB", 1024 ** 3), ("MB", 1024 ** 2), ("KB", 1024)):
        if n >= scale:
            value = n / scale
            return f"{value:.0f} {unit}" if abs(value - round(value)) < 0.05 else f"{value:.1f} {unit}"
    return f"{n} B"


def _route_for(path: str) -> str | None:
    """Rate-limit route key for a request path. feat-034 adds the Ask surfaces: every /ask
    manager endpoint shares one bucket ('ask'); the employee H5 (/r/{token} page + answer POST)
    shares another ('share') — the public, unauthenticated face gets its OWN dial."""
    exact = _GUARDED.get(path)
    if exact:
        return exact
    # T10 · 补资料：`POST /team/{id}/files` 与 `/ingest` 是**同一件事**（一批文件的字节走同一条
    # parse→抽取路），所以共用 'ingest' 那个表盘和那个总体积上限——上传口的防护不该因为多开一个
    # 入口就少一份。
    # 🔴 `_GUARDED` 是**精确匹配**的字典，带路径参数的路由永远命不中它。漏了这一条，新端点在 ASGI
    #    边缘就是零防护（无限流、无 Content-Length 预检、无流式总量兜底），而处理器内部的逐文件/
    #    逐批闸照旧生效——「看起来有闸」正是这种漏法最难被发现的原因。
    #    读侧不受影响：guarded 谓词（`is_guarded`）只对 POST/DELETE 起闸，`GET /team/{id}/files`
    #    （文件清单）与 `/team/{id}/files/{idx}`（下载）都照旧直通。
    if path.startswith("/team/") and path.endswith("/files"):
        return "ingest"
    # issue #77 · 删除一份资料：`DELETE /team/{id}/files/{source_key}`。它与补传是同一张写脸
    #（同一份资料库、同一个 owner_token 门），所以共用 'ingest' 那个表盘——写侧的限流不该因为
    # 多开一个入口就少一份。⚠ 这条 `in` 判定也会命中 `GET /team/{id}/files/{idx}`（下载），
    # 但下面的 `guarded` 只对 POST/DELETE 起闸，读侧照旧直通、行为逐字不变。
    if path.startswith("/team/") and "/files/" in path:
        return "ingest"
    # #86 ·「清空这份档案」：`POST /team/{id}/empty`。同一张写脸、同一个 owner_token 门，
    # 共用 'ingest' 那个表盘。它没有请求体，所以体积预检对它是空转——真正要的是**限流**：
    # 这是全站唯一一个一次调用就抹掉整个资料库的端点，边缘上零防护尤其不能接受。
    if path.startswith("/team/") and path.endswith("/empty"):
        return "ingest"
    if path == "/ask" or path.startswith("/ask/"):
        return "ask"
    if path.startswith("/r/"):
        return "share"
    # T1: 常驻表单的员工页（/f/{token} + 提交 POST）与快问员工页是同一张公开、无鉴权的脸，
    # 共用同一个 'share' 表盘 —— 公开面的限流不该因为多开一个入口就多一份配置。
    if path.startswith("/f/"):
        return "share"
    return None


def is_guarded(route: str | None, method: str) -> bool:
    """这条 (路由, 方法) 组合要不要过边缘闸。

    抽成具名函数是为了让它**可断言**：`_route_for` 只回答「这条路径属于哪个表盘」，而
    「读侧会不会被顺带闸住」是 route + method 两个量的函数。此前这段谓词内联在中间件里，
    测试只能去断言 `_route_for` 的返回值——于是 issue #77 给 `/team/{id}/files/{key}` 补路由
    时，一条本来该说「下载不受影响」的判据以「返回值变了」的形态红掉，看起来像回归，其实
    被测的那个行为一个字节没变。

    POST 每条路由都闸；DELETE 同理（#77 的删除口，它没有请求体，只吃限流那一半）；
    'share' 那条公开面连 GET 也闸——`/r/{token}` 是唯一一张无鉴权的脸（OG 抓取也会打它）。
    其余的 GET 一律直通：文件清单与逐份下载都在这一支。
    """
    if route is None:
        return False
    if method in ("POST", "DELETE"):
        return True
    return route == "share" and method == "GET"


# ── per-IP token-bucket rate limiter (in-memory, single-worker) ───────────────────────────────────

_buckets: dict[tuple[str, str], list] = {}   # (route, ip) -> [tokens: float, last_monotonic: float]
_rl_lock = threading.Lock()


def _rate_config(route: str) -> tuple[int, int]:
    """(requests-per-minute, burst) for a route. rpm <= 0 disables the limiter (default)."""
    if route == "ingest":
        rpm = guards._int_env("AVERY_RATE_INGEST_PER_MIN", 0)
        burst = guards._int_env("AVERY_RATE_INGEST_BURST", rpm or 1)
    elif route == "ask":       # feat-034: manager-side ask writes (create/save/share/revoke)
        rpm = guards._int_env("AVERY_RATE_ASK_PER_MIN", 0)
        burst = guards._int_env("AVERY_RATE_ASK_BURST", rpm or 1)
    elif route == "share":     # feat-034: the PUBLIC employee H5 (/r/{token} page + answer)
        rpm = guards._int_env("AVERY_RATE_SHARE_PER_MIN", 0)
        burst = guards._int_env("AVERY_RATE_SHARE_BURST", rpm or 1)
    elif route == "demo":      # input-side-0721: 一键示例团队（无鉴权、每 claim 落一份克隆）
        rpm = guards._int_env("AVERY_RATE_DEMO_PER_MIN", 0)
        burst = guards._int_env("AVERY_RATE_DEMO_BURST", rpm or 1)
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
    """The rate-limit key: the caller's real IP, chosen so a forged X-Forwarded-For CANNOT mint a
    fresh bucket per request (the DoS-bypass hole feat-039 closed).

    Default (`AVERY_TRUSTED_PROXY_HOPS` unset/0): trust ONLY the unspoofable TCP peer
    (`scope['client']`) and IGNORE X-Forwarded-For entirely. Behind the standard nginx
    `$proxy_add_x_forwarded_for` recipe the header is APPENDED to — the attacker's forged value stays
    LEFTMOST while the real client is appended on the right — so trusting the leftmost hop (the old
    behaviour) let a flood rotate XFF and evade the per-IP limit. The TCP peer is set by the kernel
    from the socket and cannot be spoofed over HTTP.

    Behind N trusted reverse proxies, set `AVERY_TRUSTED_PROXY_HOPS=N`: the real client is then the
    Nth XFF hop FROM THE RIGHT (each trusted proxy appends the address it received from). Anything to
    the left of that is attacker-controlled and ignored. If the header is shorter than N (misconfig
    or an attacker sending too few hops) we fall back to the TCP peer rather than trust a forged left
    value. NOTE: if the proxy instead REPLACES the header (`proxy_set_header X-Forwarded-For
    $remote_addr`) there is exactly one hop -> N=1."""
    client = scope.get("client")
    peer = client[0] if client else "unknown"
    hops = guards._int_env("AVERY_TRUSTED_PROXY_HOPS", 0)
    if hops <= 0:
        return peer   # trust only the TCP peer; XFF is not consulted (spoof-proof default)
    xff = _header(scope, b"x-forwarded-for")
    if not xff:
        return peer   # proxies expected but no XFF present -> the unspoofable peer
    parts = [p.strip() for p in xff.decode("latin-1").split(",") if p.strip()]
    if len(parts) >= hops:
        return parts[-hops]   # the Nth hop from the right = the real client behind N trusted proxies
    return peer       # XFF shorter than the trusted chain -> fall back to the peer, never the left


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


class IngestGuardMiddleware:
    """Edge guard: rate-limit + total-body cap on the guarded write paths. Pure ASGI so it can wrap
    `receive` to count streamed bytes (a BaseHTTPMiddleware cannot). Everything else passes through
    untouched (GET, /health, SSE /advise streaming)."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope.get("type") != "http":
            return await self.app(scope, receive, send)
        route = _route_for(scope.get("path", ""))
        method = scope.get("method", "GET").upper()
        # POST is guarded on every route; the employee H5 ('share') guards its GET too — the
        # /r/{token} page is the one PUBLIC unauthenticated surface (OG unfurlers hit it as well).
        if not is_guarded(route, method):
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
                "detail": f"too many {route} requests from your address - slow down and retry"})

        # 体积闸只对**带请求体的上传**有意义。DELETE 走到这里已经吃过限流，没有 body 可量。
        if route != "ingest" or method != "POST":
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
                        "detail": (f"this upload is {human_bytes(int(cl))} — the limit is "
                                   f"{human_bytes(max_total)} per upload. Send fewer files at once.")})
            except ValueError:
                pass

        # 2b) streamed backstop (chunked / lying Content-Length): count bytes, abort before RAM fills.
        # On overflow the MIDDLEWARE sends the honest 413 ITSELF and hands the app an http.disconnect,
        # rather than raising an exception up through the ASGI app — because FastAPI's multipart parser
        # would catch that exception and turn it into a misleading 400 "error parsing the body" (the
        # client that hit the size cap must see a truthful 413). Once we've responded we swallow any
        # response the app still tries to emit reacting to the disconnect.
        counted = {"total": 0}
        overflowed = {"v": False}
        responded = {"v": False}

        async def guarded_receive():
            if overflowed["v"]:
                return {"type": "http.disconnect"}   # body already refused; unwind the app
            msg = await receive()
            if msg.get("type") == "http.request":
                counted["total"] += len(msg.get("body", b"") or b"")
                if counted["total"] > max_total:
                    overflowed["v"] = True
                    log.warning("upload streamed body exceeded cap %s -> 413", max_total)
                    await _send_json(send, 413, {
                        "error": "upload too large",
                        "detail": (f"this upload went over the {human_bytes(max_total)} limit for a "
                                   f"single upload. Send fewer files at once.")})
                    responded["v"] = True
                    return {"type": "http.disconnect"}
            return msg

        async def guarded_send(message):
            if responded["v"]:
                return   # our 413 is already on the wire; drop the app's own (400) response
            await send(message)

        try:
            return await self.app(scope, guarded_receive, guarded_send)
        except Exception:
            if responded["v"]:
                return   # the app raised reacting to the disconnect; the 413 is already sent
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
                "detail": (f"'{display}' is bigger than the {human_bytes(per_file)} per-file "
                           f"limit."),
                "filename": display})
        chunks.append(chunk)
    return b"".join(chunks)


def enforce_count(n_files: int) -> None:
    """Refuse (413) a batch with more files than the per-request cap."""
    limit = guards.max_files()
    if n_files > limit:
        raise HTTPException(status_code=413, detail={
            "error": "too many files",
            "detail": (f"{n_files} files at once — the limit is {limit} per upload. "
                       f"Send them in smaller batches.")})


# ── fixB/m6: an OLE2 file wearing an OOXML extension is not necessarily a liar ───────────────────
# `guards.check_type` sees a .xlsx that does not start with `PK` and reports "magic-byte mismatch",
# which the UI renders as an accusation: we are telling a customer they renamed a file to sneak it
# past us. Two ordinary, honest files land in that branch:
#
#   1. A PASSWORD-PROTECTED xlsx/docx. Excel's "Encrypt with Password" does not produce an encrypted
#      zip — it wraps the whole OOXML package inside an OLE2/CFB container (ECMA-376 agile
#      encryption). It is a completely valid file that we simply cannot open without the password.
#      Finance and HR spreadsheets — precisely the files this product asks for — are routinely sent
#      this way.
#   2. A LEGACY .xls/.doc that someone renamed. Still the wrong file for us, but the fix we should be
#      naming is "re-save it as .xlsx", not "stop lying about your file".
#
# Both are OLE2 (D0 CF 11 E0 ...). The encrypted case is told apart by the stream names ECMA-376
# mandates, which the CFB directory stores as UTF-16LE — so a plain substring search identifies it
# without parsing the container.
_OLE2_MAGIC = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"
_ENCRYPTED_OOXML_MARKERS: tuple[bytes, ...] = (
    "EncryptedPackage".encode("utf-16-le"),
    "EncryptionInfo".encode("utf-16-le"),
)


def office_container_reason(display: str, data: bytes) -> str | None:
    """A truthful reason to refuse an OLE2 file that claims to be .docx/.xlsx, or None if this is not
    that case. Says what the file IS and what to do about it — never that the user faked it."""
    ext = guards.resolve_ext(display)
    if ext not in guards._ZIP_EXTS or not data.startswith(_OLE2_MAGIC):
        return None
    if any(marker in data for marker in _ENCRYPTED_OOXML_MARKERS):
        return (f"'{display}' is password-protected, so it can't be opened for reading. "
                f"Save a copy without the password and upload that instead.")
    legacy = ".xls" if ext == "xlsx" else ".doc"
    return (f"'{display}' is in the older {legacy} format, which can't be read even though it is "
            f"named .{ext}. Open it and use Save As to save a real .{ext}, then upload that.")


def enforce_type_and_archive(display: str, data: bytes) -> None:
    """Refuse a DISGUISED type (415) or a zip/decompression bomb (413), before parse. An unsupported
    extension is left to the downstream parse-fail path (feat-032 marks it 'failed')."""
    # fixB/m6: run BEFORE check_type, so the honest explanation wins over the forgery accusation for
    # the OLE2 cases. Everything else falls through to check_type unchanged.
    container = office_container_reason(display, data)
    if container:
        raise HTTPException(status_code=415, detail={
            "error": "unsupported upload", "detail": container, "filename": display})
    reason = guards.check_type(display, data)
    if reason:
        raise HTTPException(status_code=415, detail={
            "error": "unsupported upload", "detail": reason, "filename": display})
    if guards.resolve_ext(display) in guards._ZIP_EXTS:
        bomb = guards.archive_reason(data)
        if bomb:
            raise HTTPException(status_code=413, detail={
                "error": "upload rejected", "detail": bomb, "filename": display})
