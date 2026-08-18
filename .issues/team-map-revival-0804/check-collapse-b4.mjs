// team-map-revival-0804 · B4 · 部门收拢态的**布局层**验收（纯函数，零浏览器）。
//
//   node .issues/team-map-revival-0804/check-collapse-b4.mjs
//
// 为什么先在这一层验：收拢/展开整件事是 `buildMapLayout` 一个纯函数算出来的，
// 而它的输入输出都是普通对象——在这儿一条判据能钉死的东西，到浏览器里要花十倍力气
// 才够得着（还得先真上传 80 个人）。渲染层与交互层的判据另在 verify-team-map.mjs。
//
// 🔴 每条判据都先配**对照基准**：收拢态的判据必须证明「不收拢的时候确实不是这样」，
// 否则「板上每个分区都是 132px 高」这种话在任何实现下都可能恰好成立。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Buffer } from 'node:buffer'
import path from 'node:path'
import esbuild from 'esbuild'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')

const built = await esbuild.build({
  stdin: {
    contents: [
      "export { liteTeamFromPayload } from './src/lite2/teamData'",
      "export { buildMapLayout, COLLAPSE_MIN_PEOPLE } from './src/lite2/map/mapLayout'",
      "export { isNeedsYouStatus } from './src/lite2/projectView'",
    ].join('\n'),
    resolveDir: ROOT,
    loader: 'ts',
    sourcefile: 'check-collapse-b4-entry.ts',
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
const { liteTeamFromPayload, buildMapLayout, COLLAPSE_MIN_PEOPLE, isNeedsYouStatus } = mod

let failed = 0
let passed = 0
function check(name, cond, detail) {
  if (cond) { passed += 1; console.log(`  ok   ${name}`) }
  else { failed += 1; console.log(`  FAIL ${name}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`) }
}

const big = liteTeamFromPayload(
  JSON.parse(readFileSync(path.join(HERE, 'fixtures', 'team-80.json'), 'utf8')),
)
// 小团队对照组照 **demo-seed 的真实形态** 造（16 人 / 10 组，各组 1-3 人）——
// 与 check-layout-80.mjs 的 SEED_SHAPE 同一份形状，那是本战役验收锚定的语料。
const SEED_SHAPE = [1, 3, 2, 2, 1, 2, 2, 1, 1, 1]
const seed = {
  people: SEED_SHAPE.flatMap((size, g) =>
    Array.from({ length: size }, (_, i) => ({
      id: `s_${g}_${i}`, name: `P${g}${i}`, role: '', team: `Dept ${g}`,
      read: '', ownsRead: [], tone: 'sage',
    })),
  ),
  projects: Array.from({ length: 6 }, (_, i) => ({
    id: `sp_${i}`, title: `Project ${i}`, ownerName: '', status: '',
  })),
}

console.log('── ⓪ 对照基准（不写这一段，下面全是空真）─────────────────────────')
check('80 人 fixture 真的过了阈值', big.people.length >= COLLAPSE_MIN_PEOPLE,
  { people: big.people.length, threshold: COLLAPSE_MIN_PEOPLE })
check('demo-seed 真的没过阈值（于是它是「不该收」的对照组）',
  seed.people.length > 0 && seed.people.length < COLLAPSE_MIN_PEOPLE,
  { people: seed.people.length })

const bigL = buildMapLayout(big.people, big.projects)
const seedL = buildMapLayout(seed.people, seed.projects)

console.log('\n── ① 收不收，由人数说了算 ────────────────────────────────────────')
check('80 人 → 收拢态', bigL.collapsed === true)
check('demo-seed → 不收（小团队一个人位都不少）', seedL.collapsed === false)
check('小团队里 expandedZoneKey 恒 null（这个概念只属于收拢态）',
  buildMapLayout(seed.people, seed.projects, { expandedZoneKey: seedL.zones[0].key }).expandedZoneKey === null)

console.log('\n── ② 收拢卡不表达人数（ADR-0023：跨人计数读作排行榜）────────────')
const heights = [...new Set(bigL.zones.map((z) => z.rect.height))]
check('收拢态下所有部门卡**一样高**——人多人少不影响它的块头', heights.length === 1, { heights })
const sizes = [...new Set(bigL.zones.map((z) => z.members.length))]
check('自证：这些部门的人数**本来就不一样**（否则上一条恒真）', sizes.length > 1, { sizes })

console.log('\n── ③ 收了但没丢人（契约不变）──────────────────────────────────')
const totalMembers = bigL.zones.reduce((n, z) => n + z.members.length, 0)
check('收拢态下 zone.members 一个人都不少', totalMembers === big.people.length,
  { totalMembers, people: big.people.length })
const z0 = bigL.zones.find((z) => z.members.length > 1)
check('自证：找得到一个不止一人的部门', !!z0)
check('收拢的部门里，成员 pos 全落在卡心（连线连得上、focusBounds 框得住）',
  !!z0 && z0.members.every((m) =>
    m.pos.x === z0.rect.x + z0.rect.width / 2 && m.pos.y === z0.rect.y + z0.rect.height / 2))

console.log('\n── ④ 收拢省的是**名册区**的地方，board 高度另有主人 ──────────────')
// 🔴 这一段是被一条写错的假设逼出来的。原判据是「收拢态 board 应该矮得多」，实测
// board 高度**一个像素都没变**（2522 → 2522）：`boardSizeOf` 取的是 max(名册高, 项目列高)，
// 而 24 条项目的那一列本来就比名册高。
// ⇒ **收拢部门单独做不出可读性**——只要项目列还是全量铺开，board 就还是那么高。
//   这正是票面把「项目列同步（默认只铺进行中/有风险）」跟收拢态放进同一张票的原因；
//   两件事是耦合的，先做完哪一件单独都不够。判据因此改成量真正被收拢影响的那块。
const rosterBox = (layout) => {
  const top = Math.min(...layout.zones.map((z) => z.rect.y))
  const bottom = Math.max(...layout.zones.map((z) => z.rect.y + z.rect.height))
  return bottom - top
}
const openedOne = buildMapLayout(big.people, big.projects, {
  expandedZoneKey: bigL.zones.find((z) => z.members.length > 1).key,
})
check('展开一个部门之后名册区变高 —— 反证收拢态确实把名册压下去了',
  rosterBox(openedOne) > rosterBox(bigL),
  { collapsed: rosterBox(bigL), openedOne: rosterBox(openedOne) })
check('🔴 记档：此刻 board 高度由项目列决定、不由名册决定（收拢单独不够，等项目列同步）',
  bigL.board.height === 2522, { boardH: bigL.board.height })

console.log('\n── ⑤ 原位展开 ────────────────────────────────────────────────────')
const target = bigL.zones.find((z) => z.members.length > 1)
const openL = buildMapLayout(big.people, big.projects, { expandedZoneKey: target.key })
check('展开的那个部门 isCollapsed = false', openL.zones.find((z) => z.key === target.key).isCollapsed === false)
check('其余部门仍然收拢', openL.zones.filter((z) => z.key !== target.key).every((z) => z.isCollapsed === true))
check('layout 自陈展开的是哪个（门与调试读得到）', openL.expandedZoneKey === target.key)
const openedZone = openL.zones.find((z) => z.key === target.key)
const distinct = new Set(openedZone.members.map((m) => `${m.pos.x},${m.pos.y}`))
check('展开之后成员真的各站各位（不再是同一个点）', distinct.size === openedZone.members.length,
  { distinct: distinct.size, members: openedZone.members.length })
check('展开的那张卡比收拢时高', openedZone.rect.height > bigL.zones[0].rect.height,
  { open: openedZone.rect.height, collapsed: bigL.zones[0].rect.height })
check('展开一个板上没有的部门 → 老实全收拢，不炸',
  buildMapLayout(big.people, big.projects, { expandedZoneKey: '查无此部门' }).expandedZoneKey === null)

console.log('\n── ⑥ 收拢态下几何仍然自洽（B1 那几条不许因为收拢就破）───────────')
const inBoard = (r) => r.x >= 0 && r.y >= 0 && r.x + r.width <= bigL.board.width && r.y + r.height <= bigL.board.height
check('所有分区卡都在 board 内', bigL.zones.every((z) => inBoard(z.rect)))
check('所有项目条都在 board 内',
  bigL.projects.every((p) => p.pos.x > 0 && p.pos.y > 0 && p.pos.x < bigL.board.width && p.pos.y < bigL.board.height))
const overlap = (a, b) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
let clashes = 0
for (let i = 0; i < bigL.zones.length; i += 1)
  for (let j = i + 1; j < bigL.zones.length; j += 1)
    if (overlap(bigL.zones[i].rect, bigL.zones[j].rect)) clashes += 1
check('分区卡两两不重叠', clashes === 0, { clashes })
check('坐标全是有限数', bigL.zones.every((z) => Number.isFinite(z.rect.x) && Number.isFinite(z.rect.height)))

console.log('\n── ⑦ 火情判据 = 警报药丸那把尺（kickoff 拍板）──────────────────')
// 🔴 期望值在**门这一侧**独立手算，走 store 里的项目原始 statusRaw，
// 不去问任何一个被测函数（尺子长在被量的东西上就没有分辨力）。
const ownerZone = new Map()
for (const z of bigL.zones) for (const m of z.members) ownerZone.set(m.person.id, z.key)
const expectedHotZones = new Set(
  big.projects
    .filter((p) => isNeedsYouStatus(p.statusRaw))
    .map((p) => ownerZone.get(p.ownerId?.trim()))
    .filter(Boolean),
)
check('自证：这份语料里真有火情项目（否则「哪些部门着火」是空集，下面恒真）',
  big.projects.some((p) => isNeedsYouStatus(p.statusRaw)))
check('自证：也真有不着火的部门（否则「只框着火的」等于框全部）',
  expectedHotZones.size > 0 && expectedHotZones.size < bigL.zones.length,
  { hot: expectedHotZones.size, zones: bigL.zones.length })

console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'} — ${passed} ok, ${failed} failed`)
process.exitCode = failed === 0 ? 0 : 1
