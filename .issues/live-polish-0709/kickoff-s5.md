# S5 kickoff — feat-025 lite 模块补齐(Playbooks 空态 + 按拍板的 map/画板)

⚠ 前置:S4 的 triage-report.md 已出、Danny 已拍板范围。没拍板别开工。

工作区:git worktree(从 main 最新),分支 `feat/025-lite-modules`。开场读:根 session-handoff.md + `.issues/live-polish-0709/{plan.md,triage-report.md}`(拍板结果)+ feature_list feat-025。启动 ./init.sh 绿再动工。

## 使命(feat-025)
- **Playbooks 空态屏(必做)**:lite 加 Playbooks 屏/入口,当前无数据 → 干净空态(引导文案说明"接入你的 SOP/playbook 后长出来",EN act-first、ZH 走 M3);为将来接真 pack(feat-019 酒店包)留数据槽。
- **team map / room 画板**:严格按 S4 拍板范围实现(空态 / 轻建 / 移植三档之一)。若拍板含移植:共用件走 src/shared/**,禁止 lite import story(墙 lint 会拦,别绕)。
- **gate 先行**(ADR-0022 §3 纪律):先把新模块的 DOM 断言加进 scripts/gates/live-frontend-gate.snippet.js(新增相位或扩展现有相位),跑一次确认红,再实现修绿。

## 完工判定(全机器门)
- 前端门 verdict 全绿(含新增断言);story 回归 29 步/26 拍仍绿;init.sh 绿(墙 lint);离线 pytest 仍绿。
- verdict JSON 原文 + 回归输出进 feature_list feat-025 evidence。

## 硬约束
🔴 人卡零数字;墙不打洞;story 行为零改;eval-harness 只读;`.prototype-topbar` pointer-events 模式(新可点子元素各自 auto);隐藏 tab 定时器节流坑(gate .md 已记);浏览器相位跑动中不改仓库文件。

## Worktree 纪律(AGENTS.md)
per-line handoff 写 `.issues/feat-025/session-handoff.md`(不动根 handoff);只改 feat-025 相关文件 + feature_list 里自己那条;与 S6 并行时 LiteTopbar/LiteApp 是已知交集点,改动最小化,冲突留给 integrator。
