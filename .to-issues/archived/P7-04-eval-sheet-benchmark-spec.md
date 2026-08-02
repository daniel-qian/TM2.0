# P7-04 · Evaluation sheet layout + benchmark spec (feat-008)

**AFK-runnable:** YES (spec + layout + mock sheet). **Worktree:** doc/asset only. **Deps:** soft on P7-03 (agent), hard input from partner (company materials + questions). **Priority:** P1.

## Goal
Define **what the benchmark is** and **how the evaluation sheet looks**, so that once the headless agent (P7-03) runs against the partner's scenarios, we have a credible, on-brand artifact to publish (landing page + LinkedIn/PH).

Build on the roundtable: `docs/strategy/2026-06-20-coldstart-eval-roundtable.md` → eval-architect's "comparison protocol" + "publishable artifact", and Claire's "present as advice-contrast, NOT a scoreboard", and Dana's correction (demote the win-count; a buyer isn't choosing between chatbots).

## Scope (agent does)
1. **Benchmark definition:** the task (advise the leader on a human situation), comparison agents (Avery vs codex vs claude on identical prompt+evidence), rubric dims (grounding / actionability / humanity / calibration) + hard-fail gates (red-line violation, contradicts evidence, hallucination), judges (cross-family LLM panel — never Claude-as-judge — + human HR sample), anti-cherry-pick safeguards (frozen + hashed scenario set, ~25–30, incl. ~5 adversarial/null).
2. **Sheet layout:** side-by-side "what each advisor actually said," one scenario per row, Avery vs raw GPT/Claude as *advice text* not scores; `safeFraming` quoted as the stated guardrail; the human-preference count present but quiet (footnote, not headline).
3. **A mock/sample sheet** using the Lin Qing case (data already exists in `src/data/fixtures.ts` / `cases.ts`) so the layout is concrete before real runs.
4. **Reuse the product's card styling** (`StructuredOutputCard` / `MismatchCard`) so the sheet looks native, not a spreadsheet.

## Ray's must-have (bake into the scenario-set spec)
≥3 scenarios Danny did NOT author, and ≥1 where the *kind* read is the WRONG read (genuine underperformance) and Avery must not flinch. The sheet should be able to SHOW that case — it's what converts a skeptic.

## ⚠ Needs from Danny / partner
- The partner is preparing the simulated company materials + the question scenarios — this bucket designs the container and a mock; real fill-in waits on those.

## Definition of done
- `eval-sheet-spec.md` + a rendered mock (HTML or in-repo page reusing card CSS) of the Lin Qing row. Evidence = mock renders.
