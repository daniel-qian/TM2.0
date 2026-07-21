# 棒4 组件族 · 实施作战地图（只读侦察，2026-07-21 棒3 期间预制）

侦察方式：Explore agent 全仓清点（与棒3 电池并行）。四节全部带 文件:行号。
用途：棒4 开工直接照此打，不用重侦察。

## 第 1 节 · 按钮全量清点（TSX `<button>` 逐个 + 归类建议）

约定：[普通]=候选挂 `.lite-btn` 变体；[白名单]=非普通按钮（tab/齿轮/开关/背景/卡片/计数格/门/文字链/勾选/chip/列表项），进门放行不套基类。

**DraftComposer.tsx**：L139 `lite-draft-close`[ghost]、L209 `lite-draft-copy`[soft/primary]、L233 `lite-draft-done`[primary]、L244 `lite-draft-goqueue`[ghost]
**DetailOverlay.tsx**：L83 `lite-detail-close`[ghost]
**AskCard.tsx**：L152 `ask-q-remove`[danger/ghost]、L164/L173 `ask-q-add`[soft]、L199 `ask-recipient-chip`[白]、L214 `ask-confirm`[primary]、L234 `ask-copy-btn`[ghost]、L245 `ask-refresh`[ghost]
**LiteAdviceCard.tsx**：L136 `lite-advice-add-followup`[soft]←focus-missing 命中
**LiteBell.tsx**：L52 `lite-bell-toggle`[白 图标开关]、L84 `lite-bell-markall`[ghost]、L95 `lite-notif-item`[白 列表项]
**LiteComposer.tsx**：L117 `icon-button`[白]、L124 `composer-add-button`[白]、L141 无类名×[白]、L158 filter tab[白]、L182 reference 行[白]
**LiteModal.tsx**：L270 `lite-modal-backdrop`[白 背景]
**LiteTopbar.tsx**：L85 `scene-tab`[白]、L118 `lite-settings-toggle`[白 齿轮]、L141/149 `lang-switch-btn`[白]、L162/170 `look-switch-btn`[白]、L187/196 `mode-switch-btn`[白]
**LitePanZoom.tsx**：L40 `lite-room-canvas-reset`[ghost]←focus-missing 命中
**UploadPanel.tsx**：L194 `upload-choose`[primary]、L260 `upload-retry`[ghost]
**OnboardGate.tsx**：L159 `lite-gate-browse`[ghost]、L185 `lite-onboard-skip`[ghost]、L195 `lite-onboard-back`[ghost]、L200 `lite-onboard-next`[primary]、L204 `lite-onboard-finish`[primary]、L250/264 `lite-gate-door*`[白 门卡]、L338 `lite-onboard-upload-choose`[primary]、L490 `lite-onboard-playbook`[白 切换卡]
**auth/AuthPanel.tsx**：L350 `lite-auth-toggle`[白]、L377 `lite-auth-submit`[primary]、L402/414 `lite-auth-secondary`[ghost]、L451 `lite-auth-submit`[primary]、L455 `lite-auth-switch`[ghost/link]
**HomeScreen.tsx**：L113 `lite-empty-restore-retry`[ghost]、L155 `lite-home-demo-btn`[primary]、L215/300/342/385 `lite-home-block-link`[白 区块头链接]←small-target 命中、L314 `lite-home-todo-check`[白 勾选]、L361 `lite-home-gap-title`[白 文字链]、L422-438 `lite-home-count-cell`×5[白 计数格]、L533 `lite-home-decision-toggle`、L542 `-open`、L547 `-room`（枚举三选择器族）、L551 `-followup`[soft]、L607 `lite-home-attention-name`[白 文字链]
**FollowupsScreen.tsx**：L135 `lite-followup-save`[primary]、L138 `-cancel`[ghost]、L146 `-check`[白 勾选]、L171 `-mail`[ghost]、L179 `-edit-btn`[ghost，已有样式 L2349]、L188 `-restore`[ghost]、L196 `-delete`[danger]、L220/229 `lite-followups-subtab`[白 子tab]←focus-missing、L264 `-add-submit`[primary]←focus-missing
**TeamScreen.tsx**：L82 `home-person-card`[白 人卡]、L116 `home-people-group-head`[白 分组头]、L248 `home-check`[白]、L273 `home-map-card-link`[白]、L280 `lite-triage-room`[ghost]、L287 `-addfollowup`[soft]、L299 `-draftmail`[ghost]、L306 `home-discard`[ghost/danger]、L330 `home-drawer-toggle`[白]、L345/353 无类名 restore[ghost]、L380 `lite-empty-restore-retry`[ghost]、L428 `home-project-card`[白]
**CloserLookScreen.tsx**：L94 `lite-gap-project-link`[白]、L107 `lite-gap-resolve`[primary]、L110 `-dismiss`[ghost]、L113 `-ask`[ghost]、L116 `-addfollowup`[soft]、L145 `-history-toggle`[白]、L167/183 `-restore`[ghost]
**RoomScreen.tsx**：L133 `lite-flow-toggle`[白]、L171 `lite-flow-cites-toggle`[白]←small-target、L249 无类名 submit[primary]、L319 `lite-notes-nudge`[ghost]、L355 `lite-room-nomaterial-cta`[primary]、L381 `lite-room-chip`[白]
**NotesScreen.tsx**：L74 `lite-notes-entry-source`[白 来源链]←small-target、L98 `home-people-group-head lite-notes-group-head`[白]←focus-missing、L175 `upload-choose lite-notes-empty-cta`[primary]
**ProjectsScreen.tsx**：L110 `lite-project-card`[白 卡]←focus-missing、L281 无类名 restore[ghost]、L290 `lite-projects-empty-cta`[primary]
**PlaybooksScreen.tsx**：L86 `lite-playbooks-reopen-onboarding`[ghost]←small-target
**VisionScreen.tsx**：无 button。

无类名按钮四处（LiteComposer L141、TeamScreen L345/353、RoomScreen L249、ProjectsScreen L281）——双类迁移时正好补类名。

## 第 2 节 · 枚举按钮基样式原文（.lite-btn 基类雏形）

lite2.css **L3809-3820**：`.lite2-shell .lite-home-decision-toggle/-open/-room { padding:4px 10px; border:1px solid var(--rule); border-radius:999px; background:transparent; color:var(--ink-soft); font:inherit; font-size:11.5px; cursor:pointer }`；hover/focus **L3822-3830**（border-color:--rule-strong + color:--ink）。
`lite-home-decision-followup`（同族第 4 个）不在枚举里，样式在 L5358/L5369（棒1 补），L5062 :disabled——棒4 收编。
其它按钮类规则行号：L822/828/834/847（flow-toggle）、L943/954（cites-toggle）、L1930/1944（gap-history-toggle）、L2349/2368（followup-edit）、L2832/2846（bell-toggle）、L3173/3188（gap-history 重复定义）、L4094/4110（auth-toggle）、L5081/5095（settings-toggle）、L5295/5308（demo-btn）。

## 第 3 节 · triage 44 件 open 分布

**focus-missing×16（8 族，全 desktop，两皮各一）**：team `input`、`lite-project-card`、`lite-room-canvas-reset`、`lite-advice-add-followup`、room `input`、`lite-followups-subtab`、`lite-followup-add-submit`、`home-people-group-head.lite-notes-group-head`。
**small-target×28（5 族，三视口两皮）**：team `input`(×4)、`lite-playbooks-reopen-onboarding`(×6)、`lite-home-block-link`(×6)、`lite-flow-cites-toggle`(×6)、`lite-notes-entry-source`(×6)。
要点：`.lite-btn`+统一 :focus-visible 能一次盖掉 button 族的 focus-missing；small-target 全是文字链/展开开关型，治法=min-height/padding 或 ::before 扩热区，不套变体色；两个原生 `input`（team/room）两病兼有，单独治（focus ring + min-height）。

## 第 4 节 · token 可用面 / 卡片动效现状

**paper 侧没有** `--lite2-tone-*-bg/fg`（aurora 独有，look-aurora L96-111）、没有 `--lite2-surface-soft`、没有 `--lite2-glass-blur/-border`。
**两皮都有（共享基类可裸消费）**：`--lite2-surface/glass/surface-rgb/ink-rgb/paper-rgb/accent-rgb/accent-deep-rgb/danger-rgb/danger-deep-rgb/warn-rgb/warn-deep-rgb/violet-rgb/violet-deep/sky-rgb/ink-hover/heading-font` + `--ink/-soft/-faint/--rule/-strong/--shadow/-soft/--radius`。
→ `.lite-btn` 四变体锁 RGB 三元组（如 `rgba(var(--lite2-violet-rgb), .12)` 做 soft 底）；tone 色/surface-soft 一律走 `[data-look='aurora']` 分支。

**决策卡** `.lite-home-decision` L3690-3696：`rgba(var(--lite2-surface-rgb), 0.55)` 底 + var(--rule) 边 + var(--radius) + 无阴影；左竖条 ::before L3698-3707（3px，tone 变体 L3709/3713/3717）。spec stick-4 card.decisionBg 要 .97 → 上 card-base。
**对照**：`.lite-project-card` L4575-4590（0.82 底+shadow-soft+translateY(-1px) hover——已是上浮卡）；`.lite-gate-door` L5206-5220（14px 硬编码圆角、0.15s 硬编码、hover 上浮）。
**@keyframes 仅 2 个**（L3483/3495，feat068 ingest 系）——卡片入场 keyframe 需新建（lite2-rise）。
**reduced-motion clamp** L4058-4073 只管 ingest 两组动画；⚠️ project-card/gate-door 的 transform 上浮**未被兜底**——棒4 新增动效要一并纳入 reduce 关停，顺手把 gate-door 0.15s 归一 var(--fast)。
⚠️ L4075-4085 注释记着该 @media 曾未闭合闷掉整片样式（bba9f1c 修复）——在此块内新增规则务必 `{}` 配平。
