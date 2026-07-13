# feat-034 阶段 A · story scripted Ask beat — handoff（2026-07-13）

> 分支：`feat/034-story-ask`（base = main @ 94d8f1a）。不 merge、不 push（合流归本线编排者，push 留 Danny）。
> 依据：PRD Q13（story 面加性解冻）+ ADR-0023 红线边界 + kickoff-dev.md 阶段 A 纪律。

## 选了哪个 case + 理由

**bill/acme hero case（Lin Qing & the Shopping Guide demo）。**

- 三个既有 case 里唯一的人事决策叙事（Q13 要求"与谈判/价格/人事决策语义最近"；两个 errand case 是政策查询和发邮件，不沾边）。
- 它的既有 follow-up 段（alternatives for Jason）收在"Fred 最合适……whoever you ask"——**下一问天然就是"问问 Fred 本人"**。Ask 补的正是信号推不出的那块：文件说 Fred 有空档，但只有 Fred 自己知道这个 hand-off 从他那边看是什么样。零硬凹。
- PRD 的原型例子（"A 能不能负责跟乙方谈价"）没有对应 case；人事 hand-off 决策是最近邻。

## beat 形态

**第二个 FollowUpSegment**（`fred-quick-ask`，chip 锚在 alternatives 卡）+ 两个新 ThreadStepKind：

1. **`quick-ask`**（rail beat A1）：stream 里 PM 先说"文件推不出 Fred 自己的读法"→ 提议直接问本人 → 起草两问（1~5 + 是/否，问"事"）→ 一人一链 →"你分享了链接"（模拟已分享态）。Manifest = **QuickAskCard**（新组件）：受访者 Fred（像素头像+角色）、两个生成问句、"Link shared — waiting on Fred"状态 pill、透明三要素脚注（谁在问/问什么/答案给谁看）。
2. **`quick-ask-reply`**（rail beat A2）：**同卡状态推进**（无独立锚点→镜头稳在卡上）：pill 翻绿"Answered — in his own words"、刻度点亮 4/5 + 紧贴 **"Self-reported — his read on the hand-off, not a score"** 标注、原话短评（"…quick walkthrough of the guide flow with Lin Qing before I start"）→ **该短评被 stream 结论与卡内 verdict 双双引用**（walkthrough 写进 hand-off 计划）= 回执闭环价值。

**Rail 插入点 = CL 之后、B11 之前**（关键取舍）：插在 B9f 后会改变 B9b..CL 每一拍的重放状态（seek 重放前缀里多出 ask steps）；钉在 CL 后则**所有既有拍的 replay 前缀 byte 级不变**，且叙事顺位正好——hero thread 刚回屏（alternatives 卡在镜头里）→ Ask 收官 → Act 3 playbooks。

## 加性保证（机器可查）

- **锚点**：Ask 卡只许 append 在 `buildManifestGrid` 栈尾（贪心瀑布按序放列，尾部追加不动前面任何卡）。DOM 实测 5 张既有卡 slot 坐标与改动前公式值完全一致（见 evidence）。
- **rail**：`git diff main -- src/story/store/railStore.ts` = 纯插入（CL 与 B11 之间 +22 行，零删改）。
- **cases.ts** 唯一"删除行"是 `'follow-up-alternatives'` label 行尾的 `},` 挪到独立行——label 字符串 byte 级未变。
- 改动面：`cases.ts` / `NexusScene.tsx`（+19 行接线）/ `railStore.ts`（+22 插入）/ `main.tsx`（+3：CSS import，插在 58 后不动既有顺序）/ 新文件 `QuickAskCard.tsx` + `59-quick-ask.css`。**未触碰**：src/lite/**、eval-harness/**、冻结集、fixtures.ts、其余 scene、其他 case 定义。

## Evidence（全文）

### 1. `./init.sh` 绿

lint（story/lite 墙）+ `tsc -b` 零错 + vite build ✓（465 modules，dist 生成；chunk >500kB 警告为既有）。

### 2. 真浏览器驱动（vite dev :5174，`?mode=story`，DOM 断言；截图易超时故全走 DOM）

**Beat A1（Quick ask · index 28，caption "Quick ask — check with Fred himself · 26/28"）**：

```json
{
 "slots": [
  {"card":"mismatch-card","left":"717px","top":"670px"},
  {"card":"nexus-chat-card","left":"1600px","top":"720px"},
  {"card":"timeline-card","left":"493px","top":"1625px"},
  {"card":"structured-output-card","left":"1715px","top":"1710px"},
  {"card":"alternatives-card","left":"600px","top":"2530px"},
  {"card":"quick-ask-card","left":"1570px","top":"2680px"}
 ],
 "header": "Hear it from Fred first",
 "eyebrow": "Follow-up · Quick ask",
 "followUpEcho": "“Fred looks right — can we check with him directly before we hand it over?”",
 "recipient": "Fred · Prototyper · Design · One link, just for him — no login, ten seconds",
 "questions": [
  "How doable does the Thursday hand-off look from where you sit?",
  "Would you have everything you need to start tomorrow?"
 ],
 "transparency": "Fred sees exactly who’s asking, what it’s about, and that his answer comes straight back to this thread — nothing else, nowhere else.",
 "answeredBlocks": 0,
 "terminalHasFollowUpQ": true, "terminalHasSignalGap": true,
 "terminalHasShareLine": true, "terminalManifestLine": true
}
```

→ 既有 5 卡锚点 = 改动前公式值（cross-check 717/670 · human-loop 1600/720 · timeline 493/1625 · structured-output 1715/1710 · alternatives 600/2530）**逐一相等**；Ask 卡落尾列 1570/2680。问句问"事"（hand-off 可行度 / 所需材料），无一问"人"。

**Beat A2（回执 · index 29，caption "The reply — Fred, in his own words · 27/28"）**：

```json
{
 "status": "Answered — in his own words", "statusIsAnswered": true,
 "scaleAnswer": "4 of 5", "filledDots": 4, "totalDots": 5,
 "selfReportLabels": ["Self-reported — his read on the hand-off, not a score", "Self-reported"],
 "selfReportOutsideCard": 0,
 "comment": "“Happy to take the screens — I'd just want a quick walkthrough of the guide flow with Lin Qing before I start.”",
 "commentAttribution": "Fred · in his own words",
 "verdict": "His one ask — a quick walkthrough with Lin Qing — goes into the hand-off plan before anything moves. …",
 "terminalReplyReceived": true, "terminalConclusionCitesComment": true, "terminalReplyManifest": true,
 "fourOfFiveCount": 1,
 "cardHeightPx": 621, "cardTopBoard": 2370, "structuredOutputBottomBoard": 2210,
 "stepRead": "Step 9 of 9"
}
```

→ 🔴 红线断言：自述数字紧贴 "Self-reported" 标注、**全页 "4 of 5" 仅出现 1 次且在 Ask 卡内**、卡外 self-report 元素 = 0；短评被 stream 结论引用（`terminalConclusionCitesComment`）= 闭环；卡长高后顶边 2370 > structured-output 底边 2210，双列瀑布无重叠。

**人卡零新增数字（B9b Drill Lin Qing · index 15）**：

```json
{ "scene": "scene-employee", "hasQuickAskCard": false, "hasSelfReported": false,
  "hasFourOfFive": false, "hasQuickAskWord": false,
  "scoreLikePatterns": ["13 / 28", "2/2"] }
```

→ 员工页零 Ask 泄漏；仅剩的两个数字读数是 rail chrome 的 beat 进度，非人卡内容。

**未改动 case 零回归（web-search @ W4 · index 21）**：

```json
{ "cards": [
   {"card":"browser-preview-card","left":"530px","top":"740px"},
   {"card":"policy-gist-card","left":"1570px","top":"620px"},
   {"card":"compliance-card","left":"1570px","top":"1240px"}],
  "hasQuickAsk": false, "terminalHasAskLines": false,
  "terminalHasCompliance": true, "stepRead": "Step 3 of 3" }
```

**email case 抽查（E4 · index 26）**：3 卡齐（memo-draft/email-tool/slack-message），`hasQuickAsk:false`。

**CL 拍与改前状态同一（index 27）**：hero thread 回屏，恰好原 5 卡、"Step 7 of 7"、无 Ask 卡——证明插入点之前所有拍的重放不含新动作。**B11 finale**：28/28，capabilities scene 正常。

**Free-click 与 rail 同构**（ADR-0003）：CL 态点 alternatives 卡 → chip 显出（"You might also ask: Fred looks right — can we check with him directly…"）→ 点 chip → Ask 卡等待态（Step 8 of 9，Advance）→ 点 Advance → 回执态（Step 9 of 9，Hold）。与 rail A1/A2 逐步一致。

**Console**：全程零 error。

### 3. 资产加性检查

`git diff main --stat`：main.tsx +3 · NexusScene.tsx +19 · cases.ts +78/-1（-1 = `},` 挪行，见上）· railStore.ts +22（纯插入）· 新增 QuickAskCard.tsx + 59-quick-ask.css。无既有行为文件的破坏性改写。

## ZH 状态

**N/A（零新 i18n key）**——`src/shared/i18n/en.ts` 文件头明确约定：scripted story copy 住 fixtures/组件、**不进 i18n**（i18n 只覆盖 live-mode 表面）；story demo 全英文是 ADR-0015 的钉死约束（"产品全英文，第一批 pitch 在海外"）。本 beat 全部 copy 按该约定硬编码在 cases.ts / QuickAskCard.tsx，EN 已定稿。故无 key 可走 M3，无 ZH pending。

## 已知取舍（记录供抽查，均已自拍板）

1. **Ask 插在 CL 后而非 B9f 后**：为"既有拍重放 byte 级不变"牺牲了"紧跟 alternatives 出场"的紧凑感；换来的是加性可机器验证 + Act 3 前的收官位其实叙事更顺。
2. **回执 = 同卡状态推进**（非第二张卡）：省一个锚点、镜头天然稳在卡上看着它翻牌；代价是 `quick-ask-reply` 无独立 manifest 卡（其 MANIFEST 终端行 ref 回 `quick-ask` 卡，点击仍可飞达）。
3. **卡 half 按回执态预留**（h:380，实测回执态 half≈311）：等待态取景略松；余量防重叠，与 timeline 卡"实测+余量"同口径。
4. **新 follow-up chip 会出现在既有拍**：B9f 之后任何拍若 Danny 点 alternatives 卡，chip（新 UI 元素）会显出——这是 follow-up 机器的既有行为对新段的自然延伸，属加性 affordance，未视为回归。
5. **beat 进度分母变化**：rail caption 的 "n / m" 从 26 变 28（派生 chrome，非语义）。
6. **feature_list.json 未动**：feat-034 无既有条目；姊妹线（feat/034-lite-ask）同期施工，两线各自加条目必撞合并冲突——按 kickoff"合流由编排者做"留给编排者登记。
7. **stepContextPct 补了 84/88**：该字段现无渲染消费者（P6-04 已撤 Context% HUD），补齐仅为数据形状一致。

## Restart 指引

worktree：`D:/avery/.claude/worktrees/ask-story`（分支 feat/034-story-ask）。复验：`npm install && ./init.sh`，`npm run dev -- --port 5174` 后开 `http://localhost:5174/?mode=story`，→ 键走到 26/28、27/28 两拍即 Ask beat；或 free-click：Nexus 走完 hero + follow-up 后点 alternatives 卡 → chip → Advance。
