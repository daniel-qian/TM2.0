// #64 · at-references 端到端门：@ 弹层（键盘）→ chip → **refs 真的到了 POST /advise 请求体**
// → 织文兜底在 → 悬浮胶囊中继整条链。
//
// ## 这道门防的是什么
// 本票最容易活下来的假实现是「UI 有 chip、请求体没 refs」——界面看着全好，后端拿到的还是
// 纯文本，保证注入整层空转。所以主判据**只认网络请求**（page.on('request') 抓 POST /advise
// 的 body），绝不落在 store 上——T10 的门洞教训：门驱动 store 还是真部件，决定它能不能看见
// 「接线」型 bug。这里从头到尾用真键盘打真输入框（pressSequentially / ArrowDown / Enter），
// store 只用来铺语料与换屏。
//
// ## 判据分段（每段带自证，防「判据够不着时假装通过」）
//   ⓪ 真上传中文语料（重名两位林小满 + 项目 + SOP 方法）→ 自证 contextId/双林都在。
//   ① 议事室 composer 打 `@林` 弹层：combobox aria 齐全；两位林小满**都带部门**（重名消歧）；
//      ↓ 键把高亮走到第二位；Enter 选中 = chip 是**客房部那一位**（证明高亮真在走，不是恒选第一）。
//   ② chip 的移除键键盘可达（focus + Enter），删掉后 chip 消失。
//   ③ 提交 → 抓 POST /advise：references=[person，id=选中那位的 id]；situation 同时织进了
//      「涉及：」+ 名字（新前端+旧后端窗口期的兜底就是这几个字）；问题原文也在。
//   ④ 无引用提交 → 请求体**没有 references 键**（additive 契约：absent≠[]）。
//   ⑤ 文件 tab：@ 空查询 + 点「文件」chip → 上传过的文件名在候选里（四类轴真的有第三类）。
//   ⑥ 悬浮胶囊：home 屏开胶囊 → `@别墅` 选项目 → 打问题 → Enter → 落到 /room 且 composer
//      预填了问题 + chip（EPHEMERAL q/refs 中继整条链）→ 提交 → 请求体带 project ref。
//   ⑦ Esc 分层：层开着 Esc 只关层（胶囊还在）；再 Esc 才收胶囊。
//   ⑧ #66 · 弹层几何（三宿主 × 视口矩阵）：bbox 完整在视口内 + elementFromPoint 实测顶沿
//      真的画出来（🔴 rect 不管裁剪——.scene overflow:hidden 的硬裁只有 hit-test 看得见）+
//      与输入框相邻（空态病根是「飞离输入框」，相邻判据就是它的讨伐位）。
//   ⑨ #67 · 预填入口全量引用化：7 个入口逐个**真点**（团队屏人卡 / 项目屏卡面 / 项目详情
//      浮层 / 人员详情浮层 / 晨间分诊卡（多引用）/ 差距卡 / 决策卡（goScreen refs 中继））→
//      议事室 chip 在场 → 提交 → **POST /advise 请求体带对应 references[]**。
//      #69 改判：同一批入口现在还要满足「正文空 + 灰提示带入口上下文 + 发送键置灰」，
//      提交后 situation **不含**提示文字（提示是提示，不是替 manager 打的字）。
//
// ## #71 改判（会话流）
// 议事室的对话在**离开屏时清空**（票面拍板：session 内连续，离开/刷新即结束）。本门里
// 每次 goScreen 走开再回来，议事室都回到空态——⑧(a) 的「运行态宿主」因此要**当场问一句**
// 造出来，不能再指望上一段留下的 run 还挂在那儿。同理 submitRoom 必须自己打字：
// #69 之后入口带来的是 placeholder，输入框是空的，空文本发送键 disabled，光按 Enter 发不出去。
//
// ## 怎么跑
// 🔴 **上传型门**（真发 POST /ingest 造 context）；**绝不能排在 C 区之后**（dist 被 C 区
//    重打成生产域名后，任何上传都是往生产库写测试数据）。
//   后端：AVERY_BRAIN=mock AVERY_EXTRACTOR=heuristic AVERY_EMBEDDINGS=keyword uvicorn :8137
//   前端：vite build --mode development + vite preview --host --port 5173
//   VERIFY_BASE=http://localhost:5173 node eval-harness/tools/verify-at-references.mjs
// ⚠ 显式 `?lang=zh`：织文前缀「涉及：」是 zh 词——默认 EN 壳下这条判据会以文案不对假红。
import { bootPage, dismissOnboard, makeRec, finish } from './lib/gate-run.mjs'

const UI = process.env.VERIFY_BASE || 'http://127.0.0.1:5173'
const SEAM = '__lite2Store'
const { rows, rec } = makeRec()

// 🔴 花名册人数 > MAX_REF_OPTIONS(8) 是 ⑤b 的**前提**，不是凑数：3 人 2 项目的旧语料里
// 8 个名额本来就有 3 个漏给文件，「打 @ 看得见文件」在**没修的代码上照样绿**（假绿）。
// 真实团队是 16 人 8 项目——人员一类就能吃光名额，那才是 Danny 演习撞上的现场。
// 加的六行有三条硬约束（都是既有判据的地雷）：不带「林」（①的 `@林` 要恰好两条命中）、
// 不进「客房」部（③的 `@客房` 要唯一命中）、不带「别墅」（⑥的 `@别墅` 要唯一命中项目）。
const ROSTER = [
  '# 别墅酒店 员工花名册', '',
  '姓名 | 人员ID | 部门 | 职位 | 司龄',
  '周雅婷 | MKT-001 | 市场推广部 | 市场专员 | 3年',
  '林小满 | FO-0422 | 前厅部 | 前厅主管 | 2年',
  '林小满 | HK-0301 | 客房部 | 客房领班 | 4年',
  '高见 | FB-1101 | 餐饮部 | 餐饮主管 | 5年',
  '钱多 | ENG-2201 | 工程部 | 工程主管 | 6年',
  '孙悦 | HR-3301 | 人力资源部 | 培训专员 | 1年',
  '吴桐 | BQ-4401 | 宴会销售部 | 宴会销售 | 3年',
  '郑好 | REC-5501 | 康乐部 | 康乐主管 | 2年',
  '冯雷 | SEC-6601 | 安保部 | 安保主管 | 7年',
].join('\n')
const PROJECT = ['# 别墅套餐推广', '负责人：周雅婷', '状态：受阻', '截止：2026-10-15', '进度：55%',
  '阻塞：雨季无备选场地'].join('\n')
const SOP = ['# 运营手册', '', '## 方法：客诉一次响应', '适用：前厅接到住客投诉的第一小时',
  '标签：前厅、客诉', '- 先道歉并复述问题'].join('\n')
// ⑨ 差距卡入口要一张真差距卡：自报「正常」（extract.py 词表 → steady，进 gapDerive 的
// STEADY_STATUSES）但真有阻塞行——「自报稳/真有卡点」矛盾（flow-gap-phases 同款造法）。
const PARK = ['# 亲子乐园改造', '负责人：林小满', '状态：正常', '进度：40%',
  '阻塞：设备供应商延迟交付'].join('\n')

const boot = await bootPage({ url: `${UI}/?v=2&mode=live&look=paper&lang=zh`, trackPageErrors: true })
const { browser, page, pageErrors } = boot

// 主判据的抓手：真的发出去的 POST /advise 请求体（网络层，不是 store）。
const advisePosts = []
page.on('request', (r) => {
  if (r.method() === 'POST' && /\/advise$/.test(new globalThis.URL(r.url()).pathname)) {
    try { advisePosts.push(JSON.parse(r.postData() || 'null')) } catch { advisePosts.push(null) }
  }
})
const waitForPosts = async (n, ms = 20000) => {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    if (advisePosts.length >= n) return true
    await page.waitForTimeout(100)
  }
  return false
}
// #71：上一轮还在流时发送键是 disabled 的（对齐 codex/claude：生成中不收新消息）。
// 同一次进屋里连问两发之前必须等它落定，否则第二发的 Enter 会被那个闸挡掉——
// 那是**被测行为正常工作**，不是 bug，门自己要遵守它。
const waitRoomSettled = (ms = 30000) => page.waitForFunction(
  (seam) => {
    const turns = window[seam].getState().turns ?? []
    if (turns.length === 0) return true
    return ['complete', 'error'].includes(turns[turns.length - 1].run.status)
  }, SEAM, { timeout: ms }).then(() => true).catch(() => false)

// ── ⓪ 铺语料（store 只在这一段当搬运工；被测部件从①起全走真键盘）────────────────────────
await page.evaluate(async ({ files, seam }) => {
  const enc = new TextEncoder()
  await window[seam].getState().uploadFiles(
    files.map((f) => new File([enc.encode(f.text)], f.name, { type: 'text/markdown' })))
}, { files: [
  { name: '花名册.md', text: ROSTER },
  { name: '项目周报.md', text: PROJECT },
  { name: '运营手册.md', text: SOP },
  { name: '亲子乐园.md', text: PARK },
], seam: SEAM })
await page.waitForFunction(
  (seam) => ['ready', 'error'].includes(window[seam].getState().ingestStatus), SEAM,
  { timeout: 45000 }).catch(() => {})
const base = await page.evaluate((seam) => {
  const st = window[seam].getState()
  const lins = (st.team?.people ?? []).filter((p) => p.name === '林小满')
  return {
    ingestStatus: st.ingestStatus,
    contextId: st.contextId,
    linCount: lins.length,
    linTeams: lins.map((p) => p.team ?? ''),
    houseId: lins.find((p) => p.team === '客房部')?.id ?? null,
    projectId: (st.team?.projects ?? []).find((p) => p.title.includes('别墅套餐'))?.id ?? null,
  }
}, SEAM)
rec('⓪ 自证：语料上传成功且两位林小满都在（重名消歧的前提）',
  base.ingestStatus === 'ready' && base.linCount === 2 && base.projectId !== null,
  JSON.stringify(base))

// ── ① 议事室 composer：@ 弹层 + 键盘选中 ─────────────────────────────────────────────────
await page.evaluate((seam) => window[seam].getState().goScreen('room'), SEAM)
await page.waitForTimeout(600)
const input = () => page.locator('.lite-room .nexus-followup-composer [data-composer-input]')
const ROOM_INPUT = '.lite-room .nexus-followup-composer [data-composer-input]'
// 清空正文控件的唯一实现（此前文件里有两份内联拷贝，textarea 化时漏改一份就当场
// `Illegal invocation` 崩掉——合成一份就不会再漏）。
const clearInputEl = (sel) => page.evaluate((s) => {
  const inp = document.querySelector(s)
  if (inp) {
    // #75：正文控件可能是 textarea——setter 必须按真实 tag 取。取错原型链上的那个：
    // 在 textarea 上直接抛 `Illegal invocation`（崩），在别的控件上则可能**静默无效**
    // （值看着清了、React 的 state 没动），后面所有「输入框已清空」的前提就全是假的。
    const proto = inp.tagName === 'TEXTAREA'
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set
    setter.call(inp, '')
    inp.dispatchEvent(new Event('input', { bubbles: true }))
  }
}, sel)
rec('① 自证：议事室常驻 composer 在屏上', (await input().count()) === 1)
// #69 · 无预填时的默认提示——⑨ 用它当"这条提示确实来自入口"的对照（只判非空会被
// 「提示恒等于默认文案」的假实现蒙混过去）。
const DEFAULT_PLACEHOLDER = await page.evaluate(() =>
  document.querySelector('.lite-room .nexus-followup-composer [data-composer-input]')
    ?.getAttribute('placeholder') ?? '')
rec('① 自证：默认 placeholder 采到了（⑨ 的对照基准）', DEFAULT_PLACEHOLDER.length > 0,
  JSON.stringify(DEFAULT_PLACEHOLDER))

await input().click()
await input().pressSequentially('@林', { delay: 40 })
await page.waitForTimeout(300)
const menu = await page.evaluate(() => {
  const inp = document.querySelector('.lite-room .nexus-followup-composer [data-composer-input]')
  const picker = document.querySelector('.lite-ref-picker')
  const opts = Array.from(picker?.querySelectorAll('[role="option"]') ?? []).map((o) => ({
    label: o.querySelector('.lite-ref-option-label')?.textContent ?? '',
    team: o.querySelector('.lite-ref-option-team')?.textContent ?? '',
    selected: o.getAttribute('aria-selected'),
  }))
  return {
    pickerIn: !!picker,
    role: inp?.getAttribute('role'),
    expanded: inp?.getAttribute('aria-expanded'),
    listboxIn: !!picker?.querySelector('[role="listbox"]'),
    filterChips: picker?.querySelectorAll('.lite-composer-filter').length ?? 0,
    opts,
  }
})
rec('① 打 @ 弹层开了，combobox aria 齐全（role/aria-expanded/listbox）',
  menu.pickerIn && menu.role === 'combobox' && menu.expanded === 'true' && menu.listboxIn,
  JSON.stringify({ role: menu.role, expanded: menu.expanded }))
rec('① 五个筛选 chip（全部/人员/项目/文件/方法）都在', menu.filterChips === 5,
  `filters × ${menu.filterChips}`)
rec('① 重名消歧：两位林小满都在候选里，且**各带部门**',
  menu.opts.filter((o) => o.label === '林小满').length === 2 &&
  menu.opts.filter((o) => o.label === '林小满').every((o) => o.team !== '') &&
  new Set(menu.opts.filter((o) => o.label === '林小满').map((o) => o.team)).size === 2,
  JSON.stringify(menu.opts))

await input().press('ArrowDown')
await input().press('Enter')
await page.waitForTimeout(200)
const picked = await page.evaluate(() => {
  const chip = document.querySelector('.lite-room .lite-ref-chip')
  const inp = document.querySelector('.lite-room .nexus-followup-composer [data-composer-input]')
  return {
    chipLabel: chip?.querySelector('.lite-ref-chip-label')?.textContent ?? null,
    chipTeam: chip?.querySelector('.lite-ref-chip-team')?.textContent ?? null,
    chipId: chip?.getAttribute('data-ref-id') ?? null,
    inputValue: inp?.value ?? null,
    pickerGone: !document.querySelector('.lite-ref-picker'),
  }
})
rec('① ↓+Enter 选中的是**第二位**（客房部）——高亮真的在走，不是恒选第一条',
  picked.chipLabel === '林小满' && picked.chipTeam === '客房部' && picked.chipId === base.houseId,
  JSON.stringify(picked))
rec('① 选中后 @词 从文字里摘掉、层收起', picked.inputValue === '' && picked.pickerGone,
  JSON.stringify({ value: picked.inputValue, pickerGone: picked.pickerGone }))

// ── ② chip 移除键键盘可达 ────────────────────────────────────────────────────────────────
await page.locator('.lite-room .lite-ref-chip .lite-composer-remove').focus()
await page.keyboard.press('Enter')
await page.waitForTimeout(200)
rec('② 移除键 focus+Enter 删得掉 chip（键盘可达）',
  (await page.locator('.lite-room .lite-ref-chip').count()) === 0)

// ── ③ 提交 → refs 真的到了后端（主判据：网络请求体）─────────────────────────────────────
await input().pressSequentially('她这周的排班压力怎么样', { delay: 20 })
await input().pressSequentially('@客房', { delay: 40 })
await page.waitForTimeout(300)
await input().press('Enter') // 层开着：Enter=选中（唯一命中=客房部林小满）
await page.waitForTimeout(200)
const chipBack = await page.evaluate(() =>
  document.querySelector('.lite-room .lite-ref-chip .lite-ref-chip-label')?.textContent ?? null)
rec('③ 自证：chip 又选回来了（客房部林小满）', chipBack === '林小满', String(chipBack))
await input().press('Enter') // 层已收起：这一发才是提交
const gotFirst = await waitForPosts(1)
const post1 = advisePosts[0]
rec('③ POST /advise 请求体带 references=[{kind:person, id=客房部那位}]（判据落在网络上）',
  gotFirst && Array.isArray(post1?.references) && post1.references.length === 1 &&
  post1.references[0].kind === 'person' && post1.references[0].id === base.houseId &&
  post1.references[0].label === '林小满',
  JSON.stringify(post1?.references ?? null))
rec('③ 织文兜底在：situation 同时带问题原文 + 「涉及：」+ 名字（旧后端窗口期的全部机制）',
  gotFirst && typeof post1?.situation === 'string' &&
  post1.situation.includes('她这周的排班压力怎么样') &&
  post1.situation.includes('涉及：') && post1.situation.includes('林小满'),
  JSON.stringify(post1?.situation ?? null))

// ── ④ 无引用：请求体不带 references 键（additive，absent≠[]）───────────────────────────
// #71：同一次进屋里连问第二发，先等上一轮落定（running 时发送键 disabled）。
rec('④ 自证：上一轮已落定（#71 的 busy 闸放行）', await waitRoomSettled())
await input().click()
await input().pressSequentially('下周谁最需要我搭把手', { delay: 20 })
await input().press('Enter')
const gotSecond = await waitForPosts(2)
const post2 = advisePosts[1]
rec('④ 无引用提交：请求体**没有** references 键', gotSecond && post2 && !('references' in post2),
  JSON.stringify(Object.keys(post2 ?? {})))

// ── ⑤b · #70 「全部」视图公平曝光：人多不许把文件/方法整类挤出候选 ─────────────────────
// 🔴 这一段必须排在 ⑤ 之前：⑤ 点了「文件」筛选 chip，filter 是组件 state、会一直留着。
// 判据分四条，各防一种走样：自证语料真能复现病根 / 四类都在场 / 别把上限调大了事 /
// **不滚就看得见**（弹层列表被 #66 钳在 240px，一屏 4–5 行；只断言「在 DOM 里」等于允许
// 一个把文件排在第九行、要滚才见的实现全绿——那是修了一半）。
await input().pressSequentially('@', { delay: 40 })
await page.waitForTimeout(300)
const fairness = await page.evaluate(() => {
  const picker = document.querySelector('.lite-ref-picker')
  const list = picker?.querySelector('.lite-ref-picker-list')
  const opts = Array.from(picker?.querySelectorAll('[role="option"]') ?? [])
  const kinds = opts.map((o) => o.getAttribute('data-ref-kind'))
  const firstFile = opts.find((o) => o.getAttribute('data-ref-kind') === 'file') ?? null
  let fileVisible = false
  let fileRect = null
  if (firstFile && list) {
    const r = firstFile.getBoundingClientRect()
    const lr = list.getBoundingClientRect()
    // 不滚即见：整行落在列表的可视带里（开层时 scrollTop=0，所以「在带内」= 不用滚）。
    const inBand = r.top >= lr.top - 1 && r.bottom <= lr.bottom + 1
    // 🔴 rect 不管裁剪/遮挡（verifiers-that-lie 碑）：中心点 hit-test 才是"真画出来了"。
    const probe = document.elementFromPoint(
      Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2))
    fileVisible = inBand && !!probe && firstFile.contains(probe)
    fileRect = { top: Math.round(r.top), bottom: Math.round(r.bottom),
                 listTop: Math.round(lr.top), listBottom: Math.round(lr.bottom),
                 scrollTop: Math.round(list.scrollTop) }
  }
  return {
    total: opts.length,
    kinds,
    labels: opts.map((o) => o.querySelector('.lite-ref-option-label')?.textContent ?? ''),
    activeFilter: picker?.querySelector('.lite-composer-filter.is-active')?.textContent ?? null,
    fileVisible,
    fileRect,
  }
})
const rosterSize = await page.evaluate((seam) => ({
  people: (window[seam].getState().team?.people ?? []).length,
  projects: (window[seam].getState().team?.projects ?? []).length,
}), SEAM)
rec('⑤b 自证：语料真能复现病根（人员+项目 ≥ 候选上限 8——否则文件本来就挤不掉，判据是空跑）',
  rosterSize.people + rosterSize.projects >= 8, JSON.stringify(rosterSize))
rec('⑤b 自证：这一屏确实是「全部」视图（零筛选——不是被上一段的文件 chip 带过来的）',
  fairness.activeFilter === '全部', String(fairness.activeFilter))
rec('⑤b 打 @ 零筛选：四类候选**都在场**（文件不许被人员挤光——Danny 演习「没法引用文件」的讨伐位）',
  ['person', 'project', 'file', 'playbook'].every((k) => fairness.kinds.includes(k)),
  JSON.stringify({ kinds: fairness.kinds, labels: fairness.labels }))
rec('⑤b 公平曝光没把弹层撑大：候选总数仍 ≤ 8（「把 8 调大了事」这条路必红）',
  fairness.total > 0 && fairness.total <= 8, `n=${fairness.total}`)
rec('⑤b 文件候选**不滚就看得见**（整行在列表可视带内 + 中心点 hit-test 真命中）',
  fairness.fileVisible, JSON.stringify(fairness.fileRect))

// ── ⑤ 文件 tab：四类候选轴的第三类真的有货 ──────────────────────────────────────────────
await page.locator('.lite-ref-picker .lite-composer-filter', { hasText: '文件' }).click()
await page.waitForTimeout(200)
const fileOpts = await page.evaluate(() =>
  Array.from(document.querySelectorAll('.lite-ref-picker [role="option"] .lite-ref-option-label'))
    .map((n) => n.textContent))
rec('⑤ 「文件」tab 里能看到上传过的文件名', fileOpts.includes('项目周报.md'),
  JSON.stringify(fileOpts))

// ── ⑤c · #70 文件引用真的走完整条链到请求体（kind=file + 中文 id）─────────────────────
// 补的是既有覆盖洞：在这之前**没有一条 kind=file 的引用**穿过 toWireRefs 进过网络层——
// 非 ASCII 的 id（文件名就是 id）最容易在编码上出事的那一段一直没被采样过。
// ⚠ 这条**不是** born-red 判据：它不测公平曝光（走的是文件 tab），恢复旧顺序它照绿。
await page.locator('.lite-ref-picker [role="option"][data-ref-kind="file"]')
  .filter({ hasText: '项目周报.md' }).first().click()
await page.waitForTimeout(200)
const fileChip = await page.evaluate(() => {
  const chip = document.querySelector('.lite-room .lite-ref-chip')
  return { kind: chip?.getAttribute('data-ref-chip') ?? null, id: chip?.getAttribute('data-ref-id') ?? null }
})
rec('⑤c 选中文件候选 → file chip 在场（id = 文件名）',
  fileChip.kind === 'file' && fileChip.id === '项目周报.md', JSON.stringify(fileChip))
await input().pressSequentially('这份周报里写了什么', { delay: 20 })
const postsBeforeFile = advisePosts.length
await input().press('Enter')
const gotFile = await waitForPosts(postsBeforeFile + 1)
const postFile = advisePosts[postsBeforeFile]
rec('⑤c POST /advise 请求体带 references=[{kind:file, id:项目周报.md}]（中文 id 原样过网络层）',
  gotFile && Array.isArray(postFile?.references) &&
  postFile.references.some((r) => r.kind === 'file' && r.id === '项目周报.md' &&
    r.label === '项目周报.md'),
  JSON.stringify(postFile?.references ?? null))
await page.waitForTimeout(500)

// 把筛选还原成「全部」：filter 是组件 state，留着「文件」会让后面 ⑧ 的几何段在一个
// 与产品默认不同的候选面上量（同一个 composer 实例）。
await input().pressSequentially('@', { delay: 40 })
await page.waitForTimeout(200)
await page.locator('.lite-ref-picker .lite-composer-filter', { hasText: '全部' }).click()
await page.waitForTimeout(200)
await input().press('Escape')
// #75：这里原本是 clearInputEl 的第二份**内联拷贝**，写死了 HTMLInputElement 原型——
// textarea 化之后 setter.call 直接抛 `Illegal invocation`（是崩不是红）。改成调那个助手，
// 顺手把两份合成一份，省得下次控件再变又漏一处。
await clearInputEl(ROOM_INPUT)

// ── ⑥ 悬浮胶囊中继：q + refs 一起进屋 ───────────────────────────────────────────────────
await page.evaluate((seam) => window[seam].getState().goScreen('home'), SEAM)
await page.waitForTimeout(600)
rec('⑥ 自证：home 屏上悬浮胶囊在（room 屏上它刻意收起）',
  (await page.locator('.lite-ask-avery-pill').count()) === 1)
await page.locator('.lite-ask-avery-pill').click()
await page.waitForTimeout(300)
const pillInput = () => page.locator('.lite-ask-avery-form [data-composer-input]')
await pillInput().pressSequentially('@别墅', { delay: 40 })
await page.waitForTimeout(300)
await pillInput().press('Enter') // 唯一命中：项目「别墅套餐推广」
await page.waitForTimeout(200)
const pillChip = await page.evaluate(() =>
  document.querySelector('.lite-ask-avery-form .lite-ref-chip')?.getAttribute('data-ref-chip') ?? null)
rec('⑥ 胶囊里选中项目变 chip', pillChip === 'project', String(pillChip))
await pillInput().pressSequentially('这个项目下一步怎么排', { delay: 20 })

// ── #75 改判 · 胶囊从「预填中继」改成「即发」──────────────────────────────────────────
// 原来这里的记账是：胶囊 Enter 只搬运（零 POST）→ 落地 /room 后读 composer.value 断言
// 「预填了但没发」→ 脚本自己再按一次 Enter 才真提交，然后按下标取那一发。
// 改成即发之后那套记账**整体错位**：POST 在胶囊这一按就打出去了，早于原来的 postsBefore
// 采样点；落地时 composer 已被清空，`value === '这个项目下一步怎么排'` 会读到空串。
// 🔴 这条红是「改对了」不是回归——所以判据跟着票面重写，而不是想办法让旧断言继续绿。
// 新记账：**先**记基线，**再**按胶囊那一发，直接抓它自己打出去的那个 POST。
const postsBefore = advisePosts.length
await pillInput().press('Enter')
const gotThird = await waitForPosts(postsBefore + 1)
const post3 = advisePosts[postsBefore]
rec('⑥ #75 · 胶囊按发送＝**真发出去**（不再是预填中继，那一按就有 POST /advise）',
  gotThird, `postsBefore=${postsBefore} now=${advisePosts.length}`)
rec('⑥ 胶囊带来的 refs 随那一发进了请求体（project ref + 织文）',
  gotThird && Array.isArray(post3?.references) && post3.references[0]?.kind === 'project' &&
  post3.references[0]?.id === base.projectId &&
  post3.situation.includes('涉及：') && post3.situation.includes('别墅套餐推广'),
  JSON.stringify(post3?.references ?? null))
await page.waitForTimeout(800)
const relay = await page.evaluate(() => ({
  path: window.location.pathname,
  turns: document.querySelectorAll('.lite-room-turn').length,
  question: document.querySelector('.lite-room-turn-question-text')?.textContent ?? null,
  // 发完之后 composer 必须是空的——问题已经在会话流里了，还留在输入框里就是「发了没发」两说。
  value: document.querySelector('.lite-room .nexus-followup-composer [data-composer-input]')?.value ?? null,
}))
rec('⑥ #75 · 落地即在议事室里成了**一轮真对话**（不是一个待发的草稿）',
  relay.path === '/room' && relay.turns >= 1 &&
  (relay.question ?? '').includes('这个项目下一步怎么排') && relay.value === '',
  JSON.stringify(relay))

// ── ⑦ Esc 分层（胶囊）─────────────────────────────────────────────────────────────────────
await page.evaluate((seam) => window[seam].getState().goScreen('home'), SEAM)
await page.waitForTimeout(600)
await page.locator('.lite-ask-avery-pill').click()
await page.waitForTimeout(300)
await pillInput().pressSequentially('@林', { delay: 40 })
await page.waitForTimeout(200)
await pillInput().press('Escape')
await page.waitForTimeout(200)
const afterFirstEsc = await page.evaluate(() => ({
  picker: !!document.querySelector('.lite-ref-picker'),
  form: !!document.querySelector('.lite-ask-avery-form'),
}))
rec('⑦ 层开着 Esc 只关层，胶囊输入框还在', !afterFirstEsc.picker && afterFirstEsc.form,
  JSON.stringify(afterFirstEsc))
await pillInput().press('Escape')
await page.waitForTimeout(200)
rec('⑦ 再 Esc 才收胶囊（回到 pill 态）',
  (await page.locator('.lite-ask-avery-form').count()) === 0 &&
  (await page.locator('.lite-ask-avery-pill').count()) === 1)

// ── ⑧ #66 · 弹层几何：三宿主 × 视口矩阵，完整可见且贴着输入框 ───────────────────────────
// 视口矩阵的账（矮的两档不是拍脑袋）：
//   · 900×600 —— 票面点名的矮视口。议事室**空态**在这档上方的 .scene 裁剪窗口装不下整层，
//     必须翻转向下——拆掉碰撞检测，这条就红。
//   · 900×340 —— 高 zoom 小窗（Windows 125–150% 缩放的有效视口就这个量级，Danny 截图里
//     胶囊顶行被裁的现场）。胶囊上方余量 < 整层高度，必须钳制列表——拆掉钳制，这条就红。
//   · 运行态两档都装得下（composer 在场景底、上方全空）——它的判据是「修完不许反倒坏」的回归位。
const pickerGeom = () => page.evaluate(() => {
  const picker = document.querySelector('.lite-ref-picker')
  const form = picker?.closest('form')
  // #75：正文控件是 textarea 了，`input[type="text"]` 在这里会返回 null，⑧ 整段（9 条 rec）
  // 会因为 pickerGeom() 恒 null 而**整批变红**，且红得像「弹层几何坏了」。锚到稳定钩子上。
  // ⚠ `picker.closest('form')` 这一跳仍是本段的地基：弹层必须留在 composer 的 form 内部，
  //   哪天把它挪进 portal，这里要一起改。
  const inp = form?.querySelector('[data-composer-input]')
  if (!picker || !inp) return null
  const p = picker.getBoundingClientRect()
  const i = inp.getBoundingClientRect()
  // 🔴 rect 不管裁剪（verifiers-that-lie 碑）：顶沿是否真画出来用 elementFromPoint 实测——
  // 被 .scene overflow:hidden 硬裁或被高 z 层盖住时，命中的都不是弹层后代。
  const probe = document.elementFromPoint(Math.round(p.left + p.width / 2), Math.round(p.top + 2))
  const gapUp = i.top - p.bottom // 上弹：层底边 → 输入框顶边
  const gapDown = p.top - i.bottom // 下弹：输入框底边 → 层顶边
  return {
    inViewport:
      p.top >= 0 && p.left >= 0 && p.bottom <= window.innerHeight && p.right <= window.innerWidth,
    topVisible: !!(probe && picker.contains(probe)),
    // ≤64px 容差吃掉 form 内边距/chips 行；空态病根那种 130px+ 的「飞离」远在容差外。
    adjacent: (gapUp >= 0 && gapUp <= 64) || (gapDown >= 0 && gapDown <= 64),
    down: picker.classList.contains('is-down'),
    top: Math.round(p.top), bottom: Math.round(p.bottom), vh: window.innerHeight,
  }
})
// (a) 议事室运行态 @ 1280×900（bootPage 默认视口）
// 🔴 #71：离开议事室 = 这场对话结束（turns 清空），所以「运行态宿主」得**当场问一句**造出来
//    ——⑦ 那一段刚把人带去 home，上一段留下的对话已经散了。
await page.evaluate((seam) => window[seam].getState().goScreen('room'), SEAM)
await page.waitForTimeout(600)
await input().click()
await input().pressSequentially('这周有什么要紧的', { delay: 20 })
await input().press('Enter')
await waitForPosts(advisePosts.length + 1)
await waitRoomSettled()
// #75 改判：`.lite-room-scroll` 现在**两态都在**（空态与对话态同一棵树），拿它当「运行态
// 自证」已经恒真＝判据空转。换成真正区分两态的那件事：这一态里已经有轮次了。
rec('⑧ 自证：议事室在运行态（已有轮次在屏上，composer 在场景底）',
  (await page.locator('.lite-room-board[data-room-turns="0"]').count()) === 0 &&
  (await page.locator('.lite-room-turn').count()) >= 1)
await input().click()
await input().pressSequentially('@', { delay: 40 })
await page.waitForTimeout(300)
let geom = await pickerGeom()
rec('⑧ 运行态@1280×900：弹层完整可见且贴输入框', !!geom && geom.inViewport && geom.topVisible && geom.adjacent,
  JSON.stringify(geom))
await input().press('Escape')
await clearInputEl(ROOM_INPUT)

// (b) 议事室运行态 @ 900×600（票面矮视口）
await page.setViewportSize({ width: 900, height: 600 })
await page.waitForTimeout(200)
await input().click()
await input().pressSequentially('@', { delay: 40 })
await page.waitForTimeout(300)
geom = await pickerGeom()
rec('⑧ 运行态@900×600：弹层完整可见且贴输入框', !!geom && geom.inViewport && geom.topVisible && geom.adjacent,
  JSON.stringify(geom))
await input().press('Escape')
await clearInputEl(ROOM_INPUT)

// (c) 悬浮胶囊 @ 900×600
await page.evaluate((seam) => window[seam].getState().goScreen('home'), SEAM)
await page.waitForTimeout(600)
await page.locator('.lite-ask-avery-pill').click()
await page.waitForTimeout(300)
await pillInput().pressSequentially('@', { delay: 40 })
await page.waitForTimeout(300)
geom = await pickerGeom()
rec('⑧ 胶囊@900×600：弹层完整可见且贴输入框', !!geom && geom.inViewport && geom.topVisible && geom.adjacent,
  JSON.stringify(geom))
await pillInput().press('Escape')
await pillInput().press('Escape')
await page.waitForTimeout(200)

// (d) 悬浮胶囊 @ 900×340（高 zoom 小窗）——上方装不下整层，列表必须钳进余量
await page.setViewportSize({ width: 900, height: 340 })
await page.waitForTimeout(200)
await page.locator('.lite-ask-avery-pill').click()
await page.waitForTimeout(300)
await pillInput().pressSequentially('@', { delay: 40 })
await page.waitForTimeout(300)
geom = await pickerGeom()
rec('⑧ 胶囊@900×340（高 zoom 小窗）：钳制后弹层仍完整可见且贴输入框（拆掉钳制这条必红）',
  !!geom && geom.inViewport && geom.topVisible && geom.adjacent, JSON.stringify(geom))
await pillInput().press('Escape')
await pillInput().press('Escape')
await page.waitForTimeout(200)

// (e) 议事室空态 @ 1280×900——重载把 turns 清空（内存态，刻意零持久化），team 经会话恢复取回。
// ⚠ #75 起「空态宿主」与「运行态宿主」的 composer **几何已经一样**（三态统一的目的就是这个），
//    所以 (a)/(b) 与 (e)/(f) 不再是两种几何、只是两种内容量下的同一种几何。矩阵留着仍有价值
//    （视口档位 + 胶囊宿主那两档是真不同），但别再把它读成「四种宿主」。
await page.setViewportSize({ width: 1280, height: 900 })
await page.goto(`${UI}/?v=2&mode=live&look=paper&lang=zh`, { waitUntil: 'networkidle' })
await dismissOnboard(page)
await page.waitForFunction((seam) => !!window[seam]?.getState().team, SEAM, { timeout: 30000 })
await page.evaluate((seam) => window[seam].getState().goScreen('room'), SEAM)
await page.waitForTimeout(600)
// #75 改判：空态不再是 story 的 `.nexus-empty` 居中卡 + `.nexus-empty-composer-wrap` 包裹
// （那两层随 docked composer 三态统一一起退役了）。空态的新身份判据 = **零轮对话**
// 且 composer 在场——判的是「现在屏上是哪一态」这件事本身，不是某个包裹壳的类名。
rec('⑧ 自证：议事室回到空态（零轮对话 + docked composer 在场）',
  (await page.locator('.lite-room-board[data-room-turns="0"]').count()) === 1 &&
  (await page.locator('.lite-room > .nexus-followup-composer').count()) === 1)
await input().click()
await input().pressSequentially('@', { delay: 40 })
await page.waitForTimeout(300)
geom = await pickerGeom()
rec('⑧ 空态@1280×900：弹层贴着输入框（包含块修复位——「飞离输入框」的错位比裁剪更重）',
  !!geom && geom.adjacent, JSON.stringify(geom))
rec('⑧ 空态@1280×900：弹层完整可见', !!geom && geom.inViewport && geom.topVisible, JSON.stringify(geom))
await input().press('Escape')
await clearInputEl(ROOM_INPUT)

// (f) 议事室空态 @ 900×600——上方 .scene 裁剪窗口装不下整层，必须翻转/钳制
await page.setViewportSize({ width: 900, height: 600 })
await page.waitForTimeout(200)
await input().click()
await input().pressSequentially('@', { delay: 40 })
await page.waitForTimeout(300)
geom = await pickerGeom()
rec('⑧ 空态@900×600（矮视口）：翻转/钳制后弹层仍完整可见且贴输入框（拆掉碰撞检测这条必红）',
  !!geom && geom.inViewport && geom.topVisible && geom.adjacent, JSON.stringify(geom))
await input().press('Escape')
await clearInputEl(ROOM_INPUT)
await page.setViewportSize({ width: 1280, height: 900 })
await page.waitForTimeout(200)

// ── ⑨ #67 · 预填入口全量引用化：7 入口逐个真点，判据落 POST /advise 请求体 ────────────────
// 每个入口：真点卡面按钮 → 落议事室（chip 自证在场）→ 真键盘提交 → 抓请求体 references[]。
// chip 在场只是自证，主判据永远在网络层（T10 门洞教训：门驱动 store 还是真部件）。
const roomChips = () => page.evaluate(() =>
  Array.from(document.querySelectorAll('.lite-room .lite-ref-chip')).map((c) => ({
    kind: c.getAttribute('data-ref-chip'),
    id: c.getAttribute('data-ref-id'),
    team: c.querySelector('.lite-ref-chip-team')?.textContent ?? '',
  })))
// #69 · 进屋那一刻 composer 的四件事：正文 / 灰提示 / 发送键 / chip。
const composerEntry = () => page.evaluate(() => {
  const inp = document.querySelector('.lite-room .nexus-followup-composer [data-composer-input]')
  const btn = document.querySelector('.lite-room .nexus-followup-composer [data-composer-send]')
  return {
    value: inp?.value ?? null,
    placeholder: inp?.getAttribute('placeholder') ?? '',
    disabled: !!btn?.disabled,
    chips: document.querySelectorAll('.lite-room .lite-ref-chip').length,
  }
})
// #69 逐入口的四合一判据。`context` = 这个入口必须出现在提示里的那个词（分诊卡的成句是
// 后端派生的，拿不到稳定词——那一路传 null，退回"提示非空且不等于默认文案"）。
const TYPED = '这件事我该怎么推进'
const recEntryPrefill = (label, st, context) => {
  const ph = st.placeholder ?? ''
  const distinct = ph.length > 0 && ph !== DEFAULT_PLACEHOLDER
  const hasContext = context === null ? distinct : ph.includes(context)
  rec(`⑨ 入口·${label} · #69：正文**空**、灰提示带入口上下文、发送键置灰、chip 在场`,
    st.value === '' && hasContext && distinct && st.disabled && st.chips >= 1,
    JSON.stringify(st))
}
// #69 · 提交后 situation 不许带提示文字。判据落在提示的**尾段**（模板是「主体 — 理由」，
// 尾段是理由）——不能用开头：开头是主体名，而 refs 的织文「涉及：主体名」本来就该在
// situation 里，拿它当判据是自己给自己下套。
const recNoHintInBody = (label, ph, post) => {
  const tail = (ph ?? '').replace(/…$/, '').slice(-12)
  const sit = post?.situation ?? ''
  rec(`⑨ 入口·${label} · #69：提交的 situation 只有 manager 打的字（不含灰提示原文）`,
    tail.length >= 8 && sit.startsWith(TYPED) && !sit.includes(tail),
    JSON.stringify({ tail, situation: sit.slice(0, 80) }))
}
// #71：进屋前一定要等上一轮落定——`goScreen` 走开会 clearTurns + abort，但门自己的
// waitForPosts 只等到"请求发出去了"，落定与否还得单独等。
const submitRoom = async () => {
  const n = advisePosts.length
  await input().click()
  // #69：入口带来的是 placeholder，输入框是空的（发送键 disabled）——manager 得自己打字。
  await input().pressSequentially(TYPED, { delay: 15 })
  await input().press('Enter')
  const got = await waitForPosts(n + 1)
  await waitRoomSettled()
  return got ? advisePosts[n] : null
}

const ids = await page.evaluate((seam) => {
  const st = window[seam].getState()
  const people = st.team?.people ?? []
  const projects = st.team?.projects ?? []
  return {
    frontId: people.find((p) => p.name === '林小满' && p.team === '前厅部')?.id ?? null,
    houseId: people.find((p) => p.name === '林小满' && p.team === '客房部')?.id ?? null,
    zhouId: people.find((p) => p.name === '周雅婷')?.id ?? null,
    villaId: projects.find((p) => p.title.includes('别墅套餐'))?.id ?? null,
    parkId: projects.find((p) => p.title.includes('亲子乐园'))?.id ?? null,
    handoffs: (st.team?.handoffs ?? []).map((h) => ({
      title: h.projectTitle, personIds: h.personIds, projectIds: h.projectIds,
    })),
  }
}, SEAM)
rec('⑨ 自证：四件套语料的主体都在，且首张分诊信号带「项目+人员」双引用源（多引用的前提）',
  !!(ids.frontId && ids.houseId && ids.zhouId && ids.villaId && ids.parkId) &&
  ids.handoffs.length > 0 && ids.handoffs[0].projectIds.length > 0 && ids.handoffs[0].personIds.length > 0,
  JSON.stringify(ids))

// 入口 1 · 团队屏人卡（重名消歧讨伐位：chip 必须带部门——helper 的 dupeTeam 恒空这条就红）
await page.evaluate((seam) => window[seam].getState().goScreen('team'), SEAM)
await page.waitForTimeout(600)
await page.locator('.home-person-card', { hasText: '林小满' }).first().locator('.lite-card-ask').click()
await page.waitForTimeout(600)
let chips = await roomChips()
let st = await composerEntry()
rec('⑨ 入口·团队屏人卡：chip 在场且**带部门**（重名消歧走 refOfPerson 那把尺）',
  chips.length === 1 && chips[0].kind === 'person' &&
  [ids.frontId, ids.houseId].includes(chips[0].id) && chips[0].team !== '',
  JSON.stringify(chips))
recEntryPrefill('团队屏人卡', st, '林小满')
let entryPost = await submitRoom()
rec('⑨ 入口·团队屏人卡：POST /advise 带 person reference（id=点的那张卡）',
  !!entryPost && Array.isArray(entryPost.references) && entryPost.references.length === 1 &&
  entryPost.references[0].kind === 'person' && entryPost.references[0].id === chips[0]?.id,
  JSON.stringify(entryPost?.references ?? null))
recNoHintInBody('团队屏人卡', st.placeholder, entryPost)

// 入口 2 · 项目屏卡面
await page.evaluate((seam) => window[seam].getState().goScreen('projects'), SEAM)
await page.waitForTimeout(600)
await page.locator('.lite-project-card', { hasText: '别墅套餐推广' }).first().locator('.lite-card-ask').click()
await page.waitForTimeout(600)
chips = await roomChips()
st = await composerEntry()
recEntryPrefill('项目屏卡面', st, '别墅套餐推广')
entryPost = await submitRoom()
recNoHintInBody('项目屏卡面', st.placeholder, entryPost)
rec('⑨ 入口·项目屏卡面：chip 在场且 POST 带 project reference（id=别墅套餐）',
  chips.length === 1 && chips[0].kind === 'project' && chips[0].id === ids.villaId &&
  !!entryPost && entryPost.references?.length === 1 && entryPost.references[0].kind === 'project' &&
  entryPost.references[0].id === ids.villaId,
  JSON.stringify({ chips, refs: entryPost?.references ?? null }))

// 入口 3 · 项目详情浮层（浮层由 store 开——被测的是浮层里那颗「去问 Avery」真按钮）。
// 🔴 先离开议事室再开浮层：真实动线是「项目屏 → 浮层 → 去问 Avery」，RoomScreen 只在
// 挂载时消费预填——已经站在 /room 上开浮层是产品里不存在的动线，测它等于测错东西。
await page.evaluate((seam) => window[seam].getState().goScreen('projects'), SEAM)
await page.waitForTimeout(400)
await page.evaluate(({ seam, id }) => window[seam].getState().openDetail('project', id),
  { seam: SEAM, id: ids.villaId })
await page.waitForTimeout(600)
await page.locator('.lite-detail-ask').click()
await page.waitForTimeout(600)
chips = await roomChips()
st = await composerEntry()
recEntryPrefill('项目详情浮层', st, '别墅套餐推广')
entryPost = await submitRoom()
recNoHintInBody('项目详情浮层', st.placeholder, entryPost)
rec('⑨ 入口·项目详情浮层：chip 在场且 POST 带 project reference',
  chips.length === 1 && chips[0].kind === 'project' && chips[0].id === ids.villaId &&
  !!entryPost && entryPost.references?.length === 1 && entryPost.references[0].id === ids.villaId,
  JSON.stringify({ chips, refs: entryPost?.references ?? null }))

// 入口 4 · 人员详情浮层（客房部林小满——消歧走浮层路一样成立）。同上：先回团队屏。
await page.evaluate((seam) => window[seam].getState().goScreen('team'), SEAM)
await page.waitForTimeout(400)
await page.evaluate(({ seam, id }) => window[seam].getState().openDetail('person', id),
  { seam: SEAM, id: ids.houseId })
await page.waitForTimeout(600)
await page.locator('.lite-detail-ask').click()
await page.waitForTimeout(600)
chips = await roomChips()
st = await composerEntry()
recEntryPrefill('人员详情浮层', st, '林小满')
entryPost = await submitRoom()
recNoHintInBody('人员详情浮层', st.placeholder, entryPost)
rec('⑨ 入口·人员详情浮层：chip 带部门且 POST 带 person reference（id=客房部那位）',
  chips.length === 1 && chips[0].kind === 'person' && chips[0].id === ids.houseId && chips[0].team === '客房部' &&
  !!entryPost && entryPost.references?.length === 1 && entryPost.references[0].id === ids.houseId,
  JSON.stringify({ chips, refs: entryPost?.references ?? null }))

// 入口 5 · 晨间分诊卡（多引用：handoff 信号里的项目+人员逐一对应，不多不少）
await page.evaluate((seam) => window[seam].getState().goScreen('home'), SEAM)
await page.waitForTimeout(600)
await page.locator('.lite-triage-room').first().click()
await page.waitForTimeout(600)
chips = await roomChips()
st = await composerEntry()
// 分诊卡的成句由后端信号派生，没有稳定词可断——退回"提示非空且不是默认文案"。
recEntryPrefill('晨间分诊卡', st, null)
entryPost = await submitRoom()
recNoHintInBody('晨间分诊卡', st.placeholder, entryPost)
{
  const h = ids.handoffs[0]
  const expected = [
    ...h.projectIds.map((id) => `project:${id}`),
    ...h.personIds.map((id) => `person:${id}`),
  ]
  const gotKeys = (entryPost?.references ?? []).map((r) => `${r.kind}:${r.id}`)
  rec('⑨ 入口·晨间分诊卡：多引用全带（与 handoff 信号逐一对应，项目+人员≥2）',
    expected.length >= 2 && gotKeys.length === expected.length &&
    expected.every((k) => gotKeys.includes(k)),
    JSON.stringify({ expected, gotKeys, chips }))
}

// 入口 6 · 差距卡「直接问本人」（亲子乐园：自报正常+真有卡点）
await page.evaluate((seam) => window[seam].getState().goScreen('home'), SEAM)
await page.waitForTimeout(600)
// #63 摘要形态默认收起——展开才有 .lite-gap-ask；若 #65（默认展开）先落，这个分支自然跳过。
if ((await page.locator('.lite-gap-ask').count()) === 0) {
  await page.locator('.lite-home-gap-expand').click()
  await page.waitForTimeout(400)
}
rec('⑨ 自证：亲子乐园的差距卡在（自报稳/真有卡点的矛盾进了差距块）',
  (await page.locator('.lite-gap-card', { hasText: '亲子乐园改造' }).count()) === 1)
await page.locator('.lite-gap-card', { hasText: '亲子乐园改造' }).locator('.lite-gap-ask').click()
await page.waitForTimeout(600)
chips = await roomChips()
st = await composerEntry()
recEntryPrefill('差距卡', st, '亲子乐园改造')
entryPost = await submitRoom()
recNoHintInBody('差距卡', st.placeholder, entryPost)
rec('⑨ 入口·差距卡「直接问本人」：chip 在场且 POST 带 project reference（id=亲子乐园）',
  chips.length === 1 && chips[0].kind === 'project' && chips[0].id === ids.parkId &&
  !!entryPost && entryPost.references?.length === 1 && entryPost.references[0].id === ids.parkId,
  JSON.stringify({ chips, refs: entryPost?.references ?? null }))

// 入口 7 · 决策卡（goScreen q+refs 中继链——encodeRefsParam → useRoomQueryRelay）
await page.evaluate((seam) => window[seam].getState().goScreen('home'), SEAM)
await page.waitForTimeout(600)
const decisionBtn = page
  .locator('.lite-home-decision', { hasText: '别墅套餐推广' })
  .first()
  .locator('.lite-home-decision-room')
rec('⑨ 自证：别墅套餐的决策卡在（受阻项目必过定级引擎）', (await decisionBtn.count()) === 1)
await decisionBtn.click()
await page.waitForTimeout(800)
chips = await roomChips()
st = await composerEntry()
// #69 · 决策卡走 URL 中继：`qh`（提示键）而不是 `q`（正文键）——中继端漏改的形态就是
// 这条判据上「正文非空」。
recEntryPrefill('决策卡', st, '别墅套餐推广')
entryPost = await submitRoom()
recNoHintInBody('决策卡', st.placeholder, entryPost)
rec('⑨ 入口·决策卡：中继落 /room、chip 在场且 POST 带 project reference（refs 走 URL 中继）',
  chips.some((c) => c.kind === 'project' && c.id === ids.villaId) && !!entryPost &&
  (entryPost.references ?? []).some((r) => r.kind === 'project' && r.id === ids.villaId),
  JSON.stringify({ chips, refs: entryPost?.references ?? null }))

rec('无 pageerror（整程零未捕获异常）', pageErrors.length === 0, JSON.stringify(pageErrors))

void rows
await finish({ rows }, { browser, label: '#64/#66/#67 at-references（@ 引用 → 几何 → 入口 → 网络请求体）', listFailures: true })
