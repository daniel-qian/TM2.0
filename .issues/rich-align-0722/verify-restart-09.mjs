// rich-align-0722/09 · 「重新开始」闭环 e2e 探针（演示 10 秒复位下一场）。
//
// 覆盖 issue-09 Acceptance 的 e2e 闭环行：
//   无痕开页 → onboard 闸门 → 一键三亚（真 claim）→ 满态断言（16 人 / 6 项目在）→
//   齿轮菜单第三行「重新开始」（两击确认）→ lite2:* 键全空 + owner_token 忘光 +
//   闸门重弹（step doors）+ 首页骨架在 → 全程零 console error。
//   顺带：restart 前把观感切到 paper（lite2:look:v1 落值）→ restart 后该键清空（全清含偏好·拍板①）。
//
// 🔴 离线：吃 mock 三件套后端（AVERY_BRAIN=mock）+ AVERY_DEMO_SEED_DIR=三亚 seed。绝不碰 minimax。
//   VERIFY_BASE=http://localhost:5173 node .issues/rich-align-0722/verify-restart-09.mjs
import { chromium } from 'playwright'

const UI = process.env.VERIFY_BASE || 'http://localhost:5173'
const R = []
const rec = (n, ok, d) => { R.push({ n, ok }); console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${n}${d ? ' — ' + d : ''}`) }

const LITE2_KEYS = [
  'lite2:contextId:v1', 'lite2:ownerTokens:v1', 'lite2:onboard:v1', 'lite2:flow:v1',
  'lite2:notify:v1', 'lite2:lang:v1', 'lite2:look:v1',
]
const readKeys = (page) => page.evaluate((keys) => {
  const out = {}
  for (const k of keys) out[k] = localStorage.getItem(k)
  return out
}, LITE2_KEYS)

const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await ctx.newPage()
const consoleErrors = []
page.on('pageerror', (e) => consoleErrors.push(String(e)))
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()) })

// ① 无痕开页 → onboard 闸门在。
await page.goto(`${UI}/?v=2&mode=live&lang=zh`, { waitUntil: 'networkidle' })
rec('① 无痕开页 → onboard 闸门在', (await page.locator('.lite-onboard').count()) > 0)

// ② 一键三亚（demo 门）→ 满态 16 人 / 6 项目。
await page.click('.lite-gate-door-demo')
await page.waitForFunction(() => window.__lite2Store.getState().contextId !== null, undefined, { timeout: 30000 })
await page.waitForTimeout(400)
const claimed = await page.evaluate(() => {
  const st = window.__lite2Store.getState()
  return { ctxId: st.contextId, people: st.team?.people?.length ?? 0, projects: st.team?.projects?.length ?? 0, gate: document.querySelectorAll('.lite-onboard').length }
})
rec('② 一键三亚 → contextId 非空', !!claimed.ctxId)
rec('② 满态：16 人在', claimed.people === 16, `people=${claimed.people}`)
rec('② 满态：6 项目在', claimed.projects === 6, `projects=${claimed.projects}`)
rec('② 满态：闸门关', claimed.gate === 0)

// ③ 切观感到 paper（落 lite2:look:v1）→ 验证 restart 连偏好一起清。
await page.click('.lite-settings-toggle')
await page.waitForTimeout(150)
await page.evaluate(() => {
  const btns = [...document.querySelectorAll('.look-switch-btn')]
  // 🔴 #79 同步：皮肤标签改成了「浅色/深色」（en: Light/Dark）。旧正则找不到按钮时
  // find 返回 undefined、if 守卫让点击整个跳过，于是下面那条 look=paper 判据以
  // 「偏好没落盘」的形态假红——不是崩、不是跳过，是最难诊断的那一类。
  const paper = btns.find((b) => /浅色|Light/i.test(b.textContent || ''))
  if (paper) paper.click()
})
await page.waitForTimeout(150)
const beforeKeys = await readKeys(page)
rec('③ restart 前：contextId 键在', !!beforeKeys['lite2:contextId:v1'])
rec('③ restart 前：ownerTokens 键在', !!beforeKeys['lite2:ownerTokens:v1'])
rec('③ restart 前：look 偏好落了 paper', beforeKeys['lite2:look:v1'] === 'paper', `look=${beforeKeys['lite2:look:v1']}`)

// ④ 齿轮第三行「重新开始」两击确认（用 page.click + 等 React 重渲染再读 data-confirm）。
await page.click('.lite-settings-restart') // 首击 → 确认态
await page.waitForTimeout(200)
const confirmShown = await page.evaluate(() => {
  const btn = document.querySelector('.lite-settings-restart')
  return { found: !!btn, confirm: btn?.getAttribute('data-confirm') === '1', text: btn?.textContent.trim() || '' }
})
rec('④ 首击 → 确认态（误触保护）', confirmShown.found && confirmShown.confirm, `text="${confirmShown.text}"`)
await page.click('.lite-settings-restart') // 再击 → 执行
await page.waitForTimeout(600)

// ⑤ restart 后：键全空 + contextId null + owner_token 忘光 + 闸门重弹 + 骨架在。
const after = await page.evaluate(() => {
  const st = window.__lite2Store.getState()
  return {
    ctxId: st.contextId,
    gate: document.querySelectorAll('.lite-onboard').length,
    step: document.querySelector('.lite-onboard')?.getAttribute('data-onboard-step')
      || document.querySelector('[data-onboard-step]')?.getAttribute('data-onboard-step') || null,
    skeleton: document.querySelectorAll('[data-home-skeleton]').length,
  }
})
const afterKeys = await readKeys(page)
const leaked = Object.entries(afterKeys).filter(([, v]) => v !== null).map(([k]) => k)
rec('⑤ lite2:* 键全空（含 look 偏好）', leaked.length === 0, `残留=${JSON.stringify(leaked)}`)
rec('⑤ store contextId = null（owner 上下文忘光）', after.ctxId === null, `ctxId=${after.ctxId}`)
rec('⑤ 闸门重弹', after.gate > 0, `onboard=${after.gate}`)
rec('⑤ 闸门回 doors 步', after.step === 'doors', `step=${after.step}`)
rec('⑤ 首页骨架在闸门下', after.skeleton >= 1, `skeleton=${after.skeleton}`)
rec('⑥ 全程零 console error / pageerror', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '))

await browser.close()
const fail = R.filter((r) => !r.ok)
console.log(`\nrestart-09: ${R.length - fail.length}/${R.length} pass`)
if (fail.length) {
  console.log('FAILED:', fail.map((f) => f.n).join(' · '))
  process.exit(1)
}
