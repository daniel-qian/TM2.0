# feat/030 — session handoff(交接:对抗验证 + feat/031 接续)

> 分支 `feat/030-persistence`(base = main `2bda603`,不 push,对外闸留 Danny)。
> Spec:同目录 `kickoff.md` + `.issues/lite-v1-lean-real-0713/PRD.md`。ADR:`docs/adr/0023-*.md`。
> 状态:**done,三层证据全绿**(离线 / @needs_db / 集成层),Supabase avery schema 已应用并验证等价。

## 1. 交付了什么(行为,不是结构)

- **重启后公司还在**:`AVERY_DB_URL`(别名 `PGVECTOR_URL`)设了 → 公司工作区(contexts + people/projects/signals + materials chunks + facts.md/notes.md 全文)全部落 Postgres 独立 `avery` schema;服务硬杀重起后,同 `context_id` 的 `GET /team` 字节等、`POST /advise` 照常引用(memory_dir 本地缺失时从 DB 字节等重物化,loop recall/cite 零改动)。
- **离线自治不变**:env 未设 → 内存 registry + OS temp 物化(030 前行为),离线套件命令不变、无 psycopg 也能跑(DB 代码全部惰性导入)。
- **feat-028 行为保持**:未知 id 仍大声 404;已知 id 重启后必解析(这正是新增的那条产品命)。
- **红线在存储层也结构化**:Python 写前跑既有 `validate_person_dict`(EN+ZH 全词表,违规 raise、零落库);schema `entities_person_no_scoring_keys` CHECK 让 **DB 本身**拒绝带 score/rank/tier/moodPct/capacityPct 等键的人行(绕过 Python 的未来写手也开不了洞)。`PersonEntity` 无数字字段的类型护城河未动。

## 2. 代码地图(新增/改动)

| 文件 | 内容 |
|---|---|
| `eval-harness/avery/ingest/pg_registry.py` | **新** PostgresContextRegistry:put/get/resolve_memory_dir/__contains__/delete/clear,同鸭子 API;每操作短连接;`_ensure_schema()` 幂等自举(执行迁移文件本体) |
| `eval-harness/db/migrations/0001_avery_persistence.sql` | **新** 唯一迁移:avery schema 4 表(contexts/entities/materials/memory_files),只 CREATE IF NOT EXISTS;本地与 Supabase 同文件 |
| `eval-harness/avery/ingest/registry.py` | + `db_url()` / `data_root()` / `active_registry()`(env 选型,PG 实例按 url 进程内缓存);REGISTRY 原样保留 |
| `eval-harness/avery/ingest/pipeline.py` | 默认 registry=active_registry();物化 base=data_root()(`AVERY_DATA_DIR`,fallback OS temp 不变) |
| `eval-harness/avery/ingest/seam.py` | resolve_memory_dir 默认 registry=active_registry() |
| `eval-harness/service/ingest_api.py` / `app.py` | REGISTRY 硬引用 → active_registry()(/ingest、/team、/advise 的 _context_registered) |
| `eval-harness/requirements.txt` | + `psycopg[binary]>=3.1`、`pgvector>=0.3`(惰性导入;Docker 镜像必须带) |
| `eval-harness/tests/test_registry_contract.py` | **新** 一套契约双实现(memory 恒跑 / postgres @needs_db)+ 耐久契约 + schema 门 |
| `eval-harness/tests/test_persistence_restart.py` | **新** 集成层:真 uvicorn 硬杀重起(见 §4) |
| `eval-harness/tests/test_requirements_complete.py` | + psycopg 声明静态门(同 multipart 门形状) |
| `eval-harness/tests/test_advise_context_id.py` / `test_seed_gate.py`(离线 fixture) | + `delenv AVERY_DB_URL/PGVECTOR_URL`:这些门测内存路径,机器 env 不得翻转其被测对象 |
| `eval-harness/pytest.ini` | + `needs_db` marker |
| `eval-harness/service/.env.example` | §3 改写:AVERY_DB_URL/PGVECTOR_URL/AVERY_DATA_DIR 说明 |

**没动**(纪律):redline.py、redline_extract.py、PersonEntity、FROZEN.lock.json、loop.py/engine.py/tools.py、`src/story/**`、前端一切。

## 3. schema 摘要(avery,PG17,pgvector 0.8.0)

```
contexts      context_id text PK · name text · source_files jsonb · owner_token text NULL(feat-034 预留)
              · created_at/updated_at timestamptz
entities      (context_id FK cascade, kind∈person|project|signal, idx) PK · payload jsonb
              · CHECK entities_person_no_scoring_keys(kind='person' ⇒ payload 无 score/scores/rank/
                ranking/tier/grade/percentile/moodPct/capacityPct/mood/capacity/rating/performance/potential)
materials     (context_id FK cascade, idx) PK · chunk_id/text/source/doc_kind
              · embedding vector(1024) NULL(feat-031 预留,本 feature 恒 NULL;1024=AVERY_EMBED_DIM)
memory_files  (context_id FK cascade, filename∈facts.md|notes.md) PK · content text(全文,重物化源)
```

## 4. 三层证据(全部可复跑)

- **离线**(无 AVERY_DB_URL):`cd eval-harness && python -m pytest -m "not seedgate and not smoke" -q` → **336 passed / 10 skipped / 7 deselected / 1 xfailed**(基线 329 + 新门 7;10 skip = PG 契约 5 腿 + 耐久 4 + restart 1,全部干净 skip)。
- **@needs_db**(本地 Docker `pgvector/pgvector:pg17`,容器 `avery-pg`,:5433,密码 avery_local_dev):
  `$env:AVERY_DB_URL="postgresql://postgres:avery_local_dev@127.0.0.1:5433/postgres"; python -m pytest -m needs_db -q` → **10 passed**。全套带 URL → **346 passed / 1 xfailed**。
- **集成层**(`tests/test_persistence_restart.py`,@needs_db 自动跑):真 uvicorn subprocess(mock 脑/heuristic 抽取/keyword 检索,动态端口)→ POST /ingest 官方 seed(LogiPulse-Roadmap.pdf + PrismDesign_TeamProfile_EN.xlsx)200 → GET /team 200 → `proc.kill()` 硬杀 → **新进程 + 新端口 + 新 AVERY_DATA_DIR(fresh-machine 语义,本地文件零残留)** → 同 id GET /team 200 **payload 字节等** + POST /advise 200 `contract_ok:true` + ghost id 仍 404 → **1 passed(9.5s)**。
- **gate-first 红证据**(commit `d33c4e5`):AVERY_DATA_DIR 门红(旧管线写 OS temp)、PG 9 腿 error(模块不存在)、restart 门真机复现 life-2 /team 丢公司(030 前故障原样)。
- **init.sh**:exit 0(lint 墙 0 errors / 3 pre-existing warnings,tsc 零错,build 绿——前端零改动防误伤跑过)。

## 5. Supabase 侧状态

- 项目 `nunsbijtntreynoyeilp`(us-east-2,与 imaread 共享)。MCP `apply_migration`(名 `avery_0001_persistence_feat_030`)已应用 = 迁移文件本体逐字。
- 验证(execute_sql):avery 4 表 **20 列**(名/类型/可空/序号)与本地 Docker 逐条一致;**10 约束** `pg_get_constraintdef` 与本地 byte-identical;`embedding = vector(1024)`;`public` 仍 40 表零触碰。行为烟测:评分人行 INSERT → `check_violation` 拒;干净人行通过;烟测行已清(0 残留)。
- **运行时连接串仍在 Danny 凭据墙内**(MCP 拿不到 DB 密码)。生产接入 = Danny 在服务 env 填 `AVERY_DB_URL`(Supabase pooled 连接串)即可;`_ensure_schema()` 幂等,表已在,首个请求直接可用。
- avery schema **未**加进 PostgREST exposed schemas(默认只暴露 public)——数据面只经服务后端直连,无额外 API 面。RLS 未开(schema 不走 PostgREST;隔离是 feat-034 的应用层 owner_token 活)。

## 6. 新 env 变量

| 变量 | 语义 |
|---|---|
| `AVERY_DB_URL` | 主名。设了 → Postgres registry;未设 → 内存(离线默认) |
| `PGVECTOR_URL` | 别名(.env.example 既有名分);同一 DB 将被 feat-031 复用填 embedding |
| `AVERY_DATA_DIR` | 物化 facts.md/notes.md 的稳定本地目录;有 DB 时是可重建缓存;默认 OS temp |

## 7. 未尽事项(顺序即建议)

1. **feat-031 真向量 RAG**:`materials.embedding` 列已在(NULL);`store.py` VectorStore 的 pgvector 后端 + DashScope embedder 接上,`pgvector` python 包已进 requirements。get() 重建时按 env 选 KeywordStore/VectorStore 的分支要一并做。
2. **feat-032 文件空间**:源文件本体未落库(现只存 source_files 文件名清单;`/ingest` 仍解析后即删)。materials 行表已按此预留。
3. **feat-033 Avery 笔记**:memory_files 表可直接长出 agent 自写 notes(写侧必过红线门,PRD 已定)。
4. **feat-034 隔离**:`owner_token` 列在位,零校验逻辑(现状:拿到 context_id 就能读,与 030 前同——本 feature 明确不做)。
5. `updated_at` 只在 contexts upsert 时刷新;entities/materials 无独立时间戳(030 不需要)。
6. Danny:独立 Supabase 项目迁移建议(ADR-0023 §决策4);生产 `AVERY_DB_URL` 填充;push。

## 8. 薄弱点自评(对抗验证请打这里)

1. **PG registry 的 clear() 是全库删 contexts**(内存 API 对齐用)。当下无人调用它(测试用 track+delete),但若未来某测试 fixture 在 `AVERY_DB_URL` 指生产时调 clear() = 数据事故。缓解:契约测试全部 track-and-delete;文档标注"仅限一次性本地 DB"。**没有代码级保险丝**(如 refuse-unless-localhost)。
2. **每操作短连接**:零星并发 OK,但 /team + /advise 一次请求触发 2-3 次 connect(_context_registered → resolve_memory_dir → …);Supabase pooled string 下可接受,高频会显拙。接缝已留(全部走 `_connect()`),上池不动 API。
3. **get() 重物化只补缺失文件、不校验已存在文件与 DB 一致性**:本地 facts.md 若被外部改写(如未来 feat-033 追加 notes 后没写回 DB),重启后 DB 版本胜出/或本地陈旧版本被沿用(取决于文件是否还在)。feat-033 落笔记时必须定"写穿(write-through)"纪律。
4. **DB CHECK 的键表是枚举英文精确匹配**(14 键),Python 层才是全词表(EN 子串+ZH);CHECK 挡不住中文键或新变体英文键的直接 SQL 写入——它是第二道皮带,不是第一道。第一道(validate_person_dict)覆盖面完整但只护 Python 写路径。
5. **并发 put 同一 context_id**:delete-then-insert 在一个事务里,两个并发 put 会序列化为"后者全胜"(快照一致,无交错混合)——语义可接受但未写并发测试。
6. **`_ensure_schema()` 吞 InsufficientPrivilege**:设计给锁权限的生产角色,但也意味着连错库(权限怪异)时首个 DML 才报错,报错点离根因远一步。
7. **restart 集成测试的 /advise 用 mock 脑**:持久化主张已证,但"重启后真 LLM 引用重物化 facts 行"未在本 feature 真机跑过(@seedgate 全链在,需要时把 AVERY_DB_URL 加进 seed gate env 即可复用)。
8. **Windows 本地验证**:全部证据出自 Windows + Docker;Linux 容器内(ECS 目标)未跑(代码无平台分支,pathlib 全程,风险低但如实记)。

## 9. 独立对抗验证:发现 → 修复 → 复跑(2026-07-13 第二轮)

5 视角真机验证结论:核心成立(持久化扛重启、seam-regression clean、红线在 /ingest 出货路径未破),无 CRITICAL/HIGH,但 6 项真实缺口(全在 feat/030 自有文件,未碰冻结)已按 gate-first 修实。§8 的薄弱点 #3(P2)、#4(P1)、#6(P5)由本轮直接闭合。

| # | 缺口 | repro | 修前 | 修后 |
|---|---|---|---|---|
| **P1** | 存储门只查 key,自由文本打分 + 中文键/复合英文键漏 | 构造 PersonEntity(owns=["ranked 2/10"])→put();raw SQL 插 {"绩效评分":88}/{"zscore":1.4} | free-text 经 put() 落库并被 /team 原样返回;中文/复合键过 SQL CHECK | put() 跑 **validate_extraction 全扫**(value+文本)→ ValueError 拦下;migration 0002 把 CHECK 从 denylist 改 **allowlist**(顶层键 ⊆ 8 个 PersonEntity 字段)→ DB 结构性拒中文/复合键(无词表)。测试:`test_pg_put_refuses_free_text_scoring`、`test_pg_schema_refuses_a_scoring_person_row`(扩 7 恶意 payload + 1 clean-accepted) |
| **P2** | get() 读陈旧 memory_dir(split-brain) | reader 本地 facts.md 早于同 id re-put;get() 只补缺失不校验 | 陈旧本地文件被沿用,loop recall 读到旧真相 | get() **compare-then-write**:本地 != DB 则用 DB 真相覆盖。测试:`test_pg_get_refreshes_stale_memory_dir`(写 "STALE" 后断言被刷回) |
| **P3** | NUL(0x00)崩 put()→裸 500 | material text 含 \x00 | psycopg 抛未处理 DataError → HTTP 500 | parse `_normalize` **剥 NUL+C0 控制符**(留 \n\t);put() 加防御 guard(clean ValueError);ingest_api catch→**422** "upload rejected"。测试:`test_parse_strips_nul_and_c0_control_chars`(离线)+`test_pg_put_rejects_nul_bytes_cleanly` |
| **P4** | 迁移 vector 类型不限定 schema(卡受限角色首建库) | 受限 search_path 角色首次 CREATE `vector(1024)` | 可能解析失败 | 迁移 prepend `SET search_path = avery, public, extensions`(session-local,本地 public / Supabase extensions 两边都解析)。Supabase 已复跑 apply 无误 |
| **P5** | _ensure_schema 吞 InsufficientPrivilege 后盲设 ready | 无 CREATE 权限且 avery 未 provision | 下游冒 confusing UndefinedTable | catch 后先 `SELECT to_regclass('avery.contexts')`,不在则 **re-raise RuntimeError**(可诉的 bootstrap 报错);多迁移文件按序跑,break-on-exists |
| **P6** | Python 存储门无测试(schema-refuse 走 raw SQL 没走 put()) | — | Python gate 非 load-bearing | 新增驱动打分 payload 过 put() 的测试 + schema-refuse 扩中文/复合键 → 两道门都 load-bearing |

复跑三层数字(闭合确认):
- **离线**(无 URL)= **337 passed / 13 skipped / 7 deselected / 1 xfailed**(+1 offline parse 门;+3 新 @needs_db 干净 skip)。
- **@needs_db**(本地 pgvector:pg17):`test_registry_contract.py` = **18 passed**(原 10 + 新 4 + 扩 4 断言);restart 集成 = **1 passed**;离线全套带 URL = **350 passed / 1 xfailed**。
- **Supabase**:migration 0002 apply 成功;entities 约束 = `entities_person_keys_allowlist`(旧 denylist 已 DROP),与本地 `pg_get_constraintdef` byte-identical;行为烟测 7 恶意 payload(含 绩效评分/排名/离职风险/zscore/stack_rank/nine_box)全被 check_violation 拒 + clean 行通过,烟测行清零;public 仍 40 表零触碰。
- **init.sh** exit 0。

修法说明:docstring(pg_registry L20-31)+ 迁移注释已改写与实现相符——SQL = 键 allowlist(结构性,无词表);Python = 全 value/文本扫描;不再过度声称。IDOR(feat-034)保持诚实标注未动(§7.4)。

## 10. commits(本 feature,时序)

- `d33c4e5` test(feat-030): persistence gates first, born red
- `cbd6a4d` feat(030): Postgres persistence behind the ContextRegistry seam — gates green
- `869aae5` docs(feat-030): ADR-0023 + feature_list entry + session handoff
- `fe977e8` test(feat-030): adversarial-gap gates, born red (P1/P2/P3/P6)
- `6a56ba6` fix(feat-030): close 6 adversarial-validation gaps — gates green
- (收盘 commit:handoff §9 追加,见 git log)
