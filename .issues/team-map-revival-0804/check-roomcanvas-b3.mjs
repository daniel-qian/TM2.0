// team-map-revival-0804（#106 B3）· `assertRoomCanvas` 改判作用域的**死针探测**。
//
// ## 为什么要探
// 相位 H 那三条「画布必须绝迹」的选择器，此前是 `document` 全局查的。B3 把它们收窄到
// 对话屏容器 `.lite-room` 的子树。收窄判据最常见的坏法是**收到判不到任何东西**——
// 门从此永远绿，而没有一样东西会因此报警（memory:「改文案/常量前先跑死针探测」）。
//
// 所以这里问四个问题，缺一不可：
//   ① 正常态它是绿的吗（对照基准——不先证明这个，②的红读不出任何意思）
//   ② 往**对话屏里**塞一块画布，它红吗（收窄之后还有没有牙）
//   ③ 往**对话屏外**塞一块画布，它还绿吗（这正是收窄要买的东西）
//   ④ 同一状态下，**旧的全局写法**红吗（证明这次改判是有作用的，不是改着玩）
// ③④ 是一对：只有 ④ 红而 ③ 绿，才说明「作用域」这三个字真的落到了地上。
//
// 跑法（后端 + preview 起着，与跑门时同一套）：
//   VERIFY_BASE=http://127.0.0.1:5183 node .issues/team-map-revival-0804/check-roomcanvas-b3.mjs
import { chromium } from 'playwright'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const BASE = process.env.VERIFY_BASE || 'http://127.0.0.1:5183'
const HERE = dirname(fileURLToPath(import.meta.url))
const SEED_DIR = join(HERE, '..', '..', 'eval-harness', 'tests', 'fixtures', 'demo-seed')
const SNIPPET = readFileSync(
  fileURLToPath(new URL('../../scripts/gates/live-frontend-gate.snippet.js', import.meta.url)),
  'utf8',
)
const seedFiles = () =>
  readdirSync(SEED_DIR)
    .filter((n) => n.endsWith('.md'))
    .sort()
    .map((n) => ({ name: n, mimeType: 'text/markdown', buffer: readFileSync(join(SEED_DIR, n)) }))

let failed = 0
let passed = 0
function check(label, got, want) {
  if (JSON.stringify(got) === JSON.stringify(want)) {
    passed += 1
    console.log(`  ✓ ${label}`)
    return
  }
  failed += 1
  console.log(`  🔴 ${label}\n     got  ${JSON.stringify(got)}\n     want ${JSON.stringify(want)}`)
}

const browser = await chromium.launch()
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
await page.addInitScript(() => {
  try {
    window.localStorage.setItem('lite2:onboard:v1', JSON.stringify({ status: 'done', step: 0 }))
  } catch {}
})
await page.goto(`${BASE}/?v=2&mode=live&look=paper&lang=zh`, { waitUntil: 'networkidle' })
await page.waitForFunction(() => !!window.__lite2Store, null, { timeout: 20000 })
await page.evaluate(SNIPPET)

// 真上传 demo-seed：⑤ 要在 `/map` 上看画布，而空花名册的 /map 渲染的是空态引导卡、
// **没有画布**（PRD §3.6：不渲染空板）。手灌一份合成 team 试过，`goto` 之后 app 自己的
// 恢复流程会把它再写一遍——与其和它抢，不如给它一个真 context。
await page.evaluate(() => window.__lite2Store.getState().goScreen('files'))
await page.locator('input.upload-input').setInputFiles(seedFiles())
await page.locator('.upload-ready, .upload-error').first().waitFor({ timeout: 90000 })
check('⓪ 上传落地（后面 ⑤ 吃它）',
  (await page.locator('.upload-error').count()) === 0, true)

/** 只取 canvasGone 那一格：pass 还吃 scroll/board/composer，那几条不归本次改判管。 */
async function canvasGone() {
  return page.evaluate(async () => {
    const out = await window.__seedGate.assertRoomCanvas()
    return out.canvasGone
  })
}
/** 改判**之前**那句全局写法，原样重放一遍——用来证明这次收窄有没有作用。 */
const globalForm = () =>
  page.evaluate(() =>
    !document.querySelector('.lite-room-canvas') &&
    !document.querySelector('.lite-panzoom-wrapper') &&
    !document.querySelector('.react-transform-wrapper'))

// ── ① 对照基准 ──────────────────────────────────────────────────────────────
await page.evaluate(() => window.__lite2Store.getState().goScreen('room'))
await page.waitForTimeout(600)
check('① 对照基准：对话屏在场，正常态 canvasGone = true',
  await page.evaluate(() => !!document.querySelector('.lite-room')) && (await canvasGone()), true)

// ── ② 死针探测：往对话屏里塞一块画布 ─────────────────────────────────────────
await page.evaluate(() => {
  const el = document.createElement('div')
  el.className = 'react-transform-wrapper'
  el.id = 'born-red-inside'
  document.querySelector('.lite-room').appendChild(el)
})
check('② 🔴 对话屏**里**出现画布 → canvasGone = false（收窄之后仍然有牙）',
  await canvasGone(), false)
await page.evaluate(() => document.getElementById('born-red-inside')?.remove())
check('② 撤掉之后回绿（不是一红不回头）', await canvasGone(), true)

// ── ③④ 作用域这三个字有没有落地 ─────────────────────────────────────────────
await page.evaluate(() => {
  const el = document.createElement('div')
  el.className = 'react-transform-wrapper'
  el.id = 'born-red-outside'
  document.body.appendChild(el)
})
check('③ 对话屏**外**出现画布（`/map` 那一整页就是这个形状）→ 新判据仍然 true',
  await canvasGone(), true)
check('④ 同一状态下**旧的全局写法**是 false —— 这次改判确实有作用，不是改着玩',
  await globalForm(), false)
await page.evaluate(() => document.getElementById('born-red-outside')?.remove())

// ── ⑤ 顺手把「地图那一页确实是一整块 rzpp」钉住 ──────────────────────────────
// 不钉的话，③④ 那对判据讲的故事就只是我在 body 上插了个 div 而已。
await page.goto(`${BASE}/map?v=2&mode=live&look=paper&lang=zh`, { waitUntil: 'networkidle' })
await page.waitForFunction(() => !!window.__lite2Store, null, { timeout: 20000 })
// 空花名册的 /map 渲染的是空态引导卡、**没有画布**（PRD §3.6：不渲染空板）。
// 本段问的是「有板的时候那一页是不是一整块 rzpp」，所以先给它一块最小的板。
await page.locator('.lite-map-person').first().waitFor({ timeout: 20000 })
await page.waitForTimeout(400)
check('⑤ /map 上真有 .react-transform-wrapper（旧写法在这一页上就是会红的那个东西）',
  await page.evaluate(() => !!document.querySelector('.react-transform-wrapper')), true)
check('⑤ 而 /map 上没有对话屏 —— 今天全局写法还绿，靠的是这个巧合，不是判据',
  await page.evaluate(() => !!document.querySelector('.lite-room')), false)

await browser.close()
console.log(`\n${failed === 0 ? 'OK' : '🔴 FAILED'} — ${passed} passed, ${failed} failed`)
if (failed) process.exitCode = 1
