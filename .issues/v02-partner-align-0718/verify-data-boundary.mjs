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
// 端口 5304 刻意避开集成方在用的 5173/8137。cacheDir 也是独立的：工作树共享 node_modules
// junction ⇒ `.vite` 预构建缓存被所有工作树共用，多个 dev server 并发会互相把对方的缓存判为
// outdated → 504 Outdated Optimize Dep → **白屏**，看起来就像"这条线把应用改崩了"
//（integration-findings F9，集成期真踩过）。缓存目录写在系统临时目录，绝不落进工作树。

import { chromium } from 'playwright'
import { createServer } from 'vite'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const PORT = Number(process.env.VERIFY_PORT || 5304)
const BASE = `http://127.0.0.1:${PORT}`
const ENTRY = `${BASE}/?v=2&mode=live&look=paper&lang=zh`

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
    const payloadFor = (cid) => ({
      context_id: cid,
      source_files: ['周报.docx'],
      people: [{ id: 'p1', name: '李明', role: '项目经理', owns: ['婚宴厅交付'] }],
      projects: [{ id: 'j1', title: '三期婚宴厅', status: 'unknown' }],
      briefing: { headline: '（测试）', body: '（测试）' },
      signals: [],
      decisions: [],
    })
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
        if (window.__fakeGone && window.__fakeGone[cid]) throw new Error('team HTTP 404')
        return payloadFor(cid)
      },
      fetchFiles: async (cid) => ({ context_id: cid, files: [] }),
      fetchNotes: async (cid) => ({ context_id: cid, notes: [] }),
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
  })
  await server.listen()
  console.log(`dev server on ${BASE}（独立 cacheDir，见文件头 F9 注释）`)

  const browser = await chromium.launch({ headless: true })
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const page = await ctx.newPage()
  const consoleErrors = []
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()) })
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message))

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
  const page2 = await ctx.newPage()
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

  record('无 console 报错', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '))

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
