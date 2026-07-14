"""feat-039 — the memory sentinel (Danny Q12).

ECS hard constraint: production is ONE 2C/3.5G box with ~540M free, no swap, running ImaRead too.
Danny decided (Q12) NOT to pre-upsize; instead the backend watches its own RSS and, when it crosses a
high-water mark, BUBBLES UP a loud, structured signal ("MEMORY HIGH — consider upgrading ECS") so the
operator learns it is time to upsize BEFORE an OOM silently recycles the task (which would wipe the
in-memory registry / interrupt an extraction).

This module is the CODE half only. Wiring the container `--memory` cap + a healthcheck that reads the
degraded flag is feat-040 (deploy). Here we:

  * sample process RSS — via psutil when available, else a Linux cgroup v2/v1 file, else /proc/self/statm;
    if NONE of those work (a locked-down env) we degrade GRACEFULLY and report `available: false`
    rather than crashing;
  * when RSS >= `AVERY_MEM_WARN_MB` emit a structured WARN log and flip a process-global `high` flag;
  * expose `status()` for `/health` to surface a `degraded` signal to the operator.

The warn threshold is OPT-IN (`AVERY_MEM_WARN_MB` unset => sentinel inert, `high` always false) so the
offline suite and a default deploy are unaffected until the operator sets a mark. Sampling is done on a
REQUEST HOOK (/health + the write-path guard) — no background thread to manage; on a low-traffic
lead-gen box that is enough to catch a climbing RSS.
"""
from __future__ import annotations

import logging
import os
import threading

log = logging.getLogger("service.mem_sentinel")

_lock = threading.Lock()
_state: dict = {"rss_mb": None, "high": False}


def _read_rss_mb() -> float | None:
    """Best-effort process RSS in MiB, or None when no source is available."""
    # 1) psutil — accurate + cross-platform (Windows dev + Linux container).
    try:
        import psutil  # lazy: never required at import time / offline
        return psutil.Process().memory_info().rss / (1024 * 1024)
    except Exception:
        pass
    # 2) Linux cgroup (what the container actually sees) — v2 then v1.
    for path in ("/sys/fs/cgroup/memory.current",
                 "/sys/fs/cgroup/memory/memory.usage_in_bytes"):
        try:
            with open(path) as fh:
                return int(fh.read().strip()) / (1024 * 1024)
        except Exception:
            continue
    # 3) /proc/self/statm (Linux) — RSS is field 2, in pages.
    try:
        with open("/proc/self/statm") as fh:
            rss_pages = int(fh.read().split()[1])
        return rss_pages * os.sysconf("SC_PAGE_SIZE") / (1024 * 1024)
    except Exception:
        return None


def warn_mb() -> float | None:
    """The configured high-water mark in MiB, or None when the sentinel is disabled (unset)."""
    raw = str(os.environ.get("AVERY_MEM_WARN_MB", "")).strip()
    if not raw:
        return None
    try:
        return float(raw)
    except ValueError:
        return None


def sample() -> dict:
    """Take one RSS reading; WARN + flip `high` if it crossed the mark. Returns `status()`."""
    rss = _read_rss_mb()
    limit = warn_mb()
    high = rss is not None and limit is not None and rss >= limit
    if high:
        log.warning("MEMORY HIGH %.0fMB (warn>=%.0fMB) — consider upgrading ECS", rss, limit)
    with _lock:
        _state["rss_mb"] = None if rss is None else round(rss, 1)
        _state["high"] = bool(high)
    return status()


def status() -> dict:
    """The last sampled memory picture, for /health. `available` is False when RSS is unreadable."""
    with _lock:
        rss = _state["rss_mb"]
        high = _state["high"]
    return {"rss_mb": rss, "warn_mb": warn_mb(), "high": high, "available": rss is not None}


def reset() -> None:
    """Clear the sampled state (tests)."""
    with _lock:
        _state["rss_mb"] = None
        _state["high"] = False
