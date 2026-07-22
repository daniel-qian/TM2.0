// rich-align-0722 · issue 01+02 · e2e 探针 —— 富字段（进度/风险/里程碑）走真管道 + absent≠none。
//
// F19：本战役新探针一律落 .issues/rich-align-0722/verify-*.mjs（tracked，不入 run-battery roster）。
//
// 证的是「文档→抽取→payload→渲染」整条链，且分两个世界：
//   WITH   ：mini md 写了 `进度：58%` + `风险：高/雨季无备选场地`
//            → payload 带 progress/risk 键 → projects 屏渲染进度条 + 高风险徽章 → 详情浮层有环形 + 风险行
//   WITHOUT：mini md 一个富字段都没写
//            → payload 两键均缺席（不是 0/空）→ projects 屏不画进度条/风险徽章、改说「文档未提及」
//            → 详情浮层无环形无风险行
//
// 前置：mock 8137（heuristic）+ preview 5173（v02 入口带参）。
//   VERIFY_BASE=http://localhost:5173 node .issues/rich-align-0722/verify-rich-fields-01.mjs
import { chromium } from 'playwright'

const UI = process.env.VERIFY_BASE || 'http://localhost:5173'
const R = []
const rec = (n, ok, d) => { R.push({ n, ok }); console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${n}${d ? ' — ' + d : ''}`) }

const WITH = ['# 婚宴项目', '负责人：小王', '状态：进行中', '进度：58%', '风险：高/雨季无备选场地',
  '里程碑：', '- 场地确认（已完成）', '- 布置施工（进行中）', '- 验收交付（未开始）', ''].join('\n')
const WITHOUT = ['# 平静项目', '负责人：小张', '状态：进行中', '本周稳步推进，无异常。', ''].join('\n')

async function uploadAndRead(text) {
  const browser = await chromium.launch({ headless: true })
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const page = await ctx.newPage()
  const errs = []
  page.on('pageerror', (e) => errs.push(e.message))
  await page.goto(`${UI}/?v=2&mode=live&look=aurora&lang=zh`, { waitUntil: 'networkidle' })
  if (await page.locator('.lite-onboard').count()) { await page.keyboard.press('Escape'); await page.waitForTimeout(600) }

  await page.evaluate(async (t) => {
    await window.__lite2Store.getState().uploadFiles([new File([t], 'p.md', { type: 'text/markdown' })])
  }, text)
  await page.waitForFunction(
    () => ['ready', 'error'].includes(window.__lite2Store.getState().ingestStatus),
    undefined, { timeout: 30000 },
  )

  // 判据吃 raw payload 键（不吃渲染文案）：'progress' in p / 'risk' in p 分辨「缺席」与「写了 0/空」。
  const payload = await page.evaluate(() => {
    const raw = window.__lite2Store.getState().rawTeam
    const p = (raw && raw.projects && raw.projects[0]) || null
    if (!p) return null
    return { id: p.id, title: p.title, hasProgress: 'progress' in p, progress: p.progress,
      hasRisk: 'risk' in p, risk: p.risk || null,
      hasMilestones: 'milestones' in p, milestones: p.milestones || null }
  })

  await page.evaluate(() => window.__lite2Store.getState().goScreen('projects'))
  await page.waitForTimeout(500)
  const dom = await page.evaluate(() => ({
    riskBadges: document.querySelectorAll('.lite2-shell .lite-project-card .lite-project-risk').length,
    riskHigh: document.querySelectorAll('.lite2-shell .lite-project-card .lite-project-risk.risk-high').length,
    progressFills: document.querySelectorAll('.lite2-shell .lite-project-card .lite-project-progress-fill').length,
    milestones: document.querySelectorAll('.lite2-shell .lite-project-card .lite-project-milestone').length,
    milestoneDone: document.querySelectorAll('.lite2-shell .lite-project-card .lite-project-milestone.ms-done').length,
    bodyHasUnknown: /文档未提及/.test(document.body.innerText),
    zeroPercent: /(^|[^0-9])0\s*%/.test(document.body.innerText),
  }))

  let overlay = { rings: 0, riskRows: 0, milestoneLists: 0, milestoneItems: 0, segs: 0 }
  if (payload) {
    await page.evaluate((id) => window.__lite2Store.getState().openDetail('project', id), payload.id)
    await page.waitForTimeout(500)
    overlay = await page.evaluate(() => ({
      rings: document.querySelectorAll('.lite-detail-card .lite-project-ring').length,
      riskRows: document.querySelectorAll('.lite-detail-card .lite-project-risk').length,
      milestoneLists: document.querySelectorAll('.lite-detail-card .lite-detail-milestone-list').length,
      milestoneItems: document.querySelectorAll('.lite-detail-card .lite-detail-milestone-list li').length,
      segs: document.querySelectorAll('.lite-detail-card .lite-detail-milestone-seg').length,
    }))
  }

  await ctx.close()
  await browser.close()
  return { payload, dom, overlay, errs }
}

// ── WITH 世界 ────────────────────────────────────────────────────────────────
console.log('\n═══ WITH（写了进度+风险）═══')
const w = await uploadAndRead(WITH)
console.log(`         payload ${JSON.stringify(w.payload)}`)
console.log(`         dom ${JSON.stringify(w.dom)} · overlay ${JSON.stringify(w.overlay)}`)
rec('WITH · payload 带 progress=58', !!w.payload && w.payload.hasProgress && w.payload.progress === 58,
  w.payload ? String(w.payload.progress) : '(无项目)')
rec('WITH · payload 带 risk{level:high, reason:雨季无备选场地}',
  !!w.payload && w.payload.hasRisk && w.payload.risk && w.payload.risk.level === 'high'
    && w.payload.risk.reason === '雨季无备选场地',
  w.payload ? JSON.stringify(w.payload.risk) : '(无项目)')
rec('WITH · projects 屏渲染高风险徽章 + 进度条', w.dom.riskHigh === 1 && w.dom.progressFills === 1,
  JSON.stringify(w.dom))
rec('WITH · payload 带 milestones（3 项，含 done/active/upcoming）',
  !!w.payload && w.payload.hasMilestones && Array.isArray(w.payload.milestones)
    && w.payload.milestones.length === 3
    && w.payload.milestones.map((m) => m.status).join(',') === 'done,active,upcoming',
  w.payload ? JSON.stringify(w.payload.milestones) : '(无项目)')
rec('WITH · projects 屏渲染 3 个里程碑圆点串（含 1 个 done）',
  w.dom.milestones === 3 && w.dom.milestoneDone === 1, `chips ${w.dom.milestones}/done ${w.dom.milestoneDone}`)
rec('WITH · 详情浮层有环形进度 + 风险行 + 里程碑清单(3行)+分段条(3段)',
  w.overlay.rings === 1 && w.overlay.riskRows === 1 && w.overlay.milestoneItems === 3
    && w.overlay.segs === 3, JSON.stringify(w.overlay))
rec('WITH · 无 pageerror', w.errs.length === 0, w.errs.slice(0, 2).join(' | ') || '0 条')

// ── WITHOUT 世界 ─────────────────────────────────────────────────────────────
console.log('\n═══ WITHOUT（一个富字段都没写）═══')
const n = await uploadAndRead(WITHOUT)
console.log(`         payload ${JSON.stringify(n.payload)}`)
console.log(`         dom ${JSON.stringify(n.dom)} · overlay ${JSON.stringify(n.overlay)}`)
rec('WITHOUT · payload 不带 progress 键（缺席≠0）', !!n.payload && !n.payload.hasProgress,
  n.payload ? `hasProgress=${n.payload.hasProgress}` : '(无项目)')
rec('WITHOUT · payload 不带 risk 键（缺席≠none）', !!n.payload && !n.payload.hasRisk,
  n.payload ? `hasRisk=${n.payload.hasRisk}` : '(无项目)')
rec('WITHOUT · payload 不带 milestones 键（缺席≠空展示）', !!n.payload && !n.payload.hasMilestones,
  n.payload ? `hasMilestones=${n.payload.hasMilestones}` : '(无项目)')
rec('WITHOUT · projects 屏不画风险徽章 + 不画里程碑串',
  n.dom.riskBadges === 0 && n.dom.milestones === 0, JSON.stringify(n.dom))
rec('WITHOUT · projects 屏不画进度条、改说「文档未提及」、绝不吐 0%',
  n.dom.progressFills === 0 && n.dom.bodyHasUnknown && !n.dom.zeroPercent, JSON.stringify(n.dom))
rec('WITHOUT · 详情浮层无环形无风险行无里程碑清单',
  n.overlay.rings === 0 && n.overlay.riskRows === 0 && n.overlay.milestoneItems === 0,
  JSON.stringify(n.overlay))
rec('WITHOUT · 无 pageerror', n.errs.length === 0, n.errs.slice(0, 2).join(' | ') || '0 条')

const pass = R.filter((r) => r.ok).length
const fail = R.length - pass
console.log(`\n═══ 富字段 e2e（进度/风险 · absent≠none）：${pass} PASS · ${fail} FAIL ═══`)
process.exit(fail ? 1 : 0)
