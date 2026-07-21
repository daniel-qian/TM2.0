// 双栏对照板（cr-align 视觉战役棒0 · 2026-07-21）。
//
// 两个 app 同视口逐屏截图成对，生成一页 index.html 双栏板子——供 Danny 每棒过目
// 「对齐到什么程度了」。刻意不做自动像素 diff：异栈异内容，diff 是纯噪音；
// 板子是给人眼的。我方数据用 ?transport=stub（16 人固定团队，确定性），
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

const browser = await chromium.launch({ headless: true })

for (const vp of VIEWPORTS) {
  // 我方（stub 数据 + aurora）
  const ours = await (await browser.newContext({ viewport: { width: vp.width, height: vp.height }, reducedMotion: 'reduce' })).newPage()
  await ours.goto(`${UI}/?v=2&mode=live&look=aurora&lang=zh&transport=stub`, { waitUntil: 'networkidle' })
  if (await ours.locator('.lite-onboard').count()) {
    await ours.keyboard.press('Escape')
    await ours.waitForTimeout(600)
  }
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
  `<h1>cr-align 对照板 · ${DATE}</h1><p>左=我方 averylite（aurora·stub 数据）· 右=合伙人 cr-live（酒店 demo）。比设计语言不比内容。</p>`]
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
