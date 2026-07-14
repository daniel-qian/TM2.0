# session-handoff · feat-045（v02 onboarding 向导 + 建议 chips + 通知铃铛）

> 写于 2026-07-14。分支 `feat/045-v02-onboard-nudges`（从 `feat/044-v02-closer-look`@23b6f28 起），
> 主 checkout 承接（同编排形态：每 feature 一个 AFK 实现子代理在主 checkout 承接分支跑
> gate-first 全流程）。**未 merge main、未 push**。下一棒交给 main 编排做对抗验证，clean
> 后推进 feat-046（aurora 皮精修）。
>
> 本文件覆盖 feat-044 的同名文件——历史棒的细节留在各自 commit 与 `progress.md` 的
> 对应 Update 节（feat-044 见 progress.md "2026-07-14 · feat-044" + 追记）。

## 分支与提交

```
feat/045-v02-onboard-nudges（从 feat/044-v02-closer-look@23b6f28 起）
  c37ca11 docs(v02): 门先行 — nudgeVerdict D 组 4 相位 + 出生即红实证（feat-045）
  8419291 feat(v02): onboarding 向导 + 空态 chips + 真事件铃铛（feat-045，PRD F5+F7）
  <本文件所在> docs(v02): feat-045 done — evidence + progress + handoff
```

## 实现清单（对照 kickoff-dev.md §feat-045 / PRD F5+F7）

| 项 | 落地 |
|---|---|
| 向导状态 | `onboardStore.ts`（新）：unseen→in-progress→skipped/done 生命周期；× 关闭 = session-only pause（`pausedThisSession` 不持久化），下次访问从记住的 step 续进度；skip = 持久化 skipped 永不再弹；团队信息（company/dept/yourName，本地配置）+ 8 项 playbook 勾选（默认勾 3）；`lite2:onboard:v1` 手写同步 load/save（同 flowStore 模式与理由——persist 中间件首帧闪空态）。`PLAYBOOK_CATALOG` 持稳定 id + i18n selector，copy 不写死两处。 |
| 向导 UI | `OnboardWizard.tsx`（新）：覆盖层非路由，四步 `data-onboard-step=upload/team/playbooks/done`。①上传**真调 `store.uploadFiles`**（与 UploadPanel 同一条 ingest 路径；stub 即时就绪；可 Next 跳过）②团队信息三输入 ③8 项 toggle（`data-playbook-id` + aria-pressed）④完成页问候（用称呼）+ 所选摘要（`.lite-onboard-summary-item[data-playbook-id]`）。**无假连接工具步、无假账号步**（PRD F7 明令）。进度用 dots 不用编号（ADR-0015 对编号 wizard 步骤的取向）。 |
| Playbooks 槽位 | `PlaybooksScreen.tsx`：`status==='done' && picks.length>0` → 槽位=所选（标题+一句人话+Coming 标，`data-playbook-id` 稳定属性）；否则回落 feat-025 三条通用槽**零变化**（skipped/中途关闭不算"选过"，不替用户做主）。company 非空时补一行「为 {company} 设置」。 |
| chips | `RoomScreen.tsx` 空态：4 chips（`data-chip-id`=attention/project-risk/handoff/next-week），点击即 `askLive`（拍板原文"点击即发问"，不走 composer 预填）；措辞泛化零语料预设。 |
| 铃铛 | `notifyStore.ts`（新）：`initNotifications()` 里 `useLite.subscribe` 订阅真状态转移——ingest（ingesting→ready）/ run（running→complete）/ 快问收齐（ask.status→closed，`seenAskIds` 去重）/ 新矛盾卡（team 变化后 `deriveGaps` 新 id，`seenGapIds` 去重，派生复用 gapDerive.ts 不长第二份）；`lite2:notify:v1` 持久化（items+两个去重集）；`_push` 只被订阅调用，**组件层无造通知入口**（结构性护栏，同 flowStore 对数字字段的思路）。`LiteBell.tsx`（新）：铃铛+未读徽章+kind→泛化 i18n 文案（永不点名员工）+点击跳对应 tab（ingest→team/run→room/ask→room/gap→closerlook）+Mark all read+诚实空态。挂 LiteTopbar **nav 之外**（v2Boots 按 `.scene-tabs .scene-tab` 数 6 tab，铃铛不得混入）。 |
| CSS | `lite2.css` +548 行，全 `.lite2-shell` 前缀，只消费皮肤令牌——aurora 自动跟随，零 `[data-skin]` 分支（aurora 下铃铛 pop/chips 已 DOM 抽查）。 |
| i18n | EN 62 新 key 手写定稿；ZH 走 `scripts/i18n-zh-lite2-delta.mjs`（幂等实证：恰 62 delta 送 M3、84 沿用 zh.lite、57 既有 approved 零覆盖）。M3 词族漂移 **13 处手工对齐**（详见下）。 |

## 门证据（nudgeVerdict，D 组，五页协议实测，非模板）

**实现前（真跑，红是成功——commit c37ca11）**：

```json
{"pass":false,"phases":{"onboardPersist":false,"onboardSkip":false,"chipsAsk":false,"bellIsReal":false}}
```

（walkthrough `sawWizard:false` 10s 轮询零 `.lite-onboard`；persist `slotIds:[]`；chips `chipCount:0`；bell `"no .lite-bell-toggle in DOM"`。）

**实现后（真跑，绿是收工）**：

```json
{"pass":true,"phases":{"onboardPersist":true,"onboardSkip":true,"chipsAsk":true,"bellIsReal":true}}
```

- `onboardPersist`：walkthrough 真走四步——真上传 `uploadReady:true`、勾选集改为与默认不同
  （默认 `[onboarding-handover,stuck-project,weekly-review]` → 所选
  `[handoff-cover,stuck-project,tough-conversation,weekly-review]`）、完成页摘要与所选精确相等、
  问候含称呼（"Danny"）→ 真 reload → 向导不再出现（2.5s 轮询确认）+ Playbooks 槽位
  `data-playbook-id` 集合与所选**精确相等**（`exactMatch:true`，非计数）+ 全带 Coming 标
  （`allTagged:true`）。
- `onboardSkip`：清态首访向导出现 → skip 关闭 → reload → 永不再弹（`wizardStaysAway:true`）。
- `chipsAsk`：`{chipCount:4, chipIds:[attention,project-risk,handoff,next-week], idsDistinct:true,
  textsNonEmpty:true, clicked:true, framesSeen:1, pass:true}`——点击即真 askLive，SSE 帧渲染
  （复用 F2 动态断言形状）。
- `bellIsReal`：`{initialItems:0, emptyMarker:true, ingestOk:true, afterIngestKinds:[gap,ingest],
  ingestExact:true, runOk:true, finalKinds:[gap,ingest,run], finalExact:true, badgeShown:true,
  markAllWorks:true, pass:true}`——清态零通知+空态标记（断"无占位假通知"）；ingest 后事件类型
  **精确多重集** `[gap,ingest]`（stub 语料诚实含一处矛盾 `gap_pr_portal_0`，新矛盾卡事件与
  ingest 同拍触发——精确匹配把它算进去而不是装看不见）；run 后恰 `[gap,ingest,run]` 不多不少；
  未读徽章 + Mark all read 清零实证。

## 零回归证据（同分支复跑）

```json
{
  "v01_verdict_10phase": { "pass": true, "phases": { "emptyStateClean": true, "ingested": true, "teamRendered": true, "postUploadClean": true, "detailIsLive": true, "composerIsLive": true, "teamGrouped": true, "roomCanvas": true, "playbooksEmpty": true, "visionSurface": true } },
  "askVerdict_6phase": { "askDraft": true, "askShare": true, "askCollect": true, "askReceiptsMulti": true, "askSingle": true, "askRedline": true },
  "v2Verdict_A_group": { "v2Boots": true, "v1Untouched": true, "storyUntouched": true, "wallRed": true, "skinTokens": true },
  "flowVerdict_B_group": { "triageRenders": true, "triageActions": true, "followupsFlow": true, "followupsPersist": true },
  "gapVerdict_C_group": { "gapsDerive": true, "gapsResolve": true, "gapsToAsk": true }
}
```

- v01 十相位在默认 URL（`?mode=live&transport=stub`）跑——`playbooksEmpty` 仍是 3 条通用槽
  = v01 未受 lite2 Playbooks 改动影响的旁证；`v1Untouched` 零 `.lite2-shell`。
- askVerdict：K1-K4 与 K5-K6 分两个页面会话跑完（中间被 vite full-reload 打断，见下"驱动侧
  新坑"②）——按门既有"驱动侧携带 JSON 跨页"惯例组装聚合；K5 补跑时须先 `_clickTab('Your team')`
  （v01 `.composer-card` 只在 TeamScreen，K4 结束停在 The room）。
- `wallRed`：本棒抽查 lite2→story 方向（临时注入 `import '../story/data/cases'` →
  `npm run lint` exit 1 → 撤回 → exit 0）；未逐一复跑 4 方向，因 `eslint.config.js` 本棒
  零改动（diff 空输出确认，同 feat-044 口径）。
- `?mode=story`：零 `.lite2-shell`、零 `.lite-bell`、零 `.lite-onboard`。
- `git diff feat/044-v02-closer-look -- src/lite/ src/story/ eval-harness/`：空输出，冻结未破。

## 驱动侧新坑（已写进门文档头注释，下一棒必读）

1. **Page-E 清键时序**：chipsAsk 点完 chip 后 run 还在流（stub 7 帧 ×40ms），此时清
   `lite2:*` 键，run 完成的通知 push 会把 `lite2:notify:v1` **写回去**——bellIsReal 首绿被
   此坑打红一轮（`initialItems:1` 残留 run 通知）。须在稳定页（无 run 在流）清键再 reload。
2. **vite 被别线 worktree 触发 full-reload**：`.claude/worktrees/**` 下其他线的 worktree
   （本会话观测到 ask-stage-c / ask-docfix）文件变动（尤其 tsconfig）会让 dev server 对本页
   full-reload——门跑一半被刷会丢 in-page results（`__seedGate` 直接消失）。对策：分块跑、
   逐相位取回 JSON、按"驱动侧携带 JSON"惯例组装聚合；被刷后重注入+重 ingest 即可续跑，
   evidence 不受影响。

## init.sh

```
npm run lint       — 0 errors, 5 warnings（3 条 story/useRailCamera 既有 + 1 条 feat-043
                      RoomScreen 遗留 + 1 条本棒 OnboardWizard 同款 noInlineConfig 无害注释）
npm run typecheck  — clean
npm run build      — 501 modules（feat-044 基线 497，+4：onboardStore/notifyStore/
                      OnboardWizard/LiteBell）
```

## i18n 自查（session-handoff 硬提醒的收口纪律，本棒兑现）

`git diff feat/044-v02-closer-look -- src/shared/i18n/`：

- `en.ts`：纯新增 62 个 key（onboard* 34 + playbook 目录与槽位 19 + chips 5 + bell/notif 9 +
  playbooksForCompany 等），零删除零改既有。
- `zh.ts`：0 删除 / 恰 62 行新增；既有 key（含 `footerText`、gap*/triage*/followups* 全家族）
  逐字节零漂移——diff 逐行核对过。
- **锁定词族 grep（翻完先 grep 再收工）**：zh.ts 全文零「档案/差距/现实差距/指挥室/Nexus/
  房间/剧本/小提问/团队视图」；「读数」仅剩 `footerText`（feat-042 锁定域外值，不动）。
- **M3 词族漂移 13 处手工对齐**（delta 脚本不做跨 key 一致性校验——feat-044 硬提醒的坑
  如期复发，逐处对照既有锁定译法修正）：房间→**议事室**（tabRoom）、剧本→**打法/操作手册**
  （playbooksSlotIncident「固定打法」先例 + tabPlaybooks，含一处漏网 playbookOnboardingBody
  在 `?lang=zh` 运行时抽查中被 banned-word 扫描抓到后补修）、小提问→**快问**（ask.eyebrow）、
  团队视图→**团队已就绪**（upload.readyLabel，同 EN 源 "Your team is ready"）、待启用→**即将**
  （visionTagComing，同 EN 源 "Coming"）、通知「几处」→「一处」（一卡一通知语义）。
- `?lang=zh` 运行时抽查：向导四步/铃铛通知真渲染 ZH，议事室/解读/多看一眼/团队已就绪在屏。

## 偏离 kickoff 之处（已记录，非阻塞）

1. **聚合命名**：kickoff 字面写"v2Verdict 加 D 组相位"，实作沿 B/C 组已确立的每组独立聚合
   惯例（flowVerdict/gapVerdict）命名 `nudgeVerdict()`——语义与 kickoff §feat-045 列的
   4 相位名完全一致，只是不塞进 v2Verdict 的 5 相位聚合里。
2. **"称呼供问候语用"的消费点**：目前两处——向导完成页问候 + Playbooks 屏「为 {company}
   设置」行。更广的问候位（如 Your team 头部晨间问候）动既有屏结构，留 feat-046 视觉精修
   一并定（配置已持久化，接入零成本）。

## 追记 · 对抗验证打回复验（2026-07-14，fix commit）

gate 路 CONFIRMED_SAFE（含验证者自选勾选集/敌意 grep/中途续跑三探针）、i18n 路
CONFIRMED_SAFE、redline 路 ISSUES_FOUND 一个 blocker，fix commit 追加于本分支（不改历史）：

- **Blocker · 向导不响应 Escape**：`role="dialog" aria-modal="true"` 弹层零键盘退出路径，
  键盘用户被困。修法 = OnboardWizard `useEffect` 挂 `window` keydown 监听，Escape 调
  `pause()`（与 × 等价：进度保留、下次续跑），卸载时 remove（Escape → pause → 组件
  unmount → cleanup 即时注销，零全局监听残留）。门补 **D 组第 5 相位
  `assertOnboardEscape`**（先红后绿：修前真跑 `closedOnEscape:false` 复现 blocker；修后绿
  = Escape 关弹层 + localStorage status 仍 `in-progress`（非 skipped/done）+ 前进过的
  step=team 保留 + reload 后向导续跑于 team 步旁证 pause≠dismiss）；`nudgeVerdict` 聚合
  4→5 相位，驱动协议五页→六页（头注释已同步）。
- **非阻塞 · bellIsReal 补 NOTIF_TARGET 路由断言**：点 gap 通知 → `data-scene` 切
  `closerlook` + 该条 `is-unread` 消失（`routeClicked/routedToCloserLook/clickedItemRead`
  三键），之后才 Mark all read——路由接线原先实现了但门从未行使（对抗验证指出的覆盖缺口）。
- **非阻塞 · 工作树复核**：`public/__gate_verify.js` 不存在且 `git log --all` 全历史零记录，
  无需清理。
- 复验：D 组六页协议重驱全绿
  `{pass:true,phases:{onboardPersist:true,onboardEscape:true,onboardSkip:true,chipsAsk:true,bellIsReal:true}}`；
  `npx tsc -b` 绿；init.sh 绿（0 error / 5 warning 基线不变、501 模块）。
- 备注：工作树里 `kickoff-dev.md` 存在编排侧未提交附录（§6 并 main 计划，"回执 main 编排
  广播"落款）——非本棒所属，未并入本棒任何 commit、原样保留，由编排自行落盘。

## 遗留 / 给 feat-046（aurora 精修）的提示

- **DetailOverlay 缺 Escape（对抗验证点名的既有惯例，本棒不修）**：lite2 `DetailOverlay.tsx`
  同为浮层且无键盘退出路径（v01 lite 同源拷贝的既有行为）——feat-046 候选：加同款
  Escape=close 监听（OnboardWizard 实现可照抄；`closeDetail()` 无进度语义，比向导更简单）。
- **词族抽查顺带发现（域外，零改动，上报编排定夺）**：既有 key `playbooksSlotIncident`
  （zh.lite 与 zh.lite2 同值）用「会议室」指 The room，与锁定词「议事室」不一致——zh.lite
  属冻结 v01 不可动；zh.lite2 该值是 verbatim 沿用且经过早期对抗验证。是否另案处理由编排拍。
- feat-045 的三个新表面（向导覆盖层/铃铛 pop/chips）已按令牌自动吃 aurora 皮（DOM 抽查过），
  但**未逐屏截图精修**——feat-046 过 aurora 时把这三处纳入对照清单（尤其向导 backdrop 的
  遮罩色 rgba(30,27,22,.35) 是写死的暖调，aurora 冷调下或需 `[data-skin]` 分支）。
- 历史三套折叠语法收敛的建议仍然有效（feat-044 遗留），feat-046 视觉审计一并看。
- 铃铛通知目前**不做**"正在看着的 tab 不通知"的抑制（run 完成时人就在 The room 也会+1）——
  demo 场景够用且行为诚实；若试玩反馈觉得吵，抑制逻辑加在 notifyStore 订阅层一处即可。
- B/C 组门复跑若在清态页上做，记得先 skip 向导（首访覆盖层会挂着；相位用 JS click 不受
  遮挡影响，但 bodyText 类扫描会把向导文案算进去）。
