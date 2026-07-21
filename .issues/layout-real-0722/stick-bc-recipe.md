# 棒B / 棒C 施工配方（读码定位完毕，2026-07-22）

## 棒B · 主页外夹 + 双栏

### 挡路的规则只有三条（已穷举）

| 位置 | 现状 | 改成 |
|---|---|---|
| `lite2.css:3523-3529` `.lite2-shell .lite-home-frame` | `max-width:860px; margin:0 auto; padding:84px 36px 90px; display:flex; flex-direction:column; gap:18px` | 外夹换成 `--lite2-frame-w`（见下） |
| `lite2.css:3926-3930` `.lite2-shell .lite-home-row` | `display:grid; grid-template-columns:1fr 1fr; gap:18px` | `1.55fr 1fr`（对齐她的 `grid-cols-[1.55fr_1fr]`）+ `align-items:start` |
| `lite2.css:3937` `@media (max-width:720px)` | `.lite-home-row → 1fr`；`.lite-home-frame padding:72px 20px 80px` | 断点上移（见 E5） |

### ⭐ 关键发现：`--lite2-frame-w` 已经存在，且只有一个消费者

```
lite2.css:5388   --lite2-frame-w: min(1480px, calc(100vw - 48px));
lite2.css:5438   （顶栏）width: var(--lite2-frame-w);
```

棒2 定义它时就是照她的 `w-[min(1480px,calc(100vw-48px))]` 抄的，但**只给了顶栏**。

→ 棒B 让 `.lite-home-frame` 也消费它 = **一个变量两个消费者，内容栏与顶栏精确共基准线**。
这正是 `battle-map.md` §3.1 点名的那条差距：「顶栏左右各比内容多出约 310px，不共基准线」。

**写法**（文件尾新开 banner 段，同权重后写者胜，`00-base.css` 不动）：
```css
.lite2-shell .lite-home-frame {
  max-width: none;               /* 卸掉 860 */
  width: var(--lite2-frame-w);   /* 与顶栏同一个变量 */
  padding-left: 0;
  padding-right: 0;              /* 她的 main 无横向内边距，子元素齐外夹边 */
}
```
🔴 横向 padding 必须归零，否则内容比顶栏又缩进 36px，白改。
（纵向 `84px/90px` 保留；顶部让位另有 `--lite2-clear-top` 体系管，别动。）

### D15 复核（为什么是 1480 不是 1040）

⚠️ **修正（棒A 对抗审查）**：外夹是 `min(1480px, 100vw−48px)`，所以在**验收视口 1440 下外夹是 1392 不是 1480**。
889px 那个数只在 ≥1528px 视口才出现——别拿它去反推别的尺寸（会错 54px）。

@1440（cr-alignment 与像素基线唯一跑的宽度）：

| 量 | 值 | 依据 |
|---|---|---|
| 外夹实宽 | **1392** | `min(1480, 1440−48)`；与顶栏 `topbar.width1440` 同值 |
| 左栏 | **835.17** | `(1392−18)×1.55/2.55`；她方实测 `835.172px` ✓ |
| 右栏 | **538.83** | `(1392−18)×1/2.55`；她方实测 `538.828px` ✓ |
| KPI 单格 | **267.19** | `(1392−4×14)/5`；她方实测 `267.188px` ✓ |

**D-1 结论不变**：左栏 835.17 落在 D15 的 760–1040 带内 ✅
若取 1040 外夹 → 左栏 ≈ 621px，**比下限还窄 139px**，且比现在的 860 单栏更窄 —— 与「满宽仪表盘」直接矛盾。
右栏 538.83 是**侧栏不是内容栏**，不受 D15 约束。

### ⚠️ E5 断点：现在的 720 必须上移

1.55fr:1fr 在总宽 W 下右栏 = (W−18)×0.392。要让右栏不低于 ~330px（够放头像行 + 两行文字），
需 W ≳ 860。**建议断点取 880**（现有 `.lite-home-skeleton-row` 已用 `@880` 单列，同构）。
🔴 **不能取 1080** —— 那会让外夹永远小于断点、双栏永不生效。

### 门
`verify-topbar-clearance`（栏宽变了让位仍要过）· `verify-cr-alignment SPEC_STICK=5` ·
`verify-home-skeleton`（🔴 空态骨架零数字，双栏化后要复验）· 像素基线**会真动**。

---

## 棒C · KPI 条上提 + 真数卡

### 位置

| 位置 | 现状 |
|---|---|
| `HomeScreen.tsx` ④「Avery 手上有什么」区块（约 :415） | 沉在最底，五格 |
| `lite2.css:4018-4022` `.lite-home-counts` | `grid-template-columns: repeat(auto-fit, minmax(104px,1fr)); gap:10px` |

### 改法

1. **TSX**：把 ④ 整块从最底提到 header 之后作**第二段**（她的顺序：标题块 → KPI 条 → 双栏）。
2. **CSS**：`grid-template-columns: repeat(5, 1fr); gap: 14px`（她 `grid-cols-5 gap-3.5`）
   + `@media (max-width: 880px) { repeat(2, 1fr) }`（她 `max-lg:grid-cols-2`）。
3. **卡样式**（她的 KPI 卡三行）：
   - 卡壳 `p-4` + `border` + `rounded-[var(--radius-card)]` + `bg-white/.97` + `shadow-sm`
   - 标签 `11.5px` `font-semibold` `uppercase` `tracking-wider` muted
   - 数值 `25px` `font-extrabold` `tracking-tight` **`font-variant-numeric: tabular-nums`**
4. 五个数保持现状不变（人 / 项目 / 文件已读 / 笔记 / 待跟进）——**全是 `.length`，全是真数**。

### 🔴 不做
- **卡底进度条**（她的 `bar%` 是硬编码指标串）
- **同比增量行**（「▲ 上月 3.1%」——我们没有历史快照，编不出）
- **她的前四张率值卡**（营收完成率 / 转化率 / 投诉率 / 团队负载）—— 无数据基础＝编数；
  负载还额外撞 D14 人面零数字。

### ⚠️ 门的高危点
- `verify-home-skeleton`：**空态骨架不能出 KPI 数**（骨架零数字是硬判据）。
  KPI 条上提后要确认空态下这一段仍是骨架块而不是一排 0。
- `verify-contrast-smalltext`：`11.5px uppercase muted` 标签是 AA 高危，小字色必须取我方 `*-text` 补偿值，
  **不取她的原始灰**（D1-D4 台账）。


---

## ⚠️ 棒A 对抗审查带来的两条施工修正（写码前必读）

### 修正一：外夹**不要**写 `max-width`，写 `width`

规格行 `layout.homeFrameWidth` 现在量的是 **rect.width**，不是 computed `maxWidth`。
原因（实测）：她方 main 用 `width:min(1480px,calc(100vw-48px))`，computed `maxWidth` 是 `none`；
我方复用 `--lite2-frame-w`（同一个 `min()` 表达式）后 `maxWidth` 同样是 `none`。
断言 `maxWidth=1480px` 只有写死裸字面量才绿，而那种写法在 ≥1528px 视口下
**内容比顶栏窄 48px**（1480 变成了含内边距的外框），正是本战役要消灭的「不共基准线」——
而且门只跑 1440，这条回归**无门可查**。

→ 本配方 §「写法」那段的 `max-width:none; width:var(--lite2-frame-w)` 是**对的**，照写。
→ 但 `padding-left/right: 0` 是**必须的**，不是可选：`layout.homeFrameWidth`（量 `.lite-home-frame`）
   与 `layout.homeContentWidth`（量 `.lite-home-row`）期望值都是 1392，
   **两行同时绿 ⟺ 横向内边距为 0**。这一对就是防「1480 外框 + 内缩」那条岔路的门。

### 修正二：`.lite-home-counts` 必须横跨整个内容盒

`layout.homeKpiFirstCellWidth = 267.19` 隐含 `(1392−4×14)/5`，即 KPI 条与双栏同宽。
现状 `.lite-home-overview` 有约 19px 内边距（实测 `.lite-home-counts` 宽 750 < 内容盒 788），
棒C 要把它拆掉，让 KPI 条成为内容盒的直系满宽块（她的 KPI 条就是 `main` 的直系子）。
