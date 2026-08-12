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

from . import failover, llm_budget
from .brain_factory import DEEPSEEK_BASE_URL, DEEPSEEK_MODEL, failover_enabled

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


def extraction_chain() -> list[str]:
    """#89 — the ordered provider chain extraction will ACTUALLY walk: primary first, then every
    OTHER keyed provider (failover). [] when extraction is heuristic (forced or keyless).
    /health reports this so「热备到底armed没有」在生产上可核，不靠读代码。"""
    if resolve_extractor_kind() == "heuristic":
        return []
    primary = _extraction_brain_kind()
    if primary is None or not (os.environ.get(_KEY_ENV[primary]) or "").strip():
        return []
    chain = [primary]
    if failover_enabled():
        chain += [k for k in _EXTRACTION_BRAINS
                  if k != primary and (os.environ.get(_KEY_ENV[k]) or "").strip()]
    return chain


# One extraction window must answer within this budget or the window retries/falls back —
# a hung provider call must never hang an /ingest request indefinitely.
_EXTRACT_TIMEOUT_S = float(os.environ.get("AVERY_EXTRACT_TIMEOUT_S", "240"))


def _extract_backoff_s() -> float:
    """#89 — the per-window retry backoff LLMExtractor sleeps between attempts. Env-tunable so the
    offline integration tests (local fake 429 provider) don't spend 6s asleep per window; the 2.0s
    production default is unchanged."""
    try:
        return float(os.environ.get("AVERY_EXTRACT_BACKOFF_S", "2.0"))
    except (TypeError, ValueError):
        return 2.0


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

    # #89 · 供应商链：主脑失败换下一家（0811 的 39 小时 429 期间 DeepSeek key 就在 env 里躺着）。
    # 每家各包各的 BudgetedBrain——预算数的是**真发生的供应商调用**（一次 failover = 2 次计费），
    # 与 0805 走查定下的口径一致；BudgetExceeded 由 FallbackBrain 原样上抛（不 failover，见其碑）。
    chain: list[tuple[str, object]] = []
    for k in extraction_chain():
        try:
            chain.append((k, llm_budget.BudgetedBrain(_make_extraction_brain(k))))
        except Exception:
            continue                          # 这一家配置坏了就跳过；一家都不剩再落 heuristic
    if not chain:
        return HeuristicExtractor()
    return LLMExtractor(failover.FallbackBrain(chain), fallback=HeuristicExtractor(),
                        retry_backoff_s=_extract_backoff_s())


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
