#!/usr/bin/env node
// 顶栏两个开关（语言 中文/英文 · 观感 暖纸/极光）的判据门 —— open-loop-0720。
//
// 为什么单开一个门：现成的门（verify-p0.mjs 等）只断言 `?look=`/`?lang=` 这两个 URL 参数
// 本身生效（令牌层/字典解析出不同值），从没断言过"开关控件"这件事本身——存不存在、点不点得动、
// 记不记得住。这三件事恰好是本棒新增的东西，之前一条门都不知道它们的存在。
//
// 判据（kickoff 需求原文）：
//   ① 开关存在——.lang-switch / .look-switch 两组按钮都在 DOM 里；
//   ② 点击换 class——点了哪个，哪个就变 is-active，原来那个掉 is-active；且点击立即生效
//      （壳根 data-look / 顶栏文案跟着变，不必刷新）；
//   ③ localStorage 写入——点开关后 lite2:look:v1 / lite2:lang:v1 落盘为点的那个值；
//   ④ 记忆——不带参数刷新/裸链重进，保持上次点的选择（①②③ 合起来验证的正是"刷新就忘"
//      这个产品缺口被堵上了）；
//   ⑤ 深链参数赢——带 ?look=/?lang= 时，即便 localStorage 里存着别的选择，URL 显式给出的值
//      优先生效，且这次的值会同步写回 localStorage（下次不带参数仍保持这次深链的选择）。
//
// 怎么跑（与 verify-p0.mjs 同一套前置，但这个门不需要真上传/真后端——纯前端断言）：
//   1) 起前端：npx vite --port 5173 --strictPort（或 vite build + vite preview 也行——
//      皮肤/语言开关不依赖 DEV-only 测试缝，不像 verify-zh-purity.mjs/verify-null-owner.mjs
//      要读 window.__AVERY_LITE__ 那样必须是真 dev server）
//   2) node eval-harness/tools/verify-switchers.mjs
//   （VERIFY_BASE 环境变量可覆盖默认的 http://127.0.0.1:5173，换端口起服务时用它。）
import { chromium } from 'playwright'

const UI = process.env.VERIFY_BASE || 'http://127.0.0.1:5173'
const R = []
const rec = (n, ok, d) => {
  R.push({ n, ok })
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${n}${d ? ' — ' + d : ''}`)
}

const browser = await chromium.launch({ headless: true })

async function dismissOnboardIfAny(p) {
  if (await p.locator('.lite-onboard').count()) {
    await p.keyboard.press('Escape')
    await p.waitForTimeout(700)
  }
}

// ── ①②③ · 开关存在、点击换 class + 立即生效、localStorage 写入 ───────────────────
// 同一个 context 全程复用（下面的"记忆"判据要靠同一份 localStorage 接力），所以这一段
// 和下面两段共用一个 ctx/page，不在中途 newContext()。
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
const page = await ctx.newPage()
const pageErrors = []
page.on('pageerror', (e) => pageErrors.push(e.message))

console.log('\n═══ ① 开关存在 + ② 点击换 class（立即生效）+ ③ 写 localStorage ═══')

// 裸链进 v02，不带 ?look=/?lang=——全新 context 没有 localStorage，落地值应当是默认
// （暖纸 paper + 中文 zh，见 look.ts/index.ts 的默认值）。
await page.goto(`${UI}/?v=2&mode=live&lang=zh`, { waitUntil: 'networkidle' })
await dismissOnboardIfAny(page)

rec('语言开关存在（.lang-switch 两个按钮）', (await page.locator('.lang-switch-btn').count()) === 2)
rec('观感开关存在（.look-switch 两个按钮）', (await page.locator('.look-switch-btn').count()) === 2)

const initial = await page.evaluate(() => ({
  lookActiveText: document.querySelector('.look-switch-btn.is-active')?.textContent ?? null,
  langActiveText: document.querySelector('.lang-switch-btn.is-active')?.textContent ?? null,
  shellLook: document.querySelector('.lite2-shell')?.getAttribute('data-look') ?? null,
}))
rec(
  '默认态：暖纸是 active（新 context 没有 localStorage，回落默认值）',
  initial.lookActiveText === '暖纸' && initial.shellLook === 'paper',
  JSON.stringify(initial),
)
rec('默认态：中文是 active（?lang=zh 显式给了）', initial.langActiveText === '中文', JSON.stringify(initial))

// 点「极光」——class 应当换到第二个按钮，壳根 data-look 立即跟着变（不刷新），且写 localStorage。
await page.locator('.look-switch-btn').nth(1).click()
await page.waitForTimeout(200)
const afterLook = await page.evaluate(() => ({
  activeText: document.querySelector('.look-switch-btn.is-active')?.textContent ?? null,
  firstBtnStillActive: document.querySelectorAll('.look-switch-btn')[0]?.classList.contains('is-active') ?? null,
  shellLook: document.querySelector('.lite2-shell')?.getAttribute('data-look') ?? null,
  storage: localStorage.getItem('lite2:look:v1'),
}))
rec('点击换 class：极光按钮变 is-active', afterLook.activeText === '极光', JSON.stringify(afterLook))
rec('点击换 class：暖纸按钮掉 is-active（互斥，不是叠加）', afterLook.firstBtnStillActive === false)
rec('点击立即生效：壳根 data-look 跟着变（不必刷新）', afterLook.shellLook === 'aurora')
rec('点击写 localStorage（lite2:look:v1 = aurora）', afterLook.storage === 'aurora', `实得 "${afterLook.storage}"`)

// 语言开关同理：点「英文」——tab 文案应当立即跟着变（useDict 反应式订阅，见 localeStore.ts）。
await page.locator('.lang-switch-btn').nth(1).click()
await page.waitForTimeout(200)
const afterLang = await page.evaluate(() => ({
  activeText: document.querySelector('.lang-switch-btn.is-active')?.textContent ?? null,
  firstBtnStillActive: document.querySelectorAll('.lang-switch-btn')[0]?.classList.contains('is-active') ?? null,
  storage: localStorage.getItem('lite2:lang:v1'),
  homeTabText: document.querySelector('.scene-tab')?.textContent ?? null,
}))
rec('语言开关点击换 class：英文按钮变 is-active', afterLang.activeText === 'English', JSON.stringify(afterLang))
rec('语言开关点击换 class：中文按钮掉 is-active（互斥）', afterLang.firstBtnStillActive === false)
rec('语言开关点击写 localStorage（lite2:lang:v1 = en）', afterLang.storage === 'en', `实得 "${afterLang.storage}"`)
rec(
  '点击立即生效：顶栏 tab 文案跟着变英文（不必刷新——useDict 反应式订阅 localeStore）',
  afterLang.homeTabText === 'Today',
  `实得 "${afterLang.homeTabText}"`,
)

// ── ④ 记忆：不带参数刷新，应当保持上一步选的 aurora / en ────────────────────────────
console.log('\n═══ ④ 记忆：不带参数刷新，保持上次选择 ═══')
await page.goto(`${UI}/?v=2&mode=live`, { waitUntil: 'networkidle' })
await dismissOnboardIfAny(page)
const remembered = await page.evaluate(() => ({
  shellLook: document.querySelector('.lite2-shell')?.getAttribute('data-look') ?? null,
  homeTabText: document.querySelector('.scene-tab')?.textContent ?? null,
  lookStorage: localStorage.getItem('lite2:look:v1'),
  langStorage: localStorage.getItem('lite2:lang:v1'),
}))
rec(
  '裸链重进（无 ?look=/?lang=）：观感仍是上次选的极光（localStorage 记住了）',
  remembered.shellLook === 'aurora',
  JSON.stringify(remembered),
)
rec(
  '裸链重进：语言仍是上次选的英文（localStorage 记住了）',
  remembered.homeTabText === 'Today',
  `tab 文案 "${remembered.homeTabText}"`,
)

// ── ⑤ 深链参数赢：localStorage 里存着 aurora/en，但这次 URL 显式给 paper/zh ──────────
console.log('\n═══ ⑤ 深链参数赢（URL > localStorage），且同步回 localStorage ═══')
await page.goto(`${UI}/?v=2&mode=live&look=paper&lang=zh`, { waitUntil: 'networkidle' })
await dismissOnboardIfAny(page)
const urlWins = await page.evaluate(() => ({
  shellLook: document.querySelector('.lite2-shell')?.getAttribute('data-look') ?? null,
  homeTabText: document.querySelector('.scene-tab')?.textContent ?? null,
  lookStorage: localStorage.getItem('lite2:look:v1'),
  langStorage: localStorage.getItem('lite2:lang:v1'),
}))
rec(
  '?look=paper 赢过 localStorage 里的 aurora',
  urlWins.shellLook === 'paper',
  JSON.stringify(urlWins),
)
rec('?lang=zh 赢过 localStorage 里的 en', urlWins.homeTabText === '今天', `tab 文案 "${urlWins.homeTabText}"`)
rec(
  '深链参数同步回 localStorage（下次不带参数仍保持这次深链的选择）',
  urlWins.lookStorage === 'paper' && urlWins.langStorage === 'zh',
  JSON.stringify(urlWins),
)

// 再验一次同步是否真的持续（不带参数刷新，应保持 paper/zh，而不是弹回 aurora/en）
await page.goto(`${UI}/?v=2&mode=live`, { waitUntil: 'networkidle' })
await dismissOnboardIfAny(page)
const afterSync = await page.evaluate(() => ({
  shellLook: document.querySelector('.lite2-shell')?.getAttribute('data-look') ?? null,
  homeTabText: document.querySelector('.scene-tab')?.textContent ?? null,
}))
rec(
  '深链同步生效：裸链再进一次，保持的是深链那次的 paper（不是弹回 aurora）',
  afterSync.shellLook === 'paper',
  JSON.stringify(afterSync),
)
rec(
  '深链同步生效：裸链再进一次，保持的是深链那次的中文（不是弹回英文）',
  afterSync.homeTabText === '今天',
  `tab 文案 "${afterSync.homeTabText}"`,
)

rec('全程无 pageerror', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | ') || '0 条')

await ctx.close()
await browser.close()

const fail = R.filter((r) => !r.ok).length
console.log(`\n═══ 开关判据：${R.length - fail} PASS · ${fail} FAIL ═══`)
if (fail) {
  console.log('\n失败项：')
  for (const r of R.filter((x) => !x.ok)) console.log(`  ✗ ${r.n}`)
}
process.exit(fail ? 1 : 0)
