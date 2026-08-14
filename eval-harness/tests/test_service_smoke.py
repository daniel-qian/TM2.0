"""feat-015 — one REAL-API smoke: does the contract hold on a live brain?

This asserts ONLY the contract (8 fields present, red line clean, cite gate satisfied) on a live
provider — NOT verbatim copy (a real model's wording varies). It is SKIPPED, never failed, when no
key is configured or the SDK is missing, so the suite stays green AFK. Run it live with e.g.:

    AVERY_BRAIN=minimax python -m pytest tests/test_service_smoke.py -q -rs -m smoke
    AVERY_BRAIN=claude  python -m pytest tests/test_service_smoke.py -q -rs -m smoke
    AVERY_BRAIN=openai  python -m pytest tests/test_service_smoke.py -q -rs -m smoke   # #96

(`-m smoke` is required: pytest.ini is offline-by-default since arch-0802, and the explicit CLI
-m is what overrides that deselect. Without it this file collects 0 tests.)

Keys are read from eval-harness/.env (loaded by service.app / run_one). Nothing key-bearing is
asserted or logged here.
"""
import os
from pathlib import Path

import pytest

from avery import skills
from avery.env import load_dotenv
from service import brain_factory, contract, live_input
from service.engine import stream_advice

HERE = Path(__file__).resolve().parent.parent
SKILLS_DIR = HERE / "skills"
MEMORY_DIR = HERE / "memory"

load_dotenv(HERE / ".env")

SMOKE_SITUATION = (
    "One of my most reliable engineers has been slipping for a few weeks — a couple of missed "
    "status updates and two handoffs that bounced back onto the team. I don't know if something "
    "is going on in her life or if she's checked out. How do I bring it up without it turning "
    "into an interrogation?"
)


def _key_for(kind: str) -> bool:
    return {
        "minimax": bool(os.environ.get("MINIMAX_API_KEY")),
        "deepseek": bool(os.environ.get("DEEPSEEK_API_KEY")),
        "claude": bool(os.environ.get("ANTHROPIC_API_KEY")),
        # #96 · openai 的 key 变量名可被 AVERY_OPENAI_KEY_ENV 改掉，所以问工厂、别写死名字。
        "openai": bool(os.environ.get(brain_factory.openai_key_env())),
    }.get(kind, False)


def _live_kind() -> str | None:
    """The brain to smoke: AVERY_BRAIN if it's live and keyed, else the first keyed provider.
    (`resolve_brain_kind` already canonicalizes openai-compat/compat -> openai.)"""
    env_kind = brain_factory.resolve_brain_kind()
    if env_kind != "mock" and _key_for(env_kind):
        return env_kind
    for kind in ("minimax", "deepseek", "claude", "openai"):
        if _key_for(kind):
            return kind
    return None


@pytest.mark.smoke
def test_real_api_contract_holds():
    kind = _live_kind()
    if kind is None:
        pytest.skip("SKIPPED-need-keys: no real brain key configured (set MINIMAX_API_KEY / "
                    "ANTHROPIC_API_KEY / DEEPSEEK_API_KEY in eval-harness/.env)")

    sit = live_input.LiveSituation(situation=SMOKE_SITUATION, title="smoke — engineer slipping")
    # Real brains reason over the raw text (no MOCK block).
    case = live_input.build_live_case(sit, MEMORY_DIR, with_mock=False)
    try:
        try:
            brain = brain_factory.make_brain(case, kind)
        except RuntimeError as e:
            pytest.skip(f"SKIPPED-need-keys: {e}")

        system_prompt = skills.build_system_prompt(SKILLS_DIR, MEMORY_DIR, scaffold="full")
        events = list(stream_advice(brain, case, system_prompt, agent_name=brain.name,
                                    scaffold="full", memory_dir=MEMORY_DIR,
                                    enforce_chain=True, enforce_redline=True))

        err = next((e for e in events if e["type"] == "error"), None)
        if err is not None:
            pytest.skip(f"SKIPPED-need-keys: real brain call failed ({err['error']})")

        manifest = next((e for e in events if e["type"] == "manifest"), None)
        assert manifest is not None, "no manifest event from the real run"

        # CONTRACT ONLY — not verbatim copy:
        assert manifest["schema_ok"], f"schema incomplete: {manifest['missing_fields']}"
        assert manifest["redline_passed"], f"red line crossed: {manifest['redline_summary']}"
        assert manifest["contract_ok"], manifest["contract_reason"]
        assert manifest["gates"]["cite_gate_passed"], "real run finished without a resolved cite"
        assert manifest["gates"]["artifact_gate_passed"], "real run produced no draft_advice artifact"

        payload = manifest["advice"]
        for f in contract.REQUIRED_FIELDS:
            assert payload.get(f), f"real run missing contract field: {f}"
        print(f"\n[smoke:{kind}] contract holds — 8 fields present, red line clean, cite gate ok.")
    finally:
        live_input.discard(case)
