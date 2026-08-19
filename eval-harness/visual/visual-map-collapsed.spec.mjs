// #107 B4 · 部门收拢态的像素基线 —— 2 态 × 2 皮 × 2 视口 = 8 张。
//
// ## 为什么单独一个 spec
// 收拢态的门槛是 **40 人**，而同目录 `visual-map.spec.mjs` 拍的是真上传 demo-seed 的
// 16 人语料——那份语料**永远进不了**收拢态。要在同一个 spec 里兼顾两种形态，就得在中途
// 换一次团队，而「一个 test 串多张、首处不匹配即中止」的老毛病会让两种形态互相殃及
//（#68 与 #79 各栽过一次，两份 spec 的头注释都记着）。分文件，一处红最多废一态。
//
// ## 数据从哪来：**不上传**，直接灌
// 80 人的语料没有对应的 md 种子，真上传造不出来。B1 那份合成 fixture 在 Node 侧过
// **真 derive**（`liteTeamFromPayload`）之后灌进 `__lite2Store`——与
// `.issues/team-map-revival-0804/check-render-b1.mjs` 同一条路子。
// 好处不止省事：这一套**不依赖后端**，也不造 context，跑得起来的条件比别的数据态 spec 少。
//
// ⚠ fixture 自带 `scoring_enabled: false`（B1/B2 拿它当「开关关」那一世界）。收拢卡上的
// 组级读数只在开着的世界才有，所以这里显式翻成 true 再 derive——不翻的话冻下来的是一批
// **少一行字**的卡，而那一行正是收拢态的主角之一。
//
// ⚠ 逐视口都拍：B4 做的时候，开局镜头在桌面上看着挺好、手机上整个塌掉（火情区横跨三列，
// 390 竖屏要缩到 0.28 倍，九张卡成一排指甲盖）。桌面绿≠手机绿，这一屏尤其。
import { test, expect } from 'playwright/test'
import esbuild from 'esbuild'
import { readFileSync } from 'node:fs'
import { Buffer } from 'node:buffer'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const UI = process.env.VERIFY_BASE || 'http://localhost:5173'
const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..', '..')
const FIXTURE = join(ROOT, '.issues', 'team-map-revival-0804', 'fixtures', 'team-80.json')
const LOOKS = ['aurora', 'paper']

const built = await esbuild.build({
  stdin: {
    contents: "export { liteTeamFromPayload } from './src/lite2/teamData'",
    resolveDir: ROOT,
    loader: 'ts',
    sourcefile: 'visual-map-collapsed-entry.ts',
  },
  bundle: true, write: false, format: 'esm', platform: 'neutral', target: 'es2022',
  define: { 'import.meta.env': '__VITE_ENV_SHIM__' },
  banner: { js: 'const __VITE_ENV_SHIM__ = {};' },
})
const { liteTeamFromPayload } = await import(
  'data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text, 'utf8').toString('base64')
)
const TEAM = liteTeamFromPayload({ ...JSON.parse(readFileSync(FIXTURE, 'utf8')), scoring_enabled: true })

for (const look of LOOKS) {
  test(`${look} 部门收拢态基线`, async ({ page }, testInfo) => {
    // 地图自己的文案不读挂钟，但灌进去的是一份带日期的语料，钉住成本为零、不钉的成本是
    // 哪天无声腐烂（visual-data 那两张 home 就是这么漂的）。
    await page.clock.setFixedTime(new Date('2026-08-08T12:00:00+08:00'))
    // 🔴 onboarding 闸门（首访自动掀开）会盖住整页并**吃掉所有点击**——它对 /map 与对别的屏
    // 一视同仁，是对的行为。别的 spec 靠进屏之后按 Escape 掀掉它；这份直接进 /map，
    // 那条路上没有掀的时机，所以预置成「看过了」。不预置的症状很有迷惑性：第一张图照拍
    // （闸门是半透明的，图上看得见板），第二步点部门卡时才以
    // 「.lite-modal-backdrop intercepts pointer events」超时——像是收拢卡不可点，其实不是。
    await page.addInitScript(() => {
      try {
        window.localStorage.setItem('lite2:onboard:v1', JSON.stringify({ status: 'done', step: 0 }))
      } catch {}
    })
    await page.goto(`${UI}/map?v=2&mode=live&look=${look}&lang=zh`, { waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => !!window.__lite2Store, null, { timeout: 20000 })
    await page.evaluate((t) => window.__lite2Store.setState({ contextId: 'ctx_b4_80', team: t }), TEAM)
    await page.waitForSelector('.lite-map-zone', { timeout: 20000 })
    await page.evaluate(() => document.fonts.ready)

    // ── ① 收拢 calm ───────────────────────────────────────────────────────
    // 🔴 三条自证。少了它们，一张「看着还像地图」但把 B4 整层悄悄拍没了的图会照样冻进去。
    await expect(page.locator('.lite-map-zone.is-collapsed').first(), '收拢态必须真的收拢').toBeVisible()
    await expect(page.locator('.lite-map-person'), '收拢态不许铺人位').toHaveCount(0)
    await expect(page.locator('.lite-map-zone-alert').first(), '警报角标必须在画面里').toBeVisible()
    await page.waitForTimeout(600)
    await expect(page).toHaveScreenshot(`${look}-map-collapsed-${testInfo.project.name}.png`, {
      animations: 'disabled', caret: 'hide', scale: 'css', maxDiffPixels: 50,
    })

    // ── ② 原位展开 ────────────────────────────────────────────────────────
    // 点的是**有火情的那一个**：它是这一态的主角，也是开局镜头框住的那一撮。
    const hot = page.locator('button.lite-map-zone').filter({ has: page.locator('.lite-map-zone-alert') }).first()
    await hot.click()
    await expect(page.locator('.lite-map-person').first(), '展开之后必须真的铺出人位').toBeVisible()
    await page.evaluate(() => document.fonts.ready)
    await page.waitForTimeout(700)
    await expect(page).toHaveScreenshot(`${look}-map-expanded-${testInfo.project.name}.png`, {
      animations: 'disabled', caret: 'hide', scale: 'css', maxDiffPixels: 50,
    })
  })
}
