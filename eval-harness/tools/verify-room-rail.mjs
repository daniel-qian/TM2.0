// #83 · 会话侧栏（桌面「栏」规格 + ≤860「抽屉」）端到端门。
// 设计正源：`.issues/design-0810/design-plan.md` §2.2 + §2.3（Danny 2026-08-10 已审过·全部通过）。
//
// ## 这道门补的是哪两块空白
// ① **手机抽屉态在所有既有门里零覆盖**。contrast-smalltext / aria-zh / at-references /
//    room-claude-rework 四道门的视口都硬钉 1280×900 或最小 900 > 860 —— 抽屉里的配色、
//    11px 小字的对比度、开关钮的形态全在采样面之外。#80 的回执把这条当"刻意留下的账"记着，
//    本票结清。**别把它当验过的**：一道门跑不到的地方，绿不绿都不说明问题。
// ② **桌面栏的视觉规格只有像素基线看着**，而 room-data 那 4 张拍的是**零历史**态
//    （侧栏里只有「新对话」+ 一行空态说明）——行高、选中封条、组标色、时刻是否占墨，
//    一张基线都盖不到。像素基线也分辨不出「为什么错」：它只会说"这块像素变了"。
//
// ## 每条主判据各盯一种「看着做了其实没做」的实现
//   A② **下陷不是凸起**：假实现是"换了个更好看的白"。判据不写字面量（写死
//        `rgba(29,27,23,0.035)` 的尺子换个皮当场瞎），而是量**合成后的亮度必须低于身后那张面**。
//   A③ **贴边通到底**：假实现是"底色改了、上下沿那两道悬空截断边还在"——那才是"浮在页面上
//        的白卡片"观感的另一半来源。判据落在 rect 的 top/bottom 上。
//   A⑤ **单行**：假实现是"字号调小了但还是两行"。判据量行高，不看类名。
//   A⑥ **时刻从静息态撤掉**：判据量的是"取样时鼠标不在这一行上"时它占不占面积——
//        🔴 采样前必须先把指针挪走，否则 Playwright 点完就停在那一行上，hover 态被当成静息态采走。
//   A⑦ **单轮的场不渲染轮数文本**：病根③（9 场里 8 场 meta 逐字相同）的正面判据。
//   A⑨ **2px accent 左封条**：判据读 ::before 的计算值，不是"选中行看起来不一样"。
//   A⑩ **组标吃 --ink-soft 不吃 --ink-faint**：#80 立的碑（11px faint 在 paper 上仅 ~4.7:1，
//        AA 余量 0.2）。判据落在"逐字等于 ink-soft 且不等于 ink-faint"上。
//   A⑪ **开场块居中**：判据是"开场块中线 ≈ board 内容盒中线"，且那个内容盒的上下沿确实
//        夹在「顶栏带底」与「composer 顶」之间——不然"居中"可以是在任何一块矩形里居中。
//   A⑫ **composer 没被一起收进来居中**：`board.contains(composer) === false`。这是"把 composer
//        一起居中"那种假实现（方案期原型第一版的原病）唯一的结构性可观测形态。
//   B③ **抽屉底色不透明**：alpha ≥ 0.99。半透明的抽屉在屏上是透明玻璃（正文从字缝里透出来），
//        同时会让 verify-contrast-smalltext 的 bgOf 量出一个屏上根本不存在的比值
//        （它把 alpha>0.5 当实底、≤0.5 当完全透明跳过）。
//   B④ **它真的盖住了正文**：alpha 判的是颜色，这条判的是"它在上面"——elementFromPoint 实打。
//        两件事，缺一条都能被"底色不透明但 z 序在正文下面"蒙过去。
//   B⑦ **抽屉里的小字过 AA**：尺子与 verify-contrast-smalltext **同源**（逐字抄它的
//        parseColor/lum/ratio/bgOf 与 4.5/3.0 双阈值），免得这里放行的串在那边红。
//
// ## 变异台账（逐条**独立**跑，结果记 `.issues/design-0810/_px83/mutations.md`）
//   M-A 栏底色改回 `rgb(var(--lite2-surface-rgb))`（#80 那份"白卡片"）        → A② 红
//   M-B 栏的 top/bottom 改回 clear-top / max(band, footer+76)                 → A③ 红
//   M-C 会话行 flex-direction 改回 column（两行式）                            → A⑤ 红
//   M-D 时刻的 `display:none` 拿掉（静息态又占墨）                             → A⑥ 红
//   M-E 单轮那一支恢复渲染 meta 文本                                           → A⑦ 红
//   M-F 选中行的 ::before 封条整段拿掉                                         → A⑨ 红
//   M-G 组标改回 `--ink-faint`                                                 → A⑩ 红
//   M-H board 的 `justify-content:center` 拿掉（开场块回到顶端）               → A⑪ 红
//   M-I 抽屉底色沿用桌面那份 `rgba(ink,.035)`                                  → B③ 红
//   M-J 抽屉 z-index 降到遮罩之下（底色仍不透明，但盖不住正文）                → B④ 红
//   M-K 遮罩整块不渲染                                                         → B⑥ 红
//   M-L 组标在抽屉里改回 `--ink-faint`（AA 击穿）                              → B⑦ 红
//
// ## 怎么跑
// 🔴 **上传型门**（真发 POST /ingest 造 context + 三发真 /advise）；**绝不能排在 C 区之后**
//    （C 区跑完 dist 指向生产域名，此后任何上传都是往生产库写测试数据）。
//   后端：AVERY_BRAIN=mock AVERY_EXTRACTOR=heuristic AVERY_EMBEDDINGS=keyword
//         AVERY_DEMO_SEED_DIR=tests/fixtures/demo-seed AVERY_PUBLIC_BASE=<后端口> uvicorn
//   前端：vite build --mode development + vite preview --host
//   VERIFY_BASE=http://127.0.0.1:5173 node eval-harness/tools/verify-room-rail.mjs
// ⚠ 显式 `?lang=zh`：判据要读中文问题原文与组标。
import { bootPage, makeRec, finish } from './lib/gate-run.mjs'

const UI = process.env.VERIFY_BASE || 'http://127.0.0.1:5173'
const SEAM = '__lite2Store'
const { rows, rec } = makeRec()

const ROSTER = [
  '# 别墅酒店 员工花名册', '',
  '姓名 | 人员ID | 部门 | 职位 | 司龄',
  '周雅婷 | MKT-001 | 市场推广部 | 市场专员 | 3年',
  '林小满 | FO-0422 | 前厅部 | 前厅主管 | 2年',
].join('\n')
const PROJECT = ['# 别墅套餐推广', '负责人：周雅婷', '状态：受阻', '截止：2026-10-15', '进度：55%',
  '阻塞：雨季无备选场地'].join('\n')

const Q1 = '别墅套餐推广现在最需要我做什么'
const Q2 = '前厅部这边我该盯什么'
const Q3 = '那第一步具体怎么开口'

// 🔴 尺子与 verify-contrast-smalltext 的 AUDIT_FN **同源**（parseColor/lum/ratio/bgOf 与
//    4.5/3.0 双阈值、0.03 取整容差逐字照抄）。两道门用同一把尺，免得这里放行的串在那边红。
//    唯一的差别是**采样面**：那道门扫 `main *`（视口 1280×900，抽屉在 ≤860 才存在），
//    这里扫的是抽屉子树本身。
const CONTRAST_IN = `((rootSel) => {
  function parseColor(c) { const m = c.match(/rgba?\\(([\\d.]+), ?([\\d.]+), ?([\\d.]+)(?:, ?([\\d.]+))?\\)/); return m ? [+m[1],+m[2],+m[3], m[4]===undefined?1:+m[4]] : null }
  function lum(rgb) { const f = v => { v/=255; return v<=0.03928? v/12.92 : Math.pow((v+0.055)/1.055,2.4) }; return 0.2126*f(rgb[0])+0.7152*f(rgb[1])+0.0722*f(rgb[2]) }
  function ratio(a,b){ const l1=lum(a), l2=lum(b); return (Math.max(l1,l2)+0.05)/(Math.min(l1,l2)+0.05) }
  function bgOf(el){ let cur = el; while(cur && cur !== document.documentElement){ const c = parseColor(getComputedStyle(cur).backgroundColor); if (c && c[3] > 0.5) return c; cur = cur.parentElement }
    const shell = document.querySelector('.lite2-shell, .lite-shell')
    const base = shell ? parseColor(getComputedStyle(shell).getPropertyValue('background-color')) : null
    return base && base[3] > 0.5 ? base : [247,244,238,1] }
  const root = document.querySelector(rootSel)
  if (!root) return { sampled: 0, bad: ['(采样根不存在)'] }
  let sampled = 0; const bad = []
  root.querySelectorAll('*').forEach(el => {
    if (!el.innerText || el.children.length > 0) return
    const txt = el.innerText.trim(); if (!txt || txt.length < 2) return
    const cs = getComputedStyle(el)
    if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) return
    const fg = parseColor(cs.color); if (!fg) return
    sampled++
    const r = ratio(fg, bgOf(el))
    const size = parseFloat(cs.fontSize); const bold = parseInt(cs.fontWeight) >= 700
    const threshold = (size >= 18.66 || (size >= 14 && bold)) ? 3 : 4.5
    if (r < threshold - 0.03) bad.push(String(el.className).slice(0,40) + ' ' + Math.round(r*100)/100 + '/' + threshold + ' (' + txt.slice(0,14) + ')')
  })
  return { sampled, bad }
})`

let browser

// 铺语料 + 进议事室。两个世界各跑一遍（各自新 context，模式 ⑤(c)）。
async function boot(viewport) {
  const b = await bootPage({
    browser,
    url: `${UI}/?v=2&mode=live&look=paper&lang=zh`,
    viewport,
    trackPageErrors: true,
  })
  browser = b.browser
  const { page } = b
  await page.evaluate(async ({ files, seam }) => {
    const enc = new TextEncoder()
    await window[seam].getState().uploadFiles(
      files.map((f) => new File([enc.encode(f.text)], f.name, { type: 'text/markdown' })))
  }, { files: [{ name: '花名册.md', text: ROSTER }, { name: '项目周报.md', text: PROJECT }], seam: SEAM })
  await page.waitForFunction(
    (seam) => ['ready', 'error'].includes(window[seam].getState().ingestStatus), SEAM,
    { timeout: 60000 }).catch(() => {})
  const base = await page.evaluate((seam) => {
    const st = window[seam].getState()
    return { ingestStatus: st.ingestStatus, contextId: st.contextId, people: (st.team?.people ?? []).length }
  }, SEAM)
  await page.evaluate((seam) => window[seam].getState().goScreen('room'), SEAM)
  await page.waitForTimeout(700)
  return { ...b, base }
}

const settled = (page) => page.waitForFunction((seam) => {
  const turns = window[seam].getState().turns ?? []
  const last = turns[turns.length - 1]
  return !!last && ['complete', 'error', 'interrupted'].includes(last.run.status)
}, SEAM, { timeout: 40000 }).then(() => true).catch(() => false)

const ask = async (page, text) => {
  const input = page.locator('.lite-room .nexus-followup-composer [data-composer-input]')
  await input.click()
  await input.pressSequentially(text, { delay: 10 })
  await input.press('Enter')
  return settled(page)
}

// ═══ 世界 A · 桌面 1280×900 —— 栏的规格 ═══════════════════════════════════════════
console.log('\n═══ A · 桌面 1280×900：会话侧栏规格 ═══')
{
  const { context, page, pageErrors, base } = await boot({ width: 1280, height: 900 })
  rec('A⓪ 自证：语料上传成功（有 contextId、花名册解析出人）',
    base.ingestStatus === 'ready' && !!base.contextId && base.people >= 2, JSON.stringify(base))

  // ── 空态相：栏的几何/配色 + 开场块居中 ────────────────────────────────────────
  const shell = await page.evaluate(() => {
    // bgOf 与 verify-contrast-smalltext 同源：向上找第一个 alpha>0.5 的背景，兜底同一个常数。
    const parse = (c) => { const m = c.match(/rgba?\(([\d.]+), ?([\d.]+), ?([\d.]+)(?:, ?([\d.]+))?\)/); return m ? [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]] : null }
    const lum = (rgb) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }; return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]) }
    const bgOf = (el) => { let cur = el; while (cur && cur !== document.documentElement) { const c = parse(getComputedStyle(cur).backgroundColor); if (c && c[3] > 0.5) return c; cur = cur.parentElement } return [247, 244, 238, 1] }
    const over = (fg, bg) => [0, 1, 2].map((i) => fg[3] * fg[i] + (1 - fg[3]) * bg[i])
    const aside = document.querySelector('[data-room-aside]')
    const board = document.querySelector('.lite-room-board')
    const welcome = document.querySelector('[data-room-welcome]')
    const composer = document.querySelector('.lite-room > .nexus-followup-composer')
    const topbar = document.querySelector('.prototype-topbar')
    const ar = aside.getBoundingClientRect()
    const br = board.getBoundingClientRect()
    const bs = getComputedStyle(board)
    const railBg = parse(getComputedStyle(aside).backgroundColor)
    const behind = bgOf(aside.parentElement)
    // board 的**内容盒** = 「顶栏以下、composer 以上」那块矩形（padding 上下正是那两条让位）。
    const boxTop = br.top + parseFloat(bs.paddingTop)
    const boxBottom = br.bottom - parseFloat(bs.paddingBottom)
    const wr = welcome ? welcome.getBoundingClientRect() : null
    return {
      rail: { x: Math.round(ar.x), top: Math.round(ar.top), bottom: Math.round(ar.bottom), w: Math.round(ar.width) },
      viewportH: window.innerHeight,
      railBg, behind,
      railLum: Math.round(lum(over(railBg, behind)) * 1e4) / 1e4,
      behindLum: Math.round(lum(behind) * 1e4) / 1e4,
      boardTurns: board.getAttribute('data-room-turns'),
      justify: bs.justifyContent,
      boxTop: Math.round(boxTop), boxBottom: Math.round(boxBottom),
      boxMid: Math.round((boxTop + boxBottom) / 2),
      welcomeMid: wr ? Math.round(wr.top + wr.height / 2) : null,
      composerInBoard: board.contains(composer),
      composerTop: Math.round(composer.getBoundingClientRect().top),
      topbarBottom: Math.round(topbar.getBoundingClientRect().bottom),
    }
  })
  rec('A① 自证：此刻是零轮空态，且侧栏在屏上（后面整段都以这两条为前提）',
    shell.boardTurns === '0' && shell.rail.w > 0, JSON.stringify({ turns: shell.boardTurns, w: shell.rail.w }))
  rec('A② 🔴 栏是**下陷**不是凸起：底色合成到身后那张面上之后，亮度**更低**'
    + '（#80 那份 rgb(surface) 比暖纸画布更亮，正是「浮在页面上的白卡片」观感的主要来源。'
    + '判据不写字面量——写死 rgba 的尺子换一张皮就瞎）',
    shell.railLum < shell.behindLum - 0.005,
    JSON.stringify({ railBg: shell.railBg, behind: shell.behind, railLum: shell.railLum, behindLum: shell.behindLum }))
  rec('A③ 🔴 栏**贴边通到底**：上沿 0、下沿 = 视口底（改造前上沿从 96px 起、下沿停在 780px，'
    + '上下各一道悬空截断边）',
    shell.rail.top === 0 && shell.rail.bottom === shell.viewportH && shell.rail.x === 0,
    JSON.stringify({ rail: shell.rail, viewportH: shell.viewportH }))
  rec('A④ 栏宽仍是 264（它是「发问零跳变」判据的锚——动它等于自找间歇假红）',
    shell.rail.w === 264, String(shell.rail.w))
  rec('A⑪ 🔴 开场块在「顶栏以下、composer 以上」那块矩形里**垂直居中**'
    + '（改造前它钉在滚动口顶端，底下拖着 ~700px 虚无）',
    shell.justify === 'center' && shell.welcomeMid !== null
    && Math.abs(shell.welcomeMid - shell.boxMid) <= 4,
    JSON.stringify({ justify: shell.justify, welcomeMid: shell.welcomeMid, boxMid: shell.boxMid }))
  rec('A⑪ 自证：被居中的那块矩形确实夹在顶栏带底与 composer 顶之间'
    + '（不写这条的话「居中」可以是在任何一块矩形里居中，判据形同虚设）',
    shell.boxTop >= shell.topbarBottom && shell.boxBottom <= shell.composerTop,
    JSON.stringify({ boxTop: shell.boxTop, topbarBottom: shell.topbarBottom, boxBottom: shell.boxBottom, composerTop: shell.composerTop }))
  rec('A⑫ 🔴 composer **没有**被一起收进来居中（`.lite-room-board` 不含它）——方案期原型'
    + '第一版正是这么画的，那会正撞 room-claude-rework 的「发问零跳变」',
    shell.composerInBoard === false, JSON.stringify({ composerInBoard: shell.composerInBoard }))

  // ── 有场相：造两场（一场 2 轮、一场 1 轮），量行的规格 ────────────────────────
  rec('A⓪ 自证：第一场问出来了', await ask(page, Q1))
  await page.evaluate((seam) => window[seam].getState().goScreen('home'), SEAM)
  await page.waitForTimeout(300)
  await page.evaluate((seam) => window[seam].getState().goScreen('room'), SEAM)
  await page.waitForTimeout(500)
  rec('A⓪ 自证：第二场问出来了', await ask(page, Q2))
  rec('A⓪ 自证：第二场续了一轮（于是列表里一场多轮、一场单轮，两种形态都能采到样）',
    await ask(page, Q3))
  await page.waitForFunction((seam) => (window[seam].getState().adviseThreads ?? []).length >= 2,
    SEAM, { timeout: 20000 }).catch(() => {})
  await page.waitForTimeout(400)

  // 🔴 采样前先把指针挪出侧栏：时刻是 hover 才现身的，Playwright 打完字指针可能还停在行上，
  //    那样采到的是 hover 态而不是静息态——一条「静息态不占墨」的判据会被自己的驱动骗成假红/假绿。
  await page.mouse.move(900, 500)
  await page.waitForTimeout(200)

  const list = await page.evaluate(() => {
    const heads = [...document.querySelectorAll('[data-room-aside] .lite-room-history-head')]
    return {
      count: heads.length,
      rows: heads.map((h) => {
        const r = h.getBoundingClientRect()
        const turns = h.querySelector('.lite-room-history-turns')
        const date = h.querySelector('.lite-room-history-date')
        const q = h.querySelector('.lite-room-history-q')
        const qr = q ? q.getBoundingClientRect() : null
        const tr = turns ? turns.getBoundingClientRect() : null
        return {
          thread: h.getAttribute('data-history-thread'),
          turnsAttr: h.getAttribute('data-history-turns'),
          h: Math.round(r.height),
          turnsNode: !!turns,
          turnsInk: turns ? Math.round(tr.width) : 0,
          // 🔴「单行」的正面判据：轮数 pill 的**竖向中线落在标题的竖向跨度里**（并排），
          //    不是"行不太高"。M-C 变异（flex-direction 改回 column）实测把只量高度的尺子
          //    整个绕过去了——两行式在 date 被撤掉之后恰好收成 40px，正落在 [30,40] 里活了下来。
          sameLine: !!(qr && tr) ? (tr.top + tr.height / 2) > qr.top && (tr.top + tr.height / 2) < qr.bottom : null,
          dateInk: date ? Math.round(date.getBoundingClientRect().width * date.getBoundingClientRect().height) : -1,
          dateDisplay: date ? getComputedStyle(date).display : null,
        }
      }),
      toggleInDom: document.querySelectorAll('[data-history-toggle]').length,
    }
  })
  rec('A⓪ 自证：侧栏里真采到了两场，且一场多轮一场单轮（采不到样的采样器是恒绿的）',
    list.count === 2 && list.rows.some((r) => r.turnsAttr === '2') && list.rows.some((r) => r.turnsAttr === '1'),
    JSON.stringify(list.rows.map((r) => r.turnsAttr)))
  // 🔴 两条一起才够：高度尺子单独用**太宽**——M-C 变异（行改回两行式 column）实测在
  //    「时刻已撤、单轮无 pill」之后恰好收成 40px，正落在 [30,40] 里安然活下来。真正被保护的
  //    性质是「标题与轮数在**同一行**」，所以补一条并排判据，并把高度上界收到 36。
  rec('A⑤ 🔴 会话行是**单行 34px**（改造前是标题行 + 左右分栏的 meta 行 ≈ 85px，'
    + '1440×900 只装得下 9 场）',
    list.rows.every((r) => r.h >= 30 && r.h <= 36), JSON.stringify(list.rows.map((r) => r.h)))
  rec('A⑤ 🔴 轮数与标题**并排**（pill 的竖向中线落在标题的竖向跨度里）——只量行高的尺子'
    + '对「改回两行式」是瞎的：撤掉时刻之后两行式恰好收成 40px，M-C 变异实测被它放过',
    list.rows.filter((r) => r.sameLine !== null).length >= 1
    && list.rows.filter((r) => r.sameLine !== null).every((r) => r.sameLine === true),
    JSON.stringify(list.rows.map((r) => ({ n: r.turnsAttr, sameLine: r.sameLine }))))
  rec('A⑥ 🔴 时刻在**静息态零墨**（指针已挪出侧栏才采的样）——它是「每行三个对齐点」里'
    + '最右边那一个，撤掉它列表才有一条稳定竖轴',
    list.rows.every((r) => r.dateDisplay === 'none' && r.dateInk === 0),
    JSON.stringify(list.rows.map((r) => ({ d: r.dateDisplay, ink: r.dateInk }))))
  rec('A⑦ 🔴 单轮的场**一个字都不渲染**（改造前这里是「单独问过一次」——0810 真数据 9 场里'
    + '8 场逐字相同：满行的墨、零信息）',
    list.rows.filter((r) => r.turnsAttr === '1').every((r) => r.turnsNode === false),
    JSON.stringify(list.rows.map((r) => ({ n: r.turnsAttr, node: r.turnsNode }))))
  rec('A⑧ 轮数 >1 的场仍然占墨（多轮才是有信息的那一半——不写这条的话'
    + '「一律不渲染」也能过上面那条）',
    list.rows.filter((r) => r.turnsAttr === '2').every((r) => r.turnsNode && r.turnsInk > 0),
    JSON.stringify(list.rows.map((r) => ({ n: r.turnsAttr, ink: r.turnsInk }))))
  rec('A⑬ 🔴 三个 driver 抓手一个没丢：每行都有 data-history-thread + data-history-turns，'
    + 'data-history-toggle 仍在 DOM 上（verify-room-threads 的 5 条属性判据 + 3 处点击锚全靠它们；'
    + '属性没了那三处会**超时抛错 → 整份门 crash 而不是变红**）',
    list.rows.every((r) => !!r.thread && !!r.turnsAttr) && list.toggleInDom === 1,
    JSON.stringify({ rows: list.rows.map((r) => [r.thread, r.turnsAttr]), toggleInDom: list.toggleInDom }))

  // 选中态：点开另一场（不是当前这场），指针再挪走。
  const otherId = list.rows.find((r) => r.turnsAttr === '1')?.thread
  await page.locator(`[data-history-thread="${otherId}"]`).click()
  await page.waitForTimeout(700)
  await page.mouse.move(900, 500)
  await page.waitForTimeout(200)
  const current = await page.evaluate(() => {
    const parse = (c) => { const m = c.match(/rgba?\(([\d.]+), ?([\d.]+), ?([\d.]+)(?:, ?([\d.]+))?\)/); return m ? [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]] : null }
    const shell = document.querySelector('.lite2-shell')
    const cur = document.querySelector('[data-room-aside] li.is-current .lite-room-history-head')
    if (!cur) return null
    const cs = getComputedStyle(cur)
    const bar = getComputedStyle(cur, '::before')
    const accent = getComputedStyle(shell).getPropertyValue('--lite2-accent-rgb').trim()
    const accentDeep = getComputedStyle(shell).getPropertyValue('--lite2-accent-deep-rgb').trim()
    return {
      bg: parse(cs.backgroundColor), weight: cs.fontWeight,
      barW: bar.width, barBg: parse(bar.backgroundColor), barContent: bar.content,
      accent: accent.split(',').map((n) => +n.trim()),
      accentDeep: accentDeep.split(',').map((n) => +n.trim()),
    }
  })
  rec('A⓪ 自证：真的有一行进了选中态（没有的话下面两条是拿 null 判 false，方向对但理由错）',
    current !== null, JSON.stringify(current))
  // 🔴 `content` 必须一起判：`getComputedStyle(el, '::before')` 对一个**根本没生成**的伪元素
  //    照样把规则里写的 width/background 原样吐回来（M-F 变异把 content 改成 none，屏上封条
  //    整条消失，而只看 width/color 的判据 40/0 全绿活了下来）。整条规则被删时它是 'normal'，
  //    显式关掉时是 'none'——两种都要判死。
  rec('A⑨ 🔴 选中行带一道 **2px 的 accent 左封条**（左封条是「这一条是当前」最省墨的说法；'
    + '判据读 ::before 的计算值，且**先判 content 真的生成了**——没生成的伪元素照样有 width/color）',
    !!current && current.barContent !== 'none' && current.barContent !== 'normal'
    && current.barW === '2px' && !!current.barBg
    && current.barBg[0] === current.accentDeep[0] && current.barBg[1] === current.accentDeep[1]
    && current.barBg[2] === current.accentDeep[2],
    JSON.stringify({ content: current?.barContent, barW: current?.barW, barBg: current?.barBg, accentDeep: current?.accentDeep }))
  rec('A⑨ 选中行是 accent **软底**（同 .lite-ref-chip 的既有 accent 语法，不新开色阶）+ 600 字重',
    !!current && !!current.bg && current.bg[3] > 0 && current.bg[3] < 0.3
    && current.bg[0] === current.accent[0] && current.bg[1] === current.accent[1]
    && current.bg[2] === current.accent[2] && current.weight === '600',
    JSON.stringify({ bg: current?.bg, accent: current?.accent, weight: current?.weight }))

  const labels = await page.evaluate(() => {
    const shell = document.querySelector('.lite2-shell')
    const soft = getComputedStyle(shell).getPropertyValue('--ink-soft').trim()
    const faint = getComputedStyle(shell).getPropertyValue('--ink-faint').trim()
    const probe = document.createElement('span')
    document.querySelector('[data-room-aside]').appendChild(probe)
    const resolve = (v) => { probe.style.color = v; return getComputedStyle(probe).color }
    const wantSoft = resolve(soft)
    const wantFaint = resolve(faint)
    probe.remove()
    const el = document.querySelector('.lite-room-aside-group-label')
    const cs = el ? getComputedStyle(el) : null
    return { color: cs?.color ?? null, weight: cs?.fontWeight ?? null, size: cs?.fontSize ?? null, wantSoft, wantFaint, text: el?.textContent ?? null }
  })
  rec('A⑩ 🔴 组标吃 `--ink-soft` **不吃** `--ink-faint`（11px 的 faint 在 paper 上只有 ~4.7:1，'
    + 'contrast 门的 AA 地板余量仅 0.2、aurora 侧更薄——#80 已立此碑）',
    labels.color === labels.wantSoft && labels.color !== labels.wantFaint,
    JSON.stringify(labels))
  rec('A⑩ 组标是 11px / 700（规格 §2.2）', labels.size === '11px' && labels.weight === '700',
    JSON.stringify({ size: labels.size, weight: labels.weight }))

  rec('A⑭ 桌面态没有抽屉开关可点，但那枚钮仍在 DOM 上（栏本来就在，没有可开的东西）',
    (await page.locator('[data-history-toggle]').isVisible()) === false && list.toggleInDom === 1)
  rec('A⑮ 无 pageerror（桌面世界整程零未捕获异常）', pageErrors.length === 0, JSON.stringify(pageErrors))
  await context.close()
}

// ═══ 世界 B · 手机 390×844 —— 栏退化为抽屉 ══════════════════════════════════════
// ⚠ 这一整块在**所有既有门里零覆盖**：四道门的视口都硬钉 ≥900。别把它当验过的。
console.log('\n═══ B · 手机 390×844：抽屉 ═══')
{
  const { context, page, pageErrors, base } = await boot({ width: 390, height: 844 })
  rec('B⓪ 自证：语料上传成功', base.ingestStatus === 'ready' && !!base.contextId, JSON.stringify(base))
  rec('B⓪ 自证：问出一场来（抽屉里得有东西可量，空抽屉量不出配色与对比度）', await ask(page, Q1))
  // 再续一轮：轮数 pill 只在 >1 时渲染，而它是抽屉里字号最小的那个元素（11px）——
  // 只问一遍的话对比度尺子就采不到它，那正是「判据够不着」而不是「判据写错」的形态。
  rec('B⓪ 自证：续了一轮（轮数 pill 是抽屉里最小的字，不造出来就采不到样）', await ask(page, Q2))
  await page.waitForFunction((seam) => (window[seam].getState().adviseThreads ?? []).length >= 1,
    SEAM, { timeout: 20000 }).catch(() => {})
  await page.waitForTimeout(400)

  const closed = await page.evaluate(() => {
    const vis = (el) => { if (!el) return false; const cs = getComputedStyle(el); const r = el.getBoundingClientRect(); return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0 }
    return {
      asideVisible: vis(document.querySelector('[data-room-aside]')),
      toggleVisible: vis(document.querySelector('[data-history-toggle]')),
      scrim: document.querySelectorAll('[data-history-scrim]').length,
      expanded: document.querySelector('[data-history-toggle]')?.getAttribute('aria-expanded') ?? null,
    }
  })
  rec('B① 手机态**默认收起**，开关钮**可见**（与桌面正好相反：桌面是栏常显、钮 display:none）',
    closed.asideVisible === false && closed.toggleVisible === true, JSON.stringify(closed))
  rec('B① 收起时遮罩根本不在 DOM 上（不是"在但透明"——一块透明的全屏遮罩会静默吃掉正文的点击）',
    closed.scrim === 0 && closed.expanded === 'false', JSON.stringify(closed))

  await page.locator('[data-history-toggle]').click()
  await page.waitForTimeout(500)

  const open = await page.evaluate(() => {
    const parse = (c) => { const m = c.match(/rgba?\(([\d.]+), ?([\d.]+), ?([\d.]+)(?:, ?([\d.]+))?\)/); return m ? [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]] : null }
    const aside = document.querySelector('[data-room-aside]')
    const scrim = document.querySelector('[data-history-scrim]')
    const scene = document.querySelector('.lite-room')
    const ar = aside.getBoundingClientRect()
    const sr = scene.getBoundingClientRect()
    // 🔴 alpha 判的是颜色、这条判的是「它真在上面」：在抽屉覆盖区里取三点实打命中。
    //    半透明的抽屉在屏上是透明玻璃，而 elementFromPoint 照样命中它——两条判据缺一不可。
    const hits = [0.25, 0.5, 0.8].map((f) => {
      const el = document.elementFromPoint(Math.round(ar.x + ar.width / 2), Math.round(ar.top + ar.height * f))
      return el === aside || aside.contains(el)
    })
    return {
      asideRect: { x: Math.round(ar.x), top: Math.round(ar.top), h: Math.round(ar.height), w: Math.round(ar.width) },
      sceneRect: { top: Math.round(sr.top), h: Math.round(sr.height) },
      bg: parse(getComputedStyle(aside).backgroundColor),
      z: getComputedStyle(aside).zIndex,
      hits,
      expanded: document.querySelector('[data-history-toggle]')?.getAttribute('aria-expanded') ?? null,
      scrim: scrim ? { rect: scrim.getBoundingClientRect().width * scrim.getBoundingClientRect().height, bg: parse(getComputedStyle(scrim).backgroundColor), z: getComputedStyle(scrim).zIndex } : null,
      rows: document.querySelectorAll('[data-room-aside] [data-history-thread]').length,
      groupLabels: document.querySelectorAll('[data-room-aside] .lite-room-aside-group-label').length,
      turnsPills: document.querySelectorAll('[data-room-aside] .lite-room-history-turns').length,
    }
  })
  rec('B② 点开关 → 抽屉上屏，aria-expanded 跟着翻',
    open.asideRect.w > 0 && open.expanded === 'true', JSON.stringify({ w: open.asideRect.w, expanded: open.expanded }))
  rec('B② 自证：抽屉里真有内容可量（会话行 + 日期组标 + 轮数 pill 三种都在——'
    + '空抽屉量不出配色也量不出对比度；少了 pill 就漏掉字号最小的那一个）',
    open.rows >= 1 && open.groupLabels >= 1 && open.turnsPills >= 1,
    JSON.stringify({ rows: open.rows, groupLabels: open.groupLabels, turnsPills: open.turnsPills }))
  rec('B③ 🔴 抽屉底色**不透明**（alpha ≥ 0.99）。桌面那份 rgba(ink,.035) 盖到正文上是透明玻璃、'
    + '正文从字缝里透出来；另一半理由是 verify-contrast-smalltext 的 bgOf 把 alpha>0.5 当实底、'
    + '≤0.5 当完全透明跳过——半透明的抽屉会让它量出一个屏上根本不存在的比值',
    !!open.bg && open.bg[3] >= 0.99, JSON.stringify(open.bg))
  rec('B④ 🔴 抽屉真的**盖住**了正文：覆盖区里三点 elementFromPoint 全命中抽屉自己'
    + '（底色不透明但 z 序在正文之下的实现在这条红——alpha 那条管不着它）',
    open.hits.every(Boolean), JSON.stringify({ hits: open.hits, z: open.z }))
  rec('B⑤ 抽屉**贴左、通到底**（不是右上角那块 360px 的弹出面板）',
    open.asideRect.x === 0 && open.asideRect.top === open.sceneRect.top
    && open.asideRect.h >= open.sceneRect.h * 0.9,
    JSON.stringify({ aside: open.asideRect, scene: open.sceneRect }))
  rec('B⑥ 遮罩在场、铺满、且比抽屉低一层（没有遮罩的抽屉，用户不知道点哪儿能关）',
    !!open.scrim && open.scrim.rect > 0 && open.scrim.bg[3] > 0
    && Number(open.scrim.z) < Number(open.z), JSON.stringify(open.scrim))

  const contrast = await page.evaluate(`(${CONTRAST_IN})('[data-room-aside]')`)
  rec('B⑦ 自证：对比度尺子真采到了样（一个采不到样的采样器是恒绿的，那种绿最骗人）',
    contrast.sampled >= 4, JSON.stringify({ sampled: contrast.sampled }))
  rec('B⑦ 🔴 抽屉里所有文字 ≥ AA（小字 4.5 / 大字 3.0，尺子与 verify-contrast-smalltext 同源）'
    + '——这块在四道既有门里零覆盖，它们的视口都硬钉 ≥900',
    contrast.bad.length === 0, contrast.bad.length ? contrast.bad.slice(0, 6).join(' · ') : '0 处')

  // 点一场 → 抽屉自动收起 + 整场进屋（driver 的点击锚在抽屉形态下仍然好使）。
  const rowId = await page.locator('[data-room-aside] [data-history-thread]').first()
    .getAttribute('data-history-thread')
  await page.locator(`[data-history-thread="${rowId}"]`).click()
  await page.waitForTimeout(700)
  const afterPick = await page.evaluate((seam) => {
    const vis = (el) => { if (!el) return false; const cs = getComputedStyle(el); const r = el.getBoundingClientRect(); return cs.display !== 'none' && r.width > 0 && r.height > 0 }
    return {
      asideVisible: vis(document.querySelector('[data-room-aside]')),
      scrim: document.querySelectorAll('[data-history-scrim]').length,
      turns: (window[seam].getState().turns ?? []).length,
    }
  }, SEAM)
  rec('B⑧ 点一场：抽屉自动收起、遮罩跟着撤走，且整场真的进了议事室'
    + '（抽屉不收＝用户点完还要再点一下才能看见自己点开的东西）',
    afterPick.asideVisible === false && afterPick.scrim === 0 && afterPick.turns >= 1,
    JSON.stringify(afterPick))

  // 遮罩自己也得能关（B⑥ 只证明它在场，这条证明它管用）。
  await page.locator('[data-history-toggle]').click()
  await page.waitForTimeout(400)
  const scrimBefore = await page.locator('[data-history-scrim]').count()
  await page.locator('[data-history-scrim]').click({ position: { x: 360, y: 700 } }).catch(() => {})
  await page.waitForTimeout(400)
  const afterScrim = await page.evaluate(() => {
    const el = document.querySelector('[data-room-aside]')
    const cs = el ? getComputedStyle(el) : null
    return { asideDisplay: cs?.display ?? null, scrim: document.querySelectorAll('[data-history-scrim]').length }
  })
  rec('B⑥ 点遮罩即收起（自证：点之前遮罩确实在场，否则这条是拿一个不存在的元素判成功）',
    scrimBefore === 1 && afterScrim.asideDisplay === 'none' && afterScrim.scrim === 0,
    JSON.stringify({ scrimBefore, ...afterScrim }))

  rec('B⑨ 无 pageerror（手机世界整程零未捕获异常）', pageErrors.length === 0, JSON.stringify(pageErrors))
  await context.close()
}

void rows
await finish({ rows }, { browser,
  label: '#83 会话侧栏（桌面栏规格 · 开场块居中 · ≤860 抽屉）',
  listFailures: true })
