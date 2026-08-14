-- feat-030 P1 (adversarial validation) — retire the DENYLIST of known scoring keys
-- (`entities_person_no_scoring_keys`, declared inline in 0001) in favour of an ALLOWLIST of
-- PersonEntity's own qualitative fields. The denylist by construction missed Chinese keys
-- (绩效评分/排名/离职风险) and compound English keys (zscore/stack_rank/nine_box); the allowlist is
-- "the moat as a type" — any key outside PersonEntity's own fields is refused, no wordlist to keep.
--
-- ⚠️ REPLAY-SAFETY (learned the hard way, rich-align-0722): pg_registry._ensure_schema replays EVERY
-- migration file on every bootstrap, and `ALTER TABLE ... ADD CONSTRAINT` re-VALIDATES all existing
-- rows each time. A person-keys allowlist ADD frozen at a PAST field set becomes a strict subset once
-- later rows carry newer keys (03's self_report, 06's archived/provenance) and then ABORTS the whole
-- bootstrap ("violated by some row"). So the allowlist is defined in exactly ONE place, kept in
-- lockstep with PersonEntity's CURRENT fields — the LATEST person-keys migration, 0009 — and asserted
-- by tests/test_registry_contract.py::test_person_keys_allowlist_covers_exactly_person_fields.
--
-- THIS migration therefore only DROPS the retired denylist; it must NOT (re-)add a point-in-time
-- allowlist. To change the allowlist, edit 0009 IN PLACE — never add a superseding migration.
--
-- Idempotent: the DROP runs only when the constraint is actually there, so re-runs are free.
--
-- 🔴 WHY THE GUARD AND NOT A BARE `DROP CONSTRAINT IF EXISTS` (measured 2026-08-13, pg16 throwaway,
-- found while writing 0019): `IF EXISTS` decides nothing before it locks. The bare form takes an
-- ACCESS EXCLUSIVE lock on `entities` EVERY time it runs, including the overwhelmingly common case
-- where this constraint was retired long ago and the statement drops nothing at all. Since
-- _ensure_schema replays EVERY migration on EVERY bootstrap (README rule 1), that made this file a
-- once-per-boot ACCESS EXCLUSIVE grab on the single hottest table — exactly what README rule 2
-- forbids, and exactly the 2026-07-23 outage shape (an orphaned idle-in-transaction /demo/claim
-- holds entities, the bootstrap piles up behind it, /demo/* 500s).
--
-- It was not theoretical. Replaying each migration individually against a held ACCESS SHARE lock
-- (lock_timeout=3000), 0002 was the ONLY file that failed — 0001 and 0003+ all passed — and a full
-- _ensure_schema() under that same contention raised "could not lock the entities table". So rule 2
-- and the pg_registry._ensure_schema docstring, both of which assert the steady-state bootstrap takes
-- NO ACCESS EXCLUSIVE lock on entities, were false in the one file nobody thought to look at,
-- because a DROP that drops nothing reads as harmless. Reading the catalog first costs nothing and
-- makes the steady-state boot lock-free for real. Guarded in the shape 0009/0010 already use.
--
-- Guard: tests/test_registry_contract.py::test_steady_state_bootstrap_takes_no_entities_lock.

SET search_path = avery, public, extensions;

DO $mig$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conrelid = 'avery.entities'::regclass
           AND conname  = 'entities_person_no_scoring_keys'
    ) THEN
        ALTER TABLE avery.entities DROP CONSTRAINT entities_person_no_scoring_keys;
    END IF;
END
$mig$;
