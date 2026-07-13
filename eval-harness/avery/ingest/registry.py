"""The `company_context_id` <-> CompanyContext seam (feat-015 honor point).

`service/live_input.py::LiveSituation.company_context_id` is a stub: it threads an id through the
case file but nothing resolves it. THIS makes it real. Ingestion produces a `CompanyContext` and
registers it under an id; the advisor path resolves that id back to:

  * a `memory_dir` (materialized `facts.md` + `notes.md`) so the loop's EXISTING `avery.memory.recall`
    retrieves real company facts — the loop runs UNCHANGED (same seam `live_input` already uses), and
  * a `RetrievalStore` (keyword offline / vector real) for direct RAG queries, and
  * the extracted Your-team structures (people / project cards / briefing) for the frontend.

Why materialize facts.md rather than change recall(): the loop's memory + cite gate are already the
audited path (facts.md:<line> is what a cite() resolves to). Writing the extracted, red-line-clean,
line-addressable person/project/material facts INTO that file means every downstream gate (cite,
red line, 8-field projection) applies to ingested data with zero engine change. It is the honest
minimum: the advisor cites real lines that came from the manager's own uploads.
"""
from __future__ import annotations

import os
import tempfile
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

from .extract import ExtractionResult
from .store import RetrievalStore, RetrievalHit, KeywordStore


@dataclass
class SourceDocument:
    """feat-032 — a persisted RAW upload: the original bytes + metadata, kept in the per-company
    file space so a manager can look back at what Avery's memory is built on (User Story 4).

    The bytes are UNTRUSTED content: stored and served for download, NEVER interpreted as
    instructions (readiness §2-I injection surface — this layer only stores/lists, it does not
    follow anything inside a file). `content` is held in memory by the in-memory registry and left
    None by the Postgres registry's metadata read (get()); the bytea is pulled on demand by the
    download seam (`source_document_bytes`). `storage_ref` is the feat-035 object-store seam
    (PRD: 'may include an object-store reference') — v1 keeps bytes inline in avery.source_documents.
    """
    filename: str
    mime: str = "application/octet-stream"
    size_bytes: int = 0
    doc_kind: str = "company"
    uploaded_at: str = ""                  # ISO8601 UTC; set at ingest, or read back from the DB
    content: bytes | None = None           # raw upload bytes (in-memory) / None (pg metadata read)
    storage_ref: str = ""                  # feat-035 seam: object-store pointer; inline bytea in v1


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass
class CompanyContext:
    """The resolved company context an advisor retrieves against, keyed by `context_id`."""
    context_id: str
    extraction: ExtractionResult
    store: RetrievalStore
    memory_dir: Path                       # holds materialized facts.md / notes.md
    name: str = "company"
    source_files: list[str] = field(default_factory=list)
    source_documents: list[SourceDocument] = field(default_factory=list)  # feat-032 file space

    # --- retrieval surface (what the advisor uses) --------------------------------------------

    def recall(self, query: str, limit: int = 8) -> list[RetrievalHit]:
        """RAG query over ingested material (keyword offline / vector real)."""
        return self.store.query(query, limit=limit)

    # --- Your-team structures (what the frontend renders) -------------------------------------

    def team_cards(self) -> list[dict]:
        """People cards for 'Your team' — QUALITATIVE ONLY. Note: NO moodPct / capacityPct keys are
        ever emitted (red line: live person cards have no blood bar). feat-017 renders these."""
        cards = []
        for p in self.extraction.people:
            card = {"id": p.id, "name": p.name, "role": p.role}
            if p.team:
                card["team"] = p.team
            if p.tenure:
                card["tenure"] = p.tenure
            if p.owns:
                card["owns"] = p.owns
            if p.collaboration:
                card["collaboration"] = p.collaboration
            # DELIBERATELY absent: moodPct, capacityPct, any score/rank/tier.
            cards.append(card)
        return cards

    def project_cards(self) -> list[dict]:
        """Project cards for 'Your team'. Work may be quantified (progress) when the doc stated it;
        risk 4-dims / reportedStatus are left absent (lite lacks the signal — R2 don't invent)."""
        cards = []
        for pr in self.extraction.projects:
            card = {"id": pr.id, "title": pr.title}
            if pr.ownerId:
                card["ownerId"] = pr.ownerId
            if pr.ownerName:
                card["ownerName"] = pr.ownerName
            if pr.status:
                card["status"] = pr.status
            if pr.progress is not None:
                card["progress"] = pr.progress
            if pr.dueDate:
                card["dueDate"] = pr.dueDate
            if pr.summary:
                card["summary"] = pr.summary
            if pr.blockers:
                card["blockers"] = pr.blockers
            cards.append(card)
        return cards

    def signal_cards(self) -> list[dict]:
        """Doc-derived signals. Person-directed ones stay at situation (gated upstream)."""
        return [{"id": s.id, "source": s.source_kind, "subjectType": s.subjectType,
                 "subjectId": s.subjectRef, "summary": s.summary, "tag": s.tag}
                for s in self.extraction.signals]

    def briefing(self) -> dict:
        """A calm, HONEST 'organization weather' briefing. Counts are real (people/projects); it
        emits NO invented aggregate health score (R2: real-or-nothing)."""
        n_people = len(self.extraction.people)
        n_proj = len(self.extraction.projects)
        at_risk = [p for p in self.extraction.projects if p.status in ("at-risk", "blocked")]
        metrics = [{"label": "people", "value": str(n_people)},
                   {"label": "active projects", "value": str(n_proj)}]
        if at_risk:
            metrics.append({"label": "need a look", "value": str(len(at_risk))})
        headline = f"Ingested {len(self.source_files)} file(s): {n_people} people, {n_proj} projects."
        subhead = ("Everything below is drawn from your uploads — nothing invented. "
                   + (f"{len(at_risk)} project(s) worth a closer look." if at_risk
                      else "No risk signals surfaced from the documents."))
        return {"tone": "alert" if at_risk else "calm", "headline": headline, "subhead": subhead,
                "metrics": metrics}

    # --- feat-032 file space (per-company uploaded-file manifest) ------------------------------

    def _chunks_per_file(self) -> dict[str, int]:
        """How many material chunks each uploaded file contributed, linked via a chunk's
        `<filename>:<line>` source prefix (the same cite seam the advisor uses)."""
        counts: dict[str, int] = {}
        for m in self.extraction.materials:
            src = m.source or ""
            fname = src.rsplit(":", 1)[0] if ":" in src else src
            if fname:
                counts[fname] = counts.get(fname, 0) + 1
        return counts

    def file_cards(self) -> list[dict]:
        """The per-file manifest the 'your files' view renders — METADATA ONLY (no bytes): filename,
        size, mime, doc_kind, uploaded_at, and n_chunks (material chunks the file produced). Content
        is untrusted data; the manifest lists it, the download seam serves the bytes separately."""
        counts = self._chunks_per_file()
        return [{"idx": i, "filename": sd.filename, "size_bytes": sd.size_bytes, "mime": sd.mime,
                 "doc_kind": sd.doc_kind, "uploaded_at": sd.uploaded_at,
                 "n_chunks": counts.get(sd.filename, 0)}
                for i, sd in enumerate(self.source_documents)]


class ContextRegistry:
    """In-memory id -> CompanyContext map. Process-local — the OFFLINE default (no external service,
    what the AFK suite runs). feat-030 delivered the promised DB-backed twin behind the same get/put
    API (`pg_registry.PostgresContextRegistry`); `active_registry()` picks between them by env."""

    # feat-031 cost gate: this registry does NOT persist a store's vectors and advise never reads its
    # in-memory CompanyContext.store, so embedding a corpus for it is pure spend with no reader. The
    # /ingest handler consults this flag to open the vector path ONLY behind a persistent registry.
    persistent = False

    def __init__(self) -> None:
        self._by_id: dict[str, CompanyContext] = {}

    def put(self, ctx: CompanyContext) -> str:
        self._by_id[ctx.context_id] = ctx
        return ctx.context_id

    def get(self, context_id: str) -> CompanyContext | None:
        return self._by_id.get(context_id)

    def resolve_memory_dir(self, context_id: str) -> Path | None:
        """The seam live_input wants: an id -> a memory_dir the loop's recall() reads."""
        ctx = self.get(context_id)
        return ctx.memory_dir if ctx else None

    def source_document_bytes(self, context_id: str, idx: int) -> bytes | None:
        """feat-032 download seam: the raw bytes of the idx-th uploaded file, or None (unknown
        context / out-of-range idx / no content). In-memory holds the bytes; the pg twin reads
        bytea. Same duck-typed API so the /team/{id}/files/{idx} handler is registry-agnostic."""
        ctx = self.get(context_id)
        if ctx is None or idx < 0 or idx >= len(ctx.source_documents):
            return None
        return ctx.source_documents[idx].content

    def __contains__(self, context_id: str) -> bool:
        return context_id in self._by_id

    def clear(self) -> None:
        self._by_id.clear()


# Process-wide default registry (the offline in-memory instance).
REGISTRY = ContextRegistry()


# --- feat-030: env-selected persistence -------------------------------------------------------

def db_url() -> str | None:
    """The persistence connection string: `AVERY_DB_URL`, with `PGVECTOR_URL` accepted as the alias
    that service/.env.example already names. Unset -> the in-memory registry (offline default)."""
    return (os.environ.get("AVERY_DB_URL") or os.environ.get("PGVECTOR_URL") or "").strip() or None


def data_root() -> Path:
    """Where materialized memory (facts.md/notes.md) lives: `AVERY_DATA_DIR` when set (a STABLE
    data dir — survives reboots; pair it with the DB registry so a restart re-materializes into
    it), else the pre-030 OS-temp default (fine for the ephemeral in-memory registry)."""
    env = (os.environ.get("AVERY_DATA_DIR") or "").strip()
    if env:
        return Path(env)
    return Path(tempfile.gettempdir()) / "avery-contexts"


_PG_REGISTRIES: dict[str, object] = {}   # url -> PostgresContextRegistry (per-process cache)


def active_registry() -> ContextRegistry:
    """THE registry the service should use right now. `AVERY_DB_URL`/`PGVECTOR_URL` set -> the
    Postgres-backed registry (company data survives restarts/redeploys); unset -> the in-memory
    REGISTRY (offline default, no external service, suite stays green with no DB).

    The DB module is imported lazily so the offline path NEVER needs psycopg installed."""
    url = db_url()
    if not url:
        return REGISTRY
    reg = _PG_REGISTRIES.get(url)
    if reg is None:
        from .pg_registry import PostgresContextRegistry  # lazy: offline suite never imports this
        from avery.embeddings import make_embedder_from_env  # feat-031: same gate the service uses
        # feat-031: a configured embedder turns the DB registry into real pgvector RAG (put() fills
        # embeddings, get() rebuilds a pgvector store). None (keyword / no key) -> KeywordStore.
        reg = _PG_REGISTRIES[url] = PostgresContextRegistry(url, embedder=make_embedder_from_env())
    return reg  # type: ignore[return-value]  # duck-typed: same get/put/resolve/__contains__ API


def new_context_id() -> str:
    return "ctx_" + uuid.uuid4().hex[:12]


def materialize_memory(extraction: ExtractionResult, dest: Path) -> Path:
    """Write extracted, red-line-clean entities to facts.md / notes.md so the EXISTING loop recall +
    cite gate work over ingested data with no engine change. Each fact is one line (facts.md:<line>).
    """
    dest = Path(dest)
    dest.mkdir(parents=True, exist_ok=True)

    facts: list[str] = ["# Company facts (ingested from uploads — qualitative, red-line-clean)", ""]
    if extraction.people:
        facts.append("## People (qualitative only — no scores, no blood bars)")
        for p in extraction.people:
            facts += p.as_facts_lines()
        facts.append("")
    if extraction.projects:
        facts.append("## Projects")
        for pr in extraction.projects:
            facts += pr.as_facts_lines()
        facts.append("")
    if extraction.materials:
        facts.append("## Company material")
        seen: set[str] = set()
        for m in extraction.materials:
            if m.text in seen:
                continue
            seen.add(m.text)
            facts.append(m.text)
        facts.append("")
    (dest / "facts.md").write_text("\n".join(facts), encoding="utf-8")

    notes: list[str] = ["# Notes (doc-derived signals — situational, never a person label)", ""]
    for s in extraction.signals:
        notes += s.as_facts_lines()
    (dest / "notes.md").write_text("\n".join(notes) + "\n", encoding="utf-8")
    return dest
