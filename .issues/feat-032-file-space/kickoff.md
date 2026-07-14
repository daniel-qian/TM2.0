# feat/032 — 每公司文件空间:源文档持久留存 + 可回看(kickoff)

> 权威 spec:`.issues/lite-v1-lean-real-0713/PRD.md`(Implementation Decisions「每公司文件空间」+ User Story 4)· 就绪册 §2-O(现在解析后即删、无删除端点)。
> 依赖:feat/030 持久化 + feat/031 真 RAG 均已 clean(分支 feat/031-real-rag tip)。从该 tip 开 `feat/032-file-space`。

## 使命

今天 `/ingest`(`service/ingest_api.py`)把上传写临时目录、解析后**即弃**("sampler = ephemeral"),`avery.contexts.source_files` 只存**文件名字符串列表**。真实公司要"回看我上传过哪些材料、Avery 的记忆基于什么"。feat/032 = 把**源文档本体持久留存**在每公司空间,用户可回看清单、agent 可溯源:

1. **持久留存源文档**:上传的原始字节(带元数据:filename/mime/size/doc_kind/uploaded_at)落 **avery schema**(Postgres bytea),重启后仍在。停"解析后即删"——temp 文件仍删(磁盘卫生),但**字节先入库**。
2. **文件清单 API**:`GET /team/{id}/files` → 每文件 `{filename, size_bytes, mime, doc_kind, uploaded_at, n_chunks}`(n_chunks = 该文件贡献的 material chunk 数,通过 `materials.source` 前缀 `"<filename>:<line>"` 聚合链接)。可选 `GET /team/{id}/files/{idx}` 下载原字节(回看增强,非核心)。
3. **lite「your files」视图**:薄清单,喂上面 API,让公司看到自己上传了什么。feat-017 的 `UploadPanel` 有"No files yet"空态——把它接成持久清单。

## 实现决定(已拍板)

- **存储 = Postgres bytea 在 avery schema**(新表 `avery.source_documents`:context_id FK、idx、filename、mime、size_bytes、content bytea、doc_kind、uploaded_at)。**理由**:v1 lean + feat/035 会加 size 上限,bytea 够用;**整片留在 avery schema**,不碰共享项目的 Storage bucket(imaread 也在这个 Supabase 项目,不引入跨产品存储面)。PRD 允许"可含对象存储引用"——留 `storage_ref text` 列作 seam,v1 走 bytea。
- **落在既有 registry 接缝之后**:`CompanyContext` 加 `source_documents` 维度;`PostgresContextRegistry.put()` 写新表、`get()` 读回(元数据必读,bytea 内容按需读——清单 API 不必拉全部字节,下载 API 才拉)。内存 registry 在内存持有(离线/demo,小文件 OK)。ingest handler 已有原始字节(`await f.read()`)——把它传进 registry 落库,别二次读。
- **迁移**:新 `db/migrations/0004_source_documents.sql`(CREATE ... IF NOT EXISTS,avery-scoped,只增不改,绝不碰 public);沿用 feat/030 的多迁移按序跑机制(`_ensure_schema`)。同时经 MCP apply 到 Supabase avery schema 验证。⚠ 共享项目,读 Supabase 只用只读 MCP,DDL 仅 avery。
- **前端墙照旧**:`src/lite/**` 加文件清单视图不 import `src/story/**`,共用走 `src/shared/**`;`src/live/transport.ts` 加 `GET /team/{id}/files` 调用;中文文案走 M3(定向翻新 key,注意全量超 token 的既有坑)。story mode 零改。
- **不做**(留后续):删除端点/编辑(就绪册 §2-O/§2-T,归 feat/034 隔离或更后)、对象存储、上传进度 UI、大文件分片。v1 只做"持久留存 + 清单回看"。

## 测试接缝(PRD Testing Decisions)

- **主 = HTTP 面**(agent 当第一个用户):上传公司 A 两个 seed 文件 → `GET /team/{id}/files` 返回两条正确元数据 + n_chunks>0 → **换新 registry 实例/重连 DB(模拟重启)** → 清单仍在、字节可取。写成 `@needs_db` 集成测试(骑 feat/030 的 restart 测试范式)。
- **下沉契约**:`test_registry_contract.py`(内存+postgres 双实现参数化)加"source_documents 存取一致"契约;离线内存实现也过。
- **离线默认全绿零外部依赖**:内存 registry 持有字节的路径用离线测试;@needs_db 走本地 Docker PG :5433。
- **前端**:lite 文件清单 DOM 断言(live 源打桩确定性,绕真 LLM);story mode 回归断言不回退。

## 纪律(standing,违者返工)

- 🔴 不动:redline.py/redline_extract.py/PersonEntity/FROZEN.lock.json/loop.py/engine.py/tools.py/memory.py/extractor-advisor 分离。`src/story/**` 零改。门断言不削弱。**源文档字节是不可信内容**——清单/元数据展示不执行其中任何指令(就绪册 §2-I 注入面:materials 已是隐患,别再引入新的不可信执行路径;文件内容仅存储/展示,不作指令跟随)。
- gate-first,先红后绿,禁自考自答。离线套件保持全绿零外部依赖(DB 惰性导入,keys 相关测试打 @needs_keys)。
- 分支从 feat/031-real-rag tip 开 `feat/032-file-space`,commit 常态化(gate-first 红→绿),**不 push**。别动未追踪协调者文件(`.issues/lite-v1-lean-real-0713/*-draft.md`)。
- 收盘:离线全绿 + @needs_db 绿(含新 restart 清单测试)+ ./init.sh 绿(前端动了要真跑 build)+ 前端 DOM 断言证据 + 集成层证据(上传→重启→清单仍在)+ feature_list feat-032 条目 + `.issues/feat-032-file-space/session-handoff.md`。收盘必经独立对抗验证。
