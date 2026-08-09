// #75 + #73 · 议事室 Claude 化的新能力门（0808 UIUX 重构战役 wave 1 / S1）
//
// ## 这道门防的是什么
// 五件新能力，每件都有一种「看着做了其实没做」的假实现，各配一条主判据：
//   ① **三态统一**：假实现是「空态 composer 挪到屏底看起来一样」，但仍是两份 DOM / 两套几何，
//      第一问发出去还是会重排。判据不看类名，量的是**同一个节点在发问前后的 x/y/宽**——
//      三个数字有一个变了就是没统一。
//   ② **多行输入**：假实现是 textarea 换上了但 Shift+Enter 照样提交（或 Enter 照样换行）。
//      两条判据分开钉两个键位，缺一条都能被半吊子实现蒙过去。
//   ③ **停止生成**：最毒的假实现是「按了停止、那一轮被收成 complete」——屏上四步全绿、
//      HUD 说「分析好了」、卡是空的。判据不只看「停止键点得到」，还看**终态是不是 interrupted**、
//      **HUD 有没有在撒谎**、**相位有没有被盖成 done**。
//   ④ **markdown**：假实现是 `dangerouslySetInnerHTML` 一把梭——列表是渲染出来了，
//      顺带把 XSS 面也打开了。判据用**真敌意语料**走真 SSE 通道：既要看到列表/表格，
//      也要看到 script/img 一个节点都没生成、`javascript:` 链接没变成可点的 <a>。
//   ⑤ **附件预检**：假实现是「等 413 回来再报错」——文件已经上传了、库里已经脏了。
//      判据钉在**零网络请求**上：超限文件选中之后 POST /team/{id}/files 一发都不许出。
//
// ## 变异台账（回执里有逐条真跑记录）
//   M-A 把 `.lite-room > .nexus-followup-composer` 的 width/bottom 挪回空态那套 → ① 红
//   M-B handleKeyDown 里去掉 `!event.shiftKey` → ③（Shift+Enter）红
//   M-C streamSource onDone 的白名单改回黑名单（`!== 'error' && !== 'complete'`）→ ④ 红
//   M-D RoomScreen 的 HUD 三元去掉 interrupted 那一支 → ⑤（HUD 撒谎）红
//   M-E markdown.tsx 的 isSafeHref 恒返回 true → ⑦（javascript: 链接）红
//   M-F handleAttach 里去掉 precheckAttachments 那一闸 → ⑧（零请求）红
//
// ## 怎么跑
// 🔴 **上传型门**（真发 POST /ingest 造 context + 真 /advise + 真 POST /team/{id}/files）；
//    **绝不能排在 C 区之后**（dist 被重打成生产域名后，任何上传都是往生产库写测试数据）。
//   后端：AVERY_BRAIN=mock AVERY_EXTRACTOR=heuristic AVERY_EMBEDDINGS=keyword
//         AVERY_DEMO_SEED_DIR=tests/fixtures/demo-seed AVERY_PUBLIC_BASE=<后端口> uvicorn
//   前端：vite build --mode development + vite preview --host
//   VERIFY_BASE=http://127.0.0.1:5173 node eval-harness/tools/verify-room-claude-rework.mjs
// ⚠ 显式 `?lang=zh`：判据要读中文文案。
import { bootPage, makeRec, finish } from './lib/gate-run.mjs'

const UI = process.env.VERIFY_BASE || 'http://127.0.0.1:5173'
const SEAM = '__lite2Store'
const { rows, rec } = makeRec()

const ROSTER = [
  '# 别墅酒店 员工花名册', '',
  '姓名 | 人员ID | 部门 | 职位 | 司龄',
  '周雅婷 | MKT-001 | 市场推广部 | 市场专员 | 3年',
  '林小满 | FO-0422 | 前厅部 | 前厅主管 | 2年',
].join('\n')
const PROJECT = ['# 别墅套餐推广', '负责人：周雅婷', '状态：受阻', '截止：2026-10-15', '进度：55%',
  '阻塞：雨季无备选场地'].join('\n')

const boot = await bootPage({ url: `${UI}/?v=2&mode=live&look=paper&lang=zh`, trackPageErrors: true })
const { browser, page, pageErrors } = boot

const advisePosts = []
const appendPosts = []
page.on('request', (r) => {
  const path = new globalThis.URL(r.url()).pathname
  if (r.method() !== 'POST') return
  if (/\/advise$/.test(path)) {
    try { advisePosts.push(JSON.parse(r.postData() || 'null')) } catch { advisePosts.push(null) }
  }
  // #73 的核心判据面：现场附件走的就是这个端点。「预检没拦住」的唯一诚实证据是它多了一发。
  if (/\/team\/[^/]+\/files$/.test(path)) appendPosts.push(path)
})
const waitForPosts = async (n, ms = 25000) => {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    if (advisePosts.length >= n) return true
    await page.waitForTimeout(100)
  }
  return false
}
const waitSettled = (ms = 30000) => page.waitForFunction(
  (seam) => {
    const turns = window[seam].getState().turns ?? []
    const last = turns[turns.length - 1]
    return !!last && ['complete', 'interrupted', 'error'].includes(last.run.status)
  }, SEAM, { timeout: ms }).then(() => true).catch(() => false)

const input = () => page.locator('.lite-room .nexus-followup-composer [data-composer-input]')
const sendBtn = () => page.locator('.lite-room .nexus-followup-composer [data-composer-send]')
const stopBtn = () => page.locator('.lite-room .nexus-followup-composer [data-composer-stop]')

// 量 composer 的几何 + 结构位置。①②两组判据都从这一个采样点出。
const composerGeom = () => page.evaluate(() => {
  const room = document.querySelector('.lite-room')
  const all = document.querySelectorAll('.nexus-followup-composer')
  const c = document.querySelector('.nexus-followup-composer')
  const scroll = document.querySelector('.lite-room-scroll')
  const board = document.querySelector('.lite-room-board')
  const r = c ? c.getBoundingClientRect() : null
  return {
    count: all.length,
    directChild: !!c && c.parentElement === room,
    inScroll: !!(scroll && c && scroll.contains(c)),
    inBoard: !!(board && c && board.contains(c)),
    turns: board ? board.getAttribute('data-room-turns') : null,
    // 🔴 只取 x/y/宽，**不取高**：composer 因为多行输入/附件行长高是设计内的，
    //    把高也钉死会把「用户多打了一行」误判成回归。
    x: r ? Math.round(r.x) : null,
    y: r ? Math.round(r.y) : null,
    w: r ? Math.round(r.width) : null,
  }
})

// ── ⓪ 铺语料 ────────────────────────────────────────────────────────────────────────
await page.evaluate(async ({ files, seam }) => {
  const enc = new TextEncoder()
  await window[seam].getState().uploadFiles(
    files.map((f) => new File([enc.encode(f.text)], f.name, { type: 'text/markdown' })))
}, { files: [{ name: '花名册.md', text: ROSTER }, { name: '项目周报.md', text: PROJECT }], seam: SEAM })
await page.waitForFunction(
  (seam) => ['ready', 'error'].includes(window[seam].getState().ingestStatus), SEAM,
  { timeout: 60000 }).catch(() => {})
const base = await page.evaluate((seam) => {
  const st = window[seam].getState()
  return { ingestStatus: st.ingestStatus, contextId: st.contextId, people: (st.team?.people ?? []).length }
}, SEAM)
rec('⓪ 自证：语料上传成功（有 contextId、花名册解析出人）',
  base.ingestStatus === 'ready' && !!base.contextId && base.people >= 2, JSON.stringify(base))

await page.evaluate((seam) => window[seam].getState().goScreen('room'), SEAM)
await page.waitForTimeout(600)

// ── ① 三态统一：结构纪律（每条背后一道既有门会因它变假绿/假红）───────────────────────
const emptyGeom = await composerGeom()
rec('① 自证：议事室在空态（零轮对话）', emptyGeom.turns === '0', JSON.stringify(emptyGeom))
rec('① 全树 .nexus-followup-composer 恰好 1 个（两份 DOM 做 crossfade 会让 snippet 相位 H 与 count 判据同时失真）',
  emptyGeom.count === 1, String(emptyGeom.count))
rec('① composer 是 .lite-room 的**直接子元素**（`.lite-room > .nexus-followup-composer` 是 CSS 与门的双承重选择器）',
  emptyGeom.directChild, JSON.stringify(emptyGeom))
rec('① composer 在滚动区外（room-usability 的「恒可点」判据锚这条）',
  !emptyGeom.inScroll, JSON.stringify(emptyGeom))
// ⚠ 侦察当初预言「composer 塞进 board 会让 room-usability 变**假绿**」。M-H 变异真跑推翻了
//    这条：那道门取 `board.children[last]` 当最后一张卡，composer 自己跟自己比时
//    `bottom > top` 恒成立、`clear` 恒 false，结果是**恒红**不是恒绿。危害仍在（红得像
//    「让位不够」、其实是「结构错了」，是最容易误诊的一类），但方向与预判相反。
rec('① composer 在 .lite-room-board **之外**（塞进 board 会让 usability 变成 composer 自己跟自己比，恒红且误导）',
  !emptyGeom.inBoard, JSON.stringify(emptyGeom))
rec('① 空态壳 .nexus-empty-composer-wrap 已彻底退役（残留一份＝三态没真统一，只是又叠了一层）',
  (await page.locator('.nexus-empty-composer-wrap').count()) === 0)
rec('① 正文控件是 textarea（不是 input）',
  (await page.evaluate(() => document.querySelector('[data-composer-input]')?.tagName ?? null)) === 'TEXTAREA')
rec('① form 内 `button[type="submit"]` 恰好 1 个（新增的停止/附件键必须 type="button"，否则既有门的 count()===1 自证会抛错而不是判负）',
  (await page.locator('.lite-room .nexus-followup-composer button[type="submit"]').count()) === 1)

// ── ② 发问零跳变（本票的头号主张，判据是三个数字）─────────────────────────────────────
await input().click()
await input().pressSequentially('别墅套餐推广现在最需要我做什么', { delay: 20 })
await input().press('Enter')
await waitForPosts(1)
await page.waitForTimeout(400)
const runGeom = await composerGeom()
rec('② 自证：第一问真发出去了（turns 从 0 变 1）', runGeom.turns === '1', JSON.stringify(runGeom))
rec('② 🔴 composer 的 x/y/宽 在发第一问前后**完全不变**（这就是「空态不悬屏中央、发问零跳变」的全部含义）',
  emptyGeom.x === runGeom.x && emptyGeom.y === runGeom.y && emptyGeom.w === runGeom.w,
  `empty=${JSON.stringify(emptyGeom)} run=${JSON.stringify(runGeom)}`)
rec('② 开场块随第一问退场（它是 board 里的一块内容，不是另一套壳）',
  (await page.locator('[data-room-welcome]').count()) === 0)

// ── ③ 停止生成 ────────────────────────────────────────────────────────────────────────
// 生成窗口靠**路由延迟**造出来，不靠赌后端慢：mock 后端 1 秒内就答完，赌时序的门必然间歇假红。
await page.route('**/advise', async (route) => {
  await new Promise((r) => setTimeout(r, 4000))
  // 延迟结束时这一发多半已经被 abort 掉了（那正是本段要测的动作），此时 route 已被处置，
  // continue() 会抛 `Route is already handled!` ——它是**预期内的**，不是失败信号。
  try { await route.continue() } catch { /* 已被中止：本段的成功路径 */ }
})
await waitSettled()
await input().click()
await input().pressSequentially('那这周先动哪一头', { delay: 20 })
await input().press('Enter')
await page.waitForTimeout(700)

const midRun = await page.evaluate(() => ({
  stopPresent: !!document.querySelector('[data-composer-stop]'),
  sendDisabled: document.querySelector('[data-composer-send]')?.hasAttribute('disabled') ?? null,
  editable: !document.querySelector('[data-composer-input]')?.disabled,
}))
rec('③ 生成中：停止键在场', midRun.stopPresent, JSON.stringify(midRun))
rec('③ 生成中：发送键仍 disabled（本门此前三道门都没覆盖到的场景——判据落在按钮自己的属性上）',
  midRun.sendDisabled === true, JSON.stringify(midRun))
rec('③ 生成中：正文框**仍可编辑**（修 #4-7「被锁死」：等回答的一两分钟里得能先把下一问打好）',
  midRun.editable === true, JSON.stringify(midRun))

await stopBtn().click()
await page.waitForTimeout(600)
const stopped = await page.evaluate((seam) => {
  const st = window[seam].getState()
  const t = st.turns[st.turns.length - 1]
  const turnEl = [...document.querySelectorAll('.lite-room-turn')].pop()
  return {
    storeStatus: t?.run?.status ?? null,
    domStatus: turnEl?.getAttribute('data-run-status') ?? null,
    stoppedNote: !!document.querySelector('[data-flow-stopped]'),
    failedNote: !!document.querySelector('[data-flow-failed]'),
    hud: document.querySelector('.nexus-brief-step')?.textContent ?? null,
    // 🔴 相位必须**只采被中止的那一轮**。全页扫 `[data-phase-status]` 会把上一轮（真答完的，
    //    四相全 done）也捞进来，判据就变成「页面上存在一个非 done 的相位」——那是把尺子放到
    //    对着真违规也全绿的宽度上。
    phases: turnEl ? [...turnEl.querySelectorAll('[data-phase-status]')].map((e) => e.getAttribute('data-phase-status')) : [],
    stopGone: !document.querySelector('[data-composer-stop]'),
    followups: document.querySelectorAll('[data-followup-chip]').length,
  }
}, SEAM)
rec('③ 🔴 中止落成 `interrupted` 终态，**不是**假 complete（把 onDone 的白名单改回黑名单这条必红）',
  stopped.storeStatus === 'interrupted', JSON.stringify(stopped))
rec('③ DOM 上也能采到这一轮的中断态（门不必读 store 才看得见）',
  stopped.domStatus === 'interrupted', String(stopped.domStatus))
rec('③ 分析过程面板出「你按了停止」说明块（半亮的四相不能没有解释）', stopped.stoppedNote)
rec('③ 中断**不复用**断流的报错块（断流是「它断了」、中断是「你按的」，不是同一件事）',
  !stopped.failedNote, String(stopped.failedNote))
// 🔴 #79 同步：这根针铉的是 `nexus.liveReady` 的**值**（不是一个固定的词）。
//    #79 把它从「分析好了，可以看了」改成「分析完成」——不同步的话，这条判据会变成
//    「找一个全库已经不存在的字符串」——**恒真**，即正向词表版的「改了门不红、门会瞎」。
//    变异实证：把 onDone 的白名单改回黑名单（原病根）→ 这条必红。
rec('③ 🔴 HUD 不再说「分析完成」（改造前这里是全库最毒的一处静默走错分支）',
  !!stopped.hud && !stopped.hud.includes('分析完成'), JSON.stringify(stopped.hud))
// ⚠ 判据能力边界，写明白免得下一个人高估它：本段用路由延迟造生成窗口，所以中止发生时
//    这一轮**一个 SSE 事件都还没收到**，四相 steps 全是 0、按 refreshPhases 的规则本来就都是
//    pending。也就是说这条判据在当前编排下**分辨不出**「有没有被盖成 done」那个病根——它只是
//    一条正确但够不着病根的不变量。真正钉住 sealPhases 那半的是 M-C 变异（把 onDone 的白名单
//    改回黑名单）与上面那条 storeStatus 判据。要让它有牙得先让流吐出几帧再中止，
//    而那样就得赌 mock 的墙上时钟——本仓有过 Docker 时钟跳 115 秒的先例，不赌。
rec('③ 自证：被中止那一轮的相位里没有 done（它一步都没跑完，不该有任何完成章）',
  stopped.phases.length === 4 && !stopped.phases.includes('done'),
  JSON.stringify(stopped.phases))
rec('③ 中断后停止键收起（没有流在跑就不该留一个停不了的停止键）', stopped.stopGone)
rec('③ 中断的一轮**不出**建议追问 chips（没有结论就没有「继续追问」）',
  stopped.followups === 0, String(stopped.followups))
await page.unroute('**/advise')

// ── ④ 多行输入：两个键位各钉一条 ──────────────────────────────────────────────────────
await page.evaluate((seam) => window[seam].getState().goScreen('home'), SEAM)
await page.waitForTimeout(300)
await page.evaluate((seam) => window[seam].getState().goScreen('room'), SEAM)
await page.waitForTimeout(600)
const beforeShift = advisePosts.length
await input().click()
await input().pressSequentially('第一行', { delay: 20 })
await input().press('Shift+Enter')
await input().pressSequentially('第二行', { delay: 20 })
await page.waitForTimeout(300)
const shiftState = await page.evaluate(() => ({
  value: document.querySelector('[data-composer-input]')?.value ?? null,
  turns: document.querySelectorAll('.lite-room-turn').length,
}))
rec('④ Shift+Enter **换行不发送**（去掉 `!event.shiftKey` 这条必红）',
  shiftState.value === '第一行\n第二行' && advisePosts.length === beforeShift,
  JSON.stringify({ ...shiftState, posts: advisePosts.length - beforeShift }))
rec('④ 换行也没顺手把它当成一轮对话', shiftState.turns === 0, String(shiftState.turns))
await input().press('Enter')
const sentAfterShift = await waitForPosts(beforeShift + 1)
rec('④ 裸 Enter 仍然发送（at-references 的共享探针 submitRoom() 全靠这条键位不变）',
  sentAfterShift && (advisePosts[beforeShift]?.situation ?? '').includes('第一行\n第二行'),
  JSON.stringify(advisePosts[beforeShift]?.situation ?? null))
await waitSettled()

// ── ⑤⑥⑦ markdown 渲染 + XSS（真敌意语料走真 SSE 通道）──────────────────────────────
// 🔴 为什么要伪造响应而不是让 mock 后端吐：判据要的是**这个渲染器面对敌意输入的行为**，
//    而 mock 罐头永远是良性的。伪造的是网络那一层，被测的仍然是真组件、真 React 树。
const HOSTILE = [
  '这是**加粗**和 `代码`。',
  '',
  '- 第一点',
  '- 第二点',
  '',
  '| 姓名 | 部门 |',
  '| --- | --- |',
  '| 王力 | 交付 |',
  '',
  '点[这里](javascript:window.__XSS_FIRED=1)看看。',
  '',
  '<img src=x onerror="window.__XSS_FIRED=2">',
  '<script>window.__XSS_FIRED=3<\/script>',
].join('\n')
await page.route('**/advise', async (route) => {
  const body = [
    'event: started',
    'data: {"type":"started"}',
    '',
    'event: manifest',
    `data: ${JSON.stringify({
      type: 'manifest', answer_kind: 'answer', answer: { text: HOSTILE },
      contract_ok: true, redline_passed: true,
    })}`,
    '', '',
  ].join('\r\n')
  await route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body })
})
await input().click()
await input().pressSequentially('花名册里都有谁', { delay: 20 })
await input().press('Enter')
await page.waitForTimeout(1200)
const md = await page.evaluate(() => {
  const host = document.querySelector('[data-answer-md]')
  const q = (sel) => host ? host.querySelectorAll(sel).length : -1
  return {
    present: !!host,
    strong: q('strong'), code: q('code'), li: q('li'), th: q('th'), td: q('td'),
    scripts: q('script'), imgs: q('img'),
    anchors: host ? [...host.querySelectorAll('a')].map((a) => a.getAttribute('href')) : [],
    xssFired: window.__XSS_FIRED ?? null,
    text: host ? host.textContent : '',
  }
})
rec('⑤ 自证：短答走了 markdown 渲染位', md.present, JSON.stringify({ present: md.present }))
rec('⑤ markdown 真渲染了结构（粗体/行内码/列表/表格都成了元素，不是一坨纯文本）',
  md.strong >= 1 && md.code >= 1 && md.li === 2 && md.th === 2 && md.td === 2, JSON.stringify(md))
rec('⑥ 🔴 敌意 HTML 一个节点都没生成（<script>/<img> 计数为 0——`dangerouslySetInnerHTML` 一把梭这条必红）',
  md.scripts === 0 && md.imgs === 0, JSON.stringify({ scripts: md.scripts, imgs: md.imgs }))
rec('⑥ 🔴 payload 没有执行（window.__XSS_FIRED 从未被写）',
  md.xssFired === null, JSON.stringify(md.xssFired))
rec('⑦ 🔴 `javascript:` 链接**没有**变成可点的 <a>（isSafeHref 恒真这条必红）',
  md.anchors.every((h) => h === null || /^(https?:|mailto:)/i.test(h)), JSON.stringify(md.anchors))
rec('⑦ 认不出的链接退成纯文字，原文照抄（不是静默吞掉——吞掉等于替 Avery 改口）',
  md.text.includes('javascript:window.__XSS_FIRED=1'), JSON.stringify(md.text.slice(0, 120)))
rec('⑥ 裸 HTML 原文留在文本节点里（经理看到的是那几个字，不是一个被解析出来的节点）',
  md.text.includes('<script>'), JSON.stringify(md.text.slice(-120)))
await page.unroute('**/advise')
await waitSettled()

// ── ⑧ #73 · 附件上限预检（判据钉在「零请求」上）────────────────────────────────────────
await page.evaluate((seam) => window[seam].getState().goScreen('home'), SEAM)
await page.waitForTimeout(300)
await page.evaluate((seam) => window[seam].getState().goScreen('room'), SEAM)
await page.waitForTimeout(600)
rec('⑧ 自证：composer 上有附件键与隐藏 file input',
  (await page.locator('[data-composer-attach]').count()) === 1 &&
  (await page.locator('[data-composer-file]').count()) === 1)
rec('⑧ 🔴 隐藏 file input 是 form 的**最后**一个元素（snippet F2 的裸 `input` 子句按文档序取节点——排在正文控件前面会被选中，随后往 type=file 写 value 抛 InvalidStateError，那段没有 try/catch）',
  await page.evaluate(() => {
    const f = document.querySelector('[data-composer-file]')
    const form = f?.closest('form')
    return !!form && form.lastElementChild === f
  }))

const appendBefore = appendPosts.length
await page.locator('[data-composer-file]').setInputFiles({
  name: '超大文件.txt', mimeType: 'text/plain', buffer: Buffer.alloc(11 * 1024 * 1024, 97),
})
await page.waitForTimeout(800)
const oversized = await page.evaluate(() => ({
  error: document.querySelector('[data-attachment-error]')?.textContent ?? null,
  pills: document.querySelectorAll('[data-attachment-pill]').length,
}))
rec('⑧ 🔴 超限文件：**一发请求都没出去**（去掉预检这一闸这条必红——等 413 意味着文件已经传上去了）',
  appendPosts.length === appendBefore, `before=${appendBefore} now=${appendPosts.length}`)
rec('⑧ 超限文件：就地出诚实报错，且带上限数字', !!oversized.error && oversized.error.includes('MB'),
  JSON.stringify(oversized))
rec('⑧ 超限文件：不生成任何附件预览（整批拒收，不做「传一半」）',
  oversized.pills === 0, String(oversized.pills))

// 正常文件走完整条链：上传 → 权威名 → 随提问进 references。
// 🔴 等待态的窗口靠**路由延迟**造出来，不靠赌后端慢：真实 ingest 是 100-120 秒，但门里这份
//    小 .md 走 heuristic 抽取几百毫秒就回来了——按墙上时钟采样必然间歇假红（本仓有 Docker
//    时钟跳 115 秒的先例，任何赌时序的判据早晚会咬人）。
await page.route('**/team/*/files', async (route) => {
  await new Promise((r) => setTimeout(r, 3000))
  try { await route.continue() } catch { /* 页面已经走开：不是本段要测的事 */ }
})
await page.locator('[data-composer-file]').setInputFiles({
  name: '现场补充.md', mimeType: 'text/markdown',
  buffer: Buffer.from('# 现场补充\n雨季备选场地已找到：室内宴会厅\n', 'utf8'),
})
await page.waitForTimeout(600)
const uploading = await page.evaluate(() => {
  const pill = document.querySelector('[data-attachment-pill]')
  return {
    pills: document.querySelectorAll('[data-attachment-pill]').length,
    state: pill?.getAttribute('data-attachment-pill') ?? null,
    note: pill?.querySelector('.lite-attachment-note')?.textContent ?? null,
    // 判的是**这枚胶囊自己**有没有蹭那两套类名，不是「全页没有那些节点」——
    // 此刻正是空态，屏上本来就有 4 个 .lite-room-chip（那是建议问题），
    // 写成全页计数就是拿一条恒假的判据当护栏。
    pillUsesRoomChip: !!pill?.classList.contains('lite-room-chip'),
    pillUsesFollowup: !!pill?.hasAttribute('data-followup-chip'),
    roomChips: document.querySelectorAll('.lite-room-chip').length,
  }
})
rec('⑧ 正常文件：先出「读取中」的等待态（转换期不能是一片空白）',
  uploading.pills === 1 && uploading.state === 'uploading', JSON.stringify(uploading))
rec('⑧ 等待态说的是「要等一会儿」而不是「马上好」（后端实测 100-120 秒，别撒谎）',
  !!uploading.note && uploading.note.includes('一两分钟'), JSON.stringify(uploading.note))
rec('⑧ 附件胶囊**自己**不蹭 .lite-room-chip / data-followup-chip（蹭上就同时撑破 nomaterial 数 4 与 conversation 数 2 两套计数判据）',
  !uploading.pillUsesRoomChip && !uploading.pillUsesFollowup && uploading.roomChips === 4,
  JSON.stringify(uploading))

const becameReady = await page.waitForFunction(
  () => document.querySelector('[data-attachment-pill]')?.getAttribute('data-attachment-pill') === 'ready',
  null, { timeout: 180000 }).then(() => true).catch(() => false)
await page.unroute('**/team/*/files')
rec('⑧ 正常文件：真上传成功并转成「可引用」态', becameReady)
rec('⑧ 正常文件：确实发了 POST /team/{id}/files（与超限那次的零请求形成对照，证明上一条判据不是空跑）',
  appendPosts.length === appendBefore + 1, `before=${appendBefore} now=${appendPosts.length}`)

if (becameReady) {
  const beforeAsk = advisePosts.length
  await input().click()
  await input().pressSequentially('刚传的这份材料说了什么', { delay: 20 })
  await input().press('Enter')
  const asked = await waitForPosts(beforeAsk + 1)
  const post = advisePosts[beforeAsk]
  const fileRefs = (post?.references ?? []).filter((r) => r.kind === 'file')
  rec('⑧ 🔴 附件随这一问进了 references（file ref，id = 回执里的服务端权威名）',
    asked && fileRefs.length === 1 && fileRefs[0].id.includes('现场补充'),
    JSON.stringify(post?.references ?? null))
  rec('⑧ 发完之后附件从 composer 上撤下来（它是「这一问」的附件，不是常驻挂件）',
    (await page.locator('[data-attachment-pill]').count()) === 0)
  await waitSettled()
}

rec('无 pageerror（整程零未捕获异常）', pageErrors.length === 0, JSON.stringify(pageErrors))

void rows
await finish({ rows }, { browser,
  label: '#75+#73 room-claude-rework（三态统一 → 停止 → 多行 → markdown/XSS → 附件预检）',
  listFailures: true })
