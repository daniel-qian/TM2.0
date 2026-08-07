// 探针：绑项目那块为什么没出来——是没选上人，还是这家公司没有项目卡？
import { chromium } from 'playwright'
const UI = process.env.VERIFY_BASE || 'http://localhost:5210'
const ROSTER = [
  '# 望江酒店 · 员工花名册', '',
  '姓名 | 人员ID | 职位 | 部门 | 司龄 | 负责',
  '周雅 | SY-0308 | 传菜领班 | 前厅部 | 3 年 | 宴会厅传菜动线与现场服务',
  '陈明远 | SY-0117 | 中餐厨师长 | 厨房 | 7 年 | 各菜系出品与宴会菜单研发', '',
  '## 项目：宴会厅翻台提速', '负责人：周雅', '状态：正常', '',
].join('\n')
const b = await chromium.launch()
const page = await (await b.newContext({ viewport: { width: 1280, height: 900 }, locale: 'zh-CN' })).newPage()
await page.goto(`${UI}/?v=2&mode=live&lang=zh&look=paper`, { waitUntil: 'networkidle' })
if (await page.locator('.lite-onboard, .lite-gate-layer').count()) { await page.keyboard.press('Escape'); await page.waitForTimeout(600) }
await page.evaluate(async (doc) => {
  const f = new File([new TextEncoder().encode(doc)], '花名册.md', { type: 'text/markdown' })
  await window.__lite2Store.getState().uploadFiles([f])
}, ROSTER)
await page.waitForTimeout(3000)
console.log('projects:', JSON.stringify(await page.evaluate(() =>
  (window.__lite2Store.getState().team?.projects || []).map((p) => ({ id: p.id, title: p.title })))))
await page.evaluate(() => window.__lite2Store.getState().goScreen('files'))
await page.waitForTimeout(2500)
console.log('chips:', await page.locator('.lite-files-forms-chip').count())
await page.locator('.lite-files-forms-chip', { hasText: '周雅' }).click()
await page.waitForTimeout(500)
console.log('after click — mint disabled?', await page.locator('.lite-files-forms-mint').isDisabled())
console.log('bind block:', await page.locator('.lite-files-forms-bind').count())
console.log('bind html:', (await page.locator('.lite-files-forms-mint-block').innerHTML()).slice(0, 400))
await b.close()
