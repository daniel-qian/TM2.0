# ⟳ 2026-07-22 夜跑 · **满态对齐战役 批次①（issue 01+02 富项目字段）已交付全绿，等 Danny 验收**（★最新，从这里接）

**一句话**：AFK 夜跑跑完 issue 01（进度/风险）+ 02（里程碑），端到端真管道 + absent≠none 全通，
**全量 A 区电池 19/19 绿（exit 0，零跨门回归）**。commit 攒本分支未推（push=人工闸，等 Danny 点头）。
issue 03–11 未动（03 是最重的门改造，机理已摸底见下）。

## 现在分支上是什么（`claude/layout-real-components-27b594`，未推 origin）
- 皮对齐三批（layout-real 批次①②③）—— 上一战役产物，仍等 Danny HITL（原样）。
- **rich-align 批次①**：`d58f3d5`（issue 01 进度/风险）+ `99bb20d`（issue 02 里程碑）。
  - 富字段真管道：文档→heuristic 抽取→ProjectEntity(risk/milestones)→payload 缺就不发键→
    projects 卡（风险徽章 + 6px 进度条 + 里程碑圆点串）+ 详情浮层（环形进度 + 风险行 + 里程碑清单/分段条）。
  - 🔴 红线守住：`risk/离职风险` 仍在 person 禁键表只对**人**执法，project.risk/milestones 合法（recon
    实证 validate_extraction 只扫 people+person signals）；absent≠none 全链（缺席不发键、前端 null 收起无 `??`）。
  - 门：cr-align-spec stick6/7 八行（43/43）· 新 e2e `verify-rich-fields-01.mjs`（14/0，两世界）·
    status-truth +absent 分支（31/0）· 新 pytest 18 例（红先行有据）· run-battery CURRENT_STICK→7。
  - zh 10 键手写 draft（待审字，zh.ts 头已标）。

## 验收就绪（Danny 回来做这个）
- **验收手册**：`.issues/rich-align-0722/acceptance-1.md`（入口 URL 带参 + 逐屏 HITL 路径 A/B/C +
  pixel-evidence 索引 + 拍板复核项①-④ 签认位[均属 03/06/09，本批次不涉]）。
- dev server 挂着：preview 5173 + mock 8137（收工不杀）；她方参照 `cd D:\cr-live && npm run dev`(:3100)。
- **Danny 人测点头 → `git push`（=Vercel 自动上产，本批次两 commit）+ 生产取证补收据**。

## 下一步：issue 03（人员负载/情绪·开关口径——最重的门改造）
机理已摸底（省下次侦察）：
- 抽取：`avery/ingest/extract.py` PersonEntity(75) 加 `self_report{load,mood}`（caliber+source 必填）；
  周报「人员动态」段 `- 小王｜负载自述：85%｜情绪自述：吃紧` 需**新写 person 自述行解析**（现无）。
- 红线：`avery/ingest/redline_extract.py` validate_person_dict 需白名单放行 self_report 槽（散落数字键仍全禁）；
  `avery/scoring_policy.py::person_scoring_allowed()`（读 AVERY_ALLOW_PERSON_SCORING，默认关，已存）。
- 投影：`registry.py::team_cards()`(142) 按开关——关=不投 self_report；开=投 + 顶层 `scoring_enabled:true`。
- 前端：`transport.ts` LivePersonCard 加 self_report?；**第③层运行时剥离在 `teamData.ts`**（现把 person 数字键全丢）
  改两世界（关=全丢；开=放行 self_report 白名单 + 渲染带 `data-metric-source` 锚点）；人卡渲染在
  `HomeScreen.tsx`/`TeamScreen.tsx`（`.home-person-card`，DOM 类名锚点保留，目录形态归 04）。
- **AFK 门两世界执法**：`scripts/gates/live-frontend-gate.snippet.js` 的 `BLOOD_BAR_RE`（定义 :393）
  **8 个使用位点**（:497/795/1072/1246/2585 等，grep 为准）+ K6「人卡任意数字即红」逐个改两世界；
  score-table/leaderboard/横向对比结构两世界无条件禁（筛选 chip 不在禁列）；跑法照 **runbook §1b**
  （mock 三件套 + verify-skin-phases 注入模式，两世界=两次后端重启，🔴 绝不碰 AVERY_BRAIN=minimax）。
- verify-p0 的「0%」正则收窄到项目进度元素（防负载恰 0% 的人误伤）。spec 如需=stick 8。CURRENT_STICK→8。

## issue 04–11（未动，序见 issues/README.md）
04 team 目录化 · 05/06 真 CRUD 项目/人员（写端点先例，C 区调包门会上场）· 07 三亚富语料 pack（16人/6项目/SOP，
换 tests/fixtures/demo-seed 同 commit 改 test_demo_claim+verify-onboard-gate 期望）· 08 playbooks · 09 重新开始 ·
10 登录隔离(Supabase MCP 取值) · 11 收官（全电池两轮 + 对照板 + 像素全量 + acceptance 汇总 + handoff）。



**背景**：Danny 实况看完皮对齐三批后判定「离对齐仍远」——盘问（grill-with-docs）达成共识：
真目标是**满态对齐**（并排两 app 观感一样丰富）。9 项拍板 + 2 条 ADR 落盘，旧红线两处改口径。

**拍板要点**（全文见 `.issues/rich-align-0722/prd.md`）：富字段（进度/里程碑/风险）走真管道
（ADR-0029，禁 demo 注入）；人面数字跟 `AVERY_ALLOW_PERSON_SCORING` 开关（CONTEXT.md Voice ①
已改开关口径）；真 CRUD 项目+人员、手编赢+逐字段出处（ADR-0028）；team 屏状态切换目录化；
三亚原创语料（小王/小张代号，成稿免审）一键满态；重新开始入口；登录隔离演示。

**产物**（全部 tracked，本分支）：
- `.issues/rich-align-0722/`：prd.md · runbook.md（环境/25 门电池/像素统一口径/AFK 门离线跑法/陷阱）·
  issues/01-11+README（垂直切片，串行 01→11）· review-fixes.md（20 条对抗校验修复台账，20/20 复核过）
- `docs/adr/0028`（手编赢+出处）· `docs/adr/0029`（真管道不注入）· CONTEXT.md 两处口径修正
- ⚠️ 电池唯一权威=`run-battery.mjs`（25 门，A19/B3/C3）；像素口径已统一（片内存证重冻+晨审签认）

**上一场（布局与真部件·皮对齐）**：三批全绿全未推，验收表单 `.issues/layout-real-0722/acceptance-3.md`
仍等 Danny HITL；本战役收官会重出对照板+验收，一起交。

**夜跑指令**：读 `.issues/rich-align-0722/issues/README.md` 照 01→11 串行执行；每片先读 runbook。
push=人工闸不动。

---

# ⟳ 2026-07-22 · 布局与真部件战役 · **批次③ 收官（棒G–H）· 三批全干完，等 Danny HITL**（历史·上一段）

**状态**：批次①②③ **全部本地 commit、未推**（push=Vercel 自动上产=对外人工闸，等 Danny 点头）。
分支 `claude/layout-real-components-27b594`。dev 三口仍挂（5173 dev dist / 3100 cr / 8137 mock）。

**批次③ 收官做了**（commit 4f1d98a，接 e3e053a 的 notes+问Avery）：
- 动效 pass 全落：搜索浮层入场 `lite-search-pop-in` · 三态 chip 列表切换 `lite-home-gap-list-in`(ul key=gapFilter) · 搜索框聚焦 border-color 过渡。全包 `reduced-motion:no-preference`，探针实测 reduce 归零。
- 修 `capture-align-board`：**`transport=stub` 已不灌数据**（contextId 恒 null、六屏空态，板子是假对照）→ 改走真 uploadFiles 抽取路径。对照板现在照的是「有数据的形状」。
- **验收表单 = `.issues/layout-real-0722/acceptance-3.md`**（HITL 端到端）。全 23 门电池两轮零红 + 扫雷 0/0 + 规格 all-stick 35/35 + 桌面像素 9屏×2皮全绿。

**🅰🅱 两处刻意不同 · 留 Danny 拍板**（对照板真数据复核后确认零骨架缺口零破图，只这两处）：
- 🅰 **playbooks**：她 6 卡双列方法库；我方诚实空态（**无真 playbook 数据，造网格墙=编造/空卡剧场**，踩 absent≠none）。要那面墙先得有真数据源。
- 🅱 **team**：她通讯录目录（筛选chip+3列）；我方 upload-first 架构（贯穿 projects/team/closerlook 的产品语法）。改她原型=架构级、非批次③范围，**不 AFK 擅改**。

**下一步 = Danny HITL**：按 acceptance-3.md §1 走一遍 → §2 两处决策 → 点头才 push。
**仍欠 Danny**：批次② 手写 8 条中文标签审字（acceptance-2.md §3，本批零新增文案）· 像素 home-mobile 先天漂移重冻（人审对照板后才 `--update-snapshots`）。

---

> # ⟳ 2026-07-22 · 布局与真部件战役 · **批次③ 起步：notes 列表化 + 问 Avery 动效落地**（历史·上一段）
>
> **状态**：批次①②（主页骨架+三真部件）仍全绿全未推（见下一段）。本 session 在其上起了批次③，
> 落地两件并验证，均 commit 未 push；dev server 三口仍挂（5173/3100/8137）。验收入口不变
> `http://localhost:5173/?v=2&mode=live&lang=zh`。
>
> ## 🔴 本 session 最重要的一条修正（下个 session 照此规划批次③，别再走弯路）
> **cr-align 上一战役（棒5/6/7）已经把 aurora 皮九屏全做了视觉重塑**——followups 已是她的
> checklist divide-y 整卡（look-aurora.css §⑲ l.498-527）、projects 6px 顶部渐变条（§⑳）、
> people 卡、notes/vision/closerlook/playbooks 入场动效（l.603-611）。所以**批次③「其余 8 屏布局收敛」
> 剩下的不是重新上皮，而是三类**：
> 1. **cr-align 没做的结构/布局缺口**：她的多列卡网格（people 3 列 / projects 3 列 / playbooks 2 列）
>    ——若我方这几屏仍是单列，那才是真缺口。**下个 session 第一步：开对照板
>    `reports/align-board/2026-07-22/index.html` 逐屏核我方 aurora vs 她，锁定哪些屏是「单列 vs 她多列」
>    的结构差**（不是看色，色 cr-align 做完了）。别凭空重做已完成的皮。
> 2. **notes 列表化**——✅ 本 session 已做。
> 3. **动效 pass**——问 Avery 展开 ✅ 本 session 已做；剩搜索结果浮层淡入 / 差距三态 chip 切换过渡
>    （见 `polish-checklist.md`）。
>
> ## 本 session 落地（两件，均验证零回归）
> 1. **notes 列表化**（`look-aurora.css` 新增，aurora 作用域）：一天一组=整 card-base 卡、笔记=divide-y 行，
>    照抄 followups §⑲ 同款 `padding:2px 16px` 内缩（不用 overflow:hidden，免裁 lite2-rise 起点）；
>    只读故不加行 hover。paper 守自己分卡（同 cr-align followups 纪律）。实测：组体 white.97/r10/shadow、
>    行 radius0+底分隔线、末行无线、is-new 行染色；扫雷 0/0、spec 35/35。
> 2. **问 Avery 悬浮入口展开动效**（`lite2.css` ask-avery 段；Danny 07-22 亲口点名的动效债头条）：
>    胶囊 hover `transition:background`（.lite-btn 自动吃 reduce 兜底）+ form 入场 `@keyframes
>    lite-ask-avery-expand`（scale+淡入，bottom-center 生长），**包进 no-preference**（form 非 .lite-btn
>    须自包）。实测 animationName/duration/no-preference 命中、reduce 不命中。详见 `polish-checklist.md` ✅。
>
> ## ⚠️ 本 session 走过的弯路（避免重蹈）
> 我起步时误读了「主 main 上的 session-handoff.md」（那是**战役 kickoff 旧稿**，不反映本分支进度）——
> 以为是全新战役，重跑了一遍 kickoff 侦察、还动手重做 followups 列表化（cr-align 棒5 早做完了）。
> **发现本分支 `claude/layout-real-components-27b594` 才是真进度后已全部回退纠偏**（followups 两文件
> `git checkout` 复原，只留 notes 这一真缺口）。教训：**批次③ 的真相源是本分支的 handoff + 对照板，
> 不是 main 的 kickoff 稿；动任何一屏前先确认 cr-align 是否已做过。**
>
> ## 批次③ 下一步（按优先级）
> 1. 开对照板锁定真缺口，**别假设「单列缺口」**：实测我方 `.lite-projects-grid`（auto-fill minmax288）、
>    `.lite-vision-mock-grid`（auto-fit minmax300）**已是响应式多列**，projects/vision 不缺列。
>    people/playbooks 屏的网格还没核（team/people 与 playbooks-screen 的 grid 规则本 session 未查）——
>    先看对照板确认是「结构差（列数/密度）」还是只是「细节差（间距/卡内）」，多半是后者。避 trap：
>    people 无 load%/健康度/CRUD、projects 无 milestone/成员栈/CRUD——见 plan §4 DO-NOT-BUILD。
> 2. 补剩余动效（搜索浮层淡入 / 差距 chip 过渡）。
> 3. closerlook 对照双列已是她语法（cr-align 做过？核对照板）；room 通用语法 + 真引用差异点保住。
> 4. 批次③ 收尾（棒H）：全 23 门电池两轮零红 + 像素基线人审重冻 + 对抗审查四视角 + `acceptance-3.md`，停等 Danny。
>
> ## 可选 polish（本 session 评估后**未做**，留 Danny/下个 session 定）
> - followups 段控（active/history）仍是 pill，她 /checklist 是「分段开关」形（cr-align 没顺手做）；
>   每组缺「计数 Badge」。做它会动 paper（若走 base）或只 aurora。低值，未动免过度。
>
> ---
>
> > # ⟳ 2026-07-22 · 布局与真部件战役 · **验收批次①+② 双双就绪，停等 Danny 人测**（上一段）
>
> **状态**：批次①（棒A-C 主页骨架）+ 批次②（棒D-F 三件真部件）全部落地，**本地 commit 全未推**。
> 手册 `.issues/layout-real-0722/acceptance-1.md`（骨架）+ `acceptance-2.md`（真部件）。
> 打不开 .md 就开 `acceptance-1.html`（pandoc 渲染副本）。dev server 三口挂着：5173 / 3100 / 8137。
>
> ## 验收入口
> `http://localhost:5173/?v=2&mode=live&lang=zh`（**必须带参**）· 对照板 `align-board/2026-07-22/index.html`
>
> ## 批次② 收官判据（三处对抗审查修复后重跑）
> - cr 对齐规格 `SPEC_STICK=5` **35/35 硬断言全绿**（13 布局 + 3 结构闸）
> - A 区电池 **19/19 绿 exit 0** · 全矩阵扫雷 **0 件 / 0 指纹 · REGRESSION 0**
>
> ## 批次② 三件真部件（全零 transport 改动）
> ① 差距面板（自报vs观察对照 + 三态筛选，含 B-2 claim 闸修复：标题行不再冒充自述）
> ② 关注成员面板（首字母头像+口径句+原文，**无百分比无血条** D14）
> ③ 顶栏搜索（searchTeam 公共 selector，≥1366 断点，aria-label）
> ④ 悬浮「问 Avery」（goScreen 中继预填不自动发，无材料/team/room 屏收起）
>
> ## 🔴 等 Danny 的两件
> 1. **8 个新中文标签是手写的**（没走 M3——delta 脚本会抹掉 feat-057 红线注释）。都短无歧义，
>    清单见 acceptance-2.md §3，请审字。要走 M3 重译我补上注释保护再跑。
> 2. push 待人测点头（对外动作）。
>
> ## 本批对抗审查逮到并已修的三处（四视角，三棒全绿之下）
> 1. button-family 假绿——差距 chip 是裸 button，门种子无差距卡故从不审计它；chip 进白名单。
> 2. EN 顶栏 tab 被裁——预算只量了中文 tab(770px)，英文 978px，1280 EN 裁末 tab；搜索 200px+断点 1366。
> 3. 悬浮钮撞 team 屏输入框（872 宽）——team 屏也收起。
>
> ## git 状态
> HEAD 一度 detached（并发 gate 所致），已 symbolic-ref 重挂回分支，无丢失。
> 分支 claude/layout-real-components-27b594 领先 origin 若干 commit，全未推。
>
> ## 🔴 进度实况（Danny 问过：/room 为什么还跟她有出入）
> **九屏里只有「指挥室」布局做完。** 其余 8 屏布局未动——RoomScreen 本战役零改动，
> 所以 /room 还是老样子，不是坏了，是排在最后一批。全局部件（顶栏搜索/悬浮问Avery）已全站生效。
> 战役大致走了一半：最难的全局骨架 + 四件真部件搭完，剩下是照定好的语法逐屏刷布局 + 补动效。
>
> ## 下一批（验收批次③）
> 棒G1-G3 其余 8 屏布局收敛：G1 followups/notes 列表化（divide-y 行流）→ G2 closerlook 对照双列
> + projects 材料点组 → G3 playbooks 两列渐变卡 / vision / room 通用语法 + **动效 pass**。
> 逐屏对照 :3100 清点新的真部件候选（有数据基础才做，假按钮仍不建）。
>
> ## 🔴 动效债（Danny 07-22 点名「不能漏」）—— 见 `.issues/layout-real-0722/polish-checklist.md`
> 头条：**「问 Avery」悬浮入口一条动画都没有**（lite2.css:6197 起零 transition/animation，
> 点胶囊硬切成输入框）。她是平滑展开。批次③ 棒G3 动效 pass 补。逐屏发现的其它细节往清单里加。

> # ⟳ 2026-07-22 · 布局与真部件战役 · **验收批次① 就绪，停等 Danny 人测**（★下个 session 从这里接）
>
> **状态**：棒A（工具链）+ 棒B/B'/C（主页骨架）落地，**7 个本地 commit 全未推**。
> 验收手册 `.issues/layout-real-0722/acceptance-1.md`（含两段式人测流程、实测预期值、空错态触发法）。
> dev server 三口挂着：我方 5173 / 她方 3100 / mock 后端 8137。
>
> ## 验收入口
> `http://localhost:5173/?v=2&mode=live&lang=zh`（**必须带参**，裸 URL 进老 story 壳）
> 对照板 `eval-harness/reports/align-board/2026-07-21/index.html`
>
> ## 收官三判据（本批次）
> - `SPEC_STICK=5` cr 对齐规格 **35/35 硬断言全绿**（含本战役新增 13 行布局断言）
> - A 区电池 **19/19 绿 exit 0**
> - 扫雷全矩阵（9 屏 × 2 皮 × 4 世界）**0 件 / 0 指纹 · REGRESSION 0**
>
> ## 🔴 等 Danny 定的一件事
> **悬浮入口不能叫「快问」**——那已经是 feat-034 Ask 的正式名（ADR-0023 锁定 + 9 个 i18n 键 +
> M3 生成器铁律）。两个「快问」一个把问题发给 Avery、一个把链接发给员工，同屏会让人分不清在问谁。
> 我先按「去议事室」族命名实现，等他拍板。改 label 是一行。
>
> ## 已定位待修（棒D）
> 差距卡「自报」列显示的是**标题行**不是自述句（`gapDerive` 注释自称修过这个 bug，只修了一半）。
> 实测复现：语料里写着「进度：本周完成…」，抽出的 summary 却是「项目：销售 FAQ 梳理」。
>
> ## 本批次最值得记住的两条教训
> 1. **光量宽度不量归属 = 假绿。** 棒B 把双栏比例改对了，但柱子里装的还是原来那两块，
>    决策卡 1354px 破 D15 上限 314px，而 spec 十行全绿。加了三行结构闸规格才钉住。
> 2. **headless 看不见滚动条。** 「与顶栏逐像素齐平」在 headless 成立、真机差 7.5px，
>    而门只量 width 不量 left 且跑 headless —— 这类回归**永远查不到**，只能靠人测 + 注释守。
>
> ## 下一批（验收批次②）
> 棒D 右栏两面板真接线（含 claim 闸）· 棒E 顶栏真搜索（≥1280px 断点，实测预算见 topbar-budget.md）
> · 棒F 悬浮提问入口（移 LiteComposer，零 transport 改动）。

> # ⟳ 2026-07-22 · cr-align 战役已上产收官 → 下一战役「布局与真部件」kickoff（★下个 session 从这里接）
>
> **状态**：cr-align 棒0-棒7 全部上产（bundle 5b04ada，真机四联验证在案，receipt-r7 终章）。
> Danny 验收后拍板下一战役路线（推荐案通过）。本地 preview/mock/cr-live 服务已关，
> 新 session 按老姿势起环境。
>
> ## 下一战役：布局与真部件（Danny 两轮拍板后的最终口径）
>
> **战役定义（拍板修正①）：九屏全做，主页只是举例。** 每一屏都走同一条思路：
> 对照她的对应屏（:3100 真路由）把**布局密度/骨架**对齐过来 + 逐屏清点哪些部件能做成
> **真的**（有数据基础才做；假按钮仍然不建，这条红线不变）。有直接参照的屏
> （home→/ · team→/people · projects→/projects · followups→/checklist · closerlook→/gaps ·
> playbooks→/playbooks）逐屏对表；无参照屏（议事室/笔记/未来方向）用她的通用语法自行设计。
>
> 首批已拍板的具体件（主页示例延伸出来的，做的时候各屏还会清点出新件）：
> 1. 指挥室双栏满宽仪表盘（右栏=真差距面板+真关注成员面板，数据现成）
> 2. 快问悬浮入口，接真提问流（全局部件；叫「快问」，「Nexus」锁词）
> 3. 顶栏真搜索（全局部件；成员/项目关键词检索，无结果态诚实）
> 4. KPI 卡位只放敢背书的真数（计数族）；编造型指标（营收完成率/人员负载百分比类）
>    明确不做（无数据基础=编数，且负载百分比撞人面零数字红线）
>
> ## 🔴 验收纪律（拍板修正②——与上一战役最大的不同，一个字都别打折）
> **不默认上产。** 每个验收批次（建议 2-3 棒一批，也可整战役一批，看体量）：
> 1. 写**验收手册** `.issues/<战役目录>/acceptance-<批次>.md`：验收 URL（带参！）、
>    逐屏看点清单（改了什么/该长什么样/对照她的哪一屏）、**端到端人测流程**
>    （step-by-step：从新访客闸门页进 → 上传/示例团队 → 逐屏操作路径 → 预期状态，
>    含空态/错态怎么触发）、已知留后项。
> 2. dev server 起好挂着（preview 5173 + mock 8137，收工不杀），验收手册路径贴给 Danny。
> 3. **Danny 在 dev server 上人测点头后才 push 上产**，然后生产取证补收据。
> AFK 模式=干到「验收就绪」状态停下等人，commit 自主、push 必须等点头。
>
> ## 打法（沿用 cr-align 全套纪律，都验证过了）
> - 规格驱动：extract-cr-spec 逐屏补提她的布局/部件规格行（:3100 真路由，index.html 是
>   过期代码别碰）→ 人筛入 cr-align-spec.json 新 stick 段 → verify-cr-alignment 红先行。
> - 固定环：sweep 棒首尾 + 23 门电池（**dist 调包者殿后+独占跑**）+ 像素基线人审后重冻 +
>   对照板 + 旧构建红证明 + 对抗审查工作流（红线/级联/AA/波及面四视角——上战役逮了
>   4 blocker，必开）。
> - 分棒建议：棒A 逐屏规格补提+主页双栏骨架；棒B 主页右栏两面板（真数据接线）；
>   棒C 快问悬浮+真搜索（TSX/store 改动，重棒）；棒D KPI 真数卡；棒E 起 逐屏布局 pass
>   （team/projects/followups/closerlook 有参照的先做）；棒X 无参照三屏；每 2-3 棒出一份
>   验收手册停等 Danny。
> - 🔴 红线全套照旧：00-base 一行不改、v01/story 冻结、en.ts 唯一文案源（本战役有新文案
>   ——快问入口/搜索占位/无结果态，走 en.ts+zh delta 老流程）、AA 4.5 硬地板、人面零数字、
>   absent≠none、不搬她源码（CSS 值+概念可）。
> - ⚠️ 本战役有真功能新增（搜索/悬浮入口），TSX/store 会动——动 transport 前先查
>   ADR-0002/0021 边界。
>
> ## 环境起步（新 session 照抄）
> - mock 后端：`cd eval-harness && AVERY_BRAIN=mock AVERY_EXTRACTOR=heuristic
>   AVERY_EMBEDDINGS=keyword AVERY_DEMO_SEED_DIR=tests/fixtures/demo-seed
>   /c/Python313/python -m uvicorn service.app:app --host 127.0.0.1 --port 8137 --app-dir .`
> - 构建/预览：`node node_modules/typescript/bin/tsc -b && node node_modules/vite/bin/vite.js
>   build --mode development`；`node node_modules/vite/bin/vite.js preview --port 5173`
> - 她的参照：`cd D:\cr-live && npm run dev`（:3100）
> - 🔴 v02 本地入口带参：`http://localhost:5173/?v=2&mode=live&lang=zh`（裸 URL=story 演示）
> - 实施在 **D:very 主检出**（worktree 只有部署产物）；电池脚本姿势见各棒收据。

> # ⟳ 2026-07-22 凌晨④ · cr-align 视觉战役 棒7 收盘=战役收官（上一段）
>
> **一句话**：棒0-棒7 全部落地。规格表 22/22 全绿 + sweep 全矩阵 0/0（44 件台账清零）+
> 电池 23/23 连续四轮零红 = 收官判据三项全中；对照板人审=Danny 回来补最后一环。
> 收据 receipt-r7-0722.md（含收官清点）。
>
> ## ⚠️ 最重要的事：棒3-棒7 五个 commit 全在本地未推送
> - Danny AFK 指示「一路干到底、先不推不部署、dev server 验收」——本地 main 领先 origin
>   5 commit（6764c36 棒3 / 9ea4927 棒4 / 18f1639 棒5 / ae602fd 棒6 / 棒7 见 git log）。
> - **验收入口 http://localhost:5173/?v=2&mode=live&lang=zh**（vite preview 挂终局构建 + mock 后端 8137 +
>   cr-live 参照 :3100，收工全部保持运行；如果机器重启过：先起 8137（uvicorn 见
>   .issues/feat-025/session-handoff.md l.49 姿势+mock 三件套 env）再 `node
>   node_modules/vite/bin/vite.js preview --port 5173`）。
> - 对照板 eval-harness/reports/align-board/2026-07-21/index.html；demo 门一键看真人卡。
> - **Danny 点头后：`git push` 一次上产五棒** + 生产计算值取证补进各收据。
>
> ## ⚠️ 验收 URL 必须带参（Danny 回来第一问的答案，2026-07-22 已修档）
> - 本地裸 URL `localhost:5173/?lang=zh` 会进**老 story 演示原型**（英文假数据）——这不是回滚
>   不是坏档：routes.ts:14 规定 `?v=2&mode=live` 才是 v02 入口；生产裸 URL 等效 v02 是因为
>   vercel.json build env `VITE_AVERY_MODE=live` 在构建期换了默认。
> - 本地想复刻生产默认需要 live 构建，但 vite.config.ts 守卫拒绝 live+回环 API base
>   （feat-068 防「访客机器当后端」，别绕它）——所以本地验收一律用带参 URL，就这一条纪律。
>
> ## 战役之后的下一步（按优先级）
> - 5B 材料体检卡解冻（Danny 拍板③：对齐先行体检卡顺延——现在对齐收官了）。
> - 可选棒8 死规则清扫（老散按钮/hover 规则已被族强断言层压住，纯卫生）。
> - 战役期间记档待 Danny 的事：demo 克隆在生产库累积（清扫=删除类，要他点头）；
>   头像语气渐变若刺眼退法=删 ㉑ 三行变体；真折叠 spring 归独立小棒。
>
> ## 全战役坑档索引（别再踩，各棒收据有详录）
> - CSS 注释「星号斜杠」字面吞下一条规则（棒4）；媒体查询不加特异性（棒4）；
>   双类迁移必须配族强断言层收权交互态（棒4）；构建压缩去 custom property 前导 0（棒3）；
>   浅灰小字上渐变裸底必先实算紫斑合成底（棒3）；电池序=dist 调包者殿后+独占跑（棒4）；
>   ps5.1 啃 UTF-8 无 BOM（棒0）；page.evaluate 字符串不吃 arg（棒0）。

> # ⟳ 2026-07-22 凌晨③ · cr-align 视觉战役 棒6 收盘（上一棒）
>
> **一句话**：屏组二——项目卡她的 6px 顶部渐变条（渐变 token 第一个消费面，四态四色含
> unknown=灰，status-truth 仲裁绿灯）+ 首字母头像浓渐变方块白字。零 TSX。
> 电池 23/23 连续第三轮零红；净室扫雷 0/0。收据 receipt-r6-0722.md。
>
> ## ⚠️ 棒3-棒6 四棒都未推送（Danny AFK 指示 dev server 验收）
> - 本地 main 领先 origin 4 commit；**验收入口 http://localhost:5173/?v=2&mode=live&lang=zh**
>   （preview+mock 8137+cr-live :3100 全在跑）；对照板 align-board/2026-07-21/index.html；
>   demo 门一键进示例团队看真人卡头像。
> - 点头后 `git push` 一次上产四棒 + 生产取证补收据。
>
> ## 下一棒是什么：棒7 屏组三——轻屏 + 动效扫尾（S–M）
> - notes/vision/closerlook/playbooks 轻展示屏上族补漏；lite2-rise 逐屏铺开
>   （gap 卡列/notes 行/vision 卡，全部包 no-preference）；
> - **playbookTag 迁 .lite-badge 色**：aurora 探针 playbookTagIsBlueBadge* 两字面量红先行
>   重基线（计划内最后一次基线变更，spec→门→码）——如果保持蓝 badge 色不变则零迁移。
> - 之后可选棒8 死规则清扫（老散按钮/hover 规则已被族强断言层压住，清扫条件成熟）。
> - 5B 材料体检卡在战役收官后解冻（Danny 拍板③）。
>
> ## 棒6 备忘
> - 旧「normal/unknown 不染色」红线已调停成「蓝≠灰显式区分」（lite2.css l.4594 注释在案），
>   paper 仍走左缘语法；团队地图小卡守左缘（尺度小）。
> - 头像语气渐变（terracotta 人=红头像）若 Danny 觉得刺眼：删 look-aurora ㉑ 三行变体即回
>   全蓝，一处改。

> # ⟳ 2026-07-22 凌晨② · cr-align 视觉战役 棒5 收盘（上一棒）
>
> **一句话**：屏组一配方誊抄——决策卡 4px tone 左边条 + 待办清单她的 checklist 形
> （整卡 divide-y+hover 半染+20px 复选）。零 TSX 全 aurora 作用域。电池 23/23 连续第二轮
> 全绿；净室扫雷 0/0。收据 `.issues/cr-align-visual-0721/receipt-r5-0722.md`。
>
> ## ⚠️ 棒3+棒4+棒5 都未推送（Danny AFK 指示 dev server 验收）
> - 本地 main 领先 origin 3 commit；**验收入口 http://localhost:5173/?v=2&mode=live&lang=zh**
>   （preview+mock 8137+cr-live :3100 全在跑）；对照板 align-board/2026-07-21/index.html。
> - 点头后 `git push` 即上产 + 生产取证补收据。
>
> ## 下一棒是什么：棒6 屏组二——你的团队 + 议事室 + 项目（M）
> - 人卡/徽章上族（🔴 人卡两皮零数字零血条红线高于她的 PeopleRail 设计 D14）；Room 聊天面
>   +composer 玻璃已有基础（①玻璃 chrome）；项目卡 6px 顶部渐变条（--lite2-grad-* 首个
>   消费面！tone-unknown 灰渐变保「未知≠平静」）。
> - 门最重面：person-card/group 类选择器门 + room-usability/nomaterial + aria-zh 复跑。
> - 之后棒7（轻屏+动效扫尾+playbookTag 迁色红先行重基线）、可选棒8（死规则清扫——
>   老散按钮规则已被族强断言层压住，清扫时机成熟）。
>
> ## 棒5 备忘
> - flowStore（followups/triage/gap 标记）没有 window 缝——测试注入走真表单链路
>   （fill+submit），顺带验闭环。
> - 真折叠 spring 需条件渲染→常驻 DOM 改造（超「只加类名」），归战役后小棒。

> # ⟳ 2026-07-22 凌晨 · cr-align 视觉战役 棒4 收盘（上一棒）
>
> **一句话**：共享组件族落地——.lite-btn 四变体（17 文件 69 处双类迁移）+ .lite-badge +
> .lite-card + lite2-rise 入场 + 族强断言层。**规格表全量 22/22 绿（战役对齐指标收满）**；
> **sweep 44 件 open 台账一棒清零**（净室 0 件/0 指纹）；**电池 23/23 全绿零红（项目首次）**。
> 收据 `.issues/cr-align-visual-0721/receipt-r4-0721.md`。
>
> ## ⚠️ 棒3+棒4 都未推送（Danny AFK 指示：一路干、先不推不部署、dev server 验收）
> - 本地 main 领先 origin 若干 commit；**验收入口 http://localhost:5173/?v=2&mode=live&lang=zh**
>   （vite preview 挂终局 dev 构建 + mock 后端 8137 + cr-live 参照 :3100，收工全部保持运行）。
> - 对照板：eval-harness/reports/align-board/2026-07-21/index.html（我方终构建 vs 她方逐屏成对）。
> - Danny 验收点头后：`git push`（=Vercel 自动上产）+ 生产计算值取证补进收据。
>
> ## 下一棒是什么：棒5 屏组一——指挥室 + 待办清单（M）
> - 决策卡→.lite-card 已上（棒4）；剩：4px 色左边条（现 3px ::before 竖条对齐她的语法）、
>   spring 折叠、操作行细节；骨架块走 token；Followups 按她 to-do 配方（行 hover
>   --lite2-surface-soft、divide-y、复选框 20px）。
> - 红线：home-skeleton/status-truth 门须保持绿（双类已保护）；骨架四块零数字。
> - 之后棒6（团队+议事室+项目）、棒7（轻屏+动效扫尾——lite2-rise 逐屏铺开在这，
>   playbookTag 迁 .lite-badge 色时 aurora 探针红先行重基线）、可选棒8（死规则清扫——
>   老散按钮规则/老 :hover 已被族强断言层压住但仍在文件里，清扫时机到了）。
>
> ## 棒4 新知识（别再踩）
> - **CSS 注释里永远别写「星号斜杠」字面**（tone-* 后跟 / 就是）——提前终结注释，残尾垃圾
>   让浏览器错误恢复吞掉下一条规则：「产物里有、CSSOM 里没有」。诊断法：styleSheets 遍历
>   vs fetch 文本对照。
> - **双类迁移的「后位同权重接管」只覆盖 base 态**——老散规则的 :hover/:focus 在
>   (0,3,0)/(0,4,0)，半套属性各自胜出会拼成墨字压墨底。上族必须配「族强断言层」
>   （.lite-btn 双写收权全态全属性）。
> - **媒体查询不加特异性**：reduce 兜底块 (0,2,0) 压不住皮层 (0,3,0) 的动画——动效应用面
>   直接包进 no-preference 才是媒体级根治。
> - **电池序**：dist 调包者（auth 门在内）必须殿后——吃 preview 的门全排它们前面；
>   电池与 agent 工作流并发=假红（撞 CPU 超时），电池必须独占跑。
> - WCAG 的 disabled 豁免不覆盖「点击后永久驻留当状态展示」的按钮文本（已加入待办 ✓）。

> # ⟳ 2026-07-21 深夜③ · cr-align 视觉战役 棒3 收盘（上一棒）
>
> **一句话**：token 加深落地——h1 26px/800、eyebrow 13px/750（色 #4d5568）、副题 14px、
> 卡面 .97、--rule-strong 实色、七条渐变 token；AA 台账 D2/D3 落地 + 对抗审查追加 D17/D18。
> **规格进度 19/22 绿**（棒2 时 15/22，剩 3 行全是棒4 组件行）。零 snippet 字面量迁移。
> 收据 `.issues/cr-align-visual-0721/receipt-r3-0721.md`。
>
> ## ⚠️ 本棒未推送（Danny AFK 指示：一路干、先不推不部署、dev server 验收）
> - 改动停在本地 commit；**验收入口 http://localhost:5173/?v=2&mode=live&lang=zh**（vite preview 挂 dev
>   构建 + mock 后端 8137，收工保持运行；cr-live 参照 :3100 也在跑，对照板已重拍）。
> - Danny 验收点头后：`git push`（=Vercel 自动上产）+ 生产计算值取证补进收据。
>
> ## 下一棒是什么：棒4 组件族（M–L）
> - **作战地图已预制**：`.issues/cr-align-visual-0721/r4-recon-map.md`（按钮全量清点+变体
>   归类+白名单锚点、triage 44 件族分布、paper token 可用面、决策卡/动效现状）——免重侦察。
> - .lite-btn 四变体（primary/ghost/soft/danger；基类 pill 结构位，aurora 覆盖 r9px/13px）；
>   **共享基类只消费两皮都声明的 RGB 三元组 token**（paper 没有 tone-*/surface-soft）；
>   双类迁移 TSX 只加类名（27 道类选择器门零迁移）；无类名按钮四处顺手补。
> - .lite-badge 归一（②-⑧ 七处度量）+ .lite-card base/hover + 决策卡上 card-base
>   （spec stick-4 decisionBg .97）+ lite2-rise CSS 入场（D16 CSS 优先；新 transform 必须
>   纳入 reduced-motion 兜底——existing project-card/gate-door 的上浮今天就没兜底，顺手补）。
> - 新门 verify-button-family.mjs 红先行（.lite2-shell 下每个 button 挂 .lite-btn 或进白名单）；
>   SPEC_STICK=4 红→绿（followupRadius 9px/followupFont 13px/decisionBg .97）→ 全 22 行绿。
> - 44 件 known-open 在此棒治愈（small-target 5 族=扩热区不套色；focus-missing 8 族=统一
>   :focus-visible；两个原生 input 单独治）。
> - ⚠️ reduced-motion @media（lite2.css l.4058）曾未闭合闷掉整片样式——块内新增必查 {} 配平。
>
> ## 棒3 新知识（别再踩）
> - **构建压缩去 custom property 的前导 0**（0.97→.97）——spec contains 期望串写压缩后形。
> - 她的「副题退灰 #667085」在壳渐变紫斑裸底实算 3.24:1——凡浅灰小字上渐变裸底必先实算
>   合成底（紫斑 ≈#d6c9ff），别拿白底数字糊弄；#4d5568 是全位达标的 aurora 灰。
> - .eyebrow 一揽子改字阶会误伤双类小注（home-people-group-caption）——一揽子规则落地前
>   grep 该类的所有双类组合。
> - dist 调包打红 visual-baseline 第四次实证（auth 门中途重建）——终局重建+五门复验照旧。

> # ⟳ 2026-07-21 深夜② · cr-align 视觉战役 棒2 收盘（上一棒）
>
> **一句话**：壳结构对齐上线——悬浮胶囊玻璃 slab 顶栏（tabs 左/铃齿轮右/白色活动 pill）+
> 让位统一 `--lite2-clear-top` 一变量九消费者 + aurora 100px 模糊背幕。零 TSX，纯 CSS+门。
> **规格进度 15/22 绿**（棒1 时 8/22）。paper 跟结构走实拍成立。收据
> `.issues/cr-align-visual-0721/receipt-r2-0721.md`。
>
> ## 下一棒是什么：棒3 token 加深（S–M）
> - look-aurora.css：H1 26px/800 平值（撤 clamp，aurora 覆盖）、eyebrow 13px/750/0.02em
>   （`.lite2-shell[data-look='aurora'] .eyebrow`——.eyebrow 与 story 共享必须带前缀）、
>   `--lite2-surface` .86→.97、`--rule-strong`→#8fa1b8、`--lite2-surface-soft #eef3fa`、
>   tone 渐变七条 `--lite2-grad-*`（誊值自她 data.ts）、副题 14px。
> - AA 台账 D2/D3 落地：gray 徽章字→#5b6577、gold→#75591f（spec 已内化）。
> - 本棒是指定的 aurora 基线变更事件之一：h1/eyebrow 探针若在 assertAuroraApplied 里（暂无）
>   不涉；SPEC_STICK=3 红→绿（今天全量剩 7 红里的 5 行：type.h1/h1weight/eyebrow/
>   eyebrowWeight/token.surface + card.decisionBg 在棒4）。
> - 固定环照跑：sweep 棒首尾 + 电池（cr-alignment 换 SPEC_STICK=3）+ 对照板 + 旧构建红证明 +
>   像素基线人审后重定。
>
> ## 棒2 新增的门与工具
> - **verify-skin-phases.mjs**（新，进电池）：E 组皮相位固化成可跑门（此前手册协议）——
>   第一跑就逮到 feat-068 遗留的 PAPER_BASELINE 陈旧漂移（playbookTagColor，已溯源补采）。
> - assertAuroraApplied 现在读 **topbar 四值探针**（slab 化）+ activeTabIsWhite；
>   字面量来源=cr-align-spec.json（spec→门→码，别从构建反抄）。
> - 电池清单 22 门：…+ topbar-clearance + cr-alignment(SPEC_STICK=N) + skin-phases + sweep-selftest。
>
> ## 别再踩的坑（棒2 新增）
> - 壳几何覆盖必须 `@media (min-width:861px)` 作用域——00-base 在 ≤860 把顶栏转 sticky 竖排，
>   裸覆盖 left/transform 会把移动端砸烂。
> - `.scene-tabs` 的玻璃在 aurora 移到了 topbar slab（branch ⑫ 后写覆盖 branch ①，仅 ≥861）；
>   移动端仍是 branch ① 的玻璃 pill + 00-base 暖纸底（历史小怪，观察项）。
> - 页脚没并入夹宽体系（全宽条硬套会半生不熟）——归 footer 整体重塑棒。

> # ⟳ 2026-07-21 深夜 · cr-align 视觉战役 棒0+棒1 收盘（上一棒）
>
> **一句话**：Danny 拍板「UIUX/layout/风格**完全对准**合伙人 cr-live 版本 + 系统扫 UI bug + 功能
> 逻辑不动」。战役总计划已批（`.issues/cr-align-visual-0721/plan.md`，分 8 棒；ADR-0027）。
> 本棒=棒0+棒1：扫雷/规格 harness 全套落地 + 两个生产 UI bug（顶栏压标题、加到待办裸按钮）
> 红先行修复上线。四拍板：**paper 跟结构走 / 分棒推进 / 对齐先行 5B 顺延 / 缺件不补建**。
>
> ## 下一棒是什么：棒2 壳结构（对齐战役第一个大改动棒）
> - 悬浮胶囊 nav slab：`.lite2-shell .prototype-topbar` 覆盖 fixed top14 居中 `min(1480,100vw-48)`
>   radius16 + aurora 玻璃（00-base 一行不改）；**同 commit 换 4 个门字面量**（tabsGlass*/blur/
>   shadow 探针改指 topbar、activeTabIsNavy→White）。
> - 让位统一：`--lite2-clear-top:96px` 一变量九消费者（含撤销棒1 的 notes/vision 84px 改回内容
>   padding）；aurora `::before` 100px 模糊背幕；底部钉死件审计清单在 plan.md 棒2 节。
> - 照固定环跑：sweep 棒首棒尾 + SPEC_STICK=2 + 对照板给 Danny + 旧构建红证明 + 像素基线人审后更新。
>
> ## 本棒新家伙什（下棒直接用）
> - **扫雷**：`node eval-harness/tools/sweep-ui-defects.mjs`（前置=门电池同款 mock 8137+preview 5173；
>   `--selftest` 是硬门）。台账 `eval-harness/tools/ui-sweep-triage.json`（tracked）：现挂 open 44 件
>   = small-target×28 + focus-missing×16，**全部排给棒4 组件族**，别散修。
> - **规格门**：`SPEC_STICK=<棒号> node eval-harness/tools/verify-cr-alignment.mjs`；规格表
>   `eval-harness/specs/cr-align-spec.json`（22 行 stick 分期；改门字面量从这里誊，spec→门→码）。
>   全量跑=战役进度表（棒1 时点 8/22 绿）。
> - **对照板**：`CR_BASE=http://localhost:3100 node eval-harness/tools/capture-align-board.mjs`
>   （cr-live dev server 在 D:\cr-live `npm run dev`，node_modules 已装）。
> - **像素基线**：`node node_modules/playwright/cli.js test -c eval-harness/visual`（36 张，
>   __snapshots__ gitignored 单机产物；重基线 `--update-snapshots` 只在人审后同 commit）。
> - **让位门**：verify-topbar-clearance 进常备电池（九屏首标题≥顶栏带底+8，新屏忘让位立刻红）。
>
> ## 别再踩的坑（本棒新增证据）
> - **`powershell`(5.1) 读 UTF-8 无 BOM 的 .ps1 会把中文啃成 ParserError 整文件不跑**——批处理
>   一律 pwsh + utf8BOM。
> - **page.evaluate(字符串) 不吃 arg 参数**（字符串按表达式求值）——函数表达式串要
>   `(${FN})(${JSON.stringify(opts)})` 内联。
> - dist 重建门（auth-capability 等）中途换 dist 会打红像素基线——重建门收队尾 + 终局 dev 重建
>   后复验 visual-baseline（本棒实测重演一次）。
> - cr-live 的 `--shadow-lg` 有值（Tailwind 默认兜底）但非她定义——heavy pop 用我方 `--shadow`。
>
> ## 站着别动的事
> - 裸「风险：」词表、`origin/p5-04-nexus-safe-zone`、凭据轮换——仍归 Danny。
> - 合伙人对外「不打分不排名」旧口径——Danny 亲自同步。
> - 已合未删分支（删除闸）；**5B 体检卡顺延**（对齐战役收官后接，Danny 已拍）。
> - demo 克隆副本累积观察项（过期清扫=删除类动作先问）。

> # ⟳ 2026-07-21 晚 · 输入侧棒 r2 收盘（上一棒）
>
> **一句话**：Danny 追加拍板「onboarding 改独立闸门页 + 一键示例团队放进门厅」——已全部落地上线：
> OnboardWizard→OnboardGate 全屏闸门（LiteModal 底座不换，CSS 承担整页观感；对齐 cr 藏在
> /companyinput 的独立页）、后端 /demo/status+/demo/claim（seed 自铸母本一次 + 每访客**克隆**私有
> 副本——不共享不只读，理由与合约见 ADR-0026）、8A「公司现状」采集送 company_notes
>（「不会发到任何地方」承诺同棒改口，en+zh）。后端 pytest 3367/0，新门 verify-onboard-gate 39/0
>（五世界，红证明过），回归 16 道全绿。
>
> ## 现在线上是什么
> - **前端** `averylite.dannyqian.com` = 本棒 main（Vercel 自动部署，收工 stamp 验证见本棒 merge
>   SHA）：新访客第一眼=全屏闸门三扇门（示例团队门在后端探测到 demo 时出现）；Escape/「先随便
>   看看」= pause 续进度；跳过者的首页骨架有示例团队第二机会位。
> - **后端** `avery.dannyqian.com` = 本棒新镜像（demo 面 + POST /team/{id}/notes；构建/换容器
>   照 deploy-receipt-backend-0720.md 的 main 构建纪律，回执在 .issues/input-side-0721/）。
>   容器 env 新增 `AVERY_DEMO_SEED_DIR`（三亚脱敏 seed 六份已放服务器）+ `AVERY_RATE_DEMO_PER_MIN`。
>   demo 母本已暖场（真 LLM 铸过一次），一键领取秒回。
>
> ## 下一棒是什么
> 1. **5B 材料体检卡后端真实版**（Danny 明确不要轻量过渡版）：抽取层输出覆盖度元数据（时间范围/
>    可用字段/缺失字段/判断等级）→ 前端体检卡。合伙人的三档输入标准+六类误差设计在对话0721.txt
>    后半，照它做。这是输入侧三件套最后一件（3A/8A 本棒已清）。
> 2. 观察项：demo 克隆副本会在生产库累积（每份 ~几百 KB 含 bytea）——有限流表盘；将来加过期
>    清扫属**删除类动作，先问 Danny**。
>
> ## 别再踩的坑（本棒新增证据）
> - **D:\avery 的 node_modules 缺 .bin shim 与 @babel/core**：`npm run build`/`vite dev` 都起不来——
>   build 用 `node node_modules/typescript/bin/tsc -b && node node_modules/vite/bin/vite.js build`，
>   预览用 `vite.js preview`（launch.json 已改）。`vite build` 在 tsc 红时照样出绿包——**白屏
>   `fill(undefined)` 十有八九是 dist 陈旧**（zh 缺键），先 tsc 再 build。
> - **zh delta 只补缺键不改旧键**：改了既有 en 键的语义（如 onboardTeamBody 承诺改口），zh 旧译文
>   会原样留着继续撒谎——必须手改或删键重译（本棒真机验证时逮住一次）。
> - aurora 皮的追加规则要带 `.lite2-shell` 前缀升特异性（lite2.css 打包在皮之后，同权重会输）。
> - Playwright 直连 `127.0.0.1:5173` 会 ECONNREFUSED（Node 24 preview 绑的是 localhost/::1）——
>   VERIFY_BASE 用 `http://localhost:5173`。
>
> ## 站着别动的事
> - 裸「风险：」词表加宽、`origin/p5-04-nexus-safe-zone` 处置、凭据轮换——仍归 Danny。
> - 合伙人对外还在讲「不打分不排名」旧口径——Danny 需亲自同步她（ADR-0025 后果节）。
> - 分支 `claude/cr-align-r1-0721`、`claude/input-side-r2-0721` 已合入未删（删除闸）。

> # ⟳ 2026-07-21 · CR 对齐棒 r1 收盘（上一棒）
>
> **一句话**：合伙人反馈到了（零数据实测：demo 被读成「文件解析器」）——三人探索队 + command-room
> 真机勘察 + grill 九问，Danny 拍板 `1A 2C 3A 4A 5B 6A 7B 8A 9A+`（全录
> `.issues/cr-align-0721/decisions.md`，**下一棒照抄不重问**）。本棒落地六项 + 快改层，
> 16 道门全绿（3 道新/改写的先红过），已合 main 部署上线。
>
> ## 现在线上是什么
> - **前端** `averylite.dannyqian.com` = 本棒 main（Vercel 自动部署，收工时用 `__AVERY_BUILD__.commit`
>   实测确认——SHA 见 git log 本棒 merge）：**aurora 转默认**、无数据首屏=指挥室骨架、tab 主副名
>   （指挥室/今天 · 待办清单/跟进）、评分承诺开关化文案、⚙ 设置菜单（语言/观感收进去了）、
>   决策卡「加入跟进」+ 首页今日待办块、议事室无材料诚实空态。
> - **后端** `avery.dannyqian.com` 零改动（仍 `avery-agent:main-20260720-211529`）。
>
> ## 下一棒是什么（输入侧三件套，拍板已锁）
> 1. **3A 一键示例团队**：后端预铸共享 demo context。seed=真实脱敏材料
>    `D:\Boyle\research\sanya-lushan-yiju-hotel\0721-脱敏seed\`（1 工作汇报.docx + 5 匿名简历.pdf，
>    全中文）。⚠ **先修后端 issue #10**（跨文档去重失效 + `_slug` 中文名压缩 u_x），否则 5 个人塌成一张卡。
>    前端插槽已留好（HomeScreen 空态注释 + verify-home-skeleton 门）。
> 2. **5B 材料体检卡后端真实版**（Danny 明确不要轻量过渡版）：抽取层输出覆盖度元数据（时间范围/
>    可用字段/缺失字段/判断等级）→ 前端体检卡。合伙人的三档输入标准+六类误差设计在对话0721.txt 后半，照它做。
> 3. **8A onboarding 采集公司状况+项目详情送后端**：company_notes 表已有（迁移 0006）；
>    「仅保存在本浏览器，不会发到任何地方」（en.ts onboardTeamBody）**必须同步改**——DoD 显式项。
>
> ## 别再踩的坑（本棒新增证据）
> - **dist 指向陷阱**：verify-auth-capability 把 dist 重打到 8281 不还原——重打 dist 的门放战列队尾，
>   跑完终局重建默认 dist（本棒 file-manifest/onboarding 两门被殃及后复绿）。
> - 切换器在 ⚙ 设置菜单里：门要先点 `.lite-settings-toggle`；账号弹层不吃裸 Escape，要 `ensurePanelClosed`。
> - 改 tab 主名 = 同 commit 三处联动（en/zh 键 + assertV2Boots + verify-p0 锁定词表），ADR-0025 有全录。
>
> ## 站着别动的事
> - 裸「风险：」词表加宽、`origin/p5-04-nexus-safe-zone` 处置、凭据轮换——仍归 Danny。
> - 合伙人对外还在讲「不打分不排名」旧口径——Danny 需亲自同步她（ADR-0025 后果节）。
> - v01 (lite) 本轮冻结于 feat-080 形态（共享文案键的值变了会跟着变，结构零动）。

> # ⟳ 2026-07-20 深夜 · UIUX 棒收盘（上一棒）
>
> **一句话**：首个专职 UIUX 棒（feat-080）——议事室两个真人用不了的交互（按钮被 HUD 盖死 /
> 滚轮劫持）、一句同屏自相矛盾的空态文案、两张皮铺满九屏的小字对比度、以及首次 code-splitting
> 全部修完上线；三道新门先红后绿（红全是对着修复前 dist 真跑出来的）；顺手把门清仓做了一半
> （data-boundary 复活 37/37、verify-server 重写、verify-p0 首次全量 41/0）。
>
> ## 现在线上是什么
> - **前端** `averylite.dannyqian.com` = 本棒 merge 后的 main（Vercel 自动部署，收工时已用
>   bundle 内 `__AVERY_BUILD__.commit` 实测确认——具体 SHA 见 git log 本棒最后一个 commit）
> - **后端** `avery.dannyqian.com` = 镜像 **`avery-agent:main-20260720-211529`** —— **本棒零后端改动**，
>   容器、生产库（9 张表、迁移停在 0008）、回滚梯七级全部原样
> - v02 客户首载 gzip **307→231 kB（-25%）**：story 路演资产（183kB）与 v01 逃生门（43kB）
>   已退出客户路径，首次切壳才拉
>
> ## 修了什么（细节别在这展开，看 progress.md「2026-07-20 深夜 · UIUX 棒」+ feat-080 evidence）
> F1 议事室「展开原始流」被 brief HUD 盖死（shared 的 story 定位残留 transform 未清；真人点不到，
> Playwright 真实点击超时那条「另案」就是它）· F2 滚轮在结果卡/终端流上被画布缩放劫持（wheel 无
> excluded）· F4 handoffs 空态在有 N 处风险信号时仍说「一切平稳」（同屏矛盾，两壳双语，zh 走
> delta 脚本分两趟 + 导演修正词汇）· F6/F7/F8 小字对比度（paper --ink-faint 3.08→4.7、aurora
> 「需确认」chip 2.77→AA；装饰色一个没动，新增每皮 *-text 深色调；story 冻结面零触碰）·
> 三壳 React.lazy 拆包。
> 新门 3 道：verify-{room-usability,handoffs-empty-honesty,contrast-smalltext}（全在
> eval-harness/tools/）。回归全绿零回归，zh 纯度基线 14 持平。
>
> ## 🔴 本棒最该带走的一条：dist 指向陷阱在本地也咬人
> auth 门跑完把 dist 重打成指向 8291，随后 verify-p0 全线「连不上服务器」——后端明明活着。
> 上次这个坑往生产库写了测试数据，这次伪装成后端故障骗排查时间。**批量跑门之后，先验一次
> dist 的 apiBase，再解读任何门的红。**
>
> ## ⚖️ 需要 Danny 拍板（原样保留，本棒一个字没替他决定）
> 1. 裸「风险：」词表要不要加宽 —— **未动**。
> 2. `origin/p5-04-nexus-safe-zone` 废弃分支怎么处置 —— **没删**。
> 3. 凭据轮换建议仍然有效（07-20 那次 env 明文暴露）。
>
> ## 下一棒该干什么
> **仍然是反馈优先**：合伙人端到端试用反馈一到就放下一切先处理。反馈没来之前可做（都不需要拍板）：
> ① EN 皮上「需确认」是中文——修法已写明（枚举映射+原样兜底，照 UploadPanel fileStatus 先例），
>    生产 zh 不受影响，属打磨；
> ② withServerDetail 恢复棒（Blockers 4b：合并 3106536 吃掉的 413/422 透传 + fixB-transport 门
>    一起补——门单独修等于给不存在的功能开绿灯）；
> ③ 测试盲区三件套（p0 tab 循环封顶 5/9、并发多标签、登出清场）；
> ④ 打磨簿（progress.md 遗留第 3 条：玻璃 blur 漂移 / mono 栈 / z-index 90 撞车 / 死 @media 规则）。

> # ⟳ 2026-07-20 晚 · 四条 blocker 收盘（上一棒）
>
> **一句话**：07-20 收盘列的 Blockers 第 3/4/5/6 条（都不需要 Danny 拍板的那四条）已全部修完、
> 全部上线、全部带红→绿证据。**每一条的「红」都是用变异真跑出来的，不是推断的。**
>
> ## 现在线上是什么
> - **前端** `averylite.dannyqian.com` = **`b054117`**（Vercel 自动部署，已用 bundle 内
>   `__AVERY_BUILD__.commit` 实测确认，不是靠"应该部署了"）
> - **后端** `avery.dannyqian.com` = 镜像 **`avery-agent:main-20260720-211529`**（= main `b054117` 本身）
> - **生产库** `avery` schema **仍是 9 张表**，迁移仍停在 0008 —— 本次后端改动面只有
>   `service/ask_api.py` 一个文件（+36 −14）
> - **回滚梯七级**，退一级 = `avery-prev-20260720-211529`。命令见
>   `.issues/v02-joint-0719/deploy-receipt-backend-0720.md` §第七次上线
>
> ## 修了什么（细节别在这展开，看 progress.md 与各 commit）
> B3 五个 ask 端点接账号支路（换设备登录后「快问一句」不再 404）· B4 能力探测区分「后端说没有」
> 与「我没问到」+ 登出口脱钩于探测结果 · B5 切语言三处后遗症（账号面板收编进 i18n / 偏好不再
> 被登出抹掉 / 派生层去 locale）· B6 v01 补文件状态渲染。
> 门：`verify-auth-capability` 14→25 · `verify-auth-form` 39→57 · `verify-null-owner` 15→24 ·
> `verify-file-manifest-truth` 15→30。零回归（其余 9 道门数字全部持平）。
>
> ## 🔴 本次最该带走的一条结论：**门的健康度本身需要被巡检**
> 修的过程中撞见三件事，都不是产品缺陷，是**质量信号失效**：
> - `verify-fixA.mjs` **在 main 上就是红的**（26 ok / 6 failed），而且没人发现——它断言的三个
>   字段 feat-068 起就搬到 `shared/handoffCopy.ts` 了，门没跟着搬。已修 → 37/0。
> - `verify-zh-purity.mjs` 在 build+preview 下是**崩**不是失败（用了 DEV-only 的
>   `__AVERY_LITE__`）。换无条件缝 `__liteStore` 后真跑出 14 处，与基线逐字一致。
> - `.issues/v02-partner-align-0718/` 下**另有 6 道门一跑就崩**（全部先于本 session 存在，
>   已取证到具体提交）——**未修，留给下一棒**。
>
> 07-20 白天反复在讲「绿灯盖着坏屏幕」；这三件是它的镜像。**一道长期红着没人跑的门、一道一跑
> 就崩的门，作为质量信号，和「绿而看错屏幕」是等价的零。**
>
> ## ⚖️ 需要 Danny 拍板（原样保留，本棒一个字没替他决定）
> 1. 裸「风险：」（无「点」字）要不要加宽词表 —— main 自己也没盖，**未动**。
> 2. `origin/p5-04-nexus-safe-zone`（6/07 废弃分支）怎么处置 —— **没删**。
> 3. ⚠️ **凭据轮换建议**：为复用生产 env 跑过一次 `docker inspect ... .Config.Env`，三个 LLM key
>    与 Supabase DSN 在 agent 会话里明文出现过一次（未外传、未进仓库）。取 env 的做法已改成
>    「重定向进 600 文件、全程不打印」，不会再复现。
>
> ## 下一棒该干什么
> **仍然是先等合伙人端到端试用反馈** —— 真实用户第一次撞到的东西，比我们列的清单更有价值。
> 反馈没来之前可做（都不需要拍板）：① 门清仓（把 20 道门逐个跑一遍、把跑不起来的分类处置，
> 见 progress.md Blockers 第 4 条）；② 测试盲区补齐（并发多标签 / `verify-p0` 的 tab 循环封顶
> 5 个而现在有 9 个 / 登出流程未覆盖）。

> # ⟳ 2026-07-20 open loop 收盘(★下个 session 从这里接;本条是根级综合,细节按指针去看)
>
> **一句话**:前后端都已从 main 拉齐上线,今天最重要的产出不是某个修复,而是一条流程结论——
> **生产镜像今后一律从 main 直接构建,不许再往旧基线上叠子集**。
>
> ## 现在线上是什么
> - **前端** `averylite.dannyqian.com` = commit **`43e1ddb`**(= main,Vercel 已重新部署)
> - **后端** `avery.dannyqian.com` = 镜像 **`avery-agent:main-20260720-193804`**(= main,基线重拉产物)
> - **生产库** `avery` schema **9 张表**(今天只多了 `account_contexts`,Danny 当面拍板;表里只有两个不透明 id、无人员数据,红线未动)
> - **回滚**:六级容器全部保留(`avery-prev-20260720-193804` 起逐级可退)。步骤见
>   `.issues/v02-joint-0719/deploy-receipt-backend-0720.md` §一键回滚(`docker rm -f avery` → `docker rename avery-prev-<ts> avery` → `start` → `curl /health`)。
>   ⚠ 回滚**不会**删掉 `account_contexts`(留着无害,旧镜像根本不读它)。
>
> ## 🔴 流程结论(今后照办,别再犯)
> 07-18 起的打法是「在旧生产基线上叠指名子集」。今天的对抗性复审证明这会**系统性漏掉没人显式点名的修复**——
> main 上一整批中文修复因此漏了两天没上线。本 session 六条必修上完后已做**基线重拉:直接从 main 构建镜像**。
> 今后:① 生产镜像从 main 构建;② 要查生产缺什么用
> `git diff <生产基线> main -- eval-harness/avery eval-harness/service eval-harness/db`;
> ③ 若被迫打只在生产存在的补丁,必须在提交信息里写明「重拉基线时会被静默回收」。
> 附带教训:**发现有文案键没人引用要当红旗查**——今天逮到一个合并解冲突时整边丢弃 236 行、字典键还留着,读代码看不出来。
>
> ## 本 session 干了什么(摘要,别在这展开)
> 后端 6 次部署(编码 / parse-crash 兜底 / feat-053 账号层+迁移 0008 / feat-056 决策定级 / 五条中文修复 / 基线重拉)、
> 前端 10 个提交(语言+皮肤开关 · AuthPanel 能力探测 · 判读卡中文化 · aria 中文化 · **bundle 隐私修复 19 个泄露变量→0** ·
> 状态假绿 · 老客户不弹引导 · 文件清单说实话)、新增约 10 道门、中文纯度 **86 → 14**(剩下是刻意保留的黑话+后端协议标识符)。
> 收尾:所有分支并入 main、stale 工作树全删(只剩 `D:/avery`)、孤儿服务进程清掉、`D:/avery` 已切回 main。
>
> ## 指针(先读这三份,比本条准)
> - `.issues/v02-joint-0719/handoff-openloop-0720.md` —— 本条线的细节交接单
> - `.issues/v02-joint-0719/deploy-receipt-backend-0720.md` —— 六次部署完整回执 + 回滚指针
> - `.issues/v02-joint-0719/review-0720-adversarial.md` —— 对抗性复审全文(26 提出 / 13 幸存)
> - `git log --oneline 6175e46..43e1ddb` —— 本 session 全部提交
>
> ## ⚖️ 需要 Danny 拍板(下一棒不要替他决定)
> 1. **裸 `风险:`(无「点」字)识别不到** —— main 自己也没盖。刻意**没有**在生产单方面加宽词表:那会造成只有生产有的补丁,
>    且会把「无重大风险→判有风险」那个 bug 从另一扇门放回来。要不要加宽,等 Danny 定。
> 2. **`origin/p5-04-nexus-safe-zone`**(2026-06-07 废弃实验分支,内容不在 main,共同祖先后 main 走了 351 个提交)—— **没删,留着待处置**。
>
> ## 下一棒该干什么
> **先等合伙人端到端试用反馈**。并行可做、且都不需要 Danny 拍板:
> 1. **换设备登录后「快问一句」404** —— 五个 ask 端点没接账号支路,只认本机 token(团队/笔记/文件全 200,一发问就说找不到这家公司)。改法明确:照抄 `/team` 加 header 参数。
> 2. **能力探测抖一下,账号面板整场消失但仍用上一个人身份发请求** —— 探测只发一次,超 5 秒或一次 502 就永久判「不支持」,连登出按钮一起消失。加重试,或让登出口不受探测结果影响。
> 3. 切语言开关的三处后遗症(观感级,都只在用户主动点了开关后才出现):账号按钮仍中文(`AuthPanel` 用私有字典且 `useMemo(…,[])` 不订阅 localeStore);退出登录会抹掉皮肤偏好(`wipeLite2LocalStorage` 按 `lite2:` 前缀整段清,新增的 lang/look 键正落在该前缀下);**`src/lite2/teamData.ts` 在取数期就把 locale 焊进兜底文案**,导致切语言后首页卡与详情浮层对同一事实两处说法不同,刷新才自洽(v01 无此毛病,它把兜底留在渲染层)。详见 progress.md Blockers 第 5 条。
> 4. v01 逃生门没有文件状态渲染(只有 v02 有)。
> 5. 测试盲区:并发多标签、`verify-p0` 只点前 5 个 tab(现有 9 个)、登出流程未覆盖。
>
> ## 其它如实记录
> - **「正向状态词命中后,全文风险兜底扫描永不运行」** —— main 同样没改,非独立可修复项。
> - `origin/deploy/zh512-subset-0720` 在基线重拉后**已退休**,保留作历史记录。
> - 后端依赖没钉版本(36 个 `>=`)、基础镜像没钉 digest —— 这次重建漂移 0,但两周后重建是抽奖,建议择机钉住。

> **⟳ 2026-07-14 v02 链 → 新 main 同步合流**:lite-live-v02 链
> (feat-042..045,四棒全对抗验证收口)与新 main(`5d32e4f` = 持久化链 + Ask 阶段 C 真后端)
> 分头跑了一段,本次在分支 `integrate/v02-main-sync`(从 `feat/045-v02-onboard-nudges`@`e255a97`
> 起,`git merge main` 普通合并非 rebase)完成同步。**冲突面只有 2 个文件真冲突**
> (`feature_list.json` 脚本取并集、`src/shared/i18n/zh.ts` 仅文件头注释合并)、其余
> (`en.ts`/gate 文档+snippet/`main.tsx`)全自动合并干净、`src/lite/**`/`eval-harness/**`/
> `src/story/**` 零冲突全取 main(如约零改动)。合后全量复验:`init.sh` 绿(502 模块,0 error/
> 5 warning 同 feat-045 基线);v01 十一相位 `verdict()` 真后端(mock brain)+ stub 各跑一遍全绿;
> `askVerdict` 九相位(main 阶段 C 定义)stub 全绿;v02 四组 `v2Verdict`/`flowVerdict`/
> `gapVerdict`/`nudgeVerdict`(A-D,17 相位)全绿;wallRad 4 方向真做红→绿。**未 merge 回
> main、未 push**——`integrate/v02-main-sync` 即交付物。详见 `progress.md` 本节顶部
> "Update — 2026-07-14 · v02 链 → 新 main 同步合流"(冲突逐个解法+全部门证据 JSON)。
> **下一棒**:feat-046(aurora 皮精修)/ feat-047(lite2 引擎同步真后端契约)均可从
> `integrate/v02-main-sync` 起跑,持久化已进 main 解除了 feat-047 此前的阻塞。

# Session Handoff — 2026-07-09 · lite 打磨波(S4+S5+S6)收盘

> **接续只靠本文件 + git,不回放聊天。** 上一版(07-09 S3 收盘 = 救援线 merge)见 `git show 9dbccf5:session-handoff.md`;更早 S2/S1 见其内指针。
> 本波 = Danny 2026-07-09 试玩反馈 7 项的落地(S4 考古+bug 修 / S5 模块补齐 / S6 定位叙事+能力 mock)。ADR-0022 救援线已于 S3 closed;本波是其上的产品打磨,红线与 standing 约束一字未动。

> **⟳ 07-13 收盘(★下个 session 从这里接)**:pre-ECS 硬化三波(feat/027 并行摄取 / feat/028 cluster-1 止血 / feat/029 红线中文,均 4/3 路对抗验证 CONFIRMED_SAFE)**已全部 merge 进本地 main**(merge `34cfaf9` → PRD docs `83630b8`,ahead origin 17,**未 push**=对外闸留 Danny)。会话结尾 grill 清产品定位并产出 PRD:
> - **定位翻新**:Avery lite = **精悍准真产品**——融资团队把链接甩给真实公司、公司**用自己真数据实际玩**,目的=钓鱼(lead-gen)让公司想请 Danny 深入搭 agent。**推翻 07-10 的「受控演示优先/策展假数据集」**(就绪册 §0.5 已过时);showcase/分析归 story 面;完整「agent 文件空间」留 Vision mock 当钩子。
> - **下个 session 的活(AFK,gate-first + 独立对抗验证)**:接 **Supabase(Postgres+pgvector)持久化**(替内存 REGISTRY;骑在 `ContextRegistry` get/put + `RetrievalStore`/`Embedder` 既有接缝)→ 真记忆+真RAG → 每公司文件空间 → **「Avery 的笔记」写侧可见记忆(必过红线)** → 基础租户隔离 → 上传硬门+基本抗压 → 真上 ECS/Vercel → 端到端/压测。**不上 Java Spring**(别推倒已跑通带红线闸的引擎)。取代 ADR-0021 §6 ephemeral。
> - **入口件**:`.issues/lite-v1-lean-real-0713/PRD.md`(status: ready-for-agent)+ 同目录 `session-close-and-direction.md`(方向+接缝:**该动** registry/store、**别动** 红线门/advisor 引擎/冻结集)+ 就绪册 `.issues/live-polish-0709/pre-ecs-readiness-open-loop.md`。
> - **Danny 会在下个 session 先清账号/凭据墙**(ECS host / 真 LLM key / DNS / Vercel 连接+`VITE_AVERY_API_BASE` / Supabase 项目+连接串),再据 PRD 进 AFK。

> **⟳ 07-09 追加(试玩后续,handoff 收盘之后落的)**:Danny 试玩又报 2 UI bug + 提 2 问,已全部落地:
> - **playtest bug 修**:`76543ab`(Vision 底部空白带 — 滚动容器不再为不存在的 composer 预留 148px)、`929b697`(上传双按钮/双弹 = `.upload-input` 无隐藏样式;room 空态 composer 与描述重叠 = 追问态 `position:absolute` composer 塞进居中空态卡)。两修全 `.lite-shell` 作用域,story 够不到。
> - **feat/027-parallel-ingest(`9b9787e` = 新 tip)**:Q1「上传十几个文件要并行」。`extract_docs` 加有界并发线程池(`AVERY_INGEST_CONCURRENCY` 默认 4,上限即限流护栏)、保序合并(输出与串行逐字节一致)、`并发≤1||单文件` 走原串行快路径、异常语义不动、红线门仍在合并后单线程照跑。真机 6 文件 **52s→14s(~3.7×)人数一致**;离线 197 passed/0 skipped(+8 新并发测试);gate-first 红→绿(旧串行代码上并发断言真红);4 路对抗验证(竞态/红线绕过/测试真伪/行为保真)**全 CONFIRMED_SAFE**。**⚠ 本项修改了 eval-harness(Danny 明确授权、解除本波「只读」)——§0「eval-harness 零改」对全链已不成立。** 未做:上传进度 UI(job 队列+前端轮询,更大面,标为后续)。
> - **新链尾**:`… → feat/026-vision-surface → feat/027-parallel-ingest(9b9787e = tip,含全链)`。**merge feat/027→main 即落 S4+S5+S6+playtest 修+并行摄取全部**;push=对外闸仍留 Danny。
> - **已知开口(非本次引入)**:`test_seed_gate.py::test_advise_cites_the_design_lead`(@seedgate @needs_keys 真机)自 07-07 held-open——top-k 召回缺 Lin Qing 行、M3 抽取非确定性致 flaky,与并发正交;离线门不含它(deselected)。带 key 全套跑到它可能 1 failed,属既有账。

> **⟳ 07-10(pre-ECS 就绪审计 + demo-first 拍板 + 两波落地)**:Danny 问「离上线还差多少 / ECS·Vercel 能否当后端」→ 只读部署审计 + open-loop 盲点扫描(17-agent workflow)落 `.issues/live-polish-0709/pre-ecs-readiness-open-loop.md`(权威就绪册)。
> - **拍板:受控演示优先**(数据不持久、演示用策展安全数据集非真员工 PII;auth/持久化/PIPL/跨境 降 fast-follow)。**架构:ECS=后端容器(单 task)· Vercel=前端静态 · Vercel≠后端**(有状态 REGISTRY + 分钟级长任务 + SSE)。部署线 feat-018 已建好未部署(`Dockerfile`+`vercel.json`+`docs/deploy/dual-deploy-runbook.md`),剩下主要是 Danny 的账号/凭据墙。
> - **feat/028-demo-harden-1(`6d1f46e`)= cluster-1 止血(已 CONFIRMED_SAFE)**:`python-multipart` 进 requirements(否则镜像 /ingest 500 而 /health 绿)· `/ingest` 移出 event loop(run_in_threadpool,否则长上传冻服务→healthcheck 反杀容器)· `/advise` 加超时 · 未知 context_id 大声 404(不静默回落 demo 记忆引用假同事)· runbook CORS 纠错 + TLS 提示。
> - **feat/029-redline-zh(`d0913bd` = 新 tip)= 红线中文覆盖(已 CONFIRMED_SAFE)**:英文-only 红线是洞(境内 M3 面对中文公司)。四层补中文 + Trad→Simp 归一化 + 「人 vs 工作」抑制 + 数字收紧 + 判决标签/否定转折感知。**5 轮 impl↔对抗验证(真机执行 crafted 输入,非自评)** 收敛——每轮验证都真抓到洞(绕过+误伤双向),终态 329 passed / 冻结 OK / 英文逐字节稳定;残留仅刁钻/exotic(自相矛盾「不被打分…打了2分」/内部空格 xfail)→ 011c 跨族 LLM 判官兜底。
> - **剩余 demo-first pre-ECS**:**wave-3** 上传硬门(size/count/type + 限流 + LLM 花费闸)· **wave-4** 演示安全网(策展安全数据集〔需 Danny 定内容〕+ 真实 /health 预检 + reset + 抽取降级诚实标注)。**链尾 = feat/029-redline-zh;merge 它→main 落全部(polish 波+feat/027+028+029);push 待 Danny 对外授权。**

## 0 · 一句话现状
Danny 试玩反馈 7 项**全部落地并机器验收通过**,串行三分支链就绪、**未 merge/未 push**(留 Danny 拍板对外):
- **分支链(线性,tip 含全部)**:`polish/s4-triage`(`4f90d1c` · S4)→ `feat/025-lite-modules`(`0a15628` · S5)→ **`feat/026-vision-surface`(`0ff8555` · S6 = tip,含 S4+S5+S6 全量)**。base = main `1f5a56a`(经 S3 收盘 commit `9dbccf5`)。
- **总改动面**:19 文件 +1770/-59,全部落 `src/lite/**` · `src/shared/**` · `scripts/gates/**` · docs/feature_list;**src/story/** 零改、eval-harness 零改**(只读纪律)。
- **门终态**:前端门 **十相位 verdict pass:true**(feat-024 的 6 + feat-025 的 3 + feat-026 的 1);story 未受影响(`?mode=story` 下 `.lite-shell`=0、新 lite 类=0、story 正常渲染);init.sh 绿(build 463 模块);离线 pytest 190 passed 0 skipped。每步 gate-first(新断言先真红再修绿),每 feature 收盘后经 3 路独立对抗验证(红线/墙/gate 真伪/诚实标注/i18n M3)全 clean。

## 1 · Danny 拍板(Q1–Q5,2026-07-09,全按 S4 triage 推荐)
决策原文 + 逐项实证见 `.issues/live-polish-0709/triage-report.md`。摘要:
- **Q1 Playbooks = 空态屏**(锚未来 custom-agent 能力,不移植 story);**Q2 team map = 轻量分组视图**(顺带解 Bug4「列表分类」,不做空间 map);**Q3 room 画板 = 轻建**(新建 lite pan/zoom,不搬 story NexusScene);**Q4 三模块+叙事绑做、锚未来能力+标 mock**;**Q5 story 顶栏同款 mode-switch bug 维持冻结不修**。
- 考古定谳:1/2/3 三项都是 **2026-07-07 Danny 亲拍的 v1 范围排除(拍板排除,非开发遗漏)**——双一手源 ADR-0022 决策1 + 救援 plan §0 岔口2。

## 2 · 本波交付(逐 feature)
- **S4(`4f90d1c`,分支 polish/s4-triage)**:① 考古 triage 报告落库 + 5 条拍板清单;② UI bug 4/5 act-first 修绿——Bug5「按钮风格丢失」根因=`.mode-switch-btn` 自 feat-017 从未配 CSS(**非拆-chunk 漂移**),Bug4「首页撑爆」= people 栏无限高。两修全 `.lite-shell` 作用域(story 够不到)。六相位门 pass + Bug4 真 30 人复测 isBounded。
- **S5 feat-025(`0a15628`)= done**:**Playbooks 空态屏**(第 4 tab,coming-soon,留 feat-019 数据槽)+ **team 分组视图**(`teamGroups.ts` 按 team→项目 ownership→role 聚类,真 seed 分 5 组,人卡零改零数字,Bug4 限高上移到分组列)+ **room 薄画布**(`LitePanZoom.tsx` 独立包 npm `react-zoom-pan-pinch`,**不碰 story PanZoomCanvas**)。九相位门 pass。
- **S6 feat-026(`0ff8555` = tip)= done**:lite 第 5 tab **「Where this goes」Vision 屏**——三拍定位叙事(现在=公开试玩 demo → 未来=为一家公司定制的 custom agent〔数据接入+私有安全部署+窄域可审计〕→ 这 demo 想让你判断 UIUX+判断质量+红线)+ **4 张能力 mock**(agent 文件空间/定制 skills·tools·SOP/后台批量 loop/红线=确定性闸,**每张必带可见 Preview·Coming·Mock 标注**,mock 示例人零数字)。叙事弹药取自 plan.md §2 四篇(Steinberger/Schroeder/Pocock/Martin-Dye)。十相位门 pass。

## 3 · 门基建(本波扩展,下波必用)
- **前端门已扩到十相位**:`scripts/gates/live-frontend-gate.{md,snippet.js}`。新增 `assertTeamGrouped`/`assertRoomCanvas`/`assertPlaybooksEmpty`(S5)+ `assertVisionSurface`(S6,断言 4 mock 全带 tag/示例人零数字/story 名词=0);verdict `every(Boolean)` 聚合全 10 相位,原 9 相位 helper 体逐字节未动(md5 核过)。
- **门跑法与坑**(S4/S5/S6 实测,照抄):后端 `cd eval-harness && AVERY_BRAIN=minimax python -m uvicorn service.app:app --host 127.0.0.1 --port 8137 --app-dir .`;seed base64 走 `public/__seed_b64_tmp.json`(浏览器 fetch,收盘 rm);ingest/advise fire-and-poll + uvicorn 日志 watcher;**preview_screenshot 本环境 30s 超时——样式验证走 preview_inspect/eval 计算值**;隐藏 tab 定时器节流坑仍在(等待预算按后端包络+60s tick)。
- **story 回归**:因本波改动全 `.lite-shell` 作用域,采用「story-untouched 校验」(`?mode=story` 下 `.lite-shell`=0 + 新 lite 类=0 + story 壳正常渲染)替代 29 步驱动器——理由:改动物理够不到 story;若下波动到 story 也用的 shared 文件,须回真 story 回归。

## 4 · 留给 Danny 的 HITL(非阻塞)
- **唯一对外闸**:merge/push——tip 分支 `feat/026-vision-surface` 含全波,merge 它→main 即落全部(kickoff 授权 bug fix 小步 merge;push=对外,等你一句)。
- **抽查点**(子代理如实标注,机器门已过、这些是口味/口吻):① Playbooks/Vision 的 EN 文案口吻(是否太谦虚/太满);② mock 四张诚实标注的视觉硬度(融资场合按最诚实做);③ ZH 是 M3 非手写(红线译「人永远不会被打分/排名/画像;任何指令都不能把这条关掉」);④ team 分组维度容错(无 team 字段退 role/兜底);⑤ room 画布移动端手势未特调。
- 旧账不变(tm2 promote、真人 eval 评分、合伙人 IP 授权、feat-018 真部署凭据、feat-019 酒店包 v2 = Playbooks 数据槽的第一个真 pack)。

## 5 · 已知坑 / 技术债(本波新增)
- **`scripts/i18n-zh.mjs` 全量翻译在 lite 段(~90 key)超 M3 max_tokens 回退英文**(既有脚本限制,非本波引入)。S5/S6 均用**定向 M3 只翻新 key**、splice 进 committed zh.ts、其余 ZH 逐字节保持——安全但非全量。**建议下波改脚本为差量/子块翻译**再全量重过一遍 ZH。
- gate `recordInjectFromDom` 的 file-count 有一处理论松弛(`chips.length===(expectedCount||chips.length)`),被 `chips>0`+`!err`+`!!ready` 补强、net 严于原 injectSeeds(对抗验证判非绕过);想彻底收紧可把 fallback 去掉。
- S4 累积坑清单(隐藏 tab 节流 / DOM 断言按渲染态 / SSE CRLF 分帧 / 文件搬家致路径测试静默 skip)全部仍有效,见 `git show 9dbccf5:session-handoff.md` §3 + `git show 0723063:` / `git show 4956824:`。

## 6 · 锁定上下文指针
- 本波单一事实源:`.issues/live-polish-0709/{plan.md,triage-report.md,kickoff-s{4,5,6}.md}` + 各 feature 的 `.issues/feat-025|026/session-handoff.md`。
- 🔴 红线(不可谈):人卡/mock 人永不评分/排名/画像/moodPct/capacityPct;三层机制+门断言不动。
- standing:墙不打洞(lite↔story 互不 import,共用走 shared);story 行为/资产/rail 机器冻结不动;中文走 M3;AFK 先斩后奏,人工闸只留销毁/对外/花钱/凭据;任何 lite 表面 done 判定必须含集成层证据。
