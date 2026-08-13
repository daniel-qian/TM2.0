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

## 5 · 顺着 ④ 挖出来的一件真事：**压测下 `/health` 本来就要 6~8 秒**

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
- **压测那条连跑 3 轮全绿**（新判据），对照测量见 §5。
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
