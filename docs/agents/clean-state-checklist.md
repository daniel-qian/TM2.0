# Clean State Checklist

Use this at session start and before ending a session. Keep it mechanical; if any item fails, record the gap in `progress.md` or the active feature evidence instead of relying on chat history.

## Start Of Session

1. Confirm location:
   - `git rev-parse --show-toplevel`
   - `git branch --show-current`
   - `git status --short --branch`
   - `git worktree list --porcelain`
2. Confirm active harness state:
   - Read `AGENTS.md`.
   - Read `feature_list.json`.
   - Read `progress.md`.
   - Read `session-handoff.md` only when the work spans multiple sessions or parallel lines.
3. Confirm baseline:
   - Run `./init.sh` before writing code, or record why a cheaper check is enough.
4. Pick exactly one feature:
   - The feature must be present in `feature_list.json`.
   - Dependencies must already be `done`.
   - Update status and `evidence` together when state changes.
5. Check agent config visibility:
   - `git status --short .claude .codex`
   - `.claude/settings.local.json`, worktrees, caches, and local temp files may stay local.
   - Hook config and hook scripts must be tracked when they become project policy.

## End Of Session

1. Reconfirm branch and worktree:
   - Current branch is expected for this task.
   - If inside a git worktree, do not rewrite root narrative files unless Danny explicitly says this is the only active line.
2. Reconfirm dirty state:
   - `git status --short`
   - Separate in-scope changes from pre-existing local noise.
   - Do not sweep unrelated `.claude/`, `marketing/`, generated output, or local temp files into a commit.
   - When several agents share one working tree: `git add` only the files you were assigned. Never `git commit -a` / `git commit <path>` on someone else's in-flight edits.
3. Reconfirm verification:
   - For code/types/routes/state/import changes: run `./init.sh` or `npm run build`.
   - For docs-only harness changes: run the relevant script checks plus `git diff --check`.
   - If a failure path is claimed, run that failure path for real.
4. Reconfirm state files:
   - `feature_list.json` status and `evidence` match what actually ran.
   - `progress.md` has What's Done / In Progress / Next steps / Blockers / Files Modified, unless this is a worktree line that must leave root narrative files to the integrator.
   - `session-handoff.md` names current blockers, modified files, and next step when the work is large enough to need handoff.
5. Reconfirm hooks are live if hooks changed:
   - Run `node scripts/audit-hooks.mjs`.
   - Every configured hook command that points into this repo must resolve to an existing file.
   - Every configured hook script should have git history: `git log --all -- <exact path>`.
   - Deleted hook scripts must have their config entry removed in the same change.

6. If anything was deployed this session:
   - Record the source SHA of the running production image in the deploy receipt.
   - If that SHA is not `main`, say so explicitly and name what `git diff <SHA> main` still excludes. An undeclared gap here is how five fixes sat unshipped for two days on 2026-07-20.

## Main Fast Lane Rule

This repo often uses `main` as a local fast lane. Do not hard-block `git commit` on `main` by default. Use branch/worktree banners and explicit status output first; reserve hard blocks for known destructive or clearly wrong commands.

