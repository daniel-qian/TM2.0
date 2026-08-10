// 一次性探针：手机态（390×844）议事室的**包含块归属**与滚动归属实测。
// 碑：`.scene.is-active` 带非 none 的 transform 会给 fixed 后代劫持包含块（#66）。
// 抽屉到底该用 fixed 还是 absolute，读码推不出来——这里真插一个探针元素量它落在哪。
import { chromium } from 'playwright'

const UI = process.env.VERIFY_BASE || 'http://127.0.0.1:5283'
const ROSTER = ['# 别墅酒店 员工花名册', '', '姓名 | 人员ID | 部门 | 职位 | 司龄',
  '周雅婷 | MKT-001 | 市场推广部 | 市场专员 | 3年'].join('\n')

const browser = await chromium.launch()
for (const vp of [{ n: 'mobile', width: 390, height: 844 }, { n: 'desktop', width: 1440, height: 900 }]) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } })
  const page = await ctx.newPage()
  await page.goto(`${UI}/?v=2&mode=live&look=paper&lang=zh`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(900)
  await page.keyboard.press('Escape').catch(() => {})
  await page.waitForTimeout(300)
  await page.evaluate(async (text) => {
    const enc = new TextEncoder()
    await window.__lite2Store.getState().uploadFiles([new File([enc.encode(text)], '花名册.md', { type: 'text/markdown' })])
  }, ROSTER)
  await page.waitForFunction(() => ['ready', 'error'].includes(window.__lite2Store.getState().ingestStatus),
    null, { timeout: 60000 }).catch(() => {})
  await page.evaluate(() => window.__lite2Store.getState().goScreen('room'))
  await page.waitForTimeout(1000)

  const out = await page.evaluate(() => {
    const room = document.querySelector('.lite-room')
    const stage = document.querySelector('.scene-stage')
    const shell = document.querySelector('.lite2-shell')
    const topbar = document.querySelector('.prototype-topbar')
    const aside = document.querySelector('[data-room-aside]')
    const scroll = document.querySelector('.lite-room-scroll')
    const footer = document.querySelector('.lite2-footer, .lite-footer, footer')
    const r = (el) => el ? (({ x, y, width, height, top, bottom }) =>
      ({ x: Math.round(x), y: Math.round(y), w: Math.round(width), h: Math.round(height),
        top: Math.round(top), bottom: Math.round(bottom) }))(el.getBoundingClientRect()) : null
    // 真插一个 fixed 探针：它落在 (0,0) 说明包含块是视口；落在 room 的框上说明被 transform 劫持了。
    const probe = document.createElement('div')
    probe.style.cssText = 'position:fixed;left:0;top:0;width:10px;height:10px;pointer-events:none'
    room.appendChild(probe)
    const probeRect = r(probe)
    probe.remove()
    const cs = (el, p) => el ? getComputedStyle(el)[p] : null
    return {
      viewport: { w: window.innerWidth, h: window.innerHeight },
      docScroll: { h: document.scrollingElement.scrollHeight, client: document.scrollingElement.clientHeight },
      shell: r(shell), stage: r(stage), room: r(room),
      roomPos: cs(room, 'position'), roomTransform: cs(room, 'transform'), roomOverflow: cs(room, 'overflow'),
      stagePos: cs(stage, 'position'),
      topbar: r(topbar), topbarPos: cs(topbar, 'position'),
      aside: r(aside), asideDisplay: cs(aside, 'display'), asideZ: cs(aside, 'zIndex'),
      scroll: r(scroll),
      footer: r(footer), footerZ: cs(footer, 'zIndex'),
      probeFixed: probeRect,
      clearTop: getComputedStyle(shell).getPropertyValue('--lite2-clear-top'),
      footerH: getComputedStyle(shell).getPropertyValue('--lite2-footer-h'),
      boxSizing: cs(room, 'boxSizing'),
      accentDeep: getComputedStyle(shell).getPropertyValue('--lite2-accent-deep-rgb'),
      accent: getComputedStyle(shell).getPropertyValue('--lite2-accent-rgb'),
      inkRgb: getComputedStyle(shell).getPropertyValue('--lite2-ink-rgb'),
      surfaceRgb: getComputedStyle(shell).getPropertyValue('--lite2-surface-rgb'),
    }
  })
  console.log(`\n═══ ${vp.n} ${vp.width}×${vp.height} ═══`)
  console.log(JSON.stringify(out, null, 1))
  await ctx.close()
}
await browser.close()
