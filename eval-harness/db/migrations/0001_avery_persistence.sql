-- feat-030 — Avery persistence schema (ADR-0023; supersedes the deliberate ephemerality of
-- ADR-0021 §6 for the lite v1 lean-real product).
--
-- EVERYTHING lives in the dedicated `avery` schema. The production Supabase project
-- (nunsbijtntreynoyeilp) is SHARED with another live product in `public` — this migration is
-- increment-only DDL (CREATE ... IF NOT EXISTS), never touches public/existing objects, never
-- DROPs anything. The same file bootstraps a blank local Docker Postgres (pgvector/pgvector:pg17)
-- for the @needs_db test layer, so schema equivalence local<->Supabase is by construction.
--
-- Red line, structurally, at the storage layer: the person-entity CHECK is an ALLOWLIST — a person
-- payload may ONLY carry PersonEntity's own qualitative fields; ANY extra key (score / 绩效评分 /
-- zscore / nine_box / ...) is refused by the DB itself, no wordlist involved (that is migration
-- 0002; 0001 ships the initial denylist form and 0002 tightens it to the allowlist). The Python
-- write path additionally runs the FULL red-line scan (redline_extract.validate_extraction — value +
-- free-text lexicon, EN+ZH) before any INSERT, catching smuggled scores in free text like
-- owns=['ranked 2/10']. Together: even a writer that skips the Python layer cannot persist a scoring
-- KEY, and even a writer that crafts an allowed key cannot smuggle a scoring VALUE past put().
-- PersonEntity itself still has no numeric field (the moat as a type).
--
-- Reserved seams (columns land now, logic lands later — see kickoff):
--   * avery.materials.embedding vector(1024)  — feat-031 real pgvector RAG fills it; NULL in 030.
--     (1024 = AVERY_EMBED_DIM in eval-harness/.env — DashScope text-embedding dim.)
--   * avery.contexts.owner_token              — feat-038 tenant isolation validates it; unused in 030.

-- This SET is for THIS migration only: it lets the unqualified `vector` type below resolve while we
-- create avery.materials. It does NOT reach the running service — nothing in avery/ or service/ sets
-- a search_path; PgRegistry._connect() is a bare psycopg.connect(url), so at runtime the unqualified
-- `vector` in `$7::vector` resolves against the DB ROLE's DEFAULT search_path, not this one.
SET search_path = avery, public, extensions;

CREATE SCHEMA IF NOT EXISTS avery;

-- 2026-07-17 PRODUCTION BUG (a real 500 on a real deploy): `CREATE EXTENSION IF NOT EXISTS vector`
-- with no WITH SCHEMA installs into the FIRST schema of the search_path set above — i.e. `avery`.
-- That was invisible on every DB we had (Supabase's shared project + the long-lived local container
-- both already had pgvector installed, so IF NOT EXISTS was a no-op), and it detonated the first time
-- the migration met a genuinely FRESH database: the extension landed in `avery`, the service's role
-- default search_path (`"$user", public, extensions` on Supabase / `"$user", public` on the local
-- image) does NOT include `avery`, and every /ingest died on
--     psycopg.errors.UndefinedObject: type "vector" does not exist.
-- Fix: pin the target schema explicitly instead of letting search_path order decide. `public` is the
-- one schema BOTH default search_paths contain, so the runtime resolves `vector` unqualified on
-- Supabase and on the local pgvector image alike. IF NOT EXISTS keeps this a no-op wherever pgvector
-- is already installed (e.g. Supabase's `extensions`) — it never relocates an existing install.
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;

-- One row per ingested company workspace (the `company_context_id` the HTTP surface hands out).
CREATE TABLE IF NOT EXISTS avery.contexts (
    context_id   text PRIMARY KEY,
    name         text NOT NULL DEFAULT 'company',
    source_files jsonb NOT NULL DEFAULT '[]'::jsonb,   -- uploaded filenames (feat-032 grows this)
    owner_token  text,                                 -- feat-038 tenant-isolation credential (nullable:
                                                       -- pre-038 rows / tokenless contexts stay NULL)
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
