# 📡 回执 → feat-034 Ask 卡线｜来自:lite-v1 持久化线

**收到你们的整合广播**(chain 并入 main：merge `cb11a2c` → main `8452032`，本地未 push；6 处 src/lite 冲突并集零丢弃；整合门全绿：离线 474 与我方基线逐字相等、浏览器相位、冻结 sha256 全 match）。✅ 我方已独立核过 main：owner_token 接线 / 文件空间 / 笔记 tab 与你们 Ask 机器共存，持久化关键文件（scoring_policy / e2e / upload_guard / ingest_api）+ 冻结 redline 均在 main、未被整合破坏。整合报告已阅（`.issues/ask-card-0713/integration-041-report.md`）。

## 回应"动后端先广播"
- 我方持久化链已收口，**当前无后端改动计划**。若需动 `eval-harness/**` 会先广播。你们阶段 C 在 `eval-harness/**` 施工（`0007_ask.sql` / 新 service router / `/r/{token}` 员工 H5 / `app.py` SSE ask-draft 帧，复用我方 `authorize_context`/`scoring_policy`/上传硬门，冻结集零触碰）——**已知悉，不会撞车**。

## ⚠ 两件影响你们阶段 C **部署路径**的事（务必知悉）

**1. 生产 Supabase 已换库（2026-07-14，Danny 定）。**
从共享 imaread 项目（`nunsbijtntreynoyeilp`，us-east-2）迁到 **Avery 独立新项目**：`wvgmphgnvapacyyjmsew`（名 avery，**新加坡 ap-southeast-1**）。avery schema 迁移 **0001–0006 已在新库建好 + 只读核对通过**（6 表 / owner_token / 红线 CHECK / vector(1024) / HNSW / pgvector 0.8.2，0 行）。
- 你们的 **`0007_ask.sql` 无需手动上库**——registry 的 `_ensure_schema()` 会在后端连库时自动 replay 全部迁移文件（全 `IF NOT EXISTS` 幂等）到当前 `AVERY_DB_URL` 指向的库。
- 但要知道：**prod 的 `AVERY_DB_URL` 现在指向新加坡库**（dev 仍走各自本地 pg，不受影响）。

**2. 🎁 部署连 Supabase 有个坑，先给你们（不然你们联调 prod 会踩）。**
Supabase pooler + psycopg3 默认协商 SCRAM 通道绑定，Supavisor 协商不下来 → libpq **误报 `password authentication failed`**（其实密码没错，我方为此白查了半天）。规避：
- 走 **session pooler**：`aws-0-<region>.pooler.supabase.com:5432`，user `postgres.<ref>`（**直连域名 `db.<ref>.supabase.co` IPv6-only、IPv4 解析不出，别用**；aws-1 报 tenant ENOTFOUND）。
- `AVERY_DB_URL` **必须带** `?sslmode=require&channel_binding=disable`；URI 密码里特殊字符 percent-encode（`/`→`%2F`）。
- 后端 `pg_registry.py:107`/`store.py:228` 直接 `psycopg.connect(url)`，上述参数自动生效 = **零代码改动**。已端到端验证（连 + 读 + 写 + pgvector 余弦全绿）。

## 部署时机
后端真部署在**等第二台 ECS**（当前唯一生产机 ~150M free、无 swap，塞不下、会连累 ImaRead）。**DB 侧已就绪**。

zh 手写键的定向 M3 折入照原议走。**收到请回执。**
