// 小字对比度门（UIUX 棒 2026-07-20 晚 · F6/F7/F8）。
//
// ## 缺陷是什么
// 两张皮把 sage/honey/terracotta 和 --ink-faint 同时当「装饰色」和「小字文本色」用：
// 装饰要浅雅、小字要 WCAG AA 的 4.5:1，一个值伺候不了两头。写门当天实测（1280 视口）：
//   · paper 的 --ink-faint #918b7f 在 --paper 上 3.08:1——eyebrow / 计数 / 时间戳 / meta /
//     隐私注脚，九个屏全中；
//   · aurora 的「需确认」定级 chip（--honey #d88a2d, 11.5px）只有 2.77:1；
//   · 「已读取」文件状态（--sage）3.9–4.11:1。
// 修法：每皮加 *-text 深色调（look-paper.css / look-aurora.css），小字消费点切过去；
// --ink-faint 仅在 lite 两壳的 scope 内压深（story 冻结面喂的 shared :root 一字未动）。
//
// ## 判别器
// 真渲染、真 getComputedStyle：驱动上传 + advise 出卡后，对每屏**所有叶子文本元素**算
// 前景/有效背景对比度（背景=向上找第一个不透明祖先背景色，与人眼所见一致）；
// 小字（<18.66px 且非 14px+粗体）低于 4.5、大字低于 3.0 记 FAIL。
// 不是只盯几个点名选择器——点名会漏掉下一个用错 token 的新组件；全量扫描才是结构性判据。
// 两种世界答案不同：修前 paper 团队屏 8+ 处低于线（形状见上），修后为 0。
//
// ## 怎么跑（与 verify-room-usability.mjs 同一套前置）
//   VERIFY_BASE=http://127.0.0.1:5173 node eval-harness/tools/verify-contrast-smalltext.mjs
import { chromium } from 'playwright'

const UI = process.env.VERIFY_BASE || 'http://127.0.0.1:5173'
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

// 页内对比度审计。返回低于阈值的条目列表（类名+比值+样本文字）。
const AUDIT_FN = `(() => {
  function parseColor(c) { const m = c.match(/rgba?\\(([\\d.]+), ?([\\d.]+), ?([\\d.]+)(?:, ?([\\d.]+))?\\)/); return m ? [+m[1],+m[2],+m[3], m[4]===undefined?1:+m[4]] : null }
  function lum(rgb) { const f = v => { v/=255; return v<=0.03928? v/12.92 : Math.pow((v+0.055)/1.055,2.4) }; return 0.2126*f(rgb[0])+0.7152*f(rgb[1])+0.0722*f(rgb[2]) }
  function ratio(a,b){ const l1=lum(a), l2=lum(b); return (Math.max(l1,l2)+0.05)/(Math.min(l1,l2)+0.05) }
  function bgOf(el){ let cur = el; while(cur && cur !== document.documentElement){ const c = parseColor(getComputedStyle(cur).backgroundColor); if (c && c[3] > 0.5) return c; cur = cur.parentElement }
    const shell = document.querySelector('.lite2-shell, .lite-shell')
    const base = shell ? parseColor(getComputedStyle(shell).getPropertyValue('background-color')) : null
    return base && base[3] > 0.5 ? base : [247,244,238,1] }
  const seen = new Set(); const bad = []
  document.querySelectorAll('main *').forEach(el => {
    if (!el.innerText || el.children.length > 0) return
    const txt = el.innerText.trim(); if (!txt || txt.length < 2) return
    const cs = getComputedStyle(el)
    if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) return
    const fg = parseColor(cs.color); if (!fg) return
    const r = ratio(fg, bgOf(el))
    const size = parseFloat(cs.fontSize); const bold = parseInt(cs.fontWeight) >= 700
    const threshold = (size >= 18.66 || (size >= 14 && bold)) ? 3 : 4.5
    if (r < threshold - 0.03) {  // 0.03 容差：吸收 rgb 取整噪声，别让 4.49 之类的伪差错红门
      const key = String(el.className).slice(0,40) + '|' + cs.color
      if (!seen.has(key)) { seen.add(key); bad.push(String(el.className).slice(0,40) + ' ' + Math.round(r*100)/100 + '/' + threshold + ' (' + txt.slice(0,14) + ')') }
    }
  })
  return bad
})()`

const browser = await chromium.launch({ headless: true })

async function driveShell({ label, url, storeSeam, screens }) {
  console.log(`\n═══ ${label} ═══`)
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const page = await ctx.newPage()
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(e.message))
  const tag = (n) => `[${label}] ${n}`

  await page.goto(url, { waitUntil: 'networkidle' })
  if (await page.locator('.lite-onboard').count()) {
    await page.keyboard.press('Escape')
    await page.waitForTimeout(600)
  }
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
  // room 也要有内容可扫：出一张 8 字段卡
  await page.evaluate((seam) => {
    const st = window[seam].getState()
    st.goScreen('room')
    st.askLive({ situation: '这周谁的项目最需要我搭把手？' })
  }, storeSeam)
  await page.waitForFunction(
    (seam) => ['complete', 'error'].includes(window[seam].getState().run.status),
    storeSeam, { timeout: 30000 },
  ).catch(() => {})

  for (const sc of screens) {
    await page.evaluate(({ seam, sc }) => window[seam].getState().goScreen(sc), { seam: storeSeam, sc })
    await page.waitForTimeout(350)
    const bad = await page.evaluate(AUDIT_FN)
    rec(tag(`${sc} 屏全部文本 ≥ AA（小字 4.5 / 大字 3.0）`), bad.length === 0,
      bad.length ? `${bad.length} 处低于线: ${bad.slice(0, 6).join(' · ')}` : '0 处')
  }

  rec(tag('无 pageerror'), pageErrors.length === 0, pageErrors.slice(0, 2).join(' | ') || '0 条')
  await ctx.close()
}

const V2_SCREENS = ['team', 'home', 'projects', 'room', 'followups', 'notes', 'closerlook', 'playbooks', 'vision']
await driveShell({ label: 'v02·paper', url: `${UI}/?v=2&mode=live&look=paper&lang=zh`, storeSeam: '__lite2Store', screens: V2_SCREENS })
await driveShell({ label: 'v02·aurora', url: `${UI}/?v=2&mode=live&look=aurora&lang=zh`, storeSeam: '__lite2Store', screens: V2_SCREENS })
await driveShell({ label: 'v01', url: `${UI}/?v=1&mode=live&lang=zh`, storeSeam: '__liteStore', screens: ['team', 'room', 'notes', 'playbooks', 'vision'] })

await browser.close()

const pass = R.filter((r) => r.ok).length
const fail = R.length - pass
console.log(`\n═══ 小字对比度：${pass} PASS · ${fail} FAIL ═══`)
process.exit(fail ? 1 : 0)
