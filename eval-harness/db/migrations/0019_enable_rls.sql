-- issue #98 — turn on ROW LEVEL SECURITY for every avery table, with NO policy attached.
--
-- WHAT THIS BUYS: a table with RLS enabled and zero policies is deny-all to every role that is not
-- the table owner and not BYPASSRLS. Today that is already unreachable ground — anon/authenticated
-- hold no USAGE on the avery schema, so the public Supabase keys never get as far as a table — but
-- this is the second lock: the day someone fat-fingers a `GRANT USAGE ON SCHEMA avery TO anon`, or
-- a future feature exposes the schema through PostgREST, the tables stay shut instead of going
-- bare. Row isolation itself continues to live in the app layer (per-request owner_token check +
-- avery.account_contexts mapping); this migration does not move that responsibility.
--
-- WHY THE BACKEND DOES NOT NOTICE: the service connects as the migration-executing role, which owns
-- every avery table, and a table owner BYPASSES its own RLS unless FORCE ROW LEVEL SECURITY is set.
-- 🔴 So: NEVER add FORCE here. FORCE would subject the owner to the (empty) policy set and deny-all
-- would land squarely on the backend itself — every read returns zero rows, every write is rejected,
-- and the failure looks like silent data loss rather than a permission error. The absence of FORCE
-- is the entire reason this migration is a no-op for the running service.
--
-- 🔴 WHY THE GUARD, AND WHY IT IS NOT DECORATION (measured, 2026-08-13, pg16 throwaway):
-- `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` takes an ACCESS EXCLUSIVE lock EVERY TIME — it does
-- NOT short-circuit when RLS is already on. Held against a table with an open ACCESS SHARE reader,
-- the bare re-enable dies with "canceling statement due to lock timeout"; the guarded form below
-- passes under the identical contention because it never gets past the catalog lookup. Since
-- _ensure_schema replays EVERY migration on EVERY bootstrap (README rule 1), the bare 13-statement
-- form would grab ACCESS EXCLUSIVE on `entities` on every single boot — precisely the shape of the
-- 2026-07-23 outage (an orphaned idle-in-transaction /demo/claim holding entities, bootstrap
-- blocking behind it, /demo/* 500). README rule 2 forbids exactly that, and 0009/0010 use the same
-- already-satisfied-so-skip shape for their ADD CONSTRAINTs. Steady state here is one catalog scan.
--
-- WHY DRIVEN OFF THE CATALOG INSTEAD OF A HAND-WRITTEN TABLE LIST: a literal list would be a second
-- copy of "which tables exist", and README rule 3 is the standing warning about two copies of one
-- truth drifting apart. It is not hypothetical — issue #98's own body lists 12 tables, written
-- before 0018 added avery.ingest_jobs; a copied list would have shipped with that table unprotected.
-- Selecting from pg_class means this file cannot go stale and cannot disagree with reality.
--
-- ⚠ ONE-BOOT LAG, the known edge: migrations replay in filename order, so a table created by a
-- FUTURE 0020+ is created after this file has already run and stays RLS-off until the next bootstrap.
-- Do not rely on that catch-up — a migration that adds an avery table should enable RLS on it in its
-- own file. test_rls_enabled_on_every_avery_table (tests/test_registry_contract.py) fails on a fresh
-- bootstrap if that is forgotten, so the gap is caught rather than discovered in production.
--
-- ROLLBACK: `ALTER TABLE avery.<t> DISABLE ROW LEVEL SECURITY` per table. No data is touched, no
-- column changes, no rewrite — enabling RLS is a catalog flag flip, and reverting is symmetric.
--
-- Increment-only, avery-scoped, idempotent — never touches public/existing objects, never DROPs
-- anything. Replayed by _ensure_schema on every bootstrap (the SAME file applied to Supabase, so
-- local<->prod schema equivalence holds by construction).
--
-- 🔴 RED LINE: unchanged. This migration stores nothing, reads no person data, and adds no column —
-- it flips a per-table catalog boolean. The person-key allowlist CHECK (0009) is untouched.

SET search_path = avery, public, extensions;

DO $$
DECLARE
    rel regclass;
BEGIN
    -- Ordinary + partitioned tables only ('r','p'). Views/matviews/sequences cannot carry RLS, and
    -- the avery schema holds none today — the relkind filter is what keeps that true if one appears.
    FOR rel IN
        SELECT c.oid::regclass
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'avery'
           AND c.relkind IN ('r', 'p')
           AND NOT c.relrowsecurity          -- the guard: already-on tables are skipped, unlocked
         ORDER BY c.relname
    LOOP
        RAISE NOTICE 'enabling row level security on %', rel;
        EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', rel);
    END LOOP;
END $$;
