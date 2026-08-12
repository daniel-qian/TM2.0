-- issue #90 — the async-deposit job table: "字节保管" and "理解（LLM 抽取）" stop sharing one
-- synchronous HTTP request. POST /ingest and POST /team/{id}/files now write the uploaded bytes +
-- a `queued` job row in ONE transaction and return in seconds; an in-process worker thread claims
-- the job (queued -> processing), runs parse/extract/merge, and lands the result (done / failed).
--
-- Why a DB table and not an in-memory queue: the 2026-08 exploration (侦查线 A1, 方案 C) required an
-- honest answer to "容器重启任务丢了怎么办". A queued row survives the restart and simply runs when
-- the worker comes back; a processing row whose worker died is detected at startup (nobody in this
-- process claimed it) and marked `failed: server restarted` — the exact recovery the pure-in-memory
-- `_BUILD_LOCK` precedent never had (restart wiped it, stuck states leaked forever).
-- 🔴 OPS CONSTRAINT that recovery model implies: swap containers STOP-OLD-THEN-START-NEW. During
-- an overlap window the new container's startup recovery would mark the old container's live
-- `processing` job failed while it is still running. The current swap runbook already does this;
-- this line exists so a future runbook change trips over it.
--
--   id               job handle ("job_<16hex>", minted by the depositing endpoint)
--   context_id       the workspace this job lands into. NO foreign key ON PURPOSE: a failed/done job
--                    row is an audit record of an upload attempt — deleting the context (GC sweep,
--                    ops delete()) must not be blocked by it, and a cascade would erase the audit
--                    trail the /files task summary reads. Orphaned rows are harmless bookkeeping.
--   kind             'ingest' (a fresh context) | 'append' (补传 into an existing one)
--   status           queued -> processing -> done | failed
--   reason           human-readable failure reason ('' while healthy) — the /files task summary
--                    surfaces it so the frontend can say WHY instead of a silent spinner.
--   extraction_mode  the honest #89 label (llm / heuristic / degraded), recorded at completion —
--                    the POST response no longer carries a final extraction_mode (it returns before
--                    extraction starts), so the polling surface reads it from here.
--   file_keys        the source_keys this job is responsible for (jsonb array). Startup recovery
--                    uses it to drop the orphaned 'reading' file rows of a mid-flight job.
--
-- Increment-only, avery-scoped, idempotent (CREATE ... IF NOT EXISTS) — never touches public/
-- existing objects, never DROPs anything. Replayed by _ensure_schema() on each bootstrap (the SAME
-- file applied to Supabase, so local<->prod schema equivalence holds by construction).
--
-- 🔴 RED LINE: unchanged. This table holds upload lifecycle state, no person data. The red-line gate
-- itself still runs where it always did (extract -> validate_extraction, before anything persists an
-- extraction) — it just runs inside the worker now, and a refusal lands as status='failed'.

SET search_path = avery, public, extensions;

CREATE TABLE IF NOT EXISTS avery.ingest_jobs (
    id              text PRIMARY KEY,
    context_id      text NOT NULL,
    kind            text NOT NULL CHECK (kind IN ('ingest', 'append')),
    status          text NOT NULL DEFAULT 'queued'
                    CHECK (status IN ('queued', 'processing', 'done', 'failed')),
    reason          text NOT NULL DEFAULT '',
    extraction_mode text NOT NULL DEFAULT '',
    file_keys       jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

-- The /files task summary reads "this context's newest job" on every poll — index the exact scan.
CREATE INDEX IF NOT EXISTS ingest_jobs_context_created_idx
    ON avery.ingest_jobs (context_id, created_at DESC);

-- The worker's claim scan and the startup orphan sweep both want only live rows; a partial index
-- stays tiny (done/failed rows dominate over time and are never scanned by either).
CREATE INDEX IF NOT EXISTS ingest_jobs_live_idx
    ON avery.ingest_jobs (status, created_at) WHERE status IN ('queued', 'processing');
