# Team map 复活 · PRD v1(2026-08-17 grill 定稿,待 Danny 终确认)

> 前置材料:[research-and-proposal.md](research-and-proposal.md)(08-04 调研 + 方案 B + 08-05 大团队策略)。
> 本文按 main 最新现状(至 `2c74104`,含 ADR-0033/0034、#46-#89 各票)校准。

## 0. 拍板记录

| 决策 | 结论 | 谁/何时 |
|---|---|---|
| 方向:lite2 独立页真数据复活(方案 B) | ✅ | Danny 08-05「B看起来没问题」 |
| pan/zoom 语法特区(对 07-29 全站纵向滚动拍板的豁免) | ✅ 随方案 B 一并放行 | 同上 |
| Q1 定位与内容 | **A·关系全景**:人+项目+focus 边 | Danny 08-17 |
| Q2 入口 | **A·团队页头部「地图视角」按钮**,今天页入口等反馈 | Danny 08-17 |
| Q3 手机 | **A·可开可拖可缩(rzpp 原生),不做手机专门布局**,冒烟逐视口验 | Danny 08-17 |
| Q4 演示 | **A·demo-seed 上图效果进 v1 验收**,不做自动导览 | Danny 08-17 |
| Q5 大团队条款 | 照录(见 §5) | Danny 08-17 |

## 1. 定位(一句话)

回答目录页和项目屏都答不了的问题:**「这家公司的活儿都压在谁身上」**——人按部门站好、
项目条在侧,点人亮出他背着的项目,点项目亮出谁在扛、那组人这周绷不绷。
非默认页、不占 tab、不抢「今天」页的决策心流。

## 2. 范围

**做**:`/map` 独立路由页;人员节点按部门分区 + 项目条列 + focus 连线;pan/zoom + 复位;
HUD-lite(搜索/部门 chips/警报药丸);demo-seed 验收锚定;80 人合成 fixture;en/zh 双语。

**不做(v1)**:composer(全局悬浮问 Avery 已覆盖,#47)· rail/自动导览(路演走 story 壳)·
部门收拢态(B4 缓建)· 虚拟化渲染 · 手机专门布局 · 陈旧证据/冲突信号上图(#51/#52 的数据,
记未来候选)· person↔person handoff 弱边(记未来候选)· story/v01 冻结面任何改动。

## 3. 页面规格

### 3.1 路由与入口
- 路径 `/map`,**照 `PAPERWORK_PATH` 先例**:独立 path 常量 + Route,刻意不进 `LiteScreen`
  联合类型(不是第十个 tab——顶栏 9 tab 已在窄屏溢出,这是 routes.ts 里写明的坑)。
- 入口:TeamScreen briefing 头右侧「地图视角」链接;地图页左上返回芯片回 `/team`。
- focus 可分享:`/map?focus=person:<id>|project:<id>`(路径作用域参数,离开 /map 自然消失,
  不进 EPHEMERAL_PARAMS)。

### 3.2 布局(公式,零手摆)
- 分区 = `deriveGroupFacets` 的部门序(同一把尺),`__ungrouped__` 落「未分组」区。
- 左名册区:每部门一块紧凑网格,列数/行距/board 尺寸全部 = f(部门数, 各组人数);
  **「多组少人」是 demo-seed 的现实形态(9 部门 16 人),验收锚定这份语料必须好看**。
- 右项目列:统一横条,按 owner 所属部门的组序排;无 owner 的沉底。
- 人节点用 lite2 自己的 `InitialAvatar`(不是 story 的 PixelAvatar——产品一致性)。

### 3.3 calm / focus(继承 ADR-0012 修订 5 语法)
- calm:人 = 头像圆点 + 名字;项目 = 条(标题 + status tone + progress 条**仅当 progress
  存在**+ owner 名)。连线全隐藏。
- focus:点人 → 亮「他 + 他 owned 的项目」;点项目 → 亮「它 + owner」;点空白回 calm。
  被点节点**原位长大**成 mini 卡(人:名字/职位/定性自述读;项目:摘要/截止/阻碍数),
  卡上「打开档案」→ 既有 `/team/:personId` 浮层、「看项目」→ `/projects/:projectId`。
- 组级读数:部门标签下的定性短语,**前端从 selfReport(mood)真派生**(liveHandoffs 同款
  零捏造纪律);组内无任何自述 → 不显示(缺失就是缺失)。

### 3.4 数据契约(单一尺子,don't invent)
- 只读消费 `useLite` store;**禁止在地图里另写一份 derive**——owner 显示名走项目屏同款
  兜底(`projectsUnknownValue`),状态文案走 `projectStatusText(statusRaw)`。
- **契约小补**:`LiteProject` 透传 `ownerId?: string`(现被 derive 消费后丢弃;连线主键,
  缺失就是缺失、不用名字模糊匹配)。
- 缺失诚实渲染:无 owner → 不画边、条上显兜底词;无 status → 中性 tone;无 progress → 无条。
- 红线:人身零数字(类型层已无数字键,地图不新增任何人身数字面);项目 progress% 允许(项目可硬)。

### 3.5 HUD(viewport-fixed,继承 world/HUD 分层铁律)
- 搜索(复用 searchDerive)+ 部门 chips(deriveGroupFacets)→ 都是 focus 的触发器。
- 警报药丸:blocked / at-risk 项目计数(按 statusRaw 判),点击聚焦对应簇。
- world 对象 board px only;HUD 才许用视口单位(ADR-0012 修订 1 的 scale 契约)。

### 3.6 空态与小团队
- 无人员:复用团队页空态引导语(去上传),不渲染空板。
- ≤3 人:照常渲染,镜头 fit 后不放大超过 maxScale。

### 3.7 i18n
- 新键 en/zh 全量成对,中文直接写大白话(08-03 口径);页名暂定「团队地图」,文案随 B1 出稿。

## 4. 交互细则(pan/zoom)

- 薄 wrapper 独立成文件,**参照 v01 `src/lite/LitePanZoom.tsx` 的墙合规先例**,只包
  react-zoom-pan-pinch(依赖已在 package.json),绝不 import story。
- wheel = 缩放(整页无纵向滚动,不存在 07-29 那类滚轮劫持面);双击禁用;提供「复位视野」按钮。
- 初始镜头:fit-width 顶锚可读帧(ADR-0012 修订 6 公式)。
- 手机:rzpp 原生 pinch/pan;逐视口冒烟(折叠线下是瞎区——born-red 按视口验)。
- 人数大时关逐节点入场动效(reduced-motion 路径现成)。

## 5. 大团队条款(Q5 照录)

1. 布局纯函数化验收写死:列数/board/项目列 x = f(分组,人数,项目数),零写死常量;
   **80 人合成租户 fixture** 跑通作验收。
2. zone 契约按「可收拢」设计:部门 zone 是有 id、聚合读数、成员清单的实体。
3. **B4 部门收拢态缓建**:calm 态部门卡(人数+定性读数+警报角标)、点击原位展开、
   开局帧对火情。触发条件 = 首个 40 人以上真租户;火情判据到 B4 kickoff 再定。
4. 不做虚拟化(近期市场无此租户;150 DOM 节点对 rzpp 无压力)。

## 6. 棒切分

- **B1 骨架**:路由+入口+薄 wrapper+布局公式+calm 渲染(真数据)+空态+i18n。
  验收:demo-seed 上图截图人眼过 · 80 人 fixture 不炸 · init.sh 绿。
- **B2 focus 机器**:点选/点空白/SvgEdge 连线/原位长大卡/详情跳转/`?focus=` 深链。
  验收:demo-seed 上「点小徐亮草坪婚宴」这类具名剧本逐条过。
- **B3 HUD-lite + 门**:搜索/chips/警报药丸;`verify-team-map.mjs` 进 ROSTER;
  像素基线(空态+数据态,setFixedTime 钉钟);`assertRoomCanvas` 改判作用域;逐视口 born-red。
- **B4(独立缓建票)**:部门收拢态,见 §5.3。

开票:一张父票(B1–B3 checklist)+ B4 独立票挂 blocked;gh issue 为正源,中文走
`gh api --input` JSON(防乱码)。

## 7. 门与验收细则(工程纪律,不需要拍)

- **assertRoomCanvas 改判**:`.react-transform-wrapper` 绝迹断言收窄到对话屏容器作用域,
  gate.md + snippet 同批改、跑死针探测(⚠ snippet 不在 `*verify-*.mjs` glob 里,改判扫描
  要点名带上它)。
- **verify-team-map** 判据(锚定 demo-seed):画布挂载 · pan 后 transform 真位移 ·
  分区数 = 花名册部门数 · 边数 = 带 owner 的项目数 · focus 点亮/复位 · 人卡区零数字
  (按显示宽度不按 .length)· 每条主判据配专属变异。
- 像素 spec 先合本地 main 再冻;基线在 main 上重量;新页判据不用带 self-healing 的共享驱动。
- 门语料天然全中文(demo-seed),en 侧用 80 人 fixture 补(防只中文盲点的反向)。

## 8. 风险

1. 9 个小部门的密度美感——公式对「多组少人」的形态要专门调,验收就锚在这(§3.2)。
2. CSS 从 story `10-dashboard-nexus.css` 摘选重作用域到 `.lite2-shell` 的工作量;
   严禁语义依赖 story-only 文件(它随 story 退役会断)。
3. 「缺了不编」贯穿:demo-seed 全字段齐容易惯坏布局,80 人 fixture 里要故意埋缺
   owner/status/progress 的实例(哨兵造出来,别等语料喂)。
