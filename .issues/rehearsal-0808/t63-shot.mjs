// #63 人眼过用的一次性截图脚本：领 demo 团队 → 差距摘要块（摘要态 + 展开态）三视角。
//   VERIFY_BASE=http://localhost:5173 node .issues/rehearsal-0808/t63-shot.mjs
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const UI = process.env.VERIFY_BASE || 'http://localhost:5173'
const OUT = '.issues/rehearsal-0808/t63-shots'
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch()

async function shoot(look, viewport, tag) {
  const ctx = await browser.newContext({ viewport })
  const page = await ctx.newPage()
  await page.goto(`${UI}/?v=2&mode=live&lang=zh&look=${look}`, { waitUntil: 'networkidle' })
  if (await page.locator('.lite-onboard').count()) {
    await page.keyboard.press('Escape')
    await page.waitForTimeout(500)
  }
  await page.locator('.lite-home-demo-btn').click()
  await page.waitForSelector('.lite-home-gaps', { timeout: 30000 })
  await page.waitForTimeout(600)
  await page.locator('.lite-home-gaps').scrollIntoViewIfNeeded()
  await page.screenshot({ path: `${OUT}/${tag}-summary.png`, fullPage: false })
  await page.locator('.lite-home-gap-expand').click()
  await page.waitForSelector('.lite-gap-card', { timeout: 8000 })
  // 厘清一条造出历史折叠，展开它——历史形态也要过眼
  await page.locator('.lite-gap-card .lite-gap-resolve').first().click()
  await page.waitForTimeout(300)
  await page.locator('.lite-gap-history-toggle').click()
  await page.waitForTimeout(300)
  await page.locator('.lite-home-gaps').scrollIntoViewIfNeeded()
  await page.screenshot({ path: `${OUT}/${tag}-expanded.png`, fullPage: true })
  await ctx.close()
}

await shoot('paper', { width: 1440, height: 900 }, 'paper-desktop')
await shoot('aurora', { width: 1440, height: 900 }, 'aurora-desktop')
await shoot('paper', { width: 390, height: 844 }, 'paper-mobile')

await browser.close()
console.log('shots written to', OUT)
