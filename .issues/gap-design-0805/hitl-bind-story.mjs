// 0807 HITL 补的两条腿，浏览器层取证：**工号进得了铸链**、**绑项目有入口且真回流**。
//
//   VERIFY_BASE=http://localhost:5210 LANG_CODE=zh SHOT_DIR=<dir> node .issues/gap-design-0805/hitl-bind-story.mjs
//
// 为什么另起一个文件而不是改 t3-story.mjs：那道门的花名册**没有工号**，它钉的正是
// 「没工号的公司一字不差地退回按姓名认人」那个世界。两个世界要两份语料，混在一起
// 就没人守得住旧行为了。
import { chromium } from 'playwright'

const UI = process.env.VERIFY_BASE || 'http://localhost:5210'
const API = process.env.VERIFY_API || 'http://127.0.0.1:8210'
const LANG = process.env.LANG_CODE || 'zh'
const LOOK = process.env.LOOK || 'paper'
const SHOTS = process.env.SHOT_DIR || null

// 语料带工号列（`_ZH_HEADER_MAP` 只认「人员ID/工号」这几种写法，逐字，无位置兜底），
// 并且**故意放两位同名**——工号那条腿真接上了才分得开。
const ROSTER = [
  '# 望江酒店 · 员工花名册',
  '',
  '姓名 | 人员ID | 职位 | 部门 | 司龄 | 负责',
  '周雅 | SY-0308 | 传菜领班 | 前厅部 | 3 年 | 宴会厅传菜动线与现场服务',
  '陈明远 | SY-0117 | 中餐厨师长 | 厨房 | 7 年 | 各菜系出品与宴会菜单研发',
  '林小满 | SY-0422 | 前厅部经理 | 前厅部 | 5 年 | 前台礼宾总机与行政楼层统筹',
  '林小满 | SY-0906 | 康乐部主管 | 康乐部 | 2 年 | 泳池与儿童乐园现场值守',
  '',
].join('\n')

// 🔴 项目必须另起一份文档：花名册那份 `doc_kind=roster`，把 `## 项目：` 写在它里面
// 抽不出项目卡（实测 `team.projects` 为空），于是绑项目那块按「没项目可绑」整块不渲染——
// 第一版就这么红了一轮，红的是语料不是部件。
const PROJECTS = [
  '# 望江酒店 · 本期项目',
  '',
  '## 项目：宴会厅翻台提速',
  '',
  '负责人：周雅',
  '自报状态：正常',
  '进度：60%',
  '概述：宴会厅晚市翻台动线优化，前厅与厨房配合。',
  '',
].join('\n')

const W = LANG === 'en'
  // ⚠ 英文那句是 “From a submitted form”，不是 “weekly”——第一版按中文「周报」直译猜了个
  // weekly，en 那轮红的是脚本自己（t3-story.mjs:30 立过同一块碑）。判据一律照 en.ts 抄原文。
  ? { none: 'No project', about: /about/i, formBadge: /from a submitted form/i }
  : { none: '不绑项目', about: /关于/, formBadge: /周报/ }

const say = (m) => console.log(m)
const fails = []
const check = (label, ok, detail = '') => {
  say(`${ok ? '  ✓' : '  ✗'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) fails.push(label)
}

const browser = await chromium.launch()
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  locale: LANG === 'en' ? 'en-US' : 'zh-CN',
})
const page = await ctx.newPage()
page.on('pageerror', (e) => say(`  ⚠ pageerror: ${e.message}`))

await page.goto(`${UI}/?v=2&mode=live&lang=${LANG}&look=${LOOK}`, { waitUntil: 'networkidle' })
if (await page.locator('.lite-onboard, .lite-gate-layer').count()) {
  await page.keyboard.press('Escape')
  await page.waitForTimeout(600)
}
check('构建指着本轮后端', (await page.evaluate(() => window.__AVERY_BUILD__?.apiBase)) === API)

say('── 上传带工号的花名册 + 一份项目文档 ────────────────────')
await page.evaluate(async ({ roster, projects }) => {
  const mk = (name, text) => new File([new TextEncoder().encode(text)], name, { type: 'text/markdown' })
  await window.__lite2Store.getState().uploadFiles([mk('花名册.md', roster), mk('项目总览.md', projects)])
}, { roster: ROSTER, projects: PROJECTS })
await page.waitForTimeout(4000)
const projs = await page.evaluate(() => (window.__lite2Store.getState().team?.projects || [])
  .map((p) => `${p.id}|${p.title}`))
check('自证：项目卡长出来了（否则下面「有项目可绑」整段是空判据）', projs.length === 1, JSON.stringify(projs))

// 工号有没有真的走到浏览器（后端 team_cards 投影 → transport → LitePerson.personId）
const people = await page.evaluate(() => (window.__lite2Store.getState().team?.people || [])
  .map((p) => ({ name: p.name, pid: p.personId ?? null, team: p.team })))
say(`  人卡：${JSON.stringify(people)}`)
check('工号投到前端了', people.every((p) => typeof p.pid === 'string' && p.pid.startsWith('SY-')),
  JSON.stringify(people.map((p) => p.pid)))
check('同名两位分得开', people.filter((p) => p.name === '林小满').length === 2)

// 分得开之后还得**看得出来是谁**：截图人眼过时逮到选人那排出现两个一模一样的「林小满」。
const chipTexts = await page.evaluate(() => {
  window.__lite2Store.getState().goScreen('files')
  return null
})
void chipTexts
await page.waitForTimeout(2500)
const lins = await page.locator('.lite-files-forms-chip', { hasText: '林小满' }).allInnerTexts()
say(`  同名两个 chip：${JSON.stringify(lins)}`)
check('重名的 chip 补了部门（否则经理不知道该点哪个）',
  lins.length === 2 && lins.some((t) => t.includes('前厅部')) && lins.some((t) => t.includes('康乐部')),
  JSON.stringify(lins))
check('不重名的 chip 不补部门（不制造噪音）',
  !(await page.locator('.lite-files-forms-chip', { hasText: '陈明远' }).innerText()).includes('厨房'))

say('── 选人 → 「这几份周报各自关于哪个项目」──────────────────')
check('没选人时绑项目那块不出现', (await page.locator('.lite-files-forms-bind').count()) === 0)
await page.locator('.lite-files-forms-chip', { hasText: '周雅' }).click()
await page.locator('.lite-files-forms-chip', { hasText: '陈明远' }).click()
await page.waitForTimeout(400)
check('选了人之后绑项目那块出来了', (await page.locator('.lite-files-forms-bind').count()) === 1)
const rows = await page.locator('.lite-files-forms-bind-row').count()
check('选了几个人就有几行', rows === 2, `${rows} 行`)
const opts = await page.locator('.lite-files-forms-bind-select').first().locator('option').allInnerTexts()
say(`  下拉选项：${JSON.stringify(opts)}`)
check('默认是「不绑项目」', opts[0] === W.none, opts[0])
check('项目列进了选项', opts.some((o) => o.includes('宴会厅翻台提速')), JSON.stringify(opts))
const defaultValue = await page.locator('.lite-files-forms-bind-select').first().inputValue()
check('默认值是空（不替经理猜一个项目）', defaultValue === '', JSON.stringify(defaultValue))
if (SHOTS) await page.locator('.lite-files-forms').screenshot({ path: `${SHOTS}/hitl-bind-${LANG}-1-picker.png` })

// 只给周雅绑，陈明远留空——两条腿要能同时验：绑了的进项目卡，没绑的不进。
const zhouRow = page.locator('.lite-files-forms-bind-row', { hasText: '周雅' })
await zhouRow.locator('.lite-files-forms-bind-select').selectOption({ label: '宴会厅翻台提速' })
await page.waitForTimeout(300)

say('── 铸链：工号与绑定都要真的送出去 ──────────────────────')
await page.locator('.lite-files-forms-mint').click()
await page.waitForTimeout(3000)
const minted = await page.evaluate(() => (window.__lite2Store.getState().formsMinted?.links || [])
  .map((l) => ({ name: l.person_name, pid: l.person_id, ref: l.project_ref, link: l.link })))
say(`  铸出：${JSON.stringify(minted)}`)
check('两条都铸出来了', minted.length === 2)
const zhou = minted.find((m) => m.name === '周雅')
const chen = minted.find((m) => m.name === '陈明远')
check('周雅那条带着她的工号', zhou?.pid === 'SY-0308', zhou?.pid)
check('周雅那条绑上了项目', zhou?.ref === '宴会厅翻台提速', zhou?.ref)
check('没绑的那条 project_ref 是空的（不替经理补一个）', !chen?.ref, JSON.stringify(chen?.ref))

say('── 「谁交了」要看得出绑了什么 ──────────────────────────')
const statusText = await page.locator('.lite-files-forms-status').innerText()
say(`  状态区：${JSON.stringify(statusText.replace(/\s+/g, ' '))}`)
check('绑了的那行说出了项目', W.about.test(statusText) && statusText.includes('宴会厅翻台提速'),
  JSON.stringify(statusText.replace(/\s+/g, ' ')))
check('没绑的那行不编一句「未绑定」',
  (statusText.match(new RegExp('宴会厅翻台提速', 'g')) || []).length === 1)
if (SHOTS) await page.locator('.lite-files-forms').screenshot({ path: `${SHOTS}/hitl-bind-${LANG}-2-minted.png` })

say('── 员工填 → 原话进那张项目卡 ───────────────────────────')
const RISK = '传菜等位超过八分钟，宴会厅这周缺一个人。'
const emp = await ctx.newPage()
await emp.goto(`${zhou.link}?lang=${LANG}`, { waitUntil: 'networkidle' })
await emp.locator('textarea[name="f_done"]').fill('晚市做了 120 桌，翻台三轮。')
await emp.locator('textarea[name="f_missed"]').fill(RISK)
await emp.locator('textarea[name="f_next_goal"]').fill('把等位压到五分钟。')
await emp.locator('input[name="f_load"]').evaluate((el) => {
  el.value = '72'; el.dispatchEvent(new Event('input', { bubbles: true }))
})
const moodId = await emp.locator('input[name="f_mood"][value="偏紧"]').getAttribute('id')
await emp.locator(`label[for="${moodId}"]`).click()
await emp.locator('button[type="submit"], input[type="submit"]').first().click()
await emp.waitForTimeout(2500)
await emp.close()

await page.evaluate(async () => { await window.__lite2Store.getState().refreshTeam() })
await page.waitForTimeout(2000)
const project = await page.evaluate(() => {
  const p = (window.__lite2Store.getState().team?.projects || [])[0]
  return { title: p?.title, blockers: p?.blockers || [] }
})
say(`  项目卡：${JSON.stringify(project)}`)
check('绑了项目，员工的原话就进了那张项目卡',
  project.blockers.some((b) => b.includes('传菜等位超过八分钟')), JSON.stringify(project.blockers))

await page.evaluate(() => window.__lite2Store.getState().openDetail('project', 'p_宴会厅翻台提速'))
await page.waitForTimeout(1500)
const prov = await page.evaluate(() =>
  [...document.querySelectorAll('.lite-detail-provenance')].map((e) => (e.textContent || '').trim()))
check('阻塞旁边标着来自周报填写', prov.some((p) => W.formBadge.test(p)), JSON.stringify(prov))
if (SHOTS) await page.screenshot({ path: `${SHOTS}/hitl-bind-${LANG}-3-project.png` })

await browser.close()
say('')
say(fails.length === 0 ? `全部通过（${LANG}/${LOOK}）` : `失败 ${fails.length} 条：\n  - ${fails.join('\n  - ')}`)
process.exit(fails.length === 0 ? 0 : 1)
