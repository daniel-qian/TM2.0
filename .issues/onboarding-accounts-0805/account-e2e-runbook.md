# 账号链路 E2E · 跑法与实测回执（onboarding-accounts-0805 ⑤ / 票 #44）

门：`.issues/onboarding-accounts-0805/verify-account-e2e.py`
口径：ADR-0034 拍板 6；凭据墙条文在 `roles.md` 的「凭据墙」一节。

## 它证明了什么（此前没有任何东西证明过）

注册 → 登录 → 建 context → 认领 → **双账号隔离**，全程真 Supabase auth。

在这道门之前，这条链的每一段都只被"隔着一层"验过：后端 pytest 把 `verify_access_token`
整个 monkeypatch 掉，两道前端门（`verify-auth-capability` / `verify-auth-form`）和新加的
`verify-onboard-account` 都是假 key + `page.route` 拦网络。也就是说「**真** token 能不能过
后端的门」「两个**真**账号之间到底隔不隔离」——没人知道。

2026-08-05 开跑前实测坐实了这一点：生产 Supabase 项目 `auth.users` **0 个用户**、
`avery.account_contexts` **0 行**。账号系统上线一年，从来没有人注册过。

## 环境四件套

| 变量 | 是什么 | 缺了会怎样 |
|---|---|---|
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` | 真 Supabase（auth 用真的） | 拒跑 |
| `AVERY_E2E_ADMIN_DB_URL` | Supabase 的 Postgres。只干两件事：确认测试户、删测试户 | **拒跑**（造得出删不掉＝往生产 auth 表留尸） |
| `AVERY_E2E_LOCAL_DB_URL` | **本地** Postgres。context 与 account_contexts 落这儿 | 拒跑 |
| `VERIFY_API` | 本地后端。**硬校验必须是回环地址** | 指向别处直接拒跑 |

两条口径写死在代码里，不靠自觉：**不打生产后端**（回环硬校验）、**不往生产库写**
（数据落本地 pg）。生产 Supabase 只被用来做**认证**这一件事。

env 从**在跑的生产容器**提取（`sudo docker inspect avery`），不要信 `~/avery.env`——
那份曾比在跑容器少 5 个变量（0805 旧账）。

## 跑

```bash
# 1) 本地 pg（feat-030 起就在用的那台）
docker start avery-pg      # postgresql://postgres:avery_local_dev@127.0.0.1:5433/postgres

# 2) 本地后端：auth 用真 Supabase、数据落本地 pg、脑子用 mock
cd eval-harness
AVERY_BRAIN=mock AVERY_EXTRACTOR=heuristic AVERY_EMBEDDINGS=keyword \
AVERY_DB_URL=postgresql://postgres:avery_local_dev@127.0.0.1:5433/postgres \
SUPABASE_URL=<真> SUPABASE_ANON_KEY=<真> \
python -m uvicorn service.app:app --host 127.0.0.1 --port 8337

# 3) 门
PYTHONIOENCODING=utf-8 VERIFY_API=http://127.0.0.1:8337 \
  python .issues/onboarding-accounts-0805/verify-account-e2e.py

# 4) born-red 自证（判据反写成"期望 200"，门必须变红）
PYTHONIOENCODING=utf-8 VERIFY_API=http://127.0.0.1:8337 \
  python .issues/onboarding-accounts-0805/verify-account-e2e.py --born-red
```

🔴 **端口别用 8137**：本机常有别的 worktree 占着它。门开跑前会先问一句
`/account/status`——那台后端如果没挂 Supabase env（`configured:false`），直接拒跑而不是
对着一台错的后端跑出一堆无意义的红。这条判据是本轮实测撞出来的，不是预防性设计。

## 2026-08-05 实测回执

| 项 | 结果 |
|---|---|
| 第一遍 | **19 PASS · 0 FAIL** |
| 第二遍（证清理幂等） | **19 PASS · 0 FAIL** |
| born-red（隔离判据反写） | **18 PASS · 1 FAIL** —— 反写的那条确实红了 |
| 跑完生产 `auth.users` | **0 行**（`auth.identities` 也 0 行）——零留尸 |
| 跑完生产 `avery.account_contexts` | **0 行** |

被证到的关键几条：
- 真 access_token 经后端 `verify_access_token` 换回 user id（这是 pytest 一直 monkeypatch 掉的那一段）；
- 认领后 `avery.account_contexts` 出现绑定行，且 `user_id` 就是那个真 user；
- B 读 A 的 context 得到 404，与读一个**根本不存在的 id** 得到的 404 **同形**（无存在性 oracle）；
- B 拿错 owner_token 认领 A 的 context → 404，绑定没被抢走；
- A 重新登录拿到**新** token 仍列得出——绑定挂在账号上，不挂在某一个 token 上。

## 路上撞到的三个坑（都记着，省下次半小时）

1. **`auth.users.confirmed_at` 是生成列**。写它直接抛
   `column "confirmed_at" can only be updated to DEFAULT`。只写 `email_confirmed_at`。
2. **这个项目的邮箱确认是开着的，而内建 SMTP 每小时只发两封**。本门每遍要两个账号、还要连
   跑两遍＝四次注册，第二个账号当场 HTTP 429。所以门会先真走 `/auth/v1/signup`（那是真实
   用户的路，能走通就走通），撞 429 再退到 admin 造已确认户——**无论哪条路，登录都用真的
   GoTrue**，"真 token 过后端的门"这件事一步没被绕开。
   票面原本的解法是 service_role 的 `admin/users` + `email_confirm:true`；那把 key 不在这台
   机器上（生产容器里也只有 anon），所以换成直接写 auth 库，做的是同一件事。
3. **直接写库造的户登录会 500 `Database error querying schema`**，除非把
   `confirmation_token` / `recovery_token` / `email_change*` / `phone_change*` /
   `reauthentication_token` 一串 varchar 列写成 **空串**。GoTrue 是 Go 写的，把它们扫进非指针
   的 string 字段，NULL 就扫不动。admin API 那条路没有这个坑（GoTrue 自己写的 ''）。

## 门的归属

**不进默认离线电池**（needs_keys 性质：真网络、真凭据、真账号）。`run-battery.mjs` 的 ROSTER
里没有它，也不该有——那份电池的前提是零花费零外网。它是一道**独立 runner**，按本文跑。
