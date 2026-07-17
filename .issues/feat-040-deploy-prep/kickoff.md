# feat/040 — 部署预备:ECS(内存帽/哨兵接线)+ Vercel(kickoff)

> 权威 spec:`.issues/lite-v1-lean-real-0713/PRD.md`(部署段)· 基建单一事实源 `D:\Boyle\agent-os\infra-brief.md`(实机 SSH 探测,非猜)· 既有部署线 feat-018(`eval-harness/Dockerfile` + `vercel.json` + `docs/deploy/dual-deploy-runbook.md`)。
> 依赖:feat/039 clean。从其 tip 开 `feat/040-deploy-prep`。**本 feature = 预备 + 本地 docker 冒烟;真部署(SSH ECS / nginx vhost / DNS / Vercel 连接 / 真 key)= Danny 凭据墙 + 碰共享生产机,不自动执行。**

## ⚠ 基建现实(决定本 feature 的形态)

- **生产就一台 ECS `120.55.97.151`(2核/3.5G/79G),常驻 ~3.0G、剩 ~150M free、无 swap、盘 64%**,还跑 ImaRead 全线(click-reader:3000、后端:8091、corpus:8090、the-studio:8092、MySQL)+ 宝塔 nginx 1.24 反代(全域名 HTTPS,Let's Encrypt)。
- **Avery 后端塞上去 = 极紧**。Danny Q12:不预升配,装内存哨兵(feat/039 已做代码),高水位主动冒泡"该升配了"。**本 feature 必须把这点说透 + docker `--memory` 帽 + 强制上传硬门/限流,并把"这台机器可能真跑不下、需 Danny 决策(腾内存/升配/独立小实例)"作为显著 HITL 项。**
- DNS 在阿里云(万网),加子域 = A 记录→120.55.97.151 + 宝塔 vhost + 证书。OSS 阿里云同账号(可选对象存储,但文件空间 v1 走 Postgres bytea 已定,不改)。
- 凭据墙(只在 Danny 手里):Supabase 连接串、真 LLM key、push/部署授权。

## 使命(预备,全落 docs/config,不碰生产)

1. **Dockerfile**(`eval-harness/Dockerfile`):确认单 worker(内存 REGISTRY 已被 feat/030 Postgres 替代,但单 worker 仍利于内存/限流令牌桶——沿用);healthcheck 打 `/health`(feat/039 已加 degraded 字段,可选让 healthcheck 认 degraded);EXPOSE;镜像瘦身(内存紧)。
2. **runbook**(`docs/deploy/dual-deploy-runbook.md`)按持久化 + feat/039 + 政策转向更新:
   - **env 清单**:`AVERY_DB_URL`(Supabase)· brain key · `AVERY_MAX_UPLOAD_BYTES`/`AVERY_MAX_FILES`(保守)· **`AVERY_RATE_INGEST_PER_MIN` 必须设**(feat/039 默认关,不设=无限流)· `AVERY_LLM_CALL_BUDGET` 必须设(防烧钱)· `AVERY_MEM_WARN_MB`(设成贴近 docker 帽)· **`AVERY_TRUSTED_PROXY_HOPS=1`**(Avery 在 nginx 后一跳,让 feat/039 修好的限流认对客户端 IP)· `AVERY_CORS_ORIGINS`(生产源)· `AVERY_ALLOW_PERSON_SCORING=1`(**政策转向:真公司拿解禁版**)。
   - **nginx vhost**(宝塔):反代 → Avery 端口;`proxy_set_header X-Forwarded-For` 配成让 Avery 拿到真实客户端 IP(配合 `AVERY_TRUSTED_PROXY_HOPS=1`);TLS(前端 HTTPS→后端必须 HTTPS,宝塔证书);子域建议(如 `avery.ima-read.com` 或独立备案域名——Danny 定)。
   - **docker `--memory` 帽**(内存紧,给个保守值 + 说明哨兵/OOMKilled 会冒泡)。
   - **前端(Vercel)**:`VITE_AVERY_API_BASE=https://<avery 子域>` · `VITE_AVERY_MODE=live` · `VITE_AVERY_LOCALE`。
   - demo-first/演示段按 PRD §3.2 更新(真公司用真数据,非策展假集)。
3. **本地真镜像冒烟**(Danny 机器有 Docker):`docker build` + `docker run`(带最小 env,mock brain 或本地 PG)+ `curl /health`(200,字段全)+ `curl /ingest`(真种子文件,200,不再 python-multipart 500)+ 隔离/硬门几条 curl。**这是自动化的,做;真 ECS 部署不做(凭据墙+共享生产机)。**
4. Vercel 连接/域名/promote = Danny 凭据墙,runbook 列清 checklist 交给他。

## 纪律(standing)

- 🔴 不动冻结/红线开关/隔离/上传硬门代码;src/story/** 零改;门断言不削弱。gate-first(有可测的:Dockerfile 构建成功、镜像 /health+/ingest 冒烟绿、runbook env 清单完整性可脚本核)。commit 到 feat/040-deploy-prep(不 push)。别动未追踪协调者文件 + 别动 `.issues/ask-card-0713/**`(Ask 卡线所有权)。
- **绝不 SSH 到生产 ECS 部署、不改 ImaRead 的 nginx/vhost、不动阿里云 DNS**——那是 Danny 凭据墙 + 碰共享生产机(destructive-risk 对外闸)。只产出 config/runbook + 本地冒烟。
- 收盘:本地 docker 冒烟证据(build+run+curl)+ runbook/Dockerfile/env 更新 + `.issues/feat-040-deploy-prep/session-handoff.md`(含**给 Danny 的部署 checklist + 内存紧的 go/no-go 决策项**)+ feature_list feat-040 条目。

## 给 Danny 的关键决策(收盘丢给他)

- **这台 ECS 只剩 ~150M free,Avery 后端塞不塞得下?** 选项:腾内存 / 升配 / 独立小实例 / 先 mock-brain 轻量跑。哨兵会冒泡但塞爆了会连累 ImaRead。
- Avery 子域(avery.ima-read.com vs 独立备案域名)+ 证书。
- Supabase 连接串进服务器 secret;真 LLM key;Vercel 连接;push 授权。
