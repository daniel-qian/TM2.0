> 侦察原件 · 视角 `our-screens` · 2026-07-22 自动生成，未经人工编辑。

# 我方九屏骨架审计（只读侦察 · D:/avery/src/lite2）

## 0. 壳结构 — `D:\avery\src\lite2\Lite2App.tsx`

```
<div class="app-shell lite2-shell" data-scene={screen} data-mode="live" data-look={look}>   Lite2App.tsx:100
  <LiteTopbar />                                    Lite2App.tsx:101   → position:fixed  (shared/styles/00-base.css:65)
  <main class="scene-stage">                        Lite2App.tsx:102   → position:absolute; inset:0 (00-base.css:152)
     <Routes> … 每条屏路由 element 都是同一个 <ScreenView/>  Lite2App.tsx:111-144
       ScreenView 按 useCurrentScreen() 从 SCREEN_COMPONENT 表挑组件  Lite2App.tsx:171-191
  <DetailOverlay />   Lite2App.tsx:148   ─┐
  <OnboardGate />     Lite2App.tsx:152    ├ 常驻挂载弹层族（不条件挂载，出场动画需要）
  <DraftComposer />   Lite2App.tsx:155   ─┘
  <Lite2Footer />     Lite2App.tsx:156   → position:absolute; left/right/bottom:0; z:30; pointer-events:none (lite2.css:2437-2449)
```

- 层级/定位关键点：`.app-shell` = 100vw/100vh + `overflow:hidden`（00-base.css:53-59）；`.scene`（每屏根）= `position:absolute; inset:0; overflow:hidden`（00-base.css:152-158）→ **屏本身不滚，滚动全在屏内的 `*-scroll` 容器**。所以任何布局都必须走「内滚容器 + frame」这套，不能靠 body 滚。
- ≤860px：`.prototype-topbar` 转 `position:sticky` 竖排（00-base.css:1121-1131），`.scene-stage/.scene` 转 `position:relative; min-height:1500px`（00-base.css:1137-1141），`.scene` 用 `display:none / block` 切屏。
- 路由表：`SCREEN_PATH`（routes.ts:41-54）= `/home /team /projects /room /followups /notes /closer-look /playbooks /vision`；`DEFAULT_SCREEN='home'`（routes.ts:67）；深链 `/team/:personId`、`/projects/:projectId`。
- 全局让位变量：`.lite2-shell { --lite2-clear-top:96px; --lite2-frame-w:min(1480px, calc(100vw - 48px)) }`（lite2.css:5386-5389）；≤860 → 72px（5391-5395）。九消费者 padding-top 统一在 lite2.css:5401-5409。

## 1. 顶栏 — `D:\avery\src\lite2\LiteTopbar.tsx`

DOM 序（`<header class="prototype-topbar">` LiteTopbar.tsx:82）：

| 位置 | 元素 | 行 | 备注 |
|---|---|---|---|
| 1 | `<nav class="scene-tabs">` 9 个 `.scene-tab` | :83-105 | 有 sub 的 tab 内是 `.scene-tab-main` + `.scene-tab-sub`（:95-98） |
| 2 | `<LiteBell/>` `.lite-bell` | :107 | notifyStore 真事件 |
| 3 | `<AuthPanel/>` `.lite-auth` | :110 | Supabase 未配置时整块不渲染 |
| 4 | `.lite-settings`（⚙ → 弹层内含 `.lang-switch` + `.look-switch`） | :117-182 | 0721·7B 收纳 |
| 5 | `.mode-switch`（Story/Live） | :185-206 | 默认不渲染，只在 `?modeSwitch=1` |

**没有搜索框。**全 lite2 唯一的 `type="search"` 在 `LiteComposer.tsx:171`（团队屏 composer 的 @引用筛选，`t.lite2.refSearch`），不是全局搜索。

搜索框可插入的位置与约束：
- DOM 插槽 = `LiteTopbar.tsx:105`（`</nav>` 之后）与 `:107`（`<LiteBell/>`）之间。**绝不能放进 `.scene-tabs` 内** —— 门 `assertV2Boots` 按 `$$('.lite2-shell .scene-tabs .scene-tab')` 数 9 个并逐字比对 label 数组（`scripts/gates/live-frontend-gate.snippet.js:1337-1341`），混进任何非 tab 子元素即红。
- 容器 `.prototype-topbar` 是 `pointer-events:none`（00-base.css:65-75），新子块必须自己 `pointer-events:auto` 回来 —— 既有先例 `.lite-bell`（lite2.css:2827）、`.lite-auth`（:4089）、`.lite-settings`（:5079）。
- 布局：≥861 时 `.prototype-topbar` 被改为 `width:var(--lite2-frame-w)`（=1480 外夹）、`justify-content:flex-start; gap:12px`（lite2.css:5432-5443），且 `.scene-tabs{margin-right:auto}`（:5446-5448）把铃/登录/齿轮推右。所以插在 nav 之后的搜索框会贴在**右簇最左**；要做居中搜索需在 `.scene-tabs` 与新块之间再放 auto margin。
- `.scene-tabs` 自身是横向滚动容器（`overflow-x:auto`, lite2.css:4830-4840），tab `flex:0 0 auto; white-space:nowrap`（:4843-4846）——窄屏 tab 条已经在滑，搜索框挤进同一行会更糟。

## 2. 逐屏

### home（指挥室）— `screens\HomeScreen.tsx`，`.scene.is-active.lite-home`

**有数据态**（:196-451）：单栏纵向 flex。
```
.lite-home (scene)
└ .lite-home-scroll        lite2.css:3516  absolute inset:0 overflow-y:auto
  └ .lite-home-frame       lite2.css:3523  max-width:860px; margin:0 auto; padding:84px 36px 90px; flex column; gap:18px
                                            padding-top 被 :5408 覆盖为 96px；@720 → padding:72px 20px 80px (:3942)
    ├ header.lite-home-header            :200
    ├ section.lite-home-block.lite-home-decisions   :207   ① 今天要决策的
    ├ section.lite-home-block.lite-home-todos       :294   ①½ 今日待办（B4）
    ├ div.lite-home-row  (grid 1fr 1fr, gap18)      :332 / CSS :3926-3930，@720 单列 :3937
    │   ├ .lite-home-block.lite-home-gaps      :334  ② 差距摘要
    │   └ .lite-home-block.lite-home-attention :376  ③ 需关注的人
    └ section.lite-home-block.lite-home-overview    :415  ④ 计数（.lite-home-counts = grid auto-fit minmax(104px,1fr)，CSS :4018）
```
**空态**（team===null，:96-194）：`.lite-home-frame.lite-home-frame-empty`（max-width 640px @:3534，被 append-only 覆盖成 **1040px** @:5072-5074）→ `.lite-home-skeleton-row` = `grid 1.4fr 1fr`（CSS :4978-4983，@880 单列 + 上传卡 `order:-1` :4985-4992）：左 `.lite-home-skeleton-blocks` 四个 `.lite-home-block.lite-home-skeleton`（与有数据态同名同序，只有文案无数字），右 `aside.lite-home-upload-side` = 可选 `.lite-home-demo`（能力探测 `demoAvailability==='yes'` 才出，:153）+ `<UploadPanel/>` + `.lite-empty-hints` + 可选 `.lite-home-guest-note`（`authStatus==='guest'`，:183）。

部件 → 数据源：
| 部件 | 来源 |
|---|---|
| 决策卡列表/分级 chip | `useLite.rawTeam?.decisions`（:67）→ `summarizeDecisions()` homeDerive.ts；顺序/等级/reason 全归后端，前端不排序 |
| 今日待办 | `useFlow.followups` filter `!done && dueGroup==='today'`（:74），只列前 5（:312） |
| 差距摘要 | `selectGapsActive(team, useFlow.gapMarks)`（:69），只列前 3（:359） |
| 需关注的人 | `deriveAttentionPeople(team, rawTeam)`（:70），只列前 4（:402）；仅 signalCount/blockerCount + 原文 evidence，零评分 |
| 概览五格 | `team.people.length` / `team.projects.length` / `files.length` / `notes.length` / `openFollowups`（:422-445） |

空/错态：`decisions===undefined` → `.lite-home-empty[data-empty-kind="absent"]`（:227）；`length===0` → `[data-empty-kind="none"]`（:232）——两种「空」措辞不许混。gaps/attention/todos 空 → `.lite-home-quiet`（:309/:351/:398）。会话恢复：`.lite-empty-restoring`（:106）/ `.lite-empty-restore-failed` + `.lite-empty-restore-retry`（:110-120）。

CSS 作用域类名：`.lite-home` `.lite-home-scroll` `.lite-home-frame(-empty)` `.lite-home-header` `.lite-home-lede` `.lite-home-block` `.lite-home-block-head` `.lite-home-block-link`(:3596, 重复定义 :4885, 热区 :5571) `.lite-home-count` `.lite-home-row` `.lite-home-decisions/-decision/-decision-*` `.lite-home-grade-chip` `.lite-home-rule-*` `.lite-home-evidence-label` `.lite-home-todos/-todo-list/-todo-item/-todo-check/-todo-title/-todo-more`(:5021-5061) `.lite-home-gaps/-gap-list/-gap-item/-gap-title/-gap-evidence` `.lite-home-attention/-attention-list/-attention-item/-attention-name/-attention-role/-attention-why/-attention-evidence` `.lite-home-overview/-counts/-count-cell` `.lite-home-skeleton-row/-skeleton-blocks/-skeleton/-skeleton-note` `.lite-home-upload-side` `.lite-home-demo/-demo-btn/-demo-note/-demo-error`(:5288-5325) `.lite-home-guest-note` `.home-tone-{terracotta|honey|sage}`。

### team（你的团队）— `screens\TeamScreen.tsx`，`.scene.scene-home.is-active`

唯一走 **shared** 布局的屏（`.home-scroll` / `.home-frame` 来自 `src\shared\styles\70-home-cards.css`）：
```
.scene.scene-home                       TeamScreen.tsx:210
└ .home-scroll        70-home-cards.css:6   absolute inset:0
  └ .home-frame       70-home-cards.css:13  grid-template-columns: minmax(340px,38fr) 62fr; gap:34px;
                                            max-width:1460px; padding:84px 36px 150px
                                            → @1080 单列 padding:84px 22px 160px (70-home-cards.css:607-612)
                                            → padding-top 被 lite2.css:5401/5408 覆盖为 96px（.lite2-shell 前缀）
    ├ .home-spine（左）   TeamScreen.tsx:214
    │   ├ header.home-greeting + h1 + .home-greeting-sub + .lite-metrics/.lite-metric-chip
    │   ├ .home-spine-head（标题 + .home-count）
    │   ├ ol.home-handoff-list > li.home-handoff.home-tone-*（.home-check / .home-handoff-body /
    │   │     .lite-badge.home-handoff-tone / .home-handoff-links 里 5 个按钮）  :242-318
    │   └ section.home-drawer（今天已照料，折叠）  :330-361
    └ .home-lanes（右）   TeamScreen.tsx:402
        ├ <UploadPanel/>
        ├ .home-lanes-head
        ├ .home-people-groups > .home-people-group（可折叠）> .home-lane.home-lane-people
        │     grid auto-fill minmax(200px,1fr)  70-home-cards.css:381-383
        └ .home-lane.home-lane-projects  grid auto-fill minmax(280px,1fr)  :385-387
外挂：<LiteComposer/>  TeamScreen.tsx:474 → .composer-layer（00-base.css:671-678：absolute; bottom:24px; width:min(720px,100vw-48px); translateX(-50%)）
```
数据源：`useLite.team`（people/projects/handoffs/briefing）；分诊三态 `selectTriagePending/Handled/SetAside(team, useFlow.triageMarks)`（:168-179）；briefing 经 `localizeBriefing`（:185）。项目卡 tone 判据吃 `project.statusRaw` 不吃 `project.status`（:48-63 的注释即根因）。
空态：`team && briefing` 为假 → 左脊柱换成 `header.home-greeting.lite-empty-greeting` + `.lite-empty-hints`（:366-396），右栏 `.home-lanes.home-lanes-live-empty` 只有 UploadPanel（:467）。restoring/restoreError 同 home 口径（:374-388）。
🔴 人卡 `.home-person-card` 结构上零数字（:70-99，注释 :96）。

### projects（项目）— `screens\ProjectsScreen.tsx`，`.scene.scene-nexus.is-active.lite-projects`

```
.lite-projects
└ .lite-projects-scroll   lite2.css:4349  absolute inset:0
  └ .lite-projects-frame  lite2.css:4356  max-width:980px; margin:0 auto; padding:84px 36px 90px（top→96px @5408）
    ├ header.lite-projects-header（eyebrow/h1/.lite-projects-lede/.lite-projects-count）  :208-219
    ├ section.lite-projects-coverage（有缺口才渲染）  :223-239
    ├ p.lite-projects-single-note（views.length===1）  :243
    └ section.lite-projects-group[data-project-group]  × 非空分组  :249-268
        └ .lite-projects-grid  grid auto-fill minmax(288px,1fr) gap12  lite2.css:4563-4567
            └ button.lite-project-card[data-project-id]  lite2.css:4570（border-left:3px 状态左缘）
```
数据源：`useLite.rawTeam`（**不是 team**，:186）→ `buildProjectViews(rawTeam.projects, rawTeam.people)` / `groupProjects` / `projectCoverage`（projectView.ts）。
空/未知态：0 项目 → `.lite-projects-empty`（:272）内三分支 restoring / restore-failed / 空态 h2+p+`.lite-projects-empty-cta`（跳 team）。字段未知 → `FactRow` 挂 `.is-unknown`（:96）；**progress 未知不画 0 宽条，只出「文档未提及」行**（:156-164）。
类名：`.lite-projects` `.lite-projects-scroll/-frame/-header/-lede/-count` `.lite-projects-coverage/-coverage-title/-coverage-list/-coverage-note` `.lite-projects-single-note` `.lite-projects-group/-group-title/-group-count` `.lite-projects-grid` `.lite-project-card/-card-head/-title/-status/-summary/-facts/-fact/-fact-label/-fact-value/-progress/-progress-row/-progress-value/-progress-track/-progress-fill/-blockers/-blocker-count/-blocker-first` `.lite-projects-empty/-empty-cta/-restoring/-restore-failed/-restore-detail` `.status-dot.tone-danger|tone-warning|tone-unknown` `.edge-blocked|.edge-at-risk` `.is-status-unknown`。

### room（议事室）— `screens\RoomScreen.tsx`，`.scene.scene-nexus.is-active.lite-room`

三态，**无 scroll/frame 套路**（唯一的画布屏）：
- 已开跑（`run.status!=='idle'`，:295-343）：`<LitePanZoom/>` → `.lite-room-canvas`（LitePanZoom.tsx:22；CSS lite2.css:712-721：`absolute; inset:68px 20px 92px`，top 被 :5413-5415 覆盖为 96px）→ `.lite-panzoom-wrapper/.lite-panzoom-content` → `.lite-room-board`（CSS :737-746：flex wrap，**固定 width:1180px; max-width:none**）内含 `.nexus-terminal.lite-flow`（width min(440px,100%), height 420px，:749-756）+ `.nexus-brief-hud`（flex 1 1 260px，:758-766）+ `.lite-room-card`（flex 1 1 520px; max-height 560px; overflow auto，:777-784）+ 可选 `.lite-room-ask`（flex 1 1 420px; max-width 520px，:1368-1371）。画布外常驻 `.nexus-followup-composer`（55-ask-composer.css:3-17：absolute; left:16px; bottom:20px; width min(440px,100vw-56px)）。
- 无材料（`contextId===null`，:349-362）：`section.nexus-empty.lite-room-nomaterial[data-room-nomaterial]` —— composer 与 chips 一并收起，只留 CTA 回 home。
- 有材料未提问（:364-393）：`.nexus-empty` + `.nexus-empty-composer-wrap` + `.lite-room-chips`（4 个 `.lite-room-chip[data-chip-id]`，:377-392）。
`.nexus-empty` 来自 shared/40-nexus-empty.css:3-17：`absolute; top:42%; left:50%; translate(-50%,-50%); width:min(560px, 100vw-56px)`。
数据源：`useLite.run`（streamSource 派生的 phases/lines/citations/advice）、`useLite.ask`、`useLite.contextId`、`useFlow.composerDraft`（:280，挂载消费一次）。
类名：`.lite-room` `.lite-room-canvas/-canvas-controls/-canvas-hint/-canvas-reset` `.lite-panzoom-wrapper/-content` `.lite-room-board` `.lite-room-card` `.lite-room-ask` `.lite-flow/-flow-bar/-flow-toggle/-flow-body/-flow-phases/-flow-phase/-flow-dot/-flow-phase-text/-flow-phase-label/-flow-phase-meta/-flow-failed/-flow-cites-toggle/-flow-cite-list/-flow-cite/*` `.lite-room-chips/-chips-label/-chip-row/-chip` `.lite-room-nomaterial/-nomaterial-cta` + 借用 shared 的 `.nexus-terminal*`/`.nexus-brief-*`/`.nexus-empty`/`.nexus-followup-composer`。

### followups（待办清单）— `screens\FollowupsScreen.tsx`，`.scene.scene-nexus.is-active.lite-followups`

```
.lite-followups-scroll   lite2.css:2125  absolute inset:0
└ .lite-followups-frame  lite2.css:2132  max-width:760px; margin:0 auto; padding:84px 36px 90px（top→96px）
  ├ header.lite-followups-header      :214
  ├ .lite-followups-subtabs（active/history 两个 .lite-followups-subtab）  :219-239
  ├ form.lite-followups-add（input + select + submit）  :243-267   ※ 仅 active tab
  └ section.lite-followups-group[data-group] × today/week/later  :274-284
      └ ul.lite-followups-list > li.lite-followup-item[data-followup-id][data-followup-source]
```
数据源：**全部 `useFlow`**（followups + add/complete/reopen/delete/edit，:27-32），localStorage 持久化；草稿框走 `useDraft.openDraft(draftFromFollowup(item))`（:174）。
空态：`.lite-followups-empty-note`（active :270 / history :292）。无错态分支。
类名：`.lite-followups` `.lite-followups-scroll/-frame/-header` `.lite-followups-subtabs/-subtab` `.lite-followups-add` `.lite-followup-add-title/-add-group/-add-submit` `.lite-followups-group/-group-label` `.lite-followups-list` `.lite-followups-history-list` `.lite-followup-item/-main/-body/-title/-note/-check/-done-mark/-donedate/-source/-actions/-edit/-edit-title/-edit-group/-save/-cancel/-mail/-edit-btn/-restore/-delete` `.lite-followups-empty-note`。

### notes（笔记）— `screens\NotesScreen.tsx`，`.scene.scene-nexus.is-active.lite-notes`

**不用 scroll/frame，用「flex 居中 + 内层定宽自滚」老模式**：
```
.lite-notes    lite2.css:3202  display:flex; justify-content:center; padding:28px 20px 40px; overflow:hidden
                               padding-top 被 :5346(84px) 再被 :5407(var(--lite2-clear-top)=96px) 覆盖
└ .lite-notes-body  lite2.css:3210  width:min(760px, calc(100vw - 48px)); height:100%; overflow-y:auto
  ├ header.lite-notes-head（eyebrow/h2/.lite-notes-lede/.upload-privacy-note.lite-notes-redline-note/.lite-notes-count）
  └ .lite-notes-groups > .home-people-group.lite-notes-group（复用团队屏折叠头）
      └ .lite-notes-group-body > article.lite-notes-entry（.is-new 高亮最新）
```
数据源：`useLite.notes`（LiveNoteEntry[]，进屏 `refreshNotes()` :131-133）、`useLite.contextId`。整屏只读，零输入控件。
空态：`section.nexus-empty.lite-notes-empty`（:169-178，560px 居中卡）+ 常驻红线说明 + CTA 跳 room。无错态分支（refreshNotes 失败静默）。
类名：`.lite-notes` `.lite-notes-body/-head/-eyebrow/-lede/-redline-note/-count/-groups/-group/-group-head/-group-body/-entry/-entry-time/-entry-text/-entry-source/-empty/-empty-cta/-nudge` + 借 `.home-people-group*` `.nexus-empty` `.upload-privacy-note`。

### closerlook（多看一眼）— `screens\CloserLookScreen.tsx`，`.scene.scene-nexus.is-active.lite-closerlook`

```
.lite-closerlook-scroll   lite2.css:1725  absolute inset:0
└ .lite-closerlook-frame  lite2.css:1732  max-width:760px（全屏最窄）; padding:84px 36px 90px（top→96px）
  ├ header.lite-closerlook-header  :73
  ├ ol.lite-gap-list > li.lite-gap-card[data-gap-id]  :80-127
  │    └ .lite-gap-compare  grid 1fr 1fr (lite2.css:1775-1777)：.lite-gap-pane-claim | .lite-gap-pane-evidence
  │    + .lite-gap-meta（项目链接 + owner）+ .lite-gap-actions（resolve/dismiss/ask/addfollowup）
  ├ aside.lite-gap-realtime-note[data-realtime-note]  :138-141（0721 2C 条件时态预告）
  └ section.lite-gap-history（折叠，resolved+dismissed）  :144-190
```
数据源：`selectGapsActive/Resolved/Dismissed(useLite.team, useFlow.gapMarks)`（:39-41），派生纯函数 `gapDerive.ts`（只读项目字段）。
空态：`section.lite-gap-empty`（:129-132）。无错态分支。
🔴 本屏结构上不渲染任何数字（连 progress/dueDate 都不显）。
类名：`.lite-closerlook` `.lite-closerlook-scroll/-frame/-header/-lede` `.lite-gap-list/-card/-compare/-pane/-pane-claim/-pane-evidence/-pane-label/-pane-text/-meta/-project-link/-project-title/-owner/-actions/-resolve/-dismiss/-ask/-addfollowup/-empty/-realtime-note/-realtime-title/-realtime-body/-history/-history-toggle/-history-list/-history-item/-history-title/-history-badge/-restore`。

### playbooks（操作手册）— `screens\PlaybooksScreen.tsx`，`.scene.scene-nexus.is-active.lite-playbooks`

**最薄的一屏，无 scroll、无 frame、无内滚**：屏根直接套一张居中卡 `section.nexus-empty.lite-playbooks-empty`（:33，shared/40-nexus-empty.css:3 → `absolute; top:42%; translate(-50%,-50%); width:min(560px,100vw-56px); padding:28px; text-align:center`）。内含 eyebrow / h2 / p / 可选 `.lite-playbooks-company` / `.lite-playbooks-slots` + `ul.lite-playbooks-slot-list` > `li.lite-playbooks-slot[data-playbook-id]` / `.lite-playbooks-comingsoon` / `.lite-playbooks-reopen-onboarding`。
数据源：`useOnboard`（status/playbooks/company/reopen，:18-21）+ 模块常量 `PLAYBOOK_CATALOG`。**没走完向导 → 回落三条通用槽位 `fallbackSlots`（:29）**，即本屏永远是「空态形态」，没有真数据面。
⚠️ 本屏**不在** lite2.css:5401-5407 的 clear-top 消费者列表里（靠 `.nexus-empty` 的 42% 居中避开顶栏）——加任何顶部对齐布局时它是唯一没让位的屏。

### vision（未来方向）— `screens\VisionScreen.tsx`，`.scene.scene-nexus.is-active.lite-vision`

同 notes 的「flex 居中 + 内层定宽自滚」：
```
.lite-vision       lite2.css:1152  display:flex; justify-content:center; padding:28px 20px 40px; overflow:hidden
                                   padding-top → :5346(84) → :5407(96px)
└ .lite-vision-scroll  lite2.css:1159  width:min(860px, calc(100vw - 48px)); height:100%; overflow-y:auto
  ├ section.lite-vision-narrative
  │   ├ header.lite-vision-head（eyebrow/h2/.lite-vision-lede）
  │   ├ aside.lite-vision-summary[data-vision-summary]（3 点速读，:85-92）
  │   └ ol.lite-vision-beats > li.lite-vision-beat.lite-vision-beat-{now|real|proof}（flex column, :1195-1199）
  └ section.lite-vision-mocks
      ├ header.lite-vision-mocks-head
      ├ .lite-vision-mock-grid（CSS :1279）> article.lite-vision-mock.lite-vision-mock-{files|skills|loop|gate}
      │     每张必带 .lite-badge.lite-vision-tag（门相位 J 断言零未标注 mock）
      └ p.lite-vision-comingsoon
```
数据源：**纯静态**，全部 `t.lite2.vision*`，零 store 订阅。无空态/错态。唯一示例人 `.lite-vision-person`（名字+角色，零数字，:136-139）。

## 3. 内容栏宽现状（D15 口径）

**所有 max-width 规则的实际值与行号（lite2.css，`.lite2-shell` 作用域）：**

| 屏 | 选择器 | 行 | 值 |
|---|---|---|---|
| closerlook | `.lite-closerlook-frame` | **1732** | `760px` |
| followups | `.lite-followups-frame` | **2132** | `760px` |
| notes | `.lite-notes-body` | **3210** | `width: min(760px, 100vw-48px)` |
| **home** | **`.lite-home-frame`** | **3523-3524** | **`860px`** ← 主屏内容栏 |
| home 空态 | `.lite-home-frame-empty` | 3534 / **5072** | `640px` → 被 append-only 覆盖为 **`1040px`** |
| vision | `.lite-vision-scroll` | **1159-1160** | `width: min(860px, 100vw-48px)` |
| projects | `.lite-projects-frame` | **4356-4357** | `980px` |
| team | `.home-frame`（shared） | **70-home-cards.css:13-19** | `1460px`（+ grid `minmax(340px,38fr) 62fr`） |
| room 画布 | `.lite-room-board` | **737-746** | `width:1180px; max-width:none`（画布内世界宽，非内容栏） |
| playbooks / room 空态 | `.nexus-empty`（shared） | **40-nexus-empty.css:3-9** | `min(560px, 100vw-56px)` |
| 顶栏外夹 | `--lite2-frame-w` → `.prototype-topbar` | **5388 / 5438** | `min(1480px, 100vw-48px)` |

结论性事实：
1. **1480 目前只有一个消费者 —— 顶栏**（`--lite2-frame-w` 定义 5388，唯一引用 5438；grep 三个 css 文件确认无第二处）。没有任何内容 frame 消费它。所以「1480 只作外夹」在代码里已经成立，但也意味着**内容与顶栏当前不共基准线**：顶栏 1480 宽，home 内容栏 860 宽居中 → 顶栏左右各比内容多出 ~310px。
2. **主页要做「双栏满宽」，挡路的是 `lite2.css:3524` 的 `.lite-home-frame { max-width: 860px }`** —— 唯一一条。其次是 `lite2.css:3926-3930` 的 `.lite-home-row { grid-template-columns: 1fr 1fr }`（只覆盖 ②③ 两块，① ①½ ④ 是全宽单块），以及 `:3937` 的 `@media (max-width:720px)` 单列断点（要做双栏满宽时断点应上移到 ~1024，720 对 1040+ 的双栏太晚）。
3. 空态已经有 1040 的先例（5072-5074，append-only 覆盖同权重后写胜）——把有数据态推到 1040 与既有做法同构，且 760–1040 区间内 projects(980) / home-empty(1040) 都已落在带内；越界的只有 team 的 shared `.home-frame` 1460（在 shared 文件里，但已被 `.lite2-shell` 前缀覆盖过 padding-top，同法可覆盖 max-width 而不动 shared）。
4. 追加规则的安全落点：文件尾 `lite2.css:5378` 之后的 cr-align 段（同权重后写者胜的既定做法，注释 5070-5071 明说）。`shared/styles/00-base.css` 未被本次触及，符合红线。