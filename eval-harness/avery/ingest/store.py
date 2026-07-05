"""Stage 3 — the RAG store. Pluggable retrieval + pluggable embeddings (mirrors pluggable brain).

Two retrieval backends behind ONE interface (`RetrievalStore`):

  * KeywordStore  — deterministic, offline, NO embedding service. Token-overlap scoring over
    line-addressable material (the same shape `avery/memory.recall` returns: `<file>:<line>` hits).
    This is what the AFK gate uses, so retrieval is verifiable with no model or DB. It is the
    ingestion analogue of `avery/memory.py`'s keyword recall.

  * VectorStore   — real vector RAG. Embeds each material chunk with a pluggable `Embedder`
    (domestic BGE-M3/MiniMax or overseas OpenAI/Voyage) and does cosine kNN. The default backend is
    in-memory numpy cosine (self-hostable, runs anywhere numpy is present); pgvector is the
    production persistence target and plugs in behind the same `RetrievalStore` interface. When no
    embedding service is configured, the VectorStore path is a NEEDS-SERVICE no-op and the pipeline
    falls back to KeywordStore — the AFK gate never depends on a live embedding endpoint.

Embeddings are pluggable via the `Embedder` protocol: any object with `.embed(list[str]) ->
list[list[float]]`. `HashingEmbedder` is a deterministic, dependency-free stand-in (a hashed
bag-of-words projection) so the VECTOR PATH itself is exercised offline in tests, while a real
BGE/OpenAI embedder drops in unchanged for production quality.
"""
from __future__ import annotations

import hashlib
import math
import re
from dataclasses import dataclass, field
from typing import Protocol, Sequence

from .extract import MaterialChunk

_WORD = re.compile(r"[a-z0-9]+")
_STOP = {
    "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "is", "are", "was", "were",
    "her", "his", "their", "she", "he", "they", "it", "that", "this", "with", "has", "have",
    "at", "by", "as", "be", "but", "not", "no", "do", "does", "what", "how", "should", "who",
    "me", "my", "you", "your", "about", "any", "can", "could", "would", "i",
}


def _tokens(s: str) -> list[str]:
    return [w for w in _WORD.findall((s or "").lower()) if w not in _STOP and len(w) > 1]


@dataclass
class RetrievalHit:
    source: str        # "<filename>:<line>" — line-addressable so a cite() can point at it
    text: str
    score: float

    def as_line(self) -> str:
        return f"{self.source}  {self.text}"


class RetrievalStore(Protocol):
    def add(self, chunks: Sequence[MaterialChunk]) -> None: ...
    def query(self, text: str, limit: int = 8) -> list[RetrievalHit]: ...
    @property
    def backend(self) -> str: ...


# --- keyword backend (offline, deterministic) -------------------------------------------------

class KeywordStore:
    """Token-overlap retrieval. Deterministic, offline, no model. Ranks by distinct query tokens
    matched (tie-broken by shorter text so the tightest match wins), mirroring memory.recall."""

    backend = "keyword"

    def __init__(self) -> None:
        self._chunks: list[MaterialChunk] = []
        self._toks: list[set[str]] = []

    def add(self, chunks: Sequence[MaterialChunk]) -> None:
        for c in chunks:
            self._chunks.append(c)
            self._toks.append(set(_tokens(c.text)))

    def query(self, text: str, limit: int = 8) -> list[RetrievalHit]:
        q = set(_tokens(text))
        scored: list[RetrievalHit] = []
        for c, toks in zip(self._chunks, self._toks):
            overlap = q & toks
            if overlap:
                scored.append(RetrievalHit(source=c.source, text=c.text, score=float(len(overlap))))
        scored.sort(key=lambda h: (h.score, -len(h.text)), reverse=True)
        return scored[:limit]

    def __len__(self) -> int:
        return len(self._chunks)


# --- pluggable embeddings ---------------------------------------------------------------------

class Embedder(Protocol):
    name: str
    def embed(self, texts: list[str]) -> list[list[float]]: ...


class HashingEmbedder:
    """Deterministic, dependency-free embedder: hashed bag-of-words projected to a fixed dim, L2-
    normalized. NOT semantic — it exists so the VECTOR PATH runs offline in tests with real cosine
    math. Swap in BGE-M3 / MiniMax / OpenAI (same `.embed` signature) for production quality."""

    name = "hashing-bow"

    def __init__(self, dim: int = 256) -> None:
        self.dim = dim

    def _vec(self, text: str) -> list[float]:
        v = [0.0] * self.dim
        for tok in _tokens(text):
            h = int(hashlib.md5(tok.encode("utf-8")).hexdigest(), 16)
            v[h % self.dim] += 1.0
        norm = math.sqrt(sum(x * x for x in v)) or 1.0
        return [x / norm for x in v]

    def embed(self, texts: list[str]) -> list[list[float]]:
        return [self._vec(t) for t in texts]


def _cosine(a: Sequence[float], b: Sequence[float]) -> float:
    return sum(x * y for x, y in zip(a, b))  # inputs are L2-normalized


# --- vector backend ---------------------------------------------------------------------------

class VectorStore:
    """Real vector RAG. Default persistence = in-memory numpy/py cosine (self-hostable anywhere);
    pgvector is the production target behind this same interface. Needs an `Embedder`; if none is
    available it reports `available=False` and callers fall back to keyword.

    `persistence` records the intended production store ('pgvector') for the handoff even when the
    offline default (in-memory) is what actually runs here.
    """

    def __init__(self, embedder: Embedder | None = None, *, persistence: str = "in-memory") -> None:
        self.embedder = embedder
        self.persistence = persistence
        self._chunks: list[MaterialChunk] = []
        self._embs: list[list[float]] = []

    @property
    def backend(self) -> str:
        return f"vector({self.embedder.name if self.embedder else 'no-embedder'}/{self.persistence})"

    @property
    def available(self) -> bool:
        return self.embedder is not None

    def add(self, chunks: Sequence[MaterialChunk]) -> None:
        if not self.available:
            return
        texts = [c.text for c in chunks]
        embs = self.embedder.embed(texts)
        for c, e in zip(chunks, embs):
            self._chunks.append(c)
            self._embs.append(e)

    def query(self, text: str, limit: int = 8) -> list[RetrievalHit]:
        if not self.available or not self._chunks:
            return []
        qe = self.embedder.embed([text])[0]
        scored = [RetrievalHit(source=c.source, text=c.text, score=_cosine(qe, e))
                  for c, e in zip(self._chunks, self._embs)]
        scored.sort(key=lambda h: h.score, reverse=True)
        return [h for h in scored if h.score > 0.0][:limit]

    def __len__(self) -> int:
        return len(self._chunks)


def build_store(embedder: Embedder | None = None, *, prefer_vector: bool = False,
                persistence: str = "pgvector") -> RetrievalStore:
    """Factory honoring the pluggable-retrieval default.

    prefer_vector=False (AFK default) -> KeywordStore (offline, deterministic).
    prefer_vector=True with an embedder -> VectorStore (real RAG; pgvector in prod, in-memory here).
    prefer_vector=True with NO embedder -> falls back to KeywordStore (vector path = needs-service).
    """
    if prefer_vector and embedder is not None:
        return VectorStore(embedder, persistence=persistence)
    return KeywordStore()
