#!/usr/bin/env node
// 设置菜单里的两个开关（语言 中文/英文 · 观感 暖纸/极光）的判据门 —— open-loop-0720 立门，
// 0721 对齐棒改版：Danny 拍板 7B——①切换器从顶栏常驻收进次级设置菜单（.lite-settings-toggle
// 齿轮开合，收起时按钮**不在 DOM 里**——这是新判据，不是破坏）；②默认观感 paper→aurora
// （command-room 对齐，aurora 是指挥室观感基底）。本门的默认态/方向断言全部随之翻转：
// 现在验证「默认极光 → 点暖纸 → 记住暖纸 → 深链 aurora 赢回来」。
//
// 判据（open-loop-0720 kickoff 需求 + 0721 增补）：
//   ⓪ 次级菜单：收起时 .lang-switch/.look-switch 不在 DOM；点齿轮展开后两组按钮齐；
//   ① 开关存在——展开后 .lang-switch / .look-switch 两组按钮都在；
//   ② 点击换 class——点了哪个哪个 is-active，原来那个掉；且点击立即生效（壳根 data-look /
//      顶栏文案跟着变，不必刷新）；
//   ③ localStorage 写入——点开关后 lite2:look:v1 / lite2:lang:v1 落盘；
//   ④ 记忆——裸链重进保持上次选择；
//   ⑤ 深链参数赢——?look=/?lang= 显式值 > localStorage，且同步写回。
//
// 怎么跑（同 verify-p0 前置；纯前端断言，不需要真后端）：
//   1) 起前端（vite build + vite preview 或 dev server）
//   2) node eval-harness/tools/verify-switchers.mjs
//   （VERIFY_BASE 可覆盖默认 http://127.0.0.1:5173。）
// 迁自票 #16：boot/上报/收尾管线搬进 lib/gate-run.mjs，断言判据一字未改。
// 本门是分歧③的 700ms 分支（多数门 600），所以 onboardWait 显式传 700——不吃默认值；
// 也是分歧⑦ `listFailures` 选项第一个真实使用者（"失败项"逐条列名那段就是从这儿抽走的）。
import { bootPage, dismissOnboard, makeRec, finish } from './lib/gate-run.mjs'

const UI = process.env.VERIFY_BASE || 'http://127.0.0.1:5173'
const gateRec = makeRec()
const rec = gateRec.rec

const dismissOnboardIfAny = (p) => dismissOnboard(p, { onboardWait: 700 })

// 每次 goto 后 DOM 重置、菜单回到收起——要碰开关按钮前都得先开一次。
async function openSettings(p) {
  await p.locator('.lite-settings-toggle').click()
  await p.waitForTimeout(120)
}

// ── ⓪①②③ · 次级菜单开合、开关存在、点击换 class + 立即生效、localStorage 写入 ──────
// 同一个 context 全程复用（"记忆"判据靠同一份 localStorage 接力）。
// bootPage 不传 path/url：只开 browser+context+page，goto 时序留给下面自己控制——
// 那个 `═══ ⓪ ...` 抬头必须印在首次导航**之前**（迁移前的输出顺序就是这样）。
const { browser, context: ctx, page, pageErrors } = await bootPage({ trackPageErrors: true })

console.log('\n═══ ⓪ 次级菜单 + ① 开关存在 + ② 点击换 class + ③ 写 localStorage ═══')

// 裸链进 v02，不带 ?look=——全新 context 没有 localStorage，落地值应当是默认 aurora。
await page.goto(`${UI}/?v=2&mode=live&lang=zh`, { waitUntil: 'networkidle' })
await dismissOnboardIfAny(page)

rec('设置齿轮存在（.lite-settings-toggle）', (await page.locator('.lite-settings-toggle').count()) === 1)
rec(
  '收起态：切换器不在 DOM（次级菜单是真收起，不是 display:none 的假收起）',
  (await page.locator('.look-switch-btn').count()) === 0 &&
    (await page.locator('.lang-switch-btn').count()) === 0,
)

const initialShell = await page.evaluate(() => ({
  shellLook: document.querySelector('.lite2-shell')?.getAttribute('data-look') ?? null,
}))
rec(
  '默认态：壳根 data-look=aurora（新 context 没有 localStorage，回落 0721 新默认）',
  initialShell.shellLook === 'aurora',
  JSON.stringify(initialShell),
)

await openSettings(page)
rec('展开后语言开关存在（.lang-switch 两个按钮）', (await page.locator('.lang-switch-btn').count()) === 2)
rec('展开后观感开关存在（.look-switch 两个按钮）', (await page.locator('.look-switch-btn').count()) === 2)

const initial = await page.evaluate(() => ({
  lookActiveText: document.querySelector('.look-switch-btn.is-active')?.textContent ?? null,
  langActiveText: document.querySelector('.lang-switch-btn.is-active')?.textContent ?? null,
}))
rec('默认态：极光是 active', initial.lookActiveText === '极光', JSON.stringify(initial))
rec('默认态：中文是 active（?lang=zh 显式给了）', initial.langActiveText === '中文', JSON.stringify(initial))

// 点「暖纸」（nth(0)）——class 换到第一个按钮，壳根 data-look 立即变 paper，写 localStorage。
await page.locator('.look-switch-btn').nth(0).click()
await page.waitForTimeout(200)
const afterLook = await page.evaluate(() => ({
  activeText: document.querySelector('.look-switch-btn.is-active')?.textContent ?? null,
  secondBtnStillActive: document.querySelectorAll('.look-switch-btn')[1]?.classList.contains('is-active') ?? null,
  shellLook: document.querySelector('.lite2-shell')?.getAttribute('data-look') ?? null,
  storage: localStorage.getItem('lite2:look:v1'),
}))
rec('点击换 class：暖纸按钮变 is-active', afterLook.activeText === '暖纸', JSON.stringify(afterLook))
rec('点击换 class：极光按钮掉 is-active（互斥，不是叠加）', afterLook.secondBtnStillActive === false)
rec('点击立即生效：壳根 data-look 跟着变 paper（不必刷新）', afterLook.shellLook === 'paper')
rec('点击写 localStorage（lite2:look:v1 = paper）', afterLook.storage === 'paper', `实得 "${afterLook.storage}"`)

// 语言开关同理：点「英文」——tab 文案立即跟着变（useDict 反应式订阅 localeStore）。
await page.locator('.lang-switch-btn').nth(1).click()
await page.waitForTimeout(200)
const afterLang = await page.evaluate(() => ({
  activeText: document.querySelector('.lang-switch-btn.is-active')?.textContent ?? null,
  firstBtnStillActive: document.querySelectorAll('.lang-switch-btn')[0]?.classList.contains('is-active') ?? null,
  storage: localStorage.getItem('lite2:lang:v1'),
  homeTabText: (document.querySelector('.scene-tab')?.querySelector('.scene-tab-main') ?? document.querySelector('.scene-tab'))?.textContent ?? null,
}))
rec('语言开关点击换 class：英文按钮变 is-active', afterLang.activeText === 'English', JSON.stringify(afterLang))
rec('语言开关点击换 class：中文按钮掉 is-active（互斥）', afterLang.firstBtnStillActive === false)
rec('语言开关点击写 localStorage（lite2:lang:v1 = en）', afterLang.storage === 'en', `实得 "${afterLang.storage}"`)
rec(
  '点击立即生效：顶栏 tab 文案跟着变英文（不必刷新——useDict 反应式订阅 localeStore）',
  afterLang.homeTabText === 'Today',
  `实得 "${afterLang.homeTabText}"`,
)

// ── ④ 记忆：不带参数刷新，应当保持上一步选的 paper / en ────────────────────────────
console.log('\n═══ ④ 记忆：不带参数刷新，保持上次选择 ═══')
await page.goto(`${UI}/?v=2&mode=live`, { waitUntil: 'networkidle' })
await dismissOnboardIfAny(page)
const remembered = await page.evaluate(() => ({
  shellLook: document.querySelector('.lite2-shell')?.getAttribute('data-look') ?? null,
  homeTabText: (document.querySelector('.scene-tab')?.querySelector('.scene-tab-main') ?? document.querySelector('.scene-tab'))?.textContent ?? null,
  lookStorage: localStorage.getItem('lite2:look:v1'),
  langStorage: localStorage.getItem('lite2:lang:v1'),
}))
rec(
  '裸链重进（无 ?look=/?lang=）：观感仍是上次选的暖纸（localStorage 记住了，没弹回新默认 aurora）',
  remembered.shellLook === 'paper',
  JSON.stringify(remembered),
)
rec(
  '裸链重进：语言仍是上次选的英文（localStorage 记住了）',
  remembered.homeTabText === 'Today',
  `tab 文案 "${remembered.homeTabText}"`,
)

// ── ⑤ 深链参数赢：localStorage 里存着 paper/en，但这次 URL 显式给 aurora/zh ──────────
console.log('\n═══ ⑤ 深链参数赢（URL > localStorage），且同步回 localStorage ═══')
await page.goto(`${UI}/?v=2&mode=live&look=aurora&lang=zh`, { waitUntil: 'networkidle' })
await dismissOnboardIfAny(page)
const urlWins = await page.evaluate(() => ({
  shellLook: document.querySelector('.lite2-shell')?.getAttribute('data-look') ?? null,
  homeTabText: (document.querySelector('.scene-tab')?.querySelector('.scene-tab-main') ?? document.querySelector('.scene-tab'))?.textContent ?? null,
  lookStorage: localStorage.getItem('lite2:look:v1'),
  langStorage: localStorage.getItem('lite2:lang:v1'),
}))
rec(
  '?look=aurora 赢过 localStorage 里的 paper',
  urlWins.shellLook === 'aurora',
  JSON.stringify(urlWins),
)
rec('?lang=zh 赢过 localStorage 里的 en', urlWins.homeTabText === '今天', `tab 文案 "${urlWins.homeTabText}"`)
rec(
  '深链参数同步回 localStorage（下次不带参数仍保持这次深链的选择）',
  urlWins.lookStorage === 'aurora' && urlWins.langStorage === 'zh',
  JSON.stringify(urlWins),
)

// 再验一次同步是否真的持续（不带参数刷新，应保持 aurora/zh，而不是弹回 paper/en）
await page.goto(`${UI}/?v=2&mode=live`, { waitUntil: 'networkidle' })
await dismissOnboardIfAny(page)
const afterSync = await page.evaluate(() => ({
  shellLook: document.querySelector('.lite2-shell')?.getAttribute('data-look') ?? null,
  homeTabText: (document.querySelector('.scene-tab')?.querySelector('.scene-tab-main') ?? document.querySelector('.scene-tab'))?.textContent ?? null,
}))
rec(
  '深链同步生效：裸链再进一次，保持的是深链那次的 aurora（不是弹回 paper）',
  afterSync.shellLook === 'aurora',
  JSON.stringify(afterSync),
)
rec(
  '深链同步生效：裸链再进一次，保持的是深链那次的中文（不是弹回英文）',
  afterSync.homeTabText === '今天',
  `tab 文案 "${afterSync.homeTabText}"`,
)

// ── ⑥ 重新开始：全清含语言/观感回出厂（rich-align-0722/09 拍板①）─────────────────────────
// 非重启世界的 ④ 记忆契约不变（上面 ④/⑤ 已验：裸链刷新记住偏好、深链同步）；本世界考的是
// 「重新开始」这一动作会把偏好也一并清回出厂——与 ④ 的「记住」正交，两者同一份 localStorage 不冲突。
console.log('\n═══ ⑥ 重新开始：全清含语言/观感回出厂 ═══')
await page.goto(`${UI}/?v=2&mode=live`, { waitUntil: 'networkidle' })
await dismissOnboardIfAny(page)
// 先造一个"用户改过偏好"的态：切到 paper + en，确认 localStorage 落值。
await page.locator('.lite-settings-toggle').click()
await page.waitForTimeout(150)
await page.locator('.look-switch-btn').nth(0).click() // 暖纸 paper
await page.waitForTimeout(120)
await page.locator('.lang-switch-btn').nth(1).click() // 英文 en
await page.waitForTimeout(120)
const beforeRestart = await page.evaluate(() => ({
  look: localStorage.getItem('lite2:look:v1'),
  lang: localStorage.getItem('lite2:lang:v1'),
}))
rec('⑥ restart 前：偏好落值 paper/en', beforeRestart.look === 'paper' && beforeRestart.lang === 'en', JSON.stringify(beforeRestart))
// 两击「重新开始」（误触保护：首击进确认态，再击执行）。
await page.click('.lite-settings-restart')
await page.waitForTimeout(180)
await page.click('.lite-settings-restart')
await page.waitForTimeout(500)
const afterRestart = await page.evaluate(() => ({
  look: localStorage.getItem('lite2:look:v1'),
  lang: localStorage.getItem('lite2:lang:v1'),
  ctxId: localStorage.getItem('lite2:contextId:v1'),
  gate: document.querySelectorAll('.lite-onboard').length,
}))
rec('⑥ restart 后：语言/观感偏好键全清回出厂（lite2:look/lang:v1 = null）',
  afterRestart.look === null && afterRestart.lang === null, JSON.stringify(afterRestart))
rec('⑥ restart 后：context 锚也清（lite2:contextId:v1 = null）', afterRestart.ctxId === null, `ctxId=${afterRestart.ctxId}`)
rec('⑥ restart 后：onboarding 闸门重弹', afterRestart.gate > 0, `onboard=${afterRestart.gate}`)

rec('全程无 pageerror', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | ') || '0 条')

await ctx.close()

await finish(gateRec, { browser, label: '开关判据', listFailures: true })
