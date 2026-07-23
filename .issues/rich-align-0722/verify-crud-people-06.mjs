// rich-align-0722/06 · 人员手编 CRUD e2e 探针（前端半，stick 11）。走真 UI → 真 HTTP 人员写端点 →
// 真后端（in-memory registry）。add/patch/archive/restore 全经 store action + transport + service 闭环。
//
// 覆盖 issue-06 Acceptance 的 e2e 行：
//   T1 基线：种子 = 花名册 → 目录人卡；页头「添加成员」primary 在。
//   T2 添加：页头 primary → 内联表单（定性字段）→ POST → 卡即时入目录 + 详情逐字段「手动编辑」角标。
//   T3 编辑：改职位 → 值变 + 职位挂「手动编辑」角标（手编赢）。
//   T4 停用/恢复：详情页脚停用 → 目录该卡消失 + 页尾「已停用（1）」折叠区 → 展开灰化卡 → 恢复回目录。
//   T5 🔴 两世界零数字：手编成员卡无任何自述数字锚点（[data-metric-source]）；注入 scoringEnabled=true
//      后**仍无**（无自述数据即 absent 收起，绝不编造）——手编人身数字禁经此通道（后端 422，pytest 已守）。
//
// 🔴 离线：吃 mock 三件套后端（AVERY_BRAIN=mock）。绝不碰 minimax。A 线独占端口：
//   VERIFY_BASE=http://localhost:5373 node .issues/rich-align-0722/verify-crud-people-06.mjs
import { chromium } from 'playwright'

const UI = process.env.VERIFY_BASE || 'http://localhost:5173'
const R = []
const rec = (n, ok, d) => {
  R.push({ n, ok })
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${n}${d ? ' — ' + d : ''}`)
}

// 小花名册 → heuristic 抽出几张文档人卡（纯中文名，无数字）。
const ROSTER = [
  '# 三海湾酒店 · 员工花名册',
  '',
  '姓名 | 职位 | 部门 | 司龄 | 负责',
  '陈静 | 前厅主管 | 前厅部 | 3 年 | 草坪婚宴档',
  '周敏 | 客房主管 | 客房部 | 2 年 | 客房调度',
  '林涛 | 餐饮主管 | 餐饮部 | 4 年 | 宴会厅',
  '',
].join('\n')

const NEW_NAME = '手动加的迎宾员小赵'

const browser = await chromium.launch({ headless: true })
const page = await (await browser.newContext({ viewport: { width: 1440, height: 960 } })).newPage()
page.on('console', (m) => {
  if (m.type() === 'error') console.log('    [console.error]', m.text())
})
await page.goto(`${UI}/?v=2&mode=live&look=aurora&lang=zh`, { waitUntil: 'networkidle' })
if (await page.locator('.lite-onboard').count()) {
  await page.keyboard.press('Escape')
  await page.waitForTimeout(500)
}

await page.evaluate(async (docs) => {
  const enc = new TextEncoder()
  const files = docs.map((d) => new File([enc.encode(d.text)], d.name, { type: 'text/markdown' }))
  await window.__lite2Store.getState().uploadFiles(files)
}, [{ name: 'roster.md', text: ROSTER }])
await page.waitForFunction(
  () => ['ready', 'error'].includes(window.__lite2Store.getState().ingestStatus),
  undefined,
  { timeout: 30000 },
)
const ingest = await page.evaluate(() => ({
  status: window.__lite2Store.getState().ingestStatus,
  people: window.__lite2Store.getState().rawTeam?.people?.length ?? 0,
}))
rec('seed：ingest ready + 至少 1 张文档人卡', ingest.status === 'ready' && ingest.people >= 1,
  `status=${ingest.status} people=${ingest.people}`)
await page.evaluate(() => window.__lite2Store.getState().goScreen('team'))
await page.waitForSelector('.lite-team-directory .home-person-card', { timeout: 8000 })

// ── T1 基线 ──
const t1 = await page.evaluate(() => {
  const add = document.querySelector('.lite-people-add')
  return {
    addBtn: !!add,
    addPrimary: add?.classList.contains('lite-btn--primary') ?? false,
    cards: document.querySelectorAll('.lite-team-directory .home-person-card').length,
  }
})
rec('T1 页头「添加成员」在 + 是 primary', t1.addBtn && t1.addPrimary)
rec('T1 基线有文档人卡', t1.cards >= 1, `cards=${t1.cards}`)

// ── T2 添加 ──
await page.click('.lite-people-add')
await page.waitForSelector('.lite-people-form', { timeout: 4000 })
await page.locator('.lite-people-form .lite-project-form-input').nth(0).fill(NEW_NAME) // 姓名
await page.locator('.lite-people-form .lite-project-form-input').nth(1).fill('迎宾主管') // 职位
await page.locator('.lite-people-form .lite-project-form-input').nth(2).fill('前厅部') // 组别
await page.click('.lite-people-form .lite-project-form-actions .lite-btn--primary')
await page.waitForSelector('.lite-people-form', { state: 'detached', timeout: 8000 })
await page.waitForFunction(
  (name) =>
    [...document.querySelectorAll('.lite-team-directory .home-person-card')].some((c) =>
      c.textContent.includes(name),
    ),
  NEW_NAME,
  { timeout: 8000 },
)
const t2 = await page.evaluate((name) => {
  const cards = [...document.querySelectorAll('.lite-team-directory .home-person-card')]
  return {
    added: cards.some((c) => c.textContent.includes(name)),
    backendPeople: window.__lite2Store.getState().rawTeam?.people?.length ?? 0,
  }
}, NEW_NAME)
rec('T2 添加后新成员入目录网格', t2.added)
rec('T2 后端真落库（rawTeam.people +1）', t2.backendPeople === ingest.people + 1, `people=${t2.backendPeople}`)

// ── T3 出处（详情逐字段）+ 编辑（手编赢）──
await page.locator('.lite-team-directory .home-person-card', { hasText: NEW_NAME }).first().click()
await page.waitForSelector('.lite-detail-card', { timeout: 4000 })
const t3prov = await page.evaluate(
  () => document.querySelector('.lite-detail-card')?.querySelectorAll('.lite-detail-provenance').length ?? 0,
)
// 新加成员：姓名 + 职位 + 组别 各挂手动编辑角标（≥3）。
rec('T3 详情逐字段「手动编辑」角标 ≥3', t3prov >= 3, `count=${t3prov}`)
await page.click('.lite-detail-actions--footer .lite-btn--soft') // 编辑
await page.waitForSelector('.lite-detail-edit', { timeout: 4000 })
await page.locator('.lite-detail-edit .lite-detail-edit-input').nth(1).fill('迎宾部经理') // 职位
await page.click('.lite-detail-edit .lite-btn--primary') // 保存
await page.waitForFunction(() => !document.querySelector('.lite-detail-edit'), undefined, { timeout: 8000 })
await page.waitForTimeout(300)
const t4 = await page.evaluate(() => {
  const card = document.querySelector('.lite-detail-card')
  const sub = card?.querySelector('.lite-detail-subtitle')
  return {
    roleChanged: (sub?.textContent || '').includes('迎宾部经理'),
    roleManual: !!sub?.querySelector('.lite-detail-provenance'),
  }
})
rec('T3 编辑职位 → 值变 + 挂「手动编辑」角标', t4.roleChanged && t4.roleManual, `sub roleChanged=${t4.roleChanged}`)
await page.keyboard.press('Escape')
await page.waitForTimeout(400)

// ── T4 停用 / 恢复 ──
await page.locator('.lite-team-directory .home-person-card', { hasText: NEW_NAME }).first().click()
await page.waitForSelector('.lite-detail-card', { timeout: 4000 })
await page.click('.lite-detail-archive') // 停用
await page.waitForFunction(() => !document.querySelector('.lite-detail-card'), undefined, { timeout: 8000 })
await page.waitForSelector('.lite-people-archived .lite-projects-archived-toggle', { timeout: 8000 })
const t5 = await page.evaluate((name) => {
  const inGrid = [...document.querySelectorAll('.lite-team-directory .home-person-card')].some((c) =>
    c.textContent.includes(name),
  )
  const toggle = document.querySelector('.lite-people-archived .lite-projects-archived-toggle')
  return { inGrid, drawer: !!toggle, label: toggle?.textContent?.trim() || '' }
}, NEW_NAME)
rec('T4 停用后目录该卡消失', !t5.inGrid)
rec('T4 页尾「已停用（1）」折叠区在', t5.drawer && /1/.test(t5.label), `label="${t5.label}"`)
await page.click('.lite-people-archived .lite-projects-archived-toggle')
await page.waitForSelector('.lite-people-archived-grid .lite-people-archived-card', { timeout: 6000 })
const t6 = await page.evaluate((name) => {
  const card = document.querySelector('.lite-people-archived-grid .lite-people-archived-card')
  return { archivedCard: !!card, hasName: card?.textContent?.includes(name) ?? false, hasRestore: !!card?.querySelector('.lite-project-restore') }
}, NEW_NAME)
rec('T4 展开：灰化停用卡在 + 是新成员 + 有恢复键', t6.archivedCard && t6.hasName && t6.hasRestore)
await page.click('.lite-people-archived-grid .lite-people-archived-card .lite-project-restore')
await page.waitForSelector('.lite-people-archived', { state: 'detached', timeout: 8000 })
await page.waitForFunction(
  (name) =>
    [...document.querySelectorAll('.lite-team-directory .home-person-card')].some((c) =>
      c.textContent.includes(name),
    ),
  NEW_NAME,
  { timeout: 8000 },
)
rec('T4 恢复后卡回目录网格', true)

// ── T5 🔴 两世界零数字（手编成员无自述数字，开关开也 absent 不编造）──
const t7 = await page.evaluate((name) => {
  const card = [...document.querySelectorAll('.lite-team-directory .home-person-card')].find((c) =>
    c.textContent.includes(name),
  )
  return {
    offAnchors: card ? card.querySelectorAll('[data-metric-source]').length : -1,
    offHasDigit: card ? /\d/.test((card.querySelector('.home-person-read')?.textContent || '')) : false,
  }
}, NEW_NAME)
rec('T5 关世界：手编成员卡零自述锚点', t7.offAnchors === 0, `anchors=${t7.offAnchors}`)
// 注入开关开 → 手编成员**仍**无自述（无数据即 absent 收起）。
await page.evaluate(() => {
  const st = window.__lite2Store.getState()
  window.__lite2Store.setState({ team: { ...st.team, scoringEnabled: true } })
})
await page.waitForTimeout(250)
const t8 = await page.evaluate((name) => {
  const card = [...document.querySelectorAll('.lite-team-directory .home-person-card')].find((c) =>
    c.textContent.includes(name),
  )
  return { onAnchors: card ? card.querySelectorAll('[data-metric-source]').length : -1 }
}, NEW_NAME)
rec('T5 开世界：手编成员无自述数据 → 仍 absent（零锚点，不编造）', t8.onAnchors === 0, `anchors=${t8.onAnchors}`)

await browser.close()
const fail = R.filter((r) => !r.ok)
console.log(`\ncrud-people-06: ${R.length - fail.length}/${R.length} pass`)
if (fail.length) {
  console.log('FAILED:', fail.map((f) => f.n).join(' · '))
  process.exit(1)
}
