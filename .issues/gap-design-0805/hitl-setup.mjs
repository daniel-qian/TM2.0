// HITL 第一步（经理侧）：在**生产**上建一个真 context，传 4 份中文语料，铸一条周报链接给 Danny 手机填。
// ⚠ 这个脚本会真写生产库、真花 MiniMax 抽取调用。只在 HITL 轮里跑。
//
//   node .issues/gap-design-0805/hitl-setup.mjs
//
// 产出：控制台打印员工链接；会话（localStorage 全量）存到 .issues/gap-design-0805/.hitl-session.json
// 供第二步 hitl-verify.mjs 复用同一个 context 与 ownerToken。
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'

const UI = process.env.HITL_BASE || 'https://averylite.dannyqian.com'
const FIX = path.resolve('.issues/gap-design-0805/t8-fixtures')
const SHOTS = path.resolve('.issues/gap-design-0805/hitl-shots')
const SESSION = path.resolve('.issues/gap-design-0805/.hitl-session.json')
const WHO = process.env.HITL_PERSON || '周雅'
fs.mkdirSync(SHOTS, { recursive: true })

const say = (m) => console.log(m)
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'zh-CN' })
const page = await ctx.newPage()
page.on('pageerror', (e) => say(`  ⚠ pageerror: ${e.message}`))

await page.goto(`${UI}/?v=2&mode=live&lang=zh`, { waitUntil: 'networkidle' })
if (await page.locator('.lite-onboard, .lite-gate-layer').count()) {
  await page.keyboard.press('Escape')
  await page.waitForTimeout(800)
}
const build = await page.evaluate(() => window.__AVERY_BUILD__)
say(`线上构建：commit=${String(build?.commit).slice(0, 7)} apiBase=${build?.apiBase} mode=${build?.mode}`)
if (!/avery\.dannyqian\.com/.test(build?.apiBase || '')) {
  say('✗ apiBase 不是生产后端，停手'); await browser.close(); process.exit(1)
}

say('── 传 4 份中文语料（真 MiniMax 抽取）──────────────────')
const docs = fs.readdirSync(FIX).map((n) => ({ name: n, text: fs.readFileSync(path.join(FIX, n), 'utf8') }))
say(`  ${docs.map((d) => d.name).join(' / ')}`)
await page.evaluate(async (ds) => {
  const fl = ds.map((d) => new File([new TextEncoder().encode(d.text)], d.name, { type: 'text/markdown' }))
  await window.__lite2Store.getState().uploadFiles(fl)
}, docs)

// 真抽取比离线替身慢得多：轮询到人卡长出来为止（最多 3 分钟）。
let snap = null
for (let i = 0; i < 90; i++) {
  await page.waitForTimeout(2000)
  snap = await page.evaluate(() => {
    const s = window.__lite2Store.getState()
    const t = s.team || {}
    return {
      cid: s.contextId,
      status: s.ingestStatus,
      err: s.ingestError,
      people: (t.people || []).map((p) => `${p.name}/${p.team || '?'}`),
      projects: (t.projects || []).map((p) => `${p.title}[${p.statusRaw || '?'}|${p.dueDate || '-'}]`),
      files: (s.files || []).map((f) => `${f.filename}:${f.status}`),
    }
  })
  if (snap.err) { say(`✗ 抽取报错：${snap.err}`); break }
  if (snap.people.length) break
  if (i % 5 === 4) say(`  …等抽取（${(i + 1) * 2}s）status=${snap.status}`)
}
say(`  context_id = ${snap.cid}`)
say(`  人卡（${snap.people.length}）：${JSON.stringify(snap.people)}`)
say(`  项目卡（${snap.projects.length}）：${JSON.stringify(snap.projects)}`)
say(`  资料：${JSON.stringify(snap.files)}`)

say('── 资料库·常驻表单：给一个人铸本期链接 ────────────────')
await page.evaluate(() => window.__lite2Store.getState().goScreen('files'))
await page.evaluate(async () => { await window.__lite2Store.getState().refreshForms() })
await page.waitForTimeout(3000)
const hasSection = await page.locator('.lite-files-forms').count()
say(`  常驻表单段在场：${hasSection === 1}`)
await page.locator('.lite-files-forms-chip', { hasText: WHO }).first().click()
await page.locator('.lite-files-forms-mint').click()
await page.waitForTimeout(4000)
const links = await page.evaluate(() => (window.__lite2Store.getState().formsMinted?.links || [])
  .map((l) => ({ name: l.person_name, link: l.link, expires: l.expires_at })))
say(`  铸出：${JSON.stringify(links, null, 1)}`)
await page.locator('.lite-files-forms').screenshot({ path: `${SHOTS}/hitl-1-forms-minted.png` }).catch(() => {})
await page.screenshot({ path: `${SHOTS}/hitl-1-files-full.png` })

const storage = await ctx.storageState()
fs.writeFileSync(SESSION, JSON.stringify({ cid: snap.cid, links, storage }, null, 1))
say(`\n会话已存：${SESSION}`)
say(`\n👉 给 Danny 的链接：${links[0]?.link}`)
await browser.close()
