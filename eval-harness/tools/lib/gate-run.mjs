// gate-run.mjs —— A 区门的 boot / 上报 / 收尾管线公共件（票 #16，gate-boot-boilerplate）。
//
// ═══ 这个库为什么存在，以及为什么它不是"统一成一种" ═══════════════════════════
// 本库落地**之前**，全仓 39 处 verify-*.mjs 各自手搓 `chromium.launch(`；
// （下面这些数字一律是「迁移前」的存量口径，不是当下实数——每迁一道门它们就少一处。
//  写成不自失效的形式，理由见 run-battery.mjs:87「注释里的计数没人维护就会变成假信息」。）
// 每一处的首访引导 Escape 前奏、
// 视口、networkidle 等待、pageerror 监听、收尾汇总/exit 都是抄邻居抄出来的，抄的时候
// 各自带了点自己的怪癖（下面逐条列）。**大爆炸式迁移会把这些怪癖当"重复代码"一键铲平**——
// 但怪癖往往是某道门的断言真正依赖的前置条件（例如按钮族门必须在 Escape *之前* 先审一遍
// 闸门页自己的按钮，因为闸门页是新访客第一眼；提前把 Escape 挪到 boot 最前面会让那条
// 断言永远采不到闸门页）。所以这里的规矩是：
//
//   **选项化，不是归一化。** 今天多数门的现行行为 = 本文件的默认值；
//   每一处观测到的分歧，都做成一个显式的具名选项，不悄悄"统一"掉。
//   调用方不传选项 = 拿到和它手搓那段一模一样的行为；传了选项 = 显式声明"我这道门不一样"。
//
// ═══ 分歧台账（读了 8 道 A 区门的 boot 段之后的差异清单，覆盖 ticket 要求的 ≥6 道）══
// 读的门：verify-skin-phases / verify-aria-zh / verify-cr-alignment / verify-button-family /
//        verify-status-truth / verify-home-skeleton / verify-switchers / verify-topbar-clearance /
//        verify-contrast-smalltext。
//
//   ① 视口：绝大多数 { width:1280, height:900 }（本文件默认）。
//      verify-cr-alignment 用 1440×900（规格表按更宽视口提取）。
//      verify-topbar-clearance 甚至跑一整个**高度矩阵**（FIXED_VPS 多个高度——让位余量
//      是视口高度的函数，宽度不是变量）。→ 做成 `viewport` 选项，不设默认矩阵。
//
//   ② waitUntil：65 处 'networkidle'，1 处 'commit'。→ 选项 `waitUntil`，默认 'networkidle'。
//
//   ③ 首访引导 Escape 前奏（"两行惯用块"）：迁移前实测 55 处 `keyboard.press('Escape')`，
//      其中典型形态是
//        `if (await page.locator('.lite-onboard').count()) { await page.keyboard.press('Escape'); await page.waitForTimeout(NNN) }`
//      —— 但 NNN 从来没统一过：500/600/700 三种都在用，纯粹是各自抄的时候手感不同，
//      不是有意义的时序信号。→ 选项 `onboardWait`，默认 600（三者的众数附近，且是
//      verify-home-skeleton / verify-switchers 这批"多数门"用的值）。
//      🔴 verify-button-family 是反例：它必须先审一遍闸门页自己的按钮，**再**按 Escape——
//      顺序颠倒会让"闸门页零裸按钮"这条断言测不到闸门页。这是 `dismissOnboard` 必须能
//      被调用方推迟/跳过的理由，不能把 Escape 焊死在 bootPage 内部不可控的位置。
//
//   ④ pageerror 监听：不是所有门都装。verify-skin-phases 完全不装（它只读计算值，
//      不关心 JS 是否报错）；verify-button-family / verify-home-skeleton / verify-status-truth
//      都装，且各自把收集到的 pageErrors 数组喂进末尾一条 "无 pageerror" 断言。
//      → 选项 `trackPageErrors`（默认 false，因为"多数门"其实是指本轮要迁的这几道里，
//      装与不装五五开——不能悄悄替调用方决定它要不要这条断言）。
//
//   ⑤ browser/context 生命周期模型，三种都在用，都不是"错"：
//        (a) 一个 browser，重复开新 context/page（每次都关掉旧的）——verify-skin-phases
//            的 loadWithSnippet；
//        (b) 一个 browser + 一个 context/page 从头用到尾，只在最后 browser.close()——
//            verify-button-family / verify-home-skeleton；
//        (c) 一个 browser，每个"世界"开一个新 context，各自跑完 ctx.close()——
//            verify-status-truth 的 runTeamScreen。
//      → bootPage 支持传入既有 `browser` 复用（模式 a/c），也支持不传就新起一个
//      （模式 b 的常见写法）；不强行把三种模型收编成一种。
//
//   ⑥ rec/R 上报形状：多数门是 3 参数 `rec(name, ok, detail)` + 单一 `R` 数组
//      （本文件 `makeRec()` 抄的就是这个）。但至少两个门明确不是这个形状，本轮**不**
//      强迫它们套进来：
//        · verify-cr-alignment 的 rec 是 4 参数 `rec(n, ok, future, d)`——多一个
//          "未来态不计红"语义（SPEC_STICK 分期），套用 3 参数版会丢信息。
//        · verify-aria-zh 完全不用 R/rec，是 `record(list, name, pass, detail)` 显式传
//          list + 三个独立累积数组（results/pageErrors/emptyTranscripts）分别把关。
//      这正是"断言体不许编辑"这条纪律要保护的东西——本文件只提供多数门在用的那一种
//      形状，其余两种留给它们自己的文件，不勉强收编。
//
//   ⑦ 收尾汇总 + exit：迁移前 19 处 `process.exit(fail ? 1 : 0)`，写法一致。但汇总行怎么算
//      pass/fail 有两种等价写法（`pass=filter(ok).length; fail=R.length-pass` 或反过来），
//      以及 verify-switchers 额外多打印一段"失败项"逐条列名——这是本文件 `finish()`
//      的 `listFailures` 选项的来历（默认 false，因为多数门没有这段）。
//
// ═══ 本票的迁移范围 ═══════════════════════════════════════════════════════════
// 本波只迁了 3 道最具代表性、彼此 boot 模型不同的 A 区门（避开 C 区、避开上传型门
// file-manifest-truth/onboarding-returning/context-switch——真上传会写脏共享 mock 后端
// 的 context，born-red/born-green 反复跑本身就是一种"上传"）：
//   · verify-skin-phases.mjs   —— 模式 ⑤(a)，且完全不装 pageerror（trackPageErrors:false）
//   · verify-button-family.mjs —— 模式 ⑤(b)，Escape 延后到审完闸门页按钮之后
//   · verify-status-truth.mjs —— 模式 ⑤(c)，每个"世界"一个新 context + 各自的 pageerror
// 迁移只换了 boot 段（chromium.launch/goto/Escape 前奏那几行）与收尾段
// （R/rec 声明、末尾汇总 + process.exit），**没有改动任何一条断言的判据**——
// 逐条 rec(...) 调用连同它的字符串文案原样保留。
// verify-aria-zh / verify-cr-alignment 本轮**不迁**：见上面 ⑥ 的理由（形状不兼容，
// 硬套会丢语义），留给下一批单独设计选项。

import { chromium } from 'playwright'

// ── bootPage ──────────────────────────────────────────────────────────────────
// 启动浏览器 → （可选）开一个新 context/page 并导航 → （可选）首访引导 Escape 前奏。
//
// 选项：
//   browser         已有的 Browser 实例就复用（不重新 launch）；不传就新 launch 一个
//                   （headless:true，与全仓现行写法一致，未做成选项——迁移前 39 处无一例外）。
//   base            默认 process.env.VERIFY_BASE || 'http://localhost:5173'。
//   path / url      要去的地址：path 会拼在 base 后面；url 整串覆盖（两者都不传就只
//                   开 browser + page，不导航——供 loadWithSnippet 这类自己控制 goto 时序的调用方用）。
//   viewport        默认 { width:1280, height:900 }（分歧①）。
//   waitUntil       默认 'networkidle'（分歧②）。
//   dismissOnboard  默认 true——导航后立刻做 Escape 前奏。传 false 可以推迟到调用方
//                   自己决定的时机再手动调用 `dismissOnboard(page, { onboardWait })`
//                   （分歧③，button-family 的理由）。
//   onboardWait     Escape 之后的 waitForTimeout 毫秒数，默认 600（分歧③）。
//   trackPageErrors 默认 false；true 时会给 page 挂 `pageerror` 监听，返回的
//                   `pageErrors` 是活数组，调用方自己在断言里读（分歧④）。
export async function bootPage(opts = {}) {
  const {
    browser: existingBrowser,
    base = process.env.VERIFY_BASE || 'http://localhost:5173',
    path: urlPath = '',
    url,
    viewport = { width: 1280, height: 900 },
    waitUntil = 'networkidle',
    dismissOnboard: shouldDismiss = true,
    onboardWait = 600,
    trackPageErrors = false,
  } = opts

  const browser = existingBrowser || (await chromium.launch({ headless: true }))
  const context = await browser.newContext({ viewport })
  const page = await context.newPage()

  const pageErrors = []
  if (trackPageErrors) page.on('pageerror', (e) => pageErrors.push(e.message))

  const target = url || (urlPath ? `${base}${urlPath}` : null)
  if (target) {
    await page.goto(target, { waitUntil })
    if (shouldDismiss) await dismissOnboard(page, { onboardWait })
  }

  return { browser, context, page, pageErrors }
}

// 独立导出：给"Escape 要推迟"的调用方（分歧③，verify-button-family 那种先审闸门页
// 按钮再关闸门的门）手动调时机用，选项与 bootPage 内联的那份完全同源。
export async function dismissOnboard(page, opts = {}) {
  const { onboardWait = 600 } = opts
  if (await page.locator('.lite-onboard').count()) {
    await page.keyboard.press('Escape')
    await page.waitForTimeout(onboardWait)
  }
}

// ── makeRec ───────────────────────────────────────────────────────────────────
// 多数门在用的那种 3 参数 rec(name, ok, detail) + 单一 rows 数组（分歧⑥）。
// 不兼容 cr-alignment 的 4 参数 future 语义、不兼容 aria-zh 的多累积数组模型——
// 那两道本轮不迁，不在这里将就它们。
export function makeRec() {
  const rows = []
  const rec = (name, ok, detail) => {
    rows.push({ name, ok })
    console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' — ' + detail : ''}`)
  }
  return {
    rows,
    rec,                                    // 兼容原有调用形态：`const rec = ...` 直接替换
    ok: (name, detail) => rec(name, true, detail),
    fail: (name, detail) => rec(name, false, detail),
  }
}

// ── finish ────────────────────────────────────────────────────────────────────
// 打印 ═══ 汇总行 ═══，可选关浏览器，process.exit(fail ? 1 : 0)（分歧⑦）。
//
//   rec           makeRec() 返回的对象（读它的 .rows）。
//   label         汇总行里门的名字，比如 '皮相位 E 组'——必填，不给默认值
//                 （36 处这一串各不相同，猜一个默认值毫无意义）。
//   browser       传了就在汇总前 await browser.close()；不传就什么都不关
//                 （调用方已经自己关过、或者要接着用这个 browser 就不传）。
//   listFailures  默认 false。true 时额外打印一段失败项逐条列名
//                 （verify-switchers 那个"失败项"块的来历，本轮没有门用到，
//                  留着选项位置给下一批）。
export async function finish(rec, opts = {}) {
  const { browser, label, listFailures = false } = opts
  if (!label) throw new Error('gate-run.finish(): label 是必填项，不设默认值')
  if (browser) await browser.close()

  const rows = rec.rows
  const fail = rows.filter((r) => !r.ok).length
  const pass = rows.length - fail
  console.log(`\n═══ ${label}：${pass} PASS · ${fail} FAIL ═══`)
  if (listFailures && fail) {
    console.log('\n失败项：')
    for (const r of rows.filter((x) => !x.ok)) console.log(`  ✗ ${r.name}`)
  }
  process.exit(fail ? 1 : 0)
}
