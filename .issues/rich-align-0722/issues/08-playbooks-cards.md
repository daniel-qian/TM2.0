# 08 · playbooks 方法库

## What to build

端到端：SOP 文档（07 语料的管理规范）→ ingest 管道抽取成方法卡 `{title, description, tags[]}` → playbooks 屏满态渲染 2 列网格方法卡（方形渐变图标+标题+描述+chips，结构对齐她方）；非 demo 空态维持 coming-soon 诚实标+现有槽位叙事；onboarding 勾选槽位断言迁移到新结构。**方法库无 CRUD**（只读，纯抽取产物）。

引用 PRD User Stories：14（SOP 抽成方法卡照卡执行）、26（空态诚实边界标注）。

## 字段/接口决策

（PRD D 节）
- **SOP 文档语法（PRD D 定稿，07 语料已按此写）**：`## 方法：标题` 小节 + `适用：…` + `要点：` 列表 + `标签：a、b、c` → 方法卡 `{title, description, tags[]}`。
- **数据通道**（实现时二选一定稿并记录）：payload 新增 optional `playbooks` 键，或独立只读端点 `GET /team/{ctx}/playbooks`；缺席=无方法卡，前端判空降级（仿 demoStatus optional 方法模式）。投影 None/空不发键。
- **渲染**：满态=2 列网格（全站唯一 2 列屏，网格/卡结构与数值令牌对齐她方，文本零抄）；**方法卡=非交互元素（div/article，不渲染 button）**——扫雷 D 系焦点断言因此免除；将来加详情展开再升 button；升级 onboarding 槽位为真卡时，**保留每个所选 id 一个带槽位 data 属性（data-playbook-id）的元素及 slot tag 类名锚点**（或同 commit 改对应 spec 行/门断言）；非 demo 空态 coming-soon 标+reopen 按钮不动。

## Acceptance criteria

机器可验：
- [ ] AFK 门 assertOnboardPersist 绿：`data-playbook-id` 元素集合与所选 id 集合相等，且每槽带 slot tag 类名。
- [ ] cr-align 既有 stick 4 硬行 badge.playbookTagWeight 绿（tag 类名 fontWeight=700 保活，或同 commit 改行并注明）。
- [ ] verify-onboarding-returning 绿（reopen onboarding 按钮恰 1 个）。
- [ ] cr-align-spec 新增 **stick 12** 行：满态 2 列网格 count/rect 护栏+卡结构 prop 行；`SPEC_STICK=12` 绿。
- [ ] e2e 探针：三亚 claim → 方法卡 3-6 张、title/tags 与 SOP 文档对得上；非 demo 新 context（无 SOP 文档）→ coming-soon 标+槽位现状；payload/端点缺席→判空降级无 console error。
- [ ] verify-button-family 绿（方法卡为非交互 div/article、不渲染 button，天然不进考察面）；verify-aria-zh、verify-contrast-smalltext、verify-p0 绿。
- [ ] 本片交付后把 run-battery.mjs 的 CURRENT_STICK 递增到本片 stick 号（12）。

需人眼：
- [ ] playbooks 4 张像素按 runbook §1 统一口径片内处理（目检 diff→存证 pixel-evidence/08/→备份→重冻→像素门复绿）；2 列网格与她方 /playbooks 并排对照。

## 波及面与红线

既有门波及（门影响面摸底 D 节）：AFK assertOnboardPersist、cr-align stick 4 硬行、verify-onboarding-returning、verify-button-family、verify-aria-zh、像素 playbooks 4 张、cr-align-spec（stick 12）。

红线（runbook §2）：方法库无 CRUD；非 demo 空态 coming-soon 诚实标不摘；ADR-0029 真管道；她方文本/源码零抄；en.ts+zh 增量；AA 4.5；reduced-motion（卡入场动效）。

陷阱：改 ingest/service 杀 8137 重起；onboard 槽位断言在 AFK 门不在 verify-onboard-gate（别改错门）。

## Blocked by

07（SOP 语料；通道代码可先行但满态验证依赖三亚 pack）
