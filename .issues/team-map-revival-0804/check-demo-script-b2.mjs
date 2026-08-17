// team-map-revival-0804 · B2 · **demo-seed 具名剧本**——票面写死的那条验收：
// 「点小徐亮草坪婚宴旺季档」。
//
// 跑法（仓库根）：
//   cd eval-harness && AVERY_BRAIN=mock AVERY_EXTRACTOR=heuristic AVERY_EMBEDDINGS=keyword \
//     AVERY_DEMO_SEED_DIR=tests/fixtures/demo-seed AVERY_ALLOW_PERSON_SCORING=1 \
//     python -m uvicorn service.app:app --host 127.0.0.1 --port 8147 --app-dir .
//   VITE_AVERY_API_BASE=http://127.0.0.1:8147 npx vite build --mode development
//   npx vite preview --port 5183 --host 127.0.0.1
//   VERIFY_BASE=http://127.0.0.1:5183 API_BASE=http://127.0.0.1:8147 \
//     node .issues/team-map-revival-0804/check-demo-script-b2.mjs
//
// ⚠ **这不是一道门**（名字里刻意没有 `verify-`）——理由见 `check-focus-b2.mjs` 文件头。
//
// ## 为什么必须跑真后端而不是灌一份手捏语料
// 剧本里的每一个名字都是**抽取出来的**：`u_小徐` 这个 id 是后端 `_link_owners` 从
// 《项目总览.md》的「负责人：小徐」那一行解出来的。手捏一份 payload 等于把这条链路里最容易
// 断的一环（名字 → 花名册主键）替换成我自己写的正确答案——而地图的连线正是架在那一环上。
//
// ## 语言用中文
// 验收语料天然全中文（demo-seed），组级读数那句话里的情绪词也是中文（如常/偏紧/吃紧）。
// 英文侧由 80 人 fixture 的 check-render-b2.mjs 覆盖（PRD §7：两头都要有，防单侧盲点）。
import { chromium } from 'playwright'
import { Buffer } from 'node:buffer'
import { fileURLToPath } from 'node:url'
import esbuild from 'esbuild'

const BASE = process.env.VERIFY_BASE || 'http://127.0.0.1:5183'
const API = process.env.API_BASE || 'http://127.0.0.1:8147'
const Q = '?v=2&mode=live&look=paper&lang=zh'
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

const res = await fetch(`${API}/demo/claim`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: '{}',
})
if (!res.ok) {
  console.log(`🔴 /demo/claim ${res.status} —— 后端没起、或没配 AVERY_DEMO_SEED_DIR`)
  process.exit(1)
}
const payload = await res.json()
const team = liteTeamFromPayload(payload)

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

// ── ⓪ 先钉住语料本身：剧本里的人和事**真的**是后端解出来的 ──────────────────
console.log('\n[语料 · demo-seed 真抽取]')
console.log(`  context=${payload.context_id} · ${payload.people.length} 人 / ${payload.projects.length} 项目`)
const xu = payload.people.find((p) => p.name === '小徐')
const lawn = payload.projects.find((p) => p.title === '草坪婚宴旺季档')
check('花名册上有小徐', !!xu, true)
check('项目里有草坪婚宴旺季档', !!lawn, true)
check('🔴 后端把「负责人：小徐」解成了花名册主键（连线架在这一环上）', lawn?.ownerId, xu?.id)
// 一个人背不止一件事的真实例——全靠 1:1 的语料，「每人恒 1 条边」的错实现会一路全绿。
const ownerCounts = new Map()
for (const p of payload.projects) if (p.ownerId) ownerCounts.set(p.ownerId, (ownerCounts.get(p.ownerId) ?? 0) + 1)
const multi = [...ownerCounts.entries()].filter(([, n]) => n > 1)
check('语料里有人背着不止一件事', multi.length > 0, true)
const [multiId, multiCount] = multi[0] ?? []
const multiName = payload.people.find((p) => p.id === multiId)?.name

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await ctx.newPage()
await page.addInitScript(() => {
  try {
    window.localStorage.setItem('lite2:onboard:v1', JSON.stringify({ status: 'done', step: 0 }))
  } catch {}
})
const errs = []
page.on('pageerror', (e) => errs.push(String(e)))
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()) })

await page.goto(`${BASE}/map${Q}`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => !!window.__lite2Store, null, { timeout: 20000 })
await page.evaluate(
  ([t, raw]) => window.__lite2Store.setState({ contextId: raw.context_id, team: t, rawTeam: raw }),
  [team, payload],
)
await page.waitForSelector('.lite-map-person', { timeout: 20000 })
await page.waitForTimeout(400)

const state = () =>
  page.evaluate(() => ({
    edges: document.querySelectorAll('.lite-map-edge').length,
    subjects: [...document.querySelectorAll('.is-subject')].map(
      (n) => n.getAttribute('data-person-id') || n.getAttribute('data-project-id'),
    ),
    linked: [...document.querySelectorAll('.is-linked')].map(
      (n) => n.getAttribute('data-person-id') || n.getAttribute('data-project-id'),
    ),
    focus: new URLSearchParams(location.search).get('focus'),
  }))
const clickNode = async (sel) => {
  await page.evaluate((s) => document.querySelector(s).click(), sel)
  await page.waitForTimeout(320)
}

// ── ① 剧本正文：点小徐 → 亮草坪婚宴旺季档 ──────────────────────────────────
console.log('\n[剧本 · 点小徐]')
await clickNode(`[data-person-id="${xu.id}"]`)
const afterXu = await state()
check('小徐被点亮（且只有他一个 subject）', afterXu.subjects, [xu.id])
check('🔴 草坪婚宴旺季档跟着亮了', afterXu.linked, [lawn.id])
check('连线恰好 1 条（他手上只有这一件）', afterXu.edges, 1)
check('URL 可分享', afterXu.focus, `person:${xu.id}`)
const xuCard = await page.evaluate((id) => {
  const node = document.querySelector(`[data-person-id="${id}"]`)
  return {
    role: node.querySelector('.lite-map-node-role')?.textContent?.trim() ?? null,
    read: node.querySelector('.lite-map-node-read')?.textContent?.trim() ?? null,
    cta: node.querySelector('.lite-map-node-cta')?.textContent?.trim() ?? null,
    href: node.querySelector('.lite-map-node-cta')?.getAttribute('href') ?? null,
    digits: /\d/.test(node.textContent || ''),
    percent: /\d{1,3}\s*%/.test(node.textContent || ''),
  }
}, xu.id)
check('mini 卡上是他文档里的职位', xuCard.role, '宴会销售经理')
check('mini 卡上有定性自述读', (xuCard.read ?? '').length > 0, true)
check('「打开档案」是中文', xuCard.cta?.startsWith('打开档案'), true)
check('「打开档案」指向他的人详情深链', xuCard.href?.startsWith(`/team/${encodeURIComponent(xu.id)}`), true)
// 🔴 小徐在《本周周报》里自述负载 86% —— 那个数字在人卡上（带出处锚点）合法，在地图上不合法。
check('🔴 他的卡上一个百分数都没有（自述负载 86% 没漏上图）', xuCard.percent, false)
await page.screenshot({ path: `${OUT}/b2-demo-xu.png` })

// ── ② 反向：点草坪婚宴旺季档 → 亮小徐 ─────────────────────────────────────
console.log('\n[剧本 · 反向点项目]')
await clickNode(`[data-project-id="${lawn.id}"]`)
const afterLawn = await state()
check('项目成了 subject', afterLawn.subjects, [lawn.id])
check('🔴 小徐跟着亮了（点项目亮 owner）', afterLawn.linked, [xu.id])
check('连线 1 条', afterLawn.edges, 1)

// ── ③ 背着不止一件事的那个人 ──────────────────────────────────────────────
console.log(`\n[剧本 · 点${multiName}（背着 ${multiCount} 件事）]`)
await clickNode(`[data-person-id="${multiId}"]`)
const afterMulti = await state()
check(`连线 ${multiCount} 条（不是恒 1 条）`, afterMulti.edges, multiCount)
check('亮起来的项目条数对得上', afterMulti.linked.length, multiCount)
await page.screenshot({ path: `${OUT}/b2-demo-multi.png` })

// ── ④ 中文语料上的组级读数 + 情绪词泄漏扫描 ───────────────────────────────
console.log('\n[组级读数 · 中文语料]')
const reads = await page.evaluate(() => {
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
  const page_ = document.querySelector('.lite-map-page')
  return {
    count: nodes.length,
    zones: document.querySelectorAll('.lite-map-zone').length,
    samples: nodes.slice(0, 4).map((n) => n.textContent.trim()),
    allAnchored: nodes.every((n) => (n.getAttribute('data-metric-source') || '').length > 0),
    titled: nodes.every((n) => (n.getAttribute('title') || '').includes('本人自述')),
    digits: nodes.filter((n) => /\d/.test(n.textContent || '')).length,
    moodOutside: MOOD.test(textOutsideAnchors(page_)),
    percentOnPeople: [...document.querySelectorAll('.lite-map-person')]
      .some((n) => /\d{1,3}\s*%/.test(n.textContent || '')),
  }
})
console.log(`  读数样例：${JSON.stringify(reads.samples)}`)
check('中文语料上真的出了组级读数（不是空真）', reads.count > 0, true)
check('🔴 每条都挂着非空出处锚点', reads.allAnchored, true)
check('🔴 每条都带「本人自述」口径角标（不直接断言是谁说的）', reads.titled, true)
check('🔴 读数里零数字（零计数）', reads.digits, 0)
check('🔴 出处锚点之外一个情绪词都没有（AFK 门 K6 同一把尺）', reads.moodOutside, false)
check('🔴 整片人节点零百分数（16 人全报了负载，一个都不许上图）', reads.percentOnPeople, false)
check('分区数 = 花名册部门数', reads.zones, new Set(payload.people.map((p) => p.team || '__u__')).size)
await page.screenshot({ path: `${OUT}/b2-demo-zone-reads.png` })

// ── ⑤ 打开档案 → 关掉 → 回到地图，小徐还亮着 ─────────────────────────────
console.log('\n[剧本 · 打开档案再关掉]')
await page.goto(`${BASE}/map${Q}&focus=person:${encodeURIComponent(xu.id)}`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => !!window.__lite2Store, null, { timeout: 20000 })
await page.evaluate(
  ([t, raw]) => window.__lite2Store.setState({ contextId: raw.context_id, team: t, rawTeam: raw }),
  [team, payload],
)
await page.waitForSelector('.lite-map-node-cta', { timeout: 20000 })
await page.locator('.lite-map-node-cta').first().click()
await page.waitForTimeout(600)
check('落在小徐的人详情深链上', await page.evaluate(() => decodeURIComponent(location.pathname)), `/team/${xu.id}`)
await page.locator('.lite-detail-close').first().click()
await page.waitForTimeout(600)
const back = await page.evaluate(() => ({
  path: location.pathname,
  focus: new URLSearchParams(location.search).get('focus'),
}))
check('🔴 关掉档案回的是地图', back.path, '/map')
check('🔴 回来时小徐还亮着', back.focus, `person:${xu.id}`)

if (errs.length) { failed += 1; console.log('\n🔴 控制台报错：', errs.slice(0, 6)) }
await browser.close()
console.log(`\n${failed ? 'FAILED' : 'OK'} — ${passed} passed, ${failed} failed`)
process.exitCode = failed ? 1 : 0
