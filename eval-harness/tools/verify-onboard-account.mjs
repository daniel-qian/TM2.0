#!/usr/bin/env node
// 向导第⑤步「创建管理者账号」的五分支门 —— onboarding-accounts-0805 ④（ADR-0034 拍板 5）。
//
// ## 与既有两道账号门的分工
//   · verify-auth-capability —— 顶栏入口**该不该出现**（探测三态）。从不点开表单。
//   · verify-auth-form       —— 顶栏 AuthPanel 的**真表单**（登录/注册/换身份/凭据卫生）。
//   · 本门                    —— **向导里那一步**：注册成功→自动认领、邮箱确认分支、可跳过、
//                                未配置整步隐去。是同一条状态机的第二个入口，所以要单独量。
//
// ## 怎么够到真表单而不碰真 Supabase（照抄 verify-auth-form 的老招）
// 用假但语法过得去的 Supabase key 打一份构建，`getSupabase()` 真的建出客户端；
// `/auth/v1/signup`、`/account/status`、`/account/claim` 三个端点在**网络层**被 page.route
// 改写。于是整条前端逻辑真跑：填表 → supabase-js 解析响应 → onAuthStateChange 推回 store →
// 组件重渲染 → 自动认领发出真的 POST /account/claim（被截获）。
// 🔴 全程零真实账号被创建、零真凭据被提交。**真凭据链路归 #44**，本门一步都不碰。
//
// ## 五个分支（票 #43 验收原文）
//   ① 未配置 —— 没有 Supabase key 的构建：账号步**整步隐去**，chips 里没有它，四步走完。
//   ② 注册成功（拿到 session）→ **自动**认领当前 context：真发 POST /account/claim，
//      带的 context_id / owner_token 与手上这份逐字相等，界面给白话确认。
//   ③ 邮箱确认（有 user 无 session）→ 如实说去收信，**不假装已登录**，并指出顶栏兜底。
//   ④ 注册失败 → 人话报错（不是 Supabase 的英文原文）。
//   ⑤ 跳过 → 直接到完成页，游客路径完好（contextId 还在、能进指挥室）。
//
// ## 怎么跑
//   node eval-harness/tools/verify-onboard-account.mjs
//   端口冲突用 VERIFY_PORT / VERIFY_API_BASE 覆盖。本门自起 preview，不吃共享 5173。
//   🔴 与 verify-auth-* 同族：它**自己 spawn vite build**，是 dist 调包者，归 C 区。
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const PORT = process.env.VERIFY_PORT || '5295'
const PORT_NOKEY = process.env.VERIFY_PORT_NOKEY || '5296'
const API_BASE = process.env.VERIFY_API_BASE || 'http://127.0.0.1:8295'

const R = []
const rec = (n, ok, d) => { R.push({ n, ok }); console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${n}${d ? ' — ' + d : ''}`) }

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: ROOT, stdio: 'inherit', shell: false, ...opts })
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))))
    child.on('error', reject)
  })
}

// 🔴 别删 --host 127.0.0.1：不给它时本机 vite 只绑 IPv6 回环，门会**哑火**（不是 FAIL，
// 是压根没跑到断言）。候选列表逐个探活的理由同 verify-auth-form 那段注释。
function waitForServer(urls, timeoutMs = 25000) {
  const started = Date.now()
  return new Promise((resolve, reject) => {
    const tick = async () => {
      for (const url of urls) {
        try {
          const res = await fetch(url, { method: 'GET' })
          if (res.ok) return resolve(url)
        } catch { /* 还没起来 */ }
      }
      if (Date.now() - started > timeoutMs) return reject(new Error(`server didn't come up: ${urls.join(', ')}`))
      setTimeout(tick, 250)
    }
    tick()
  })
}

const VITE = path.join(ROOT, 'node_modules/vite/bin/vite.js')
const FAKE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiJ9.onboard-account-gate-only'

function fakeSessionBody(email) {
  return {
    access_token: 'fake-access-token-ONBOARD-0001',
    refresh_token: 'fake-refresh-token-ONBOARD-0001',
    token_type: 'bearer',
    expires_in: 3600,
    user: {
      id: 'user-fake-onboard-0001', aud: 'authenticated', role: 'authenticated', email,
      email_confirmed_at: '2026-01-01T00:00:00Z', confirmed_at: '2026-01-01T00:00:00Z',
      phone: '', last_sign_in_at: '2026-01-01T00:00:00Z',
      app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {},
      identities: [], created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
    },
  }
}

// 邮箱确认开着时 GoTrue 的真实形状：有 user、**没有** access_token。
function pendingBody(email) {
  return {
    id: 'user-fake-onboard-0002', aud: 'authenticated', role: 'authenticated', email,
    email_confirmed_at: null, confirmed_at: null, phone: '',
    app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {},
    identities: [], created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
  }
}

console.log('═══ build ①：带假 Supabase key（账号步应当出场）═══')
await run(process.execPath, [VITE, 'build', '--mode', 'development'], {
  env: { ...process.env, VITE_SUPABASE_URL: 'https://xyzcompany.supabase.co',
    VITE_SUPABASE_ANON_KEY: FAKE_KEY, VITE_AVERY_API_BASE: API_BASE },
})
const preview = spawn(process.execPath, [VITE, 'preview', '--port', PORT, '--strictPort', '--host', '127.0.0.1'],
  { cwd: ROOT, stdio: 'ignore' })
let UI
try {
  UI = await waitForServer([`http://127.0.0.1:${PORT}`, `http://localhost:${PORT}`])
  console.log(`         preview 就位：${UI}`)
} catch (e) {
  console.error(e.message); preview.kill(); process.exit(1)
}

const browser = await chromium.launch({ headless: true })

// 每个场景一份独立 context：supabase-js 自己持久化会话，串了就不是"新访客"了。
async function scenario({ signupBody, signupStatus = 200, claimStatus = 200, seedContext = true }) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const page = await ctx.newPage()
  const errors = []
  const claims = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.route('**/account/status', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"configured":true}' }))
  await page.route('**/account/contexts', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"context_ids":[]}' }))
  await page.route('**/account/claim', (r) => {
    claims.push({ body: r.request().postDataJSON(), headers: r.request().headers() })
    r.fulfill({ status: claimStatus, contentType: 'application/json', body: claimStatus === 200 ? '{}' : '{"detail":"nope"}' })
  })
  await page.route('**/auth/v1/signup**', (r) =>
    r.fulfill({ status: signupStatus, contentType: 'application/json', body: JSON.stringify(signupBody) }))
  await page.route('**/demo/status', (r) => r.fulfill({ status: 404, body: 'no demo' }))

  await page.route('**/team/ctx_gate_onboard_account**', (r) => r.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ context_id: 'ctx_gate_onboard_account', people: [], projects: [],
      briefing: { headline: '', look_kind: 'none', look_projects: 0, look_signals: 0 } }),
  }))
  await page.goto(`${UI}/?v=2&mode=live&lang=zh`, { waitUntil: 'networkidle' })

  if (seedContext) {
    // 🔴 工作区必须**开页之后**才落，不能预置在 localStorage 上：`hadContextOnLoad` 是模块
    // 求值期读一次的快照，预置锚点等于把这个访客判成"已有数据的回头客"，闸门根本不弹
    // （selectWizardOpen 第一行就 return false）。这是产品的正确行为，不是门要绕的东西——
    // 真实流程里 contextId 也正是在向导第①步提交成功的那一刻才落地的，此时闸门开着。
    // 走 adoptContext 这个收口，与上传成功那条路一字不差。
    await page.evaluate(() => {
      window.__lite2Store.getState().adoptContext('ctx_gate_onboard_account', 'owner-token-gate-0001')
    })
    await page.waitForTimeout(150)
  }
  return { ctx, page, errors, claims }
}

/** 一路点「下一步」直到落在账号步（步数随部署变，不写死点击次数）。 */
async function toAccountStep(page) {
  await page.waitForSelector('.lite-onboard', { timeout: 8000 })
  if (await page.locator('.lite-gate-door-upload').count()) {
    await page.locator('.lite-gate-door-upload').click()
    await page.waitForTimeout(200)
  }
  for (let i = 0; i < 8; i++) {
    const step = await page.getAttribute('.lite-onboard', 'data-onboard-step')
    if (step === 'account') return true
    if (!(await page.locator('.lite-onboard-next').count())) return false
    await page.locator('.lite-onboard-next').click()
    await page.waitForTimeout(160)
  }
  return (await page.getAttribute('.lite-onboard', 'data-onboard-step')) === 'account'
}

// ── ② 注册成功（拿到 session）→ 自动认领 ────────────────────────────────────────────────
{
  const { ctx, page, errors, claims } = await scenario({ signupBody: fakeSessionBody('manager@example.com') })
  const reached = await toAccountStep(page)
  rec('②·账号步在配了 Supabase 的构建里出场', reached)
  const chips = await page.evaluate(() => [...document.querySelectorAll('.lite-onboard-chip')].map((c) => c.getAttribute('data-step-id')))
  rec('②·chips 里有 account（五步）', chips.includes('account') && chips.length === 5, JSON.stringify(chips))
  const summary = await page.evaluate(() => [...document.querySelectorAll('.lite-onboard-account-summary li')].map((n) => n.textContent.trim()))
  rec('②·步顶摘要三颗 chip 都在', summary.length === 3, JSON.stringify(summary))
  // 🔴 中间那颗**不许**说"已连接"——第②步同屏刚说过「目前还没有开通任何连接」。
  rec('②·摘要没有把"登记意向"说成"已连接"',
    summary.every((s) => !s.includes('已连接')), JSON.stringify(summary))

  await page.fill('.lite-onboard-account-email', 'manager@example.com')
  await page.fill('.lite-onboard-account-password', 'gate-only-not-a-real-password')
  await page.click('.lite-onboard-account-create')
  await page.waitForSelector('.lite-onboard-step[data-account-step="authed"]', { timeout: 8000 })
  await page.waitForTimeout(800)
  const after = await page.evaluate(() => ({
    who: document.querySelector('.lite-onboard-account-who')?.textContent?.trim() ?? '',
    claimed: document.querySelector('[data-claim="done"]')?.textContent?.trim() ?? '',
    authed: window.__lite2Auth.getState().status,
  }))
  console.log(`  ②: ${JSON.stringify({ ...after, claims: claims.length })}`)
  rec('②·store 落 authed', after.authed === 'authed', after.authed)
  rec('②·界面显示已登录为谁', after.who.includes('manager@example.com'), after.who)
  // 拍板 5 的正主：注册成功**自动**认领，不用用户再点一次。
  rec('②·真发出了一次 POST /account/claim（自动认领）', claims.length === 1, String(claims.length))
  rec('②·认领带的是手上这份 context 与它的 owner_token',
    claims[0]?.body?.context_id === 'ctx_gate_onboard_account'
    && claims[0]?.body?.owner_token === 'owner-token-gate-0001', JSON.stringify(claims[0]?.body))
  // 🔴 凭据卫生：owner_token 走 body（它是被交出的标的），账号 token 走 header，两者都不进 URL。
  rec('②·账号 token 走 header 而不是 URL',
    Boolean(claims[0]?.headers?.['x-avery-account']) && !JSON.stringify(claims[0]?.body ?? {}).includes('access_token'),
    JSON.stringify(Object.keys(claims[0]?.headers ?? {}).filter((k) => k.startsWith('x-avery'))))
  rec('②·认领成功给了一句白话确认', after.claimed.length > 0 && after.claimed.includes('账号'), after.claimed.slice(0, 30))
  rec('②·无 pageerror', errors.length === 0, errors.slice(0, 2).join(' | ') || '0 条')
  await ctx.close()
}

// ── ③ 邮箱确认分支（有 user 无 session）────────────────────────────────────────────────
{
  const { ctx, page, errors, claims } = await scenario({ signupBody: pendingBody('pending@example.com') })
  await toAccountStep(page)
  await page.fill('.lite-onboard-account-email', 'pending@example.com')
  await page.fill('.lite-onboard-account-password', 'gate-only-not-a-real-password')
  await page.click('.lite-onboard-account-create')
  await page.waitForSelector('.lite-onboard-step[data-account-step="pending"]', { timeout: 8000 })
  const p = await page.evaluate(() => ({
    pending: document.querySelector('[data-account-branch="pending"]')?.textContent?.trim() ?? '',
    note: document.querySelector('.lite-onboard-account-note')?.textContent?.trim() ?? '',
    authed: window.__lite2Auth.getState().status,
    who: document.querySelectorAll('.lite-onboard-account-who').length,
  }))
  console.log(`  ③: ${JSON.stringify({ ...p, claims: claims.length })}`)
  rec('③·如实说去收信', p.pending.includes('收件箱') || p.pending.includes('确认'), p.pending.slice(0, 30))
  // 🔴 这一条是本分支的全部意义：拿不到 session 就**绝不假装已登录**。
  rec('③·没有假装已登录（status 仍是 guest、不显示"已登录为"）',
    p.authed === 'guest' && p.who === 0, `${p.authed} / who=${p.who}`)
  rec('③·没有偷偷发认领请求', claims.length === 0, String(claims.length))
  rec('③·指出了顶栏兜底入口', p.note.includes('顶栏'), p.note.slice(0, 30))
  rec('③·无 pageerror', errors.length === 0, errors.slice(0, 2).join(' | ') || '0 条')
  await ctx.close()
}

// ── ④ 注册失败 → 人话报错 ─────────────────────────────────────────────────────────────
{
  const { ctx, page, errors } = await scenario({
    signupStatus: 400,
    signupBody: { code: 400, error_code: 'user_already_exists', msg: 'User already registered' },
  })
  await toAccountStep(page)
  await page.fill('.lite-onboard-account-email', 'taken@example.com')
  await page.fill('.lite-onboard-account-password', 'gate-only-not-a-real-password')
  await page.click('.lite-onboard-account-create')
  await page.waitForSelector('.lite-onboard-account-error', { timeout: 8000 })
  const err = await page.evaluate(() => document.querySelector('.lite-onboard-account-error')?.textContent?.trim() ?? '')
  console.log(`  ④: ${JSON.stringify(err)}`)
  rec('④·失败给的是人话，不是 Supabase 的英文原文',
    err.includes('注册') || err.includes('邮箱'), err.slice(0, 40))
  rec('④·报错里没有原始英文串', !/User already registered/i.test(err), err.slice(0, 40))
  rec('④·无 pageerror', errors.length === 0, errors.slice(0, 2).join(' | ') || '0 条')
  await ctx.close()
}

// ── ⑤ 跳过 → 游客路径完好 ─────────────────────────────────────────────────────────────
{
  const { ctx, page, errors, claims } = await scenario({ signupBody: fakeSessionBody('never@example.com') })
  await toAccountStep(page)
  await page.click('.lite-onboard-account-later')
  await page.waitForSelector('.lite-onboard[data-onboard-step="done"]', { timeout: 5000 })
  await page.click('.lite-onboard-finish')
  await page.waitForTimeout(600)
  const s = await page.evaluate(() => ({
    gate: document.querySelectorAll('.lite-onboard').length,
    contextId: window.__lite2Store.getState().contextId,
    authed: window.__lite2Auth.getState().status,
  }))
  console.log(`  ⑤: ${JSON.stringify({ ...s, claims: claims.length })}`)
  rec('⑤·「稍后再说」直达完成页并能走完', s.gate === 0)
  // 拍板 5：游客路径是硬性产品要求。跳过之后手上那份工作区照旧在。
  rec('⑤·跳过之后工作区还在（游客路径完好）', s.contextId === 'ctx_gate_onboard_account', String(s.contextId))
  rec('⑤·跳过没有偷偷建账号或认领', s.authed === 'guest' && claims.length === 0, `${s.authed} / ${claims.length}`)
  rec('⑤·无 pageerror', errors.length === 0, errors.slice(0, 2).join(' | ') || '0 条')
  await ctx.close()
}

await browser.close()
preview.kill()

// ── ① 未配置 Supabase → 账号步整步隐去 ────────────────────────────────────────────────
// 单独一份构建（不带 VITE_SUPABASE_*）。这一条是「不出死按钮」的正面证据：一个点了没反应的
// 步骤与一颗死按钮是同一件事。
console.log('\n═══ build ②：不带 Supabase key（账号步应当整步隐去）═══')
await run(process.execPath, [VITE, 'build', '--mode', 'development'], {
  env: { ...process.env, VITE_SUPABASE_URL: '', VITE_SUPABASE_ANON_KEY: '', VITE_AVERY_API_BASE: API_BASE },
})
const preview2 = spawn(process.execPath, [VITE, 'preview', '--port', PORT_NOKEY, '--strictPort', '--host', '127.0.0.1'],
  { cwd: ROOT, stdio: 'ignore' })
let UI2
try {
  UI2 = await waitForServer([`http://127.0.0.1:${PORT_NOKEY}`, `http://localhost:${PORT_NOKEY}`])
} catch (e) {
  console.error(e.message); preview2.kill(); process.exit(1)
}
const browser2 = await chromium.launch({ headless: true })
{
  const ctx = await browser2.newContext({ viewport: { width: 1280, height: 900 } })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.route('**/demo/status', (r) => r.fulfill({ status: 404, body: 'no demo' }))
  await page.goto(`${UI2}/?v=2&mode=live&lang=zh`, { waitUntil: 'networkidle' })
  await page.waitForSelector('.lite-onboard', { timeout: 8000 })
  await page.locator('.lite-gate-door-upload').click()
  await page.waitForTimeout(300)
  const chips = await page.evaluate(() => [...document.querySelectorAll('.lite-onboard-chip')].map((c) => c.getAttribute('data-step-id')))
  rec('①·没配 Supabase 时 chips 里没有 account（四步）',
    !chips.includes('account') && chips.length === 4, JSON.stringify(chips))
  // 一路走到底，确认过程中一次都没落到账号步上。
  let sawAccount = false
  for (let i = 0; i < 8; i++) {
    const step = await page.getAttribute('.lite-onboard', 'data-onboard-step')
    if (step === 'account') sawAccount = true
    if (step === 'done') break
    if (!(await page.locator('.lite-onboard-next').count())) break
    await page.locator('.lite-onboard-next').click()
    await page.waitForTimeout(150)
  }
  const last = await page.getAttribute('.lite-onboard', 'data-onboard-step')
  rec('①·四步能走到完成页，全程没落到账号步上', last === 'done' && !sawAccount, `${last} / sawAccount=${sawAccount}`)
  rec('①·屏幕上没有注册表单', (await page.locator('.lite-onboard-account-create').count()) === 0)
  rec('①·无 pageerror', errors.length === 0, errors.slice(0, 2).join(' | ') || '0 条')
  await ctx.close()
}
await browser2.close()
preview2.kill()

const pass = R.filter((r) => r.ok).length
const fail = R.length - pass
console.log(`\n═══ 向导账号步：${pass} PASS · ${fail} FAIL ═══`)
process.exit(fail ? 1 : 0)
