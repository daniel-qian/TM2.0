// cr 对齐规格门（cr-align 视觉战役棒0 · 2026-07-21）。
//
// ## 判别器
// 对我方 aurora 构建逐行断言 eval-harness/specs/cr-align-spec.json——规格值来自
// extract-cr-spec.mjs 在 cr-live dev server 真路由上的计算值提取（人工筛选定稿；
// AA 偏差已按台账 D1-D4 内化进表）。这是整场对齐战役的 definition-of-done：
// 战役收官 = 全表全绿。
//
// ## 分期（stick 字段）
// 规格是终态，战役分棒交付：SPEC_STICK=N 只硬断言 stick≤N 的行（本棒已交付面），
// stick>N 的行照跑照报但标 [FUTURE] 不计红——每棒电池带着自己的 SPEC_STICK 跑，
// 战役收官跑全量。
//
// ## 两种世界
// 全量跑在棒1 构建上必红（stick 2/3/4 的行全是未来态：topbar top 18≠14、h1 700≠800、
// 按钮 999px≠9px……），红输出存档即两世界证据；每棒交付后其 stick 行转绿。
//
//   VERIFY_BASE=http://localhost:5173 [SPEC_STICK=1] node eval-harness/tools/verify-cr-alignment.mjs
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const UI = process.env.VERIFY_BASE || 'http://localhost:5173'
const STICK = process.env.SPEC_STICK ? Number(process.env.SPEC_STICK) : Infinity
const HERE = dirname(fileURLToPath(import.meta.url))
const spec = JSON.parse(readFileSync(join(HERE, '..', 'specs', 'cr-align-spec.json'), 'utf8'))

const R = []
const rec = (n, ok, future, d) => {
  R.push({ n, ok, future })
  const tag = future ? (ok ? 'PASS·future' : 'FUTURE') : ok ? 'PASS' : 'FAIL'
  console.log(`  [${tag}] ${n}${d ? ' — ' + d : ''}`)
}

const SEED_DOC = [
  '# 望江咨询 · 项目周报 W33', '', '## 项目：客户门户改版', '负责人：陈静', '状态：正常', '',
  '本周完成登录页联调，下周进入验收。', '',
].join('\n')

const browser = await chromium.launch({ headless: true })
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
await page.goto(`${UI}/?v=2&mode=live&look=aurora&lang=zh`, { waitUntil: 'networkidle' })
if (await page.locator('.lite-onboard').count()) {
  await page.keyboard.press('Escape')
  await page.waitForTimeout(600)
}
await page.evaluate(async (doc) => {
  const enc = new TextEncoder()
  const f = new File([enc.encode(doc)], 'w33-weekly.md', { type: 'text/markdown' })
  await window.__lite2Store.getState().uploadFiles([f])
}, SEED_DOC)
await page.waitForFunction(
  () => ['ready', 'error'].includes(window.__lite2Store.getState().ingestStatus),
  undefined, { timeout: 30000 },
)

// 决策卡的行需要决策世界（verify-home-skeleton 的注入配方）
await page.evaluate(() => {
  const decision = {
    subject_type: 'project', subject_id: 'p-gate-1', subject_title: '客户门户改版',
    grade: 'high_risk', grade_label: '今天要决策', severity: 3,
    reason: '截止日期已过而状态仍写推进中。', reason_source: 'rule',
    escalated: false, escalation_reason: null, unknown_fields: [], unparsed_fields: [],
    matched_rules: [{ rule_id: 'R1', title: '过期未更新', grade_label: '今天要决策', basis: '截止日早于今天', evidence: ['原文：预计 7 月 10 日交付'] }],
    owner_name: '陈静',
  }
  const st = window.__lite2Store.getState()
  const raw = st.rawTeam || { people: [], projects: [], decisions: [] }
  window.__lite2Store.setState({ rawTeam: { ...raw, decisions: [decision] } })
})

// 按屏分组跑
const byScreen = new Map()
for (const row of spec.rows) {
  if (!byScreen.has(row.screen)) byScreen.set(row.screen, [])
  byScreen.get(row.screen).push(row)
}

for (const [screen, rows] of byScreen) {
  await page.evaluate((s) => window.__lite2Store.getState().goScreen(s), screen)
  await page.waitForTimeout(400)
  for (const row of rows) {
    const actual = await page.evaluate(({ selector, prop, varName }) => {
      const el = document.querySelector(selector)
      if (!el) return null
      const cs = getComputedStyle(el)
      return varName ? cs.getPropertyValue(varName).trim() : cs[prop]
    }, { selector: row.selector, prop: row.prop, varName: row.var })
    let ok = false
    if (actual !== null) {
      if (row.tolerance === 'exact') ok = actual === row.expected
      else if (row.tolerance === 'contains') ok = String(actual).includes(row.expected)
      else if (row.tolerance === 'px1' || row.tolerance === 'px2') {
        const tol = row.tolerance === 'px1' ? 1 : 2
        ok = Math.abs(parseFloat(actual) - parseFloat(row.expected)) <= tol
      }
    }
    const future = row.stick > STICK
    rec(`[stick${row.stick}] ${row.key} ${row.var || row.prop}=${row.expected}`, ok, future,
      actual === null ? `选择器无匹配 ${row.selector}` : ok ? '' : `实测 ${String(actual).slice(0, 60)}`)
  }
}

await browser.close()

const hard = R.filter((r) => !r.future)
const hardFail = hard.filter((r) => !r.ok).length
const futureLeft = R.filter((r) => r.future && !r.ok).length
console.log(`\n═══ cr 对齐规格：硬断言 ${hard.length - hardFail}/${hard.length} 绿 · 未来行剩 ${futureLeft} 红（战役进度表）═══`)
process.exit(hardFail ? 1 : 0)
