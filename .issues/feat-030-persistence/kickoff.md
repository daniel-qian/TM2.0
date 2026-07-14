# feat/030 — Supabase(Postgres)持久化:ContextRegistry + 记忆落库(kickoff)

> 权威 spec:`.issues/lite-v1-lean-real-0713/PRD.md`(status: ready-for-agent)· 方向+接缝:同目录 `session-close-and-direction.md` §3.3/§4 · 就绪册 §2-B/§2-O。
> 这是 lite v1 链的第一环:真记忆/真RAG/文件空间/笔记/隔离全骑在它上面。

## 使命

替掉进程内 `REGISTRY`:公司数据(extraction 实体 + 材料 chunks + 物化记忆 facts.md/notes.md + 源文件清单)落 Postgres,**重启/重新部署后全部还在**。骑既有接缝,不新开:

- `avery/ingest/registry.py::ContextRegistry` 的 `get/put` 接口保持(feat-018 注释已预留 "a DB-backed registry plugs in behind the same get/put")。
- `materialize_memory` 出 OS temp(现 `pipeline.py:75` 写 `gettempdir()/avery-contexts`)→ 稳定数据目录(env 如 `AVERY_DATA_DIR`)+ **从 DB 重物化**:重启后 `get(context_id)` 能在本地盘缺失时从 DB 重建 memory_dir,loop 的 recall/cite 零改动照跑。
- `/advise` 未知 id 404(feat/028 已落,app.py:169-172)行为保持:**已知 id 重启后必须解析成功而非 404**。

## 环境事实(动手前必知)

- **Supabase 项目 = `nunsbijtntreynoyeilp`(us-east-2,PG 17,pgvector 0.8.0 已装在 extensions schema)。⚠ 该项目与 Danny 另一个在营产品(imaread,~40 张表在 public)共享!** Avery 一切对象放**独立 schema `avery`**,迁移只做增量 DDL(CREATE),**绝不**触碰 public/既有对象,绝不 DROP 非 avery 对象。Supabase 侧 DDL 走 MCP 工具 `mcp__ddcba38f-...__apply_migration`(project_id 如上;先 ToolSearch 加载 schema)。
- **运行时连接串(DB 密码)不可得**——MCP 拿不到,属 Danny 凭据墙残留。因此 `@needs_db` 集成层用**本地 Docker Postgres+pgvector**(镜像 `pgvector/pgvector:pg17`,别占 5432,建议 5433)跑真机行为证明;Supabase 侧 schema 用 MCP apply + execute_sql 验证等价。Danny 后续填 `PGVECTOR_URL` 即接生产。**Docker Desktop 刚被启动,引擎可能还需一两分钟就绪(`docker ps` 轮询)。**
- 环境:Windows,Python 3.13 全局(无 venv),`eval-harness/.env` 已有 MiniMax/DeepSeek/DashScope key。真机服务验证别占 :8137/:5173。
- 离线全套基线:`cd eval-harness && python -m pytest -m "not seedgate and not smoke" -q` → **329 passed / 7 deselected / 1 xfailed**(动手前自证一次)。

## 实现决定(已拍板,不 re-litigate)

- DB 驱动:`psycopg[binary]`(psycopg3)+ `pgvector` python 包进 `requirements.txt`(注意 `tests/test_requirements_complete.py` 同步)。**离线套件不 import 失败**:DB 代码惰性导入或 try-import。
- 连接 env:`AVERY_DB_URL`(接受 `PGVECTOR_URL` 作别名,后者已在 `service/.env.example:76` 有名分)。设置了 → Postgres registry;未设置 → 内存 registry(离线默认,全绿不依赖外部服务)。
- schema(表设计交给你,但必须含):
  - contexts 表:context_id PK、name、source_files、created_at;**预留 `owner_token` 列**(feat/034 隔离用,本 feature 先落列不做校验逻辑);
  - extraction 实体(people/projects/signals)与 materials chunks 落库(JSONB 或行表,你选;materials 行表更利于 feat/031 pgvector 加 embedding 列 + feat/032 文件空间);
  - **chunks/materials 表预留 `embedding vector(N)` 可空列**(N 按 .env 的 `AVERY_EMBED_DIM`,读不到就 1024)——feat/031 做实,本 feature 不填。
  - 物化记忆(facts.md/notes.md 全文)落库,重物化用。
- **PersonEntity 数值字段禁令在 DB 层同样成立**:人相关行/JSON 永不带 score/rank/tier/moodPct/capacityPct 键(红线是结构性的,落库不能开洞)。
- 测试接缝(PRD Testing Decisions):
  - **契约测试一套、双实现跑**:共享契约(put→get 一致、recall 行为、team_cards 无禁键)内存+Postgres 都过;**耐久契约**(新 registry 实例/新连接仍 get 到、memory_dir 重物化)只对 Postgres 断言。
  - `@needs_db` marker 进 `pytest.ini`,与 seedgate/smoke 同规格:无 `AVERY_DB_URL` 时干净 skip;离线全套命令不变仍全绿。
  - **集成层证据(agent 当第一个用户,必须有)**:HTTP 面真机——起 uvicorn(env 指向本地 Docker PG)→ POST /ingest 真文件(seed 在 `tests/fixtures/seed/`)→ GET /team/{id} 有团队 → **杀进程重起 uvicorn** → 同 id GET /team/{id} 团队仍在、POST /advise 引用仍解析。这条写成可复跑的测试(subprocess 起服务)或脚本+记录证据。
- ADR:写 `docs/adr/0023-*.md`(短)——取代 ADR-0021 §6 的 REGISTRY 故意 ephemeral;记录 Supabase 选型 + 共享项目/独立 schema 现实 + 建议 Danny 后续独立项目。

## 纪律(standing,违者返工)

- 🔴 不动:`avery/redline.py`、`avery/ingest/redline_extract.py`、`PersonEntity` 结构、`redline_rules.md`/`FROZEN.lock.json`、advisor 引擎(`loop.py`/`engine.py`/`tools.py`)、extractor/advisor 分离。`src/story/**` 零改。门断言不削弱。
- gate-first:新行为断言先写、先红(对现状),再实现修绿。禁 fixture 自考自答。
- 分支:从当前 HEAD(= main `2bda603`)开 `feat/030-persistence`,在本 worktree 干。commit 常态化(先斩后奏),**不 push**。
- 收盘:`./init.sh` 绿 + 离线套件全绿 + @needs_db 对本地 PG 全绿 + 集成层证据落盘;更新 `feature_list.json`(加 feat-030 条目含 evidence)+ 写 `.issues/feat-030-persistence/session-handoff.md`(供对抗验证与下环接续)。
