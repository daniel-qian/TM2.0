#!/usr/bin/env node
// feat-018 (ADR-0021 §5) — dual-target frontend build smoke.
//
// Builds the static SPA for each deploy target into an isolated out-dir and ASSERTS the bundle was
// stamped with the right dual-deploy config (mode / locale / apiBase — see vite.config.ts
// `__AVERY_BUILD__`). This is the AFK build gate: it proves each target compiles AND resolves its
// defaults correctly, WITHOUT deploying anything (no Vercel, no 境内 host, no promote).
//
//   node scripts/deploy/build-targets.mjs            # build+assert all targets
//   node scripts/deploy/build-targets.mjs --keep     # keep the out-dirs for inspection
//   node scripts/deploy/build-targets.mjs story      # build+assert one target by name
//
// Targets (the env matrix, frontend side):
//   story-default : mode=story locale=en   — TODAY'S demo default preserved (zero-regression guard)
//   overseas-en   : mode=live  locale=en   — Vercel (overseas EN), live product default
//   domestic-zh   : mode=live  locale=zh   — 境内 static host (ZH default, no query param needed)
//
// Out-dirs go under the OS temp dir so nothing untracked is left in the repo. Exit non-zero on any
// failed build or a stamp mismatch, so CI / init-style gates can depend on it.

import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
// On Windows npm is a .cmd shim; execFileSync can't spawn it directly (EINVAL), so run npm via the
// shell. Args here are all static (no interpolated user input), so shell:true is safe.
const npmCmd = 'npm'
const runNpm = (npmArgs, extraEnv = {}) =>
  execFileSync(npmCmd, npmArgs, {
    cwd: ROOT,
    stdio: ['ignore', 'inherit', 'inherit'],
    shell: true,
    env: { ...process.env, ...extraEnv },
  })

const TARGETS = {
  'story-default': { env: {}, expect: { mode: 'story', locale: 'en' } },
  'overseas-en': {
    env: { VITE_AVERY_MODE: 'live', VITE_AVERY_API_BASE: 'https://avery-service.example.com' },
    expect: { mode: 'live', locale: 'en', apiBase: 'https://avery-service.example.com' },
  },
  'domestic-zh': {
    env: {
      VITE_AVERY_MODE: 'live',
      VITE_AVERY_LOCALE: 'zh',
      VITE_AVERY_API_BASE: 'https://avery-service.example.cn',
    },
    expect: { mode: 'live', locale: 'zh', apiBase: 'https://avery-service.example.cn' },
  },
}

const args = process.argv.slice(2)
const keep = args.includes('--keep')
const named = args.filter((a) => !a.startsWith('--'))
const selected = named.length ? named : Object.keys(TARGETS)

// Pull the stamped object out of a built bundle: {mode:"..",locale:"..",apiBase:".."}
const STAMP_RE = /\{mode:"(story|live)",locale:"(en|zh)",apiBase:("(?:[^"\\]|\\.)*")\}/

function readStamp(outDir) {
  const assets = path.join(outDir, 'assets')
  const js = readdirSync(assets).filter((f) => f.startsWith('index-') && f.endsWith('.js'))
  for (const f of js) {
    const m = STAMP_RE.exec(readFileSync(path.join(assets, f), 'utf8'))
    if (m) return { mode: m[1], locale: m[2], apiBase: JSON.parse(m[3]) }
  }
  return null
}

function buildTarget(name) {
  const t = TARGETS[name]
  if (!t) throw new Error(`unknown target "${name}" (have: ${Object.keys(TARGETS).join(', ')})`)
  const outDir = mkdtempSync(path.join(tmpdir(), `avery-build-${name}-`))
  process.stdout.write(`\n[${name}] vite build -> ${outDir}\n`)
  // tsc -b once up front (shared); here just `vite build` per target with the target env.
  // Quote the out-dir for the shell (temp paths can contain spaces on Windows).
  runNpm(['exec', '--', 'vite', 'build', '--outDir', `"${outDir}"`, '--emptyOutDir'], t.env)
  const stamp = readStamp(outDir)
  if (!stamp) throw new Error(`[${name}] no build stamp found in bundle`)

  const mismatches = []
  for (const [k, want] of Object.entries(t.expect)) {
    if (stamp[k] !== want) mismatches.push(`${k}: got "${stamp[k]}" want "${want}"`)
  }
  if (mismatches.length) {
    throw new Error(`[${name}] stamp mismatch:\n    ${mismatches.join('\n    ')}`)
  }
  // index.html must exist (real static artifact for the host to serve)
  if (!existsSync(path.join(outDir, 'index.html'))) {
    throw new Error(`[${name}] no index.html emitted`)
  }
  process.stdout.write(`[${name}] OK  mode=${stamp.mode} locale=${stamp.locale} api=${stamp.apiBase}\n`)
  if (!keep) rmSync(outDir, { recursive: true, force: true })
  else process.stdout.write(`[${name}] kept at ${outDir}\n`)
  return stamp
}

// Shared typecheck once (tsc -b) — a target build assumes types are already green.
process.stdout.write('=== tsc -b (shared typecheck) ===\n')
runNpm(['run', 'typecheck'])

let failed = 0
for (const name of selected) {
  try {
    buildTarget(name)
  } catch (e) {
    failed++
    process.stderr.write(`\nFAIL ${e.message}\n`)
  }
}

process.stdout.write(
  `\n=== dual-target build smoke: ${selected.length - failed}/${selected.length} targets OK ===\n`,
)
process.exit(failed ? 1 : 0)
