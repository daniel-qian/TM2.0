// UI 缺陷扫雷（cr-align 视觉战役棒0 · 2026-07-21）。
//
// ## 为什么有这个
// Danny 2026-07-21 生产实测肉眼逮到两处 UI bug（顶栏压标题 / 裸默认按钮），并明说
// 「应该还有我没有发现的」。逐个肉眼找不是办法——这里按**缺陷类**机械扫描全矩阵：
// 9 屏 × 2 皮 × (空世界 1440 + 满世界 1440/872/375)。检测器见 lib/ui-detectors.mjs
// （D1 遮压 / D2 默认控件 / D3 横向溢出 / D4 AA 对比度 / D5 隐形截字压埋 /
//  D6 热区·focus·坏图）。872×900 贴着 860 断点上沿——fixed 胶囊模式下横向最挤的世界。
//
// ## 定位：发现工具，不是拦截门（但自检是硬门）
// 正式扫雷永远 exit 0（除 harness 崩溃/自检失败/毕业类违规）：发现件进台账人工 triage。
// `--selftest`：对每类检测器注入一个已知故障，任何一类哑火即 exit 1——
// 检测不到已知故障的扫雷器 = 无声的零，这是发现工具自己的「两种世界」纪律。
// 毕业机制：某类连续多轮全矩阵零 open 后，用 SWEEP_GATE_CLASSES=cls1,cls2 把它变硬门
// （该类任何非豁免发现件 → exit 1），加进电池跑批清单。
//
// ## 台账（tracked）与产物（gitignored）
//   eval-harness/tools/ui-sweep-triage.json   指纹 → {status: open|fixed|wontfix|false-positive}
//     NEW 自动以 open 记入；人工 triage 后改状态；fixed 复燃打 REGRESSION 大声报。
//   eval-harness/reports/ui-sweep/<ts>.json + latest.md   本轮完整发现件与人读摘要。
//   指纹 = sha1(cls|screen|look|vp桶|归一化selector) 前 16 位——selector 已去 nth/动态位，
//   数据变化不换指纹。
//
// ## 怎么跑（与门电池同前置：mock 后端 8137 + vite preview 5173）
//   VERIFY_BASE=http://localhost:5173 node eval-harness/tools/sweep-ui-defects.mjs
//   VERIFY_BASE=... node eval-harness/tools/sweep-ui-defects.mjs --selftest
import { chromium } from 'playwright'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { DETECTOR_BUNDLE, SELFTEST_INJECT, SELFTEST_EXPECT } from './lib/ui-detectors.mjs'

const UI = process.env.VERIFY_BASE || 'http://localhost:5173'
const SELFTEST = process.argv.includes('--selftest')
const GATE_CLASSES = (process.env.SWEEP_GATE_CLASSES || '').split(',').map((s) => s.trim()).filter(Boolean)

const HERE = dirname(fileURLToPath(import.meta.url))
const TRIAGE_PATH = join(HERE, 'ui-sweep-triage.json')
const REPORT_DIR = join(HERE, '..', 'reports', 'ui-sweep')

// files-hub-0729/01 · 'files' 追加在末尾：这个数组是「哪些屏会被采样」的唯一名单，
// 漏掉一屏不会红、只会**永远不采样它**（假绿）。资料库屏是 t.upload.* 那 38 个键在
// 07-29 之后唯一的落屏点（上传面板已从团队屏撤走），漏了等于整族文案无人扫。
// #63（merge-closerlook）· 'closerlook' 出列：屏已退休，对照卡并进 home 的差距摘要块。
const V2_SCREENS = ['home', 'team', 'projects', 'room', 'followups', 'notes', 'playbooks', 'vision', 'files']
const LOOKS = ['aurora', 'paper']
const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900, focusProbe: true },
  { name: 'mid', width: 872, height: 900, focusProbe: false }, // 贴 860 断点上沿：fixed 模式最挤
  { name: 'mobile', width: 375, height: 812, focusProbe: false }, // sticky 分支 + 溢出重点
]

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

const fp = (f, screen, look, vpName, world) =>
  createHash('sha1').update([f.cls, screen, look, vpName, f.selector].join('|')).digest('hex').slice(0, 16)
// 世界（空/满）刻意不进指纹：同一处缺陷在两个世界重复出现算一件事

async function escapeOnboard(page) {
  if (await page.locator('.lite-onboard').count()) {
    await page.keyboard.press('Escape')
    await page.waitForTimeout(600)
  }
}

async function seed(page) {
  await page.evaluate(async (doc) => {
    const enc = new TextEncoder()
    const f = new File([enc.encode(doc)], 'w33-weekly.md', { type: 'text/markdown' })
    await window.__lite2Store.getState().uploadFiles([f])
  }, SEED_DOC)
  await page.waitForFunction(
    () => ['ready', 'error'].includes(window.__lite2Store.getState().ingestStatus),
    undefined, { timeout: 30000 },
  )
  await page.evaluate(() => {
    const st = window.__lite2Store.getState()
    st.goScreen('room')
    st.askLive({ situation: '这周谁的项目最需要我搭把手？' })
  })
  await page.waitForFunction(
    () => ['complete', 'error'].includes(window.__lite2Store.getState().run.status),
    undefined, { timeout: 30000 },
  ).catch(() => {})
  await page.evaluate(() => window.__lite2Store.getState().refreshNotes?.())
  await page.waitForTimeout(400)
}

async function collect(page, { screen, look, vpName, world, focusProbe }, all) {
  await page.evaluate((s) => window.__lite2Store.getState().goScreen(s), screen)
  await page.waitForTimeout(350)
  // DETECTOR_BUNDLE 是函数表达式字符串——字符串求值不吃 evaluate 的 arg，参数要内联
  const found = await page.evaluate(`(${DETECTOR_BUNDLE})(${JSON.stringify({ focusProbe })})`)
  for (const f of found) {
    all.push({ ...f, screen, look, viewport: vpName, world, fingerprint: fp(f, screen, look, vpName, world) })
  }
}

// ── selftest：注入已知故障，每类检测器必须响 ─────────────────────────────────────
if (SELFTEST) {
  const browser = await chromium.launch({ headless: true })
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
  await page.goto(`${UI}/?v=2&mode=live&look=aurora&lang=zh`, { waitUntil: 'networkidle' })
  await escapeOnboard(page)
  await page.evaluate((s) => window.__lite2Store.getState().goScreen(s), 'home')
  await page.waitForTimeout(350)

  const before = await page.evaluate(`(${DETECTOR_BUNDLE})({"focusProbe":true})`)
  const countBy = (arr) => arr.reduce((m, f) => ((m[f.cls] = (m[f.cls] || 0) + 1), m), {})
  const b = countBy(before)
  await page.evaluate(SELFTEST_INJECT)
  await page.waitForTimeout(400) // 坏图要等 load 失败落定
  const after = await page.evaluate(`(${DETECTOR_BUNDLE})({"focusProbe":true})`)
  const a = countBy(after)

  let fail = 0
  for (const cls of SELFTEST_EXPECT) {
    const fired = (a[cls] || 0) > (b[cls] || 0)
    console.log(`  [${fired ? 'PASS' : 'FAIL'}] selftest·${cls} 注入故障后新增发现（${b[cls] || 0} → ${a[cls] || 0}）`)
    if (!fired) fail++
  }
  await browser.close()
  console.log(`\n═══ 扫雷自检：${SELFTEST_EXPECT.length - fail} PASS · ${fail} FAIL ═══`)
  process.exit(fail ? 1 : 0)
}

// ── 正式扫雷 ────────────────────────────────────────────────────────────────────
const browser = await chromium.launch({ headless: true })
const all = []

for (const look of LOOKS) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(e.message))
  console.log(`\n═══ ${look} ═══`)

  await page.goto(`${UI}/?v=2&mode=live&look=${look}&lang=zh`, { waitUntil: 'networkidle' })
  await escapeOnboard(page)

  // 空世界（合伙人当初实测的世界；空态也要扫）
  for (const screen of V2_SCREENS) {
    await collect(page, { screen, look, vpName: 'desktop', world: 'empty', focusProbe: false }, all)
  }
  console.log(`  空世界 9 屏扫毕（累计 ${all.length} 件）`)

  // 满世界 × 3 视口
  await seed(page)
  for (const vp of VIEWPORTS) {
    await page.setViewportSize({ width: vp.width, height: vp.height })
    await page.waitForTimeout(250)
    for (const screen of V2_SCREENS) {
      await collect(page, { screen, look, vpName: vp.name, world: 'populated', focusProbe: vp.focusProbe }, all)
    }
    console.log(`  满世界 ${vp.name}(${vp.width}×${vp.height}) 9 屏扫毕（累计 ${all.length} 件）`)
  }

  if (pageErrors.length) console.log(`  ⚠️ pageerror ${pageErrors.length} 条: ${pageErrors[0]}`)
  await ctx.close()
}
await browser.close()

// ── 与台账合流 ─────────────────────────────────────────────────────────────────
let triage = {}
try { triage = JSON.parse(readFileSync(TRIAGE_PATH, 'utf8')) } catch { /* 首轮无台账 */ }

const byFp = new Map()
for (const f of all) if (!byFp.has(f.fingerprint)) byFp.set(f.fingerprint, f)

const buckets = { NEW: [], 'KNOWN-OPEN': [], SUPPRESSED: [], REGRESSION: [] }
const today = new Date().toISOString().slice(0, 10)
for (const [id, f] of byFp) {
  const t = triage[id]
  if (!t) {
    buckets.NEW.push(f)
    triage[id] = { status: 'open', cls: f.cls, screen: f.screen, look: f.look, viewport: f.viewport, selector: f.selector, first_seen: today, note: '' }
  } else if (t.status === 'open') buckets['KNOWN-OPEN'].push(f)
  else if (t.status === 'fixed') { buckets.REGRESSION.push(f); }
  else buckets.SUPPRESSED.push(f)
}
// 台账里 open 但本轮没再出现的：可能已被修好，提示人工确认后改 fixed
const notSeen = Object.entries(triage).filter(([id, t]) => t.status === 'open' && !byFp.has(id))

writeFileSync(TRIAGE_PATH, JSON.stringify(triage, null, 2) + '\n')
mkdirSync(REPORT_DIR, { recursive: true })
const ts = new Date().toISOString().replace(/[:.]/g, '-')
writeFileSync(join(REPORT_DIR, `${ts}.json`), JSON.stringify({ ts, base: UI, findings: all }, null, 2))

const lines = [`# UI 扫雷 · ${ts}`, '', `全矩阵发现 ${all.length} 件 / 去重 ${byFp.size} 指纹`, '']
for (const [bucket, items] of Object.entries(buckets)) {
  lines.push(`## ${bucket}（${items.length}）`, '')
  for (const f of items) {
    lines.push(`- \`${f.fingerprint}\` [${f.cls}/${f.severity}] ${f.look}·${f.screen}·${f.viewport}·${f.world} — \`${f.selector}\` ${f.text ? `「${f.text}」` : ''} ${JSON.stringify(f.detail)}`)
  }
  lines.push('')
}
if (notSeen.length) {
  lines.push(`## 台账 open 但本轮未现（人工确认后改 fixed）（${notSeen.length}）`, '')
  for (const [id, t] of notSeen) lines.push(`- \`${id}\` [${t.cls}] ${t.look}·${t.screen} — \`${t.selector}\``)
}
writeFileSync(join(REPORT_DIR, 'latest.md'), lines.join('\n'))

console.log(`\n═══ 扫雷：${all.length} 件 / ${byFp.size} 指纹 · NEW ${buckets.NEW.length} · KNOWN-OPEN ${buckets['KNOWN-OPEN'].length} · SUPPRESSED ${buckets.SUPPRESSED.length} · REGRESSION ${buckets.REGRESSION.length} ═══`)
for (const f of buckets.NEW.slice(0, 40)) {
  console.log(`  NEW ${f.fingerprint} [${f.cls}/${f.severity}] ${f.look}·${f.screen}·${f.viewport} ${f.selector} ${f.text ? `「${f.text}」` : ''}`)
}
if (buckets.REGRESSION.length) {
  console.log('  🔴 REGRESSION（已修复的又回来了）：')
  for (const f of buckets.REGRESSION) console.log(`    ${f.fingerprint} [${f.cls}] ${f.look}·${f.screen} ${f.selector}`)
}
console.log(`  报告：eval-harness/reports/ui-sweep/latest.md`)

// 毕业类硬门：被点名的类出现非豁免发现 → exit 1
if (GATE_CLASSES.length) {
  const violations = [...byFp.values()].filter((f) => GATE_CLASSES.includes(f.cls) && triage[f.fingerprint]?.status === 'open')
  if (violations.length) {
    console.log(`\n🔴 毕业类违规（${GATE_CLASSES.join(',')}）：${violations.length} 件 → exit 1`)
    process.exit(1)
  }
}
process.exit(0)
