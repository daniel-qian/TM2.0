"""Ingestion engine (feat-016) — upload → parse → red-line-safe extraction → RAG → Your team.

The heavier leg of the core (ADR-0021 §2). Replaces one-by-one data integration for the lite
product with a single upload flow: the manager hands over the files they'd give a new manager on
day one (resumes, project weeklies, company handbooks, rosters), and this package turns them into
the SAME "company facts" leg the advisor already retrieves.

What it produces (the seam feat-015 honors): a `CompanyContext` addressed by a `company_context_id`.
`service/live_input.py` already threads that id as a stub; ingestion is what makes the stub real —
the RAG + entities behind the id become retrievable by the advisor's `recall`.

Layout (all NEW; nothing in the existing engine is rewritten — this composes on top):
  * parse.py           multi-format parsing (PDF/docx/xlsx/csv/md/txt) via mature libs, degrades
  * extract.py         red-line-safe structured extraction -> Person/Project/Signal/Material
  * redline_extract.py extends avery/redline.py to gate EXTRACTION OUTPUT (person = qualitative only)
  * store.py           pluggable retrieval: KeywordStore (offline/deterministic) + VectorStore (pgvector)
  * registry.py        company_context_id -> CompanyContext resolution (the feat-015 seam)
  * pipeline.py        orchestrates the stages into a CompanyContext + Your-team structures

RED LINE (the moat, non-negotiable — ADR-0021 §4 / ADR-0015 / ADR-0018):
  a resume -> person card STOPS at qualitative (role, what they own, tenure, collaboration).
  A person entity NEVER carries a score / rank / rating / tier / moodPct / capacityPct derived
  from any uploaded doc. `redline_extract.py` is the AFK gate that HARD-FAILS any such field.
"""
from __future__ import annotations

from .parse import ParsedDoc, parse_file, parse_bytes
from .extract import (
    PersonEntity,
    PersonSelfReport,
    SelfReportLoad,
    SelfReportMood,
    norm_mood_selfreport,
    ProjectEntity,
    SignalEntity,
    MaterialChunk,
    ExtractionResult,
    HeuristicExtractor,
    Extractor,
    extract_docs,
)
from .llm_extract import LLMExtractor, FallbackExtractor
from .redline_extract import validate_extraction, ExtractionRedlineResult, ExtractionViolation
from .store import (
    KeywordStore, VectorStore, PgVectorStore, RetrievalStore, RetrievalHit, Embedder,
    HashingEmbedder, build_store,
)
from .registry import CompanyContext, ContextRegistry, SourceDocument, REGISTRY
from .pipeline import ingest_paths, ingest_docs, IngestReport

__all__ = [
    "ParsedDoc", "parse_file", "parse_bytes",
    "PersonEntity", "PersonSelfReport", "SelfReportLoad", "SelfReportMood", "norm_mood_selfreport",
    "ProjectEntity", "SignalEntity", "MaterialChunk",
    "ExtractionResult", "HeuristicExtractor", "Extractor", "extract_docs",
    "LLMExtractor", "FallbackExtractor",
    "validate_extraction", "ExtractionRedlineResult", "ExtractionViolation",
    "KeywordStore", "VectorStore", "PgVectorStore", "RetrievalStore", "RetrievalHit", "Embedder",
    "HashingEmbedder", "build_store",
    "CompanyContext", "ContextRegistry", "SourceDocument", "REGISTRY",
    "ingest_paths", "ingest_docs", "IngestReport",
]
