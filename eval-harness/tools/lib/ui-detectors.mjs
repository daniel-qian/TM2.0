// UI 缺陷检测器库（cr-align 视觉战役棒0 · 2026-07-21）。
//
// 被 sweep-ui-defects.mjs 的正式扫雷与 --selftest 两条路共用——selftest 注入已知故障
// 断言每类检测器都会响，检测器与自检永远是同一份代码（自检测的不是替身）。
//
// 每个检测器是「缺陷类」不是「缺陷实例」：D1 抓的是「任何元素钻进顶栏带」这一类
// （2026-07-21 生产 Bug A 的全类），D2 抓「任何控件裸浏览器默认样式」（Bug B 全类）。
//
// DETECTOR_BUNDLE 是在页内执行的函数体字符串：page.evaluate(DETECTOR_BUNDLE, opts)
// 返回 finding[]：{ cls, selector, severity, detail, text }。
// opts: { focusProbe: boolean }  — focusProbe 只在桌面满世界跑（成本控制）。

export const DETECTOR_CLASSES = [
  'fixed-overlap', // D1 顶栏带遮压（bbox 相交 / 首标题带底不变量）
  'default-control', // D2 浏览器默认样式控件
  'h-overflow', // D3 横向溢出 / 元素突出视口
  'contrast', // D4 WCAG AA 对比度（移植自 verify-contrast-smalltext.mjs 的 AUDIT_FN）
  'text-hidden', // D5 隐形 / 截字 / 被压文本
  'small-target', // D6a 点击热区 < 24×24
  'focus-missing', // D6b focus 无可见反馈
  'broken-media', // D6c 坏图 / 零尺寸图标
]

export const DETECTOR_BUNDLE = `((opts) => {
  const findings = []
  const push = (cls, el, severity, detail, text) => {
    findings.push({
      cls,
      selector: selOf(el),
      severity,
      detail: detail || {},
      text: (text || '').slice(0, 30),
    })
  }
  // 归一化选择器：tag + 前两个语义类名（去掉状态类），不含 nth-child / 动态 id——
  // 让指纹在数据变化后仍然稳定
  const selOf = (el) => {
    if (!el || !el.tagName) return '?'
    const cls = (typeof el.className === 'string' ? el.className : '')
      .split(/\\s+/)
      .filter((c) => c && !/^(is-|has-|active|open)/.test(c))
      .slice(0, 2)
      .join('.')
    const marker = el.getAttribute && el.getAttribute('data-sweep-selftest')
    return el.tagName.toLowerCase() + (cls ? '.' + cls : '') + (marker ? '[selftest=' + marker + ']' : '')
  }
  const visible = (el) => {
    const cs = getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return false
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0
  }
  const stage = document.querySelector('.scene-stage') || document.body
  const INTERACTIVE = 'button, a[href], input, select, textarea, [role="button"], [tabindex="0"]'

  // ── D1 · fixed-overlap ─────────────────────────────────────────────────────
  ;(() => {
    const bar = document.querySelector('.prototype-topbar')
    if (!bar || getComputedStyle(bar).position !== 'fixed') return // 窄屏 sticky 模式无此类
    let bandBottom = 0
    const pills = []
    for (const ch of bar.children) {
      if (!visible(ch)) continue
      const r = ch.getBoundingClientRect()
      bandBottom = Math.max(bandBottom, r.bottom)
      pills.push(r)
    }
    if (!pills.length) return
    // 1a 相交检测：标题/眉题/交互件的 bbox 与任一 pill 相交 > 4px（双轴）
    const candidates = stage.querySelectorAll('h1, h2, h3, h4, .eyebrow, ' + INTERACTIVE)
    for (const el of candidates) {
      if (!visible(el)) continue
      const r = el.getBoundingClientRect()
      for (const p of pills) {
        const ox = Math.min(r.right, p.right) - Math.max(r.left, p.left)
        const oy = Math.min(r.bottom, p.bottom) - Math.max(r.top, p.top)
        if (ox > 4 && oy > 4) {
          const at = document.elementFromPoint((r.left + r.right) / 2, r.top + Math.min(10, r.height / 2))
          const occluded = !!(at && at.closest('.prototype-topbar'))
          push('fixed-overlap', el, occluded ? 'high' : 'medium',
            { kind: 'intersect', overlapPx: [Math.round(ox), Math.round(oy)], occluded }, el.innerText)
          break
        }
      }
    }
    // 1b 带底不变量：本屏文档序首个可见标题必须低于顶栏带底 + 8px
    //   （比相交更强：即使标题恰好从 pill 缝里躲过，也说明该屏没留让位）
    for (const h of stage.querySelectorAll('h1, h2, h3')) {
      if (!visible(h)) continue
      const r = h.getBoundingClientRect()
      if (r.top < bandBottom + 8) {
        push('fixed-overlap', h, 'high',
          { kind: 'band-invariant', headingTop: Math.round(r.top), bandBottom: Math.round(bandBottom) }, h.innerText)
      }
      break
    }
  })()

  // ── D2 · default-control ───────────────────────────────────────────────────
  ;(() => {
    const shellFont = getComputedStyle(document.querySelector('.lite2-shell') || document.body).fontFamily
    for (const el of document.querySelectorAll('button, input, select, textarea')) {
      if (!visible(el)) continue
      const cs = getComputedStyle(el)
      const signals = []
      const bg = cs.backgroundColor
      if (bg === 'rgb(239, 239, 239)' || bg === 'rgb(240, 240, 240)') signals.push('ButtonFace底')
      if (/outset|inset/.test(cs.borderTopStyle)) signals.push('outset边')
      if (cs.borderTopColor === 'rgb(118, 118, 118)') signals.push('UA灰边')
      if (cs.fontSize === '13.333px') signals.push('UA字号')
      if (cs.fontFamily !== shellFont && !el.closest('[data-allow-ua-font]')) signals.push('UA字族')
      if (signals.length >= 2) {
        push('default-control', el, 'high', { signals }, el.innerText || el.value)
      }
    }
    for (const a of document.querySelectorAll('a')) {
      if (!visible(a)) continue
      if (getComputedStyle(a).color === 'rgb(0, 0, 238)') {
        push('default-control', a, 'medium', { signals: ['UA链接蓝'] }, a.innerText)
      }
    }
  })()

  // ── D3 · h-overflow ────────────────────────────────────────────────────────
  ;(() => {
    const docOver = document.documentElement.scrollWidth > innerWidth + 1
    const culprits = []
    for (const el of document.body.querySelectorAll('*')) {
      if (culprits.length >= 30) break
      const cs = getComputedStyle(el)
      if (cs.position === 'fixed') continue
      if (!visible(el)) continue
      const r = el.getBoundingClientRect()
      if (r.left < -1000) continue // 刻意离屏的（如视觉隐藏辅助文本）不算
      if (r.right > innerWidth + 1 || r.left < -1) {
        // 真滚动祖先（auto/scroll）里的突出是正常滚动内容，不算；
        // overflow:hidden 祖先【不算】管理——壳就是 hidden 的，hidden 里的突出=内容被剪，正是要抓的；
        // 议事室平移画布是刻意越界，显式豁免
        if (el.closest('.lite-room-canvas, .lite-panzoom-wrapper, [data-panzoom]')) continue
        let cur = el.parentElement, scrollManaged = false
        while (cur && cur !== document.body) {
          const pcs = getComputedStyle(cur)
          if (/(auto|scroll)/.test(pcs.overflowX)) { scrollManaged = true; break }
          cur = cur.parentElement
        }
        if (!scrollManaged) culprits.push({ el, protrude: Math.round(Math.max(r.right - innerWidth, -r.left)) })
      }
    }
    culprits.sort((a, b) => b.protrude - a.protrude)
    for (const c of culprits.slice(0, 3)) {
      push('h-overflow', c.el, 'medium', { protrudePx: c.protrude, docOver }, c.el.innerText)
    }
  })()

  // ── D4 · contrast ──────────────────────────────────────────────────────────
  // 移植自 eval-harness/tools/verify-contrast-smalltext.mjs 的 AUDIT_FN（那道门是
  // 已证红的冻结判别器，不动它；这里按扫雷需要包成 finding 形状，阈值与容差逐字一致）。
  ;(() => {
    function parseColor(c) { const m = c.match(/rgba?\\(([\\d.]+), ?([\\d.]+), ?([\\d.]+)(?:, ?([\\d.]+))?\\)/); return m ? [+m[1],+m[2],+m[3], m[4]===undefined?1:+m[4]] : null }
    function lum(rgb) { const f = v => { v/=255; return v<=0.03928? v/12.92 : Math.pow((v+0.055)/1.055,2.4) }; return 0.2126*f(rgb[0])+0.7152*f(rgb[1])+0.0722*f(rgb[2]) }
    function ratio(a,b){ const l1=lum(a), l2=lum(b); return (Math.max(l1,l2)+0.05)/(Math.min(l1,l2)+0.05) }
    function bgOf(el){ let cur = el; while(cur && cur !== document.documentElement){ const c = parseColor(getComputedStyle(cur).backgroundColor); if (c && c[3] > 0.5) return c; cur = cur.parentElement }
      const shell = document.querySelector('.lite2-shell, .lite-shell')
      const base = shell ? parseColor(getComputedStyle(shell).getPropertyValue('background-color')) : null
      return base && base[3] > 0.5 ? base : [247,244,238,1] }
    const seen = new Set()
    const root = stage.querySelectorAll('*').length ? stage : document.body
    root.querySelectorAll('*').forEach(el => {
      if (!el.innerText || el.children.length > 0) return
      const txt = el.innerText.trim(); if (!txt || txt.length < 2) return
      const cs = getComputedStyle(el)
      if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) return
      const fg = parseColor(cs.color); if (!fg) return
      const r = ratio(fg, bgOf(el))
      const size = parseFloat(cs.fontSize); const bold = parseInt(cs.fontWeight) >= 700
      const threshold = (size >= 18.66 || (size >= 14 && bold)) ? 3 : 4.5
      if (r < threshold - 0.03) {
        const key = selOf(el) + '|' + cs.color
        if (!seen.has(key)) {
          seen.add(key)
          push('contrast', el, 'high', { ratio: Math.round(r*100)/100, threshold, fontSize: size }, txt)
        }
      }
    })
  })()

  // ── D5 · text-hidden（隐形 / 截字 / 被压） ──────────────────────────────────
  ;(() => {
    for (const el of stage.querySelectorAll('*')) {
      if (el.children.length > 0) continue
      const txt = (el.innerText || '').trim()
      if (!txt || txt.length < 2) continue
      const cs = getComputedStyle(el)
      if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) continue
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) {
        // <option> 在 Chromium 里永远量出 0×0（原生下拉渲染），不是缺陷
        if (!el.closest('select')) push('text-hidden', el, 'medium', { kind: 'zero-size' }, txt)
        continue
      }
      // 截字：overflow:hidden 祖先的下缘从行框中间穿过（留 2px 容差；有意 ellipsis 的不算）。
      // 先遇到滚动祖先（auto/scroll）= 滚动可达，不算截断；平移画布本身的剪裁 = 平移可达，同免。
      if (cs.textOverflow !== 'ellipsis') {
        let cur = el.parentElement
        while (cur && cur !== document.body) {
          const pcs = getComputedStyle(cur)
          if (/(auto|scroll)/.test(pcs.overflowY)) break
          if (/(hidden|clip)/.test(pcs.overflowY)) {
            if (!cur.matches('.lite-room-canvas, .lite-panzoom-wrapper, [data-panzoom]')) {
              const pr = cur.getBoundingClientRect()
              if (r.top < pr.bottom - 2 && r.bottom - 2 > pr.bottom) {
                push('text-hidden', el, 'medium', { kind: 'clipped', clipBottom: Math.round(pr.bottom), textBottom: Math.round(r.bottom) }, txt)
              }
            }
            break
          }
          cur = cur.parentElement
        }
      }
      // 被压：文本中心命中一个无亲缘关系的不透明元素（顶栏归 D1 管；pointer-events:none 覆层不算）
      const at = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2)
      if (at && at !== el && !at.contains(el) && !el.contains(at) && !at.closest('.prototype-topbar')) {
        const acs = getComputedStyle(at)
        const abg = acs.backgroundColor.match(/rgba?\\([^)]*\\)/) ? acs.backgroundColor : ''
        const opaque = abg && !/rgba\\([^)]*, ?0(\\.\\d+)?\\)$/.test(abg) && !abg.endsWith(', 0)')
        if (opaque && acs.pointerEvents !== 'none' && !at.closest('[role="dialog"]')) {
          push('text-hidden', el, 'medium', { kind: 'buried', by: selOf(at) }, txt)
        }
      }
    }
  })()

  // ── D6a · small-target ─────────────────────────────────────────────────────
  ;(() => {
    for (const el of stage.querySelectorAll(INTERACTIVE)) {
      if (!visible(el)) continue
      const r = el.getBoundingClientRect()
      if (r.width < 24 || r.height < 24) {
        push('small-target', el, 'low', { size: [Math.round(r.width), Math.round(r.height)] }, el.innerText)
      }
    }
  })()

  // ── D6b · focus-missing（focusProbe 开时才跑——桌面满世界） ───────────────────
  if (opts && opts.focusProbe) {
    const snap = (el) => { const c = getComputedStyle(el); return c.outlineWidth + '|' + c.outlineColor + '|' + c.boxShadow + '|' + c.borderTopColor + '|' + c.backgroundColor }
    const els = [...stage.querySelectorAll(INTERACTIVE)].filter(visible).slice(0, 60)
    const prevActive = document.activeElement
    for (const el of els) {
      const before = snap(el)
      el.focus({ preventScroll: true })
      if (document.activeElement !== el) continue // 不可聚焦（disabled 等）不算
      const after = snap(el)
      el.blur()
      if (before === after) {
        push('focus-missing', el, 'low', {}, el.innerText)
      }
    }
    if (prevActive && prevActive.focus) prevActive.focus({ preventScroll: true })
  }

  // ── D6c · broken-media ─────────────────────────────────────────────────────
  ;(() => {
    for (const img of document.querySelectorAll('img')) {
      const cs = getComputedStyle(img)
      if (cs.display === 'none') continue
      if (img.complete && img.naturalWidth === 0) {
        push('broken-media', img, 'medium', { kind: 'img', src: (img.getAttribute('src') || '').slice(0, 60) })
      }
    }
    for (const svg of document.querySelectorAll('svg')) {
      if (!svg.parentElement || !visible(svg.parentElement)) continue
      const r = svg.getBoundingClientRect()
      const cs = getComputedStyle(svg)
      if (cs.display !== 'none' && cs.visibility !== 'hidden' && (r.width === 0 || r.height === 0)) {
        push('broken-media', svg, 'medium', { kind: 'svg-zero' })
      }
    }
  })()

  return findings
})`

// selftest 的故障注入：每类一个已知故障，返回注入脚本（页内执行）。
// 检测器若对这些故障哑火，selftest 非零退出——发现工具自己的两世界纪律。
export const SELFTEST_INJECT = `(() => {
  const stage = document.querySelector('.scene-stage') || document.body
  const mk = (html) => { const d = document.createElement('div'); d.innerHTML = html; return d.firstElementChild }
  // D1: 首标题顶到 20px（钻进顶栏带）
  const h = mk('<h1 data-sweep-selftest="d1" style="position:fixed;top:20px;left:40%;z-index:45;margin:0">自检标题</h1>')
  stage.prepend(h)
  // D2: 裸默认按钮
  stage.appendChild(mk('<button data-sweep-selftest="d2">裸按钮</button>'))
  // D3: 突出视口的宽块
  stage.appendChild(mk('<div data-sweep-selftest="d3" style="position:absolute;left:0;top:300px;width:2600px;height:12px;background:#eee">宽</div>'))
  // D4: 3:1 以下的灰字
  stage.appendChild(mk('<span data-sweep-selftest="d4" style="position:absolute;top:340px;left:100px;color:#cccccc;background:#ffffff;font-size:12px">灰字样例灰字样例</span>'))
  // D5: 被 overflow:hidden 拦腰截断的字
  stage.appendChild(mk('<div style="position:absolute;top:370px;left:100px;overflow:hidden;height:7px"><span data-sweep-selftest="d5">被截断的文本样例</span></div>'))
  // D6a: 10×10 热区
  stage.appendChild(mk('<button data-sweep-selftest="d6a" style="width:10px;height:10px;padding:0;border:0;background:#333;position:absolute;top:400px;left:100px"></button>'))
  // D6b: focus 零反馈的按钮
  stage.appendChild(mk('<button data-sweep-selftest="d6b" style="outline:none;border:1px solid #999;background:#fff;position:absolute;top:430px;left:100px">无焦点反馈</button>'))
  // D6c: 坏图
  stage.appendChild(mk('<img data-sweep-selftest="d6c" src="data:image/png;base64,AAAA" style="position:absolute;top:460px;left:100px">'))
  return true
})()`

// selftest 断言表：每类必须新增 ≥1 条 finding
export const SELFTEST_EXPECT = [
  'fixed-overlap',
  'default-control',
  'h-overflow',
  'contrast',
  'text-hidden',
  'small-target',
  'focus-missing',
  'broken-media',
]
