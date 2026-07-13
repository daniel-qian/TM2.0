# feat/033 — Avery's notes · session handoff

status: done (AFK, gate-first) · date: 2026-07-13 · branch: `feat/033-avery-notes` (NOT pushed)
base: `feat/032-file-space` tip `e060224`
commits: `221550b` (backend RED→GREEN) · `8a9a5b1` (frontend + gate) · (this) feature_list + handoff

## What shipped

An "activated agent" touchpoint: after every `/advise`, the service appends Avery's own
observation about the company (the advice `read` — already work-focused, already past the advisor
red line) into a **persistent, user-visible, cross-session, accumulating** notebook. Distinct from
the read-only doc-derived `notes.md` — this is agent-WRITTEN.

- **Write hook** lives in the service layer (`service/notes.py` + a post-advise step in
  `service/app.py`), NOT the frozen engine. No extra LLM call (derived from the manifest the engine
  already produced).
- **Persistence** rides feat-030: new table `avery.company_notes` (migration `0006`, additive,
  avery-scoped). `append_note` / `list_notes` (newest-first) on BOTH the in-memory and Postgres
  registries; Postgres accumulates across sessions/restarts.
- **API**: `GET /team/{id}/notes` — read-only, newest-first, `[{id, created_at, text, source_excerpt}]`.
- **Frontend**: 5th lite tab "Avery's notes" (after The room) — day-grouped read-only entries,
  persistent red-line trust bar, is-new highlight, empty state, source line → Room; Room shows a
  "Avery added a note →" nudge only after the backend confirms a note landed.

## 🔴 Red line (the命门 — the most load-bearing new face of the moat)

The self-written note must never score/rank/profile a person. **Two independent layers reuse the
UNCHANGED `avery.redline.validate` (EN+ZH) — nothing new, nothing weakened:**

1. `registry.append_note()` runs `gate_note_red_line` (→ `redline.validate`) BEFORE any store/INSERT
   in both registries — a crossing observation raises `ValueError`, nothing lands (the storage door,
   like feat-030's `_gate_red_line`).
2. `service.notes.write_note_from_manifest` re-validates the observation **and the echoed question
   excerpt** independently; a crossing one is DISCARDED — no note, no nudge, no "what it wanted to
   write" placeholder (honest degradation). It also skips when the advice's own gate flagged a
   crossing, or when there is no company context.

The excerpt is gated too because it is echoed onto the user-visible surface — so the notebook never
displays scoring text from ANY origin (observation or the manager's own quoted question).

## Test evidence (three layers)

- **Offline (zero network)**: `389 passed` (was 348) with empty keys. New: `test_notes_redline.py`
  (EN+ZH adversarial write-side battery hitting `append_note` AND the hook), `test_notes_http.py`
  (mock-brain advise accumulation + endpoint contract + 404 + crossing-question discard),
  `test_registry_contract.py` notes contract (append/list/refuse, shared memory+pg).
- **@needs_db (local Docker pg :5433)**: `30 passed` (was 23). New pg durability:
  notes accumulate + survive a brand-new registry instance (restart), scoring observation refused
  before INSERT.
- **Frontend (agent as first user)**: `./init.sh` exit 0 (lint wall + tsc + build). Dev-server DOM
  assertions (dev-verify :5233, stubbed transport, no LLM — screenshots time out so used read_page +
  javascript_tool computed values): tab position; empty state (eyebrow/title/trust bar/CTA, zero
  numbers); populated (day-grouping today-expanded/older-collapsed, is-new, count line, source line,
  read-only entries, collapse toggle, zero-number red line on observations); Room nudge appears only
  when backend-confirmed count grew, clickable, navigates to the notes tab. `src/story/**` unchanged.

## Supabase

Migration `0006_company_notes` applied to `nunsbijtntreynoyeilp` (avery schema only); columns
verified. `public` (imaread) untouched. Runtime connect = set `AVERY_DB_URL` (schema self-bootstraps).

⚠ **RLS advisory (pre-existing, NOT introduced here)**: every `avery.*` table has RLS disabled
(since feat-030). Tenant isolation is feat-034's job. Not auto-changed — surface to Danny.

## UX decision defaults (act-first per kickoff; for Danny's spot-check)

1. Tab name **"Avery's notes"**, placed **after The room**.
2. Source line **shows the ~60-char question excerpt** (provenance).
3. Room **nudge is ON** (only when a note actually landed).
4. v1 is **read-only — no delete endpoint** (matches the data-handling "contact us to delete" line).

## Self-assessed weak points (adversarial validation should probe here)

- **Red-line bypass surface is the most load-bearing.** Covered by a direct-injection battery
  (EN+ZH) at `append_note` + the hook + the storage door + the DB-refusal-before-INSERT. The
  **real-machine crafted end-to-end** (a real brain induced to score a person) is left to the
  independent adversarial workflow + the `@seedgate` layer + the new gate phase K
  (`assertNotesSurface`, runs after `composerAskLive` where a real advise now writes a real note).
- Observation source = advice `read` only (framing left out — the read is the situational
  observation; keeping it read-only is the more restrained default).
- Excerpt gating can drop a legitimate note when the manager's OWN question contains a person score
  (honest degradation, no placeholder). False-positive-safe — never weakens the gate.
- Frontend populated/nudge verified with a **stubbed** transport (deterministic, no LLM); real
  end-to-end is the `@seedgate`/`@needs_keys` layer.
- ZH i18n is HAND-WRITTEN (marked `HAND-WRITTEN, NOT YET M3` in zh.ts) — the generator is
  full-regen only; fold into the next directed M3 pass. Danny 审字 pending.

## Discipline check

Untouched (git-verified): `avery/redline.py`, `avery/ingest/redline_extract.py`, `PersonEntity`,
`scenarios/FROZEN.lock.json`, `avery/loop.py`, `avery/tools.py`, `avery/memory.py`,
extractor↔advisor separation, `src/story/**`. Red-line reused, never weakened. Not pushed (对外闸 =
Danny).
