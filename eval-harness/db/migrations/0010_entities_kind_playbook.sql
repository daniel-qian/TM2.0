-- rich-align-0722/08 — admit the "playbook" entity kind into entities_kind_check.
--
-- 0001 declared `kind text NOT NULL CHECK (kind IN ('person','project','signal'))` (auto-named
-- entities_kind_check). Slice 08 (playbooks/方法库) added a fourth entity kind — pg_registry.put()
-- writes rows with kind='playbook' (see _ENTITY_KINDS) — but no migration extended the CHECK, so real
-- Postgres rejected the playbook rows on the demo master cast. This file admits it. The kind list
-- below MUST equal pg_registry._ENTITY_KINDS; guarded by test_entities_kind_check_covers_written_kinds.
--
-- ⚡ REPLAY COST (gc-demo-clones-0724): like 0009, the ADD is GUARDED so a normal bootstrap does a
-- catalog lookup and skips (no full-table re-validation, no ACCESS EXCLUSIVE lock) — the plain
-- re-ADD is what compounded the 2026-07-23 deploy stall as the entities table grew. It still applies
-- on a fresh DB or when the kind list is edited in place. ADDITIVE — a strict SUPERSET of 0001's set,
-- so the ADD can never reject an existing row. Idempotent + replay-safe.

SET search_path = avery, public, extensions;

DO $mig$
DECLARE
    have text;
    -- Keep this array identical to the ADD below (test_entities_kind_check_covers_written_kinds pins
    -- both to pg_registry._ENTITY_KINDS). Compared after the same normalization 0009 uses.
    want text := 'CHECK (kind = ANY (ARRAY[''person'',''project'',''signal'',''playbook'']::text[]))';
BEGIN
    SELECT pg_get_constraintdef(oid) INTO have
    FROM pg_constraint
    WHERE conrelid = 'avery.entities'::regclass
      AND conname  = 'entities_kind_check'
      AND contype  = 'c'
      AND convalidated;

    IF have IS NULL
       OR regexp_replace(regexp_replace(lower(have), '::[a-z0-9\[\] ]+', '', 'g'),
                         '[^a-z0-9<>=-]', '', 'g')
          <> regexp_replace(regexp_replace(lower(want), '::[a-z0-9\[\] ]+', '', 'g'),
                            '[^a-z0-9<>=-]', '', 'g')
    THEN
        ALTER TABLE avery.entities DROP CONSTRAINT IF EXISTS entities_kind_check;
        ALTER TABLE avery.entities ADD CONSTRAINT entities_kind_check CHECK (
            kind = ANY (ARRAY['person', 'project', 'signal', 'playbook']::text[])
        );
    END IF;
END
$mig$;
