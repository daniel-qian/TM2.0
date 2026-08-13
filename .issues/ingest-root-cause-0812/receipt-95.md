# 回执 · #95 异步 deposit 的收尾欠账：四条 needs_db 红 + 那片让它们藏了一整票的暗区

> 起因：#93 收尾时把真库套从「挑五个文件」改成全仓 `-b needs_db` 口径，当场扫出**四条自 #90
> 合入起就一直红**的测试。2026-08-12。改动全在 `eval-harness/tests/` + 一份回执订正，
> **零生产代码**、前端零字节、**未 push**。

## 0 · 一句话

四条红**全部是测试还按 #90 之前的同步语义断言**，没有一条是产品回归——`/ingest` 秒回
「空骨架世界」是端点 docstring 白纸黑字写下的设计。但**病不在那四条测试**，在于
**#90 落地时的验证口径是「既有五文件 78/78」**，而全仓是 142 条：那句口径本身就是一块挡板，
红了一整票没人看见。所以本票除了修四条，还补了一道**防同类暗区复发的静态门**，
并就地订正了 #90 回执里那句口径。

## 1 · 四条红，逐条判「测试该改」还是「产品真回归」

| 测试 | 症状 | 判定 | 依据 |
|---|---|---|---|
| `test_e2e_first_user_full_chain` | `assert set(a["source_files"]) == {...}` 得空集 | **测试该改** | `/ingest` 端点 docstring 明写「`people`/`projects`/`briefing` 是 EMPTY 骨架世界」——`source_files` 同族，它是抽取的产物 |
| `test_company_survives_a_service_restart` | 同上 | **测试该改** | 同上 |
| `test_file_space_survives_a_service_restart` | `sum(n_chunks) > 0` 得 0 | **测试该改** | `n_chunks` 是材料块数，抽取跑完才有 |
| `test_ingest_over_http_persists_pgvector_and_survives_restart` | `0/0 materials` | **测试该改** | 嵌入随抽取跑在 worker 上 |

**没有一条是产品回归。** 判据不是「看着像」：`/ingest` 的 docstring 把这三条后果逐条列成了
「a caller must know」的契约（无 `extraction_mode`、红线不再是 422、people/projects 是空骨架），
四条红全部落在那张清单之内。

## 2 · 两种病灶，两种修法（**第二种是真正难看的那个**）

### ① 进程内（TestClient）——忘了驱动队列
`tests/conftest.py` 有一条 autouse fixture 把 `AVERY_INGEST_WORKER` 设成 `off`（#90 为了离线
电池的确定性），所以任何「POST /ingest 之后断言库里有东西」都必须自己把队列跑干净。
`test_ingest_async_90.py` 早就有 `_drain()` 这个姿态，这条只是没跟上。

🔴 **但判据不许写成 `drain_ingest_jobs() == 1`**（第一版就是这么写的，当场 `assert 6 == 1`）：
`claim_next_ingest_job` 是**全局**取队首（生产单队列，语义正确），而 `avery.ingest_jobs`
刻意没有 FK（审计设计：删 context 不删 job），共享库里别的用例留下的排队行会一起被跑掉。
判据要落在**自己那个 context 那条 job 的终态**上 → 新助手 `drain_and_assert_landed(cid)`。

### ② 起真 uvicorn 子进程——**autouse 的 off 被继承进了子进程**
这才是让四条里两条红得最难诊断的那一条：

```python
env = {**os.environ, **env_extra, "PYTHONUNBUFFERED": "1"}   # ← os.environ 里有 off
subprocess.Popen([... "uvicorn", "service.app:app" ...], env=env)
```

于是**「生产进程形状」里的 worker 线程被按死**：字节落库、job 排着队、没有任何人去跑它。
表现出来是「库里 0 行」，与①一模一样，病因却完全不同。
修法是显式打开（`conftest.SUBPROCESS_WORKER_ON`）+ 轮询任务摘要到终态（`await_ingest_job`），
**不是 sleep**——睡是墙上时钟赌注，任务摘要是服务自己说的话。

## 3 · 一把共享的尺，两条它自己的判据

「什么算落地」收进 `tests/conftest.py`（那个文件本来就owns「本电池怎么驱动 job」的口径）：
`drain_ingest_jobs` / `drain_and_assert_landed` / `await_ingest_job` / `SUBPROCESS_WORKER_ON`。

🔴 `await_ingest_job` **在「terminal 但 failed」时当场炸，且说的是「失败」不是「超时」**。
这条分支不是装饰：抽取失败与还没跑完在库里长着**同一张脸**（0 行），而它们的处置完全不同——
四条红当初难诊断，正是因为这两件事被混成了一句「库里没东西」。
两条判据钉它（`test_ingest_async_90.py`）：一条走「缺席→queued→processing→done」证明它真的
在等，一条证明失败被报成失败。⚠ 第一版这条自己红了：`pytest.fail` 抛的 `Failed` 继承
**BaseException**，`pytest.raises(Exception)` 根本接不住——改用 `pytest.raises(pytest.fail.Exception)`。

## 4 · 防复发的静态门（本票真正的交付物）

`test_every_uvicorn_subprocess_test_turns_the_ingest_worker_back_on`：扫全部 `tests/test_*.py`，
凡是**起真 uvicorn 子进程且拿 `**os.environ` 当底座**的文件，必须合进 `SUBPROCESS_WORKER_ON`。

判据落在**源码文本**上而不是运行时，因为运行时的形态恰好是「测试很慢然后超时」，
而慢和超时在 CI 上永远会被读成环境问题。

**它当场又扫出两个本票没点名的实例**（票面只列了四条测试）：

- **`test_seed_gate.py`** —— 潜伏型：它是 `@seedgate`，要真 key 才跑，所以在任何一条常跑的
  电池里都看不见。已修。
- **`test_e2e_stress.py`** —— **它把自己的主张变成了一句空话**：那条测试说的是
  「/health 没有被并发的**长 ingest**堵住」，而 worker 不跑 = 根本没有长 ingest，
  它压的是 deposit（毫秒级存字节）。已修（打开 worker，主张重新成立）。

## 5 · ~~顺着 ④ 挖出来的一件真事~~ —— **这一节的结论是错的，订正见 §9**

> 🔴 **2026-08-12 订正（同日，#95 收尾第二轮）**：本节量到的「6~8 秒」**不是服务的**，
> 是**量它的那把尺自己的**。`/health` 的真实成本是 **2 毫秒**。
> 整节原文保留不删（它是「量错了东西」的第四种形态的现场），结论以 §9 为准。

打开 worker 之后那条压测红了，判据是 `max(health_latencies) < 8.0`。
**没有直接改判据，先做了对照测量**（off/on 各 3 轮，同机、一次性库）：

```
worker OFF: n=2 [1.58, 6.62] / [1.46, 7.16] / [1.59, 6.41]
worker ON : n=2 [1.56, 7.69] / [1.62, 7.90] / [1.75, 6.10]
```

两组分布**重合** → 与 worker 开关**无关**，是这条进程形状（单 uvicorn worker + GIL）
本来就有的性质。结论两条：

1. **8.0 那条线正压在真实分布上**，所以它不是在测阻塞，是在测那天机器忙不忙
   （#93 收尾实收过一次 8.8s 翻红、空机同一条 2/2 绿）。
2. **样本恒为 2，而且这不是「轮询被饿着了」**——它是**延迟的函数**：加载窗口约 9 秒，
   一次 /health 就吃掉 6~8 秒。所以「最少 N 个样本」在这个形状下不可满足，
   「中位数」在 n=2 上就是最大值（我第一版两条都写了，两条都不成立）。

改成这条测试**真正能说的那句话**：全程有应答（既有的 `errors` 收集）、一次都没挂到客户端
超时（`max < 15.0`，明写**这不是延迟 SLA，是「挂没挂」的线**）、进程还活着。
实测数字与整段推理写进了测试注释，免得下一个人把它盲目收紧回去。

🟠 **「/health 要 7 秒」本身是一个产品/运维问题，不是这条门能替人做的判断**——
Docker healthcheck 的 timeout 必须大于它，否则容器会在抽取期间被自己杀掉，
而那正是 feat-041 这条压测存在的理由。**已单开一票**（含实测数字与三个待决问题：
healthcheck 参数现值 / 要不要把 `/health` 拆成便宜的 liveness + 可以慢的 readiness /
要不要真立一条延迟 SLA）。本票不动它。

## 6 · 改动清单

- `tests/conftest.py`：`SUBPROCESS_WORKER_ON` + `drain_ingest_jobs` + `drain_and_assert_landed`
  + `await_ingest_job`，以及模块头把「autouse 的 off 会被子进程继承」这块暗区写成碑。
- `tests/test_e2e_first_user.py` / `tests/test_persistence_restart.py`：worker 打开 + 等落地；
  `source_files` 那两条判据从**回执**搬到**清单**（说的是同一件事，而且证明的是库里真有）。
- `tests/test_pgvector_store.py`：`drain_and_assert_landed(cid)`。
  ⚠ 顺带变强了：嵌入现在是在 worker 里算的，那一行同时证明注入的 embedder 在那条路上真被用上。
- `tests/test_seed_gate.py` / `tests/test_e2e_stress.py`：静态门扫出来的两个实例。
- `tests/test_ingest_async_90.py`：+3 条（等待助手两条 + 静态门一条）。
- `.issues/ingest-root-cause-0812/receipt-90.md`：就地订正「既有五文件 78/78」那句口径。
- **零生产代码改动**（`git diff --stat` 里 `avery/` 与 `service/` 一个字节都没有）。

## 7 · 验证账

- **真库套全仓** `-m needs_db`（一次性库 `avery_t95_final`）：**142 passed · 0 failed**。
  修之前同一口径是 137/5（4 条本票的 + 1 条压测 flake）。
- **离线电池**：`TZ=UTC` → **4207 passed · 0 failed · 4 xfailed**（= #93 后的 4204 + 新 3 条）。
- **压测那条连跑 3 轮全绿**（v3 判据：p50 < 0.05s + max < 6.0s），对照测量见 **§9**
  （⚠ §5 那一版判据与它的「发现」都已被 §9 推翻）。
- **born-red 是现成的**：这四条在改之前就是红的，而且在**干净 HEAD** 上复现过
  （#93 回执 §6：`git checkout --` 回 HEAD、换全新一次性库，同样四条红）——
  不需要再造一次假红来证明判据有牙。
- **静态门的牙是它自己证的**：写完当场逮到两个票面没点名的实例（`test_seed_gate` /
  `test_e2e_stress`），这比任何人造变异都硬。
- 跑完的一次性库已 `DROP DATABASE`。🔴 **未 push**。

## 8 · 留给下一个人的两句话

1. **回执里写真库套口径，只许写全仓 `-m needs_db` 的数字**。「某几个文件 N/N」不是一个口径，
   是一块挡板——#90 就是这么把四条红藏了一整票的。
2. **任何改「HTTP 请求返回时世界是什么样」的改造**（异步化、排队、后台化），
   收尾必须重扫**全部**按同步语义写的断言，而不只是自己新写的那几条。
   本票的静态门只堵住了 uvicorn 子进程那一种形状，不是这类问题的通解。


---

## 9 · 订正：`/health` 从来就不慢，是**尺子量到了自己**（2026-08-12 同日，第二轮）

§5 把「压测下 /health 要 6~8 秒」当成了这条进程形状的性质，还据此把判据放宽到 15s 并写下
「这不是延迟 SLA」。**整个结论是错的。** 那张票（运维决策题）开出去之后照它的三个问题逐条查，
第一步就翻船了——而翻船的方式，正是这个仓库碑上写过无数次的那一种。

### 9.1 实测：服务 2 毫秒，客户端 1.4 秒

先测「处理器自己贵不贵」：把 `service.app.health()` 拉进进程里直接调，
**每一项都是 0.0000 秒**（mem_sentinel / resolve_brain_kind / active_extractor /
extraction_chain / failover.snapshot / budget.exhausted，逐个量过）。处理器是免费的。

那 1.4 秒在哪？同一个 `/health`、同一个服务，四种客户端姿势各 20 次：

| 姿势 | p50 |
|---|---|
| A 每次新建 `httpx.get()`（压测原来那条 + 我 §5 的 probe 用的） | **1.3876 s** |
| B 复用一个 `httpx.Client` | 0.0013 s |
| C 每次新建但 `trust_env=False` | 0.5004 s |
| D **裸 socket（地面真值 = 服务本身）** | **0.0019 s** |

**99.9% 的「延迟」是客户端自己**：约 0.5 秒花在构造 `Client` 上，另外约 0.9 秒花在
`trust_env=True` 去读 `HTTP_PROXY`/`NO_PROXY` 并建代理表上——本机确实设了
`HTTP_PROXY=http://127.0.0.1:9567`。所以那个数字**随开发机有没有配代理而变**，与服务无关。

连带作废的还有 §5 的第二个「发现」：**「样本恒为 2」不是轮询被饿着了**，
它就是「加载窗口 ÷ 那 1.4 秒」的商。尺子一修好，样本立刻变成 **13~16 个**。

### 9.2 修好尺子之后的真实分布

轮询器改成复用一个 `httpx.Client(trust_env=False)`（后者不是为了跑得快，是为了让判据
**不依赖开发机的代理配置**），同样 8 路 /ingest + 8 路 /advise 并发，4 轮：

```
n = 13~16, p50 ≈ 0.0025s, 其中恰好两个离群点落在 1.0~2.2s
```

那两个离群点主要是**测试进程自己**的 GIL——轮询线程与 16 个加载线程同进程抢。

### 9.3 生产那条 HEALTHCHECK 的真实成本（票面问题 1 的答案）

**Dockerfile 现值**：`--interval=30s --timeout=5s --start-period=10s --retries=3`，
命令体是**另起一个 python 进程**打一次 `urllib.request.urlopen(..., timeout=4)`。
把这条命令**逐字**跑起来量：

| | p50 | max | 失败 |
|---|---|---|---|
| 空载 | 0.200 s | 0.254 s | 0/8 |
| **8 路 /ingest + 8 路 /advise 并发下** | **0.183 s** | 0.210 s | **0/8** |

对着 `timeout=5s` 是 **~25 倍余量**，而且**负载完全不影响它**（它是独立进程，不在测试进程那口
GIL 锅里）。**结论：不需要改任何生产配置。**

⚠ 附带纠正我自己在那张票里写的一句话：「否则容器会在抽取期间被自己杀掉」——**这个部署形状下
不成立**。容器是 `docker run -d --restart unless-stopped`（runbook §A.4a），**没有编排器、
没有 autoheal**；而 Docker 本身**从不因为 healthcheck 失败去杀容器**（那是 Swarm/K8s 的行为），
`--restart` 只对**进程退出**生效。Dockerfile 头上那段注释其实已经把这件事写明白了
（「no orchestrator auto-heal」「Operators alert on `degraded:true` by SCRAPING the /health JSON」），
是我没读到底就把恐惧写进了票面。

### 9.4 票面三问，逐条结案

1. **healthcheck 参数够不够？** 够，25 倍余量，负载下 0 次失败。**不动。**
2. **要不要把 /health 做便宜 / 拆 liveness+readiness？** **不要**——它已经是 2 毫秒，
   处理器每一项都量到 0.0000 秒。拆分是在解一个不存在的问题，只会多一个要维护的口子。
3. **要不要真立延迟 SLA？** 已经立了，而且比原来的强：判据落在 **p50 < 0.05s**
   （实测 0.0025s，三个数量级余量；有人往 handler 里加一次 DB 查询会立刻红），
   max 只留一条宽的「挂没挂」线（6.0s，离群点实测 2.2s）。
   「采样问题」随尺子一起消失了——样本从 2 个变成 13~16 个。

### 9.5 这次真正的教训（值得进碑）

progress.md 那条「**量错了东西的三种形态**」（#84 实收：尺子够不着 / 变异是空的 /
判据落在下游后果上）**再添一种，而且是最难看的一种**：

> 🔴 **尺子量到了它自己。** 判据量的是「服务多快」，而 99.9% 的读数来自**测量代码自身的构造成本**，
> 于是它随开发机的代理配置而变。它的两种形态都出现过：先以**假红**出现（8.8s > 8.0，被读成
> 「机器忙」），再以**假的发现**出现（「这条进程形状本来就慢」——还写进了回执、progress.md
> 和一张开给别人的票）。
>
> **防法**：任何以「快/慢」为判据的门，必须有一个**独立的地面真值**做对照
> （这里是裸 socket 的 2 毫秒）。没有对照，你不知道读数里有多少是尺子的。
