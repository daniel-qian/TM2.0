# P7-01 · Brand rename TeamMaster → Avery + surface-label leak sweep (feat-005)

**AFK-runnable:** YES (high confidence). **Worktree:** yes (touches code). **Deps:** none. **Priority:** P1.

## Goal
Kill the old "TeamMaster / TM" brand everywhere it's *identity or user-facing*, and make sure NO internal surface term leaks onto a user-facing screen. Avery is the locked name.

## Pre-grilled scope decision (DO / DON'T) — follow exactly

**DO rename (brand identity + anything a user/viewer can see):**
- `CONTEXT.md` (title + body), `AGENTS.md`, `README.md`, `index.html` `<title>`, `package.json` `"name"` (`teammaster*` → `avery-prototype`), any visible `TeamMaster`/`TM` string inside `src/` copy (`src/data/fixtures.ts`, `fixtures.p3.ts`, `cases.ts`).
- Surface labels already mostly relabeled (Topbar = Onboarding / Your team / The room / Playbooks). **Sweep for leaks**: no user-facing copy may show `Nexus`, `Dashboard`, `Capabilities`, `Reality gap`, `report mismatch`. Per ADR-0015 the surface words are: **Working it through / the room** (Nexus), **Your team** (Dashboard), **Playbooks** (Capabilities), **Worth a closer look** (reality gap). Grep fixtures/cases/components for any of the internal words appearing in a string that renders.

**DO NOT rename (internal — ADR-0015 keeps these as domain concept names):**
- Scene ids (`'nexus'`, `'dashboard'`, `'capabilities'`), file names (`NexusScene.tsx`, `DashboardScene.tsx`, `CapabilitiesScene.tsx`), store keys, CSS class names (`.nexus-*` etc.), TS type/variable names.
- **ADR files** (`docs/adr/*`) — historical records, never rewrite. Leave their `Nexus`/`TeamMaster` text intact (they're dated decisions).
- `docs/archived/**`, `.to-issues/archived/**`, `.handoff/**` — frozen history, skip entirely.
- Rails / store contracts / camera / terminal-stream machinery — untouched (standing constraint).

## ⚠ OPEN QUESTION for Danny (do NOT assume)
Danny's message listed `nexus -> the room, dashboard -> your team, capabilities -> playbooks` next to `tm -> avery`. That *could* mean rename the internal identifiers too.
- **Default taken here = NO** (keep internal ids; only brand + surface leaks). Rationale: ADR-0015 already decided internal names stay; renaming scene ids/files/CSS is churn + demo-regression risk for zero user-visible gain.
- If Danny wants the deep internal rename, it's a **separate larger bucket** (P7-01b) with full regression pass — flag, don't fold it in here.

## Definition of done
- `./init.sh` green. `npm run dev` spot-check: every nav tab + each scene shows only Avery + the surface labels; no "TeamMaster"/"Nexus"/"Capabilities" visible.
- New/changed user-facing copy marked `⚠ 待 Danny 审字`.
- Note in `progress.md` listing exactly what was renamed vs deliberately left internal.
