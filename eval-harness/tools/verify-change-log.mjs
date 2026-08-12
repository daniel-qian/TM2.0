// verify-change-log.mjs —— #85「这次补料改了什么」只读流水（+ 已查阅）的机械跑器。
//
// 为什么必须是一道**真上传 + 真补传**的门：这条流水的每一行都长在「第二批资料顶掉了第一批
// 的某个读数」这件事上。`?transport=stub` 造不出来（它没有 append），单看空态更造不出来
// ——本票最容易的假绿就是「那一区根本没渲染，而每条判据都够不着，于是全绿」。所以 ⓪ 段
// 先把两批语料真传进去，并**自证**改写确实发生了；自证不成立就整门空跑，那几条判据什么
// 都没证明。
//
// 🔴 判据设计（都是本仓吃过亏的形状）：
//  ① 判据落在**被测属性本身**。「从 X 改成 Y」那条断言的是屏上那两串字**逐字等于**
//     payload 里的旧值/新值，不是「行里含有一个箭头」——后者对着一个把旧值印成新值的
//     实现照样全绿。
//  ② 自证前提与判别判据分开写。「补传真的改写了 ownerName」是前提；「屏上印出了它的旧值」
//     才是判据。
//  ③ 销毁/切换类判据配对照基准。「标了已查阅之后这一行收起」必须先量到**标之前它在**，
//     否则一个从来不渲染任何行的实现同样满足「标完看不见」。
//  ④ 首次上传**不该**产生任何一行——这条是反向判据，防的是把 provenance 判据写宽
//     （例如只看 lineage 不看 origin），那样第一批的每一格都会冒出来。
//
// 环境：build+preview + 真 mock 后端 + 显式 ?lang=zh（行文案判据读中文）。
//   VERIFY_BASE=http://localhost:5173 node eval-harness/tools/verify-change-log.mjs
import { bootPage, dismissOnboard, makeRec, finish } from './lib/gate-run.mjs'

const UI = process.env.VERIFY_BASE || 'http://127.0.0.1:5173'
const SEAM = '__lite2Store'
const { rows, rec } = makeRec()

// 第一批：一份花名册 + 一份项目台账。两份都是**首次上传**，一格都不该进流水。
const ROSTER = [
  '# 别墅酒店 员工花名册', '',
  '姓名 | 人员ID | 部门 | 职位 | 司龄',
  '周雅婷 | MKT-001 | 市场推广部 | 市场专员 | 3年',
].join('\n')
const LEDGER_V1 = ['# 婚宴对接', '负责人：老周', '状态：进行中', '截止：2026-09-30'].join('\n')
// 第二批三份**单一用途**的文档（一份文档 = 一张项目卡：标题取第一个 `#`，其余键行全并进
// 同一张。把三件事塞一个文件里会融成一张卡——写这道门时先踩过一次）。
// 🔴 阻塞那一行刻意写得**很长**（50+ 汉字），用来把「显示截断」那条判据喂饱。
//    第一版把长句写成文末那句散文，指望它成为 `summary`——但抽取器的 summary 取的是**第一条
//    键行**（`负责人：小马`，6 个字），于是 `clampWidth` 一次都没跑到，那条判据是根**死针**、
//    却以「截断没发生」的形态红。改文案/常量之前先做死针探测，说的就是这一下。
const LONG_BLOCKER = '雨季无备选场地，草坪主场地的排水改造要等工程部下个月进场，'
  + '这期间所有户外婚宴都得排进多功能厅，档期要重新和客户谈'
const LEDGER_V2 = [
  '# 婚宴对接', '负责人：小马', '状态：受阻', `阻塞：${LONG_BLOCKER}`, '',
  '本次旺季排班协调会决定，由宴会部小马接手婚宴对接的现场排班。',
].join('\n')
// 第三批：**再改一次**同一格。用来验「同一格被另一份资料再改一次 = 一条新的改动，
// 该重新回到未查阅」——那正是行 id 里带着出处文件的理由。
const LEDGER_V3 = ['# 婚宴对接', '负责人：老陈', '状态：进行中'].join('\n')
const V3_DOC = '交接补充说明.md'
const SPRING = ['# 春节值班排布', '负责人：周雅婷', '状态：进行中', '截止：2027-02-20'].join('\n')
const ROSTER_2 = [
  '# 别墅酒店 前厅部花名册', '',
  '姓名 | 人员ID | 部门 | 职位 | 司龄',
  '林小满 | FO-0422 | 前厅部 | 前厅主管 | 2年',
].join('\n')

const V2_DOC = '旺季排班协调纪要.md'

const boot = await bootPage({ url: `${UI}/?v=2&mode=live&look=paper&lang=zh`, trackPageErrors: true })
const { browser, page, pageErrors } = boot
await dismissOnboard(page)

const put = (name, text) => ({ name, text })
const send = async (files, fn) => page.evaluate(async ({ files, seam, fn }) => {
  const enc = new TextEncoder()
  await window[seam].getState()[fn](
    files.map((f) => new File([enc.encode(f.text)], f.name, { type: 'text/markdown' })))
}, { files, seam: SEAM, fn })

// ── ⓪ 铺语料：第一批走 uploadFiles（真 /ingest），第二批走 appendFiles（真 /append）──────
await send([put('员工花名册.md', ROSTER), put('项目台账.md', LEDGER_V1)], 'uploadFiles')
await page.waitForFunction(
  (seam) => ['ready', 'error'].includes(window[seam].getState().ingestStatus), SEAM,
  { timeout: 60000 }).catch(() => {})
await page.evaluate((seam) => window[seam].getState().goScreen('files'), SEAM)
await page.waitForTimeout(600)

// ── ④ 反向判据：**首次上传之后一行都不该有**（判据写宽的第一现场）───────────────────
const afterFirst = await page.evaluate((seam) => ({
  ingestStatus: window[seam].getState().ingestStatus,
  railRows: document.querySelectorAll('[data-files-zone="changes"]').length,
  rows: document.querySelectorAll('.lite-changes-row').length,
}), SEAM)
rec('⓪ 自证：第一批语料真的传进去了（不成立则整门空跑）',
  afterFirst.ingestStatus === 'ready', JSON.stringify(afterFirst))
rec('④ 🔴 首次上传后左栏**没有**「资料更新」这一行（判据只看 lineage 不看 provenance 时必红）',
  afterFirst.railRows === 0, JSON.stringify(afterFirst))
rec('④ 首次上传后一条流水都没有', afterFirst.rows === 0, JSON.stringify(afterFirst))

// 补传的文件必须比第一批**上传时刻更晚**才会顶掉旧读数（后端 `outranks`：认不出新旧一律
// 退回 keep-first）。两次真上传天然差着秒级，这里只多等一拍让时刻确定不同。
await page.waitForTimeout(1200)
await send([put(V2_DOC, LEDGER_V2), put('春节值班排布.md', SPRING),
  put('前厅部花名册.md', ROSTER_2)], 'appendFiles')
await page.waitForFunction(
  (seam) => ['ready', 'error'].includes(window[seam].getState().appendStatus), SEAM,
  { timeout: 60000 }).catch(() => {})
await page.waitForTimeout(800)

// ── ⓪b 自证：补传真的改写了那一格（判据的前提，不成立下面全是空真）───────────────────
const truth = await page.evaluate((seam) => {
  const raw = window[seam].getState().rawTeam
  const pr = (raw?.projects ?? []).find((p) => p.title === '婚宴对接')
  const born = (raw?.projects ?? []).find((p) => p.title === '春节值班排布')
  const joined = (raw?.people ?? []).find((p) => p.name === '林小满')
  const rec = pr?.lineage?.fields?.ownerName
  return {
    appendStatus: window[seam].getState().appendStatus,
    owner: pr?.ownerName ?? null,
    prevOwner: rec?.prev?.value ?? null,
    origin: pr?.provenance?.ownerName?.origin ?? null,
    source: rec?.source ?? null,
    blockers: pr?.blockers ?? null,
    blockersPrev: pr?.lineage?.fields?.blockers?.prev ?? null,
    bornAddedIn: born?.lineage?.added_in ?? null,
    joinedAddedIn: joined?.lineage?.added_in ?? null,
  }
}, SEAM)
rec('⓪b 自证：补传成功', truth.appendStatus === 'ready', JSON.stringify(truth))
rec('⓪b 自证：`lineage` 真的上线了（后端投影没接上时，下面每一条都是空真）',
  truth.source !== null && truth.prevOwner !== null, JSON.stringify(truth))
rec('⓪b 自证：负责人真的被顶掉了（老周 → 小马，出处指新资料）',
  truth.owner === '小马' && truth.prevOwner === '老周' && truth.origin === 'doc' &&
  String(truth.source).startsWith(V2_DOC), JSON.stringify(truth))
rec('⓪b 自证：新建的卡带着出生批次（新项目 + 新同事各一张）',
  !!truth.bornAddedIn && !!truth.joinedAddedIn &&
  truth.bornAddedIn === truth.joinedAddedIn, JSON.stringify(truth))

// ── ① 左栏那一行长出来了，且计数是**未查阅**的条数 ─────────────────────────────────
await page.waitForTimeout(400)
const rail = await page.evaluate(() => {
  const row = document.querySelector('[data-files-zone="changes"]')
  return {
    present: !!row,
    label: row?.querySelector('.lite-files-rail-label')?.textContent?.trim() ?? '',
    tail: row?.querySelector('.lite-files-rail-tail')?.textContent?.trim() ?? '',
    // 它必须在**主组**里（「文件」旁边），不是栏底次级组：这一区讲的就是那些文件的后果。
    inFoot: !!row?.closest('.lite-files-rail-foot'),
  }
})
rec('① 补传之后左栏长出「资料更新」这一行', rail.present && rail.label === '资料更新',
  JSON.stringify(rail))
rec('① 它在主组里，不在栏底次级组（罕用/销毁类才去栏底）', rail.present && !rail.inFoot,
  JSON.stringify(rail))

// ── ② 真点进去：分区**真卸载**的另一半——点之前它整段不在 DOM ──────────────────────
const beforeClick = await page.evaluate(() => document.querySelectorAll('#files-changes').length)
await page.click('[data-files-zone="changes"]')
await page.waitForTimeout(400)
const opened = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('.lite-changes-row')]
  return {
    section: document.querySelectorAll('#files-changes').length,
    filesSection: document.querySelectorAll('#files-current').length,
    title: document.querySelector('.lite-files-title')?.textContent?.trim() ?? '',
    count: document.querySelector('.lite-files-count')?.textContent?.trim() ?? '',
    groups: [...document.querySelectorAll('[data-change-group]')].map((g) => ({
      doc: g.getAttribute('data-change-group'),
      head: g.querySelector('.lite-changes-doc')?.textContent?.trim() ?? '',
      at: g.querySelector('.lite-changes-at')?.textContent?.trim() ?? '',
      rows: g.querySelectorAll('.lite-changes-row').length,
    })),
    kinds: rows.map((r) => r.getAttribute('data-change-kind')),
    texts: rows.map((r) => ({
      subject: r.querySelector('.lite-changes-subject')?.textContent?.trim() ?? '',
      prev: r.querySelector('.lite-changes-prev')?.textContent?.trim() ?? '',
      next: r.querySelector('.lite-changes-next')?.textContent?.trim() ?? '',
      cite: r.querySelector('.lite-changes-cite')?.textContent?.trim() ?? '',
    })),
  }
})
rec('② 点之前这一段整段不在 DOM（分区是真卸载不是 display:none —— 隐藏元素会让门以四种'
  + '并存的结局失效，#76 立的碑）', beforeClick === 0, `before=${beforeClick}`)
rec('② 点开之后这一段在，且「文件」那一段同时被卸载（两区不同屏）',
  opened.section === 1 && opened.filesSection === 0, JSON.stringify({
    section: opened.section, filesSection: opened.filesSection }))
rec('② 页头说清「这是什么 + 有多少」', opened.title === '资料更新'
  && /\d+\s*处改动/.test(opened.count), JSON.stringify({ t: opened.title, c: opened.count }))
rec('② 左栏那颗数字 === 屏上的行数（全未查阅时两者相等——⑥ 那条「它数的是未查阅」拿它当基准）',
  rail.tail === String(opened.texts.length), JSON.stringify({ tail: rail.tail, rows: opened.texts.length }))

// ── ③ 分组：一份文件一组，组头带文件名 + 上传时刻 ───────────────────────────────────
const v2group = opened.groups.find((g) => g.doc === V2_DOC)
rec('③ 按文件分组，改写那份文档自成一组', !!v2group && v2group.rows > 0,
  JSON.stringify(opened.groups))
rec('③ 组头印出文件名与它的上传时刻（时刻取自文件清单，不是另造一个时间）',
  !!v2group && v2group.head === V2_DOC && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(v2group.at),
  JSON.stringify(v2group))
rec('③ 第一批那两份文件**不**成组（首次上传不是改动）',
  !opened.groups.some((g) => g.doc === '项目台账.md' || g.doc === '员工花名册.md'),
  JSON.stringify(opened.groups.map((g) => g.doc)))

// ── ④ 「从 X 改成 Y」：判据落在**屏上那两串字**上，逐字对 payload ─────────────────────
const ownerRow = opened.texts.find((t) => t.subject.includes('负责人'))
rec('④ 🔴 有一行说「婚宴对接 · 负责人」，旧值 `老周` 与新值 `小马` **逐字**印在屏上'
  + '（判据落在那两串字本身：只判「有个箭头」的话，把旧值印成新值也全绿）',
  !!ownerRow && ownerRow.subject.includes('婚宴对接') && ownerRow.prev === '老周'
  && ownerRow.next === '小马', JSON.stringify(ownerRow))
rec('④ 那一行的引文指向**新**资料并带行号（旧值那份不该当引文——它已经不是这一格的依据）',
  !!ownerRow && ownerRow.cite.includes(V2_DOC) && /第\s*\d+\s*行/.test(ownerRow.cite),
  JSON.stringify(ownerRow))

// 状态那一行：旧值在血缘里存的是**归一化 token**（`on-track`）。屏上必须是卡片上那个词。
const statusRow = opened.texts.find((t) => t.subject.includes('状态'))
rec('④ 🔴 状态用**卡片上同一套词**（血缘里存的是 `on-track` 这种 token；直接印出来'
  + '经理会在流水里读到一个项目卡上从不出现的词）',
  !!statusRow && !/on-track|blocked|at-risk/.test(`${statusRow.prev}${statusRow.next}`)
  && statusRow.prev.length > 0 && statusRow.next.length > 0, JSON.stringify(statusRow))

// 长值截断：判据落在**显示宽度**上，不落在 `.length`。纯中文按宽度 56 截 = 屏上 28 个字
// （+ 一个省略号）；按 `.length` 截会放到 56 个字，宽度直接翻倍溢出。两种实现的可见字数
// 差着一倍，所以这条判据分得开它们（#69 那条「40 汉字 vs 40 字母差一倍宽」的可执行版本）。
const longRow = opened.texts.find((t) => t.subject.includes('卡点'))
const shownChars = [...(longRow?.next ?? '')].length
rec('④ 🔴 长值按**显示宽度**截断，不按 `.length`：纯中文按宽度 56 截 = 屏上 28 个字，'
  + '按 `.length` 截会放到 56 个字、宽度直接翻倍溢出。两种实现的可见字数差着一倍，'
  + '所以这条分得开它们（自证：语料那条阻塞 50+ 汉字，这根针不是死的）',
  !!longRow && longRow.next.endsWith('…') && shownChars > 20 && shownChars <= 29,
  JSON.stringify({ shownChars, next: longRow?.next }))

// ── ⑤ enrichment（补上了）与 added（新增卡）各自的形状 ───────────────────────────────
rec('⑤ 「补上了」那一类行存在且**不印旧值**（空格子被填上，没有任何读数被毁掉——'
  + '印一个旧值就是凭空发明一条读数）',
  opened.kinds.includes('filled')
  && opened.texts.every((t, i) => opened.kinds[i] !== 'filled' || t.prev === ''),
  JSON.stringify(opened.kinds))
const added = opened.texts.filter((t, i) => opened.kinds[i] === 'added')
rec('⑤ 新建的卡各有一行（新项目 + 新同事）——它们一格都没被顶掉，provenance 恒空，'
  + '不靠 `added_in` 就彻底看不见',
  added.length === 2 && added.some((t) => t.subject.includes('春节值班排布'))
  && added.some((t) => t.subject.includes('林小满')), JSON.stringify(added))

// ── ⑥ 「已查阅」：三段——标之前在、标之后收起、取消标记回来 ─────────────────────────
// 🔴 挑来标的行**刻意避开「负责人」**（#91 实收）：⑦ 会把这一行标着过刷新，而 ⑪ 的对照
//    基准要在可见行里找到「负责人」行再标它——⑦ 折叠掉的若正是它，⑪ 当场扑空。这个前提
//    此前是**碰巧**成立的：pre-#90 每个文件在 parse 时各自打 uploaded_at，同批三份时间戳
//    递增，组序（按上传时间倒序）把「前厅部花名册」排在最上；#90 起整批共享一个
//    received_at，平手回退派生序，「负责人」行成了第一行。行序两种都对（一次上传=一个
//    时刻更诚实），门的前提不该赌排序的巧合——显式选一行不是「负责人」的。
const firstId = await page.evaluate(() => {
  const row = [...document.querySelectorAll('.lite-changes-row')].find(
    (r) => !(r.querySelector('.lite-changes-subject')?.textContent ?? '').includes('负责人'))
  return row?.querySelector('.lite-changes-mark')?.getAttribute('data-change-mark') ?? ''
})
const before = await page.evaluate(() => document.querySelectorAll('.lite-changes-row').length)
await page.click(`[data-change-mark="${firstId}"]`)
await page.waitForTimeout(300)
const marked = await page.evaluate((id) => ({
  rows: document.querySelectorAll('.lite-changes-row').length,
  stillThere: document.querySelectorAll(`[data-change-mark="${id}"]`).length,
  fold: document.querySelector('[data-changes-fold]')?.textContent?.trim() ?? '',
}), firstId)
rec('⑥ 标之前那一行在（对照基准：不量它的话，一个一行都不渲染的实现同样满足下一条）',
  before > 0 && !!firstId, `rows=${before} id=${firstId}`)
rec('⑥ 标「已查阅」之后它从流水里收起，且总行数恰好少一行',
  marked.rows === before - 1 && marked.stillThere === 0, JSON.stringify({ before, ...marked }))
rec('⑥ 冒出一条「已查阅（1）」的折叠入口（收起 ≠ 删掉，得找得回来）',
  /已查阅（\s*1\s*）/.test(marked.fold), JSON.stringify(marked))
const tailAfterMark = await page.evaluate(() =>
  document.querySelector('[data-files-zone="changes"] .lite-files-rail-tail')?.textContent?.trim() ?? '')
rec('⑥ 🔴 左栏那颗数字跟着降到 5 —— 它数的是**未查阅**，不是总数（看过的不该继续敲你，'
  + '那正是这一票与拍板③「不打扰」共存的分寸）',
  tailAfterMark === String(before - 1), `${rail.tail} → ${tailAfterMark}`)

await page.click('[data-changes-fold]')
await page.waitForTimeout(300)
const unfolded = await page.evaluate((id) => ({
  rows: document.querySelectorAll('.lite-changes-row').length,
  read: document.querySelectorAll('.lite-changes-row[data-change-read="1"]').length,
  btn: document.querySelector(`[data-change-mark="${id}"]`)?.textContent?.trim() ?? '',
}), firstId)
rec('⑥ 展开折叠区：那一行回来了、带着已查阅标、按钮改口成「取消标记」',
  unfolded.rows === before && unfolded.read === 1 && unfolded.btn === '取消标记',
  JSON.stringify(unfolded))

await page.click(`[data-change-mark="${firstId}"]`)
await page.waitForTimeout(300)
const restored = await page.evaluate((id) => ({
  read: document.querySelectorAll('.lite-changes-row[data-change-read="1"]').length,
  btn: document.querySelector(`[data-change-mark="${id}"]`)?.textContent?.trim() ?? '',
  fold: document.querySelectorAll('[data-changes-fold]').length,
}), firstId)
rec('⑥ 取消标记之后回到未标态，折叠入口跟着消失（`restoreGap` 就是取消标记，零新状态机）',
  restored.read === 0 && restored.btn === '已查阅' && restored.fold === 0,
  JSON.stringify(restored))

// ── ⑦ 标记要**跨刷新**活着（localStorage，不是组件内存）─────────────────────────────
await page.click(`[data-change-mark="${firstId}"]`)
await page.waitForTimeout(300)
await page.reload({ waitUntil: 'networkidle' })
await dismissOnboard(page)
await page.evaluate((seam) => window[seam].getState().goScreen('files'), SEAM)
await page.waitForFunction(
  () => document.querySelectorAll('[data-files-zone="changes"]').length > 0,
  null, { timeout: 30000 }).catch(() => {})
await page.click('[data-files-zone="changes"]')
await page.waitForTimeout(500)
const afterReload = await page.evaluate((id) => ({
  rows: document.querySelectorAll('.lite-changes-row').length,
  gone: document.querySelectorAll(`[data-change-mark="${id}"]`).length,
  fold: document.querySelector('[data-changes-fold]')?.textContent?.trim() ?? '',
}), firstId)
rec('⑦ 刷新之后「已查阅」还在（localStorage 持久化；只活在组件 state 里时这条必红）',
  afterReload.rows === before - 1 && afterReload.gone === 0 && /已查阅/.test(afterReload.fold),
  JSON.stringify({ before, ...afterReload }))

// ── ⑧ 可点引文：先量它**在屏上有没有被切**，再点它 ────────────────────────────────
// 🔴 这一条是人眼看图逮到的 bug 的门版本：`.lite-btn` 基类是 `inline-flex` +
//    `justify-content:center`，而**居中的 flex 文本溢出时朝两头同时溢** —— 引文长成
//    「d据《旺季排班协调纪要.md》第 1 彳」，两端各被吃掉一个字，`text-overflow:ellipsis`
//    对 flex 里的匿名文本还压根不生效。
//    ⚠ 上面每一条判据读的都是 `textContent`，它完整得很、对裁剪一无所知（「门扫 innerText
//    看不见裁剪」的同族）。所以这里改用 **Range 量文字矩形**：文字的左缘不许跑到盒子左缘
//    以外。判据落在被测属性本身（有没有被切），不落在 `display` 值那种实现细节上。
const clip = await page.evaluate(() => {
  const out = []
  for (const btn of document.querySelectorAll('.lite-changes-cite')) {
    const node = [...btn.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim())
    if (!node) continue
    const r = document.createRange()
    r.selectNodeContents(node)
    const t = r.getBoundingClientRect()
    const b = btn.getBoundingClientRect()
    out.push({ textLeft: Math.round(t.left), boxLeft: Math.round(b.left),
      textRight: Math.round(t.right), boxRight: Math.round(b.right) })
  }
  return out
})
rec('⑧ 自证：量到了引文的文字矩形（一条都没量到 = 下一条是空真）', clip.length > 0,
  JSON.stringify(clip.length))
rec('⑧ 🔴 引文没有被**左端**切掉（居中 flex 溢出时朝两头同时溢，第一个字当场消失；'
  + '这一条读 textContent 的判据全都看不见）',
  clip.every((c) => c.textLeft >= c.boxLeft - 1), JSON.stringify(clip))
rec('⑧ 引文没有被**右端**硬切（要么整句放得下，要么由 ellipsis 收尾）',
  clip.every((c) => c.textRight <= c.boxRight + 1), JSON.stringify(clip))


await page.evaluate(() => {
  const btn = [...document.querySelectorAll('.lite-changes-cite')]
    .find((b) => (b.getAttribute('data-change-doc') ?? '').length > 0)
  btn?.scrollIntoView({ block: 'center' })
})
const citeDoc = await page.evaluate(() =>
  document.querySelector('.lite-changes-cite')?.getAttribute('data-change-doc') ?? '')
await page.click(`.lite-changes-cite[data-change-doc="${citeDoc}"]`)
await page.waitForTimeout(500)
const jumped = await page.evaluate(() => ({
  zone: document.querySelector('.lite-files-pane')?.getAttribute('data-files-pane') ?? '',
  filter: document.querySelector('.lite-files-filter-input')?.value ?? '',
  rows: [...document.querySelectorAll('.upload-file-row .upload-file-name')]
    .map((n) => n.textContent?.trim() ?? ''),
}))
rec('⑧ 点引文跳到「文件」区，并把筛选框填成那份文件名',
  jumped.zone === 'files' && jumped.filter === citeDoc, JSON.stringify(jumped))
rec('⑧ 跳过去之后清单**真的只剩那一份**（只切区不筛的话，用户还得自己在九行里找）',
  jumped.rows.length === 1 && jumped.rows[0].includes(citeDoc.replace(/\.md$/, '')),
  JSON.stringify(jumped))

// ── ⑪ 同一格被**另一份**资料再改一次 = 一条新的改动，回到未查阅 ────────────────────
// 这就是行 id 里带着出处文件的全部理由。不带的话，经理看过一次「负责人 老周→小马」，
// 一个月后另一份纪要把负责人又改成别人，这条改动会**生下来就是已读**——一次真正的改动
// 被一次早就发生过的「我看过了」永久吞掉。
await page.evaluate((seam) => window[seam].getState().goScreen('files'), SEAM)
await page.waitForTimeout(300)
await page.click('[data-files-zone="changes"]')
await page.waitForTimeout(300)
const ownerMarkId = await page.evaluate(() => [...document.querySelectorAll('.lite-changes-row')]
  .find((r) => (r.querySelector('.lite-changes-subject')?.textContent ?? '').includes('负责人'))
  ?.querySelector('.lite-changes-mark')?.getAttribute('data-change-mark') ?? '')
await page.click(`[data-change-mark="${ownerMarkId}"]`)
await page.waitForTimeout(300)
const ownerMarked = await page.evaluate(() => [...document.querySelectorAll('.lite-changes-row')]
  .filter((r) => (r.querySelector('.lite-changes-subject')?.textContent ?? '').includes('负责人')).length)
rec('⑪ 对照基准：「负责人」那一行已被标成已查阅、从流水里收起',
  !!ownerMarkId && ownerMarked === 0, `id=${ownerMarkId} rows=${ownerMarked}`)

await page.waitForTimeout(1200)
await send([put(V3_DOC, LEDGER_V3)], 'appendFiles')
await page.waitForFunction(
  (seam) => window[seam].getState().appendStatus === 'ready', SEAM,
  { timeout: 60000 }).catch(() => {})
await page.waitForTimeout(800)
const reChanged = await page.evaluate(() => {
  const hit = [...document.querySelectorAll('.lite-changes-row')]
    .find((r) => (r.querySelector('.lite-changes-subject')?.textContent ?? '').includes('负责人'))
  return {
    present: !!hit,
    read: hit?.getAttribute('data-change-read') ?? '',
    prev: hit?.querySelector('.lite-changes-prev')?.textContent?.trim() ?? '',
    next: hit?.querySelector('.lite-changes-next')?.textContent?.trim() ?? '',
    cite: hit?.querySelector('.lite-changes-cite')?.textContent?.trim() ?? '',
  }
})
rec('⑪ 🔴 第三份资料再改一次同一格 → 它作为**一条新的改动**回到未查阅（行 id 不带出处'
  + '文件时，这条改动会生下来就是已读——一次真改动被一次早就发生过的「看过了」吞掉）',
  reChanged.present && reChanged.read === '0', JSON.stringify(reChanged))
rec('⑪ 新那一行说的是「小马 → 老陈」，旧值跟着往前挪了一环（不是还挂着上一轮的 老周）',
  reChanged.prev === '小马' && reChanged.next === '老陈'
  && reChanged.cite.includes(V3_DOC), JSON.stringify(reChanged))

// ── ⑨ 不打扰：拍板③ 的可执行版本 ────────────────────────────────────────────────────
// 🔴 这一票能与拍板③（2026-08-07「补传后安静更新、不打扰」）共存，全靠这一段：流水只活在
//    资料库里。哪天有人顺手给它接一条通知/一张今天页的卡，这两条先红。
await page.evaluate((seam) => window[seam].getState().goScreen('home'), SEAM)
await page.waitForTimeout(700)
const home = await page.evaluate(() => ({
  changeRows: document.querySelectorAll('.lite-changes-row').length,
  section: document.querySelectorAll('#files-changes').length,
}))
rec('⑨ 🔴 今天页上一条流水都没有（不占今天页）',
  home.changeRows === 0 && home.section === 0, JSON.stringify(home))

// 铃铛：判据不是「未读为 0」——补传本身会发一条 ingest 通知，那是既有行为、不归本票。
// 判的是**没有一条通知在讲这件事**：真给它接了通知，那条 copy 必然用 `changesTitle`
// 这个词（屏上这一区就叫这个），所以扫得到。
await page.click('.lite-bell-toggle').catch(() => {})
await page.waitForTimeout(400)
const bell = await page.evaluate(() => ({
  open: document.querySelectorAll('.lite-bell-pop').length,
  texts: [...document.querySelectorAll('.lite-bell-pop')].map((p) => p.textContent ?? ''),
}))
rec('⑨ 自证：铃铛面板真的打开了（不然下一条是空真）', bell.open === 1, JSON.stringify(bell.open))
rec('⑨ 🔴 没有一条通知在讲「资料更新」（拍板③「不打扰」——这一票与它共存的全部前提'
  + '就是流水只活在资料库里）',
  bell.texts.every((t) => !t.includes('资料更新')), JSON.stringify(bell.texts).slice(0, 400))

rec('⑩ 全程无 pageerror', pageErrors.length === 0, pageErrors.join(' | '))

await finish({ rows }, {
  browser, label: '#85 「这次补料改了什么」只读流水 + 已查阅', listFailures: true,
})
