// onboarding 闸门页门（input-side-0721 · Danny 拍板：浮层 → 全屏闸门 + 一键示例团队进门）。
//
// ## 变更是什么
// OnboardWizard 浮层对话框 → OnboardGate 全屏闸门页（对齐 cr /companyinput 的 fixed inset-0
// 形态；LiteModal 底座不换，layerClassName=lite-gate-layer 承担整页观感）。步骤 4→5：新第 0 步
// 「三扇门」——①一键示例团队（POST /demo/claim 克隆预铸母本）②上传自己的材料 ③右上「先自己
// 逛逛」。8A：团队信息步新增「公司现状」口述，**送后端** company_notes（承诺文案同步改口）。
//
// ## 判据（两种世界不同答案；本门要离线后端带 AVERY_DEMO_SEED_DIR 才能跑世界 B/D）
//   A 全新访客：闸门以整页形态盖满视口、落在 doors 步、两扇门都在、滚动锁生效、
//     整个闸门 DOM 里不再有「不会发到任何地方」旧承诺（8A 之后它就是谎）。
//   B 示例团队门：点了真拿到克隆副本——contextId 落地、16 名中文代号各自成卡（#10 demo 车道，
//     rich-align-0722/07 三亚满态语料）、rawTeam.demo=true、预铸「实时」笔记继承、闸门关、
//     落 /home、onboard status=done。
//   C Escape=pause：门收起、status 停在 in-progress、step 保留、底下 shell 立即可用、
//     骨架里的示例团队第二机会位在场。
//   D 8A 延迟送出：走上传门但不传文件，填「公司现状」，走完 finish（此刻无 context、不送）；
//     再从骨架领示例 → contextId 落地的瞬间自动送达——后端 notes 最新一条是「来自初始设置」。
//   E 后端没 demo（路由拦截 /demo/status → 404）：示例门**一个像素都不出**（不出假按钮），
//     骨架的第二机会位同样不出。E 是"能力探测"的护栏：写死按钮的假修法在这里现形。
//
// ## 怎么跑
//   后端：AVERY_BRAIN=mock AVERY_EXTRACTOR=heuristic AVERY_EMBEDDINGS=keyword \
//         AVERY_DEMO_SEED_DIR=eval-harness/tests/fixtures/demo-seed uvicorn service.app:app --port 8137
//   前端：vite build（默认 base=127.0.0.1:8137）+ vite preview --port 5173
//   VERIFY_BASE=http://127.0.0.1:5173 node eval-harness/tools/verify-onboard-gate.mjs
import { chromium } from 'playwright'

const UI = process.env.VERIFY_BASE || 'http://127.0.0.1:5173'
const API = process.env.VERIFY_API || 'http://127.0.0.1:8137'
const R = []
const rec = (n, ok, d) => { R.push({ n, ok }); console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${n}${d ? ' — ' + d : ''}`) }

const browser = await chromium.launch({ headless: true })

async function freshPage(routeHook) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const page = await ctx.newPage()
  if (routeHook) await routeHook(page)
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(`${UI}/?v=2&mode=live&lang=zh`, { waitUntil: 'networkidle' })
  return { ctx, page, errors }
}

// ── 世界 A：全新访客——闸门是整页，不是浮窗 ─────────────────────────────────────────
{
  const { ctx, page, errors } = await freshPage()
  await page.waitForSelector('.lite-onboard', { timeout: 5000 })
  // 能力探测是异步的：等示例门出现（探测打通后 React 补渲染）。
  await page.waitForSelector('.lite-gate-door-demo', { timeout: 5000 }).catch(() => {})
  const a = await page.evaluate(() => {
    const layer = document.querySelector('.lite-modal-layer')
    const r = layer?.getBoundingClientRect()
    const gate = document.querySelector('.lite-onboard')
    return {
      layerIsGate: layer?.classList.contains('lite-gate-layer') ?? false,
      covers: r ? r.width >= innerWidth - 1 && r.height >= innerHeight - 1 : false,
      step: gate?.getAttribute('data-onboard-step'),
      doorDemo: document.querySelectorAll('.lite-gate-door-demo').length,
      doorUpload: document.querySelectorAll('.lite-gate-door-upload').length,
      browse: document.querySelectorAll('.lite-gate-browse').length,
      skip: document.querySelectorAll('.lite-onboard-skip').length,
      scrollLocked: document.body.style.overflow === 'hidden',
      oldLie: (gate?.innerText ?? '').includes('不会发到任何地方'),
      backdropOpaque: (() => {
        const bd = layer?.querySelector('.lite-modal-backdrop')
        if (!bd) return false
        const cs = getComputedStyle(bd)
        // 整页底：要么不透明纯色，要么带渐变图（aurora）——绝不再是压暗半透明玻璃。
        const m = cs.backgroundColor.match(/rgba?\(([^)]+)\)/)
        const alpha = m && m[1].split(',').length === 4 ? parseFloat(m[1].split(',')[3]) : 1
        return alpha >= 0.99 || cs.backgroundImage !== 'none'
      })(),
    }
  })
  console.log(`  世界A: ${JSON.stringify(a)}`)
  rec('A·层挂上闸门形态（lite-gate-layer）', a.layerIsGate)
  rec('A·闸门盖满整个视口（整页，不是浮窗）', a.covers)
  rec('A·落在三扇门步（doors）', a.step === 'doors')
  rec('A·示例团队门在场（离线后端配了 demo seed）', a.doorDemo === 1)
  rec('A·上传门在场', a.doorUpload === 1)
  rec('A·「先自己逛逛」可见退路在场', a.browse === 1)
  rec('A·「跳过设置」仍在（skip-forever 语义没丢）', a.skip === 1)
  rec('A·body 滚动锁生效（底下的世界不跟着滚）', a.scrollLocked)
  rec('A·背景是整页底，不是压暗玻璃', a.backdropOpaque)
  rec('A·闸门里不再有「不会发到任何地方」旧承诺', !a.oldLie)
  rec('A·无 pageerror', errors.length === 0, errors.slice(0, 2).join(' | ') || '0 条')
  await ctx.close()
}

// ── 世界 B：示例团队门——一键真拿到克隆副本 ─────────────────────────────────────────
{
  const { ctx, page, errors } = await freshPage()
  await page.waitForSelector('.lite-gate-door-demo', { timeout: 5000 })
  await page.locator('.lite-gate-door-demo').click()
  await page.waitForFunction(() => window.__lite2Store.getState().contextId !== null, null, { timeout: 15000 })
  await page.waitForTimeout(600)
  const b = await page.evaluate(() => {
    const s = window.__lite2Store.getState()
    const onboard = JSON.parse(localStorage.getItem('lite2:onboard:v1') || '{}')
    return {
      contextId: s.contextId,
      names: s.team?.people?.map((p) => p.name) ?? [],
      ids: s.team?.people?.map((p) => p.id) ?? [],
      demo: s.rawTeam?.demo === true,
      gateGone: !document.querySelector('.lite-onboard'),
      path: location.pathname,
      status: onboard.status,
      noteHead: s.notes?.[0]?.text ?? '',
    }
  })
  console.log(`  世界B: ${JSON.stringify({ ...b, noteHead: b.noteHead.slice(0, 24) })}`)
  rec('B·contextId 落地（克隆副本领到了）', typeof b.contextId === 'string' && b.contextId.length > 0)
  rec('B·三亚代号同事成卡且 16 人满态', b.names.includes('小王') && b.names.includes('小吴') && b.names.length === 16, `${b.names.length}人 · ${b.names.join('/')}`)
  rec('B·人卡 id 不撞（#10 的 demo 车道回归）', new Set(b.ids).size === b.ids.length, b.ids.join('/'))
  rec('B·payload 自报 demo 身份', b.demo)
  rec('B·闸门关了', b.gateGone)
  rec('B·落到指挥室（/home）', b.path.endsWith('/home'))
  rec('B·onboard 走完（status=done，下次不再弹）', b.status === 'done')
  rec('B·预铸「实时数据缺位」笔记跟着副本来了', b.noteHead.includes('实时'), b.noteHead.slice(0, 30))
  rec('B·无 pageerror', errors.length === 0, errors.slice(0, 2).join(' | ') || '0 条')
  await ctx.close()
}

// ── 世界 C：Escape = pause——门收起、进度保留、shell 立即可用 ─────────────────────────
{
  const { ctx, page, errors } = await freshPage()
  await page.waitForSelector('.lite-onboard', { timeout: 5000 })
  await page.keyboard.press('Escape')
  await page.waitForTimeout(700)
  const c = await page.evaluate(() => {
    const onboard = JSON.parse(localStorage.getItem('lite2:onboard:v1') || '{}')
    return {
      gateGone: !document.querySelector('.lite-onboard'),
      status: onboard.status,
      step: onboard.step,
      scrollFree: document.body.style.overflow === '',
      skeleton: document.querySelectorAll('[data-home-skeleton]').length,
      homeDemoBtn: document.querySelectorAll('.lite-home-demo-btn').length,
    }
  })
  console.log(`  世界C: ${JSON.stringify(c)}`)
  rec('C·Escape 收门', c.gateGone)
  rec('C·pause 语义：status 停在 in-progress（不是 skipped/done）', c.status === 'in-progress')
  rec('C·step 保留（下次续进度）', c.step === 'doors', c.step)
  rec('C·滚动锁释放', c.scrollFree)
  rec('C·底下就是指挥室骨架', c.skeleton === 1)
  rec('C·骨架里示例团队第二机会位在场', c.homeDemoBtn === 1)
  rec('C·无 pageerror', errors.length === 0, errors.slice(0, 2).join(' | ') || '0 条')
  await ctx.close()
}

// ── 世界 D：8A 延迟送出——先无处可送，context 一落地就送达 ──────────────────────────
{
  const { ctx, page, errors } = await freshPage()
  await page.waitForSelector('.lite-gate-door-upload', { timeout: 5000 })
  await page.locator('.lite-gate-door-upload').click()
  await page.waitForSelector('.lite-onboard[data-onboard-step="upload"]', { timeout: 3000 })
  await page.locator('.lite-onboard-next').click()   // upload →（不传文件）team
  await page.waitForSelector('.lite-onboard-companynote', { timeout: 3000 })
  const dTeam = await page.evaluate(() => ({
    hintMode: document.querySelector('.lite-onboard-field-hint')?.getAttribute('data-note-hint'),
    oldLie: (document.querySelector('.lite-onboard')?.innerText ?? '').includes('不会发到任何地方'),
  }))
  rec('D·无 context 时提示是「等工作区建好就发出」档', dTeam.hintMode === 'later')
  rec('D·团队信息步没有旧承诺', !dTeam.oldLie)
  await page.locator('.lite-onboard-companynote').fill('门自动化：公司做度假地产营销，回款周期在变长。')
  await page.locator('.lite-onboard-next').click()   // team → playbooks
  await page.locator('.lite-onboard-next').click()   // playbooks → done
  await page.waitForSelector('.lite-onboard-finish', { timeout: 3000 })
  await page.locator('.lite-onboard-finish').click()
  await page.waitForTimeout(500)
  const dAfterFinish = await page.evaluate(() => ({
    sentTo: JSON.parse(localStorage.getItem('lite2:onboard:v1') || '{}').companyNoteSentTo ?? null,
    gateGone: !document.querySelector('.lite-onboard'),
  }))
  rec('D·finish 时没有 context——诚实不送（账本为空）', Array.isArray(dAfterFinish.sentTo) && dAfterFinish.sentTo.length === 0)
  rec('D·finish 收门', dAfterFinish.gateGone)
  // 从骨架领示例 → contextId 落地 → 订阅线自动送出
  await page.waitForSelector('.lite-home-demo-btn', { timeout: 5000 })
  await page.locator('.lite-home-demo-btn').click()
  await page.waitForFunction(() => window.__lite2Store.getState().contextId !== null, null, { timeout: 15000 })
  await page.waitForFunction(() => {
    const saved = JSON.parse(localStorage.getItem('lite2:onboard:v1') || '{}')
    return (saved.companyNoteSentTo ?? []).length > 0
  }, null, { timeout: 8000 })
  const d = await page.evaluate(async (api) => {
    const s = window.__lite2Store.getState()
    const saved = JSON.parse(localStorage.getItem('lite2:onboard:v1') || '{}')
    let notes = []
    try {
      const r = await fetch(`${api}/team/${s.contextId}/notes`, { headers: { 'X-Avery-Token': s.ownerToken } })
      notes = (await r.json()).notes.map((n) => n.text)
    } catch { /* 下面按空数组打红 */ }
    // 🔴 判定在全文上做，展示才截断——首版先 slice(0,16) 再 includes('实时')，词还没出现
    // 就被剪掉了，绿产品被自己的门打红（门自伤，与产品无关）。
    return {
      sentMatches: saved.companyNoteSentTo?.[0] === s.contextId,
      hasPrecast: notes.some((t) => t.includes('实时')),
      notes: notes.map((t) => t.slice(0, 16)),
    }
  }, API)
  console.log(`  世界D: ${JSON.stringify(d)}`)
  rec('D·账本记的就是这份 context', d.sentMatches)
  rec('D·后端笔记本最新一条是「来自初始设置」（真送达，不是只记了账）',
    (d.notes[0] ?? '').startsWith('来自初始设置'), d.notes.join(' | '))
  rec('D·预铸笔记也在（送达没有覆盖预铸）', d.hasPrecast)
  rec('D·无 pageerror', errors.length === 0, errors.slice(0, 2).join(' | ') || '0 条')
  await ctx.close()
}

// ── 世界 E：后端没 demo——门与第二机会位一个像素都不出（能力探测护栏）───────────────
{
  const { ctx, page, errors } = await freshPage(async (p) => {
    await p.route('**/demo/status', (route) => route.fulfill({ status: 404, body: 'not here' }))
  })
  await page.waitForSelector('.lite-onboard', { timeout: 5000 })
  await page.waitForTimeout(800)   // 给探测失败一个落地窗口
  const e1 = await page.evaluate(() => ({
    doorDemo: document.querySelectorAll('.lite-gate-door-demo').length,
    doorUpload: document.querySelectorAll('.lite-gate-door-upload').length,
  }))
  rec('E·示例团队门不出（探测 404 ⇒ 不出假按钮）', e1.doorDemo === 0, JSON.stringify(e1))
  rec('E·上传门照常在（少一扇门不是塌整个门厅）', e1.doorUpload === 1)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(700)
  const e2 = await page.evaluate(() => ({
    homeDemoBtn: document.querySelectorAll('.lite-home-demo-btn').length,
    skeleton: document.querySelectorAll('[data-home-skeleton]').length,
  }))
  rec('E·骨架的第二机会位同样不出', e2.homeDemoBtn === 0 && e2.skeleton === 1, JSON.stringify(e2))
  rec('E·无 pageerror', errors.length === 0, errors.slice(0, 2).join(' | ') || '0 条')
  await ctx.close()
}

await browser.close()

const pass = R.filter((r) => r.ok).length
const fail = R.length - pass
console.log(`\n═══ onboarding 闸门页：${pass} PASS · ${fail} FAIL ═══`)
process.exit(fail ? 1 : 0)
