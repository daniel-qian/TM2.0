// rich-align-0722/08 · playbooks 方法库 e2e 探针（满态网格 + 空态诚实降级 + 2 列关系几何）。
//
// 覆盖 issue-08 Acceptance 的 e2e 行：
//   ① 空态（无 SOP/未 claim）= coming-soon 诚实标 + 回看向导入口在、方法库网格不在。
//   ② 三亚一键 claim → payload.playbooks 满态 → 方法库网格：5 张方法卡、title/tags 与 SOP 对得上。
//   ③ 2 列几何 = 关系断言（前 2 卡顶同行、第 3 卡换行且回到首列）——不反向抄构建像素。
//   ④ 方法卡=非交互 article（不渲染 button，天然不进 button-family 门）；方形图标 ~40px。
//   ⑤ 全程零 console error / pageerror（payload/端点缺席也判空降级不报错）。
//
// 🔴 离线：吃 mock 三件套后端（AVERY_BRAIN=mock）+ AVERY_DEMO_SEED_DIR=三亚 seed。绝不碰 minimax。
//   VERIFY_BASE=http://localhost:5173 node .issues/rich-align-0722/verify-playbooks-08.mjs
import { chromium } from 'playwright'

const UI = process.env.VERIFY_BASE || 'http://localhost:5173'
const R = []
const rec = (n, ok, d) => {
  R.push({ n, ok })
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${n}${d ? ' — ' + d : ''}`)
}

// SOP（管理规范与升级红线.md）的 5 张方法卡逐字标题 + 两张卡的标签逐字对照。
const METHOD_TITLES = [
  '重大宴会跨部门协作闭环',
  '旺季跨部门产能协调',
  '项目事项红黄蓝过程管控',
  '升级与红线判定',
  '新人爬坡期公平判断',
]
const TAGS_UPGRADE = ['升级', '红线', '法务', '安全', '关怀'] // 升级与红线判定
const TAGS_NEWCOMER = ['新人', '爬坡', '协助', '公平'] // 新人爬坡期公平判断

const browser = await chromium.launch({ headless: true })
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
const consoleErrors = []
page.on('pageerror', (e) => consoleErrors.push(String(e)))
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()) })

await page.goto(`${UI}/?v=2&mode=live&look=aurora&lang=zh`, { waitUntil: 'networkidle' })
if (await page.locator('.lite-onboard').count()) {
  await page.keyboard.press('Escape')
  await page.waitForTimeout(600)
}

// ① 空态：方法库网格不在，coming-soon + 回看向导入口在。
await page.evaluate(() => window.__lite2Store.getState().goScreen('playbooks'))
await page.waitForTimeout(300)
const empty = await page.evaluate(() => ({
  grid: !!document.querySelector('.lite-playbooks-grid'),
  cards: document.querySelectorAll('.lite-playbooks-card').length,
  comingsoon: !!document.querySelector('.lite-playbooks-comingsoon'),
  reopen: document.querySelectorAll('.lite-playbooks-reopen-onboarding').length,
}))
rec('① 空态：方法库网格不在', !empty.grid)
rec('① 空态：coming-soon 诚实标在', empty.comingsoon)
rec('① 空态：回看向导入口恰 1', empty.reopen === 1, `reopen=${empty.reopen}`)

// ② 一键 claim 三亚示例团队 → 满态。
await page.evaluate(async () => { await window.__lite2Store.getState().claimDemoTeam() })
await page.waitForFunction(
  () => (window.__lite2Store.getState().rawTeam?.playbooks?.length ?? 0) > 0,
  undefined, { timeout: 30000 },
)
await page.evaluate(() => window.__lite2Store.getState().goScreen('playbooks'))
await page.waitForTimeout(400)

const full = await page.evaluate(() => {
  const qq = (s) => [...document.querySelectorAll(s)]
  const cards = qq('.lite-playbooks-card')
  const titles = cards.map((c) => c.querySelector('.lite-playbooks-card-title')?.textContent?.trim() || '')
  const tagsByTitle = {}
  for (const c of cards) {
    const title = c.querySelector('.lite-playbooks-card-title')?.textContent?.trim() || ''
    tagsByTitle[title] = qq('.lite-playbooks-card-tag').length
      ? [...c.querySelectorAll('.lite-playbooks-card-tag')].map((t) => t.textContent.trim())
      : []
  }
  const rects = cards.slice(0, 3).map((c) => {
    const r = c.getBoundingClientRect()
    return { top: Math.round(r.top), left: Math.round(r.left) }
  })
  const icon = cards[0]?.querySelector('.lite-playbooks-card-icon')
  const iconW = icon ? Math.round(icon.getBoundingClientRect().width) : 0
  const iconH = icon ? Math.round(icon.getBoundingClientRect().height) : 0
  return {
    grid: !!document.querySelector('.lite-playbooks-grid'),
    gridDisplay: document.querySelector('.lite-playbooks-grid')
      ? getComputedStyle(document.querySelector('.lite-playbooks-grid')).display : null,
    count: cards.length,
    titles,
    tagsByTitle,
    cardTag: cards[0]?.tagName || '',
    buttonsInGrid: qq('.lite-playbooks-grid button').length,
    rects,
    iconW,
    iconH,
  }
})

rec('② 满态：方法库网格在 + display:grid', full.grid && full.gridDisplay === 'grid', `display=${full.gridDisplay}`)
rec('② 满态：恰 5 张方法卡', full.count === 5, `cards=${full.count}`)
const missing = METHOD_TITLES.filter((t) => !full.titles.includes(t))
rec('② 满态：5 卡标题与 SOP 逐字对上', missing.length === 0, `missing=${JSON.stringify(missing)} 实到=${JSON.stringify(full.titles)}`)
rec('② 满态：「升级与红线判定」标签逐字对上',
  JSON.stringify(full.tagsByTitle['升级与红线判定']) === JSON.stringify(TAGS_UPGRADE),
  `实到=${JSON.stringify(full.tagsByTitle['升级与红线判定'])}`)
rec('② 满态：「新人爬坡期公平判断」标签逐字对上',
  JSON.stringify(full.tagsByTitle['新人爬坡期公平判断']) === JSON.stringify(TAGS_NEWCOMER),
  `实到=${JSON.stringify(full.tagsByTitle['新人爬坡期公平判断'])}`)

// ③ 2 列关系几何：前 2 卡同顶、第 3 卡换行且回到首列。
const [c0, c1, c2] = full.rects
rec('③ 2 列几何（前 2 同顶 + 第 3 换行回首列）',
  c0 && c1 && c2 && c0.top === c1.top && c2.top > c0.top && Math.abs(c2.left - c0.left) <= 1,
  `rects=${JSON.stringify(full.rects)}`)

// ④ 非交互 article + 方形图标 ~40px。
rec('④ 方法卡是非交互 article（非 button）', full.cardTag === 'ARTICLE', `tag=${full.cardTag}`)
rec('④ 网格内零 button（button-family 天然免除）', full.buttonsInGrid === 0, `buttons=${full.buttonsInGrid}`)
rec('④ 方形渐变图标 ~40×40', Math.abs(full.iconW - 40) <= 1 && Math.abs(full.iconH - 40) <= 1, `icon=${full.iconW}×${full.iconH}`)

// ⑤ 全程零 console error / pageerror。
rec('⑤ 全程零 console error / pageerror', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '))

await browser.close()
const fail = R.filter((r) => !r.ok)
console.log(`\nplaybooks-08: ${R.length - fail.length}/${R.length} pass`)
if (fail.length) {
  console.log('FAILED:', fail.map((f) => f.n).join(' · '))
  process.exit(1)
}
