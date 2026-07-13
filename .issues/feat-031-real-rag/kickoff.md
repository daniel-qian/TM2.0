# feat/031 — 真记忆 + 真 RAG:pgvector 做实,替 keyword 占位(kickoff)

> 权威 spec:`.issues/lite-v1-lean-real-0713/PRD.md`(Implementation Decisions 第 3 条 + Testing Decisions「真 RAG」)· 方向 `session-close-and-direction.md` §3.3-②/§4「要做实」· 就绪册 §2-K。
> 依赖:**feat/030 持久化必须先 clean**(骑在 avery.materials.embedding 列 + PostgresContextRegistry 上)。base = feat/030-persistence 的 tip(对抗验证通过后)。

## 使命

把 RAG 从 keyword 占位升成**真向量检索**,并让它**持久化 + 重启后仍是向量**:

1. `store.py` 的 `VectorStore` 现在是内存 numpy cosine + `persistence="pgvector"` 只是字符串标签(**无 psycopg/pgvector 实现**)。做一个真 **pgvector 后端**(新类 `PgVectorStore` 或给 VectorStore 加 pg 持久层,behind 同一 `RetrievalStore` 接口):embedding 落 `avery.materials.embedding vector(1024)`(feat/030 已建列,现恒 NULL),query 用 pgvector cosine kNN(`<=>` 算子 + 可选 ivfflat/hnsw 索引)。
2. embedding 复用 `service/embedding_factory.py`(DashScope text-embedding-v4,dim 1024)。`app.py:144` 现在传 `embedder=make_embedder()` 但 **`prefer_vector` 没开**(pipeline 默认 KeywordStore)——接线成:有 embedder 时 `prefer_vector=True` 走向量路径。
3. **feat/030 的 `PostgresContextRegistry.get()` 现在只重建 `KeywordStore`**(pg_registry.py:183-184)。做实后:put() 时把 material chunk 的 embedding 写进 `avery.materials.embedding`;get() 时若有 embedder 配置则重建 **pgvector-backed store**(直接对 DB 做 kNN,不必把全部 chunk 拉回内存),否则退 KeywordStore。**重启后检索仍是向量**是本 feature 的持久化契约。
4. **修 07-07 起 held-open 的召回缺口**:`tests/test_seed_gate.py::test_advise_cites_the_design_lead`(@seedgate @needs_keys)——几十人花名册里 top-k keyword 漏掉 Lin Qing(Design Director)行,advise 证据引不到。真向量检索应能命中。这条是 feat/031 的**真机验收信号**(带 key 跑)。

## 环境事实

- **离线默认必须仍全绿、零外部依赖**:`AVERY_EMBEDDINGS=keyword`(默认)或无 DASHSCOPE_API_KEY → embedder=None → 退 KeywordStore;`HashingEmbedder`(store.py 已有,确定性无依赖)让**向量路径本身**在离线测试里被真 cosine 数学走一遍。真 pgvector kNN 走 `@needs_db`(本地 Docker PG :5433,pgvector 已装),真 DashScope embedding 走 `@needs_keys`(.env 有 DASHSCOPE_API_KEY)。
- **本地 PG**:`postgresql://postgres:avery_local_dev@127.0.0.1:5433/postgres`(容器 avery-pg)。pgvector 扩展已装。`AVERY_DB_URL` 别名 `PGVECTOR_URL`。
- **Supabase**:项目 `nunsbijtntreynoyeilp`,pgvector 0.8.0 在 extensions schema;avery schema 已由 feat/030 建。**dim=1024** 已定(`AVERY_EMBED_DIM`,DashScope text-embedding-v4)——若列/嵌入维度要改,是 schema 迁移(feat/030 已固定 1024,除非有强理由别动)。⚠ 共享项目,只碰 avery schema。
- 契约测试骑 feat/030 的 `tests/test_registry_contract.py`(memory + postgres 双实现参数化):加向量检索的行为契约(命中语义相关行、跨 registry 实例/重启后仍向量),两实现都过或 postgres-only 标注清楚。

## 实现纪律(standing,违者返工)

- 🔴 不动:`redline.py`/`redline_extract.py`/`PersonEntity`/`FROZEN.lock.json`/`loop.py`/`engine.py`/`tools.py`/extractor-advisor 分离。`src/story/**` 零改。门断言不削弱。**embedding 只落 material chunks,人相关实体永不进向量打分逻辑**(向量是文档检索,不是人画像)。
- **诚实**:`/health` 的 embeddings 字段如实报 keyword vs dashscope(active_embeddings 已有);别再挂假 pgvector 名——现在要么真 pgvector 要么诚实 keyword。
- gate-first;先红后绿;禁 fixture 自考自答。分支从 feat/030 tip 开 `feat/031-real-rag`,commit 常态化,**不 push**。
- 收盘:离线全套绿 + @needs_db 向量 kNN 绿 + @needs_keys 召回缺口测试转绿(或诚实记录残留)+ 集成层证据(HTTP 面:上传大花名册→advise 引用真事实行,重启后仍向量命中)+ feature_list feat-031 条目 + `.issues/feat-031-real-rag/session-handoff.md`。收盘必经独立对抗验证。
