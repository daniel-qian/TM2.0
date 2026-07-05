"""FastAPI app — the Avery agent service (feat-015).

Endpoints
---------
GET  /health
        Liveness + which brain is configured (no keys revealed).

POST /advise
        Live-input advice. Body: {situation, title?, company_context_id?, stream?}.
        Default streams SSE: think/tool/observe events, then a terminal `manifest` event with the
        8-field contract payload. Set {"stream": false} (or Accept: application/json) for a single
        buffered JSON body with the same manifest content.

GET  /advise/sample
        Zero-body SSE demo against a built-in situation — handy for a browser / curl smoke.

The service WRAPS the existing engine (`avery/loop.py`, `avery/redline.py`, `avery/brain.py`). The
red line + cite gate + 8-field schema are enforced through this API by `service/contract.py`.
Keys stay server-side (`service/brain_factory.py`); the frontend only ever sees SSE events.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Iterator

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sse_starlette.sse import EventSourceResponse

from avery import skills
from avery.env import load_dotenv

from . import brain_factory, live_input
from .engine import stream_advice
from .ingest_api import router as ingest_router  # feat-018: /ingest + /team/{id} (compose over feat-016)

HERE = Path(__file__).resolve().parent.parent          # eval-harness/
SKILLS_DIR = HERE / "skills"
MEMORY_DIR = HERE / "memory"

# Pick up MINIMAX_*/DEEPSEEK_*/ANTHROPIC_* from eval-harness/.env if present (real shell wins).
load_dotenv(HERE / ".env")

app = FastAPI(
    title="Avery agent service",
    version="0.1.0",
    summary="LiveAgentSource backend — advisor engine (think->tool->observe) over FastAPI + SSE.",
)

# feat-018: the ingestion HTTP surface (upload → Your team). Thin wrapper over feat-016's
# ingest_paths + registry; nothing in the engine changes. Endpoints: POST /ingest, GET /team/{id}.
app.include_router(ingest_router)

SAMPLE_SITUATION = (
    "One of my most reliable engineers has been slipping for a few weeks — a couple of missed "
    "status updates and two handoffs that bounced back onto the team. I don't know if something "
    "is going on in her life or if she's checked out. How do I bring it up without it turning "
    "into an interrogation?"
)


class AdviseRequest(BaseModel):
    situation: str = Field(..., min_length=1,
                           description="The manager's typed management situation + the ask.")
    title: str | None = Field(None, description="Optional short label for the situation.")
    company_context_id: str | None = Field(
        None, description="feat-016 stub: handle for an ingested company RAG context.")
    stream: bool = Field(True, description="SSE stream (default) vs a single buffered JSON body.")


def _system_prompt() -> str:
    return skills.build_system_prompt(SKILLS_DIR, MEMORY_DIR, scaffold="full")


def _resolve_memory_dir(company_context_id: str | None) -> Path:
    """feat-018: route an ingested company_context_id to its materialized facts.md/notes.md dir so
    the loop's own recall + cite gate run over the manager's UPLOADED facts (feat-016 seam). Falls
    back to the default demo memory for an unset/unknown id. Import is lazy so the service still runs
    if the ingest package is absent."""
    if not company_context_id:
        return MEMORY_DIR
    try:
        from avery.ingest.seam import resolve_memory_dir
        return resolve_memory_dir(company_context_id, MEMORY_DIR)
    except Exception:
        return MEMORY_DIR


def _run_events(sit: live_input.LiveSituation) -> tuple[Iterator[dict[str, Any]], Any]:
    """Build the live case, pick the brain, and return the engine event iterator + the case (so
    the caller can discard the temp file when done). Brain-config errors surface as an error event
    iterator rather than a 500, keeping the SSE contract stable."""
    kind = brain_factory.resolve_brain_kind()
    # Mock needs a MOCK block in the case; real brains reason over raw text.
    with_mock = (kind == "mock")
    memory_dir = _resolve_memory_dir(sit.company_context_id)
    case = live_input.build_live_case(sit, memory_dir, with_mock=with_mock)
    try:
        brain = brain_factory.make_brain(case, kind)
    except RuntimeError as e:
        def _err() -> Iterator[dict[str, Any]]:
            yield {"type": "error", "error": str(e),
                   "hint": "set AVERY_BRAIN + the matching key, or use AVERY_BRAIN=mock."}
        return _err(), case

    events = stream_advice(
        brain, case, _system_prompt(), agent_name=getattr(brain, "name", kind),
        scaffold="full", memory_dir=memory_dir, enforce_chain=True, enforce_redline=True)
    return events, case


def _sse(events: Iterator[dict[str, Any]], case) -> EventSourceResponse:
    """Wrap engine events as Server-Sent Events. Each event: `event:` = type, `data:` = JSON."""
    def gen():
        try:
            for ev in events:
                yield {"event": ev.get("type", "message"),
                       "data": json.dumps(ev, ensure_ascii=False)}
        finally:
            live_input.discard(case)
    return EventSourceResponse(gen())


@app.get("/health")
def health() -> dict:
    kind = brain_factory.resolve_brain_kind()
    return {"status": "ok", "service": "avery-agent", "brain": kind,
            "live": brain_factory.brain_is_live()}


@app.post("/advise")
def advise(req: AdviseRequest):
    sit = live_input.LiveSituation(
        situation=req.situation, title=req.title,
        company_context_id=req.company_context_id)
    events, case = _run_events(sit)

    if req.stream:
        return _sse(events, case)

    # Buffered: drain to the terminal manifest (or error) and return one JSON body.
    try:
        collected: list[dict] = list(events)
    finally:
        live_input.discard(case)
    manifest = next((e for e in reversed(collected) if e["type"] == "manifest"), None)
    if manifest is None:
        err = next((e for e in collected if e["type"] == "error"), None)
        return JSONResponse(status_code=502,
                            content={"error": (err or {}).get("error", "no manifest produced"),
                                     "events": collected})
    return JSONResponse(content={**manifest, "events": collected})


@app.get("/advise/sample")
def advise_sample():
    sit = live_input.LiveSituation(situation=SAMPLE_SITUATION, title="Sample — reliable engineer slipping")
    events, case = _run_events(sit)
    return _sse(events, case)
