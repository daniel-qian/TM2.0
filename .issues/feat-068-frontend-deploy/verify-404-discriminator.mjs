#!/usr/bin/env node
// 真 404 判据复验 —— 专门守 ZH-03 拆掉的那条暗线。
//
// 背景：feat-050 用 `/HTTP 404/.test(err.message)` 判「context 没了/token 对不上」。
// ZH-03 之后 httpErrorMessage() 把 404 翻成给客户看的中文句子，里面一个数字都没有，
// 那条正则于是对**真 HTTP 传输的每一次 404** 都返 false。
//
// 🔴 为什么必须用真后端跑：DEV 的 stub 传输**仍然**抛 `team HTTP 404 (stub)`，正则匹配得上。
//    也就是说任何跑 stub 的门都会绿，而生产两条路径全错。这个脚本因此刻意走 createHttpTransport
//    + 真后端，并用一个真的对不上的 owner_token 去触发真 404。
//
// 前置同 verify-p0.mjs（后端 8137 stub 大脑 + 前端 5173）。
import { chromium } from 'playwright'

const UI = process.env.VERIFY_BASE || 'http://127.0.0.1:5173'
const R = []
const rec = (n, ok, d) => { R.push({ n, ok }); console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${n}${d ? ' — ' + d : ''}`) }

const DOC = '# 三亚鹿山雅居 · 周报\n\n## 项目：别墅交付验收\n负责人：李明\n阻碍项：佣金测算卡住\n'

const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
const page = await ctx.newPage()
await page.goto(`${UI}/?v=2&mode=live&look=paper&lang=zh`, { waitUntil: 'networkidle' })
if (await page.locator('.lite-onboard').count()) { await page.keyboard.press('Escape'); await page.waitForTimeout(600) }

// 1) 真上传，拿到真 contextId + 真 owner_token
await page.evaluate(async (t) => {
  await window.__lite2Store.getState().uploadFiles([new File([t], 'w.md', { type: 'text/markdown' })])
  await new Promise((r) => setTimeout(r, 2000))
}, DOC)

const before = await page.evaluate(() => ({
  contextId: window.__lite2Store.getState().contextId,
  anchor: localStorage.getItem('lite2:contextId:v1'),
}))
rec('前置：真后端 ingest 拿到 contextId 且锚点已落盘', !!before.contextId && before.anchor === before.contextId,
  JSON.stringify(before))

// 2) 把 owner_token 换成一个对不上的值 —— 后端会回真 404（feat-038：不给 403 这种 oracle）
await page.evaluate(() => {
  const raw = JSON.parse(localStorage.getItem('lite2:ownerTokens:v1') || '{}')
  for (const k of Object.keys(raw)) raw[k] = 'not-the-right-token-' + k
  localStorage.setItem('lite2:ownerTokens:v1', JSON.stringify(raw))
})

// 3) 刷新 —— 恢复路径吃到真 404
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(2500)
if (await page.locator('.lite-onboard').count()) { await page.keyboard.press('Escape'); await page.waitForTimeout(500) }

const after = await page.evaluate(() => {
  const st = window.__lite2Store.getState()
  return {
    contextId: st.contextId,
    anchor: localStorage.getItem('lite2:contextId:v1'),
    restoreError: st.restoreError,
    ingestStatus: st.ingestStatus,
    restoring: st.restoring,
    knownContexts: (st.knownContexts ?? []).length,
  }
})

// 判据 = feat-050 写死的那套口径：锚点松开、干净回上传态、**名册不动**（fixD 的红线）
rec('真 404 被认出来：锚点松开（localStorage 不再留死锚点）', after.anchor === null, `anchor=${after.anchor}`)
rec('真 404 被认出来：干净回上传态，不把错误糊在屏幕上', after.contextId === null && after.restoreError === null,
  JSON.stringify({ contextId: after.contextId, restoreError: after.restoreError, ingestStatus: after.ingestStatus }))
rec('名册不动（404 不能证明"服务端真没了"，不许删用户回得去的唯一入口）', after.knownContexts >= 1,
  `knownContexts=${after.knownContexts}`)

const fail = R.filter((r) => !r.ok).length
console.log(`\n═══ 404 判据复验：${R.length - fail} PASS · ${fail} FAIL ═══`)
if (fail) console.log('  ⚠️ 若 anchor 仍留着且 restoreError 非空 —— 就是 isNotFound() 又退回抠 message 了。')

await browser.close()
process.exit(fail ? 1 : 0)
