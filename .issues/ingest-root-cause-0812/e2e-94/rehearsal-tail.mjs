// #94 彩排尾段：主脚本在 7c（B 登录）处超时崩掉后的续跑 + 诊断。
// 复用主跑落盘的 state（results.json 里的 C1/G1 及 token），不再新增生产上传。
// 覆盖：⑦c/d/e（B 不串场）+ ⑥c/d/e（demo 免登录）+ ⑧（60s 缓存）。
// 诊断面：记录所有 /account/* 请求、浏览器 console error、pageerror——
// 如果 B 登录后 restore 副作用根本没发请求，这里能看见是「没发」还是「发了没等到」。

import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'

const CREDS_PATH = process.env.E2E94_CREDS
  ?? 'C:/Users/86139/AppData/Local/Temp/claude/D--avery-wt-jolly-mccarthy-ccdf5d/70e028e9-5210-415a-9d76-41a5a44da788/scratchpad/e2e-94/creds.json'
const OUT_DIR = path.dirname(CREDS_PATH)
const creds = JSON.parse(readFileSync(CREDS_PATH, 'utf8'))
// 主跑若在 finally 前就被未接住的 promise 拒绝干掉，results.json 不存在——
// 从主跑控制台日志回填两个 context id（token 不需要：⑤已在主跑记账，这里只用 id）。
let state = { C1: 'ctx_7d0330ef95dc', G1: 'ctx_aa30d88a31ee' }
try { state = JSON.parse(readFileSync(path.join(OUT_DIR, 'results.json'), 'utf8')).state } catch { /* fallback above */ }
const A = creds.accounts.find((a) => a.tag === 'A')
const B = creds.accounts.find((a) => a.tag === 'B')
const API = creds.apiBase
const ENTRY = `${creds.appBase}/?v=2&mode=live&look=paper&lang=zh`

const results = []
function rec(id, name, pass, detail) {
  results.push({ id, name, pass, detail })
  console.log(`${pass ? 'PASS' : 'FAIL'} [${id}] ${name}${detail ? ' -- ' + detail : ''}`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function api(p, headers = {}, init = {}) {
  const res = await fetch(`${API}${p}`, { ...init, headers })
  let body = null
  try { body = await res.json() } catch { /* non-JSON */ }
  return { status: res.status, body }
}
async function grant(acct) {
  const res = await fetch(`${creds.supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: creds.anonKey },
    body: JSON.stringify({ email: acct.email, password: acct.password }),
  })
  return { status: res.status, body: await res.json() }
}
// OnboardGate 闸门会盖住整页（含已打开的登录弹层）。两处会冒出来：
// ① 首帧挂载晚于我们的第一次 Escape（竞态）；② 登出时 clearCompanyScope 把 onboard
// 打回 unseen，闸门当场弹回来盖在登录弹层上（主跑 B 登录挂死的病根，真 UX 观察，进回执）。
async function dismissGate(page) {
  for (let i = 0; i < 6; i++) {
    if (!(await page.locator('.lite-gate-layer').count())) return
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)
  }
}
async function loginUI(page, acct) {
  await page.waitForSelector('.lite-auth-toggle', { timeout: 20000 })
  await dismissGate(page)
  if (!(await page.locator('.lite-auth-pop').count())) await page.click('.lite-auth-toggle')
  await page.waitForSelector('.lite-auth-pop input[type=email]', { timeout: 10000 })
  await page.fill('.lite-auth-pop input[type=email]', acct.email)
  await page.fill('.lite-auth-pop input[type=password]', acct.password)
  await page.click('.lite-auth-pop .lite-auth-submit')
  try {
    await page.waitForFunction(() => window.__lite2Auth?.getState().status === 'authed', null, { timeout: 30000 })
  } catch (err) {
    // 登录没落定——把 store 的 error/busy 与弹层上的可见文案一起吐出来再抛，别哑死。
    const diag = await page.evaluate(() => {
      const a = window.__lite2Auth?.getState() ?? {}
      return { status: a.status, busy: a.busy, error: a.error, pendingVerification: a.pendingVerification }
    }).catch(() => null)
    const popText = await page.locator('.lite-auth-pop').innerText().catch(() => '(no popup)')
    throw new Error(`loginUI(${acct.tag}) did not reach authed: auth=${JSON.stringify(diag)} popup=${JSON.stringify(popText)}`)
  }
}

const browser = await chromium.launch()
try {
  // ══ ⑦c/d/e · A 登出 → B 登录不串场（带诊断）════════════════════════════════════
  {
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    const wire = [] // 全部 /account/* 往返
    page.on('request', (r) => { if (r.url().includes('/account/')) wire.push(`>> ${r.method()} ${r.url().split('.com')[1]}`) })
    page.on('response', (r) => { if (r.url().includes('/account/')) wire.push(`<< ${r.status()} ${r.url().split('.com')[1]}`) })
    const consoleErrs = []
    page.on('console', (m) => { if (m.type() === 'error') consoleErrs.push(m.text().slice(0, 200)) })
    page.on('pageerror', (e) => consoleErrs.push(`pageerror: ${String(e).slice(0, 200)}`))

    await page.goto(ENTRY, { waitUntil: 'networkidle', timeout: 60000 })
    await page.keyboard.press('Escape')
    await page.waitForTimeout(400)
    await loginUI(page, A)
    // A 名下已有 [G1, C1]，restore 会自动接管第一个——等它落定（形状同主跑 P3 的登录态）
    await page.waitForFunction(() => window.__lite2Store.getState().contextId !== null, null, { timeout: 30000 })
    const aCtx = await page.evaluate(() => window.__lite2Store.getState().contextId)
    // 登出
    if (!(await page.locator('.lite-auth-pop').count())) await page.click('.lite-auth-toggle')
    await page.waitForSelector('[data-role="sign-out"]', { timeout: 10000 })
    await page.click('[data-role="sign-out"]')
    await page.waitForFunction(() => window.__lite2Auth?.getState().status === 'guest', null, { timeout: 20000 })
    wire.push('--- A signed out, signing in B ---')
    // 登出把 onboard 打回 unseen → 闸门弹回来盖住登录弹层——先送走它（loginUI 里也会再扫一次）
    await dismissGate(page)
    // B 登录
    await loginUI(page, B)
    // 等 restore 副作用发 /account/contexts（宽限 20s，超时不崩，转诊断）
    let sawContexts = null
    try {
      const resp = await page.waitForResponse((r) => r.url().endsWith('/account/contexts'), { timeout: 20000 })
      sawContexts = { status: resp.status(), body: await resp.json().catch(() => null) }
    } catch {
      sawContexts = null
    }
    await page.waitForTimeout(1000)
    const bState = await page.evaluate(() => {
      const s = window.__lite2Store.getState()
      const left = []
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)
        if (k?.startsWith('lite2:') && k !== 'lite2:lang:v1' && k !== 'lite2:look:v1') left.push(k)
      }
      return {
        auth: { status: window.__lite2Auth.getState().status, email: window.__lite2Auth.getState().email },
        contextId: s.contextId, people: (s.rawTeam?.people ?? []).length, dirtyKeys: left,
        hasFetchContexts: Boolean(s.transport.fetchAccountContexts),
      }
    })
    console.log('WIRE:', JSON.stringify(wire, null, 1))
    if (consoleErrs.length) console.log('CONSOLE:', JSON.stringify(consoleErrs.slice(0, 10), null, 1))
    rec('7c', 'B 登录 /account/contexts 为空（不见 A 的 context）',
      sawContexts?.status === 200 && (sawContexts.body?.context_ids ?? ['sentinel']).length === 0,
      `resp=${JSON.stringify(sawContexts)} aHad=${aCtx}`)
    rec('7d', 'B 登录后屏上与 localStorage 均无 A 残留',
      bState.auth.email === B.email && bState.contextId === null && bState.people === 0 && bState.dirtyKeys.length === 0,
      JSON.stringify(bState))
    const tokB = await page.evaluate(() => {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)
        if (k?.startsWith('sb-') && k.endsWith('-auth-token')) { try { return JSON.parse(localStorage.getItem(k)).access_token } catch { return null } }
      }
      return null
    })
    const bReadsC1 = await api(`/team/${state.C1}`, { 'X-Avery-Account': tokB })
    rec('7e', 'B 的账号 token 读 A 的 context 是 404', bReadsC1.status === 404, `status=${bReadsC1.status}`)
    await ctx.close()
  }

  // ══ ⑥ demo 免登录不变量 ═══════════════════════════════════════════════════════
  {
    const claim = await api('/demo/claim', {}, { method: 'POST' })
    state.K1 = claim.body?.context_id ?? null
    state.K1tok = claim.body?.owner_token ?? null
    rec('6c', '/demo/claim 无凭据可领取（demo:true）', claim.status === 200 && claim.body?.demo === true,
      `status=${claim.status} ctx=${state.K1} ephemeral=${JSON.stringify(claim.body?.ephemeral)}`)
    const gA = await grant(A)
    const listA = await api('/account/contexts', { 'X-Avery-Account': gA.body?.access_token })
    rec('6d', 'demo 克隆不进任何账号名下（A 的 contexts 不含它）',
      listA.status === 200 && !(listA.body?.context_ids ?? []).includes(state.K1),
      `ids=${JSON.stringify(listA.body?.context_ids)}`)
    const k1 = await api(`/team/${state.K1}`, { 'X-Avery-Token': state.K1tok })
    rec('6e', 'demo 克隆自己的 owner_token 腿可读', k1.status === 200, `status=${k1.status}`)
  }

  // ══ ⑧ 真 JWT 的 60s 服务端缓存过期（最后跑：全局登出 A）═══════════════════════════
  {
    const g = await grant(A)
    const T = g.body?.access_token
    const t0 = Date.now()
    const fill = await api('/account/contexts', { 'X-Avery-Account': T })
    rec('8a', '新 JWT 首次核验 200（填缓存）', fill.status === 200, `status=${fill.status}`)
    const out = await fetch(`${creds.supabaseUrl}/auth/v1/logout?scope=global`, {
      method: 'POST', headers: { Authorization: `Bearer ${T}`, apikey: creds.anonKey },
    })
    rec('8b', '全局登出（撤销该用户所有会话）', out.status === 204 || out.status === 200, `status=${out.status}`)
    const inWin = await api('/account/contexts', { 'X-Avery-Account': T })
    const tIn = ((Date.now() - t0) / 1000).toFixed(1)
    const gotrueNow = await fetch(`${creds.supabaseUrl}/auth/v1/user`, { headers: { Authorization: `Bearer ${T}`, apikey: creds.anonKey } })
    state.gotrueAfterLogout = gotrueNow.status
    rec('8c', `撤销后缓存窗内（t+${tIn}s）后端仍 200 = 缓存在生效`, inWin.status === 200,
      `backend=${inWin.status} gotrue-direct=${gotrueNow.status}`)
    console.log('  ... waiting for the 60s server cache window to expire ...')
    await sleep(Math.max(0, 65000 - (Date.now() - t0)))
    const outWin = await api('/account/contexts', { 'X-Avery-Account': T })
    const tOut = ((Date.now() - t0) / 1000).toFixed(1)
    rec('8d', `缓存窗过后（t+${tOut}s）同一 token 落 401 = 60s 缓存到期重核验`, outWin.status === 401, `status=${outWin.status}`)
  }
} finally {
  writeFileSync(path.join(OUT_DIR, 'results-tail.json'), JSON.stringify({ state, results }, null, 2))
  await browser.close()
}
const failed = results.filter((r) => !r.pass)
console.log(`\n==== ${results.length - failed.length}/${results.length} PASS ====`)
if (failed.length) for (const f of failed) console.log(` - FAIL [${f.id}] ${f.name} -- ${f.detail}`)
process.exit(failed.length ? 1 : 0)
