// 「门全绿 ≠ 真部件被验到」的自查：A 区那几道会走到资料库屏的门，用的是它们**自己**的种子
// 语料。如果那份语料抽不出 team.people，常驻表单段就按否决④ 整段不渲染——门照样全绿，
// 但一个字节都没审到本票的新部件（memory：八种假绿之一）。
// 这里逐份复现它们的种子，只回答一个问题：那道门跑的时候，`.lite-files-forms` 在不在场。
import { chromium } from 'playwright'

const UI = process.env.VERIFY_BASE || 'http://127.0.0.1:5199'

// 逐字取自各门文件里的 SEED/语料常量。
const SEEDS = {
  'button-family': [
    '# 望江咨询 · 项目周报 W33', '', '## 项目：客户门户改版', '负责人：陈静', '状态：正常', '',
    '本周完成登录页联调，下周进入验收。', '',
  ].join('\n'),
  'demo-seed 花名册（onboard-gate / detail-provenance 那一挂用的真语料）': [
    '# 三亚屿澜湾度假酒店 — 员工花名册', '',
    '姓名 | 职位 | 部门 | 司龄 | 负责',
    '小王 | 总经理 | 总经理室 | 3 年 | 全店经营目标与重大接待专题协调',
    '小张 | 前厅部经理 | 前厅部 | 5 年 | 前台礼宾总机与行政楼层统筹',
    '小李 | 大堂副理 | 前厅部 | 4 年 | 现场值班巡查与客诉当班处理', '',
  ].join('\n'),
}

const browser = await chromium.launch()
for (const [label, doc] of Object.entries(SEEDS)) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'zh-CN' })
  const page = await ctx.newPage()
  await page.goto(`${UI}/?v=2&mode=live&lang=zh&look=paper`, { waitUntil: 'networkidle' })
  if (await page.locator('.lite-onboard, .lite-gate-layer').count()) {
    await page.keyboard.press('Escape')
    await page.waitForTimeout(600)
  }
  await page.evaluate(async (d) => {
    const f = new File([new TextEncoder().encode(d)], 'seed.md', { type: 'text/markdown' })
    await window.__lite2Store.getState().uploadFiles([f])
  }, doc)
  await page.waitForTimeout(2500)
  await page.evaluate(() => window.__lite2Store.getState().goScreen('files'))
  await page.waitForTimeout(2500)
  const s = await page.evaluate(() => {
    const st = window.__lite2Store.getState()
    return {
      people: (st.team?.people || []).length,
      templates: st.formTemplates === null ? null : st.formTemplates.length,
      section: document.querySelectorAll('.lite-files-forms').length,
      buttons: document.querySelectorAll('.lite-files-forms button').length,
    }
  })
  console.log(`  ${s.section ? '审到了' : '没审到'}  ${label}`)
  console.log(`     people=${s.people}  templates=${s.templates}  段=${s.section}  段内按钮=${s.buttons}`)
  await ctx.close()
}
await browser.close()
