# fixD · 数据边界（二次上传 / 换账号 / 鉴权 oracle）

工作树 `D:\avery-wt\fixD` · 分支 `fix/data-boundary` · 起点 `40ce59c`

五条 finding：**B1 部分修（机制齐、UI 待接线）· M2 修完 · M3 修完 · m4 修完 · M5 修完**。

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
