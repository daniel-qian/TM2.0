// 分流短答门（0729 输出形态战役 03 · output-form-0729/kickoff.md）。
//
// ## 断言的是什么
//   世界 A（事实查询：「明天中层例会是几点？」）：
//     · manifest 走 answer 路：气泡 .lite-room-answer-card 在，9 节判读卡 .structured-output-card 不在
//     · 气泡文本非空；contractOk（红线 + cite 闸照吃——mock 计划里 cite 在 answer_direct 之前）
//   世界 B（判断类：「这周团队里有谁可能需要我搭把手？」）：
//     · 判读卡在、气泡不在——mock 侧分流正则「宁漏勿错杀」的 UI 层钉子
//   v01 最小镜像：事实查询在 v01 也出气泡（v01 只加守卫不重设计）
//
// ## 为什么在 mock 上测两条路是真测试
//   分流机制分两层：真 brain 由提示词判据选工具（离线测不到），mock 由 live_input._looks_factual
//   正则选罐头（离线可测）。本门测的是**管道**：answer_direct 终局 → enforce_answer →
//   manifest{answer_kind:'answer'} → streamSource → 气泡；以及 advice 路零回归。
//   提示词判据的语义质量归真 brain 冒烟（test_service_smoke，有 key 才跑）。
//
// ## 跑法（与 verify-room-usability 同一套前置）
//   VERIFY_BASE=http://127.0.0.1:5173 node eval-harness/tools/verify-answer-split-03.mjs
import { chromium } from 'playwright'

const UI = process.env.VERIFY_BASE || 'http://127.0.0.1:5173'
const R = []
const rec = (n, ok, d) => { R.push({ n, ok }); console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${n}${d ? ' — ' + d : ''}`) }

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

const FACTUAL = '明天中层例会是几点？'
const JUDGMENT = '这周团队里有谁可能需要我搭把手？'

const browser = await chromium.launch({ headless: true })

async function drive({ label, url, storeSeam, question }) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } })
  const page = await ctx.newPage()
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(e.message))
  await page.goto(url, { waitUntil: 'networkidle' })
  if (await page.locator('.lite-onboard').count()) {
    await page.keyboard.press('Escape')
    await page.waitForTimeout(500)
  }
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
  await page.evaluate(({ seam, q }) => {
    const st = window[seam].getState()
    st.goScreen('room')
    st.askLive({ situation: q })
  }, { seam: storeSeam, q: question })
  await page.waitForFunction(
    (seam) => ['complete', 'error'].includes(window[seam].getState().run.status),
    storeSeam, { timeout: 30000 },
  )
  await page.waitForTimeout(400)
  const state = await page.evaluate((seam) => {
    const run = window[seam].getState().run
    return {
      runStatus: run.status,
      answer: run.answer ?? null,
      hasAdvice: !!run.advice,
      bubble: document.querySelectorAll('.lite-room-answer-card').length,
      bubbleText: document.querySelector('.lite-room-answer-text')?.innerText ?? '',
      card: document.querySelectorAll('.structured-output-card').length,
      contractOk: run.contractOk,
    }
  }, storeSeam)
  await ctx.close()
  return { state, pageErrors, tag: (n) => `[${label}] ${n}` }
}

// ── 世界 A · v02 事实查询 → 气泡，无 9 节卡 ──────────────────────────────────────
{
  const { state, pageErrors, tag } = await drive({
    label: 'v02·事实', url: `${UI}/?v=2&mode=live&look=paper&lang=zh`,
    storeSeam: '__lite2Store', question: FACTUAL,
  })
  rec(tag('run 完成'), state.runStatus === 'complete', `status=${state.runStatus}`)
  rec(tag('走 answer 路（run.answer 非空、run.advice 空）'),
    !!state.answer && !state.hasAdvice, JSON.stringify({ answer: (state.answer || '').slice(0, 40), hasAdvice: state.hasAdvice }))
  rec(tag('气泡渲染且文本非空'), state.bubble === 1 && state.bubbleText.length > 0,
    `bubble=${state.bubble} chars=${state.bubbleText.length}`)
  rec(tag('9 节判读卡不在 DOM（简单问题不出报告）'), state.card === 0, `card=${state.card}`)
  rec(tag('契约 ok（红线 + cite 闸照吃）'), state.contractOk === true, `contractOk=${state.contractOk}`)
  rec(tag('无 pageerror'), pageErrors.length === 0, pageErrors.slice(0, 2).join(' | ') || '0 条')
}

// ── 世界 B · v02 判断类 → 判读卡，无气泡（宁漏勿错杀钉子）───────────────────────
{
  const { state, pageErrors, tag } = await drive({
    label: 'v02·判断', url: `${UI}/?v=2&mode=live&look=paper&lang=zh`,
    storeSeam: '__lite2Store', question: JUDGMENT,
  })
  rec(tag('走 advice 路（卡在、气泡不在）'),
    state.hasAdvice && state.card === 1 && state.bubble === 0 && !state.answer,
    JSON.stringify({ hasAdvice: state.hasAdvice, card: state.card, bubble: state.bubble }))
  rec(tag('无 pageerror'), pageErrors.length === 0, pageErrors.slice(0, 2).join(' | ') || '0 条')
}

// ── v01 最小镜像 · 事实查询也出气泡（同一 API，冻结壳不许哑掉）───────────────────
{
  const { state, pageErrors, tag } = await drive({
    label: 'v01·事实', url: `${UI}/?v=1&mode=live&lang=zh`,
    storeSeam: '__liteStore', question: FACTUAL,
  })
  rec(tag('气泡渲染且无 9 节卡'), state.bubble === 1 && state.card === 0,
    `bubble=${state.bubble} card=${state.card}`)
  rec(tag('无 pageerror'), pageErrors.length === 0, pageErrors.slice(0, 2).join(' | ') || '0 条')
}

await browser.close()

const pass = R.filter((r) => r.ok).length
const fail = R.length - pass
console.log(`\n═══ 分流短答：${pass} PASS · ${fail} FAIL ═══`)
process.exit(fail ? 1 : 0)
