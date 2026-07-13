-- feat-032 — the per-company FILE SPACE: persist the RAW uploaded documents (bytes + metadata) so a
-- manager can look back at what Avery's memory is built on (PRD User Story 4). Before feat-032 the
-- /ingest handler parsed then DISCARDED the upload ("sampler = ephemeral"); avery.contexts.source_
-- files kept only a filename list. This table keeps the bytes.
--
-- Increment-only, avery-scoped, idempotent (CREATE ... IF NOT EXISTS) — never touches public/existing
-- objects, never DROPs anything. Replayed by the registry's _ensure_schema() on each bootstrap (the
-- SAME files applied to Supabase, so local<->prod schema equivalence holds by construction), and it
-- bootstraps a blank local Docker Postgres for the @needs_db layer.
--
-- Storage decision (PRD Implementation Decisions "每公司文件空间"): v1 keeps the bytes INLINE as
-- `bytea` inside the dedicated avery schema — it does NOT reach for the shared project's object
-- storage (imaread lives in the same Supabase project; no cross-product storage surface is opened).
-- `storage_ref` lands now as the feat-035 seam (PRD: "may include an object-store reference"); v1
-- leaves it '' and reads/writes bytea.
--
-- RED LINE / trust boundary: these bytes are UNTRUSTED CONTENT. The schema only STORES them; nothing
-- in the read path interprets a file's contents as instructions (readiness §2-I injection surface).
-- The person-entity red line lives on avery.entities (migrations 0001/0002) and is unaffected here —
-- raw documents were always allowed to contain anything; they just weren't kept.

SET search_path = avery, public, extensions;

CREATE TABLE IF NOT EXISTS avery.source_documents (
    context_id  text NOT NULL REFERENCES avery.contexts(context_id) ON DELETE CASCADE,
    idx         integer NOT NULL,                       -- upload order; the manifest / download key
    filename    text NOT NULL,
    mime        text NOT NULL DEFAULT 'application/octet-stream',
    size_bytes  integer NOT NULL DEFAULT 0,
    doc_kind    text NOT NULL DEFAULT 'company',        -- parser's sniffed kind (resume/roster/...)
    content     bytea,                                  -- raw upload bytes (v1: inline; NULL allowed)
    storage_ref text NOT NULL DEFAULT '',               -- feat-035 seam: object-store pointer, unused
    uploaded_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (context_id, idx)
);
