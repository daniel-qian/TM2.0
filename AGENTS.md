# AGENTS.md

Avery（旧称 TeamMaster 2.0）—— 面向小公司 manager 的管理平台 **demo 原型**（Vite + React + framer-motion + zustand）。品牌已锁定 Avery（ADR-0015）；老字眼清理已完成（feat-005，2026-06-21），报告见 `docs/strategy/coldstart-deliverables/P7-01-brand-rename-report.md`。代码只服务 demo 叙事，不按产品工程标准要求（见 ADR-0001）；领域术语表在 `CONTEXT.md`，架构决策在 `docs/adr/`，动手前先读与所改区域相关的条目。

## Autonomy & gates（先斩后奏，2026-07-06）

Danny 一个人背 N 个项目，没时间逐项审。默认 **act first, report after**：copy 定稿、UI/审美取舍、commit、push、deploy/生产 promote —— agent 自己拍板、自己上线，事后在 `progress.md` 给结论+证据。**不设人工闸、不阻塞、不标 `待审字`。**

只有这几类才停下来交给 Danny：

- **不可逆销毁**：硬删除、`git push --force`/改写历史、删未合并分支、drop 表/删数据。
- **对外/涉第三方或花钱**：给真人发邮件/消息、公开发布（ProductHunt 等）、付款、授予他人访问权限。
- **需要他凭据/账号才能做的**：真 key、选/开托管商、Vercel 面板、域名 DNS —— 这是"没权限"不是"要审核"，agent 把能做的都做完、只把这一步交出去。

质量不靠 Danny 复看，靠 maker≠checker 的 checker 子 agent 兜（见 global + `roles.md`）。审美/口味类分歧记进报告供事后抽查，不阻塞发布。

## Deploy（生产镜像，2026-07-20 血教训）

**默认从 `main` 构建**。别长期用「旧基线叠子集」——只带被指名的修复，等于系统性漏掉没人指名的修复：7/20 复审发现生产基线停在 7/18，main 上五条中文缺陷修复漏了两天没上线（回执见 `.issues/v02-joint-0719/deploy-receipt-backend-0720.md`）。

急事必须挑子集时，两条硬约束：

1. 先跑 `git diff <生产镜像SHA> main -- <后端路径>`，在部署回执里写清**排除了什么**，并给出重拉基线的时间点。
2. 从 main 往子集搬修复，**词表/常量逐字照抄，不许顺手改得更宽**。发散出的「只有生产有」的补丁，会在下次对齐 main 时被静默回收。

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
- 前端行为门是 `verify-*.mjs`（真浏览器），分散在**两处**：2026-07-20 新增的 8 道在 `eval-harness/tools/`，更早的既有门在 `.issues/<issue-dir>/`（`verify-p0` 在 `.issues/v02-partner-align-0718/`，`verify-zh-purity` / `verify-404-discriminator` / `verify-bare-url-shell` 在 `.issues/feat-068-frontend-deploy/`，`verify-null-owner` 在 `.issues/v02-joint-0719/`）。**唯一权威跑器是 `eval-harness/tools/run-battery.mjs`**（`node eval-harness/tools/run-battery.mjs --only=A`／`--only=B`／`--only=C`，A→B→C 顺序不可乱），在册 ROSTER 见该文件 84-121 行；`git ls-files "*verify-*.mjs"` 会捞出 42 个文件，其中 7 个是 run-battery.mjs:28-48 明列的**死件**（.issues/v02-partner-align-0718/ 下的 verify-server / fixA / fixA-live / fixB-transport / fixB-upload-ui / fixB-upload-layout / blockers），**一律不要单独跑**——verify-server 跑起来不退出会卡死电池，verify-blockers 会真上传语料污染同批门共用的 context。⚠ 42 ≠ 在册 + 死件：另有 9 道 `.issues/rich-align-0722/verify-*.mjs` 是那场战役的一次性门，**既不在 ROSTER 也不在死件清单**——没人裁定过它们，别默认"不在册就是死的"。三个数字自查：`git ls-files "*verify-*.mjs" | wc -l` / run-battery.mjs 的 ROSTER 与死件块各自数一遍。跑之前：后端 `AVERY_BRAIN=mock` 起 8137、前端起 5173；端口被占就用隔离端口 + `VERIFY_BASE` + `AVERY_CORS_ORIGINS`（CORS 精确匹配，端口对不上会被浏览器静默拦掉，门看起来像"页面空的"）。
- 后端电池：`cd eval-harness && python -m pytest -m "not smoke and not seedgate and not needs_keys and not needs_db"`。**这四个 deselect 不是可选的**——本机 `eval-harness/.env`（untracked）里有真 key，漏掉就真出网烧钱。
- 没有自动化 test suite：行为验证靠 `npm run dev` 目测，验证了什么写进 evidence。
- Harness 收尾机械门见 `docs/agents/clean-state-checklist.md`；较大 session 的验收评分见 `docs/agents/evaluator-rubric.md`。

## 易复发陷阱（都真被咬过，写门时先看这里）

- **显示值和判据值必须分开**（`ownerNameRaw` / `statusRaw` 模式）：把兜底文案直接当判据，结果是"文字修好了、颜色还在撒谎"。7/20 在 v02 状态点上真发生过。
- **门扫 `innerText` 看不见属性**：`aria-label` / `title` / `alt` 从不进 innerText，要单独扫（见 `eval-harness/tools/verify-aria-zh.mjs`）。一条门全绿不等于那一类值被采过样。
- **`__AVERY_LITE__` / `__AVERY_LITE2__` 是 `import.meta.env.DEV` 门控的**，`vite build` 会整段剪掉——引用它们的门在 build+preview 下是**崩**不是失败。无条件存在的缝是 `__liteStore` / `__lite2Store` / `__lite2Auth`。
- **i18n 里的孤儿文案键是红旗**：有键但没有任何组件引用，往往说明某次合并悄悄吃掉了一整个功能。7/19 一个合并提交（`3106536`）就这样整边丢弃了 236 行文件状态渲染，只剩键留在原地。**同一个合并还吃掉了 `transport.ts` 的 `withServerDetail`**（413 真上限 / 422 编码诊断的透传）——一次单边取舍可以吃掉不止一块，查到一处要顺着那个合并再扫一遍。

- **跑完门之后 `dist/` 处于什么状态是不确定的，别假设它还指着 localhost**：好几道门自己会 `vite build`，各自带不同的 `VITE_AVERY_API_BASE`；其中 `verify-bundle-privacy` 为了造出"构建机"条件会**不带任何 api base 重打**，于是 `dist/` 落回 `vite.config.ts` 的默认值 = **生产域名**。此后任何人对着 `vite preview` 跑一道会上传的门，就是**往生产库里写测试数据**（7/20 真发生过：三个 `员工花名册.csv`/`坏文件.csv` 的 context 落进生产）。**跑上传类门之前先验一次 `window.__AVERY_BUILD__.apiBase`**，或显式重打 dist。

- **上传限额是部署期配置，读源码默认值会得出错误结论**：`guards.py` 的默认是 8 MiB/文件、15 个文件，但生产容器用 `AVERY_MAX_UPLOAD_BYTES` / `AVERY_MAX_FILES` 覆盖成了 10 MiB / 10 个——前端文案 `tooLarge`（"up to 10 files, 10MB each"）对的是**生产**。7/20 有过一次"照默认值判定文案在撒谎"的误报，按它改反而会真造出一个 bug。判限额一律以运行中容器的 env 为准。

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
