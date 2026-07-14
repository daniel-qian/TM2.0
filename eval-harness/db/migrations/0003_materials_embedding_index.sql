-- feat-031 — real pgvector RAG: an ANN index on avery.materials.embedding so cosine kNN (`<=>`)
-- scales past a sequential scan as a company's corpus grows. HNSW (pgvector >= 0.5, Supabase runs
-- 0.8.x) needs no training data and no `lists` tuning — it builds incrementally as rows insert, so
-- it is correct on an empty table and safe in this increment-only migration.
--
-- `vector_cosine_ops` matches the query operator: PgVectorStore ranks by `embedding <=> query`
-- (cosine distance) and reports `1 - distance` as the similarity score. The column is vector(1024)
-- (= AVERY_EMBED_DIM, DashScope text-embedding dim), the fixed dimension HNSW requires.
--
-- Increment-only, avery-scoped, idempotent (CREATE INDEX IF NOT EXISTS) — never touches public/
-- existing objects, safe to replay on each _ensure_schema() bootstrap. On a locked-down prod role
-- that lacks CREATE, the registry's InsufficientPrivilege handler tolerates it (kNN still works
-- without the index, just via a scan) exactly as for the table DDL.

SET search_path = avery, public, extensions;

CREATE INDEX IF NOT EXISTS materials_embedding_hnsw_cosine
    ON avery.materials USING hnsw (embedding vector_cosine_ops);
