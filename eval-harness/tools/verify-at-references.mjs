// #64 · at-references 端到端门：@ 弹层（键盘）→ chip → **refs 真的到了 POST /advise 请求体**
// → 织文兜底在 → 悬浮胶囊中继整条链。
//
// ## 这道门防的是什么
// 本票最容易活下来的假实现是「UI 有 chip、请求体没 refs」——界面看着全好，后端拿到的还是
// 纯文本，保证注入整层空转。所以主判据**只认网络请求**（page.on('request') 抓 POST /advise
// 的 body），绝不落在 store 上——T10 的门洞教训：门驱动 store 还是真部件，决定它能不能看见
// 「接线」型 bug。这里从头到尾用真键盘打真输入框（pressSequentially / ArrowDown / Enter），
// store 只用来铺语料与换屏。
//
// ## 判据分段（每段带自证，防「判据够不着时假装通过」）
//   ⓪ 真上传中文语料（重名两位林小满 + 项目 + SOP 方法）→ 自证 contextId/双林都在。
//   ① 议事室 composer 打 `@林` 弹层：combobox aria 齐全；两位林小满**都带部门**（重名消歧）；
//      ↓ 键把高亮走到第二位；Enter 选中 = chip 是**客房部那一位**（证明高亮真在走，不是恒选第一）。
//   ② chip 的移除键键盘可达（focus + Enter），删掉后 chip 消失。
//   ③ 提交 → 抓 POST /advise：references=[person，id=选中那位的 id]；situation 同时织进了
//      「涉及：」+ 名字（新前端+旧后端窗口期的兜底就是这几个字）；问题原文也在。
//   ④ 无引用提交 → 请求体**没有 references 键**（additive 契约：absent≠[]）。
//   ⑤ 文件 tab：@ 空查询 + 点「文件」chip → 上传过的文件名在候选里（四类轴真的有第三类）。
//   ⑥ 悬浮胶囊：home 屏开胶囊 → `@别墅` 选项目 → 打问题 → Enter → 落到 /room 且 composer
//      预填了问题 + chip（EPHEMERAL q/refs 中继整条链）→ 提交 → 请求体带 project ref。
//   ⑦ Esc 分层：层开着 Esc 只关层（胶囊还在）；再 Esc 才收胶囊。
//
// ## 怎么跑
// 🔴 **上传型门**（真发 POST /ingest 造 context）；**绝不能排在 C 区之后**（dist 被 C 区
//    重打成生产域名后，任何上传都是往生产库写测试数据）。
//   后端：AVERY_BRAIN=mock AVERY_EXTRACTOR=heuristic AVERY_EMBEDDINGS=keyword uvicorn :8137
//   前端：vite build --mode development + vite preview --host --port 5173
//   VERIFY_BASE=http://localhost:5173 node eval-harness/tools/verify-at-references.mjs
// ⚠ 显式 `?lang=zh`：织文前缀「涉及：」是 zh 词——默认 EN 壳下这条判据会以文案不对假红。
import { bootPage, makeRec, finish } from './lib/gate-run.mjs'

const UI = process.env.VERIFY_BASE || 'http://127.0.0.1:5173'
const SEAM = '__lite2Store'
const { rows, rec } = makeRec()

const ROSTER = [
  '# 别墅酒店 员工花名册', '',
  '姓名 | 人员ID | 部门 | 职位 | 司龄',
  '周雅婷 | MKT-001 | 市场推广部 | 市场专员 | 3年',
  '林小满 | FO-0422 | 前厅部 | 前厅主管 | 2年',
  '林小满 | HK-0301 | 客房部 | 客房领班 | 4年',
].join('\n')
const PROJECT = ['# 别墅套餐推广', '负责人：周雅婷', '状态：受阻', '截止：2026-10-15', '进度：55%',
  '阻塞：雨季无备选场地'].join('\n')
const SOP = ['# 运营手册', '', '## 方法：客诉一次响应', '适用：前厅接到住客投诉的第一小时',
  '标签：前厅、客诉', '- 先道歉并复述问题'].join('\n')

const boot = await bootPage({ url: `${UI}/?v=2&mode=live&look=paper&lang=zh`, trackPageErrors: true })
const { browser, page, pageErrors } = boot

// 主判据的抓手：真的发出去的 POST /advise 请求体（网络层，不是 store）。
const advisePosts = []
page.on('request', (r) => {
  if (r.method() === 'POST' && /\/advise$/.test(new globalThis.URL(r.url()).pathname)) {
    try { advisePosts.push(JSON.parse(r.postData() || 'null')) } catch { advisePosts.push(null) }
  }
})
const waitForPosts = async (n, ms = 20000) => {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    if (advisePosts.length >= n) return true
    await page.waitForTimeout(100)
  }
  return false
}

// ── ⓪ 铺语料（store 只在这一段当搬运工；被测部件从①起全走真键盘）────────────────────────
await page.evaluate(async ({ files, seam }) => {
  const enc = new TextEncoder()
  await window[seam].getState().uploadFiles(
    files.map((f) => new File([enc.encode(f.text)], f.name, { type: 'text/markdown' })))
}, { files: [
  { name: '花名册.md', text: ROSTER },
  { name: '项目周报.md', text: PROJECT },
  { name: '运营手册.md', text: SOP },
], seam: SEAM })
await page.waitForFunction(
  (seam) => ['ready', 'error'].includes(window[seam].getState().ingestStatus), SEAM,
  { timeout: 45000 }).catch(() => {})
const base = await page.evaluate((seam) => {
  const st = window[seam].getState()
  const lins = (st.team?.people ?? []).filter((p) => p.name === '林小满')
  return {
    ingestStatus: st.ingestStatus,
    contextId: st.contextId,
    linCount: lins.length,
    linTeams: lins.map((p) => p.team ?? ''),
    houseId: lins.find((p) => p.team === '客房部')?.id ?? null,
    projectId: (st.team?.projects ?? []).find((p) => p.title.includes('别墅套餐'))?.id ?? null,
  }
}, SEAM)
rec('⓪ 自证：语料上传成功且两位林小满都在（重名消歧的前提）',
  base.ingestStatus === 'ready' && base.linCount === 2 && base.projectId !== null,
  JSON.stringify(base))

// ── ① 议事室 composer：@ 弹层 + 键盘选中 ─────────────────────────────────────────────────
await page.evaluate((seam) => window[seam].getState().goScreen('room'), SEAM)
await page.waitForTimeout(600)
const input = () => page.locator('.lite-room .nexus-followup-composer input[type="text"]')
rec('① 自证：议事室常驻 composer 在屏上', (await input().count()) === 1)

await input().click()
await input().pressSequentially('@林', { delay: 40 })
await page.waitForTimeout(300)
const menu = await page.evaluate(() => {
  const inp = document.querySelector('.lite-room .nexus-followup-composer input[type="text"]')
  const picker = document.querySelector('.lite-ref-picker')
  const opts = Array.from(picker?.querySelectorAll('[role="option"]') ?? []).map((o) => ({
    label: o.querySelector('.lite-ref-option-label')?.textContent ?? '',
    team: o.querySelector('.lite-ref-option-team')?.textContent ?? '',
    selected: o.getAttribute('aria-selected'),
  }))
  return {
    pickerIn: !!picker,
    role: inp?.getAttribute('role'),
    expanded: inp?.getAttribute('aria-expanded'),
    listboxIn: !!picker?.querySelector('[role="listbox"]'),
    filterChips: picker?.querySelectorAll('.lite-composer-filter').length ?? 0,
    opts,
  }
})
rec('① 打 @ 弹层开了，combobox aria 齐全（role/aria-expanded/listbox）',
  menu.pickerIn && menu.role === 'combobox' && menu.expanded === 'true' && menu.listboxIn,
  JSON.stringify({ role: menu.role, expanded: menu.expanded }))
rec('① 五个筛选 chip（全部/人员/项目/文件/方法）都在', menu.filterChips === 5,
  `filters × ${menu.filterChips}`)
rec('① 重名消歧：两位林小满都在候选里，且**各带部门**',
  menu.opts.filter((o) => o.label === '林小满').length === 2 &&
  menu.opts.filter((o) => o.label === '林小满').every((o) => o.team !== '') &&
  new Set(menu.opts.filter((o) => o.label === '林小满').map((o) => o.team)).size === 2,
  JSON.stringify(menu.opts))

await input().press('ArrowDown')
await input().press('Enter')
await page.waitForTimeout(200)
const picked = await page.evaluate(() => {
  const chip = document.querySelector('.lite-room .lite-ref-chip')
  const inp = document.querySelector('.lite-room .nexus-followup-composer input[type="text"]')
  return {
    chipLabel: chip?.querySelector('.lite-ref-chip-label')?.textContent ?? null,
    chipTeam: chip?.querySelector('.lite-ref-chip-team')?.textContent ?? null,
    chipId: chip?.getAttribute('data-ref-id') ?? null,
    inputValue: inp?.value ?? null,
    pickerGone: !document.querySelector('.lite-ref-picker'),
  }
})
rec('① ↓+Enter 选中的是**第二位**（客房部）——高亮真的在走，不是恒选第一条',
  picked.chipLabel === '林小满' && picked.chipTeam === '客房部' && picked.chipId === base.houseId,
  JSON.stringify(picked))
rec('① 选中后 @词 从文字里摘掉、层收起', picked.inputValue === '' && picked.pickerGone,
  JSON.stringify({ value: picked.inputValue, pickerGone: picked.pickerGone }))

// ── ② chip 移除键键盘可达 ────────────────────────────────────────────────────────────────
await page.locator('.lite-room .lite-ref-chip .lite-composer-remove').focus()
await page.keyboard.press('Enter')
await page.waitForTimeout(200)
rec('② 移除键 focus+Enter 删得掉 chip（键盘可达）',
  (await page.locator('.lite-room .lite-ref-chip').count()) === 0)

// ── ③ 提交 → refs 真的到了后端（主判据：网络请求体）─────────────────────────────────────
await input().pressSequentially('她这周的排班压力怎么样', { delay: 20 })
await input().pressSequentially('@客房', { delay: 40 })
await page.waitForTimeout(300)
await input().press('Enter') // 层开着：Enter=选中（唯一命中=客房部林小满）
await page.waitForTimeout(200)
const chipBack = await page.evaluate(() =>
  document.querySelector('.lite-room .lite-ref-chip .lite-ref-chip-label')?.textContent ?? null)
rec('③ 自证：chip 又选回来了（客房部林小满）', chipBack === '林小满', String(chipBack))
await input().press('Enter') // 层已收起：这一发才是提交
const gotFirst = await waitForPosts(1)
const post1 = advisePosts[0]
rec('③ POST /advise 请求体带 references=[{kind:person, id=客房部那位}]（判据落在网络上）',
  gotFirst && Array.isArray(post1?.references) && post1.references.length === 1 &&
  post1.references[0].kind === 'person' && post1.references[0].id === base.houseId &&
  post1.references[0].label === '林小满',
  JSON.stringify(post1?.references ?? null))
rec('③ 织文兜底在：situation 同时带问题原文 + 「涉及：」+ 名字（旧后端窗口期的全部机制）',
  gotFirst && typeof post1?.situation === 'string' &&
  post1.situation.includes('她这周的排班压力怎么样') &&
  post1.situation.includes('涉及：') && post1.situation.includes('林小满'),
  JSON.stringify(post1?.situation ?? null))

// ── ④ 无引用：请求体不带 references 键（additive，absent≠[]）───────────────────────────
await page.waitForTimeout(800)
await input().pressSequentially('下周谁最需要我搭把手', { delay: 20 })
await input().press('Enter')
const gotSecond = await waitForPosts(2)
const post2 = advisePosts[1]
rec('④ 无引用提交：请求体**没有** references 键', gotSecond && post2 && !('references' in post2),
  JSON.stringify(Object.keys(post2 ?? {})))

// ── ⑤ 文件 tab：四类候选轴的第三类真的有货 ──────────────────────────────────────────────
await input().pressSequentially('@', { delay: 40 })
await page.waitForTimeout(200)
await page.locator('.lite-ref-picker .lite-composer-filter', { hasText: '文件' }).click()
await page.waitForTimeout(200)
const fileOpts = await page.evaluate(() =>
  Array.from(document.querySelectorAll('.lite-ref-picker [role="option"] .lite-ref-option-label'))
    .map((n) => n.textContent))
rec('⑤ 「文件」tab 里能看到上传过的文件名', fileOpts.includes('项目周报.md'),
  JSON.stringify(fileOpts))
await input().press('Escape')
await page.evaluate(() => {
  const inp = document.querySelector('.lite-room .nexus-followup-composer input[type="text"]')
  if (inp) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(inp, '')
    inp.dispatchEvent(new Event('input', { bubbles: true }))
  }
})

// ── ⑥ 悬浮胶囊中继：q + refs 一起进屋 ───────────────────────────────────────────────────
await page.evaluate((seam) => window[seam].getState().goScreen('home'), SEAM)
await page.waitForTimeout(600)
rec('⑥ 自证：home 屏上悬浮胶囊在（room 屏上它刻意收起）',
  (await page.locator('.lite-ask-avery-pill').count()) === 1)
await page.locator('.lite-ask-avery-pill').click()
await page.waitForTimeout(300)
const pillInput = () => page.locator('.lite-ask-avery-form input[type="text"]')
await pillInput().pressSequentially('@别墅', { delay: 40 })
await page.waitForTimeout(300)
await pillInput().press('Enter') // 唯一命中：项目「别墅套餐推广」
await page.waitForTimeout(200)
const pillChip = await page.evaluate(() =>
  document.querySelector('.lite-ask-avery-form .lite-ref-chip')?.getAttribute('data-ref-chip') ?? null)
rec('⑥ 胶囊里选中项目变 chip', pillChip === 'project', String(pillChip))
await pillInput().pressSequentially('这个项目下一步怎么排', { delay: 20 })
await pillInput().press('Enter')
await page.waitForTimeout(800)
const relay = await page.evaluate(() => ({
  path: window.location.pathname,
  value: document.querySelector('.lite-room .nexus-followup-composer input[type="text"]')?.value ?? null,
  chipKind: document.querySelector('.lite-room .lite-ref-chip')?.getAttribute('data-ref-chip') ?? null,
  chipLabel: document.querySelector('.lite-room .lite-ref-chip .lite-ref-chip-label')?.textContent ?? null,
}))
rec('⑥ 中继链：落在 /room 且 composer 预填了问题 + project chip（只预填不自动发）',
  relay.path === '/room' && relay.value === '这个项目下一步怎么排' &&
  relay.chipKind === 'project' && (relay.chipLabel ?? '').includes('别墅套餐'),
  JSON.stringify(relay))
const postsBefore = advisePosts.length
await input().press('Enter')
const gotThird = await waitForPosts(postsBefore + 1)
const post3 = advisePosts[postsBefore]
rec('⑥ 胶囊带来的 refs 随提交进了请求体（project ref + 织文）',
  gotThird && Array.isArray(post3?.references) && post3.references[0]?.kind === 'project' &&
  post3.references[0]?.id === base.projectId &&
  post3.situation.includes('涉及：') && post3.situation.includes('别墅套餐推广'),
  JSON.stringify(post3?.references ?? null))

// ── ⑦ Esc 分层（胶囊）─────────────────────────────────────────────────────────────────────
await page.evaluate((seam) => window[seam].getState().goScreen('home'), SEAM)
await page.waitForTimeout(600)
await page.locator('.lite-ask-avery-pill').click()
await page.waitForTimeout(300)
await pillInput().pressSequentially('@林', { delay: 40 })
await page.waitForTimeout(200)
await pillInput().press('Escape')
await page.waitForTimeout(200)
const afterFirstEsc = await page.evaluate(() => ({
  picker: !!document.querySelector('.lite-ref-picker'),
  form: !!document.querySelector('.lite-ask-avery-form'),
}))
rec('⑦ 层开着 Esc 只关层，胶囊输入框还在', !afterFirstEsc.picker && afterFirstEsc.form,
  JSON.stringify(afterFirstEsc))
await pillInput().press('Escape')
await page.waitForTimeout(200)
rec('⑦ 再 Esc 才收胶囊（回到 pill 态）',
  (await page.locator('.lite-ask-avery-form').count()) === 0 &&
  (await page.locator('.lite-ask-avery-pill').count()) === 1)

rec('无 pageerror（整程零未捕获异常）', pageErrors.length === 0, JSON.stringify(pageErrors))

void rows
await finish({ rows }, { browser, label: '#64 at-references（@ 引用 → 网络请求体）', listFailures: true })
