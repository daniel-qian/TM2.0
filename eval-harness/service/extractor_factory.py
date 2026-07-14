"""Server-side extractor selection (mirrors brain_factory / embedding_factory). Keys stay here.

    AVERY_EXTRACTOR = auto        -> LLMExtractor when a real extraction brain key exists,
                                     else HeuristicExtractor              [default]
                    = llm         -> LLMExtractor (falls back to heuristic if no key)
                    = heuristic   -> HeuristicExtractor (forced offline — what the AFK gate pins)

    AVERY_EXTRACTOR_BRAIN = minimax | deepseek   which provider does extraction (default: the
                            first of minimax/deepseek with a key). Reality check (ADR-0022): the
                            usable brains are M3 + DeepSeek; brain_factory's `claude` is an
                            unkeyed code path — never assumed here.

Every failure mode degrades to the heuristic: no key, bad kind, SDK missing, model down. A
missing key can never break an upload — it just means today's conservative extraction.
"""
from __future__ import annotations

import logging
import os

from avery.brain import MINIMAX_BASE_URL, MINIMAX_MODEL, OpenAICompatBrain
from avery.ingest.extract import Extractor, HeuristicExtractor
from avery.ingest.llm_extract import LLMExtractor

from . import llm_budget
from .brain_factory import DEEPSEEK_BASE_URL, DEEPSEEK_MODEL

log = logging.getLogger("service.extractor_factory")

_EXTRACTION_BRAINS = ("minimax", "deepseek")   # reality: M3 + DeepSeek only
_KEY_ENV = {"minimax": "MINIMAX_API_KEY", "deepseek": "DEEPSEEK_API_KEY"}


def resolve_extractor_kind() -> str:
    return (os.environ.get("AVERY_EXTRACTOR") or "auto").strip().lower()


def _extraction_brain_kind() -> str | None:
    """The provider extraction should use: explicit env first, else first one with a key."""
    explicit = (os.environ.get("AVERY_EXTRACTOR_BRAIN") or "").strip().lower()
    if explicit in _EXTRACTION_BRAINS:
        return explicit
    for kind in _EXTRACTION_BRAINS:
        if (os.environ.get(_KEY_ENV[kind]) or "").strip():
            return kind
    return None


# One extraction window must answer within this budget or the window retries/falls back —
# a hung provider call must never hang an /ingest request indefinitely.
_EXTRACT_TIMEOUT_S = float(os.environ.get("AVERY_EXTRACT_TIMEOUT_S", "240"))


def _make_extraction_brain(kind: str):
    """The extraction call is one-shot structured output on a REASONING model (M3 thinks in
    <think> tokens that count against max_tokens) — give it a far larger output budget than the
    conversational default so the JSON tail never truncates mid-document, and a hard per-call
    timeout so a stalled provider degrades to fallback instead of hanging the upload."""
    if kind == "minimax":
        brain = OpenAICompatBrain(
            name="extract-minimax", api_key_env="MINIMAX_API_KEY",
            base_url=os.environ.get("MINIMAX_BASE_URL", MINIMAX_BASE_URL),
            model=os.environ.get("MINIMAX_MODEL", MINIMAX_MODEL), max_tokens=32768)
    else:
        brain = OpenAICompatBrain(
            name="extract-deepseek", api_key_env="DEEPSEEK_API_KEY",
            base_url=os.environ.get("DEEPSEEK_BASE_URL", DEEPSEEK_BASE_URL),
            model=os.environ.get("DEEPSEEK_MODEL", DEEPSEEK_MODEL), max_tokens=8192)
    brain._client = brain._client.with_options(timeout=_EXTRACT_TIMEOUT_S)
    return brain


def make_extractor() -> Extractor:
    """Build the configured extractor. Never raises: any misconfiguration -> heuristic."""
    kind = resolve_extractor_kind()
    if kind == "heuristic":
        return HeuristicExtractor()

    brain_kind = _extraction_brain_kind()
    if brain_kind is None or not (os.environ.get(_KEY_ENV[brain_kind]) or "").strip():
        return HeuristicExtractor()           # no usable key -> offline behavior, AFK-green

    # feat-039 spend gate: if the per-process LLM call budget is already spent, don't even build the
    # brain — degrade HONESTLY to the heuristic and TAG it so extraction_mode reports 'degraded'
    # (a tagged heuristic is not the same signal as a natively-heuristic deploy).
    if llm_budget.exhausted():
        log.warning("LLM call budget exhausted before extraction — using the heuristic (degraded)")
        h = HeuristicExtractor()
        h._avery_degraded = "llm_budget_exhausted"   # type: ignore[attr-defined]
        return h

    try:
        brain = _make_extraction_brain(brain_kind)
    except Exception:
        return HeuristicExtractor()
    # Wrap the brain so every model call charges the budget and trips the gate mid-batch (the
    # LLMExtractor catches the BudgetExceeded per-doc and falls back to the heuristic -> degraded).
    return LLMExtractor(llm_budget.BudgetedBrain(brain), fallback=HeuristicExtractor())


def extraction_mode(extractor: Extractor) -> str:
    """feat-039 — the honest label the /ingest response carries (readiness §2-G2/W):

        llm       — a real model extracted every document,
        degraded  — a model was configured but ≥1 document fell back to the heuristic (429 / red-line
                    breach / no entities / budget exhausted), OR the budget was spent up front,
        heuristic — the offline heuristic (no key / AVERY_EXTRACTOR=heuristic) — a natively-keyless
                    deploy, NOT a silent fallback.
    """
    if isinstance(extractor, LLMExtractor):
        return "degraded" if extractor.degraded else "llm"
    if getattr(extractor, "_avery_degraded", None):
        return "degraded"
    return "heuristic"


def active_extractor() -> str:
    """What extraction will ACTUALLY use, accounting for missing keys. For /health + gates."""
    kind = resolve_extractor_kind()
    if kind == "heuristic":
        return "heuristic"
    brain_kind = _extraction_brain_kind()
    if brain_kind is None or not (os.environ.get(_KEY_ENV[brain_kind]) or "").strip():
        return "heuristic"
    return f"llm:{brain_kind}"
