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
// 迁自票 #16：boot/上报/收尾管线搬进 lib/gate-run.mjs，断言判据一字未改。
import { bootPage, makeRec, finish } from './lib/gate-run.mjs'

const UI = process.env.VERIFY_BASE || 'http://127.0.0.1:5173'
const gateRec = makeRec()
const rec = gateRec.rec

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

let browser

async function driveShell({ label, url, storeSeam, screens }) {
  console.log(`\n═══ ${label} ═══`)
  // 分歧⑤(c)：每个"世界"开一个新 context，各自跑完 ctx.close()；browser 首次由 bootPage
  // 新起、之后每次传回去复用（与 verify-status-truth 同一模型）。
  const boot = await bootPage({ browser, url, trackPageErrors: true })
  browser = boot.browser
  const { context: ctx, page, pageErrors } = boot
  const tag = (n) => `[${label}] ${n}`
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

// ── 错误态世界（2026-08-03 新增）───────────────────────────────────────────────
// 为什么要单独开一个世界：上面 driveShell 走的是「后端在场」的顺路，上传**永远成功**，
// 于是 `.upload-error-label` 这一族从来没被采过样。这不是判据写错了，是判据**够不着**——
// 一整个状态族躲在采样面之外，门再绿也证明不了它。
// 2026-08-03 把 8137 停掉时偶然逼出这条路径，实测 paper 4.33 / aurora 3.85，**两皮都破 AA**
// （已修：lite2.css / lite.css 把它切到 --terracotta-text，见同日注释）。
// 这里用 route 拦截把「上传失败」变成可复现的常规判据，不依赖"把后端停掉"这种人工前置。
// 🔴 先断言标签真的在场再量对比度：一个采不到样的采样器是恒绿的，那种绿最骗人。
async function driveErrorState({ label, url, storeSeam, screens }) {
  console.log(`\n═══ ${label} ═══`)
  const boot = await bootPage({ browser, url, trackPageErrors: true })
  browser = boot.browser
  const { context: ctx, page, pageErrors } = boot
  const tag = (n) => `[${label}] ${n}`

  // 让 ingest 必失败——比停后端可复现，且不影响同批其它门。
  await page.route('**/ingest', (route) => route.abort('failed'))

  await page.evaluate(
    async ({ doc, seam }) => {
      const enc = new TextEncoder()
      const f = new File([enc.encode(doc)], 'w33-weekly.md', { type: 'text/markdown' })
      await window[seam].getState().uploadFiles([f]).catch(() => {})
    },
    { doc: SEED_DOC, seam: storeSeam },
  )
  await page.waitForFunction(
    (seam) => window[seam].getState().ingestStatus === 'error',
    storeSeam, { timeout: 30000 },
  )

  for (const sc of screens) {
    await page.evaluate(({ seam, sc }) => window[seam].getState().goScreen(sc), { seam: storeSeam, sc })
    await page.waitForTimeout(350)
    // 采样面自证：这一屏上错误态标签必须真的渲染出来了，否则下面那条对比度判据是空跑。
    const labelCount = await page.evaluate(() => document.querySelectorAll('.upload-error-label').length)
    rec(tag(`${sc} 屏错误态标签在场（采样面自证，防空跑）`), labelCount > 0, `.upload-error-label × ${labelCount}`)
    const bad = await page.evaluate(AUDIT_FN)
    rec(tag(`${sc} 屏错误态全部文本 ≥ AA（小字 4.5 / 大字 3.0）`), bad.length === 0,
      bad.length ? `${bad.length} 处低于线: ${bad.slice(0, 6).join(' · ')}` : '0 处')
  }

  rec(tag('无 pageerror'), pageErrors.length === 0, pageErrors.slice(0, 2).join(' | ') || '0 条')
  await ctx.close()
}

// files-hub-0729/01 · 'files' 追加在末尾：这个数组是「哪些屏会被采样」的唯一名单，
// 漏掉一屏不会红、只会**永远不采样它**（假绿）。资料库屏是 t.upload.* 那 38 个键在
// 07-29 之后唯一的落屏点（上传面板已从团队屏撤走），漏了等于整族文案无人扫。
const V2_SCREENS = ['team', 'home', 'projects', 'room', 'followups', 'notes', 'closerlook', 'playbooks', 'vision', 'files']
await driveShell({ label: 'v02·paper', url: `${UI}/?v=2&mode=live&look=paper&lang=zh`, storeSeam: '__lite2Store', screens: V2_SCREENS })
await driveShell({ label: 'v02·aurora', url: `${UI}/?v=2&mode=live&look=aurora&lang=zh`, storeSeam: '__lite2Store', screens: V2_SCREENS })
await driveShell({ label: 'v01', url: `${UI}/?v=1&mode=live&lang=zh`, storeSeam: '__liteStore', screens: ['team', 'room', 'notes', 'playbooks', 'vision'] })

// 错误态只在「上传面板所在的屏」有意义：v02 是 home / files（07-29 之后上传面板已从团队屏
// 撤走，见上面 V2_SCREENS 的注释），v01 仍在 team 屏。屏名写错不会红、只会永远采不到——
// 所以上面每屏都配了「标签在场」的自证判据。
await driveErrorState({ label: 'v02·paper·错误态', url: `${UI}/?v=2&mode=live&look=paper&lang=zh`, storeSeam: '__lite2Store', screens: ['home', 'files'] })
await driveErrorState({ label: 'v02·aurora·错误态', url: `${UI}/?v=2&mode=live&look=aurora&lang=zh`, storeSeam: '__lite2Store', screens: ['home', 'files'] })
await driveErrorState({ label: 'v01·错误态', url: `${UI}/?v=1&mode=live&lang=zh`, storeSeam: '__liteStore', screens: ['team'] })

await finish(gateRec, { browser, label: '小字对比度' })
