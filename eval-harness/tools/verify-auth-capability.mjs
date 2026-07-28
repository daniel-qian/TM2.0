#!/usr/bin/env node
// 门缝二（07-20 kickoff）判据门 —— AuthPanel 的登录入口要多看后端一眼，不能只看 Supabase key。
//
// ## 为什么单开一道门
// 生产实测过：avery.dannyqian.com 的 Vercel 环境已经填了 Supabase 两个 key（`authConfigured()`
// 会判 true），但 `GET /account/status` 是 404 —— 这份部署跑的容器镜像压根没挂 feat-053 的账号
// 路由。此前 AuthPanel 只看 `authConfigured()`：key 一填，登录框就出现，客户能登进 Supabase，
// 然后 /account/contexts、claim 全部 404 —— 比压根没有登录框更糟，因为没有入口时游客路径是
// 完整可用的，一个接不住的入口把"能不能用"变成了一次赌博。
//
// 现成的门（verify-p0/verify-blockers/…）从没探测过这件事——它们的合成回执里后端永远是"配好
// 了账号路由"的那台，never 出现"key 有、路由没有"这种半吊子部署，跟 verify-null-owner.mjs 的
// kickoff 同款道理：不是没写断言，是语料结构上从没经过那条分支。
//
// ## 怎么够到这条分支（跟 verify-null-owner.mjs 同一招）
// 不 mock store、不直接调派生函数——那样只证明函数本身，证明不了屏幕。本门在**网络层**用
// `page.route('**/account/status', …)` 改写这一个端点的响应（404 / 200 / 直接掐断连接），
// 同一份真构建（真 Supabase env key 烤进 bundle，`authConfigured()` 真是 true）在三种后端
// 状态下各跑一遍，断言的是屏幕上那颗 `.lite-auth-toggle` 按钮在不在，而不是内部状态变量。
//
// ## 怎么跑
// 本门自己起 vite preview（isolated port 5281，backend base 指到不会被真连上的 8281 ——
// /account/status 全程被 page.route 截获，压根不需要真后端存在）。
//   node eval-harness/tools/verify-auth-capability.mjs
// 端口冲突时用 VERIFY_PORT / VERIFY_API_BASE 环境变量覆盖。
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const PORT = process.env.VERIFY_PORT || '5281'
const API_BASE = process.env.VERIFY_API_BASE || 'http://127.0.0.1:8281'

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

console.log('═══ 门缝二 · build（真 Supabase key 烤进 bundle，authConfigured() 恒 true）═══')
// 假 key——语法上过得去即可（createClient 不校验真伪，账号能力探测是本门的重点，不是登录本身）。
// api base 指到一个没人监听的端口：/account/status 全程被 page.route 截获，根本用不上真后端；
// 其余端点（若有请求漏出去）会连接失败，不影响本门断言。
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
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiJ9.verify-auth-capability-gate-only',
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

async function dismissOnboardIfAny(p) {
  if (await p.locator('.lite-onboard').count()) {
    await p.keyboard.press('Escape')
    await p.waitForTimeout(700)
  }
}

const OK_BODY = JSON.stringify({ configured: true, signed_in: false })
const NOT_FOUND_BODY = JSON.stringify({ detail: 'not found' })

// backendMode:
//   404      —— 后端**回答**了「这份部署没挂账号路由」。落定 unsupported，不该重试。
//   200      —— 挂了。
//   'abort'  —— 连接被掐（网络错误/超时的失败分支）。**没问到**，该重试，重试用尽仍降级。
//   数组     —— 逐次回应的脚本，如 [502, 502, 200]：模拟「抖一下就恢复」。用完最后一项后
//              沿用最后一项（探测若多发，行为仍确定）。
async function probe(backendMode, opts = {}) {
  const { settleMs = 1200, seedAuthed = false } = opts
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const p = await ctx.newPage()
  const errs = []
  p.on('pageerror', (e) => errs.push(e.message))

  const script = Array.isArray(backendMode) ? backendMode : null
  let calls = 0
  await p.route('**/account/status', async (route) => {
    const mode = script ? script[Math.min(calls, script.length - 1)] : backendMode
    calls += 1
    if (mode === 'abort') return route.abort('failed')
    if (mode === 200) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: OK_BODY })
    }
    return route.fulfill({
      status: mode,
      contentType: 'application/json',
      body: NOT_FOUND_BODY,
    })
  })

  await p.goto(`${UI}/?v=2&mode=live&look=paper&lang=zh`, { waitUntil: 'networkidle' })
  await dismissOnboardIfAny(p)
  if (seedAuthed) {
    // store 缝播种一个已登录会话（同 v01 assertAskStatusGuards 的手法）。本门用的是假 Supabase
    // key，走不通真登录流程；而要断言的那条性质——**探测失败时登出口仍在**——只跟"手上有没有
    // 会话"有关，跟这个会话怎么来的无关。绝不为了造这个条件去注册真账号。
    await p.evaluate(() => {
      window.__lite2Auth?.setState?.({
        status: 'authed',
        email: 'seeded@gate.local',
        userId: 'gate-seeded-user',
      })
    })
    await p.waitForTimeout(200)
  }
  // 探测有 5s 超时兜底（authStore.ts ACCOUNT_STATUS_TIMEOUT_MS）+ 重试退避
  // （ACCOUNT_STATUS_RETRY_BACKOFF_MS = [400, 1200]）——给它足够时间落地。
  await p.waitForTimeout(settleMs)

  const store = await p.evaluate(() => {
    const s = window.__lite2Auth?.getState?.()
    return s ? { status: s.status, accountCapability: s.accountCapability } : null
  })
  const toggleCount = await p.locator('.lite-auth-toggle').count()
  // 守门指标：无论账号能力如何，游客路径（顶栏场景 tab）必须原样健在——这是本改动
  // "永不挡路"那条硬性质的直接体现。不写死具体数字（tab 数会随产品增减，跟本门无关），
  // 只跟同一次运行里的基线比，见下方 baseline 比对。
  const sceneTabCount = await p.locator('.scene-tabs .scene-tab').count()

  let popoverOpened = false
  let hasEmailField = false
  let signOutCount = 0
  if (toggleCount > 0) {
    await p.locator('.lite-auth-toggle').first().click()
    await p.waitForTimeout(200)
    popoverOpened = (await p.locator('.lite-auth-pop').count()) > 0
    hasEmailField = (await p.locator('.lite-auth-pop input[type="email"]').count()) > 0
    // 退出登录按 data-role 定位：同一弹层里「重试」也是 .lite-auth-secondary，按类分不清；
    // 按文案又会被 i18n 改动绊住。
    signOutCount = await p.locator('.lite-auth-pop [data-role="sign-out"]').count()
  }

  await ctx.close()
  return { hit: calls > 0, calls, store, toggleCount, sceneTabCount, popoverOpened, hasEmailField, signOutCount, errs }
}

console.log('\n═══ ① 后端 404（账号路由没挂）：即便 key 已配置，登录入口必须不出现 ═══')
const r404 = await probe(404)
{
  const r = r404
  console.log(`         store=${JSON.stringify(r.store)} toggle=${r.toggleCount} sceneTabs=${r.sceneTabCount}`)
  rec('探测请求确实打到了 /account/status（不是空转）', r.hit)
  rec('accountCapability 落定为 unsupported', r.store?.accountCapability === 'unsupported', JSON.stringify(r.store))
  rec('🔴 登录入口不出现（.lite-auth-toggle 数=0）', r.toggleCount === 0, `实得 ${r.toggleCount}`)
  rec('游客路径原样健在（场景 tab 数 > 0）', r.sceneTabCount > 0, `实得 ${r.sceneTabCount}`)
  rec('无 pageerror', r.errs.length === 0, r.errs.slice(0, 2).join(' | ') || '0 条')
}

console.log('\n═══ ② 后端 200（账号路由挂了）：登录入口必须出现，且真的能点开 ═══')
const r200 = await probe(200)
{
  const r = r200
  console.log(`         store=${JSON.stringify(r.store)} toggle=${r.toggleCount} sceneTabs=${r.sceneTabCount}`)
  rec('探测请求确实打到了 /account/status', r.hit)
  rec('accountCapability 落定为 supported', r.store?.accountCapability === 'supported', JSON.stringify(r.store))
  rec('🔴 登录入口出现（.lite-auth-toggle 数=1）', r.toggleCount === 1, `实得 ${r.toggleCount}`)
  rec('点开后弹出真的登录表单（邮箱输入框在）', r.popoverOpened && r.hasEmailField)
  // 与 ① 的游客路径基线做同一次运行内的比较，而不是写死一个数字——tab 数量本就会随
  // 产品迭代增减，跟"登录入口该不该出现"这条判据无关；真正要守住的不变式是「两种后端
  // 状态下场景 tab 数量一致」，即登录入口的有无不改变、不遮挡游客能去的任何一个场景。
  rec(
    '游客路径原样健在（场景 tab 数与① 一致，登录入口没有挤占/替换任何 tab）',
    r.sceneTabCount === r404.sceneTabCount && r.sceneTabCount > 0,
    `①=${r404.sceneTabCount} ②=${r.sceneTabCount}`,
  )
  rec('无 pageerror', r.errs.length === 0, r.errs.slice(0, 2).join(' | ') || '0 条')
}

console.log('\n═══ ③ 探测持续失败（网络错误/连接被掐）：重试用尽后仍降级成不支持，绝不弹一个赌一半的登录框 ═══')
const r503 = await probe('abort', { settleMs: 3000 })
{
  const r = r503
  console.log(`         store=${JSON.stringify(r.store)} toggle=${r.toggleCount} calls=${r.calls}`)
  rec('accountCapability 落定为 unsupported（fail-safe）', r.store?.accountCapability === 'unsupported', JSON.stringify(r.store))
  rec('🔴 登录入口不出现', r.toggleCount === 0, `实得 ${r.toggleCount}`)
  rec('游客路径原样健在（场景 tab 数与① 一致）', r.sceneTabCount === r404.sceneTabCount, `①=${r404.sceneTabCount} ③=${r.sceneTabCount}`)
  // abort 分支的 requestfailed 不是 JS 异常，不该冒出 pageerror。
  rec('无 pageerror', r.errs.length === 0, r.errs.slice(0, 2).join(' | ') || '0 条')
}

// ── 以下两相位是 07-20 复审 Blockers 4 的判据（此前整道门都没有过这两条分支）────────────
console.log('\n═══ ④ 抖一下就恢复（502 · 502 · 200）：一次网关抖动不许把整场判死刑 ═══')
{
  // 502/503/504 = 网关代答，请求根本没到应用 —— 这是「没问到」，不是「后端说没有」。
  const r = await probe([502, 502, 200], { settleMs: 3000 })
  console.log(`         store=${JSON.stringify(r.store)} toggle=${r.toggleCount} calls=${r.calls}`)
  rec('探测真的重试了（/account/status 被打了 ≥3 次）', r.calls >= 3, `实得 ${r.calls} 次`)
  rec('🔴 最终落定 supported（抖动没有变成永久判决）', r.store?.accountCapability === 'supported', JSON.stringify(r.store))
  rec('登录入口出现', r.toggleCount === 1, `实得 ${r.toggleCount}`)
  rec('无 pageerror', r.errs.length === 0, r.errs.slice(0, 2).join(' | ') || '0 条')
}

console.log('\n═══ ⑤ 已登录 + 探测判不支持：面板必须还在，退出登录必须可达 ═══')
{
  // 这是本条 blocker 里真正伤人的那一半：探测失败时面板整块消失，**而会话还活着**——
  // transport 照旧带着上一个人的 access_token 发请求，界面上却没有任何手段把他退掉。
  // 演示机 / 共享机上，那就是上一个人的身份留在页面里给下一个人用。
  const r = await probe(404, { settleMs: 1500, seedAuthed: true })
  console.log(`         store=${JSON.stringify(r.store)} toggle=${r.toggleCount} signOut=${r.signOutCount}`)
  rec('accountCapability 确实是 unsupported（条件真的造出来了）', r.store?.accountCapability === 'unsupported', JSON.stringify(r.store))
  rec('会话确实还在（status=authed）', r.store?.status === 'authed', JSON.stringify(r.store))
  rec('🔴 账号入口仍在（探测结果不该吞掉一个已存在的会话）', r.toggleCount === 1, `实得 ${r.toggleCount}`)
  rec('🔴 退出登录按钮可达', r.signOutCount === 1, `实得 ${r.signOutCount}`)
  rec('未登录的登录表单没有因此漏出来（弹层里没有邮箱输入框）', !r.hasEmailField)
  rec('无 pageerror', r.errs.length === 0, r.errs.slice(0, 2).join(' | ') || '0 条')
}

await browser.close()
preview.kill()

const pass = R.filter((r) => r.ok).length
const fail = R.length - pass
console.log(`\n═══ 门缝二判据：${pass} PASS · ${fail} FAIL ═══`)
if (fail) {
  console.log('\n失败项：')
  for (const r of R.filter((x) => !x.ok)) console.log(`  ✗ ${r.n}`)
}
process.exit(fail || previewExited ? 1 : 0)
