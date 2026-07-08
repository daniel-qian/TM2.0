# AGENTS.md

Avery（旧称 TeamMaster 2.0）—— 面向小公司 manager 的管理平台 **demo 原型**（Vite + React + framer-motion + zustand）。品牌已锁定 Avery（ADR-0015）；老字眼清理见 `.to-issues/P7-01`。代码只服务 demo 叙事，不按产品工程标准要求（见 ADR-0001）；领域术语表在 `CONTEXT.md`，架构决策在 `docs/adr/`，动手前先读与所改区域相关的条目。

## Autonomy & gates（先斩后奏，2026-07-06）

Danny 一个人背 N 个项目，没时间逐项审。默认 **act first, report after**：copy 定稿、UI/审美取舍、commit、push、deploy/生产 promote —— agent 自己拍板、自己上线，事后在 `progress.md` 给结论+证据。**不设人工闸、不阻塞、不标 `待审字`。**

只有这几类才停下来交给 Danny：

- **不可逆销毁**：硬删除、`git push --force`/改写历史、删未合并分支、drop 表/删数据。
- **对外/涉第三方或花钱**：给真人发邮件/消息、公开发布（ProductHunt 等）、付款、授予他人访问权限。
- **需要他凭据/账号才能做的**：真 key、选/开托管商、Vercel 面板、域名 DNS —— 这是"没权限"不是"要审核"，agent 把能做的都做完、只把这一步交出去。

质量不靠 Danny 复看，靠 maker≠checker 的 checker 子 agent 兜（见 global + `roles.md`）。审美/口味类分歧记进报告供事后抽查，不阻塞发布。

## Startup Workflow

Before writing code:

1. 读本文件。
2. 读 `feature_list.json` —— 当前各 feature 的状态、依赖、证据。
3. 读 `progress.md` —— 上个 session 停在哪、下一步是什么。
4. 跑 `./init.sh`（或手动 `npm run typecheck && npm run build`）确认起点是绿的。

首次环境：`npm install`；本地运行：`npm run dev`。

## Scope

- **One feature at a time**：只做 `feature_list.json` 里你认领的那一个 feature，依赖未完成的不要开。Stay in scope —— 顺手发现的问题记进 `progress.md` 的 Notes，不要顺手修。
- feature 状态只有三种：`not-started` / `in-progress` / `done`。改状态必须同步改 `evidence` 字段。

## Verification Commands

- `./init.sh` —— 一键跑全部检查（typecheck + build，fail fast）。
- `npm run typecheck` —— `tsc -b` 零错。
- `npm run build` —— typecheck + vite build。
- 没有自动化 test suite：行为验证靠 `npm run dev` 目测，验证了什么写进 evidence。
- Harness 收尾机械门见 `docs/agents/clean-state-checklist.md`；较大 session 的验收评分见 `docs/agents/evaluator-rubric.md`。

## Definition of Done

一个 feature 标 `done` only when：

1. `./init.sh` 通过，输出摘要记入 `feature_list.json` 的 `evidence`。
2. 行为经 `npm run dev` 目测确认（看了什么、结果如何，写进 evidence 或 `progress.md`）。
3. Venus-facing 新 copy 由 agent 直接定稿并上线（EN 自写；中文走 M3，见记忆 [[chinese-copy-via-m3]]）——不再标 `待 Danny 审字`、不阻塞。定稿后 `progress.md` 记一行，Danny 事后可抽查。
4. `progress.md` 已更新。

## End of Session

Worktree note: if this session is running inside a git worktree, you MUST still leave a clean handoff — but write it to your OWN per-line file (`.issues/<feature>/session-handoff.md`), not the root narrative. Whoever holds the freshest state owns recording it. Update only the active feature’s entry in `feature_list.json`, `.issues/<feature>/*`, and in-scope code/docs. The cross-line synthesis files — `progress.md` and the ROOT `session-handoff.md` — stay owned by the main-checkout integrator/merge-manager, who folds the per-line handoffs together. Exception: if the user says this is the only active line, you may write the root narrative directly.

Before ending（或 context 快用完时）：

1. 更新 `progress.md`：What's Done / In Progress / Next steps / Blockers / Files Modified。
2. 更新 `feature_list.json` 状态与 evidence。
3. 跨 session 的大块交接另写 `session-handoff.md`。
4. 按 `docs/agents/clean-state-checklist.md` 过一遍 branch/worktree/dirty files/hook liveness。
5. 目标：下个 session 不靠聊天记录、只靠这些 repo 文件就能 restartable。

## Agent skills

### Issue tracker

Issues and PRDs live as GitHub issues in `daniel-qian/avery`, managed via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Five canonical triage roles, each mapped to a label string equal to its role name (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout: one `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
