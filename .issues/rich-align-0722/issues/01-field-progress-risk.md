# 01 · 富字段·进度/风险（项目）

## What to build

端到端垂直切片：文档按本片定稿语法写进度/风险行 → heuristic 抽取器认出 → 项目实体入库 → payload 投影（缺席不发键）→ 项目卡渲染进度条（进度槽既有，本片补齐与她方对齐的观感）+ 风险徽章（新）→ 详情浮层加环形进度与风险行；文档没写该字段 → 对应行整行收起（absent≠none），绝不显示 0%/默认值。用 1-2 份手写 mini 语料走 uploadFiles 配方证明「文档→抽取→payload→渲染」全链真通；禁任何 demo 注入/UI 写死（ADR-0029）。

引用 PRD User Stories：1（卡上进度条+百分比）、3（风险徽章）、4（详情环形进度与依据行，里程碑部分归 02）、5（absent 整行收起）、23（富字段走真管道）、24（薄文档诚实收起）。

## 字段/接口决策

**字段文档语法在此定稿（PRD A2 全表照录；里程碑行在 02 落地、自述行在 03 落地，语法一律以本表为准不再另立；语料与抽取器同稿共测）：**

| 字段 | 语法（行首锚定） | 归一规则 |
|---|---|---|
| 进度 | `进度：58%` / `完成度：58%`（沿用既有正则） | 仅收 0–100 有限数，0 合法；超界拒收不 clamp 成假值 |
| 风险 | `风险：高/雨季无备选场地`（等级/原因，`/` 或 `——` 分隔；原因可省） | 等级词表 高\|中\|低 + high\|medium\|low；词表外整行不抽。⚠️ 与既有 `风险点：`（→blockers）区分：长标签优先匹配，`风险：` 全匹配锚定 |
| 里程碑 | 标签行 `里程碑：` 后连续列表行 `- 名称（状态）` | 已完成→done、进行中→active、受阻→blocked、未开始→upcoming（+英文同义）；词表外走真 other：独立 other 点样式（非 upcoming 同款灰），照原样回显文档用词（与 status 的 other 同哲学——不替客户文档改写措辞） |
| 负载/情绪自述 | 周报「人员动态」段内 `- 小王｜负载自述：85%｜情绪自述：吃紧` | 只认带 `自述` 后缀的标签（口径=本人自述，出处=所在文档名）；无「自述」字样的人身数字一律不抽；情绪词表 如常\|偏紧\|吃紧；负载仅收 0–100 |

- **schema（PRD A1）**：项目实体加 `risk` 对象槽 `{level: high|medium|low, reason?}`；progress 沿用既有槽位。缺席不发键。
- **抽取**：heuristic 项目 span 解析加 `风险：` 行首锚定正则（长标签优先，防与既有 `风险点：`→blockers 串扰——PRD 已知张力①）；LLM prompt schema 同步加同一槽位，解析后仍过抽取红线门；两路抽出形状一致（合约测试考）。
- **投影**：project_cards 投影 None/空不发键；pg 侧实体整体 JSON 存储无需 DDL。
- **transport**：LiveProjectCard 加 optional `risk?` 键；前端派生走 rawTeam，optional 缺席=文档未提及，禁 `?? 默认`；进度仍经 progressOf 式校验（只收 0–100 有限数，0 合法）。
- **渲染**：卡面风险徽章色系只对齐她方数值令牌（soft 底+深文字 red/orange/green 系，dot 变体结构）；进度条 6px 圆角轨道+tone 填充结构对齐；详情环形进度（SVG 56/stroke 5 结构量级对齐）；文案全部自拟走 en.ts。

## Acceptance criteria

机器可验：
- [ ] cr-align-spec 新增 **stick 6** 行：projects 屏 count 行钉徽章/进度条数量护栏 + prop 行钉徽章字重/色；`SPEC_STICK=6` 跑 verify-cr-alignment 绿。
- [ ] verify-status-truth absent 分支照既有克隆配方加件（分别删 progress / risk 键）：无依据卡不渲染进度条与风险徽章（或渲染 `data-empty-kind="absent"` 的「文档未提及」措辞）；对照真值卡照常渲染；判据吃 raw 键不吃渲染文案。门绿。
- [ ] verify-p0 绿：缺 progress 的项目不吐「0%」（现有断言即栅栏）；console 零错误。
- [ ] verify-contrast-smalltext 绿（新徽章小字 AA 4.5）。
- [ ] e2e 探针脚本：uploadFiles 喂含 `进度：`/`风险：` 行的 mini md → payload 断言 progress 数值对、risk 键在且 level/reason 对；喂不含的 → 两键均缺席。
- [ ] 抽取合约/单测：heuristic 与 LLM 路径形状一致；`风险点：` 仍进 blockers 不串进 risk；超界进度拒收。
- [ ] 实现落地后，若正则实际接受面与本 issue 字段表有出入（全角/半角、分隔符、大小写），回填本文件字段表并标注，供 07 照写。
- [ ] 本片交付后把 run-battery.mjs 的 CURRENT_STICK 递增到本片 stick 号（6）。

需人眼：
- [ ] 与她方并排（对照板局部重拍）看徽章/进度条/环形观感当量；projects 4 张像素基线按 runbook §1 统一口径处理（片内目检 diff→存证 pixel-evidence/01/→备份旧基线→重冻→像素门复绿；Danny 晨审签认）。

## 波及面与红线

既有门波及（门影响面摸底 C 节）：verify-status-truth（absent 分支）、verify-p0（0% 断言+console）、cr-align-spec（stick 6 起号）、verify-contrast-smalltext（projects 在九屏清单）、像素基线 projects 4 张。

红线（runbook §2）：absent≠none（data-empty-kind 措辞不混）；判据吃 statusRaw/raw 键；富字段真管道（ADR-0029）；进度条/环形入场动画必包 `@media (prefers-reduced-motion: no-preference)` 媒体级隔离；她方文本/源码零抄（数值令牌可对齐）；en.ts 唯一文案源+zh 增量脚本；AA 4.5；00-base.css/story/lite 冻结面不碰；spec→门→码次序，禁反向抄构建值。

陷阱：改 service/*.py 杀 8137 重起才生效；电池独占跑。

## Blocked by

None
