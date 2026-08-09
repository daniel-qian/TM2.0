// T10 · 补资料端到端 story 门：传 → 补传 → 卡片显新值 + 出处指新资料 → 矛盾上今天页双栏。
//
// ## 这道门防的是什么
// 本票最容易被砍成半个的地方是「文件进了资料库，卡片没动」。那半个的症状极其难看却极其安静：
// 资料时间轴说「最新一份是今天的」，于是「证据过期了」那条提醒**自己闭嘴**，而卡片上还挂着
// 上个月的读数——产品在对着经理撒谎，且刚好把会提醒他的那句话关掉了。离线单测证明不了这一段：
// 它测的是归并函数，而砍半发生在**接线**上（端点没接、store 走了 adoptContext 把 team 清了、
// 卡片没重渲）。所以这一条必须是真浏览器打真后端。
//
// ## 五段剧本（每一段都有自证判据，防的是"判据够不着时假装通过"）
//   ① 传第一批（花名册 + 项目周报）→ 自证：项目卡真的在，状态 on-track、进度 40。
//      这一条不成立，后面全部是废话。
//   ② 补传一份**更新的**周报（受阻 / 55% / 换了截止日）→ 自证：contextId **一个字符都没变**。
//      这就是「每次上传=新开一家公司」那堵墙被拆掉的判据本身。
//   ③ 资料库多一行，而且是服务端最终采用的那个 source_key（同名补传会拿到 `xx(1).md`）。
//   ④ 卡片显新值 + **出处指新资料**：详情浮层上那一格挂着「读自〈本周周报.md〉」角标。
//      🔴 判据落在**角标文本里出现了新文档的名字**，不是「有没有角标」——角标在就绿的写法，
//         会被一个恒挂「手动编辑」的实现骗过去（本仓的老病：显示值与判据值必须分开）。
//   ⑤ 矛盾上今天页：决策卡展开后有一条冲突规则，证据面是**双栏**（.--split）且两行分别引到
//      两份不同的文档。判据同时看载荷与 DOM——只看载荷会漏掉"后端记了、前端没渲染"。
//
// ## 怎么跑
// 🔴 **上传型门**（真发 POST /ingest 与 POST /team/{id}/files 造 context），
//    **绝不能排在 C 区之后**——C 区的 bundle-privacy 会把 dist 重打成指向生产域名，
//    此后任何一发上传就是往生产库里写测试数据（2026-07-20 真发生过）。
//   后端：AVERY_BRAIN=mock AVERY_EXTRACTOR=heuristic AVERY_EMBEDDINGS=keyword uvicorn :8137
//   前端：vite build --mode development + vite preview --host --port 5173
//   VERIFY_BASE=http://localhost:5173 node eval-harness/tools/verify-append-story.mjs
import { bootPage, makeRec, finish } from './lib/gate-run.mjs'

const UI = process.env.VERIFY_BASE || 'http://127.0.0.1:5173'
const gateRec = makeRec()
const rec = gateRec.rec

const TITLE = '别墅套餐推广'
const OLD_DOC = '项目周报.md'
const NEW_DOC = '本周周报.md'

// 第一批：一张花名册 + 一份项目周报。格式与后端离线套里那份逐字同源（内侧竖线的表头行是
// roster 解析器认得的形状；`# 标题` + `负责人/状态/截止/进度` 是项目解析器认得的形状）。
const ROSTER = [
  '# 别墅酒店 员工花名册', '',
  '姓名 | 人员ID | 部门 | 职位 | 司龄',
  '周雅婷 | MKT-001 | 市场推广部 | 市场专员 | 3年',
  '林小满 | FO-0422 | 前厅部 | 前厅主管 | 2年',
].join('\n')
const PROJECT_V1 = [`# ${TITLE}`, '负责人：周雅婷', '状态：进行中', '截止：2026-09-30', '进度：40%'].join('\n')
// 补传的那一份：同一个项目，**更新的**读数（状态更糟 + 换了截止日 + 多一条阻塞）。
const PROJECT_V2 = [
  `# ${TITLE}`, '负责人：周雅婷', '状态：受阻', '截止：2026-10-15', '进度：55%',
  '阻塞：雨季无备选场地',
].join('\n')

const SEAM = '__lite2Store'
let browser

const boot = await bootPage({ browser, url: `${UI}/?v=2&mode=live&look=paper&lang=zh`, trackPageErrors: true })
browser = boot.browser
const { context: ctx, page, pageErrors } = boot

const upload = (files, action) =>
  page.evaluate(async ({ files, action, seam }) => {
    const enc = new TextEncoder()
    const handles = files.map((f) => new File([enc.encode(f.text)], f.name, { type: 'text/markdown' }))
    await window[seam].getState()[action](handles)
  }, { files, action, seam: SEAM })

// 🔴 等状态机落定，**超时不许抛**：接错线时（比如补资料那个口子其实调的是 uploadFiles）
// `appendStatus` 会永远停在 'idle'，裸 waitForFunction 会等满 90 秒然后把整道门炸掉。
// 炸掉也算红，但读日志的人看到的是一条 playwright 堆栈，而不是「这个口子接错线了」。
// 变异测试那一趟正是靠这条区分：崩溃与 [FAIL] 在计数上不是一回事。
const settle = async (key, label) => {
  try {
    await page.waitForFunction(
      (k) => ['ready', 'error'].includes(window[k.seam].getState()[k.key]),
      { seam: SEAM, key }, { timeout: 45000 })
    return true
  } catch {
    const st = await page.evaluate((k) => window[k.seam].getState()[k.key], { seam: SEAM, key })
    rec(label, false, `${key} 停在 '${st}' 没有落定——这个口子多半接到了别的 action 上`)
    return false
  }
}

// ── ① 第一批 ────────────────────────────────────────────────────────────────────────────────
await upload([{ name: '员工花名册.md', text: ROSTER }, { name: OLD_DOC, text: PROJECT_V1 }], 'uploadFiles')
await settle('ingestStatus', '第一批上传落定（ingestStatus 到 ready/error）')

const before = await page.evaluate((seam) => {
  const st = window[seam].getState()
  const p = (st.team?.projects ?? []).find((x) => x.title.includes('别墅套餐'))
  return { contextId: st.contextId, status: p?.status ?? null, progress: p?.progress ?? null, id: p?.id ?? null,
           canAppend: !!st.transport.appendFiles }
}, SEAM)
rec('自证①：第一批真的长出了那张项目卡（否则后面全是废话）',
  before.id !== null && before.status === 'on-track' && before.progress === 40, JSON.stringify(before))
rec('自证①b：这条通道有 appendFiles（stub/老后端上整道门无意义）', before.canAppend === true, String(before.canAppend))

// ── ② 补传 ──────────────────────────────────────────────────────────────────────────────────
// 🔴 这一段**必须走真的界面入口**，不许直接调 store。第一版就是直接调 `appendFiles`，结果
//    「把补资料那个口子接错线、其实调的还是 uploadFiles」这条变异**活了下来**（0 红）——
//    因为门根本没碰过那个按钮。本票交付的东西就是这个入口，判据必须落在它身上。
await page.evaluate((seam) => window[seam].getState().goScreen('files'), SEAM)
await page.waitForTimeout(600)
const entry = await page.evaluate(() => {
  const section = document.querySelector('.lite-files-append')
  return {
    present: !!section,
    mode: section?.querySelector('[data-upload-mode]')?.getAttribute('data-upload-mode') ?? null,
    hasInput: !!section?.querySelector('input.upload-input'),
    title: section?.querySelector('.lite-files-section-title')?.textContent?.trim() ?? '',
    // 「新建一家公司」那个口子必须同时在场，且是另一个模式——两个动作分得开才叫分得清。
    otherModes: Array.from(document.querySelectorAll('[data-upload-mode]'))
      .map((n) => n.getAttribute('data-upload-mode')),
  }
})
rec('② 资料库上真的有「给这家公司补资料」这个入口', entry.present === true && entry.hasInput === true,
  JSON.stringify(entry))
rec('② 两个动作分得开：补资料口是 append 模式，另建画像口是 new 模式',
  entry.mode === 'append' && entry.otherModes.includes('new') && entry.otherModes.includes('append'),
  JSON.stringify(entry.otherModes))

// 走界面入口的另一半：这一发**不许**碰 ingest 那条状态机。判据不看 `ingestStatus` 的终值
// （借用它的实现最后也停在 'ready'，看终值分不出来），看的是它的**副作用**：`notifyStore` 只认
// `ingesting → ready` 这一跳并据此合成一条「你的团队已就绪」。补一份周报不是团队就绪；
// 多出来的那一条就是假通知。
const notifBefore = await page.evaluate(
  () => JSON.parse(window.localStorage.getItem('lite2:notify:v1') || '{"items":[]}').items?.length ?? 0)
await page.setInputFiles('.lite-files-append input.upload-input', [{
  name: NEW_DOC, mimeType: 'text/markdown', buffer: Buffer.from(PROJECT_V2, 'utf8'),
}])
await settle('appendStatus', '② 补资料这个口子真的把补传跑起来了（appendStatus 落定）')
await page.waitForTimeout(400)
const notifAfter = await page.evaluate(
  () => JSON.parse(window.localStorage.getItem('lite2:notify:v1') || '{"items":[]}').items?.length ?? 0)
rec('② 补传没有借用 ingest 的状态机（否则会多出一条假的「你的团队已就绪」通知）',
  notifAfter === notifBefore, `${notifBefore} → ${notifAfter}`)

const after = await page.evaluate((seam) => {
  const st = window[seam].getState()
  const p = (st.team?.projects ?? []).find((x) => x.title.includes('别墅套餐'))
  return {
    contextId: st.contextId,
    appendStatus: st.appendStatus,
    appendError: st.appendError,
    receipt: st.appendReceipt,
    status: p?.status ?? null,
    progress: p?.progress ?? null,
    dueDate: p?.dueDate ?? null,
    id: p?.id ?? null,
    nProjects: (st.team?.projects ?? []).length,
    files: (st.files ?? []).map((f) => f.filename),
    decisions: st.rawTeam?.decisions ?? [],
  }
}, SEAM)

rec('补传成功（没有落在 error 上）', after.appendStatus === 'ready', `${after.appendStatus} ${after.appendError ?? ''}`)
// 🔴 这就是「每次上传=新开一家公司」那堵墙被拆掉的判据本身。
rec('② context_id 一个字符都没变 —— 补的是这家公司，不是另开一家',
  after.contextId === before.contextId && after.contextId !== null,
  `${before.contextId} → ${after.contextId}`)
rec('② 项目没有裂成两张卡（同一个 _project_key 归并到同一张）',
  after.nProjects === 1 && after.id === before.id, `${after.nProjects} 张 · id ${before.id} → ${after.id}`)

// ── ③ 资料库 ────────────────────────────────────────────────────────────────────────────────
rec('③ 资料库多了一行，且是服务端最终采用的那个 source_key',
  Array.isArray(after.receipt?.documents) && after.receipt.documents.length === 1 &&
  after.files.length === 3,
  `receipt=${JSON.stringify(after.receipt?.documents)} files=${after.files.join(' / ')}`)

// ── ④ 卡片显新值 + 出处指新资料 ──────────────────────────────────────────────────────────────
rec('④ 卡片安静更新到新读数（状态/进度/截止三格）',
  after.status === 'blocked' && after.progress === 55 && after.dueDate === '2026-10-15',
  `status=${after.status} progress=${after.progress} due=${after.dueDate}`)

await page.evaluate(({ seam, id }) => window[seam].getState().openDetail('project', id), { seam: SEAM, id: after.id })
await page.waitForTimeout(500)
const badge = await page.evaluate(() => {
  const card = document.querySelector('.lite-detail-card')
  if (!card) return { open: false }
  return {
    open: true,
    text: card.innerText || '',
    badges: Array.from(card.querySelectorAll('.lite-detail-provenance')).map((n) => n.textContent.trim()),
  }
})
// 🔴 判据落在**角标文本里出现了新文档的名字**——「有没有角标」那种写法，会被一个恒挂
//    「手动编辑」的实现骗过去（显示值与判据值必须分开，本仓的老病）。
rec('④ 详情浮层真的开着且渲染了这张卡', badge.open === true && badge.text.includes(TITLE),
  badge.open ? badge.text.slice(0, 60) : '(没开)')
rec('④ 出处角标指向**新资料**（拍板③「出处指新资料」的落点）',
  Array.isArray(badge.badges) && badge.badges.some((b) => b.includes(NEW_DOC)),
  JSON.stringify(badge.badges))
rec('④ 角标里不许印行号（实体出处是块级兜底，可能指着一个标题行）',
  Array.isArray(badge.badges) && !badge.badges.some((b) => /:\d+/.test(b)),
  JSON.stringify(badge.badges))
await page.evaluate((seam) => window[seam].getState().closeDetail(), SEAM)
await page.waitForTimeout(250)

// ── ⑤ 矛盾上今天页 ──────────────────────────────────────────────────────────────────────────
// 🔴 rule_id 只作为**从载荷读出来的值**参与判断，绝不写成字面量：后端有一条全仓门
//    （test_no_rule_text_in_any_prompt）禁止规则号出现在它那三个文件之外，而这里是前端侧的
//    同一条纪律——判据认的是「这条命中的证据面是不是双栏」，不是某个特定编号。
const decision = (after.decisions || []).find((d) => d.subject_id === after.id)
const conflictHit = (decision?.matched_rules || []).find(
  (h) => Array.isArray(h.evidence) && h.evidence.filter((line) => /doc="/.test(line)).length >= 2)
rec('⑤ 后端载荷里真有一条跨资料冲突命中（两条以上带 doc= 的证据行）',
  !!conflictHit, JSON.stringify(conflictHit?.evidence ?? decision?.matched_rules?.map((h) => h.rule_id) ?? []))
const docsCited = new Set((conflictHit?.evidence || []).map((l) => (l.match(/doc="([^"]+)"/) || [])[1]).filter(Boolean))
rec('⑤ 两条证据分别引到**两份不同的**资料（同一份文档内部的分歧不算跨资料）',
  docsCited.size >= 2 && docsCited.has(NEW_DOC), [...docsCited].join(' / '))

await page.evaluate((seam) => window[seam].getState().goScreen('home'), SEAM)
await page.waitForTimeout(700)
const split = await page.evaluate(() => {
  const toggles = Array.from(document.querySelectorAll('.lite-home-decision-toggle'))
  toggles.forEach((b) => b.click())
  return null
})
void split
await page.waitForTimeout(400)
const dom = await page.evaluate(() => {
  const lists = Array.from(document.querySelectorAll('.lite-home-rule-evidence--split'))
  return {
    n: lists.length,
    rows: lists.map((ul) => Array.from(ul.querySelectorAll('li')).map((li) => li.textContent.trim())),
  }
})
rec('⑤ 今天页把它渲染成**双栏对照**（不是后端记了、前端不显示）',
  dom.n >= 1 && dom.rows.some((r) => r.length >= 2), JSON.stringify(dom).slice(0, 260))
rec('⑤ 双栏里印的是文档原值 + 文件名（证据自报出处）',
  dom.rows.some((r) => r.some((line) => line.includes(NEW_DOC))), JSON.stringify(dom.rows).slice(0, 260))

rec('无 pageerror', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | ') || '0 条')
await ctx.close()

await finish(gateRec, { browser, label: 'T10 补资料端到端', listFailures: true })
