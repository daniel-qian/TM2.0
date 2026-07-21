// 顶栏让位门（cr-align 视觉战役棒0/棒1 · 2026-07-21）。
//
// ## 缺陷是什么
// lite2 顶栏是 fixed 悬浮（.prototype-topbar，00-base l.65：top:18px 无高度预留），
// 让位责任散落在每个屏自己的 frame padding 里（新屏惯例 84px）。谁忘了谁重叠：
// 「Avery 的笔记」(.lite-notes) 和「未来方向」(.lite-vision) 用的是老居中 flex 模式，
// 只留 28px——标题钻进 nav 底下（Danny 2026-07-21 生产截图实证）。
// 这是**模式缺陷**不是个别失误：修掉两处不等于治好病根，所以立这道门永久看守
// 「任何屏的首标题必须低于顶栏带」这个结构不变量——未来新屏忘让位，这里立刻红。
//
// ## 判别器
// 真渲染、真 getBoundingClientRect：顶栏带底 = .prototype-topbar 所有可见子簇
// （tabs/铃/登录/设置）bbox bottom 的最大值；每屏在 scrollTop=0 时取 scene 内文档序
// 第一个可见 h1/h2/h3，断言 heading.top >= 带底 + 8px。两皮都跑（几何是两皮共享的）。
// 另附 elementFromPoint 遮挡取证（信息性输出，不作判据——判据用带底不变量，更强更稳）。
//
// 附带 Bug B 微断言：注入决策世界后 .lite-home-decision-followup 的 computed
// border-radius 必须 = 999px（三个兄弟按钮的配方）——该按钮没进 l.3809 的枚举选择器
// 列表时是裸浏览器默认按钮，此断言红。
//
// ## 两种世界
//   修前：/notes /vision 首标题 top≈34px < 带底≈64px → 红；followup 按钮无圆角 → 红。
//   修后：九屏全部 ≥ 带底+8 → 绿；按钮 999px → 绿。
//   未来世界：新屏忘让位 → 该屏立刻红（这是本门的长期价值）。
//
// ## 怎么跑（与 verify-contrast-smalltext.mjs 同一套前置）
//   VERIFY_BASE=http://localhost:5173 node eval-harness/tools/verify-topbar-clearance.mjs
import { chromium } from 'playwright'

const UI = process.env.VERIFY_BASE || 'http://localhost:5173'
const R = []
const rec = (n, ok, d) => { R.push({ n, ok }); console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${n}${d ? ' — ' + d : ''}`) }

const SEED_DOC = [
  '# 望江咨询 · 项目周报 W33',
  '',
  '## 项目：客户门户改版',
  '负责人：陈静',
  '状态：正常',
  '',
  '本周完成登录页联调，下周进入验收。',
  '',
].join('\n')

const V2_SCREENS = ['home', 'team', 'projects', 'room', 'followups', 'notes', 'closerlook', 'playbooks', 'vision']

// 每屏量：顶栏带底、首标题 top、遮挡取证。在页内一次算完。
const MEASURE_FN = `(() => {
  const bar = document.querySelector('.prototype-topbar')
  if (!bar) return { err: 'no topbar' }
  if (getComputedStyle(bar).position !== 'fixed') return { skip: 'topbar not fixed (narrow sticky mode)' }
  let bandBottom = 0
  const pills = []
  for (const ch of bar.children) {
    const r = ch.getBoundingClientRect()
    const cs = getComputedStyle(ch)
    if (r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && +cs.opacity !== 0) {
      bandBottom = Math.max(bandBottom, r.bottom)
      pills.push({ cls: String(ch.className).slice(0, 30), rect: [r.left, r.top, r.right, r.bottom].map(Math.round) })
    }
  }
  const stage = document.querySelector('.scene-stage') || document.body
  let heading = null
  for (const h of stage.querySelectorAll('h1, h2, h3')) {
    const r = h.getBoundingClientRect()
    const cs = getComputedStyle(h)
    if (r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && +cs.opacity !== 0) {
      heading = { text: (h.innerText || '').trim().slice(0, 20), top: Math.round(r.top), left: Math.round(r.left) }
      // 遮挡取证：标题中心点被顶栏族元素接住 = 真被压
      const el = document.elementFromPoint((r.left + r.right) / 2, r.top + Math.min(10, r.height / 2))
      heading.occluded = !!(el && el.closest('.prototype-topbar'))
      break
    }
  }
  return { bandBottom: Math.round(bandBottom), pills: pills.length, heading }
})()`

const browser = await chromium.launch({ headless: true })

async function driveLook(look) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const page = await ctx.newPage()
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(e.message))
  console.log(`\n═══ v02·${look} ═══`)

  await page.goto(`${UI}/?v=2&mode=live&look=${look}&lang=zh`, { waitUntil: 'networkidle' })
  if (await page.locator('.lite-onboard').count()) {
    await page.keyboard.press('Escape')
    await page.waitForTimeout(600)
  }
  // 满世界：让每屏都有真内容（帧 padding 与数据无关，但标题要在场）
  await page.evaluate(async (doc) => {
    const enc = new TextEncoder()
    const f = new File([enc.encode(doc)], 'w33-weekly.md', { type: 'text/markdown' })
    await window.__lite2Store.getState().uploadFiles([f])
  }, SEED_DOC)
  await page.waitForFunction(
    () => ['ready', 'error'].includes(window.__lite2Store.getState().ingestStatus),
    undefined, { timeout: 30000 },
  )
  // 问一轮让 Avery 笔记真的落一条——notes 屏的标题只有在有笔记的世界才贴顶
  // （空态是居中卡，标题在 275px 远处，压不到；Danny 的重叠截图正是有笔记世界）
  await page.evaluate(() => {
    const st = window.__lite2Store.getState()
    st.goScreen('room')
    st.askLive({ situation: '这周谁的项目最需要我搭把手？' })
  })
  await page.waitForFunction(
    () => ['complete', 'error'].includes(window.__lite2Store.getState().run.status),
    undefined, { timeout: 30000 },
  ).catch(() => {})
  await page.evaluate(() => window.__lite2Store.getState().refreshNotes?.())
  await page.waitForTimeout(500)

  for (const sc of V2_SCREENS) {
    await page.evaluate((s) => window.__lite2Store.getState().goScreen(s), sc)
    await page.waitForTimeout(350)
    const m = await page.evaluate(MEASURE_FN)
    if (m.err) { rec(`[${look}] ${sc} 可测（顶栏在场）`, false, m.err); continue }
    if (m.skip) { rec(`[${look}] ${sc} 跳过（${m.skip}）`, true); continue }
    if (!m.heading) {
      // 无标题屏没有「标题被压」问题面；记录在案但不算失败（首轮如出现，人工核对该屏形态）
      rec(`[${look}] ${sc} 无 h1-h3（居中空态类形态，无标题可压）`, true, `bandBottom=${m.bandBottom}`)
      continue
    }
    const clear = m.heading.top >= m.bandBottom + 8
    rec(
      `[${look}] ${sc} 首标题低于顶栏带（top ${m.heading.top} ≥ ${m.bandBottom}+8）`,
      clear,
      `"${m.heading.text}"${m.heading.occluded ? ' ⚠️elementFromPoint 实测被顶栏接住' : ''}`,
    )
  }

  rec(`[${look}] 无 pageerror`, pageErrors.length === 0, pageErrors.slice(0, 2).join(' | ') || '0 条')
  await ctx.close()
}

await driveLook('aurora')
await driveLook('paper')

// ── Bug B 微断言：加到待办按钮必须有自己的样式（今天红：没进枚举选择器列表） ──────
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const page = await ctx.newPage()
  await page.goto(`${UI}/?v=2&mode=live&lang=zh`, { waitUntil: 'networkidle' })
  if (await page.locator('.lite-onboard').count()) {
    await page.keyboard.press('Escape')
    await page.waitForTimeout(600)
  }
  // 注入决策世界（verify-home-skeleton 的世界 B 配方）
  await page.evaluate(() => {
    const decision = {
      subject_type: 'project', subject_id: 'p-gate-1', subject_title: '客户门户改版',
      grade: 'high_risk', grade_label: '今天要决策', severity: 3,
      reason: '截止日期已过而状态仍写推进中。', reason_source: 'rule',
      escalated: false, escalation_reason: null, unknown_fields: [], unparsed_fields: [],
      matched_rules: [{ rule_id: 'R1', title: '过期未更新', grade_label: '今天要决策', basis: '截止日早于今天', evidence: ['原文：预计 7 月 10 日交付'] }],
      owner_name: '陈静',
    }
    window.__lite2Store.setState({
      contextId: 'ctx-gate-fake',
      team: { people: [], projects: [], handoffs: [], briefing: { headline: '', subhead: '', metrics: [] } },
      rawTeam: { people: [], projects: [], decisions: [decision] },
    })
    window.__lite2Store.getState().goScreen('home')
  })
  await page.waitForTimeout(500)
  const btn = await page.evaluate(() => {
    const el = document.querySelector('.lite-home-decision-followup')
    if (!el) return null
    const cs = getComputedStyle(el)
    return { radius: cs.borderRadius, fontSize: cs.fontSize, bg: cs.backgroundColor, family: el.classList.contains('lite-btn') }
  })
  rec('「加到待办」按钮在场', btn !== null)
  // cr-align 棒4（2026-07-21）字面量重导出——来源 cr-align-spec.json stick-4
  // btn.followupRadius/btn.followupFont（spec→门→码）：棒1 的 999px 止血形毕业成
  // .lite-btn 族形（aurora 默认皮 r9px + 13px）。旧构建红证明：改后本断言对棒3 构建跑
  // 必红（还是 999px/11.5px、未挂族类）。
  rec(
    '「加到待办」按钮挂 .lite-btn 族且吃 aurora 族度量（r9px + 13px，spec stick-4）',
    btn !== null && btn.family && btn.radius === '9px' && btn.fontSize === '13px',
    btn ? `family=${btn.family} radius=${btn.radius} fontSize=${btn.fontSize} bg=${btn.bg}` : '',
  )
  await ctx.close()
}

await browser.close()

const pass = R.filter((r) => r.ok).length
const fail = R.length - pass
console.log(`\n═══ 顶栏让位：${pass} PASS · ${fail} FAIL ═══`)
process.exit(fail ? 1 : 0)
