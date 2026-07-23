-- rich-align-0722/08 — admit the "playbook" entity kind into entities_kind_check.
--
-- 0001 declared `kind text NOT NULL CHECK (kind IN ('person','project','signal'))` (auto-named
-- entities_kind_check). Slice 08 (playbooks/方法库) added a fourth entity kind — pg_registry.put()
-- writes rows with kind='playbook' (see _ENTITY_KINDS) — but no migration extended the CHECK. So
-- real Postgres rejects the playbook rows: the demo master cast (service/demo.py::_build_master ->
-- pg_registry.put) fails with `violates check constraint "entities_kind_check"` the moment it tries
-- to persist a method card. Invisible to the offline suite (`not needs_db` never exercises the CHECK),
-- fatal in production — surfaced right after 0009 unblocked the person writes.
--
-- Idempotent: DROP IF EXISTS + ADD, replayed on every _ensure_schema bootstrap. ADDITIVE — the new
-- set is a strict SUPERSET of 0001's, so ADD CONSTRAINT can never reject an existing row.

SET search_path = avery, public, extensions;

ALTER TABLE avery.entities DROP CONSTRAINT IF EXISTS entities_kind_check;

ALTER TABLE avery.entities ADD CONSTRAINT entities_kind_check CHECK (
    kind = ANY (ARRAY['person', 'project', 'signal', 'playbook']::text[])
);
