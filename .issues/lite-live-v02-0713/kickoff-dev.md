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

### feat-037 A closer look 矛盾点页（branch `feat/037-v02-closer-look`）
PRD F4。派生器 `src/lite2/gapDerive.ts`（纯函数：LiteTeam → 矛盾卡[]，只用项目级字段，claim/evidence 均引真实文本行）+ 屏 + 解决/忽略/历史 + "直接问问本人"→ room 预填。
门（C 组）：`gapsDerive`（stub 语料至少 1 卡，卡上零"gap/差距/现实"字样、零人名+数值共现）· `gapsResolve`（解决/忽略入历史可展开）· `gapsToAsk`（问问本人 → room composer 预填含项目引用）。

### feat-038 onboarding 向导 + chips + 铃铛（branch `feat/038-v02-onboard-nudges`）
PRD F5+F7。向导覆盖层（首访触发、可跳过、localStorage 记进度与勾选；上传步真调 store.uploadFiles）；room 空态 4 chips；铃铛（事件源：ingest 完成/run 完成/ask 收齐/新矛盾卡——订阅 store 真事件，零硬编码通知）。
门（D 组）：`onboardPersist`（勾 playbooks → reload → Playbooks tab 槽位反映所选）· `onboardSkip`（跳过后不再骚扰）· `chipsAsk`（点 chip → composer 发问 → SSE 帧到）· `bellIsReal`（初始零通知；跑完一次 run 后恰好新增对应通知）。

### feat-039 aurora 皮精修（branch `feat/039-v02-aurora-skin`）
逐屏对照合伙人库截图精修令牌与少量 `[data-skin]` 分支；两皮各截 6 tab + 向导 + 浮层。
门（E 组）：`auroraApplied`（关键计算值断言：bg/卡玻璃/主按钮色随 skin 切换）· `paperUnchanged`（skin=paper 计算值与 feat-035 基线一致）。

## 每个子代理的收口纪律

init.sh 绿 + 本 feature 门相位先红后绿实证 + v01/story 零回归复跑 + feature_list evidence 更新 + progress.md 追加 + commit 到自己分支（不 merge、不 push）。对抗验证由 main 编排（红线 / 墙与门真伪 / i18n 三路，CONFIRMED_SAFE 才进下一个 feature）。全链完毕 main 出 review 包（截图 + 改动清单 + 抽查点）给 Danny。
