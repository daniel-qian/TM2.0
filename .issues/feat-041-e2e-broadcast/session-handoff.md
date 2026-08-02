> 已结案存档（2026-07-14），当前状态以 progress.md / feature_list.json 为准，本文件不再更新。

# feat/041 session-handoff — 端到端 + 基本压测 + 广播（链尾收尾）

> 2026-07-14 AFK,gate-first。分支 `feat/041-e2e-broadcast`（base = feat/040 tip `6d0f1e5`，**未 push**）。这是 lite-v1 lean-real 持久化链的**最后一环 + 第一波自动化端到端**（第二波 HITL = Danny）。

## 交付了什么

三使命全落地，**纯追加两个 @needs_db 测试文件 + 三份文档**，零改任何既有代码。

1. **端到端** `eval-harness/tests/test_e2e_first_user.py` —— 一条贯穿 e2e（`test_e2e_first_user_full_chain`，@needs_db，真 uvicorn 子进程 + 真 PG + mock brain/heuristic/keyword）。
2. **基本压测** `eval-harness/tests/test_e2e_stress.py` —— 3 例（并发存活 / 硬门组合边界+哨兵 / 超频削峰）。
3. **广播** `.issues/lite-v1-lean-real-0713/broadcast-to-ask-line.md` —— 供 Danny 转发 feat-034 Ask 卡线。
4. `feature_list.json` feat-041 条目（done + evidence）。
5. 更新 `.issues/lite-v1-lean-real-0713/OVERNIGHT-STATE-0713.md` 标全链 030–041 完成。

## 三层证据（收盘全绿）

| 层 | 命令 | 结果 |
|---|---|---|
| 离线 | `DASHSCOPE_API_KEY="" MINIMAX_API_KEY="" python -m pytest -m "not seedgate and not smoke and not needs_keys" -q` | **474 passed, 41 skipped, 8 deselected, 1 xfailed**（新 @needs_db 测试离线干净跳过） |
| @needs_db | `AVERY_DB_URL="postgresql://postgres:avery_local_dev@127.0.0.1:5433/postgres" python -m pytest -m needs_db -q` | **41 passed**（108s；含 e2e 1 + 压测 3） |
| init | `./init.sh` | 绿（npm lint + typecheck + build） |

零改证明：`git diff --stat 6d0f1e5 -- . ':(exclude).issues'` = 空；`FROZEN.lock.json` 未动；两个新文件为 untracked 追加。

## e2e 贯穿一条链（每步真机断言，非拼测试）

`test_e2e_first_user_full_chain` 串 **3 个进程 life**（模拟两次重部署），共用一条 DB 状态：

- **life1**（proc1，data-life1）：上传公司 A 真种子（PrismDesign xlsx + LogiPulse pdf）→ 200 + `context_id` + `owner_token`(≥32 char)；`/team` 团队从真文档长出（`source_files` == 两种子、briefing 真计数）；`/files` 清单含 n_chunks>0、xlsx 原字节 `attachment` 可下且 byte-identical；上传公司 B（Studio_Handbook + Team_Roster，人名 Lena Park 等）。→ **HARD KILL**。
- **life2**（proc2，**换 data-life2 = 换机语义**）：A 团队 payload **byte-identical** 存活、文件清单 + xlsx 字节 byte-identical 存活；**隔离** = B token / 无 token / 错 token 读 A 的 5 条读路径 → **15 个 404**，A token 读 B → 404，错 token 404 与未知 id 404 body 同模板（无枚举 oracle）；**真 RAG 双向召回隔离** = advise A 的证据全引 `facts.md:` 行且含 A_FACTS（UI-DAILY 等）**不含** B_PEOPLE（Lena Park 等），advise B 反之含 B 人名 **不含** A 案例号；**笔记累积** = 读到 n_before≥1，再 +2 clean advise → count==n_before+2 且 newest-first；**红线关**（本进程未设开关）= 诱导打分问 advise 干净(redline_passed) 但笔记 count 不变（写侧丢弃）。→ **HARD KILL**。
- **life3**（proc3，`AVERY_ALLOW_PERSON_SCORING=1`，换 data-life3）：A 仍在（持久化）；**同一诱导打分问** → 笔记 count +1、newest note excerpt 含 `score her 2/10`（开关治理**持久 DB 写侧**）。

覆盖 kickoff 使命1 全 8 步：上传→持久化→重启存活→隔离 404→真 RAG 引真事实→笔记累积→红线开关两态→文件空间 n_chunks+字节。

## 压测证据（真触边界，基本档）

`test_e2e_stress.py`（3 例 PASSED，16s）：
- **并发存活**：16-wide pool 并发 8 /ingest + 8 /advise，全 200、无 5xx、进程存活；**并发 health poller** 全程轰 `/health`，全 200 且 **max 延迟 <8s**（feat-028 threadpool 卸载证明 healthcheck 不被长 ingest 拖挂）。
- **硬门组合边界**：tight caps 下并发发 超大(413)/超量(413)/伪装类型(415)/zip-bomb(413)/合法(200)，各中靶、无 5xx；`AVERY_MEM_WARN_MB=1` → `/health` `degraded:true` + `memory.high:true`（仍 200 = 诚实降级非崩）。
- **超频**：一 IP 12 连发对 burst=4 → 出现 429 削峰 + 200 若干、全 ∈{200,429}、无 5xx、进程存活。

## 🔴 纪律遵守

不动冻结/红线开关/隔离/硬门/部署代码；`src/story/**` + `src/lite/**` 零改；门断言不削弱；离线全绿零外网；e2e 走 @needs_db + mock brain 无真 key。未 push。未动未追踪协调者文件（各 kickoff、UX/data-handling 稿、`.issues/ask-card-0713/**`）。

## 自评薄弱点（给对抗验证 / Danny 抽查的靶）

1. **e2e 是否真贯穿一条链**：是——3 进程 life 串起同一 DB 状态，非把既有测试拼一遍。但 **named-team（Lin Qing 等）+ 语义 top-k 是 @seedgate/@needs_keys 的 LLM 档**，本链在 heuristic 下 A 20 行花名册塌成 1 个占位人=预期，故本链诚实**只证 LLM 无关脊柱**（持久化/隔离/RAG 接线/笔记/红线），不冒充证 named-team。
2. **mock brain 下引用/笔记的真实性边界**：证据确为 A/B 各自 `facts.md` 的**真实行**（keyword recall 确定性），双向隔离**有牙**（探针核实：A 证据含 UI-DAILY 不含 Lena Park，反之亦然）。但**引用质量/是否命中"对的行"**仍需 @seedgate 真 key（DashScope 语义召回）验——本链证的是"引 A 自己的、不串 B"，不是"引到最优行"。
3. **压测并发是否真触发**：16-wide pool + 并发 health poller，overlap 真实发生；但属**基本档非穷尽 load**——绝对水位、长稳、真 LLM 延迟下的表现未测（那是运维档，超出 v1 范围）。
4. **gate 红→绿**：feat/041 是整合收尾层、底层 features 已 clean，断言天然绿；牙口靠**每断言映射到具体故障模式**（重启丢数据 / 跨租户 404 泄漏 / RAG 串库 / 红线写侧后门）+ 探针实测判别力，**未做破坏性 red 演示**（不改冻结/隔离代码去红，风险不划算）。

## 下一步（都在 Danny 凭据墙后，非本 session 能做）

- 合流：main ahead（feat-034 线 3a9cf5c）；`src/lite/**` 有冲突要理、`feature_list.json` trivial 冲突（见广播 §4）。
- push 授权（对外闸）。真部署凭据（ECS host / 真 LLM key / DNS / Vercel VITE_AVERY_API_BASE / Supabase 连接串）。
- 真机试玩 + 抽查（笔记 UX、数据处理口径、Supabase schema）。
- @seedgate 真 key 跑一次，验 named-team + 语义召回质量（本链诚实留的口）。
