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
import os
from pathlib import Path
from typing import Any, Iterator

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sse_starlette.sse import EventSourceResponse

from avery import skills
from avery.env import load_dotenv

from . import brain_factory, embedding_factory, extractor_factory, live_input
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

# Browser live mode (frontend :5173 -> this service :8137) needs CORS. Origins are env-configurable
# for deploy (AVERY_CORS_ORIGINS, comma-separated); dev defaults to the Vite dev ports.
_cors_origins = [
    o.strip()
    for o in os.getenv(
        "AVERY_CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
    ).split(",")
    if o.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
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


def _context_registered(company_context_id: str) -> bool:
    """feat-028: is this id ACTUALLY in the ingest registry? This distinguishes the two cases the old
    silent fallback conflated — 'no id -> demo memory (legit)' vs 'id GIVEN but not found -> error'.
    A wiped/restarted registry must surface an error, never a silent answer over the demo company
    (Isadora: identity must never silently default). feat-030: the env-selected registry — with
    AVERY_DB_URL set this is the Postgres registry, so an id ingested BEFORE a restart resolves
    (no more 404 on a known company). Lazy import so the service runs without ingest."""
    try:
        from avery.ingest.registry import active_registry
        return company_context_id in active_registry()
    except Exception:
        return False


def _resolve_memory_dir(company_context_id: str | None) -> Path:
    """feat-018: route an ingested company_context_id to its materialized facts.md/notes.md dir so
    the loop's own recall + cite gate run over the manager's UPLOADED facts (feat-016 seam). Falls
    back to the default demo memory for an UNSET id (the /advise handler rejects a given-but-unknown
    id up front, so this only ever sees a known id or none). Import is lazy so the service still runs
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
        scaffold="full", memory_dir=memory_dir, enforce_chain=True, enforce_redline=True,
        embedder=embedding_factory.make_embedder())  # None -> keyword recall (key stays server-side)
    return events, case


def _sse(events: Iterator[dict[str, Any]], case, on_manifest=None) -> EventSourceResponse:
    """Wrap engine events as Server-Sent Events. Each event: `event:` = type, `data:` = JSON.

    feat-033: `on_manifest(ev)` runs the post-advise note hook the moment the terminal manifest is
    seen — BEFORE it is yielded — so the note is persisted by the time the client's stream ends and
    a follow-up GET /team/{id}/notes reliably sees it. The manifest stays the terminal event (no
    extra frame is emitted); the Room nudge is driven by the client re-reading the notebook."""
    def gen():
        try:
            for ev in events:
                if on_manifest is not None and ev.get("type") == "manifest":
                    try:
                        on_manifest(ev)
                    except Exception:   # a note-write problem must never break the stream
                        pass
                yield {"event": ev.get("type", "message"),
                       "data": json.dumps(ev, ensure_ascii=False)}
        finally:
            live_input.discard(case)
    return EventSourceResponse(gen())


def _post_advise_note(company_context_id: str | None, situation: str, manifest: dict) -> None:
    """feat-033 post-advise hook: append Avery's observation to the company notebook (write-side red
    line inside). Best-effort — a failure here never affects the advise response."""
    if not company_context_id:
        return
    try:
        from avery.ingest.registry import active_registry
        from . import notes
        notes.write_note_from_manifest(active_registry(), company_context_id, manifest, situation)
    except Exception:   # lazy import / registry problems must not surface to the caller
        pass


@app.get("/health")
def health() -> dict:
    kind = brain_factory.resolve_brain_kind()
    return {"status": "ok", "service": "avery-agent", "brain": kind,
            "live": brain_factory.brain_is_live(),
            "embeddings": embedding_factory.active_embeddings(),  # "keyword" or "dashscope:<model>/<dim>"
            "extractor": extractor_factory.active_extractor()}    # "heuristic" or "llm:<brain>"


@app.post("/advise")
def advise(req: AdviseRequest):
    # feat-028: a GIVEN-but-unknown company_context_id must 404 (consistent with GET /team/{id}),
    # not silently answer over the demo company. A missing id is the legitimate demo default.
    if req.company_context_id and not _context_registered(req.company_context_id):
        raise HTTPException(status_code=404,
                            detail=f"unknown company_context_id: {req.company_context_id}")
    sit = live_input.LiveSituation(
        situation=req.situation, title=req.title,
        company_context_id=req.company_context_id)
    events, case = _run_events(sit)

    if req.stream:
        return _sse(events, case,
                    on_manifest=lambda m: _post_advise_note(req.company_context_id, req.situation, m))

    # Buffered: drain to the terminal manifest (or error) and return one JSON body.
    try:
        collected: list[dict] = list(events)
    finally:
        live_input.discard(case)
    manifest = next((e for e in reversed(collected) if e["type"] == "manifest"), None)
    # feat-033: write Avery's observation to the company notebook (write-side red line inside).
    if manifest is not None:
        _post_advise_note(req.company_context_id, req.situation, manifest)
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
