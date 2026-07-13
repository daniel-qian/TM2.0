-- feat-030 — Avery persistence schema (ADR-0023; supersedes the deliberate ephemerality of
-- ADR-0021 §6 for the lite v1 lean-real product).
--
-- EVERYTHING lives in the dedicated `avery` schema. The production Supabase project
-- (nunsbijtntreynoyeilp) is SHARED with another live product in `public` — this migration is
-- increment-only DDL (CREATE ... IF NOT EXISTS), never touches public/existing objects, never
-- DROPs anything. The same file bootstraps a blank local Docker Postgres (pgvector/pgvector:pg17)
-- for the @needs_db test layer, so schema equivalence local<->Supabase is by construction.
--
-- Red line, structurally, at the storage layer: `entities_person_no_scoring_keys` — the DB itself
-- refuses a person payload carrying a scoring key (score/rank/tier/moodPct/capacityPct/...). The
-- Python write path additionally runs the full EN+ZH lexicon (redline_extract.validate_person_dict)
-- before any INSERT; this CHECK is the belt under that suspender, so even a buggy future writer
-- cannot open the hole. PersonEntity itself still has no numeric field (the moat as a type).
--
-- Reserved seams (columns land now, logic lands later — see kickoff):
--   * avery.materials.embedding vector(1024)  — feat-031 real pgvector RAG fills it; NULL in 030.
--     (1024 = AVERY_EMBED_DIM in eval-harness/.env — DashScope text-embedding dim.)
--   * avery.contexts.owner_token              — feat-034 tenant isolation validates it; unused in 030.

CREATE SCHEMA IF NOT EXISTS avery;

-- On Supabase pgvector 0.8.0 is already installed (extensions schema) -> no-op.
-- On the local Docker pgvector image this installs the extension into the default schema.
CREATE EXTENSION IF NOT EXISTS vector;

-- One row per ingested company workspace (the `company_context_id` the HTTP surface hands out).
CREATE TABLE IF NOT EXISTS avery.contexts (
    context_id   text PRIMARY KEY,
    name         text NOT NULL DEFAULT 'company',
    source_files jsonb NOT NULL DEFAULT '[]'::jsonb,   -- uploaded filenames (feat-032 grows this)
    owner_token  text,                                 -- feat-034 seam: reserved, NOT validated yet
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
);

-- Extraction entities (people / projects / signals) as ordered JSONB rows. `idx` preserves the
-- extraction order so a rebuilt CompanyContext is byte-identical to the one that was put.
CREATE TABLE IF NOT EXISTS avery.entities (
    context_id text NOT NULL REFERENCES avery.contexts(context_id) ON DELETE CASCADE,
    kind       text NOT NULL CHECK (kind IN ('person', 'project', 'signal')),
    idx        integer NOT NULL,
    payload    jsonb NOT NULL,
    PRIMARY KEY (context_id, kind, idx),
    -- THE RED LINE IN THE SCHEMA: a person row must never carry a scoring key.
    CONSTRAINT entities_person_no_scoring_keys CHECK (
        kind <> 'person' OR NOT payload ?| ARRAY[
            'score', 'scores', 'rank', 'ranking', 'tier', 'grade', 'percentile',
            'moodPct', 'capacityPct', 'mood', 'capacity', 'rating',
            'performance', 'potential'
        ]
    )
);

-- Material chunks (the RAG corpus) as a ROW table: feat-031 fills `embedding`, feat-032 hangs the
-- per-company file space off the same rows. `idx` preserves store order.
CREATE TABLE IF NOT EXISTS avery.materials (
    context_id text NOT NULL REFERENCES avery.contexts(context_id) ON DELETE CASCADE,
    idx        integer NOT NULL,
    chunk_id   text NOT NULL DEFAULT '',
    text       text NOT NULL,
    source     text NOT NULL DEFAULT '',                -- "<filename>:<line>" (the cite seam)
    doc_kind   text NOT NULL DEFAULT 'company',
    embedding  vector(1024),                            -- feat-031 seam: nullable, UNFILLED in 030
    PRIMARY KEY (context_id, idx)
);

-- Materialized memory (facts.md / notes.md full text) — the source for re-materializing a
-- memory_dir on a fresh machine so the loop's recall/cite run unchanged after a restart.
CREATE TABLE IF NOT EXISTS avery.memory_files (
    context_id text NOT NULL REFERENCES avery.contexts(context_id) ON DELETE CASCADE,
    filename   text NOT NULL CHECK (filename IN ('facts.md', 'notes.md')),
    content    text NOT NULL,
    PRIMARY KEY (context_id, filename)
);
