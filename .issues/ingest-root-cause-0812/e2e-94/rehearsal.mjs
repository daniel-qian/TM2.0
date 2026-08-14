// #94 账号方案 A 真彩排 —— 九判据端到端（全对生产跑，avery-e2e 测试户）。
//
// 用法：node .issues/ingest-root-cause-0812/e2e-94/rehearsal.mjs
//   凭据：E2E94_CREDS 指向 creds.json（默认取 scratchpad 路径，见下）。creds.json 形状：
//   { supabaseUrl, anonKey, apiBase, appBase, accounts: [{tag:'A'|'B', email, password}] }
//   🔴 凭据/状态/截图一律落 creds.json 同目录（scratchpad），绝不进仓（本目录 .gitignore 通配挡）。
//
// 🔴 建号先跑 `mkaccounts.mjs`（#101 起）：原来那套「anon key 打 signup → SSH 进生产容器把
//   email_confirmed_at 改上」在注册门冻结后**第一步就被真闸挡死**，且报错完全不像「注册关了」。
//   现行是 `admin.createUser({ email_confirm: true })` 一步建成已确认。
//   本脚本自己的动线（password grant + 登录表单）不含任何 signup 调用，冻结后照常跑。
//
// 九判据（正源 issue #94 / exploration.md §2）：
//   ① 登录态上传 → account_linked:true        ② /account/contexts 列出 + 无 header 401
//   ③ 换设备登录 adoptContext 恢复（核心）     ④ 游客上传 → 手动认领 claimed:true
//   ⑤ 登出后 owner_token 腿仍 200             ⑥ demo 免登录不变量
//   ⑦ 双账号切换不串场（lite2:* 清空）        ⑧ 真 JWT 60s 服务端缓存过期
//   ⑨ token 续期后请求不 401
//
// 设计要点：
// - 每个「设备」= 一个全新 browser context（真换设备语义，不靠手工清 key）。
// - 上传走 window.__lite2Store.getState().uploadFiles（无条件缝，生产 build 存在；与在册门同姿势），
//   网络层同时抓 /ingest 的请求 header 与响应体——判据落在真实 HTTP 往返上。
// - ⑧ 全在 node 侧：password grant 拿真 JWT → 填缓存 → 全局登出 → 窗口内/外各探一次，
//   中间直探 GoTrue /auth/v1/user 证明「窗口内 200 来自缓存而不是 Supabase 还认」。
// - ⑨ 把 supabase-js 持久化会话的 expires_at 拨到过期，reload 触发真 refresh_token 续期
//   （同一条 autoRefreshToken 机器路径，不等 1 小时）。
// - 断言失败不中断整场：逐条记账，最后写 results JSON + ASCII 摘要。

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { chromium } from 'playwright'

const CREDS_PATH = process.env.E2E94_CREDS
  ?? 'C:/Users/86139/AppData/Local/Temp/claude/D--avery-wt-jolly-mccarthy-ccdf5d/70e028e9-5210-415a-9d76-41a5a44da788/scratchpad/e2e-94/creds.json'
const OUT_DIR = path.dirname(CREDS_PATH)
const creds = JSON.parse(readFileSync(CREDS_PATH, 'utf8'))
const A = creds.accounts.find((a) => a.tag === 'A')
const B = creds.accounts.find((a) => a.tag === 'B')
const API = creds.apiBase
const APP = creds.appBase
const ENTRY = `${APP}/?v=2&mode=live&look=paper&lang=zh`

const results = []
const state = { startedAt: new Date().toISOString() }
function rec(id, name, pass, detail) {
  results.push({ id, name, pass, detail })
  console.log(`${pass ? 'PASS' : 'FAIL'} [${id}] ${name}${detail ? ' -- ' + detail : ''}`)
}
function save() {
  writeFileSync(path.join(OUT_DIR, 'results.json'), JSON.stringify({ state, results }, null, 2))
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ── node 侧 API 探针 ─────────────────────────────────────────────────────────────
async function api(p, headers = {}, init = {}) {
  const res = await fetch(`${API}${p}`, { ...init, headers: { ...headers, ...(init.body ? { 'Content-Type': 'application/json' } : {}) } })
  let body = null
  try { body = await res.json() } catch { /* non-JSON */ }
  return { status: res.status, body }
}
async function grant(acct) { // password grant -> {access_token, refresh_token, user}
  const res = await fetch(`${creds.supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: creds.anonKey },
    body: JSON.stringify({ email: acct.email, password: acct.password }),
  })
  return { status: res.status, body: await res.json() }
}

// ── 浏览器侧助手 ────────────────────────────────────────────────────────────────
// 🔴 OnboardGate 闸门会盖住整页（含已打开的登录弹层），两处冒头（0812 实收）：
// ① 首帧挂载可能晚于第一次 Escape（竞态）；② 登出时 clearCompanyScope 把 onboard 打回
// unseen，闸门当场弹回来盖住登录弹层——「A 登出 → B 登录」必须先送走它。
async function dismissGate(page) {
  for (let i = 0; i < 6; i++) {
    if (!(await page.locator('.lite-gate-layer').count())) return
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)
  }
}
// 🔴 waitForResponse 的 promise 若在被 await 之前就超时拒绝（前面还压着别的 await），
// 未接住的拒绝会直接杀掉进程、finally 都不跑（0812 主跑就这么死的）。建好即挂个哑 catch，
// await 原 promise 该抛照抛，但绝不再炸进程。
const armed = (p) => (p.catch(() => {}), p)
async function openApp(ctx) {
  const page = await ctx.newPage()
  await page.goto(ENTRY, { waitUntil: 'networkidle', timeout: 60000 })
  await dismissGate(page)
  return page
}
async function loginUI(page, acct) {
  await page.waitForSelector('.lite-auth-toggle', { timeout: 20000 })
  await dismissGate(page)
  const popupOpen = await page.locator('.lite-auth-pop').count()
  if (!popupOpen) await page.click('.lite-auth-toggle')
  await page.waitForSelector('.lite-auth-pop input[type=email]', { timeout: 10000 })
  await page.fill('.lite-auth-pop input[type=email]', acct.email)
  await page.fill('.lite-auth-pop input[type=password]', acct.password)
  await page.click('.lite-auth-pop .lite-auth-submit')
  await page.waitForFunction(() => window.__lite2Auth?.getState().status === 'authed', null, { timeout: 30000 })
}
async function logoutUI(page) {
  await dismissGate(page)
  const popupOpen = await page.locator('.lite-auth-pop').count()
  if (!popupOpen) await page.click('.lite-auth-toggle')
  await page.waitForSelector('[data-role="sign-out"]', { timeout: 10000 })
  await page.click('[data-role="sign-out"]')
  await page.waitForFunction(() => window.__lite2Auth?.getState().status === 'guest', null, { timeout: 20000 })
}
// 上传（走 store 缝 = 与在册门同姿势），同拍抓 /ingest 的请求头与响应体。
async function uploadAndCapture(page, files) {
  const respP = page.waitForResponse((r) => r.url().endsWith('/ingest') && r.request().method() === 'POST', { timeout: 300000 })
  await page.evaluate(async (fs) => {
    const enc = new TextEncoder()
    await window.__lite2Store.getState().uploadFiles(fs.map((f) => new File([enc.encode(f.text)], f.name, { type: 'text/csv' })))
  }, files)
  const resp = await respP
  const reqHeaders = resp.request().headers()
  const body = await resp.json()
  await page.waitForFunction(() => ['ready', 'error'].includes(window.__lite2Store.getState().ingestStatus), null, { timeout: 300000 })
  const ingestStatus = await page.evaluate(() => window.__lite2Store.getState().ingestStatus)
  return { status: resp.status(), body, accountHeader: reqHeaders['x-avery-account'] ?? null, ingestStatus }
}
const teamShape = (payload) => ({
  people: (payload.people ?? []).map((p) => p.name).sort(),
  projects: (payload.projects ?? []).map((p) => p.title ?? p.name).sort(),
})
async function pageToken(page) { // supabase-js 持久化会话里的 access_token
  return page.evaluate(() => {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k?.startsWith('sb-') && k.endsWith('-auth-token')) {
        try { return { key: k, token: JSON.parse(localStorage.getItem(k)).access_token } } catch { return null }
      }
    }
    return null
  })
}

const CSV1 = { name: '员工名册-e2e.csv', text: '姓名,职务,负责项目\n赵一测,店长,门店翻新\n钱二测,采购,门店翻新\n孙三测,库管,盘点系统\n李四测,收银,盘点系统\n' }
const CSV2 = { name: '交接备忘-e2e.csv', text: '姓名,职务,备注\n周五测,前台,新来的\n吴六测,保洁,周三休\n' }

const browser = await chromium.launch()
try {
  // ══ P0 · 无凭据基线（判据②的 401 半边 + ⑥的可用性基线）═══════════════════════
  {
    const r = await api('/account/contexts')
    rec('2a', '/account/contexts 无 header 是 401 不是 200', r.status === 401, `status=${r.status}`)
    const d = await api('/demo/status')
    rec('6a', '/demo/status 无凭据 200 且 available', d.status === 200 && d.body?.available === true, `status=${d.status} body=${JSON.stringify(d.body)}`)
  }

  // ══ P1 · 设备一：A 登录 → 上传 → 判据①②══════════════════════════════════════
  {
    const ctx = await browser.newContext()
    const page = await openApp(ctx)
    await loginUI(page, A)
    // 重跑防呆：常驻户名下若已有 context，登录会自动接管，uploadFiles 就不再走 /ingest 新铸。
    // 重跑本脚本前先跑 cleanup 解绑（或换日期建新号），否则在这儿明确死掉，别让 P1 静默变形。
    await page.waitForTimeout(1500)
    const preAdopted = await page.evaluate(() => window.__lite2Store.getState().contextId)
    if (preAdopted) throw new Error(`P1: account A already owns ${preAdopted} - unlink (cleanup) before re-running`)
    const up = await uploadAndCapture(page, [CSV1])
    state.C1 = up.body?.context_id ?? null
    state.C1tok = up.body?.owner_token ?? null
    state.C1shape = teamShape(up.body ?? {})
    state.C1extraction = up.body?.extraction_mode
    rec('1a', '登录态 /ingest 请求带账号 header', Boolean(up.accountHeader), `header=${up.accountHeader ? 'present' : 'absent'}`)
    rec('1b', '登录态上传响应 account_linked:true', up.body?.account_linked === true, `account_linked=${JSON.stringify(up.body?.account_linked)} ctx=${state.C1} status=${up.status} ingest=${up.ingestStatus}`)
    rec('1c', '上传真出了数据（extraction 非空）', (state.C1shape.people.length ?? 0) > 0, `people=${JSON.stringify(state.C1shape.people)} projects=${JSON.stringify(state.C1shape.projects)} mode=${state.C1extraction}`)
    // 面板显示「已绑定」而不是认领入口（linkedIds 经 rawTeam.account_linked 记账）。
    // 🔴 空真防线：先证明 authed 面板真的开着（.lite-auth-who 在），再数认领入口 ==0，
    // 并以「已绑定」注记作正面对照——不然 popup 被误关时 0 个入口照样绿。
    const popupOpen1 = await page.locator('.lite-auth-pop').count()
    if (!popupOpen1) await page.click('.lite-auth-toggle')
    await page.waitForSelector('.lite-auth-pop .lite-auth-who', { timeout: 10000 })
    const claimEntries = await page.locator('.lite-auth-claim').count()
    const attachedNote = await page.locator('.lite-auth-pop .lite-auth-note').allTextContents()
    rec('1d', '登录态上传后面板显示已绑定、不出认领入口', claimEntries === 0 && attachedNote.some((t) => t.includes('已绑定')),
      `claimEntries=${claimEntries} notes=${JSON.stringify(attachedNote)}`)
    const tok = await pageToken(page)
    state.Atoken1 = tok?.token ?? null
    const list = await api('/account/contexts', { 'X-Avery-Account': state.Atoken1 })
    rec('2b', '/account/contexts(A) 列出刚传的 context', list.status === 200 && (list.body?.context_ids ?? []).includes(state.C1), `status=${list.status} ids=${JSON.stringify(list.body?.context_ids)}`)
    await ctx.close()
  }

  // ══ P2 · 设备二（全新 context）：A 登录 → adoptContext 恢复（判据③核心）+ ⑨续期 + ⑥并存半边══
  {
    const ctx = await browser.newContext()
    const page = await openApp(ctx)
    const noLocal = await page.evaluate(() => localStorage.getItem('lite2:contextId:v1') === null && localStorage.getItem('lite2:ownerTokens:v1') === null)
    rec('3a', '设备二起点确实无本地状态（真换设备语义）', noLocal, '')
    const restoreP = armed(page.waitForResponse((r) => r.url().endsWith('/account/contexts'), { timeout: 30000 }))
    await loginUI(page, A)
    const restore = await restoreP
    rec('3b', '登录即拉 /account/contexts 且 200', restore.status() === 200, `status=${restore.status()}`)
    await page.waitForFunction((want) => window.__lite2Store.getState().contextId === want, state.C1, { timeout: 30000 })
    await page.waitForFunction(() => (window.__lite2Store.getState().rawTeam?.people ?? []).length > 0, null, { timeout: 60000 })
    const got = await page.evaluate(() => {
      const s = window.__lite2Store.getState()
      return { contextId: s.contextId, raw: { people: s.rawTeam?.people ?? [], projects: s.rawTeam?.projects ?? [] }, anchor: localStorage.getItem('lite2:contextId:v1') }
    })
    const gotShape = teamShape(got.raw)
    const same = JSON.stringify(gotShape) === JSON.stringify(state.C1shape)
    rec('3c', '换设备恢复：adoptContext 落到同一 context 且人/项目对得上（核心判据）', got.contextId === state.C1 && same,
      `ctx=${got.contextId} want=${state.C1} people=${JSON.stringify(gotShape.people)} projects=${JSON.stringify(gotShape.projects)}`)
    rec('3d', '恢复把锚点落回 localStorage（刷新不再丢）', got.anchor === state.C1, `anchor=${got.anchor}`)
    await page.screenshot({ path: path.join(OUT_DIR, 'p2-device2-restored.png'), fullPage: false })

    // ⑥ 半边：登录会话并存时，无凭据 /demo/status 照常 200（从应用同源发、不带任何 header）
    const demoParallel = await page.evaluate(async (apiBase) => {
      const r = await fetch(`${apiBase}/demo/status`)
      return { status: r.status, body: await r.json() }
    }, API)
    rec('6b', '登录会话并存时 /demo/status 无凭据仍 200 available', demoParallel.status === 200 && demoParallel.body?.available === true, JSON.stringify(demoParallel))

    // ⑨ 续期：把持久化会话拨到过期 → reload → supabase-js 用 refresh_token 真续期
    const before = await pageToken(page)
    await page.evaluate(() => {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)
        if (k?.startsWith('sb-') && k.endsWith('-auth-token')) {
          const v = JSON.parse(localStorage.getItem(k))
          v.expires_at = Math.floor(Date.now() / 1000) - 10
          localStorage.setItem(k, JSON.stringify(v))
        }
      }
    })
    const contextsAfterRefreshP = armed(page.waitForResponse((r) => r.url().endsWith('/account/contexts'), { timeout: 45000 }))
    await page.reload({ waitUntil: 'networkidle', timeout: 60000 })
    await page.waitForFunction(() => window.__lite2Auth?.getState().status === 'authed', null, { timeout: 30000 })
    const after = await pageToken(page)
    const rotated = Boolean(before?.token && after?.token && before.token !== after.token)
    rec('9a', '拨过期 + reload 后 supabase-js 真换发了新 token', rotated, `before=${before?.token?.slice(-12)} after=${after?.token?.slice(-12)}`)
    const ctxResp = await contextsAfterRefreshP
    const usedHeader = ctxResp.request().headers()['x-avery-account'] ?? ''
    rec('9b', '续期后应用请求带新 token 且不 401', ctxResp.status() === 200 && usedHeader === after?.token,
      `status=${ctxResp.status()} headerIsNewToken=${usedHeader === after?.token}`)
    const teamOk = await page.evaluate(() => (window.__lite2Store.getState().rawTeam?.people ?? []).length > 0)
    rec('9c', '续期后团队数据仍在（/team 腿也不 401）', teamOk, '')
    await ctx.close()
  }

  // ══ P3 · 设备三：游客上传 → 登录 → 手动认领（判据④）→ 登出（⑤⑦a）→ B 登录（⑦b）══
  {
    const ctx = await browser.newContext()
    const page = await openApp(ctx)
    const up = await uploadAndCapture(page, [CSV2])
    state.G1 = up.body?.context_id ?? null
    state.G1tok = up.body?.owner_token ?? null
    state.G1shape = teamShape(up.body ?? {})
    rec('4a', '游客 /ingest 不带账号 header 且响应无 account_linked', !up.accountHeader && up.body?.account_linked === undefined,
      `header=${up.accountHeader ? 'present' : 'absent'} account_linked=${JSON.stringify(up.body?.account_linked)} ctx=${state.G1}`)
    await loginUI(page, A)
    const kept = await page.evaluate(() => window.__lite2Store.getState().contextId)
    rec('4b', '登录动作没吞游客刚传的数据（contextId 未变）', kept === state.G1, `ctx=${kept}`)
    // 手动点认领
    const popupOpen = await page.locator('.lite-auth-pop').count()
    if (!popupOpen) await page.click('.lite-auth-toggle')
    await page.waitForSelector('.lite-auth-claim .lite-btn--primary', { timeout: 15000 })
    await page.screenshot({ path: path.join(OUT_DIR, 'p3-claim-entry.png') })
    const claimP = page.waitForResponse((r) => r.url().endsWith('/account/claim') && r.request().method() === 'POST', { timeout: 30000 })
    await page.click('.lite-auth-claim .lite-btn--primary')
    const claimResp = await claimP
    const claimBody = await claimResp.json().catch(() => null)
    rec('4c', '手动认领 POST /account/claim 回 claimed:true', claimResp.status() === 200 && claimBody?.claimed === true,
      `status=${claimResp.status()} body=${JSON.stringify(claimBody)}`)
    const tokA = await pageToken(page)
    const list = await api('/account/contexts', { 'X-Avery-Account': tokA?.token })
    rec('4d', '认领后 /account/contexts 含该 context', (list.body?.context_ids ?? []).includes(state.G1), `ids=${JSON.stringify(list.body?.context_ids)}`)
    // 产品缺口探针（只报不修）：不认领先刷新，认领入口还在不在？
    // （authGuestNote 说「登录只是把数据存到你名下」——真相是要手动点这一下）
    await page.waitForTimeout(300)

    // ⑦a + ⑤：登出
    await logoutUI(page)
    const wiped = await page.evaluate(() => {
      const left = []
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)
        if (k?.startsWith('lite2:')) left.push(k)
      }
      return left
    })
    const onlyPrefs = wiped.every((k) => k === 'lite2:lang:v1' || k === 'lite2:look:v1')
    rec('7a', 'A 登出后 lite2:* 已被 clearCompanyScope 清空（偏好白名单除外）', onlyPrefs, `left=${JSON.stringify(wiped)}`)
    const cleared = await page.evaluate(() => {
      const s = window.__lite2Store.getState()
      return { contextId: s.contextId, people: (s.rawTeam?.people ?? []).length }
    })
    rec('7b', 'A 登出后屏上数据已清（contextId null）', cleared.contextId === null && cleared.people === 0, JSON.stringify(cleared))
    // ⑤ 登出后 owner_token 腿仍 200（claim 是加法不是收权——也是要写进报告的产品事实）
    const g1 = await api(`/team/${state.G1}`, { 'X-Avery-Token': state.G1tok })
    const c1 = await api(`/team/${state.C1}`, { 'X-Avery-Token': state.C1tok })
    rec('5a', '登出后 G1 的 owner_token 腿仍 200', g1.status === 200, `status=${g1.status}`)
    rec('5b', '登出后 C1 的 owner_token 腿仍 200', c1.status === 200, `status=${c1.status}`)

    // ⑦b：B 在同一台机器登录，看不到 A 的任何东西
    // （登出已把 onboard 打回 unseen → 闸门盖住登录弹层，loginUI 里的 dismissGate 会送走它）
    const restoreBP = armed(page.waitForResponse((r) => r.url().endsWith('/account/contexts'), { timeout: 30000 }))
    await loginUI(page, B)
    const restoreB = await restoreBP
    const bodyB = await restoreB.json().catch(() => null)
    rec('7c', 'B 登录 /account/contexts 为空（不见 A 的 context）', restoreB.status() === 200 && (bodyB?.context_ids ?? []).length === 0, `ids=${JSON.stringify(bodyB?.context_ids)}`)
    const bScreen = await page.evaluate(() => {
      const s = window.__lite2Store.getState()
      const left = []
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)
        if (k?.startsWith('lite2:') && k !== 'lite2:lang:v1' && k !== 'lite2:look:v1') left.push(k)
      }
      return { contextId: s.contextId, people: (s.rawTeam?.people ?? []).length, dirtyKeys: left }
    })
    rec('7d', 'B 登录后屏上与 localStorage 均无 A 残留', bScreen.contextId === null && bScreen.people === 0 && bScreen.dirtyKeys.length === 0, JSON.stringify(bScreen))
    // B 侧 API 双查：B 的 token 打不开 A 的 context
    const tokB = await pageToken(page)
    const bReadsC1 = await api(`/team/${state.C1}`, { 'X-Avery-Account': tokB?.token })
    rec('7e', 'B 的账号 token 读 A 的 context 是 404', bReadsC1.status === 404, `status=${bReadsC1.status}`)
    await ctx.close()
  }

  // ══ P4 · ⑥ demo 免登录不变量（无凭据领取 + 与账号不串）═══════════════════════════
  {
    const claim = await api('/demo/claim', {}, { method: 'POST' })
    state.K1 = claim.body?.context_id ?? null
    state.K1tok = claim.body?.owner_token ?? null
    rec('6c', '/demo/claim 无凭据可领取（demo:true）', claim.status === 200 && claim.body?.demo === true, `status=${claim.status} ctx=${state.K1} ephemeral=${JSON.stringify(claim.body?.ephemeral)}`)
    const gA = await grant(A)
    const listA = await api('/account/contexts', { 'X-Avery-Account': gA.body?.access_token })
    state.AtokenP4 = gA.body?.access_token
    state.ArefreshP4 = gA.body?.refresh_token
    const notLinked = !(listA.body?.context_ids ?? []).includes(state.K1)
    rec('6d', 'demo 克隆不进任何账号名下（A 的 contexts 不含它）', notLinked, `ids=${JSON.stringify(listA.body?.context_ids)}`)
    const k1 = await api(`/team/${state.K1}`, { 'X-Avery-Token': state.K1tok })
    rec('6e', 'demo 克隆自己的 owner_token 腿可读', k1.status === 200, `status=${k1.status}`)
  }

  // ══ P5 · ⑧ 真 JWT 的 60s 服务端缓存过期（最后跑：会全局登出 A）═══════════════════
  {
    const g = await grant(A)
    const T = g.body?.access_token
    const t0 = Date.now()
    const fill = await api('/account/contexts', { 'X-Avery-Account': T })
    rec('8a', '新 JWT 首次核验 200（填缓存）', fill.status === 200, `status=${fill.status}`)
    const out = await fetch(`${creds.supabaseUrl}/auth/v1/logout?scope=global`, { method: 'POST', headers: { Authorization: `Bearer ${T}`, apikey: creds.anonKey } })
    rec('8b', '全局登出（撤销该用户所有会话）', out.status === 204 || out.status === 200, `status=${out.status}`)
    const inWin = await api('/account/contexts', { 'X-Avery-Account': T })
    const tIn = ((Date.now() - t0) / 1000).toFixed(1)
    const gotrueNow = await fetch(`${creds.supabaseUrl}/auth/v1/user`, { headers: { Authorization: `Bearer ${T}`, apikey: creds.anonKey } })
    rec('8c', `撤销后缓存窗内（t+${tIn}s）后端仍 200 = 缓存在生效`, inWin.status === 200, `backend=${inWin.status} gotrue-direct=${gotrueNow.status}`)
    state.gotrueAfterLogout = gotrueNow.status
    console.log('  ... waiting 65s for the server cache window to expire ...')
    await sleep(Math.max(0, 65000 - (Date.now() - t0)))
    const outWin = await api('/account/contexts', { 'X-Avery-Account': T })
    const tOut = ((Date.now() - t0) / 1000).toFixed(1)
    rec('8d', `缓存窗过后（t+${tOut}s）同一 token 落 401 = 60s 缓存到期重核验`, outWin.status === 401, `status=${outWin.status}`)
  }
} finally {
  state.finishedAt = new Date().toISOString()
  save()
  await browser.close()
}

const failed = results.filter((r) => !r.pass)
console.log(`\n==== ${results.length - failed.length}/${results.length} PASS ====`)
if (failed.length) { console.log('FAILED:'); for (const f of failed) console.log(` - [${f.id}] ${f.name} -- ${f.detail}`) }
console.log(`results: ${path.join(OUT_DIR, 'results.json')}`)
process.exit(failed.length ? 1 : 0)
