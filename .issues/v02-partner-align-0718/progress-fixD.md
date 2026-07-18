# fixD · 数据边界（二次上传 / 换账号 / 鉴权 oracle）

工作树 `D:\avery-wt\fixD` · 分支 `fix/data-boundary` · 起点 `40ce59c`

五条 finding：**B1 部分修（机制齐、UI 待接线）· M2 修完 · M3 修完 · m4 修完 · M5 修完**。

> **第二轮复核后已收口**：复核在第一轮修复里挑出三条新问题（1 blocker + 2 major），
> 全部已修，见文末「复核收口」一节。**本文档上半部分是第一轮的记录，其中两处已被推翻**：
> ① `switchErrorGone` 这个键连同「那一份在服务端已经不在了」这句文案**已删**——404 证明不了
> 这件事；② `restoreSession` 的 404 分支**不再**顺手删名册。下文凡与此冲突处，以「复核收口」为准。

贯穿这一轮的那条原则——**「我没读到」和「客户说没有」是两件事**——在本线的对应形态是
**「我打不开」和「这份不存在」是两件事**。B1-8 和 `switchErrorMissingCredential` 那句文案
是它的直接落地：钥匙没了不等于公司没了，界面必须分得清，也必须说得清。

---

## 机器门（全部真跑，输出见下）

| 门 | 结果 |
|---|---|
| `npm run typecheck` | 0 错 |
| `npm run lint` | 0 error / 5 warning（全部是既有的 `noInlineConfig` 提示，非本线引入） |
| `npm run build` | ✓ built in 3.26s；**`css-syntax-error` 计数 = 0**（F1 教训：esbuild 只 WARN，build 照样 exit 0，所以专门 grep 了一遍） |
| `python -m pytest eval-harness/tests/ -q` | **2995 passed / 0 failed / 4 xfailed**（基线 2956 + 本线新增 39） |
| `node .issues/v02-partner-align-0718/verify-data-boundary.mjs` | **22/22 passed**（新增，见下） |

端口：dev server 用 5304（自带、独立 cacheDir），后端未起（不需要）。**跑完已停，5304/8304 均已释放**。

---

## B1 · 🔴 第二次上传把第一家公司的数据抹掉且回不去 —— **部分修**

### 先确认了后端到底支不支持追加（brief 要求不许假设）

`eval-harness/avery/ingest/pipeline.py:135-151`：`ingest_docs` 拿到 `context_id` 之后

```python
cid = context_id or new_context_id()
ctx = CompanyContext(context_id=cid, extraction=extraction, store=store, ...,
                     source_files=[d.name for d in docs], ...)
registry.put(ctx)
```

**不是追加，是重建并覆盖。** 传旧 `context_id` 会拿新文档造一个全新的 `CompanyContext`
（全新 extraction、全新 store、`source_files` 只剩这次传的），再 `put` 盖掉旧的 ——
**会就地毁掉第一家公司的数据，比现状更糟**。所以"追加到当前 context"这条路直接排除，
走 brief 里的最小诚实修法。

### 已修（store 层，本线边界内）

`src/lite2/store.ts`：

- 新增**名册** `lite2:knownContexts:v1`（`{ id, files[], at }`，新→旧，上限 12）。
  每次成功上传记一条 —— 这是"回得去"缺的最后一块：`POST /ingest` 每次新建 context，
  上一份的 id 过了这一刻就再没有第二个地方能问到。
- 🔴 刻意**不拿 transport 的 owner_token map 当索引**。那是凭据存储，拿它当名册会把
  "有没有这份"和"有没有这份的钥匙"绑死 —— 而这恰恰是必须分开的两件事。
- 新增 `switchContext(id)`：切回名册里的某一份，走 `adoptContext` 收口，三条失败路径
  各自具名（`missing-credential` / `gone` / `failed`），**一条都不静默**。
  没钥匙时**绝不硬打过去**：无 token 的读必然 404，会被下游当成 `gone` 反手把一份
  其实还活着的公司从名册删掉 —— 用一次误判换永久失去入口。
- `restoreSession` 的 404 分支顺带把这份从名册摘掉（服务端真没了，别再挂着骗人点）。

`src/shared/i18n/{en,zh}.ts`（**纯追加**，未动任何既有键，未碰 v01 `lite` 段）：
`upload.againTitle / againBody / switchTitle / switchAction / switchCurrent /
switchFilesLabel / switchErrorMissingCredential / switchErrorGone / switchErrorFailed`。

> ⚠️ 复核后修正：`switchErrorGone` **已删**，换成 `switchErrorUnreadable`；另加
> `switchOpening / switchForget / switchForgetNote`。见文末「复核收口 · N2」。

文案要点：`againBody` 明写"新上传**不会**并进你现在看的这一份"——不承诺合并，因为没有合并。
`switchErrorMissingCredential` 明写"公司本身还在服务端，这台机器打不开"——不说成"数据没了"。

### ⚠️ 未修的那一半：UI 没接线

上传入口的警示条与"回到上一份"列表要落在 `src/lite2/UploadPanel.tsx`（+ 可能
`screens/TeamScreen.tsx`），**两者都不在本线文件边界内**，按纪律没动。
详见 `needsOtherFiles`，那里给了可直接粘的 JSX。

**在集成方接上这段 UI 之前，B1 对用户仍然是不可见的** —— 机制齐了，但客户看不到。
这是本线唯一一处「没做完」，不打算含糊过去。

---

## M2 · 🔴 `clearCompanyScope` 漏清三个 store（跨租户泄漏逐字原文）—— 已修

`src/lite2/auth/AuthPanel.tsx`，两件事：

1. `wipeLite2LocalStorage()` —— **按 `lite2:` 前缀整段清扫**，不是列举那三个 key。
   理由：那三个 key 的常量私有在各自文件里（本线也动不了那些文件），在 AuthPanel 抄一份
   字面量，等谁把 `:v1` 升成 `:v2`，清扫就**静默失效** —— 而失效的表现正是"看得见别人
   公司的原文"，没有任何报错。按前缀扫把不变式写死成「`lite2:` 底下不许有任何东西活过
   一次换账号」，将来新增的 lite2 store 自动被覆盖。
   （supabase-js 自己的会话 key 不是 `lite2:` 前缀，不会被误伤 —— 清了等于刚登录就被登出。）
2. `resetLite2MemoryStores()` —— localStorage 抹了还不够：那三个 store 只在**创建时**读一次盘。
   不复位内存的话，B 的经理在这一整个标签页里照样看得见 A 的条目，要等他手动刷新才消失
   —— 而演示时没人会刷新。

门的输出直接把泄漏拍在脸上（修复前）：

```
[FAIL] M2-1 ... lite2:flow:v1={"followups":[{"title":"鹿山雅居三期婚宴宴会厅交付延期，客户已口头投诉两次", ...}]}
[FAIL] M2-1 ... lite2:onboard:v1={"company":"三亚鹿山雅居", ...}
[FAIL] M2-4 内存态也复位了 — {"followups":1,"notifItems":4,"company":"三亚鹿山雅居"}
```

---

## M3 · `adoptContext()` 死代码 —— 已修

`AuthPanel` 登录恢复路径：`useLite.setState({ contextId: first })` → `useLite.getState().adoptContext(first)`。

feat-053 当时绕开收口的理由写在原注释里（"少碰一行就少一处合并冲突"）——躲冲突躲掉的恰好是
feat-050 专为这一刻留的口子，于是 `adoptContext` **全仓零调用点**。
代价不是"少了个抽象"，是一个**方向反了的 bug**：`adoptContext` 里那句 `rememberContextId()`
是把锚点落盘的唯一动作，绕过它 → **登录用户刷新反而丢数据，游客却不丢**。登录本该是更牢靠的那条。

门里 M3-3 是端到端证明：真刷新一次，数据真的还在（修复前 `{"contextId":null,"hasTeam":false}`）。

## m4 · 登出后锚点仍指着上一家 —— 已修（与 M3 同源）

`clearCompanyScope` 改走 `adoptContext(null)`，一次调用同时落 state + 抹掉
`lite2:contextId:v1`。`adoptContext` 只在 contextId **确实变了**时清派生数据，
所以后面仍显式再清一遍 —— 租户隔离这种地方不留"多半"。

---

## M5 · 🔴 owner_token 含非 ASCII → 500 而非 404 —— 已修

`eval-harness/service/ingest_api.py`：新增 `tokens_match()`，先把两侧 `encode("utf-8", "surrogatepass")`
成 bytes 再 `compare_digest`（bytes 版接受任意字节且仍是常数时间），整体裹 `except` 兜底。
**真 token 是 url-safe base64、纯 ASCII，encode 是恒等映射 —— happy path 逐位不变。**

### 为什么这是红线级：它是真的可用的 oracle

500 只可能发生在 `reg.get()` **已经找到 context** 且 `owner_token` 非空之后；未知 id 早就
短路成 404 了。所以状态码本身回答了 feat-038 唯一要拒绝回答的那个问题。实测（修复前）：

```
ORACLE DEMO (old code) — same malformed token, two ids:
  real id   ctx_be6405487d56         -> 500
  bogus id  ctx_does_not_exist_zzzz  -> 404
```

**零凭据即可枚举。** 且 `authorize_context` 是所有受保护读的唯一收口
（`/team`、`/notes`、`/files`、`/files/{idx}`、`/advise`、整个 `ask_api`、`/account/claim`），
一处修全部覆盖。全仓 `compare_digest` 仅此一处（已 grep 确认）。

### 测试语料的坑

**没用拼音伪装。** 语料含真汉字 `令牌中文`、全角 `ｔｏｋｅｎ`、emoji、latin-1 重音 ——
拼音是 ASCII，`compare_digest` 收得好好的，用拼音写这个测试会在旧代码上直接 PASS、
证明不了任何事（记忆 `gate-corpus-all-ascii-blindspot`）。

另一个坑：httpx **拒绝**把非 ASCII 字符串塞进 header（客户端 ASCII 守卫）。直接传 str
只能证明"httpx 有守卫"，保护不了任何不用 httpx 的攻击者。所以测试传的是 **UTF-8 bytes**
—— 就是 `curl -H $'X-Avery-Token: \xe4\xbb\xa4'` 放到线上的东西，Starlette 按 latin-1 解码，
每个 >0x7F 的字节都变成非 ASCII 码点。这一步没做对的话整组测试是空转。

---

## 新增测试

| 文件 | 内容 |
|---|---|
| `eval-harness/tests/test_token_oracle_nonascii.py` | 39 条：4 类畸形 token × 5 条受保护读 × 两个 header；**oracle 判据**（真 id 与假 id 的状态码+响应形状必须一致）；`/account/claim` 的 JSON body 路径；happy path 与"格式正确但不对的 token 仍 404"的反向保护；`tokens_match` 单测 |
| `.issues/v02-partner-align-0718/verify-data-boundary.mjs` | 22 条 Playwright 行为断言（B1/M2/M3/m4），**自带 dev server**，一条命令跑完 |

### 为什么前端门是 Playwright 而不是单测

本仓前端没有 vitest/jest，而这四条全是**跨模块运行时行为**（localStorage 跨账号存活、
React effect 里的收口调用、zustand 内存态与持久层是否一致）—— 正是四道机器门结构上
看不见的那一类（integration-findings §四：本波它们全绿的同时三个真 bug 一个没拦住）。

两个刻意的设计：

- **不用 `?transport=stub`**：`stubSelected` 一旦为真，contextId 持久化整条链被关掉
  （`store.ts` 的 `restoredContextId`）——而"锚点落没落盘"正是 M3/m4 要验的东西。
  用 stub 验它等于把被测对象关掉再宣布通过。改为默认 HTTP transport 起页、再 `setTransport()`
  注入假 transport：**持久化链是真的，网络是假的**，不需要后端、天然绕开 F10 那个
  "看起来像没数据"的 CORS 坑。
- **独立 cacheDir**（写在系统临时目录，绝不落工作树）：F9 那个 504 白屏坑。

### 门缝

`AuthPanel.tsx` 加了 `__lite2Flow / __lite2Notify / __lite2Onboard`（同 `__lite2Store` /
`__lite2Auth` 先例）。**加了 DEV 闸**（`__lite2Store` 没有）：暴露的是三个可写 store 句柄，
生产没有任何理由存在，`import.meta.env.DEV` 静态求值成 false 后 rollup 直接 DCE 整块。
落在 AuthPanel 是因为它本来就是唯一同时持有这三个引用、且不成环不越界的模块。

---

## 旧代码 FAIL / 修复后 PASS（两次输出）

### 后端 M5

旧代码（把 `tokens_match` 换回 `secrets.compare_digest`）：

```
17 failed, 22 passed in 6.85s
FAILED ...::test_malformed_token_is_404_on_every_read[cjk]
FAILED ...::test_malformed_token_is_404_on_every_read[latin1-accent]
FAILED ...::test_malformed_token_is_404_on_every_read[emoji]
FAILED ...::test_malformed_token_is_404_on_every_read[nfkc-lookalike]
FAILED ...::test_malformed_bearer_token_is_404[cjk|latin1-accent|emoji|nfkc-lookalike]
FAILED ...::test_no_existence_oracle_under_malformed_token[cjk|latin1-accent|emoji|nfkc-lookalike]
FAILED ...::test_authorize_context_raises_404_not_typeerror[cjk|latin1-accent|emoji|nfkc-lookalike|lone-surrogate]
E   TypeError: comparing strings with non-ASCII characters is not supported
    eval-harness\service\ingest_api.py:121: TypeError
```

修复后：`39 passed in 2.53s`

### 前端 B1/M2/M3/m4

旧代码：`9/22 passed`，13 FAIL（完整输出见上文 M2 段的泄漏证据）。
修复后：`22/22 passed`。

**诚实标注**：B1-5/6/7 在"旧代码"跑里也 PASS —— 因为 `switchContext` 是全新能力，
旧代码里没有对应物可失败。B1 的 born-red 隔离的是真正的缺陷本身（上传不留名册 →
上一份彻底失联）：B1-1 / B1-2 / B1-4 / B1-8 四条。

---

## Notes（顺手发现，**未修**）

1. **`/account/claim` 的 lone-surrogate → 500**（新发现，与 M5 同族但**不是同一个 bug**）。
   JSON body 里的 `"\ud800"` 被 pydantic 拒绝，FastAPI 的 stock validation-error handler
   把**违规输入原样回显**进响应体，starlette UTF-8 编不出来 → 500。
   **不是 oracle**：实测真 id 与假 id 都返 500（`ctx_real_but_fake -> 500` /
   `ctx_totally_bogus_zzz -> 500`），且它在 `authorize_context` 之前就炸了，不携带存在性信息。
   修法是在 `service/app.py` 装一个 `RequestValidationError` handler（别回显原始输入），
   **超出本线文件边界**，故只记录、未动。测试里已明确排除并写清了理由。
2. `authorize_context` 里 `reg.get(context_id)` 自身抛异常（DB 抖动）仍会 500。与 id 无关，
   不构成 oracle，但同属"异常路径未统一"。范围外，未动。
3. i18n 的 `zh.ts` 头部写着 AUTO-GENERATED / Do NOT hand-edit。本次是**手写追加**（同文件里
   feat-032/033 已有多处同样的手写先例并留了标注）。若集成方要走 M3 定向重跑，
   命令是 `node scripts/i18n-zh.mjs upload`；本次新增 9 个键的中文已定稿，不标"待审"。

## Blockers

无。

---

# 复核收口（第二轮 · 三条 newFinding）

复核判 B1 为 `partial`，并指出**第一轮修复本身引入/留下**三条问题。三条全部已修，
共同的那条线还是同一句：**「我打不开」不等于「这份不存在」**——只不过这一轮它有两种更硬的形态：
*我取回来的数据到底属于谁*，以及*我凭什么替客户断言他的数据没了*。

## N1 · 🔴 blocker · `switchContext` 无重入/时序保护 → 两次快速切换把 A 公司的人渲染到 B 公司底下

### 病

原实现是「先换 id，再去取」：`adoptContext(新 id)` → `await restoreSession()`。
而 `restoreSession` 在 `await transport.fetchTeam(contextId)` 之后，拿**闭包里捕获的旧
contextId** 无条件 `set({ team, ownerToken })`，全程不回头核一次 `get().contextId` 变没变。
外加它开头的 `if (restoreInFlight) return` 是个裸 boolean，把**换了目标**的第二次调用
当成重复调用一起挡掉了。

于是双击（或点了 A 又改主意点 B）之后：屏上挂着 B 的 contextId 和锚点，人却是 A 的人，
手里攥的是 A 的 owner_token。**B 公司经理看到的整份花名册来自 A 公司的文件。**
连锁后果也是实的：ownerToken 错配 → 下一次对 B 的受保护读带着 A 的 token → 后端按 feat-038
回 404 → 被下一条（N2）读成「B 没了」→ B 被永久从名册抹掉。

### 修

`src/lite2/store.ts`，四件事：

1. **`switchContext` 改成「取到了再换」**：先 `fetchTeam`，成功了才 `adoptContext` + 写数据。
   `adoptContext` 与紧跟的 `set` 之间不 await，所以不存在「contextId 已是 B、team 还是 A」
   的可观测窗口。附带好处：切换失败时用户**仍停在原来那份公司上**，不再留半切状态
   （原实现失败后 contextId 已经换过去了，屏上是一份空公司）。
2. **`switchSeq` 世代号**：进门 +1 并捞在手里，await 回来发现号变了 = 用户已经点了别的一份，
   这次结果**连同它的错误一起作废**。没有它，先发的那次（可能是慢的那次）会覆盖用户真正想要的。
3. **`restoreInFlight` 从 boolean 改成 `restoreInFlightFor: string | null`**：
   同 id 再来 = 重复（StrictMode 双跑，照挡）；不同 id 来 = 新目标（放行）。
   两件事本来就不是一件事，用一个 boolean 表达必然误伤其中一个。
4. **`stillOn(get, contextId)` 闸普遍化**：`restoreSession`（成功/失败两条路）、
   `refreshTeam` / `refreshFiles` / `refreshNotes`、以及 `askLive` 里那次 `fetchNotes`，
   每一个 await 回来都先核身份，不是这一家就一个字段都不写。
   这几条不是陪跑——AuthPanel 的登录恢复本身就是 `adoptContext(first)` 紧跟
   `refreshTeam` + `refreshNotes`，与用户手点切换天然并发；少一道闸，同样的串数据只是换个入口。

另加 state 字段 **`switchPending: string | null`**。它不是"转圈好看"：UI 必须据此把名册按钮
置灰。裸 `<button onClick={switchContext}>` 无 pending 态 = 双击就是一次并发切换，
而并发切换正是本条的触发方式。store 挡住了竞态，UI 还得挡住误触——两边都要。

## N2 · major · 把 404 读成「这份数据没了」并据此永久删名册

### 病（与本轮主题正面冲突，且冲突的正是第一轮自己写在 commit 抬头的那句话）

`restoreSession` 的 404 分支会 `forgetKnownContext(contextId)`，`switchContext` 把它翻成
`'gone'`，文案是「那一份在服务端已经不在了，已从这个列表里移除」。

**产品替客户断言了一个它无法知道的事实。** feat-038 **刻意**让「这份不存在」和「你证明不了
这是你的」返回同一个 404——那正是它拒绝提供的存在性 oracle。所以 404 至少三种成因，
前端一种都分不出来：① 真没了；② token 对不上（`ingest_api.authorize_context` 的 token 分支）；
③ 持久化 registry 里 `owner_token` 为空的旧 context，对**真正的主人**也 fail-closed 成 404。
再加上 N1 的 ownerToken 错配必然 404 —— 一条 blocker 直接喂进这条 major。

而且这个删除**不可逆**：`POST /ingest` 每次新建 context，id 只在返回那一刻出现过一次，
名册是它在这台浏览器上的唯一第二处记录（第一处是锚点，每次上传都被覆盖）。
**用一次我方无法解释的失败，换用户永久失去入口。**

### 修

- `restoreSession` 的 404 分支**不再动名册**。锚点仍然松开（可再生：切回去就有），名册留着。
- 错误码 `'gone'` → **`'unreadable'`**，语义从「没了」改成「打不开」。
- i18n：**删掉** `switchErrorGone`，新增 `switchErrorUnreadable`——文案明写
  「可能是那一份真的没了，也可能是这台电脑已经证明不了它是你的，**Avery 分不出是哪一种**。
  两种情况下它都还留在这个列表里，可以再试一次。」
- 名册删除保留，但收进**唯一一个用户显式入口**：新增 store action `forgetContext(id)`
  ← UI 的「从这个列表里移除」（配 `switchForget` / `switchForgetNote`，后者写明
  「只是把这台电脑上的入口去掉，服务端的数据不会被删」）。
  `forgetKnownContext` 的注释里钉死了这条纪律：**绝不许挂到任何失败处理路径上**。

> **关于「只许追加 i18n 键」这条边界**：`switchErrorGone` 是我自己上一个 commit（`e49cda3`）
> 加的键，**从未进过 main，零 UI 消费者**，其他线不可能持有它，删它不产生跨线冲突。
> 之所以选择删而不是改文案：键名本身就编码了那个假断言，留着 `switchErrorGone` 等于给集成方
> 留一个写着「gone」的把手，谁接线谁就会把它接回「没了」的语义上。已在此显式记录。

## N3 · major · 第二次上传不清 notes，A 公司的笔记挂在 B 公司底下

### 病

`uploadFiles` 用裸 `setState` 设 contextId，只重设 team/rawTeam 并 `void refreshFiles()`，
**唯独漏了 notes**（`refreshNotes` 不调、也不清空）。`NotesScreen` 直接渲染 `s.notes`，
所以是**用户可见**的：A 公司的「Avery's notes」原文原封不动挂在 B 公司的 contextId 底下。

它就落在 B1「第二次上传」这个正主场景里。更难堪的是：同一个 commit 新写的 `switchContext`
走 `adoptContext`，那条路清得干干净净——**同一件事，两条路给出相反答案**。
M3 修的正是「绕开收口就会出方向反了的 bug」，`uploadFiles` 是同一个坑里剩下的另一半。

### 修

`uploadFiles` 改走同一个收口：先 `adoptContext(payload.context_id, payload.owner_token ?? null)`
（id 变了它就清 team/rawTeam/files/notes/ingestStatus + 落锚点），**再**写本次的团队数据。
顺序不能反——反过来会被它当场清掉刚拿到的团队。随后 `refreshFiles()` + `refreshNotes()`
把**这一份自己的**拉回来（新 context 多半是空的；真为空时拉回来的也是空，不会凭空造内容）。

---

## 门（三道前端门 + pytest，全部真跑）

| 门 | 结果 |
|---|---|
| `npm run typecheck` | **0 错** |
| `npm run lint` | **0 error** / 5 warning（全部是既有的 `noInlineConfig` 提示，非本线引入） |
| `npm run build` | ✓ built in 2.82s；**`css-syntax-error` 计数 = 0**（专门 grep 过——esbuild 只 WARN，build 照样 exit 0） |
| `python -m pytest eval-harness/tests/ -q` | **2995 passed / 0 failed / 4 xfailed**（基线 2956 + M5 的 39；本轮未动后端，回归保护） |
| `node .issues/v02-partner-align-0718/verify-data-boundary.mjs` | **37/37 passed**（22 → 37，新增 15 条） |

端口：dev server 用 53041/53042/53043（避开集成方的 5173/8137，也避开 5304 免得与自己撞）。
**跑完已停**，`netstat | grep LISTENING` 确认无监听残留（只剩内核 TIME_WAIT 的客户端 socket）。

## 每条 newFinding 的 born-red 证明

复核要求"证明这条测试能抓到原 bug"。为此给门加了 **`VERIFY_OLD_STORE=<git-ref>` 开关**：
用 Vite 的 `load` 钩子把 `git show <ref>:src/lite2/store.ts` 原样喂进 dev server，
**工作树零改动、不 checkout、不 stash**（本线禁止一切切换类 git）。同一份测试、同一条命令，
只换 store.ts 一个模块——换得越少隔离越干净，而这三条 newFinding 全部落在它里面。

```
# 修复前（HEAD = e49cda3，第一轮修复之后、本次收口之前）
VERIFY_OLD_STORE=HEAD VERIFY_PORT=53043 node .issues/v02-partner-align-0718/verify-data-boundary.mjs
  → 26/37 passed，11 FAIL，全部是新增的 N 组：

  [FAIL] N1-2 🔴 屏上的人属于屏上那家公司 — contextId=ctx_fake_d3n00061 teamPeople=["员工-ctx_fake_ubqw353i"]
  [FAIL] N1-3 🔴 手里的 owner_token 也是这一家的 — ownerToken=tok_ctx_fake_ubqw353i expect=tok_ctx_fake_d3n00061
  [FAIL] N1-5 切成功了就不许同时挂着一句错误 — switchError=failed
  [FAIL] N1-6 pending 态收干净了 — switchPending=(字段不存在)
  [FAIL] N2-1 🔴 404 读成「打不开」而不是「没了」 — switchError=gone
  [FAIL] N2-2 🔴 一次 404 不许把这一份从名册上抹掉（内存态） — stillListed=false
  [FAIL] N2-3 🔴 localStorage 里的名册也没被抹 — lsListed=false
  [FAIL] N2-4 切换失败不留半切状态 — contextId=null teamPeople=null
  [FAIL] N2-5 失败后 pending 态也收干净 — switchPending=(字段不存在)
  [FAIL] N2-6 名册删除有且只有「用户显式点移除」这一条路 — store 没有 forgetContext
  [FAIL] N3-1 🔴 第二次上传后，A 公司的笔记原文不在屏上 — notes=["鹿山雅居三期婚宴宴会厅交付延期，客户已口头投诉两次"]

# 修复后
VERIFY_PORT=53042 node .issues/v02-partner-align-0718/verify-data-boundary.mjs
  → 37/37 passed

  [PASS] N1-2 — contextId=ctx_fake_t8rwi83d teamPeople=["员工-ctx_fake_t8rwi83d"]
  [PASS] N1-3 — ownerToken=tok_ctx_fake_t8rwi83d expect=tok_ctx_fake_t8rwi83d
  [PASS] N2-1 — switchError=unreadable
  [PASS] N2-2 — stillListed=true      [PASS] N2-3 — lsListed=true
  [PASS] N2-4 — contextId=ctx_fake_t8rwi83d teamPeople=["员工-ctx_fake_t8rwi83d"]
  [PASS] N3-1 — cid=ctx_fake_ge5mm47e notes=[]
```

**两次跑里 B1/M2/M3/m4 全部 22 条都是 PASS** —— 隔离干净：新增的 11 条 FAIL 精确对应三条
newFinding，没有一条是"顺带跑红"。

### 测试语料上的两个刻意选择

1. **假 payload 里的人名带 contextId**（`员工-${cid}`）。原来全公司共用一个「李明」——
   那样的话「A 的花名册渲染到 B 底下」长得和正确结果**一模一样**，N1-2 永远抓不到。
   跨公司串数据这件事，只有"这个人属于哪一家"能证明。
2. **竞态测完还要多等 500ms**。脏数据是**先发的那次**在 400ms 之后才写进来的
   （fetchTeam 延迟 250ms，两次点击间隔 40ms）。`await Promise.all` 一回来就收摊的话，
   这条测试在坏代码上会**假过**。

### 顺带修的门自身问题

`consoleErrors` 原来只挂在第一页上，page2/3/4 炸了看不见。现在每页都 `watch()`。
挂上之后立刻暴露出一类噪声：本门**不起后端**，而每次 `goto`/`reload` 都有一帧是用真 HTTP
transport 跑的（假 transport 只能在页面加载**之后**注入），那一帧的 `restoreSession` 必然
打向 `VITE_AVERY_API_BASE` 被 CORS 拦下。按窄白名单排除并**单独打印计数**，不静默丢弃。

---

## ⚠️ 仍未做完：B1 的 UI 一半（与第一轮相同，边界未变）

复核对 `partial` 的第二条理由是「零个 UI 消费者，对真实用户仍不可见」——**属实，本轮仍未变**。
名册、切换、pending、错误文案、显式移除，机制全在 store 里，但 `UploadPanel.tsx` /
`screens/TeamScreen.tsx` 都不在本线的文件边界内。可直接粘的 JSX 见 `needsOtherFiles`
（已按 N1 的教训补上 `disabled` + pending 态 + 显式移除入口——第一轮给的是裸 `<button>`，
接上去就是一次双击的距离）。

**在集成方接上这段 UI 之前，B1 对客户仍然是不可见的。** 这是本线唯一一处没做完，不含糊。

## Blockers

无。
