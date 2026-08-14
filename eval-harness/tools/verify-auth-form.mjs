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
// `page.route()` 改写 `/auth/v1/token`（登录）、`/auth/v1/signup`（注册——#101 之后它只
// 作为**陷阱**存在，见 ④ 段）这两个真实
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
//   ④ 【#101 改判】注册门冻结 → 前端**不存在**任何 signup 路径（原为「注册但要邮箱验证
//     → 诚实说去查收件箱」；那条路整条撤了，判据翻成反向，逐条理由见该段段首）
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

// 🔴 preview 绑在哪个回环栈上，是随机器变的（2026-07-28 本机实测）：不带 `--host` 时
// vite 只监听 IPv6 回环 —— `netstat -ano | findstr <port>` 看到的是 `TCP [::1]:PORT`，
// `curl http://localhost:PORT/` 200 而 `curl http://127.0.0.1:PORT/` 直接连接被拒
// （Node 24 把 localhost 解析成 ::1 优先，vite 监听的就是这个解析结果）。此前这里把探活
// 地址写死成 127.0.0.1，于是这两道自起服务器的门在本机**永远哑火**——不是 FAIL，是
// 「server didn't come up」压根没跑到断言，run-battery 里看着像两个空位。
// 修两层，缺一不可：
//   ① 下面 spawn 显式 `--host 127.0.0.1`，把监听钉在 IPv4，不依赖任何解析顺序；
//   ② 探活/访问地址仍按候选列表逐个试，谁先答应就用谁。哪天 vite 改默认、或 `--host`
//      的语义又变，门最多慢一拍，不会再退回哑火。
// （其余 26 道门不受影响：它们的 base 走 VERIFY_BASE，由调用方传入。）
const UI_CANDIDATES = [`http://127.0.0.1:${PORT}`, `http://localhost:${PORT}`]
let UI = UI_CANDIDATES[0]

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

// 返回**真正答应了的**那个 base（见上面 UI_CANDIDATES 的注释）：调用方拿它覆盖 UI，
// 之后 page.goto 用的就是同一个地址，不会出现「探活走 IPv4、浏览器走 IPv6」的错位。
function waitForServer(urls, timeoutMs = 20000) {
  const started = Date.now()
  return new Promise((resolve, reject) => {
    const tick = async () => {
      for (const url of urls) {
        try {
          const res = await fetch(url)
          if (res.ok || res.status < 500) return resolve(url)
        } catch {
          /* not up yet */
        }
      }
      if (Date.now() - started > timeoutMs) {
        return reject(new Error(`server didn't come up: ${urls.join(' / ')}`))
      }
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
  [
    path.join(ROOT, 'node_modules/vite/bin/vite.js'),
    'preview',
    '--port',
    PORT,
    '--strictPort',
    // 🔴 别删：不给 --host 时本机的 vite 只绑 IPv6 回环，这道门就会哑火。见上方 UI_CANDIDATES。
    '--host',
    '127.0.0.1',
  ],
  { cwd: ROOT, stdio: 'ignore' },
)
let previewExited = false
preview.on('exit', () => { previewExited = true })

try {
  UI = await waitForServer(UI_CANDIDATES)
  console.log(`         preview 就位：${UI}`)
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

// 弹层是 toggle 语义，且**没有** Escape 关闭处理（Escape 归首访向导）。所以按"当前在不在"
// 决定点不点，否则一次多余的点击会把它关掉，下一个 innerText 就等一个永远不出现的元素。
async function ensurePanelOpen(p) {
  if ((await p.locator('.lite-auth-pop').count()) === 0) await openPanel(p)
  await p.waitForTimeout(150)
}
async function ensurePanelClosed(p) {
  if ((await p.locator('.lite-auth-pop').count()) > 0) await openPanel(p)
  await p.waitForTimeout(150)
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
  // ── #101 改判 ①/1：正向「注册切换入口在」→ 反向「一个都找不到」──────────────────────
  // 旧判据（`.lite-auth-switch` count === 1）在注册门冻结后**必红**，它守的是一个已经
  // 被产品判掉的行为。删它的理由不是"删掉就绿了"，是它现在**判反了**：入口存在才是缺陷。
  // 🔴 反向判据天生有空真风险（面板整个没渲染出来时它也成立）。这里不额外造对照——
  // 上面三条同块判据（弹层在 / 邮箱框在 / 密码框在 / 提交键在）就是它的在场证明：
  // 面板没渲染的话那四条先红，这一条绿不了单。
  rec(
    '🔴 #101 注册切换入口一个都找不到（.lite-auth-switch 已撤）',
    (await p.locator('.lite-auth-pop .lite-auth-switch').count()) === 0,
  )

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
// ④ 【#101 改判】注册门冻结 → 前端**不存在**任何 signup 路径
//
// ## 旧 ④ 是什么，为什么整段翻面
// 旧 ④ 测的是「注册返回 user 但没 session（开了邮箱验证）→ pendingVerification → 诚实说
// 去收信、不假装已登录」。它当时是对的，但 #94 在**生产上**实测出这条路的前提就不成立：
// Supabase 对**已注册且已确认**的邮箱回的是 **200 + 一个假 user id**（防枚举伪装成功），
// 于是屏幕上那句「注册成功。去邮箱点一下确认链接」是**只可能在说谎时才亮**的提示。
// #101 把注册整条撤了（AuthPanel 的切换入口 + authStore.signUp + pendingVerification +
// authVerifyNote 全删）。旧 ④ 的五条判据里，三条断言的是**已被产品判掉的行为**（切到注册
// 模式、pendingVerification 为 true、屏上出现那句话），留着必红且守错了方向。
//
// ## 换上来的反向判据（四层，逐层为什么）
//  a. **入口层**：切换键找不到 + 表单里只剩「登录」一个动作键 + 面板文案里没有「注册」二字。
//     只查 class 不够——换个 class 加回来就绕过去了，所以再从**文案**和**动作键数量**
//     两个正交角度各钉一条。
//  b. **store 层**：`signUp` 这个 action 压根不存在、`pendingVerification` 这个字段不存在。
//     这条守的是碑上那句「死枝要在 docstring 自陈测不到」的另一半——如果 signUp 只是
//     「留着但 UI 够不到」，下一个人就会写出一条伪造响应直接调它的**永远绿的空判据**。
//     判它不存在，就把「留死枝」这条路一起焊死了。
//  c. **网络层（陷阱上膛）**：`/auth/v1/signup` 的 route 照旧挂着，回的**正是 #94 那份假
//     成功**。它不是拿来用的，是拿来**等**的：谁把注册路径加回来，这个假成功就会当场
//     被打到，`signupHits` 非零，门红。
//     🔴 「某个请求没发生」是天生的空真判据——所以配了阳性对照 `tokenHits`：先证明这一页
//     的表单**真的被驱动了**（登录端点确实被打到），「signup 一次都没被打到」才有分量。
//  d. **文案层**：#94 那句假话（「去邮箱点一下确认链接」）不再出现在屏幕上。
//
// ## 🔴 「直连 signup 接口拿到的是真错误不是假成功」为什么**不在这里**
// 那条判据问的是**真 Supabase 后台的 disable_signup 关没关**。本门整条 Supabase 链路是
// page.route 伪造的——在这里断言它，等于让被测对象自己写答案（碑：尺子长在被量的东西上，
// 判据的期望值不许由被测方给出）。它的正确落点是一支**打真 Supabase 的活体探针**：
//   node .issues/account-tenancy-0813/probe-signup-frozen.mjs
// 那支探针只读 `/auth/v1/settings`，`disable_signup` 为真时才继续做一次真实 signup 尝试
// 并断言「真错误 + 没有 user id」。它需要公网，**不进 init.sh / 不进离线电池**。
// ═══════════════════════════════════════════════════════════════════════════════════════
console.log('\n═══ ④ #101 注册门冻结 → 前端不存在任何 signup 路径（反向判据）═══')
{
  const { ctx, p, errs } = await openPage()

  // 陷阱：#94 在生产上逮到的那份**假成功**（200 + 假 user id，Supabase 防枚举伪装）。
  // 一字不改地留在这儿——它是「注册路径被加回来」这件事的报警器。
  let signupHits = 0
  await p.route('**/auth/v1/signup*', (route) => {
    signupHits += 1
    route.fulfill({
      status: 200,
      contentType: 'application/json',
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
    })
  })
  // 阳性对照用：登录端点。回 400，因为本段要的是"提交这个动作真的发生过"，不是登录成功。
  let tokenHits = 0
  await p.route('**/auth/v1/token*', (route) => {
    tokenHits += 1
    route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({ error_description: 'Invalid login credentials', error_code: 'invalid_credentials' }),
    })
  })

  await boot(p)
  await openPanel(p)

  // ── a · 入口层 ────────────────────────────────────────────────────────────────────────
  rec(
    '🔴 注册切换入口找不到（.lite-auth-switch count === 0）',
    (await p.locator('.lite-auth-pop .lite-auth-switch').count()) === 0,
  )
  // 按类查会被"换个 class 加回来"绕过 —— 再从动作键**数量**钉一条：登录表单里可点的
  // 只该有「登录」这一个键。将来真要加第二个动作（比如找回密码），这条会红，逼一次
  // 显式复议——这是想要的效果，不是误报。
  const formButtons = await p.locator('.lite-auth-pop form button').allInnerTexts()
  rec(
    '🔴 登录表单里只有「登录」一个动作键（没有第二条路可点）',
    formButtons.length === 1 && formButtons[0].trim() === '登录',
    JSON.stringify(formButtons),
  )
  const panelText = await p.locator('.lite-auth-pop').innerText()
  rec('🔴 面板文案里没有「注册」二字（换 class 也绕不过文案这一关）', !panelText.includes('注册'), panelText.replace(/\n+/g, ' / ').slice(0, 120))

  // ── b · store 层：signUp / pendingVerification 是真的不存在，不是"在但没人调" ─────────
  const shape = await p.evaluate(() => {
    const s = window.__lite2Auth.getState()
    return { signUpType: typeof s.signUp, hasPending: 'pendingVerification' in s, keys: Object.keys(s) }
  })
  rec('🔴 authStore 没有 signUp 这个 action（死枝一并删了，不留可被空判据消费的靶子）',
    shape.signUpType === 'undefined', `typeof signUp = ${shape.signUpType}`)
  rec('🔴 authStore 没有 pendingVerification 这条状态', shape.hasPending === false, shape.keys.join(','))

  // ── c · 网络层：把表单里能点的都点一遍再提交，signup 端点一次都不该被打到 ────────────
  // 🔴 born-red 实测（2026-08-13，本段第一版）：只**提交一次登录表单**的话，「signup 零命中」
  // 与「屏上没有那句假话」两条**把注册入口原样加回来照样全绿**——它们当时是空真，
  // 阳性对照 tokenHits 也救不了（它只证明登录被驱动了，不证明「所有能走的路都走过」）。
  // 有牙的驱动是：**把表单里除提交键以外的每一个键都先点一遍**。注册入口回来的那一刻，
  // 这一圈点击就会把模式切到注册，接下来的提交打到 /auth/v1/signup，陷阱当场响。
  const extraButtons = p.locator('.lite-auth-pop form button:not(.lite-auth-submit)')
  const extraCount = await extraButtons.count()
  for (let i = 0; i < extraCount; i++) await extraButtons.nth(i).click()
  await p.waitForTimeout(150)

  await p.locator('.lite-auth-pop input[type="email"]').fill('newmanager@example.com')
  await p.locator('.lite-auth-pop input[type="password"]').fill('sixchars')
  await p.locator('.lite-auth-pop .lite-auth-submit').click()
  // 落定条件写成「busy 回 idle 且**有了结果**」而不是死等 error：注册路径若被加回来，
  // 结果是 pendingVerification 而不是 error，死等 error 会白白吃满 5s 超时，然后拿一屏
  // **还没渲染完**的东西去判 d（那样 d 会因为"读早了"而假绿——又一层空真）。
  await p
    .waitForFunction(
      () => {
        const s = window.__lite2Auth?.getState?.()
        return !!s && s.busy === 'idle' && (s.error != null || s.pendingVerification === true)
      },
      undefined,
      { timeout: 5000 },
    )
    .catch(() => {})

  // 🔴 阳性对照写成「两个端点**加起来**至少被打到一次」，不是「token 被打到一次」：
  // 注册路径若被加回来，这一轮驱动打的是 signup 而**不是** token——写成后者的话，
  // 对照自己会跟着红，读日志的人分不清"是没驱动到"还是"驱动到了别处"。
  rec('阳性对照：提交确实驱动到了某个 Supabase 认证端点（否则下一条是空真）',
    tokenHits + signupHits >= 1, `tokenHits=${tokenHits} signupHits=${signupHits}`)
  rec('🔴 点遍全表单后仍零次请求打到 /auth/v1/signup，且提交走的是登录端点（陷阱上膛未响）',
    signupHits === 0 && tokenHits >= 1, `tokenHits=${tokenHits} signupHits=${signupHits}`)

  // ── d · 文案层：#94 那句假话不会再出现在屏幕上 ──────────────────────────────────────
  const notes = (await p.locator('.lite-auth-pop .lite-auth-note').allInnerTexts()).join(' | ')
  rec('🔴 屏幕上不再出现「去邮箱点一下确认链接」（#94 逮到的那句假话）',
    !notes.includes('去邮箱点一下确认链接'), notes)
  rec('提交失败后仍是登录表单（没有被假成功推进任何"已登录"视图）',
    (await p.locator('.lite-auth-pop input[type="email"]').count()) === 1 &&
      (await p.locator('.lite-auth-who-email').count()) === 0)

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
  // #63（merge-closerlook）把「值得注意」tab 退役后是 8 个。这个数的正源是 LiteTopbar 的
  // tabs 数组 + verify-v2boots 的期望序列——#63 改判时漏了本门这条（C 区自建 dist，改判
  // 清单没扫到），#64 收尾电池逮到后补上。改 tab 数时两处一起改：v2boots 的期望数组 + 这里。
  rec('八个场景 tab 都在（登录入口没有挤占任何一个）', tabCount === 8, `实得 ${tabCount}`)
  rec('首屏（home）自带上传入口（.upload-dropzone）', (await p.locator('.upload-dropzone').count()) >= 1)

  for (let i = 0; i < tabCount; i++) {
    await p.locator('.scene-tabs .scene-tab').nth(i).click()
    await p.waitForTimeout(150)
  }
  rec('八个 tab 逐一点过一遍，无 pageerror（游客能走完整个应用）', errs.length === 0, errs.slice(0, 2).join(' | ') || '0 条')

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

// ═══════════════════════════════════════════════════════════════════════════════════════
// ⑧ 语言开关（07-20 Blockers 5a）：账号面板的文案必须跟着开关走
//
// 缺陷：AuthPanel 曾带一份**就地写死的 zh/en 私有字典**，取词函数 `useMemo(…, [])` 只看
// URL `?lang=` 与构建期变量——语言开关改的是 localeStore 和 localStorage，它两个都不看。
// 于是点开关整个应用都变了，只有账号按钮还是旧语言，**刷新也修不回来**（境内构建 env=zh
// 会永远判 zh）。附带一半同样重要：私有字典对所有扫 en.ts/zh.ts 的门都是隐形的，
// 22 条客户会读到的文案从来没进过中文纯度门 / aria 门的采样范围。
// ═══════════════════════════════════════════════════════════════════════════════════════
console.log('\n═══ ⑧ 点语言开关 → 账号面板文案跟着变（不刷新）═══')
{
  const { ctx, p, errs } = await openPage()
  await boot(p)

  const toggleZh = await p.locator('.lite-auth-toggle').innerText()
  rec('中文态：账号按钮是「登录」', toggleZh.trim() === '登录', `实得 "${toggleZh}"`)

  await ensurePanelOpen(p)
  const panelZh = await p.locator('.lite-auth-pop').innerText()
  // 只在 zh 态下跑纯度断言（切 EN 之后拉丁词本来就是对的）。
  const hitsZh = latinHits(panelZh)
  rec('中文态：面板零拉丁词残留', hitsZh.length === 0, hitsZh.map((h) => `"${h.frag}"`).join(', '))
  await ensurePanelClosed(p)

  // 🔴 刻意不 reload：刷新会让这个 bug 自愈，也就测不到它。
  // 0721 · 7B：语言开关收进了设置菜单——点开关前先开齿轮。
  // ui-sweep-0802：菜单现在「按下在菜单外即收」（弹层互斥修复）——点账号按钮它就收起，
  // 回程要重新展开（见下），不再共用这次展开。断言零改动，驱动步骤跟上新交互。
  await p.locator('.lite-settings-toggle').click()
  await p.waitForTimeout(200)
  await p.locator('.lang-switch-btn').nth(1).click()   // → English
  await p.waitForTimeout(400)

  const toggleEn = await p.locator('.lite-auth-toggle').innerText()
  rec('🔴 切 EN 后账号按钮变成 "Sign in"（此前它卡在中文，刷新也不变）',
    toggleEn.trim() === 'Sign in', `实得 "${toggleEn}"`)

  await ensurePanelOpen(p)
  const panelEn = await p.locator('.lite-auth-pop').innerText()
  rec('🔴 弹层内文案整体跟着变（邮箱/密码标签是英文）',
    panelEn.includes('Email') && panelEn.includes('Password'), panelEn.replace(/\n+/g, ' / ').slice(0, 120))
  // #101：注册入口的**文案侧**反向判据在 ①/④ 两段只有中文那一半（那两段跑的是 zh 构建，
  // 判的是「没有『注册』二字」）。英文界面对那条判据天生够不着——碑上「门语料全 ASCII
  // 盲点」的镜像面：只有中文语料同样是盲点。这里补上英文那一半。
  rec('🔴 #101 · EN 态面板里也没有 "Sign up"（两个语言的注册入口都撤干净了）',
    !/sign\s*up/i.test(panelEn), panelEn.replace(/\n+/g, ' / ').slice(0, 120))
  rec('🔴 弹层内不再残留中文（旧语言没有卡在任何一格里）',
    !panelEn.includes('邮箱') && !panelEn.includes('密码') && !panelEn.includes('不登录也能用'),
    panelEn.replace(/\n+/g, ' / ').slice(0, 120))
  await p.keyboard.press('Escape')

  // 回程：防「只翻一次就锁死」。
  // 0721：上一段的账号弹层实测不吃裸 Escape（.lite-auth-head 一直拦截指针）——必须走
  // ensurePanelClosed 显式关掉，否则它压在设置弹层上，语言按钮永远「可见但点不着」。
  await ensurePanelClosed(p)
  await p.waitForTimeout(150)
  // ui-sweep-0802：点账号按钮（菜单外）时设置菜单已按新交互自动收起——回程前重新展开。
  await p.locator('.lite-settings-toggle').click()
  await p.waitForTimeout(200)
  await p.locator('.lang-switch-btn').nth(0).click()   // → 中文
  await p.waitForTimeout(400)
  const toggleBack = await p.locator('.lite-auth-toggle').innerText()
  rec('切回中文后账号按钮回到「登录」（双向，不是只翻一次）',
    toggleBack.trim() === '登录', `实得 "${toggleBack}"`)

  rec('无 pageerror', errs.length === 0, errs.slice(0, 2).join(' | ') || '0 条')
  await ctx.close()
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// ⑨ 换身份清场（07-20 Blockers 5b）：清公司数据，**不清用户偏好**
//
// 缺陷：`wipeLite2LocalStorage` 按 `lite2:` 前缀整段清——这条不变式本身是对的（公司数据
// 一样都不许活过换账号），但 07-20 新加的两个偏好键 `lite2:lang:v1` / `lite2:look:v1`
// 正落在同一个前缀下，于是退出登录会顺手把人的皮肤和语言偏好一起抹掉。
//
// 🔴 本相位必须**两侧都断言**：白名单放行了偏好（正向），且公司域键与未知 lite2 键仍然
// 一个不剩（反向）。只测一侧的话，白名单前缀写错、把公司数据放行过一次换账号，门照样绿。
// ═══════════════════════════════════════════════════════════════════════════════════════
console.log('\n═══ ⑨ 换身份：偏好留下、公司数据清光 ═══')
{
  const { ctx, p, errs } = await openPage()
  await boot(p)

  // 0721 · 7B 之后：默认 look 翻成 aurora，切换器也收进了设置菜单（.lite-settings-toggle）。
  // 这里**不再点开关**，改用语言侧同一个套路：boot() 的 URL 显式带 `?look=paper`，
  // lookStore 的深链同步已把 'paper' 落进 `lite2:look:v1`——新默认是 aurora，所以
  // 「偏好丢了 / 还在」两种世界裸链重开长得不同（aurora / paper），判别力保住。
  // （旧写法点成 aurora，在新默认下正好撞上"存进去的值 == 默认值"的空真陷阱——
  // 就是下面语言侧注释记的那个反例。）
  // 🔴 语言这一侧**刻意不点开关**：boot() 的 URL 带 `?lang=zh`，localeStore 的深链同步已经
  // 把 'zh' 落进了 `lite2:lang:v1`，而本门的构建**没有**设 VITE_AVERY_LOCALE，构建期默认是
  // 'en'。于是"偏好丢了"与"偏好还在"两种情况下界面语言不同（en / zh），断言才有判别力。
  // 反例记在这儿供后人别再踩：先前这里点成 English，存进去的偏好恰好**等于**构建期默认，
  // 于是把白名单整个去掉、偏好被抹光，界面照样是英文——那条断言"因错而对"地绿着。
  // 判别器的第一要求是它在两种世界里给出不同答案。

  // 先落成 A 身份 + 一份公司数据 + 一个「未知的 lite2 键」（反向探针）。
  await p.evaluate((u) => {
    window.__lite2Auth.setState({ status: 'authed', userId: u.id, email: u.email })
    window.__lite2Store.setState({
      contextId: 'ctx-fake-company-a',
      ownerToken: 'owner-tok-fake-a',
      team: { people: [], projects: [] },
      files: [{ name: 'w29.md' }],
    })
    window.localStorage.setItem('lite2:contextId:v1', 'ctx-fake-company-a')
    window.localStorage.setItem('lite2:flow:v1', JSON.stringify({ followups: [{ title: 'A 公司文档原句' }] }))
    window.localStorage.setItem('lite2:test-marker:v1', JSON.stringify({ leftover: true }))
  }, FAKE_USER_A)
  await p.waitForTimeout(300)

  const pre = await p.evaluate(() => ({
    look: window.localStorage.getItem('lite2:look:v1'),
    lang: window.localStorage.getItem('lite2:lang:v1'),
    marker: window.localStorage.getItem('lite2:test-marker:v1'),
    domLook: document.querySelector('.lite2-shell')?.getAttribute('data-look') ?? null,
  }))
  rec('前置：两个偏好键确实被真开关写进去了（否则下面全是空真）',
    pre.look !== null && pre.lang !== null && pre.marker !== null, JSON.stringify(pre))

  // 换人 A → B
  await p.evaluate((u) => {
    window.__lite2Auth.setState({ status: 'authed', userId: u.id, email: u.email })
  }, FAKE_USER_B)
  await p
    .waitForFunction(() => window.__lite2Store.getState().contextId === null, undefined, { timeout: 5000 })
    .catch(() => {})
  await p.waitForTimeout(300)

  const post = await p.evaluate(() => ({
    look: window.localStorage.getItem('lite2:look:v1'),
    lang: window.localStorage.getItem('lite2:lang:v1'),
    domLook: document.querySelector('.lite2-shell')?.getAttribute('data-look') ?? null,
    marker: window.localStorage.getItem('lite2:test-marker:v1'),
    contextIdKey: window.localStorage.getItem('lite2:contextId:v1'),
    flowKey: window.localStorage.getItem('lite2:flow:v1'),
    ownerTokensKey: window.localStorage.getItem('lite2:ownerTokens:v1'),
    contextId: window.__lite2Store.getState().contextId,
  }))
  console.log('         换人后 localStorage:', JSON.stringify(post))

  // 正向：偏好活下来了。
  rec('🔴 皮肤偏好活过换账号（lite2:look:v1 仍在，且值没变）',
    post.look === pre.look && post.look !== null, `前 ${pre.look} → 后 ${post.look}`)
  // ⚠️ 刻意**不**在换人这一拍断言 data-look：lookStore 的内存态不随 localStorage 走，
  // 键被抹掉后当前这一屏照样还是 aurora——只断言这一拍，缺陷会从眼皮底下溜过去
  // （实测：把白名单去掉，这条仍然 PASS）。用户真正看见丢偏好是**下次打开**，
  // 所以判据必须跨一次真实的重新加载。
  //
  // 🔴 重开时必须走**裸链**（不带 `?look=`/`?lang=`）。boot() 用的那条 URL 把 look=paper
  // 钉死了，而 URL 参数**按设计**赢过记住的选择（深链优先，见 lookStore.ts / localeStore.ts）
  // ——带着参数刷新只会验出"参数优先"这条既有行为，验不出"偏好还在不在"。裸链才是
  // 「下次打开」的真实形状。
  await p.goto(`${UI}/?v=2&mode=live`, { waitUntil: 'networkidle' })
  await dismissOnboardIfAny(p)
  await p.waitForTimeout(400)
  const reloaded = await p.evaluate(() => ({
    domLook: document.querySelector('.lite2-shell')?.getAttribute('data-look') ?? null,
    look: window.localStorage.getItem('lite2:look:v1'),
    lang: window.localStorage.getItem('lite2:lang:v1'),
    toggle: document.querySelector('.lite-auth-toggle')?.innerText?.trim() ?? null,
  }))
  console.log('         裸链重开:', JSON.stringify(reloaded))
  rec('🔴 重新打开后皮肤还是他选的那个（不是弹回默认 aurora——0721 后默认已翻转）',
    reloaded.domLook === pre.domLook && reloaded.domLook !== null,
    `换人前 ${pre.domLook} → 重开后 ${reloaded.domLook}`)
  rec('🔴 重新打开后语言也还是他选的那个（记住的是 zh，而构建期默认是 en —— 两者不同才验得出）',
    reloaded.toggle === '登录', `实得 "${reloaded.toggle}"`)
  rec('🔴 语言偏好活过换账号（lite2:lang:v1 仍在，且值没变）',
    post.lang === pre.lang && post.lang !== null, `前 ${pre.lang} → 后 ${post.lang}`)

  // 反向：白名单只开了那两个口子，公司数据一样都没漏。
  rec('未知的 lite2 键仍被清（白名单没有把「默认全清」放宽）',
    post.marker === null, String(post.marker))
  rec('公司锚点被清（lite2:contextId:v1）', post.contextIdKey === null, String(post.contextIdKey))
  rec('跟进队列被清（lite2:flow:v1 —— 它装的是上一家公司文档的原句）',
    post.flowKey === null, String(post.flowKey))
  rec('读权限凭据被清（lite2:ownerTokens:v1）', post.ownerTokensKey === null, String(post.ownerTokensKey))
  rec('内存态的 contextId 也清了', post.contextId === null, String(post.contextId))

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
