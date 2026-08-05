// onboarding 闸门页门（input-side-0721 · Danny 拍板：浮层 → 全屏闸门 + 一键示例团队进门）。
//
// ## 变更是什么
// OnboardWizard 浮层对话框 → OnboardGate 全屏闸门页（对齐 cr /companyinput 的 fixed inset-0
// 形态；LiteModal 底座不换，layerClassName=lite-gate-layer 承担整页观感）。步骤 4→5：新第 0 步
// 「三扇门」——①一键示例团队（POST /demo/claim 克隆预铸母本）②上传自己的材料 ③右上「先自己
// 逛逛」。8A：团队信息步新增「公司现状」口述，**送后端** company_notes（承诺文案同步改口）。
//
// ## onboarding-accounts-0805 ③（ADR-0034 拍板 7/8/9）之后的形状
// 步骤从 doors→upload→team→playbooks→done 改成 doors→①intake→②tools→③scope→④prefs→
// ⑤account→done，持久化键升 v2；新增底部步骤 chips 与**预览模式**（自由步进、不落库、
// 不发请求、常驻横幅）。第⑤步在这份部署里**整步隐去**（本门的构建不带 VITE_SUPABASE_*，
// 与 AuthPanel 的双闸判据同源）——所以世界 G 顺带把「不出死按钮」这条也量了。
//
// ## 判据（两种世界不同答案；本门要离线后端带 AVERY_DEMO_SEED_DIR 才能跑世界 B/D）
//   A 全新访客：闸门以整页形态盖满视口、落在 doors 步、三扇门都在、滚动锁生效、
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
//   G 预览模式（拍板 8）：第三扇门进入 → 横幅常驻、chips 可点（自由步进）、账号步不在序里
//     （这份部署没配 Supabase）；在里面打字 → 退出预览 → **持久化键里一个字都没多**，
//     status 也没被改动。🔴 这条判据的价值全在最后半句：横幅上写着「不会保存」，
//     只断言横幅存在等于只验了那句话被印出来，没验它是真的。
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

// 一路点「下一步」直到落在目标步。🔴 不写死点击次数：步数会随部署的账号能力变
//（第⑤步可缺席），写死次数的门在"少一步"的部署上会点空、在"多一步"的部署上会走过头，
// 两种都表现为莫名其妙的选择器超时而不是一条能读懂的失败。
async function advanceTo(page, step, max = 8) {
  for (let i = 0; i < max; i++) {
    const now = await page.getAttribute('.lite-onboard', 'data-onboard-step')
    if (now === step) return true
    const next = page.locator('.lite-onboard-next')
    if (!(await next.count())) return false
    await next.click()
    await page.waitForTimeout(160)
  }
  return (await page.getAttribute('.lite-onboard', 'data-onboard-step')) === step
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
      doorPreview: document.querySelectorAll('.lite-gate-door-preview').length,
      badge: (document.querySelector('.lite-gate-badge')?.textContent ?? '').trim(),
      chipsOnDoors: document.querySelectorAll('.lite-onboard-chip').length,
      previewBanner: document.querySelectorAll('.lite-gate-preview-banner').length,
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
  rec('A·「先看看每一步」预览门在场（拍板 8 的入口）', a.doorPreview === 1)
  rec('A·头部结构化 badge 在场且非空', a.badge.length > 0, a.badge)
  rec('A·doors 步不出 chips（三扇门不是编号步）', a.chipsOnDoors === 0)
  rec('A·非预览态没有预览横幅（横幅不是常驻装饰）', a.previewBanner === 0)
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
    const onboard = JSON.parse(localStorage.getItem('lite2:onboard:v2') || '{}')
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
    const onboard = JSON.parse(localStorage.getItem('lite2:onboard:v2') || '{}')
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
  await page.waitForSelector('.lite-onboard[data-onboard-step="intake"]', { timeout: 3000 })
  // ①intake →（不传文件）②tools → ③scope。步名换了（upload/team → intake/scope），
  // 走法改成"点到目标步为止"，见 advanceTo 上的注释。
  const reachedScope = await advanceTo(page, 'scope')
  rec('D·五步向导走得到「确认管理范围」步', reachedScope)
  await page.waitForSelector('.lite-onboard-companynote', { timeout: 3000 })
  const dScope = await page.evaluate(() => ({
    hintMode: document.querySelector('.lite-onboard-field-hint')?.getAttribute('data-note-hint'),
    oldLie: (document.querySelector('.lite-onboard')?.innerText ?? '').includes('不会发到任何地方'),
    chipCurrent: document.querySelector('.lite-onboard-chip[data-chip-state="current"]')
      ?.getAttribute('data-step-id'),
    chipsDone: [...document.querySelectorAll('.lite-onboard-chip[data-chip-state="done"]')]
      .map((c) => c.getAttribute('data-step-id')),
  }))
  rec('D·无 context 时提示是「等工作区建好就发出」档', dScope.hintMode === 'later')
  rec('D·管理范围步没有旧承诺', !dScope.oldLie)
  // 🔴 断言 data-chip-state 而不是勾号/颜色：显示值与判据值分开（ownerNameRaw 模式旧账）。
  rec('D·当前 chip 指着 scope', dScope.chipCurrent === 'scope', String(dScope.chipCurrent))
  rec('D·走过的两步 chip 落 done', JSON.stringify(dScope.chipsDone) === JSON.stringify(['intake', 'tools']),
    JSON.stringify(dScope.chipsDone))
  await page.locator('.lite-onboard-companynote').fill('门自动化：公司做度假地产营销，回款周期在变长。')
  await advanceTo(page, 'done')
  await page.waitForSelector('.lite-onboard-finish', { timeout: 3000 })
  await page.locator('.lite-onboard-finish').click()
  await page.waitForTimeout(500)
  const dAfterFinish = await page.evaluate(() => ({
    sentTo: JSON.parse(localStorage.getItem('lite2:onboard:v2') || '{}').companyNoteSentTo ?? null,
    gateGone: !document.querySelector('.lite-onboard'),
  }))
  rec('D·finish 时没有 context——诚实不送（账本为空）', Array.isArray(dAfterFinish.sentTo) && dAfterFinish.sentTo.length === 0)
  rec('D·finish 收门', dAfterFinish.gateGone)
  // 从骨架领示例 → contextId 落地 → 订阅线自动送出
  await page.waitForSelector('.lite-home-demo-btn', { timeout: 5000 })
  await page.locator('.lite-home-demo-btn').click()
  await page.waitForFunction(() => window.__lite2Store.getState().contextId !== null, null, { timeout: 15000 })
  await page.waitForFunction(() => {
    const saved = JSON.parse(localStorage.getItem('lite2:onboard:v2') || '{}')
    return (saved.companyNoteSentTo ?? []).length > 0
  }, null, { timeout: 8000 })
  const d = await page.evaluate(async (api) => {
    const s = window.__lite2Store.getState()
    const saved = JSON.parse(localStorage.getItem('lite2:onboard:v2') || '{}')
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

// ── 世界 F：重新开始——满态后一键复位回闸门（rich-align-0722/09）──────────────────────────
// 🔴 与世界 C（Escape=pause，status 停在 in-progress、step 保留）**不冲突**：F 是**出厂重置**
//    （status 回 unseen、step 回 doors、context 锚清空、偏好回出厂），是不同世界不同断言。
//    freshPage 无痕开页 → hadContextOnLoad 冻在 false；claim 发生在开页之后，故重置后闸门经
//    selectWizardOpen 重弹（无需 forceOpen，保留 Escape 逃生门）。
{
  const { ctx, page, errors } = await freshPage()
  await page.waitForSelector('.lite-gate-door-demo', { timeout: 5000 })
  await page.locator('.lite-gate-door-demo').click()
  await page.waitForFunction(() => window.__lite2Store.getState().contextId !== null, null, { timeout: 15000 })
  await page.waitForTimeout(400)
  // 齿轮 → 第三行「重新开始」两击确认。
  await page.locator('.lite-settings-toggle').click()
  await page.waitForTimeout(150)
  await page.click('.lite-settings-restart')
  await page.waitForTimeout(180)
  await page.click('.lite-settings-restart')
  await page.waitForTimeout(600)
  const f = await page.evaluate(() => {
    const s = window.__lite2Store.getState()
    return {
      ctxId: s.contextId,
      anchor: localStorage.getItem('lite2:contextId:v1'),
      onboardKey: localStorage.getItem('lite2:onboard:v2'),
      gate: document.querySelectorAll('.lite-onboard').length,
      step: document.querySelector('[data-onboard-step]')?.getAttribute('data-onboard-step') || null,
      skeleton: document.querySelectorAll('[data-home-skeleton]').length,
    }
  })
  console.log(`  世界F: ${JSON.stringify(f)}`)
  rec('F·闸门重弹（重新开始把访客打回门厅）', f.gate > 0, `onboard=${f.gate}`)
  rec('F·闸门回 doors 步（出厂，非 pause 的 in-progress）', f.step === 'doors', `step=${f.step}`)
  rec('F·context 锚清空（lite2:contextId:v1 = null）', f.anchor === null, `anchor=${f.anchor}`)
  rec('F·store contextId 清空', f.ctxId === null, `ctxId=${f.ctxId}`)
  rec('F·onboard 键也清（出厂全清，非 pause 保留进度）', f.onboardKey === null, `onboard=${f.onboardKey}`)
  rec('F·首页骨架在闸门下', f.skeleton >= 1, `skeleton=${f.skeleton}`)
  rec('F·无 pageerror', errors.length === 0, errors.slice(0, 2).join(' | ') || '0 条')
  await ctx.close()
}

// ── 世界 G：预览模式（ADR-0034 拍板 8）──────────────────────────────────────────────────
// 🔴 这一整个世界存在的理由是最后那三条判据。「未填写的数据不会保存」是一句**承诺**，
// 而承诺是可以只被印出来的：只断言横幅在场，等于验证了那句话的排版，没验证它是真的。
// 所以流程是：进预览 → 在三个不同的持久化面上各留一笔（打字 / 勾工具 / 走到别的步）
// → 退出 → 读 localStorage，一个字都不许多。
{
  const { ctx, page, errors } = await freshPage()
  await page.waitForSelector('.lite-gate-door-preview', { timeout: 5000 })
  // 进预览之前先把"真实的持久状态"拍个照——退出后要逐字比对回来。
  const before = await page.evaluate(() => localStorage.getItem('lite2:onboard:v2'))
  await page.locator('.lite-gate-door-preview').click()
  await page.waitForSelector('.lite-gate-preview-banner', { timeout: 3000 })
  const g1 = await page.evaluate(() => {
    const gate = document.querySelector('.lite-onboard')
    const chips = [...document.querySelectorAll('.lite-onboard-chip')]
    return {
      step: gate?.getAttribute('data-onboard-step'),
      previewAttr: gate?.getAttribute('data-onboard-preview'),
      bannerText: (document.querySelector('.lite-gate-preview-text')?.textContent ?? '').trim(),
      exitBtn: document.querySelectorAll('.lite-gate-preview-exit').length,
      chipIds: chips.map((c) => c.getAttribute('data-step-id')),
      // 预览态下 chips 是 <button>（自由步进）；正常态下是 <span>。可点性本身是"我在哪个
      // 模式"的第二个可见证据，所以按标签名量，不按 class。
      chipsClickable: chips.every((c) => c.tagName === 'BUTTON'),
    }
  })
  console.log(`  世界G: ${JSON.stringify(g1)}`)
  rec('G·预览从第①步起（不是三扇门）', g1.step === 'intake', String(g1.step))
  rec('G·面板自报预览态（data-onboard-preview=on）', g1.previewAttr === 'on')
  rec('G·横幅在场且文案非空', g1.bannerText.length > 0, g1.bannerText.slice(0, 28))
  rec('G·横幅带「退出页面预览」', g1.exitBtn === 1)
  rec('G·chips 可点（自由步进）', g1.chipsClickable && g1.chipIds.length > 0, JSON.stringify(g1.chipIds))
  // 这份构建不带 VITE_SUPABASE_*，账号能力探测必然落空 → 第⑤步整步隐去，chips 只剩四个。
  // 这是「不出死按钮」的正面证据：一个点了没反应的 chip 与一个死按钮是同一件事。
  rec('G·没配 Supabase 时账号步整步隐去（chips 无 account）',
    !g1.chipIds.includes('account') && g1.chipIds.length === 4, JSON.stringify(g1.chipIds))

  // 在三个不同的持久化面上各留一笔。
  // 🔴 每一笔都**当场**自证，不攒到最后一起量：首版就是攒到最后的，于是"工具真的被勾上了"
  // 这条在 scope 步上采样——那一屏根本没有 .lite-onboard-tool，恒为 0，把自证判据自己打红了。
  // 「采错屏」是验证器撒谎的十形态之一，这次它咬的是自证判据本身（该来的总会来）。
  await page.locator('.lite-onboard-chip[data-step-id="tools"]').click()
  await page.waitForSelector('.lite-onboard-tool', { timeout: 3000 })
  await page.locator('.lite-onboard-tool[data-tool-id="feishu"]').click()
  await page.waitForTimeout(120)
  const gTool = await page.evaluate(() => ({
    on: document.querySelectorAll('.lite-onboard-tool.is-on').length,
    pressed: document.querySelector('.lite-onboard-tool[data-tool-id="feishu"]')
      ?.getAttribute('aria-pressed'),
  }))
  rec('G·自证 1/2：工具真的被勾上了（在 tools 屏上量）',
    gTool.on > 0 && gTool.pressed === 'true', JSON.stringify(gTool))

  await page.locator('.lite-onboard-chip[data-step-id="scope"]').click()
  await page.waitForSelector('.lite-onboard-companynote', { timeout: 3000 })
  const g2 = await page.evaluate(() => ({
    hintMode: document.querySelector('.lite-onboard-field-hint')?.getAttribute('data-note-hint'),
  }))
  rec('G·预览态下「公司现状」提示改口成"哪儿也不去"', g2.hintMode === 'preview', String(g2.hintMode))
  await page.locator('.lite-onboard-companynote').fill('预览态里打的字：这段话一个字都不该被存下来。')
  await page.locator('.lite-onboard-company').fill('预览公司')

  const g3 = await page.evaluate(() => ({
    typed: document.querySelector('.lite-onboard-companynote')?.value ?? '',
    company: document.querySelector('.lite-onboard-company')?.value ?? '',
  }))
  rec('G·自证 2/2：字真的打进去了（否则下面的"没落盘"是空真）',
    g3.typed.includes('一个字都不该被存下来') && g3.company === '预览公司',
    `typed=${g3.typed.length} company=${g3.company}`)

  await page.locator('.lite-gate-preview-exit').click()
  await page.waitForTimeout(500)
  const g4 = await page.evaluate((prev) => {
    const raw = localStorage.getItem('lite2:onboard:v2')
    const saved = JSON.parse(raw || '{}')
    const gate = document.querySelector('.lite-onboard')
    return {
      unchanged: raw === prev,
      companyNote: saved.companyNote ?? '',
      company: saved.company ?? '',
      tools: saved.tools ?? [],
      status: saved.status ?? null,
      previewAttr: gate?.getAttribute('data-onboard-preview') ?? null,
      step: gate?.getAttribute('data-onboard-step') ?? null,
      banner: document.querySelectorAll('.lite-gate-preview-banner').length,
      liveCompanyField: document.querySelector('.lite-onboard-company')?.value ?? null,
    }
  }, before)
  console.log(`  世界G-退出: ${JSON.stringify(g4)}`)
  // 🔴 退出预览 ≠ 关掉闸门。这个访客还没做过 onboarding（status=in-progress、无 context），
  // 闸门本来就该在——把他扔进一个空指挥室才是 bug。退出预览要回到的是**进预览前那一刻**：
  // 预览标记落 off、横幅消失、步骤退回三扇门。（有数据的老客户从 Playbooks 屏进预览时，
  // hadContextOnLoad 为真、selectWizardOpen 返回 false，退出即收门——那是另一条路径。）
  rec('G·退出后不再是预览态', g4.previewAttr === 'off', String(g4.previewAttr))
  rec('G·退出后横幅消失', g4.banner === 0)
  rec('G·退出后退回进预览前那一步（doors）', g4.step === 'doors', String(g4.step))
  rec('G·预览里打的字一个都没落盘', g4.companyNote === '' && g4.company === '',
    `note=${g4.companyNote.slice(0, 12)} company=${g4.company}`)
  rec('G·内存态也被还原（不只是没写盘）', g4.liveCompanyField !== '预览公司',
    `field=${g4.liveCompanyField}`)
  rec('G·预览里勾的工具一个都没落盘', Array.isArray(g4.tools) && g4.tools.length === 0,
    JSON.stringify(g4.tools))
  rec('G·预览没有把 status 改掉（一次浏览不替用户做决定）',
    g4.status !== 'done' && g4.status !== 'skipped', String(g4.status))
  rec('G·持久化键逐字未变', g4.unchanged, `before=${String(before).slice(0, 40)}`)
  rec('G·无 pageerror', errors.length === 0, errors.slice(0, 2).join(' | ') || '0 条')
  await ctx.close()
}

await browser.close()

const pass = R.filter((r) => r.ok).length
const fail = R.length - pass
console.log(`\n═══ onboarding 闸门页：${pass} PASS · ${fail} FAIL ═══`)
process.exit(fail ? 1 : 0)
