#!/usr/bin/env node
// 全电池 runner —— 把「那些门」从各棒收据的散文里固化成 tracked、可跑、可复现的名单。
//
// ## 为什么有这个文件（考古债）
// `.issues/layout-real-0722/battle-map.md:90` 记着：「23 道」在任何 tracked 文件里都没有逐条
// 名单，它只活在各棒收据的散文里。于是每一棒都要靠人重新回忆「到底哪几道、什么顺序」，
// 顺序错一次就是一轮假红（见下）。本文件就是那张名单本身。
//
// 🔴 清账结论：**实际是 25 道，不是 23 道**（A 19 / B 3 / C 3）。逐条依据见下面的「E3 裁定」。
// 0729 更新：+1 道 answer-split（输出形态战役 03 分流短答）→ **26 道**（A 20 / B 3 / C 3）。
// 0729 更新（files-hub-0729/02）：+1 道 context-switch（多库切换 + forget 源码闸）
//   → **27 道**（A 21 / B 3 / C 3）。它是**上传型门**，与 file-manifest-truth /
//   onboarding-returning 同罪：绝不能排到 C 区之后，否则就是往生产库里写测试数据。
// 票 #14 更新：+1 道 flow-gap-phases（B/C 组判定：triage/follow-ups + "A closer look" 差距卡，
//   snippet 1537-2074 行那 7 个断言函数此前零机械化 runner）→ **28 道**（A 22 / B 3 / C 3）。
//   同样归入 A 区上传型门那一挂——它走真 HTTP 打本地 mock 后端（不是 `?transport=stub`，那个
//   参数在 `vite build` 产物里是死的，见该门文件头注释），零花费但真上传，不能排到 C 区之后。
//
// ## 三段序是铁律，不是习惯
//   ① 电池必须**独占跑**：与 agent 工作流并发会撞 CPU 超时，出假红（棒4 出过 6 条假红）。
//   ② 顺序 A → B → C。C 区是 **dist 调包者**（自己 spawn `vite build` 把 dist 换掉），
//      序错了中段的 visual / button-family **必红**——四次实证。
//   ③ C 区跑完 dist 已经不是健康的 dev dist 了，必须重建（本 runner 默认自动重建）。
//
// ## 🔴 verify-bundle-privacy 的毒性（2026-07-20 真事故）
// 它 `execFileSync(vite build)` **不带** VITE_AVERY_API_BASE → dist 落回 vite.config.ts 的默认值
// = **生产域名**。跑完它以后，对着 `vite preview` 跑任何会上传的门 = 往**生产库**写测试数据。
// 07-20 就这么让三个「员工花名册.csv」落进了生产 context。
// → 本 runner 在 C 区之后强制重建 dist，并大字提示：碰上传路径前先在浏览器里确认
//   `window.__AVERY_BUILD__.apiBase`。
//
// ## 死件：以下 7 个 tracked 的 verify-*.mjs **故意不收**
//   · .issues/v02-partner-align-0718/verify-server.mjs
//       —— 它是**启动器不是门**：46 行，零 process.exit / 零 exitCode，跑起来就挂着不退出。
//          它的用途是给 verify-p0 起一个独立 cacheDir 的 dev server（避免多 worktree 共用
//          node_modules/.vite 互相判缓存 outdated → 504 白屏）。收进电池会直接卡死电池。
//   · .issues/v02-partner-align-0718/verify-fixA.mjs
//   · .issues/v02-partner-align-0718/verify-fixA-live.mjs
//   · .issues/v02-partner-align-0718/verify-fixB-transport.mjs
//       —— 三重过时：fixA/fixB 那一轮的一次性回归门，锁的是 07-19 那批修复当时的字面量与
//          端口（fixA-live 要 8301/5301、fixB-transport 现场 tsc 转 transport.ts 并塞掉
//          authStore）。它们证明过的行为，早已被 verify-status-truth / verify-p0 /
//          verify-file-manifest-truth 以更硬的形态覆盖。
//   · .issues/v02-partner-align-0718/verify-fixB-upload-ui.mjs
//   · .issues/v02-partner-align-0718/verify-fixB-upload-layout.mjs
//       —— 同上，且各自写死 5302 / 8302 隔离端口 + 要求单独重打 dist（等于第二批调包者），
//          断言内容（文件状态可见）已被 verify-file-manifest-truth 覆盖。
//   · .issues/v02-partner-align-0718/verify-blockers.mjs
//       —— 第二轮对抗审查那 5 条 blocker 的一次性复验，写死 8137/5173 并**真上传**语料到
//          共享 mock 后端，会污染同一批门共用的 context。
// （battle-map.md:88 把 fixB-upload-ui / fixB-upload-layout 记作一项，所以那里写「6 个」，
//   按文件数是 7 个。）
//
// ## E3 裁定：第 23 道是哪个 —— 见 §ROSTER 尾部注释
//
// ## 跑法
//   cd /d/avery && node eval-harness/tools/run-battery.mjs              # A→B→C 全量 + 终局重建
//   cd /d/avery && node eval-harness/tools/run-battery.mjs --only=A     # 只跑 A 区（最常用）
//   cd /d/avery && SPEC_STICK=5 node eval-harness/tools/run-battery.mjs --only=A
//   cd /d/avery && node eval-harness/tools/run-battery.mjs --from=button-family
//   cd /d/avery && node eval-harness/tools/run-battery.mjs --dry        # 只打印将要跑什么
//   环境变量：VERIFY_BASE（默认 http://localhost:5173）· SPEC_STICK（透传给 cr-alignment）
//   开关：--only=A|B|C · --from=<门名子串> · --dry · --no-rebuild（C 区后不自动重建）
//
// 退出码：0 = 全绿；1 = 有红（或 C 区后重建失败）。

import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')           // <repo>/eval-harness/tools → <repo>
const BASE = process.env.VERIFY_BASE || 'http://localhost:5173'

// ── ROSTER ────────────────────────────────────────────────────────────────────
// 字段：
//   zone      A|B|C
//   name      短名（--from 匹配这个子串）
//   cmd       node 之后的 argv（相对仓库根）
//   host      这道门吃什么前端：
//               'preview'  = 共享 preview :5173（本仓 vite dev 起不来，一律 build+preview）
//               'self'     = 门自己起服务器（不碰 5173）
//               'rebuild'  = 门自己 spawn `vite build` —— **调包者**
//   backend   是否需要 mock 后端 :8137（AVERY_BRAIN=mock 三件套）
//             🔴 这个字段**不参与调度**，它只印在预检清单里给人看——所以它写错了不会有任何
//             东西报警，只会把读它的人送去一个错误的结论。已经错过四次（2026-08-02 的
//             status-truth，2026-08-03 的 topbar-clearance / contrast-smalltext /
//             handoffs-empty-honesty），错法完全一样：门里有真 `uploadFiles` 却写着 false。
//             改 ROSTER 时的自查（别靠眼睛看 note）：
//               grep -l "uploadFiles" $(git ls-files "*verify-*.mjs")
//             凡命中且不是注释/假 transport（verify-data-boundary 那种 setTransport(fake)
//             不算）的，backend 必须为 true，且 note 里要挂 🔴 上传型门 + "绝不能排在 C 区之后"
//             ——因为 C 区跑完 dist 指向生产域名，此后任何真上传都是往生产库写数据。
//   dist      true = 跑完 dist 已被换掉（调包者）
//   env       额外环境变量
//   note      口径备注
const ROSTER = [
  // ── A 区 · 吃共享 preview:5173（先跑）──────────────────────────────────────
  //   ⚠ 这里以前写着「N 道」，然后**每加一道门就烂一次**：长期写 17 而实际 20，
  //   files-hub-0729/02 加 context-switch 后是 21，票 #14 加 flow-gap-phases 后是 22，
  //   票 #37 加 detail-provenance 后是 23……每次都是下一个人顺手改对。
  //   所以这行不再写数字了。要数就让程序数：
  //     node eval-harness/tools/run-battery.mjs --only=A --dry-run   （抬头那行就是实数）
  //   同理，任何"本区共 N 道"的话都别写进注释——写成自查命令。
  { zone: 'A', name: 'topbar-clearance',      cmd: ['eval-harness/tools/verify-topbar-clearance.mjs'],            host: 'preview', backend: true,  dist: false, note: '九屏×两皮顶栏让位几何。🔴 上传型门（:141 真 uploadFiles 造"满世界"，两皮各一次＝每跑一遍造 2 个 context）；**绝不能排在 C 区之后**。⚠ 2026-08-03 修：此前写 backend:false —— 它排在 A1、位置一直安全所以没咬到人，但照那个字段以为它能离线跑就会拿到一份没有满态的假绿' },
  { zone: 'A', name: 'cr-alignment',          cmd: ['eval-harness/tools/verify-cr-alignment.mjs'],                host: 'preview', backend: true,  dist: false, note: '规格表逐行断言；吃 SPEC_STICK（row.stick > N 打 [FUTURE] 不计红）' },
  { zone: 'A', name: 'skin-phases',           cmd: ['eval-harness/tools/verify-skin-phases.mjs'],                 host: 'preview', backend: false, dist: false, note: '不碰后端——因为它的断言只读 CSS 计算值、从不 fetch。⚠ 不是因为 ?transport=stub 生效：那个参数在 `vite build` 产物里恒为死开关（store.ts:385 的 DEV 闸静态为 false），本仓门环境一律 build+preview，别照抄「走 stub 所以离线」这个理由去写新门（票 #14 实测）' },
  { zone: 'A', name: 'button-family',         cmd: ['eval-harness/tools/verify-button-family.mjs'],               host: 'preview', backend: true,  dist: false, note: '新按钮必须挂 .lite-btn 或进白名单；🔴 序错（dist 被调包）时这道必假红' },
  { zone: 'A', name: 'contrast-smalltext',    cmd: ['eval-harness/tools/verify-contrast-smalltext.mjs'],          host: 'preview', backend: true,  dist: false, note: 'AA 4.5 硬地板。🔴 上传型门（driveShell 每壳一次真 uploadFiles，三壳＝每跑一遍造 3 个 context）；**绝不能排在 C 区之后**。⚠ 2026-08-03 修：此前写 backend:false —— 离线跑实测 23 PASS · 5 FAIL（上传失败落进错误态，`upload-error-label` 反而被采样并击穿 AA），是"看着像回归的假红"' },
  { zone: 'A', name: 'home-skeleton',         cmd: ['eval-harness/tools/verify-home-skeleton.mjs'],               host: 'preview', backend: false, dist: false, note: '空态骨架零数字' },
  { zone: 'A', name: 'status-truth',          cmd: ['eval-harness/tools/verify-status-truth.mjs'],                host: 'preview', backend: true,  dist: false, note: '🔴 上传型门（uploadAndGoTeam 真发 POST /ingest + route.fetch 真打后端）；absent ≠ none 的仲裁者；**绝不能排在 C 区之后**。⚠ 2026-08-02 修：此前 backend 字段写的是 false 且没挂上传型标记——排位一直安全所以没咬到人，但照那个字段以为它能离线跑、或用 --from 把它拎到 C 区之后，就是往生产库写数据' },
  { zone: 'A', name: 'room-nomaterial',       cmd: ['eval-harness/tools/verify-room-nomaterial.mjs'],             host: 'preview', backend: false, dist: false, note: '无材料 gate' },
  { zone: 'A', name: 'room-usability',        cmd: ['eval-harness/tools/verify-room-usability.mjs'],              host: 'preview', backend: true,  dist: false, note: '遮挡几何 + elementFromPoint' },
  { zone: 'A', name: 'answer-split',          cmd: ['eval-harness/tools/verify-answer-split-03.mjs'],             host: 'preview', backend: true,  dist: false, note: '0729/03 分流短答：事实问→气泡无卡、判断问→卡无气泡（宁漏勿错杀钉子）+ v01 镜像' },
  { zone: 'A', name: 'handoffs-empty-honesty', cmd: ['eval-harness/tools/verify-handoffs-empty-honesty.mjs'],     host: 'preview', backend: true,  dist: false, note: '空态不许编造交接。🔴 上传型门（driveShell 每壳一次真 uploadFiles，两壳＝每跑一遍造 2 个 context）；**绝不能排在 C 区之后**。⚠ 2026-08-03 修：此前写 backend:false —— 离线跑实测直接**未捕获异常崩掉**（briefing 为 null），不是 FAIL 而是压根没跑到断言' },
  { zone: 'A', name: 'switchers',             cmd: ['eval-harness/tools/verify-switchers.mjs'],                   host: 'preview', backend: false, dist: false, note: '顶栏右簇 皮/语/版 三切换器' },
  { zone: 'A', name: 'aria-zh',               cmd: ['eval-harness/tools/verify-aria-zh.mjs'],                     host: 'preview', backend: true,  dist: false, note: '扫 aria-label/title/alt（扫不到 placeholder）' },
  { zone: 'A', name: 'onboard-gate',          cmd: ['eval-harness/tools/verify-onboard-gate.mjs'],                host: 'preview', backend: true,  dist: false, note: '要 demo seed（AVERY_DEMO_SEED_DIR）；额外吃 VERIFY_API 默认 8137。onboarding-accounts-0805 起含世界 G（预览模式：不只断言横幅在场，而是在三个持久化面各留一笔再退出、断言 localStorage 逐字节未变）' },
  { zone: 'A', name: 'intake-tables',         cmd: ['eval-harness/tools/verify-intake-tables.mjs'],               host: 'preview', backend: true,  dist: false, note: '🔴 上传型门（onboarding-accounts-0805 ②；E 段真发 POST /ingest/structured，每跑一遍造 1 个 context）；**绝不能排在 C 区之后**。39 判据：7 表导航/表头逐字/容器内滚 · 真剪贴板 paste 事件（中文姓名 + 含顿号 + 引号包裹含换行三种单元格）· 单元格级校验五型 · 红线前移**两侧同量**（前端标红的四种写法，同一段再直打端点断言 422）· 表格+文件合一发＝一个 context。额外吃 VERIFY_API 默认 8137' },
  { zone: 'A', name: 'p0',                    cmd: ['.issues/v02-partner-align-0718/verify-p0.mjs'],              host: 'preview', backend: true,  dist: false, note: '🔴 必须打 5173：后端 CORS 是精确匹配的固定 origin 列表；含锁词硬闸 Nexus/nexus/现实差距' },
  { zone: 'A', name: 'zh-purity',             cmd: ['.issues/feat-068-frontend-deploy/verify-zh-purity.mjs'],     host: 'preview', backend: true,  dist: false, note: '扫 innerText 英文残留' },
  { zone: 'A', name: 'bare-url-shell',        cmd: ['.issues/feat-068-frontend-deploy/verify-bare-url-shell.mjs'], host: 'preview', backend: false, dist: false, note: '裸 URL（无 ?v=2&mode=live）落 story 壳是对的' },
  { zone: 'A', name: '404-discriminator',     cmd: ['.issues/feat-068-frontend-deploy/verify-404-discriminator.mjs'], host: 'preview', backend: true, dist: false, note: '要真 404 —— preview 的 SPA fallback 与真 404 必须能区分' },
  // ↓ A18/A19：battle-map 把这两道记作「准调包者」排在 C 区附近；2026-07-22 实跑推翻（见 §E3 裁定）。
  //   它们**真上传**，所以必须留在 A 区（C 区之后 dist 指向生产域名，跑它们 = 往生产库写数据）。
  { zone: 'A', name: 'file-manifest-truth',   cmd: ['eval-harness/tools/verify-file-manifest-truth.mjs'],          host: 'preview', backend: true,  dist: false, note: '🔴 上传型门（真传一份好文件 + 一份结构性损坏 PDF）；30 判据；**绝不能排在 C 区之后**' },
  { zone: 'A', name: 'onboarding-returning',  cmd: ['eval-harness/tools/verify-onboarding-returning.mjs'],         host: 'preview', backend: true,  dist: false, note: '🔴 上传型门（铺垫一次真上传造"返回访客"）；15 判据；**绝不能排在 C 区之后**' },
  { zone: 'A', name: 'context-switch',        cmd: ['eval-harness/tools/verify-context-switch.mjs'],               host: 'preview', backend: true,  dist: false, note: '🔴 上传型门（真传两批造多库）；15 判据；files-hub-0729/02 多库切换 + forget 只许显式触发的源码闸；**绝不能排在 C 区之后**' },
  { zone: 'A', name: 'bottom-furniture',     cmd: ['eval-harness/tools/verify-bottom-furniture-clearance.mjs'],   host: 'preview', backend: true,  dist: false, note: '🔴 上传型门（票 #34/#36；空态两条都不复现——AskAveryLauncher 在 contextId=null 时整块不挂载）；**绝不能排在 C 区之后**。判据是 elementFromPoint 真命中，不是几何重叠；只把「劫持者是屏底锚定 fixed/sticky 家具」判红（顶栏遮挡滚动内容不算）。⚠ 审前先剔除被祖先 overflow 裁掉的控件——rect 不管裁剪，不剔会假红' },
  { zone: 'A', name: 'detail-provenance',     cmd: ['eval-harness/tools/verify-detail-provenance.mjs'],            host: 'preview', backend: true,  dist: false, note: '🔴 上传型门（票 #37；真传 demo-seed 全量造多文件工作区，每跑造 2 个 context——v02/v01 各一）；**绝不能排在 C 区之后**。判据是「详情卡可见文本里不许出现任何工作区级文件名」，不是「某个 class 不存在」——换组件重新实现同一个谎也逃不掉。带两条自证判据防空跑（文件清单非空 + 浮层真开着且渲染了本卡内容）' },
  { zone: 'A', name: 'flow-gap-phases',       cmd: ['eval-harness/tools/verify-flow-gap-phases.mjs'],              host: 'preview', backend: true,  dist: false, note: '🔴 上传型门（票 #14；手写种子造 gapDerive 要的"自报稳/真有卡点"矛盾）；triage/follow-ups(B组4判据)+差距卡(C组3判据)；`?transport=stub` 在这份 dist 上是死的（DEV 静态 false），走真 mock 后端；**绝不能排在 C 区之后**' },
  { zone: 'A', name: 'locale-parity',         cmd: ['eval-harness/tools/verify-locale-parity.mjs'],                host: 'preview', backend: true,  dist: false, note: '🔴 上传型门（票 #38 / ADR-0033；同一份 demo-seed 中文语料跑 zh/en 两遍，每遍一次真 uploadFiles + 一次真 /advise ＝ 每跑一遍造 2 个 context）；**绝不能排在 C 区之后**。四条判据分别盯语言的四个面：①界面壳无异语残留 ②后端派生文案语言正确 ③LLM 正文语言==请求 locale ④引文仍是原文（逐字出自语料）。判据写白名单（"必须是这三个词之一"），每条主判据前面带自证判据。⚠ 两把尺子别混用：壳残留用宽 CJK（要逮全角冒号），引文用只认汉字的 HAN——born-red 实测宽尺子会对着被翻译的引文全绿' },

  // ── B 区 · 自带服务器 / 像素基线（3 道，中段）───────────────────────────────
  { zone: 'B', name: 'data-boundary',         cmd: ['.issues/v02-partner-align-0718/verify-data-boundary.mjs'],   host: 'self',    backend: false, dist: false, note: '自起 dev server :5304（VERIFY_PORT 可改）；可选 VERIFY_OLD_STORE=<git-ref> 做 born-red' },
  { zone: 'B', name: 'null-owner',            cmd: ['.issues/v02-joint-0719/verify-null-owner.mjs'],              host: 'preview', backend: true,  dist: false, note: '⚠️ battle-map 把它归在「自带服务器」的 B 区，但它其实写死打共享 5173（:28 `const UI`，无 VERIFY_BASE）。位置照抄 battle-map 不动（换序＝换风险），此处记档口径' },
  { zone: 'B', name: 'visual-baseline',       cmd: ['node_modules/playwright/cli.js', 'test', '-c', 'eval-harness/visual'], host: 'preview', backend: true, dist: false, note: '像素基线 36 张（9屏×2皮×2视口）；🔴 序错（dist 被调包）时这道必假红；重冻要 --update-snapshots 且只在人审对照板通过后' },

  // ── C 区 · 🔴 dist 调包者，殿后且独占跑（3 道）────────────────────────────
  { zone: 'C', name: 'auth-capability',       cmd: ['eval-harness/tools/verify-auth-capability.mjs'],             host: 'rebuild', backend: false, dist: true,  note: 'spawn(vite build) 带假 Supabase key + VITE_AVERY_API_BASE=127.0.0.1:8281，自起 preview 5281；**不还原 dist**' },
  { zone: 'C', name: 'auth-form',             cmd: ['eval-harness/tools/verify-auth-form.mjs'],                   host: 'rebuild', backend: false, dist: true,  note: '同款，端口 5291 / API 8291；**不还原 dist**' },
  { zone: 'C', name: 'bundle-privacy',        cmd: ['eval-harness/tools/verify-bundle-privacy.mjs'],              host: 'rebuild', backend: false, dist: true,  note: '🔴 最毒：execFileSync(vite build) **不带 api base** → dist 落回 vite.config.ts 默认 = 生产域名' },
]

// ── E3 裁定 · 「第 23 道到底是哪个」→ 答案：**根本不是 23 道，是 25 道** ──────
// battle-map.md:90 说第 23 道无法从文档唯一确定，点名三个候选：verify-null-owner /
// verify-404-discriminator / verify-bare-url-shell。
//
// 2026-07-22 用 `git ls-files "*verify-*.mjs"` 拉全量（31 个）逐个实跑，裁定如下：
//
//   ① 三个候选**全都在册**，而且都不是"第 23 道"这种边缘身份 ——
//      verify-bare-url-shell（A16，3.6s 绿）· verify-404-discriminator（A17，4 判据全绿）·
//      verify-null-owner（B2）。battle-map 的 A 区 17 道原样成立，一道不多一道不少。
//
//   ② 真正的错，是 battle-map 把这两道**误判成「准调包者」**排到了 C 区附近：
//        · eval-harness/tools/verify-file-manifest-truth.mjs
//        · eval-harness/tools/verify-onboarding-returning.mjs
//      理由写的是「要求你手工重打 dist（VITE_AVERY_API_BASE 是构建期常量）」。
//      但那段是它们**文件头里的隔离卫生建议**（各自钉 8307/5307、独立端口/5299，
//      为的是不把上传语料混进别人的 context），**不是硬前置**：
//      `vite build --mode development` 不带 VITE_AVERY_API_BASE 时 dist 默认就打 8137，
//      正是共享 preview:5173 的那份 dist。实跑证据（2026-07-22，对着共享 5173/8137）：
//        VERIFY_BASE=http://localhost:5173 node eval-harness/tools/verify-file-manifest-truth.mjs
//          → 「文件清单诚实性：30 PASS · 0 FAIL」exit 0
//        VERIFY_BASE=http://localhost:5173 node eval-harness/tools/verify-onboarding-returning.mjs
//          → 「判据：15 PASS · 0 FAIL」exit 0
//      能跑通 + 有真断言 = 收。它们进 A 区尾（A18 / A19）。
//
//   ③ 于是真实数量：
//        31 个 tracked verify-*.mjs
//         − 7 个死件（文件头列了，逐个给了不收的理由）
//         = 24 个活的 .mjs 门
//         + 1 道 playwright 像素基线（不是 verify-*.mjs，但它是电池的一员）
//         = **25 道**（A 19 / B 3 / C 3）
//      「23 道」这个数是散文里传下来的旧口径，本次清账后**作废**。
//      🔴 纪律：不为了凑 23 收一个死件，也不为了凑 23 删一个活件 —— 所以这里是 25 不是 23。
//
//   ④ 🔴 A18/A19 是**上传型门**，位置有硬约束：必须在 C 区**之前**。
//      C 区跑完 dist 指向生产域名，那之后跑任何上传型门 = 往生产库写测试数据
//      （2026-07-20 真发生过）。把它们排在 C 区附近正是这个事故的复发路径。

// ── CLI ───────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2)
const arg = (k) => {
  const hit = argv.find((a) => a === `--${k}` || a.startsWith(`--${k}=`))
  if (!hit) return null
  return hit.includes('=') ? hit.slice(hit.indexOf('=') + 1) : true
}
const only = arg('only')
const from = arg('from')
const dry = !!arg('dry')
const noRebuild = !!arg('no-rebuild')
// 🔴 SPEC_STICK 必须有默认值，不能只做透传（棒A 对抗审查逮到的 BLOCKER）。
// verify-cr-alignment.mjs:30 是 `process.env.SPEC_STICK ? Number(...) : Infinity`
// —— 不设 = 全量硬断言 = 把「红先行」的未来态规格行全部算成回归红。
// 于是 `run-battery.mjs --only=A` 这个「最常用跑法」会恒红、exit 1，
// AFK 自跑自验以 exit code 为准时这是一条永久假红，
// 且 plan.md 棒H 的收官判据「全电池连续两轮零红」永远达不到。
// 默认取 CURRENT_STICK（＝当前已交付的最高棒）；跑收官全量断言时显式 SPEC_STICK=99。
const CURRENT_STICK = '12'
const stick = process.env.SPEC_STICK || CURRENT_STICK

let plan = ROSTER.slice()
if (only) {
  const zones = String(only).toUpperCase().split(/[,\s]+/).filter(Boolean)
  plan = plan.filter((g) => zones.includes(g.zone))
}
if (from) {
  const i = plan.findIndex((g) => g.name.includes(String(from)))
  if (i < 0) {
    console.error(`--from=${from} 没匹配到任何门。可选：${plan.map((g) => g.name).join(', ')}`)
    process.exit(2)
  }
  plan = plan.slice(i)
}
if (plan.length === 0) {
  console.error('计划为空 —— 检查 --only / --from')
  process.exit(2)
}

const zoneOf = (z) => plan.filter((g) => g.zone === z).length
const hasC = zoneOf('C') > 0

console.log('═'.repeat(78))
console.log(`全电池 runner · A→B→C 三段序 · VERIFY_BASE=${BASE}${stick ? ` · SPEC_STICK=${stick}` : ''}`)
console.log(`计划 ${plan.length} 道（A ${zoneOf('A')} / B ${zoneOf('B')} / C ${zoneOf('C')}）${dry ? ' · DRY RUN' : ''}`)
console.log('═'.repeat(78))
for (const g of plan) {
  const host = g.host === 'preview' ? `preview ${BASE}` : g.host === 'self' ? '自带服务器' : '自己 vite build（调包者）'
  console.log(`  [${g.zone}] ${g.name.padEnd(22)} 前端=${host.padEnd(30)} 后端=${g.backend ? '要' : '不要'}${g.dist ? '  🔴 dist 调包者' : ''}`)
  console.log(`      ${g.note}`)
}
console.log('')

if (hasC) {
  console.log('🔴🔴🔴 计划里含 C 区 dist 调包者 ——')
  console.log('      C 区必须**独占跑**（别和别的 agent 工作流并发），且必须**殿后**。')
  console.log('      跑完 dist 已不是健康的 dev dist。' + (noRebuild ? '你传了 --no-rebuild，自己重建。' : 'runner 会自动重建。'))
  console.log('')
}

if (dry) {
  console.log('（--dry：什么都没跑）')
  process.exit(0)
}

// ── 跑 ────────────────────────────────────────────────────────────────────────
const results = []
for (const g of plan) {
  const label = `[${g.zone}] ${g.name}`
  console.log('─'.repeat(78))
  console.log(`▶ ${label}   (${g.cmd.join(' ')})`)
  console.log('─'.repeat(78))
  const t0 = Date.now()
  const env = { ...process.env, VERIFY_BASE: BASE, ...(g.env || {}) }
  env.SPEC_STICK = stick
  const r = spawnSync(process.execPath, g.cmd, { cwd: ROOT, env, stdio: 'inherit' })
  const ms = Date.now() - t0
  const ok = r.status === 0
  results.push({ ...g, ok, ms, code: r.status, err: r.error ? String(r.error) : null })
  console.log(`\n  ⇒ ${ok ? 'PASS' : 'FAIL'}  ${label}  ${(ms / 1000).toFixed(1)}s${ok ? '' : `  (exit ${r.status}${r.error ? ' / ' + r.error : ''})`}\n`)
}

// ── 终局重建（C 区跑过就必须做）─────────────────────────────────────────────
let rebuildOk = null
const ranDistSwapper = results.some((r) => r.dist)
if (ranDistSwapper && !noRebuild) {
  console.log('═'.repeat(78))
  console.log('终局重建健康 dev dist（C 区把 dist 换掉了）')
  console.log('═'.repeat(78))
  const tsc = spawnSync(process.execPath, ['node_modules/typescript/bin/tsc', '-b'], { cwd: ROOT, stdio: 'inherit' })
  const build = tsc.status === 0
    ? spawnSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--mode', 'development'], { cwd: ROOT, stdio: 'inherit' })
    : { status: tsc.status }
  rebuildOk = build.status === 0
  console.log(`\n  ⇒ 重建 ${rebuildOk ? 'OK' : '失败'}\n`)
}

// ── 汇总 ──────────────────────────────────────────────────────────────────────
const green = results.filter((r) => r.ok).length
console.log('═'.repeat(78))
console.log('汇总')
console.log('═'.repeat(78))
for (const r of results) {
  console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  [${r.zone}] ${r.name.padEnd(22)} ${(r.ms / 1000).toFixed(1)}s${r.ok ? '' : `  exit=${r.code}`}`)
}
console.log('')
console.log(`  ${green}/${results.length} 绿`)
const reds = results.filter((r) => !r.ok)
if (reds.length) console.log(`  红：${reds.map((r) => r.name).join(', ')}`)
console.log('')

if (ranDistSwapper) {
  console.log('🔴🔴🔴 dist 已被 C 区换过。')
  console.log('🔴  碰任何上传路径之前，先在浏览器 console 确认：window.__AVERY_BUILD__.apiBase')
  console.log('🔴  verify-bundle-privacy 打出来的 dist 指向**生产域名** —— 对着它上传 = 往生产库写测试数据')
  console.log('🔴  （2026-07-20 真发生过：三个「员工花名册.csv」落进生产 context）')
  if (rebuildOk === true) console.log('   ✅ runner 已重建 dev dist；仍然请确认 apiBase 再动上传。')
  else if (rebuildOk === false) console.log('   ❌ 自动重建失败 —— 手动跑：node node_modules/typescript/bin/tsc -b && node node_modules/vite/bin/vite.js build --mode development')
  else console.log('   ⚠️ 你传了 --no-rebuild —— 手动跑：node node_modules/typescript/bin/tsc -b && node node_modules/vite/bin/vite.js build --mode development')
  console.log('')
}

process.exit(reds.length || rebuildOk === false ? 1 : 0)
