# Avery lite v1 — 会话收盘 + 产品方向(交接给下个 AFK session)

> **本文件 = 上一轮(2026-07-09→07-13)干了什么 + grill 出的产品方向。** 下个 session 据此**一路调研→设计→开发,Danny AFK**。
> 单一事实源配套:`.issues/live-polish-0709/pre-ecs-readiness-open-loop.md`(权威就绪册)+ 根 `session-handoff.md` + `docs/deploy/dual-deploy-runbook.md`。
> 日期:2026-07-13 · 当前分支:`main`(`34cfaf9`,全链已 merge 进本地 main,ahead origin/main 16,**未 push**——push=对外闸,留 Danny)。

---

## 0 · 一句话现状

上一轮把 Avery lite **从"打磨过的 demo"往"能上 ECS 的准真产品"推**,并在结尾 grill 清了**产品定位**。三波硬化已落地并对抗验证(全 CONFIRMED_SAFE),全链已 merge 本地 main、未 push。**下一步 = 按下面 §3 的产品方向,搭持久化(Supabase)→做实 agent 基本功→基本抗压→真上 ECS→端到端/压测。**

---

## 1 · 本轮做了什么(全部已 merge 本地 main = `34cfaf9`,未 push)

线性分支链(均已并入 main):
`… feat/026-vision-surface → feat/027-parallel-ingest(9b9787e)→ feat/028-demo-harden-1(6d1f46e)→ feat/029-redline-zh(d0913bd…ddf69f3)`

- **就绪审计(只读)**:17-agent open-loop 盲点扫描 + 部署审计 → `.issues/live-polish-0709/pre-ecs-readiness-open-loop.md`。去重后 ~25 项 pre-ECS 阻塞,分 blocks-demo / blocks-real-company / post-launch。**下个 session 必读**。
- **feat/027-parallel-ingest**:`extract_docs` 加有界并发线程池(`AVERY_INGEST_CONCURRENCY` 默认 4),真机 6 文件 **52s→14s(~3.7×)**、人数一致。4 路对抗验证 CONFIRMED_SAFE。未做:上传进度 UI。
- **feat/028-demo-harden-1(cluster-1 止血)**:5 个"本地绿、容器崩"的 ship-stopper——① `python-multipart` 进 requirements(否则镜像 `/ingest` 直接 500 而 `/health` 绿);② `/ingest` 移出 event loop(`run_in_threadpool`,否则长上传冻服务→healthcheck 反杀容器→内存全灭);③ `/advise` brain 加超时;④ 未知 `company_context_id` 大声 404(不静默回落 demo 记忆引用假同事);⑤ runbook CORS 纠错 + TLS 提示。对抗验证 CONFIRMED_SAFE。
- **feat/029-redline-zh(红线中文覆盖)**:英文-only 红线是洞(境内 M3 面对中文公司)。四层补中文 + Trad→Simp 归一化 + "人 vs 工作"抑制 + 数字收紧 + 判决标签/否定转折感知。**5 轮 impl↔对抗验证(真机执行 crafted 输入)** 收敛:每轮验证都真抓到绕过/误伤(**自评不可信**),终态 329 passed / 冻结 OK / **英文逐字节没动**;残留仅刁钻/exotic(自相矛盾"不被打分…打了2分"、内部空格 xfail)→ 011c 跨族 LLM 判官兜底。
- **agent 升级核查(vs 4 篇参考文档)**:Schroeder(领域专精:extractor/advisor 分离)+ Isadora(确定性红线否决 + 结构性不可改身份)**真落进代码**,非 Vision 文案;Pocock(skills 手册)/ Steinberger(注意力/工作流)大多"目标用代码门达成、机制未采用"或"讲 dev 环非运行时"。详见就绪册 §1。

---

## 2 · 代码改动面(本轮,均在 `eval-harness/**` 后端 + docs)

| 文件 | 改动 |
|---|---|
| `avery/ingest/extract.py` | `extract_docs` 有界并发线程池 + 保序合并(feat/027);`FORBIDDEN_PERSON_KEYS_ZH`(feat/029) |
| `avery/ingest/redline_extract.py` | `_SCORE_WORD_NEAR_NUM` EN/ZH 分支 + 数字收紧 + 工作抑制(feat/029) |
| `avery/redline.py` | 运行时门中文覆盖:`zh_normalize`(Trad→Simp)/ `_zh_about_work` / `_zh_has_target` / `_ZH_*` 词表(feat/029) |
| `avery/ingest/llm_extract.py` | `_SYSTEM` 双语(feat/029) |
| `service/ingest_api.py` | `run_in_threadpool` 卸载 `make_extractor`+`ingest_paths`(feat/028) |
| `service/app.py` | 未知 context_id → 404(feat/028) |
| `service/brain_factory.py` | advise brain 超时 `AVERY_ADVISE_TIMEOUT_S`(feat/028) |
| `requirements.txt` | `python-multipart`(feat/028) |
| `docs/deploy/dual-deploy-runbook.md` · `service/.env.example` | CORS 纠错 + TLS + `AVERY_INGEST_CONCURRENCY`(feat/028) |
| `tests/` | `test_parallel_ingest.py` / `test_redline_zh.py`(121 例)/ `test_requirements_complete.py` / `test_ingest_nonblocking.py` / `test_advise_timeout.py` / `test_advise_context_id.py` |

离线全套(`pytest -m "not seedgate and not smoke"`):**329 passed / 7 deselected / 1 xfailed**。`runner.py --check-frozen` OK(红线冻结集未动)。`src/story/**` 零改;`src/lite/**` 本轮零改(纯后端硬化)。

---

## 3 · grill 出的产品方向(★下个 session 的建造依据,已拍板,不 re-litigate)

### 3.1 Avery lite 到底是什么
- **不是**给融资团队去演示的道具;是融资团队**把链接甩给他们手上的真实公司**,那些公司**自己打开、用自己的真实数据实际玩**。
- 所以**必须是近似真产品**——功能有限,但**得真能跑**:真文件系统、真记忆、真 skills 这些 agent 基本功。
- **目的 = 钓鱼(lead-gen)**:公司玩过觉得"有料"→ 想请 Danny 去聊**给他们公司深度搭 agent + 深度服务合作**。
- **后端(服务器/数据库/用户面)要能基本抗压 + 数据能留住**;**不要**长远完整运维、**不要**堆功能。Danny 开发精力有限。

### 3.2 边界纠正(推翻 07-10 的"受控演示优先")
- ✂️ **"受控演示 + 策展假数据集 + demo-mode reset"作废**——公司用**自己真数据**,不走查演示。就绪册 §0.5 的 demo-first 分层**已过时**,以本节为准。
- ✂️ **"接 agent 展示分析"这类 showcase 打磨 = story 面的活**,lite 只管当真能用的产品。story/lite 墙照旧不打洞。
- ✂️ **完整"agent 自己的文件空间" = 继续留 Vision mock 当钩子**(不在 lite v1 建);它反而让钓鱼故事更强("这就是跟我合作才给你搭的")。

### 3.3 v1 要建什么(按依赖顺序;一切骑在持久化上)
1. **持久化:Supabase(Postgres + pgvector)接现有 Python FastAPI 后端** ★DECIDED。替掉内存 `REGISTRY`(`registry.py` 的进程内 dict)。公司数据 + 记忆 + RAG 重启后还在。**不上 Java Spring**(那等于把已跑通、带红线闸的引擎推倒重写,浪费有限精力)。
2. **真记忆 + 真 RAG**:pgvector 做实检索(现在 `store.py` 是 keyword 占位、`app.py:129` embedder=None);`facts.md`/`notes.md` 记忆落 DB 持久化。
3. **agent 基本功做真**:持久记忆(来自①②)、真 RAG、skills(已有基础)、**每家公司自己的文件空间**(上传文档持久留存、agent 可引用、用户可回看)= 租户级文件/记忆空间。
4. **"Avery 的笔记"(agent 写侧、可见记忆)** ★Danny 批准的便宜中间选项:agent 把**它自己对这家公司的观察**追加进一份**用户看得见、跨会话累积**的笔记(区别于现在只读、从文档抽取的记忆)。**它照走红线**——agent 自写的观察一样不许给人打分/画像(红线门管所有输出)。这是 v1 一个"活的 agent"小触点。
5. **基本租户隔离**:A 公司永不看到 B 公司数据(基础隔离即可,**不做**完整重登录/auth 系统)。就绪册标为 critical 的 IDOR,在 v1 用"基础隔离"档位解(不是 full auth)。
6. **基本抗压**:上传硬门(size/count/type 上限 + 限流 + LLM 花费闸,即原 wave-3)+ 基本并发。容器止血已做一半(不阻塞/超时)。
7. **真上 ECS + Vercel**:Python 后端容器上 ECS(单/最小规模 task),前端静态上 Vercel。主要卡在 **Danny 的账号/密钥墙**(host、真 key、DNS、Vercel 连接 + `VITE_AVERY_API_BASE`),见 runbook §F。
8. **端到端 + 基本压力测试**收尾验证(非穷尽运维级)。

### 3.4 部署方向(grill 定论)
- **ECS = 后端容器(Python)· Vercel = 前端静态 · Vercel≠后端**(有状态 REGISTRY + 分钟级长任务 + SSE,不适合 serverless)。
- **数据库 = Supabase(Postgres + pgvector)**,托管、贴合 Python 后端、pgvector 一步到位真 RAG。
- **抗压=基本档**(扛住真实公司零星并发 + 上传硬门 + 花费闸),**不要**长远完整运维/监控/DR/合规大工程。
- 部署线 feat-018 已建好未部署:`eval-harness/Dockerfile` + `vercel.json` + `docs/deploy/dual-deploy-runbook.md`(注:runbook 里 demo-first/演示相关段以本文件 §3.2 为准更新)。

---

## 4 · 架构接缝(下个 session 动手前必读,少踩坑)

- **要替换**:`avery/ingest/registry.py` 的 `ContextRegistry`(进程内 `dict` + 单例 `REGISTRY`)、`materialize_memory`(现写 OS temp)。这是持久化的落点;`get/put` 接口保持,后面换 Supabase-backed 实现即可(feat-018 注释已预留"DB-backed registry plugs in behind the same get/put")。
- **要做实**:`avery/ingest/store.py`(`KeywordStore`/`VectorStore` + `Embedder` 接缝;`persistence="pgvector"` 现在只是字符串标签,**无 psycopg/pgvector 实现、requirements 无 DB 驱动**)。`service/embedding_factory.py`(DashScope embedder 已有,`app.py` 现传 embedder=None → keyword)。
- **不要动**(红线/引擎):`avery/redline.py`、`avery/ingest/redline_extract.py`、`PersonEntity` 结构、`redline_rules.md`/`FROZEN.lock.json`(冻结)、advisor 引擎(`loop.py`/`engine.py`/`tools.py`)、extractor/advisor 分离结构。红线现覆盖 EN+ZH,**任何新写侧记忆("Avery 的笔记")必须过同一红线门**。
- **前端**:`src/lite/**` 若要加"每公司文件空间 / Avery 的笔记"视图,墙照旧(不 import `src/story/**`,共用走 `src/shared/**`)。中文文案走 M3(`scripts/i18n-zh.mjs`,注意其全量超 M3 token 的既有坑,用定向翻新 key)。
- **门跑法**:后端 `cd eval-harness && AVERY_BRAIN=minimax python -m uvicorn service.app:app --port 8137`;离线套件 `pytest -m "not seedgate and not smoke"`;真机验证另起端口别撞 Danny 的 :8137/:5173。`preview_screenshot` 本环境超时,样式验证走计算值。

---

## 5 · 硬约束(standing,持续生效)
- 🔴 **红线**:人卡/mock 人/agent 自写笔记 **永不**评分/排名/画像/moodPct/capacityPct;三层机制 + 门断言不削弱;**EN+ZH 双覆盖**(feat/029)。
- **story/lite 墙**不打洞(机器 gate);**story 行为/资产冻结**不动。
- **中文走 M3**;**AFK 先斩后奏**,人工闸只留销毁/对外/花钱/凭据(push=对外=留 Danny)。
- **任何 lite 表面 done 判定必须含集成层证据**(agent 当第一个用户,真机跑通,非单元自考自答)。
- **红线/持久化改动收盘必经独立对抗验证**(真机执行 crafted 输入,别信自评)。

---

## 6 · 待 Danny 输入 / 悬而未决
- **账号/凭据墙**(他本人):ECS host provision、真 LLM key 进 secret store、域名/DNS、Vercel 连接 + `VITE_AVERY_API_BASE`、Supabase 项目 + `PGVECTOR_URL`/连接串。见 runbook §F。
- **push 授权**:本地 main ahead origin 16,未 push(对外闸)。
- **"Avery 的笔记"露出 UX**:在 lite 哪个屏、以什么形态给用户看(可由下个 session 出设计给 Danny 抽查)。
- **PII/合规底线**:真实公司传真实员工数据 → 至少一个基础的"数据如何处理"说明/同意点(轻量,不做完整 DPA/ToS 大工程)——需 Danny 拍口径。
- **旧账**(非本轮阻塞):i18n 脚本差量化 + 全量 ZH 重译、feat-019 酒店包(Playbooks 第一个真 pack)、tm2 promote、真人 eval 评分、合伙人 IP 授权。

---

## 7 · 指针
- 就绪册(必读):`.issues/live-polish-0709/pre-ecs-readiness-open-loop.md`
- 部署 runbook:`docs/deploy/dual-deploy-runbook.md` + `eval-harness/Dockerfile` + `vercel.json`
- 根收盘:`session-handoff.md`(07-09/07-10 追加块)
- 编排形态(可复用):main 只编排 → 每 feature 起 AFK 实现子代理(gate-first)→ 完工起独立对抗验证 workflow(真机执行)→ clean 才推进;子代理撞 session limit 用 SendMessage 恢复或新子代理承接 WIP(工作树改动不丢)。
