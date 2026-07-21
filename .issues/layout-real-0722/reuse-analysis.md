# 首批四件的复用分析（2026-07-22 · 读码取证）

> 结论先行：**首批四件里没有一件是「从零造新功能」**。四件全部是
> 「已有真数据 / 已有真链路」的**重新摆放 + 重新配皮**。这把本战役的功能风险压到很低，
> 也正好符合「无真功能不建」的红线——因为真功能本来就在，只是藏得太深。

---

## 件① 主页右栏「真差距面板」

- **DOM 已存在**：主页区块「文件自己对不上的地方」（现空态：现在没有自相矛盾的地方）。
- **数据源**：`src/lite2/gapDerive.ts`（派生），链到「多看一眼」屏。
- **要做的**：从 `.lite-home-row`（385+385 中段双列）挪进新的右栏；套她 `card-base p-4` 的
  面板壳（section-label 小标题 + 12px muted 说明 + 行列表）。
- **不做的**：不造新的差距类型、不补「Avery 观察到的」那一侧（除非 gapDerive 真有两侧值）。

## 件② 主页右栏「真关注成员面板」

- **DOM 已存在**：主页区块「文件里反复提到的人」（现空态：现在文件没有特别指向某个人）。
- **判据已经是诚实的**：现有说明文案原话——「数的是文件里提到的次数，不是对任何人的评价」。
- **要做的**：挪进右栏；套她的行结构（`py-3 border-b last:border-b-0 hover:bg-surface-soft/50
  -mx-1 px-1 rounded-lg`）+ 首字母头像（`InitialAvatar` 已有）。
- 🔴 **明确删掉她的百分比列**（她每行右侧有 91%/88%/84%/82%）——撞 D14 人面零数字零血条，
  且 `LitePerson` 类型层根本没有数字槽位（TeamScreen.tsx:20 注释：「人卡永不渲染任何数字——
  LitePerson 类型层就没有评分键的位置」），**想撞也撞不上**。

## 件③ 「快问」悬浮入口 —— ⭐ 最大的发现

**真提问流已经完整存在，只是被埋在「你的团队」屏里。**

- 组件：`src/lite2/LiteComposer.tsx`，当前**唯一渲染点** `screens/TeamScreen.tsx:474`。
- 它已经做的事（全真）：
  - 输入问题；
  - `@` 引用**真人真项目**（`team.people` / `team.projects`，零 fixtures，文件头注释明写
    「引用只来自 live 语料」）；
  - 提交 → `store.askLive({ situation })` → **feat-015 `/advise` SSE 真跑** → `goScreen('room')`。
- **定位几乎已经是她的悬浮球**：`shared/styles/00-base.css:671` 的 `.composer-layer` =
  `left:50%; bottom:24px; transform:translateX(-50%); width:min(720px,100vw-48px); z-index:25`，
  只是 `position: absolute`。
  她的：`fixed bottom-6(24px) left-1/2 -translate-x-1/2 z-50` —— **底部居中、24px，完全一致**。

### → 棒C 的「快问悬浮」实际工作量
1. 把 `<LiteComposer />` 从 TeamScreen **移**到全局壳（Lite2App）。**是移不是复制**——
   复制会产生两份独立的输入状态，同一个问题能被提交两次。
2. `.lite2-shell .composer-layer { position: fixed; z-index: … }` 覆盖一条。
   🔴 `00-base.css` **一行不动**（它同时供 v01/story，是冻结面）——按老规矩用 `.lite2-shell` 前缀
   在 `lite2.css` 覆盖。
3. 收起态做成她那种小胶囊（现有 `is-expanded` 状态机已经有收/展两态，直接用）。
4. **transport 零改动。**
- 🔴 文案：她的「问 Nexus」是锁词，我方叫**「快问」**（ADR-0023 已把 surface 定死：
  EN "Quick ask" / ZH「快问」；忌 survey/问卷、poll/投票、打分）。

### ⚠️ 附带的 UX 判断（我拍板，记档供 Danny 事后抽查）
把提问入口从「你的团队」屏移到全局，等于**修了一个发现性 bug**：
产品最核心的交互（问 Avery）此前只在九分之一的屏上可达。
Danny 点的「悬浮入口」正好把它治了。TeamScreen 移走后该处不留占位。

## 件④ 顶栏「真搜索」

- **检索谓词已经写好了**，就在 `LiteComposer.tsx:63-68`：
  ```js
  all.filter(option => {
    if (referenceFilter !== 'all' && option.kind !== referenceFilter) return false
    if (!query) return true
    return `${option.label} ${option.meta}`.toLowerCase().includes(query)
  })
  ```
  检索面 = `team.people`（`name` + `role`）+ `team.projects`（`title` + `ownerName`）。
  **正好等于她的占位文案语义「搜索成员、项目...」。**
- **全量在内存**（`store.team`），示例团队 2 人 / 真语料 7 人量级 → **纯客户端检索，零 endpoint**。
- **要做的**：把这段谓词**抽成共享 selector**（如 `src/lite2/searchDerive.ts` 的
  `searchTeam(team, query)`），**LiteComposer 的引用菜单与新顶栏搜索共用同一个函数** ——
  否则两套检索逻辑必然漂移（同一个词在两处给不同结果）。
- 几何预算见 `topbar-budget.md`：**≥1280px 才显示，定宽 220–260px**。
- 无结果态要诚实（「没有匹配的成员或项目」），且**空 team 时整个搜索块不渲染**
  （没材料就没得搜，符合 absent≠none 的语气）。

---

## 件⑤ KPI 真数卡（首批第 4 条的另一半）

- **五个真计数已经在主页渲染**（`.lite-home-counts` 现为 5×142px 栅格）：
  `2 人 / 1 个项目 / 2 份文件已读 / 1 条笔记 / 0 条待跟进`。
- 现有区块标题「Avery 手上有什么」，说明文案原话：
  「人、项目、文件、备忘、待办——每一个数字都是 Avery 实际读到过的。」
  → **诚实计数的承诺早就写在文案里了**，本战役只是把它做成她的卡片形态。
- **要做的**：套她的 KPI 卡（`p-4` + border + `rounded-[var(--radius-card)]` +
  标签 `11.5px uppercase tracking-wider muted` + 数值 `25px extrabold tabular`）。
- 🔴 **明确不做**（编造型指标，无数据基础）：
  营收目标完成率 · 预订单转化率 · 客户投诉率 · **团队负载（均）**（后者还额外撞 D14）。
  → 她五张卡里只有第五张「未解决差距」是计数族；我方五张**全是**计数族。
- **增量行不做**（她每张卡底下有「▲ 上月 3.1%」「低于同期节奏」）——我们没有历史快照，
  编不出同比。卡底留空或放该计数的口径说明。

---

## 归纳：本战役的功能风险面

| 件 | 新 transport | 新后端 | 新数据派生 | 主要工作 |
|---|---|---|---|---|
| ① 差距面板 | ❌ | ❌ | ❌ | 挪位 + 配皮 |
| ② 关注成员面板 | ❌ | ❌ | ❌ | 挪位 + 配皮（删百分比列） |
| ③ 快问悬浮 | ❌ | ❌ | ❌ | **移组件** + 一条 position 覆盖 |
| ④ 顶栏搜索 | ❌ | ❌ | ⭕ 抽公共 selector | 新 UI 块 + 断点闸 |
| ⑤ KPI 真数卡 | ❌ | ❌ | ❌ | 配皮 |

→ **全战役首批不需要动 `transport.ts`**（ADR-0002/0021 边界问题因此不构成阻塞，
但仍按纪律在棒C 开工前把两条 ADR 读完记档）。
