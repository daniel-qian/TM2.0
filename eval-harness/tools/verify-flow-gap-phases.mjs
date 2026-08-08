// B/C 组判定门 —— morning triage + Follow-ups（feat-036，flowVerdict）与
// "A closer look" 差距卡（feat-044，gapVerdict）。
//
// ## 为什么这道门之前不存在，以及为什么它值得开一道（票 #14）
// scripts/gates/live-frontend-gate.snippet.js 里 assertTriage*/assertFollowups*/assertGaps*
// 这 7 个断言函数（约 700 行实现，snippet 1537-2074 行）此前**零机械化 runner**——只有人
// 按 live-frontend-gate.md 373 行头注释走注入协议，手工把 JSON 粘贴进浏览器 console 才会
// 执行。电池全绿（run-battery.mjs）也回归不到它们：全仓 `grep -rln
// "assertTriage|assertGaps|flowVerdict|gapVerdict" --include=*.mjs` 除 snippet 自身外零命中。
// 这正是「门全绿 ≠ 真部件被验到」的活样本——本文件把这条驱动序列焊进一个可重跑的 .mjs，
// 断言判据本身一个字不改（照抄 verify-skin-phases.mjs 的适配器模式：读 snippet 里现成的
// assert 函数、读它自己算出来的 pass，门只负责 rec() 上报，不重新判断对错）。
//
// ## 🔴 施工单写的 `?transport=stub` 是个死胡同——这道门没有照抄，理由记在这里
// 施工单原话是"走 stub transport，零后端代价，与 skin-phases 同级"。verify-skin-phases 确实
// 传了 `?transport=stub`，但它的断言（aurora/paper/leak 探针）只读计算后的 CSS，从不调用任何
// transport 方法——它"不碰后端"是因为断言本身没有 fetch，不是因为 stub 真的生效了。
// 本门不一样：injectSeeds/assertTriage*/assertGaps* 全靠 transport 返回的 team 数据驱动，
// `?transport=stub` 是否真生效对本门是生死攸关的前提。而它**在这份 dist 上其实是死的**：
//   src/lite2/store.ts:385 `const defaultTransport = import.meta.env.DEV ? resolveTransport()
//   : createHttpTransport()` —— `import.meta.env.DEV` 由"跑的是 `vite dev` 还是 `vite build`"
//   静态决定，`--mode development` 只改 `import.meta.env.MODE` 这个字符串，不改 DEV/PROD
//   （src/main.tsx:40 的原话："import.meta.env.DEV 在生产构建里被静态求值成 false"）。本仓的
//   共享 preview 一律是 `vite build --mode development` 产物（run-battery.mjs:78："本仓 vite dev
//   起不来，一律 build+preview"）——也就是说 `?transport=stub` 在这整套门环境里对**任何**门都是
//   死的，这是刻意的安全阀（store.ts:378-383：不然任何人往上线地址挂个 `?transport=stub` 就能
//   看见编造数据）。实测证据（本票 born_red 之外单独验证过一次）：带着 `transport=stub` 上传
//   一个内容为空字符串的 seed.txt，Team 屏渲染出的是"Ingested 1 file(s): 0 people, 0
//   projects."——货真价实打在了本地 mock 后端上，不是 stubTransport.ts 里那份 16 人 2 项目的
//   STUB_TEAM。
// 于是本门改走 file-manifest-truth / onboarding-returning / context-switch 那条已确立的路子：
// **真上传，打本地 mock 后端**（AVERY_BRAIN=mock + AVERY_EXTRACTOR=heuristic，零出网零花费，
// 入 A 区的理由不变）。种子不是既有的两份 demo 文档，是本文件自己手写的一段纯文本——精确对齐
// eval-harness/avery/ingest/extract.py 的 heuristic 规则（`^status\s*[:\-]\s*(.+)$` /
// `\b(blocker|blocked|waiting on|...)\b`），手工制造 gapDerive.ts 需要的那个"自报稳、真有卡点"
// 矛盾（STEADY_STATUSES = on-track/steady，gapDerive.ts:45），而不是赌两份通用 demo 文档里
// 恰好天然含有这个矛盾。
//
// ## 必须遵守的三个坑（snippet 头注释 81-134 / 135-243 行写过，这里落实成代码）
//   ① injectSeeds 必须先跑——一次全新加载 team===null / ingestStatus==='idle'，triage/
//      follow-ups/gaps 全部派生自 team，不先注入全是诚实的空态，四组断言会全红（这不是 bug，
//      是"没喂数据"）。snippet 注释原话："Same prerequisite applies to groups C and F's stub
//      phases"——C 组（gaps）同样要求它所在的这次页面加载已经注入过数据。
//   ② 首访引导向导要先关掉（`.lite-onboard` 守卫）——gate-run.mjs 的 bootPage/dismissOnboard
//      按 `.lite-onboard` 的存在与否决定按不按 Escape，本门直接复用，不重新发明。
//   ③ reload 即重注入——`assertFollowupsPersist` 要求真的整页 reload 再读一遍数据（证明
//      follow-ups 是 localStorage 落盘、不是纯内存态）；reload 会清空注入过的 window.__seedGate，
//      必须重新 addScriptTag。🔴 与 stub 模式不同的是：走真 HTTP transport 时 contextId 会被
//      真记进 `lite2:contextId:v1`（store.ts:659 `if (!stubSelected) rememberContextId(...)`，
//      真上传这条路 `stubSelected` 恒为 false），所以 reload 后 `restoreSession()`
//      会自己拿着 contextId 去 GET /team/{ctx} 把 team 数据取回来——**不需要也不应该**在
//      reload 后再跑一次 injectSeeds（那样会 POST 出第二次 ingest，contextId 换新，反而把
//      before/after 对比的地基换掉）。onboarding 向导同理：`hadContextOnLoad` 这次是真
//      true，向导不会在 reload 后重新出现，但仍然保留一次防御性 dismissOnboard() 调用
//      （`.lite-onboard` 不存在时是纯 no-op，不依赖它是否真的需要）。
//
// ## 调用序列（snippet 头注释 81-134 = B 组，135-243 = C 组；实现分别在 1537-1852 / 1854-2074）
//   injectSeeds → assertTriageRenders → assertTriageActions → assertFollowupsFlow →
//   snapshotFollowups() → [reload + 重注入 snippet + 防御性关向导] → assertFollowupsPersist →
//   assertGapsDerive → assertGapsResolve → assertGapsToAsk
//   （gaps 组紧跟在 followupsPersist 后面跑，这时 team 已经由 restoreSession() 通过真
//   GET /team/{ctx} 自动摆回来了，不需要在 gaps 前再插一次 injectSeeds。）
//
// 入 A 区：真后端但零花费（mock brain + heuristic extractor + keyword embeddings，全离线三件
// 套），与 file-manifest-truth/onboarding-returning/context-switch 同级——不是"零后端"，是
// "后端零成本"。
//
//   VERIFY_BASE=http://localhost:5173 node eval-harness/tools/verify-flow-gap-phases.mjs
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { bootPage, dismissOnboard, makeRec, finish } from './lib/gate-run.mjs'

const UI = process.env.VERIFY_BASE || 'http://localhost:5173'
const HERE = dirname(fileURLToPath(import.meta.url))
const SNIPPET = readFileSync(join(HERE, '..', '..', 'scripts', 'gates', 'live-frontend-gate.snippet.js'), 'utf8')

// 手写种子——精确对齐 extract.py 的 heuristic 规则，制造 gapDerive.ts 要的那个矛盾：
// pr_pilot 自报 at-risk（自洽，不算 gap）；pr_portal 自报 on-track 但真有卡点（矛盾，算 gap）。
// 两个 "Project:" header 行让 granularity.segment_projects 把文档切成两段独立扫描
// （extract.py:1356-1364），"Status:"/"Owner:" 行走 extract.py:1426/1438 的字段抽取，
// 卡点行命中 extract.py:1487 的英文 blocker 嗅探（含 "blocked" 一词）。
const SEED_TEXT = `Project: Pilot Launch - Hangzhou Store
Owner: Lin Qing
Status: at-risk
Summary: First offline pilot store; fixtures and vendor quotes are on the critical path.
- Vendor quote for store fixtures is still unsigned; blocked on vendor sign-off.

Project: Onboarding Portal Revamp
Owner: Chen Mingyuan
Status: on-track
Summary: Rebuilding the internal onboarding portal around the new checklist flow.
- The new checklist flow still needs sign-off from Ops; blocked on their review this week.
`
const SEED_FILES = [{ name: 'flow-gap-seed.txt', b64: Buffer.from(SEED_TEXT, 'utf8').toString('base64') }]

const gateRec = makeRec()
const rec = gateRec.rec

async function reinjectSnippet(page) {
  await page.addScriptTag({ content: SNIPPET })
  await page.evaluate(() => window.__seedGate.defuseAnimations())

}

// ── 关于 _clickTab('Follow-ups')：曾经点不到，已在 snippet 侧修好 ────────────────
// 本门第一次跑出来是 6 PASS · 2 FAIL：assertFollowupsFlow / assertFollowupsPersist 内部三次
// `_clickTab('Follow-ups')` 100% 超时。根因不在本门也不在断言，在共享助手：
// snippet 的 `_clickTab(label)` 做整颗按钮 textContent 精确比对，而 0721 对齐棒把 follow-ups
// 那个 tab 拆成了两层（LiteTopbar.tsx:176-181，全表只有它这么做）——`.scene-tab-main`='To-do list'
// + `.scene-tab-sub`='Follow-ups'，整颗 textContent 成了 'To-do listFollow-ups'，与任何一个
// 单独标签都不相等。snippet 1431-1438 承认过那次 rename，但只有 assertV2Boots 跟着改了读法。
//
// 🔴 这条的射程比本门大得多：**live-frontend-gate.md 那套人工注入协议同样是坏的**——
// 任何人照文档手跑 B 组都会卡在这里。而它能藏这么久，恰恰因为 B/C 组在本门之前没有机械
// runner：没人真去走过那份协议，所以"点不到"从来没变成过一次红。这就是票 #14 的真正收获，
// 比"补一道门"本身更值钱。
// 修法落在 snippet 侧（`_clickTab` 整颗 textContent 优先、匹配不上再看 main/sub 两层），
// 一次修好全部调用方。本门这里**刻意不留兜底补丁**：留着就是把上游的坏掩盖成局部的绿，
// 下一个人照样踩。实测——snippet 修好后本门不带任何 patch 跑出 8 PASS · 0 FAIL。

async function runInjectSeeds(page) {
  return page.evaluate((files) => window.__seedGate.injectSeeds(files), SEED_FILES)
}

const { browser, page } = await bootPage({
  // 🔴 `&lang=en` 必须钉死：本门驱动全靠 snippet 的 _clickTab 按**英文**标签点 tab
  //（'Team' / 'Today' / 'Follow-ups'——#63 起「Worth noting」tab 已退休，gaps 组改走
  // _openHomeGaps 进「今天」的差距摘要块），不钉语言就等于把门的成败绑在"默认语言恰好是 en"
  // 这个环境事实上。失败模式不会假绿（点不到 → 卡挂不上 → gapsDerive cards=0 → 红），
  // 但那是一条**环境相关的红**，查起来贵。同区的 button-family / status-truth 都显式钉了 lang。
  url: `${UI}/?v=2&mode=live&lang=en`,
  onboardWait: 600,
})

await reinjectSnippet(page)

// ── 坑① injectSeeds 先行 ──
{
  const out = await runInjectSeeds(page)
  rec('injectSeeds·首次注入', !!out.pass, out.pass ? '' : `error=${out.error}`)
}

// ── B 组：triage + follow-ups ──
{
  const out = await page.evaluate(() => window.__seedGate.assertTriageRenders())
  rec('triageRenders', !!out.pass, out.pass ? '' : JSON.stringify(out).slice(0, 200))
}
{
  const out = await page.evaluate(() => window.__seedGate.assertTriageActions())
  rec('triageActions', !!out.pass, out.pass ? '' : JSON.stringify(out).slice(0, 200))
}
{
  const out = await page.evaluate(() => window.__seedGate.assertFollowupsFlow())
  rec('followupsFlow', !!out.pass, out.pass ? '' : JSON.stringify(out).slice(0, 200))
}
const before = await page.evaluate(() => window.__seedGate.snapshotFollowups())

// ── 坑③ reload 即重注入：真 HTTP transport 下 contextId 已落 localStorage，
//    restoreSession() 会自己把 team 取回来——只需要重新注入 snippet，不需要再跑 injectSeeds。
await page.reload({ waitUntil: 'networkidle' })
await dismissOnboard(page, { onboardWait: 600 }) // 防御性调用：`.lite-onboard` 不存在时是 no-op
await reinjectSnippet(page)

{
  const out = await page.evaluate((b) => window.__seedGate.assertFollowupsPersist(b), before)
  rec('followupsPersist', !!out.pass, out.pass ? '' : JSON.stringify({ missing: out.missing }).slice(0, 200))
}

// ── C 组：gaps（team 已由 reload 后的 restoreSession() 自动摆回来，坑① 对 C 组同样满足）──
{
  const out = await page.evaluate(() => window.__seedGate.assertGapsDerive())
  rec('gapsDerive', !!out.pass, out.pass ? '' : JSON.stringify(out).slice(0, 200))
}
{
  const out = await page.evaluate(() => window.__seedGate.assertGapsResolve())
  rec('gapsResolve', !!out.pass, out.pass ? '' : JSON.stringify(out).slice(0, 200))
}
{
  const out = await page.evaluate(() => window.__seedGate.assertGapsToAsk())
  rec('gapsToAsk', !!out.pass, out.pass ? '' : JSON.stringify(out).slice(0, 200))
}
// ── #63（merge-closerlook）· 第 4 判据：gap 通知的落点接线 ─────────────────────
// NOTIF_TARGET['gap'] 从退休的 closerlook 改指 home。判据落在**真部件**上：点铃铛里那条
// 真实的 gap 通知（本轮 injectSeeds 的矛盾语料在 ingest 时就推过一条），断言壳落在
// data-scene='home' 且差距摘要块在场——不读 store 的映射表。接错线（比如指到 'files'）
// 或接线整个失灵（点了不动，留在出发屏 team）都直接红。
{
  const out = await page.evaluate(() => window.__seedGate.assertGapNotifRoute())
  rec('gapNotifRoute', !!out.pass, out.pass ? '' : JSON.stringify(out).slice(0, 200))
}

await finish(gateRec, { browser, label: 'B/C 组判定：triage/followups + gaps' })
