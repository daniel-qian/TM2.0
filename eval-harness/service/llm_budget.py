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

0805 生产走查修闸 — WHO IS COVERED (the counting-point audit that walkthrough-0805 triggered):
  * extractor        — BudgetedBrain since feat-039 (extractor_factory.make_extractor). The 4 units
                       the walkthrough saw burn were exactly these (3 hotel docs + 1 garbage txt),
                       NOT the 4 /advise turns — a numeric coincidence that inverted the report's
                       attribution.
  * /ask drafting    — BudgetedBrain since feat-034 (ask_api.generate_questions).
  * /advise loop     — covered NOW (service/app.py `_run_events`). It was the actual hole: one
                       advise turn is an agentic loop of up to MAX_ITERS(12) model calls, none of
                       them charged, on an endpoint whose rate limit defaults to off.
  * embeddings       — covered NOW, on a SEPARATE counter (`AVERY_EMBED_CALL_BUDGET`, below).
                       DashScope calls are ~2 orders cheaper than an M3 chat call, so mixing them
                       into `llm_calls_remaining` would corrupt the one number Danny already watches
                       in production; they get their own ceiling + /health field instead. The gate
                       hooks `DashScopeEmbedder._embed_batch` itself (via
                       `avery.embeddings.install_spend_gate`), so EVERY construction path — the
                       service factory, `active_registry()`'s own resolver — is covered; offline
                       fakes (HashingEmbedder) never touch it.
"""
from __future__ import annotations

import logging
import os
import threading

log = logging.getLogger("service.llm_budget")

_lock = threading.Lock()
_calls = 0
_embed_calls = 0


class BudgetExceeded(RuntimeError):
    """Raised by BudgetedBrain when a model call would cross the per-process LLM-call ceiling."""


class EmbedBudgetExceeded(RuntimeError):
    """Raised by the embed spend gate when a DashScope batch would cross AVERY_EMBED_CALL_BUDGET.
    Every caller already degrades: memory.recall -> keyword, pipeline/pg_registry -> NULL vectors."""


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


# ── the embeddings ceiling (separate counter — see the module docstring for why) ─────────────────

def embed_budget() -> int:
    """The configured embeddings ceiling. <= 0 (the default) means UNLIMITED — gate disabled."""
    try:
        return int(str(os.environ.get("AVERY_EMBED_CALL_BUDGET", "")).strip() or 0)
    except ValueError:
        return 0


def embed_unlimited() -> bool:
    return embed_budget() <= 0


def embed_used() -> int:
    with _lock:
        return _embed_calls


def embed_remaining() -> int | None:
    """Embedding batches left before the gate trips, or None when unlimited (for /health)."""
    if embed_unlimited():
        return None
    with _lock:
        return max(0, embed_budget() - _embed_calls)


def embed_exhausted() -> bool:
    if embed_unlimited():
        return False
    with _lock:
        return _embed_calls >= embed_budget()


def charge_embed(n: int = 1) -> None:
    global _embed_calls
    with _lock:
        _embed_calls += n


def embed_spend_gate(batch_size: int) -> None:
    """The callable `service/embedding_factory` installs into `avery.embeddings` at import time
    (core defines the seam, the service plugs its per-process counter in — avery never imports
    service). Called once per billable DashScope HTTP batch (<=10 texts), BEFORE the request:
    charge one unit, or raise once the ceiling is spent so the caller degrades to keyword."""
    if embed_exhausted():
        log.warning(
            "embedding call budget exhausted (%s/%s) — retrieval degrades to keyword instead of "
            "burning tokens (denial-of-wallet guard)", embed_used(), embed_budget())
        raise EmbedBudgetExceeded(
            f"embedding call budget exhausted ({embed_used()}/{embed_budget()})")
    charge_embed(1)


def reset() -> None:
    """Zero both counters (tests + a fresh deploy)."""
    global _calls, _embed_calls
    with _lock:
        _calls = 0
        _embed_calls = 0


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
