#!/usr/bin/env node
// 中文站逐屏「拉丁残留」探针 —— 两条线的门中间那个洞的补丁。
//
// 为什么这个门必须单独存在（0719 收尾时用它逮到一条**当时正跑在线上**的缺陷）：
//
//   · 部署线的门查的是**打包产物**里有没有已知英文句子（'WORTH A CLOSER LOOK' 一类的
//     grep 名单）。`blocked` / `done` 是后端状态枚举 token，不是句子，名单里没有它们。
//   · 对齐线的门查的是**行为**（刷新还在、后退不掉出、缺状态不编成 on-track），断言读的是
//     store 字段。屏幕上那个词是中文还是英文，它不看 —— 它的 S1 证据行里甚至明明白白
//     打着 frontendStatus: ["blocked", ...]，门照样绿。
//
//   ⇒ 两个门都绿，而中文客户在「你的团队」首屏和项目详情里读到的是光秃秃的 `blocked`。
//     修法见 src/shared/projectStatus.ts。
//
// 判据不是「有没有拉丁字母」——项目名、文件格式名（PDF/Excel）、品牌名 Avery 都合法。
// 本脚本只负责**把可疑串捞出来给人判**，不自动判定通过/失败；退出码恒为 0。
// 唯一硬失败：pageerror 非空。
//
// 怎么跑（与 .issues/v02-partner-align-0718/verify-p0.mjs 同一套前置）：
//   1) cd eval-harness && AVERY_BRAIN=stub python -m uvicorn service.app:app --port 8137
//   2) 前端起在 5173（端口必须是 5173，后端 CORS 是精确匹配列表）
//   3) node .issues/feat-068-frontend-deploy/verify-zh-purity.mjs
import { chromium } from 'playwright'

const UI = process.env.VERIFY_BASE || 'http://127.0.0.1:5173'
const V2_SCREENS = ['home', 'team', 'projects', 'room', 'followups', 'notes', 'closerlook', 'playbooks', 'vision']

// 允许出现的拉丁串：品牌名 / 文件格式专名 / 单位。命中这些的不计入。
const ALLOW = /^(Avery|Esc|W\d+|\d+%|v\d+|MB|PDF|CSV|XLSX|MD|OK|Word|Excel|Markdown)$/i

const DOC = [
  '# 三亚鹿山雅居 · 周报 W29', '',
  '## 项目：别墅交付验收', '负责人：李明',
  '阻碍项：佣金测算卡住，等财务确认', '进度：本月无法完成', '',
  '## 项目：渠道合作拓展', '负责人：王芳', '',
  '## 项目：客服体系搭建', '负责人：陈思雨', '进度：已完成', '',
].join('\n')

function latinHits(txt) {
  const out = []
  for (const line of txt.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    for (const frag of trimmed.match(/[A-Za-z][A-Za-z'()\-]*(?:\s+[A-Za-z][A-Za-z'()\-]*)*/g) || []) {
      const words = frag.trim().split(/\s+/)
      // 两个及以上连续拉丁词，或单个长度 >= 4 的拉丁词
      if (words.length >= 2 || (words[0] && words[0].length >= 4)) out.push({ line: trimmed, frag: frag.trim() })
    }
  }
  return out.filter((h) => !h.frag.split(/\s+/).every((w) => ALLOW.test(w)))
}

const dedupe = (hits) => [...new Map(hits.map((h) => [h.frag, h])).values()]

function report(title, surfaces) {
  console.log(`\n═══ ${title} ═══`)
  let total = 0
  for (const [name, hits] of Object.entries(surfaces)) {
    const uniq = dedupe(hits)
    total += uniq.length
    if (!uniq.length) { console.log(`  [干净] ${name}`); continue }
    console.log(`  [残留] ${name} — ${uniq.length} 处`)
    for (const h of uniq.slice(0, 10)) console.log(`         · "${h.frag}"   ← ${h.line.slice(0, 110)}`)
  }
  return total
}

const browser = await chromium.launch({ headless: true })
const pageErrors = []

// ── v01（`?v=1` 逃生门）─────────────────────────────────────────────────────
//
// 🔴 2026-07-19 起裸链不再是 v01。Danny 拍板 ① 把 resolveVersion() 的缺省翻成了 '2'，
//    所以 `?mode=live&lang=zh`（不带 v=）现在开出来的是 **v02**。要取 v01 的面，必须
//    显式写 `?v=1`。
//
// ⚠️ **这条改错了不会报错，只会静悄悄地测两遍 v02 然后报告「v01 干净」。** 机制：
//    `src/main.tsx:43` 在 DEV 下**无条件**把 `window.__AVERY_LITE__`（v01 的 store）
//    挂到 window 上——挂不挂和当前渲染的是哪张壳完全无关。于是漏改这一行的后果是：
//      · 页面渲染的是 v02；
//      · 下面的 uploadFiles 成功写进了一个**没有被渲染**的 v01 store；
//      · openDetail 拿到真实的 project id，返回值看着完全正常；
//      · 而 innerText 刮的是 v02 的 DOM。
//    → 退出码 0、报告可信、结论是错的。改这一行时请连同本段注释一起读。
const p1 = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage()
p1.on('pageerror', (e) => pageErrors.push(`v01: ${e.message}`))
await p1.goto(`${UI}/?v=1&mode=live&lang=zh`, { waitUntil: 'networkidle' })
await p1.waitForTimeout(600)
await p1.evaluate(async (t) => {
  await window.__AVERY_LITE__.getState().uploadFiles([new File([t], 'w29.md', { type: 'text/markdown' })])
  await new Promise((r) => setTimeout(r, 2400))
}, DOC)

const v01 = { 团队屏: latinHits(await p1.evaluate(() => document.body.innerText)) }
const opened = await p1.evaluate(() => {
  const st = window.__AVERY_LITE__.getState()
  const p = (st.team?.projects ?? [])[0]
  if (!p) return null
  st.openDetail('project', p.id)
  return { id: p.id, status: p.status ?? '(none)' }
})
await p1.waitForTimeout(700)
v01['项目详情浮层'] = latinHits(await p1.evaluate(() => document.body.innerText))
const n1 = report(`v01（?v=1 逃生门）· 打开的项目 ${JSON.stringify(opened)}`, v01)

// ── v02（`?v=2`）逐屏 ────────────────────────────────────────────────────────
// v02 自 2026-07-19 起就是**裸链默认**（拍板 ①）。这里仍然显式写 `?v=2` 是刻意的：
// 门的结论不该依赖「当前缺省值恰好是几」——缺省再翻一次时，这一段测的还是 v02。
// 裸链本身开出哪张壳，由 verify-bare-url-shell.mjs 单独守。
const p2 = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage()
p2.on('pageerror', (e) => pageErrors.push(`v02: ${e.message}`))
await p2.goto(`${UI}/?v=2&mode=live&look=paper&lang=zh`, { waitUntil: 'networkidle' })
if (await p2.locator('.lite-onboard').count()) { await p2.keyboard.press('Escape'); await p2.waitForTimeout(700) }
await p2.evaluate(async (t) => {
  await window.__lite2Store.getState().uploadFiles([new File([t], 'w29.md', { type: 'text/markdown' })])
  await new Promise((r) => setTimeout(r, 2400))
}, DOC)

const v02 = {}
for (const screen of V2_SCREENS) {
  await p2.evaluate((s) => window.__lite2Store.getState().goScreen(s), screen)
  await p2.waitForTimeout(800)
  v02[`/${screen}`] = latinHits(await p2.evaluate(() => document.body.innerText))
}
const n2 = report('v02（?v=2 显式；亦即现在的裸链默认）逐屏', v02)

console.log(`\n  pageerror: ${pageErrors.length} 条${pageErrors.length ? ' — ' + pageErrors.join(' | ') : ''}`)
console.log(`═══ 合计 ${n1 + n2} 处待人工判读（v01 ${n1} · v02 ${n2}）═══`)
console.log('  已知可接受项：文件格式专名（PDF/Word/Excel/CSV/Markdown）；')
console.log('  「往哪走」屏的中英混排宣讲词（demo / agent / Skills / tools / onboarding / skill / prompt）——')
console.log('  那是刻意的产品腔调，不是漏译，改不改归 Danny 判（见 issue 记录）。')

await browser.close()
process.exit(pageErrors.length ? 1 : 0)
