# feat/040 部署预备 — session handoff

> 本 feature = **预备 + 本地 docker 冒烟**。真部署(SSH ECS / nginx vhost / 阿里云 DNS / Vercel 连接 /
> 真 key / docker push)= **Danny 凭据墙 + 碰共享生产机**,未自动执行。全落 config/docs + 本地冒烟。

## 状态

- 分支 `feat/040-deploy-prep`（base `feat/039-upload-hardgate` tip **0bd1257**，**未 push**）。
- 本地真镜像冒烟 **GREEN**（Docker 28.5.1 / linux，`scripts/deploy/smoke_docker.sh` exit 0，9 断言全绿）。
- **零 Python 代码改动**：冻结集 / 红线 / feat-033 开关 / feat-038 隔离 / feat-039 上传硬门代码全零改，
  `src/**` 零改。只碰 Dockerfile + requirements + `.env.example` 模板 + docs + 新 shell 脚本 + feature_list。
- 离线 474 passed 基线不受影响（未改 Python）。

## 交付

| 文件 | 改动 |
|---|---|
| `eval-harness/Dockerfile` | 瘦身（装 `requirements-service.txt` 运行时子集，砍 scipy/numpy/pytest）· healthcheck 读 `/health` JSON 断言 `status==ok`（纯 liveness，**与 `degraded` 解耦**）· CMD 改 `exec` 形式（$PORT 展开 + uvicorn 成 PID1 收 SIGTERM）· 单 worker 注释订正（feat-030 Postgres 已取代进程内 REGISTRY；真理由=feat-039 进程内全局态） |
| `eval-harness/requirements-service.txt` 🆕 | 镜像运行时 deps 子集（含惰性 brain/persistence/hardgate/parser） |
| `eval-harness/requirements.txt` | 补 `pypdf` / `openpyxl` / `python-docx`（见下「抓出的缺口」） |
| `eval-harness/service/.env.example` | +§5 feat-039 硬门/限流/花费闸/内存/XFF · +§6 feat-033 `AVERY_ALLOW_PERSON_SCORING` |
| `docs/deploy/dual-deploy-runbook.md` | 顶部 feat-040 旗 · §1 lite-v1 env 表 · §A.1 冒烟脚本 · **§A.4 单台 ECS 现实（内存 go/no-go + 宝塔 nginx vhost + XFF↔HOPS 配对表）** · §E demo-first（真公司真数据）· §F.1/F.2 checklist · §G |
| `scripts/deploy/smoke_docker.sh` 🆕 | 本地真镜像冒烟（可复用，build→run→9 断言→teardown） |
| `feature_list.json` | feat-040 条目 |

## 本地冒烟证据（`scripts/deploy/smoke_docker.sh`）

```
[1] build 成功，瘦身镜像 333MB（pip 清单无 numpy/scipy/pytest）
[2] run --memory=512m -p 18137:8137（loopback、mock brain、curated 硬门 env）
[3] /health 200 全字段:
    {"status":"ok","brain":"mock","live":false,"embeddings":"keyword",
     "extractor":"heuristic","extraction_mode":"heuristic",
     "memory":{"rss_mb":52.3,"warn_mb":2048.0,"high":false,"available":true},
     "llm_calls_remaining":5,"degraded":false}
[4] /ingest 真种子(LogiPulse-Roadmap.pdf + PrismDesign_TeamProfile_EN.xlsx) -> 200
    回传 context_id + owner_token(43chars) + extraction_mode   ← python-multipart+解析器齐,不再 500/422
[5] 隔离(feat-038): 无 token->404 · 错 token->404(无枚举 oracle) · owner token->200
[6] RAM 护栏(feat-039): 250KB 上传->413(总量帽 200000 的 Content-Length 预检,body 落 RAM 前拒)
[7] 伪装类型: %PDF- 头命名 .txt -> 415
[8] 限流: burst 耗尽后 3 连 /ingest -> 429,429,429(日志『rate limit: ingest from 172.17.0.1 -> 429』)
[9] HEALTHCHECK: 另起容器 ~3s 内 State.Health.Status=healthy;MemLimit=536870912(--memory 帽生效)
SMOKE: ALL GREEN
```

### ⚠ 冒烟抓出并修的真部署缺口

`avery/ingest/parse.py` 惰性 import 的 **pypdf / openpyxl / python-docx**（PDF/xlsx/docx 解析器）在 dev
venv 里是**环境装了但 requirements 从未声明**——所以历来**任何 Docker 镜像都缺这三个**，真部署对真 PDF/xlsx
上传必然 **422「no parseable content」**。首轮冒烟 [5] 即坐实（`No module named 'pypdf'/'openpyxl'`）。已补进
`requirements-service.txt` + `requirements.txt`（dev+镜像 lockstep），复跑全绿。离线套件没抓到是因为用真种子的
测试是 `@seedgate`/`@needs_keys`（无凭据时跳过），而 dev 环境恰好装了这三个。

---

## 🧑 给 Danny 的部署 checklist（runbook §F.1 权威版）

单台 ECS 部署路径（凭据墙 / 碰共享生产机 = 你亲自做）：

1. **🚦 GO/NO-GO — ~150M free 决策（见下，最先做）。**
2. **Supabase**：连接串 → 机器 secret store 的 `AVERY_DB_URL`（永不进 git）。
3. 真 `MINIMAX_API_KEY`（brain=minimax）→ secret store。
4. **必设 env**（不设=敞开）：`AVERY_RATE_INGEST_PER_MIN`、`AVERY_LLM_CALL_BUDGET`、
   `AVERY_TRUSTED_PROXY_HOPS=1`、`AVERY_ALLOW_PERSON_SCORING=1`、`AVERY_CORS_ORIGINS`、`AVERY_MEM_WARN_MB`。
5. `docker run` 带**硬 `--memory` 帽**，`-p 127.0.0.1:8137:8137`（只绑 loopback），`--restart unless-stopped`。
6. **宝塔 nginx**：加**新** vhost（**别碰 ImaRead 的 vhost**）→ 反代 `127.0.0.1:8137` + TLS(Let's Encrypt)
   + **REPLACE XFF 配方** `proxy_set_header X-Forwarded-For $remote_addr;` + `client_max_body_size` ≥ 总量帽。
7. **阿里云 云解析**：`A avery.ima-read.com → 120.55.97.151`（或独立备案域名，你的备案决策）。
8. **核对 XFF↔HOPS 配对**（runbook §A.4c）：REPLACE 配方 ⇔ `HOPS=1`。配错=静默绕过 或 过严共桶。
9. `curl https://avery.<domain>/health` → `brain:"minimax", live:true, degraded:false`。
10. **Vercel**：独立项目，Root Directory=repo root（**非 `landing/`**），`VITE_AVERY_API_BASE=https://avery.<domain>`；连接项目；Deployment-Protection 别锁死真公司访问。
11. `git push origin` —— 对外闸，留你。

---

## 🚦 内存 go/no-go 决策项（显著 HITL）

**ECS `120.55.97.151` 仅 ~150M free、无 swap，还跑 ImaRead 全线。** 单 worker FastAPI + psycopg + SDK
空转约 **~150–250MB RSS**（冒烟在 mock/keyless 下测得 `rss_mb≈52`，真 brain + psycopg + live 抽取会
**显著更高**）。塞爆 = **连累 ImaRead**（共享机、无 swap，kernel 会 OOM-kill）。**部署前 Danny 四选一：**

1. **腾内存 / 加 swap** 后在紧帽下跑。
2. **升配 ECS**（Q12 定的『先不升、哨兵冒泡』——如果 (1) 不够，冒泡点就是现在）。
3. **独立小实例**给 Avery（与 ImaRead 隔离最干净）。
4. **keyless/mock 轻量**首跑（heuristic 抽取，RSS 最低）验证机器，再加 key。

内存哨兵（`AVERY_MEM_WARN_MB`）+ `/health` `degraded` 给早警，**但 `--memory` 帽设太高仍会先 OOM 邻居**。
`--memory` 设保守 + `docker stats` 盯。runbook §A.4a 写透。

## 其它 Danny 决策

- Avery 子域：`avery.ima-read.com` vs 独立备案域名 + 证书。
- Supabase 连接串 / 真 LLM key / Vercel 连接 / push 授权（凭据墙原样）。

## 自评薄弱点（对抗验证 / 复核打这里）

1. 冒烟用 mock brain + in-memory registry（无真 DB/真 key）——隔离对 in-memory 已生效，但真 Supabase 持久化腿
   + 真 brain live 抽取的 RSS 峰值未本地测（凭据墙；runbook 标 curl 真服务为上线步）。持久化重启存活由 feat-030
   `@needs_db` 37 passed 覆盖，非本 feature 重测。
2. `--memory=512m` 是冒烟示例值**非生产定值**——真值取决于 go/no-go（~150M free 下 512m 都可能塞不下）。
3. nginx vhost / XFF 配方是**文档配方，未在真 nginx 实测**（不碰生产纪律）；XFF↔HOPS 语义正确性由 feat-039
   `_client_ip` 单测 + 对抗验证（rotating XFF → 200,200,429×4）证，真宝塔 1.24 行为留 Danny 上线核。
4. `requirements-service.txt` 引入**第二 deps 文件 = 维护缝**——注释标 lockstep，但未加自动一致性门,子集漂移靠冒烟
   `/ingest`（漏装运行时依赖会当场 422/500）当行为门兜。
5. 镜像瘦身省的主要是**磁盘/pull**（numpy/scipy 运行时本就不 import，RAM 收益≈0）——runbook 如实标，不夸大。
