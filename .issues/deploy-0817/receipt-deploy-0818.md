# receipt-deploy-0818 — 后端上产执行回执

> 正源 [issue #105](https://github.com/daniel-qian/avery/issues/105) · 脚本 `runbook-105.md` · 预检实测 `receipt-105.md`
> 执行 2026-08-18 14:17–14:20 CST（服务器本地时区，UTC+8），Danny 在场点头「现在就上」。
> **本次只换后端容器，没有 push。** 前端上一次上产是 0817 晚（`cd6f207`），这次没动。

---

## 0 · 一句话

**后端从 `6b70173`（0812 构建）换到 `cd6f207`，四条迁移落地，全程零 error。**
0817 晚留下的「新前端 + 老后端」错配窗口**已关闭**——前后端现在是同一棵树 `cd6f207`（实测双向确认）。

---

## 1 · 🔴 与 runbook 的一处偏离，以及为什么

runbook S1 写的是「从**本地 main** 走 git bundle 构建」。**实际改成从 `cd6f207`（= `origin/main`）构建。**

原因：上产当天本地 main 已经不是预检那棵树了。`1dd35ce`（预检点）→ 本地 main `4505a39` 之间
多了 **25 个文件 / +4090 行**，全部是 **#106 team map 复活**（`src/lite2/map/*`、i18n、门脚本）。
按 runbook 原样从本地 main 构建，会让这批**未经审阅、也不在本次上产计划里**的前端代码搭车。

于是先把后端子树的指纹逐个比了一遍：

| 子树 | `1dd35ce`（预检） | `cd6f207`（origin/main） | `4505a39`（本地 main） |
|---|---|---|---|
| `eval-harness/avery` | `bf978eae2b7f` | `bf978eae2b7f` | `bf978eae2b7f` |
| `eval-harness/db` | `99215db708d2` | `99215db708d2` | `99215db708d2` |
| `eval-harness/Dockerfile` | `3871b072ef90` | `3871b072ef90` | `3871b072ef90` |
| `eval-harness/service` | `2233d357793e` | `0f4330182a74` | `0f4330182a74` |

`service` 那一格唯一的差异是 `.env.example` 里一段 DeepSeek 停用的注释（运行时不读，`git diff` 逐行确认）。
**后端运行时代码在三棵树上一个字节没差**，所以：

- 从 `cd6f207` 构建 = 构建的就是预检验过的那份后端代码 → **预检证据仍然逐字覆盖本次上产**
- `/health` 报的 SHA 在远端有、且**与线上前端同一个** → 「生产在跑什么」说得清
- **不需要 push** → #106 team map 保持为一个独立决定，没被上产顺手带走

代价：这次上产不含 #102（CAS，未合）与 #106（未 push）。两者都留到下一轮。

---

## 2 · 逐步判据（全部实测值）

### S0 · before 指纹（对照基准）
```
Image     = avery-agent:main-20260812-070519
ImageId   = sha256:f32a7d5624df…
StartedAt = 2026-08-17T11:05:18Z   RestartCount=0   Health=healthy
commit    = 6b70173c46b8eed66c579e28c4204d40cbec17e7
挂载       = bind /home/admin/avery-demo-seed /app/demo-seed false（只读，在）
```
前置：`8138 FREE` · 根分区 `30G` 可用 · 可用内存 `1074M` · `ims-webapp` 在跑（合伙人的，没碰）。

### S1 · 构建
服务器 `HEAD = cd6f207…`、`tree = 72042a9f…`，与本地**逐字相符**；`git status` 空。
构建 **12.5 秒**（依赖层全缓存命中）。
🔴 判据：`AVERY_COMMIT=cd6f20743ca589706afd21ca5a3334aec7bc0d1a`（完整 40 位，不是 `unknown`、不是旧值）。

### S2 · push — **跳过**（前端 0817 晚已上产，本次不动）

### S3 · env + 锁 + 预检

- **锁检查**（迁移要在 `contexts` / `source_documents` 上取 ACCESS EXCLUSIVE）：占用 **0 行**。
  这是 2026-07-23 停摆的形状，先看一眼再动。
- **env = 27 个变量** ✔（0817 晚 DeepSeek 停用后的期望值）
- 丢掉的正好是 10 个：`AVERY_COMMIT GPG_KEY LANG PATH PIP_NO_CACHE_DIR PORT PYTHONDONTWRITEBYTECODE PYTHON_SHA256 PYTHONUNBUFFERED PYTHON_VERSION` ✔
- **DeepSeek 哨兵 = 0 行** ✔（白名单仍留着 `DEEPSEEK_`，哪天有人放回来会在这条上现形）
- 预检容器 8138：**4 秒健康** · `commit` 新 SHA · `degraded:false` · `/demo/status {"available":true,"ready":true}` · 日志 `no errors`

**迁移落地（在换生产之前就验，这样万一 RLS 出岔子旧容器还在）：**

| 判据 | 期望 | 实测 |
|---|---|---|
| RLS on/total | `(13, 13)` | ✔ `(13, 13)` |
| 🔴 forced | `0` | ✔ `0` |
| policies | `0` | ✔ `0` |
| `account_contexts_context_key` 唯一性 | `False` | ✔ `(False,)` |
| `avery.ingest_jobs` 存在 | `True` | ✔ `True` |
| `source_documents.content_sha256` 列 | `1` | ✔ `1` |
| 连库角色 | `postgres`, bypassrls | ✔ `('postgres', False, True)` |
| `contexts` 行数 | 116（未变） | ✔ `116` |

`rolbypassrls=True` 是 RLS 不会锁死后端的**直接实测证据**，不是推理。
（`forced=0` 同样关键：FORCE 会把 deny-all 对准后端自己，症状长得像静默数据丢失。）

### S4 / S5 · 换容器
🔴 **先停旧再起新**（新容器启动跑孤儿回收，旧容器还在跑的话它 `processing` 的 job 会被误标 failed，#90）。
- 判据 `ps` 里已无 `avery` ✔
- 判据 回滚梯就位 `avery-prev-20260818-141707` ✔
- 判据 新容器 **4 秒健康**（预检实测 2.3 s，同量级）✔
- 脚本带自动回滚（40 秒不绿就退回旧容器）——**没触发**

### S6 · 外网复验（走 Caddy，不是本机回环）

```
https://avery.dannyqian.com/health       200
  commit           = cd6f20743ca589706afd21ca5a3334aec7bc0d1a   ← 新（旧值 6b70173）
  degraded         = False
  extraction_chain = ['minimax']          ← 单家，与 0817 停用 DeepSeek 后的口径一致
https://avery.dannyqian.com/demo/status  200  {"available":true,"ready":true}
```
- 容器 `Up (healthy)`，日志 `no errors`
- 判据④ 用**新**容器再验一遍迁移：`(13,13)` · `forced=0` · `uniq=False` · `contexts=116` · `ingest_jobs=0` ✔
- 判据⑤ 前端：`/assets/index-C9CFgX2H.js` 里的 commit = `cd6f207…`
  🔴 **前后端同一棵树 = true**（⚠ SHA 在主包里，不在 `index.html`——它只有 736 字节，按旧碑去 grep index 会空转到超时然后误判成「没构建」）

### S7 · 收尾
- `shred -u /tmp/avery_env_20260818-141707` ✔（本轮的自己收干净）
- `rm -rf /home/admin/build-0818` ✔
- 在跑的只剩 `avery` + `ims-webapp` ✔
- 回滚梯 `avery-prev-20260818-141707` **保留**

---

## 3 · 回滚（30 秒内，暂不需要）

```bash
TS=20260818-141707
sudo -n docker rm -f avery && sudo -n docker rename avery-prev-$TS avery && sudo -n docker start avery
```
**库不跟着回滚，也不需要**——旧代码在新 schema 上照跑，逐条理由见 `runbook-105.md` §4。

---

## 4 · 上产**没有**覆盖到什么（别当全绿）

1. **没有真上传、没有真调 LLM。** `/ingest`、`/advise`、`/demo/claim` 一次没跑。
   异步 worker 的执行那半边（claim → parse → extract → merge → finish）在生产上**没被驱动过**。
   它的证据在 #90/#95 的离线 + needs_db 回执里。**第一次真上传是这次上产真正的首验。**
2. **没点过示例团队。** `/demo/status` 说母本在（`ready:true`），但没有真 claim 过一次。
3. **前端 #106 team map 没上**（11 个提交未 push），#102 CAS 未合。
4. **既有缺陷仍在**：稳态 bootstrap 还在锁 `contexts` / `source_documents`（0005/0011 的裸 `ALTER TABLE`）。
   本次实测新容器 4 秒起来，不拦上产；票在 **#108**。

## 5 · 一条过期的碑要划掉

`runbook-105.md` §0① 与 #105 票面写着「登录仍然是坏的，Supabase Auth 回 402」。
**上产当天实测已不成立**——Danny 已升级 Supabase。0818 探针：

```
① disable_signup === true                    HTTP 200
② 直连 /auth/v1/signup 拿到真 4xx            HTTP 422
③ 响应体无 user id / access_token            {"code":422,"error_code":"signup_disabled",…}
3 PASS · 0 FAIL
```

即：**Auth 服务活着，登录能用；注册是被 Danny 主动关掉的**（#101 的产品决定，早于额度问题）。
⚠ 但 `test-accounts/` 里**一个账号都还没建**（只有 README + .gitignore）。
`scripts/ops/create-account.mjs` 在，演示前要真跑一次建号。
