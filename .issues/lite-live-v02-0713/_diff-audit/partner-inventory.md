# Partner "manager-command-room" — Exhaustive Interaction Inventory

> ## 🔴 2026-07-19 更正 · baseline note (this file itself is unchanged)
>
> This inventory maps **the partner's app**, which we never touched — so nothing below is
> factually stale about her repo. The banner is here because the **comparison it feeds** has moved:
> the other three files in `_diff-audit/` were written against **our** baseline
> `feat/047 @ 1833d97`, i.e. **before feat-050..060 landed**. Those eleven features are now
> merged and live (`origin/main` = `de47ffe`).
>
> So when this file is read side-by-side with `ours-lite2-inventory.md` or the diff clists,
> several "she has it / we don't" rows no longer hold — we now have a router (feat-051),
> a projects screen (feat-055), an aggregate home screen that is also the **default landing
> screen** (feat-057), and an in-app draft composer (feat-058). See the banners on those files.

READ-ONLY audit of `D:/avery-command-room (2)/avery-command-room/src`. Design reference for a feature-comparison / screen-by-screen diff. Every interactive element with `file:line` evidence. All paths relative to that repo's `src/`.

Stack: Next.js App Router, all pages `"use client"`, framer-motion animations, lucide-react icons, Tailwind. State is React `useState` on mock data from `lib/data.ts` (no backend, no persistence — edits/adds/completes live only in component state and reset on reload). Two global React contexts: `ModalProvider` (single centered modal) + `ToastProvider` (single bottom toast). See `app/providers.tsx:7-13`.

Mock data source of truth: `lib/data.ts` — 20 people, 6 projects, 5 decisions, 4 gaps, 10 checklist items, 6 playbooks, 5 KPIs, 4 nexus traces. Action/message templates: `lib/action-defs.ts`.

---

## Screen: `/` — Command Room (app/page.tsx)

**Purpose:** Manager's daily landing dashboard — greeting header, KPI strip, decision queue (left), and a right rail of reality-gaps + flagged people. `app/page.tsx:8-31`.

- Greeting header — static text "早上好，经理" + subline "7月10日…83天…扫描了186条信号…4处现实差距". Hardcoded copy, not derived from data. [app/page.tsx:11-18]
- **KPI strip** — 5 metric cards rendered from `kpis` (`lib/data.ts:638-644`). Each shows label, value, meta (colored up/down/flat), and a bottom accent bar sized `bar%`. Non-interactive (display only, no click). [components/command/kpi-strip.tsx:6-30]
  - Cards out of the box: 营收目标完成率 58% (down/red), 预订单转化率 66% (down/orange), 客户投诉率 4.2% "▲ 上月 3.1%" (orange), 团队负载(均) 72% (blue), 未解决差距 4 "2个高风险" (red). [lib/data.ts:639-643]
- **Decision Queue** — see dedicated component below (`components/command/decision-queue.tsx`). [app/page.tsx:23]
- **Gap Rail** ("报告 vs. 现实") — right column, top. Lists active gaps; each row is a `<Link href="/gaps">` (whole row navigates to Gaps page — no inline resolve here). [components/command/gap-rail.tsx:8-45]
  - Renders `gaps.filter(status==="active")` = 4 items: icon tile (tone gradient), name, italic self-claim, evidence (2-line clamp), tag. Hover highlights row. [components/command/gap-rail.tsx:9,19-41]
- **People Rail** ("需要关注的成员") — right column, bottom. Lists up to 5 flagged people, each row `onClick` opens the Person modal. [components/command/people-rail.tsx:9-52]
  - Flagged set = active people with `load>=90 OR sentiment==="strained"`, sorted by load desc, top 5. [components/command/people-rail.tsx:10-13]
  - Each row: avatar, name + status Badge, role, load% + mini load bar (color via `loadTone`). Click → `openPerson(p.id)` (Person modal, described in People section). [components/command/people-rail.tsx:23-48]

### Decision Queue (components/command/decision-queue.tsx) — reviewer priority

**Purpose:** Accordion list of the 5 `decisions` (`lib/data.ts:593-599`); each expands to show evidence + recommended play + action buttons. Header shows count Badge "5 待处理". [decision-queue.tsx:24-27]

- Decision card header button — click toggles expand/collapse (`setOpenId`), chevron rotates 90°. Shows level Badge (高风险/需确认/可推进 with dot), linked project name, title, impact line, an **AvatarStack** of involved people, and "N 条证据 · 1 个方法". [decision-queue.tsx:43-63]
- Expanded panel contents [decision-queue.tsx:66-114]:
  - "Avery 观察到的" — evidence list, each row = source tag + text. [decision-queue.tsx:77-85]
  - "推荐方案" card — the `method` name in a pill + the `play` prose. [decision-queue.tsx:87-94]
  - **Action buttons** — one Button per `d.actions[]`; first is `primary` (prefixed "✓ "), rest `ghost`. Each `onClick={handleAction(d.id, label)}` → looks up `getActionDef` and opens the **Action Modal** (see below). [decision-queue.tsx:97-106,16-20]
  - "深入问 Nexus" button — `<Link href="/nexus?q=<decision title>">`, navigates to Nexus prefilled with the decision title. [decision-queue.tsx:107-109]
- Per-decision available actions (from `lib/action-defs.ts`, keyed by decision id) — **these are the concrete "approve/draft/delegate/confirm" surfaces**:
  - d1 (营收目标拆解): "安排高靖周五汇报" (book/meeting), "准备向上争取预算" (confirm), "与陈思雨对齐拆解方案" (message/draft). [action-defs.ts:32-66]
  - d2 (预订单流失): "建立房态确认 SLA" (confirm), "今天确认 12 个预订单" (delegate/draft w/ items), "更新直销权益话术" (delegate/draft w/ items). [action-defs.ts:67-112]
  - d3 (佣金/资源): "设计新客公海规则" (confirm), "划出 3 个练习客户" (delegate/draft), "与赵一鸣沟通带教义务" (message/draft). [action-defs.ts:113-159]
  - d4 (市场承诺冲突): "唐可欣参与套餐审核" (message/draft), "试行首问负责制" (confirm), "建立承诺边界 checklist" (confirm). [action-defs.ts:160-187]
  - d5 (内容投放): "保持轻量 checkpoint" (confirm only). [action-defs.ts:188-194]

### Action Modal (components/command/action-modal.tsx) — reviewer priority: draft-message composer

Dispatched by `ActionModalContent` on `def.type`: book / delegate / message / confirm. [action-modal.tsx:24-35]. **These are READ-ONLY preview modals — the message body is pre-generated template text (from `action-defs.ts`), NOT an editable composer.** There is no editable textarea; the manager can only copy the text or open an external mail/calendar app.

- **BookModal** (type "book") — meeting preview card: title, duration + suggested tomorrow 10:00, attendees "+您", agenda (whitespace-pre-line description). [action-modal.tsx:37-129]
  - "Outlook 日历" link → `buildOutlookUrl(def)` (outlook.office.com deeplink, opens new tab). [action-modal.tsx:83-97, action-defs.ts:201-223]
  - "Google 日历" link → `buildGoogleCalUrl(def)` (calendar.google.com/render). [action-modal.tsx:98-112, action-defs.ts:225-243]
  - "加入待办清单" primary button → `toast("已加入待办清单")` + closes. (No actual persistence.) [action-modal.tsx:116-125]
- **DelegateModal** (type "delegate") — "委派任务" to recipients. Shows numbered "委派事项" list (`def.items`), then a **message preview** card: subject + body (pre-written, `whitespace-pre-line`, scrollable, read-only). [action-modal.tsx:131-241]
  - "邮件" link → `buildMailtoUrl(def)` (mailto: with subject+body). [action-modal.tsx:197-208, action-defs.ts:245-251]
  - "聊天应用" button → `navigator.clipboard.writeText(def.body)` + toast "消息已复制到剪贴板", swaps icon to check for 2s. [action-modal.tsx:136-141,209-224]
  - "完成 — 加入待办" primary → toast "已委派并加入待办" + close. [action-modal.tsx:228-238]
- **MessageModal** (type "message") — "发送消息" to recipients. Recipient chips, subject, body preview (read-only pre-written draft). Same 邮件 / 聊天应用(copy) options + "完成 — 加入待办" (toast "已发送并加入待办"). [action-modal.tsx:244-342]
- **ConfirmModal** (type "confirm", the fallback) — shows `def.label` + `def.checklistTitle`, single "确认" primary button → toast "已确认并加入待办" + close. [action-modal.tsx:344-380]

## Screen: `/companyinput` — Onboarding (app/companyinput/) — reviewer priority

**Purpose:** Full-page, self-contained onboarding wizard (NOT an overlay). Its own `layout.tsx` renders a fixed full-screen gradient backdrop at `z-9999`, so the app Topbar/FAB are covered. [app/companyinput/layout.tsx:1-16]. It is a **5-step multi-step wizard** driven by a single `step` state (0–4). [app/companyinput/page.tsx:59-60]. All inline-styled (no Tailwind classes), unlike the rest of the app.

- Steps defined in `STEPS` array: 上传资料 / 连接工具 / 团队信息 / 管理偏好 / 创建账号. [page.tsx:27-33]
- Header shows "初始设置 · 第 N 步（共 5 步）" + animated step title + description. [page.tsx:159-185]
- Top progress bar (5 equal segments, filled up to current step). [page.tsx:188-201]
- **Step 0 — 上传公司资料**: hidden `<input type=file multiple accept=.pdf,.doc…>`; big dashed drop zone button that triggers file picker AND handles drag/drop (`addFiles`). Uploaded files listed with name/type/size + per-file X remove button (`removeFile`). Starts EMPTY (`sampleFiles=[]`). Tip: can skip. [page.tsx:214-281,85-97]
- **Step 1 — 连接工作工具**: 6 toggle tiles (企业微信/飞书/钉钉/OA/BI/CRM) from `tools[]`; each `onClick=toggleTool` toggles membership in `connectedTools` Set (shows check + colored border when connected). [page.tsx:284-332,39-46,99-106]
- **Step 2 — 填写团队信息**: text inputs — 公司/部门名称* (`orgName`), 团队人数 (number, `teamCount`), 您的姓名* (`myName`), 您的职位 (`myRole`). [page.tsx:335-421]
- **Step 3 — 选择管理方法**: 8 checkbox tiles from `playbooks[]` (goal/1on1/fair/raci/gap/delegate/recovery/journey); 3 pre-checked. `togglePlaybook` toggles `selectedPlaybooks` Set. [page.tsx:424-469,48-57,108-115]
- **Step 4 — 创建管理员账号**: summary banner ("{myName}，一切准备就绪" + files/tools/playbooks counts), then 邮箱* (`email`), 设置密码* (`password`, min 6, inline error if <6), privacy note. [page.tsx:472-545]
- Navigation footer:
  - "上一步" button — `setStep(s-1)`, disabled on step 0. [page.tsx:561-577]
  - Dot indicators (current dot elongated). [page.tsx:579-592]
  - Next button (steps 0–3) — `setStep(s+1)`; label is "跳过" when step 0 has no files, else "下一步"; visually gated by `canNext` but click is NOT actually blocked (styling only). [page.tsx:594-612]
  - Final button (step 4) — "进入指挥室" (Rocket icon), `disabled={!canNext}`, `onClick` → `window.location.href="/"` (hard nav to Command Room). [page.tsx:613-638]
  - `canNext` rules: step0 true, step1 true, step2 needs orgName+myName, step3 needs ≥1 playbook, step4 needs email + password≥6. [page.tsx:74-83]
- Bottom step-label rail — 5 clickable step icons; clicking a step ≤ current jumps to it (done=green check, active=purple, future=gray & disabled). [page.tsx:643-684]

## Screen: `/checklist` — 待办清单 (app/checklist/page.tsx)

**Purpose:** The manager's action list; items sourced from decisions/nexus/gaps/manual. Two tab views (当前待办 / 历史清单). Seeded from `checklist` (`lib/data.ts:612-623`), split into active (unchecked) + completed. [checklist/page.tsx:22-32]

- "添加待办" header button — switches to active view + opens inline add form (`setAdding`). [checklist/page.tsx:111-113]
- **Tab switcher** (segmented control): "当前待办" (count Badge) / "历史清单" (count Badge) — `setActiveView("active"|"history")`, `aria-pressed`. [checklist/page.tsx:116-143]
- **Add form** (collapsible, active view only) — inputs 标题/负责人/到期 + 分组 `<select>` (今天/本周/即将到来); "保存" (`addItem`, needs title, source="manual") + "取消". [checklist/page.tsx:146-183,74-90]
- **Active groups** (今天/本周/即将到来) — each group renders its items; group hidden if empty. Group label + "N 待完成" Badge. [checklist/page.tsx:186-254,14-18]
  - Per item: round checkbox button → `complete(id)` (moves to completed w/ timestamp, toast "已完成: …"). [checklist/page.tsx:211-214,34-42]
  - Item body: title + source icon/label + owner + due. [checklist/page.tsx:224-235]
  - "编辑" (pencil) → inline edit mode (title/owner/due inputs + save/cancel); `saveEdit` toast "已更新". [checklist/page.tsx:216-223,237-241,63-72]
  - "删除" (trash) → `remove(id)`, toast "已删除". [checklist/page.tsx:242-244,53-56]
  - Empty state card when no active items. [checklist/page.tsx:256-263]
- **History view** — completed list; each shows strikethrough title, source, owner, "完成于 {time}". [checklist/page.tsx:265-324]
  - "恢复" (rotate-ccw) → `restore(id)` back to active, toast "已恢复". [checklist/page.tsx:307-313,44-51]
  - "删除" (trash) → `removeCompleted`, toast "已从历史中删除". [checklist/page.tsx:314-319,58-61]
  - "清空历史" text button → `clearHistory`, toast "历史已清空". [checklist/page.tsx:277-284,92-95]
  - Empty history state card. [checklist/page.tsx:325-331]
- Mock content out of the box: 10 items (c1–c10), 2 marked checked→history-ish (none checked in seed actually — all `checked:false`, so all 10 start active across today/this-week/upcoming). Sources: decision (#1–#4), nexus, gap. [lib/data.ts:612-623]

## Screen: `/gaps` — 现实差距 (app/gaps/page.tsx)

**Purpose:** "Report vs. reality" list — 4 gap kinds (报告不符/沉默成员/协作断裂/项目偏离). Seeded from `gaps` (`lib/data.ts:603-608`), local `gapList` state. Header Badge "N 个活跃". [gaps/page.tsx:19-47,12-17]

- **Active gap card** (per active gap) — icon tile (tone gradient), name, kind Badge; two-column compare: "自报情况" (italic claim) vs "Avery 观察到的" (red-bg evidence). [gaps/page.tsx:50-91]
  - "解决" button → `resolve(id)` sets status "resolved", toast "已标记为已解决". [gaps/page.tsx:82,27-30]
  - "忽略" button → `dismiss(id)` sets status "dismissed", toast "已忽略". [gaps/page.tsx:83,32-35]
  - "加入待办" button → `<Link href="/checklist">` (navigates; does NOT create a real item). [gaps/page.tsx:84-86]
- **History toggle** — "显示/隐藏 历史记录 (N)" text button (`setShowHistory`), appears only if any resolved/dismissed. Shows grayed cards with 已解决/已忽略 Badge. [gaps/page.tsx:95-114]
- Mock content: g1 report_mismatch (营收 chen), g2 report_mismatch (预订单 liu), g3 collaboration_orphan (佣金 huang), g4 project_drift (市场承诺 tang). All start active. [lib/data.ts:604-607]

## Screen: `/nexus` — Nexus chat (app/nexus/page.tsx) — reviewer priority

**Purpose:** A chat/dialog view where the manager asks questions; Nexus replies with a reasoning trace + answer + rich artifacts + a suggested-action card. IS a chat box (message list + input + send). Wrapped in `<Suspense>`. [nexus/page.tsx:32-193,328-334]

- **Message list** — vertical scroll area. User messages: navy right-aligned bubbles. Nexus messages: `NexusResponse` component. [nexus/page.tsx:88-154,117-135]
- **Empty state** — center hero "您想了解什么？" + 4 suggested-question chips from `suggestedQuestions` (`lib/data.ts:695-700`); clicking a chip → `handleSend(q)`. [nexus/page.tsx:89-113]
- **Auto-ask from URL** — reads `?q=` param (set by FAB, decision-queue "深入问 Nexus", project modal "问 Nexus"); auto-sends once on mount via `didAutoAsk` ref. [nexus/page.tsx:33-47]
- **Send flow** — `handleSend`: pushes user msg, sets `typing=true`, then after a **1200ms fake delay** picks a canned trace via `pickTrace` (keyword match on 营收/预订/状态/冲突; default=revenue) and pushes the Nexus reply. [nexus/page.tsx:53-73,23-30]
- **Typing indicator** — 3 bouncing dots + "Nexus 正在思考..." while `typing`. [nexus/page.tsx:137-151]
- **Input bar** (bottom, sticky) — text input, Enter key or Send button → `handleSend(input)`. [nexus/page.tsx:156-175]
- **Follow-up chips** — after ≥1 message, up to 3 remaining suggested questions as chips. [nexus/page.tsx:176-188]
- **NexusResponse** (the reply block) [nexus/page.tsx:195-325]:
  - **Reasoning trace** — a header "✦ {question}" then 4 numbered, color-coded steps (读取事实 / 交叉验证 / 匹配方法 / 生成动作), each with a key + text, staggered animation. From `nexusTraces[*].steps` (`lib/data.ts:648-693`). **This trace is ALWAYS shown in full — there is NO simplify/collapse/show-reasoning toggle.** [nexus/page.tsx:206-230]
  - **"Nexus 回答"** — the `answer` prose card. [nexus/page.tsx:232-243]
  - **Rich artifacts** (conditional on question keywords):
    - Team-load artifact ("团队负载总览") — shown when question includes 状态/关注; lists active people with load≥85 (avatar + name + load% + bar). [nexus/page.tsx:196-197,246-270]
    - Revenue chart artifact ("营收目标完成率（6 周）") — shown when question includes 营收/目标; a hardcoded 6-bar mini bar chart [42,46,50,54,56,58]. [nexus/page.tsx:198,272-299]
  - **Suggested-action card** ("建议行动") — shown when `msg.decisionId` present: "加入待办" button → `toast("已加入待办清单")`; "查看决策" button → `toast("已打开决策")` (toast only, does NOT navigate). [nexus/page.tsx:301-322]
- Note: `NexusMessage`/`NexusArtifact`/trace types exist in `lib/types.ts:138-158` but the page uses its own lighter `Message` type; artifacts are computed inline, not from the data model.

## Screen: `/people` — 团队成员 (app/people/page.tsx)

**Purpose:** Grid of digital-twin people cards with team/sentiment filters, add/deactivate, and a rich Person modal. Seeded from `people` (20, `lib/data.ts:73-496`), local `peopleList` state. [people/page.tsx:16-29]

- "添加成员" header button → opens inline add form. [people/page.tsx:75]
- **Filters**: 组别 chip row (7 teams incl 全部) `setTeamFilter`; 情绪 chip row (全部/积极/平稳/紧绷) `setSentimentFilter`. Active chip = navy. [people/page.tsx:79-97,12-14]
- **Add form** (collapsible) — 姓名/职位/组别`<select>`/简称 inputs; "添加" (`addPerson`, defaults tone blue, load 0, "新加入") + "取消". [people/page.tsx:100-121,40-62]
- **Active people grid** (3-col) — each card `onClick=openPerson(p.id)` opens Person modal. Shows avatar, name, role·team, status Badge, focus, and 3 stats: 负载% (loadTone color), 情绪 (label), 健康度 (`Math.max(40,100-|load-70|)`). [people/page.tsx:124-163,127]
  - "停用" button (per card, `stopPropagation`) → `toggleActive`, toast "{name} 已停用". [people/page.tsx:152-158,34-38]
- **Inactive section** ("已停用 (N)") — grayed cards; "重新启用" → `toggleActive`, toast. [people/page.tsx:165-183]

### Person Modal (components/people/person-modal.tsx) — opened via `usePersonModal()` from People grid, People Rail, and search-highlight targets

**Purpose:** 3-view modal (detail / message / book), slide-animated. `usePersonModal` returns a callback that `open(<PersonModalContent>)`. [person-modal.tsx:300-342,753-758]

- **Detail view** [person-modal.tsx:344-505]:
  - Header: avatar, name, role·team, status Badge, load%, and an animated **ScoreRing** (overall = avg of dimension scores). [person-modal.tsx:361-378,63-103]
  - **评估维度** — 5 `DimensionBar`s (业绩产出/协作配合/主动性/可靠性/状态健康); each has icon, label, trend arrow, score, animated bar, and **hover tooltip showing the evidence text** (navy popover). [person-modal.tsx:383-396,105-149]
  - **绩效趋势** — `TrendChart`: SVG dual-line (负载/产出) + sentiment bar strip + legend, with **range toggle buttons 5周/季度/半年/1年** (`setRange`, default 季度). Data from `weeklyTrend` (52 wks built by `buildTrend`). [person-modal.tsx:398-408,151-298]
  - 优势 / 待提升 two-column lists; 协作 note; **Avery 的判断** insight card. [person-modal.tsx:410-461]
  - 已标记 gaps (if any active for this person); 参与项目 list — each a `<Link href="/projects?highlight=id">` (closes modal on click). [person-modal.tsx:463-494]
  - Footer actions: "安排 1:1" → book view; "发消息" → message view. [person-modal.tsx:496-500]
- **Message view** — pre-written draft (subject "简短沟通" + generic check-in body), read-only preview. Options: 邮件 (mailto link) / 聊天应用 (copy to clipboard, toast) ; "完成 — 加入待办" (toast + close). "返回" back button. [person-modal.tsx:507-611]
- **Book view** — 1:1 meeting preview (30min, tomorrow 10:00, agenda). Outlook / Google calendar deeplinks; "完成 — 加入待办" (toast + close). "返回" back button. [person-modal.tsx:613-751]
- Note: message/book email addresses built locally as `{name}.@hotel.cn` via `personEmail`. [person-modal.tsx:38-40]

## Screen: `/playbooks` — 方法库 (app/playbooks/page.tsx)

**Purpose:** Static reference gallery of the 6 methodology playbooks Nexus cites. [playbooks/page.tsx:7-47]

- 6 cards from `playbooks` (`lib/data.ts:627-634`): icon tile, title, sub, and chip tags. **Non-interactive** — display only, `card-hover` visual effect only, no click handlers. [playbooks/page.tsx:20-43]
- Content: 目标与规划 / 客户旅程与转化 / 绩效薪酬与公平 / 团队领导力 / 协同与冲突 / 收益与定价, each with 4 framework chips. [lib/data.ts:628-633]

## Screen: `/projects` — 项目看板 (app/projects/page.tsx)

**Purpose:** Card board of 6 projects sorted by status severity; add/archive; click a card for a detail modal. Seeded from `projects` (`lib/data.ts:500-589`), local `projectList` state. [projects/page.tsx:42-53,31-33]

- "添加项目" header button → opens inline add form. [projects/page.tsx:129-131]
- **Add form** (collapsible) — 项目名称/负责人/截止日期/影响 inputs; "创建" (`addProject`, status "planning", default 4 milestones) + "取消". [projects/page.tsx:135-168,78-105]
- **Project card** (`<motion.button>`, 3-col) — click → `openDetail(p)` (opens Project Detail modal). Shows: color header strip, title + status Badge, impact (2-line clamp), animated progress bar, milestone dots (from `p.miles` w/ state colors), "发现偏差" red pill if `drift`, footer owner avatar + due date + member AvatarStack. [projects/page.tsx:171-275,35-40]
- **Archived section** ("显示/隐藏 已归档 (N)") — toggle `setShowArchived`; grayed cards with "恢复" → `unarchive` (toast "项目已恢复"). [projects/page.tsx:278-309,71-76]

### Project Detail Modal (components/projects/project-detail-modal.tsx)

**Purpose:** Full project view w/ inline edit, milestones, drift alert, expandable member cards, archive. [project-detail-modal.tsx:168-374]

- Header: animated **ProgressRing** (`components/projects/progress-ring.tsx`), name, status Badge, owner, due date. Name becomes an input in edit mode. [project-detail-modal.tsx:198-232,206-207]
- 为什么重要 (impact) + 当前状态 (summary) — become textareas in edit mode. [project-detail-modal.tsx:235-267]
- **里程碑** — list of milestones w/ state dot + label + state text (已完成/进行中/受阻/待开始) + a segmented progress track. [project-detail-modal.tsx:269-300,39-44]
- **Drift alert** — red "发现现实差距" card if `project.drift`. [project-detail-modal.tsx:302-317]
- **团队成员 (N)** — one `MemberCard` per member. Each card header (avatar, name, 负责人 tag if owner, status pill, progress% + phase + bar) is a button → **expands** to show 当前工作, 加入于/阶段 meta, and a **历史记录 timeline** (joined/milestone/delivery/flag/note events w/ colored dots). [project-detail-modal.tsx:319-332,72-165]
- Footer actions:
  - View mode: "编辑" (→ edit mode), "归档" (`onArchive` → archives + status completed + progress 100, closes modal, toast "项目已归档"), "问 Nexus" (`<Link href="/nexus?q=…当前状态如何？">`, closes modal). [project-detail-modal.tsx:356-369, projects/page.tsx:55-63]
  - Edit mode: due-date input appears; "保存" (`onUpdate(draft)`, toast "项目已更新") + "取消". [project-detail-modal.tsx:334-355,190-194]
- Mock content: 6 projects incl 3 at-risk (年度别墅营收冲刺, 国庆亲子别墅预订单, 市场承诺与前厅协同), needs-check (佣金方案, 新人带教), on-track (服务式别墅内容投放). 3 have `drift` set. [lib/data.ts:500-589]

## Cross-cutting / Shell

Rendered in root layout for every route EXCEPT `/companyinput` (its layout covers the shell). Order: navbar backdrop, Topbar, main, footer, NexusFab, all inside Providers. [app/layout.tsx:12-67]

### Topbar (components/shell/topbar.tsx) — fixed glass navbar
- **Brand logo** — `<Link href="/">` Avery SVG (gradient wordmark + "管理指挥室"). [topbar.tsx:168-192]
- **Primary nav** — 7 `<Link>`s from `navItems`: 指挥室 `/`, 项目 `/projects`, 团队 `/people`, 差距 `/gaps` (red badge = active gaps count), Nexus `/nexus` (purple accent), 待办 `/checklist` (gold badge = today-due count), 方法库 `/playbooks`. Active state via `usePathname`. Badges are live counts from data. [topbar.tsx:11-19,195-217]
- **Global search** (xl+ only) — input filters people (active), projects (non-archived), and pages; dropdown of up to 8 results; click or Enter → `router.push(result.href)`. Person/project results link to `/people?highlight=id` / `/projects?highlight=id`. Closes on outside click / Escape. [topbar.tsx:220-254,23-56,150-163]
  - NOTE: those `?highlight=` targets are dead — neither `/people` nor `/projects` reads a `highlight` search param, so the deep-link just lands on the page with no highlight/auto-open.
- **Notifications bell** — button toggles a dropdown (framer AnimatePresence); red unread-count badge. 5 seeded notifications (`initialNotifications`, local state). [topbar.tsx:257-340,60-122]
  - "全部标为已读" → marks all read. [topbar.tsx:281-288]
  - Each notification click → mark read + `router.push(n.href)` + close. Per-item hover X → remove. Empty state when all removed. [topbar.tsx:292-336]
- **User chip** — "王经理 / 市场营销总监" + purple 王 avatar (static, non-interactive). [topbar.tsx:343-349]

### Global FAB (components/shell/nexus-fab.tsx) — "问 Nexus"
- Fixed bottom-center pill. Hidden on `/nexus` (`if pathname==="/nexus" return null`). [nexus-fab.tsx:8-14]
- Collapsed: "问 Nexus" gradient button → `setExpanded(true)`. [nexus-fab.tsx:62-76]
- Expanded: inline form (Sparkles + input "向 Nexus 提问..." + submit arrow + X close). Submit → `router.push('/nexus?q=<query>')`. [nexus-fab.tsx:28-61,16-23]

### Toasts (components/ui/toast.tsx)
- Single global bottom-center navy toast via `useToast().toast(msg)`; auto-dismiss after 2400ms; every mutating action across the app (complete/add/edit/delete/resolve/dismiss/confirm/delegate/message/book/archive) fires one. [toast.tsx:13-40]

### Modal system (components/ui/modal.tsx)
- Single global centered modal via `useModal().open(content)/close()`. Backdrop = navy/40 blur, click-to-close; X close button top-right; spring animation; max-width 560px, max-height 86vh scroll. Hosts Action modal, Person modal, Project Detail modal. [modal.tsx:18-57]

### Footer (app/layout.tsx)
- "AI 管理辅助约束" disclaimer + 5 static constraint chips (非最终决策依据 / 需人工复核 / 禁止单一人事处分依据 / 遵守数据权限 / 保留操作留痕). Non-interactive. [app/layout.tsx:39-61]

### UI primitives (components/ui/)
- `Button` variants: primary(navy) / ghost(white+border) / soft(purple) / danger(red). [button.tsx:5-26]
- `Badge` (tone map, optional dot), `Avatar` + `AvatarStack` (+N overflow), `ProgressBar` + `MilestoneTrack`, `ProgressRing`. [badge.tsx, avatar.tsx, progress-bar.tsx, projects/progress-ring.tsx]

### Theme / skin & keyboard
- Single light theme (glassmorphism, purple/blue gradients); NO dark mode, NO skin/paper-vs-aurora toggle in this partner build. `html lang="zh-CN"`. [app/layout.tsx:14]
- No global keyboard shortcuts/command palette. Only local key handlers: Topbar search Enter/Escape [topbar.tsx:156-163], Nexus input Enter [nexus/page.tsx:165], FAB form submit [nexus-fab.tsx:16].

### Cross-cutting notes for the diff reviewer
- Everything is client-side mock state; nothing persists across reload and there is no real API/auth.
- "Draft message" surfaces are preview-only (no editable composer): Action modal message/delegate [action-modal.tsx:131-342] and Person modal message view [person-modal.tsx:507-611] — both show pre-generated template text + copy/mailto only.
- Nexus reasoning trace is always fully expanded — no simplified-output/show-reasoning toggle anywhere.
- Onboarding is a standalone full-page 5-step wizard, not a modal/overlay.
