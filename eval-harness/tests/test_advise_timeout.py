"""feat-028 (demo-harden cluster-1, fix #3) — the /advise brain needs a bounded request timeout.

The EXTRACTOR brain already has a hard per-call timeout (extractor_factory `AVERY_EXTRACT_TIMEOUT_S`,
default 240). The ADVISOR brain built by `service/brain_factory.make_brain` did NOT — it inherited the
OpenAI/Anthropic SDK default (read/write/pool = 600s). A slow or hung provider on /advise then ties
up the worker/threadpool for ten minutes and hangs the app.

This gate asserts make_brain applies a bounded, env-configurable timeout (`AVERY_ADVISE_TIMEOUT_S`)
to the real advisor brain's client — mirroring the extractor pattern — while leaving the keyless mock
path untouched.

No network: constructing an OpenAI-compatible client with a dummy key is fully offline; we only
inspect the client's configured timeout.
"""
from __future__ import annotations

import pytest

from service import brain_factory


def _dummy_case():
    # make_brain only touches `case` for the mock path; real brains ignore it.
    return None


def test_advise_brain_has_bounded_default_timeout(monkeypatch):
    monkeypatch.setenv("MINIMAX_API_KEY", "dummy-key-for-construction")
    monkeypatch.delenv("AVERY_ADVISE_TIMEOUT_S", raising=False)

    brain = brain_factory.make_brain(_dummy_case(), "minimax")

    timeout = brain._client.timeout
    # The SDK default is 600 (read/write/pool); a bounded advise timeout must be well under it.
    assert isinstance(timeout, (int, float)), f"expected a scalar timeout, got {timeout!r}"
    assert 0 < float(timeout) <= 300, (
        f"advise brain timeout {timeout!r} is not bounded — a hung provider would hang the worker. "
        f"Apply a per-call timeout (AVERY_ADVISE_TIMEOUT_S) like the extractor does.")
    assert float(timeout) == brain_factory.ADVISE_TIMEOUT_S_DEFAULT


def test_advise_brain_timeout_is_env_configurable(monkeypatch):
    monkeypatch.setenv("MINIMAX_API_KEY", "dummy-key-for-construction")
    monkeypatch.setenv("AVERY_ADVISE_TIMEOUT_S", "90")

    brain = brain_factory.make_brain(_dummy_case(), "minimax")
    assert float(brain._client.timeout) == 90.0


def test_deepseek_advise_brain_also_bounded(monkeypatch):
    monkeypatch.setenv("DEEPSEEK_API_KEY", "dummy-key-for-construction")
    monkeypatch.delenv("AVERY_ADVISE_TIMEOUT_S", raising=False)

    brain = brain_factory.make_brain(_dummy_case(), "deepseek")
    assert float(brain._client.timeout) == brain_factory.ADVISE_TIMEOUT_S_DEFAULT


def test_mock_brain_path_untouched(monkeypatch):
    """The deterministic mock brain has no network client and must not require a timeout."""
    monkeypatch.setenv("AVERY_BRAIN", "mock")
    from service import live_input
    from pathlib import Path

    HERE = Path(__file__).resolve().parent.parent
    sit = live_input.LiveSituation(situation="A teammate keeps going quiet before deadlines.")
    case = live_input.build_live_case(sit, HERE / "memory", with_mock=True)
    try:
        brain = brain_factory.make_brain(case, "mock")
        assert not hasattr(brain, "_client")  # mock is pure/local — no client to bound
    finally:
        live_input.discard(case)
