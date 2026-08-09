# #78 · 开工前设计裁定（S3，wave 2 · advise-threads 真线程）

> 侦察正源是 `recon-history.md`；议事室现状正源是 `receipt-75-room-claude.md`。
> 本文件只记**本次开工新查出来的事实**与**据此做的裁定**，供实现期与回执引用。
> 行号采于本 worktree（= main + wave 1，`8b555ad`）。

## 0 · 转述行号全废（先说这个，因为它决定怎么读票面）

`recon-history.md` 与票面里所有行号都是 **#75 之前**的快照。八路独立复核实测：

| 对象 | 转述 | **实际** |
|---|---|---|
| `LiteRoomHistory` | RoomScreen.tsx:403-475 | **473-545**（函数体 479-545） |
| 抽屉挂载点 | :678 | **:860** |
| `coerceAdvice` 调用 | :437-438 | **:508** |
| 内存 `append_advise_run` | registry.py:849-864 | **859-874** |
| 内存 `list_advise_runs` | :866-871 | **876-881** |
| `ContextRegistryProtocol` advise 段 | :1269-1273 | **1279-1283** |
| 公司域清理三抄本 | store.ts:854 / 890 / 1522 | **887-920 / 930-964 / 1630-1676**（`adviseRuns` 分别在 :902 / :938 / :1648） |
| `askLive` | 票面未给 | **store.ts:1377-1477** |
| abort 判据出处 | streamSource 注释指 transport.ts:1201-1207 | **1216-1222**（注释本身已过期） |
| `roomHistoryTitle` | recon-copy 写 zh:1247 / en:1737 | **zh.ts:1311 / en.ts:1807** |
| room history CSS 段 | lite2.css:8240-8336 | **8271-8367** |

`app.py:344-371`（`_persist_advise_run`）、`pg_registry.py:716-748` 两处转述**是对的**。

## 1 · 新查出来的硬事实（都会改变做法）

### 1.1 后端根本没有 `phase` 事件——四相是前端派生的
SSE 只有 7 种：`started / think / tool / observe / nudge / manifest / error`（构造点全在
`service/engine.py`，`started` 在 :95-96 只有 5 个键）。四相是 `streamSource.ts:248/254/259`
的 `countStep` 自己数出来的。→ thread_id 回传**只能挂在既有帧上**，别新开帧型。

### 1.2 新开一个 SSE 事件型 = 前端静默吃掉
`parseSseRecord`（transport.ts:1596-1618）整帧 `JSON.parse` 原样返回，`LiveAgentEvent` 有索引
签名（:62）→ **多发的键 TS 不报、运行时不崩**；而 `applyEvent`（streamSource.ts:229-321）是
`switch (ev.type)` + `default: break`（:318）→ **未知帧型整帧丢弃，一声不吭**。
更毒的是 `started` 那一 case（:235-238）今天是**裸 `break`**——挂在 started 上也要显式赋值。
→ 「后端发了、前端没接」在今天这条链上**不会有任何一层红**。判据必须落在 store 的新槽位的**值**上。

### 1.3 `ContextRegistry.clear()` 从来不清 `_advise_runs`
`registry.py:1235-1245` 清了九本账，唯独漏掉 `_advise_runs`（:826）。
既有测试没被咬到，纯因为 `test_advise_runs_http.py` 每次用**新 context id**。
→ #78 要写「按场分组」的测试，一旦复用固定 cid 就会吃到上一条测试的残留轮。**在本票血缘内修掉**。

### 1.4 `test_registry_protocol.py` 的钉子与票面转述不同
票面警告的 `assert "delete" not in protocol_members()`（:65-73）**只钉 `delete` 这一个名字**，
没有任何「成员名单必须等于某集合」的白名单。加方法、加参数都不被它挡。
#77「走独立模块绕开」的理由也不是这道门，而是「绝不新造 `CompanyContext`」（`file_delete.py:8-12`）。
→ **#78 不能照抄 #77 的绕法**：thread_id 是 seam 上的真列，必须走 Protocol + 双 adapter。

真正的钉子是 `:53-62`：两个 adapter 的签名 `(name, kind, default)` 必须逐字相同。
**它的暗区**：从不拿 `ContextRegistryProtocol` 自己那份签名当基准——只改 Protocol、两 adapter 都不改，
三条测试全绿。→ 本票顺手把这条暗区补上（见 §4-10）。

### 1.5 pg 的 SELECT 列序与元组解包裸耦合
`pg_registry.py:743` 的 7 列 SELECT 与 `:748` 的 7 元组解包**手写对齐、无常量无键名**。
加列插中间是 text↔text 错位，**pytest 与真库都不会红**。同文件 `_FORM_SUB_COLS`（:877-879）+
`_form_submission_from_row`（:894-906）是已经吃过这个亏之后立的正面先例，注释（:965-966）就是为它写的。
→ 本票照 form 的先例把 advise 的列表提成常量 + 单点解包，thread_id 只追加在末尾。

### 1.6 `data-room-composer` 从未落地
`lite2.css:481-482` 与 `design-75-73.md:115/127/137` 都写着门已改判到 `[data-room-composer]`，
但全仓 grep 只有这三处**注释**命中，DOM 上没有这个属性；门实际用的是
`.lite-room > .nexus-followup-composer`（room-conversation:352、at-references:538）。
→ 写新门的选择器**别照注释抄**，会全空。

### 1.7 历史面板在门与像素里都是**零覆盖**
`.lite-room-history*` 与 `adviseRuns` 在 43+ 道门里 grep 零命中；`live-frontend-gate.snippet.js`
也没有。像素侧：`visual.spec.mjs` 的 room 四张拍的是 `contextId===null` 的无材料态
（`RoomScreen.tsx:484` 直接 `return null`），`visual-data.spec.mjs:48` 的 `SCREENS` 压根不含 room。
→ 「改历史面板必漂基线」是**错的预判**（与 #75 那次「必漂」反着骗是同一族）。
反过来说：**没有任何既有网**，新门必须自己长出全部判据。

### 1.8 `run` 是尾轮镜像，且七道门读的是**顶层** `run.status`
`store.ts:379-384` 的碑文 + `:1440-1449` 的「只在尾轮同步」。
读顶层的门：answer-split / aria-zh / button-family / contrast-smalltext / locale-parity /
room-usability / topbar-clearance；读 `turns[last]` 的：at-references / room-claude-rework /
room-conversation。→ hydrate 不同步顶层镜像＝七道门看到 `idle`（不红，但也**验不到**）。

### 1.9 `verify-room-conversation.mjs` ⑥ 是本票的正面撞车点
`:361` 断言离开议事室再回来 `turns===0`，`:367` 断言 localStorage 里搜不到任何一问的正文。
→ **hydrate 只许由「点某一场」显式触发**；进屋不自动恢复、不落任何 storage。这条不改判。

### 1.10 短答路 followups 被丢弃的确切位置是 358-362，不是 358-361
`app.py:358-362`，丢弃发生在 `:361`（`answer = a["text"]`）。`answer` 列是纯 text
（`registry.py:106` + `0012:38`）。而 advice 路的 followups 存在 jsonb 里（`contract.py:171-173`）。
**两条路不对称。**

## 2 · 三个政策拍板（票面要求票内定并记档）

### (a) hydrate 是**替换**当前 turns，不是追加
追加会让 `buildAdviseHistory`（askHistory.ts:45-61）把两场不相干对话缝进同一个 `history` 数组，
而续问只能带**一个** thread_id ——**屏上两场、落库一场**，是结构性撒谎。
替换的语义干净：「打开这一场」。代价：屏上正在进行的那场会被顶掉（未落库的中断轮真的没了），
所以必须配 (b) 的禁点闸 + 幂等闸。

### (b) 尾轮 running 时**禁点**，不排队
排队要引入一个「等这轮完了再切」的隐藏状态机，而 #75 刚把「假 complete」这类隐藏状态清干净。
禁点是诚实的：控件 `disabled` + 一行原因说明。
**两把锁必须配两道门**（碑文：belt-and-braces 会让内层规则免疫变异）：
锁① 控件 `disabled` 属性；锁② `hydrateThread` 自带 store 级 busy 闸（`askLive` 的闸 `:1383-1384`
不覆盖这个新入口）。→ 判据 ⑧a 判 `disabled` 属性本身，判据 ⑧b 判「绕开 UI 直接调 action 也不动 turns」，
变异 M-B / M-C 各打一把。

### (c) 重复点同一场 = **幂等**
`get().threadId === thread.thread_id` 时只关面板 + 滚到底，**不重灌 turns**。
这不只是省事：用户可能已经在这场里续问过新轮（那些轮已落库但当前 `adviseThreads` 快照里没有），
重灌 = 把刚问的那几轮从屏上抹掉。幂等闸是**防丢**不是防抖。

## 3 · 契约裁定

### 3.1 thread_id 由**服务端**铸，经 SSE 回传（不是前端自己发一个 uuid）
理由三条：
1. 票面就是这么写的（「响应流回传 thread_id ——前端才知道续写哪场」）。
2. **老后端可辨**：`references` 有 `weaveRefs` 把引用织进正文当兜底（transport.ts:65-68），
   thread_id **没有等价兜底**——老后端静默忽略 `thread_id` 时，前端会以为续问落同场、
   实际每问一场新的。服务端回传就是那条对账通道：没回传 → 前端 `threadId` 停在 null →
   界面老老实实每问自成一场，**不谎称在续场**。
3. 「新行永远有 thread_id」让 `NULL` 无歧义地只表示「#78 之前的存量行」。

铸点在 handler（`app.py` 的 `/advise` 内）**而不是** `on_manifest` hook 里：`_sse` 的
`on_manifest` 被 `except Exception: pass` 整个包着（:296-298），在那里赋值失败会静默。

### 3.2 回传挂在 `started` **和** `manifest` 两种帧上
- `started` = 早期对账（第一帧就知道这场的 id）。
- `manifest` = `stream:false` 的缓冲路只回 manifest（`app.py:465`），不挂就拿不到。

**不进 `manifest["advice"]`**：`test_service_contract.py:61-62` 是全仓唯一的 `<=` 键集闭包断言，
多一个键直接红。挂 manifest **顶层**安全（`test_service_http.py` 只做在场性断言）。

### 3.3 `thread_id` 管归档，`history` 管推理——服务端**不**按 thread 自动补历史
`/advise` 仍然只认请求体里的 `history`（`app.py:440` `_run_events(sit, req.history)`）。
理由：
- 前端的 `buildAdviseHistory` 本来就从 `turns` 组装，而 hydrate 出来的轮**就在 `turns` 里**——
  「点一场 → 续问带上下文」在组装层**零改动**成立（recon-history §2.3 已证）。
- 服务端自动 hydrate 会让 `test_advise_history.py:187/217/239` 三条轮数断言全红，
  且与 `history.py` 头注「Nothing here is persisted」的语义打架。
- 两条路都塞 = 双份上下文。

一句话记档：**thread_id 回答「这一行属于哪一场」，history 回答「这一问带多少上下文」。**

### 3.4 存量 NULL 语义 + 空串映射
`thread_id == ""`（dataclass 侧）⟺ `NULL`（列侧）⟺ **无场归属**，读侧一律呈现为
「自成一场的单轮」。pg 侧沿用同文件既有的 `x or None` / `x or ""` 惯例，
**不做回填 UPDATE**（`_replay_migrations` 每次 bootstrap 全量重放，一条回填会变成每次开机全表扫）。

### 3.5 分组读走**新端点**，旧端点一个字节不动
`GET /team/{id}/advise-runs` 保持平铺 `{context_id, runs:[...]}` —— 它的 4 条测试
（`test_advise_runs_http.py:65/72/94/102`）留作回归网；`thread_id` 靠 `asdict` **自动**进 payload。
新增 `GET /team/{id}/advise-threads` 回 `{context_id, threads:[{thread_id, runs:[...]}]}`。

**limit 语义必须重定义**：今天两腿都是「按**行**取最近 50」。真线程后一场可能十几轮，
50 行只装两三场，**且最老那场被腰斩成半截对话**——hydrate 出来是一段没有开头的聊天记录。
→ 新方法 `list_advise_threads(context_id, limit=20)` 的 limit 是**场数**，
先定最近 N 场、再取这些场的全部行。**绝不出半截场。**

### 3.6 短答路 followups：**不补存**（票内裁）
1. `answer` 列是纯 text，要存 followups 就得再加一列、或把 answer 改成 jsonb ——
   后者会打破「advice 与 answer 互斥」这条既有契约（`LiteAdviceCard` 的分流靠它）。
   本票的迁移预算是**一列 thread_id**，为一组装饰性 chips 再动一次表不划算。
2. 缺失是**可辨的**：hydrate 出的短答轮就是没有 chips，与「有 chips 但点了没反应」不是一回事。
3. 价值面窄：followups 是「接着可以问」的快捷入口，而 #78 给的正是「直接接着打字问」的能力。

对称记账：**advice 路的 followups 可以恢复**（它们在 jsonb 里），hydrate 时另调 `coerceFollowups`
从 `advice.followup_questions` 取（`coerceAdvice` 白名单构造，不产这个键——streamSource.ts:473-523）。
所以历史场的尾轮**会**出 chips（advice 路）/ **不会**出（短答路）。这条不对称写进回执与文案。

### 3.7 跨公司 thread_id 不做 DB 校验，只做形状校验
所有分组查询都 `WHERE context_id = %s` 收口，所以拿 A 公司的 id 去问 B 公司**不会泄露也不会并场**，
最坏结果是 B 公司下多一个同名的场。做「必须在本 context 有行」的校验反而会咬自己：
被中止/被红线拦下的第一轮**不落行**，那时客户端已经握着 id，校验会把用户眼里的一场劈成两场。
→ 只做形状校验（`^[A-Za-z0-9_-]{1,64}$`，坏值当没传、铸新的，**不 422**——同 `locale` 的降级纪律）。
前端侧则把 `threadId` 加进公司域清理三抄本，自家 UI 根本产不出跨公司复用。

## 4 · 落地清单（含每处的锁步面）

| # | 文件 | 动作 |
|---|---|---|
| 1 | `db/migrations/0016_advise_runs_thread.sql` | 新建：`ADD COLUMN IF NOT EXISTS thread_id text` + `(context_id, thread_id, seq)` 索引 + COMMENT。无回填 |
| 2 | `avery/ingest/registry.py` | `AdviseRun.thread_id`；`new_thread_id()`；`AdviseThread` dataclass；`append_advise_run` 加 kw；`list_advise_threads`；**Protocol 三处同拍**；`clear()` 补 `_advise_runs` |
| 3 | `avery/ingest/pg_registry.py` | 列常量 `_ADVISE_COLS` + `_advise_run_from_row` 单点解包；append 加列；`list_advise_threads` 两趟 SQL（先定场、再取行） |
| 4 | `service/threads.py` | 新建：`normalize_thread_id` + `THREAD_ID_MAX` |
| 5 | `service/app.py` | `AdviseRequest.thread_id`；handler 里铸/归一；`_with_thread_id` 注入生成器；`_persist_advise_run` 透传 |
| 6 | `service/ingest_api.py` | 新端点 `GET /team/{id}/advise-threads`（同一张授权门） |
| 7 | `src/lite2/transport.ts` | `AdviseRequest.thread_id?`；`LiveAdviseRunEntry.thread_id`；`LiveAdviseThread` / `LiveAdviseThreadsPayload`；`fetchAdviseThreads?`（可选，stub 不用改） |
| 8 | `src/lite2/streamSource.ts` | `LiveRunState.threadId` + `emptyRunState()` 同改；`applyEvent` 的 `started` / `manifest` 两 case 显式取键 |
| 9 | `src/lite2/store.ts` | `threadId` 顶层态；`adviseThreads` 三态；`refreshAdviseThreads`；`hydrateThread`（busy 闸 + 幂等闸 + 尾轮镜像）；`askLive` 请求体条件展开 + 回传上提；`clearTurns`/`resetRun` 清 threadId；**公司域三抄本各加两个字段** |
| 10 | `src/lite2/screens/RoomScreen.tsx` | `LiteRoomHistory` 重写成按场列表；`LiteTurnView` 认 `hydrated`（藏四相、藏 HUD、出说明行）；面板挪进 `contextId !== null` 分支 |
| 11 | `src/shared/i18n/{zh,en}.ts` | 新键一组（§5） |
| 12 | `src/lite2/styles/lite2.css` | room-history 段改造（退役 `-body` 抄本，新增场行样式） |
| 13 | `eval-harness/tools/verify-room-threads.mjs` | 新门，入册 A 区 room-conversation 之后 |
| 14 | 测试 | `test_advise_threads.py` 新增；`test_registry_contract.py` 孪生扩；`test_registry_protocol.py` 补 Protocol-vs-adapter 三方比对；`test_advise_runs_http.py:74` 键元组加 `thread_id` |

## 5 · 新文案键（zh + en 同一 commit，扁平 camelCase，零 em-dash）

| 键 | 中文 | 英文 |
|---|---|---|
| `roomHistoryCount` | {n} 场 | {n} threads |
| `roomHistoryTurns` | {n} 轮问答 | {n} exchanges |
| `roomHistoryOpenAria` | 打开这场对话，接着往下问 | Open this conversation and keep asking |
| `roomHistoryCurrent` | 就是眼下这场 | You are in this one |
| `roomHistoryBusy` | 这一轮还在答，答完才能切 | Wait for this answer to finish |
| `roomHistoryEmptyThread` | 更早的单条记录 | Earlier single question |
| `roomTurnFromHistory` | 这轮是从历史载入的，当时的分析过程没有留存 | Loaded from history. The steps were not stored. |

`roomHistoryTitle`（现值「之前问过的」）**不动值**——文案批改归 #79，本票只让它旁边的计数
从「条」变成「场」并由 `roomHistoryCount` 显式说出单位。
⚠ aria 值必须纯中文（`verify-aria-zh.mjs` 禁 ≥2 连续拉丁词或单个长度 ≥4 的拉丁词）→
`roomHistoryOpenAria` 里不许出现 `Avery`。

## 6 · 门与变异台账（设计期预判，实测结果写进回执）

| 判据 | 变异 |
|---|---|
| ② 回传落进 store 的 `threadId` | M-E 后端不注入 started/manifest 的 thread_id |
| ⑤ 点一场 → 整场 turns 在屏 | M-G 后端分组不按 seq 升序 → 顺序判据红 |
| ⑥ hydrated 轮不渲染四相 | M-D 去掉 `hydrated` 判别 |
| ⑦ 续问请求体带同一 thread_id | M-A 去掉 store 请求体里的条件展开 |
| ⑧a 历史条目 `disabled` | M-B 去掉 disabled |
| ⑧b 绕开 UI 直调 action 也不动 turns | M-C 去掉 store busy 闸 |
| ⑨ 同场再点幂等 | M-F 去掉幂等闸 |

⚠ 判据 ② 必须落在 **store 的 `threadId` 值**上，不能落在「请求发出去了/没崩」——
见 §1.2：thread_id 断链在今天这条链上不会有任何一层红。
