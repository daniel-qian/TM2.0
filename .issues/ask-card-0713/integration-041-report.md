# integrate/041-into-main · 跨线整合报告（2026-07-14，AFK 子代理）

> 把持久化链 `feat/041-e2e-broadcast`（feat-030..041 全链尾，base=旧 main 2bda603）合并进
> `integrate/041-into-main`（base=当前 main 3a9cf5c，含 feat-034 Ask 卡全部工作 + 阶段 C 契约钉稿 373f9e9）。
> 原则：两线功能取并集，谁的领域听谁的。未 push；不动 main ref；全部工作留在整合分支。

## 分支状态

- 整合分支 tip：见文末（merge commit + 本报告 commit）。
- merge commit：`cb11a2c`（parents = 373f9e9 × 9e5a725）。
- eval-harness/** 整层与 feat/041 tip **byte 级一致**（我们线零改动，diff 为空）。
- 冻结集：FROZEN.lock.json 17 个文件 sha256 全部复核通过（NONE violations）。

## 冲突逐文件解法（6 个 UU，全部并集，零侧丢弃）

| 文件 | 冲突 | 解法 |
|---|---|---|
| `src/lite/transport.ts` | 3 处：类型块 / LiveTransport 方法 / HTTP 实现 | 并集。Ask 契约（AskDraft/AskReceipt/AskRecipient + saveAsk/shareAsk/fetchAsk）与 file-space/notes 契约（LiveFileEntry/LiveNoteEntry + fetchFiles/fetchNotes）全保留；owner_token 机器（loadTokenStore/authHeader/rememberToken，header-only）原样保留。**增量对齐阶段 C 契约**：`saveAsk` 现随 `authHeader(draft.company_context_id)` 带 X-Avery-Token（有 token 则带，无则空——stub/离线不破坏）；share/fetchAsk 只有 askId 无处取 context，header 接线整体留给阶段 C（端点+校验一起落，不预造假接线），代码内有注释记录。 |
| `src/lite/store.ts` | 3 处：imports / 初始 state+goScreen / askLive 回调 | 并集。imports 合一（type-only union + `resolveTransport`——保留我们的 `?transport=stub` 默认接线，`createHttpTransport` 不再直接引）；`ask/askBusy/askError` state 与 `noteJustAdded` 清理（goScreen 切屏消 nudge）并存；askLive 回调 = **ask-draft 一次性收养分支 + advise 落定拉笔记亮 nudge 分支**串联（settled 哨兵原样），起跑 set 同时清 ask 态与 noteJustAdded。 |
| `src/lite/styles/lite.css` | 1 处（块级） | 并集：feat-034 `.lite-ask-card` 全族 + feat-033 `.lite-notes` 全族都保留（各自补回被冲突吃掉的收尾 `}`）。 |
| `src/shared/i18n/zh.ts` | 1 处（文件头注释） | 并集：保留他们侧 feat-032/033 HAND-WRITTEN 警示（仍为事实——notes*/filesTitle 键未过 M3），追加一行 NOTE：feat-034 已给生成器补了**定向 section 模式**（`node scripts/i18n-zh.mjs ask`），上述手写键可按同法折入。正文两侧键全在（ask.* 35 键 + notes*/filesTitle/tabNotes）。 |
| `scripts/gates/live-frontend-gate.snippet.js` | 1 处（块级） | 并集：K1–K6 ask 相位 + `askVerdict()`（独立聚合）与 `assertNotesSurface()` 都保留；`verdict()` 主聚合 = 11 相位（原 10 + notesSurface，auto-merge 已带上）。 |
| `feature_list.json` | 1 处（尾部条目） | 并集 + id 序拼接：feat-030..033 → **feat-034** → feat-038..041（36 条，JSON 校验通过）。 |

## 合并后修复（同在 merge commit 内，非独立 commit）

- **`src/lite/stubTransport.ts`**：LiveTransport 并集后新增 `fetchFiles`/`fetchNotes` 两方法，stub 必须实现（否则 tsc 红、stub 流断）。补了确定性实现：
  - `fetchFiles` 诚实回显本会话真上传的文件名/大小（mime 取 File.type），`n_chunks`/`uploaded_at` 确定性写死并注明是占位（真值归后端 materials 链接）——**不假装持久化**（跨重启是后端的活）；
  - `fetchNotes` 每完成一次 advise 追加一条观察（与真后端"advise 落定→写侧落库"同节奏），新→旧；🔴 笔记文本零数字、零评分/排名（ADR-0023 渲染面复核可过）；
  - 两者未知 context/未 ingest 一律大声 404（feat-028 纪律）。
- 无其他源码修复。auto-merge 正确处理了 LiteApp/LiteTopbar（5 tab 并集 + mode 开关默认藏）、RoomScreen（AskCard + notes nudge 并存）、UploadPanel（your files 视图）、en.ts（section 并集）、main.tsx。
- `progress.md`/根 `session-handoff.md`：他们线自 base 起未触碰这两个文件（叙事在 .issues/lite-v1-lean-real-0713/** 与各 feat session-handoff），无需并集，auto-merge 即正确。

## 门证据（全在整合 worktree 实跑）

### 1. `./init.sh` — 绿

lint 墙（lite 不 import story）0 error + `tsc -b` 零错 + vite build ✓（468 modules）。

### 2. 离线后端套件 — 绿（= 他们侧基线）

```
cd eval-harness && python -m pytest -q -m "not seedgate and not smoke"
474 passed, 42 skipped, 7 deselected, 1 xfailed in 22.36s
```

无 DB 凭据环境下 @needs_db 全部干净跳过（42 skipped），零红。474 passed 与 feat/041 广播基线逐字相等。

### 3. 真浏览器（vite dev :5180，未占 5173/5174/8137）

**lite stub 门**（`?mode=live&transport=stub`，注入 tracked snippet，同一新鲜会话跑全流程）：

```json
{"mainVerdict":{"pass":true,"phases":{"emptyStateClean":true,"ingested":true,"teamRendered":true,"postUploadClean":true,"detailIsLive":true,"composerIsLive":true,"teamGrouped":true,"roomCanvas":true,"playbooksEmpty":true,"visionSurface":true,"notesSurface":true}},
 "askVerdict":{"pass":true,"phases":{"askDraft":true,"askShare":true,"askCollect":true,"askReceiptsMulti":true,"askSingle":true,"askRedline":true}}}
```

关键逐相位（原样）：

```json
K1 {"statusAttr":"draft","questions":2,"questionsInRange":true,"recipientChips":16,"selectedRecipients":2,"recipientNames":["Lin Qing","Chen Mingyuan"],"redlineNotePresent":true,"editWorks":true,"addRemoveWorks":true,"pass":true}
K2 {"expectedRecipients":2,"links":2,"linkSample":"https://avery.ima-read.com/r/tok_ask_stub_1_r1","badLinks":[],"hostOk":true,"copyButtons":2,"copyClickSafe":true,"pass":true}
K3 {"chipTexts":["1/2 replied","All replies in"],"sawPartialChip":true,"finalStatus":"closed","pass":true}
K4 {"singleBlocks":0,"summaryPresent":true,"tables":0,"nameValuePairs":[],"pass":true}
K5 {"deselectedToOne":true,"share":{"links":1,"hostOk":true,"pass":true},"collect":{"finalStatus":"closed","pass":true},"receipts":{"singleBlocks":1,"selfReportedLabel":true,"verbatimComment":true,"valuesShown":2,"tables":0,"pass":true},"pass":true}
K6 {"personCards":16,"bloodBarLeak":null,"digitOnPersonCard":null,"receiptLeakOnPersonCard":false,"docScoreTables":0,"storyNounHits":0,"pass":true}
notesSurface {"screenPresent":true,"trustNotePresent":true,"populated":true,"entryCount":1,"numberLeak":null,"entryIsButton":false,"storyHits":[],"pass":true}
```

**他们的新面在 stub 下诚实渲染（非白屏/非假数据）**：

- 文件空间（Your team 屏 "Your files" 段）：`{"filesSectionPresent":true,"title":"Your files","fileRows":["roster.xlsx 27 B · 3 references","roadmap.pdf 27 B · 4 references"]}` — 回显真上传文件名/真字节数。
- Avery's notes tab：advise 落定后 populated（entryCount 1，红线信任条在，条目只读、零数字）；未跑 advise 时是诚实空态（同断言 pass）。

**owner_token 接线不破坏 stub 流**：stub 全程零 token 走通上面全部相位；网络面板对 `:8137` **零请求**（stub 全离线）；header 逻辑只活在 HTTP transport（`authHeader` 无 token 时给空对象，不硬要求）——无需修复，原设计即豁免。

**story mode**（`?mode=story`，→/← 键驱动 rail）：

- A1（caption "Quick ask — check with Fred himself · 26 / 28"）：`{"waitingPill":true,"answered":false,"shareChips":["WeCom","Teams","Slack","Email","Copy link"],"hasCopyLink":true}` — 等待态 + 分享排齐。
- A2（caption "The reply — Fred, in his own words · 27 / 28"）：`{"answered":true,"selfReportedLabel":true,"verbatimComment":true,"fourOfFivePage":1,"fourOfFiveCard":1,"selfReportOutsideCard":0,"shareRowGone":true,"sharedViaLine":"Shared via one link · answered in 40s"}` — 已答态；"4 of 5" 全页仅 1 处且在卡内；self-report 零外泄。
- mode 开关：live 与 story 默认 DOM 无 `[class*="mode-switch"]`；`?modeSwitch=1` 时两壳都有（`{"modeSwitchWithParam":true}` 双双验证）。

**console**：live stub 会话与 story 会话全程零 error（error-filtered console 为空）。

### 4. 墙 + 冻结集

- 墙 lint（lite 不 import story）：init.sh 内 `npm run lint` 0 error。
- 冻结集与 feat/041 tip 一致：`git diff feat/041-e2e-broadcast -- eval-harness/` 为空（byte 同）；FROZEN.lock.json 17 文件 sha256 全 match。

## 驱动侧备注（非断言）

- 隐藏 pane 计时器节流（gate .md 已知坑）实跑再次命中：stub 40ms 链的最后一 tick（写笔记+onDone）被推迟约一分钟，K5 前的 composerAskLive 假超时一次。装 MessageChannel setTimeout shim 后全部消失。断言零改动。
- `composerAskLive` 只认 `.composer-card`（Your team 屏的 LiteComposer）；Room 屏的追问 composer 是 `nexus-followup-composer`——重跑前须先切回 Your team tab（gate .md 可考虑补一句，未改）。

## 遗留（给下一波/阶段 C）

1. **ask manager 侧 owner_token header 收尾**：`saveAsk` 已带（authHeader by company_context_id）；`shareAsk`/`fetchAsk` 仅有 askId，header 接线随阶段 C 端点落地一起做（届时后端按 ask→context 映射校验 + 404-on-mismatch）。
2. kickoff-dev.md 阶段 C 追加清单 F1–F3 原样有效（status 词表 fail-loud、stub 假链接标记、coerce 收紧）。
3. zh.ts feat-032/033 手写键（notes*/filesTitle/tabNotes）待定向 M3 折入（`node scripts/i18n-zh.mjs upload lite` 类跑法）+ Danny 审字。
4. stub `fetchFiles` 的 `n_chunks/uploaded_at` 是注明的确定性占位；阶段 C 真后端接通后 files/notes 相位按 gate .md 用真后端重跑。
5. push / 合 main：留 Danny（本分支不动 main ref）。

## 本次改动 commits（integrate/041-into-main）

- `cb11a2c` merge(integrate/041)：合并本体 + 6 冲突解 + stubTransport 补 fetchFiles/fetchNotes。
- 本报告 commit：见 `git log -1`。
