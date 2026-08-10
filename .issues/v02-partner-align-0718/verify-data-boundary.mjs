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

// 🔴 dev server 绑在哪个回环栈上，是随机器变的（2026-07-28 本机实测；与
// eval-harness/tools/verify-auth-{form,capability}.mjs 同一个坑，见 commit 2dd7b26）：
// 不显式给 host 时 vite 只监听 IPv6 回环 —— `netstat -ano | findstr <port>` 看到的是
// `TCP [::1]:PORT`，`curl http://localhost:PORT/` 200 而 `curl http://127.0.0.1:PORT/`
// 直接连接被拒（Node 24 把 localhost 解析成 ::1 优先，vite 监听的就是这个解析结果）。
// 本门此前把 BASE 写死成 127.0.0.1，于是「自起服务器」这一路会**哑火**——不是 FAIL，是
// 每个 page.goto 都撞连接错误，一条判据都跑不到。
// 修两层，缺一不可：
//   ① 下面 createServer 显式 `host: '127.0.0.1'`，把监听钉在 IPv4，不依赖任何解析顺序；
//   ② listen 之后仍按候选列表探一遍活，谁先答应就用谁，并把那个 base 回填进 BASE/ENTRY
//      ——探活与 page.goto 用同一个地址，不会错位。哪天 vite 改默认，门最多慢一拍，
//      不会再退回哑火。
const BASE_CANDIDATES = [`http://127.0.0.1:${PORT}`, `http://localhost:${PORT}`]
const entryFor = (base) => `${base}/?v=2&mode=live&look=paper&lang=zh`
// 🔴 let 不是 const：真正用哪个 base 要等 listen 之后探活才知道（见上）。所有 page.goto
// 都发生在 main() 起服务器之后，读到的一定是回填过的值。
let BASE = BASE_CANDIDATES[0]
let ENTRY = entryFor(BASE)

// 返回**真正答应了的**那个 base（见上面 BASE_CANDIDATES 的注释）。
function waitForServer(urls, timeoutMs = 20000) {
  const started = Date.now()
  return new Promise((resolve, reject) => {
    const tick = async () => {
      for (const url of urls) {
        try {
          const res = await fetch(url)
          if (res.ok || res.status < 500) return resolve(url)
        } catch {
          /* not up yet */
        }
      }
      if (Date.now() - started > timeoutMs) {
        return reject(new Error(`server didn't come up: ${urls.join(' / ')}`))
      }
      setTimeout(tick, 300)
    }
    tick()
  })
}

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
        // 否则「这台电脑上有几份档案」（B1-3 数的就是它）没有被测对象。
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
      // #88 · 第二发上传走的是这条路（`uploadFiles` 在已有档案时委托给 `appendFiles`）。
      // 🔴 必须实现：不实现的话 store 会落进 `append is not available` 那条诚实报错分支，
      //    于是「contextId 没变」这条判据靠**上传压根没发生**而通过——空真。
      appendFiles: async (cid, files) => {
        const p = payloadFor(cid)
        p.source_files = ['周报.docx', ...files.map((f) => f.name)]
        p.appended = { documents: files.map((f) => f.name), conflicts_added: 0 }
        return p
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
      // #88 · `knownContexts` / `switchError` 两格已随名册整条撤除。换成钥匙串：
      // 「一台电脑上有几份档案」现在只有它数得出来（每铸一份 ingest 存一把）。
      tokenIds: Object.keys(JSON.parse(localStorage.getItem('lite2:ownerTokens:v1') || '{}')),
    }
  })

async function main() {
  const server = await createServer({
    root: process.cwd(),
    // 门清仓 2026-07-20（progress.md Blockers 4）：本门此前一跑就崩——createServer 默认会加载
    // vite.config.ts，其 react() 插件要 @babel/core，而本仓共享 node_modules 从来没装过它
    //（实测崩形：`Cannot find package '@babel/core'` at vite:react-babel on main.tsx，白屏、
    // __lite2Store undefined）。门只需要能跑 TSX，不需要 fast-refresh：关掉 configFile、
    // 让 esbuild 原生转 JSX（automatic runtime，与 tsconfig "jsx": "react-jsx" 同口径）。
    configFile: false,
    esbuild: { jsx: 'automatic' },
    // vite.config.ts 被关掉后，这两样必须手动搬过来（照抄，别发散）：
    // · envPrefix：隐私闸——只放 VITE_AVERY_/VITE_SUPABASE_ 进 bundle；
    // · __AVERY_BUILD__：main.tsx 无条件引用这个编译期全局，不 define 就是 ReferenceError 白屏。
    envPrefix: ['VITE_AVERY_', 'VITE_SUPABASE_'],
    define: {
      __AVERY_BUILD__: JSON.stringify({
        mode: 'story',
        locale: 'en',
        apiBase: '(local default 127.0.0.1:8137)',
        commit: '(verify-data-boundary dev server)',
      }),
    },
    cacheDir: join(tmpdir(), 'avery-fixd-vite-cache'),
    // 🔴 host 别删：不显式给它时本机的 vite 只绑 IPv6 回环，这道门就会哑火。见文件上方
    // BASE_CANDIDATES 的注释。
    server: { port: PORT, strictPort: true, host: '127.0.0.1' },
    optimizeDeps: { force: true },
    logLevel: 'warn',
    plugins: oldStoreSource ? [oldStorePlugin()] : [],
  })
  await server.listen()
  try {
    BASE = await waitForServer(BASE_CANDIDATES)
    ENTRY = entryFor(BASE)
  } catch (e) {
    console.error(e.message)
    await server.close()
    process.exit(1)
  }
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

  // ══ B1 · 第二次上传：补进同一份，不许长出第二家 ═════════════════════════════════════
  //
  // 🔴 **#88 整块改判**（Danny 2026-08-10「不要有『新建』的想法」）。
  // 旧口径测的是「第二次上传会换成新 context，但第一份仍在名册里回得去」——那是在**承认**
  // 多档案模型的前提下、给它补一条退路（旧 8 条：名册记账 / 切回去 / 没钥匙报
  // missing-credential）。这一票把前提本身撤了：`uploadFiles` 降级为只在 `contextId === null`
  // 时开火的引导路径，其余一律 `appendFiles` 补进当前这一份。名册、`switchContext`、
  // `ContextSwitchError` 三样都没了，旧 8 条一条不剩地失去被测对象。
  //
  // 改判**没有放宽**，是把同一件事翻了个面：旧条问「第二份回得去吗」，新条问
  // 「**是不是压根没有第二份**」。而且新条更狠——它盯的是**凭据表**
  // （`lite2:ownerTokens:v1`，每铸一份 context 存一把钥匙），不是屏上任何一句话。
  // 谁把 `uploadFiles` 接回「每次都铸新的」，屏幕上很可能一切如常（新档案照样渲染得好好的），
  // 但钥匙串会从 1 把变成 2 把 —— 当场红。
  console.log('\n═══ B1 · 二次上传补进同一份，不再长出第二家 ═══')

  const cidA = await upload(page, ['A公司周报.docx'])
  const afterA = await snapshot(page)
  record('B1-1 自证：第一次上传真的铸出了一份档案（否则下面全是空真）',
    !!cidA && afterA.contextId === cidA && afterA.tokenIds.length === 1,
    `cid=${cidA} tokenIds=${JSON.stringify(afterA.tokenIds)}`)

  const cidB = await upload(page, ['B公司花名册.csv'])
  const afterB = await snapshot(page)
  record('B1-2 🔴 第二次上传落回**同一个** contextId（换了 = 又新建了一家公司）',
    afterB.contextId === cidA && cidB === cidA, `${cidA} -> ${afterB.contextId}`)
  record('B1-3 🔴 钥匙串仍然只有一把（它数的就是「这台电脑上有几份档案」）',
    afterB.tokenIds.length === 1 && afterB.tokenIds[0] === cidA,
    `tokenIds=${JSON.stringify(afterB.tokenIds)}`)
  record('B1-4 锚点也没被改写（还指着同一份）',
    afterB.ls[KEY_CONTEXT] === cidA, `${KEY_CONTEXT}=${afterB.ls[KEY_CONTEXT]}`)

  // 🔴 「没长出第二家」不许靠「第二发根本没发生」蒙混过关——那样上面三条全是空真。
  //    所以还得证明补料**真的跑完了**：新文件进了清单，且状态机停在 ready。
  const appended = await page.evaluate(() => {
    const s = window.__lite2Store.getState()
    return {
      files: s.team?.sourceFiles ?? [],
      appendStatus: s.appendStatus,
      appendError: s.appendError,
      newCompanyStatus: s.newCompanyStatus,
    }
  })
  record('B1-5 🔴 补料这一发真的跑完了（被静默吞掉的话，上面三条都是空真）',
    appended.appendStatus === 'ready' && appended.files.includes('B公司花名册.csv'),
    JSON.stringify(appended))
  // 🔴 委托给 appendFiles 之后**两条状态机仍然分得开**。合并了的话 notifyStore 会把每一次
  //    补料都合成一条「你的团队已就绪」——补一份周报不是团队就绪。
  record('B1-6 🔴 补料走的是自己那条状态机，没有借 ingest 那格（借了 = 每次补料都误报通知）',
    appended.appendStatus === 'ready' && appended.newCompanyStatus === 'ready' &&
      appended.appendError === null,
    JSON.stringify({ append: appended.appendStatus, newCompany: appended.newCompanyStatus }))

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
  // 🔴 **#88 改判**。旧条是「名册（公司数据）跟着清」。名册整条撤除之后它有两种坏法：
  //    留着读 `knownContexts.length` 是**抛异常中断整轮**（字段没了，`undefined.length`）；
  //    只留 `ls[KEY_KNOWN] === undefined` 则是**恒真的空真**（那把键再也没人写了）。
  //    换成它护的那件事的一般形式：换账号之后，**没有任何 `lite2:` 键还留着上一家的
  //    context_id**。名册当年只是这种键里的一个；写成通用形，下一个人再加一个存 cid 的
  //    `lite2:` 键时这条判据自动罩住它，不用有人记得回来补。
  record('m4-3 🔴 换账号后没有任何 lite2:* 键还留着上一家的 context_id',
    !!cidA && !JSON.stringify(afterSwitch.ls).includes(cidA),
    `cidA=${cidA} 残留键=${Object.keys(afterSwitch.ls).join(',') || '(全空)'}`)
  record('m4-4 名册那把键也确实不存在（#88 撤除之后不许有人把它写回来）',
    afterSwitch.ls[KEY_KNOWN] === undefined && seeded.ls[KEY_KNOWN] === undefined,
    `${KEY_KNOWN}: seeded=${seeded.ls[KEY_KNOWN]} after=${afterSwitch.ls[KEY_KNOWN]}`)

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

  // ══ N1 · 并发改 contextId 不许跨公司串数据 ═══════════════════════════════════════════
  //
  // 复核新 finding 1（blocker）原文：`await transport.fetchX(cid)` 期间 contextId 可能被改掉，
  // 而 await 之后那句 `set({ team, ownerToken })` 不回头核对，于是屏上挂着 B 的 id 和锚点、
  // 人却是 A 的人、手里攥的是 A 的 owner_token —— B 公司经理看到 A 公司的整份花名册。
  //
  // 🔴 **#88 改判：触发方式换了，纪律一个字没变。** 旧口径拿「双击名册里的两行」当输入
  //    （`switchContext` × 2）。`switchContext` 随名册整条撤除，那 6 条判据全部失去被测对象。
  //    但 `stillOn` 那道闸**一条都不能松**——改 contextId 的路少了一条，剩下的两条
  //    （换账号清场、登录恢复 `adoptContext`）照样能在 `refreshTeam` 飞行途中把它换掉。
  //    所以这里改用**仍然存在**的那条路当输入：让 fetchTeam 慢下来，飞行中 `adoptContext`
  //    切走，然后断言那份过期载荷**一个字段都没写进去**。
  //    这比旧条难过：旧条至少还有 `switchSeq` 世代号兜底，现在唯一的闸就是 `stillOn` 本身。
  console.log('\n═══ N1 · 取数据途中被切走：过期载荷一个字段都不许写 ═══')

  const page3 = watch(await ctx.newPage())
  await page3.goto(ENTRY, { waitUntil: 'networkidle' })
  await page3.evaluate(() => localStorage.clear())
  await page3.reload({ waitUntil: 'networkidle' })
  await installFakeTransport(page3)

  // 一份真铸出来的档案（引导路径），外加一份"账号名下的另一份"——#88 之后这台电脑不会
  // 自己长出第二份，所以第二个 id 只能来自账号恢复那条路，这里照它的形状造。
  const rA = await upload(page3, ['A公司周报.docx'])
  const rB = await page3.evaluate(() => {
    const cid = 'ctx_from_account_n1'
    const store = JSON.parse(localStorage.getItem('lite2:ownerTokens:v1') || '{}')
    store[cid] = 'tok_' + cid
    localStorage.setItem('lite2:ownerTokens:v1', JSON.stringify(store))
    return cid
  })

  const raced = await page3.evaluate(
    async ({ a, b }) => {
      window.__fakeDelayMs = 250
      const st = () => window.__lite2Store.getState()
      st().adoptContext(a, 'tok_' + a)
      const flying = st().refreshTeam()            // 为 A 取数据，还在飞
      await new Promise((r) => setTimeout(r, 40))  // 40ms 后账号恢复把人切到了 B
      st().adoptContext(b, 'tok_' + b)
      await flying
      // 🔴 必须再等一会儿：脏数据是**先发的那次**在 250ms 之后写进来的。
      //    不等就收摊，这条测试会在坏代码上假过。
      await new Promise((r) => setTimeout(r, 500))
      const s = st()
      window.__fakeDelayMs = 0
      return {
        contextId: s.contextId,
        teamPeople: s.team ? s.team.people.map((p) => p.name) : null,
        ownerToken: s.ownerToken,
        anchor: localStorage.getItem('lite2:contextId:v1'),
      }
    },
    { a: rA, b: rB },
  )

  record('N1-1 落在后切的那一份上（先发的那次不许把 id 拽回去）',
    raced.contextId === rB, JSON.stringify(raced))
  record('N1-2 🔴 屏上的人绝不属于另一家（这就是跨公司串数据本身）',
    JSON.stringify(raced.teamPeople) !== JSON.stringify(['员工-' + rA]),
    `contextId=${raced.contextId} teamPeople=${JSON.stringify(raced.teamPeople)}`)
  record('N1-3 🔴 手里的 owner_token 也是这一家的（错配 → 下一次读被后端 404）',
    raced.ownerToken === 'tok_' + rB, `ownerToken=${raced.ownerToken} expect=tok_${rB}`)
  record('N1-4 锚点跟着落在同一家（刷新不会跳回另一家）', raced.anchor === rB, raced.anchor)

  // ══ N2 · 「我打不开」不等于「这份不存在」 ═════════════════════════════════════════════
  //
  // 🔴 **#88 整块退役，判据搬家而不是消失。** 旧 6 条（N2-1..N2-6）测的是 `switchContext`
  //    吃到 404 时：读成 'unreadable' 而不是 'gone'、不许据此删名册（内存 + localStorage 两处）、
  //    不留半切状态、pending 收干净、以及「名册删除只有用户显式点移除这一条路」。
  //    `switchContext` / `forgetContext` / 名册三样在这一票里一起没了，六条全部失去被测对象。
  //
  //    它护的那条纪律**没有丢，也没有变松**——feat-038 刻意让「不存在」和「你证明不了这是
  //    你的」返回同一个 404，所以绝不许拿一次 404 去销毁任何不可再生的东西。今天守它的是：
  //      · `verify-404-discriminator`（同一 commit 改判）——真 404 之后 `lite2:ownerTokens:v1`
  //        里那把钥匙必须还在。钥匙是现在唯一不可再生的资产（服务端只交出一次），
  //        名册当年扮演的正是这个角色；
  //      · `verify-archive-empty` ③/⑥ —— 清空/补料都不许换 `context_id`、不许动 token；
  //      · store.ts `restoreSession` 的 404 分支那段碑（松的只有锚点，锚点可再生）。
  //    🔴 不要在这里"照着旧代码复活一个类似的 switchContext 场景"——那会让门测一个产品里
  //       不存在的动作，是假绿的另一种长法。

  // ══ N3 · 换到另一份档案时，上一份的 Avery's notes 不许跟过去 ═══════════════════════════
  //
  // 复核新 finding 3（major）原文：`uploadFiles` 用裸 setState 绕开 `adoptContext` 收口，
  // 只重设 team/rawTeam，**唯独漏了 notes** —— 于是上一份的笔记原文原封不动挂在新的
  // contextId 底下，NotesScreen 直接渲染。
  //
  // 🔴 **#88 改判：输入换成「换账号」，被测的收口没换。**
  //    旧口径拿「第二次上传」当输入，因为那时第二次上传就是换一家公司。现在它是补料
  //    （`contextId` 根本不变），笔记本来就该留着——照旧那么测的话 N3-2「确实换到了第二家」
  //    必红，N3-1 则退化成一条恒真的空判据。
  //    今天还能把 contextId 换掉的真实用户路径只剩**换账号**（AuthPanel 的换人 effect →
  //    `adoptContext`）。被测对象一个字没变：id 变了的时候 notes 清不清。
  //    ⚠ 试过、不成立的一条：「登录恢复接管另一份」当输入。AuthPanel 的恢复线有一句
  //      `if (useLite.getState().contextId) return`（手上已有数据就不接管，游客期刚传的
  //      东西不许被登录动作吞掉），所以带着数据登录**根本不会换 id** —— 拿它当输入，
  //      这一组会以「没换成」的形态红，而产品是对的。
  //    ⚠ notes 只活在内存里（不进 localStorage），所以 M2 那组扫 `lite2:*` 键的判据
  //      **一条都够不着它**。这一组不是 M2 的重复。
  console.log('\n═══ N3 · 换账号：上一份的笔记不许跟过去 ═══')

  const page4 = watch(await ctx.newPage())
  await page4.goto(ENTRY, { waitUntil: 'networkidle' })
  await page4.evaluate(() => localStorage.clear())
  await page4.reload({ waitUntil: 'networkidle' })
  await installFakeTransport(page4)

  const nA = await upload(page4, ['A公司周报.docx'])
  const nB = 'ctx_from_account_n3'
  await page4.evaluate(
    ({ cid, verbatim }) => {
      // 只有第一份有笔记；第二份在后端是空的。于是"第二份底下出现内容"只可能是第一份漏过来的。
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
  record('N3-0 前置：第一份底下确实有一条笔记原文（否则本组测试是空转）',
    notesA.notes.some((t) => t.includes(A_VERBATIM)), JSON.stringify(notesA))

  // A → B 换账号，走**真实路径**（同 M2：AuthPanel 的换人 effect，不直接调 clearCompanyScope）。
  // B 账号名下挂着另一份档案，于是清场之后恢复线会把它接管过来 —— id 真的换了。
  await page4.evaluate((cid) => { window.__fakeAccountContexts = [cid] }, nB)
  await page4.evaluate(() => window.__lite2Auth.setState({ status: 'authed', userId: 'user_N3a' }))
  await page4.waitForTimeout(200)
  await page4.evaluate(() => window.__lite2Auth.setState({ status: 'authed', userId: 'user_N3b' }))
  await page4.waitForTimeout(700)

  const notesB = await page4.evaluate(() => {
    const s = window.__lite2Store.getState()
    return { cid: s.contextId, notes: s.notes.map((n) => n.text) }
  })
  record('N3-1 🔴 换账号之后，上一份的笔记原文不在屏上',
    !JSON.stringify(notesB.notes).includes(A_VERBATIM),
    `cid=${notesB.cid} notes=${JSON.stringify(notesB.notes)}`)
  record('N3-2 且确实换到了另一份（不是靠"没换成"蒙混过关）',
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
