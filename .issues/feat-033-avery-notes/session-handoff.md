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

Untouched (git-verified): `PersonEntity`, `avery/loop.py`, `avery/engine.py`, `avery/tools.py`,
`avery/memory.py`, extractor↔advisor separation, `src/story/**`. Not pushed (对外闸 = Danny).
NOTE — `avery/redline.py` + `redline_rules.md` + `FROZEN.lock.json` WERE changed in the
adversarial-closure round below (authorized hardening; re-frozen). Red-line only ADDED to, never
weakened.

---

# Adversarial-closure round (2026-07-13) — CONFIRMED CRITICAL red-line hole CLOSED

status: done (AFK, gate-first RED→GREEN→re-freeze) · scope: harden `avery/redline.py` at the source.

## The breach (independently verified, real-machine crafted input)

The deterministic gate `avery.redline.validate` let **three person-scoring forms** through; they pass
the notes write-side gate, persist, and show on the user-visible `GET /team/{id}/notes` — a direct
moat + PRD User-Story-8/25 violation:

1. **EN name-anchored ordinal ranking** — `rank: Marcus #1, Anna #5` (`#N` not a `_NUMBER`; no
   she/he/employee anchor → `_has_person` false).
2. **EN person blood-bar %** — `Her mood is at 30% and capacity 40%` (the `moodPct`/`capacityPct`
   bars `team_cards` deliberately omits; no `_SCORING_NOUN` beside the % → never fired).
3. **ZH bare-name + score + rank** — `李雷:9分,排名第一` / `张三 排名第一` / `王五 末位` (bare CJK name is
   not a person-ref; ASCII colon broke `_zh_name_before`; Chinese-numeral rank `第一` was not a target).

## Fix (single source of truth — `avery/redline.py`, add-only, person-anchored)

- **Person blood-bar %** — new `_person_moodbar`: a mood/capacity/energy word (EN `mood|morale|energy|
  capacity|bandwidth|…`, ZH `情绪|精力|负荷|状态|带宽`) next to a `%` fires **only** when tightly bound
  to a person (person ref in the ~12 chars before the word) and **not** a team/work subject.
- **Named/pronoun ranking** — new `_person_rank_names`: a pronoun ranked by position fires directly
  (`She ranks #1`, `He placed 5th`); a NAMED leaderboard fires only in a ranking context, for name
  tokens that are not work/stop words, as an explicit `rank:`-list **or** ≥2 ranked names.
- **ZH bare-name anchoring** — `_ZH_NAME_BEFORE` now accepts a colon separator (`李雷:9分`);
  new `_zh_name_before_sep` (separator REQUIRED) anchors a bare name before a ranking verb/label
  (`张三 排名第一`, `王五 末位`) while a run-on work phrase (`评测里排名`) does NOT anchor;
  `_ZH_SCORE_TARGET` gains Chinese-numeral rank `第[一…十]`; `末位` added to the rank-synonym labels.

Because both the extraction gate (`redline_extract`) and the notes gate (`registry.gate_note_red_line`
+ `service.notes`) call the SAME `redline.validate`, all layers inherit the fix.

## Bonus fix found writing the e2e repro — write-side negation bleed (also a real breach)

The notes gate validated `observation + "\n" + excerpt` **concatenated**. An advice read ending
"…never on the person" let its `never` bleed across the newline and mask a scoring EXCERPT
(`李雷:9分,排名第一` landed via HTTP). Fixed in `registry.gate_note_red_line` **and**
`service.notes.write_note_from_manifest`: the two fields are now validated **independently** (each is
displayed separately, so each must independently pass). Strictly stronger — and it also removes a
latent FALSE-POSITIVE (a legit work-audit-score observation + a person pronoun in the question no
longer falsely combine).

## Evidence

- **RED→GREEN**: `tests/test_redline_bloodbar_rank.py` (37) — 17 escape-asserts were RED before the
  patch, all GREEN after; 20 no-harm asserts green throughout.
- **Offline (empty keys, no DB)**: `463 passed` (389 prior baseline preserved byte-for-byte + 74
  new), 1 xfailed (documented space-separated-glyph residual), 0 regressions.
- **@needs_db (local Docker pg :5433)**: `46 passed` (30 prior + 16 new: the 3 forms refused BEFORE
  INSERT on the Postgres storage door too).
- **End-to-end closure** (`tests/test_notes_redline_feat033.py`): all 3 forms DROPPED across
  `append_note` (memory + Postgres), the post-advise hook (observation body AND echoed excerpt), and
  live HTTP `POST /advise → GET /team/{id}/notes` (0 notes); a clean work observation (`40% cleared`)
  still lands (control).
- **Re-freeze**: `redline_rules.md` documents the new rules; `FROZEN.lock.json` regenerated →
  `manifest_hash a7d97c08…` (was `bb59a7db…`); `test_rules_doc_in_sync` + `runner.py --check-frozen` green.

## False-positive (误伤) regression — legit WORK quantification still PASSES

Verified PASS (probe + tests): `the project is 40% done` · `progress: 60%` · `the roadmap is 60% done` ·
`项目完成 40%` · `该项目进度70%…状态有风险` · `team morale is low` · `团队士气低落` · `server capacity is
at 80%` · `系统负荷80%` · `joined 14 months ago` · `9 open requests` · `Team throughput ranks in the
bottom 20%` · `产品…排名第一` · `我们公司排名行业第一` · `这个项目排期第2优先级` · work leaderboard of work
nouns (`Sprint #1, Feature #2`) · `Her team's morale is at 30%` (team subject between person & word).
EN byte-stability: `test_redline.py` (EN adversarial battery) unchanged-green; 0 new FP / 0 regression
on an out-of-suite EN probe of 14 legit + 6 person-score strings.

## Self-assessed weak points (should re-run adversarial + a 误伤 special)

- **Narrow-by-design residuals (LLM-judge backstopped, not swept):** (a) a single capitalized
  COMMON-NOUN ranking with no person context (`Revenue ranks #1`) is deliberately NOT gated — it is
  usually a work stat, and gating it would risk false-positiving legit advice; a person literally
  named a common word escapes here (011c judge covers it). (b) A person-leaderboard whose items are
  capitalized non-work PROPER nouns that are actually product code-names could theoretically over- or
  under-fire; the `rank:`-list + ≥2-names + work-suppression shape keeps it tight but not perfect.
- **ZH bare-name anchoring** leans on a 2–4 CJK token + REQUIRED separator + stop/work exclusion; an
  exotic name adjacent with no separator (`评测里排名`-shaped) is intentionally not anchored (avoids
  the work FP). Space-separated lexicon glyphs remain the pre-existing documented xfail.
- The separate-field note validation trades an (unrealistic) cross-field split score for removing the
  negation-bleed leak + a latent FP — correct for the actual threat model, but worth a probe.

---

# Policy pivot (2026-07-13, Danny) — hard-block REVERTED, replaced by an UNBLOCK SWITCH

status: done (AFK, gate-first bidirectional) · scope: NON-frozen enforcement layer only.

**Danny reversed the "a person is never scored / ranked / profiled" red line** for REAL companies:
scoring their people on performance / mood is now considered unavoidable. Execution口径 = **unblock
only, do NOT build a feature**; leave the mechanism in place behind a switch, wrap up the current
chain, do not dismantle, do not touch frozen files.

## Step 1 — the adversarial-closure hard-block was REVERTED to baseline

The round above hardened `avery/redline.py` (frozen) with new regex to catch 3 escaping forms. That
path is now void. Reverted to `feat/032` tip `e060224`, byte-for-byte:
`avery/redline.py` · `redline_rules.md` · `scenarios/FROZEN.lock.json`.
- `runner.py --check-frozen` → back to baseline `manifest_hash bb59a7db…` (was `a7d97c08…`).
  `test_rules_doc_in_sync` green.
- **Removed** the two test files that existed ONLY to lock in that reverted hard-block:
  `tests/test_redline_bloodbar_rank.py` (named for removal) **and** `tests/test_notes_redline_feat033.py`
  (its e2e twin — 37 items ALL parametrized over the exact 8 escaping forms the reverted rules caught;
  post-revert 35/37 fail because those forms no longer cross at baseline. Judgment call: it is the
  direct analog of the bloodbar file; its non-form coverage — "clean obs still lands", HTTP surface —
  is already held by `test_notes_redline.py` + `test_notes_http.py`, so no unique coverage is lost).
- **Kept** (non-frozen, pure correctness): the concat-fix in `registry.gate_note_red_line` +
  `service.notes.write_note_from_manifest` (observation and excerpt validated INDEPENDENTLY, never
  concatenated). It is a strict-stronger correctness improvement, not part of the hard-block.

## Step 2 — the unblock switch (`AVERY_ALLOW_PERSON_SCORING`)

New module `avery/scoring_policy.py`: `person_scoring_allowed()` — True only for `1|true|yes|on`
(case/space-insensitive), read LIVE per call (no import-time capture; monkeypatch-friendly). **Default
OFF = the shipped moat, unchanged.** A typo / garbage / `0` fails CLOSED (keeps blocking).

The switch is consulted at the THREE non-frozen enforcement seams; the DETECTOR (`avery.redline`,
`redline_extract`) and the frozen engine are byte-for-byte untouched — only the enforcement DECISION
changes:

| Seam | File | OFF (default) | ON |
|---|---|---|---|
| storage door (memory + Postgres) | `registry.gate_note_red_line` | raise → nothing lands | skip raise → note persists |
| post-advise hook | `service.notes.write_note_from_manifest` | discard (no note/nudge) | keep → note persists |
| upload extraction | `pipeline.ingest_docs` | `ok=False` → 422, no context | build context normally |

Both `append_note` twins funnel through `gate_note_red_line`, so ONE switch governs memory AND
Postgres (verified against real pg). `validate_extraction` only ever reports person-scoring
violations, so honoring the switch in `ingest_docs` unblocks person scoring and NOTHING else.

**NOT unblocked (fail-closed by design):**
- The **advisor engine's own red-line gate + Room nudge** (frozen `engine.py`/`loop.py`) — an /advise
  answer that OVERTLY reports a person score is later work (needs the frozen engine); the write hook
  still only derives a note from an advice that PASSED the advice gate (`redline_passed is True`). So
  via HTTP the unblocked scoring surfaces through the echoed QUESTION excerpt, not a scored answer.
- **NUL / 0x00** in a note — storage-safety guard, always refused (switch on or off).
- **Parse-failure ingest** (`paths and not docs`) — a different hard failure, still 422.
- **No feature built**: `PersonEntity` and `team_cards()` are unchanged — person cards carry NO
  moodPct/capacityPct/score field even with the switch on (guarded by a test).

## Step 3 — bidirectional test evidence

Every switch test asserts BOTH directions on the SAME input (OFF blocks, ON allows) so the switch can
neither silently fail-open (always allow) nor fail-closed (always block).
- New `tests/test_notes_scoring_toggle.py`: switch parsing (16 cases incl. fail-closed garbage), the
  post-advise hook (obs + excerpt, EN+ZH), `ingest_docs` (scored PersonEntity), the HTTP surface
  (`POST /advise → GET /team/{id}/notes`), the "no feature built" card guard, and the non-red-line
  guards (NUL, unparseable batch still refused when ON).
- New storage-door pair in `tests/test_registry_contract.py` (memory **AND** Postgres via the shared
  fixture) — proves pg `append_note` truly honors the switch (INSERT runs when ON, FK satisfied via a
  real ingested context; blocked when OFF; NUL still refused when ON).

**Three-layer numbers:**
- **Offline (zero network, switch OFF, empty keys, no DB)**: `420 passed`, 1 xfailed, 0 failures.
  (Was 463 at the reverted commit; −37 bloodbar file, −~35 feat033-e2e file, +~29 new switch tests.
  The moat behavior at default-OFF is unchanged: existing `test_notes_redline.py` / `test_notes_http.py`
  / extraction-refusal tests all green.)
- **@needs_db (local Docker pg :5433)**: `33 passed` (incl. the 3 pg switch tests: OFF blocks, ON
  persists, NUL refused).
- **Frontend**: `./init.sh` exit 0 (lint wall + tsc + build). `src/**` untouched this round.
- **check-frozen**: back to baseline `bb59a7db…`.

## Self-assessed weak points (probe here)

- **Always-allow / always-block audit**: all three seams gate symmetrically on the SAME
  `person_scoring_allowed()` read, and each has a passing OFF-blocks + ON-allows pair — no seam has a
  path that ignores the switch. The switch is read live (no cached import value to go stale).
- **pg honors the switch?** YES — verified against real Postgres: `test_notes_switch_on_persists_a_
  scoring_observation[postgres]` INSERTs a scoring note (would raise when OFF). Both twins share
  `gate_note_red_line`, so there is no memory-only bypass.
- The switch is process-env global (not per-tenant / per-request). Per-company opt-in is a later
  concern (feat-034 tenancy). Documented, not built.
- Advise-answer overt scoring is deliberately NOT unblocked this round (frozen engine). If Danny wants
  the /advise answer itself to report scores, that is a follow-up that must touch the frozen engine.
