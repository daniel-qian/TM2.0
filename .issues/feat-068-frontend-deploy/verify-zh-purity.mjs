#!/usr/bin/env node
// 中文站逐屏「拉丁残留」探针 —— 两条线的门中间那个洞的补丁。
//
// 为什么这个门必须单独存在（0719 收尾时用它逮到一条**当时正跑在线上**的缺陷）：
//
//   · 部署线的门查的是**打包产物**里有没有已知英文句子（'WORTH A CLOSER LOOK' 一类的
//     grep 名单）。`blocked` / `done` 是后端状态枚举 token，不是句子，名单里没有它们。
//   · 对齐线的门查的是**行为**（刷新还在、后退不掉出、缺状态不编成 on-track），断言读的是
//     store 字段。屏幕上那个词是中文还是英文，它不看 —— 它的 S1 证据行里甚至明明白白
//     打着 frontendStatus: ["blocked", ...]，门照样绿。
//
//   ⇒ 两个门都绿，而中文客户在「你的团队」首屏和项目详情里读到的是光秃秃的 `blocked`。
//     修法见 src/shared/projectStatus.ts。
//
// 判据不是「有没有拉丁字母」——项目名、文件格式名（PDF/Excel）、品牌名 Avery 都合法。
// 本脚本只负责**把可疑串捞出来给人判**，不自动判定拉丁串的通过/失败。
// 硬失败只有两条：
//   ① pageerror 非空；
//   ② 议事室对话流采样时是**空的**（feat-069 加的，理由见下面 ROOM_SCRIPTS 那一段）——
//      屏幕上什么都没有的时候报「干净」，是这个门此前放过六句英文的确切机制。
//
// 怎么跑（与 .issues/v02-partner-align-0718/verify-p0.mjs 同一套前置）：
//   1) cd eval-harness && AVERY_BRAIN=stub python -m uvicorn service.app:app --port 8137
//   2) 前端起在 5173（端口必须是 5173，后端 CORS 是精确匹配列表）
//   3) node .issues/feat-068-frontend-deploy/verify-zh-purity.mjs
import { chromium } from 'playwright'

const UI = process.env.VERIFY_BASE || 'http://127.0.0.1:5173'
const V2_SCREENS = ['home', 'team', 'projects', 'room', 'followups', 'notes', 'closerlook', 'playbooks', 'vision']

// 允许出现的拉丁串：品牌名 / 文件格式专名 / 单位。命中这些的不计入。
// 对抗复审 fixA1：找回 07-19 fixB 的上传清单状态渲染后，「支持哪些格式」那句补充说明
// （t.upload.acceptedExts）第一次真的显示在 /team 屏上——此前这个键存在但没有任何组件
// 渲染它，所以 DOCX 这个格式专名从没被本门扫到过。补进允许名单，和已有的 PDF/CSV/XLSX/MD
// 同一类（文件格式专名，不是英文残留），不是放宽判据。
// partner-docs-0728 追加四个：`DPA` / `NDA` 是两份协议**自己的名字**（中文里没有别的叫法，
// 同 PDF/XLSX 一类）；`KB` 是文件大小单位（`MB` 早就在表里，只是这批文件都小于 1 MB 才第一次
// 撞上）；`TLS` 是协议名（DPA 附件一「全链路采用 TLS 加密传输」）。
// 🔴 只加真的没有中文写法的专名。同一批里 `App`→「产品」、`HR`→「人事」是**改文案**解决的，
// 没有塞进这张表——放宽纯度门去迁就一句能改好的中文，是把门本身花掉。
const ALLOW = /^(Avery|Esc|W\d+|\d+%|v\d+|MB|KB|PDF|CSV|XLSX|DOCX|TSV|TXT|MD|OK|Word|Excel|Markdown|DPA|NDA|TLS)$/i

const DOC = [
  '# 三亚鹿山雅居 · 周报 W29', '',
  '## 项目：别墅交付验收', '负责人：李明',
  '阻碍项：佣金测算卡住，等财务确认', '进度：本月无法完成', '',
  '## 项目：渠道合作拓展', '负责人：王芳', '',
  '## 项目：客服体系搭建', '负责人：陈思雨', '进度：已完成', '',
].join('\n')

// ── feat-069 · 议事室对话流：**真跑一次**再采样 ────────────────────────────────
//
// 🔴 这一段存在的理由，就是这个门自己曾经的盲区：
//    上面的逐屏采样访问 `/room` 时报「干净」，**因为它从不发起一次运行**——run.status 停在
//    idle，屏幕上只有空态提问框，对话流一行都没有。而那六句硬编码英文
//    （'The read is ready' / 'Done' / 'Something went wrong reaching the room.' …）
//    只在**跑起来之后**才逐条冒出来。于是：门绿、客户看到英文。
//    与 `ownerName ?? 'Unassigned'` 是同一个结构类：**门看的那一屏，恰好是缺陷不在的那一屏。**
//
// ⇒ 所以下面不是"多测一屏"，而是把屏幕**推进到缺陷所在的状态**再采样。
//
// 怎么驱动：不打真 /advise（stub 后端不会吐 nudge / ask-draft / error 这几路事件，
// 而那正是六句里四句的来源），改用 store 自带的 `setTransport()` 测试缝
// （store.ts:302 原话「AFK 门注入确定性 stub」；verify-data-boundary.mjs 已有同款用法），
// **只顶替 streamAdvise 一个方法**，其余方法保持真实——上传/笔记/context 链路不受影响。
// 事件脚本覆盖全部六个 code，缺一个都会让对应那句话继续裸奔。
const ROOM_ADVICE = {
  summary: '佣金测算卡在财务确认，交付节点因此后移。',
  detected_signals: ['周报连续两周把佣金测算列为阻碍项'],
  diagnosis_hypotheses: [{ label: '跨部门确认链路没人推', kind: 'primary' }],
  evidence: ['阻碍项：佣金测算卡住，等财务确认'],
  recommended_actions: ['找财务把测算口径当面对一遍'],
  confidence: { level: 'medium', rationale: '只有周报一处来源', wouldChange: ['财务侧的说法'] },
  escalation: { level: 'none', note: '', confirmWith: [] },
  metrics_to_track: ['交付验收完成日期'],
  conversation_script: '这周想跟你确认一下佣金测算卡在哪一步。',
}

// 三段脚本 —— 一次运行只能有一个收尾（complete / error），所以拆开跑。
// 覆盖矩阵（六个 code 一个不落）：
//   ① nudge-redline · nudge-chain · ask-drafted · advice-ready
//   ② advice-done（manifest 不带 advice）
//   ③ stream-failed（error 帧；且刻意不带 error 详情，走新的 `?? null` 分支）
const ROOM_SCRIPTS = [
  {
    name: '① 推回重找依据 → 快问草稿 → 判读就绪',
    codes: ['nudge-redline', 'nudge-chain', 'ask-drafted', 'advice-ready'],
    events: [
      { type: 'started' },
      // 后端/模型原文：**必须原样透传**，本门顺带守住"没有把客户自己的话也翻译掉"。
      { type: 'think', text: '先看这周周报里被标成阻碍项的那几条。' },
      { type: 'tool', name: 'read_case', input: { case_id: 'w29' } },
      { type: 'observe', observation: '三亚鹿山雅居 · 周报 W29：阻碍项：佣金测算卡住，等财务确认' },
      { type: 'nudge', gate: 'redline' },
      { type: 'nudge', gate: 'chain' },
      { type: 'tool', name: 'cite', input: { claim: '佣金测算卡住', source_ref: 'w29.md:5' } },
      { type: 'observe', observation: '✓ cited: «佣金测算卡住» ⟵ w29.md:5  (阻碍项：佣金测算卡住，等财务确认)' },
      {
        type: 'manifest',
        kind: 'ask-draft',
        ask: {
          id: 'ask-zh-purity-1',
          status: 'draft',
          questions: [{ id: 'q1', kind: 'scale', text: '这周推进得顺吗？' }],
          recipients: [{ id: 'r1', name: '李明' }],
        },
      },
      { type: 'manifest', advice: ROOM_ADVICE },
    ],
  },
  {
    name: '② 跑完但没出判读（Done 行）',
    codes: ['advice-done'],
    events: [
      { type: 'started' },
      { type: 'think', text: '这份材料里没找到足够下判断的依据。' },
      { type: 'manifest' },
    ],
  },
  {
    name: '③ 流断在半路（失败行）',
    codes: ['stream-failed'],
    events: [
      { type: 'started' },
      { type: 'think', text: '正在读第二份材料。' },
      { type: 'error' }, // 刻意不带 error 详情 → 走 `ev.error ?? null` 这条新分支
    ],
  },
]

// 顶替 streamAdvise：按脚本逐帧回放。其余 transport 方法保持真实（浅拷贝原对象）。
async function injectScriptedStream(page, storeKey, events) {
  await page.evaluate(
    ({ storeKey, events }) => {
      const store = window[storeKey]
      const real = store.getState().transport
      store.getState().setTransport({
        ...real,
        streamAdvise: (_req, onEvent, onDone) => {
          let cancelled = false
          ;(async () => {
            for (const ev of events) {
              if (cancelled) return
              onEvent(ev)
              await new Promise((r) => setTimeout(r, 12))
            }
            if (!cancelled) onDone()
          })()
          return { abort: () => { cancelled = true } }
        },
      })
    },
    { storeKey, events },
  )
}

// 跑一段脚本，等它收尾，回传对话流的可见文本 + 行数。
// `expandRaw`：v02 默认显示的是四相简化视图，原始流收在「展开原始流」按钮后面，
// 六句里有几句只在展开后可见——两种视图都要采。v01 的终端恒可见，无需展开。
async function runRoomScript(page, storeKey, script, { expandRaw }) {
  await injectScriptedStream(page, storeKey, script.events)
  await page.evaluate(
    ({ storeKey }) => {
      window[storeKey].getState().goScreen('room')
      window[storeKey].getState().askLive({ situation: '这周有什么该我留意的？' })
    },
    { storeKey },
  )
  // 等 run 真的收尾——不要用固定 sleep，帧数变了就会静默采到半截。
  await page
    .waitForFunction(
      (k) => ['complete', 'error'].includes(window[k].getState().run.status),
      storeKey,
      { timeout: 8000 },
    )
    .catch(() => {})
  await page.waitForTimeout(250)

  const lineCount = await page.evaluate((k) => window[k].getState().run.lines.length, storeKey)
  const surfaces = {}
  surfaces[`${script.name} · 默认视图`] = latinHits(await page.evaluate(() => document.body.innerText))

  if (expandRaw) {
    // ⚠️ 这里刻意**不用** locator.click()：`.nexus-brief-hud`（"正在仔细梳理中 — 实时" 那条
    //    HUD）盖在「展开原始流」按钮上，Playwright 的真实点击会被它拦掉直到超时。
    //    改用 DOM 派发冒泡 click（React 在根上监听，照样收得到），让门测的是**这个按钮的
    //    行为**，而不是被一个覆盖层卡住。
    //    🔴 覆盖层本身是**另一个待判的问题**（真人可能也点不动），已单独记录，不在本门范围。
    const expanded = await page.evaluate(() => {
      const btn = document.querySelector('[data-flow-toggle]')
      if (!btn) return null
      // 已经展开过就不再点（点两次 = 收回去 = 又采到空的）。
      if (btn.getAttribute('aria-expanded') !== 'true') {
        btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
      }
      return true
    })
    if (expanded) {
      await page.waitForTimeout(300)
      surfaces[`${script.name} · 展开原始流`] = latinHits(
        await page.evaluate(() => document.body.innerText),
      )
    }
  }
  return { lineCount, surfaces }
}

// 把三段脚本跑完，返回 { surfaces, empties }。
// `empties` 非空 = 采样时对话流是空的 = 这个门又变回了那个"绿着的瞎门"，必须硬失败。
async function sampleRoomTranscript(page, storeKey, { expandRaw }) {
  const surfaces = {}
  const empties = []
  for (const script of ROOM_SCRIPTS) {
    const { lineCount, surfaces: s } = await runRoomScript(page, storeKey, script, { expandRaw })
    if (lineCount === 0) empties.push(`${storeKey} ${script.name}`)
    Object.assign(surfaces, s)
    console.log(`    · ${script.name} — 对话流 ${lineCount} 行${lineCount === 0 ? '  ⚠ 空！' : ''}`)
  }
  return { surfaces, empties }
}

function latinHits(txt) {
  const out = []
  for (const line of txt.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    for (const frag of trimmed.match(/[A-Za-z][A-Za-z'()\-]*(?:\s+[A-Za-z][A-Za-z'()\-]*)*/g) || []) {
      const words = frag.trim().split(/\s+/)
      // 两个及以上连续拉丁词，或单个长度 >= 4 的拉丁词
      if (words.length >= 2 || (words[0] && words[0].length >= 4)) out.push({ line: trimmed, frag: frag.trim() })
    }
  }
  return out.filter((h) => !h.frag.split(/\s+/).every((w) => ALLOW.test(w)))
}

const dedupe = (hits) => [...new Map(hits.map((h) => [h.frag, h])).values()]

function report(title, surfaces) {
  console.log(`\n═══ ${title} ═══`)
  let total = 0
  for (const [name, hits] of Object.entries(surfaces)) {
    const uniq = dedupe(hits)
    total += uniq.length
    if (!uniq.length) { console.log(`  [干净] ${name}`); continue }
    console.log(`  [残留] ${name} — ${uniq.length} 处`)
    for (const h of uniq.slice(0, 10)) console.log(`         · "${h.frag}"   ← ${h.line.slice(0, 110)}`)
  }
  return total
}

const browser = await chromium.launch({ headless: true })
const pageErrors = []

// ── v01（`?v=1` 逃生门）─────────────────────────────────────────────────────
//
// 🔴 2026-07-19 起裸链不再是 v01。Danny 拍板 ① 把 resolveVersion() 的缺省翻成了 '2'，
//    所以 `?mode=live&lang=zh`（不带 v=）现在开出来的是 **v02**。要取 v01 的面，必须
//    显式写 `?v=1`。
//
// ⚠️ **这条改错了不会报错，只会静悄悄地测两遍 v02 然后报告「v01 干净」。** 机制：
//    `src/main.tsx:43` 在 DEV 下**无条件**把 `window.__AVERY_LITE__`（v01 的 store）
//    挂到 window 上——挂不挂和当前渲染的是哪张壳完全无关。于是漏改这一行的后果是：
//      · 页面渲染的是 v02；
//      · 下面的 uploadFiles 成功写进了一个**没有被渲染**的 v01 store；
//      · openDetail 拿到真实的 project id，返回值看着完全正常；
//      · 而 innerText 刮的是 v02 的 DOM。
//    → 退出码 0、报告可信、结论是错的。改这一行时请连同本段注释一起读。
//
// ⚠️ 07-20 修门：下面三处实际调用已从 `__AVERY_LITE__` 换成 **`__liteStore`**（同
//    verify-null-auto/verify-status-truth 的先例）。`__AVERY_LITE__` 是 `import.meta.env.DEV`
//    门控的，**`vite build` 会把整段剪掉**——即便 `--mode development` 也一样（实测 dist 里
//    grep 不到这个名字）。而本仓的共享 node_modules 缺 `@babel/*`，`vite dev` 起不来，门只能
//    跑在 build+preview 上：于是这道门在当前环境里是**崩**（TypeError: Cannot read properties
//    of undefined），不是失败——一个崩掉的门和一个没写的门，作为质量信号是同一个东西。
//    `__liteStore`（src/lite/store.ts）与 `__lite2Store` 是无条件挂载的缝，两个环境都在。
//    上面那段「挂不挂与渲染哪张壳无关」的机制说明**对 `__liteStore` 同样成立**，别因为换了
//    名字就以为那个陷阱没了：`?v=1` 这个参数仍然是取到 v01 面的唯一办法。
const p1 = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage()
p1.on('pageerror', (e) => pageErrors.push(`v01: ${e.message}`))
await p1.goto(`${UI}/?v=1&mode=live&lang=zh`, { waitUntil: 'networkidle' })
await p1.waitForTimeout(600)
await p1.evaluate(async (t) => {
  await window.__liteStore.getState().uploadFiles([new File([t], 'w29.md', { type: 'text/markdown' })])
  await new Promise((r) => setTimeout(r, 2400))
}, DOC)

const v01 = { 团队屏: latinHits(await p1.evaluate(() => document.body.innerText)) }
const opened = await p1.evaluate(() => {
  const st = window.__liteStore.getState()
  const p = (st.team?.projects ?? [])[0]
  if (!p) return null
  st.openDetail('project', p.id)
  return { id: p.id, status: p.status ?? '(none)' }
})
await p1.waitForTimeout(700)
v01['项目详情浮层'] = latinHits(await p1.evaluate(() => document.body.innerText))
// feat-069：把 v01 也推进到"跑过一次"的状态再采（v01 的终端恒可见，不需要展开）。
console.log('\n  ── v01 议事室：真跑三段流 ──')
const room1 = await sampleRoomTranscript(p1, '__liteStore', { expandRaw: false })
Object.assign(v01, room1.surfaces)

const n1 = report(`v01（?v=1 逃生门）· 打开的项目 ${JSON.stringify(opened)}`, v01)

// ── v02（`?v=2`）逐屏 ────────────────────────────────────────────────────────
// v02 自 2026-07-19 起就是**裸链默认**（拍板 ①）。这里仍然显式写 `?v=2` 是刻意的：
// 门的结论不该依赖「当前缺省值恰好是几」——缺省再翻一次时，这一段测的还是 v02。
// 裸链本身开出哪张壳，由 verify-bare-url-shell.mjs 单独守。
const p2 = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage()
p2.on('pageerror', (e) => pageErrors.push(`v02: ${e.message}`))
await p2.goto(`${UI}/?v=2&mode=live&look=paper&lang=zh`, { waitUntil: 'networkidle' })
if (await p2.locator('.lite-onboard').count()) { await p2.keyboard.press('Escape'); await p2.waitForTimeout(700) }
await p2.evaluate(async (t) => {
  await window.__lite2Store.getState().uploadFiles([new File([t], 'w29.md', { type: 'text/markdown' })])
  await new Promise((r) => setTimeout(r, 2400))
}, DOC)

const v02 = {}
for (const screen of V2_SCREENS) {
  await p2.evaluate((s) => window.__lite2Store.getState().goScreen(s), screen)
  await p2.waitForTimeout(800)
  v02[`/${screen}`] = latinHits(await p2.evaluate(() => document.body.innerText))
}
// partner-docs-0728 ·「文件与表单」页。它**不在 V2_SCREENS 里**（不是屏、没有 tab、
// goScreen 到不了它），所以上面那一圈天然扫不到——一整页新中文对这个门是隐形的，
// 而它恰恰是全站中文密度最高的一页（三份合同正文）。真导航过去采一次。
//
// 正文默认折叠，所以要**先展开全部**再采样：只采卡片头等于只验了目录，合同条款一个字
// 没进判据（「门全绿≠真部件被验到」）。内部批注也一并打开——它默认隐藏，但它同样是
// 要给人读的中文。
await p2.goto(`${UI}/paperwork?v=2&mode=live&look=paper&lang=zh`, { waitUntil: 'networkidle' })
await p2.evaluate(() => {
  const notes = document.querySelector('.paperwork-notes-toggle input')
  if (notes && !notes.checked) notes.click()
  for (const b of document.querySelectorAll('.paperwork-toggle')) {
    if (b.getAttribute('aria-expanded') === 'false') b.click()
  }
})
await p2.waitForTimeout(600)
const paperworkOpened = await p2.evaluate(() => document.querySelectorAll('.paperwork-doc-body').length)
// 硬失败判据，同议事室那条的理由：展开失败时每张卡都只剩标题，门照样报「干净」、退出码
// 照样 0，而三份合同正文一个字都没被看过。
if (paperworkOpened < 4) {
  console.error(`\n🔴 /paperwork 只展开了 ${paperworkOpened} 份正文（应为 4）——采样无效，不是"干净"。`)
  process.exitCode = 1
}
v02['/paperwork'] = latinHits(await p2.evaluate(() => document.body.innerText))
await p2.goto(`${UI}/?v=2&mode=live&look=paper&lang=zh`, { waitUntil: 'networkidle' })

// feat-069：v02 的议事室同样推进到"跑过一次"。上面 V2_SCREENS 那一圈里的 `/room`
// 采的是 **idle 空态**（对话流一行都没有），它报「干净」不代表这一屏干净——真正的
// 判据是下面这三段。
console.log('\n  ── v02 议事室：真跑三段流（含展开原始流）──')
const room2 = await sampleRoomTranscript(p2, '__lite2Store', { expandRaw: true })
Object.assign(v02, room2.surfaces)

const n2 = report('v02（?v=2 显式；亦即现在的裸链默认）逐屏', v02)

// 🔴 feat-069 · 第二条硬失败判据：采样时对话流必须非空。
// 没有这一条，整个「真跑一次」的改动会在下次悄悄退化回去——比如 askLive 的前置条件变了、
// 测试缝改名了、脚本回放被 abort 了，运行根本没发生，而每一屏照样报「干净」、退出码照样 0。
// **那正是这个门此前漏掉这六句话的原因，不能让它以另一种形式回来。**
const empties = [...room1.empties, ...room2.empties]

console.log(`\n  pageerror: ${pageErrors.length} 条${pageErrors.length ? ' — ' + pageErrors.join(' | ') : ''}`)
console.log(`  议事室对话流空采样: ${empties.length} 处${empties.length ? ' — ' + empties.join(' | ') : '（全部非空 ✓）'}`)
console.log(`═══ 合计 ${n1 + n2} 处待人工判读（v01 ${n1} · v02 ${n2}）═══`)
console.log('  已知可接受项：文件格式专名（PDF/Word/Excel/CSV/Markdown）；')
// open-loop-0720 Danny 判词逐词落地：demo / agent / prompt 是行业通用黑话，留着更自然——保留。
// Skills / tools / onboarding / review / skill 有现成自然中文说法，已翻（技能/工具/入职/复盘），
// 不再出现在残留列表里；这条注释因此从 7 词收窄成 3 词，别再往回加。
console.log('  「往哪走」屏的中英混排宣讲词（demo / agent / prompt）——')
console.log('  那是刻意的产品腔调，不是漏译，改不改归 Danny 判（见 issue 记录）。')
// partner-docs-0728 ·「文件与表单」页的残留只有一类：**下载件的文件名**
// （Avery-保密协议NDA-草案.docx 之类）。带连字符的 `NDA-` / `DPA-` / `Avery-` 切不进
// ALLOW 的 `^…$` 锚定，这是对的——文件名本来就该原样显示，用户点下去落盘就是这个名字，
// 翻译它反而对不上。同一页第一次跑出来还带着 `scripts/make-intake-xlsx.py`（仓库路径漏到
// 用户界面上），那是真漏，已改掉；再出现同类就是又漏了，别当成本类忽略。
console.log('  /paperwork 的残留应当**只有下载件文件名**（Avery- / NDA- / DPA- 前缀）——')
console.log('  文件名原样显示是对的；出现别的（尤其是路径、变量名）就是真漏。')
// open-loop-0720：TOOL / MANIFEST 前缀已翻（纯前端展示徽标，零代码按文本匹配，见
// speakerMeta()/roomToolLabel/roomManifestLabel）。仍留着不翻的只剩 read_case / cite /
// case_id / source_ref 这几个——它们是后端协议 token（工具名 + 入参 key），逐字透传是
// 明文设计原则（streamCopy.ts 头部注释），不是文案，翻了会把工程日志误当成产品语言。
console.log('  议事室对话流里 read_case / cite 等工具名与 case_id / source_ref 等入参 key 是')
console.log('  后端协议标识符，不是文案（formatToolCall 逐字透传），不计漏译。')

await browser.close()
if (empties.length) {
  console.error(`\n🔴 有 ${empties.length} 处采样时对话流是空的 —— 这一屏的「干净」结论不成立（门没看见任何东西）。`)
}
process.exit(pageErrors.length || empties.length ? 1 : 0)
