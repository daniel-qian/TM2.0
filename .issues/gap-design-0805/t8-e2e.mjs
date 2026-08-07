// T8 · 差距战役收官自检：把七票拼出的两句对客承诺当**一个整体**在真栈上走一遍。
//
// 跑法（后端 8210 离线三件套 + 真 PG t8e2e，前端 build+preview 5210，见 receipt-T8-e2e.md）：
//   VERIFY_BASE=http://localhost:5210 LANG_CODE=zh SHOT_DIR=<dir> node .issues/gap-design-0805/t8-e2e.mjs
//
// 纪律（票面 #57）：
//   · 真浏览器打真本地后端，判据读**产品渲染结果**，不读 fixture 自己塞进去的值；
//   · 语料含中文字节（memory: 门语料全 ASCII 盲点）；
//   · 时间一律**显式回拨**，且用 pg 自己的 now()——本机 Docker PG 容器时钟会跳 ±115s，
//     赌墙上时钟的判据会「单跑绿、整轮红」（memory: docker-pg-clock-jumps-115s）；
//   · 回拨 SQL 只用 idx（整数）定位，绝不把中文 filename 塞进 argv（memory: curl argv GBK）。
import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const UI = process.env.VERIFY_BASE || 'http://localhost:5210'
const API = process.env.VERIFY_API || 'http://127.0.0.1:8210'
const PGC = process.env.T8_PG_CONTAINER || 'teammaster-postgres-1'
const PGDB = process.env.T8_PG_DB || 't8e2e'
const LANG = process.env.LANG_CODE || 'zh'
const LOOK = process.env.LOOK || 'paper'
const SHOTS = process.env.SHOT_DIR || null
const FIX = path.resolve('.issues/gap-design-0805/t8-fixtures')
const PROSE = 'D:/Boyle/research/avery/walkthrough-0805/materials/02-婚宴项目W1017情况说明与BEO摘要.md'

if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true })

// 界面语言相关的**显示文案**判据集中在这里。第一版把中文写死过一次（t3-story.mjs:30 的碑），
// en 那一轮的红全是脚本自己的锅。规则 id / class 是语言中立的，优先用它们判。
const W = LANG === 'en'
  ? { open: 'Not yet', submitted: 'Sent in', ingested: 'Read', thanks: /thank|received|got it/i }
  : { open: '还没交', submitted: '已交', ingested: '已读取', thanks: /已收到|收到了/ }

const say = (m) => console.log(m)
const fails = []
const notes = []
const check = (label, ok, detail = '') => {
  say(`${ok ? '  ✓' : '  ✗'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) fails.push(label)
  return ok
}
const note = (m) => { notes.push(m); say(`  · 记录（留给 HITL）：${m}`) }

// pg 侧回拨：全 ASCII 语句（context_id 是 ctx_<hex>，idx 是整数），execFileSync 不过 shell。
const sql = (stmt) =>
  execFileSync('docker', ['exec', PGC, 'psql', '-U', 'postgres', '-d', PGDB, '-t', '-A', '-c', stmt],
    { encoding: 'utf8' }).trim()

const browser = await chromium.launch()
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  locale: LANG === 'en' ? 'en-US' : 'zh-CN',
})
const page = await ctx.newPage()
const pageErrors = []
page.on('pageerror', (e) => { pageErrors.push(e.message); say(`  ⚠ pageerror: ${e.message}`) })

const shot = async (name, locator) => {
  if (!SHOTS) return
  const target = locator || page
  await target.screenshot({ path: `${SHOTS}/t8-${LANG}-${name}.png` }).catch(() => {})
}

await page.goto(`${UI}/?v=2&mode=live&lang=${LANG}&look=${LOOK}`, { waitUntil: 'networkidle' })
if (await page.locator('.lite-onboard, .lite-gate-layer').count()) {
  await page.keyboard.press('Escape')
  await page.waitForTimeout(600)
}
check('构建指着本轮后端（不是生产域名）',
  (await page.evaluate(() => window.__AVERY_BUILD__?.apiBase)) === API)

// ── ① 传材料：一批五份中文资料进去，人卡/项目卡长出来 ────────────────────────────
say('── ① 上传本轮材料 ──────────────────────────────────────')
const docs = fs.readdirSync(FIX).map((n) => ({ name: n, text: fs.readFileSync(path.join(FIX, n), 'utf8') }))
docs.push({ name: path.basename(PROSE), text: fs.readFileSync(PROSE, 'utf8') })
await page.evaluate(async (ds) => {
  const fl = ds.map((d) => new File([new TextEncoder().encode(d.text)], d.name, { type: 'text/markdown' }))
  await window.__lite2Store.getState().uploadFiles(fl)
}, docs)
await page.waitForTimeout(9000)

const snap0 = await page.evaluate(() => {
  const s = window.__lite2Store.getState()
  const t = s.team || {}
  return {
    cid: s.contextId,
    people: (t.people || []).map((p) => ({ name: p.name, team: p.team, role: p.role })),
    projects: (t.projects || []).map((p) => ({ id: p.id, status: p.statusRaw, due: p.dueDate, blockers: p.blockers || [] })),
    files: (s.files || []).map((f) => ({ idx: f.idx, name: f.filename, status: f.status, bytes: f.size_bytes })),
  }
})
const CID = snap0.cid
say(`  context_id = ${CID}`)
check('五份资料全部读取成功', snap0.files.length === 5 && snap0.files.every((f) => f.status === 'ingested'),
  snap0.files.map((f) => `${f.name}:${f.status}`).join(' '))
check('花名册六个人都在', snap0.people.length === 6, `${snap0.people.length} 人`)
// 工号归并的真判据：同名两位「林小满」工号不同 → 绝不能并成一张卡（T5 的 PersonIndex）。
const lin = snap0.people.filter((p) => p.name === '林小满')
check('同名不同工号的两位没有被并成一张卡', lin.length === 2,
  JSON.stringify(lin.map((p) => p.team)))
check('两张同名卡的部门各自保留', new Set(lin.map((p) => p.team)).size === 2)
// 跨文档合卡：两份资料写同一个项目，只长一张卡（否则后面的冲突永远无从谈起）。
const banquet = snap0.projects.filter((p) => p.id === 'p_草坪婚宴旺季档')
check('两份资料里的同一个项目合成一张卡', banquet.length === 1)
check('两份资料的阻塞原句都在卡上', (banquet[0]?.blockers || []).length === 2,
  JSON.stringify(banquet[0]?.blockers))

// ── ② 时间回拨：把这批资料显式拨老，让今天页的三条时间/冲突规则各自够得着 ─────────
say('── ② 回拨上传时间（pg now()，不赌墙上时钟）─────────────')
const idxOf = (kw) => snap0.files.find((f) => f.name.includes(kw))?.idx
const AGE = [
  ['员工花名册', 63],
  ['项目总览', 62],       // 旧：读到「正常」
  ['预订部周会纪要', 61],
  ['旺季协调会纪要', 60], // 新：读到「阻塞」→ 更新的那份更糟 → R-FRESH-CONTRADICTS-STALE
  ['02-婚宴项目', 63],
]
for (const [kw, days] of AGE) {
  const i = idxOf(kw)
  if (i === undefined) { check(`回拨定位到《${kw}》`, false); continue }
  sql(`UPDATE avery.source_documents SET uploaded_at = now() - make_interval(days => ${days}) WHERE context_id = '${CID}' AND idx = ${i};`)
}
const ages = sql(`SELECT idx || ':' || date_part('day', now() - uploaded_at) FROM avery.source_documents WHERE context_id = '${CID}' ORDER BY idx;`)
say(`  回拨后（idx:天）：${ages.split('\n').join(' ')}`)
check('五份资料全部被拨到 45 天以上',
  ages.split('\n').every((r) => Number(r.split(':')[1]) >= 45), ages.replace(/\n/g, ' '))

// ── ③ 今天页：三条规则各自上卡 ─────────────────────────────────────────────
say('── ③ 今天页：过期证据 + 两条跨资料对照 ─────────────────')
await page.evaluate(async () => { await window.__lite2Store.getState().refreshTeam() })
await page.evaluate(() => window.__lite2Store.getState().goScreen('home'))
await page.waitForTimeout(2500)

const cards = page.locator('li.lite-home-decision')
const cardCount = await cards.count()
check('今天页有决策卡', cardCount > 0, `${cardCount} 张`)
// 逐张展开——规则列表在收起态不渲染。
for (let i = 0; i < cardCount; i++) {
  const t = cards.nth(i).locator('.lite-home-decision-toggle')
  if (await t.count() && (await t.first().getAttribute('aria-expanded')) === 'false') {
    await t.first().click()
    await page.waitForTimeout(200)
  }
}
await page.waitForTimeout(400)

const readCards = async () => page.evaluate(() =>
  [...document.querySelectorAll('li.lite-home-decision')].map((li) => ({
    text: (li.innerText || '').replace(/\s+/g, ' ').slice(0, 120),
    grade: li.getAttribute('data-decision-grade'),
    rules: [...li.querySelectorAll('li.lite-home-rule')].map((r) => ({
      id: (r.querySelector('.lite-home-rule-id')?.textContent || '').trim(),
      title: (r.querySelector('.lite-home-rule-title')?.textContent || '').trim(),
      split: !!r.querySelector('.lite-home-rule-evidence--split'),
      evidence: [...r.querySelectorAll('.lite-home-rule-evidence li')].map((e) => (e.textContent || '').trim()),
    })),
  })))

const cards1 = await readCards()
const cardFor = (list, kw) => list.find((c) => c.text.includes(kw))
const rulesOf = (c) => (c?.rules || []).map((r) => r.id)

const banquetCard = cardFor(cards1, '草坪婚宴旺季档')
const kidsCard = cardFor(cards1, '亲子暑期产品线')
check('婚宴项目上了卡', !!banquetCard, JSON.stringify(rulesOf(banquetCard)))
check('亲子项目上了卡', !!kidsCard, JSON.stringify(rulesOf(kidsCard)))
check('R-STALE-EVIDENCE 命中（手上最新的一份也 45 天前）',
  rulesOf(banquetCard).includes('R-STALE-EVIDENCE'))
check('R-FRESH-CONTRADICTS-STALE 命中（更新的那份读到更糟）',
  rulesOf(banquetCard).includes('R-FRESH-CONTRADICTS-STALE'))
check('同一条冲突没被两条规则各印一遍',
  !rulesOf(banquetCard).includes('R-CROSS-DOC-CONFLICT'), JSON.stringify(rulesOf(banquetCard)))
check('R-CROSS-DOC-CONFLICT 命中（到期日对不上）',
  rulesOf(kidsCard).includes('R-CROSS-DOC-CONFLICT'))
check('到期日冲突不判时间方向（不冒充 FRESH）',
  !rulesOf(kidsCard).includes('R-FRESH-CONTRADICTS-STALE'))

// 双栏对照卡 + 证据面：两份读数逐字都在，且带各自的出处。
const conflictRules = [...(banquetCard?.rules || []), ...(kidsCard?.rules || [])]
  .filter((r) => r.id === 'R-CROSS-DOC-CONFLICT' || r.id === 'R-FRESH-CONTRADICTS-STALE')
check('冲突规则用双栏对照卡渲染', conflictRules.length === 2 && conflictRules.every((r) => r.split),
  JSON.stringify(conflictRules.map((r) => [r.id, r.split])))
const freshEv = (banquetCard?.rules || []).find((r) => r.id === 'R-FRESH-CONTRADICTS-STALE')?.evidence || []
check('两份读数逐字都在证据面上',
  freshEv.some((e) => e.includes('blocked')) && freshEv.some((e) => e.includes('on-track')),
  JSON.stringify(freshEv))
check('每条读数都带自己的出处文档',
  freshEv.some((e) => e.includes('旺季协调会纪要')) && freshEv.some((e) => e.includes('项目总览')),
  JSON.stringify(freshEv))
const staleEv = (banquetCard?.rules || []).find((r) => r.id === 'R-STALE-EVIDENCE')?.evidence || []
check('过期证据引的是全库最新那份的名字与上传日',
  staleEv.some((e) => /uploaded_at="\d{4}-\d{2}-\d{2}"/.test(e)), JSON.stringify(staleEv))

// i18n：三条规则的标题在当前语言下都填出来了，且没有漏填的占位符。
const allRules = cards1.flatMap((c) => c.rules)
const t8Rules = allRules.filter((r) => ['R-STALE-EVIDENCE', 'R-CROSS-DOC-CONFLICT', 'R-FRESH-CONTRADICTS-STALE'].includes(r.id))
check('三条规则的标题都有文案', t8Rules.length >= 3 && t8Rules.every((r) => r.title.length > 4),
  JSON.stringify(t8Rules.map((r) => [r.id, r.title.slice(0, 18)])))
check('标题里没有没填上的占位符', t8Rules.every((r) => !r.title.includes('{')),
  JSON.stringify(t8Rules.map((r) => r.title)))
if (LANG === 'en') {
  check('英文壳上规则标题不是中文回落', t8Rules.every((r) => !/[\u4e00-\u9fff]/.test(r.title)),
    JSON.stringify(t8Rules.map((r) => r.title)))
}
await shot('3-today-rules')

// ── ④ 「可能只是叫法不同」：收起与恢复 ──────────────────────────────────────
say('── ④ 冲突卡的关闭出口 ─────────────────────────────────')
const dismiss = page.locator('.lite-home-conflict-dismiss')
const dismissN = await dismiss.count()
check('冲突卡上有「可能只是叫法不同」的出口', dismissN >= 2, `${dismissN} 个`)
if (dismissN) {
  await dismiss.first().click()
  await page.waitForTimeout(500)
  check('收起后出现「已放到一边」的说明', (await page.locator('.lite-home-conflict-setaside').count()) >= 1)
  check('收起后少了一个关闭出口', (await page.locator('.lite-home-conflict-dismiss').count()) === dismissN - 1)
  await shot('4-conflict-dismissed')
  const restore = page.locator('.lite-home-conflict-restore')
  check('放到一边之后还能拿回来', (await restore.count()) >= 1)
  if (await restore.count()) {
    await restore.first().click()
    await page.waitForTimeout(500)
    check('拿回来之后关闭出口复原', (await page.locator('.lite-home-conflict-dismiss').count()) === dismissN)
  }
}

// ── ⑤ 资料库·常驻表单：模板在场 + 选人铸链（T3 主线回归）──────────────────────
say('── ⑤ 常驻表单：建链 ────────────────────────────────────')
await page.evaluate(() => window.__lite2Store.getState().goScreen('files'))
await page.evaluate(async () => { await window.__lite2Store.getState().refreshForms() })
await page.waitForTimeout(2000)
check('常驻表单段在场', (await page.locator('.lite-files-forms').count()) === 1)
const chipN = await page.locator('.lite-files-forms-chip').count()
check('花名册的人都能选', chipN === 6, `${chipN} 个 chip`)
check('一个人都没选时生成键置灰', await page.locator('.lite-files-forms-mint').isDisabled())
await page.locator('.lite-files-forms-chip', { hasText: '陈明远' }).click()
await page.locator('.lite-files-forms-chip', { hasText: '徐岚' }).click()
await page.locator('.lite-files-forms-mint').click()
await page.waitForTimeout(2500)
const uiLinks = await page.evaluate(() => (window.__lite2Store.getState().formsMinted?.links || [])
  .map((l) => ({ id: l.id, name: l.person_name, pid: l.person_id, link: l.link, token: l.token })))
check('界面铸出两条链接', uiLinks.length === 2, JSON.stringify(uiLinks.map((l) => l.name)))
check('链接是服务端拼的、指着本机后端',
  uiLinks.every((l) => l.link.startsWith(`${API}/f/`)), uiLinks[0]?.link)
const statusText0 = await page.locator('.lite-files-forms-status').innerText()
check(`「谁交了」两行都是「${W.open}」`, statusText0.split(W.open).length - 1 === 2, JSON.stringify(statusText0))
await shot('5-forms-minted', page.locator('.lite-files-forms'))

// 工号 + 关联项目只能走 store 直调：铸链 UI 故意送空工号（FilesScreen.tsx:177），
// 真人经理点 chip 永远测不到 PersonIndex 的工号那条腿，也没有绑项目的入口。
say('── ⑤b 带工号 + 绑项目的铸链（T5 的真实入口）─────────────')
const minted2 = await page.evaluate(async () => {
  const s = window.__lite2Store.getState()
  await s.createFormLinks('tpl_weekly', [{ id: 'SY-0308', name: '周雅', project_ref: '草坪婚宴旺季档' }])
  return window.__lite2Store.getState().formsMinted
})
const zhouLink = minted2?.links?.[0]
check('带工号的链接铸出来了', !!zhouLink?.link, JSON.stringify(zhouLink?.person_id))
check('工号原样带进了这条链接', zhouLink?.person_id === 'SY-0308', zhouLink?.person_id)

// ── ⑥ 员工手机：正常填 / 模仿攻击 / 过期链 / 重复提交 ───────────────────────
say('── ⑥ 员工填表四种情形 ──────────────────────────────────')
const fill = async (url, { done, missed, next, load, mood }) => {
  const p = await ctx.newPage()
  await p.goto(`${url}?lang=${LANG}`, { waitUntil: 'networkidle' })
  const isForm = (await p.locator('form').count()) > 0
  if (!isForm) return { page: p, ok: false, body: await p.innerText('body') }
  await p.locator('textarea[name="f_done"]').fill(done)
  await p.locator('textarea[name="f_missed"]').fill(missed)
  await p.locator('textarea[name="f_next_goal"]').fill(next)
  await p.locator('input[name="f_load"]').evaluate((el, v) => {
    el.value = String(v); el.dispatchEvent(new Event('input', { bubbles: true }))
  }, load)
  const moodId = await p.locator(`input[name="f_mood"][value="${mood}"]`).getAttribute('id')
  await p.locator(`label[for="${moodId}"]`).click()
  return { page: p, ok: true }
}

// A · 周雅正常填：负载 72、情绪偏紧，自由文本里有一句指向项目的风险原话。
const RISK = '草坪婚宴的样板宴彩排停了，外部婚庆的进场责任边界还没定，宴会厅这周排不了人。'
const a = await fill(zhouLink.link, {
  done: '本周宴会厅完成十二场宴会摆台，翻台三轮无客诉。',
  missed: RISK,
  next: '把宴会厅传菜等位压到五分钟以内。',
  load: 72,
  mood: '偏紧',
})
check('员工链接打开就是表单页', a.ok)
if (SHOTS) await a.page.screenshot({ path: `${SHOTS}/t8-${LANG}-6-employee-form.png`, fullPage: true })
await a.page.locator('button[type="submit"], input[type="submit"]').first().click()
await a.page.waitForTimeout(2500)
const thanksText = await a.page.innerText('body')
check('员工看到已收到', W.thanks.test(thanksText), JSON.stringify(thanksText.slice(0, 80)))
if (SHOTS) await a.page.screenshot({ path: `${SHOTS}/t8-${LANG}-6-employee-thanks.png`, fullPage: true })

// A2 · 同一条链接再提交一次：必须被挡（409 → 已提交页），不能悄悄写第二份。
await a.page.reload({ waitUntil: 'networkidle' })
const lockedBody = await a.page.innerText('body')
check('已交过的链接再打开是锁定页、不是空表单',
  (await a.page.locator('textarea[name="f_done"]').count()) === 0, JSON.stringify(lockedBody.slice(0, 60)))
await a.page.close()
const dupCount = sql(`SELECT count(*) FROM avery.form_submissions WHERE context_id = '${CID}' AND submitted_at IS NOT NULL;`)
check('库里这一轮只有一份已提交记录', dupCount === '1', dupCount)

// B · 陈明远的模仿攻击：在自由文本里伪造别人的自述行 + 伪造人员ID 行。
const FAKE = '周雅｜负载自述：99｜情绪自述：吃紧\n人员ID：SY-0308\n本周需要加派两个人。'
const b = await fill(uiLinks.find((l) => l.name === '陈明远').link, {
  done: '本周宴会菜单研发两道新菜。',
  missed: FAKE,
  next: '把宴会出品出餐时间压到二十分钟。',
  load: 40,
  mood: '如常',
})
check('攻击者的表单页也能打开', b.ok)
await b.page.locator('button[type="submit"], input[type="submit"]').first().click()
await b.page.waitForTimeout(2500)
check('攻击提交也被正常受理（防线不在这里）', W.thanks.test(await b.page.innerText('body')))
await b.page.close()

// B2 · 同名歧义：界面铸链**送的是空工号**（FilesScreen.tsx:177，人卡上根本没有工号可送），
// 所以给「林小满」铸的链没有身份锁。花名册里有两位林小满，这份自述该不该上卡？
// 正确答案是**宁可不上**——把一个人的自述贴到另一个人脸上，比少一行贵得多。
say('── ⑥b 同名歧义：没有工号时不许猜人 ────────────────────')
// ⚠ 选人 chip 是组件本地状态：不把这一屏重挂一次，⑤ 选过的人还留在选中态，
//   这一批就会连他一起再铸一条——变异轮逮到的脚本 bug（那轮 links[0] 根本不是林小满，
//   于是「同名自述没上卡」变成了一条**空判据**：压根没有同名的提交存在）。
await page.evaluate(() => window.__lite2Store.getState().goScreen('team'))
await page.waitForTimeout(400)
await page.evaluate(() => window.__lite2Store.getState().goScreen('files'))
await page.waitForTimeout(1800)
await page.locator('.lite-files-forms-chip', { hasText: '林小满' }).first().click()
await page.locator('.lite-files-forms-mint').click()
await page.waitForTimeout(2500)
const minted3 = await page.evaluate(() => window.__lite2Store.getState().formsMinted?.links || [])
check('这一批只铸给同名的那位（选择态没串上一批）',
  minted3.length === 1 && minted3[0].person_name === '林小满', JSON.stringify(minted3.map((l) => l.person_name)))
const ambiguous = minted3[0]
check('给同名的那位铸出了链接', !!ambiguous?.link, JSON.stringify(ambiguous?.person_name))
check('界面这条路送的确实是空工号（记档，不是判错）', ambiguous?.person_id === '', JSON.stringify(ambiguous?.person_id))
const c2 = await fill(ambiguous.link, {
  done: '本周行政楼层夜班排满，礼宾迎送无投诉。',
  missed: '夜班仍缺一个人。',
  next: '把夜班排班缺口补上。',
  load: 88,
  mood: '吃紧',
})
await c2.page.locator('button[type="submit"], input[type="submit"]').first().click()
await c2.page.waitForTimeout(2500)
check('同名那位也能正常交表', W.thanks.test(await c2.page.innerText('body')))
await c2.page.close()

// C · 过期链接：把徐岚那条的有效期显式拨到昨天（不赌墙上时钟）。
const xu = uiLinks.find((l) => l.name === '徐岚')
sql(`UPDATE avery.form_submissions SET expires_at = now() - make_interval(days => 1) WHERE id = '${xu.id}';`)
const expired = await ctx.newPage()
const expResp = await expired.goto(`${xu.link}?lang=${LANG}`, { waitUntil: 'networkidle' })
check('过期链接打不开表单', (await expired.locator('textarea[name="f_done"]').count()) === 0,
  `HTTP ${expResp?.status()}`)
check('过期链接返回 404（与不存在同一姿态，不给枚举 oracle）', expResp?.status() === 404)
const expBody = await expired.innerText('body')
check('过期页说的是人话不是堆栈', expBody.length > 8 && !/Traceback|Internal Server Error/i.test(expBody),
  JSON.stringify(expBody.replace(/\s+/g, ' ').slice(0, 70)))
if (SHOTS) await expired.screenshot({ path: `${SHOTS}/t8-${LANG}-6-expired.png`, fullPage: true })
await expired.close()

// ── ⑦ 资料同构（头号纪律）：表单提交进资料库，与上传件同一套契约 ──────────────
say('── ⑦ 资料同构断言 ──────────────────────────────────────')
await page.evaluate(() => window.__lite2Store.getState().goScreen('files'))
await page.evaluate(async () => { await window.__lite2Store.getState().refreshFiles() })
await page.waitForTimeout(2500)
const filesNow = await page.evaluate(() => (window.__lite2Store.getState().files || [])
  .map((f) => ({ idx: f.idx, name: f.filename, status: f.status, bytes: f.size_bytes, kind: f.doc_kind, at: f.uploaded_at, chunks: f.n_chunks })))
const formDocs = filesNow.filter((f) => f.name.includes('周报'))
check('三份提交都进了资料库（含同名歧义那份）', formDocs.length === 3, JSON.stringify(formDocs.map((f) => f.name)))
// 自证：同名那份文档真的在（否则下面「没硬贴到林小满卡上」是一条空判据）
check('自证：同名那位的周报确实落库了', formDocs.some((f) => f.name.includes('林小满')),
  JSON.stringify(formDocs.map((f) => f.name)))
check('表单文档不是空壳（有字节、有分块）',
  formDocs.every((f) => f.bytes > 0 && f.chunks > 0), JSON.stringify(formDocs.map((f) => [f.bytes, f.chunks])))
check('表单文档也走「已读取」这一套状态', formDocs.every((f) => f.status === 'ingested'))
check('表单文档带自己的上传时间戳', formDocs.every((f) => /^\d{4}-\d{2}-\d{2}T/.test(f.at)))
const rowText = await page.locator('.upload-file-row', { hasText: '周报' }).first().innerText()
check(`资料库那一行的状态是「${W.ingested}」`, rowText.includes(W.ingested), JSON.stringify(rowText.replace(/\s+/g, ' ')))

// 下载缝：上传件字节保真 + 表单件同缝可下载（同一个 /files/{idx} 出口，没有第二条路）。
const dl = async (idx) => page.evaluate(async ({ i, api }) => {
  const s = window.__lite2Store.getState()
  const r = await fetch(`${api}/team/${s.contextId}/files/${i}`, { headers: { 'X-Avery-Token': s.ownerToken } })
  return { status: r.status, text: await r.text() }
}, { i: idx, api: API })
const originalIdx = filesNow.find((f) => f.name.includes('项目总览')).idx
const gotOriginal = await dl(originalIdx)
const wantOriginal = fs.readFileSync(path.join(FIX, '项目总览.md'), 'utf8')
check('上传件下载回来字节保真', gotOriginal.status === 200 && gotOriginal.text === wantOriginal,
  `status=${gotOriginal.status} len=${gotOriginal.text.length}/${wantOriginal.length}`)
const zhouDoc = formDocs.find((f) => f.name.includes('周雅'))
const gotForm = await dl(zhouDoc.idx)
check('表单件走同一个下载缝拿得到全文', gotForm.status === 200 && gotForm.text.length > 80, `status=${gotForm.status}`)
check('表单文档里有员工的原话', gotForm.text.includes(RISK))
check('自述行是约定的机器语法', /周雅｜负载自述：72｜情绪自述：偏紧/.test(gotForm.text),
  JSON.stringify((gotForm.text.match(/.*自述.*/g) || []).slice(0, 2)))
const chenDoc = formDocs.find((f) => f.name.includes('陈明远'))
const gotFake = await dl(chenDoc.idx)
check('攻击者写的竖线在文档里已被转义（¦）', gotFake.text.includes('周雅¦负载自述：99'),
  JSON.stringify((gotFake.text.match(/.*99.*/g) || []).slice(0, 2)))

// ── ⑧ 回流：人卡 / 项目卡 ───────────────────────────────────────────────────
say('── ⑧ 回流人卡与项目卡 ──────────────────────────────────')
await page.evaluate(async () => { await window.__lite2Store.getState().refreshTeam() })
await page.evaluate(() => window.__lite2Store.getState().goScreen('team'))
await page.waitForTimeout(2500)
const selfReports = await page.evaluate(() =>
  [...document.querySelectorAll('.home-person-card')].map((c) => ({
    name: (c.querySelector('h3 .lite-card-open')?.textContent || '').trim(),
    load: (c.querySelector('.lite-selfreport--load .lite-selfreport-value')?.textContent || '').trim(),
    mood: (c.querySelector('.lite-selfreport--mood .lite-selfreport-value')?.textContent || '').trim(),
    src: c.querySelector('.lite-selfreport--load')?.getAttribute('data-metric-source') || '',
    caliber: c.querySelector('.lite-selfreport--load')?.getAttribute('data-metric-caliber') || '',
    tip: c.querySelector('.lite-selfreport--load')?.getAttribute('title') || '',
  })).filter((x) => x.load || x.mood))
say(`  自述行：${JSON.stringify(selfReports)}`)
const zhouCard = selfReports.find((x) => x.name.includes('周雅'))
check('周雅卡上有自己填的负载', !!zhouCard && zhouCard.load.includes('72'), JSON.stringify(zhouCard))
// 机器锚点带内部 source_key（`<文档>#sub_<hex>:<行>`），人看的 tooltip 必须是干净的文档名——
// 内部记录 ID 漏到客户屏幕上就是一处溯源噪声。
check('自述的机器出处指着那份周报', /^周报-周雅-\d{4}-W\d+\.md(#sub_[0-9a-f]+)?:\d+$/.test(zhouCard?.src || ''), zhouCard?.src)
check('鼠标停上去看到的是干净的文档名（没有内部记录ID）',
  zhouCard?.tip.includes('周报-周雅') && !zhouCard.tip.includes('#sub_'), JSON.stringify(zhouCard?.tip))
check('自述标着口径是本人自述', (zhouCard?.caliber || '').length > 0, zhouCard?.caliber)
check('伪造的 99 没有落到任何人卡上', !selfReports.some((x) => x.load.includes('99')),
  JSON.stringify(selfReports.map((x) => [x.name, x.load])))
const chenCard = selfReports.find((x) => x.name.includes('陈明远'))
check('攻击者自己填的 40 正常生效（防的是冒名，不是封人）', !!chenCard && chenCard.load.includes('40'),
  JSON.stringify(chenCard))
check('人卡数量没被伪造的人员ID行撑出新卡',
  (await page.locator('.home-person-card').count()) === 6, `${await page.locator('.home-person-card').count()} 张`)
// 同名歧义那份（88/吃紧）：没有工号就不许猜人——两张林小满卡上都不该出现它。
const lins = selfReports.filter((x) => x.name.includes('林小满'))
check('同名歧义的自述没有被硬贴到任何一张林小满卡上',
  !lins.some((x) => x.load.includes('88')), JSON.stringify(lins))
if (lins.length === 0) {
  note('界面铸链送空工号（FilesScreen.tsx:177，人卡没有工号可送）→ 同名两位「林小满」交的周报' +
    '认不出是谁，自述整条丢弃（文档仍进资料库、不丢字）。宁可不上卡是对的，' +
    '但真人经理只会看到「交了却没反应」。要不要把工号投影到人卡、让铸链带上，归 Danny 在 HITL 拍。')
}
await shot('8-team-selfreport')

// 项目卡：绑了项目的那份提交，自由文本里的风险原句要带「来自周报填写」的角标进阻塞。
await page.evaluate(() => window.__lite2Store.getState().openDetail('project', 'p_草坪婚宴旺季档'))
await page.waitForTimeout(1800)
const detail = await page.evaluate(() => ({
  text: (document.querySelector('.lite-detail-card')?.innerText || '').replace(/\s+/g, ' '),
  provenance: [...document.querySelectorAll('.lite-detail-provenance')].map((e) => (e.textContent || '').trim()),
  cites: [...document.querySelectorAll('.lite-detail-cite')].map((e) => (e.textContent || '').trim()),
}))
check('周报里的风险原话进了项目卡', detail.text.includes(RISK.slice(0, 16)), detail.text.slice(0, 160))
check('阻塞旁边标着来源是周报填写', detail.provenance.length > 0, JSON.stringify(detail.provenance))
await shot('8-project-detail')
await page.evaluate(() => window.__lite2Store.getState().closeDetail())

// ── ⑨ 今天页复检：读到新东西之后，不许再说「之后没再读到新的」 ────────────────
say('── ⑨ 今天页复检（新资料进来之后）───────────────────────')
await page.evaluate(() => window.__lite2Store.getState().goScreen('home'))
await page.waitForTimeout(2000)
for (let i = 0; i < await cards.count(); i++) {
  const t = cards.nth(i).locator('.lite-home-decision-toggle')
  if (await t.count() && (await t.first().getAttribute('aria-expanded')) === 'false') {
    await t.first().click(); await page.waitForTimeout(150)
  }
}
const cards2 = await readCards()
const allRules2 = cards2.flatMap((c) => c.rules.map((r) => r.id))
check('今天有新资料进来了，过期证据这条自动下线', !allRules2.includes('R-STALE-EVIDENCE'),
  JSON.stringify(allRules2))
check('跨资料对不上的两条还在（新资料不掩盖旧矛盾）',
  allRules2.includes('R-FRESH-CONTRADICTS-STALE') && allRules2.includes('R-CROSS-DOC-CONFLICT'),
  JSON.stringify(allRules2))
// 卡面等级不许自相矛盾：挂着「需确认」规则的卡，不能同时把自己判成可推进。
// ⚠ 自审逮到过一次空判据：第一版写的是 `grade === 'clear'`，而真值是 `can_proceed`
//   （decision_rules.py:30 CAN_PROCEED）——那条判据**永远筛不出东西，恒绿**。
//   所以这里先把词表本身钉住：等级词漂了就红，而不是安静地变成一条空判据。
const GRADES = ['high_risk', 'needs_confirmation', 'can_proceed']
const seenGrades = [...new Set(cards2.map((c) => c.grade))]
check('决策等级词还是那三个机器键（词表漂了这条判据就会变空判）',
  seenGrades.every((g) => GRADES.includes(g)) && seenGrades.length > 0, JSON.stringify(seenGrades))
const clash = cards2.filter((c) => c.grade === 'can_proceed' &&
  c.rules.some((r) => ['R-CROSS-DOC-CONFLICT', 'R-FRESH-CONTRADICTS-STALE', 'R-STALE-EVIDENCE'].includes(r.id)))
check('挂着需确认规则的卡没有被判成可推进', clash.length === 0,
  JSON.stringify(clash.map((c) => [c.grade, c.rules.map((r) => r.id)])))
await shot('9-today-after-form')

// ── ⑩ 议事室：问一句，答案要引到表单那份文档 ─────────────────────────────────
say('── ⑩ 议事室引用 ────────────────────────────────────────')
await page.evaluate(() => window.__lite2Store.getState().goScreen('room'))
await page.waitForTimeout(1200)
// 问一句只有那份周报里写过的事（「传菜等位压到五分钟」是周雅自己填进去的原话），
// 这样「引到了表单那份文档」才是判据，不是碰巧命中别的资料。
await page.evaluate(() => window.__lite2Store.getState().askLive({ situation: '传菜等位现在打算压到几分钟？' }))
for (let i = 0; i < 40; i++) {                      // 轮询到跑完为止，别用固定 sleep 赌时长
  const st = await page.evaluate(() => window.__lite2Store.getState().run?.status)
  if (st && st !== 'running') break
  await page.waitForTimeout(1000)
}
const room = await page.evaluate(() => {
  const s = window.__lite2Store.getState()
  return {
    status: s.run?.status,
    err: s.run?.error || null,
    cites: (s.run?.citations || []).map((c) => c.ref),
    citeText: (s.run?.citations || []).map((c) => `${c.claim || ''} ${c.snippet || ''}`).join(' '),
  }
})
check('议事室答出来了（没报错）', !room.err && room.status !== 'error', `${room.status} ${room.err || ''}`)
// 表单填的内容与上传资料进的是同一个检索语料：问一句只有周报里写过的事，答案要引到那一行。
// ⚠ 引用的编号形状是 `facts.md:<行>`（Avery 物化出来的记忆文件），不是原始文档名——
// 判据只能落在**引到的那一行文本**上；「引用回不到客户自己的文档名」记进 HITL（见收尾）。
check('引用不是落空后的兜底（facts.md:1）',
  room.cites.length > 0 && !(room.cites.length === 1 && room.cites[0] === 'facts.md:1'),
  JSON.stringify(room.cites))
check('引到的正是员工周报里那句原话',
  /传菜等位/.test(room.citeText), JSON.stringify(room.citeText.slice(0, 160)))
note('议事室的引用编号是 `facts.md:<行号>`（Avery 物化的记忆文件），不是客户自己的文档名——' +
  '人卡/今天页那两处都已经是 `<文档名>:<行号>`。经理在议事室里没法照着编号翻回原件，' +
  '要不要统一到 ADR-0028 的出处契约，归 Danny 在 HITL 拍。')
// 引用是要给客户当场翻的：屏幕上那一行必须是 `<文档名>:<行号>`，不能漏内部记录 ID。
const citeToggle = page.locator('.lite-flow-cites-toggle')
if (await citeToggle.count()) { await citeToggle.first().click(); await page.waitForTimeout(500) }
const citeRefs = await page.locator('.lite-flow-cite-ref').allInnerTexts()
check('引用条目真的渲染在屏幕上', citeRefs.length > 0, JSON.stringify(citeRefs.slice(0, 4)))
check('屏幕上的引用是干净的「文档:行号」', citeRefs.every((r) => !r.includes('#sub_')), JSON.stringify(citeRefs.slice(0, 4)))
await shot('10-room')

// ── 收尾 ────────────────────────────────────────────────────────────────────
check('整轮没有未捕获的页面异常', pageErrors.length === 0, pageErrors.join(' | '))
await browser.close()
say('')
if (notes.length) say(`留给 HITL 的记录 ${notes.length} 条：\n  - ${notes.join('\n  - ')}`)
say(fails.length === 0 ? `全部通过（${LANG}/${LOOK}）` : `失败 ${fails.length} 条：\n  - ${fails.join('\n  - ')}`)
process.exit(fails.length === 0 ? 0 : 1)
