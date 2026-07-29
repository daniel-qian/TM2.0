# ADR-0031 · 大白话命名 pass：抽象词族退役，企业白话上岗（v02 全词表）

- 日期：2026-07-29
- 状态：已定（Danny 逐词审字通过，AskUserQuestion 记录在 07-29 session；词表提案全条采纳）
- 前情：ADR-0015（去-SaaS 命名 pass，命名总开关）→ ADR-0018（红线测试②③降级，人情味退为红线）
  → ADR-0025（「指挥室」解锁，主+副小字机制）。本 ADR 是对 0015 命名路线的**第三次松绑**。

## 决策

**用户面命名从「抽象/文艺」整体切换到「企业大白话」**，首发词表一次改齐，之后按用户反馈微调。
判据变化：不再要求命名传递「资深前辈的人味」，只要求 ①一眼看懂（酒店经理/老板级用户零解释成本）
②不刺痛（ADR-0018 人情味红线仍是永久否决项，一字未松）。

依据（07-29 酒店经理 persona check，`.issues/feedback-0729/persona-review-0729.md`）：
抽象命名在真实用户动线里是理解税——「多看一眼/议事室/未来方向」需要学习，
「值得注意/问 Avery/完整版预告」不需要。

### tab 词表（9 个，5 改 4 留）

| # | 旧（zh/en） | 新（zh/en） |
|---|---|---|
| 1 | 指挥室·今天 / Command room·Today | **今天 / Today**（副小字取消，0725 的主+副机制在 home 位退役） |
| 2 | 你的团队 / Your team | **团队 / Team** |
| 3 | 项目 / Projects | 不变 |
| 4 | 议事室 / The room | **问 Avery / Ask Avery**（与悬浮入口同名=一处心智；「快问」仍专指向员工收自述，不混用） |
| 5 | 待办清单·跟进 / To-do list·Follow-ups | 不变 |
| 6 | Avery 的笔记 / Avery's notes | 不变（拟人=产品人格，非抽象词） |
| 7 | 多看一眼 / A closer look | **值得注意 / Worth noting**（保护性命名判据复核过：点名下属看到不刺痛） |
| 8 | 操作手册 / Playbooks | 不变 |
| 9 | 未来方向 / Where this goes | **完整版预告 / What's coming** |

### 屏内词族

实录笔记→**观察记录**/Notes · 今天值得你留意→**今日提醒**/Today's reminders ·
文件自己对不上的地方→**资料对不上的地方**/Where the documents disagree ·
它看到了什么→**Avery 的分析**/Avery's analysis · 它是怎么想明白的→**分析过程**/How Avery got here ·
凭什么这么判→**判断依据**/The reasoning · Avery 手上有什么→**资料概览**/What Avery has ·
值得再看一眼（detailBlockers）→**值得注意**/Worth noting ·
「the room/议事室/屋子」的全部散文指代→落在 **Avery** 本人身上（含 3 处「会议室」误译顺手归一）。

### 动作词统一（persona check P5）

「加到跟进 / 加入跟进 / 加到待办」三名并存 → 一律 **「加到待办」/ Add to to-dos**
（与 tab 主名「待办清单」对齐）。「跟进/Follow-ups」保留为领域概念与副小字。

### 刻意保留

- **文件里反复提到的人**：不改「重点关注的人」——后者有监控感，原句把归因交给文件，更不刺痛。
- **暖纸/极光**（皮肤名）：仅设置菜单可见，低风险，本轮不动。
- **散文里的「你的团队/your team」**：指用户的团队本体（非 tab 指代）的一律不动。

## 不变的约束

- `Nexus`、「现实差距」维持锁定（verify-p0 黑名单硬闸原样）。
- ADR-0018 人情味红线（被点名者不刺痛）仍是任何表面的永久否决项——本轮每个新词过了一遍。
- en.ts 唯一文案源；zh 本轮为**审定词替换**（Danny 逐词审字，导演手改，未过 M3），
  生成器锁定词族已同步（`scripts/i18n-zh-lite2-delta.mjs` 铁律 4），未来 delta 重跑不会复活旧词。
- **v01（lite 段）冻结壳一字未动**，保留旧词——v01/v02 词表自此有意分叉，v01 不再维护措辞一致性。

## 机械联动（同 commit）

LiteTopbar tabs 数组（home 去 sub）· `assertV2Boots` expected/expectedSubs ·
verify-switchers 四处字面量 + **选择器修复**（`.scene-tab .scene-tab-main` 是全局首匹配，
home 去 sub 后会误读到待办清单 tab，改为首 tab 作用域）· verify-handoffs-empty-honesty 断言词 ·
live-frontend-gate `_clickTab` 全部英文字面量 · CONTEXT.md 三处 surface label。
