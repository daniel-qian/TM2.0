// born-red 台架 · #107 B4 部门收拢态。每条 J 判据各撞一次。
//
//   前置：后端四件套 + 前端 build+preview（dist 要 bake 到那条后端），然后
//   VERIFY_BASE=http://localhost:5193 API_BASE=http://127.0.0.1:8157 \
//     node .issues/team-map-revival-0804/mutants-b4.mjs
//
// 纪律（照抄 mutants-b3 / mutants-determinism 的账）：
//   · 还原用**字节快照**，不跟 git HEAD 比（工作区本来就是脏的，那种比法是恒真警报）。
//   · 锚点 LF/CRLF 两种都试，且必须**恰好命中一处**——命中 0 处长得跟「变异存活」一模一样。
//   · 每条主判据配**专属**变异：一发同时红两条，不等于另一条也有自己的牙。
//   · 每发变异都要**重打 dist**：门跑的是 preview 里那份产物，不重打等于对着旧代码跑，
//     九发全绿而且看不出哪里不对（本仓 dist 指向/调包那一族的老坑）。
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const LAYOUT = 'src/lite2/map/mapLayout.ts'
const SCREEN = 'src/lite2/map/MapScreen.tsx'
const NODES = 'src/lite2/map/MapNodes.tsx'
const PANZOOM = 'src/lite2/map/MapPanZoom.tsx'
const API_BASE = process.env.API_BASE || 'http://127.0.0.1:8157'

const MUTANTS = [
  {
    id: 'N01', file: LAYOUT, expect: ['J1'],
    why: '阈值抬到 400 ⇒ 80 人也不收拢。J1「人一多就换成部门是节点」必须红',
    from: 'export const COLLAPSE_MIN_PEOPLE = 40',
    to: 'export const COLLAPSE_MIN_PEOPLE = 400',
  },
  {
    id: 'N02', file: SCREEN, expect: ['J1'],
    why: 'J1「一个人位都不铺」的专属变异：人员层改回遍历全部分区（收拢的也铺）。这正是 B4 第一刀留下的那个坑',
    from: '{visibleZones.map((zone) =>',
    to: '{layout.zones.map((zone) =>',
  },
  {
    id: 'N03', file: NODES, expect: ['J1'],
    why: 'J1「收拢卡是真按钮」的专属变异：永远渲染成 div ⇒ 键盘与读屏拿不到展开这个动作',
    from: '  if (zone.isCollapsed && onSelect) {',
    to: '  if (false && zone.isCollapsed && onSelect) {',
  },
  {
    id: 'N04', file: SCREEN, expect: ['J2'],
    why: 'J2 的专属变异：把无 owner / owner 不在花名册上的项目也摊进某个部门（缺了就编）',
    from: '      if (!zoneKey) continue\n      tally.set(zoneKey, (tally.get(zoneKey) ?? 0) + 1)',
    to: '      const k = zoneKey ?? layout.zones[0]?.key\n      if (!k) continue\n      tally.set(k, (tally.get(k) ?? 0) + 1)',
  },
  {
    id: 'N05', file: NODES, expect: ['J2'],
    why: '角标改印**人数**（票面原话要的就是它，而它是一张部门人数排行榜）。⚠ 预期红的是 **J2 不是 J3**：J3 把角标整块摘掉再扫数字，看不见角标里印的是什么——这一发正是把 J3 的真实射程量出来的那一发，名字已按实测改成「角标之外」',
    from: '            {alertCount}\n          </span>',
    to: '            {zone.members.length}\n          </span>',
  },
  {
    id: 'N06', file: SCREEN, expect: ['J4'],
    why: 'J4 的专属变异：把 unknown（资料没写状态）也当完结折掉——替文档下了它没下的结论',
    from: "return projects.filter((p) => statusKeyOf(p.statusRaw) !== 'done' || p.id === pinned)",
    to: "return projects.filter((p) => (statusKeyOf(p.statusRaw) !== 'done' && statusKeyOf(p.statusRaw) !== 'unknown') || p.id === pinned)",
  },
  {
    id: 'N07', file: SCREEN, expect: ['J5'],
    why: 'J5 的专属变异：点了部门但 layout 不认展开键 ⇒ 卡片亮了却不铺人（"点了没反应"那一族）',
    from: "  const expandedZoneKey = target?.kind === 'zone' ? target.id : null",
    to: '  const expandedZoneKey = null',
  },
  {
    id: 'N08', file: PANZOOM, expect: ['J6'],
    why: 'J6 的专属变异：开局帧忽略火情，照旧 fit-width ⇒ 着火的部门不一定在画面里',
    from: '    if (!rect || rect.width <= 0 || rect.height <= 0) {',
    to: '    if (true || !rect || rect.width <= 0 || rect.height <= 0) {',
  },
  {
    id: 'N09', file: PANZOOM, expect: ['J6'],
    why: 'J6「守可读地板」那一条的专属变异：拿掉地板 ⇒ 为了把火情全装进来把卡缩成指甲盖（手机上首版就是这么塌的）',
    from: 'const scale = Math.max(MIN_SCALE, Math.min(MAX_FIT_SCALE, Math.max(MIN_FIT_SCALE, raw)))',
    to: 'const scale = Math.max(MIN_SCALE, Math.min(MAX_FIT_SCALE, raw))',
  },
]

const snapshot = new Map()
for (const f of new Set(MUTANTS.map((m) => m.file))) snapshot.set(f, readFileSync(join(ROOT, f)))

function applyOnce(file, from, to) {
  const p = join(ROOT, file)
  const src = readFileSync(p, 'utf8')
  for (const [f, t] of [[from, to], [from.replace(/\n/g, '\r\n'), to.replace(/\n/g, '\r\n')]]) {
    const hits = src.split(f).length - 1
    if (hits === 1) { writeFileSync(p, src.split(f).join(t)); return }
    if (hits > 1) throw new Error(`锚点命中 ${hits} 处（要恰好 1 处）: ${file} :: ${f.slice(0, 50)}`)
  }
  throw new Error(`锚点一处都没命中（LF/CRLF 都试过）: ${file} :: ${from.slice(0, 50)}`)
}

function buildAndRun() {
  try {
    execFileSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--mode', 'development'], {
      cwd: ROOT, env: { ...process.env, VITE_AVERY_API_BASE: API_BASE }, stdio: 'ignore',
    })
  } catch (e) {
    return { built: false, red: [], tail: '构建失败：' + String(e).slice(0, 300) }
  }
  let out = ''
  try {
    out = execFileSync(process.execPath, ['eval-harness/tools/verify-team-map.mjs'], {
      cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (e) {
    out = `${e.stdout || ''}${e.stderr || ''}`
  }
  // 门自己印的格式（不是第三方 reporter 的散文）：`  [FAIL] J1 ...`
  const red = [...new Set([...out.matchAll(/\[FAIL\]\s+(\w+)/g)].map((m) => m[1]))]
  const ran = /\d+ PASS · \d+ FAIL/.test(out)
  return { built: true, ran, red, tail: out.trim().split('\n').slice(-6).join('\n') }
}

console.log('【基线】不动任何东西先跑一轮 —— 必须 0 FAIL，否则台架没有分辨力\n')
const base = buildAndRun()
if (!base.ran || base.red.length) {
  console.log(`❌ 基线就不干净：red=${base.red.join(',') || '(没跑起来)'}\n${base.tail}`)
  process.exitCode = 1
} else {
  console.log('✅ 基线全绿\n')
}

let mismatch = 0
for (const m of MUTANTS) {
  try {
    applyOnce(m.file, m.from, m.to)
    const { ran, red, tail } = buildAndRun()
    const missing = m.expect.filter((c) => !red.some((r) => r.startsWith(c)))
    const ok = ran && missing.length === 0
    if (!ok) mismatch += 1
    console.log(`${ok ? '✅' : '❌'} ${m.id} ${m.file.split('/').pop()}`)
    console.log(`   ${m.why}`)
    console.log(`   预期红: ${m.expect.join(' + ')}   实际红: ${red.join(' ') || '（一条都没红）'}${ran ? '' : '  ⚠ 门没跑完'}`)
    if (!ok) console.log(tail.split('\n').map((l) => '   ' + l).join('\n'))
  } catch (e) {
    mismatch += 1
    console.log(`❌ ${m.id} 台架自己出错: ${e.message}`)
  } finally {
    for (const [f, buf] of snapshot) writeFileSync(join(ROOT, f), buf)
  }
}

let dirty = 0
for (const [f, buf] of snapshot) {
  if (!readFileSync(join(ROOT, f)).equals(buf)) { console.log(`🔴 还原没干净: ${f}`); dirty += 1 }
}
// 还原之后把 dist 打回干净版，别给下一个人留一份带变异的产物。
execFileSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--mode', 'development'], {
  cwd: ROOT, env: { ...process.env, VITE_AVERY_API_BASE: API_BASE }, stdio: 'ignore',
})
console.log(`\n【收】变异 ${MUTANTS.length} 发 · 不符预期 ${mismatch} 发 · 还原脏 ${dirty} 个文件（dist 已打回干净版）`)
if (mismatch || dirty) process.exitCode = 1
