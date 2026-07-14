# feat-034 阶段 C · 后端 + 员工 H5 + 前端接线 — per-line handoff

> 分支 `feat/034-stage-c`（base = main `8452032`），worktree `D:/avery/.claude/worktrees/ask-stage-c`。
> **未 merge、未 push**（合流归编排者，push 留 Danny）。AFK 实现子代理 2026-07-14 完工。
> 范围 = kickoff-dev.md 阶段 C 全量 + 追加清单 F1–F3。冻结集零触碰（`freeze.check_lock` PASS，
> `git diff main` 对 redline/loop/engine/tools/memory/redline_extract/src/story = 空）。

## 1 · 端点契约终版

### Manager 侧（全部要求 owner_token header：`X-Avery-Token` 或 `Authorization: Bearer`；绝不进 URL）

| 端点 | 语义 | 失败面 |
|---|---|---|
| `POST /ask` | 创建 draft。body 是前端 AskDraft 的超集：`{company_context_id*, questions?, recipients*, comment_prompt?, thread_hint?, situation?}`。**id 服务端铸造**（body 里的 id 被忽略——不给跨租户占 id 的路）。questions 缺省/空 → 服务端生成 1~3 题（见 §4）。回 AskDraft 形状 + `generation_mode` | 无/错 token → 404（对 context）；红线/坏形状 → 422 `{error:"ask rejected", reason}` |
| `POST /ask/{id}` | 保存编辑（同门重校验）。**仅 draft 可编** | 非 draft → 409；auth → 404（同模） |
| `POST /ask/{id}/share` | 每 recipient 铸 `secrets.token_urlsafe(32)`，回整链 `{AVERY_PUBLIC_BASE}/r/{token}`（缺省 `https://avery.ima-read.com`），status→shared。**幂等**：已 shared/collecting 再点回同一批链接（双击不作废已粘贴的链） | revoked/expired/closed → 409 |
| `GET /ask/{id}` | 状态 + 回执（`recipients[].receipt = {answers, comment?, answered_at}`）。status = **服务端有效词**（collecting/closed/expired 在读侧派生）。多人全齐 → `receipts_summary`（§5） | auth → 404 |
| `POST /ask/{id}/revoke` | → revoked（幂等）。**closed 拒撤**（证据已收，不可"未发生"） | closed → 409 |

🔴 **无枚举 oracle**：未知 ask id、无 token、错 token、B 公司 token 读 A 的 ask —— 全部同一个
404 `{"detail": "unknown ask id: …"}`（绝不透 context id、绝不 403）。复用 `authorize_context`
（恒时比较），外面包一层 `authorize_ask` 把 context 味道的 404 重写成 ask 味道。

### 员工侧（share-token 在 URL = 拍板设计，免登录唯一路径；一 token 只读写一人份）

| 端点 | 语义 |
|---|---|
| `GET /r/{token}` | SSR 单页 H5：per-link OG（og:title=首题、og:description=透明说明）+ 透明三要素（`.h5-who / .h5-what / .h5-visibility`：谁在问/问的什么事/回答给谁看）+ 大按钮 1~5（radio）/是·否 + 选填短评 + 提交。**ZH 默认，`?lang=en` 切 EN**。零外部资源（样式内联；无 script/link/img）。状态：已答→锁定页(200，含"你已答过")；撤回→410；过期→404（带"已过期"文案，兼顾 PRD Q8 状态页与 kickoff 大声 404）；未知 token→404 |
| `POST /r/{token}/answer` | 表单（urlencoded）：`q_{qid}` = `1..5` / `yes|no`，`comment` 选填。**单次锁定**：registry 层原子写（pg：`UPDATE … WHERE answered_at IS NULL`），重复提交 409 且首答不被覆盖。值域外/缺答 → 422。comment 只做长度帽(2000)+C0 控制符清洗——员工原话**不过红线门不改写**（ADR-0023：本人声音） |

## 2 · 迁移与存取层

- `eval-harness/db/migrations/0007_ask.sql`：`avery.asks`（id/context_id FK CASCADE/status CHECK
  锁六词/thread_hint/questions JSONB/comment_prompt/generation_mode/created_at/expires_at 默认
  now()+7d）+ `avery.ask_recipients`（ask_id FK/idx/person_id/person_name/share_token 部分唯一索引/
  answers JSONB/comment/answered_at）。DDL 只增；`_ensure_schema()` 自动重放（本地 Docker 与
  Supabase 同一组文件）。
- `avery/ingest/ask.py`：领域对象（Ask/AskQuestion/AskRecipient，镜像前端 AskDraft）+
  `effective_status()`（closed/revoked 恒终态；shared/collecting 由答数派生；过 expires_at 派生
  expired——存储词永远不会高报）+ `gate_ask_red_line()`（两档，见 §3）+ `validate_ask_shape()`
  （1~3 题/已知题型/题文≤300/受访者 1~30/hint≤500）。
- registry 双实现（同 notes 接缝风格，duck-typed）：`put_ask/get_ask/get_ask_by_token/
  record_answer` 落 `ContextRegistry`（deepcopy 双向，证据不可被调用方悄悄改）与
  `PostgresContextRegistry`（快照式 upsert；record_answer 事务内推进 status）。契约测试一套双跑
  （`tests/test_ask_store_contract.py`，仿 test_registry_contract.py 的 impl fixture）。

## 3 · 红线两档（复用，不另起机制）

- 问句门 = `redline.validate`（EN+ZH，冻结检测器原样）+ `scoring_policy.person_scoring_allowed()`
  决定是否放行——与 feat-033 `gate_note_red_line` 同构。校验字段：每题题文、comment_prompt、
  thread_hint（**逐字段独立验**，feat-033 对抗闭环的"不串联"纪律）。NUL/0x00 恒拒（存储安全
  不是红线政策）。门跑两层：service 422（带 reason）+ 存储门（belt-and-suspenders）。
- **员工回执不过红线门**：数字/短评是员工本人对"事"的自述（ADR-0023 允许面）；结构保证 =
  回执挂 (ask, recipient)，entities 的人键 allowlist CHECK 原样生效，人卡无处可挂。
- crafted 攻击用例（检测器实测选型）：EN `How would you score her competence, 1 to 5?`、
  ZH `你觉得他自己的能力可以打几分？1到5分。`——off 422 / on 200 双向都有测试钉住。
  注意：ZH 裸打分动词无评分目标数字时冻结检测器本就放行（如"给他的谈判能力打几分？"），
  这是检测器既有语义（bare verb 需 scoring target），本线不改检测器。

## 4 · 服务端题目生成（generation_mode 诚实标注）

- body 带题 → `manager`（逐字保存，只过门不改写）。
- 无题：`AVERY_BRAIN` 为真脑（非 mock）→ 经 `llm_budget.BudgetedBrain`（feat-039 花费闸）
  调 brain 出 JSON 题组 → 逐题过门（违规题丢弃）→ 有存活 → `llm`。
- 任何一步不成（无 key/预算耗尽/坏 JSON/全被门拦/mock）→ 确定性模板两题（问"事"，
  构造即干净）→ `template`。**绝不静默把模板标成 llm**。
- ask-draft SSE 帧走同一生成器；mock/离线跑出的帧 = `template`。

## 5 · receipts_summary（多人定性汇总）

确定性生成（无 LLM、无幻觉面）、**全文零数字**（"Everyone replied / broadly confident /
views split…" 分桶措辞），生成后仍过 `redline.validate`，不过则整段省略（前端退回聚合计数
chip）。单人恒无汇总（原话直呈）。ADR-0023 边界 3：无每人一行、无名字×数值共现（HTTP 测试
+ K4 DOM 断言双钉）。

## 6 · ask-draft 帧（heuristic 取舍）

- 注入点 = `service/app.py::_with_ask_frame`（SSE 组装收尾；同帧进 buffered events），
  **引擎零触碰**；buffered 路径的 manifest 选取已按 `kind in (None,'advice')` 过滤（回归钉在
  test_ask_frame.py）。
- heuristic = **花名册全名子串命中**（case-insensitive，人名≥2 字符，取前 5 人预选）。
  命中→一帧（advice manifest 之后）；不命中/无 context/帧构建异常→不发（诚实，不硬凑；
  帧失败绝不打断已成功的 advise）。帧是**提案**，不落库——manager 确认走 POST /ask 才存在。
- 取舍记录：更聪明的指代消解（"他/她/the design lead"）留给真实使用反馈；全名命中已覆盖
  融资演示叙事（"A 能不能负责谈价"类问句天然带名字）。

## 7 · 硬门

- `upload_guard._route_for`：`/ask*` → `AVERY_RATE_ASK_PER_MIN`（POST）；`/r/*` →
  `AVERY_RATE_SHARE_PER_MIN`（POST **和 GET**——员工页是唯一公网无凭据面，OG 抓取也打它）。
  缺省 0 = 关（离线套件不受扰）；ECS runbook 部署时调。
- LLM 花费：题目生成过 `BudgetedBrain`（超额→模板降级，非烧钱重试）。
- CORS 未为 /r/ 放宽（H5 同源 SSR，表单 POST 无跨域）。

## 8 · 前端接线（src/lite）

- `transport.ts`：`AskStatus` 补 `revoked|expired`；`LiveTransport` 增 `revokeAsk` +
  `offlinePreview?` 自声明；HTTP 实现 saveAsk 成功时记 `askId→context_id` 映射，
  share/fetch/revoke 据此带 `X-Avery-Token`（F1 遗留 #1 收尾）。
- `streamSource.ts`（F1+F3）：coerce 未知 status **折 closed**；>3 题/未知题型 → null；
  回执值域外（scale 非 1..5 整数、yesno 非布尔、答不存在的题）→ 整卡 null（"宁可不出卡"）；
  `window.__liteAsk = {coerceAskDraft}` 门缝（门是唯一消费者）。
- `store.ts`：transport 回来的 ask 一律再过 `adoptAsk`（同一把 coerce；坏形状抛 askError
  大声显示——服务端是最终门，客户端半边保证坏形状绝不渲染）；`revokeAsk` action；
  `window.__liteStore` 门缝。
- `AskCard.tsx`：revoked/expired 两终态（`.ask-revoked-note`/`.ask-expired-note`，链接区/编辑区
  全撤）；F2 `.ask-offline-note`（仅 offlinePreview transport）；卡上撤回按钮（`.ask-revoke`，
  shared/collecting 可见）；7 天过期 copy（`.ask-expiry-hint`——后端已接才说这句话）。
- `stubTransport.ts`：`offlinePreview: true` + `revokeAsk`（closed 409 同真端点语义）。
- i18n：EN 新 9 键 act-first 定稿；ZH 经 `node scripts/i18n-zh.mjs ask` 定向 M3 生成后**只折入
  新键**（生成器对已定稿键的 churn 已回退，锁定文案 byte 不变；文件头注记）。新键待 Danny 审字。

## 9 · 全部 evidence

1. **离线 pytest**：`python -m pytest -q -m "not seedgate and not smoke"` →
   **518 passed, 53 skipped, 7 deselected, 1 xfailed**（基线 474 保持，零跌；新增 44 全部
   born-red（42 failed/2 trivially-green 记录在案）→ 修绿）。无 DB/无 key/零网络。
2. **@needs_db**：test_ask_store_contract 的 pg 腿 + `test_pg_b_token_cannot_read_a_ask`
   （B token 读 A 的 ask → 404 同模）——无凭据环境干净跳过（53 skipped 含全部 11 个新 skip）。
   ⚠ 本机无 PG 凭据，pg 腿未实跑——部署波第一件事拿真 DB 跑一遍（同 feat-030 纪律）。
3. **真机 e2e**（真 uvicorn :8177，in-memory + mock brain）：**19/19 checks** ——
   ingest→advise SSE 含 ask-draft 帧（Marcus Reid 预选）→create→违规问句 422→share 双链→
   全新无 cookie GET /r（OG+三要素+ZH 默认+EN 切换+他人零泄漏）→POST answer 200→重复 409→
   GET 锁定页→manager 回执逐字→revoke→未答链 410→404 同模抽查。脚本 = scratchpad `e2e_ask.py`。
4. **浏览器 stub 门**（vite :5179 `?mode=live&transport=stub`，MessageChannel shim，同一新鲜会话）：
   `mainVerdict {pass:true, 11/11}`（emptyStateClean…notesSurface 全 true，未跌）+
   `askVerdict {pass:true, 9/9}`（K1–K6 全 true + **F1 askStatusGuards / F2 askOfflineNote /
   F3 askCoerceStrict 先红后绿**——红态原样：F1/F3 `no __liteAsk debug seam`、F2
   `notePresent:false`）。console 零 error。撤回按钮真点击流：shared→click→revoked+note+chip。
5. **真后端真 UI 复验**（uvicorn :8137 mock brain + 前端去 stub）：真 /ingest（csv+md 花名册）→
   真 /advise SSE 出 ask-draft 帧（K1 pass，Marcus Reid 预选）→ confirm 走真 header
   （saveAsk+shareAsk，K2 pass 双链真 token）→ **F2 相位反向断言 pass（真后端离线标注不在）**→
   curl 双"员工"作答 → 一次拉取 → closed + 服务端 receipts_summary 渲染 + K4（零名字×数值、
   零表）+ K6（人卡零数字、零分数表、story 名词 0）全 pass。
6. **init.sh 绿**：墙 lint 0 error + tsc -b 零错 + vite build ✓。
7. **改动面自查**：`git diff main --stat` 全部落在 eval-harness 新增/ask 相关四文件、src/lite、
   i18n、gates、feature_list、本 handoff；冻结集 `avery.freeze.check_lock` PASS；
   redline/loop/engine/tools/memory/redline_extract/PersonEntity(extract.py)/src/story diff 为空。

## 10 · 遗留 = 部署清单（阶段 D + 合流注意）

1. **真 DB 腿未实跑**：@needs_db（ask 契约 pg 腿 + B读A 隔离）本机无凭据干净跳过——拿到
   Supabase/本地 Docker PG 后 `AVERY_DB_URL=… pytest -m needs_db` 补跑（0007 会被
   `_ensure_schema` 自动重放）。
2. **部署时环境**：`AVERY_PUBLIC_BASE=https://avery.ima-read.com`（缺省即它）、
   `AVERY_RATE_ASK_PER_MIN`/`AVERY_RATE_SHARE_PER_MIN`（建议 share 侧从 60/min 起调）、
   既有 feat-039 全套 + 内存哨兵照旧。nginx 反代把 `/r/` 与 `/ask` 一并转给容器。
3. **真后端全套门重跑**：部署波按 gate .md 用真 8137 再跑 K1–K6+F1–F3（本线已在本机真后端
   复验过一轮，见 evidence 5——生产域名下重点看 OG 卡在企微/飞书/钉钉的实际 unfurl）。
4. **ZH 审字**：ask 新 9 键 + H5 页面 ZH copy（Python 内联，`service/ask_api.py::_COPY`）
   均为 M3/agent 起草，待 Danny 审字（上线不阻塞——act-first 纪律）。
5. **合流注意**：main 若已推进 v02 线（src/lite2），本分支只碰 src/lite/**，理论零冲突；
   feature_list.json feat-034 evidence 行有增改（indent-2 CRLF 保持，1 行 diff）。
6. v2 候选（不在 scope）：帧 heuristic 的指代消解、催答提醒、聊天内原生按钮回传
   （飞书→Slack→钉钉）、receipts_summary 的 LLM 润色（须过同一门）。
