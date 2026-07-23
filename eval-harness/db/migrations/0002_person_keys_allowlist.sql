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
-- Idempotent: DROP IF EXISTS, safe to re-run.

SET search_path = avery, public, extensions;

ALTER TABLE avery.entities DROP CONSTRAINT IF EXISTS entities_person_no_scoring_keys;
