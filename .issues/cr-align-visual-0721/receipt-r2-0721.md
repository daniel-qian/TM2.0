# cr-align 视觉战役 棒2 收据 · 2026-07-21

**一句话**：壳结构对齐落地——悬浮胶囊玻璃 slab 顶栏（tabs 左/铃齿轮右/白色活动 pill）+
全局让位统一成 `--lite2-clear-top` 一变量九消费者 + aurora 100px 模糊背幕；
门字面量同 commit 从 spec 誊换（5 项），旧构建红证明在案；**规格进度 8/22 → 15/22 绿**。

## 改动面（零 TSX，纯 CSS + 门）

| 处 | 内容 |
|---|---|
| lite2.css 棒2 段（尾部追加） | `--lite2-clear-top:96px`（≤860 降 72）+ 九 frame `padding-top: var()`（含撤掉棒1 的 84px 写死值，其块已标 superseded）+ Room canvas top 变量化（右20/底92 composer 带原值）+ 内滚容器 scroll-padding-top:120px + ≥861 媒体作用域的胶囊几何（fixed top14 居中 `min(1480,100vw-48)` r16、tabs margin-right:auto 推右簇）|
| look-aurora.css ⑫⑬ 段 | 新 token `--lite2-glass-border`/`--lite2-radius-lg:16px`；slab 玻璃（glass 底+blur20+border+软影，pointer-events 收回 auto——玻璃下滚过的内容不该被隔着毛玻璃点到）；.scene-tabs 去 pill 化（branch ① 被后写覆盖，仅 ≥861）；tab r9px、活动=白 pill+ink+软影、hover surface-soft；`::before` 100px 背幕（blur24 saturate1.2 + mask 渐隐，z 序 footer30<背幕40<顶栏50，零新 DOM）|
| live-frontend-gate.snippet.js | readSkinProbe 增读 topbar 四值；assertAuroraApplied 换 5 字面量（tabsGlass*/Blur/Shadow→topbar* + topbarRadiusIsSlab + activeTabIsNavy→White），注释注明 spec→门→码来源 |
| verify-skin-phases.mjs（新工具） | E 组皮相位固化成可跑门（此前是手册协议）：aurora 13 断言 + paper 逐字节 + v01/story 零泄漏，进常备电池 |

## 红→绿全记录

- **旧构建红证明**：改后门对棒1 构建跑 → aurora 组 5 红（topbar 无玻璃/无圆角/活动 tab 还是 navy），
  正是旧世界的形状 → 棒2 构建后 16/16 绿。
- **意外收获——陈旧基线漂移被逮**：paper 的 playbookTagColor 偏离 PAPER_BASELINE
  （145,139,127→115,108,95）。溯源=feat-068（07-20）把 paper `--ink-faint` #918b7f→#736c5f
  修小字 AA 的合法连带（look-paper.css 注释在案），E 组相位自 feat-046 后无人跑过、基线一直陈旧。
  基线补采 + 注释记档（非本棒改动；本棒 paper 数值零动）。**工具固化的即时回报**：
  手册协议跑不勤，固化成门第一跑就逮到两天前的漂移。
- verify-topbar-clearance 穿越几何巨变保持 22/0（设计回报：门管类，几何随便改）。
- verify-cr-alignment SPEC_STICK=2：stick-2 八行全部红→绿，硬断言 13/13；全量进度 15/22
  （剩 7 行=棒3 字阶/表面 + 棒4 组件族）。
- verify-switchers 23/0（设置弹层锚点活过 slab 化）。
- sweep 全矩阵：**NEW 0 / REGRESSION 0**（壳大改零新伤；44 件 known-open 原样归棒4）。
- 像素基线：36 张全 diff（有意的结构变更）→ 复核目检图后 `--update-snapshots` 重定 → 复验 4/4 绿。

## 目检（eval-harness/reports/shell-shots-0721/，gitignored）

aurora：整条玻璃 slab、白色活动 pill、滚动内容在背幕下渐隐（她的 mask 配方）；
paper：暖纸配色原样骑新几何（暖白 tabs 胶囊靠左、墨色活动块）——「paper 跟结构走守自己配色」实拍。

## 刻意不做 / 留后

- 页脚仍是全宽贴底条（硬套 `--lite2-frame-w` 会半生不熟）——归 footer 整体重塑（棒3/7 段）。
- ≤860 sticky 竖排模式一字未碰（含 aurora 移动端顶栏暖纸底的历史小怪——非本棒引入，记观察）。
- 铃/登录/齿轮在 slab 上仍是玻璃小钮（glass-on-glass）——她的是裸图标钮，归组件族棒微调。

## 回归电池（22 门）

21 绿 + visual-baseline 电池中段一次红（dist 被 auth 门中途调包的既知模式，第三次实证）——
终局 dev 重建后 visual 4/4（36 张）+ clearance 22/0 + skin-phases 16/16 复验绿 = 实质 22/22。

## 生产验证（averylite.dannyqian.com · commit 0853e12）

本地 Playwright 直拍生产（新访客→Escape 门→首页）：玻璃 slab 顶栏上线（tabs 左、白色活动
pill「指挥室/今天」、铃+登录+齿轮右簇）；计算值四联全中——top **14px** / radius **16px** /
width **1392px**（=min(1480,1440-48)）/ backdrop **blur(20px) saturate(1.1)** / 首页让位
**96px**。滚动背幕渐隐实拍在 `eval-harness/reports/prod-shots-0721-r2/`（gitignored）。
