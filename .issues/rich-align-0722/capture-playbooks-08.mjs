// rich-align-0722/08 · 满态方法库网格取证（demo claim → playbooks 屏截图，aurora + paper）。
// 存进 eval-harness/reports/pixel-evidence/08/ 供 Danny 晨审并排对照她方 /playbooks。
// 🔴 本地 Playwright 直拍（Browser pane 截图会超时——记忆条目）。从 /d/avery 跑。
//   VERIFY_BASE=http://localhost:5173 node .issues/rich-align-0722/capture-playbooks-08.mjs
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const UI = process.env.VERIFY_BASE || 'http://localhost:5173'
const OUT = 'eval-harness/reports/pixel-evidence/08'
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({ headless: true })
for (const look of ['aurora', 'paper']) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  await page.goto(`${UI}/?v=2&mode=live&look=${look}&lang=zh`, { waitUntil: 'networkidle' })
  if (await page.locator('.lite-onboard').count()) { await page.keyboard.press('Escape'); await page.waitForTimeout(500) }
  await page.evaluate(async () => { await window.__lite2Store.getState().claimDemoTeam() })
  await page.waitForFunction(
    () => (window.__lite2Store.getState().rawTeam?.playbooks?.length ?? 0) > 0, undefined, { timeout: 30000 })
  await page.evaluate(() => window.__lite2Store.getState().goScreen('playbooks'))
  await page.waitForTimeout(600)
  const n = await page.evaluate(() => document.querySelectorAll('.lite-playbooks-card').length)
  await page.screenshot({ path: `${OUT}/playbooks-fullstate-${look}-desktop.png`, fullPage: true })
  console.log(`  captured ${look}: ${n} 方法卡 → ${OUT}/playbooks-fullstate-${look}-desktop.png`)
  await ctx.close()
}
await browser.close()
console.log('done')
