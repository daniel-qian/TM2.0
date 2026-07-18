# feat-053 · 账号体系（Supabase auth）· progress

分支 `feat/053-auth` · 工作树 `D:\avery-wt\053` · 2026-07-18

---

## 一句话

Supabase 管注册/登录/登出/会话恢复；我们只在后端维护 `Supabase user → context_id` 的映射，
**`owner_token` 原封不动留在下层**（feat-038 租户隔离零返工）。
**游客路径全程活着** —— 没登录照样能打开、能上传、能问，已实测。

---

## 做了什么

### 后端

| 文件 | 干了什么 |
|---|---|
| `eval-harness/db/migrations/0008_account_contexts.sql` | 新建映射表 `avery.account_contexts(user_id, context_id)`。**`context_id` 上加 UNIQUE 索引** —— "一个 context 最多归属一个账号"由数据库保证，不是靠服务层 if。 |
| `eval-harness/service/account.py` | 新建。校验 Supabase access token → user id。 |
| `eval-harness/service/auth_api.py` | 新建。`GET /account/status`、`GET /account/contexts`、`POST /account/claim`。 |
| `eval-harness/avery/ingest/registry.py` | 内存 registry 加 4 个方法（link/contexts_for/account_for/account_owns）。 |
| `eval-harness/avery/ingest/pg_registry.py` | Postgres 孪生实现，同一套 duck-typed API。 |
| `eval-harness/service/ingest_api.py` | `authorize_context()` 加**可选**第 4 参 `account_user_id`；4 条读端点收 `X-Avery-Account`；`/ingest` 已登录时自动绑定新 context。 |
| `eval-harness/service/app.py` | 挂 auth 路由；`/advise` 走同一条账号支路。 |

### 前端

| 文件 | 干了什么 |
|---|---|
| `src/lite2/auth/supabaseClient.ts` | 新建。懒建客户端；**缺 key → 返回 null**，账号层休眠。 |
| `src/lite2/auth/authStore.ts` | 新建。zustand 会话态 + 中文错误人话化。 |
| `src/lite2/auth/AuthPanel.tsx` | 新建。顶栏账号入口（注册/登录/登出/认领）。 |
| `src/lite2/transport.ts` | 加 `X-Avery-Account` header + 两个账号端点（**可选方法**，见下）。 |
| `src/lite2/LiteTopbar.tsx` | 挂 `<AuthPanel/>`，放在 `.scene-tabs` **之外**（门相位数 tab 数，不能混进去）。 |
| `src/lite2/styles/lite2.css` | 追加 `.lite-auth-*` 样式（沿用既有 token，末尾追加，冲突面小）。 |
| `.env.example` / `eval-harness/.env.example` | 补 Supabase 变量说明。 |

---

## 关键设计决定（含理由）

### 1. 映射口径：`owner_token` 一行没动

`authorize_context()` 加的是**可选**参数，账号支路在前、原 token 逻辑原样在后：

```
account_owns(user, ctx)  → 放行
否则 → 走 feat-038 原逻辑（owner_token 常数时间比对 / 缺错都 404）
```

账号支路**只会放宽到"这个用户确实拥有的 context"**，其余一律回落原路径。
所有 feat-038 既有测试零改动全绿（38 passed）。

### 2. 「认领」而非「登录后新建」（PRD 二选一，选了认领）

**理由**：游客路径是硬要求 → 经理必然是**先传了文件、看到团队之后**才考虑注册。
若注册即新建空 context，等于把"刚刚说服他注册的那份成果"当场丢掉。
认领也不引入新的信任假设：owner_token 本来就是 feat-038 认定的所有权凭据，
认领 = 拿手上的凭据换一个能重新登录拿回来的长效凭据。

同时 `/ingest` 在**已登录**时自动绑定 —— 登录后再上传的不需要手动认领。

### 3. 两个凭据，两个 header（没复用 `Authorization: Bearer`）

`Authorization: Bearer` 已被 feat-038 的 owner_token 占用。
一个 header 塞两种凭据 = 带 A 的调用方被当成 B 校验。
所以账号 token 走独立的 `X-Avery-Account`。🔴 仍然只进 header，绝不进 URL（有测试守着）。

### 4. token 校验交给 Supabase 自己，不本地验 JWT

Supabase 可能用 HS256（旧项目共享密钥）也可能用非对称 + JWKS（新项目），且会变。
本地验 = 引 JWT 库 + 钉算法 + 自己管轮转，只为算出 Supabase 直接就能回答的结果。
所以走 `GET /auth/v1/user`，验过的结果进程内缓存 60s（按 token 的 SHA-256 做键，原始凭据不做字典键、不记日志）。
**全部失败模式一律 fail-closed 返回 None** → 回落 owner_token 支路：只会拒绝，绝不会放行，也不会把游客路径带崩。

### 5. 文案没进 `src/shared/i18n`

那两份是脚本生成的（文件头写着 "Do NOT hand-edit"），本波 8 条线并行往里加键几乎必然撞车。
账号文案就地放在 `AuthPanel.tsx` 的 zh/en 小字典里。合流后由集成方决定要不要收编。

### 6. `transport.ts` 的账号方法是**可选**（`?:`）

`LiveTransport` 有第二个实现 `stubTransport`（AFK 门/离线演示）。加必填方法它就编译不过。
账号是联网后端能力，stub 天然没有 → 调用方判空即降级。

### 7. 恢复逻辑没改 `store.ts`

登录后恢复走 `useLite.setState({contextId})` + `refreshTeam()`，写在 AuthPanel 的 effect 里。
`store.ts` 的 `contextId` 那块 **feat-050 正在改** —— 少碰一行就少一处合并冲突。
而且只在"当前手上没有 context"时才接管，绝不覆盖用户正在看的那份。

---

## 验收怎么过的

### 硬门（都真跑了）

```
$ npm run typecheck          → 零错（tsc -b 无输出）
$ npm run build              → ✓ built in 3.68s
$ python -m pytest tests/ -q → 922 passed, 61 skipped, 8 xfailed
```

8 个 xfailed 是既有的 H4/H6 strict xfail，**不是我这条线引入的**（改动前后同样是 8 个）。

### 新增测试：`eval-harness/tests/test_account_auth.py`（16 passed）

```
$ python -m pytest tests/test_account_auth.py -q  → 16 passed in 2.33s
```

覆盖 PRD 验收「两个账号各自登录只见自己公司；换账号数据不串」：

- 已登录上传 → 自动绑定 → **只凭账号 header（无 owner_token）**读通全部 4 条读端点 + `/advise`
- **账号 B 持有效会话读 A 的 context → 每条路径都 404**（含 `/advise`）
- 两账号各自 `/account/contexts` 只见自己的 id
- 有效会话**打不开无主的匿名 context**（登录不会白送别人没认领的工作区）
- 游客全程无账号 header：ingest + 4 条读端点照常 200
- 认领：正确 token 成功且幂等；**错 token / 未知 id 返回同形 404**（无枚举 oracle）；
  **第二个账号偷已认领的 context → 404**
- 认领后 owner_token **仍然可读**（注册不能把用户自己登出）
- 未配置 Supabase → 账号层休眠：header 被忽略、游客路径原样、账号端点 401
- 账号 token 放进 URL query **不授权**
- 校验器 fail-closed：未配置 / Supabase 不可达都返回 None，不抛进 handler

既有套件回归：`test_tenant_isolation_http.py` + `test_registry_contract.py` + `test_service_http.py`
→ **38 passed, 30 skipped**，一条没跑红。

### 真浏览器实测（起了 5053，已停）

这条线最大的风险是"把 demo 挡在登录墙后面"，所以**没只靠读代码**，真起了 dev server 验：

**未配置 Supabase**（`?v=2&mode=live&skin=paper&lang=zh`）：
```
{"tabs":7, "authPanel":0, "authStatus":"disabled", "bell":1}
```
应用整屏正常渲染中文 v02，上传区可见，**账号入口整块不出 DOM**，console 零报错。

**配了真项目**（`avery-fra` / `zlxpldzapyoacmgvlqpn`，key 只写进 gitignored `.env.local`，验完已删）：
```
{"tabs":7, "authPanel":1, "toggleText":"登录", "authStatus":"guest", "uploadVisible":true}
```
- `authStatus` 从 `loading` 落到 `guest` = **`getSession()` 真的打通了真项目**，URL + publishable key 有效
- 面板展开正常：邮箱/密码输入框 + 登录 + 注册切换 + 游客说明文案
- 布局：弹层 300×301 完整在视口内；375px 窄屏下 x=63/right=363 仍完整、无横向滚动
- 7 个 tab 不变（门相位按 `.scene-tabs .scene-tab` 数 tab，账号按钮在 nav 之外）
- console 零错误

---

## 没做什么

- **多角色权限 / 组织邀请 / SSO / OAuth** —— kickoff 明确不做（Danny：不过度设计、不造轮子）。
- **没往生产库 apply 迁移**。`0008` 只是写了文件。
  ⚠️ 注意机制：`pg_registry._ensure_schema()` 会在下次 DB-backed 启动时**自动重放 `db/migrations/*.sql`**
  （既有设计，不是我加的）。所以这条迁移会在**部署时自动生效**，不需要人手 apply，但也意味着
  合流后第一次连 DB 启动就会建表 —— 集成方知情即可。表是纯增量 `CREATE IF NOT EXISTS`，不动任何现有对象。
- **没创建任何 Supabase 用户**，没动生产数据。所以"两个真账号真登录"这一步是
  **用 stub 掉的 `verify_access_token` 在真 HTTP 层跑的**（16 条测试），
  真 Supabase 的 token 签发/校验环路没有端到端跑过 —— 见下方风险。
- 没动 `package.json` / `feature_list.json` / 根 `progress.md` / 根 `session-handoff.md`。
- 没装任何包（`@supabase/supabase-js` 与 `httpx` 都已预装/已声明）。

---

## 遗留 / 风险（给集成方）

### 1. 🔴 生产库 RLS 全部关闭 —— 本波新引入 anon key，风险等级变了

Supabase advisor 报：`avery.*` **8 张表 RLS 全部 disabled**
（contexts / entities / materials / memory_files / source_documents / company_notes / asks / ask_recipients）。

在 feat-053 之前这不太要紧（只有后端拿直连串访问）。
**现在前端要带 anon key 上线了**，如果该项目的 PostgREST 暴露了 `avery` schema，
任何人拿 bundle 里的 anon key 就能直接读写全部公司数据 —— 绕开我们所有 owner_token / 账号闸。

- **缓解**：PostgREST 默认只暴露 `public`，`avery` 大概率不在暴露列表里 → **我没验证过**。
- **上线前必须做**：确认 Supabase 控制台 → API → Exposed schemas **不含 `avery`**；
  或者给这 8 张表开 RLS + 策略。
- 我**没有自动改**：advisor 明确说不要自动 apply（开 RLS 不配策略会把访问全掐断），
  而且这超出 feat-053 范围。**这条请 Danny 或集成方在部署前拍。**

### 2. 真 Supabase 签发的 token 没端到端跑过

`verify_access_token` 打 `/auth/v1/user` 这一段，测试里是 stub 掉的（不制造生产用户）。
已验证的是：真项目 URL + publishable key 能让浏览器端 `getSession()` 跑通。
**没验证的是**：真 access token 送到后端 → Supabase 回 200 → 拿到 user id 这一环。
代码路径直白（一次 httpx GET + 取 `id`），但**上线前建议 Danny 用两个真账号手动过一遍验收**。

### 3. 需要 Danny 提供 / 拍板的

| 事项 | 说明 |
|---|---|
| Supabase key 落到部署环境 | 前端 `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`；后端 `SUPABASE_URL` + `SUPABASE_ANON_KEY`。项目就用 `avery-fra`（ref `zlxpldzapyoacmgvlqpn`，URL `https://zlxpldzapyoacmgvlqpn.supabase.co`）。**key 我没写进任何 tracked 文件**，控制台 → Project Settings → API Keys 取 publishable。 |
| 邮箱验证开不开 | Supabase Auth 若开了 confirm email，注册后没有 session —— 前端**如实提示去收信**，不做假登录态。三家外部公司试用时若嫌麻烦，控制台可关掉。 |
| 上述 RLS / exposed schema | 见风险 1。 |

### 4. 合并冲突面

| 文件 | 谁可能也在改 | 冲突面 |
|---|---|---|
| `src/lite2/transport.ts` | 多条线 | 中。我加的是 import + header 函数 + 接口可选方法 + 两个新方法，都在既有块之外。 |
| `src/lite2/LiteTopbar.tsx` | feat-051（路由化） | 小。加了 1 行 import + 1 个组件。 |
| `src/lite2/styles/lite2.css` | 多条线 | 小。纯末尾追加。 |
| `eval-harness/service/ingest_api.py` | feat-054/060 | 中。改了 `authorize_context` 签名（**可选参数，既有 3 参调用全部不受影响**）+ 4 个端点各加 1 个 Header 参数。 |
| `eval-harness/service/app.py` | 少 | 小。 |
| `store.ts` | feat-050 | **零** —— 刻意没碰。 |

### 5. bundle 变大

`dist/assets/index-*.js` 现在 **899.70 kB**（gzip 276.63 kB），超 vite 500 kB 警告线。
`@supabase/supabase-js` 本来就在 `package.json` 里但此前**没有任何代码 import 它**，
所以这是它第一次真被打进 bundle。
**我没有测过 feat-053 之前的基线数字**，无法给出准确增量。
若集成后要压包，`supabaseClient.ts` 是天然的 `import()` 动态切分点（账号层本来就允许缺席）。

---

## Notes（范围外发现，没顺手修）

1. **`avery.*` 8 张表 RLS 全关** —— 见风险 1，本波最该先拍的一条。
2. `src/shared/i18n/{en,zh}.ts` 标着 "AUTO-GENERATED … Do NOT hand-edit"，但已有多处
   feat-032/033 的手写键（文件头自己承认）。生成器与实际内容已经分叉，
   建议合流后统一跑一次 directed 生成，否则下一个人还会踩。
3. `src/lite2/transport.ts` 的 `askContexts` 是纯进程内 map（注释已说明刷新即失效）。
   账号体系落地后，ask 端点其实也可以走账号支路免掉这个 map —— 本波没动（不在 053 范围）。
