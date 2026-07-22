# 02 · 富字段·里程碑

## What to build

端到端：文档按 01 定稿语法写 `里程碑：` 标签行+连续列表行 → 抽取器解析为列表结构（名称+状态四态）→ 实体/投影/transport → 项目卡渲染里程碑圆点串 chips（点色随状态）→ 详情浮层里程碑清单（圆点+名称+右对齐状态字）与分段总览条；文档没写 → 卡上 chips 行与详情段整体收起（absent≠none）。mini 语料 e2e 证明真管道。

引用 PRD User Stories：2（卡上里程碑圆点串）、4（详情里程碑清单与分段总览条）、5（absent 收起）、23（真管道）。

## 字段/接口决策

- **schema（PRD A1）**：项目实体加 `milestones` 列表，每项 `{name, status}`，status 归一词表 done/active/blocked/upcoming；词表外走真 other——status=other + 保留状态原文，渲染独立 other 点样式（非 upcoming 同款灰），照原样回显文档用词（与 status 的 other 同哲学——不替客户文档改写措辞）。空列表/缺席不发键。
- **语法（01 定稿表第 3 行，不另立）**：标签行 `里程碑：` 后连续列表行 `- 名称（状态）`；状态词表 已完成→done、进行中→active、受阻→blocked、未开始→upcoming（+英文同义）。
- **抽取**：heuristic 新增「标签行+连续列表行」多行解析（列表断行或撞到下一标签行即止，别把后续标签吞进列表）；LLM prompt schema 同步；仍过抽取红线门；两路形状一致（合约测试考）。
- **transport**：LiveProjectCard 加 optional `milestones?`；派生走 rawTeam、缺席=未提及、禁 `?? 默认`。
- **渲染**：卡内 chips = 小圆点+小字名称，点色 done→绿 / active→蓝 / blocked→红 / upcoming→线灰 / other→独立 other 点样式（数值令牌对齐她方，文本自拟）；详情=清单行（圆点+名称+状态字右对齐）+ 分段总览条（每段等分按状态着色）；行入场 stagger 动画包 reduced-motion。

## Acceptance criteria

机器可验：
- [ ] cr-align-spec 新增 **stick 7** 行：projects 卡 chips count 护栏 + prop 行钉点色/字号；`SPEC_STICK=7` 绿。
- [ ] verify-status-truth 加克隆件（删 milestones 键）：无里程碑卡不渲染 chips 行与详情段（或 absent 措辞）；真值卡照常；判据吃 raw 键。门绿。
- [ ] e2e 探针：mini md 含里程碑块 → payload 列表长度/状态归一对；词表外状态 → other 样式点+文档用词原样回显（非 upcoming 灰点、不改写措辞）；无块 → 键缺席。
- [ ] 抽取单测：多行解析在「列表后紧跟下一标签行」样例上不吞行；heuristic/LLM 形状一致。
- [ ] verify-contrast-smalltext 绿（chips 小字若灰压不住 AA 用达标灰 #4d5568 系）。
- [ ] verify-p0 绿（console 零错误）。
- [ ] 实现落地后，若正则实际接受面与本 issue 字段表（01 定稿表）有出入（全角/半角、分隔符、大小写），回填 01 字段表并标注，供 07 照写。
- [ ] 本片交付后把 run-battery.mjs 的 CURRENT_STICK 递增到本片 stick 号（7）。

需人眼：
- [ ] chips/分段总览条与她方并排对照；projects 像素按 runbook §1 统一口径片内处理（目检存证→重冻→复绿）。

## 波及面与红线

既有门波及：verify-status-truth、cr-align-spec（stick 7）、verify-contrast-smalltext、verify-p0、像素 projects 4 张。

红线（runbook §2）：absent≠none；ADR-0029 真管道；reduced-motion 媒体级隔离；她方文本零抄；en.ts 唯一文案源+zh 增量脚本；AA 4.5；判据吃 raw。

陷阱：多行解析的边界（下一标签行/空行）；改 service/*.py 杀 8137 重起。

## Blocked by

01（语法定稿表+风险槽同文件改动的落地注释）
