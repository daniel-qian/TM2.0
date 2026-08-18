// team-map-revival-0804（#106 B3）· `/map` 团队地图的行为门。
//
// ## 这道门守的是什么
// 地图回答的是目录页和项目屏都答不了的那个问题：**「这家公司的活儿都压在谁身上」**。
// 它答得对的前提是四件事同时成立，而这四件事各自都能在没人发现的情况下坏掉：
//   ① 板真的画出来了、真的能拖（rzpp 是外部依赖，升一版镜头就可能停在 initialScale 上——
//      B1 实测过一次：所有计数判据全绿，只有截图上一片空白露了馅）；
//   ② 板上站的人 = 花名册上的人，分区 = 花名册的部门（另写一份 derive 就会漂，ADR-0034）；
//   ③ 连线 = 文档真读到 owner 的那些项目，**一条不多**（多一条 = 替客户认了一个人）；
//   ④ 人身上零数字（红线）。
// B3 又添了三个触发器（搜索 / 部门 chips / 警报药丸）和一台镜头，也一并在这里守。
//
// ## 🔴 判据纪律
// · **期望值一律在门这一侧手算**，算的是 `store.team`（花名册本身），不调任何被测的 derive。
//   拿 `deriveGroupFacets` 去验 `buildMapLayout` 是把尺子长在被量的东西上：布局一缩水，
//   期望值跟着缩水，变异全绿活下来。
// · 每条销毁类/否定式判据前面**先立对照基准**（calm 零连线之前先证明连线真能出现；
//   人节点零数字之前先证明板上确实有数字、且花名册里确实有人报了负载）。
// · 「拖动之后 focus 不变」的起手点**必须压在一个人节点上**——从空白处起拖验不到那个 bug
//   （rzpp 把内容跟着指针平移，同一个节点一直待在指针底下，抬手照常派发 click）。
// · 门语料天然全中文（demo-seed）。**末段整轮切 `lang=en` 再跑一遍红线判据**：
//   只有中文语料同样是盲点，宽度类的问题（英文文案更长）在中文侧永远不红。
//
// ## 数据从哪来
// **真上传** demo-seed 那九份中文 md（Files 屏的真 `<input class="upload-input">`），
// 与 `eval-harness/visual/visual-data.spec.mjs` 同一条路子。不走 `/demo/claim`：那条要求
// 后端配了 `AVERY_DEMO_SEED_DIR`，而 A 区的标准后端配方（AGENTS.md）里没有这一项，
// 少一个前提就少一种「门看着像坏了其实是没配」的假红。
// 🔴 因此这是一道**上传型门**（每跑一遍造一个 context），ROSTER 里 backend 必须为 true，
// 且**绝不能排在 C 区之后**——C 区跑完 dist 指向生产域名，那时的真上传是往生产库写数据。
//
// ## 跑法
//   后端 mock 三件套 :8137 + 前端 build+preview :5173，然后
//   node eval-harness/tools/verify-team-map.mjs
//   隔离端口：VERIFY_BASE=http://localhost:5393 node eval-harness/tools/verify-team-map.mjs
//   （dist 需 bake VITE_AVERY_API_BASE 指向那条隔离后端，后端 AVERY_CORS_ORIGINS 要放行它）
import { chromium } from 'playwright'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const UI = process.env.VERIFY_BASE || 'http://localhost:5173'
const HERE = dirname(fileURLToPath(import.meta.url))
const SEED_DIR = join(HERE, '..', 'tests', 'fixtures', 'demo-seed')

const R = []
const rec = (n, ok, d) => {
  R.push({ n, ok })
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${n}${d ? ' — ' + d : ''}`)
}

const seedFiles = () =>
  readdirSync(SEED_DIR)
    .filter((n) => n.endsWith('.md'))
    .sort()
    .map((n) => ({ name: n, mimeType: 'text/markdown', buffer: readFileSync(join(SEED_DIR, n)) }))

const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await ctx.newPage()
page.on('console', (m) => {
  if (m.type() === 'error') console.log('    [console.error]', m.text())
})

async function boot(lang) {
  await page.goto(`${UI}/?v=2&mode=live&look=paper&lang=${lang}`, { waitUntil: 'networkidle' })
  if (await page.locator('.lite-onboard').count()) {
    await page.keyboard.press('Escape')
    await page.waitForTimeout(500)
  }
}

await boot('zh')

// ── 上传：九份中文 md → 真 /ingest ────────────────────────────────────────────
await page.evaluate(() => window.__lite2Store.getState().goScreen('files'))
await page.locator('input.upload-input').setInputFiles(seedFiles())
await page.locator('.upload-ready, .upload-error').first().waitFor({ timeout: 90000 })
const uploadErrors = await page.locator('.upload-error').count()
rec('⓪ 上传落地（失败时这里红，别让后面的判据以「找不到节点」的形态假红）', uploadErrors === 0)

/**
 * 花名册**本身**（门这一侧的地面真值）。刻意只吃 `store.team`——它是 payload 过一次
 * `liteTeamFromPayload` 的结果，位于被测的 `buildMapLayout` / `resolveMapFocus` / `MapHud`
 * **上游**。下面每一个「应该是几」都由这份数据在门里手算出来。
 */
const roster = await page.evaluate(() => {
  const t = window.__lite2Store.getState().team
  return {
    people: (t?.people ?? []).map((p) => ({ id: p.id, name: p.name, team: (p.team ?? '').trim() })),
    projects: (t?.projects ?? []).map((p) => ({
      id: p.id,
      title: p.title,
      ownerId: (p.ownerId ?? '').trim(),
      statusRaw: (p.statusRaw ?? '').trim().toLowerCase(),
    })),
    // 自述负载那个百分数是全仓唯一被特许的人身数字（待在人卡的出处锚点里）。
    // 记下来当「零数字」判据的对照基准：语料里真有它，地图上一处都没有。
    loadReported: (t?.people ?? []).filter((p) => p.selfReport?.load?.value).length,
  }
})
const personIds = new Set(roster.people.map((p) => p.id))
// 部门数：有名分的部门各算一个，另外只要有人没写部门就多一个「未分组」桶。
const namedTeams = new Set(roster.people.map((p) => p.team).filter(Boolean))
const zonesExpected = namedTeams.size + (roster.people.some((p) => !p.team) ? 1 : 0)
// 「带 owner 的项目」= ownerId 非空**且**解得到花名册上的人。缺了不编：解不开的不画边。
const ownedProjects = roster.projects.filter((p) => p.ownerId && personIds.has(p.ownerId))
// 「需要你管的」= blocked / at-risk。这两个词在门里写死，不调 isNeedsYouStatus。
const alertExpected = roster.projects.filter((p) => p.statusRaw === 'blocked' || p.statusRaw === 'at-risk')

rec('⓪ 自证：语料够格（有人、有项目、有带 owner 的项目、有人报了自述负载）',
  roster.people.length >= 5 && roster.projects.length >= 3 && ownedProjects.length >= 2 &&
    roster.loadReported > 0,
  `${roster.people.length} 人 / ${roster.projects.length} 项目 / ${ownedProjects.length} 条带 owner / ${roster.loadReported} 人报了负载`)

// ── 入口：团队页 briefing 头的「地图视角」（票面 B1 那条入口，顺手守住） ──────
await page.evaluate(() => window.__lite2Store.getState().goScreen('team'))
await page.locator('.lite-team-map-entry').first().click()
await page.waitForSelector('.lite-map-person', { timeout: 20000 })
await page.waitForTimeout(400)

/**
 * 镜头此刻的 transform。
 * 🔴 量不到时**报告缺席**（`ok:false`），不抛。第一版直接 `getComputedStyle(el)`，
 * 于是「画布压根没挂上」这个变异把门炸成一条 TypeError 栈——A1 确实红了，但 A4 之后
 * 一条都没跑，整份报告只剩半页。门的职责是**说清楚哪儿坏了**，不是陪着一起崩。
 * ⚠ 凡是判「没变」的判据（A4 反面 / G2）必须同时判 `ok`：null === null 恒真，
 * 量不到会让它们变成一句「镜头一个像素都没动」的假绿。
 */
const readTransform = () =>
  page.evaluate(() => {
    const el = document.querySelector('.lite-map-canvas .react-transform-component')
    if (!el) return { ok: false, scale: NaN, x: NaN, y: NaN }
    const m = new DOMMatrixReadOnly(getComputedStyle(el).transform)
    return { ok: true, scale: Number(m.a.toFixed(4)), x: Math.round(m.e), y: Math.round(m.f) }
  })
const focusParam = () =>
  page.evaluate(() => new URLSearchParams(location.search).get('focus'))

// ════════════════════════════════════════════════════════════════════════════
// A · 画布挂载
// ════════════════════════════════════════════════════════════════════════════
const canvas = await page.evaluate(() => {
  const wrap = document.querySelector('.lite-map-canvas .react-transform-wrapper')
  const content = document.querySelector('.lite-map-canvas .react-transform-component')
  const cs = content ? getComputedStyle(content) : null
  const m = cs ? new DOMMatrixReadOnly(cs.transform) : null
  return {
    canvas: !!document.querySelector('.lite-map-canvas'),
    wrapper: !!wrap,
    boardW: content ? Math.round(content.getBoundingClientRect().width / (m?.a || 1)) : 0,
    scale: m ? Number(m.a.toFixed(4)) : 0,
    x: m ? Math.round(m.e) : 0,
    y: m ? Math.round(m.f) : 0,
  }
})
rec('A1 画布挂载（rzpp wrapper + content 真在 DOM 里）', canvas.canvas && canvas.wrapper)
rec('A2 board 有真尺寸（布局公式跑过了，不是一块 0×0 的板）', canvas.boardW > 600, `board≈${canvas.boardW}px`)
// 画布是这一整页的地基：镜头、拖动、复位、点空白全都长在它上面。它不在的时候继续跑下去，
// 得到的是一串「找不到元素」的超时噪音，最后还会以**门自己崩了**的形态收场——而崩掉的门
// 和「一条判据都没红」在跑器眼里长得一模一样（M01 第一轮实收）。所以到此为止，把话说清楚。
if (!canvas.wrapper) {
  console.log('\n⚠ 画布没挂上 —— 后面每一条判据都吃它，到此为止（不是跑完了，是跑不下去）。')
  await browser.close()
  const half = R.filter((r) => !r.ok)
  console.log(`\n${R.length - half.length} PASS · ${half.length} FAIL`)
  console.log('FAILED:', half.map((b) => b.n).join(' | '))
  process.exit(1)
}
// 🔴 initialScale 是 0.5：镜头没落位时它恰好停在这个值上，而所有计数判据照样全绿（B1 实测）。
rec('A3 初始镜头真落位了（scale 不是 rzpp 的 initialScale 0.5）',
  canvas.scale > 0.5 && canvas.scale <= 1.1, `scale=${canvas.scale}`)

// 🔴 A4 存在的唯一理由是**给第二把锁一道自己的门**。落位由两条独立的路管：
// 一条被动 effect（依赖里带 board）+ rzpp 的 onInit。B2 实测过：单看首帧它俩互为冗余，
// 拆掉任何一条 A3 都还是绿的——「A3 绿」读不出「两条都在起作用」。
// 被动 effect 的**独有射程**是换板（onInit 一辈子只响一次），所以这里真换一块板：
// 换了公司 / 加了人之后，镜头没有理由停在上一块板的坐标上。
const fitBefore = await readTransform()
await page.evaluate(() => {
  const full = window.__lite2Store.getState().team
  window.__lite2Store.setState({ team: { ...full, people: full.people.slice(0, 2) } })
})
await page.waitForTimeout(400)
const fitAfter = await readTransform()
rec('A4 换一块板 → 镜头重新落位（onInit 一辈子只响一次，够不着这条路）',
  fitAfter.scale !== fitBefore.scale || fitAfter.x !== fitBefore.x || fitAfter.y !== fitBefore.y,
  `${JSON.stringify(fitBefore)} → ${JSON.stringify(fitAfter)}`)

// 还原：整份花名册回到板上（reload 让 store 从后端重新取，比手工拼一份回去可信）。
await page.reload({ waitUntil: 'networkidle' })
if (await page.locator('.lite-onboard').count()) {
  await page.keyboard.press('Escape')
  await page.waitForTimeout(400)
}
await page.evaluate(() => window.__lite2Store.getState().goScreen('team'))
await page.locator('.lite-team-map-entry').first().click()
await page.waitForSelector('.lite-map-person', { timeout: 20000 })
await page.waitForTimeout(400)
rec('A4 还原：整份花名册回到板上（后面每一条判据都吃它）',
  (await page.locator('.lite-map-person').count()) === roster.people.length)

// ════════════════════════════════════════════════════════════════════════════
// B · pan 后 transform 真位移 + 拖动不抢 focus
// ════════════════════════════════════════════════════════════════════════════
const before = await readTransform()
// 🔴 起手点压在**一个人节点**上。从空白处起拖的话，「拖板会把节点选中」那个 bug 完全隐形。
const anchor = await page.locator('.lite-map-person').first().boundingBox()
await page.mouse.move(anchor.x + anchor.width / 2, anchor.y + anchor.height / 2)
await page.mouse.down()
await page.mouse.move(anchor.x + anchor.width / 2 - 160, anchor.y + anchor.height / 2 + 90, { steps: 12 })
await page.mouse.up()
await page.waitForTimeout(350)
const after = await readTransform()
rec('B1 pan 之后 transform 真位移了（不是只有指针动、板没动）',
  Math.abs(after.x - before.x) > 40 && Math.abs(after.y - before.y) > 20,
  `Δ=(${after.x - before.x}, ${after.y - before.y})`)
rec('B1 pan 不改缩放（拖动是平移，不是缩放）', after.ok && after.scale === before.scale)
rec('B2 🔴 从人节点上起手拖板**不会**把他选中（拖完仍是 calm）',
  (await focusParam()) === null && (await page.locator('.lite-map-person.is-subject').count()) === 0)

await page.locator('.lite-map-reset').click()
await page.waitForTimeout(450)

// ════════════════════════════════════════════════════════════════════════════
// C · 分区数 / 边数
// ════════════════════════════════════════════════════════════════════════════
const zoneKeys = await page.$$eval('.lite-map-zone', (ns) => ns.map((n) => n.dataset.zoneKey))
rec('C1 分区数 = 花名册部门数（期望值门里手算，不调被测的 derive）',
  zoneKeys.length === zonesExpected, `板上 ${zoneKeys.length} / 花名册 ${zonesExpected}`)
rec('C1 每个分区都对得上花名册里的一个部门（没有凭空多出来的分区）',
  zoneKeys.every((k) => namedTeams.has(k) || k === '__ungrouped__'), zoneKeys.join('/'))
rec('C2 板上的人数 = 花名册人数',
  (await page.locator('.lite-map-person').count()) === roster.people.length)
rec('C2 板上的项目条数 = 花名册项目数',
  (await page.locator('.lite-map-project').count()) === roster.projects.length)

// calm 零连线。⚠ 这是条销毁类判据（「没有」），所以它的对照基准在 C4：那里证明连线真出得来。
// 两句话分成两条：「一条线都没画」与「连线层整个不在 DOM 里」不是同一件事——
// 只判前者的话，一个恒渲染空 `<svg>` 的实现照样全绿，而票面写的是「SvgEdge 只在 focus 出现」。
rec('C3 calm 态一条连线都没有', (await page.locator('.lite-map-edge').count()) === 0)
rec('C3 calm 态连线层整个不在 DOM 里（不是渲染一个空 svg 壳）',
  (await page.locator('.lite-map-edge-layer').count()) === 0)

/** 点一个人（JS 派发 click：镜头可能已经把他挪出可视区，真指针点不着）。 */
async function focusPerson(id) {
  await page.evaluate((pid) => {
    document.querySelector(`.lite-map-person[data-person-id="${CSS.escape(pid)}"]`)?.click()
  }, id)
  await page.waitForTimeout(160)
}

let edgeTotal = 0
const edgePairs = []
for (const person of roster.people) {
  await focusPerson(person.id)
  const edges = await page.$$eval('.lite-map-edge', (ns) =>
    ns.map((n) => `${n.dataset.edgePerson}→${n.dataset.edgeProject}`))
  edgeTotal += edges.length
  edgePairs.push(...edges)
}
rec('C4 逐人点一遍的连线总数 = 带 owner 的项目数（多一条 = 替客户认了一个人）',
  edgeTotal === ownedProjects.length, `${edgeTotal} 条 / 应有 ${ownedProjects.length} 条`)
rec('C4 每条连线两端都指向花名册上真实存在的人与项目',
  edgePairs.every((pair) => {
    const [pid, prid] = pair.split('→')
    return personIds.has(pid) && roster.projects.some((p) => p.id === prid)
  }), `${edgePairs.length} 条`)
rec('C4 每条连线的 (人,项目) 恰好对上文档读到的 owner 关系',
  edgePairs.length === new Set(edgePairs).size &&
    ownedProjects.every((p) => edgePairs.includes(`${p.ownerId}→${p.id}`)))

// ════════════════════════════════════════════════════════════════════════════
// D · focus 点亮 / 复位
// ════════════════════════════════════════════════════════════════════════════
// 挑一个背着不止一件事的人：1:1 的语料下「每人恒 1 条边」的错实现会一路全绿。
const ownerTally = new Map()
for (const p of ownedProjects) ownerTally.set(p.ownerId, (ownerTally.get(p.ownerId) ?? 0) + 1)
const [busiestId, busiestCount] = [...ownerTally.entries()].sort((a, b) => b[1] - a[1])[0] ?? []
rec('D0 自证：语料里有人背着不止一件事（否则 D1 的边数判据没有分辨力）', busiestCount >= 1,
  `${roster.people.find((p) => p.id === busiestId)?.name} 背 ${busiestCount} 件`)

await focusPerson(busiestId)
const lit = await page.evaluate(() => ({
  subjects: [...document.querySelectorAll('.lite-map-person.is-subject')].map((n) => n.dataset.personId),
  linkedProjects: [...document.querySelectorAll('.lite-map-project.is-linked')].map((n) => n.dataset.projectId),
  edges: document.querySelectorAll('.lite-map-edge').length,
  cards: document.querySelectorAll('.lite-map-node-card').length,
  focus: new URLSearchParams(location.search).get('focus'),
}))
rec('D1 点人 → 他是主角、他背的那几件全亮、连线条数对上',
  lit.subjects.length === 1 && lit.subjects[0] === busiestId &&
    lit.edges === busiestCount && lit.linkedProjects.length === busiestCount,
  JSON.stringify(lit))
rec('D1 URL 写上了可分享的 token', lit.focus === `person:${busiestId}`)
rec('D1 被点的那个原位长出 mini 卡（恰好一张）', lit.cards === 1)

// 🔴 D1b —— 这条是 0818 那个真 bug 逼出来的，形态见 lite2.css 的
// `.lite-map-person .lite-map-node-card` 那段碑：入场动画 `both` 填充的 to 帧写 `transform: none`，
// 动画一跑完就把居中用的 translateX(-50%) 永久抹掉，卡片停在偏右半个身位。
// ⚠ 判据必须**等动画跑完再量**（200ms）：动画进行中它恰好还在正确位置上，早量一帧就是假绿。
// ⚠ 也别拿 `getComputedStyle(...).transform` 当判据——那量的是实现手段。量的是「卡有没有对准
// 它挂着的那个人」，实现换成 margin/translate 属性都不该红。
await page.waitForTimeout(400)
const centering = await page.evaluate(() => {
  const card = document.querySelector('.lite-map-person .lite-map-node-card')
  if (!card) return null
  const node = card.closest('.lite-map-person')
  const c = card.getBoundingClientRect(), n = node.getBoundingClientRect()
  return { off: Math.round(c.x + c.width / 2 - (n.x + n.width / 2)), cardW: Math.round(c.width) }
})
// 容差取卡宽的 5%：镜头缩放下半个身位是 cardW/2，5% 离它远得很，够不着的错实现红不了才怪。
rec('D1b mini 卡横向对准它挂着的那个人（动画跑完之后）',
  !!centering && Math.abs(centering.off) <= Math.max(2, centering.cardW * 0.05),
  centering ? `偏 ${centering.off}px（卡宽 ${centering.cardW}，半个身位=${Math.round(centering.cardW / 2)}）` : '没找到卡')

await page.keyboard.press('Escape')
await page.waitForTimeout(300)
rec('D2 Esc → 回 calm（高亮、连线、URL 三样一起收）',
  (await focusParam()) === null &&
    (await page.locator('.lite-map-edge').count()) === 0 &&
    (await page.locator('.lite-map-person.is-subject').count()) === 0)

await focusPerson(busiestId)
await page.locator('.lite-map-clear-focus').click()
await page.waitForTimeout(300)
rec('D3 「回到全景」→ 回 calm', (await focusParam()) === null &&
  (await page.locator('.lite-map-edge').count()) === 0)

// 点空白：先扫出一个真落在画布上、且不压任何节点/HUD 的点。
await focusPerson(busiestId)
const blank = await page.evaluate(() => {
  const box = document.querySelector('.lite-map-canvas').getBoundingClientRect()
  for (let dy = 0.85; dy > 0.2; dy -= 0.05) {
    for (let dx = 0.05; dx < 0.95; dx += 0.05) {
      const x = box.left + box.width * dx
      const y = box.top + box.height * dy
      const el = document.elementFromPoint(x, y)
      if (!el || !el.closest('.lite-map-canvas')) continue
      if (el.closest('.lite-map-person, .lite-map-project, .lite-map-controls')) continue
      return { x, y }
    }
  }
  return null
})
rec('D4 自证：真找得到一个空白点（找不到就别把下一条读成「点空白有效」）', !!blank)
if (blank) {
  await page.mouse.click(blank.x, blank.y)
  await page.waitForTimeout(300)
  rec('D4 点空白 → 回 calm', (await focusParam()) === null &&
    (await page.locator('.lite-map-edge').count()) === 0)
}

// ════════════════════════════════════════════════════════════════════════════
// E · 人卡区零数字（红线）
// ════════════════════════════════════════════════════════════════════════════
/**
 * 两把尺量同一条红线，各有各的射程：
 *  · 文本尺：人节点子树里渲染出来的字，一个数字都不许有。
 *  · **几何尺（按显示宽度）**：整块板上任何带数字的文字，它的**文字矩形**不许压在
 *    任何人节点的框上。文本尺看不见「数字由另一层画在他头上」——透明的层不进子树，
 *    textContent 永远干净；量矩形才看得见。
 */
const zeroDigits = await page.evaluate(() => {
  const digit = /\d/
  const people = [...document.querySelectorAll('.lite-map-person')]
  const textHits = people
    .map((n) => (n.innerText || '').trim())
    .filter((s) => digit.test(s))

  // 板上所有含数字的文字节点 → 它们的真实文字矩形（Range，不是元素盒子）。
  const rects = []
  const walker = document.createTreeWalker(
    document.querySelector('.lite-map-world') ?? document.body,
    NodeFilter.SHOW_TEXT,
  )
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!digit.test(node.nodeValue || '')) continue
    const range = document.createRange()
    range.selectNodeContents(node)
    for (const r of range.getClientRects()) {
      if (r.width > 0 && r.height > 0) rects.push({ text: node.nodeValue.trim(), r })
    }
  }
  const hits = (a, b) =>
    a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
  const overlaps = []
  for (const person of people) {
    const box = person.getBoundingClientRect()
    for (const { text, r } of rects) if (hits(r, box)) overlaps.push(text)
  }
  return { textHits, overlaps, digitTextsOnBoard: rects.length }
})
// 🔴 对照基准：板上**确实**有数字（项目 progress%）。没有这一条，上面两把尺都是空真。
rec('E0 自证：板上确实印着数字（项目 progress% —— 项目可硬）',
  zeroDigits.digitTextsOnBoard > 0, `${zeroDigits.digitTextsOnBoard} 处`)
rec('E1 🔴 人节点子树里一个数字都没有（人身零数字）',
  zeroDigits.textHits.length === 0, JSON.stringify(zeroDigits.textHits.slice(0, 3)))
rec('E2 🔴 按显示宽度：没有任何带数字的文字压在人节点的框上',
  zeroDigits.overlaps.length === 0, JSON.stringify(zeroDigits.overlaps.slice(0, 3)))

// ════════════════════════════════════════════════════════════════════════════
// F · HUD-lite 三触发器
// ════════════════════════════════════════════════════════════════════════════
const chips = await page.$$eval('.lite-map-chip', (ns) => ns.map((n) => n.textContent.trim()))
const chipKeys = await page.$$eval('.lite-map-chip', (ns) => ns.map((n) => n.dataset.zoneKey))
// 比**集合**不比个数：个数一样但指向另一批分区的 HUD，只数个数的判据看不出来。
rec('F1 chips 一个不多一个不少地对上板上的分区',
  chipKeys.length === zoneKeys.length && zoneKeys.every((k) => chipKeys.includes(k)),
  `${chipKeys.length} 个 chip / ${zoneKeys.length} 个分区`)
rec('F1 🔴 chip 上零数字（没有部门人数——那是一张人数排行榜）',
  chips.every((c) => !/\d/.test(c)), chips.join('/'))

// 🔴 挑**人最多**的那个部门，不是第一个。第一版挑的是 zoneKeys[0]（总经理室，1 个人），
// 于是「这一组人全亮」在 1 个人的组上恒真——一个「只亮第一个成员」的错实现照样全绿。
// 判据要落在能分辨对错的那个实例上。
const zoneKey = [...namedTeams]
  .map((k) => ({ k, n: roster.people.filter((p) => p.team === k).length }))
  .sort((a, b) => b.n - a.n)[0].k
const zoneMembers = roster.people.filter((p) => p.team === zoneKey).map((p) => p.id)
rec('F2 自证：拿来验的这个部门不止一个人（否则「全亮」在它身上恒真）',
  zoneMembers.length > 1, `${zoneKey} ${zoneMembers.length} 人`)
// 🔴 按 data-zone-key 找，不按文案找。按文案找的话，「chip 上多了个数字」那个变异会让门
// 连点都点不到，于是一条讲数字的判据顺手把三条讲行为的判据一起拖红（第一轮变异实收）。
await page.evaluate((k) => {
  document.querySelector(`.lite-map-chip[data-zone-key="${CSS.escape(k)}"]`)?.click()
}, zoneKey)
await page.waitForTimeout(350)
const zoneLit = await page.evaluate(() => ({
  focus: new URLSearchParams(location.search).get('focus'),
  people: [...document.querySelectorAll('.lite-map-person.is-linked')].map((n) => n.dataset.personId),
  zoneSubject: document.querySelector('.lite-map-zone.is-subject')?.dataset.zoneKey ?? null,
  cards: document.querySelectorAll('.lite-map-node-card').length,
}))
rec('F2 点部门 chip → `?focus=zone:<部门>`（跟着可分享）', zoneLit.focus === `zone:${zoneKey}`)
rec('F2 点部门 chip → 这一组人全亮，且只有这一组',
  zoneLit.people.length === zoneMembers.length && zoneMembers.every((id) => zoneLit.people.includes(id)),
  `${zoneLit.people.length} / 应有 ${zoneMembers.length}`)
rec('F2 被点的分区自己站到前面来', zoneLit.zoneSubject === zoneKey)
rec('F2 组级 focus 不挑一个人把他的卡打开（组级问题要组级答案）', zoneLit.cards === 0)

await page.evaluate((k) => {
  document.querySelector(`.lite-map-chip[data-zone-key="${CSS.escape(k)}"]`)?.click()
}, zoneKey)
await page.waitForTimeout(300)
rec('F2 同一个 chip 再点一次 → 回全景（chip 是开关）', (await focusParam()) === null)

const alertText = await page.locator('.lite-map-alert-count').textContent()
rec('F3 警报药丸的数 = 手算的 blocked/at-risk 项目数',
  Number(alertText) === alertExpected.length, `${alertText} / 应有 ${alertExpected.length}`)
rec('F3 自证：语料里确实有要你管的项目（否则药丸整条判据是空真）', alertExpected.length > 0)
await page.locator('.lite-map-alert').click()
await page.waitForTimeout(400)
const alertLit = await page.evaluate(() => ({
  focus: new URLSearchParams(location.search).get('focus'),
  projects: [...document.querySelectorAll('.lite-map-project.is-linked')].map((n) => n.dataset.projectId),
}))
rec('F3 点药丸 → `?focus=alert:needsYou`', alertLit.focus === 'alert:needsYou')
rec('F3 点药丸亮起来的，恰好就是那几件（药丸上的数与亮起来的条数由同一把尺决定）',
  alertLit.projects.length === alertExpected.length &&
    alertExpected.every((p) => alertLit.projects.includes(p.id)),
  JSON.stringify(alertLit.projects))

// 搜索。名字取花名册第一个人，保证一定命中。
const who = roster.people[0]
await page.locator('.lite-map-search-input').fill(who.name)
await page.waitForTimeout(300)
const hits = await page.$$eval('.lite-map-search-hit-label', (ns) => ns.map((n) => n.textContent.trim()))
rec('F4 搜索命中真人（复用顶栏那把 searchTeam）', hits.includes(who.name), hits.join('/'))
await page.evaluate((name) => {
  [...document.querySelectorAll('.lite-map-search-hit')]
    .find((b) => b.querySelector('.lite-map-search-hit-label')?.textContent.trim() === name)?.click()
}, who.name)
await page.waitForTimeout(350)
rec('F4 点搜索结果 → focus 落到那个人身上', (await focusParam()) === `person:${who.id}`)
rec('F4 选完把结果面板收起来（它盖在板上，而人此刻正在看板）',
  (await page.locator('.lite-map-search-results').count()) === 0)

await page.locator('.lite-map-search-input').fill('zzz-不存在的东西-zzz')
await page.waitForTimeout(300)
rec('F4 零命中要说出来（静默的空列表读起来像卡住了）',
  (await page.locator('.lite-map-search-empty').count()) === 1)
await page.locator('.lite-map-search-input').fill('')
await page.keyboard.press('Escape')
await page.waitForTimeout(250)

// ════════════════════════════════════════════════════════════════════════════
// G · 镜头跟随（B3 的新机器：点亮了却在画面外 = 白点）
// ════════════════════════════════════════════════════════════════════════════
/** 亮起来的节点此刻在不在画面里。 */
const litOnScreen = () =>
  page.evaluate(() => {
    const box = document.querySelector('.lite-map-canvas').getBoundingClientRect()
    const lit = [...document.querySelectorAll('.lite-map-person.is-linked, .lite-map-person.is-subject, .lite-map-project.is-linked, .lite-map-project.is-subject')]
    const inside = lit.filter((n) => {
      const r = n.getBoundingClientRect()
      return r.left >= box.left - 1 && r.right <= box.right + 1 &&
        r.top >= box.top - 1 && r.bottom <= box.bottom + 1
    })
    return { total: lit.length, inside: inside.length }
  })

// 🔴 先把 focus 清干净再开工。不清的话本段会**继承上一段的状态**：F4 那次搜索若没生效，
// 药丸此刻仍是按下的，下面这一下点击就成了「再点一次 = 关掉」，一个都不亮 ⇒ G1 红。
// 那是一条被别处的坏拖红的判据，读起来像镜头坏了（第一轮变异实收：M17 拖红了 G1）。
await page.keyboard.press('Escape')
await page.waitForTimeout(250)
rec('G0 本段起点是干净的 calm（不继承上一段的 focus）', (await focusParam()) === null)
await page.locator('.lite-map-reset').click()
await page.waitForTimeout(450)
// 🔴 **判据得自己造出前提**。第一版是「复位 → 点药丸 → 亮的都在画面里」，53 条全绿，
// 而它自己打印的对照数字露了馅：复位帧上那一簇本来就全看得见（demo-seed 的板小），
// 于是「镜头把它们带回来了」是句空真——镜头一步没动它也是绿的。
// 现在先把板拖到一边，把那一簇真正推出画面，再点药丸。这也正是真实的那一下：
// 人先拖到别处看别的，然后点了个搜索结果 / 药丸。
const away = await page.evaluate(() => {
  const box = document.querySelector('.lite-map-canvas').getBoundingClientRect()
  return { x: box.left + box.width * 0.2, y: box.top + box.height * 0.3 }
})
await page.mouse.move(away.x, away.y)
await page.mouse.down()
await page.mouse.move(away.x + 900, away.y + 420, { steps: 16 })
await page.mouse.up()
await page.waitForTimeout(350)
const camBefore = await readTransform()
const offBefore = await page.evaluate((ids) => {
  const box = document.querySelector('.lite-map-canvas').getBoundingClientRect()
  return ids.filter((id) => {
    const n = document.querySelector(`.lite-map-project[data-project-id="${CSS.escape(id)}"]`)
    if (!n) return false
    const r = n.getBoundingClientRect()
    return r.left < box.left || r.right > box.right || r.top < box.top || r.bottom > box.bottom
  }).length
}, alertExpected.map((p) => p.id))
rec('G1 对照基准：点之前，要亮的那几件**确实**在画面外（否则下一条是空真）',
  offBefore > 0, `${offBefore}/${alertExpected.length} 件出画`)

await page.locator('.lite-map-alert').click()
await page.waitForTimeout(700)
const camAfter = await readTransform()
const onScreen = await litOnScreen()
rec('G1 镜头跟随：亮起来的那一簇，动完之后全在画面里',
  onScreen.total > 0 && onScreen.inside === onScreen.total,
  `${onScreen.inside}/${onScreen.total} 在画面内`)
rec('G1 镜头确实动了（不是恰好没动也全绿）',
  camAfter.x !== camBefore.x || camAfter.y !== camBefore.y || camAfter.scale !== camBefore.scale,
  `${JSON.stringify(camBefore)} → ${JSON.stringify(camAfter)}`)
rec('G1 镜头只缩小、绝不放大（放大读起来像它替我决定了该看多近）',
  camAfter.scale <= camBefore.scale + 1e-6, `${camBefore.scale} → ${camAfter.scale}`)

// G2：本来就全看得见的那一次 focus，镜头**一个像素都不许动**。
await page.locator('.lite-map-reset').click()
await page.waitForTimeout(450)
const stillBefore = await readTransform()
// 挑一个「他自己 + 他背的活」原本就整个在画面里的人。**优先挑真背着活的**——
// 只挑一个孤零零的人的话，这条判据框住的那个方框只有一个圆点那么大，几乎必然装得下，
// 它就退化成「镜头对着一个点不动」，验不到「一簇东西本来就装得下时也不动」。
const cozy = await page.evaluate((owns) => {
  const box = document.querySelector('.lite-map-canvas').getBoundingClientRect()
  const fits = (n) => {
    if (!n) return false
    const r = n.getBoundingClientRect()
    return r.left >= box.left && r.right <= box.right && r.top >= box.top && r.bottom <= box.bottom
  }
  const clusterFits = (id) =>
    fits(document.querySelector(`.lite-map-person[data-person-id="${CSS.escape(id)}"]`)) &&
    (owns[id] ?? []).every((pid) =>
      fits(document.querySelector(`.lite-map-project[data-project-id="${CSS.escape(pid)}"]`)))
  const withWork = Object.keys(owns).find(clusterFits)
  if (withWork) return withWork
  const any = [...document.querySelectorAll('.lite-map-person')].find(fits)
  return any?.dataset.personId ?? null
}, Object.fromEntries(
  [...ownerTally.keys()].map((id) => [id, ownedProjects.filter((p) => p.ownerId === id).map((p) => p.id)]),
))
rec('G2 自证：找得到一个原本就整个在画面里的人', !!cozy)
if (cozy) {
  await focusPerson(cozy)
  await page.waitForTimeout(500)
  const stillAfter = await readTransform()
  const stayed = stillAfter.ok && stillBefore.ok &&
    stillAfter.x === stillBefore.x && stillAfter.y === stillBefore.y &&
    stillAfter.scale === stillBefore.scale
  const cozyOn = await litOnScreen()
  rec('G2 自证：这一簇 focus 之后确实全在画面里（否则「没动」是错的，不是对的）',
    cozyOn.total > 0 && cozyOn.inside === cozyOn.total)
  rec('G2 🔴 本来就看得见 → 镜头一个像素都不动（别抢用户的镜头）', stayed,
    `${JSON.stringify(stillBefore)} → ${JSON.stringify(stillAfter)}`)
}

// ════════════════════════════════════════════════════════════════════════════
// H · 深链（可分享）
// ════════════════════════════════════════════════════════════════════════════
await page.goto(`${UI}/map?v=2&mode=live&look=paper&lang=zh&focus=zone:${encodeURIComponent(zoneKey)}`,
  { waitUntil: 'networkidle' })
await page.waitForSelector('.lite-map-person', { timeout: 20000 })
await page.waitForTimeout(500)
rec('H1 深链直接打开就是亮的（发给合伙人他看到同一屏）',
  (await page.locator('.lite-map-zone.is-subject').count()) === 1 &&
    (await page.locator('.lite-map-person.is-linked').count()) === zoneMembers.length)
await page.goto(`${UI}/map?v=2&mode=live&look=paper&lang=zh&focus=person:查无此人`,
  { waitUntil: 'networkidle' })
await page.waitForSelector('.lite-map-person', { timeout: 20000 })
await page.waitForTimeout(400)
// 🔴 判「整块板没有被暗下去」，不只判「没有 is-subject」：查无此人时若返回一个空的高亮壳，
// 板上确实没有任何节点会顶着 is-subject（那个 id 根本没有节点），可整块板已经暗了一片——
// 屏幕上是「大家都不相干」，而真相是「这个人不在这儿」。只数 is-subject 的判据看不见这个。
rec('H2 深链指向板上没有的东西 → 老老实实回全景，不画一个指向空气的高亮',
  (await page.locator('.lite-map-person.is-subject').count()) === 0 &&
    (await page.locator('.lite-map-edge').count()) === 0 &&
    (await page.locator('.lite-map-world.is-focused').count()) === 0)

// 🔴 H3 · **深链的镜头**，在手机视口上量。
// 这一条是补的：`/map?focus=…` 直接打开时镜头不跟随，而板上亮着的那一簇整个在画面外——
// 桌面 1440 上那一簇恰好装得下，所以桌面的判据、人眼、连 G1（那条是**点击之后**的路径）
// 全都放过了它。是像素基线的手机那张把它逼出来的。判据要落在**分辨得出对错的那个视口**上。
await page.setViewportSize({ width: 375, height: 812 })
await page.goto(`${UI}/map?v=2&mode=live&look=paper&lang=zh&focus=person:${encodeURIComponent(busiestId)}`,
  { waitUntil: 'networkidle' })
await page.waitForSelector('.lite-map-person', { timeout: 20000 })
await page.waitForTimeout(800)
const deepLinkFramed = await litOnScreen()
// 对照基准：不跟随的话（＝复位到 fit 帧）这一簇确实装不下——否则下一条是空真。
await page.locator('.lite-map-reset').click()
await page.waitForTimeout(500)
const deepLinkAtFit = await litOnScreen()
rec('H3 对照基准：手机竖屏的 fit 帧确实框不下这一簇（否则下一条没有分辨力）',
  deepLinkAtFit.total > 0 && deepLinkAtFit.inside < deepLinkAtFit.total,
  `fit 帧下 ${deepLinkAtFit.inside}/${deepLinkAtFit.total} 在画面内`)
rec('H3 🔴 深链一进来镜头就已经框好（不是先给一眼全景，也不是把那一簇扔在画面外）',
  deepLinkFramed.total > 0 && deepLinkFramed.inside === deepLinkFramed.total,
  `${deepLinkFramed.inside}/${deepLinkFramed.total} 在画面内`)
await page.setViewportSize({ width: 1440, height: 900 })

// ════════════════════════════════════════════════════════════════════════════
// I · en 侧（防「只中文语料」的反向盲点）
// ════════════════════════════════════════════════════════════════════════════
// 人名/部门名仍是中文（那是客户的数据），但整套 HUD 与卡面文案换成英文——英文更长，
// 宽度类的坏（裁掉、溢出）只在这一侧才红得出来。
await page.goto(`${UI}/map?v=2&mode=live&look=paper&lang=en`, { waitUntil: 'networkidle' })
await page.waitForSelector('.lite-map-person', { timeout: 20000 })
await page.waitForTimeout(500)
const en = await page.evaluate(() => {
  const digit = /\d/
  const clipped = [...document.querySelectorAll('.lite-map-chip, .lite-map-alert-label, .lite-map-search-input')]
    .filter((n) => n.scrollWidth > n.clientWidth + 1)
    .map((n) => n.textContent.trim() || n.placeholder)
  return {
    hud: !!document.querySelector('.lite-map-search-input') &&
      document.querySelectorAll('.lite-map-chip').length > 0,
    chipDigits: [...document.querySelectorAll('.lite-map-chip')]
      .filter((n) => digit.test(n.textContent)).length,
    personDigits: [...document.querySelectorAll('.lite-map-person')]
      .filter((n) => digit.test(n.innerText || '')).length,
    clipped,
  }
})
rec('I1 en 侧 HUD 三件套照样在', en.hud)
rec('I1 en 侧 chip 仍然零数字', en.chipDigits === 0)
rec('I1 en 侧人节点仍然零数字（红线不分语言）', en.personDigits === 0)
rec('I2 en 侧 HUD 控件里没有被裁掉的文案（按显示宽度量，不按 .length）',
  en.clipped.length === 0, JSON.stringify(en.clipped))

await browser.close()
const bad = R.filter((r) => !r.ok)
console.log(`\n${R.length - bad.length} PASS · ${bad.length} FAIL`)
if (bad.length) {
  console.log('FAILED:', bad.map((b) => b.n).join(' | '))
  process.exit(1)
}
