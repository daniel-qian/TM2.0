// HITL 第二步（经理侧复验）：Danny 手机提交之后，在**生产**上验三处 + 截图。
// 复用 hitl-setup.mjs 存下的 storageState（同一个 context 与 ownerToken）。
//   node .issues/gap-design-0805/hitl-verify.mjs
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'

const UI = process.env.HITL_BASE || 'https://averylite.dannyqian.com'
const SHOTS = path.resolve('.issues/gap-design-0805/hitl-shots')
const SESSION = path.resolve('.issues/gap-design-0805/.hitl-session.json')
fs.mkdirSync(SHOTS, { recursive: true })
const sess = JSON.parse(fs.readFileSync(SESSION, 'utf8'))

const say = (m) => console.log(m)
const fails = []
const check = (label, ok, detail = '') => {
  say(`${ok ? '  ✓' : '  ✗'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) fails.push(label)
}

const browser = await chromium.launch()
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 900 }, locale: 'zh-CN', storageState: sess.storage,
})
const page = await ctx.newPage()
page.on('pageerror', (e) => say(`  ⚠ pageerror: ${e.message}`))
await page.goto(`${UI}/?v=2&mode=live&lang=zh`, { waitUntil: 'networkidle' })
await page.waitForTimeout(1500)
if (await page.locator('.lite-onboard, .lite-gate-layer').count()) {
  await page.keyboard.press('Escape'); await page.waitForTimeout(600)
}
const cid = await page.evaluate(() => window.__lite2Store.getState().contextId)
check('还在同一个 context 上', cid === sess.cid, `${cid} vs ${sess.cid}`)

say('── ① 资料库：那份周报进来了吗 ──────────────────────────')
await page.evaluate(() => window.__lite2Store.getState().goScreen('files'))
await page.evaluate(async () => {
  const s = window.__lite2Store.getState()
  await s.refreshFiles(); await s.refreshForms()
})
await page.waitForTimeout(4000)
const files = await page.evaluate(() => (window.__lite2Store.getState().files || [])
  .map((f) => ({ idx: f.idx, n: f.filename, s: f.status, b: f.size_bytes, c: f.n_chunks })))
say(`  资料：${JSON.stringify(files.map((f) => `${f.n}:${f.s}`))}`)
const wk = files.find((f) => f.n.includes('周报'))
check('周报文档进了资料库', !!wk, JSON.stringify(wk))
check('不是空壳（有字节、有引用块）', !!wk && wk.b > 0 && wk.c > 0, JSON.stringify(wk))
check('状态是已读取', wk?.s === 'ingested', wk?.s)
const statusText = await page.locator('.lite-files-forms-status').innerText().catch(() => '')
say(`  「谁交了」：${JSON.stringify(statusText.replace(/\s+/g, ' '))}`)
check('「谁交了」显示已交', /已交/.test(statusText))
await page.locator('.lite-files-forms').screenshot({ path: `${SHOTS}/hitl-2-forms-submitted.png` }).catch(() => {})
await page.screenshot({ path: `${SHOTS}/hitl-2-files.png` })

// 员工原话（从服务端取回全文，判据后面要用）
const doc = await page.evaluate(async ({ i, api }) => {
  const s = window.__lite2Store.getState()
  const r = await fetch(`${api}/team/${s.contextId}/files/${i}`, { headers: { 'X-Avery-Token': s.ownerToken } })
  return { status: r.status, text: await r.text() }
}, { i: wk?.idx, api: 'https://avery.dannyqian.com' })
check('周报全文取得回来', doc.status === 200 && doc.text.length > 60, `status=${doc.status}`)
say('  ── 周报正文 ──')
say(doc.text.split('\n').map((l) => `    ${l}`).join('\n'))

say('── ② 人卡：自述回流 + 出处 ─────────────────────────────')
await page.evaluate(async () => { await window.__lite2Store.getState().refreshTeam() })
await page.evaluate(() => window.__lite2Store.getState().goScreen('team'))
await page.waitForTimeout(3000)
const cards = await page.evaluate(() =>
  [...document.querySelectorAll('.home-person-card')].map((c) => ({
    name: (c.querySelector('h3 .lite-card-open')?.textContent || '').trim(),
    load: (c.querySelector('.lite-selfreport--load .lite-selfreport-value')?.textContent || '').trim(),
    mood: (c.querySelector('.lite-selfreport--mood .lite-selfreport-value')?.textContent || '').trim(),
    src: c.querySelector('.lite-selfreport--load')?.getAttribute('data-metric-source') || '',
    tip: c.querySelector('.lite-selfreport--load')?.getAttribute('title') || '',
  })))
say(`  人卡：${JSON.stringify(cards)}`)
const zhou = cards.find((c) => c.name.includes('周雅'))
check('周雅卡上长出自述', !!zhou?.load, JSON.stringify(zhou))
check('自述出处指着那份周报', /周报/.test(zhou?.src || ''), zhou?.src)
check('tooltip 是干净文档名', !!zhou && zhou.tip.includes('周报') && !zhou.tip.includes('#sub_'), zhou?.tip)
await page.screenshot({ path: `${SHOTS}/hitl-3-team.png` })

say('── ③ 项目卡：自由文本进阻塞 + 来自周报填写 ──────────────')
await page.evaluate(() => window.__lite2Store.getState().openDetail('project', 'p_草坪婚宴旺季档'))
await page.waitForTimeout(2000)
const detail = await page.evaluate(() => ({
  text: (document.querySelector('.lite-detail-card')?.innerText || '').replace(/\s+/g, ' '),
  prov: [...document.querySelectorAll('.lite-detail-provenance')].map((e) => (e.textContent || '').trim()),
}))
say(`  项目卡：${detail.text.slice(0, 260)}`)
check('阻塞旁标着来自周报填写', detail.prov.some((p) => /周报/.test(p)), JSON.stringify(detail.prov))
await page.screenshot({ path: `${SHOTS}/hitl-4-project.png` })
await page.evaluate(() => window.__lite2Store.getState().closeDetail())

say('── ④ 今天页：跨资料对不上的条目 ────────────────────────')
await page.evaluate(() => window.__lite2Store.getState().goScreen('home'))
await page.waitForTimeout(2500)
const n = await page.locator('li.lite-home-decision').count()
for (let i = 0; i < n; i++) {
  const t = page.locator('li.lite-home-decision').nth(i).locator('.lite-home-decision-toggle')
  if (await t.count() && (await t.first().getAttribute('aria-expanded')) === 'false') {
    await t.first().click(); await page.waitForTimeout(200)
  }
}
const decisions = await page.evaluate(() =>
  [...document.querySelectorAll('li.lite-home-decision')].map((li) => ({
    grade: li.getAttribute('data-decision-grade'),
    text: (li.innerText || '').replace(/\s+/g, ' ').slice(0, 70),
    rules: [...li.querySelectorAll('li.lite-home-rule')].map((r) => ({
      id: (r.querySelector('.lite-home-rule-id')?.textContent || '').trim(),
      split: !!r.querySelector('.lite-home-rule-evidence--split'),
      ev: [...r.querySelectorAll('.lite-home-rule-evidence li')].map((e) => (e.textContent || '').trim()),
    })),
  })))
say(`  决策卡：${JSON.stringify(decisions.map((d) => [d.grade, d.rules.map((r) => r.id)]))}`)
const allRules = decisions.flatMap((d) => d.rules)
const conflictRules = allRules.filter((r) => /CONFLICT|FRESH/.test(r.id))
check('今天页出现跨资料对照条目', conflictRules.length > 0, JSON.stringify(conflictRules.map((r) => r.id)))
check('用双栏对照卡渲染', conflictRules.every((r) => r.split))
say(`  对照证据：${JSON.stringify(conflictRules.map((r) => r.ev))}`)
check('冲突卡有「可能只是叫法不同」出口', (await page.locator('.lite-home-conflict-dismiss').count()) > 0)
await page.screenshot({ path: `${SHOTS}/hitl-5-today.png` })

say('── ⑤ 议事室：能不能引到刚交的这份周报 ──────────────────')
await page.evaluate(() => window.__lite2Store.getState().goScreen('room'))
await page.waitForTimeout(1500)
await page.evaluate(() => window.__lite2Store.getState().askLive({ situation: '宴会厅这周有什么要注意的？' }))
for (let i = 0; i < 60; i++) {
  const st = await page.evaluate(() => window.__lite2Store.getState().run?.status)
  if (st && st !== 'running') break
  await page.waitForTimeout(1500)
}
const room = await page.evaluate(() => {
  const s = window.__lite2Store.getState()
  return {
    status: s.run?.status,
    cites: (s.run?.citations || []).map((c) => `${c.ref} ${String(c.snippet || c.claim || '').slice(0, 40)}`),
  }
})
say(`  run=${room.status}`)
say(`  引用：${JSON.stringify(room.cites, null, 1)}`)
check('议事室答出来了', room.status === 'complete', room.status)
await page.screenshot({ path: `${SHOTS}/hitl-6-room.png` })

await browser.close()
say('')
say(fails.length === 0 ? '三处全对上了' : `没对上 ${fails.length} 条：\n  - ${fails.join('\n  - ')}`)
process.exit(fails.length === 0 ? 0 : 1)
