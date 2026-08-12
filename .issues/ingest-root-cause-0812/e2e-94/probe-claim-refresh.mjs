// 只报不修的产品缺口探针：exploration.md 说「（游客上传→登录后）刷新丢状态，认领入口就消失」。
// 用尾段留下的 demo 克隆 K1（未绑任何账号）注入 localStorage，模拟「刷新后从盘里恢复」的形状：
// 锚点 + owner_token 都在 → 登录 A → 看认领入口在不在；再刷新一次 → 再看。
// 🔴 绝不点认领按钮（会把 demo 克隆绑进 A 名下），只读 DOM。
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'
const DIR = process.env.E2E94_DIR ?? path.dirname((process.env.E2E94_CREDS ?? "C:/Users/86139/AppData/Local/Temp/claude/D--avery-wt-jolly-mccarthy-ccdf5d/70e028e9-5210-415a-9d76-41a5a44da788/scratchpad/e2e-94/creds.json"))
const creds = JSON.parse(readFileSync(path.join(DIR, 'creds.json'), 'utf8'))
const st = JSON.parse(readFileSync(path.join(DIR, 'results-tail.json'), 'utf8')).state
const A = creds.accounts.find((a) => a.tag === 'A')
const ENTRY = `${creds.appBase}/?v=2&mode=live&look=paper&lang=zh`

const browser = await chromium.launch()
const ctx = await browser.newContext()
const page = await ctx.newPage()
await page.addInitScript(({ k1, tok }) => {
  localStorage.setItem('lite2:contextId:v1', k1)
  localStorage.setItem('lite2:ownerTokens:v1', JSON.stringify({ [k1]: tok }))
}, { k1: st.K1, tok: st.K1tok })
await page.goto(ENTRY, { waitUntil: 'networkidle', timeout: 60000 })
for (let i = 0; i < 6; i++) { if (await page.locator('.lite-gate-layer').count()) { await page.keyboard.press('Escape'); await page.waitForTimeout(300) } }
await page.waitForFunction(() => window.__lite2Store.getState().contextId !== null, null, { timeout: 30000 })
// login A
await page.waitForSelector('.lite-auth-toggle', { timeout: 20000 })
if (!(await page.locator('.lite-auth-pop').count())) await page.click('.lite-auth-toggle')
await page.fill('.lite-auth-pop input[type=email]', A.email)
await page.fill('.lite-auth-pop input[type=password]', A.password)
await page.click('.lite-auth-pop .lite-auth-submit')
await page.waitForFunction(() => window.__lite2Auth?.getState().status === 'authed', null, { timeout: 30000 })
await page.waitForTimeout(2500) // 等 /account/contexts 回来把 linkedIds 记完
const s1 = await page.evaluate(() => ({
  ctx: window.__lite2Store.getState().contextId,
  claimEntry: document.querySelectorAll('.lite-auth-claim').length,
  claimBtnText: document.querySelector('.lite-auth-claim .lite-btn--primary')?.textContent ?? null,
}))
console.log('before-refresh:', JSON.stringify(s1))
await page.reload({ waitUntil: 'networkidle', timeout: 60000 })
for (let i = 0; i < 6; i++) { if (await page.locator('.lite-gate-layer').count()) { await page.keyboard.press('Escape'); await page.waitForTimeout(300) } }
await page.waitForFunction(() => window.__lite2Auth?.getState().status === 'authed', null, { timeout: 30000 })
await page.waitForTimeout(2500)
if (!(await page.locator('.lite-auth-pop').count())) await page.click('.lite-auth-toggle')
await page.waitForTimeout(500)
const s2 = await page.evaluate(() => ({
  ctx: window.__lite2Store.getState().contextId,
  authedPanelOpen: document.querySelectorAll('.lite-auth-pop .lite-auth-who').length,
  claimEntry: document.querySelectorAll('.lite-auth-claim').length,
  claimBtnText: document.querySelector('.lite-auth-claim .lite-btn--primary')?.textContent ?? null,
}))
console.log('after-refresh:', JSON.stringify(s2))
await browser.close()
console.log(JSON.stringify({ beforeRefresh: s1, afterRefresh: s2 }))
