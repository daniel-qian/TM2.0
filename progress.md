# Session Progress Log

> 📢 **致下个 session：本仓库已 adopt harness 体系（2026-06-11）。**
> 启动路径见 `AGENTS.md` 的 Startup Workflow：读本文件 + `feature_list.json`，跑 `./init.sh` 确认绿，再开工。

## Current State

**Last Updated:** 2026-07-03 晚（投资人路演 landing 重构已合并 main，2588dc7）
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
**Active Feature:** 无 active 编码 feature。feat-014（Morning Desk 主页，GH #9）已完成并本地提交，**未 push**（copy 待审字 + push 触发部署，归 Danny 拍板）。
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
