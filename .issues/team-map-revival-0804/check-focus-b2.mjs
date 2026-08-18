// team-map-revival-0804 · B2 · focus 契约与组级读数的**纯函数**判据（无浏览器、无后端）。
//
// 跑法（仓库根）：`node .issues/team-map-revival-0804/check-focus-b2.mjs`
//
// ⚠ **这不是一道门**，名字里刻意没有 `verify-`——理由同 B1 那两个 check 的文件头：
// 往 `git ls-files "*verify-*.mjs"` 那个自查 glob 里塞不在 ROSTER 的文件，就是再造一批
// 没人裁定过的孤儿门。进 ROSTER 的 `verify-team-map.mjs` 是 **B3** 的活，本文件的判据届时并进去。
//
// 🔴 语料过**真 derive**（`liteTeamFromPayload`）+ **真布局**（`buildMapLayout`），
// 期望值一律写在本文件里或从 payload 独立算出，一个都不问被测函数要
// （尺子不许长在被量的东西上）。
import { readFileSync } from 'node:fs'
import { Buffer } from 'node:buffer'
import { fileURLToPath } from 'node:url'
import esbuild from 'esbuild'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))

const built = await esbuild.build({
  stdin: {
    contents: [
      "export { liteTeamFromPayload } from './src/lite2/teamData'",
      "export { buildMapLayout } from './src/lite2/map/mapLayout'",
      "export { focusToken, parseFocusToken, resolveMapFocus } from './src/lite2/map/mapFocus'",
      "export { deriveZoneRead } from './src/lite2/map/zoneRead'",
    ].join('\n'),
    resolveDir: ROOT,
    loader: 'ts',
    sourcefile: 'entry.ts',
  },
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'neutral',
  target: 'es2022',
  define: { 'import.meta.env': '__VITE_ENV_SHIM__' },
  banner: { js: 'const __VITE_ENV_SHIM__ = {};' },
})
const mod = await import(
  'data:text/javascript;base64,' +
    Buffer.from(built.outputFiles[0].text, 'utf8').toString('base64')
)
const { liteTeamFromPayload, buildMapLayout, focusToken, parseFocusToken, resolveMapFocus, deriveZoneRead } = mod

const payload = JSON.parse(
  readFileSync(new URL('./fixtures/team-80.json', import.meta.url), 'utf8'),
)

let failed = 0
let passed = 0
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (ok) passed += 1
  else {
    failed += 1
    console.log(`  🔴 ${label}\n     got  ${JSON.stringify(got)}\n     want ${JSON.stringify(want)}`)
    return
  }
  console.log(`  ✓ ${label}`)
}

const team = liteTeamFromPayload(payload)
const layout = buildMapLayout(team.people, team.projects)

// ── ① token 解析：URL 是用户可改的输入，坏形状一律解成 null（= calm），不抛、不猜 ──────
console.log('\n[token]')
check('person token 往返', parseFocusToken(focusToken({ kind: 'person', id: 'u_0' })), {
  kind: 'person',
  id: 'u_0',
})
check('project token 往返', parseFocusToken(focusToken({ kind: 'project', id: 'p_0' })), {
  kind: 'project',
  id: 'p_0',
})
check('id 里带冒号只切第一个', parseFocusToken('project:p:with:colons'), {
  kind: 'project',
  id: 'p:with:colons',
})
check('中文 id 原样', parseFocusToken('person:u_周雅'), { kind: 'person', id: 'u_周雅' })
for (const bad of ['', '   ', 'person', 'person:', ':u_0', 'nope:u_0', 'PERSON:u_0', null, undefined]) {
  check(`坏形状 ${JSON.stringify(bad)} → null`, parseFocusToken(bad), null)
}

// ── ② 点人 → 亮「他 + 他 owned 的项目」 ───────────────────────────────────────
console.log('\n[点人]')
// 期望值**从 payload 独立算**：谁的 ownerId 指到 u_0，就该有几条边。不问 layout 要。
const ownedByU0 = payload.projects.filter((p) => p.ownerId === 'u_0').map((p) => p.id).sort()
check('语料里 u_0 真的背着不止一件事（否则本条判据是空真）', ownedByU0.length >= 2, true)
const fU0 = resolveMapFocus(layout, { kind: 'person', id: 'u_0' })
check('亮的人只有他自己', [...fU0.personIds], ['u_0'])
check('亮的项目 = 他 owned 的全部', [...fU0.projectIds].sort(), ownedByU0)
check('边数 = 他 owned 的项目数', fU0.edges.length, ownedByU0.length)
check(
  '每条边的两端 id 都对得上',
  fU0.edges.every((e) => e.personId === 'u_0' && ownedByU0.includes(e.projectId)),
  true,
)

// 🔴 边的锚点必须**就是**节点自己的坐标（独立从 layout 取，不问 resolveMapFocus 要）。
const posOfPerson = new Map()
for (const zone of layout.zones) for (const m of zone.members) posOfPerson.set(m.person.id, m.pos)
const posOfProject = new Map(layout.projects.map((n) => [n.project.id, n.pos]))
check(
  '边的两端锚在节点中心上（不是另算了一套坐标）',
  fU0.edges.every(
    (e) =>
      JSON.stringify(e.from) === JSON.stringify(posOfPerson.get(e.personId)) &&
      JSON.stringify(e.to) === JSON.stringify(posOfProject.get(e.projectId)),
  ),
  true,
)

// 一个人都不背的人：亮他自己，零边（不是 null——他在板上，只是手上没活）。
const idle = team.people.find((p) => !payload.projects.some((x) => x.ownerId === p.id))
const fIdle = resolveMapFocus(layout, { kind: 'person', id: idle.id })
check('没背活的人：亮自己、零边', [fIdle.edges.length, [...fIdle.projectIds].length], [0, 0])

// ── ③ 点项目 → 亮「它 + owner」；🔴 三种 owner 缺法一条边都不许画 ────────────────
console.log('\n[点项目]')
const fP0 = resolveMapFocus(layout, { kind: 'project', id: 'p_0' })
check('点项目亮出 owner', [...fP0.personIds], ['u_0'])
check('点项目只亮它自己那一条', [...fP0.projectIds], ['p_0'])
check('点项目 1 条边', fP0.edges.length, 1)

for (const [id, why] of [
  ['p_no_owner_at_all', '文档压根没写负责人'],
  ['p_owner_name_only', '只有名字没有 id —— 绝不拿名字去花名册里模糊匹配'],
  ['p_owner_id_dangling', 'id 指向一个不在花名册上的人'],
]) {
  const f = resolveMapFocus(layout, { kind: 'project', id })
  check(`${id}（${why}）：零边`, f.edges.length, 0)
  check(`${id}：一个人都不点亮`, [...f.personIds], [])
  check(`${id}：它自己仍然亮着`, [...f.projectIds], [id])
}

// ── ④ 查无此 id → null（= calm）。深链发出去之后花名册可能已经变了 ────────────────
console.log('\n[查无此人]')
check('人 id 不在板上 → null', resolveMapFocus(layout, { kind: 'person', id: 'u_ghost' }), null)
check('项目 id 不在板上 → null', resolveMapFocus(layout, { kind: 'project', id: 'p_ghost' }), null)
check('target 为 null → null', resolveMapFocus(layout, null), null)

// 🔴 全局对账：把每个人都点一遍，边的总数必须 = 「ownerId 解得开的项目」条数。
// 期望值从 payload + 花名册独立算——多画一条（猜了个人）或少画一条（漏了）都会红。
const rosterIds = new Set(team.people.map((p) => p.id))
const resolvableProjects = payload.projects.filter((p) => p.ownerId && rosterIds.has(p.ownerId))
const totalEdges = team.people.reduce(
  (sum, p) => sum + (resolveMapFocus(layout, { kind: 'person', id: p.id })?.edges.length ?? 0),
  0,
)
check('逐人点一遍的边总数 = 解得开 owner 的项目数', totalEdges, resolvableProjects.length)

// ── ⑤ 组级读数：真派生、零计数、缺了不编 ────────────────────────────────────
console.log('\n[组级读数 · 开关开]')
const teamOn = liteTeamFromPayload({ ...payload, scoring_enabled: true })
const layoutOn = buildMapLayout(teamOn.people, teamOn.projects)
const readsOn = layoutOn.zones.map((z) => ({
  zone: z.key,
  read: deriveZoneRead(z.members.map((m) => m.person)),
}))
const readOf = (key) => readsOn.find((r) => r.zone === key)?.read ?? null

check(
  '🔴 同组里 strained 与 steady 并存 → 说 strained（先说要你留意的）',
  readOf('Platform Engineering')?.mood,
  'strained',
)
check('只有 steady 的组照说 steady（不是只报坏消息）', readOf('Customer Success')?.mood, 'steady')
check('词表外的词原样回显', readOf('Field Operations')?.moodRaw, 'flat out')
check(
  '🔴 有情绪但没出处 → 整条丢掉（挂不上 data-metric-source 的情绪词=泄漏）',
  readOf('Finance & Legal'),
  null,
)
check('整组没人报 → 没有读数', [readOf('Design'), readOf('Data'), readOf('Executive')], [null, null, null])
check(
  '有读数的组恰好 4 个',
  readsOn.filter((r) => r.read).length,
  4,
)
check(
  '🔴 读数里一个数字都没有（零计数 + 不带自述负载那个百分数）',
  readsOn
    .filter((r) => r.read)
    .every((r) => !/\d/.test(`${r.read.mood}${r.read.moodRaw ?? ''}`)),
  true,
)
check(
  '每条读数都带得出自己的出处',
  readsOn.filter((r) => r.read).every((r) => r.read.source.length > 0),
  true,
)

console.log('\n[组级读数 · 开关关（双世界）]')
// 🔴 payload 里 self_report 原样在，只是开关关着——`stripPersonNumbers` 把它整个剥掉，
// 所以关世界里一条读数都取不到。这是**唯一**那把锁（zoneRead 里刻意没有第二道 if）。
check('语料里确实有人报了（否则本条是空真）', payload.people.filter((p) => p.self_report).length >= 5, true)
const teamOff = liteTeamFromPayload({ ...payload, scoring_enabled: false })
const layoutOff = buildMapLayout(teamOff.people, teamOff.projects)
check(
  '开关关 → 一条组级读数都没有',
  layoutOff.zones.filter((z) => deriveZoneRead(z.members.map((m) => m.person))).length,
  0,
)

console.log(`\n${failed ? 'FAILED' : 'OK'} — ${passed} passed, ${failed} failed`)
process.exitCode = failed ? 1 : 0
