# 04 · team 屏目录化

## What to build

team 屏两形态：空态=上传主位（现状不动）；有数据=她方目录形态——筛选 chip 行（组别一组恒在；情绪一组**仅开关开时渲染**）+ 3 列成员卡网格 + 小补传入口（上传部件**降位不卸载**，两分支都渲染）。成员卡解剖对齐她方结构（头像/姓名/职位·组别/focus 行/底部信息格），底部格两世界：开关开=负载数字+情绪定性+口径出处角标；开关关=定性格或整格收起——**关世界定性格只许来自非 self_report 字段（focus/职责），情绪词表词与口径角标关世界零出现**。chip 点选真过滤网格。**裁决（PRD C 节）：目录筛选 chip ≠ 横向比较结构**（ADR-0023 禁的是每人一行数值表/排序榜/跨人分数并列，按自述定性状态筛选不产生跨人分数并列）；落实：情绪 chip 行挂「按本人自述筛选」口径角标；筛选结果视图禁排序/禁计分徽章（组别计数徽章可，情绪计数徽章不可）。

引用 PRD User Stories：11（目录形态快速定位）、12（目录态保留补传入口）、16（开关关零数字世界在目录形态下同样成立）、18（并排观感当量）。

## 字段/接口决策

（PRD C 节）
- 无新后端；纯前端形态切换（team 屏满态分支重排，空态分支不动）。chip 筛选为前端派生：组别取 person 的 team 字段，判据 locale-free（吃 raw 键），成句下沉文案层。
- **DOM 锚点保活**：`.home-person-card`（AFK 门断言对象）、`.home-project-card`/`.home-project-status`/`.status-dot`（verify-status-truth 选卡依赖）、`.upload-panel`/`.upload-input` 两分支都渲染（AFK 上传相位靠它驱动，卸载=360s 假红；readSkinProbe 读 `.upload-panel` 圆角）。
- chip 结构对齐她方数值令牌（小字 semibold 圆角丸、选中深底白字——色值走我方令牌）；网格 3 列，响应式降列随既有断点体系；情绪 chip 组渲染条件= payload `scoring_enabled: true`（03 的 additive 键）。
- 文案全部 en.ts 新增+zh 增量脚本；chip 全中文 aria。

## Acceptance criteria

机器可验：
- [ ] cr-align-spec 新增 **stick 9** 行：team 屏 rect/count 探针照 stick 5 写法钉筛选 chip 行与 3 列网格；`SPEC_STICK=9` 绿。
- [ ] verify-status-truth 绿（项目卡/状态点选择器锚点保活的实证）。
- [ ] AFK 门 team/上传相位绿（两分支 `.upload-input` 都在；skin probe 读得到）。
- [ ] verify-home-skeleton 绿（不碰 home 骨架语义）。
- [ ] verify-aria-zh 绿（chip/补传入口全中文 aria）；verify-button-family 绿（chip 若为 button 挂 .lite-btn 族或进白名单）。
- [ ] e2e 探针：无痕/清键开页→上传主位；uploadFiles 喂种子→目录形态（chip 行+3 列网格+补传入口都在）；点组别 chip→网格只剩该组；开关开→情绪 chip 行带「按本人自述筛选」口径角标、筛选结果视图无排序/无情绪计数徽章；开关关→情绪 chip 组不渲染，且全屏「情绪词表词（如常/偏紧/吃紧）零出现」文本断言过。
- [ ] 扫雷正式跑无 NEW（D 系：chip 尺寸/焦点反馈）。
- [ ] 本片交付后把 run-battery.mjs 的 CURRENT_STICK 递增到本片 stick 号（9）。

需人眼：
- [ ] team 4 张像素按 runbook §1 统一口径片内处理（目检 diff→存证 pixel-evidence/04/→备份→重冻→像素门复绿）；目录形态与她方 /people 并排对照。

## 波及面与红线

既有门波及（门影响面摸底 B 节）：cr-align-spec（stick 9）、verify-status-truth（选择器）、AFK 上传相位+skin probe、verify-home-skeleton、verify-aria-zh、verify-button-family、扫雷 D 系、像素 team 4 张（若项目卡带也改壳另加 projects 张）。

红线（runbook §2）：上传部件降位不卸载；成员卡/项目卡 DOM 类名锚点保留；人面数字开关口径（情绪 chip 组仅开关开）；en.ts+zh 增量；AA 4.5；reduced-motion（如加入场动效）；00-base.css/story/lite 冻结面不碰。

## Blocked by

03（情绪 chip 组与底部格两世界依赖 scoring_enabled 开关口径落地）
