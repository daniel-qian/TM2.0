// 状态缺失分支的判据门 —— teamData.ts `status ?? 'on-track'` 那类假结论的专门门。
//
// ## 为什么单开一道门（同 verify-null-owner.mjs 的理由，同一类失败）
// 07-19 那次「owner: null 显示 Unassigned」的生产事故是"编了一个名字"；这条更狠——
// `src/lite/teamData.ts` 曾经 `status: card.status ?? 'on-track'`，把「文档没读到状态」
// 编成了「按计划推进」四个字 + 绿点 + 归进「进行中」。现成的纯度门/P0 门/blocker 门上传的
// 合成中文文档里**每个项目都写了状态**，缺状态这条分支结构上从来没被够到过：门全绿，
// 客户扫一眼周报，7 个项目只有 3 个写了进展，另外 4 个在屏幕上被画成和真正按计划推进
// 一模一样的样子——这正是 kickoff §5②/§8② 点名的那类失败：门看的那一屏，恰好是缺陷
// 不在的那一屏。
//
// ## 怎么才算真的够到了那条分支
// 不注入 store、不直接调派生函数——那样只证明函数本身，证明不了屏幕。本门在**网络层**
// 改写 `/ingest` 与 `/team/{ctx}` 的回包：把后端真发的一个项目**克隆一份**，克隆件上把
// `status` 键**整个删掉**（生产上后端就是「缺就不发键」：registry.py `if pr.status:
// card["status"] = ...`，不是发 `""` 或 `null`）。于是一次渲染里同时有对照组
// （真 on-track 一个 + 真 blocked 一个）和被告（无 status 键），且三者都走完整的
// 真 transport → liteTeamFromPayload/buildProjectViews → React 渲染 链路。
//
// ## 判据不是「有没有中文」，是「说的是哪一件事」，也不是「文案对不对」就完了
// 「文档没说状态是什么」和「文档说了正常」是两件事。混淆的后果是**产品替客户说了一句
// 他从没说过的安心话**——绿点、和"进行中"分在一组，正下方却是「一切正常」四个字全是
// 编出来的。所以下面既查文案（不许出现「按计划推进」，必须出现「状态未提及」），
// 也查视觉判据（status-dot 的 tone class、卡片的 edge class、v02 项目屏的分组 key）——
// 只查文案会漏掉「文案已经诚实了，圆点还是绿的」这类回归：本门筹备时在
// `src/lite2/screens/TeamScreen.tsx` 的首页项目道上真的抓到过一次——teamData.ts 07-19
// 已经不吐字面 `'on-track'` 了，但组件判据吃的是 `project.status`（渲染文案字段，
// 缺失时装的是本地化兜底句 `projectStatusUnread`，不是原始枚举），statusTone() 拿它去比
// `'blocked'`/`'at-risk'` 永远比不中，于是缺状态的项目拿到的 tone 和真·on-track 一样
// 都是空串——圆点照样是默认的 sage/绿。判据必须吃 `statusRaw`，这也是本门要钉住的点。
//
// 怎么跑（与 verify-null-owner.mjs 同一套前置）：
//   1) cd eval-harness && AVERY_BRAIN=mock python -m uvicorn service.app:app --port <port>
//      （AVERY_CORS_ORIGINS 精确匹配前端来源）
//   2) 前端起在与 CORS 白名单一致的端口（vite build --mode development + vite preview）
//   3) VERIFY_BASE=http://127.0.0.1:<port> node eval-harness/tools/verify-status-truth.mjs
import { chromium } from 'playwright'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const UI = process.env.VERIFY_BASE || 'http://127.0.0.1:5173'
const R = []
const rec = (n, ok, d) => { R.push({ n, ok }); console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${n}${d ? ' — ' + d : ''}`) }

// 一份中文周报：两个真写了状态的项目（on-track 对照 + blocked 对照），供颜色/文案回归比对。
// rich-align-0722/01：on-track 对照项目补 进度 + 项目级风险，让「真值卡照常渲染进度条 + 风险
// 徽章」有正例；克隆件（injectStatuslessProject）把这两个键连同 status 一起删掉 → absent 分支
// 断言「无依据卡不渲染进度条与风险徽章」。
const DOC = [
  '# 星澜置业 · 周报 W31',
  '',
  '## 项目：一期交付验收',
  '负责人：李明',
  '状态：正常',
  '进度：72%',
  '风险：中/工期偏紧',
  '',
  '## 项目：二期市政配套对接',
  '负责人：王芳',
  '状态：受阻',
  '阻碍项：审批卡在规划局，等回复',
  '',
].join('\n')

const docPath = path.join(os.tmpdir(), 'status_truth_w31.md')
fs.writeFileSync(docPath, DOC, 'utf8')

const ONTRACK_TITLE = '一期交付验收'
const BLOCKED_TITLE = '二期市政配套对接'
const CLONE_TITLE = '三期精装交付'
let sawInjection = false

// 回包改写：追加一个**没有 status 键**的项目（克隆自真 on-track 对照项目，只挖掉 status）。
// 只碰带 projects 数组的回包（/team/{ctx}/files 与 /notes 也匹配同一个 URL 前缀，绝不能动它们）。
async function injectStatuslessProject(route) {
  const res = await route.fetch()
  let body
  try { body = await res.json() } catch { return route.fulfill({ response: res }) }
  if (!body || !Array.isArray(body.projects) || body.projects.length === 0) {
    return route.fulfill({ response: res })
  }
  const src = body.projects.find((p) => p && p.status) ?? body.projects[0]
  const clone = { ...src }
  delete clone.status // 生产上后端是「缺就不发这个键」，不是发 '' 或 null
  // rich-align-0722/01：同款「缺就不发键」——把 progress / risk 也整个删掉，测富字段 absent 分支。
  delete clone.progress
  delete clone.risk
  clone.id = `${clone.id}__nostatus`
  clone.title = CLONE_TITLE
  body.projects = [...body.projects, clone]
  sawInjection = true
  return route.fulfill({ response: res, body: JSON.stringify(body) })
}

const browser = await chromium.launch({ headless: true })

async function uploadAndGoTeam(page, seam) {
  await page.route('**/ingest', injectStatuslessProject)
  await page.route('**/team/*', injectStatuslessProject)

  await page.evaluate(async ({ text, seam }) => {
    await window[seam].getState().uploadFiles([new File([text], 'w31.md', { type: 'text/markdown' })])
    await new Promise((r) => setTimeout(r, 2200))
  }, { text: DOC, seam })
  await page.evaluate((seam) => window[seam].getState().goScreen('team'), seam)
  await page.waitForTimeout(1000)
}

// ── 团队屏（首页项目道）：v01 与 v02 共用同一套断言 ─────────────────────────────
async function runTeamScreen(shellQuery, seam) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const p = await ctx.newPage()
  const errs = []
  p.on('pageerror', (e) => errs.push(e.message))

  await p.goto(`${UI}/?${shellQuery}&mode=live&look=paper&lang=zh`, { waitUntil: 'networkidle' })
  if (await p.locator('.lite-onboard').count()) { await p.keyboard.press('Escape'); await p.waitForTimeout(700) }

  await uploadAndGoTeam(p, seam)

  const cards = await p.evaluate(() =>
    [...document.querySelectorAll('.home-project-card')].map((el) => ({
      title: el.querySelector('h3')?.innerText ?? '',
      statusText: el.querySelector('.home-project-status')?.innerText ?? '',
      cardClass: el.className,
      dotClass: el.querySelector('.status-dot')?.className ?? '',
    })),
  )
  const derived = await p.evaluate((seam) =>
    (window[seam].getState().team?.projects ?? []).map((x) => ({
      title: x.title, status: x.status, statusRaw: x.statusRaw ?? '(无此字段/v01不带)',
    })), seam)

  // 详情浮层：同一个项目在两处显示，说法必须一致
  let overlay = ''
  const target = p.locator('.home-project-card', { hasText: CLONE_TITLE }).first()
  if (await target.count()) {
    await target.click()
    await p.waitForTimeout(700)
    overlay = await p.evaluate(() => document.querySelector('.lite-detail-card')?.innerText ?? '')
    await p.keyboard.press('Escape')
    await p.waitForTimeout(400)
  }

  const body = await p.evaluate(() => document.body.innerText)
  await ctx.close()
  return { cards, derived, overlay, body, errs }
}

for (const [q, seam, label] of [
  ['v=2', '__lite2Store', 'v02（裸链默认壳）'],
  // 🔴 用 `__liteStore` 取 v01 句柄，不用 `__AVERY_LITE__`：后者挂在 src/main.tsx 的
  // `import.meta.env.DEV` 闸后面，`vite build`（即便 `--mode development`）里 DEV 恒为
  // false，会被摇树摇掉——本门跑在 build+preview（dev serve 因共享 node_modules 缺
  // @babel/* 而不可用），用 `__AVERY_LITE__` 会在 v01 分支直接炸。`__liteStore` 是
  // `src/lite/store.ts` 自己挂的、不挂 DEV 闸的验收缝（`__lite2Store` 同款先例，
  // eval-harness/tools/verify-aria-zh.mjs 已踩过这个坑并留了同款注释）。
  ['v=1', '__liteStore', 'v01（?v=1 逃生门）'],
]) {
  console.log(`\n═══ ${label} · 团队屏项目卡 ═══`)
  const { cards, derived, overlay, body, errs } = await runTeamScreen(q, seam)
  for (const c of cards) console.log(`         卡片 ${JSON.stringify(c)}`)
  for (const d of derived) console.log(`         派生 ${JSON.stringify(d)}`)

  const subject = cards.filter((c) => c.title.includes(CLONE_TITLE))
  const onTrackControl = cards.filter((c) => c.title.includes(ONTRACK_TITLE))
  const blockedControl = cards.filter((c) => c.title.includes(BLOCKED_TITLE))

  rec(`[${label}] 注入生效：屏幕上确实渲染出了那个没有 status 键的项目卡`,
    subject.length === 1, `被告 ${subject.length} 张 / on-track对照 ${onTrackControl.length} 张 / blocked对照 ${blockedControl.length} 张`)

  // ① 文案判据 —— 不许把「不知道」说成「按计划推进」
  rec(`[${label}] 🔴 被告卡不显示"按计划推进"（不许把没读到说成正常）`,
    subject.length === 1 && !subject[0].statusText.includes('按计划推进'),
    subject.map((c) => c.statusText).join(' | ') || '(没有被告卡)')
  rec(`[${label}] 被告卡显示"状态未提及"`,
    subject.length === 1 && subject[0].statusText.includes('状态未提及'),
    subject.map((c) => c.statusText).join(' | ') || '(没有被告卡)')

  // ② 视觉判据 —— dot 的 tone class 不能是「默认色」（默认色 == on-track 的绿，撞色即撒谎）
  rec(`[${label}] 🔴 被告卡的圆点挂了 tone-unknown（不是默认的 sage/绿）`,
    subject.length === 1 && subject[0].dotClass.includes('tone-unknown'),
    subject.map((c) => c.dotClass).join(' | ') || '(没有被告卡)')
  rec(`[${label}] 被告卡的圆点不是 danger/warning（"不知道"不是"告警"）`,
    subject.length === 1 && !subject[0].dotClass.includes('tone-danger') && !subject[0].dotClass.includes('tone-warning'),
    subject.map((c) => c.dotClass).join(' | ') || '(没有被告卡)')
  rec(`[${label}] 被告卡不挂 edge-blocked / edge-at-risk（未知不该被画成告警边）`,
    subject.length === 1 && !subject[0].cardClass.includes('edge-blocked') && !subject[0].cardClass.includes('edge-at-risk'),
    subject.map((c) => c.cardClass).join(' | ') || '(没有被告卡)')

  // ③ 对照组 —— 真 on-track / 真 blocked 必须原样正确，证明修复没有误伤真数据
  rec(`[${label}] 对照组：真按计划推进的项目仍显示"按计划推进" + 默认（绿）圆点`,
    onTrackControl.length === 1 && onTrackControl[0].statusText.includes('按计划推进') &&
      !onTrackControl[0].dotClass.includes('tone-unknown') &&
      !onTrackControl[0].dotClass.includes('tone-danger') &&
      !onTrackControl[0].dotClass.includes('tone-warning'),
    onTrackControl.map((c) => `${c.statusText} / ${c.dotClass}`).join(' | ') || '(没有对照卡)')
  rec(`[${label}] 对照组：真受阻的项目仍显示告警圆点（tone-danger）`,
    blockedControl.length === 1 && blockedControl[0].dotClass.includes('tone-danger'),
    blockedControl.map((c) => c.dotClass).join(' | ') || '(没有对照卡)')

  if (overlay) {
    rec(`[${label}] 详情浮层对同一个项目说法一致（不出现"按计划推进"，出现"状态未提及"）`,
      !overlay.includes('按计划推进') && overlay.includes('状态未提及'),
      overlay.replace(/\n+/g, ' / ').slice(0, 160))
  }
  rec(`[${label}] 无 pageerror`, errs.length === 0, errs.slice(0, 2).join(' | ') || '0 条')
}

// ── v02 独有：项目屏（/projects）分组判据 —— 未知状态不许混进"进行中"那一组 ──────────
{
  const label = 'v02 · 项目屏分组'
  console.log(`\n═══ ${label} ═══`)
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const p = await ctx.newPage()
  const errs = []
  p.on('pageerror', (e) => errs.push(e.message))

  await p.goto(`${UI}/?v=2&mode=live&look=paper&lang=zh`, { waitUntil: 'networkidle' })
  if (await p.locator('.lite-onboard').count()) { await p.keyboard.press('Escape'); await p.waitForTimeout(700) }

  await uploadAndGoTeam(p, '__lite2Store')
  await p.evaluate(() => window.__lite2Store.getState().goScreen('projects'))
  await p.waitForTimeout(700)

  const subjectCard = p.locator('.lite-project-card', { hasText: CLONE_TITLE }).first()
  const found = (await subjectCard.count()) > 0
  rec(`[${label}] 项目屏渲染出了被告卡`, found)

  if (found) {
    const info = await subjectCard.evaluate((el) => {
      const group = el.closest('[data-project-group]')
      return {
        groupKey: group?.getAttribute('data-project-group') ?? '(无分组容器)',
        cardClass: el.className,
        dotClass: el.querySelector('.status-dot')?.className ?? '',
        statusText: el.querySelector('.lite-project-status')?.innerText ?? '',
      }
    })
    console.log(`         被告卡 ${JSON.stringify(info)}`)
    rec(`[${label}] 🔴 被告卡分在"未知"组，不混进"进行中"（on-track）组`,
      info.groupKey === 'unknown', `groupKey=${info.groupKey}`)
    rec(`[${label}] 被告卡不显示"按计划推进"，显示"状态未提及"`,
      !info.statusText.includes('按计划推进') && info.statusText.includes('状态未提及'),
      info.statusText)
    rec(`[${label}] 被告卡圆点挂 tone-unknown（不是默认绿）`,
      info.dotClass.includes('tone-unknown'), info.dotClass)
    rec(`[${label}] 被告卡不挂 edge-* 告警边`,
      !info.cardClass.includes('edge-blocked') && !info.cardClass.includes('edge-at-risk'), info.cardClass)

    // rich-align-0722/01：富字段 absent 分支 —— 无 progress/risk 键的被告卡不画进度条/风险徽章。
    const richAbsent = await subjectCard.evaluate((el) => ({
      riskBadges: el.querySelectorAll('.lite-project-risk').length,
      progressFills: el.querySelectorAll('.lite-project-progress-fill').length,
      text: el.innerText,
    }))
    rec(`[${label}] 🔴 缺 risk 键的被告卡不渲染风险徽章（absent≠none）`,
      richAbsent.riskBadges === 0, `徽章 ${richAbsent.riskBadges} 个`)
    rec(`[${label}] 🔴 缺 progress 键的被告卡不画进度条，改说「文档未提及」`,
      richAbsent.progressFills === 0 && richAbsent.text.includes('文档未提及'),
      `进度条 ${richAbsent.progressFills} 条`)
  }

  // rich-align-0722/01：真值对照卡（一期，写了 进度72% + 风险中）必须照常渲染进度条 + 风险徽章。
  const controlCard = p.locator('.lite-project-card', { hasText: ONTRACK_TITLE }).first()
  if (await controlCard.count()) {
    const ctrl = await controlCard.evaluate((el) => ({
      riskMed: el.querySelector('.lite-project-risk.risk-medium') ? 1 : 0,
      progressFills: el.querySelectorAll('.lite-project-progress-fill').length,
    }))
    rec(`[${label}] 对照真值卡照常渲染风险徽章（risk-medium）+ 进度条`,
      ctrl.riskMed === 1 && ctrl.progressFills === 1, JSON.stringify(ctrl))
  }
  rec(`[${label}] 无 pageerror`, errs.length === 0, errs.slice(0, 2).join(' | ') || '0 条')
  await ctx.close()
}

await browser.close()

rec('注入路径本身生效过（否则以上"没出现按计划推进"是空真）', sawInjection)

const pass = R.filter((r) => r.ok).length
const fail = R.length - pass
console.log(`\n═══ 状态缺失分支：${pass} PASS · ${fail} FAIL ═══`)
process.exit(fail ? 1 : 0)
