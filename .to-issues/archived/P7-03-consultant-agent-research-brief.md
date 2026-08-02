# P7-03 · Avery consultant-agent: research + brief + architecture proposal (feat-007)

**AFK-runnable:** YES (research + brief + skeleton). **Worktree:** separate dir/repo (no product code). **Deps:** none. **Priority:** P1 (Danny wakes up to grill this).

## Goal
Danny wants to be **briefed and grilled** on how to build a HEADLESS "Avery company-consultant agent" — no UI, used ONLY to generate evaluation data (batch-run scenarios, compare vs codex/claude). This bucket produces the brief + a proposed architecture + a runnable skeleton, NOT the full system.

The roundtable already produced a first-pass architecture — START from it: `docs/strategy/2026-06-20-coldstart-eval-roundtable.md` → "Eval architect" section (loop, file-based tools, `cite()` mandatory, red-line gate, frozen scenario set, cross-family judges). Do not re-derive; extend and sharpen it.

## Scope (agent does, web search ON)
1. **Research & brief** the agent architectures Danny named — **openclaw, codex, hermes** (also Claude Code / opencode for the loop) — focused on: the agent loop, memory, planning, tool interface. Cite sources. Output a tight brief Danny can read in 5 min.
2. **Map Danny's intuition onto components** — his bet is the value lives in:
   - **onboarding files → RAG system** (company facts ingestion),
   - **advisor-thinking skills + workflow chain** (the consultant reasoning, not coding),
   - **artifact tools** (produce the structured outputs / "the read" / mismatch / playbook),
   - and "most other agent components can be lifted as-is."
   For each: what to copy from the references vs what's Avery-specific and must be built.
3. **Architecture proposal** (buildable in days by a tiny team): language/stack, models, the 4-ish tools, memory layout, scenario runner. Name the one thing that makes Avery's loop ≠ a coding agent.
4. **Skeleton** (optional if time): a minimal runnable loop stub + a `grill-me`-ready doc with the open questions Danny should decide (stack, RAG store, how skills/workflow-chain are encoded, where company materials plug in).

## ⚠ OPEN for Danny (grill targets — leave as questions, recommend an answer for each)
- Python vs TS? (recommend Python + Anthropic SDK; debuggable, matches eval libs)
- RAG store for onboarding files (recommend: start file/keyword, defer vector DB)
- How are "consultant skills" + "workflow chain" encoded — prompt files? a planner? (recommend: markdown skill files + a fixed reason→cite→draft chain)
- Where do the partner's company materials + questions plug in (this is also P7-04's input)

## Definition of done
- A `brief.md` + `architecture.md` + open-questions list in a clearly-named output dir. No product-repo code touched. Evidence = the brief exists and cites real sources.
