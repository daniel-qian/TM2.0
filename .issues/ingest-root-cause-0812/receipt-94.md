# receipt-94 · 账号方案 A 真彩排（2026-08-12）

> 正源 issue #94。**结论先行：九判据 33 条全绿，方案 A 的完整动线在生产上第一次被真人（agent）走通**，
> 包括「方案存在的唯一理由」换设备恢复。`auth.users` 从 0 行起步——票面「这条路从没被任何真人跑通过」
> 属实，现在不再属实。发现四条产品事实要带回编排（§5），订正 exploration.md 一处过时断言（§5.5）。

## 0 · 测试户与凭据（只写指针，不写值）

| 项 | 值 |
|---|---|
| 常驻测试户（保留，下轮复用） | `avery-e2e+20260812@dannyqian.com`（user_id `096eec64-…`，已确认态） |
| 临时测试户 B | `avery-e2e+20260812b@dannyqian.com` —— **彩排毕已删**（auth.users 现仅 1 行 avery-e2e） |
| 凭据位置 | 本机 scratchpad `…\scratchpad\e2e-94\creds.json`（密码 24 位强随机；**绝不进仓**，`e2e-94/.gitignore` 通配挡） |
| 建法 | ~~正常 signup API（anon key）→ SSH 进生产容器用其 `AVERY_DB_URL` 跑 `UPDATE auth.users SET email_confirmed_at=now()`~~ **已作废（#101，2026-08-13）**：注册门冻结后 signup API 被 `disable_signup` 真闸挡死，这条路第一步就走不通。现行建法 = `supabase.auth.admin.createUser({ email_confirm: true })` **一步建成已确认**，不进生产容器、不发确认信。引导脚本 `e2e-94/mkaccounts.mjs`（要 `SUPABASE_SERVICE_ROLE_KEY`，只本机；产出的 creds.json 仍落 scratchpad）；单个发号/删号走 `scripts/ops/create-account.mjs` |
| 彩排脚本 | `.issues/ingest-root-cause-0812/e2e-94/{mkaccounts,rehearsal,rehearsal-tail,probe-claim-refresh}.mjs`（进仓可复用；重跑防呆见 rehearsal.mjs P1 注释：**A 名下有 context 时会明确死掉**，先解绑再跑）。⚠ 彩排的**登录**动线本身不受注册冻结影响（走 password grant + 登录表单），受影响的只有建号这一步 |

## 1 · 九判据逐条实测（主跑 23 + 尾段 10 = 33 条判据，全绿）

| # | 判据 | 实测证据 |
|---|---|---|
| ① | 登录态上传 → `account_linked:true` | `/ingest` 请求带 `X-Avery-Account`；响应 `account_linked:true`，ctx `ctx_7d0330ef95dc`，`extraction_mode:llm`（真 MiniMax，4 人 2 项目）；面板显示「已绑定到你的账号」、不出认领入口 |
| ② | `/account/contexts` 列出 + 无 header **401** | 无 header → 401；带 A 的真 JWT → 200 且含 `ctx_7d0330ef95dc` |
| ③ **核心** | 清 localStorage 换设备 → 登录 → `adoptContext` 恢复 | 全新 browser context（零本地状态实证）→ 登录即拉 `/account/contexts` 200 → 自动接管同一 ctx，**人（孙三测/李四测/赵一测/钱二测）与项目（盘点系统/门店翻新）逐字对上**；锚点落回 `lite2:contextId:v1`。截图 scratchpad `e2e-94/p2-device2-restored.png` |
| ④ | 游客上传 → 登录 → **手动点认领** | 游客 `/ingest` 无账号 header、响应无 `account_linked`（ctx `ctx_aa30d88a31ee`）；登录动作没吞游客数据；点「绑定到我的账号」→ `POST /account/claim` 200 `claimed:true` → contexts 含它 |
| ⑤ | 登出后 owner_token 腿仍 200 | A 登出后，G1/C1 各自的 owner_token 读 `/team/{id}` 都 200——**claim 是加法不是收权**（产品事实，见 §5.3） |
| ⑥ | demo 免登录不变量 | 无凭据 `/demo/status` 200 available（登录会话并存时同样 200）；无凭据 `/demo/claim` 200（`demo:true, ephemeral:true`，ctx `ctx_162bfdf1dc5e`）；克隆不进任何账号名下；其 owner_token 腿可读 |
| ⑦ | 双账号不串场 | A 登出 → `lite2:*` 只剩 lang/look 白名单（clearCompanyScope 实证）、屏上数据清空；B 登录 → contexts 为 `[]`、屏与 localStorage 零 A 残留；B 的 JWT 读 A 的 ctx → **404**（无存在性 oracle） |
| ⑧ | 真 JWT 的 60s 服务端缓存过期 | 时间曲线：t0 填缓存 200 → 全局登出 204 → **t+1.9s 后端 200 而 GoTrue 直探 403**（窗内 200 确凿来自缓存，不是 Supabase 还认）→ **t+66.2s 后端 401**（到期重核验，撤销生效）。`account.py` 的设计逐字兑现 |
| ⑨ | autoRefreshToken 续期后不 401 | 把持久化会话 `expires_at` 拨到过期 + reload → supabase-js 用真 refresh_token 换发新 JWT（token 前后确证不同）→ 应用后续 `/account/contexts` 带**新** token 200、`/team` 腿数据仍在 |

验证账（文案改动侧）：`./init.sh` 绿（typecheck+build）· `i18n-orphans` 0 · `verify-auth-capability` 25/25 ·
`verify-auth-form` 57/57（含 zh 纯度）。像素基线不涉及（guest note 只在 auth 配置态渲染，本地门跑法不配 Supabase env，见 §4）。

## 2 · 生产痕迹与清理回执（零真实用户影响）

- 触碰面：仅 avery-e2e 测试户 + 自造 context 三个 + 真 LLM 抽取两次（4 人/2 人的小 CSV，MiniMax）。
- 清理 SQL 实跑（经生产容器）：解绑 `account_contexts` 2 行 → **归零**；三个 context 全部
  `ephemeral=true`（含 demo 克隆天生的标）；删 B 户 1 行。终态核验：avery-e2e 用户仅剩 A（已确认）、
  `account_contexts` 0 行。
- GC 条件：sweep 要「有标 + 48h + 未绑账号」三者同时成立——三个 context 已满足前后两条，**48h 后
  任一次 `/demo/claim` 顺手清扫即回收**（0724 GC 机制，不必人工再动）。
- 重复 signup 探针（§5.1）**没有**多造用户：全程 auth.users 最多 2 行，收尾 1 行。

## 3 · 文案修改（顺手修的那条假话，已扩到同谎的第二处）

死针探测先行：`git ls-files "*verify-*.mjs"` 全量 + `live-frontend-gate.snippet.js` grep
`authGuestNote|homeGuestNote|存到你名下`——**零命中**，没有门逐字断言这两句，改动自由。

| 键 | 旧（撒谎处） | 新 |
|---|---|---|
| `authGuestNote`（zh:874） | 「登录**只是**把上传的公司数据存到你名下」 | 「登录后上传的数据会记在你名下，换设备也能打开；**登录前传的那份，要在这里点一下「绑定到我的账号」才归你**。」 |
| `homeGuestNote`（zh:1396） | 「登录只是让你在不同设备上还能找回自己上传过的东西」 | 「**先登录再上传**，传的东西会记在你名下，换台设备登录也能找回。」 |
| en 两键 | 同构谎话 | 同构改法（`Attach to my account` 与按钮文案逐字一致） |

超票面半步的裁定：票面只点名 `authGuestNote`，但 `homeGuestNote`（合伙人反馈 A6 前置到首屏空态的那句）
是**同一句谎话的更显眼抄本**——只修弹层不修首屏，产品照旧在第一屏撒谎。判据同族（「登录=自动归属」只在
先登录后上传时为真，④ 已实证游客路要手动点），一并改。渲染语境核对过：homeGuestNote 只在
`status==='guest'` 且无 team 时渲染，「先登录再上传」对这个读者恰好是可执行的真话。

## 4 · 为什么像素基线不涉及

两个 guest note 的渲染前提都是 auth 配置态（`authConfigured()` / `status==='guest'`），而本地像素/门
跑法不配 `VITE_SUPABASE_*` → `status==='disabled'` → 这两句**根本不上屏**。两道 auth 门是网络层伪造
（page.route 假 Supabase），自带 build——82 条判据全绿即行为收口。

## 5 · 带回编排的产品事实（只报不修）

1. **注册入口对预置账号用户是死胡同，且比票面描述的更糟**：对已注册且已确认的邮箱再走 signup，
   Supabase 返回 **200 + 一个假 user id**（枚举保护式伪装成功，实测 `confirmation_sent_at` 照发）——
   于是 `authStore` 里那句人话「这个邮箱已经注册过了，直接登录」的分支**结构性够不到**（它等的是
   4xx error），用户只会看到「注册成功。去邮箱点一下确认链接」然后永远等不到。方案 A 手动分发账号时，
   **分发话术必须明说「直接登录，别点注册」**，或者产品把注册入口藏起来。
   → **已处置（#101，2026-08-13）**：产品走的是「藏起来」那条 —— 注册入口、`authStore.signUp`、
   `pendingVerification`、`authVerifyNote` 全撤（回执 `.issues/account-tenancy-0813/receipt-101.md`），
   `verify-auth-form` ④ 段翻成反向判据守着，那句假话不会再上屏。话术留着不吃亏。
   ⚠ **唯一的真闸仍是 Supabase 后台的 `disable_signup`**，只有 Danny 能点。活体读数：
   `node .issues/account-tenancy-0813/probe-signup-frozen.mjs`。
2. **无改密/重置入口**：`src/` 全仓 `resetPasswordForEmail|updateUser` 零调用点。运维全靠 Supabase
   后台，密码轮换归 Danny 人手。
3. **claim 不收权**：⑤ 实证——认领后、登出后，旧 owner_token 仍是那份 context 的万能钥匙。对
   「预置账号 + 手动分发」的试点客户面，这意味着**换设备的安全边界是「谁拿到过那台设备的
   localStorage」**，不是账号体系。
4. **（新发现）登出会把 OnboardGate 闸门弹回来，盖在还开着的登录弹层上**：`clearCompanyScope` →
   `resetOnboardCompanyScope` → onboard 回 `unseen` → 闸门重新挂载，backdrop 拦掉登录弹层的点击。
   「A 登出 → B 接着登录」（共享机/演示机动线）会被闸门打断一次，要先 Escape/关闸才能继续。
   彩排主跑第一次就是死在这儿的（B 的登录按钮可见但点不着）。
5. **（订正 exploration.md §2）「刷新丢状态，认领入口就消失」对现行代码不成立**：探针实测
   （K1 注入锚点+token 模拟刷新后形状）——认领入口**刷新前后都在**（锚点与 owner_token 都持久化）。
   真正的丢失条件是 **localStorage 没了**（无痕/清库/换设备）——那时游客期的数据对这台设备就是孤儿，
   永远无法认领。文案修改不受影响（手动认领这一步是真的）。

## 6 · 彩排基建的两条教训（写门的人看）

1. **`waitForResponse` 建了 promise 就要立刻挂哑 catch**：它的超时拒绝若发生在被 await 之前
   （前面还压着别的 await），未接住的拒绝会**直接杀进程、finally 都不跑**——主跑第一次连
   results.json 都没留下就是这么死的。`rehearsal.mjs` 的 `armed()` 是修法。
2. **OnboardGate 是所有生产 UI 彩排的常驻拦截层**：首帧挂载可能晚于第一次 Esc（竞态），登出还会
   让它复活（§5.4）。`dismissGate()`（见闸就 Esc，最多 6 次）要在 openApp / loginUI / logoutUI
   三处都挂。

## 7 · 下轮复用姿势

1. **建号**（#101 改法）：`SUPABASE_SERVICE_ROLE_KEY=<...> node .issues/ingest-root-cause-0812/e2e-94/mkaccounts.mjs`
   —— 按当天日期建 A/B 两个 `avery-e2e+<YYYYMMDD>{a,b}@dannyqian.com`，一步已确认，写 creds.json 到
   scratchpad。旧的 scratchpad 三件套（`signup.mjs`/`pgconfirm.py`）**已作废**，signup 那步会被真闸挡死。
   §0 的常驻户 `avery-e2e+20260812@dannyqian.com` 不必复用（它的密码只存在过上一轮的 scratchpad 里，
   Supabase 读不出来）——还挂着的话用 `scripts/ops/create-account.mjs --delete <email>` 带走。
2. `E2E94_CREDS=<creds.json> node .issues/ingest-root-cause-0812/e2e-94/rehearsal.mjs`（P1-P3+⑥⑨）→
   若中断，`rehearsal-tail.mjs` 补 ⑦⑥⑧。
3. 收尾照 §2 的 cleanup SQL（unlink → ephemeral），**删户改走**
   `node scripts/ops/create-account.mjs --delete <avery-e2e+*@dannyqian.com>`（它只认这个前缀，
   真实公司账号一律拒绝）。
