-- feat-053 — the account seam: a Supabase auth user -> the company context(s) they own.
--
-- Increment-only, avery-scoped, idempotent (CREATE ... IF NOT EXISTS) — never touches public/
-- existing objects, never DROPs anything. Replayed by the registry's _ensure_schema() on each
-- bootstrap (the SAME files applied to Supabase, so local<->prod schema equivalence holds by
-- construction).
--
-- WHY A MAPPING TABLE AND NOT A COLUMN ON avery.contexts:
-- feat-038's owner_token STAYS the lower-layer credential and is NOT replaced (PRD G1: "owner_token
-- 保留在下层不动"). This table sits ABOVE it: the service resolves user -> context_id here, then
-- reads the context through the UNCHANGED feat-038 gate. Nothing about tenant isolation is rewritten
-- — an account is simply a second, durable way to prove you own a context you already owned. A
-- context with no row here is an ANONYMOUS context and behaves exactly as it did before feat-053
-- (owner_token only), which is what keeps the guest path working.
--
--   avery.account_contexts   (user_id, context_id) pairs. `user_id` is the Supabase auth user id
--                            (the JWT `sub` — a uuid, stored as text so this table carries NO FK
--                            into the auth schema and the offline/local Postgres path needs no
--                            Supabase auth tables to exist). A user may own SEVERAL contexts (they
--                            upload again and get a fresh context); a context has AT MOST ONE owner
--                            account, enforced by the UNIQUE index on context_id below — that
--                            uniqueness is the actual "两个账号数据不串" guarantee at the storage
--                            layer, not just a service-layer check.
--
-- 🔴 RED LINE: unchanged. This table holds NO person data — only two opaque ids. The person-key
-- allowlist CHECK (migration 0002) and the write-side red line are untouched by feat-053.

SET search_path = avery, public, extensions;

CREATE TABLE IF NOT EXISTS avery.account_contexts (
    user_id     text NOT NULL,
    context_id  text NOT NULL REFERENCES avery.contexts(context_id) ON DELETE CASCADE,
    created_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, context_id)
);

-- One context belongs to at most ONE account. A second account trying to claim an already-claimed
-- context violates this and is refused at the storage door (the service surfaces it as a 404 — the
-- same no-existence-oracle answer feat-038 gives, so a claim probe never confirms a context exists).
CREATE UNIQUE INDEX IF NOT EXISTS account_contexts_context_key
    ON avery.account_contexts (context_id);

-- The manager read path is "which contexts does this signed-in user own", newest first.
CREATE INDEX IF NOT EXISTS account_contexts_user_idx
    ON avery.account_contexts (user_id, created_at DESC);
