-- rich-align-0722/03 + /06 — the person-entity ALLOWLIST, the SOLE + CURRENT definition.
--
-- 🔴 THIS is the one place the person-keys allowlist is defined (0002 was reduced to dropping the old
-- denylist — see its header for why). pg_registry._ensure_schema replays this file on every bootstrap
-- and its ADD re-VALIDATES every existing row, so the list below MUST equal PersonEntity's CURRENT
-- fields. When PersonEntity gains a field, EDIT THE ARRAY BELOW IN PLACE — do NOT add a superseding
-- migration: that would leave this ADD a stale strict subset that aborts bootstrap the moment a row
-- carries the newer key. Guarded by test_person_keys_allowlist_covers_exactly_person_fields.
--
-- Beyond 0002's pre-03 set (id/name/role/team/tenure/owns/collaboration/source) PersonEntity carries
-- three more own fields:
--   * self_report  (rich-align-0722/03) — the ONE sanctioned numeric slot (typed PersonSelfReport;
--                    projection-gated by AVERY_ALLOW_PERSON_SCORING — 复核项②③). By approved design
--                    the DB恒存自述数据 and the red line executes at the PROJECTION layer, not storage,
--                    so the storage allowlist MUST admit this key.
--   * archived     (rich-align-0722/06) — soft-delete flag (never a physical delete).
--   * provenance   (rich-align-0722/06) — field-level origin side-car {field:{origin,source,...}}.
--
-- pg_registry.put() writes `asdict(PersonEntity)`, which ALWAYS emits every field (self_report/
-- archived/provenance appear even at their defaults None/False/{}). So the stale 0002 allowlist
-- rejected EVERY campaign-code person write to real Postgres — invisible to the offline suite
-- (`not needs_db` never exercises the CHECK), fatal in production (first surfaced on the demo master
-- cast, service/demo.py::_build_master). This realignment is exactly what 0002 intended: "a person
-- payload may carry ONLY the keys PersonEntity actually has" — that enumeration simply went stale.
--
-- STILL structural, still "the moat as a type": every TOP-LEVEL key outside PersonEntity's own
-- fields stays refused by construction (绩效评分/排名/离职风险, zscore/stack_rank/nine_box, …). The
-- three added keys are PersonEntity's own typed fields, not an open door.
--
-- Idempotent: DROP IF EXISTS + ADD, replayed on every _ensure_schema bootstrap (the same file the
-- backend applies to Supabase). ADDITIVE — the new allowlist is a strict SUPERSET of 0002, so ADD
-- CONSTRAINT can never reject a row that 0002 already accepted (existing pre-03 person rows pass
-- unchanged).

SET search_path = avery, public, extensions;

ALTER TABLE avery.entities DROP CONSTRAINT IF EXISTS entities_person_keys_allowlist;

ALTER TABLE avery.entities ADD CONSTRAINT entities_person_keys_allowlist CHECK (
    kind <> 'person'
    OR (payload - ARRAY[
        'id', 'name', 'role', 'team', 'tenure', 'owns', 'collaboration', 'source',
        'self_report', 'archived', 'provenance'
    ]::text[]) = '{}'::jsonb
);
