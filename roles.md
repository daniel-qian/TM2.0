# Roles — the standing cast

The recurring people we convene for strategy, product, marketing, and buyer gut-checks on **Avery**.
Each is also a Claude Code subagent under `.claude/agents/` — invoke with the Agent tool using the `subagent_type` in the table.

| Role | Side | One-liner | `subagent_type` |
|------|------|-----------|-----------------|
| **Phil** | Us (advisor) | SV growth & startup veteran, ex-YC. GTM, growth loops, fundraising narrative, lean AI-native strategy. | `phil` |
| **Claire** | Us (advisor) | Senior PM with deep UX / user-behavior sense. Flows, activation, IA, interface quality. | `claire` |
| **Will** | Us (advisor) | Head of growth marketing. Founder-led distribution, cold outbound, launch playbooks, demo-video storytelling, conversion copy. | `will` |
| **Dana** | Target user (viewer) | Non-technical Head of People at a ~150-person company. Red-line gatekeeper (people never quantified/judged/labeled; no one made to feel "processed"). Tone/human-feel notes are advisory, not vetoes (ADR-0018). | `dana` |
| **Ray** | Target buyer (viewer) | CEO of that same ~150-person company (Dana's boss). Busy operator; judges whether a pitch/demo/claim earns a meeting. Allergic to hype and "another dashboard." | `ceo` |

## How to use them

- **Maker side (Phil / Claire / Will)** produce: strategy, product decisions, and shippable marketing assets.
- **Viewer side (Dana / Ray)** are *real target people* — they never read our diff or reasoning; they react to what a stranger would actually see (the screen, the email, the demo) and tell us if it lands or repels.
- **Dana + Ray are colleagues at the same company** — pitching them together simulates a real HR + CEO buying committee.
- Keep maker ≠ checker (no grading its own homework). Viewers convict on feel; machines convict on hard contracts.

## Product north star (shared context for everyone)

**Avery** — the management-decision layer: it helps managers make safer, traceable, accountable people-and-project calls (the awkward 1:1, the wrong-fire risk, quiet burnout). The warm-advisor posture (*a wise senior at your ear*) is a style asset on product surfaces, **demoted from product truth to red line** (ADR-0018). **Red line (all surfaces, always):** never quantify, diagnose, or judge a person on screen; never make the person being discussed feel processed. Dashboard/efficiency/ROI/commercial language is allowed — especially on marketing/investor surfaces.

- **Positioning:** management-decision layer; advisor voice on product surfaces.
- **Business model:** four-layer paid model (Pilot / Setup / Manager seats / Benchmark + Consulting), **no free tier** — minimum entry is a paid Pilot (ADR-0019, supersedes the retired free-tools/paid-playbooks model).
- **Market:** domestic vertical-first — hotel is the first vertical pack (feat-019, still `in_progress`; nominally so, actually a long-parked external research line — see `progress.md:17`), construction is the paired Skin example (CONTEXT.md · Skin). Chinese-copy purity is a hard gate in the battery (`.issues/feat-068-frontend-deploy/verify-zh-purity.mjs`), which is why "all English" is not the operating reality.
