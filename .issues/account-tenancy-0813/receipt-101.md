# receipt-101 · 冻结注册门 + 建号脚本（2026-08-13）

> 正源 issue #101。与 #99/#100 并行，改动面不重叠（本票零 Python，见 §7 的并发线说明）。
>
> **结论先行：三层里的 ②③ 已落地并被门守住；① 那道唯一的真闸——Supabase 后台的
> `disable_signup`——2026-08-13 探测时仍是 `false`，也就是「还开着」。**
> 只有 ②③ 的世界里，注册**是化妆不是安全**：anon key 就在浏览器 bundle 里，任何人
> `POST /auth/v1/signup` 照样能给自己开号。等 Danny 关了闸再回来把 §1 那条改成事实。

---

## 0 · 真闸状态（🔴 未落）

| 项 | 值 |
|---|---|
| 探测时刻 | 2026-08-13 **15:44 UTC** 开工时探一次，**16:24 UTC** 收尾复探一次，两次同结果 |
| 读数 | `GET /auth/v1/settings` → `disable_signup = **false**`、`mailer_autoconfirm = false`、`external.email = true` |
| 判据脚本 | `node .issues/account-tenancy-0813/probe-signup-frozen.mjs` → **0 PASS · 1 FAIL**（born-red，见 §3） |
| 要 Danny 点哪 | Supabase Dashboard → Authentication → Sign In / Providers → 关掉 **Allow new users to sign up** |
| 关完怎么复核 | 再跑一次上面那支探针。它会从 1 条判据变成 3 条并全绿（②③ 只在 ① 为真时才跑，理由见 §3） |

探测用的是**线上 bundle 里那把 anon key**（脚本自己从 `averylite.dannyqian.com` 的 index
chunk 抠），不是我另外找的一把——问的就是「客户浏览器手里那把钥匙能不能注册」。

---

## 1 · 三层，各自落在哪

| 层 | 状态 | 落点 |
|---|---|---|
| ① Supabase 关 signup | 🔴 **未落**（只有 Danny 能点） | 见 §0 |
| ② 前端撤注册入口 | ✅ 已落 | `AuthPanel.tsx` / `authStore.ts` / `lite2.css` / `en.ts` / `zh.ts` |
| ③ 收掉那句假话 | ✅ 已落 | `authVerifyNote` 退役 + 产生它的整条路径删除 |

### ② 撤了什么（逐处）

- **`AuthPanel.tsx`**
  - `mode: 'signin' | 'signup'` 状态整个删掉。留着它只剩一个取值，等于给下一个人留一条
    「把切换按钮加回来就能用」的现成开关。
  - `.lite-auth-switch` 切换按钮（票面 `:473`）删除。
  - 提交键文案的 `mode === 'signup' ? …` 分支（票面 `:460-466`）拍平成 `c.authDoSignIn`。
  - 密码框的 `minLength={6}` 与「至少 6 位」提示一并删。**这两个是注册期的东西**——它们约束
    的是「你要设一个什么样的新密码」。登录框里 `minLength` 只会把密码短于 6 位的人挡在提交
    之前，弹一句浏览器原生的英文校验气泡（我们自己的中文 humanize 报错根本轮不上）。
    密码现在由 `admin.createUser` 那侧生成，前端无权也无需对它的形状发表意见。
  - `autoComplete` 从 `mode === 'signup' ? 'new-password' : 'current-password'` 定死成后者。
- **`authStore.ts`** —— `signUp` **整个删除**，不是「留着但 UI 不可达」。
  票面允许两种处置（删 / 留但 docstring 自陈测不到），选删的理由：一个没人能走到的 `signUp()`
  会诱使下一个人写出**伪造网络响应直接调它**的判据——那是一条永远绿的空判据，测的是函数自己
  不是产品。删掉就把这条路一起焊死了。跟着走的还有 `pendingVerification` 字段、
  `busy: 'signing-up'` 这个取值，以及 `humanizeAuthError` 里两条**只可能从 signup 回来**的
  分支（「这个邮箱已经注册过了」「密码太短了」——`signInWithPassword` 对错密码一律回
  `invalid_credentials`，既不评论密码长度也不承认某个邮箱存在，那正是防枚举设计）。
- **`lite2.css`** —— `.lite-auth-hint`、`.lite-auth-switch` 两条规则删除；
  `.lite-auth-secondary` 的两条规则原样保留（只是从选择器列表里摘掉了 `.lite-auth-switch`）。
- **i18n（en + zh 各 5 个键）** —— `authDoSignUp` / `authSwitchToSignUp` / `authSwitchToSignIn`
  / `authVerifyNote` / `authPasswordHint`。`i18n-orphans` **0 孤儿**（1086 个叶子键 / 129 个文件）。

### ③ 那句假话为什么必须连状态一起拆

#94 实测：已注册且已确认的邮箱再走 signup，Supabase 回 **200 + 一个假 user id**（防枚举
伪装成功）→ `authStore` 判「有 user 没 session」→ `pendingVerification = true` →
屏幕上出「注册成功。去邮箱点一下确认链接」。**这条提示只可能在说谎时才亮**：真正需要它的
「新邮箱注册待验证」在方案 A 里根本不存在（号都是手工建的已确认户）。所以退役的不只是文案，
是产生它的那条状态。

---

## 2 · 死针探测（开工第一件事）

扫的范围：`git ls-files "*verify-*.mjs"` 全量 **61 个文件** + `scripts/gates/live-frontend-gate.snippet.js`
（⚠ 它**不在**那个 glob 里，是既有的改判扫描暗区，票面点名要单独扫）。
词表：`signup|sign-up|sign_up|注册|regist|lite-auth-switch|pendingVerification|authVerifyNote|authDoSignUp|authSwitchTo|authPasswordHint|已经注册过|密码太短|至少 6 位|minLength|lite-auth-hint`。

| 落点 | 命中 | 处置 |
|---|---|---|
| `verify-auth-form.mjs` | `:273` 一条 + `:431-490` 整个 ④ 段 + 头注释两处 | 见 §3 逐条改判 |
| `scripts/gates/live-frontend-gate.snippet.js` | **0 命中**（整个文件搜不到 signup / 注册 / `lite-auth-*`） | 无需改动。暗区这次是空的 |
| 其余 60 个 `verify-*.mjs` | 只有 `verify-auth-capability.mjs:178` 一句**注释**（「绝不为了造这个条件去注册真账号」），无判据 | 不动。该门 25/25 原样全绿 |
| `verify-button-family.mjs:50` | 白名单里只有 `.lite-auth-toggle`，没有 `.lite-auth-switch` | 不受影响 |
| `feature_list.json` | 0 命中 | — |

另外查过：全仓没有任何门逐字断言 `minLength` / 「至少 6 位」/「这个邮箱已经注册过了」/
「密码太短」——所以那几处删除不打任何既有判据（同 receipt-94 §3 改文案前的同款查法）。

---

## 3 · 两道 auth 门的改判（逐条理由 + born-red 实证）

### 3.1 `verify-auth-form.mjs`：57 → **63 判据 · 0 FAIL**

| # | 位置 | 旧 | 新 | 为什么 |
|---|---|---|---|---|
| 1 | ① 段 `:273` | 正向「注册（signup）切换入口**在**」 | 反向「`.lite-auth-switch` count === 0」 | 不是「删掉就绿了」——这条判据现在**判反了**：入口存在才是缺陷。反向判据的空真风险由同块的四条兄弟判据（弹层在/邮箱框在/密码框在/提交键在）挡住：面板没渲染的话那四条先红 |
| 2 | ④ 段整段 | 5 条（切到注册模式 → `pendingVerification` → 屏上出「去邮箱点确认链接」→ 仍是表单） | 10 条，四层反向判据 | 旧 ④ 里有 3 条断言的是**已被产品判掉的行为**，留着必红且守错方向。新 ④ 见下 |
| 3 | ⑧ 段 | 只有中文侧的文案判据 | +1 条「EN 态面板里没有 `Sign up`」 | ①/④ 跑的都是 zh 构建，「没有『注册』二字」这条对英文界面**天生够不着**（碑上「门语料全 ASCII 盲点」的镜像面：只有中文语料同样是盲点） |

新 ④ 的四层，每层为什么单独存在：

- **a 入口层（3 条）**：切换键找不到 + **表单里只剩「登录」一个动作键** + 面板文案里没有「注册」二字。
  只查 class 会被「换个 class 加回来」绕过，所以再从**动作键数量**和**文案**两个正交角度各钉一条。
  （动作键数量那条将来加「找回密码」会红——那是想要的效果，逼一次显式复议，不是误报。）
- **b store 层（2 条）**：`typeof signUp === 'undefined'` + `'pendingVerification' in state === false`。
  这层守的是「别留死枝」本身：如果 `signUp` 只是 UI 够不到，下一个人就会写出伪造响应直接调它的
  永远绿的空判据。判它**不存在**，就把那条路一起焊死。
- **c 网络层（2 条，陷阱上膛）**：`/auth/v1/signup` 的 route 照旧挂着，回的**正是 #94 那份假成功**
  （200 + 假 user id，一字未改）。它不是拿来用的，是拿来**等**的。配阳性对照
  `tokenHits + signupHits >= 1`（证明表单真的被驱动了）。
- **d 文案层（2 条）**：屏幕上不再出现「去邮箱点一下确认链接」+ 提交失败后仍是登录表单。

🔴 **「直连 signup 拿到的是真错误不是假成功」为什么不在这道门里**：本门整条 Supabase 链路是
`page.route` 伪造的。在这里断言它等于让被测对象自己写答案（碑：*判据的期望值不许由被测函数
算出来*、*尺子长在被量的东西上*）。它的落点是 §3.2 那支打真 Supabase 的活体探针。

### 3.2 born-red：**我自己的门第一版有两条是空的，是 born-red 逮到的**

方法：把 5 个 src 文件的字节存到 scratchpad → `git checkout --` 只还原这 5 个（**不碰
并发线 #99 的文件**，也不用 `git stash`——碑：stash 是仓库全局的）→ 跑门 → 按 md5 写回。

**第一轮 born-red：7 红 / 9 条新判据。两条没红：**
- 「全程零次请求打到 `/auth/v1/signup`」
- 「屏幕上不再出现『去邮箱点一下确认链接』」

病根：④ 段的驱动只**提交了一次登录表单**，没有点那个（在缺陷世界里存在的）切换键——于是
模式没切到注册，提交自然打的是 token 端点。陷阱上着膛却没人去碰它。阳性对照 `tokenHits` 也
救不了：它只证明「登录被驱动了」，不证明「所有能走的路都走过」。这正是碑上那条
*一条变异红一条判据 ≠ 它也能红旁边那条*。

**修法**：驱动改成「把表单里除提交键以外的**每一个**键都先点一遍，再填、再提交」。缺陷世界里
这一圈点击会把模式切到注册，提交打到 signup，陷阱当场响。同时把落定条件从「死等 `error`」
改成「`busy` 回 idle 且有了结果（error **或** pendingVerification）」——死等 error 会在缺陷
世界白吃满 5s 超时，然后拿一屏**还没渲染完**的东西去判 d，那又是一层空真。
阳性对照也改成 `tokenHits + signupHits >= 1`（不然对照自己会跟着红，读日志的人分不清
「没驱动到」还是「驱动到了别处」）。

**第二轮 born-red：9 红 / 9 条**，且证据是真的：
`tokenHits=0 signupHits=1`（陷阱响了）、屏上原文抓到「注册成功。去邮箱点一下确认链接，然后回来登录。」

**写回后复跑：63 PASS · 0 FAIL**（md5 核对过还原无误）。

### 3.3 `verify-auth-capability.mjs`：**25/25，零改动**

死针探测只在它里面命中一句注释，无判据咬着注册。它守的是「入口该不该出现」（能力探测三态），
与本票正交。

### 3.4 新增活体探针 `probe-signup-frozen.mjs`（真闸的判据落点）

三条判据：① `disable_signup === true`（真闸读数）→ ② 真实 `POST /auth/v1/signup` 拿到 4xx
→ ③ 响应体里没有 user id / access_token（**不是** #94 那份 200 + 假成功）。

🔴 **②③ 只在 ① 为真时才跑**，因此它**不可能建出账号来**：① 为假就是「一次真实 signup 会真的
建出一个用户」的世界，这时脚本一个请求都不发、直接判红收工。安全性由判据本身守着，不靠人记得。

⚠ 需要公网，**不进 `./init.sh`、不进离线电池、不进 run-battery**——断网时它只会假红。
今天的读数：**0 PASS · 1 FAIL**（born-red，因为真闸还开着）。

---

## 4 · 建号脚本 `scripts/ops/create-account.mjs`

`supabase.auth.admin.createUser({ email, password, email_confirm: true })` —— **一步建成已确认**，
不再需要 #94 那第二步（SSH 进生产容器改 `auth.users.email_confirmed_at`），也不发确认信。

| 项 | 做法 |
|---|---|
| 邮箱 | `<公司代号>@avery.dannyqian.com`（自有域名；`avery.com` 是他人的真实域名，不往那儿发信） |
| 密码 | 24 位强随机（`crypto.randomInt`），字符集**剔掉 `0/O/1/l/I`**——这串要被人读、抄、念给客户，把 l 看成 1 的代价是一通电话。该集合下 24 位仍约 137 bit |
| 输出 | `test-accounts/<代号>.md`（目录整个 gitignore，两道：根 `.gitignore` 的 `/test-accounts/` + 目录内 `*`）。格式照该目录 README，另加 `user_id` |
| service_role key | 只从 `SUPABASE_SERVICE_ROLE_KEY`（或 `..._FILE`）进来。**绝不做命令行参数**（会进 shell history）、绝不落仓、绝不进 bundle（`vite.config.ts` 的 `envPrefix` 只放行 `VITE_AVERY_*`/`VITE_SUPABASE_*`，`verify-bundle-privacy` 守着；脚本住在 `scripts/ops/` 不在 `src/`） |

### 四道自己守着的闸（都实测过）

1. **拿错 key 当场判死**：`sb_publishable_*` 或 role 不是 `service_role` 的 JWT 直接拒——
   否则表现是一串看不懂的 401/403，能查半天。
2. **已存在的 `<代号>.md` 绝不覆盖**：Supabase 读不出密码，覆盖等于把这家公司唯一那份凭据销毁掉。
   而且**先查文件再建号**——反过来的话密码已经生出来了却没地方记。
3. **非自测模式要从 stdin 把公司代号敲回来**。非交互环境（agent 的 Bash）读到 EOF 直接中止。
   这是 0805 凭据墙那条纪律的落地：**真实公司账号那一下归 Danny 人手**，agent 只能跑 `--self-test`。
4. **`--delete` 只认 `avery-e2e+*@dannyqian.com`**：销毁类动作对真实账号一律拒绝，留给人在后台点。

### 自测跑到哪一步（🔴 有一段没验到，如实记）

**验到了**（对着本机一次性替身 GoTrue，`scratchpad/fake-gotrue.mjs`）：
`--self-test` 四条判据全绿（建号成功 → `email_confirmed_at` 非空 → 建完当场真登录拿到同一个
user id → 删掉并**再查一次列表**确认真没了），退出码 0；上面四道闸逐条实测（退出码都对）；
完整建号落盘的内容与格式；重跑不覆盖且**不会多建一个号**。
替身是**真判别器**不是橡皮图章：不带 `email_confirm` 时它回 `email_confirmed_at: null`，
所以「建出来是已确认态」这条只有脚本真的发了那个参数才会绿。

🔴 **没验到的那一段：真 Supabase 那条路。** `--self-test` 需要 service_role key，而那把 key
是**绕过一切 RLS 和 signup 开关的万能钥匙**，本机没有、也不该让它出现在会话里。所以以下三件事
仍然是「按文档应当如此」，不是「实测如此」：真 Supabase 收不收我们这个 payload、
`email_confirm: true` 在真库里是否即刻已确认、真 service_role 是否被接受。
**交回 Danny：带上 key 跑一次 `node scripts/ops/create-account.mjs --self-test` 即可**
（约 10 秒，全程只碰 `avery-e2e+*`，跑完自己删干净、`auth.users` 零净增）。

### 顺手逮到的一个真 bug（不修的话 Danny 会判反）

`process.exit(0)` 跟在 supabase-js 一轮真会话之后，**Windows / Node v24 上 libuv 会炸**
`Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)`，进程**退 127**——也就是**全绿的自测
会以「失败」的退出码收场**，谁拿 `$?` 判都会判反。确定性复现（连跑两次同款），最小复现里
只有「supabase-js 走完一轮 + `process.exit(0)`」两个要素，跟脚本逻辑无关。
改法：全脚本一次 `process.exit()` 都不调，只置 `process.exitCode` 让事件循环自然排空
（实测立刻就空，不挂）。`mkaccounts.mjs` 同款处理，两处都写了注释钉住理由。

---

## 5 · #94 彩排的副作用（票面 §4）

**病灶不在彩排脚本本身**——`rehearsal*.mjs` 里一次 signup 调用都没有（它们走 password grant +
登录表单，注册冻结后照常跑）。真正用 signup 建号的是 receipt-94 §0「建法」描述的那套
**scratchpad 三件套**（`signup.mjs` + `pgconfirm.py`，不在仓库里）。关闸后**第一步就被真闸挡死**，
而且报错完全不像「注册关了」——下一轮会莫名其妙红在「连号都建不出来」。

处置：

- **新增 `.issues/ingest-root-cause-0812/e2e-94/mkaccounts.mjs`**（进仓、可复用）：用
  `admin.createUser` 按当天日期建 A/B 两个 `avery-e2e+<YYYYMMDD>{a,b}@dannyqian.com`，
  一步已确认，产出的 `creds.json` 形状与 `rehearsal.mjs` 期望的**逐字段对齐**
  （`{supabaseUrl, anonKey, apiBase, appBase, accounts:[{tag,email,password,userId}]}`，
  对着替身端到端跑过一遍）。它还会判一下「建出来的真是已确认态」——`email_confirm` 没生效的话
  彩排会死在 `Email not confirmed`，那个错长得像密码错，能查半天。
  凭据落 scratchpad；即便手滑写进本目录，`.gitignore` 的 `*.json` / `*creds*` 两道通配都挡着。
- **就地更新 `receipt-94`**：§0「建法」那格标注作废并写上现行建法（表格里保留旧文划删除线，
  让「为什么变了」看得见）；§0「彩排脚本」那格补上 `mkaccounts` 与「登录动线不受冻结影响」的说明；
  §5.1 那条产品事实标注**已处置（#101）**并指回本回执 + 真闸探针；§7「下轮复用姿势」三步全部重写
  （建号走 `mkaccounts.mjs`、删户走 `create-account.mjs --delete`，旧三件套标作废）。
- `rehearsal.mjs` 头注释加一段「建号先跑 mkaccounts」；`rehearsal-tail.mjs` 的诊断打印摘掉
  `pendingVerification`（字段已从 store 删掉，继续打印只会恒得 `undefined`，看诊断的人会以为
  「有这条状态但没置上」）。

### 5.1 差点静默丢掉这个脚本：名字撞上凭据闸的通配

它原本叫 `mkcreds.mjs`。写完、跑通、连回执都引用上了，最后一次 `git status` 才发现
**它从头到尾没出现在未跟踪列表里**：

```
$ git check-ignore -v .issues/ingest-root-cause-0812/e2e-94/mkcreds.mjs
.issues/ingest-root-cause-0812/e2e-94/.gitignore:9:*creds*   → mkcreds.mjs
```

那道 `.gitignore` 的本意写在它自己头一行——「本目录只允许 `.mjs` 脚本与 `.md` 文档进仓；跑出来
的一切状态都算凭据」——但 `*creds*` 这条通配比意图**宽**，把一个 `.mjs` 也吞了。表现是零报错、
零提示，只是这个文件**永远提交不上去**，下一轮的人打开目录发现引用了一个不存在的脚本。

处置：**改名 `mkaccounts.mjs`，不动那道闸**。加一条 `!mkcreds.mjs` negation 也能解，但那是为了
一个文件把凭据闸开个口子——改名零代价且名字更准（它建的是账号，creds.json 只是副产品）。
👉 **给下一个人**：往 `e2e-94/` 加脚本前先 `git check-ignore -v <路径>` 过一遍；那个目录的通配
（`*.json` `*.log` `*.txt` `*.png` `*.csv` `*state*` `*creds*` `*session*`）比你以为的宽。

---

## 6 · 验收账

| 项 | 结果 |
|---|---|
| `verify-auth-form.mjs` | **63 PASS · 0 FAIL**（改判前 57；born-red 两轮，见 §3.2） |
| `verify-auth-capability.mjs` | **25 PASS · 0 FAIL**（零改动） |
| `i18n-orphans` | **0 孤儿**（1086 叶子键 / 129 文件） |
| `./init.sh` | **绿**（lint + typecheck + build 全过） |
| 像素 | **零影响，且前提当场复验过**——见下 |
| 离线套 | **4217 selected · 我这条线零影响**——见下 |
| push | 🔴 **未 push**（也未 commit，工作树里躺着；理由见 §7） |

### 6.1 像素：前提是验的，不是引用的

票面要求「先验证 receipt-94 §4 那个前提仍成立再下结论」。做法：`./init.sh` 产出的正是**不配
`VITE_SUPABASE_*` 的那份 dist**（像素门跑的同一份），起 preview 后用**像素 spec 逐字同款的
URL**（`?v=2&mode=live&look=paper&lang=zh&transport=stub`）探一遍：

```
[PASS] 阳性对照：lite2 外壳真的渲染了（否则下面全是空真） — .lite2-shell=1
[PASS] 前提①：这份构建没配 VITE_SUPABASE_* → auth status === 'disabled'
[PASS] 前提②：账号面板整块不上屏（.lite-auth 一个都没有）
[PASS] 前提③：顶栏没有「登录」按钮（.lite-auth-toggle）
[PASS] 本票撤掉的两个 class 在整页都不存在（.lite-auth-switch / .lite-auth-hint）
```

前提成立 → 本票改的界面**根本不在那 36 张基线的射程内** → 零影响，不必重冻。
（另一重保险：CSS 那两条规则删的是**已经不存在的 class**，`.lite-auth-secondary` 的样式一字未动。）
探针脚本在 scratchpad，没进仓——它依赖「先 build 再 preview」的外部布景，单独放进仓库容易被
当成能独立跑的门。前提塌了怎么知道：谁往 `.env.local`/CI 补一个 `VITE_SUPABASE_*`，
账号面板就进了基线射程，那时这条结论会**静默变假**——所以每次动 auth 面板都要重跑一遍这五条。

### 6.2 离线套：4217 selected，我这条线零影响；有 1 条**先于本票就红**的时钟测试

三次跑法与读数：

| 跑的是什么 | selected | 结果 |
|---|---|---|
| `D:\avery` 工作树（我的改动 + 并发线 #99 当时还没提交的改动） | 4218 | 4217 passed · **1 failed** |
| **干净 main**（`6fd0400`，我自己的 worktree，两边改动都没有） | 4217 | 4216 passed · **同一条 failed** |

→ **同一条测试在干净 main 上照样红**，且本票 `git status` 里**零个 `.py`**（改动面：4 个 `src/`
前端文件、1 道门、3 份 `.issues/` 文档、2 个新脚本）。这条红与 #101 无关，也不是 #99 造成的
（他们没碰那个文件）。#99 已于 `06f9e4c` 落 main，那 4218 的 selected 数从此是新基线
（他们净加 1 条）。

病根查实了，是**「哪一天跑都绿」那一类**：

```
tests/test_decision_grading.py:1050
  assert _uploaded_day(twin.source_documents[0].uploaded_at) == date.today()
  AssertionError: assert datetime.date(2026, 8, 13) == datetime.date(2026, 8, 14)
```

`_uploaded_day()` 按它自己的 docstring 返回的是 **UTC 日期**，而 `date.today()` 是**本机本地
日期**。本机在 Asia/Shanghai（UTC+8），当场实测：

```
local date.today()    = 2026-08-14
UTC   now().date()    = 2026-08-13      ← 本地 00:21，UTC 还在昨天
```

也就是**每天本地 00:00–08:00 这八小时里它必红**，其余十六小时必绿——本次跑到 00:21 撞上了。
`_uploaded_day` 的 docstring 其实早就点了这个缝（「`as_of` 是服务端本地的 naive `date`，而
`uploaded_at` 是带时区的瞬间……两处各归一一次，早晚会归出两个不同的日子」），只是没人把
**测试**这一侧也归一。

⚠ 产品侧是不是也歪：同一个 seam 会让 `as_of - uploaded_day` 的资料年龄在这八小时里**多算一天**
（`R-STALE-EVIDENCE` 的阈值远大于 1 天，所以今天不至于当场误判，但年龄这个数是歪的）。
**没在本票动它**——它既不在 #101 的改动面上，改法也牵涉「服务端时区口径」这种要拍板的事。
**已开票 → #103**（两件事一起收：测试侧把 `date.today()` 换成同一套 UTC 归一；产品侧拍板
`as_of` 以谁为准）。本回执只报不修。

---

## 7 · 交接：三件事在 Danny 手上，一件在下一个 agent 手上

### 7.1 🔴 关真闸（唯一真正要紧的那件）

Supabase Dashboard → Authentication → Sign In / Providers → 关掉 **Allow new users to sign up**。
关完回一句，票面才能把「真闸已关」写成事实而不是假设。复核一条命令：

```
node .issues/account-tenancy-0813/probe-signup-frozen.mjs
```

**在此之前，注册这件事的现状是：客户在界面上点不到，但接口对全世界开着。**

### 7.2 建号脚本的真 Supabase 那一跑

```
SUPABASE_SERVICE_ROLE_KEY=<...>  node scripts/ops/create-account.mjs --self-test
```

约 10 秒，只碰 `avery-e2e+*`，跑完自己删干净。绿了就说明 §4 里「按文档应当如此」的那三件事
变成实测。**别把 key 贴进任何会话/文件**，就在那一次 shell 里传。

### 7.3 时区那条红要不要开票（§6.2）

### 7.4 已 commit，🔴 **未 push**

写这份回执时 `D:\avery` 的工作树里还**同时躺着并发线 #99 的未提交改动**
（`eval-harness/avery/ingest/{file_append,pg_registry,registry}.py`、`service/ingest_worker.py`、
`tests/{test_file_append_t10,test_registry_contract}.py`），所以当时按兵不动——那个检出上
`git commit -a` 会把他们的活一起卷进来。**#99 随后自己落了 main（`06f9e4c`）**，工作树里就只
剩本票这 13 个了。仍然是**逐个 `git add`** 提交的（不用 `-a`：这个检出是共享的，下一条线随时
可能又在里面放东西），也没用 `git stash`（碑：stash 是仓库全局的，裸 pop 会弹到别人的存货）。

本票改动面（逐个过了 `git check-ignore`，没有一个被静默挡住——§5.1 那个坑的直接教训）：

```
 M .issues/ingest-root-cause-0812/e2e-94/rehearsal-tail.mjs
 M .issues/ingest-root-cause-0812/e2e-94/rehearsal.mjs
 M .issues/ingest-root-cause-0812/receipt-94.md
 M eval-harness/tools/verify-auth-form.mjs
 M src/lite2/auth/AuthPanel.tsx
 M src/lite2/auth/authStore.ts
 M src/lite2/styles/lite2.css
 M src/shared/i18n/en.ts
 M src/shared/i18n/zh.ts
?? .issues/account-tenancy-0813/probe-signup-frozen.mjs
?? .issues/account-tenancy-0813/receipt-101.md
?? .issues/ingest-root-cause-0812/e2e-94/mkaccounts.mjs
?? scripts/ops/create-account.mjs
```

（`test-accounts/README.md` 也更新了，但那个目录整个 gitignore，对 git 隐形——**它是本机唯一
一份发号操作说明，跟着这台机器走，别指望在仓库里找到它**。）

---

## 8 · 给下一个人的三条

1. **撤前端入口不是安全边界**。这句话在 `AuthPanel.tsx` 顶部、`authStore.ts` 顶部、
   `test-accounts/README.md` 和本回执各写了一遍——不是啰嗦：只做 ②③ 的世界看起来和三层都做了
   的世界**一模一样**，没有任何界面证据能区分。唯一的区分手段是那支活体探针。
2. **`verify-auth-form` ④ 段的 signup route 是陷阱不是布景**。它回的那份 200 + 假 user id 是
   #94 从生产上抄回来的原件。谁把注册路径加回来，它会当场响。别因为「这个 route 好像没被用到」
   就把它清理掉。
3. **反向判据默认是空的**。本票自己就栽了一次：第一版 ④ 的两条判据在缺陷世界里照样全绿，
   是 born-red 逮到的，不是评审看出来的（§3.2）。写完「某某不存在 / 某某没发生」这类判据，
   **一定要把缺陷造回来跑一遍**，而且要逐条看是不是**每条都红了**——一条红了不代表旁边那条也有牙。
