# feat/038 — 基础租户隔离 · session handoff

> 2026-07-13 AFK,gate-first。分支 `feat/038-tenant-isolation`(未 push),base = `feat/033-avery-notes` tip `dbf888a`。
> 使命:关掉全就绪册最高危 IDOR —— 任何人拿 `context_id` 就能读整份公司数据。

## 做了什么(照 kickoff §实现决定)

1. **owner_token 生成**:`/ingest` 建 context 时 `secrets.token_urlsafe(32)`(~256bit,url-safe 43 字符),经 `pipeline.ingest_paths/ingest_docs` 新增的 `owner_token` 参数写进内存 `CompanyContext.owner_token` 字段 + `avery.contexts.owner_token` 列(feat-030 已建列,现填值)。`/ingest` 响应回传 token 给上传者(**仅创建那一刻**;`/team/{id}` 刷新帧不回传)。
2. **读路径校验**:`service/ingest_api.py` 新增模块级 helper `mint_owner_token` / `extract_owner_token` / `authorize_context`。以下端点校验 header token == owner_token,不匹配/缺失/未知 id **一律 404**(非 403;沿用 feat-028 未知 id 大声 404 语义,不泄漏枚举):
   - `GET /team/{id}` · `GET /team/{id}/notes` · `GET /team/{id}/files` · `GET /team/{id}/files/{idx}` · `POST /advise`(带 `company_context_id`)。
   - 比较用 `secrets.compare_digest`(恒定时间)。**空 owner_token = 无需 token**(pre-038/直连测试的向后兼容;生产所有 context 走 `/ingest` 必有 token)。
3. **token 传输只走 header**:`X-Avery-Token` 或 `Authorization: Bearer`。**绝不进 URL path/query**(隐私铁律)。测试 `test_token_in_query_string_does_not_authorize` 守 header-only。
4. **关交互文档 + 下线 sample**:`FastAPI(app, docs_url=None, redoc_url=None, openapi_url=None)` → `/docs`·`/redoc`·`/openapi.json` 全 404。`/advise/sample` 整个下线(零 body/无 auth/无限流的烧 token IDOR 控制台)。
5. **前端**:`src/lite/transport.ts` 的 `createHttpTransport` 按 `context_id` 存 `/ingest` 回传的 token(内存 map + `localStorage['avery.ownerTokens']`,一次会话内刷新存活),`team/files/notes/advise` 调用自动带 `X-Avery-Token` header。`src/lite/store.ts` 挂 `ownerToken` 状态。story mode 零改。

## 改动文件

- 后端:`avery/ingest/registry.py`(CompanyContext.owner_token 字段)、`avery/ingest/pipeline.py`(owner_token 参数穿透)、`avery/ingest/pg_registry.py`(put/get 读写 owner_token 列 + 注释 feat-034→038)、`service/ingest_api.py`(mint/extract/authorize + /ingest 回传 + 4 读端点 gate)、`service/app.py`(docs 全关 + /advise gate + /advise/sample 下线 + 删死代码 `_context_registered`)、`db/migrations/0001_avery_persistence.sql`(注释 feat-034→038,**无 DDL 变更**)。
- 前端:`src/lite/transport.ts`、`src/lite/store.ts`(仅此两文件;`git diff dbf888a -- src/` 证)。
- 测试:新增 `tests/test_tenant_isolation_http.py`(13 例隔离电池);`tests/test_registry_contract.py`(+owner_token 契约 memory+pg,feat-034→038 注释);`tests/test_persistence_restart.py`(token 跨真进程重启);`tests/test_notes_http.py`·`test_file_space_fixes.py`·`test_notes_scoring_toggle.py`·`test_seed_gate.py`·`test_service_http.py`(既有 HTTP 测试穿 token / sample 改断言 404 + docs 关断言)。
- `feature_list.json`(feat-038 条目,status=done)。

## 三层数字(收盘复跑)

- **离线·零外网** `DASHSCOPE_API_KEY='' MINIMAX_API_KEY='' python -m pytest -m 'not seedgate and not smoke and not needs_keys' -q` = **435 passed** / 36 skipped / 8 deselected / 1 xfailed(基线 420 +15)。
- **@needs_db** 本地 pg17 `:5433` `AVERY_DB_URL=... python -m pytest -m needs_db -q` = **36 passed**(基线 33 +3)。
- **前端** `./init.sh` exit 0(eslint story/lite 墙 + tsc -b + vite build)。

## 隔离集成证据(agent 当第一个用户,真机)

- **gate-first RED 探针**(实现前,TestClient):/ingest 无 owner_token,所有读端点无 token 全 200,/docs·/openapi·/advise/sample 全 200 = 洞坐实。
- **GREEN**(实现后):token_A 全路径 200(X-Avery-Token + Bearer),token_B / 无 token / 错 token / 跨向全 404,/docs·/redoc·/openapi·/advise/sample 全 404,无 ctx 的 demo 默认 200。
- **真浏览器**(uvicorn offline :8137 + vite :5173 ?mode=live):UI 注入真 File → `store.uploadFiles` → `transport.ingest` 真跑 → localStorage 按 context_id 存 token(len 43) → `refreshFiles` 真发 `GET /team/{cid}/files` 携 `X-Avery-Token` → **200**(body = handbook.txt 清单)。跨源 fetch 九项断言全绿:A+token_A=200 / A 无 token=404 / A 错 token=404 / A+token_B=404 / A+Bearer=200 / A/notes+token_B=404 / /docs=404 / /openapi.json=404 / /advise/sample=404。

## Supabase 迁移状态

**无需新迁移**。`owner_token` 列 feat-030 `0001_avery_persistence.sql` 已建(nullable text)。feat-038 仅填值 + 读值 + 改注释,**零 DDL 变更**,故 Supabase 无需 apply_migration。(共享项目 nunsbijtntreynoyeilp 未触碰。)

## 自评薄弱点(独立对抗验证请重点打这里)

1. **未 gate 读端点扫描**:已 gate 全部读公司数据的路径(team / notes / files / files-idx / advise)。`/health` 有意无 token(不泄数据);`/ingest` 无 token(创建即发 token,任何人可上传 = denial-of-wallet,由上传硬门/花费闸线承接,非本轮)。未见其它读公司数据端点遗漏——**建议对抗验证真机扫一遍路由表复核**。
2. **token 比较恒定时间 / 枚举**:`secrets.compare_digest` 恒定时间比 token。残留 timing 侧信道:`get()` 对未知 id(无行,快)vs 已存在 id(有行 + compare)有微小时差,理论可区分 id 是否存在;但 404 body/status 完全一致 = 无强 oracle。彻底消除需 dummy-compare 等时填充,v1 未做(留后续)。
3. **错误码一致不泄存在性**:错 token 对已存在 id → `{detail: 'unknown company_context_id: <id>'}`,与未知 id **同模板**(消息只回显调用方自己发的 id,泄漏 0);非 403。`test_wrong_token_404_is_indistinguishable_from_unknown_id` 守。
4. **向后兼容 tokenless**:空 owner_token = 无需 token(直连 `ingest_paths` 的测试/pre-038 context 仍可读)。生产全走 `/ingest` 必有 token,无洞;但**未来若加非 /ingest 的 context 创建面须记得设 token**(否则那条路径 open)。
5. **前端 token 单会话**:落 localStorage 让刷新存活,但**未做换机器/清缓存后的 URL 恢复流**(token 丢 = 需重传)。PRD User Story 1『下次打开还在』指后端数据持久;前端 token 恢复留 feat-034 Ask 卡/登录轮。
6. **RLS**:`avery.*` 全表 RLS 仍 disabled(feat-030 起既存)。feat-038 隔离在**应用层** owner_token 校验、不依赖 RLS——**直连 DB 者仍绕过**(v1 克制档,DB 凭据本身即信任边界)。
7. **与 feat-033 policy 开关正交**:`AVERY_ALLOW_PERSON_SCORING` 零改。冻结(redline/engine/loop/tools/memory/PersonEntity/FROZEN)零改(git 证)。

## 待 Danny / 后续

- push 授权(对外闸,未 push)。
- 前端 URL/token 恢复流(换设备重进)= feat-034 Ask 卡线 / 登录轮。
- timing-side-channel 等时填充(若威胁模型要求严格无存在性 oracle)。
- 上传侧 `/ingest` 的 denial-of-wallet(size/count/rate + 花费闸)= 独立上传硬门线。
