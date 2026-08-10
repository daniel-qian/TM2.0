// T9 · forms-proactive（gap2 战役，gh issue #58）—— 站内主动那条链的**真浏览器**门。
//
// 剧本（一条线走完，每一步都在真 DOM 上验，不看 store 内部）：
//   ① 传一份真语料造公司 → 手动铸一轮**上一期**的链接（经理亲手发起第一轮，这是设计）；
//   ② 重开资料库屏 → 服务端在读表单区那一下**自动把本期备好**（流量触发，不引 cron）；
//      判据落在屏幕上那句「已经按你上期发过的名单备好了（N 人）」+ 「谁交了」那段真多出几行；
//   ③ 铃铛长出一条 'form' 通知，点它跳「文件与表单」屏（NOTIF_TARGET 接线）；
//   ④ 员工真填一份 `/f/<token>` → 回来刷新 → 那一行变「已交」，铃铛再响一条；
//   ⑤ 撤回一条还没交的链接 → 那一行变「链接过期了」，且**再刷新也不会被自动补回来**
//      （否则经理点一次撤回、系统立刻发回来一条，无限循环）；
//   ⑥ 已交的那一行**没有**撤回按钮（答案是员工本人的话，按钮不该有机会碰它）。
//
// 🔴 自证判据（防空跑）：每一段主判据前面先断言"这一段真的在屏上"。本仓反复栽的是
//    「判据够不着 → 恒绿」——`for x in []` 全绿最骗人。
//
// 🔴 为什么走 `window.__lite2Store` 铸第一轮而不是点界面的选人 chip：界面那条路送的 person_id
//    取自人卡的 `personId`，而这份语料抽不出工号 → 送空串。本门要验的是「照抄上期的**名单与
//    绑定**」，名单必须能被逐条认出来，所以第一轮用 store action 显式带上工号。
//    ⚠ `__lite2Store` 是**无条件存在**的缝（`__AVERY_LITE2__` 那个是 import.meta.env.DEV 门控的，
//    build+preview 下整段被剪掉——AGENTS.md 易复发陷阱第三条）。
//
// 跑法：后端 `AVERY_BRAIN=mock` 起一个口，前端 build（带 VITE_AVERY_API_BASE 指向它）+ preview，
// 然后 `VERIFY_BASE=http://localhost:<口> node eval-harness/tools/verify-forms-proactive.mjs`。
// ⚠ preview 默认只绑 `::1`，起的时候要加 `--host`，否则写 127.0.0.1 的东西会以"连接被拒"假红。

import { chromium } from 'playwright'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..', '..')
const BASE = process.env.VERIFY_BASE || 'http://localhost:5173'
const API = process.env.VERIFY_API || 'http://127.0.0.1:8137'
const SHOTS = resolve(ROOT, 'eval-harness', 'tools', '.t9-shots')

// 新访客向导（`.lite-gate-layer`）的背板会拦掉一切点击。既有门里 `assertBellIsReal` 也是
// 先跳过它再验铃铛——这里照同一条路。找不到就什么都不做（向导只对新访客出现）。
async function dismissWizard(page) {
  const skip = page.locator('.lite-onboard-skip')
  for (let i = 0; i < 8; i++) {
    if ((await page.locator('.lite-gate-layer').count()) === 0) return
    // ⚠ 向导有入场动画：按钮在 DOM 里、但**还不可见**的那几百毫秒里，`force:true` 也点不动
    // （force 跳过的是可操作性检查，不是可见性）。等它真可见再点。
    if ((await skip.count()) && (await skip.first().isVisible())) {
      await skip.first().click()
    }
    await page.waitForTimeout(300)
  }
}

const results = []
const ok = (name, pass, detail = '') => {
  results.push({ name, pass, detail })
  console.log(`${pass ? '  PASS' : '  FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

// 上一期的周期串。故意用一个**铁定早于本期**的固定值：门不该自己再算一次 ISO 周
// （前端算周期是本票明令禁止的事，门里算一遍等于把那个错误示范写进仓库）。
const LAST_PERIOD = '2026-W01'

const CORPUS = `# 别墅酒店 · 运营周报

## 项目：宴会厅翻台
负责人：周雅
状态：有风险
进度：40%
到期日：2026年8月20日
阻塞：宴会厅翻台没压到 25 分钟，缺一个人。

## 项目：传菜动线改造
负责人：陈立
状态：正常
进度：70%
`

async function main() {
  mkdirSync(SHOTS, { recursive: true })
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  page.on('console', (m) => {
    if (m.type() === 'error') console.log('    [console.error]', m.text().slice(0, 200))
  })

  // 🔴 显式 `?lang=zh`：本仓的**默认壳是 EN**（i18n/index.ts:3「EN is the locked default」）。
  // 不写这个参数，下面每一条中文判据都会以「文案不对」的形态假红，而产品其实是好的——
  // 这正是我第一次跑这道门时踩到的。
  await page.goto(`${BASE}/?v=2&mode=live&lang=zh`, { waitUntil: 'networkidle' })
  await page.waitForFunction(() => !!window.__lite2Store, null, { timeout: 20000 })
  await dismissWizard(page)

  // ── ① 造公司 + 手动铸一轮"上一期" ───────────────────────────────────────────────────
  await page.evaluate(async (text) => {
    const file = new File([text], '运营周报.md', { type: 'text/markdown' })
    await window.__lite2Store.getState().uploadFiles([file])
  }, CORPUS)
  await page.waitForFunction(() => window.__lite2Store.getState().contextId, null, { timeout: 60000 })
  const contextId = await page.evaluate(() => window.__lite2Store.getState().contextId)
  ok('①a 语料真进了后端（拿到 contextId）', !!contextId, contextId?.slice(0, 18))

  // 先拉一次表单区，让内置「周报」模板按需铸出来（首次 GET 按需铸的先例）。
  await page.evaluate(() => window.__lite2Store.getState().refreshForms())
  await page.waitForFunction(
    () => (window.__lite2Store.getState().formTemplates || []).length > 0,
    null, { timeout: 20000 })

  // 手动铸上一期：两个人，其中一个绑项目。绑的项目名逐字取自语料里那张项目卡。
  const minted = await page.evaluate(async ({ cid, period, api }) => {
    const token = window.__lite2Store.getState().ownerToken
    const res = await fetch(`${api}/team/${cid}/forms/tpl_weekly/links`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Avery-Token': token },
      body: JSON.stringify({
        period,
        recipients: [
          { id: 'P-0007', name: '周雅', project_ref: '宴会厅翻台' },
          { id: 'P-0008', name: '陈立', project_ref: '' },
        ],
      }),
    })
    return res.ok ? await res.json() : { error: res.status }
  }, { cid: contextId, period: LAST_PERIOD, api: API })
  ok('①b 上一期两条链接铸出来了', minted?.links?.length === 2,
     minted?.error ? `HTTP ${minted.error}` : `period=${minted.period}`)

  // ── ② 重开资料库屏 → 服务端自动补铸本期 ──────────────────────────────────────────────
  await dismissWizard(page)
  await page.evaluate(() => window.__lite2Store.getState().goScreen('files'))
  // #84 · 资料库改成两栏 explorer 之后，常驻表单住在**它自己那一区**里（非当前分区整段
  // 不进 DOM，理由见 FilesScreen 文件头那段碑）。默认落点是「文件」，所以这里得真点一下
  // 左栏那一行。⚠ 不加这一步的红形态是「表单区整段不在」——看起来像功能没了。
  await page.locator('[data-files-zone="forms"]').click({ timeout: 20000 })
  await page.waitForSelector('.lite-files-forms', { timeout: 20000 })
  await dismissWizard(page)
  // 🔴 自证：表单区真的在屏上（四条否决里任何一条命中，整段消失，下面全部判据都够不着）。
  // #84 改判：段内那条 `<h3>` 标题在两栏 explorer 里是 `display:none`——分区名已经印在
  // 工作台页头上了（规格 §2.4.7「双标题收成一层」），段里再来一遍就是双标题。
  // 自证要盯的那件事一点没变（「表单区真的在屏上，下面全部判据不是空跑」），只是那句
  // 「常驻表单」现在住在页头里。两条一起断：页头说的是这一区 + 段落本体在场。
  const headText = await page.locator('.lite-files-pane .lite-files-title').innerText()
  const sectionCount = await page.locator('.lite-files-forms').count()
  ok('②a 自证 · 表单区真的渲染了（页头说的是这一区 + 段落本体在场）',
     headText.includes('常驻表单') && sectionCount === 1,
     `页头="${headText.trim()}" 段=${sectionCount}`)

  await page.waitForSelector('.lite-files-forms-autofilled', { timeout: 20000 })
  const banner = await page.locator('.lite-files-forms-autofilled').innerText()
  const bannerCount = await page.locator('.lite-files-forms-autofilled')
    .getAttribute('data-autofilled')
  ok('②b 屏上明示「按上期名单备好了（N 人）」', /上期/.test(banner) && bannerCount === '2',
     `count=${bannerCount} · ${banner.slice(0, 46)}…`)

  // 谁交了：本期两行，都还没交，且都是自动备好的。
  const statusRows = page.locator('.lite-files-forms-status-row')
  await page.waitForFunction(
    () => document.querySelectorAll('.lite-files-forms-status-row').length === 2,
    null, { timeout: 20000 })
  const names = await statusRows.locator('.lite-files-forms-status-name').allInnerTexts()
  // ⚠ 断言**集合**不断言顺序：`list_form_submissions` 排的是 (created_at DESC, id DESC)，
  // 而同一批自动铸出来的行共用一个 created_at，于是并列时退化成 uuid 序。断言顺序会得到一条
  // 间歇假红的门（这条是本门第一次跑时真抖出来的）。
  ok('②c 本期两个人都在「谁交了」里，且是上期那两位',
     [...names].sort().join('/') === ['周雅', '陈立'].sort().join('/'), names.join('/'))

  // 绑定照抄过来了：周雅那行说「关于 宴会厅翻台」，陈立那行什么都不写（absent≠none）。
  const projectCells = await page.locator('.lite-files-forms-status-project').allInnerTexts()
  ok('②d 上期的项目绑定被照抄过来（且没绑的不编一句）',
     projectCells.length === 1 && projectCells[0].includes('宴会厅翻台'),
     JSON.stringify(projectCells))

  // ⚠ 对着**那一段元素**直拍，不用 fullPage：这一屏有内部滚动容器，fullPage 只拍得到
  // 视口那一截，表单区在折线以下 —— 第一版就这么拍出了一张「什么都没有」的图，而门是绿的。
  // 人眼过 diff 要看的是那一段，不是壳。
  await page.locator('.lite-files-forms').scrollIntoViewIfNeeded()
  await page.locator('.lite-files-forms').screenshot({ path: resolve(SHOTS, '02-autofilled.png') })

  // ── ③ 铃铛：'form' 通知 + 点击跳屏 ────────────────────────────────────────────────────
  await page.locator('.lite-bell-toggle').click()
  await page.waitForSelector('.lite-bell-list', { timeout: 10000 })
  const formNotifs = page.locator('.lite-notif-item[data-notif-kind="form"]')
  const formCount = await formNotifs.count()
  ok('③a 铃铛长出了一条表单通知', formCount >= 1, `count=${formCount}`)
  if (formCount >= 1) {
    const text = await formNotifs.first().innerText()
    // 🔴 泛化文案红线：通知永不点名员工个人（结构上也没有携带人名的槽位）。
    ok('③b 通知文案不点名任何员工', !/周雅|陈立/.test(text), text.slice(0, 40))
    // 别的 kind 的文案不许被这条顶替（`default:` 兜底那个坑的形态就是印成「值得注意」）。
    ok('③c 通知说的是表单这件事，不是别的 kind 的文案', !/值得注意/.test(text),
       text.slice(0, 40))
    await page.evaluate(() => window.__lite2Store.getState().goScreen('room'))
    // ⚠ 弹层**不随切屏关闭**（LiteBell 刻意不做「点外即收」，理由在它的注释里）。所以这里不能
    // 无条件再点一次开关——那是把它关上。按 aria-expanded 判一次再决定，这条 aria 属性本身
    // 就是弹层开合的真源（`aria-expanded={open}`）。
    if ((await page.locator('.lite-bell-toggle').getAttribute('aria-expanded')) !== 'true') {
      await page.locator('.lite-bell-toggle').click()
    }
    await page.waitForSelector('.lite-bell-list', { timeout: 10000 })
    await formNotifs.first().click()
    await page.waitForTimeout(500)
    // ⚠ 当前屏在 **URL** 里，不在 store 里：`goScreen` 只是一次路由跳转（routes.ts 的
    // `navigateToScreen` → `SCREEN_PATH[screen]`）。读 `getState().screen` 会拿到 undefined，
    // 而 `undefined === 'files'` 为假 —— 一条以「跳错屏」形态假红的门。
    const path = await page.evaluate(() => window.location.pathname)
    ok('③d 点这条通知跳到「文件与表单」屏', path.includes('/files'), `path=${path}`)
    // #84 · 落屏还不够，得落到**那一区**：一条讲表单的通知把人扔在文件表格上，等于让他
    // 自己再找一次入口。判据落在**屏上真的渲染了表单区**，不是「URL 里有 zone=forms」
    // ——后者对着「参数带上了、组件没读」那种接错线照样全绿（显示值≠判据值的老规矩）。
    const landedForms = await page.locator('.lite-files-forms').count()
    const landedRow = await page.locator('[data-files-zone="forms"][data-current="1"]').count()
    ok('③e 🔴 而且落在**常驻表单**那一区（不是默认的文件区）',
       landedForms === 1 && landedRow === 1,
       `forms段=${landedForms} 左栏选中=${landedRow}`)
  }

  // ── ④ 员工真填一份 → 那一行变「已交」 ────────────────────────────────────────────────
  // ⚠ 只取**本期自动备好**的那两条。上一期手动铸的两条也仍是 `open`（7 天期还没到），
  // 光按 status 过滤会捞到四条 —— 那不是 bug，是这道门第一次写错了判据。
  const tokens = await page.evaluate(
    (period) => (window.__lite2Store.getState().formSubmissions || [])
      .filter((s) => s.status === 'open' && s.period !== period)
      .map((s) => ({ id: s.id, token: s.token, name: s.person_name, auto: s.auto })),
    LAST_PERIOD)
  ok('④a 自证 · 自动备好的行带着可填的 token 且标着 auto',
     tokens.length === 2 && tokens.every((t) => t.token) && tokens.every((t) => t.auto === true),
     JSON.stringify(tokens.map((t) => [t.name, t.auto])))

  const filler = await browser.newPage()
  await filler.goto(`${API}/f/${tokens[0].token}`, { waitUntil: 'networkidle' })
  await filler.fill('textarea[name="f_done"]', '晚市高峰传菜等位压到 6 分钟以内。')
  await filler.fill('textarea[name="f_missed"]', '宴会厅翻台还是差一个人。')
  await filler.fill('textarea[name="f_next_goal"]', '下周把动线改一版试跑。')
  // ⚠ 真实的单选控件是**视觉隐藏**的 input + 一枚 `.h5-btn` label（form_api._render_choice）。
  // `check()` 直接点 input 会以「元素不可见」超时——员工在手机上点的也是那枚 label。
  await filler.click('label[for="f_mood_1"]')
  await filler.click('button.h5-submit')
  await filler.waitForLoadState('networkidle')
  const thanks = await filler.locator('.h5-card').innerText()
  ok('④b 员工那头真的交上去了', /已收到/.test(thanks), thanks.slice(0, 24).replace(/\n/g, ' '))
  await filler.close()

  await page.evaluate(() => window.__lite2Store.getState().refreshForms())
  await page.waitForFunction(
    () => document.querySelectorAll(
      '.lite-files-forms-status-row[data-tone="ok"]').length === 1,
    null, { timeout: 20000 })
  const submittedRow = await page.locator('.lite-files-forms-status-row[data-tone="ok"]').innerText()
  ok('④c 那一行在经理屏上变成「已交」', submittedRow.includes(tokens[0].name),
     submittedRow.replace(/\n/g, ' ').slice(0, 50))

  // ⑥ 已交的那一行没有撤回按钮（判据就在这一行内部，不是全屏计数）。
  const voidOnSubmitted = await page
    .locator('.lite-files-forms-status-row[data-tone="ok"] .lite-files-forms-void').count()
  ok('⑥ 已交的那一行没有撤回按钮', voidOnSubmitted === 0, `count=${voidOnSubmitted}`)

  // ── ⑤ 撤回还没交的那一条 ─────────────────────────────────────────────────────────────
  const openRow = page.locator('.lite-files-forms-status-row[data-tone="open"]')
  const voidBtn = openRow.locator('.lite-files-forms-void')
  ok('⑤a 自证 · 还没交的那一行有撤回按钮', (await voidBtn.count()) === 1)
  await voidBtn.click()
  await page.waitForFunction(
    () => document.querySelectorAll(
      '.lite-files-forms-status-row[data-tone="warn"]').length === 1,
    null, { timeout: 20000 })
  const warnRow = await page.locator('.lite-files-forms-status-row[data-tone="warn"]').innerText()
  ok('⑤b 撤回后那一行变成「链接过期了」', /过期/.test(warnRow),
     warnRow.replace(/\n/g, ' ').slice(0, 50))

  // 🔴 关键判据：再刷一次，不许被自动补回来。撤回的行仍在库里，所以护栏认为"他本期已经有过
  //    链接"——否则经理点一次撤回、系统立刻发回来一条，无限循环。
  await page.evaluate(() => window.__lite2Store.getState().refreshForms())
  await page.waitForTimeout(800)
  const rowsAfter = await page.locator('.lite-files-forms-status-row').count()
  ok('⑤c 撤回的那条**没有**被自动补回来（不成死循环）', rowsAfter === 2, `rows=${rowsAfter}`)

  await page.locator('.lite-files-forms').scrollIntoViewIfNeeded()
  await page.locator('.lite-files-forms').screenshot({ path: resolve(SHOTS, '05-after-void.png') })

  // ── 今天页：本期还差人没交 ────────────────────────────────────────────────────────────
  // 这条规则要「最早的一条链接 48 小时内到期」才响。刚铸的链接是 7 天期，所以这里**不**断言
  // 它出现——断言一个按设计不该出现的东西是假门。改为断言两件真的：
  //   ① 今天页正常渲染（没被表单这条新管线打崩）；
  //   ② 决策卡里**没有**公司级表单卡（因为条件确实不满足），且项目卡照旧在。
  await page.evaluate(() => window.__lite2Store.getState().goScreen('home'))
  await page.waitForSelector('.lite-home-decision-list, [data-empty-kind]', { timeout: 20000 })
  // ⚠ 决策卡挂在 `rawTeam`（服务端原始载荷）上，不在 `team`（前端投影）上——HomeScreen 读的
  // 就是 `rawTeam?.decisions`。读错这一个字段名，得到的是一个空数组，而空数组会让下面 ⑦b 那条
  // 「表单卡不出现」**恒真**：一条对着空集合全绿的假门。⑦a 这条自证判据存在的理由就是它。
  const decisions = await page.evaluate(
    () => (window.__lite2Store.getState().rawTeam?.decisions || [])
      .map((d) => d.subject_type))
  ok('⑦a 自证 · 今天页拿到了决策卡（新管线没把它打崩）', decisions.length > 0,
     JSON.stringify(decisions))
  ok('⑦b 链接还有七天到期时，表单卡按设计不出现',
     !decisions.includes('forms'), JSON.stringify(decisions))

  await page.screenshot({ path: resolve(SHOTS, '07-home.png') })

  await browser.close()

  const failed = results.filter((r) => !r.pass)
  console.log(`\n${results.length - failed.length}/${results.length} PASS`)
  writeFileSync(resolve(SHOTS, 'results.json'), JSON.stringify(results, null, 2), 'utf-8')
  if (failed.length) {
    console.log('FAILED:', failed.map((f) => f.name).join(' · '))
    process.exit(1)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
