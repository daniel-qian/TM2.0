# 我方九屏现状实机侦察（2026-07-22，:5173 preview，`?v=2&mode=live&lang=zh`，已进示例团队）

> 取证：逐个点 `.scene-tab`，读 `.scene.is-active` 内的 `max-width` / `grid-template-columns` 计算值。
> 环境：paper 皮（默认）；示例团队规模很小 —— **2 人 / 1 个项目 / 2 份文件 / 1 条笔记 / 0 条待跟进**。

## 现状总表

| # | tab | 根 class | 内容框 max-width | 现有栅格（计算值） |
|---|---|---|---|---|
| 1 | 指挥室/今天 | `scene lite-home` | **`.lite-home-frame` 860px** | `.lite-home-row` **385px + 385px** gap 18px；`.lite-home-counts` **5×142px** gap 10px |
| 2 | 你的团队 | `scene scene-home` | **`.home-frame` 1460px** | home-frame 单列 912px gap 30；`.home-lane-people` **4×220.5** gap10；`.home-lane-projects` **3×297.3** gap10 |
| 3 | 项目 | `scene scene-nexus lite-projects` | `.lite-projects-frame` **980px** | `.lite-projects-grid` **3×291.7** gap 12px |
| 4 | 议事室 | `scene scene-nexus lite-room` | `.lite-room-chip-row` 640px | — |
| 5 | 待办清单/跟进 | `scene scene-nexus lite-followups` | `.lite-followups-frame` **760px** | — |
| 6 | Avery 的笔记 | `scene scene-nexus lite-notes` | （只有 lede 有约束） | — |
| 7 | 多看一眼 | `scene scene-nexus lite-closerlook` | `.lite-closerlook-frame` **760px** | — |
| 8 | 操作手册 | `scene scene-nexus lite-playbooks` | （无 max-width 约束） | — |
| 9 | 未来方向 | `scene scene-nexus lite-vision` | （只有 lede） | `.lite-vision-mock-grid` **2×413.5** gap 14px |

## ⭐ 主页现状区块清单（heading 顺序）

1. 今天要决策的（共 1 条 · 议事室 →）——决策卡（高风险 / 营销部本周周报 / 判据 / 三按钮）
2. 今日待办（待办清单 →）——空态「今天还没有排队的事项。」
3. **文件自己对不上的地方**（多看一眼 →）——空态「现在没有自相矛盾的地方。」→ **＝她的「报告 VS. 现实」面板**
4. **文件里反复提到的人**（你的团队 →）——空态「现在文件没有特别指向某个人。」→ **＝她的「需要关注的成员」面板**
5. **Avery 手上有什么** —— `2 人 / 1 个项目 / 2 份文件已读 / 1 条笔记 / 0 条待跟进`

### 三条关键结论（直接决定分棒难度）

- **① 首批四件里的两个右栏面板，DOM 已存在**（区块 3、4），且已经在一个 `.lite-home-row` 385+385 双列里。
  本战役不是「新建面板」，是**把 860 框放宽到 1480 外夹 + 改成 1.55fr/1fr 主次双栏**，把这两块从「正文中段双列」提到「右栏纵向堆叠」。工作量比预期低。
- **② KPI 真数卡已经有数据 + 已经有 5 列栅格**（`.lite-home-counts` 5×142）。
  五个计数 `人 / 项目 / 文件已读 / 笔记 / 待跟进` **正好补满她的五卡位**，且全是诚实计数。
  → 棒D 是**改样式**（卡壳 p-4 + border + `text-[25px] font-extrabold tabular` 数值 + `11.5px uppercase tracking-wider` 标签），不是造数据。
  → 她的第五卡「未解决差距」我方对应「待跟进」；她前四张率值卡（营收 58%/转化 66%/投诉 4.2%/负载 72%）**全部不做**。
- **③ 「你的团队」屏跑的是 `.scene-home`（1460px 框 + upload panel + people/projects 双 lane）**，
  与其余八屏的 `.scene-nexus` 体系不同 —— ⚠️ 这屏的 IA 归属要在棒E 前先查清（是否 v01 组件复用），
  否则「对齐 /people 三列人卡网格」会改错文件。

## 空态覆盖情况（验收手册要写触发路径）

| 屏 | 现空态文案 |
|---|---|
| 主页·今日待办 | 今天还没有排队的事项。决策、议事室、「多看一眼」里冒出来的待办，都会落到这里。 |
| 主页·对不上的地方 | 现在没有自相矛盾的地方。 |
| 主页·反复提到的人 | 现在文件没有特别指向某个人。 |
| 多看一眼 | 现在没什么要多看一眼的 |
| 议事室 | 把眼前的事带进议事室 |
| 操作手册 | 操作手册从团队已有的工作方式中生长出来 |

⚠️ **示例团队（2 人/1 项目）太瘦，右栏两个面板都是空态**。
→ 验收手册必须给**第二条人测路径**：上传 seed 材料（`eval-harness/tests/fixtures/seed/` 的
`LogiPulse-Roadmap.pdf` + `PrismDesign_TeamProfile_EN.xlsx`）把面板喂出真内容，
否则 Danny 只能看到空态、验不了「真部件」。

## store 真值面（`window.__lite2Store` 现场取）

state 字段：`transport / ingestStatus / ingestError / team / contextId / ownerToken / rawTeam /
files / notes / noteJustAdded / restoring / restoreError / demoClaiming / demoClaimError /
knownContexts / switchError / switchPending / run / agentSource / ask / askBusy / askError`

动作：`goScreen / openDetail / closeDetail / setTransport / uploadFiles / claimDemoTeam /
restoreSession / adoptContext / switchContext / forgetContext / refreshTeam / refreshFiles /
refreshNotes / **askLive** / resetRun / editAskQuestion / addAskQuestion / removeAskQuestion /
toggleAskRecipient / **confirmAsk** / refreshAsk`

→ **「快问」要接的真提问流已经在 store 里**（`ask / askBusy / askError / askLive / confirmAsk`），
悬浮入口大概率**不需要动 transport**（待 transport 侦察确认）。
→ 搜索的可检索面：`team`（成员）+ `team.projects`（项目）+ `files` + `notes`，**全部已在内存**，
纯客户端检索即可，无需新 endpoint。
