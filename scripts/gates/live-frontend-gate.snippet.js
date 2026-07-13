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
      const text = cards.map((c) => c.innerText).join('\n');
      const out = {
        personCards: cards.length,
        hasLinQing: names.some((n) => /lin qing/i.test(n)),
        hasChenMingyuan: names.some((n) => /chen mingyuan/i.test(n)),
        bloodBarLeak: BLOOD_BAR_RE.test(text) ? text.match(BLOOD_BAR_RE)[0] : null,
        pass: false,
      };
      out.pass = cards.length >= 15 && out.hasLinQing && out.hasChenMingyuan && !out.bloodBarLeak;
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
      this._clickTab('Your team');
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
      this._clickTab('The room');
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
      if (!this._clickTab('Where this goes')) {
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
  };

  window.__seedGate = api;
  return 'seed gate loaded: ' + Object.keys(api).join(', ');
})();
