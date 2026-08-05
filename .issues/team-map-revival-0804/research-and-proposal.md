# Team map 画布复活 · 调研报告 + 方向提案（2026-08-04，只调研未动手）

> 本 session 范围：git/文档考古 + 实机验证 + 提案。**未改任何 src 代码。**
> 触发：Danny 觉得当年花大量时间设计的 team map 画布（react pan-zoom + HUD）被
> 「合并合伙人静态」覆盖丢了，想在一个独立页面里复活它。

## TL;DR（三句话）

1. **画布没丢，一行代码都没删。** 它完整冻结在 `src/story/**`，本 session 已在 HEAD 上实机
   跑通并截图（`team-map-story-head.png`）：pan/zoom、分区花名册、focus 连线、风险分布图、
   警报药丸全部工作。入口 `?mode=story` → Your team → "See it on the map"。
2. **「被覆盖」的真相是入口被翻，不是代码被替。** 07-03 合伙人的静态 HTML mock 顶掉了它的
   首屏位（ADR-0017 降级），07-07 随 story 壳整体冻结（ADR-0022），07-19 裸链默认翻到
   lite2 后彻底退出日常视野。合伙人静态站（manager-command-room）从头到尾**没有合并过代码**
   （decisions.md 明文「只当设计参考，不合并代码」）。
3. **推荐方向：在 lite2 开独立路由 `/map`，用真数据喂这张图**（方案 B，约一场 3 棒战役）。
   唯一需要 Danny 拍的点：07-29 有过「pan/zoom 画布换全站统一纵向滚动语法」的拍板——
   独立地图页等于给 pan/zoom 语法开一个特区，方向上需要他一句话放行。

## 1. 考古结论：两个画布，两条命运

历史上有**两套互不相干的 pan/zoom 画布**，混在一起是「丢了」体感的来源：

| | A · story 的 Team map（要复活的） | B · lite 的「议事室画板」 |
|---|---|---|
| 建 | ADR-0012（P5，`291b1b0`→`5a9d53e` 六轮修订） | feat-025（只是把思考流终端包进可拖板） |
| 亡 | **没死**——ADR-0017 降级 → ADR-0022 冻结 | `08c82c3`（07-29 Danny 拍板）真删了 |
| 现状 | `src/story/**` 完整可跑（本 session 实证） | v02 已绝迹；v01 冻结壳留 `src/lite/LitePanZoom.tsx` |

07-29 拍板砍的是 B（回答卡装在要拖拽的板里默认截断，persona 复审抓的真问题），
**与 Team map 无关**——但它连带立了门 phase H「画布必须绝迹」断言，是复活工程要绕的陷阱（见 §4）。

### Team map 的设计资产（全部在 HEAD 可读）

- `src/story/components/PanZoomCanvas.tsx` — react-zoom-pan-pinch v3 薄壳（41 行；ADR-0012 决策 1 明确否决过 React Flow）
- `src/story/data/layout.ts` — 双列 bipartite 布局，**全公式常量非手摆**（左名册按组网格 + 右项目条按 owner 组序）
- `src/story/lib/useRailCamera.ts` — 派生镜头（contain / width-top 两种 fit + HUD-safe insets）；「calm 镜头 = fit-width 顶锚可读帧」（ADR-0012 修订 6）
- `src/story/components/SvgEdgeLayer.tsx` + `lib/focus.ts` — 连线只在 focus 出现；单点点亮「实体 + 关联簇」
- `src/story/components/scenes/DashboardScene.tsx`（485 行现行纯地图版）— world/HUD 分层、board px only 铁律、风险分布图、tags/search/alert pills
- 巅峰 HUD 版（briefing 药丸 + 带引用选择器的 composer 浮在地图角落）在 `186cc35:src/components/scenes/DashboardScene.tsx`（770 行）随时可考
- CSS：`src/story/styles/10-dashboard-nexus.css`（1203 行，main.tsx 全局加载）+ `src/shared/styles/00-base.css` 里的 `.panzoom-*`
- 依赖 `react-zoom-pan-pinch@^3.4.3` 至今仍在 package.json（story + v01 共用）

### 降级决策链（复活提案必须尊重的既有拍板）

1. **ADR-0017（07-03，Danny）**：合伙人（真实 HR 高管=目标买家）画了张 checklist-first 的静态
   HTML mock；Danny 判断 full-bleed 地图当首屏「像玩具」。地图从默认 tab 降为页内全景子视图。
   **明文保留交互机器，回退成本明文写为「主要在 rail 脚本与 fixtures 措辞」。**
2. **ADR-0022（07-07）**：story/lite 立墙，地图随 story 壳冻结为路演资产，ESLint 机器闸禁止 lite 侧 import。
3. **07-09 拍板排除**：lite 侧不做空间 map，理由是当时 ingestion **不产关系边**（详见 §3——此前提今天已变）。
4. **07-14 v02 决策**：Team map 标「暂缓/不动（设计过未建，不卡三亚）」。
5. **07-19**：裸链默认翻 v02——地图从此要显式 `?mode=story` 才看得到。
6. **07-29**：议事室画板（B）退役，「pan/zoom 画布换全站统一纵向滚动语法」。

### 「合伙人静态」是两个事件

- **事件 A（07-03）**：合伙人手绘 HTML mock（`docs/archived/assets-from-wang/teammaster-pm-dashboard-ui.html`）。
  处理原则是「吸收行为骨架，语言过 ADR-0015 滤网」——**顶掉的是首屏位，不是画布代码**。
- **事件 B（07-13 起）**：合伙人完整静态站 manager-command-room（Next.js+Tailwind，无 git 史）。
  拍板「只当设计参考，不合并代码」；对齐波（feat-050..060）产出的是 lite2 的 9 屏。
  ⚠ 当时挂给 Danny 的「与合伙人对齐出身，防旧形态回流」（decisions.md:47）**未见闭环记录**。
- 官方锚点：`original-story-v01` / `original-lite-live-v01` 两个 annotated tag 钉在 `3a9cf5c`
  （07-13 main，对齐波开工前）。注意该锚点已在 ADR-0017 降级**之后**；要看「地图当首屏」的
  版本应回 `5a9d53e`（最终形态）或 `f4bde81^`（降级前最后一刻，含地图上的 composer/briefing HUD）。

## 2. 实机验证（本 session 证据）

HEAD（`c94a7e7`）+ `npx vite` 隔离端口 5199：

- `?mode=story` → Your team（卡片主页）→ "See it on the map" 一路可点；
- DOM 探针：`.panzoom-wrapper`/`.react-transform-wrapper` 挂载、14 个 `.person-node`、
  6 个分区标签（Founders/Engineering/Product/Design/Go-to-market/Operations）、
  2 个 alert pill、`map-back-chip` 在位、focus 连线 2 条；
- Playwright 截图：`team-map-story-head.png`（本目录）——focus 态（Lin Qing 点亮 →
  两个项目条高亮 + 风险分布图 + 其余淡化）完整呈现。

## 3. 复活方案（三选一 + 推荐）

### 方案 A · 零成本重访（今天就能用，已验证）

不写代码：把 `生产域名/?mode=story` 当「设计博物馆」链接用（配上进图三步路径）。
**定位是参考馆不是产品**：fixture 假数据、英文、冻结不许改。适合给合伙人/客户回放
「wow 高光」，不解决「复活成产品页」的诉求。

### 方案 B · lite2 独立路由 `/map`，真数据喂图（推荐）

把 Team map 作为 v02 的一个**非默认独立页**复活——不动首屏（尊重 ADR-0017），
不进议事室（尊重 07-29），数据从 lite2 store 来（真租户真语料）。

数据基础较 07-09「拍板排除」时已实质变化：

- `LitePerson` 有 group（部门）→ 分区 zone 直接映射 `teamGroups.PersonGroup`；
- `LiteProject.ownerId/ownerName` 已在契约里（07-13 实测真 payload owner 覆盖 16/17）→
  person↔project 的 focus 连线可用真数据点亮；
- `LiteHandoff.personIds` → person↔person 弱连线也有米下锅；
- 零数字红线的定性表达（tone ring / teamPace 聚合读数）story 版已做好范式，
  真数据侧本就有 `stripPersonNumbers` 兜底。

建议切 3 棒：

1. **B1 骨架**：`/map` 路由 + lite2 自有薄 pan/zoom wrapper（照 v01 `LitePanZoom.tsx`
   的墙合规先例，绝不 import story）+ `layout.ts` 公式移植（fixture team 硬编码 →
   按 `PersonGroup` 动态分组，人数不定时行列自适应）+ calm 态人员圆点/项目条真数据渲染。
   入口：Team 屏一个「在地图上看」链接 + 返回芯片。
2. **B2 focus 机器**：点选→关联簇点亮（ownerId/handoff 边）+ SvgEdgeLayer 移植 +
   点空白回 calm + 节点点击直通现有 DetailOverlay/项目详情路由。镜头简化：不带 rail，
   只要「fit-width 顶锚初始帧 + 双击/按钮 reset」。
3. **B3 HUD-lite + 门**：搜索（复用 searchDerive）、分组/状态过滤 chips；门电池补一道
   `verify-team-map.mjs`（画布挂载、滚轮不劫持页面滚动、focus 点亮/复位、红线零数字）
   + 像素基线 + 截图人眼过。**不复活 composer/briefing HUD**——composer 在 lite2 已有
   归宿（AskAveryLauncher），巅峰版 HUD 只当设计参考捞想法。

工作量感觉：M~L（一场战役），~1300 行冻结代码可当"带注释的规格书"抄，但因墙纪律
全部要以移植重写落地，CSS 要从 10-dashboard-nexus.css 摘选并重作用域到 `.lite2-shell`。

### 方案 C · 巅峰 HUD 版整体复刻（不推荐）

从 `186cc35` 恢复 770 行带 composer/briefing HUD 的全量版。否决理由：composer 上画布
与 07-29 拍板正面冲突；briefing 已迁 Home；fixture 耦合深。只作 B3 的想法来源。

## 4. 工程陷阱清单（开工前读）

- **门冲突**：`live-frontend-gate.snippet.js` phase H `assertRoomCanvas` 断言
  `.react-transform-wrapper` 在 v02 DOM 绝迹。它在议事室相位跑、SPA 下 `/map` 不同时挂载,
  理论上不冲突,但**必须**把断言语义改为「议事室内绝迹」并在 gate.md 写明豁免范围,
  否则就是 verifiers-that-lie 型假绿/假红温床。
- **墙纪律**：lite2 禁 import story（ESLint 机器闸）。一切复用=复制移植,先例是 v01 的
  `LitePanZoom.tsx`（文件头注释就是这么写的）。
- **CSS 越墙**：10-dashboard-nexus.css 虽被 main.tsx 全局加载,但语义上是 story 资产
  （随 story 退役会断）;新页样式必须自带并 scope 到 `.lite2-shell`（c27c34e 的教训）。
- **红线**：人员节点零数字外显;capacity/mood 只准聚合成组级定性读数（story 版 teamPace 范式）。
- **i18n**：新页双语,中文直接写大白话（08-03 口径,不走 M3）。
- **交互旧伤**：滚轮缩放劫持阅读区（`0fb0e4a`）、HUD 盖住内容、视口高度盲轴（en 先塌）——
  B3 的门要把这三条写进判据。
- **布局公式**：`ROSTER_COLS 3` 等常量按 fixture 14 人调的;真租户人数不定,B1 要把
  行列/board 尺寸改成人数的函数（守 prefer-runtime-navigation-over-handtuned-layout）。

## 5. 大团队怎么办(几十~上百人,2026-08-05 Danny 追问后补)

现行公式(3 列、行距 140)的账:30 人≈1900px 花名册列,pan/zoom 消化得动,只需列数
随人数自适应;**80 人≈4100px(三屏高),"一眼看清全公司"失效——这是分水岭**;300 人纯噪音。

解法是把地图自己的语法抬高一层复用——**calm = 圆点、focus = 原位长大**这套规则在部门层
再用一次:

- **大团队 calm 态:部门是节点不是人。** 每组一张部门卡:人数 + teamPace 组级定性读数 +
  警报角标。manager 在上百人语境下的认知单位本来就是组。
- **点部门 = 原位展开成员网格**(其余收拢淡化),再点人到个人 focus。展开是**点击/状态驱动
  而非 zoom 阈值驱动**——守住 ADR-0012 修订 5 否决 LOD 的理由(确定性/可回放),复用
  "点空白回 calm"心智。
- **开局镜头对准火情不对准全员**(呼应 ADR-0017 的教训):初始帧框住有警报的部门,数据源
  即 alert pills 逻辑;项目列默认只铺进行中/有风险,完结收进"显示全部"。

落进计划的两个便宜决策(B1 就做,否则返工):

1. **布局纯函数化验收写死**:列数/board 尺寸/项目列 x 全部是 `(分组,人数,项目数)` 的函数,
   零写死常量;用 **80 人合成租户 fixture** 跑一遍作验收。
2. **zone 契约按"可收拢"设计**:部门 zone 从第一天是有 id、聚合读数、成员清单的实体,
   不是纯视觉标签——"部门收拢态"将来作 **B4 追加一棒**即可扣上,触发条件 = 第一个
   超过 ~40 人的真租户出现。

明确不做:虚拟化/canvas 渲染(产品定位小公司 manager + 语料上限,300 人租户不在近期
市场内;150 个 DOM 节点对 rzpp 无压力)。唯一性能注意:人数大时关逐节点入场动效
(reduced-motion 路径现成)。

留给 PRD grilling 的决策项:收拢阈值取值(建议 ~40)、B4 是否进 v1 范围、"火情开局帧"
的判据(哪些信号算火情)。

## 6. 需要 Danny 拍的唯一一点

**「pan/zoom 语法在独立地图页复活」是否放行。** 07-29 的拍板措辞是「换**全站统一**纵向
滚动语法」;独立 `/map` 页不碰首屏、不碰议事室,但确实给 pan/zoom 开了特区。支持放行的
论据:ADR-0017 当年明文保留交互机器并写明回退成本,等的就是「地图才是记忆点」被重新
需要的一天;07-29 砍的对象是「把长文报告卡装进拖拽板」这种反可读性用法,不是空间地图。
拍板后即可按 §3 方案 B 开 issue + grill PRD,换 session 开工。
