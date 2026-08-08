// 9 屏 × 2 皮 × 2 视口 = 36 张像素基线（cr-align 视觉战役棒0；files-hub-0729 加 files；
// #63 merge-closerlook 退掉 closerlook——对照卡并进 home 屏差距摘要块，随 home 两张被采）。
// 🔴 #68 订正：这 36 张**全是空态采样**。URL 里的 `?transport=stub` 在 build+preview 产物上
// 是死的（store.ts 的 import.meta.env.DEV 被 vite build 静态求值成 false——头注释此前写的
// 「固定 16 人团队」从来没存在过），实际是真 transport + fresh context = team===null：
// 九屏采的都是空态引导页（home 还叠一张依赖后端 /demo/status 的示例团队门卡——「像素基线
// 不密闭」那条 Blocker 的病根）。**任何只在数据态渲染的部件不在这 36 张射程内**——
// 数据态覆盖见同目录 visual-data.spec.mjs（#68，真上传种子后采 home/team/projects）。
// URL 里的 transport=stub 参数保留不动：它虽然死了，但摘掉它会改变 URL 指纹，
// 空态基线全部作废重冻，纯损无益。onboarding Escape 掉。
// mask 原则：出现日期/时钟类动态区再按需加 locator，先跑裸的看稳定性。
//
// ⚠ 一个 test 里串着跑 9 次 toHaveScreenshot：**第一处不匹配就中止整条**，后面的屏根本
// 不会被采样。所以一次红跑给出的漂移清单是不完整的（实测：desktop 停在 home，
// mobile 停在 team，`files` 两张压根没生成）。要拿全量清单就重冻后再跑一轮确认零红。
import { test, expect } from 'playwright/test'

const UI = process.env.VERIFY_BASE || 'http://localhost:5173'
// files-hub-0729/01 · 'files' 追加在末尾：这个数组是「哪些屏会被采样」的唯一名单，
// 漏掉一屏不会红、只会**永远不采样它**（假绿）。资料库屏是 t.upload.* 那 38 个键在
// 07-29 之后唯一的落屏点（上传面板已从团队屏撤走），漏了等于整族文案无人扫。
// #63 · 'closerlook' 出列：goScreen('closerlook') 在屏退休后会兜底回 home——留着它等于
// 把同一屏采两遍还叫错名字。旧基线 *-closerlook-*.png 随重冻删除。
const SCREENS = ['home', 'team', 'projects', 'room', 'followups', 'notes', 'playbooks', 'vision', 'files']
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
