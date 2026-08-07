// 生产复验：绑项目那块在**线上**长出来了吗。
//
// 走「一键示例团队」（/demo/claim）而不是真上传：
//   · 零抽取花费（示例团队是母本的克隆，不过模型）；
//   · 造出来的 context 是 ephemeral、由 GC 扫走，不会在生产库里留长期垃圾；
//   · 示例花名册**没有工号列**，所以它顺带验的是「没工号的世界一字不差退回旧行为」。
//
//   node .issues/gap-design-0805/hitl-bind-prod-check.mjs
import { chromium } from 'playwright'

const UI = process.env.HITL_BASE || 'https://averylite.dannyqian.com'
const SHOTS = process.env.SHOT_DIR || null
const say = (m) => console.log(m)
const fails = []
const check = (label, ok, detail = '') => {
  say(`${ok ? '  ✓' : '  ✗'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) fails.push(label)
}

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'zh-CN' })
const page = await ctx.newPage()
page.on('pageerror', (e) => say(`  ⚠ pageerror: ${e.message}`))
await page.goto(`${UI}/?v=2&mode=live&lang=zh`, { waitUntil: 'networkidle' })
if (await page.locator('.lite-onboard, .lite-gate-layer').count()) {
  await page.keyboard.press('Escape'); await page.waitForTimeout(800)
}
say(`线上构建：${String((await page.evaluate(() => window.__AVERY_BUILD__?.commit))).slice(0, 7)}`)

say('── 领一份示例团队（零抽取花费）────────────────────────')
await page.evaluate(async () => { await window.__lite2Store.getState().claimDemoTeam() })
for (let i = 0; i < 40; i++) {
  const n = await page.evaluate(() => (window.__lite2Store.getState().team?.people || []).length)
  if (n > 0) break
  await page.waitForTimeout(1500)
}
const snap = await page.evaluate(() => {
  const s = window.__lite2Store.getState()
  return {
    cid: s.contextId,
    people: (s.team?.people || []).map((p) => ({ name: p.name, pid: p.personId ?? null })),
    projects: (s.team?.projects || []).map((p) => p.title),
  }
})
say(`  context=${snap.cid} 人=${snap.people.length} 项目=${snap.projects.length}`)
check('示例团队领到了', snap.people.length > 0 && snap.projects.length > 0)
// 示例花名册没有工号列 → 这一格必须**缺席**（absent≠none），铸链据此退回按姓名认人。
check('没有工号的公司，这一格是缺席而不是空串',
  snap.people.every((p) => p.pid === null || p.pid === undefined),
  JSON.stringify(snap.people.slice(0, 3)))

say('── 资料库：绑项目那块在线上长出来了吗 ──────────────────')
await page.evaluate(() => window.__lite2Store.getState().goScreen('files'))
await page.evaluate(async () => { await window.__lite2Store.getState().refreshForms() })
await page.waitForTimeout(3000)
check('常驻表单段在场', (await page.locator('.lite-files-forms').count()) === 1)
check('没选人时绑项目那块不出现', (await page.locator('.lite-files-forms-bind').count()) === 0)
const firstChip = page.locator('.lite-files-forms-chip').first()
const who = (await firstChip.innerText()).trim()
await firstChip.click()
await page.waitForTimeout(600)
check('选了人之后绑项目那块出来了', (await page.locator('.lite-files-forms-bind').count()) === 1)
const opts = await page.locator('.lite-files-forms-bind-select').first().locator('option').allInnerTexts()
say(`  给「${who}」的下拉：${JSON.stringify(opts.slice(0, 4))}…共 ${opts.length} 项`)
check('默认是「不绑项目」', opts[0] === '不绑项目', opts[0])
check('线上的项目卡进了选项', opts.length === snap.projects.length + 1, `${opts.length} vs ${snap.projects.length}+1`)
if (SHOTS) await page.locator('.lite-files-forms').screenshot({ path: `${SHOTS}/hitl-bind-prod.png` })

// 只验渲染与契约，不铸链、不提交：示例克隆虽是一次性的，也没必要往里写东西。
await browser.close()
say('')
say(fails.length === 0 ? '生产上对上了' : `没对上 ${fails.length} 条：\n  - ${fails.join('\n  - ')}`)
process.exit(fails.length === 0 ? 0 : 1)
