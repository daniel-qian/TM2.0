# Session Handoff — 2026-07-03 收盘（feat-014 卡片主页 + 投资人路演 landing / ADR-0018）

> **本仓库 (`D:\avery`) 干净、与 origin 同步（`59461bb`）、可 restart。** 只靠本文件 +
> `progress.md` + `feature_list.json` 即可接上，不要回放聊天记录。两条今日线的完整记录：
> feat-014 见 `feature_list.json` evidence + `.issues/feat-014/plan.md`；路演 landing 见
> `.issues/roadshow-landing-0703/session-handoff.md`。2026-07-01 及更早的 handoff 已被本文件覆盖。

## 0 · 一句话现状
今天两条线都收束：**① feat-014「Morning Desk」卡片式今日主页**（合伙人 checklist 硬需求）done + 真机目测回环闭合，
demo 的「Your team」从全屏地图换成 checklist-first 卡片主页（地图降级为页内全景，ADR-0017）；
**② 投资人路演 landing 重构**（18 屏 → 7 屏投资叙事）已上 production，并带来**宪法级 ADR-0018**（定调变更）。
git 全推 `origin/main`；**tm2 production 有意停在审字前部署**（见 §4）。

## 1 · 今日 shipped（别重做，往上叠）
- **feat-014（GH #9，done）**：新 `HomeScene` = 默认「Your team」——左脊柱今日 Handoff checklist
  （墨迹勾选 → Handled-today 抽屉 → 安静计数 → 前辈收尾屏）+ 右双轨证据层（人卡全定性、hover 联动点亮/降透明/
  依据签）；composer 抽为 `TeamComposer` 随迁；勾选态在独立 `homeStore`（canvasStore 契约未扩）；地图 tab 移除、
  经「See it on the map / whole picture」进入；rail B1/T1/T2→home、B2=地图高光拍、B10→home+grown checklist。
  领域：`CONTEXT.md`（Dashboard 重定义 + 新概念 Team map）+ **ADR-0017**。
  双 checker PASS（claire 骨架 / dana 红线人味），7 条建议已修；Danny 真机抓的两处 UI 重叠已修（`59461bb`）。
- **路演 landing（另一线，已合并 `2588dc7`）**：7 屏投资叙事，production `avery-jade.vercel.app`（`?lang=zh`）；
  **ADR-0018** + CONTEXT.md/roles.md 同步；slug 只留 "Managers need safer HR decisions"。

## 2 · 锁定事实（不要 re-litigate；★ = 今日新增/变更）
- **★ ADR-0018（宪法级，写任何文案前先读新版 CONTEXT.md 定调段）**：「人情味/前辈人设」从产品真理降为**红线**；
  新产品真理 = **管理决策层**。dashboard/效率/ROI/商业语言不再被否决。红线永远有效：①绝不量化/评判/标签化一个人；
  ②不让被讨论者觉得"被处理"。数字新规见 ADR-0018 §3。Dana 职责收窄为红线门神（tone 意见降为建议）。
- **★ ADR-0017**：demo 进门第一面 = 卡片式今日主页；地图 = 页内 Team map 子视图（回退成本已写进 ADR）。
- **★ ADR 编号**：0017 = feat-014 card home；0018 = 定调修订。别撞号，下一篇从 0019 起。
- 品牌 Avery、全英文海外优先、中文一律 MiniMax-M3 生成（不自写）；商业模式 advisor 免费 + playbooks 付费；
  ADR-0016 果断双向。standing 约束不变：不动 rail replay 机器 / store 契约(ADR-0013) / camera(ADR-0012) /
  terminal-stream(ADR-0014) / 内部命名 / ADR 历史 / archived。
- **feat-014 交互实现纪律**（下次动 HomeScene 先知道）：退场不用 AnimatePresence exit（手动两段式 inking→leaving）；
  联动 dim/lit 纯 CSS 类驱动；滚动在 `.home-scroll` 内层（composer 锚视口底，别把 overflow 挪回 scene）。

## 3 · 仓库当前态（干净、可 restart）
- `main` = `origin/main` = `59461bb`；单 worktree；untracked 仅有意本地件：`.claude/` `.codex/`
  `assets/0630-partner-docs/`（合伙人 IP）`assets/logo-v0.png` `eval-harness/for-partner.zip`。
- 验证：`./init.sh` 绿（tsc -b 0 错 + vite build ~1.3s，feat-014 修复后复跑）。
- 已知环境坑（写进 feat-014 evidence）：headless 预览标签 rAF 停摆 → framer/CSS 动画插值与截图均不可机测，
  验证用 DOM 断言 + `transition:none` 旁路；动画手感永远归真机目测。

## 4 · 留给 Danny 的 HITL
- **审字**：feat-014 全部新英文 copy（集中 `src/data/fixtures.home.ts`，另 railStore 新 caption / map-back-chip）；
  路演 landing `en.ts` 新文案（尤其 "we're raising" 口径）。微决策两枚：hh_pitch "goes out today" 与依据签重复；
  "Handled today" 词义（已 done/set-aside 分计数）。
- **tm2 promote**：production 停在 feat-014 前部署（tm2-osj7dqiwv）。审字通过后 `vercel promote` 最新部署
  即上新主页——**agent 不得代做**。
- 旧账未变：真人 eval 评分（发布闸）、合伙人 IP 具名授权、avery loop cite-before-number、路演三追问预演。

## 5 · 下一步（按优先级，非本 session 遗留义务）
1. Danny 审字 → promote tm2 → 合伙人看新主页（他的 checklist 硬需求就是 feat-014 的缘起）。
2. 营销主战场仍在 `D:\Boyle\marketing-resource\avery`（其 handoff 自带；注意 ADR-0018 后定调已变，
   该工作区交接里的"senior at your ear"口径需按新 CONTEXT.md 校对）。
3. 顺手账（不急）：死 CSS 清理（`.scene-dashboard .composer-*` ~1886-1921 + feat-004 时代 `.nexus-inspector` 等）。

## 6 · 指针
- feat-014：GH issue #9（已 close，含完成 comment）· `docs/adr/0017-card-home-demotes-team-map.md` ·
  `.issues/feat-014/plan.md` · evidence 在 `feature_list.json`
- 路演线：`.issues/roadshow-landing-0703/session-handoff.md` · `docs/adr/0018-renqingwei-demoted-to-redline-product-truth-decision-layer.md`
- 定调/红线：`CONTEXT.md`（ADR-0018 后新版）· ADR-0015/0016/0018
- 角色班子：`roles.md`（Dana 已收窄为红线门神）
