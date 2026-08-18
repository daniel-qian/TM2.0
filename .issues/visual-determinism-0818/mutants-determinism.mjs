// born-red 台架：把 visual-determinism.spec.mjs 的每条判据各撞一次（2026-08-18）。
//
// 为什么非有不可：这三条判据存在的**唯一**理由，是替换掉一句烂了两个月都没人发现的
// 现在时注释。一条自己不会红的判据，跟那句注释是同一种东西——只是长得更像工程。
//
//   node .issues/visual-determinism-0818/mutants-determinism.mjs
//
// 纪律（照抄 mutants-b3.mjs 的教训）：
//   · 还原用**字节快照**，不跟 git HEAD 比（工作区本来就是脏的，那种比法是恒真警报）。
//   · 锚点 LF/CRLF 两种都试，且必须**恰好命中一处**——命中 0 处长得跟「变异存活」一模一样。
//   · 每条判据配**专属**变异：一发变异同时红两条，不等于另一条也有自己的牙。
//   · 变异跑完再逐字节验一遍还原，别只看「测试又绿了」。
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const CONFIG = 'eval-harness/visual/playwright.config.mjs'
const SPEC = 'eval-harness/visual/visual-determinism.spec.mjs'
const VISUAL = 'eval-harness/visual/visual.spec.mjs'

/** 三条判据的 test 标题（--grep 用，也是「谁红了」的判读依据）。 */
const C1 = '确定性开关真的落到了浏览器上'
const C2 = '配置里没有 playwright 会静默丢掉的 use 键'
const C3 = '没有别的 spec 自己建 context 绕开这份配置'

const MUTANTS = [
  // ── 判据①：开关真的落到浏览器上 ────────────────────────────────────────
  {
    id: 'M01', file: CONFIG, expect: [C1, C2],
    why: '把 reducedMotion 挪回 use 顶层 = 本票修的那个 bug 本身。①（浏览器读不到）与②（键被丢）应当同时红',
    from: `    contextOptions: { reducedMotion: 'reduce' },`,
    to: `    reducedMotion: 'reduce',`,
  },
  {
    id: 'M02', file: CONFIG, expect: [C1],
    why: '①的专属变异：2x 采样。整批基线尺寸会翻倍，而这件事此前没有任何判据看着',
    from: `    deviceScaleFactor: 1,`,
    to: `    deviceScaleFactor: 2,`,
  },
  {
    id: 'M03', file: CONFIG, expect: [C1],
    why: '①的专属变异：locale 换成英文。字体回退与换行会变，整批文字位置漂',
    from: `    locale: 'zh-CN',`,
    to: `    locale: 'en-US',`,
  },
  {
    id: 'M04', file: CONFIG, expect: [C1],
    why: '①的专属变异：时区换 UTC。带墙钟文案的基线会差八小时',
    from: `    timezoneId: 'Asia/Shanghai',`,
    to: `    timezoneId: 'UTC',`,
  },
  {
    id: 'M05', file: CONFIG, expect: [C1],
    why: '①里视口那一条的专属变异：桌面宽度改 40px。不钉它的话，换个视口重冻没人拦',
    from: `{ name: 'desktop', use: { viewport: { width: 1440, height: 900 } } },`,
    to: `{ name: 'desktop', use: { viewport: { width: 1400, height: 900 } } },`,
  },

  // ── 判据②：playwright 会静默丢掉的 use 键 ─────────────────────────────
  {
    id: 'M06', file: CONFIG, expect: [C2],
    why: '②的专属变异，且验的是**整类 bug 不是 reducedMotion 一个实例**：forcedColors 同样不在白名单里',
    from: `    deviceScaleFactor: 1,`,
    to: `    deviceScaleFactor: 1,\n    forcedColors: 'active',`,
  },
  {
    id: 'M07', file: SPEC, expect: [C2],
    why: '②的空真闸：把推白名单的正则改瞎 ⇒ forwarded 变空集 ⇒ 「每个键都在白名单里」对任何配置都成立。这一发必须红在 size 那道闸上',
    from: `/^\\s{2}(\\w+): \\[\\(\\{ contextOptions \\}, use\\) => use\\(contextOptions\\./gm`,
    to: `/^\\s{2}(\\w+): \\[\\(\\{ ctxOptions \\}, use\\) => use\\(ctxOptions\\./gm`,
  },

  // ── 判据③：没有别的 spec 自己建 context ───────────────────────────────
  {
    id: 'M08', file: VISUAL, expect: [C3],
    why: '③的专属变异：往真 spec 里塞一次手建 context。这正是它要拦的形状——那张基线会脱离本文件的射程且照样绿',
    from: `  test(\`\${look} 九屏基线\`, async ({ page }, testInfo) => {`,
    to: `  test(\`\${look} 九屏基线\`, async ({ page, browser }, testInfo) => {\n    const rogue = await browser.newContext()`,
  },
  {
    id: 'M09', file: SPEC, expect: [C3],
    why: '③的空真闸：把扫描目录指到 __snapshots__ ⇒ 一个 spec 都扫不到 ⇒ 「无人违规」变成空真',
    from: `  const specs = readdirSync(HERE).filter((f) => f.endsWith('.spec.mjs'))`,
    to: `  const specs = readdirSync(join(HERE, '__snapshots__')).filter((f) => f.endsWith('.spec.mjs'))`,
  },
]

// ── 台架 ────────────────────────────────────────────────────────────────
const snapshot = new Map()
for (const f of new Set(MUTANTS.map((m) => m.file))) {
  snapshot.set(f, readFileSync(join(ROOT, f)))
}

/** LF/CRLF 两种写法都试；必须恰好命中一处，否则当场停——命中 0 处长得跟「变异存活」一样。 */
function applyOnce(file, from, to) {
  const p = join(ROOT, file)
  const src = readFileSync(p, 'utf8')
  const variants = [
    [from, to],
    [from.replace(/\n/g, '\r\n'), to.replace(/\n/g, '\r\n')],
  ]
  for (const [f, t] of variants) {
    const hits = src.split(f).length - 1
    if (hits === 1) {
      writeFileSync(p, src.split(f).join(t))
      return
    }
    if (hits > 1) throw new Error(`锚点命中 ${hits} 处（要恰好 1 处）: ${file} :: ${f.slice(0, 60)}`)
  }
  throw new Error(`锚点一处都没命中（LF/CRLF 都试过了）: ${file} :: ${from.slice(0, 60)}`)
}

/**
 * 跑三条判据，回来「哪几条红了」。
 *
 * 🔴 一条判据跑一次，判读用**进程退出码**，不去正则匹配 list reporter 印的那段散文。
 * 首版就是拿正则捞 `✘` 和行首序号的——而 1.61.1 的失败清单两样都不印，于是 9 发变异
 * 明明发发都红了，跑器却一律报「一条都没红」。跑器自己撒谎是本仓记过档的形态之一，
 * 这里换成尺子最短的那种：进程说失败就是失败。
 */
function runOne(criterion) {
  const args = ['node_modules/playwright/cli.js', 'test', '-c', 'eval-harness/visual',
    '--grep', criterion, '--reporter', 'list']
  try {
    const out = execFileSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    return { red: false, ran: /\d+ passed/.test(out), tail: out }
  } catch (e) {
    const out = `${e.stdout || ''}${e.stderr || ''}`
    // 「一条都没跑起来」也会让进程红（配置语法崩、grep 没命中）——那不是判据的牙，要分开报。
    return { red: true, ran: /\d+ (passed|failed)/.test(out), tail: out }
  }
}

function runGate() {
  const red = []
  let crashed = false
  let tail = ''
  for (const c of [C1, C2, C3]) {
    const r = runOne(c)
    if (r.red) red.push(c)
    if (!r.ran) { crashed = true; tail = r.tail }
    if (r.red && !tail) tail = r.tail.trim().split('\n').slice(-8).join('\n')
  }
  return { red, crashed, tail }
}

console.log('【基线】不动任何东西先跑一轮——三条判据必须全绿，否则台架本身没有分辨力')
const base = runGate()
if (base.red.length) {
  console.log(`  ❌ 基线就红了：${base.red.join(' / ')}\n${base.tail}`)
  process.exitCode = 1
} else {
  console.log('  ✅ 基线全绿\n')
}

let mismatch = 0
for (const m of MUTANTS) {
  try {
    applyOnce(m.file, m.from, m.to)
    const { red, crashed, tail } = runGate()
    const missing = m.expect.filter((c) => !red.includes(c))
    const extra = red.filter((c) => !m.expect.includes(c))
    const ok = missing.length === 0 && !crashed
    if (!ok) mismatch++
    console.log(`${ok ? '✅' : '❌'} ${m.id} ${m.file.split('/').pop()}`)
    console.log(`   ${m.why}`)
    console.log(`   预期红: ${m.expect.join(' + ')}`)
    console.log(`   实际红: ${red.length ? red.join(' + ') : '（一条都没红）'}${crashed ? '  ⚠ 疑似崩溃而非判据红' : ''}`)
    if (extra.length) console.log(`   连带红（不算问题，但记下来）: ${extra.join(' + ')}`)
    if (!ok) console.log(`   ---- tail ----\n${tail.split('\n').map((l) => '   ' + l).join('\n')}`)
  } finally {
    for (const [f, buf] of snapshot) writeFileSync(join(ROOT, f), buf)
  }
}

// 还原逐字节复核：别只看「测试又绿了」。
let dirty = 0
for (const [f, buf] of snapshot) {
  if (!readFileSync(join(ROOT, f)).equals(buf)) { console.log(`🔴 还原没干净: ${f}`); dirty++ }
}
console.log(`\n【收】变异 ${MUTANTS.length} 发 · 不符预期 ${mismatch} 发 · 还原脏 ${dirty} 个文件`)
if (mismatch || dirty) process.exitCode = 1
