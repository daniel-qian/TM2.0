// partner-docs-0728 · 验收取证：直接用本地 Playwright 拍 /paperwork。
//
// 不用 Browser pane 的 screenshot —— 那个在本机会 5s 超时（面板不显示时页面不合成帧，
// 记忆 [[browser-pane-screenshot-timeout]]，本次复发第三回）。
//
//   VERIFY_BASE=http://localhost:4199 node .issues/partner-docs-0728/shoot.mjs
import { chromium } from 'playwright'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT = path.dirname(fileURLToPath(import.meta.url))
const UI = process.env.VERIFY_BASE || 'http://localhost:4199'

const browser = await chromium.launch()

async function shoot(name, { width, height, lang, expand }) {
  const page = await (await browser.newContext({ viewport: { width, height } })).newPage()
  await page.goto(`${UI}/paperwork?v=2&mode=live&look=paper&lang=${lang}`, { waitUntil: 'networkidle' })
  if (expand) {
    await page.evaluate((id) => {
      const c = [...document.querySelectorAll('.paperwork-card')].find((x) => x.dataset.docId === id)
      c.querySelector('.paperwork-toggle').click()
      const notes = document.querySelector('.paperwork-notes-toggle input')
      if (notes && !notes.checked) notes.click()
    }, expand)
    await page.waitForTimeout(400)
    await page.locator(`[data-doc-id="${expand}"]`).scrollIntoViewIfNeeded()
    await page.waitForTimeout(200)
  }
  const file = path.join(OUT, `${name}.png`)
  await page.screenshot({ path: file, fullPage: !expand })
  console.log(`  ${file}`)
  await page.close()
}

await shoot('shot-1-index-zh', { width: 1280, height: 900, lang: 'zh' })
await shoot('shot-2-dpa-expanded-zh', { width: 1280, height: 1400, lang: 'zh', expand: 'dpa' })
await shoot('shot-3-mobile-zh', { width: 375, height: 812, lang: 'zh' })
await browser.close()
