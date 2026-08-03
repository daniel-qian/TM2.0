// 屏底常驻家具「让位」门（票 #34 / #36）。
//
// ## 这道门防的是什么
// 屏底那些 `position:fixed` 的常驻家具——悬浮「问 Avery」胶囊（z45）、团队屏常驻 composer
// （z25）、合规页脚（z30）——各自都不给自己预留让位空间。于是在短视口下它们**盖在可交互
// 控件上**，而且不只是"看起来挡住"：
//   · #34 /home 375×812：「打开项目 →」按钮的可见正中，真点下去展开的是 Ask Avery 输入面板，
//     页面根本没跳转（控件被劫持，不是被遮挡）。
//   · #36 /team 375×812：屏底 composer 在 y702–764 盖出一条**永久死区**，落进去的卡片操作
//     按钮真点无反应；滚动之后换成另一枚按钮被同一条带吃掉——说明吃的是这条 y 带，不是某张卡。
//
// ## 判据为什么是 elementFromPoint 而不是几何重叠
// 几何重叠只能证明"两个矩形相交"，证明不了"用户点不到"——真实页面里 pointer-events:none、
// 负 z-index、父容器裁剪都会让"相交"变成无害。第二轮走查正是靠**真点击**才把这条从
// 「视觉遮挡（feel）」升级成「控件被劫持（hard-contract）」。
// 所以这里的判据是：**每个可见控件必须拥有自己的中心点**——
// `document.elementFromPoint(控件中心)` 命中的必须是它自己或它的后代/祖先。
// 命中别的东西 = 那个点上用户点到的不是这个控件 = 红。
//
// 这是**白名单式**判据：不列举"哪些家具会挡人"（那种黑名单每加一个浮层就漏一次），
// 而是要求所有控件都自持中心点。将来任何人往屏底再加一层 fixed 家具，这道门自动管得住。
//
// ## 怎么跑
// 🔴 上传型门（真发 POST /ingest —— #34/#36 都只在**数据态**复现：contextId=null 时
// AskAveryLauncher 整块不挂载、团队屏也没有卡片列表）。**绝不能排在 C 区之后**。
//   VERIFY_BASE=http://localhost:5173 node eval-harness/tools/verify-bottom-furniture-clearance.mjs
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { bootPage, makeRec, finish } from './lib/gate-run.mjs'

const UI = process.env.VERIFY_BASE || 'http://127.0.0.1:5173'
const SEED_DIR = process.env.AVERY_DEMO_SEED_DIR || 'eval-harness/tests/fixtures/demo-seed'
const gateRec = makeRec()
const rec = gateRec.rec

const SEEDS = readdirSync(SEED_DIR)
  .filter((n) => n.endsWith('.md'))
  .map((n) => ({ name: n, text: readFileSync(join(SEED_DIR, n), 'utf8') }))

// 让位余量是**视口高度**的函数，宽度不是主变量（同 verify-topbar-clearance 的教训）。
// 375×812 = 票里两条 hard-contract 的现场；1280×620 = 矮桌面（同一根因的另一种表现）。
const VIEWPORTS = [
  { w: 375, h: 812, name: '375x812' },
  { w: 1280, h: 620, name: '1280x620' },
]
const SCREENS = ['home', 'team', 'files', 'playbooks', 'followups']

// 采点：判据是**可达性**，不是"此刻有没有被盖住"。
//
// 🔴 判据的边界在哪，是这道门唯一难的地方——第一版写宽了，记下来免得被改回去：
//
// 第一版是「控件必须拥有自己的中心点」，不限劫持者是谁。它确实一把逮住了 #34
// （`「打开项目 →」@233,774 → 命中 lite-ask-avery-pill`），但同时把**滚到顶栏底下的
// tab** 也判红了（scene-tab @333,32 → 命中 lite-settings-toggle）。后者不是同一类缺陷：
// 顶栏是 sticky，内容从它底下经过是滚动的正常中间态。
//
// 第二版矫枉过正：改成「滚到视口中部后必须拿到中心点」（可达性）。结果**连 #34 都不报了**
// ——scrollIntoView 把按钮挪到中部，自然就不在胶囊底下了，门对着已知有 bug 的构建全绿。
// 那是一道会撒谎的门，比没有门更坏。
// 教训：用户不会先把按钮滚到屏幕中间再点，**他点的是他此刻看见的那个位置**。
//
// 定稿判据：控件在**当前静止滚动位**必须拥有自己的中心点，
// 且只把「劫持者是**屏底锚定的 fixed/sticky 家具**」判红。
//   · 屏底家具（胶囊 / composer / 合规页脚）压住控件 → 红。这是本票要防的死区。
//   · 顶栏压住滚动中的内容 → 不报（另一道门的辖区，且滚一下就解除）。
// 判「屏底锚定」不靠 class 名单（那是黑名单，加一层浮层就漏一次），
// 靠**计算样式**：position 是 fixed/sticky，且矩形落在视口下半部。
const AUDIT = `(() => {
  const out = []
  const info = []
  function anchoredFurniture(node) {
    for (let e = node; e && e !== document.body && e !== document.documentElement; e = e.parentElement) {
      const cs = getComputedStyle(e)
      if (cs.position === 'fixed' || cs.position === 'sticky') {
        const fr = e.getBoundingClientRect()
        return { el: e, bottomAnchored: fr.top > innerHeight * 0.5 }
      }
    }
    return null
  }
  // 🔴 被祖先 overflow 裁掉的控件必须先剔除，否则这道门会**假红**：
  // getBoundingClientRect 返回的是布局几何，**不管有没有被裁掉**。滚动容器把下边界抬起来
  // 之后，落在容器外的控件 rect 照样报 y=714 这种"看起来在屏底"的坐标，
  // 而它其实根本没被画出来、用户也点不到它——此时再去 elementFromPoint 命中的当然是家具。
  // （2026-08-03 修 #34/#36 时正是这样：修完之后门还在红，红的却是已经被裁掉的按钮。）
  function clippedAway(el, cx, cy) {
    for (let e = el.parentElement; e && e !== document.body && e !== document.documentElement; e = e.parentElement) {
      const cs = getComputedStyle(e)
      if (cs.overflowY === 'visible' && cs.overflowX === 'visible') continue
      const r = e.getBoundingClientRect()
      if (cx < r.left || cx > r.right || cy < r.top || cy > r.bottom) return true
    }
    return false
  }
  const controls = Array.from(document.querySelectorAll('button, a[href], input, [role="button"]'))
  for (const el of controls) {
    const cs = getComputedStyle(el)
    if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) continue
    if (el.disabled) continue
    const r = el.getBoundingClientRect()
    if (r.width < 8 || r.height < 8) continue
    // 只审完整落在视口内的控件：半个身子在视口外的，点不到是滚动问题不是遮挡问题。
    if (r.top < 0 || r.left < 0 || r.bottom > innerHeight || r.right > innerWidth) continue
    const cx = Math.round(r.left + r.width / 2)
    const cy = Math.round(r.top + r.height / 2)
    if (clippedAway(el, cx, cy)) continue
    const hit = document.elementFromPoint(cx, cy)
    if (!hit) continue
    // 命中自己 / 自己的后代（图标 span 之类）/ 自己的祖先（包裹层）都算它拥有这个点。
    if (hit === el || el.contains(hit) || hit.contains(el)) continue
    const furn = anchoredFurniture(hit)
    const row = {
      what: String(el.className || el.tagName).slice(0, 46),
      label: (el.innerText || el.getAttribute('aria-label') || '').replace(/\\s+/g, ' ').slice(0, 18),
      hijackedBy: String(hit.className || hit.tagName).slice(0, 46),
      at: cx + ',' + cy,
    }
    if (furn && furn.bottomAnchored) out.push(row)
    else info.push(row)          // 顶栏一类：本门不判红，但原样带出来供人看
  }
  return { bad: out, other: info }
})()`

let browser

for (const vp of VIEWPORTS) {
  console.log(`\n═══ 视口 ${vp.name} ═══`)
  const boot = await bootPage({
    browser,
    url: `${UI}/?v=2&mode=live&look=paper&lang=zh`,
    viewport: { width: vp.w, height: vp.h },
    trackPageErrors: true,
  })
  browser = boot.browser
  const { context: ctx, page, pageErrors } = boot
  const tag = (n) => `[${vp.name}] ${n}`

  await page.evaluate(async (seeds) => {
    const enc = new TextEncoder()
    const files = seeds.map((s) => new File([enc.encode(s.text)], s.name, { type: 'text/markdown' }))
    await window.__lite2Store.getState().uploadFiles(files)
  }, SEEDS)
  await page.waitForFunction(
    () => ['ready', 'error'].includes(window.__lite2Store.getState().ingestStatus),
    undefined, { timeout: 60000 },
  )

  // 自证：必须真的进了数据态。空态下 #34/#36 都不复现，拿空态跑这道门是纯假绿。
  const ready = await page.evaluate(() => {
    const st = window.__lite2Store.getState()
    return { status: st.ingestStatus, ctx: st.contextId, people: st.team?.people?.length ?? 0 }
  })
  rec(tag('自证：真进了数据态（空态下本票两条都不复现，跑空态=假绿）'),
    ready.status === 'ready' && !!ready.ctx && ready.people > 0, JSON.stringify(ready))

  for (const sc of SCREENS) {
    await page.evaluate((s) => window.__lite2Store.getState().goScreen(s), sc)
    await page.waitForTimeout(450)

    // 自证：这一屏真的有可审的控件，否则"零劫持"是空断言。
    const n = await page.evaluate(() => document.querySelectorAll('button, a[href], input, [role="button"]').length)
    rec(tag(`${sc} 屏有可审控件（防空跑）`), n > 0, `${n} 个候选控件`)

    const fmt = (rows) => rows.slice(0, 4).map((h) => `「${h.label}」(${h.what}) @${h.at} → 命中 ${h.hijackedBy}`).join(' · ')

    const a = await page.evaluate(AUDIT)
    rec(tag(`${sc} 屏顶部滚动位：零控件被屏底家具劫持`),
      a.bad.length === 0, a.bad.length ? `${a.bad.length} 个: ${fmt(a.bad)}` : `0 个${a.other.length ? `（另有 ${a.other.length} 处非屏底遮挡，不判红：${fmt(a.other)}）` : ''}`)

    // 再从底部滚动位审一次：#36 的死区是固定 y 带，末段内容是最吃亏的一批
    // （票里实测 scrollTop=300 时换成另一枚「✓」被同一条带吃掉）。
    await page.evaluate(() => {
      const el = document.querySelector('.lite-home-scroll, .lite-followups-scroll, .scene [class*="scroll"]')
      if (el) el.scrollTop = el.scrollHeight
      else window.scrollTo(0, document.body.scrollHeight)
    })
    await page.waitForTimeout(350)
    const b = await page.evaluate(AUDIT)
    rec(tag(`${sc} 屏底部滚动位：末段内容不被屏底家具吃掉`),
      b.bad.length === 0, b.bad.length ? `${b.bad.length} 个: ${fmt(b.bad)}` : '0 个')
  }

  rec(tag('无 pageerror'), pageErrors.length === 0, pageErrors.slice(0, 2).join(' | ') || '0 条')
  await ctx.close()
}

await finish(gateRec, { browser, label: '屏底家具让位' })
