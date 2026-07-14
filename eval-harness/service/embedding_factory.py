"""Server-side embedder selection (mirrors `brain_factory`). Keys stay here, never toward the client.

    AVERY_EMBEDDINGS = keyword | none    -> None: offline keyword recall   [default, AFK-safe]
                     = dashscope | bailian -> DashScopeEmbedder on text-embedding-v4 (DASHSCOPE_API_KEY)

`make_embedder()` returns None whenever embeddings are turned off OR the key is absent, so the
advisor silently falls back to keyword recall — a missing/rotated key can never break an advise turn.
The frontend never sees any of this: it only ever receives SSE events.
"""
from __future__ import annotations

from avery.embeddings import make_embedder_from_env, resolve_embeddings_kind as _resolve_kind

# feat-031: the gate itself now lives in avery.embeddings so the Postgres registry (avery.ingest) can
# share it without importing `service`. This module stays the SERVICE-side entry point (unchanged API).


def resolve_embeddings_kind() -> str:
    return _resolve_kind()


def make_embedder():
    """Build the configured embedder, or None for the offline keyword path (default / no key)."""
    return make_embedder_from_env()   # None when AVERY_EMBEDDINGS is keyword or DASHSCOPE_API_KEY unset


def active_embeddings() -> str:
    """What retrieval will ACTUALLY use, accounting for a missing key. For /health + smokes."""
    emb = make_embedder()
    return getattr(emb, "name", None) or "keyword"
