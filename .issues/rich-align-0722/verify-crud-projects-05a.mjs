// rich-align-0722/05a · 项目手编 CRUD e2e 探针（前端半，stick 10）。
// 走真 UI → 真 HTTP 写端点 → 真后端（in-memory registry），不是纯 DOM 摆弄——add/patch/archive/
// restore 全经 store action + transport + service/ingest_api 写端点闭环。
//
// 覆盖 issue-05 Acceptance 的 e2e 行：
//   T1 基线：种子 = 1 篇周报 → 1 张文档项目卡；页头「添加项目」primary 在；文档卡无「手动编辑」角标。
//   T2 添加：页头 primary → 内联表单 → POST → 卡即时入网格 + 卡挂「手动编辑」出处角标 + 计数 +1。
//   T3 出处（详情逐字段）：开新卡详情 → title/负责人/状态/截止/进度 各挂「手动编辑」角标。
//   T4 编辑 + 手编赢（逐字段 provenance 粒度）：编辑**文档**卡的状态 → 值变 + 状态挂「手动编辑」角标，
//      而标题不挂（PATCH 只发改动键、后端只标该键 → 文档字段仍是 doc 出处）。
//   T5 PATCH 置空 → absent：清空文档卡的进度 → 渲染「文档未提及」(is-unknown)，绝不 0%/空条。
//   T6 归档：详情页脚归档 → 主网格该卡消失 + 折叠区「已归档（1）」在 + 展开见灰化卡。
//   T7 恢复：折叠区恢复键 → 卡回主网格 + 折叠区消失。
//
// 🔴 离线：吃 mock 三件套后端（AVERY_BRAIN=mock）。绝不碰 minimax。A 线独占端口（不撞共享 5173/8137）：
//   VERIFY_BASE=http://localhost:5373 node .issues/rich-align-0722/verify-crud-projects-05a.mjs
//   （前端 dist 已 bake VITE_AVERY_API_BASE=http://127.0.0.1:8337 指向 A 线隔离后端）。
import { chromium } from 'playwright'

const UI = process.env.VERIFY_BASE || 'http://localhost:5173'
const R = []
const rec = (n, ok, d) => {
  R.push({ n, ok })
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${n}${d ? ' — ' + d : ''}`)
}

// 一篇周报 → heuristic 抽出 1 张文档项目卡（含负责人/状态/进度，供 T4/T5 编辑文档字段）。
const WEEKLY = [
  '# 三海湾酒店 · 项目周报',
  '',
  '## 项目：草坪婚宴旺季档',
  '负责人：陈静',
  '状态：进行中',
  '进度：60%',
  '概述：旺季婚宴场地与人力筹备。',
  '',
].join('\n')

const NEW_TITLE = '手动加的迎宾改造'

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

// 种子 → projects 屏。
await page.evaluate(async (docs) => {
  const enc = new TextEncoder()
  const files = docs.map((d) => new File([enc.encode(d.text)], d.name, { type: 'text/markdown' }))
  await window.__lite2Store.getState().uploadFiles(files)
}, [{ name: 'weekly.md', text: WEEKLY }])
await page.waitForFunction(
  () => ['ready', 'error'].includes(window.__lite2Store.getState().ingestStatus),
  undefined,
  { timeout: 30000 },
)
const ingest = await page.evaluate(() => ({
  status: window.__lite2Store.getState().ingestStatus,
  projects: window.__lite2Store.getState().rawTeam?.projects?.length ?? 0,
}))
rec('seed：ingest ready + 至少 1 个文档项目', ingest.status === 'ready' && ingest.projects >= 1,
  `status=${ingest.status} projects=${ingest.projects}`)
await page.evaluate(() => window.__lite2Store.getState().goScreen('projects'))
await page.waitForSelector('.lite-projects-grid .lite-project-card', { timeout: 8000 })

// ── T1 基线 ──
const t1 = await page.evaluate(() => {
  const add = document.querySelector('.lite-projects-add')
  const cards = [...document.querySelectorAll('.lite-projects-grid .lite-project-card')]
  return {
    addBtn: !!add,
    addPrimary: add?.classList.contains('lite-btn--primary') ?? false,
    cards: cards.length,
    docCardManual: cards.some((c) => c.querySelector('.lite-project-provenance')),
  }
})
rec('T1 页头「添加项目」在 + 是 primary', t1.addBtn && t1.addPrimary)
rec('T1 基线 1 张文档项目卡', t1.cards === 1, `cards=${t1.cards}`)
rec('T1 文档卡无「手动编辑」角标（doc 出处不冒充手编）', !t1.docCardManual)

// ── T2 添加 ──
await page.click('.lite-projects-add')
await page.waitForSelector('.lite-project-form', { timeout: 4000 })
await page.locator('.lite-project-form .lite-project-form-input').nth(0).fill(NEW_TITLE) // 标题
await page.locator('.lite-project-form .lite-project-form-input').nth(1).fill('周敏') // 负责人
await page.locator('.lite-project-form .lite-project-form-input').nth(2).selectOption('on-track') // 状态
await page.locator('.lite-project-form .lite-project-form-input').nth(3).fill('2026-09-01') // 截止
await page.locator('.lite-project-form .lite-project-form-input').nth(4).fill('30') // 进度
await page.click('.lite-project-form .lite-project-form-actions .lite-btn--primary')
// 🔴 等**结算态**而非首次出现：提交成功 → onDone 收表单（在 refreshTeam 之后），故表单消失 ⟹ 新卡+出处
// 角标已落定的最终 DOM。等首次出现会读到 React 多步异步 set 的中间帧（卡在、角标未到）。
await page.waitForSelector('.lite-project-form', { state: 'detached', timeout: 8000 })
await page.waitForSelector('.lite-projects-grid .lite-project-card .lite-project-provenance', { timeout: 8000 })
const t2 = await page.evaluate((title) => {
  const cards = [...document.querySelectorAll('.lite-projects-grid .lite-project-card')]
  const added = cards.find((c) => c.textContent.includes(title))
  return {
    cards: cards.length,
    addedManual: !!added?.querySelector('.lite-project-provenance'),
    formClosed: !document.querySelector('.lite-project-form'),
    backendProjects: window.__lite2Store.getState().rawTeam?.projects?.length ?? 0,
  }
}, NEW_TITLE)
rec('T2 添加后网格 2 张卡', t2.cards === 2, `cards=${t2.cards}`)
rec('T2 新卡挂「手动编辑」出处角标', t2.addedManual)
rec('T2 提交成功后表单收起', t2.formClosed)
rec('T2 后端真落库（rawTeam.projects=2）', t2.backendProjects === 2, `projects=${t2.backendProjects}`)

// ── T3 出处逐字段（详情浮层）──
await page.locator('.lite-projects-grid .lite-project-card', { hasText: NEW_TITLE }).first().click()
await page.waitForSelector('.lite-detail-card', { timeout: 4000 })
const t3 = await page.evaluate(() => {
  const card = document.querySelector('.lite-detail-card')
  const provCount = card.querySelectorAll('.lite-detail-provenance').length
  const titleHasBadge = !!card.querySelector('.lite-detail-head h2 .lite-detail-provenance')
  return { provCount, titleHasBadge }
})
// title + 负责人 + 状态 + 截止 + 进度 = 5 个手编字段角标（summary 未填→无该行）。
rec('T3 详情逐字段「手动编辑」角标 ≥5', t3.provCount >= 5, `count=${t3.provCount}`)
rec('T3 标题行挂「手动编辑」角标', t3.titleHasBadge)
// 关浮层。
await page.keyboard.press('Escape')
await page.waitForTimeout(400)

// ── T4 编辑文档卡状态（手编赢 + provenance 粒度）──
await page.locator('.lite-projects-grid .lite-project-card', { hasText: '草坪婚宴' }).first().click()
await page.waitForSelector('.lite-detail-card', { timeout: 4000 })
const docTitleBefore = await page.evaluate(
  () => document.querySelector('.lite-detail-card h2')?.textContent?.trim() || '',
)
await page.click('.lite-detail-actions--footer .lite-btn--soft') // 编辑
await page.waitForSelector('.lite-detail-edit', { timeout: 4000 })
await page.locator('.lite-detail-edit .lite-detail-edit-input').nth(2).fill('已受阻') // 状态
await page.click('.lite-detail-edit .lite-btn--primary') // 保存
await page.waitForFunction(() => !document.querySelector('.lite-detail-edit'), undefined, { timeout: 8000 })
await page.waitForTimeout(300)
const t4 = await page.evaluate(() => {
  const card = document.querySelector('.lite-detail-card')
  if (!card) return { gone: true }
  const subtitles = [...card.querySelectorAll('.lite-detail-subtitle')]
  const statusRow = subtitles.find((p) => /状态|Status/.test(p.textContent))
  const statusManual = !!statusRow?.querySelector('.lite-detail-provenance')
  const titleManual = !!card.querySelector('.lite-detail-head h2 .lite-detail-provenance')
  const statusText = statusRow?.textContent || ''
  return { statusManual, titleManual, statusText }
})
rec('T4 编辑文档卡状态 → 状态挂「手动编辑」角标', t4.statusManual, `row="${t4.statusText}"`)
rec('T4 手编赢粒度：标题仍是 doc 出处（不挂角标）', !t4.titleManual, `docTitle="${docTitleBefore}"`)

// ── T5 PATCH 置空进度 → absent ──
await page.click('.lite-detail-actions--footer .lite-btn--soft') // 编辑
await page.waitForSelector('.lite-detail-edit', { timeout: 4000 })
await page.locator('.lite-detail-edit .lite-detail-edit-input').nth(4).fill('') // 进度清空
await page.click('.lite-detail-edit .lite-btn--primary') // 保存
await page.waitForFunction(() => !document.querySelector('.lite-detail-edit'), undefined, { timeout: 8000 })
await page.waitForTimeout(300)
const t5 = await page.evaluate(() => {
  const sec = document.querySelector('.lite-detail-progress-section')
  const unknown = sec?.querySelector('.is-unknown')
  return {
    absent: !!unknown,
    unknownText: unknown?.textContent?.trim() || '',
    noRing: !sec?.querySelector('.lite-project-ring'),
  }
})
rec('T5 清空进度 → 渲染「文档未提及」(absent)', t5.absent && t5.noRing, `text="${t5.unknownText}" ring=${!t5.noRing}`)
await page.keyboard.press('Escape')
await page.waitForTimeout(400)

// ── T6 归档（开新卡详情 → 页脚归档）──
await page.locator('.lite-projects-grid .lite-project-card', { hasText: NEW_TITLE }).first().click()
await page.waitForSelector('.lite-detail-card', { timeout: 4000 })
await page.click('.lite-detail-archive') // 归档
await page.waitForFunction(() => !document.querySelector('.lite-detail-card'), undefined, { timeout: 8000 })
// 等折叠区结算（refreshTeam 后 archivedViews 非空 → toggle 出现）。
await page.waitForSelector('.lite-projects-archived-toggle', { timeout: 8000 })
const t6 = await page.evaluate((title) => {
  const cards = [...document.querySelectorAll('.lite-projects-grid .lite-project-card')]
  const stillInGrid = cards.some((c) => c.textContent.includes(title))
  const toggle = document.querySelector('.lite-projects-archived-toggle')
  return {
    gridCount: cards.length,
    stillInGrid,
    drawer: !!toggle,
    drawerLabel: toggle?.textContent?.trim() || '',
  }
}, NEW_TITLE)
rec('T6 归档后主网格该卡消失（剩 1 张文档卡）', t6.gridCount === 1 && !t6.stillInGrid, `grid=${t6.gridCount}`)
rec('T6 折叠区在 + 计数「已归档（1）」', t6.drawer && /1/.test(t6.drawerLabel), `label="${t6.drawerLabel}"`)

// 展开折叠区 → 灰化卡在（等具体的灰化卡而非仅容器，避开中间帧）。
await page.click('.lite-projects-archived-toggle')
await page.waitForSelector('.lite-projects-archived-grid .lite-project-card.is-archived', { timeout: 6000 })
const t6b = await page.evaluate((title) => {
  const card = document.querySelector('.lite-projects-archived-grid .lite-project-card.is-archived')
  return {
    archivedCard: !!card,
    hasTitle: card?.textContent?.includes(title) ?? false,
    hasRestore: !!card?.querySelector('.lite-project-restore'),
  }
}, NEW_TITLE)
rec('T6 展开：灰化归档卡在 + 是新卡 + 有恢复键', t6b.archivedCard && t6b.hasTitle && t6b.hasRestore)

// ── T7 恢复 ──
await page.click('.lite-projects-archived-grid .lite-project-card.is-archived .lite-project-restore')
// 等结算态：archived_projects 空 → 整个折叠区 section 卸载（refreshTeam 落定的信号），此刻卡已回主网格。
await page.waitForSelector('.lite-projects-archived', { state: 'detached', timeout: 8000 })
await page.waitForSelector('.lite-projects-grid .lite-project-card', { timeout: 6000 })
const t7 = await page.evaluate((title) => {
  const cards = [...document.querySelectorAll('.lite-projects-grid .lite-project-card')]
  return {
    gridCount: cards.length,
    backInGrid: cards.some((c) => c.textContent.includes(title)),
    drawerGone: !document.querySelector('.lite-projects-archived-toggle'),
    archived: window.__lite2Store.getState().rawTeam?.archived_projects?.length ?? 0,
  }
}, NEW_TITLE)
rec('T7 恢复后卡回主网格（2 张）', t7.gridCount === 2 && t7.backInGrid, `grid=${t7.gridCount}`)
rec('T7 折叠区消失（archived_projects 空→键缺席）', t7.drawerGone && t7.archived === 0, `archived=${t7.archived}`)

await browser.close()
const fail = R.filter((r) => !r.ok)
console.log(`\ncrud-projects-05a: ${R.length - fail.length}/${R.length} pass`)
if (fail.length) {
  console.log('FAILED:', fail.map((f) => f.n).join(' · '))
  process.exit(1)
}
