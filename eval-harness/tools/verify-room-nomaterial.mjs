// 议事室「无材料」诚实空态门（0721 对齐棒 · 合伙人反馈 A2 / Danny 拍板快改层）。
//
// ## 缺陷是什么
// 合伙人零数据只读实测：议事室在没有任何团队材料时照样把 composer 和 4 个建议 chips
// 递给用户——提问后要么后端回落到默认英文 demo 语料**烧真 LLM**（app.py:130 的
// "legitimate demo default"），要么 brain 侧断流、被 UI 呈现成「这一趟中途断了 /
// 暂时连不上，再试一次？」——用户的结论是"产品坏了"，而真相是"没有材料"。
// 这是「界面替系统撒谎」的又一实例：把输入缺失呈现成网络故障。
//
// ## 修法与判据（两种世界不同答案）
// RoomScreen 在 contextId === null 时渲染诚实空态（data-room-nomaterial）：不给注定
// 失败的输入——composer/chips 一并收起，只说"还没有材料"+ 指路 CTA（→ 首页）。
//   世界 A（全新访客，无 contextId）：nomaterial 区在、composer 不在、chips 不在，
//     CTA 点了真的落到首页；
//   世界 B（contextId 非空）：正常空态回来——composer 在、chips 4 个、nomaterial 不在。
// B 是 A 的护栏：只会藏 composer 的假修法（无条件隐藏）会把 B 打红。
// 🔴 gate 判据只在 UI 层——store.askLive/__lite2Store 测试缝保持无条件，本门不驱动 SSE。
//
// ## 怎么跑（纯前端，不需要后端）
//   VERIFY_BASE=http://127.0.0.1:5173 node eval-harness/tools/verify-room-nomaterial.mjs
import { chromium } from 'playwright'

const UI = process.env.VERIFY_BASE || 'http://127.0.0.1:5173'
const R = []
const rec = (n, ok, d) => { R.push({ n, ok }); console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${n}${d ? ' — ' + d : ''}`) }

const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
const page = await ctx.newPage()
const pageErrors = []
page.on('pageerror', (e) => pageErrors.push(e.message))

await page.goto(`${UI}/?v=2&mode=live&lang=zh`, { waitUntil: 'networkidle' })
if (await page.locator('.lite-onboard').count()) {
  await page.keyboard.press('Escape')
  await page.waitForTimeout(600)
}

// ── 世界 A：全新访客（无 contextId）────────────────────────────────────────────────
await page.evaluate(() => window.__lite2Store.getState().goScreen('room'))
await page.waitForTimeout(400)

const stateA = await page.evaluate(() => ({
  contextId: window.__lite2Store.getState().contextId,
  nomaterial: document.querySelectorAll('[data-room-nomaterial]').length,
  composer: document.querySelectorAll('.nexus-followup-composer').length,
  chips: document.querySelectorAll('.lite-room-chip').length,
  cta: document.querySelectorAll('.lite-room-nomaterial-cta').length,
  text: document.querySelector('[data-room-nomaterial]')?.innerText ?? '(没渲染)',
}))
console.log(`  世界A 状态: ${JSON.stringify({ ...stateA, text: stateA.text.slice(0, 60) })}`)
rec('A·前置：全新访客确实没有 contextId（否则整个世界搭错了）', stateA.contextId === null)
rec('A·无材料空态渲染（data-room-nomaterial）', stateA.nomaterial === 1)
rec('A·composer 收起（不给注定失败的输入）', stateA.composer === 0)
rec('A·建议 chips 收起（点了就是烧默认语料的 LLM 或一个假故障）', stateA.chips === 0)
// 按短语查而不是单字查——「判断」里的「断」不算（首版单字 includes('断') 被自己的
// 正当文案打红过一次）。
rec('A·空态不提「断了/连不上」（这不是网络问题，别装成网络问题）',
  !stateA.text.includes('断了') && !stateA.text.includes('连不上'), `text="${stateA.text.slice(0, 60)}"`)
rec('A·指路 CTA 存在', stateA.cta === 1)

await page.locator('.lite-room-nomaterial-cta').click()
await page.waitForTimeout(400)
const afterCta = await page.evaluate(() => ({
  skeleton: document.querySelectorAll('[data-home-skeleton]').length,
  path: location.pathname,
}))
rec('A·CTA 点击真的落到首页（指挥室骨架在场）', afterCta.skeleton === 1, JSON.stringify(afterCta))

// ── 世界 B：contextId 非空（有材料的世界）——A 的护栏 ────────────────────────────────
await page.evaluate(() => {
  window.__lite2Store.setState({ contextId: 'ctx-gate-fake' })
  window.__lite2Store.getState().goScreen('room')
})
await page.waitForTimeout(400)
const stateB = await page.evaluate(() => ({
  nomaterial: document.querySelectorAll('[data-room-nomaterial]').length,
  composer: document.querySelectorAll('.nexus-followup-composer').length,
  chips: document.querySelectorAll('.lite-room-chip').length,
}))
console.log(`  世界B 状态: ${JSON.stringify(stateB)}`)
rec('B·有材料时正常空态回来：composer 在', stateB.composer === 1, JSON.stringify(stateB))
rec('B·有材料时建议 chips 回来（4 个）', stateB.chips === 4)
rec('B·有材料时 nomaterial 区不在（无条件隐藏 composer 的假修法在这里现形）', stateB.nomaterial === 0)

rec('无 pageerror', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | ') || '0 条')

await ctx.close()
await browser.close()

const pass = R.filter((r) => r.ok).length
const fail = R.length - pass
console.log(`\n═══ 议事室无材料诚实：${pass} PASS · ${fail} FAIL ═══`)
process.exit(fail ? 1 : 0)
