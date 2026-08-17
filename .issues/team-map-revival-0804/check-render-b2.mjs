// team-map-revival-0804 · B2 · focus 机器的**真渲染**判据（浏览器，无后端）。
//
// 跑法（仓库根）：
//   VITE_AVERY_API_BASE=http://127.0.0.1:8147 npx vite build --mode development
//   npx vite preview --port 5183 --host 127.0.0.1        # 另开一个
//   VERIFY_BASE=http://127.0.0.1:5183 node .issues/team-map-revival-0804/check-render-b2.mjs
// 80 人 fixture 在 Node 侧过真 derive 后灌进 `__lite2Store`，不需要后端。
//
// ⚠ **这不是一道门**（名字里刻意没有 `verify-`）——理由见 `check-focus-b2.mjs` 文件头。
//
// 判据分两世界跑：人身自述开关**开**（组级读数该出现）与**关**（一个情绪词都不许出现）。
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
import { Buffer } from 'node:buffer'
import { fileURLToPath } from 'node:url'
import esbuild from 'esbuild'

const BASE = process.env.VERIFY_BASE || 'http://127.0.0.1:5183'
const Q = '?v=2&mode=live&look=paper&lang=en'
const OUT = process.env.SHOT_DIR || '.issues/team-map-revival-0804/shots'

const built = await esbuild.build({
  stdin: {
    contents: "export { liteTeamFromPayload } from './src/lite2/teamData'",
    resolveDir: fileURLToPath(new URL('../..', import.meta.url)),
    loader: 'ts',
    sourcefile: 'e.ts',
  },
  bundle: true, write: false, format: 'esm', platform: 'neutral', target: 'es2022',
  define: { 'import.meta.env': '__VITE_ENV_SHIM__' },
  banner: { js: 'const __VITE_ENV_SHIM__ = {};' },
})
const { liteTeamFromPayload } = await import(
  'data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text, 'utf8').toString('base64')
)
const payload = JSON.parse(
  readFileSync(new URL('./fixtures/team-80.json', import.meta.url), 'utf8'),
)
const teamOn = liteTeamFromPayload({ ...payload, scoring_enabled: true })
const teamOff = liteTeamFromPayload({ ...payload, scoring_enabled: false })

let failed = 0
let passed = 0
function check(label, got, want) {
  if (JSON.stringify(got) === JSON.stringify(want)) {
    passed += 1
    console.log(`  ✓ ${label}`)
    return
  }
  failed += 1
  console.log(`  🔴 ${label}\n     got  ${JSON.stringify(got)}\n     want ${JSON.stringify(want)}`)
}

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await ctx.newPage()
// onboarding 闸门（首访自动掀开）会盖住整页并吃掉所有点击——它对 /map 与对别的屏一视同仁，
// 是对的行为；这里预置成「看过了」，好让本脚本量的是地图本身。
await page.addInitScript(() => {
  try {
    window.localStorage.setItem('lite2:onboard:v1', JSON.stringify({ status: 'done', step: 0 }))
  } catch {}
})
const errs = []
page.on('pageerror', (e) => errs.push(String(e)))
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()) })

async function seed(team, id) {
  await page.evaluate(
    ([t, cid]) => window.__lite2Store.setState({ contextId: cid, team: t, rawTeam: null }),
    [team, id],
  )
  await page.waitForSelector('.lite-map-person', { timeout: 20000 })
  await page.waitForTimeout(350)
}

const counts = () =>
  page.evaluate(() => ({
    edges: document.querySelectorAll('.lite-map-edge').length,
    cards: document.querySelectorAll('.lite-map-node-card').length,
    subjects: document.querySelectorAll('.is-subject').length,
    linkedPeople: document.querySelectorAll('.lite-map-person.is-linked').length,
    linkedProjects: document.querySelectorAll('.lite-map-project.is-linked').length,
    dimmed: document.querySelectorAll('.is-dimmed').length,
    focusParam: new URLSearchParams(location.search).get('focus'),
  }))

/**
 * 点一个节点。
 *
 * ⚠ 用 `el.click()` 而不是真鼠标：board 有 3476×2522，首帧镜头只框得住左上角一块，
 * 24 根项目条里绝大多数在画面外——真鼠标够不着，硬点会点到别的东西上（第一版就这么
 * 假红过）。`el.click()` 派发的是一次**真的 click 事件**，照样走 React 的整条处理链
 * （含新加的捕获期拖动抑制），只是绕过浏览器的命中测试。
 * 「命中测试对不对」由下面那条 elementFromPoint 判据 + 拖动判据单独钉，不靠这里。
 */
const clickNode = async (sel) => {
  await page.evaluate((s) => document.querySelector(s).click(), sel)
  await page.waitForTimeout(320)
}

// ── ① calm：一条连线都不许有 ────────────────────────────────────────────────
console.log('\n[calm]')
await page.goto(`${BASE}/map${Q}`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => !!window.__lite2Store, null, { timeout: 20000 })
await seed(teamOn, 'ctx_synth_80')
check('calm 态零连线（连线只在 focus 出现）', (await counts()).edges, 0)
check('calm 态零 mini 卡', (await counts()).cards, 0)
check('calm 态没有任何节点被压暗', (await counts()).dimmed, 0)

// 🔴 实测「点得到吗」——三个 world 分层都是整块板、互相完全重叠，谁吃指针是 CSS 说了算，
// 读代码读不出来（本仓吃过 backdrop-filter 建包含块那种暗规则的亏）。
const hitTest = await page.evaluate(() => {
  const node = document.querySelector('[data-person-id="u_0"]')
  const r = node.getBoundingClientRect()
  const el = document.elementFromPoint(r.x + r.width / 2, r.y + 12)
  return {
    inside: !!el?.closest('[data-person-id="u_0"]'),
    hit: el?.className?.toString?.().slice(0, 60) ?? null,
  }
})
check(`人节点中心真的命中它自己（实测 elementFromPoint，命中的是 ${hitTest.hit}）`, hitTest.inside, true)

// ── ② 点人 → 亮「他 + 他 owned 的项目」 ─────────────────────────────────────
console.log('\n[点人]')
// 期望值从 payload 独立算：u_0 背着几件事，就该有几条边、几根条被点亮。
const ownedByU0 = payload.projects.filter((p) => p.ownerId === 'u_0').map((p) => p.id)
await clickNode('[data-person-id="u_0"]')
const afterPerson = await counts()
check('URL 写上了 focus（可分享）', afterPerson.focusParam, 'person:u_0')
check('边数 = 他 owned 的项目数', afterPerson.edges, ownedByU0.length)
check('被点的那个是唯一的 subject', afterPerson.subjects, 1)
check('他 owned 的项目条全部点亮', afterPerson.linkedProjects, ownedByU0.length)
check('mini 卡恰好一张', afterPerson.cards, 1)
const personCard = await page.evaluate(() => {
  const node = document.querySelector('[data-person-id="u_0"]')
  return {
    role: node.querySelector('.lite-map-node-role')?.textContent?.trim() ?? null,
    read: node.querySelector('.lite-map-node-read')?.textContent?.trim() ?? null,
    cta: node.querySelector('.lite-map-node-cta')?.getAttribute('href') ?? null,
    expanded: node.querySelector('.lite-card-open')?.getAttribute('aria-expanded'),
  }
})
check('mini 卡有职位', personCard.role, 'Head of Platform Engineering')
check('mini 卡有定性自述读（非空）', (personCard.read ?? '').length > 0, true)
check('「打开档案」指向人详情深链', personCard.cta?.startsWith('/team/u_0'), true)
check('🔴「打开档案」不把 focus 带出 /map（路径作用域）', /[?&]focus=/.test(personCard.cta ?? ''), false)
check('姓名按钮 aria-expanded 跟着开', personCard.expanded, 'true')

// 🔴 人身零数字：u_0 的自述负载 91% 在语料里**真的在**，地图上一处都不许出现。
const personLayerLeak = await page.evaluate(() => {
  const text = [...document.querySelectorAll('.lite-map-person')].map((n) => n.textContent).join('\n')
  return {
    percent: /\d{1,3}\s*%/.test(text) ? text.match(/[^\n]*\d{1,3}\s*%[^\n]*/)[0] : null,
    bloodBar: /\b(?:mood|capacity)\s*[:%]/i.test(text),
  }
})
check('🔴 人节点上零百分数（自述负载 91% 没漏上图）', personLayerLeak.percent, null)
check('🔴 人节点上零血条形状', personLayerLeak.bloodBar, false)
await page.screenshot({ path: `${OUT}/b2-focus-person.png` })

// ── ③ 拖动 ≠ 点空白（focus 必须活下来） ───────────────────────────────────
console.log('\n[拖动 vs 点空白]')
const canvas = await page.locator('.lite-map-canvas').boundingBox()

// 🔴 起手就按在**一个人节点上**再拖——这才是真会踩到的那一下（rzpp 把 content 跟着指针
// 一起平移，于是同一个节点一直待在指针底下，抬手时浏览器照常派发一次 click）。
// 从空白处起拖是个更弱的用例，压根验不到「节点自己的 onClick 被拖动误触发」。
const dragStart = await page.evaluate(() => {
  const r = document.querySelector('[data-person-id="u_1"]').getBoundingClientRect()
  return { x: r.x + r.width / 2, y: r.y + r.height / 2, visible: r.y > 0 && r.bottom < innerHeight }
})
check('拖动起手点确实压在一个人节点上（否则本条是空真）', dragStart.visible, true)
await page.mouse.move(dragStart.x, dragStart.y)
await page.mouse.down()
await page.mouse.move(dragStart.x - 190, dragStart.y - 120, { steps: 14 })
await page.mouse.up()
await page.waitForTimeout(320)
check('🔴 从人身上起手拖板，focus 没被它抢走', (await counts()).focusParam, 'person:u_0')

// 点空白（几乎没动）→ 回 calm。
// ⚠ 落点**扫出来**，不写死：第一版写死在画布底部正中，结果那儿坐着全局「问 Avery」悬浮胶囊
// （它 fixed 在底部居中，盖着地图底下一条），点过去开的是提问框——而当时的探针只查了
// 「是不是地图节点」，一句「确实是空白」照样绿。判据必须验到「命中的东西在画布里面」。
const blank = await page.evaluate(([x0, y0, w, h]) => {
  const bad = '.lite-map-person, .lite-map-project, .lite-map-controls'
  for (const [fx, fy] of [[0.5, 0.55], [0.12, 0.85], [0.5, 0.9], [0.85, 0.5], [0.3, 0.35]]) {
    const cx = x0 + w * fx
    const cy = y0 + h * fy
    const el = document.elementFromPoint(cx, cy)
    if (el?.closest('.lite-map-canvas') && !el.closest(bad)) return { cx, cy, found: true }
  }
  return { found: false }
}, [canvas.x, canvas.y, canvas.width, canvas.height])
check('找得到一处真空白（命中的元素在画布内、且不是节点/HUD）', blank.found, true)
await page.mouse.click(blank.cx, blank.cy)
await page.waitForTimeout(320)
const afterBlank = await counts()
check('点空白回 calm：URL 上的 focus 没了', afterBlank.focusParam, null)
check('点空白回 calm：连线全收', afterBlank.edges, 0)
check('点空白回 calm：压暗也全解', afterBlank.dimmed, 0)

// ── ④ 点项目 → 亮 owner；三种 owner 缺法零边 ───────────────────────────────
console.log('\n[点项目]')
await clickNode('[data-project-id="p_0"]')
const afterProject = await counts()
check('URL 写上了 project focus', afterProject.focusParam, 'project:p_0')
check('点项目 1 条边', afterProject.edges, 1)
check('点项目点亮 1 个人', afterProject.linkedPeople, 1)
const projectCard = await page.evaluate(() => {
  const node = document.querySelector('[data-project-id="p_0"]')
  return {
    summary: node.querySelector('.lite-map-node-summary')?.textContent?.trim() ?? null,
    due: node.querySelector('.lite-map-node-fact')?.textContent?.trim() ?? null,
    cta: node.querySelector('.lite-map-node-cta')?.getAttribute('href') ?? null,
  }
})
check('mini 卡有摘要', projectCard.summary, 'Synthetic workstream 1.')
check('mini 卡有到期', (projectCard.due ?? '').includes('2026'), true)
check('「看项目」指向项目详情深链', projectCard.cta?.startsWith('/projects/p_0'), true)

for (const id of ['p_no_owner_at_all', 'p_owner_name_only', 'p_owner_id_dangling']) {
  await clickNode(`[data-project-id="${id}"]`)
  const c = await counts()
  check(`🔴 ${id}：一条边都不画（缺了不编，不猜一个人连上去）`, c.edges, 0)
  check(`${id}：它自己仍然是 subject`, c.subjects, 1)
  check(`${id}：一个人都没被点亮`, c.linkedPeople, 0)
}
// 卡点条数：只在 >0 时出现，永不印「0 处卡点」。
const blockerRows = await page.evaluate(
  () => document.querySelectorAll('.lite-map-node-blockers').length,
)
check('语料里这条没有卡点 → 卡点那块整个不出现（不印「0 处卡点」）', blockerRows, 0)
await page.screenshot({ path: `${OUT}/b2-focus-project-no-owner.png` })

// ── ⑤ Esc 回 calm ─────────────────────────────────────────────────────────
console.log('\n[Esc]')
await page.keyboard.press('Escape')
await page.waitForTimeout(300)
check('Esc 回 calm', (await counts()).focusParam, null)

// ── ⑥ 深链：直接打开一个带 focus 的地址 ───────────────────────────────────
console.log('\n[深链]')
await page.goto(`${BASE}/map${Q}&focus=person:u_0`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => !!window.__lite2Store, null, { timeout: 20000 })
await seed(teamOn, 'ctx_synth_80')
const deepLink = await counts()
check('深链落地即 focus（不用再点一次）', deepLink.edges, ownedByU0.length)
check('深链落地 mini 卡就开着', deepLink.cards, 1)

await page.goto(`${BASE}/map${Q}&focus=lolwut`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => !!window.__lite2Store, null, { timeout: 20000 })
await seed(teamOn, 'ctx_synth_80')
check('坏 token → calm，不炸', (await counts()).edges, 0)

await page.goto(`${BASE}/map${Q}&focus=person:u_ghost_nobody`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => !!window.__lite2Store, null, { timeout: 20000 })
await seed(teamOn, 'ctx_synth_80')
check('查无此人 → calm（花名册变了之后的老链接）', (await counts()).cards, 0)

// ── ⑥b 路径作用域：离开 /map，focus 必须自己脱落 ───────────────────────────
// 🔴 出站有**两条**通道，两条都得验：
//   · `<Link>`（返回芯片、mini 卡上的两个动作）→ 走 href 助手；
//   · 顶栏 tab → 走 store 的 goScreen → `go()`。
// 第一版只给 href 助手打了补丁，顶栏那条漏了：从地图点一下「团队」，`?focus=` 就跟着人
// 跑遍全站再也甩不掉（focus 不进 EPHEMERAL，没有第二处会替它清理）。
console.log('\n[路径作用域 · 离开 /map]')
await page.goto(`${BASE}/map${Q}&focus=person:u_0`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => !!window.__lite2Store, null, { timeout: 20000 })
await seed(teamOn, 'ctx_synth_80')
check('出发时 URL 上确实带着 focus（否则本条是空真）', (await counts()).focusParam, 'person:u_0')
await page.locator('.lite-map-back').click()
await page.waitForTimeout(400)
const afterBack = await page.evaluate(() => ({
  path: location.pathname,
  focus: new URLSearchParams(location.search).get('focus'),
  sticky: new URLSearchParams(location.search).get('v'),
}))
check('返回芯片（<Link> 通道）落到团队屏', afterBack.path, '/team')
check('🔴 focus 脱落了', afterBack.focus, null)
check('🔴 粘性 query 一个都没被误伤', afterBack.sticky, '2')

await page.goto(`${BASE}/map${Q}&focus=person:u_0`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => !!window.__lite2Store, null, { timeout: 20000 })
await seed(teamOn, 'ctx_synth_80')
// 顶栏 tab 通道：点「项目」（`.scene-tab` 是顶栏 tab 的真类名，见 LiteTopbar.tsx）。
await page.locator('.scene-tabs .scene-tab').filter({ hasText: 'Projects' }).first().click()
await page.waitForTimeout(400)
const afterTab = await page.evaluate(() => ({
  path: location.pathname,
  focus: new URLSearchParams(location.search).get('focus'),
  sticky: new URLSearchParams(location.search).get('v'),
}))
check('顶栏 tab（go() 通道）落到项目屏', afterTab.path, '/projects')
check('🔴 focus 同样脱落了', afterTab.focus, null)
check('🔴 粘性 query 一个都没被误伤', afterTab.sticky, '2')

// ── ⑦ 打开档案 → 关掉 → 回到地图，focus 还在 ──────────────────────────────
console.log('\n[打开档案 → 关掉]')
await page.goto(`${BASE}/map${Q}&focus=person:u_0`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => !!window.__lite2Store, null, { timeout: 20000 })
await seed(teamOn, 'ctx_synth_80')
await page.locator('[data-person-id="u_0"] .lite-map-node-cta').click()
await page.waitForTimeout(500)
const onDetail = await page.evaluate(() => ({
  path: location.pathname,
  overlayName: document.querySelector('.lite-detail h2, .lite-detail-name, .lite-detail h1')?.textContent?.trim() ?? null,
  hasOverlay: !!document.querySelector('.lite-detail, [class*="lite-detail"]'),
}))
check('落在人详情深链上', onDetail.path, '/team/u_0')
check('详情浮层真的开了', onDetail.hasOverlay, true)
await page.locator('.lite-detail-close').first().click()
await page.waitForTimeout(500)
const backOnMap = await page.evaluate(() => ({
  path: location.pathname,
  focus: new URLSearchParams(location.search).get('focus'),
}))
check('🔴 关掉档案回的是地图（不是被扔到 /home）', backOnMap.path, '/map')
check('🔴 回来时小徐还亮着（focus 原样活着）', backOnMap.focus, 'person:u_0')

// ── ⑧ 组级读数 · 双世界 ───────────────────────────────────────────────────
console.log('\n[组级读数 · 开关开]')
await page.goto(`${BASE}/map${Q}`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => !!window.__lite2Store, null, { timeout: 20000 })
await seed(teamOn, 'ctx_synth_80')
// 与 AFK 门 K6 相位同一把尺：把每个 [data-metric-source] 子树剪掉之后，整页正文里不许再有
// 情绪词。（`scripts/gates/live-frontend-gate.snippet.js` 的 textOutsideAnchors + MOOD_VOCAB_RE。）
const readsOn = await page.evaluate(() => {
  const MOOD = /如常|偏紧|吃紧|steady|stretched|strained/i
  const textOutsideAnchors = (root) => {
    let out = ''
    const walk = (n) => {
      if (n.nodeType === 3) { out += n.nodeValue; return }
      if (n.nodeType !== 1) return
      if (n.hasAttribute && n.hasAttribute('data-metric-source')) return
      n.childNodes.forEach(walk)
    }
    walk(root)
    return out
  }
  const nodes = [...document.querySelectorAll('.lite-map-zone-read')]
  return {
    count: nodes.length,
    allAnchored: nodes.every((n) => n.hasAttribute('data-metric-source') && n.getAttribute('data-metric-source')),
    platform:
      document.querySelector('[data-zone-key="Platform Engineering"] .lite-map-zone-read')
        ?.textContent?.trim() ?? null,
    financeHasRead: !!document.querySelector('[data-zone-key="Finance & Legal"] .lite-map-zone-read'),
    designHasRead: !!document.querySelector('[data-zone-key="Design"] .lite-map-zone-read'),
    digitsInReads: nodes.filter((n) => /\d/.test(n.textContent || '')).length,
    moodOutsideAnchor: MOOD.test(textOutsideAnchors(document.querySelector('.lite-map-page'))),
  }
})
check('有读数的分区恰好 4 个', readsOn.count, 4)
check('🔴 每条读数都挂着非空的 data-metric-source 出处锚点', readsOn.allAnchored, true)
check('strained 与 steady 并存的组说 strained', readsOn.platform, 'Someone self-reported: Strained')
check('🔴 有情绪但没出处的组：不显示', readsOn.financeHasRead, false)
check('整组没人报的分区：不显示', readsOn.designHasRead, false)
check('🔴 读数里零数字（零计数）', readsOn.digitsInReads, 0)
check('🔴 出处锚点之外一个情绪词都没有（K6 同一把尺）', readsOn.moodOutsideAnchor, false)
await page.screenshot({ path: `${OUT}/b2-zone-reads.png` })

console.log('\n[组级读数 · 开关关（双世界）]')
await seed(teamOff, 'ctx_synth_80_off')
const readsOff = await page.evaluate(() => {
  const MOOD = /如常|偏紧|吃紧|steady|stretched|strained/i
  return {
    count: document.querySelectorAll('.lite-map-zone-read').length,
    anchors: document.querySelectorAll('.lite-map-page [data-metric-source]').length,
    moodAnywhere: MOOD.test(document.querySelector('.lite-map-page')?.textContent || ''),
  }
})
check('开关关 → 一条组级读数都没有', readsOff.count, 0)
check('开关关 → 整页零出处锚点', readsOff.anchors, 0)
check('🔴 开关关 → 整页一个情绪词都没有', readsOff.moodAnywhere, false)

if (errs.length) { failed += 1; console.log('\n🔴 控制台报错：', errs.slice(0, 6)) }
await browser.close()
console.log(`\n${failed ? 'FAILED' : 'OK'} — ${passed} passed, ${failed} failed`)
process.exitCode = failed ? 1 : 0
