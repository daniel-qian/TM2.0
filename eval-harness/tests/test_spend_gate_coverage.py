# -*- coding: utf-8 -*-
"""0805 走查修闸 — the spend-gate COVERAGE audit, fully offline (mock-layer call counting, 零真钱).

The 0805 production walkthrough smelled a budget hole and mis-attributed it: `llm_calls_remaining`
2000→1996 was pinned on the 4 /advise turns, while the 4 real-LLM extraction batches "didn't move
the counter". The code said the opposite — extraction has been BudgetedBrain-wrapped since feat-039
(the 4 burned units WERE the 4 extraction calls), and /advise — an agentic loop of up to
MAX_ITERS(12) model calls per turn, rate limit default-off — was the channel with NO counting point
at all. Embeddings (DashScope) had none either, on any path.

These tests pin the WIRING, not the engine shape:
  * /advise (live kind) charges the LLM budget once per model call, and a spent budget
    short-circuits BEFORE any model call is made;
  * the mock brain stays exempt (the offline suite must never charge or trip the gate);
  * DashScopeEmbedder charges the SEPARATE embed budget once per billable HTTP batch, and refuses
    the batch (no HTTP) once that budget is spent;
  * every embed-refusal degrades: recall falls back to keyword, ingest still lands its context.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

pytest.importorskip("fastapi.testclient")
from fastapi.testclient import TestClient  # noqa: E402

from avery import embeddings as emb_mod  # noqa: E402
from avery.brain import BrainResponse  # noqa: E402
from service import brain_factory, llm_budget  # noqa: E402

HERE = Path(__file__).resolve().parent.parent
HANDBOOK = HERE / "tests" / "fixtures" / "ingest" / "Studio_Handbook.md"


def _reset_all():
    from avery.ingest.registry import REGISTRY
    from service import mem_sentinel, upload_guard
    REGISTRY.clear()
    upload_guard.reset_rate_limiter()
    llm_budget.reset()
    mem_sentinel.reset()


@pytest.fixture()
def client(monkeypatch):
    """Offline app (mock brain / keyword / heuristic / no DB) — same posture as the hardgate suite.
    Individual tests flip AVERY_BRAIN or budgets via monkeypatch."""
    monkeypatch.setenv("AVERY_BRAIN", "mock")
    monkeypatch.setenv("AVERY_EMBEDDINGS", "keyword")
    monkeypatch.setenv("AVERY_EXTRACTOR", "heuristic")
    monkeypatch.delenv("AVERY_DB_URL", raising=False)
    monkeypatch.delenv("PGVECTOR_URL", raising=False)
    _reset_all()
    from service.app import app
    with TestClient(app) as c:
        yield c
    _reset_all()


class _CountingBrain:
    """A live-brain stand-in: counts respond() calls, always answers final text (no tool calls)."""

    name = "fake-live"

    def __init__(self):
        self.calls = 0

    def respond(self, system, conversation, tools):
        self.calls += 1
        return BrainResponse(tool_calls=[], text="ok")


# ==============================================================================================
# 1) /advise — the hole the walkthrough smelled: the loop's model calls must charge the budget.
# ==============================================================================================

def test_advise_live_brain_charges_llm_budget(client, monkeypatch):
    fake = _CountingBrain()
    monkeypatch.setenv("AVERY_BRAIN", "minimax")          # a LIVE kind — the wrap must engage
    monkeypatch.setenv("AVERY_LLM_CALL_BUDGET", "50")     # armed, not tripped
    monkeypatch.setattr(brain_factory, "make_brain", lambda case, kind=None: fake)

    client.post("/advise", json={"situation": "how do we unblock the checkout revamp?",
                                 "stream": False})

    assert fake.calls >= 1, "the advise loop made no model call at all — test wiring is broken"
    assert llm_budget.used() == fake.calls, (
        f"the /advise loop made {fake.calls} model calls but charged {llm_budget.used()} — "
        "the brain is not (fully) behind BudgetedBrain")


def test_advise_spent_budget_short_circuits_before_any_model_call(client, monkeypatch):
    fake = _CountingBrain()
    monkeypatch.setenv("AVERY_BRAIN", "minimax")
    monkeypatch.setenv("AVERY_LLM_CALL_BUDGET", "1")
    monkeypatch.setattr(brain_factory, "make_brain", lambda case, kind=None: fake)
    llm_budget.charge(1)                                  # spend the whole budget up front

    r = client.post("/advise", json={"situation": "anything", "stream": False})

    assert fake.calls == 0, "a spent budget must refuse /advise BEFORE any model call"
    assert r.status_code == 502
    assert "budget exhausted" in r.text.lower()


def test_advise_mock_brain_never_charges(client, monkeypatch):
    """The offline suite's reality: mock advise turns must neither charge nor trip the gate."""
    monkeypatch.setenv("AVERY_LLM_CALL_BUDGET", "1")      # tightest possible ceiling
    llm_budget.charge(1)                                  # ...and already spent

    r = client.post("/advise", json={"situation": "walk me through the team's week",
                                     "stream": False})

    assert r.status_code == 200, (
        "the mock brain is pure/local — a spent LLM budget must not block it: " + r.text[:300])
    assert llm_budget.used() == 1, "a mock advise turn must not charge the LLM budget"


# ==============================================================================================
# 2) Embeddings — every billable DashScope batch passes the (separate) embed budget.
# ==============================================================================================

class _FakeHTTP:
    """Stands in for urllib.request.urlopen: serves dimension-correct vectors, counts calls."""

    def __init__(self):
        self.calls = 0

    def __call__(self, req, timeout=None):
        self.calls += 1
        body = json.loads(req.data.decode("utf-8"))
        payload = {"data": [{"index": i, "embedding": [1.0] + [0.0] * (body["dimensions"] - 1)}
                            for i in range(len(body["input"]))]}

        class _Resp:
            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

            def read(self):
                return json.dumps(payload).encode("utf-8")
        return _Resp()


@pytest.fixture()
def dashscope(monkeypatch):
    """A real DashScopeEmbedder over a fake HTTP layer, with the service's spend gate installed
    (exactly what service.embedding_factory does at import)."""
    http = _FakeHTTP()
    monkeypatch.setattr(emb_mod.urllib.request, "urlopen", http)
    emb_mod.install_spend_gate(llm_budget.embed_spend_gate)
    llm_budget.reset()
    yield emb_mod.DashScopeEmbedder(api_key="test-key"), http
    llm_budget.reset()


def test_embedder_charges_embed_budget_per_http_batch(dashscope, monkeypatch):
    embedder, http = dashscope
    monkeypatch.setenv("AVERY_EMBED_CALL_BUDGET", "10")

    embedder.embed([f"text {i}" for i in range(25)])      # 25 texts / batch<=10 -> 3 HTTP calls

    assert http.calls == 3
    assert llm_budget.embed_used() == 3, (
        "each billable DashScope batch must charge the embed budget exactly once")
    assert llm_budget.used() == 0, "embeddings must NOT drain the LLM chat-call counter"


def test_embedder_refuses_batch_once_embed_budget_spent(dashscope, monkeypatch):
    embedder, http = dashscope
    monkeypatch.setenv("AVERY_EMBED_CALL_BUDGET", "1")
    llm_budget.charge_embed(1)                            # spend the whole embed budget

    with pytest.raises(llm_budget.EmbedBudgetExceeded):
        embedder.embed(["one more"])
    assert http.calls == 0, "a spent embed budget must refuse BEFORE the billable HTTP call"


def test_recall_degrades_to_keyword_when_embed_budget_spent(dashscope, monkeypatch, tmp_path):
    from avery import memory
    embedder, http = dashscope
    monkeypatch.setenv("AVERY_EMBED_CALL_BUDGET", "1")
    llm_budget.charge_embed(1)
    (tmp_path / "facts.md").write_text(
        "# facts\n- The checkout revamp pipeline build is green.\n", encoding="utf-8")

    hits = memory.recall("pipeline green build", tmp_path, embedder=embedder)

    assert hits, "recall must fall back to keyword when the embed gate refuses — never go empty"
    assert http.calls == 0


def test_ingest_still_lands_when_embed_budget_spent(dashscope, monkeypatch):
    from avery.ingest.pipeline import ingest_paths
    from avery.ingest.registry import ContextRegistry
    embedder, http = dashscope
    monkeypatch.setenv("AVERY_EMBED_CALL_BUDGET", "1")
    monkeypatch.setenv("AVERY_EXTRACTOR", "heuristic")
    llm_budget.charge_embed(1)

    rep = ingest_paths([str(HANDBOOK)], registry=ContextRegistry(),
                       embedder=embedder, prefer_vector=True)

    assert rep.ok, "an embed-budget refusal must degrade the ingest, never fail the upload"
    assert rep.context.store.backend == "keyword", (
        "the degraded context must honestly run keyword retrieval, "
        f"got {rep.context.store.backend!r}")
    assert http.calls == 0


# ==============================================================================================
# 3) The wiring + observability seams themselves.
# ==============================================================================================

def test_service_import_installs_the_embed_spend_gate():
    import importlib

    import service.embedding_factory
    importlib.reload(service.embedding_factory)           # re-run the install side effect
    assert emb_mod._SPEND_GATE is llm_budget.embed_spend_gate


def test_health_reports_both_budget_counters(client, monkeypatch):
    monkeypatch.setenv("AVERY_LLM_CALL_BUDGET", "10")
    monkeypatch.setenv("AVERY_EMBED_CALL_BUDGET", "20")
    llm_budget.charge(3)
    llm_budget.charge_embed(5)

    body = client.get("/health").json()

    assert body["llm_calls_remaining"] == 7
    assert body["embed_calls_remaining"] == 15


def test_reset_zeroes_both_counters():
    llm_budget.charge(2)
    llm_budget.charge_embed(3)
    llm_budget.reset()
    assert llm_budget.used() == 0 and llm_budget.embed_used() == 0
