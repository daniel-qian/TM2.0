# 回执 — DeepSeek 暂停，境内改单家 MiniMax（2026-08-17 19:03）

> 起因：Danny「deepseek 余额不足，暂时不打算继续充值。现在代码能不能暂时全部走 minimax？」
> 结论先说：**代码零改动**。DeepSeek 从来就是纯 env 驱动的，主脑与主抽取**本来就已经是 MiniMax**。

---

## 1 · 探索结论：DeepSeek 在这套系统里只有一个角色

| 位置 | 主 | 备 | 出处 |
|---|---|---|---|
| `/advise`·`/ask`·表单起草 | minimax | deepseek | `brain_factory.py:137` `_PAIR` |
| `/ingest` 抽取 | minimax | deepseek | `extractor_factory.py:37` `_EXTRACTION_BRAINS` |

两条链都是**「谁有 key 谁进链」算出来的**（`advise_chain()` / `extraction_chain()`），
没有任何一处硬编码「用 deepseek」。所以停用它 = 拿掉 key，不是改代码。

改之前的生产 `/health`（0817 实测）：

```
brain: minimax · extractor: llm:minimax · extraction_chain: ["minimax","deepseek"]
providers.minimax : ok:true , at:2026-08-12T12:25:57Z
providers.deepseek: ok:null , at:null        ← 容器起来 5 天，一次都没被调用过
```

## 2 · 🔴 为什么「留着不拔」比拔掉更糟（本轮最该留下的一条）

余额为 0 的 key 留在 env 里，`/health` 会**继续**报 `extraction_chain:["minimax","deepseek"]`——
看起来热备 armed，实际那条臂每次都 402。这正是 **#89 事故换了张皮**：
当年是「有 key 但从没被问过」，现在是「问了也答不出」。代价有两条：

1. MiniMax 一挂，要多赔一次注定失败的往返才落 heuristic；
2. `/health` 在这期间对着一个假热备撒谎——而 #89 立 `providers` 那张表就是为了不撒谎。

**要停就停干净。**

## 3 · 选了哪个开关，以及为什么不选另一个

| 做法 | 结果 | 取舍 |
|---|---|---|
| ✅ 拿掉 `DEEPSEEK_API_KEY` | 两条链塌成 `["minimax"]` | 本仓口径「『没有』而非『不用』」 |
| ❌ `AVERY_BRAIN_FAILOVER=off` | 同结果 | 它是**全局** kill-switch，也是欧盟线的纪律位（runbook §1.1 要求 EU 箱子必须 `off`）。借它表达「某一家欠费」会让下一个人读到 `off` 时说不清是合规要求还是没钱 |

## 4 · 本机（第一步）

- `eval-harness/.env`：`DEEPSEEK_API_KEY` / `_BASE_URL` / `_MODEL` / `JUDGE_FAMILIES` **注释掉**（不是删，恢复即取消注释）。
- **功能验证**（问代码，不是读文件）：

  ```
  advise_chain    : ['minimax']
  extraction_chain: ['minimax']
  active_extractor: llm:minimax
  ```

- **离线电池：`4434 passed · 0 failed · 4 xfailed`，144.83 s** —— 与 Blockers 基线逐字一致。
  （电池本来就跟真 env 无关：`test_provider_failover_89` / `test_openai_provider_96` 都先
  `monkeypatch.delenv` 再塞假 key。这次跑是为了证明**我没打坏别的**。）

### 4b · 🔴 顺带堵掉一个凭据泄露口

改之前 `cp` 了一份 `eval-harness/.env.bak-predeepseek`（**含三把真 key**），
`git check-ignore` 当场判定**它没有被忽略**，`git status` 已经把它列成待加文件。
已在 `eval-harness/.gitignore` 补 `.env.bak*`。

模式**故意写窄**：`.env*` 会连 `.env.example` 一起吞，而那是要提交的模板
（记忆条 `session-state-files-are-credentials` 的反向坑：凭据闸的通配会静默吞掉你新写的文件）。

⚠ 两件要认的事：
- 这个 `.bak` 文件**在本 session 开始前就存在**（启动时的 `git status` 快照里已有同名文件），
  我的 `cp` 把它覆盖了，覆盖前没看。事后比对：两边变量名集合完全相同（11 个），
  内容都是「改动前的 `.env`」，没有信息丢失——但**这是个流程错误**，覆盖前该先看。
- 文件本身**没删**（属销毁类，归 Danny）。它现在被 gitignore 挡住，泄不进仓库。
  真要清就 `shred -u eval-harness/.env.bak-predeepseek`——DeepSeek key 在 `.env` 里
  以注释形式留着，删了不影响恢复。

## 5 · 生产（第二步）—— 同镜像原地换容器

🔴 **严格限定为 env-only**：不构建、不 push、不碰 #105 那条迁移链。
用的就是生产正在跑的那个镜像 `avery-agent:main-20260812-070519`（= `6b70173`）。
**`/health` 的 `commit` 前后完全相同，这是「没夹带代码」的免费自证。**

| 步骤 | 结果 |
|---|---|
| S0 前置 | `avery` Up 5 days (healthy) · RestartCount=0 · 8138 FREE · 根分区 30 G 可用 |
| S3 提 env | 白名单 30 → 去 DeepSeek 后 **27**；`diff` 确认剔掉的**正好**是 `DEEPSEEK_API_KEY`/`_BASE_URL`/`_MODEL` 三个，其余一个不少（含 SUPABASE_*、DASHSCOPE、demo-seed、四道花钱/限流闸） |
| S3 复核 | `AVERY_BRAIN_FAILOVER` **未设置**（默认 on）—— 确认是靠拔 key 而不是靠 kill-switch |
| S3b 预检 8138 | 2 s 转健康 · `extraction_chain:["minimax"]` ✓ · `/demo/status {"available":true,"ready":true}` ✓ · 日志零 error |
| S4/S5 换容器 | `/tmp/swap3.sh`（带失败自动回滚）· 新容器 **1×2s 转健康** |
| S6 复验（公网） | `https://avery.dannyqian.com/health` → `extraction_chain:["minimax"]` · `providers` 只剩 minimax · `degraded:false` · `commit` 仍 `6b70173` ✓ ·`/demo/status` `available:true,ready:true` ✓ |
| S6 docker | `Up (healthy)` · 启动日志零 error · `ims-webapp` 没碰 |
| S7 收尾 | 本轮三个 `/tmp/avery_env_*` 全部 `shred -u` |

**回滚梯：`avery-prev-20260817-190306`**（旧容器完整保留，env 里带着 DeepSeek）。
回滚 = `docker rm -f avery && docker rename avery-prev-20260817-190306 avery && docker start avery`。

### 5b · 迁移安全性（为什么这次换容器不会动库）

容器启动即重放 `db/migrations/*.sql`（#90 起，runbook-105 §0 ④）。
本轮用的是**与生产完全同一个镜像**，它的迁移集就是库里已经有的那一套 → 重放是幂等空操作。
预检容器 2 s 起来、`/demo/status` 走通 registry（`__contains__` → `_ensure_schema`）、
日志零 error，**这就是 bootstrap 路径当前干净的实证**，比查锁表更硬。
生产库仍落后 main 四条迁移（0017–0020），**本轮一条都没上**——那是 #105 的事。

### 5c · 一个可预期的副作用

`llm_calls_remaining` / `embed_calls_remaining` 从 1965 / 1937 **回到 2000 / 2000**。
`llm_budget` 是**进程内**计数器，换容器必然清零。不是 bug，但读这个数做趋势判断的人要知道
0817 19:03 这里有个断点。

## 6 · 🔴 一条没法「全部走 minimax」的：评测裁判

`eval-harness` 的被测系统（SUT）**本身就是 MiniMax-M3**。`judge.py:63` 的碑明写同家族裁判有
self-preference bias。DeepSeek 一停，`JUDGE_FAMILIES` 里就只剩 minimax = **自己给自己打分**。

所以这一路**没有**改成单家，而是把 `JUDGE_FAMILIES` 整条注释掉：
留空 → 落回 `DEFAULT_JUDGE_FAMILIES`（openai/google）→ 没 key 会**干净报错**，
逼下次真跑评测时做一次有意识的裁判选型。**这是 fail-closed，不是待办。**

不紧急：`eval-harness/runs/` 最新一次是 **7/1**，judge 停摆快 7 周了。

## 7 · 改了哪些文件

| 文件 | 改动 |
|---|---|
| `eval-harness/.env`（untracked） | 4 个变量注释掉 + 说明 |
| `eval-harness/.gitignore` | 补 `.env.bak*`（窄模式，别扩成 `.env*`） |
| `eval-harness/.env.example` | DeepSeek 暂停碑 + 「别改成只剩 minimax 裁判」碑 |
| `eval-harness/service/.env.example` | 暂停碑 + 「别用 FAILOVER=off 表达欠费」碑 |
| `.issues/deploy-0817/runbook-105.md` | S3 判据 30 → **27**（含哨兵说明）；S6 判据③ → `["minimax"]`（并注明 `receipt-105.md` 里的旧值是回执、**不要改**） |
| `docs/deploy/dual-deploy-runbook.md` | 境内列 `DEEPSEEK_API_KEY` → ⏸ 暂停中；新增一节「境内 DeepSeek 暂停」含恢复步骤 |

本轮文档改动已 commit 到 `main`，**未 push**。
push 是**对外闸**：main 上积压着 #105 那整批（含前端），一 push 就触发 Vercel 前端自动上产，
要 Danny 在场（`runbook-105.md` S2）。
⚠ 别在这类文件里写死「领先 origin N 个提交」——每提交一次就自我作废（本回执初稿就写错成 43，
实际当时是 44）。要数就跑 `git rev-list --count origin/main..HEAD`。

## 7b · 🔴 部署缺口声明（clean-state-checklist 第 6 条）

本 session 发生了两件部署：**后端换容器（env-only）** 与 **push ⇒ 前端自动上产**。
两者 SHA **不一致**，必须写明：

| 腿 | 跑的是 | 与 `main`(`eb9dbc1`) 的关系 |
|---|---|---|
| 前端 | **`eb9dbc1`** | ✅ **就是 main** |
| 后端镜像 | **`6b70173`**（`main-20260812-070519`） | 🔴 **落后 main** |
| 生产库 | `6b70173` 那套 schema（12 张表） | 🔴 落后 **四条迁移** |

`git diff 6b70173 main -- eval-harness/{avery,service,db}` = **28 文件 / +3157 / −482**。
**生产后端目前不含**（按影响排序）：

- **#90 异步上传管线**：`service/ingest_worker.py`（+294，整个文件生产没有）、
  `service/ingest_api.py`（437 行改动）、`avery/ingest/registry.py`（430 行改动）。
- **#93 全档案重跑**：`avery/ingest/rejudge.py`（+301，整个文件生产没有）。
- **#97 中文红线诊断词补齐**：`avery/redline.py`（+103）。⚠ 这条是**红线口径**缺口——
  生产的输出闸目前仍是「只有英文认得人身标签」那一版。
- **#104 开机锁修复**：`db/migrations/0002_*.sql` 不再每次开机抢 `entities` 的 ACCESS EXCLUSIVE。
- **#96 OpenAI provider**：`brain_factory.py` / `extractor_factory.py`（境内不用，但代码没上）。
- **四条迁移未上**：`0017_source_documents_content_sha256` / `0018_ingest_jobs` /
  `0019_enable_rls` / `0020_account_contexts_multi_member`（另 `0002`/`0010` 有修改）。

**重拉基线的时间点：下一个 session 的头等事**——把 `runbook-105.md` 的 S1、S3–S7 做完
（S2 push 已完成，跳过）。runbook §1 原本靠「先构建、push 完立刻换容器」把这个错配窗口
关掉；**push 已经发生，窗口现在开着。**

⚠ 兼容性的诚实说法：runbook §1 读源码论证过「新前端 + 老后端」兼容
（`src/lite2/store.ts:882` 是 `if (payload.job)` 分支，老后端不返回 `job` 就回落同步路），
但 0817 晚**没有真跑验证**：只验了页面加载干净 + 21 个控件在场 + 示例团队入口在，
**没点示例团队、没试上传**（两者都会往生产库真写数据，0720 的教训）。
所以**上传那条路在真实错配下顺不顺，仍是未验**，别当成绿的。

## 8 · 恢复 DeepSeek 怎么做

1. 充值。
2. 生产：env 加回三个 `DEEPSEEK_*`，用同镜像换容器（本文件 §5 就是脚本）。
3. 本机：`eval-harness/.env` 取消那 4 行注释。
4. 把 `runbook-105.md`（27→30、判据③）、两份 `.env.example`、`dual-deploy-runbook.md`
   的期望值一起改回去。
5. 判据：`/health` 的 `extraction_chain` 回到 `["minimax","deepseek"]`。
