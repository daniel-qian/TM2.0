# feat-014 working notes — Card home "Your team" (Morning Desk A+)

Ticket: GH issue #9. Spec of record lives there + ADR-0017. This file = implementation order, checkpoints, found-issues.

## Implementation order (self-loop)

1. **Store**: `canvasStore.ts` — Scene union + 'home'; initial scene 'home'; back() → 'home'.
2. **Fixtures**: `fixtures.p3.ts` (or new `fixtures.home.ts`) — HOME_HANDOFFS (4 items anchored in hero case), eyebrow line, closing line, evidence tags keyed to person/project ids. All English copy `⚠ 待 Danny 审字`.
3. **Scene**: `HomeScene.tsx` — two columns; left Today spine (deal-in stagger, ink-check SVG, Handled-today drawer, counter, completion state), right lanes (people/projects, linked-evidence dim via hovered handoff id), map entrance link.
4. **Shell/Topbar**: render 'home' in AmbientCanvasShell; Topbar 'Your team' → 'home' (map tab removed).
5. **Rail**: B1/T1/T2 → 'home'; B2 step 1 → goScene('dashboard')+setFocus(p_acme); B10 → regen+`home`. Composer on home (askQuestion).
6. **CSS**: global.css additions from existing tokens; reduced-motion + focus-visible.
7. **Verify**: ./init.sh; npm run dev via preview tools (entry, 3 actions, dimming, completion, map beat, full rail seek sweep, ?capture=1).
8. **Checkers**: claire (spine/presentation) + dana (human-feel/red line) on built page, maker≠checker.
9. Evidence → feature_list.json; progress.md; close loop.

## Guardrails (from reviews, enforce in code review pass)

- No numbers on people anywhere on home (capacityPct/moodPct never rendered).
- No "no rush"-style urgency judgments in counter copy; warm lines sparse.
- Ink-edge tone colors ≠ ratings; terracotta copy must read warm not alarm.
- Map never auto-opens; entrance is restrained + persistent (top-right of lanes), NOT lane tail.
- Rail replay idempotent from pristine at every index; capture mode unaffected.

## Checkpoints

- [x] store + fixtures compile（tsc -b 零错）
- [x] HomeScene renders static（DOM 快照：4 卡 + 8 人卡 + 6 项目卡 + composer + 全景链接）
- [x] interactions（done 墨迹→抽屉→计数 / discard / restore / 收尾屏 / fly→nexus / 双地图入口 / back-chip）
- [x] linked-evidence dimming（改为 CSS 类驱动 .has-link/.is-lit；transition:none 旁路断言 0.35/scale1.02/tag 浮现）
- [x] rail sweep（idx1 home B1 / idx3 map focus 簇 8 / idx4-6 drill+ask / idx16 B10 grown 切换 headline v2 + "Caught and owned" / r restart 清勾选 / c capture 藏 chrome）
- [x] init.sh green（tsc -b + vite build 1.27s）
- [x] checkers PASS（claire：三必达改进逐行核实、5 条不阻塞建议；dana："没有把我的人变成分数"、3 条文案建议。7 条建议已修：收尾句去 board、Kate 标签 When you pass by、Caught and settled、依据签去 nowrap、focus ring、收尾-discard 中性版、抽屉 done/set-aside 分计数 + doneLabel 死代码清理。修后 ./init.sh 复绿 + DOM 复验通过。）

## Implementation notes（实现期决策，含偏差）

- 勾选态在独立 `homeStore`（非 canvasStore——契约冻结 + rail seek 不应抹掉现场勾选）；rail `restart()` 连带 reset。
- 退场不用 AnimatePresence exit（headless 下 presence 卸载不可靠且环境 rAF 停摆难排查）：手动两段式 inking(550ms)→leaving(240ms)→移除+layout 补位；per-card Set 并行，不锁其他卡。
- 联动 dim/lit/依据签全走 CSS（.has-link 类 + keyframes），不依赖 JS 动画帧。
- openMap() 先 setFocus(null)——全景入口落 calm，不带残留 focus。
- composer 抽取为 TeamComposer 共享组件（focusReference prop 保留回迁口）；地图页 `.scene-dashboard .composer-*` CSS 覆盖成为死代码，未清（out of scope）。

## Found issues (out of scope — do not fix here)

- headless 预览环境 rAF 完全停摆（背景标签节流）：framer 插值/CSS transition 插值/截图全部不可观测，setTimeout 也被节流出竞态。已知问题的更重表现（feat-006 记录过截图超时）。行为验证只能靠 DOM 断言 + transition:none 旁路；视觉最终目测归 Danny。
- `.scene-dashboard .composer-reference-chip` 等覆盖规则（global.css ~1886-1921）在 composer 迁出后为死 CSS。
