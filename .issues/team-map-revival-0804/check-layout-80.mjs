// team-map-revival-0804 · B1 · 布局公式对着 80 人合成租户跑一遍（PRD §5.1 大团队条款验收）。
//
// 跑法：`node .issues/team-map-revival-0804/check-layout-80.mjs`
//
// ⚠ **这不是一道门**，名字里刻意没有 `verify-`：`git ls-files "*verify-*.mjs"` 是本仓判定
// 「有哪些门」的自查命令，往那个 glob 里塞一个不在 ROSTER 的文件，就是再造一批
// `.issues/rich-align-0722/verify-*.mjs` 那样没人裁定过的孤儿（AGENTS.md 点名过）。
// 真正进 ROSTER 的 `verify-team-map.mjs` 是 **B3** 的活；本文件是 B1 自己的一次性算账，
// 证明「布局公式在 80 人语料上不炸、哨兵按缺失渲染」。
//
// 🔴 判据经过**真 derive**（liteTeamFromPayload）和**真布局函数**（buildMapLayout）——
// fixture 是后端 `/team` 的原样 payload 形状，不是手捏的 LiteTeam。尺子不长在被量的东西上：
// 期望值全部写死在本文件里（或从 fixture 上游算），一个都不由 buildMapLayout 反推。

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Buffer } from 'node:buffer'
import path from 'node:path'
import esbuild from 'esbuild'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')

// 与 verify-fixA.mjs 同一条 in-memory bundle recipe（本仓既有写法）。
const built = await esbuild.build({
  stdin: {
    contents: [
      "export { liteTeamFromPayload } from './src/lite2/teamData'",
      "export { buildMapLayout } from './src/lite2/map/mapLayout'",
      "export { progressOf, statusKeyOf, projectStatusTone } from './src/lite2/projectView'",
      "export { projectStatusText } from './src/shared/projectStatus'",
      "export { getDict } from './src/shared/i18n'",
    ].join('\n'),
    resolveDir: ROOT,
    loader: 'ts',
    sourcefile: 'check-layout-80-entry.ts',
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
  'data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text, 'utf8').toString('base64')
)
const { liteTeamFromPayload, buildMapLayout, progressOf, statusKeyOf, projectStatusText, getDict } = mod

let failed = 0
let passed = 0
function check(name, cond, detail) {
  if (cond) {
    passed += 1
    console.log(`  ok   ${name}`)
  } else {
    failed += 1
    console.log(`  FAIL ${name}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`)
  }
}

const payload = JSON.parse(
  readFileSync(path.join(HERE, 'fixtures', 'team-80.json'), 'utf8'),
)
const team = liteTeamFromPayload(payload)
const layout = buildMapLayout(team.people, team.projects)
const l = getDict('en').lite2

console.log('\n── 上游事实（从 fixture 独立数出来，不问布局函数）───────────────────────')
// 期望值取上游源表（payload），不取 layout 的自报——函数一缩水，自报的期望值会跟着缩水。
const groupsExpected = new Set(
  payload.people.map((p) => (p.team ?? '').trim() || '__ungrouped__'),
).size
console.log(`  people=${payload.people.length} groups=${groupsExpected} projects=${payload.projects.length}`)

console.log('\n── 布局公式 ────────────────────────────────────────────────────────────')
check('分区数 = 花名册部门数（含未分组桶）', layout.zones.length === groupsExpected, {
  got: layout.zones.length,
  want: groupsExpected,
})
check(
  '每个人都站到了板上，一个不多一个不少',
  layout.zones.reduce((s, z) => s + z.members.length, 0) === payload.people.length,
  { got: layout.zones.reduce((s, z) => s + z.members.length, 0) },
)
check('项目条数 = 项目数', layout.projects.length === payload.projects.length)
check(
  '「未分组」桶沉底（有名分的组在前）',
  layout.zones[layout.zones.length - 1].isUngrouped === true,
  layout.zones.map((z) => z.key),
)
check(
  'board 尺寸有限且为正（80 人语料不把公式算爆）',
  Number.isFinite(layout.board.width) &&
    Number.isFinite(layout.board.height) &&
    layout.board.width > 0 &&
    layout.board.height > 0,
  layout.board,
)
check(
  '每个坐标都是有限数（NaN 会让镜头与 transform 一起哑掉，且屏幕上不报错）',
  layout.zones.every((z) =>
    Number.isFinite(z.rect.x) && Number.isFinite(z.rect.y) &&
    Number.isFinite(z.rect.width) && Number.isFinite(z.rect.height) &&
    z.members.every((m) => Number.isFinite(m.pos.x) && Number.isFinite(m.pos.y)),
  ) && layout.projects.every((p) => Number.isFinite(p.pos.x) && Number.isFinite(p.pos.y)),
)
// 分区互不重叠：公式化布局最容易出的错就是两张卡叠在一起（人被别的部门盖住）。
const overlaps = []
for (let i = 0; i < layout.zones.length; i += 1) {
  for (let j = i + 1; j < layout.zones.length; j += 1) {
    const a = layout.zones[i].rect
    const b = layout.zones[j].rect
    const hit =
      a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
    if (hit) overlaps.push([layout.zones[i].key, layout.zones[j].key])
  }
}
check('分区两两不重叠', overlaps.length === 0, overlaps)
check(
  '人都落在自己分区的框里',
  layout.zones.every((z) =>
    z.members.every(
      (m) =>
        m.pos.x >= z.rect.x && m.pos.x <= z.rect.x + z.rect.width &&
        m.pos.y >= z.rect.y && m.pos.y <= z.rect.y + z.rect.height,
    ),
  ),
)
check(
  '所有 world 对象都在 board 之内（board = f(内容)，不许有东西露在板外）',
  layout.zones.every((z) => z.rect.x >= 0 && z.rect.y >= 0 &&
    z.rect.x + z.rect.width <= layout.board.width &&
    z.rect.y + z.rect.height <= layout.board.height) &&
    layout.projects.every((p) => p.pos.x <= layout.board.width && p.pos.y <= layout.board.height),
)
console.log(
  `  （board=${layout.board.width}×${layout.board.height} · personCols=${layout.personCols} · zoneCols=${layout.zoneCols}）`,
)

console.log('\n── 项目排序：owner 部门组序，无 owner 沉底 ─────────────────────────────')
const sunk = layout.projects.filter((p) => p.zoneIndex === -1).map((p) => p.project.id)
check(
  '三条 owner 缺法全部沉底（没 owner / 只有名字 / id 指向查无此人）',
  ['p_no_owner_at_all', 'p_owner_name_only', 'p_owner_id_dangling'].every((id) => sunk.includes(id)),
  sunk,
)
check(
  '🔴 只有名字没有 id 的项目**没有**被名字模糊匹配到某个部门上',
  layout.projects.find((p) => p.project.id === 'p_owner_name_only')?.zoneIndex === -1,
)
const zoneSeq = layout.projects.map((p) => (p.zoneIndex === -1 ? Number.MAX_SAFE_INTEGER : p.zoneIndex))
check(
  '整列按分区序单调不降（沉底的排在最后）',
  zoneSeq.every((v, i) => i === 0 || zoneSeq[i - 1] <= v),
  zoneSeq,
)
const ys = layout.projects.map((p) => p.pos.y)
check('项目条 y 严格递增（不叠条）', ys.every((v, i) => i === 0 || ys[i - 1] < v))

console.log('\n── 哨兵：缺了不编 ──────────────────────────────────────────────────────')
const byId = new Map(team.projects.map((p) => [p.id, p]))
check(
  'owner 缺席 → ownerName 为空串，由渲染层兜 projectsUnknownValue（不在 derive 里焊文案）',
  byId.get('p_no_owner_at_all').ownerName === '' &&
    byId.get('p_no_owner_at_all').ownerNameRaw === undefined,
)
check(
  'ownerId 原样透传到 LiteProject（B1 契约小补）',
  byId.get('p_0').ownerId === payload.projects[0].ownerId &&
    byId.get('p_no_owner_at_all').ownerId === undefined,
)
check(
  'status 缺席 → statusKey=unknown，文案是「状态未提及」而不是 on-track',
  statusKeyOf(byId.get('p_no_status').statusRaw) === 'unknown' &&
    projectStatusText(byId.get('p_no_status').statusRaw, l) === l.projectsStatusUnknown,
)
check(
  '词表外的 status → 原样回显那个词（不丢不改写）',
  projectStatusText(byId.get('p_status_out_of_vocab').statusRaw, l) === 'parked-until-q3',
)
check('progress 缺席 → null（整条进度组不渲染）', progressOf(byId.get('p_no_progress').progress) === null)
check(
  '🔴 progress=0 是**已知值**，不是缺席（必须画一条 0 宽的条）',
  progressOf(byId.get('p_progress_zero').progress) === 0,
)
check(
  'progress 越界 → null（宁可不画，也不画一条骗人的条）',
  progressOf(byId.get('p_progress_out_of_range').progress) === null,
)

console.log('\n── 红线：人身零数字 ────────────────────────────────────────────────────')
const numericKeys = team.people.flatMap((p) =>
  Object.entries(p).filter(([, v]) => typeof v === 'number').map(([k]) => k),
)
check('LitePerson 上一个数字键都没有', numericKeys.length === 0, numericKeys)

// ── 对照：两种极端形态必须算出不同的排法，否则「公式」只是个写死的常量 ──
// 对照组照 **demo-seed 的真实形态** 造（10 个部门 / 16 人 / 6 个项目，各组 1-3 人），
// 因为那是验收锚定的语料。期望值 2 是从这一头的形状推出来的（多组少人 → 名册窄而高 →
// 少排几列才不至于把 board 拉成一条横带），不是问 buildMapLayout 要来的。
console.log('\n── 对照：公式对两种极端形态给出不同的排法（不是写死的常量）─────────────')
const SEED_SHAPE = [1, 3, 2, 2, 1, 2, 2, 1, 1, 1] // = 16 人 / 10 组，与 demo-seed 逐组同形
const seedPeople = SEED_SHAPE.flatMap((size, g) =>
  Array.from({ length: size }, (_, i) => ({
    id: `s_${g}_${i}`, name: `P${g}${i}`, role: '', team: `Dept ${g}`,
    read: '', ownsRead: [], tone: 'sage',
  })),
)
const seedProjects = Array.from({ length: 6 }, (_, i) => ({
  id: `sp_${i}`, title: `Project ${i}`, ownerName: '', status: '',
}))
const seedLayout = buildMapLayout(seedPeople, seedProjects)
check(
  'demo-seed 形态（16 人 / 10 组 / 6 项目）排 2 列分区',
  seedLayout.zoneCols === 2,
  { got: seedLayout.zoneCols, board: seedLayout.board },
)
check(
  '80 人形态排 4 列分区 —— 与上一条不同，证明列数真的是算出来的',
  layout.zoneCols === 4 && seedLayout.zoneCols !== layout.zoneCols,
  { seed: seedLayout.zoneCols, big: layout.zoneCols },
)
check(
  '组内人多 → 分区内也多排一列（personCols 同样是 f(最大组人数)）',
  seedLayout.personCols === 3 && layout.personCols === 4,
  { seed: seedLayout.personCols, big: layout.personCols },
)
check('空花名册不炸（board 仍是正数、zones 为空）', (() => {
  const empty = buildMapLayout([], [])
  return empty.zones.length === 0 && empty.board.width > 0 && empty.board.height > 0
})())

console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'} — ${passed} ok, ${failed} failed\n`)
process.exitCode = failed === 0 ? 0 : 1
