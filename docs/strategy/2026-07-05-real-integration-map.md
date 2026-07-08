# 真实集成图（现有页面/卡片 → live 真源）— 2026-07-05

> 回答 Danny 的问题："当前的 nodes 卡片、Your team 等页面**怎么从脚本换成真数据**"。
> 这是 [ADR-0020](../adr/0020-avery-graduates-from-demo-only-to-live-lite-product.md)（graduate + 两道 seam）+ [ADR-0021](../adr/0021-two-engine-core-vertical-packs-skins-dual-deploy.md)（两引擎）落到**每一个现有表面**的施工图，是 **feat-016（ingestion）+ feat-017（前端毕业）** 的必读。
> 数据形状引自 `src/data/fixtures.ts` + `src/data/fixtures.home.ts`（本 session 已通读）。

## 0 · 关键事实：demo 已经"演"了 ingestion

`src/data/fixtures.ts` 的 `ONBOARDING` 常量，脚本化地演的**就是 ingestion 引擎本身**：

```
上传 sampleFiles【Studio_Handbook.pdf · Smart_Shopping_Guide_Brief.docx · Team_Roster.csv · Demo_Roadmap.md】
  → connectPipeline【Names kept private · Tidied up · Checked for anything sensitive】  ← 红线安全三道工序
  → parsedInto【Studio profile · Team roster (14 people) · 7 active projects · Recent work signals】
  → capabilitiesMatched【Project Ops · HR playbooks】
```

**"真实集成" = 把 `OnboardingScene` 这段演的做成真的**，然后同一批解析出的实体流进 Your team / Nexus，**替换 `fixtures.ts` 里的写死常量**。不是新造，是把已经设计好的剧本接上真引擎。

## 1 · 锁定的三个取舍（2026-07-05，lite 版接不到实时数据处的决策）

- **R1 · Reality-gap / signals**（`MISMATCH`+`SIGNALS` 靠实时信号，lite 无 live 连接器）→ **混合**：live 做**文档内弱版 mismatch**（从上传的周报/文档抽"owner 自报 on-track 但文档显示 blocker/未解决评论"），story mode 保留**满血 signal-driven reality-gap** 做演示；满血 live 版等企业版连接器。
- **R2 · 聚合数字**（Briefing `health 82%`、Project `risk` 4维）→ **能真算的真算**（项目 `progress` 若上传文档有就抽），**算不出的聚合分 live 不显示**（红线 + 诚实：不编数字）。
- **R3 · v1 表面范围** → **核心五件 live + 弱版 gap**（见 §4）。

## 2 · 逐表面集成契约

| # | 现有表面（组件 / fixture） | 现在的脚本源 | live 真源 | 谁建 | 降级 / 🔴红线 |
|---|---|---|---|---|---|
| 1 | **Onboarding 上传**（`OnboardingScene` / `ONBOARDING`） | 假 sampleFiles + parsedInto | 真上传 → ingestion 真解析 | feat-016 | `connectPipeline` 三道安全 = 真红线过滤器 |
| 2 | **Your team 人卡**（`HomeScene` / `PEOPLE` + `homePersonRead`） | 定性 read + tone（写死） | ingestion 抽 `Person` + agent 生成定性 read | 016+017 | 🔴 `Person.moodPct`/`capacityPct` 数字字段 **live 永空** |
| 3 | **Your team 项目卡**（`PROJECTS`） | status/progress/risk（写死） | ingestion 抽 `Project` | 016+017 | 项目可硬（数字 OK）；`risk`4维+`reportedStatus` 需信号→lite 留空/story |
| 4 | **今日 Handoff checklist**（`HOME_HANDOFFS`） | 写死 4 卡 | agent 从公司 context 生成行动项 | 015+017 | 依赖信号→lite 弱（配 R1 弱版） |
| 5 | **Briefing 组织天气**（`BRIEFING_V1/V2`） | 写死（含 `health 82%`） | agent 生成 | 015+017 | 数字按 **R2**（真算或不显示） |
| 6 | **Nexus 终端流**（`NexusScene` / `cases.ts` stream） | 逐行写死 | feat-015 真 agent SSE | 015+017 | 直接换 `StreamSource` |
| 7 | **Manifest 8 字段卡**（`AGENT_OUTPUT`） | 写死 | 真 agent 输出（同 schema） | 015+017 | 已对齐；red-line validator 已在 loop |
| 8 | **Reality-gap「Worth a closer look」**（`MISMATCH`+`SIGNALS`） | 写死 | **R1 弱版**：文档内 mismatch；满血留 story | 016+017 | 🟡 最大降级点；指向人的信号停在"情境" |
| 9 | **in-thread Chat**（`HUMAN_LOOP`） | 多人对白（写死） | agent 发起真协同 | **v2** | 复杂多方，v1 不做 |
| 10 | **Team map calm/focus**（`PEOPLE/PROJECTS`+relations） | 写死 | 实体 + 关系抽取 | **v2** | 需关系抽取 |
| 11 | **详情页**（`Employee/ProjectDetailScene` / `fixtures.p3`） | phase 写死 | 实体 detail + follow-up | v1 只读实体 / follow-up 留 v2 | — |
| 12 | **Playbooks**（`CapabilitiesScene` / `CAPABILITIES`） | 写死 | 垂直包（feat-019） | 019 | 静态 per pack |

## 3 · 两条抽取/生成契约（seam 两侧的数据形）

**Ingestion 抽取契约**（feat-016 产出 → 喂 `TeamDataSource` live 实现）：
- `Person`：`id/name/role/team`（从简历/roster 抽）。**永不填** `moodPct`/`capacityPct`（🔴 红线：人不该有血条）。
- `Project`：`id/title/ownerId/status/progress?/dueDate?/summary/dependsOn?`（从项目文档抽）。`risk`4维、`reportedStatus`：lite 缺信号 → 留空或 story-only。
- `Signal`（lite）= **doc-derived 信号**：从上传文档抽（如"12 条未解决评论""验收未定"），`source` 标为文档来源。**指向人的信号（`subjectType:'person'`）停在"她在扛什么"（情境），绝不变成对人的负面标签**（🔴）。满血时间序列信号（"6 天连续"）= 企业版连接器。
- `Material`：公司资料片段 → 全向量 RAG（供 agent 引用）。

**Agent 生成契约**（feat-015 产出 → 喂 `StreamSource` + 卡）：
- `AGENT_OUTPUT`（8 字段）：真 agent 输出，schema 已对齐，red-line validator 已在 loop。
- `HOME_HANDOFFS`（今日 checklist）+ `BRIEFING`（组织天气，数字按 R2）+ `MISMATCH`（reality-gap，按 R1 弱版）：agent 从 company context（RAG）生成。

**Seam 接线**：
- `TeamDataSource`：story → `fixtures.home.ts`+`fixtures.ts`（`PEOPLE/PROJECTS`）；live → ingestion 实体 + agent 生成的 home reads/handoffs/briefing。
- `StreamSource`：story → `cases.ts` stream；live → feat-015 SSE。

## 4 · v1 范围（R3 = 核心五件 live + 弱版 gap）

- **v1 live 必达**：① Onboarding 真解析 ② Your team 人卡+项目卡 ③ Nexus 终端流 ④ 8 字段卡 ⑤ Briefing（定性 / R2 真算）。**+ 弱版 reality-gap（文档内）**。
- **story-only（保留满血演示）**：满血 signal-driven reality-gap（表 #8）。
- **v2（延后）**：多人 in-thread Chat（#9）、Team map 关系抽取+focus 簇（#10）、详情页 follow-up 深挖（#11）。

## 5 · 三颗红线地雷（feat-016 必须内建）

- 🔴 `Person.moodPct`(0–100 血条)+`capacityPct`：live 绝不从上传推。人卡只走 `homePersonRead` 定性、capture mode 剥数字 → live `Person` 这俩字段永空。
- 🔴 指向"人"的 `Signal`（`s_mentions`/`s_commits`→Lin Qing 型）：live 抽到人身信号停在情境（"她在扛一周变动反馈"），不可变成对人的评判。
- 🟡 Briefing/Project 聚合数字：R2 = 真算或不显示，绝不编。

## 6 · AFK 验证门（逐层）

- **ingestion（feat-016）**：fixture 文件电池 → 断言 `Person` **零数字字段**（红线）、`Project` 抽取、doc-derived `Signal` 抽取且人身信号停情境、RAG 命中。
- **frontend（feat-017）**：live 源打桩确定性 → DOM 断言表 #1–8 各卡渲染 + **红线扫描 live 产出零人评分/零 %** + **story mode 回归不退**（rail 26 拍）。
- **agent（feat-015）**：契约电池（8 字段 / cite / 红线）+ 真 API 冒烟。

## 7 · 指针
- 决策：[ADR-0020](../adr/0020-avery-graduates-from-demo-only-to-live-lite-product.md) · [ADR-0021](../adr/0021-two-engine-core-vertical-packs-skins-dual-deploy.md) · 战略 [roundtable](2026-07-05-dual-line-strategy-roundtable.md)
- 数据形：`src/data/fixtures.ts`（`PEOPLE/PROJECTS/SIGNALS/AGENT_OUTPUT/BRIEFING/MISMATCH/HUMAN_LOOP/ONBOARDING`）· `src/data/fixtures.home.ts`（`HOME_HANDOFFS/homePersonRead`）
- kickoff：`.issues/feat-016/kickoff.md`（ingestion）· `.issues/feat-017/kickoff.md`（前端毕业）
