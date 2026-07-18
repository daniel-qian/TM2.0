# feat-050 · 会话不丢（contextId 恢复）— 收工记录

分支 `feat/050-session-restore` · 工作树 `D:\avery-wt\050` · 2026-07-18

## 做了什么

病因与 PRD G3 / kickoff 判断完全一致：后端早就持久化了，`owner_token` 也早就存在
`lite2:ownerTokens:v1` —— **唯独 `context_id` 只活在内存里**。刷新一次，指针没了，数据还在
后端却再也找不回来。这次补的就是那根指针。

1. **落锚点**：`src/lite2/store.ts` 新增 `lite2:contextId:v1`（手写同步 load/save，与
   flowStore/notifyStore/onboardStore 同族）。上传成功 → `rememberContextId(context_id)`。
   🔴 只存 context_id 一个 id，**不存 token**（token 仍归 transport 那份存储管，不两处写凭据）。
2. **首帧同步取回**：store 创建时 `contextId` 就从 localStorage 就位（不等 effect），
   `ownerToken` 用新导出的 `storedOwnerToken()` 从 transport 那份存储挂回来（feat-047 语义不变）。
3. **恢复动作** `restoreSession()`：`Lite2App` 挂载时调一次，按 contextId 走
   `/team/{id}`，团队回来后顺带 `refreshFiles()` + `refreshNotes()`
   ——否则"团队回来了但文件清单和笔记还是空的"，那也是会话丢了。
4. **三条降级路径**（验收要求的"优雅降级"，逐条实测见下）：
   - 没锚点 → 干净首访，直接上传引导，**不转圈**；
   - **404**（context 没了 / token 失效）→ 忘掉锚点、清干净、回上传态，**一个字的错都不报**
     （context 真没了，上传引导就是诚实答案）；
   - 其它错（后端没起 / 网断）→ **保住锚点**（context 多半还活着，不能因为一次连不上就把
     用户的指针扔了）+ 一行安静说明 + 重试按钮。
5. **stub 隔离**：`?transport=stub` 下整条恢复跳过——既不落锚点，也绝不让 stub 的 404
   抹掉一个真会话的锚点（否则"为跑一次门加个 `?transport=stub`"就把真数据指针擦了）。
   为此把 `resolveTransport()` 里的 URL 判断抽成导出的 `isStubTransportSelected()`（行为等价）。

### 给 feat-053（账号体系）留的口子

任务书明确要求"不要把恢复逻辑写死成唯一入口"。落法：

- 新增 `adoptContext(contextId, ownerToken?)` —— **谁拿到权威 contextId 就调它**，一处收口
  （落 state + 落锚点；换了 context 会把上一个 context 的 team/files/notes 清掉，防数据串）。
  feat-053 拿到"服务端按账号返回的 contextId"后直接调这个，不用碰 `restoreSession`。
- `restoreSession()` 自己让路：**已有 `team` 就直接返回**，不覆盖账号态先填好的数据。
- `loadStoredContextId` / `rememberContextId` 都已导出，账号线要接管/清空存储可直接用。

## 改了哪些文件

| 文件 | 改动 |
|---|---|
| `src/lite2/store.ts` | 主体：存/取 contextId、`restoring`/`restoreError` 两个 state、`restoreSession()`、`adoptContext()`、上传时落锚点 |
| `src/lite2/stubTransport.ts` | 抽出 `isStubTransportSelected()`（`resolveTransport` 行为等价） |
| `src/lite2/transport.ts` | 新增只读导出 `storedOwnerToken(contextId)`（恢复时把 token 挂回 state；🔴 仍只进 header） |
| `src/lite2/Lite2App.tsx` | 挂载时 `void useLite.getState().restoreSession()` |
| `src/lite2/screens/TeamScreen.tsx` | 空态分三支：正在取回 / 取不回来+重试 / 原有上传引导 |
| `src/lite2/styles/lite2.css` | 上述两个新空态元素的样式（用 `--rule-strong`/`--ink-faint` 既有令牌） |
| `src/shared/i18n/en.ts` `zh.ts` | 3 条新文案 `restoringLabel` / `restoreFailed` / `restoreRetry`（只加进 `lite2` 段，v01 `lite` 段一字未动） |

后端 `eval-harness/**` **零改动**（本条纯前端），故未跑 pytest。

## 验收怎么过的

### 硬门（真跑）

```
$ npm run typecheck      # tsc -b
（零输出 = 零错）

$ npm run build          # tsc -b && vite build
✓ 503 modules transformed.
✓ built in 2.55s
（唯一警告是既有的 chunk >500kB，与本改动无关）
```

### 目测（dev server 5050 + 本地 mock 后端 8137）

⚠️ **诚实交代**：本机 8137 **没有**在跑真后端，而真 `/ingest` 要 Supabase + LLM 凭据（凭据墙，
我不碰）。所以我在 scratchpad 写了一个**只读的 HTTP 替身**（`mockback.py`，**不在仓库里**、
不随代码走）顶在 8137，只实现 feat-050 碰到的四个端点，并照真后端的规矩来：
`owner_token` 只认 `X-Avery-Token` header、缺/错一律 **404**（不是 403）。
被驱动的是**真的 `src/lite2` 传输层与真的 store 代码路径**，替身只负责回一个合法 payload。
**没有**用真公司文件、**没有**验证过真 ingestion —— 那部分本条也没碰。

浏览器实测（`?v=2&mode=live&lang=zh`，通过 `window.__lite2Store` 读真 state + 读 DOM 文本）：

| 场景 | 结果 |
|---|---|
| 干净首访 | `contextId=null, restoring=false` —— 直接上传引导，不转圈 ✅ |
| 上传后 | `lite2:contextId:v1 = "ctx-verify-050"` 落盘 ✅ |
| **刷新页面** | `hasTeam=true`、people 2 / projects 2 / files 1 / notes 1 回来，`ownerToken` 挂回，DOM 里真渲染出 briefing 标题与人卡/项目卡 ✅ **（本条的核心验收）** |
| **新开标签页**（等价"重开浏览器"） | 团队照样回来 ✅ （用的是 localStorage，不是 sessionStorage；真·关掉浏览器进程重开未做，但存储语义决定结果一致——同一份存储 feat-047 的 token 早已依赖） |
| **后端 404** | 锚点被清空（`lsContextId=null`）、team/files/notes 清干净、`ingestStatus=idle`、`restoreError=null`、DOM 回到上传引导、**console 零 error** ✅ |
| 后端挂掉（非 404） | 锚点**保住**、`restoreError="Failed to fetch"`、`restoring=false`（无限 loading 不存在）、页面出一行说明 + 重试按钮 ✅ |
| 点重试（后端恢复后） | 团队完整回来，`restoreError=null` ✅ |
| `?transport=stub` | 恢复整条跳过，真锚点 `ctx-verify-050` **原封不动** ✅ |

跑完 5050 与 8137 都已停（`Get-NetTCPConnection` 确认两个端口都 closed）。

## 没做什么

- **没碰后端**。本条纯前端。
- **没做真 ingestion 验证**（凭据墙）——见上面替身说明。
- **`refreshTeam()` 的 404 没顺手处理**：它现在 404 时只写 `ingestError`，不会像
  `restoreSession` 那样清掉死锚点。属于同一族问题但不在本条范围，动它会扩大合并冲突面。
- 没起 router、没动 `feature_list.json` / `package.json` / 根 `progress.md`（按铁律）。

## Notes（顺手看到、**没有**动的问题）

1. `src/lite2/styles/lite2.css:281` 用了 `var(--line)` —— 两个皮肤（paper/aurora）里**都没有
   定义这个令牌**，实际是 `--rule` / `--rule-strong`。这一处边框现在应该是浏览器默认色。
   我自己的新样式已避开，用的是真存在的令牌。**既有 bug，未修。**
2. `src/shared/i18n/en.ts` 里 v01 `lite` 段与 v02 `lite2` 段有大量**逐字相同**的键
   （`emptyEyebrow` / `emptyHintRoster` / …）。我加文案时必须靠 `triageAllDone` 这种
   lite2 独有键当锚才不会误伤 v01 冻结段——后续谁改 i18n 都要小心这个坑。
3. zh 页面上分诊卡的 tone 标签仍显示英文 `WORTH A CLOSER LOOK`（截图实见）。像是
   `toneLabel` 没走 i18n，属中文覆盖率遗留，不在本条范围。
