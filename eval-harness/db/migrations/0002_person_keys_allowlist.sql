-- feat-030 P1 (adversarial validation) — tighten the person-entity red line from a DENYLIST of
-- known scoring keys to an ALLOWLIST of PersonEntity's own qualitative fields.
--
-- The 0001 CHECK (`entities_person_no_scoring_keys`) enumerated English scoring keys — a denylist,
-- which by construction misses Chinese keys (绩效评分/排名/离职风险) and compound English keys
-- (zscore/stack_rank/attrition_risk/nine_box). This replaces it with an allowlist: a person payload
-- may carry ONLY the keys PersonEntity actually has (id/name/role/team/tenure/owns/collaboration/
-- source). Any other key — in any language, in any spelling — is refused by the database itself.
-- This is the structural form of "the moat as a type": no wordlist to keep current, no hole to open.
--
-- Idempotent: DROP IF EXISTS both the old and the new constraint name, then ADD — safe to re-run
-- (the migration runner replays every *.sql file on each bootstrap). No data migration needed: the
-- `avery` schema carries zero rows outside disposable tests, so ADD CONSTRAINT never rejects an
-- existing row.

SET search_path = avery, public, extensions;

ALTER TABLE avery.entities DROP CONSTRAINT IF EXISTS entities_person_no_scoring_keys;
ALTER TABLE avery.entities DROP CONSTRAINT IF EXISTS entities_person_keys_allowlist;

ALTER TABLE avery.entities ADD CONSTRAINT entities_person_keys_allowlist CHECK (
    kind <> 'person'
    OR (payload - ARRAY[
        'id', 'name', 'role', 'team', 'tenure', 'owns', 'collaboration', 'source'
    ]::text[]) = '{}'::jsonb
);
