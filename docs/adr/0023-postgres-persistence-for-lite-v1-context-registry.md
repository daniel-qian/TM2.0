# lite v1 公司工作区落 Postgres(Supabase):ContextRegistry 持久化,取代"故意 ephemeral"

> 取代 [ADR-0021](0021-two-engine-core-vertical-packs-skins-dual-deploy.md) §6 中"sampler 用临时会话/上传样本,**不持久化**成公司工作区"的那半句——lite v1 定位已变(lean-real 钓鱼产品:真实公司自己上传、跨会话回访,见 `.issues/lite-v1-lean-real-0713/PRD.md`),数据一次重启就没等于当场露馅。ADR-0021 其余(两引擎/红线内建/换皮/双端)与 ADR-0022(墙/LLM 抽取/双层机器门)不动。
> **状态:** Accepted(feat-030,2026-07-13,AFK 实现;Danny 事后抽查)

## 决策

1. **数据库 = Supabase(Postgres 17 + pgvector),接现有 Python FastAPI 后端**(PRD ★DECIDED,不引入新后端栈)。持久化骑 feat-018 预留的 `ContextRegistry` get/put 接缝:`avery/ingest/pg_registry.py::PostgresContextRegistry` 与内存版同 API,`active_registry()` 按 env 选型——`AVERY_DB_URL`(别名 `PGVECTOR_URL`)设了走 Postgres,没设走内存(离线套件零外部依赖,照旧全绿)。
2. **落库内容 = 公司工作区的全部**:contexts(id/name/source_files)+ extraction 实体(people/projects/signals,有序 JSONB 行)+ materials chunks(行表)+ 物化记忆 facts.md/notes.md 全文。`get()` 全量重建 CompanyContext;本地 memory_dir 缺失(重启/换机)时**从 DB 重物化**,loop 的 recall/cite 零改动照跑;`AVERY_DATA_DIR` 指定稳定物化目录。
3. **红线在存储层也是结构性的**:Python 写入前对每个 person payload 跑既有 `validate_person_dict`(EN+ZH 全词表);schema 里 `entities_person_no_scoring_keys` CHECK 让**数据库本身**拒绝带 score/rank/tier/moodPct/capacityPct 等键的人行——绕过 Python 的未来写手也开不了洞。PersonEntity 类型无数字字段的护城河不变。
4. **共享项目现实 + 独立 schema**:生产 Supabase 项目 `nunsbijtntreynoyeilp` 与 Danny 在营产品 imaread 共享(public 40 张表)。Avery 一切对象进独立 schema `avery`,迁移只做增量 CREATE(`eval-harness/db/migrations/0001_avery_persistence.sql`,本地 Docker 与 Supabase 用同一文件,等价性 by construction)。**建议 Danny 后续为 Avery 独立开项目**,届时迁移 = 同一文件重放 + 数据搬运。
5. **预留接缝,不提前做实**:`materials.embedding vector(1024)`(feat-031 真 pgvector RAG 填)、`contexts.owner_token`(feat-034 租户隔离校验)。本 feature 均为列存在、逻辑不做。

## 取舍 / 理由

- **为什么现在推翻 §6**:§6 的"故意 ephemeral"服务的是"sampler=演示面"的旧定位;lean-real PRD 的用法(链接甩给真实公司、他们跨天回访)下,ephemeral 从设计美德变成 P0 缺陷(feat-028 只把"重启后未知 id"从静默错答修成 404,404 依然是坏产品)。
- **为什么骑 get/put 接缝而非新开**:feat-018 注释预留了这个位置;两实现过同一套契约测试,离线套件用内存版保持自治,`@needs_db` 层用本地 Docker pgvector 跑真机行为(生产连接串在 Danny 凭据墙内,agent 拿不到——本地 PG + MCP 双轨是当下最诚实的验证形态)。
- **每操作短连接、不建池**:lite v1 是零星并发;正确性(FastAPI threadpool 下天然安全、"新实例可见"由构造保证)先于吞吐。并发规模上来再上连接池,接缝不变。
- **回退成本**:不设 `AVERY_DB_URL` 即回 030 前行为(内存 registry + OS temp 物化),一键。

## 后果

- 重启/重新部署后:已知 context_id 的 `/team`、`/advise` 照常解析(集成层证据:真 uvicorn 硬杀重起,`tests/test_persistence_restart.py`);未知 id 仍大声 404(feat-028 行为保持)。
- `requirements.txt` 增 `psycopg[binary]` + `pgvector`(惰性导入,离线不需要;Docker 镜像必须带,静态门在 `test_requirements_complete.py`)。
- feat-031(真向量检索)/ feat-032(文件空间)/ feat-033(Avery 笔记)/ feat-034(隔离)全部落在本 schema 之上,列已就位。
