// rich-align-0722/10 · 登录隔离演示线 · 本地演示台「口径 + 边界」探针（真 Supabase env）。
//
// 打的是**隔离演示台**（默认 preview 5381 + backend 8381，见 launch-authdemo-10.md）：那份 dist
// 打了真 avery-fra 的 VITE_SUPABASE_*，后端配了 SUPABASE_URL/ANON_KEY——所以 AuthPanel 的能力探测
// （/account/status→200 configured）会让**登录入口真渲染出来**，Danny 就能在本地人手登录演示。
//
// 本探针只验到「口径对 + 边界对 + 表单就绪」，🔴 **绝不代填任何凭据**（真登录=Danny 人手）：
//   ① 后端 /account/status → configured:true（补了 Supabase env）。
//   ② 前端登录入口 .lite-auth-toggle 真渲染（能力探测=supported；旧「只看自身 env」口径已修，
//      本探针实证真 env 下也走探测）。
//   ③ 点开登录弹层 → 邮箱/密码字段就绪（Danny 可登录），且入口不挤掉任何 scene-tab。
//   ④ 边界：未登录 GET /account/contexts → 401（同体 404 需带 token，归 pytest mock resolve_account）。
//
//   VERIFY_BASE=http://localhost:5381 VERIFY_API=http://127.0.0.1:8381 \
//     node .issues/rich-align-0722/verify-auth-demo-10.mjs
import { chromium } from 'playwright'

const UI = process.env.VERIFY_BASE || 'http://localhost:5381'
const API = process.env.VERIFY_API || 'http://127.0.0.1:8381'
const R = []
const rec = (n, ok, d) => { R.push({ n, ok }); console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${n}${d ? ' — ' + d : ''}`) }

// ① 后端能力探测（补了 Supabase env）。
const status = await (await fetch(`${API}/account/status`)).json().catch(() => ({}))
rec('① 后端 /account/status configured:true（补了 Supabase env）', status.configured === true, JSON.stringify(status))
rec('① 未探到 signed_in（无 token）', status.signed_in === false)

// ④ 边界：未登录 GET /account/contexts → 401。
const contextsCode = (await fetch(`${API}/account/contexts`).catch(() => ({ status: 0 }))).status
rec('④ 边界：未登录 /account/contexts → 401', contextsCode === 401, `code=${contextsCode}`)

const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await ctx.newPage()
await page.goto(`${UI}/?v=2&mode=live&lang=zh`, { waitUntil: 'networkidle' })
if (await page.locator('.lite-onboard').count()) { await page.keyboard.press('Escape'); await page.waitForTimeout(500) }
await page.waitForTimeout(800) // 给 /account/status 能力探测一个落地窗口

// ② 登录入口真渲染（能力探测=supported）。
const toggle = await page.evaluate(() => ({
  toggle: document.querySelectorAll('.lite-auth-toggle').length,
  tabs: document.querySelectorAll('.scene-tabs .scene-tab').length,
}))
rec('② 登录入口 .lite-auth-toggle 真渲染（能力探测 supported）', toggle.toggle === 1, `toggle=${toggle.toggle}`)
rec('② 登录入口未挤掉 scene-tab（仍 9 屏满态）', toggle.tabs === 9, `tabs=${toggle.tabs}`)

// ③ 点开登录弹层 → 邮箱/密码字段就绪（🔴 只验就绪，不代填）。
await page.click('.lite-auth-toggle')
await page.waitForTimeout(300)
const form = await page.evaluate(() => ({
  pop: document.querySelectorAll('.lite-auth-pop').length,
  email: document.querySelectorAll('.lite-auth-pop input[type="email"]').length,
  password: document.querySelectorAll('.lite-auth-pop input[type="password"]').length,
}))
rec('③ 登录弹层打开 + 邮箱/密码字段就绪（Danny 可登录）',
  form.pop === 1 && form.email === 1 && form.password === 1, JSON.stringify(form))

await browser.close()
const fail = R.filter((r) => !r.ok)
console.log(`\nauth-demo-10: ${R.length - fail.length}/${R.length} pass`)
if (fail.length) {
  console.log('FAILED:', fail.map((f) => f.n).join(' · '))
  process.exit(1)
}
