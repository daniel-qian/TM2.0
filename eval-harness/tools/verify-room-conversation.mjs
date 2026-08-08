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

const input = () => page.locator('.lite-room .nexus-followup-composer input[type="text"]')
const submitBtn = () => page.locator('.lite-room .nexus-followup-composer button[type="submit"]')

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

// ── ⑥ 离开议事室＝这场对话结束（票面拍板：刻意不持久化）────────────────────────────────────
await page.evaluate((seam) => window[seam].getState().goScreen('home'), SEAM)
await page.waitForTimeout(500)
await page.evaluate((seam) => window[seam].getState().goScreen('room'), SEAM)
await page.waitForTimeout(600)
const afterLeave = await page.evaluate((seam) => ({
  turns: (window[seam].getState().turns ?? []).length,
  domTurns: document.querySelectorAll('.lite-room-turn').length,
  empty: document.querySelectorAll('.nexus-empty .nexus-empty-composer-wrap form').length,
  storageHit: Object.keys(window.localStorage)
    .filter((k) => {
      const v = window.localStorage.getItem(k) ?? ''
      return v.includes('别墅套餐推广现在最需要我做什么') || v.includes('那这周先动哪一头')
    }),
}), SEAM)
rec('⑥ 离开再回来＝这场对话结束（turns 清空、屏上回到空态）',
  afterLeave.turns === 0 && afterLeave.domTurns === 0 && afterLeave.empty === 1,
  JSON.stringify(afterLeave))
rec('⑥ **刻意不持久化**：localStorage 里找不到任何一问的正文（别顺手加持久化）',
  afterLeave.storageHit.length === 0, JSON.stringify(afterLeave.storageHit))

rec('无 pageerror（整程零未捕获异常）', pageErrors.length === 0, JSON.stringify(pageErrors))

void rows
await finish({ rows }, { browser, label: '#71 room-conversation（会话流 → 不覆盖 → history 进请求体）', listFailures: true })
