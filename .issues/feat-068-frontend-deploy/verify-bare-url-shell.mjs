#!/usr/bin/env node
// 裸链开出哪张壳 —— Danny 2026-07-19 拍板 ① 的回归闸。
//
// 期望断言数：**4 PASS**（裸链 2 条 + `?v=1` 逃生门 2 条）。
//
// 为什么要单开一个门：
//
//   在这条线之前，**没有任何一个门跑过客户真正会打开的那个 URL**。所有浏览器门都硬编码
//   `?v=2&mode=live&look=paper&lang=zh` —— 也就是说，`resolveVersion()` 的缺省值翻成几，
//   整套门一个字都不知道。拍板 ① 改的恰恰就是那个缺省值：改对了没门证明，改错了也没门拦。
//   这个门补的就是这个洞，守的是决策 ① 的**两半**：
//     · 裸链必须开出 v02（客户看得见 feat-050..060 那十一条）；
//     · `?v=1` 必须仍能开回 v01（出事时唯一的逃生门，kickoff §1① 明令不许删）。
//   少了后一半，「把 v01 删干净」也能让这个门全绿——那正是最该被拦住的改法。
//
// ⚠️ **本地必须显式带 `?mode=live`，而且不能靠仓库里的 .env。**
//    仓库根目录没有 .env，`VITE_AVERY_MODE` 在本地是空的，`src/shared/mode.ts` 于是回落到
//    缺省 `'story'` —— 本地裸开 `/` 渲染的是 `<AmbientCanvasShell />`，两张 lite 壳一张都不在，
//    四条断言会以「壳没渲染」的面目全红，看着像 v02 崩了。生产是靠 `vercel.json` 的
//    `VITE_AVERY_MODE=live` 把它翻过来的（构建期 env，不在树里）。
//    所以这里驱动 `/?mode=live`：`mode` 显式给，`v` 刻意不给 —— 不给的那个才是被测对象。
//
// 前置同 verify-p0.mjs（后端 8137 stub 大脑 + 前端 5173）。
//   node .issues/feat-068-frontend-deploy/verify-bare-url-shell.mjs
import { chromium } from 'playwright'

const UI = process.env.VERIFY_BASE || 'http://127.0.0.1:5173'
const R = []
const rec = (n, ok, d) => { R.push({ n, ok }); console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${n}${d ? ' — ' + d : ''}`) }

// v02 根类 = src/lite2/Lite2App.tsx 的 `app-shell lite2-shell`
// v01 根类 = src/lite/LiteApp.tsx   的 `app-shell lite-shell`
// 两者是不同的 class token，`.lite-shell` 不会误命中 `.lite2-shell`。
const countShells = () => ({
  v2: document.querySelectorAll('.lite2-shell').length,
  v1: document.querySelectorAll('.lite-shell').length,
})

const browser = await chromium.launch({ headless: true })

// ── 1) 裸链（刻意不带 v=）必须是 v02 ────────────────────────────────────────────
const bare = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage()
await bare.goto(`${UI}/?mode=live`, { waitUntil: 'networkidle' })
await bare.waitForTimeout(600)
const b = await bare.evaluate(countShells)
rec('裸链（无 ?v=）渲染 v02 壳', b.v2 === 1, `.lite2-shell=${b.v2}`)
rec('裸链（无 ?v=）不渲染 v01 壳', b.v1 === 0, `.lite-shell=${b.v1}`)

// ── 2) `?v=1` 逃生门必须仍是 v01 ───────────────────────────────────────────────
const esc = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage()
await esc.goto(`${UI}/?v=1&mode=live`, { waitUntil: 'networkidle' })
await esc.waitForTimeout(600)
const e = await esc.evaluate(countShells)
rec('?v=1 逃生门仍渲染 v01 壳', e.v1 === 1, `.lite-shell=${e.v1}`)
rec('?v=1 逃生门不渲染 v02 壳', e.v2 === 0, `.lite2-shell=${e.v2}`)

const fail = R.filter((r) => !r.ok).length
console.log(`\n═══ 裸链壳判据：${R.length - fail} PASS · ${fail} FAIL ═══`)
if (fail) {
  console.log('  ⚠️ 四条全红且两个计数都是 0 —— 多半不是回归，是本地 mode 回落到了 story，')
  console.log('     先确认 URL 带了 ?mode=live（见文件头）。')
  console.log('  ⚠️ 只有后两条红 —— v01 逃生门被拆了，见 kickoff §1①：不许删也不许拆。')
}

await browser.close()
process.exit(fail ? 1 : 0)
