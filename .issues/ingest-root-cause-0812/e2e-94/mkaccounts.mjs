#!/usr/bin/env node
// #94 彩排的**建号引导** —— #101 起改走 admin 路径。
//
// ## 为什么本票要动它
// #94 那轮建号是两步：anon key 打 `POST /auth/v1/signup` → 再 SSH 进生产容器、用容器的
// `AVERY_DB_URL` 跑 `UPDATE auth.users SET email_confirmed_at=now()`（receipt-94 §0「建法」）。
// #101 把 Supabase 的 `disable_signup` 关掉之后，**第一步直接被真闸挡死**——彩排会红在
// 「连号都建不出来」这一层，而且报错长得完全不像「注册被冻结了」。
// 换成 `admin.createUser({ email_confirm: true })`：一步建成已确认，绕过 signup 开关
// （service_role 本来就绕过它），也不再需要进生产容器。
//
// ## 🔴 service_role key 与凭据落盘
// key 只从 `SUPABASE_SERVICE_ROLE_KEY` 进来，绝不落盘、绝不进仓。产出的 `creds.json`
// **含明文密码**，写在 scratchpad（本目录 `.gitignore` 的 `*.json` / `*creds*` 两道通配同时
// 挡着，即便手滑写到这儿也进不了库）。
//
// ## 跑法
//   SUPABASE_SERVICE_ROLE_KEY=<...> node .issues/ingest-root-cause-0812/e2e-94/mkaccounts.mjs
//   # 换输出位置： E2E94_CREDS=<abs path>/creds.json
//   # 跑完彩排收尾，两个户各来一次：
//   #   node scripts/ops/create-account.mjs --delete <email>
//
// 建的是**当天新号**，不复用 #94 那个常驻户（`avery-e2e+20260812@dannyqian.com`）：它的密码
// 只存在过上一轮的 scratchpad 里，换台机器/换轮次就取不回来了（Supabase 读不出密码）。
// 那个老户如果还在，用上面那条 `--delete` 带走，别让它长期挂在生产 auth.users 上。

import { createClient } from '@supabase/supabase-js'
import { randomInt } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://zlxpldzapyoacmgvlqpn.supabase.co'
const API_BASE = process.env.E2E94_API_BASE || 'https://avery.dannyqian.com'
const APP_BASE = process.env.E2E94_APP_BASE || 'https://averylite.dannyqian.com'
const OUT = process.env.E2E94_CREDS || path.join(process.cwd(), 'scratchpad', 'e2e-94', 'creds.json')

const KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
if (!KEY) {
  console.error(
    '\n✗ SUPABASE_SERVICE_ROLE_KEY 没设。Supabase Dashboard → Project Settings → API keys。\n' +
      '  🔴 只在这一次 shell 里传，别写进文件、别做命令行参数。\n',
  )
  process.exitCode = 1
} else if (KEY.startsWith('sb_publishable_')) {
  console.error('\n✗ 这是 publishable(anon) key，不是 service_role —— 它建不了号。\n')
  process.exitCode = 1
} else {
  // anon key 彩排本身要用（rehearsal.mjs 的 password grant 走它）。没给就从线上 bundle 抠：
  // 它本来就发给每一个浏览器，不是凭据。
  const anonKey = process.env.SUPABASE_ANON_KEY || (await anonFromBundle())

  const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
  const pw = () => Array.from({ length: 24 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('')
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '')

  const sb = createClient(SUPABASE_URL, KEY, { auth: { autoRefreshToken: false, persistSession: false } })
  const accounts = []
  for (const tag of ['A', 'B']) {
    const email = `avery-e2e+${stamp}${tag.toLowerCase()}@dannyqian.com`
    const password = pw()
    const { data, error } = await sb.auth.admin.createUser({ email, password, email_confirm: true })
    if (error) {
      console.error(`\n✗ 建 ${tag} (${email}) 失败：${error.message}`)
      console.error('  同名已存在的话，先 `node scripts/ops/create-account.mjs --delete ' + email + '`\n')
      process.exitCode = 1
      break
    }
    // 🔴 判一下它真是已确认态：`email_confirm` 没生效的话，彩排会死在「Email not confirmed」，
    // 而那个错长得像密码错，能查半天。
    if (!data.user.email_confirmed_at) {
      console.error(`\n✗ ${tag} 建出来了却不是已确认态（email_confirm 没生效）—— user id ${data.user.id}\n`)
      process.exitCode = 1
      break
    }
    accounts.push({ tag, email, password, userId: data.user.id })
    console.log(`  [PASS] ${tag} ${email} —— 已确认（${data.user.id}）`)
  }

  if (!process.exitCode) {
    mkdirSync(path.dirname(OUT), { recursive: true })
    writeFileSync(OUT, JSON.stringify({ supabaseUrl: SUPABASE_URL, anonKey, apiBase: API_BASE, appBase: APP_BASE, accounts }, null, 2))
    console.log(`\n✓ creds.json → ${OUT}`)
    console.log(`  下一步：E2E94_CREDS=${OUT} node .issues/ingest-root-cause-0812/e2e-94/rehearsal.mjs`)
    console.log(`  收尾：两个户各跑一次 scripts/ops/create-account.mjs --delete <email>`)
  }
}

// 🔴 不调 process.exit()：supabase-js 走完一轮之后紧接着 exit，Windows 上 libuv 会炸
// `UV_HANDLE_CLOSING` 断言、进程退 127（2026-08-13 实测，见 scripts/ops/create-account.mjs）。

async function anonFromBundle() {
  const idx = await fetch(`${APP_BASE}/`).then((r) => r.text())
  const asset = idx.match(/src="([^"]+\.js)"/)?.[1]
  if (!asset) throw new Error(`index 里找不到 js 入口：${APP_BASE}`)
  const js = await fetch(new URL(asset, APP_BASE)).then((r) => r.text())
  const key = js.match(/sb_publishable_[A-Za-z0-9_-]+/)?.[0]
  if (!key) throw new Error(`bundle ${asset} 里找不到 sb_publishable_* key`)
  return key
}
