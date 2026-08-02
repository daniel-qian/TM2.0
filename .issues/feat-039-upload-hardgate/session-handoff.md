> 已结案存档（2026-07-14），当前状态以 progress.md / feature_list.json 为准，本文件不再更新。

# feat/039 上传硬门 — session handoff

> impl 子代理在"实现全绿、提交前"卡死(agent-runtime 挂起,非代码 bug);编排者接管:验证行为→提交(`a36cd3c`)→起对抗验证。

## 状态

- 分支 `feat/039-upload-hardgate` @ `a36cd3c`（base feat/038 tip a39d2c3，**未 push**）。
- 离线 **450 passed**（+14 vs feat/038 的 436）。冻结集 bb59a7db 不动、feat-033 开关 + feat-038 隔离未动（git 核过）。
- **对抗验证跑中**（wf 5efa7412）：gate-bypass/OOM/denial-of-wallet/magic-byte/zip-bomb/限流 + 回归/诚实/冻结。clean 才算收口。

## 交付（全非冻结层）

| 组件 | 作用 | env |
|---|---|---|
| `service/upload_guard.py` | ASGI 中间件：每 IP 限流→429；Content-Length 预检 + 流式总量帽→413；每文件帽→413；文件数帽→413；伪装类型→415；zip/解压 bomb→413 | `AVERY_MAX_UPLOAD_BYTES`·`AVERY_MAX_FILES`·`AVERY_RATE_INGEST_PER_MIN/BURST`·`AVERY_RATE_ADVISE_PER_MIN/BURST` |
| `service/llm_budget.py` | per-process LLM 调用天花板→诚实 `extraction_mode=degraded`（默认无限，opt-in） | `AVERY_LLM_CALL_BUDGET` |
| `service/mem_sentinel.py` | RSS 请求钩子（无后台线程），越水位→WARN 日志 + `/health` degraded（默认 inert，opt-in；psutil 不可用优雅跳过） | `AVERY_MEM_WARN_MB` |
| `avery/ingest/guards.py` + `parse.py` | magic-byte 嗅探 + defusedxml + pypdf 页/超时限 | — |
| `service/app.py` `/health` | 露出 `degraded`·`memory`·`llm_calls_remaining`·`extraction_mode` | — |

## 编排者独立复打（提交前，真机 TestClient）

正常小文件→200 · 超大(cap 2000 的 5KB)→413 · 6 文件(cap 3)→413 · 伪装 .exe→422 · 内存哨兵开火 "MEMORY HIGH 59MB — consider upgrading ECS" · /health degraded=true。

## 待办

- 对抗验证结果 → clean 则加 feature_list feat-039 条目 + 标 done；抓到洞回修。
- **容器 `--memory` 帽 + healthcheck 读 degraded** = feat/040（本 feature 只做代码半）。
- 默认值是否够保守(540M 机器)——对抗验证 regression lens 会查"无 env 时是否敞开"。

## 对抗验证 round-2 → 修复（2026-07-14，`cab1084` 之上，gate-first）

核心 RAM/wallet 承诺守住（**无 CRITICAL**：总量帽爆 RAM 前拦、LLM 花费闸真硬顶、bomb/伪装/页帽全拒），但抓 **1 HIGH + 3 LOW**，已全修（全在 feat-039 自有文件，冻结/开关/隔离零改）。离线 **474 passed**（464 +10 新门）、@needs_db **37 passed**、`./init.sh` exit 0。

| # | 级别 | 洞 | 修复 | repro 前 → 后 |
|---|---|---|---|---|
| P1 | **HIGH** | `_client_ip` 取 XFF **第一跳**（最左）做限流 key，但 nginx `$proxy_add_x_forwarded_for` 是 **append** 配方=真实 IP append 在**右**、伪造值在**左**胜出 → rotating XFF 完全绕过限流（540M 单 worker 无界洪水） | 默认信不可伪造的 **TCP peer** `scope['client'][0]`、**完全不看 XFF**；新 env `AVERY_TRUSTED_PROXY_HOPS`（默 0=只信 peer；N=从 XFF **右边**数第 N 跳当真实客户端；XFF 短于 N→回落 peer） | rotating XFF 6/6 **全 200** → **200,200,429,429,429,429** |
| P2 | LOW | 流式 backstop 抛 `_BodyTooLarge` → FastAPI multipart 包成 **400『error parsing the body』**，middleware `except` 成 dead code（RAM 仍受保护，只状态码/telemetry 错） | middleware **自发 413** + 返 `http.disconnect` + 吞 app 后续响应（不再 raise） | chunked/无 CL 超大 → **400** → **413『upload too large』**；RAM 界单测证越帽仅多拉一 chunk |
| P3 | LOW | `/health` `extractor` 报 `llm:<brain>` 且 `degraded=false`，而 LLM 预算已耗尽（实际降级 heuristic） | `/health` 新增 `extraction_mode`（llm/heuristic/degraded）；`extraction_degraded = llm_configured && llm_budget.exhausted()` 时报 degraded 并计入 operator 旗；keyless 部署仍诚实 heuristic | exhausted=true 但 `extractor=llm:minimax degraded=false` 无 mode → `extraction_mode=degraded degraded=true` |
| P4 | doc | `parse._defuse_xml` 注释把 billion-laughs 防护归给 `defuse_stdlib()` patch openpyxl，但 openpyxl **与 python-docx** 装了 lxml 时都走 **lxml**（defuse_stdlib 只 patch stdlib=仅覆盖 lxml-absent 回落腿） | 注释订正如实：真实防护来自 lxml/libxml2 自身（默认不解外部/参数实体+限内部展开）；仍调 defuse_stdlib 覆盖回落腿（廉价+幂等） | bomb 仍被拒，归因订正 |

改动文件（仅 5）：`service/upload_guard.py`（P1+P2）、`service/app.py`（P3 `/health`）、`avery/ingest/parse.py`（P4 注释）、`tests/test_upload_hardgate_http.py`（+6）、`tests/test_hardgate_units.py`（+4）。

### ⚠ `AVERY_TRUSTED_PROXY_HOPS` 语义（部署必读）

= **可信代理跳数** = 从 XFF **右边**数第 N 个 hop 当真实客户端（不是"信任前 N 个"；与 werkzeug ProxyFix `x_for` 一致）。各配置：
- **直连（无代理）**：`HOPS=0`（默认），peer=真实客户端 IP，精确。
- **replace 配方单代理**（`proxy_set_header X-Forwarded-For $remote_addr`）：XFF 仅一跳=真实客户端 → 设 **`HOPS=1`**。（若留默认 0，peer=代理 IP=**全站共一桶**：限流仍生效但过严。）
- **append 配方 N 代理**：设 **`HOPS=N`**，取右数第 N 跳=真实客户端，左侧伪造被忽略。
- HOPS 配得比实际深 → 回落 peer=代理 IP=共桶（安全但过严）。配对是 runbook 责任。

## feat/040 runbook 待办清单（部署硬性 HITL，**非本 feature**）

限流 / LLM 花费闸 **默认关（opt-in）**——**不改默认为开**（会 flake 离线套件单 IP 多上传）。部署必须显式：

- [ ] `AVERY_RATE_INGEST_PER_MIN`（+ `AVERY_RATE_INGEST_BURST`）——否则限流**敞开**。
- [ ] `AVERY_LLM_CALL_BUDGET`——否则花费闸**无限**。
- [ ] **代理 XFF 配对**：优先 replace 配方 `proxy_set_header X-Forwarded-For $remote_addr` + `AVERY_TRUSTED_PROXY_HOPS=1`；若用 append 配方则 `AVERY_TRUSTED_PROXY_HOPS=实际可信代理深度`。**旧文档"acceptable behind a trusted proxy"对 append 配方是错的**（见 P1）。
- [ ] 容器 `--memory` 帽 + healthcheck 读 `/health` `degraded`（+ 可选 `extraction_mode`）。
- [ ] `AVERY_MEM_WARN_MB` 按 540M 机器设（如 ~420MB）。
