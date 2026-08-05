# 成本闸疑点核查回执 · 0805（走查 P2 → 修闸）

**票源**：`D:\Boyle\research\avery\walkthrough-0805\REPORT.md` P2 —— 疑「AVERY_LLM_CALL_BUDGET
只护 advise 链路、不护 extractor 链路，/ingest 是不受预算闸保护的烧钱通道」。

## 一、核查结论：疑点属实，但方向整个反了

| 通道 | 单次真调用量 | 修前 | 修后 |
|---|---|---|---|
| `/ingest` 抽取（LLMExtractor） | 1 次/窗（≤320 行一窗，失败重试也计） | ✅ **一直在闸内**（feat-039 起，`extractor_factory.py` 包 `BudgetedBrain`） | 不变 |
| `/ask` 起草 | 1 次/起草 | ✅ 在闸内（feat-034，`ask_api.py`） | 不变 |
| **`/advise` agentic 循环** | **每轮最多 MAX_ITERS=12 次**（`engine.py` 循环 `brain.respond()`） | ❌ **完全在闸外**——这才是真窟窿 | ✅ `BudgetedBrain` 包住；耗尽先短路（干净 error 事件，brain 都不建）；循环中途耗尽由 engine 兜底转 error |
| **embeddings（DashScope）** | 1 HTTP 批/≤10 条文本；advise 召回 + ingest 语料嵌入 + pg 兜底重嵌全走它 | ❌ 全链路无预算 | ✅ 独立预算 `AVERY_EMBED_CALL_BUDGET`（闸挂在 `DashScopeEmbedder._embed_batch`，谁构造都逃不掉） |

**走查那笔账的真相**：2000→1996 扣掉的 4 格 = **4 次抽取调用**（3 份酒店文档各 1 窗 +
乱码 txt 1 窗——「优雅零抽取」是模型被真调过一次、抽出 0 实体后 heuristic 兜底，钱已花）。
当天 4 次 /advise **一格都没扣**，与 4 恰好同数纯属巧合；走查只有首尾两笔 /health 读数
（api-probes.txt 只有开局 2000），中间没采样，归因是推断不是观测。REPORT.md 第 79 行
「advise 计数器实扣 4/2000」为**错误归因**，已在原报告落对账附注。

**曝险量化（修前）**：`/advise` 免 token 即可打默认 demo context，单请求最多 12 次 M3
调用、每次限时 180s；`AVERY_RATE_ADVISE_PER_MIN` 生产未设（默认关）。它才是比 /ingest
（20/min 限流 + 抽取已在闸内）大一个数量级的 denial-of-wallet 面。

## 二、改了什么（7 文件 + 1 新测试，全离线验证）

- `service/app.py`：`_run_events` 里非 mock brain 包 `BudgetedBrain`；预算已尽直接回
  error 事件（附 hint），不起流不建 brain。`/health` 新增 `embed_calls_remaining`。
- `service/llm_budget.py`：新增独立 embeddings 计数器（`AVERY_EMBED_CALL_BUDGET`，
  默认 0=不限）、`EmbedBudgetExceeded`、`embed_spend_gate`；模块头补「谁在闸内」审计表。
  **不并入 llm_calls**：嵌入一批比一次 M3 chat 便宜约两个数量级，混计会把 Danny 已经在看的
  那个 2000 搞脏。
- `avery/embeddings.py`：注入式 spend gate 座（core 定缝、service 装闸，不反向 import）；
  `DashScopeEmbedder._embed_batch` 发 HTTP 前过闸。离线假 embedder（Hashing）碰不到闸。
- `service/embedding_factory.py`：import 时装闸——连 `registry.active_registry()` 自建的
  embedder（pg 兜底重嵌 + pgvector 查询）也被同一计数器罩住。
- `avery/ingest/pipeline.py` + `avery/ingest/pg_registry.py`：嵌入失败（含闸拒付）降级
  keyword / NULL 向量并告警，**上传永远落地**——顺手修掉了「DashScope 挂了会打死 put()」
  的存量脆弱点。
- `service/.env.example`：两个预算变量的口径写清。
- `tests/test_spend_gate_coverage.py`（新，10 条）：mock 层调用计数钉接线——advise 逐调用
  计费/耗尽零调用短路/mock 免计费；DashScope 逐批计费/耗尽拒付零 HTTP；召回退 keyword、
  ingest 照常落地；/health 双计数器;reset 双清零。

## 三、验证

- 离线全套 **3537 passed / 74 deselected / 4 xfailed**（`-m` 四 deselect 由 pytest.ini
  addopts 兜底，零出网零真钱）。
- **born-red 反证**：临时关掉 app.py 包装 + embeddings 闸 → 新测试 6 红 4 绿，红的恰好是
  六条接线断言；复原后 10/10 绿。测试验的是部件本身，不是自考自答。
- 未跑 `needs_db`（pg_registry 改动是纯增量 try/except，不动 schema/列读写路径）。

## 四、遗留（要 Danny 或下一棒）

1. **生产还没带上本修复**——走查 P0（快问死域）当天已由另一条线单独上产（容器
   `main-20260805-134620`，基于 `4bc6085`，**不含**本修闸），生产 /advise 目前仍在闸外；
   修复已合 main，下次 swap 从 main 重建即带上。
2. 生产 env 建议补 `AVERY_RATE_ADVISE_PER_MIN=30`（限流兜底）与
   `AVERY_EMBED_CALL_BUDGET`（建议 2000 起步，/health 看消耗再调）。
3. 周末 demo 注意：换容器后 /advise 正式进 2000 预算——按走查实测每 advise 轮 1~12 次
   调用，demo 当天余量完全够，但 /health 的 `llm_calls_remaining` 会开始因 advise 下降，
   **别再按「只有抽取扣数」的旧直觉读那个数**。
