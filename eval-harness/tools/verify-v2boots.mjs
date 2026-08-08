// v2Boots 相位跑器（#63 · merge-closerlook 固化为工具——此前 assertV2Boots 是
// live-frontend-gate.md 手册协议的一员，**零机械 runner**：LiteTopbar 的 tabs 数组与
// snippet 期望数组不同步时，整个电池没有一道门会红。#63 本身就是一次「tab 数组动了」
// 的手术（9→8），变异判据「tab 数组与门期望不同步要能红」需要一道真的会红的门——
// 就是这道。照 verify-skin-phases.mjs 的适配器模式：读 snippet 现成的 assertV2Boots、
// 读它自己算出来的 pass，门只负责 rec() 上报，不重新判断对错。
//
// 跑什么：scripts/gates/live-frontend-gate.snippet.js 的 assertV2Boots——
//   .lite2-shell 挂载 + tab 主名序列与期望数组逐字相等 + 副小字序列逐字相等
//   （期望数组是 snippet 里的唯一真源；labels 是 EN 字典值，所以 URL 不带 ?lang、
//    吃 resolveLocale() 的 EN 默认——与 snippet 注释口径一致）。
//
// 离线：断言只读顶栏 DOM，不碰 transport（team===null 也照样渲染 tabs）——backend:false。
//
//   VERIFY_BASE=http://localhost:5173 node eval-harness/tools/verify-v2boots.mjs
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { bootPage, makeRec, finish } from './lib/gate-run.mjs'

const UI = process.env.VERIFY_BASE || 'http://localhost:5173'
const HERE = dirname(fileURLToPath(import.meta.url))
const SNIPPET = readFileSync(join(HERE, '..', '..', 'scripts', 'gates', 'live-frontend-gate.snippet.js'), 'utf8')

const gateRec = makeRec()
const rec = gateRec.rec

const { browser, page } = await bootPage({ url: `${UI}/?v=2&mode=live`, onboardWait: 500 })
await page.addScriptTag({ content: SNIPPET })
await page.evaluate(() => window.__seedGate.defuseAnimations())

const out = await page.evaluate(() => window.__seedGate.assertV2Boots())
rec('v2Boots·shell 挂载', !!out.shellPresent)
rec(
  'v2Boots·tab 主名序列与期望数组逐字相等',
  !!out.tabOrderMatches,
  out.tabOrderMatches ? `${out.tabCount} tabs` : `actual=${JSON.stringify(out.tabLabels)}`,
)
rec(
  'v2Boots·副小字序列逐字相等',
  !!out.tabSubsMatch,
  out.tabSubsMatch ? '' : `actual=${JSON.stringify(out.tabSubs)}`,
)

await finish(gateRec, { browser, label: 'v2Boots：顶栏 tab 序列与门期望同步' })
