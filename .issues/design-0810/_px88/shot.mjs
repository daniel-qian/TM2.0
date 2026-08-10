// #88 手拍：撤掉「新建一家公司」之后，资料库左栏在**两种态**下各长什么样。
// 🔴 门全绿 ≠ 真部件被验到 —— 改完布局必须截图人眼过一遍（本仓反复立过的碑）。
//   VERIFY_BASE=http://127.0.0.1:5288 node .issues/design-0810/_px88/shot.mjs <outDir>
//
// 为什么两种态都要拍：本票把栏底那一组改成了**条件渲染**（组里只剩「清空这份档案」，
// 而它要有档案才在）。于是「空态」与「有档案」是两张结构不同的栏——
//   · 空态：只有「当前资料」一行（+ 常驻表单，如果通道支持），栏底整组不在；
//   · 有档案：多一条分隔的次级组「更多 / 清空这份档案…」。
// 像素基线只盖得到空态那一张（visual-data.spec 的 SCREENS 不含 files），所以有档案那张
// 只有这里和 verify-files-explorer A③' 看得见——更得人眼过。
import { chromium } from 'playwright'
import { mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const UI = process.env.VERIFY_BASE || 'http://127.0.0.1:5288'
const OUT = process.argv[2] || '.issues/design-0810/_px88/after'
const SEED_DIR = 'eval-harness/tests/fixtures/demo-seed'
mkdirSync(OUT, { recursive: true })

const seedFiles = () =>
  readdirSync(SEED_DIR).filter((n) => n.endsWith('.md')).sort()
    .map((n) => ({ name: n, mimeType: 'text/markdown', buffer: readFileSync(join(SEED_DIR, n)) }))

const browser = await chromium.launch()
for (const [tag, vp] of [['desktop', { width: 1440, height: 900 }], ['mobile', { width: 390, height: 844 }]]) {
  for (const look of ['paper', 'aurora']) {
    const ctx = await browser.newContext({ viewport: vp, reducedMotion: 'reduce', deviceScaleFactor: 1 })
    const page = await ctx.newPage()
    await page.goto(`${UI}/?v=2&mode=live&look=${look}&lang=zh`, { waitUntil: 'networkidle' })
    if (await page.locator('.lite-onboard').count()) {
      await page.keyboard.press('Escape'); await page.waitForTimeout(600)
    }
    await page.evaluate(() => window.__lite2Store.getState().goScreen('files'))
    await page.waitForTimeout(500)
    // 手机态：栏是抽屉，得先拉开才拍得到（桌面那根本来就在）。
    const openRail = async () => {
      if (tag !== 'mobile') return
      await page.locator('[data-files-toggle]').click().catch(() => {})
      await page.waitForTimeout(400)
    }

    await openRail()
    await page.screenshot({ path: `${OUT}/empty-${look}-${tag}.png` })

    // 真上传（走屏上那个入口），进「有档案」态。
    // 🔴 手机态先把抽屉收回去再传：抽屉开着时遮罩盖住工作台，`setInputFiles` 塞得进去但
    //    随后那次 `openRail()` 点在遮罩上、抽屉反而合上——拍出来的「有档案」那张就没有栏，
    //    而栏底那一组正是本票要人眼过的东西（第一轮实收：四张 data-* 全没拍到栏）。
    // ⚠ 用 toggle 收，**不要**点遮罩：遮罩那一下会被抽屉的关闭动画吃掉，随后的 openRail()
    //   于是点在一个还没收完的遮罩上、把刚开的抽屉又合回去——四张 data-* 全拍成没有栏
    //   （第一轮实收，`.lite-files-rail.is-open` 计数为 0）。
    const closeRail = async () => {
      if (tag !== 'mobile') return
      if (await page.locator('.lite-files-rail.is-open').count()) {
        await page.locator('[data-files-toggle]').click().catch(() => {})
        await page.waitForTimeout(500)
      }
    }
    await closeRail()
    await page.locator('input.upload-input').first().setInputFiles(seedFiles())
    await page.locator('.upload-ready, .upload-error').first().waitFor({ timeout: 90000 })
    await page.waitForTimeout(900)
    await openRail()
    // 自证：手机态这一张必须真的拍到栏（拍不到就等于这一轮没人眼过栏底那一组）。
    if (tag === 'mobile' && !(await page.locator('.lite-files-rail.is-open').count())) {
      throw new Error('抽屉没开，data-* 那张拍不到左栏 —— 别把这一轮当成人眼过了')
    }
    await page.screenshot({ path: `${OUT}/data-${look}-${tag}.png` })

    // 硬确认那张（销毁类动作的落点，本票之后它是纠错的唯一出口）。
    await page.locator('[data-files-zone="empty"]').click({ timeout: 5000 }).catch(() => {})
    await page.waitForTimeout(500)
    await page.screenshot({ path: `${OUT}/confirm-${look}-${tag}.png` })

    await ctx.close()
  }
}
await browser.close()
console.log('shots →', OUT)
