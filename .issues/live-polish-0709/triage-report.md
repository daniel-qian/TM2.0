# S4 Triage — lite 缺失模块考古判定 + UI bug 4/5 即修（2026-07-09）

> 分支 `polish/s4-triage`（从 main `1f5a56a`）。使命见 `kickoff-s4.md`。
> 本报告回答 Danny 试玩反馈 1/2/3 的**「拍板排除 vs 开发遗漏」**，逐项给补齐方案选项，
> 结尾是**留给 Danny 的拍板清单**。UI bug 4/5 已 act-first 修掉，证据见 §3。
> 硬约束不变：🔴 人卡零数字；墙不打洞（方案里 lite 永不 import story）；eval-harness 只读；story 冻结资产不动。

---

## 0 · 一句话结论

**三项（Playbooks / team map / room 画板）全部是 2026-07-07 Danny 亲手拍板的 v1 范围排除（拍板排除），不是开发遗漏。** 双一手源互证：ADR-0022 决策 1（story/lite 分区）+ 救援计划 §0 岔口 2（v1 lite 范围），后者原文一行焊死：**「地图 / Playbooks / 多人 Chat / 满血 gap = story-only」**，且岔口表头注明「六岔口，2026-07-07，全部 Danny 亲拍」。三者在 story 侧都有满血实现、在 lite 侧被明确不搬——是「当初决定不做」，不是「想做但漏了」。

因此 1/2/3 的补齐 = **重开产品范围的新决定**（不是修 bug）。这正是 S4 只出 triage、把范围决定权交回 Danny 的原因。下面每项给「当初为什么没有」的实证 + 补齐选项（空态 / 轻建 / 移植 + 工作量 + 风险），Danny 拍板后 S5（feat-025）按拍板施工。

**关键重构（来自反馈 6/7）**：Danny 已明确 lite = **给国内融资团队的可展示/可试玩品**，未来 = **为公司量身定制的 custom agent 服务**。这把 1/2/3 从「用户要用的功能」重构为「展示未来能力边界的叙事表面」——直接影响补齐形态（空态文案应锚「未来能力」而非「当下可用」，诚实标 mock）。S5（模块补齐）与 S6（定位叙事/能力 mock）因此应绑在一起想。

---

## 1 · 考古方法与证据源

- **一手源（决定性）**：`docs/adr/0022-...md`（决策正文）· `.issues/live-rescue-0707/plan.md` §0 岔口表（Danny 亲拍记录）。
- **二手佐证**：`feature_list.json`（feat-019/024/025）· `progress.md` 2026-07-07/08/09 节 · 历史 handoff（`git show 4956824:` S1 / `git show 0723063:` S2）· 07-07/07-08 session transcript（`C:\Users\86139\.claude\projects\D--avery\*.jsonl`）。
- **story 侧实现盘点**（补齐「移植」选项的可行性依据）：见各模块 §「story 侧现状」。

---

## 2 · 逐项判定

### 2.1 Playbooks — 拍板排除（且已明确 defer v2）

**判定：拍板排除。** 证据：

- **救援计划 §0 岔口 2**（`.issues/live-rescue-0707/plan.md:15`，Danny 亲拍）：
  > `| 2 | v1 lite 范围 | 3 屏 + 薄详情 | 上传空态 · Your team · The room …；地图/Playbooks/多人 Chat/满血 gap = story-only |`
  Playbooks 与「地图/多人 Chat」并列，明确 **story-only**，不进 v1 lite。
- **救援计划 S3 收尾**（同文件 `:57`）：
  > `merge 后旧账重看：… feat-019 酒店包插 lite Playbooks 屏(v2)。`
  即 Playbooks 不是被忘了，是**被明确 defer 到 v2（feat-019 酒店包）**。
- **feature_list**：feat-024（lite 3 屏壳）description 无 Playbooks；feat-025 已把 Playbooks 登记为「待 S4 拍板后补齐」，且注明来源 = 「Danny 2026-07-09 试玩反馈」（= 上线后发现，非施工期遗漏）。

**story 侧现状**：`src/story/data/fixtures.p3.ts:870–984`（P3-04 Playbooks 页，scripted case 复盘内容），随 rail 回放机器（ADR-0012/0013/0014）冻结。注意：story 的 playbook = **脚本化的 case 复盘卡**，与 lite 未来定位（真数据 → agent 定制 SOP/playbook）不是同一个东西。

**Danny 07-09 原话**：「playbooks 在 lite 中也是必须的，可以先以空态形式显示。」→ 已给出补齐方向（至少空态）。

**补齐选项**：

| 方案 | 做法 | 工作量 | 风险 |
|---|---|---|---|
| **空态屏（推荐）** | lite 新增 Playbooks 屏（第 4 个 tab 或 Your team 内子区），空态卡讲清「未来 = 你的数据 → Avery 沉淀可复用 playbook/SOP」，诚实标 coming-soon | **S**（~半天，纯前端 + i18n） | 低。唯一要拿捏的是 lite 语境下「playbook 是什么」的重定义——应锚未来能力（与 S6 能力叙事同源），不是照抄 story 的 case 复盘 |
| 轻建（真数据派生） | 从 ingestion 派生 playbook 实体 | M–L | **高**：当前后端不产 playbook 实体，需改抽取——**撞 eval-harness 只读**。→ defer |
| 移植 story | 搬 fixtures.p3.ts 的 P3-04 | M | **否决**：scripted 内容与 lite 真数据定位冲突 + rail 纠缠 + 破墙 |

---

### 2.2 team map — 拍板排除（且 lite 无关系数据支撑真 map）

**判定：拍板排除。** 证据：

- **ADR-0022 决策 1**（`docs/adr/0022-...md:19`）：
  > `src/story/**：fixtures、cases、rail、满血场景(地图/多人 Chat/满血 reality-gap/剧场 NexusScene)。冻结为路演/视频资产`
  「地图」明列为 story-only 满血资产。
- **救援计划 §0 岔口 2**（同 2.1 引文）：「**地图** …= story-only」。
- **progress.md 2026-07-09**（`:295`）已初判「repo 证据初步指向 ADR-0022 …『地图/Playbooks/多人 Chat = story-only』」——本报告以一手源确证。

**story 侧现状**：`src/story/data/layout.ts`（~90 行二部图布局）+ `DashboardScene.tsx`，空间坐标由 rail 相机（ADR-0012）/ canvasStore（ADR-0013）驱动，冻结。story 的「team map」= **rail 驱动的空间关系图**。

**关键事实**：lite 的「Your team」是**人卡网格（flat grid）**，不是空间 map——这是拍板时的设计（3 屏薄壳）。而真空间 map 需要 person↔person / person↔project 的**关系边数据**；当前 ingestion 只产 person / project / signal 实体，**不产关系边**。要还原 story 那种 map，得先做关系抽取（后端，撞 eval-harness 只读）。

**补齐选项**：

| 方案 | 做法 | 工作量 | 风险 |
|---|---|---|---|
| **轻量分组视图（推荐）** | 不做空间 map；把「Your team」人卡按**部门/角色/项目归属聚类分组**（带分组容器 + 折叠）——顺带满足 Bug 4「people 需要列表分类、容器」的诉求 | **M**（~1 天，前端；分组维度来自已有 person.role / project ownership） | 中。需设计分组维度与空态；不引入新数据依赖，不破墙 |
| 空间关系 map | lite 内重建 pan/zoom 关系图 | **L** | **高**：需后端关系抽取（撞 eval-harness 只读）+ 引 pan/zoom + 设计世界坐标；融资展示品未必需要 |
| 移植 story | 搬 DashboardScene/layout.ts | M | **否决**：rail 冻结 + 空间坐标 + 破墙 |
| 维持现状 | 不动 | 0 | 低——若 Danny 认为人卡网格已够表达团队结构 |

---

### 2.3 the room 画板（拖拽/缩放）— 拍板排除（明确「不搬 1400 行剧场」）

**判定：拍板排除。** 证据：

- **ADR-0022 决策 1**（`docs/adr/0022-...md:20`）：
  > `src/lite/**：… The room 薄建(live SSE 控制台 + 8 字段卡)，不搬 1400 行剧场 NexusScene。`
  lite 的 room 被明确定为「薄建」，**明确不搬**含画板的剧场 NexusScene。
- **救援计划 S2**（`.issues/live-rescue-0707/plan.md:48`）：
  > `The room 薄建(live SSE 控制台+8 字段卡，不搬剧场 NexusScene)。`
  同一决定的施工侧复述。
- 代码印证：`src/lite/screens/RoomScreen.tsx:7–9` 注释即写「不搬 1400 行剧场 NexusScene：无 PanZoom 板、无 rail、无 case 编排」。

**story 侧现状**：
- `src/story/components/scenes/NexusScene.tsx`（**1629 行**）+ `src/story/components/PanZoomCanvas.tsx`（**41 行**）。
- **可行性关键**：`PanZoomCanvas` 只是薄壳，包的是 `react-zoom-pan-pinch`——**npm 依赖，已在 `package.json`，非 story 私有资产**。pan/zoom 机制本身不依赖 rail；纠缠在 NexusScene 的节点/连线/相机/board 世界坐标（rail 侧）。

**补齐选项**：

| 方案 | 做法 | 工作量 | 风险 |
|---|---|---|---|
| **轻建可拖拽画布（推荐，若要画板体验）** | 把 `PanZoomCanvas` 这 41 行薄壳**提进 `src/shared/`**（或 lite 内直接用 `react-zoom-pan-pinch` npm 依赖重建），lite room 加一层薄可拖拽/缩放画布，容纳现有 8 字段卡 + 终端 | **M**（~1–1.5 天：画布布局 + world 坐标 + 移动端手势取舍） | 中：给 lite 增交互复杂度；但依赖已在、**不增 bundle、不破墙**（走 shared/npm，不 import story） |
| 维持薄建 + 说明 | 不加画板，room 顶加一句「画板视图 = 路演版能力，lite 走信息流」 | S | 低——若画板只是「展示丰富度」而非产品必需 |
| 整搬 NexusScene | 搬 1629 行剧场 | L | **否决**：破墙 + 破 rail（ADR-0012/0013/0014 冻结）+ 定位不符 |

---

## 3 · UI bug 4/5 即修（act-first，已修，不等拍板）

> 硬约束遵守：两修全部落 `src/lite/styles/lite.css`、**`.lite-shell` 作用域**，story 壳（`.app-shell` 无 `.lite-shell`）物理够不到 → story 冻结资产一像素不动；无全局选择器、无墙洞。

### Bug 5 — Story/Live 按钮风格丢失（`按钮风格丢失.png`）

- **根因（已证伪「拆 chunk cascade 漂移」假设）**：`.mode-switch-btn` 由 **feat-017（`fae493f`，WIP 被 session limit 截断）** 引入却从未配 CSS。查拆分前 `global.css`（`git show 4956824:src/styles/global.css`）与拆分后所有 chunk：**都只有 `.mode-switch` 的 `pointer-events`，从无按钮样式**。故 Story/Live 一直是浏览器默认 `<button>`（灰边框），feat-024 lite 顶栏首次把它摆到右上显著位而暴露。**不是 feat-024 拆 chunk 造成的 cascade 断差。**
- **修法**：在 `lite.css` 补齐 `.lite-shell .mode-switch`（药丸容器）+ `.lite-shell .mode-switch-btn`（与 `.scene-tab` 同款：透明 → hover 淡底 → `.is-active` ink 底/paper 字 + focus-visible 描边）。
- **验证**（计算样式，`preview_inspect`/`eval`）：`.mode-switch` = `display:flex` + `border-radius:999px` + rule 边框 + paper 底 + soft shadow；`Live`（active）按钮 `background:rgb(29,27,23)`（ink）/ `color:rgb(247,244,238)`（paper）；`Story` 按钮透明。与 `.scene-tabs`/`.scene-tab` 视觉一致。✅
- **注**：story 顶栏（`Topbar.tsx`）复用同一 `.mode-switch-btn`，有**同一裸奔 bug**；本次**刻意不修 story**（冻结路演资产外观稳定优先）。是否也修 story → 见拍板清单 Q5。

### Bug 4 — 首页 people 撑爆页面高度（`首页UI bug.png`）

- **根因**：真 ingestion 下 people 可达 20+，`.home-lane-people` 是 `auto-fill` grid **无高度上限**，右列（连同外层 `.home-scroll`）被撑到很高，projects 栏被推到很深的滚动位（Danny 批注：「people 数量一多就撑爆页面高度，需要自己的列表分类、容器，限制高度」）。
- **修法**：`.lite-shell .home-lane-people` 加**有界滚动容器**——`max-height: min(52vh, 520px)` + `overflow-y:auto`，people 栏内部自滚，projects 栏立即可达、整页高度回收。`.home-lane-people` 是 shared 类（story `HomeScene.tsx` 也用且冻结），故 `.lite-shell` 作用域隔离。padding/负 margin 抵消保证人栏与 projects 栏外缘对齐、给卡片 focus 描边留呼吸。
- **不破 gate**：门 snippet 用 `querySelectorAll('.home-person-card')` + 程序化 `card.click()`，卡片滚出视口仍在 DOM → 相位 C 人数断言、相位 E 点 Lin Qing 详情均不受影响（已复核 snippet 逻辑）。
- **验证**：见 §4 六相位门（相位 C 真渲染 20+ 人卡时复测 `max-height` 生效 + `scrollHeight > clientHeight`）。
- **备注**：Danny 还提「people 需要**列表分类**」——分类（按部门/项目分组）是比「限高」更大的诉求，与 §2.2 team map 的「轻量分组视图」是同一件事，建议合并到 S5 做（本次 bug fix 只做「限高自滚」这一必须项）。

### 收盘门（本 session code fix 的完工证据）
- `./init.sh`（lint + typecheck + build）：见 §4。
- 六相位 live 前端门（真后端 + 真上传 + 真 DOM）：见 §4（含 Bug 4 真数据复测）。
- story 未受影响校验：见 §4（`.lite-shell` 在 story 下匹配 0 + story 壳渲染正常）。

---

## 4 · 门证据（2026-07-09 实跑，真后端 :8137 minimax + dashscope + llm:minimax）

**六相位 live 前端门 — verdict `pass:true`**（真上传两 tracked seed → 真 POST /ingest → 真 /advise SSE）：
```
{"emptyStateClean":true,"ingested":true,"teamRendered":true,"postUploadClean":true,"detailIsLive":true,"composerIsLive":true} :: PASS=true
```
- A 空态渗漏 0；B ingest pass（两 sourceChips：xlsx + pdf，POST /ingest 200）；
- C **30 人卡**含 Lin Qing/Chen Mingyuan、零血条；D 上传后渗漏 0；
- E 点 Lin Qing 详情 opened/showsName true、零 Unknown（且证明 Bug 4 限高后滚出视口的卡仍可点）；
- F1 composer 无 story 预填（placeholder «Ask about your team…»）；F2 **33 帧 SSE 到 DOM + manifest + 8 字段卡**、零 liveError。

**Bug 4 真数据复测**（相位 C 时 30 人卡实测 `.home-lane-people`）：
```
maxHeight 374.4px (=52vh<520 上限) · overflowY auto · clientHeight 372 · scrollHeight 1020 · isBounded true
```
→ 1020px 内容裁进 372px 有界自滚容器（修前会撑满 1020px 顶页）。✅

**Bug 5 计算样式复测**（`?mode=live` 顶栏）：
```
.mode-switch  → display:flex · border-radius:999px · border 1px rule · bg paper(0.78) · box-shadow soft
.mode-switch-btn(Live/active) → bg rgb(29,27,23)=ink · color rgb(247,244,238)=paper
.mode-switch-btn(Story) → bg transparent
```
→ 与 `.scene-tabs`/`.scene-tab` 药丸视觉一致。✅

**story 未受影响校验**（`?mode=story`，替代 29 步驱动器；理由：改动全在 `.lite-shell` 作用域，story 壳 `.app-shell` 不带该类 → 物理够不到）：
```
mode:story · liteShellCount:0 · appShellClass:"app-shell" · scene:onboarding ·
hasTopbar:true · activeScene:"scene scene-onboarding is-active" · demoControls:true ·
storyModeSwitchBg: rgba(0,0,0,0)  (story mode-switch 仍原裸奔态 = 未被 lite 修触及)
```
→ `.lite-shell` 在 story 下匹配 **0** 元素、story 壳正常渲染、story mode-switch 外观零变化。✅

**init.sh**（lint + typecheck + build）：exit 0（build 459 模块，story 资产哈希不变——仅追加 lite.css，CSS chunk 未动）。

> 截图工具（preview_screenshot）本 session 持续 30s 超时（渲染器环境问题，无 console error、DOM 健康）；按 preview 指南，样式验证以 `preview_inspect`/`eval` 计算值为准（比截图更精确），故本节以计算样式 + DOM 度量为证。

---

## 5 · 留给 Danny 的拍板清单（每题带推荐项）

> 阻塞 S5（feat-025）的就是 Q1–Q3 的补齐范围。Q4/Q5 是方向/授权。

**Q1 · Playbooks 补齐范围？**
- **(a) 空态屏〔推荐〕**：lite 新增 Playbooks 屏，空态文案锚「未来 = 你的数据 → Avery 沉淀 playbook/SOP」，标 coming-soon（与 S6 能力叙事同源）。工作量 S，不移植 story。
- (b) 轻建真数据派生：撞 eval-harness 只读，需后端改抽取——不建议本波做。
- (c) 维持现状不补。

**Q2 · team map 形态？**
- **(a) 轻量分组视图〔推荐〕**：不还原 story 空间 map；把 Your team 人卡按部门/项目归属聚类分组，**顺带解决 Bug 4 的「列表分类」诉求**。工作量 M，不破墙、不加数据依赖。
- (b) 空间关系 map：需后端关系抽取（撞 eval-harness 只读）+ 引 pan/zoom，重；融资展示品未必需要。
- (c) 维持人卡网格现状（若认为已够表达团队结构）。

**Q3 · the room 画板补齐？**
- **(a) 轻建可拖拽画布〔推荐，若要画板体验〕**：`PanZoomCanvas`（41 行，npm 依赖）提进 `shared`，lite room 加薄可拖拽/缩放画布容纳 8 字段卡/终端。工作量 M，不搬 NexusScene、不破墙。
- (b) 维持薄建 + 一句说明（若画板只是路演视觉丰富度、非产品必需）。
- (c) 整搬 story NexusScene：**否决**（破墙破 rail）。

**Q4 · 三模块的产品语气锚点？**（据反馈 6/7）
- **〔推荐〕** 三者都以「展示未来 custom-agent 能力」的叙事框定（而非当下可用功能），诚实标 mock / coming-soon，把 S5（模块补齐）与 S6（定位叙事 + 能力边界 mock）绑在一起做。
- 备选：先做纯功能补齐、叙事留 S6 单独处理。

**Q5 · story 顶栏同款 mode-switch bug 是否也修？**
- **〔推荐〕** 维持 story 冻结不动（路演/视频资产外观稳定优先）；Bug 5 只修了 lite。
- 备选：Danny 若要 story 顶栏也修，单独授权一行 CSS（把 mode-switch 样式提进 shared/00-base.css，同时影响两壳）。

---

## 6 · 收盘动作（本报告落库后）

- feat-025 description 按本判定补细（Playbooks 空态必做 / team map 分组视图 / room 轻建，均待 Q1–Q3 拍板）；feat-026 description 补入「三模块叙事应锚未来能力」的 Q4 线索。状态维持 not-started。
- Bug 4/5 修复 + 本报告 + progress.md 收盘节入库；code fix 可直接 PR/merge main（小步），triage 报告随行。
