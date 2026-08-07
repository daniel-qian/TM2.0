// 屏底家具劫持探针：照 verify-bottom-furniture-clearance 的判据（elementFromPoint 实打，
// 首末两个滚动位各审一次，两个视口），只针对资料库屏 + 常驻表单段。
// 用途：判定 .lite-files-scroll 到底需不需要进让位带——需要就付基线的代价，不需要就别付。
import { chromium } from 'playwright'

const UI = process.env.VERIFY_BASE || 'http://127.0.0.1:5199'
const ROSTER = [
  '# 望江酒店 · 员工花名册',
  '',
  '姓名 | 职位 | 部门 | 司龄 | 负责',
  '周雅 | 传菜领班 | 前厅部 | 3 年 | 宴会厅传菜动线与现场服务',
  '陈明远 | 中餐厨师长 | 厨房 | 7 年 | 各菜系出品与宴会菜单研发',
  '林小满 | 前厅部经理 | 前厅部 | 5 年 | 前台礼宾总机与行政楼层统筹',
  '',
].join('\n')

// 判据逐条照抄 eval-harness/tools/verify-bottom-furniture-clearance.mjs 的 AUDIT（l.68-115）：
// 🔴 clippedAway 是必须的——第一版探针漏了它，于是把一个**已经被滚动容器裁掉、根本没画出来**
// 的「选择文件」按钮报成被劫持（rect 返回布局几何，不管裁剪；memory 里那条「rect 不管裁剪」
// 说的就是这个）。真门 2026-08-03 修 #34/#36 时踩过同一个坑，注释还在。
// 只把「屏底锚定的 fixed/sticky 家具」判红：顶栏压住滚动内容归另一道门。
const PROBE = `(() => {
  const out = []
  function anchoredFurniture(node) {
    for (let e = node; e && e !== document.body && e !== document.documentElement; e = e.parentElement) {
      const cs = getComputedStyle(e)
      if (cs.position === 'fixed' || cs.position === 'sticky') {
        return { cls: String(e.className).slice(0, 40), bottomAnchored: e.getBoundingClientRect().top > innerHeight * 0.5 }
      }
    }
    return null
  }
  function clippedAway(el, cx, cy) {
    for (let e = el.parentElement; e && e !== document.body && e !== document.documentElement; e = e.parentElement) {
      const cs = getComputedStyle(e)
      if (cs.overflowY === 'visible' && cs.overflowX === 'visible') continue
      const r = e.getBoundingClientRect()
      if (cx < r.left || cx > r.right || cy < r.top || cy > r.bottom) return true
    }
    return false
  }
  for (const el of document.querySelectorAll('.lite2-shell button, .lite2-shell a[href], .lite2-shell input')) {
    const cs = getComputedStyle(el)
    if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) continue
    if (el.disabled) continue
    const r = el.getBoundingClientRect()
    if (r.width < 8 || r.height < 8) continue
    if (r.top < 0 || r.left < 0 || r.bottom > innerHeight || r.right > innerWidth) continue
    const cx = Math.round(r.left + r.width / 2)
    const cy = Math.round(r.top + r.height / 2)
    if (clippedAway(el, cx, cy)) continue
    const hit = document.elementFromPoint(cx, cy)
    if (!hit) continue
    if (hit === el || el.contains(hit) || hit.contains(el)) continue
    const furn = anchoredFurniture(hit)
    if (!furn || !furn.bottomAnchored) continue
    out.push({
      me: (el.innerText || '').trim().slice(0, 16) || String(el.className).slice(0, 24),
      at: [cx, cy],
      hit: furn.cls,
    })
  }
  return out
})()`

const browser = await chromium.launch()
let bad = 0
for (const vp of [{ width: 375, height: 812, n: 'mobile' }, { width: 1280, height: 620, n: 'desktop-short' }]) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, locale: 'zh-CN' })
  const page = await ctx.newPage()
  await page.goto(`${UI}/?v=2&mode=live&lang=zh&look=paper`, { waitUntil: 'networkidle' })
  if (await page.locator('.lite-onboard, .lite-gate-layer').count()) {
    await page.keyboard.press('Escape')
    await page.waitForTimeout(600)
  }
  await page.evaluate(async (doc) => {
    const f = new File([new TextEncoder().encode(doc)], '花名册.md', { type: 'text/markdown' })
    await window.__lite2Store.getState().uploadFiles([f])
  }, ROSTER)
  await page.waitForTimeout(2500)
  await page.evaluate(() => window.__lite2Store.getState().goScreen('files'))
  await page.waitForTimeout(2500)
  // 把常驻表单段撑到最长：选人 + 铸链，让复制/生成键真的落到屏底那条带上。
  const chips = page.locator('.lite-files-forms-chip')
  if (await chips.count()) {
    await chips.nth(0).click()
    await chips.nth(1).click()
    await page.locator('.lite-files-forms-mint').click()
    await page.waitForTimeout(2500)
  }
  const capsule = await page.locator('.lite-ask-avery').count()
  for (const pos of ['top', 'bottom']) {
    await page.evaluate((p) => {
      const el = document.querySelector('.lite-files-scroll')
      if (el) el.scrollTop = p === 'top' ? 0 : el.scrollHeight
    }, pos)
    await page.waitForTimeout(500)
    const hits = await page.evaluate(PROBE)
    bad += hits.length
    console.log(`  ${vp.n} @${pos}  胶囊在场=${capsule}  被劫持 ${hits.length} 个 ${hits.length ? JSON.stringify(hits) : ''}`)
  }
  await ctx.close()
}
await browser.close()
console.log(bad === 0 ? '结论：零劫持' : `结论：${bad} 处被劫持`)
process.exit(bad === 0 ? 0 : 1)
