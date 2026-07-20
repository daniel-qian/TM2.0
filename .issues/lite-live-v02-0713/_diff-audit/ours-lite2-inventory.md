# OUR v02 app (lite2) — exhaustive interaction inventory

> ## 🔴 2026-07-19 更正 · 这份清单的基线早于 feat-050..060，多处已失效
>
> **Baseline is `feat/047 @ 1833d97` — i.e. BEFORE the eleven-feature wave (feat-050..060) landed.**
> That wave is now merged into `main` and **live** (`origin/main` = `de47ffe`).
> This file is still accurate as a snapshot of `1833d97`, but **do not use it to answer
> "what does lite2 have today"** without checking the corrections below.
>
> What changed under this document's feet:
>
> | This file says | Now |
> |---|---|
> | No router — screens are Zustand state, not URLs | **feat-051 shipped real `react-router`** (`BrowserRouter` in `Lite2App.tsx`, one `<Route>` per screen + deep links) |
> | 7 screens | **9** — `/projects` (feat-055) and `/home` (feat-057) were added; **`/home` is now the default screen** |
> | `?skin=` / `data-skin` | **renamed to `?look=` / `data-look`** by feat-068 (`lite2/skin.ts` → `lite2/look.ts`) |
> | No in-app message-draft box anywhere | **feat-058 shipped `src/lite2/DraftComposer.tsx`** |
> | Bare URL renders v01 unless `?v=2` | **Bare URL now renders v02**; `?v=1` is the v01 escape hatch |
>
> ⚠️ **The `?skin=` rename has a trap.** The old parameter is **deliberately not aliased** —
> `?skin=aurora` logs a `console.error` but the page still renders the default `paper` look.
> So **any old script or checklist still driving `?skin=aurora` gets a false pass**: it thinks
> it verified the aurora look, and it actually verified paper twice.
> Inline 「07-19 更正」 notes are added at each affected entry below. **No original text was deleted.**

Baseline: `feat/047 @ 1833d97` (worktree `D:/avery/.claude/worktrees/v02-baseline-ro/`).
Scope: `src/lite2/**` + `src/shared/**` (v01 `src/lite/**` and `src/story/**` NOT mapped — forbidden/out of scope).
All `file:line` paths are relative to the worktree root. Read-only map for a screen-by-screen diff vs a design-reference app.

App type: Vite + React + Zustand. No router — screen switching is Zustand state, not URLs. Entry component: `src/lite2/Lite2App.tsx`.

> 🔴 **07-19 更正**: "No router" is obsolete. **feat-051 shipped `react-router`** — `Lite2App.tsx`
> wraps the lite2 tree in `<BrowserRouter>` with one `<Route>` per screen plus deep links
> (`/team/:personId`, `/projects/:projectId`). Screen state is now derived from the URL.

---

## App shell — Lite2App.tsx
**Purpose:** Single-page shell; renders topbar, one of 7 screens (switch on `screen` state), optional detail overlay + onboarding wizard, and a persistent footer. No client router; screens are conditional renders.

> 🔴 **07-19 更正**: **9 screens, not 7** (`/projects` from feat-055, `/home` from feat-057),
> and **`/home` is the default landing screen**. "No client router; screens are conditional
> renders" is obsolete — see the router note above. The `data-skin` attribute mentioned in the
> next bullet is now **`data-look`**, resolved from **`?look=`** (feat-068 rename).

- Shell root `<div class="app-shell lite2-shell">` — carries `data-scene={screen}`, `data-mode="live"`, `data-skin={skin}`; skin resolved once at mount from URL [Lite2App.tsx:42, :32].
- `<LiteTopbar/>` — always mounted (nav tabs + bell + optional mode switch) [Lite2App.tsx:43].
- `<main class="scene-stage">` — renders exactly one screen by `screen` value: team→TeamScreen, followups→FollowupsScreen, notes→NotesScreen, closerlook→CloserLookScreen, playbooks→PlaybooksScreen, vision→VisionScreen, else(room)→RoomScreen [Lite2App.tsx:44-60].
- `<DetailOverlay/>` — mounted only when `detail` is non-null (person/project overlay) [Lite2App.tsx:61].
- `<OnboardWizard/>` — mounted only when `selectWizardOpen` is true (first-visit / resume, not paused this session) [Lite2App.tsx:62, onboardStore.ts:173].
- `<Lite2Footer/>` — always mounted, compliance disclaimer, never hidden by tab change [Lite2App.tsx:63].
- `initNotifications()` — wired once on mount via effect (subscribes notifyStore to the lite store) [Lite2App.tsx:36-38].

## Topbar / navigation — LiteTopbar.tsx
**Purpose:** The ONLY inter-screen navigation control. Renders 7 tab buttons + a notification bell + an optional Story/Live mode switch. There is no footer nav and no breadcrumb.

- 7 tab buttons `.scene-tab` — `onClick=goScreen(tab.screen)`; active tab gets `is-active`. Order: Your team(team) · The room(room) · Follow-ups(followups) · Avery's notes(notes) · A closer look(closerlook) · Playbooks(playbooks) · Where this goes(vision) [LiteTopbar.tsx:23-31, :41-50].

> 🔴 **07-19 更正**: now **9 screens** — feat-055 added the projects board and feat-057 added the
> aggregate home screen, which is also the **default landing screen**. Navigation is by route,
> not `goScreen` state alone.
- `<LiteBell/>` — notification bell, rendered outside the `.scene-tabs` nav (deliberately, so a gate that counts 6/7 tabs isn't polluted) [LiteTopbar.tsx:53].
- Mode switch `.mode-switch` (Story / Live buttons) — **hidden by default**; only rendered when `showModeSwitch()` is true (URL `?modeSwitch=1`). `onClick=switchMode('story'|'live')` sets shared mode + writes to URL [LiteTopbar.tsx:56-77, :33-36].

## Footer — Lite2Footer.tsx
**Purpose:** Global compliance disclaimer, always present.
- Single `<p>` with `t.lite2.footerText` — static text, no interactive elements [Lite2Footer.tsx:9-11].

---

## RoomScreen.tsx (+ LitePanZoom, streamSource) — "The room"
**Purpose:** Live SSE console for one `/advise` run. Empty state = ask composer + 4 suggested-question chips. Once a run starts: a pan/zoom canvas holds a "thinking it through" terminal, a status HUD, the 8-field advice card, an optional Quick-ask card, and (below the canvas) a persistent follow-up composer.

Empty state (run.status === 'idle') [RoomScreen.tsx:189-220]:
- Ask composer `<input>` + submit button — `onAsk(text) → askLive({situation:text})`; the composer is the `LiteAskComposer` local component (a plain `<form>`, not a popup) [RoomScreen.tsx:73-104, :195-200].
- 4 suggested-question chips `.lite-room-chip` (ids: attention, project-risk, handoff, next-week) — **click sends immediately** via `askLive({situation: chip.text})` (no composer prefill) [RoomScreen.tsx:109-114, :206-216].
- `initialValue` of composer is prefilled from `flowStore.composerDraft` (a triage/gap "take to the room" handoff) — consumed once on mount, prefill only, never auto-submits [RoomScreen.tsx:84, :125-131, :186, :199].

Active state (run.status !== 'idle') [RoomScreen.tsx:139-188]:
- `<LitePanZoom>` wraps the board (terminal + HUD + cards) — see LitePanZoom below [RoomScreen.tsx:142].
- `LiteTerminal` — renders `run.lines[]` (thought / tool-call / tool-result / manifest lines) with a `running ▌` cursor line while running; auto-scrolls to bottom on new lines. **Read-only stream — no collapse / no "show reasoning" / no simplified-output toggle. Every line is always shown.** [RoomScreen.tsx:28-68, :143].
- `.nexus-brief-hud` status bar — shows liveError / liveRunning / liveReady text; display-only [RoomScreen.tsx:144-156].
- `<LiteAdviceCard advice={advice}>` — the 8-field read card, rendered when `run.advice` present [RoomScreen.tsx:157-159].
- `.lite-notes-nudge` button — rendered only when `noteJustAdded`; `onClick=goScreen('notes')` [RoomScreen.tsx:163-171].
- `<AskCard/>` — rendered when `ask` present (agent-drafted Quick ask) [RoomScreen.tsx:175-179].
- Follow-up composer (below canvas, always clickable during a run) — same `LiteAskComposer`, `onAsk → askLive({situation})` [RoomScreen.tsx:182-187].

Canvas interaction model — LitePanZoom.tsx (`react-zoom-pan-pinch`):
- Drag to pan, wheel/pinch to zoom (scale 0.4–2.2, wheel step 0.1); double-click zoom disabled; panning excluded on input/textarea/button so form controls stay usable [LitePanZoom.tsx:23-33].
- `.lite-room-canvas-reset` button — `onClick=ref.resetTransform()` recenters/rezooms [LitePanZoom.tsx:36-42].
- `.lite-room-canvas-hint` — static hint text [LitePanZoom.tsx:35].
- Camera state is component-local (not in any store); no world coordinates, no "rail", content flows naturally [LitePanZoom.tsx:16-17].
- There are NO clickable "nodes" on the canvas — the canvas holds a terminal + cards, not a node graph. Cards inside have their own buttons (advice add-followup, ask controls). Node/graph clicking does not exist here.

streamSource.ts (how the stream/thinking is built) [streamSource.ts]:
- `applyEvent` maps SSE events → terminal lines: `think`→agent thought; `tool`→tool-call line; `observe`→tool-result; `nudge`→system line with humanized text (never exposes rule id); `manifest(advice)`→sets 8-field advice + "The read is ready"; `manifest(ask-draft)`→sets askDraft + "A quick ask is drafted"; `error`→error line [streamSource.ts:125-175].
- No filtering/summarization/collapse of think lines — everything pushed to `state.lines` is rendered verbatim. Confirms **no simplified-output toggle** anywhere in the stream path [streamSource.ts:95-98, RoomScreen.tsx:46-56].

---

## TeamScreen.tsx (+ UploadPanel, LiteComposer, teamGroups, InitialAvatar) — "Your team"
**Purpose:** The default landing screen. Empty state = guidance spine + upload panel. After ingest: briefing header (real counts), a morning-triage list (from project blockers) with 5 per-item actions, a handled/set-aside drawer, grouped people cards, project cards, and a bottom composer.

Empty state (no `team`) [TeamScreen.tsx:283-295, :357-361]:
- Left spine: static guidance copy + 3 hint bullets (roster / project / privacy). No controls [TeamScreen.tsx:285-294].
- Right column: `<UploadPanel/>` (the only interactive element) [TeamScreen.tsx:359].

Loaded state (`team` present) [TeamScreen.tsx:155-356]:
- Briefing header — eyebrow + headline + subhead + metric chips (People/Projects counts from ingestion) [TeamScreen.tsx:157-170].
- Triage count line — "{pending} of {total}" remaining [TeamScreen.tsx:174-178].
- Triage list `.home-handoff` items (from `selectTriagePending`, derived from project blockers) — each with 5 actions:
  - `.home-check` ✓ button — `markTriageDone(id)` (moves to handled drawer) [TeamScreen.tsx:188-197].
  - `.home-map-card-link` "open" — `openDetail('project', projectIds[0])` [TeamScreen.tsx:204-209].
  - `.lite-triage-room` "take to the room" — `setComposerDraft(action — evidence)` then `goScreen('room')` (prefill, no auto-submit) [TeamScreen.tsx:210-216, :132-138].
  - `.lite-triage-addfollowup` — `addFollowup({source:'triage', dueGroup:'today'})`; disables + shows "Added" after click [TeamScreen.tsx:217-226, :140-147].
  - `.lite-triage-draftmail` — an `<a href={draftMailForHandoff(handoff)}>` = a **mailto: link** (opens the OS mail client, recipient blank) — NOT an in-app draft box [TeamScreen.tsx:227-229, draftLinks.ts:14-18].
  - `.home-discard` — `discardTriage(id)` (moves to set-aside drawer) [TeamScreen.tsx:230-236].
- Empty/all-done note when no pending items [TeamScreen.tsx:242-246].
- Handled/set-aside drawer `.home-drawer-toggle` — expand/collapse; each item has a `restoreTriage(id)` button [TeamScreen.tsx:248-281].
- People: grouped by dept/project-ownership/role via `groupPeople` (teamGroups.ts). Each `PeopleGroup` has a collapse toggle header [TeamScreen.tsx:308-317, :72-109].
  - `PersonCard` `.home-person-card` button — `onClick=openDetail('person', id)`; renders `InitialAvatar` (text initials), name, role, qualitative read. **No numbers/scores rendered (red line).** [TeamScreen.tsx:46-69, InitialAvatar.tsx:11-25].
- Project cards `.home-project-card` button — `onClick=openDetail('project', id)`; shows status dot, optional progress strip (`project.progress%`), owner, due date [TeamScreen.tsx:321-354].
- `<LiteComposer/>` — bottom composer (always present in loaded state) [TeamScreen.tsx:365].

### UploadPanel.tsx
**Purpose:** Real file ingest (drag/drop or file picker) → `store.uploadFiles` → transport.ingest. Shows progress, source-file chips, and a persistent "your files" list.
- Dropzone `.upload-dropzone` — click / Enter / Space opens hidden file input; drag-over highlight; `onDrop → uploadFiles(files)` [UploadPanel.tsx:62-99].
- `.upload-choose` button — opens file picker (stops propagation) [UploadPanel.tsx:92-97].
- Hidden `<input type=file multiple accept=".pdf,.docx,...">` — `onChange → uploadFiles` [UploadPanel.tsx:81-90, :26].
- Status region (aria-live): ingesting / ready(+source chips) / error(+`.upload-retry` button) / idle [UploadPanel.tsx:101-128].
- "Your files" list `.upload-files` (persistent metadata: filename, size, n_chunks) — display-only, rendered when `files.length>0` [UploadPanel.tsx:132-146].
- Privacy note (static) [UploadPanel.tsx:148].

### LiteComposer.tsx
**Purpose:** Team-screen composer that lets the manager type a question, optionally @-reference people/projects from the live corpus, then sends to the room.
- Text `<input>` — `onFocus/onClick` expands composer; `onChange` sets question [LiteComposer.tsx:102-110].
- Submit button — `handleSubmit`: weaves selected references into the situation text, `askLive({situation})`, then `goScreen('room')` [LiteComposer.tsx:70-83, :111-113].
- `.composer-add-button` (+) — toggles the reference picker [LiteComposer.tsx:118-129].
- Reference chips — each has a remove (x) button `removeReference(id)` [LiteComposer.tsx:131-143].
- Reference picker: filter buttons (all/person/project), a search `<input>`, and a list of option buttons — `addReference(option)` on click; references come only from live team data (zero fixtures) [LiteComposer.tsx:148-186, :40-62].
- This is a compose-and-send box; it is NOT a message-to-employee draft popup.

---

## FollowupsScreen.tsx (+ flowStore, draftLinks) — "Follow-ups"
**Purpose:** A real to-do / decision queue. Active list grouped today/this-week/later + a manual add form + a History tab. Every "add to follow-ups" entry point across lite2 writes into the SAME flowStore.
- Sub-tabs `.lite-followups-subtab` (Active / History) — `setTab('active'|'history')`; history shows count [FollowupsScreen.tsx:206-226].
- Add form (active tab): title `<input>` + due-group `<select>` (today/week/later) + submit — `addFollowup({source:'manual'})` [FollowupsScreen.tsx:230-254, :89-96].
- Active items grouped by dueGroup; each item (`renderItem`) has:
  - `.lite-followup-check` complete button — `completeFollowup(id)` (→ history) [FollowupsScreen.tsx:138-144, :28].
  - `.lite-followup-mail` — `<a href={draftMailForFollowup(item)}>` = **mailto: link** (not an in-app draft) [FollowupsScreen.tsx:162-164, draftLinks.ts:20-24].
  - `.lite-followup-edit-btn` — enters inline edit (title `<input>` + group `<select>` + Save/Cancel; Save = `editFollowup`) [FollowupsScreen.tsx:165-173, :107-134, :76-87].
  - `.lite-followup-delete` — `deleteFollowup(id)` (hard remove from list; localStorage only) [FollowupsScreen.tsx:183-189, :30].
  - source label chip (triage/room/ask/closer-look/manual) — display-only [FollowupsScreen.tsx:153, :61-74].
- History tab: completed items with a `.lite-followup-restore` button — `reopenFollowup(id)` (→ back to active) [FollowupsScreen.tsx:174-182, :29].
- Empty notes for active/history when lists are empty [FollowupsScreen.tsx:256-257, :278-279].

---

## CloserLookScreen.tsx (+ gapDerive, flowStore) — "A closer look"
**Purpose:** Contradiction cards — projects whose self-report reads "steady" but that carry a blocker line saying otherwise (pure derivation via gapDerive). Each card = claim vs evidence panes + resolve/dismiss/ask/add-follow-up + a history drawer.
- Active gap cards `.lite-gap-card` (from `selectGapsActive`) — two panes: claim ("what the files say") vs evidence ("what the signals show"), both verbatim project fields [CloserLookScreen.tsx:79-92, gapDerive.ts:33-60].
  - `.lite-gap-project-link` — `openDetail('project', gap.projectId)` [CloserLookScreen.tsx:94-100].
  - `.lite-gap-resolve` — `resolveGap(id)` (→ history) [CloserLookScreen.tsx:106-108].
  - `.lite-gap-dismiss` — `dismissGap(id)` (→ history) [CloserLookScreen.tsx:109-111].
  - `.lite-gap-ask` "ask about this" — `setComposerDraft(projectTitle — claim — evidence)` + `goScreen('room')` (prefill, no auto-submit; no blame wording) [CloserLookScreen.tsx:112-114, :44-53].
  - `.lite-gap-addfollowup` — `addFollowup({source:'closer-look'})`; disables + "Added" after click [CloserLookScreen.tsx:115-122, :55-67].
- Empty state when no active gaps [CloserLookScreen.tsx:127-132].
- History drawer `.lite-gap-history-toggle` (resolved + dismissed count) — each history item has a `.lite-gap-restore` button `restoreGap(id)` [CloserLookScreen.tsx:134-182].

---

## NotesScreen.tsx — "Avery's notes"
**Purpose:** Read-only, cross-session log of agent-written observations, grouped by day, collapsible. Zero input controls; the only clickable element per note is a "source" link back to the room.
- On mount / contextId change: `refreshNotes()` (safe no-op without contextId) [NotesScreen.tsx:131-133].
- Day-group collapse header `.lite-notes-group-head` (aria-expanded) — toggles open; today's group defaults open, older default collapsed [NotesScreen.tsx:88-121, :161].
- Per note (`NoteEntry`): time + text (display-only) + optional `.lite-notes-entry-source` button — `onClick=goScreen('room')` [NotesScreen.tsx:66-84].
- Header: eyebrow/title/lede + a persistent red-line trust note + count-since line [NotesScreen.tsx:145-154].
- Empty state: `.lite-notes-empty-cta` button — `goScreen('room')` [NotesScreen.tsx:167-179].

## PlaybooksScreen.tsx (+ onboardStore) — "Playbooks"
**Purpose:** Honest coming-soon / empty screen. If onboarding finished with picks, the slot region reflects the chosen playbooks; otherwise it shows 3 generic placeholder slots. No data actions.
- Reads `onboardStatus`, `picks`, `company` from onboardStore (no writes here) [PlaybooksScreen.tsx:18-27].
- If onboarding done + picks: chosen slot list (`data-playbook-id`) with title + one-line body, tagged "coming" [PlaybooksScreen.tsx:42-60].
- Else: fallback 3 placeholder slots (roster/incident/pack) [PlaybooksScreen.tsx:61-76].
- Static coming-soon line; optional company line. **No buttons/inputs — purely presentational.** [PlaybooksScreen.tsx:36-40, :78].

## VisionScreen.tsx — "Where this goes"
**Purpose:** Static positioning narrative (3 beats) + capability-boundary mock cards (4, each honestly tagged preview/coming/mock). No live data, no ingest/advise dependency, no interactive controls.
- 3 narrative beats (now / real / proof) — proof beat renders a bullet list; display-only [VisionScreen.tsx:19-39, :83-103].
- 4 mock cards (files/skills/loop/gate) — each with an honest tag; the gate card includes a single example person (name + role only, zero numbers) [VisionScreen.tsx:43-70, :114-132].
- No buttons, no inputs — the whole screen is read-only marketing/education surface [VisionScreen.tsx:72-138].

---

## AskCard.tsx (+ store Ask actions, transport Ask endpoints) — Quick ask card (in The room)
**Purpose:** The second artifact card in the room. Agent drafts a 1–3 question "Quick ask" (scale / yes-no) aimed at named recipients; the manager edits it, confirms (server red-line gate) to generate one link per recipient, refreshes to collect receipts, and views results. Trigger: appears in RoomScreen when `store.ask` is set (born from a `manifest{kind:'ask-draft'}` stream frame).
- Draft state controls [AskCard.tsx:128-217]:
  - Per-question text `<input>` — `editAskQuestion(id, text)` [AskCard.tsx:138-144, store.ts:250-259].
  - `.ask-q-remove` (×) — `removeAskQuestion(id)` (disabled at 1 question) [AskCard.tsx:145-153, store.ts:277-281].
  - `.ask-q-add` scale / yes-no buttons — `addAskQuestion(kind)` (disabled at 3) [AskCard.tsx:156-176, store.ts:261-275].
  - Recipient chips `.ask-recipient-chip` (roster from live team, else draft's own) — `toggleAskRecipient(id, name)` [AskCard.tsx:185-204, store.ts:283-295].
  - `.ask-confirm` — `confirmAsk()`: `saveAsk` (server red-line) then `shareAsk` (one link per recipient); disabled unless ≥1 recipient, ≥1 non-empty question, not busy [AskCard.tsx:206-215, :63-68, store.ts:297-315].
- Shared/collecting state [AskCard.tsx:219-248]:
  - Per-recipient link row: recipient name + `<code>` link + `.ask-copy-btn` (clipboard, falls back to execCommand) [AskCard.tsx:222-236, :70-90].
  - `.ask-refresh` — `refreshAsk()` (pull latest status/receipts; no push) [AskCard.tsx:237-247, store.ts:317-328].
- Closed state [AskCard.tsx:250-299]:
  - Single recipient → one detailed receipt (value/yes-no + self-reported label + verbatim comment + timestamp) [AskCard.tsx:252-288].
  - Multiple recipients → only a qualitative `receipts_summary` block (no per-person score table exists in the component tree — structural red line) [AskCard.tsx:289-297].
- Revoked / expired states → a single status note only; edit + link regions structurally not rendered [AskCard.tsx:52-53, :304-305].
- Error → generic error line [AskCard.tsx:307].

## LiteAdviceCard.tsx (+ flowStore) — the 8-field "read" card (in The room)
**Purpose:** Renders the structured advice (summary, signals, hypotheses, evidence, confidence, actions, script, metrics, escalation). Trigger: RoomScreen when `run.advice` present.
- Mostly display; the only interactive controls:
  - Per recommended-action `.lite-advice-add-followup` button — `addFollowup({source:'room', dueGroup:'today'})`; disables + "Added" after click [LiteAdviceCard.tsx:126-138, :22-29].
  - `<details>` disclosures for "what would change it" and "what to watch" (native collapse) [LiteAdviceCard.tsx:99-112, :150-164].
- No person scores anywhere; escalation shown as a badge + note + confirm-with chips (plain text) [LiteAdviceCard.tsx:166-186].

## LiteBell.tsx (+ notifyStore) — notification bell (in topbar)
**Purpose:** Shows event-driven notifications (real events only, zero seeded fakes) with an unread badge; clicking an item marks read + navigates to the relevant tab.
- `.lite-bell-toggle` button — `toggleOpen()`; shows unread count badge when >0 [LiteBell.tsx:52-77, :46].
- Popover: `.lite-bell-markall` — `markAllRead()` [LiteBell.tsx:83-87].
- Each `.lite-notif-item` — `onClick`: `markRead(id)` + `goScreen(NOTIF_TARGET[kind])` + `closePop()`. Targets: ingest→team, run→room, ask→room, gap→closerlook [LiteBell.tsx:93-110, notifyStore.ts:34-39].
- Empty state: honest "real events land here" note (no fake items) [LiteBell.tsx:89-91].
- Copy is generalized per kind (never names an employee) [LiteBell.tsx:23-34].

Notification triggers (notifyStore.initNotifications subscribes to the lite store) [notifyStore.ts:163-198]:
- ingest ready (ingesting→ready), run complete (running→complete), ask closed (dedup by ask.id), new gap card (deriveGaps finds unseen gap id, dedup by id). All persisted to localStorage `lite2:notify:v1` [notifyStore.ts:21, :74-88].

## DetailOverlay.tsx — read-only person/project overlay
**Purpose:** Thin read-only overlay opened from person/project cards (and from triage/gap "open" links). Shows qualitative facts only for people; projects may show progress %.
- Trigger: `openDetail(kind, id)` sets `detail`; Lite2App mounts overlay [store.ts:138, Lite2App.tsx:61].
- `.lite-detail-backdrop` + `.lite-detail-close` buttons — `closeDetail()`; also Escape key closes [DetailOverlay.tsx:42-51, :22-28].
- Person view: avatar + role/team + tenure + owns list + collaboration list; **no numbers** [DetailOverlay.tsx:53-95].
- Project view: status/owner/due + summary + optional progress% + blockers list [DetailOverlay.tsx:97-135].
- Signals section (from rawTeam.signals matching id) + source-files chips [DetailOverlay.tsx:144-166].
- Race fallback: calm "gone" note instead of "Unknown" [DetailOverlay.tsx:137-142].

## OnboardWizard.tsx (+ onboardStore) — first-visit onboarding
**Purpose:** A real multi-step (4-step) modal wizard, NOT a lightweight nudge. Overlay (not a route), auto-opens on first visit; can skip (never again) or × / Escape (pause; resumes at remembered step next visit).
- Header: step dots + `.lite-onboard-close` (×) → `pause()`; Escape also pauses [OnboardWizard.tsx:82-102, :55-61].
- Footer nav: `.lite-onboard-skip` → `skip()`; `.lite-onboard-back` → previous step; `.lite-onboard-next` → next step; on last step `.lite-onboard-finish` → `finish()` [OnboardWizard.tsx:116-140, :63-71].
- Step 1 "upload": hidden file input + `.lite-onboard-upload-choose` → real `store.uploadFiles` (same ingest path as UploadPanel); live status text [OnboardWizard.tsx:147-198].
- Step 2 "team": company / dept / your-name `<input>`s → `setField` (local config, persisted; feeds greeting) [OnboardWizard.tsx:201-247].
- Step 3 "playbooks": 8 catalog buttons `.lite-onboard-playbook` (default 3 checked) → `togglePlaybook(id)` (persisted; drives Playbooks screen slots) [OnboardWizard.tsx:250-280, onboardStore.ts:32-44].
- Step 4 "done": greeting + chosen-playbooks summary list (display-only) [OnboardWizard.tsx:283-318].
- Lifecycle: unseen→in-progress on mount; skipped/done persist to `lite2:onboard:v1` and never re-open [onboardStore.ts:16-18, :127-170, OnboardWizard.tsx:46-49].

---

## draftLinks.ts — "draft message" precise behavior
**Purpose:** Builds `mailto:` deep links only. There is NO in-app message-draft box/popup anywhere in lite2.

> 🔴 **07-19 更正**: the second sentence is obsolete. **feat-058 shipped `src/lite2/DraftComposer.tsx`**
> — there IS an in-app draft box now. This entry was one of the gaps the diff flagged; it has
> been closed. The `mailto:` behaviour described below is still accurate as far as it goes.
- `buildMailto(subject, body)` → returns `mailto:?subject=...&body=...` string (recipient deliberately blank — roster holds real names, not real emails) [draftLinks.ts:8-12].
- `draftMailForHandoff(handoff)` — subject=action, body=evidence + tag [draftLinks.ts:14-18].
- `draftMailForFollowup(item)` — subject=title, body=note or title [draftLinks.ts:20-24].
- Consumers: TeamScreen triage `.lite-triage-draftmail` `<a>` and FollowupsScreen `.lite-followup-mail` `<a>`. Clicking an `<a href="mailto:...">` hands off to the OS default mail client — it opens NO in-app draft UI, and does not build any other link type [TeamScreen.tsx:227-229, FollowupsScreen.tsx:162-164].

---

## SKINS — skin.ts + skin-paper.css / skin-aurora.css

> 🔴 **07-19 更正 · renamed, and the old name fails silently.**
> feat-068 renamed this whole layer: **`skin.ts` → `look.ts`**, **`?skin=` → `?look=`**,
> **`data-skin` → `data-look`**, `skin-*.css` → `look-*.css`. Reason: it collided with
> ADR-0021's `Skin`. Every `skin` token in this section (and in the Navigation section below)
> should be read as `look`.
>
> ⚠️ **The old `?skin=` is deliberately NOT aliased** — `look.ts` logs a loud `console.error`
> but still renders the default `paper`. Consequence worth spelling out: **`?skin=aurora`
> now silently renders paper**, so any old script, checklist, or gate still using `?skin=aurora`
> **passes while testing the wrong look** — a false pass, not a visible failure.
> `?skin=paper` happens to equal the default, so it looks correct and hides the problem.

**Purpose:** `?skin=paper|aurora` chooses a CSS-custom-property token table applied via `.lite2-shell[data-skin="..."]`. Resolved once at mount (URL only; live switch = full page reload) [skin.ts:22-33, Lite2App.tsx:32].
- Default = **paper** (warm-paper editorial: cream bg `#f7f4ee`, ink `#1d1b17`, sage/honey/terracotta earth tones, 16px base, 8px radius) — byte-for-byte the existing look, zero visual regression [skin-paper.css:8-40].
- **aurora** = glassmorphism (aurora gradient bg violet/cyan radial + 135deg, glass surfaces `rgba(255,255,255,.82)` + `blur(20px) saturate(1.1)`, blue/purple/orange/red palette, 15px base, 10px radius, violet shadows) [skin-aurora.css:17-60].
- Difference is **visual only, not behavioral**: same DOM, same components, same interactions. Skin only remaps CSS tokens (~80%) plus a small set of `[data-skin="aurora"]` component-level style branches (badge-vs-left-bar, glass chrome, headings, tag colors) — all cosmetic; no JS branch, no extra/removed controls [skin-aurora.css:107-225]. Red line holds in both skins (person cards render zero numbers regardless of skin).

---

## Navigation & shell

> 🔴 **07-19 更正 · this whole subsection was invalidated by feat-051.**
> There **is** a client-side router and there **are** URLs per screen: `<BrowserRouter>` in
> `Lite2App.tsx`, one `<Route>` per screen, plus deep links `/team/:personId` and
> `/projects/:projectId`. Screen count is **9**, not 7 (`/projects` feat-055, `/home` feat-057),
> and **`/home` is the default landing route**. The URL-params bullet at the end of this
> subsection is also stale: **`?skin=` is now `?look=`** (old name silently falls back to
> `paper` — see the SKINS correction above), and `?v=` now defaults to **v02**, not v01.
> Everything below is retained as the `1833d97` snapshot.

- **Model:** no client-side router / no URLs per screen. Navigation is Zustand state `screen` on the lite store; `goScreen(screen)` sets it (and clears `detail` + `noteJustAdded`) [store.ts:39-47, :87, :137].
- **Only navigation surface = the topbar's 7 tab buttons** (LiteTopbar). There is NO footer navigation (the footer is a static compliance disclaimer) and no side nav [LiteTopbar.tsx:41-50, Lite2Footer.tsx:9-11].
- All 7 screens are reachable via tabs: team, room, followups, notes, closerlook, playbooks, vision [LiteTopbar.tsx:23-31, Lite2App.tsx:44-60].
- Secondary in-app navigation (also calls `goScreen`): notification bell items (→ team/room/closerlook) [LiteBell.tsx:102, notifyStore.ts:34-39]; triage/gap "take to the room / ask" (→ room, with composer prefill) [TeamScreen.tsx:137, CloserLookScreen.tsx:52]; LiteComposer submit (→ room) [LiteComposer.tsx:82]; room notes-nudge (→ notes) [RoomScreen.tsx:167]; notes source link + empty CTA (→ room) [NotesScreen.tsx:77, :175].
- Detail overlay and onboarding wizard are overlays (not screens): gated by `detail` and `selectWizardOpen` [Lite2App.tsx:61-62].
- URL params consumed: `?skin=paper|aurora` (skin.ts), `?transport=stub` (stubTransport.ts:368-377), `?modeSwitch=1` (mode switch visibility, LiteTopbar.tsx:56), `?mode=` (shared modeStore). None change which screen renders.

## Backend wiring
Transport interface `LiveTransport` is injectable; default is real HTTP (`createHttpTransport`), or a deterministic offline `createStubTransport` when `?transport=stub` [transport.ts:205-232, stubTransport.ts:368-377]. Base URL `VITE_AVERY_API_BASE` or `http://127.0.0.1:8137` [transport.ts:235-239]. Owner-token is header-only (`X-Avery-Token`), never in URLs; stored per context in localStorage `lite2:ownerTokens:v1` [transport.ts:247-283].

Endpoints by action:
- **Upload / ingest** — UploadPanel + OnboardWizard step 1 → `store.uploadFiles` → `transport.ingest(files)` = `POST /ingest` (multipart); returns context_id + team payload + owner_token [store.ts:144-165, transport.ts:340-349].
- **Team refresh** — `store.refreshTeam` → `GET /team/{contextId}` (auth header) [store.ts:167-177, transport.ts:351-357].
- **Files list** — `store.refreshFiles` (called after ingest/refreshTeam) → `GET /team/{contextId}/files` [store.ts:179-188, transport.ts:398-404].
- **Notes** — NotesScreen mount + after each advise run → `store.refreshNotes` / inline fetch → `GET /team/{contextId}/notes` [store.ts:190-199, :227-237, transport.ts:407-413, NotesScreen.tsx:131-133].
- **Advise (the room)** — `store.askLive` (composer/chips/prefill) → `agentSource.run` → `transport.streamAdvise` = `POST /advise` SSE (started/think/tool/observe/nudge/manifest/error) [store.ts:201-242, streamSource.ts:86-122, transport.ts:293-338].
- **Ask (Quick ask)** — `confirmAsk` → `POST /ask` (saveAsk, server red-line) + `POST /ask/{id}/share` (shareAsk); `refreshAsk` → `GET /ask/{id}` (fetchAsk). All require owner-token header (askId→context mapping) [store.ts:297-328, transport.ts:364-394].
- **Draft mail** — pure client `mailto:` link, no backend [draftLinks.ts].
- **Local-only stores (no backend, localStorage):** flowStore (triage marks, follow-ups, gap marks) `lite2:flow:v1`; notifyStore `lite2:notify:v1`; onboardStore `lite2:onboard:v1` [flowStore.ts:22, notifyStore.ts:21, onboardStore.ts:16].

Live-backend-only behavior:
- Real people/projects/briefing/handoffs/gaps only exist after a successful `/ingest` (stub provides a fixed 16-person / 2-project corpus offline) [stubTransport.ts:32-102].
- Notes/files lists require the live backend for cross-restart persistence; the stub only echoes this-session uploads and appends one deterministic note per advise run [stubTransport.ts:302-313, :255-261].
- Ask receipts collection (shared→collecting→closed with real employee replies) requires the live backend + the employee-side `/r/{token}` flow (not part of the frontend); the stub reveals one canned receipt per `fetchAsk` [stubTransport.ts:343-362].
- Follow-ups/triage/gaps/notifications/onboarding all work fully offline (localStorage), but their *content* is seeded from ingested team data (so effectively needs ingest to be meaningful).



