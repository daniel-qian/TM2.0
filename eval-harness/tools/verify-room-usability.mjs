// 议事室可用性门（UIUX 棒 2026-07-20 晚 · F1 遮挡 / F2 滚轮劫持）。
//
// ## 缺陷是什么（写门时两条都是活的，本门先红后修）
//
// F1 · 「展开原始流」按钮真人点不到：
//   shared/styles/00-base.css 给 .nexus-brief-hud 定了 story 场景的
//   `position:absolute; z-index:40; transform:translateX(-50%)`；lite/lite2 的 board 覆盖
//   （lite.css:640 / lite2.css:758）只重置了 position/flex，**忘了清 transform 和 z-index**。
//   于是 HUD 作为 flex 子项排完位后又被残留的 translateX(-50%) 左拖半个身位（640px 宽时 =
//   -320px），正好压在终端头栏上；z-index 40 > 终端的 30，命中测试全被 HUD 吃掉。
//   实测（1280x720 与 1000x720 都一样，视口无关）：v02 `.lite-flow-toggle` 中心点
//   elementFromPoint 返回的是 `span.nexus-brief-bar-eyebrow`。Playwright 真实点击超时——
//   verify-zh-purity.mjs:183 早注明「真人可能也点不动，已单独记录」并改用 DOM 派发绕开；
//   本门就是那条「另案」。真人唯一能展开原始流的方式是键盘 Tab + Enter。
//
// F2 · 滚轮在结果卡上是缩放不是滚动：
//   LitePanZoom（lite/lite2 各一份拷贝）的 wheel 没配 excluded，react-zoom-pan-pinch 对
//   整个画布 preventDefault 后缩放。而 8 字段结果卡 `.lite-room-card` 是 max-height:560 +
//   overflow:auto 的滚动区（实测卡内容 1700px+ 高）——经理想往下读产品的核心输出，滚轮却把
//   画布缩走了。实测：合成 wheel 事件 defaultPrevented=true、scale 1→0.88、卡 scrollTop 不动。
//   （原始流终端 .nexus-terminal-log / 简化流 .lite-flow-body 同为滚动区，一并断言。）
//
// ## 判别器为什么在两种世界里答案不同
//   坏世界：elementFromPoint 命中 HUD 子元素（F1）；wheel defaultPrevented=true 且 scale 变（F2）。
//   好世界：elementFromPoint 命中 toggle 自身/子元素；wheel defaultPrevented=false 且 scale 不变。
//   防「把 HUD 藏掉来修」：HUD 必须仍可见（宽高>0 且在视口内）。
//   防「只修 CSS 不验行为」：v02 加一条 Playwright **真实点击**（actionability 全链路），
//   点完 .lite-flow 必须切到 .is-raw——按钮不只是"够得着"，是真的干活。
//
// ## 怎么跑（与 verify-file-manifest-truth.mjs 同一套前置；端口按需换）
//   1) cd eval-harness && AVERY_BRAIN=mock AVERY_EXTRACTOR=heuristic AVERY_EMBEDDINGS=keyword \
//      python -m uvicorn service.app:app --port 8137
//   2) node node_modules/vite/bin/vite.js build --mode development   （API base 默认即 8137）
//   3) node node_modules/vite/bin/vite.js preview --port 5173 --strictPort
//   4) VERIFY_BASE=http://127.0.0.1:5173 node eval-harness/tools/verify-room-usability.mjs
import { chromium } from 'playwright'

const UI = process.env.VERIFY_BASE || 'http://127.0.0.1:5173'
const R = []
const rec = (n, ok, d) => { R.push({ n, ok }); console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${n}${d ? ' — ' + d : ''}`) }

// 一份极小但真实的语料：heuristic 抽取器读得出 1 人 1 项目即可（本门只要 run 能跑完出卡）。
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

const browser = await chromium.launch({ headless: true })

async function driveShell({ label, url, storeSeam }) {
  console.log(`\n═══ ${label} ═══`)
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } })
  const page = await ctx.newPage()
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(e.message))
  const tag = (n) => `[${label}] ${n}`

  await page.goto(url, { waitUntil: 'networkidle' })
  if (await page.locator('.lite-onboard').count()) {
    await page.keyboard.press('Escape')
    await page.waitForTimeout(600)
  }

  // 真上传（heuristic 后端，秒级）→ ask（mock brain）→ 等 run 完成出卡。
  await page.evaluate(
    async ({ doc, seam }) => {
      const enc = new TextEncoder()
      const f = new File([enc.encode(doc)], 'w33-weekly.md', { type: 'text/markdown' })
      await window[seam].getState().uploadFiles([f])
    },
    { doc: SEED_DOC, seam: storeSeam },
  )
  await page.waitForFunction(
    (seam) => ['ready', 'error'].includes(window[seam].getState().ingestStatus),
    storeSeam, { timeout: 30000 },
  )
  const ingestStatus = await page.evaluate((seam) => window[seam].getState().ingestStatus, storeSeam)
  rec(tag('上传成功（前置，非判据）'), ingestStatus === 'ready', `ingestStatus=${ingestStatus}`)

  await page.evaluate((seam) => {
    const st = window[seam].getState()
    st.goScreen('room')
    st.askLive({ situation: '这周谁的项目最需要我搭把手？' })
  }, storeSeam)
  await page.waitForFunction(
    (seam) => ['complete', 'error'].includes(window[seam].getState().run.status),
    storeSeam, { timeout: 30000 },
  )
  const runStatus = await page.evaluate((seam) => window[seam].getState().run.status, storeSeam)
  rec(tag('advise 跑完出卡（前置，非判据）'), runStatus === 'complete', `run.status=${runStatus}`)
  await page.waitForTimeout(400)

  // ── F1 · HUD 不许压住终端头栏（两个壳都断言几何；v02 另断言按钮真的可点）────────────
  const geo = await page.evaluate(() => {
    const hud = document.querySelector('.nexus-brief-hud')
    const bar = document.querySelector('.nexus-terminal-bar')
    const rect = (el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height } }
    const overlap = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) *
      Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y))
    if (!hud || !bar) return { hud: !!hud, bar: !!bar }
    const h = rect(hud); const b = rect(bar)
    return { hud: h, bar: b, overlapArea: Math.round(overlap(h, b)) }
  })
  rec(tag('HUD 与终端头栏零重叠（残留 translateX(-50%) 会把 HUD 拖到头栏上）'),
    geo.overlapArea === 0, `overlapArea=${geo.overlapArea} hud=${JSON.stringify(geo.hud)}`)
  rec(tag('HUD 仍然可见（不许用「藏掉 HUD」来修重叠）'),
    Boolean(geo.hud) && geo.hud.w > 0 && geo.hud.h > 0 && geo.hud.y >= 0 && geo.hud.x >= 0,
    `hud=${JSON.stringify(geo.hud)}`)

  if (label === 'v02') {
    const hit = await page.evaluate(() => {
      const t = document.querySelector('.lite-flow-toggle')
      if (!t) return { found: false }
      const r = t.getBoundingClientRect()
      const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
      return { found: true, ok: el === t || t.contains(el), hitCls: el ? String(el.className).slice(0, 60) : '(null)' }
    })
    rec(tag('「展开原始流」按钮中心点命中的是按钮自己（elementFromPoint）'),
      hit.found && hit.ok, `hit=${hit.hitCls ?? '(no toggle)'}`)
  }

  // ── F2 · 滚轮在滚动区上必须是滚动，不是缩放 ────────────────────────────────────────
  // 0729 画板退役（output-form-0729/01）：v02 已无画布——F2 的「不被缩放劫持」在 v02 变成
  // 「defaultPrevented=false（劫持源整个退役）」；v01 冻结壳仍有画布，保留原 transform 断言。
  // ⚠ 顺序：先测滚轮再做真实点击——v02 点开原始流后 .lite-flow-body（简化态）就不在 DOM 里了。
  if (label === 'v02') {
    const decanvas = await page.evaluate(() => {
      const scroll = document.querySelector('.lite-room-scroll')
      const card = document.querySelector('.lite-room-board .lite-room-card')
      return {
        canvasGone: !document.querySelector('.lite-room-canvas') &&
          !document.querySelector('.lite-panzoom-wrapper') && !document.querySelector('.lite-panzoom-content'),
        scrollPresent: !!scroll,
        scrollable: scroll ? scroll.scrollHeight > scroll.clientHeight : false,
        cardStatic: card ? getComputedStyle(card).position === 'static' : null,
        cardNoInnerScroll: card ? getComputedStyle(card).overflowY !== 'auto' : null,
      }
    })
    rec(tag('画布退役：.lite-room-canvas/.lite-panzoom-* 不在 v02 DOM'), decanvas.canvasGone, JSON.stringify(decanvas))
    rec(tag('滚动容器 .lite-room-scroll 在且真的可滚（1700px+ 卡靠页面滚）'),
      decanvas.scrollPresent && decanvas.scrollable, `scrollable=${decanvas.scrollable}`)
    rec(tag('判读卡回文档流（static 且不内滚——整卡可读是 persona P1 的修法）'),
      decanvas.cardStatic === true && decanvas.cardNoInnerScroll === true,
      `static=${decanvas.cardStatic} noInnerScroll=${decanvas.cardNoInnerScroll}`)
    for (const sel of ['.lite-room-card', '.lite-flow-body']) {
      const wheel = await page.evaluate((s) => {
        const el = document.querySelector(s)
        if (!el) return { found: false, sel: s }
        const r = el.getBoundingClientRect()
        const cx = Math.min(Math.max(r.x + 30, 10), innerWidth - 10)
        const cy = Math.min(Math.max(r.y + 30, 10), innerHeight - 10)
        const ev = new WheelEvent('wheel', { deltaY: 120, clientX: cx, clientY: cy, bubbles: true, cancelable: true })
        ;(document.elementFromPoint(cx, cy) || el).dispatchEvent(ev)
        return { found: true, sel: s, prevented: ev.defaultPrevented }
      }, sel)
      if (!wheel.found) { rec(tag(`滚动区存在（${sel}）`), false, '选择器没找到'); continue }
      rec(tag(`滚轮在 ${sel} 上不被任何 handler 劫持（defaultPrevented=false）`),
        wheel.prevented === false, `prevented=${wheel.prevented}`)
    }
    // composer 不压卡尾：滚到底后 board 最后一个子元素的下沿必须在 composer 上沿之上
    //（board 底 padding 150px 就是给这个让位的——padding 被砍这里必红）。
    const clearance = await page.evaluate(() => new Promise((res) => {
      const scroll = document.querySelector('.lite-room-scroll')
      const composer = document.querySelector('.lite-room .nexus-followup-composer')
      const board = document.querySelector('.lite-room-board')
      if (!scroll || !composer || !board || !board.children.length) return res({ found: false })
      scroll.scrollTop = scroll.scrollHeight
      setTimeout(() => {
        const last = board.children[board.children.length - 1]
        const lb = last.getBoundingClientRect().bottom
        const ct = composer.getBoundingClientRect().top
        res({ found: true, lastBottom: Math.round(lb), composerTop: Math.round(ct), clear: lb <= ct + 1 })
      }, 150)
    }))
    rec(tag('滚到底后卡尾不被 composer 压住（底部让位足够）'),
      clearance.found && clearance.clear, JSON.stringify(clearance))
  } else {
    for (const sel of ['.lite-room-card', '.nexus-terminal-log']) {
      const wheel = await page.evaluate((s) => {
        const el = document.querySelector(s)
        const content = document.querySelector('.lite-panzoom-content')
        if (!el || !content) return { found: false, sel: s }
        const before = getComputedStyle(content).transform
        const r = el.getBoundingClientRect()
        const cx = Math.min(Math.max(r.x + 30, 10), innerWidth - 10)
        const cy = Math.min(Math.max(r.y + 30, 10), innerHeight - 10)
        const target = document.elementFromPoint(cx, cy) || el
        const ev = new WheelEvent('wheel', { deltaY: 120, clientX: cx, clientY: cy, bubbles: true, cancelable: true })
        target.dispatchEvent(ev)
        return new Promise((res) => setTimeout(() => {
          res({ found: true, sel: s, prevented: ev.defaultPrevented, before, after: getComputedStyle(content).transform })
        }, 250))
      }, sel)
      if (!wheel.found) { rec(tag(`滚动区存在（${sel}）`), false, '选择器没找到'); continue }
      rec(tag(`滚轮在 ${sel} 上不被缩放劫持（defaultPrevented=false 且 scale 不变）`),
        wheel.prevented === false && wheel.before === wheel.after,
        `prevented=${wheel.prevented} transform ${wheel.before === wheel.after ? '不变' : wheel.before + ' → ' + wheel.after}`)
    }
  }

  // v02 · 真实点击全链路：actionability（可见/未被遮挡）+ 点完确实切到原始流 + 原始流终端的
  // 滚轮同样不被劫持。放在滚轮断言之后（点击会把简化态换成原始终端）。
  if (label === 'v02') {
    let realClickOk = false, clickErr = ''
    try {
      await page.locator('.lite-flow-toggle').click({ timeout: 2500 })
      realClickOk = true
    } catch (e) { clickErr = String(e.message).split('\n')[0] }
    rec(tag('Playwright 真实点击不超时（此前只能 DOM 派发绕开）'), realClickOk, clickErr)
    if (realClickOk) {
      const isRaw = await page.evaluate(() => Boolean(document.querySelector('.lite-flow.is-raw')))
      rec(tag('点完真的展开了原始流（.lite-flow.is-raw）'), isRaw, `isRaw=${isRaw}`)
      // 0729 画板退役：v02 无 .lite-panzoom-content 可量 transform——只断言无劫持。
      const rawWheel = await page.evaluate(() => {
        const el = document.querySelector('.nexus-terminal-log')
        if (!el) return { found: false }
        const r = el.getBoundingClientRect()
        const cx = Math.min(Math.max(r.x + 30, 10), innerWidth - 10)
        const cy = Math.min(Math.max(r.y + 30, 10), innerHeight - 10)
        const ev = new WheelEvent('wheel', { deltaY: 120, clientX: cx, clientY: cy, bubbles: true, cancelable: true })
        ;(document.elementFromPoint(cx, cy) || el).dispatchEvent(ev)
        return { found: true, prevented: ev.defaultPrevented }
      })
      rec(tag('原始流终端上滚轮不被劫持'),
        rawWheel.found && rawWheel.prevented === false,
        rawWheel.found ? `prevented=${rawWheel.prevented}` : '终端没找到')
    }
  }

  // 反向护栏（0729 起 v01-only：v02 画布已退役，无 zoom 可护）：空白画布上滚轮**仍然**缩放
  //（别把 wheel-zoom 一刀关死——排除是精确的，不是全局的）。
  if (label === 'v01') {
  const bgZoom = await page.evaluate(() => {
    const content = document.querySelector('.lite-panzoom-content')
    const wrapper = document.querySelector('.lite-panzoom-wrapper')
    if (!content || !wrapper) return { found: false }
    const before = getComputedStyle(content).transform
    const r = wrapper.getBoundingClientRect()
    // 画布右下角落一般是空白（board 内容从左上排布）
    const ev = new WheelEvent('wheel', { deltaY: 120, clientX: r.x + r.width - 12, clientY: r.y + r.height - 12, bubbles: true, cancelable: true })
    ;(document.elementFromPoint(r.x + r.width - 12, r.y + r.height - 12) || wrapper).dispatchEvent(ev)
    return new Promise((res) => setTimeout(() => {
      res({ found: true, before, after: getComputedStyle(content).transform })
    }, 250))
  })
  rec(tag('空白画布上滚轮仍是缩放（排除名单没把 wheel-zoom 一刀关死）'),
    bgZoom.found && bgZoom.before !== bgZoom.after,
    bgZoom.found ? (bgZoom.before === bgZoom.after ? 'scale 没变——zoom 被全局关掉了？' : 'zoom 正常') : '画布没找到')
  }

  rec(tag('无 pageerror'), pageErrors.length === 0, pageErrors.slice(0, 2).join(' | ') || '0 条')
  await ctx.close()
}

await driveShell({ label: 'v02', url: `${UI}/?v=2&mode=live&look=paper&lang=zh`, storeSeam: '__lite2Store' })
await driveShell({ label: 'v01', url: `${UI}/?v=1&mode=live&lang=zh`, storeSeam: '__liteStore' })

await browser.close()

const pass = R.filter((r) => r.ok).length
const fail = R.length - pass
console.log(`\n═══ 议事室可用性：${pass} PASS · ${fail} FAIL ═══`)
process.exit(fail ? 1 : 0)
