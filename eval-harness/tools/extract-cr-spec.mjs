// cr-live 设计规格提取器（cr-align 视觉战役棒0 · 2026-07-21）。
//
// 对合伙人参考 app 的 dev server（默认 :3100）逐真实路由取计算值，导出
// eval-harness/reports/cr-spec-draft.json 草案。红线：🔴 绝不读根 index.html
// （901 行过期英文原型，Danny 亲口点名的坑）——每条路由先断言 200 + React 已挂载。
// 红线：只取 CSS 计算值（明文许可的「搬 token 数值」），零源码零数据搬运。
//
// 草案 → 人工筛选进 tracked 的 eval-harness/specs/cr-align-spec.json（对齐=只被
// 选中的行约束；paper 皮永不入 spec）→ verify-cr-alignment.mjs 逐行断言我方 aurora。
//
//   CR_BASE=http://localhost:3100 node eval-harness/tools/extract-cr-spec.mjs
import { chromium } from 'playwright'
import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const CR = process.env.CR_BASE || 'http://localhost:3100'
const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = join(HERE, '..', 'reports', 'cr-spec-draft.json')

const ROUTES = ['/', '/projects', '/people', '/gaps', '/nexus', '/checklist', '/playbooks']

const PROBE = `(() => {
  const out = { vars: {}, probes: {} }
  // 1) :root 自定义属性：递归走 stylesheet 规则（Tailwind v4 的 @theme 变量裹在
  //    @layer theme 块里；getComputedStyle 不枚举自定义属性，必须走规则树）
  const walkRules = (rules) => {
    for (const rule of rules) {
      if (rule.cssRules && rule.cssRules.length) walkRules(rule.cssRules)
      if (!rule.selectorText || !/:root|:host|^html/.test(rule.selectorText)) continue
      if (!rule.style) continue
      for (const prop of rule.style) {
        if (prop.startsWith('--')) out.vars[prop] = rule.style.getPropertyValue(prop).trim()
      }
    }
  }
  for (const sheet of document.styleSheets) {
    let rules; try { rules = sheet.cssRules } catch { continue }
    walkRules(rules)
  }
  // 2) 关键部件计算值
  const cs = (el) => el ? getComputedStyle(el) : null
  const pick = (el, props) => { const c = cs(el); if (!c) return null
    const o = {}; for (const p of props) o[p] = c[p]; return o }
  const header = document.querySelector('header')
  out.probes.topbar = pick(header, ['position','top','height','width','borderRadius','background','backgroundColor','backdropFilter','boxShadow','padding','zIndex','transform'])
  const main = document.querySelector('main')
  out.probes.main = pick(main, ['paddingTop','paddingBottom','width','maxWidth'])
  out.probes.bodyBg = pick(document.body, ['backgroundImage','backgroundColor','backgroundAttachment','fontSize','lineHeight','fontFamily'])
  const h1 = document.querySelector('main h1')
  out.probes.h1 = pick(h1, ['fontSize','fontWeight','color','letterSpacing'])
  if (h1) { const sub = h1.parentElement.querySelector('p'); out.probes.h1sub = pick(sub, ['fontSize','color','marginTop']) }
  out.probes.sectionLabel = pick(document.querySelector('.section-label'), ['fontSize','fontWeight','textTransform','letterSpacing','color','gap'])
  out.probes.cardBase = pick(document.querySelector('.card-base'), ['backgroundColor','borderTopWidth','borderTopColor','borderRadius','boxShadow','padding'])
  out.probes.glass = pick(document.querySelector('.glass'), ['backgroundColor','backdropFilter','borderTopColor','boxShadow'])
  // 导航 pill（active vs 非）
  const navLinks = header ? [...header.querySelectorAll('a')] : []
  const active = navLinks.find((a) => a.getAttribute('href') === location.pathname)
  const inactive = navLinks.find((a) => a !== active && (a.getAttribute('href') || '').length > 1)
  out.probes.navActive = pick(active, ['backgroundColor','color','borderRadius','fontSize','fontWeight','boxShadow','padding'])
  out.probes.navInactive = pick(inactive, ['backgroundColor','color','fontSize','fontWeight'])
  // 按钮采样：每个可见 button 记 文字+关键计算值（人工筛选认变体）
  out.probes.buttons = [...document.querySelectorAll('button')].slice(0, 24).map((b) => {
    const c = getComputedStyle(b)
    const r = b.getBoundingClientRect()
    if (r.width === 0) return null
    return { text: (b.innerText || '').slice(0, 12), backgroundColor: c.backgroundColor, color: c.color,
      borderRadius: c.borderRadius, fontSize: c.fontSize, fontWeight: c.fontWeight, padding: c.padding, borderTopColor: c.borderTopColor }
  }).filter(Boolean)
  // 徽章采样（soft 底 pill；允许带 dot 子元素）
  out.probes.badges = [...document.querySelectorAll('main span, main div')].filter((el) => {
    const c = getComputedStyle(el)
    const txt = (el.innerText || '').trim()
    return parseFloat(c.borderRadius) >= 999 && txt && txt.length < 8 && el.children.length <= 1
  }).slice(0, 12).map((el) => { const c = getComputedStyle(el)
    return { text: el.innerText.trim(), backgroundColor: c.backgroundColor, color: c.color, fontSize: c.fontSize, fontWeight: c.fontWeight, padding: c.padding } })
  // 3) 几何采集（「布局与真部件」战役棒A 新增；上面的采集项一条都没删）
  //    棒0-棒4 的 PROBE 只采色/字/圆角/阴影，一个几何量都没有——要断言栏宽比/网格列数/
  //    间距就必须先能看见它们。🔴 computed 的 gridTemplateColumns 是**解析后的 px 串**
  //    （"835.172px 538.828px"），不是作者写的 "1.55fr 1fr"：所以列比只能从子元素 rect 量，
  //    容器的 gridTemplateColumns 只适合 px 对值。两者都采，让筛选的人自己挑。
  const GEO_PROPS = ['display','gridTemplateColumns','gridTemplateRows','gap','columnGap','rowGap',
    'alignItems','width','maxWidth','padding','marginBottom']
  const rectOf = (el) => { if (!el) return null
    const r = el.getBoundingClientRect()
    return { width: +r.width.toFixed(2), height: +r.height.toFixed(2), left: +r.left.toFixed(2), top: +r.top.toFixed(2) } }
  const geo = (el) => { if (!el) return null; const g = pick(el, GEO_PROPS); if (!g) return null
    g.rect = rectOf(el); return g }
  // 元素身份：给人工筛选看的，不入 spec（spec 的 selector 一律写我方的 .lite2-shell 前缀）
  // 🔴 PROBE 是**模板字符串**：里面的 \\s 必须双写，否则 JS 把 \\s 吃成字面 s，
  //    /s+/ 会按字母 s 切类名（第一版实测把 "grid-cols-5" 打成 "grid-col.-5"）。
  const idOf = (el) => { const cls = typeof el.className === 'string' ? el.className.trim() : ''
    return (el.tagName.toLowerCase() + (cls ? '.' + cls.split(/\\s+/).join('.') : '')).slice(0, 180) }
  out.probes.geo = {
    main: geo(main),
    mainChildren: main ? [...main.children].slice(0, 12).map((el) => ({ sel: idOf(el), ...geo(el) })) : [],
  }
  // main 下所有 grid 容器 + 每个的直系子元素 rect（列比的唯一诚实来源）
  out.probes.grids = main ? [...main.querySelectorAll('*')].filter((el) => {
    const c = getComputedStyle(el)
    return (c.display === 'grid' || c.display === 'inline-grid') && el.getBoundingClientRect().width > 0
  }).slice(0, 64).map((el) => ({ sel: idOf(el), childCount: el.children.length, ...geo(el),
    children: [...el.children].slice(0, 8).map((ch) => ({ sel: idOf(ch), rect: rectOf(ch) })) })) : []
  return out
})()`

const browser = await chromium.launch({ headless: true })
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
const draft = { base: CR, extractedAt: new Date().toISOString(), routes: {} }

for (const route of ROUTES) {
  const resp = await page.goto(`${CR}${route}`, { waitUntil: 'networkidle', timeout: 60000 })
  if (!resp || resp.status() !== 200) {
    console.log(`  ✗ ${route} → ${resp ? resp.status() : 'no response'}（跳过）`)
    continue
  }
  // React 挂载判据：header nav 在场（根 index.html 原型没有 Next 的 __next 结构）
  await page.waitForSelector('header a', { timeout: 15000 })
  const data = await page.evaluate(PROBE)
  draft.routes[route] = data
  console.log(`  ✓ ${route} vars=${Object.keys(data.vars).length} buttons=${data.probes.buttons.length} badges=${data.probes.badges.length} grids=${data.probes.grids.length}`)
}

await browser.close()
mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, JSON.stringify(draft, null, 2))
console.log(`\n草案 → ${OUT}`)
