// #71 · 议事室会话流端到端门：问两问 → 第一问**仍在屏上** → 第二问的请求体**带 history**。
// 顺带钉 #69 的置灰闸（空文本发送键 disabled），它与本门的驱动方式（真键盘打真输入框）同源。
//
// ## 这道门防的是什么
// 本票最容易活下来的假实现有两种，各配一条主判据：
//   ① 「屏上堆起来了、后端还是零上下文」——DOM 好看，追问却答得像第一次听说。判据 ③ 只认
//      **网络请求体**（page.on('request') 抓 POST /advise 的 body 里的 history），不认 store。
//   ② 「后端带上了、屏上还是覆盖」——第二问一来第一问消失。判据 ② 只认 **DOM**：第一问的
//      问题原文与它自己的回答卡必须还在，且顺序在第二问之前。
// 变异台账（回执）：把 store.askLive 恢复成整体覆盖（`turns: [turn]` 而不是 `[...turns, turn]`）
// → ② 与 ③ 同时红。把 AskRefComposer 的 disabled 拆掉 → ⑤ 红。
//
// ## 怎么跑
// 🔴 **上传型门**（真发 POST /ingest 造 context + 三发真 /advise）；**绝不能排在 C 区之后**
//    （dist 被 C 区重打成生产域名后，任何上传都是往生产库写测试数据）。
//   后端：AVERY_BRAIN=mock AVERY_EXTRACTOR=heuristic AVERY_EMBEDDINGS=keyword uvicorn :8137
//   前端：vite build --mode development + vite preview --host --port 5173
//   VERIFY_BASE=http://localhost:5173 node eval-harness/tools/verify-room-conversation.mjs
// ⚠ 显式 `?lang=zh`：判据要读中文问题原文，默认 EN 壳下语料/文案对不上会以"文案不对"假红。
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
// 一轮真正落定（尾轮 run 到终局）才算问完——这道门要的是"上一轮**答出来了**"，
// 光有 POST 不够：history 只带答出东西的轮次，没落定就组装不出上下文。
const waitSettled = (ms = 30000) => page.waitForFunction(
  (seam) => {
    const turns = window[seam].getState().turns ?? []
    const last = turns[turns.length - 1]
    return !!last && ['complete', 'error'].includes(last.run.status)
  }, SEAM, { timeout: ms }).then(() => true).catch(() => false)

const input = () => page.locator('.lite-room .nexus-followup-composer [data-composer-input]')
const submitBtn = () => page.locator('.lite-room .nexus-followup-composer [data-composer-send]')

// ── ⓪ 铺语料（store 只在这一段当搬运工；被测部件全走真键盘）──────────────────────────────
await page.evaluate(async ({ files, seam }) => {
  const enc = new TextEncoder()
  await window[seam].getState().uploadFiles(
    files.map((f) => new File([enc.encode(f.text)], f.name, { type: 'text/markdown' })))
}, { files: [
  { name: '花名册.md', text: ROSTER },
  { name: '项目周报.md', text: PROJECT },
], seam: SEAM })
await page.waitForFunction(
  (seam) => ['ready', 'error'].includes(window[seam].getState().ingestStatus), SEAM,
  { timeout: 45000 }).catch(() => {})
const base = await page.evaluate((seam) => {
  const st = window[seam].getState()
  return { ingestStatus: st.ingestStatus, contextId: st.contextId,
    people: (st.team?.people ?? []).length }
}, SEAM)
rec('⓪ 自证：语料上传成功（有 contextId、花名册解析出人）',
  base.ingestStatus === 'ready' && !!base.contextId && base.people >= 2, JSON.stringify(base))

await page.evaluate((seam) => window[seam].getState().goScreen('room'), SEAM)
await page.waitForTimeout(600)

// ── ⑤ #69 · 空文本置灰（判据直接落在 disabled 属性上）──────────────────────────────────────
// 🔴 为什么不能只判「点了没发出请求」：submit handler 里还有一句 `if (!text) return` 兜底，
//    只判"没发请求"的话，把 disabled 拆掉这条判据照样绿（belt-and-braces 让内层规则免疫
//    变异——两把锁必须各有各的门）。所以这里直接问那颗按钮自己。
rec('⑤ 自证：议事室空态 composer 在屏上',
  (await input().count()) === 1 && (await submitBtn().count()) === 1)
rec('⑤ #69 · 空文本时发送键 disabled（拆掉置灰这条必红）',
  await submitBtn().isDisabled())
await input().click()
await input().pressSequentially('测', { delay: 30 })
await page.waitForTimeout(150)
rec('⑤ #69 · 打了字就可点（置灰不是恒真——恒 disabled 的实现在这条上红）',
  !(await submitBtn().isDisabled()))
await input().press('Backspace')
await page.waitForTimeout(150)
rec('⑤ #69 · 删空又变回 disabled（跟着文本走，不是一次性初值）',
  await submitBtn().isDisabled())

// ── ① 第一问 ─────────────────────────────────────────────────────────────────────────────────
await input().pressSequentially(Q1, { delay: 15 })
await input().press('Enter')
const got1 = await waitForPosts(1)
const post1 = advisePosts[0]
rec('① 自证：第一问真的发出去了（POST /advise）', got1 && typeof post1?.situation === 'string',
  JSON.stringify(post1?.situation ?? null))
rec('④ 第一问请求体**没有** history 键（additive 契约：absent≠[]）',
  !!post1 && !('history' in post1), JSON.stringify(Object.keys(post1 ?? {})))
const settled1 = await waitSettled()
rec('① 自证：第一轮跑到终局（history 只带答出东西的轮次，没落定就组装不出上下文）', settled1)

const afterFirst = await page.evaluate(() => {
  const turns = Array.from(document.querySelectorAll('.lite-room-board .lite-room-turn'))
  return {
    count: turns.length,
    questions: turns.map((t) => t.querySelector('.lite-room-turn-question-text')?.textContent ?? ''),
    cards: turns.map((t) => t.querySelectorAll('.lite-room-card').length),
  }
})
rec('① 提问即回显：第一轮的问题原文在屏上（此前前端从没存过提问文本）',
  afterFirst.count === 1 && afterFirst.questions[0] === Q1, JSON.stringify(afterFirst))
rec('① 自证：第一轮出了结果卡（回答卡/判读卡——没有它，②的"仍在屏上"就没东西可留）',
  afterFirst.cards[0] >= 1, JSON.stringify(afterFirst.cards))

// ── ②③ 第二问：不覆盖 + 带上下文 ─────────────────────────────────────────────────────────────
await input().click()
await input().pressSequentially(Q2, { delay: 15 })
await input().press('Enter')
const got2 = await waitForPosts(2)
const post2 = advisePosts[1]

const afterSecond = await page.evaluate(() => {
  const turns = Array.from(document.querySelectorAll('.lite-room-board .lite-room-turn'))
  return {
    count: turns.length,
    questions: turns.map((t) => t.querySelector('.lite-room-turn-question-text')?.textContent ?? ''),
    firstCards: turns[0] ? turns[0].querySelectorAll('.lite-room-card').length : 0,
    firstCardText: turns[0]?.querySelector('.lite-room-card')?.textContent?.slice(0, 40) ?? '',
  }
})
rec('② 第二问**不覆盖**第一问：两轮同时在屏上，且第一问排在前（DOM 判据）',
  afterSecond.count === 2 && afterSecond.questions[0] === Q1 && afterSecond.questions[1] === Q2,
  JSON.stringify(afterSecond.questions))
rec('② 第一问的**回答卡**也还在（只留问题行不算——覆盖的是整轮产物）',
  afterSecond.firstCards >= 1 && afterSecond.firstCardText.length > 0,
  JSON.stringify({ cards: afterSecond.firstCards, head: afterSecond.firstCardText }))

const hist = post2?.history
rec('③ 第二问请求体**带 history**（网络层判据，不落 store）',
  got2 && Array.isArray(hist) && hist.length >= 1, JSON.stringify(hist ?? null))
rec('③ history 里装的是**第一问的原文**（不是这一问自己、不是空壳）',
  Array.isArray(hist) && hist.some((h) => (h?.question ?? '').includes(Q1)),
  JSON.stringify((hist ?? []).map((h) => h?.question)))
rec('③ history 里也带了**第一问的答案摘要**（只带问题＝模型仍然不知道上一轮结论）',
  Array.isArray(hist) && hist.some((h) => typeof h?.answer === 'string' && h.answer.trim().length > 0),
  JSON.stringify((hist ?? []).map((h) => (h?.answer ?? '').slice(0, 40))))
rec('③ 第二问的 situation 仍然只是**这一问**（历史走 history 字段，不偷偷拼进正文）',
  typeof post2?.situation === 'string' && post2.situation.includes(Q2) && !post2.situation.includes(Q1),
  JSON.stringify(post2?.situation ?? null))

const settled2 = await waitSettled()
rec('③ 自证：第二轮也跑到终局（后端真吃下了带 history 的请求，不是 4xx/5xx 掉在门口）', settled2)
{
  const status = await page.evaluate((seam) => {
    const turns = window[seam].getState().turns ?? []
    return turns.map((t) => t.run.status)
  }, SEAM)
  rec('③ 自证：两轮都不是 error（带 history 的一问走完整条链）',
    status.length === 2 && status.every((s) => s === 'complete'), JSON.stringify(status))
}

// ═══ #72 · 建议追问 chips + 快问触发收敛 ═══════════════════════════════════════════════════
// 语料（花名册在 ⓪ 上传：周雅婷 / 林小满）：
const Q_FACT = '周雅婷负责的项目截止日期是什么时候'    // 事实查询 + 点名 → 短答、不弹快问卡
const Q_NAME = '周雅婷负责的推广最近有点吃紧，我该怎么帮她理顺' // 判断类 + 点名 → 弹快问卡
const Q_NAME2 = '周雅婷手上的事是不是压太多了，我该怎么调配'
const Q_PLAIN = '这周整体节奏该怎么排'
const Q_PLAIN2 = '我下一步该把精力放在哪儿'
const Q_PLAIN3 = '今天还有哪些要收尾的'

// ── ⑦ chips 在场（advice 路，mock 罐头固定 2 条）──────────────────────────────────────────
const chipsAfter2 = await page.evaluate(() => ({
  containers: document.querySelectorAll('[data-followup-chips]').length,
  chips: Array.from(document.querySelectorAll('[data-followup-chip]'))
    .map((c) => (c.textContent ?? '').trim()),
}))
rec('⑦ #72 · 回答下方出建议追问 chips（mock 罐头 2 条；抹掉 followup 槽这条必红）',
  chipsAfter2.containers === 1 && chipsAfter2.chips.length === 2 &&
  chipsAfter2.chips.every((t) => t.length > 0), JSON.stringify(chipsAfter2))

// ── ⑧ 点击即发（网络层判据：situation=chip 原文 + 带 history）────────────────────────────
const chipText = chipsAfter2.chips[0] ?? ''
await page.locator('[data-followup-chip="0"]').click()
const got3 = await waitForPosts(3)
const post3 = advisePosts[2]
rec('⑧ #72 · 点击 chip 即发为追问：situation === chip 原文（点击=选择，不是预填）',
  got3 && post3?.situation === chipText,
  JSON.stringify({ chipText, situation: post3?.situation ?? null }))
rec('⑧ #72 · chip 追问带上了前两轮 history（含第二问原文——chips 走的就是会话流的上下文）',
  Array.isArray(post3?.history) && post3.history.length >= 2 &&
  post3.history.some((h) => (h?.question ?? '').includes(Q2)),
  JSON.stringify((post3?.history ?? []).map((h) => h?.question)))
rec('⑧ 自证：chip 追问跑到终局', await waitSettled())
const turn3 = await page.evaluate(() => {
  const turns = Array.from(document.querySelectorAll('.lite-room-board .lite-room-turn'))
  return { count: turns.length,
    q: turns[2]?.querySelector('.lite-room-turn-question-text')?.textContent ?? '' }
})
rec('⑧ #72 · chip 的问题以新一轮回显（问题行 = chip 原文）',
  turn3.count === 3 && turn3.q === chipText, JSON.stringify(turn3))

// ── ⑨ 只挂尾轮（三轮全完成，chips 仍只有一组——历史轮上的"接着可以问"是假的此刻）────────
const chipsAfter3 = await page.evaluate(() => ({
  containers: document.querySelectorAll('[data-followup-chips]').length,
  turns: document.querySelectorAll('.lite-room-board .lite-room-turn').length,
}))
rec('⑨ #72 · chips 只挂尾轮（拆掉 isLast 条件这条必红）',
  chipsAfter3.turns === 3 && chipsAfter3.containers === 1, JSON.stringify(chipsAfter3))

// ── ⑩ busy 闸在 store 临界区（chips 双击/同拍重复触发的真防线）───────────────────────────
// 🔴 为什么不用真双击钉：React 重渲染发生在两次 click 之间，chips 早就随尾轮切换卸载了，
//    Playwright 的第二下点在空处——那样的"绿"验不到临界区。判据直接落在 store 的闸上
//    （UI 的 disabled 要等一次重渲染，同一拍的第二下它挡不住——createFormLinks 同款教训）。
const postsBefore10 = advisePosts.length
const guard = await page.evaluate(({ seam, q }) => {
  const st = window[seam].getState()
  const before = st.turns.length
  st.askLive({ situation: q })
  window[seam].getState().askLive({ situation: '第二发不该出去' })
  return { before, after: window[seam].getState().turns.length }
}, { seam: SEAM, q: Q_PLAIN })
rec('⑩ #72 · 同一拍连发两问只开一轮（拆掉 askLive 的 busy 闸这条必红）',
  guard.after === guard.before + 1, JSON.stringify(guard))
rec('⑩ 自证：这一轮跑到终局', await waitSettled())
await page.waitForTimeout(300)
rec('⑩ 自证：网络上也只多了一发 /advise（第二发真的没出去）',
  advisePosts.length === postsBefore10 + 1,
  JSON.stringify({ before: postsBefore10, now: advisePosts.length }))

// ── ⑪ 短答路 chips + 快问收敛「不该弹」（中文语料真跑）──────────────────────────────────
const posts11 = advisePosts.length
await input().click()
await input().pressSequentially(Q_FACT, { delay: 15 })
await input().press('Enter')
await waitForPosts(posts11 + 1)
rec('⑪ 自证：事实查询跑到终局', await waitSettled())
const factState = await page.evaluate((seam) => {
  const st = window[seam].getState()
  const last = (st.turns ?? [])[st.turns.length - 1]
  const els = Array.from(document.querySelectorAll('.lite-room-board .lite-room-turn'))
  const lastEl = els[els.length - 1]
  return {
    answer: !!(last?.run.answer), advice: !!(last?.run.advice),
    answerCard: lastEl ? lastEl.querySelectorAll('.lite-room-answer-card').length : 0,
    chips: lastEl ? lastEl.querySelectorAll('[data-followup-chip]').length : 0,
    askCard: document.querySelectorAll('.lite-room-ask').length,
    storeAsk: st.ask !== null,
  }
}, SEAM)
rec('⑪ 自证：这条语料真走了短答出口（answer 非空、无判读卡——语义闸判据的前提）',
  factState.answer && !factState.advice && factState.answerCard === 1, JSON.stringify(factState))
rec('⑪ #72 · 短答下方也有追问 chips（两条出口都要有——只接 advice 路这条必红）',
  factState.chips === 2, JSON.stringify(factState))
rec('⑪ #72 · 收敛「不该弹」：提到人名但走短答（事实已从记录直接读出）不弹快问卡' +
  '（拆掉 answer_kind 语义闸这条必红）',
  factState.askCard === 0 && !factState.storeAsk, JSON.stringify(factState))

// ── ⑫ 收敛「该出仍出」：判断类 + 点名（中文词边界不许误杀）────────────────────────────────
const posts12 = advisePosts.length
await input().click()
await input().pressSequentially(Q_NAME, { delay: 15 })
await input().press('Enter')
await waitForPosts(posts12 + 1)
rec('⑫ 自证：判断类提问跑到终局', await waitSettled())
// ask-draft 帧在 manifest 之后一帧——落定后再给它一步落地的时间。
await page.waitForFunction((seam) => window[seam].getState().ask !== null, SEAM,
  { timeout: 5000 }).catch(() => {})
const askState = await page.evaluate((seam) => {
  const st = window[seam].getState()
  return { askCard: document.querySelectorAll('.lite-room-ask').length,
    status: st.ask?.status ?? null,
    recipients: (st.ask?.recipients ?? []).map((r) => r.name) }
}, SEAM)
rec('⑫ #72 · 收敛「该出仍出」：判断类提问点名周雅婷 → 快问卡照旧出、收件人=她' +
  '（词边界杀掉中文触发/收敛过头这条必红）',
  askState.askCard === 1 && askState.status === 'draft' && askState.recipients.includes('周雅婷'),
  JSON.stringify(askState))

// ── ⑬ 撤卡重裁（progress.md Notes 拍板落地）：没动过的撤、动过的保 ─────────────────────────
const posts13a = advisePosts.length
await input().click()
await input().pressSequentially(Q_PLAIN2, { delay: 15 })
await input().press('Enter')
await waitForPosts(posts13a + 1)
rec('⑬ 自证：追问跑到终局', await waitSettled())
const untouched = await page.evaluate((seam) => ({
  askCard: document.querySelectorAll('.lite-room-ask').length,
  storeAsk: window[seam].getState().ask !== null,
}), SEAM)
rec('⑬ #72 · 没动过的草稿仍随新一轮退场（保护不扩大化——上一问的过期提案不粘屏）',
  untouched.askCard === 0 && !untouched.storeAsk, JSON.stringify(untouched))

const posts13b = advisePosts.length
await input().click()
await input().pressSequentially(Q_NAME2, { delay: 15 })
await input().press('Enter')
await waitForPosts(posts13b + 1)
await waitSettled()
await page.waitForFunction((seam) => window[seam].getState().ask !== null, SEAM,
  { timeout: 5000 }).catch(() => {})
// 真 UI 编辑：往草稿第一道题面里打字（editAskQuestion → askDirty）。
const qInput = page.locator('.lite-room-ask .ask-q-input').first()
rec('⑬ 自证：快问卡再次出生且题面可编辑', (await qInput.count()) === 1)
await qInput.click()
await qInput.pressSequentially('补一句', { delay: 20 })
const posts13c = advisePosts.length
await input().click()
await input().pressSequentially(Q_PLAIN3, { delay: 15 })
await input().press('Enter')
await waitForPosts(posts13c + 1)
rec('⑬ 自证：再追一问跑到终局', await waitSettled())
const dirtyKept = await page.evaluate((seam) => {
  const st = window[seam].getState()
  return { askCard: document.querySelectorAll('.lite-room-ask').length,
    status: st.ask?.status ?? null, dirty: st.askDirty === true }
}, SEAM)
rec('⑬ #72 · manager 动过的草稿不被追问杀掉（重裁拍板：拆掉保护这条必红）',
  dirtyKept.askCard === 1 && dirtyKept.status === 'draft' && dirtyKept.dirty,
  JSON.stringify(dirtyKept))

// ── ⑥ 离开议事室＝这场对话结束（票面拍板：刻意不持久化；#72：受保护的卡也随对话散场）────
await page.evaluate((seam) => window[seam].getState().goScreen('home'), SEAM)
await page.waitForTimeout(500)
await page.evaluate((seam) => window[seam].getState().goScreen('room'), SEAM)
await page.waitForTimeout(600)
const afterLeave = await page.evaluate((seam) => ({
  turns: (window[seam].getState().turns ?? []).length,
  domTurns: document.querySelectorAll('.lite-room-turn').length,
  // #75 改判：空态不再有 `.nexus-empty-composer-wrap` 这层壳（docked composer 三态统一后
  // 它整个退役）。语义也顺势正名——原来的变量名 `empty` 暗示「空态是一棵独立的树」，
  // 现在空态与对话态是同一棵树，区别只在 turns 有没有。判据换成「零轮 + composer 在场」。
  emptyBoard: document.querySelectorAll('.lite-room-board[data-room-turns="0"]').length,
  composer: document.querySelectorAll('.lite-room > .nexus-followup-composer').length,
  ask: window[seam].getState().ask !== null,
  askCard: document.querySelectorAll('.lite-room-ask').length,
  storageHit: Object.keys(window.localStorage)
    .filter((k) => {
      const v = window.localStorage.getItem(k) ?? ''
      return v.includes('别墅套餐推广现在最需要我做什么') || v.includes('那这周先动哪一头')
    }),
}), SEAM)
rec('⑥ 离开再回来＝这场对话结束（turns 清空、屏上回到空态）',
  afterLeave.turns === 0 && afterLeave.domTurns === 0 &&
  afterLeave.emptyBoard === 1 && afterLeave.composer === 1,
  JSON.stringify(afterLeave))
rec('⑥ #72 · 受保护的快问卡也随对话散场（clearTurns 清 ask——卡不跨场复活成假"此刻"）',
  !afterLeave.ask && afterLeave.askCard === 0, JSON.stringify(afterLeave))
rec('⑥ **刻意不持久化**：localStorage 里找不到任何一问的正文（别顺手加持久化）',
  afterLeave.storageHit.length === 0, JSON.stringify(afterLeave.storageHit))

rec('无 pageerror（整程零未捕获异常）', pageErrors.length === 0, JSON.stringify(pageErrors))

void rows
await finish({ rows }, { browser,
  label: '#71+#72 room-conversation（会话流 → history → 追问 chips → 快问收敛）', listFailures: true })
