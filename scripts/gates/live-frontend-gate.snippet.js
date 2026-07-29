/**
 * feat-022 — live frontend gate (browser self-drive assertion bundle).
 *
 * ADR-0022 §3: the agent IS the first user. This snippet is the tracked, machine-checkable half
 * of the frontend gate; the drive protocol lives in scripts/gates/live-frontend-gate.md. An agent
 * session injects this file into the live page (preview_eval / DevTools paste) and calls the
 * phases in order; every phase returns plain JSON so the verdict can be diffed into evidence.
 *
 * BORN RED (2026-07-07 diagnosis, session-handoff §2): the live empty state leaks the scripted
 * spine, TeamComposer submits into the story machine, detail scenes resolve only fixtures.
 * feat-024 (story/lite wall) turns this green. DO NOT weaken the assertions to match today.
 *
 * Known trap: headless rAF stalls — every wait here polls the DOM (no animation frames), and
 * defuseAnimations() force-disables transitions (feat-014 evidence pattern).
 *
 * Usage (agent, in order — each returns JSON):
 *   __seedGate.defuseAnimations()
 *   __seedGate.scanStoryNouns()                                   // phase A: pre-upload empty state
 *   await __seedGate.injectSeeds([{name, b64}, ...])              // phase B: real File -> real POST /ingest
 *   __seedGate.assertTeamRendered()                               // phase C: cards grew from uploads
 *   __seedGate.scanStoryNouns()                                   // phase D: post-upload leak scan
 *   await __seedGate.openPersonDetail('Lin Qing')                 // phase E: thin detail, no fixtures
 *   __seedGate.composerCheck()                                    // phase F1: composer static (no story prefill/refs)
 *   await __seedGate.composerAskLive('Who leads design, and what do they own?')
 *                                                                 // phase F2: askLive dynamic — SSE events to frames
 *                                                                 // (real backend run, ~1-3 min on M3; added S2/feat-024)
 *   await __seedGate.assertTeamGrouped()                          // phase G: People lane = collapsible groups (feat-025)
 *   await __seedGate.assertRoomCanvas()                           // phase H: room pan/zoom canvas (call AFTER askLive)
 *   await __seedGate.assertPlaybooksEmpty()                       // phase I: Playbooks honest empty state
 *   await __seedGate.assertVisionSurface()                        // phase J: Vision surface — narrative + labeled mock
 *   __seedGate.verdict()                                          // aggregate (10 phases)
 *
 * feat-034 stage B — Ask (Quick ask) card phases, SEPARATE aggregate (askVerdict below).
 * Driven with `?mode=live&transport=stub` (deterministic LiveTransport stub) until the ask
 * backend (stage C) exists; then re-run against the real service. Run AFTER composerAskLive
 * (the stub advise stream carries a manifest{kind:'ask-draft'}):
 *   await __seedGate.assertAskDraft()          // K1: card mounts draft, verbatim edit works, 1..3 add/remove
 *   await __seedGate.assertAskShare()          // K2: confirm -> links == recipients, host avery.ima-read.com
 *   await __seedGate.assertAskCollect(2)       // K3: pull-refresh -> partial chip -> closed
 *   __seedGate.assertAskReceipts('multi')      // K4: qualitative summary, NO cross-person score rows
 *   (re-run composerAskLive -> fresh draft)
 *   await __seedGate.assertAskSingleFlow()     // K5: deselect to 1 recipient -> link -> receipt w/ self-reported
 *   await __seedGate.assertAskRedline()        // K6: whole-DOM — person cards zero numbers, no score tables, story nouns 0
 *   __seedGate.askVerdict()                    // aggregate (6 ask phases)
 *
 * feat-068 (v02-align) — the paper|aurora switch this gate drives was renamed from the old `skin`
 * query param / DOM attribute to `?look=` / `data-look` (`Skin` is now exclusively ADR-0021's
 * industry visual theme; the two
 * aesthetic faces of Lite2 are a `Look`). URLs and DOM attributes below are updated. The gate's
 * OWN identifiers (readSkinSnapshot / assertSkinTokens / skinTokens / skinVerdict / skinNoLeak /
 * skinAttr) are deliberately NOT renamed: those phase keys are quoted verbatim in already-recorded
 * feature_list.json evidence, and renaming them would orphan that traceability. Read them as
 * legacy names for the Look phases.
 *
 * feat-035 (lite-live-v02) — v2 shell + look infra phases, SEPARATE aggregate (v2Verdict below,
 * phase group A). GATE-FIRST: written and run red BEFORE the v02 shell existed (no .lite2-shell
 * anywhere, no `?v=` switch) — feat-035's implementation turns this green. Driven with
 * `?transport=stub` (deterministic, offline — no real backend). Spans THREE page loads plus one
 * external lint run; the driver re-injects this snippet each navigation and carries JSON forward
 * (full protocol: scripts/gates/live-frontend-gate.md):
 *   [on `?v=2&mode=live&transport=stub&look=paper`]
 *   __seedGate.defuseAnimations()
 *   await __seedGate.assertV2Boots()                              // v2Boots: .lite2-shell + 8 tabs, PRD
 *                                                                // order (feat-057 prepended "Today")
 *   const before = __seedGate.readSkinSnapshot()
 *   [navigate to `?v=2&mode=live&transport=stub&look=aurora`, re-inject snippet]
 *   const after = __seedGate.readSkinSnapshot()
 *   __seedGate.assertSkinTokens(before, after)                    // skinTokens: data-look + computed value both change
 *   [on `?v=1&mode=live&transport=stub` — 🔴 2026-07-19: `?v=1` is now REQUIRED here. The bare
 *    URL used to mean v01; Danny's ruling ① flipped resolveVersion()'s default to '2', so the
 *    bare URL now renders v02 and this phase would assert v02 against itself. Re-run the
 *    existing 10-phase gate here first (phases A-J above), take its verdict().pass, THEN:]
 *   __seedGate.assertV1Untouched(verdictResult.pass)               // v1Untouched: 0 .lite2-shell + v01 10-phase pass
 *   [on `?mode=story`]
 *   __seedGate.assertStoryUntouched()                              // storyUntouched: 0 .lite2-shell
 *   [outside the browser: npm run lint with each of the 4 new wall directions violated in turn,
 *    expect exit 1, revert, expect exit 0 — see live-frontend-gate.md for the exact injections]
 *   __seedGate.recordWallRed({ pass: true, directions: {...} })    // wallRed: lint red-then-green evidence
 *   __seedGate.v2Verdict()                                         // aggregate (5 phases)
 *
 * feat-036 (lite-live-v02, ADR-0017 execution) — morning triage + Follow-ups phases, SEPARATE
 * aggregate (flowVerdict below, phase group B). BORN RED (2026-07-14, before implementation):
 * no `.lite-triage-room` / `.lite-followup-item` anywhere — TeamScreen's handoff list has no
 * done/discard buttons wired to a real mark store, Follow-ups is still the coming-soon
 * placeholder. Driven with `?v=2&mode=live&transport=stub` (same deterministic lite2 stub used
 * by v2Verdict). Reuses the shared `.home-handoff` / `.home-check` / `.home-discard` /
 * `.home-drawer*` DOM contract from the v01 Card-home pattern (src/shared/styles/70-home-cards.css)
 * — feat-036 wires those SAME classes to a real localStorage-backed store instead of adding a
 * parallel visual language:
 *   [on `?v=2&mode=live&transport=stub`]
 *   __seedGate.defuseAnimations()
 *   await __seedGate.injectSeeds([{name, b64}])      // REQUIRED FIRST — the stub transport does
 *                                                    // NOT auto-populate: on a fresh load
 *                                                    // team===null / ingestStatus==='idle', so
 *                                                    // every derived surface below is honestly
 *                                                    // empty and all four phases go red. Any file
 *                                                    // works (stub returns its canned corpus
 *                                                    // regardless of bytes). Since feat-045 a
 *                                                    // first visit also mounts the onboarding
 *                                                    // wizard — dismiss it (skip control) so it
 *                                                    // cannot overlay the surfaces under test.
 *                                                    // Same prerequisite applies to groups C and
 *                                                    // F's stub phases (added 2026-07-15 — the
 *                                                    // Playwright driver hit a full false-red
 *                                                    // block following this protocol literally).
 *   await __seedGate.assertTriageRenders()          // triageRenders: >=1 derived card, zero
 *                                                    // person-number leak in the triage DOM
 *   await __seedGate.assertTriageActions()           // triageActions: done -> drawer + count
 *                                                    // drop; discard -> disappears; take-to-
 *                                                    // room -> screen switches + composer
 *                                                    // pre-filled (all three re-use the FIRST
 *                                                    // stub card by DOM order via restore-
 *                                                    // between-steps — as of feat-044 the stub
 *                                                    // corpus carries a SECOND blocker-bearing
 *                                                    // project too (pr_portal, on-track but
 *                                                    // blocked — the deliberate self-report/
 *                                                    // signal mismatch feat-044's gap cards
 *                                                    // derive from), so this now honestly
 *                                                    // yields two triage cards; this phase
 *                                                    // still targets only the first (pr_pilot's)
 *   await __seedGate.assertFollowupsFlow()            // followupsFlow: triage "add to
 *                                                    // follow-ups" -> Follow-ups tab shows the
 *                                                    // NEW item (tracked by data-followup-id,
 *                                                    // residue-proof) with the EXACT triage
 *                                                    // source label -> check done -> lands in
 *                                                    // History -> restore -> back in active
 *   const before = await __seedGate.snapshotFollowups() // helper: titles in active + history
 *   [reload the SAME url, re-inject snippet]
 *   await __seedGate.assertFollowupsPersist(before)  // followupsPersist: after reload, every
 *                                                    // title from `before` is still present
 *                                                    // (localStorage, not in-memory only)
 *   __seedGate.flowVerdict()                         // aggregate (4 phases)
 *
 * feat-044 (lite-live-v02, PRD F4 / decisions.md 拍板#4) — "A closer look" comparison-card
 * phases, SEPARATE aggregate (gapVerdict below, phase group C). BORN RED (2026-07-14, before
 * implementation): no `.lite-gap-card` anywhere — CloserLookScreen is still the feat-035
 * coming-soon placeholder. Driven with `?v=2&mode=live&transport=stub`. The stub corpus
 * (src/lite2/stubTransport.ts) carries exactly ONE genuine self-report/signal mismatch
 * (pr_portal: status reads on-track, but a blocker says otherwise) — gapDerive.ts (pure
 * function, LiteTeam -> GapCard[]) surfaces it as one comparison card; pr_pilot is NOT a gap
 * (its own status already says at-risk, so its blocker is consistent, not a contradiction):
 *   [on `?v=2&mode=live&transport=stub`]
 *   __seedGate.defuseAnimations()
 *   await __seedGate.assertGapsDerive()              // gapsDerive: >=1 derived comparison card
 *                                                    // (claim pane + evidence pane + resolve/
 *                                                    // dismiss/ask/add-followup controls all
 *                                                    // present); whole-screen scan = zero
 *                                                    // "gap"/"Nexus"/"差距"/"现实差距" text;
 *                                                    // zero person-name+digit co-occurrence
 *                                                    // (reuses the Ask redline's _askValueRe
 *                                                    // against the FULL team roster, collected
 *                                                    // from Your team first — screens are
 *                                                    // mutually-exclusive mounts)
 *   await __seedGate.assertGapsResolve()              // gapsResolve: resolve -> leaves active,
 *                                                    // lands in the collapsible history section
 *                                                    // with a "Settled"-shape badge, restorable;
 *                                                    // dismiss -> same shape with a DIFFERENT
 *                                                    // badge (both sub-checks reuse the SAME
 *                                                    // single stub-derived card, restored
 *                                                    // between steps — same pattern as
 *                                                    // assertTriageActions); both marks
 *                                                    // confirmed written into the SAME
 *                                                    // `lite2:flow:v1` localStorage blob
 *                                                    // flowStore.ts already reload-proved via
 *                                                    // followupsPersist (feat-043) — same
 *                                                    // save/load code path, extended with a
 *                                                    // `gapMarks` field
 *   await __seedGate.assertGapsToAsk()                // gapsToAsk: a card's "Ask them directly"
 *                                                    // -> screen switches to The room with the
 *                                                    // composer pre-filled with that card's
 *                                                    // project title + claim/evidence context
 *                                                    // (not auto-submitted)
 *   __seedGate.gapVerdict()                          // aggregate (3 phases)
 *
 * feat-045 (lite-live-v02, PRD F5+F7 / decisions.md 拍板#1) — onboarding wizard + suggestion
 * chips + notification bell, SEPARATE aggregate (nudgeVerdict below, phase group D — same
 * per-group-aggregate convention flowVerdict/gapVerdict established for groups B/C). BORN RED
 * (2026-07-14, before implementation): no `.lite-onboard` / `.lite-room-chip` / `.lite-bell`
 * anywhere. Driven with `?v=2&mode=live&transport=stub`. Spans SIX page loads (first-visit
 * detection = localStorage state, so the driver clears every `lite2:*` key and reloads between
 * runs); like the A-group phases, cross-navigation evidence is carried by the driver as JSON and
 * fed into nudgeVerdict(carried) at the end:
 *   A) [clear ALL localStorage keys starting `lite2:` -> load ?v=2&mode=live&transport=stub,
 *       inject, defuseAnimations()]
 *      const walk = await __seedGate.onboardWalkthrough()   // helper: wizard appears on a clean
 *                                                    // first visit; REAL upload through the
 *                                                    // wizard's own file input (store.uploadFiles
 *                                                    // -> stub ingest -> ready marker); team-info
 *                                                    // step filled; playbook selection CHANGED
 *                                                    // from the default set (one default off, two
 *                                                    // non-defaults on); done-step summary lists
 *                                                    // exactly the chosen ids; finish closes it
 *   B) [reload the SAME url, re-inject]
 *      await __seedGate.assertOnboardPersist(walk)   // onboardPersist: wizard does NOT re-appear;
 *                                                    // Playbooks tab renders slots whose
 *                                                    // data-playbook-id set EXACTLY equals the
 *                                                    // chosen set (specific ids, not a count),
 *                                                    // every slot carrying the honest Coming tag
 *   C) [clear ALL `lite2:` keys again -> reload, re-inject]
 *      await __seedGate.assertOnboardEscape()        // onboardEscape (added on adversarial-verify
 *                                                    // rework, 2026-07-14: an aria-modal dialog
 *                                                    // MUST be keyboard-escapable — keyboard
 *                                                    // users were trapped): wizard mounts fresh;
 *                                                    // advance one step; Escape closes the
 *                                                    // overlay with PAUSE semantics — persisted
 *                                                    // status stays 'in-progress' (NOT skipped/
 *                                                    // done) and the advanced step is preserved
 *                                                    // for resume next visit
 *   D) [reload, re-inject — the wizard RESUMES at the saved step (pause is not dismissal):]
 *      const skip = await __seedGate.onboardSkipNow() // helper: wizard appears again; the skip
 *                                                    // control closes it
 *   E) [reload, re-inject]
 *      await __seedGate.assertOnboardSkip(skip)      // onboardSkip: after the reload the wizard
 *                                                    // never mounts again (no nagging)
 *      await __seedGate.assertChipsAsk()             // chipsAsk: The room's empty state renders
 *                                                    // exactly 4 suggestion chips (distinct
 *                                                    // data-chip-id, non-empty copy); clicking one
 *                                                    // fires a REAL askLive run — the terminal
 *                                                    // mounts and SSE frames render (same dynamic
 *                                                    // shape as phase F2), not a dead button
 *   F) [clear ALL `lite2:` keys on a SETTLED page — wait for chipsAsk's run to finish first: a
 *       notification push from a still-streaming run re-writes lite2:notify:v1 AFTER the clear
 *       (caught live on the first green drive, 2026-07-14) — then reload, re-inject]
 *      await __seedGate.assertBellIsReal()           // bellIsReal: (skips the fresh wizard first)
 *                                                    // bell opens on a cleared state with ZERO
 *                                                    // notification items and an explicit empty
 *                                                    // marker (no placeholder fakes); a stub
 *                                                    // ingest then yields EXACTLY one 'ingest'
 *                                                    // item plus one 'gap' item (the stub corpus
 *                                                    // honestly contains ONE contradiction —
 *                                                    // pr_portal — so the new-gap event fires
 *                                                    // too; exact event-type multiset, not
 *                                                    // count>0); a composer-driven run then adds
 *                                                    // EXACTLY one 'run' item (final multiset
 *                                                    // gap+ingest+run and nothing else); clicking
 *                                                    // the 'gap' notification ROUTES to the
 *                                                    // mapped tab (A closer look) and marks that
 *                                                    // item read (NOTIF_TARGET wiring — coverage
 *                                                    // added on adversarial-verify rework); the
 *                                                    // unread badge shows and mark-all clears it
 *      __seedGate.nudgeVerdict({ onboardPersist, onboardEscape, onboardSkip, chipsAsk })
 *                                                    // aggregate (5 phases) — pass the JSON
 *                                                    // carried from pages B/C/E for the phases
 *                                                    // that ran before this page load
 *
 * feat-046 (lite-live-v02, kickoff-dev.md §feat-046 / decisions.md 终盘形态) — aurora look polish
 * pass, SEPARATE aggregate (skinVerdict below, phase group E). BORN RED (2026-07-14, before
 * implementation, on the feat-042..045 rough-draft tokens): `readSkinProbe()`'s computed values on
 * `?look=aurora` did NOT yet hit the target shape (glass was still cream-tinted rgba(255,253,248,…)
 * not white, shadows were ink-tinted not violet, density/radius/badge tokens did not exist yet) —
 * `assertAuroraApplied()` failed several of its >=8 sub-checks. `PAPER_BASELINE` below is a REAL
 * computed-value snapshot captured live (this session, on `integrate/v02-main-sync`@feff6be, BEFORE
 * any feat-046 CSS edit) — not a guess; `assertPaperUnchanged()` diffs the CURRENT paper probe
 * against these exact literal strings, so any future edit that nudges a paper pixel — even one this
 * look pass didn't intend — goes red. Pure-visual scope: zero DOM structural change (two authorized
 * functional exceptions carried on this branch: DetailOverlay Escape-to-close, onboarding wizard
 * backdrop switched from a hardcoded warm rgba to consuming `--lite2-ink-rgb`). Driven with
 * `?transport=stub`. `readSkinProbe()` clicks through Your team + Playbooks internally (both are
 * needed to read `.upload-panel` and `.lite-playbooks-slot-tag`) and returns to Your team when done
 * — call it fresh on each of the three URLs below:
 *   [on `?v=2&mode=live&transport=stub&look=aurora`]
 *   __seedGate.defuseAnimations()
 *   const auroraProbe = await __seedGate.readSkinProbe()
 *   __seedGate.assertAuroraApplied(auroraProbe)        // auroraApplied: >=8 independently-checked
 *                                                       // computed values (11 in practice) — bg
 *                                                       // radial-gradient contains the aurora violet
 *                                                       // stop, glass chrome (.scene-tabs/.mode-
 *                                                       // switch/.lite2-compliance-footer) computes
 *                                                       // to white-tinted rgba (not paper's cream),
 *                                                       // blur(20px)+saturate, box-shadow carries the
 *                                                       // violet rgba(36,32,95,…) stop, active tab
 *                                                       // background is the aurora navy #10223d,
 *                                                       // shell font-size is the 15px density
 *                                                       // baseline, .upload-panel border-radius is
 *                                                       // the bumped 10px, .lite-playbooks-slot-tag
 *                                                       // reads as a real blue-soft badge (not the
 *                                                       // flat gray chip)
 *   [on `?v=2&mode=live&transport=stub&look=paper`]
 *   const paperProbe = await __seedGate.readSkinProbe()
 *   __seedGate.assertPaperUnchanged(paperProbe)        // paperUnchanged: every field in paperProbe
 *                                                       // byte-equal to the PAPER_BASELINE constant
 *                                                       // captured pre-implementation (see above)
 *   [on `?v=1&mode=live&transport=stub` — 🔴 2026-07-19: was "default URL (no v=)"; the bare URL
 *    is v02 now (ruling ①), so v01 must be named explicitly or this probe leaks-tests v02]
 *   const defaultLeak = __seedGate.readLeakProbe()
 *   [on `?mode=story`]
 *   const storyLeak = __seedGate.readLeakProbe()
 *   __seedGate.assertSkinNoLeak(defaultLeak, storyLeak) // skinNoLeak: both surfaces render ZERO
 *                                                       // .lite2-shell AND their shared `.scene-tabs`
 *                                                       // chrome still computes to the ORIGINAL
 *                                                       // shared/00-base.css value (proves
 *                                                       // `[data-look='aurora']`-scoped rules never
 *                                                       // reach outside lite2, not just "structurally
 *                                                       // can't" by inspection)
 *   __seedGate.skinVerdict({ auroraApplied, paperUnchanged, skinNoLeak })
 *                                                       // aggregate (3 phases) — pass carried JSON
 *                                                       // for whichever phases ran on earlier loads
 *
 * feat-047 (lite-live-v02, kickoff-dev.md §合流契约附录 §2 — engine sync + notes/files surfaces)
 * — SEPARATE aggregate (syncVerdict below, phase group F). Ports the src/lite engine delta
 * (owner_token storage + X-Avery-Token header discipline, fetchFiles/fetchNotes) into lite2's
 * OWN transport.ts/store.ts/stubTransport.ts (copy-then-wall — zero lite<->lite2 imports), and
 * gives v02 a 7th tab ("Avery's notes", ported from `lite`, placed after Follow-ups) plus a
 * files list inside UploadPanel. Two of the four phases run on the DETERMINISTIC stub transport
 * (`?v=2&mode=live&transport=stub`, same corpus as groups B/C/D/E); one is a pure static
 * source-level comparison (no browser needed); tokenDiscipline is the odd one out — it is the
 * ONLY phase in this whole file that requires the REAL backend (`?v=2&mode=live`, no
 * `?transport=stub`) because the entire point is proving the owner_token round-trip against a
 * real HTTP response, not a scripted stub that could fake header presence:
 *   [stub phases — on `?v=2&mode=live&transport=stub`]
 *   __seedGate.defuseAnimations()
 *   await __seedGate.assertNotesSurfaceV2()      // notesSurfaceV2: run composerAskLive-equivalent
 *                                                 // (a stub askLive call) first so a note has
 *                                                 // landed, THEN click "Avery's notes" — trust
 *                                                 // note present, entries read-only, zero number
 *                                                 // leak, story-noun blacklist 0; an empty
 *                                                 // notebook (no run yet) is tolerated too
 *   await __seedGate.assertFilesSurfaceV2()       // filesSurfaceV2: after a stub ingest, Your
 *                                                 // team's UploadPanel renders `.upload-files`
 *                                                 // with one row per uploaded file — filename +
 *                                                 // formatted size + n_chunks (the ACTUAL ported
 *                                                 // LiveFileEntry contract has no `status` field
 *                                                 // and no download URL — src/lite's real UI
 *                                                 // doesn't render either, so this phase checks
 *                                                 // what's actually renderable, not an invented
 *                                                 // shape; see progress.md Notes for the
 *                                                 // documented deviation from the task brief's
 *                                                 // "status/download entry" wording)
 *   [outside the browser: run `node scripts/gates/engine-par-check.mjs` — a pure static diff of
 *    src/lite/transport.ts vs src/lite2/transport.ts restricted to the feat-047 SCOPED delta
 *    (owner_token storage shape, OWNER_TOKEN_HEADER constant, which methods thread authHeader()
 *    into their fetch calls) — NOT full byte-parity (lite2 intentionally does not carry lite's
 *    later Ask-stage-C revoke/offlinePreview/expired-status additions; those are a separate,
 *    unscoped feature per kickoff-dev.md §合流契约附录 §2's explicit file list)]
 *   __seedGate.recordEnginePar(evidence)          // enginePar: records the script's JSON verdict
 *   [real-backend phase — on `?v=2&mode=live` (NO `?transport=stub`), real eval-harness service
 *    up (AVERY_BRAIN=minimax, port 8137), a real seed file ingested through the wizard or
 *    UploadPanel, wait for `ingestStatus==='ready'`]
 *   await __seedGate.assertTokenDiscipline()
 *                                                 // tokenDiscipline (MOST IMPORTANT — kickoff
 *                                                 // calls it out by name). Fully self-contained
 *                                                 // (no driver-supplied evidence needed): installs
 *                                                 // a `window.fetch` spy IN-PAGE (fetch is looked
 *                                                 // up on globalThis at call time, so a snippet
 *                                                 // injected after the app already loaded still
 *                                                 // intercepts every call transport.ts makes),
 *                                                 // reads the live contextId/ownerToken off
 *                                                 // `window.__lite2Store`, then: (1) confirms
 *                                                 // localStorage `lite2:ownerTokens:v1` holds the
 *                                                 // token keyed by contextId; (2) drives real
 *                                                 // refreshTeam/refreshFiles/refreshNotes calls
 *                                                 // and reads the CAPTURED request headers off the
 *                                                 // spy — every /team, /team/.../files,
 *                                                 // /team/.../notes call must carry
 *                                                 // X-Avery-Token === the real token; (3) scans
 *                                                 // both the spy log's URLs AND
 *                                                 // performance.getEntriesByType('resource') for
 *                                                 // the raw token substring — zero matches either
 *                                                 // place (header-only, never in a URL); (4) swaps
 *                                                 // the store's contextId to a bogus id (no stored
 *                                                 // token for it) and re-drives
 *                                                 // refreshFiles/refreshNotes — must not crash and
 *                                                 // must NOT populate files/notes with anything
 *                                                 // (honest empty, not fabricated); (5) fires two
 *                                                 // RAW fetches straight at the real backend
 *                                                 // (bypassing the store, so it's the BACKEND's
 *                                                 // enforcement being proven, not just "the
 *                                                 // frontend happened not to send a bad one") — a
 *                                                 // forged token and a missing-header request
 *                                                 // against the SAME real context_id must both
 *                                                 // 404
 *   __seedGate.syncVerdict()                      // aggregate (4 phases)
 */
(() => {
  // Story-EXCLUSIVE nouns. NOTE: 'Lin Qing' / 'Chen Mingyuan' / 'Sun Xiaomei' / 'Zheng Zixuan'
  // exist in BOTH the story cast and the real seed roster — they must NOT be blacklisted by name;
  // the story-copy SENTENCES around them are blacklisted instead.
  const STORY_NOUNS = [
    'Venus',                    // story audience — never in the seeds
    'Smart Shopping Guide',     // story flagship project (the REAL seed has 'Smart Shopper' —
                                // do NOT blacklist 'New Retail': the seed xlsx legitimately
                                // contains 'New Retail Smart Shopper Mini Program')
    'Kate', 'Jason', 'Cecily', 'Kenan', 'Nasim', 'Aidy', 'Fred',  // story-only cast
    // NOT bare 'Wang' — the real seed roster has 'Wang Yuxuan'; use the story copy instead:
    'Wang has it steady',
    'Client Onboarding Kit', 'Store Dashboard polish', 'Writing the playbooks',
    'Core shopping-guide flow', 'Venus Pitch', 'Prototype 2.0',
    // Lin Qing's story-card copy signature (the card text, not her name):
    'holding the Smart Shopping Guide demo',
    'a week of shifting client feedback',
  ];
  // Story people carry these numeric badges; a live person card must never render one (red line).
  const BLOOD_BAR_RE = /\b(?:mood|capacity)\s*[:%]|\b\d{1,3}\s*%/;

  // rich-align-0722/03 — the person-scoring switch made ONE number sanctioned: a self-report, and it
  // lives ONLY inside a [data-metric-source] provenance anchor. The red line is UNCHANGED — any
  // blood-bar / mood-vocab shape OUTSIDE such an anchor is still a leak. These helpers let the K6/team
  // scans fire on the OUTSIDE-of-anchor text, so they hold in BOTH worlds (off: no anchors exist at
  // all; on: numbers/mood only inside anchors). The switch state is read off the shell marker.
  const MOOD_VOCAB_RE = /如常|偏紧|吃紧|steady|stretched|strained/i;
  const scoringMarkerOn = () => {
    const shell = document.querySelector('.lite2-shell, .app-shell');
    return !!shell && shell.getAttribute('data-scoring-enabled') === 'on';
  };
  // Text of a node with every [data-metric-source] subtree pruned. Uses textContent semantics (walks
  // nodes) so it works on ATTACHED elements without a layout pass — never clone+innerText (a detached
  // clone has no layout and innerText comes back '').
  const textOutsideAnchors = (root) => {
    let out = '';
    const walk = (node) => {
      if (node.nodeType === 3) { out += node.nodeValue; return; }
      if (node.nodeType !== 1) return;
      if (node.hasAttribute && node.hasAttribute('data-metric-source')) return; // prune anchored subtree
      node.childNodes.forEach(walk);
    };
    walk(root);
    return out;
  };
  const selfReportAnchors = (cards) => {
    const els = [];
    cards.forEach((c) => els.push(...Array.from(c.querySelectorAll('[data-metric-source]'))));
    return els;
  };

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const bodyText = () => document.body.innerText || '';

  const poll = (fn, timeoutMs, label) => new Promise((resolve, reject) => {
    const t0 = Date.now();
    const tick = () => {
      let v;
      try { v = fn(); } catch (e) { /* keep polling */ }
      if (v) return resolve(v);
      if (Date.now() - t0 > timeoutMs) return reject(new Error('timeout: ' + label));
      setTimeout(tick, 250);                       // setTimeout, never rAF (headless stall)
    };
    tick();
  });

  const results = {};

  const api = {
    defuseAnimations() {
      if (!$('#__seedgate-style')) {
        const st = document.createElement('style');
        st.id = '__seedgate-style';
        st.textContent = '*,*::before,*::after{transition:none!important;animation:none!important;}';
        document.head.appendChild(st);
      }
      return { ok: true, mode: new URLSearchParams(location.search).get('mode') };
    },

    scanStoryNouns() {
      const text = bodyText();
      const hits = [];
      for (const noun of STORY_NOUNS) {
        // word-boundary for single names, plain substring for phrases
        const re = noun.includes(' ')
          ? new RegExp(noun.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
          : new RegExp('\\b' + noun + '\\b');
        const m = text.match(re);
        if (m) {
          const i = text.indexOf(m[0]);
          hits.push({ noun, context: text.slice(Math.max(0, i - 60), i + noun.length + 60).replace(/\s+/g, ' ') });
        }
      }
      const out = { storyNounHits: hits.length, hits, pass: hits.length === 0 };
      results.storyNouns = results.storyNouns || [];
      results.storyNouns.push(out);
      return out;
    },

    async injectSeeds(files) {
      // files: [{name, b64}] — real bytes into the real <input class="upload-input">.
      //
      // feat-057: in v02 the default landing is now `/home` (the aggregate entry). Its EMPTY
      // state mounts the UploadPanel, but the moment ingest succeeds `team` turns non-null and
      // Home swaps to the summary layout — the panel unmounts and the `.upload-ready` /
      // `.upload-error` markers this function polls for never appear (a 360s false red). Your
      // team renders the UploadPanel in BOTH branches, so drive the upload from there. Guarded
      // on `.lite2-shell` so the v01 phases (which have their own topbar) are untouched.
      if ($('.lite2-shell')) {
        this._clickTab('Team');
        try {
          await poll(() => ($('.upload-input') ? true : null), 4000, 'Your team upload panel to mount');
        } catch (e) { /* fall through — the null check below reports it */ }
      }
      const input = $('.upload-input');
      if (!input) return (results.inject = { pass: false, error: 'no .upload-input in DOM' });
      const dt = new DataTransfer();
      for (const f of files) {
        const bin = atob(f.b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        dt.items.add(new File([bytes], f.name, { type: 'application/octet-stream' }));
      }
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      try {
        // Wait budget (not an assertion): real LLM ingest of both seeds runs to ~200s+ (the
        // backend allows 240s per brain call), and a HIDDEN preview tab throttles setTimeout
        // ticks to ~1/min — 180s flaked on a passing upload (S2 run 4). 360s covers the
        // backend envelope + tick granularity.
        await poll(() => $('.upload-ready') || $('.upload-error'), 360000, 'ingest to settle');
      } catch (e) {
        return (results.inject = { pass: false, error: String(e) });
      }
      const err = $('.upload-error');
      const chips = $$('.upload-source-chip').map((c) => c.textContent.trim());
      results.inject = {
        pass: !err && chips.length === files.length,
        error: err ? (($('.upload-error-detail') || {}).textContent || 'ingest error') : null,
        sourceChips: chips,
      };
      return results.inject;
    },

    assertTeamRendered() {
      const cards = $$('.home-person-card');
      const names = cards.map((c) => (c.querySelector('h3') || {}).textContent || '');
      // rich-align-0722/03 — scan OUTSIDE any self-report anchor so a sanctioned self-report (scoring
      // world) is not a false leak; off-world corpora have no anchors, so this is byte-identical there.
      const text = cards.map((c) => textOutsideAnchors(c)).join('\n');
      const scoringOn = scoringMarkerOn();
      const out = {
        personCards: cards.length,
        scoringOn,
        hasLinQing: names.some((n) => /lin qing/i.test(n)),
        hasChenMingyuan: names.some((n) => /chen mingyuan/i.test(n)),
        bloodBarLeak: BLOOD_BAR_RE.test(text) ? text.match(BLOOD_BAR_RE)[0] : null,
        // off-world: NO self-report anchor may exist at all (the switch is the only thing that projects it).
        strayAnchorsOffWorld: scoringOn ? 0 : selfReportAnchors(cards).length,
        pass: false,
      };
      out.pass = cards.length >= 15 && out.hasLinQing && out.hasChenMingyuan &&
        !out.bloodBarLeak && out.strayAnchorsOffWorld === 0;
      results.team = out;
      return out;
    },

    async openPersonDetail(name) {
      const card = $$('.home-person-card').find((c) => (c.innerText || '').includes(name));
      if (!card) return (results.detail = { pass: false, error: 'no card for ' + name });
      card.click();
      let detailText = '';
      try {
        await poll(() => {
          const t = bodyText();
          return t !== '' && !$$('.home-person-card').length ? t : ($('.detail-shell, [class*="detail"]') ? t : null);
        }, 15000, 'detail to open');
        detailText = bodyText();
      } catch (e) {
        return (results.detail = { pass: false, error: String(e) });
      }
      const unknown = /unknown (teammate|project|person)/i.test(detailText);
      const out = {
        opened: true,
        unknownEntity: unknown,
        showsName: detailText.includes(name),
        pass: !unknown && detailText.includes(name),
      };
      results.detail = out;
      return out;
    },

    composerCheck() {
      // Phase F1 (static): the live composer must not carry story prefill / story references
      // (the TeamComposer leak: HERO_QUESTION prefill + fixture @-references).
      const composer = $('.composer-card');
      if (!composer) return (results.composer = { pass: false, error: 'no .composer-card' });
      const text = composer.innerText || '';
      // Main ask input first (.composer-main-row) — `input[type="text"]` alone misses inputs
      // with no explicit type attribute (caught live on the S2 gate run, 2026-07-08).
      const input = composer.querySelector('.composer-main-row input, textarea, input[type="text"]');
      const prefill = input ? (input.value || input.placeholder || '') : '';
      const storyHits = STORY_NOUNS.filter((n) => text.includes(n) || prefill.includes(n));
      const out = { prefill, storyHits, pass: storyHits.length === 0 };
      results.composer = out;
      return out;
    },

    async composerAskLive(question) {
      // Phase F2 (dynamic, added S2/feat-024): submitting the composer must drive the REAL
      // /advise SSE stream to rendered frames — not the story script machine (the diagnosed
      // TeamComposer.tsx:115 askQuestion leak). Asserts: submit -> terminal frames appear
      // (SSE events to DOM) -> manifest lands -> the 8-field card renders. Real backend, ~1-3 min.
      const q = question || 'Who leads design, and what do they own?';
      // A thin detail overlay from phase E may still be up — close it first (programmatic
      // dispatch would work through it, but keep the DOM in a user-realistic state).
      const closeBtn = $('.lite-detail-close');
      if (closeBtn) closeBtn.click();

      const composer = $('.composer-card');
      const input =
        composer && composer.querySelector('.composer-main-row input, textarea, input[type="text"]');
      const form = input ? input.closest('form') : null;
      if (!input || !form) {
        return (results.composerLive = { pass: false, error: 'no composer input/form to drive' });
      }
      // React controlled input: go through the native value setter + input event.
      const setter = Object.getOwnPropertyDescriptor(
        input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
        'value',
      ).set;
      setter.call(input, q);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      if (typeof form.requestSubmit === 'function') form.requestSubmit();
      else form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

      const liveLines = () =>
        $$('.nexus-terminal-log .terminal-line').filter((l) => !l.classList.contains('terminal-cursor-line'));
      const errorText = () => /something went wrong/i.test(bodyText());

      try {
        // 1) SSE events reach frames: at least one real terminal line renders.
        await poll(() => (liveLines().length > 0 ? true : null), 120000, 'first SSE frame to render');
        // 2) run completes: manifest line lands and the 8-field advice card is in the DOM.
        await poll(
          () => ($('.terminal-line.is-manifest') && $('.structured-output-card') ? true : null),
          240000,
          'manifest + advice card',
        );
      } catch (e) {
        results.composerLive = {
          pass: false,
          question: q,
          framesSeen: liveLines().length,
          sawManifest: !!$('.terminal-line.is-manifest'),
          adviceRendered: !!$('.structured-output-card'),
          error: String(e) + (errorText() ? ' (page shows live error state)' : ''),
        };
        return results.composerLive;
      }
      const out = {
        question: q,
        framesSeen: liveLines().length,
        sawManifest: true,
        adviceRendered: true,
        liveError: errorText(),
        pass: liveLines().length > 0 && !errorText(),
      };
      results.composerLive = out;
      return out;
    },

    // Re-derive the phase-B (ingest) result from the already-settled DOM without re-uploading.
    // Identical checks to injectSeeds' post-settle block — for driver sessions that re-inject the
    // snippet (fresh `results`) after an ingest already landed, so the aggregate verdict is honest
    // without a second ~150s real /ingest round-trip. Pass the expected source-file count.
    recordInjectFromDom(expectedCount) {
      const err = $('.upload-error');
      const ready = $('.upload-ready');
      const chips = $$('.upload-source-chip').map((c) => c.textContent.trim());
      results.inject = {
        pass: !err && !!ready && chips.length === (expectedCount || chips.length) && chips.length > 0,
        error: err ? (($('.upload-error-detail') || {}).textContent || 'ingest error') : null,
        sourceChips: chips,
        reconstructedFromDom: true,
      };
      return results.inject;
    },

    // ── feat-025 (S5) new-module phases ──────────────────────────────────────
    // Tab-nav helper: click a lite topbar .scene-tab by (case-insensitive) label.
    _clickTab(label) {
      const tab = $$('.scene-tabs .scene-tab').find(
        (b) => (b.textContent || '').trim().toLowerCase() === label.toLowerCase(),
      );
      if (tab) tab.click();
      return !!tab;
    },

    async assertTeamGrouped() {
      // Phase G (feat-025 Q2): the People lane must render as grouped, collapsible containers
      // (group blocks + group heads with titles + a toggle) — NOT a flat card grid. The person
      // cards themselves stay in the DOM and clickable (grouping only wraps them in containers).
      this._clickTab('Team');
      // React re-renders on the next tick after the tab click — poll for the grouped lane to mount.
      try {
        await poll(() => ($('.home-people-groups') ? true : null), 8000, 'grouped people lane to mount');
      } catch (e) { /* fall through — assertions below will report absence */ }
      const groups = $$('.home-people-group');
      const heads = $$('.home-people-group-head');
      const titles = $$('.home-people-group-title')
        .map((t) => (t.textContent || '').trim())
        .filter(Boolean);
      const cardsUnderGroups = $$('.home-people-group .home-person-card');
      // Collapse the first group, then re-expand, to prove the toggle actually works.
      // React re-renders on the next tick after each click — poll for the card-count change
      // rather than reading synchronously (the collapsed <div> unmounts asynchronously).
      let collapseWorks = false;
      if (heads[0]) {
        const before = $$('.home-people-group .home-person-card').length;
        const firstGroupCards = $$('.home-people-group')[0].querySelectorAll('.home-person-card').length;
        heads[0].click();
        let collapsed = before;
        try {
          collapsed = await poll(() => {
            const n = $$('.home-people-group .home-person-card').length;
            return n < before ? n : null;
          }, 4000, 'first group to collapse');
        } catch (e) { /* stays === before → collapseWorks false */ }
        heads[0].click(); // re-expand (leave DOM full for later phases)
        let restored = collapsed;
        try {
          restored = await poll(() => {
            const n = $$('.home-people-group .home-person-card').length;
            return n === before ? n : null;
          }, 4000, 'first group to re-expand');
        } catch (e) { /* stays collapsed → collapseWorks false */ }
        collapseWorks =
          collapsed === before - firstGroupCards && collapsed < before && restored === before;
      }
      const out = {
        groupContainers: groups.length,
        groupHeads: heads.length,
        groupTitles: titles.slice(0, 8),
        cardsUnderGroups: cardsUnderGroups.length,
        collapseWorks,
        // At least one titled group, cards live inside group containers, and collapse toggles.
        pass: groups.length >= 1 && heads.length >= 1 && titles.length >= 1 &&
          cardsUnderGroups.length >= 1 && collapseWorks,
      };
      results.teamGrouped = out;
      return out;
    },

    async assertRoomCanvas() {
      // Phase H (feat-025 Q3): The room must carry a thin pan/zoom canvas wrapper in the DOM,
      // holding the terminal board. react-zoom-pan-pinch renders a .react-transform-wrapper /
      // .react-transform-component under our .lite-room-canvas. The composer stays OUTSIDE it.
      // NOTE: the canvas only mounts once a run has started (hasStarted) — call this AFTER
      // composerAskLive so the terminal board exists.
      this._clickTab('Ask Avery');
      try {
        await poll(() => ($('.lite-room-canvas') ? true : null), 8000, 'room canvas to mount');
      } catch (e) { /* fall through */ }
      const canvas = $('.lite-room-canvas');
      const board = $('.lite-room-canvas .lite-room-board');
      // react-zoom-pan-pinch injects these class names (both our wrapperClass and its own).
      const transformWrapper =
        $('.lite-room-canvas .lite-panzoom-wrapper') ||
        $('.lite-room-canvas .react-transform-wrapper');
      const resetBtn = $('.lite-room-canvas .lite-room-canvas-reset');
      // Composer must be present and NOT nested inside the canvas (stays pinned/interactive).
      const composerInCanvas = !!$('.lite-room-canvas .nexus-followup-composer');
      const composerOutside = !!$('.lite-room .nexus-followup-composer') && !composerInCanvas;
      const out = {
        canvasPresent: !!canvas,
        boardPresent: !!board,
        panZoomWrapperPresent: !!transformWrapper,
        resetControlPresent: !!resetBtn,
        composerOutsideCanvas: composerOutside,
        pass: !!canvas && !!board && !!transformWrapper && composerOutside,
      };
      results.roomCanvas = out;
      return out;
    },

    async assertPlaybooksEmpty() {
      // Phase I (feat-025 Q1): a Playbooks screen exists, shows an honest empty state with
      // guide copy anchored to future capability + a coming-soon marker + future-data slots,
      // and leaks ZERO story nouns on that screen (no scripted case-review port).
      this._clickTab('Playbooks');
      try {
        await poll(() => ($('.lite-playbooks') ? true : null), 8000, 'playbooks screen to mount');
      } catch (e) { /* fall through */ }
      const screen = $('.lite-playbooks');
      const emptyCard = $('.lite-playbooks-empty');
      const heading = emptyCard && emptyCard.querySelector('h2');
      const comingSoon = $('.lite-playbooks-comingsoon');
      const slots = $$('.lite-playbooks-slot');
      const text = (screen && screen.innerText) || '';
      // Story-noun blacklist must be clean on the Playbooks surface (no ported story case cards).
      const storyHits = [];
      for (const noun of STORY_NOUNS) {
        const re = noun.includes(' ')
          ? new RegExp(noun.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
          : new RegExp('\\b' + noun + '\\b');
        if (re.test(text)) storyHits.push(noun);
      }
      const out = {
        screenPresent: !!screen,
        emptyStatePresent: !!emptyCard,
        hasGuideHeading: !!(heading && (heading.textContent || '').trim().length > 0),
        hasComingSoon: !!comingSoon,
        futureSlots: slots.length,
        storyHits,
        pass: !!screen && !!emptyCard && !!heading && !!comingSoon &&
          slots.length >= 1 && storyHits.length === 0,
      };
      results.playbooks = out;
      return out;
    },

    // ── feat-026 (S6) new-surface phase ──────────────────────────────────────
    async assertVisionSurface() {
      // Phase J (feat-026): the Vision surface exists and does two jobs honestly.
      //  1. Positioning narrative — the three-beat frame (what you see now = a lite you
      //     tried with your own files → the real product = a custom agent service, your data
      //     + private deploy → what this demo shows = UIUX + judgment + the red line).
      //  2. Capability-boundary MOCK — each future-capability card MUST carry a visible
      //     preview/coming marker (this is a fundraising surface; an unlabeled mock that
      //     reads as shipped is a trust break). We assert: >=1 mock card, and EVERY mock card
      //     carries a .lite-vision-tag marker — zero unlabeled mock cards.
      //  Red line (same as everywhere): if a mock shows an example PERSON, that person carries
      //  ZERO numbers/score/rank. And the story-noun blacklist stays 0 on this surface.
      // The Vision tab's visible label is product copy ("Where this goes"), not "Vision" — click
      // by that label, with a fallback that clicks whichever tab mounts the .lite-vision screen.
      if (!this._clickTab("What's coming")) {
        for (const tab of $$('.scene-tabs .scene-tab')) {
          tab.click();
          if ($('.lite-vision')) break;
        }
      }
      try {
        await poll(() => ($('.lite-vision') ? true : null), 8000, 'vision surface to mount');
      } catch (e) { /* fall through — assertions below report absence */ }
      const screen = $('.lite-vision');
      const narrative = $('.lite-vision-narrative');
      // Three narrative beats — each a labeled block.
      const beats = $$('.lite-vision-beat');
      // Mock capability cards + their honesty markers.
      const mockCards = $$('.lite-vision-mock');
      const taggedMockCards = mockCards.filter((c) => c.querySelector('.lite-vision-tag'));
      const unlabeledMockCards = mockCards.length - taggedMockCards.length;
      // Example-person red line: any person chip inside a mock must carry NO number.
      const mockPersonEls = $$('.lite-vision-mock .lite-vision-person');
      const personNumberLeak = mockPersonEls
        .map((el) => el.innerText || '')
        .filter((txt) => BLOOD_BAR_RE.test(txt) || /\b\d/.test(txt));
      // Story-noun blacklist on the Vision surface.
      const text = (screen && screen.innerText) || '';
      const storyHits = [];
      for (const noun of STORY_NOUNS) {
        const re = noun.includes(' ')
          ? new RegExp(noun.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
          : new RegExp('\\b' + noun + '\\b');
        if (re.test(text)) storyHits.push(noun);
      }
      const out = {
        screenPresent: !!screen,
        narrativePresent: !!narrative,
        narrativeBeats: beats.length,
        mockCards: mockCards.length,
        taggedMockCards: taggedMockCards.length,
        unlabeledMockCards,
        mockPersonCount: mockPersonEls.length,
        personNumberLeak,
        storyHits,
        // Screen mounts; narrative has its 3 beats; >=3 mock cards ALL labeled preview/coming;
        // zero example-person number leak; story-noun blacklist clean.
        pass: !!screen && !!narrative && beats.length >= 3 &&
          mockCards.length >= 3 && unlabeledMockCards === 0 &&
          personNumberLeak.length === 0 && storyHits.length === 0,
      };
      results.vision = out;
      return out;
    },

    // ── feat-034 stage B (lite Ask / Quick ask card, stub-driven) ─────────────
    // BORN RED (2026-07-13, before implementation): no .lite-ask-card exists anywhere.
    // ADR-0023 structural red lines are machine asserts here, not copy discipline:
    // receipts never on person cards, no cross-person score table in the whole DOM.
    // Value-ish tokens a per-person score row would carry (digits / yes / no).
    _askValueRe(name) {
      const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // name ... value  OR  value ... name, within 60 chars — a "row" pairing person with a score.
      return new RegExp('(?:' + esc + '[^]{0,60}?(?:[0-9]|\\byes\\b|\\bno\\b))|(?:(?:[0-9]|\\byes\\b|\\bno\\b)[^]{0,60}?' + esc + ')', 'i');
    },

    async assertAskDraft() {
      // Phase K1: after composerAskLive the advise stream carried manifest{kind:'ask-draft'} —
      // the AskCard mounts in DRAFT state: 1..3 questions each verbatim-editable, named roster
      // recipients, and the HONEST red-line note (check happens at save, server-side, not yet run).
      this._clickTab('Ask Avery');
      try { await poll(() => ($('.lite-ask-card') ? true : null), 20000, 'ask card to mount'); } catch (e) { /* report below */ }
      const card = $('.lite-ask-card');
      if (!card) return (results.askDraft = { pass: false, error: 'no .lite-ask-card in DOM' });
      const statusAttr = card.getAttribute('data-ask-status');
      const qInputs = $$('.ask-q-input', card);
      const chips = $$('.ask-recipient-chip', card);
      const selected = chips.filter((c) => c.getAttribute('aria-pressed') === 'true');
      results._askRecipientNames = selected.map((c) => (c.textContent || '').trim());
      const note = $('.ask-redline-note', card);
      // Verbatim edit through the native setter (React-controlled input).
      const EDIT_MARKER = 'How confident are you that this launch lands on the edited date?';
      let editWorks = false;
      if (qInputs[0]) {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(qInputs[0], EDIT_MARKER);
        qInputs[0].dispatchEvent(new Event('input', { bubbles: true }));
        try {
          await poll(() => (($$('.ask-q-input', card)[0] || {}).value === EDIT_MARKER ? true : null), 4000, 'question edit to stick');
          editWorks = true;
        } catch (e) { /* editWorks stays false */ }
      }
      // Add/remove within 1..3: grow by one (if room), then remove the added row back.
      let addRemoveWorks = false;
      const before = $$('.ask-q-row', card).length;
      const addBtn = $$('.ask-q-add', card).find((b) => !b.disabled);
      if (addBtn && before < 3) {
        addBtn.click();
        let grew = false;
        try {
          await poll(() => ($$('.ask-q-row', card).length === before + 1 ? true : null), 4000, 'question row to add');
          grew = true;
        } catch (e) { /* no growth */ }
        if (grew) {
          const rows = $$('.ask-q-row', card);
          const rm = rows[rows.length - 1].querySelector('.ask-q-remove');
          if (rm) rm.click();
          try {
            await poll(() => ($$('.ask-q-row', card).length === before ? true : null), 4000, 'question row to remove');
            addRemoveWorks = true;
          } catch (e) { /* stays grown */ }
        }
      }
      const out = {
        statusAttr,
        questions: $$('.ask-q-row', card).length,
        questionsInRange: $$('.ask-q-row', card).length >= 1 && $$('.ask-q-row', card).length <= 3,
        recipientChips: chips.length,
        selectedRecipients: selected.length,
        recipientNames: results._askRecipientNames,
        redlineNotePresent: !!note,
        editWorks,
        addRemoveWorks,
        pass: statusAttr === 'draft' && qInputs.length >= 1 && qInputs.length <= 3 &&
          selected.length >= 1 && !!note && editWorks && addRemoveWorks,
      };
      results.askDraft = out;
      return out;
    },

    async assertAskShare() {
      // Phase K2: confirm -> SHARED: one link per selected recipient, every link
      // https://avery.ima-read.com/r/{token}, one copy button per link (manual share = human gate).
      const card = $('.lite-ask-card');
      if (!card) return (results.askShare = { pass: false, error: 'no .lite-ask-card' });
      const expected = $$('.ask-recipient-chip[aria-pressed="true"]', card).length ||
        (results._askRecipientNames || []).length;
      const confirm = $('.ask-confirm', card);
      if (!confirm) return (results.askShare = { pass: false, error: 'no .ask-confirm button' });
      confirm.click();
      try {
        await poll(() => (card.getAttribute('data-ask-status') === 'shared' ? true : null), 15000, 'ask to reach shared');
      } catch (e) {
        return (results.askShare = { pass: false, error: String(e), statusAttr: card.getAttribute('data-ask-status') });
      }
      const links = $$('.ask-link-url', card).map((el) => (el.textContent || '').trim());
      const copyBtns = $$('.ask-copy-btn', card);
      let hostOk = links.length > 0;
      const badLinks = [];
      for (const l of links) {
        let u = null;
        try { u = new URL(l); } catch (e) { /* invalid */ }
        if (!u || u.protocol !== 'https:' || u.host !== 'avery.ima-read.com' ||
            !u.pathname.startsWith('/r/') || u.pathname.length <= 3) {
          hostOk = false; badLinks.push(l);
        }
      }
      // Copy button must not crash the page (clipboard may be denied headless — handler catches).
      let copyClickSafe = true;
      try { if (copyBtns[0]) copyBtns[0].click(); } catch (e) { copyClickSafe = false; }
      const out = {
        expectedRecipients: expected,
        links: links.length,
        linkSample: links[0] || null,
        badLinks,
        hostOk,
        copyButtons: copyBtns.length,
        copyClickSafe,
        pass: links.length === expected && links.length > 0 && hostOk &&
          copyBtns.length === links.length && copyClickSafe,
      };
      results.askShare = out;
      return out;
    },

    async assertAskCollect(expectedTotal) {
      // Phase K3: manager pull-refresh (v1 = no push) advances deterministically:
      // shared -> collecting (partial chip "1/2 replied") -> closed (all in).
      const card = $('.lite-ask-card');
      if (!card) return (results.askCollect = { pass: false, error: 'no .lite-ask-card' });
      const total = expectedTotal || 2;
      const chipTexts = [];
      let sawPartial = total <= 1; // single-recipient asks may go straight to closed
      for (let i = 0; i < total + 1 && card.getAttribute('data-ask-status') !== 'closed'; i++) {
        const refresh = $('.ask-refresh', card);
        if (!refresh) return (results.askCollect = { pass: false, error: 'no .ask-refresh button', chipTexts });
        const beforeChip = ($('.ask-status-chip', card) || {}).textContent || '';
        refresh.click();
        try {
          await poll(() => {
            const chip = ($('.ask-status-chip', card) || {}).textContent || '';
            return chip !== beforeChip || card.getAttribute('data-ask-status') === 'closed' ? true : null;
          }, 10000, 'refresh to advance ask state');
        } catch (e) {
          return (results.askCollect = { pass: false, error: String(e), chipTexts, statusAttr: card.getAttribute('data-ask-status') });
        }
        const chip = ($('.ask-status-chip', card) || {}).textContent || '';
        chipTexts.push(chip);
        if (card.getAttribute('data-ask-status') === 'collecting' && /\d\s*\/\s*\d/.test(chip)) sawPartial = true;
      }
      const out = {
        chipTexts,
        sawPartialChip: sawPartial,
        finalStatus: card.getAttribute('data-ask-status'),
        pass: sawPartial && card.getAttribute('data-ask-status') === 'closed',
      };
      results.askCollect = out;
      return out;
    },

    assertAskReceipts(expect) {
      // Phase K4 (multi) / receipt half of K5 (single).
      // ADR-0023: single = number + "self-reported" label + verbatim comment;
      // multi = ONE qualitative summary paragraph — structurally NO per-person score row:
      // zero .ask-receipt-single, zero tables, and no recipient name within 60 chars of a
      // digit / yes / no anywhere in the receipts zone.
      const card = $('.lite-ask-card');
      const slot = expect === 'single' ? 'askReceiptsSingle' : 'askReceiptsMulti';
      if (!card) return (results[slot] = { pass: false, error: 'no .lite-ask-card' });
      const zone = $('.ask-receipts', card) || card;
      const zoneText = zone.innerText || '';
      const single = $$('.ask-receipt-single', card);
      const summary = $('.ask-receipt-summary', card);
      const selfLabel = $('.ask-self-label', card);
      const comment = $('.ask-receipt-comment', card);
      const valueEls = $$('.ask-receipt-value', card);
      const tables = $$('table', card).length +
        $$('[class*="score"], [class*="rank"], [class*="leaderboard"]', card).length;
      const names = results._askRecipientNames || [];
      const nameValuePairs = names.filter((n) => n && this._askValueRe(n).test(zoneText));
      let out;
      if (expect === 'single') {
        out = {
          singleBlocks: single.length,
          selfReportedLabel: !!selfLabel,
          verbatimComment: !!comment && (comment.textContent || '').trim().length > 0,
          valuesShown: valueEls.length,
          tables,
          pass: single.length === 1 && !!selfLabel && !!comment &&
            (comment.textContent || '').trim().length > 0 && valueEls.length >= 1 && tables === 0,
        };
      } else {
        out = {
          singleBlocks: single.length,
          summaryPresent: !!summary && (summary.textContent || '').trim().length > 0,
          tables,
          nameValuePairs,
          pass: single.length === 0 && !!summary && (summary.textContent || '').trim().length > 0 &&
            tables === 0 && nameValuePairs.length === 0,
        };
      }
      results[slot] = out;
      return out;
    },

    async assertAskSingleFlow() {
      // Phase K5: a FRESH ask (composerAskLive re-ran) — deselect down to ONE recipient,
      // share (1 link), collect, then the single-receipt shape: number + self-reported + verbatim.
      this._clickTab('Ask Avery');
      try {
        await poll(() => {
          const c = $('.lite-ask-card');
          return c && c.getAttribute('data-ask-status') === 'draft' ? true : null;
        }, 20000, 'fresh draft ask card');
      } catch (e) {
        return (results.askSingle = { pass: false, error: String(e) });
      }
      const card = $('.lite-ask-card');
      // Deselect all but the first selected recipient.
      for (;;) {
        const selected = $$('.ask-recipient-chip[aria-pressed="true"]', card);
        if (selected.length <= 1) break;
        selected[selected.length - 1].click();
        try {
          await poll(() => ($$('.ask-recipient-chip[aria-pressed="true"]', card).length === selected.length - 1 ? true : null), 4000, 'recipient to deselect');
        } catch (e) {
          return (results.askSingle = { pass: false, error: 'recipient deselect did not stick' });
        }
      }
      results._askRecipientNames = $$('.ask-recipient-chip[aria-pressed="true"]', card)
        .map((c) => (c.textContent || '').trim());
      const share = await this.assertAskShare();
      const collect = await this.assertAskCollect(1);
      const receipts = this.assertAskReceipts('single');
      const out = {
        deselectedToOne: results._askRecipientNames.length === 1,
        share, collect, receipts,
        pass: results._askRecipientNames.length === 1 && share.pass && collect.pass && receipts.pass,
      };
      results.askSingle = out;
      return out;
    },

    async assertAskRedline() {
      // Phase K6 (ADR-0023 structural gate, whole DOM): after receipts are in —
      //  · person cards carry ZERO numbers OUTSIDE a provenance anchor (receipts never leak onto people),
      //  · no cross-person score structure anywhere in the document (BOTH worlds, unconditional),
      //  · story-noun blacklist stays 0.
      // rich-align-0722/03 — TWO WORLDS off the shell marker (data-scoring-enabled):
      //   OFF: no self-report projected → zero anchors, zero mood-vocab, zero numbers on person cards.
      //   ON : self-report allowed but ONLY inside a [data-metric-source] anchor that carries a
      //        non-empty source; any blood-bar/mood shape OUTSIDE an anchor is still a hard leak.
      this._clickTab('Team');
      try { await poll(() => ($$('.home-person-card').length > 0 ? true : null), 8000, 'person cards to mount'); } catch (e) { /* report below */ }
      const cards = $$('.home-person-card');
      const scoringOn = scoringMarkerOn();
      // Every leak scan runs on the text OUTSIDE self-report anchors — so a sanctioned self-report does
      // not read as a leak, while anything that escaped the anchor still does.
      const cardText = cards.map((c) => textOutsideAnchors(c)).join('\n');
      const bloodBar = BLOOD_BAR_RE.test(cardText) ? cardText.match(BLOOD_BAR_RE)[0] : null;
      const digitOnPerson = /\d/.test(cardText) ? (cardText.match(/[^\n]*\d[^\n]*/) || [null])[0] : null;
      const moodOutside = MOOD_VOCAB_RE.test(cardText) ? cardText.match(MOOD_VOCAB_RE)[0] : null;
      const receiptLeak = /self-reported|out of 5|本人自述/i.test(cardText);
      // score-table / leaderboard / ranking structures are forbidden in BOTH worlds, unconditionally.
      const docTables = $$('table').length +
        $$('[class*="score-table"], [class*="leaderboard"], [class*="ranking"]').length;
      // Anchor discipline: every self-report anchor must carry a non-empty provenance source.
      const anchors = selfReportAnchors(cards);
      const anchorsMissingSource = anchors.filter((el) => !((el.getAttribute('data-metric-source') || '').trim())).length;
      const worldPass = scoringOn ? anchorsMissingSource === 0 : anchors.length === 0;
      const nounScan = this.scanStoryNouns();
      const out = {
        scoringOn,
        personCards: cards.length,
        bloodBarLeak: bloodBar,
        digitOnPersonCard: digitOnPerson,
        moodVocabOutsideAnchor: moodOutside,
        receiptLeakOnPersonCard: receiptLeak,
        selfReportAnchors: anchors.length,
        anchorsMissingSource,
        docScoreTables: docTables,
        storyNounHits: nounScan.storyNounHits,
        pass: cards.length > 0 && !bloodBar && !digitOnPerson && !moodOutside && !receiptLeak &&
          docTables === 0 && nounScan.pass && worldPass,
      };
      results.askRedline = out;
      return out;
    },

    // ── feat-034 stage C follow-ups (kickoff F1/F2/F3) — BORN RED 2026-07-14 ──
    // F1: unknown status must fold to 'closed' (NEVER 'draft' — a revoked ask must not resurrect
    // as an editable draft), and the two new terminal statuses render dedicated UI states.
    // Drives the real store (window.__liteStore) + the exported coerce (window.__liteAsk).
    async assertAskStatusGuards() {
      const dbg = window.__liteAsk;
      const store = window.__liteStore;
      if (!dbg || !dbg.coerceAskDraft || !store) {
        return (results.askStatusGuards = { pass: false, error: 'no __liteAsk/__liteStore debug seam' });
      }
      const mk = (status) => dbg.coerceAskDraft({
        id: 'ask_gate_f1', status,
        questions: [{ id: 'q1', kind: 'scale', text: 'How is the launch pacing?' }],
        recipients: [{ id: 'r1', name: 'Lin Qing' }],
      });
      const unknownFolds = (mk('totally-bogus-status') || {}).status;
      const revokedKept = (mk('revoked') || {}).status;
      const expiredKept = (mk('expired') || {}).status;
      // DOM halves: the card renders dedicated terminal states (copy present, no link rows).
      const prev = store.getState().ask;
      const domFor = async (status) => {
        store.setState({ ask: mk(status) });
        try {
          await poll(() => {
            const c = $('.lite-ask-card');
            return c && c.getAttribute('data-ask-status') === status ? true : null;
          }, 4000, status + ' card state');
        } catch (e) { return { mounted: false }; }
        const card = $('.lite-ask-card');
        return {
          mounted: true,
          note: !!$(status === 'revoked' ? '.ask-revoked-note' : '.ask-expired-note', card),
          linkRows: $$('.ask-link-row', card).length,
        };
      };
      const revokedDom = await domFor('revoked');
      const expiredDom = await domFor('expired');
      store.setState({ ask: prev });   // leave the session as found
      const out = {
        unknownFolds, revokedKept, expiredKept,
        revokedDom, expiredDom,
        pass: unknownFolds === 'closed' && revokedKept === 'revoked' && expiredKept === 'expired' &&
          revokedDom.mounted && revokedDom.note && revokedDom.linkRows === 0 &&
          expiredDom.mounted && expiredDom.note && expiredDom.linkRows === 0,
      };
      results.askStatusGuards = out;
      return out;
    },

    // F2 (demo honesty): under the stub transport a SHARED ask shows real-looking links that go
    // nowhere — the card must SAY SO (.ask-offline-note). Against the real backend the note must
    // be ABSENT (the links work). Run while the card is shared/collecting (between K2 and K3).
    assertAskOfflineNote() {
      const isStub = new URLSearchParams(location.search).get('transport') === 'stub';
      const card = $('.lite-ask-card');
      if (!card) return (results.askOfflineNote = { pass: false, error: 'no .lite-ask-card' });
      const status = card.getAttribute('data-ask-status');
      const inShare = status === 'shared' || status === 'collecting';
      const note = $('.ask-offline-note', card);
      const noteText = note ? (note.textContent || '').trim() : null;
      const out = {
        isStub, status, notePresent: !!note, noteText,
        pass: inShare && (isStub ? !!note && noteText.length > 0 : !note),
      };
      results.askOfflineNote = out;
      return out;
    },

    // F3 (defensive coerce, tightened): a bad shape means NO card — never a half-broken one.
    // >3 questions / an unknown question kind / a receipt value outside its question's range
    // (99 "out of 5", a string yes/no) must all coerce to null.
    assertAskCoerceStrict() {
      const dbg = window.__liteAsk;
      if (!dbg || !dbg.coerceAskDraft) {
        return (results.askCoerceStrict = { pass: false, error: 'no __liteAsk debug seam' });
      }
      const base = {
        id: 'ask_gate_f3', status: 'closed',
        questions: [{ id: 'q1', kind: 'scale', text: 'How is the launch pacing?' }],
        recipients: [{ id: 'r1', name: 'Lin Qing' }],
      };
      const fourQs = dbg.coerceAskDraft({
        ...base,
        questions: [1, 2, 3, 4].map((i) => ({ id: 'q' + i, kind: 'scale', text: 'Question ' + i + '?' })),
      });
      const unknownKind = dbg.coerceAskDraft({
        ...base,
        questions: [{ id: 'q1', kind: 'matrix', text: 'Pick all that apply' }],
      });
      const outOfRange = dbg.coerceAskDraft({
        ...base,
        recipients: [{ id: 'r1', name: 'Lin Qing', receipt: {
          answers: [{ question_id: 'q1', value: 99 }], answered_at: '2026-07-14T10:00:00Z' } }],
      });
      const wrongType = dbg.coerceAskDraft({
        ...base,
        questions: [{ id: 'q1', kind: 'yesno', text: 'Is the quote signed?' }],
        recipients: [{ id: 'r1', name: 'Lin Qing', receipt: {
          answers: [{ question_id: 'q1', value: 3 }], answered_at: '2026-07-14T10:00:00Z' } }],
      });
      const goodStillWorks = dbg.coerceAskDraft({
        ...base,
        recipients: [{ id: 'r1', name: 'Lin Qing', receipt: {
          answers: [{ question_id: 'q1', value: 4 }], answered_at: '2026-07-14T10:00:00Z' } }],
      });
      const out = {
        fourQsNull: fourQs === null,
        unknownKindNull: unknownKind === null,
        outOfRangeNull: outOfRange === null,
        wrongTypeNull: wrongType === null,
        goodStillWorks: !!(goodStillWorks && goodStillWorks.recipients[0].receipt),
        pass: fourQs === null && unknownKind === null && outOfRange === null &&
          wrongType === null && !!(goodStillWorks && goodStillWorks.recipients[0].receipt),
      };
      results.askCoerceStrict = out;
      return out;
    },

    askVerdict() {
      const phases = {
        askDraft: !!(results.askDraft && results.askDraft.pass),
        askShare: !!(results.askShare && results.askShare.pass),
        askOfflineNote: !!(results.askOfflineNote && results.askOfflineNote.pass),   // F2 (stage C)
        askCollect: !!(results.askCollect && results.askCollect.pass),
        askReceiptsMulti: !!(results.askReceiptsMulti && results.askReceiptsMulti.pass),
        askSingle: !!(results.askSingle && results.askSingle.pass),
        askRedline: !!(results.askRedline && results.askRedline.pass),
        askStatusGuards: !!(results.askStatusGuards && results.askStatusGuards.pass), // F1 (stage C)
        askCoerceStrict: !!(results.askCoerceStrict && results.askCoerceStrict.pass), // F3 (stage C)
      };
      return { pass: Object.values(phases).every(Boolean), phases, results };
    },

    // ── feat-033 new-surface phase ───────────────────────────────────────────
    async assertNotesSurface() {
      // The "Avery's notes" surface: the write-side, accumulating, READ-ONLY notebook.
      // Called AFTER composerAskLive (a real advise now writes a real note), so the tab should be
      // POPULATED. Asserts: the tab mounts; the RED-LINE trust note is present (deterministic gate,
      // not "we try"); the observation entries carry ZERO person-score numbers (the red line the
      // write-side backend gate enforces, re-checked on the rendered surface); entries are READ-ONLY
      // (the observation body is not a button — only the source line jumps to the room); and the
      // story-noun blacklist stays 0. An EMPTY notebook (no advise ran) is tolerated (empty-state +
      // trust note), so this phase is honest whether or not a note landed.
      this._clickTab("Avery's notes");
      try {
        await poll(() => ($('.lite-notes') ? true : null), 8000, 'notes surface to mount');
      } catch (e) { /* fall through — assertions below report absence */ }
      const screen = $('.lite-notes');
      const trustNote = $('.lite-notes-redline-note');
      const entries = $$('.lite-notes-entry');
      const populated = entries.length > 0;
      const emptyState = $('.lite-notes-empty');
      // Red line on the RENDERED observations only (the trust note legitimately says "score/rank").
      const entryText = $$('.lite-notes-entry-text').map((e) => e.innerText || '').join('\n');
      const numberLeak = BLOOD_BAR_RE.test(entryText) || /\b\d\s*\/\s*\d\b/.test(entryText)
        ? (entryText.match(BLOOD_BAR_RE) || entryText.match(/\b\d\s*\/\s*\d\b/) || [])[0] : null;
      // Read-only: an observation entry must not be a <button> (only .lite-notes-entry-source is).
      const entryIsButton = $$('.lite-notes-entry').some((e) => e.tagName === 'BUTTON');
      const text = (screen && screen.innerText) || '';
      const storyHits = [];
      for (const noun of STORY_NOUNS) {
        const re = noun.includes(' ')
          ? new RegExp(noun.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
          : new RegExp('\\b' + noun + '\\b');
        if (re.test(text)) storyHits.push(noun);
      }
      const out = {
        screenPresent: !!screen,
        trustNotePresent: !!trustNote,
        populated,
        entryCount: entries.length,
        emptyStatePresent: !!emptyState,
        numberLeak,
        entryIsButton,
        storyHits,
        // Screen mounts; the red-line trust note is present; it is either populated (clean, read-only)
        // or an honest empty state; zero number leak on observations; story-noun blacklist clean.
        pass: !!screen && !!trustNote && (populated || !!emptyState) &&
          !numberLeak && !entryIsButton && storyHits.length === 0,
      };
      results.notesSurface = out;
      return out;
    },

    verdict() {
      const phases = {
        emptyStateClean: !!(results.storyNouns && results.storyNouns[0] && results.storyNouns[0].pass),
        ingested: !!(results.inject && results.inject.pass),
        teamRendered: !!(results.team && results.team.pass),
        postUploadClean: !!(results.storyNouns && results.storyNouns[1] && results.storyNouns[1].pass),
        detailIsLive: !!(results.detail && results.detail.pass),
        // composerIsLive = static (no story prefill/refs) AND dynamic (askLive SSE to frames).
        // The dynamic half is REQUIRED as of S2/feat-024 — skipping composerAskLive() = red.
        composerIsLive:
          !!(results.composer && results.composer.pass) &&
          !!(results.composerLive && results.composerLive.pass),
        // feat-025 (S5) new modules — grouping view, room pan/zoom canvas, Playbooks empty state.
        teamGrouped: !!(results.teamGrouped && results.teamGrouped.pass),
        roomCanvas: !!(results.roomCanvas && results.roomCanvas.pass),
        playbooksEmpty: !!(results.playbooks && results.playbooks.pass),
        // feat-026 (S6) new surface — positioning narrative + honestly-labeled capability mock.
        visionSurface: !!(results.vision && results.vision.pass),
        // feat-033 new surface — the write-side, accumulating, read-only "Avery's notes" notebook.
        notesSurface: !!(results.notesSurface && results.notesSurface.pass),
      };
      return { pass: Object.values(phases).every(Boolean), phases, results };
    },

    // ── feat-035 (lite-live-v02) — v2Verdict, independent aggregate, phase group A ─────────────
    // Driven with `?transport=stub` (deterministic, offline — no real backend needed). Unlike the
    // 10-phase verdict()/askVerdict() above (which live inside a single `?mode=live` page), these
    // phases span THREE separate page loads (`?v=1`, `?v=2`, `?mode=story`) plus one lint
    // run the browser can't do itself — so most of them take externally-computed evidence as
    // arguments rather than driving everything in-page. The driver session's job: navigate,
    // re-inject this snippet each time, call the matching phase, and carry the JSON forward.
    async assertV2Boots() {
      // Phase v2Boots: `?v=2&mode=live` must render the .lite2-shell root with all 8 tabs
      // Tab order = feat-057's aggregate entry + PRD order + feat-047's "Avery's notes"
      // + feat-055's "Projects":
      //   Today · Team · Projects · Ask Avery · To-do list/Follow-ups · Avery's notes ·
      //   Worth noting · Playbooks · What's coming   (0729 大白话命名，ADR-0031)
      //
      // "Avery's notes" was ported from `lite` and placed after Follow-ups per feat-047's
      // tab-order decision (see progress.md).
      // "Today" is PREPENDED (feat-057): it is the `/` landing and the "where do I look first"
      // screen — an entry placed at the tail is not an entry. 🔴 The 7 detail screens did NOT
      // retire; Danny's ruling was "aggregate AND split, both extremes". If a future line
      // removes one of the seven, that is a regression, not a contract update.
      // "Projects" sits at index 2 (feat-055): the projects screen and the team screen are the
      // two halves of the same upload (people / projects), so it rides next to "Your team"
      // rather than at the tail.
      //
      // ⚠ The expected array below is the SINGLE SOURCE OF TRUTH for tab order in this gate.
      // Any line that adds/removes/reorders a tab in src/lite2/LiteTopbar.tsx MUST update this
      // array in the same commit, or the v2Boots phase goes red. Labels are the EN dict values
      // (`resolveLocale()` defaults to EN when the gate URL carries no `?lang=`).
      // Count is derived from the array (`expected.length`) — never hardcode it separately,
      // or the two drift the moment a tab is added.
      try {
        await poll(() => ($('.lite2-shell') ? true : null), 8000, '.lite2-shell to mount');
      } catch (e) { /* fall through — assertions below report absence */ }
      const shell = $('.lite2-shell');
      // 0721 对齐棒 · Danny 2C：home/followups 换主名 + 副小字。主名读 .scene-tab-main
      // （有副小字的 tab 才有这个 span；没有的 tab 整个 button 就是主名），副小字单独断言
      // ——textContent 直读会把「To-do listFollow-ups」连成一坨，这里明确分层。
      const tabBtns = $$('.lite2-shell .scene-tabs .scene-tab');
      const tabs = tabBtns.map((b) => ((b.querySelector('.scene-tab-main') || b).textContent || '').trim());
      const subs = tabBtns.map((b) => { const s = b.querySelector('.scene-tab-sub'); return s ? (s.textContent || '').trim() : null; });
      // 0729 大白话命名（ADR-0031，Danny 审字）：5 个主名换企业大白话；home 副小字取消。
      const expected = ['Today', 'Team', 'Projects', 'Ask Avery', 'To-do list', "Avery's notes", 'Worth noting', 'Playbooks', "What's coming"];
      const expectedSubs = [null, null, null, null, 'Follow-ups', null, null, null, null];
      const out = {
        shellPresent: !!shell,
        dataScene: shell ? shell.getAttribute('data-scene') : null,
        tabCount: tabs.length,
        tabLabels: tabs,
        tabSubs: subs,
        tabOrderMatches: JSON.stringify(tabs) === JSON.stringify(expected),
        tabSubsMatch: JSON.stringify(subs) === JSON.stringify(expectedSubs),
        pass: !!shell && tabs.length === expected.length && JSON.stringify(tabs) === JSON.stringify(expected) &&
          JSON.stringify(subs) === JSON.stringify(expectedSubs),
      };
      results.v2Boots = out;
      return out;
    },

    assertV1Untouched(v01VerdictPass) {
      // Phase v1Untouched: called on `?v=1&mode=live` — must render ZERO
      // .lite2-shell nodes (v01 stays LiteApp), AND the caller passes in the already-computed
      // v01 ten-phase verdict().pass from a same-session re-run on this same page (this snippet
      // can't itself remember state across navigations — the driver carries the boolean over).
      //
      // 🔴 2026-07-19: this phase used to be driven on the DEFAULT URL (`?mode=live`, no `v=`).
      // Danny's ruling ① flipped resolveVersion()'s default to '2', so the bare URL renders v02
      // and driving this phase there would assert "v01 is untouched" against a v02 page.
      // `?v=1` is now the only way to reach v01.
      const leaked = $$('.lite2-shell').length;
      const out = {
        lite2ShellCount: leaked,
        v01VerdictPass: !!v01VerdictPass,
        pass: leaked === 0 && !!v01VerdictPass,
      };
      results.v1Untouched = out;
      return out;
    },

    assertStoryUntouched() {
      // Phase storyUntouched: called on `?mode=story` — must render ZERO .lite2-shell nodes
      // (the story shell physically can't reach lite2's root class; this is the S4/S5 "story
      // untouched" pattern reused for lite2's own root class).
      const leaked = $$('.lite2-shell').length;
      const out = { lite2ShellCount: leaked, pass: leaked === 0 };
      results.storyUntouched = out;
      return out;
    },

    recordWallRed(evidence) {
      // Phase wallRed: the ESLint wall check can't run from inside the browser — the driver
      // session runs `npm run lint` with a violating import injected (expects exit 1), then
      // removes it (expects exit 0), for all 4 new directions (lite2→story, story→lite2,
      // lite→lite2, lite2→lite), and records that raw evidence here. Shape:
      //   { pass: boolean, directions: { [name]: { redExit, greenExit } } }
      results.wallRed = { pass: !!(evidence && evidence.pass), evidence };
      return results.wallRed;
    },

    readSkinSnapshot() {
      // Helper (not a phase itself): snapshot the shell's data-look attribute + a couple of
      // computed values that the token layer is expected to move. Called once per page load
      // (paper, then aurora) — the driver holds both JSON snapshots and feeds them into
      // assertSkinTokens() together (cross-navigation, so this can't be done in one call).
      const shell = $('.lite2-shell');
      if (!shell) return null;
      const cs = getComputedStyle(shell);
      return {
        skinAttr: shell.getAttribute('data-look'),
        backgroundImage: cs.backgroundImage,
        color: cs.color,
      };
    },

    assertSkinTokens(before, after) {
      // Phase skinTokens: switching `?look=paper` -> `?look=aurora` must change BOTH the shell
      // root's data-look attribute AND at least one key computed value (proves the token layer
      // actually wires through — not just an inert attribute).
      const skinAttrChanged = !!before && !!after && before.skinAttr !== after.skinAttr;
      const computedChanged =
        !!before && !!after &&
        (before.backgroundImage !== after.backgroundImage || before.color !== after.color);
      const out = {
        before, after, skinAttrChanged, computedChanged,
        pass: !!before && !!after && skinAttrChanged && computedChanged,
      };
      results.skinTokens = out;
      return out;
    },

    v2Verdict() {
      const phases = {
        v2Boots: !!(results.v2Boots && results.v2Boots.pass),
        v1Untouched: !!(results.v1Untouched && results.v1Untouched.pass),
        storyUntouched: !!(results.storyUntouched && results.storyUntouched.pass),
        wallRed: !!(results.wallRed && results.wallRed.pass),
        skinTokens: !!(results.skinTokens && results.skinTokens.pass),
      };
      return { pass: Object.values(phases).every(Boolean), phases, results };
    },

    // ── feat-036 (lite-live-v02) — flowVerdict, independent aggregate, phase group B ──────────
    // Morning triage (ADR-0017 execution) + Follow-ups (PRD F3). Driven `?v=2&mode=live
    // &transport=stub` (deterministic, same lite2 stub roster/blockers as v2Verdict). The stub
    // corpus (src/lite2/stubTransport.ts) carries pr_pilot (status at-risk, one blocker — its
    // own self-report already says "at risk", so the blocker is consistent, not a contradiction)
    // and, as of feat-044, pr_portal (status on-track, one blocker — a DELIBERATE self-report/
    // signal mismatch that feat-044's gapDerive.ts surfaces on the "A closer look" tab).
    // teamData.ts liveHandoffs() picks up BOTH as morning-triage cards (any project with a
    // blocker gets surfaced today, regardless of status) — so this now honestly yields TWO
    // triage cards. assertTriageActions below targets only the FIRST one by DOM order
    // (pr_pilot's, which sorts first — payload.projects array order), exercising done/discard/
    // take-to-room on that SAME card in sequence, restoring it between sub-checks, rather than
    // fabricating extra corpus signal just to get more cards.
    async assertTriageRenders() {
      // Phase triageRenders: the top of Your team renders >=1 derived triage card (from
      // team.handoffs, itself derived from real project blockers — teamData.ts liveHandoffs()),
      // each with a done check + a discard control + a take-to-room control, and zero person-
      // number leak inside the triage DOM (red line, same BLOOD_BAR_RE as v01 person cards).
      this._clickTab('Team');
      try {
        await poll(() => ($$('.home-handoff').length > 0 ? true : null), 8000, 'triage cards to render');
      } catch (e) { /* fall through — assertions below report absence */ }
      const cards = $$('.home-handoff');
      const text = cards.map((c) => c.innerText).join('\n');
      const bloodBar = BLOOD_BAR_RE.test(text) ? text.match(BLOOD_BAR_RE)[0] : null;
      const first = cards[0];
      const out = {
        triageCards: cards.length,
        bloodBarLeak: bloodBar,
        hasCheck: !!(first && $('.home-check', first)),
        hasDiscard: !!(first && $('.home-discard', first)),
        hasTakeToRoom: !!(first && $('.lite-triage-room', first)),
        hasAddFollowup: !!(first && $('.lite-triage-addfollowup', first)),
        pass:
          cards.length >= 1 && !bloodBar && !!first &&
          !!$('.home-check', first) && !!$('.home-discard', first) &&
          !!$('.lite-triage-room', first) && !!$('.lite-triage-addfollowup', first),
      };
      results.triageRenders = out;
      return out;
    },

    async assertTriageActions() {
      // Phase triageActions: done -> pending count drops + item shows up inside the "Taken
      // care of today" drawer; discard -> item disappears from pending; take-to-room ->
      // screen switches to The room with the composer pre-filled with that card's context.
      // All three sub-checks reuse the SAME single stub-derived card — the FIRST one by DOM
      // order (restored between steps via the drawer's undo button) — see the note above
      // assertTriageRenders on why the corpus now yields two triage cards (feat-044) and why
      // this phase always targets the first.
      this._clickTab('Team');
      try {
        await poll(() => ($$('.home-handoff').length > 0 ? true : null), 8000, 'a triage card to act on');
      } catch (e) { /* report below */ }
      const initialCount = $$('.home-handoff').length;
      if (initialCount < 1) return (results.triageActions = { pass: false, error: 'no triage cards to act on' });
      const title = (($$('.home-handoff')[0].querySelector('h3') || {}).textContent || '').trim();
      const findUndoFor = (itemTitle) => {
        const li = $$('.home-drawer-list li').find((el) => (el.textContent || '').includes(itemTitle));
        return li ? li.querySelector('button') : null;
      };

      // ── 1) DONE ──
      $('.home-check', $$('.home-handoff')[0]).click();
      let doneWorks = false;
      try {
        await poll(() => ($$('.home-handoff').length < initialCount ? true : null), 4000, 'pending count to drop after done');
        doneWorks = true;
      } catch (e) { /* doneWorks stays false */ }
      const toggle1 = $('.home-drawer-toggle');
      if (toggle1) toggle1.click(); // mount .home-drawer-list
      let drawerHasItem = false;
      try {
        await poll(() => ($$('.home-drawer-item').some((el) => (el.textContent || '').trim() === title) ? true : null), 4000, 'done item to appear in drawer');
        drawerHasItem = true;
      } catch (e) { /* drawerHasItem stays false */ }
      const undo1 = findUndoFor(title);
      if (undo1) undo1.click();
      try {
        await poll(() => ($$('.home-handoff').length === initialCount ? true : null), 4000, 'card restored after first undo');
      } catch (e) { /* fall through — next sub-check will report its own failure */ }

      // ── 2) DISCARD ──
      let discardWorks = false;
      const beforeDiscard = $$('.home-handoff').length;
      const cardToDiscard = $$('.home-handoff').find((c) => ((c.querySelector('h3') || {}).textContent || '').trim() === title);
      if (cardToDiscard) {
        $('.home-discard', cardToDiscard).click();
        try {
          await poll(() => ($$('.home-handoff').length < beforeDiscard ? true : null), 4000, 'pending count to drop after discard');
          discardWorks = true;
        } catch (e) { /* discardWorks stays false */ }
      }
      if (!$('.home-drawer-list')) {
        const toggle2 = $('.home-drawer-toggle');
        if (toggle2) toggle2.click();
      }
      const undo2 = findUndoFor(title);
      if (undo2) undo2.click();
      try {
        await poll(() => ($$('.home-handoff').length === initialCount ? true : null), 4000, 'card restored after second undo');
      } catch (e) { /* fall through */ }

      // ── 3) TAKE TO THE ROOM ──
      let roomWorks = false;
      let composerValue = '';
      const cardForRoom = $$('.home-handoff').find((c) => ((c.querySelector('h3') || {}).textContent || '').trim() === title);
      if (cardForRoom) {
        const roomBtn = $('.lite-triage-room', cardForRoom);
        if (roomBtn) {
          roomBtn.click();
          try {
            await poll(() => ($('.nexus-followup-composer input') ? true : null), 6000, 'room composer to mount');
          } catch (e) { /* fall through */ }
          const input = $('.nexus-followup-composer input');
          composerValue = input ? input.value : '';
          roomWorks = !!composerValue && composerValue.includes(title);
        }
      }

      const out = {
        title,
        initialCount,
        doneWorks,
        drawerHasItem,
        discardWorks,
        roomWorks,
        composerValueSample: composerValue.slice(0, 120),
        pass: doneWorks && drawerHasItem && discardWorks && roomWorks,
      };
      results.triageActions = out;
      return out;
    },

    async assertFollowupsFlow() {
      // Phase followupsFlow: a triage card's "Add to follow-ups" -> the Follow-ups tab shows a
      // new item carrying the EXPECTED triage source label -> checking it complete moves it into
      // History -> restoring it there puts it back in the active list.
      //
      // HARDENED (2026-07-14, adversarial-verify feedback on feat-043): the item is tracked by
      // its STABLE id (`data-followup-id`, rendered by FollowupsScreen) instead of title text —
      // a same-session re-run leaves residual items with identical titles in localStorage, and
      // title matching silently latches onto the wrong one. The new item = the id that appears
      // after the add click and was not present before. The source label is asserted EXACTLY
      // (attribute `data-followup-source` === 'triage' AND visible text === the expected triage
      // copy), not merely non-empty.
      const EXPECTED_TRIAGE_SOURCE = 'From this morning'; // en.lite2.followupsSourceTriage
      const settle = () => new Promise((r) => setTimeout(r, 200));
      const idsNow = () =>
        $$('.lite-followup-item').map((el) => el.getAttribute('data-followup-id')).filter(Boolean);
      const collectAllIds = async () => {
        // active + history (both subtabs), leaving the screen on Active.
        const seen = new Set();
        const activeTab = $('.lite-followups-subtab[data-subtab="active"]');
        const historyTab = $('.lite-followups-subtab[data-subtab="history"]');
        if (activeTab) activeTab.click();
        await settle();
        for (const id of idsNow()) seen.add(id);
        if (historyTab) historyTab.click();
        await settle();
        for (const id of idsNow()) seen.add(id);
        if (activeTab) activeTab.click();
        await settle();
        return seen;
      };
      const findById = (id) =>
        $$('.lite-followup-item').find((el) => el.getAttribute('data-followup-id') === id) || null;

      // 0) Baseline: every id already present BEFORE the add (residue from earlier runs).
      this._clickTab('Follow-ups');
      try {
        await poll(() => ($('.lite-followups-list') || $('.lite-followups-empty-note') ? true : null), 8000, 'follow-ups screen to mount');
      } catch (e) { /* fall through */ }
      const beforeIds = await collectAllIds();

      // 1) Add from the first triage card.
      this._clickTab('Team');
      try {
        await poll(() => ($$('.home-handoff').length > 0 ? true : null), 8000, 'triage cards present');
      } catch (e) { /* fall through */ }
      const card = $$('.home-handoff')[0];
      if (!card) return (results.followupsFlow = { pass: false, error: 'no triage card to add from' });
      const title = ((card.querySelector('h3') || {}).textContent || '').trim();
      const addBtn = $('.lite-triage-addfollowup', card);
      if (!addBtn) return (results.followupsFlow = { pass: false, error: 'no .lite-triage-addfollowup button' });
      addBtn.click();

      // 2) The NEW item = the id that was not in the baseline.
      this._clickTab('Follow-ups');
      let newId = null;
      try {
        newId = await poll(() => {
          const fresh = idsNow().filter((id) => !beforeIds.has(id));
          return fresh.length > 0 ? fresh[0] : null;
        }, 8000, 'new follow-up item (fresh data-followup-id) to appear');
      } catch (e) {
        return (results.followupsFlow = { pass: false, error: String(e), beforeIdCount: beforeIds.size });
      }
      const item = findById(newId);
      if (!item) return (results.followupsFlow = { pass: false, error: 'new item vanished after id capture', newId });
      const sourceAttr = item.getAttribute('data-followup-source');
      const sourceEl = $('.lite-followup-source', item);
      const sourceLabelText = sourceEl ? (sourceEl.textContent || '').trim() : '';
      const sourceLabelOk = sourceAttr === 'triage' && sourceLabelText === EXPECTED_TRIAGE_SOURCE;

      // 3) Complete -> leaves the active list (by id).
      const check = $('.lite-followup-check', item);
      if (check) check.click();
      let leftActive = false;
      try {
        await poll(() => (!findById(newId) ? true : null), 4000, 'item to leave the active list');
        leftActive = true;
      } catch (e) { /* leftActive stays false */ }

      // 4) Shows up in History (same id).
      const historyTab = $('.lite-followups-subtab[data-subtab="history"]');
      if (historyTab) historyTab.click();
      let historyItem = null;
      let movedToHistory = false;
      try {
        historyItem = await poll(() => findById(newId), 4000, 'item to appear in history');
        movedToHistory = !!historyItem;
      } catch (e) { /* movedToHistory stays false */ }

      // 5) Restore -> back in the active list (same id).
      let restored = false;
      if (historyItem) {
        const restoreBtn = $('.lite-followup-restore', historyItem);
        if (restoreBtn) {
          restoreBtn.click();
          const activeTab = $('.lite-followups-subtab[data-subtab="active"]');
          if (activeTab) activeTab.click();
          try {
            await poll(() => (findById(newId) ? true : null), 4000, 'item to return to the active list');
            restored = true;
          } catch (e) { /* restored stays false */ }
        }
      }

      const out = {
        title,
        newId,
        sourceAttr,
        sourceLabelText,
        expectedSourceLabel: EXPECTED_TRIAGE_SOURCE,
        sourceLabelOk,
        leftActive,
        movedToHistory,
        restored,
        pass: sourceLabelOk && leftActive && movedToHistory && restored,
      };
      results.followupsFlow = out;
      return out;
    },

    async snapshotFollowups() {
      // Helper (not a phase itself): collect every follow-up title currently held (active +
      // history) BEFORE a reload — the driver carries this JSON across the navigation the same
      // way readSkinSnapshot()/assertSkinTokens() do for the look-token phase above.
      // NOTE (caught live, 2026-07-14): clicking a subtab and reading the DOM in the same tick
      // can catch React's PRE-click render (batched update not yet flushed) — this produced a
      // false "same item in both active and history" snapshot the first time this ran. A short
      // settle after each click avoids it (same class of trap as the teamGrouped collapse poll).
      const settle = () => new Promise((r) => setTimeout(r, 200));
      this._clickTab('Follow-ups');
      await settle();
      const collect = () =>
        $$('.lite-followup-title').map((el) => (el.textContent || '').trim()).filter(Boolean);
      const activeTab = $('.lite-followups-subtab[data-subtab="active"]');
      const historyTab = $('.lite-followups-subtab[data-subtab="history"]');
      if (activeTab) activeTab.click();
      await settle();
      const activeTitles = collect();
      if (historyTab) historyTab.click();
      await settle();
      const historyTitles = collect();
      if (activeTab) activeTab.click();
      await settle();
      return { activeTitles, historyTitles, total: activeTitles.length + historyTitles.length };
    },

    async assertFollowupsPersist(before) {
      // Phase followupsPersist: called on a FRESH page load (after reload, snippet
      // re-injected) — every title captured by snapshotFollowups() before the reload must
      // still be present (localStorage-backed, not lost to an in-memory-only store).
      this._clickTab('Follow-ups');
      try {
        await poll(
          () => ($('.lite-followups-list') || $('.lite-followups-empty-note') ? true : null),
          8000,
          'follow-ups screen to mount',
        );
      } catch (e) { /* fall through — comparison below will report the mismatch */ }
      const after = await this.snapshotFollowups();
      const beforeAll = before ? [...before.activeTitles, ...before.historyTitles] : [];
      const afterAll = [...after.activeTitles, ...after.historyTitles];
      const missing = beforeAll.filter((t) => !afterAll.includes(t));
      const out = {
        before,
        after,
        missing,
        pass: !!before && before.total > 0 && missing.length === 0,
      };
      results.followupsPersist = out;
      return out;
    },

    flowVerdict() {
      const phases = {
        triageRenders: !!(results.triageRenders && results.triageRenders.pass),
        triageActions: !!(results.triageActions && results.triageActions.pass),
        followupsFlow: !!(results.followupsFlow && results.followupsFlow.pass),
        followupsPersist: !!(results.followupsPersist && results.followupsPersist.pass),
      };
      return { pass: Object.values(phases).every(Boolean), phases, results };
    },

    // ── feat-044 (lite-live-v02, PRD F4) — gapVerdict, independent aggregate, phase group C ──
    // "A closer look" comparison cards: gapDerive.ts derives them purely from LiteTeam project
    // fields (status reads steady, but a blocker says otherwise) — no person-level judgment, no
    // point-naming. See the top-of-file usage doc for the full run order and rationale.
    async assertGapsDerive() {
      // Phase gapsDerive: collect the team roster on Your team FIRST (screens are mutually-
      // exclusive mounts — Lite2App only renders one `screen` at a time, so `.home-person-card`
      // isn't in the DOM once we switch to A closer look) — needed for the person-name+digit
      // red-line scan below. Then switch tabs and assert: >=1 derived comparison card, each with
      // a claim pane, an evidence pane, and all four action controls; a whole-screen scan for
      // the banned vocabulary (ADR-0015 lock-in terms — PRD F4 explicitly bans "gap"/"差距"/
      // "现实差距"/"Nexus" from ever reaching this user-facing surface); and zero person-name+
      // digit co-occurrence (reuses the Ask redline's _askValueRe — same "no scored person"
      // shape, ADR-0023).
      this._clickTab('Team');
      try {
        await poll(() => ($$('.home-person-card').length > 0 ? true : null), 8000, 'person cards to read roster');
      } catch (e) { /* rosterNames stays whatever is in the DOM (possibly empty) */ }
      const rosterNames = $$('.home-person-card h3').map((el) => (el.textContent || '').trim()).filter(Boolean);

      this._clickTab('Worth noting');
      try {
        await poll(() => ($('.lite-closerlook') ? true : null), 8000, 'closer look screen to mount');
      } catch (e) { /* fall through — assertions below report absence */ }
      try {
        await poll(() => ($$('.lite-gap-card').length > 0 || $('.lite-gap-empty') ? true : null), 8000, 'gap cards or honest empty state to render');
      } catch (e) { /* fall through */ }

      const screen = $('.lite-closerlook');
      const screenText = (screen && screen.innerText) || '';
      const cards = $$('.lite-gap-card');

      const BANNED_TERMS = [
        { term: 'gap', re: /\bgap\b/i },
        { term: 'Nexus', re: /\bnexus\b/i },
        { term: '现实差距', re: /现实差距/ },
        { term: '差距', re: /差距/ },
      ];
      const bannedHits = BANNED_TERMS.filter((b) => b.re.test(screenText)).map((b) => b.term);
      const nameDigitPairs = rosterNames.filter((n) => n && this._askValueRe(n).test(screenText));

      const first = cards[0];
      const out = {
        gapCards: cards.length,
        bannedHits,
        nameDigitPairs,
        hasClaimPane: !!(first && $('.lite-gap-pane-claim', first)),
        hasEvidencePane: !!(first && $('.lite-gap-pane-evidence', first)),
        hasResolve: !!(first && $('.lite-gap-resolve', first)),
        hasDismiss: !!(first && $('.lite-gap-dismiss', first)),
        hasAsk: !!(first && $('.lite-gap-ask', first)),
        hasAddFollowup: !!(first && $('.lite-gap-addfollowup', first)),
        pass:
          cards.length >= 1 && bannedHits.length === 0 && nameDigitPairs.length === 0 && !!first &&
          !!$('.lite-gap-pane-claim', first) && !!$('.lite-gap-pane-evidence', first) &&
          !!$('.lite-gap-resolve', first) && !!$('.lite-gap-dismiss', first) &&
          !!$('.lite-gap-ask', first) && !!$('.lite-gap-addfollowup', first),
      };
      results.gapsDerive = out;
      return out;
    },

    async assertGapsResolve() {
      // Phase gapsResolve: resolve -> card leaves the active list, lands in the collapsible
      // history section with a "Settled"-shape badge, restorable; dismiss -> same shape with a
      // DIFFERENT badge (status must be visually distinguishable, not just "gone" — PRD F4).
      // Both sub-checks reuse the SAME single stub-derived card in sequence (restored between
      // steps) — the stub corpus honestly yields only one contradiction card (see the note above
      // assertGapsDerive), same pattern as assertTriageActions/assertFollowupsFlow reusing their
      // one honest stub card. Each mark is also confirmed written into the `lite2:flow:v1`
      // localStorage blob directly (not just React state) — the SAME save/load code path
      // flowStore.ts already had reload-proved for `followups` via followupsPersist (feat-043),
      // now extended with a `gapMarks` field; snapshotGaps() below additionally lets the driver
      // do a real full-page-reload check the same way snapshotFollowups()/assertFollowupsPersist
      // did, as supplementary (non-aggregated) evidence.
      this._clickTab('Worth noting');
      try {
        await poll(() => ($$('.lite-gap-card').length > 0 ? true : null), 8000, 'a gap card to act on');
      } catch (e) { /* report below */ }
      const initialCount = $$('.lite-gap-card').length;
      if (initialCount < 1) return (results.gapsResolve = { pass: false, error: 'no gap cards to act on' });
      const gapId = $$('.lite-gap-card')[0].getAttribute('data-gap-id');
      const findHistoryItem = () =>
        $$('.lite-gap-history-item').find((el) => el.getAttribute('data-gap-id') === gapId) || null;
      const findActiveCard = () =>
        $$('.lite-gap-card').find((el) => el.getAttribute('data-gap-id') === gapId) || null;
      const readPersistedMark = () => {
        try {
          const raw = window.localStorage.getItem('lite2:flow:v1');
          if (!raw) return null;
          const parsed = JSON.parse(raw);
          return (parsed.gapMarks || {})[gapId] || null;
        } catch (e) { return null; }
      };
      const openHistory = () => {
        if (!$('.lite-gap-history-list')) {
          const toggle = $('.lite-gap-history-toggle');
          if (toggle) toggle.click();
        }
      };

      // ── 1) RESOLVE ──
      $('.lite-gap-resolve', $$('.lite-gap-card')[0]).click();
      let resolveLeavesActive = false;
      try {
        await poll(() => ($$('.lite-gap-card').length < initialCount ? true : null), 4000, 'active count to drop after resolve');
        resolveLeavesActive = true;
      } catch (e) { /* stays false */ }
      openHistory();
      let resolvedInHistory = false;
      let resolvedBadgeText = '';
      try {
        await poll(() => (findHistoryItem() ? true : null), 4000, 'resolved item to appear in history');
        resolvedInHistory = true;
        const el = findHistoryItem();
        resolvedBadgeText = ((el && $('.lite-gap-history-badge', el)) || {}).textContent || '';
      } catch (e) { /* stays false */ }
      const resolvePersisted = readPersistedMark() === 'resolved';
      const restoreBtn1 = findHistoryItem() && $('.lite-gap-restore', findHistoryItem());
      if (restoreBtn1) restoreBtn1.click();
      try {
        await poll(() => ($$('.lite-gap-card').length === initialCount ? true : null), 4000, 'card restored after resolve undo');
      } catch (e) { /* fall through — dismiss sub-check reports its own failure if this didn't stick */ }

      // ── 2) DISMISS ──
      let dismissLeavesActive = false;
      let dismissedInHistory = false;
      let dismissedBadgeText = '';
      const cardAgain = findActiveCard();
      if (cardAgain) {
        $('.lite-gap-dismiss', cardAgain).click();
        try {
          await poll(() => ($$('.lite-gap-card').length < initialCount ? true : null), 4000, 'active count to drop after dismiss');
          dismissLeavesActive = true;
        } catch (e) { /* stays false */ }
        openHistory();
        try {
          await poll(() => (findHistoryItem() ? true : null), 4000, 'dismissed item to appear in history');
          dismissedInHistory = true;
          const el = findHistoryItem();
          dismissedBadgeText = ((el && $('.lite-gap-history-badge', el)) || {}).textContent || '';
        } catch (e) { /* stays false */ }
      }
      const dismissPersisted = readPersistedMark() === 'dismissed';
      // Restore back to active — leaves a clean baseline for assertGapsToAsk.
      const restoreBtn2 = findHistoryItem() && $('.lite-gap-restore', findHistoryItem());
      if (restoreBtn2) restoreBtn2.click();
      try {
        await poll(() => ($$('.lite-gap-card').length === initialCount ? true : null), 4000, 'card restored after dismiss undo');
      } catch (e) { /* fall through */ }

      const badgesDistinct = !!resolvedBadgeText && !!dismissedBadgeText && resolvedBadgeText !== dismissedBadgeText;
      const out = {
        gapId,
        resolveLeavesActive, resolvedInHistory, resolvedBadgeText, resolvePersisted,
        dismissLeavesActive, dismissedInHistory, dismissedBadgeText, dismissPersisted,
        badgesDistinct,
        pass: resolveLeavesActive && resolvedInHistory && resolvePersisted &&
          dismissLeavesActive && dismissedInHistory && dismissPersisted && badgesDistinct,
      };
      results.gapsResolve = out;
      return out;
    },

    snapshotGaps() {
      // Helper (not a phase itself, matches readSkinSnapshot()/snapshotFollowups() pattern):
      // read the gapMarks field straight out of the SAME `lite2:flow:v1` localStorage blob the
      // marks are persisted to — used by the driver to prove the marks survive an actual
      // full-page reload (supplementary to the in-page localStorage read inside
      // assertGapsResolve, not folded into gapVerdict()'s 3-phase aggregate per kickoff-dev.md).
      try {
        const raw = window.localStorage.getItem('lite2:flow:v1');
        if (!raw) return { gapMarks: {} };
        const parsed = JSON.parse(raw);
        return { gapMarks: parsed.gapMarks || {} };
      } catch (e) {
        return { gapMarks: {}, error: String(e) };
      }
    },

    async assertGapsToAsk() {
      // Phase gapsToAsk: a gap card's "Ask them directly" -> screen switches to The room with
      // the composer pre-filled with that card's project title + claim/evidence context (NOT
      // auto-submitted — manager reviews before it goes out, same authorship principle as the
      // triage "take to the room" flow, feat-036/kickoff-dev.md §Feature 切分).
      this._clickTab('Worth noting');
      try {
        await poll(() => ($$('.lite-gap-card').length > 0 ? true : null), 8000, 'a gap card to act on');
      } catch (e) { /* report below */ }
      const card = $$('.lite-gap-card')[0];
      if (!card) return (results.gapsToAsk = { pass: false, error: 'no gap card to act on' });
      const titleEl = $('.lite-gap-project-title', card);
      const projectTitle = ((titleEl && titleEl.textContent) || '').trim();
      const askBtn = $('.lite-gap-ask', card);
      if (!askBtn) return (results.gapsToAsk = { pass: false, error: 'no .lite-gap-ask button' });
      askBtn.click();
      let switchedToRoom = false;
      let composerValue = '';
      try {
        await poll(() => ($('.lite-room') && $('.nexus-followup-composer input') ? true : null), 6000, 'room + composer to mount');
        switchedToRoom = true;
        const input = $('.nexus-followup-composer input');
        composerValue = input ? input.value : '';
      } catch (e) { /* switchedToRoom stays false */ }
      const containsProjectRef = !!composerValue && !!projectTitle && composerValue.includes(projectTitle);
      const out = {
        projectTitle,
        switchedToRoom,
        composerValueSample: composerValue.slice(0, 160),
        containsProjectRef,
        pass: switchedToRoom && containsProjectRef,
      };
      results.gapsToAsk = out;
      return out;
    },

    gapVerdict() {
      const phases = {
        gapsDerive: !!(results.gapsDerive && results.gapsDerive.pass),
        gapsResolve: !!(results.gapsResolve && results.gapsResolve.pass),
        gapsToAsk: !!(results.gapsToAsk && results.gapsToAsk.pass),
      };
      return { pass: Object.values(phases).every(Boolean), phases, results };
    },

    // ── feat-045 (lite-live-v02, PRD F5+F7) — nudgeVerdict, independent aggregate, group D ────
    // Onboarding wizard (overlay, first-visit via localStorage) + room empty-state suggestion
    // chips + REAL-event notification bell. See the top-of-file usage doc for the five-page
    // drive order; first-visit state lives in `lite2:`-prefixed localStorage keys, so the driver
    // clears those (and ONLY those) between runs.
    _wizard() { return $('.lite-onboard'); },
    _wizardStep() { const w = this._wizard(); return w ? w.getAttribute('data-onboard-step') : null; },
    async _settleNudge(ms) { return new Promise((r) => setTimeout(r, ms || 250)); },
    // Confirm an element NEVER shows up inside a window (poll-for-absence — the inverse of poll).
    async _staysAbsent(sel, ms) {
      const t0 = Date.now();
      for (;;) {
        if ($(sel)) return false;
        if (Date.now() - t0 > ms) return true;
        await this._settleNudge(200);
      }
    },
    _injectFileInto(input, name) {
      const dt = new DataTransfer();
      const bytes = new TextEncoder().encode('name,role\nA colleague,Coordinator\n');
      dt.items.add(new File([bytes], name, { type: 'text/csv' }));
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    },
    _setInput(el, value) {
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    },

    async onboardWalkthrough() {
      // Helper (page A of the drive order — returns JSON the driver carries to
      // assertOnboardPersist after the reload). Walks all four steps on a CLEAN first visit:
      // upload (REAL store.uploadFiles through the wizard's own input — stub settles instantly),
      // team info, playbook selection (changed from the default set), done summary, finish.
      const out = { sawWizard: false, startStep: null, uploadReady: false, filledTeam: false,
        defaultIds: [], chosenIds: [], differsFromDefault: false, summaryIds: [],
        summaryMatches: false, greetingHasName: false, finished: false };
      try { await poll(() => (this._wizard() ? true : null), 10000, 'onboarding wizard to mount on first visit'); } catch (e) { return out; }
      out.sawWizard = true;
      out.startStep = this._wizardStep();

      // ── step 0: doors（input-side-0721 闸门页新增三扇门步）——走「上传自己的材料」那扇门。
      // 示例团队门归 verify-onboard-gate.mjs 专门验，这里的走查沿上传主线。
      if (this._wizardStep() === 'doors') {
        const doorUpload = $('.lite-gate-door-upload');
        if (doorUpload) doorUpload.click();
        try { await poll(() => (this._wizardStep() === 'upload' ? true : null), 5000, 'doors to advance to upload step'); } catch (e) { return out; }
      }

      // ── step: upload (real ingest through the wizard) ──
      const upInput = $('.lite-onboard-upload-input');
      if (upInput) {
        this._injectFileInto(upInput, 'wizard-roster.csv');
        try {
          await poll(() => ($('.lite-onboard-upload-ready') ? true : null), 15000, 'wizard upload to settle (stub)');
          out.uploadReady = true;
        } catch (e) { /* stays false */ }
      }
      const next1 = $('.lite-onboard-next');
      if (next1) next1.click();
      try { await poll(() => (this._wizardStep() === 'team' ? true : null), 5000, 'wizard to advance to team step'); } catch (e) { return out; }

      // ── step: team info (local config, used for greetings) ──
      const company = $('input.lite-onboard-company');
      const dept = $('input.lite-onboard-dept');
      const name = $('input.lite-onboard-name');
      if (company) this._setInput(company, 'Prism Works');
      if (dept) this._setInput(dept, 'Operations');
      if (name) this._setInput(name, 'Danny');
      out.filledTeam = !!(company && dept && name);
      const next2 = $('.lite-onboard-next');
      if (next2) next2.click();
      try { await poll(() => (this._wizardStep() === 'playbooks' ? true : null), 5000, 'wizard to advance to playbooks step'); } catch (e) { return out; }

      // ── step: playbooks — CHANGE the selection so persistence can't pass on defaults alone ──
      const chips = () => $$('.lite-onboard-playbook');
      const pressedIds = () => chips().filter((c) => c.getAttribute('aria-pressed') === 'true')
        .map((c) => c.getAttribute('data-playbook-id')).filter(Boolean);
      out.defaultIds = pressedIds().sort();
      const firstOn = chips().find((c) => c.getAttribute('aria-pressed') === 'true');
      const offs = chips().filter((c) => c.getAttribute('aria-pressed') !== 'true');
      if (firstOn) firstOn.click();
      if (offs[0]) offs[0].click();
      if (offs[1]) offs[1].click();
      try {
        await poll(() => (pressedIds().length === out.defaultIds.length + 1 ? true : null), 5000, 'playbook toggles to stick');
      } catch (e) { /* fall through — chosenIds below reports the actual state */ }
      out.chosenIds = pressedIds().sort();
      out.differsFromDefault = JSON.stringify(out.chosenIds) !== JSON.stringify(out.defaultIds);
      const next3 = $('.lite-onboard-next');
      if (next3) next3.click();
      try { await poll(() => (this._wizardStep() === 'done' ? true : null), 5000, 'wizard to advance to done step'); } catch (e) { return out; }

      // ── step: done — summary must list exactly the chosen ids; greeting uses the name ──
      out.summaryIds = $$('.lite-onboard-summary-item')
        .map((el) => el.getAttribute('data-playbook-id')).filter(Boolean).sort();
      out.summaryMatches = JSON.stringify(out.summaryIds) === JSON.stringify(out.chosenIds);
      out.greetingHasName = ((this._wizard() || {}).innerText || '').includes('Danny');
      const finish = $('.lite-onboard-finish');
      if (finish) finish.click();
      try {
        await poll(() => (!this._wizard() ? true : null), 5000, 'wizard to close after finish');
        out.finished = true;
      } catch (e) { /* stays false */ }
      return out;
    },

    async assertOnboardPersist(walk) {
      // Phase onboardPersist (page B, after a REAL reload): the wizard must NOT re-appear, and
      // the Playbooks tab must reflect the SPECIFIC chosen ids (data-playbook-id set equality,
      // not a count), every chosen slot carrying the honest Coming-grammar tag.
      const wizardStaysAway = await this._staysAbsent('.lite-onboard', 2500);
      this._clickTab('Playbooks');
      try { await poll(() => ($('.lite-playbooks') ? true : null), 8000, 'playbooks screen to mount'); } catch (e) { /* report below */ }
      const slots = $$('.lite-playbooks-slot[data-playbook-id]');
      const slotIds = slots.map((s) => s.getAttribute('data-playbook-id')).sort();
      const expected = (walk && walk.chosenIds) || [];
      const exactMatch = expected.length > 0 && JSON.stringify(slotIds) === JSON.stringify(expected);
      const allTagged = slots.length > 0 && slots.every((s) => s.querySelector('.lite-playbooks-slot-tag'));
      const out = {
        walk: walk || null,
        wizardStaysAway,
        slotIds,
        expectedIds: expected,
        exactMatch,
        allTagged,
        pass: !!walk && walk.sawWizard && walk.uploadReady && walk.differsFromDefault &&
          walk.summaryMatches && walk.finished && wizardStaysAway && exactMatch && allTagged,
      };
      results.onboardPersist = out;
      return out;
    },

    async assertOnboardEscape() {
      // Phase onboardEscape (page C, cleared state — added on adversarial-verify rework
      // 2026-07-14): the wizard is an aria-modal dialog, so Escape MUST work — and it must mean
      // PAUSE (same as the × control: progress kept, resumes next visit), not skip/dismiss.
      // Advance one step first so "progress preserved" is a real assertion (the persisted step
      // must equal the ADVANCED step after the close, not the default 'upload').
      const out = {
        sawWizard: false, advanced: false, stepBefore: null, closedOnEscape: false,
        persistedStatus: null, persistedStep: null, statusOk: false, stepPreserved: false,
        pass: false,
      };
      try { await poll(() => (this._wizard() ? true : null), 10000, 'wizard to mount for escape run'); } catch (e) { results.onboardEscape = out; return out; }
      out.sawWizard = true;
      // input-side-0721：清态首访落在 doors 步（没有 Next 键——门就是导航）。"先走一步再 Escape"
      // 的推进动作改成过上传门：doors → upload 就是真实的一步，persisted step 必须停在 upload。
      const doorUpload = $('.lite-gate-door-upload');
      if (doorUpload) doorUpload.click();
      try {
        await poll(() => (this._wizardStep() === 'upload' ? true : null), 5000, 'wizard to advance before escape');
        out.advanced = true;
      } catch (e) { /* stays false — stepBefore below records whatever it is */ }
      out.stepBefore = this._wizardStep();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      try {
        await poll(() => (!this._wizard() ? true : null), 4000, 'wizard to close on Escape');
        out.closedOnEscape = true;
      } catch (e) { /* stays false */ }
      try {
        const raw = window.localStorage.getItem('lite2:onboard:v1');
        const parsed = raw ? JSON.parse(raw) : null;
        out.persistedStatus = parsed ? parsed.status : null;
        out.persistedStep = parsed ? parsed.step : null;
      } catch (e) { /* stays null */ }
      out.statusOk = out.persistedStatus === 'in-progress'; // pause, NOT skipped/done
      out.stepPreserved = !!out.stepBefore && out.persistedStep === out.stepBefore;
      out.pass = out.sawWizard && out.advanced && out.closedOnEscape && out.statusOk && out.stepPreserved;
      results.onboardEscape = out;
      return out;
    },

    async onboardSkipNow() {
      // Helper (page D — after the escape run's reload, the wizard RESUMES at the saved step;
      // originally page C on a fresh cleared state): the wizard appears; the skip control closes it.
      const out = { sawWizard: false, skipClosed: false };
      try { await poll(() => (this._wizard() ? true : null), 10000, 'onboarding wizard to mount for skip run'); } catch (e) { return out; }
      out.sawWizard = true;
      const skip = $('.lite-onboard-skip');
      if (!skip) return out;
      skip.click();
      try {
        await poll(() => (!this._wizard() ? true : null), 5000, 'wizard to close after skip');
        out.skipClosed = true;
      } catch (e) { /* stays false */ }
      return out;
    },

    async assertOnboardSkip(skipRun) {
      // Phase onboardSkip (page D, after a REAL reload): skipping is remembered — the wizard
      // never mounts again on later visits.
      const wizardStaysAway = await this._staysAbsent('.lite-onboard', 2500);
      const out = {
        skipRun: skipRun || null,
        wizardStaysAway,
        pass: !!skipRun && skipRun.sawWizard && skipRun.skipClosed && wizardStaysAway,
      };
      results.onboardSkip = out;
      return out;
    },

    async assertChipsAsk() {
      // Phase chipsAsk: The room's empty state renders EXACTLY 4 suggestion chips (distinct
      // stable data-chip-id, non-empty copy); clicking one fires a REAL askLive run — the
      // terminal mounts and SSE frames render (same dynamic shape as phase F2). Run this on a
      // page where the wizard is already out of the way (post-skip); defensively skips if up.
      if (this._wizard()) {
        const skip = $('.lite-onboard-skip');
        if (skip) skip.click();
        try { await poll(() => (!this._wizard() ? true : null), 5000, 'wizard to close before chips'); } catch (e) { /* fall through */ }
      }
      this._clickTab('Ask Avery');
      try { await poll(() => ($('.nexus-empty') ? true : null), 8000, 'room empty state to mount'); } catch (e) { /* report below */ }
      const chips = $$('.lite-room-chip');
      const chipIds = chips.map((c) => c.getAttribute('data-chip-id')).filter(Boolean);
      const chipTexts = chips.map((c) => (c.textContent || '').trim());
      const idsDistinct = new Set(chipIds).size === chips.length;
      const textsNonEmpty = chipTexts.every((t) => t.length > 0);
      let framesSeen = 0;
      let clicked = false;
      if (chips[0]) {
        chips[0].click();
        clicked = true;
        try {
          await poll(() => {
            const lines = $$('.nexus-terminal-log .terminal-line')
              .filter((l) => !l.classList.contains('terminal-cursor-line'));
            return lines.length > 0 ? lines.length : null;
          }, 20000, 'first SSE frame after chip click');
          framesSeen = $$('.nexus-terminal-log .terminal-line')
            .filter((l) => !l.classList.contains('terminal-cursor-line')).length;
        } catch (e) { /* framesSeen stays 0 */ }
      }
      const out = {
        chipCount: chips.length,
        chipIds,
        chipTexts,
        idsDistinct,
        textsNonEmpty,
        clicked,
        framesSeen,
        pass: chips.length === 4 && idsDistinct && textsNonEmpty && clicked && framesSeen > 0,
      };
      results.chipsAsk = out;
      return out;
    },

    async assertBellIsReal() {
      // Phase bellIsReal (page E, cleared state): notifications are driven ONLY by real events.
      //  1. Fresh state -> bell opens with ZERO items and an explicit empty marker (a hardcoded
      //     placeholder notification would fail right here — the partner build's five fakes are
      //     the anti-pattern this phase exists to block).
      //  2. A real stub ingest -> EXACTLY one 'ingest' item appears, plus EXACTLY one 'gap' item
      //     (the stub corpus honestly contains one contradiction, pr_portal, so the new-gap-card
      //     event fires too — exact event-type multiset, not count>0).
      //  3. A composer-driven run to completion -> EXACTLY one 'run' item joins them; final
      //     multiset === {gap, ingest, run} and nothing else.
      //  4. The unread badge shows while unread items exist, and mark-all-read clears it.
      if (this._wizard()) {
        const skip = $('.lite-onboard-skip');
        if (skip) skip.click();
        try { await poll(() => (!this._wizard() ? true : null), 5000, 'wizard to close before bell run'); } catch (e) { /* fall through */ }
      }
      const kindsNow = () => $$('.lite-notif-item').map((el) => el.getAttribute('data-notif-kind')).sort();
      const openBell = async () => {
        if (!$('.lite-bell-pop')) {
          const t = $('.lite-bell-toggle');
          if (t) t.click();
          try { await poll(() => ($('.lite-bell-pop') ? true : null), 4000, 'bell popover to open'); } catch (e) { /* report below */ }
        }
      };

      // ── 1) zero state ──
      const bellPresent = !!$('.lite-bell-toggle');
      if (!bellPresent) return (results.bellIsReal = { pass: false, error: 'no .lite-bell-toggle in DOM' });
      await openBell();
      const initialItems = $$('.lite-notif-item').length;
      const emptyMarker = !!$('.lite-bell-empty');

      // ── 2) real stub ingest -> exactly {gap, ingest} ──
      this._clickTab('Team');
      let ingestOk = false;
      const upInput = $('.upload-input');
      if (upInput) {
        this._injectFileInto(upInput, 'bell-roster.csv');
        try {
          await poll(() => ($('.upload-ready') ? true : null), 15000, 'stub ingest to settle');
          ingestOk = true;
        } catch (e) { /* stays false */ }
      }
      await openBell();
      let afterIngestKinds = [];
      try {
        afterIngestKinds = await poll(() => {
          const k = kindsNow();
          return k.includes('ingest') ? k : null;
        }, 8000, 'ingest notification to land');
      } catch (e) { afterIngestKinds = kindsNow(); }
      const ingestExact = JSON.stringify(afterIngestKinds) === JSON.stringify(['gap', 'ingest']);

      // ── 3) run to completion -> exactly {gap, ingest, run} ──
      this._clickTab('Ask Avery');
      let runOk = false;
      try {
        await poll(() => ($('.nexus-followup-composer input') ? true : null), 6000, 'room composer to mount');
        const input = $('.nexus-followup-composer input');
        const form = input.closest('form');
        this._setInput(input, 'How does the pilot look this week?');
        if (typeof form.requestSubmit === 'function') form.requestSubmit();
        else form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        await poll(() => ($('.terminal-line.is-manifest') ? true : null), 30000, 'stub run to complete');
        runOk = true;
      } catch (e) { /* stays false */ }
      await openBell();
      let finalKinds = [];
      try {
        finalKinds = await poll(() => {
          const k = kindsNow();
          return k.includes('run') ? k : null;
        }, 8000, 'run notification to land');
      } catch (e) { finalKinds = kindsNow(); }
      const finalExact = JSON.stringify(finalKinds) === JSON.stringify(['gap', 'ingest', 'run']);

      // ── 4) clicking a notification ROUTES to its mapped tab and marks THAT item read ──
      // (coverage added on adversarial-verify rework 2026-07-14: NOTIF_TARGET wiring was
      // implemented but never gate-exercised). Use the 'gap' item — it routes to A closer look,
      // a screen we are NOT currently on (we just ran in The room), so the switch is a real
      // assertion, not a no-op.
      const badgeShown = !!$('.lite-bell-badge');
      let routeClicked = false;
      let routedToCloserLook = false;
      let clickedItemRead = false;
      let routedNotifId = null;
      await openBell();
      const gapItem = $$('.lite-notif-item').find((el) => el.getAttribute('data-notif-kind') === 'gap');
      if (gapItem) {
        routedNotifId = gapItem.getAttribute('data-notif-id');
        gapItem.click();
        routeClicked = true;
        try {
          await poll(() => {
            const shell = $('.lite2-shell');
            return shell && shell.getAttribute('data-scene') === 'closerlook' ? true : null;
          }, 5000, 'notification click to route to A closer look');
          routedToCloserLook = true;
        } catch (e) { /* stays false */ }
        // The clicked item must now be read (is-unread gone on that data-notif-id).
        await openBell(); // click closed the popover — reopen to inspect the item state
        try {
          await poll(() => {
            const el = $$('.lite-notif-item').find((x) => x.getAttribute('data-notif-id') === routedNotifId);
            return el && !el.classList.contains('is-unread') ? true : null;
          }, 4000, 'clicked notification to be marked read');
          clickedItemRead = true;
        } catch (e) { /* stays false */ }
      }

      // ── 5) unread badge + mark-all-read (ingest/run items are still unread at this point) ──
      let markAllWorks = false;
      const markAll = $('.lite-bell-markall');
      if (markAll) {
        markAll.click();
        try {
          await poll(() => (!$('.lite-bell-badge') ? true : null), 4000, 'unread badge to clear after mark-all');
          markAllWorks = true;
        } catch (e) { /* stays false */ }
      }

      const out = {
        bellPresent,
        initialItems,
        emptyMarker,
        ingestOk,
        afterIngestKinds,
        ingestExact,
        runOk,
        finalKinds,
        finalExact,
        badgeShown,
        routeClicked,
        routedToCloserLook,
        clickedItemRead,
        markAllWorks,
        pass: bellPresent && initialItems === 0 && emptyMarker && ingestOk && ingestExact &&
          runOk && finalExact && badgeShown && routeClicked && routedToCloserLook &&
          clickedItemRead && markAllWorks,
      };
      results.bellIsReal = out;
      return out;
    },

    nudgeVerdict(carried) {
      // Cross-navigation aggregate (group D): phases onboardPersist/onboardSkip ran on EARLIER
      // page loads — the driver carries their returned JSON forward and passes it here (same
      // driver-carries-JSON doctrine as v2Verdict's externally-computed phases). In-page results
      // (from this load) win only if the carried slot is absent.
      const merged = Object.assign({}, results);
      if (carried && typeof carried === 'object') {
        for (const k of ['onboardPersist', 'onboardEscape', 'onboardSkip', 'chipsAsk', 'bellIsReal']) {
          if (carried[k]) merged[k] = carried[k];
        }
      }
      const phases = {
        onboardPersist: !!(merged.onboardPersist && merged.onboardPersist.pass),
        onboardEscape: !!(merged.onboardEscape && merged.onboardEscape.pass),
        onboardSkip: !!(merged.onboardSkip && merged.onboardSkip.pass),
        chipsAsk: !!(merged.chipsAsk && merged.chipsAsk.pass),
        bellIsReal: !!(merged.bellIsReal && merged.bellIsReal.pass),
      };
      return { pass: Object.values(phases).every(Boolean), phases, results: merged };
    },

    // ── feat-046 (lite-live-v02) — skinVerdict, independent aggregate, phase group E ───────────
    // Aurora look polish pass. See the usage block above for the full 3-URL drive protocol.
    async readSkinProbe() {
      // Helper (not a phase itself): snapshot the full set of computed values the E-group phases
      // assert against. Clicks through Your team (for `.upload-panel`, the radius probe) and
      // Playbooks (for `.lite-playbooks-slot-tag`, the badge probe) internally — both render
      // unconditionally with zero setup (no ingest, no onboarding) so this is safe to call on a
      // clean stub page load. Returns to Your team before resolving.
      const shell = $('.lite2-shell');
      if (!shell) return null;
      const cs = (el) => getComputedStyle(el);
      const out = { skinAttr: shell.getAttribute('data-look') };
      const shellCs = cs(shell);
      out.shellFontSize = shellCs.fontSize;
      out.shellBackgroundImage = shellCs.backgroundImage;
      const footer = $('.lite2-compliance-footer'); // always mounted (Lite2App renders it outside the screen switch)
      out.footerBackgroundColor = footer ? cs(footer).backgroundColor : null;
      const tabs = $('.scene-tabs'); // always mounted (topbar)
      out.tabsBackgroundColor = tabs ? cs(tabs).backgroundColor : null;
      out.tabsBackdropFilter = tabs ? (cs(tabs).backdropFilter || cs(tabs).webkitBackdropFilter) : null;
      out.tabsBoxShadow = tabs ? cs(tabs).boxShadow : null;
      // cr-align 棒2：aurora 的玻璃 chrome 从 .scene-tabs pill 上移到整条 .prototype-topbar
      // slab——aurora 相位改读 topbar 四值（paper 相位不读这些：PAPER_BASELINE 无此四键，
      // paper 的 .scene-tabs 探针字段原样保留、基线一字未动）。
      const bar = $('.prototype-topbar');
      out.topbarBackgroundColor = bar ? cs(bar).backgroundColor : null;
      out.topbarBackdropFilter = bar ? (cs(bar).backdropFilter || cs(bar).webkitBackdropFilter) : null;
      out.topbarBoxShadow = bar ? cs(bar).boxShadow : null;
      out.topbarBorderRadius = bar ? cs(bar).borderRadius : null;
      const activeTab = $('.scene-tab.is-active');
      out.activeTabBackgroundColor = activeTab ? cs(activeTab).backgroundColor : null;

      this._clickTab('Team');
      try {
        await poll(() => ($('.upload-panel') || $('.home-lane-people') ? true : null), 4000, 'team screen to settle');
      } catch (e) { /* fall through — uploadPanel probe reports null below */ }
      const uploadPanel = $('.upload-panel');
      out.uploadPanelBorderRadius = uploadPanel ? cs(uploadPanel).borderRadius : null;

      this._clickTab('Playbooks');
      try {
        await poll(() => ($('.lite-playbooks-slot-tag') ? true : null), 4000, 'playbooks slot tag to mount');
      } catch (e) { /* fall through */ }
      const tag = $('.lite-playbooks-slot-tag');
      out.playbookTagBackgroundColor = tag ? cs(tag).backgroundColor : null;
      out.playbookTagColor = tag ? cs(tag).color : null;

      this._clickTab('Team'); // leave the page on a neutral default screen
      return out;
    },

    assertAuroraApplied(probe) {
      // Phase auroraApplied: `?look=aurora` — 11 independently-checked computed values (>= the
      // kickoff's required 8), each a POSITIVE assertion against the target aurora shape (not
      // merely "differs from paper" — a regression to some other wrong value would still be
      // caught). Target values sourced from kickoff-dev.md §feat-046 / the partner reference
      // library's src/app/globals.css color table.
      const p = probe || {};
      const str = (v) => typeof v === 'string';
      const checks = {
        skinAttrIsAurora: p.skinAttr === 'aurora',
        bgHasAuroraVioletStop: str(p.shellBackgroundImage) && p.shellBackgroundImage.includes('168, 139, 255'),
        bgHasAuroraCyanStop: str(p.shellBackgroundImage) && p.shellBackgroundImage.includes('51, 199, 232'),
        // cr-align 棒2（2026-07-21）字面量重导出——来源 eval-harness/specs/cr-align-spec.json
        // stick-2 行（spec→门→码，不从构建反抄）：玻璃 chrome 上移到 .prototype-topbar slab
        // （tabsGlass*/tabsBlur/tabsShadow 三探针改读 topbar 四值）；活动 tab 按她的 nav pill
        // 语法转白底（activeTabIsNavy→White）。旧构建红证明：改后本组对棒1 构建跑必红
        // （topbar 无玻璃、活动 tab 还是 navy）。
        topbarGlassIsWhiteTinted: str(p.topbarBackgroundColor) && /rgba?\(255,\s*255,\s*255/.test(p.topbarBackgroundColor),
        topbarBlurIsStrong: str(p.topbarBackdropFilter) && p.topbarBackdropFilter.includes('20px') && p.topbarBackdropFilter.includes('saturate'),
        topbarShadowIsViolet: str(p.topbarBoxShadow) && p.topbarBoxShadow.includes('36, 32, 95'),
        topbarRadiusIsSlab: p.topbarBorderRadius === '16px',
        activeTabIsWhite: str(p.activeTabBackgroundColor) && /^rgb\(255, 255, 255\)$/.test(p.activeTabBackgroundColor),
        footerGlassIsWhiteTinted: str(p.footerBackgroundColor) && /rgba?\(255,\s*255,\s*255/.test(p.footerBackgroundColor),
        densityIsCompact: p.shellFontSize === '15px',
        radiusIsBumped: p.uploadPanelBorderRadius === '10px',
        playbookTagIsBlueBadgeBg: str(p.playbookTagBackgroundColor) && /rgba?\(238,\s*242,\s*255/.test(p.playbookTagBackgroundColor),
        playbookTagIsBlueBadgeFg: str(p.playbookTagColor) && /rgba?\(47,\s*75,\s*176/.test(p.playbookTagColor),
      };
      const pass = Object.values(checks).every(Boolean);
      const out = { probe: p, checks, pass };
      results.auroraApplied = out;
      return out;
    },

    // Literal computed-value snapshot captured LIVE on `integrate/v02-main-sync`@feff6be
    // (2026-07-14, before any feat-046 CSS edit) via `?v=2&mode=live&transport=stub&look=paper` —
    // not a guess. assertPaperUnchanged() diffs the current probe against these exact strings
    // field-by-field so any future paper drift (even unintended) goes red.
    PAPER_BASELINE: {
      skinAttr: 'paper',
      shellFontSize: '16px',
      shellBackgroundImage: 'radial-gradient(circle at 24% 18%, rgba(255, 255, 255, 0.9), rgba(0, 0, 0, 0) 28%), linear-gradient(135deg, rgb(251, 248, 240) 0%, rgb(240, 234, 223) 52%, rgb(249, 246, 239) 100%)',
      footerBackgroundColor: 'rgba(255, 253, 248, 0.82)',
      tabsBackgroundColor: 'rgba(255, 253, 248, 0.78)',
      tabsBackdropFilter: 'blur(12px)',
      tabsBoxShadow: 'rgba(50, 45, 36, 0.08) 0px 12px 40px 0px',
      activeTabBackgroundColor: 'rgb(29, 27, 23)',
      uploadPanelBorderRadius: '8px',
      playbookTagBackgroundColor: 'rgba(29, 27, 23, 0.06)',
      // cr-align 棒2（2026-07-21）补采：UIUX 棒（feat-068，2026-07-20）把 paper --ink-faint
      // #918b7f→#736c5f 修小字 AA（look-paper.css 注释在案），tag 字色随 token 合法移动——
      // E 组相位自 feat-046 后没人跑过，基线陈旧到今天才被 verify-skin-phases 逮住。
      // 旧值 rgb(145, 139, 127)；重采值来自棒1 构建实测（非本棒改动，本棒 paper 数值零动）。
      playbookTagColor: 'rgb(115, 108, 95)',
    },

    assertPaperUnchanged(probe) {
      // Phase paperUnchanged: `?look=paper` computed values must be byte-identical to
      // PAPER_BASELINE — proves the aurora polish pass touched zero paper pixels.
      const p = probe || {};
      const base = this.PAPER_BASELINE;
      const fields = Object.keys(base);
      const diffs = {};
      for (const f of fields) {
        if (p[f] !== base[f]) diffs[f] = { expected: base[f], actual: p[f] };
      }
      const out = { probe: p, diffs, pass: Object.keys(diffs).length === 0 };
      results.paperUnchanged = out;
      return out;
    },

    readLeakProbe() {
      // Helper for skinNoLeak: call on `?v=1&mode=live` and on `?mode=story`.
      // 🔴 2026-07-19: this used to say "the default URL (no `v=`)". Ruling ① flipped
      // resolveVersion()'s default to '2', so the bare URL is v02 — probing it would report
      // lite2ShellCount === 1 and fail, or worse, quietly measure the wrong shell.
      // `.scene-tabs` is the shared topbar chrome both v01 and story render —
      // reading its computed background proves `[data-look='aurora']`-scoped rules (which all
      // require a `.lite2-shell` ancestor to match at all) truly never reach outside lite2, not
      // just "structurally can't" by inspection.
      const tabs = $('.scene-tabs');
      return {
        lite2ShellCount: $$('.lite2-shell').length,
        tabsBackgroundColor: tabs ? getComputedStyle(tabs).backgroundColor : null,
      };
    },

    assertSkinNoLeak(defaultProbe, storyProbe) {
      // Phase skinNoLeak: both surfaces render ZERO .lite2-shell AND their shared `.scene-tabs`
      // chrome still computes to the ORIGINAL shared/00-base.css value (unaffected by feat-046).
      const ORIGINAL_TABS_BG = 'rgba(255, 253, 248, 0.78)';
      const ok = (probe) => !!probe && probe.lite2ShellCount === 0 && probe.tabsBackgroundColor === ORIGINAL_TABS_BG;
      const out = {
        defaultProbe, storyProbe,
        defaultOk: ok(defaultProbe),
        storyOk: ok(storyProbe),
        pass: ok(defaultProbe) && ok(storyProbe),
      };
      results.skinNoLeak = out;
      return out;
    },

    skinVerdict(carried) {
      // Cross-navigation aggregate (group E): phases run on separate page loads — the driver
      // carries their returned JSON forward and passes it here (same doctrine as v2Verdict).
      const merged = Object.assign({}, results);
      if (carried && typeof carried === 'object') {
        for (const k of ['auroraApplied', 'paperUnchanged', 'skinNoLeak']) {
          if (carried[k]) merged[k] = carried[k];
        }
      }
      const phases = {
        auroraApplied: !!(merged.auroraApplied && merged.auroraApplied.pass),
        paperUnchanged: !!(merged.paperUnchanged && merged.paperUnchanged.pass),
        skinNoLeak: !!(merged.skinNoLeak && merged.skinNoLeak.pass),
      };
      return { pass: Object.values(phases).every(Boolean), phases, results: merged };
    },

    // ── feat-047 (lite-live-v02) — syncVerdict, independent aggregate, phase group F ──────────
    // Engine sync (owner_token/header discipline, fetchFiles/fetchNotes) + notes/files surfaces.
    // See the usage block above for the full drive protocol (2 stub phases, 1 static-script
    // phase, 1 real-backend phase).
    async assertNotesSurfaceV2() {
      // Phase notesSurfaceV2: lite2's 7th tab, "Avery's notes" (ported from `lite`'s feat-033).
      // Same honesty contract as v01's assertNotesSurface: screen mounts; the red-line trust note
      // is present; populated OR an honest empty state; zero person-score-number leak on the
      // rendered observations; entries are READ-ONLY (not a <button> — only the source line is);
      // story-noun blacklist stays 0.
      this._clickTab("Avery's notes");
      try {
        await poll(() => ($('.lite-notes') ? true : null), 8000, 'lite2 notes surface to mount');
      } catch (e) { /* fall through — assertions below report absence */ }
      const screen = $('.lite-notes');
      const trustNote = $('.lite-notes-redline-note');
      const entries = $$('.lite-notes-entry');
      const populated = entries.length > 0;
      const emptyState = $('.lite-notes-empty');
      const entryText = $$('.lite-notes-entry-text').map((e) => e.innerText || '').join('\n');
      const numberLeak = BLOOD_BAR_RE.test(entryText) || /\b\d\s*\/\s*\d\b/.test(entryText)
        ? (entryText.match(BLOOD_BAR_RE) || entryText.match(/\b\d\s*\/\s*\d\b/) || [])[0] : null;
      const entryIsButton = $$('.lite-notes-entry').some((e) => e.tagName === 'BUTTON');
      const text = (screen && screen.innerText) || '';
      const storyHits = [];
      for (const noun of STORY_NOUNS) {
        const re = noun.includes(' ')
          ? new RegExp(noun.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
          : new RegExp('\\b' + noun + '\\b');
        if (re.test(text)) storyHits.push(noun);
      }
      const out = {
        screenPresent: !!screen,
        trustNotePresent: !!trustNote,
        populated,
        entryCount: entries.length,
        emptyStatePresent: !!emptyState,
        numberLeak,
        entryIsButton,
        storyHits,
        pass: !!screen && !!trustNote && (populated || !!emptyState) &&
          !numberLeak && !entryIsButton && storyHits.length === 0,
      };
      results.notesSurfaceV2 = out;
      return out;
    },

    async assertFilesSurfaceV2() {
      // Phase filesSurfaceV2: Your team's UploadPanel renders a persistent "your files" list
      // after ingest — one row per uploaded file, filename + a human-formatted size + n_chunks.
      // NOTE (documented deviation — see progress.md): the ACTUAL ported LiveFileEntry contract
      // (src/lite/transport.ts, byte-identical here — feat-047 didn't touch it) carries idx/
      // filename/size_bytes/mime/doc_kind/uploaded_at/n_chunks — no `status` field, no download
      // URL. src/lite's own UploadPanel doesn't render either. This phase checks what's real,
      // not an invented shape; call it AFTER a real or stub ingest (an empty upload-files block
      // is not tolerated here — unlike notesSurfaceV2, this phase is meant to run post-ingest).
      this._clickTab('Team');
      try {
        await poll(() => ($('.upload-files') ? true : null), 8000, 'upload files list to mount');
      } catch (e) { /* fall through — assertions below report absence */ }
      const filesBlock = $('.upload-files');
      const rows = $$('.upload-file-row');
      const rowsOk = rows.length > 0 && rows.every((r) => {
        const name = $('.upload-file-name', r);
        const meta = $('.upload-file-meta', r);
        return !!name && (name.textContent || '').trim().length > 0 &&
          !!meta && /\d/.test(meta.textContent || '') && /chunk|reference/i.test(meta.textContent || '');
      });
      const out = {
        filesBlockPresent: !!filesBlock,
        rowCount: rows.length,
        rowsOk,
        pass: !!filesBlock && rows.length > 0 && rowsOk,
      };
      results.filesSurfaceV2 = out;
      return out;
    },

    recordEnginePar(evidence) {
      // Phase enginePar: a pure static source-level comparison (scripts/gates/engine-par-check.mjs)
      // can't run from inside the browser — the driver runs it externally and records the JSON
      // verdict here (same doctrine as recordWallRed).
      results.enginePar = { pass: !!(evidence && evidence.pass), evidence };
      return results.enginePar;
    },

    _installTokenFetchSpy() {
      // Helper (not a phase itself): wrap `window.fetch` so assertTokenDiscipline can read back
      // the ACTUAL headers/URLs of every request the app makes — fetch is resolved off globalThis
      // at call time, so a spy installed by a snippet injected after the app already loaded still
      // intercepts every call transport.ts's createHttpTransport makes. Idempotent (installing
      // twice keeps the first log).
      if (window.__seedGateFetchLog) return window.__seedGateFetchLog;
      const log = [];
      window.__seedGateFetchLog = log;
      const orig = window.fetch.bind(window);
      window.fetch = (input, init) => {
        try {
          const url = typeof input === 'string' ? input : (input && input.url) || String(input);
          const headers = {};
          const h = (init && init.headers) || (input && input.headers);
          if (h) {
            if (typeof Headers !== 'undefined' && h instanceof Headers) {
              for (const [k, v] of h.entries()) headers[k.toLowerCase()] = v;
            } else if (Array.isArray(h)) {
              for (const [k, v] of h) headers[String(k).toLowerCase()] = v;
            } else {
              for (const k of Object.keys(h)) headers[k.toLowerCase()] = h[k];
            }
          }
          log.push({ url, headers, method: (init && init.method) || 'GET', t: Date.now() });
        } catch (e) { /* logging must never break the real call */ }
        return orig(input, init);
      };
      return log;
    },

    async assertTokenDiscipline() {
      // Phase tokenDiscipline (MOST IMPORTANT per kickoff-dev.md §合流契约附录 §2). REQUIRES the
      // REAL backend (no `?transport=stub`) — a scripted stub could fake header presence, so this
      // phase only means something against a real HTTP round-trip. Call AFTER a real ingest has
      // completed (`window.__lite2Store.getState().contextId`/`.ownerToken` both set). See the
      // usage block above for the full 5-part contract this checks.
      const store = window.__lite2Store;
      if (!store) {
        return (results.tokenDiscipline = {
          pass: false, error: 'window.__lite2Store not present — is this the real-backend `?v=2&mode=live` page, past feat-047\'s implementation?',
        });
      }
      const log = this._installTokenFetchSpy();
      const state0 = store.getState();
      const contextId = state0.contextId;
      const ownerToken = state0.ownerToken;
      if (!contextId || !ownerToken) {
        return (results.tokenDiscipline = {
          pass: false, error: 'no live contextId/ownerToken in store — ingest a real seed first', contextId, ownerToken,
        });
      }

      // (1) localStorage persists the token keyed by context_id (transport.ts's TOKEN_STORE_KEY).
      let tokenStore = null;
      try { tokenStore = JSON.parse(localStorage.getItem('lite2:ownerTokens:v1') || '{}'); } catch (e) { /* leave null */ }
      const tokenPersisted = !!tokenStore && tokenStore[contextId] === ownerToken;

      // (2)+(3) drive real read calls, then inspect exactly what went over the wire.
      log.length = 0; // only look at requests fired from here on
      await store.getState().refreshTeam();
      await store.getState().refreshFiles();
      await store.getState().refreshNotes();
      try {
        await poll(() => (log.some((r) => /\/team\//.test(r.url)) ? true : null), 20000, 'team/files/notes requests to fire');
      } catch (e) { /* fall through — the call-count checks below report absence honestly */ }

      const stripOrigin = (u) => u.replace(location.origin, '');
      const teamCalls = log.filter((r) => /\/team\/[^/]+(\?|$)/.test(stripOrigin(r.url)));
      const filesCalls = log.filter((r) => /\/team\/[^/]+\/files/.test(r.url));
      const notesCalls = log.filter((r) => /\/team\/[^/]+\/notes/.test(r.url));
      const hasHeaderEverywhere = (calls) =>
        calls.length > 0 && calls.every((r) => r.headers['x-avery-token'] === ownerToken);
      const teamHeaderOk = hasHeaderEverywhere(teamCalls);
      const filesHeaderOk = hasHeaderEverywhere(filesCalls);
      const notesHeaderOk = hasHeaderEverywhere(notesCalls);

      // token NEVER appears in any request URL (header-only encoding) — scan both the spy log
      // and the browser's own resource timing entries (independent evidence source).
      const urlLeakInLog = log.some((r) => r.url.includes(ownerToken));
      const resourceEntries = (performance.getEntriesByType('resource') || []).map((e) => e.name);
      const urlLeakInResourceTimeline = resourceEntries.some((u) => u.includes(ownerToken));

      // (4) missing token (bogus context, nothing stored for it) -> the frontend must not crash
      // and must NOT fabricate data — files/notes stay exactly as they were.
      const filesBefore = store.getState().files.length;
      const notesBefore = store.getState().notes.length;
      const bogusContextId = 'ctx_seedgate_bogus_' + Date.now();
      store.setState({ contextId: bogusContextId });
      let missingTokenCrashed = false;
      try {
        await store.getState().refreshFiles();
        await store.getState().refreshNotes();
      } catch (e) {
        missingTokenCrashed = true; // refreshFiles/refreshNotes are supposed to swallow errors
      }
      const stillHonestAfterMissing =
        !missingTokenCrashed &&
        store.getState().files.length === filesBefore &&
        store.getState().notes.length === notesBefore;
      store.setState({ contextId }); // restore real session state for later phases

      // (5) forged / missing-header requests straight at the REAL backend (bypassing the store
      // entirely) — proves the BACKEND enforces this, not just "the frontend never sent a bad one".
      const base = window.__seedGateApiBase || 'http://127.0.0.1:8137';
      let forgedStatus = null;
      let missingHeaderStatus = null;
      try {
        const r1 = await fetch(`${base}/team/${encodeURIComponent(contextId)}/files`, {
          headers: { 'X-Avery-Token': 'forged-not-a-real-token' },
        });
        forgedStatus = r1.status;
      } catch (e) { forgedStatus = 'network-error:' + String(e).slice(0, 80); }
      try {
        const r2 = await fetch(`${base}/team/${encodeURIComponent(contextId)}/files`);
        missingHeaderStatus = r2.status;
      } catch (e) { missingHeaderStatus = 'network-error:' + String(e).slice(0, 80); }

      const pageAlive = !!(document.body && document.body.isConnected);

      const out = {
        contextId, tokenPersisted,
        teamCallCount: teamCalls.length, filesCallCount: filesCalls.length, notesCallCount: notesCalls.length,
        teamHeaderOk, filesHeaderOk, notesHeaderOk,
        urlLeakInLog, urlLeakInResourceTimeline,
        missingTokenCrashed, stillHonestAfterMissing,
        forgedStatus, missingHeaderStatus,
        pageAlive,
        pass: tokenPersisted && teamHeaderOk && filesHeaderOk && notesHeaderOk &&
          !urlLeakInLog && !urlLeakInResourceTimeline && stillHonestAfterMissing &&
          forgedStatus === 404 && missingHeaderStatus === 404 && pageAlive,
      };
      results.tokenDiscipline = out;
      return out;
    },

    async assertAskStatusCoerce() {
      // Phase askStatusCoerce (feat-047 adversarial-verify BLOCKER, 2026-07-15) — ADR-0023 +
      // feat-034 stage C F1, verbatim: "前端 coerce 遇未知状态必须 fail-loud 或折 closed，绝不折回
      // draft（否则已发出/已撤回的 ask 会以可编辑草稿复活）". lite2's copy forked BEFORE stage C
      // and carried the 4-word vocabulary, folding EVERYTHING unknown -> 'draft' — so a real
      // backend's `revoked`/`expired` resurrected an already-withdrawn ask as an EDITABLE draft
      // whose Confirm button re-runs saveAsk+shareAsk against the real service.
      //
      // Drives lite2's OWN seam (window.__lite2Ask — v01's askStatusGuards drives __liteAsk; the
      // two shells' coerces are separate code and each needs its own coverage. lite2's was never
      // exercised by any gate, which is exactly why this survived to adversarial verify).
      // Checks BOTH paths a bad status can enter by:
      //   (1) the SSE manifest path  — coerceAskDraft directly;
      //   (2) the fetchAsk/refresh path — store.refreshAsk consuming a transport response, which
      //       is THE way a real backend actually delivers revoked/expired. lite2's store set the
      //       raw response straight into state with no coerce at all, so (1) alone proves nothing.
      // Then asserts the RENDERED card is a terminal state, not an editable draft.
      const dbg = window.__lite2Ask;
      const store = window.__lite2Store;
      if (!dbg || !dbg.coerceAskDraft || !store) {
        return (results.askStatusCoerce = {
          pass: false,
          error: 'no __lite2Ask/__lite2Store debug seam — is this the ?v=2 lite2 page?',
        });
      }
      const mk = (status) => dbg.coerceAskDraft({
        id: 'ask_gate_f_coerce', status,
        questions: [{ id: 'q1', kind: 'scale', text: 'How is the launch pacing?' }],
        recipients: [{ id: 'r1', name: 'Lin Qing' }],
        company_context_id: 'ctx_gate_coerce',
      });
      // (1) coerce-level vocabulary contract.
      const coerced = {
        revoked: (mk('revoked') || {}).status,
        expired: (mk('expired') || {}).status,
        unknown: (mk('totally-bogus-status') || {}).status,
        draftStillDraft: (mk('draft') || {}).status,
        closedStillClosed: (mk('closed') || {}).status,
      };
      const neverFoldsToDraft = coerced.revoked !== 'draft' && coerced.expired !== 'draft' &&
        coerced.unknown !== 'draft';
      const revokedKept = coerced.revoked === 'revoked';
      const expiredKept = coerced.expired === 'expired';
      const unknownFoldsClosed = coerced.unknown === 'closed';
      const knownStillWork = coerced.draftStillDraft === 'draft' && coerced.closedStillClosed === 'closed';

      // (2) the REAL delivery path: a transport handing back a terminal status through refreshAsk.
      // Swap in a tiny fake transport whose fetchAsk returns a POISONED payload — terminal status
      // AND an out-of-range receipt — and drive the real store action. Two things are under test:
      //   · the status must not become 'draft';
      //   · the response must actually pass through the defensive coerce at all. A store that
      //     sets the raw response into state "passes" a status check by accident (raw revoked
      //     stays revoked) while in fact guarding nothing — so the poisoned receipt is the
      //     discriminator: only a store that really coerces refuses it (lite's adoptAsk throws ->
      //     askError; a raw-passthrough store renders "99 out of 5").
      const prevAsk = store.getState().ask;
      const prevTransport = store.getState().transport;
      const seeded = mk('shared');           // must be a refreshable status for refreshAsk to fire
      let storePathStatus = null;
      let storePathThrew = false;
      let storePathCoerced = false;
      if (seeded) {
        store.setState({
          ask: { ...seeded, status: 'shared' },
          askBusy: 'idle', askError: null,
          transport: Object.assign({}, prevTransport, {
            async fetchAsk() {
              return {
                id: 'ask_gate_f_coerce', status: 'revoked',
                questions: [{ id: 'q1', kind: 'scale', text: 'How is the launch pacing?' }],
                recipients: [{
                  id: 'r1', name: 'Lin Qing',
                  receipt: { answers: [{ question_id: 'q1', value: 99 }], answered_at: '2026-07-15T10:00:00Z' },
                }],
              };
            },
          }),
        });
        try {
          await store.getState().refreshAsk();
        } catch (e) { storePathThrew = true; }
        const landed = store.getState().ask || {};
        storePathStatus = landed.status;
        // Coerced == the poisoned receipt never reached state (card refused, or receipt stripped).
        const landedReceipt = (landed.recipients || []).map((r) => r.receipt).filter(Boolean);
        const poisonRendered = landedReceipt.some((rc) =>
          (rc.answers || []).some((a) => typeof a.value === 'number' && (a.value < 1 || a.value > 5)));
        storePathCoerced = !poisonRendered;
      }
      const storePathNotDraft = storePathStatus !== 'draft';

      // (3) the RENDERED card: a terminal state must not offer the draft's editing surface.
      // lite2's RoomScreen only mounts AskCard inside its `hasStarted` branch, so a run must
      // exist before the card can render at all — seed `run.status` directly (same store-seam
      // technique v01's assertAskStatusGuards uses to render its two terminal states).
      // Do NOT drive a real askLive here: its onUpdate re-adopts the stream's own ask-draft on
      // EVERY emit whose askDraft id differs from the current ask — including onDone's final
      // emit, which lands AFTER any reasonable "run settled" poll and silently stomps the seeded
      // terminal ask back to the stub's DRAFT (cost this probe two red herrings). The stream is
      // irrelevant to what this phase tests: whether a terminal-status ask RENDERS as terminal.
      const terminal = mk('revoked');
      let domProbe = { mounted: false };
      const prevRun = store.getState().run;
      // feat-051: the current screen lives in the URL now, not in the store — read it off the
      // shell's data-scene (same ids `goScreen()` takes) so the restore below can navigate back.
      const prevShell = $('.lite2-shell');
      const prevScene = prevShell ? prevShell.getAttribute('data-scene') : null;
      if (terminal) {
        store.setState({ run: { ...prevRun, status: 'complete' }, ask: terminal, askBusy: 'idle' });
        this._clickTab('Ask Avery');
        // TRAP #2 (cost this probe a second red herring): the run above already left a DRAFT
        // ask-card mounted, so polling for `.lite-ask-card` PRESENCE resolves on the first tick
        // and reads STALE DOM before React commits the setState — the probe then reports the old
        // draft and reds for the wrong reason. Poll for the card to actually carry the seeded
        // status; on timeout, still read whatever IS there so a genuinely broken implementation
        // reports its real (wrong) shape instead of a bare 'unmounted'.
        try {
          await poll(
            () => {
              const c = $('.lite-ask-card');
              return c && c.getAttribute('data-ask-status') === 'revoked' ? true : null;
            },
            6000,
            'ask card to re-render as the seeded terminal state',
          );
        } catch (e) { /* fall through and report the real DOM below */ }
        const card = $('.lite-ask-card');
        if (card) {
          const confirm = $('.ask-confirm', card);
          domProbe = {
            mounted: true,
            dataStatus: card.getAttribute('data-ask-status'),
            editableInputs: $$('.ask-q-input', card).length,
            addButtons: $$('.ask-q-add', card).length,
            confirmPresent: !!confirm,
            confirmDisabled: confirm ? !!confirm.disabled : null,
            linkRows: $$('.ask-link-row', card).length,
            terminalNotePresent: !!$('.ask-revoked-note', card),
          };
        }
      }
      // A withdrawn ask must render as withdrawn: no editable question inputs, no add buttons,
      // and NO clickable Confirm (present-but-disabled is acceptable; present-and-clickable is not).
      const domIsTerminal = domProbe.mounted && domProbe.dataStatus === 'revoked' &&
        domProbe.editableInputs === 0 && domProbe.addButtons === 0 &&
        (!domProbe.confirmPresent || domProbe.confirmDisabled === true) &&
        domProbe.linkRows === 0 && domProbe.terminalNotePresent === true;

      // Leave the session EXACTLY as found — including `run` and the current screen. Seeding
      // run.status to mount the card (above) leaves hasStarted true and the page parked on The
      // room; a later phase (assertTriageActions' take-to-room sub-check) then reds for reasons
      // that have nothing to do with it. Caught live on this drive — restoring only ask/transport
      // is not enough, and a phase that poisons its neighbours is a gate defect, not a product one.
      // feat-051: the screen is a route now, so restoring it means NAVIGATING back, not writing a
      // store field. (`store.setState({ screen })` silently became a no-op under the router — it
      // wrote a key nobody reads and left the page on The room.)
      store.setState({ ask: prevAsk, transport: prevTransport, run: prevRun });
      if (prevScene) store.getState().goScreen(prevScene);

      const out = {
        coerced, neverFoldsToDraft, revokedKept, expiredKept, unknownFoldsClosed, knownStillWork,
        storePathStatus, storePathThrew, storePathNotDraft, storePathCoerced,
        domProbe, domIsTerminal,
        pass: neverFoldsToDraft && revokedKept && expiredKept && unknownFoldsClosed &&
          knownStillWork && storePathNotDraft && storePathCoerced && domIsTerminal,
      };
      results.askStatusCoerce = out;
      return out;
    },

    async assertAskAuthHeader(realContextId) {
      // Phase askAuthHeader (feat-047 adversarial-verify, redline path — same-root contract
      // drift): lite2's saveAsk/shareAsk/fetchAsk went out with ZERO X-Avery-Token header while
      // fetchTeam/fetchFiles/fetchNotes carried it — against the hardened real backend the ask
      // endpoints 404/500. Asserts all three manager-side ask calls present the owner_token.
      //
      // Driven against the REAL http transport (NOT the stub — the stub is offline and never
      // issues a fetch, so a header assertion there would be vacuous). Uses the same in-page
      // fetch spy as tokenDiscipline and reads the CAPTURED request headers: the assertion is
      // about what the CLIENT SENDS, so it holds whether or not the server accepts the payload.
      // Pass the real contextId from a completed ingest (assertTokenDiscipline's page).
      const store = window.__lite2Store;
      if (!store) return (results.askAuthHeader = { pass: false, error: 'no __lite2Store seam' });
      const state0 = store.getState();
      const contextId = realContextId || state0.contextId;
      const ownerToken = state0.ownerToken;
      if (!contextId || !ownerToken) {
        return (results.askAuthHeader = {
          pass: false, error: 'no live contextId/ownerToken — run a real ingest first', contextId,
        });
      }
      if (new URLSearchParams(location.search).get('transport') === 'stub') {
        return (results.askAuthHeader = {
          pass: false, error: 'stub transport issues no fetch — this phase needs the real http transport',
        });
      }
      const log = this._installTokenFetchSpy();
      const prevAsk = store.getState().ask;
      log.length = 0;

      // Seed a real draft bound to the real context, then drive the REAL store actions:
      // confirmAsk() -> saveAsk + shareAsk;  refreshAsk() -> fetchAsk.
      store.setState({
        ask: {
          id: 'ask_gate_authhdr', status: 'draft',
          questions: [{ id: 'q1', kind: 'scale', text: 'How is the pilot launch pacing this week?' }],
          recipients: [{ id: 'r1', name: 'Lin Qing' }],
          company_context_id: contextId,
        },
        askBusy: 'idle', askError: null,
      });
      await store.getState().confirmAsk();
      // refreshAsk only fires on shared/collecting — force the state so fetchAsk is exercised
      // even if the server rejected the save (the header is what's under test, not the payload).
      const afterConfirm = store.getState().ask;
      store.setState({
        ask: Object.assign({}, afterConfirm || {}, {
          id: (afterConfirm && afterConfirm.id) || 'ask_gate_authhdr',
          status: 'shared',
        }),
        askBusy: 'idle',
      });
      await store.getState().refreshAsk();

      const hdr = (r) => r.headers['x-avery-token'];
      const saveCalls = log.filter((r) => /\/ask$/.test(r.url.split('?')[0]) && r.method === 'POST');
      const shareCalls = log.filter((r) => /\/ask\/[^/]+\/share/.test(r.url));
      const fetchCalls = log.filter((r) => /\/ask\/[^/]+$/.test(r.url.split('?')[0]) && (r.method || 'GET') === 'GET');
      const allCarry = (calls) => calls.length > 0 && calls.every((r) => hdr(r) === ownerToken);
      const saveOk = allCarry(saveCalls);
      const shareOk = allCarry(shareCalls);
      const fetchOk = allCarry(fetchCalls);
      // token stays header-only here too (same rule as tokenDiscipline, re-checked on ask URLs).
      const urlLeak = log.some((r) => r.url.includes(ownerToken));

      store.setState({ ask: prevAsk, askBusy: 'idle', askError: null });

      const out = {
        contextId,
        saveCallCount: saveCalls.length, shareCallCount: shareCalls.length, fetchCallCount: fetchCalls.length,
        saveOk, shareOk, fetchOk, urlLeak,
        observedHeaders: {
          save: saveCalls.map(hdr), share: shareCalls.map(hdr), fetch: fetchCalls.map(hdr),
        },
        pass: saveOk && shareOk && fetchOk && !urlLeak,
      };
      results.askAuthHeader = out;
      return out;
    },

    syncVerdict(carried) {
      // Cross-navigation aggregate (group F): tokenDiscipline/askAuthHeader run on the real-backend
      // page, the rest on the stub page — the driver carries their JSON forward (same doctrine as
      // v2Verdict/skinVerdict).
      const merged = Object.assign({}, results);
      if (carried && typeof carried === 'object') {
        for (const k of ['tokenDiscipline', 'notesSurfaceV2', 'filesSurfaceV2', 'enginePar',
                         'askStatusCoerce', 'askAuthHeader']) {
          if (carried[k]) merged[k] = carried[k];
        }
      }
      const phases = {
        tokenDiscipline: !!(merged.tokenDiscipline && merged.tokenDiscipline.pass),
        notesSurfaceV2: !!(merged.notesSurfaceV2 && merged.notesSurfaceV2.pass),
        filesSurfaceV2: !!(merged.filesSurfaceV2 && merged.filesSurfaceV2.pass),
        enginePar: !!(merged.enginePar && merged.enginePar.pass),
        askStatusCoerce: !!(merged.askStatusCoerce && merged.askStatusCoerce.pass),
        askAuthHeader: !!(merged.askAuthHeader && merged.askAuthHeader.pass),
      };
      return { pass: Object.values(phases).every(Boolean), phases, results: merged };
    },
  };

  window.__seedGate = api;
  return 'seed gate loaded: ' + Object.keys(api).join(', ');
})();
