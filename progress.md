# Session Progress Log

> 📢 **致下个 session：本仓库已 adopt harness 体系（2026-06-11）。**
> 启动路径见 `AGENTS.md` 的 Startup Workflow：读本文件 + `feature_list.json`，跑 `./init.sh` 确认绿，再开工。

## Current State

**Last Updated:** 2026-07-07（**S1 执行完毕**：feat-022 done（双层机器门，出生即红——红是成功）+ feat-023 done（LLM 抽取修绿全部后端断言，`-m seedgate` 6 passed）；**前端断言按计划保持红 = S2 feat-024 的活**；见文末 `## Update — 2026-07-07 · S1` + 根 `session-handoff.md` S1 收盘版）
**上一条：** 2026-07-07 晚（救 15–20：确诊 + grill 六岔口 Danny 全拍 → **ADR-0022** + feat-021 done / feat-022..024 teed up；见文末 `## Update — 2026-07-07` + `.issues/live-rescue-0707/plan.md`）
**上一条：** 2026-07-05（双线战略圆桌：架构锁定，feat-015..020 teed up；见 `## Update — 2026-07-05` + `docs/strategy/2026-07-05-dual-line-strategy-roundtable.md`）
**上一条：** 2026-07-03 晚（投资人路演 landing 重构已合并 main，2588dc7）
**本日第二条线（worktree `elated-noether-7807c8` → 已合并+清理）：** landing 18 屏 → 7 屏投资叙事，为今晚证券金融路演。
**已上线 production：<https://avery-jade.vercel.app/?lang=zh>**。要点：**ADR-0018**（人情味从产品真理降为红线；产品真理
= 管理决策层；数字新规：模型形态 mock 可上页/代码注释标注，结果形态数字加页面微标注，实测口径仍禁）——CONTEXT.md +
roles.md 已同步；slug「senior at your ear」全面弃用，只留 "Managers need safer HR decisions"；M3 导演简报按新定调重写、
中文 13/13 重新转创；Phil/Dana/Will 三角色旁听意见全部落地（Dana 红线 7 屏全 PASS）。详见
`.issues/roadshow-landing-0703/session-handoff.md`。留给 Danny：en.ts 全部新文案 ⚠ 待审字（尤其投资人收口
"we're raising" 口径）+ 预演三个追问（真实数字在哪 / 为什么大模型吃不掉 / 凭什么投单人创始人）。
**注意 ADR 编号**：feat-014 占了 0017（card home），本线的定调修订是 **0018**。
**⚠ feat-014 push 状态变更**：本次合并推送 main 时把 feat-014 一并带上了 origin（原计划"未 push 归 Danny 拍板"）。
git 已推无法收回；副作用（tm2 production 自动部署了未审字主页）**已回滚**到 feat-014 前的部署
（tm2-osj7dqiwv）。Danny 审字通过后 `vercel promote` 最新部署即可上线新主页。

（上一条：feat-014 卡片式今日主页 done；详见下方 `## Update — 2026-07-03`）
**Active Feature:** 无 active 编码（2026-07-05 是战略圆桌，只产出决策+文档）。**下一步 = 启动 feat-015 / feat-019 pack-authoring / feat-020 三条并行 AFK 线**（见文末 `## Update — 2026-07-05` + `.issues/feat-01x/kickoff.md`）。feat-014（Morning Desk 主页，GH #9）done 且已在 origin（f4bde81 随路演线 push 带上 + 59461bb UI 修复）；tm2 production 仍停在审字前部署，审字后 `vercel promote` 即上新主页。
**feat-014 真机目测回环已闭（2026-07-03 晚）**：Danny 抓到两处 UI 重叠（composer 随滚动漂进内容 / 依据签压字且同句三卡重复）→ 修复 59461bb（滚动下放 `.home-scroll`、composer 锚回视口底；依据签只在第一张关联项目卡以文档流 chip 出现）→ DOM 断言复验 + init.sh 复绿 + 已 push。剩余 HITL 只有审字（fixtures.home.ts）。
上一轮（2026-07-01）状态：本 session 详情见下方 `## Update — 2026-07-01` 三节 + 完整运行日志
`.handoff/partner-integration-0701.md`。要点：合伙人 6 个 SCN 落进 eval（解锁 non_danny 闸）、真跑完成（诚实结论
在 `eval-harness/EVAL-REAL-0701.md`）、demo 终局卡对齐 8 字段 + Playbooks 换真场景、landing 折入 pack 并按 eval
证据把定位从"我们不打分"改锚到"升级/校准/证据"（红线降为信任保证）、给合伙人的交付包 `eval-harness/for-partner/`。
**7 个提交全部推送 origin/main**（结尾 044b198）；Vercel 自动部署 landing。工作树干净（仅 `.claude/.codex/`、
`assets/0630-partner-docs/` 合伙人 IP、`assets/logo-v0.png`、`for-partner.zip` 未追踪，均有意）。
**🟢 曾经的头号待办已解**：ADR-0016（果断双向）+ feat-012 对抗案例（marcus）已覆盖"kind read is wrong"，DECISION-MEMO §3 的堵点不再卡。
**⚠ 下个 session ≠ 本仓库：** 主战场转到**营销**，工作区 `D:\Boyle\marketing-resource\avery`——发 ProductHunt、录视频 demo
（Remotion/HyperFrames 文本帧动画）、冷邮件。完整交接已写入该工作区的 `session-handoff.md`（含要引用的 D:\avery 素材路径、
更新后的诚实态、定位、三大任务、公开 CTA 等 gap）。本仓库这边留给 Danny 的 HITL：审字 / 真人 eval 评分 / 合伙人 IP 具名 /
avery loop 补 cite-before-number。

## Status

### What's Done

- [x] feat-000 Demo Prototype（P1–P6，pitch 已用）；feat-001 Project Setup；harness 体系 adopt。
- [x] **feat-004 Nexus 终端流改版 —— done（2026-06-12）。** 全程：grill Q1–Q10（Q4–Q10 Danny "全部按照推荐"）→ `docs/adr/0014-nexus-terminal-stream-hud.md`（取代 ADR-0004 放射表达 + ADR-0012 修订5/6 Nexus 部分；Dashboard / CONTEXT.md 不动）→ 实现五步全落地：
  - **数据形**：`cases.ts` 新增 `stream`（3 case × 13 步全著作终端流脚本）；退役全部拓扑字段；`cardAnchors` 双列瀑布公式；`NEXUS_BOARD` 2300×2700；删 `lib/nexusFlow.ts`。
  - **终端组件**：`NexusTerminal` 左栏 HUD（440px，mono，per-speaker 专色，自滚动，行级 stagger，MANIFEST 锚行点击飞卡，"running ▌" 光标行，附件 chip 首行，Bill 头像内联）。行集合 = `(caseDef, thread)` 纯函数，replay-safe。
  - **镜头收敛**：calm = width-top fit Manifest 区；新卡拍温和飞向（maxFitScale 0.8）；纯思考拍不动；`NEXUS_INSETS.left` 496。
  - **旧层退役**：节点/边渲染 + `.flow-node*` / `.nexus-edge-*` CSS 整组删除。
  - **验证**：`./init.sh` 绿；Danny `npm run dev` 目测（rail 全程 + 三 case 自由点击）+ stream copy 审字，回复"全部通过"。本 session 新增的 ⚠ 审字标记已摘（cases.ts ×3、NexusScene ×2，改注"经 Danny 审定 2026-06-12"）。

- [x] **feat-005 改名 TeamMaster→Avery —— done（2026-06-21，commit 89ce238）。** 8 行表层清扫，内部标识按 ADR-0015 保留。worktree 已合并并清理。⚠ 按 skip-tests 未跑 init.sh/tsc，依赖 build 前需自测。
- [x] **feat-007 / feat-008 / feat-009 P1 交付物 —— done（2026-06-21，commit 46084d1）。** roles-loop workflow 产出顾问 agent 调研+架构、eval sheet 规格+Lin Qing mock、全套文案 kit + DECISION-MEMO。Danny 已审阅确认「成品」。HITL 余项见各 feat evidence（审字 + 6 条文案修正）。

### What's In Progress

- 无 active 编码。等 Danny 拍板 §3 价值观抉择（见上「头号待办」），它解锁 feat-012/013。

### What's Next — P7 wave 下半（Danny 三条主线 = 三个 afk 任务）

1. **agent python 框架 build（feat-011）** — 真正搭 headless eval 顾问 agent（feat-007 是设计稿）。AFK 可跑 skeleton + mock 跑批；真跑等 feat-012 + 合伙人资料。**先要 Danny 选 stack**（consultant-agent-open-questions.md）。
2. **landing page 骨架（feat-010）** — 文案+eval 规格已 done，可立刻 AFK 搭骨架（视频/真 eval 数用 placeholder）。
3. **demo video v1（feat-013，capture feat-006 + remotion）** — **卡在 §3 决定**：先定再拍，否则拍成 Ray 否掉的「comfort blanket」版。
4. **feat-012 对抗 scenario（「善意解读是错的」那一例）** — 化解头号堵点；卡在 §3 决定；产出后回填 eval sheet + 视频 beat。

并行性：1/2/3 可作为 **骨架** 并行 AFK 起跑；但 feat-011 是「真 eval 数」的长杆——视频(3)与落地页(2)最终要可信都要等它跑出真数。

旧 wave 遗留 HITL（不进 feature 列表）：P6-08 审字（errand 卡组等旧 copy 的 ⚠ 标记仍在）+ 换真 memo 照片（`cases.ts` 的 `MEMO_PHOTO_SRC`）。

## Blockers / Risks

- ✅ **§3 价值观抉择 —— 已定（2026-06-21 Danny: YES）**：Avery 在两个方向上都果断（详见 `docs/adr/0016-avery-decisive-in-both-directions.md`）。feat-012/013 解锁。
- ✅ **顾问 agent stack —— 已定（Danny:「按推荐」）**：Python+SDK / 文件-keyword RAG / markdown skill + 固定链（见 consultant-agent-open-questions.md RESOLVED 段）。feat-011 解锁。
- ⚠ **改名未自测**：feat-005 按 skip-tests 未跑 init.sh/tsc，合并前自测。
- ⚠ **eval 证据真实性**：买家都对 N/X/M 占位脚注 + 「Avery 的 read 哪来的」存疑——发布前需真人评测数 + 展示给 Avery 的证据列（DECISION-MEMO §4）。

## Decisions Made

- 见 `docs/adr/0014-nexus-terminal-stream-hud.md`、`docs/adr/0015-product-tone-human-advisor-debrand-saas-naming.md`。
- 商业模式锁定：advisor AI + tools 免费 / playbooks 付费；品牌锁定 Avery；overseas-first 全英文。

## Files Modified — 2026-06-21 冷启动 session

- 新增交付物：`docs/strategy/coldstart-deliverables/`（copy-kit、eval-sheet-spec、consultant-agent-{brief,architecture,open-questions}、DECISION-MEMO、P7-01-brand-rename-report）
- checkpoint commit a2c8845：Danny WIP（ADR-0015 表层措辞 + hero 重建 + P7 issue 草稿 + 圆桌 + roles）
- 改名 commit 89ce238（feat-005）；交付物 commit 46084d1
- harness：`feature_list.json`（feat-005/007/008/009→done，新增 feat-011/012/013）、本文件、`session-handoff.md`

## Notes for Next Session

- 顺手发现（未修，stay in scope）：global.css 里 `.nexus-inspector` / `.nexus-progress-row` / `.nexus-active-list` / `.flow-kind` 是修订 5 删 inspector 时就死掉的样式，下次 CSS 清理可一并删。
- 终端观感微调入口（若 demo 现场要调）：`NEXUS_INSETS`（NexusScene 顶部）、`.nexus-terminal` 宽/位（global.css 尾部 feat-004 区）、`maxFitScale 0.8`（useRailCamera 调用处）。
- ⚠ 标记现状：feat-004 stream copy 的标记已摘；仓库其余 ⚠（errand 卡组、rail caption、tab 短名等）属 P6-08 审字范围，仍待 Danny。

## Update — 2026-06-22 · feat-012 done + merged

- **feat-012（对抗 scenario set）= DONE，已 merge 进 main**（merge commit 77d9272，源 worktree `condescending-feistel-185687`，已 prune）。
- 交付：`docs/strategy/coldstart-deliverables/eval-scenarios/` — 27 条 git-hashed scenario（`cases/SCN-001..027.md`）、`freeze.mjs`（幂等）+ 生成的 `scenarios.json`/`frozen.lock.json`（`setDigest sha256:d4dbf063…`）、`adversarial-row.md`（SCN-002 渲染）+ `demo-beat.md` + `README.md`。
- issue #6 已 close。§9 盲检 Ray(ceo)+Dana(dana) 双 PASS。
- ⚠ 待办（HITL）：`adversarial-row.md` / `demo-beat.md` 买家文案的 `⚠ 待 Danny 审字` 未定稿。
- ⚠ 需 Danny/integrator 决断的重复：main 上另有一份并行设计稿 `docs/strategy/coldstart-deliverables/eval-scenario-set.md`（+ `.issues/feat-012/scenario-set.md`，Marcus/LQ-00 命名体系），与本次交付的 `eval-scenarios/` 实现稿并存——两套 feat-012 设计哲学，建议后续二选一/合并。
- 跨 feature 续接：真实未删改基线输出 + 买家带来的现场 case 由 feat-011 runner / feat-013 video 产出；partner-reserved 槽位经 feat-011 ingestion 回填。

## Update — 2026-06-22 · feat-011 done + merged (eval-harness 真跑验证)

- **feat-011a/b/c（headless eval-harness BUILD）= DONE，已 merge 进 main**（源 worktree `eager-brattain-adad83`；6 个 commit `6db8a06..4736e90` + 本 merge）。GitHub #3/#4/#5 已留完成 evidence。
- **交付**：`eval-harness/`（自成一体 Python 仓，**产品 src 一行没碰**，121 pytest 全绿）。011a=~150 行 think→tool-call→observe loop + 4 文件工具 + **红线校验器(护城河)** + cite 不可跳过 + 3 个 skill 文件；011b=冻结+git-hash manifest 跑批（Avery vs raw + scaffolded-minus-redline，防位置偏差 swap）；011c=跨家裁判（**绝不 Claude**，硬门→1-5 软维度→Cohen κ→scorecard，**不吹 outcome/ROI**）。可插拔 brain：mock(离线确定性) / 真(OpenAI 兼容)。
- **🔴 真跑验证（重要，影响叙事）**：实跑 MiniMax-M3(脑) + DeepSeek-Pro & MiniMax(跨家裁判)。① pipeline 端到端通；② 双层护栏被两家裁判交叉验证（都澄清了正则误伤）；③ **一个能干的 2026 模型 raw 跑、就算被挖坑案(Jordan)引诱也不给人打分** → "我们不贴标签" 这条护城河在 M3 级别**基本不触发**，Avery 卖点须重定位到 **证据引用纪律 / 校准 / 结构化输出**；④ 两家裁判在简单案子上都打满分 → **瓶颈是案子难度,不是裁判**。详见 auto-memory `feat012-partner-scenarios-pending`。
- **🔑 跨 feature 续接（给 integrator/下个 session）**：现在有两套 feat-012 产物——别的 session 的 `eval-scenarios/`（27 条 SCN markdown 场景，含 reserved 合伙人槽）+ 我的 `eval-harness/`（**可跑的** Python runner + 4 个 case 含 Jordan 挖坑案）。**自然衔接 = 把那 27 条 SCN 场景喂进 eval-harness runner 跑真数**（ingestion 契约见 architecture）；这是把 eval 变可信的下一步工程。
- **⚠ 头号待办（未变,已存 memory）**：发布前需 **≥3 个合伙人自己写的真案子**（Ray must-have）——下次合伙人会议提出。当前所有 scenario 都是我们写的（`non_danny=0`），scorecard 正确地自标 **NOT PUBLISHABLE**。
- **⚠ 运维**：`eval-harness/.env`（含 MiniMax+DeepSeek key）已 gitignore，**合并后需手动 copy 到主 checkout**；真跑 4 场景一次 10 分钟跑不完(推理模型)→ 分场景跑或调大 timeout；**key 在本次对话出现过,建议轮换**。

## Update — 2026-06-24 · harness upgrade docs/scripts

- **agent harness upgrade 已按审计票执行（不是产品 feature）**：新增 `docs/agents/clean-state-checklist.md`、`docs/agents/evaluator-rubric.md`、`docs/agents/harness-upgrade-plan-2026-06-24.md`，并在 `AGENTS.md` 短链过去。
- **git hygiene**：`.gitignore` 改为只忽略 agent 本地态/大件（`.claude/settings.local.json`、`.claude/worktrees/`、cache/archive、`.claude/launch.json`、`.codex/local|cache|archives`），保留 `.claude/settings.json`、`.claude/hooks/`、`.codex/hooks.json`、`.codex/config.toml`、`.codex/hooks/` 默认可追踪。
- **hook 上线前工具**：新增 `scripts/audit-hooks.mjs`（查项目 hook config 指向的 repo 内脚本是否存在且有 git history）和 `scripts/agent-context-banner.mjs`（未来 SessionStart / PreToolUse 软提醒用；不硬拦 main commit）。
- **验证**：`node scripts/audit-hooks.mjs` 通过（当前无项目 hook config）；`scripts/agent-context-banner.mjs` 已用 SessionStart 形态、非匹配命令、`git commit`、坏 JSON、空 stdin 管道实测，均 exit 0；`node validate-harness.mjs --target ...` 为 96/100（瓶颈仍是旧 `session-handoff.md` 识别项）；`git diff --check` 通过。
- **未做（有意）**：没有创建 `.claude/settings.json` / `.codex/hooks.json`，没有启用项目 hook；等 Danny 明确要信任 project-local hooks 再 wire。

## Update — 2026-06-27 · local path + GitHub repo rename safety

- **GitHub repo 已重命名**：`daniel-qian/TM2.0` -> `daniel-qian/avery`；旧 slug 现在 redirect 到新 repo。
- **本地 remote 已同步**：`origin` fetch/push = `https://github.com/daniel-qian/avery.git`；`gh issue list --repo daniel-qian/avery` 返回 open issues #8/#7 的新 URL。
- **活引用已修正**：`AGENTS.md`、`docs/agents/issue-tracker.md` 的 issue tracker 指向改为 `daniel-qian/avery`；`package-lock.json` 顶部 package name 与 `package.json` 对齐为 `avery-prototype`。
- **安全检查**：`./init.sh` 通过；`git diff --check` 通过（仅 CRLF 提示）；`git ls-remote --heads origin main` 可读。
- **注意**：本地 `main` ahead of `origin/main` by 11 commits，未 push，避免把既有本地提交混进 repo rename 动作；`.claude/`、`.codex/` 仍是未追踪本地态。

## Update — 2026-06-30 · landing 编辑风重设计 + 中文 i18n + 真上线

- **缘起**：合伙人发来自撰的 14 屏 pitch deck（`D:/Screenshot/template.html`，"Emerald Editorial" PPT 风）。先做了内容交叉对比（deck vs landing vs eval），按 Danny 拍板：**保留锁定的 "senior at your ear" 声音（ADR-0015）**、把 deck 全部内容塞进现有 **5 段** 结构、eval 留空、deck-vs-产品的"灵魂分叉"**暂不解决**（已记录，等 demo/landing 上线后按反馈再说）。
- **完成（详见 `feature_list.json` feat-010 的 ADDENDUM 2026-06-30）**：
  1. 从 deck 提炼设计系统 → `landing/app/globals.css`（米/深蓝/金、Bodoni Moda + Manrope 走 next/font、双线 ornament，响应式）；deck 的渐变 Avery logo 移植进 Hero。
  2. 11 个新 section 组件覆盖全部 14 屏（Audience/WhyItMatters/WrongCut/MorningBriefing/MarketGap/Method/Modules/Stack/Landscape/Revenue/TrustLayer）。竞品名按红线品类化；人相关信号保持"读情境不评分"。
  3. **中文 i18n**：所有文案外置到 `app/i18n/en.ts`（唯一源，`type Dict = typeof en`）；`zh.ts` 由 **MiniMax-M3** 经 `scripts/i18n-zh.mjs` 转译生成（读 `eval-harness/.env` 的 `MINIMAX_API_KEY`，18/18 段，语言无关字段从 en 强制回写）；`?lang=zh` 切换，EN 默认（overseas-first）。
  4. 修了一个对比度 bug（`.section--ink h4` 把深色区里浅色卡片的标题染成米色看不清）。
- **验证**：`next build` 绿；EN(`/`) + ZH(`/?lang=zh`) 经 dev server 实测渲染正常。Commit `08d0006` → `origin/main`。
- **部署**：landing 现在有**自己独立的、git 连接的 Vercel 项目**（Root Directory=`landing/`），与 `tm2` 分开（**tm2 = 根目录 Vite demo，保留**用于录视频/继续开发）。Danny 用 dashboard import 建好并部署，目测无问题。**Deployment Protection / 对外 URL 是 Danny 的 dashboard 设置**（团队有 SAML；landing 项目应把 protection 关掉合伙人才能看）。
- **HITL / 下一步**：所有 EN 文案 + M3 中文都是 `待 Danny 审字` 草稿 → 改完 EN 后跑 `node --experimental-strip-types scripts/i18n-zh.mjs` 一键重生中文。eval 对比区逐字稿仍是英文占位（真数据等 feat-011/012）；demo 视频占位（feat-013）；Hero 中文主标题因 `{em}` 语序略生硬，待 Danny 定稿。合伙人会议后按反馈迭代文案。
- **运维**：`scripts/i18n-zh.mjs` 依赖 `eval-harness/.env` 的 `MINIMAX_API_KEY`（gitignored；feat-011 的轮换提醒仍有效）。

## Update — 2026-07-01 · 合伙人知识包落地（eval/demo/landing 三线并行 · 多 agent 编排 · Danny 全程 AFK）

> **完整运行日志见 `.handoff/partner-integration-0701.md`（作战板 + 8 字段正典契约 + 广播日志）。真跑诚实结论见 `eval-harness/EVAL-REAL-0701.md`。本节是高层总结。**

- **缘起**：合伙人（Cythia）交付混合 RAG/playbook 知识包 `assets/0630-partner-docs/`（由 `hr_ai_case_solution_matrix.xlsx` 编译）：42 案例（14 CIPD 模块）、10 动机驱动、**6 场景 playbook SCN-001..006**、6 信号阈值、5 升级护栏、8 字段 advice schema、反馈 CSV。Runtime Rule 与 ADR-0015 红线几乎逐字重合（合伙人独立撞上同一不可谈判点）。
- **编排**：hub（主 Claude）+ 3 后台实现线（general-purpose）+ 外审三人组（roles.md 的 Dana 红线/人味 · Ray 买家 · Claire UX），maker≠checker，共享 8 字段契约保持三线一致，循环自检自审。用户设了 10 分钟心跳 cron 兜底后台静默死亡。

**What's Done**
- **Lane A · eval（feat-011/012 延伸）**：6 个 partner SCN → `eval-harness/cases/scn-00X-*.md`（`authored_by:"partner"`），manifest 重冻（`FROZEN.lock.json` 新哈希），`judge.py` rubric 升级到 4 新差异轴（引证/升级-on-risk/校准/证据不足即拒），`avery/cases.py` +`escalation_risk`，`tests/` 124 绿。**真跑完成**（`runs/real-0701b`，MiniMax-M3 脑 + DeepSeek/MiniMax 跨家裁判，30 逐字稿）。**诚实结论**：① 唯一干净差异=红线（avery 1.0 vs 两 baseline 0.9，LLM 裁判确认 codex/SCN-002、scaffold/SCN-004 是真越界非假阳性）；② 软维度全 5.0 不区分；③ **引证纪律在真跑未兑现**（no-halluc avery 0.0，真 M3-avery 吐未引证数字）=真产品洞；④ 仍 NOT PUBLISHABLE（human label 合成）。office-AI 粘贴包 → `eval-harness/office-ai-capture/PROMPT.md`（HITL，等 Danny 手跑）。
- **Lane B · demo**：`src/data/fixtures.ts` 的 `AGENT_OUTPUT` 对齐合伙人 8 字段正典（+`conversation_script`，新 `DiagnosisHypothesis` 型），`NexusScene.tsx` 终局卡重渲染为**三视觉区**（read/backing/move）+ 两审计字段折叠 `<details>`；`fixtures.p3.ts` Playbooks HR 栏换真 SCN 名。场景不变=SCN-001。`npm run build` 绿，红线守住。
- **Lane C · landing**：5 护栏 + 最小证据政策落进 Method/TrustLayer；新 `OutputShape.tsx`（8 字段可审计产出，标签与 demo 一致）+ `Playbooks.tsx`（6 SCN）；外审修复（红线反例去标识+判词横幅+删线、schema 词下屏、read-not-verdict/confidence 三处冗余收敛、`morningBriefing` 编造数字去除）。**只改 `en.ts`**；M3 regen `zh.ts` **20/20**（给脚本加了失败段自动重试）。`tsc --noEmit` 绿。
- **eval slot 决定**：landing eval 区**保持诚实预留、不挂 win-rate**（真结论不可发布）。真红线对比逐字稿暂存，是否公开（去标识后）留 Danny 定。

**Files Modified（主要）**：`eval-harness/{cases/scn-00X-*.md(新6), scenarios/manifest.json, scenarios/FROZEN.lock.json, judge.py, avery/cases.py, tests/test_judge.py, office-ai-capture/PROMPT.md(新), EVAL-REAL-0701.md(新)}`；`src/{data/fixtures.ts, data/fixtures.p3.ts, components/scenes/NexusScene.tsx, styles/global.css}`；`landing/app/{i18n/en.ts, i18n/zh.ts, page.tsx, components/{OutputShape.tsx(新),Playbooks.tsx(新),Method.tsx,TrustLayer.tsx,EvalContrast.tsx}, data/evalRows.ts, globals.css}`, `landing/scripts/i18n-zh.mjs`；`.handoff/partner-integration-0701.md(新)`。

**验证**：eval 124 pytest 绿 + mock/real 管线跑通；demo `npm run build` 绿；landing `tsc --noEmit` 绿（`next build` 本地卡 Google Fonts 抓取=国内网络，Vercel 可靠，之前成功过一次）。红线：抽验 SCN-006 avery 建议范本级（不推断病情），demo 卡诊断显式"a read, not a verdict"。

**Next / Blockers（HITL — Danny 拥有，非 agent scope）**
- **未提交、未 push**（landing/demo 一 push 就自动部署；文案 `待审字`；合伙人 IP 待授权）→ Danny 审后拍板提交。
- 全部 EN + M3 中文 = `待审字`；办公 AI baseline 真抓一次（粘贴包已备）；合伙人具名来源/案例数公开需授权；Ray 建议 landing 具名合伙人（SCN-004 涉法律，作者可信度关键）。
- 真产品洞：avery loop 需强制 cite-before-number（真跑暴露）。
- Narrative 待定：Output 区是否上移到 DemoVideo 后；MarketGap 示意条形是否撤。
- live 眼验（demo 三区卡手感 / landing 渲染）建议在 Vercel preview 上做。

### 追加 2026-07-01（下午）· 诚实性修正：eval 命名 + 定位 pivot

- **eval baseline 命名诚实化（Danny 抓到）**：旧名 `avery-opus`/`codex-raw`/`claude-scaffold-minus-redline` 挂着误导性厂商标签。核实 `.env` 只有 MiniMax+DeepSeek（无 anthropic/openai），`runner.make_brain` 在 `--real` 下**三个 role 全走 MiniMax-M3**（`RealBrain`/Opus 无 key 会 raise）——是**同模型消融，非跨厂商对打**。改名 `avery-m3`/`m3-raw`/`m3-scaffold-no-redline`（+SUT 加 `real_model_note`）；如实化 runner docstring+`--real` help、judge 自我偏好消息、brain mock 名；改 3 个测试文件 → **pytest 124 绿**；`--check-frozen` DRIFT → 重冻（hash `bb59a7db…`）；`runner --real` + `judge --real` 重跑 → `runs/real-0701c`。诚实结论不变（红线是唯一干净差异 `avery-m3` 1.0 vs baseline 0.9/0.8；软维度不区分；引证对所有人都弱含 avery；NOT PUBLISHABLE）。全文 `eval-harness/EVAL-REAL-0701.md`（含同模型消融声明）。
- **office-AI 真捕获（Danny 手跑）**：SCN-001 粘进 3 个免费通用 AI。机检：**ms-copilot PASS · chatgpt PASS · gemini FAIL[PERSON-DIAGNOSIS]**；全部 UNCITED-NUMBER。**发现**：2026 免费 AI 给暖建议、2/3 不给人贴标签 → **"我们不打分、它们打分"这个卖点站不住**。真差异 = 通用 AI 给完建议就停（无升级/无置信/无证据链），Avery 三样都给。
- **定位 pivot（Danny 拍板）**：红线**降为信任保证**（保留在 TrustLayer/Method/Output/Modules/隐私句），**从竞争亮点/反面教材 C 位撤下**；`whatItIs` 标题改成正向"A senior advisor for the call that's yours to make"，人身不打分降成一句信任注脚。**EvalContrast 用真抓取（去标识）重锚到真差异**："都在乎人,但只有一个告诉你多大把握、何时该拉 HR、并亮证据"（左=通用助手好建议但 `missing` 三缺口，右=Avery 补齐）。顶层定位（marketGap/output/method/stack）本就在对的轴上,未动;**demo 未动**（其 8 字段卡本就是真差异叙事）。en.ts 改后 **M3 重生 zh.ts 20/20**；`tsc --noEmit` 绿。
- **仍未提交/推送**；所有新文案 `待审字`；真产品洞记录在案（avery loop 需 cite-before-number）。

## Update — 2026-07-03 · feat-014 卡片式今日主页（Morning Desk A+）done

> 缘起：合伙人（真实 HR 高管）发来自撰 PM-dashboard HTML mock——硬需求"进主页第一眼必须有 checklist 式的东西，卡片/颜色/动画一目了然，快速进入心流"。Danny 判断与之一致：现有全屏地图"放进办公室像玩具"。完整决策链：grill 6 决策 → ADR-0017 → 设计 3 方向 → claire+dana 双盲评审 → A+ 拍板 → GH issue #9 AFK 票 → 自循环开发 → 双 checker PASS。

**What's Done**
- **领域模型**：`CONTEXT.md` Dashboard 重定义（卡片式今日主页=进门第一面）、新增 **Team map**（全景子视图）、Calm/Focus 归属调整、Handoff 补"进门第一眼主体之一"；新 `docs/adr/0017-card-home-demotes-team-map.md`（取舍与回退成本都写了）。
- **实现**（全部细节见 feature_list.json feat-014 evidence + `.issues/feat-014/plan.md`）：
  - 新 `HomeScene` = 默认「Your team」：左脊柱今日 Handoff checklist（4 卡，墨迹勾选→"Handled today"抽屉→安静计数→前辈收尾屏）+ 右双轨证据层（人卡全定性、项目卡可硬；hover 联动点亮/降透明/浮依据签，纯 CSS 类驱动）。
  - composer 抽取为 `TeamComposer` 随迁主页；勾选态在独立 `homeStore`（契约冻结不扩 canvasStore；rail seek 不抹勾选、restart 清）。
  - 地图降级：tab 移除；入口 = 卡上 "See it on the map"（+focus）/ 右栏 "See the whole picture"（calm）；地图加 `← Back to today` chip；composer/briefing HUD 从地图移除。
  - rail：B1/T1/T2→home，B2=地图高光拍，B10→home 且 checklist 切 grown 版（感谢 Lin Qing 卡）。
- **验证**：`./init.sh` 绿；dev server DOM 断言全过（交互/联动/rail 26 拍/capture/红线扫描主页零 %）；claire PASS（三必达改进落地）+ dana PASS（"没有把我的人变成分数"），两轮建议共 7 条已修（文案 3 + 交互/CSS 4）。
- **提交**：本地 commit（见 git log），**未 push**。

**已知限制 / Notes**
- headless 预览 rAF 停摆（feat-006 记录过的截图超时同源，且更广）：动画插值无法机测，静态样式用 `transition:none` 旁路断言正确；**动画手感 + 窄屏（<1080px 塌单列）+ 依据签换行观感，需 Danny 真机目测**。
- 死 CSS 未清（stay in scope）：`.scene-dashboard .composer-*` 覆盖（composer 迁出后失效，global.css ~1886-1921）。
- demo 录像脚本注意：B1 拍的 caption 从 "Dashboard calm" 改为 "The morning desk"，beat 总数不变（26）。

**HITL（Danny）**
- 全部新英文 copy `⚠ 待 Danny 审字`（fixtures.home.ts / railStore captions / map-back-chip / alertPills 原有）。
- 真机目测后决定是否 push（push = tm2 自动部署）。
- 文案微决策：hh_pitch 的 "goes out today" 与依据签重复；"Handled today" 词义（claire 2c-2，已分开计数）。

## Update — 2026-07-03 · 商业模式对齐（grilling session）→ ADR-0019
- **Danny + Claude 逐条 grilling 合伙人 revenue deck（2026-07-02 版）**，采纳为唯一口径；
  旧"advisor 免费 + playbooks 付费"作废 → **ADR-0019**（四层付费、无免费层、订阅为主体、按 manager 计费）。
- 磨出三件带给 Cythia 的东西（`docs/commercial-alignment-for-cythia-20260703.md` + `.zh.md` 中文 M3 版，可直接转发）：
  ①终局漏斗 60/20/15/5 ≠ 增长期 mix（补三阶段表 + 两条 attach 隐含假设明文化）；
  ②benchmark 三条隐私边界（组织级 only / opt-in / 样本不足不出数）；
  ③token 机制（席位含合理用量、BYO-API=企业版信任功能非折扣、每公司最低席位数、数据源分档）。
- 领域落盘：`CONTEXT.md` 新增 **Commercial language** 六词条 + Capabilities 改"随席位订阅不单卖"（已 committed）。
  核对当晚路演页：盈利模式屏与 deck 数字一致、算术复算全对、"工具免费"句已消失。
- **文件史注**：ADR-0019 + Cythia 清单曾于 07-03 落盘、未及 commit 被并行 line 清理误扫；
  07-05 Danny 确认后原样恢复并单独提交（决策本体期间一直安全在 committed CONTEXT.md）。

## Update — 2026-07-05 · 双线战略圆桌（架构锁定 → feat-015..020 teed up）

> 战略圆桌（非编码 session）。缘起：路演 + 酒店/建筑洽谈，定双线并行。完整记录 `docs/strategy/2026-07-05-dual-line-strategy-roundtable.md`；决策 `docs/adr/0020-*`（graduate + seam）+ `docs/adr/0021-*`（两引擎 + 换皮 + 双端）；术语 `CONTEXT.md` 新增 **Product surface** 组。

- **核心反转**：现在的 demo 是录像回放、不接真实输入——两条线都缺"接真实输入→出真 Avery 回答"这同一能力，而它 80% 已在 `eval-harness`。
- **锁定决策（10 条，逐条 grill）**：Line A=真 LLM 顾问复用 eval-harness；一套内核+垂直包+皮肤；**双端**（境内中文+海外英文）；企业 demo=可信 mock 集成+真顾问核；内核+首个垂直**并行**起跑；**酒店先行（婚宴亮点）**；垂直包混合 authoring；**graduate 现有 Vite demo→Avery Live**（story+live 双模，两道 seam），不新建 app，**ADR-0001 被 ADR-0020 超越**；**内核=两个引擎**（advisor 已存在 + ingestion 新建更重）；v1 ingestion **一步到位全向量 RAG**。
- **内核=两引擎+两 seam**：advisor（eval-harness）+ ingestion（上传→解析→红线安全抽取→全向量 RAG→填 Your team→喂回答卡）；`StreamSource` + `TeamDataSource` 两道 seam（story 脚本 / live 真数据），seam 同时是 AFK 测试缝。
- **红线扩面**：ingestion 抽取阶段内建红线过滤器（简历→人卡只到定性，绝不评分/排名/画像）；红线扫描从脚本 fixtures 扩到 **live 产出**。
- **新工作项 feat-015..020**（feature_list.json，全 not-started，JSON 已 `node` 验证）+ 各 `.issues/feat-01x/kickoff.md`（AFK 冷启动可读）：
  - feat-015 Agent service（FastAPI+SSE 包 eval-harness）← 立即可起
  - feat-016 Ingestion engine（大核）← feat-015
  - feat-017 Frontend graduate→Avery Live（两 seam+i18n）← 015+016
  - feat-018 双端部署 ← 017
  - feat-019 酒店换皮（pack+skin+demo）← 016+017；**pack-authoring 立即可并行起**
  - feat-020 建筑(byggsamverkan)调研 + 办公软件集成可行性 ← 立即可起
- **D5 并行三条立即 AFK 起跑线**：feat-015 + feat-019 的 pack-authoring + feat-020。
- **客户事实校正（07-05 晚，Danny）**：Line B 两真实客户 = **三亚绿杉壹居度假酒店**（度假酒店，婚宴是业务线之一，非“婚庆公司”；包按酒店建模、婚宴作亮点）+ **byggsamverkan**（瑞典建筑，https://www.byggsamverkan.se/ ；栈=Teams/Outlook/CAD/一款建筑项目软件）。**国内调研走 `/mmx-cli`、境外走普通 web；调研结果落 `D:\Boyle\research\`（项目外，非项目内）**（memory `domestic-research-use-mmx-cli`）。feat-019/020 kickoff + feature_list + strategy/ADR-0021/CONTEXT 已同步。
- **feat-020 ✅ done（07-05，AFK 线，核心+supplement）**：建筑集成可行性 + Skeppsviken 画像 → `D:\Boyle\research\skeppsviken-construction\`。★反转已解：`byggsamverkan.se` = PM 软件 Next Project 厂商页、非客户官网；**真实客户 = Skeppsviken**（西瑞典建筑+地产集团，约 152 人，自营土建）。四款软件全开放 API；roadmap lite=导出上传、企业 live 优先 Graph>Next Project>APS。余 2 项待合伙人一句话（PM 云/桌面、CAD 产品）。feature_list evidence 详录。
- **feat-019 ✅ 研究+包草稿 slice done（07-05，AFK 线）**：客户核实=三亚绿杉壹居度假酒店（海棠湾豪华度假村，2024-12 开业，阳光保险投资，211 房+30 别墅，962㎡ 草坪=婚宴 showcase）；外置 `D:\Boyle\research\sanya-lushan-yiju-hotel\`（00-findings + pack-draft：5 案+5 PB+6 信号+5 护栏，红线零人评分）。待 feat-016/017 做 skin+demo+集成。HITL：Danny 补 9 条内行 know-how。
- **feat-015 ✅ done（07-05，AFK 门全绿）**：agent service `eval-harness/service/`（FastAPI+SSE 包 engine，8 字段投影+API 边界红线，3 端点）；pytest 141 passed 零回归 + MiniMax-M3 真冒烟过。**代码在 worktree（branch worktree-agent-ac44e3f46118f46ca），未 commit、待整合进 main**。
- **★ D5 三条并行线全部回（07-05）**：feat-015 ✅ / feat-019 研究+包 slice ✅ / feat-020 ✅。
- **★ AFK 串行链 `feat/live-core-015-018` 全线完成（07-05）**：f965bad docs → 4517f0e feat-015（141）→ 4e1bac0 feat-016（169）→ fae493f/e1b890d feat-017 ✅（story 零回归+rail seek+live+红线净+zh=M3）→ **feat-018 ✅ done（双端 config+runbook，未 deploy；dual-build 3/3 + pytest 169 + ingest HTTP 13/13 + 真 MiniMax 冒烟；补齐 ingestion HTTP 面 /ingest·/team·/advise 接 context）**。**015→018 核心齐活**。真部署/域名/promote/protection/审字 = Danny HITL。主 main 不动，等 Danny 分支验收+merge。
- **AFK 硬约束入 memory**（`afk-self-loop-minimize-danny`）：dev+test 自跑自验自修，HITL 只留审字/价值观/授权/评分/promote。
- **不动的约束**：红线 ADR-0015/0018、决策层真理、Avery 品牌、商业模式（口径见 committed CONTEXT.md § Commercial language，sampler≠免费层，护栏见 ADR-0021 §6；ADR-0019 已于 07-05 恢复落盘并提交）、中文经 M3、**story mode 保留=不动 rail 回放机器**（ADR-0003/0006/0012/0013/0014）。
- **旧账未变**：feat-014 审字 + tm2 promote 仍是 Danny 的 HITL（见 `session-handoff.md` §4）。

## Update — 2026-07-05 · feat-018 双端部署（AFK 线，config+smoke+runbook，未 deploy）

> ADR-0021 §5。**产出 = 配置 + 冒烟 + runbook，NOT 实际部署**（域名/promote/protection/真 key 全 Danny HITL）。分支 `feat/live-core-015-018`，未 commit，待整合。

- **前端双 target 构建配置**：`VITE_AVERY_MODE`（story/live）+ 新增 `VITE_AVERY_LOCALE`（en/zh，境内 ZH 默认，`?lang=` 仍可覆盖，镜像 mode.ts）+ `VITE_AVERY_API_BASE`。`vite.config.ts` 给每个 target 打 `window.__AVERY_BUILD__` 戳（可 devtools 目测 + 冒烟无歧义断言）。`.env.example`（前端，无密钥）+ `vercel.json`（海外 EN，**与 landing 分离的独立项目**）。
- **后端 agent service 部署配置**：`eval-harness/Dockerfile` + `.dockerignore`（**一个镜像双 host，仅 env 换脑**：境内 minimax/deepseek · 海外 claude）；`service/.env.example`（brain+embeddings+retrieval+pgvector 全 env 矩阵模板，key 字段空）。
- **补齐 ingestion HTTP 面**（feat-016 显式留给 feat-018 的活）：`service/ingest_api.py`（`POST /ingest` · `GET /team/{id}`，薄包 `ingest_paths`+registry，compose-not-modify）+ app.py 挂载 + 把 `company_context_id` 经 seam 接进 `/advise`（上传→当场看团队长出→顾问答落在上传事实，端到端通）。
- **双端冒烟门 `scripts/deploy/dual-smoke.sh`**：一条命令断言两侧。**AFK 门全绿**：前端 3 target（story-default 保留 + overseas-en + domestic-zh）构建+戳全对；后端契约电池 44 passed + ingestion HTTP 端到端（含红线：诱导简历只抽定性、人卡零评分键）；**真 MiniMax（境内）契约冒烟 1 passed**（37s）。**全仓 pytest 169 passed 零回归**；`init.sh` 绿（默认仍 story/en 安全默认）。
- **runbook**：`docs/deploy/dual-deploy-runbook.md`（逐 target step + env 矩阵单一真源 + HITL 清单）。**Danny HITL**：域名、境内/海外主机开通、真 key（不进 git）、`docker build`+容器 /health 冒烟（本机 Docker daemon 未起）、Vercel 项目 Root=repo root（≠landing）、境内静态托管上传 dist+SPA fallback、生产 promote、deployment protection 面板给融资团队访问（别锁死 SAML）、可选 vector RAG 开关（选 embeddings+pgvector+3 个 env）。
- **无密钥入 git**：`.env.example` 模板 key 字段空、pgvector 用 CHANGEME 占位；真 `eval-harness/.env`（有 MiniMax/DeepSeek key）gitignored+未 tracked，已核。
- **源码改动（surgical，5 文件）**：`src/i18n/index.ts`（+VITE_AVERY_LOCALE 构建默认）· `src/vite-env.d.ts`（env 类型）· `src/main.tsx`（曝 __AVERY_BUILD__）· `vite.config.ts`（打戳）· `eval-harness/service/app.py`（挂 ingest router + 接 context seam）。engine（loop/redline/brain/ingest）零改写。

## Update — 2026-07-07 · 救 15–20:确诊 + grill 拍板(ADR-0022;本 session 零实现代码)

- **使命完成**:① 复现+确诊「15–20 为什么临近崩盘」② grilling 六岔口逼出 Danny 亲拍的补救计划。全记录:`.issues/live-rescue-0707/plan.md`(决策表)+ 根 `session-handoff.md` 07-07 收盘版(确诊全文)+ **ADR-0022**。
- **确诊要点(全 verified)**:管道真、门面假——(a) story 渗漏 3 缺口:live 空态左脊柱渲染 scripted 占位(眉题 "FROM YOUR UPLOADS" 下是 Venus/Kate/Jason)、TeamComposer 整个在缝外(live 提问进 story 剧本机,handoff §3 没抓到的新点)、详情页只查 fixtures(live 卡必 Unknown);(b) 抽取抓瞎:两个官方 seed 实测 → xlsx 20 人表出 1 个假人 "No."、pdf roadmap 出 1 个文件名项目;强制修正路由后 roster 启发式仍出 3 假人(Name 列焊死第 0 列);(c) 174 绿没拦住 = 测试 fixture 按抽取器假设反向定制(数据层 maker==checker)+ live 从未被人点过。**好消息**:advisor+RAG 腿端到端真跑通(语义 recall 命中上传 xlsx 行+cite+红线全 hold),红线零违规。
- **grill 拍板(六岔口)**:C 同仓立墙(story/lite/shared + ESLint 机器边界)/ v1 lite 3 屏+薄详情 / LLM 主抽(M3+DeepSeek 现实可用,claude 仅无 key 代码路径——Danny 纠正记忆,勿再假设)/ 双层机器门(agent 当第一个用户,Danny 只抽查)/ 未提交改动都提+分支继续 / Gate 先红→双线并行。
- **落盘**:commit `53e0ef6`(feat-021 真向量,174 绿含真 API 证据)+ `4e90966`(fix:Story/Live 开关可点 + 剧本 rail 只挂 story)+ 本 docs 批;feature_list 新增 feat-021(done)/022/023/024(not-started);kickoff ×3。分支 `feat/live-core-015-018` 已 push;**main(2f76ceb)不动**,gate 绿+Danny 验收后才 merge。
- **下一步**:S1 = feat-022(gate 先立必红)+ feat-023(LLM 抽取修绿后端)→ S2 = feat-024(立墙修绿前端+story 回归)→ S3 合流验收 merge。
- Notes:环境坑复确认——headless 预览 rAF 停摆,场景切换/动画不可机测,断言走 DOM 旁路;07-07 工作树曾因分支切换被自动 stash(已恢复+落 commit+drop)。

## Update — 2026-07-07 · S1:feat-022 门立(必红)+ feat-023 LLM 抽取修绿后端

> 一个 AFK session 完成 S1 两步(plan.md §S1)。**红→绿的全程都有机器证据,无自报**。分支 `feat/live-core-015-018`,commit 链:`4398caa`(feat-022 门,出生即红)→ `0d1981c`(.gitattributes 钉二进制 fixture)→ `ad7ad13`(feat-023 修绿)→ 收盘 docs。main(2f76ceb)未动。

- **feat-022 ✅ done——双层机器门,立完即红(红是成功,ADR-0022 §3)**:
  - 后端 `eval-harness/tests/test_seed_gate.py`:离线层(无 key 绿,heuristic 强制,断安全不断质量)+ 集成层 `@seedgate`(真 uvicorn :8137、真 POST /ingest 两个官方 seed(已拷 tracked:`tests/fixtures/seed/`)、具名断言)。**立门时实测 3 红**(xlsx 具名团队=1 假人 "No." / 假人黑名单命中 / pdf=1 文件名项目)**3 绿**(人卡红线在真线上稳 / 无 U+FFFD / advise cite 命中 Lin Qing 行——07-07 晚漏检的检索质量当日复测已命中,留作回归守卫)。
  - 前端 `scripts/gates/live-frontend-gate.{md,snippet.js}`(浏览器自驱协议+DOM 断言包,story 名词黑名单、transition:none 旁路、setTimeout 轮询防 rAF 停摆)。实跑 verdict **RED**:空态 7 处 story 渗漏(Venus/Smart Shopping Guide/Kate/Jason/Wang/Venus Pitch/Lin Qing story 文案)、1 假人卡、点卡="Unknown teammate" 实证。**黑名单口径坑已埋点**:Lin Qing/Chen Mingyuan/Sun Xiaomei/Zheng Zixuan 四名 story 与真 seed 复用不得按名入黑;"New Retail" 不入黑(真 seed 有合法项目 "New Retail Smart Shopper Mini Program")。
- **feat-023 ✅ done——LLMExtractor,完工判定=022 后端断言全绿**:`pytest -m seedgate` → **6 passed(7:07)**:xlsx→**20/20 人**(Lin Qing Design Director:8 / Chen Mingyuan Founder-CEO:7,行号全对)、假人=0、pdf 单传→**2 项目**(LogiPulse Phase 1 done / Phase 2 on-track)、人卡零数字、无 mojibake、advise cite 命中。
  - 实现:`avery/ingest/llm_extract.py`(接 pluggable brain=M3 默认/DeepSeek 可切;行号喂入→一次结构化输出多实体,**每实体带来源行号**;三层红线=白名单 sanitizer(走私评分键只杀单条)→抽取器内 `validate_extraction` 门(正文评分整篇退兜底)→pipeline 复验;任何失败退 HeuristicExtractor,离线门永绿;正则未修=兜底原样)+ `service/extractor_factory.py`(`AVERY_EXTRACTOR` auto/llm/heuristic;claude 仍是无 key 代码路径未假设)+ parse.py mojibake/连字清洗 + /health 曝 extractor。
  - **两个真问题当场修**:① M3 是 reasoning 模型,`<think>` 吃 max_tokens 截断 JSON 尾巴 → 抽取 brain 32k 输出预算 + 逐窗容错(单窗失败重试一次后跳过,全败才退兜底);② provider 调用无超时会吊死 /ingest(旧探针实测吊死 20 分钟)→ 240s per-call timeout(`AVERY_EXTRACT_TIMEOUT_S`)。
  - 离线电池 `tests/test_llm_extract.py` 13 passed(FakeBrain 零网络,断机器不断模型:cite 链、红线分层、退化路径、表头假人/文件名标题拒收、factory 三档)。
- **验证态收盘**:init.sh 绿;离线 190 全绿(174 基线+14 llm 电池+2 offline seed);集成 `-m seedgate` 6 绿(数字见 handoff §2)。
- **门抓到一次真 flake,根因已定谳(这一段是 S1 最有价值的产出之一)**:pdf 项目断言专跑绿/复跑红。给 gate fixture 加 server 日志+给抽取器 fallback 加 logging 后定位:**不是网络——是红线在工作**。LogiPulse pdf 团队表带人均 Allocation %(~10%–80%),M3 有概率把 "80%" 抄进人的字段 → `redline_extract` person-score-value ×8 → 整篇退 heuristic → 文件名项目。修法**不改弱红线**:sanitizer 层剥离 rating 形数字(与前端剥离哲学一致,门仍是后盾;纯 % 条目整条丢弃)+ prompt 明令禁抄 allocation % + 词库类违规(如 "low performer")仍整篇回退(有测试钉住)。顺手的强壮化:两 seed 收进单窗(220→320 行/窗)、逐窗 3 次尝试带退避、抽取 brain 240s per-call timeout、uvicorn 日志落 `runs/seed-gate-uvicorn.log`(下次 flake 不再盲修)。
- **前端门 023 后复驱(真浏览器+真 :8137 llm:minimax+真上传),又抓到一条 174 时代永远抓不到的崩溃**:`team_cards()` 一直发 `collaboration: list[str]`,但 transport.ts 契约误写 `string`、`liveRead()` 对它 `.trim()`——heuristic 从不产 collaboration,潜伏至 LLM 抽取第一次真发 → HomeScene 白屏。契约改 `string[]` + 适配(7ef9e31)。**复驱终态:teamRendered ✅(30 卡、Lin Qing/Chen Mingyuan 在、零血条)、postUploadClean ✅(0 story 名词)、emptyStateClean ❌(7 处)/detailIsLive ❌("Unknown teammate")——后两红按计划留给 S2**。黑名单再修一处假阳性:裸 "Wang" 撞真 seed 的 Wang Yuxuan,改用 story 文案签名 "Wang has it steady"。
- **S1 边界守住**:除 live seam 的崩溃级 bug fix(transport.ts/teamDataSource.ts 各几行)外未碰 src/;story/lite 结构、rail/store/camera/terminal-stream 原样;**前端断言保持红**,留给 S2 feat-024(立墙)。
- Notes:`.gitattributes` 新增——git 曾要对 tracked seed PDF 做 CRLF 归一化(会毁二进制,blob 已核完好);终端 GBK 控制台把 EM DASH/á 渲染成 "��" 是假象,U+FFFD 判定一律以代码断言为准,勿信肉眼;vite 会因 /@fs/ 取过的文件被编辑而全量重载页面 → 浏览器自驱相位全跑完之前别改文件(ephemeral 状态会清零)。

## Update — 2026-07-08 · S2:feat-024 同仓立墙 + lite 3 屏,前端门六相位全绿

> 一个 session 完成 S2(plan.md §S2 / ADR-0022 决策 1)。**完工判定全部是机器门输出,无自报**:前端门 verdict 六相位 `pass:true`、story 回归 29 步 26 拍零失败、后端 195 passed 零牵连、墙红灯实证 exit 1。分支 `feat/live-core-015-018`,commit 链:`b133210`(立墙+lite 壳+机器闸)→ 收盘 fixes+docs。main(2f76ceb)未动,S3 前不 merge。

- **feat-024 ✅ done——同仓立墙 + lite 3 屏壳,修绿 022 前端断言**:
  - **目录墙**:`src/story/**`(components/data/lib/store 四棵子树整树平移,story 内部相对 import 零改动;HomeScene/NexusScene 剥掉 live 分支——story 壳只在 story mode 挂载,分支不可达,DOM 逐拍验证不变)/ `src/lite/**`(产品壳,零 fixtures 依赖,类型全 lite 本地直typed 后端契约)/ `src/shared/**`(mode/modeStore/i18n/CSS 原子)。`?mode=` 语义=两个壳,App.tsx 是唯一合成根。
  - **机器闸(本 feature 的灵魂)**:eslint flat config `no-restricted-imports`——lite→story、story→lite、shared→两侧 全 error;`noInlineConfig` 让行内 eslint-disable 对墙失效。**红灯实证:注入违规 import → `npm run lint` exit 1(报错带 ADR-0022 中文口径);移除 → exit 0**。已挂进 init.sh 第一步(AFK 门组成部分)。
  - **global.css 拆分(52ecfb5 教训的解法)**:按行界切成 10 个顺序 chunk(shared 5 + story 4 + lite 新增 1),main.tsx 按原文件顺序 import——**shared/story chunk 串联与拆分前逐字节一致**(脚本验证 `concat==original`),cascade 零漂移;lite.css 唯一新增排最后。story 资产哈希不变(cleric_sprite_sheet-DD71vM_i.png 等全同)。
  - **lite 3 屏**:TeamScreen(上传空态=live 自己的引导文案,左脊柱零 scripted 占位;上传后=briefing 真数顶栏(ingestion metrics)+人卡(InitialAvatar,红线:类型层无数字键+运行时 stripPersonNumbers)+项目卡+弱 handoffs(只从 blocker 派生))· RoomScreen(薄建:SSE 控制台+8 字段 LiteAdviceCard,复用 shared CSS chrome,不搬 1400 行剧场)· DetailOverlay(~150 行只读浮层,纯 live payload,**杀死 "Unknown teammate"**)。LiteComposer:预填空、@ 引用只来自 live 语料、提交 askLive→room(不进 story 剧本机)。
  - **前端门 verdict(2026-07-08 实跑,真 uvicorn :8137 minimax+dashscope+llm:minimax、真上传两 tracked seed、浏览器自驱)**:`{"pass":true,"phases":{"emptyStateClean":true,"ingested":true,"teamRendered":true,"postUploadClean":true,"detailIsLive":true,"composerIsLive":true}}`——A 空态渗漏 **7→0**、C **30 人卡**含 Lin Qing/Chen Mingyuan 零血条、E 详情显真名零 Unknown、F2 动态 **18 帧 SSE 到 DOM+manifest+8 字段卡**(verdict 全文在 feature_list evidence)。
  - **story 回归**:rail 26 拍/29 步 DOM 断言驱动(键盘通道+DOM 轮询)`{"pass":true,"totalSteps":29,"beatTotalOk":true,"failures":[]}`——idx1 主页 4 卡/8 人/6 项目/零 %、idx3 focus 簇=8、idx12 structured-output、idx16 grown 切换(CAUGHT AND SETTLED)、idx28 capabilities、末拍 26/26。
  - **后端门复证(立墙动了前端,收盘复跑)**:`python -m pytest eval-harness -q` → **195 passed, 1 skipped in 474.94s**(=189 离线+6 seedgate 全绿;skip 见 Notes,与后端行为无关)。init.sh 绿(lint+tsc+build 459 模块)+ 双 target 构建 smoke 3/3。
- **S1 立的动态断言补齐(顺手债)**:snippet 新增 `composerAskLive` 相位 F2(真提交→SSE 事件到帧→manifest→卡渲染),verdict 的 composerIsLive=F1 静态**且** F2 动态,漏跑=红。**它第一次跑就抓到两条真 bug**:
  1. **transport.ts SSE 分帧 bug(致命,潜伏自 feat-017)**:记录切分只找 `'\n\n'`,而 sse-starlette 按 SSE 惯例发 CRLF(`od -c` 实证 `…"}\r\n\r\nevent: think…`)——**一条记录都切不出来**,流"正常"走完但零帧、advice 永远 null。S1 只立了静态检查,这条链路从未被真浏览器点过。修:`/\r?\n\r?\n/` 切分。修后实测 18-26 帧真渲染。
  2. snippet 自身选择器 bug:`input[type="text"]` 匹配不到无显式 type 的 input——F1 一直静默拿空 prefill 恒绿。修:`.composer-main-row input` 主路径 + composer 补显式 type。
- **Notes(不阻塞,S3 处理)**:
  - `eval-harness/tests/test_service_contract.py::test_schema_field_list_matches_frontend_agentoutput` 因 fixtures.ts 移居 `src/story/data/` 路径失效 → **skip**(195+1s 的那个 s)。按"eval-harness 不动"纪律未顺手修;S3 应把该防漂移守卫重指 `src/story/data/fixtures.ts` + lite 侧真身 `src/lite/streamSource.ts`(LiteAdvice)。
  - 隐藏 preview tab 的 Chrome 定时器节流(链式 setTimeout 可被压到 ~1 次/分钟)会拖慢 snippet 内部轮询——ingest settle 等待预算已放 360s(对齐后端 240s/call 包络+tick 粒度,断言本体未动),坑已记 live-frontend-gate.md。
  - 本轮某次 ingest 中红线又拦到 M3 把评分文本抄进人字段(`person-score-text:Noah Williams`→整篇退 heuristic),红线在工作,非 flake。

## Update — 2026-07-09 · S3:Danny 试玩通过 → merge main;下一波(lite 打磨)已排

- **S3 合流完成**:Danny 亲手试玩 lite 全流程(上传→人卡→详情→提问→8 字段卡),基本功能通过 → 顺手清了 S2 留的账:契约防漂移守卫重指墙后双真身(story `fixtures.ts` AgentOutput + lite `streamSource.ts` LiteAdvice,`test_service_contract.py` 11 passed 0 skipped,commit 9a4e699)→ **merge `feat/live-core-015-018` → main(`1f5a56a`,--no-ff 里程碑 commit,已 push)**;merge 后 main 上 init.sh 复绿。ADR-0022 救援线(S1 门红→S2 立墙前端绿→S3 合流)**closed**。
- **Danny 试玩反馈 7 项 → 下一波作战文件已落**:`.issues/live-polish-0709/plan.md`(反馈原话+考古入口+session 划分)+ kickoff-s4/s5/s6.md。划分:**S4 考古判定+UI bug 即修**(串行先跑:lite 缺 Playbooks/team map/room 画板是"拍板范围"还是"遗漏"?repo 证据初步指向 ADR-0022 决策 2 的 v1 拍板——"地图/Playbooks/多人 Chat = story-only",S4 拿实证给 Danny 拍板补齐范围;两张 UI bug 截图直接修)→ **S5 feat-025 模块补齐 ∥ S6 feat-026 定位叙事+能力边界 mock**(worktree 并行,交集只在 LiteTopbar/LiteApp)。feat-025/026 已登记 not-started。
- Notes:两个 UI bug 截图在 `D:\Screenshot\`(首页UI bug.png / 按钮风格丢失.png),S4 优先怀疑方向=CSS 拆 chunk 后 lite 复用类名的 cascade 断差;item 6/7 参考资料 4 篇路径在 plan.md §2。
