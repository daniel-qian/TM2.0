"""feat-018 — the ingestion HTTP surface (upload → Your team), mounted onto the feat-015 service.

feat-016 built the ingestion ENGINE (`avery/ingest/`) and the id↔context SEAM (`avery/ingest/seam.py`),
but the HTTP endpoints were deliberately deferred to the deploy line (feat-018): the frontend
transport (`src/live/transport.ts`) already calls `POST /ingest`, `GET /team/:id` against the
service origin. This module is that thin HTTP wrapper — COMPOSE, not modify: it calls the existing
`ingest.ingest_paths(...)` and `CompanyContext.*_cards()` and changes NOTHING in `avery/` or in the
feat-015 engine.

Endpoints (contract = `LiveTeamPayload` in transport.ts):

  POST /ingest        multipart `files=@...` (one or many) → parse → red-line-safe extract → RAG →
                      register a CompanyContext → return the first Your-team payload + context_id.
                      If the red-line gate HARD-FAILS the extraction, returns HTTP 422 and NO context
                      is registered (a person-scoring upload never becomes retrievable).
  GET  /team/{id}     re-fetch the Your-team payload for a registered context_id (refresh/poll).

Red line: `team_cards()` emits QUALITATIVE-ONLY person cards (no moodPct/capacityPct/score keys) —
the same structural guarantee the frontend `LivePersonCard` type encodes. The gate lives in the
engine (`avery/ingest/redline_extract.py`); this layer just surfaces its verdict as an HTTP status.

Persistence (feat-030, ADR-0023): `active_registry()` — Postgres-backed when AVERY_DB_URL /
PGVECTOR_URL is set (company data survives restarts/redeploys), else the process-local in-memory
registry (offline default, the pre-030 ADR-0021 §6 ephemeral behavior). Same get/put seam either way.
"""
from __future__ import annotations

import tempfile
from pathlib import Path

from fastapi import APIRouter, HTTPException, UploadFile
from fastapi import File
from starlette.concurrency import run_in_threadpool

from avery.ingest import ingest_paths
from avery.ingest.registry import CompanyContext, active_registry

from . import embedding_factory, extractor_factory

router = APIRouter()


def _team_payload(ctx: CompanyContext) -> dict:
    """Project a CompanyContext onto the exact LiveTeamPayload shape transport.ts expects."""
    return {
        "context_id": ctx.context_id,
        "source_files": ctx.source_files,
        "people": ctx.team_cards(),      # QUALITATIVE ONLY — no blood-bar / score keys
        "projects": ctx.project_cards(),
        "briefing": ctx.briefing(),
        "signals": ctx.signal_cards(),
    }


@router.post("/ingest")
async def ingest(files: list[UploadFile] = File(...)) -> dict:
    """Upload company files → CompanyContext + first Your-team payload.

    The uploaded bytes are written to a temp dir, parsed + extracted + RAG-loaded by the existing
    pipeline, then the temp inputs are discarded (sampler = ephemeral). Real LLM keys are NEVER
    needed for the offline heuristic extractor; a pluggable LLM extractor/embedder drops in via env
    (see service/.env.example) without changing this endpoint.
    """
    if not files:
        raise HTTPException(status_code=400, detail="no files uploaded")

    tmp = Path(tempfile.mkdtemp(prefix="avery-upload-"))
    saved: list[Path] = []
    try:
        for f in files:
            # Guard against path traversal in the client-provided filename.
            safe = Path(f.filename or "upload").name or "upload"
            dest = tmp / safe
            dest.write_bytes(await f.read())
            saved.append(dest)

        # feat-023: pluggable extraction (LLM when keyed, heuristic otherwise/forced) — the
        # red-line gate inside ingest_paths is unchanged and still refuses a scoring extraction.
        # feat-028: the whole synchronous ingest is minutes-long — BOTH building the LLM extractor
        # brain (make_extractor constructs an OpenAI client, ~seconds) AND the parse+extraction fan-
        # out (ingest_paths). Running either inline would block the single-worker event loop —
        # freezing /health and letting the Docker HEALTHCHECK restart the container mid-extraction.
        # Offload the entire synchronous unit to a worker thread; behavior is otherwise identical.
        # feat-031: open the real vector path only when an embedder is configured (DashScope when
        # keyed) AND a PERSISTENT registry will actually store the vectors and hand them to a
        # pgvector store at recall time. Under the in-memory registry that VectorStore is never read
        # by advise (it recalls via avery.memory.recall over facts.md, not CompanyContext.store), so
        # embedding the corpus there is pure DashScope spend with no reader — stay honest keyword
        # (feat-031 cost gate; feat-035 will add the per-tenant spend ceiling).
        def _extract_and_ingest() -> object:
            registry = active_registry()
            embedder = embedding_factory.make_embedder()
            prefer_vector = embedder is not None and getattr(registry, "persistent", False)
            return ingest_paths([str(p) for p in saved], registry=registry, name="company",
                                extractor=extractor_factory.make_extractor(),
                                embedder=embedder if prefer_vector else None,
                                prefer_vector=prefer_vector)

        try:
            report = await run_in_threadpool(_extract_and_ingest)
        except ValueError as e:
            # feat-030 P3: a persistence guard (e.g. a NUL/control char that slipped past parse)
            # rejects the write with a clean ValueError — surface it as 422, never a raw 500.
            raise HTTPException(
                status_code=422,
                detail={"error": "upload rejected", "reason": str(e)},
            )

        if not report.ok or report.context is None:
            # Red-line gate (or an all-unparseable batch) refused to publish a context.
            raise HTTPException(
                status_code=422,
                detail={
                    "error": "extraction refused",
                    "reason": ("red line: a person-scoring/ranking field was extracted"
                               if report.violations else "no parseable content in the upload"),
                    "violations": [{"kind": v.kind, "person": v.person, "detail": v.detail,
                                    "rule_id": v.rule_id} for v in report.violations],
                    "parse_errors": report.parse_errors,
                },
            )
        return _team_payload(report.context)
    finally:
        # Ephemeral: never persist the raw upload.
        for p in saved:
            p.unlink(missing_ok=True)
        try:
            tmp.rmdir()
        except OSError:
            pass


@router.get("/team/{context_id}")
def team(context_id: str) -> dict:
    """Re-fetch the Your-team payload for a registered context_id (post-upload refresh)."""
    ctx = active_registry().get(context_id)
    if ctx is None:
        raise HTTPException(status_code=404, detail=f"unknown company_context_id: {context_id}")
    return _team_payload(ctx)
