"""feat-030 — the Postgres-backed ContextRegistry (the DB twin feat-018's registry promised).

Same duck-typed API as the in-memory `ContextRegistry` (`put/get/resolve_memory_dir/__contains__/
clear`), so it plugs in behind the existing seam with ZERO change to the pipeline, the loop, or the
HTTP handlers — `active_registry()` (registry.py) picks it whenever `AVERY_DB_URL`/`PGVECTOR_URL`
is set. Everything a company workspace is made of goes to Postgres (schema `avery`, see
db/migrations/0001_avery_persistence.sql):

    contexts       id / name / source_files (+ owner_token reserved for feat-034)
    entities       people / projects / signals as ordered JSONB rows
    materials      RAG chunks as rows (+ embedding vector(N) reserved NULL for feat-031)
    memory_files   facts.md / notes.md FULL TEXT — the re-materialization source

`get()` rebuilds a full CompanyContext from those rows: entities -> ExtractionResult, materials ->
a fresh KeywordStore (offline retrieval; feat-031 swaps in real pgvector behind the same
RetrievalStore interface), and — the restart story — if the local memory_dir files are missing
(new machine / redeploy wiped the disk) they are RE-MATERIALIZED byte-identically from the DB, so
the loop's recall/cite run unchanged over a company ingested before the restart.

RED LINE AT THE STORAGE DOOR (structural, both layers):
  * Python: every person payload passes `redline_extract.validate_person_dict` (full EN+ZH scoring-
    key lexicon) BEFORE any INSERT — a violating payload raises and NOTHING is written.
  * SQL: `entities_person_no_scoring_keys` CHECK — the DB itself refuses a person row carrying a
    scoring key, so even a future writer that skips this module cannot open the hole.

Connections are short-lived (one per operation, context-managed) — no pooling, no shared state, so
the registry is trivially safe under FastAPI's threadpool offloading and 'a new instance sees the
same data' is true by construction. psycopg (3) is imported lazily; the offline suite never needs it.
"""
from __future__ import annotations

import dataclasses
from dataclasses import asdict
from pathlib import Path

from .extract import (
    ExtractionResult, MaterialChunk, PersonEntity, ProjectEntity, SignalEntity,
)
from .redline_extract import validate_person_dict
from .registry import CompanyContext, data_root, materialize_memory
from .store import KeywordStore

_MIGRATION = Path(__file__).resolve().parent.parent.parent / "db" / "migrations" / "0001_avery_persistence.sql"

_PERSON_FIELDS = {f.name for f in dataclasses.fields(PersonEntity)}
_PROJECT_FIELDS = {f.name for f in dataclasses.fields(ProjectEntity)}
_SIGNAL_FIELDS = {f.name for f in dataclasses.fields(SignalEntity)}


def _entity(cls, fields: set[str], payload: dict):
    """Rebuild a dataclass entity from a stored JSONB payload, ignoring unknown keys so an OLD
    reader survives a NEWER writer's extra columns (forward compatibility)."""
    return cls(**{k: v for k, v in payload.items() if k in fields})


class PostgresContextRegistry:
    """id -> CompanyContext, persisted in Postgres. Company data survives restarts/redeploys."""

    def __init__(self, url: str, *, data_dir: str | Path | None = None) -> None:
        import psycopg  # lazy: only the DB-configured path ever imports the driver

        self._psycopg = psycopg
        self._url = url
        self._data_dir = Path(data_dir) if data_dir else None
        self._schema_ready = False

    # --- plumbing ------------------------------------------------------------------------------

    def _connect(self):
        return self._psycopg.connect(self._url)

    def _root(self) -> Path:
        """Local materialization root: explicit data_dir beats AVERY_DATA_DIR beats OS temp."""
        return self._data_dir if self._data_dir is not None else data_root()

    def _ensure_schema(self) -> None:
        """Idempotent bootstrap (CREATE ... IF NOT EXISTS) from the SAME migration file that is
        applied to Supabase — local/prod schema equivalence by construction. A permission error is
        tolerated (a locked-down prod role means the schema was provisioned out-of-band); a real
        problem then surfaces loudly on the first actual read/write."""
        if self._schema_ready:
            return
        sql = _MIGRATION.read_text(encoding="utf-8")
        try:
            with self._connect() as conn:
                conn.execute(sql)
        except self._psycopg.errors.InsufficientPrivilege:
            pass
        self._schema_ready = True

    # --- red line at the storage door ------------------------------------------------------------

    @staticmethod
    def _gate_person_payloads(payloads: list[dict]) -> None:
        """No person JSON with a scoring key (EN+ZH lexicon) ever reaches an INSERT. PersonEntity
        structurally cannot hold one (the moat as a type) — this guards the SERIALIZED dict, so a
        future refactor that bypasses the dataclass still cannot open the hole."""
        for p in payloads:
            violations = validate_person_dict(str(p.get("name", "")), p)
            if violations:
                details = "; ".join(v.detail for v in violations)
                raise ValueError(
                    f"red line: refusing to persist a scoring person payload ({details})")

    # --- the ContextRegistry API -----------------------------------------------------------------

    def put(self, ctx: CompanyContext) -> str:
        from psycopg.types.json import Jsonb

        self._ensure_schema()

        people = [asdict(p) for p in ctx.extraction.people]
        self._gate_person_payloads(people)
        projects = [asdict(p) for p in ctx.extraction.projects]
        signals = [asdict(s) for s in ctx.extraction.signals]

        # The materialized memory FULL TEXT is what a restart re-materializes from. If the caller
        # somehow hands a context whose files are not on disk yet, materialize first — the DB row
        # must never be emptier than the loop's recall surface.
        mem = Path(ctx.memory_dir)
        if not (mem / "facts.md").exists():
            materialize_memory(ctx.extraction, mem)
        facts = (mem / "facts.md").read_text(encoding="utf-8")
        notes = (mem / "notes.md").read_text(encoding="utf-8") if (mem / "notes.md").exists() else ""

        with self._connect() as conn, conn.transaction():
            conn.execute(
                "INSERT INTO avery.contexts (context_id, name, source_files) "
                "VALUES (%s, %s, %s) "
                "ON CONFLICT (context_id) DO UPDATE SET "
                "  name = EXCLUDED.name, source_files = EXCLUDED.source_files, "
                "  updated_at = now()",
                (ctx.context_id, ctx.name, Jsonb(list(ctx.source_files))))
            # re-put = replace: a context is one atomic snapshot, never a merge of two ingests.
            conn.execute("DELETE FROM avery.entities WHERE context_id = %s", (ctx.context_id,))
            conn.execute("DELETE FROM avery.materials WHERE context_id = %s", (ctx.context_id,))
            conn.execute("DELETE FROM avery.memory_files WHERE context_id = %s", (ctx.context_id,))

            with conn.cursor() as cur:
                cur.executemany(
                    "INSERT INTO avery.entities (context_id, kind, idx, payload) "
                    "VALUES (%s, %s, %s, %s)",
                    [(ctx.context_id, kind, i, Jsonb(payload))
                     for kind, rows in (("person", people), ("project", projects),
                                        ("signal", signals))
                     for i, payload in enumerate(rows)])
                cur.executemany(
                    "INSERT INTO avery.materials (context_id, idx, chunk_id, text, source, doc_kind) "
                    "VALUES (%s, %s, %s, %s, %s, %s)",   # embedding stays NULL (feat-031 fills it)
                    [(ctx.context_id, i, m.id, m.text, m.source, m.doc_kind)
                     for i, m in enumerate(ctx.extraction.materials)])
                cur.executemany(
                    "INSERT INTO avery.memory_files (context_id, filename, content) "
                    "VALUES (%s, %s, %s)",
                    [(ctx.context_id, "facts.md", facts), (ctx.context_id, "notes.md", notes)])
        return ctx.context_id

    def get(self, context_id: str) -> CompanyContext | None:
        self._ensure_schema()
        with self._connect() as conn:
            row = conn.execute(
                "SELECT name, source_files FROM avery.contexts WHERE context_id = %s",
                (context_id,)).fetchone()
            if row is None:
                return None
            name, source_files = row
            ents = conn.execute(
                "SELECT kind, payload FROM avery.entities WHERE context_id = %s "
                "ORDER BY kind, idx", (context_id,)).fetchall()
            mats = conn.execute(
                "SELECT chunk_id, text, source, doc_kind FROM avery.materials "
                "WHERE context_id = %s ORDER BY idx", (context_id,)).fetchall()
            memfiles = dict(conn.execute(
                "SELECT filename, content FROM avery.memory_files WHERE context_id = %s",
                (context_id,)).fetchall())

        extraction = ExtractionResult(
            people=[_entity(PersonEntity, _PERSON_FIELDS, pl) for k, pl in ents if k == "person"],
            projects=[_entity(ProjectEntity, _PROJECT_FIELDS, pl) for k, pl in ents if k == "project"],
            signals=[_entity(SignalEntity, _SIGNAL_FIELDS, pl) for k, pl in ents if k == "signal"],
            materials=[MaterialChunk(id=cid, text=text, source=src, doc_kind=dk)
                       for cid, text, src, dk in mats])
        store = KeywordStore()
        store.add(extraction.materials)

        # THE RESTART STORY: if the local materialization is gone (fresh machine / wiped disk),
        # rebuild facts.md/notes.md byte-identically from the DB so the loop's recall/cite run
        # unchanged. Present local files are left alone (they ARE the materialization).
        mem_dir = self._root() / context_id
        for filename in ("facts.md", "notes.md"):
            f = mem_dir / filename
            if not f.exists():
                mem_dir.mkdir(parents=True, exist_ok=True)
                f.write_text(memfiles.get(filename, ""), encoding="utf-8")

        return CompanyContext(
            context_id=context_id, extraction=extraction, store=store, memory_dir=mem_dir,
            name=name, source_files=list(source_files))

    def resolve_memory_dir(self, context_id: str) -> Path | None:
        ctx = self.get(context_id)
        return ctx.memory_dir if ctx else None

    def __contains__(self, context_id: str) -> bool:
        self._ensure_schema()
        with self._connect() as conn:
            return conn.execute(
                "SELECT 1 FROM avery.contexts WHERE context_id = %s",
                (context_id,)).fetchone() is not None

    def delete(self, context_id: str) -> None:
        """Remove one context (entities/materials/memory cascade). Test + ops hygiene."""
        self._ensure_schema()
        with self._connect() as conn:
            conn.execute("DELETE FROM avery.contexts WHERE context_id = %s", (context_id,))

    def clear(self) -> None:
        """Drop ALL contexts — the in-memory API parity call. Test hygiene against a disposable
        local DB; NEVER wire this to a shared/production database path."""
        self._ensure_schema()
        with self._connect() as conn:
            conn.execute("DELETE FROM avery.contexts")
