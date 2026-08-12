-- issue #90 — content idempotency: a sha256 over each uploaded file's RAW BYTES, so a re-upload of
-- the SAME bytes is recognized as "already in the library" instead of being renamed to 'xxx(1)' and
-- accepted as a new document (which re-burned the LLM and double-loaded the RAG corpus — the
-- retry-after-timeout amplifier, exploration.md §0 症状③′).
--
--   content_sha256   hex sha256 of source_documents.content. '' when unknown (a pre-#90 row whose
--                    content is NULL — the backfill below cannot compute one; the idempotency map
--                    skips empty hashes, so such a row simply never matches).
--
-- The hash is computed in Python at upload time (the same bytes read_capped just read); the backfill
-- below computes it IN THE DATABASE for existing rows so the bytea never crosses the wire.
--
-- pgcrypto provides digest(). 🔴 WITH SCHEMA public is MANDATORY — 0001:33-44 carries the production
-- incident: an extension installed with no explicit schema lands in the FIRST schema of THIS file's
-- search_path (avery), which the runtime role's default search_path does not include, and every use
-- then dies with UndefinedFunction on a genuinely fresh database. public is the one schema every
-- default search_path contains. IF NOT EXISTS keeps this a no-op wherever pgcrypto already lives
-- (e.g. Supabase's `extensions` schema) — it never relocates an existing install.
-- ⚠ digest() below is deliberately UNQUALIFIED: on Supabase pgcrypto already lives in `extensions`
-- (IF NOT EXISTS keeps it there), on a fresh local DB this file installs it into `public` — and this
-- file's own search_path (avery, public, extensions) resolves both installs. Writing public.digest()
-- would break the Supabase case; only the runtime (which never calls digest — hashing is done in
-- Python at upload time) depends on a role search_path, and it doesn't run this function at all.
--
-- Increment-only, avery-scoped, idempotent: ADD COLUMN IF NOT EXISTS; the backfill UPDATE only
-- touches rows that still have '' (0 rows on every replay after the first). Replayed by
-- _ensure_schema() on each bootstrap — the SAME file applied to Supabase, so local<->prod schema
-- equivalence holds by construction.
--
-- 🔴 RED LINE: unchanged. This column holds no person data — a hex digest of already-stored bytes.
-- The person-key allowlist CHECK (0009) and the write-side red line are untouched.

SET search_path = avery, public, extensions;

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;

ALTER TABLE avery.source_documents
    ADD COLUMN IF NOT EXISTS content_sha256 text NOT NULL DEFAULT '';

-- Backfill: hash the bytes we already hold, in-database (no bytea over the wire). Idempotent —
-- after the first replay every hashable row carries its digest and this matches 0 rows.
UPDATE avery.source_documents
    SET content_sha256 = encode(digest(content, 'sha256'), 'hex')
    WHERE content IS NOT NULL AND content_sha256 = '';
