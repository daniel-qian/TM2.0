# ask-card per-line handoff（2026-07-13 grill 会话 → 同日双面施工合流）

## 2026-07-13 深夜 · 合流收线（最新状态）

- **阶段 A（story beat）+ 阶段 B（lite AskCard, stub）双双完工并经独立对抗验证 CONFIRMED_SAFE**，已 merge 本地 main（`3e79e9e` + `d1934bf`），合流后 `./init.sh` 复绿。两侧实现细节与验证 verdict 见 `story-beat-handoff.md` / `lite-ask-handoff.md`。
- Q13（Danny 指令）：story 面加性解冻，scripted Ask beat 落 bill/acme case。
- 非阻塞 findings（F1 status 词表 / F2 stub 假链接标记 / F3 coerce 收紧）已锁进 `kickoff-dev.md` 阶段 C 追加清单 + PRD 数据模型行。
- **阶段 C（后端）仍 deferred**：等持久化线（feat/030+）合 main；阶段 D（部署+内存哨兵）随 lite-v1 部署波。
- feature_list.json feat-034 evidence 已更新（含双验证 + 合流哈希）。push 照旧留 Danny。

---

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
- lite-v1 持久化未建（硬依赖，唯一真 blocker）。
- Danny 凭据墙（已缩小）：Supabase 项目/连接串、真 LLM key 进服务器、push 授权。Q11/Q12 已拍（2026-07-13）：域名=avery.ima-read.com 子域；ECS 不预先升配，内存帽硬挤 + **部署时必装内存哨兵**（OOM/重启/高水位 → 主动冒泡给 Danny"该升配了"），压测内存峰值进 evidence。
- 基建事实已核实（单一事实源=D:\Boyle\agent-os\infra-brief.md）：备案主体 imaread 公司；DNS 在阿里云云解析；ECS=唯一生产机（2C/3.5G，跑 ImaRead 全线，**available ~540M 无 swap**——Avery 容器必须带内存帽+低并发+上传硬门）。

## Files Modified（本会话）
- `CONTEXT.md`（+Ask 术语）
- `docs/adr/0023-ask-employee-selfreport-redline-boundaries.md`（新增）
- `.issues/ask-card-0713/PRD.md`（新增）
- `.issues/ask-card-0713/platform-compat-research.md`（新增）
- `.issues/ask-card-0713/session-handoff.md`（本文件）

## Notes
- 命名雷区：不要把 Ask 写成 survey/问卷/poll/评分（CONTEXT.md avoid 列表）。
- v1 的"分享"= manager 手动复制链接粘贴进 IM（分享即人闸）；任何平台 API 直发都是 v2+，且是对外动作要过闸。
