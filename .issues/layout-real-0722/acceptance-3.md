# 验收手册 · 批次③（棒G–H：动效收尾 + 密度复核 + 收官）

> AFK 一口气跑完的一批。Danny 指令：**全部批次干完再上线**，第③批自跑自验自修，最后交这份表单做 HITL 端到端。
> push 仍是对外人工闸——**没推**，等你点头。

---

## 机器判据（收官 · 全绿，连跑两轮）

| 判据 | 结果 |
|---|---|
| A 区 17 门 × **两轮** | 全 PASS，0 红（topbar 22 / **cr对齐 35/35** / 皮相位 16 / 按钮族 12 / 小字对比 26 / 首页骨架 17 / 状态缺失 27 / 议事室无材料 11 / 议事室可用 20 / handoffs 10 / 开关 23 / aria-zh 4 / onboarding 39 / p0 41 / zh纯度 / 裸链壳 4 / 404 4）|
| B 区（data-boundary 37 · null-owner 15）× 两轮 | 全 PASS |
| C 区调包者（**殿后独占**）：auth-capability 25 · auth-form 57 · bundle-privacy 7 | 全 PASS |
| 净室扫雷（9屏×3视口）× 两轮 | **0 件 / 0 指纹 · NEW 0 · REGRESSION 0** |
| 扫雷自检（注入故障能被逮到） | 8 PASS · 0 FAIL |
| 规格门 **all-stick**（无 SPEC_STICK = 全表硬断言） | **硬断言 35/35 绿 · 未来行剩 0** —— 战役 definition-of-done |
| 像素基线 · 桌面 | **9屏×2皮 全绿**（含改动过的 home-desktop）|
| 像素基线 · 手机 | ⚠️ 卡在 home-mobile 先天漂移（**非本批次引起**，见 §5）|

> 收官后已重建 dev dist（bundle-privacy 会把 dist 换成生产域名，跑完必还原）；5173 现指 dev。

---

## 0. 本批做了什么

**四件动效 + 一处工具修复。零新增文案、零人面数字、零假部件。**

### 动效（全部包 `@media (prefers-reduced-motion: no-preference)`，reduce 下实测归零）
1. **「问 Avery」悬浮入口展开**（你 07-22 亲口点名）— 胶囊→输入框从底部长出（`lite-ask-avery-expand`）。*（本批次早段 commit e3e053a 已落，此处并入验收）*
2. **顶栏搜索浮层入场** — 结果浮层从搜索框下缘淡入下滑（`lite-search-pop-in`），不再硬弹。
3. **差距三态 chip 切换列表** — 点「活跃/已厘清/已搁置」换筛选时列表淡入重放（`<ul key={gapFilter}>` 重挂 + `lite-home-gap-list-in`），不再硬换。chip 本身早已有 120ms 色相过渡。
4. **搜索框聚焦边框** — 悬停/聚焦边框由硬切改 `border-color` 渐变（对齐她输入框质感）。

### 列表化（本批次早段已落，并入验收）
5. **「Avery 的笔记」列表化** — 一天一组=整张 card，笔记条目=`divide-y` 行流（不再一条一卡）；仅 aurora，paper 守自己分卡。*（commit e3e053a）*

### 工具修复（服务于这份验收本身）
6. **对照板种子修复** — 实测发现 `capture-align-board.mjs` 用的 `?transport=stub` **已不灌数据**（contextId 恒 null、六屏全空态），板子照出来是「空 averylite vs 满 cr」的假对照，**没法比骨架**。改走真 `uploadFiles` 抽取路径（同 verify-cr-alignment 配方，喂 2人/1项目/1卡点+1决策）。现在板子是**有数据的形状对形状**。

---

## 1. 端到端人测流程（HITL）

> 本地 dev 跑法（若要亲眼看动效——动效是运动，静态截图看不见）：
> 后端 `AVERY_BRAIN=mock ...`（8137，已在跑）· 前端 dev dist（5173，已在跑）·
> 入口 **必带参**：`http://localhost:5173/?v=2&mode=live&lang=zh`（裸链落旧 story 壳）。
> 喂数据：进去后 Esc 关引导 → 拖一份花名册 + 一份周报（或用 demo 门），主页就长出来。

### 逐屏看点
1. **主页**：右下角**「问 Avery」**胶囊 → 点开，输入框应**平滑长出**（非啪一下蹦）。
2. **主页 · 文件自己对不上的地方**：点「活跃 / 已厘清 / 已搁置」三个 chip 切换 → 下面列表应**淡入重放**（非硬换）。chip 选中态深底白字平滑过渡。
3. **顶栏搜索**：输入「陈」→ 结果浮层应**从搜索框下缘淡入滑下**；鼠标悬停搜索框边框**渐变**不硬切。
4. **Avery 的笔记**：多条笔记应是**一天一张卡、条目之间细线分隔**的清单（非一条一个气泡卡）。
5. **关掉动效再走一遍**（系统「减弱动态效果」开）：以上 1–4 的**运动应全部消失**，元素直接到位——不是卡顿，是设计上的尊重。

### 对照板（静态骨架比对，给你的眼睛）
`eval-harness/reports/align-board/2026-07-22/index.html` —— 左我方(真数据) / 右合伙人，逐屏双栏。
本批次已用真种子重拍，主页 5 卡 KPI 行 / 决策卡 / 三态差距 / 关注人 都照出来了。

---

## 2. 与她刻意不同处（红线 · 需你拍板的两处产品决策）

对照板复核（真数据）后，全 9 屏**零骨架缺口、零破图**（无横向溢出/无裁切/无重叠）。只有两处「不一样」，都**不是没做，是不能照抄**——请你定夺：

### 🅰 操作手册（playbooks）：她是 6 卡双列方法库，我方是诚实空态
- 她的 /playbooks 是**建好的 2 列方法库网格**（6 张分类卡 × chips）。我方是「即将推出 / 暂未接入」的叙事空态卡 + 3 条预告槽。
- **为什么不照抄**：我方**没有真 playbook 数据**——`PLAYBOOK_CATALOG` 是「接入你的 SOP 后会长出什么」的预告，coming-soon 诚实标。把空态改成她那种网格 = 要么**编造**方法库内容，要么摆一排**空卡剧场**，两者都踩 `absent≠none` / 不造假部件红线。且这是你自己 07-09 拍板 Q1(a) 的空态屏。
- **决策**：保持诚实空态。**若你想要那面网格墙，得先有真 playbook 数据源**（feat-019 酒店包之类）——那是产品/数据决策，不是前端能自己补的。

### 🅱 你的团队（team）：我方 upload-first，她是通讯录目录
- 她的 /people 是**全宽成员目录**（筛选 chip + 3 列成员卡）。我方是 **upload-first 双栏**（大「把团队带来」拖区 + 文件列表为主，成员降为子网格）。
- **为什么留着**：这不是漏做——「一切从你上传的文件长出来」这套 upload-first 语法在 projects/team/closerlook **一以贯之**，是产品哲学。成员本身**能正确以卡片网格渲染**（2 人不空不破）。把 team 整个改成她的通讯录原型是**架构级改动**，既不在批次③ 范围（team 属批次②），也可能推翻那套一致的产品语法。
- **决策**：**留给你拍板**。要对齐她的目录原型，是单开一仗的事，我不 AFK 擅自改。

> 其余守住的红线：人面零数字零血条 · claim/evidence 引真实原文可溯源 · 顶栏悬浮件不撞位 · 「问 Avery」不叫「快问」不叫 Nexus · 动效全走 reduced-motion 隔离。

---

## 3. ⚠️ 需要你过目

### 🈶 中文文案（**本批次零新增**）
本批次只加动效/工具，**没碰 en.ts/zh.ts，无新文案**。唯一待审字仍是**批次② 手写的那 8 条**（见 `acceptance-2.md §3`，未走 M3）：
`searchPlaceholder / searchAria / searchEmpty / askAveryLabel(问 Avery) / askAveryAria / askAveryPlaceholder / homeGapFilterActive(活跃) / homeGapsFilterEmpty`。

### 🅰🅱 两处产品决策（§2）
playbooks 是否要真数据源长出方法库墙 · team 是否对齐她的通讯录原型。

### 像素基线重冻（§5）
home-mobile 先天漂移的基线要不要重冻——**人审对照板通过后**才 `--update-snapshots`，我没擅自动。

---

## 4. 对抗审查（四视角 · 自查全清）

| 视角 | 结论 |
|---|---|
| 红线 | 00-base.css / src/story 未动（git 净）· 无 en.ts/颜色/人面数字改动 · reduced-motion 媒体级隔离（探针实测 reduce 下 animationName=none）|
| 级联 | 两个新 `@keyframes` 名各只出现 1 次无碰撞 · `.lite-home-gap-list` 动画只我一处 · 搜索框 transition 恰好平滑既有 hover/focus 边框变化，无竞争规则 |
| AA | 无颜色改动，小字对比 26/0 未受影响 |
| 波及面 | `key={gapFilter}` 重挂安全（列表内是无状态按钮）· `animation …both` 静止态=改动前样子无布局位移 · 对照板工具不进 app bundle，波及面仅限那张板子 |

---

## 5. 已知留后项

- **像素 · home-mobile 先天漂移**：基线 PNG 冻结于 **2026-07-21（本 session 之前，git 未改）**；home-**desktop** 带我的改动**照过**；我的改动是纯动效（像素测试禁用动画）+ 空态主页无差距列表，**改不到空态 home 布局**。故这是交接文档早记的 batch① 之前旧图漂移，**非本批次回归**。手机端独立佐证：扫雷 9屏×mobile(375) **0 件**。重冻属人审闸，未动。
- **`transport=stub` 本体失灵**：对照板已绕开（改走 uploadFiles）。stub 这条 test-transport 为什么不再灌数据是**独立的既存问题**，没顺手修（超出本战役，且 stub 只测试用）。留记。
- **projects 卡内 impact 等高**：纯 CSS 小优化，但当前种子只 1 项目**不可观测**，未做（避免过度构建）。多项目场景要对齐再补。
- **followups 段控 / 每组计数徽标**：低值 polish，未做（`acceptance-2.md §5` 已记）。

---

## 收官状态

批次①②③ 全部**本地 commit、未推**。分支 `claude/layout-real-components-27b594` 领先 origin。
**下一步 = 你的 HITL**：按 §1 走一遍 → §2 两处产品决策拍板 → 点头我才 push（push=Vercel 自动上产=对外闸）。
