// 手拍取证：侧栏「有场」态 + composer 各交互态在 54 张像素基线里零覆盖，只能人眼过。
// 用法: node shot.mjs <outDir> [--turns]
import { chromium } from 'playwright'
import fs from 'node:fs'

const UI = process.env.VERIFY_BASE || 'http://127.0.0.1:5181'
const OUT = process.argv[2]
const WANT_TURNS = process.argv.includes('--turns')
fs.mkdirSync(OUT, { recursive: true })

const ROSTER = [
  '# 别墅酒店 员工花名册', '',
  '姓名 | 人员ID | 部门 | 职位 | 司龄',
  '周雅婷 | MKT-001 | 市场推广部 | 市场专员 | 3年',
  '林小满 | FO-0422 | 前厅部 | 前厅主管 | 2年',
].join('\n')
const PROJECT = ['# 别墅套餐推广', '负责人：周雅婷', '状态：受阻', '截止：2026-10-15',
  '进度：55%', '阻塞：雨季无备选场地'].join('\n')

const VIEWPORTS = [
  { name: 'desktop', width: 1280, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
]
const LOOKS = ['paper', 'aurora']

const browser = await chromium.launch()
for (const look of LOOKS) {
  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } })
    const page = await ctx.newPage()
    const errs = []
    page.on('pageerror', (e) => errs.push(String(e)))
    await page.goto(`${UI}/?v=2&mode=live&look=${look}&lang=zh`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(900)
    await page.keyboard.press('Escape').catch(() => {})
    await page.waitForTimeout(300)
    await page.evaluate(async ({ files }) => {
      const enc = new TextEncoder()
      await window.__lite2Store.getState().uploadFiles(
        files.map((f) => new File([enc.encode(f.text)], f.name, { type: 'text/markdown' })))
    }, { files: [{ name: '花名册.md', text: ROSTER }, { name: '项目周报.md', text: PROJECT }] })
    await page.waitForFunction(
      () => ['ready', 'error'].includes(window.__lite2Store.getState().ingestStatus),
      null, { timeout: 60000 }).catch(() => {})
    await page.evaluate(() => window.__lite2Store.getState().goScreen('room'))
    await page.waitForTimeout(1200)
    const tag = `${look}-${vp.name}`

    if (WANT_TURNS) {
      // 两问造出「有场」的侧栏 + 会话流
      for (const q of ['别墅套餐推广现在最需要我做什么', '那这周先动哪一头']) {
        await page.locator('.lite-room .nexus-followup-composer [data-composer-input]').click()
        await page.locator('.lite-room .nexus-followup-composer [data-composer-input]')
          .pressSequentially(q, { delay: 6 })
        await page.locator('.lite-room .nexus-followup-composer [data-composer-input]').press('Enter')
        await page.waitForFunction(() => {
          const t = window.__lite2Store.getState().turns
          const l = t[t.length - 1]
          return !!l && ['complete', 'error', 'interrupted'].includes(l.run.status)
        }, null, { timeout: 60000 }).catch(() => {})
      }
      await page.evaluate(() => window.__lite2Store.getState().goScreen('home'))
      await page.waitForTimeout(300)
      await page.evaluate(() => window.__lite2Store.getState().goScreen('room'))
      await page.waitForTimeout(1200)
      // 手机态：把抽屉打开再拍（桌面态那一句是无操作）
      const toggle = page.locator('[data-history-toggle]')
      if (await toggle.isVisible()) { await toggle.click(); await page.waitForTimeout(400) }
      await page.screenshot({ path: `${OUT}/${tag}-aside-threads.png`, fullPage: false })
      // 打开一场：回灌态 + 当前场高亮
      const row = page.locator('[data-history-thread]').first()
      if (await row.isVisible()) { await row.click(); await page.waitForTimeout(900) }
      if (await toggle.isVisible()) { await toggle.click(); await page.waitForTimeout(400) }
      await page.screenshot({ path: `${OUT}/${tag}-aside-current.png`, fullPage: false })
    } else {
      await page.screenshot({ path: `${OUT}/${tag}-empty.png`, fullPage: false })
      // composer 交互态：多行 + 附件行 + @ 弹层
      const input = page.locator('.lite-room .nexus-followup-composer [data-composer-input]')
      await input.click()
      // 🔴 换行用 Shift+Enter，别把 '\n' 交给 pressSequentially：那等于连按三次 Enter，
      //    拍到的是「发了三问」而不是「多行输入态」（第一版就是这么拍歪的）。
      const lines = ['这周谁最需要我搭把手', '第二行也想一起问', '第三行']
      for (let i = 0; i < lines.length; i++) {
        if (i > 0) await input.press('Shift+Enter')
        await input.pressSequentially(lines[i], { delay: 4 })
      }
      await page.waitForTimeout(300)
      await page.screenshot({ path: `${OUT}/${tag}-composer-multiline.png`, fullPage: false })
      await input.pressSequentially(' @周', { delay: 20 })
      await page.waitForTimeout(500)
      await page.screenshot({ path: `${OUT}/${tag}-composer-picker.png`, fullPage: false })
      await page.keyboard.press('Enter')
      await page.waitForTimeout(400)
      await page.screenshot({ path: `${OUT}/${tag}-composer-chip.png`, fullPage: false })
    }
    console.log(`[shot] ${tag} pageerrors=${errs.length} ${errs.slice(0, 2).join(' | ')}`)
    await ctx.close()
  }
}
await browser.close()
console.log('[shot] done ->', OUT)
