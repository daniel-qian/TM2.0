# 她方主页 `/` 实机侦察（2026-07-22，:3100 真路由，计算值取自 DOM）

> 取证方式：Browser pane `javascript_tool` 读 className + computed style。
> ⚠️ 本环境 viewport 报 0，**像素宽度不可用**；Tailwind class 字面量是可用的（数值都在类名里）。

## 壳（layout.tsx 级）

- `<main class="w-[min(1480px,calc(100vw-48px))] mx-auto pt-24 pb-10">`
  - 满宽外夹 1480 / 左右留白 24 / **顶部让位 pt-24 = 96px**（＝我方 `--lite2-clear-top:96px`，棒2 已对齐）
- `<header class="fixed top-3.5 left-1/2 -translate-x-1/2 z-50 w-[min(1480px,calc(100vw-48px))]
   flex items-center gap-3 px-4 py-2.5 rounded-2xl glass">`
- 全局固定定位元素只有三个：z40 一个空背幕 div、z50 header、**z50 悬浮球**。

### 顶栏内容顺序（header 的 5 个直接子元素）

| # | 元素 | class | 内容 |
|---|---|---|---|
| 1 | `<a>` | `flex items-center gap-2.5 pr-3.5 border-r border-line no-underline shrink-0` | 品牌 SVG（130x40）+「AVERY / 管理指挥室」 |
| 2 | `<nav>` | `flex gap-0.5 flex-1` | tab 组（吃掉剩余空间） |
| 3 | `<div>` | **`hidden xl:block relative`** | **搜索框**（见下） |
| 4 | `<div>` | `relative shrink-0` | 通知铃（角标 3） |
| 5 | `<div>` | `flex items-center gap-2.5 px-3 py-1 pr-1.5 rounded-xl bg-surface-soft border border-line shrink-0` | 用户 chip（王经理 / 市场营销总监 / 首字母块） |

### 🔎 顶栏搜索（本战役首批件之一）

- 容器 `hidden xl:block relative` —— **只在 xl(≥1280px) 出现**，窄屏她直接不给搜索。
- `<input class="flex-1 bg-transparent border-none outline-none text-[12.5px] text-ink"
   placeholder="搜索成员、项目...">`
- 占位文案语义＝**成员 + 项目**两类实体，与 Danny 拍板的检索面一致。

### 🎈 悬浮入口（本战役首批件之一）

- `<div class="fixed bottom-6 left-1/2 -translate-x-1/2 z-50">`，文案「问 Nexus」。
- **底部居中**，不是右下角。z-index 50，与 header 同层。
- 🔴 锁词：她的「问 Nexus」≠ 我们的「快问」——只搬定位/尺寸/交互概念，文案走我方 en.ts。

## 主页正文骨架（自上而下）

1. **标题块** `<div class="mb-5">`
   - `h1.text-[26px].font-extrabold`（＝我方棒3 已对齐的 26px/800）
   - `p.text-muted.text-[14px].mt-1.max-w-2xl`，正文里用 `<b class="text-ink">` / `<b class="text-red">` 做行内强调
2. **KPI 条** `<div class="grid grid-cols-5 gap-3.5 mb-5 max-lg:grid-cols-2">`
   - 卡：`relative overflow-hidden p-4 rounded-[var(--radius-card)] bg-white/97 border border-line shadow-[var(--shadow-sm)]`
   - 卡内三行：
     - 标签 `text-[11.5px] text-muted font-semibold uppercase tracking-wider`
     - 数值 `text-[25px] font-extrabold mt-1.5 tracking-tight tabular`
     - 增量 `text-[12px] mt-1 font-semibold text-red`（或 text-muted）
3. **双栏** `<div class="grid grid-cols-[1.55fr_1fr] gap-4.5 items-start max-lg:grid-cols-1">`
   - 左栏 `flex flex-col gap-3.5`：section-label + 5 张决策卡
     （`card-base overflow-hidden transition-shadow` 内含 `button.w-full.flex.gap-3.items-start.p-4.text-left`）
   - 右栏 `flex flex-col gap-4.5`：两张 `card-base p-4`
   - `items-start` —— 两栏各自顶对齐、不等高拉伸。
   - `max-lg:grid-cols-1` —— <1024px 塌单栏。

### 右栏面板 1：「报告 VS. 现实」（＝我方「现实差距」）

结构：`section-label mb-1.5` 标题 → `p.text-[12px].text-muted.mb-3` 说明 → `flex flex-col` 内 4 个 `<a class="no-underline">` 行。
每行内容形状：**符号（≠ / ⊘ / 📉）+ 标题 + 原话引语「…」+ 现实说明 + 「项目 · XXX」归属**。
（她的说明文案：状态报告与 Avery 实际观察到的不一致之处。）

### 右栏面板 2：「需要关注的成员」

结构：`section-label mb-1.5` → `flex flex-col` 内 4 行
`flex items-center gap-3 py-3 border-b border-line last:border-b-0 cursor-pointer
 hover:bg-surface-soft/50 -mx-1 px-1 rounded-lg transition-colors`
每行：首字母头像 + 姓名 + **状态标签**（资源集中 / 需经理介入 / 预订拥堵 / 新人压力）+ 角色 + **百分比**。

---

## 🔴 两处红线冲突（实机取证，必须进偏差台账）

| # | 她的做法 | 撞哪条红线 | 我方裁决 |
|---|---|---|---|
| A | 关注成员面板每行右侧带 `91% / 88% / 84% / 82%` | **D14 人面零数字零血条** | 我方该面板**去掉百分比**，只留 首字母头像 + 姓名 + 状态标签 + 角色。行结构/间距照抄。 |
| B | KPI 五卡里四张是率值：营收目标完成率 58%、预订单转化率 66%、客户投诉率 4.2%、**团队负载(均) 72%** | **D8 无真功能/无数据基础不建** + 团队负载再撞 **D14** | 四张率值卡**明确不做**（编造型指标）。她第五张「未解决差距 4」是真计数——我方 KPI 卡位只放计数族。 |

## 📐 D15 与「双栏满宽」的调停（本战役必答题，此处先给答案）

D15 原文：内容栏宽守 760–1040，她的 1480 只作外夹。
主页改双栏满宽后：外夹 1480、gap 18 → 左栏 ≈ (1480−18)×(1.55/2.55) ≈ **889px**，右栏 ≈ **573px**。
→ **左栏 889px 正落在 760–1040 带内，D15 不破**。1480 依然只是外夹，双栏是外夹内的再切分。
（其余八屏若无双栏结构，仍守单栏 760–1040。）
