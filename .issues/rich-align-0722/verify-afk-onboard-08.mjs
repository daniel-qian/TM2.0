// rich-align-0722/08 · AFK live-frontend-gate 相位跑器（onboardPersist + playbooksEmpty）。
//
// 此前这两个相位只活在 scripts/gates/live-frontend-gate.snippet.js + live-frontend-gate.md 手册协议
// （无独立 tool）。08 把方法卡满态网格加进 PlaybooksScreen——本跑器证明它不回归空态 onboarding
// 槽位（data-playbook-id + slot-tag）与诚实空态：
//   ① assertOnboardPersist：真走向导（上传 roster.csv，非 SOP → 无 playbooks，走空态槽位分支）→
//      改默认勾选 → done → finish → **真 reload** → 向导不重弹 + Playbooks 屏勾选槽位 id 集合==所选、
//      每槽带 slot-tag。
//   ② assertPlaybooksEmpty：干净 stub 世界（无 SOP/无勾选）→ 诚实空态 + coming-soon + ≥1 回落槽位 +
//      零 story 名词。
// 🔴 离线：吃 mock 三件套后端（AVERY_BRAIN=mock）+ demo seed。绝不碰 minimax。从 /d/avery 跑。
//   VERIFY_BASE=http://localhost:5173 node .issues/rich-align-0722/verify-afk-onboard-08.mjs
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const UI = process.env.VERIFY_BASE || 'http://localhost:5173'
const HERE = dirname(fileURLToPath(import.meta.url))
const SNIPPET = readFileSync(join(HERE, '..', '..', 'scripts', 'gates', 'live-frontend-gate.snippet.js'), 'utf8')
const R = []
const rec = (n, ok, d) => { R.push({ n, ok }); console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${n}${d ? ' — ' + d : ''}`) }

const browser = await chromium.launch({ headless: true })

// ── ① assertOnboardPersist ──
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const page = await ctx.newPage()
  await page.goto(`${UI}/?v=2&mode=live&lang=en`, { waitUntil: 'networkidle' })
  await page.addScriptTag({ content: SNIPPET })
  const walk = await page.evaluate(() => window.__seedGate.onboardWalkthrough())
  await page.reload({ waitUntil: 'networkidle' })
  await page.addScriptTag({ content: SNIPPET })
  const out = await page.evaluate((w) => window.__seedGate.assertOnboardPersist(w), walk)
  rec('assertOnboardPersist', out.pass,
    `wizardStaysAway=${out.wizardStaysAway} exactMatch=${out.exactMatch} allTagged=${out.allTagged} slots=${JSON.stringify(out.slotIds)} chosen=${JSON.stringify(walk.chosenIds)}`)
  await ctx.close()
}

// ── ② assertPlaybooksEmpty ──
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const page = await ctx.newPage()
  await page.goto(`${UI}/?v=2&mode=live&transport=stub&lang=en`, { waitUntil: 'networkidle' })
  if (await page.locator('.lite-onboard').count()) { await page.keyboard.press('Escape'); await page.waitForTimeout(500) }
  await page.addScriptTag({ content: SNIPPET })
  const out = await page.evaluate(() => window.__seedGate.assertPlaybooksEmpty())
  rec('assertPlaybooksEmpty', out.pass,
    `empty=${out.emptyStatePresent} heading=${out.hasGuideHeading} comingSoon=${out.hasComingSoon} slots=${out.futureSlots} storyHits=${JSON.stringify(out.storyHits)}`)
  await ctx.close()
}

await browser.close()
const fail = R.filter((r) => !r.ok)
console.log(`\nAFK onboard phases: ${R.length - fail.length}/${R.length} pass`)
process.exit(fail.length ? 1 : 0)
