#!/usr/bin/env node
// fixB 收口 · UploadPanel 新增元素的**版式**验证（在真浏览器里量，不是看代码想象）
//
// 为什么单开一个脚本：上一轮我给 UploadPanel 加了三个元素（两行 accepted 说明 + 状态 hint），
// 三道门（typecheck / build / lint）全绿，浏览器行为脚本也全绿 —— 因为它们只问"元素在不在、
// 文案对不对"。没有一道门问过"它们长成什么样、把别的东西挤成了什么样"。真实测量的结果是：
//
//   .upload-accepted        fs=11px  color=rgb(145,139,127)  mb=0     ← 样式层认识它
//   .upload-accepted-exts   fs=16px  color=rgb(29,27,23)     mb=16px  ← 新加的，样式层不认识
//   .upload-accepted-legacy fs=16px  color=rgb(29,27,23)     mb=16px  ← 同上
//
// 两行补充说明比它们要补充的那一行更大更黑，把 158px 的上传卡撑到 214px。文件行更糟 ——
// .upload-file-row 是 display:flex + justify-content:space-between，塞进 498px 宽的 hint 后：
//
//   1280 宽 zh：失败行的 .upload-file-name  81×15 → 34×30（「坏文件.csv」折成两行）
//    390 宽 en：失败行的 .upload-file-name  → 12×75（**一列一个字**），整行高 310px
//
// 恰恰是最需要看清"哪份文件没读进去"的那一行被挤坏。所以这个脚本量的是**尺寸**，
// 断言的是版式不变式，不是"元素存在"。
//
// 跑法（端口刻意避开集成方在用的 5173/8137）：
//   1) cd eval-harness && AVERY_BRAIN=stub AVERY_CORS_ORIGINS=http://127.0.0.1:5302 \
//        python -m uvicorn service.app:app --port 8302
//   2) VITE_AVERY_API_BASE=http://127.0.0.1:8302 npx vite --port 5302 --strictPort
//   3) node .issues/v02-partner-align-0718/verify-fixB-upload-layout.mjs
//
// 退出码 0 = 全过；非 0 = 有 FAIL。

import { chromium } from 'playwright'

const BASE = process.env.VERIFY_BASE || 'http://127.0.0.1:5302'
const results = []

function check(name, pass, detail) {
  results.push({ name, pass })
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name}${detail ? ' — ' + detail : ''}`)
}

// 见 verify-fixB-upload-ui.mjs：写成字节数组而不是字符串，因为这条 test 的全部意义就在于
// 这些字节**不是** UTF-8（中文 Windows 的 Excel / 记事本存出来的就是这些）。
const GBK_ROSTER = Uint8Array.from([
  208, 213, 195, 251, 44, 214, 176, 206, 187, 44, 205, 197, 182, 211, 10, 213, 197, 206, 176, 44,
  178, 250, 198, 183, 190, 173, 192, 237, 44, 178, 250, 198, 183, 215, 233, 10, 192, 238, 196, 200,
  44, 186, 243, 182, 203, 185, 164, 179, 204, 202, 166, 44, 198, 189, 204, 168, 215, 233, 10, 205,
  245, 183, 188, 44, 201, 232, 188, 198, 202, 166, 44, 178, 250, 198, 183, 215, 233, 10,
])
const UNDECODABLE = Uint8Array.from(
  Array.from({ length: 4 }, () => [0x80, 0x81, 0x8d, 0x90, 0x9d, 0xff, 0xfe, 0x81]).flat(),
)

async function metrics(page, selector) {
  const el = page.locator(selector).first()
  if ((await el.count()) === 0) return null
  return await el.evaluate((n) => {
    const r = n.getBoundingClientRect()
    const cs = getComputedStyle(n)
    return {
      w: Math.round(r.width), h: Math.round(r.height),
      fontSize: parseFloat(cs.fontSize), color: cs.color,
      marginBottom: parseFloat(cs.marginBottom),
    }
  })
}

async function runOne(browser, { look, lang, width, height }) {
  const label = `${look}/${lang}/${width}px`
  const ctx = await browser.newContext({ viewport: { width, height } })
  const page = await ctx.newPage()
  await page.goto(`${BASE}/?v=2&mode=live&look=${look}&lang=${lang}`, { waitUntil: 'networkidle' })
  if ((await page.locator('.lite-onboard').count()) > 0) {
    await page.keyboard.press('Escape')
    await page.waitForTimeout(600)
  }

  // ── ① accepted 的两行补充说明必须和它们补充的那一行同一个视觉层级 ──────────────────
  const base = await metrics(page, '.upload-accepted')
  for (const cls of ['.upload-accepted-exts', '.upload-accepted-legacy']) {
    const m = await metrics(page, cls)
    check(
      `${label} · ${cls} 与 .upload-accepted 同字号同色`,
      !!m && !!base && m.fontSize === base.fontSize && m.color === base.color,
      m && base ? `${m.fontSize}px ${m.color} vs 基准 ${base.fontSize}px ${base.color}` : '元素缺失',
    )
    // 浏览器默认 <p> 的 1em 下边距没被复位时是 16px —— 那正是旧版把卡撑高 56px 的原因。
    check(`${label} · ${cls} 没有未复位的默认边距`, !!m && m.marginBottom <= 4,
      m ? `margin-bottom=${m.marginBottom}px` : '元素缺失')
  }

  // ── ② 传一份能读的 + 一份读不出来的，看失败那行的**文件名**有没有被挤坏 ─────────────
  await page.locator('.upload-panel input[type=file]').first().setInputFiles([
    { name: '员工花名册.csv', mimeType: 'text/csv', buffer: Buffer.from(GBK_ROSTER) },
    { name: '坏文件.csv', mimeType: 'text/csv', buffer: Buffer.from(UNDECODABLE) },
  ])
  await page.waitForSelector('.upload-files-list li', { timeout: 180000 })
  await page.waitForTimeout(400)

  const rows = await page.locator('.upload-file-row').all()
  check(`${label} · 清单里两份文件都在`, rows.length === 2, `实际 ${rows.length} 行`)

  for (const row of rows) {
    const status = await row.getAttribute('data-status')
    const m = await row.evaluate((n) => {
      const pick = (s) => {
        const e = n.querySelector(s)
        if (!e) return null
        const b = e.getBoundingClientRect()
        // 🔴 数**真实渲染出的行框**，不是拿高度除 line-height 估。lite2.css 没给这些元素
        // 设 line-height，computed 值是 'normal'，parseFloat 出来是 NaN —— 第一版断言就是
        // 这么写的，于是每一条都判 false，把已经修好的版式报成 FAIL。Range 的 client rects
        // 是浏览器自己的分行结果，没有阈值可调，也就没得糊弄。
        const range = document.createRange()
        range.selectNodeContents(e)
        return { w: Math.round(b.width), h: Math.round(b.height), lines: range.getClientRects().length }
      }
      return { name: pick('.upload-file-name'), status: pick('.upload-file-status'), hint: pick('.upload-file-status-hint') }
    })
    // 🔴 核心不变式：文件名是**单行**。旧版在这里是 34×30 两行（1280 zh）/ 12×75 六行
    //（390 en，一列一个字）—— 用户看不清是哪份文件没读进去，而那正是这一整块存在的理由。
    check(`${label} · [${status}] 文件名单行不被挤折`, m.name?.lines === 1,
      m.name ? `${m.name.w}×${m.name.h}px, ${m.name.lines} 行` : '元素缺失')
    // 状态徽章同理：它是个短标签，折行说明它被挤了。
    check(`${label} · [${status}] 状态徽章单行`, m.status?.lines === 1,
      m.status ? `${m.status.w}×${m.status.h}px, ${m.status.lines} 行` : '元素缺失')
    if (m.hint) {
      // hint 独占一整行 → 它必须比文件名宽得多；挤在同一行时它反而会被压窄。
      check(`${label} · [${status}] hint 独占一行`, m.hint.w > (m.name?.w ?? 0),
        `hint ${m.hint.w}px vs name ${m.name?.w}px`)
    }
  }

  // ── ③ 上传面板自己不许把页面撑出横向滚动条 ──────────────────────────────────────────
  const overflow = await page.evaluate(() => {
    const offenders = []
    document.querySelectorAll('.upload-panel *').forEach((n) => {
      if (n.getBoundingClientRect().right > document.body.clientWidth + 1) {
        offenders.push(n.className + '')
      }
    })
    return offenders.slice(0, 5)
  })
  check(`${label} · 上传面板无横向溢出`, overflow.length === 0, overflow.join(', '))

  await ctx.close()
}

const browser = await chromium.launch({ headless: true })
try {
  // 两张皮 × 两种语言 × 宽窄两档。窄档是本轮新加的：1280 下只是"折成两行"，390 下
  // 同一个 bug 会把文件名压成一列一个字、整行 310px 高。
  for (const cfg of [
    { look: 'paper', lang: 'zh', width: 1280, height: 1000 },
    { look: 'aurora', lang: 'zh', width: 1280, height: 1000 },
    { look: 'paper', lang: 'en', width: 390, height: 900 },
    { look: 'aurora', lang: 'en', width: 390, height: 900 },
  ]) {
    console.log(`\n── ${cfg.look} / ${cfg.lang} / ${cfg.width}px ──`)
    await runOne(browser, cfg)
  }
} finally {
  await browser.close()
}

const failed = results.filter((r) => !r.pass)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
