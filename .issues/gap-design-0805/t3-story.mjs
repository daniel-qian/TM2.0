// T3 · 线一完整故事的浏览器取证：建链 → 员工填 → 资料库出现 → 状态更新。
// 走真 HTTP transport（build 已 bake VITE_AVERY_API_BASE=127.0.0.1:8199）+ 真 mock 后端。
// ⚠ 不用 ?transport=stub —— stub 没有 forms 三个方法，整段判空不渲染（这正是设计）。
import { chromium } from 'playwright'

const UI = process.env.VERIFY_BASE || 'http://127.0.0.1:5199'
const SHOTS = process.env.SHOT_DIR
const LANG = process.env.LANG_CODE || 'zh'
const LOOK = process.env.LOOK || 'paper'

// 🔴 花名册必须走 `_people_from_roster` 认得的竖线表格（格式与
// eval-harness/tests/fixtures/demo-seed/员工花名册.md 同款）。第一版用「人员ID：…｜姓名：…」
// 写，抽取器一个人都没解析出来 → roster 空 → 本段按否决④ 整段不渲染。
// 那次「红」是**语料的锅不是部件的锅**，但它顺带证明了否决④ 真的在工作。
// 语料含中文字节（memory：门语料全 ASCII 盲点）。
const ROSTER = [
  '# 望江酒店 · 员工花名册',
  '',
  '姓名 | 职位 | 部门 | 司龄 | 负责',
  '周雅 | 传菜领班 | 前厅部 | 3 年 | 宴会厅传菜动线与现场服务',
  '陈明远 | 中餐厨师长 | 厨房 | 7 年 | 各菜系出品与宴会菜单研发',
  '林小满 | 前厅部经理 | 前厅部 | 5 年 | 前台礼宾总机与行政楼层统筹',
  '',
  '## 项目：宴会厅翻台提速',
  '负责人：周雅',
  '状态：正常',
  '',
].join('\n')

// 断言里出现的文案随语言走——第一版把中文写死，en 那一轮 5 条假红全是脚本自己的锅。
const W = LANG === 'en'
  ? { open: 'Not yet', submitted: 'Sent in', copied: 'Copied', ingested: 'Read' }
  : { open: '还没交', submitted: '已交', copied: '已复制', ingested: '已读取' }

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

await page.goto(`${UI}/?v=2&mode=live&lang=${LANG}&look=${LOOK}`, { waitUntil: 'networkidle' })
if (await page.locator('.lite-onboard, .lite-gate-layer').count()) {
  await page.keyboard.press('Escape')
  await page.waitForTimeout(600)
}

say('── 段落不该出现的时候（还没上传）────────────────────────')
await page.evaluate(() => window.__lite2Store.getState().goScreen('files'))
await page.waitForTimeout(700)
check('没有 contextId 时整段不渲染', (await page.locator('.lite-files-forms').count()) === 0)

say('── 上传花名册 ──────────────────────────────────────────')
await page.evaluate(async (doc) => {
  const f = new File([new TextEncoder().encode(doc)], '花名册.md', { type: 'text/markdown' })
  await window.__lite2Store.getState().uploadFiles([f])
}, ROSTER)
await page.waitForTimeout(2500)
const cid = await page.evaluate(() => window.__lite2Store.getState().contextId)
say(`  context_id = ${cid}`)

await page.evaluate(() => window.__lite2Store.getState().goScreen('files'))
await page.waitForTimeout(2500)

say('── ④ 段渲染出来了吗 ────────────────────────────────────')
check('常驻表单段在场', (await page.locator('.lite-files-forms').count()) === 1)
check('小节标题在场', (await page.locator('.lite-files-forms .lite-files-section-title').count()) === 1)
const tplText = await page.locator('.lite-files-forms-template').first().innerText().catch(() => '')
say(`  模板行：${JSON.stringify(tplText)}`)
check('模板题面预览含 06 表表头原文', tplText.includes('已完成事实') && tplText.includes('负载自述'))
const chips = await page.locator('.lite-files-forms-chip').count()
check('花名册 chip 渲染', chips === 3, `${chips} 个`)
const mintDisabled = await page.locator('.lite-files-forms-mint').isDisabled()
check('一个人都没选时生成键置灰', mintDisabled)
check('还没铸链时「谁交了」不渲染', (await page.locator('.lite-files-forms-status-block').count()) === 0)
if (SHOTS) await page.locator('.lite-files-forms').screenshot({ path: `${SHOTS}/t3-${LANG}-${LOOK}-1-idle.png` })

say('── 选人 → 生成本期链接 ────────────────────────────────')
await page.locator('.lite-files-forms-chip', { hasText: '周雅' }).click()
await page.locator('.lite-files-forms-chip', { hasText: '陈明远' }).click()
await page.waitForTimeout(300)
check('选中后生成键可用', !(await page.locator('.lite-files-forms-mint').isDisabled()))
await page.locator('.lite-files-forms-mint').click()
await page.waitForTimeout(2500)

const linkRows = await page.locator('.lite-files-forms-link-row').count()
check('铸出两条链接', linkRows === 2, `${linkRows} 行`)
const firstUrl = await page.locator('.lite-files-forms-link-url').first().innerText()
say(`  第一条链接：${firstUrl}`)
check('链接指向本机后端（服务端拼的，不是前端自造）', firstUrl.startsWith('http://127.0.0.1:8199/f/'))
const statusRows = await page.locator('.lite-files-forms-status-row').count()
check('「谁交了」长出两行', statusRows === 2, `${statusRows} 行`)
const statusText = await page.locator('.lite-files-forms-status').innerText()
say(`  状态区：${JSON.stringify(statusText)}`)
check(`两行都是「${W.open}」`, statusText.split(W.open).length - 1 === 2)
if (SHOTS) await page.locator('.lite-files-forms').screenshot({ path: `${SHOTS}/t3-${LANG}-${LOOK}-2-minted.png` })

say('── 复制按钮 ────────────────────────────────────────────')
await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: UI })
await page.locator('.lite-files-forms-copy').first().click()
await page.waitForTimeout(400)
const copyLabel = await page.locator('.lite-files-forms-copy').first().innerText()
check(`复制后按钮改口「${W.copied}」`, copyLabel.trim() === W.copied, copyLabel)
const clip = await page.evaluate(() => navigator.clipboard.readText()).catch(() => '')
check('剪贴板里真是那条链接', clip === firstUrl, clip.slice(0, 48))

say('── 员工手机打开链接并填完提交 ─────────────────────────')
const emp = await ctx.newPage()
await emp.goto(firstUrl, { waitUntil: 'networkidle' })
check('员工页 200 且是表单页', (await emp.locator('form').count()) > 0)
await emp.locator('textarea[name="f_done"]').fill('晚市做了 120 桌，翻台三轮')
await emp.locator('textarea[name="f_missed"]').fill('传菜等位超 8 分钟，缺一个人')
await emp.locator('textarea[name="f_next_goal"]').fill('把等位压到 5 分钟')
await emp.locator('input[name="f_load"]').evaluate((el) => {
  el.value = '72'
  el.dispatchEvent(new Event('input', { bubbles: true }))
})
// T1 的员工页把 radio 视觉隐藏、点的是 label（真人也是点 label）——直接 check() 那个
// input 会一直等「元素可见」等到超时。
const moodId = await emp.locator('input[name="f_mood"][value="偏紧"]').getAttribute('id')
await emp.locator(`label[for="${moodId}"]`).click()
check('情绪选中了', await emp.locator('input[name="f_mood"][value="偏紧"]').isChecked())
if (SHOTS) await emp.screenshot({ path: `${SHOTS}/t3-employee-form.png`, fullPage: true })
await emp.locator('button[type="submit"], input[type="submit"]').first().click()
await emp.waitForTimeout(2500)
const thanks = await emp.innerText('body')
say(`  提交后员工看到：${JSON.stringify(thanks.slice(0, 90))}`)
check('员工看到已收到', /已收到|收到了|thank/i.test(thanks))
if (SHOTS) await emp.screenshot({ path: `${SHOTS}/t3-employee-thanks.png`, fullPage: true })
await emp.close()

say('── 回到资料库：状态更新 + 当前资料多一行 ───────────────')
await page.evaluate(() => window.__lite2Store.getState().goScreen('team'))
await page.waitForTimeout(400)
await page.evaluate(() => window.__lite2Store.getState().goScreen('files'))
await page.evaluate(() => window.__lite2Store.getState().refreshFiles())
await page.waitForTimeout(2500)

const statusAfter = await page.locator('.lite-files-forms-status').innerText()
say(`  状态区：${JSON.stringify(statusAfter)}`)
// ⚠ 别用模板字符串拼正则：`[\s\S]` 在模板字符串里会被当转义吃成 `[sS]`，那个字符类只匹配
// 字母 s/S，于是断言恒假（本脚本真栽过一次）。这里改成按行找，判据更直白也不会被转义咬。
const lineFor = (text, name) =>
  text.split('\n').findIndex((ln) => ln.trim() === name)
const followedBy = (text, name, word) => {
  const lines = text.split('\n')
  const i = lineFor(text, name)
  return i >= 0 && lines.slice(i + 1, i + 3).some((ln) => ln.includes(word))
}
check(`周雅变成「${W.submitted}」`, followedBy(statusAfter, '周雅', W.submitted))
check(`陈明远仍是「${W.open}」`, followedBy(statusAfter, '陈明远', W.open))
const fileNames = await page.locator('.upload-file-name').allInnerTexts()
say(`  当前资料：${JSON.stringify(fileNames)}`)
check('资料库出现周报文档', fileNames.some((n) => n.includes('周报') && n.includes('周雅')))
const weeklyRow = page.locator('.upload-file-row', { hasText: '周报' }).first()
const weeklyStatus = await weeklyRow.locator('.upload-file-status').innerText().catch(() => '')
check('周报那一行状态是已读取（不是「传了读不到」）', weeklyStatus.includes(W.ingested), weeklyStatus)
if (SHOTS) await page.locator('.lite-files-forms').screenshot({ path: `${SHOTS}/t3-${LANG}-${LOOK}-3-submitted.png` })
if (SHOTS) await page.screenshot({ path: `${SHOTS}/t3-${LANG}-${LOOK}-4-fullscreen.png`, fullPage: false })

say('── 屏底家具没劫持控件（elementFromPoint 实打）──────────')
const hijack = await page.evaluate(() => {
  const out = []
  for (const b of document.querySelectorAll('.lite-files-forms button')) {
    const r = b.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) continue
    const x = r.left + r.width / 2
    const y = r.top + r.height / 2
    if (y < 0 || y > window.innerHeight) continue
    const hit = document.elementFromPoint(x, y)
    if (!hit || !(b === hit || b.contains(hit) || hit.contains(b))) {
      out.push({ text: (b.innerText || '').trim().slice(0, 14), hit: String(hit?.className || hit?.tagName).slice(0, 40) })
    }
  }
  return out
})
check('本段可见按钮无一被家具劫持', hijack.length === 0, JSON.stringify(hijack))

say('── 铸链途中换公司：忙态不许卡死（对抗自审逮到的高危，回归门）──')
// 这条路径此前**没有任何门跑过**：门与故事各自都跑过铸链、也跑过换公司，就是没跑过
// 「铸链还在飞的时候换公司」。第一版在两个 stillOn 早退里都没把 formsBusy 放回 idle，
// 而 adoptContext 的公司域清单又不含它 → 生成键在所有公司上永久置灰成「正在生成…」，
// 只有刷新页面能救。这里把那一拍复现出来钉死。
{
  await page.evaluate(() => window.__lite2Store.getState().goScreen('files'))
  await page.waitForTimeout(1200)
  const cid2 = await page.evaluate(() => window.__lite2Store.getState().contextId)
  await page.locator('.lite-files-forms-chip').first().click()
  // 不 await 这次点击引发的网络往返：点下去之后**立刻**换 context，制造竞态。
  await page.locator('.lite-files-forms-mint').click({ noWaitAfter: true })
  await page.evaluate(() => window.__lite2Store.getState().adoptContext('ctx_switched_mid_mint'))
  await page.waitForTimeout(3000)
  const mid = await page.evaluate(() => {
    const s = window.__lite2Store.getState()
    return { busy: s.formsBusy, err: s.formsError, minted: s.formsMinted }
  })
  check('换公司后 formsBusy 回到 idle（不是卡在 minting）', mid.busy === 'idle', `busy=${mid.busy}`)
  check('上一家公司的报错没跟着过来', mid.err === null, `err=${mid.err}`)
  check('上一家公司刚铸的链接没跟着过来', mid.minted === null)
  // 切回去：生成键必须还能用（不是一个永久置灰的死按钮）。
  // ⚠ adoptContext 只换 id、不拉数据（换 id 时还会把 team 清掉），所以要补一次 refreshTeam
  // 把花名册取回来——否则段落按否决④（没人可选、没提交记录）整段不渲染，chip 根本不在。
  // 真流程里这一步由 switchContext 代劳（它先取数据、成功了才换 id）。
  await page.evaluate(async (c) => {
    const s = window.__lite2Store.getState()
    s.adoptContext(c)
    await s.refreshTeam()
  }, cid2)
  await page.waitForTimeout(3000)
  await page.locator('.lite-files-forms-chip').first().click()
  await page.waitForTimeout(300)
  check('切回来后生成键仍然可用', !(await page.locator('.lite-files-forms-mint').isDisabled()))
}

say('── 换公司不串数据（adoptContext 复位点）────────────────')
await page.evaluate(() => window.__lite2Store.getState().adoptContext('ctx_someone_else'))
await page.waitForTimeout(400)
const leaked = await page.evaluate(() => {
  const s = window.__lite2Store.getState()
  return { t: s.formTemplates, s: s.formSubmissions, m: s.formsMinted }
})
check('换 context 后表单三件全清', leaked.t === null && leaked.s === null && leaked.m === null, JSON.stringify(leaked).slice(0, 80))
check('换 context 后整段不渲染', (await page.locator('.lite-files-forms').count()) === 0)

await browser.close()
say('')
say(fails.length === 0 ? `全部通过（${LANG}/${LOOK}）` : `失败 ${fails.length} 条：${fails.join(' | ')}`)
process.exit(fails.length === 0 ? 0 : 1)
