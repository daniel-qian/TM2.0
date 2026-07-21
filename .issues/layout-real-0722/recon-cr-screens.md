> 侦察原件 · 视角 `cr-screens` · 2026-07-22 自动生成，未经人工编辑。

## 全局壳（layout.tsx + topbar + fab）

**主容器** `D:/cr-live/src/app/layout.tsx:36` — `<main className="w-[min(1480px,calc(100vw-48px))] mx-auto pt-24 pb-10">`。全站唯一宽度约束：max 1480px，视口两侧各留 24px，顶部 96px（避开 fixed 顶栏），底部 40px。footer 同宽 `layout.tsx:39`（`pb-20`）。**九屏共用同一个容器，没有任何一屏自带侧栏/二级壳。**

**顶栏背板** `layout.tsx:18-34` — 独立的 `position:fixed; top/left/right:0; height:100; zIndex:40`，`backdropFilter: blur(24px) saturate(1.2)`，`maskImage: linear-gradient(to bottom, black 60%, transparent 100%)`，`pointerEvents:none`。作用：滚动内容在玻璃顶栏后面渐隐，不是顶栏本体。

**Topbar** `D:/cr-live/src/components/shell/topbar.tsx:166` — `fixed top-3.5 left-1/2 -translate-x-1/2 z-50 w-[min(1480px,calc(100vw-48px))] flex items-center gap-3 px-4 py-2.5 rounded-2xl glass`。即：悬浮胶囊条，距顶 14px，与内容同宽同轴，内边距 16/10，圆角 16px，`glass` = `rgba(255,255,255,.82)` + `backdrop-filter: blur(20px) saturate(1.1)` + shadow-sm（`globals.css:66-71`）。
横向顺序（左→右）：
1. 品牌 `topbar.tsx:168-192` — SVG 130×40（viewBox 260×80），`pr-3.5 border-r border-line shrink-0`。
2. 导航 `topbar.tsx:195-217` — `flex gap-0.5 flex-1`，7 项（指挥室/项目/团队/差距/Nexus/待办/方法库，`topbar.tsx:11-19`）。每项 `px-3 py-2 rounded-[9px] text-[13.5px] font-semibold`，图标 15px，**文字 `hidden lg:inline`**（<1024px 只剩图标）。激活态 = `bg-white shadow-sm text-navy`。角标 `min-w-[17px] h-[17px] rounded-full text-[10.5px]`，红/金两色，数字来自实数据过滤（`gaps.filter(active).length`、`checklist.filter(!checked && today).length`）。
3. 搜索 `topbar.tsx:220-254` — 容器 `hidden xl:block`（<1280px 整块消失）；输入框壳 `flex items-center gap-2 px-3 py-1.5 rounded-[9px] bg-surface-soft border border-line w-[220px]`，放大镜 14px，input `text-[12.5px]` 透明底无边框，**占位文案 `搜索成员、项目...`**（`topbar.tsx:228`）。下拉 `absolute top-full right-0 mt-2 w-[320px] rounded-xl bg-white border shadow-md z-[60]`，行 `px-4 py-2.5`，emoji 类型标（👤/📁/📄 `topbar.tsx:58`），主 13px + 副 11px，**上限 8 条**（`topbar.tsx:55`），Enter 直跳第一条，Esc 收起，外点关闭（`topbar.tsx:137-148`）。搜索源 = people+projects+7 个页面关键词表（`topbar.tsx:23-56`）。
4. 通知铃 `topbar.tsx:257-340` — 按钮 `w-9 h-9 rounded-[9px]`，未读红点 `absolute -top-1 -right-1 w-[18px] h-[18px]`。面板 `w-[380px] rounded-xl z-[60]`，头 `px-4 py-3 border-b`，列表 `max-h-[400px] overflow-y-auto`，行 `px-4 py-3` + 32px 圆角方图标 + 标题 13px/正文 12px `line-clamp-2`/时间 11px，未读行底色 `bg-purple/[0.04]`。5 条通知全是硬编码 mock（`topbar.tsx:71-122`）。
5. 用户块 `topbar.tsx:343-349` — `px-3 py-1 pr-1.5 rounded-xl bg-surface-soft border`，两行文字（12.5px 粗 + 11px 灰）+ Avatar 34px 在**右**。

**「问 Nexus」悬浮入口** `D:/cr-live/src/components/shell/nexus-fab.tsx`：
- 定位 `fixed bottom-6 left-1/2 -translate-x-1/2 z-50`（`nexus-fab.tsx:26`）——底部居中 24px，**不是右下角悬浮球**，是居中胶囊。
- 收起态 `nexus-fab.tsx:63-75`：`px-5 py-3 rounded-2xl`，渐变 `from-purple(#6b5bd6) to-#5544b8`，白字 14px semibold，Sparkles 17px，阴影 `0 8px 30px rgba(107,91,214,.4)` → hover `0 8px 40px rgba(107,91,214,.55)`；`whileHover scale 1.04` / `whileTap 0.96`。
- 展开态 `nexus-fab.tsx:29-61`：同一位置原地变形为表单，`width 56 → 420`（spring `damping 28, stiffness 350`），`px-4 py-3 rounded-2xl glass shadow-md`；input 14px 占位 `向 Nexus 提问...`；提交键 `w-8 h-8 rounded-lg bg-purple`（仅在有输入时出现）；关闭键 `w-8 h-8 rounded-lg bg-surface-soft`。
- 行为：提交 → `router.push('/nexus?q=' + encoded)`（`nexus-fab.tsx:19`）；在 `/nexus` 路由上整个组件 `return null`（`nexus-fab.tsx:14`）。
- **冲突事实**：Toast 也钉在 `fixed bottom-6 left-1/2 z-[200]`（`ui/toast.tsx:29`），与 FAB 同坐标，靠 z 盖住。

**层级表**：背板 40 < 顶栏/FAB 50 < 顶栏下拉 60 < Modal 100 < Toast 200。Modal 壳 `ui/modal.tsx:30,36,38`：`fixed inset-0 z-[100] p-6`，遮罩 `bg-navy/40 backdrop-blur-sm`，面板 `max-w-[560px] max-h-[86vh] overflow-auto rounded-2xl`，关闭键 `w-8 h-8 top-4 right-4`。

**设计令牌** `D:/cr-live/src/app/globals.css:3-38`：`--radius-card:12px`、`--radius-lg:16px`、`--shadow-sm: 0 1px 2px rgba(16,34,61,.08), 0 12px 30px rgba(36,32,95,.10)`、`--shadow-md: 0 20px 64px rgba(36,32,95,.16)`。工具类 `card-base`（白 .97 + 1px line + 12px 圆角 + shadow-sm，:73）、`card-hover`（hover: shadow-md + `translateY(-2px)`，:80）、`section-label`（13px / weight 750 / uppercase / gap 9px，:88）。body 背景是 3 层 radial + 1 层 linear 的固定渐变（:55-60）。

---

## 1) `/` 指挥室 — `D:/cr-live/src/app/page.tsx`（31 行，全部靠子组件）

**骨架（纵向 3 段）**：标题块 → KPI 条（满宽 5 列）→ 双栏。
- 标题块 `page.tsx:11-18`：h1 26px extrabold，副文案 14px `max-w-2xl`，`mb-5`（20px）。
- 双栏 `page.tsx:22`：`grid grid-cols-[1.55fr_1fr] gap-4.5 items-start max-lg:grid-cols-1` → **左 60.8% / 右 39.2%，栏间距 18px，顶对齐，<1024px 折成单列**。右栏内部 `flex flex-col gap-4.5`（`page.tsx:24`），两块竖排。
- 左栏 = DecisionQueue（决策队列）；右栏 = GapRail（报告 vs 现实）+ PeopleRail（需要关注的成员）。

**KPIStrip** `D:/cr-live/src/components/command/kpi-strip.tsx:8` — `grid grid-cols-5 gap-3.5 mb-5 max-lg:grid-cols-2`。卡 `p-4 rounded-[12px] relative overflow-hidden`；标签 11.5px uppercase tracking-wider；数值 25px extrabold `tabular` mt-1.5；meta 12px（up 绿/down 红/flat 灰）；**卡底 `absolute left-0 bottom-0 h-1` 的进度条，宽度 = `bar%`**（:22-25）。数据 5 条（`lib/data.ts:638-644`），全部是硬编码指标串。逐卡入场 `delay: i*0.06`。

**DecisionQueue** `components/command/decision-queue.tsx` — 外层 `flex flex-col gap-3.5`（:23），首行 section-label + 计数 Badge（:24-27）。卡片 `card-base` + **左边框 4px 着色**（`borderLeftWidth:4, borderLeftColor: toneColors[d.lvTone]`，:37）。折叠头是整块 button `w-full flex gap-3 items-start p-4`（:44）：等级 Badge(dot) · 项目名（12px 灰）→ 标题 15.5px bold mt-2 → 影响 13px mt-2 → AvatarStack + `N 条证据 · 1 个方法`（12px）mt-3；右侧 ChevronRight 16px 展开时 `rotate 90`。展开体 spring（damping 30 / stiffness 300）：`px-4 pb-4 border-t border-dashed`；证据行 `p-2.5 px-3 rounded-[10px] bg-surface-soft mb-2 text-[13px]`，左侧来源标签 10.5px uppercase；推荐方案块 `p-3.5 rounded-[11px] bg-gradient-to-r from-purple-soft/60 to-white/60 border border-purple/25`，方法名做成白底 pill；动作按钮 `flex gap-2 flex-wrap`，第 0 个 primary 带 `✓ ` 前缀，末尾固定一颗 `深入问 Nexus`（soft）跳 `/nexus?q=标题`。**数据 5 条**（`data.ts:593-599`），每条含 2-3 条证据、1 个方法名、1-3 个动作。

**GapRail** `components/command/gap-rail.tsx:12` — `card-base p-4`，section-label + 12px 说明（mb-3），列表 `flex flex-col`，行 `flex gap-3 py-3 border-b border-line last:border-b-0`，hover `bg-surface-soft/50 -mx-1 px-1 rounded-lg`；左侧 32px 方图标（`rounded-[9px]` + tone 渐变 + emoji/符号）；右侧四行：名称 13.5 bold / claim 12px italic truncate / evidence 12.5px `line-clamp-2` / tag 10px uppercase。整行 `<Link href="/gaps">`。**活跃 4 条**（`data.ts:603-608`）。

**PeopleRail** `components/command/people-rail.tsx:10-14` — 取 `load >= 90 || sentiment === 'strained'`，按 load 降序，**slice(0,5)**。行 `flex items-center gap-3 py-3 border-b`：Avatar 36 → 姓名 13.5 + 状态 Badge(10px) → 职位 11.5 → **右侧 `w-[74px]` 固定块：`{load}%` 11.5px extrabold + `h-1.5 rounded-full` 负载血条**（:39-46），颜色由 `loadTone(load)` 决定。点击开 person-modal。
🔴 与我方红线正面冲突：**人面数字 + 血条**在这块和 `/people` 卡片里是核心信息载体，我方 team/home 不能照搬这个结构。

**一屏信息量**：4 个区块 / 首屏可见约 5 个 KPI + 2-3 张决策卡 + 4 条差距行 + 5 条人员行 ≈ 16-17 条独立信息。

---

## 2) `/people` 团队 — `D:/cr-live/src/app/people/page.tsx`

**骨架（单栏，纵向 5 段）**：页头（标题左 + 主按钮右，`flex items-end justify-between gap-4 mb-5 flex-wrap`，:66）→ 过滤条 → 展开式新增表单 → 人员网格 → 已停用区。
- 过滤条 `people/page.tsx:79-97`：两组 pill，`text-[12px] px-2.5 py-1 rounded-full border`，选中 `bg-navy text-white`。组别 7 个 + 情绪 4 个 = **一行 11 颗 pill**。
- 新增表单 `:104` `grid grid-cols-4 gap-3`，input `px-3 py-2 rounded-lg border text-[13.5px]`，label 11px uppercase。高度动画 `height: 0 → auto`。
- 人员网格 `:124` — `grid grid-cols-3 gap-4 max-lg:grid-cols-1`（**没有中间 2 列断点**）。卡 `card-base p-4 card-hover`：Avatar 44 `rounded-xl` + 姓名 15 extrabold + `职位 · 组别` 12.5 + 右上状态 Badge（:138-145）；focus 文案 12.5px **`min-h-[34px]`**（强制两行等高，:146）；底部 `flex gap-3.5 pt-3 border-t` 的**三格指标：负载 %（17px，按 loadTone 着色）/ 情绪（13.5px 文字）/ 健康度（17px 数字，`Math.max(40, 100 - |load-70|)` 现算，:127）**；右下角 `停用` 文字按钮 11px。
- 已停用区 `:166-183` `mt-8` + section-label + 同样 3 列网格，卡 `opacity-40 grayscale`，行内 Avatar 36 + `重新启用`。
- **数据 20 人全 active**（`data.ts:73-499`，`active:true` × 20）→ 3 列 × 7 行，一屏约 6-9 张卡，密度高。
🔴 每张人卡 3 个数字 + 一个现算「健康度」分——我方 team 屏禁止照搬这层。

---

## 3) `/projects` 项目 — `D:/cr-live/src/app/projects/page.tsx`

**骨架（单栏，4 段）**：页头（同 people，`mb-6`，:120）→ 新增表单 → 项目网格 → 已归档折叠区。
- 新增表单 `:144` `grid grid-cols-3 gap-3 max-md:grid-cols-1` + 下方满宽「影响」input，卡 `p-5 mb-5`。
- 网格 `:171` — `grid grid-cols-3 gap-4 max-xl:grid-cols-2 max-md:grid-cols-1`（**三段断点，比 people 完整**）。
- 卡片是 `<motion.button className="card-base p-0 ... card-hover overflow-hidden flex flex-col">`（:180），结构自上而下：
  1. **顶部 6px 渐变条** `h-[6px] w-full`，`linear-gradient(90deg, tone, tone88)`（:187-190）。
  2. 内容区 `p-4 pb-3 flex-1 flex flex-col`。
  3. 标题 15px extrabold `leading-snug` + 状态 Badge(dot)，`flex items-start gap-2 mb-2`。
  4. impact 12.5px `line-clamp-2 flex-1`（撑高对齐）。
  5. 进度：标签行 10px uppercase / 右侧 `{progress}%` 12px tone 色 → 轨道 `w-full h-[6px] rounded-full bg-surface-soft`，填充 `width 0 → progress%`，`duration .8, delay i*0.05+0.2`（:207-223）。
  6. 里程碑 `flex gap-1.5 mb-3`：每个 = 8px 圆点（done 绿/active 蓝/blocked 红/upcoming line，:35-40）+ 10px 灰字。
  7. 偏差告警条（有 drift 才出）`px-2.5 py-1.5 rounded-lg bg-red-soft text-[11px]`。
  8. 页脚 `pt-3 border-t justify-between`：左 Avatar 22 + 负责人 12px；右 日历 11px + AvatarStack（`members.slice(0,4)`，仅 members>1 时出）。
- 归档区 `:279-309`：文字开关（Eye/EyeOff）+ 同规格网格，卡 `opacity-40 grayscale`。
- **数据 6 个项目**（`data.ts:500-592`），按 `statusOrder`（at-risk 0 → completed 5）排序 `:50-52`。3 列 × 2 行，一屏全见。
- 点击 → `ProjectDetailModal`（560px 模态）：头部 `px-6 pt-6 pb-4` + **ProgressRing size 56 stroke 5**（`project-detail-modal.tsx:206`），底色 `linear-gradient(135deg, tone08, tone15)`，下边框 `2px solid tone25`；成员卡行 `p-3.5` + 右侧 `w-[50px] h-[5px]` 迷你进度条（:106）；页脚 `px-6 py-4 border-t flex gap-2 flex-wrap`（:350）。

---

## 4) `/checklist` 待办 — `D:/cr-live/src/app/checklist/page.tsx`

**骨架（单栏，5 段）**：页头（标题 + 内联「N 项今日到期」金色强调，:101-114）→ 分段开关 → 新增表单 → 分组列表 → 空态/历史。
- 分段开关 `:116` — `flex items-center gap-2 mb-5 p-1 rounded-xl bg-white/70 border w-fit shadow-sm`，两个 tab `px-3.5 py-2 rounded-lg text-[13px] font-bold`，选中 `bg-white shadow-sm`，各带一个计数 Badge（金/绿）。**这是九屏里唯一的分段控件形态，可复用给 followups。**
- 新增表单 `:155` — `grid grid-cols-[1fr_150px_120px_140px] gap-3 items-end`（标题弹性 + 三个定宽列）。
- 分组 `:186-254` — 三组硬编码（今天/本周/即将到来，:14-18），每组 `mb-6`：section-label + 计数 Badge → **一张 `card-base divide-y divide-line` 把整组行装成一条列表**（不是每行一卡）。
- 行 `:205` `flex items-start gap-3 px-4 py-3`：左 20px 复选框 `rounded-md border-2 border-line-strong`（hover 变绿）→ 标题 13.5 semibold → 元信息行 11.5px `gap-3`：来源图标+来源标签 · 负责人 · 到期 → 右侧两个 28px 图标按钮（编辑/删除）。行进出动画 `x: -12 → 0`，退出 `x:12, height:0`，`layout`。
- 编辑态原地变输入：标题 `flex-1 min-w-[200px]`、负责人 `w-[120px]`、到期 `w-[100px]`（:218-220）。
- 历史视图 `:266-332`：同样 `card-base divide-y`，行底色 `bg-surface-soft/30`，勾 20px 绿方块，标题 `line-through` 灰，右侧 恢复(RotateCcw)/删除 两个 28px 按钮；顶部有「清空历史」文字按钮。
- 空态 `:257` — `card-base p-8 text-center`，32px 灰图标 + 15px 粗标题 + 13px 说明。
- **数据 10 条**（`data.ts:612-623`），今天 4 / 本周 4 / 即将 2；来源四类 nexus/decision/manual/gap 各带图标+色（:11-12）。信息密度：一屏约 8-10 行。

---

## 5) `/gaps` 多看一眼 — `D:/cr-live/src/app/gaps/page.tsx`

**骨架（单栏，3 段）**：页头（h1 内联 `Badge tone=red dot` 显示活跃数，:40-47）→ `space-y-4` 的差距卡流 → 历史折叠区。
- 卡 `:52` `card-base p-5`，内部 `flex gap-4 items-start`：左 40px 方图标 `rounded-[9px]` + tone 渐变 + 符号（≠ / ⊘ / 📉）；右主体：标题 16px bold + 类型 Badge。
- **核心部件 = 左右对照双格** `:68` — `grid grid-cols-2 gap-3 mt-3 max-md:grid-cols-1`：左格 `p-3 rounded-[10px] bg-surface-soft`，标签「自报情况」10.5px uppercase 灰，正文 13px **italic**；右格 `p-3 rounded-[10px] bg-red-soft`，标签「Avery 观察到的」10.5px 红(#a5322f)，正文 13px 正体。这是她方最强的可迁移布局概念（claim vs evidence 并置）。
- 动作行 `:79` `flex gap-2 mt-4 items-center flex-wrap` + `<div className="flex-1" />` 弹性撑开，把 解决/忽略/加入待办 三键推到右端，左端留 12px 灰 tag。
- 历史 `:95-113`：文字开关 + `space-y-3`，卡 `p-4 opacity-40 grayscale`，单行：emoji + 名称 + 状态 Badge。
- **数据 4 条活跃**（`data.ts:603-608`），四种 kind（report_mismatch/silent_member/collaboration_orphan/project_drift，:12-17）。一屏 2-3 张卡，是九屏里最低密度的一屏。

---

## 6) `/playbooks` 操作手册 — `D:/cr-live/src/app/playbooks/page.tsx`（47 行，纯静态）

**骨架（单栏，2 段）**：页头（h1 + 14px `max-w-2xl` 说明，mb-5）→ 网格。
- 网格 `:19` `grid grid-cols-2 gap-4 max-lg:grid-cols-1`（**唯一的 2 列屏**）。
- 卡 `:23` `card-base p-5 card-hover`：头行 `flex items-center gap-3 mb-2` = 32px 方图标（`rounded-[9px]` + tone 渐变 + Sparkles 15px）+ 标题 16px bold → 副标题 12.5px 灰 `mb-3.5` → chips `flex gap-2 flex-wrap`，每颗 `text-[11.5px] font-semibold px-2.5 py-1 rounded-full bg-surface-soft border border-line`。
- **数据 6 条 × 4 chips**（`data.ts:627-634`）。零交互、零状态、无模态。整屏 = 6 卡 + 24 颗 chip。

---

## 横向对照速查

| 屏 | 栏结构 | 卡片网格 | 卡内边距 | 区块数 | 数据条数 |
|---|---|---|---|---|---|
| `/` | `grid-cols-[1.55fr_1fr] gap-4.5` | KPI `grid-cols-5 gap-3.5` | 卡 p-4，行 py-3 | 4 | 5 KPI + 5 决策 + 4 差距 + 5 人 |
| `/people` | 单栏 | `grid-cols-3 gap-4 → max-lg:1` | p-4 | 5 | 20 人 |
| `/projects` | 单栏 | `grid-cols-3 gap-4 → xl:2 → md:1` | p-0 外壳 / p-4 pb-3 内层 | 4 | 6 项目 |
| `/checklist` | 单栏 | 无网格（divide-y 列表） | 行 px-4 py-3 | 5 | 10 项 / 3 组 |
| `/gaps` | 单栏 | `space-y-4` 卡流，卡内 `grid-cols-2` | p-5 | 3 | 4 条 |
| `/playbooks` | 单栏 | `grid-cols-2 gap-4 → max-lg:1` | p-5 | 2 | 6 条 |

**共性规律（可直接抄的骨架规则，不涉源码）**：
1. 每屏第一段固定是「26px extrabold h1（可内联图标 24px / 计数 Badge） + 14px `max-w-2xl` 灰副文案 + `mb-5`(20px)」；有主动作的屏用 `flex items-end justify-between flex-wrap` 把主按钮甩到右端。
2. 卡片圆角只有两档：内容卡 12px（`--radius-card`），壳/模态/顶栏 16px（`rounded-2xl`）。
3. 卡片间距只有 14px(`gap-3.5`) / 16px(`gap-4`) / 18px(`gap-4.5`) 三档；区块间距 20px(`mb-5`) / 24px(`mb-6`) / 32px(`mt-8`)。
4. 字号阶梯固定：26 → 16/15.5/15 → 13.5/13 → 12.5/12 → 11.5/11/10.5/10（最小档一律 uppercase + tracking-wider 做标签）。
5. 「列表型」内容一律 `card-base divide-y` 或 `border-b last:border-b-0` 的行，行高 `py-3`，绝不做成一行一卡。
6. 折叠/归档区统一样式：文字开关（Eye/History 14px 图标 + 13px semibold 灰）+ `opacity-40 grayscale` 的降级卡。
7. 全站只有 3 个 fixed 元素（顶栏背板 z40、顶栏 z50、FAB z50）+ 2 个 portal 层（modal z100、toast z200）；**没有任何 sticky 侧栏、没有右下角悬浮球、没有二级导航**。