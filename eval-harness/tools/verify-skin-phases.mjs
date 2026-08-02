// 皮相位 E 组跑器（cr-align 棒2 · 2026-07-21 固化为工具——此前是 live-frontend-gate.md
// 手册协议：三 URL 注入 snippet 手工调相位）。
//
// 跑什么：scripts/gates/live-frontend-gate.snippet.js 的 E 组——
//   aurora URL → readSkinProbe() → assertAuroraApplied()（12 项计算值正断言，
//     字面量来源 specs/cr-align-spec.json，spec→门→码）
//   paper URL → readSkinProbe() → assertPaperUnchanged()（对 PAPER_BASELINE 逐字节 diff）
//   v01 + story URL → readLeakProbe() → assertSkinNoLeak()（皮规则零外泄，
//     =「00-base 未被动过」的持续证明）
//
// 两种世界：棒2 改字面量后对棒1 旧构建跑 → aurora 组红（topbar 无玻璃/活动 tab 还是 navy）；
// 棒2 构建 → 全绿。URL 与 feff6be 基线采集时逐字一致（不带 lang 参数）。
//
//   VERIFY_BASE=http://localhost:5173 node eval-harness/tools/verify-skin-phases.mjs
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
// 迁自票 #16：boot/上报/收尾管线搬进 lib/gate-run.mjs，断言判据一字未改。
// 本门是分歧台账里的模式⑤(a)——一个 browser 反复开新 context/page；
// 且是台账分歧④的"不装 pageerror"那一类（trackPageErrors 留默认 false）。
import { bootPage, makeRec, finish } from './lib/gate-run.mjs'

const UI = process.env.VERIFY_BASE || 'http://localhost:5173'
const HERE = dirname(fileURLToPath(import.meta.url))
const SNIPPET = readFileSync(join(HERE, '..', '..', 'scripts', 'gates', 'live-frontend-gate.snippet.js'), 'utf8')

const gateRec = makeRec()
const rec = gateRec.rec

// 首次调用不传 browser：bootPage 内部新 launch 一个，之后每次调用把它传回去复用
// （原写法是外层先 launch 一次、loadWithSnippet 只开 newContext——行为等价）。
let sharedBrowser

async function loadWithSnippet(url) {
  const { browser, page } = await bootPage({ browser: sharedBrowser, url, onboardWait: 500 })
  sharedBrowser = browser
  await page.addScriptTag({ content: SNIPPET })
  await page.evaluate(() => window.__seedGate.defuseAnimations())
  return page
}

// aurora
{
  const page = await loadWithSnippet(`${UI}/?v=2&mode=live&transport=stub&look=aurora`)
  const out = await page.evaluate(async () => {
    const probe = await window.__seedGate.readSkinProbe()
    return window.__seedGate.assertAuroraApplied(probe)
  })
  for (const [k, v] of Object.entries(out.checks)) rec(`aurora·${k}`, !!v)
  await page.context().close()
}

// paper
{
  const page = await loadWithSnippet(`${UI}/?v=2&mode=live&transport=stub&look=paper`)
  const out = await page.evaluate(async () => {
    const probe = await window.__seedGate.readSkinProbe()
    return window.__seedGate.assertPaperUnchanged(probe)
  })
  rec('paper·baseline 逐字节一致', out.pass, out.pass ? '' : JSON.stringify(out.diffs).slice(0, 200))
  await page.context().close()
}

// leak（v01 + story）
{
  const pv1 = await loadWithSnippet(`${UI}/?v=1&mode=live`)
  const d = await pv1.evaluate(() => window.__seedGate.readLeakProbe())
  await pv1.context().close()
  const ps = await loadWithSnippet(`${UI}/?mode=story`)
  const s = await ps.evaluate(() => window.__seedGate.readLeakProbe())
  const out = await ps.evaluate(({ d, s }) => window.__seedGate.assertSkinNoLeak(d, s), { d, s })
  rec('skinNoLeak·v01', out.defaultOk, JSON.stringify(d))
  rec('skinNoLeak·story', out.storyOk, JSON.stringify(s))
  await ps.context().close()
}

await finish(gateRec, { browser: sharedBrowser, label: '皮相位 E 组' })
