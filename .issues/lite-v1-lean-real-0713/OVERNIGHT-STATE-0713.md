# 过夜状态 + 续跑指南(2026-07-13 夜起，Danny 睡觉，AFK 自主续跑)

> 目的：compact / 换 session 后靠本文件 + git + 各 feature handoff 就能原样接上。**全链 030–041 已完成**（2026-07-14）；链尾分支 `feat/041-e2e-broadcast`。**不 push（对外闸=Danny）。**

## ✅ 全链完成（2026-07-14 更新）

**feat-030 → 041 全部 clean，链尾 feat/041 端到端 + 基本压测 + 广播已落盘。** 三层证据：离线 474 passed（无 DB 无 key）· @needs_db 41 passed（真 PG，含 e2e 1 + 压测 3）· `./init.sh` 绿。广播落 `.issues/lite-v1-lean-real-0713/broadcast-to-ask-line.md`（供 Danny 转发 feat-034 Ask 卡线）。剩下的全是 Danny 醒来的第二波 HITL（凭据墙 + push + 真机试玩，见文末）。

## 链条状态（✅ 已并入 main：integrate `cb11a2c` + 报告 `integrate/041-into-main` 6bf6b0e；main tip 8452032=Ask 卡线阶段 C 骑其上；main 仅本地、领先 origin **64** 未 push；feat/041 为已归档链尾）

| feat | 内容 | 状态 | tip commit |
|---|---|---|---|
| 030 | Supabase 持久化(替内存 REGISTRY) | ✅ clean，独立对抗验证过 | 已在链上 |
| 031 | 真 pgvector RAG(修召回缺口，4 次绿) | ✅ clean | 已在链上 |
| 032 | 每公司文件空间(+修 HIGH 重名丢失) | ✅ clean | 已在链上 |
| 033 | Avery 笔记 + **红线政策转向** | ✅ clean | dbf888a |
| **038** | 基础租户隔离(owner_token) | ✅ clean | a39d2c3 |
| 039 | 上传硬门 + 限流 + LLM 花费闸 + **内存哨兵** | ✅ clean | 0bd1257 |
| 040 | 部署预备(ECS 内存帽/哨兵 + Vercel)；真部署=Danny 凭据 | ✅ clean | 6d0f1e5 |
| 041 | 端到端 + 基本压测 + **广播回 feat-034 线** | ✅ clean（收尾环） | feat/041-e2e-broadcast |

## ✅ 07-14 真 key + 真 Supabase 复核（Danny 清了凭据路径后补做）

- **真 key 质量闸 `@seedgate` 6/6 PASS**（真 uvicorn + MiniMax 抽取 + DashScope 召回，425s）：20 人花名册→≥15 人（含 Lin Qing/Design Director、Chen Mingyuan/Founder-CEO）、无表头假人、PDF→≥2 真项目非文件名、人卡红线守住、无 mojibake，**且 `/advise "谁管设计"` 引用证据真出现 Lin Qing 那行**——即 **07-07 一直 held-open 的召回 flaky 现真 key 下绿**。uvicorn 日志零 fallback/降级。LLM key 本就在 `eval-harness/.env`（DeepSeek/MiniMax/DashScope），无需新配。
- **真 Supabase `avery` schema 只读复核**（项目 `nunsbijtntreynoyeilp`，只碰 avery、没写、没动 imaread public）：6 表全在（contexts/entities/materials/memory_files/source_documents/company_notes）、0 行未污染、迁移 0001–0006 已落。
- **⚠ Supabase 顾问报 avery 6 表 RLS 关**。**核实=非当下真暴露**：anon/authenticated 对 avery schema 无 USAGE、对 avery.* 零 GRANT、authenticator 无 `pgrst.db_schemas` 覆盖（PostgREST 只暴露 public，avery 未暴露）→ 公开 anon key 够不到。Avery 隔离靠应用层 owner_token（feat-038），后端 service_role/直连串绕过 RLS。**防御纵深建议（Danny 定，DDL 动共享生产=不自动执行）**：`ALTER TABLE avery.<t> ENABLE ROW LEVEL SECURITY;`（6 表，不加 policy=对 anon/authenticated deny-all，service_role/owner 仍通，后端零影响）——共享项目里防"日后误开放 schema/误授 anon"。
- **真缺的一个值**：`AVERY_DB_URL`（`postgresql://` 连接串，带 DB 密码）。本地验证不需要（本地 pg 同 schema 已绿）；**只在部署时往 ECS 容器 env 粘一行**。
- ✅ **现用生产库 = `avery-fra`（`zlxpldzapyoacmgvlqpn`，eu-central-1 法兰克福）**，07-17 建 + 迁移 0001–0006 全 apply + 只读核对通过（6 表 + owner_token + allowlist CHECK + vector(1024) + HNSW + pgvector 0.8.2，0 行）。⚠️ **07-14 的新加坡库 `wvgmphgnvapacyyjmsew` 已被 Danny 删除，旧记录作废**。**迁库理由**：演示机 = **德国法兰克福**轻量服务器 `8.211.28.11`（见 `D:\Boyle\agent-os\infra-brief.md`），实测 DB RTT 新加坡 **221ms** → 法兰克福 **~15ms（15 倍）**；DB 是最话痨路径，**库跟着服务器走**。⏳ **待 Danny**：新库密码（`create_project` 不收密码、自动生成无人见过）→ 后台 `avery-fra` → Connect → Session pooler → **Reset password**（建议纯字母数字，免 `%2F` 编码）→ 给我整串即可拼 `AVERY_DB_URL` 并部署。
- ✅ **部署连库形态已实测打通（07-14 晚）**：Supabase 新项目**直连域名 `db.<ref>.supabase.co` IPv6-only / IPv4 解析不出** → 国内 ECS 连不上，**必须用 session pooler**：`aws-0-ap-southeast-1.pooler.supabase.com:5432`，user `postgres.<ref>`（aws-1 报 tenant ENOTFOUND）。**两个部署必带参数（缺则生产连不上且假报 "password authentication failed"）**：① **`channel_binding=disable`**（psycopg3 默认协商 SCRAM-PLUS，Supavisor 协商不下来 → libpq 误报密码错；这是真病根，密码本身没问题）② URI 里密码特殊字符 percent-encode（`/`→`%2F`）。`AVERY_DB_URL` 结尾 `?sslmode=require&channel_binding=disable`；后端 `pg_registry.py:107`/`store.py:228` 直接 `psycopg.connect(url)`，参数自动生效=**零代码改动**。已用生产同款 URI 端到端验证：连接+读+写+pgvector 余弦全绿，新库仍 0 行。密码=凭据墙，不落任何 tracked 文件/记忆。

## 🔴 最重要的一件事：红线政策转向（Danny 2026-07-13 拍板）

**Danny 推翻了"人永不打分/排名/画像"红线**——业绩/情绪评分"不可避免"。执行：**先只解禁不建功能 + 留代码改开关不拆机制不动冻结、先收尾当前链**。落地 = feat/033 的开关 `AVERY_ALLOW_PERSON_SCORING`（`avery/scoring_policy.py`）：
- **默认关** = 现护城河行为（打分被拦，离线套件全绿）。**开** = 放行**上传抽取(pipeline)+ 笔记写侧(notes/registry)**（都非冻结层）。
- 冻结 redline.py/redline_extract.py/engine.py/PersonEntity/FROZEN.lock.json **回基线不动**（hash bb59a7db，byte-identical）。人卡仍定性（不建功能）。**部署(040)时把开关设开**，真公司拿解禁版。
- advise 答案里 overtly 报分**未解禁**（要动冻结引擎，Danny 说先留着）。详见记忆 `redline-reversed-scoring-unblocked` + `.issues/feat-033-avery-notes/session-handoff.md` 的 Policy pivot 段。

## 编排纪律（照此续跑）

- 每 feature：起 impl 子代理(gate-first)→ 完工起**独立对抗验证 workflow**（真机 crafted 输入，别信自评）→ 我独立复打关键点 → clean 才推进；抓到真洞回 fix 子代理修再复验。
- 子代理 transcript 常被回收，用**新子代理承接**（任务自足、kickoff 落盘）。子代理卡死→`git reset --hard <last-good>` 清半成品再重来。
- **不 push**。别动未追踪协调者文件（各 kickoff、UX/data-handling 稿）。
- 编号：「Ask 卡」线占了 feat-034，本线租户隔离=**feat-038**，顺延 039/040/041（避 feature_list ID 撞车）。

## 环境（续跑必备）

- 本地 PG（@needs_db）：`postgresql://postgres:avery_local_dev@127.0.0.1:5433/postgres`（容器 avery-pg，pgvector）。
- 离线自证：`cd eval-harness && DASHSCOPE_API_KEY="" MINIMAX_API_KEY="" python -m pytest -m "not seedgate and not smoke and not needs_keys" -q`（feat/033 后 = 420 passed）。@needs_db：设 AVERY_DB_URL 后 `-m needs_db`（= 33）。
- Supabase：项目 `nunsbijtntreynoyeilp`（**共享 imaread 生产**，只碰 `avery` schema，DDL 只增不改，读用只读 MCP）。迁移已到 0006（+feat/038 可能 0007）。
- Docker 起着；.env 有 MiniMax/DeepSeek/DashScope key；真机验证别占 :8137/:5173。

## 来自「Ask 卡」线的广播（要办的）

- main 动了(3a9cf5c，ahead origin 33)。合流：他们没碰 eval-harness/**；**我们碰了 src/lite/**（feat 032/033 加了 tab）→ 合并时 src/lite 有冲突要理**；feature_list.json trivial 冲突。
- UI 变化：mode 开关默认隐藏（`?modeSwitch=1` 才显示，shared/mode.ts）——我们的前端 gate 若断言 topbar 要留意。
- **基建（影响 039/040）**：单一事实源 `D:\Boyle\agent-os\infra-brief.md`。备案域名+可 SSH ECS 已在手；但 **ECS 是唯一生产机（2C/3.5G 还跑着 ImaRead 全线，剩 ~540M 无 swap）**→ 后端必须 **docker 内存帽 + 低并发 + 上传硬门 + 内存哨兵**（Danny 拍 Q12：不预升配，装哨兵 OOMKilled/高水位→主动冒泡"该升配了"）。
- 礼物：`scripts/i18n-zh.mjs` 那条线加了定向 section 翻译——我们手写的 ZH（feat 032/033）合并后可正经走 M3 补。别动 `.issues/ask-card-0713/**`（他们所有权）。
- ~~**feat/041 收尾要给该线发一条广播**（持久化+隔离层就绪、契约对接点），他们阶段 C 才能接。~~ ✅ **已发**：`.issues/lite-v1-lean-real-0713/broadcast-to-ask-line.md`（持久化层就绪 + 隔离契约含 owner_token≠/r/share-token + 红线开关 + 合并注意 src/lite/** + 基建）。

## Danny 醒来的第二波 HITL（我不做/做不了的）

- 真机试玩；抽查点：笔记 UX（`.issues/lite-v1-lean-real-0713/avery-notes-ux-draft.md`）、数据处理口径（`data-handling-copy-draft.md`）、Supabase schema。
- 凭据墙：ECS host/真 key/DNS/Vercel 连接+VITE_AVERY_API_BASE/Supabase 连接串 → 真部署。
- **push 授权**（对外闸）。是否解禁 advise 答案 overtly 报分（要动冻结引擎）。
- ⚠ **07-14 晚 推翻/重议**：原"Avery 不要独立 Supabase 项目、共用 ImaRead `avery` schema"——现倾向**独立、就近的新项目**（新加坡区、Danny 另一账号建）。理由：现有共享项目在**美东 us-east-2**（国内 ECS 直连 ~200–300ms/来回，慢）；独立项目同解 延迟+隔离+RLS 告警+污染顾虑。落地：新库重跑迁移 0001–0006 + 只读核对；Danny 给新项目直连串（新建自设密码）或连 MCP。imaread 从不用直连密码（走 client library/REST），所以"共享项目重置密码"不建议。
- ⚠ **07-14 晚 记下**：**第二台阿里云 ECS 正在路上**，解"唯一生产机 ~150M free"死结；拿到 infra 后第一时间分析+迁移腾空间（Avery 后端很可能落新机、物理隔离 ImaRead）。
- 🤝 **07-14 晚 部署波收束（Ask 线回执确认）**：Ask 阶段 C 已完工并合 main（merge `da94d559`：迁移 `0007_ask.sql` asks/ask_recipients + 双实现契约 + manager 端点 + 员工 H5 SSR + app.py SSE ask-draft 帧；对抗验证抓修 1 BLOCKING 跨租户改绑 + 1 健壮性；**离线 520 passed**、冻结零触碰）。**Ask 后端与本持久化链=同一容器**，阶段 D **并入本线部署波、不单独部**，同等第二台 ECS。**部署时合并事项**：① Ask 补的 `pytest -m needs_db`（ask 契约 pg 双胞胎 + 跨租户 ask 404）本机无凭据没跑过 → 拿到 DB 一起跑；② **Ask 特有部署 env**：`AVERY_PUBLIC_BASE`（/r/ 分享链接绝对根）、`/ask`·`/r` 限流阈值、生产域名 **OG 三平台 unfurl 验证**。第二台 ECS 到位后**由本线 runbook 主导、Ask 折入，一次部完**。
- ⏸ **两线均待机**（Danny 07-14 晚）：lite-v1 持久化线 + Ask 卡线**唯一阻塞=第二台 ECS**；DB 侧（新加坡库 + 实测打通的 AVERY_DB_URL 形态）+ 真 key 质量 + 后端代码全就绪。ECS 到位=部署波启动点。
- 📌 连接串澄清：Avery 后端走**直连 Postgres + pgvector**（psycopg，feat-030/031），**不改用 client library/REST**（会重写整层召回+跨国 REST 更慢）。真缺值仍是 `AVERY_DB_URL` 直连串——但改用新项目后，Danny 建库时自设密码即得，无 imaread 纠缠。
- ✅ 广播（Danny 07-14）：给 v02 UIUX 线（feat/036-v02-triage-followups）的集成广播已落 `broadcast-to-uiux-v02-line.md`（后端 HTTP 契约 + owner_token 隔离 + src/lite 集成点 + 红线开关对 UI 的影响 + 三方合流注意）。

## 🚀 2026-07-18 收工:后端已真上线(本 session 终态)

**`https://avery.dannyqian.com`** — 固定域名 + Let's Encrypt 真证书(Caddy 自动签发/续期,HTTP 308 跳 HTTPS)。

- **机器**:轻量应用服务器 `8.211.28.11`(德国法兰克福,2vCPU/2GiB,**合伙人的机器,他的站在 :5108 别碰**)。容器 `avery-agent` `--restart unless-stopped --memory=700m`,只绑 127.0.0.1:8137;Caddy(systemd,开机自启)终止 TLS 反代。**重启后全套自动回来。**
- **库**:Supabase `avery-fra`(`zlxpldzapyoacmgvlqpn`,eu-central-1),与服务器同城 ~15ms。迁移 0001–0007 全在。
- **env**:`AVERY_ALLOW_PERSON_SCORING=1`(政策转向)· 限流 ingest 10/min·advise 30/min · 上传 10MB/10 files · LLM 预算 2000 · `AVERY_TRUSTED_PROXY_HOPS=1`(在 Caddy 后面,不设会全站共用一个限流桶)。
- **实测**:ingest ~100–120s、advise ~120s(**德国机 + 国内 LLM**,DB 反而快)。真 30 人/9 项目、引用真实事实行、跨租户 404、数据扛过重部署、红线 clean(0)。
- **Cloudflare 方案已整体拆除**(临时 trycloudflare 地址作废)。

**两个"只在全新库/全新部署才炸"的雷已修入 main**(0001 的 `CREATE EXTENSION ... WITH SCHEMA public` + Dockerfile `COPY db/`),经 5 视角对抗验证 CLEAN。现在全新部署打全新库可零手工自举。

**广播**:`broadcast-backend-live.md`(给前端/v02 线,含固定域名、契约、护栏、性能实况)。
**下一步(其他 session)**:前端接 `VITE_AVERY_API_BASE=https://avery.dannyqian.com`。
**仍待 Danny**:`git push`(对外闸,main 领先 origin 77)。
