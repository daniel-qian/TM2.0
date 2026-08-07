-- rich-align-0722/03 + /06 — the person-entity ALLOWLIST, the SOLE + CURRENT definition.
--
-- 🔴 THIS is the one place the person-keys allowlist is defined (0002 was reduced to dropping the old
-- denylist — see its header for why). The list below MUST equal PersonEntity's CURRENT fields. When
-- PersonEntity gains a field, EDIT THE ARRAY BELOW IN PLACE — do NOT add a superseding migration:
-- that would leave a stale strict subset that aborts bootstrap the moment a row carries the newer key.
-- Guarded by test_person_keys_allowlist_covers_exactly_person_fields.
--
-- Beyond 0002's pre-03 set (id/name/role/team/tenure/owns/collaboration/source) PersonEntity carries
-- three more own fields:
--   * self_report  (rich-align-0722/03) — the ONE sanctioned numeric slot (typed PersonSelfReport;
--                    projection-gated by AVERY_ALLOW_PERSON_SCORING — 复核项②③). By approved design
--                    the DB恒存自述数据 and the red line executes at the PROJECTION layer, not storage,
--                    so the storage allowlist MUST admit this key.
--   * archived     (rich-align-0722/06) — soft-delete flag (never a physical delete).
--   * provenance   (rich-align-0722/06) — field-level origin side-car {field:{origin,source,...}}.
--   * person_id    (差距战役 T5/A2) — 工号（01 表「人员ID」/铸表单链时经理选的那个 id）。归并的第一
--                    把尺（`extract._resolve_person_slot`）。**结构上仍是同一条护城河**：它是一个
--                    join key，不是可以塞进数字的自由格；每一个不在 PersonEntity 自有字段里的顶层键
--                    照旧被这条 CHECK 拒掉。
--
-- pg_registry.put() writes `asdict(PersonEntity)`, which ALWAYS emits every field (self_report/
-- archived/provenance appear even at their defaults None/False/{}). So a stale allowlist rejects EVERY
-- campaign-code person write to real Postgres — invisible to the offline suite (`not needs_db` never
-- exercises the CHECK), fatal in production (first surfaced on the demo master cast,
-- service/demo.py::_build_master).
--
-- STILL structural, still "the moat as a type": every TOP-LEVEL key outside PersonEntity's own fields
-- stays refused by construction (绩效评分/排名/离职风险, zscore/stack_rank/nine_box, …).
--
-- ⚡ REPLAY COST (gc-demo-clones-0724): _ensure_schema replays this file on EVERY bootstrap. A plain
-- `ALTER TABLE ... ADD CONSTRAINT ... CHECK` re-VALIDATES the whole entities table under an ACCESS
-- EXCLUSIVE lock every time — which, as guest clones grow the table (and against a concurrent claim
-- holding a lock), is what stalled the 2026-07-23 deploy past statement_timeout. So the ADD is now
-- GUARDED: it fires ONLY when a validated constraint with this exact definition is not already
-- present (a catalog lookup — no scan, no lock — on the normal boot where nothing changed). It still
-- (re)applies correctly on a fresh DB, or when the array below is edited in place (the definition no
-- longer matches → DROP + ADD + re-validate once). Idempotent + replay-safe by construction. The apply
-- path's lock wait is bounded by _ensure_schema's lock_timeout (fail-fast + retry, not a 2-min hang).
-- ADDITIVE — the allowlist is a strict SUPERSET of 0002, so the ADD can never reject a pre-03 row.

SET search_path = avery, public, extensions;

DO $mig$
DECLARE
    have text;
    -- The intended CHECK, in natural form. Compared to pg_get_constraintdef(have) after BOTH are
    -- normalized (lowercased, ::casts stripped, everything but [a-z0-9<>=-] stripped) — so the match
    -- is robust to how Postgres re-renders casts/parens across PG majors. Keep this array identical to
    -- the ADD below (test_person_keys_allowlist_covers_exactly_person_fields pins both to PersonEntity).
    want text := 'CHECK (kind <> ''person'' OR (payload - ARRAY['
        '''id'',''name'',''person_id'',''role'',''team'',''tenure'',''owns'',''collaboration'','
        '''source'',''self_report'',''archived'',''provenance'']::text[]) = ''{}''::jsonb)';
BEGIN
    SELECT pg_get_constraintdef(oid) INTO have
    FROM pg_constraint
    WHERE conrelid = 'avery.entities'::regclass
      AND conname  = 'entities_person_keys_allowlist'
      AND contype  = 'c'
      AND convalidated;

    IF have IS NULL
       OR regexp_replace(regexp_replace(lower(have), '::[a-z0-9\[\] ]+', '', 'g'),
                         '[^a-z0-9<>=-]', '', 'g')
          <> regexp_replace(regexp_replace(lower(want), '::[a-z0-9\[\] ]+', '', 'g'),
                            '[^a-z0-9<>=-]', '', 'g')
    THEN
        ALTER TABLE avery.entities DROP CONSTRAINT IF EXISTS entities_person_keys_allowlist;
        ALTER TABLE avery.entities ADD CONSTRAINT entities_person_keys_allowlist CHECK (
            kind <> 'person'
            OR (payload - ARRAY[
                'id', 'name', 'person_id', 'role', 'team', 'tenure', 'owns', 'collaboration',
                'source', 'self_report', 'archived', 'provenance'
            ]::text[]) = '{}'::jsonb
        );
    END IF;
END
$mig$;
