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
// ## 行类型（「布局与真部件」战役棒A 扩容）
// 缺省行 = 单元素单属性（`prop` 或 `var`）；新增 `probe:'rect'`（配 `axis`，量
// getBoundingClientRect 的 width/height/left/top）与 `probe:'count'`
// （querySelectorAll(selector).length）。缺省行的行为一字未改。
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

// 世界搭建（「布局与真部件」战役棒A · E8 扩容）。
//
// 原来只灌一份周报，实测世界是「0 人 / 1 项目 / 0 卡点」——主页右栏两块（差距摘要 /
// 需关注的人）都是空态，没有 DOM。本战役把这两块提到主页黄金位，spec 行的 selector
// 会直接无匹配 → actual===null → 判红，那是**假红**（码没错，是世界太薄）。
//
// 触发条件是实测出来的（.issues/layout-real-0722/panel-firing-truth.md）：
//   · 差距卡：项目 statusRaw ∈ {on-track, steady} **且** blockers 非空（嘴上说没事、身上挂着卡点）
//   · 关注成员：某人**名下项目**挂着卡点（signalCount+blockerCount ≥ 1）；人必须先在名册里存在
// 所以要两份文件：花名册（造人，周报单独喂出来的是 0 人）+ 周报（同一个项目块里
// 同时写「状态：正常」和「阻塞：…」）。缺任何一半，两块都回到空态。
const SEED_DOCS = [
  {
    name: 'w33-roster.md',
    text: [
      '# 望江咨询 · 员工花名册', '',
      '姓名 | 职位 | 部门 | 司龄 | 负责',
      '陈静 | 产品经理 | 客户门户组 | 3 年 | 客户门户改版',
      '周敏 | 交付顾问 | 客户门户组 | 2 年 | 客户门户改版', '',
    ].join('\n'),
  },
  {
    name: 'w33-weekly.md',
    text: [
      '# 望江咨询 · 项目周报 W33', '', '## 项目：客户门户改版', '负责人：陈静', '状态：正常',
      // rich-align-0722/01：给这个项目补进度 + 项目级风险，让 projects 屏渲染进度条 + 风险徽章
      // （stick 6 行断言这两个真部件）。阻塞行照旧走 blockers（长标签优先，无串扰）。
      '进度：58%', '风险：高/雨季场地档期紧张',
      '阻塞：验收口径未确认，法务尚未回复。', '',
      '本周完成登录页联调，下周进入验收。', '',
    ].join('\n'),
  },
]

const browser = await chromium.launch({ headless: true })
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
await page.goto(`${UI}/?v=2&mode=live&look=aurora&lang=zh`, { waitUntil: 'networkidle' })
if (await page.locator('.lite-onboard').count()) {
  await page.keyboard.press('Escape')
  await page.waitForTimeout(600)
}
await page.evaluate(async (docs) => {
  const enc = new TextEncoder()
  const files = docs.map((d) => new File([enc.encode(d.text)], d.name, { type: 'text/markdown' }))
  await window.__lite2Store.getState().uploadFiles(files)
}, SEED_DOCS)
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

// 世界体检（棒A · E8）：先把两块面板的派生条数打出来，再跑 spec。
// 数的是 deriveGaps / deriveAttentionPeople 的**结果长度**（界面上的计数徽标就是它们的
// .length，列表本身只渲染前 3 / 前 4 条）。任何一项是 0，主页右栏该块就是空态，
// 依赖它的 spec 行会因「选择器无匹配」判红——那是世界的问题，不是码的问题。
await page.evaluate(() => window.__lite2Store.getState().goScreen('home'))
await page.waitForTimeout(400)
const world = await page.evaluate(() => {
  const st = window.__lite2Store.getState()
  const badge = (sel) => { const el = document.querySelector(sel); return el ? el.textContent.trim() : '(空态)' }
  return {
    people: st.team ? st.team.people.length : null,
    projects: st.team ? st.team.projects.length : null,
    blockers: st.team ? st.team.projects.reduce((n, p) => n + (p.blockers ? p.blockers.length : 0), 0) : null,
    gaps: badge('.lite2-shell .lite-home-gaps .lite-home-count'),
    gapItems: document.querySelectorAll('.lite2-shell .lite-home-gap-item').length,
    attention: badge('.lite2-shell .lite-home-attention .lite-home-count'),
    attentionItems: document.querySelectorAll('.lite2-shell .lite-home-attention-list > li').length,
  }
})
console.log(`  世界：${world.people} 人 / ${world.projects} 项目 / ${world.blockers} 条卡点 · `
  + `差距 ${world.gaps}（渲染 ${world.gapItems} 条）· 需关注的人 ${world.attention}（渲染 ${world.attentionItems} 行）`)

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
    // 三种取值器（`probe` 缺省=原来的单元素单属性，行为一字不变）：
    //   · 缺省          getComputedStyle(el)[prop] 或 自定义属性 var
    //   · probe:'rect'  el.getBoundingClientRect()[axis]，axis ∈ width|height|left|top
    //   · probe:'count' document.querySelectorAll(selector).length
    // 布局要断言的是**栏宽比 / 网格列数 / 子元素计数**，单属性够不着：computed 的
    // gridTemplateColumns 是解析后的 px 串（实测她方双栏 = "835.172px 538.828px"，
    // 不是作者写的 "1.55fr 1fr"），所以比例只能量两栏的 rect，列数只能数子元素。
    // 判据仍是既有 tolerance 家族（exact/contains/px1/px2）——rect/count 一律回 string。
    const actual = await page.evaluate(({ selector, prop, varName, probe, axis }) => {
      if (probe === 'count') return String(document.querySelectorAll(selector).length)
      const el = document.querySelector(selector)
      if (!el) return null
      if (probe === 'rect') {
        const v = el.getBoundingClientRect()[axis || 'width']
        return typeof v === 'number' ? String(v) : null
      }
      const cs = getComputedStyle(el)
      return varName ? cs.getPropertyValue(varName).trim() : cs[prop]
    }, { selector: row.selector, prop: row.prop, varName: row.var, probe: row.probe, axis: row.axis })
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
    // 量名：rect/count 行没有 prop/var，打印它们自己的量（不改既有行的输出一个字）
    const measure = row.var || row.prop
      || (row.probe === 'rect' ? `rect.${row.axis || 'width'}` : row.probe === 'count' ? 'count' : '?')
    rec(`[stick${row.stick}] ${row.key} ${measure}=${row.expected}`, ok, future,
      actual === null ? `选择器无匹配 ${row.selector}` : ok ? '' : `实测 ${String(actual).slice(0, 60)}`)
  }
}

await browser.close()

const hard = R.filter((r) => !r.future)
const hardFail = hard.filter((r) => !r.ok).length
const futureLeft = R.filter((r) => r.future && !r.ok).length
console.log(`\n═══ cr 对齐规格：硬断言 ${hard.length - hardFail}/${hard.length} 绿 · 未来行剩 ${futureLeft} 红（战役进度表）═══`)
process.exit(hardFail ? 1 : 0)
