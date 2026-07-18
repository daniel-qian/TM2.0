#!/usr/bin/env node
// fixA · 集成层验证（真浏览器 + 真后端 + 真 ingest）——verify-fixA.mjs 的纯函数断言证明不了
// 「经理眼睛看到的那一屏」。这里 agent 当第一个用户：上传一份**没写状态、挂着阻塞**的中文周报
// （抽取层实测会吐出无 status 键的项目卡，见 progress-fixA.md 的 payload 原样），然后看四块屏。
//
// 怎么跑（端口是 fixA 专用的，别占集成方的 5173/8137）：
//   1) cd eval-harness && AVERY_BRAIN=stub AVERY_CORS_ORIGINS=http://127.0.0.1:5301 \
//        python -m uvicorn service.app:app --port 8301 --host 127.0.0.1
//   2) VITE_AVERY_API_BASE=http://127.0.0.1:8301 npx vite --port 5301 --strictPort
//   3) node .issues/v02-partner-align-0718/verify-fixA-live.mjs
//   🔴 CORS 是精确匹配：端口对不上时浏览器静默拦请求，屏幕看起来就像「没数据」。
//
// 退出码 0 = 全过。

import { chromium } from 'playwright'

const BASE = process.env.VERIFY_BASE || 'http://127.0.0.1:5301'
const results = []
function record(name, pass, detail) {
  results.push({ name, pass })
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name}${detail ? ' — ' + detail : ''}`)
}

// 一份真实形状的中文周报：项目块里**没有任何状态行**，但有一条阻碍项。
const DOC = [
  '# 佣金测算 项目周报',
  '负责人：李娜',
  '本周完成了初版测算表，正在和财务对口径。',
  '阻碍项：口径没定，等财务确认',
  '',
].join('\n')

const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
const page = await ctx.newPage()
const consoleErrors = []
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()) })
page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message))

await page.goto(`${BASE}/?v=2&mode=live&look=paper&lang=zh`, { waitUntil: 'networkidle' })
if ((await page.locator('.lite-onboard').count()) > 0) {
  await page.keyboard.press('Escape')
  await page.waitForTimeout(600)
}

const uploaded = await page.evaluate(async (text) => {
  const st = window.__lite2Store
  if (!st) return { err: 'store 未暴露' }
  await st.getState().uploadFiles([new File([text], '佣金测算周报.md', { type: 'text/markdown' })])
  await new Promise((r) => setTimeout(r, 2000))
  const s = st.getState()
  return {
    ingest: s.ingestStatus,
    err: s.ingestError,
    rawStatus: s.rawTeam?.projects?.[0]?.status ?? null,   // 后端到底发没发 status 键
    status: s.team?.projects?.[0]?.status ?? null,          // 映射层渲染用文案
    statusRaw: s.team?.projects?.[0]?.statusRaw ?? null,
    metrics: s.team?.briefing?.metrics ?? [],
  }
}, DOC)

record('真后端 ingest 成功', uploaded.ingest === 'ready', JSON.stringify(uploaded).slice(0, 220))
record('🔴 前提：后端这份 payload 确实没发 status 键', uploaded.rawStatus === null,
       `rawStatus=${uploaded.rawStatus}`)
record('statusRaw 缺失就是缺失', uploaded.statusRaw === null, `statusRaw=${uploaded.statusRaw}`)

if ((await page.locator('.lite-onboard').count()) > 0) {
  await page.keyboard.press('Escape')
  await page.waitForTimeout(600)
}
await page.waitForTimeout(600)

// ── 1 · 项目卡上的状态 ────────────────────────────────────────────────────────────────────
const statusText = (await page.locator('.home-project-status').first().innerText()).trim()
record('项目卡显示「未读到状态」', statusText.includes('未读到状态'), statusText)
record('🔴 项目卡不再显示编出来的 on-track', !statusText.includes('on-track'), statusText)
record('项目卡不是空白', statusText.length > 0, JSON.stringify(statusText))

// ── 2 · 首屏简报 ──────────────────────────────────────────────────────────────────────────
const subhead = (await page.locator('.home-greeting-sub').first().innerText()).trim()
record('🔴 简报不再否认风险信号', !subhead.includes('没有读出风险信号'), subhead)
record('简报说出「值得多看一眼」', subhead.includes('值得多看一眼'), subhead)
const metricLabels = (await page.locator('.lite-metrics').first().allInnerTexts()).join(' | ')
record('metrics 里出现「值得多看一眼」那一格', metricLabels.includes('值得多看一眼'),
       metricLabels.replace(/\n/g, ' | '))

// ── 3 · 晨间分诊卡（M3）─────────────────────────────────────────────────────────────────
const toneLabel = (await page.locator('.home-handoff-tone').first().innerText()).trim()
const handoffTitle = (await page.locator('.home-handoff-body h3').first().innerText()).trim()
record('分诊卡 tone 标签是中文', toneLabel === '值得多看一眼', toneLabel)
record('分诊卡标题是中文', handoffTitle.startsWith('去看看'), handoffTitle)
record('分诊卡没有英文残留', !/[A-Za-z]{3,}/.test(toneLabel + handoffTitle),
       toneLabel + ' / ' + handoffTitle)

// ── 4 · 「多看一眼」屏：不许有伪造的对照卡 ────────────────────────────────────────────────
await page.goto(`${BASE}/closer-look?v=2&mode=live&look=paper&lang=zh`, { waitUntil: 'networkidle' })
await page.waitForTimeout(900)
if ((await page.locator('.lite-onboard').count()) > 0) {
  await page.keyboard.press('Escape')
  await page.waitForTimeout(600)
}
const gapCards = await page.locator('.lite-gap-card').count()
const gapClaims = await page.locator('.lite-gap-pane-claim .lite-gap-pane-text').allInnerTexts()
record('🔴 没自述过状态 → 零对照卡', gapCards === 0, `cards=${gapCards} claims=${JSON.stringify(gapClaims)}`)
record('🔴「文件里的说法」栏里没有客户没说过的话',
       !gapClaims.some((c) => c.includes('负责人：李娜') || c.includes('Reported status')),
       JSON.stringify(gapClaims))

record('无 console 报错', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '))

await browser.close()
const failed = results.filter((r) => !r.pass)
console.log(`\n${failed.length === 0 ? 'ALL GREEN' : 'RED'} — ${results.length - failed.length} ok, ${failed.length} failed\n`)
process.exit(failed.length === 0 ? 0 : 1)
