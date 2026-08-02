# P7-02 · Demo-video capture readiness (feat-006)

**AFK-runnable:** PARTIAL (build the clean-capture affordance; Danny records). **Worktree:** yes. **Deps:** P7-01 (brand clean). **Priority:** P2.

## Goal
Make the existing pages record-ready so Danny can screen-record a clean 60–90s product video (beat sheet already written — see `docs/strategy/2026-06-20-coldstart-eval-roundtable.md` → Will's beat sheet, Lin Qing spine).

## Scope (agent does)
- A **clean capture mode**: hide any dev/prototype chrome that would look unpolished on camera (debug rails controls if visible, the "⚠" markers must never render on screen, any placeholder/TODO text). Confirm the rail can be driven smoothly through the Lin Qing flow without camera-thrash (known issue: canvas eval timeouts — manual rail drive is fine).
- Confirm the demo spine plays in order: empty composer → terminal streams (YOU → AVERY → PM pulls files) → MISMATCH card snaps in → "The read" card → human-loop send → (eval panel is P7-04/06, not here).
- **Red-line guard for camera:** never show a number/score *on Lin Qing herself* in any frame (see appendix in the strategy doc — `progressValue` "48%" is project data; keep it off the hero frames if it reads as a person-score).

## Out of scope
- Don't rebuild scenes. Don't add features. Don't touch rails logic — only hide/clean presentation.

## ⚠ OPEN for Danny
- Target aspect/res (1920×1080 landscape for LinkedIn/PH vs square)? Default: 1920×1080.
- Does he want a scripted auto-play, or will he drive the rail manually while recording? Default: manual drive (auto-play is risky given canvas timeouts).

## Definition of done
- `npm run dev`, capture mode on: a full Lin Qing pass renders clean (no chrome, no ⚠, no person-score frame). Screenshot/notes in evidence.
