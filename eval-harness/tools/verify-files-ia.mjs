// verify-files-ia.mjs —— #76 资料库 IA 重排 + #77 删除文件（前端半）的机械跑器。
//
// 为什么要新开一道门：lite2 的文件清单此前**没有任何自动化覆盖**。钉它的
// `assertFilesSurfaceV2` 住在 `scripts/gates/live-frontend-gate.snippet.js:2968`，那是一份
// 往浏览器控制台里贴的手工门——`git ls-files "*verify-*.mjs"` 捞不到它，run-battery 也不
// 跑它。于是「清单行长什么样」在电池里是一块空白：#76 给它加了时间列/排序/删除键，#77 给
// 了它一个真会销毁数据的按钮，一条自动判据都没有。这道门补上那块空白。
//
// 🔴 判据设计的两条纪律（都在本仓吃过亏）：
//  ① 判据落在**被测属性本身**，不落在下游后果。时间列那条断言的是「屏上那串字 === 用
//     `new Date()` 换算出来的本地时刻」，不是「含有年份」——后者对着 `iso.slice(0,16)`
//     那种差八小时的错实现照样全绿。
//  ② 自证前提与判别判据分开写。「清单有两行」是前提；「删掉之后少一行」才是判据。
//
// 环境：build+preview（`?transport=stub` 在产物上是死开关）+ 真 mock 后端 + 显式 ?lang=zh。
//   VERIFY_BASE=http://localhost:5173 node eval-harness/tools/verify-files-ia.mjs
import { bootPage, dismissOnboard, makeRec, finish } from './lib/gate-run.mjs'

const UI = process.env.VERIFY_BASE || 'http://127.0.0.1:5173'
const SEAM = '__lite2Store'
const { rows, rec } = makeRec()

const ROSTER = [
  '# 别墅酒店 员工花名册', '',
  '姓名 | 人员ID | 部门 | 职位 | 司龄',
  '周雅婷 | MKT-001 | 市场推广部 | 市场专员 | 3年',
  '林小满 | FO-0422 | 前厅部 | 前厅主管 | 2年',
].join('\n')
const BEO = [
  '# 婚宴通知单与协调会纪要', '',
  '- 通知单编号：BEO-2026-0808（宴会销售部存档）',
  '- 场地：阳光草坪主场地 + 多功能厅备用（雨天启用）',
].join('\n')

const boot = await bootPage({ url: `${UI}/?v=2&mode=live&look=paper&lang=zh`, trackPageErrors: true })
const { browser, page, pageErrors } = boot
await dismissOnboard(page)

// ── ⓪ 铺语料（store 当搬运工；被测部件从①起全走真点击）────────────────────────────────
await page.evaluate(async ({ files, seam }) => {
  const enc = new TextEncoder()
  await window[seam].getState().uploadFiles(
    files.map((f) => new File([enc.encode(f.text)], f.name, { type: 'text/markdown' })))
}, { files: [{ name: '花名册.md', text: ROSTER }, { name: '婚宴纪要.md', text: BEO }], seam: SEAM })
await page.waitForFunction(
  (seam) => ['ready', 'error'].includes(window[seam].getState().ingestStatus), SEAM,
  { timeout: 45000 }).catch(() => {})
await page.evaluate((seam) => window[seam].getState().goScreen('files'), SEAM)
await page.waitForTimeout(800)

const seed = await page.evaluate((seam) => {
  const st = window[seam].getState()
  return {
    ingestStatus: st.ingestStatus,
    files: (st.files ?? []).map((f) => ({
      key: f.source_key ?? f.filename, name: f.filename, at: f.uploaded_at,
    })),
    canDelete: !!st.transport.deleteFile,
  }
}, SEAM)
rec('⓪ 自证：两份文件真的传进去了（判据的前提，不成立则整门空跑）',
  seed.ingestStatus === 'ready' && seed.files.length === 2, JSON.stringify(seed.files))
rec('⓪ 自证：这条通道有 deleteFile（删除那几条判据够得着）', seed.canDelete === true)

// ── ① 清单只许有一份（#76 的假绿口：filesSurfaceV2 只查「行数>0 且每行合规」，
//      两个 UploadPanel 都渲染清单时**双倍行数照样全绿**）────────────────────────────
const surface = await page.evaluate(() => ({
  manifests: document.querySelectorAll('.lite-files .upload-files').length,
  rows: document.querySelectorAll('.lite-files .upload-file-row').length,
  panels: document.querySelectorAll('.lite-files .upload-panel').length,
}))
rec('① 🔴 Files 屏上 `.upload-files` 全局恰好一份（任一 UploadPanel 恢复 showFiles 默认必红）',
  surface.manifests === 1, JSON.stringify(surface))
rec('① 清单行数 === 传进去的文件数（不是双倍，也不是零）',
  surface.rows === seed.files.length, JSON.stringify(surface))

// ── ② 时间列：判据落在**换算出来的那串字**上 ───────────────────────────────────────
const stamps = await page.evaluate(() => {
  const p = (n) => String(n).padStart(2, '0')
  const local = (iso) => {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return null
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
  }
  const files = window.__lite2Store.getState().files ?? []
  return Array.from(document.querySelectorAll('.lite-files .upload-file-row')).map((row, i) => ({
    shown: row.querySelector('.upload-file-time')?.textContent?.trim() ?? '',
    want: local(files[i]?.uploaded_at ?? ''),
  }))
})
rec('② 每一行都印出了上传时间（payload 里一直有 uploaded_at，此前一个都不渲染）',
  stamps.length > 0 && stamps.every((s) => s.shown.length > 0), JSON.stringify(stamps))
rec('② 🔴 印的是**本地换算**的时刻，逐字等于 new Date(iso) 的本地取值（抄成 iso.slice(0,16) 必红）',
  stamps.length > 0 && stamps.every((s) => !!s.want && s.shown.replace(/^·\s*/, '') === s.want),
  JSON.stringify(stamps))

// ── ③ 分区重排 + 锚点 ────────────────────────────────────────────────────────────────
const ia = await page.evaluate(() => {
  const order = Array.from(document.querySelectorAll('.lite-files .lite-files-section'))
    .map((s) => s.id || s.className)
  const links = Array.from(document.querySelectorAll('.lite-files-nav-link'))
    .map((a) => a.getAttribute('href') || '')
  return {
    order,
    links,
    dangling: links.filter((h) => !h.startsWith('#') || !document.getElementById(h.slice(1))),
  }
})
const idxOf = (id) => ia.order.indexOf(id)
rec('③ 🔴 频率重排：常驻表单排在「另建一家公司」**前面**（旧序正好相反）',
  idxOf('files-forms') > -1 && idxOf('files-new') > -1 && idxOf('files-forms') < idxOf('files-new'),
  JSON.stringify(ia.order))
rec('③ 当前资料仍是第一段（重排不该把回看动作也挪走）', idxOf('files-current') === 0,
  JSON.stringify(ia.order))
rec('③ 页内导航在场且**每一条锚点都指向真实存在的段落**（悬空锚点比没有导航更糟）',
  ia.links.length > 1 && ia.dangling.length === 0, JSON.stringify(ia))

// ── ④ 「谁交了」在 ④ 段内部被提到了铸链区之前 ────────────────────────────────────────
const inForms = await page.evaluate(() => {
  const sec = document.getElementById('files-forms')
  if (!sec) return null
  const kids = Array.from(sec.children).map((el) => el.className)
  return {
    status: kids.findIndex((c) => c.includes('lite-files-forms-status-block')),
    templates: kids.findIndex((c) => c.includes('lite-files-forms-templates')),
    kids,
  }
})
rec('④ 「谁交了」区排在模板列表之前（没有提交行时两者都不在，这条自动跳过）',
  !inForms || inForms.status === -1 || inForms.templates === -1 ||
  inForms.status < inForms.templates, JSON.stringify(inForms))

// ── ⑤ #77 删除：二段确认是硬要求（销毁类）────────────────────────────────────────────
const delBtns = page.locator('.lite-files .upload-file-delete')
rec('⑤ 自证：删除键逐行都在（能力探测到 deleteFile 才渲染）',
  (await delBtns.count()) === seed.files.length, `${await delBtns.count()} 颗`)
rec('⑤ 🔴 第一下**不删**：点了只出确认条，清单一行不少（拆掉确认步这条必红）',
  await (async () => {
    try { await delBtns.first().click({ timeout: 3000 }) } catch { return false }
    await page.waitForTimeout(300)
    const st = await page.evaluate((seam) => ({
      confirm: document.querySelectorAll('.lite-files .upload-file-delete-confirm').length,
      files: (window[seam].getState().files ?? []).length,
    }), SEAM)
    return st.confirm === 1 && st.files === seed.files.length
  })())
rec('⑤ 确认条里说清了「卡片上来自它的读数会失去出处」（不止说少一行文件）',
  await page.evaluate(() =>
    (document.querySelector('.upload-file-delete-body')?.textContent ?? '').includes('出处')))
rec('⑤ 点「先留着」= 什么都不删',
  await (async () => {
    // 🔴 崩不掉：拆掉确认步这个变异会让这颗按钮根本不存在，裸 `.click()` 会等 30s 然后把整门
    // **崩**成一条 TimeoutError 堆栈（不是 FAIL）。一道门里「崩/假红/假绿」三种结局并存时，
    // 读日志的人会把同一个原因归因成三个不同的 bug——所以交互步一律 try/catch 成 false。
    const btn = page.locator('.upload-file-delete-cancel').first()
    if ((await btn.count()) === 0) return false
    try { await btn.click({ timeout: 3000 }) } catch { return false }
    await page.waitForTimeout(300)
    return await page.evaluate((seam) => (window[seam].getState().files ?? []).length, SEAM)
      === seed.files.length
  })())

const victim = seed.files[1]
rec('⑤ 🔴 第二下真删：清单少那一行，且少的是**被点的那一份**',
  await (async () => {
    try { await delBtns.nth(1).click({ timeout: 3000 }) } catch { return false }
    await page.waitForTimeout(300)
    const go = page.locator('.upload-file-delete-go').first()
    if ((await go.count()) === 0) return false
    try { await go.click({ timeout: 3000 }) } catch { return false }
    await page.waitForFunction(
      (seam) => (window[seam].getState().files ?? []).length === 1, SEAM,
      { timeout: 20000 }).catch(() => {})
    const left = await page.evaluate((seam) =>
      (window[seam].getState().files ?? []).map((f) => f.source_key ?? f.filename), SEAM)
    return left.length === 1 && !left.includes(victim.key)
  })(), `删的是 ${victim.key}`)

// ── ⑥ 删掉之后 @ 引用够不着它（前后端同域纪律：不许静默引到别的文档）────────────────
const refIds = await page.evaluate((seam) => {
  const st = window[seam].getState()
  return (st.files ?? []).map((f) => f.source_key ?? f.filename)
}, SEAM)
rec('⑥ 已删文档的键不再出现在候选来源（清单即 @ 文件候选的数据面）',
  !refIds.includes(victim.key), JSON.stringify(refIds))

rec('无 pageerror（整程零未捕获异常）', pageErrors.length === 0, JSON.stringify(pageErrors))

void rows
await finish({ rows }, {
  browser, label: '#76/#77 资料库 IA 重排 + 删除文件（前端）', listFailures: true,
})
