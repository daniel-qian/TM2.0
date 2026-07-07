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
 *   __seedGate.verdict()                                          // aggregate
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
        await poll(() => $('.upload-ready') || $('.upload-error'), 180000, 'ingest to settle');
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
      const input = composer.querySelector('textarea, input[type="text"]');
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
      const input = composer && composer.querySelector('textarea, input[type="text"]');
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
      };
      return { pass: Object.values(phases).every(Boolean), phases, results };
    },
  };

  window.__seedGate = api;
  return 'seed gate loaded: ' + Object.keys(api).join(', ');
})();
