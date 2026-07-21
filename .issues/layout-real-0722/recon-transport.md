> 侦察原件 · 视角 `transport` · 2026-07-22 自动生成，未经人工编辑。

## 1. ADR 边界（精确复述）

### ADR-0002 `D:/avery/docs/adr/0002-frontend-stack-vite-react-framer-motion.md`
**对 transport 层实际上没有划任何边界。** 全文只定 stack：Vite + React + framer-motion，不用 Next、不用 vanilla。唯一沾边的一句在「理由」段：「不用 Next：纯静态 demo **无 SSR / 无 backend 需求**（见 ADR-0001）；`vite build` 出静态包，可静态托管」。这句已被 ADR-0020 决策 4 整体推翻（后端存在了）。**结论：ADR-0002 不是 transport 的约束源，把它当"动 transport 前要查的 ADR"是 kickoff 写手的记忆偏差。**

### ADR-0021 `0021-two-engine-core-vertical-packs-skins-dual-deploy.md`
与 transport 相关的三条：
- **决策 1/2**：内核 = 两个引擎。Advisor engine = `eval-harness`（think→tool→observe、红线校验器、cite-before-number、8 字段输出）；Ingestion engine = 上传→解析→红线安全结构化抽取→全向量 RAG→填充 Your team。前端只是这两个引擎的 HTTP 消费者。
- **决策 4（硬红线）**：红线内建到**抽取**——简历→人卡必须停在定性，绝不推出评分/排名/画像；`eval-harness/avery/redline.py` 校验器覆盖抽取产物。**这条是服务端的门，前端不得自建"绕过门"的数据通路**。
- **决策 5**：pluggable brain + pluggable embeddings + **pluggable retrieval（keyword 供离线/AFK 测试、vector 供真跑）**。⚠️ 这里的 "retrieval" 指**服务端 RAG 检索**（`AVERY_EMBEDDINGS=keyword`），**不是 UI 导航检索**，不能被援引成"顶栏搜索必须走后端"。决策 5 的双端部署部分已被 **ADR-0024** 取代（单 Vercel 前端 + 单法兰克福后端）。
- **决策 6**：商业护栏（sampler 不持久化）——已被 **ADR-0023-postgres** 明文取代（lite v1 落 Postgres 持久化）。

### 真正管 transport 的 ADR（0002/0021 之外，且更权威）
| ADR | 标题 | 对 transport 的约束 |
|---|---|---|
| **0020** | Avery 从 demo-only 毕业为 live lite 产品 | 决策 2：**两道数据 seam**（`StreamSource` / `TeamDataSource`）各两实现；决策 3：`?mode=story\|live`；**决策 4：后端 = Python FastAPI+SSE，SPA 只经 HTTP/SSE 调它，「LLM key 与 loop 绝不上前端」**（transport.ts:11 逐字引用这条） |
| **0022** | story/lite 同仓立墙（quarantine + lint 边界）；抽取主引擎换 LLM | 三壳互不 import 的机器闸（App.tsx:26 注释：ESLint no-restricted-imports） |
| **0023(ask)** | Ask 员工自述式快问的红线边界 | 边界1 问事不问人（保存前必过**服务端**红线门）；边界2 回执永不写进人卡（结构性：类型层无槽位，transport.ts:198-199）；边界3 永不跨人比分 |
| **0023(postgres)** | lite v1 公司工作区落 Postgres(Supabase) | 取代 0021 §6 的 ephemeral |
| **0024** | 单端部署：一个 Vercel 前端 + 一台法兰克福后端 | 取代 0021 §5；**跨境延迟是 transport 设计的现实约束** |
| **0026** | onboarding 全屏闸门页 + 克隆制一键示例团队 | `/demo/status` 能力探测 → 不出假按钮 |
| **0027** | cr 视觉对齐战役：规格驱动 | 上一战役纪律 |
| 0015 / 0018 | 产品语气去 SaaS 化 / 人情味降级为红线 | 人面零数字的上游 |
| 0025 | 指挥室对齐命名解锁 aurora 默认 | 命名/锁词纪律 |
| 0010 | calm cards vs gamified HP/MP HUD | 血条禁令来源 |

---

## 2. `D:/avery/src/lite2/transport.ts`（44,950 B）全部导出

**类型/契约**（无运行时）：`LiveAgentEventType`:20 · `LiveAgentEvent`:29 · `AdviseRequest`:61（`{situation, title?, company_context_id?}`）· `LiveTeamPayload`:69 · `DemoStatusPayload`:97 · `LivePersonCard`:104 · `LiveProjectCard`:116 · `LiveDecisionGrade`:131 · `LiveDecisionRuleHit`:133 · `LiveDecisionUnparsedField`:144 · `LiveDecisionCard`:150 · `LiveBriefingPayload`:178 · `LiveSignalCard`:185 · `AskQuestionKind`:201 · `AskStatus`:206（六词）· `AskQuestion`:208 · `AskReceipt`:216 · `AskRecipient`:222 · `AskDraft`:230 · `LiveFileStatus`:258 · `LiveFileEntry`:260 · `LiveFilesPayload`:271 · `LiveNoteEntry`:279 · `LiveNotesPayload`:286 · `LiveTransport`:292 · `AccountContextsPayload`:351

**`LiveTransport` seam（transport.ts:292-346）——必填 6 + 可选 5：**
```
streamAdvise(req, onEvent, onDone) => {abort}   // 必填
ingest(files) / fetchTeam(id) / saveAsk(d) / shareAsk(id) / fetchAsk(id)
fetchFiles(id) / fetchNotes(id)                  // 必填
readonly offlinePreview?: boolean                // stub 自我声明:319
fetchAccountContexts?() / claimContext?(id,tok)  // 可选:331,333
demoStatus?() / demoClaim?()                     // 可选:337,340
appendNote?(id, text, sourceExcerpt)             // 可选:345
```
🔴 transport.ts:328-329 明写：可选是刻意的——**加必填方法会让 stubTransport 编译不过**。任何本战役新增方法必须 `?:` + 调用方判空（标准姿势见 `demoStore.ts:23-27`）。

**函数导出：**
- `apiBase()`:377 — env `VITE_AVERY_API_BASE`（build 期内联，剥尾斜杠）→ 否则 `http://127.0.0.1:8137`（LOCAL_API_BASE:356）。配错只 `console.error` 不 throw（:385-392）。
- `httpErrorMessage(res?)`:416 — 状态码→人话，走非 hook 的 `getDict(resolveLocale())`（零 React 依赖，:409）。映射：misconfigured 优先 → 无 Response=offline → 429 带 Retry-After 秒数 → 413 tooLarge → 415/422 unsupportedType → **404=staleToken（"数据还在，是这台浏览器打不开了"，:431-434）** → ≥500 serverError → 其余 generic。
- `TransportError`:454 — `{message(已本地化整句), endpoint, status}`。**诊断透传就是这个类**：endpoint/status 挂字段，开发者串（`ingest: HTTP 429`）只进 `console.debug`（transportError():468-471），绝不上屏。
- `transportError(name, res?)`:468 · `retryAfterSeconds`:476(私有，只认纯数字)
- `OWNER_TOKEN_HEADER = 'X-Avery-Token'`:494 · `ACCOUNT_TOKEN_HEADER = 'X-Avery-Account'`:501（两凭据两 header，刻意不复用 Authorization，:497-499）
- `storedOwnerToken(contextId)`:524 · `forgetAllOwnerTokens()`:559（登出抹全部）
- `createHttpTransport(base=apiBase())`:571
- `parseSseRecord(raw)`:798 — 解 `event:`/多行 `data:`，跳 `:` 心跳，data 无 type 时用 event 行兜底

**createHttpTransport 内部（571-795）—— endpoint × 错误处理逐条：**
| 方法 | 方法/URL | header | 失败 |
|---|---|---|---|
| streamAdvise:614 | POST `${base}/advise`，body `{...req, stream:true}` | Content-Type + `Accept: text/event-stream` + authHeader(company_context_id) | `!res.ok \|\| !res.body` → `transportError('advise', res)`；SSE 记录切分用 `/\r?\n\r?\n/`（:642，只找 `\n\n` 会零帧，od -c 实证）；abort 走 `controller.signal.aborted`→onDone() 无错 |
| ingest:661 | POST `/ingest`，FormData `files` | 仅 accountHeader（**刻意不要求登录**:664） | `transportError('ingest', res)`；成功 `rememberToken(context_id, owner_token)` |
| fetchTeam:680 | GET `/team/{encodeURIComponent(id)}` | authHeader(id) | `transportError('team', res)` |
| demoStatus:689 | GET `/demo/status` | 无 | `transportError('demo', res)` |
| demoClaim:695 | POST `/demo/claim` | **刻意不带账号 header**（:697-698） | 同上；rememberToken |
| appendNote:707 | POST `/team/{id}/notes` body `{text, source_excerpt}` | JSON + authHeader | `transportError('notes', res)` |
| saveAsk:721 | POST `/ask` body=整个 AskDraft | JSON + authHeader(draft.company_context_id) | `transportError('ask', res)`；成功记 `askContexts[id]=ctx`（:594） |
| shareAsk:736 | POST `/ask/{id}/share` | authHeader(askContexts[askId]) | `transportError('ask share', res)` |
| fetchAsk:745 | GET `/ask/{id}` | 同上 | `transportError('ask', res)` |
| fetchFiles:755 | GET `/team/{id}/files` | authHeader | `transportError('files', res)` |
| fetchNotes:764 | GET `/team/{id}/notes` | authHeader | `transportError('notes', res)` |
| fetchAccountContexts:774 | GET `/account/contexts` | accountHeader | `transportError('account contexts', res)` |
| claimContext:786 | POST `/account/claim` body `{context_id, owner_token}` | JSON + accountHeader | `transportError('account claim', res)` |

统一出口 `send(name,url,init)`:604 — 包 fetch 的 reject（连接拒绝/混合内容/CORS/离线）成 `transportError(name)`（无 status）；**AbortError 原样抛回**（:608）。🔴 全局纪律：**token 只进 header，绝不进 URL**（:490, :719, :785）。

---

## 3. 桩 / 流 / 分流判定点

**`stubTransport.ts`**（18,869 B）
- `createStubTransport()`:204 —— `emitAdviseScript`:221 用 `setTimeout(40ms)` 链回放**写死 7 帧**（started/think/tool/observe/think/manifest{advice}/manifest{ask-draft}，:228-246），不用 rAF（headless 停摆）。`offlinePreview: true`:284 是它对 AskCard 的自我声明（AskCard.tsx:37 据此切红线提示文案）。
- 确定性数据：`STUB_CONTEXT_ID='ctx_stub_demo'`:28 · `STUB_PEOPLE`:32 · `STUB_TEAM`:51 · `STUB_ADVICE`:105 · `stubAskDraft`:136 · `RECEIPT_BOOK`:156。fetchTeam/fetchFiles/fetchNotes 对未知 id **大声 404**（:303,:310,:316）不静默回落。fetchAsk:348 每拉一次多揭示一份回执（shared→collecting→closed 可重放）。
- **不实现** demoStatus/demoClaim/appendNote/account 族 → 调用方判空即降级。
- `isStubTransportSelected()`:374 —— `?transport=stub`；`resolveTransport()`:387 —— stub 或 `createHttpTransport()`。

**`streamSource.ts`**（25,914 B）—— 不打网络，纯「SSE 事件 → 运行态」折叠器。
- `createLiveAgentSource(transport)`:129 持有 transport，`run()`:132 调 `transport.streamAdvise`（:159），每帧 `applyEvent` + `emit()`（:137-143 逐帧换新引用供 React.memo）。
- `applyEvent(state, ev, push)`:184 —— started 不落行不点相位:190；think:194；tool:205（`cite`→recordCite，countStep(toolPhase)）；observe:211；nudge:217；**manifest:223 —— `ev.kind==='ask-draft'` → `coerceAskDraft(ev.ask)` 落 `state.askDraft`（:225-233，不判 run 完成）；否则 `coerceAdvice(ev.advice)` + status='complete'**；error:245 —— `state.error = ev.error ?? null`（不再自编 'unknown error'）。
- 四相派生 `toolPhase`:268（read_case→read；recall/cite→crosscheck；draft_advice→act；未知→method）。
- `coerceAdvice`:395 / `coerceAskDraft`:448（含六词 status coerce，未知折 closed 绝不折 draft）。

**mode=live 与 demo/story 的分流判定点（三层，全在 URL query）：**
1. `src/shared/mode.ts:25 resolveMode()` — `?mode=` > `VITE_AVERY_MODE` > 默认 **story**。
2. `src/App.tsx:29-31` — `mode !== 'live'` → `AmbientCanvasShell`（story 壳）；`live` → `resolveVersion()==='2' ? Lite2App : LiteApp`。
3. `src/shared/version.ts:28 resolveVersion()` — `?v=` > 默认 **'2'**。
4. **传输分流独立于 mode**：`store.ts:350` `const defaultTransport = import.meta.env.DEV ? resolveTransport() : createHttpTransport()` —— stub 通道**只在 dev 存在**，生产构建被 Vite DCE 掉（:344-349 注释：线上任何人挂 `?transport=stub` 都会看到编造数据 = 诚实性事故）。
5. 运行时替换口：`store.ts:392 setTransport()` 同时重建 `agentSource`。

⚠️ 注意：这里没有第三种"demo 数据源"。`demo` 指的是 **ADR-0026 的一键示例团队**（POST /demo/claim 克隆真 context），走的是**与上传完全相同的落地路径**（transport.ts:696），不是一个前端分流分支。

---

## 4. 后端全部路由（`D:/avery/eval-harness/service/`）

app.py:95-114 挂 4 个 router；`docs_url/redoc_url/openapi_url` 全 None（app.py:66-68，无 OpenAPI 可探）；`IngestGuardMiddleware`(app.py:75) 在 CORS 内侧；CORS 白名单 `AVERY_CORS_ORIGINS`(app.py:81)。

| 方法 | 路径 | 定义 | 请求体 | 响应 | 鉴权 |
|---|---|---|---|---|---|
| GET | `/health` | app.py:238 | — | `{status, service, brain, live, embeddings, extractor, extraction_mode, memory{rss_mb,warn_mb,high,available}, llm_calls_remaining, degraded}` | 无 |
| POST | `/advise` | app.py:264 | `{situation(min1), title?, company_context_id?, stream=true}` | stream=true → SSE `event: started\|think\|tool\|observe\|nudge\|manifest\|error`；stream=false → `{...manifest, events[]}` 或 502 | X-Avery-Token / Authorization / X-Avery-Account（给了未知 ctx → 404） |
| POST | `/ingest` | ingest_api.py:206 | multipart `files[]` | LiveTeamPayload + `owner_token`(+`account_linked`) | 开放（游客路径）；限流/体积门 |
| GET | `/team/{context_id}` | ingest_api.py:351 | — | team payload（**不回 owner_token**） | owner_token 或账号，否则 404 |
| GET | `/team/{id}/notes` | ingest_api.py:366 | — | `{context_id, notes:[{id,created_at,text,source_excerpt}]}` 新→旧 | 同上 |
| POST | `/team/{id}/notes` | ingest_api.py:390 | `{text(1..4000), source_excerpt(≤200)}` | `{context_id, note}`；红线拒 → 422 | 同上 |
| GET | `/team/{id}/files` | ingest_api.py:417 | — | `{context_id, files:[{idx,filename,size_bytes,mime,doc_kind,uploaded_at,n_chunks,status}]}` | 同上 |
| GET | `/team/{id}/files/{idx}` | ingest_api.py:435 | — | 原始字节 `application/octet-stream` + attachment + nosniff | 同上；**transport.ts 无对应方法** |
| POST | `/ask` | ask_api.py:308 | `AskBody{company_context_id(必填), questions?[{id,kind,text}], recipients[{id,name}], comment_prompt?, thread_hint?, situation?}` | `{id,status,questions,recipients[{id,name,token?,link?,receipt?}],comment_prompt,company_context_id,created_at,expires_at,generation_mode,receipts_summary?}`；红线违规 422 | owner_token/账号 |
| POST | `/ask/{id}` | ask_api.py:333 | AskBody | 同上；非 draft → 409 | 同上；**前端未接线** |
| POST | `/ask/{id}/share` | ask_api.py:357 | — | 同上（幂等；revoked/expired/closed → 409） | 同上 |
| GET | `/ask/{id}` | ask_api.py:382 | — | 同上（status 为服务端有效词） | 同上 |
| POST | `/ask/{id}/revoke` | ask_api.py:395 | — | 同上；closed → 409 | 同上；**前端未接线**（en.ts:1388 `revoke:'Withdraw this ask'` 是悬空文案键） |
| GET | `/r/{token}` | ask_api.py:610 | — | HTML（员工 H5，token 在 URL 是唯一有意的例外） | share token |
| POST | `/r/{token}/answer` | ask_api.py:656 | 表单 | HTML | share token |
| GET | `/account/status` | auth_api.py:54 | — | `{configured, signed_in}` | **无鉴权**（能力探测） |
| GET | `/account/contexts` | auth_api.py:67 | — | `{context_ids:[]}`（不回 owner_token） | 账号 header，否则 401 |
| POST | `/account/claim` | auth_api.py:82 | `{context_id, owner_token}` | `{context_id, claimed:true}` | 账号 + owner_token 双证 |
| GET | `/demo/status` | demo.py:114 | — | `{available, ready}` | 无鉴权无副作用 |
| POST | `/demo/claim` | demo.py:127 | — | team payload + `owner_token` + `demo:true` | 无 |

**提问/ask/chat 类** = 只有 `POST /advise`（LLM 提问流）与 `/ask*` 族（员工自述问卷，不是 chat）。
**搜索/search 类 = 零。**（`grep -n "@app\.\|@router\."` 全量已列，无任何 search/query 路由）
**成员/项目列表类** = 只有整包 `GET /team/{id}`，没有分离的 `/people`、`/projects`，没有分页、没有过滤参数。

---

## 5. 关键问题

### 5.1 「快问」接真提问流：现成 endpoint 够用吗？
**够用，且不需要任何新 transport 调用。**

- **AskCard.tsx 现在用的根本不是提问流。** AskCard 只消费 `store.ask`（AskCard.tsx:2 `useLite`），这张卡由 `/advise` SSE 的 `manifest{kind:'ask-draft'}` 帧生出（streamSource.ts:225-233 → store.ts:713-714 一次性收养），确认时才打 `transport.saveAsk`→`POST /ask`（store.ts:803）+ `transport.shareAsk`→`POST /ask/{id}/share`（store.ts:807）。它是 **ADR-0023 的员工自述问卷**，链路终点是员工 H5 `/r/{token}`，与"向 Avery 提问"无关。
- **真提问流 = `store.askLive`（store.ts:694）** → `agentSource.run`（:708）→ `transport.streamAdvise` → `POST /advise` SSE。现有三个入口全都直接调它：`RoomScreen.tsx:340`（运行后追问）、`:372`（空态）、`:386`（chips 点击即发问）、`LiteComposer.tsx:87`（只挂在 TeamScreen.tsx:474）。
- **悬浮入口 = 纯搬位。** 两条现成路径任选：
  1. 直接 `askLive({ situation })`（chips 就是这么做的，RoomScreen.tsx:386）——但要自行 `goScreen('room')` 否则用户看不到流；
  2. **推荐**：`goScreen('room', { q: text })` —— 中继链已全线打通：`routes.ts:115 EPHEMERAL_PARAMS=['q']`（导航后自动清）→ `routes.ts:186 goScreen(screen, params)` → `Lite2App.tsx:204-212 useRoomQueryRelay`（render 期搬运，用 `location.key` 作闸）→ `flowStore.composerDraft` → `RoomScreen.tsx:341/373 initialValue`。**只预填不自动发**（Lite2App.tsx:195 明写"不自动发问、不伪造回答"）。她方 FAB 走的是同构路径（`cr-live/src/components/shell/nexus-fab.tsx` → `router.push('/nexus?q=...')`，`app/nexus/page.tsx:34 searchParams.get("q")`）。
- 🔴 **两个必须继承的约束**：
  1. **无材料 gate**：`RoomScreen.tsx:344-362` 在 `contextId === null` 时**收起 composer 和 chips**（0721 事故：零数据提问要么烧默认英文 demo 语料的真 LLM、要么断流，被呈现成"系统故障"）。悬浮入口必须复用 `contextId` 同一判据，否则等于把刚修好的坑重新挖开。判据用 `contextId` 不用 `team`（store.ts:271-275 的理由：contextId 在模块求值期就从 localStorage 同步恢复，回访者第一帧非空）。
  2. **命名冲突（真 blocker）**：「快问」在 en.ts/zh.ts 里**已经是 feat-034 Ask 的名字** —— `en.ts:1325-1329 'Quick ask'`、`zh.ts:914 "eyebrow":"快问"`、`zh.ts:947/950/953/956`、`zh.ts:472 "followupsSourceAsk":"来自快问"`、`zh.ts:329/595 "一条快问已拟好"`、`zh.ts:780 "你的快问，回复都收齐了"`。同一屏会同时出现两个"快问"：一个把话发给 LLM，一个把链接发给员工。en.ts 是唯一文案源 → 新入口要么换词，要么先把 feat-034 那一族改名（后者波及 9+ 键 + 通知 + followups 来源标签，成本远大于本战役）。**建议给 Danny 抛回这个词。**

### 5.2 顶栏真搜索：客户端内存检索 vs 后端 endpoint？
**推荐：纯客户端内存检索。零 transport 改动。** 依据逐条：

1. **后端根本没有 search endpoint**（§4 全量路由表）。走后端 = 新建 FastAPI 路由 + 新 LiveTransport 方法 + stub 实现 + AFK 门夹具 + 限流配置 + CORS 无影响但要重部署法兰克福容器。这是一整条纵切，不是"顺手加个接口"。
2. **数据量根本不需要后端。** 可检索总体 = 一次 ingest 产出的 people + projects，几十量级，且**整包已经在内存里**（`store.team: LiteTeam` / `store.rawTeam`，store.ts:252/258）。后端也只有整包 `GET /team/{id}`，没有分页/过滤——所谓"后端搜索"最终也只是在同一份数据上跑 filter，只是多了一次跨境往返。
3. **跨境延迟**（ADR-0024 单端法兰克福后端）：每次按键打一次后端 = 每字 1 个 RTT。transport.ts:666 记录 ingest 实测 100-120 秒（后端在法兰克福、LLM 在国内）——同一条链路上做 as-you-type 搜索不可接受。
4. **离线/AFK 要求**：`LiveTransport` 是硬 seam，新增**必填**方法会让 `createStubTransport` 编译不过（transport.ts:328-329 逐字写明）。可选方法则要求每个调用方判空降级 → 搜索框在 stub 通道下变哑巴，AFK 门覆盖不到。内存检索在 stub 与真通道下行为完全一致。
5. **ADR 边界不禁止**：ADR-0020 决策 4 禁的是 **LLM key 与 loop** 上前端，不是禁前端做数据过滤；ADR-0021 §5 的 pluggable retrieval 指服务端 RAG，不是 UI 导航。**前端已有同款先例**：`LiteComposer.tsx:35 referenceQuery` 就是在 `team.people/team.projects` 上做内存过滤的 @ 引用菜单。
6. 她方也是纯客户端：`D:/cr-live/src/components/shell/topbar.tsx:23 function search(q)` —— 本地过滤 people/projects + 一张写死的页面关键词表（:39-47），`slice(0,8)`。**概念可借（结果三类 person/project/page、8 条上限、type icon、无结果态），源码不搬。**

**推荐实现约束（红线）：**
- 数据源：`useLite(s => s.team)`（people: `{id,name,role,team?,tenure?,owns?,collaboration?}` teamData.ts:17-32；projects: `{id,title,ownerNameRaw?,statusRaw,...}` teamData.ts:34+）+ 一张静态九屏名表（文案走 en.ts + zh delta）。
- 🔴 结果行**不得显任何数字**（人面零数字；她方 `sub: \`${p.status} · ${p.progress}%\`` 那半句**必须丢掉**——projects 侧我方连 progress 字段都没有，人卡侧更禁）。
- 🔴 `absent ≠ none`：ownerName/status 缺失时用 `t.lite2.projectsUnknownValue` 渲染层兜底，**绝不写"未分配"/"一切正常"**（teamData.ts:44-64 记录了这条在生产上翻过车）。
- 🔴 无结果态诚实：不回落假数据、不建议"试试上传"以外的假动作；`team === null` 时（未上传）搜索框应与 Room 的无材料 gate 同判据（`contextId === null`）收起或明说"还没有材料"。

### 5.3 完全不改 `transport.ts` 能不能做完首批四件？
**能，四件全都能。** 逐件核对：

| 件 | 数据来源 | 需要 transport 改动？ |
|---|---|---|
| 1. 指挥室双栏（真差距面板 + 真关注成员面板） | `gapDerive.ts`(4,596B) / `homeDerive.ts`(7,909B) 从 `store.team` 纯派生；`projectView.ts` | **否** |
| 2. 快问悬浮入口接真提问流 | `store.askLive`(store.ts:694) / `goScreen('room',{q})`(routes.ts:186 + Lite2App.tsx:204) 全现成 | **否** |
| 3. 顶栏真搜索 | `store.team.people/projects` 内存 | **否** |
| 4. KPI 计数族真数 | `team.people.length` / `team.projects.length` / `store.files.length`(LiveFileEntry) / `store.notes.length` / `rawTeam.decisions.length`（LiveDecisionCard，后端 feat-056 已排好序，**前端不得重排**，transport.ts:76-79） | **否** |

**会逼你动 transport 的场景（均不在首批，遇到就停下来抛决策）：**
- 搜索要命中**文件内容**：后端只有 `GET /team/{id}/files/{idx}` 下原始字节（ingest_api.py:435），`LiveTransport` 无该方法，且字节是不可信内容（transport.ts:247 「绝不作指令跟随」）→ 只做文件名/元数据命中即可，别开这个口子。
- 悬浮入口要带 ask 的「撤回/编辑」：后端有 `POST /ask/{id}`(ask_api.py:333) 与 `/ask/{id}/revoke`(:395)，**transport 里没有对应方法**，en.ts:1388 的 `revoke` 文案键悬空 → 这是既有技术债，不要在本战役顺手接（接了就是新 transport 方法 + stub 实现 + 门）。
- 任何新增方法：必须 `?:` 可选 + 调用方判空（transport.ts:328-329；姿势模板 `demoStore.ts:20-33`），且能力必须**先探测再露面**（ADR-0026「不出假按钮」；`/account/status` 探测的加固版见 `auth/authStore.ts:120-140`，区分"后端回答了没有"与"我们没问到"）。