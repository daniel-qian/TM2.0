-- feat-034 stage C — Ask ("Quick ask" / 快问): the agent-drafted, manager-confirmed, one-person-
-- one-link employee self-report loop (PRD .issues/ask-card-0713/PRD.md, ADR-0023).
--
-- Increment-only, avery-scoped, idempotent (CREATE ... IF NOT EXISTS) — never touches public/
-- existing objects, never DROPs anything. Replayed by the registry's _ensure_schema() on each
-- bootstrap (the SAME files applied to Supabase, so local<->prod schema equivalence holds by
-- construction).
--
-- 🔴 RED LINE (ADR-0023): the receipt is SITUATIONAL EVIDENCE, never a person attribute — it hangs
-- off (ask, recipient), NOT off avery.entities, so the person-key allowlist CHECK (migration 0002)
-- keeps guaranteeing no number can land on a person row. Question/prompt text is FREE TEXT gated by
-- the Python write path (ask.gate_ask_red_line -> the UNCHANGED avery.redline.validate, EN+ZH,
-- two-tier via AVERY_ALLOW_PERSON_SCORING) BEFORE any INSERT — same discipline as company_notes.
--
--   avery.asks            one row per quick ask. `status` vocabulary is SERVER-OWNED and pinned
--                         by the CHECK: draft | shared | collecting | closed | revoked | expired
--                         (the stage-C F1 fix depends on the server never inventing a 7th word).
--                         `expires_at` defaults to now()+7d (PRD Q8). `generation_mode` records
--                         HONESTLY where the questions came from: manager | llm | template.
--   avery.ask_recipients  one row per named recipient (PRD Q4: one-person-one-link). `share_token`
--                         is the unguessable employee credential (UNIQUE; NULL until shared).
--                         `answers` JSONB [{question_id, value}] lands ONCE — the answer-once lock
--                         is enforced by the write path (UPDATE ... WHERE answered_at IS NULL).

SET search_path = avery, public, extensions;

CREATE TABLE IF NOT EXISTS avery.asks (
    id              text PRIMARY KEY,
    context_id      text NOT NULL REFERENCES avery.contexts(context_id) ON DELETE CASCADE,
    status          text NOT NULL DEFAULT 'draft' CHECK (
                        status IN ('draft', 'shared', 'collecting', 'closed', 'revoked', 'expired')),
    thread_hint     text NOT NULL DEFAULT '',
    questions       jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{id, kind: scale|yesno, text}] (1..3)
    comment_prompt  text NOT NULL DEFAULT '',
    generation_mode text NOT NULL DEFAULT 'manager',       -- manager | llm | template (honest label)
    created_at      timestamptz NOT NULL DEFAULT now(),
    expires_at      timestamptz NOT NULL DEFAULT now() + interval '7 days'
);

CREATE INDEX IF NOT EXISTS asks_ctx_idx ON avery.asks (context_id);

CREATE TABLE IF NOT EXISTS avery.ask_recipients (
    ask_id       text NOT NULL REFERENCES avery.asks(id) ON DELETE CASCADE,
    idx          integer NOT NULL,
    person_id    text NOT NULL DEFAULT '',
    person_name  text NOT NULL,
    share_token  text,                                     -- NULL until shared; unguessable, one-shot
    answers      jsonb,                                    -- NULL until answered; [{question_id, value}]
    comment      text NOT NULL DEFAULT '',
    answered_at  timestamptz,
    PRIMARY KEY (ask_id, idx)
);

CREATE UNIQUE INDEX IF NOT EXISTS ask_recipients_share_token_key
    ON avery.ask_recipients (share_token) WHERE share_token IS NOT NULL;

-- The employee read path is "resolve one link" — index the token lookup (partial index above
-- already serves it); the manager read path is "this ask's recipients in order" (the PK serves it).
