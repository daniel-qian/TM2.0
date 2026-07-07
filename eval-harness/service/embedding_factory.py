"""Server-side embedder selection (mirrors `brain_factory`). Keys stay here, never toward the client.

    AVERY_EMBEDDINGS = keyword | none    -> None: offline keyword recall   [default, AFK-safe]
                     = dashscope | bailian -> DashScopeEmbedder on text-embedding-v4 (DASHSCOPE_API_KEY)

`make_embedder()` returns None whenever embeddings are turned off OR the key is absent, so the
advisor silently falls back to keyword recall — a missing/rotated key can never break an advise turn.
The frontend never sees any of this: it only ever receives SSE events.
"""
from __future__ import annotations

import os

from avery.embeddings import make_dashscope_embedder

_DASHSCOPE_KINDS = ("dashscope", "bailian", "qwen", "text-embedding-v4")


def resolve_embeddings_kind() -> str:
    return (os.environ.get("AVERY_EMBEDDINGS") or "keyword").strip().lower()


def make_embedder():
    """Build the configured embedder, or None for the offline keyword path (default / no key)."""
    if resolve_embeddings_kind() in _DASHSCOPE_KINDS:
        return make_dashscope_embedder()   # None when DASHSCOPE_API_KEY is unset
    return None


def active_embeddings() -> str:
    """What retrieval will ACTUALLY use, accounting for a missing key. For /health + smokes."""
    emb = make_embedder()
    return getattr(emb, "name", None) or "keyword"
