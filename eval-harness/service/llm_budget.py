"""feat-039 — the LLM spend gate (denial-of-wallet guard).

Readiness §2-D: `/ingest` is a PUBLIC URL and LLM extraction fans out one blocking `brain.respond()`
per document window. Nothing stopped a script loop (or a善意 company dropping a 300-page PDF) from
burning the whole month's M3 budget in an afternoon — the bill was the only signal.

This is a PER-PROCESS call ceiling `AVERY_LLM_CALL_BUDGET`. Once the process has made that many
extraction calls, further calls are refused and extraction DEGRADES HONESTLY to the offline heuristic
(the `/ingest` response says `extraction_mode="degraded"`) rather than silently burning tokens. Single
worker (Dockerfile pins one) => a process-global counter IS the tenant-agnostic ceiling; no external
store needed.

Default is UNLIMITED (budget <= 0): the gate is OPT-IN via env so the offline suite and the keyed
seed-gate behave exactly as before until Danny sets a ceiling in the ECS runbook. When set, the
`BudgetedBrain` wrapper charges one unit per model call and raises `BudgetExceeded` on the call that
would cross the ceiling — `LLMExtractor` already catches any exception per-doc and falls back to the
heuristic, so a mid-batch exhaustion degrades cleanly.
"""
from __future__ import annotations

import logging
import os
import threading

log = logging.getLogger("service.llm_budget")

_lock = threading.Lock()
_calls = 0


class BudgetExceeded(RuntimeError):
    """Raised by BudgetedBrain when a model call would cross the per-process LLM-call ceiling."""


def budget() -> int:
    """The configured ceiling. <= 0 (the default) means UNLIMITED — the gate is disabled."""
    try:
        return int(str(os.environ.get("AVERY_LLM_CALL_BUDGET", "")).strip() or 0)
    except ValueError:
        return 0


def unlimited() -> bool:
    return budget() <= 0


def used() -> int:
    with _lock:
        return _calls


def remaining() -> int | None:
    """Calls left before the gate trips, or None when unlimited (for /health observability)."""
    if unlimited():
        return None
    with _lock:
        return max(0, budget() - _calls)


def exhausted() -> bool:
    if unlimited():
        return False
    with _lock:
        return _calls >= budget()


def charge(n: int = 1) -> None:
    global _calls
    with _lock:
        _calls += n


def reset() -> None:
    """Zero the counter (tests + a fresh deploy)."""
    global _calls
    with _lock:
        _calls = 0


class BudgetedBrain:
    """Wrap an extraction brain so every `respond()` charges the process LLM-call budget and raises
    `BudgetExceeded` once the ceiling is reached. Transparent otherwise (name + any attribute the
    extractor touches pass through)."""

    def __init__(self, inner):
        self._inner = inner
        self.name = getattr(inner, "name", "extract")

    def respond(self, *args, **kwargs):
        if exhausted():
            log.warning(
                "LLM call budget exhausted (%s/%s) — extraction degrades to the offline heuristic "
                "instead of burning tokens (denial-of-wallet guard)", used(), budget())
            raise BudgetExceeded(f"LLM call budget exhausted ({used()}/{budget()})")
        charge(1)
        return self._inner.respond(*args, **kwargs)

    def __getattr__(self, item):
        # anything the extractor reads that we don't shadow (e.g. with_options) goes to the inner brain
        return getattr(self._inner, item)
