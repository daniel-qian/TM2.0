// #84 手拍取证：资料库两栏 explorer —— 桌面 1440×900 + 手机 390×844，两皮各一轮。
//
// 拍的是**真上传出来的满数据态**（demo-seed 九份中文语料），不是造出来的假载荷：这一屏
// 的病根全在「行的结构」上，而行的结构恰恰由真实文件名的长短决定（`files-mobile.png` 上
// 9 行 4 种高度 3 种内部顺序，就是名字长短决定折行位置）。喂假名字＝把病根喂没了。
//
// 时钟钉死：上传时间列印的是**墙上时钟换算出来的本地时刻**，不钉就是一张会腐烂的对照图。
//
// 用法: VERIFY_BASE=http://127.0.0.1:5284 node .issues/design-0810/_px84/shot.mjs <outDir>
import { chromium } from 'playwright'
import { readdirSync, readFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const UI = process.env.VERIFY_BASE || 'http://127.0.0.1:5284'
const OUT = process.argv[2]
if (!OUT) { console.error('用法: node shot.mjs <outDir>'); process.exit(2) }
mkdirSync(OUT, { recursive: true })

const HERE = dirname(fileURLToPath(import.meta.url))
const SEED_DIR = join(HERE, '..', '..', '..', 'eval-harness', 'tests', 'fixtures', 'demo-seed')
const NOW = '2026-08-10T14:20:00+08:00'

const seedFiles = () =>
  readdirSync(SEED_DIR).filter((n) => n.endsWith('.md')).sort()
    .map((n) => ({ name: n, mimeType: 'text/markdown', buffer: readFileSync(join(SEED_DIR, n)) }))

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
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
    await page.clock.setFixedTime(new Date(NOW))
    await page.goto(`${UI}/?v=2&mode=live&look=${look}&lang=zh`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(900)
    await page.keyboard.press('Escape').catch(() => {})
    await page.waitForTimeout(300)
    await page.evaluate(() => window.__lite2Store.getState().goScreen('files'))
    await page.waitForTimeout(400)
    const tag = `${look}-${vp.name}`

    // ① 空态（还没传过任何东西）——这一屏首访者看到的第一眼。
    await page.screenshot({ path: `${OUT}/${tag}-01-empty.png`, fullPage: false })

    // 真上传（走屏上那个 input，不是 store 搬运工：本票交付的就是这个入口）。
    await page.locator('input.upload-input').setInputFiles(seedFiles())
    await page.waitForTimeout(700)
    // ② 上传中——进度长在表格顶端那一行里。
    await page.screenshot({ path: `${OUT}/${tag}-02-ingesting.png`, fullPage: false })
    await page.locator('.upload-ready, .upload-error').first().waitFor({ timeout: 90000 })
    await page.waitForTimeout(800)

    // ③ 满数据态（本票的主战场）。
    const rows = await page.locator('.upload-file-row').count()
    await page.screenshot({ path: `${OUT}/${tag}-03-files.png`, fullPage: false })

    // 手机：抽屉开着拍一张（桌面 toggle 是 display:none，自动跳过）。
    const toggle = page.locator('[data-files-toggle]')
    let drawer = false
    if (await toggle.isVisible()) {
      await toggle.click(); await page.waitForTimeout(500)
      await page.screenshot({ path: `${OUT}/${tag}-04-drawer.png`, fullPage: false })
      drawer = true
    }

    // ④ 常驻表单分区。
    await page.locator('[data-files-zone="forms"]').click().catch(() => {})
    await page.waitForTimeout(900)
    await page.screenshot({ path: `${OUT}/${tag}-05-forms.png`, fullPage: false })

    // ⑤ 清空确认（销毁类硬确认）。手机上要先开抽屉才点得到那一行。
    if (await toggle.isVisible()) { await toggle.click(); await page.waitForTimeout(400) }
    await page.locator('[data-files-zone="empty"]').click().catch(() => {})
    await page.waitForTimeout(500)
    await page.screenshot({ path: `${OUT}/${tag}-06-empty-confirm.png`, fullPage: false })

    console.log(`[shot] ${tag} rows=${rows} drawer=${drawer} pageerrors=${errs.length} `
      + errs.slice(0, 2).join(' | '))
    await ctx.close()
  }
}
await browser.close()
console.log('[shot] done ->', OUT)
