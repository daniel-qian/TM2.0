# Avery — landing page

A deployable single-page landing **scaffold** for Avery. Conversion destination
every channel points to: slug + demo video + advice-contrast eval + CTA.

> **Standalone by design (ADR-0001).** This lives in its own directory with its
> own `package.json`/build and does **not** touch the demo prototype's Vite app.
> It is structured to be lifted into its own Git repo at any time. To deploy on
> Vercel from this monorepo, set the project's **Root Directory** to `landing/`.

## Run locally

```bash
cd landing
npm install
npm run dev      # http://localhost:3000
npm run build    # production build (acceptance: builds clean)
```

## Sections — 2026-07-03 investor restructure (ADR-0018)

7 screens, reweighted for the securities/finance investor roadshow (market gap /
revenue model / ROI over eval data). Slug: **"Managers need safer HR decisions"**
("senior at your ear" retired). Chinese is the display language for the roadshow
(`?lang=zh`, MiniMax-M3 transcreation via `scripts/i18n-zh.mjs`).

| # | Screen | Notes |
|---|---|---|
| 1 | Hero | new slug; ghost CTA jumps to revenue screen |
| 2 | Product in one look | morning-briefing mock + 47m/94%/3× design targets w/ visible micro-label |
| 3 | Market gap + TAM | bottom-up formula on-page, SOM-forward; Landscape matrix folds in |
| 4 | ROI account | wrong-cut four costs + illustrative model ($180k vs ≈$11k/yr → 16×) |
| 5 | Revenue model | pricing tiers + component ranges + 60/20/15/5 mix + prove→tune→scale |
| 6 | Moat | playbooks IP / benchmark data / trust architecture; Playbooks/Modules/Eval fold in |
| 7 | CTA | buyer CTA + investor closing line (ties to SOM) |

Cut sections (Audience / DemoVideo / WhatItIs / WhyItMatters / TrustLayer /
Method / OutputShape / Stack) live in git history. Numbers policy per ADR-0018:
mock **model-shaped** numbers allowed (annotated in code comments); result-shaped
numbers carry an on-page micro-label; measured-claim numbers (eval scores) still
banned until real.

## ⚠ Real assets to drop in later

1. **Final demo video (feat-013).** Replace the placeholder block in
   `app/components/DemoVideo.tsx` (marked `▼ PLACEHOLDER`) with the real
   `<video>` / Mux / YouTube embed.
2. **Real eval transcripts + numbers (feat-011 / feat-012).** In
   `app/data/evalRows.ts`, every cell with `placeholder: true` is illustrative.
   Swap in the real blind-graded transcripts once the eval harness runs, and add
   the honest human-preference numbers (only when real — per DECISION-MEMO §4.1,
   no fake `N/X/M` footnote).
3. **The adversarial row's real authored case (feat-012).** Row
   `adversarial-kind-read-wrong` is shaped but uses placeholder copy; fill from
   the frozen "kind read is wrong" scenario.
4. **Email capture endpoint.** Wire the form in `app/components/BookCta.tsx`
   (`TODO(real-asset)`) to a real list/scheduler (e.g. Formspree / ConvertKit /
   Cal.com link).
5. **Domain.** `avery.???` — pending the domain decision (P7-06 open Q).
6. **Danny 审字.** Every visible external string is drawn from the reviewed
   copy-kit / eval-spec but still needs final founder sign-off before launch.
   (Markers are deliberately kept OUT of the rendered page — DECISION-MEMO §6.5.)

## ⚠ Founder decisions surfaced by the persona checkers (Ray / Dana / Will)

The scaffold was reviewed by the three buyer/voice personas. Acted-on feedback
is already in the page. These are left for Danny because they conflict with a
locked decision or need a fact only he has:

- **Privacy wording — RESOLVED (founder-confirmed 2026-06-21).** Architecture:
  all company data + model outputs live on the company's own machines, not ours;
  data does pass a cloud SDK API but is de-identified / scrubbed first. The page
  now states the *accurate* version — "The details stay on your own machines,
  not ours — and before anything reaches the AI, names and identifiers are
  stripped out first" — instead of the earlier inaccurate "nothing goes to a
  server." This is the question buyers WILL raise, so it's answered head-on
  (and it converts Ray's earlier "where does the model actually run?" doubt into
  a credible answer).
- **Hero slug — kept as-is (not changed).** Will suggested "A senior voice in
  your ear…" over "the senior at your ear" (noun ambiguity). Held: DECISION-MEMO
  §2 mandates the exact master slug and it's the line both buyers quoted back.
- **Sub-header — kept as-is.** Will rates "Bring one situation you've been
  sitting on" (final CTA) as the strongest line on the page and "Notice sooner.
  Handle it better." as the weakest headline-tier line. Held: §2 sanctions the
  #2 line as the sub-header. Worth A/B-testing post-launch.
- **Strong real baselines.** Ray: the illustrative baselines look engineered to
  lose; a blowout against a weak strawman discounts Avery's win too. The fix is
  real transcripts vs. a *strong* baseline with published prompts — that's the
  eval run (feat-011/012), already item 2 above. The eval note now states the
  pre-registration safeguards up front to blunt the "strawman" read in the
  meantime.

## Red-line compliance (built in)

- No score / grade / label / diagnosis on any person, anywhere on the page.
- Competitors are not named ("a leading general assistant" — DECISION-MEMO §4.3).
- The evidence each advisor was given is shown, so Avery's read looks grounded,
  not clairvoyant (DECISION-MEMO §4.2).
- Decisive in both directions — the adversarial row + "what Avery is" make clear
  Avery helps you *have* the hard call, not avoid it (ADR-0016).
- No "TeamMaster" / internal surface terms (Nexus / Dashboard / Reality gap /
  Manifest / Capabilities).
