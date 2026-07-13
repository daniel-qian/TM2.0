"""feat-031 — real pgvector RAG behind the RetrievalStore seam (the DB twin of the vector store).

feat-030 landed `avery.materials.embedding vector(1024)` as a reserved, NULL column and rebuilt every
context's store as an offline KeywordStore. feat-031 fills that column and, when an embedder is
configured, rebuilds a pgvector-backed store that does real cosine kNN — so retrieval is STILL VECTOR
after a restart. Behavior, not internals, is the contract.

  OFFLINE (always runs — no DB, no key, deterministic HashingEmbedder):
    * build_store's vector label is HONEST — an in-memory VectorStore never claims 'pgvector'
      (the "fake pgvector name" is gone: a store is real pgvector, honest in-memory, or keyword);
    * a VectorStore exposes its computed embeddings for persistence, aligned to insertion order —
      the interface pg_registry.put() reuses so a corpus is embedded ONCE, not billed twice;
    * the /ingest handler opens the vector path (prefer_vector) exactly when an embedder is present,
      and stays honest keyword otherwise (the AFK gate never needs a live embedding endpoint).

  @needs_db (a REAL Postgres + pgvector, HashingEmbedder(1024) — NO embedding key needed):
    * put() through a registry WITH an embedder writes avery.materials.embedding (NULL in 030);
    * a BRAND-NEW registry instance (the restart) rebuilds a pgvector-backed store, and recall()
      does cosine kNN via the `<=>` operator over the DB — vector retrieval survives the restart
      (the feat-031 persistence contract, the pgvector twin of feat-030's memory_dir story);
    * kNN ORDERS by cosine (top hit is the semantically-closest chunk — proves the operator, not
      merely that rows come back);
    * HONEST fallback: a registry with NO embedder, or a context with NO stored embeddings, rebuilds
      a KeywordStore — never a vector store that silently returns nothing.

@needs_db follows the @seedgate/@needs_db convention: no AVERY_DB_URL/PGVECTOR_URL -> clean skip, so
the offline default suite stays green with no external service.
"""
from __future__ import annotations

import os
import re
import uuid
from pathlib import Path

import pytest

from avery.ingest import (
    HashingEmbedder, VectorStore, KeywordStore, build_store, ingest_paths,
)
from avery.ingest.extract import MaterialChunk, ExtractionResult
from avery.ingest.registry import CompanyContext, materialize_memory

HERE = Path(__file__).resolve().parent.parent          # eval-harness/
FIX = HERE / "tests" / "fixtures" / "ingest"
HANDBOOK = FIX / "Studio_Handbook.md"
ROSTER = FIX / "Team_Roster.xlsx"

DIM = 1024                                              # avery.materials.embedding is vector(1024)
needs_db = pytest.mark.needs_db


def _db_url() -> str | None:
    return (os.environ.get("AVERY_DB_URL") or os.environ.get("PGVECTOR_URL") or "").strip() or None


def _new_cid() -> str:
    return "ctx_pgv_" + uuid.uuid4().hex[:12]


# ==============================================================================================
# OFFLINE — vector-path honesty + the persistence interface + the /ingest wiring. No DB, no key.
# ==============================================================================================

def test_build_store_vector_label_is_honest_not_fake_pgvector():
    """An in-memory VectorStore must NOT claim the 'pgvector' persistence name — that string label
    (no real backend behind it) is exactly what feat-031 removes. Only a DB-backed store is pgvector."""
    store = build_store(HashingEmbedder(), prefer_vector=True)
    assert store.backend.startswith("vector("), store.backend
    assert "pgvector" not in store.backend, (
        f"in-memory VectorStore falsely claims pgvector: {store.backend!r}")
    assert "in-memory" in store.backend, store.backend


def test_vectorstore_exposes_persisted_vectors_aligned_to_insertion_order():
    """put() reuses the embeddings the pipeline already computed (no second billable pass): the
    VectorStore hands them back aligned to add() order, deterministically."""
    emb = HashingEmbedder(dim=16)
    vs = VectorStore(emb, persistence="in-memory")
    chunks = [MaterialChunk(id="m1", text="alpha beta gamma", source="f:1"),
              MaterialChunk(id="m2", text="delta epsilon zeta", source="f:2")]
    vs.add(chunks)
    vecs = vs.persisted_vectors()
    assert len(vecs) == 2
    assert all(len(v) == 16 for v in vecs)
    # aligned + deterministic: re-embedding the same texts yields the same vectors, same order
    assert vecs == emb.embed([c.text for c in chunks])


def _offline_client(monkeypatch, embedder):
    monkeypatch.setenv("AVERY_BRAIN", "mock")
    monkeypatch.setenv("AVERY_EXTRACTOR", "heuristic")
    monkeypatch.delenv("AVERY_DB_URL", raising=False)   # in-memory registry — no DB in this test
    monkeypatch.delenv("PGVECTOR_URL", raising=False)
    from service import embedding_factory
    monkeypatch.setattr(embedding_factory, "make_embedder", lambda: embedder)
    from fastapi.testclient import TestClient
    from service.app import app
    return TestClient(app)


def test_ingest_handler_opens_vector_path_when_embedder_present(monkeypatch):
    """The /ingest wiring: an embedder present -> prefer_vector -> a real (in-memory here) vector
    store behind the ingested context. Deterministic HashingEmbedder, no DB, no network."""
    client = _offline_client(monkeypatch, HashingEmbedder(dim=64))
    r = client.post("/ingest", files=[("files",
        ("Studio_Handbook.md", HANDBOOK.read_bytes(), "application/octet-stream"))])
    assert r.status_code == 200, r.text[:400]
    from avery.ingest.registry import active_registry
    ctx = active_registry().get(r.json()["context_id"])
    assert ctx is not None
    assert ctx.store.backend.startswith("vector("), (
        f"prefer_vector not wired on /ingest: store backend {ctx.store.backend!r}")


def test_ingest_handler_stays_keyword_when_no_embedder(monkeypatch):
    """No embedder (default / no key) -> the AFK-safe keyword store, unchanged."""
    client = _offline_client(monkeypatch, None)
    r = client.post("/ingest", files=[("files",
        ("Studio_Handbook.md", HANDBOOK.read_bytes(), "application/octet-stream"))])
    assert r.status_code == 200, r.text[:400]
    from avery.ingest.registry import active_registry
    ctx = active_registry().get(r.json()["context_id"])
    assert ctx.store.backend == "keyword", f"expected keyword fallback, got {ctx.store.backend!r}"


# ==============================================================================================
# @needs_db — real pgvector kNN. HashingEmbedder(1024) so NO embedding key is needed.
# ==============================================================================================

def _skip_without_db() -> str:
    url = _db_url()
    if not url:
        pytest.skip("needs AVERY_DB_URL (or PGVECTOR_URL) pointing at a Postgres — pgvector layer skipped")
    pytest.importorskip("psycopg")
    return url


def _pg(url, tmp_path, *, embedder, sub="d"):
    from avery.ingest.pg_registry import PostgresContextRegistry
    return PostgresContextRegistry(url, data_dir=tmp_path / sub, embedder=embedder)


def _hand_context(cid: str, chunks: list[MaterialChunk], embedder, work_dir: Path) -> CompanyContext:
    """A minimal, red-line-clean context (materials only) with a VectorStore already holding the
    embeddings — the shape pg_registry.put() persists from."""
    extraction = ExtractionResult(materials=chunks)
    store = VectorStore(embedder, persistence="in-memory")
    store.add(chunks)
    mem = materialize_memory(extraction, work_dir / cid)
    return CompanyContext(context_id=cid, extraction=extraction, store=store, memory_dir=mem,
                          name="pgv", source_files=["doc"])


@needs_db
def test_pgvector_persists_embeddings_and_recall_is_vector_after_restart(tmp_path):
    url = _skip_without_db()
    import psycopg
    emb = HashingEmbedder(dim=DIM)
    reg_a = _pg(url, tmp_path, embedder=emb, sub="a")
    cid = _new_cid()
    try:
        rep = ingest_paths([str(HANDBOOK), str(ROSTER)], registry=reg_a, embedder=emb,
                           prefer_vector=True, work_dir=tmp_path / "mem", context_id=cid, name="prism")
        assert rep.ok, f"ingest failed: {rep.redline.summary()}"

        with psycopg.connect(url) as conn:
            filled, total = conn.execute(
                "SELECT count(embedding), count(*) FROM avery.materials WHERE context_id = %s",
                (cid,)).fetchone()
        assert total > 0, "no materials were stored"
        assert filled == total, f"embeddings not persisted for every chunk: {filled}/{total}"

        # THE RESTART: a brand-new instance, a wiped local data dir (fresh-machine semantics).
        reg_b = _pg(url, tmp_path, embedder=emb, sub="b")
        got = reg_b.get(cid)
        assert got is not None
        assert "pgvector" in got.store.backend, (
            f"retrieval is not vector-backed after restart: {got.store.backend!r}")
        hits = got.recall("weekly written status update Friday", limit=5)
        assert hits, "pgvector kNN returned nothing after the restart"
        for h in hits:
            assert re.match(r"^.+:\d+$", h.source), f"hit not line-addressable: {h.source!r}"
            assert -1.0001 <= h.score <= 1.0001, f"cosine score out of range: {h.score}"
    finally:
        reg_a.delete(cid)


@needs_db
def test_pgvector_knn_orders_by_cosine(tmp_path):
    """The `<=>` operator ORDERS by distance: the chunk closest to the query ranks first. Uses three
    disjoint chunks so the nearest one is unambiguous even under a bag-of-words embedder."""
    url = _skip_without_db()
    emb = HashingEmbedder(dim=DIM)
    reg = _pg(url, tmp_path, embedder=emb, sub="k")
    cid = _new_cid()
    chunks = [
        MaterialChunk(id="m0", text="design direction visual identity leadership brand", source="doc:1"),
        MaterialChunk(id="m1", text="backend database migrations indexing throughput", source="doc:2"),
        MaterialChunk(id="m2", text="quarterly finance reporting budgets forecast", source="doc:3"),
    ]
    ctx = _hand_context(cid, chunks, emb, tmp_path / "hand")
    try:
        reg.put(ctx)
        got = reg.get(cid)
        hits = got.recall("who owns design direction and brand identity", limit=3)
        assert hits, "kNN returned nothing"
        assert hits[0].source == "doc:1", f"kNN top hit was not the design chunk: {[(h.source, round(h.score,3)) for h in hits]}"
    finally:
        reg.delete(cid)


@needs_db
def test_pgvector_registry_without_embedder_falls_back_to_keyword(tmp_path):
    """No embedder -> cannot embed a query -> HONEST keyword store (never an empty vector store),
    even when embeddings ARE stored."""
    url = _skip_without_db()
    emb = HashingEmbedder(dim=DIM)
    reg_w = _pg(url, tmp_path, embedder=emb, sub="w")
    cid = _new_cid()
    try:
        rep = ingest_paths([str(HANDBOOK)], registry=reg_w, embedder=emb, prefer_vector=True,
                           work_dir=tmp_path / "mem", context_id=cid, name="prism")
        assert rep.ok
        reg_no = _pg(url, tmp_path, embedder=None, sub="n")
        got = reg_no.get(cid)
        assert got.store.backend == "keyword", (
            f"a no-embedder registry must fall back to keyword, got {got.store.backend!r}")
        assert got.recall("weekly status update", limit=3), "keyword recall returned nothing"
    finally:
        reg_w.delete(cid)


@needs_db
def test_ingest_over_http_persists_pgvector_and_survives_restart(monkeypatch, tmp_path):
    """Agent as first user on the PRIMARY seam (HTTP): POST /ingest with a real DB + a deterministic
    embedder writes embeddings to pgvector, and a BRAND-NEW registry (the restart) rebuilds a
    pgvector-backed store whose recall() does DB kNN. The full upload -> persist -> restart-still-
    vector chain, end to end, WITHOUT an embedding key (HashingEmbedder(1024))."""
    url = _skip_without_db()
    monkeypatch.setenv("AVERY_BRAIN", "mock")
    monkeypatch.setenv("AVERY_EXTRACTOR", "heuristic")
    monkeypatch.setenv("AVERY_DB_URL", url)
    monkeypatch.delenv("PGVECTOR_URL", raising=False)
    emb = HashingEmbedder(dim=DIM)
    # Inject the deterministic embedder wherever the env gate resolves one — no network, no key,
    # for BOTH the /ingest pipeline (embedding_factory) and the registry's own query embedder.
    import avery.embeddings as embmod
    from service import embedding_factory
    from avery.ingest import registry as regmod
    monkeypatch.setattr(embmod, "make_embedder_from_env", lambda env=None: emb)
    monkeypatch.setattr(embedding_factory, "make_embedder", lambda: emb)
    regmod._PG_REGISTRIES.clear()   # force active_registry() to rebuild with the injected embedder

    from fastapi.testclient import TestClient
    from service.app import app
    client = TestClient(app)
    cid = None
    try:
        r = client.post("/ingest", files=[
            ("files", ("Studio_Handbook.md", HANDBOOK.read_bytes(), "application/octet-stream")),
            ("files", ("Team_Roster.xlsx", ROSTER.read_bytes(), "application/octet-stream"))])
        assert r.status_code == 200, r.text[:400]
        cid = r.json()["context_id"]

        import psycopg
        with psycopg.connect(url) as conn:
            filled, total = conn.execute(
                "SELECT count(embedding), count(*) FROM avery.materials WHERE context_id = %s",
                (cid,)).fetchone()
        assert total > 0 and filled == total, (
            f"HTTP /ingest did not persist embeddings to pgvector: {filled}/{total}")

        reg_b = _pg(url, tmp_path, embedder=emb, sub="http")   # the restart
        got = reg_b.get(cid)
        assert got is not None and "pgvector" in got.store.backend, (
            f"retrieval not pgvector-backed after an HTTP-ingest restart: {got and got.store.backend!r}")
        assert got.recall("weekly written status update Friday", limit=3), (
            "pgvector kNN returned nothing after the HTTP-ingest restart")
    finally:
        regmod._PG_REGISTRIES.clear()
        if cid:
            _pg(url, tmp_path, embedder=None, sub="cl").delete(cid)


@needs_db
def test_pgvector_honest_keyword_when_context_has_no_stored_embeddings(tmp_path):
    """A context ingested in keyword mode (NULL embeddings) read by an embedder-configured registry
    must rebuild a KEYWORD store — vector only when vectors actually exist (no silent empty kNN)."""
    url = _skip_without_db()
    reg_kw = _pg(url, tmp_path, embedder=None, sub="kw")   # keyword put: no embeddings written
    cid = _new_cid()
    try:
        rep = ingest_paths([str(HANDBOOK)], registry=reg_kw, work_dir=tmp_path / "mem",
                           context_id=cid, name="prism")
        assert rep.ok
        reg_emb = _pg(url, tmp_path, embedder=HashingEmbedder(dim=DIM), sub="e")
        got = reg_emb.get(cid)
        assert got.store.backend == "keyword", (
            f"no stored embeddings must yield honest keyword, got {got.store.backend!r}")
    finally:
        reg_kw.delete(cid)
