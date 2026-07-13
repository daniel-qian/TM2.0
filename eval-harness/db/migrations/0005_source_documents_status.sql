-- feat-032 adversarial fixes (P1 HIGH / P2 MEDIUM) — two additive columns on the per-company file
-- space table so the manifest survives a restart with per-DOCUMENT correctness (not per display
-- name) and with honest parse status.
--
--   source_key  the DISAMBIGUATED per-document join key (== the parsed doc's name == a material's
--               '<key>:<line>' source prefix). Two uploads that share a `filename` ('report.txt'
--               twice) get distinct source_key values, so n_chunks attributes to the right document
--               AFTER a restart too (get() joins materials on source_key, not the display filename).
--   status      'ingested' | 'failed' (unparseable) | 'empty' (parsed, produced no material). Pre-
--               fix a parse-failed file was persisted and listed as a normal entry (doc_kind
--               'company', n_chunks 0) with no way to tell it apart; the manifest now surfaces this.
--
-- Increment-only, avery-scoped, idempotent (ADD COLUMN IF NOT EXISTS) — never touches
-- public/existing objects, never DROPs anything. Replayed by the registry's _ensure_schema() on
-- each bootstrap (the SAME files applied to Supabase, so local<->prod schema equivalence holds).
--
-- Backfill note: existing rows default to source_key '' (get()/file_cards fall back to `filename`
-- for the n_chunks join — correct for any pre-fix row, which never had a display-name collision)
-- and status 'ingested' (the common case; re-ingesting a company refreshes these to the truth).

SET search_path = avery, public, extensions;

ALTER TABLE avery.source_documents
    ADD COLUMN IF NOT EXISTS source_key text NOT NULL DEFAULT '';

ALTER TABLE avery.source_documents
    ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'ingested';
