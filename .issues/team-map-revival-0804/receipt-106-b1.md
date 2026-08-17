# 回执 · #106 B1 骨架棒（team map 复活）—— 2026-08-17

分支 `claude/team-map-b1-skeleton-de3253`（基于本地 main `4f9a9a0`，并入了 PRD 那三个文档提交）。
**只做 B1**：B2 focus 机器 / B3 HUD+门 / B4 收拢态一律没动。

## 交付了什么

| 票面 B1 条目 | 落点 |
|---|---|
| `/map` 路由（照 `PAPERWORK_PATH` 先例，刻意不进 `LiteScreen`） | `src/lite2/routes.ts`（`MAP_PATH` / `mapHref()` / `teamHref()`）· `src/lite2/Lite2App.tsx` |
| TeamScreen briefing 头「地图视角」入口 | `src/lite2/screens/TeamScreen.tsx` |
| 地图页返回芯片回 `/team` | `src/lite2/map/MapScreen.tsx` |
| 薄 pan/zoom wrapper 独立成文件（墙合规） | `src/lite2/map/MapPanZoom.tsx` |
| 布局公式移植（分区/列数/board 尺寸全是纯函数） | `src/lite2/map/mapLayout.ts` |
| calm 渲染真数据（人=圆点+名字 / 项目=条 / 连线全隐藏） | `src/lite2/map/MapScreen.tsx` |
| 契约小补 `LiteProject.ownerId` 透传 | `src/lite2/teamData.ts` |
| 空态复用团队页引导语 | `MapScreen.tsx`（复用 `teamEmpty*` 三键 + `.lite-team-empty-*` 样式族） |
| i18n en/zh 成对新键（8 个） | `src/shared/i18n/en.ts` · `zh.ts` |
| CSS 从 story `10-dashboard-nexus.css` 摘选重写、scope 到 `.lite2-shell` | `src/lite2/styles/lite2.css` 末段 |

顺带做的一件小事（为了守住「单一尺子」）：`statusTone` 从 `ProjectsScreen.tsx` **原样提进**
`projectView.ts` 并导出成 `projectStatusTone`，另导出 `statusKeyOf` / `progressOf`。
判断逻辑一字未改——地图手上只有 `LiteProject.statusRaw`（没有 `ProjectView`），不提上来就得
在地图里再写一份 `if (status === 'blocked')`，同一个状态在两块屏上会有两个颜色。

## 布局公式：为什么不是照抄 story

story 的 `layout.ts` 是单列纵向堆叠部门（它的 fixture 是 6 部门 × 2-4 人，恰好好看）。
真语料 demo-seed 是 **10 部门 / 16 人**，绝大多数部门 1-2 人——照抄下去是一根 480px 宽、
2200px 高的细柱子，fit-width 之后只剩顶上两组看得见。这就是 PRD §8 点名的头号美感风险。

所以多做了一层：**部门分区自己也排成网格**，列数由「哪种排法让整块 board 的长宽比最接近
可读窗（1.6）」反算——把 1..4 列每种排法真排一遍打分取最优。同一个公式两头都成立：

- demo-seed（10 组 / 16 人 / 6 项目）→ `zoneCols=2` · `personCols=3` · board **1852×1092**
- 合成 80 人（9 组 / 80 人 / 24 项目）→ `zoneCols=4` · `personCols=4` · board **3476×2522**

零写死坐标。分区内最后一行**居中**——「多组少人」形态下，1 个人的部门把头像顶在左上角，
整片名册会读成一堆没写完的表格。

## 验收

### ① demo-seed 上图（人眼过 · 逐视口）

后端 `AVERY_BRAIN=mock AVERY_EXTRACTOR=heuristic AVERY_EMBEDDINGS=keyword
AVERY_DEMO_SEED_DIR=tests/fixtures/demo-seed` :8147 · 前端 build+preview :5183 · 一键示例团队。

实测：**16 人 / 10 部门 / 6 项目，6 个项目全部带 `ownerId`**（后端 `_link_owners` 解出来的），
所以「按 owner 部门组序排」这条在这份语料上真的被验到了，不是空真。

截图存在 `shots/`：`b1-demo-seed-desktop.png`（1440×900）· `b1-demo-seed-mobile.png`（390×844）·
`b1-team-entry.png`（团队页入口）· `b1-synth-80.png`（合成 80 人）。

### ② 80 人合成 fixture

- 语料 + 生成器：`fixtures/team-80.json` · `fixtures/make-team-80.mjs`（确定性，无随机数/时钟）。
- 哨兵是**造出来的**不是等来的（PRD §8 风险 3）：owner 三种缺法（全无 / 只有名字没 id /
  id 指向查无此人）· status 两种（缺席 / 词表外）· progress 三种（缺席 / 真的是 0 / 越界 140）·
  一个没写部门的人（→「未分组」桶）· 一个长姓名 · 一个长标题。
- `check-layout-80.mjs` —— 真 derive（`liteTeamFromPayload`）+ 真布局（`buildMapLayout`），
  **25 条全绿**。含：分区数=花名册部门数、每个人都在板上、分区两两不重叠、人都在自己框里、
  所有 world 对象都在 board 内、坐标全是有限数、项目按分区序单调不降、三条 owner 缺法全部沉底。
- `check-render-b1.mjs` —— 浏览器真渲染，**全绿**：9 分区 / 80 人 / 24 条 · 进度条 22 条
  （缺席与越界各一条不画）· 0 宽的条恰好 1 条（`progress:0` 是**已知值**，不是缺席）·
  人节点子树零阿拉伯数字 · owner 兜底行 2 条且都带「负责人」标签 · 页面零横滚 ·
  拖动后 transform 真位移 · 复位精确回到初始镜头。

⚠ 两个文件都**故意不叫 `verify-*`**：`git ls-files "*verify-*.mjs"` 是本仓判定「有哪些门」的
自查命令，往那个 glob 里塞不在 ROSTER 的文件＝再造一批 `rich-align-0722/verify-*.mjs` 那样
没人裁定过的孤儿。进 ROSTER 的 `verify-team-map.mjs` 是 **B3** 的活，这两份的判据届时并进去。

### ③ 既有门与电池

- `./init.sh` **exit=0**；lint `6 problems (0 errors, 6 warnings)` = 存量基线，**零新增**。
- `node scripts/i18n-orphans.mjs`：**孤儿键 0 个**（8 个新键全部有引用，也没碰坏存量）。
- 既有门电池 / 像素基线 / `assertRoomCanvas` 改判：**一个字没动**（票面明写属 B3）。

## 两条实测出来的坑（写下来免得 B2/B3 再踩）

### 🔴 计数判据全绿 ≠ 镜头是对的

第一版把首帧镜头挂在 `useLayoutEffect` 上，实测镜头**纹丝不动停在 `initialScale` 0.5**：
rzpp 在自己的挂载流程里把 initialScale 写进 transform，时点晚于父组件的 layout effect，
我们先设的值当场被盖掉。而当时**所有计数判据都是绿的**（分区 10 / 人 16 / 项目 6 全对），
只有截图上那一大片空白露了馅。

补的判据是「实际 scale vs **独立算出来的** fit 期望值」——期望值用画布实测宽度 × 规格常量，
一个数都不问 `MapPanZoom` 要（尺子不许长在被量的东西上）。

变异实测（4 个变体）：两把锁（`onInit` / 被动 `useEffect`）**都拆才红**，
只留任意一把都绿。也就是说单看首帧它俩互为冗余——**别把「判据绿了」读成「两条都在起作用」**。
两条都留是因为射程不同（effect 管换板，onInit 管「父 effect 跑时 rzpp 还没量到 wrapper」），
B3 写门时要给两把锁**各配一个专属变异**，别拿一条当两条用。

### 🔴 窄屏上画布会被自己的内容撑开

桌面 `.scene` 是 `position:absolute; inset:0`（`.app-shell` 100vh + overflow:hidden），
`flex:1` 的画布天然被视口框住；**≤860 那套把 `.scene-stage/.scene` 换成 `position:relative`
+ 只给 min-height**，高度改由内容决定 → `flex:1 1 auto` 的画布把 flex-basis 摊成了 board 的
1092px，整页被撑到 1219px、board 被垂直居中到屏幕外。390×844 实测：画布 top=190、高 1093，
第一屏全是空点阵。修法在 lite2.css 的 ≤860 段（给页面钉确定高度 + `min-height:0`），
并配了一条冒烟判据「画布底边必须落在视口内」。

## 对 PRD 公式补的一条（顺带记账）

ADR-0012 修订 6 的原文是 fit-width **顶锚**。移植时补了两件事，理由都写在 `MapPanZoom.tsx`：

1. **可读地板 `MIN_FIT_SCALE=0.6`**：纯 fit-width 在 390px 手机上算出 0.198，整块板缩成
   名字 2.6px 的缩略图——第一眼读起来是「坏了」而不是「总览」。Q3 拍板是「不做手机专门布局」，
   那是**同一块板、小一点的窗口**，不是同一块板缩到看不见。桌面 0.731 / 笔电 0.65 都在地板
   之上，两个视口行为一字不变。
2. **装得下就居中，装不下才贴边**（两轴各判各的）。顶锚存在的理由是「内容比画面高，从头读」；
   内容比画面矮时顶锚只是把它顶在天花板上、底下空一大片。

这两条是执行层的取舍、不改任何方向性拍板，按 `AGENTS.md` 的 act-first 记在这儿供事后抽查。

## 没做 / 留给下一棒

- B2：focus 机器（点选 / SvgEdge 连线 / 原位长大卡 / `?focus=` 深链 / 组级定性读数）。
  地图的 z 分层已经给连线留了 z-index 2 这一层，`MapPersonNode.pos` / `MapProjectNode.pos`
  就是边的锚点，`MapProjectNode.zoneIndex` 已经算好。
- B3：HUD-lite + `verify-team-map.mjs` 进 ROSTER + `assertRoomCanvas` 改判 + 像素基线。
- B4（#107）：部门收拢态。`MapZone` 已按「可收拢」设计（有 key、有 rect、有 members 清单）。
- 一件顺手发现、**没有顺手修**的事：全局「问 Avery」悬浮胶囊固定在底部居中，在地图上会盖住
  底下那一排节点（别的屏上它盖的是卡片，同一个问题）。不属 B1 射程，记在这里。
