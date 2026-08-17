# runbook-105 — 43 个提交一次上产（含四条新迁移 · RLS · 异步 ingest · 前端撤注册）

> 正源：[issue #105](https://github.com/daniel-qian/avery/issues/105)。本文件是**照着敲的**上产脚本，
> 每一步带判据（怎么知道这步成了）与回滚点。**预检已于 2026-08-17 真跑过一遍**，
> 实测数字见同目录 `receipt-105.md`；下面每条判据的期望值都来自那次实测，不是推演。
>
> 🔴 **本 runbook 的第 1 步是对外闸（push = 前端自动上产），要 Danny 在场点头才开始。**

---

## 0 · 按下去之前必须先知道的四件事

**① 登录仍然是坏的，上产不会修好它。**
Supabase 组织流量超额，Auth API 回 402（0817 实测）。这与本批代码无关，归 Danny 处理计费。
上产之后前端会有一个登录入口而它点了没用 —— **演示前要知道这件事**，别在客人面前才发现。

**② #96 的 OpenAI provider 一次真握手都没有过。**
代码在 main 上但没启用。本轮**不要**动 `AVERY_BRAIN` / `AVERY_OPENAI_*` 相关 env。
下面第 4 步的 env 提取是「原样照抄」，照抄就自然不会碰到它。

**③ 生产库落后的不是两条迁移，是四条。**
票面 §2 写的是 0019/0020，实查生产库 **0017 与 0018 也没有**（生产镜像 `6b70173` 早于 #90）：

| 迁移 | 生产现状 | 这次开机要做什么 | 实测代价 |
|---|---|---|---|
| 0017 content_sha256 | 列不存在 | ADD COLUMN + 库内 backfill | 277 行 / 2.83 MiB，哈希实测 **0.010 s** |
| 0018 ingest_jobs | 表不存在 | 建新表 + 两个部分索引 | 空表，瞬时 |
| 0019 enable_rls | 0/13 RLS off | 12+1 张表开 RLS（无 policy、无 FORCE） | catalog 标志位 |
| 0020 索引替换 | `..._context_key` 是 UNIQUE | 换成**同名非唯一**索引 | `account_contexts` **0 行**，无数据风险 |

`pgcrypto` 生产上**已装**（`extensions` schema，v1.3），所以 0017 那句 `CREATE EXTENSION` 是
no-op —— 这点很关键，因为生产连库的角色 `postgres` 是 **`rolsuper=false`**，真要它现装扩展是装不上的。

**④ 迁移现在是在容器启动那一刻跑的，不再是「等第一个请求」。**
旧碑（`avery-deploy-live-topology` 记忆条）写着「`_ensure_schema` 在第一次真正访问 registry 时才重放」，
**这句话从 #90 起就过期了**：`_lifespan` 启动即调 `recover_orphan_ingest_jobs()`，它第一件事就是
`_ensure_schema()`。0817 预检实测：worker 开着的容器起来后**一个 HTTP 请求都没发过**，库已经是 13/13。

推论有两条，都写进下面的步骤里了：
- 新容器一起来就在改库 —— 所以**先停旧再起新**这条纪律比以前更硬（§3 第 6 步）。
- 想让一个容器**不碰库**，只有 `AVERY_INGEST_WORKER=off`，而且它只是**推迟**：预检实测
  worker=off 起来后库还是 12 张表，**发一次 `/demo/status` 就变成 13 张**（`__contains__` → `_ensure_schema`）。
  所以「拿预检容器连生产库」在任何配置下都不安全。

---

## 1 · 顺序，以及为什么是这个顺序

```
S0 取证 → S1 预先构建镜像 → S2 push（🔴 对外闸）→ S3 预检 8138 → S4 停旧 → S5 起新 → S6 复验 → S7 收尾
```

**为什么把构建放在 push 之前**（与 0812 那次相反）：

- 服务器的构建目录 `/home/admin/build-zh` 连的是 `origin`，而本地 main **领先 origin 43 个提交且未推**。
  所以在 push 之前，服务器上唯一拿得到这棵树的办法是 **git bundle**（预检就是这么做的，2.8 MB）。
- 这样安排还顺手关掉一个真实窗口：push 之后 Vercel 立刻开始构建前端（约 1–2 分钟），
  而后端换容器只要约 30 秒。**先把镜像备好，push 完立刻换容器**，后端就会赶在前端翻新之前到位。
- 这个窗口即使漏了也不致命（已查源码）：新前端 `src/lite2/store.ts:882` 是 `if (payload.job)` 分支，
  旧后端不返回 `job` 就自动走回同步那条路。**但没必要留着它。**

**回滚方向**：任何一步失败，回滚都是「把旧容器改回 `avery` 并启动」（§4），
前端那半边**不回滚** —— 新前端对旧后端是兼容的（同上），回滚 Vercel 反而多一次对外动作。

---

## 2 · 变量与前置检查

```bash
ssh -i ~/.ssh/id_ed25519 admin@8.211.28.11
```

```bash
TS=$(date +%Y%m%d-%H%M%S); echo "TS=$TS"   # 这一轮所有名字都挂这个戳
```

前置检查（三条都得绿再往下）：

```bash
sudo -n docker ps --format '{{.Names}}\t{{.Image}}\t{{.Status}}'
```
- 判据：`avery` 在跑且 `(healthy)`；`ims-webapp` 也在（**合伙人的，别碰**）。

```bash
(ss -ltn | grep -q 8138) && echo "8138 OCCUPIED - 先清干净" || echo "8138 FREE"
```
- 判据：`FREE`。占了多半是上次预检容器没删（0723 踩过，活了 4 天）。

```bash
df -h / | tail -1; free -m | head -2
```
- 判据：根分区可用 > 5 G；可用内存 > 500 M（构建 + 预检容器 + 生产容器要同时在）。

---

## 3 · 逐步

### S0 · 现场取证（before 指纹，出事时这是唯一的对照基准）

```bash
sudo -n docker inspect avery --format 'ContainerId={{.Id}}
Image={{.Config.Image}}
ImageId={{.Image}}
StartedAt={{.State.StartedAt}}
RestartCount={{.RestartCount}}
Health={{.State.Health.Status}}' | tee /tmp/avery_before_$TS
curl -s http://127.0.0.1:8137/health | tee -a /tmp/avery_before_$TS; echo
```
- 判据：记下 `commit` 字段（上产前应为 `6b70173c46b8eed66c579e28c4204d40cbec17e7`）。
  这是 S6 复验「换成功了」的对照物。

### S1 · 预先构建镜像（push 之前，走 bundle）

本地（`D:/avery`，确认在 `main` 上）：

```bash
git bundle create /tmp/avery-105.bundle origin/main..main
```
- 判据：文件生成，几 MB 量级（预检实测 2.8 MB）。它只带增量提交，所以小。

```bash
scp -i ~/.ssh/id_ed25519 /tmp/avery-105.bundle admin@8.211.28.11:/tmp/avery-105.bundle
```

服务器上：

```bash
rm -rf /home/admin/build-105
git clone -q /home/admin/build-zh /home/admin/build-105
cd /home/admin/build-105 && git fetch -q /tmp/avery-105.bundle main:pf105 && git checkout -q pf105
git rev-parse HEAD; git status --porcelain | head
```
- 判据：`git rev-parse HEAD` **逐字等于**本地 `git rev-parse main`；`git status` 空。
  🔴 不比对 SHA 就往下走，等于不知道自己构建的是什么。
- 顺带比 tree：本地 `git rev-parse main^{tree}` 与服务器 `git rev-parse HEAD^{tree}` 相等（预检实测 `5049308…`）。

```bash
cd /home/admin/build-105
SHA=$(git rev-parse HEAD)
sudo -n docker build --build-arg AVERY_COMMIT=$SHA \
  -t avery-agent:main-$TS -f eval-harness/Dockerfile eval-harness
sudo -n docker image inspect avery-agent:main-$TS \
  --format '{{range .Config.Env}}{{println .}}{{end}}' | grep AVERY_COMMIT
```
- 判据：最后一行是 `AVERY_COMMIT=<完整 40 位 SHA>`，不是 `unknown`、不是旧 SHA。
  **漏了 `--build-arg` 不会报错**，只会让 `/health` 继续说旧话，下次没人说得清生产在跑什么。
- 参考耗时：预检实测 **15 秒**（依赖层全命中缓存；`requirements-service.txt` 这批只改了 openai 上界）。

> 0817 预检已构建过 `avery-agent:preflight105-20260817-151753`（= `1dd35ce`）。
> 若上产当天 `git rev-parse HEAD` 仍是 `1dd35ce…`，这次 build 会是纯缓存命中，秒出。

### S2 · 🔴 push（对外闸 —— Danny 在场，他点头再敲）

```bash
git push origin main
```
- **这一步一按下去，Vercel 立刻开始构建并上生产前端**，无法撤销、无人工确认。
- 判据：`git rev-parse origin/main` == 本地 main。
- 判据（约 1–2 分钟后）：<https://averylite.dannyqian.com> 的 index 里能 grep 到新 SHA。
  ⚠ 业务字符串在 `lazy()` 分包里，index 主包采不到 —— 验前端只 grep **commit SHA**，
  要验业务串就先从 index 抠 chunk 文件名再逐个 curl。

### S3 · 提 env + 挂载，然后在 8138 预检

```bash
sudo -n docker inspect avery --format '{{range .Config.Env}}{{println .}}{{end}}' \
  | grep -E '^(AVERY_|MINIMAX_|DEEPSEEK_|DASHSCOPE_|SUPABASE_|OPENAI_)' \
  | grep -v '^AVERY_COMMIT=' > /tmp/avery_env_$TS
chmod 600 /tmp/avery_env_$TS
grep -c = /tmp/avery_env_$TS
```
- 判据：**30 个变量**（0817 实测值；比这个少就是漏了，多出来的要能说出是哪一票加的）。
- 判据：确认丢掉的 10 个全是镜像自带 + `AVERY_COMMIT`：
  ```bash
  diff <(sudo -n docker inspect avery --format '{{range .Config.Env}}{{println .}}{{end}}' | grep = | sed 's/=.*//' | sort) \
       <(sed 's/=.*//' /tmp/avery_env_$TS | sort)
  ```
  期望只多出：`AVERY_COMMIT GPG_KEY LANG PATH PIP_NO_CACHE_DIR PORT PYTHONDONTWRITEBYTECODE PYTHON_SHA256 PYTHONUNBUFFERED PYTHON_VERSION`。
- 🔴 **`AVERY_COMMIT` 必须排除**：它同时是镜像 ENV 和在跑容器的 env，`--env-file` 会**盖掉**镜像里
  刚烤进去的那个值，于是 `/health` 报旧 SHA，看起来像 `--build-arg` 没生效。这条是静默的。
- 🔴 **`demo-seed` 是只读 bind mount，不在 Env 里**，必须单独抄（0812 差点上线的事故）：
  ```bash
  sudo -n docker inspect avery --format '{{range .Mounts}}{{println .Type .Source .Destination .RW}}{{end}}'
  ```
  期望：`bind /home/admin/avery-demo-seed /app/demo-seed false`（`false` = 只读）。

```bash
sudo -n docker run -d --name avery-preflight-$TS \
  --env-file /tmp/avery_env_$TS \
  -v /home/admin/avery-demo-seed:/app/demo-seed:ro \
  -e PORT=8137 -p 127.0.0.1:8138:8137 avery-agent:main-$TS
sleep 5; sudo -n docker port avery-preflight-$TS
curl -s http://127.0.0.1:8138/health; echo
curl -s http://127.0.0.1:8138/demo/status; echo
```

- 🔴 **这个预检容器连的是生产库，而它一起来就会把 0017–0020 打上去**（§0 ④）。
  这不是可以绕过的：`AVERY_INGEST_WORKER=off` 只把它推迟到第一个 `/demo/status`。
  **所以 S3 的预检容器＝生产迁移的实际执行点。** 上产当天这是对的（反正要迁），
  但也意味着：**S3 一起来，回滚就不再是「什么都没发生」**，见 §4。
- 判据 `/health`：`"status":"ok"`；`"commit"` 是**新** SHA；`"degraded":false`。
- 判据 `/demo/status`：`{"available":true,"ready":true}`。
  `available:false` ⇒ **挂载漏了**（0817 实测过这条判据的牙口：没挂载的容器如实回 `available:false`）。
  `ready:false` ⇒ 库里没有 demo 母本 —— 上产当天连的是生产库，母本在，应为 `true`。
- 判据（迁移真上了）：
  ```bash
  sudo -n docker logs avery-preflight-$TS 2>&1 | grep -iE 'error|traceback|exception|violation' || echo "no errors"
  ```
  期望：`no errors`。

### S4 · 停旧（🔴 顺序不能反）

```bash
sudo -n docker rm -f avery-preflight-$TS      # 先撤预检，8138 让出来
sudo -n docker stop avery && sudo -n docker rename avery avery-prev-$TS
```
- 🔴 **必须先停旧再起新**：新容器启动跑孤儿任务回收，把所有 `processing` 的 job 判成
  「死在半路」标 failed。旧容器要是还在跑，它**正在处理**的那批文件会被误标 failed
  （#90 回执；`queued` 行不受影响，字节在库里）。
- 判据：`sudo -n docker ps --format '{{.Names}}'` 里没有 `avery`。
- 判据：`sudo -n docker inspect avery-prev-$TS >/dev/null && echo "回滚梯已就位"`。

### S5 · 起新

```bash
sudo -n docker run -d --name avery --restart unless-stopped \
  --env-file /tmp/avery_env_$TS \
  -v /home/admin/avery-demo-seed:/app/demo-seed:ro \
  -e PORT=8137 -p 127.0.0.1:8137:8137 avery-agent:main-$TS
for i in $(seq 1 20); do sleep 2; curl -s --max-time 3 http://127.0.0.1:8137/health | grep -q '"status":"ok"' && { echo "HEALTHY after ${i}x2s"; break; }; done
```
- 判据：20 次以内变健康（预检实测：`docker run` 到第一个健康 `/health` 是 **2.3 秒**，
  含整轮 20 个迁移的重放；重启第二轮 2.6 秒）。超过 40 秒没绿 ⇒ 直接走 §4 回滚。
- `/tmp/swap3.sh` 做的就是 S4+S5+健康闸+失败自动 rollback。要用它就是
  `bash /tmp/swap3.sh $TS avery-agent:main-$TS`（它自己读 `/tmp/avery_env_$TS`，
  并且已经带上了 demo-seed 挂载）。**用它的话 S3 的预检容器要先删掉**，否则 8138 还占着无所谓，
  但两个新容器同时在跑会让孤儿回收互相打架。

### S6 · 上产复验（真跑，不是读码）

```bash
curl -s https://avery.dannyqian.com/health; echo
curl -s https://avery.dannyqian.com/demo/status; echo
```
- 判据①：`commit` == 新 SHA（与 `/tmp/avery_before_$TS` 里的旧值不同）。
- 判据②：`{"available":true,"ready":true}` —— **`ready:false` 就是示例团队没了**，回滚。
- 判据③：`"degraded":false`、`extraction_chain:["minimax","deepseek"]`。
- 判据④ 迁移落地（用**新**容器跑一句只读 catalog 查询，不走 registry）：
  ```bash
  sudo -n docker exec avery python -c "
import os,psycopg
c=psycopg.connect(os.environ['AVERY_DB_URL'],autocommit=True)
print('RLS on/total =', c.execute(\"select count(*) filter (where relrowsecurity), count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='avery' and c.relkind in ('r','p')\").fetchone())
print('forced       =', c.execute(\"select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='avery' and c.relforcerowsecurity\").fetchone()[0])
print('policies     =', c.execute(\"select count(*) from pg_policies where schemaname='avery'\").fetchone()[0])
print('ctx_key uniq =', c.execute(\"select x.indisunique from pg_class i join pg_index x on x.indexrelid=i.oid join pg_namespace n on n.oid=i.relnamespace where n.nspname='avery' and i.relname='account_contexts_context_key'\").fetchone())
print('0018 table   =', c.execute(\"select to_regclass('avery.ingest_jobs') is not null\").fetchone()[0])"
  ```
  期望逐行：`(13, 13)` · `forced = 0` · `policies = 0` · `ctx_key uniq = (False,)` · `0018 table = True`。
  🔴 `forced` 不是 0 就**立刻回滚**：FORCE 会把 deny-all 对准后端自己，症状长得像静默数据丢失。
- 判据⑤ 前端（Vercel 已构建完）：index 里 grep 得到新 SHA。
- 判据⑥ 一眼人工：打开 <https://averylite.dannyqian.com>，示例团队入口在、点得开。
  ⚠ 登录入口点了没用是**已知的**（§0 ①），不是本次上产的回归。

### S7 · 收尾

```bash
shred -u /tmp/avery_env_$TS          # 🔴 里面有三把真 key
rm -rf /home/admin/build-105 /tmp/avery-105.bundle
sudo -n docker ps --format '{{.Names}}'      # 期望只剩 avery + ims-webapp
```
- 🔴 **`/tmp/avery_env_*` 必须销毁**：0817 实查，机器上还躺着 **5 个**历史快照，权限 `0644`
  （**同机器上任何用户可读**），每个都含 3 把真 key。这台是**合伙人的机器**。
  清理旧的那 5 个属于删除类，归 Danny 拍板 —— 但**这一轮新产生的，自己收干净**。
- 回滚梯保留：`avery-prev-$TS` **不要删**（`avery-prev-*` 已堆到 15 个以上，清理同样归 Danny）。

---

## 4 · 回滚梯

**容器回滚（30 秒内）：**

```bash
sudo -n docker rm -f avery
sudo -n docker rename avery-prev-$TS avery
sudo -n docker start avery
for i in $(seq 1 15); do sleep 2; curl -s --max-time 3 http://127.0.0.1:8137/health | grep -q '"status"' && { echo "ROLLBACK OK"; break; }; done
curl -s http://127.0.0.1:8137/health | grep -o '"commit":"[^"]*"'   # 期望回到 6b70173…
```

**🔴 库不跟着回滚，也不需要跟着回滚。** 一旦 S3 的预检容器起来过，0017–0020 就已经上了生产库。
退回旧镜像后旧代码在新 schema 上照跑，理由逐条：

| 迁移 | 旧代码遇到它 |
|---|---|
| 0017 多一列 `content_sha256` | 旧代码的 INSERT 列清单不含它，列有 `DEFAULT ''` → 照写 |
| 0018 多一张 `ingest_jobs` | 旧代码根本不知道这张表存在 → 无影响 |
| 0019 RLS 开着 | 生产角色 `postgres` 是 **`rolbypassrls=true`**（0817 实查）→ 无条件绕过；且无 FORCE、无 policy |
| 0020 索引变非唯一 | 旧代码只查不建；旧的 0008 那句 `CREATE UNIQUE INDEX IF NOT EXISTS` 只按**名字**判重，名字被占 → 整句跳过，不炸 |

**真要把 0019 退掉**（只有在 RLS 被证明惹了事时才做，没有已知场景）：
`ALTER TABLE avery.<t> DISABLE ROW LEVEL SECURITY` 逐表，纯 catalog 标志位，不动数据。
0020 **不要**试图退回唯一索引 —— 那要求 `account_contexts` 里没有一份档案挂两个账号。

**前端不回滚**（§1 已述）。

---

## 5 · 迁移这一层：0817 在预检库上量到的结论

预检库的造法（`receipt-105.md` §2 有完整命令）：一次性 pgvector:pg17 容器 →
镜像 Supabase 的布局（`extensions` schema 装 vector/pgcrypto，`search_path = "$user", public, extensions`）→
**用现在正在生产跑的那个旧镜像**把它 bootstrap 一遍 → 得到与生产**逐字段相同**的 schema 指纹。
然后拿这次要上的新镜像去升级它。所以这不是「模拟」，是**同一个 artifact 的升级彩排**。

### ① 两轮重放（#100 第 8 步判据）—— 绿

第一轮（容器启动）12 张表 → 13 张、RLS 13/13、索引变非唯一；`docker restart` 跑第二轮，
**指纹逐字段不变、日志零 error**。0008 那句 `CREATE UNIQUE INDEX IF NOT EXISTS` 因为
0020 沿用了同名索引而永久跳过，bootstrap 不炸 —— 票面 §4 要验的就是这一条。

### ② RLS 用**最弱身份**验，且验出了牙口

预检库的连库角色 `avery_pf_owner` 是 `NOSUPERUSER NOBYPASSRLS`，**比生产还弱**
（生产 `postgres` 是 `rolsuper=false` 但 `rolbypassrls=**true**`）。弱角色上成立，强的必然成立。

- 后端在这个身份 + RLS 全开下**读写正常**：一个事务写 contexts+source_documents+ingest_jobs、
  读回、取回原字节、job 状态 `queued`、`empty_context` 成功。
- 孤儿回收对 `queued` 行**一根指头没碰**（回收数 0，行还在 queued）—— #90 的语义在真库上兑现。
- deny-all 真的买到了东西（先种 2 行基线再量，不是空真）：

  | 陌生角色（被误 `GRANT` 过）干的事 | RLS OFF = 今天的生产 | RLS ON = 上产之后 |
  |---|---|---|
  | SELECT 看得见 | **2 行** | 0 行 |
  | UPDATE 改掉 | **2 行** | 0 行 |
  | INSERT | 成功 | `violates row-level security policy` |
  | DELETE 删掉 | **3 行** | 0 行 |
  | 主人事后还剩 | **0 行（数据被外人删光）** | **2 行，完好** |

  ⚠ 对照组（RLS off 的那个库）全程只被 raw SQL 碰过 —— 任何走 registry 的探针都会重放
  0019 把对照组「治好」，那样量到的就是「开 vs 开」。跑完复验过它仍是 `12 张 / 0 on`。

### ③ 🔴 顺带量出一条既有缺陷：稳态 bootstrap 还在锁两张表

方法照 #104：另一个连接持 `avery.<表>` 的 ACCESS SHARE，`lock_timeout=3000`、`retries=1`，
逐迁移文件重放，锁在每次测试前后都复验仍握着。

| 被占住的表 | 新镜像稳态 bootstrap | 哪个文件干的 |
|---|---|---|
| `entities` | **PASS** 0.47s | —（#104 已修） |
| `account_contexts` | **PASS** 0.46s | —（#100 守卫生效） |
| `materials` | **PASS** 0.46s | — |
| `contexts` | 🔴 **BLOCKED** 3.35s | `0011_contexts_ephemeral_gc.sql` |
| `source_documents` | 🔴 **BLOCKED** 3.29s | `0005_source_documents_status.sql` + `0017_...sha256.sql` |
| `entities` / **旧**镜像（born-red 对照） | BLOCKED 3.26s | 0002 的裸 DROP（#104 修之前的形状） |

**这是 #104 那一类 bug 的两个漏网的**：0005 与 0011 都是裸 `ALTER TABLE`，
而 `ALTER TABLE` 在判断 `IF NOT EXISTS` **之前**就取 ACCESS EXCLUSIVE。
常驻门 `test_steady_state_bootstrap_takes_no_table_lock` 只参数化了 `entities` 与
`account_contexts` —— 另外两张从来没被量过，所以一直看不见。

**它不拦这次上产**，理由是实测出来的：0005/0011 早就在**现在生产的镜像**里，
生产每次开机都在这么干，已经这样跑了几个月（对照实验：旧镜像对着 `contexts`/`source_documents`
同样 BLOCKED）。这次唯一的变化是 0017 在**已经被 0005 锁着的同一张表**上多取一次锁，
不引入新的受影响表。
票面正文见 `issue-draft-bootstrap-locks.md`（⚠ 0817 代理连续 EOF，**票还没开成**，待发）。

⚠ 读旧日志的坑：**旧镜像的报错信息里写死了 "could not lock the entities table"**，
哪怕真正卡住的是 `contexts`。#100 已经把这句话改成不点名（真表名在链上的 psycopg 异常里）。
按旧日志的字面去查 entities 会查错方向。

**因此 S5 起新容器之前，值得先看一眼有没有人占着这三张表**：

```bash
sudo -n docker exec avery python -c "
import os,psycopg
c=psycopg.connect(os.environ['AVERY_DB_URL'],autocommit=True)
for r in c.execute(\"select relation::regclass::text, mode, granted, pid, state, now()-xact_start as age from pg_locks l join pg_stat_activity a using(pid) where relation in ('avery.contexts'::regclass,'avery.source_documents'::regclass,'avery.entities'::regclass) and a.pid<>pg_backend_pid()\").fetchall(): print(r)"
```
- 判据：没有 `idle in transaction` 且 `age` 很长的行。有的话先
  `SELECT pg_terminate_backend(<pid>)` 清掉再换容器 —— 那正是 2026-07-23 停摆的形状。

---

## 6 · 这次预检**没有**覆盖到什么（别把它当全绿）

1. **没有真上传、没有真调 LLM。** 预检容器只服务了 `/health` 与 `/demo/status`；
   `/ingest`、`/advise`、`/demo/claim` 一次都没跑。异步 worker 的**执行**那半边
   （claim → parse → extract → merge → finish）在真库上没被驱动过，它的证据在 #90/#95 的
   离线 + needs_db 回执里，不在本次预检里。
2. **没有跑 needs_db 全仓**（~870 s，且 Windows 上会撞临时端口耗尽）。
   `test_upgrade_path_from_the_single_owner_schema` / `test_rls_enabled_on_every_avery_table`
   的绿在 #98/#100 的回执里；本次预检是**更靠上一层**的证据（真镜像 + 真升级路径），不是它的替代。
3. **没有跑前端门电池**（A/B/C 区）。本票只碰后端上产链路。
4. **0017 的 backfill 只量了哈希那半边**（277 行 / 2.83 MiB / 0.010 s，读式测量，没写生产）。
   写那半边（WAL + 新元组）没有单独计时 —— 但基数在这儿，离 30 秒的
   `statement_timeout` 有三个数量级余量。
5. **登录 / Supabase Auth 402 完全没碰。** 它不在这条链路上（§0 ①）。
