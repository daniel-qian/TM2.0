// English dictionary — the SOURCE OF TRUTH for all visible landing copy.
// `Dict` is inferred from this object (see ./index), so zh.ts must mirror its
// shape exactly. Values use backticks so ' and " need no escaping.
//
// Every string here is still a draft. The Chinese (zh.ts) is
// transcreated from THIS draft by MiniMax-M3 and is regenerable: when Danny
// edits the English, re-run scripts/i18n-zh.mjs.
//
// 2026-07-03 RESTRUCTURE (ADR-0018, investor roadshow): page reweighted from
// buyer-conversion to investor narrative — 7 screens: hero → product → market
// gap+TAM → ROI account → revenue model → moat → CTA. The "senior at your ear"
// slug is RETIRED (kept only as descriptive background language); the surviving
// slug is "Managers need safer HR decisions."
//
// NUMBERS POLICY (ADR-0018 §3): mock/estimated numbers are allowed on the page
// when their nature is annotated in code comments here; RESULT-shaped numbers
// (read like measurements) additionally carry a visible on-page micro-label.
// Measured-claim numbers (eval scores, user data) remain banned until real.
//
// NOT translated here (separate concern, eval is intentionally left as-is):
// the advice-transcript rows in app/data/evalRows.ts.

export const en = {
  langSwitch: { en: `EN`, zh: `中文` },

  // ── Screen 1 · Hero ────────────────────────────────────────────────────────
  // slug switched to "Managers need safer HR decisions"
  // (founder decision 2026-07-03); category claim = management-decision layer
  // (NOT "HR software" — see ADR-0018; zh renders the category as 管理决策,
  // avoiding the low-ceiling "HR软件" filing).
  hero: {
    topLeft: `For 20–500 person companies`,
    topRight: `Avery · MMXXVI`,
    kicker: `The management-decision layer`,
    // {em} marks the emphasised fragment; the renderer wraps it in <em>.
    title: `Managers need {em}.`,
    em: `safer HR decisions`,
    // ⚠ mock/model number: "a year of Avery" is priced off the $114 seat
    // midpoint — a pricing model, not a measurement.
    sub: `One wrong people call costs more than a year of Avery. It exists to catch that call first.`,
    ctaPrimary: `Book a 15-min look`,
    ctaGhost: `See how it makes money`,
    reassure: `Advice for the manager — never a verdict on the person. Nothing gets scored or stored against anyone.`,
  },

  // ── Screen 2 · The product in one look ────────────────────────────────────
  morningBriefing: {
    mastheadL: `The product · a morning in Avery's words`,
    mastheadR: `Illustrative`,
    eyebrow: `What Avery is`,
    h2: `One morning, read for you.`,
    lede: `Avery sits on the company's own data — projects, tasks, docs, weekly notes — and hands each manager a short, prioritised read: what's at risk, why it matters, the move that fits, and the evidence behind it. Not a chatbot you must ask; a read that's ready before you open the laptop.`,
    cardGreeting: `Good morning, Sarah`,
    cardCount: `4 items worth a look`,
    cardTime: `Mon 08:02`,
    items: [
      { tag: `Risk`, h4: `Project Atlas is 3 days behind.`, p: `Revenue exposure ~$240K. Worth looping in the PM lead today.` },
      { tag: `Waiting on you`, h4: `2 decisions need a sign-off.`, p: `A budget review and a contract approval are blocking other teams.` },
      { tag: `Good news`, h4: `Pipeline is up 18% week over week.`, p: `The chart's ready, with the proposal most likely to close fastest flagged.` },
      // ⚠ mock number (restored from partner template): illustrative scenario data.
      { tag: `Team signal`, h4: `Engineering velocity is down 18% this week.`, p: `The pattern looks like overload — not any one person falling behind.` },
    ],
    promiseEyebrow: `The promise`,
    promiseTitleA: `Less searching.`,
    promiseTitleB: `More judgement.`,
    promiseP: `Avery turns your real company data into a short, prioritised read: what's at risk, why it matters, and what to do next.`,
    // ⚠ mock numbers RESTORED (partner template; founder decision 2026-07-03).
    // These are DESIGN TARGETS, not measurements — the visible micro-label
    // below (statNote) says so on the page, per ADR-0018 §3 / Phil's review.
    stats: [
      { num: `47m`, label: `saved per manager per day on status-chasing` },
      { num: `94%`, label: `of surfaced risks caught before they became escalations` },
      { num: `3×`, label: `faster from signal to decision-ready` },
    ],
    statNote: `Design targets, pre-launch — a model of what good looks like, not measurements.`,
  },

  // ── Screen 3 · Market gap + TAM ────────────────────────────────────────────
  marketGap: {
    eyebrow: `The gap`,
    // h2 + bridge line per Will's last-mile check (2026-07-03):
    // headline names the stake; lede opens by carrying Screen 2's morning read
    // up into the market frame so the live-scroll pullback feels earned.
    h2: `There's a tool for every part of the job — except the part you're paid for.`,
    lede: `Multiply that morning by every manager who has to make the call — then look at who's actually serving them. Copilots summarise. BI charts. HR suites file records. Nobody owns the moment the manager is paid for: the people-and-project call you have to stand behind. That empty layer is the market.`,
    gapLabel: `Where today's tools stop`,
    // The gap-bar SCORES live in MarketGap.tsx — deck's illustrative numbers.
    panels: [
      { name: `AI copilots`, line: `Fast answers, thin accountability.`, m1label: `summary speed`, m2label: `internal validation` },
      { name: `PM / HR suites`, line: `Good systems, separate silos.`, m1label: `structured records`, m2label: `cross-context judgement` },
      { name: `Consulting`, line: `Expert judgement, slow cycle.`, m1label: `human interpretation`, m2label: `daily manager workflow` },
    ],
    averyPanel: { name: `Avery`, line: `Decision-ready, with a human in the loop.`, m1label: `evidence-weighted context`, m2label: `manager review loop` },
    // bottom-up TAM/SOM (ADR-0018: model-shaped numbers,
    // formula visible on page = the annotation). Inputs: US Census SUSB
    // ballpark ~650k firms with 20–499 employees; 8 managers/company and the
    // $114 seat midpoint are OUR stated assumptions. 650k × 8 × $114 × 12 ≈ $7B.
    // SOM: 300 companies × 8 seats × $1,368/yr ≈ $3.3M ARR. All illustrative.
    tam: {
      eyebrow: `Market, built bottom-up`,
      title: `The math, shown whole.`,
      note: `An illustrative model, not a claim: public company counts, our own price points, assumptions on the table. Re-run it yourself.`,
      factors: [
        { k: `US companies with 20–500 employees`, v: `≈ 650,000`, d: `public census data, rounded down` },
        { k: `Manager seats per company`, v: `× 8`, d: `our assumption, mid-size average` },
        { k: `Avery seat, midpoint`, v: `× $114 / mo`, d: `from the pricing architecture below` },
      ],
      sam: { k: `Serviceable market, US alone`, v: `≈ $7B / yr` },
      som: { k: `Reachable in 24 months — 300 companies × 8 seats`, v: `≈ $3.3M ARR` },
      somNote: `We'd rather show a believable $3M than an unbelievable $7B.`,
    },
    // the "why overseas-first" pre-empt (Phil: answer it
    // before the room asks it).
    overseas: `Why overseas-first: higher willingness-to-pay per seat, cleaner SaaS payment behavior, and an English-native AI advantage — APAC is the expansion layer, not the beachhead.`,
    landscapeToggle: `Unfold — the full HR-tool capability matrix`,
  },

  // Rendered inside the market-gap screen's fold-out (unchanged content).
  landscape: {
    eyebrow: `HR AI tool landscape`,
    h2: `What Avery is for — and what it isn't.`,
    lede: `Avery isn't trying to be your HR suite, payroll, or ATS. It owns the manager-intelligence layer those tools leave empty.`,
    capability: `Capability`,
    avery: `Avery`,
    cols: [`All-in-One HR Suite`, `Workforce Mgmt`, `Talent Intelligence`, `Perf & Engagement`, `HR Admin`],
    groups: [
      {
        group: `Manager intelligence`,
        rows: [
          { title: `Daily manager briefing`, sub: `Proactive morning read` },
          { title: `Operational risk alerts`, sub: `Project, revenue, delivery` },
          { title: `AI next steps & plans`, sub: `Resolution for flagged issues` },
          { title: `Revenue & project signals`, sub: `Sales, delivery, finance in view` },
          { title: `Cross-department view`, sub: `Sales + eng + finance + ops` },
          { title: `Meeting prep & context`, sub: `Briefing before each meeting` },
        ],
      },
      {
        group: `People & HR features`,
        rows: [
          { title: `Team health signals`, sub: `Overload, pace, engagement` },
          { title: `AI performance reviews`, sub: `Drafted from data, not blank` },
          { title: `Recruiting & ATS`, sub: `Sourcing, screening, scheduling` },
          { title: `Payroll & benefits`, sub: `Processing, compliance, admin` },
          { title: `Workforce scheduling`, sub: `Shift planning and staffing` },
        ],
      },
    ],
    legendYes: `Fully included`,
    legendPartial: `Partial / limited`,
    legendNo: `Not available`,
  },

  // ── Screen 4 · The ROI account ─────────────────────────────────────────────
  // WrongCut reframed as the cost-saving account; absorbs
  // the old WhyItMatters ("judged on shipped work / defensible calls") into
  // the lede. All figures are an ILLUSTRATIVE MODEL (ADR-0018): rule-of-thumb
  // replacement cost (50–100% of salary), stated team-slip assumption, and our
  // own seat pricing. $120k + $60k ≈ $180k vs 8 seats × $114 × 12 ≈ $11k → ~16×.
  roi: {
    mastheadL: `Cost of a wrong call · the account`,
    mastheadR: `Illustrative model`,
    eyebrow: `Cheaper to see it coming`,
    h2: `One bad people call pays for years of Avery.`,
    // Will's check: the "reportedly asked back" anecdote was
    // the only unverifiable claim in the hardest-numbers section → cut. Dana's
    // check: "node" was the one word that turns a person into a diagram
    // element → "person". The four-cost account below is the evidence.
    lede: `Managers are judged on shipped work, and a challenged people call needs evidence. Cutting the wrong person costs four ways —`,
    steps: [
      { n: `01`, h4: `Cut`, p: `Short-term cost looks lower — but the reason for the problem may still sit inside the project system.`, metaA: `Cost`, metaB: `Visible` },
      { n: `02`, h4: `Knowledge gap`, p: `Context disappears. The team loses hidden dependency knowledge that was never written down cleanly.`, metaA: `Context`, metaB: `Lost` },
      { n: `03`, h4: `Repair`, p: `Now you pay time cost, replacement cost, and deadline cost to rebuild what was removed.`, metaA: `Time`, metaB: `Slips` },
      { n: `04`, h4: `Review risk`, p: `Leadership asks whether you understood the team before you made the people decision.`, metaA: `Judgement`, metaB: `Tested` },
    ],
    account: {
      title: `The account, in round numbers`,
      note: `Assumptions on the table — swap in your own.`,
      lines: [
        { k: `Replacing one wrongly-cut senior engineer`, v: `$120k+`, d: `recruiting + ramp, the 50–100%-of-salary rule of thumb` },
        { k: `Three months of lost context and deadline slip`, v: `$60k+`, d: `a team of five blocked on undocumented dependencies` },
        { k: `Avery — 8 manager seats, one full year`, v: `≈ $11k`, d: `$114 per seat per month, midpoint` },
      ],
      punch: `Catch one wrong call and the subscription has paid for itself sixteen times over.`,
    },
  },

  // ── Screen 5 · Revenue model (the screen they came for) ───────────────────
  // expanded from the partner's revenue-model deck
  // (2026-07-02): pricing architecture + revenue mix at scale + commercial
  // thesis + condensed roadmap. All prices are the DESIGNED pricing model
  // (mock in the sense of pre-revenue; real in the sense that this is what we
  // will charge). Mix percentages are the at-scale design, not bookings.
  revenue: {
    mastheadL: `Commercial model`,
    mastheadR: `Proof → recurring → moat`,
    eyebrow: `How this becomes a business`,
    h2: `Charge for trust first. Then scale the recurring layer.`,
    // opening line marks the buyer-ROI → seller-economics
    // pivot on purpose (Will's beat 4→5 bridge).
    lede: `That's the value to them. Here's how it becomes revenue for us: Avery is not priced as generic AI chat. Buyers pay for safer manager decisions, private company context, benchmark intelligence, and review-ready workflows — service-heavy at first to earn trust, shifting to seats and benchmark data as workflows mature.`,
    offers: [
      { tag: `Entry motion`, name: `Pilot / Proof Pack`, price: `$8k–18k`, d: `One team, real cases: prove Avery surfaces hidden people-and-project risk before a full rollout.` },
      { tag: `Core SaaS`, name: `Manager seats`, price: `$79–149 / manager / mo`, d: `Recurring access: the morning read, decision briefs, follow-up loops. Midpoint $114.` },
      { tag: `Trust layer`, name: `Enterprise setup`, price: `$10k–100k`, d: `Company-brain build, private deployment, SSO, audit logs, secure model boundaries.` },
    ],
    componentsTitle: `Offer components and expected range`,
    components: [
      { k: `Core SaaS seat`, v: `$79–149 / manager / mo` },
      { k: `Benchmark layer`, v: `$500–8k / mo` },
      { k: `Consulting retainer`, v: `$3k–25k / mo` },
      { k: `Private deployment`, v: `$50k–100k one-time` },
    ],
    mixTitle: `Revenue mix at scale`,
    kpis: [
      { lbl: `Manager seats`, val: `60`, delta: `Core SaaS`, desc: `Recurring manager access — the read, the morning briefing, follow-up. The engine.` },
      { lbl: `Benchmark data`, val: `20`, delta: `Data layer`, desc: `Aggregated, privacy-safe comparison points for risk, workload, and cadence.` },
      { lbl: `Consulting`, val: `15`, delta: `Service`, desc: `Workflow evaluation, playbook tuning, human-reviewed decision checks.` },
      { lbl: `Private setup`, val: `5`, delta: `Security`, desc: `Local deployment, permission boundaries, internal knowledge-base config.` },
    ],
    roadmapTitle: `The path there`,
    roadmap: [
      { n: `01`, h4: `Prove`, p: `Collect company context, localise the company brain, run a reviewed pilot against real manager questions.` },
      { n: `02`, h4: `Tune`, p: `Consulting refines playbooks, decision checks, and escalation language — with human review in the loop.` },
      { n: `03`, h4: `Scale`, p: `Expand manager seats; benchmark data compounds with every company on the platform.` },
    ],
  },

  // ── Screen 6 · Moat ────────────────────────────────────────────────────────
  // the "why can't a general model eat this" screen. Absorbs
  // TrustLayer (trust architecture pillar) and hosts the fold-outs for
  // Playbooks / Modules / the eval section. The honesty strip keeps the locked
  // eval promise: NO scorecard numbers until real human ratings land.
  moat: {
    mastheadL: `Defensibility`,
    mastheadR: `What compounds`,
    eyebrow: `Why a general model can't just do this`,
    h2: `The model is rented. The moat isn't.`,
    lede: `Anyone can call the same AI. What compounds here sits around the model: partner-authored expert playbooks, each company's private decision context, and a benchmark layer that grows with every customer.`,
    pillars: [
      { n: `01`, h4: `Playbooks — expert IP`, p: `Partner-authored playbooks for real manager situations: the signals, the hypotheses, and the escalation ceiling for each. Licensed expertise, not scraped text.` },
      { n: `02`, h4: `Benchmark data`, p: `Aggregated, privacy-safe patterns across workload, project risk, and operating cadence. Every new company makes the comparisons sharper — a data moat that compounds.` },
      { n: `03`, h4: `Trust architecture`, p: `Data stays on the company's own machines; names are stripped before anything reaches a model; every read cites its evidence; a human holds the pen. This is what risk-sensitive buyers actually pay for.` },
    ],
    honesty: `Advice quality is measured, not asserted: a pre-registered eval run is done — six partner-authored scenarios, frozen and git-hashed, blind-graded by two independent model families. The scorecard goes public only when real HR and manager ratings land. No number before it's earned.`,
    playbooksToggle: `Unfold — six situations Avery already knows`,
    modulesToggle: `Unfold — the six signals inside the morning read`,
    evalToggle: `Unfold — the actual advice, side by side`,
  },

  // Rendered inside the moat screen's fold-out (content unchanged).
  playbooks: {
    mastheadL: `Playbooks · situations Avery already knows`,
    mastheadR: `Six scenarios`,
    eyebrow: `Situations Avery handles`,
    h2: `Not built from scratch each time.`,
    lede: `Behind the read sits a library of Playbooks — real manager situations, each with its signals, its hypotheses, and the point where it stops being a manager's call alone. Six of them:`,
    items: [
      { id: `SCN-001`, name: `The work went flat after too many rejections`, p: `A creative keeps getting turned down, and the spark is gone — now it's mechanical edits. Reset the brief before it reads as a performance problem.`, escalate: `Escalates on burnout or unfair treatment.` },
      { id: `SCN-002`, name: `A strong performer feels the pay is unfair`, p: `Real delivery, reward that doesn't match. Separate market, internal equity, and contribution before it becomes a resignation.`, escalate: `Escalates to comp on equity or retention risk.` },
      { id: `SCN-003`, name: `A new hire can't get up to speed`, p: `Fast-growing team, slow ramp — usually a context-and-access gap, not a capability gap. Make the first month stop depending on guessing.`, escalate: `Escalates on unclear scope or repeat access issues.` },
      { id: `SCN-004`, name: `The same people get all the good projects`, p: `Visible work keeps landing with the same few. Make opportunity transparent before it hardens into a fairness problem.`, escalate: `Escalates on a protected-class pattern.` },
      { id: `SCN-005`, name: `Reviews aren't happening consistently`, p: `Feedback is ad hoc, goals are unclear. Move to a clear cycle that's about growth, not paperwork.`, escalate: `Escalates repeat non-completion to leadership.` },
      { id: `SCN-006`, name: `Wellbeing risk hiding inside the workload`, p: `Rising absence and overtime under pressure. An empathetic check-in and a scope review — never treated as a discipline issue first.`, escalate: `Escalates to occupational health / HR on health risk.` },
    ],
    footnote: `Partner-authored playbooks. More situations are covered than the six shown here.`,
  },

  // Rendered inside the moat screen's fold-out (content unchanged).
  modules: {
    mastheadL: `Six signals · one read`,
    mastheadR: `What Avery hands you`,
    eyebrow: `What Avery actually does`,
    h2: `Six signals. One read.`,
    lede: `Risks, the things waiting on you, metrics, milestones, team health, and a next move — gathered into one short morning read.`,
    selectedLabel: `Selected`,
    items: [
      { key: `risk`, lbl: `01 — Risk signals`, val: `Risk`, desc: `Project delays, budget pressure, and delivery risk surfaced before they become escalations.`, detailName: `Risk signals`, detailBody: `Active risk alerts connect project pressure, business impact, owner, confidence, and the escalation path Avery suggests.` },
      { key: `actions`, lbl: `02 — Waiting on you`, val: `Act`, desc: `Sign-offs, blockers, and follow-ups only you can clear, ranked by urgency and impact.`, detailName: `Waiting on you`, detailBody: `Surfaces the decisions and sign-offs only you can unblock, ranked by urgency and business impact.` },
      { key: `performance`, lbl: `03 — Performance signal`, val: `Pulse`, desc: `Charts for revenue, velocity, OKRs, and pipeline — without building a dashboard.`, detailName: `Performance signal`, detailBody: `Auto-builds charts for revenue, velocity, OKRs, and pipeline so you see the pattern without building a dashboard.` },
      { key: `milestones`, lbl: `04 — Milestones`, val: `Map`, desc: `Timeline deviations, critical paths, and delivery-risk notes across active work.`, detailName: `Milestones`, detailBody: `Maps active projects, critical paths, and timeline deviations, with a note on what changed and why.` },
      { key: `people`, lbl: `05 — Team health`, val: `Team`, desc: `Overload and pace changes read from how work moves — never a grade on a person.`, detailName: `Team health`, detailBody: `Reads overload, workload, and pace changes from how work actually moves — not from self-report, and never as a label on a person.` },
      { key: `solutions`, lbl: `06 — Next steps`, val: `Plan`, desc: `Ranked options, tradeoffs, and a review-ready move for each risk or signal.`, detailName: `Next steps`, detailBody: `Generates ranked options with tradeoffs and a clear next move for every signal — yours to accept or reject.` },
    ],
  },

  // Rendered inside the moat screen's fold-out (content unchanged; the run has
  // happened — real de-identified answers; scorecard NUMBERS still off-page).
  evalSection: {
    eyebrow: `Avery vs. a general AI — the actual words`,
    h2: `Same case, same evidence. One of them shows its work.`,
    p: `Not a scoreboard. Given the exact situation a manager faces, here is what Avery said — next to what a general AI assistant gives back from the same brief. Both give sensible, caring advice. The difference isn't who's kinder — it's whether you're told how sure it is, when it stops being your call alone, and what the read is built on.`,
    noteStrong: `The run has happened — and we'll be straight about it.`,
    noteRest: ` The pre-registered run is done: six partner-authored scenarios, frozen and git-hashed before a single run, blind-graded by two independent model families. The answers below are real and de-identified — the general-assistant excerpt is a real capture, paraphrased for length, not reproduced verbatim from any one product. The one thing still pending is real HR and manager ratings; until we have those, we won't put a score on this page.`,
    footer: `We evaluate the advice, never the person. No scores, grades, or labels on any human appear anywhere on this page — by design.`,
    rowsNote: `Note: these are real, de-identified answers from the frozen run (kept in English for now).`,
    slotEyebrow: `Reserved · the graded scores land here`,
    slotTitle: `Where the human-rated scorecard goes.`,
    slotBody: `The run has happened — the real answers are above. What belongs in this box is the scorecard: how the answers rate on the axes that actually matter — did it cite its evidence, was it honestly calibrated, did it escalate on real risk, did it refuse to guess when the evidence was thin. Those ratings need real HR and manager judgement, and we don't have enough of that yet. We won't show a number we haven't earned.`,
    slotAxes: [
      `Evidence cited`,
      `Confidence calibrated`,
      `Escalated on risk`,
      `Refused when evidence thin`,
    ],
    slotPending: `Scorecard pending real HR/manager ratings — no number until we've earned it.`,
  },

  // ── Screen 7 · CTA ─────────────────────────────────────────────────────────
  bookCta: {
    eyebrow: `From scattered → to safer decisions`,
    h2: `Bring one situation you've been sitting on.`,
    p: `15 minutes, one real case — yours or one of ours. No pitch deck. If it's not for you, just say so.`,
    placeholder: `you@company.com`,
    button: `Book a 15-min look`,
    ok: `Thanks — we'll be in touch to find 15 minutes. 🙏`,
    micro: `We'll never put your people on a dashboard — the trust layer is the product.`,
    // investor-facing closing line (Will, 2026-07-03): the
    // buyer CTA stays; this answers the investor's "what's the ask" and ties
    // back to the SOM figure on the market screen.
    investorNote: `For investors: we're raising to reach the 300-company SOM on this page. The ask, the use of funds, and the 24-month plan are a conversation away — same 15 minutes.`,
    closing: [
      { lbl: `For`, val: `Managers under pressure` },
      { lbl: `Powered by`, val: `HR knowledge and real cases` },
      { lbl: `Next`, val: `A demo and a pilot scope` },
    ],
  },

  footer: {
    left: `Avery`,
    right: `Managers need safer HR decisions.`,
  },
};
