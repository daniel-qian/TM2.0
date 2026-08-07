// gap2 T11 · 模板拼装器门 —— 资料库屏第④段里「建/改表」那一整块的行为门。
//
// ## 这道门为什么存在
// T11 把三件从来没有过界面的事接上了：建表、改表、让 Avery 读旧表格起草。三件都只在**真
// HTTP 通道**下存在（`saveFormTemplate` / `draftFormFromFile` 在 LiveTransport 上是可选方法，
// stub 通道天然没有 → `formTemplates===null` → 整段一个像素都不渲染）。所以：
//   · `?transport=stub` 在这道门上是**死路**，必须真上传、真打本地 mock 后端；
//   · 像素基线看不见这一段（它走 stub），本门是这一段唯一的自动化眼睛。
//
// ## 🔴 判据里最要紧的那一条：「已经有人交过答案的那一格，禁改禁删」
// 答案按 `field.id` 落、模板又没有版本列，所以删掉一个被引用过的 id = 去年那份提交里的答案
// 再也说不出自己在回答什么。服务端 `gate_used_fields` 是最后一道门（后端门在
// `tests/test_form_builder_t11.py`），**本门量的是界面这一侧**：题型 select 锁死、删除键换成
// 停用。两道门是**独立的两把锁**——拆掉任何一道，另一道都还在，所以两边各自都杀得死。
//
// ## 判据不许打在「某个类名存在」上
// 一律打在**经理真能看见/真能点**的东西上：按钮的可用态、select 的 disabled、屏幕上那句话的
// 文本、保存之后模板列表里真的多了一张表。换一套类名重新实现同一个谎，照样红。
//
// 跑法（隔离端口版，与 T8 收官那一轮同形）：
//   后端 AVERY_BRAIN=mock AVERY_EXTRACTOR=heuristic AVERY_EMBEDDINGS=keyword uvicorn :8137
//   前端 vite build --mode development && vite preview --port 5173 --host
//   VERIFY_BASE=http://localhost:5173 node eval-harness/tools/verify-form-builder.mjs
import { bootPage, makeRec, finish } from './lib/gate-run.mjs'

const BASE = process.env.VERIFY_BASE || 'http://localhost:5173'
const URL = `${BASE}/?v=2&mode=live&lang=zh`
const SEAM = '__lite2Store'

// 花名册：拼装器要能建表**不依赖**花名册，但铸链要人可选，所以给一份最小的。
// ⚠ 真带中文字节（MEMORY：门语料全 ASCII 盲点）。
const ROSTER = `# 员工花名册

| 人员ID | 姓名 | 岗位 |
| --- | --- | --- |
| P-0007 | 周雅 | 传菜领班 |
| P-0011 | 林小满 | 前厅主管 |
`

// 一份「旧表格」——起草入口读的就是它。表头一行四格，其中一格带红线字眼（起草层必须丢掉
// 并说明），另一格是「是否…」（表头本身唯一能读出控件类型的信号）。
const OLD_SHEET = `本周工作汇报表

项目名称｜本周进展｜是否需要支援｜员工绩效排名
海棠湾一期｜开了三场直播｜是｜A
`

const { rows, rec } = makeRec()
const { browser, page, pageErrors } = await bootPage({
  url: URL,
  trackPageErrors: true,
})

// 数真的发出去的保存请求。⚠ 这一条来自变异测试：初版判据是「点完保存后 formBuilderBusy
// 仍是 idle」，而那是个**恒绿的空判据**——忙态早在断言之前就回落了，发没发请求它都说 idle。
// 拆掉上限镜像的变异（checkFormShape 恒返回 []）在它底下活了下来。真判据只能是「网络上
// 到底有没有那一发 POST」。
let savePosts = 0
page.on('request', (r) => {
  if (r.method() === 'POST' && /\/forms$/.test(new globalThis.URL(r.url()).pathname)) savePosts += 1
})

// ── ⓪ 真上传造一个工作区（stub 通道没有这三个端点，这道门只能走真后端）──────────────────
await page.evaluate(
  async ({ roster, sheet, seam }) => {
    const enc = new TextEncoder()
    await window[seam].getState().uploadFiles([
      new File([enc.encode(roster)], '员工花名册.md', { type: 'text/markdown' }),
      new File([enc.encode(sheet)], '老周报表.md', { type: 'text/markdown' }),
    ])
  },
  { roster: ROSTER, sheet: OLD_SHEET, seam: SEAM },
)
await page
  .waitForFunction(
    (seam) => ['ready', 'error'].includes(window[seam].getState().ingestStatus),
    SEAM,
    { timeout: 30000 },
  )
  .catch(() => {})
const ingestStatus = await page.evaluate((seam) => window[seam].getState().ingestStatus, SEAM)
rec('⓪ 上传成功（本门的地基：没有 contextId 就整段不渲染，绿也是空跑）', ingestStatus === 'ready',
  `ingestStatus=${ingestStatus}`)

await page.evaluate((seam) => window[seam].getState().goScreen('files'), SEAM)
await page.waitForTimeout(1200)

// 自证判据：整段真的渲染出来了。少了它，下面每一条「找不到 X」都会被当成「X 正确地不存在」。
const sectionCount = await page.locator('.lite-files-forms').count()
rec('⓪ 常驻表单那一段真的在屏上（自证：不是在一个空屏上断言）', sectionCount === 1,
  `.lite-files-forms × ${sectionCount}`)

const builderRoot = page.locator('.lite-files-forms-builder')
rec('⓪ 拼装器整块在屏上', (await builderRoot.count()) === 1)

const text = () => page.locator('.lite-files-forms').innerText()

// ── ① 三个入口 ────────────────────────────────────────────────────────────────────────────
const entries = await page.locator('.lite-files-forms-builder-entry').allInnerTexts()
rec('① 入口一：能从零建一张表', entries.some((t) => t.includes('建一张表')), JSON.stringify(entries))
rec('① 入口二：能照内置周报改一张', entries.some((t) => t.includes('照「周报」改一张')),
  JSON.stringify(entries))
rec('① 入口三：能让 Avery 读一份旧表格起草', entries.some((t) => t.includes('旧表格')),
  JSON.stringify(entries))
const editEntries = await page.locator('.lite-files-forms-builder-edit').allInnerTexts()
rec('① 改现有表的入口在（改的是那张表本身，不是复制一张）',
  editEntries.some((t) => t.includes('改「周报」')), JSON.stringify(editEntries))

// ── ② 建一张新表：题型词表 + 三个语义开关的去向说明 ──────────────────────────────────────
await page.locator('.lite-files-forms-builder-entry', { hasText: '建一张表' }).click()
await page.waitForTimeout(200)

const kinds = await page.locator('.lite-files-forms-builder-select option').allInnerTexts()
rec('② 四种控件都在（text / choice / number / yesno）', kinds.length === 4,
  JSON.stringify(kinds))
rec('② 「是或否」这一种真的出现在题型里（本票新增的控件）', kinds.some((k) => k.includes('是或否')),
  JSON.stringify(kinds))

// 🔴 上卡 / 只进资料库必须**在界面上分得清**（拍板 #4：不许暗示「加字段=自动长卡」）。
const goesText0 = await page.locator('.lite-files-forms-builder-field .lite-files-forms-note').first().innerText()
rec('② 没勾任何开关的题，界面明说它只进资料库、不上卡',
  goesText0.includes('只进资料库') && goesText0.includes('不上任何卡'), goesText0)

// 勾上「哪儿卡住了」→ 同一句话必须翻面成「会上人卡」。
await page.locator('.lite-files-forms-builder-switch', { hasText: '哪儿卡住了' }).locator('input').check()
await page.waitForTimeout(150)
const goesText1 = await page.locator('.lite-files-forms-builder-field .lite-files-forms-note').first().innerText()
rec('② 勾上开关之后，同一句话改口说「会上他的人卡」', goesText1.includes('人卡'), goesText1)

// 开关只对**读得到它的题型**开放：自述那两个在 text 题上必须是灰的（死开关不许勾得上）。
const loadDisabled = await page
  .locator('.lite-files-forms-builder-switch', { hasText: '有多忙' })
  .locator('input')
  .isDisabled()
rec('② 自述开关在读不到它的题型上是灰的（标了也读不到 = 死开关，界面不许让人勾）',
  loadDisabled === true)

// ── ③ 上限镜像：本地就拦住并说清哪一条 ───────────────────────────────────────────────────
// 题面留空直接保存：这一步**必须**在本地就给出「第 1 题还没写题目」，不是发一趟请求换回
// 一句英文 reason。
const postsBeforeReject = savePosts
await page.locator('.lite-files-forms-builder-save').click()
await page.waitForTimeout(800)
const issues = await page.locator('.lite-files-forms-builder-issues li').allInnerTexts()
rec('③ 空题面在本地就被拦住，并说清是第几题',
  issues.some((t) => t.includes('第 1 题') && t.includes('还没写题目')), JSON.stringify(issues))
rec('③ 表名没填也一并说了（一次列全，不是改一条报一条）',
  issues.some((t) => t.includes('还没有名字')), JSON.stringify(issues))
rec('③ 被本地拦下时**一发请求都没出去**（判据是网络，不是一个早已回落的忙态标志）',
  savePosts === postsBeforeReject, `POST /forms × ${savePosts - postsBeforeReject}`)

// 加到 12 题：「加一题」必须置灰，且旁边那行计数说清是哪条上限。
await page.locator('#lite-forms-builder-title').fill('值班交接')
await page.locator('.lite-files-forms-builder-field input[type=text]').first().fill('这一班要交代什么')
for (let i = 0; i < 11; i += 1) {
  await page.locator('.lite-files-forms-builder-add').click()
}
await page.waitForTimeout(200)
const countLine = await page.locator('.lite-files-forms-builder-addrow .lite-files-forms-note').innerText()
rec('③ 到顶时计数行说清是 12 题这条上限', countLine.includes('12') && countLine.includes('12'),
  countLine)
rec('③ 到顶后「加一题」置灰（服务端 422 之前前端就拦住了）',
  (await page.locator('.lite-files-forms-builder-add').isDisabled()) === true)

// 退回到两题，填好题面，保存。
for (let i = 0; i < 10; i += 1) {
  await page.locator('.lite-files-forms-builder-drop').last().click()
}
await page.waitForTimeout(150)
const labelInputs = page.locator('.lite-files-forms-builder-field > input[type=text]')
await labelInputs.nth(1).fill('哪儿卡住了')
// 第二题标成「处境」，这样它的答案会长成人卡上的情境信号。
await page
  .locator('.lite-files-forms-builder-field')
  .nth(1)
  .locator('.lite-files-forms-builder-switch', { hasText: '哪儿卡住了' })
  .locator('input')
  .check()
await page.locator('.lite-files-forms-builder-save').click()
await page.waitForFunction(
  (seam) => window[seam].getState().formBuilderBusy === 'idle',
  SEAM,
  { timeout: 15000 },
)
await page.waitForTimeout(600)

const afterSave = await text()
rec('④ 新表真的落库并出现在模板列表里（判据打在屏上那张表，不是本地拼装出来的乐观态）',
  afterSave.includes('值班交接'), afterSave.slice(0, 400))
const titles = await page.evaluate(
  (seam) => (window[seam].getState().formTemplates ?? []).map((t) => t.title), SEAM)
rec('④ 保存后从权威 /forms 重拉过（store 里那张表是服务端给的）',
  titles.includes('值班交接'), JSON.stringify(titles))
rec('④ 编辑器保存成功后收起（没有停在一个已经存过的表单上）',
  (await page.locator('.lite-files-forms-builder.is-open').count()) === 0)

// ── ⑤ 三个语义开关往返不丢（`situational` 当年就是在这条路上被静默抹平的）───────────────
const savedFields = await page.evaluate((seam) => {
  const tpl = (window[seam].getState().formTemplates ?? []).find((t) => t.title === '值班交接')
  return (tpl?.fields ?? []).map((f) => ({
    id: f.id, kind: f.kind, situational: f.situational, self_report: f.self_report,
    retired: f.retired,
  }))
}, SEAM)
rec('⑤ situational 标记穿过 HTTP 往返活了下来（漏传它 = 回流从此不响且不报错）',
  savedFields.some((f) => f.situational === true), JSON.stringify(savedFields))
rec('⑤ 三个开关字段都在回执里（不是被后端默认值悄悄补上的）',
  savedFields.every((f) => 'situational' in f && 'self_report' in f && 'retired' in f),
  JSON.stringify(savedFields))

// ── ⑥ 已被答过的 field.id 禁改禁删（🔴 本门的核心判据，变异靶）─────────────────────────
// 给这张新表铸一条链、真填一份，再回来开编辑器。
const tplId = await page.evaluate((seam) =>
  (window[seam].getState().formTemplates ?? []).find((t) => t.title === '值班交接')?.id, SEAM)
const link = await page.evaluate(
  async ({ seam, id }) => {
    const st = window[seam].getState()
    await st.createFormLinks(id, [{ id: 'P-0007', name: '周雅', project_ref: '' }])
    const minted = window[seam].getState().formsMinted
    return minted?.links?.[0]?.link ?? ''
  },
  { seam: SEAM, id: tplId },
)
rec('⑥ 铸出了一条可填的链接（自证：下面那条「禁改禁删」需要一份真答案撑着）',
  link.startsWith('http'), link)

const employee = await browser.newContext({ viewport: { width: 390, height: 844 } })
const phone = await employee.newPage()
await phone.goto(link, { waitUntil: 'networkidle' })
const phoneText = await phone.locator('body').innerText()
rec('⑥ 员工页问的是经理刚建的那两题（不是内置周报）',
  phoneText.includes('这一班要交代什么') && phoneText.includes('哪儿卡住了'),
  phoneText.slice(0, 300))
await phone.locator('textarea').first().fill('冷库门没关严，已经报修。')
await phone.locator('textarea').nth(1).fill('洗碗机坏了，晚市全靠手洗。')
await phone.locator('.h5-submit').click()
await phone.waitForTimeout(800)
rec('⑥ 员工那份交上去了', (await phone.locator('body').innerText()).includes('已收到'))
await employee.close()

await page.evaluate((seam) => window[seam].getState().refreshForms(), SEAM)
await page.waitForTimeout(1200)
await page.locator('.lite-files-forms-builder-edit', { hasText: '值班交接' }).click()
await page.waitForTimeout(300)

const kindSelects = page.locator('.lite-files-forms-builder-select')
rec('⑥ 🔴 已经有人答过的那一格，题型锁死（换 kind = 让那句答案变成另一种东西）',
  (await kindSelects.first().isDisabled()) === true)
rec('⑥ 🔴 已经有人答过的那一格，没有删除键',
  (await page.locator('.lite-files-forms-builder-drop').count()) === 0)
const retireSwitches = await page
  .locator('.lite-files-forms-builder-switch', { hasText: '以后不问这一题了' })
  .count()
rec('⑥ 🔴 给的是「停用」——不再问，但 id 留在表上，历史答案仍对得上号', retireSwitches === 2)
const lockedHint = await page.locator('.lite-files-forms-builder-fieldactions .lite-files-forms-note').first().innerText()
rec('⑥ 界面说清了为什么这里没有删除键（不是一个没解释的灰按钮）',
  lockedHint.includes('已经有人答过'), lockedHint)

// 改题面仍然放行——禁的是篡改，不是编辑。
await page.locator('.lite-files-forms-builder-field > input[type=text]').first().fill('这一班有什么要交代的')
await page.locator('.lite-files-forms-builder-save').click()
await page.waitForFunction((seam) => window[seam].getState().formBuilderBusy === 'idle', SEAM,
  { timeout: 15000 })
await page.waitForTimeout(600)
const renamed = await page.evaluate((seam) => {
  const tpl = (window[seam].getState().formTemplates ?? []).find((t) => t.title === '值班交接')
  return (tpl?.fields ?? []).map((f) => f.label)
}, SEAM)
rec('⑥ 改题面照旧放行（答案按 id 落，改 label 安全）',
  renamed.includes('这一班有什么要交代的'), JSON.stringify(renamed))
rec('⑥ 这一次保存没有报错（禁改禁删这道门没有误伤正常编辑）',
  (await page.evaluate((seam) => window[seam].getState().formBuilderError, SEAM)) === null)

// ── ⑦ 起草：提案不落库、诚实标注、丢掉的说清楚 ───────────────────────────────────────────
const before = await page.evaluate((seam) => (window[seam].getState().formTemplates ?? []).length, SEAM)
await page.locator('.lite-files-forms-builder-entry', { hasText: '旧表格' }).click()
await page.waitForTimeout(200)
await page.locator('.lite-files-forms-builder-file', { hasText: '老周报表.md' }).click()
await page.waitForFunction((seam) => window[seam].getState().formBuilderBusy === 'idle', SEAM,
  { timeout: 20000 })
await page.waitForTimeout(400)

const noticeText = await page.locator('.lite-files-forms-builder-notice').innerText()
rec('⑦ 起草回执说清了它是**怎么**起草的（mock brain 下必须说「没有理解」，不许讲成读懂了）',
  noticeText.includes('表头') && noticeText.includes('没有理解'), noticeText)
rec('⑦ 起草回执明说这只是提案（经理确认之前什么都不会发出去）',
  noticeText.includes('提案'), noticeText)
const dropped = await page.locator('.lite-files-forms-builder-dropped li').allInnerTexts()
rec('⑦ 🔴 带评分类字眼的那一列被丢掉**并说明**（悄悄少一列比明说危险得多）',
  dropped.some((t) => t.includes('员工绩效排名') && t.includes('红线')), JSON.stringify(dropped))
const draftedLabels = await page
  .locator('.lite-files-forms-builder-field > input[type=text]')
  .evaluateAll((els) => els.map((e) => e.value))
rec('⑦ 旧表格的表头变成了题目（逐字，不是我们替客户重写的）',
  draftedLabels.includes('项目名称') && draftedLabels.includes('本周进展'),
  JSON.stringify(draftedLabels))
// ⚠ 题面住在 `<input value>` 里，不是文本节点——`hasText` 对它是瞎的（写这条门时先按
// hasText 写，30s 超时才发现）。所以逐格把「题面 → 题型」配对读出来再问。
const draftedKinds = await page.locator('.lite-files-forms-builder-field').evaluateAll((els) =>
  els.map((el) => ({
    label: el.querySelector('input[type=text]')?.value ?? '',
    kind: el.querySelector('select')?.value ?? '',
  })),
)
rec('⑦ 「是否…」被认成了是/否题（表头本身唯一能读出的控件类型）',
  draftedKinds.find((f) => f.label === '是否需要支援')?.kind === 'yesno',
  JSON.stringify(draftedKinds))
rec('⑦ 其余表头没有被瞎猜控件类型（读不出来就是自由文本，宁可少断言）',
  draftedKinds.filter((f) => f.label !== '是否需要支援').every((f) => f.kind === 'text'),
  JSON.stringify(draftedKinds))
const after = await page.evaluate((seam) => (window[seam].getState().formTemplates ?? []).length, SEAM)
rec('⑦ 🔴 起草一个字都没落库（提案不是模板）', after === before, `${before} → ${after}`)

// 确认这份提案 → 走既有的保存路，必须 200（红线在起草层已经落地，不许在这一刻吃 422）。
await page.locator('#lite-forms-builder-title').fill('本周工作汇报表')
await page.locator('.lite-files-forms-builder-save').click()
await page.waitForFunction((seam) => window[seam].getState().formBuilderBusy === 'idle', SEAM,
  { timeout: 15000 })
await page.waitForTimeout(600)
rec('⑦ 🔴 经理点确认没有吃 422（起草层与写侧门用的是同一把尺）',
  (await page.evaluate((seam) => window[seam].getState().formBuilderError, SEAM)) === null,
  JSON.stringify(await page.evaluate((seam) => window[seam].getState().formBuilderError, SEAM)))

// ── ⑧ 员工页：新控件真的渲染成了该有的样子 ───────────────────────────────────────────────
const scaleTplId = await page.evaluate(async (seam) => {
  const st = window[seam].getState()
  await st.saveFormTemplate({
    title: '本周自评',
    fields: [
      { id: 'conf', kind: 'number', label: '这件事你有多大把握做完', help: '', required: true,
        choices: [], min: 1, max: 5, situational: false, self_report: '', retired: false },
      { id: 'need', kind: 'yesno', label: '是否需要支援', help: '', required: true,
        choices: [], min: 0, max: 100, situational: false, self_report: '', retired: false },
    ],
  })
  return (window[seam].getState().formTemplates ?? []).find((t) => t.title === '本周自评')?.id
}, SEAM)
const scaleLink = await page.evaluate(
  async ({ seam, id }) => {
    await window[seam].getState().createFormLinks(id, [{ id: 'P-0011', name: '林小满', project_ref: '' }])
    return window[seam].getState().formsMinted?.links?.[0]?.link ?? ''
  },
  { seam: SEAM, id: scaleTplId },
)
const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 } })
const phone2 = await ctx2.newPage()
await phone2.goto(scaleLink, { waitUntil: 'networkidle' })
rec('⑧ 1~5 分渲染成一排按钮（不是滑杆——滑杆恒有值，没人选过也会交上来一个数）',
  (await phone2.locator('.h5-scale input[type=radio]').count()) === 5)
rec('⑧ 是/否渲染成两个按钮，线上值是 ASCII 的 yes/no',
  (await phone2.locator('.h5-yn input[value="yes"]').count()) === 1 &&
    (await phone2.locator('.h5-yn input[value="no"]').count()) === 1)
const phone2Text = await phone2.locator('body').innerText()
rec('⑧ 中文壳上员工看到的是「是 / 否」（本地化只在文案层，不在提交值上）',
  phone2Text.includes('是') && phone2Text.includes('否'))
await ctx2.close()

rec('⑨ 全程没有 pageerror', pageErrors.length === 0, JSON.stringify(pageErrors.slice(0, 3)))

await finish({ rows, rec }, { label: '模板拼装器（gap2 T11）', browser })
