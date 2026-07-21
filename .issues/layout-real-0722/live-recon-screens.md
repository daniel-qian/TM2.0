# 她方另五屏实机侦察（2026-07-22，:3100 真路由）

> 同 `live-recon-home.md`：取 className 字面量（Tailwind 数值都在类名里），viewport 报 0 故像素宽不采。
> 全五屏共享外夹 `<main class="w-[min(1480px,calc(100vw-48px))] mx-auto pt-24 pb-10">`。

---

## `/people` ↔ 我方 team（你的团队）

| 层 | class / 结构 |
|---|---|
| 标题行 | `flex items-end justify-between gap-4 mb-5 flex-wrap`（左 h1 26/800 + 右 primary 按钮 `px-3.5 py-2 rounded-[9px] text-[13px] font-semibold bg-navy text-white`） |
| **筛选条** | `flex gap-4 mb-5 items-center flex-wrap`，两组 `flex items-center gap-2`：**组别**（全部/别墅销售组/渠道合作组/客户运营组/市场投放组/策略分析组/活动策划组）+ **情绪**（全部/积极/平稳/紧绷） |
| 网格 | **`grid grid-cols-3 gap-4 max-lg:grid-cols-1`**，20 张卡 |

人卡 `card-base p-4 card-hover cursor-pointer`：
1. 头部 `flex gap-3 items-center mb-3`：首字母渐变方块（`inline-grid place-items-center rounded-[10px] font-extrabold text-white shrink-0 rounded-xl`）+ 姓名/角色块 + 状态徽章
2. **指标条** `flex gap-3.5 pt-3 border-t border-line`，三等分 `flex-1`：
   - 负载 `text-[10.5px] font-bold uppercase tracking-wider text-muted` + `text-[17px] font-extrabold tabular` **88%**（内联色 #d88a2d）
   - 情绪 + `text-[13.5px] font-semibold text-red` 紧绷
   - 健康度 + `text-[17px] font-extrabold tabular` **82**
3. 底部 `mt-3 flex justify-end`：`text-[11px] font-semibold text-muted hover:text-red` 幽灵按钮「停用」

### 🔴 裁决
- **指标条整条不搬**（负载 88% / 健康度 82 直撞 D14 人面零数字零血条）。
- 卡壳、头部行、`border-t` 分隔的底部区块**结构可搬**；底部区块换成有真数据基础的内容（待清点）。
- **组别筛选可做成真的**（`src/lite2/teamGroups.ts` 有真分组）；**情绪筛选不做**（无数据 = 编）。
- 三列网格 `grid-cols-3 gap-4` 是可直接对齐的布局密度。

---

## `/projects` ↔ 我方 projects（项目）

| 层 | class |
|---|---|
| 标题行 | `flex items-end justify-between gap-4 mb-6 flex-wrap`（h1 + 副题 + 右「添加项目」） |
| 网格 | **`grid grid-cols-3 gap-4 max-xl:grid-cols-2 max-md:grid-cols-1`**，6 张 |

项目卡 `card-base p-0 text-left cursor-pointer border-0 w-full card-hover group overflow-hidden flex flex-col`：
1. `div.h-[6px].w-full` 顶部渐变条（**我方棒6 已落地**）
2. `p-4 pb-3 flex-1 flex flex-col`
3. `flex items-start gap-2 mb-2`：h3 `text-[15px] font-extrabold tracking-tight leading-snug flex-1 min-w-0` + 状态徽章（含 7px 圆点）
4. `p.text-[12.5px].text-muted.leading-relaxed.mb-3.line-clamp-2.flex-1` 描述
5. **进度块**：标签「进度」`text-[10px] font-extrabold uppercase` + `text-[12px] font-bold tabular` **58%** + `w-full h-[6px] rounded-full bg-surface-soft` 进度条
6. **材料点组** `flex gap-1.5 mb-3`：每项 `flex items-center gap-1` = `w-2 h-2 rounded-full`（内联 var(--color-green/blue/…)）+ `text-[10px] text-muted truncate` 材料名
7. 「发现偏差」+ owner 首字母+姓名 + 下次动作时间 + 参与者头像组

### 🔴 裁决
- **进度块（58% + 进度条）不做**（项目完成度无数据基础＝编数）。
- **材料点组是本屏最好的真部件候选** —— 我方有材料/文件真值（file-manifest-truth 门在盯），彩色小点可映射「已有 / 缺失 / 未知」，`absent≠none` 红线天然适配。
- 三列 → 两列 → 单列的断点阶梯（`max-xl:grid-cols-2 max-md:grid-cols-1`）可直接对齐。

---

## `/gaps` ↔ 我方 closerlook（多看一眼）—— 计划书标注 **1:1**

| 层 | class |
|---|---|
| 标题块 | `mb-5`（h1「现实差距」+ 徽章「4 个活跃」+ 副题「纯证据，不掺水。Avery 检测四种模式：沉默成员、报告不符、协作断裂、项目偏离。」） |
| 列表 | **`space-y-4`（单栏纵列，不是网格）**，4 张 |

差距卡 `card-base p-5`：
1. `flex gap-4 items-start`
2. **40x40 渐变图标方块** `w-10 h-10 rounded-[9px] grid place-items-center text-white text-[18px] shrink-0`（内联 `linear-gradient(135deg,#e06b6b,#c23b3b)`），字符 ≠ / ⊘ / 📉
3. 标题行 `flex items-center gap-2.5 flex-wrap`：h3 `text-[16px] font-bold` + 类型徽章（报告不符…）
4. **⭐ 对照双列** `grid grid-cols-2 gap-3 mt-3 max-md:grid-cols-1`
   - 左「自报情况」`p-3 rounded-[10px] bg-surface-soft` + `text-[13px] italic text-ink-2`（斜体引语）
   - 右「Avery 观察到的」`p-3 rounded-[10px] bg-red-soft` + 标签色 `text-[#a5322f]` + `text-[13px] text-ink-2`
   - 两侧小标题统一 `text-[10.5px] font-extrabold uppercase tracking-wider mb-1.5`
5. 底部 `flex gap-2 mt-4 items-center flex-wrap`：`text-[12px] text-muted` 项目归属 + `flex-1` 顶开 + 三按钮（解决 / 忽略 / 加入待办）

### 🔴 裁决
- **对照双列（自报 vs 观察）是本战役最有价值的可搬骨架**——它就是「差距」这个概念的视觉语法，且两侧都要求有真证据才画得出来。
  → 前置条件：`gapDerive.ts` 必须两侧都有真值；**只有一侧有 → 单列诚实呈现，不许把另一侧编出来**。
- 三个动作按钮：我方 flowStore 已有 解决/忽略/加入待办 的真闭环（棒5 验过），**可做成真的**。

---

## `/checklist` ↔ 我方 followups（待办清单）

| 层 | class |
|---|---|
| 标题行 | `flex items-end justify-between gap-4 mb-5 flex-wrap`（h1 + 副题 + 徽章「4 项今日到期」+ 右「添加待办」） |
| **段切换 pill** | `flex items-center gap-2 mb-5 p-1 rounded-xl bg-white/70 border border-line w-fit shadow-[var(--shadow-sm)]` —— 当前待办 **10** / 历史清单 **0** |
| **时间分组** | 三段 `mb-6`：**今天 / 本周 / 即将到来**，每段标题带「N 待完成」计数，段内一个 `card-base divide-y divide-line` |

行 `flex items-start gap-3 px-4 py-3 transition-colors`：
- 复选框 `w-5 h-5 rounded-md border-2 border-line-strong bg-transparent shrink-0 mt-0.5 grid place-items-center hover:border-green hover:bg-green-soft`（**我方棒5 已对齐 20px**）
- 主体：标题 `text-[13.5px] font-semibold text-ink` + 元信息行 `flex items-center gap-3 mt-1 text-[11.5px] text-muted` = **来源**（来自决策 #2 / 来自 Nexus 分析 / 来自现实差距）· **负责人** · **时限**
- 右侧 `flex gap-1 shrink-0`：两个 `w-7 h-7 rounded-md grid place-items-center` 图标按钮

### 🔴 裁决
- **时间分组（今天/本周/即将到来）+ 段内计数** 是真的可做（有 due 字段就能分）——需先确认 flowStore 待办有时限字段；**没有就不分组，别编时间**。
- **当前/历史 pill 切换**：我方 notes 屏本就用「历史清单语法」，这个 pill 可复用。
- **元信息「来源」**是真值（决策/差距/提问 三种来源我方都有链路），值得做。
- 「N 项今日到期」徽章＝计数族，符合 KPI 真数纪律。

---

## `/playbooks` ↔ 我方 playbooks（操作手册）

| 层 | class |
|---|---|
| 标题块 | `mb-5`（h1「方法库」+ 副题） |
| 网格 | **`grid grid-cols-2 gap-4 max-lg:grid-cols-1`**，6 张 |

卡 `card-base p-5 card-hover`：
1. `flex items-center gap-3 mb-2`：**32x32 渐变图标方块** `w-8 h-8 rounded-[9px] grid place-items-center text-white text-[15px] shrink-0`（内联 `linear-gradient(135deg,#7d6ce0,#5544b8)`，lucide 图标 15px）+ h3 `text-[16px] font-bold`
2. `p.text-[12.5px].text-muted.mb-3.5` 描述
3. **标签组** `flex gap-2 flex-wrap`，pill `text-[11.5px] font-semibold px-2.5 py-1 rounded-full bg-surface-soft border border-line text-ink-2`

### 🔴 裁决
- 纯展示屏，**零编造风险**，两列网格 + 渐变图标方块 + 标签组可整套对齐。
- 标签 pill 样式与我方 `.lite-badge`/playbookTag 的关系要查（棒7 动过 playbookTag 颜色）。

---

## 横向归纳：她的通用语法（供无参照三屏 room / notes / vision 自行设计）

1. **屏首** = `mb-5` 标题块（h1 26/800 + 12–14px muted 副题，可带计数徽章）；有主操作时升级成 `flex items-end justify-between gap-4 mb-5 flex-wrap`。
2. **筛选/切换** 紧随其后：`flex gap-4 mb-5 items-center flex-wrap` 的筛选条，或 `p-1 rounded-xl bg-white/70 border border-line w-fit` 的 pill 组。
3. **主体三选一**：网格（`grid-cols-2/3 gap-4`）· 纵列（`space-y-4`）· 分组列表（段 `mb-6` + `card-base divide-y divide-line`）。
4. **卡内三段式**：图标/头像方块 + 标题行（h3 15–16px/700-800 + 徽章）→ 12.5px muted 描述 → `border-t`/`mt-3` 分隔的底部区块。
5. **渐变方块尺寸阶梯**：40px（差距卡）· 32px（手册卡）· 人卡头像（rounded-xl）。圆角统一 `rounded-[9px]`/`rounded-[10px]`。
6. **小标题统一** `text-[10.5px]~[11.5px] font-extrabold/bold uppercase tracking-wider text-muted`。
7. **响应式阶梯**：`max-xl:grid-cols-2` → `max-lg:grid-cols-1` / `max-md:grid-cols-1`。
