#!/usr/bin/env node
// WorktreeCreate hook — replaces Claude Code's default `--worktree` creation.
// Contract (https://code.claude.com/docs/en/hooks#worktreecreate):
//   stdin:  JSON with { worktree_name, base_path, source_ref, cwd, ... }
//   stdout: ONLY the absolute path of the created worktree
//   stderr: all logs
//   exit:   non-zero on any error
//
// Why avery needs this at all (2026-07-22):
//   Without a WorktreeCreate hook, Claude Code's DEFAULT creation puts the
//   worktree under `.claude/worktrees/<name>` and seeds `.claude/` config into it
//   BEFORE `git worktree add` runs. `git worktree add` then aborts with
//   `fatal: '<path>' already exists` (exit 128) and you are left with a config-only
//   EMPTY SHELL: a directory with a `.claude/` folder, no `.git`, no source, no
//   node_modules — and git does not register it. Every avery worktree made that way
//   was a dud; work silently leaked back into the D:/avery main checkout via absolute
//   paths and caused concurrent-write tangles (detached HEAD, 2026-07-22).
//   Reproduced: pre-seed a dir with `.claude/`, then `git worktree add` → exit 128.
//
// Behavior (mirrors the proven D:/Click-Reader hook, adapted for avery):
//   - worktree path: <parent-of-repo>/<repo-basename>-wt-<name>  (SIBLING dir,
//     created by `git worktree add` FIRST so it is never pre-seeded → no "already exists")
//   - branch:        claude/<name>  (from HEAD if missing, reused otherwise)
//   - copies allowlisted local config (names logged, contents never printed)
//   - 🔴 node_modules: a Windows JUNCTION to the main checkout's node_modules —
//     NOT `npm install`. avery's node_modules is large + shared; the standing rule is
//     "worktree 绝不 npm install" (memory: worktree-node-modules-setup). Junction makes
//     `node node_modules/<pkg>/bin/...` resolve immediately, same content as main.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const log = (msg) => process.stderr.write(`[worktree-create] ${msg}\n`);
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

// Claude Code sends `worktree_name`; accept `name` as a fallback for manual runs.
const name = input.worktree_name ?? input.name;

// ---- validate name ----------------------------------------------------------
if (typeof name !== "string" || name.length === 0) fail("worktree name is empty");
if (name.length > 80) fail(`worktree name longer than 80 chars: ${name.length}`);
if (name.includes("..")) fail("worktree name must not contain '..'");
if (name.includes("/") || name.includes("\\")) fail("worktree name must not contain path separators");
if (path.isAbsolute(name)) fail("worktree name must not be an absolute path");
if (!/^[a-zA-Z0-9._-]+$/.test(name)) fail("worktree name may only contain [a-zA-Z0-9._-]");

// ---- locate repo root -------------------------------------------------------
const hookCwd = input.cwd || process.cwd();
let repoRoot;
try {
  repoRoot = git(["rev-parse", "--show-toplevel"], hookCwd).trim();
} catch {
  repoRoot = input.base_path;
}
if (!repoRoot || !fs.existsSync(repoRoot)) fail("could not determine repository root");

// 🔴 SIBLING path, not nested under the repo. Created fresh by git → never pre-seeded.
const targetPath = path.join(path.dirname(repoRoot), `${path.basename(repoRoot)}-wt-${name}`);
if (fs.existsSync(targetPath)) fail(`target path already exists: ${targetPath}`);

const branch = `claude/${name}`;

// ---- create the worktree (git FIRST, before any config seeding) -------------
let branchExists = true;
try {
  git(["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], repoRoot);
} catch {
  branchExists = false;
}

try {
  if (!branchExists) {
    log(`creating branch ${branch} from HEAD`);
    git(["worktree", "add", "-b", branch, targetPath, "HEAD"], repoRoot);
  } else {
    const porcelain = git(["worktree", "list", "--porcelain"], repoRoot);
    if (porcelain.split("\n").includes(`branch refs/heads/${branch}`)) {
      fail(`branch ${branch} is already checked out in another worktree`);
    }
    log(`reusing existing branch ${branch}`);
    git(["worktree", "add", targetPath, branch], repoRoot);
  }
} catch (err) {
  if (err && err.status !== undefined) fail(`git worktree add failed (exit ${err.status})`);
  throw err;
}

// ---- copy allowlisted local config files (names logged, contents never) -----
// avery is a single npm workspace + a Python eval-harness. These are the untracked
// local files a worktree needs to build/preview and run gates the same as main.
const CONFIG_FILES = [".env", ".env.local", ".npmrc", "eval-harness/.env"];
for (const rel of CONFIG_FILES) {
  const src = path.join(repoRoot, rel);
  if (!fs.existsSync(src)) continue;
  const dest = path.join(targetPath, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  log(`copied ${rel}`);
}

// ---- node_modules: JUNCTION to main, never install --------------------------
// 🔴 Do NOT `npm install` (memory: worktree-node-modules-setup — shared big tree,
// installing rewrites/duplicates and burns time). A Windows directory junction
// (mklink /J, no admin needed) makes the worktree share main's node_modules.
// The teardown hook detaches this junction BEFORE `git worktree remove` so removal
// never recurses into and deletes the shared node_modules (memory: worktree-teardown-junction-trap).
const mainNodeModules = path.join(repoRoot, "node_modules");
const wtNodeModules = path.join(targetPath, "node_modules");
if (fs.existsSync(mainNodeModules) && !fs.existsSync(wtNodeModules)) {
  try {
    // mklink is a cmd builtin → must go through `cmd /c`. /J = directory junction.
    execFileSync("cmd", ["/c", "mklink", "/J", wtNodeModules, mainNodeModules], {
      stdio: ["ignore", process.stderr, process.stderr],
    });
    log(`junctioned node_modules → ${mainNodeModules}`);
  } catch (err) {
    // Non-fatal: the worktree exists and is usable; the user can link/install manually.
    log(`WARNING: node_modules junction failed (exit ${err.status ?? "?"}); link it manually`);
  }
} else if (!fs.existsSync(mainNodeModules)) {
  log("WARNING: main checkout has no node_modules to junction; skipping");
}

// ---- success: stdout carries ONLY the worktree path --------------------------
process.stdout.write(targetPath);
