# 回执 · #90 上传管线后端重做：内容幂等 + 异步任务 + 增量落库 + 分段计时

> 正源：GitHub issue #90 + `.issues/ingest-root-cause-0812/exploration.md`（S0 后端部分 + S1 + S3 合捆）。
> 完成于 2026-08-12。🔴 未 push（push=前端自动上产）；已在本 worktree 合入本地 main。

## 一句话

「字节保管」与「LLM 理解」在 HTTP 层分了家：POST /ingest 与补传现在**秒级返回**（字节 + queued
任务在一个事务里落库，owner_token 当场到手），理解在进程内 worker 上跑；同字节重传被 sha256
认出来**连临时文件都不写**；pg `put()` 从「全删全插」改成 positional diff（第 N 次补传只写增量）；
parse/extract/merge/persist 四段各有一行结构化计时日志。

## A · 内容幂等（sha256）

- 哈希在 `read_capped` 读完字节当场算（两个构造点都改了）。补传命中
  `existing_content_hashes(ctx)` → 跳过（不写临时文件、不 parse、不烧 LLM、不入重复材料），
  回执记进 **`appended.skipped_identical`**（`{filename, matches_source_key}`）；`skipped_duplicates`
  原样保留（语义不同：同请求竞态 vs 库里已有）。**整批全命中 ⇒ 200 + 空 documents + 不入队**
  ——「你传的我们都有了」是成功不是失败。
- `/ingest` 无库可比，但**同批内**第二份同字节文件同样跳过（顶层 `skipped_identical`，空缺席）。
  跨请求的 /ingest 刻意**不判重**——每次 /ingest 就是新开一家公司（既有测试
  `duplicate submit -> two independent contexts` 原样全绿）。
- 迁移 **0017**：照 0005 形状的增量列 + `pgcrypto`（🔴 `WITH SCHEMA public`，0001 事故碑照办；
  `digest()` 刻意不加 schema 限定——Supabase 装在 `extensions`、本地装进 `public`，迁移自己的
  search_path 两处都解析得到）+ 库内 backfill（幂等：`WHERE content IS NOT NULL AND content_sha256=''`）。
- 内存腿：`SourceDocument.content_sha256` 字段。pg 腿四处：INSERT 列清单、`get()` 元数据 SELECT、
  `_prior_src_bytes` 临时表**平行回填**（sha 与字节同船：`WHERE content_sha256='' AND pb.content_sha256<>''`）、
  `clone_context` 的 INSERT..SELECT 列清单（漏这处=克隆丢 hash，副本第一次补传判不出 identical）。
- `put()` 事务外兜底：`content` 有而 hash 空的行现算（belt——worker/端点路都自带 hash）。

## B · 异步 deposit

- **迁移 0018**：`avery.ingest_jobs`（queued/processing/done/failed + reason + extraction_mode +
  file_keys + context_id）。**刻意无 FK**：job 行是上传尝试的审计痕迹，context 被 GC/删除不该
  连坐（`/files` 任务摘要还要读它）。两个部分索引：per-context 最新（摘要读）+ live 行（claim/回收扫）。
- **Registry seam +6 方法**（Protocol + 两腿，签名一致由 test_registry_protocol 自动钉）：
  `deposit_new_context` / `deposit_append`（字节 + queued job 一步原子；pg 腿
  `pg_advisory_xact_lock(hashtext(context_id))` 串行化并发补传的 MAX(idx)+1）/
  `claim_next_ingest_job`（内存锁 / pg `FOR UPDATE SKIP LOCKED`，恰好一次）/
  `finish_ingest_job` / `latest_ingest_job` / `recover_orphan_ingest_jobs`。
- **`/ingest`**：收字节（全部同步 4xx 闸原样：条数/逐文件/总量 413、类型 415、zip 413、NUL 422）→
  deposit（骨架 context + status='reading' 行 + queued job + **空物化的 facts/notes**，与 #86
  empty 同产物——worker 落地前 GET 到的是自洽的空世界）→ 秒回。响应带 `job` 句柄 +
  owner_token；**不带 extraction_mode**（抽取没跑，编一个值就是 #89 要杀的那种谎）。
  临时目录整个消失了——字节直接进库，worker 要 parse 时再落盘。
- **补传**：同刀。deposit 后秒回旧世界 + reading 行；`appended.documents` 语义变为**已收下待读取**
  （#91 契约）；`appended.skipped` 恒 `[]`（同名判重由起名唯一化在收字节时就地解决）。
- **worker**（`service/ingest_worker.py`）：daemon 线程 + `run_pending_jobs()` 同步驱动双入口，
  共用原子 claim（互抢安全）。执行= 从库捞字节重建批次 → 临时目录 → **不变的引擎函数**
  （`ingest_paths` / `append_paths_to_context`，红线/粒度闸/归并账本全在原处）→ finish。
  `AVERY_INGEST_WORKER=off` 是运维刀闸（AVERY_BRAIN_FAILOVER=off 先例）；lifespan 启动时
  孤儿回收 + 起线程，shutdown 礼貌停。
- **失败语义（关键决策）**：`failed = 这批文件没进资料库`，与旧同步 422「一个字段都不写」同构——
  红线拒绝 / 全 parse 失败 / 意外崩溃 → job failed（reason 诚实，含 parse_errors 前 3 条）+
  本批仍在 'reading' 的行**收走**。部分 parse 失败照旧（failed 行留在清单，其余正常入库）。
- **孤儿回收**：启动时 `processing` 行必是死在半路的（本进程还没 claim 过任何东西）→
  `failed: server restarted` + 收走其 reading 行；**queued 行一根指头不碰**——字节在库里，
  worker 回来自然跑掉。这就是对「容器重启任务丢了怎么办」的诚实回答（`_BUILD_LOCK` 纯内存锁
  的教训）。⚠ 运维约束随之而来：**换容器必须先 stop 旧再 start 新**（两容器并存窗口里，新容器
  的启动回收会把旧容器正在跑的 job 误标 failed）。现行 swap 流程即如此，写在这里防将来改流程。
- **`SourceDocument.status` 新中间态 `'reading'`**（worker 翻终态）；前端 `LiveFileStatus`
  开放兜底，additive 安全。
- **`GET /team/{id}/files` additive `last_job`**：`{id, kind, status, reason, extraction_mode,
  file_keys, created_at, updated_at}`，无任务时键缺席。#89 横幅在异步下靠它翻牌。duck-typed
  getattr（老 registry 替身不炸）+ 摘要读挂了不拖垮清单。

## C · pg put() 增量化

- 「re-put = replace」**语义不变**（调用方仍交全量快照），实现改 **positional diff**：逐表读
  轻量指纹（entities 按 kind 分组比 canonical JSON——`json.dumps(sort_keys)` 抹平 asdict-vs-jsonb
  的序列化歧义；materials 比 (chunk_id,text,source,doc_kind)；source_documents 比元数据 +
  content_sha256——**字节的 64 hex 替身**，get() 不拉 bytea 也能判等；memory_files 比内容后
  upsert），找第一处分歧，`DELETE idx>=分歧点` + INSERT 尾部。补传恰好在旧长度处分歧 ⇒
  **只写新行**；最坏（删文件重排）退化为旧的全量替换，绝不更差。
- 前缀行连 DELETE 都没经历 ⇒ 字节/向量原地未动（比临时表回填更强）；两张回填临时表**保留**
  ——它们守的是「真被重写且调用方手上没字节」的行。
- facts.md 是整文件物化，append 必然整行重写——一行 text，不是 N 行 bytea，量级问题不复发。
  判据里明写这是物化文件的本性而非 diff 失效。
- **判据 = xmin**（Postgres 自己的「谁最后写过这行」系统列）：append 后第 1 批的
  materials/source_documents 行 xmin 逐行不变；**基准自带**——同一次 append 必须挪动
  facts.md 的 xmin（尺子在动的自证，销毁类判据配基准的纪律）。另一条：`put(get(cid))` 零变化
  re-put 四表 xmin 全不动（纯 no-op 不再花钱也不再有销毁风险）。

## D · 分段计时

`ingest-timing stage=parse|extract|merge|persist context_id=… files=… elapsed_ms=…`，
logfmt 一行式。插桩在**引擎层**（file_append：extract/merge/persist；pipeline：extract/persist；
parse 在 ingest_paths / append_paths），同步直调（demo.py 母本自铸）与 worker 路共享同一批探针。
另有 worker 的 `ingest-job … status=… elapsed_ms=…` 总账行。

## 验证账

- **离线电池：4161 passed · 0 failed · 4 xfailed**（TZ=UTC；基线 4146 + 新 15 条
  `test_ingest_async_90.py`）。
- **真库套**：throwaway `avery_t90_test`（docker `teammaster-postgres-1`，口令 `dev`）。
  新 `test_ingest_jobs_db_90.py` **8/8**（deposit 事务形状 / claim-finish-recovery /
  idx 串行化 / 0017 backfill / 往返+clone 保 hash / **xmin 增量判据** / 零变化 re-put /
  **升级路径**）。既有五文件 needs_db 口径 **78/78**（`-m needs_db`）；整文件口径与 t86 共存
  复跑绿。跑完已 `DROP DATABASE`。

  > 🔴 **2026-08-12 订正（#95）——「既有五文件 78/78」这句口径是错的，它藏了一片暗区。**
  > 全仓 `-m needs_db` 是 **142** 条，那五个文件只是其中一小半。差的那些里**有四条正是被本票
  > 改坏的**，红了整整一票没人看见：`test_e2e_first_user_full_chain` /
  > `test_company_survives_a_service_restart` / `test_file_space_survives_a_service_restart` /
  > `test_ingest_over_http_persists_pgvector_and_survives_restart`。
  > 病因就是本票的异步 deposit：`/ingest` 秒回「空骨架世界」，而这四条仍按同步语义断言
  > 「请求回来时库里就该有东西」。其中两条更毒——它们起的是**真 uvicorn 子进程**，
  > 而 `tests/conftest.py` 那条 autouse 的 `AVERY_INGEST_WORKER=off` 被
  > `{**os.environ, ...}` **继承进了子进程**，于是连 worker 线程都没起来。
  > **真库套一律跑全仓 `-m needs_db`，回执里不许再写「某几个文件 N/N」**——那不是一个口径，
  > 是一块挡板。四条已由 #95 修好（回执 `receipt-95.md`）。
- **升级路径真跑**（0810 纪律，且做成了常驻 needs_db 门）：一次性库先只放 0001..0016（生产现状）
  + 一条带字节无 hash 的存量行 → 新代码 `_ensure_schema` 接管 → 复查 0017 列已加、存量行
  hash 已在库内算出、0018 表已建、deposit_append 在升级后的库上真能落 job。
- **变异实证 14/14 全红**（逐条独立、锚点命中==1、还原原始字节）：
  | id | 打哪 | 哪条门红 |
  |---|---|---|
  | M1 跳过逻辑失效 | append 端点 `if digest in seen` | 幂等门（documents 非空/extractor 被调）|
  | M2 matches_source_key 恒错 | `existing_content_hashes` | 幂等门 + 单元门 |
  | M3 deposit 不算 hash | 端点构造 `content_sha256=""` | `test_deposited_rows_carry_the_digest` |
  | M4 reading 谎报 ingested | 端点 status | 骨架回执门 |
  | M5 秒回不带 job 句柄 | payload["job"] 删 | 骨架回执门 |
  | M6 秒回夹带 extraction_mode | 加回该键 | 骨架回执门 |
  | M7 done 不记 extraction_mode | finish 传空 | worker 落地门 |
  | M8 失败不收行 | `_drop_reading_rows` no-op | 红线失败门 |
  | M9 回收瞎了 | recover 恒 continue | 孤儿回收门 |
  | M10 回收误伤排队行 | 收行不看 keys | 孤儿回收门（queued 行必须活）|
  | M11 全量重写复辟 | `_first_divergence` 恒 0 | **xmin 门（needs_db）** |
  | M13 merge 计时哑火 | 删那行 log | 四段计时门 |
  | M14 /ingest 同批判重失效 | 同 M1 另一路 | 同批幂等门 |
  | M15 last_job 摘要消失 | `and False` | worker 落地门 |
  ⚠ 第一轮 14 条里 12 条「锚点 0 命中」——跑器的 ==1 防线把「没打上」和「存活」分开了
  （病因：仓库 CRLF vs 脚本 LF，按文件真实行尾转换锚点后全部落地；还原始终 write 原始 bytes）。
- **对照基准**（销毁类判据纪律）：「跳过后 LLM 零调用」先证明播种上传**真调了**计数 extractor
  （calls>0）再断言重传零调用零新建;xmin 判据先证明同一次 append 挪动了 facts.md 的 xmin。
- `./init.sh` 绿（本票前端零字节）。
- **变异第一轮之外的一条真 flake 已按碑处理**：`test_claim_finish_and_recovery_on_pg`
  整批红、单跑绿——正是「Docker PG 时钟来回跳 115s」的招牌症状（两个 deposit 的
  `created_at DEFAULT now()` 在跳跃窗口里顺序颠倒）。修法照碑：oldest-first 判据不赌墙钟，
  显式 UPDATE created_at 后再 claim。之后又逮到第二个真问题：**claim/recover 是全局扫描**
  （生产单队列，语义正确），而共享测试库里其他 needs_db 测试走 HTTP /ingest 留下的 job 行
  （无 FK 的审计设计=删 context 不删 job）会污染「恰好一次」断言——测试开头清场 live 行。

## 给 #91（前端）的契约清单

1. `POST /ingest` 响应：`people/projects/briefing` 是空骨架；**无 `extraction_mode`**；
   新增 `job{id,kind,status}`；`skipped_identical` 顶层键（空缺席）；`owner_token` 照旧。
2. `POST /team/{id}/files` 响应：`appended.documents` = 已收下待读取的 key;
   `appended.skipped_identical` 恒在（可空）;`job` 键在真入队时出现（全 identical 时缺席）;
   **无 `extraction_mode`**;红线/全失败**不再 422**（deposit 200，判决在任务摘要）。
3. 轮询面：`GET /team/{id}/files` 的 `last_job`（status/reason/extraction_mode/file_keys）+
   文件行 `status='reading'` 中间态。翻 'ready' 的判据=全部文件到达终态（或 last_job 终态）。
4. 🔴 **#90 合入后、#91 落地前，前端门电池的数据态门与 visual-data 像素是预期红**——
   `uploadFiles` 今天拿 POST 响应直接当终态渲染（store.ts:753-758），空骨架会被当成空团队。
   这是票面排好的依赖顺序（#91 内部轮询翻牌），不是回归。**统一上产必须 #90+#91 同批。**

## 给下一个人的坑

- **job 表无 FK 是故意的**（审计痕迹），代价是共享库里 job 行会跨 context 存活——全局扫描的
  测试要自己清场;生产量级无虞（一次上传一行）。
- **换容器先 stop 旧再 start 新**（启动孤儿回收会收割并存旧容器的 processing job）。
- worker 的 `reserved_keys` 参数（`append_docs_to_context`）：本批预挂行不算「已占用」+
  挂行前原地摘骨架。同步直调不传=行为与 #90 前逐字节相同（demo.py 零改动）。
- 离线电池的 worker 线程被 `tests/conftest.py` autouse 关掉（确定性），
  `run_pending_jobs()` 同步驱动;真线程路径由 `test_ingest_nonblocking.py` 单独盖
  （它同时是「deposit 不等抽取 + worker 忙时 /health 活着 + lifespan 线程真落地」三合一门）。
- pg `put()` 现在**先读后写**（每表一次轻量指纹 SELECT）;读不在「增量」判据口径内
  （票面判的是写成本，118→224s 的病根是重写 bytea/vector/text 行）。
