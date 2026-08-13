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
// 0729 更新（files-hub-0729/02）：+1 道 context-switch（多库切换 + forget 源码闸）。
// 🔴 **#88（2026-08-10）把 context-switch 整条退役并删了文件**——它的前提是「一台电脑上有
//   两份档案」，而 Danny 拍板撤掉「新建一家公司」之后一台电脑恒 1 份，那 15 条判据一条都
//   不再有被测对象。**主动退役、不等它报警**：它 ⑥ 的两条是**源码级**判据
//   （`forgetContext` 不许出现在 `catch` 里），`forgetContext` 被删之后那两条会**静默变绿**，
//   一道全绿的门会一直冒充"多库切换还被守着"。判据的被测对象没了要主动摘，别等红。
//   （它的两条真纪律没有丢：并发写不许串公司 → `stillOn` + `verify-data-boundary` M2/M3；
//     不许拿一次失败去销毁凭据 → `restoreSession` 那段碑 + `verify-404-discriminator`。）
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
  { zone: 'A', name: 'v2boots',               cmd: ['eval-harness/tools/verify-v2boots.mjs'],                     host: 'preview', backend: false, dist: false, note: '#63 固化：顶栏 tab 序列 vs snippet assertV2Boots 期望数组。此前该相位零机械 runner——「tabs 数组与门期望不同步」在电池里没人会红；LiteTopbar tabs 数组注释里那块「同一 commit 同步」的碑，靠这道门才有牙。断言只读顶栏 DOM，离线' },
  { zone: 'A', name: 'button-family',         cmd: ['eval-harness/tools/verify-button-family.mjs'],               host: 'preview', backend: true,  dist: false, note: '新按钮必须挂 .lite-btn 或进白名单；🔴 序错（dist 被调包）时这道必假红' },
  { zone: 'A', name: 'contrast-smalltext',    cmd: ['eval-harness/tools/verify-contrast-smalltext.mjs'],          host: 'preview', backend: true,  dist: false, note: 'AA 4.5 硬地板。🔴 上传型门（driveShell 每壳一次真 uploadFiles，三壳＝每跑一遍造 3 个 context）；**绝不能排在 C 区之后**。⚠ 2026-08-03 修：此前写 backend:false —— 离线跑实测 23 PASS · 5 FAIL（上传失败落进错误态，`upload-error-label` 反而被采样并击穿 AA），是"看着像回归的假红"' },
  { zone: 'A', name: 'home-skeleton',         cmd: ['eval-harness/tools/verify-home-skeleton.mjs'],               host: 'preview', backend: false, dist: false, note: '空态骨架零数字' },
  { zone: 'A', name: 'status-truth',          cmd: ['eval-harness/tools/verify-status-truth.mjs'],                host: 'preview', backend: true,  dist: false, note: '🔴 上传型门（uploadAndGoTeam 真发 POST /ingest + route.fetch 真打后端）；absent ≠ none 的仲裁者；**绝不能排在 C 区之后**。⚠ 2026-08-02 修：此前 backend 字段写的是 false 且没挂上传型标记——排位一直安全所以没咬到人，但照那个字段以为它能离线跑、或用 --from 把它拎到 C 区之后，就是往生产库写数据' },
  { zone: 'A', name: 'room-nomaterial',       cmd: ['eval-harness/tools/verify-room-nomaterial.mjs'],             host: 'preview', backend: false, dist: false, note: '无材料 gate' },
  { zone: 'A', name: 'room-claude-rework',    cmd: ['eval-harness/tools/verify-room-claude-rework.mjs'],          host: 'preview', backend: true,  dist: false, note: '🔴 上传型门（真 /ingest + 真 /advise + 真 POST /team/{id}/files）；46 判据；**绝不能排在 C 区之后**。#75+#73：三态统一(发问零跳变量 x/y/宽)、停止→interrupted 诚实终态、Shift+Enter、markdown 敌意语料 XSS、附件上限预检零请求' },
  { zone: 'A', name: 'room-usability',        cmd: ['eval-harness/tools/verify-room-usability.mjs'],              host: 'preview', backend: true,  dist: false, note: '遮挡几何 + elementFromPoint' },
  { zone: 'A', name: 'answer-split',          cmd: ['eval-harness/tools/verify-answer-split-03.mjs'],             host: 'preview', backend: true,  dist: false, note: '0729/03 分流短答：事实问→气泡无卡、判断问→卡无气泡（宁漏勿错杀钉子）+ v01 镜像' },
  { zone: 'A', name: 'handoffs-empty-honesty', cmd: ['eval-harness/tools/verify-handoffs-empty-honesty.mjs'],     host: 'preview', backend: true,  dist: false, note: '空态不许编造交接。🔴 上传型门（driveShell 每壳一次真 uploadFiles，两壳＝每跑一遍造 2 个 context）；**绝不能排在 C 区之后**。⚠ 2026-08-03 修：此前写 backend:false —— 离线跑实测直接**未捕获异常崩掉**（briefing 为 null），不是 FAIL 而是压根没跑到断言' },
  { zone: 'A', name: 'switchers',             cmd: ['eval-harness/tools/verify-switchers.mjs'],                   host: 'preview', backend: false, dist: false, note: '顶栏右簇 皮/语/版 三切换器' },
  { zone: 'A', name: 'aria-zh',               cmd: ['eval-harness/tools/verify-aria-zh.mjs'],                     host: 'preview', backend: true,  dist: false, note: '扫 aria-label/title/alt（扫不到 placeholder）' },
  { zone: 'A', name: 'onboard-gate',          cmd: ['eval-harness/tools/verify-onboard-gate.mjs'],                host: 'preview', backend: true,  dist: false, note: '要 demo seed（AVERY_DEMO_SEED_DIR）；额外吃 VERIFY_API 默认 8137' },
  { zone: 'A', name: 'p0',                    cmd: ['.issues/v02-partner-align-0718/verify-p0.mjs'],              host: 'preview', backend: true,  dist: false, note: '🔴 必须打 5173：后端 CORS 是精确匹配的固定 origin 列表；含锁词硬闸 Nexus/nexus/现实差距' },
  { zone: 'A', name: 'zh-purity',             cmd: ['.issues/feat-068-frontend-deploy/verify-zh-purity.mjs'],     host: 'preview', backend: true,  dist: false, note: '扫 innerText 英文残留' },
  { zone: 'A', name: 'bare-url-shell',        cmd: ['.issues/feat-068-frontend-deploy/verify-bare-url-shell.mjs'], host: 'preview', backend: false, dist: false, note: '裸 URL（无 ?v=2&mode=live）落 story 壳是对的' },
  { zone: 'A', name: '404-discriminator',     cmd: ['.issues/feat-068-frontend-deploy/verify-404-discriminator.mjs'], host: 'preview', backend: true, dist: false, note: '要真 404 —— preview 的 SPA fallback 与真 404 必须能区分' },
  // ↓ A18/A19：battle-map 把这两道记作「准调包者」排在 C 区附近；2026-07-22 实跑推翻（见 §E3 裁定）。
  //   它们**真上传**，所以必须留在 A 区（C 区之后 dist 指向生产域名，跑它们 = 往生产库写数据）。
  { zone: 'A', name: 'file-manifest-truth',   cmd: ['eval-harness/tools/verify-file-manifest-truth.mjs'],          host: 'preview', backend: true,  dist: false, note: '🔴 上传型门（真传一份好文件 + 一份结构性损坏 PDF）；30 判据；**绝不能排在 C 区之后**' },
  { zone: 'A', name: 'onboarding-returning',  cmd: ['eval-harness/tools/verify-onboarding-returning.mjs'],         host: 'preview', backend: true,  dist: false, note: '🔴 上传型门（铺垫一次真上传造"返回访客"）；15 判据；**绝不能排在 C 区之后**' },
  { zone: 'A', name: 'bottom-furniture',     cmd: ['eval-harness/tools/verify-bottom-furniture-clearance.mjs'],   host: 'preview', backend: true,  dist: false, note: '🔴 上传型门（票 #34/#36；空态两条都不复现——AskAveryLauncher 在 contextId=null 时整块不挂载）；**绝不能排在 C 区之后**。判据是 elementFromPoint 真命中，不是几何重叠；只把「劫持者是屏底锚定 fixed/sticky 家具」判红（顶栏遮挡滚动内容不算）。⚠ 审前先剔除被祖先 overflow 裁掉的控件——rect 不管裁剪，不剔会假红' },
  { zone: 'A', name: 'detail-provenance',     cmd: ['eval-harness/tools/verify-detail-provenance.mjs'],            host: 'preview', backend: true,  dist: false, note: '🔴 上传型门（票 #37；真传 demo-seed 全量造多文件工作区，每跑造 2 个 context——v02/v01 各一）；**绝不能排在 C 区之后**。判据是「详情卡可见文本里不许出现任何工作区级文件名」，不是「某个 class 不存在」——换组件重新实现同一个谎也逃不掉。带两条自证判据防空跑（文件清单非空 + 浮层真开着且渲染了本卡内容）' },
  { zone: 'A', name: 'flow-gap-phases',       cmd: ['eval-harness/tools/verify-flow-gap-phases.mjs'],              host: 'preview', backend: true,  dist: false, note: '🔴 上传型门（票 #14；手写种子造 gapDerive 要的"自报稳/真有卡点"矛盾）；triage/follow-ups(B组)+差距卡(C组——判据数别写死，#63/#65 各加过一条，以 runner 的 rec 调用为准)；`?transport=stub` 在这份 dist 上是死的（DEV 静态 false），走真 mock 后端；**绝不能排在 C 区之后**' },
  { zone: 'A', name: 'forms-proactive',       cmd: ['eval-harness/tools/verify-forms-proactive.mjs'],              host: 'preview', backend: true,  dist: false, note: '🔴 上传型门（gap2 T9 / 票 #58；一次真 uploadFiles 造公司 + 真铸链 + 员工真提交＝每跑一遍造 1 个 context 并往里写表单行）；**绝不能排在 C 区之后**。19 判据走完「上期名单 → 自动补铸本期 → 铃铛 → 员工填 → 撤回不成死循环」整条链。⚠ 它显式 `?lang=zh`——本仓默认壳是 EN，不写这个参数每条中文判据都会以「文案不对」的形态假红。⚠ 判据一律断内容不断顺序：同一批自动铸出来的行共用一个 created_at，排序退化成 uuid 序' },
  { zone: 'A', name: 'locale-parity',         cmd: ['eval-harness/tools/verify-locale-parity.mjs'],                host: 'preview', backend: true,  dist: false, note: '🔴 上传型门（票 #38 / ADR-0033；同一份 demo-seed 中文语料跑 zh/en 两遍，每遍一次真 uploadFiles + 一次真 /advise ＝ 每跑一遍造 2 个 context）；**绝不能排在 C 区之后**。四条判据分别盯语言的四个面：①界面壳无异语残留 ②后端派生文案语言正确 ③LLM 正文语言==请求 locale ④引文仍是原文（逐字出自语料）。判据写白名单（"必须是这三个词之一"），每条主判据前面带自证判据。⚠ 两把尺子别混用：壳残留用宽 CJK（要逮全角冒号），引文用只认汉字的 HAN——born-red 实测宽尺子会对着被翻译的引文全绿' },
  { zone: 'A', name: 'append-story',          cmd: ['eval-harness/tools/verify-append-story.mjs'],                 host: 'preview', backend: true,  dist: false, note: '🔴 上传型门（T10 补资料；一次 uploadFiles + 一次 appendFiles，**只造 1 个 context**——补传按定义不新建）；**绝不能排在 C 区之后**。五段剧本：传→补传→资料库多一行→卡片显新值且出处角标指向新资料→矛盾上今天页双栏。判据落在「角标文本里出现了新文档名」而非「有没有角标」（显示值≠判据值），rule_id 只从载荷读不写字面量（与后端 test_no_rule_text_in_any_prompt 同一条纪律），每段前面带自证判据防空跑' },

  { zone: 'A', name: 'folded-drawer-93',      cmd: ['eval-harness/tools/verify-folded-drawer-93.mjs'],            host: 'preview', backend: true,  dist: false, note: '🔴 上传型门（#93「已并入其他项目」区；一次 uploadFiles + 一次 appendFiles，**只造 1 个 context**）；**绝不能排在 C 区之后**。17 判据走完「传台账 → 补周报 → 三张检查点被折进母卡 → 抽屉说得出去向/理由/原文行号」。①的「此刻没有已并入区」是对照基准（②把它造出来，否则空真）。**这个区没有恢复键是刻意的**，判据钉住「除展开键外零按钮」+ 一条自证（归档抽屉那边**有**恢复键，证明不是 CRUD 挂了）。⚠ 语料写 markdown 的 `## 项目：` 不写 CSV：这道门吃 heuristic 抽取器，CSV 台账抽出 0 个项目、整门以「找不到卡」的形态假红（后端那半用的是 scripted brain，两边语料形状不同）。⚠ 滚动条在 `.lite-projects-scroll` 上不在 window 上，且 `scrollIntoView({block:\'end\'})` 会留 90px 没滚完、把尾注推进容器末尾 44px 的**渐隐遮罩**里——遮罩不改 opacity 也不挡 elementFromPoint，所以尾注判据必须加一条几何式的（遮罩宽度从计算值读，不写死）。⚠ 手机视口单独判（桌面绿≠手机绿：后端那句中文理由在窄屏换三四行）' },

  { zone: 'A', name: 'form-builder',         cmd: ['eval-harness/tools/verify-form-builder.mjs'],                host: 'preview', backend: true,  dist: false, note: '🔴 上传型门（gap2 T11；真传花名册+一份旧表格造工作区，还会真建模板、真铸链、真在员工页交一份）；**绝不能排在 C 区之后**。43 判据盯模板生命周期：三入口 / 四种控件 / 上限镜像在本地就拦住并说清哪条 / **已被答过的 field.id 禁改禁删（只给停用）** / 三个语义开关往返不丢 / 起草是提案不落库且红线在起草层就落地。⚠ `?transport=stub` 在这道门上是死路：saveFormTemplate/draftFormFromFile 在 stub 通道上根本不存在，整段判空即零像素——本门必须真打 mock 后端。⚠ 题面住在 `<input value>` 里，`hasText` 采不到它（写这门时栽过一次 30s 超时）' },

  { zone: 'A', name: 'at-references',        cmd: ['eval-harness/tools/verify-at-references.mjs'],               host: 'preview', backend: true,  dist: false, note: '🔴 上传型门（#64/#66/#67 @ 引用；一次真 uploadFiles（4 件语料）造工作区 + 十发真 /advise＝每跑一遍造 1 个 context）；**绝不能排在 C 区之后**。主判据落在**网络请求体**上（POST /advise 的 references[] + situation 织文），不落 store（T10 门洞教训）；全程真键盘驱动 composer（pressSequentially/ArrowDown/Enter）。⑧ #66 弹层几何（三宿主×视口矩阵，elementFromPoint 实测防 rect-不管-裁剪）；⑨ #67 七个预填入口逐个真点。⚠ 显式 `?lang=zh`——织文前缀「涉及：」是 zh 词，EN 壳下该判据假红。⚠ 语料带两位同名林小满（人员ID 不同）：重名消歧判据要求两个候选各带部门。⚠ 门中途 setViewportSize 换视口并 reload 一次（空态宿主要 run 归 idle）。⚠ #69/#71 改判：⑨ 每个入口现在还判「正文空 + 灰提示带入口上下文 + 发送键置灰」，且 submitRoom **自己打字**（入口带来的是 placeholder，输入框是空的，光按 Enter 发不出去）；⑧(a) 的运行态宿主要当场问一句造出来（#71：离开议事室 = 对话清空）' },

  { zone: 'A', name: 'files-ia',             cmd: ['eval-harness/tools/verify-files-ia.mjs'],                   host: 'preview', backend: true,  dist: false, note: '🔴 上传型门（#76 资料库 IA 重排 + #77 删除文件；一次真 uploadFiles 造工作区，然后**真删掉其中一份**＝每跑一遍造 1 个 context 并从中删一份文档）；**绝不能排在 C 区之后**。补的是一块真空白：钉 lite2 文件清单的 `assertFilesSurfaceV2` 住在 scripts/gates/live-frontend-gate.snippet.js，那是往浏览器控制台里贴的**手工**门——`git ls-files "*verify-*.mjs"` 捞不到、本 runner 也不跑它，于是「清单行长什么样」在电池里一条自动判据都没有。17 判据：① `.upload-files` 全局恰好一份（filesSurfaceV2 只查「行数>0 且每行合规」，两个 UploadPanel 都渲染清单时**双倍行数照样全绿**——那是个现成的假绿口）② 上传时间逐字等于 `new Date(iso)` 的本地取值（判据落在换算结果本身，写成「含年份」对 iso.slice(0,16) 那种差八小时的错实现照样全绿）③ 分区按频率重排 + 锚点无悬空④「谁交了」在铸链区之前 ⑤ 删除的**二段确认**（第一下只出确认条、取消不删、第二下删的是被点的那份）⑥ 删完 @ 候选来源里够不着它。⚠ 显式 `?lang=zh`（确认条文案判据读中文）。⚠ 改了后端却跑到旧行为：uvicorn 不热重载，动过 file_delete/端点必须**重起后端**再跑这道门（写它时真栽过一次，删除那两条以「删了没反应」的形态假红）' },

  { zone: 'A', name: 'files-explorer',       cmd: ['eval-harness/tools/verify-files-explorer.mjs'],             host: 'preview', backend: true,  dist: false, note: '🔴 上传型门（#84 资料库两栏 explorer；桌面/手机两个视口各一次真 uploadFiles（demo-seed 九份）＝每跑一遍造 2 个 context）；**绝不能排在 C 区之后**。补两块空白（判据数别写死——本文件头那条磑：每加一条就烂一次）：① **手机态在所有既有门里零覆盖**（既有门视口一律硬钉 ≥900），而本票最实的病根只在 390px 上发生——9 行量出 4 种高度 3 种内部顺序；② visual.spec 的 files 那 4 张拍的是**空态**（`?transport=stub` 在 build 产物上是死开关），列宽/数字列对齐/行动作恒占位/上传口在不在工具条上一张都盖不到。主判据：B②③ 九行**恰好一种高度 + 恰好一种落位指纹**（指纹落在六个格子的相对落位本身，不落"看起来一样高"——#83 的 M-C 教训：尺子太宽对着真违规也全绿）· A②「下陷」量**合成后亮度低于并排的工作台**（不写 rgba 字面量，换皮不瞎；⚠ 第一版拿 body 当对照物，而 body 的背景是 rgba(0,0,0,0)，那条判据对着真下陷的栏恒红）· A③ 左封条把 `content` 一起判死（#83 的 M-F：没生成的伪元素照样吐回规则里的 width）· A⑧ 行动作只许 opacity 藏、**不许 pointer-events:none**（加了会让 files-ia 的三次删除点击超时**崩门**而不是变红）· B⑥ 抽屉 alpha≥0.99 与 elementFromPoint 两条缺一不可。⚠ 显式 `?lang=zh`。⚠ 语料必须是 demo-seed **九份**：3 份时列表不溢出、flex 不收缩，病根根本不发生（真栽过一次）' },

  { zone: 'A', name: 'change-log',           cmd: ['eval-harness/tools/verify-change-log.mjs'],                 host: 'preview', backend: true,  dist: false, note: '🔴 上传型门（#85「这次补料改了什么」只读流水 + 已查阅；**一次真 uploadFiles 之后再一次真 appendFiles**＝每跑一遍造 1 个 context 并往里补三份文档）；**绝不能排在 C 区之后**。这道门必须真补传：整条流水长在「第二批资料顶掉了第一批的读数」上，`?transport=stub` 造不出来（它没有 append），空态更造不出来——本票最现成的假绿就是「那一区根本没渲染，每条判据都够不着，于是全绿」，所以 ⓪/⓪b 两段先**自证**改写真的发生了。主判据：④ 屏上那两串字**逐字**等于 payload 的旧值/新值（判「行里有个箭头」的话，把旧值印成新值照样全绿）· ④ 状态走**卡片上同一套词**（血缘里存的是 `on-track` 这种归一 token，直接印出来经理会读到一个项目卡上从不出现的词）· ④(反向) **首次上传后一行都没有**（判据只看 lineage 不看 `provenance.origin` 时必红——那正是本票便宜的全部理由）· ⑤ 「补上了」那类行**不印旧值**（enrichment 没毁掉任何读数，印一个旧值＝凭空发明）· ⑤ 新建的卡各有一行（它们 provenance 恒空，不靠 `lineage.added_in` 彻底看不见）· ⑥ 已查阅三段配**对照基准**（标之前那一行在 → 标之后恰好少一行 → 取消标记回来；不量基准的话，一个一行都不渲染的实现同样满足「标完看不见」）· ⑦ 跨 reload 仍在（只活在组件 state 里时必红）· ⑧ 点引文真跳到「文件」区**并把清单筛到只剩那一份** · ⑨ 拍板③ 共存的两条：今天页零行 + 铃铛里没有一条通知讲「资料更新」。⚠ 显式 `?lang=zh`（行文案判据读中文）。⚠ 补传的三份必须是**单一用途**文档：一份文档 = 一张项目卡（标题取第一个 `#`，其余键行全并进同一张），塞一个文件里会融成一张卡、新项目/新同事一张都长不出来（写这道门时先踩过一次）。⚠ 动过 registry 投影/extract 血缘必须**重起后端**再跑（uvicorn 不热重载，否则以「lineage 没上线」的形态假红，而 ⓪b 那条自证正是为逮它写的）' },

  { zone: 'A', name: 'room-conversation',    cmd: ['eval-harness/tools/verify-room-conversation.mjs'],           host: 'preview', backend: true,  dist: false, note: '🔴 上传型门（#71 会话流；一次真 uploadFiles（2 件语料）+ 两发真 /advise＝每跑一遍造 1 个 context）；**绝不能排在 C 区之后**。两条主判据各盯一种假实现：② 只认 **DOM**（第一问的问题原文+回答卡在第二问之后仍在屏上，且顺序在前）——防「后端带上了、屏上还是覆盖」；③ 只认**网络请求体**（POST /advise 的 history[] 里有第一问的原文与答案摘要）——防「屏上堆起来了、后端还是零上下文」。④ 第一问请求体**没有** history 键（additive：absent≠[]）。⑤ 顺带钉 #69 的置灰闸，判据直接落在 submit 键的 `disabled` 属性上——**不能只判「点了没发请求」**：submit handler 里还有一句 `if (!text) return` 兜底，那样拆掉置灰照样绿（belt-and-braces 让内层规则免疫变异）。⑥ 离开议事室 = 这场对话结束（turns 清空 + localStorage 里搜不到任何一问的正文——刻意不持久化）。⚠ 显式 `?lang=zh`（判据读中文问题原文）' },
  { zone: 'A', name: 'room-threads',        cmd: ['eval-harness/tools/verify-room-threads.mjs'],               host: 'preview', backend: true,  dist: false, note: '🔴 上传型门（#78 真线程；一次真 uploadFiles（2 件语料）+ 四发真 /advise＝每跑一遍造 1 个 context）；**绝不能排在 C 区之后**。补的是一块真空白：`.lite-room-history*` 与 `adviseRuns` 在所有既有门里 grep **零命中**，像素侧 room 四张拍的是 contextId===null 的无材料态、visual-data 压根不含 room——改历史面不会有任何门红，那不是安全是没有网。主判据：② 回传的 thread_id 落进 store 的槽位**值**（不是「请求 200/没崩」——applyEvent 是白名单取键，后端多发的键 TS 不报、运行时不崩、控制台不吾）；③⑧ 续问请求体带同一个 thread_id（网络层判据，不落 store）；⑥ 点一场→整场按**对话顺序**回屏且带着回答；⑦ 回灌轮不渲染四相（全 pending 会渲染成 4×「待命」，对答完的记录是假话）；⑨ 生成中禁点**两把锁配两条判据**（UI disabled 属性 + store busy 闸）；⑪ 同场重复点幂等。⚠ 显式 `?lang=zh`。⚠ 改过后端必须按端口杀掉重起 uvicorn（`/advise-threads` 是新路由，旧进程上跑会以「历史面板空的」假红）' },

  { zone: 'A', name: 'room-rail',           cmd: ['eval-harness/tools/verify-room-rail.mjs'],                   host: 'preview', backend: true,  dist: false, note: '🔴 上传型门（#83 会话侧栏；两个视口世界各一次真 uploadFiles ＝ 每跑一遍造 2 个 context，外加五发真 /advise）；**绝不能排在 C 区之后**。补的是两块空白：① **手机抽屉态在所有既有门里零覆盖**——contrast-smalltext / aria-zh / at-references / room-claude-rework 四道门的视口都硬钉 1280×900 或最小 900 > 860，抽屉里的配色、11px 小字对比度、开关钮形态全在采样面之外（#80 回执把它记成"刻意留下的账"，本票结清）；② 桌面栏的视觉规格只有像素基线看着，而 room-data 那 4 张拍的是**零历史**态，行高/选中封条/组标色/时刻是否占墨一张都盖不到。主判据：A② 下陷不是凸起（量**合成后亮度低于身后那张面**，不写 rgba 字面量——写死的尺子换张皮就瞎）· A③ 贴边通到底（rect.top===0 且 bottom===视口底）· A⑤ 单行 34px · A⑥ 时刻静息态零墨（🔴 采样前必须 mouse.move 把指针挪出侧栏，否则采到的是 hover 态）· A⑦ 单轮场零文本 + A⑧ 多轮场仍占墨（一对，缺后者「一律不渲染」也能过）· A⑨ 2px accent 左封条读 ::before 计算值 · A⑩ 组标 ink-soft 不 ink-faint · A⑪ 开场块居中 + 自证那块矩形夹在顶栏带底与 composer 顶之间 · A⑫ composer **不在** board 里（「把 composer 一起收进来居中」那种假实现唯一的结构可观测形态）· B③ 抽屉底色 alpha≥0.99 与 B④ elementFromPoint 实打**两条缺一不可**（前者管颜色、后者管"它真在上面"）· B⑦ 抽屉内小字 AA（尺子与 contrast-smalltext 逐字同源）。⚠ 显式 `?lang=zh`' },

  { zone: 'A', name: 'archive-empty',        cmd: ['eval-harness/tools/verify-archive-empty.mjs'],              host: 'preview', backend: true,  dist: false, note: '🔴 上传型门（#86「清空这份档案」；一次真 uploadFiles + 一发真 /advise + 一次真 appendFiles＝每跑一遍造 1 个 context 并把它清空再补料）；**绝不能排在 C 区之后**。主判据全在**网络层与身份上**，不在「屏上空不空」：② 恰好一发 `POST /team/{cid}/empty` 且带 token（断「本地 resetLiteCompanyData 假装清空」）· ③ context_id / owner_token / localStorage 锚点逐字符不变 + 清空后 GET /team 仍 200（断「重走 uploadFiles 铸新 context」）· ⑤a/⑤b 对话历史清空后仍在（本地 + 重新拉后端各断一次，两条断的是两件事）· ⑥ 补料落回同一个 id。⚠ 显式 `?lang=zh`。⚠ 改过后端必须按端口杀掉重起 uvicorn（`/team/{id}/empty` 是新路由，旧进程上跑会以「一发请求都没有」的形态假红）。⚠ UI 挂点（左栏那枚键 + 硬确认）由 #84 建左栏之后补——本门今天驱动的是 store 动作 `emptyArchive()`，#84 落地时必须回来补「真点那枚键」那一段（照 append-story ② 的教训：不碰按钮的门放走过「按钮接错线」那条变异）' },
  { zone: 'A', name: 'extraction-degraded', cmd: ['eval-harness/tools/verify-extraction-degraded.mjs'],     host: 'preview', backend: true,  dist: false, note: '🔴 上传型门（#89 抽取降级横幅；一次真 uploadFiles + 五次真 appendFiles + 一次 emptyArchive＝每跑一遍造 1 个 context）；**绝不能排在 C 区之后**。0811 合伙人真实翻车的正面修复：后端从 feat-039 起就一直发 `extraction_mode: \"degraded\"`，前端 src/ 里那个字符串出现次数是 0，于是配额烧光那天她看到的是 200 +「已读取」+「今天没有要你定夺的事」。⚠ **门后端一律 heuristic，永远发不出 degraded**——本门靠 `page.route` 在网络层改这一个键，链路其余每一段（传输层透传 → store → localStorage → 渲染）都是真的，伪造点只有一处且它正是被测输入。🔴 #91 起改包点在 **GET /team/{id}/files 的 `last_job.extraction_mode`**（#90 后 POST 写口不再携带该键——deposit 秒回时抽取还没跑；值由 store 内部轮询在任务落定那一刻消费一次）：POST 只观察不改，⓪′ 钉「写口确实不发」这个前提（塌了=有人把键加回 POST，改包点该挪回去）；⓪ 有改包自证（拦没拦到），少了它 ②③ 全是假绿温床。判据分刀：② 只吃**内存态**（不导航不重载，覆盖「传完待在原地」这条最常见动线）· ③ 只吃**持久化**（刷新后仍在——值只在任务落定那一刻被消费一次，读口不重发）· ④ 🔴 `heuristic` **不许**出横幅（断「判据写成 !== llm」那一刀，那种实现会让每台离线部署天天喊狼来了）· ⑥ 🔴 emptyArchive **不换 context_id**，所以「换 id 就清干净」那条收口在这儿根本不跑，必须单独清；且 #90 的 job 行是无 FK 审计痕迹**清空不删**——last_job 清空后照旧发着（本门也照旧改包着），横幅仍须消失，谁让 refreshFiles 直接消费 last_job 这条当场红。变异实证（#91 重打三发）：`=== degraded`→`!== llm` 红①④ · 落定不持久化（appendFiles settle 去掉 rememberExtractionMode）红③（②仍绿，两刀砍两处）· emptyArchive 不清 红⑥（恰好一条）。⚠ 显式 `?lang=zh`' },

  // ── B 区 · 自带服务器 / 像素基线（3 道，中段）───────────────────────────────
  { zone: 'B', name: 'data-boundary',         cmd: ['.issues/v02-partner-align-0718/verify-data-boundary.mjs'],   host: 'self',    backend: false, dist: false, note: '自起 dev server :5304（VERIFY_PORT 可改）；可选 VERIFY_OLD_STORE=<git-ref> 做 born-red' },
  { zone: 'B', name: 'null-owner',            cmd: ['.issues/v02-joint-0719/verify-null-owner.mjs'],              host: 'preview', backend: true,  dist: false, note: '⚠️ battle-map 把它归在「自带服务器」的 B 区，但它其实写死打共享 5173（:28 `const UI`，无 VERIFY_BASE）。位置照抄 battle-map 不动（换序＝换风险），此处记档口径' },
  { zone: 'B', name: 'visual-baseline',       cmd: ['node_modules/playwright/cli.js', 'test', '-c', 'eval-harness/visual'], host: 'preview', backend: true, dist: false, note: '像素基线两套：36 张空态（visual.spec，9屏×2皮×2视口）+ 12 张数据态（visual-data.spec，#68：真上传 demo-seed+gap 种子后采 home/team/projects——数据态部件此前零像素覆盖）；🔴 数据态那套要后端带 AVERY_DEMO_SEED_DIR；🔴 序错（dist 被调包）时这道必假红；重冻要 --update-snapshots 且只在人审对照板通过后' },

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
