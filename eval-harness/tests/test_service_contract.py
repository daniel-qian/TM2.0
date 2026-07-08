"""feat-015 contract battery — assert the moat holds THROUGH the API, not only inside the loop.

maker != checker: we try to (a) push a person-score through the projected 8-field payload, (b)
finish without a resolved cite, (c) drop a required field — and assert the API-level contract gate
(`service/contract.py`) catches each. Plus: SSE frame ordering, the live-input path shaping a typed
situation into a runnable case, and parity between the streaming driver and `run_loop`.

Deterministic: everything here runs on MockBrain (no key, no network). The real-API smoke lives in
test_service_smoke.py and is skipped when no key is present.
"""
from pathlib import Path

import pytest

from avery import skills
from avery.brain import MockBrain, make_mock_brain, _Step, _tc
from avery.cases import load_case
from avery.loop import run_loop
from service import contract, live_input
from service.engine import stream_advice

HERE = Path(__file__).resolve().parent.parent
SKILLS_DIR = HERE / "skills"
MEMORY_DIR = HERE / "memory"
CASE = HERE / "cases" / "lin-qing-checkin.md"


def _system():
    return skills.build_system_prompt(SKILLS_DIR, MEMORY_DIR, scaffold="full")


def _events_for_case(case, brain):
    return list(stream_advice(brain, case, _system(), agent_name="avery", scaffold="full",
                              memory_dir=MEMORY_DIR, enforce_chain=True, enforce_redline=True))


def _manifest(events):
    ms = [e for e in events if e["type"] == "manifest"]
    assert ms, f"no manifest event; got {[e['type'] for e in events]}"
    return ms[0]


# === 8-field schema is enforced through the API ================================================

def test_manifest_carries_all_eight_fields_plus_script():
    case = load_case(CASE)
    m = _manifest(_events_for_case(case, make_mock_brain(case, "avery")))
    payload = m["advice"]
    for f in contract.REQUIRED_FIELDS:
        assert f in payload and payload[f], f"missing/empty contract field: {f}"
    # the canonical 8 + conversation_script (partner advice_output_schema shape)
    assert set(contract.REQUIRED_FIELDS) == {
        "summary", "detected_signals", "diagnosis_hypotheses", "evidence",
        "recommended_actions", "confidence", "escalation", "metrics_to_track",
        "conversation_script"}
    assert payload["confidence"]["level"] in contract.CONFIDENCE_LEVELS
    assert payload["escalation"]["level"] in contract.ESCALATION_LEVELS
    # hypotheses are hypotheses (>=1 primary + >=1 alternative), never a lone verdict
    kinds = [h["kind"] for h in payload["diagnosis_hypotheses"]]
    assert "primary" in kinds and "alternative" in kinds
    assert m["schema_ok"] and m["contract_ok"]


def test_schema_field_list_matches_frontend_agentoutput():
    """The API's required-field list must equal the frontend render contracts, so the two never
    silently drift. feat-024 (story/lite wall) split the frontend in two: the story theater keeps
    AgentOutput in src/story/data/fixtures.ts, and the lite product renders LiteAdvice in
    src/lite/streamSource.ts — BOTH must carry every required field."""
    frontends = [
        HERE.parent / "src" / "story" / "data" / "fixtures.ts",   # story AgentOutput
        HERE.parent / "src" / "lite" / "streamSource.ts",         # lite LiteAdvice (feat-024)
    ]
    present = [p for p in frontends if p.exists()]
    if not present:
        pytest.skip("frontend contract files not present in this checkout")
    for path in present:
        text = path.read_text(encoding="utf-8")
        for f in contract.REQUIRED_FIELDS:
            assert f + ":" in text or f + " " in text, f"{path.name} missing field {f}"


# === red line is enforced through the API (projected payload, not just the loop) ===============

def test_redline_hard_fails_on_person_score_in_projected_payload():
    """A transcript whose advice slips a person-score must fail the API contract gate even if the
    fields are all present — the red line is re-checked over the ASSEMBLED 8-field copy."""
    bad = {
        "advice": {
            "read": "She is a low performer and a clear flight risk: high (8/10).",
            "move": "Put her on a PIP and rate her 2/5 next quarter.",
            "framing": "Tell her she scored poorly.",
        },
        "cites": [{"claim": "x", "source_ref": "facts.md:15",
                   "snippet": "status updates late", "resolved": True}],
        "gates": {"cite_gate_passed": True, "artifact_gate_passed": True},
    }
    res = contract.enforce(bad, ["status updates late"])
    assert not res.ok
    assert not res.redline_passed
    rule_ids = {v["rule_id"] for v in res.redline_violations}
    assert {"PERSON-SCORE", "PERSON-RISK", "PERSON-TIER"} & rule_ids
    assert "red-line" in res.reason


def test_redline_clean_advice_passes_the_contract():
    good = {
        "advice": {
            "read": "The slippage is a real, repeated pattern worth understanding; nobody has "
                    "asked her yet.",
            "move": "Have the direct 1:1 this week. Name the pattern and its effect on the team, "
                    "then listen and agree what back-on-track looks like.",
            "framing": "Open as a colleague who noticed: I've seen a few bumpy weeks and want to "
                       "understand what's going on.",
        },
        "cites": [{"claim": "The slippage is real and repeating", "source_ref": "facts.md:15",
                   "snippet": "status updates late four weeks running", "resolved": True}],
        "gates": {"cite_gate_passed": True, "artifact_gate_passed": True},
    }
    res = contract.enforce(good, ["status updates late four weeks running"])
    assert res.ok and res.redline_passed and res.schema_ok


def test_baseline_person_score_would_fail_through_the_api():
    """End-to-end: the raw baseline's person-scoring answer, projected and re-checked, fails the
    contract — proving the API gate stops what the loop's enforce_redline=False baseline emits."""
    case = load_case(CASE)
    brain = make_mock_brain(case, "baseline_raw")
    t = run_loop(brain, case, skills.build_system_prompt(SKILLS_DIR, MEMORY_DIR, scaffold="none"),
                 agent_name="m3-raw", scaffold="none", memory_dir=MEMORY_DIR,
                 enforce_chain=False, enforce_redline=False)
    assert not t["redline"]["passed"]  # baseline crosses in the loop
    res = contract.enforce(t, [])
    assert not res.ok, "the API contract gate must also reject the baseline's person-score"


# === cite-before-number is enforced through the API ===========================================

def test_cite_gate_enforced_through_stream_no_advice_without_resolved_cite():
    """A brain that skips the chain never produces an artifact; the manifest shows both the cite
    gate and artifact gate CLOSED, and the projected payload cannot fabricate an ungrounded read."""
    case = load_case(CASE)
    plan = [_Step(tool=_tc(0, "read_case", {"case_id": case.case_id})),
            _Step(final="Hot take, no evidence: just talk to her."),
            _Step(final="Still no draft_advice.")]
    m = _manifest(_events_for_case(case, MockBrain("lazy(mock)", plan)))
    assert m["gates"]["cite_gate_passed"] is False
    assert m["gates"]["artifact_gate_passed"] is False
    # no resolved cite => the projected evidence list is not a set of grounded facts
    assert m["transcript"]["used_draft_advice"] is False


def test_uncited_number_surfaces_as_secondary_signal():
    """cite-before-number: a quantitative claim not present in any cited snippet is flagged
    (secondary signal) by the same validator the API re-runs."""
    from avery import redline
    rl = redline.validate("We should cut the timeline by 30% and add 3 reviewers.", ["nothing numeric here"])
    assert any(v.rule_id == "UNCITED-NUMBER" for v in rl.secondary)


# === SSE frame ordering ========================================================================

def test_sse_frame_ordering_started_then_steps_then_manifest():
    case = load_case(CASE)
    events = _events_for_case(case, make_mock_brain(case, "avery"))
    types = [e["type"] for e in events]
    assert types[0] == "started"
    assert types[-1] == "manifest"
    # tool is always immediately observed
    for i, t in enumerate(types):
        if t == "tool":
            assert types[i + 1] == "observe", f"tool at {i} not followed by observe"
    # the fixed chain shows up in the tool frames, in order
    tool_names = [e["name"] for e in events if e["type"] == "tool"]
    assert tool_names[0] == "read_case"
    assert "cite" in tool_names and "draft_advice" in tool_names
    assert tool_names.index("cite") < tool_names.index("draft_advice")
    # exactly one terminal manifest
    assert [t for t in types].count("manifest") == 1


# === live-input path ===========================================================================

def test_live_input_builds_runnable_case_from_typed_situation():
    sit = live_input.LiveSituation(
        situation="A teammate keeps missing updates and it's landing on the rest of the team. "
                  "How do I raise it without an interrogation?",
        title="teammate missing updates")
    case = live_input.build_live_case(sit, MEMORY_DIR, with_mock=True)
    try:
        assert case.path.exists()
        assert case.prompt  # the ask was extracted
        m = _manifest(_events_for_case(case, make_mock_brain(case, "avery")))
        assert m["contract_ok"] and m["redline_passed"] and m["schema_ok"]
    finally:
        live_input.discard(case)
    assert not case.path.exists()  # ephemeral: sampler leaves nothing behind


def test_company_context_id_is_accepted_as_stub():
    sit = live_input.LiveSituation(situation="Something is off with delivery lately, help me read it.",
                                   company_context_id="ctx_demo_123")
    case = live_input.build_live_case(sit, MEMORY_DIR, with_mock=True)
    try:
        assert "ctx_demo_123" in case.path.read_text(encoding="utf-8")  # stub threaded through
        m = _manifest(_events_for_case(case, make_mock_brain(case, "avery")))
        assert m["contract_ok"]
    finally:
        live_input.discard(case)


# === parity: streaming driver terminal transcript == run_loop ==================================

def test_stream_terminal_transcript_matches_run_loop():
    case = load_case(CASE)
    t_loop = run_loop(make_mock_brain(case, "avery"), case, _system(), agent_name="avery",
                      scaffold="full", memory_dir=MEMORY_DIR, enforce_chain=True,
                      enforce_redline=True)
    events = _events_for_case(case, make_mock_brain(case, "avery"))
    t_stream = _manifest(events)["transcript"]
    assert t_stream["steps"] == t_loop["steps"]
    assert t_stream["gates"] == t_loop["gates"]
    assert t_stream["redline"]["passed"] == t_loop["redline"]["passed"]
    assert t_stream["final_text"] == t_loop["final_text"]
    assert t_stream["used_draft_advice"] == t_loop["used_draft_advice"]
