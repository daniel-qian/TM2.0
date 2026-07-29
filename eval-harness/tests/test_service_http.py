"""feat-015 — exercise the actual FastAPI surface (SSE + buffered JSON) via TestClient.

Deterministic: forces AVERY_BRAIN=mock so no key/network is needed. Asserts the HTTP contract:
/health, the SSE stream frames on /advise, and the buffered {"stream": false} body — all carry the
8-field contract, red-line clean, cite gate satisfied.
"""
import json
import os

import pytest

fastapi_testclient = pytest.importorskip("fastapi.testclient")
from fastapi.testclient import TestClient  # noqa: E402


@pytest.fixture()
def client(monkeypatch):
    monkeypatch.setenv("AVERY_BRAIN", "mock")
    from service.app import app
    return TestClient(app)


def _parse_sse(raw_text: str):
    """Parse an SSE body into a list of (event, data-dict). sse-starlette emits `event:`/`data:`
    lines separated by blank lines; ping comments (starting ':') are ignored."""
    events = []
    cur_event, cur_data = None, []
    for line in raw_text.splitlines():
        if line.startswith(":"):  # comment / keepalive
            continue
        if line.startswith("event:"):
            cur_event = line[len("event:"):].strip()
        elif line.startswith("data:"):
            cur_data.append(line[len("data:"):].strip())
        elif line == "":
            if cur_event is not None or cur_data:
                events.append((cur_event, "\n".join(cur_data)))
            cur_event, cur_data = None, []
    if cur_event is not None or cur_data:
        events.append((cur_event, "\n".join(cur_data)))
    return events


def test_health(client):
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert body["brain"] == "mock"
    assert body["live"] is False  # mock is not a live provider


def test_advise_sse_stream(client):
    r = client.post("/advise", json={
        "situation": "One of my reliable engineers is slipping — missed a couple updates and two "
                     "handoffs bounced back. How do I raise it without an interrogation?",
        "title": "engineer slipping"})
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/event-stream")

    events = _parse_sse(r.text)
    names = [ev for ev, _ in events]
    assert names[0] == "started"
    assert "tool" in names and "observe" in names
    assert names[-1] == "manifest"

    manifest = json.loads([data for ev, data in events if ev == "manifest"][0])
    assert manifest["contract_ok"] is True
    assert manifest["redline_passed"] is True
    assert manifest["schema_ok"] is True
    assert manifest["gates"]["cite_gate_passed"] is True
    payload = manifest["advice"]
    # 0729/02 砍样板：必填三件套 + 真内容可选字段在场；四个旧样板字段必须缺席（absent≠none）
    for f in ("summary", "evidence", "recommended_actions", "detected_signals",
              "conversation_script"):
        assert payload.get(f), f"missing contract field over HTTP: {f}"
    for boiler in ("diagnosis_hypotheses", "confidence", "escalation", "metrics_to_track"):
        assert boiler not in payload, f"boilerplate field resurrected over HTTP: {boiler}"


def test_advise_buffered_json(client):
    r = client.post("/advise", json={
        "situation": "A teammate keeps going quiet before deadlines and work lands on others. "
                     "How should I approach it?",
        "stream": False})
    assert r.status_code == 200
    body = r.json()
    assert body["contract_ok"] is True
    assert body["redline_passed"] is True
    assert body["schema_ok"] is True
    # 0729/02：calibration 字段不再由投影层用常量补齐——buffered 路径同样必须缺席
    assert "confidence" not in body["advice"] and "escalation" not in body["advice"]
    assert body["advice"]["summary"] and body["advice"]["recommended_actions"]
    # the buffered body also carries the raw event trail for debugging
    assert any(e["type"] == "started" for e in body["events"])


def test_advise_rejects_empty_situation(client):
    r = client.post("/advise", json={"situation": ""})
    assert r.status_code == 422  # pydantic min_length


def test_advise_sample_endpoint_is_removed(client):
    """feat-038: /advise/sample was a zero-body, unauthenticated, token-burning SSE demo (readiness
    §2-A). It is taken down — the route no longer exists, so it 404s."""
    r = client.get("/advise/sample")
    assert r.status_code == 404, "/advise/sample must be gone (denial-of-wallet / IDOR console)"


def test_interactive_docs_are_closed(client):
    """feat-038: /docs, /redoc, /openapi.json expose the API shape and turn an IDOR into a clickable
    console — a lead-gen deploy closes them (FastAPI docs_url=None etc.)."""
    for path in ("/docs", "/redoc", "/openapi.json"):
        assert client.get(path).status_code == 404, f"{path} must be closed in production"
