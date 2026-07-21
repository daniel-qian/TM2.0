> 侦察原件 · 视角 `css` · 2026-07-22 自动生成，未经人工编辑。

I have what I need.

## 1 · lite2.css 分区地图（5715 行，append-only 惯例）

顶层 banner（`═══`）只有 10 条；段内用 `/* ── …` 分节。区间按 banner 切：

| 行区间 | 段名 | 备注 |
|---|---|---|
| 1–2457 | `feat-024 · lite 壳（ADR-0022）` 大段 | 内含：7 首字母 avatar · 21 上传面板 · 159 文件清单 · 293 briefing 顶栏 · 325 **modal 基座** · 435 room 卡 · 497 mode 开关 · 547 语言/观感开关 · 600 团队人栏 · 625 分组视图 · **708 room 画布/panzoom** · 786 feat-059 简化输出 · 1050 playbooks · 1149 vision · 1365 Ask 卡 · 1721 closerlook · 2023 分诊次级链接 · 2122 followups · 2435 合规页脚 |
| 2458–2996 | `feat-045 · onboarding 向导 + chips + 铃铛` | 2789 room 空态 chips · 2825 铃铛 · 2979 playbooks 槽位 |
| 2997–3335 | `feat-046 · shared chunk 硬编码面的令牌镜像覆盖` | 3006 卡面/控件 · 3093 composer · 3142 结果卡 · 3151 serif 标题 · **3195 Avery's notes** |
| 3336–3504 | `feat-068 · ingest 等待态` | |
| 3505–4339 | `feat-057 · 聚合入口屏（指挥室）` | 3558 四块外壳 · 3626 ①今天要决策 · 3925 ②③并排 · 4015 ④手上有什么 · **4058 老 reduced-motion 块（曾未闭合，4075 有伤疤注释）** · 4087 账号入口 · 4269 草稿框 |
| 4340–4904 | `feat-055 · 项目屏` | 4388 覆盖率条 · 4534 分组 · 4561 自适应网格 · 4569 项目卡 · 4746 空态 · 4821 窄视口 tab · 4848 小字对比度 |
| 4905–5136 | `0721 对齐棒 · 合伙人反馈快改层` | 4974 4A 无数据骨架 · 5020 B4 今日待办 · 5076 7B 设置菜单 |
| 5137–5334 | `OnboardGate 闸门页` | 5190 三扇门 · 5253 团队信息 · 5287 首页骨架示例插槽 · 5327 窄屏 |
| 5335–5377 | 战役棒1 · 两个 UI bug 最小修复 | 5344 块已被棒2 superseded |
| 5378–5450 | **战役棒2 · 壳结构：让位变量 + 宽度体系 + 胶囊顶栏** | ← **布局规则的家** |
| 5451–5715 | 战役棒4 · 共享组件族（含 5635 起族强断言层） | |

**新增布局规则该放哪**：文件尾 5715 之后新开一条 `═══ 布局战役 棒N ═══` banner 块（沿棒1/2/4/5-7 的 append-only 纪律）。理由：① 同权重后写者胜是本仓覆盖老散规则的唯一手段（5399 行注释明说"本块在文件尾，同权重后写者胜"）；② 变量本体（`--lite2-clear-top` / `--lite2-frame-w`）住在 `lite2.css:5386-5389`，新的布局变量（如双栏栅格宽/右栏宽）应加进**同一个 `.lite2-shell {}` 块或紧随其后的新块**，别散到各屏源块去；③ 屏级"配方"（aurora 专属观感）走 `look-aurora.css` 尾部新 branch（㉓ 起），几何/结构走 lite2.css（两皮共享，Danny 拍板①「paper 跟结构走守自己配色」）。

## 2 · 组件族现状

- **`.lite-btn` 基类**：`lite2.css:5463-5481`（inline-flex / min-height 26px / padding 4px 12px / border-radius 999px / 13px / 600 / transition 吃 `var(--fast)`）。`:disabled` 5483；`:focus-visible` 5489（sky 三元组）。
- **四变体**：`--primary` 5495 + hover 5500 · `--ghost` 5505 + hover 5510 · `--soft` 5518 + hover 5523 · `--danger` 5529 + hover 5534。TSX 实际用量：ghost 36 / primary 16 / soft 7 / danger 1。
- **aurora 度量分支 ⑮**：`look-aurora.css:402-404`（`border-radius: 9px`；paper 守 999px pill）。
- **`.lite-badge`**：`lite2.css:5542-5546` — **共享层只归一字阶**（11.5px/700/line-height 1.4），**色与几何零碰**。pill 几何（inline-flex/gap 6/padding 2px 10px/999px）只在 `look-aurora.css:451-457` ⑰。原因写死在 5538-5541：paper 三个无底色标签（handoff-tone / followup-source / gap-pane-label）吃共享 padding 会变"透明底幽灵缩进"。7 族消费点：`AskCard.tsx:118` · `CloserLookScreen.tsx:85,89,164,180` · `FollowupsScreen.tsx:160` · `PlaybooksScreen.tsx:50,69` · `TeamScreen.tsx:264` · `VisionScreen.tsx:131`。
- **`.lite-card`**：`lite2.css:5551-5556`（`--lite2-surface` / `--rule` / `--radius` / `--shadow-soft` 全 token）+ `.lite-card-hover` 5558-5567（translateY(-2px) + `--shadow`）。**当前只有一个消费者**：`HomeScreen.tsx:485`（决策卡）。其余卡族（project-card / gap-card / notes-entry）各有自己的语法，尚未收编。
- **「族强断言层」**：`lite2.css:5635-5715`。机制=**双写选择器** `.lite2-shell .lite-btn.lite-btn--primary`（特异性 (0,4,0)+）把四变体的 base/hover/focus/disabled **全态全属性**收权，靠后写胜过全部老散规则的 `:hover`/`:focus-visible`(0,3,0)/(0,4,0)。存在理由：双类迁移后"后位同权重接管"在交互态塌了——五处按钮 hover 成墨字压墨底、两处焦点环被老 `outline:none` 灭掉（receipt-r4:44-52）。尾部 5713 还有一条 `.lite-btn.ask-q-remove { padding: 0 }`（26×26 圆钮被基类 padding 压成 0 宽）。
- **白名单机制**：**不是 CSS，是门**。`eval-harness/tools/verify-button-family.mjs:39-53` 硬编码 38 项选择器数组；`AUDIT_FN`（:55-77）遍历 `.lite2-shell` 下每个可见 `<button>`，要么挂 `.lite-btn`，要么 `matches(whitelist)`，否则算"裸按钮"→红。防作弊断言：九屏累计族挂载 ≥15。闸门页+九屏+铃/设置弹层全审。**新增按钮部件必须挂 `.lite-btn` 或同 commit 进这个数组。**

## 3 · token 清单

**共享底座**（`shared/styles/00-base.css` `:root`，两皮都吃、paper 的暗依赖）：`--radius: 8px` · `--fast: 180ms` · `--medium: 280ms` · `--slow: 420ms` · `color-scheme` · `font-family`。lite2.css 里 `var(--fast)` 30 处、`var(--radius)` 27 处 —— **这两个 paper 侧无声明，全靠 :root 供给**（receipt-r4:72 记档）。

**两皮都声明（共 22 个，共享基类唯一可用集）**：

| 组 | token | paper / aurora |
|---|---|---|
| 面 | `--lite2-surface` | `rgba(255,253,248,.86)` / `rgba(255,255,255,.97)` |
| 面 | `--lite2-glass` | `rgba(255,253,248,.82)` / `rgba(255,255,255,.82)` |
| 渐变底 | `--lite2-bg-gradient` | paper:40 / aurora:60 |
| RGB 三元组 | `--lite2-surface-rgb` `--lite2-ink-rgb` `--lite2-paper-rgb` | paper:52-54 / aurora:72-74 |
| 语气 RGB | `--lite2-accent-rgb` `-accent-deep-rgb` `-danger-rgb` `-danger-deep-rgb` `-warn-rgb` `-warn-deep-rgb` `-violet-rgb` `-sky-rgb` | paper:57-65 / aurora:79-87 |
| 色 | `--lite2-violet-deep` `--lite2-ink-hover` | paper:64,66 / aurora:86,88 |
| 字体 | `--lite2-heading-font` | Georgia serif / Inter sans |

**只有 aurora 有（paper 缺，共 19 个）**：`--lite2-glass-blur`(59) · `--radius:10px` 局部覆盖(51) · `--lite2-glass-border`(279) · `--lite2-radius-lg:16px`(280) · `--lite2-surface-soft`(350) · `--lite2-grad-{red,orange,green,blue,purple,gold,gray}`(352-358) · `--lite2-tone-{blue,purple,green,orange,red,gold,gray}-{bg,fg}`(96-111)。另 aurora 独有 `font-variant-numeric: tabular-nums`(91)。

**只在 lite2.css 声明（皮无关，壳级）**：`--lite2-clear-top`(5387/5393) · `--lite2-frame-w`(5388)。
**从未定义、只有 fallback**：`--lite2-z-modal`（`lite2.css:335` 写 `var(--lite2-z-modal, 120)`，全仓无声明）。

**"共享基类只能消费两皮都有的"怎么保证的**：**没有静态 lint，靠三重人肉+运行时**：① 写死在 `lite2.css:5455-5456` 的段头纪律注释；② `eval-harness/tools/verify-skin-phases.mjs`（:52-60）跑 `assertPaperUnchanged`，对 `scripts/gates/live-frontend-gate.snippet.js` 的 `PAPER_BASELINE` **逐字节 diff** —— 基类误吃 aurora-only token 会让 paper 侧解析失败/落 initial，探针立刻漂；③ 同门第三段 `assertSkinNoLeak` 证明 00-base 未被动过。**风险敞口**：PAPER_BASELINE 只覆盖有限探针（棒2 就逮到过陈旧基线漂移，receipt-r2），新部件若不在探针清单里，误用 aurora-only token 在 paper 下静默失效。

## 4 · 两皮机制

- **切法**：`Lite2App.tsx:100` — `<div className="app-shell lite2-shell" data-scene={screen} data-mode="live" data-look={look}>`。值来源 `look.ts:96-110` `resolveLook()`：URL `?look=` > localStorage `lite2:look:v1` > **默认 aurora**（0721 Danny 7B 翻的，`look.ts:105-109`）。反应式订阅 `lookStore.ts`（模块加载期初始化，避免首帧闪皮）。旧 `?skin=` 不识别但会 console.warn（`look.ts:41-52`）。
- **cascade 顺序**：`main.tsx:24-26` — look-paper.css → look-aurora.css → **lite2.css 最后**。所以 lite2.css 的 `.lite2-shell .x` (0,2,0) 会被 look-aurora 的 `.lite2-shell[data-look='aurora'] .x` (0,3,0) 压过（特异性赢，与顺序无关）；反之 lite2.css 同特异性规则赢不过 aurora 分支。**新布局规则若要两皮共享，写 `.lite2-shell .x`；若要 aurora 独有，必须去 look-aurora.css 写 `[data-look='aurora']` 前缀。**
- **paper 要不要跟新布局走**：**要**。Danny 拍板① 原文口径记在 `lite2.css:5428`「胶囊顶栏几何（两皮共享——paper 跟结构走守自己配色）」和 receipt-r5「结构跟走=共享组件族度量，屏级配方是皮语言」。棒2 的几何全在 lite2.css（两皮同吃），棒5/6/7 的屏级配方全在 look-aurora（paper 一字未动）。新战役同一分法。
- **paper 缺的 token**（见 §3 的 19 个）会让 paper 下相应部件"没有对应语言"：项目卡 6px 渐变条、软底徽章、surface-soft 行 hover、玻璃 blur、16px 大圆角 —— 这些在 paper 下要么不存在（分支未写），要么落 fallback。写新部件时 **`var(--lite2-radius-lg, 16px)` 这种带 fallback 的写法是既有惯例**（`lite2.css:5442`）。

## 5 · 布局相关既有规则

**内容容器 max-width（frame 级）**：

| 屏 | 规则 | 行 | 值 |
|---|---|---|---|
| team | `.home-frame`（shared/70-home-cards.css:13） | 13 | **1460px**，`grid-template-columns: minmax(340px,38fr) 62fr`，gap 34，padding `84px 36px 150px`；`@media (max-width:1080)` → 1fr（:606-612）|
| home | `.lite-home-frame` | 3523-3527 | **860px**，flex column gap 18 |
| home 空态 | `.lite-home-frame-empty` | 3534 → **5072 覆盖** | 640px → **1040px**（4A 骨架双栏）|
| projects | `.lite-projects-frame` | 4356 | **980px** |
| followups | `.lite-followups-frame` | 2132 | **760px** |
| closerlook | `.lite-closerlook-frame` | 1732 | **760px** |
| notes | `.lite-notes-body` | 3202 | `width: min(760px, 100vw-48px)`（父 `.lite-notes` 是居中 flex，:1152 起）|
| vision | `.lite-vision-scroll` | 1737 | `width: min(860px, 100vw-48px)` |
| room | `.lite-room-board` | 737-745 | 固定 `width:1180px; max-width:none`（在 panzoom 画布内）|
| 顶栏 | `--lite2-frame-w` | 5388 | `min(1480px, calc(100vw - 48px))` — **唯一"她的外夹宽"，目前只有 topbar 消费** |

行内文本宽：44ch(215) / 62ch(1189) / 58ch(1755,3555) / 60ch(3234,3242) / 62ch(4379) / 68ch(4531) / 46ch(4763)。

**`--lite2-clear-top` 的消费者**（定义 5387=96px，`@media (max-width:860)` 5393=72px）：
- `lite2.css:5401-5409` 一条 7 选择器规则：`.home-frame` · `.lite-home-frame` · `.lite-projects-frame` · `.lite-followups-frame` · `.lite-closerlook-frame` · `.lite-notes` · `.lite-vision` → `padding-top`
- `lite2.css:5413-5415`：`.lite-room-canvas { top: var(--lite2-clear-top) }`（源块 inset 简写在 714：`68px 20px 92px`，右 20/底 92 保留）
- 第九屏 **playbooks 不消费** —— 它走 `.nexus-empty`（`shared/styles/40-nexus-empty.css:3-8`：`position:absolute; z-index:40; top:42%; left:50%; translate(-50%,-50%)`），靠居中天然避开顶栏。
- 配套：`5419-5426` 六个内滚容器 `scroll-padding-top: 120px`（`.lite-home-scroll`/`-projects-scroll`/`-followups-scroll`/`-closerlook-scroll`/`.lite-notes-body`/`.lite-vision-scroll`）。
- **守门**：`eval-harness/tools/verify-topbar-clearance.mjs` —— 真渲染 `getBoundingClientRect`，顶栏带底 = `.prototype-topbar` 所有可见子簇 bbox bottom 的 max；每屏 scrollTop=0 时取 scene 内文档序第一个可见 h1/h2/h3，断言 `heading.top >= 带底 + 8`。九屏×两皮。**新屏/新布局忘让位立刻红。**

**nav slab 定位**：基座 `shared/styles/00-base.css:65-77`（`position:fixed; z-index:50; top:18px; left:20px; right:20px; justify-content:flex-end; pointer-events:none` — 容器不可点，`.scene-tabs`/`.mode-switch` 各自 `pointer-events:auto`，:81-85）。v02 胶囊覆盖 `lite2.css:5432-5449`，**只在 `@media (min-width:861px)`**：`top:14px; left:50%; right:auto; transform:translateX(-50%); width:var(--lite2-frame-w); justify-content:flex-start; gap:12px; padding:8px 14px; border-radius:var(--lite2-radius-lg,16px)`，`.scene-tabs{margin-right:auto}` 把铃/登录/齿轮推右。aurora 玻璃观感 `look-aurora.css:287-323`（含 `pointer-events:auto` 收回）。`≤860` 转 sticky 竖排（`00-base.css:1121-1131`），**这段本战役至今一字未碰**。

**栅格/flex 惯例**（lite2.css 全部 grid：18 处）：
- `1fr 1fr` 定死双栏 + `@media(max-width:720)` 落 1fr：`.lite-gap-compare`(1777/2019) · `.lite-home-row`(3928/3939) · `.lite-gate-door-grid`(5193/5331) · `.lite-onboard-field-row`(5256/5331)
- `repeat(auto-fit, minmax(300px,1fr))`：`.lite-vision-mock-grid`(1281)
- `repeat(auto-fill, minmax(288px,1fr))`：`.lite-projects-grid`(4565) —— 注释 4561 明说"**不设最小列数**，1 张卡就是 1 张卡"
- `repeat(auto-fit, minmax(104px,1fr))`：`.lite-home-counts`(4020)
- `1.4fr 1fr` + `@media(max-width:880)` 落 1fr：`.lite-home-skeleton-row`(4980/4987) —— **这就是现成的"指挥室双栏"先例**
- 断点集：lite2.css 只有 620 / 720 / 860 / 880 / 1100 五个 max-width + 861 min-width；shared home-frame 用 1080。**新双栏布局应复用 880 或 1080，别再发明。**

## 6 · 已知坑（复述）

1. **CSS 注释里的「星号斜杠」**（receipt-r4:26-30 + `lite2.css:5456-5458`）：注释里写 `tone-*` 后跟 `/` 会**提前终结注释**，残尾垃圾 token 让浏览器错误恢复**吞掉紧随其后的整条规则**。实战表现：`.lite-btn` 基规则在产物里存在却不生效，字号断言莫名不中（背景/圆角却中，因为变体和 aurora 分支完好）。根因用 CSSOM 探针（styleSheets 遍历 vs 文本 fetch 对照）钉死。
2. **媒体查询不加特异性**（receipt-r4:53-56）：`lite2.css` 的 reduce 兜底块 (0,2,0) 压不住 look-aurora ⑯ 的 (0,3,0)+。修法不是提特异性，是**媒体级隔离**——动效应用段整个包进 `@media (prefers-reduced-motion: no-preference)`，reduce 用户根本不进入该段（`look-aurora.css:411,487,603` 三处都这么写）。
3. **双类迁移必须配族强断言层收权**（receipt-r4:44-52）：只加类不删老规则时，"后位同权重接管"只在**静止态**成立；老规则的 `:hover`/`:focus-visible` 在 (0,3,0)/(0,4,0)，**未同名属性各胜出后拼成坏组合**（墨字压墨底 ≈1.2:1、焦点环被老 `outline:none` 灭掉）。修法=双写选择器 `.lite-btn.lite-btn--x` 把全态全属性收权（`lite2.css:5635-5709`）。
4. **reduced-motion 兜底纪律**：`lite2.css:4058` 那个老块**曾经从未闭合**，闷掉往下整片样式（伤疤注释在 4075-4086）。棒4 因此**新开独立块 5615-5633**、自带配平、不动老块。新动效必须同 commit 进兜底名单（或走 no-preference 隔离）。
5. 附带（同一坑档）：**构建压缩去 custom property 前导 0**（`0.97` → `.97`，spec 期望串要写压缩后的形，receipt-r3）；**浅灰小字压壳渐变裸底必先实算紫斑合成底**（`circle at 8% -2%` 恰在左上 greeting 位，#667085 实算 3.24:1 破 AA，receipt-r3）；**电池序=dist 调包者殿后 + 独占跑**（receipt-r4:77-81）。

## 7 · 悬浮部件（快问球）的 z / 定位风险

**全仓 z-index 台账**（升序）：

| z | 归属 | 文件:行 |
|---|---|---|
| 2 | `.edge-layer` | 00-base:186 |
| 3 | `.zone-label-layer` | 00-base:221 |
| 5 | `.lite-room-canvas-controls` | lite2:1011 |
| 9 / 11 | `.people-layer` / `.project-layer` | 00-base:433,437 |
| 15 | `.alert-pill-layer` · `.nexus-inspector` | 00-base:637,1036 |
| 20 | `.project-card.is-focused` | 00-base:487 |
| 22 / 24 | `.mismatch-card` / `.structured-output-card` | 20-report-card:418,3 |
| 25 | `.composer-layer` · `.demo-controls` | 00-base:673,1077 |
| 26 | `.nexus-followup-composer` | 55-ask-composer:5 |
| **30** | **`.lite2-compliance-footer`** | lite2:2439 |
| 30 | `.nexus-terminal` | 60-terminal:8 |
| 40 | `.briefing-hud` · `.nexus-brief-hud` · `.nexus-empty` | 00-base:290,924 / 40-nexus-empty:5 |
| **40** | **aurora 100px 模糊背幕 `.lite2-shell[data-look='aurora']::before`** | look-aurora:335 |
| 41 | `.briefing-card` · `.nexus-brief-card` | 00-base:355,989 |
| **50** | **`.prototype-topbar`** | 00-base:67 |
| **60** | `.lite-settings-pop` | lite2:5109 |
| **90** | `.lite-bell-pop` · `.lite-auth-pop` | lite2:2873, 4121 |
| **120** | `.lite-modal-layer`（`var(--lite2-z-modal,120)`，变量未定义） | lite2:335 |

**快问球该排哪**：`45`（页脚 30 / 背幕 40 之上，顶栏 50 之下——球不该盖住 nav）或 `55`（要在顶栏之上时）。**必须低于 60**（设置弹层）与 90（铃/登录弹层）与 120（modal），否则弹层开着时球会浮在遮罩上。建议同 commit 把 `--lite2-z-modal` 补成真声明，顺手立一套 z 变量。

**会不会撞**：
- **`--lite2-clear-top` 不冲突**（它只管 padding-top，球是绝对/固定定位）。但**底部**要注意：`.lite2-compliance-footer`（lite2:2437-2450，`position:absolute; bottom:0; padding:7px 20px; pointer-events:none`）常驻壳底，右下角球要留出它的高度；room 屏底部还有 composer 带（`.lite-room-canvas` inset 底 92px，lite2:714）。
- 🔴 **最大的坑：`.scene.is-active { transform: translateY(0) scale(1) }`（00-base:167-171）**。非 `none` 的 transform **给 `position:fixed` 后代建立包含块**，且 `.scene { overflow:hidden }`（00-base:159）会**裁掉**它。所以球**绝不能挂在屏组件内部**。正确挂载位=`Lite2App.tsx:158-162` 那一簇（`<DetailOverlay/> <OnboardGate/> <DraftComposer/> <Lite2Footer/>`），即 `.scene-stage` 的**兄弟**、`.lite2-shell` 的直接子元素。
- `.app-shell`（=`.lite2-shell`）是 `position:relative; overflow:hidden; width:100vw; height:100vh`（00-base:54-59），所以挂在这一层可以直接用 `position:absolute` + `right/bottom`，与页脚/顶栏同一坐标系（`.lite2-compliance-footer` 就是这么干的）。
- `≤860` 时 `.app-shell` 变 `min-height:100vh; height:auto; overflow:visible`（00-base:1115-1119）且 `.scene` 变 `position:relative; min-height:1500px`（00-base:1136-1140）——窄屏下 `absolute` 会跟着文档流走到很下面，**窄屏必须切 `position:fixed`**（此时无 transform 祖先，fixed 安全）。
- 新加的按钮：进 `verify-button-family.mjs:39-53` 白名单，或挂 `.lite-btn`（但球是圆钮，会撞基类 `padding: 4px 12px` —— 参考 `lite2.css:5713` 的 `ask-q-remove` 归零先例）。
- 文案：`en.ts` 唯一源；现有 Ask 卡文案键在 `t.ask.*`（`AskCard.tsx:309`）。「快问」不叫 Nexus（handoff 锁词）。