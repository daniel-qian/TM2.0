// owner 缺失分支的判据门。
//
// ## 为什么单开一道门
// 07-19 裸域名切成 v02 之后，在**生产**上抓到一个 `owner: null` 的项目，团队屏的卡片上
// 写着写死的英文 `Unassigned`——而后端 payload 里根本没有这个词，是前端自己编的
// （`teamData.ts` 的 `card.ownerName ?? … ?? 'Unassigned'`）。
//
// 🔴 现成的门一条都抓不到它，**不是没写断言，是结构上够不着**：纯度门 / P0 门 / blocker 门
// 上传的合成中文文档里，**每个项目都写了「负责人：X」**，于是 null 分支从来没渲染过。
// 门全绿、生产是坏的——正是 kickoff §5② / §8② 点名的那一类失败。
//
// ## 怎么才算真的够到了那条分支
// 不注入 store、不直接调派生函数——那样只证明函数本身，证明不了屏幕。
// 本门在**网络层**改写 `/ingest` 与 `/team/{ctx}` 的回包：把后端真发的那个项目**克隆一份**，
// 克隆件上把 `ownerName` / `ownerId` 两个键**整个删掉**（生产上后端就是「缺就不发键」）。
// 于是一次渲染里同时有对照组（有 owner）和被告（无 owner），且两者都走完整的
// 真 transport → liteTeamFromPayload → React 渲染 链路。
//
// ## 判据不是「有没有中文」，是「说的是哪一件事」
// 「文档没说负责人是谁」和「文档说了没有负责人」是两件事。把 `Unassigned` 翻成「未分配」
// 只治了英文、没治撒谎——那仍然是在替客户断言他的文档说了一句它没说过的话。
// 所以下面既禁 `Unassigned`，也禁「未分配」。
import { chromium } from 'playwright'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const UI = 'http://127.0.0.1:5173'
const R = []
const rec = (n, ok, d) => { R.push({ n, ok }); console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${n}${d ? ' — ' + d : ''}`) }

// 与 blocker 门同形的一份中文周报：抽出 1 个项目，负责人 李明（对照组）。
const DOC = [
  '# 星澜置业 · 周报 W30',
  '',
  '## 项目：一期交付验收',
  '负责人：李明',
  '阻碍项：佣金测算卡住，等财务确认',
  '',
].join('\n')

const docPath = path.join(os.tmpdir(), 'null_owner_w30.md')
fs.writeFileSync(docPath, DOC, 'utf8')

const CLONE_TITLE = '二期市政配套对接'
let sawInjection = false

// 回包改写：追加一个**没有 owner 键**的项目。只碰带 projects 数组的回包
// （/team/{ctx}/files 与 /notes 也匹配同一个 URL 前缀，绝不能动它们）。
async function injectOwnerlessProject(route) {
  const res = await route.fetch()
  let body
  try { body = await res.json() } catch { return route.fulfill({ response: res }) }
  if (!body || !Array.isArray(body.projects) || body.projects.length === 0) {
    return route.fulfill({ response: res })
  }
  const clone = { ...body.projects[0] }
  delete clone.ownerName   // 生产上后端是「缺就不发这个键」，不是发 null
  delete clone.ownerId
  clone.id = `${clone.id}__noowner`
  clone.title = CLONE_TITLE
  body.projects = [...body.projects, clone]
  sawInjection = true
  return route.fulfill({ response: res, body: JSON.stringify(body) })
}

const browser = await chromium.launch({ headless: true })

async function run(shellQuery, seam) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const p = await ctx.newPage()
  const errs = []
  p.on('pageerror', (e) => errs.push(e.message))
  await p.route('**/ingest', injectOwnerlessProject)
  await p.route('**/team/*', injectOwnerlessProject)

  await p.goto(`${UI}/?${shellQuery}&mode=live&look=paper&lang=zh`, { waitUntil: 'networkidle' })
  if (await p.locator('.lite-onboard').count()) { await p.keyboard.press('Escape'); await p.waitForTimeout(700) }

  await p.evaluate(async ({ text, seam }) => {
    await window[seam].getState().uploadFiles([new File([text], 'w30.md', { type: 'text/markdown' })])
    await new Promise((r) => setTimeout(r, 2200))
  }, { text: DOC, seam })
  await p.evaluate((seam) => window[seam].getState().goScreen('team'), seam)
  await p.waitForTimeout(1000)

  const cards = await p.evaluate(() =>
    [...document.querySelectorAll('.home-project-card')].map((el) => ({
      title: el.querySelector('h3')?.innerText ?? '',
      meta: el.querySelector('.home-project-meta')?.innerText ?? '',
    })),
  )
  // 派生层实际拿到了什么（证明确实是 owner 缺失分支，不是别的路径顺手填了个值）
  const derived = await p.evaluate((seam) =>
    (window[seam].getState().team?.projects ?? []).map((x) => ({
      title: x.title, ownerName: x.ownerName, ownerNameRaw: x.ownerNameRaw ?? '(无此字段)',
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

// open-loop-0720：`__AVERY_LITE__` → `__liteStore`。前者是 src/main.tsx 里 DEV-only 的测试缝
// （`import.meta.env.DEV` 门死代码消除，`vite build` 产物里整段没有），门只要不是跑在真
// dev server 上（build+preview 是本仓唯一能绕开共享 node_modules 缺 @babel/* 那个坑的路子）
// 就会在 v01 分支直接炸成 `window.__liteStore` … `Cannot read properties of undefined`。
// `__liteStore` 是 src/lite/store.ts:350 的无条件测试缝（同一先例见 verify-status-truth.mjs /
// verify-aria-zh.mjs），两个环境都挂着，换这一个词其余断言零改动、15 条全绿（已跑过验证）。
for (const [q, seam, label] of [
  ['v=2', '__lite2Store', 'v02（裸链默认壳）'],
  ['v=1', '__liteStore', 'v01（?v=1 逃生门）'],
]) {
  console.log(`\n═══ ${label} · 团队屏项目卡 ═══`)
  const { cards, derived, overlay, body, errs } = await run(q, seam)
  for (const c of cards) console.log(`         卡片 ${JSON.stringify(c)}`)
  for (const d of derived) console.log(`         派生 ${JSON.stringify(d)}`)

  const subject = cards.filter((c) => c.title.includes(CLONE_TITLE))
  const control = cards.filter((c) => !c.title.includes(CLONE_TITLE))

  rec(`[${label}] 注入生效：屏幕上确实渲染出了那个没有 owner 的项目卡`,
    subject.length === 1, `被告 ${subject.length} 张 / 对照 ${control.length} 张`)
  rec(`[${label}] 🔴 屏幕上不出现写死的英文 "Unassigned"`,
    !body.includes('Unassigned'), `命中 ${(body.match(/Unassigned/g) || []).length} 次`)
  rec(`[${label}] 🔴 屏幕上不出现「未分配」（那是替客户断言"文档说了没人负责"）`,
    !body.includes('未分配'))
  rec(`[${label}] 缺 owner 的卡片说的是「文档未提及」`,
    subject.length === 1 && subject[0].meta.includes('文档未提及'),
    subject.map((c) => c.meta).join(' | ') || '(没有被告卡)')
  rec(`[${label}] 对照组：写了负责人的项目仍显示那个人名（认领链路没被拆）`,
    control.length >= 1 && control.every((c) => c.meta.includes('李明')),
    control.map((c) => c.meta).join(' | ') || '(没有对照卡)')
  if (overlay) {
    rec(`[${label}] 详情浮层对同一个项目说法一致（不出现英文兜底）`,
      !overlay.includes('Unassigned') && !overlay.includes('未分配') && overlay.includes('文档未提及'),
      overlay.replace(/\n+/g, ' / ').slice(0, 120))
  }
  rec(`[${label}] 无 pageerror`, errs.length === 0, errs.slice(0, 2).join(' | ') || '0 条')
}

await browser.close()

rec('注入路径本身生效过（否则以上"没出现 Unassigned"是空真）', sawInjection)

const pass = R.filter((r) => r.ok).length
const fail = R.length - pass
console.log(`\n═══ owner 缺失分支：${pass} PASS · ${fail} FAIL ═══`)
process.exit(fail ? 1 : 0)
