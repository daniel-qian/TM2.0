-- feat-033 — "Avery's notes": the WRITE-SIDE, user-visible, cross-session memory. After each
-- /advise the service appends Avery's own OBSERVATION about the company here, so a manager can watch
-- the notebook get thicker the longer they work together (PRD User Story 7). Distinct from the
-- read-only, doc-derived notes.md (that is a document signal); this is agent-WRITTEN.
--
-- Increment-only, avery-scoped, idempotent (CREATE ... IF NOT EXISTS) — never touches
-- public/existing objects, never DROPs anything. Replayed by the registry's _ensure_schema() on each
-- bootstrap (the SAME files applied to Supabase, so local<->prod schema equivalence holds by
-- construction), and it bootstraps a blank local Docker Postgres for the @needs_db layer.
--
-- 🔴 RED LINE: a note is FREE-TEXT (an observation in Avery's own words), so — unlike avery.entities
-- — there is no person-key allowlist to hang here; the moat is a CONTENT scan, not a key scan. The
-- Python write path (registry.append_note) runs the FULL red-line scan `redline.validate` (EN+ZH,
-- the UNCHANGED advisor gate) over the observation AND its echoed question excerpt BEFORE any INSERT,
-- so a self-written score/rank/profile never lands. This table therefore only needs to store clean
-- text; the guarantee lives in the append gate. (The manager's echoed question is gated too, so the
-- surface never displays scoring text from ANY origin.)
--
--   seq            monotonic insert order — the deterministic new->old sort key (created_at can tie
--                  at sub-ms resolution for rapid appends; seq never does).
--   id             an opaque, non-guessable handle for one note (external reference).
--   source_excerpt the ~60-char lead of the manager's question that triggered the observation.

SET search_path = avery, public, extensions;

CREATE TABLE IF NOT EXISTS avery.company_notes (
    seq            bigserial PRIMARY KEY,
    id             text NOT NULL,
    context_id     text NOT NULL REFERENCES avery.contexts(context_id) ON DELETE CASCADE,
    text           text NOT NULL,
    source_excerpt text NOT NULL DEFAULT '',
    created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS company_notes_id_key
    ON avery.company_notes (id);

-- The list read is "this company's notes, newest first" — index the (context_id, seq DESC) path.
CREATE INDEX IF NOT EXISTS company_notes_ctx_seq_idx
    ON avery.company_notes (context_id, seq DESC);
