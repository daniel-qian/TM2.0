"""Pluggable text embeddings + semantic ranking (the vector seam behind `memory.recall`).

`memory.py` retrieves company facts by keyword today; its own docstring promised "swap in a vector
index later behind this same signature with zero loop changes." THIS is that swap-in: a small,
dependency-free embedding client + a cosine ranker that operates over the SAME line-addressable
candidates keyword recall uses, so a `recall()` hit is still `facts.md:<line>` and the cite gate is
untouched. Keyword stays the offline/no-key fallback.

Design mirrors the pluggable brain / pluggable ingest store:
  * `Embedder`         — structural protocol: `.name` + `.embed(list[str]) -> list[list[float]]`.
  * `DashScopeEmbedder`— real provider: Alibaba Bailian (百炼) text-embedding-v4, OpenAI-compatible
                         endpoint, stdlib urllib only (no SDK dep). Keys stay server-side.
  * `OpenAIEmbedder`   — #96, the 欧盟/海外 provider: OpenAI text-embedding-3-small with
                         `dimensions=1024`, which lands on the SAME `avery.materials.embedding
                         vector(1024)` column — zero schema/migration change.
  * `HashingEmbedder`  — re-exported from the ingest store: deterministic, offline, NON-semantic
                         stand-in so the vector CODE PATH runs in tests without a service.

⚠ 换 embedder ≠ 换个开关：向量空间不兼容，已有 context 的旧向量在换家之后是**废的**（余弦
算出来是噪声），必须重嵌入。新库/新 context 无此问题。

The advisor never sees a key: the service builds the embedder from env (`service/embedding_factory`)
and threads it into the loop. If embedding fails at answer time, callers fall back to keyword — a
live endpoint hiccup can never break an advise turn.
"""
from __future__ import annotations

import json
import math
import os
import urllib.request
from typing import Protocol, Sequence, runtime_checkable

# NOTE: pure stdlib on purpose — a CORE module (memory.py) depends on this, so it must NOT pull in
# avery.ingest (backwards coupling) or any office/vector lib. The deterministic HashingEmbedder for
# tests lives in avery.ingest.store; duck-typing (the Embedder protocol) lets it drop in here.


@runtime_checkable
class Embedder(Protocol):
    name: str
    def embed(self, texts: list[str]) -> list[list[float]]: ...


# --- Bailian / DashScope real embedder --------------------------------------------------------

# 0805 走查修闸: the billable-embedding spend gate. The SERVICE owns the per-process spend counter
# (service/llm_budget), but this core module must not import `service` (same one-way rule the
# module docstring already lives by), and embedders are constructed from more than one place
# (service/embedding_factory AND registry.active_registry's own make_embedder_from_env). So the
# seam is injected: the service installs its gate here at import time, and DashScopeEmbedder
# consults it before EVERY billable HTTP batch — whoever built the instance. None (the default,
# and the offline suite's reality) = no gate, exactly the pre-existing behavior. Offline fakes
# (HashingEmbedder) never touch this: only the real DashScope HTTP path is billable.
_SPEND_GATE = None  # Callable[[int], None] — called with the batch size; raises to refuse the call


def install_spend_gate(gate) -> None:
    """Install (or clear, with None) the process-wide billable-embedding gate."""
    global _SPEND_GATE
    _SPEND_GATE = gate


DASHSCOPE_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1"
DASHSCOPE_EMBED_MODEL = "text-embedding-v4"
DASHSCOPE_EMBED_DIM = 1024
_DASHSCOPE_BATCH = 10  # compatible-mode embeddings cap inputs per request; chunk conservatively

# #96 — OpenAI 官方 embeddings（欧盟/海外）。`dimensions=1024` 是刻意选的：它正好落在既有的
# `avery.materials.embedding vector(1024)` 列上，所以换 provider **不动 schema、不写迁移**。
OPENAI_EMBED_BASE_URL = "https://api.openai.com/v1"
OPENAI_EMBED_MODEL = "text-embedding-3-small"
OPENAI_EMBED_DIM = 1024
_OPENAI_BATCH = 64     # OpenAI 允许 2048 条/请求；保守分批（一批 = 一次计费单位，见 spend gate）


def _l2_normalize(v: Sequence[float]) -> list[float]:
    norm = math.sqrt(sum(x * x for x in v)) or 1.0
    return [x / norm for x in v]


class _OpenAICompatEmbedder:
    """The shared body of every real embedder we run: an OpenAI-shaped `POST /embeddings`
    (`model` / `input` / `dimensions` / `encoding_format`) over stdlib urllib — no SDK dep, because
    a CORE module (memory.py) depends on this file.

    Subclasses only supply defaults + a `provider` label. Keeping ONE implementation is deliberate:
    the billable-spend gate (0805 走查修闸) is a single hook in `_embed_batch`, so a second provider
    cannot ship with the gate quietly missing on its own copy. Outputs are L2-normalized here so
    downstream cosine is a plain dot product.
    """

    provider = "openai-compat"
    default_model = ""
    default_dim = 1024
    default_base_url = ""
    batch_size = 10

    def __init__(self, api_key: str, *, model: str | None = None, dim: int | None = None,
                 base_url: str | None = None, timeout: float = 30.0) -> None:
        if not api_key:
            raise ValueError(f"{type(self).__name__} needs a non-empty api_key")
        self._api_key = api_key
        self.model = model or self.default_model
        self.dim = int(dim) if dim else self.default_dim
        self.base_url = (base_url or self.default_base_url).rstrip("/")
        self.timeout = timeout

    @property
    def name(self) -> str:
        return f"{self.provider}:{self.model}/{self.dim}"

    def _embed_batch(self, texts: list[str]) -> list[list[float]]:
        if _SPEND_GATE is not None:   # 0805 走查修闸: charge/refuse BEFORE the billable request
            _SPEND_GATE(len(texts))
        body = json.dumps({
            "model": self.model,
            "input": texts,
            "dimensions": self.dim,
            "encoding_format": "float",
        }).encode("utf-8")
        req = urllib.request.Request(
            f"{self.base_url}/embeddings", data=body, method="POST",
            headers={"Authorization": f"Bearer {self._api_key}",
                     "Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=self.timeout) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
        # Order by `.index` — the API may not preserve input order across a batch.
        rows = sorted(payload["data"], key=lambda d: d.get("index", 0))
        return [_l2_normalize(r["embedding"]) for r in rows]

    def embed(self, texts: list[str]) -> list[list[float]]:
        out: list[list[float]] = []
        for i in range(0, len(texts), self.batch_size):
            out.extend(self._embed_batch(texts[i:i + self.batch_size]))
        return out


class DashScopeEmbedder(_OpenAICompatEmbedder):
    """Alibaba Bailian text-embedding-v4 via the OpenAI-compatible endpoint (stdlib HTTP only).

    Pure text, 100+ languages (covers 境内 ZH + 海外 EN in ONE index), 1024-dim default. Batches of
    <=10 inputs per call.
    """

    provider = "dashscope"
    default_model = DASHSCOPE_EMBED_MODEL
    default_dim = DASHSCOPE_EMBED_DIM
    default_base_url = DASHSCOPE_BASE_URL
    batch_size = _DASHSCOPE_BATCH


class OpenAIEmbedder(_OpenAICompatEmbedder):
    """#96 — OpenAI text-embedding-3-small at `dimensions=1024` (欧盟/海外 index).

    Same 1024-dim column as DashScope by construction, so switching providers is a config change,
    not a migration. It is NOT a data-compatible change though: the two models' vector spaces are
    unrelated, so an existing context's stored vectors must be re-embedded after a switch.
    """

    provider = "openai"
    default_model = OPENAI_EMBED_MODEL
    default_dim = OPENAI_EMBED_DIM
    default_base_url = OPENAI_EMBED_BASE_URL
    batch_size = _OPENAI_BATCH


def make_dashscope_embedder(*, env: dict | None = None) -> DashScopeEmbedder | None:
    """Build a DashScopeEmbedder from env, or None when no key is set (caller -> keyword fallback)."""
    env = env if env is not None else os.environ
    key = (env.get("DASHSCOPE_API_KEY") or "").strip()
    if not key:
        return None
    return DashScopeEmbedder(
        api_key=key,
        model=env.get("AVERY_EMBED_MODEL", DASHSCOPE_EMBED_MODEL),
        dim=int(env.get("AVERY_EMBED_DIM", str(DASHSCOPE_EMBED_DIM))),
        base_url=env.get("DASHSCOPE_BASE_URL", DASHSCOPE_BASE_URL),
    )


def make_openai_embedder(*, env: dict | None = None) -> OpenAIEmbedder | None:
    """Build an OpenAIEmbedder from env, or None when no key is set (caller -> keyword fallback).

    ⚠ `AVERY_EMBED_MODEL` / `AVERY_EMBED_DIM` are SHARED with the DashScope path (one pair of vars,
    whichever provider is selected). A box that switches `AVERY_EMBEDDINGS=dashscope → openai` but
    leaves `AVERY_EMBED_MODEL=text-embedding-v4` behind gets a 404 from OpenAI on every batch —
    retrieval then falls back to keyword, silently. Leave both UNSET unless you mean it; the
    defaults here are the pair that matches the vector(1024) column.
    """
    env = env if env is not None else os.environ
    key_env = (env.get("AVERY_OPENAI_KEY_ENV") or "").strip() or "OPENAI_API_KEY"
    key = (env.get(key_env) or "").strip()
    if not key:
        return None
    return OpenAIEmbedder(
        api_key=key,
        model=(env.get("AVERY_EMBED_MODEL") or "").strip() or OPENAI_EMBED_MODEL,
        dim=int((env.get("AVERY_EMBED_DIM") or "").strip() or OPENAI_EMBED_DIM),
        base_url=((env.get("AVERY_OPENAI_BASE_URL") or "").strip() or OPENAI_EMBED_BASE_URL),
    )


# --- the env gate (ONE place: service embeddings + the DB registry share it) -------------------
# feat-031: the Postgres registry (avery.ingest) needs the SAME embedder the service builds, but must
# not import `service`. This is that shared resolver, in the CORE module both sides already depend on.

_DASHSCOPE_KINDS = ("dashscope", "bailian", "qwen", "text-embedding-v4")
# #96 · 欧盟/海外那一家。别名照 _DASHSCOPE_KINDS 的先例给全（模型名也算一个写法），因为落回是
# **静默**的：写错一个字母不报错、不告警，运维以为开了向量 RAG，实际拿到关键词检索。
_OPENAI_KINDS = ("openai", "text-embedding-3-small", "text-embedding-3-large")


def resolve_embeddings_kind(env: dict | None = None) -> str:
    env = env if env is not None else os.environ
    return (env.get("AVERY_EMBEDDINGS") or "keyword").strip().lower()


def make_embedder_from_env(env: dict | None = None):
    """The AVERY_EMBEDDINGS gate: dashscope|bailian|qwen -> DashScopeEmbedder; openai ->
    OpenAIEmbedder (#96); either is None without its key; anything else (keyword|none, the default)
    -> None, i.e. the offline keyword fallback. A missing/rotated key can never flip retrieval to a
    broken vector path — it degrades to keyword."""
    kind = resolve_embeddings_kind(env)
    if kind in _DASHSCOPE_KINDS:
        return make_dashscope_embedder(env=env)
    if kind in _OPENAI_KINDS:
        return make_openai_embedder(env=env)
    return None


# --- semantic ranking over line-addressable candidates ----------------------------------------
# A tiny per-corpus cache so repeated recall() calls in ONE advise run embed the facts corpus once
# (the query is embedded each call — one short string). Keyed by a caller-supplied cache_key that
# encodes the memory dir + file mtimes, so a re-materialized context re-embeds.

_CORPUS_CACHE: dict[str, tuple[list[str], list[list[float]]]] = {}
_CORPUS_CACHE_MAX = 64


def _dot(a: Sequence[float], b: Sequence[float]) -> float:
    return sum(x * y for x, y in zip(a, b))  # inputs are L2-normalized => cosine


def semantic_rank(query: str, candidates: Sequence[tuple[str, str]], embedder: Embedder,
                  limit: int = 8, *, cache_key: str | None = None) -> list[tuple[str, str, float]]:
    """Rank line-addressable candidates by embedding cosine to `query`.

    candidates: [(source, text), ...] where source is a cite-valid ref like "facts.md:15".
    Returns [(source, text, score), ...] sorted by descending cosine, top `limit`. Raises on an
    embedding failure so the caller can fall back to keyword (never silently returns keyword here).
    """
    texts = [t for _, t in candidates]
    if not texts:
        return []

    corpus_vecs: list[list[float]] | None = None
    if cache_key is not None and cache_key in _CORPUS_CACHE:
        cached_texts, cached_vecs = _CORPUS_CACHE[cache_key]
        if cached_texts == texts:
            corpus_vecs = cached_vecs
    if corpus_vecs is None:
        corpus_vecs = embedder.embed(texts)
        if cache_key is not None:
            if len(_CORPUS_CACHE) >= _CORPUS_CACHE_MAX:
                _CORPUS_CACHE.clear()  # crude bound; corpora are ephemeral per session
            _CORPUS_CACHE[cache_key] = (texts, corpus_vecs)

    qv = embedder.embed([query])[0]
    scored = [(src, txt, _dot(qv, cv))
              for (src, txt), cv in zip(candidates, corpus_vecs)]
    scored.sort(key=lambda r: r[2], reverse=True)
    return scored[:limit]
