// 9 屏 × 2 皮 × 2 视口 = 36 张像素基线（cr-align 视觉战役棒0）。
// 数据走 ?transport=stub（固定 16 人团队，零后端零随机）；onboarding Escape 掉。
// mask 原则：出现日期/时钟类动态区再按需加 locator，先跑裸的看稳定性。
import { test, expect } from 'playwright/test'

const UI = process.env.VERIFY_BASE || 'http://localhost:5173'
const SCREENS = ['home', 'team', 'projects', 'room', 'followups', 'notes', 'closerlook', 'playbooks', 'vision']
const LOOKS = ['aurora', 'paper']

for (const look of LOOKS) {
  test(`${look} 九屏基线`, async ({ page }, testInfo) => {
    await page.goto(`${UI}/?v=2&mode=live&look=${look}&lang=zh&transport=stub`, { waitUntil: 'networkidle' })
    if (await page.locator('.lite-onboard').count()) {
      await page.keyboard.press('Escape')
      await page.waitForTimeout(600)
    }
    await page.evaluate(() => document.fonts.ready)
    for (const sc of SCREENS) {
      await page.evaluate((s) => window.__lite2Store.getState().goScreen(s), sc)
      await page.waitForTimeout(500)
      await expect(page).toHaveScreenshot(`${look}-${sc}-${testInfo.project.name}.png`, {
        animations: 'disabled',
        caret: 'hide',
        scale: 'css',
        maxDiffPixels: 50,
      })
    }
  })
}
