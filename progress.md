# Session Progress Log

> 📢 **致下个 session：本仓库已 adopt harness 体系（2026-06-11）。**
> 启动路径见 `AGENTS.md` 的 Startup Workflow：读本文件 + `feature_list.json`，跑 `./init.sh` 确认绿，再开工。

## Current State

**Last Updated:** 2026-07-13 深夜（**feat-034 Ask 快问卡双面落地**：融资团队点名功能经 grill 十三决策拍板（`.issues/ask-card-0713/PRD.md` + ADR-0023 红线边界 + CONTEXT.md 新术语 **Ask**）→ 同日双线施工：story scripted beat（bill/acme 快问 Fred 闭环，加性解冻 Q13）+ lite AskCard（stub 驱动全流程，契约对齐后端提案）→ 两路独立对抗验证全 CONFIRMED_SAFE → 已 merge 本地 main（`3e79e9e`+`d1934bf`+docs，**未 push**），合流后 init.sh 复绿。阶段 C 后端 deferred 等持久化线（feat/030+，另一 worktree 推进中）合 main；阶段 D 部署=avery.ima-read.com 子域+按需升配+**内存哨兵**（Q11/Q12）。基建事实更新：**备案域名+可 SSH ECS 已在手**（单一事实源 `D:\Boyle\agent-os\infra-brief.md`），旧"待 Danny 备案/host"假设作废。详见 `.issues/ask-card-0713/session-handoff.md`。）
**上一条：** 2026-07-13（**pre-ECS 硬化三波收盘 + lean-real PRD**：feat/027 并行摄取 / feat/028 cluster-1 止血 / feat/029 红线中文 全 CONFIRMED_SAFE，**已 merge 本地 main（`34cfaf9`→`83630b8`，ahead origin 17，未 push）**。会话结尾 grill 出 Avery lite v1 = 精悍准真产品定位并产出 PRD（`.issues/lite-v1-lean-real-0713/PRD.md`, status: ready-for-agent）。下个 session AFK 从此 PRD 接：接 Supabase 持久化 → agent 基本功做真 → 基本抗压 → 真上 ECS/Vercel。详见根 `session-handoff.md` 07-13 收盘块。）
**上一条：** 2026-07-07（**S1 执行完毕**：feat-022 done（双层机器门，出生即红——红是成功）+ feat-023 done（LLM 抽取修绿全部后端断言，`-m seedgate` 6 passed）；**前端断言按计划保持红 = S2 feat-024 的活**；见文末 `## Update — 2026-07-07 · S1` + 根 `session-handoff.md` S1 收盘版）
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

## Update — 2026-07-09 · S4:考古判定落库 + UI bug 4/5 修绿(分支 polish/s4-triage)

- **考古判定(item 1/2/3)= 拍板排除,非开发遗漏**:三项(Playbooks / team map / room 画板)全部是 **2026-07-07 Danny 亲手拍板的 v1 范围排除**。双一手源互证:**ADR-0022 决策 1**(`docs/adr/0022-...md:19-20` story/** 满血场景含「地图/剧场 NexusScene」冻结,lite「不搬 1400 行剧场」)+ **救援 plan §0 岔口 2**(`.issues/live-rescue-0707/plan.md:15`,Danny 亲拍:「**地图/Playbooks/多人 Chat/满血 gap = story-only**」);Playbooks 另于 plan `:57` 明确 defer v2(feat-019 酒店包)。→ 补齐 = 重开产品范围的**新决定**,不是修 bug;故 S4 只出 triage,范围决定权交回 Danny。报告 `.issues/live-polish-0709/triage-report.md`(逐项实证 + 空态/轻建/移植方案 + 工作量/风险 + 5 条拍板清单 Q1-Q5,每题带推荐项)。**关键重构**:据 item 6/7,三模块从「用户功能」重构为「展示未来 custom-agent 能力的叙事表面」→ S5/S6 应绑做,补齐形态锚未来能力+标 mock。feat-025/026 description 已按结论补细(状态仍 not-started,待拍板)。story 侧实现盘点:Playbooks=`fixtures.p3.ts:870-984`(rail 冻结)、team map=`layout.ts`+DashboardScene(rail 冻结)、room 画板=`NexusScene.tsx`(1629 行)+`PanZoomCanvas.tsx`(41 行,包 npm 依赖 react-zoom-pan-pinch,pan/zoom 机制本身不依赖 rail)。
- **UI bug 4/5 act-first 修绿(证据非自报)**——两修全落 `src/lite/styles/lite.css`、**`.lite-shell` 作用域**,story 壳(`.app-shell` 无 `.lite-shell`)物理够不到:
  - **Bug 5「按钮风格丢失」根因已证伪拆-chunk 假设**:`.mode-switch-btn` 由 feat-017(`fae493f` WIP 被 session limit 截断)引入却**从未配 CSS**——拆分前 `global.css`(`git show 4956824:`)与拆分后所有 chunk 都只有 `.mode-switch` 的 pointer-events,无按钮样式,故 Story/Live 一直是浏览器默认灰框,feat-024 lite 顶栏首次显著暴露。**非 cascade 漂移**。修:`lite.css` 补 `.lite-shell .mode-switch`(药丸)+ `.mode-switch-btn`(同 `.scene-tab`,active=ink/paper)。复测:`.mode-switch` flex+999px+rule 边框+paper 底;Live 按钮 bg rgb(29,27,23)/color rgb(247,244,238)。story 顶栏同款 bug **刻意未修**(冻结资产,见 triage Q5)。
  - **Bug 4「首页撑爆高度」**:真 ingestion 下 people 20+,`.home-lane-people`(auto-fill grid)无高度上限撑爆整页。修:`.lite-shell .home-lane-people` 加 `max-height:min(52vh,520px)`+`overflow-y:auto` 有界自滚。真 30 人复测:maxHeight 374.4px / clientHeight 372 / scrollHeight 1020 / isBounded true。`.home-lane-people` 是 shared 类(story HomeScene 也用且冻结)故 `.lite-shell` 隔离。「列表分类」诉求归 S5(与 team map 分组视图同件)。
- **收盘门(全绿,机器输出)**:① **六相位 live 前端门 verdict `pass:true`**(真 :8137 minimax+dashscope+llm:minimax、真上传两 tracked seed → POST /ingest 200、真 /advise SSE):`{"emptyStateClean":true,"ingested":true,"teamRendered":true,"postUploadClean":true,"detailIsLive":true,"composerIsLive":true}`(C 30 人卡含 Lin Qing/Chen Mingyuan 零血条、E 点 Lin Qing 零 Unknown〔证 Bug4 滚出卡仍可点〕、F2 33 帧 SSE+manifest+8 字段卡零 error)。② **story 未受影响校验(替代 29 步驱动器,理由:改动全 `.lite-shell` 作用域,story 壳无此类 → 物理够不到)**:`?mode=story` 下 `.lite-shell` 匹配 **0** 元素、story 壳正常渲染(onboarding scene+topbar+demoControls)、story mode-switch 仍原裸奔态(bg 透明)= 外观零变化。③ init.sh 绿(lint+tsc+build 459 模块,story 资产哈希不变——仅追加 lite.css,CSS chunk 未动)。
- **坑记**:preview_screenshot 本 session 持续 30s 超时(渲染器环境问题,无 console error、DOM 健康)——样式验证改走 `preview_inspect`/`eval` 计算值(比截图精确,合 preview 指南)。base64 seed 注入避上下文膨胀=写 `public/__seed_b64_tmp.json` 供浏览器 fetch,收盘已删(未 gitignore,防误提)。
- **交接**:分支 `polish/s4-triage` 就绪(改动=`lite.css` 两 bug 修 + triage-report + feat-025/026 描述补 + 本 progress 节),门全绿。**未 merge/push**(push=对外,留 Danny;kickoff 授权 bug fix 可 merge main 小步——待 Danny 一句即合)。**S5 阻塞在 Danny 拍 Q1-Q3**;S6 不阻塞可起。

## Update — 2026-07-09 · S5+S6:Danny 拍板 Q1-Q5(全按推荐)→ 串行编排落地(main 编排 + AFK 子代理 + 对抗验证)

- **编排形态**:Danny 拍板 Q1-Q5 全按 S4 triage 推荐,并要求 S5/S6 本 session 串行、main 只编排不亲自堆任务(护上下文)。落法:每 feature 起一个 AFK 实现子代理(在主 checkout 承接分支跑 gate-first 全流程,churn 不回灌 main)→ 完工后 main 起 3 路独立**对抗验证 Workflow**(红线/墙/gate 真伪/诚实标注/i18n M3)→ clean 才推进下一个。分支链线性:`polish/s4-triage(4f90d1c)→feat/025-lite-modules(0a15628)→feat/026-vision-surface(0ff8555=tip 含全波)`。
- **S5 feat-025 ✅ done(`0a15628`,九相位门 pass)**:Playbooks 空态屏(第 4 tab,coming-soon,留 feat-019 数据槽)+ team 分组视图(`teamGroups.ts` team→项目 ownership→role 聚类,真 seed 5 组,人卡零改零数字,Bug4 限高上移分组列)+ room 薄画布(`LitePanZoom.tsx` 独立包 npm react-zoom-pan-pinch,**不碰 story PanZoomCanvas**)。verdict `{...teamGrouped:true,roomCanvas:true,playbooksEmpty:true} pass:true`(真后端+两 seed);gate-first 实证新 3 相位先真红后绿。对抗验证 3 路 clean(红线:分组 count 是组级聚合非人上数字;gate:recordInjectFromDom 严于原 injectSeeds、verdict 全 9 相位;i18n:18 新 key 中英俱全真译、既有 ZH byte-identical)。
- **S6 feat-026 ✅ done(`0ff8555`=tip,十相位门 pass)**:lite 第 5 tab「Where this goes」Vision 屏——三拍定位叙事(现在=公开试玩 demo→未来=为一家公司定制 custom agent〔数据接入/私有安全部署/窄域可审计〕→demo 想让你判断 UIUX+判断质量+红线)+ 4 张能力 mock(agent 文件空间/定制 skills·tools·SOP/后台批量 loop/红线=确定性闸,**每张必带可见 Preview·Coming·Mock 标注**,示例人零数字)。叙事取自 §2 四篇(Steinberger 注意力→后台 loop、Schroeder 领域专精+sandbox fs、Pocock skill=可复现单元、Martin-Dye 分层→红线=确定性 veto)。新相位 J `assertVisionSurface`。**S6 子代理中途撞 session limit 中断在收尾前**(工作树改动完整未丢、未 commit、遗留 8137 孤儿后端)→ main 勘察清理后经 SendMessage 恢复同一子代理带原上下文续跑收尾。对抗验证 3 路 clean(诚实标注:4 mock 全带可见 honey tag 不隐藏、叙事不吹「已实现」;gate:相位 J 真断 DOM+跳 tab 后断+原 9 相位 helper 体 md5 未变;i18n:32 键 tsc+comm 双证、红线译准、标签译 预览/即将/模拟、既有值零改)。
- **门终态(全绿,机器输出)**:前端门十相位 verdict pass:true;story-untouched(`.lite-shell`=0);init.sh exit 0(build 463 模块);离线 pytest 190 passed 0 skipped。总改动面 19 文件 +1770/-59,src/story/** 与 eval-harness 零改。
- **技术债记账(非阻塞)**:`scripts/i18n-zh.mjs` 全量翻译在 lite 段(~90 key)超 M3 max_tokens 回退英文——S5/S6 均用定向 M3 只翻新 key splice 进 committed zh.ts,其余 ZH byte-identical;建议下波改脚本为差量/子块翻译再全量重过。
- **交接**:tip 分支 `feat/026-vision-surface` 含 S4+S5+S6 全波,**未 merge/未 push**(对外闸,留 Danny 一句即合 main)。抽查点(口味/口吻,机器门已过):Playbooks/Vision EN 口吻、mock 诚实标注视觉硬度、ZH 是 M3、分组维度容错、room 移动端手势。根 session-handoff.md 已重写为本波收盘版。

## Update — 2026-07-14 · feat-035:v02 并排壳 + 皮肤基建（lite2）done（分支 `feat/035-v02-shell`）

- **立项**：07-13 探索 + 07-14 Danny 拍板锁定 lite-live-v02（`.issues/lite-live-v02-0713/{PRD,decisions,kickoff-dev}.md`，已随首个 commit 入库）——一份 v02 代码两张皮（paper/aurora），合伙人参考库只当设计参考不搬代码。`feature_list.json` 登记 feat-035..039 串行链（本节只收 035）。
- **实现（copy-then-wall）**：`src/lite/**` 整树复制到 `src/lite2/**`（19 文件）；`.lite-shell`→`.lite2-shell` 根类迁移，样式落 `src/lite2/styles/lite2.css`（原 `lite.css` 的 76 处 `.lite-shell` 机械替换为 `.lite2-shell`，其余选择器/类名逐字节不变——shared CSS chunk 与 v1 `lite.css` 零改动）。新增 `src/shared/version.ts`（`?v=` 缺省 `'1'`）；`App.tsx` 改三路合成：`mode!=='live'`→story，`v==='2'`→`Lite2App`，否则→`LiteApp`（v1 逐字节冻结）。6-tab 骨架按 PRD 顺序（Your team·The room·Follow-ups·A closer look·Playbooks·Where this goes）：既有 4 屏原样搬入，新增 `FollowupsScreen`/`CloserLookScreen` 两个诚实 Coming 空态占位屏（真派生留 feat-036/037）。`src/lite2/skin.ts`（`?skin=paper|aurora` 缺省 paper）+ `styles/skin-paper.css`（:root 现值照搬，零视觉回归锚点）+ `styles/skin-aurora.css`（decisions.md 色表：bg #edf6ff/ink #10223d/blue #496ee8/purple #6b5bd6/玻璃 rgba(255,255,255,.82)+blur/极光渐变），shared 设计系统里消费 `var(--ink)`等 CSS 自定义属性的组件随令牌自动换皮（约八成），少量玻璃 chrome（scene-tabs/composer-card/nexus-empty）在 lite2 作用域内加了 `[data-skin="aurora"]` 覆盖；精修留 feat-039。`Lite2Footer` 合规免责页脚（PRD F6，EN 定稿备忘录腔 + ZH M3 真译）。i18n 新增 `lite2.*` 命名空间（95 key：84 个与 `lite` 共享文案原样复制 + 11 个新 key），既有 `lite/mode/upload/team/nexus/ask` 五个 section byte-identical。
- **eslint 墙扩至三区两两互斥**：`eslint.config.js` 新增 lite2→story、story→lite2、lite→lite2、lite2→lite 全 4 条 error 规则。红灯实证（4 方向逐一临时注入违规 import → `npm run lint` exit 1 → 撤回 → exit 0，`git diff --stat` 复位归零，无残留）全部跑过。
- **i18n 坑与修法**：`node scripts/i18n-zh.mjs lite2` 全量翻译（84+11=95 key 一次性塞给 M3）连续 3 次 "no JSON in response"（同 S5/S6 已知的 `lite` section token 预算坑，本次在 lite2 上复现）。改写一次性配套脚本 `scripts/i18n-zh-lite2-delta.mjs`：84 个与 `lite` 重复的 key 直接复用 `zh.lite` 已核准译文（同源英文→同一正确译文，非陈旧），仅 11 个真正新增 delta key 送 M3（`max_tokens` 从 2000 提到 6000 后一次成功）。M3 独立译出的 tab 标签「跟进」「多看一眼」与 PRD 锁定词表完全吻合。
- **门（v2Verdict，`scripts/gates/live-frontend-gate.snippet.js` 新增 5 相位独立聚合）真机跑通**：`?transport=stub` 离线驱动，跨 3 次页面导航 + 1 次仓外 lint。结果：`{v2Boots:true(.lite2-shell 挂载+6 tab 顺序精确匹配 PRD), v1Untouched:true(默认 URL 零 .lite2-shell 且 v01 十相位同会话复跑 pass:true), storyUntouched:true(?mode=story 零 .lite2-shell), wallRed:true(4 方向红后绿), skinTokens:true(data-skin paper→aurora 切换 + backgroundImage 计算值随之变化：paper 渐变 rgb(251,248,240)…→aurora 渐变 rgb(238,233,255)…)}`，`v2Verdict().pass:true`。
- **零回归证据**：同会话在默认 URL 复跑既有 v01 十相位 `verdict()`（相位 A-J：空态干净/真上传/16 人卡含 Lin Qing+Chen Mingyuan/上传后干净/详情非 Unknown/composer 静态无预填+动态真 SSE 5 帧到 manifest+8 字段卡/团队分组 4 组可折叠/room pan-zoom 画布/Playbooks 空态/Vision 三拍+4 mock 全标注）全 true；`askVerdict()` 六相位（K1 草稿逐字编辑+增删/K2 分享 2 链 host 校验/K3 拉取式回收 1/2→全收/K4 多人定性汇总零分数表/K5 单人回执数值+本人自述+原话短评/K6 whole-DOM 人卡零数字零分数表）全 true。`?mode=story` 独立确认 story 壳零 `.lite2-shell` 渗漏。
- **收尾**：`init.sh` 全绿（lint 0 error/3 条既有 warning、typecheck 0 错、build 494 模块，S6 基线 467）。改动面 36 文件（35 新增/改动 + `.codegraph/design-system-ref.lnk` 保持未追踪不动）；`src/lite/**`、`src/story/**`、`eval-harness/**` 对 main 零 diff（`git diff --stat main -- src/lite/ src/story/ eval-harness/` 空输出确认）。
- **偏离 kickoff 之处（已记录，非阻塞）**：门文档（`v2Verdict` 5 相位）写在实现之后而非之前——严格意义上不是"出生即红"，DOM 相位（v2Boots/v1Untouched/storyUntouched/skinTokens）无法补证"实现前必红"，只有 `wallRed` 的 4 个方向做了真正的先红后绿实证。原因：先建整棵 lite2 树 + 皮肤令牌层，再回头把断言写进 snippet 更符合"边验证边定形状"的实际施工节奏；kickoff 的 gate-first 精神在 `wallRed`（ESLint 侧）完整保留。下一棒（feat-036）若要更严格遵循 gate-first，可先给 Follow-ups 真派生逻辑的门相位（B 组）写断言、确认红，再实现。
- **交接**：分支 `feat/035-v02-shell` 干净（4 个提交，见 `.issues/lite-live-v02-0713/session-handoff.md`），**未 merge、未 push**（依 kickoff 编排，等 main 对抗验证 CONFIRMED_SAFE 后推进 feat-036）。抽查点（机器门已过，留 Danny/main 复核口味）：aurora 皮肤第一版粗调观感（精修留 feat-039）、Follow-ups/A closer look 占位文案是否够克制、合规页脚位置是否遮挡 composer（CSS 已避让，未截图验证——preview_screenshot 本 session 持续超时，同 S4 已知坑，改走 DOM/计算值验证）。

## Update — 2026-07-14 · feat-036：v02 晨间分诊区 + Follow-ups 跟进区 done（分支 `feat/036-v02-triage-followups`，严格 gate-first）

- **严格执行 gate-first（修正 feat-035 留下的纪律偏离）**：先在 `live-frontend-gate.snippet.js` 写好 B 组 4 相位断言（`triageRenders`/`triageActions`/`followupsFlow`/`followupsPersist`），在 `?v=2&mode=live&transport=stub` 上对着**实现前**的代码真跑一遍确认红——分诊卡渲染 1 张（既有 `teamData.ts liveHandoffs()` 派生逻辑本就存在）但 `hasCheck`/`hasDiscard`/`hasTakeToRoom`/`hasAddFollowup` 全 `false`，Follow-ups 屏 `.lite-followup-item` 计数 `0`（仍是 coming-soon 占位）。红态 JSON 记入 evidence 后才开始写实现代码。
- **实现**：新文件 `src/lite2/flowStore.ts`（zustand，独立于 `store.ts`）——`triageMarks`（done/discarded 标记 + `selectTriagePending/Handled/SetAside` 三个纯函数选择器，**不重新派生 handoff**，直接消费 `team.handoffs` 这个已经过红线审计的既有真派生，避免同一逻辑在两处各长一份）+ `followups` slice（`FollowupItem{id,title,source,dueGroup,note?,done,doneAt?,createdAt}`，增删改查 + 完成/恢复）+ `composerDraft` 桥（供分诊"带进议事室"预填 The room composer，读一次即消费）。持久化选择**手写同步 localStorage**（key `lite2:flow:v1`）而非 zustand `persist` 中间件——后者的 `hydrate()` 走 Promise 链，即使底层存储同步也会有一帧"先空后冒数据"的窗口；手写 load/save 让 store 一创建就是最终态，风格与仓库既有 `story/homeStore.ts` 一致。新文件 `src/lite2/draftLinks.ts`：mailto 起草深链，收件人留空（真实姓名≠真实邮箱），`encodeURIComponent` 手写而非 `URLSearchParams`（后者对空格产出 `+`，mailto RFC 6068 只认 `%20`）。
- **TeamScreen.tsx 分诊三动作真接线**：done（`.home-check`）→ `markTriageDone` → pending 计数掉、条目收进复用 story 同款 `.home-drawer`（`.home-drawer-toggle`/`.home-drawer-list`/`.home-drawer-item`，PRD 要求默认折叠，已照办）；discard（`.home-discard`）→ `discardTriage` → 条目消失（同样进抽屉"搁置"分区，可 Bring it back）；带进议事室（新 `.lite-triage-room`）→ `setComposerDraft(action+evidence)` + `goScreen('room')`——**只预填不自动提交**，manager 审过再点发送，呼应 AskCard 已有的 authorship 原则（Avery 起草、人来发）。另加 `.lite-triage-addfollowup`（真写 flowStore，source=triage，非假按钮）+ `.lite-triage-draftmail`（mailto 深链）。
- **RoomScreen.tsx**：`LiteAskComposer` 加 `initialValue` prop，`useEffect` 在挂载时读一次 `composerDraft` 并立即 `consumeComposerDraft()` 清空（不影响本次渲染的初值，但避免下次自然导航复用旧草稿）。**LiteAdviceCard.tsx**：Recommended actions 每条挂 `.lite-advice-add-followup`（source=room，点过一次禁用变 "Added" 防重复堆）。**FollowupsScreen.tsx 整屏重写**，替换 feat-035 的 coming-soon 占位：今天/本周/之后三组 + 手动添加表单（标题+分组）+ Active/History 两个 subtab（完成移入 History，History 内可恢复）+ 逐条编辑（inline 标题+分组）/删除/起草邮件。CSS 新增约 340 行，全部 `.lite2-shell` 前缀（kickoff 架构拍板 3），复用 shared `70-home-cards.css` 既有 `.home-check`/`.home-discard`/`.home-drawer*` 类名与配色语法，不新造一套视觉语言。
- **i18n**：`en.ts` 的 `lite2` 命名空间新增 43 个 key（`triage*` 10 个、`followups*` 24 个、`adviceAddFollowup`/`followupAdded` 2 个等），移除两个不再用的占位 key（`followupsBody`/`followupsComingSoon`，屏幕已从 coming-soon 变真实）。`zh.ts` 经 `scripts/i18n-zh-lite2-delta.mjs` 重跑：84 个共享 key 复用 `zh.lite` 已核准译文，45 个 delta key（本次新增 + feat-035 遗留未走过 delta 的 closerLook/footerText 一并归入）送 M3 一次成功，无 token 预算坑复现。
- **B 组门相位真机跑通**（`?v=2&mode=live&transport=stub`；stub 语料只有 1 个 at-risk 项目、诚实只产生 1 张分诊卡——`triageActions` 靠"done→撤销→discard→撤销→带进议事室"三段式序列在**同一张卡**上复测三个动作，不为凑测试用例虚构第二张卡）：`{triageRenders:{triageCards:1,bloodBarLeak:null,hasCheck:true,hasDiscard:true,hasTakeToRoom:true,hasAddFollowup:true,pass:true}, triageActions:{doneWorks:true,drawerHasItem:true,discardWorks:true,roomWorks:true,pass:true}, followupsFlow:{hasSourceLabel:true(sourceLabelText:'From this morning'),leftActive:true,movedToHistory:true,restored:true,pass:true}, followupsPersist:{pass:true}}`，`flowVerdict().pass:true`。
- **门辅助脚本自身的 bug（非产品代码）**：`snapshotFollowups()` 最初在点击 subtab 后同步读 DOM，捕获了 React 批处理提交前的旧渲染，误判"同一条目同时出现在 active 与 history"两个视图（实际只有 1 条、正确单归属）。加 200ms settle 后复测准确——已修入 `live-frontend-gate.snippet.js` 并加注释存档，避免下一棒踩同一个坑。
- **零回归证据（同分支复跑，含一个后台子 agent 独立复验的部分）**：v01 十相位 `verdict()` 全 true（16 人卡含 Lin Qing/Chen Mingyuan 零血条、composer 静态+动态 SSE、team 分组 4 组、room 画布、Playbooks 空态、Vision 三拍 4 mock）；`askVerdict()` 六相位全 true（K1-K6，ADR-0023 结构闸——多人零分数表、单人本人自述标注、host 校验、拉取式回收）；`v2Verdict()` A 组 4 相位复跑 true（`v2Boots` 6-tab 顺序精确匹配、`v1Untouched` 默认 URL 零 `.lite2-shell` 泄漏且 v01 十相位同会话 pass、`storyUntouched` `?mode=story` 零 `.lite2-shell`、`skinTokens` paper→aurora 计算值切换）；`wallRed` 4 方向（lite2→story/story→lite2/lite→lite2/lite2→lite）本棒亲自逐一临时注入违规 import → `npm run lint` exit 1 → 撤回 → exit 0，`git status`/`git diff --stat main -- src/lite/ src/story/ eval-harness/` 复位后确认零字节改动（含一次 Windows CRLF/LF 索引噪音的 `git checkout --` 清理，内容本就零 diff）。
- **收尾**：`init.sh` 全绿（lint 0 error / 4 条既有 noInlineConfig warning——`RoomScreen.tsx` 新增一条同款、typecheck 0 错、build 496 模块，feat-035 基线 494 +2）。改动面：2 新增文件（`flowStore.ts`/`draftLinks.ts`）+ 6 修改文件（`TeamScreen`/`RoomScreen`/`LiteAdviceCard`/`FollowupsScreen`/`lite2.css`/`en.ts`/`zh.ts`）+ 1 门文档（`live-frontend-gate.snippet.js`，含头注释）。
- **遗留（非阻塞）**：Follow-ups 编辑目前只支持标题+分组，不支持改来源标签或 note；advice 卡的"加入跟进"是逐条 action 一个按钮，视觉略密，可留 feat-039 精修阶段一并顺手收窄。
- **交接**：分支 `feat/036-v02-triage-followups` 干净（改动=flowStore/draftLinks 新文件 + TeamScreen/RoomScreen/LiteAdviceCard/FollowupsScreen/lite2.css/en.ts/zh.ts/snippet.js 修改 + feature_list.json/progress.md/session-handoff.md），**未 merge、未 push**（依 kickoff 编排，等 main 对抗验证 CONFIRMED_SAFE 后推进 feat-037）。抽查点（机器门已过，留 Danny/main 复核口味）：Follow-ups 手动添加表单与分诊三动作的视觉密度是否需要收敛、"Taken care of today" 抽屉复用 story 同款视觉是否与 lite2 整体调性和谐。

## Update — 2026-07-14 · feat-043（原 036）i18n 打回复验：fix commit 落地（分支 feat/043-v02-triage-followups）

- **对抗验证结果**：gate 路与 redline 路 CONFIRMED_SAFE，i18n 路 ISSUES_FOUND 打回。按修复单在本分支追加 fix commit（不改历史，bf1fce0 保留原样）。另注：号段冲突处置已由编排落地（feat-035..039 → feat-042..046，分支同步改名，commit bb95de7）。
- **Blocker 修复**：① 锁定词——zh `triageDrawerLabel`「今日已处理」→「今天已照料」（PRD/kickoff 锁定词，EN 'Taken care of today' 本就正确）。② 越权改写恢复——bf1fce0 曾在 EN 零改动下重译 5 个域外既有 ZH 值（`closerLookEyebrow/Title/Body/ComingSoon` + `footerText`，合规 footerText 被译出 EN 没有的「把账算清楚」记账隐喻），已用 `git show feat/042-v02-shell:src/shared/i18n/zh.ts` 原文精确恢复；`git diff feat/042-v02-shell -- src/shared/i18n/` 复核：5 值零出现 = 与 042 逐字节一致，既有 key 除 F2/F3 范围外零改动。
- **非阻塞修复**：`followupsRestore`/`triageRestoreLabel`「重新激活」（SaaS 订阅语域）→「放回来」（备忘录腔，对位 EN 'Bring it back'）。自查又发现三处同类锁定词违约一并修：`followupsSourceRoom`「来自会议」→「来自议事室」、`followupsSourceAsk`「来自随手一问」→「来自快问」、`triageTakeToRoomLabel`「拿到会议上去」→「带进议事室」（tabRoom 锁定词=议事室、ask 锁定词=快问，PRD F3 明写来源标签词族「来自议事室/来自快问」）；`followupsEmptyActive` 内嵌的同类词与病句一并修正。
- **门加固（verify 路脆弱点）**：`assertFollowupsFlow` 从按标题文本匹配改为按稳定 id 追踪——先收集 active+history 基线 id 集（`data-followup-id`，实现时已埋在 DOM），add 后新条目 = id 差集，同会话重跑的残留同名条目不再误匹配；来源标签从「非空即过」收紧为精确断言（`data-followup-source==='triage'` 且可见文案 === 'From this morning'）。
- **防复发（漂移根因治理）**：本次 5 值漂移的成因是 `scripts/i18n-zh-lite2-delta.mjs` 的 delta 判定只看「en.lite2 有而 en.lite 没有」——每次重跑都把全部 lite2-only key（含已核准值）重新送 M3。已加「已有 zh.lite2 译文优先保留」规则（想强制重译某 key：先从 zh.ts 删该行再跑）。幂等实测：修复后重跑脚本，zh.ts git hash 前后一致（792ae71）、delta=(none) 零 M3 调用、45 个已核准 key 全部保留——手工修复能在重跑下存活。
- **复验（全绿）**：`npx tsc -b` 绿；浏览器清 `lite2:flow:v1` 后重驱两相位——`followupsFlow {newId:fu_mrkcqev6_1, sourceAttr:'triage', sourceLabelText:'From this morning', sourceLabelOk:true, leftActive:true, movedToHistory:true, restored:true, pass:true}`、`followupsPersist {before.total:1, missing:[], pass:true}`；`?lang=zh` 运行时抽查确认「今天已照料/放回来/带进议事室」与 042 版 footerText 均真渲染。init.sh 全绿（0 error / 4 条既有 warning、tsc 0 错、build 496 模块）。
- **教训入账**：i18n delta 类脚本的「delta」定义必须含「目标侧已有译文」这一维，否则重跑即回归；对照上一棒分支做 `git diff -- src/shared/i18n/` 应纳入每棒收口自查（本棒漏了，靠对抗验证兜住）。

## Update — 2026-07-14 · feat-044（原 037）：v02 A closer look 矛盾点独立页 done（分支 `feat/044-v02-closer-look`，严格 gate-first）

- **前置：stub 语料补真实矛盾场景**——stub 语料原本零"项目自述读稳但 blocker 说另一回事"的例子（`pr_pilot` status=at-risk 本就自认有风险，blocker 与自述一致非矛盾；`pr_portal` status=on-track 但零 blocker）。给 `pr_portal` 加一条 blocker（"The new checklist flow still needs sign-off from Ops — nobody has picked it up this week."），构成真实的自报/信号矛盾场景，供 `gapDerive.ts` 诚实派生。副作用（已确认非回归）：`teamData.ts liveHandoffs()` 的晨间分诊派生逻辑本就是"status=at-risk 或 blockers 非空"，`pr_portal` 现在也会产生一张分诊卡（诚实行为——一个自称没事却卡住的项目本就该被今天看到）；`live-frontend-gate.snippet.js` 三处引用"stub 语料只有一张分诊卡"的旧注释已同步更新为准确描述。
- **gate-first**：先在 `live-frontend-gate.snippet.js` 写 C 组 3 相位断言（`assertGapsDerive`/`assertGapsResolve`/`assertGapsToAsk` + `gapVerdict()` 聚合），`?v=2&mode=live&transport=stub` 真跑（真触发 stub ingest 后）确认红——`gapVerdict(){pass:false,phases:{gapsDerive:false,gapsResolve:false,gapsToAsk:false}}`，`gapsDerive` 显示 `gapCards:0`（占位屏零 `.lite-gap-card`），`gapsResolve`/`gapsToAsk` 报"no gap card(s) to act on"——红态诚实、非模板。
- **实现**：新文件 `src/lite2/gapDerive.ts`——纯函数 `deriveGaps(team) -> GapCard[]`，只读 `LiteProject` 字段：启发式 = 项目 `status` 读稳（on-track/steady 家族）**且**有 `blockers` → 一张卡；`claim` 引 `project.summary` 原文（文件里的说法）、`evidence` 引 blocker 原文行（实际信号），二者均可溯源零捏造；卡 id 派生自 `project.id + blocker index`（稳定）；已自述 at-risk/blocked 的项目不算矛盾（blocker 与自述一致）。`flowStore.ts` 扩展：`gapMarks: Record<string,'resolved'|'dismissed'>` + `resolveGap/dismissGap/restoreGap` 三个 action + `selectGapsActive/Resolved/Dismissed` 三个纯函数选择器（同 triage marks 的分桶模式，不重复派生）；持久化并入既有 `lite2:flow:v1` localStorage blob（`PersistedShape` 加 `gapMarks` 字段，向后兼容旧 blob 缺该字段的读取）。`CloserLookScreen.tsx` 整屏重写替换 feat-042 的 coming-soon 占位：对照卡（左"What the files say"档案说法 / 右"What the signals show"信号显示，语气温度用 sage/terracotta 左边条区分而非红绿评判色）+ 卡操作（Settled 厘清 / Let it go 先放一放 / Ask them directly 直接问本人 / Add to follow-ups 加入跟进，source=`closer-look`）+ 历史折叠区（默认折叠，已厘清/已搁置两种徽章区分状态，可 Bring it back 放回来）+ 空态（"Nothing worth a closer look right now" 语义，沿用备忘录腔）。"Ask them directly" 复用 feat-043 已验证的 `setComposerDraft`+`goScreen('room')` 机制（不自动提交，manager 审过再发问，同 authorship 原则），预填含项目引用 + claim/evidence 上下文、零人身评判语。CSS ~280 行，全部 `.lite2-shell` 前缀，卡片语法沿用 `.home-handoff` 家族（hairline 边框/圆角/柔阴影），零新造视觉语言。
- **命名纪律**：屏幕内部/CSS/组件命名用 "gap"（内部领域概念名，ADR-0015 只管 user-facing 标签不管内部 id）；user-facing 文案（EN+ZH）全程零出现 gap/差距/现实差距/Nexus 字样（gate 断言机器化验证，见下）。旧 4 个占位 key（`closerLookEyebrow/Title/Body/ComingSoon`）**整体退役**（不复用同名 key 承载新内容）——按 kickoff-dev.md 授权可以正当取代，且规避了"同 key 名换新义、旧 ZH 译文误留"的风险（feat-043 session-handoff 硬提醒的同类坑）。新增 16 个 `gap*` key，EN 手写定稿，ZH 走 `scripts/i18n-zh-lite2-delta.mjs`（防复发规则已由 feat-043 补上，本次真验证：老 key 自然从输出中消失、16 个新 key 全部当作真 delta 送 M3、零旧 key 误命中"已有译文优先保留"分支）。M3 译文人工核对一处需对齐既有锁定词：`gapRestoreLabel` M3 首译"重新打开"，手工改为「放回来」以匹配 `followupsRestore`/`triageRestoreLabel` 同一 EN 源"Bring it back"已锁定的译法（M3 逐 key 独立翻译不做跨 key 一致性校验，此类对齐仍需人工过一遍——非 delta 脚本 bug，是翻译工具的已知局限）。
- **C 组门相位真机跑通**（`?v=2&mode=live&transport=stub`，先触发 stub ingest）：
  - **先红（born red，实现前）**：`{"pass":false,"phases":{"gapsDerive":false,"gapsResolve":false,"gapsToAsk":false},"results":{"gapsDerive":{"bannedHits":[],"gapCards":0,"hasAddFollowup":false,"hasAsk":false,"hasClaimPane":false,"hasDismiss":false,"hasEvidencePane":false,"hasResolve":false,"nameDigitPairs":[],"pass":false},"gapsResolve":{"error":"no gap cards to act on","pass":false},"gapsToAsk":{"error":"no gap card to act on","pass":false}}}`
  - **后绿（实现后）**：`{"pass":true,"phases":{"gapsDerive":true,"gapsResolve":true,"gapsToAsk":true},"results":{"gapsDerive":{"bannedHits":[],"gapCards":1,"hasAddFollowup":true,"hasAsk":true,"hasClaimPane":true,"hasDismiss":true,"hasEvidencePane":true,"hasResolve":true,"nameDigitPairs":[],"pass":true},"gapsResolve":{"badgesDistinct":true,"dismissLeavesActive":true,"dismissPersisted":true,"dismissedBadgeText":"Let go","dismissedInHistory":true,"gapId":"gap_pr_portal_0","pass":true,"resolveLeavesActive":true,"resolvePersisted":true,"resolvedBadgeText":"Settled","resolvedInHistory":true},"gapsToAsk":{"composerValueSample":"Onboarding Portal RevampRebuilding the internal onboarding portal around the new checklist flow.The new checklist flow still needs sign-off from Ops — nobody ha","containsProjectRef":true,"pass":true,"projectTitle":"Onboarding Portal Revamp","switchedToRoom":true}}}`
  - `gapsDerive`：`bannedHits:[]`（whole-screen 扫 gap/Nexus/差距/现实差距 零命中）、`nameDigitPairs:[]`（复用 Ask 红线的 `_askValueRe` 对全团队花名册逐一扫描，人名与数字/yes/no 60 字符内零共现——本屏结构上也确实零渲染任何数字，红线双重兜底）。
  - `gapsResolve`：resolve→dismiss 两动作在**同一张**诚实卡上顺序复测（stub 语料只诚实产生 1 张矛盾卡，同 triageActions/followupsFlow 的"不为凑测试虚构额外卡"纪律），两个 mark 均确认写进 `lite2:flow:v1` 的 `gapMarks` 字段（`resolvePersisted:true`/`dismissPersisted:true`，in-page 直读 localStorage），且两个徽章文案不同（`badgesDistinct:true`：Settled vs Let go）。**额外补做真实整页 reload 验证**（非 `gapVerdict()` 聚合内的第 4 个相位，是驱动侧手工补的补充证据，同 `readSkinSnapshot`/`snapshotFollowups` 的模式）：resolve 一张卡 → `localStorage` 读出 `{gap_pr_portal_0:"resolved"}` → 真整页 reload → 重新注入门 → 同 key 读出仍是 `{gap_pr_portal_0:"resolved"}`，证明持久化走的是 flowStore.ts 那条已被 feat-043 `followupsPersist` reload 实证过的同一条 save/load 代码路径，不是新起的一套。
  - `gapsToAsk`：卡上"Ask them directly"→ 切到 The room 且 composer 预填值含项目标题引用（`containsProjectRef:true`），不自动提交。
- **零回归证据（同会话复跑）**：`v2Boots` pass:true（6-tab 顺序不变）；`skinTokens` pass:true（paper→aurora 计算值切换，且矛盾卡在 aurora 皮下也正常渲染 1 张——顺手抽查，非严格门相位）；`storyUntouched`（`?mode=story` 零 `.lite2-shell`）pass:true；`flowVerdict` B 组四相位复跑全 true（`triageRenders.triageCards` 从 1 变 2——诚实反映 stub 语料新增的 `pr_portal` blocker，`triageActions`/`followupsFlow`/`followupsPersist` 均定位到同一张 `pr_pilot` 卡，行为不变）；默认 URL `?mode=live&transport=stub` 上 v01 十相位 `verdict()` 全 true + `v1Untouched` pass:true；`askVerdict()` 六相位（K1-K6）全 true。`wallRed` 抽查 story→lite2 一个方向（临时注入违规 import→`npm run lint` exit 1→撤回→exit 0）——未逐一复跑全部 4 方向，因 `eslint.config.js` 本棒零改动（`git diff feat/043-v02-triage-followups -- eslint.config.js` 空输出确认）。
- **i18n 自查**：`git diff feat/043-v02-triage-followups -- src/shared/i18n/`——`en.ts` 仅删 4 个旧 closerLook* key + 增 16 个新 gap* key，零其他改动；`zh.ts` 同步仅此 20 个 key 的增删，其余既有 key 逐字节零漂移（已核对 diff 输出，无意外改动）。
- **收尾**：`init.sh` 全绿（lint 0 error / 4 条既有 noInlineConfig warning、typecheck 0 错、build 497 模块，feat-043 基线 496 +1〔仅 `gapDerive.ts`〕）。改动面：1 新增文件（`gapDerive.ts`）+ 6 修改文件（`stubTransport.ts`/`flowStore.ts`/`CloserLookScreen.tsx`/`lite2.css`/`en.ts`/`zh.ts`）+ 1 门文档（`live-frontend-gate.snippet.js`，新增 3 相位 + 聚合 + 3 处旧注释更新）。
- **偏离 kickoff 之处（已记录，非阻塞）**：① kickoff 只写"C 组 3 相位"，未单列"reload 后状态保持"为独立第 4 相位（不同于 B 组明确列了 `followupsPersist` 独立相位）——本棒解读为"3 个聚合 key 不变，但持久化证据仍要给够"，用 in-page localStorage 直读（`assertGapsResolve` 内置）+ 驱动侧手工补的真 reload 快照对比（不进 `gapVerdict()` 聚合）两条证据满足，未新增第 4 个聚合相位。若下一棒/对抗验证认为应该正式化为 `gapsPersist` 独立相位，改动成本低（`snapshotGaps()` 辅助函数已就位）。② stub 语料改动（给 `pr_portal` 加 blocker）超出"只加 gapDerive.ts + 屏 + 门"的字面描述，但属实现 gapsDerive 门相位的必要前提（无此信号 gate 无法脱离"0 卡"的红态）——已在门文档三处旧注释同步更新，避免文档与语料脱节。
- **遗留 / 给下一棒的提示**：`gapRestoreLabel` 的 M3 首译与既有锁定词不一致（已手工修正，见上）——如果 feat-045/046 继续加新 key，delta 脚本本身不做跨 key 译法一致性校验，仍需人工过一遍 zh.ts diff 抽查同义 EN 源是否译法一致。历史折叠区（`.lite-gap-history`）与 Follow-ups 的 History subtab、晨间分诊的"Taken care of today"抽屉三处视觉语言现在有三套相似但不完全相同的折叠展开语法——非阻塞，可留 feat-046 aurora 精修阶段视觉审计时一并考虑是否收敛。
- **交接**：分支 `feat/044-v02-closer-look` 干净（改动=`gapDerive.ts` 新文件 + `stubTransport.ts`/`flowStore.ts`/`CloserLookScreen.tsx`/`lite2.css`/`en.ts`/`zh.ts`/`live-frontend-gate.snippet.js` 修改 + `feature_list.json`/`progress.md`/`.issues/lite-live-v02-0713/session-handoff.md`），**未 merge、未 push**（依 kickoff 编排，等 main 对抗验证 CONFIRMED_SAFE 后推进 feat-045）。抽查点（机器门已过，留 Danny/main 复核口味）：厘清/先放一放/直接问本人 三个动作按钮的中文语域是否够"备忘录腔"、对照卡左右两栏的视觉对比是否够清楚区分"档案说法 vs 信号"、历史区三套相似折叠语法是否需要统一。
- **【i18n 打回复验 2026-07-14】**：对抗验证 gate/redline 两路 CONFIRMED_SAFE、i18n 路 ISSUES_FOUND，fix commit 追加于本分支——Blocker=gap* ZH 的「档案」违反全 app「文件」锁定词族+「读数」误译（gapCardClaimLabel→PRD 原文「文件里的说法」、gapPageTitle→「文件说的和实际读到的，对不上的地方」、gapPageBody 改文件词族+动词对齐按钮文案；自查一并把 gapCardEvidenceLabel 对齐 kickoff 规格原文「实际信号」）。非阻塞一并修：composer 预填吞换行（CloserLookScreen ask 预填 + feat-043 TeamScreen take-to-room 预填的同根 bug，`\n` 改 " — "，编排授权跨棒修）+ gapDerive.ts claim 兜底句改机械状态读出式（`Reported status: "on-track"`，兜底也 100% 可溯源）。复验全绿：tsc 绿、grep zh.ts 零「档案」（「读数」仅剩 footerText——feat-042 锁定域外值、043 打回时明令逐字节恢复，本棒不动，已上报编排定夺）、浏览器重驱 gapsDerive/gapsToAsk 两相位绿（预填 " — " 分隔可读）+ triageActions 复跑绿（B 组断言不受影响）、`?lang=zh` 运行时新四值真渲染且屏上零档案零读数、i18n diff 范围复核不变、init.sh 绿（0 error/4 既有 warning、497 模块）。

## Update — 2026-07-14 · feat-045（原 038）：v02 onboarding 向导 + 建议 chips + 通知铃铛 done（分支 `feat/045-v02-onboard-nudges`，严格 gate-first）

- **gate-first**：先在 `live-frontend-gate.snippet.js` 写 D 组 4 相位（`onboardWalkthrough` 辅助 + `assertOnboardPersist`/`onboardSkipNow` 辅助 + `assertOnboardSkip`/`assertChipsAsk`/`assertBellIsReal` + `nudgeVerdict()` 聚合），`?v=2&mode=live&transport=stub` 五页协议真跑红（commit c37ca11）：`{"pass":false,"phases":{"onboardPersist":false,"onboardSkip":false,"chipsAsk":false,"bellIsReal":false}}`——walkthrough `sawWizard:false`（10s 轮询零 `.lite-onboard`）、chips `chipCount:0`、bell `"no .lite-bell-toggle in DOM"`。首访态在 `lite2:*` localStorage，驱动侧页间携带 JSON（同 v2Verdict 惯例）。聚合命名沿 B/C 组先例独立成 `nudgeVerdict()`（kickoff 字面写"v2Verdict 加 D 组相位"，但 B/C 两棒已确立每组独立聚合惯例——偏离已记）。
- **实现**：4 个新文件 + 4 处接线。`onboardStore.ts`——向导生命周期（unseen→in-progress→skipped/done；× 关闭 = session-only pause，下次续进度）+ 团队信息本地配置（公司/部门/称呼，只存本机）+ 8 项 playbook 勾选默认 3（`PLAYBOOK_CATALOG` 稳定 id + i18n selector），localStorage `lite2:onboard:v1` 手写同步 load/save（同 flowStore 模式同理由）。`OnboardWizard.tsx`——覆盖层四步：①上传真调 `store.uploadFiles`（与 UploadPanel 同一条 ingest 路径，stub 即时就绪）②团队信息 ③勾选真写 store ④完成页问候+所选摘要；无假连接工具/假账号步（PRD F7 明令）。`notifyStore.ts`——通知只由 `useLite.subscribe` 真状态转移驱动：ingest（ingesting→ready）/run（running→complete）/快问收齐（ask.status→closed 按 id 去重）/新矛盾卡（team 变化后 `deriveGaps` 新 id，按 id 去重防 reload 重复通知），`lite2:notify:v1` 持久化，零硬编码通知（合伙人版 5 条假通知的反面）、组件层无造通知入口（结构性护栏）。`LiteBell.tsx`——铃铛+未读徽章+泛化 kind 文案（永不点名员工）+点击跳对应 tab+全部已读+诚实空态。RoomScreen 空态 4 chips（稳定 data-chip-id，点击即 askLive 真 SSE，不预设语料内容）；PlaybooksScreen 槽位区走完向导后按所选呈现（`data-playbook-id` + 标题+一句人话 + Coming 诚实标注；skipped/未选回落既有 3 条通用槽零变化）；LiteTopbar 挂铃铛（nav 之外，v2Boots 的 6-tab 计数不受污染）；Lite2App 挂向导+`initNotifications()`（模块级 guard 幂等）。CSS ~548 行全 `.lite2-shell` 前缀、只消费皮肤令牌（aurora 自动跟随，零 `[data-skin]` 分支，aurora 下铃铛 pop/chips DOM 抽查过）。
- **D 组门修绿（五页协议真跑）**：`{"pass":true,"phases":{"onboardPersist":true,"onboardSkip":true,"chipsAsk":true,"bellIsReal":true}}`。`onboardPersist`：真走完四步（真上传 ready、勾选集改为与默认不同的 4 项 [handoff-cover,stuck-project,tough-conversation,weekly-review]、完成页摘要精确匹配、问候含称呼）→ 真 reload → 向导不再出现 + Playbooks 槽位 `data-playbook-id` 集合与所选**精确相等**（非计数）+ 全带 Coming 标。`onboardSkip`：清态首访 → skip → reload → 2.5s 轮询确认永不再弹。`chipsAsk`：4 chips id 互异文案非空 → 点击 → SSE 帧渲染（复用 F2 动态断言形状）。`bellIsReal`：清态铃铛 0 条+空态标记（断"无占位假通知"）→ stub ingest → 事件类型**精确多重集** `[gap,ingest]`（stub 语料诚实含一处矛盾，gap 事件同拍触发——精确匹配包含它）→ composer 驱动 run 完成 → 恰 `[gap,ingest,run]` 不多不少 → 未读徽章显示 + Mark all read 清零实证。
- **驱动侧新坑（已写进门文档防下一棒）**：①Page-E 清键时序——chipsAsk 的 run 还在流时清 `lite2:*`，run 完成的通知 push 会把 `lite2:notify:v1` 写回去（首次修绿被此坑打红一轮，非实现缺陷；须在稳定页清键再 reload）。②本会话 vite 数次 full-reload 来源查明：`.claude/worktrees/**` 下**其他线**的 worktree（ask-stage-c/ask-docfix）文件变动触发 dev server 全页刷新——门跑一半被刷会丢 in-page results，按"驱动侧携带 JSON"惯例分块补跑即可，evidence 不受影响。
- **零回归证据（同会话复跑）**：v01 十相位 `verdict()` 全 true（默认 URL + stub；`playbooksEmpty` 仍是 3 条通用槽=v01 未受 lite2 Playbooks 改动影响的旁证）+ `v1Untouched`（零 `.lite2-shell`）；`askVerdict` 六相位全 true（K1-K4 与 K5-K6 因 vite 被别线刷新分两页跑，K5 需先切回 Your team——v01 `.composer-card` 只在 TeamScreen）；A 组 `v2Boots`（6 tab 顺序不变，铃铛在 nav 外）/`skinTokens`（paper→aurora 计算值切换）/`storyUntouched`（`?mode=story` 零 `.lite2-shell` 零铃铛零向导）全 true + `wallRed` 抽查 lite2→story 方向（注入 exit 1/撤回 exit 0；`eslint.config.js` 本棒零改动 diff 空确认）；B 组四相位全 true（triageRenders 2 卡/triageActions 同卡三动作/followupsFlow id 追踪+来源标签精确/followupsPersist 真 reload missing:[]）；C 组三相位全 true（gapsDerive 1 卡零禁词零人名数字共现/gapsResolve 双 mark 持久化+徽章互异/gapsToAsk 预填含项目引用）。`git diff feat/044-v02-closer-look -- src/lite/ src/story/ eval-harness/` 空输出，冻结未破。
- **i18n**：EN 62 新 key 手写定稿（onboard* 34 + playbook 目录 16+3 + chips 5 + bell/notif 9——备忘录腔，8 项 playbook 文案全部重写非搬运，零 SaaS 框架名堆砌）。ZH 走 `scripts/i18n-zh-lite2-delta.mjs`（幂等验证：恰好 62 delta 送 M3、84 沿用 zh.lite、57 既有 approved 保留零覆盖）。M3 词族漂移**13 处手工对齐**（delta 脚本不做跨 key 校验，feat-044 硬提醒兑现）：房间→议事室（tabRoom 锁定）、剧本→打法/操作手册（playbooksSlotIncident「固定打法」先例）、小提问→快问（ask.eyebrow 锁定）、团队视图→团队已就绪（upload.readyLabel 锁定）、待启用→即将（visionTagComing 锁定）、「几处」→「一处」（一卡一通知语义）。终查：zh.ts 全文零档案/差距/现实差距/指挥室/Nexus/房间/剧本/小提问/团队视图；「读数」仅剩 footerText（feat-042 锁定域外值，不动）。`?lang=zh` 运行时抽查：向导/铃铛通知真渲染 ZH，锁定词在屏。**i18n diff 自查**：`git diff feat/044-v02-closer-look -- src/shared/i18n/`——en.ts 纯新增、zh.ts 0 删除/恰 62 行新增，既有 key（含 footerText、gap*/triage*/followups* 全家族）逐字节零漂移。
- **收尾**：`init.sh` 全绿（lint 0 error / 5 warning：4 基线 + 1 条 OnboardWizard 的 noInlineConfig 无害注释，与 feat-043 RoomScreen 同款已知模式；tsc 0 错；build 501 模块，044 基线 497 +4 新文件）。改动面：4 新增（`onboardStore.ts`/`notifyStore.ts`/`OnboardWizard.tsx`/`LiteBell.tsx`）+ 7 修改（`Lite2App.tsx`/`LiteTopbar.tsx`/`RoomScreen.tsx`/`PlaybooksScreen.tsx`/`lite2.css`/`en.ts`/`zh.ts`）+ 1 门文档（D 组相位+五页协议+时序坑注记）。
- **偏离与备忘（非阻塞）**：①聚合命名 `nudgeVerdict()` 而非字面"v2Verdict 加相位"（B/C 惯例，见上）。②"称呼供问候语用"的消费点目前两处——向导完成页问候 + Playbooks 屏「为 {company} 设置」行；更广的问候位（如 Your team 头部）留 feat-046 视觉精修一并定。③词族抽查顺带发现**既有** key `playbooksSlotIncident`（zh.lite 与 zh.lite2 同值）用「会议室」指 The room，与锁定词「议事室」不一致——zh.lite 属冻结 v01 不可动，zh.lite2 该值是 verbatim 沿用且早经对抗验证，本棒零改动（域外纪律），上报编排定夺是否另案处理。
- **交接**：分支 `feat/045-v02-onboard-nudges` 干净，**未 merge、未 push**（依 kickoff 编排，等 main 对抗验证 CONFIRMED_SAFE 后推进 feat-046 aurora 精修）。抽查点（机器门已过，留人复核口味）：向导四步文案的中文语域、8 项 playbook 标题+说明的备忘录腔成色、铃铛通知四条文案读感、chips 四问的泛化度。
