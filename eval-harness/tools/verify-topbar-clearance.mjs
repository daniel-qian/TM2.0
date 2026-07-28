// 顶栏让位门（cr-align 视觉战役棒0/棒1 · 2026-07-21）。
//
// ## 缺陷是什么
// lite2 顶栏是 fixed 悬浮（.prototype-topbar，00-base l.65：top:18px 无高度预留），
// 让位责任散落在每个屏自己的 frame padding 里（新屏惯例 84px）。谁忘了谁重叠：
// 「Avery 的笔记」(.lite-notes) 和「未来方向」(.lite-vision) 用的是老居中 flex 模式，
// 只留 28px——标题钻进 nav 底下（Danny 2026-07-21 生产截图实证）。
// 这是**模式缺陷**不是个别失误：修掉两处不等于治好病根，所以立这道门永久看守
// 「任何屏的首标题必须低于顶栏带」这个结构不变量——未来新屏忘让位，这里立刻红。
//
// ## 判别器
// 真渲染、真 getBoundingClientRect：顶栏带底 = .prototype-topbar 所有可见子簇
// （tabs/铃/登录/设置）bbox bottom 的最大值；每屏在 scrollTop=0 时取 scene 内文档序
// 第一个可见 h1/h2/h3，断言 heading.top >= 带底 + 8px。两皮都跑（几何是两皮共享的）。
// 另附 elementFromPoint 遮挡取证（信息性输出，不作判据——判据用带底不变量，更强更稳）。
//
// 附带 Bug B 微断言：注入决策世界后 .lite-home-decision-followup 的 computed
// border-radius 必须 = 999px（三个兄弟按钮的配方）——该按钮没进 l.3809 的枚举选择器
// 列表时是裸浏览器默认按钮，此断言红。
//
// ## 两种世界
//   修前：/notes /vision 首标题 top≈34px < 带底≈64px → 红；followup 按钮无圆角 → 红。
//   修后：九屏全部 ≥ 带底+8 → 绿；按钮 999px → 绿。
//   未来世界：新屏忘让位 → 该屏立刻红（这是本门的长期价值）。
//
// ═══ 2026-07-28 扩容（uiux-narrow-0728）· 本门为什么曾经绿着放过两个生产 bug ═══
// 合伙人验收在真机上逮到两处，而本门当时全绿。复盘出**四个盲维**，逐个补上：
//
//   ① 只跑 1280×900 一个**高度**。空态卡是垂直居中的（shared/40-nexus-empty.css:3
//      `top:42%; translateY(-50%)`），卡顶 = 0.42×视口高 − 卡高/2 —— 让位余量是**高度的函数**，
//      不是宽度的。操作手册空态卡高 512px：视口高 <776 卡顶钻进顶栏，<707 眉题被吃，<664 连
//      h2 都被吃。1366×768 笔记本（视口高 ~630）正在红区，而 900 高恰好在安全区。
//      → 补 FIXED_VPS 高度矩阵。
//   ② 只量**满态**（先 uploadFiles 再量）。合伙人在**空态** —— 两种世界的布局根本不是一套
//      （满态走滚动壳+padding 让位，空态走绝对定位居中卡）。→ 补 phase B 空态世界。
//   ③ 判据只认 `h1/h2/h3`。空态卡里最先被吃的是 `<p class="eyebrow">` 眉题和**卡的顶边**，
//      h2 在它们下面 47px，等 h2 都红时早已烂穿。→ 判据扩到 .eyebrow + .nexus-empty 顶边。
//   ④ 窄屏**被本门自己跳过**（旧 l.51：顶栏不是 fixed 就 return skip）。≤860 走的是
//      shared/00-base.css:1110 的老窄屏分支（顶栏 sticky + flex-direction:column），那条规则
//      写的时候顶栏只有 2 个孩子，如今 5 个 → 竖排摞成 208px 高的墙，内容被推到 292–765px，
//      740 高的窗口首屏全空；外加 .app-shell{width:100vw} 在有竖滚动条时横向溢出 15px。
//      → phase C 改判：不再 skip，而是断言「单行不摞墙 + 无横向溢出 + 首内容在首屏」。
//
// 🔴 phase C 必须 **headed** 跑：headless Chromium 是零宽 overlay 滚动条，量到的
//    `scrollWidth-clientWidth` 恒为 0 —— 横向溢出这一类 bug 在 headless 下**structurally 不可见**
//    （2026-07-28 实测：同一页面同一视口，headless hOver=0 / headed hOver=15）。
//
// ## 怎么跑（与 verify-contrast-smalltext.mjs 同一套前置）
//   VERIFY_BASE=http://localhost:5173 node eval-harness/tools/verify-topbar-clearance.mjs
import { chromium } from 'playwright'

const UI = process.env.VERIFY_BASE || 'http://localhost:5173'
const R = []
const rec = (n, ok, d) => { R.push({ n, ok }); console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${n}${d ? ' — ' + d : ''}`) }

const SEED_DOC = [
  '# 望江咨询 · 项目周报 W33',
  '',
  '## 项目：客户门户改版',
  '负责人：陈静',
  '状态：正常',
  '',
  '本周完成登录页联调，下周进入验收。',
  '',
].join('\n')

const V2_SCREENS = ['home', 'team', 'projects', 'room', 'followups', 'notes', 'closerlook', 'playbooks', 'vision']

// ── 扩容矩阵（2026-07-28）───────────────────────────────────────────────────────
// 高度是主变量（盲维①）。选点理由：
//   1440×900  常见外接屏最大化（安全区，回归护栏）
//   1366×768  最常见笔记本；视口高实测 ~630–700 → 旧码红区正中
//   1280×900  旧门唯一跑过的点（保住它就是保住不回归）
//   1280×720  720p 最大化 / 常见非最大化窗口
//   1024×768  老投影与平板横屏
//   900×700   窄边缘 + 矮，fixed 模式的最后一格（861 是 sticky 分界）
const FIXED_VPS = [[1440, 900], [1366, 768], [1280, 900], [1280, 720], [1024, 768], [900, 700]]
// 窄屏（≤860 走 sticky 分支）。815=合伙人截图实测宽；390=iPhone 12/13/14 标准宽。
const NARROW_VPS = [[815, 740], [390, 844]]

// 顶栏带高上限：单行胶囊实测 fixed 模式 64px（paper）/56px（aurora）。窄屏若还是单行，
// 带高不该超过 96 —— 摞成两层就 >130，摞五层 220。这个数就是「不许摞墙」的硬判据。
const NARROW_BAR_MAX = 96
// 窄屏首内容与顶栏带底的最大间距。旧码把空态卡钉在 42% × 1500px 的老 stage 上 → 卡落在
// 598–736px，带底才 208 —— 中间 390–528px 全是空白，740 高的窗口第一屏什么都没有。
// 「首内容在首屏内」这条太松（598 < 740 也算过），真正的判据是**紧跟顶栏**。
const NARROW_CONTENT_GAP_MAX = 240

// 每屏量：顶栏带底、首标题 top、遮挡取证。在页内一次算完。
const MEASURE_FN = `(() => {
  const bar = document.querySelector('.prototype-topbar')
  if (!bar) return { err: 'no topbar' }
  if (getComputedStyle(bar).position !== 'fixed') return { skip: 'topbar not fixed (narrow sticky mode)' }
  let bandBottom = 0
  const pills = []
  for (const ch of bar.children) {
    const r = ch.getBoundingClientRect()
    const cs = getComputedStyle(ch)
    if (r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && +cs.opacity !== 0) {
      bandBottom = Math.max(bandBottom, r.bottom)
      pills.push({ cls: String(ch.className).slice(0, 30), rect: [r.left, r.top, r.right, r.bottom].map(Math.round) })
    }
  }
  const stage = document.querySelector('.scene-stage') || document.body
  let heading = null
  for (const h of stage.querySelectorAll('h1, h2, h3')) {
    const r = h.getBoundingClientRect()
    const cs = getComputedStyle(h)
    if (r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && +cs.opacity !== 0) {
      heading = { text: (h.innerText || '').trim().slice(0, 20), top: Math.round(r.top), left: Math.round(r.left) }
      // 遮挡取证：标题中心点被顶栏族元素接住 = 真被压
      const el = document.elementFromPoint((r.left + r.right) / 2, r.top + Math.min(10, r.height / 2))
      heading.occluded = !!(el && el.closest('.prototype-topbar'))
      break
    }
  }
  return { bandBottom: Math.round(bandBottom), pills: pills.length, heading }
})()`

const browser = await chromium.launch({ headless: true })

async function driveLook(look) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const page = await ctx.newPage()
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(e.message))
  console.log(`\n═══ v02·${look} ═══`)

  await page.goto(`${UI}/?v=2&mode=live&look=${look}&lang=zh`, { waitUntil: 'networkidle' })
  if (await page.locator('.lite-onboard').count()) {
    await page.keyboard.press('Escape')
    await page.waitForTimeout(600)
  }
  // 满世界：让每屏都有真内容（帧 padding 与数据无关，但标题要在场）
  await page.evaluate(async (doc) => {
    const enc = new TextEncoder()
    const f = new File([enc.encode(doc)], 'w33-weekly.md', { type: 'text/markdown' })
    await window.__lite2Store.getState().uploadFiles([f])
  }, SEED_DOC)
  await page.waitForFunction(
    () => ['ready', 'error'].includes(window.__lite2Store.getState().ingestStatus),
    undefined, { timeout: 30000 },
  )
  // 问一轮让 Avery 笔记真的落一条——notes 屏的标题只有在有笔记的世界才贴顶
  // （空态是居中卡，标题在 275px 远处，压不到；Danny 的重叠截图正是有笔记世界）
  await page.evaluate(() => {
    const st = window.__lite2Store.getState()
    st.goScreen('room')
    st.askLive({ situation: '这周谁的项目最需要我搭把手？' })
  })
  await page.waitForFunction(
    () => ['complete', 'error'].includes(window.__lite2Store.getState().run.status),
    undefined, { timeout: 30000 },
  ).catch(() => {})
  await page.evaluate(() => window.__lite2Store.getState().refreshNotes?.())
  await page.waitForTimeout(500)

  for (const sc of V2_SCREENS) {
    await page.evaluate((s) => window.__lite2Store.getState().goScreen(s), sc)
    await page.waitForTimeout(350)
    const m = await page.evaluate(MEASURE_FN)
    if (m.err) { rec(`[${look}] ${sc} 可测（顶栏在场）`, false, m.err); continue }
    if (m.skip) { rec(`[${look}] ${sc} 跳过（${m.skip}）`, true); continue }
    if (!m.heading) {
      // 无标题屏没有「标题被压」问题面；记录在案但不算失败（首轮如出现，人工核对该屏形态）
      rec(`[${look}] ${sc} 无 h1-h3（居中空态类形态，无标题可压）`, true, `bandBottom=${m.bandBottom}`)
      continue
    }
    const clear = m.heading.top >= m.bandBottom + 8
    rec(
      `[${look}] ${sc} 首标题低于顶栏带（top ${m.heading.top} ≥ ${m.bandBottom}+8）`,
      clear,
      `"${m.heading.text}"${m.heading.occluded ? ' ⚠️elementFromPoint 实测被顶栏接住' : ''}`,
    )
  }

  rec(`[${look}] 无 pageerror`, pageErrors.length === 0, pageErrors.slice(0, 2).join(' | ') || '0 条')
  await ctx.close()
}

await driveLook('aurora')
await driveLook('paper')

// ══ 判据扩到「首个可见内容」而不只是标题（盲维③）══════════════════════════════
// 空态卡的顺序是：卡顶边 → .eyebrow 眉题 → h2。旧判据只认 h2，于是前两者被吃干净了门还绿着。
// 这里取 active scene 内**文档序最靠上的可见内容元素**（卡/眉题/标题三类的最小 top）。
const MEASURE_TOP = `(() => {
  const de = document.documentElement
  const bar = document.querySelector('.prototype-topbar')
  if (!bar) return { err: 'no topbar' }
  const bcs = getComputedStyle(bar)
  let band = 0
  for (const ch of bar.children) {
    const r = ch.getBoundingClientRect(); const cs = getComputedStyle(ch)
    if (r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && +cs.opacity !== 0) band = Math.max(band, r.bottom)
  }
  const scene = document.querySelector('.scene.is-active') || document.querySelector('.scene-stage') || document.body
  let top = Infinity, who = null
  for (const el of scene.querySelectorAll('.nexus-empty, h1, h2, h3, .eyebrow')) {
    const r = el.getBoundingClientRect(); const cs = getComputedStyle(el)
    if (r.width <= 0 || r.height <= 0 || cs.visibility === 'hidden' || +cs.opacity === 0) continue
    if (r.top < top) { top = r.top; who = el.tagName + '.' + String(el.className).split(' ')[0] }
  }
  const shell = document.querySelector('.app-shell')
  return {
    pos: bcs.position,
    band: Math.round(band),
    barH: Math.round(bar.getBoundingClientRect().height),
    top: top === Infinity ? null : Math.round(top),
    who,
    hOver: de.scrollWidth - de.clientWidth,
    vSb: window.innerWidth - de.clientWidth,
    shellW: shell ? Math.round(shell.getBoundingClientRect().width) : null,
    clientW: de.clientWidth,
    innerH: window.innerHeight,
  }
})()`

// 空态世界（合伙人所处世界）：不上传、不注数据，只关掉上手门。零后端依赖。
async function openEmpty(ctx, look, lang = 'zh') {
  const page = await ctx.newPage()
  await page.goto(`${UI}/?v=2&mode=live&look=${look}&lang=${lang}`, { waitUntil: 'networkidle' })
  if (await page.locator('.lite-onboard').count()) {
    await page.keyboard.press('Escape')
    await page.waitForTimeout(500)
  }
  return page
}

// ══ phase B · 空态 × 视口高度矩阵 × 两皮（盲维①②③）════════════════════════════
// zh 与 en 都跑：en 文案更长 → 空态卡更高 → 居中后卡顶更低，1366×768 en 实测卡顶 23px
// （zh 同点 67px），是本类 bug 的最坏语种。
for (const look of ['paper', 'aurora']) {
  for (const lang of ['zh', 'en']) {
    console.log(`\n═══ phase B · 空态 · ${look} · ${lang} ═══`)
    for (const [w, h] of FIXED_VPS) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h } })
      const page = await openEmpty(ctx, look, lang)
      const bad = []
      let band = 0
      for (const sc of V2_SCREENS) {
        await page.evaluate((s) => window.__lite2Store.getState().goScreen(s), sc)
        await page.waitForTimeout(180)
        const m = await page.evaluate(MEASURE_TOP)
        if (m.err || m.top === null) continue
        band = m.band
        if (m.top < m.band + 8) bad.push(`${sc}(${m.who} top=${m.top}<${m.band}+8)`)
      }
      rec(
        `[B ${look}/${lang}] ${w}×${h} 九屏空态首内容全部低于顶栏带`,
        bad.length === 0,
        bad.length ? `带底=${band} · 违规 ${bad.length} 屏：${bad.join(' ')}` : `带底=${band}`,
      )
      await ctx.close()
    }
  }
}

// ══ phase C · 窄屏不再 skip（盲维④）· 🔴 headed ═════════════════════════════════
// 三条判据，对应窄屏实测到的三个症状：
//   C1 顶栏不许摞墙：带高 ≤ NARROW_BAR_MAX（旧码 220px = 五个子块竖排）
//   C2 不许横向溢出：hOver == 0（旧码 15px，来自 .app-shell{width:100vw} 遇上竖滚动条）
//   C3 首内容必须在首屏：top < innerHeight（旧码把卡推到 598–765px，740 高窗口里首屏全空）
// 🔴 headed：headless 是零宽 overlay 滚动条，C2 在 headless 下恒绿（假绿）。
{
  const headed = await chromium.launch({ headless: false })
  console.log('\n═══ phase C · 窄屏（headed，真滚动条占位）═══')
  for (const look of ['paper', 'aurora']) {
    for (const [w, h] of NARROW_VPS) {
      const ctx = await headed.newContext({ viewport: { width: w, height: h } })
      const page = await openEmpty(ctx, look)
      const c1 = [], c2 = [], c3 = []
      let sample = null
      for (const sc of V2_SCREENS) {
        await page.evaluate((s) => window.__lite2Store.getState().goScreen(s), sc)
        await page.waitForTimeout(180)
        const m = await page.evaluate(MEASURE_TOP)
        if (m.err) continue
        sample = m
        if (m.barH > NARROW_BAR_MAX) c1.push(`${sc}(barH=${m.barH})`)
        if (m.hOver > 0) c2.push(`${sc}(+${m.hOver}px)`)
        if (m.top !== null && m.top - m.band > NARROW_CONTENT_GAP_MAX) c3.push(`${sc}(top=${m.top}−带底${m.band}=${m.top - m.band})`)
      }
      const tag = `[C ${look}] ${w}×${h}`
      rec(`${tag} C1 顶栏单行不摞墙（带高 ≤${NARROW_BAR_MAX}）`, c1.length === 0,
        c1.length ? c1.join(' ') : `带高=${sample ? sample.barH : '?'}`)
      rec(`${tag} C2 无横向溢出`, c2.length === 0,
        c2.length ? c2.join(' ') : `竖滚动条占位=${sample ? sample.vSb : '?'}px（0=环境无经典滚动条，本判据此时无效力）`)
      rec(`${tag} C3 首内容紧跟顶栏（间距 ≤${NARROW_CONTENT_GAP_MAX}）`, c3.length === 0,
        c3.length ? c3.join(' ') : `视口高=${h}`)
      await ctx.close()
    }
  }
  await headed.close()
}

// ── Bug B 微断言：加到待办按钮必须有自己的样式（今天红：没进枚举选择器列表） ──────
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const page = await ctx.newPage()
  await page.goto(`${UI}/?v=2&mode=live&lang=zh`, { waitUntil: 'networkidle' })
  if (await page.locator('.lite-onboard').count()) {
    await page.keyboard.press('Escape')
    await page.waitForTimeout(600)
  }
  // 注入决策世界（verify-home-skeleton 的世界 B 配方）
  await page.evaluate(() => {
    const decision = {
      subject_type: 'project', subject_id: 'p-gate-1', subject_title: '客户门户改版',
      grade: 'high_risk', grade_label: '今天要决策', severity: 3,
      reason: '截止日期已过而状态仍写推进中。', reason_source: 'rule',
      escalated: false, escalation_reason: null, unknown_fields: [], unparsed_fields: [],
      matched_rules: [{ rule_id: 'R1', title: '过期未更新', grade_label: '今天要决策', basis: '截止日早于今天', evidence: ['原文：预计 7 月 10 日交付'] }],
      owner_name: '陈静',
    }
    window.__lite2Store.setState({
      contextId: 'ctx-gate-fake',
      team: { people: [], projects: [], handoffs: [], briefing: { headline: '', subhead: '', metrics: [] } },
      rawTeam: { people: [], projects: [], decisions: [decision] },
    })
    window.__lite2Store.getState().goScreen('home')
  })
  await page.waitForTimeout(500)
  const btn = await page.evaluate(() => {
    const el = document.querySelector('.lite-home-decision-followup')
    if (!el) return null
    const cs = getComputedStyle(el)
    return { radius: cs.borderRadius, fontSize: cs.fontSize, bg: cs.backgroundColor, family: el.classList.contains('lite-btn') }
  })
  rec('「加到待办」按钮在场', btn !== null)
  // cr-align 棒4（2026-07-21）字面量重导出——来源 cr-align-spec.json stick-4
  // btn.followupRadius/btn.followupFont（spec→门→码）：棒1 的 999px 止血形毕业成
  // .lite-btn 族形（aurora 默认皮 r9px + 13px）。旧构建红证明：改后本断言对棒3 构建跑
  // 必红（还是 999px/11.5px、未挂族类）。
  rec(
    '「加到待办」按钮挂 .lite-btn 族且吃 aurora 族度量（r9px + 13px，spec stick-4）',
    btn !== null && btn.family && btn.radius === '9px' && btn.fontSize === '13px',
    btn ? `family=${btn.family} radius=${btn.radius} fontSize=${btn.fontSize} bg=${btn.bg}` : '',
  )
  await ctx.close()
}

await browser.close()

const pass = R.filter((r) => r.ok).length
const fail = R.length - pass
console.log(`\n═══ 顶栏让位：${pass} PASS · ${fail} FAIL ═══`)
process.exit(fail ? 1 : 0)
