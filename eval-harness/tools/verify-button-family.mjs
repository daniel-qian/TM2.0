// 按钮族门（cr-align 视觉战役棒4 · 2026-07-21）。
//
// ## 缺陷是什么
// lite2 的按钮样式是「枚举选择器列表」模式（lite2.css l.3809 三选择器 + 各处散规则）——
// 谁没进列表谁裸奔（棒1 的「加到待办」裸浏览器默认按钮正是此病）。棒4 立 .lite-btn
// 组件族（primary/ghost/soft/danger 四变体 + 统一焦点环），本门看守结构不变量：
// **.lite2-shell 下每个可见 <button> 要么挂 .lite-btn，要么命中显式白名单**
// （tab/齿轮/开关/背景/卡片/计数格/门卡/文字链/勾选/chip/列表项——它们不是「普通按钮」，
// 各有专属语法）。未来新屏加一个裸按钮，这里立刻红。
//
// ## 两种世界
//   棒4 前：.lite-btn 挂载数=0，全部普通按钮未命中 → 红（旧构建红证明）。
//   棒4 后：普通按钮全挂族、白名单外零漏网 + .lite-btn 总数 ≥15（防「白名单塞满」式作弊）→ 绿。
//   未来世界：新裸按钮 → 该屏红。
//
// ## 怎么跑
//   VERIFY_BASE=http://localhost:5173 node eval-harness/tools/verify-button-family.mjs
// 迁自票 #16：boot/上报/收尾管线搬进 lib/gate-run.mjs，断言判据一字未改。
// 本门是分歧台账里的模式⑤(b)——一个 browser + 一个 context/page 用到底；
// 且是分歧③的反例：bootPage 传 dismissOnboard:false，Escape 前奏推迟到下面
// 「审完闸门页按钮」那段断言逻辑自己去按（判断条件比通用助手多一项，见下方注释）。
import { bootPage, makeRec, finish } from './lib/gate-run.mjs'

const UI = process.env.VERIFY_BASE || 'http://localhost:5173'
const gateRec = makeRec()
const rec = gateRec.rec

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

// files-hub-0729/01 · 'files' 追加在末尾：这个数组是「哪些屏会被采样」的唯一名单，
// 漏掉一屏不会红、只会**永远不采样它**（假绿）。资料库屏是 t.upload.* 那 38 个键在
// 07-29 之后唯一的落屏点（上传面板已从团队屏撤走），漏了等于整族文案无人扫。
// #63（merge-closerlook）· 'closerlook' 出列：屏已退休，对照卡（.lite-gap-* 按钮族）并进
// home 的差距摘要块——那些按钮全员 .lite-btn，家族审计口径不变。
const V2_SCREENS = ['home', 'team', 'projects', 'room', 'followups', 'notes', 'playbooks', 'vision', 'files']

// 白名单=「不是普通按钮」的族（作战地图 r4-recon-map.md 第 1 节逐个定性）。
// 纪律：往这里加条目前先问「它真有专属语法吗」——白名单膨胀=门失效。
const WHITELIST = [
  '.scene-tab', '.lite-settings-toggle', '.lang-switch-btn', '.look-switch-btn', '.mode-switch-btn',
  '.lite-bell-toggle', '.lite-auth-toggle', '.lite-notif-item',
  '.lite-modal-backdrop', '.lite-gate-door', '.lite-onboard-playbook',
  '.ask-recipient-chip', '.icon-button', '.composer-add-button',
  '.lite-composer-filter', '.lite-composer-option', '.lite-composer-remove',
  '.lite-search-option',
  '.lite-home-block-link', '.lite-home-todo-check', '.lite-home-gap-title',
  '.lite-home-count-cell', '.lite-home-attention-name',
  // 棒D 差距面板三态筛选 chip（活跃/已厘清/已搁置）。与 .lite-room-chip / .ask-recipient-chip /
  // .lite-composer-filter 同属"筛选/切换 chip"白名单类目。🔴 对抗审查逮到：门的种子语料
  // 零阻塞行 → deriveGaps 出 0 张卡 → chip 整块不渲染 → 从不进审计（假绿）。加载真验收语料
  // （.issues/layout-real-0722/acceptance-corpus/）后 chip 才渲染，此白名单条目才真正生效。
  '.lite-home-gap-chip',
  // rich-align-0722/04 · team 目录形态的组别/情绪筛选 chip——与 .lite-home-gap-chip 同属
  // "筛选/切换 chip"白名单类目（非普通动作按钮，切换筛选态，有专属 pill 语法 + aria-pressed）。
  '.lite-team-filter-chip',
  '.home-person-card', '.home-people-group-head', '.home-check', '.home-map-card-link',
  '.home-drawer-toggle', '.home-project-card',
  '.lite-project-card', '.lite-followup-check', '.lite-followups-subtab',
  // #48 · 卡片标题按钮：整卡从单 <button> 改「div 容器+内部多按钮」后，键盘/读屏的开详情
  // 路径落在这个刻意无壳的标题按钮上（继承卡内排版,专属语法=focus-visible 描边）。
  // 原 .lite-project-card/.home-person-card 白名单条目描述的"整卡即按钮"形态已由它接棒。
  '.lite-card-open',
  '.lite-flow-toggle', '.lite-flow-cites-toggle', '.lite-room-chip',
  '.lite-gap-project-link', '.lite-gap-history-toggle',
  '.lite-notes-entry-source', '.lite-notes-group-head',
  // issue #80 · 议事室会话侧栏的一行 = 一场对话。与 .lite-notes-group-head /
  // .home-people-group-head / .lite-followups-subtab 同属白名单既有的**列表项**类目：
  // 它有自己的专属语法（两行式排版、10px 圆角、is-current 的 accent 软底、生成中 disabled），
  // 不是「普通动作按钮」。
  // 🔴 这条不是为了让门闭嘴——它此前**从来没被审过**：#78 时代它只在弹出面板打开时才存在，
  //    而这道门从不点开那个面板。#80 把面板改成常显侧栏，它第一次进入下面 AUDIT_FN 的审计面：
  //    本门在 :127-134 真发了一问并等到 complete，RoomScreen 随即 refreshAdviseThreads，
  //    于是轮到 `room` 屏受审时侧栏里**确实有一行**。少这一条，[room] 那条判据当场变红。
  //    （拆掉本条 = 一条现成的变异，回执里逐条跑过。）
  '.lite-room-history-head',
]

const AUDIT_FN = `((whitelist) => {
  const out = { total: 0, family: 0, whitelisted: 0, naked: [] }
  const sel = whitelist.join(', ')
  for (const b of document.querySelectorAll('.lite2-shell button')) {
    const r = b.getBoundingClientRect()
    const cs = getComputedStyle(b)
    if (r.width === 0 || r.height === 0 || cs.visibility === 'hidden' || cs.display === 'none') continue
    out.total++
    if (b.classList.contains('lite-btn')) { out.family++; continue }
    if (b.matches(sel)) { out.whitelisted++; continue }
    out.naked.push({ cls: String(b.className).slice(0, 60) || '(无类名)', text: (b.innerText || '').trim().slice(0, 12) })
  }
  return out
})`

const { browser, page, pageErrors } = await bootPage({
  base: UI, path: '/?v=2&mode=live&lang=zh', trackPageErrors: true, dismissOnboard: false,
})

// 闸门页自己的按钮先审一轮（它在 Escape 前渲染，是新访客第一眼）。
// 🔴 下面这段自己按 Escape，不走 dismissOnboard() 助手——它的判断条件是
// `.lite-onboard, .lite-gate-layer`（比助手多一个 .lite-gate-layer），是断言逻辑本身
// 的一部分（审完闸门页按钮才关闸），原样保留，不套用通用 Escape 前奏。
if (await page.locator('.lite-onboard, .lite-gate-layer').count()) {
  const gate = await page.evaluate(`(${AUDIT_FN})(${JSON.stringify(WHITELIST)})`)
  rec(`闸门页零裸按钮（${gate.total} 可见：族 ${gate.family} + 白名单 ${gate.whitelisted}）`,
    gate.naked.length === 0, gate.naked.map((n) => n.cls).join(' | '))
  await page.keyboard.press('Escape')
  await page.waitForTimeout(600)
}

// 满世界（按钮最多的世界：决策卡按钮/待办操作行/触发 chip 都要在场）。
await page.evaluate(async (doc) => {
  const enc = new TextEncoder()
  const f = new File([enc.encode(doc)], 'w33-weekly.md', { type: 'text/markdown' })
  await window.__lite2Store.getState().uploadFiles([f])
}, SEED_DOC)
await page.waitForFunction(
  () => ['ready', 'error'].includes(window.__lite2Store.getState().ingestStatus),
  undefined, { timeout: 30000 },
)
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
await page.waitForTimeout(400)

let familyTotal = 0
for (const sc of V2_SCREENS) {
  await page.evaluate((s) => window.__lite2Store.getState().goScreen(s), sc)
  await page.waitForTimeout(350)
  // home 顺路打开铃铛/设置弹层，把弹层里的按钮也纳入审计（其余屏保持关闭态）。
  if (sc === 'home') {
    await page.locator('.lite-bell-toggle').click().catch(() => {})
    await page.locator('.lite-settings-toggle').click().catch(() => {})
    await page.waitForTimeout(250)
  }
  const a = await page.evaluate(`(${AUDIT_FN})(${JSON.stringify(WHITELIST)})`)
  familyTotal += a.family
  rec(`[${sc}] 零裸按钮（${a.total} 可见：族 ${a.family} + 白名单 ${a.whitelisted}）`,
    a.naked.length === 0,
    a.naked.slice(0, 4).map((n) => `${n.cls}「${n.text}」`).join(' | '))
  if (sc === 'home') {
    await page.keyboard.press('Escape')
    await page.waitForTimeout(150)
  }
}

// 防作弊断言：族真的铺开了（把普通按钮全塞白名单也能骗过上面的逐屏检查——总量这里兜住）。
rec(`.lite-btn 族挂载总量 ≥15（九屏累计，实测 ${familyTotal}）`, familyTotal >= 15)
rec('无 pageerror', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | ') || '0 条')

await finish(gateRec, { browser, label: '按钮族' })
