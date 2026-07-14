# 广播 → feat-034「Ask 卡」线：持久化 + 隔离层已就绪（阶段 C 可接）

> From: lite-v1 lean-real 持久化链（feat/030–041，分支 `feat/041-e2e-broadcast`，本地未 push）
> To: feat-034 Ask 卡线（POST /ask · GET /ask/{id} · /r/{token} 员工 H5）
> Date: 2026-07-14 · 供 Danny 转发 / 合流用
> 形态：同你们此前发来的那条广播（状态 + 接缝契约 + 合并注意 + 基建）。

你们阶段 C 的后端骑在本持久化 + 隔离层上。这层现在**全绿、有真机 e2e 证据**，可以接了。下面是你们对接需要知道的全部接缝与坑。

---

## 1. 持久化层就绪（feat-030/031/032/033）

- **数据库 = Supabase Postgres + pgvector，`avery` schema**（与 ImaRead 生产共库，只碰 `avery` schema，DDL 只增不改）。
- **迁移到 0006**：`eval-harness/db/migrations/0001_avery_persistence.sql … 0006_company_notes.sql`。
  - `contexts / entities / materials / source_documents / company_notes` 五张表。
  - `avery.contexts.owner_token` 列**在 0001 就建好**（feat-038 才填值，见 §2）。
  - `materials.embedding vector`（feat-031 真 pgvector）、`entities` 的 person 打分键 **allowlist CHECK**（红线结构化进 schema，绩效评分/排名/离职风险/zscore/nine_box 一律被 DB 拒）。
- **接缝 = `avery.ingest.registry.active_registry()`**（get / put / resolve_memory_dir / list_notes / append_note / source_document_bytes）。`AVERY_DB_URL`（或别名 `PGVECTOR_URL`）设了 → Postgres registry（数据跨重启/重部署存活）；没设 → 进程内 registry（离线默认）。**同一套 get/put 接缝两边都过**（契约测试 `test_registry_contract.py` 内存+PG 双实现）。
- **`CompanyContext`** = 一家公司的工作区：team/project/signal cards + briefing + 记忆(facts.md/notes.md，重启后从 DB 重物化) + 文件空间(源文档字节) + Avery 笔记。
- **你们要新建一家公司工作区**：走 `POST /ingest`（multipart files）→ 回 `{context_id, owner_token, …}`。**别自己 INSERT contexts**——owner_token 铸造 + 红线门 + 记忆物化都在 ingest 路径里。

## 2. 隔离契约（feat-038）——⚠ 与你们的 /r/ share-token 是两套，别混

- **`owner_token` = 经理凭据**：`/ingest` 建 context 时 `secrets.token_urlsafe(32)`（~256bit），**只在创建那一刻回传给上传者**（`/team` 刷新帧不回传）。
- **传输只走 HTTP header**：`X-Avery-Token: <token>` 或 `Authorization: Bearer <token>`。**绝不进 URL path/query**（隐私铁律：URL 进 Referer / access log / CDN log / 浏览器历史）。context_id 仍在 URL，但单独 context_id 已经**读不到任何数据**。
- **读路径 404-on-mismatch**：`/team/{id}`、`/team/{id}/notes`、`/team/{id}/files[/{idx}]`、带 `company_context_id` 的 `POST /advise` 全部校验 token。缺失/错误/未知 id **一律 404、同一份 body 模板**（不是 403 → 不确认 id 是否存在 = 无枚举 oracle）。比较用 `secrets.compare_digest`（恒定时间）。
- **持久库空 token = fail-closed**：DB-backed context 若 owner_token 为 NULL/空，`authorize_context` 一律 404（永不世界可读）。内存 registry 保留空 token 向后兼容（测试/直连接缝，非对外服务路径）。
- **接缝函数**（`service/ingest_api.py`，你们可直接复用）：`mint_owner_token()` / `extract_owner_token(x_avery_token, authorization)` / `authorize_context(reg, context_id, token) -> CompanyContext | raise 404`。
- **🔴 别把 owner_token 和你们的 `/r/{token}` share-token 混为一谈**：owner_token 是**经理**的、走 header、能读整份工作区；你们的 share-token 是**员工分享链接**的、另一套语义、你们自管。ask 卡若要让员工只读某片，是你们 share-token 的活，不要拿 owner_token 顶。owner_token 接缝我们**特意留干净、不占 /r/ 或 ask 语义**。

## 3. 红线开关（feat-033 政策转向，Danny 2026-07-13 拍板）

- **`AVERY_ALLOW_PERSON_SCORING`**（`avery/scoring_policy.py`，只认显式 truthy：`1/true/yes/on`，其余含空=**默认关**）。
- **关** = 现护城河（打分/排名/画像被拦，离线全绿）。**开** = 放行**上传抽取(pipeline) + 笔记写侧(notes/registry)** 两条**非冻结**写路径。
- **冻结不动**：`redline.py` / `redline_extract.py` / `engine.py` / `PersonEntity` / `FROZEN.lock.json`（byte-identical）。detector 本身零改。**部署(feat-040)时开关设开**，真公司拿解禁版。
- **你们的 ask 若涉人打分**（员工问“给张三打几分”之类），**同此开关口径**：走 `person_scoring_allowed()`，别另起一套。advise 答案里 overtly 报分**仍未解禁**（要动冻结引擎，Danny 说先留着）。

## 4. 合并注意（你们合流时会撞）

- **main 已 ahead（你们 3a9cf5c）**。我们这条链本地未 push（对外闸=Danny）。
- **`src/lite/**` 有冲突要理**：我们碰了 —— feat-032/033 加了「文件空间」「Avery 笔记」tab（`src/lite/**` 的 store/tab/transport），feat-038 在 `src/lite/transport.ts` + `store.ts` 加了 owner_token 前端接线（按 context_id 存 /ingest 回传 token，team/files/notes/advise 自动带 header）。你们若也动了 `src/lite/**`，合并 src/lite 要逐处理。
- **`feature_list.json` trivial 冲突**：我们加了 feat-030…041 条目（尾部追加），你们加了你们的；合并取并集即可。
- **`eval-harness/**` 你们没碰**——那边冲突面为零。
- **ZH 文案**：我们手写的 ZH（feat-032/033 tab 文案）合并后可正经走 M3 补（你们那条 `scripts/i18n-zh.mjs` 定向 section 翻译线）。

## 5. 基建现实（影响你们的部署预期）

- **单一生产机 = 一台 2C/3.5G ECS，还跑着 ImaRead 全线**，剩余可用内存低（低三位数 MB 量级、**无 swap**；准确数看单一事实源 `D:\Boyle\agent-os\infra-brief.md`）。备案域名 + 可 SSH ECS 已在手。
- **Danny Q12 拍板：不预升配**，靠软护栏扛：feat-039 上传硬门（size/count/type/zip-bomb 上限 + 限流 + LLM 花费闸）+ **内存哨兵**（RSS 越水位 → `/health` `degraded:true` + WARN 日志「该升配了」，主动冒泡而非 OOMKilled 静默回收）。
- **feat-040 部署 checklist 已备**：瘦身单-worker Dockerfile + docker `--memory` 帽 + healthcheck 读 degraded；`docs/deploy/dual-deploy-runbook.md`（完整 env 清单 + 宝塔 nginx vhost + XFF 配方）。真部署=Danny 凭据墙（ECS host / 真 LLM key / DNS / Vercel `VITE_AVERY_API_BASE` / Supabase 连接串 / push 授权）。
- **你们的 `/ask` 端点**上线要注意：同样受硬门限流 + LLM 花费闸约束（别让员工 H5 的高频 ask 烧光 M3 额度 / OOM 单 task）。CORS 生产源 + TLS（前端 HTTPS→后端必须 HTTPS）沿用 runbook。

## 6. 真机证据（这层不是自说自话）

- **离线套件 474 passed**（零外网、零 DB、mock brain）。
- **@needs_db 41 passed**（真 Postgres），含 feat-041 新增：
  - `test_e2e_first_user.py` —— 一条贯穿 e2e：上传 A 真种子 → 团队/文件/记忆 → **硬重启（换进程+换 data dir）后仍在** → 隔离(B token 读 A → 404，A 读 B → 404，无枚举 oracle) → **真 RAG 双向隔离**(A 只引 A 的 facts.md 行、绝不出现 B 花名册名；B 反之) → 多轮 advise 笔记累积(newest-first、跨会话) → **红线开关两态**(关=打分笔记被丢/开=同一诱导问在持久 DB 路径落库)。
  - `test_e2e_stress.py` —— 基本压测：零星并发 /ingest+/advise 不崩·`/health` 不被拖挂(feat-028 threadpool)·硬门组合边界(超大413/超量413/伪装415/zip-bomb413)并发下各诚实降级·内存哨兵越水位 `/health degraded`·超频 429 削峰不崩。
- `./init.sh` 绿（lint + typecheck + build）。

---

**一句话给你们**：新建公司工作区走 `POST /ingest` 拿 `{context_id, owner_token}`；之后所有读/advise 带 `X-Avery-Token` header；owner_token 是经理凭据别进 URL、别和你们 /r/ share-token 混；人打分统一走 `AVERY_ALLOW_PERSON_SCORING` 开关；合并盯 `src/lite/**` + `feature_list.json`。持久化 + 隔离层已稳，阶段 C 接上即用。
