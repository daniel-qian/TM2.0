// 视口高度矩阵探针：居中最怕的是**溢出**——flex 的 `justify-content:center` 在自由空间为负时
// 会朝两头同时溢出，开场块的顶会被顶到 board 内容盒**上方**，也就是钻进顶栏底下。
// 「视口高度是盲轴」是本仓已立的碑（让位余量是高度的函数，en 比 zh 先塌），所以两种语言都跑。
// 用 verify-topbar-clearance 的同一组高度点 + 两个窄屏点。
import { chromium } from 'playwright'

const UI = process.env.VERIFY_BASE || 'http://127.0.0.1:5283'
const ROSTER = ['# 别墅酒店 员工花名册', '', '姓名 | 人员ID | 部门 | 职位 | 司龄',
  '周雅婷 | MKT-001 | 市场推广部 | 市场专员 | 3年'].join('\n')
const VPS = [[1440, 900], [1366, 768], [1280, 900], [1280, 720], [1024, 768], [900, 700],
  [880, 640], [815, 740], [390, 844], [375, 812], [390, 667]]

const browser = await chromium.launch()
for (const lang of ['zh', 'en']) {
  for (const [w, h] of VPS) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h } })
    const page = await ctx.newPage()
    await page.goto(`${UI}/?v=2&mode=live&look=paper&lang=${lang}`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(700)
    await page.keyboard.press('Escape').catch(() => {})
    await page.waitForTimeout(250)
    await page.evaluate(async (text) => {
      const enc = new TextEncoder()
      await window.__lite2Store.getState().uploadFiles([new File([enc.encode(text)], 'roster.md', { type: 'text/markdown' })])
    }, ROSTER)
    await page.waitForFunction(() => ['ready', 'error'].includes(window.__lite2Store.getState().ingestStatus),
      null, { timeout: 60000 }).catch(() => {})
    await page.evaluate(() => window.__lite2Store.getState().goScreen('room'))
    await page.waitForTimeout(700)
    const m = await page.evaluate(() => {
      const board = document.querySelector('.lite-room-board')
      const welcome = document.querySelector('[data-room-welcome]')
      const bar = document.querySelector('.prototype-topbar')
      if (!board || !welcome) return { err: 'no board/welcome' }
      const bs = getComputedStyle(board)
      const br = board.getBoundingClientRect()
      const wr = welcome.getBoundingClientRect()
      let band = 0
      for (const ch of bar.children) { const r = ch.getBoundingClientRect(); if (r.width > 0 && r.height > 0) band = Math.max(band, r.bottom) }
      const boxTop = br.top + parseFloat(bs.paddingTop)
      const boxBottom = br.bottom - parseFloat(bs.paddingBottom)
      return {
        band: Math.round(band),
        boxTop: Math.round(boxTop), boxBottom: Math.round(boxBottom),
        boxH: Math.round(boxBottom - boxTop), welcomeH: Math.round(wr.height),
        welcomeTop: Math.round(wr.top),
        // 溢出量：>0 说明开场块的顶被顶到内容盒上方（越界，可能钻进顶栏）
        overflowUp: Math.round(boxTop - wr.top),
        clearsBand: Math.round(wr.top - band),
      }
    })
    console.log(`${lang} ${String(w).padStart(4)}x${String(h).padStart(3)}  ` + JSON.stringify(m))
    await ctx.close()
  }
}
await browser.close()
