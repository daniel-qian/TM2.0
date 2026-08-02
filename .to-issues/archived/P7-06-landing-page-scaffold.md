# P7-06 · Avery landing page scaffold (feat-010)

**AFK-runnable:** PARTIAL (scaffold + placeholders). **Worktree:** likely a NEW project (see open Q). **Deps:** P7-05 (copy), P7-02 (video), P7-04 (eval sheet). **Priority:** P2.

## Goal
A simple landing page = **slug + product video + evaluation sheet/benchmark** + one CTA ("Book a 15-min look"). The conversion destination every channel points to.

## Scope (agent does)
- Scaffold a single-page site: hero (slug + CTA), embedded demo video (placeholder until P7-02 delivers), the eval sheet/benchmark section (reuse the P7-04 mock / product card styling), a short "what Avery is / isn't" (lean on `safeFraming` + the on-device privacy line Dana 🟢'd), email capture, CTA.
- Native English; passes the red-line test; no "TeamMaster"/internal terms.

## ⚠ OPEN for Danny (decide before/at launch of this bucket)
- **Where does it live?** (a) new standalone repo/Next.js on Vercel (clean, deployable — recommended), (b) a route in this prototype, (c) a no-code builder. Recommend (a) Next.js + Vercel; this repo is a demo prototype (ADR-0001), not a marketing site.
- Domain (avery.??? — needs a name/domain decision).
- Real assets (final video, real eval numbers) come later — scaffold with placeholders so it's ready to fill.

## Definition of done
- A deployable scaffold with all sections present (placeholders where assets pending) + a clear list of what real assets to drop in. Evidence = builds / preview renders.
