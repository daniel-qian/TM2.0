#!/usr/bin/env node
// fixD · 数据边界回归门（B1 / M2 / M3 / m4）
//
// 为什么是 Playwright 而不是单测：本仓前端没有 vitest/jest，而这四条 finding 全部是**跨模块的
// 运行时行为**（localStorage 的跨账号存活、React effect 里的收口调用、zustand 内存态与持久层
// 是否一致）。它们正是 typecheck / build / lint 结构上看不见的那一类——集成期的教训（见
// integration-findings.md §四）就是四道机器门全绿的同时三个真 bug 一个没拦住。
//
// 🔴 不打真后端，也**不用** `?transport=stub`：
//   · 不用 stub 是因为 store.ts 的 `stubSelected` 一旦为真，contextId 的持久化整条链被关掉
//     （见 store.ts:restoredContextId），而"锚点落没落盘"恰恰是 M3/m4 要验的东西——
//     用 stub 验它等于把被测对象关掉再宣布测试通过。
//   · 改为默认 HTTP transport 起页，再用 `setTransport()` 注入一个假 transport。于是持久化
//     链是**真的**，网络是假的：不需要后端、不碰 CORS（integration-findings F10 那个
//     "看起来像没数据"的坑天然绕开）。
//
// 怎么跑（一条命令，自带 dev server）：
//   node .issues/v02-partner-align-0718/verify-data-boundary.mjs
// 退出码 0 = 全过；非 0 = 有 FAIL。
//
// ── born-red 开关（复核要求：证明测试真能抓到原 bug）───────────────────────────────────
//   VERIFY_OLD_STORE=<git-ref> node .issues/v02-partner-align-0718/verify-data-boundary.mjs
// 用一个 Vite `load` 钩子把 `git show <ref>:src/lite2/store.ts` **原样**喂给 dev server，
// 工作树零改动、不 checkout、不 stash（本线禁止任何切换类 git）。于是同一份测试可以在
// "修复前的 store" 上跑一遍看它 FAIL、在当前 store 上跑一遍看它 PASS。
//   VERIFY_OLD_STORE=HEAD   → 复核那三条 newFinding 之前的 store（本次收口的对照组）
//   VERIFY_OLD_STORE=HEAD~1 → B1/M2/M3/m4 五条修复之前的 store（上一轮的对照组）
// 只换 store.ts 一个模块，是因为这三条 newFinding 全部落在它里面——换得越少，隔离越干净。
//
// 端口 5304 刻意避开集成方在用的 5173/8137。cacheDir 也是独立的：工作树共享 node_modules
// junction ⇒ `.vite` 预构建缓存被所有工作树共用，多个 dev server 并发会互相把对方的缓存判为
// outdated → 504 Outdated Optimize Dep → **白屏**，看起来就像"这条线把应用改崩了"
//（integration-findings F9，集成期真踩过）。缓存目录写在系统临时目录，绝不落进工作树。

import { chromium } from 'playwright'
import { createServer } from 'vite'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const PORT = Number(process.env.VERIFY_PORT || 5304)
const BASE = `http://127.0.0.1:${PORT}`
const ENTRY = `${BASE}/?v=2&mode=live&look=paper&lang=zh`

// born-red 用：把某个 git ref 的 store.ts 顶替掉工作树那份（见文件头）。
const OLD_STORE_REF = process.env.VERIFY_OLD_STORE || null
const oldStoreSource = OLD_STORE_REF
  ? execFileSync('git', ['show', `${OLD_STORE_REF}:src/lite2/store.ts`], {
      encoding: 'utf8',
      cwd: process.cwd(),
      maxBuffer: 8 * 1024 * 1024,
    })
  : null

function oldStorePlugin() {
  return {
    name: 'fixd-old-store',
    enforce: 'pre',
    load(id) {
      // id 是 Vite 解析后的绝对路径（Windows 上可能带反斜杠），统一成 / 再比后缀。
      const norm = id.split('?')[0].replace(/\\/g, '/')
      return norm.endsWith('/src/lite2/store.ts') ? oldStoreSource : null
    },
  }
}

const results = []
function record(name, pass, detail) {
  results.push({ name, pass })
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name}${detail ? ' — ' + detail : ''}`)
}

const KEY_CONTEXT = 'lite2:contextId:v1'
const KEY_TOKENS = 'lite2:ownerTokens:v1'
const KEY_FLOW = 'lite2:flow:v1'
const KEY_ONBOARD = 'lite2:onboard:v1'
const KEY_NOTIFY = 'lite2:notify:v1'
const KEY_KNOWN = 'lite2:knownContexts:v1'

// 🔴 真汉字，不用拼音伪装。上一波栽过一次："全套门语料是 ASCII 伪装"，中文一进来就塌
//（记忆 gate-corpus-all-ascii-blindspot）。这里的原文是要证明"B 公司经理能读到 A 公司文档
// 原文"这件事，用拼音写就等于没证。
const A_VERBATIM = '鹿山雅居三期婚宴宴会厅交付延期，客户已口头投诉两次'
const A_COMPANY = '三亚鹿山雅居'

// 假 transport：只实现被测路径要用到的方法，其余抛错（被调到就该炸，别静默）。
function installFakeTransport(page) {
  return page.evaluate(() => {
    // 🔴 人名里带 cid：跨公司串数据这件事只有"这个人属于哪一家"能证明。
    // 全公司共用一个「李明」的话，A 的花名册渲染到 B 底下会长得和正确结果一模一样。
    const payloadFor = (cid) => ({
      context_id: cid,
      source_files: ['周报.docx'],
      people: [{ id: 'p1', name: '员工-' + cid, role: '项目经理', owns: ['婚宴厅交付'] }],
      projects: [{ id: 'j1', title: '三期婚宴厅', status: 'unknown' }],
      briefing: { headline: '（测试）', body: '（测试）' },
      signals: [],
      decisions: [],
    })
    // 让 fetchTeam 可控地慢下来 —— 竞态测试要的就是"请求还在飞的时候用户又点了一下"。
    const lag = () =>
      window.__fakeDelayMs ? new Promise((r) => setTimeout(r, window.__fakeDelayMs)) : null
    const notImpl = (n) => () => { throw new Error('fake transport: ' + n + ' not implemented') }
    const fake = {
      streamAdvise: () => ({ abort: () => {} }),
      ingest: async (files) => {
        const cid = 'ctx_fake_' + Math.random().toString(36).slice(2, 10)
        // 真 transport 会把 owner_token 存进 localStorage —— 假的这里也照做，
        // 否则 switchContext 的"有没有钥匙"判断没有被测对象。
        const store = JSON.parse(localStorage.getItem('lite2:ownerTokens:v1') || '{}')
        store[cid] = 'tok_' + cid
        localStorage.setItem('lite2:ownerTokens:v1', JSON.stringify(store))
        const p = payloadFor(cid)
        p.owner_token = store[cid]
        p.source_files = files.map((f) => f.name)
        return p
      },
      fetchTeam: async (cid) => {
        await lag()
        if (window.__fakeGone && window.__fakeGone[cid]) throw new Error('team HTTP 404')
        return payloadFor(cid)
      },
      fetchFiles: async (cid) => ({ context_id: cid, files: [] }),
      // 笔记按 context 分开存 —— 「A 的笔记挂在 B 底下」只有分开存才验得出来。
      fetchNotes: async (cid) => ({
        context_id: cid,
        notes: (window.__fakeNotes && window.__fakeNotes[cid]) || [],
      }),
      fetchAccountContexts: async () => ({ context_ids: window.__fakeAccountContexts || [] }),
      claimContext: async () => {},
      saveAsk: notImpl('saveAsk'),
      shareAsk: notImpl('shareAsk'),
      fetchAsk: notImpl('fetchAsk'),
    }
    window.__lite2Store.getState().setTransport(fake)
  })
}

// 上传一次（走真 store.uploadFiles → 真持久化链，只有网络那一段是假的）。
async function upload(page, names) {
  return page.evaluate(async (names) => {
    const files = names.map((n) => new File(['x'], n, { type: 'text/plain' }))
    await window.__lite2Store.getState().uploadFiles(files)
    return window.__lite2Store.getState().contextId
  }, names)
}

const snapshot = (page) =>
  page.evaluate(() => {
    const s = window.__lite2Store.getState()
    return {
      ls: Object.fromEntries(
        Object.keys(localStorage)
          .filter((k) => k.startsWith('lite2:'))
          .map((k) => [k, localStorage.getItem(k)]),
      ),
      contextId: s.contextId,
      team: s.team ? s.team.people.length : null,
      knownContexts: s.knownContexts,
      switchError: s.switchError,
    }
  })

async function main() {
  const server = await createServer({
    root: process.cwd(),
    cacheDir: join(tmpdir(), 'avery-fixd-vite-cache'),
    server: { port: PORT, strictPort: true },
    optimizeDeps: { force: true },
    logLevel: 'warn',
    plugins: oldStoreSource ? [oldStorePlugin()] : [],
  })
  await server.listen()
  console.log(`dev server on ${BASE}（独立 cacheDir，见文件头 F9 注释）`)
  if (oldStoreSource) {
    console.log(
      `🔴 born-red 模式：src/lite2/store.ts 用的是 ${OLD_STORE_REF} 那一版（工作树未改动）`,
    )
  }

  const browser = await chromium.launch({ headless: true })
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const consoleErrors = []
  const harnessNoise = []
  // 🔴 门自己的环境噪声，不是产品报错：本门**不起后端**，而每次 goto/reload 都有一帧是用
  // 真 HTTP transport 跑的（注入假 transport 只能在页面加载之后）。那一帧的 restoreSession
  // 必然打向 VITE_AVERY_API_BASE 并被 CORS/连接失败拦下。
  // 放过它是刻意的，但白名单收得很窄：本门里所有产品流量都走假 transport（不碰网络），
  // 所以"真的网络错误"在这个门里只可能是这一类。其余任何 console error 一律照旧算 FAIL。
  // 不静默丢弃 —— 单独打出来，免得将来有人以为门什么都没看见。
  const isHarnessNoise = (t) => /CORS policy|net::ERR_|Failed to load resource/.test(t)
  // 每一页都要盯着 —— 原来只盯第一页，后面几页炸了也看不见。
  const watch = (p) => {
    p.on('console', (m) => {
      if (m.type() !== 'error') return
      ;(isHarnessNoise(m.text()) ? harnessNoise : consoleErrors).push(m.text())
    })
    p.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message))
    return p
  }
  const page = watch(await ctx.newPage())

  await page.goto(ENTRY, { waitUntil: 'networkidle' })
  await installFakeTransport(page)

  // ══ B1 · 第二次上传：两份都留着、都回得去 ═══════════════════════════════════════════════
  console.log('\n═══ B1 · 二次上传不再抹掉第一家 ═══')

  const cidA = await upload(page, ['A公司周报.docx'])
  const afterA = await snapshot(page)
  record('B1-1 第一次上传后：名册记下这一份', afterA.knownContexts.length === 1 &&
    afterA.knownContexts[0].id === cidA,
    `knownContexts=${JSON.stringify(afterA.knownContexts.map((c) => c.id))}`)
  // ?. 是刻意的：修复前 knownContexts 是空的，这里必须**报 FAIL 而不是抛异常中断整轮**——
  // 一个只在通过时才跑得完的门，等于没有门。
  record('B1-2 名册留了当时的文件名（不是编的标签）',
    JSON.stringify(afterA.knownContexts[0]?.files) === JSON.stringify(['A公司周报.docx']),
    JSON.stringify(afterA.knownContexts[0]?.files))

  const cidB = await upload(page, ['B公司花名册.csv'])
  const afterB = await snapshot(page)
  record('B1-3 第二次上传后：contextId 换成了新的（后端行为，如实反映）',
    afterB.contextId === cidB && cidB !== cidA, `${cidA} -> ${cidB}`)
  record('B1-4 🔴 第一份仍在名册里（回得去的入口存在）',
    afterB.knownContexts.length === 2 && afterB.knownContexts.some((c) => c.id === cidA),
    `knownContexts=${JSON.stringify(afterB.knownContexts.map((c) => c.id))}`)

  // 真的切回去
  const switched = await page.evaluate(async (cid) => {
    await window.__lite2Store.getState().switchContext(cid)
    const s = window.__lite2Store.getState()
    return { contextId: s.contextId, hasTeam: !!s.team, switchError: s.switchError,
             anchor: localStorage.getItem('lite2:contextId:v1') }
  }, cidA)
  record('B1-5 🔴 切回第一份：真的切过去了，且没有报错',
    switched.contextId === cidA && switched.hasTeam && switched.switchError === null,
    JSON.stringify(switched))
  record('B1-6 切回后锚点也跟着走（刷新还在这一份）', switched.anchor === cidA, switched.anchor)

  // 钥匙没了 → 必须诚实报 missing-credential，不许静默、也不许当成 "gone" 把它从名册删掉
  const noKey = await page.evaluate(async (cid) => {
    const tokens = JSON.parse(localStorage.getItem('lite2:ownerTokens:v1') || '{}')
    delete tokens[cid]
    localStorage.setItem('lite2:ownerTokens:v1', JSON.stringify(tokens))
    await window.__lite2Store.getState().switchContext(cid)
    const s = window.__lite2Store.getState()
    return { switchError: s.switchError, contextId: s.contextId,
             stillListed: s.knownContexts.some((c) => c.id === cid) }
  }, cidB)
  record('B1-7 没钥匙 → 报 missing-credential（不是静默失败）',
    noKey.switchError === 'missing-credential', JSON.stringify(noKey))
  record('B1-8 🔴 没钥匙 ≠ 数据没了：这一份仍留在名册上',
    noKey.stillListed === true, `stillListed=${noKey.stillListed}`)

  // ══ M2 · 换账号清场：三个漏网 store ═══════════════════════════════════════════════════
  console.log('\n═══ M2 · 换账号不再留下上一家公司的逐字原文 ═══')

  // 让屏上重新有一份公司数据，并往三个 store 里塞**上一家公司文档的原文**。
  await upload(page, ['A公司周报.docx'])
  await page.evaluate(({ verbatim, company }) => {
    // 走各 store 的真 action，确保真的落进了 localStorage（不是我们手写 key 自欺欺人）。
    window.__lite2Flow.getState().addFollowup({
      title: verbatim, source: 'triage', dueGroup: 'today', note: verbatim,
    })
    window.__lite2Notify.getState()._push('ingest')
    window.__lite2Onboard.getState().setField('company', company)
  }, { verbatim: A_VERBATIM, company: A_COMPANY })

  const seeded = await snapshot(page)
  const seededHasVerbatim = (seeded.ls[KEY_FLOW] || '').includes(A_VERBATIM)
  const seededHasCompany = (seeded.ls[KEY_ONBOARD] || '').includes(A_COMPANY)
  record('M2-0 前置：三个 store 确实装着 A 公司的原文（否则本组测试是空转）',
    seededHasVerbatim && seededHasCompany && !!seeded.ls[KEY_NOTIFY],
    `flow=${seededHasVerbatim} onboard=${seededHasCompany} notify=${!!seeded.ls[KEY_NOTIFY]}`)

  // A → B 换账号，走**真实路径**：AuthPanel 的换人 effect（不是直接调 clearCompanyScope，
  // 那样只测了函数、没测它到底有没有被接上）。
  await page.evaluate(() => window.__lite2Auth.setState({ status: 'authed', userId: 'user_A' }))
  await page.waitForTimeout(150)
  await page.evaluate(() => window.__lite2Auth.setState({ status: 'authed', userId: 'user_B' }))
  await page.waitForTimeout(300)

  const afterSwitch = await snapshot(page)
  const mem = await page.evaluate(() => ({
    followups: window.__lite2Flow.getState().followups.length,
    notifItems: window.__lite2Notify.getState().items.length,
    company: window.__lite2Onboard.getState().company,
  }))

  for (const [label, key] of [
    ['flowStore（跟进队列，装着文档原句）', KEY_FLOW],
    ['onboardStore（公司名/部门/称呼）', KEY_ONBOARD],
    ['notifyStore（通知条目）', KEY_NOTIFY],
  ]) {
    record(`M2-1 换账号后 ${label} 的 localStorage 已清`,
      afterSwitch.ls[key] === undefined, `${key}=${afterSwitch.ls[key]}`)
  }
  record('M2-2 🔴 A 公司文档原文不在任何 lite2:* 键里',
    !JSON.stringify(afterSwitch.ls).includes(A_VERBATIM),
    Object.keys(afterSwitch.ls).join(',') || '(全空)')
  record('M2-3 🔴 A 公司名不在任何 lite2:* 键里',
    !JSON.stringify(afterSwitch.ls).includes(A_COMPANY))
  record('M2-4 内存态也复位了（不用刷新就看不见了）',
    mem.followups === 0 && mem.notifItems === 0 && mem.company === '',
    JSON.stringify(mem))

  // ══ m4 · 登出/换账号后锚点不许还指着上一家 ═══════════════════════════════════════════
  console.log('\n═══ m4 · contextId 锚点跟着清 ═══')
  record('m4-1 🔴 换账号后 lite2:contextId:v1 已清',
    afterSwitch.ls[KEY_CONTEXT] === undefined, `${KEY_CONTEXT}=${afterSwitch.ls[KEY_CONTEXT]}`)
  record('m4-2 owner_token 也清了（既有行为，回归保护）',
    afterSwitch.ls[KEY_TOKENS] === undefined)
  record('m4-3 名册（公司数据）跟着清',
    afterSwitch.ls[KEY_KNOWN] === undefined && afterSwitch.knownContexts.length === 0)

  // ══ M3 · 登录用户的锚点必须落盘（adoptContext 收口）═══════════════════════════════════
  console.log('\n═══ M3 · 登录恢复走 adoptContext，锚点真的落盘 ═══')

  // 干净重开一页，模拟"换设备登录"：本机没有任何 context，账号名下有一份。
  const page2 = watch(await ctx.newPage())
  await page2.goto(ENTRY, { waitUntil: 'networkidle' })
  await page2.evaluate(() => localStorage.clear())
  await page2.reload({ waitUntil: 'networkidle' })
  await installFakeTransport(page2)

  await page2.evaluate(() => {
    window.__fakeAccountContexts = ['ctx_from_account_9911']
    window.__lite2Auth.setState({ status: 'authed', userId: 'user_C' })
  })
  await page2.waitForTimeout(400)

  const restored = await page2.evaluate(() => ({
    contextId: window.__lite2Store.getState().contextId,
    anchor: localStorage.getItem('lite2:contextId:v1'),
  }))
  record('M3-1 登录恢复确实接管了账号名下那一份',
    restored.contextId === 'ctx_from_account_9911', JSON.stringify(restored))
  record('M3-2 🔴 锚点落进了 localStorage（登录用户刷新不再丢数据）',
    restored.anchor === 'ctx_from_account_9911', `anchor=${restored.anchor}`)

  // 刷新一次，证明"落盘"不是空话：数据真的回得来。
  await page2.reload({ waitUntil: 'networkidle' })
  await installFakeTransport(page2)
  const afterReload = await page2.evaluate(async () => {
    await window.__lite2Store.getState().restoreSession()
    const s = window.__lite2Store.getState()
    return { contextId: s.contextId, hasTeam: !!s.team }
  })
  record('M3-3 🔴 刷新后仍在同一份公司上（端到端证明锚点有用）',
    afterReload.contextId === 'ctx_from_account_9911' && afterReload.hasTeam,
    JSON.stringify(afterReload))

  // ══ N1 · 切换竞态：屏上的 id / 人 / 钥匙必须是同一家公司 ═══════════════════════════════
  //
  // 复核新 finding 1（blocker）。原实现是 `adoptContext(新 id)` 先换、`await restoreSession()`
  // 后取，而 restoreSession 在 await 之后拿闭包里的旧 id 无条件写 team/ownerToken。于是
  // 双击（或点了 A 又改主意点 B）之后：屏上挂着 B 的 contextId 和锚点，人却是 A 的人，
  // 手里攥的是 A 的 owner_token —— B 公司经理看到的整份花名册来自 A 公司的文件。
  // 这条门就是拿"双击"当输入，断言三者必须同源。
  console.log('\n═══ N1 · 快速两次切换不许跨公司串数据 ═══')

  const page3 = watch(await ctx.newPage())
  await page3.goto(ENTRY, { waitUntil: 'networkidle' })
  await page3.evaluate(() => localStorage.clear())
  await page3.reload({ waitUntil: 'networkidle' })
  await installFakeTransport(page3)

  const rA = await upload(page3, ['A公司周报.docx'])
  const rB = await upload(page3, ['B公司花名册.csv'])
  await upload(page3, ['C公司预算.xlsx']) // 落脚在第三家，于是切 A 和切 B 都是"真的换一家"

  const raced = await page3.evaluate(
    async ({ a, b }) => {
      window.__fakeDelayMs = 250
      const st = () => window.__lite2Store.getState()
      // 一次 fetchTeam 要 250ms，两次点击间隔 40ms —— 就是双击的手速。
      const p1 = st().switchContext(a)
      await new Promise((r) => setTimeout(r, 40))
      const p2 = st().switchContext(b)
      await Promise.all([p1, p2])
      // 🔴 必须再等一会儿：脏数据是**先发的那次**在 400ms 之后写进来的。
      // 不等就收摊，这条测试会在坏代码上假过。
      await new Promise((r) => setTimeout(r, 500))
      const s = st()
      window.__fakeDelayMs = 0
      return {
        contextId: s.contextId,
        teamPeople: s.team ? s.team.people.map((p) => p.name) : null,
        ownerToken: s.ownerToken,
        anchor: localStorage.getItem('lite2:contextId:v1'),
        switchError: s.switchError,
        switchPending: s.switchPending === undefined ? '(字段不存在)' : s.switchPending,
      }
    },
    { a: rA, b: rB },
  )

  record('N1-1 落在最后点的那一份上（后点的赢，不是先发的赢）',
    raced.contextId === rB, JSON.stringify(raced))
  record('N1-2 🔴 屏上的人属于屏上那家公司（不是上一次点的那家）',
    JSON.stringify(raced.teamPeople) === JSON.stringify(['员工-' + rB]),
    `contextId=${raced.contextId} teamPeople=${JSON.stringify(raced.teamPeople)}`)
  record('N1-3 🔴 手里的 owner_token 也是这一家的（错配 → 下一次读被后端 404）',
    raced.ownerToken === 'tok_' + rB, `ownerToken=${raced.ownerToken} expect=tok_${rB}`)
  record('N1-4 锚点跟着落在同一家（刷新不会跳回另一家）', raced.anchor === rB, raced.anchor)
  record('N1-5 切成功了就不许同时挂着一句错误', raced.switchError === null,
    `switchError=${raced.switchError}`)
  record('N1-6 pending 态收干净了（UI 据此把名册按钮置灰，挡住误触）',
    raced.switchPending === null, `switchPending=${raced.switchPending}`)

  // ══ N2 · 404 只能说"打不开"，不能说"没了"，更不能据此删名册 ═════════════════════════
  //
  // 复核新 finding 2（major）。feat-038 **刻意**让"这份不存在"和"你证明不了这是你的"
  // 返回同一个 404（不给存在性 oracle），所以前端根本分不出是哪一种。原实现把 404 读成
  // 「服务端已经没了」并据此 forgetKnownContext —— 产品替客户断言了一个它无法知道的事实，
  // 而且这个删除不可逆（POST /ingest 每次新建 context，名册是那个 id 唯一的第二处记录）。
  console.log('\n═══ N2 · 「我打不开」不等于「这份不存在」 ═══')

  const gone = await page3.evaluate(async (a) => {
    window.__fakeGone = { [a]: true }
    await window.__lite2Store.getState().switchContext(a)
    const s = window.__lite2Store.getState()
    return {
      switchError: s.switchError,
      stillListed: s.knownContexts.some((c) => c.id === a),
      lsListed: (localStorage.getItem('lite2:knownContexts:v1') || '').includes(a),
      contextId: s.contextId,
      teamPeople: s.team ? s.team.people.map((p) => p.name) : null,
      switchPending: s.switchPending === undefined ? '(字段不存在)' : s.switchPending,
    }
  }, rA)

  record('N2-1 🔴 404 读成「打不开」而不是「没了」', gone.switchError === 'unreadable',
    `switchError=${gone.switchError}`)
  record('N2-2 🔴 一次 404 不许把这一份从名册上抹掉（内存态）',
    gone.stillListed === true, `stillListed=${gone.stillListed}`)
  record('N2-3 🔴 localStorage 里的名册也没被抹（否则刷新后永久失去入口）',
    gone.lsListed === true, `lsListed=${gone.lsListed}`)
  record('N2-4 切换失败不留半切状态：仍停在原来那家公司上',
    gone.contextId === rB && JSON.stringify(gone.teamPeople) === JSON.stringify(['员工-' + rB]),
    `contextId=${gone.contextId} teamPeople=${JSON.stringify(gone.teamPeople)}`)
  record('N2-5 失败后 pending 态也收干净（按钮不会永久灰着）',
    gone.switchPending === null, `switchPending=${gone.switchPending}`)

  const forgot = await page3.evaluate(async (a) => {
    const st = window.__lite2Store.getState()
    if (typeof st.forgetContext !== 'function') return { ok: false, why: 'store 没有 forgetContext' }
    st.forgetContext(a)
    const s = window.__lite2Store.getState()
    return {
      ok:
        !s.knownContexts.some((c) => c.id === a) &&
        !(localStorage.getItem('lite2:knownContexts:v1') || '').includes(a),
      why: '',
    }
  }, rA)
  record('N2-6 名册删除有且只有「用户显式点移除」这一条路（forgetContext 存在且真删）',
    forgot.ok === true, forgot.why)

  // ══ N3 · 第二次上传必须把上一家的 Avery's notes 清掉 ═══════════════════════════════════
  //
  // 复核新 finding 3（major）。uploadFiles 原来用裸 setState 绕开 adoptContext 收口，
  // 只重设 team/rawTeam，**唯独漏了 notes**：refreshNotes 不调、也不清空。于是 A 公司的
  // 笔记原文原封不动挂在 B 公司的 contextId 底下，NotesScreen 直接渲染。
  // 它就落在 B1「第二次上传」这个正主场景里，而 switchContext 走 adoptContext 那条路清得
  // 干干净净 —— 同一件事两条路给出相反答案。
  console.log('\n═══ N3 · 二次上传：A 公司的笔记不许挂到 B 公司底下 ═══')

  const page4 = watch(await ctx.newPage())
  await page4.goto(ENTRY, { waitUntil: 'networkidle' })
  await page4.evaluate(() => localStorage.clear())
  await page4.reload({ waitUntil: 'networkidle' })
  await installFakeTransport(page4)

  const nA = await upload(page4, ['A公司周报.docx'])
  await page4.evaluate(
    ({ cid, verbatim }) => {
      // 只有第一份有笔记；第二份在后端是空的。于是"B 底下出现内容"只可能是 A 漏过来的。
      window.__fakeNotes = {
        [cid]: [
          { id: 'note_a1', created_at: '2026-07-18T02:00:00Z', text: verbatim, source_excerpt: verbatim.slice(0, 20) },
        ],
      }
    },
    { cid: nA, verbatim: A_VERBATIM },
  )
  const notesA = await page4.evaluate(async () => {
    await window.__lite2Store.getState().refreshNotes()
    const s = window.__lite2Store.getState()
    return { cid: s.contextId, notes: s.notes.map((n) => n.text) }
  })
  record('N3-0 前置：A 公司底下确实有一条笔记原文（否则本组测试是空转）',
    notesA.notes.some((t) => t.includes(A_VERBATIM)), JSON.stringify(notesA))

  const nB = await upload(page4, ['B公司花名册.csv'])
  await page4.waitForTimeout(250) // uploadFiles 里的 refreshNotes 是 void 的，等它落定
  const notesB = await page4.evaluate(() => {
    const s = window.__lite2Store.getState()
    return { cid: s.contextId, notes: s.notes.map((n) => n.text) }
  })
  record('N3-1 🔴 第二次上传后，A 公司的笔记原文不在屏上',
    !JSON.stringify(notesB.notes).includes(A_VERBATIM),
    `cid=${notesB.cid} notes=${JSON.stringify(notesB.notes)}`)
  record('N3-2 且确实换到了第二家（不是靠"没换成"蒙混过关）',
    notesB.cid === nB && nB !== nA, `${nA} -> ${notesB.cid}`)

  record('无 console 报错', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '))
  if (harnessNoise.length) {
    console.log(`\n（门环境噪声 ${harnessNoise.length} 条，已按白名单排除、不计入判定）`)
    console.log('  ' + harnessNoise[0])
  }

  await browser.close()
  await server.close() // 🔴 用完立刻停，端口不留给下一条线踩

  const failed = results.filter((r) => !r.pass)
  console.log(`\n${results.length - failed.length}/${results.length} passed`)
  if (failed.length) {
    console.log('FAILED:')
    for (const f of failed) console.log('  - ' + f.name)
  }
  process.exit(failed.length ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(2) })
