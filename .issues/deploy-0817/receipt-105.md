# receipt-105 — 上产预案与预检（只准备，**未上产**）

> 正源：[issue #105](https://github.com/daniel-qian/avery/issues/105)。2026-08-17。
> 交付：`runbook-105.md`（逐条带判据的上产脚本）+ 本回执（预检真跑的账）。
> 🔴 **未 push · 未换生产容器 · 未改任何 env 值。** 证据见 §6。

## 一句话

在生产机上把上产链路**从头到尾真跑了一遍**，只是把最后一步的箭头指向了一个一次性预检库：
拉 env+挂载 → bundle 传树 → 带 `--build-arg AVERY_COMMIT` 构建 → 8138 起新容器 →
在**与生产逐字段同构**的预检库上真做了一次升级（0017→0020，两轮）→ 判据全绿 → 全部拆掉。
顺带量出三件票面没写的事（§4），其中一件把「两条新迁移」订正成了**四条**。

---

## 1 · 预检不能连生产库 —— 这是本票最先撞到的墙

票面 §3 说「预检在 8138 起新容器」，旧碑还说「迁移不在容器启动时跑，要主动用一个无害请求触发」。
**后面这句从 #90 起就过期了**，而它一过期，预检的整个安全前提就塌了：

- `service/app.py:75` 的 `_lifespan` 启动即 `active_registry().recover_orphan_ingest_jobs()`，
  `pg_registry.py:1658` 第一行就是 `self._ensure_schema()` → 全量重放 20 个迁移。
- 所以**预检容器一起来就在改它连的那个库**。用生产 env 原样起 = 当场把 0017–0020 打进生产库。
- 退路 `AVERY_INGEST_WORKER=off` 只是**推迟**，不是豁免：`/demo/status` 走
  `_master_id(files) in active_registry()` → `__contains__`（`pg_registry.py:1502`）→ 同一个 `_ensure_schema`。

**三条都是实测的，不是读码推的：**

| 实验 | 结果 |
|---|---|
| worker **on**，容器起来后**一个 HTTP 请求都没发过** | 库已是 13 张表 / RLS 13/13 → **启动就迁移** |
| worker **off**，起来后不发请求 | 库仍是 12 张 / RLS 0 → 刀闸真的挡住了 |
| 同一个 worker=off 容器，发**一次** `/demo/status` | 库变成 13 张 / RLS 13/13 → **只是推迟** |

> ⚠ 这个 off 实验第一版是**瞎的**：那个容器没挂 seed，`/demo/status` 在
> `_seed_dir()` 为空的分支就短路返回了，`active_registry()` 根本没被调到，
> 「库没变」于是什么都证明不了。补挂 seed 重跑才拿到上面第三行。
> 副产品：那次没挂载的容器如实回了 `{"available":false}` —— 正好是 0812 事故的形状，
> 等于给 runbook 的 `available:true` 判据配了一个**免费的 born-red**。

**结论**：预检库必须是一次性的。方案见 §2。

---

## 2 · 预检库怎么造的（关键是它不是「模拟」）

```
一次性 pgvector:pg17 容器（生产是 PostgreSQL 17.6）
  └─ 镜像 Supabase 的布局：CREATE SCHEMA extensions;
       vector + pgcrypto 都装进 extensions（不是 public）；
       ALTER DATABASE ... SET search_path = "$user", public, extensions
  └─ 连库角色 avery_pf_owner：LOGIN NOSUPERUSER NOBYPASSRLS（比生产还弱，见 §3）
  └─ 用【现在正在生产跑的那个镜像】main-20260812-070519 去 bootstrap 它
```

最后一步是要害：**拿旧 artifact 造对照组**，所以得到的是生产今天的 schema，不是我照着记忆写的。
旧镜像里只有 **16 个**迁移文件（`ls db/migrations/*.sql | wc -l` = 16），这独立印证了 §4-① 的订正。

指纹比对（左＝生产实查，右＝预检库）：

| | 生产（read-only 探针） | 预检库 |
|---|---|---|
| avery 表 | 12 | 12 |
| RLS on / FORCE | 0 / 0 | 0 / 0 |
| policies | 0 | 0 |
| `account_contexts_context_key` | UNIQUE | UNIQUE |
| 0017 `content_sha256` 列 | 不存在 | 不存在 |
| 0018 `ingest_jobs` 表 | 不存在 | 不存在 |
| 表名清单 | 12 个，逐字相同 | 12 个，逐字相同 |

🔴 生产那一列是用**旧镜像 + 裸 psycopg**（`--entrypoint python`）查的，**刻意不走 registry** ——
走 registry 的探针会自己重放迁移，那就成了「探针把自己要测的东西改掉了」。

---

## 3 · 预检结果（每条都带判据）

**构建**

| 判据 | 实测 |
|---|---|
| 服务器 HEAD == 本地 main | `1dd35ce6234794e04934b18f11f672d1399b69c7` ✓ |
| tree 也相同 | `504930897c907b01ff56faf8a8b8e65c4ac8838f` ✓ |
| 工作树干净 | 空 ✓ |
| 镜像里 `AVERY_COMMIT` | `=1dd35ce…`（不是 `unknown`、不是旧 SHA）✓ |
| 镜像里迁移文件数 | 20（末位 `0020_…`）✓ |
| `openai` 版本落在 `>=1.40,<3` | 2.54.0 ✓ |
| 构建耗时 / 镜像大小 | 15 s / 219 MB ✓ |

**8138 预检容器（生产 env 原样，只换 `AVERY_DB_URL` 一行）**

env 文件用**正向白名单**建（`AVERY_|MINIMAX_|DEEPSEEK_|DASHSCOPE_|SUPABASE_|OPENAI_` 减去 `AVERY_COMMIT`），
并逐名核对丢掉的 10 个全是镜像自带 + `AVERY_COMMIT`：**30 keep / 10 drop / 总数 40** ✓。
预检 env 与生产 env 的**变量名集合完全相同**，值只差 `AVERY_DB_URL` 一行 ✓。

| 判据 | 实测 |
|---|---|
| `docker run` → 第一个健康 `/health` | **2.3 s**（含 20 个迁移的整轮重放） |
| `/health` `status` / `commit` | `ok` / **`1dd35ce…`（新 SHA）** ✓ |
| `/health` `degraded` / `extraction_chain` | `false` / `["minimax","deepseek"]` ✓ |
| `/demo/status` | `{"available":true,"ready":false}` ✓ （`available` = 挂载判据；`ready:false` 正是「这不是生产库」的自证） |
| 容器内看得到 seed | 9 个文件，`ro,relatime` ✓ |
| 启动日志 error/traceback | 无 ✓ |
| `docker port` | `8137/tcp -> 127.0.0.1:8138`（内部 8137，照抄 0812 的碑）✓ |

**迁移两轮重放（#100 第 8 步判据，在预检库上真跑）**

| | 第一轮（容器启动） | 第二轮（`docker restart`） |
|---|---|---|
| 表数 | 12 → **13** | 13（不变） |
| RLS on / FORCE / policies | **13 / 0 / 0** | 13 / 0 / 0（不变） |
| `account_contexts_context_key` | UNIQUE → **non-unique** | non-unique（**没变回唯一**）✓ |
| 0017 列 / 0018 表 | 都出现 | 都在 |
| 日志 error | 无 | 无 ✓ |
| 到健康耗时 | 2.3 s | 2.6 s |

**RLS（🔴 全程用最弱身份，票面明令）**

连库角色 `avery_pf_owner` = `rolsuper=false, rolbypassrls=false`。
生产角色 `postgres` = `rolsuper=false, **rolbypassrls=true**`（0817 实查）——
**预检角色比生产更弱**，弱角色上成立，生产必然成立。

- 后端在「最弱身份 + RLS 全开」下读写正常：一个事务写 contexts+source_documents+ingest_jobs →
  读回 `name='rls probe'` / 1 份文档 / owner_token → 原字节 `b'# probe\nhello rls'` 取得回 →
  job `queued` → `empty_context` 成功。
- 孤儿回收对 `queued` 行**没动**（回收 0，行仍 queued）——#90 语义在真库上兑现。
- deny-all 的牙口（**先种 2 行基线**再量，避免销毁类判据天生空真）：

  | 被误 GRANT 的陌生角色 | RLS OFF（今天的生产） | RLS ON（上产后） |
  |---|---|---|
  | SELECT 看得见 | **2** | 0 |
  | UPDATE 改掉 | **2** | 0 |
  | INSERT | 成功 | `violates row-level security policy` |
  | DELETE 删掉 | **3** | 0 |
  | 主人事后还剩 | **0 行（被外人删光）** | **2 行完好** |

  对照组（RLS off 的那个库）全程只被 raw SQL 碰过；跑完复验仍是 `12 张 / 0 on` —— **没被自愈式探针治好**。

---

## 4 · 票面之外量出来的三件事

### ① 🔴 生产落后的是**四条**迁移，不是两条

两条独立证据：生产库没有 `content_sha256` 列、没有 `ingest_jobs` 表；且现产镜像里只有 16 个迁移文件。
所以 0017（#90 的 sha256）与 0018（#90 的任务表）**同样是首次重放**。

代价已量，都很小：0017 的 backfill 目标是 **277 行 / 2.83 MiB**，
在生产上用内置 `sha256()` 做了一次**只读**计时：**0.010 s**（离 30 s 的 `statement_timeout` 三个数量级）。
0018 是空表建表。`account_contexts` **0 行**，所以 0020 的索引替换没有任何数据风险。

### ② 🔴 生产角色装不了扩展 —— 但它不需要装

生产 `postgres` 是 `rolsuper=false`。0017 头一句是 `CREATE EXTENSION IF NOT EXISTS pgcrypto`。
实查：**pgcrypto 生产上已装**（`extensions` schema，v1.3），所以那句是 no-op，
`digest()` 靠迁移自己的 `search_path = avery, public, extensions` 解析得到。
**这条只能对着生产查，本地一次性库永远查不出来**（本地是超级用户，装得上）。

### ③ 🔴 稳态 bootstrap 还在锁两张表（#104 那一类的漏网之鱼）

方法照 #104：另一连接持 ACCESS SHARE，`lock_timeout=3000`、`retries=1`，锁在测试前后各验一次仍握着。

| 被占住的表 | 新镜像 | 元凶 |
|---|---|---|
| `entities` | PASS 0.47 s | —（#104 已修） |
| `account_contexts` | PASS 0.46 s | —（#100 守卫生效） |
| `materials` | PASS 0.46 s | — |
| `contexts` | 🔴 BLOCKED 3.35 s | `0011_contexts_ephemeral_gc.sql` |
| `source_documents` | 🔴 BLOCKED 3.29 s | `0005_source_documents_status.sql` + `0017_…sha256.sql` |
| `entities` / **旧**镜像 | BLOCKED 3.26 s | born-red 对照：0002 修之前的裸 DROP |

常驻门 `test_steady_state_bootstrap_takes_no_table_lock` 只参数化了 `entities` 与 `account_contexts`，
**另外两张从来没被量过**。**不拦这次上产**：对照实验确认旧镜像对着这两张表同样 BLOCKED ——
生产已经这样开机好几个月了，本批只是让 0017 在**已被 0005 锁住的同一张表**上多取一次锁，不新增受影响的表。

⚠ **这条的票没开成**：GitHub API 走代理连续 EOF，9 次全失败（创建前已核对过没有半成功的重复票）。
票面正文已写好落在 `.issues/deploy-0817/issue-draft-bootstrap-locks.md`，含实测表、修法建议
（守卫化 0005/0011/0017 + **把常驻门从手写表名改成按 catalog 遍历全表**）与诊断陷阱。代理通了直接发。

⚠ 读旧日志会被带偏：旧镜像的报错**写死了** "could not lock the entities table"，
哪怕真正卡住的是 `contexts`（#100 已把这句改成不点名）。

---

## 5 · 顺带发现的运维卫生问题（🔴 归 Danny，删除类）

`/tmp/avery_env_*` 在机器上留了 **5 个**历史快照（0807×4、0810×1），权限 **`0644`**——
**同机器上任何用户可读**，每个含 3 把真 key（MINIMAX / DEEPSEEK / DASHSCOPE）。
这台是**合伙人的机器**（他的 `ims-webapp` 跑在 `:5108`）。
本轮自己产生的两个已 `shred -u`；那 5 个属于删除类，没动，交给 Danny。
`runbook-105.md` S7 已把「用完即销毁」写成固定步骤。

---

## 6 · 🔴「生产一个字节没动」的证据

**容器**（Phase 0 取证 vs 全部跑完之后，逐字段）：

| 字段 | before | after |
|---|---|---|
| ContainerId | `6ed78e6992f1…` | `6ed78e6992f1…` |
| Image / ImageId | `main-20260812-070519` / `sha256:f32a7d5624df…` | 同上 |
| StartedAt | `2026-08-12T07:10:08.202415835Z` | 同上 |
| Pid | 2633370 | 2633370 |
| RestartCount | 0 | 0 |
| Health | healthy | healthy |
| `docker diff` 变更数 | 49 | 49 |

**`/health`**：`commit` 仍是 `6b70173c46b8eed66c579e28c4204d40cbec17e7`；
`llm_calls_remaining` **1965 → 1965**、`embed_calls_remaining` **1937 → 1937**
—— 预算一个数都没掉，**整个预检零 LLM 调用**（只有 rss 从 131.8 → 125.5 MB，那是运行时内存）。

**生产库**（同一个只读裸 psycopg 探针，跑完之后再查一遍）：
12 张表 · RLS **0/0** · policies 0 · `account_contexts_context_key` 仍 **UNIQUE** ·
0017 列不存在 · 0018 表不存在 —— **与 Phase 0 逐字段相同，四条迁移一条都没上生产**。

**机器**：8138 `FREE`；`docker ps` 只剩 `avery` + `ims-webapp`；
`/home/admin/build-zh` HEAD 仍 `6b70173`、工作树干净（预检用的是另建的 `build-105`，已删）；
预检容器/预检库容器/网络/pgvector 镜像/bundle/探针脚本/两个 env 快照全部清掉；
磁盘 8.1 G used（进来时 7.8 G，差值＝留下的那个镜像）。

**唯一留下的东西**：镜像 `avery-agent:preflight105-20260817-151753`（219 MB，= `1dd35ce`）。
刻意保留，两个用处：它是「这棵树构建得出来」的实物证据；上产当天若 HEAD 未变，
`docker build` 会是纯缓存命中。它**不叫** `main-*`，所以 `swap3.sh` 不可能误取它。

**git**：`D:/avery` 仍在 `main`，`origin/main` 仍是 `2c74104`，**未 push**（本地领先 43 个提交）。
本票只新增 `.issues/deploy-0817/` 两个文档。

---

## 7 · 按下去要敲哪几条

`runbook-105.md` 是完整脚本。压缩成一屏：

1. **S0–S1 可以现在就做**（不对外）：取证 + 用 bundle 在服务器构建镜像。0817 已经做完，
   若 HEAD 未变则镜像已在机器上。
2. **S2 `git push origin main`** ← 🔴 **唯一需要 Danny 点头的那一下**，一按下去 Vercel 立刻上产前端。
3. **S3 8138 预检** —— ⚠ 与今天不同：那一刻它连的是**生产库**，四条迁移就是在这一步真正上生产的。
   判据：`/health` commit 是新 SHA、`/demo/status` 是 `available:true,ready:true`。
4. **S4 停旧 → S5 起新**（顺序不可反，否则旧容器在跑的 job 被误标 failed）。或直接
   `bash /tmp/swap3.sh $TS avery-agent:main-$TS`（它已含 demo-seed 挂载 + 健康闸 + 自动 rollback）。
5. **S6 复验**：`/health` commit · `/demo/status` · `RLS (13,13) / forced 0 / policies 0 / ctx_key 非唯一`。
   `forced` 不是 0 就立刻回滚。
6. **S7 收尾**：`shred -u /tmp/avery_env_$TS`（有真 key），`avery-prev-$TS` 留着当回滚梯。

预计对外不可用窗口：**约 5–10 秒**（停旧 → 起新 → 2.3 s 到健康）。
这个窗口是**故意留的**：不能靠「新的起来了再停旧的」去消掉它，那样两个容器并存，
新容器的启动孤儿回收会把旧容器正在跑的 `processing` 任务误标 failed（#90）。
