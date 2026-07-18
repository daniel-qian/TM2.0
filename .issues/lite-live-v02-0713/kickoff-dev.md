# kickoff-dev · lite-live-v02

> 实现子代理必读顺序：AGENTS.md → 本目录 PRD.md + decisions.md → 本文件 → 认领 feature 相关的 ADR（0015/0017/0022/0023）。
> 编排形态沿 S5/S6 模式：main 只编排；每 feature 一个 AFK 实现子代理在主 checkout 承接分支跑 gate-first 全流程；完工后独立对抗验证（checker≠maker）clean 才推进下一个。

## 架构拍板（子代理不得复议，有异议记 progress.md Notes）

1. **v02 = `src/lite2/**` 全量并排壳**：从 `src/lite/**` 整树复制（引擎含在内），**lite ↔ lite2 零交叉 import**（墙规矩同 story/lite；ADR-0022 copy-then-wall 哲学）。v01 冻结：本波 `src/lite/**`、`src/story/**`、`eval-harness/**` 一行不改（唯一例外：`src/App.tsx` 合成根 + `src/shared/version.ts` 新增）。引擎统一是后话，不在本波。
2. **版本开关**：新增 `src/shared/version.ts`（读 `?v=`，缺省 `'1'`）；`App.tsx`：`mode==='live' && v==='2'` → `Lite2App`。默认 URL 行为与 v01 逐字节一致。
3. **CSS 作用域**：lite2 根类 `.lite2-shell`；所有 lite2 样式落 `src/lite2/styles/`，选择器一律 `.lite2-shell` 前缀（S4 的教训：shared 类名要靠壳级作用域隔离）。
4. **皮肤令牌层**：`src/lite2/skin.ts` 读 `?skin=paper|aurora`（缺省 paper），在壳根挂 `data-skin`；令牌文件 `styles/skin-paper.css`（= 现值照搬）与 `styles/skin-aurora.css`（合伙人库令牌，色表在 decisions.md/对照 artifact §5：bg #edf6ff、ink #10223d、blue #496ee8、purple #6b5bd6、玻璃 rgba(255,255,255,.82)、极光渐变底等）。组件样式只消费令牌；令牌覆盖不了的"语法差异"（徽章 vs 左边条）允许 `[data-skin="aurora"]` 分支，控制在少数。
5. **墙扩展**：eslint `no-restricted-imports` 加三条——lite2→story、story→lite2、lite↔lite2 全 error（口径中文，引 ADR-0022 + 本文件）。红灯实证（注入违规 import → lint exit 1）是 feat-035 验收的一部分。
6. **i18n**：lite2 文案 key 挂 `lite2.*` 命名空间进 shared dict（EN 手写定稿；ZH 用 `scripts/i18n-zh.mjs` 定向模式只翻新 key，锁定词映射见 PRD；既有 key byte-identical——S5/S6 已两次验证这条纪律）。
7. **门**：`scripts/gates/live-frontend-gate.snippet.js` 新增独立聚合 `v2Verdict`，相位 gate-first（实现前必红）。集成层用 `?transport=stub&v=2`（agent 当第一个用户，fixture 不得自考自答——断言断行为与红线，不背答案）。既有 verdict（v01 十相位 + askVerdict）必须同会话复跑全绿 = 零回归证据。

## Feature 切分（串行，依赖链）

### feat-035 v02 并排壳 + 皮肤基建（branch `feat/035-v02-shell`，从 main 3a9cf5c 起）
复制整树 → `.lite-shell`→`.lite2-shell` 类名迁移 → version.ts + App.tsx 合成 → eslint 墙三条（红灯实证）→ skin.ts + 两张令牌表（aurora 允许先粗调，feat-039 精修）→ 6-tab 骨架（Follow-ups / A closer look 两屏先空态占位，带诚实 Coming 语义）→ 合规页脚（F6，文案定稿）→ i18n 新 key。
门（v2Verdict 相位 A 组）：`v2Boots`（?v=2 六 tab 渲染 + `.lite2-shell` 存在）· `v1Untouched`（默认 URL `.lite2-shell`=0 且 v01 十相位复跑全绿）· `storyUntouched`（?mode=story 零 `.lite2-shell`）· `wallRed`（违规 import lint exit 1 实证后移除）· `skinTokens`（data-skin 切换后根令牌计算值变化）。
另：把 `.issues/lite-live-v02-0713/*` 与 feature_list 更新一并入首个 commit。

### feat-036 晨间分诊区 + Follow-ups（branch `feat/036-v02-triage-followups`）
PRD F2+F3。新 store 文件 `src/lite2/flowStore.ts`（zustand，独立于 store.ts 减冲突面）：triage 派生（handoffs/blockers → 今日条目，done/discard/送议事室三动作）+ followups slice（分组/来源标签/完成/编辑/历史/localStorage 持久化）+ mailto 起草 util。TeamScreen 顶部挂分诊区；Follow-ups 屏成型；advice 卡建议动作加"加入跟进"（真写 store）。
门（B 组）：`triageRenders`（stub 语料 → 至少 1 条派生条目 + 零人身数字）· `triageActions`（done 进"今天已照料"堆 + discard 淡出 + 送议事室预填 composer）· `followupsFlow`（分诊卡加入 → Follow-ups 出现带来源标签 → 勾完成进历史 → 恢复）· `followupsPersist`（reload 后仍在）。

### feat-044（原037）A closer look 矛盾点页（branch `feat/044-v02-closer-look`）
PRD F4。派生器 `src/lite2/gapDerive.ts`（纯函数：LiteTeam → 矛盾卡[]，只用项目级字段，claim/evidence 均引真实文本行）+ 屏 + 解决/忽略/历史 + "直接问问本人"→ room 预填。
门（C 组）：`gapsDerive`（stub 语料至少 1 卡，卡上零"gap/差距/现实"字样、零人名+数值共现）· `gapsResolve`（解决/忽略入历史可展开）· `gapsToAsk`（问问本人 → room composer 预填含项目引用）。

### feat-045（原038）onboarding 向导 + chips + 铃铛（branch `feat/045-v02-onboard-nudges`）
PRD F5+F7。向导覆盖层（首访触发、可跳过、localStorage 记进度与勾选；上传步真调 store.uploadFiles）；room 空态 4 chips；铃铛（事件源：ingest 完成/run 完成/ask 收齐/新矛盾卡——订阅 store 真事件，零硬编码通知）。
门（D 组）：`onboardPersist`（勾 playbooks → reload → Playbooks tab 槽位反映所选）· `onboardSkip`（跳过后不再骚扰）· `chipsAsk`（点 chip → composer 发问 → SSE 帧到）· `bellIsReal`（初始零通知；跑完一次 run 后恰好新增对应通知）。

### feat-046（原039）aurora 皮精修（branch `feat/046-v02-aurora-skin`）
逐屏对照合伙人库截图精修令牌与少量 `[data-skin]` 分支；两皮各截 6 tab + 向导 + 浮层。
门（E 组）：`auroraApplied`（关键计算值断言：bg/卡玻璃/主按钮色随 skin 切换）· `paperUnchanged`（skin=paper 计算值与 feat-035 基线一致）。

## 每个子代理的收口纪律

init.sh 绿 + 本 feature 门相位先红后绿实证 + v01/story 零回归复跑 + feature_list evidence 更新 + progress.md 追加 + commit 到自己分支（不 merge、不 push）。对抗验证由 main 编排（红线 / 墙与门真伪 / i18n 三路，CONFIRMED_SAFE 才进下一个 feature）。全链完毕 main 出 review 包（截图 + 改动清单 + 抽查点）给 Danny。

## 合流契约附录（2026-07-14，来自 lite-v1 持久化线广播，已核实：feat/041-e2e-broadcast tip=9e5a725）

1. **编号撞车与处置**：持久化线占用 feat-030→041 号段（branch 实证：feat/038-tenant-isolation、039-upload-hardgate、040-deploy-prep、041-e2e-broadcast）。本线在 feature_list.json 登记的 feat-035..039 与之冲突。**处置（✅ 已执行 2026-07-14）：本线五个 feature 整体改号 feat-042..046**（042=壳、043=分诊+跟进、044=矛盾页、045=onboarding+nudges、046=aurora 皮），本地分支已改名（feat/042-v02-shell、feat/043-v02-triage-followups），feature_list/kickoff 已更新，feat-047（引擎同步）已登记；已 commit 的历史 message 不重写，改号映射留此为凭。
2. **阶段 D 新增一棒「v02 引擎同步 + 笔记/文件面」（拟 feat-047）**：lite2 引擎拷贝自 main@3a9cf5c，不含持久化线 src/lite 改动（transport.ts owner_token/X-Avery-Token、store.ts files/notes、NotesScreen、UploadPanel 文件清单、RoomScreen note nudge）。待持久化线合 main 后，把引擎 delta 移植进 lite2 并给 v02 补笔记/文件用户面（tab 安排属 UX，进 review 包给 Danny 拍）。**token 纪律不可违反：token 只走 header（X-Avery-Token / Bearer），绝不进 URL；/ingest 的 owner_token 只返一次必须存住；缺 token 读路径 404 是设计不是 bug。** 经理 owner_token 与快问 /r/{token} 员工分享 token 是两套，永不混用。
3. **红线开关佐证**：持久化线确认后端 AVERY_ALLOW_PERSON_SCORING 开时笔记文本可能含评分——v02 本期不给人卡设计任何分数 UI 与 PRD 一致；笔记面移植时（feat-047）笔记正文按后端原样呈现即可，不做前端二次加工。
4. **所有权**：`.issues/lite-v1-lean-real-0713/**` 归持久化线，本线不动。数据处理说明草稿（data-handling-copy-draft.md）若 v02 做隐私露出可采用（feat-047 时评估）。
5. **合流顺序 Danny 定**；本线优势：v02 完全不碰 src/lite/**，对三方合流是中立方，随时可合。

## 合流契约附录 §6 · 并新 main 计划（2026-07-14，回执 main 编排广播）

已核实：main=5d32e4f（含持久化链 integrate 6bf6b0e + Ask 阶段 C merge da94d59），分叉点 3a9cf5c，冲突面=5 个共享文件（feature_list.json、gate md+snippet、i18n en/zh），全并集型。

**决定：merge，不 rebase**——本线 feature_list evidence 与对抗验证记录全部按 commit hash 引用（bf1fce0/2824620/23b6f28/c37ca11…），rebase 改写 hash 会作废证据链。

**时机与顺序**：feat-045 对抗验证收口后立即执行：
1. 从 feat/045 tip 开 `integrate/v02-main-sync`，merge main 5d32e4f；解 5 文件并集（i18n 双方各自 key、feature_list 条目并集且 feat-034 取 main 新版、gate 相位并集）；
2. 合后全量复跑：init.sh + v01 verdict + askVerdict（注意 main 侧 Ask 已从 stub 变真后端相位，以 main 的门定义为准）+ v2Verdict A/B/C/D 组；
3. feat-046（aurora 皮）从同步后基线起跑；
4. **feat-047 因持久化已进 main 而解除阻塞**，排在 046 后（引擎 delta 移植进 lite2 + 笔记/文件面 + owner_token header 纪律）。
lite2 与 src/lite 零交叉 import（墙已实证），合流期间 lite2 引擎仍是旧契约拷贝、独立可编译，不构成恶性冲突；契约对齐在 feat-047 做。

## 编排教训 §7（2026-07-15，feat-047 验证轮）

1. **并行验证必须隔离工作树**：feat-047 的三路对抗验证并行跑在同一个主 checkout 上，其中 token 路做变异测试（真往 src/lite2 注入违规再回滚），scope 路读到了那些变异 + harness 的"改动是刻意的/别告诉用户"标准提示，合理地判成了社工攻击并上报 blocker。**两个验证者的行为都正确**（不听"别说"、坚持回滚、如实上报）；错在编排没给会写文件的验证者 `isolation: 'worktree'`。今后：任何做变异测试/需要改文件的验证路一律独立 worktree，只读路才可共享主树。
2. **变异测试是补"出生即红"缺口的等价物且更强**：feat-047 的门是边写实现边写的（无先红快照），但四发变异（token 进 URL / 去 header / 复用 v01 key / 404 伪造数据）全部真红，加上验证者用 worktree 回到 gate-only commit 独立重建红态——证据强于原始的先红快照。以后遇到"门先行"没做到的情况，变异测试是可接受的补救。
3. **拷贝壳的契约漂移是系统性风险**：lite2 分叉于 Ask 阶段 C 之前，coerceAskDraft 带旧词表（把 revoked/expired 折回 draft，违反 ADR-0023 明文的反回归规则），且 saveAsk/shareAsk/fetchAsk 零 auth header。copy-then-wall 的代价就在这里——**引擎统一（lite/lite2 收敛回一份）应列入 v02 之后的第一优先技术债**，否则每次 v01 侧改契约，lite2 都要人肉追一次，且只有对抗验证才抓得到。
