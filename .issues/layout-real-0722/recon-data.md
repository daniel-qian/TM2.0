> 侦察原件 · 视角 `data` · 2026-07-22 自动生成，未经人工编辑。

# 真数据能力清点 · lite2 侦察（只读）

---

## 1. `D:/avery/src/lite2/store.ts` — 全局 state

`interface LiteState` 定义在 `store.ts:242-341`，实例化在 `store.ts:352-826`。

| 字段 | 类型 | 定义行 | 来源 |
|---|---|---|---|
| `transport` | `LiveTransport` | :243 | `defaultTransport`（:350，生产恒 `createHttpTransport()`，stub 分支被 DCE） |
| `ingestStatus` | `'idle'\|'ingesting'\|'ready'\|'error'` | :251 / :40 | uploadFiles / restoreSession / adoptContext |
| `ingestError` | `string\|null` | :252 | |
| `team` | `LiteTeam\|null` | :253 | `liteTeamFromPayload(payload)` |
| `contextId` | `string\|null` | :254 | localStorage `lite2:contextId:v1`（:59） |
| `ownerToken` | `string\|null` | :257 | `storedOwnerToken()`，`lite2:ownerTokens:v1` |
| `rawTeam` | `LiveTeamPayload\|null` | :259 | `/ingest`、`/team/{id}` 原始回包 |
| `files` | `LiveFileEntry[]` | :261 | `GET /team/{id}/files` |
| `notes` | `LiveNoteEntry[]` | :264 | `GET /team/{id}/notes`，新→旧 |
| `noteJustAdded` | `boolean` | :266 | advise 落定后计数增长才 true（:729） |
| `restoring` / `restoreError` | `boolean` / `string\|null` | :270,:273 | |
| `demoClaiming` / `demoClaimError` | `boolean` / `string\|null` | :278,:279 | |
| `knownContexts` | `KnownContext[]` | :282 | localStorage `lite2:knownContexts:v1`，上限 12（:101-102） |
| `switchError` | `'missing-credential'\|'unreadable'\|'failed'\|null` | :284 / :179 | |
| `switchPending` | `string\|null` | :288 | |
| `run` | `LiveRunState` | :291 | `streamSource.ts:84-101` |
| `agentSource` | `LiveAgentSource` | :292 | |
| `_abort` | `(()=>void)\|null` | :293 | |
| `ask` | `AskDraft\|null` | :297 | 流里出生（:713）→ 之后活体在 store |
| `askBusy` | `'idle'\|'saving'\|'refreshing'` | :298 | |
| `askError` | `string\|null` | :299 | |

🔴 **`screen` / `detail` 不在 store**（`store.ts:246-248`）——当前屏与详情由 URL 派生（`routes.ts` 的 `useCurrentScreen` / `useRouteDetail`）。

### 各实体数据结构（真源在 `transport.ts`）

**成员** `LivePersonCard`（`transport.ts:104-114`）：`id:string` · `name:string` · `role?:string` · `team?:string` · `tenure?:string` · `owns?:string[]` · `collaboration?:string[]`。**类型层没有任何数字键的位置**（结构性护栏）。
映射后 `LitePerson`（`teamData.ts:17-32`）额外加：`read:string`（语料原文，非拼句）· `ownsRead:string[]`（≤2 条）· `tone:'sage'|'honey'|'terracotta'`。

**项目** `LiveProjectCard`（`transport.ts:116-126`）：`id` · `title` · `ownerId?` · `ownerName?` · `status?` · `progress?:number` · `dueDate?:string` · `summary?` · `blockers?:string[]`。
映射后 `LiteProject`（`teamData.ts:34-73`）多出 `ownerNameRaw?` / `statusRaw?` 两个**判据字段**（`ownerName`/`status` 已降级成「原值或空串」，渲染文案归渲染层）。

**信号** `LiveSignalCard`（`transport.ts:185-192`）：`id` · `source?` · `subjectType:'person'|'project'|'task'` · `subjectId` · `summary` · `tag?`。挂在 `rawTeam.signals`，**不进 `team`**。

**决策** `LiveDecisionCard`（`transport.ts:150-176`）：`subject_type:'project'` · `subject_id` · `subject_title` · `owner_name` · `grade` · `grade_label` · `severity:3|2|1` · `rule_grade*` · `matched_rules:LiveDecisionRuleHit[]`（永不为空）· `unknown_fields:string[]` · `unparsed_fields:{field,field_label,raw}[]` · `reason` · `reason_source:'rule'|'avery'` · `escalated` / `escalation_reason` / `downgrade_blocked` / `rejected_grade` / `review_rejected`。挂 `rawTeam.decisions`（optional）。

**文件** `LiveFileEntry`（`transport.ts:260-269`）：`idx` · `filename` · `size_bytes` · `mime` · `doc_kind` · `uploaded_at` · `n_chunks:number` · `status?:'ingested'|'empty'|'failed'|string`。

**笔记** `LiveNoteEntry`（`transport.ts:279-284`）：`id` · `created_at` · `text` · `source_excerpt`。

**待办** `FollowupItem`（`flowStore.ts:32-41`）：`id` · `title` · `source:FollowupSource` · `dueGroup:'today'|'week'|'later'` · `note?` · `done:boolean` · `doneAt?` · `createdAt`。**没有 dueDate（真日期），只有三档粗分组**。

**提问** `AskDraft`（`transport.ts:230-242`）：`id` · `status`（6 词表 :206）· `questions:AskQuestion[]`（1..3，kind 只有 `'scale'|'yesno'`）· `recipients:AskRecipient[]`（含 `token?` / `link?` / `receipt?`）· `comment_prompt?` · `company_context_id?` · `created_at?` · `expires_at?` · `receipts_summary?`。
`AskReceipt`（:216-220）：`answers:{question_id, value:number|boolean}[]` · `comment?` · `answered_at`。

---

## 2. `gapDerive.ts` — 「现实差距」怎么算

**纯函数** `deriveGaps(team: LiteTeam|null): GapCard[]`（`gapDerive.ts:43-73`）。零网络零 LLM 零随机。

判据（:48-51）：
```
const selfReported = project.statusRaw?.trim()
if (!selfReported || !STEADY_STATUSES.has(selfReported)) continue   // STEADY = {'on-track','steady'} (:31)
if ((project.blockers ?? []).length === 0) continue
```
即 **「自述稳 ∧ 挂着 ≥1 条 blocker」= 矛盾**。自述缺失（`statusRaw===undefined`）**跳过**——`gapDerive.ts:22-30` 记着这条历史 bug：以前读 `project.status`（当时被兜底成 `'on-track'`），约四分之一真项目因此被造出一句客户从没说过的自述。

输出 `GapCard`（:33-41）：`id:'gap_{projectId}_{idx}'` · `projectId` · `projectTitle` · `ownerName` · `claim` · `evidence` · `evidenceTag`。
- `claim` = `project.summary?.trim() || 'Reported status: "{statusRaw}"'`（:56，机械读出式兜底）
- `evidence` = 单条 blocker 原文（**一个项目 N 条 blocker → N 张卡**，:57）
- `evidenceTag` 恒为字面量 `'From your uploads'`（:68）——⚠️ **硬编码英文，从未进 i18n**（同族问题在 `draftLinks.ts:68-72` 已被点名）

### 右栏差距面板可用维度（穷举，只有这些）
1. `projectTitle` / `projectId` → 按项目折叠（「这个项目 N 条」），`gapDerive.ts:57` 的 forEach 天然产出多卡
2. `ownerName` → 分组/筛选（**只作标签，零数字**）
3. `claim` vs `evidence` 双栏（`CloserLookScreen.tsx:83-92` 已用）
4. `gapMarks` 三态 active/resolved/dismissed → 筛选 chip + 计数（`flowStore.ts:226-236`）
5. **严重度维度唯一诚实来源**：`rawTeam.decisions` 按 `subject_id === gap.projectId` join，取后端的 `severity`/`grade_label`（`transport.ts:157`）。🔴 前端不得自行判级（`transport.ts:130`）。
- **不存在的维度**：优先级、时间/趋势、责任人负载、置信度。若右栏要排序，诚实排法只有两种：同项目条数、项目标题字典序。

---

## 3. `homeDerive.ts` — 主页派生了什么

两个纯函数：

**① `summarizeDecisions(decisions)`（:35-53）** → `DecisionSummary{ total:number, buckets:DecisionBucket[] }`，`DecisionBucket{grade,label,severity,count}`（:23-28）。
- `label` **取自 payload 的 `grade_label`**，前端不硬编码「高风险/需确认/可推进」（:21-22）
- buckets 按 `severity` 降序（:51）；`decisions` 数组本身顺序归后端，**前端不重排**（`transport.ts:76-78`）

**② `deriveAttentionPeople(team, rawTeam)`（:84-152）** → `AttentionPerson[]`（:65-74）：`id` · `name` · `role` · `signalCount` · `blockerCount` · `projectCount` · `projectTitles:string[]` · `evidence:string[]`（verbatim，≤2 条，:141）。
- 认领项目：优先 `rawTeam.projects[].ownerId === person.id`，否则 `pr.ownerNameRaw === person.name`（:97-104，**绝不用 `ownerName`**）
- 信号命中只认两种：`sig.subjectType==='person' && sig.subjectId===person.id`，或 `summary.includes(name)` 且 `name.length>=2`（:78-82，单字名一律不认，宁漏不错）
- 🔴 **刻意不把「她是 owner」算作提到她**（:116-118）
- 排序 = `signalCount+blockerCount` 降序，同数按名字（:147-151），**可复现**
- `signalCount+blockerCount===0` 的人直接跳过（:129）

🔴 `homeDerive.ts:56-63` 明文记录：她方口径 `load>=90 || sentiment=strained` —— **这两个字段我们一个都没有**。

消费方 `HomeScreen.tsx:67-74`；计数展示在 `HomeScreen.tsx:414-446`。

---

## 4. `teamData.ts` + `teamGroups.ts` — 成员真字段与可派生信号

### 真字段
见上文 §1。运行时护栏 `stripPersonNumbers`（`teamData.ts:138-146`）：黑名单 `BLOOD_BAR_KEYS = {moodPct,capacityPct,mood,capacity,score,rank,rating,tier,percentile}`（:126-136），**并且丢弃任何 `typeof v === 'number'` 的键**（:142，防新血条字段偷渡）。

### 可派生的「需要注意」信号（真有基础的，穷举）
| 信号 | 判据路径 | 位置 |
|---|---|---|
| 名下项目挂 blocker | `projects.filter(ownerId/ownerNameRaw 命中).blockers.length` | `homeDerive.ts:105-112` |
| 被信号提到 | `signals` 直接命中 / 名字出现在 `summary` | `homeDerive.ts:119-127` |
| 项目**无 owner**（文档未提及） | `ownerNameRaw === undefined` | `teamData.ts:232-235`；`projectView.ts:96-98` → `ownerName: null` |
| 项目**无状态** | `statusRaw === undefined` → `statusKey:'unknown'` | `projectView.ts:55-60` |
| 项目缺进度/缺到期 | `projectCoverage()` 三个计数 | `projectView.ts:182-189` |
| 文件**没读进去** | `LiveFileEntry.status === 'empty' \| 'failed'` | `transport.ts:246-258`（缺席时**不得默认当 ingested**） |
| 该人零信号零卡点 | `deriveAttentionPeople` 里被 continue 掉 | `homeDerive.ts:129` |

**没有基础的**：`absent`/在职状态、久未更新（**无时间戳** —— `LivePersonCard` 一个日期字段都没有）、缺材料（材料不按人归属）、协作断裂（无关系边 —— `.issues/live-polish-0709/triage-report.md:68`：ingestion 只产 person/project/signal 实体，**不产关系边**）。

### `teamGroups.ts`
`groupPeople(people, projects, ungroupedLabel, ownsTemplate)`（:64-94）→ `PersonGroup[]{key,title,people}`。维度优先级（:41-61）：`person.team` → 拥有的首个项目标题（判据 `ownerNameRaw`，:33）→ `person.role` → `__ungrouped__` 兜底桶（沉底，:88-92）。分组 key 用**原始项目标题**派生，与语言无关（:38-40）。

---

## 5. `projectView.ts` — status-truth 怎么定

`buildProjectViews(cards: LiveProjectCard[], people: LivePersonCard[])`（:82-105），**吃原始 payload，不吃 `LiteProject`**（理由 :13-26：只有原始 payload 分得开「已知」与「未知」）。

- `ProjectStatusKey = 'blocked'|'at-risk'|'on-track'|'done'|'other'|'unknown'`（:29）
- `statusKeyOf`（:55-60）：空 → `'unknown'`；命中 `KNOWN_STATUS`（:53）→ 原词；词表外 → `'other'`（**原样回显文档用词，不改写**）
- `progressOf`（:67-71）：只接受有限数 0–100；`0` 是**合法已知值**（判据 `typeof === 'number'` 而非真值性）；NaN/Infinity/负数/>100 → `null`
- `ownerName`：`trimmedOrNull(card.ownerName) ?? nameById.get(card.ownerId) ?? null`（:96-98）
- `blockers` 用**空数组**不用 null（:37-38：后端只在非空时发这个键，缺席与空列表分不开）
- 🔴 `null` 一律读作「文档未提及」，**绝不是 0、不是空、不是默认值**（:36-38）

分组：`groupKeyOf`（:129-144）blocked|at-risk→`needsYou` · on-track→`moving` · done→`done` · unknown→`unknown` · other→`other`；`GROUP_ORDER`（:147-153）= needsYou, moving, other, unknown, done；`groupProjects`（:155-168）**只吐非空组**。

覆盖率：`projectCoverage(views)`（:182-189）→ `{total, missingProgress, missingDueDate, missingStatus}`。
**实测真 payload 字段覆盖率（`projectView.ts:9-11`）**：title/summary 17/17 · owner 16/17 · status/blockers 13/17 · **dueDate 7/17 · progress 6/17**。

---

## 6. 四个小 store 各存什么

| store | 持久化 key | 存什么 |
|---|---|---|
| `flowStore.ts` | `lite2:flow:v1`（:22），手写同步 load/save（:51-80） | `triageMarks: Record<id,'done'\|'discarded'>`（:89）· `followups: FollowupItem[]`（:94）· `composerDraft: string\|null`（**瞬态，不入盘** :107）· `gapMarks: Record<id,'resolved'\|'dismissed'>`（:114）。另含 6 个纯函数选择器（:212-236）：triage 三桶 + gap 三桶——**只按 marks 分桶，不重新派生** |
| `draftStore.ts` | 无（**纯瞬态**，:19-21 明写理由：进盘会让半截未发消息跨会话复活） | `draft: LiteDraft\|null` + `openDraft/closeDraft/setSubject/setBody` |
| `notifyStore.ts` | `lite2:notify:v1`（:21），MAX_ITEMS 50（:22） | `items: NotifItem[]{id,kind,createdAt,read}`（:26-31）· `seenGapIds`/`seenAskIds` 两个去重集 · `open:boolean`。`NotifKind = 'ingest'\|'run'\|'ask'\|'gap'`（:24），`NOTIF_TARGET`（:34-39）映射到屏。**零 seed 数据**——只能由 `initNotifications()`（:163-198）订阅 `useLite` 的真状态转移 push |
| `demoStore.ts` | 无（进程内缓存） | `availability:'unknown'\|'probing'\|'yes'\|'no'` + `probe()`。探 `GET /demo/status`；`transport.demoStatus` 缺失或失败一律 `'no'` → **那扇门一个像素都不出**（:6-9 的"不出假按钮"纪律） |

`notifyStore.ts:190-196` 的 gap 通知：`state.team !== prev.team` 时跑 `deriveGaps` 找没见过的 id，按 id 去重。

---

## 7. KPI 计数族

### ✅ 能诚实背书的（取数路径 → 计算式）

| 计数 | 路径 | 现状 |
|---|---|---|
| 成员数 | `useLite.team.people.length` ← `liteTeamFromPayload(payload).people` ← `payload.people` | 已用 `HomeScreen.tsx:423` |
| 项目数 | `useLite.team.projects.length` | 已用 `HomeScreen.tsx:427`；`ProjectsScreen.tsx:212-216` |
| 文件数 | `useLite.files.length` | 已用 `HomeScreen.tsx:431` |
| **材料块数** | `files.reduce((n,f)=>n+f.n_chunks,0)` | 单文件已显（`UploadPanel.tsx:287`），**总和未做** |
| **文件读取状态分桶** | `files.filter(f=>f.status==='ingested'\|'empty'\|'failed').length`；缺席 → 「未知」，🔴 不得默认当 ingested | 未做 |
| 笔记数 | `useLite.notes.length` | 已用 `HomeScreen.tsx:435`；`NotesScreen.tsx:152` |
| 待办未完成 | `useFlow.followups.filter(f=>!f.done).length` | 已用 `HomeScreen.tsx:71` |
| 今日待办 | `followups.filter(f=>!f.done && f.dueGroup==='today').length` | 已用 `HomeScreen.tsx:74` |
| 待办已完成 | `followups.filter(f=>f.done).length` | `FollowupsScreen.tsx:237` |
| 差距条数 | `selectGapsActive(team,gapMarks).length` / Resolved / Dismissed | 已用 `HomeScreen.tsx:337-339`、`CloserLookScreen.tsx:42` |
| 分诊三桶 | `selectTriagePending/Handled/SetAside(team, triageMarks).length` | `TeamScreen.tsx:234-338` |
| 分诊总数 | `team.handoffs.length`（← `liveHandoffs()` `teamData.ts:175-195`） | `TeamScreen.tsx:180` |
| 决策总数 + 分级计数 | `summarizeDecisions(rawTeam.decisions)` → `.total` / `.buckets[].count` | 已用 `HomeScreen.tsx:210-231` |
| 每卡命中规则数 | `card.matched_rules.length` | `HomeScreen.tsx:539` |
| **项目缺字段计数** | `projectCoverage(views)` → `{total,missingProgress,missingDueDate,missingStatus}` | 已用 `ProjectsScreen.tsx:223` |
| **项目按状态分桶** | `groupProjects(views)[].views.length` | 已用 `ProjectsScreen.tsx:257` |
| **卡点总条数** | `projects.reduce((n,p)=>n+(p.blockers?.length??0),0)` | 未做 |
| 未读通知数 | `selectUnreadCount(useNotify)`（`notifyStore.ts:155-157`）——「通知条数」，不是任何人的读数 | `LiteBell.tsx` |
| **信号条数** | `rawTeam.signals?.length ?? 0` | 未做，⚠️ 见下 |
| 关注人数 | `deriveAttentionPeople(team,rawTeam).length` | 已用 `HomeScreen.tsx:383` |
| 单人关联条数 | `AttentionPerson.signalCount` / `.blockerCount` / `.projectCount` | 已用；**必须同屏写口径 + 摆原文**（`homeDerive.ts:60-63`） |
| Ask 回收 | `ask.recipients.filter(r=>r.receipt).length` / `ask.recipients.length` | `AskCard.tsx:26-28,125` |
| 一次 run 的量 | `run.sourcesRead` / `run.recallHits` / `run.citations.length` / `phase.steps` | `RoomScreen.tsx:96-107,178` |
| 历史工作区数 | `useLite.knownContexts.length` | 未在 KPI 位展示 |
| 已选 playbook 数 | `useOnboard.playbooks.length` | `PlaybooksScreen.tsx:25` |

⚠️ **信号数的陷阱（`teamData.ts:91-105`）**：抽取层给每条 doc 信号写死 `subjectRef="the project"`（`extract.py::_signals_from_doc`），它们**谁也挂不上**。实测出现过 0 项目 + 2 信号 → 界面说「其中 2 个项目值得多看一眼」，凭空点名两个不存在的项目。后端因此发 `look_kind`（`'projects'|'items'|'none'`，`teamData.ts:105,272-275`），**`undefined` 必须按 `'items'` 侧兜底**（说「N 处」永不会比事实更肯定）。任何把信号数说成项目数的文案都是这条 bug 的复发。

### ❌ 不能做的编造型指标

| 指标 | 为什么不能 |
|---|---|
| 任何人身 % / 评分 / 排名 / 血条（moodPct, capacityPct, score, rank, rating, tier, percentile） | 类型层无槽位（`transport.ts:102-114`）+ 运行时剥离（`teamData.ts:126-146`）。硬红线 |
| 团队健康度 / 士气 / 负荷 / 满意度 | 后端不产这些字段。她方的 `load>=90 \|\| sentiment=strained` 口径**我们一个字段都没有**（`homeDerive.ts:56-58`） |
| 项目整体完成率 / 平均进度 % | `progress` 只有 **6/17** 有值（`projectView.ts:10`）。任何聚合平均都要么把「文档没说」当 0（谎称没进展），要么缩分母（口径不可解释） |
| 逾期数 / 距截止 N 天 / 倒计时 | `dueDate` 是自由文本 `string`，前端只 `trim()`（`projectView.ts:102`），**没有任何日期解析**。后端解析不出的走 `unparsed_fields`（原文如「月底前」，`transport.ts:144-148`） |
| 本周新增 / 环比 / 趋势 / 折线 | **无时间序列**。payload 无历史快照；`files[].uploaded_at` 是上传时间不是业务时间；`notes[].created_at` 只覆盖 agent 自写笔记 |
| 「扫描了 N 条信号」式问候统计句 | `homeDerive.ts:10-12` 点名禁止（她方硬编码假数字，一个都不搬） |
| 平均响应时长 / 回复率基线 | Ask 只有 `answered_at`，样本 1–3 人；且 ADR-0023 禁跨人比较（`AskCard.tsx:11-15`：组件树里**不存在**「每人一行 + 数值」的路径） |
| 在线人数 / 活跃度 / 未读消息数 | 无任何 presence 或消息数据 |
| 关系图边数 / 协作密度 | ingestion **不产关系边**（`.issues/live-polish-0709/triage-report.md:68`） |

---

## 8. 搜索可检索面

**现有唯一检索实现**：`LiteComposer.tsx:44-68`，只在 composer 引用选择器里，只覆盖 people + projects：
```ts
`${option.label} ${option.meta}`.toLowerCase().includes(query)   // :66
```
外加 kind 过滤 `'all'|'person'|'project'`（:64）。**没有全局搜索、没有 Cmd+K**（`.issues/lite-live-v02-0713/decisions.md:26` 把「全局搜索」列在「暂缓/不动」）。

| 实体 | 可检索字段路径 | 全量在内存? | 量级 |
|---|---|---|---|
| 成员 | `useLite.team.people[].name / .role / .team / .tenure / .owns[] / .collaboration[]` | 是 | **~30**（真 seed 实测 30 人卡，`.issues/feat-026/session-handoff.md:68`） |
| 项目 | `useLite.team.projects[].title / .summary / .ownerName / .status / .blockers[]` | 是 | **17**（`projectView.ts:9`） |
| 信号 | `useLite.rawTeam.signals[].summary / .tag / .source` | 是 | 每文档若干，未上限；**已被 DetailOverlay 按 subjectId 过滤消费**（`DetailOverlay.tsx:53-56`） |
| 笔记 | `useLite.notes[].text / .source_excerpt` | 是（后端全量返回，无分页） | 随 advise 次数累积 |
| 文件 | `useLite.files[].filename / .doc_kind / .mime` | 是 | = 上传文件数 |
| 待办 | `useFlow.followups[].title / .note` | 是（localStorage） | 手工累积 |
| 差距卡 | `deriveGaps(team)[].projectTitle / .claim / .evidence` | 是（每次调用重算，纯函数） | ≤ 项目卡点总数 |
| 决策卡 | `useLite.rawTeam.decisions[].subject_title / .reason / .matched_rules[].title / .evidence[]` | 是 | ≤ 项目数 |
| 历史工作区 | `useLite.knownContexts[].files[]` | 是（localStorage，上限 12） | ≤12 |
| Playbooks | `PLAYBOOK_CATALOG`（`onboardStore.ts:38-47`），title/body 走 i18n 取词函数 | 是（静态） | **8** |

**不可检索**（前端根本没有）：文件正文 / chunk 内容（只有 `n_chunks` **数量**，不是内容）· advice 历史（`run` 只有当前一次，`resetRun()` 即清，`store.ts:741-744`）· ask 历史（`ask` 只有当前一张，新 run 开跑即撤，`store.ts:700-706`）· 通知正文（`NotifItem` 只有 `kind`，文案在字典里，`notifyStore.ts:26-31`）。

---

## 9. 提问流

**两条完全独立的链路，别混为一谈。**

### ① 主链路：向 Avery 提问（流式）
`store.askLive(req: AdviseRequest)`（`store.ts:694-739`）
→ `agentSource.run()`（`streamSource.ts:129-...`）
→ `transport.streamAdvise()`（`transport.ts:614-659`）
→ `POST {base}/advise`，body `{...req, stream:true}`，`Accept: text/event-stream`，header `X-Avery-Token` + `X-Avery-Account`（`transport.ts:618-627`）
→ SSE 记录按 `/\r?\n\r?\n/` 切分（`transport.ts:642`，**只找 `\n\n` 会切不出任何一帧**）→ `parseSseRecord()`（`transport.ts:798`）

- 请求：`AdviseRequest{situation:string, title?:string, company_context_id?:string}`（`transport.ts:61-65`）
- 事件类型：`started|think|tool|observe|nudge|manifest|error`（`transport.ts:20-27`）
- 累积成 `LiveRunState`（`streamSource.ts:84-101`）：`status` · `lines:LiteStreamLine[]` · `advice:LiteAdvice|null`（8 字段契约 :63-81）· `askDraft` · `contractOk` · `redlinePassed` · `error` · `phases:LitePhase[]`（恒 4 条）· `citations:LiteCitation[]` · `sourcesRead` · `recallHits` · `pendingTool`
- 入口：`LiteComposer.tsx:87` `askLive({situation})` + `goScreen('room')`；预填走 `useFlow.composerDraft`（`CloserLookScreen.tsx:51`、`TeamScreen` take-to-room）
- run 落定后拉一次 notes，**计数增长才亮 nudge**（`store.ts:718-735`）——观察被红线门丢弃时后端不落库、计数不变、nudge 不出

### ② 副链路：Quick ask 向员工收自述（**非流式**）
组件 `AskCard.tsx`（317 行）。草稿从 SSE `manifest{kind:'ask-draft'}` 出生（`store.ts:713`），**一次性收养**，之后活体在 store 不再被流覆盖。

| 动作 | store action | transport | endpoint |
|---|---|---|---|
| 保存 | `confirmAsk`（`store.ts:794-812`，白名单守卫 `status==='draft'`） | `saveAsk` | `POST {base}/ask`（`transport.ts:721-734`） |
| 分享 | 同上，紧跟 | `shareAsk` | `POST {base}/ask/{id}/share`（`transport.ts:736-743`） |
| 拉取回执 | `refreshAsk`（`store.ts:814-825`，仅 shared/collecting） | `fetchAsk` | `GET {base}/ask/{id}`（`transport.ts:745-751`） |

- 全部带 owner_token header，由进程内 `askContexts: askId → contextId` 映射取（`transport.ts:594-597`）。🔴 token 只进 header，绝不进 URL。
- 返回一律过 `adoptAsk()`（`store.ts:834-838`）→ `coerceAskDraft`，坏形状**抛错、拒绝渲染**；未知 status 折 `closed`（**绝不折 draft**，`transport.ts:202-206`）
- 草稿态编辑 action：`editAskQuestion` / `addAskQuestion` / `removeAskQuestion` / `toggleAskRecipient`（`store.ts:747-792`），全部 `status !== 'draft'` 即 return
- 受访者候选 = `team.people`（`AskCard.tsx:60-63`）
- 🔴 结构护栏：多人同题**只渲染一段 `receipts_summary`**，组件树里**不存在**每人一行 + 数值的路径（`AskCard.tsx:11-15,296-304`）

---

## 10. 候选真部件 → 数据基础

| 候选部件 | 充分性 | 依据 |
|---|---|---|
| **首页计数条**（人/项目/文件/笔记/未完成待办） | **充分** | 五个都是真数组 `.length`，已在 `HomeScreen.tsx:421-446` 落地。可直接复用为 KPI 条 |
| **项目覆盖率面板**（缺状态/缺进度/缺到期 N/M） | **充分** | `projectCoverage()` `projectView.ts:182-189`，真算；实测基数 17/17·13/17·6/17·7/17 |
| **项目状态看板分组 + 每组计数** | **充分** | `groupProjects()` `projectView.ts:155-168`，只吐非空组，`GROUP_ORDER` 已定 |
| **决策分级摘要条**（高风险 N / 需确认 N / 可推进 N） | **充分** | `summarizeDecisions()` `homeDerive.ts:35-53`；grade/label/severity/排序**全归后端**，前端零判断 |
| **文件读取健康**（ingested/empty/failed 分桶 + 总 chunk 数） | **充分** | `LiveFileEntry.status` + `n_chunks`（`transport.ts:258-269`）。⚠️ `status` 缺席时必须显「未知」，**不得默认 ingested** |
| **差距面板 + 三态筛选**（active/resolved/dismissed） | **充分** | `selectGapsActive/Resolved/Dismissed` `flowStore.ts:226-236`；`CloserLookScreen` 已有主体，缺的只是筛选/分组容器 |
| **差距按项目折叠**（「项目 X · N 条」） | **充分** | `GapCard.projectId` 稳定，一项目多卡由 `gapDerive.ts:57` 天然产出 |
| **差距按严重度排序/着色** | **勉强** | 前端自己**不能判级**。唯一诚实路径 = join `rawTeam.decisions` on `subject_id === gap.projectId` 取后端 `severity`。`decisions` 是 optional（老后端不发），join 不上必须退回「无严重度」而非默认一档 |
| **卡点总数 / 项目卡点排行** | **勉强** | `blockers[]` 只有 13/17 项目有；「排行」= 条数排序，可做但必须写明口径是「条数」不是「严重程度」 |
| **全局搜索（人/项目/笔记/待办/文件）** | **勉强** | 五类实体全量在内存、字段路径都有（§8），但**量级极小**（30 人 + 17 项目 + 8 playbook），`includes()` 足够，不需索引。风险不在数据在产品：`decisions.md:26` 把全局搜索列为「暂缓」，需重新拍板 |
| **「需要注意的人」面板** | **勉强** | `deriveAttentionPeople` 是真派生，但输出**带数字且指向人**。合法性完全依赖两个前置条件（`homeDerive.ts:60-63`）：① 界面必须写出口径「因为出现在 N 条信号里」；② 必须同屏摆出 verbatim 原文。二者缺一即触红线 |
| **信号计数徽章**（「N 条信号」） | **勉强** | `rawTeam.signals.length` 是真数，但**绝不能说成「N 个项目」**——须按 `look_kind` 分流，`undefined` 走不点名侧（`teamData.ts:91-105`） |
| **通知未读角标** | **充分** | `selectUnreadCount` `notifyStore.ts:155`；四种 kind 全由真状态转移驱动（`notifyStore.ts:167-197`），零 seed |
| **一次 run 的过程计量**（读了 N 份 / 翻出 N 条 / N 条引用） | **充分** | `run.sourcesRead` / `recallHits` / `citations.length`（`streamSource.ts:96-100`），真事件驱动；相位无事件即 `pending`，**零假延迟零假进度**（`streamSource.ts:38-40`） |
| **Ask 回收进度条**（已回 N / 共 M） | **充分** | `AskCard.tsx:26-28`。单人可显数值 + 「本人自述」标注；多人**只能**显 `receipts_summary` |
| **待办按日期分组/日历视图** | **不足** | `FollowupItem` 只有 `dueGroup:'today'\|'week'\|'later'` 三档粗分组（`flowStore.ts:36`），**没有真 dueDate 字段**。日历需先扩数据结构 |
| **逾期/倒计时/截止提醒** | **不足** | `dueDate` 是未解析自由文本（`projectView.ts:102` 只 trim）；后端明确把解析不出的归 `unparsed_fields`（原文如「月底前」） |
| **趋势图 / 本周变化 / 环比** | **不足** | 无任何时间序列数据源。payload 无历史快照 |
| **团队关系图 / Team map** | **不足** | ingestion 不产关系边（`.issues/live-polish-0709/triage-report.md:68`）；`decisions.md:26` 已列「暂缓/不动」 |
| **人卡任何评分/血条/负载条** | **不足（硬禁）** | 类型无槽位 + 运行时双重剥离（`transport.ts:102-114`、`teamData.ts:126-146`） |
| **项目完成率仪表盘** | **不足** | `progress` 6/17 覆盖，聚合必然编 |
| **Playbooks 真内容** | **不足** | `PLAYBOOK_CATALOG` 是 8 条静态 i18n 文案（`onboardStore.ts:38-47`），`PlaybooksScreen` 全屏诚实标 coming-soon。无真 pack 数据 |
| **Vision 屏任何数据化** | **不足** | 纯静态叙事 + 4 张带诚实 tag 的 mock（`VisionScreen.tsx:41-70`），不依赖 ingest/advise |