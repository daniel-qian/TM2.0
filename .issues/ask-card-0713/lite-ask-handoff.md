# feat-034 阶段 B · lite Ask 卡（stub 驱动）— per-line handoff

> 分支 `feat/034-lite-ask`（base = main `94d8f1a`），worktree `D:/avery/.claude/worktrees/ask-lite`。
> 未 merge、未 push（合流归编排者，push 留 Danny）。AFK 实现子代理 2026-07-13 完工。
> 范围 = kickoff-dev.md 阶段 B：AskCard + 契约形状 + 确定性 stub + gate-first 证据。
> **没碰**：`eval-harness/**`、`src/story/**`、冻结集、任何真后端代码。

## 1 · 契约实现形状（与 kickoff"后端契约提案"逐条对齐，additive-only）

全部类型落 `src/lite/transport.ts`（lite 本地，不进 shared——story 线各自实现，墙不破）：

- **SSE**：`LiveAgentEvent` 增可选 `kind?: 'advice' | 'ask-draft'` 与 `ask?: unknown`。
  缺省/`'advice'` = 现行 8 字段路径**零破坏**；`'ask-draft'` 帧携带 AskDraft，
  由 `streamSource.ts::applyEvent` 分流：`coerceAskDraft()`（防御性归一，与 `coerceAdvice`
  同规格；坏形状返回 null 宁可不出卡）→ `LiveRunState.askDraft` + 终端行
  "A quick ask is drafted — yours to confirm"。**ask-draft 帧不判 run 完成**（advice 帧或流收尾才收）。
- **AskDraft**：`{ id, status: 'draft'|'shared'|'collecting'|'closed', questions: 1..3 of
  { id, kind: 'scale'|'yesno', text }, recipients: [{ id, name, token?, link?, receipt? }],
  comment_prompt?, company_context_id?, created_at?, expires_at?, receipts_summary? }`。
- **回执**：`AskReceipt = { answers: [{question_id, value: number|boolean}], comment?,
  answered_at }`，**只**挂在 `AskDraft.recipients[].receipt`。🔴 `LitePerson` / `LivePersonCard`
  零新增字段——类型层没有能把答案挂到"人"身上的槽位（ADR-0023 边界 2 的结构闸）。
- **端点 ↔ transport 方法**（`LiveTransport` 增三个；HTTP 实现已按契约打好，阶段 C 起服务即通）：
  `saveAsk(draft)` = `POST /ask`（服务端 redline.validate 的落点）· `shareAsk(id)` =
  `POST /ask/{id}/share`（token+整链服务端生成，域名归属后端）· `fetchAsk(id)` =
  `GET /ask/{id}`（拉取式回收，PRD Q7）。未知 id 一律 `throw`（feat-028 大声 404 纪律，
  stub 同规格不弱化；`/advise`、`/team/{id}` 的既有 404 路径未动）。
- **不在阶段 B**：`POST /ask/{id}/revoke`（撤回 UI+状态语义一并留给阶段 C，见 §6）、
  员工侧 `GET|POST /r/{token}`（纯后端面）。

## 2 · AskCard（`src/lite/AskCard.tsx`，Room 画布内与 8 字段卡并列的第二种 artifact 卡）

状态机 = `data-ask-status` 属性（门按它断言）：

- **draft**：题目逐字可编辑（受控 input）+ 题数 1~3 内增删（scale/yesno 两个加号，越界禁用）
  + 具名受访者 chips（默认 = 当前 team 花名册全员，agent 草稿预选；aria-pressed 可点选/反选）
  + 诚实提示 `.ask-redline-note`："保存时过红线校验——该校验跑在服务端，本预览尚未跑"
  （**不假装已校验**）+ 选填短评提示展示（`comment_prompt`）。
- **确认** = `store.confirmAsk()`：`saveAsk`（阶段 C 起即红线门）→ `shareAsk` → shared。
  任一步失败 → `askError` 大声显示，卡留在 draft。
- **shared / collecting**：逐受访者 `.ask-link-row`（名字 + `https://avery.ima-read.com/r/{token}`
  整链 + 每条一个复制按钮，clipboard 拒绝时 execCommand 降级、再失败也不崩）+ 回收 chip
  （"1/2 replied"）+ 手动刷新按钮（拉取式，v1 无推送）。**shared 后题目/受访者定格**（store 层拒改）。
- **closed 回执**：单人 = 数值/是否 + `.ask-self-label`"本人自述"标注 + `.ask-receipt-comment`
  员工原话短评 + 回复时间；多人同题 = **仅** `.ask-receipt-summary` 一段定性汇总——
  组件树里不存在"每人一行 × 数值"的渲染路径（结构上无码可走，不是文案纪律）。
- 生命周期取舍（记录）：新一轮 `askLive` 起跑即撤旧 Ask 卡（与 advice 卡同生命周期，
  一题一卡）；`receipts_summary` 缺失时多人视图退回聚合计数文案（不编内容）。

store（`src/lite/store.ts`）：`ask/askBusy/askError` + `editAskQuestion/addAskQuestion/
removeAskQuestion/toggleAskRecipient/confirmAsk/refreshAsk`；ask-draft 出生帧从 run 快照
一次性"收养"进 store（之后流不再覆盖活体编辑）。

## 3 · stub 机制（`src/lite/stubTransport.ts`——既有 seam 的 tracked 实现，非平行机制）

- 就是一个 `LiveTransport`：走 transport.ts 里早已立好的 stub 通道（`store.setTransport`
  注入点）+ URL 激活 `?transport=stub`（`resolveTransport()`；缺省仍 `createHttpTransport()`，
  产品行为零变化）。全程离线、零 key、确定性。
- `ingest` 任意文件 → 固定 16 人 2 项目语料（含 Lin Qing / Chen Mingyuan，与官方 seed
  复用的名字——让既有门相位 C/E/G 在 stub 下也能跑；人卡文本**连裸数字都没有**，tenure 用
  英文数词）。`fetchTeam` 未知 id → throw（404 纪律）。
- `streamAdvise` 固定 7 帧：started → think → tool → observe → think → manifest(advice)
  → **manifest(kind:'ask-draft')**（2 题 scale+yesno、预选 2 具名受访者、问"事"不问"人"）。
  setTimeout 链 40ms（不用 rAF）。
- `saveAsk` 结构校验同真端点形（1..3 题、题文非空、受访者 ≥1；**不假装跑红线**）；
  `shareAsk` 发确定性 token `tok_{askId}_r{i}` + `https://avery.ima-read.com/r/…` 整链；
  `fetchAsk` 每次拉取多揭示一份回执（shared → collecting("1/2") → closed 可确定性重放），
  回执书写死（4/5 + yes + 原话短评等），多人齐后给定稿 `receipts_summary`（聚合口径、
  零人名×数值共现——真实现里这段话由服务端生成并过红线门）。

## 4 · 门 verdict（gate-first 全记录）

`scripts/gates/live-frontend-gate.snippet.js` 新增 K1–K6 相位 + `askVerdict()`
**独立聚合**（不并进既有 `verdict()`——真后端跑既有 10 相位时 ask 未接线，两本账各自诚实）；
协议文档 `scripts/gates/live-frontend-gate.md` 已同步（跑法 + 已知坑）。

**① 必红（实现前，2026-07-13，`?mode=live` 现行代码）**：

```json
{"askDraft":false,"askShare":false,"askCollect":false,"askReceiptsMulti":false,"askSingle":false,"askRedline":false}
```

逐相位输出：draft/share/collect/multi = `{"pass":false,"error":"no .lite-ask-card in DOM"}`；
single = `{"pass":false,"error":"Error: timeout: fresh draft ask card"}`；
redline = `{"personCards":0,…,"pass":false}`。

**② 修绿（实现后，同一新鲜会话，`npm run dev -- --port 5175` + `?mode=live&transport=stub`，
真浏览器驱动全流程）**：

```json
{"askVerdict":{"pass":true,"phases":{"askDraft":true,"askShare":true,"askCollect":true,"askReceiptsMulti":true,"askSingle":true,"askRedline":true}},
 "mainVerdict":{"pass":true,"phases":{"emptyStateClean":true,"ingested":true,"teamRendered":true,"postUploadClean":true,"detailIsLive":true,"composerIsLive":true,"teamGrouped":true,"roomCanvas":true,"playbooksEmpty":true,"visionSurface":true}}}
```

关键逐相位（原样）：

```json
K1 {"statusAttr":"draft","questions":2,"questionsInRange":true,"recipientChips":16,"selectedRecipients":2,"recipientNames":["Lin Qing","Chen Mingyuan"],"redlineNotePresent":true,"editWorks":true,"addRemoveWorks":true,"pass":true}
K2 {"expectedRecipients":2,"links":2,"linkSample":"https://avery.ima-read.com/r/tok_ask_stub_1_r1","badLinks":[],"hostOk":true,"copyButtons":2,"copyClickSafe":true,"pass":true}
K3 {"chipTexts":["1/2 replied","All replies in"],"sawPartialChip":true,"finalStatus":"closed","pass":true}
K4 {"singleBlocks":0,"summaryPresent":true,"tables":0,"nameValuePairs":[],"pass":true}
K5 {"deselectedToOne":true,"share":{"expectedRecipients":1,"links":1,"linkSample":"https://avery.ima-read.com/r/tok_ask_stub_2_r1","hostOk":true,"copyButtons":1,"copyClickSafe":true,"pass":true},"collect":{"chipTexts":["All replies in"],"finalStatus":"closed","pass":true},"receipts":{"singleBlocks":1,"selfReportedLabel":true,"verbatimComment":true,"valuesShown":2,"tables":0,"pass":true},"pass":true}
K6 {"personCards":16,"bloodBarLeak":null,"digitOnPersonCard":null,"receiptLeakOnPersonCard":false,"docScoreTables":0,"storyNounHits":0,"pass":true}
```

**③ 既有相位回归**：上表 mainVerdict——10 相位在 stub 模式同会话全 true（stub 能覆盖的
全跑了）。**需真后端的口径**（真 /ingest LLM 抽取、真 /advise SSE、真 8137 服务）＝
**skipped-needs-backend**，不谎报——阶段 C 接线后按 gate .md 用真后端重跑全套。
`./init.sh` 绿（墙 lint 0 error + tsc 零错 + vite build 成功）。

驱动侧备注（不是断言的一部分）：Browser pane 隐藏超 ~5 分钟会触发 Chrome 计时器深度节流
（链式 setTimeout ~1 次/分），足以把 4s/10s 级 poll 预算打成假红/假超时——本次实跑先装
MessageChannel setTimeout shim 再驱动（已记进 gate .md"已知坑"）。截图在隐藏 pane 下
render 不出（30s 超时），证据以 DOM verdict 为准（与门文档"截图只作参考"口径一致）。

## 5 · i18n / ZH 状态

- EN：`src/shared/i18n/en.ts` 新增 `ask.*` 命名空间（35 key），act-first 定稿。
- ZH：**已生成**（非 pending）。`scripts/i18n-zh.mjs` 新增**定向模式**
  （`node scripts/i18n-zh.mjs ask` 只把点名 section 过 M3，其余 section 从现行 zh.ts
  原样带过——避免全量重跑的 token 坑与已定稿文案 churn；无参 = 旧全量行为）。
  director brief 追加术语锁：**"Quick ask"→「快问」**（否 快速提问/问卷/调查/投票）、
  **"Self-reported"→「本人自述」**（CONTEXT.md Q10 口径）。首跑 M3 给了「快速提问」，
  锁词后重跑已正。zh.ts 其余 section 内容 byte-identical（仅文件头注释按生成器标准头重写）。
- 运行凭据：临时拷贝主 checkout 的 `eval-harness/.env`（gitignored，不入库）。

## 6 · 遗留 = 后端接线清单（阶段 C）

1. **engine 侧**：/advise 编排里判断"该问本人"时追加 `manifest{kind:'ask-draft', ask:…}` 帧
   （题目服务端 M3 生成 → `redline.validate` EN+ZH 后才出门）。前端已按缺省-advice 兼容，
   老后端不发该帧 = 无 Ask 卡，零破坏。
2. **`POST /ask`**：保存+**红线门真校验**（agent 生成与 manager 手改一视同仁，违规拒存并说明）。
   前端 `confirmAsk` 已把失败大声化（`askError`）；拒存原因的细化文案（当前是通用错误 copy
   `ask.errorGeneric`）值得阶段 C 一并做。
3. **`POST /ask/{id}/share`**：不可猜 token + `https://avery.ima-read.com/r/{token}` 整链
   服务端生成（Q6/Q11）；一人一链归属到人（Q4）。
4. **`GET /ask/{id}`**：company token 校验 + 未知/无权 404；`receipts_summary` 由服务端
   生成并**过同一红线门**（前端只原样渲染，缺失时退回聚合计数）。
5. **员工侧 `GET|POST /r/{token}`**：SSR H5（per-link OG + 透明三要素"谁在问/问什么/给谁看"
   + 大按钮 + 答完锁定 + 过期/已答/撤回状态页），ZH 默认 `lang` 切 EN——全在后端，阶段 B 未触。
6. **撤回**：`POST /ask/{id}/revoke` + 卡上撤回入口 + 状态语义（`revoked` 进 status 联合或
   `closed`+flag）——有意整体留给阶段 C（阶段 B 状态机只按拍板四态走）。
7. **7 天过期**：`expires_at` 字段已留；UI 有意**不写**"7 天过期"文案（后端未接，不说没做的事），
   接线后补 copy + 过期态呈现。
8. **真后端重跑**：去掉 `?transport=stub` 按 gate .md 重跑 K1–K6 + 既有 10 相位，verdict
   进 evidence；stub 保留为离线回归/演示通道。
9. **持久化**：ask+回执跨重启（骑 lite-v1 Supabase 层）、B 公司 token 读 A 的 ask 拒绝——
   PRD Testing Decisions 里的两条，属阶段 C 后端测试面。

## 7 · 改动清单

- `src/lite/transport.ts` — kind/ask 事件字段 + Ask 类型 + LiveTransport 三方法 + HTTP 实现
- `src/lite/stubTransport.ts` — **新**：确定性 stub + `resolveTransport()`
- `src/lite/streamSource.ts` — `LiveRunState.askDraft` + manifest kind 分流 + `coerceAskDraft`
- `src/lite/store.ts` — ask 状态/动作；默认 transport 走 `resolveTransport()`
- `src/lite/AskCard.tsx` — **新**：Ask 卡组件
- `src/lite/screens/RoomScreen.tsx` — 画布 board 内挂 AskCard（advice 卡旁）
- `src/lite/styles/lite.css` — `.lite-ask-card` 一族样式（追加，未动既有规则）
- `src/shared/i18n/en.ts` / `zh.ts` — `ask.*`（zh 经 M3 定向生成）
- `scripts/i18n-zh.mjs` — 定向 section 模式 + 术语锁 brief
- `scripts/gates/live-frontend-gate.snippet.js` — K1–K6 相位 + `askVerdict()`（既有相位与
  `verdict()` 未改动）
- `scripts/gates/live-frontend-gate.md` — Ask 相位协议 + 已知坑
- `feature_list.json` — 新增 feat-034 entry（in-progress，evidence=阶段 B）
- `.issues/ask-card-0713/lite-ask-handoff.md` — 本文件

墙自检：`src/lite/**` 零 `story` import（ESLint 墙 lint 绿）；未新增 shared 原子
（AskCard 是 lite 专属面，story 线的 scripted Ask 各自实现——确需共享时由合流者再提炼）。
