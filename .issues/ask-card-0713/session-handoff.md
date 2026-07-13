# ask-card per-line handoff（2026-07-13 grill 会话）

## What's Done
- 融资团队点名的"生成式快问卡"完成**全套 grill 设计**：十个决策（Q1-Q10）Danny 全部拍板，见 `PRD.md` 决策表——不 re-litigate。
- 平台兼容性调研完成（企微/钉钉/飞书走 MiniMax 中国源 + Slack/Teams 官方文档）：`platform-compat-research.md`。
- 红线边界 ADR 落盘：`docs/adr/0023-ask-employee-selfreport-redline-boundaries.md`（问事不问人 / 回执不进人卡 / 永不跨人比分，边界=结构性机器闸）。
- 领域术语 **Ask** 进 `CONTEXT.md`（surface：EN "Quick ask" / ZH "快问"）。

## In Progress
- 无（本会话纯设计，零产品代码改动）。

## Next steps
1. **等依赖**：lite-v1 持久化（Supabase，`.issues/lite-v1-lean-real-0713/PRD.md` §3.3 步骤 1-2）落地后本线才可开工——ask+回执必须扛住重启。
2. 开工时按 PRD "Implementation Direction" 走：后端数据模型+端点 → 员工 H5（FastAPI 服务端渲染，per-link OG）→ lite Ask 卡（第二种 artifact 卡）→ 红线机器闸断言 → 集成层端到端。
3. gate 先行：PRD "Testing Decisions" 的断言先进门必红再修绿（沿用 ADR-0022 纪律）。

## Blockers
- lite-v1 持久化未建（硬依赖）。
- Danny 凭据墙：ICP 备案（已拍板启动，2~4 周长周期，宜尽早）、ECS host、域名 DNS、Supabase 连接串。

## Files Modified（本会话）
- `CONTEXT.md`（+Ask 术语）
- `docs/adr/0023-ask-employee-selfreport-redline-boundaries.md`（新增）
- `.issues/ask-card-0713/PRD.md`（新增）
- `.issues/ask-card-0713/platform-compat-research.md`（新增）
- `.issues/ask-card-0713/session-handoff.md`（本文件）

## Notes
- 命名雷区：不要把 Ask 写成 survey/问卷/poll/评分（CONTEXT.md avoid 列表）。
- v1 的"分享"= manager 手动复制链接粘贴进 IM（分享即人闸）；任何平台 API 直发都是 v2+，且是对外动作要过闸。
