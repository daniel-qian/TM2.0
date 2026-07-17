# feat/041 — 端到端 + 基本压测 + 广播回 feat-034(kickoff)

> 权威 spec:`.issues/lite-v1-lean-real-0713/PRD.md`(Testing Decisions + User Story 28「agent 当第一个用户的端到端」+ 压测基本档)。
> 依赖:feat/030–033 + 038 + 039 + 040 均 clean。从 feat/040 tip 开 `feat/041-e2e-broadcast`。这是**收尾环 + 第一波自动化端到端**(Danny 分工:第一波我做,第二波 HITL 他做)。

## 使命

把散在各 feature 的持久化/隔离/RAG/笔记/硬门测试,拧成**一条 agent 当第一个用户的端到端断言**(PRD User Story 28),再加**基本压测**,最后**给 feat-034 Ask 卡线发一条广播**(它在等我的持久化+隔离层就绪才能接阶段 C)。

## 使命 1 — 端到端(HTTP 面,一条链,@needs_db)

一个测试跑通全链(mock brain / heuristic / 本地 PG,无需真 key):
1. **上传** 公司 A 真种子文件(`eval-harness/tests/fixtures/seed/`)→ 200,拿 `context_id` + `owner_token`。
2. **持久化 + 团队** 用 token 读 /team → 团队从真文档长出来。
3. **重启** 换新 registry 实例/新进程(模拟部署)→ A 的团队/文件/记忆**仍在**。
4. **隔离** 上传公司 B → 用 B 的 token 读 A 的 id → **404**;A 看不到 B。
5. **真 RAG + 引用** advise 关于 A 的问题 → 证据引用 A 文档里的真实事实行(feat/031 的语义召回)。
6. **笔记累积** 多轮 advise → /team/{id}/notes 笔记累积、跨会话可见。
7. **红线开关** 默认关:诱导打分被拦(笔记零打分);`AVERY_ALLOW_PERSON_SCORING=1`:放行(feat/033 政策转向)——两态都断言。
8. **文件空间** /team/{id}/files 清单含 n_chunks,重启后仍在、字节可下载。
> 复用既有:`test_persistence_restart.py`(重启范式)、`test_tenant_isolation_http.py`(隔离)、`test_notes_http.py`(笔记)、`test_seed_gate.py`(真机整链先例)。目标 = 一条**贯穿**的 e2e,不是把它们拼一遍。

## 使命 2 — 基本压测(非穷尽运维档)

- **零星并发**:几个并行 /ingest + /advise 不崩、healthcheck 不被拖挂(feat/028 threadpool + feat/039 硬门);断言进程存活、无 500。
- **硬门边界**(feat/039 已单点验,这里做组合抗压):超大/超量/超频/超预算 组合下服务不崩、诚实降级。
- **内存**:哨兵在压测下越水位→/health degraded(feat/039)。
- 不做穷尽 load test;基本档证明"真实公司零星并发不出丢人事故"。

## 使命 3 — 广播回 feat-034 Ask 卡线

feat-034 阶段 C 后端(POST /ask · GET /ask/{id} · /r/{token} 员工 H5)骑在本持久化+隔离层上。收尾发一条广播(形态同他们发来的),含:
- **持久化层就绪**:Supabase avery schema(migrations 0001–0006 + owner_token)、`active_registry()` get/put 接缝、CompanyContext。
- **隔离契约**:owner_token=经理凭据,走 header(X-Avery-Token/Bearer),读路径 404-on-mismatch;他们的 /r/{token} share-token 是另一套,别混。持久库空 token fail-closed。
- **红线开关**:`AVERY_ALLOW_PERSON_SCORING`(默认关);他们的 ask 若涉人打分,同此开关口径。
- **合并注意**:main 已 ahead(他们 3a9cf5c);我们碰了 src/lite/**(032/033 加 tab + 038 前端 token),合并 src/lite 有冲突要理;feature_list.json 我们加了 030–040 条目。
- **基建**:ECS ~150M free 的现实 + feat/040 的部署 checklist。
- 广播落 `.issues/lite-v1-lean-real-0713/broadcast-to-ask-line.md`(供 Danny 转发/合流用)。

## 纪律(standing)

- 🔴 不动冻结/红线开关/隔离/硬门代码;src/story/** 零改;门断言不削弱。gate-first(e2e 断言先写,红→绿)。离线套件全绿零外网(e2e 走 @needs_db + mock brain,无真 key)。commit 到 feat/041-e2e-broadcast(不 push)。别动未追踪协调者文件 + `.issues/ask-card-0713/**`。
- 收盘:离线全绿 + @needs_db 绿(含新 e2e)+ ./init.sh 绿 + e2e/压测证据 + 广播落盘 + feature_list feat-041 条目 + `.issues/feat-041-e2e-broadcast/session-handoff.md` + **更新根 `OVERNIGHT-STATE-0713.md` 标全链完成状态**。**收盘经独立对抗验证**(e2e 是否真贯穿、压测是否真触边界、有无自考自答)。
