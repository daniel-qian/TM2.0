# Agent Evaluator Rubric

Use this after a substantial agent session or before accepting a feature as `done`. Score each dimension `0`, `1`, or `2`, then choose `Accept`, `Revise`, or `Block`.

## Scoring

### 1. Correctness

- `2`: The delivered behavior matches the selected feature and project ADRs.
- `1`: Mostly correct, but has a small mismatch, vague edge case, or unresolved human-review item.
- `0`: Solves the wrong problem, contradicts an ADR, or leaves the requested behavior absent.

### 2. Verification

- `2`: Required checks were actually run and evidence says exactly what passed. Claimed failure paths were exercised for real.
- `1`: Success path was checked, but evidence is thin, manual verification is underspecified, or a low-risk failure path was inferred.
- `0`: Verification is missing, stale, or based on reasoning instead of execution.

Hard rule: do not give `2` for Verification if a failure path is claimed but was not actually run. "Should fail" is not evidence.

### 3. Scope Discipline

- `2`: Work stayed inside one feature or clearly documented harness ticket.
- `1`: Minor adjacent cleanup happened, but it is explained and low-risk.
- `0`: Unrelated refactors, broad rewrites, or governance sprawl entered the change.

### 4. Reliability / Restartability

- `2`: A fresh session can continue from repo files alone; generated or local-only state is not required.
- `1`: Mostly restartable, but one decision or artifact is still only partly documented.
- `0`: Next session would need chat memory, local-only files, or guesswork.

### 5. Maintainability

- `2`: Files are short, routed from `AGENTS.md`, and follow existing repo style.
- `1`: Understandable but a little wordy, duplicated, or underspecified.
- `0`: Adds stale-prone process, hidden coupling, or unclear ownership.

### 6. Handoff Readiness

- `2`: Next step, blockers, modified files, and verification evidence are explicit.
- `1`: Handoff exists but misses one of next step, blockers, files, or evidence.
- `0`: No useful handoff; status must be reconstructed.

## Decision

- `Accept`: Total score `10-12`, no dimension below `1`, and Verification is `2` for code or hook changes.
- `Revise`: Total score `7-9`, or one dimension is `0` but the issue is locally fixable.
- `Block`: Total score below `7`, Verification is `0` on code/hook changes, or the result contradicts project scope/ADR rules.

## Repo-Specific Calibration

Demo UI work:

- Must respect ADR-0015 framing and avoid machine-judging people.
- Manual `npm run dev` visual evidence matters when behavior or layout changed.
- New Venus-facing copy is finalized and shipped by the agent (先斩后奏) — do NOT dock points for a missing `待 Danny 审字` marker; that gate is retired (see AGENTS.md · Autonomy & gates).

Eval-harness work:

- Mock-green is not real-green. Label mock and real runs separately.
- Failure-path gates must be run with adversarial or intentionally bad input before claiming robustness.
- Scorecards must distinguish publishable evidence from self-authored scenario coverage.

Docs / strategy work:

- Keep root files as short routing surfaces.
- Put reference docs under `docs/`.
- Do not add quality ledgers, SOP libraries, or governance packs unless a repeated failure justifies them.

