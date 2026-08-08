# recon-history — 「之前问过的」历史 → 跳回议事室继续问：通路评估（只读侦察，0808）

> 任务背景：0808 复盘拍板对议事室/资料库做对齐经典 AI SaaS 的 UIUX 重构。Danny 要求：点历史记录要能跳回议事室继续问（现状是只读抽屉展开回看）。本文件是「别重新侦察」级别的现状盘点 + 三条实现路径的事实成本表。**不含推荐**。

---

## 1. 现状盘点

### 1.1 LiteRoomHistory 只读抽屉（真实边界 RoomScreen.tsx:403-475）

- 组件：`src/lite2/screens/RoomScreen.tsx:409-475`（函数 `LiteRoomHistory`，头注 403-408）。挂载点在 RoomScreen JSX 尾部 `RoomScreen.tsx:678`（`<LiteRoomHistory />`，注释 676-677：absolute 定位、刻意不进 `.lite-room-board` / `.nexus-empty` 两棵门锚树、空态与对话态都渲染）。
- 数据源：`useLite((s) => s.adviseRuns)`（RoomScreen.tsx:410）。**渲染门槛**：`adviseRuns` 为 null（stub 通道/未拉取）或空数组时整块 `return null`（RoomScreen.tsx:414，注释 406-408）。
- 入口按钮：右上 ghost 按钮「之前问过的 · N」（RoomScreen.tsx:424-431），absolute `top: var(--lite2-clear-top,96px); right:24px; z-index:44`（lite2.css:8243-8249）。
- 抽屉面板：absolute 右侧内滚，`width: min(680px, calc(100vw-48px))`，底沿让位 composer（lite2.css:8251-8265）。
- 条目：单行问题（ellipsis，展开后 `white-space:normal`，lite2.css:8298-8308）+ 11px 日期戳（lite2.css:8310-8314；格式化 RoomScreen.tsx:415-421 `toLocaleString`，月日时分）。
- 展开体：**展开才 coerce**（RoomScreen.tsx:437-438 `const advice = expanded ? coerceAdvice(run.advice) : null`）。advice 有值 → `.lite-room-card` 包裹 `<LiteAdviceCard advice={advice}/>`（RoomScreen.tsx:453-458）；否则 answer 非空 → 短答卡（RoomScreen.tsx:459-464）。**这证明了 advise_runs.advice jsonb → coerceAdvice → LiteAdviceCard 的回放链路已在生产工作**——hydrate 路径复用同一链即可。
- 交互边界：纯回看。没有任何「继续问 / 载入对话」的 action；点击条目只切 `openId` 展开/收起（RoomScreen.tsx:445）。
- 拉取时机（RoomScreen.tsx:563-573）：挂载/换公司拉一次（effect 依赖 `contextId`，568-570）+ 尾轮 `status === 'complete'` 时再拉（571-573，服务端 manifest 时刻已落库）。
- CSS 段：lite2.css:8240-8336（含 8321-8330「解除 story 绝对定位」的 board 同规格抄本——抽屉不在 board 里吃不到 board 段那条，历史上截图实测过内部互叠）。

### 1.2 GET /team/{id}/advise-runs 契约与 store 三态

后端端点：`eval-harness/service/ingest_api.py:468-482`
- `GET /team/{context_id}/advise-runs`，门与 notes 同一张：owner_token（header）或持有账号，否则 404 无存在性 oracle（477-480，`authorize_context`）。
- 返回 `{context_id, runs: [asdict(AdviseRun)]}`（481-482）。新→旧、上限 50（473-474 文档；limit 在 registry 层 `list_advise_runs(context_id, limit=50)`）。
- **「只读面（v1 无删除）」**是端点 docstring 明写的（ingest_api.py:474）。

前端契约：`src/lite2/transport.ts:531-548`
- `LiveAdviseRunEntry`：`{id, created_at(ISO8601 UTC), question, title, locale, advice: Record<string,unknown>|null, answer: string}`（535-543）。advice 与 answer 互斥（注释 534）。
- `LiveAdviseRunsPayload = {context_id, runs}`（545-548）。
- 传输实现：`transport.ts:1457-1463`（header-only 纪律，缺/错 token 一律 404）。
- 接口可选：`fetchAdviseRuns?:`（transport.ts:783-785）——stub 通道**没有**这个方法（`stubTransport.ts` 全文无 fetchAdviseRuns 匹配），判空即整块不渲染。

store 三态：`src/lite2/store.ts`
- 声明与语义：store.ts:328-330（null=尚未拉取/通道不可用；[]=拉过确实为空；UI 据此区分「不渲染」与「诚实空态」）。初值 null（store.ts:590）。
- `refreshAdviseRuns`：store.ts:1048-1058（contextId 收口 + `stillOn` 闸 + 静默吞错——拉取失败停在上一次的值；注释 1047、1056）。
- 公司域清理三抄本（改一处必须改三处）：恢复 404 分支 store.ts:854、`adoptContext` 换公司 store.ts:890、`resetLiteCompanyData` store.ts:1522（「历史是公司域数据，换账号/重开必清」）。

### 1.3 advise_runs 表：9 列，明确不存过程

迁移 `eval-harness/db/migrations/0012_advise_runs.sql`：
- 列（30-40）：`seq bigserial PK / id text（对外句柄，unique 42-43）/ context_id FK ON DELETE CASCADE / question / title / locale default 'en' / advice jsonb / answer text / created_at timestamptz default now()`。
- 索引：`(context_id, seq DESC)`（46-47，「本公司新→旧」读路径）。
- **存什么/不存什么**（头注 5-10，grill 拍板 issue #49）：存问题原文、可选标题、locale、契约投影后的 8 字段建议卡（advice jsonb = manifest.advice，引用以 evidence 字段形态在卡内）、分流短答（与 advice 互斥）。**不存：原始 SSE 事件流、四相过程、完整 transcript**（「recall 原文块会让行体积膨胀两个数量级」）。
- 红线（12-14）：只有 `redline_passed is True` 的 manifest 才写入。
- GC（16-19）：CASCADE 随 context 走；`clone_context` 刻意不复制 advise_runs（示例团队空历史开局）。
- increment-only 纪律（21-23）：每次 bootstrap 由 `_ensure_schema()` 全量重放，同一文件应用到 Supabase，本地/生产等价 by construction。

### 1.4 写入路径（落库的那一刻长什么样）

- 服务端 hook：`eval-harness/service/app.py:344-371`（`_persist_advise_run`，由 `_post_advise_hooks` app.py:374-379 与 notes hook 同拍调用）。
  - 无 context 不落（352-353）；`redline_passed is not True` 不落（354-355）。
  - advice 取 `manifest.advice`（dict 才要，356）；`answer_kind == 'answer'` 时只取 `a["text"]` 且 advice 置 None（358-362）——**短答路的 `followup_questions` 在这里被丢弃**（answer 列是纯 text）。
  - 两者皆空不落行（363-364）；一切异常吞掉（370-371 best-effort）。
- 注意 title：lite2 前端所有 `askLive` 调用**从不发 title**（RoomScreen.tsx 全文 title 只出现在终端标题 UI，133；请求组装 548-551 / 667 无 title）→ 现网 lite2 产生的行 title 恒空。
- registry 双胞胎：内存 `avery/ingest/registry.py:849-871`（append/list，无内容门 by design——写门在 service hook）；AdviseRun dataclass registry.py:92-106；`new_run_id()` = `"run_" + uuid hex16`（109-110）。Postgres `avery/ingest/pg_registry.py:716-748`（append 726-735 Jsonb 写入；list 737-748 `ORDER BY seq DESC LIMIT`）。协议面：registry.py:1269-1273（`ContextRegistryProtocol`，两 adapter 参数表一致由 test_registry_protocol 离线断言——**动签名两边+协议+测试四处一起动**）。
- 存进 advice jsonb 的**确切键集**（`service/contract.py:161-174` project_advice payload）：恒有 `summary / evidence / recommended_actions`；有真值才发键 `detected_signals / conversation_script / followup_questions`（followups 逐条过红线 ≤3 条，contract.py:102-120）。`diagnosis_hypotheses / confidence / escalation / metrics_to_track` 现行投影**不产**（0729/02 砍样板，注释 155-160——将来引擎原生产出才透传）。evidence 行是 `"{source_ref} — {snippet|claim}"` 扁平字符串（contract.py:141-142）——**结构化引用的唯一幸存形态**。

---

## 2. #71 已落的会话流机制（hydrate 要复用的那套）

### 2.1 store.turns / LiveTurn

- `LiveTurn`（store.ts:281-290）：`{id: string（nextTurnId 自增 'turn-N'，292-296）, question: string（织文前原话）, refs: AdviseReference[]|null（wire 形状）, run: LiveRunState}`。
- `turns: LiveTurn[]` 是唯一真相（store.ts:354-358）；**刻意不持久化**（不落 localStorage 不落库，「离开/刷新即这场对话结束」是票面拍板，354-357 + askHistory.ts:10-11）。
- `run` 是**尾轮镜像**不是独立槽（store.ts:360-364）：notifyStore + **十道门**的 `__lite2Store.getState().run.status` 都读它——**任何往 turns 里塞轮次的新 action 必须同步 run 镜像**，否则门与完成通知全瞎。
- `askLive`（store.ts:1275-1370）：busy 闸在 store 临界区（尾轮 running 即静默丢弃，1281-1282）；`history = buildAdviseHistory(turns)`（1298，组装点收口在 store 不在调用方，注释 1295-1297）；新 turn 推入 + run 镜像同步（1306-1311）；请求体 `...(history ? {history} : {})` additive optional（1317-1318）；流回调**按 turn.id 认领**（1320-1329，防旧流末帧盖新轮）；镜像只在尾轮同步（1338-1347）。
- `clearTurns`（store.ts:1389-1393）：RoomScreen **卸载即清**（RoomScreen.tsx:543 `useEffect(() => () => clearTurns(), ...)`）——hydrate 出的轮同样会在离开议事室时死掉，这是现行拍板不是 bug。
- 渲染：`RoomScreen.tsx:597-611`（`.lite-room-board data-room-turns={turns.length}`，一轮一个 `LiteTurnView`）；`hasStarted = turns.length > 0` 决定 board vs 空态（584, 588）。

### 2.2 LiveRunState（一轮的全部渲染燃料）

`src/lite2/streamSource.ts:88-110`：`{status, lines: LiteStreamLine[], advice: LiteAdvice|null, answer: string|null, followups: string[], askDraft: AskDraft|null, contractOk, redlinePassed, error, phases: LitePhase[]（恒4条）, citations: LiteCitation[], sourcesRead, recallHits, pendingTool}`。`emptyRunState()`（112-128）：四相全 pending、各计数 0。
- followups 来源：advice 路 `ev.advice.followup_questions`（265-266）、短答路 `a.followup_questions`（252）——都在**流事件时刻**提取。
- `coerceAdvice`（439-489）：防御性形状归一。对照 1.4 的存储键集：**九字段全认识**（summary/detected_signals/diagnosis_hypotheses/evidence/recommended_actions/metrics_to_track/conversation_script 445-458 + 可选 confidence 462-470 / escalation 471-487，absent≠none 纪律）。**唯一不经它的键是 `followup_questions`**——hydrate 时要自己从 `advice.followup_questions` 另取（模式照抄 streamSource.ts:265-266 的 coerceFollowups 调用）。

### 2.3 前端 history 组装（askHistory.ts）

- 配额常数：`HISTORY_MAX_TURNS=6 / QUESTION=400 / ANSWER=800`（askHistory.ts:14-18），与后端孪生「改一处必须改两处」（头注 6-8）。
- `historyAnswerOf(run)`（35-39）：`advice.summary ?? answer`，两者皆空返回 null——该轮不进 history。
- `buildAdviseHistory(turns)`（45-61）：question+answer 都非空才进，截断加 `…[truncated]`，空返回 `undefined`（absent≠[]，43）。
- **关键事实：hydrate 出的 turn 只要 advice.summary 或 answer 非空，就自动被 buildAdviseHistory 认作合法上下文**——「载入历史条目→追问带上下文」在前端组装层零改动成立。

### 2.4 后端配额闸（service/history.py，权威侧）

- 常数：`TURNS=6 / QUESTION=400 / ANSWER=800 / TOTAL=3000`（35-41）；`normalize_history`（67-101）：半截轮丢弃（81-82）、超轮数丢最早（86-88）、总量 3000 从最早丢（94-96）、有丢弃在最早幸存轮问题前标 `[earlier turns omitted]`（98-100）。
- `history_conversation_turns`（104-116）：铺成 plain user/assistant 文本对，prepend 在开场 user turn 之前，刻意不回放 tool_use/tool_result（106-110）。
- `stream_advice` 自己调闸不信调用方（头注 12-14）。**hydrate 方案对后端完全透明**：它只是又一条 `history` 数组，配额闸原样生效。

### 2.5 AdviseRequest.history 契约

- 前端：`transport.ts:81-99`（`AdviseHistoryTurn = {question, answer}`；`AdviseRequest.history?:` additive optional，第一问不带键，96-99）。
- 后端：`app.py:167-174`（`history: list[AdviseHistoryTurn] | None`，「NOT persisted — advise_runs still stores one row per question」，169-170）。

---

## 3. 字段对表：advise_runs 有的 vs hydrate 一个 LiveTurn 要的

| LiveTurn/LiveRunState 需要 | advise_runs 供给 | 结论 |
|---|---|---|
| `id` | `id`（run_xxx） | ✓ 可直接用作 turn id（或另铸，避免与 nextTurnId 'turn-N' 命名空间混淆——事实上不会冲突） |
| `question` | `question`（原话 verbatim，test_advise_runs_http.py:76 钉死） | ✓ 无损 |
| `refs`（#64 引用 chips，LiteTurnView 渲染 RoomScreen.tsx:303-316） | **未存**（0012 头注 5-10；references 只活在请求 transport.ts:93-95） | ✗ 缺口：hydrate 轮无引用 chips 行 |
| `run.status` | — | 硬编 `'complete'`（写门保证只有成品落库 app.py:354, 363-364） |
| `run.advice` | `advice` jsonb（= project_advice 投影） | ✓ **经 coerceAdvice 无损**（键集对照见 §1.4/§2.2；抽屉已在生产用同一链 RoomScreen.tsx:438,457） |
| `run.answer` | `answer` text | ✓ 无损（短答正文） |
| `run.followups` | advice 路：`advice.followup_questions` 在 jsonb 里 ✓；短答路：**丢失**（app.py:358-361 只存 a["text"]） | 半缺口：advice 路可恢复（需绕过 coerceAdvice 另取）；短答路恢复不了 chips |
| `run.lines`（原始流，RawStreamLog RoomScreen.tsx:50-84） | **未存**（0012 拍板不存 SSE 流） | ✗ 「展开原始流」对 hydrate 轮是空的 |
| `run.phases`（四相面板 LiteThinkingFlow RoomScreen.tsx:115-218） | **未存** | ✗ emptyRunState 四相全 pending → 渲染成 4×「待命」（phaseMeta RoomScreen.tsx:95-111 的 pending 分支）——**对已完成的历史轮是假话，必须隐藏/替换** |
| `run.citations`（「依据 N 条原文」toggle RoomScreen.tsx:173-183, 198-213） | 结构化**未存**；扁平幸存于 `advice.evidence` 的 `"source_ref — snippet"` 字符串（contract.py:141-142） | ✗ cites.length=0 → toggle 不出；出处只剩卡内 evidence 节 |
| `run.sourcesRead / recallHits` | **未存** | ✗ 相副文案的真计数没了（与 phases 一起整块藏掉即无感） |
| `run.contractOk / redlinePassed` | — | 硬编 true 有据（app.py:354 写门）/或留 null |
| `run.askDraft` | **未存** | ✗（历史轮本也不渲染 ask 卡——isLast 限定 RoomScreen.tsx:394-398） |
| （轮的语言） | `locale` 存了 | UI 现不消费；卡内容语言=提问当时语言，界面语言切换后 hydrate 出的是当时语言（事实陈述） |
| （标题） | `title` 存了 | lite2 从不写（§1.4）→ 恒空；(b)/(c) 的线程命名可征用此列 |

**结论浓缩**：终局产物（question/advice/answer）无损可回放且链路已被抽屉证明；**过程态（流/四相/结构化引用/计数）与输入态（refs）结构性缺失**，短答路 followups 顺带丢失。hydrate 出的历史轮 = 「有问有答、无过程无引用 chips」的轮。

---

## 4. 三条实现路径的事实成本表（不做推荐）

### (a) 单条续问零迁移：点历史条目 → 该条成为第一轮 → 追问带 history

后端改动：**零**（含零迁移）。history 闸/契约原样吃（§2.4-2.5）；续问照常经 `_persist_advise_run` 落新行。

前端改动面：
1. **store 新 action**（如 `hydrateTurnFromRun(entry)`，落 store.ts askLive 附近）：构造 `LiveTurn{id, question: entry.question, refs: null, run: {...emptyRunState(), status:'complete', advice: coerceAdvice(entry.advice), answer: entry.answer || null, followups: <advice 路另取 followup_questions>, redlinePassed: true}}`，推入 turns。**必须同步 run 尾轮镜像**（store.ts:360-364 十道门纪律）；**必须自带 busy 闸**（尾轮 running 时拒绝——askLive 的闸 1281-1282 不覆盖这个新入口）。约 30-60 行。
2. **LiveTurn 加判别字段**（如 `hydrated?: true`）+ LiteTurnView 按它**隐藏 LiteThinkingFlow**（RoomScreen.tsx:319）或换一行「从历史恢复于 {date}」说明——不隐藏就是 4×「待命」假相位（§3）。约 10-20 行 + 少量 CSS。
3. **LiteRoomHistory 条目加动作**（点条目头 or 单独「继续问」键，RoomScreen.tsx:441-450 一带）：调 hydrate + `setOpen(false)` 关抽屉。滚动归位免费（turns.length 变化自动滚底 RoomScreen.tsx:577-581）。
4. **política 决策点**（实现前要拍板，不拍就会被实现者随手定）：
   - turns 非空时点历史：**替换整场**（clearTurns 后 hydrate）还是**追加**？追加会让 buildAdviseHistory 把两场不相干对话缝进同一 history。
   - 尾轮 running 时点历史：禁点（UI 置灰）还是排队？
   - 同一条目重复点击：幂等闸（turns 里已有该 run id 就滚动过去不重插）。
5. 渲染差异处理（票面问的「抽屉点进来的轮 vs 本 session 问出来的轮」）：差异恰好全部集中在 `hydrated` 判别上——历史轮天然不是 isLast 之外还要：无分析面板（或替代行）、无引用 chips 行（refs=null 自然不渲染 RoomScreen.tsx:303）、原始流 toggle 要么藏要么空。followup chips 只挂尾轮+complete（RoomScreen.tsx:293-294）——hydrate 条目若是尾轮且 advice 路带 followups，chips **会出现且可点**（点了就走 askWithRefs 正常续问，反而是免费的正向功能）。

事实代价（不改就存在）：
- 续问落库是**平铺新行**，与被恢复那条无任何关联——历史列表看不出「这几条是一场对话」，回看时对话结构永久丢失（这正是 (b) 要买的东西）。
- refs / 过程 / 短答路 followups 不可恢复（§3）。
- F5 后 hydrate 的场子照样清空（clearTurns 卸载纪律 RoomScreen.tsx:543）——「继续问」的成果仍只活到离开议事室为止，但每一问都已各自落库。

门面事实：`scripts/gates/` 无任何锚在 `.lite-room-history` / `adviseRuns` / `data-room-turn` 上的判据（grep 零命中）；gate snippet 锚的是 `.lite-room .nexus-followup-composer` 位置（live-frontend-gate.snippet.js:654, 685-686, 896-897）与 board 树——(a) 不动这些。十道门读 `__lite2Store.getState().run.status`（store.ts:360-363）——hydrate 把尾轮镜像置 'complete'，与门的既有语义一致（complete 本来就是「可以继续问」态）。

### (b) 真线程：advise_runs 加 thread_id（迁移 0016）

迁移本体：新文件 `eval-harness/db/migrations/0016_advise_runs_thread.sql`（0015 是现存最大号）：`ALTER TABLE avery.advise_runs ADD COLUMN IF NOT EXISTS thread_id text` + 索引 `(context_id, thread_id, seq)`。`_ensure_schema` 每次 bootstrap 全量重放（pg_registry.py:134-153：每条迁移 lock_timeout 3000ms + statement_timeout + 整体重试退避——ADD COLUMN IF NOT EXISTS 幂等、无 ACCESS EXCLUSIVE 长锁风险，符合 increment-only/不 DROP 纪律 0012:21-23）。同一文件自动应用到 Supabase（本地/生产等价 by construction）。存量行 thread_id NULL = 单轮线程，读端要定 NULL 归组策略。

后端改动面（比 (a) 大一个量级，全是双胞胎/锁步）：
- `AdviseRun` dataclass 加字段（registry.py:92-106）。
- `append_advise_run` **两份**签名+实现（registry.py:849-864 内存 / pg_registry.py:716-735 pg）+ `list_advise_runs` 两份（866-871 / 737-748，或新增按线程读法）+ 协议（registry.py:1269-1273）——**test_registry_protocol 离线断言两 adapter 参数表逐一相同**，四处必须同拍。
- `AdviseRequest` 加 `thread_id`（app.py:150-174 一带，additive optional 同 references/history 纪律）；`_persist_advise_run` 透传（app.py:344-371）。
- **thread_id 回传通道**：前端要知道「这场对话的 thread_id」才能续写同线程——第一问服务端铸 id 后必须经 manifest/SSE 事件带回（现行 manifest 契约无此字段），streamSource 也要认这个新键。这是 (b) 里最容易被低估的一段：动的是 /advise 流事件契约，不只是历史读面。
- 读面：`GET /advise-runs` 返回体加 thread_id（LiveAdviseRunEntry 同步 transport.ts:535-543），或另立 `/advise-threads` 分组端点。
- 测试面：test_advise_runs_http.py（离线电池，契约键断言 74-75 要扩）+ test_registry_contract 的 @needs_db 重启孪生 + 协议锁步。**动 schema 必跑 needs_db 或预检**（离线套看不到 pg 持久层是已知盲区）。

前端改动面：
- store 加 `currentThreadId`（askLive 请求带上；**公司域清理三抄本各加一行** store.ts:854 / 890 / 1522，漏一处=A 公司线程 id 带进 B 公司）。
- 历史抽屉按线程分组渲染（现 flat map RoomScreen.tsx:435-469 重写）；「点线程恢复整场」= (a) 的 hydrate 机制 ×N 轮（逐行转 LiveTurn，排序按 seq/created_at 升序回放）。
- (a) 的全部前端改动面照单全收（hydrate action / 判别渲染 / 政策决策点）。

### (c) Claude 式会话列表侧栏（在 (b) 之上的 UI 增量）

- 壳的事实：lite2 是顶栏 9-tab + 单 scene 的壳（ScreenView Lite2App.tsx:232-237；room 只是 SCREEN_PATH 之一 routes.ts:56-58）；顶栏已因窄屏溢出被点名（routes.ts:84 注释）。侧栏两种落法：room 屏内左栏（改 `.lite-room` 布局，波及面小）vs shell 级全局侧栏（对齐 Claude.ai 但动全站布局语法）。
- CSS 面：历史抽屉段整段退役重做（lite2.css:8240-8336）；room 滚动区/composer 让位关系重排；**视口高度/宽度让位是已知盲轴，改完布局必截图人眼过**（门全绿≠布局对）。
- 门风险：composer 位置判据（snippet.js:896-897 `composerInScroll/composerOutside`——composer 必须在滚动区外）与 `.lite-room` 树锚点是现行判据，侧栏若改变 DOM 嵌套要同拍改门。
- 交互增量的现状缺口：线程改名（title 列现成且 lite2 恒空写，可征用）；**删除**（现无 DELETE 端点，v1 明确只读 ingest_api.py:474——侧栏套路的「删除对话」要新开端点+两 registry+授权门）；「新对话」按钮（≈ clearTurns + thread_id 重置，便宜）。

---

## 5. 顺手盘：文案/密度/删除/refs

- **文案**：入口「之前问过的」（zh.ts:1247）/ 'Asked before'（en.ts:1737）——名词短语挂计数，非经典 SaaS 的「历史 / History / 会话列表」语汇；位置右上 ghost 按钮（z44 absolute，lite2.css:8243-8249）也非经典位（Claude/Notion 是左侧栏/顶部导航）。
- **展示密度**：单行 ellipsis 问题 + 11px 日期，无标题行、无按天分组、无搜索、无预览摘要；50 条硬上限无分页（registry.py:866-871 limit=50，端点不透传 limit 参数 ingest_api.py:482）。展开体直接塞整张判读卡（680px 宽抽屉，lite2.css:8256-8257 注释说明 440 会挤成一列大字）——「列表→详情」两级密度都偏重。
- **无删除接口**：ingest_api.py:474 明文 v1 无删除；registry 协议无 delete_advise_run（registry.py:1269-1273）；pg 的 `delete()` 是 context 级整删。任何「删除单条/单线程」都是新端点+双 registry+测试的增量。
- **refs 随历史恢复**：0012 拍板不存（迁移头注 5-10）；#64 references 只进请求（transport.ts:93-95），engine 注入后不回流不落库。要恢复需：advise_runs 加列（或 jsonb 键）落 refs → 写 hook 透传（app.py:344-371）→ 读面契约 → LiteTurnView 渲染（RoomScreen.tsx:303-316 现成）。即**必然带迁移**，不属于 (a) 的范围——列为缺口。
- 附带事实：`/room?q=&refs=&qh=` 深链中继已存在（routes.ts:156-160；useRoomQueryRelay Lite2App.tsx:251-268，灌 flowStore.composerDraft）——若重构后历史入口搬离 room 屏（如资料库/首页/全局侧栏），「点历史→跳 room」的**导航半程**可复用这条现成通道（但它只预填 composer，不 hydrate 轮次；hydrate 仍要 §4(a) 的 store action + 一个新的传参约定，例如 `/room?resume=<run_id>`）。

## 6. 一句话事实总结

只读抽屉与会话流之间隔着一个「LiveAdviseRunEntry → LiveTurn」的 hydrate 函数：终局产物三件（question/advice/answer）无损、链路已被抽屉证明；过程四件（流/相位/结构化引用/计数）与输入一件（refs）结构性没存，短答路 followups 顺带丢失。(a) 纯前端 ~100 行 + 三个政策拍板；(b) 加一列迁移但真实成本在 registry 四处锁步 + thread_id 回传要动 /advise 流契约；(c) 再往上是壳级布局与门锚重排。

