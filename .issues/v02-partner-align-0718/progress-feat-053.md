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

覆盖 PRD 验收「两个账号各自登录只见自己公司；换账号数据不串」——
🔴 **口径更正（复核指出，见文末「复核修复」一节）**：以下证据全部成立在 **HTTP/服务端层**。
初版这句话把成立范围写宽了：服务端隔离为真，**浏览器层当时并不成立**（同一浏览器换账号会串）。
前端那一半在复核后已补上并单独验证，见文末。

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

---

# 复核修复（feat-053 第二轮）

复核判定 `needs-fix`：1 条 major + 3 条 minor。**四条全修，无 skipped。**

## finding 1（major）· 换账号后旧数据串台 —— 已修

**复核说的问题**：验收里「换账号后旧数据不串」这条，服务端为真、**浏览器上是空转的**。
经理 A 登录 → 上传公司 A → 登出 → 经理 B 在同一标签页登录，结果 B 看到的是 A 的人和项目；
更糟的是 localStorage 里 A 的 `owner_token` 还在，B 一刷新服务端凭那枚 token 就放行 200 ——
不是陈旧渲染，是**活的读权限**。三家外部公司共用一台机器演示时会当场串数据。

**我复核这条判定：成立，且严重性没被夸大。** 根因是两处：

1. `signOut` 只把 `status` 改成 `'guest'`，`useLite` 一个字段都没清 → 恢复副作用里
   `if (useLite.getState().contextId) return` 命中 A 的旧 contextId 直接 bail，B 的数据永远接管不了。
2. `owner_token` 存在 `localStorage['lite2:ownerTokens:v1']`，登出不清。

修的时候发现**还有第三处复核没点出来的**：`createHttpTransport` 把 token map 存进了**闭包**
（`const tokens = loadTokenStore()`）。就算把 localStorage 抹干净，已经建好的 transport 实例
手里那份内存副本还在，`authHeader` 会继续发上一个账号的 owner_token。只清 localStorage 是修不掉的。

### 改法

| 文件 | 改动 |
|---|---|
| `src/lite2/transport.ts` | token map 从闭包提到**模块级**（`tokenStore()` 每次现取，绝不存进闭包）；新增导出 `forgetAllOwnerTokens()`，内存 + localStorage 一起抹 |
| `src/lite2/auth/AuthPanel.tsx` | 新增模块级 `clearCompanyScope()`；新增「换人即清场」副作用 |

`clearCompanyScope()` 清：`contextId` / `ownerToken` / `team` / `rawTeam` / `files` / `notes` /
`noteJustAdded` / `ingestStatus` / `ingestError` / `detail` / `screen`，并调 `resetRun()`
（abort 在飞的 `/advise` 流 + 清 ask 草稿）。**先掐凭据再清数据**——顺序反过来的话，
中间那一拍已在飞的请求仍带着旧 token。

**两个刻意的取舍**：

1. **owner_token 整份清，不是只清当前那条**（复核建议只清当前 context 那条）。
   登出的语义是"这台浏览器上不再留我的凭据"；只清手上这条的话，早先几次上传留下的 token
   仍躺在 localStorage 里继续是活的读权限。代价：游客期传过、又始终没点「绑定到我的账号」的
   context，登出后找不回来了 —— 共享浏览器不该留下活凭据，面板里的绑定按钮就是留住它们的正路。
2. **清场判据收得很窄**：只有「上一个身份是某个登录用户」且新身份与它不同时才清。于是
   · 首帧 `loading→authed`（刷新页恢复会话）：不清 —— 不误伤自己的数据，也不会反手清掉
     feat-050 正在做的会话恢复；
   · **游客→登录：不清** —— 游客期刚传的东西不能被登录动作吞掉，整条认领路径就建立在这上面；
   · 登录→登出、A→B 直接换会话：清。

`clearCompanyScope` 放在 AuthPanel 的模块层而不是 authStore：authStore 若 import useLite 就成环
（authStore → store → transport → authStore，transport 要拿 `currentAccessToken`）。
AuthPanel 本来就是连接账号态与公司数据的那一层，是唯一不成环的落点。

### 这条是**跑过的**，不是读代码读出来的

项目没有前端单测框架（且不许装），所以用仓里现成的 esbuild 把 `transport.ts` / `store.ts` /
`AuthPanel.tsx` 打成 node 可跑的包，桩掉 `localStorage` 和 `fetch`，真跑了一遍：

```
$ ./node_modules/.bin/esbuild <harness>.ts --bundle --format=esm --platform=node \
    --outfile=<harness>.mjs --define:import.meta.env='{}' && node <harness>.mjs

PASS  before sign-out: owner_token IS sent for ctx-A
PASS  after sign-out: owner_token is GONE on the same transport instance
PASS  after sign-out: the OTHER company token is gone too
PASS  after sign-out: localStorage entry removed
PASS  a newly built transport does not resurrect the token
PASS  after sign-out a NEW upload still gets a working token
PASS  the new token is persisted for a reload
PASS  the cleared account is NOT back in storage
PASS  clearCompanyScope empties every company field
PASS  clearCompanyScope drops the stale detail overlay

ALL PASS
```

第 2 条就是上面说的闭包 bug —— 修之前它是 FAIL。

**harness 没有提交**（改完即删，工作区干净）。理由：项目刻意没有前端测试基建，11 路合流
不是单方面引入一套的时候，而一个不挂在任何门上的脚本必然腐烂。全文存档在
`scratchpad/scope-check.ts`，要复现照上面那条命令跑即可。

**诚实边界**：runtime 验的是 ①owner_token 抹除 ②`clearCompanyScope` 真把 store 清空 —— 也就是
这条 finding 的安全实质。**React 副作用的接线本身（身份变化 → 触发清场）只经过代码审查 +
typecheck + build，没有在真浏览器里点过**（无真 Supabase 用户，见下）。判据是一个 4 行的纯逻辑
（`prev && prev !== identity`），但我没有跑过它，不说跑过了。

## finding 2（minor）· 对着已绑定的数据说「还没绑」—— 已修

`canClaim` 此前压根不看绑定状态，于是已登录状态下上传（后端 `/ingest` 当场就绑好并回
`account_linked: true`）也照样弹「当前这份公司数据还没归到账号名下」——对客户说的一句假话。

改法：`transport.ts` 的 `LiveTeamPayload` 补上 `account_linked?: boolean`（此前类型里没有这个键）；
AuthPanel 用三个**真判据**算 `attached`：认领成功 / `/account/contexts` 里有它 / 上传时回了
`account_linked`。绑定状态记在组件 state 而不是每次现读 `rawTeam` —— `rawTeam` 会被后续
`refreshTeam` 覆盖，而 `/team/{id}` 刷新帧不带 `account_linked`，只看 rawTeam 的话这个事实会凭空消失。
顺带：`已绑定到你的账号` 这句现在对上述三种情况都显示，不再只认「本次点过认领」。

## finding 3（minor）· docstring 声称受 exp 封顶、代码固定 60s —— 已修（**改代码，不是改注释**）

复核给了两条路（把 TTL 真按 exp 封顶 / 把 docstring 改成实话）。**选了改代码**：注释描述的
那个性质本身是对的，失效窗口是真的（一枚还剩 2 秒的 token 能继续授权 58 秒）。

新增 `_unverified_exp()`：不验签直接读 JWT payload 里的 `exp`。**不验签是安全的**——这个数只
用来把缓存**变短**，从不用来授权；调到这里时 Supabase 已经对这枚 token 说过 yes 了。伪造的 exp
只能让我们更早去问一次（多一个 round trip），永远不能延长信任。验签则要拖进模块 docstring 里
明确拒绝拥有的那套 JWT 库 + 密钥轮换。

`_cache_ttl_for()` = `min(60s, exp - now)`；已过期的 token TTL ≤ 0，`_cache_put` 直接不存
（这一次仍然放行——Supabase 刚说它是好的——但拒绝记住这个答案）。docstring 同步改成实话，
并点明 `exp` 来自 token 本身而非 `/auth/v1/user` 响应（那个端点返回 user 对象，本来就不带 exp）。

**补了 6 条测试**（既有套件在 `verify_access_token` 这个接缝上打桩，所以这段本来零覆盖）：
读 exp、四种读不出来的降级、`exp: true` 这种 bool 混入（bool 是 int 子类，不单独挡就会被
`float(True)` 悄悄把缓存封到 1970）、2 秒 token 只缓存 ~2 秒、长命/不透明 token 走回 60s 平窗、
以及端到端「已过期 token 每次都重新问 Supabase / 长命 token 只问一次」。

## finding 4（minor）· 恢复失败后永久不再重试 —— 已修

`restoredFor.current = userId` 置在 fetch **之前**，失败只 `setRestoreError(true)`，于是后端恰好
在重启、网抖一下，就等于这一整个会话内恢复再也不会跑（守卫已占位，deps 也不会再变），用户只能 F5。

改法两步（缺一不可）：① 守卫改成**成功才置位**，另用 `restoreInFlight` ref 挡并发；
② 光清守卫并不会让 effect 重跑 —— 加了 `restoreAttempt` 计数 state 作为 effect dep，
失败时面板出一个「重试 / Try again」按钮，点一下 +1 触发重跑。这才是复核说的"重试入口"。

（重试按钮**没有**按 `restoreInFlight` 置 disabled：那是个 ref，render 里读它不会随变化重渲染，
只会渲染出一个可能已过时的禁用态。并发在副作用里已经挡住了，最坏结果是用户多点一下。）

## 门（全部重跑，全绿）

```
$ npm run typecheck                       → 零错（tsc -b 无输出）
$ npm run build                           → ✓ built in 3.86s（900.78 kB / gzip 276.87 kB）
$ python -m pytest eval-harness/tests -q  → 931 passed, 61 skipped, 8 xfailed
$ python -m pytest eval-harness/tests/test_account_auth.py -q → 25 passed
```

931 = 复核那轮的 922 + 本轮新增 9 条（6 条 exp 封顶 + 3 条参数化降级用例）。
**一条既有测试都没跑红**，skipped / xfailed 数字与复核那轮一字不差。
bundle 从 899.70 kB 涨到 900.78 kB（+1.08 kB），是本轮新增逻辑。

## 本轮改的文件

- `src/lite2/transport.ts` —— token map 提模块级 + `forgetAllOwnerTokens()` + `account_linked` 字段
- `src/lite2/auth/AuthPanel.tsx` —— `clearCompanyScope()` + 换人清场副作用 + attached 判据 + 重试入口
- `eval-harness/service/account.py` —— `_unverified_exp()` / `_cache_ttl_for()` + docstring 改成实话
- `eval-harness/tests/test_account_auth.py` —— +9 条（16 → 25）
- 本文件 —— 口径更正 + 本节

## 仍然遗留（本轮没解决，交接）

1. **无真 Supabase 用户，token 签发 → 后端校验的环路仍未端到端跑过。**（与复核那轮同）
   需要 Danny 在 Supabase 后台建一个测试用户，或给一份能注册的项目 key。
2. **React 副作用接线未在真浏览器点过**（理由见 finding 1 的诚实边界）。
   集成方拿到真 key 后，值得手点一遍：A 登录上传 → 登出 → B 登录 → 确认 B 看不到 A 的数据、
   且刷新后仍看不到。
3. **跨标签页**：两个标签同时开着、其中一个登出时，另一个标签靠 supabase-js 的 `onAuthStateChange`
   跨标签广播收到 status 变化，从而各自跑自己的 `clearCompanyScope`。**这条是推理，没验过。**
4. 复核对上线风险 1（前端 anon key）的更正已确认：`anon`/`authenticated` 两个角色对 `avery`
   schema 连 USAGE 都没有，RLS 在这里是空转的，**不构成上线阻断**，降级为配置卫生待办。
