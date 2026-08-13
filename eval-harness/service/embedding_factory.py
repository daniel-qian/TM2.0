"""Server-side embedder selection (mirrors `brain_factory`). Keys stay here, never toward the client.

    AVERY_EMBEDDINGS = keyword | none    -> None: offline keyword recall   [default, AFK-safe]
                     = dashscope | bailian -> DashScopeEmbedder on text-embedding-v4 (DASHSCOPE_API_KEY)
                     = openai            -> OpenAIEmbedder on text-embedding-3-small @1024 dims
                                            (OPENAI_API_KEY) — #96 欧盟/海外，同一根 vector(1024) 列

`make_embedder()` returns None whenever embeddings are turned off OR the key is absent, so the
advisor silently falls back to keyword recall — a missing/rotated key can never break an advise turn.
The frontend never sees any of this: it only ever receives SSE events.
"""
from __future__ import annotations

from avery import embeddings as _embeddings
from avery.embeddings import make_embedder_from_env, resolve_embeddings_kind as _resolve_kind

from . import llm_budget

# feat-031: the gate itself now lives in avery.embeddings so the Postgres registry (avery.ingest) can
# share it without importing `service`. This module stays the SERVICE-side entry point (unchanged API).

# 0805 走查修闸: install the billable-embedding spend gate the moment the service side loads (app.py
# imports this module at startup, before any request). Installing HERE — not per-instance in
# make_embedder() — is what also covers the embedder `registry.active_registry()` builds for itself
# via make_embedder_from_env (pg_registry's put()-fallback + pgvector query path): the hook lives
# inside DashScopeEmbedder._embed_batch, so every construction path passes the same counter.
_embeddings.install_spend_gate(llm_budget.embed_spend_gate)


def resolve_embeddings_kind() -> str:
    return _resolve_kind()


def make_embedder():
    """Build the configured embedder, or None for the offline keyword path (default / no key)."""
    return make_embedder_from_env()   # None when AVERY_EMBEDDINGS is keyword or DASHSCOPE_API_KEY unset


def active_embeddings() -> str:
    """What retrieval will ACTUALLY use, accounting for a missing key. For /health + smokes."""
    emb = make_embedder()
    return getattr(emb, "name", None) or "keyword"
