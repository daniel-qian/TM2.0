// rich-align-0722/04 · team 目录形态 e2e 探针（两形态 + 两世界情绪 chip）。
//
// 覆盖 issue-04 Acceptance 的 e2e 行：
//   ① 空态 = 上传主位（.upload-input 在、目录 wrap 不在）。
//   ② uploadFiles 喂 16 人花名册 → 目录形态（组别 chip 行 + 全部 chip + 3 列网格 + 上传部件仍在）。
//   ③ 3 列几何 = 关系断言（前 3 张卡顶同行、第 4 张换行）——不反向抄构建像素。
//   ④ 点组别 chip → 网格只剩该组（计数与花名册部门分布对得上）。
//   ⑤ 关世界：情绪 chip 行不渲染 + 全壳「如常/偏紧/吃紧/steady/stretched/strained」零出现。
//   ⑥ 开世界（注入 scoringEnabled 团队——04 只改目录渲染分支，后端投影由 03 门/pytest 保）：
//      情绪 chip 行渲染、挂「按本人自述筛选」口径角标、情绪 chip 无 count 徽章（组别 chip 有）、
//      情绪词只在 [data-metric-source] 锚点/chip label 内、点情绪 chip 真过滤、结果无排序（保序）。
//
// 🔴 离线：吃 mock 三件套后端（AVERY_BRAIN=mock）。绝不碰 minimax。
//   VERIFY_BASE=http://localhost:5173 node .issues/rich-align-0722/verify-team-directory-04.mjs
import { chromium } from 'playwright'

const UI = process.env.VERIFY_BASE || 'http://localhost:5173'
const R = []
const rec = (n, ok, d) => {
  R.push({ n, ok })
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${n}${d ? ' — ' + d : ''}`)
}

// 16 人花名册：3 部门（前厅部 6 / 客房部 5 / 餐饮部 5）——组别 chip 计数可精确断言。
// 🔴 姓名必须纯 Han 无数字（extract._han_name_ok 拒非 Han token）；跨行逐字唯一（防 CJK 聚卡）。
const DEPTS = [
  ['前厅部', ['陈静', '周敏', '林涛', '黄磊', '吴超', '郑爽']],
  ['客房部', ['孙浩', '马丽', '朱峰', '胡军', '郭敏']],
  ['餐饮部', ['何强', '高翔', '罗兰', '邓超', '曾莉']],
]
const rosterRows = []
let n = 0
for (const [dept, names] of DEPTS) {
  for (const name of names) {
    n++
    rosterRows.push(`${name} | 主管 | ${dept} | ${1 + (n % 5)} 年 | 岗位职责${n}`)
  }
}
const ROSTER = ['# 三海湾酒店 · 员工花名册', '', '姓名 | 职位 | 部门 | 司龄 | 负责', ...rosterRows, ''].join('\n')
const WEEKLY = [
  '# 三海湾酒店 · 项目周报',
  '',
  '## 项目：草坪婚宴旺季档',
  '负责人：陈静',
  '状态：进行中',
  '进度：60%',
  '',
].join('\n')
const MOOD_VOCAB = ['如常', '偏紧', '吃紧', 'steady', 'stretched', 'strained']

const browser = await chromium.launch({ headless: true })
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
await page.goto(`${UI}/?v=2&mode=live&look=aurora&lang=zh`, { waitUntil: 'networkidle' })
if (await page.locator('.lite-onboard').count()) {
  await page.keyboard.press('Escape')
  await page.waitForTimeout(600)
}
await page.evaluate(() => window.__lite2Store.getState().goScreen('team'))
await page.waitForTimeout(300)

// ① 空态 = 上传主位。
const emptyState = await page.evaluate(() => ({
  upload: !!document.querySelector('.upload-input'),
  directory: !!document.querySelector('.lite-team-directory-wrap'),
}))
rec('① 空态：上传入口在', emptyState.upload)
rec('① 空态：目录形态不在', !emptyState.directory)

// ② 喂种子 → 目录形态。
await page.evaluate(async (docs) => {
  const enc = new TextEncoder()
  const files = docs.map((d) => new File([enc.encode(d.text)], d.name, { type: 'text/markdown' }))
  await window.__lite2Store.getState().uploadFiles(files)
}, [{ name: 'roster.md', text: ROSTER }, { name: 'weekly.md', text: WEEKLY }])
await page.waitForFunction(
  () => ['ready', 'error'].includes(window.__lite2Store.getState().ingestStatus),
  undefined, { timeout: 30000 },
)
await page.evaluate(() => window.__lite2Store.getState().goScreen('team'))
await page.waitForTimeout(400)

const dir = await page.evaluate(() => {
  const q = (s) => document.querySelector(s)
  const qq = (s) => [...document.querySelectorAll(s)]
  const cards = qq('.lite-team-directory .home-person-card')
  const rects = cards.slice(0, 4).map((c) => Math.round(c.getBoundingClientRect().top))
  return {
    wrap: !!q('.lite-team-directory-wrap'),
    filterRow: !!q('.lite-team-filter-row'),
    allChip: qq('.lite-team-filter-chip.is-all').length,
    grid: !!q('.lite-team-directory'),
    gridDisplay: q('.lite-team-directory') ? getComputedStyle(q('.lite-team-directory')).display : null,
    cardCount: cards.length,
    uploadStillThere: !!q('.upload-input'),
    moodRow: !!q('.lite-team-filter-row--mood'),
    rects,
    people: window.__lite2Store.getState().team?.people?.length ?? 0,
  }
})
rec('② 目录 wrap 渲染', dir.wrap)
rec('② 组别筛选 chip 行在', dir.filterRow)
rec('② 全部 chip 恰 1', dir.allChip === 1, `is-all=${dir.allChip}`)
rec('② 3 列网格容器在 + display:grid', dir.grid && dir.gridDisplay === 'grid', `display=${dir.gridDisplay}`)
rec('② 16 张人卡全渲染', dir.cardCount === 16, `cards=${dir.cardCount}/people=${dir.people}`)
rec('② 上传部件降位不卸载', dir.uploadStillThere)
// ③ 3 列关系断言：前 3 张卡顶同行，第 4 张换行（top 更大）。
const [t0, t1, t2, t3] = dir.rects
rec('③ 3 列几何（前 3 同顶 + 第 4 换行）', t0 === t1 && t1 === t2 && t3 > t0, `tops=${JSON.stringify(dir.rects)}`)

// ④ 点组别 chip「前厅部」→ 网格只剩 6。
const groupFiltered = await page.evaluate(() => {
  const chips = [...document.querySelectorAll('.lite-team-filter-row:not(.lite-team-filter-row--mood) .lite-team-filter-chip')]
  const target = chips.find((c) => c.textContent.includes('前厅部'))
  if (!target) return { found: false }
  target.click()
  return { found: true }
})
await page.waitForTimeout(200)
const afterGroup = await page.evaluate(() =>
  document.querySelectorAll('.lite-team-directory .home-person-card').length,
)
rec('④ 点「前厅部」chip → 网格剩 6', groupFiltered.found && afterGroup === 6, `剩 ${afterGroup}`)
// 复位到「全部」。
await page.evaluate(() => {
  const all = document.querySelector('.lite-team-filter-chip.is-all')
  if (all) all.click()
})
await page.waitForTimeout(150)

// ⑤ 关世界：情绪行不渲染 + 全壳情绪词零出现。
const offWorld = await page.evaluate((vocab) => {
  const shellText = document.querySelector('.lite2-shell')?.innerText || ''
  const hits = vocab.filter((w) => shellText.includes(w))
  return {
    moodRow: !!document.querySelector('.lite-team-filter-row--mood'),
    moodHits: hits,
    scoringMarker: document.querySelector('.lite2-shell')?.getAttribute('data-scoring-enabled'),
  }
}, MOOD_VOCAB)
rec('⑤ 关世界：情绪 chip 行不渲染', !offWorld.moodRow, `marker=${offWorld.scoringMarker}`)
rec('⑤ 关世界：全壳情绪词零出现', offWorld.moodHits.length === 0, `hits=${JSON.stringify(offWorld.moodHits)}`)

// ⑥ 开世界：注入 scoringEnabled 团队（04 只改目录渲染；后端投影由 03 门/pytest 保）。
await page.evaluate(() => {
  const st = window.__lite2Store.getState()
  const team = st.team
  const moods = ['steady', 'stretched', 'strained']
  const people = team.people.map((p, i) =>
    i < 3
      ? { ...p, selfReport: { mood: { value: moods[i], caliber: 'self', source: '本周周报.md:12' } } }
      : p,
  )
  window.__lite2Store.setState({ team: { ...team, scoringEnabled: true, people } })
})
await page.waitForTimeout(250)
const onWorld = await page.evaluate(() => {
  const q = (s) => document.querySelector(s)
  const qq = (s) => [...document.querySelectorAll(s)]
  const moodRow = q('.lite-team-filter-row--mood')
  const moodChips = qq('.lite-team-filter-chip--mood')
  const moodChipHasCount = moodChips.some((c) => c.querySelector('.lite-team-filter-chip-count'))
  const groupChipHasCount = qq('.lite-team-filter-row:not(.lite-team-filter-row--mood) .lite-team-filter-chip')
    .some((c) => c.querySelector('.lite-team-filter-chip-count'))
  // 情绪词在人卡上只许出现在 [data-metric-source] 锚点内。
  const cards = qq('.lite-team-directory .home-person-card')
  const vocab = /如常|偏紧|吃紧|steady|stretched|strained/i
  let strayOnCard = false
  for (const c of cards) {
    const clone = c.cloneNode(true)
    clone.querySelectorAll('[data-metric-source]').forEach((a) => a.remove())
    if (vocab.test(clone.innerText || '')) strayOnCard = true
  }
  return {
    moodRow: !!moodRow,
    caption: q('.lite-team-mood-caption')?.innerText?.trim() || '',
    moodChipCount: moodChips.length,
    moodChipHasCount,
    groupChipHasCount,
    strayOnCard,
    anchors: qq('.lite-team-directory .home-person-card [data-metric-source]').length,
  }
})
rec('⑥ 开世界：情绪 chip 行渲染', onWorld.moodRow)
rec('⑥ 开世界：口径角标「按本人自述筛选」', onWorld.caption === '按本人自述筛选', `caption="${onWorld.caption}"`)
rec('⑥ 开世界：情绪 chip 无 count 徽章', !onWorld.moodChipHasCount)
rec('⑥ 开世界：组别 chip 有 count 徽章（对照）', onWorld.groupChipHasCount)
rec('⑥ 开世界：情绪词只在 metric-source 锚点内', !onWorld.strayOnCard && onWorld.anchors >= 3, `anchors=${onWorld.anchors}`)

// 点情绪 chip「偏紧」(stretched) → 网格剩 1。
const moodFiltered = await page.evaluate(() => {
  const chips = [...document.querySelectorAll('.lite-team-filter-chip--mood')]
  const target = chips.find((c) => c.textContent.includes('偏紧'))
  if (!target) return { found: false }
  target.click()
  return { found: true }
})
await page.waitForTimeout(200)
const afterMood = await page.evaluate(() =>
  document.querySelectorAll('.lite-team-directory .home-person-card').length,
)
rec('⑥ 开世界：点「偏紧」情绪 chip → 网格剩 1', moodFiltered.found && afterMood === 1, `剩 ${afterMood}`)

await browser.close()
const fail = R.filter((r) => !r.ok)
console.log(`\nteam-directory-04: ${R.length - fail.length}/${R.length} pass`)
if (fail.length) {
  console.log('FAILED:', fail.map((f) => f.n).join(' · '))
  process.exit(1)
}
