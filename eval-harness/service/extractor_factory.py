"""Server-side extractor selection (mirrors brain_factory / embedding_factory). Keys stay here.

    AVERY_EXTRACTOR = auto        -> LLMExtractor when a real extraction brain key exists,
                                     else HeuristicExtractor              [default]
                    = llm         -> LLMExtractor (falls back to heuristic if no key)
                    = heuristic   -> HeuristicExtractor (forced offline — what the AFK gate pins)

    AVERY_EXTRACTOR_BRAIN = minimax | deepseek | openai   which provider does extraction (default:
                            the first of those, in that order, with a key). Reality check
                            (ADR-0022): 境内 the usable brains are M3 + DeepSeek; brain_factory's
                            `claude` is an unkeyed code path — never assumed here. #96 added
                            `openai` for the 欧盟/海外 path (OPENAI_API_KEY, gpt-5.6-luna).

Every failure mode degrades to the heuristic: no key, bad kind, SDK missing, model down. A
missing key can never break an upload — it just means today's conservative extraction.
"""
from __future__ import annotations

import logging
import os

from avery.brain import (
    MINIMAX_BASE_URL, MINIMAX_MODEL, OPENAI_EXTRACT_MODEL, OpenAICompatBrain,
)
from avery.ingest.extract import Extractor, HeuristicExtractor
from avery.ingest.llm_extract import LLMExtractor

from . import brain_factory, failover, llm_budget
from .brain_factory import (
    DEEPSEEK_BASE_URL, DEEPSEEK_MODEL, PROVIDER_REGION, failover_enabled,
)

log = logging.getLogger("service.extractor_factory")

# 顺序 = 「没指名时挑哪家」的优先级。境内两家在前是存量现实（生产一直是 M3 主 + DeepSeek 备）；
# openai 在后，所以给境内箱子加一把 OPENAI_API_KEY 不会掉换主脑。
_EXTRACTION_BRAINS = ("minimax", "deepseek", "openai")
_KEY_ENV = {"minimax": "MINIMAX_API_KEY", "deepseek": "DEEPSEEK_API_KEY"}


def _key_env(kind: str) -> str:
    """openai 的 key 变量名是可改的（AVERY_OPENAI_KEY_ENV），所以这里是函数不是常量表。"""
    if kind == "openai":
        return brain_factory.openai_key_env()
    return _KEY_ENV[kind]


def _keyed(kind: str) -> bool:
    return bool((os.environ.get(_key_env(kind)) or "").strip())


def resolve_extractor_kind() -> str:
    return (os.environ.get("AVERY_EXTRACTOR") or "auto").strip().lower()


def _extraction_brain_kind() -> str | None:
    """The provider extraction should use: explicit env first, else first one with a key."""
    explicit = brain_factory.canonical_kind(os.environ.get("AVERY_EXTRACTOR_BRAIN"))
    if explicit in _EXTRACTION_BRAINS:
        return explicit
    for kind in _EXTRACTION_BRAINS:
        if _keyed(kind):
            return kind
    return None


def extraction_chain() -> list[str]:
    """#89 — the ordered provider chain extraction will ACTUALLY walk: primary first, then every
    OTHER keyed provider (failover). [] when extraction is heuristic (forced or keyless).
    /health reports this so「热备到底armed没有」在生产上可核，不靠读代码。

    #96 · 热备只在**同一个 PROVIDER_REGION 内**发生。欧盟实例的一线纪律是 env 里根本没有中国 key
    （「没有」而非「不用」，答尽调才硬）+ AVERY_BRAIN_FAILOVER=off；这条 region 判据是第二把锁：
    万一哪天有人把一把 MINIMAX_API_KEY 落在欧盟箱子上，抽取也不会把欧盟客户的花名册 failover
    到境内供应商。合规是单向的——反过来（境内 failover 到 OpenAI）同样被这条挡住。"""
    if resolve_extractor_kind() == "heuristic":
        return []
    primary = _extraction_brain_kind()
    if primary is None or not _keyed(primary):
        return []
    chain = [primary]
    if failover_enabled():
        chain += [k for k in _EXTRACTION_BRAINS
                  if k != primary and PROVIDER_REGION[k] == PROVIDER_REGION[primary] and _keyed(k)]
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


# #96 · OpenAI 抽取位的输出上限。给足是**必须**的，不是保守：OpenAI 把不可见的 reasoning tokens
# 一起计进 max_completion_tokens——这正是 M3 的 <think> 占 max_tokens 那个老坑换了张皮重演。给小了
# 的症状是「模型全花在思考上、JSON 一个字没吐」，OpenAICompatBrain 会把它抛成错误（不是空答复），
# 抽取降级到 heuristic。真要压成本，拧 AVERY_OPENAI_REASONING_EFFORT，别拧这个数。
_OPENAI_EXTRACT_MAX_TOKENS = 32768


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
    elif kind == "openai":
        # 🔴 base_url/model 显式给非空值：OpenAICompatBrain 的构造默认落回 MINIMAX_*（见其碑）。
        brain = OpenAICompatBrain(
            name="extract-openai", api_key_env=brain_factory.openai_key_env(),
            base_url=brain_factory.openai_base_url(),
            model=((os.environ.get("AVERY_OPENAI_EXTRACT_MODEL") or "").strip()
                   or OPENAI_EXTRACT_MODEL),
            max_tokens=_OPENAI_EXTRACT_MAX_TOKENS, **brain_factory.openai_request_shape())
    elif kind == "deepseek":
        brain = OpenAICompatBrain(
            name="extract-deepseek", api_key_env="DEEPSEEK_API_KEY",
            base_url=os.environ.get("DEEPSEEK_BASE_URL", DEEPSEEK_BASE_URL),
            model=os.environ.get("DEEPSEEK_MODEL", DEEPSEEK_MODEL), max_tokens=8192)
    else:
        # 以前这里是 `else: <deepseek>`——加第三家时那个 else 会把 openai 静默构造成 DeepSeek。
        raise RuntimeError(f"unknown extraction brain kind {kind!r}")
    brain._client = brain._client.with_options(timeout=_EXTRACT_TIMEOUT_S)
    return brain


def make_extractor() -> Extractor:
    """Build the configured extractor. Never raises: any misconfiguration -> heuristic."""
    kind = resolve_extractor_kind()
    if kind == "heuristic":
        return HeuristicExtractor()

    brain_kind = _extraction_brain_kind()
    if brain_kind is None or not _keyed(brain_kind):
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
    if brain_kind is None or not _keyed(brain_kind):
        return "heuristic"
    return f"llm:{brain_kind}"
