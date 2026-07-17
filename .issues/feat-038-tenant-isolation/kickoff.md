# feat/038 — 基础租户隔离:不可猜 owner_token + 读路径校验(kickoff)

> 权威 spec:`.issues/lite-v1-lean-real-0713/PRD.md`(Implementation Decisions「基础租户隔离」+ User Stories 9/16/20)· 就绪册 `.issues/live-polish-0709/pre-ecs-readiness-open-loop.md` §2-A(THE critical IDOR gate)。
> 依赖:feat/030–033 已 clean(分支 feat/033-avery-notes tip dbf888a)。从该 tip 开 `feat/038-tenant-isolation`。
> ⚠ 编号:「Ask 卡」线已占 feat-034,故本"租户隔离"改号 **feat-038**(避 feature_list 撞车)。migration/注释里旧的 "feat-034 tenant isolation" 字样一并改成 feat-038。

## 使命

今天任何人拿到 `context_id`(URL 里的 `ctx_xxx`)就能读整份公司数据——`/team/{id}`、`/team/{id}/files[/{idx}]`、`/team/{id}/notes`、`/advise` 全**零授权**(就绪册标为全册最高危 IDOR)。真实公司不敢用。feat/038 = 给每家公司一个**不可猜的 owner_token**,所有读路径校验持有者。**不做完整登录/账号系统**(v1 克制档)。

## 实现决定(已拍板)

- **owner_token 生成**:`/ingest` 建 context 时生成不可猜 token(`secrets.token_urlsafe(32)` 级别),存进 `avery.contexts.owner_token`(feat/030 已建列、现 NULL)+ 内存 registry 的 `CompanyContext` 也加 `owner_token` 字段。`/ingest` 响应把 token 返回给客户端(上传者持有)。
- **读路径校验**:`/team/{id}`、`/team/{id}/files`、`/team/{id}/files/{idx}`、`/team/{id}/notes`、`POST /advise`(带 company_context_id 的)——都校验调用方提供的 token == 该 context 的 owner_token。**不匹配/缺失 → 404**(不是 403,避免确认 id 是否存在=不泄漏枚举信息;沿用 feat/028 未知 id 大声 404 的语义)。
- **token 传输**:走 **HTTP header**(如 `X-Avery-Token: <token>` 或 `Authorization: Bearer <token>`),**绝不放 URL path/query**(隐私铁律:URL 进 Referer/access log/CDN log/浏览器历史)。context_id 仍在 URL path(它本就在),但**光有 id 读不到数据**,必须配 token。
- **关交互文档**:FastAPI `app` 传 `docs_url=None, redoc_url=None, openapi_url=None`(就绪册:生产别暴露 /docs /redoc /openapi)。`/advise/sample`(现无 body/无 auth/无限流)——加 token 校验或直接下线(它是 IDOR 可点控制台 + 烧 token;v1 可下线或 gate)。
- **向后兼容**:v1 无真实数据,所有新 context 都带 token。校验逻辑:context 有 owner_token 就要求匹配。`/health` 不需 token(不泄数据)。
- **前端**:`src/live/transport.ts` 在 `/ingest` 后**存下返回的 token**(client state / localStorage 按 context_id 存),后续 `/team`·`/advise`·`/notes`·`/files` 调用都带上 header。lite store 挂 token。story mode 不受影响(story 不调后端)。

## 与「Ask 卡」线(feat-034)的接缝

feat-034 的阶段 C 后端(POST /ask · GET /ask/{id} · /r/{token} 员工 H5)将骑在你的持久化 + 隔离层上。**owner_token = 公司经理凭据**;他们的 **share-token(/r/{token})= 员工访问凭据,是另一套**,别混。你只管把经理侧隔离做成地基;ask 的 share 机制是他们阶段 C 的活。设计 owner_token 时不要占用 /r/ 路径或 ask 语义。

## 测试接缝(PRD Testing Decisions)

- **主 = HTTP 面**(agent 当第一个用户,就绪册 §2-A 的隔离断言):
  - 上传公司 A 拿 token_A → 用 token_A 读 A 的 team/files/notes/advise **成功**;
  - **用 token_B(或无 token / 错 token)读 A 的 context_id → 404**(A 看不到 B、B 读不到 A);
  - `/docs`·`/redoc`·`/openapi` → 404;`/advise/sample` 已 gate/下线。
- **下沉契约**:`test_registry_contract.py` 加 owner_token 存取(内存+postgres 双实现);token 不匹配的读被拒。
- **离线默认全绿零外网**;@needs_db 走本地 PG :5433 验 pg 侧 token 持久 + 校验。
- **前端**:transport 带 token 的 DOM/契约断言;story-untouched。

## 纪律(standing)

- 🔴 不动冻结:redline.py/redline_extract.py/engine.py/loop.py/tools.py/memory.py/PersonEntity/FROZEN.lock.json;src/story/** 零改;门断言不削弱。**红线解禁开关(feat/033 的 `AVERY_ALLOW_PERSON_SCORING`)不动**。
- gate-first 先红(未加校验时 token_B 能读 A=红)后绿;禁自考自答。离线套件全绿零外网(DB 惰性)。分支 feat/038-tenant-isolation,commit 常态化(不 push)。别动未追踪协调者文件。新迁移若需(如 owner_token 加 NOT NULL/索引)沿多迁移机制 0007_*,MCP apply 到 Supabase avery schema(additive/avery-scoped/只读 MCP 验证 public 未动)。
- 收盘:离线全绿 + @needs_db 绿(含隔离契约)+ ./init.sh 绿 + 集成层证据(token_B 读 A→404 的真机 repro)+ feature_list feat-038 条目 + `.issues/feat-038-tenant-isolation/session-handoff.md`。**收盘必经独立对抗验证**(真机:各种绕过 token 读别家数据的尝试 + 未 gate 端点扫描)。
