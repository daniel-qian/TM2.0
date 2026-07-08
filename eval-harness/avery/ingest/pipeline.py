"""The pipeline — orchestrates upload → parse → extract → RED-LINE GATE → RAG → CompanyContext.

This is the top-level entry the service (and the AFK battery) calls. It runs the stages in order
and, critically, REFUSES to publish a CompanyContext whose extraction fails the red line:

    upload/paths ──▶ parse (parse.py) ──▶ extract (extract.py)
                                              │
                                              ▼
                                   validate_extraction (redline_extract.py)  ── HARD GATE
                                              │  ok
                                              ▼
                          materialize facts.md/notes.md + build RAG store
                                              │
                                              ▼
                                 CompanyContext registered under a company_context_id
                                 (resolvable by the advisor — the feat-015 seam)

If the red-line gate fails, `IngestReport.ok` is False, `context` is None, and the violations are
returned — the offending upload never becomes a retrievable context. That is the AFK gate: an
extractor (heuristic or LLM) that scored a person cannot poison the advisor's memory.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

from .parse import ParsedDoc, parse_file, ParseError
from .extract import ExtractionResult, extract_docs, Extractor
from .redline_extract import validate_extraction, ExtractionRedlineResult, ExtractionViolation
from .store import RetrievalStore, Embedder, build_store
from .registry import (
    CompanyContext, ContextRegistry, REGISTRY, new_context_id, materialize_memory,
)


@dataclass
class IngestReport:
    ok: bool
    context: CompanyContext | None
    redline: ExtractionRedlineResult
    parsed: list[ParsedDoc] = field(default_factory=list)
    extraction: ExtractionResult | None = None
    parse_errors: list[str] = field(default_factory=list)
    context_id: str = ""

    @property
    def violations(self) -> list[ExtractionViolation]:
        return self.redline.violations


def ingest_docs(docs: list[ParsedDoc], *, extractor: Extractor | None = None,
                embedder: Embedder | None = None, prefer_vector: bool = False,
                registry: ContextRegistry | None = None, work_dir: Path | None = None,
                name: str = "company", context_id: str | None = None) -> IngestReport:
    """Ingest already-parsed docs. Runs extract -> red-line gate -> store -> CompanyContext.

    prefer_vector=False (default) uses the offline KeywordStore so the AFK gate needs no embedding
    service. prefer_vector=True with an `embedder` uses the real VectorStore (pgvector in prod).
    """
    registry = registry if registry is not None else REGISTRY

    extraction = extract_docs(docs, extractor=extractor)

    # THE HARD GATE — a person-scoring extraction never becomes a context.
    rl = validate_extraction(extraction)
    if not rl.ok:
        return IngestReport(ok=False, context=None, redline=rl, parsed=docs, extraction=extraction)

    # Build the RAG store and load material.
    store: RetrievalStore = build_store(embedder, prefer_vector=prefer_vector)
    store.add(extraction.materials)

    # Materialize facts.md/notes.md so the EXISTING loop recall + cite gate work over ingested data.
    cid = context_id or new_context_id()
    base = Path(work_dir) if work_dir else Path(__import__("tempfile").gettempdir()) / "avery-contexts"
    mem_dir = materialize_memory(extraction, base / cid)

    ctx = CompanyContext(
        context_id=cid, extraction=extraction, store=store, memory_dir=mem_dir, name=name,
        source_files=[d.name for d in docs])
    registry.put(ctx)

    return IngestReport(ok=True, context=ctx, redline=rl, parsed=docs, extraction=extraction,
                        context_id=cid)


def ingest_paths(paths: list[str | Path], *, extractor: Extractor | None = None,
                 embedder: Embedder | None = None, prefer_vector: bool = False,
                 registry: ContextRegistry | None = None, work_dir: Path | None = None,
                 name: str = "company", context_id: str | None = None) -> IngestReport:
    """Ingest files from disk: parse each (skipping unparseable ones), then `ingest_docs`."""
    docs: list[ParsedDoc] = []
    errors: list[str] = []
    for p in paths:
        try:
            docs.append(parse_file(p))
        except ParseError as e:
            errors.append(str(e))
    report = ingest_docs(docs, extractor=extractor, embedder=embedder, prefer_vector=prefer_vector,
                         registry=registry, work_dir=work_dir, name=name, context_id=context_id)
    report.parse_errors = errors
    return report
