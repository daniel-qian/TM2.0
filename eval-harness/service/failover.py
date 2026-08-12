"""#89 — provider failover + passive provider telemetry (the two halves of "one vendor must not
take the product down, and when it does, /health must not lie about it").

2026-08-11 的真事故：MiniMax Token Plan 用尽，生产连续 39 小时每次抽取 429。DEEPSEEK_API_KEY
当时**就躺在生产 env 里**，但 extractor_factory / brain_factory 都是「取第一家有 key 的」——
第二家从没被问过一次。同窗口 /health 恒 `degraded:false`：它只看进程内预算计数器
（llm_budget.exhausted()），从不知道供应商在拒绝我们。

两个部件：

  * `FallbackBrain` — 把有序的 (label, brain) 链包成一个 Brain。逐家试，供应商性失败换下一家，
    全链失败把**最后一个**异常原样抛出（调用方的降级路径不变：LLMExtractor 落 heuristic、
    /advise 落 error 事件）。链长 1 也值得包：它同时是遥测的记录点——单供应商部署也因此
    在 /health 上有了 `providers` 真相。
  * `record / snapshot` — 被动遥测。只记「最近一次真调用」的成败 + 时刻 + 摘要，绝不主动探测
    （/health 是 Docker HEALTHCHECK 的 30s 热路径，一次真调用 = 每天 2880 次纯烧钱）。
    被动的代价是「刚重启时一无所知」——snapshot 里没有的供应商就是没被问过，/health 对
    unknown 保持沉默（ok=null），绝不把「不知道」翻译成「好」或「坏」。

🔴 BudgetExceeded 不触发 failover 也不记为供应商失败：那是**我们自己**的花钱闸
（llm_budget 是进程全局计数器），换一家供应商只会再充一次电费然后撞同一堵墙。原样上抛，
让既有的 degrade 路径接手（extractor 落 heuristic + extraction_mode='degraded'；advise 出
干净的 error 事件）。
"""
from __future__ import annotations

import logging
import threading
from datetime import datetime, timezone

from .llm_budget import BudgetExceeded

log = logging.getLogger("service.failover")

_lock = threading.Lock()
# label -> {"ok": bool, "detail": str, "at": iso8601}  —— 只有被真调用过的供应商才有条目。
_state: dict[str, dict] = {}


def record(provider: str, ok: bool, detail: str = "") -> None:
    with _lock:
        _state[provider] = {
            "ok": ok,
            "detail": (detail or "")[:200],
            "at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        }


def snapshot() -> dict[str, dict]:
    """A copy of the last-known per-provider outcome. Empty when nothing was called yet."""
    with _lock:
        return {k: dict(v) for k, v in _state.items()}


def reset() -> None:
    """Tests only — a fresh process starts empty anyway."""
    with _lock:
        _state.clear()


def all_known_bad(providers: list[str]) -> bool:
    """True ONLY when every provider in `providers` has been called AND its last call failed.
    An unknown (never-called) provider makes this False — fresh boots must not cry wolf."""
    if not providers:
        return False
    snap = snapshot()
    return all(p in snap and snap[p]["ok"] is False for p in providers)


class FallbackBrain:
    """An ordered chain of brains behind the one `Brain` seam (avery/brain.py Protocol).

    `chain` is a list of (label, brain). Every attempt is recorded to the telemetry above.
    Anything the caller reads off the brain that we don't shadow (`.name`, `._client`…) delegates
    to the PRIMARY — the chain must be a drop-in for the single brain it replaces.
    """

    def __init__(self, chain: list[tuple[str, object]]):
        if not chain:
            raise ValueError("FallbackBrain needs at least one (label, brain)")
        self._chain = list(chain)
        self.name = getattr(chain[0][1], "name", chain[0][0])

    @property
    def labels(self) -> list[str]:
        return [label for label, _ in self._chain]

    def respond(self, *args, **kwargs):
        last: Exception | None = None
        for i, (label, brain) in enumerate(self._chain):
            try:
                out = brain.respond(*args, **kwargs)
            except BudgetExceeded:
                raise                      # 我们自己的闸——不是供应商坏，也别再花第二家的钱
            except Exception as e:         # noqa: BLE001 — provider surface is heterogeneous
                record(label, False, f"{type(e).__name__}: {str(e)[:150]}")
                last = e
                if i + 1 < len(self._chain):
                    log.warning("provider %s failed (%s: %s) — failing over to %s",
                                label, type(e).__name__, str(e)[:150], self._chain[i + 1][0])
                continue
            record(label, True)
            return out
        assert last is not None
        raise last

    def __getattr__(self, item):
        return getattr(self._chain[0][1], item)
