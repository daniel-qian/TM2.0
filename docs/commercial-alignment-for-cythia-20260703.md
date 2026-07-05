# Commercial model — alignment notes for Cythia (2026-07-03)

Danny + working session, after going through the revenue deck (2026-07-02) line by line.
**Bottom line: we adopt the deck as the single source of truth.** The old "advisor + tools free,
playbooks paid" framing is retired (ADR-0019). The landing's commercial screen already uses the
deck's numbers. Below: one correction, two additions, and three things we'd like your read on.

## Correction 1 — the 60/20/15/5 funnel is the *end-state*, not the growth years

We back-solved the funnel against the deck's own price points (reference customer: 150 people,
15 managers, $114 seat midpoint → ~$20.5k/yr in seats):

- **Consulting at 15%** only works if roughly **1 in 10 customers keeps a retainer** at maturity —
  the cheapest retainer ($3k/mo = $36k/yr) is bigger than one customer's seat revenue, so
  near-universal attach would invert the funnel.
- **Setup at 5%** implies **new customers ≈ 6% of the installed base per year** — a mature,
  slow-growth state. In any real growth year, setup runs 30–50% of revenue.
- **Benchmark at 20%** implies **near-universal attach at the entry tier** (~$570/mo average).

None of this breaks the model — it *is* "charge for trust first." But we should present it as a
staged picture, so nobody catches us using the end-state photo to answer a year-2 question:

| Phase | Revenue reality |
|---|---|
| Years 1–2 (first customers) | Pilots + setup + consulting dominate; seats just starting |
| Mid (tens of customers) | Seats cross 50%; benchmark turns on |
| At scale (100+, growth slowing) | 60 / 20 / 15 / 5 |

**Ask:** keep the funnel slide, add the phase table, and state the two attach-rate assumptions
(consulting ~10–15%, benchmark near-universal entry tier) explicitly.

## Addition 2 — benchmark needs three hard privacy boundaries (in contracts and pitch)

The trust positioning ("we'll never put your people on a dashboard") survives selling benchmark
data only if these are explicit rules, not vibes:

1. **Org-level patterns only** — delay rates, workload distribution, cadence. Nothing that can
   locate an individual, ever. (Same principle as the "never score a person" red line.)
2. **Informed opt-in / opt-out** — customers can stay out of the pool; contributing data can be
   priced in (standard practice).
3. **No output below a minimum sample** — if a segment has too few companies, no comparison is
   shown (de-anonymization guard).

Framed this way, benchmark *strengthens* the trust story instead of contradicting it.

## Addition 3 — the deck is silent on tokens / inference cost; proposed mechanics

- **Standard tier: seat price includes normal manager usage.** Allowance expressed in product
  terms (threads per month), set above the 95th percentile. Over the line: throttle + notify —
  never a surprise bill. Terms restrict seats to human manager use (no automation pipelines).
- **Enterprise / private deployment: bring-your-own API key — a trust feature, not a discount.**
  "Your data never touches our inference." Seat fee unchanged; any negotiated concession capped
  at the actual token cost saved (~$10–15/seat/mo).
- **Per-company seat minimum** (e.g., 5 seats) to cover the always-on listening cost, which
  scales per company, not per seat. Enterprise tiers gated by number/volume of connected sources.
- One-line stance: **"We never mark up tokens. The seat pays for judgment, not compute."**

## Confirmed together (no action needed)

- Per-**manager** billing, not per-employee (right unit: the person whose decisions improve;
  avoids the "whole company is being watched" optics).
- **No free tier**; the paid pilot is the entry and the qualifier.
- Always-on *listening* is in-scope (it's why the advisor is worth a subscription);
  always-on *acting* stays out (existing red line: nothing happens to anyone on autopilot).

## Three questions for you

1. From your HR-industry view, is **~10–15% long-run consulting attach** the right assumption,
   or do mid-market companies hold retainers longer?
2. Is **near-universal entry-tier benchmark attach** realistic, or should the funnel's 20% come
   down / the benchmark price floor go up?
3. Any objection to a **5-seat minimum per company** as the floor for the standard tier?
