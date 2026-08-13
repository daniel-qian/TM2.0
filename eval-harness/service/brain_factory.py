"""Server-side brain selection. Keys stay here — never toward the frontend.

The service picks a brain from env, mirroring the pluggable-brain design already in
`avery/brain.py` (境内 MiniMax/DeepSeek · 海外 Claude). Nothing here is exposed to a client; the
frontend only ever sees SSE events, never a key or a provider credential.

    AVERY_BRAIN = mock      -> MockBrain (deterministic, no key)   [default, AFK-safe]
                = minimax   -> OpenAICompatBrain on MiniMax-M3     (MINIMAX_API_KEY)
                = deepseek  -> OpenAICompatBrain on DeepSeek       (DEEPSEEK_API_KEY)
                = claude    -> RealBrain claude-opus-4-8           (ANTHROPIC_API_KEY)
                = openai-compat | openai -> OpenAICompatBrain on OpenAI (OPENAI_API_KEY), 全 env 可调

`make_brain` needs the `case` only for the mock brain (it replays the case's MOCK block); real
brains ignore it.
"""
from __future__ import annotations

import logging
import os

from avery.brain import (
    MINIMAX_BASE_URL, MINIMAX_MODEL, OPENAI_BASE_URL, OPENAI_MODEL, Brain, OpenAICompatBrain,
    make_mock_brain,
)

logger = logging.getLogger(__name__)

DEEPSEEK_BASE_URL = "https://api.deepseek.com/v1"
DEEPSEEK_MODEL = "deepseek-chat"

# #96 · OpenAI 那条路的三个别名（历史上 `openai-compat` 是「任意兼容端点」的逃生口，现在它的
# **默认**指向 OpenAI 官方；接别家兼容端点仍然只需设 AVERY_OPENAI_BASE_URL/MODEL）。
OPENAI_KINDS = ("openai-compat", "openai", "compat")

# 供应商的「地理家族」。热备只在同家族内发生：欧盟实例的用户内容绝不许 failover 回境内供应商
# （合规是单向的，反过来也一样别糊）。EU 实例的一线纪律是 env 里根本没有中国 key + FAILOVER=off，
# 这条闸是第二把锁——纪律靠人执行，闸不靠。
PROVIDER_REGION = {"minimax": "cn", "deepseek": "cn", "claude": "intl", "openai": "intl"}

# feat-028: bound every /advise brain CALL. Without this the advisor brain inherited the SDK default
# (read/write/pool = 600s), so a hung provider ties up the worker/threadpool for ~10 min and hangs
# the app. Mirror the extractor's AVERY_EXTRACT_TIMEOUT_S pattern — env-configurable, sane default.
ADVISE_TIMEOUT_S_DEFAULT = 180.0


def _advise_timeout_s() -> float:
    try:
        return float(os.environ.get("AVERY_ADVISE_TIMEOUT_S", ADVISE_TIMEOUT_S_DEFAULT))
    except (TypeError, ValueError):
        return ADVISE_TIMEOUT_S_DEFAULT


def _with_timeout(brain: Brain) -> Brain:
    """Apply a bounded per-call timeout to a real brain's HTTP client (OpenAI/Anthropic SDK clients
    both support `.with_options(timeout=...)`). The mock brain has no `_client` and is returned
    untouched — it is pure/local and never makes a network call, so it is explicitly whitelisted
    out of the warning below (otherwise the offline test suite, which builds MockBrain constantly,
    would get spammed).

    Any OTHER brain that lands here without a bindable client is a silent gap — it will make real
    network calls with no timeout bound (the SDK default is 600s read/write/pool), so we log a
    warning instead of quietly returning it untouched."""
    client = getattr(brain, "_client", None)
    if client is not None and hasattr(client, "with_options"):
        brain._client = client.with_options(timeout=_advise_timeout_s())
    elif type(brain).__name__ != "MockBrain":
        logger.warning(
            "brain_factory._with_timeout: %s has no bindable `_client.with_options` — "
            "this brain is NOT bounded by AVERY_ADVISE_TIMEOUT_S and can hang the worker "
            "for the SDK default (~600s) on a stalled provider.",
            type(brain).__name__,
        )
    return brain


def failover_enabled() -> bool:
    """#89 — the ops kill-switch for provider failover (default ON). `AVERY_BRAIN_FAILOVER=off`
    pins every path back to single-provider behavior (worth having when a secondary starts
    answering garbage and「不答」比「答坏」诚实)."""
    return (os.environ.get("AVERY_BRAIN_FAILOVER") or "on").strip().lower() not in (
        "off", "0", "false", "no")


def canonical_kind(kind: str | None) -> str:
    """`openai-compat` / `compat` / `openai` 是同一条路的三个写法——归一到 `openai`。
    不归一的话，AVERY_BRAIN=openai-compat + AVERY_EXTRACTOR_BRAIN=openai 会在 /health 的
    `providers` 表里长出**两个 key 指同一家供应商**，「到底谁坏了」当场失真（#89 立那张表就是
    为了不撒谎）。"""
    kind = (kind or "").strip().lower()
    return "openai" if kind in OPENAI_KINDS else kind


def resolve_brain_kind() -> str:
    return canonical_kind(os.environ.get("AVERY_BRAIN") or "mock")


# ── #96 · OpenAI 的 env 面（advise 与抽取共用；抽取只额外换模型 + 输出预算）────────────────────

def openai_key_env() -> str:
    """Which env var holds the OpenAI key. `AVERY_OPENAI_KEY_ENV` renames it (a host that already
    uses OPENAI_API_KEY for something else can point Avery at its own name)."""
    return (os.environ.get("AVERY_OPENAI_KEY_ENV") or "").strip() or "OPENAI_API_KEY"


def openai_base_url() -> str:
    return (os.environ.get("AVERY_OPENAI_BASE_URL") or "").strip() or OPENAI_BASE_URL


def _openai_temperature() -> float | None:
    """None = 不发 temperature（OpenAI 推理模型只接受默认值，显式传 0 直接 400）。设
    `AVERY_OPENAI_TEMPERATURE` 才发——留给不是推理模型的第三方兼容端点。"""
    raw = (os.environ.get("AVERY_OPENAI_TEMPERATURE") or "").strip()
    if not raw:
        return None
    try:
        return float(raw)
    except ValueError:
        logger.warning("AVERY_OPENAI_TEMPERATURE=%r is not a number — sending no temperature", raw)
        return None


def openai_request_shape() -> dict:
    """The parameter-shape kwargs for an OpenAI-family `OpenAICompatBrain` (见其 docstring)。
    `AVERY_OPENAI_TOKEN_PARAM=max_tokens` 是给只认老名字的第三方兼容端点的逃生口。"""
    return {
        "token_param": ((os.environ.get("AVERY_OPENAI_TOKEN_PARAM") or "").strip()
                        or "max_completion_tokens"),
        "temperature": _openai_temperature(),
        "reasoning_effort": (os.environ.get("AVERY_OPENAI_REASONING_EFFORT") or "").strip() or None,
    }


# #89 · 互为热备的那一对（境内现实：M3 + DeepSeek）。claude / openai 没有指定的第二家，
# 仍包 FallbackBrain（链长 1）——为的是遥测：/health 的 providers 真相来自这层记录点。
# 🔴 #96：往这里加**跨 PROVIDER_REGION 的一对**就是合规事故（欧盟实例的 /advise 会把用户内容
#    发去境内供应商）。要加热备只在同 region 内加。
_PAIR = {"minimax": "deepseek", "deepseek": "minimax"}
_PAIR_KEY_ENV = {"minimax": "MINIMAX_API_KEY", "deepseek": "DEEPSEEK_API_KEY"}


def advise_chain(kind: str | None = None) -> list[str]:
    """The ordered provider chain /advise (and /ask · form drafting) will actually walk.
    ['mock'] 在 mock 下；真脑 = 主脑 + （若 armed 且对家有 key）对家。/health 用它自证。"""
    kind = canonical_kind(kind) or resolve_brain_kind()
    if kind == "mock":
        return ["mock"]
    chain = [kind]
    other = _PAIR.get(kind)
    if (failover_enabled() and other
            and (os.environ.get(_PAIR_KEY_ENV[other]) or "").strip()):
        chain.append(other)
    return chain


def brain_is_live() -> bool:
    """True when the configured brain is a real provider (not the deterministic mock)."""
    return resolve_brain_kind() != "mock"


def _make_single(kind: str) -> Brain:
    """One real brain for `kind`, timeout-bounded. Raises RuntimeError on unknown kind/missing key."""
    kind = canonical_kind(kind)
    if kind == "minimax":
        return _with_timeout(OpenAICompatBrain(
            name="avery-minimax", api_key_env="MINIMAX_API_KEY",
            base_url=os.environ.get("MINIMAX_BASE_URL", MINIMAX_BASE_URL),
            model=os.environ.get("MINIMAX_MODEL", MINIMAX_MODEL)))

    if kind == "deepseek":
        return _with_timeout(OpenAICompatBrain(
            name="avery-deepseek", api_key_env="DEEPSEEK_API_KEY",
            base_url=os.environ.get("DEEPSEEK_BASE_URL", DEEPSEEK_BASE_URL),
            model=os.environ.get("DEEPSEEK_MODEL", DEEPSEEK_MODEL)))

    if kind == "claude":
        from avery.brain import RealBrain
        return _with_timeout(RealBrain(name="avery-opus"))

    if kind == "openai":
        # OpenAI 官方端点（欧盟/海外路径），也是任意 OpenAI 兼容端点的通用出口。
        # 🔴 base_url / model 必须**显式**给非空值：OpenAICompatBrain 的构造默认落回 MINIMAX_*，
        #    传 None 就是「配了 OpenAI，实际把用户内容发给 MiniMax」——静默、且正好是欧盟线要堵的
        #    那个出境点。这两个 `or` 是那道闸，别删。
        return _with_timeout(OpenAICompatBrain(
            name="avery-openai", api_key_env=openai_key_env(),
            base_url=openai_base_url(),
            model=(os.environ.get("AVERY_OPENAI_MODEL") or "").strip() or OPENAI_MODEL,
            **openai_request_shape()))

    raise RuntimeError(f"unknown AVERY_BRAIN={kind!r} "
                       f"(expected mock | minimax | deepseek | claude | openai-compat | openai)")


def make_brain(case, kind: str | None = None) -> Brain:
    """Build the brain named by `kind` (or AVERY_BRAIN). Raises RuntimeError with a clear message
    when a real brain is requested but its key/SDK is missing (caller maps to a clean HTTP error).

    #89: every REAL brain comes back wrapped in `failover.FallbackBrain` — minimax/deepseek get
    each other as hot standby (when the other key exists and AVERY_BRAIN_FAILOVER isn't off);
    everything else is a chain of one, which still buys the /health provider telemetry. The mock
    brain is never wrapped (pure/local, and the offline suite's determinism depends on it).
    此 seam 同时覆盖 /advise、/ask 起草、表单起草——三个调用方都从这里拿脑子。
    """
    kind = canonical_kind(kind) or resolve_brain_kind()

    if kind == "mock":
        return make_mock_brain(case, "avery")   # pure/local — no client, no timeout to bound

    from . import failover
    chain: list[tuple[str, Brain]] = [(kind, _make_single(kind))]
    for other in advise_chain(kind)[1:]:
        try:
            chain.append((other, _make_single(other)))
        except RuntimeError:
            logger.warning("failover secondary %s is configured but unbuildable — chain of 1", other)
    return failover.FallbackBrain(chain)
