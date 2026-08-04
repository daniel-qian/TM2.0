// 双栏对照板（cr-align 视觉战役棒0 · 2026-07-21）。
//
// 两个 app 同视口逐屏截图成对，生成一页 index.html 双栏板子——供 Danny 每棒过目
// 「对齐到什么程度了」。刻意不做自动像素 diff：异栈异内容，diff 是纯噪音；
// 板子是给人眼的。我方走真 uploadFiles 抽取路径喂种子（花名册+周报 → 2人/1项目/1卡点
// +1决策，seedAvery 同 verify-cr-alignment 配方；旧的 ?transport=stub 已不灌数据），
// 她方是酒店 demo 数据——比的是设计语言，不是内容。
//
// 配对表（cr 路由 ↔ 我方屏）：home↔/ · team↔/people · projects↔/projects ·
// room↔/nexus · followups↔/checklist · playbooks↔/playbooks · closerlook↔/gaps ·
// notes/vision 无对面（单栏出现）。
//
//   VERIFY_BASE=http://localhost:5173 CR_BASE=http://localhost:3100 \
//     node eval-harness/tools/capture-align-board.mjs
import { chromium } from 'playwright'
import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const UI = process.env.VERIFY_BASE || 'http://localhost:5173'
const CR = process.env.CR_BASE || 'http://localhost:3100'
const HERE = dirname(fileURLToPath(import.meta.url))
const DATE = new Date().toISOString().slice(0, 10)
const OUT = join(HERE, '..', 'reports', 'align-board', DATE)
mkdirSync(OUT, { recursive: true })

const PAIRS = [
  { screen: 'home', cr: '/' },
  { screen: 'team', cr: '/people' },
  { screen: 'projects', cr: '/projects' },
  { screen: 'room', cr: '/nexus' },
  { screen: 'followups', cr: '/checklist' },
  { screen: 'playbooks', cr: '/playbooks' },
  { screen: 'closerlook', cr: '/gaps' },
  { screen: 'notes', cr: null },
  { screen: 'vision', cr: null },
]
const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 375, height: 812 },
]

// 我方世界搭建（与 verify-cr-alignment 同配方：花名册+周报喂出 2人/1项目/1卡点，再注入
// 一条决策世界）。⚠️ 2026-07-22 实测 transport=stub 已不灌数据（contextId 恒 null、
// team null，六屏全空态），板子照出来是「空 averylite vs 满 cr-live」的假对照——对齐
// 骨架/网格无从比起。改走真 uploadFiles 抽取路径，板子才照得出「有数据的形状」。
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
      '阻塞：验收口径未确认，法务尚未回复。', '',
      '本周完成登录页联调，下周进入验收。', '',
    ].join('\n'),
  },
]

async function seedAvery(page) {
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
  // 决策世界（供主页「今天要决策」卡；同 verify-home-skeleton / verify-cr-alignment 注入配方）
  await page.evaluate(() => {
    const decision = {
      subject_type: 'project', subject_id: 'p-gate-1', subject_title: '客户门户改版',
      grade: 'high_risk', severity: 3, rule_grade: 'high_risk', rule_severity: 3,
      reason: '', reason_source: 'rule',
      escalated: false, escalation_reason: null, unknown_fields: [], unparsed_fields: [],
      matched_rules: [{ rule_id: 'R-OVERDUE', grade: 'high_risk', severity: 3, params: {}, evidence: ['原文：预计 7 月 10 日交付'] }],
      owner_name: '陈静',
    }
    const st = window.__lite2Store.getState()
    const raw = st.rawTeam || { people: [], projects: [], decisions: [] }
    window.__lite2Store.setState({ rawTeam: { ...raw, decisions: [decision] } })
  })
}

const browser = await chromium.launch({ headless: true })

for (const vp of VIEWPORTS) {
  // 我方（真抽取数据 + aurora）
  const ours = await (await browser.newContext({ viewport: { width: vp.width, height: vp.height }, reducedMotion: 'reduce' })).newPage()
  await ours.goto(`${UI}/?v=2&mode=live&look=aurora&lang=zh`, { waitUntil: 'networkidle' })
  await seedAvery(ours)
  for (const { screen } of PAIRS) {
    await ours.evaluate((s) => window.__lite2Store.getState().goScreen(s), screen)
    await ours.waitForTimeout(500)
    await ours.screenshot({ path: join(OUT, `avery-${screen}-${vp.name}.png`) })
  }
  await ours.close()

  // 她方
  const cr = await (await browser.newContext({ viewport: { width: vp.width, height: vp.height }, reducedMotion: 'reduce' })).newPage()
  for (const { screen, cr: route } of PAIRS) {
    if (!route) continue
    await cr.goto(`${CR}${route}`, { waitUntil: 'networkidle', timeout: 60000 })
    await cr.waitForTimeout(500)
    await cr.screenshot({ path: join(OUT, `cr-${screen}-${vp.name}.png`) })
  }
  await cr.close()
  console.log(`  ${vp.name} 拍毕`)
}
await browser.close()

const html = ['<!doctype html><meta charset="utf-8"><title>cr-align 对照板 ' + DATE + '</title>',
  '<style>body{font-family:system-ui;margin:20px;background:#f5f7fa}h2{margin:28px 0 8px}h3{margin:12px 0 4px;color:#556}.pair{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:8px}img{width:100%;border:1px solid #ccd;border-radius:6px;background:#fff}figcaption{font-size:12px;color:#667;margin-top:2px}</style>',
  `<h1>cr-align 对照板 · ${DATE}</h1><p>左=我方 averylite（aurora·真抽取数据 2人/1项目/1卡点+1决策）· 右=合伙人 cr-live（酒店 demo）。比设计语言不比内容。</p>`]
for (const vp of VIEWPORTS) {
  html.push(`<h2>${vp.name}（${vp.width}×${vp.height}）</h2>`)
  for (const { screen, cr: route } of PAIRS) {
    html.push(`<h3>${screen}${route ? ` ↔ cr ${route}` : '（无对面）'}</h3><div class="pair">`)
    html.push(`<figure><img src="avery-${screen}-${vp.name}.png"><figcaption>averylite · ${screen}</figcaption></figure>`)
    html.push(route ? `<figure><img src="cr-${screen}-${vp.name}.png"><figcaption>cr-live · ${route}</figcaption></figure>` : '<div></div>')
    html.push('</div>')
  }
}
writeFileSync(join(OUT, 'index.html'), html.join('\n'))
console.log(`\n对照板 → ${join(OUT, 'index.html')}`)
