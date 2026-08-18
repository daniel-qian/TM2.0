// team-map-revival-0804（#106 B3）· `verify-team-map.mjs` 的**变异跑器**。
//
// 票面要求「每条主判据配专属变异」。一条一条手改再手跑是 18 轮 build+跑，人手做必然漏，
// 所以写成跑器；但跑器本身也会撒谎，所以它自己先守住四条：
//
//  ① **锚点必须命中且唯一**。0 处命中会让变异「看起来存活」——那是最贵的一种假绿
//     （你以为验过了，其实那行代码从来没被改过）。命中 ≥2 处也算错：改到别处去了。
//  ② **还原按字节**。读原文用 Buffer、写回用同一个 Buffer——不走 `readFileSync(f,'utf8')`
//     再 write 那条路，那会把 CRLF 压成 LF，全仓一片伪 diff（本仓栽过）。
//     跑完再 `git status --short` 自查一遍：有残留就报错，不当没事发生。
//  ③ **判红看的是门自己吐的 `[FAIL] <判据名>`**，不是「进程退了非 0」——非 0 也可能是门崩了、
//     或者红在别处。要的是「**这条**判据红了」。
//  ④ **预判当假设验**：每个变异写清「本该红哪几条」，实跑对不上就整轮标 MISMATCH。
//     票面预判从来不是事实（`ticket-line-numbers-are-hearsay` 同一条教训）。
//
// 跑法（后端 + preview 都起着，与跑门时同一套）：
//   VERIFY_BASE=http://127.0.0.1:5183 API_BASE=http://127.0.0.1:8147 \
//     node .issues/team-map-revival-0804/mutants-b3.mjs
//   只跑一个：加 --only=<变异名子串>
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync, spawnSync } from 'node:child_process'

const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7)
const VERIFY_BASE = process.env.VERIFY_BASE || 'http://127.0.0.1:5183'
const API_BASE = process.env.API_BASE || 'http://127.0.0.1:8147'

const S = 'src/lite2'
const MUTANTS = [
  {
    name: 'M01-canvas-gone',
    why: '画布根本没挂上：板被平铺出来，rzpp 一层都不在（「能看见节点」≠「有画布」）',
    // ⚠ 第一版是把 `TransformComponent` 换成一个普通 div —— **页面当场崩了**
    //（rzpp 的 wrapper 少了它的孩子会抛）。那种变异一条判据都证明不了：门是被崩溃打红的，
    // 不是被判据打红的（memory:「崩溃式变异是弱变异」）。改成在**所有 hook 之后**早退，
    // React 的 hook 序不受影响，页面照常渲染，只是这一页不再有画布。
    file: `${S}/map/MapPanZoom.tsx`,
    find: `  return (
    <div
      className="lite-map-canvas"`,
    to: `  if (board) return <div className="lite-map-canvas">{children}</div>
  return (
    <div
      className="lite-map-canvas"`,
    red: ['A1 画布挂载'],
  },
  {
    name: 'M02-no-pan',
    why: '拖不动了（panning 禁用）——「拖动可平移」那句提示当场变成谎话',
    file: `${S}/map/MapPanZoom.tsx`,
    find: `        panning={{ velocityDisabled: true }}`,
    to: `        panning={{ disabled: true }}`,
    red: ['B1 pan 之后 transform 真位移了'],
  },
  {
    name: 'M03-drag-steals-focus',
    why: '拖动之后那一下 click 不再被掐掉 —— 从人节点上拖板会把他选中（B2 实测的真 bug）',
    file: `${S}/map/MapPanZoom.tsx`,
    find: `    if (draggedRef.current) {
      draggedRef.current = false`,
    to: `    if (false) {
      draggedRef.current = false`,
    red: ['B2 🔴 从人节点上起手拖板'],
  },
  {
    name: 'M04-refit-on-board-change',
    why: '拆掉两把锁里的**被动 effect**（换板重新落位那一路）；onInit 那把还在，首帧照样对',
    file: `${S}/map/MapPanZoom.tsx`,
    find: `  useEffect(() => {
    applyFit(false)
  }, [board, applyFit])`,
    to: `  useEffect(() => {
    void applyFit
  }, [board, applyFit])`,
    red: ['A4 换一块板'],
  },
  {
    name: 'M05-oninit-lock',
    why: '拆掉两把锁里的 **onInit**；被动 effect 还在。B2 记档说单看首帧它俩互为冗余——'
      + '这一轮就是去证它：若全绿，说明这把锁的独有射程（rzpp 还没量到 wrapper 那个窗口）'
      + '在浏览器里造不出来，那就该在代码里自陈「门够不着」，而不是假装验过',
    file: `${S}/map/MapPanZoom.tsx`,
    find: `          ref.current = api
          applyFit(false)`,
    to: `          ref.current = api`,
    red: [],
    expectSurvive: true,
  },
  {
    name: 'M06-zone-count',
    why: '少排一个部门分区',
    file: `${S}/map/mapLayout.ts`,
    find: `  return deriveGroupFacets(people)
    .filter((facet) => facet.key !== GROUP_ALL)`,
    to: `  return deriveGroupFacets(people)
    .filter((facet) => facet.key !== GROUP_ALL)
    .slice(0, -1)`,
    red: ['C1 分区数'],
  },
  {
    name: 'M07-only-first-project',
    why: '一个人只连他背的第一件事（1:1 的语料下这个错会一路全绿）',
    file: `${S}/map/mapFocus.ts`,
    find: `      layout.projects.filter((node) => ownerIdOf(node) === target.id),
      [target.id],`,
    to: `      layout.projects.filter((node) => ownerIdOf(node) === target.id).slice(0, 1),
      [target.id],`,
    red: ['C4 逐人点一遍的连线总数', 'D1 点人 →'],
  },
  {
    name: 'M08-calm-edge-shell',
    why: 'calm 态照样渲染一个空的连线层（票面写的是「SvgEdge 只在 focus 出现」）',
    file: `${S}/map/MapEdges.tsx`,
    find: `  if (edges.length === 0) return null`,
    to: `  if (false) return null`,
    red: ['C3 calm 态连线层整个不在 DOM 里'],
  },
  {
    name: 'M09-no-subject',
    why: '被点的人不再成为主角（不高亮、不长 mini 卡）',
    file: `${S}/map/MapScreen.tsx`,
    find: `    if (focus.subject.kind === 'person' && focus.subject.id === id) return 'subject'`,
    to: `    if (false && focus.subject.kind === 'person' && focus.subject.id === id) return 'subject'`,
    red: ['D1 点人 →', 'D1 被点的那个原位长出 mini 卡'],
  },
  {
    name: 'M10-no-escape',
    why: 'Esc 不再回 calm',
    file: `${S}/map/MapScreen.tsx`,
    find: `      if (event.key !== 'Escape' || event.defaultPrevented) return
      setFocus(null)`,
    to: `      if (event.key !== 'Escape' || event.defaultPrevented) return
      void setFocus`,
    red: ['D2 Esc → 回 calm'],
  },
  {
    name: 'M11-person-number-inside',
    why: '🔴 红线破口①：把自述负载那个百分数印进人节点自己的子树里',
    file: `${S}/map/MapNodes.tsx`,
    find: `      <InitialAvatar name={person.name} size={44} className="lite-map-person-avatar" />`,
    to: `      <InitialAvatar name={person.name} size={44} className="lite-map-person-avatar" />
      <span className="lite-map-person-load">{person.selfReport?.load?.value ?? ''}</span>`,
    red: ['E1 🔴 人节点子树里一个数字都没有'],
  },
  {
    name: 'M12-person-number-overlay',
    why: '🔴 红线破口②：数字由**另一层**画在人头上——它不在人节点的子树里，'
      + 'textContent 那把尺永远干净，只有量矩形的那把看得见',
    file: `${S}/map/MapScreen.tsx`,
    find: `            {/* ── 项目层：统一横条。长短不代表任何量（ADR-0012 修订 5 原话）。 ── */}`,
    to: `            <div style={{ position: 'absolute', inset: 0, zIndex: 5, pointerEvents: 'none' }}>
              {layout.zones.flatMap((z) =>
                z.members.map((n) => (
                  <span key={n.person.id} style={{ position: 'absolute', left: \`\${n.pos.x}px\`, top: \`\${n.pos.y}px\` }}>91%</span>
                )),
              )}
            </div>
            {/* ── 项目层：统一横条。长短不代表任何量（ADR-0012 修订 5 原话）。 ── */}`,
    red: ['E2 🔴 按显示宽度'],
  },
  {
    name: 'M13-chip-set',
    why: 'chips 少一个（HUD 与板不同步：点得到的部门比板上少）',
    file: `${S}/map/MapScreen.tsx`,
    find: `    () => layout.zones.map((zone) => ({
      key: zone.key,`,
    to: `    () => layout.zones.slice(0, -1).map((zone) => ({
      key: zone.key,`,
    red: ['F1 chips 一个不多一个不少'],
  },
  {
    name: 'M14-chip-headcount',
    why: '🔴 chip 上挂人数（ADR-0023 禁的那张部门人数排行榜）',
    file: `${S}/map/MapHud.tsx`,
    find: `                {zone.label}
              </button>`,
    to: `                {zone.label} 4
              </button>`,
    red: ['F1 🔴 chip 上零数字', 'I1 en 侧 chip 仍然零数字'],
  },
  {
    name: 'M15-zone-partial',
    why: '部门 focus 只亮组里第一个人',
    file: `${S}/map/mapFocus.ts`,
    find: `    const memberIds = new Set(zone.members.map((m) => m.person.id))`,
    to: `    const memberIds = new Set(zone.members.slice(0, 1).map((m) => m.person.id))`,
    red: ['F2 点部门 chip → 这一组人全亮'],
  },
  {
    name: 'M16-alert-ruler',
    why: '警报只认 blocked、不认 at-risk（药丸与项目屏「需要你出手」那一栏当场对不上）',
    file: `${S}/projectView.ts`,
    find: `    case 'blocked':
    case 'at-risk':
      return 'needsYou'`,
    to: `    case 'blocked':
      return 'needsYou'`,
    red: ['F3 警报药丸的数', 'F3 点药丸亮起来的'],
  },
  {
    name: 'M17-search-dead',
    why: '搜索结果点了没反应',
    file: `${S}/map/MapHud.tsx`,
    find: `    setOpen(false)
    onFocus({ kind: result.kind, id: result.id })`,
    to: `    setOpen(false)
    void result`,
    red: ['F4 点搜索结果'],
  },
  {
    name: 'M18-no-camera',
    why: '🔴 B3 的头号问题回来了：亮了，但那一簇在画面外，屏幕上只剩两个线头',
    file: `${S}/map/MapPanZoom.tsx`,
    find: `    ensureVisible(rect, framedOnceRef.current)`,
    to: `    void rect`,
    red: ['G1 镜头跟随', 'G1 镜头确实动了', 'H3 🔴 深链一进来镜头就已经框好'],
  },
  {
    name: 'M19-camera-always-moves',
    why: '镜头每次 focus 都居中一次——哪怕那一簇本来就整个在画面里（抢用户的镜头）',
    file: `${S}/map/MapPanZoom.tsx`,
    find: `    if (left >= EDGE_PAD && top >= EDGE_PAD && right <= safeW - EDGE_PAD && bottom <= safeH - EDGE_PAD) {
      return
    }`,
    to: `    if (false) {
      return
    }`,
    red: ['G2 🔴 本来就看得见'],
  },
  {
    name: 'M20-parse-new-kinds',
    why: '新的两种 focus 口不再解析（深链 `?focus=zone:…` 打开是一片全景）',
    file: `${S}/map/mapFocus.ts`,
    find: `  if (kind !== 'person' && kind !== 'project' && kind !== 'zone' && kind !== 'alert') return null`,
    to: `  if (kind !== 'person' && kind !== 'project') return null`,
    red: ['H1 深链直接打开就是亮的'],
  },
  {
    name: 'M21-ghost-focus',
    why: '查无此人时返回一个**空的高亮壳**：板上没有任何 is-subject，可整块板已经暗成一片',
    file: `${S}/map/mapFocus.ts`,
    find: `    if (!personNodes.has(target.id)) return null`,
    to: `    if (!personNodes.has(target.id)) return { subject, personIds: new Set([target.id]), projectIds: new Set(), edges: [] }`,
    red: ['H2 深链指向板上没有的东西'],
  },
]

const pick = ONLY ? MUTANTS.filter((m) => m.name.includes(ONLY)) : MUTANTS
if (pick.length === 0) {
  console.log(`没有匹配 --only=${ONLY} 的变异`)
  process.exit(1)
}

function build() {
  execFileSync('npx', ['vite', 'build', '--mode', 'development'], {
    env: { ...process.env, VITE_AVERY_API_BASE: API_BASE },
    stdio: 'ignore',
    shell: true,
  })
}

/** 跑门，返回红了的判据名清单（门自己吐的 `[FAIL] …` 行）。 */
function runGate() {
  const out = spawnSync('node', ['eval-harness/tools/verify-team-map.mjs'], {
    env: { ...process.env, VERIFY_BASE },
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  })
  const text = `${out.stdout || ''}${out.stderr || ''}`
  const fails = [...text.matchAll(/\[FAIL\] (.+)$/gm)].map((m) => m[1].split(' — ')[0].trim())
  if (!/\d+ PASS · \d+ FAIL/.test(text)) {
    return { fails, crashed: true, tail: text.slice(-600) }
  }
  return { fails, crashed: false }
}

console.log(`\n基线（未变异）先跑一遍……`)
build()
const baseline = runGate()
if (baseline.crashed || baseline.fails.length) {
  console.log('🔴 基线就不干净，先别谈变异：', baseline.fails.join(' | ') || baseline.tail)
  process.exit(1)
}
console.log('  基线全绿 ✓\n')

// 还原自查的**基准**：跑器开工前每个被动文件的原始字节。
// ⚠ 第一版拿 `git status -- src` 当基准，那是错的：B3 这一整摊本来就没提交，src 恒是脏的，
// 于是自查永远报「有残留」——一条永远为真的警报等于没有警报。基准必须是**跑器自己的起点**。
const snapshot = new Map()
for (const m of MUTANTS) if (!snapshot.has(m.file)) snapshot.set(m.file, readFileSync(m.file))

const report = []
for (const m of pick) {
  const orig = readFileSync(m.file) // Buffer —— 还原按字节，别过 utf8 一道手
  const text = orig.toString('utf8')
  // ⚠ 本仓文件行尾**不统一**：新写的是 LF，老文件（如 projectView.ts）是 CRLF。
  // 锚点里的 `\n` 在 CRLF 文件里一处都命不中，而那看起来和「变异存活」一模一样
  //（第一轮 M16 就是这么假绿的：药丸那把尺的变异根本没被写进去）。两种行尾各试一次。
  const variants = [
    { find: m.find, to: m.to },
    { find: m.find.replace(/\n/g, '\r\n'), to: m.to.replace(/\n/g, '\r\n') },
  ]
  const use = variants.find((v) => text.split(v.find).length - 1 === 1)
  if (!use) {
    const counts = variants.map((v) => text.split(v.find).length - 1).join('/')
    console.log(`🔴 ${m.name}: 锚点命中 ${counts} 处（LF/CRLF 各要恰好 1 处）——这一轮不是「变异存活」，是没改到`)
    report.push({ name: m.name, verdict: 'ANCHOR' })
    continue
  }
  writeFileSync(m.file, text.replace(use.find, use.to), 'utf8')
  let result
  try {
    build()
    result = runGate()
  } finally {
    writeFileSync(m.file, orig)
  }
  const want = m.red
  const hit = want.filter((w) => result.fails.some((f) => f.includes(w)))
  const extra = result.fails.filter((f) => !want.some((w) => f.includes(w)))
  const ok = m.expectSurvive
    ? result.fails.length === 0
    : hit.length === want.length && want.length > 0
  const verdict = ok ? (m.expectSurvive ? 'SURVIVED(预期)' : 'RED(预期)') : 'MISMATCH'
  report.push({ name: m.name, verdict, fails: result.fails, extra, crashed: result.crashed })
  console.log(
    `${ok ? '✓' : '🔴'} ${m.name} · ${verdict}` +
      (result.crashed ? ' · ⚠门崩了（不是判据红）' : '') +
      `\n    本该红: ${want.join(' | ') || '（无——预期存活）'}` +
      `\n    实际红: ${result.fails.join(' | ') || '（一条都没红）'}` +
      (extra.length ? `\n    连带红: ${extra.join(' | ')}` : '') +
      // 🔴 崩了就要把尾巴吐出来。第一版只印一句「门崩了」——而「崩」和「一条都没红」
      // 长得一模一样，看不出是判据没牙还是门在别处炸了（M01 第一轮就卡在这儿）。
      (result.crashed ? `\n    ── 门的尾巴 ──\n${result.tail}` : ''),
  )
}

// 还原自查：**逐字节**比对跑器开工前的快照（不是比 git HEAD——见 snapshot 那段的理由）。
build()
const dirty = [...snapshot.entries()]
  .filter(([f, bytes]) => !readFileSync(f).equals(bytes))
  .map(([f]) => f)
console.log(`\n还原自查（逐字节比跑器起点）：${dirty.length ? dirty.join(' | ') : '（每个字节都回去了）'}`)

const bad = report.filter((r) => r.verdict === 'MISMATCH' || r.verdict === 'ANCHOR')
console.log(`\n${report.length - bad.length} 轮如预期 · ${bad.length} 轮不符`)
if (bad.length || dirty.length) process.exitCode = 1
