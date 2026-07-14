# session-handoff · feat-036（v02 晨间分诊区 + Follow-ups 跟进区）

> 写于 2026-07-14。分支 `feat/036-v02-triage-followups`（从 `feat/035-v02-shell` 起），主 checkout 承接
> （同编排形态：每 feature 一个 AFK 实现子代理在主 checkout 承接分支跑 gate-first 全流程）。
> **未 merge main、未 push**。下一棒交给 main 编排做对抗验证，clean 后推进 feat-037（A closer look）。
>
> 本文件覆盖 feat-035 遗留的同名文件——鉴于本 epic 的既有约定是"每棒一份最新交接"，历史棒的细节
> 留在各自 commit 与 `progress.md` 的对应 Update 节（feat-035 见 `progress.md` "2026-07-14 · feat-035"）。

## 分支与提交

```
feat/036-v02-triage-followups（从 feat/035-v02-shell 起，落盘前请以 git log 实际输出为准）
```

commit 顺序（按落盘时机，语义边界不变，粒度可能微调）：

1. `docs(v02): 门先行 — flowVerdict B 组 4 相位 + 出生即红实证` — `scripts/gates/live-frontend-gate.snippet.js`
   新增 `assertTriageRenders`/`assertTriageActions`/`assertFollowupsFlow`/`snapshotFollowups`/
   `assertFollowupsPersist`/`flowVerdict`，头注释登记用法；实现前真跑一遍记录红态。
2. `feat(v02): 晨间分诊三动作 + Follow-ups 真实屏 — flowStore + draftLinks + 五处改动`
   — 本节下方"实现清单"全部内容。
3. `docs(v02): feat-036 done — evidence + progress + handoff`
   — `feature_list.json` 状态更新 + `progress.md` 新节 + 本文件。

## 实现清单（对照 kickoff-dev.md §feat-036）

| 项 | 落地 |
|---|---|
| triage 派生 | **不重新派生**——直接消费 `teamData.ts liveHandoffs()` 既有真派生（`team.handoffs`），`flowStore.ts` 只加 `triageMarks` + 三个纯函数选择器（`selectTriagePending/Handled/SetAside`）按 mark 分桶。理由：避免红线审计过的 handoff 派生逻辑在两处各长一份。 |
| 三动作 | done→`.home-check`→`markTriageDone`；discard→`.home-discard`→`discardTriage`；带进议事室→新 `.lite-triage-room`→`setComposerDraft`+`goScreen('room')`（只预填不自动提交）。 |
| "今天已照料"堆 | 复用 story 同款 `.home-drawer`/`.home-drawer-toggle`/`.home-drawer-list`/`.home-drawer-item`（`src/shared/styles/70-home-cards.css` 既有类，不新造视觉语言）；默认折叠。 |
| Follow-ups slice | `flowStore.ts`：`FollowupItem{id,title,source,dueGroup,note?,done,doneAt?,createdAt}`，`addFollowup/completeFollowup/reopenFollowup/deleteFollowup/editFollowup`。 |
| Follow-ups 屏 | `FollowupsScreen.tsx` 整屏重写：今天/本周/之后分组 + 手动添加表单 + Active/History 两个 subtab + 逐条编辑/删除/起草邮件。 |
| 真接线（禁止假按钮） | 分诊卡"加入跟进"（`.lite-triage-addfollowup`）+ advice 卡 Recommended actions 每条一个"加入跟进"（`.lite-advice-add-followup`，source=room）均真写 `flowStore.addFollowup`。 |
| mailto 起草深链 | `draftLinks.ts`：`draftMailForHandoff`/`draftMailForFollowup`，收件人留空，`encodeURIComponent` 手写（不用 `URLSearchParams`，避免 mailto 对 `+` 的解析歧义）。 |
| localStorage 持久化 | `flowStore.ts` 手写同步 load/save（key `lite2:flow:v1`），**不用** zustand `persist` 中间件——其 `hydrate()` 走 Promise 链会有一帧空态闪烁窗口；手写版 store 创建时即最终态。 |
| i18n | `en.ts` 新增 43 key（`triage*`/`followups*`/`adviceAddFollowup`/`followupAdded`），删 2 个不再用的 coming-soon 占位 key；`zh.ts` 经 `scripts/i18n-zh-lite2-delta.mjs` 重跑（84 复用 + 45 delta 送 M3）。 |

## 门证据（flowVerdict，B 组，实测，非模板）

**实现前（真跑，红是成功）**：

```json
{
  "pass": false,
  "phases": {
    "triageRenders": false,
    "triageActions": false,
    "followupsFlow": false,
    "followupsPersist": false
  },
  "note": "2026-07-14 born red：?v=2&mode=live&transport=stub 下分诊区已渲染 1 张卡（既有 liveHandoffs() 派生），但卡上零 .home-check/.home-discard/.lite-triage-room/.lite-triage-addfollowup；Follow-ups 屏 .lite-followup-item 计数 0（仍是 feat-035 的 coming-soon 占位）。"
}
```

**实现后（真跑，绿是收工）**：

```json
{
  "pass": true,
  "phases": {
    "triageRenders": true,
    "triageActions": true,
    "followupsFlow": true,
    "followupsPersist": true
  },
  "results": {
    "triageRenders": { "triageCards": 1, "bloodBarLeak": null, "hasCheck": true, "hasDiscard": true, "hasTakeToRoom": true, "hasAddFollowup": true, "pass": true },
    "triageActions": { "doneWorks": true, "drawerHasItem": true, "discardWorks": true, "roomWorks": true, "pass": true },
    "followupsFlow": { "hasSourceLabel": true, "sourceLabelText": "From this morning", "leftActive": true, "movedToHistory": true, "restored": true, "pass": true },
    "followupsPersist": { "pass": true }
  }
}
```

- `triageRenders`：stub 语料（1 个 at-risk 项目、1 条 blocker）诚实产出 1 张分诊卡，卡上四个真控件全在、零人身数字泄漏（`BLOOD_BAR_RE` 零命中）。
- `triageActions`：**同一张卡**做 done→撤销→discard→撤销→带进议事室 三段式序列（stub 只有 1 张诚实卡，不为凑测试虚构第二张）；done 后 pending 计数掉且条目进抽屉，discard 后立即消失，带进议事室后 composer 值含条目标题。
- `followupsFlow`：分诊卡"加入跟进"→ Follow-ups 屏出现新条目、来源标签 "From this morning" → 勾完成离开 active 列表 → History tab 出现 → 点 Bring it back → 回到 active 列表。
- `followupsPersist`：写入后整页 reload（`localStorage` 而非纯内存态），条目仍在（跨导航快照对比，模式同 `v2Verdict` 的 `readSkinSnapshot`/`assertSkinTokens`）。

## 零回归证据（同分支复跑，v01/story/v2Verdict A 组）

```json
{
  "v01_verdict": { "pass": true, "phases": { "emptyStateClean": true, "ingested": true, "teamRendered": true, "postUploadClean": true, "detailIsLive": true, "composerIsLive": true, "teamGrouped": true, "roomCanvas": true, "playbooksEmpty": true, "visionSurface": true } },
  "askVerdict": { "pass": true, "phases": { "askDraft": true, "askShare": true, "askCollect": true, "askReceiptsMulti": true, "askSingle": true, "askRedline": true } },
  "v2Verdict_A_group_recheck": { "v2Boots": true, "v1Untouched": true, "storyUntouched": true, "skinTokens": true, "wallRed": "见下方独立记录" }
}
```

- `wallRed`（本棒亲自复测，4 方向逐一临时注入违规 import → `npm run lint` exit 1 → 撤回 → exit 0）：
  `lite2→story`/`story→lite2`/`lite→lite2`/`lite2→lite` 全部先红后绿；`git status`/
  `git diff --stat main -- src/lite/ src/story/ eval-harness/` 复位后确认零字节改动（过程中撞到一次
  Windows 下 `git status` 对 `src/lite/store.ts`/`src/story/lib/useRailCamera.ts` 报 `M` 但
  `git diff --numstat` 显示零变更的 CRLF/LF 索引噪音——`git checkout --` 清理确认，非真实内容改动）。

## init.sh

```
npm run lint       — 0 errors, 4 warnings（3 条 story/lib/useRailCamera.ts 既有 noInlineConfig
                      警告 + 1 条 RoomScreen.tsx 新增同款警告——eslint-disable-next-line 在本仓库
                      noInlineConfig 配置下本就无效，是已知无害模式，不是新问题）
npm run typecheck  — clean
npm run build      — 496 modules（feat-035 基线 494，+2：flowStore.ts + draftLinks.ts）
```

## 门辅助脚本的一个 bug（非产品代码，已修入 snippet.js）

`snapshotFollowups()` 最初在点击 `.lite-followups-subtab` 后立刻同步读 DOM，捕获了 React 批处理
提交前的旧渲染，误判"同一条目同时出现在 active 与 history 两个视图"。加 200ms settle 后复测：
history 正确为空、active 正确只含 1 条。已在 `live-frontend-gate.snippet.js` 内加注释存档，
避免下一棒（feat-037 写 C 组门相位时）踩同一个坑——**任何 subtab/tab 切换后紧跟着的 DOM 读取都
应该走 poll 或至少一次 settle，不能假设点击后同步生效**。

## 偏离 kickoff 之处

无重大偏离。本棒**严格执行了 gate-first**：先写 B 组 4 相位断言、对着未实现的代码真跑确认红
（红态 JSON 见上）、再动手实现、再复跑绿——修正了 feat-035 交接记录里的纪律偏离（feat-035 的门
文档是实现完之后才补的，DOM 相位没能证明"出生即红"）。

## 遗留 / 给 feat-037 的提示

- Follow-ups 编辑目前只支持标题+分组，不支持改来源标签或 note——如果 feat-037/038 需要更丰富的
  编辑，可以在 `flowStore.editFollowup` 的 patch 类型上直接扩展（已经是 `Partial<Pick<...>>` 形状，
  加字段成本低）。
- advice 卡的"加入跟进"是逐条 recommended action 一个按钮（`.lite-advice-add-followup`），视觉上
  略密——非阻塞，可留 feat-039 aurora 精修阶段顺手收窄成单一"全部加入"或折叠态。
- `src/lite2/flowStore.ts` 的 `composerDraft` 桥目前只服务"分诊→议事室"这一条路径；feat-037 的
  "直接问问本人"→ room 预填快问语境，如果也要走 composer 预填（而非直接开一张新 Ask 草稿），可以
  复用同一个 `setComposerDraft`/`consumeComposerDraft` 机制，不必另起一套状态。
- `.home-drawer*`（今天已照料堆）与 `.home-check`/`.home-discard`（分诊三动作）现在被 v01 story
  的 `70-home-cards.css`（shared，非 lite2 专属）和 lite2 的晨间分诊共用同一套类名与视觉语言——
  这是有意为之（PRD 明确"沿用 sage/honey/terracotta 左边条语法"），feat-037 的矛盾卡"解决/忽略/
  历史"如果视觉语言相近，可以考虑复用而非重新设计一套。

## 追记 · i18n 打回复验（2026-07-14，fix commit）

对抗验证 i18n 路打回后按修复单在本分支追加 fix commit（不改历史）：锁定词 `triageDrawerLabel`
恢复「今天已照料」；5 个被 bf1fce0 越权重译的域外 ZH 值（closerLook* ×4 + footerText）用
`git show feat/042-v02-shell` 原文精确恢复；「重新激活」→「放回来」；自查一并修掉三处同类
锁定词违约（会议→议事室、随手一问→快问）；`assertFollowupsFlow` 加固为按 `data-followup-id`
稳定 id 追踪 + 来源标签精确断言；`scripts/i18n-zh-lite2-delta.mjs` 加「已有 zh.lite2 译文优先
保留」防复发（幂等实测：重跑 zh.ts hash 不变、零 M3 调用）。复验：tsc 绿、清 localStorage 重驱
followupsFlow/followupsPersist 两相位绿、`?lang=zh` 运行时抽查命中、init.sh 绿。
**给下一棒的硬提醒**：收口自查必须包含 `git diff <上一棒分支> -- src/shared/i18n/`，确认既有
key 值零漂移——delta 脚本现在虽已防复发，但任何手工/脚本改动 zh.ts 都应过这一遍。
