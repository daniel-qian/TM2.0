# P7-01 · Brand rename (TeamMaster → Avery) + surface-leak sweep — report

Worktree branch: `worktree-agent-a8f046cd9bc00f9c0`. Scope per
`.to-issues/archived/P7-01-brand-rename-avery.md` + `docs/adr/0015-...md`. NOT run:
`init.sh`, `npm`, dev server, tests (skip-tests per Danny).

---

## ⚠ READ FIRST — stale-worktree correction (important for review)

The worktree was created from commit **a28742e**, which **predates your
uncommitted work in the main repo** (the ADR-0015 surface-relabel + hero-case
rebuild — Lin Qing / Prism Design Team / figma signals / Topbar tabs relabeled /
TM lockup removed / email domain → `avery.io`, etc.). That work is sitting
**uncommitted** in `D:\TeamMaster-Prototype-2.0` (15 modified files, ~2.3k lines)
and was therefore **not present** in this worktree.

If I had renamed against the stale baseline, the diff would have fought your WIP
and not merged cleanly. So I did this in two commits:

1. **`chore(p7-01): sync uncommitted main working-tree content as rename baseline`**
   — copied the *current* content of the 15 in-scope files from your main working
   tree into the worktree, so the rename lands on the real baseline.
2. **The rename + leak fixes** (this is the diff worth reviewing — 5 files, 8 lines).

> Review the **second** commit for the actual P7-01 change. The first is just a
> baseline sync of your own uncommitted content. Before merging, reconcile with
> your main working tree (the WIP is still uncommitted there).

---

## (a) What was renamed (brand identity / user-facing)

| File | Change |
|------|--------|
| `index.html` | `<title>` `TeamMaster Prototype` → `Avery Prototype`; favicon glyph `TM` → `A` (browser-tab visible) |
| `package.json` | `"name": "teammaster-prototype"` → `"avery-prototype"` |
| `README.md` | H1 `TeamMaster Static Prototype` → `Avery Static Prototype` |

(`CONTEXT.md` and `AGENTS.md` were already debranded in your WIP — they now read
"Avery（旧称 TeamMaster…）" with intentional historical references; left as-is.)

## (b) Deliberately left internal (NOT renamed) — and why

- **Scene ids / file names / store keys / CSS classes / TS types & vars** —
  `'nexus'`, `'dashboard'`, `'capabilities'`, `NexusScene.tsx`, `.nexus-*`,
  `DashboardTag`, etc. Per ADR-0015 these are domain-concept names, not brand.
- **`docs/adr/*`** — historical, never rewritten.
- **`docs/archived/**`, `.to-issues/archived/**`, `.handoff/**`,
  `prototype-vanilla/**`** — frozen history / legacy vanilla prototype; skipped.
  (`prototype-vanilla/` still contains `TeamMaster` strings + `TM` marks — it's a
  dead legacy prototype, not the active Vite app; flag below if you want it cleaned.)
- **`package-lock.json`** — generated; will regenerate from `package.json` name.
- **File-header comments** in `src/data/fixtures.ts` & `fixtures.p3.ts`
  (`* TeamMaster 2.0 — … Fixtures (draft v1 …)`) — non-rendered provenance
  comments; ADR-0015 explicitly keeps internal comment identifiers. Left intact.
- **`feature_list.json` line 6** — historical description of P1–P6 demo built under
  the old name; harness metadata, not UI. Left as a record.
- **`'Store Dashboard polish'` / `'Store dashboard progress'`** (fixtures) — these
  name the *fictional product the demo team is building*, not our Dashboard scene.
  Legitimate domain copy; left.

## (c) Surface leaks found + fixed

Swept fixtures / cases / components for internal words (`Nexus`, `Dashboard`,
`Capabilities`, `Reality gap`, `report mismatch`) inside rendered strings.
Your WIP had already cleaned almost everything (tabs, scene aria-labels, mismatch
card → "Worth a closer look", terminal title, email domain). Remaining leaks:

| File:line | Was | Now |
|-----------|-----|-----|
| `NexusScene.tsx:533` (rendered button) | `Return to dashboard` | `Return to your team` |
| `NexusScene.tsx:1091` (aria-label) | `Nexus threads` | `Threads` |
| `DashboardScene.tsx:568` (aria-label) | `Dashboard focus tags` | `Focus tags` |
| `DashboardScene.tsx:633` (aria-label) | `Dashboard alerts` | `Team alerts` |

All other `Nexus`/`Dashboard`/`Capabilities` occurrences in `src/` are comments,
type/var/CSS identifiers, or scene-id logic — not rendered. None changed.

## (d) Flagged for Danny

1. **⚠ 待 Danny 审字 — new copy:** `Return to your team` (NexusScene button).
   Marked inline with a comment. Confirm wording.
2. **aria-label judgment call:** I rewrote 3 aria-labels (screen-reader-facing) to
   drop internal words. ADR-0015 relabeled visible tabs but didn't mention
   aria-labels. If you'd rather keep them verbatim for dev-clarity, revert those 3.
3. **P7-01b deep internal rename — NOT done (default per issue).** Your earlier
   message listed `nexus→the room, dashboard→your team, capabilities→playbooks`
   beside `tm→avery`, which *could* mean renaming the internal ids/files/CSS too.
   I did **not** do that — kept scene ids/files/CSS/types. If you want the deep
   rename, it's a separate larger bucket (P7-01b) needing a full regression pass.
4. **Stale worktree (see top):** baseline-sync commit pulled in your *uncommitted*
   WIP. Reconcile with your main working tree before merging.
5. **`prototype-vanilla/`** legacy prototype still carries old brand strings —
   out of P7-01 scope; clean separately if it's still shipped anywhere.
6. **File-header comments** still say "TeamMaster 2.0" — left per ADR-0015's
   keep-comments rule; say the word if you want them swept too.

## (e) Reminder

**`init.sh` / `npm run dev` were NOT run** (skip-tests per your instruction).
Verified only via grep + reading. Please run `./init.sh` + a `npm run dev`
spot-check before merging — confirm every tab/scene shows only Avery + the surface
labels, and `npx tsc --noEmit` passes (changes are string-only, so low risk).
