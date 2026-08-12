-- rich-align-0722/08 — admit the "playbook" entity kind into entities_kind_check.
-- 差距战役 T6/B2a (2026-08-06) — 同一条 CHECK 再收一个 kind: "conflict"（归并丢弃的读数）。
-- issue #93 (2026-08-12) — 同一条 CHECK 再收一个 kind: "ruling"（粒度闸的裁决记录）。补传路
--   从此会**折叠**项目卡（rejudge.py），而「每一次降级都说得出为什么」是这个模块唯一的合法性
--   根据——裁决不落库，容器一重启「这张卡为什么不见了」就永远答不出来。
--
-- ⚠ 为什么是**就地改这一条**而不是新加一个 0013：`test_entities_kind_check_covers_written_kinds`
-- 扫的是 db/migrations/*.sql 里**每一条** `ADD CONSTRAINT entities_kind_check`，要求它们**全部**
-- 等于 pg_registry._ENTITY_KINDS。新加一条超越迁移，会让这里这条旧的当场变成 out-of-sync 而门红；
-- 更要命的是 `_ensure_schema` 每次引导都重放全部迁移，留着一条严格子集的 ADD，等于在库里有 conflict
-- 行之后每次引导都拿旧 CHECK 重验全表 → 「violated by some row」→ 引导中止、整个后端起不来
-- （0002 的 8 键 allowlist 就这样炸过一次，见 0009 的文件头）。**加 kind 改这一条，永不叠新的。**
-- 集合仍是 0001 那三个的严格超集，ADD 不可能拒掉任何既有行。
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
    want text := 'CHECK (kind = ANY (ARRAY[''person'',''project'',''signal'',''playbook'',''conflict'',''ruling'']::text[]))';
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
            kind = ANY (ARRAY['person', 'project', 'signal', 'playbook', 'conflict',
                              'ruling']::text[])
        );
    END IF;
END
$mig$;
