# feat/031 — 真向量 RAG(pgvector 落实)· session handoff

> Branch `feat/031-real-rag`(base = feat/030-persistence tip `608a8c9`,**未 push**)。
> AFK 全自主 · gate-first · 收盘待独立对抗验证。

## 使命完成度(对 kickoff §使命 1-4)

| # | 使命 | 状态 |
|---|------|------|
| 1 | store.py 真 pgvector 后端(embedding 落 materials.embedding,`<=>` cosine kNN),behind 同一 RetrievalStore | ✅ `PgVectorStore` |
| 2 | /ingest 有 embedder 时开 prefer_vector | ✅ `service/ingest_api.py`(注:kickoff 提到的 app.py:144 是 /advise 的 memory.recall embedder,已在 feat 早前接;prefer_vector 的真实接线点是 /ingest 处理器) |
| 3 | pg_registry put() 写 embedding;get() 有 embedder 配置重建 pgvector store 否则退 KeywordStore;重启后仍向量=持久化契约 | ✅ 写测试锁 |
| 4 | 修 07-07 held-open 召回缺口 `test_advise_cites_the_design_lead`(@needs_keys) | ✅ **转绿**(真机跑通两次) |

## 改了什么(commit `896bffb` 核心 + 后续)

- `eval-harness/avery/ingest/store.py` — 新增 `PgVectorStore`(DB 内 cosine kNN via `<=>`,scoped by context_id,psycopg 懒导入);`VectorStore.persisted_vectors()`(语料只 embed 一次);`_vec_literal()`(无 pgvector-python 依赖的 `[..]::vector` 字面量);`build_store` 默认 `persistence="in-memory"`(诚实,内存 store 永不挂 pgvector 假名)。
- `eval-harness/avery/ingest/pg_registry.py` — `__init__(embedder=)`;`_material_vectors()`(优先复用 pipeline VectorStore 向量,dim≠1024 退 NULL 不崩,embedding 在事务外算);put() materials INSERT 写 `embedding %s::vector`;get() 有 embedder 且 `emb_count>0` → `PgVectorStore` 否则 `KeywordStore`(诚实)。
- `eval-harness/avery/ingest/registry.py` — `active_registry()` 用 `make_embedder_from_env()` 解析 env embedder 传入 PG registry。
- `eval-harness/avery/embeddings.py` — 新增 `resolve_embeddings_kind()` + `make_embedder_from_env()`:单一 AVERY_EMBEDDINGS 闸,service 与 DB registry 共用(无 avery.ingest→service 耦合)。
- `eval-harness/service/embedding_factory.py` — 委托给上面的共享闸(公共 API 不变)。
- `eval-harness/service/ingest_api.py` — /ingest 处理器 `embedder=make_embedder()` + `prefer_vector=embedder is not None`。
- `eval-harness/db/migrations/0003_materials_embedding_index.sql` — HNSW cosine 索引(`vector_cosine_ops`,idempotent,avery-scoped)。
- `eval-harness/tests/test_pgvector_store.py`(新)— gate-first 门。
- `feature_list.json` — feat-031 = done。

## 三层测试数字(可复跑,round-2 后)

- **离线·零外网**(new needs_keys marker deselected):`cd eval-harness && python -m pytest -m "not seedgate and not smoke and not needs_keys" -q`
  = **341 passed / 18 skipped / 8 deselected / 1 xfailed**。临时清空 `DASHSCOPE_API_KEY`/`MINIMAX_API_KEY` 复跑仍 **341**;`--collect-only` 证 `test_real_embeddings_find_what_keyword_misses` 未被选 = literally 零外部网络。(round-1 曾把这条真发网络的测试算进『离线 341』,现拆出。)
- **离线·含 needs_keys**(有 key,含那条真 DashScope 召回):`python -m pytest -m "not seedgate and not smoke" -q`
  = **342 passed**(= 零外网 341 + `test_real_embeddings_find_what_keyword_misses` 真跑)。
  - round-2 offline 门变化:test A 由『内存+embedder→vector』改成成本闸『内存+embedder→keyword 且 embed 0 次』;test B 新增 wrong-dim warning 门(caplog)。net offline +1。
- **@needs_db**(本地 Docker pgvector 0.8.2/pg17 :5433,容器 avery-pg):
  `AVERY_DB_URL='postgresql://postgres:avery_local_dev@127.0.0.1:5433/postgres' python -m pytest -m needs_db -q`
  = **18 passed**(feat-030 契约 13 + feat-031 5,round-2 pg_registry 改动零回归)。HashingEmbedder(1024) → 无需 DASHSCOPE key。
- **init.sh**(story/lite TS 墙:lint+typecheck+build)= **绿**(改动纯 Python,零回归)。
- **@needs_keys / seedgate**(真 uvicorn :8137 minimax+dashscope):round-1 = **6 passed**(含 `test_advise_cites_the_design_lead` 召回缺口转绿,~142–209s)。**round-2 未重跑**:3 项修复均不碰 advise 路径(advise 走 `memory.recall` over facts.md、从不读 `ctx.store`;Fix A 只去掉无读者的 ingest-时 embedding),dc20862 证据仍立。

## 召回缺口测试状态

**转绿。** `test_advise_cites_the_design_lead` 真机跑通:上传官方 seed 大花名册 → `/advise "who leads design"` → advice 证据真向量(DashScope 语义 recall over facts.md)命中 Lin Qing(Design Director)行。两次独立跑均绿(单跑 + 全 seedgate 套件)。

## pgvector 检索的集成层证据

- **HTTP 上传→advise 引真事实行**:@needs_keys seed gate(上表)。
- **重启后仍向量命中(store 面)**:@needs_db `test_pgvector_persists_embeddings_and_recall_is_vector_after_restart`(put 写满 embedding → 新 registry 实例 + 全删本地 data dir → `store.backend` 含 pgvector + recall DB kNN 仍命中)+ HTTP 面 `test_ingest_over_http_persists_pgvector_and_survives_restart`(POST /ingest 真 DB → materials.embedding 全填 → 重启 get pgvector store kNN 命中,注入 HashingEmbedder(1024) 无 key 确定性)。

## Supabase 迁移状态

migration `0003_materials_embedding_index` 已经 MCP `apply_migration` 应用到 `nunsbijtntreynoyeilp`;`execute_sql` 验证 `materials_embedding_hnsw_cosine`(USING hnsw vector_cosine_ops)在位,embedding=vector(1024),pgvector 0.8.0。只碰 avery schema。本地 db/migrations/0003_*.sql 同步落盘(_ensure_schema 按序自举,本地 Docker 已建同名索引)。

## round-2 对抗验证收口(发现 → 修复 → 复跑)

独立验证认定头号命题成立(召回缺口真机绿)、冻结文件零改动、pgvector 持久层真实、Supabase 迁移安全 —— 无 CRITICAL/HIGH,抓 3 项有界缺口。全部修实(gate-first:红 commit → 绿 commit),均在 feat-031 自有文件,未碰冻结墙(redline*/PersonEntity/loop/engine/tools/memory/FROZEN.lock.json)。

| # | 缺口 | 发现(修前) | 修复 | 复跑证据 |
|---|------|------------|------|----------|
| A | MEDIUM · 成本 | 内存 registry + DASHSCOPE key 在场时 `/ingest` embed 整个语料(真 DashScope 花费),但那 in-memory `VectorStore` 永不被 advise 读(advise 走 `memory.recall` over facts.md,从不 query `ctx.store`)→ 每上传一次纯烧钱 | `service/ingest_api.py`:`prefer_vector = embedder is not None and getattr(registry, "persistent", False)`;新增 `registry.persistent` 标志(`ContextRegistry=False` / `PostgresContextRegistry=True`)。内存路径不开向量 → 0 次 embed。持久 registry 才 embed(向量有读者=pgvector store)。 | offline `test_ingest_in_memory_registry_does_not_embed_even_with_embedder`(store=keyword 且 embed 计数=0);修前该门红(内存开 vector + embed 1 次)。@needs_db HTTP 门证持久路径仍开 vector(18 passed)。 |
| B | LOW · 诚实 | embedder dim ≠ 1024(列 `vector(1024)`)时 `put()` 写 NULL、`get()` 静默退 KeywordStore,无异常无日志 | `pg_registry._material_vectors`:dim≠列维度时 `logger.warning(...)`(logging,内容含实际 dim vs 1024 + `retrieval degraded to keyword`)后退 NULL、不崩;store 层 backend 照旧诚实报 keyword(未动)。 | offline `test_pg_registry_warns_on_wrong_dim_embedder_and_degrades_to_keyword`(caplog 断言 `64`/`1024`/`keyword` + 返回 None 不崩);修前该门红(msg 空)。 |
| C | LOW · 诚实标注 | `test_real_embeddings_find_what_keyword_misses` 真发 DashScope 网络,靠 skipif 无 key 才跳,却算进『离线 341』;『real pgvector RAG』措辞暗示 advise-facing 检索 | 打 `@pytest.mark.needs_keys`(`pytest.ini` 注册 marker)→ `-m "not ... needs_keys"` 真正零外网、literally 341;handoff/feature_list 措辞诚实化(见下 §honest 边界)。 | `--collect-only -m "not ... needs_keys"` 该测试未被选;零外网 341 复跑(有/无 key 均 341)。 |

### honest · 『真向量 RAG』的准确边界(C 的措辞收口)

- **advise 召回** = `avery.memory.recall` 语义排序 over `facts.md`(真向量、修好 07-07 召回缺口)。这是喂 advise 证据的那条检索面。
- **`PgVectorStore` / pgvector『真向量 RAG』** = `CompanyContext.store` 的**持久 store 层基建**(@needs_db 契约证真、重启后仍向量),**advise 暂不读**(受 loop/engine/tools 冻结墙约束,留后续 feat-032 接)。
- 故『real pgvector RAG』指**持久 store 面**,**不**暗示 advise-facing 检索 —— 两面沿用既有架构分离。

## 自评薄弱点(round-1 原文 + round-2 批注)

1. **advise 证据 vs PgVectorStore 是两条检索面**:advise 的证据走 `avery.memory.recall` 语义排序(over facts.md,frozen loop 的既有接缝)。`PgVectorStore` 是 `CompanyContext.store` 的持久检索面,当前**不喂 advise**(未打 loop/engine/tools 冻结墙)。故召回缺口的绿由 memory.recall 语义贡献,pgvector store 的绿由 @needs_db 契约贡献 —— 两者都是「真向量」但不同面。若对抗验证认为「真 RAG」必须是 store 喂 advise,需重新裁定(会触冻结墙,超出本 feature 纪律)。
2. **无 DB 内存 registry + 有 key 时**:/ingest 会 embed 语料(DashScope 成本)但 in-memory VectorStore 不被 advise 用 → 演示路径有浪费。~~可选优化:prefer_vector 只在持久 registry 时开(未做)。~~ **✅ round-2 缺口 A 已修**:`registry.persistent` 标志闸,内存路径 0 次 embed。
3. **@needs_keys 成本**:MiniMax 抽取分钟级 + DashScope 调用;seed gate 单跑 ~142s。CI 无 key 干净 skip。
4. **dim 硬编 1024**:列是 vector(1024),`_embed_dim()` 读 AVERY_EMBED_DIM 默认 1024。改维=schema 迁移(feat-030 已固定)。put() 对 dim≠1024 退 NULL(诚实降级不崩)。~~但若 embedder 静默换维会静默退 keyword —— 未加显式告警。~~ **✅ round-2 缺口 B 已修**:`_material_vectors` 检出 dim 不符打 warning。
5. **HTTP+DB 集成测试**用 monkeypatch 注入 embedder + 清 `_PG_REGISTRIES` 缓存(进程级全局),稍脆;真机 seed gate 是更硬的信号但要 key。

## 待 Danny / 下环(非阻塞开发)

- 运行时接入:`AVERY_DB_URL`(或 PGVECTOR_URL)+ `AVERY_EMBEDDINGS=dashscope` + `DASHSCOPE_API_KEY`(凭据墙内)。
- push origin(对外闸,留 Danny)。
