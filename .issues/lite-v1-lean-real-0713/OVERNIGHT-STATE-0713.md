# 过夜状态 + 续跑指南(2026-07-13 夜起，Danny 睡觉，AFK 自主续跑)

> 目的：compact / 换 session 后靠本文件 + git + 各 feature handoff 就能原样接上。**全链 030–041 已完成**（2026-07-14）；链尾分支 `feat/041-e2e-broadcast`。**不 push（对外闸=Danny）。**

## ✅ 全链完成（2026-07-14 更新）

**feat-030 → 041 全部 clean，链尾 feat/041 端到端 + 基本压测 + 广播已落盘。** 三层证据：离线 474 passed（无 DB 无 key）· @needs_db 41 passed（真 PG，含 e2e 1 + 压测 3）· `./init.sh` 绿。广播落 `.issues/lite-v1-lean-real-0713/broadcast-to-ask-line.md`（供 Danny 转发 feat-034 Ask 卡线）。剩下的全是 Danny 醒来的第二波 HITL（凭据墙 + push + 真机试玩，见文末）。

## 链条状态（本地 main = 2bda603，本线未 merge 未 push）

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
- **push 授权**（对外闸）。是否要 Avery 独立 Supabase 项目（现共用 ImaRead 生产）。是否解禁 advise 答案 overtly 报分（要动冻结引擎）。
