// 首页「无数据指挥室骨架 + 决策→待办闭环」门（0721 对齐棒 · Danny 拍板 4A + B4）。
//
// ## 背景
// 合伙人零数据实测的核心观感缺陷：首页第一眼是「把文件拖进来」，产品被读成文件解析器。
// 拍板 4A：空态改为指挥室骨架——四块（决策/差距/关注/概览）各自诚实预告"进来之后长什么"，
// 上传降为右侧入口卡。骨架红线：**预告不是数据**——骨架块里零数字、零装加载、零假按钮。
// 拍板 B4：决策卡加「加入跟进」+ 首页今日待办块——决策→待办的闭环落进 flowStore 真状态
// （合伙人样板里这个闭环是 toast 假的，我们抄形状、接真状态）。
//
// ## 两种世界
//   世界 A（无 team）：data-home-skeleton 在；骨架块恰 4 块、块内零数字；上传面板在场
//     （降级为侧卡，不是消失）；
//   世界 B（team + decisions 注入）：骨架不在；决策卡在；点「加入跟进」→ flowStore 真的
//     多出一条 source='decision'/dueGroup='today' 的待办、按钮变 disabled 防重复；
//     今日待办块列出这条；点勾 → completeFollowup 真的完成它。
// B 的闭环断言同时是 A 的护栏：骨架若把有数据态也吞掉，B 全红。
//
// ## 怎么跑（纯前端，不需要后端——world B 直接 setState 注入 payload 形状）
//   VERIFY_BASE=http://127.0.0.1:5173 node eval-harness/tools/verify-home-skeleton.mjs
//
// 迁自票 #16：boot/上报/收尾管线搬进 lib/gate-run.mjs，断言判据一字未改。
// 本门是分歧⑤(b) 的典型——一个 browser + 一个 context/page 从头用到尾，装 pageerror 监听。
import { bootPage, makeRec, finish } from './lib/gate-run.mjs'

const UI = process.env.VERIFY_BASE || 'http://127.0.0.1:5173'
const gateRec = makeRec()
const rec = gateRec.rec

const { browser, context: ctx, page, pageErrors } = await bootPage({
  base: UI, path: '/?v=2&mode=live&lang=zh', trackPageErrors: true,
})

// ── 世界 A：无 team → 指挥室骨架 ───────────────────────────────────────────────────
const stateA = await page.evaluate(() => ({
  team: window.__lite2Store.getState().team,
  skeleton: document.querySelectorAll('[data-home-skeleton]').length,
  blocks: document.querySelectorAll('.lite-home-skeleton').length,
  blockText: document.querySelector('.lite-home-skeleton-blocks')?.innerText ?? '',
  upload: document.querySelectorAll('.upload-panel').length,
}))
console.log(`  世界A: skeleton=${stateA.skeleton} blocks=${stateA.blocks} upload=${stateA.upload}`)
rec('A·前置：确实没有 team（全新访客世界）', stateA.team === null)
rec('A·指挥室骨架渲染（data-home-skeleton）', stateA.skeleton === 1)
rec('A·骨架恰 4 块（决策/差距/关注/概览，与有数据态同名同序）', stateA.blocks === 4)
rec('A·骨架块内零数字（预告不是数据——写死统计数是参考库的毛病，一条不搬）',
  !/[0-9０-９]/.test(stateA.blockText), `text="${stateA.blockText.slice(0, 80)}"`)
rec('A·上传面板在场（降级为侧入口，不是消失）', stateA.upload === 1)

// ── 世界 B：注入 team + decisions → 闭环 ──────────────────────────────────────────
await page.evaluate(() => {
  const team = {
    people: [],
    projects: [],
    handoffs: [],
    briefing: { headline: '', subhead: '', metrics: [] },
  }
  const decision = {
    subject_type: 'project',
    subject_id: 'p-gate-1',
    subject_title: '客户门户改版',
    grade: 'high_risk',
    severity: 3,
    rule_grade: 'high_risk',
    rule_severity: 3,
    reason: '',
    reason_source: 'rule',
    escalated: false,
    escalation_reason: null,
    unknown_fields: [],
    unparsed_fields: [],
    matched_rules: [
      { rule_id: 'R-OVERDUE', grade: 'high_risk', severity: 3, params: {}, evidence: ['原文：预计 7 月 10 日交付'] },
    ],
    owner_name: '陈静',
  }
  window.__lite2Store.setState({
    contextId: 'ctx-gate-fake',
    team,
    rawTeam: { people: [], projects: [], decisions: [decision] },
  })
  window.__lite2Store.getState().goScreen('home')
})
await page.waitForTimeout(500)

const stateB = await page.evaluate(() => ({
  skeleton: document.querySelectorAll('[data-home-skeleton]').length,
  decisionCards: document.querySelectorAll('.lite-home-decision').length,
  followupBtn: document.querySelectorAll('.lite-home-decision-followup').length,
  flowLen: window.__lite2Flow ? -1 : (JSON.parse(localStorage.getItem('lite2:flow:v1') || '{}').followups || []).length,
}))
console.log(`  世界B: ${JSON.stringify(stateB)}`)
rec('B·有数据时骨架退场', stateB.skeleton === 0)
rec('B·决策卡渲染（注入的 1 条）', stateB.decisionCards === 1, JSON.stringify(stateB))
rec('B·决策卡带「加入跟进」按钮', stateB.followupBtn === 1)

await page.locator('.lite-home-decision-followup').click()
await page.waitForTimeout(300)
const afterAdd = await page.evaluate(() => {
  const flow = JSON.parse(localStorage.getItem('lite2:flow:v1') || '{}')
  const items = flow.followups || []
  return {
    count: items.length,
    source: items[0]?.source ?? null,
    dueGroup: items[0]?.dueGroup ?? null,
    title: items[0]?.title ?? null,
    btnDisabled: document.querySelector('.lite-home-decision-followup')?.disabled ?? null,
    todayItems: document.querySelectorAll('.lite-home-todo-item').length,
    todayText: document.querySelector('.lite-home-todos')?.innerText ?? '',
  }
})
console.log(`  加入跟进后: ${JSON.stringify({ ...afterAdd, todayText: afterAdd.todayText.slice(0, 60) })}`)
rec('B·点「加入跟进」→ flowStore 真的多出一条（不是 toast 假闭环）', afterAdd.count === 1)
rec("B·新待办 source='decision'（来源标签可溯源）", afterAdd.source === 'decision')
rec("B·新待办落在今天组（dueGroup='today'——决策本来就是今天的事）", afterAdd.dueGroup === 'today')
rec('B·待办标题带决策前缀（走字典模板，不是英文硬模板）',
  typeof afterAdd.title === 'string' && afterAdd.title.startsWith('决策：'), `title="${afterAdd.title}"`)
rec('B·按钮点后 disabled（防重复堆积）', afterAdd.btnDisabled === true)
rec('B·首页今日待办块列出这条', afterAdd.todayItems === 1, `todayText="${afterAdd.todayText.slice(0, 60)}"`)

await page.locator('.lite-home-todo-check').click()
await page.waitForTimeout(300)
const afterDone = await page.evaluate(() => {
  const items = (JSON.parse(localStorage.getItem('lite2:flow:v1') || '{}').followups || [])
  return {
    done: items[0]?.done ?? null,
    todayItems: document.querySelectorAll('.lite-home-todo-item').length,
  }
})
rec('B·首页打勾 → completeFollowup 真的完成（flowStore done=true）', afterDone.done === true, JSON.stringify(afterDone))
rec('B·完成后今日列表移除该条', afterDone.todayItems === 0)

rec('无 pageerror', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | ') || '0 条')

await ctx.close()

await finish(gateRec, { browser, label: '首页骨架+闭环' })
