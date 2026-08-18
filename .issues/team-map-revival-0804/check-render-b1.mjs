// team-map-revival-0804 · B1 · 80 人合成租户**真渲染** + pan/reset 行为 + 空态。
//
// 跑法（仓库根）：
//   VITE_AVERY_API_BASE=http://127.0.0.1:8147 npx vite build --mode development
//   npx vite preview --port 5183 --host 127.0.0.1        # 另开一个
//   VERIFY_BASE=http://127.0.0.1:5183 node .issues/team-map-revival-0804/check-render-b1.mjs
// 不需要后端：fixture 在 Node 侧过真 derive 之后直接灌进 `__lite2Store`。
//
// ⚠ **这不是一道门**，名字里刻意没有 `verify-`——理由同 `check-layout-80.mjs` 的文件头：
// 往 `git ls-files "*verify-*.mjs"` 那个 glob 里塞不在 ROSTER 的文件，就是再造一批没人
// 裁定过的孤儿门。进 ROSTER 的 `verify-team-map.mjs` 是 **B3** 的活，本文件的判据届时并进去。
//
// 🔴 fixture 走的是**真 derive**（liteTeamFromPayload），不是手捏的 LiteTeam；
// 镜头/进度条/兜底词的期望值全部写在本文件里，一个都不问被测组件要。
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
import { Buffer } from 'node:buffer'
import esbuild from 'esbuild'
import { fileURLToPath } from 'node:url'

const BASE = process.env.VERIFY_BASE || 'http://127.0.0.1:5183'
const Q = '?v=2&mode=live&look=paper&lang=en'
const OUT = process.env.SHOT_DIR || 'shots'

const built = await esbuild.build({
  stdin: {
    contents: "export { liteTeamFromPayload } from './src/lite2/teamData'",
    resolveDir: fileURLToPath(new URL('../..', import.meta.url)),
    loader: 'ts',
    sourcefile: 'e.ts',
  },
  bundle: true, write: false, format: 'esm', platform: 'neutral', target: 'es2022',
  define: { 'import.meta.env': '__VITE_ENV_SHIM__' },
  banner: { js: 'const __VITE_ENV_SHIM__ = {};' },
})
const { liteTeamFromPayload } = await import(
  'data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text, 'utf8').toString('base64')
)
const team = liteTeamFromPayload(
  JSON.parse(readFileSync(new URL('./fixtures/team-80.json', import.meta.url), 'utf8')),
)

let failed = false
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await ctx.newPage()
// onboarding 闸门（首访自动掀开）会盖住整页并吃掉所有点击——它对 /map 与对别的屏一视同仁，
// 是对的行为；这里预置成「看过了」，好让本脚本量的是地图本身。
await page.addInitScript(() => {
  try {
    window.localStorage.setItem('lite2:onboard:v1', JSON.stringify({ status: 'done', step: 0 }))
  } catch {}
})
const errs = []
page.on('pageerror', (e) => errs.push(String(e)))
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()) })

// ── ① 空态：没有 team 时不渲染空板 ─────────────────────────────────────────
await page.goto(`${BASE}/map${Q}`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => !!window.__lite2Store, null, { timeout: 20000 })
// 有 context、但那份 context 里没有人也没有项目——首访者根本到不了 /map（onboarding 闸门
// 盖在上面，与别的屏一致），所以真正要看的空态是这一种。
await page.evaluate(() => window.__lite2Store.setState({ contextId: 'ctx_empty', team: null }))
await page.waitForSelector('.lite-map-empty', { timeout: 20000 })
const emptyStats = await page.evaluate(() => ({
  emptyCard: !!document.querySelector('.lite-map-empty .lite-team-empty-card'),
  canvas: document.querySelectorAll('.lite-map-canvas').length,
  cta: document.querySelector('.lite-team-empty-cta')?.getAttribute('href'),
  title: document.querySelector('.lite-team-empty-title')?.textContent,
}))
console.log('[empty]', JSON.stringify(emptyStats))
if (!emptyStats.emptyCard || emptyStats.canvas !== 0) { failed = true; console.log('  🔴 空态仍渲染了空板') }
if (!emptyStats.cta?.startsWith('/files')) { failed = true; console.log('  🔴 空态 CTA 没指向资料库') }
await page.screenshot({ path: `${OUT}/map-empty.png` })

// ── ② 80 人真渲染 ──────────────────────────────────────────────────────────
await page.evaluate((t) => window.__lite2Store.setState({ contextId: 'ctx_synth_80', team: t }), team)
await page.waitForSelector('.lite-map-person', { timeout: 20000 })
await page.waitForTimeout(700)

const big = await page.evaluate(() => {
  const content = document.querySelector('.lite-map-panzoom-content')
  const scaleOf = (el) => {
    const m = /scale\(([\d.]+)\)/.exec(el?.style.transform || '')
    return m ? Number(m[1]) : null
  }
  return {
    zones: document.querySelectorAll('.lite-map-zone').length,
    people: document.querySelectorAll('.lite-map-person').length,
    projects: document.querySelectorAll('.lite-map-project').length,
    // 缺 progress / 越界 progress 的两条必须没有条 → 24 条里只有 22 条带条。
    progressBars: document.querySelectorAll('.lite-map-progress-track').length,
    zeroWidthFills: [...document.querySelectorAll('.lite-map-progress-fill')]
      .filter((f) => f.style.width === '0%').length,
    unknownStatusCards: document.querySelectorAll('.lite-map-project.is-status-unknown').length,
    // 兜底词必须带着「负责人」标签一起出现，不许孤零零一句。
    ownerFallbackRows: [...document.querySelectorAll('.lite-map-project-owner')]
      .map((r) => r.textContent.trim())
      .filter((s) => s.includes('The documents did not say')),
    board: { w: content?.offsetWidth, h: content?.offsetHeight },
    scale: scaleOf(content),
    // 🔴 初始镜头判据。期望值**独立算**：画布实测宽度 × 规格常量（FIT_PADDING 0.94、
    // MIN_FIT 0.6、MAX_FIT 1.1），一个数都不问 MapPanZoom 要——尺子不许长在被量的东西上。
    // 这条不是补的：第一版镜头压根没生效（rzpp 用自己的 initialScale 盖掉了父组件的
    // layout effect），而当时**所有计数判据都是绿的**，只有截图上那一片空白露了馅。
    expectedScale: (() => {
      const canvasEl = document.querySelector('.lite-map-canvas')
      if (!canvasEl || !content) return null
      const raw = (canvasEl.clientWidth / content.offsetWidth) * 0.94
      return Math.round(Math.max(0.12, Math.min(1.1, Math.max(0.6, raw))) * 1000) / 1000
    })(),
    digitsInPeopleLayer: [...document.querySelectorAll('.lite-map-person')]
      .map((n) => n.textContent || '').filter((s) => /\d/.test(s)).length,
    docScrollX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    namedButUnlinkedShown: (document
      .querySelector('[data-project-id="p_owner_name_only"] .lite-map-project-owner')
      ?.textContent || '').includes('Ada Aldridge'),
  }
})
console.log('[80-person]', JSON.stringify(big, null, 2))
if (big.people !== 80 || big.zones !== 9 || big.projects !== 24) { failed = true; console.log('  🔴 节点数不对') }
if (big.progressBars !== 22) { failed = true; console.log(`  🔴 进度条数应为 22（缺席+越界各一条不画），实得 ${big.progressBars}`) }
if (big.zeroWidthFills !== 1) { failed = true; console.log(`  🔴 progress=0 必须画一条 0 宽的条（且只此一条），实得 ${big.zeroWidthFills}`) }
if (big.digitsInPeopleLayer !== 0) { failed = true; console.log('  🔴 人身数字破口') }
// 三条 owner 哨兵里只有两条真的「没读到是谁」：p_owner_name_only 有名字（只是没 id
// 挂不上部门），它必须照显名字而不是兜底词——兜底词只对「真的没读到」说。
if (big.ownerFallbackRows.length !== 2) { failed = true; console.log(`  🔴 owner 兜底行应为 2 条，实得 ${big.ownerFallbackRows.length}`) }
if (!big.namedButUnlinkedShown) { failed = true; console.log('  🔴 有名字没 id 的项目应照显名字，不该被兜底词顶掉') }
if (!big.ownerFallbackRows.every((s) => s.startsWith('Owner'))) { failed = true; console.log('  🔴 兜底词没带字段标签') }
if (big.docScrollX > 0) { failed = true; console.log('  🔴 页面横滚') }
if (big.scale === null || Math.abs(big.scale - big.expectedScale) > 0.01) {
  failed = true
  console.log(`  🔴 初始镜头不是 fit-width 可读帧：applied=${big.scale} expected=${big.expectedScale}`)
}
await page.screenshot({ path: `${OUT}/map-80.png` })

// ── ③ pan 后 transform 真位移；复位回到 fit 值 ────────────────────────────
const canvas = await page.locator('.lite-map-canvas').boundingBox()
const readT = () => page.evaluate(() => document.querySelector('.lite-map-panzoom-content')?.style.transform || '')
const before = await readT()
await page.mouse.move(canvas.x + canvas.width * 0.6, canvas.y + canvas.height * 0.6)
await page.mouse.down()
await page.mouse.move(canvas.x + canvas.width * 0.3, canvas.y + canvas.height * 0.35, { steps: 12 })
await page.mouse.up()
await page.waitForTimeout(300)
const after = await readT()
console.log('[pan]', { before, after })
if (before === after) { failed = true; console.log('  🔴 拖动之后 transform 没动') }

await page.click('.lite-map-reset')
await page.waitForTimeout(600)
const reset = await readT()
console.log('[reset]', { reset })
if (reset !== before) { failed = true; console.log('  🔴 复位没回到初始镜头') }

if (errs.length) { failed = true; console.log('ERRORS:', errs.slice(0, 6)) }
await browser.close()
console.log(failed ? '\nFAILED' : '\nOK')
process.exitCode = failed ? 1 : 0
