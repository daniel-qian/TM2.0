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
  * `HashingEmbedder`  — re-exported from the ingest store: deterministic, offline, NON-semantic
                         stand-in so the vector CODE PATH runs in tests without a service.

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

DASHSCOPE_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1"
DASHSCOPE_EMBED_MODEL = "text-embedding-v4"
DASHSCOPE_EMBED_DIM = 1024
_DASHSCOPE_BATCH = 10  # compatible-mode embeddings cap inputs per request; chunk conservatively


def _l2_normalize(v: Sequence[float]) -> list[float]:
    norm = math.sqrt(sum(x * x for x in v)) or 1.0
    return [x / norm for x in v]


class DashScopeEmbedder:
    """Alibaba Bailian text-embedding-v4 via the OpenAI-compatible endpoint (stdlib HTTP only).

    Pure text, 100+ languages (covers 境内 ZH + 海外 EN in ONE index), 1024-dim default. Outputs are
    L2-normalized here so downstream cosine is a plain dot product. Batches of <=10 inputs per call.
    """

    def __init__(self, api_key: str, *, model: str = DASHSCOPE_EMBED_MODEL,
                 dim: int = DASHSCOPE_EMBED_DIM, base_url: str = DASHSCOPE_BASE_URL,
                 timeout: float = 30.0) -> None:
        if not api_key:
            raise ValueError("DashScopeEmbedder needs a non-empty api_key")
        self._api_key = api_key
        self.model = model
        self.dim = dim
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    @property
    def name(self) -> str:
        return f"dashscope:{self.model}/{self.dim}"

    def _embed_batch(self, texts: list[str]) -> list[list[float]]:
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
        for i in range(0, len(texts), _DASHSCOPE_BATCH):
            out.extend(self._embed_batch(texts[i:i + _DASHSCOPE_BATCH]))
        return out


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


# --- the env gate (ONE place: service embeddings + the DB registry share it) -------------------
# feat-031: the Postgres registry (avery.ingest) needs the SAME embedder the service builds, but must
# not import `service`. This is that shared resolver, in the CORE module both sides already depend on.

_DASHSCOPE_KINDS = ("dashscope", "bailian", "qwen", "text-embedding-v4")


def resolve_embeddings_kind(env: dict | None = None) -> str:
    env = env if env is not None else os.environ
    return (env.get("AVERY_EMBEDDINGS") or "keyword").strip().lower()


def make_embedder_from_env(env: dict | None = None):
    """The AVERY_EMBEDDINGS gate: dashscope|bailian|qwen -> DashScopeEmbedder (None without a key);
    anything else (keyword|none, the default) -> None, i.e. the offline keyword fallback. A
    missing/rotated key can never flip retrieval to a broken vector path — it degrades to keyword."""
    if resolve_embeddings_kind(env) in _DASHSCOPE_KINDS:
        return make_dashscope_embedder(env=env)
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
