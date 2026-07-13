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

from avery.scoring_policy import person_scoring_allowed

from .parse import ParsedDoc, parse_file, ParseError
from .extract import ExtractionResult, extract_docs, Extractor
from .redline_extract import validate_extraction, ExtractionRedlineResult, ExtractionViolation
from .store import RetrievalStore, Embedder, build_store
from .registry import (
    CompanyContext, ContextRegistry, SourceDocument, active_registry, data_root, new_context_id,
    materialize_memory, _now_iso,
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


def _finalize_source_documents(source_documents: list[SourceDocument] | None,
                               docs: list[ParsedDoc],
                               extraction: ExtractionResult | None = None) -> list[SourceDocument]:
    """feat-032: enrich the raw uploads the caller handed in (the /ingest handler builds them from
    `await f.read()`) with the doc_kind the parser sniffed, a size / upload timestamp, and a
    parse-status — so the file manifest carries accurate metadata without re-reading any bytes.

    The join key is `source_key` (the disambiguated per-document name the /ingest handler sets, ==
    the ParsedDoc.name) with a fallback to `filename` for a caller that supplies no source_key
    (pre-032 direct callers / the registry contract fixtures). feat-032 P2: a file whose key did not
    produce a ParsedDoc is 'failed' (unparseable); one that parsed but yielded no material is
    'empty'; otherwise 'ingested'."""
    src_docs = list(source_documents or [])
    kind_by_key = {d.name: d.doc_kind for d in docs}
    parsed_keys = set(kind_by_key)
    # material chunks per document key (same '<key>:<line>' prefix the manifest counts on).
    chunk_counts: dict[str, int] = {}
    for m in (extraction.materials if extraction else []):
        src = m.source or ""
        key = src.rsplit(":", 1)[0] if ":" in src else src
        if key:
            chunk_counts[key] = chunk_counts.get(key, 0) + 1
    for sd in src_docs:
        key = sd.source_key or sd.filename
        if sd.doc_kind in ("", "company") and key in kind_by_key:
            sd.doc_kind = kind_by_key[key]
        if key not in parsed_keys:
            sd.status = "failed"
        elif chunk_counts.get(key, 0) == 0:
            sd.status = "empty"
        else:
            sd.status = "ingested"
        if not sd.size_bytes and sd.content is not None:
            sd.size_bytes = len(sd.content)
        if not sd.uploaded_at:
            sd.uploaded_at = _now_iso()
    return src_docs


def ingest_docs(docs: list[ParsedDoc], *, extractor: Extractor | None = None,
                embedder: Embedder | None = None, prefer_vector: bool = False,
                registry: ContextRegistry | None = None, work_dir: Path | None = None,
                name: str = "company", context_id: str | None = None,
                source_documents: list[SourceDocument] | None = None) -> IngestReport:
    """Ingest already-parsed docs. Runs extract -> red-line gate -> store -> CompanyContext.

    prefer_vector=False (default) uses the offline KeywordStore so the AFK gate needs no embedding
    service. prefer_vector=True with an `embedder` uses the real VectorStore (pgvector in prod).

    registry=None -> `active_registry()` (feat-030): the Postgres registry when AVERY_DB_URL is
    set (company data survives restarts), else the in-memory default (offline, no DB needed).

    source_documents (feat-032): the raw uploads (bytes + metadata) to persist in the per-company
    file space; None keeps the pre-032 behavior (no file space, empty manifest).
    """
    registry = registry if registry is not None else active_registry()

    extraction = extract_docs(docs, extractor=extractor)

    # THE HARD GATE — a person-scoring extraction never becomes a context.
    #
    # feat-033 (policy pivot, 2026-07-13): when person scoring is EXPLICITLY unblocked
    # (AVERY_ALLOW_PERSON_SCORING, see avery.scoring_policy) the person-scoring extraction is allowed
    # to persist — we do NOT flip ok=False, so the scored document builds a context normally. Default
    # OFF keeps the hard gate exactly as shipped. `validate_extraction` ONLY ever reports person-
    # scoring violations (key/value/text on a PersonEntity), so honoring the switch here unblocks
    # person scoring and NOTHING else. Non-scoring hard failures live on other branches (a parse
    # failure -> the `paths and not docs` 422 above) and are untouched. `rl` is still carried in the
    # returned report either way, so the violations stay auditable.
    rl = validate_extraction(extraction)
    if not rl.ok and not person_scoring_allowed():
        return IngestReport(ok=False, context=None, redline=rl, parsed=docs, extraction=extraction)

    # Build the RAG store and load material.
    store: RetrievalStore = build_store(embedder, prefer_vector=prefer_vector)
    store.add(extraction.materials)

    # Materialize facts.md/notes.md so the EXISTING loop recall + cite gate work over ingested data.
    # feat-030: the default base is a STABLE data dir (AVERY_DATA_DIR) when configured — the OS temp
    # fallback (pre-030 behavior) remains for the ephemeral offline default.
    cid = context_id or new_context_id()
    base = Path(work_dir) if work_dir else data_root()
    mem_dir = materialize_memory(extraction, base / cid)

    ctx = CompanyContext(
        context_id=cid, extraction=extraction, store=store, memory_dir=mem_dir, name=name,
        source_files=[d.name for d in docs],
        source_documents=_finalize_source_documents(source_documents, docs, extraction))
    registry.put(ctx)

    return IngestReport(ok=True, context=ctx, redline=rl, parsed=docs, extraction=extraction,
                        context_id=cid)


def ingest_paths(paths: list[str | Path], *, extractor: Extractor | None = None,
                 embedder: Embedder | None = None, prefer_vector: bool = False,
                 registry: ContextRegistry | None = None, work_dir: Path | None = None,
                 name: str = "company", context_id: str | None = None,
                 source_documents: list[SourceDocument] | None = None) -> IngestReport:
    """Ingest files from disk: parse each (skipping unparseable ones), then `ingest_docs`."""
    docs: list[ParsedDoc] = []
    errors: list[str] = []
    for p in paths:
        try:
            docs.append(parse_file(p))
        except ParseError as e:
            errors.append(str(e))
    # feat-032 P2: files were uploaded but NONE parsed -> refuse to publish an (empty) context. The
    # pre-fix code fell through and registered a context with 0 people/projects/materials AND kept
    # the unparseable bytes, so /ingest answered 200 for a batch it could not read at all. Now the ok
    # =False report reaches the handler's 422 branch ("no parseable content"); the bytes are dropped.
    if paths and not docs:
        empty_rl = validate_extraction(ExtractionResult())   # ok=True, no violations (empty input)
        return IngestReport(ok=False, context=None, redline=empty_rl, parsed=[], parse_errors=errors)
    report = ingest_docs(docs, extractor=extractor, embedder=embedder, prefer_vector=prefer_vector,
                         registry=registry, work_dir=work_dir, name=name, context_id=context_id,
                         source_documents=source_documents)
    report.parse_errors = errors
    return report
