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

const after = await page.evaluate((CID) => {
  const st = window.__lite2Store.getState()
  return {
    contextId: st.contextId,
    anchor: localStorage.getItem('lite2:contextId:v1'),
    restoreError: st.restoreError,
    ingestStatus: st.ingestStatus,
    restoring: st.restoring,
    // #88 · 名册（`knownContexts`）已整条撤除，下面那条判据改盯**钥匙**。
    // 🔴 读的是 localStorage 原文而不是 store 里某个字段：这一条要证明的是"我们没有拿一次
    //    404 去销毁一份服务端只交出过一次的凭据"，那份凭据的家就是这个键。
    tokenKeys: Object.keys(JSON.parse(localStorage.getItem('lite2:ownerTokens:v1') || '{}')).length,
    hasTokenForCtx: !!JSON.parse(localStorage.getItem('lite2:ownerTokens:v1') || '{}')[CID],
  }
}, before.contextId)

// 判据 = feat-050 写死的那套口径：锚点松开、干净回上传态、**凭据不动**（fixD 的红线）
rec('真 404 被认出来：锚点松开（localStorage 不再留死锚点）', after.anchor === null, `anchor=${after.anchor}`)
rec('真 404 被认出来：干净回上传态，不把错误糊在屏幕上', after.contextId === null && after.restoreError === null,
  JSON.stringify({ contextId: after.contextId, restoreError: after.restoreError, ingestStatus: after.ingestStatus }))
// 🔴 **#88 改判**。旧条断言的是「名册不动」（`knownContexts >= 1`）。名册随「新建一家公司」
//    整条撤除之后，那条判据有两种坏法，两种都糟：留着写 `>= 1` 是**硬红**；顺手改成
//    `(st.knownContexts ?? []).length` 比大小则**恒 0 === 0 的空真**——一道全绿的门冒充
//    「回得去的入口还被守着」。
//    它护的纪律一个字没变，只是护的**东西**换了：一次 404 什么都证明不了（feat-038 刻意让
//    「不存在」和「你证明不了这是你的」返同一个 404），所以绝不许拿它去销毁任何**不可再生**
//    的资产。名册没了，今天不可再生的那份资产是 **owner_token**——服务端只交出一次，
//    删了就永久没人能认领这份档案（锚点反而是可再生的：登录恢复会把它送回来）。
rec('凭据不动（404 不能证明"服务端真没了"，不许拿它销毁只交出过一次的 owner_token）',
  after.tokenKeys >= 1 && after.hasTokenForCtx,
  `tokenKeys=${after.tokenKeys} hasTokenForCtx=${after.hasTokenForCtx}`)

const fail = R.filter((r) => !r.ok).length
console.log(`\n═══ 404 判据复验：${R.length - fail} PASS · ${fail} FAIL ═══`)
if (fail) console.log('  ⚠️ 若 anchor 仍留着且 restoreError 非空 —— 就是 isNotFound() 又退回抠 message 了。')

await browser.close()
process.exit(fail ? 1 : 0)
