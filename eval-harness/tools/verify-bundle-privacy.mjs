// 门：公开 bundle 里不许出现内部工程记录。
//
// 逮到的原始缺陷（2026-07-20 实测线上）：Vite 默认把**所有** `VITE_` 开头的环境变量内联进静态包，
// 而 Vercel 的「自动暴露系统环境变量」会注入 19 个 `VITE_VERCEL_*`，其中
// `VITE_VERCEL_GIT_COMMIT_MESSAGE` 把我们的**提交正文原样发给每一个访客** —— 线上 bundle 里真能读到
// 内部对「产品哪里在撒谎」的讨论、内部文件路径、门的正则。不是密钥泄露，是内部工程记录泄露给客户。
//
// 为什么需要这道门：修复是 vite.config.ts 里一行 `envPrefix`。那一行**看起来无害且容易被"顺手放宽"**
// （比如有人想加个新变量，图省事改回默认 'VITE_'），而放宽的后果在本地完全看不出来 —— 因为
// VITE_VERCEL_* 只在 Vercel 的构建机上存在。所以这道门**自己造出 Vercel 的注入环境**再构建，
// 让这个只在生产才出现的条件在本地可复现。
//
// 同时反向断言：我们真正需要的 5 个变量必须仍然进包。只堵不通的 envPrefix（比如手滑写错前缀）
// 会让线上静默连到 127.0.0.1 —— 那是 feat-068 已经踩过的坑，这里一并守住。
//
// 用法：node eval-harness/tools/verify-bundle-privacy.mjs   （从仓库根目录跑，不需要浏览器/后端）

import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const DIST = join(ROOT, 'dist')
const CANARY = 'CANARY-internal-commit-note-must-not-ship'

let pass = 0
const fails = []
const ok = (name) => { pass++; console.log(`  PASS  ${name}`) }
const bad = (name, detail) => { fails.push({ name, detail }); console.log(`  FAIL  ${name}\n        ${detail}`) }

// 造出 Vercel 构建机的环境：19 个 VITE_VERCEL_* 里挑最有代表性的几个，外加我们自己的 5 个。
const poisoned = {
  ...process.env,
  VITE_VERCEL_GIT_COMMIT_MESSAGE: CANARY,
  VITE_VERCEL_GIT_COMMIT_AUTHOR_NAME: 'CANARY-author',
  VITE_VERCEL_GIT_COMMIT_SHA: 'canaryshaaaa',
  VITE_VERCEL_URL: 'canary.vercel.app',
  VERCEL_GIT_COMMIT_SHA: 'canaryshaaaa',       // 非 VITE_ 的系统变量：构建戳该从这里读
  VITE_AVERY_MODE: 'live',
  VITE_AVERY_LOCALE: 'zh',
  VITE_AVERY_API_BASE: 'https://avery.dannyqian.com',
  VITE_SUPABASE_URL: 'https://canary.supabase.co',
  VITE_SUPABASE_ANON_KEY: 'sb_publishable_CANARYKEY',
}

console.log('verify-bundle-privacy — 构建一个「假装跑在 Vercel 上」的包，再检查它泄露了什么\n')

if (existsSync(DIST)) rmSync(DIST, { recursive: true, force: true })
try {
  execFileSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--mode', 'development'], {
    cwd: ROOT, env: poisoned, stdio: 'pipe',
  })
} catch (e) {
  console.error('构建失败，门无法判定：\n' + (e.stdout?.toString() || '') + (e.stderr?.toString() || ''))
  process.exit(1)
}

const assetsDir = join(DIST, 'assets')
const js = readdirSync(assetsDir).filter((f) => f.endsWith('.js'))
  .map((f) => readFileSync(join(assetsDir, f), 'utf8')).join('\n')
if (!js.length) { console.error('dist 里没有 JS 产物，门无法判定'); process.exit(1) }

// —— 泄露面：必须为 0 ——
if (!js.includes(CANARY)) ok('提交正文没有进公开 bundle')
else bad('提交正文没有进公开 bundle', `找到了 canary "${CANARY}" —— envPrefix 被放宽了？`)

if (!js.includes('CANARY-author')) ok('提交作者没有进公开 bundle')
else bad('提交作者没有进公开 bundle', '找到了 canary 作者名')

const vercelVars = [...new Set(js.match(/VITE_VERCEL_[A-Z_]+/g) || [])]
if (vercelVars.length === 0) ok('bundle 里没有任何 VITE_VERCEL_* 变量')
else bad('bundle 里没有任何 VITE_VERCEL_* 变量', `泄露了 ${vercelVars.length} 个：${vercelVars.join(', ')}`)

// —— 功能面：我们真需要的必须仍然在（防止只堵不通） ——
const required = [
  ['后端地址 VITE_AVERY_API_BASE', 'avery.dannyqian.com'],
  ['Supabase 地址 VITE_SUPABASE_URL', 'canary.supabase.co'],
  ['Supabase key VITE_SUPABASE_ANON_KEY', 'sb_publishable_CANARYKEY'],
]
for (const [name, needle] of required) {
  if (js.includes(needle)) ok(`${name} 仍然进包`)
  else bad(`${name} 仍然进包`, `没找到 "${needle}" —— envPrefix 写错会让线上静默连本机（feat-068 踩过）`)
}

// —— 部署身份：commit 戳必须来自非 VITE_ 系统变量 ——
if (js.includes('canaryshaaaa')) ok('__AVERY_BUILD__ 仍然戳出 commit（走非 VITE_ 系统变量）')
else bad('__AVERY_BUILD__ 仍然戳出 commit', '构建戳里没有 commit sha —— 线上将无法确认部署的是哪一版')

console.log(`\n${pass} PASS · ${fails.length} FAIL`)
process.exit(fails.length ? 1 : 0)
