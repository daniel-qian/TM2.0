-- gc-demo-clones-0724 — mark demo guest clones as ephemeral so they can be garbage-collected.
--
-- WHY A FLAG, NOT AN ID PREFIX: a demo guest clone (service/demo.py::demo_claim ->
-- registry.clone_context) and a real anonymous upload (/ingest, not yet signed in) are BOTH
-- `ctx_<12hex>` with no account link — indistinguishable by id. A sweep keyed on the id shape would
-- delete a real user's just-uploaded workspace. So the clone seam sets an EXPLICIT `ephemeral` flag
-- (clone_context(..., ephemeral=True)); everything else — demo masters built via put() (ctx_demo_*),
-- real uploads, account-linked contexts — stays `false` and is structurally exempt from GC.
--
-- The sweep (registry.sweep_ephemeral, called best-effort at claim time) deletes ONLY rows that are
-- ephemeral AND older than the TTL AND not account-linked (avery.account_contexts). A guest who signs
-- in and links their demo clone keeps it: link_account_context flips ephemeral -> false, and the
-- sweep excludes account-linked rows regardless (belt and suspenders). The ON DELETE CASCADE from
-- every child table (entities/materials/memory_files/source_documents/company_notes/asks) means a
-- swept context takes its whole footprint with it in one DELETE.
--
-- Increment-only, avery-scoped, idempotent (ADD COLUMN / CREATE INDEX IF NOT EXISTS) — never touches
-- public/existing objects, never DROPs anything. Replayed by _ensure_schema on every bootstrap (the
-- SAME file applied to Supabase, so local<->prod schema equivalence holds by construction). ADD
-- COLUMN with a constant default is metadata-only in PG11+ (no table rewrite, no lock storm).
--
-- 🔴 RED LINE: unchanged. This column holds no person data — one boolean lifecycle flag. The
-- person-key allowlist CHECK (0009) and the write-side red line are untouched.

SET search_path = avery, public, extensions;

ALTER TABLE avery.contexts
    ADD COLUMN IF NOT EXISTS ephemeral boolean NOT NULL DEFAULT false;

-- The sweep predicate is (ephemeral AND created_at < cutoff); a partial index over just the ephemeral
-- rows keeps it a cheap index scan and stays tiny (only live guest clones), never indexing the masters
-- and real workspaces that dominate the table.
CREATE INDEX IF NOT EXISTS contexts_ephemeral_created_idx
    ON avery.contexts (created_at) WHERE ephemeral;
