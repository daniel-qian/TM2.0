#!/usr/bin/env node
// 返回客户不该被首访向导拦一道 —— open-loop-0720（Danny 07-20 拍板）。
//
// ## bug 是什么
// 上周已经传过公司资料、账上真有数据的老客户，今天重开 https://averylite.dannyqian.com，
// 屏幕先弹一个"开始上手"向导挡住自己的数据——得先手动关掉才看得见团队。三家外部公司
// 7/25 试用，第二天回来的人会撞上这个。
//
// ## Danny 的拍板（不是"点过一次就不弹"）
// 触发条件是「已经有数据就不弹」，不是「点过一次就不弹」——向导不删、不改行为，只改
// **自动弹出**这一件事：已经有数据的人不自动挨一下，全新访客照样自动弹。
//
// ## 为什么单开一道门
// 现成门（verify-p0.mjs / verify-switchers.mjs）会在别的断言之前顺手把首访向导 Escape
// 掉（`dismissOnboardIfAny`），从没断言过"它本该不该出现"这件事本身——它们的存在前提
// 就是"反正会弹，先关掉再说"，不会替这次的修复背书。
//
// ## 判据
//   (a) 全新访客（localStorage 全空）→ 向导必须自动弹出，且落在第①步（upload）。
//   (b) 返回访客（localStorage 里已有 contextId 锚点——真实走一次上传后刷新重进模拟
//       "上周已经传过"）→ 向导不自动弹出，且**全程不闪现**：不是"关闭那一刻检查一次"，
//       是从 reload 提交的那一刻起就高频轮询，覆盖 restoreSession() 那次异步网络请求
//       还没回来的整个窗口，一次都不能采到它出现过。
//   (c) open-loop-0720 补的第三条：Danny 拍板「有数据就不弹」选的那个选项原话是「弹窗
//       保留在菜单里随时能再看」——但那个入口从没被造出来。同一个返回访客（(b) 那次
//       reload 之后，向导确认没自动弹）点 Playbooks 屏的「重看上手引导」链接
//       （.lite-playbooks-reopen-onboarding）→ 向导必须真的打开。
//       🔴 这条不是"点了 begin() 就算过"：begin() 守着 status!=='unseen' 才生效，对已经
//       done/skipped 的老客户是空操作；就算 status 变了，selectWizardOpen 第一行
//       `if (hasStoredContext) return false` 还是会把它按回去——hadContextOnLoad 对这批
//       "有数据的返回客户"恒真，这正是本次要补的那个洞。所以断言的是**屏幕上真的出现了
//       .lite-onboard**，不是 store 某个字段翻了没意义的值。
//
// 🔴 为什么"全程不闪现"比"关闭时刻检查一次"更硬：本修复选的信号（src/lite2/OnboardWizard.tsx
// 里的 `hadContextOnLoad`）是模块顶层只读一次的 localStorage 快照，不是响应式订阅
// restoreSession() 跑完之后的 store 状态——后者会有"先弹一下、网络回来才关掉"的窗口，
// 体验上比不弹还差。只在"关闭时刻"采一次样，测不出这一类回归；这道门专门堵它。
//
// ## 怎么跑
//   1) 起后端：cd eval-harness && AVERY_BRAIN=mock python -m uvicorn service.app:app --port <端口>
//   2) 前端：node node_modules/typescript/bin/tsc -b &&
//            VITE_AVERY_API_BASE=http://127.0.0.1:<后端端口> node node_modules/vite/bin/vite.js
//              build --mode development &&
//            node node_modules/vite/bin/vite.js preview --port <前端端口> --strictPort
//      🔴 这个 worktree 的共享 node_modules 缺 @babel/*，`vite dev` serve 模式起不来——
//         必须走 build + preview，不能用 `vite dev`（见交接记录同款环境坑）。
//      🔴 VITE_AVERY_API_BASE 是构建期常量（transport.ts 读 import.meta.env.VITE_AVERY_API_BASE），
//         必须在 `vite build` 之前设置，`vite preview` 时再设没有用。
//   3) VERIFY_BASE=http://127.0.0.1:<前端端口> node eval-harness/tools/verify-onboarding-returning.mjs
//   （VERIFY_BASE 默认 http://127.0.0.1:5299——本棒约定的隔离前端端口。）
//
// 退出码 0 = 全过；非 0 = 有 FAIL。
import { chromium } from 'playwright'

const UI = process.env.VERIFY_BASE || 'http://127.0.0.1:5299'
const R = []
const rec = (n, ok, d) => {
  R.push({ n, ok })
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${n}${d ? ' — ' + d : ''}`)
}

// 与 verify-aria-zh.mjs 同形的一份合成中文周报——上传路径只要能让后端 ingest 成功即可，
// 本门不关心解析出的项目内容，只关心"这次上传真的落出了一个 contextId 锚点"。
const DOC = [
  '# 星野科技 · 周报 W29', '',
  '## 项目：客户系统迁移', '负责人：李明', '进度：70%', '',
].join('\n')

async function onboardOpenCount(page) {
  try {
    return await page.evaluate(() => document.querySelectorAll('.lite-onboard').length)
  } catch {
    // 导航过渡中执行上下文可能被销毁——这不是"采到打开"，是采样噪音，按 0 处理但不计入
    // sawOpen（调用方用 -1 区分噪音与真实 0）。
    return -1
  }
}

const browser = await chromium.launch({ headless: true })

// ── (a) 全新访客：localStorage 全空 → 向导必须自动弹出 ──────────────────────────────
console.log('\n═══ (a) 全新访客（localStorage 全空）—— 向导应自动弹出 ═══')
const ctxFresh = await browser.newContext({ viewport: { width: 1280, height: 900 } })
const pageFresh = await ctxFresh.newPage()
const freshErrors = []
pageFresh.on('pageerror', (e) => freshErrors.push(e.message))
await pageFresh.goto(`${UI}/?v=2&mode=live&lang=zh`, { waitUntil: 'networkidle' })
await pageFresh.waitForTimeout(300)

const freshOpen = await onboardOpenCount(pageFresh)
rec('全新访客：向导自动弹出（.lite-onboard 在 DOM 里）', freshOpen === 1, `采到 ${freshOpen} 个`)
const freshStep = await pageFresh
  .evaluate(() => document.querySelector('.lite-onboard')?.getAttribute('data-onboard-step'))
  .catch(() => null)
// input-side-0721：闸门页新增第 0 步「三扇门」（doors）——首访第一眼是门厅，不再直接是上传。
rec('全新访客：闸门落在第 0 步（doors 三扇门）', freshStep === 'doors', `data-onboard-step="${freshStep}"`)
rec('全新访客场景全程无 pageerror', freshErrors.length === 0, freshErrors.slice(0, 3).join(' | ') || '0 条')
await ctxFresh.close()

// ── 铺垫：真实走一次上传，落出 contextId 锚点（模拟"上周已经传过、这周再回来"）───────
console.log('\n═══ 铺垫：真实上传一次，落出 lite2:contextId:v1 锚点 ═══')
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
const page = await ctx.newPage()
const setupErrors = []
page.on('pageerror', (e) => setupErrors.push(e.message))

await page.goto(`${UI}/?v=2&mode=live&lang=zh`, { waitUntil: 'networkidle' })
// 首访向导这时候会自动弹（这就是场景 (a) 验过的行为）——先 Esc 关掉（pause，仅本次会话，
// 不影响接下来"落锚点"这件事：锚点靠 contextId，不靠 onboard 的持久化状态）。
if ((await onboardOpenCount(page)) > 0) {
  await page.keyboard.press('Escape')
  await page.waitForTimeout(400)
}

await page.evaluate(async (text) => {
  await window.__lite2Store.getState().uploadFiles([new File([text], 'w29.md', { type: 'text/markdown' })])
}, DOC)
await page
  .waitForFunction(() => window.__lite2Store.getState().ingestStatus === 'ready', { timeout: 20000 })
  .catch(() => {})

const anchorAfterUpload = await page.evaluate(() => ({
  contextId: localStorage.getItem('lite2:contextId:v1'),
  ingestStatus: window.__lite2Store.getState().ingestStatus,
  hasTeam: window.__lite2Store.getState().team !== null,
}))
rec(
  '铺垫：上传成功，ingestStatus === "ready"',
  anchorAfterUpload.ingestStatus === 'ready',
  `实得 "${anchorAfterUpload.ingestStatus}"`,
)
rec(
  '铺垫：上传成功后 localStorage 落了 contextId 锚点（lite2:contextId:v1）',
  !!anchorAfterUpload.contextId,
  `contextId=${anchorAfterUpload.contextId}`,
)
rec('铺垫：store 里真的有 team 数据（不是空上传）', anchorAfterUpload.hasTeam)

// ── (b) 返回访客：同一浏览器/同一 localStorage，刷新重进 —— 向导不该弹、更不该闪现 ──
console.log('\n═══ (b) 返回访客（已有 contextId 锚点）—— 向导不自动弹出，且全程不闪现 ═══')
const returnErrors = []
page.on('pageerror', (e) => returnErrors.push(e.message))

// commit 即返回——不等 load/networkidle，尽量从导航刚提交的那一刻就开始高频采样，
// 覆盖 restoreSession() 那次异步 fetch 还没回来的整个窗口。
const reloadPromise = page.reload({ waitUntil: 'commit' })
const samples = []
const pollDeadline = Date.now() + 3000
while (Date.now() < pollDeadline) {
  samples.push(await onboardOpenCount(page))
  await page.waitForTimeout(20)
}
await reloadPromise
await page.waitForLoadState('networkidle').catch(() => {})
// 网络彻底静默之后再多采几次——万一是"restoreSession 拿到结果那一刻才弹"这种更隐蔽的窗口。
for (let i = 0; i < 10; i++) {
  samples.push(await onboardOpenCount(page))
  await page.waitForTimeout(100)
}

const positiveSamples = samples.filter((n) => n > 0)
const noiseSamples = samples.filter((n) => n === -1).length
rec(
  '返回访客：全程采样（约 160 次，含导航过渡期）从未出现过 .lite-onboard',
  positiveSamples.length === 0,
  `采样共 ${samples.length} 次，命中 open 的 ${positiveSamples.length} 次，导航噪音 ${noiseSamples} 次`,
)

const finalOpen = await onboardOpenCount(page)
rec('返回访客：加载完成后向导仍是关闭状态', finalOpen === 0, `采到 ${finalOpen} 个`)

const finalState = await page.evaluate(() => ({
  team: window.__lite2Store.getState().team !== null,
  contextId: window.__lite2Store.getState().contextId,
}))
rec(
  '返回访客：restoreSession 真的把团队数据拉回来了（向导不弹不是"巧合地没数据"）',
  finalState.team === true,
  JSON.stringify(finalState),
)
rec('返回访客场景全程无 pageerror', returnErrors.length === 0, returnErrors.slice(0, 3).join(' | ') || '0 条')

// ── (c) 同一个返回访客：点 Playbooks 屏的「重看上手引导」→ 向导必须真的打开 ────────
console.log('\n═══ (c) 返回访客点「重看上手引导」—— 向导必须真的打开 ═══')
await page.evaluate(() => window.__lite2Store.getState().goScreen('playbooks'))
await page.waitForTimeout(300)

const reopenBtnCount = await page
  .evaluate(() => document.querySelectorAll('.lite-playbooks-reopen-onboarding').length)
  .catch(() => -1)
rec('Playbooks 屏上有「重看上手引导」入口', reopenBtnCount === 1, `采到 ${reopenBtnCount} 个`)

if (reopenBtnCount === 1) {
  await page.click('.lite-playbooks-reopen-onboarding')
  await page.waitForTimeout(400)
}

const reopenedCount = await onboardOpenCount(page)
rec('点了之后向导真的打开了（.lite-onboard 在 DOM 里）', reopenedCount === 1, `采到 ${reopenedCount} 个`)

const reopenedStep = await page
  .evaluate(() => document.querySelector('.lite-onboard')?.getAttribute('data-onboard-step'))
  .catch(() => null)
// input-side-0721：重看也从三扇门起——重看的人里恰有想试示例团队的老客户（onboardStore.reopen）。
rec('重新打开落在第 0 步（doors）——"重看"是完整再走一遍，不是接着旧进度', reopenedStep === 'doors', `data-onboard-step="${reopenedStep}"`)

rec('点开之后 store 里团队数据仍在（重看没把已加载的数据冲掉）',
  (await page.evaluate(() => window.__lite2Store.getState().team !== null)))

const reopenErrors = []
page.on('pageerror', (e) => reopenErrors.push(e.message))
rec('重看场景全程无 pageerror', reopenErrors.length === 0, reopenErrors.slice(0, 3).join(' | ') || '0 条')

await ctx.close()
await browser.close()

const fail = R.filter((r) => !r.ok).length
console.log(`\n═══ 判据：${R.length - fail} PASS · ${fail} FAIL ═══`)
if (fail) {
  console.log('\n失败项：')
  for (const r of R.filter((x) => !x.ok)) console.log(`  ✗ ${r.n}`)
}
process.exit(fail ? 1 : 0)
