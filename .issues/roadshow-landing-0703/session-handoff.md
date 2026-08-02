> 已结案存档（2026-07-03），当前状态以 progress.md / feature_list.json 为准，本文件不再更新。

# Session handoff — 2026-07-03 investor-roadshow landing restructure (worktree line)

Worktree: `elated-noether-7807c8` · branch `claude/intelligent-lichterman-d65856`. Uncommitted work — commit/merge is the integrator's call.

## What shipped

**Live (production): <https://avery-jade.vercel.app/?lang=zh>** — tonight's roadshow display AND the send-after link. EN at the same URL without `?lang`.

7-screen investor narrative (was 18 buyer-conversion sections):
hero (new slug) → product-in-one-look → market gap + bottom-up TAM/SOM → ROI account → revenue model (biggest) → moat → CTA (+ investor closing line). Cut sections live in git history; Landscape/Playbooks/Modules/Eval fold into `<details>` (`Fold.tsx`).

## Decisions made this session (all founder-confirmed via grilling)

1. **ADR-0018** (`docs/adr/0017-…md`): 人情味 demoted from product truth (总开关) to red line; product truth = **管理决策层** (management-decision layer). `CONTEXT.md` 定调/Positioning/Voice rewritten; `roles.md` north star + Dana role narrowed to red-line gatekeeper.
2. **Numbers policy** (ADR-0018 §3, replaces the old "no numbers" rule): mock **model-shaped** numbers allowed on-page (annotate in code comments); **result-shaped** numbers (47m/94%/3×) carry a visible micro-label ("design targets, pre-launch"); measured-claim numbers (eval scores) still banned until real human ratings.
3. **Slug**: "senior at your ear" retired everywhere it was a slug/label (hero em, footer, `layout.tsx` metadata, logo tagline → DECISION INTELLIGENCE); surviving slug = "Managers need safer HR decisions". Advisor language survives as descriptive body copy only.
4. Chinese via M3 as always — `landing/scripts/i18n-zh.mjs` **director brief rewritten** to the new positioning (finance-investor register, 管理决策 category framing, avoid "HR软件"). zh regenerated 13/13.

## Persona checks (all applied)

- **Phil** (strategy): product before gap; TAM bottom-up only, formula visible, SOM-forward; kill DemoVideo placeholder; keep Modules folded as the "why can't OpenAI do this" answer; don't lead with "HR" for CN finance audience; why-overseas line added.
- **Dana** (red line): all 7 screens PASS; "wrong node" → "wrong person" applied.
- **Will** (last mile): "reportedly asked back" anecdote cut; beat 2→3 and 4→5 bridge lines added; gap h2 replaced; investor closing line added to CTA (`bookCta.investorNote`).

## State / gotchas

- `./init.sh` N/A for landing; verification = `cd landing && npm run build` (green, incl. tsc) + live spot-checks on prod URL.
- `eval-harness/.env` was copied into the worktree (gitignored) so the M3 script runs here.
- Vercel: deploy from **repo root** (project `avery` has Root Directory = `landing/`); preview URLs are auth-protected (302) → production deploy is the shareable link.
- All new EN copy is marked `⚠ 待 Danny 审字` in `en.ts` comments per DoD.
- Old rule references to "no numbers" (e.g. DECISION-MEMO §4.1) now read through ADR-0018 §3.
- `landing/README.md` section table updated to the 7-screen structure.

## Next steps (not started)

- Danny 审字 pass over `en.ts` (esp. hero sub, ROI account, investorNote fundraise wording).
- Rehearse the three questions the page sets up (Phil): where's the real number / why won't a big model eat you / why fund a solo pre-revenue founder.
- Post-roadshow: decide whether the investor weighting stays or a buyer variant returns; domain (P7-06) still open.
