// handoffs 空态诚实门（UIUX 棒 2026-07-20 晚 · F4）。
//
// ## 缺陷是什么
// Team 屏「今天值得你留意」区在 handoffs 清单为空时固定渲染 handoffsEmpty：
// 「暂时没有需要你出面的事——文件读起来一切平稳。」判据只看 team.handoffs.length，
// **完全无视风险信号计数**。而同一屏顶部的简报 subhead 刚说完「其中 {n} 处值得多看一眼」
// ——同一个屏幕、同一份数据，上半句「9 处值得多看」、下半句「一切平稳」。
// 这是前四棒一直在打的「界面替文档说话」类缺陷的新实例：signals 非零时「一切平稳」就是
// 一句界面自己编出来的话。比两处都错更糟——它让客户怀疑的是数据，不是界面。
// 实测（2026-07-20，seed 语料 30 人/4 项目/9 信号）：v01、v02、en、zh 四个面全中。
//
// ## 判别器为什么在两种世界里答案不同
// 直接驱动 store 造两个世界（不依赖某份语料恰好长出多少信号——那是抽取器的自由度，
// 不是本门要测的东西）：
//   世界 A：handoffs=[] 且 briefing.metrics 带 'need a look'=3
//     → 空态必须提到 3、必须不说「平稳」。
//   世界 B：handoffs=[] 且 metrics 不带 'need a look'
//     → 空态必须回到原文案（「平稳」是诚实的，此时真的没有信号）。
// 修法若只是删掉「平稳」句（世界 B 也换掉），B 就红——两个世界互为对方的护栏。
//
// ## 怎么跑（与 verify-room-usability.mjs 同一套前置）
//   VERIFY_BASE=http://127.0.0.1:5173 node eval-harness/tools/verify-handoffs-empty-honesty.mjs
// 迁自票 #16：boot/上报/收尾管线搬进 lib/gate-run.mjs，断言判据一字未改。
import { bootPage, makeRec, finish } from './lib/gate-run.mjs'

const UI = process.env.VERIFY_BASE || 'http://127.0.0.1:5173'
const gateRec = makeRec()
const rec = gateRec.rec

const SEED_DOC = [
  '# 望江咨询 · 项目周报 W33',
  '',
  '## 项目：客户门户改版',
  '负责人：陈静',
  '状态：正常',
  '',
  '本周完成登录页联调，下周进入验收。',
  '',
].join('\n')

let browser

async function driveShell({ label, url, storeSeam }) {
  console.log(`\n═══ ${label} ═══`)
  // 分歧⑤(c)：每个"世界"一个新 context，各自 ctx.close()；browser 首次由 bootPage 新起、
  // 之后传回去复用（与 verify-status-truth 同一模型）。
  const boot = await bootPage({ browser, url, trackPageErrors: true })
  browser = boot.browser
  const { context: ctx, page, pageErrors } = boot
  const tag = (n) => `[${label}] ${n}`

  await page.evaluate(
    async ({ doc, seam }) => {
      const enc = new TextEncoder()
      const f = new File([enc.encode(doc)], 'w33-weekly.md', { type: 'text/markdown' })
      await window[seam].getState().uploadFiles([f])
    },
    { doc: SEED_DOC, seam: storeSeam },
  )
  await page.waitForFunction(
    (seam) => ['ready', 'error'].includes(window[seam].getState().ingestStatus),
    storeSeam, { timeout: 30000 },
  )
  await page.evaluate((seam) => window[seam].getState().goScreen('team'), storeSeam)
  await page.waitForTimeout(500)

  // ── 世界 A：handoffs 空 + 3 处风险信号 ─────────────────────────────────────────────
  const worldA = await page.evaluate((seam) => {
    const st = window[seam]
    const team = st.getState().team
    if (!team) return { ok: false, why: 'no team' }
    st.setState({
      team: {
        ...team,
        handoffs: [],
        briefing: {
          ...team.briefing,
          metrics: [
            { label: 'people', value: String(team.people.length) },
            { label: 'active projects', value: String(team.projects.length) },
            { label: 'need a look', value: '3' },
          ],
        },
      },
    })
    return { ok: true }
  }, storeSeam)
  await page.waitForTimeout(300)
  const textA = await page.evaluate(() => document.querySelector('.lite-handoffs-empty')?.innerText ?? '(没渲染)')
  console.log(`  世界A 空态文案: ${textA}`)
  rec(tag('A·信号非零时空态不说「平稳」（这句是界面编的，数据没说）'),
    worldA.ok && !textA.includes('平稳') && !/read steady/i.test(textA), `text="${textA}"`)
  rec(tag('A·空态把信号数说出来（3 处，与简报同源）'),
    worldA.ok && textA.includes('3'), `text="${textA}"`)
  // 0729 大白话命名（ADR-0031）：v02 词=「值得注意/worth noting」；v01 是冻结壳，保留旧词
  // 「多看一眼/closer look」——断言按壳分词，判的仍是「与本壳简报/tab 同一个词，不另造词」。
  const lookWord = label === 'v01'
    ? (textA.includes('多看一眼') || /closer look/i.test(textA))
    : (textA.includes('值得注意') || /worth noting/i.test(textA))
  rec(tag('A·空态提到本壳的「值得注意」词族（与简报/tab 同一个词，不另造词）'),
    worldA.ok && lookWord, `text="${textA}"`)

  // ── 世界 B：handoffs 空 + 零信号（条目不存在 = 后端口径的零）──────────────────────
  await page.evaluate((seam) => {
    const st = window[seam]
    const team = st.getState().team
    st.setState({
      team: {
        ...team,
        handoffs: [],
        briefing: {
          ...team.briefing,
          metrics: [
            { label: 'people', value: String(team.people.length) },
            { label: 'active projects', value: String(team.projects.length) },
          ],
        },
      },
    })
  }, storeSeam)
  await page.waitForTimeout(300)
  const textB = await page.evaluate(() => document.querySelector('.lite-handoffs-empty')?.innerText ?? '(没渲染)')
  console.log(`  世界B 空态文案: ${textB}`)
  rec(tag('B·零信号时仍是原「平稳」文案（此时平稳是真话，别把它一并删掉）'),
    textB.includes('平稳') || /read steady/i.test(textB), `text="${textB}"`)

  rec(tag('无 pageerror'), pageErrors.length === 0, pageErrors.slice(0, 2).join(' | ') || '0 条')
  await ctx.close()
}

await driveShell({ label: 'v02', url: `${UI}/?v=2&mode=live&look=paper&lang=zh`, storeSeam: '__lite2Store' })
await driveShell({ label: 'v01', url: `${UI}/?v=1&mode=live&lang=zh`, storeSeam: '__liteStore' })

await finish(gateRec, { browser, label: 'handoffs 空态诚实' })
