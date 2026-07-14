# session-handoff · feat-044（v02 A closer look 矛盾点独立页）

> 写于 2026-07-14。分支 `feat/044-v02-closer-look`（从 `feat/043-v02-triage-followups` 起），
> 主 checkout 承接（同编排形态：每 feature 一个 AFK 实现子代理在主 checkout 承接分支跑
> gate-first 全流程）。**未 merge main、未 push**。下一棒交给 main 编排做对抗验证，clean
> 后推进 feat-045（onboarding 向导 + chips + 铃铛）。
>
> 本文件覆盖 feat-043 遗留的同名文件——历史棒的细节留在各自 commit 与 `progress.md` 的
> 对应 Update 节（feat-043 见 `progress.md` "2026-07-14 · feat-043"）。

## 分支与提交

```
feat/044-v02-closer-look（从 feat/043-v02-triage-followups 起，落盘前请以 git log 实际输出为准）
```

commit 顺序（按落盘时机，语义边界不变，粒度可能微调）：

1. `docs(v02): 门先行 — gapVerdict C 组 3 相位 + 出生即红实证`
   — `scripts/gates/live-frontend-gate.snippet.js` 新增 `assertGapsDerive`/`assertGapsResolve`/
   `assertGapsToAsk`/`snapshotGaps`/`gapVerdict`，头注释登记用法；同 commit 内含
   `stubTransport.ts` 的语料前置改动（给 `pr_portal` 加真实矛盾 blocker，供门跑出非零结果）
   与三处旧注释的准确性更新；实现前真跑一遍记录红态。
2. `feat(v02): A closer look 矛盾点独立页 — gapDerive.ts + CloserLookScreen 真实现`
   — 本节下方"实现清单"全部内容。
3. `docs(v02): feat-044 done — evidence + progress + handoff`
   — `feature_list.json` 状态更新 + `progress.md` 新节 + 本文件。

## 实现清单（对照 kickoff-dev.md §feat-044）

| 项 | 落地 |
|---|---|
| stub 语料前置 | `stubTransport.ts`：`pr_portal`（status on-track）加一条 blocker——原语料零"自述读稳但 blocker 说另一回事"的真实案例（`pr_pilot` 本就自认 at-risk，blocker 与自述一致非矛盾）。副作用：`teamData.ts liveHandoffs()` 现在也给 `pr_portal` 派生一张晨间分诊卡（诚实行为，非回归——已在 B 组门相位复跑确认零破坏，见下）。 |
| 矛盾派生 | `gapDerive.ts`（新文件，纯函数）：`deriveGaps(team) -> GapCard[]`，只读 `LiteProject` 字段；启发式 = `status` 读稳（on-track/steady）且 `blockers` 非空 → 一张卡；`claim` 引 `project.summary` 原文，`evidence` 引 blocker 原文行，二者均可溯源零捏造；id = `gap_${projectId}_${blockerIdx}`（稳定）。已自述 at-risk/blocked 的项目不算矛盾。 |
| marks + 持久化 | `flowStore.ts` 扩展：`gapMarks: Record<string,'resolved'\|'dismissed'>` + `resolveGap/dismissGap/restoreGap` + `selectGapsActive/Resolved/Dismissed`（同 triage marks 分桶模式，不重复派生）。并入既有 `lite2:flow:v1` localStorage blob（`PersistedShape` 加 `gapMarks` 字段，向后兼容旧 blob 缺该字段）。 |
| 屏幕 | `CloserLookScreen.tsx` 整屏重写替换 feat-042 占位：对照卡（左 `.lite-gap-pane-claim` "What the files say" / 右 `.lite-gap-pane-evidence` "What the signals show"，sage/terracotta 左边条区分语气非红绿评判色）+ 四个卡操作（`.lite-gap-resolve` Settled 厘清 / `.lite-gap-dismiss` Let it go 先放一放 / `.lite-gap-ask` Ask them directly 直接问本人 / `.lite-gap-addfollowup` Add to follow-ups 加入跟进，source=`closer-look`）+ 历史折叠区（`.lite-gap-history*`，默认折叠，已厘清/已搁置两种徽章 `is-resolved`/`is-dismissed`）+ 空态（`.lite-gap-empty`，"Nothing worth a closer look right now"）。所有交互元素带 `data-gap-id`/`data-gap-status` 稳定属性（同 feat-043 打回教训：门断言按 id 追踪不按文本）。 |
| 真接线 | "Ask them directly" 复用 feat-043 验证过的 `setComposerDraft(text)` + `goScreen('room')` 机制（RoomScreen 挂载时消费一次），预填 `${projectTitle}\n\n${claim}\n${evidence}`——含项目引用+矛盾上下文，零人身评判语。"Add to follow-ups" 真写 `flowStore.addFollowup({source:'closer-look', ...})`（`FollowupSource` 类型早在 feat-043 就含 `'closer-look'`，本棒是第一次真消费）。 |
| CSS | `lite2.css` 新增 ~280 行，全 `.lite2-shell` 前缀，卡片语法沿用 `.home-handoff` 家族（hairline 边框/圆角/柔阴影），零新造视觉语言；aurora 皮下已抽查渲染正常（令牌自动消费，无需 `[data-skin]` 分支）。 |
| i18n | `en.ts`：旧 4 个占位 key（`closerLookEyebrow/Title/Body/ComingSoon`）**整体退役**，不复用同名 key 承载新内容——规避"同 key 换新义、旧 ZH 译文误留"的风险（feat-043 硬提醒的同类坑）。新增 16 个 `gap*` key。`zh.ts` 经 `scripts/i18n-zh-lite2-delta.mjs` 重跑（老 key 自然从输出消失、16 新 key 全部当真 delta 送 M3，防复发规则命中"零旧 key 误保留"）；人工核对发现 `gapRestoreLabel` M3 首译"重新打开"与既有锁定词（`followupsRestore`/`triageRestoreLabel`，同源 EN "Bring it back"）已锁定的「放回来」不一致，已手工对齐——**delta 脚本不做跨 key 一致性校验**，此类同义词对齐仍需人工过一遍 diff。 |

## 门证据（gapVerdict，C 组，实测，非模板）

**实现前（真跑，红是成功）**：

```json
{
  "pass": false,
  "phases": { "gapsDerive": false, "gapsResolve": false, "gapsToAsk": false },
  "results": {
    "gapsDerive": { "bannedHits": [], "gapCards": 0, "hasAddFollowup": false, "hasAsk": false, "hasClaimPane": false, "hasDismiss": false, "hasEvidencePane": false, "hasResolve": false, "nameDigitPairs": [], "pass": false },
    "gapsResolve": { "error": "no gap cards to act on", "pass": false },
    "gapsToAsk": { "error": "no gap card to act on", "pass": false }
  }
}
```

**实现后（真跑，绿是收工）**：

```json
{
  "pass": true,
  "phases": { "gapsDerive": true, "gapsResolve": true, "gapsToAsk": true },
  "results": {
    "gapsDerive": { "bannedHits": [], "gapCards": 1, "hasAddFollowup": true, "hasAsk": true, "hasClaimPane": true, "hasDismiss": true, "hasEvidencePane": true, "hasResolve": true, "nameDigitPairs": [], "pass": true },
    "gapsResolve": { "badgesDistinct": true, "dismissLeavesActive": true, "dismissPersisted": true, "dismissedBadgeText": "Let go", "dismissedInHistory": true, "gapId": "gap_pr_portal_0", "pass": true, "resolveLeavesActive": true, "resolvePersisted": true, "resolvedBadgeText": "Settled", "resolvedInHistory": true },
    "gapsToAsk": { "composerValueSample": "Onboarding Portal RevampRebuilding the internal onboarding portal around the new checklist flow.The new checklist flow still needs sign-off from Ops — nobody ha", "containsProjectRef": true, "pass": true, "projectTitle": "Onboarding Portal Revamp", "switchedToRoom": true }
  }
}
```

- `gapsDerive`：stub 语料（`pr_portal`，on-track 但有 blocker）诚实产出 1 张矛盾卡；`bannedHits:[]` = whole-screen 扫 `gap`/`Nexus`/`差距`/`现实差距` 零命中；`nameDigitPairs:[]` = 复用 Ask 红线的 `_askValueRe` 对全团队花名册（先在 Your team tab 收集，因屏幕互斥挂载）逐一扫描，人名与数字/yes/no 60 字符内零共现。
- `gapsResolve`：resolve→撤销→dismiss→撤销 两段式序列在**同一张**诚实卡上复测（stub 只诚实产生 1 张矛盾卡，不为凑数虚构第二张，同 `triageActions`/`followupsFlow` 纪律）；两个 mark 均确认写进 `lite2:flow:v1` 的 `gapMarks` 字段（in-page 直读 `localStorage`）；两个历史徽章文案不同（Settled vs Let go，状态可视觉区分）。
- `gapsToAsk`：卡上 "Ask them directly" → 切到 The room，composer 预填值含项目标题引用，不自动提交。

### 补充证据：真实整页 reload 持久化（非 `gapVerdict()` 聚合内相位）

kickoff-dev.md 对 C 组只列 3 个相位名（不同于 B 组明确列了独立的 `followupsPersist`），本棒解读
为"聚合 key 数不变，但持久化证据仍要给够"——除 `assertGapsResolve` 内置的 in-page localStorage
直读外，额外走了一遍真实 reload（同 `readSkinSnapshot`/`snapshotFollowups` 的驱动侧手工补充
模式，`snapshotGaps()` 辅助函数已就位）：

```
resolve 一张卡 → localStorage.getItem('lite2:flow:v1') 读出 gapMarks:{"gap_pr_portal_0":"resolved"}
→ 真实整页 reload（浏览器 navigate，非 SPA 内导航）→ 重新 fetch+eval 注入门
→ 同 key 读出仍是 gapMarks:{"gap_pr_portal_0":"resolved"}
```

证明走的是 `flowStore.ts` 那条已被 feat-043 `followupsPersist` reload 实证过的同一条手写同步
save/load 代码路径（`gapMarks` 只是复用同一个 `lite2:flow:v1` blob 里的新字段），不是新起一套
持久化机制。若下一棒或对抗验证认为应该正式化为独立的 `gapsPersist` 聚合相位，改动成本低。

## 零回归证据（同分支复跑，v01/story/v2Verdict A 组/flowVerdict B 组/askVerdict）

```json
{
  "v01_verdict": { "pass": true, "phases": { "emptyStateClean": true, "ingested": true, "teamRendered": true, "postUploadClean": true, "detailIsLive": true, "composerIsLive": true, "teamGrouped": true, "roomCanvas": true, "playbooksEmpty": true, "visionSurface": true } },
  "askVerdict": { "pass": true, "phases": { "askDraft": true, "askShare": true, "askCollect": true, "askReceiptsMulti": true, "askSingle": true, "askRedline": true } },
  "v2Verdict_A_group_recheck": { "v2Boots": true, "v1Untouched": true, "storyUntouched": true, "skinTokens": true },
  "flowVerdict_B_group_recheck": {
    "triageRenders": { "triageCards": 2, "bloodBarLeak": null, "hasCheck": true, "hasDiscard": true, "hasTakeToRoom": true, "hasAddFollowup": true, "pass": true },
    "triageActions": { "doneWorks": true, "drawerHasItem": true, "discardWorks": true, "roomWorks": true, "pass": true, "title": "Take a look at Pilot Launch — Hangzhou Store" },
    "followupsFlow": { "pass": true, "sourceLabelOk": true, "leftActive": true, "movedToHistory": true, "restored": true },
    "followupsPersist": { "pass": true, "missing": [] }
  }
}
```

- `triageRenders.triageCards` 从 feat-043 记录的 1 变成 2——**诚实反映**本棒给 `pr_portal` 加的
  blocker（`liveHandoffs()` 派生逻辑本就是"status=at-risk 或 blockers 非空"，未改此逻辑本身）；
  `triageActions`/`followupsFlow` 仍定位到第一张卡（`pr_pilot`，payload.projects 数组顺序不变），
  行为与断言目标零变化。
- `wallRed`（本棒抽查 story→lite2 一个方向，临时注入违规 import → `npm run lint` exit 1 → 撤回
  → exit 0）：未逐一复跑全部 4 方向，因 `eslint.config.js` 本棒零改动（`git diff
  feat/043-v02-triage-followups -- eslint.config.js` 空输出确认，wallRed 机制本身未受任何触碰）。
- `git diff feat/043-v02-triage-followups -- src/lite/ src/story/ eval-harness/`：空输出，v01/
  story/eval-harness 冻结未破。

## init.sh

```
npm run lint       — 0 errors, 4 warnings（3 条 story/lib/useRailCamera.ts 既有 noInlineConfig
                      警告 + 1 条 feat-043 遗留的 RoomScreen.tsx 同款警告——已知无害模式）
npm run typecheck  — clean
npm run build      — 497 modules（feat-043 基线 496，+1：gapDerive.ts）
```

## i18n 自查（session-handoff 硬提醒的收口纪律）

`git diff feat/043-v02-triage-followups -- src/shared/i18n/`：

- `en.ts`：仅删 4 个旧 `closerLook*` 占位 key + 增 16 个新 `gap*` key，零其他改动。
- `zh.ts`：同步仅此 20 个 key 的增删，其余既有 key（含 F2/F3 的 `triage*`/`followups*` 全家族、
  `footerText`、`tabCloserLook` 等）逐字节零漂移——diff 输出已逐行核对，无意外改动。

## 偏离 kickoff 之处

1. **stub 语料前置改动超出"只加 gapDerive.ts + 屏 + 门"的字面描述**：给 `pr_portal` 加一条
   blocker，是让 `gapsDerive` 门相位能脱离"0 卡恒红"状态的必要前提（原语料没有一个"自述读稳
   但 blocker 说另一回事"的真实案例）。已在门文档三处旧注释（`assertTriageRenders`/
   `assertTriageActions` 附近 + 头注释）同步更新，避免文档与语料脱节；副作用（分诊卡从 1 张
   变 2 张）已在零回归证据里逐项确认非破坏。
2. **C 组持久化证据未正式化为第 4 个聚合相位**：kickoff-dev.md 对 C 组只写"gapsDerive/
   gapsResolve/gapsToAsk"3 个相位名（对比 B 组明确列了独立 `followupsPersist`）——本棒解读为
   刻意的 3 相位设计，用 in-page localStorage 直读（`assertGapsResolve` 内置）+ 驱动侧手工补的
   真 reload 快照对比（`snapshotGaps()`，不进 `gapVerdict()` 聚合）两条证据满足"reload 后状态
   保持"的要求，未新增第 4 个聚合 key。若下一棒/对抗验证认为应该正式化，改动成本低。

## 遗留 / 给 feat-045 的提示

- `gapRestoreLabel` 的 M3 首译（"重新打开"）与既有锁定词（`followupsRestore`/
  `triageRestoreLabel`，同源 EN "Bring it back" 已锁定「放回来」）不一致，已手工对齐——**delta
  脚本不做跨 key 译法一致性校验**，feat-045 继续加新 key（onboarding 向导/chips/铃铛的文案）时
  仍需人工过一遍 `zh.ts` diff，抽查是否有同义 EN 源被 M3 译出不同的中文说法。
- 历史折叠区现在有三套相似但不完全相同的折叠展开视觉语言：`.lite-gap-history*`（本棒新增）、
  `.lite-followups-history-list` + subtab（feat-043）、`.home-drawer*`"Taken care of today"
  （feat-043 沿用 story 既有类）。非阻塞，可留 feat-046 aurora 精修阶段视觉审计时一并考虑是否
  收敛成一套通用折叠组件（当前三处均功能正确，只是三套 CSS/交互细节各自实现）。
- `CloserLookScreen.tsx` 的"Ask them directly"与 feat-043 分诊卡的"带进议事室"共用同一个
  `flowStore.composerDraft` 桥——如果 feat-045 的 chips（room 空态建议问题）也要做类似预填，
  可以复用同一机制，不必另起一套状态。**注意：composerDraft 的内容会进 `<input type="text">`，
  换行会被剥掉——多段上下文用 " — " 一类行内分隔符拼接（本棒 i18n 打回复验时修过的同根坑，
  两处预填构造器已改）。**

## 追记 · i18n 打回复验（2026-07-14，fix commit）

对抗验证 gate 路/redline 路 CONFIRMED_SAFE、i18n 路 ISSUES_FOUND 打回，fix commit 追加于
本分支（不改历史）：①Blocker-锁定词：gap* ZH 文案的「档案」违反全 app「文件」词族——
`gapCardClaimLabel`→PRD F4 原文「文件里的说法」、`gapPageTitle`→「文件说的和实际读到的，
对不上的地方」（同步消灭「读数」误译，EN "the read"=解读非仪表读数）、`gapPageBody` 改文件
词族+动词与按钮文案对齐；自查发现 `gapCardEvidenceLabel`「信号显示的」也偏离 kickoff 规格
原文，一并改「实际信号」。②composer 预填吞换行（同根 bug 授权跨棒修）：CloserLookScreen
ask 预填与 TeamScreen take-to-room 预填（feat-043 文件）的 `\n` 改 " — "。③`gapDerive.ts`
claim 兜底句从自拟叙事改机械状态读出（`Reported status: "on-track"`）。复验：tsc 绿；grep
zh.ts 零「档案」——「读数」仅剩 `footerText`（**feat-042 锁定值、043 打回时明令逐字节恢复的
域外值，本棒不动**，是否另案处理已上报编排）；浏览器清 localStorage 重驱 `gapsDerive`
`{gapCards:1,bannedHits:[],nameDigitPairs:[],pass:true}`、`gapsToAsk`（预填
"Onboarding Portal Revamp — Rebuilding... — The new checklist flow..." 分隔可读，
`containsProjectRef:true,pass:true`）、`triageActions` 复跑 pass:true（B 组断言不受影响）；
`?lang=zh` 运行时新四值真渲染、屏上零档案零读数；i18n diff 范围复核不变；init.sh 绿
（0 error/4 既有 warning、tsc 0 错、build 497 模块）。
**给下一棒的硬提醒**：新增 ZH 文案先对全 app 词族 grep 一遍（本次「档案 vs 文件」正是
M3 独立翻译撞出的词族漂移，delta 脚本不做词族校验）；composerDraft 预填只能用行内分隔符。
