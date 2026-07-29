// 9 屏 × 2 皮 × 2 视口 = 36 张像素基线（cr-align 视觉战役棒0）。
// 数据走 ?transport=stub（固定 16 人团队，零后端零随机）；onboarding Escape 掉。
// mask 原则：出现日期/时钟类动态区再按需加 locator，先跑裸的看稳定性。
import { test, expect } from 'playwright/test'

const UI = process.env.VERIFY_BASE || 'http://localhost:5173'
// files-hub-0729/01 · 'files' 追加在末尾：这个数组是「哪些屏会被采样」的唯一名单，
// 漏掉一屏不会红、只会**永远不采样它**（假绿）。资料库屏是 t.upload.* 那 38 个键在
// 07-29 之后唯一的落屏点（上传面板已从团队屏撤走），漏了等于整族文案无人扫。
const SCREENS = ['home', 'team', 'projects', 'room', 'followups', 'notes', 'closerlook', 'playbooks', 'vision', 'files']
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
