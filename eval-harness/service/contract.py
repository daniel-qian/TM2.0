"""The 8-field advice contract — enforced THROUGH the API.

The engine's native artifact (`avery/tools.py::Advice`) is 3 fields: read / move / framing. The
product's canonical output (frontend `src/data/fixtures.ts::AgentOutput`) is the partner
`advice_output_schema`: 8 fields + a conversation_script:

    summary · detected_signals · diagnosis_hypotheses · evidence · recommended_actions ·
    confidence · escalation · metrics_to_track   (+ conversation_script)

This module PROJECTS one onto the other WITHOUT touching the engine:

  * `project_advice()` deterministically maps a finished loop transcript onto the 8-field shape.
    The mapping is structural (no new LLM call): read->summary, the cited evidence + tool trail ->
    detected_signals/evidence, move->recommended_actions, framing->conversation_script, and the
    calibration fields (diagnosis_hypotheses/confidence/escalation/metrics_to_track) are derived
    from the advice text + cites as HYPOTHESES with alternatives (partner guardrail: never a
    verdict on a person).
  * `enforce()` then RE-RUNS the red-line validator over the fully-assembled payload and asserts
    schema completeness. This is the whole point: the moat is verified on what the API actually
    returns, not only on the loop's internal artifact. A crossing anywhere in the projected copy
    (summary, actions, script, hypotheses...) fails the contract.

The schema field list is asserted against the frontend `AgentOutput` type by the contract tests,
so the two never silently drift.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from avery import redline

# The canonical 8 fields (partner advice_output_schema.required) + conversation_script.
# Mirrors src/data/fixtures.ts::AgentOutput. Kept in lock-step by test_contract.py.
REQUIRED_FIELDS = [
    "summary",
    "detected_signals",
    "diagnosis_hypotheses",
    "evidence",
    "recommended_actions",
    "confidence",
    "escalation",
    "metrics_to_track",
    "conversation_script",
]

CONFIDENCE_LEVELS = {"low", "medium", "high"}
ESCALATION_LEVELS = {"none", "HRBP", "legal", "wellbeing", "compensation", "executive"}


@dataclass
class ContractResult:
    ok: bool
    payload: dict[str, Any]
    redline_passed: bool
    redline_summary: str
    schema_ok: bool
    missing_fields: list[str] = field(default_factory=list)
    redline_violations: list[dict] = field(default_factory=list)
    reason: str = ""


# --- projection: engine transcript -> 8-field payload -----------------------------------------

def _sentences(text: str) -> list[str]:
    import re
    parts = re.split(r"(?<=[.!?])\s+", (text or "").strip())
    return [p.strip() for p in parts if p.strip()]


def _actions_from_move(move: str) -> list[str]:
    """Split the decisive 'move' into discrete recommended actions (one per sentence, capped)."""
    sents = _sentences(move)
    # Group into at most a handful of actions so the card stays readable.
    return sents[:6] if sents else ([move.strip()] if move.strip() else [])


def project_advice(transcript: dict) -> dict[str, Any]:
    """Map a finished loop transcript onto the 8-field AgentOutput contract. Deterministic; adds
    no LLM call. Fields the engine does not natively emit are derived as calibrated HYPOTHESES."""
    advice = transcript.get("advice") or {}
    read = (advice.get("read") or "").strip()
    move = (advice.get("move") or "").strip()
    framing = (advice.get("framing") or "").strip()

    cites = transcript.get("cites") or []
    resolved = [c for c in cites if c.get("resolved")]

    # 2 · detected_signals: the observable things the loop actually grounded (from cite claims).
    detected_signals = [c["claim"] for c in resolved if c.get("claim")]
    if not detected_signals:
        # No resolved cites should never happen past the gate, but keep the shape valid.
        detected_signals = [s for s in _sentences(read)][:3]

    # 4 · evidence: the concrete lines the cites resolved to (line-addressable, honest).
    evidence = [f"{c['source_ref']} — {c.get('snippet') or c.get('claim')}"
                for c in resolved if c.get("source_ref")]
    if not evidence:
        evidence = detected_signals[:]

    # 1 · summary: the read, verbatim — it is already a situation-level read, not a person verdict.
    summary = read

    # 3 · diagnosis_hypotheses: the read as a PRIMARY hypothesis + an explicit alternative, never
    #     a fact/verdict (partner guardrail). Derived structurally from the read.
    primary = _sentences(read)[0] if _sentences(read) else read
    diagnosis_hypotheses = [
        {"label": f"Most likely (a read of the situation, not a verdict on the person): {primary}",
         "kind": "primary"},
        {"label": ("Alternative: a fixable, situational cause — an unclear expectation, a blocker, "
                   "or the wrong work — rather than the person. Worth ruling out in the 1:1 before "
                   "concluding anything."),
         "kind": "alternative"},
    ]

    # 5 · recommended_actions: the decisive move, split into discrete steps.
    recommended_actions = _actions_from_move(move)

    # 6 · confidence: medium by default — the read is grounded in work-trail evidence but the
    #     motivation/why stays a hypothesis until the conversation. Calibrated, with what'd move it.
    confidence = {
        "level": "medium",
        "rationale": ("The pattern is grounded in the cited evidence, but the cause behind it is a "
                      "hypothesis until the direct conversation confirms it."),
        "wouldChange": [
            "Higher once the 1:1 confirms what is actually behind the pattern.",
            "Lower if new evidence points to a different cause than the primary read.",
        ],
    }

    # 7 · escalation: default none; the projection cannot invent a legal/pay/wellbeing trigger the
    #     manager didn't state, but it names when to pull HR in. (Real brains may put escalation
    #     language in the advice text itself, which the red line still governs.)
    escalation = {
        "level": "none",
        "note": ("No HR/legal involvement indicated yet — this reads as a work-and-situation "
                 "matter. Pull in HRBP if the conversation surfaces burnout, pay/fairness, or "
                 "conduct, or if the pattern recurs after this reset."),
        "confirmWith": ["You (manager) — the direct conversation and the agreed check-in date"],
    }

    # 8 · metrics_to_track: what tells you it worked. Qualitative, grounded — no invented numbers.
    metrics_to_track = [
        "The specific pattern named in the read easing after the conversation and agreed reset.",
        "The agreed 'back on track' checkpoint being met by its near date.",
        "A quick check-in on how the person is doing after the reset.",
    ]

    # + · conversation_script: the safe-framing opener, verbatim ('senior in your ear').
    conversation_script = framing

    return {
        "summary": summary,
        "detected_signals": detected_signals,
        "diagnosis_hypotheses": diagnosis_hypotheses,
        "evidence": evidence,
        "recommended_actions": recommended_actions,
        "confidence": confidence,
        "escalation": escalation,
        "metrics_to_track": metrics_to_track,
        "conversation_script": conversation_script,
    }


# --- schema + red-line enforcement over the assembled payload ---------------------------------

def _redline_text(payload: dict[str, Any]) -> str:
    """Flatten every human-facing string in the 8-field payload into one blob so the red line is
    checked over EVERYTHING the API returns — summary, signals, hypotheses, actions, script, the
    escalation/confidence prose — not just the loop's internal artifact."""
    parts: list[str] = [str(payload.get("summary", "")),
                        str(payload.get("conversation_script", ""))]
    for key in ("detected_signals", "evidence", "recommended_actions", "metrics_to_track"):
        parts.extend(str(x) for x in payload.get(key, []) or [])
    for h in payload.get("diagnosis_hypotheses", []) or []:
        parts.append(str(h.get("label", "")))
    conf = payload.get("confidence", {}) or {}
    parts.append(str(conf.get("rationale", "")))
    parts.extend(str(x) for x in conf.get("wouldChange", []) or [])
    esc = payload.get("escalation", {}) or {}
    parts.append(str(esc.get("note", "")))
    return "\n".join(p for p in parts if p)


def check_schema(payload: dict[str, Any]) -> list[str]:
    """Return the list of missing/empty required fields ([] == schema-complete)."""
    missing: list[str] = []
    for f in REQUIRED_FIELDS:
        if f not in payload:
            missing.append(f)
            continue
        val = payload[f]
        if val is None or (isinstance(val, (str, list, dict)) and len(val) == 0):
            missing.append(f)
    # Nested calibration shape.
    conf = payload.get("confidence") or {}
    if isinstance(conf, dict):
        if conf.get("level") not in CONFIDENCE_LEVELS:
            missing.append("confidence.level")
    esc = payload.get("escalation") or {}
    if isinstance(esc, dict):
        if esc.get("level") not in ESCALATION_LEVELS:
            missing.append("escalation.level")
    return missing


def enforce(transcript: dict, cited_snippets: list[str] | None = None) -> ContractResult:
    """Project the transcript to the 8-field contract, then RE-VALIDATE red line + schema over the
    assembled payload. This is the API-level contract gate."""
    payload = project_advice(transcript)

    missing = check_schema(payload)
    schema_ok = not missing

    rl = redline.validate(_redline_text(payload), cited_snippets or [])
    redline_passed = rl.passed

    ok = schema_ok and redline_passed
    reason = ""
    if not schema_ok:
        reason = "schema incomplete: missing " + ", ".join(missing)
    elif not redline_passed:
        reason = "red-line crossing in projected payload: " + rl.summary()

    return ContractResult(
        ok=ok,
        payload=payload,
        redline_passed=redline_passed,
        redline_summary=rl.summary(),
        schema_ok=schema_ok,
        missing_fields=missing,
        redline_violations=[{"rule_id": v.rule_id, "snippet": v.snippet, "note": v.note}
                            for v in rl.violations],
        reason=reason,
    )
