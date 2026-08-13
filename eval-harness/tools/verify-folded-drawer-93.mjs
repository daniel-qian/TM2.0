// issue #93 ·「已并入其他项目」区 e2e 探针（前端半）。
//
// ## 这道门守的是什么
// #93 让补传之后的粒度闸对**全档案**重跑，把资料里本来是别的项目底下的检查点/阶段的条目，
// 折进它们该在的那张卡。后端从那时起答得出「为什么这张卡不见了」（裁决落了库、重启也在），
// 但在这道门之前**没有任何界面去读它**——对经理来说那张卡就是凭空消失了。
//
// 剧本就是合伙人真实的那个动作序列，一份一份地传：
//   ① 先传项目台账（6 个正经项目）  → 网格 6 张，页面上**没有**「已并入」区（born-red 的对照基准）
//   ② 再传本周周报（一个项目，里程碑逐字点名台账里的三个） → 网格 4 张，「已并入其他项目（3）」出现
//   ③ 展开 → 三行，每行说得出并进了哪张卡、凭哪一行原文
//   ④ 这个区里**一个恢复键都没有**（不是忘了做，是刻意——重判每次补传都跑全档案，
//      手动放回来的卡下一次上传会被原样再折，那是个会自己撤销的按钮）
//
// ## 🔴 判据纪律
//  · 每段前面带自证判据。①的「没有已并入区」如果不先证明②真能造出这个区，就是空真。
//  · 「网格里没有那三张卡」按**卡标题文本**判，不按 class：换个组件重新实现同一个谎也逃不掉。
//  · 中文文案不写死整句，只钉住那几个**必须出现的信息位**（母卡名、文件名:行号）——文案会改，
//    「说不说得出去向」不会改。唯一写死的是计数壳「（3）」，那是这个区的存在理由本身。
//
// ## 离线
// 吃 mock 三件套后端（AVERY_BRAIN=mock / AVERY_EMBEDDINGS=keyword / AVERY_EXTRACTOR=heuristic），
// 绝不碰 minimax。A 区独占端口时：
//   VERIFY_BASE=http://localhost:5393 node eval-harness/tools/verify-folded-drawer-93.mjs
//   （dist 需 bake VITE_AVERY_API_BASE 指向那条隔离后端，且后端 AVERY_CORS_ORIGINS 要放行 5393）
import { chromium } from 'playwright'

const UI = process.env.VERIFY_BASE || 'http://localhost:5173'
const SHOT = process.env.VERIFY_SHOT || ''
const R = []
const rec = (n, ok, d) => {
  R.push({ n, ok })
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${n}${d ? ' — ' + d : ''}`)
}

// 台账：6 个文档自己在跟进的项目（各带负责人/进度/截止）——R0-tracked，单独传时一张都不该折。
//
// ⚠ 语料写成 markdown 的 `## 项目：` 形式而不是 CSV，理由是**这道门吃的是 heuristic 抽取器**
// （离线三件套，见文件头）：后端离线时 CSV 台账抽出 0 个项目，第一批直接是空网格，整道门会以
// 「找不到卡」的形态假红。后端那半的同一份语料走的是 scripted brain
// （`tests/test_granularity_rejudge_93.py` 的 `CorpusBrain`），两边语料形状不同、判的是同一件事。
const LEDGER = [
  '# 项目台账',
  '## 项目：宴会厅翻新', '负责人：李国栋', '进度：60%', '截止：2026-09-30', '',
  '## 项目：亲子乐园二期', '负责人：张小芸', '进度：35%', '截止：2026-10-15', '',
  '## 项目：别墅套餐推广', '负责人：陈立', '进度：50%', '截止：2026-09-15', '',
  '## 项目：会员体系升级', '负责人：何静', '进度：20%', '截止：2026-11-01', '',
  '## 项目：停车场改造', '负责人：杨帆', '进度：10%', '截止：2026-12-01', '',
  '## 项目：物料采购', '负责人：赵敏', '进度：45%', '截止：2026-09-20', '',
].join('\n')

// 周报：一个项目，里程碑清单**逐字**点名台账里的三个。这就是跨文件的那一刀。
const WEEKLY = [
  '# 本周周报',
  '## 项目：秋季营销冲刺',
  '负责人：赵敏',
  '进度：40%',
  '里程碑：',
  '别墅套餐推广 — 进行中',
  '会员体系升级 — 未开始',
  '物料采购 — 已完成',
  '阻碍项：物料供应商未确认',
].join('\n')

const NESTED = ['别墅套餐推广', '会员体系升级', '物料采购']
const PARENT = '秋季营销冲刺'
const LEDGER_NAME = '项目台账.md'
const WEEKLY_NAME = '本周周报.md'

const browser = await chromium.launch({ headless: true })
const page = await (await browser.newContext({ viewport: { width: 1440, height: 960 } })).newPage()
page.on('console', (m) => {
  if (m.type() === 'error') console.log('    [console.error]', m.text())
})
await page.goto(`${UI}/?v=2&mode=live&look=aurora&lang=zh`, { waitUntil: 'networkidle' })
if (await page.locator('.lite-onboard').count()) {
  await page.keyboard.press('Escape')
  await page.waitForTimeout(500)
}

// `uploadFiles` 在已有档案时自己委托给 `appendFiles`（store.ts 的 #88 分流），所以两批走同一个入口，
// 但**等的状态机不是同一个**——第二批要等 appendStatus，等错了就是在旧世界上断言。
const push = async (name, text, which) => {
  await page.evaluate(async (d) => {
    const enc = new TextEncoder()
    const f = new File([enc.encode(d.text)], d.name, { type: 'text/plain' })
    await window.__lite2Store.getState().uploadFiles([f])
  }, { name, text })
  await page.waitForFunction(
    (k) => ['ready', 'error'].includes(window.__lite2Store.getState()[k]),
    which,
    { timeout: 60000 },
  )
  return page.evaluate((k) => window.__lite2Store.getState()[k], which)
}

const gridTitles = () =>
  page.$$eval('.lite-projects-grid .lite-project-card .lite-project-title',
    (ns) => ns.map((n) => n.textContent.trim()))

// ── ① 第一批：6 张正经项目，没有「已并入」区 ───────────────────────────────────────────────
const s1 = await push(LEDGER_NAME, LEDGER, 'ingestStatus')
await page.evaluate(() => window.__lite2Store.getState().goScreen('projects'))
await page.waitForSelector('.lite-projects-grid .lite-project-card', { timeout: 10000 })
const before = await gridTitles()
rec('① 台账单独上传：6 张项目卡都在（自证语料真被抽出来了）',
  s1 === 'ready' && before.length === 6 && NESTED.every((t) => before.includes(t)),
  `status=${s1} n=${before.length} ${JSON.stringify(before)}`)
const foldedBefore = await page.locator('.lite-projects-folded').count()
rec('① 此刻页面上没有「已并入」区（对照基准，不是空真——②会把它造出来）',
  foldedBefore === 0, `count=${foldedBefore}`)

// ── ② 第二批：周报到场 → 三张被折进母卡 ───────────────────────────────────────────────────
const s2 = await push(WEEKLY_NAME, WEEKLY, 'appendStatus')
await page.waitForTimeout(400)
const after = await gridTitles()
rec('② 补传周报后网格是 4 张（6 → 4，母卡进来了、三张检查点被收走）',
  s2 === 'ready' && after.length === 4 && after.includes(PARENT),
  `status=${s2} n=${after.length} ${JSON.stringify(after)}`)
rec('② 那三条不在主网格里了（按卡标题判，不按 class）',
  NESTED.every((t) => !after.includes(t)), JSON.stringify(after))

const toggle = page.locator('.lite-projects-folded-toggle')
const toggleText = (await toggle.count()) ? (await toggle.innerText()).trim() : ''
rec('② 「已并入」区出现，且计数是 3', toggleText.includes('3'), `toggle="${toggleText}"`)

// ── ③ 展开：每行说得出去向与依据 ─────────────────────────────────────────────────────────
await toggle.click()
await page.waitForSelector('.lite-projects-folded-item', { timeout: 5000 })
const items = await page.$$eval('.lite-projects-folded-item', (ns) =>
  ns.map((n) => ({
    title: n.querySelector('.lite-projects-folded-title')?.textContent.trim() ?? '',
    into: n.querySelector('.lite-projects-folded-into')?.textContent.trim() ?? '',
    reason: n.querySelector('.lite-projects-folded-reason')?.textContent.trim() ?? '',
    evidence: n.querySelector('.lite-projects-folded-evidence')?.textContent.trim() ?? '',
  })))
rec('③ 展开后三行，标题就是被收走的那三张',
  items.length === 3 && NESTED.every((t) => items.some((i) => i.title === t)),
  JSON.stringify(items.map((i) => i.title)))
rec('③ 每行都说得出并进了哪张母卡（母卡名逐字在文本里）',
  items.length === 3 && items.every((i) => i.into.includes(PARENT)),
  JSON.stringify(items.map((i) => i.into)))
rec('③ 每行都有一句给经理看的理由（后端 Ruling.reason 原句，不是规则 id）',
  items.length === 3 && items.every((i) => i.reason.length > 0 && !i.reason.startsWith('R1-')),
  JSON.stringify(items.map((i) => i.reason.slice(0, 24))))
rec('③ 每行都指得出资料里的哪一行（文件名:行号）',
  items.length === 3 && items.every((i) => i.evidence.includes(WEEKLY_NAME) && /:\d+/.test(i.evidence)),
  JSON.stringify(items.map((i) => i.evidence)))
// 三行各指各的行 —— 共用一行会让「凭哪一行」退化成一句摆设。
rec('③ 三行的依据互不相同',
  new Set(items.map((i) => i.evidence)).size === 3, JSON.stringify(items.map((i) => i.evidence)))

// ── ③b 滚到底之后，这个区的最后一行还读得到 ────────────────────────────────────────────────
// 这个区永远是项目屏的**最后一块**，而它下面压着两样东西：`.lite-projects-scroll` 末尾
// 44px 的渐隐遮罩，和屏底常驻的「问 Avery」发射器。
//
// 🔴 两条判据都不够，要三条一起：
//  · `elementFromPoint` 真命中 —— rect 重叠不算数（bottom-furniture 那道门的同一条纪律）；
//  · 但 elementFromPoint **看不见 mask**：被遮罩淡成透明的元素照样命中自己、`opacity` 照样是 1。
//    所以再加一条几何判据：最后一行的底边必须在渐隐带**上面**。遮罩宽度从计算值里读出来，
//    不写死 44 —— 那个数改了，判据得跟着改，而不是继续对着一片看不见的字全绿。
//  · 最后一行是**尾注**不是最后一个 item。第一版只探了 item，尾注整行糊掉而门是绿的
//    （progress.md「判据够不着≠判据写错」的现场版）。
//
// ⚠ 滚动条在 `.lite-projects-scroll` 上，不在 window 上，而且 `scrollIntoView({block:'end'})`
//    只把这一段的底边对齐到容器底边 —— 那时还剩 90px 没滚（frame 的 padding-bottom），
//    尾注正好落在渐隐带里。要滚就滚到 scrollHeight。
await page.evaluate(() => {
  const sc = document.querySelector('.lite-projects-scroll')
  if (sc) sc.scrollTop = sc.scrollHeight
})
await page.waitForTimeout(350)
const tail = await page.evaluate(() => {
  const sc = document.querySelector('.lite-projects-scroll')
  const last = document.querySelector('.lite-projects-folded-note')
  if (!sc || !last) return { probed: false }
  const cs = getComputedStyle(sc)
  const mask = cs.maskImage || cs.webkitMaskImage || ''
  const m = /calc\(100% - ([\d.]+)px\)/.exec(mask)
  const fade = m ? parseFloat(m[1]) : 0
  const scr = sc.getBoundingClientRect()
  const r = last.getBoundingClientRect()
  const hit = document.elementFromPoint(r.left + 20, r.top + r.height / 2)
  return {
    probed: true,
    atEnd: Math.abs(sc.scrollHeight - sc.clientHeight - sc.scrollTop) < 2,
    mine: !!(hit && last.contains(hit)),
    fade,
    clearOfFade: r.bottom <= scr.bottom - fade,
    bottom: Math.round(r.bottom),
    fadeLine: Math.round(scr.bottom - fade),
  }
})
rec('③b 滚到底后尾注不被屏底家具压住（elementFromPoint 真命中它自己）',
  tail.probed === true && tail.atEnd === true && tail.mine === true, JSON.stringify(tail))
rec('③b 尾注也没落进滚动容器末尾的渐隐带（遮罩宽度读计算值，不写死）',
  tail.probed === true && tail.fade > 0 && tail.clearOfFade === true,
  `bottom=${tail.bottom} fadeLine=${tail.fadeLine} fade=${tail.fade}`)

// 人眼过一遍的那张图，拍在**这里**——④ 会去归档一张卡把页面搞脏，那不是经理看到的样子。
// ⚠ 滚动条在 `.lite-projects-scroll` 这个内层容器上，不在 body 上：`window.scrollTo` 是个空动作，
//   `fullPage:true` 也只会给你一张视口高的图（第一次拍就是这么骗到的）。
if (SHOT) {
  await page.screenshot({ path: SHOT })
  console.log(`  [shot] ${SHOT}`)
}

// ── ③c 手机视口 ────────────────────────────────────────────────────────────────────────
// 🔴 桌面绿≠手机绿：让位余量是高度的函数，折叠线以下是瞎区。这个区里最长的一行是后端那句
// 中文理由，窄屏下它会换到三四行，把尾注顶进渐隐带——那正是桌面上量不出来的那一类。
await page.setViewportSize({ width: 390, height: 780 })
await page.waitForTimeout(400)
const mobile = await page.evaluate(() => {
  const sc = document.querySelector('.lite-projects-scroll')
  const last = document.querySelector('.lite-projects-folded-note')
  const item = document.querySelector('.lite-projects-folded-item')
  if (!sc || !last || !item) return { probed: false }
  sc.scrollTop = sc.scrollHeight
  const cs = getComputedStyle(sc)
  const m = /calc\(100% - ([\d.]+)px\)/.exec(cs.maskImage || cs.webkitMaskImage || '')
  const fade = m ? parseFloat(m[1]) : 0
  const scr = sc.getBoundingClientRect()
  const r = last.getBoundingClientRect()
  const ir = item.getBoundingClientRect()
  return {
    probed: true,
    clearOfFade: r.bottom <= scr.bottom - fade,
    // 横向不许溢出：中文长句 + flex 子项默认 min-width:auto 是把整块撑破屏幕的经典组合。
    fitsWidth: ir.right <= scr.right + 1 && ir.left >= scr.left - 1,
    bodyNoHScroll: document.documentElement.scrollWidth <= window.innerWidth + 1,
    itemW: Math.round(ir.width), scrW: Math.round(scr.width),
  }
})
rec('③c 手机视口（390×780）：尾注仍在渐隐带之上',
  mobile.probed === true && mobile.clearOfFade === true, JSON.stringify(mobile))
rec('③c 手机视口：条目不横向溢出、页面不出现横向滚动条',
  mobile.probed === true && mobile.fitsWidth === true && mobile.bodyNoHScroll === true,
  JSON.stringify(mobile))
await page.setViewportSize({ width: 1440, height: 960 })
await page.waitForTimeout(300)

// ── ④ 没有恢复键（刻意，不是漏做）───────────────────────────────────────────────────────
const restoreInFolded = await page.locator('.lite-projects-folded button').count()
const toggleIsOnly = restoreInFolded === 1 // 只剩那个展开/收起 toggle 自己
rec('④ 「已并入」区里除了展开键没有任何按钮（**没有恢复键**——重判每次补传都跑，' +
    '手动放回来下次上传会被原样再折）', toggleIsOnly, `buttons=${restoreInFolded}`)

// 自证：归档抽屉那边**有**恢复键这件事仍然成立（证明上一条不是因为整个 CRUD 挂了）。
// 归档一张活卡 → 归档区出现 → 那里有恢复键 → 撤回。
const restoreShape = await page.evaluate(async (parent) => {
  const st = () => window.__lite2Store.getState()
  const card = (st().rawTeam?.projects ?? []).find((p) => p.title === parent)
  if (!card) return { seeded: false }
  await st().archiveProject(card.id)
  return { seeded: true, id: card.id }
}, PARENT)
await page.waitForSelector('.lite-projects-archived-toggle', { timeout: 8000 })
await page.locator('.lite-projects-archived-toggle').click()
await page.waitForSelector('.lite-project-card.is-archived', { timeout: 5000 })
const archivedRestores = await page.locator('.lite-project-card.is-archived .lite-project-restore').count()
rec('④ 自证：归档抽屉里**有**恢复键（所以上一条是这个区的语义，不是 CRUD 挂了）',
  restoreShape.seeded === true && archivedRestores === 1,
  `seeded=${restoreShape.seeded} restores=${archivedRestores}`)
// 两个区是划分：被折叠的三张一张都不许出现在归档抽屉里。
const archivedTitles = await page.$$eval('.lite-project-card.is-archived .lite-project-title',
  (ns) => ns.map((n) => n.textContent.trim()))
rec('④ 两个区是划分：被折叠的卡不出现在归档抽屉里',
  NESTED.every((t) => !archivedTitles.includes(t)), JSON.stringify(archivedTitles))

await browser.close()
const bad = R.filter((r) => !r.ok)
console.log(`\n${R.length - bad.length} PASS · ${bad.length} FAIL`)
if (bad.length) {
  console.log('FAILED:', bad.map((b) => b.n).join(' | '))
  process.exit(1)
}
