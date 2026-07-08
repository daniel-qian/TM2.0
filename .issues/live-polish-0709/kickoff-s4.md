# S4 kickoff — 考古判定(lite 缺失模块)+ UI bug 即修

工作区 D:\avery 主 checkout,分支从 main(1f5a56a)新开 `polish/s4-triage`。

开场先读:根 session-handoff.md(2026-07-09 S3 收盘版)§下一波 + `.issues/live-polish-0709/plan.md`(反馈原话+考古入口全在里面)。启动跑 ./init.sh + `python -m pytest eval-harness -q -m "not seedgate"` 确认绿再动工。

## 使命(一个 session,两件事)

① **考古判定**:Danny 试玩发现 lite 缺 Playbooks / team map / room 画板(拖拽缩放)。逐项考古出"**当初拍板排除**还是**开发遗漏**"的实证结论(引 ADR/plan/handoff/transcript 原文,证据入口见 plan.md §4),并为每项给补齐方案选项(空态 / 轻建 / 从 story 移植)+ 粗工作量 + 风险(特别是:移植是否会破坏墙、room 画板是否值得引入 PanZoom 依赖到 lite)。产出 `.issues/live-polish-0709/triage-report.md`,结尾列出**留给 Danny 拍板的具体问题清单**(每题给推荐项)。

② **UI bug 即修(act-first,不等拍板)**:看 `D:\Screenshot\首页UI bug.png` 和 `D:\Screenshot\按钮风格丢失.png`,在 lite 壳里复现、定位根因(优先怀疑方向:feat-024 的 global.css 拆 chunk 后 lite 复用类名的 cascade、lite.css 新样式覆盖不全、composer/upload 按钮体系与 story 按钮体系的断差)、修掉。修完复跑:前端门六相位(协议 scripts/gates/live-frontend-gate.md,注意隐藏 tab 节流坑)+ story 回归 29 步 + init.sh。

## 硬约束
- 🔴 人卡永不评分/排名/画像;lite 类型层不给数字键留位置。
- 墙不许打洞:lite→story import 永远红灯;考古结论若倾向"移植",方案里必须写清移植路径(移进 shared 还是 lite 内重建),不许提"lite 直接 import story"。
- 不 re-litigate ADR-0020/0021/0022;story 侧行为一行不改。
- eval-harness 只读。
- 收盘按 AGENTS.md:triage-report + progress.md + 本 session 若有 code fix 则前端门 verdict 原文入证据;不合 main 之外的东西(bug fix 可直接 PR/merge main,小步)。

## 收盘预期
- triage-report.md 落库,拍板问题清单交 Danny;
- 两个 UI bug 修绿有证据;
- feat-025/026 的 description 按考古结论补细(状态仍 not-started,等拍板)。
