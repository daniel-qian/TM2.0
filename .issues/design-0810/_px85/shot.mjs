// #85 手拍：真上传 + 真补传之后，把「资料更新」那一区拍下来（桌面 + 手机）。
// 🔴 门全绿 ≠ 真部件被验到 —— 改完布局必须截图人眼过一遍（本仓反复立过的碑）。
//   VERIFY_BASE=http://127.0.0.1:5285 node .issues/design-0810/_px85/shot.mjs <outDir>
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const UI = process.env.VERIFY_BASE || 'http://127.0.0.1:5285'
const OUT = process.argv[2] || '.issues/design-0810/_px85/after'
mkdirSync(OUT, { recursive: true })

const ROSTER = ['# 别墅酒店 员工花名册', '', '姓名 | 人员ID | 部门 | 职位 | 司龄',
  '周雅婷 | MKT-001 | 市场推广部 | 市场专员 | 3年'].join('\n')
const V1 = ['# 婚宴对接', '负责人：老周', '状态：进行中', '截止：2026-09-30'].join('\n')
const V2 = ['# 婚宴对接', '负责人：小马', '状态：受阻',
  '阻塞：雨季无备选场地，草坪主场地的排水改造要等工程部下个月进场，这期间所有户外婚宴都得排进多功能厅',
  '', '本次旺季排班协调会决定，由宴会部小马接手婚宴对接的现场排班。'].join('\n')
const SPRING = ['# 春节值班排布', '负责人：周雅婷', '状态：进行中', '截止：2027-02-20'].join('\n')
const ROSTER2 = ['# 别墅酒店 前厅部花名册', '', '姓名 | 人员ID | 部门 | 职位 | 司龄',
  '林小满 | FO-0422 | 前厅部 | 前厅主管 | 2年'].join('\n')

const browser = await chromium.launch()
for (const [tag, vp] of [['desktop', { width: 1440, height: 900 }], ['mobile', { width: 390, height: 844 }]]) {
  for (const look of ['paper', 'aurora']) {
    const ctx = await browser.newContext({ viewport: vp, reducedMotion: 'reduce', deviceScaleFactor: 1 })
    const page = await ctx.newPage()
    await page.goto(`${UI}/?v=2&mode=live&look=${look}&lang=zh`, { waitUntil: 'networkidle' })
    if (await page.locator('.lite-onboard').count()) {
      await page.keyboard.press('Escape'); await page.waitForTimeout(600)
    }
    const send = (files, fn) => page.evaluate(async ({ files, fn }) => {
      const enc = new TextEncoder()
      await window.__lite2Store.getState()[fn](
        files.map((f) => new File([enc.encode(f.text)], f.name, { type: 'text/markdown' })))
    }, { files, fn })
    await send([{ name: '员工花名册.md', text: ROSTER }, { name: '项目台账.md', text: V1 }], 'uploadFiles')
    await page.waitForFunction(() => ['ready', 'error'].includes(window.__lite2Store.getState().ingestStatus),
      null, { timeout: 60000 }).catch(() => {})
    await page.waitForTimeout(1200)
    await send([{ name: '旺季排班协调纪要.md', text: V2 }, { name: '春节值班排布.md', text: SPRING },
      { name: '前厅部花名册.md', text: ROSTER2 }], 'appendFiles')
    await page.waitForFunction(() => ['ready', 'error'].includes(window.__lite2Store.getState().appendStatus),
      null, { timeout: 60000 }).catch(() => {})
    await page.evaluate(() => window.__lite2Store.getState().goScreen('files'))
    await page.waitForTimeout(700)
    if (vp.width < 861) {
      await page.click('[data-files-toggle]').catch(() => {})
      await page.waitForTimeout(300)
    }
    await page.click('[data-files-zone="changes"]').catch(() => {})
    await page.waitForTimeout(700)
    await page.mouse.move(5, 5)
    await page.screenshot({ path: `${OUT}/changes-${look}-${tag}.png`, fullPage: vp.width < 861 })
    await ctx.close()
  }
}
await browser.close()
console.log('shots ->', OUT)
