#!/usr/bin/env node
// WorktreeRemove hook — runs when Claude Code removes a `--worktree` workspace.
// Contract (https://code.claude.com/docs/en/hooks#worktreeremove):
//   stdin:  JSON with { worktree_path, base_path, cwd, ... }
//   stderr: all logs (removal proceeds regardless of exit code, so this hook does
//           the actual `git worktree remove` itself and archives dirty state first
//           instead of silently destroying it)
//
// 🔴 avery-specific (memory: worktree-teardown-junction-trap):
//   node_modules in each worktree is a JUNCTION to the main checkout. If we let
//   `git worktree remove` (or any recursive delete) run while that junction is still
//   attached, the delete recurses THROUGH it and wipes the SHARED node_modules —
//   breaking the main checkout and every other worktree. So we DETACH the junction
//   (rmdir the link, which never touches the target) BEFORE removing the worktree.
//
// Never deletes the branch; never touches harness files
// (feature_list.json / progress.md / session-handoff.md).

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const log = (msg) => process.stderr.write(`[worktree-remove] ${msg}\n`);
const fail = (msg) => {
  log(`ERROR: ${msg}`);
  process.exit(1);
};

function git(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

// ---- read + parse stdin -----------------------------------------------------
let input;
try {
  input = JSON.parse(fs.readFileSync(0, "utf8"));
} catch {
  fail("could not parse JSON from stdin");
}

const rawPath = input.worktree_path;
if (typeof rawPath !== "string" || rawPath.length === 0) fail("worktree_path is empty");
if (!path.isAbsolute(rawPath)) fail(`worktree_path must be absolute: ${rawPath}`);
const wtPath = path.resolve(rawPath);
if (wtPath === path.parse(wtPath).root) fail("refusing to remove filesystem root");

// ---- locate repo root -------------------------------------------------------
const hookCwd = input.cwd || process.cwd();
let repoRoot;
try {
  repoRoot = git(["rev-parse", "--show-toplevel"], hookCwd).trim();
} catch {
  repoRoot = input.base_path;
}
if (!repoRoot || !fs.existsSync(repoRoot)) fail("could not determine repository root");
if (wtPath === path.resolve(repoRoot)) fail("refusing to remove the main repository checkout");

// ---- confirm it really is a registered linked worktree -----------------------
const registered = git(["worktree", "list", "--porcelain"], repoRoot)
  .split("\n")
  .filter((line) => line.startsWith("worktree "))
  .map((line) => path.resolve(line.slice("worktree ".length)));
if (!registered.includes(wtPath)) fail(`not a registered git worktree: ${wtPath}`);

if (!fs.existsSync(wtPath)) {
  log(`directory already gone, pruning stale registration: ${wtPath}`);
  git(["worktree", "prune"], repoRoot);
  process.exit(0);
}

// ---- archive dirty state instead of silently destroying it -------------------
let status = "";
try {
  status = git(["status", "--porcelain"], wtPath);
} catch {
  log("WARNING: could not read git status in worktree; skipping archive");
}

if (status.trim().length > 0) {
  log("WARNING: worktree has uncommitted changes — archiving before removal");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const archiveDir = path.join(repoRoot, ".claude", "worktree-archives", `${path.basename(wtPath)}-${stamp}`);
  try {
    fs.mkdirSync(archiveDir, { recursive: true });
    fs.writeFileSync(path.join(archiveDir, "status.txt"), git(["status"], wtPath));
    const diff = git(["diff"], wtPath) + git(["diff", "--cached"], wtPath);
    fs.writeFileSync(path.join(archiveDir, "diff.patch"), diff);
    const untracked = git(["ls-files", "--others", "--exclude-standard"], wtPath);
    fs.writeFileSync(path.join(archiveDir, "untracked-files.txt"), untracked);
    log(`archived status/diff/untracked-list to ${archiveDir}`);
  } catch (err) {
    log(`WARNING: archive failed (${err.message}); proceeding with removal anyway`);
  }
}

// ---- 🔴 detach the node_modules junction FIRST (before any delete) -----------
// lstat reports a Windows directory junction as a symlink. Only rmdir the LINK
// (never a real node_modules dir) — rmdir on a junction removes the link, not the
// target's contents. A real directory here would make rmdir fail, which is the
// safety net we want (we never want to delete a real node_modules).
const wtNodeModules = path.join(wtPath, "node_modules");
try {
  if (fs.existsSync(wtNodeModules) && fs.lstatSync(wtNodeModules).isSymbolicLink()) {
    execFileSync("cmd", ["/c", "rmdir", wtNodeModules], {
      stdio: ["ignore", process.stderr, process.stderr],
    });
    log("detached node_modules junction (shared tree untouched)");
  }
} catch (err) {
  fail(`could not detach node_modules junction (${err.message}); ABORTING before removal ` +
    `so the shared node_modules is never at risk — detach it manually then retry`);
}

// ---- remove the worktree (branch is intentionally left alone) -----------------
try {
  git(["worktree", "remove", "--force", wtPath], repoRoot);
  log(`removed worktree ${wtPath} (branch kept)`);
} catch (err) {
  fail(`git worktree remove failed (exit ${err.status ?? "?"})`);
}
