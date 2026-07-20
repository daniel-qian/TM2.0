#!/usr/bin/env node
// ZH 站「无障碍属性」拉丁残留探针 —— aria-zh 0720。
//
// 为什么这个门必须单独存在：verify-zh-purity.mjs 逐屏抓的是 `document.body.innerText`——
// **结构上看不见** aria-label / title / alt 这类属性（它们从不进 innerText）。这不是它漏测，
// 是它的采样方法够不着这一类值。本次审计（grep -rn "aria-label" src/）在两张壳里数出
// ~88 处硬编码英文 aria-label（"Avery controls" / "Screen" / 每屏 aria-label / composer 的
// "Ask about your team" 等），中文屏幕阅读器用户打开 ZH 生产站，听到的是一整套英文导航——
// 而两条既有门（zh-purity 扫 innerText、P0/switchers 扫行为）全绿，因为它们都不读这类属性。
//
// 判据不是「有没有拉丁字母」——本门与 verify-zh-purity.mjs 不同：结构性 UI 属性没有
// "刻意中英混排"的灰区，所以本门是真正的硬门，不是只给人看的可疑清单（见下面④）。
// 品牌名 Avery 合法（见下面 ALLOW），此外一律不放行。
//
// 🔴 硬失败共四条：
//   ① pageerror 非空；
//   ② 议事室采样时对话流是空的（同 verify-zh-purity.mjs 的 feat-069 教训——薄画布
//      （LitePanZoom）与终端（LiteTerminal / LiteThinkingFlow）只在 `run.status !== 'idle'`
//      之后才挂载，`roomBoardAria`/`terminalAria` 这批新修的属性恰好长在这些组件上。
//      如果不真跑一次问答就采样，这一屏的「干净」结论和当年那六句英文一样是空真）；
//   ③ 采样到的 aria-label/title/alt 元素总数为 0（同一防线：说明选择器或页面本身没渲染，
//      「零残留」不能是「压根没采到东西」的伪装）；
//   ④ 白名单外的可疑拉丁串数 > 0——这是本门存在的目的，target 是 0。
//
// 怎么跑（与 verify-zh-purity.mjs 同一套前置）：
//   1) cd eval-harness && AVERY_BRAIN=mock python -m uvicorn service.app:app --port 8137
//   2) 前端起在 5173（后端 CORS 精确匹配；换端口会被浏览器静默拦掉）
//   3) node eval-harness/tools/verify-aria-zh.mjs
//   （VERIFY_BASE 环境变量可覆盖默认的 http://127.0.0.1:5173，换端口起服务时用它——
//    见交接记录：门本身跑的时候把 5173/8137 换成隔离端口，是从一份端口替换过的临时拷贝跑的，
//    不改这份原件。）
//
// 🔴 用 `window.__liteStore` 取 v01 句柄，不用其他门常见的 `window.__AVERY_LITE__`：后者是
// `src/main.tsx` 里挂在 `import.meta.env.DEV` 闸后面的诊断缝，`vite build`（无论 `--mode` 传
// 什么）永远把 DEV 静态求值成 false，整块连同它一起被 DCE 掉——这个 worktree 的 `vite dev`
// 又因为共享 node_modules 缺 @babel/* 起不来（见交接记录），逼真跑 `vite build`+`vite preview`
// 时会踩到这个坑：`window.__AVERY_LITE__` 是 `undefined`，门在 v01 侧全炸。`window.__liteStore`
// 是 `src/lite/store.ts` 自己挂的、不挂 DEV 闸的验收缝（`__lite2Store` 同款先例），两种起服务
// 方式下都在，本门认它。（若改用一份不依赖 @vitejs/plugin-react/babel 的临时 esbuild-JSX
// vite 配置走真 `vite dev`，DEV 会是 true，两个句柄都在——但本门不假设你用了哪一种。）
import { chromium } from 'playwright'

const UI = process.env.VERIFY_BASE || 'http://127.0.0.1:5173'
const V2_SCREENS = ['home', 'team', 'projects', 'room', 'followups', 'notes', 'closerlook', 'playbooks', 'vision']
const V1_SCREENS = ['team', 'room', 'notes', 'playbooks', 'vision']

// 白名单：品牌名 + 一条从 verify-zh-purity.mjs 继承来的、Danny 已经拍过板的产品腔调例外。
// 短且明确——不是「看着像英文就放过」，是「逐个想清楚为什么合法」：
//   · Avery：产品名，任何语言的界面里都不译。
//   · demo：VisionScreen（"往哪走" 屏）的 t.lite.visionTitle/visionNowBody 等几句刻意中英
//     混排的宣讲词里带这个词（"你刚才试的是 demo"）——这不是这批改动新引入的，是本来就在
//     zh.ts 里的既有文案，且 verify-zh-purity.mjs 的收尾注释已经把它列成两类已知可接受项
//     之一（"往哪走屏刻意中英混排"），本门不重新拍这个板，只是同一个决定在属性扫描里也要
//     生效，否则这一条会在两道门之间反复红黄横跳。
// 与 verify-zh-purity.mjs 不同：那个门还要放行 PDF/Word/Excel 等文件格式词、AVERY/TOOL/
// MANIFEST 议事室前缀——但那些词此前一个都没出现在 aria-label/title/alt 里（本门自己的
// 扫描先跑过一轮确认过），所以这里不预先放行，真出现了应该被看见、被人工判断要不要扩白名单。
const ALLOW = /^(Avery|demo)$/

const DOC = [
  '# 星河科技 · 周报 W31', '',
  '## 项目：客户系统迁移', '负责人：李明',
  '阻碍项：数据库迁移卡住，等测试环境确认', '进度：本月无法完成', '',
  '## 项目：渠道拓展合作', '负责人：王芳', '进度：70%', '',
  '## 项目：售后体系搭建', '负责人：陈思雨', '进度：已完成', '',
].join('\n')

const SITUATION = '这周客户系统迁移卡在哪一步，我该怎么跟进？'

function record(list, name, pass, detail) {
  list.push({ name, pass, detail })
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name}${detail ? ' — ' + detail : ''}`)
}

// 页面上所有 aria-label / title / alt 的值，连同一点定位信息（标签名 + class，便于人工回查）。
async function collectAttrs(page) {
  return page.evaluate(() => {
    const ATTRS = ['aria-label', 'title', 'alt']
    const out = []
    for (const el of document.querySelectorAll('[aria-label], [title], [alt]')) {
      for (const attr of ATTRS) {
        const v = el.getAttribute(attr)
        if (v == null || v.trim() === '') continue
        out.push({ attr, value: v, tag: el.tagName.toLowerCase(), cls: (el.className || '').toString().slice(0, 60) })
      }
    }
    return out
  })
}

// 单个属性值里有没有可疑拉丁串——判据与 verify-zh-purity.mjs 的 latinHits 同一套尺子：
// 两个及以上连续拉丁词，或单个长度 >= 4 的拉丁词；逐词过 ALLOW，整串都在白名单内才放行。
function suspiciousLatin(value) {
  const hits = []
  for (const frag of value.match(/[A-Za-z][A-Za-z'()\-]*(?:\s+[A-Za-z][A-Za-z'()\-]*)*/g) || []) {
    const words = frag.trim().split(/\s+/)
    if (words.length >= 2 || (words[0] && words[0].length >= 4)) hits.push(frag.trim())
  }
  return hits.filter((frag) => !frag.split(/\s+/).every((w) => ALLOW.test(w)))
}

// 采一屏：跑 collectAttrs，把每条命中标成 { attr, tag, cls, value, frag }。
async function sampleScreen(page, label, results) {
  const attrs = await collectAttrs(page)
  const hits = []
  for (const a of attrs) {
    for (const frag of suspiciousLatin(a.value)) {
      hits.push({ ...a, frag })
    }
  }
  const dedup = [...new Map(hits.map((h) => [`${h.attr}:${h.value}`, h])).values()]
  results.push({ label, sampledCount: attrs.length, hits: dedup })
  console.log(
    `    · ${label} — 采到 ${attrs.length} 个属性值，可疑 ${dedup.length} 处` +
      (dedup.length ? '  ⚠' : ''),
  )
  for (const h of dedup.slice(0, 8)) {
    console.log(`         · <${h.tag} class="${h.cls}"> ${h.attr}="${h.value}"  ← 命中 "${h.frag}"`)
  }
  return attrs.length
}

async function dismissOnboardIfAny(p) {
  if (await p.locator('.lite-onboard').count()) {
    await p.keyboard.press('Escape')
    await p.waitForTimeout(700)
  }
}

const browser = await chromium.launch({ headless: true })
const pageErrors = []
const emptyTranscripts = []
const results = []
let totalSampled = 0

// ── v01（`?v=1` 逃生门）──────────────────────────────────────────────────────
const p1 = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage()
p1.on('pageerror', (e) => pageErrors.push(`v01: ${e.message}`))
await p1.goto(`${UI}/?v=1&mode=live&lang=zh`, { waitUntil: 'networkidle' })
await p1.waitForTimeout(600)
await p1.evaluate(async (t) => {
  await window.__liteStore.getState().uploadFiles([new File([t], 'w31.md', { type: 'text/markdown' })])
  await new Promise((r) => setTimeout(r, 2400))
}, DOC)

console.log('\n═══ v01（?v=1 逃生门）逐屏 ═══')
for (const screen of V1_SCREENS) {
  await p1.evaluate((s) => window.__liteStore.getState().goScreen(s), screen)
  await p1.waitForTimeout(600)
  totalSampled += await sampleScreen(p1, `v01 /${screen}`, results)
}

// 项目详情浮层——DetailOverlay 是本批之外的既有 dict 消费方，但同属「弹层」类结构属性，
// 顺手采一遍不吃亏（成本几乎为零，且能捞出回归）。
const card1 = p1.locator('.home-project-card').first()
if (await card1.count()) {
  await card1.click()
  await p1.waitForTimeout(500)
  totalSampled += await sampleScreen(p1, 'v01 项目详情浮层', results)
  await p1.keyboard.press('Escape')
  await p1.waitForTimeout(400)
}

// 🔴 feat-069 同款教训：LitePanZoom（roomBoardAria）与 LiteTerminal（terminalAria）只在
// `run.status !== 'idle'` 之后才挂载——不真跑一次问答，这两个新修的属性永远采不到，
// 「room 屏干净」的结论就是当年那六句英文的重演。
await p1.evaluate((s) => window.__liteStore.getState().askLive({ situation: s }), SITUATION)
await p1
  .waitForFunction(() => window.__liteStore.getState().run.status !== 'idle', { timeout: 8000 })
  .catch(() => {})
await p1.waitForTimeout(900)
const lines1 = await p1.evaluate(() => window.__liteStore.getState().run.lines.length)
if (lines1 === 0) emptyTranscripts.push('v01 room')
console.log(`    · v01 /room 议事室对话流 ${lines1} 行${lines1 === 0 ? '  ⚠ 空！' : ''}`)
totalSampled += await sampleScreen(p1, 'v01 /room（真跑一次问答后）', results)

// ── v02（`?v=2`，裸链默认）逐屏 ──────────────────────────────────────────────
const p2 = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage()
p2.on('pageerror', (e) => pageErrors.push(`v02: ${e.message}`))
await p2.goto(`${UI}/?v=2&mode=live&look=paper&lang=zh`, { waitUntil: 'networkidle' })
await dismissOnboardIfAny(p2)
await p2.evaluate(async (t) => {
  await window.__lite2Store.getState().uploadFiles([new File([t], 'w31.md', { type: 'text/markdown' })])
  await new Promise((r) => setTimeout(r, 2400))
}, DOC)

console.log('\n═══ v02（?v=2 显式；亦即现在的裸链默认）逐屏 ═══')
for (const screen of V2_SCREENS) {
  await p2.evaluate((s) => window.__lite2Store.getState().goScreen(s), screen)
  await p2.waitForTimeout(700)
  totalSampled += await sampleScreen(p2, `v02 /${screen}`, results)
}

const card2 = p2.locator('.home-project-card, .home-person-card').first()
if (await card2.count()) {
  await card2.click()
  await p2.waitForTimeout(500)
  totalSampled += await sampleScreen(p2, 'v02 详情浮层', results)
  await p2.keyboard.press('Escape')
  await p2.waitForTimeout(400)
}

await p2.evaluate((s) => window.__lite2Store.getState().goScreen('room'), 'room')
await p2.waitForTimeout(400)
await p2.evaluate((s) => window.__lite2Store.getState().askLive({ situation: s }), SITUATION)
await p2
  .waitForFunction(() => window.__lite2Store.getState().run.status !== 'idle', { timeout: 8000 })
  .catch(() => {})
await p2.waitForTimeout(900)
const lines2 = await p2.evaluate(() => window.__lite2Store.getState().run.lines.length)
if (lines2 === 0) emptyTranscripts.push('v02 room')
console.log(`    · v02 /room 议事室对话流 ${lines2} 行${lines2 === 0 ? '  ⚠ 空！' : ''}`)
totalSampled += await sampleScreen(p2, 'v02 /room（真跑一次问答后 · 简化视图）', results)

// 「展开原始流」——RawStreamLog 是另一处只在这个按钮点开后才挂载的 DOM 分支。
const expanded = await p2.evaluate(() => {
  const btn = document.querySelector('[data-flow-toggle]')
  if (!btn) return false
  if (btn.getAttribute('aria-expanded') !== 'true') {
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  }
  return true
})
if (expanded) {
  await p2.waitForTimeout(300)
  totalSampled += await sampleScreen(p2, 'v02 /room（展开原始流）', results)
}

await browser.close()

// ── 汇总 ─────────────────────────────────────────────────────────────────────
const checks = []
record(checks, 'pageerror 为 0', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | ') || '0 条')
record(
  checks,
  '议事室对话流两侧都非空（真的跑了一次，不是采到 idle 空态）',
  emptyTranscripts.length === 0,
  emptyTranscripts.join(' | ') || '（v01/v02 均非空 ✓）',
)
record(checks, '采样到的属性总数 > 0（选择器/页面本身没渲染会让"零残留"变成空真）', totalSampled > 0, `共采到 ${totalSampled} 个属性值`)

const allHits = results.flatMap((r) => r.hits.map((h) => ({ screen: r.label, ...h })))
const dedupHits = [...new Map(allHits.map((h) => [`${h.attr}:${h.value}`, h])).values()]

console.log(`\n═══ 汇总：${results.length} 个采样点，累计可疑 aria-label/title/alt ${dedupHits.length} 处 ═══`)
if (dedupHits.length) {
  console.log('\n可疑属性值（按属性值去重）：')
  for (const h of dedupHits) {
    console.log(`  ✗ [${h.screen}] <${h.tag}> ${h.attr}="${h.value}"  ← 命中 "${h.frag}"`)
  }
}
console.log('\n已知可接受项：品牌名 Avery（见 ALLOW）。其余任何拉丁串都应被当作真实缺陷处理，')
console.log('不应该扩大白名单去迁就它——除非它确实是品牌名或后端工具标识符。')

// 🔴 与 verify-zh-purity.mjs 的关键差异：那道门的可疑串只供人工判读，不计入退出码
// （项目名/产品腔中英混排是它明确允许的灰区）。这道门盯的是结构性 UI 属性——顶栏/composer/
// 每屏容器/空态这类文案在 ZH 构建上没有"刻意中英混排"的余地，所以这里可疑残留直接计入
// 硬失败：target 是 0，不是"人来看着办"。
record(checks, '可疑 aria-label/title/alt 残留为 0（白名单外）', dedupHits.length === 0,
  dedupHits.length ? `${dedupHits.length} 处，见上面清单` : '0 处 ✓')

const gateFail = checks.some((c) => !c.pass)
console.log(
  `\n═══ 判据：${checks.filter((c) => c.pass).length} PASS · ${checks.filter((c) => !c.pass).length} FAIL ═══`,
)
process.exit(gateFail ? 1 : 0)
