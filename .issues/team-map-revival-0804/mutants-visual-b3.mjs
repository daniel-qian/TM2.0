// team-map-revival-0804（#106 B3）· `/map` 像素基线的 born-red —— **逐态 × 逐视口**。
//
// ## 为什么不能只打一发
// 「基线冻好了」和「基线有牙」是两回事：一张永远拍不到那个部件的图，永远不会红。
// 而 `toHaveScreenshot` **首处不匹配即中止**，所以一发把三态全打红的变异只能证明第一张有牙
// ——后两张根本没被比对过（memory:「恰好如预期的红最该翻日志」，新 worktree 里 visual 门
// 曾经是 40 张「没有基线」，一张都没比对）。
//
// 所以三发各打一态，且每发都要求**桌面与手机各红一张**（memory:「桌面红≠手机红」）：
//   V1 动空态引导卡  → 只有 empty 那张红（calm/focus 还没轮到）
//   V2 动 HUD 的 chip → empty 绿、calm 红
//   V3 动连线线宽    → empty/calm 绿、focus 红
// 三发合起来才证明「12 张都在比对，且各自盯着自己那一态」。
//
// 跑法（后端 + preview 起着，基线已冻）：
//   VERIFY_BASE=http://127.0.0.1:5183 API_BASE=http://127.0.0.1:8147 \
//     node .issues/team-map-revival-0804/mutants-visual-b3.mjs
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync, spawnSync } from 'node:child_process'

const VERIFY_BASE = process.env.VERIFY_BASE || 'http://127.0.0.1:5183'
const API_BASE = process.env.API_BASE || 'http://127.0.0.1:8147'
const CSS = 'src/lite2/styles/lite2.css'

const MUTANTS = [
  {
    name: 'V1-empty-state',
    why: '空态引导卡不再居中',
    // ⚠ 第一版加的是 `padding-top: 60px`，**零像素变化**——因为这一段末尾那句
    // `padding: 24px` 简写排在后面，把它整个盖掉了。那一发看起来和「基线没牙」一模一样。
    // 变异要落在**没有人在后面覆盖它**的属性上。
    find: `.lite2-shell .lite-map-empty {
  flex: 1 1 auto;
  display: flex;
  align-items: center;`,
    to: `.lite2-shell .lite-map-empty {
  flex: 1 1 auto;
  display: flex;
  align-items: flex-start;`,
    red: ['map-empty-desktop', 'map-empty-mobile'],
    green: ['map-calm', 'map-focus'],
  },
  {
    name: 'V2-hud-chip',
    why: 'HUD 的部门 chip 变宽（B3 新做的那一层）',
    find: `.lite2-shell .lite-map-chip {
  flex: none;`,
    to: `.lite2-shell .lite-map-chip {
  letter-spacing: 3px;
  flex: none;`,
    red: ['map-calm-desktop', 'map-calm-mobile'],
    green: ['map-empty', 'map-focus'],
  },
  {
    name: 'V3-focus-dim',
    why: '被压暗的那一片不再压暗（focus 态独有的一整面）',
    find: `.lite2-shell .lite-map-world.is-focused .lite-map-person.is-dimmed,
.lite2-shell .lite-map-world.is-focused .lite-map-project.is-dimmed {
  opacity: 0.28;`,
    to: `.lite2-shell .lite-map-world.is-focused .lite-map-person.is-dimmed,
.lite2-shell .lite-map-world.is-focused .lite-map-project.is-dimmed {
  opacity: 0.92;`,
    red: ['map-focus-desktop', 'map-focus-mobile'],
    green: ['map-empty', 'map-calm'],
  },
  {
    name: 'V4-focus-edge',
    why: '连线加粗',
    // 🔴 **只指望桌面那张红**，如实写进预判。手机上 focus 帧为了把「人 + 他的项目」两头
    // 都塞进 375px，镜头缩到 0.30，连线随 world 一起缩（刻意没用 non-scaling-stroke），
    // 2.5→9 折算到屏幕上是 0.75px→2.7px、长度又只有一小截，整张图的差异吃不满 maxDiffPixels。
    // 也就是说**手机那张对线宽没有分辨力**——写成「两个视口都该红」就是拿一发变异当两发用。
    // 连线在手机 focus 帧里的在场由 spec 自己的 `.lite-map-edge` 自证判据守（不是像素守）。
    find: `  stroke-width: 2.5;`,
    to: `  stroke-width: 9;`,
    red: ['map-focus-desktop'],
    green: ['map-empty', 'map-calm'],
  },
]

function build() {
  execFileSync('npx', ['vite', 'build', '--mode', 'development'], {
    env: { ...process.env, VITE_AVERY_API_BASE: API_BASE },
    stdio: 'ignore',
    shell: true,
  })
}

/** 跑像素 spec，返回**哪几张**没对上（从 `-actual.png` 的名字里捞，那是唯一可靠的落点）。 */
function runVisual() {
  const out = spawnSync(
    'node',
    ['node_modules/playwright/cli.js', 'test', '-c', 'eval-harness/visual', 'visual-map.spec.mjs'],
    { env: { ...process.env, VERIFY_BASE }, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
  )
  const text = `${out.stdout || ''}${out.stderr || ''}`
  const shots = [...text.matchAll(/([a-z]+-map-[a-z]+-[a-z]+)-actual\.png/g)].map((m) => m[1])
  return { shots: [...new Set(shots)], passed: /(\d+) passed/.test(text) && !/failed/.test(text) }
}

// 🔴 还原基准 = 跑器自己的起点（不是 git HEAD：这一整摊本来就没提交，比 HEAD 恒为脏）。
const origin = readFileSync(CSS)

console.log('基线（未变异）先跑一遍……')
build()
const base = runVisual()
if (!base.passed) {
  console.log('🔴 基线就不干净：', base.shots.join(' | '))
  process.exit(1)
}
console.log('  12 张全对上 ✓\n')

const report = []
for (const m of MUTANTS) {
  const text = origin.toString('utf8')
  const variants = [m, { find: m.find.replace(/\n/g, '\r\n'), to: m.to.replace(/\n/g, '\r\n') }]
  const use = variants.find((v) => text.split(v.find).length - 1 === 1)
  if (!use) {
    console.log(`🔴 ${m.name}: 锚点没命中恰好 1 处 —— 这不是「变异存活」，是没改到`)
    report.push({ name: m.name, ok: false })
    continue
  }
  writeFileSync(CSS, text.replace(use.find, use.to), 'utf8')
  let res
  try {
    build()
    res = runVisual()
  } finally {
    writeFileSync(CSS, origin)
  }
  // 🔴 预判写的是**逐张**（`<态>-<视口>`），不是「这一态该红」——「桌面红」推不出「手机红」。
  const wantRed = m.red
  const gotRed = wantRed.filter((n) => res.shots.some((s) => s.endsWith(n)))
  const leaked = res.shots.filter((s) => m.green.some((g) => s.includes(g)))
  const ok = gotRed.length === wantRed.length && leaked.length === 0
  report.push({ name: m.name, ok })
  console.log(
    `${ok ? '✓' : '🔴'} ${m.name} · ${m.why}` +
      `\n    本该红（逐视口）: ${wantRed.join(' | ')}` +
      `\n    实际红: ${res.shots.join(' | ') || '（一张都没红）'}` +
      (leaked.length ? `\n    🔴 不该红的也红了: ${leaked.join(' | ')}` : ''),
  )
}

build()
const dirty = !readFileSync(CSS).equals(origin)
console.log(`\n还原自查（逐字节比跑器起点）：${dirty ? '🔴 CSS 没回去' : '（每个字节都回去了）'}`)
const bad = report.filter((r) => !r.ok)
console.log(`\n${report.length - bad.length} 发如预期 · ${bad.length} 发不符`)
if (bad.length || dirty) process.exitCode = 1
