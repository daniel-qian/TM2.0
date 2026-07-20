#!/usr/bin/env node
// open-loop-0720 · AuthPanel 的**真表单**零覆盖补丁。
//
// ## 为什么单开一道门
// 交接单（.issues/v02-joint-0719/handoff-openloop-0720.md）如实记着这条盲区：
// 「真实 Supabase 登录表单路径（email/password 提交、注册邮箱验证分支）零 Playwright 覆盖」。
// 现成的门（verify-auth-capability.mjs）只探测「入口该不该出现」——它从不点开表单、不填
// 邮箱密码、不提交，`accountCapability` 的三态断言全部成立，跟表单本身能不能用是两件事。
// 而这条入口 07-20 已经**真上线**（avery.dannyqian.com 填了 Supabase key、`/account/status`
// 公网 200），客户现在能点得到它——门必须跟上。
//
// ## 怎么够到「真表单」而不碰真 Supabase
// 与 verify-auth-capability.mjs / verify-null-owner.mjs 同一招：不 mock store、不直接调
// signIn()/signUp() 这些函数——那样只证明函数本身，证明不了屏幕。本门在**网络层**用
// `page.route()` 改写 `/auth/v1/token`（登录）、`/auth/v1/signup`（注册）这两个真实
// Supabase 端点的响应，同一份真构建（真 Supabase env key 烤进 bundle，`getSupabase()`
// 真的建出客户端）在这层拦截下走完整条前端逻辑：填表单 → 提交 → supabase-js 解析响应 →
// `onAuthStateChange` 推回 store → 组件重渲染。🔴 全程不发生一次真实网络请求打到
// Supabase——`VITE_SUPABASE_URL` 是个语法过得去的假域名，任何漏网请求只会连接失败，
// 不会有真账号被创建、没有真凭据被提交。
//
// ## 覆盖的 7 件事（kickoff 清单原文顺序）
//   ① 表单渲染 + 零拉丁词残留（中文纯度，本面板范围）
//   ② 登录成功 → store 落 authed、邮箱显示、后续 /account/contexts 请求带 X-Avery-Account
//   ③ 登录失败 → 人话报错（邮箱或密码不对 / 限流），不是原始英文
//   ④ 注册但要邮箱验证 → 诚实说「去查收件箱」，不假装已登录
//   ⑤ 游客路径全程健在：未登录时九个场景 tab + 首屏上传入口都能点
//   ⑥ 凭据卫生不变式：拿到的 access_token 不进 URL、不进任何 `lite2:` 前缀的 localStorage
//   ⑦ 换身份（A→B，同一标签页、status 全程 authed）→ 公司数据域（contextId/team/files/notes
//      + `lite2:` 前缀 localStorage）被清空，且落回「你的团队」屏
//
// ## 怎么跑
// 本门自己起 vite preview（isolated port 5291，Supabase 端点与账号探测全程被 page.route
// 截获，压根不需要真 Supabase / 真后端存在）。
//   node eval-harness/tools/verify-auth-form.mjs
// 端口冲突时用 VERIFY_PORT / VERIFY_API_BASE 环境变量覆盖。
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const PORT = process.env.VERIFY_PORT || '5291'
const API_BASE = process.env.VERIFY_API_BASE || 'http://127.0.0.1:8291'
const UI = `http://127.0.0.1:${PORT}`

const R = []
const rec = (n, ok, d) => {
  R.push({ n, ok })
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${n}${d ? ' — ' + d : ''}`)
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: ROOT, stdio: 'inherit', shell: false, ...opts })
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))))
    child.on('error', reject)
  })
}

function waitForServer(url, timeoutMs = 20000) {
  const started = Date.now()
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const res = await fetch(url)
        if (res.ok || res.status < 500) return resolve()
      } catch {
        /* not up yet */
      }
      if (Date.now() - started > timeoutMs) return reject(new Error(`server didn't come up: ${url}`))
      setTimeout(tick, 300)
    }
    tick()
  })
}

// 轮询 Node 侧闭包变量（route 回调只在 Node 侧跑，不能直接 page.waitForFunction）。
async function waitForVar(getter, timeoutMs = 5000) {
  const started = Date.now()
  while (getter() === undefined || getter() === null) {
    if (Date.now() - started > timeoutMs) return getter()
    await new Promise((r) => setTimeout(r, 100))
  }
  return getter()
}

console.log('═══ door · build（真 Supabase key 烤进 bundle，getSupabase() 真的建出客户端）═══')
// 假 key——语法上过得去即可。真实网络请求（/auth/v1/token、/auth/v1/signup、/account/status、
// /account/contexts）全部在下面用 page.route 截获；任何漏网请求会连接一个语法域名/不存在的
// 端口失败，不影响断言，也绝不会打到真 Supabase。
await run(process.execPath, [
  path.join(ROOT, 'node_modules/vite/bin/vite.js'),
  'build',
  '--mode',
  'development',
], {
  env: {
    ...process.env,
    VITE_SUPABASE_URL: 'https://xyzcompany.supabase.co',
    VITE_SUPABASE_ANON_KEY:
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiJ9.verify-auth-form-gate-only',
    VITE_AVERY_API_BASE: API_BASE,
  },
})

console.log(`\n═══ 起 vite preview（isolated port ${PORT}）═══`)
const preview = spawn(
  process.execPath,
  [path.join(ROOT, 'node_modules/vite/bin/vite.js'), 'preview', '--port', PORT, '--strictPort'],
  { cwd: ROOT, stdio: 'ignore' },
)
let previewExited = false
preview.on('exit', () => { previewExited = true })

try {
  await waitForServer(UI)
} catch (e) {
  console.error(e.message)
  preview.kill()
  process.exit(1)
}

const browser = await chromium.launch({ headless: true })

// ── 假会话夹具 ──────────────────────────────────────────────────────────────────────────
// 形状按 @supabase/auth-js 的 `hasSession()`（node_modules/@supabase/auth-js/src/lib/fetch.ts）
// 校验——`access_token` + `refresh_token` + `expires_in` 三者齐全才会被认成一次真登录；
// user 对象字段照抄 GoTrue 真实响应形状，供 supabase-js 内部落 session.user 用。
const FAKE_TOKEN_A = 'fake-access-token-AAAA1111'
const FAKE_REFRESH_A = 'fake-refresh-token-AAAA1111'
const FAKE_USER_A = { id: 'user-fake-aaaa-0001', email: 'manager-a@example.com' }
const FAKE_USER_B = { id: 'user-fake-bbbb-0002', email: 'manager-b@example.com' }

function fakeUser(u) {
  return {
    id: u.id,
    aud: 'authenticated',
    role: 'authenticated',
    email: u.email,
    email_confirmed_at: '2026-01-01T00:00:00Z',
    phone: '',
    confirmed_at: '2026-01-01T00:00:00Z',
    last_sign_in_at: '2026-01-01T00:00:00Z',
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: {},
    identities: [],
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }
}

function fakeSessionBody(token, refresh, user) {
  return {
    access_token: token,
    refresh_token: refresh,
    token_type: 'bearer',
    expires_in: 3600,
    user: fakeUser(user),
  }
}

// ── 拉丁词探针（借自 .issues/feat-068-frontend-deploy/verify-zh-purity.mjs 的 latinHits，
// 缩到本门够用的版本）——本面板的中文字典（AuthPanel.tsx 的 COPY.zh）里没有任何品牌名/
// 文件格式专名要放行，所以这里不设 ALLOW 名单：命中即失败。
function latinHits(txt) {
  const out = []
  for (const line of txt.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    for (const frag of trimmed.match(/[A-Za-z][A-Za-z'()\-]*(?:\s+[A-Za-z][A-Za-z'()\-]*)*/g) || []) {
      const words = frag.trim().split(/\s+/)
      if (words.length >= 2 || (words[0] && words[0].length >= 4)) out.push({ line: trimmed, frag: frag.trim() })
    }
  }
  return out
}

async function dismissOnboardIfAny(p) {
  if (await p.locator('.lite-onboard').count()) {
    await p.keyboard.press('Escape')
    await p.waitForTimeout(700)
  }
}

// 每个场景独立 browser context（独立 storage —— supabase-js 的会话持久化不跨场景串）。
// 默认拦一条：`/account/status` → 200 supported（本门要测的是表单本身，不是能力探测——
// 那条已经被 verify-auth-capability.mjs 单独守住了）。调用方按需追加更多 route。
async function openPage() {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const p = await ctx.newPage()
  const errs = []
  p.on('pageerror', (e) => errs.push(e.message))
  await p.route('**/account/status', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ configured: true, signed_in: false }),
    }),
  )
  return { ctx, p, errs }
}

async function boot(p) {
  await p.goto(`${UI}/?v=2&mode=live&look=paper&lang=zh`, { waitUntil: 'networkidle' })
  await dismissOnboardIfAny(p)
  await p.waitForFunction(
    () => window.__lite2Auth?.getState?.()?.accountCapability === 'supported',
    undefined,
    { timeout: 8000 },
  )
}

async function openPanel(p) {
  await p.locator('.lite-auth-toggle').click()
  await p.waitForTimeout(200)
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// ① 表单渲染 + 零拉丁词残留
// ═══════════════════════════════════════════════════════════════════════════════════════
console.log('\n═══ ① 表单渲染（capability=supported + key 配了）═══')
{
  const { ctx, p, errs } = await openPage()
  await boot(p)
  await openPanel(p)

  const popCount = await p.locator('.lite-auth-pop').count()
  rec('弹层打开（.lite-auth-pop 在）', popCount === 1, `实得 ${popCount}`)
  rec('邮箱输入框在', (await p.locator('.lite-auth-pop input[type="email"]').count()) === 1)
  rec('密码输入框在', (await p.locator('.lite-auth-pop input[type="password"]').count()) === 1)
  rec('提交按钮在', (await p.locator('.lite-auth-pop .lite-auth-submit').count()) === 1)
  rec('注册（signup）切换入口在', (await p.locator('.lite-auth-pop .lite-auth-switch').count()) === 1)

  const guestNote = await p.locator('.lite-auth-pop .lite-auth-note').first().innerText()
  rec('诚实的"游客也能用"说明在', guestNote.includes('不登录也能用'), guestNote)

  const panelText = await p.locator('.lite-auth-pop').innerText()
  const hits = latinHits(panelText)
  rec('面板文案零拉丁词残留（ZH build）', hits.length === 0, hits.map((h) => `"${h.frag}"`).join(', '))
  rec('无 pageerror', errs.length === 0, errs.slice(0, 2).join(' | ') || '0 条')

  await ctx.close()
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// ② 登录成功：store→authed、邮箱显示、后续账号读带 X-Avery-Account、凭据卫生（⑥ 一并测）
// ═══════════════════════════════════════════════════════════════════════════════════════
console.log('\n═══ ② 登录成功 → authed + X-Avery-Account header + 凭据卫生 ═══')
{
  const { ctx, p, errs } = await openPage()
  let tokenCalled = false
  let contextsHeaders
  await p.route('**/auth/v1/token*', (route) => {
    tokenCalled = true
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(fakeSessionBody(FAKE_TOKEN_A, FAKE_REFRESH_A, FAKE_USER_A)),
    })
  })
  await p.route('**/account/contexts', (route) => {
    contextsHeaders = route.request().headers()
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ context_ids: [] }),
    })
  })

  await boot(p)
  await openPanel(p)
  await p.locator('.lite-auth-pop input[type="email"]').fill(FAKE_USER_A.email)
  await p.locator('.lite-auth-pop input[type="password"]').fill('correct-horse-battery')
  await p.locator('.lite-auth-pop .lite-auth-submit').click()

  await p
    .waitForFunction(() => window.__lite2Auth?.getState?.()?.status === 'authed', undefined, { timeout: 5000 })
    .catch(() => {})
  const store = await p.evaluate(() => {
    const s = window.__lite2Auth.getState()
    return { status: s.status, email: s.email, userId: s.userId }
  })
  rec('POST .../auth/v1/token 确实被调用（真的驱动了表单，不是直接调 signIn()）', tokenCalled)
  rec('store 落 authed', store.status === 'authed', JSON.stringify(store))
  rec('store.userId 落到假 user id', store.userId === FAKE_USER_A.id, String(store.userId))

  const emailShown = await p.locator('.lite-auth-who-email').innerText()
  rec('登录后面板显示邮箱', emailShown.trim() === FAKE_USER_A.email, emailShown)

  await waitForVar(() => contextsHeaders)
  const gotHeader = contextsHeaders?.['x-avery-account']
  rec(
    '登录后的账号读（/account/contexts）带上 X-Avery-Account: <access_token>',
    gotHeader === FAKE_TOKEN_A,
    JSON.stringify(contextsHeaders),
  )

  // ── ⑥ 凭据卫生不变式 ──────────────────────────────────────────────────────────────────
  const url = p.url()
  rec('🔴 access_token 不出现在 URL 里', !url.includes(FAKE_TOKEN_A), url)

  const storageDump = await p.evaluate(() => {
    const out = {}
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i)
      out[k] = window.localStorage.getItem(k)
    }
    return out
  })
  const lite2Keys = Object.keys(storageDump).filter((k) => k.startsWith('lite2:'))
  const leaked = lite2Keys.filter((k) => (storageDump[k] || '').includes(FAKE_TOKEN_A))
  rec(
    '🔴 access_token 不出现在任何 `lite2:` 前缀的 localStorage key 里（我们自己不许拷出一份）',
    leaked.length === 0,
    leaked.join(',') || '(无)',
  )
  const otherKeys = Object.keys(storageDump).filter((k) => !k.startsWith('lite2:'))
  const sbHasToken = otherKeys.some((k) => (storageDump[k] || '').includes(FAKE_TOKEN_A))
  rec(
    '阳性对照：supabase-js 自己的 storage 确实存了这枚 token（证明"签入"真的发生了，不是假阳性）',
    sbHasToken,
    otherKeys.join(','),
  )

  rec('无 pageerror', errs.length === 0, errs.slice(0, 2).join(' | ') || '0 条')
  await ctx.close()
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// ③ 登录失败 → 人话报错（含限流分支）
// ═══════════════════════════════════════════════════════════════════════════════════════
console.log('\n═══ ③ 登录失败 → humanizeAuthError 人话，不是原始英文 ═══')
{
  const { ctx, p, errs } = await openPage()
  let callCount = 0
  await p.route('**/auth/v1/token*', (route) => {
    callCount += 1
    if (callCount === 1) {
      return route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ error_description: 'Invalid login credentials', error_code: 'invalid_credentials' }),
      })
    }
    return route.fulfill({
      status: 429,
      contentType: 'application/json',
      body: JSON.stringify({ error_description: 'Request rate limit reached', error_code: 'over_request_rate_limit' }),
    })
  })

  await boot(p)
  await openPanel(p)
  await p.locator('.lite-auth-pop input[type="email"]').fill(FAKE_USER_A.email)
  await p.locator('.lite-auth-pop input[type="password"]').fill('wrong-password')
  await p.locator('.lite-auth-pop .lite-auth-submit').click()

  await p
    .waitForFunction(() => window.__lite2Auth?.getState?.()?.error != null, undefined, { timeout: 5000 })
    .catch(() => {})
  let errText = await p.locator('.lite-auth-error').innerText()
  rec('凭据错误 → 中文人话「邮箱或密码不对」', errText.includes('邮箱或密码不对'), errText)
  rec('凭据错误 → 屏幕上没有原始英文', !/invalid login credentials/i.test(errText), errText)
  rec('store 没有假装登录成功', (await p.evaluate(() => window.__lite2Auth.getState().status)) !== 'authed')

  // 限流分支：同一个 route pattern 第二次调用换一副身体。用"错误文案变了"来同步，而不是
  // 固定 sleep——busy→idle 这一拍太快，轮询窗口可能直接跨过去。
  const prevErr = await p.evaluate(() => window.__lite2Auth.getState().error)
  await p.locator('.lite-auth-pop input[type="password"]').fill('wrong-password-again')
  await p.locator('.lite-auth-pop .lite-auth-submit').click()
  await p
    .waitForFunction(
      (prev) => {
        const s = window.__lite2Auth?.getState?.()
        return !!s && s.busy === 'idle' && !!s.error && s.error !== prev
      },
      prevErr,
      { timeout: 5000 },
    )
    .catch(() => {})
  errText = await p.locator('.lite-auth-error').innerText()
  rec('限流分支 → 中文人话「试得太频繁了」', errText.includes('试得太频繁'), errText)
  rec('限流分支 → 屏幕上没有原始英文', !/rate limit/i.test(errText), errText)

  rec('无 pageerror', errs.length === 0, errs.slice(0, 2).join(' | ') || '0 条')
  await ctx.close()
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// ④ 注册但需要邮箱验证 → 诚实说"去查收件箱"，不假装已登录
// ═══════════════════════════════════════════════════════════════════════════════════════
console.log('\n═══ ④ 注册（有 user 无 session）→ pendingVerification，绝不假装已登录 ═══')
{
  const { ctx, p, errs } = await openPage()
  await p.route('**/auth/v1/signup*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      // 刻意不带 access_token/refresh_token/expires_in —— GoTrue 开了邮箱验证时的真实形状：
      // 直接返回 user 对象本身（无 session 包裹），@supabase/auth-js 的 hasSession() 判 false。
      body: JSON.stringify({
        id: 'user-fake-needs-verify-0003',
        aud: 'authenticated',
        role: 'authenticated',
        email: 'newmanager@example.com',
        email_confirmed_at: null,
        confirmed_at: null,
        confirmation_sent_at: '2026-07-20T00:00:00Z',
        phone: '',
        app_metadata: { provider: 'email', providers: ['email'] },
        user_metadata: {},
        identities: [],
        created_at: '2026-07-20T00:00:00Z',
        updated_at: '2026-07-20T00:00:00Z',
      }),
    }),
  )

  await boot(p)
  await openPanel(p)
  await p.locator('.lite-auth-pop .lite-auth-switch').click() // 切到注册模式
  await p.locator('.lite-auth-pop input[type="email"]').fill('newmanager@example.com')
  await p.locator('.lite-auth-pop input[type="password"]').fill('sixchars')
  await p.locator('.lite-auth-pop .lite-auth-submit').click()

  await p
    .waitForFunction(() => window.__lite2Auth?.getState?.()?.pendingVerification === true, undefined, {
      timeout: 5000,
    })
    .catch(() => {})
  const store = await p.evaluate(() => {
    const s = window.__lite2Auth.getState()
    return { status: s.status, pendingVerification: s.pendingVerification }
  })
  rec('store.pendingVerification 为 true', store.pendingVerification === true, JSON.stringify(store))
  rec('🔴 status 没有变成 authed（绝不假装已登录）', store.status !== 'authed', JSON.stringify(store))

  const notes = await p.locator('.lite-auth-pop .lite-auth-note').allInnerTexts()
  const combined = notes.join(' | ')
  rec('屏幕诚实提示"去邮箱点确认链接"', combined.includes('去邮箱点一下确认链接'), combined)
  rec(
    '仍显示登录/注册表单（不是"已登录"视图）',
    (await p.locator('.lite-auth-pop input[type="email"]').count()) === 1 &&
      (await p.locator('.lite-auth-who-email').count()) === 0,
  )

  rec('无 pageerror', errs.length === 0, errs.slice(0, 2).join(' | ') || '0 条')
  await ctx.close()
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// ⑤ 游客路径全程健在：未登录时九个场景 tab + 首屏上传入口都能点
// ═══════════════════════════════════════════════════════════════════════════════════════
console.log('\n═══ ⑤ 游客路径全程健在（登录不是用产品的前提）═══')
{
  const { ctx, p, errs } = await openPage()
  await boot(p)
  await p
    .waitForFunction(() => window.__lite2Auth?.getState?.()?.status === 'guest', undefined, { timeout: 5000 })
    .catch(() => {})

  const tabCount = await p.locator('.scene-tabs .scene-tab').count()
  rec('九个场景 tab 都在（登录入口没有挤占任何一个）', tabCount === 9, `实得 ${tabCount}`)
  rec('首屏（home）自带上传入口（.upload-dropzone）', (await p.locator('.upload-dropzone').count()) >= 1)

  for (let i = 0; i < tabCount; i++) {
    await p.locator('.scene-tabs .scene-tab').nth(i).click()
    await p.waitForTimeout(150)
  }
  rec('九个 tab 逐一点过一遍，无 pageerror（游客能走完整个应用）', errs.length === 0, errs.slice(0, 2).join(' | ') || '0 条')

  await p.locator('.scene-tabs .scene-tab').first().click() // 回到 home
  await p.waitForTimeout(150)
  rec('回到首屏，上传入口仍在（没有被登录状态污染掉）', (await p.locator('.upload-dropzone').count()) >= 1)

  await ctx.close()
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// ⑦ 换身份（A→B，同一标签页、status 全程 authed）→ 公司数据域清空
// ═══════════════════════════════════════════════════════════════════════════════════════
console.log('\n═══ ⑦ 换身份（A→B 直接换会话）→ clearCompanyScope 清空公司数据域 ═══')
{
  const { ctx, p, errs } = await openPage()
  await p.route('**/auth/v1/token*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(fakeSessionBody(FAKE_TOKEN_A, 'fake-refresh-a', FAKE_USER_A)),
    }),
  )
  await p.route('**/account/contexts', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ context_ids: [] }) }),
  )

  await boot(p)
  await openPanel(p)
  await p.locator('.lite-auth-pop input[type="email"]').fill(FAKE_USER_A.email)
  await p.locator('.lite-auth-pop input[type="password"]').fill('correct-horse-battery')
  await p.locator('.lite-auth-pop .lite-auth-submit').click()
  await p
    .waitForFunction(() => window.__lite2Auth?.getState?.()?.status === 'authed', undefined, { timeout: 5000 })
    .catch(() => {})
  await p.waitForTimeout(400) // 让"登录后恢复账号数据"那条副作用（context_ids: []，不接管）先落定

  // 模拟"手上已经有一份公司数据"——游客期上传、或上一个会话遗留。直接摆状态：要测的是
  // clearCompanyScope() 这个真实副作用本身（AuthPanel.tsx 的 useEffect [status, userId]），
  // 不是 setState 这个机制——window.__lite2Store / __lite2Auth 是仅供门读写的既有测试缝
  // （store.ts:788「门是唯一消费者；产品代码不经 window 读 store」同一先例）。
  await p.evaluate(() => {
    window.__lite2Store.setState({
      contextId: 'ctx-fake-company-a',
      ownerToken: 'owner-tok-fake-a',
      team: { people: [], projects: [] },
      rawTeam: { context_id: 'ctx-fake-company-a', people: [], projects: [] },
      files: [{ name: 'w29.md' }],
      notes: [{ id: 'n1', text: 'x' }],
    })
    window.localStorage.setItem('lite2:test-marker:v1', JSON.stringify({ leftover: true }))
  })
  const before = await p.evaluate(() => ({
    contextId: window.__lite2Store.getState().contextId,
    filesLen: window.__lite2Store.getState().files.length,
    marker: window.localStorage.getItem('lite2:test-marker:v1'),
  }))
  rec(
    '前置：模拟态确实落地了（否则下面的"清空"断言没有意义）',
    before.contextId === 'ctx-fake-company-a' && before.filesLen === 1 && !!before.marker,
    JSON.stringify(before),
  )

  // 换身份：status 全程 'authed'，只是 userId/email 变了——对应 AuthPanel.tsx 注释里
  // 「A→B 直接换会话：prev 是旧 userId 且 ≠ 新身份 → 清」那一支，不经过中间的 guest 态。
  await p.evaluate((u) => {
    window.__lite2Auth.setState({ status: 'authed', userId: u.id, email: u.email })
  }, FAKE_USER_B)

  await p
    .waitForFunction(() => window.__lite2Store.getState().contextId === null, undefined, { timeout: 5000 })
    .catch(() => {})
  const after = await p.evaluate(() => {
    const s = window.__lite2Store.getState()
    return {
      contextId: s.contextId,
      team: s.team,
      rawTeam: s.rawTeam,
      filesLen: s.files.length,
      notesLen: s.notes.length,
      marker: window.localStorage.getItem('lite2:test-marker:v1'),
      pathname: window.location.pathname,
    }
  })
  rec('contextId 清空', after.contextId === null, String(after.contextId))
  rec('team / rawTeam 清空', after.team === null && after.rawTeam === null, JSON.stringify([after.team, after.rawTeam]))
  rec('files / notes 清空', after.filesLen === 0 && after.notesLen === 0, `files=${after.filesLen} notes=${after.notesLen}`)
  rec(
    '`lite2:` 前缀 localStorage 残留被整段清扫（wipeLite2LocalStorage）',
    after.marker === null,
    String(after.marker),
  )
  rec('换人后落回「你的团队」屏（goScreen("team")）', after.pathname === '/team', after.pathname)

  rec('无 pageerror', errs.length === 0, errs.slice(0, 2).join(' | ') || '0 条')
  await ctx.close()
}

await browser.close()
preview.kill()

const pass = R.filter((r) => r.ok).length
const fail = R.length - pass
console.log(`\n═══ verify-auth-form 判据：${pass} PASS · ${fail} FAIL ═══`)
if (fail) {
  console.log('\n失败项：')
  for (const r of R.filter((x) => !x.ok)) console.log(`  ✗ ${r.n}`)
}
process.exit(fail || previewExited ? 1 : 0)
