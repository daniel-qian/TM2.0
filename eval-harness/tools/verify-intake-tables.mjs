// 7 张标准表的 app 内录入 —— onboarding-accounts-0805 ②（ADR-0034 拍板 1/2/3/4）。
//
// ## 为什么这道门存在
// 票 #41 要「粘贴解析单测（含中文、含逗号顿号单元格）」，但本仓没有 JS 测试跑器。与其为一个
// 纯函数新装一套 runner，不如把它放进**集成层**量：真浏览器、真剪贴板事件、真网格、真提交。
// 集成层的覆盖是单测的超集——它同时证明了"解析对"和"解析出来的东西真的进了那张表"，
// 而后者恰恰是单测证不到、又最容易坏的一半（记忆：门必须含集成层，fixture 不得自考自答）。
//
// ## 判据
//   A 表定义同源：7 张表都在导航里；当前表的表头**逐字**等于 intakeSchema.ts 里的列（这道门
//     自己从构建产物读不到 TS，所以判据写成"表头非空且列数与后端一致"由 D 段的真提交兜底）。
//   B 粘贴：一段真 TSV（**中文姓名 + 含顿号的「主要负责」+ 引号包裹的含换行单元格**）经
//     真 paste 事件进预览 → 确认 → 16 行落进网格，且含顿号那一格**没有被劈开**。
//   C 单元格级校验：必填空 / 日期格式 / 进度超范围 / 下拉词表外 / 跨表引用悬空（黄）——
//     逐条标在对应的格上（data-issue），提交按钮被 error 挡住。
//   D 红线前移（拍板 2）：07 表写「绩效 2 分」当场标红且文案里**带后果**；把它改掉之后
//     提交成功。反向再来一次：绕过前端标红直接提交（把校验挡住的格改成合法值后手改回来
//     不现实，所以这一段直接量"前端标红的那几种写法，后端确实会 422"——两侧同一条铁律）。
//   E 真提交（拍板 3）：表格 + 一个文件合一发 → **一个** context、人卡长出来、行数与文件都在。
//
// ## 怎么跑
//   后端：AVERY_BRAIN=mock AVERY_EXTRACTOR=heuristic AVERY_EMBEDDINGS=keyword \
//         uvicorn service.app:app --port 8137
//   前端：vite build（带 VITE_AVERY_API_BASE 指向那个后端）+ vite preview --port 5173
//   VERIFY_BASE=http://127.0.0.1:5173 VERIFY_API=http://127.0.0.1:8137 \
//     node eval-harness/tools/verify-intake-tables.mjs
//
// 🔴 上传型门：它真发 POST /ingest/structured，每跑一遍造 1 个 context。**绝不能排到 C 区
// 之后**——那之后 dist 指向生产域名，跑它就是往生产库里写测试数据（7/20 的旧事故）。
import { chromium } from 'playwright'

const UI = process.env.VERIFY_BASE || 'http://127.0.0.1:5173'
const API = process.env.VERIFY_API || 'http://127.0.0.1:8137'
const R = []
const rec = (n, ok, d) => { R.push({ n, ok }); console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${n}${d ? ' — ' + d : ''}`) }

const browser = await chromium.launch({ headless: true })

async function gotoIntake() {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(`${UI}/?v=2&mode=live&lang=zh`, { waitUntil: 'networkidle' })
  await page.waitForSelector('.lite-gate-door-upload', { timeout: 8000 })
  await page.locator('.lite-gate-door-upload').click()
  await page.waitForSelector('.lite-intake-grid', { timeout: 5000 })
  return { ctx, page, errors }
}

// 一段**真实形状**的中文 TSV：
//   · 姓名是汉字（🔴 门语料全 ASCII 是旧账，中文字节必须真进语料）；
//   · 「主要负责」里带顿号——它是 _OWNS_SPLIT_RE 认的分隔符，粘贴层**不许**动它；
//   · 第 3 行的「主要负责」是**引号包裹、内含换行**的单元格（Excel 复制长文本就是这个形状），
//     朴素的 split('\t') 会把它劈成三行垃圾。
const TSV_HEADER = ['姓名', '岗位', '部门', '司龄', '主要负责', '人员ID', '直属上级ID', '任职状态', '入职日期'].join('\t')
const TSV_ROWS = [
  ['陈思雨', '市场经理', '市场部', '3 年', '华东区渠道投放的方案与执行、秋季发布会统筹', 'MKT-001', '', '在职', '2023-04-10'],
  ['李明轩', '内容主管', '市场部', '1 年 6 个月', '公众号与短视频内容', 'MKT-002', 'MKT-001', '试用期', '2025-01-06'],
  ['周雅婷', '活动执行', '市场部', '8 个月', '"现场执行与供应商对接\n（含物料、场地、餐饮三条线）"', 'MKT-003', 'MKT-001', '在职', '2025-11-03'],
].map((r) => r.join('\t'))
const PASTE_TSV = [TSV_HEADER, ...TSV_ROWS].join('\n')

/** 往粘贴框里发一个**真的** paste 事件（带 DataTransfer），不是往 store 里塞数据。 */
async function pasteInto(page, selector, text) {
  await page.locator(selector).click()
  await page.evaluate(({ selector, text }) => {
    const el = document.querySelector(selector)
    const dt = new DataTransfer()
    dt.setData('text/plain', text)
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
  }, { selector, text })
}

async function cellValue(page, row, column) {
  return page.evaluate(({ row, column }) => {
    const td = document.querySelector(`.lite-intake-cell[data-row-index="${row}"][data-column-key="${column}"]`)
    return td?.querySelector('input,select')?.value ?? null
  }, { row, column })
}

// 🔴 一格的"状态"与"说明"住在两个地方，判据两边都取：
//   · 格上 `data-issue` 是**定位标记**（红/黄边框的判据值，显示值与判据值分开的老规矩）；
//   · 说明本体在网格下方的整宽清单里 `.lite-intake-issue[data-row][data-column]`。
// 首版把说明塞在格子底下，checker 逮到三条「高」：横滚出视野的整条看不见、留在视野里的被
// 格宽切成半句、最重要的红线恰好落在最窄的列上。判据跟着结构一起搬，不是绕过它。
async function cellIssue(page, row, column) {
  return page.evaluate(({ row, column }) => {
    const td = document.querySelector(`.lite-intake-cell[data-row-index="${row}"][data-column-key="${column}"]`)
    const li = document.querySelector(`.lite-intake-issue[data-row="${row}"][data-column="${column}"]`)
    return {
      level: td?.getAttribute('data-issue') ?? null,
      text: li?.textContent ?? '',
      code: li?.getAttribute('data-code') ?? null,
      // 说明必须**指得回**是第几行哪一列——它已经不在格子旁边了，不自报就是一句孤儿提示。
      at: li?.querySelector('.lite-intake-issue-at')?.textContent ?? '',
    }
  }, { row, column })
}

async function setCell(page, row, column, value) {
  const sel = `.lite-intake-cell[data-row-index="${row}"][data-column-key="${column}"] .lite-intake-input`
  const el = page.locator(sel)
  const tag = await el.evaluate((n) => n.tagName)
  if (tag === 'SELECT') await el.selectOption(value)
  else await el.fill(value)
  await page.waitForTimeout(80)
}

// ── A 表导航与网格骨架 ────────────────────────────────────────────────────────────────
{
  const { ctx, page, errors } = await gotoIntake()
  const a = await page.evaluate(() => {
    const nav = [...document.querySelectorAll('.lite-intake-nav-item')]
    const heads = [...document.querySelectorAll('.lite-intake-grid th[data-column-key]')]
    const scroll = document.querySelector('.lite-intake-grid-scroll')
    return {
      forms: nav.map((n) => n.getAttribute('data-form-id')),
      tiers: [...new Set([...document.querySelectorAll('.lite-intake-nav-tier')].map((t) => t.textContent.trim()))],
      headers: heads.map((h) => h.textContent.trim()),
      required: heads.filter((h) => h.getAttribute('data-required') === 'yes').length,
      scrollsInside: scroll ? getComputedStyle(scroll).overflowX === 'auto' : false,
      pageScrollX: document.documentElement.scrollWidth <= window.innerWidth + 1,
      intakeNote: document.querySelector('.lite-intake-intake')?.textContent?.trim() ?? '',
    }
  })
  console.log(`  A: ${JSON.stringify({ ...a, headers: a.headers.slice(0, 3) })}`)
  rec('A·七张表都在导航里', JSON.stringify(a.forms) === JSON.stringify(['01', '02', '03', '04', '05', '06', '07']),
    JSON.stringify(a.forms))
  rec('A·导航按「核心必填 / 建议补充」分组', a.tiers.length === 2, JSON.stringify(a.tiers))
  rec('A·表头非空且带必填标记', a.headers.length === 9 && a.required === 6,
    `${a.headers.length} 列 / ${a.required} 必填`)
  rec('A·表头是中文原文（与发出去的 xlsx 一眼对得上）', a.headers[0] === '姓名 *', a.headers[0])
  // 🔴 票面硬要求：网格横向溢出必须容器内滚动，页面不得横滚。
  rec('A·网格自己横向滚动', a.scrollsInside)
  rec('A·页面没有横向滚动条', a.pageScrollX)
  rec('A·「Avery 吃到哪一层」逐张标注在场', a.intakeNote.includes('人卡'), a.intakeNote.slice(0, 40))
  rec('A·无 pageerror', errors.length === 0, errors.slice(0, 2).join(' | ') || '0 条')
  await ctx.close()
}

// ── B 从 Excel 粘贴（拍板 4）───────────────────────────────────────────────────────────
{
  const { ctx, page, errors } = await gotoIntake()
  await page.locator('.lite-intake-paste > summary').click()
  await pasteInto(page, '.lite-intake-paste-input', PASTE_TSV)
  await page.waitForSelector('.lite-intake-paste-preview', { timeout: 3000 })
  const preview = await page.evaluate(() => ({
    rows: Number(document.querySelector('.lite-intake-paste-preview')?.getAttribute('data-paste-rows') ?? 0),
    summary: document.querySelector('.lite-intake-paste-summary')?.textContent?.trim() ?? '',
    mismatch: document.querySelectorAll('.lite-intake-paste-warn').length,
  }))
  console.log(`  B-预览: ${JSON.stringify(preview)}`)
  rec('B·表头行被认出来并丢掉（3 行数据，不是 4 行）', preview.rows === 3, String(preview.rows))
  rec('B·预览里说清了行数与列数', preview.summary.includes('3') && preview.summary.includes('9'), preview.summary)
  rec('B·列数相符时不报错位', preview.mismatch === 0)

  await page.locator('.lite-intake-paste-replace').click()
  await page.waitForTimeout(200)
  const name1 = await cellValue(page, 1, '姓名')
  const owns1 = await cellValue(page, 1, '主要负责')
  const owns3 = await cellValue(page, 3, '主要负责')
  const id2 = await cellValue(page, 2, '人员ID')
  const rowCount = await page.evaluate(() =>
    document.querySelectorAll('.lite-intake-grid tbody tr').length)
  console.log(`  B-落格: ${JSON.stringify({ name1, owns1: owns1?.slice(0, 20), owns3: owns3?.slice(0, 24), id2, rowCount })}`)
  rec('B·中文姓名逐字落格', name1 === '陈思雨', String(name1))
  // 🔴 顿号是 _OWNS_SPLIT_RE 认的分隔符（后端按它拆成多条职责）——**粘贴层不许动它**。
  rec('B·含顿号的单元格没有被劈开', owns1 === '华东区渠道投放的方案与执行、秋季发布会统筹', String(owns1))
  // 🔴 引号包裹、内含换行的单元格：朴素 split('\t') 会把它劈成三行垃圾。
  rec('B·引号包裹的含换行单元格完整落在一格里',
    typeof owns3 === 'string' && owns3.includes('现场执行与供应商对接') && owns3.includes('餐饮三条线'),
    String(owns3))
  rec('B·三行都进来了，且没有多出空行', rowCount === 3, String(rowCount))
  rec('B·工号列没有错位', id2 === 'MKT-002', String(id2))

  // 列数不符要在预览里**看得见**（静默补齐会让一次错位粘贴看起来完全正常）。
  await pasteInto(page, '.lite-intake-paste-input', '张三\t主管\t运营部')
  await page.waitForSelector('.lite-intake-paste-preview', { timeout: 3000 })
  const narrow = await page.evaluate(() => ({
    warn: document.querySelectorAll('.lite-intake-paste-warn').length,
    text: document.querySelector('.lite-intake-paste-warn')?.textContent?.trim() ?? '',
  }))
  rec('B·列数不符时预览里明说', narrow.warn === 1 && narrow.text.includes('9'), narrow.text.slice(0, 40))
  await page.locator('.lite-intake-paste-cancel').click()
  rec('B·无 pageerror', errors.length === 0, errors.slice(0, 2).join(' | ') || '0 条')
  await ctx.close()
}

// ── C 单元格级校验 ────────────────────────────────────────────────────────────────────
{
  const { ctx, page, errors } = await gotoIntake()
  await page.locator('.lite-intake-paste > summary').click()
  await pasteInto(page, '.lite-intake-paste-input', PASTE_TSV)
  await page.waitForSelector('.lite-intake-paste-preview', { timeout: 3000 })
  await page.locator('.lite-intake-paste-replace').click()
  await page.waitForTimeout(200)

  // 必填空
  await setCell(page, 2, '岗位', '')
  const req = await cellIssue(page, 2, '岗位')
  rec('C·必填空 → 标红', req.level === 'error' && req.code === 'required', JSON.stringify(req))

  // 日期格式
  await setCell(page, 1, '入职日期', '2023年4月')
  const date = await cellIssue(page, 1, '入职日期')
  rec('C·日期格式不对 → 标红且说明要 YYYY-MM-DD',
    date.level === 'error' && date.text.includes('YYYY-MM-DD'), JSON.stringify(date))
  // 「入职日期」是第 9 列，1440 宽下它在视野外。checker 逮到的正是这条：说明在格子里时
  // 整条跟着滚出去了，屏幕上只剩一条没有任何解释的空白带。清单在网格下方，且自报行列。
  rec('C·视野外那一列的错误照样看得见，并指得回第几行哪一列',
    date.at.includes('1') && date.at.includes('入职日期'), date.at)

  // 下拉词表外（任职状态是下拉列）
  await setCell(page, 1, '任职状态', '在职')
  const okOpt = await cellIssue(page, 1, '任职状态')
  rec('C·自证：合法下拉值不报错（否则下面那条是恒红）', okOpt.level === null, JSON.stringify(okOpt))

  // 切到 02 表：进度超范围 + 跨表引用悬空
  await page.locator('.lite-intake-nav-item[data-form-id="02"]').click()
  await page.waitForTimeout(150)
  await setCell(page, 1, '项目名称', '秋季新品发布会')
  await setCell(page, 1, '完成进度', '180')
  const pct = await cellIssue(page, 1, '完成进度')
  rec('C·进度超出 0–100 → 标红', pct.level === 'error' && pct.code === 'percent', JSON.stringify(pct))
  await setCell(page, 1, '完成进度', '45')
  await setCell(page, 1, '负责人ID', 'MKT-404')
  const ref = await cellIssue(page, 1, '负责人ID')
  // 🔴 跨表引用是**黄色**不是红色：用户完全可能先填 02 再回头补 01，后端同样只记 warning。
  rec('C·负责人ID 在 01 里找不到 → 黄色提醒（不是拦截）',
    ref.level === 'warn' && ref.code === 'ref', JSON.stringify(ref))
  await setCell(page, 1, '负责人ID', 'MKT-001')
  const refOk = await cellIssue(page, 1, '负责人ID')
  rec('C·填成 01 里真有的工号 → 提醒消失', refOk.level === null, JSON.stringify(refOk))

  const submitState = await page.evaluate(() => ({
    disabled: document.querySelector('.lite-intake-submit')?.disabled ?? null,
    blocked: document.querySelector('.lite-intake-blocked')?.textContent?.trim() ?? '',
  }))
  rec('C·还有 error 时提交被挡住，并说明还剩几格',
    submitState.disabled === true && /\d/.test(submitState.blocked), JSON.stringify(submitState))
  rec('C·无 pageerror', errors.length === 0, errors.slice(0, 2).join(' | ') || '0 条')
  await ctx.close()
}

// ── D 红线前移（拍板 2）────────────────────────────────────────────────────────────────
// 前端当场标红 + **说清后果**，用户永远碰不到 422。同一批写法拿去直打端点必须真的 422——
// 两侧同一条铁律，否则前端那句「会导致整发上传被拒绝」就是一句谎。
const REDLINE_SAMPLES = ['绩效 2 分，需要提高', '完成度只有 82%', '本季度排名倒数第一', '绩效评级：不合格']
{
  const { ctx, page, errors } = await gotoIntake()
  await page.locator('.lite-intake-nav-item[data-form-id="07"]').click()
  await page.waitForTimeout(150)
  let allRed = true
  let consequence = ''
  for (const sample of REDLINE_SAMPLES) {
    await setCell(page, 1, '需改进事项', sample)
    const hit = await cellIssue(page, 1, '需改进事项')
    if (hit.level !== 'error' || hit.code !== 'redlineHard') {
      allRed = false
      console.log(`    ✗ 「${sample}」没被标红：${JSON.stringify(hit)}`)
    } else {
      consequence = hit.text
    }
  }
  rec('D·四种打分写法在 07 表里都当场标红', allRed)
  // 🔴 判据是"文案里有后果"，不是"文案非空"：填表的人猜不到写了会怎样，而我们发出去的
  // xlsx 说明页答应过要说清楚。
  rec('D·红标文案说清了后果（整发被拒）',
    consequence.includes('整发') && consequence.includes('拒绝'), consequence.slice(0, 40))
  // checker 逮到过一条真缺陷：中文文案里写了 markdown 的 `**`，而这里是纯文本渲染，
  // 于是屏幕上真的印出了「传被拒绝**，」。判据钉在"屏幕上不许出现星号"。
  rec('D·红标文案里没有未渲染的 markdown 星号', !consequence.includes('**'), consequence.slice(0, 60))
  const redlineFirst = await page.evaluate(() => {
    const first = document.querySelector('.lite-intake-issues .lite-intake-issue')
    return { code: first?.getAttribute('data-code') ?? null, redline: first?.classList.contains('is-redline') ?? false }
  })
  // 红线与「这一格必填」不是一个量级的事，它必须排在最前且单独一档重量——否则会被同排
  // 五条必填提示稀释掉（checker 逮到）。
  rec('D·红线那条排在问题清单最前，且单独一档视觉重量',
    redlineFirst.code === 'redlineHard' && redlineFirst.redline, JSON.stringify(redlineFirst))
  await setCell(page, 1, '需改进事项', '两次物料交付在截止日当天才提出风险')
  const cleaned = await cellIssue(page, 1, '需改进事项')
  rec('D·改成写行为之后红标消失', cleaned.level === null, JSON.stringify(cleaned))
  rec('D·无 pageerror', errors.length === 0, errors.slice(0, 2).join(' | ') || '0 条')
  await ctx.close()
}

// D-后端半边：前端标红的那几种写法，后端必须真的整发 422（两侧同一条铁律）。
{
  const res = await fetch(`${API}/ingest/structured`, {
    method: 'POST',
    body: (() => {
      const fd = new FormData()
      fd.append('tables', JSON.stringify({
        '01': [{ 姓名: '李明轩', 岗位: '内容主管', 部门: '市场部', 主要负责: '内容', 人员ID: 'MKT-002', 任职状态: '在职' }],
        '07': [{
          评议ID: 'REV-1', 被评议人员ID: 'MKT-002', 评议人ID: 'MKT-002', 评议周期: '2026Q3',
          评议日期: '2026-07-20', 确认的优势: '按时交付', 需改进事项: REDLINE_SAMPLES[0],
          沟通后约定动作: '每周同步',
        }],
      }))
      return fd
    })(),
  })
  const body = await res.json().catch(() => ({}))
  const cells = body?.detail?.cells ?? []
  rec('D·后端对同一条写法整发 422', res.status === 422, `HTTP ${res.status}`)
  rec('D·422 里带得回格坐标（表/行/列）',
    cells.some((c) => c.table === '07' && c.row === 1 && c.column === '需改进事项'),
    JSON.stringify(cells.slice(0, 1)))
}

// ── E 真提交：表格 + 文件合一发 = 一个 context（拍板 3）────────────────────────────────
{
  const { ctx, page, errors } = await gotoIntake()
  await page.locator('.lite-intake-paste > summary').click()
  await pasteInto(page, '.lite-intake-paste-input', PASTE_TSV)
  await page.waitForSelector('.lite-intake-paste-preview', { timeout: 3000 })
  await page.locator('.lite-intake-paste-replace').click()
  await page.waitForTimeout(200)
  // 02 表也填一行，证明多表同发。
  await page.locator('.lite-intake-nav-item[data-form-id="02"]').click()
  await page.waitForTimeout(150)
  for (const [col, val] of [['项目ID', 'PRJ-2026-01'], ['项目名称', '秋季新品发布会'],
    ['负责人ID', 'MKT-001'], ['开始日期', '2026-06-01'], ['计划完成日期', '2026-09-20'],
    ['完成进度', '45'], ['项目目标', '覆盖 3 家行业媒体、留资 500 条']]) {
    await setCell(page, 1, col, val)
  }
  await setCell(page, 1, '当前状态', '进行中')

  // 附一个文件（合一发的另一半）。
  await page.setInputFiles('.lite-onboard-upload-input', {
    name: '公司简介.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from('# 公司简介\n\n三亚度假地产营销团队，旺季从十月开始。\n', 'utf-8'),
  })
  await page.waitForTimeout(200)

  const before = await page.evaluate(() => window.__lite2Store.getState().contextId)
  await page.locator('.lite-intake-submit').click()
  await page.waitForFunction(
    (prev) => {
      const s = window.__lite2Store.getState()
      return s.contextId !== null && s.contextId !== prev && s.ingestStatus === 'ready'
    },
    before, { timeout: 30000 })
  const e = await page.evaluate(() => {
    const s = window.__lite2Store.getState()
    return {
      contextId: s.contextId,
      people: s.team?.people?.map((p) => p.name) ?? [],
      projects: s.rawTeam?.projects?.map((p) => p.title) ?? [],
      mode: s.rawTeam?.extraction_mode ?? null,
      rows: s.rawTeam?.intake_rows ?? null,
      files: s.rawTeam?.source_files ?? [],
    }
  })
  console.log(`  E: ${JSON.stringify(e)}`)
  rec('E·提交成功，落出一个 context', typeof e.contextId === 'string' && e.contextId.length > 0)
  rec('E·表格里的三个人都长成了人卡',
    ['陈思雨', '李明轩', '周雅婷'].every((n) => e.people.includes(n)), e.people.join('/'))
  rec('E·02 表的项目也长成了项目卡', e.projects.includes('秋季新品发布会'), e.projects.join('/'))
  rec('E·行数如实回报', e.rows === 4, String(e.rows))
  // 混合发时诚实标报的是**文件侧真正走的那条路**，不是 'structured'。
  rec('E·混合发的 extraction_mode 报文件侧的真实模式', e.mode === 'heuristic', String(e.mode))
  rec('E·附带文件进了同一个 context', e.files.includes('公司简介.md'), JSON.stringify(e.files))
  rec('E·无 pageerror', errors.length === 0, errors.slice(0, 2).join(' | ') || '0 条')
  await ctx.close()
}

await browser.close()

const pass = R.filter((r) => r.ok).length
const fail = R.length - pass
console.log(`\n═══ 7 表录入：${pass} PASS · ${fail} FAIL ═══`)
process.exit(fail ? 1 : 0)
