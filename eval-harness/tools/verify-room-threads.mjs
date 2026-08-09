// #78 · 议事室真线程端到端门：续问落同一场 → 历史按场分组 → 点一场把整场恢复进议事室 →
// 在那场里接着问仍落同一场。
//
// ## 这道门防的是什么
// 🔴 先说清楚为什么这道门必须自己长出全部判据：`.lite-room-history*` 与 `adviseRuns` 在
//    43+ 道既有门里 grep **零命中**，`scripts/gates/live-frontend-gate.snippet.js` 也没有；
//    像素侧 `visual.spec.mjs` 的 room 四张拍的是 contextId===null 的无材料态、
//    `visual-data.spec.mjs` 压根不含 room。也就是说改这块**不会有任何门红**——那不是安全，
//    是没有网。
//
// 每条主判据各盯一种具体的假实现：
//   ② 「落库了但不回传」——前端永远不知道自己在写哪一场，续问只能开新场，而界面还显示着
//      「在这场里」。判据落在 **store 的 threadId 值**上，不是「请求 200 / 没崩」：
//      `LiveAgentEvent` 有索引签名、`applyEvent` 是白名单取键，后端多发的 thread_id
//      **TS 不报、运行时不崩、控制台一声不吭**。断链在这条链上没有任何一层会红。
//   ③ 「thread_id 只写进 store 没进请求体」——判据落在**网络请求体**上（同 room-conversation
//      对 history 的纪律：不落 store，T10 门洞教训）。
//   ⑥ 「点一场只跳转不恢复」/「只恢复了问题没恢复回答」——判据落在 DOM 上：两问原文按对话
//      顺序在屏，且回灌轮真的带着回答卡。
//   ⑦ 「回灌轮照常渲染四相」——emptyRunState 的四相全 pending 会被 phaseMeta 渲染成
//      4×「待命」，对一条早就答完的记录是纯假话。
//   ⑨ 生成中禁点：**两把锁配两条判据**。锁① UI 的 disabled 属性、锁② store 的 busy 闸。
//      只判「点了没反应」的话，把 disabled 拆掉照样绿（belt-and-braces 让内层规则免疫变异）。
//   ⑩ 幂等：同一场重复点不得重灌——用户可能已经在这场里续问过新轮，而手上的 adviseThreads
//      快照里还没有它们，重灌等于把刚问的抹掉。
//
// ## 变异台账（逐条**独立**跑，结果记回执）
//   M-A 去掉 store.askLive 请求体里的 `...(threadId ? { thread_id: threadId } : {})` → ③⑧ 红
//   M-B 去掉历史条目的 disabled                                                     → ⑨a 红
//   M-C 去掉 store.hydrateThread 的 busy 闸                                          → ⑨b 红
//   M-D 去掉 LiteTurnView 的 hydrated 判别（照常渲染四相）                           → ⑦ 红
//   M-E 后端 _with_thread_id 不注入                                                  → ② 红
//   M-F 去掉 hydrateThread 的幂等闸                                                  → ⑩ 红
//   M-G 后端分组按 seq DESC 回（照抄平铺那条的 ORDER BY）                            → ⑥ 顺序判据红
//
// ## 怎么跑
// 🔴 **上传型门**（真发 POST /ingest 造 context + 四发真 /advise）；**绝不能排在 C 区之后**
//    （dist 被 C 区重打成生产域名后，任何上传都是往生产库写测试数据）。
//   后端：AVERY_BRAIN=mock AVERY_EXTRACTOR=heuristic AVERY_EMBEDDINGS=keyword
//         AVERY_DEMO_SEED_DIR=tests/fixtures/demo-seed AVERY_PUBLIC_BASE=<后端口> uvicorn
//   前端：vite build --mode development + vite preview --host
//   VERIFY_BASE=http://127.0.0.1:5173 node eval-harness/tools/verify-room-threads.mjs
// ⚠ 显式 `?lang=zh`：判据要读中文问题原文。
// ⚠ 改过后端必须**按端口杀掉重起 uvicorn** 再跑：它不热重载，`/advise-threads` 是新路由，
//    跑在旧进程上会以「历史面板空的」这种误诊断形态假红（#75/#76 各栽过一次）。
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

const Q1 = '别墅套餐推广现在最需要我做什么'
const Q2 = '那这周先动哪一头'
const Q3 = '前厅部这边我该盯什么'
const Q4 = '那第一步具体怎么开口'

const boot = await bootPage({ url: `${UI}/?v=2&mode=live&look=paper&lang=zh`, trackPageErrors: true })
const { browser, page, pageErrors } = boot

const advisePosts = []
page.on('request', (r) => {
  if (r.method() === 'POST' && /\/advise$/.test(new globalThis.URL(r.url()).pathname)) {
    try { advisePosts.push(JSON.parse(r.postData() || 'null')) } catch { advisePosts.push(null) }
  }
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
    return !!last && ['complete', 'error', 'interrupted'].includes(last.run.status)
  }, SEAM, { timeout: ms }).then(() => true).catch(() => false)

const st = (fn) => page.evaluate(fn, SEAM)
const threadIdOf = () => st((seam) => window[seam].getState().threadId)
const turnsOf = () => st((seam) => (window[seam].getState().turns ?? []).map((t) => ({
  q: t.question, hydrated: t.hydrated === true, status: t.run.status })))
const threadsOf = () => st((seam) => {
  const list = window[seam].getState().adviseThreads
  return list === null ? null : list.map((t) => ({ id: t.thread_id, n: t.runs.length,
    first: t.runs[0]?.question ?? '' }))
})

const input = () => page.locator('.lite-room .nexus-followup-composer [data-composer-input]')
const historyToggle = () => page.locator('[data-history-toggle]')
const threadRows = () => page.locator('[data-history-thread]')

const ask = async (text) => {
  await input().click()
  await input().pressSequentially(text, { delay: 12 })
  await input().press('Enter')
}

// ── ⓪ 铺语料 ────────────────────────────────────────────────────────────────────────────────
await page.evaluate(async ({ files, seam }) => {
  const enc = new TextEncoder()
  await window[seam].getState().uploadFiles(
    files.map((f) => new File([enc.encode(f.text)], f.name, { type: 'text/markdown' })))
}, { files: [{ name: '花名册.md', text: ROSTER }, { name: '项目周报.md', text: PROJECT }], seam: SEAM })
await page.waitForFunction(
  (seam) => ['ready', 'error'].includes(window[seam].getState().ingestStatus), SEAM,
  { timeout: 45000 }).catch(() => {})
const base = await st((seam) => {
  const s = window[seam].getState()
  return { ingestStatus: s.ingestStatus, contextId: s.contextId, people: (s.team?.people ?? []).length }
})
rec('⓪ 自证：语料上传成功（有 contextId、花名册解析出人）',
  base.ingestStatus === 'ready' && !!base.contextId && base.people >= 2, JSON.stringify(base))

await st((seam) => window[seam].getState().goScreen('room'))
await page.waitForTimeout(600)
rec('⓪ 自证：进屋时还没有场（threadId 为 null——不是上一次残留的）',
  (await threadIdOf()) === null)

// ── ① 第一问：additive 契约 ─────────────────────────────────────────────────────────────────
await ask(Q1)
const got1 = await waitForPosts(1)
const post1 = advisePosts[0]
rec('① 自证：第一问真的发出去了（POST /advise）', got1 && typeof post1?.situation === 'string')
rec('① 第一问请求体**没有** thread_id 键（additive：absent≠none，不许发 null）',
  !!post1 && !('thread_id' in post1), JSON.stringify(Object.keys(post1 ?? {})))
rec('① 自证：第一轮跑到终局', await waitSettled())

// ── ② 回传：判据落在 store 的槽位值上 ───────────────────────────────────────────────────────
const tidA = await threadIdOf()
rec('② 服务端回传的 thread_id 落进了 store（后端不注入这条必红；'
  + '断链在这条链上不会有任何别的层红——TS 不报、运行时不崩、控制台不吭）',
  typeof tidA === 'string' && /^thr_[0-9a-f]{8,}$/.test(tidA), JSON.stringify(tidA))

// ── ③ 续问：请求体带同一个 thread_id ────────────────────────────────────────────────────────
await ask(Q2)
await waitForPosts(2)
const post2 = advisePosts[1]
rec('③ 续问请求体带 thread_id，且**逐字**等于第一问回传的那个（拆掉 store 的条件展开必红）',
  post2?.thread_id === tidA, JSON.stringify({ sent: post2?.thread_id ?? null, want: tidA }))
rec('③ 自证：续问同时仍带 history（thread_id 管归档、history 管推理，两者不互相代班）',
  Array.isArray(post2?.history) && post2.history.length >= 1,
  JSON.stringify((post2?.history ?? []).length))
rec('③ 自证：第二轮跑到终局', await waitSettled())
rec('③ 一整场里 store 的 threadId 不抖动（同一场恒同一个值）', (await threadIdOf()) === tidA)

// ── ④ 分组：两问是一场，不是两条 ────────────────────────────────────────────────────────────
await page.waitForFunction((seam) => (window[seam].getState().adviseThreads ?? []).length >= 1,
  SEAM, { timeout: 20000 }).catch(() => {})
const grouped = await threadsOf()
rec('④ 历史按场分组：两问归成**一场两轮**（平铺实现会是两场各一轮）',
  Array.isArray(grouped) && grouped.length === 1 && grouped[0].n === 2 && grouped[0].id === tidA,
  JSON.stringify(grouped))

// ── ⑤ 离开议事室 = 这场结束（保住 room-conversation ⑥，且不自动恢复）──────────────────────
await st((seam) => window[seam].getState().goScreen('home'))
await page.waitForTimeout(400)
await st((seam) => window[seam].getState().goScreen('room'))
await page.waitForTimeout(800)
const afterReturn = await turnsOf()
rec('⑤ 离开再回来：turns 清空（#71 拍板不变——进屋**不自动** hydrate 任何一场）',
  afterReturn.length === 0, JSON.stringify(afterReturn))
rec('⑤ 离开再回来：threadId 也一起清（留孤儿 = 屏上空白但下一问落进上一场）',
  (await threadIdOf()) === null)
const domTurns = await page.locator('.lite-room-board[data-room-turns="0"]').count()
rec('⑤ 自证：DOM 也回到空态（data-room-turns="0"）', domTurns === 1)

// ── ⑥ 新的一场 + 点开旧的一场把整场恢复 ─────────────────────────────────────────────────────
await ask(Q3)
await waitForPosts(3)
const post3 = advisePosts[2]
rec('⑥ 自证：新的一问不带 thread_id（离开即散场，这是**新的一场**）',
  !!post3 && !('thread_id' in post3), JSON.stringify(Object.keys(post3 ?? {})))
rec('⑥ 自证：第三轮跑到终局', await waitSettled())
const tidB = await threadIdOf()
rec('⑥ 自证：新场拿到的是**另一个** thread_id', typeof tidB === 'string' && tidB !== tidA,
  JSON.stringify({ tidA, tidB }))

await page.waitForFunction((seam) => (window[seam].getState().adviseThreads ?? []).length >= 2,
  SEAM, { timeout: 20000 }).catch(() => {})
await historyToggle().click()
await page.waitForTimeout(300)
const rowCount = await threadRows().count()
const rowIds = await threadRows().evaluateAll((els) => els.map((e) => e.getAttribute('data-history-thread')))
rec('⑥ 面板列出两**场**（不是三条）', rowCount === 2, JSON.stringify(rowIds))
rec('⑥ 场按最近活动新→旧（刚问的那场在最前）', rowIds[0] === tidB && rowIds[1] === tidA,
  JSON.stringify({ rowIds, tidA, tidB }))
// 🔴 先判在不在，再取属性：tidA 为 null/对不上时 `.getAttribute()` 会让 Playwright **抛错**，
//    整份门 crash、连汇总行都不打印（#75 实收的「会崩不会红」家族）。崩掉的门最难诊断。
const oldRow = page.locator(`[data-history-thread="${tidA}"]`)
const oldRowCount = await oldRow.count()
rec('⑥ 自证：面板里找得到旧那一场的行', oldRowCount === 1, JSON.stringify({ tidA, oldRowCount }))
rec('⑥ 自证：旧那场的行标着两轮',
  oldRowCount === 1 && (await oldRow.getAttribute('data-history-turns')) === '2')

// 🔴 下游整段（⑥ 的 hydrate、⑦、⑧、⑩、⑨）都以「点得到那一行」为前提。上游没找到时
//    直接 `.click()` 会超时抛错 → **整份门 crash、连汇总行都不打印**。后端不回传 thread_id
//    的那次变异实测就走到了这一幕：一份崩掉的门比一份变红的门难诊断得多。
if (oldRowCount !== 1) {
  rec('⑥–⑩ 整段**没有执行**：上游没找到要打开的那一场（别读成通过——'
    + '这通常意味着 thread_id 回传断了，历史退化成一条条单轮）', false,
    JSON.stringify({ tidA, rowIds }))
} else {
await oldRow.click()
await page.waitForTimeout(700)
const hydratedTurns = await turnsOf()
rec('⑥ 点一场 → **整场**回到议事室，且按对话顺序（后端分组若按 seq DESC 回，这条红）',
  hydratedTurns.length === 2 && hydratedTurns[0].q === Q1 && hydratedTurns[1].q === Q2,
  JSON.stringify(hydratedTurns))
rec('⑥ 回灌是**替换**不是追加（政策拍板 a：屏上不许两场缝在一起）',
  hydratedTurns.every((t) => t.hydrated === true))
rec('⑥ 屏上真的有那两句原文（DOM 判据，不是 store）',
  (await page.locator('.lite-room-board').innerText()).includes(Q1)
  && (await page.locator('.lite-room-board').innerText()).includes(Q2))
rec('⑥ 回灌轮带着**回答**，不只是问题（只恢复问题的假实现在这条红）',
  (await page.locator('[data-turn-hydrated] .lite-room-card, [data-turn-hydrated] [data-answer-md]')
    .count()) >= 1)
rec('⑥ store 的 threadId 跟着切到被打开那一场', (await threadIdOf()) === tidA)
rec('⑥ 尾轮镜像同步了（十道门读顶层 run.status；不同步就是镜像与屏上不符）',
  (await st((seam) => window[seam].getState().run.status)) === 'complete')

// ── ⑦ 回灌轮的诚实降级 ─────────────────────────────────────────────────────────────────────
rec('⑦ 自证：两轮都挂了 data-turn-hydrated', (await page.locator('[data-turn-hydrated]').count()) === 2)
rec('⑦ 回灌轮**不渲染**四相面板（四相全 pending 会渲染成 4×「待命」——对答完的记录是假话）',
  (await page.locator('[data-turn-hydrated] .lite-flow-phase').count()) === 0)
rec('⑦ 回灌轮不挂实时状态条（它说的是「此刻」，而此刻什么都没在跑）',
  (await page.locator('[data-turn-hydrated] .nexus-brief-hud').count()) === 0)
rec('⑦ 「从历史载入」可辨（缺失要说出来，不能看起来像空）',
  (await page.locator('[data-turn-hydrated] [data-hydrated-note]').count()) === 2)
rec('⑦ 回灌轮没有引用 chips 行（refs 结构性没落库——是缺失不是「没引用」）',
  (await page.locator('[data-turn-hydrated] .lite-room-turn-ref').count()) === 0)

// ── ⑧ 在被恢复的那场里接着问 → 仍落同一场 ───────────────────────────────────────────────────
await ask(Q4)
await waitForPosts(4)
const post4 = advisePosts[3]
rec('⑧ hydrate 之后的续问带的是**被打开那一场**的 thread_id（丢掉它 = 悄悄开了新场）',
  post4?.thread_id === tidA, JSON.stringify({ sent: post4?.thread_id ?? null, want: tidA }))
rec('⑧ 自证：这一问也带上了上下文（history 从回灌轮组装得出来）',
  Array.isArray(post4?.history) && post4.history.length >= 2,
  JSON.stringify((post4?.history ?? []).length))
rec('⑧ 自证：第四轮跑到终局', await waitSettled())
await page.waitForTimeout(500)
const afterFollowup = await threadsOf()
const reopened = (afterFollowup ?? []).find((t) => t.id === tidA)
rec('⑧ 落库确实进了同一场（那场从两轮变三轮，而不是多出一场）',
  (afterFollowup ?? []).length === 2 && reopened?.n === 3, JSON.stringify(afterFollowup))

// ── ⑩ 幂等：同一场重复点 ────────────────────────────────────────────────────────────────────
await historyToggle().click()
await page.waitForTimeout(300)
await page.locator(`[data-history-thread="${tidA}"]`).click()
await page.waitForTimeout(600)
const afterReclick = await turnsOf()
// 🔴 判据必须落在**被保护的那条性质**上：轮数与问题原文分辨不出「没重灌」和「用刷新过的
//    三轮快照重灌了一遍」——两种情况下都是 3 轮、最后一句都是 Q4（去掉幂等闸实测 39/0
//    活下来，就是被这个太宽的尺子放过的）。真正的区别是**刚问那轮还是不是活轮**：
//    重灌会把它替换成一份 hydrated 拷贝，而那正是「把刚问的抹掉」的可观测形态。
rec('⑩ 同一场重复点是幂等的：刚问那一轮仍是**活轮**（重灌会把它换成 hydrated 拷贝 ＝'
  + '把刚问的抹掉；只判轮数/原文的尺子对这条太宽，会放过去掉幂等闸的实现）',
  afterReclick.length === 3 && afterReclick[2].q === Q4 && afterReclick[2].hydrated === false,
  JSON.stringify(afterReclick))

// ── ⑨ 生成中禁点：两把锁、两条判据 ──────────────────────────────────────────────────────────
// 🔴 生成窗口靠**路由延迟**造，不赌后端快慢（本仓有 Docker 时钟跳 115 秒的先例）。
await page.route('**/advise', async (route) => {
  await new Promise((r) => setTimeout(r, 5000))
  try { await route.continue() } catch { /* Route is already handled — 预期内 */ }
})
await ask('再看一眼这周的安排')
await page.waitForFunction((seam) => {
  const turns = window[seam].getState().turns ?? []
  return turns[turns.length - 1]?.run.status === 'running'
}, SEAM, { timeout: 15000 }).catch(() => {})
await historyToggle().click()
await page.waitForTimeout(250)
const rowsNow = threadRows()
const disabledCount = await rowsNow.evaluateAll((els) => els.filter((e) => e.disabled).length)
const rowsTotal = await rowsNow.count()
rec('⑨a 锁① 生成中历史条目**属性上** disabled（拆掉置灰这条必红；'
  + '只判「点了没反应」会被 store 那把锁掩护成假绿）',
  rowsTotal > 0 && disabledCount === rowsTotal, JSON.stringify({ rowsTotal, disabledCount }))
const beforeBypass = await turnsOf()
// 锁②：绕开 UI 直接调 action —— 同一拍双击够不着 React 的重渲染，disabled 落到 DOM 之前
// 那一发必须被 store 挡住。
// 🔴 必须拿**另一场**（tidB）来试，不能拿当前这场：拿当前这场时先撞上的是**幂等闸**
//    （threadId 已经等于它），于是把 busy 闸整个拆掉这条判据照样绿——外层规则让内层规则
//    免疫变异，正是 belt-and-braces 那个洞（本门实测被它放过一次，M-C 39/0 活了下来）。
const otherThreadId = tidB
await page.evaluate(({ seam, want }) => {
  const s = window[seam].getState()
  const t = (s.adviseThreads ?? []).find((x) => x.thread_id === want)
  if (t) s.hydrateThread(t)
}, { seam: SEAM, want: otherThreadId })
await page.waitForTimeout(300)
const afterBypass = await turnsOf()
rec('⑨b 锁② 生成中绕开 UI 直调 hydrateThread（且是**另一场**，绕开幂等闸）也不动 turns'
  + '（拆掉 store 的 busy 闸这条必红）',
  JSON.stringify(afterBypass) === JSON.stringify(beforeBypass),
  JSON.stringify({ before: beforeBypass, after: afterBypass }))
await page.unroute('**/advise')
}

rec('⑪ 无 pageerror（整程零未捕获异常）', pageErrors.length === 0, JSON.stringify(pageErrors))

void rows
await finish({ rows }, { browser, label: '#78 议事室真线程（续问落同场 · 历史按场分组 · 点一场恢复整场）', listFailures: true })
