// 多库切换门（files-hub-0729/02）。
//
// ## 缺陷是什么
// 后端**不支持追加**：`POST /ingest` 每次新铸一个 context_id，传旧 id 是重建并覆盖（会就地
// 毁掉第一家公司的数据）。于是第二次上传之后，第一份从界面上彻底消失——数据还在服务端、
// owner_token 还在 localStorage、`knownContexts` 名册也还在 store 里，**唯独没有任何回得去
// 的入口**。用户的读法只有一种：「我把数据弄丢了」。
//
// store 侧（switchContext / forgetContext / switchPending / switchError）与全部 12 条中英
// 文案早就写好并过过审字，**只有 JSX 没了**——那 12 个键因此长期是孤儿键，正是 AGENTS.md
// 「i18n 里的孤儿文案键是红旗」写的那种事故（某次合并吃掉了一整个功能）。本门看住它不再丢。
//
// ## 怎么才算真的够到了缺陷
// 不调 store 的 action——那只证明函数还在，证明不了屏幕上点得到。本门**点真按钮**：
//   ① 真上传两批（两份人名完全不同的花名册，真 HTTP transport + AVERY_BRAIN=mock 后端）；
//   ② 到 /files，断言名册两条、当前那条被标出来；
//   ③ **点**第一批那行的「打开这一份」→ 断言 contextId 换回去 **且 team 里的人换回第一批**
//      （只断言 contextId 会漏掉"id 换了、数据没跟上"这半个 bug）；
//   ④ 连点两下，断言只打出一次 /team 请求（store 注释明写「UI 有义务挡住双击」，
//      并发切换会让 owner_token 与 contextId 错配 = 跨公司串数据）；
//   ⑤ **点**「从这个列表里移除」→ 名册少一条；
//   ⑥ 源码级断言：forgetContext / forgetKnownContext 在 src/ 下**没有任何自动调用点**
//      （失败路径绝不许调它——context_id 只在 ingest 返回那一刻出现过一次，删名册 = 永久
//      失去入口，用一次可能误判的读失败去换，代价完全不对等）。
//
// 怎么跑（同 verify-file-manifest-truth.mjs 的前置）：
//   1) cd eval-harness && AVERY_BRAIN=mock AVERY_EXTRACTOR=heuristic AVERY_EMBEDDINGS=keyword \
//      AVERY_CORS_ORIGINS=http://127.0.0.1:5307,http://localhost:5307 \
//      python -m uvicorn service.app:app --port 8307
//   2) VITE_AVERY_API_BASE=http://127.0.0.1:8307 node node_modules/vite/bin/vite.js build --mode development
//   3) node node_modules/vite/bin/vite.js preview --port 5307 --strictPort
//   4) VERIFY_BASE=http://127.0.0.1:5307 node eval-harness/tools/verify-context-switch.mjs
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'

const UI = process.env.VERIFY_BASE || 'http://127.0.0.1:5307'
const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const R = []
const rec = (n, ok, d) => { R.push({ n, ok }); console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${n}${d ? ' — ' + d : ''}`) }

// 两批人名**完全不重叠**：这样"切回去了没有"是一个能一眼判定的事实，而不是靠计数。
const BATCH_A = { name: 'batch-a-roster.csv', text: 'name,role,project\n王丽,前厅经理,海港改造\n陈涛,工程主管,海港改造\n' }
const BATCH_B = { name: 'batch-b-roster.csv', text: 'name,role,project\n赵敏,财务负责人,新店筹备\n孙浩,采购,新店筹备\n' }

const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
const page = await ctx.newPage()
const pageErrors = []
page.on('pageerror', (e) => pageErrors.push(e.message))

// 数 /team/{id} 的 GET —— ④ 的双击判据靠它，不靠肉眼。
let teamGets = 0
page.on('request', (r) => {
  if (r.method() === 'GET' && /\/team\/[^/?]+(\?|$)/.test(r.url())) teamGets += 1
})

const S = '__lite2Store'
const upload = async (batch) => {
  await page.evaluate(async ({ text, name, seam }) => {
    const enc = new TextEncoder()
    await window[seam].getState().uploadFiles([new File([enc.encode(text)], name, { type: 'text/csv' })])
  }, { ...batch, seam: S })
  await page.waitForFunction(
    (seam) => ['ready', 'error'].includes(window[seam].getState().ingestStatus), S, { timeout: 30000 },
  ).catch(() => {})
  await page.waitForTimeout(1200) // 给 refreshFiles/refreshNotes 的异步 GET 落地
}
const peopleNames = () => page.evaluate((seam) =>
  (window[seam].getState().team?.people ?? []).map((p) => p.name).sort(), S)
const ctxId = () => page.evaluate((seam) => window[seam].getState().contextId, S)

await page.goto(`${UI}/files?v=2&mode=live&look=paper&lang=zh`, { waitUntil: 'networkidle' })
if (await page.locator('.lite-onboard').count()) {
  await page.keyboard.press('Escape')
  await page.waitForTimeout(700)
}

// ── ① 两批真上传 ────────────────────────────────────────────────────────────────────────
await upload(BATCH_A)
const idA = await ctxId()
const peopleA = await peopleNames()
await upload(BATCH_B)
const idB = await ctxId()
const peopleB = await peopleNames()

rec('两批各自铸出了不同的 context（后端确实不追加，而是新建）', !!idA && !!idB && idA !== idB,
  `A=${idA} B=${idB}`)
rec('两批读出的人不重叠（判据本身是有效的）',
  peopleA.length > 0 && peopleB.length > 0 && !peopleA.some((n) => peopleB.includes(n)),
  `A=${JSON.stringify(peopleA)} B=${JSON.stringify(peopleB)}`)

// ── ② 名册两条 + 当前那条被标出来 ────────────────────────────────────────────────────────
await page.evaluate((seam) => window[seam].getState().goScreen('files'), S)
await page.waitForTimeout(600)

const rows = await page.locator('.lite-files-switch-row').count()
rec('资料库屏「你上传过的几批」列出两条（UI 真的渲染了，不只是 store 里有）', rows === 2, `实得 ${rows}`)
const currentMarked = await page.locator('.lite-files-switch-row[data-current="1"]').count()
rec('当前正在用的那一条被标出来（且只有一条）', currentMarked === 1, `实得 ${currentMarked}`)
const currentIsB = await page.evaluate(() => {
  const row = document.querySelector('.lite-files-switch-row[data-current="1"]')
  return row ? row.innerText : ''
})
rec('被标为「当前」的是刚传的第二批（不是第一批）', currentIsB.includes('batch-b-roster.csv'),
  currentIsB.replace(/\s+/g, ' ').slice(0, 90))

// ── ③ 点「打开这一份」切回第一批，team 数据必须跟着换回 ──────────────────────────────────
const openBtns = page.locator('.lite-files-switch-row:not([data-current="1"]) .lite-files-switch-open')
rec('非当前那一行有「打开这一份」按钮（当前行刻意不给——点了也不会发生任何事）',
  (await openBtns.count()) === 1, `实得 ${await openBtns.count()}`)

teamGets = 0
// ④ 真·双击：两下必须发生在**同一拍**里，中间不许有任何 await。
// 🔴 第一版这里写的是 `click()` → 读 disabled → `click({force:true})`，那是个假测试：
// mock 后端极快，第一次切换在两次点击之间就已经跑完了，按钮重新可用、而且列表已经重排
// （"当前"变成了 A，非当前那行成了 B）——于是第二下是一次**合法的、切回 B** 的点击。
// 门当时报的 "2 次请求 / contextId 没换回来" 全都是这个测试自己造出来的，不是产品缺陷。
// 用户真正会做的事是"手抖连点两下"，中间没有网络往返，所以判据必须同拍。
const doubleClick = await page.evaluate(() => {
  const btn = document.querySelector('.lite-files-switch-row:not([data-current="1"]) .lite-files-switch-open')
  if (!btn) return { clicked: 0, disabledAfterFirst: null }
  btn.click()
  // 同步读：React 还没来得及重渲染，这里读到的是"第一下之后按钮的真实可用性"
  const disabledAfterFirst = btn.disabled
  btn.click()
  return { clicked: 2, disabledAfterFirst }
})
await page.waitForFunction((seam) => window[seam].getState().switchPending === null, S, { timeout: 20000 })
  .catch(() => {})
await page.waitForTimeout(1500)

rec('同一拍连点两下，只打出一次 /team 请求（没有并发切换 → 不会 contextId 与 owner_token 错配）',
  teamGets === 1, `实得 ${teamGets} 次（clicked=${doubleClick.clicked}）`)

const idAfter = await ctxId()
const peopleAfter = await peopleNames()
rec('contextId 换回了第一批', idAfter === idA, `实得 ${idAfter}，期望 ${idA}`)
rec('team 里的人也真的换回了第一批（只看 id 会漏掉「id 换了数据没跟上」那半个 bug）',
  JSON.stringify(peopleAfter) === JSON.stringify(peopleA),
  `实得 ${JSON.stringify(peopleAfter)}，期望 ${JSON.stringify(peopleA)}`)
rec('切换成功后没有挂错误横幅', (await page.locator('.lite-files-switch-error').count()) === 0)

// ── ⑤ 点「从这个列表里移除」 ─────────────────────────────────────────────────────────────
const beforeForget = await page.locator('.lite-files-switch-row').count()
await page.locator('.lite-files-switch-row:not([data-current="1"]) .lite-files-switch-forget').first().click()
await page.waitForTimeout(500)
const afterForget = await page.evaluate((seam) => window[seam].getState().knownContexts.length, S)
rec('点「从这个列表里移除」后名册少一条', afterForget === beforeForget - 1,
  `${beforeForget} → ${afterForget}`)
rec('移除的是被点的那一条，当前这一份还在（没有把用户正在看的那份删掉）',
  await page.evaluate((seam) => {
    const s = window[seam].getState()
    return s.knownContexts.some((c) => c.id === s.contextId)
  }, S))

rec('全程无 pageerror', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | ') || '0 条')

// ── ⑥ 源码断言：forget 只有用户点击这一个调用方 ──────────────────────────────────────────
// 🔴 这一条不能只靠浏览器：一个挂在 catch 分支里的 forgetContext 平时根本不会被触发，
// 跑一百遍正常流程也照样全绿。它只在用户真丢数据的那一天才现形，所以判据必须是静态的。
const srcDir = path.join(ROOT, 'src')
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)])
const callSites = []
for (const f of walk(srcDir).filter((f) => /\.tsx?$/.test(f))) {
  const lines = fs.readFileSync(f, 'utf8').split(/\r?\n/)
  lines.forEach((line, i) => {
    if (/\b(forgetContext|forgetKnownContext)\s*\(/.test(line)) {
      callSites.push({
        file: path.relative(ROOT, f).replace(/\\/g, '/'),
        line: i + 1,
        text: line.trim(),
        // 前 8 行的上下文——判"是不是挂在失败路径上"要看它落在哪个块里，不能只看本行。
        before: lines.slice(Math.max(0, i - 8), i).join('\n'),
      })
    }
  })
}
// 允许的调用点：store 内部实现（forgetContext action 调 forgetKnownContext）+ 本轮那个按钮。
const suspicious = callSites.filter((c) =>
  !(c.file === 'src/lite2/store.ts' || c.file === 'src/lite2/KnownContextList.tsx'))
rec('forget 没有出现在 store / 切换列表按钮之外的任何地方（失败路径绝不许调它）',
  suspicious.length === 0, suspicious.map((c) => `${c.file}:${c.line}`).join(', ') || '0 处')
// 🔴 判据只认真正的失败**处理块**（`catch (` / `.catch(`），不认字符串里的 "error"。
// 第一版写成 /error/i，于是 `set({ ..., switchError: null })` 这行——它做的恰恰是**清掉**
// 错误——被判成"挂在失败路径上"。一个把正确写法报成违规的门，下一个人只会把它删掉。
const inCatch = callSites.filter((c) => /catch\s*\(|\.catch\s*\(/.test(c.before + '\n' + c.text))
rec('forget 的调用点都不在 catch 块里（一次读失败绝不许换来永久失去入口）', inCatch.length === 0,
  inCatch.map((c) => `${c.file}:${c.line}`).join(', ') || '0 处')

await ctx.close()
await browser.close()

const failed = R.filter((r) => !r.ok)
console.log(`\n${R.length - failed.length}/${R.length} PASS`)
if (failed.length) {
  console.log('FAILED:'); failed.forEach((f) => console.log('  - ' + f.n))
  process.exit(1)
}
