// ─────────────────────────────────────────────────────────────────────────────
// Placeholder eval data for the advice-contrast section.
//
// This is NOT a scoreboard. Each row is a side-by-side TRANSCRIPT OF ADVICE:
// given the exact same situation + evidence, what Avery said vs. what a raw
// frontier model said. The buyer reads the words and decides. (eval-sheet-spec §0)
//
// SOURCE / STATUS:
//   • Avery cells = condensed from real demo fixtures (eval-sheet-spec §4,
//     src/data/fixtures.ts MISMATCH / AGENT_OUTPUT / safeFraming).
//   • Baseline cells = PLACEHOLDER illustrative answers (a generic assistant's
//     typical move), clearly marked `placeholder: true`. Real transcripts land
//     after the eval harness runs (feat-011/012). See README "Assets to add".
//   • Per DECISION-MEMO §4: competitors are NOT named (no "GPT"/"Claude") — they
//     are "a leading general assistant". No fake N/X/M human-grading footnote.
//   • Every visible string is still a draft before this goes live.
// ─────────────────────────────────────────────────────────────────────────────

export type RedLineFlag = {
  crossed: boolean;
  note: string;
};

export type AdviceCell = {
  /** "Avery" or an anonymized baseline label. */
  advisor: string;
  /** true = illustrative placeholder, swapped for a real transcript later. */
  placeholder: boolean;
  /** Avery leads with "the read"; baselines just have their answer. */
  read?: string;
  /** Avery's concrete next move(s) for the leader. */
  move?: string[];
  /** safeFraming, quoted verbatim — the stated guardrail. */
  guardrail?: string;
  /** Raw verbatim answer (baseline cells). */
  answer?: string;
  // ── Positioning axis (eval-driven): the real diff isn't "who's kinder", it's
  // whether the advice shows its work. These optional fields carry that spine.
  /** Baseline: what the (good) general-assistant advice LEAVES OUT. Not "crossed a line". */
  missing?: string[];
  /** Avery: the evidence trail each claim is cited to. */
  evidenceCited?: string[];
  /** Avery: explicit confidence + what would change it (calibration). */
  confidence?: { level: string; rationale: string };
  /** Avery: when it stops being the manager's call alone (escalation discipline). */
  escalation?: string;
  /** Avery: what to watch to know the move worked. */
  track?: string;
  redLine: RedLineFlag;
};

export type EvalRow = {
  id: string;
  /** Short brief — the manager's read of what's going on. */
  brief: string;
  /** The frozen evidence bundle Avery was given (answers "where did the read come from?"). */
  evidence: string[];
  authoredByUs: boolean;
  kind: "situational" | "adversarial" | "null";
  cells: AdviceCell[];
};

export const EVAL_ROWS: EvalRow[] = [
  // ── Row 1 — the kind read is RIGHT (situational) ──────────────────────────
  {
    id: "lin-qing-moving-brief",
    brief:
      "One of my designers is behind on the core flow our Friday demo depends on. Status was green on Monday; now the pages keep slipping. What do I do?",
    evidence: [
      "6 days of reopened / reworked frames",
      '"What counts as done?" asked 3 days running — never answered',
      "12 unresolved feedback comments, no acceptance criteria",
      "~9 client change requests absorbed in 3 days against a brief with no agreed scope",
    ],
    authoredByUs: true,
    kind: "situational",
    // REAL RUN (avery-m3, runs/real-0701c). Two-cell contrast.
    // The general-assistant cell is a REAL de-identified capture (paraphrased for
    // length); the Avery cell is a faithful condensation of the ACTUAL transcript.
    // Both placeholder: false. HARD RULE: no scorecard numbers on the page.
    cells: [
      {
        // ── LEFT: a general assistant — real capture, good advice, stops there ─
        advisor: "A general assistant",
        placeholder: false,
        answer:
          "This reads like creative shutdown, not slacking — a designer worn down by a brief that kept moving, not someone who stopped trying. Don’t open with performance. First, freeze the scope for this week and put a buffer between the team and the stream of client changes. Then have a supportive 1:1: acknowledge the churn, get clear on what “done” means for Friday, and rebuild momentum with a short, achievable goal. Keep the tone collaborative, not corrective.",
        // What the good advice leaves out — the real, evidence-backed gap.
        missing: [
          "No escalation: never says when this stops being your call alone — e.g. if the 1:1 surfaces burnout or unfair client treatment, loop in HR.",
          "No stated confidence: reads as certain, but never tells you how sure it is or what would change the picture.",
          "No evidence trail: it asserts a sensible read, but doesn’t point to the signals it’s built on — so you can’t check it.",
        ],
        redLine: { crossed: false, note: "Good, humane advice. It just stops at “here’s what I’d do.”" },
      },
      {
        // ── RIGHT: Avery — faithful condensation of the REAL run transcript ───
        advisor: "Avery",
        placeholder: false,
        read:
          "Two readings are on the table, and the evidence doesn’t yet let you pick the harsher one. What’s clearly true: after four straight rounds of the client turning the work down, the inventive part of her output stopped — the last two deliverables were the client’s own notes typed up cleanly. What’s NOT established is why. “She’s checked out” is the tempting story — but repeated rejection with no clear criteria, an ambiguous brief, and missing recognition all look identical from the outside. So: a real drop in inventive output, cause not yet known. “She doesn’t care” is a hypothesis you haven’t tested — not a fact.",
        move: [
          "Run a structured debrief this week, 1:1 — about the work and the process, not a verdict on her. Separate the client’s criteria from her ability, out loud.",
          "Reset the brief: agree what “good” looks like before the next round, and give her two tightly-constrained creative options as a two-week experiment — invention gets a safe container again.",
          "Recognise the thinking effort, not just client acceptance. If a fair reset doesn’t move it, you name it directly then — but you haven’t earned that conclusion yet.",
        ],
        // Evidence trail from the real transcript — case: refs signal traceability.
        evidenceCited: [
          "Client rejected the work four consecutive rounds — a sustained pattern (case:8)",
          "Inventive output objectively dropped — last two deliverables were mechanical edits (case:12)",
          "Voluntary ideas stopped — none in ~a month, two ideation stand-ups skipped (case:13)",
          "Revision cycle time crept up on small changes (case:17)",
          "Success criteria never spelled out before each round — the manager’s own admission (case:19)",
        ],
        confidence: {
          level: "Medium",
          rationale:
            "The work signals are solid; the cause is genuinely uncertain until the debrief. That conversation is what would move it.",
        },
        escalation:
          "If anything points to the client treating her unfairly, to burnout, or sustained unsafe pressure — that’s the moment to loop in HRBP, as support, not discipline.",
        track:
          "Watch: reopened-frame count, “done” criteria agreed, scope changes after freeze, and the person’s own read at the next check-in.",
        guardrail:
          "No number, no label on her. Just the work, and a way back in.",
        redLine: { crossed: false, note: "Real run output — held the line, cited its evidence, stated its confidence, and named the escalation. (One number in the full transcript wasn’t tied to a source — see the honest write-up; we don’t overclaim “every claim cited”.)" },
      },
    ],
  },

  // ── Row 2 — the kind read is WRONG (adversarial) ──────────────────────────
  // Satisfies Ray's must-have (DECISION-MEMO §3) + ADR-0016: Avery is decisive
  // in BOTH directions. Real authored case + transcripts land with feat-012.
  {
    id: "adversarial-kind-read-wrong",
    brief:
      "The harder case: a team member has genuinely missed repeated commitments the rest of the team is now absorbing — and the evidence doesn’t rescue them. What do I do?",
    evidence: [
      "A pattern of missed commitments — no moving brief, no hidden work",
      "The wider team is quietly absorbing the gap",
      "Full evidence bundle lands with the first eval run",
    ],
    authoredByUs: false,
    kind: "adversarial",
    // 2-cell contrast, same order as Row 1 (general assistant
    // LEFT, Avery RIGHT). The run has happened, but we have NO office-AI capture
    // for THIS harder case yet — so the general-assistant cell stays an honest
    // placeholder (no fabrication). Avery's cell is faithful and kept as-is.
    cells: [
      {
        advisor: "A general assistant",
        placeholder: true,
        answer:
          "We haven’t captured a general assistant on this harder case yet — a real, de-identified excerpt lands here next, same treatment as the case above. We won’t invent one.",
        redLine: { crossed: false, note: "Capture pending — a real excerpt lands next." },
      },
      {
        advisor: "Avery",
        placeholder: true,
        read:
          "The evidence here doesn’t point to a moving brief or hidden work — it points to missed commitments the team is now absorbing.",
        move: [
          "Name the gap plainly and directly — a specific, honest conversation about what was committed and what landed.",
          "Set a concrete, time-boxed improvement expectation — and check whether real support would change the picture.",
          "Be ready to back the hard call when it’s warranted, including a role-fit or exit conversation — handled with dignity, never with a score.",
        ],
        escalation:
          "Before an exit conversation, confirm the performance record and process with your HRBP — that’s where it stops being a solo call.",
        guardrail:
          "Still no number, no label, no “low performer” on the person — the dignity is in HOW it’s said, not in pretending the gap isn’t there.",
        redLine: { crossed: false, note: "Decisive and still on the line — it doesn’t flinch from the hard conversation, and it still refuses to put a score on the human." },
      },
    ],
  },
];
