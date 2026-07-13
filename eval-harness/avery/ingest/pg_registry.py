"""feat-030 — the Postgres-backed ContextRegistry (the DB twin feat-018's registry promised).

Same duck-typed API as the in-memory `ContextRegistry` (`put/get/resolve_memory_dir/__contains__/
clear`), so it plugs in behind the existing seam with ZERO change to the pipeline, the loop, or the
HTTP handlers — `active_registry()` (registry.py) picks it whenever `AVERY_DB_URL`/`PGVECTOR_URL`
is set. Everything a company workspace is made of goes to Postgres (schema `avery`, see
db/migrations/0001_avery_persistence.sql):

    contexts       id / name / source_files (+ owner_token reserved for feat-034)
    entities       people / projects / signals as ordered JSONB rows
    materials      RAG chunks as rows (+ embedding vector(1024) — feat-031 fills it when keyed)
    memory_files   facts.md / notes.md FULL TEXT — the re-materialization source

`get()` rebuilds a full CompanyContext from those rows: entities -> ExtractionResult, materials ->
a RetrievalStore, and — the restart story — if the local memory_dir files are missing (new machine /
redeploy wiped the disk) they are RE-MATERIALIZED byte-identically from the DB, so the loop's
recall/cite run unchanged over a company ingested before the restart.

feat-031 — real vector RAG that survives the restart: given an `embedder` (env-selected, same one
the service builds) `put()` writes each chunk's embedding into `materials.embedding`, and `get()`
rebuilds a `PgVectorStore` (cosine kNN in the DB via `<=>`) instead of a KeywordStore — so retrieval
is STILL VECTOR after a redeploy, the pgvector twin of the memory_dir re-materialization story. With
NO embedder (or a keyword-mode context whose embeddings are NULL) it stays the offline KeywordStore:
honest, never a vector store that silently returns nothing.

RED LINE AT THE STORAGE DOOR (structural, two independent layers — feat-030 P1):
  * Python (put): the FULL red-line scan `redline_extract.validate_extraction` (person value fields
    AND rendered free text, EN+ZH) runs BEFORE any INSERT — a smuggled score in a qualitative field
    (owns=['ranked 2/10'], collaboration=['bottom quartile performer']) raises and NOTHING is
    written. This mirrors the pipeline's own gate, so ANY direct put() writer (e.g. feat-033's
    self-written notes) inherits it.
  * SQL (`entities_person_keys_allowlist`, migration 0002): the DB refuses a person row whose payload
    carries ANY key outside PersonEntity's own qualitative fields — an ALLOWLIST, so Chinese
    (绩效评分/排名) and compound English (zscore/nine_box) scoring keys are refused by construction,
    no wordlist to maintain. Even a writer that bypasses this module cannot persist a scoring KEY.
Together: a scoring KEY is stopped by the DB, a scoring VALUE in an allowed field is stopped by put().

Connections are short-lived (one per operation, context-managed) — no pooling, no shared state, so
the registry is trivially safe under FastAPI's threadpool offloading and 'a new instance sees the
same data' is true by construction. psycopg (3) is imported lazily; the offline suite never needs it.
"""
from __future__ import annotations

import dataclasses
import logging
import os
from dataclasses import asdict
from pathlib import Path

from .extract import (
    ExtractionResult, MaterialChunk, PersonEntity, ProjectEntity, SignalEntity,
)
from .redline_extract import validate_extraction
from .registry import CompanyContext, SourceDocument, data_root, materialize_memory
from .store import Embedder, KeywordStore, PgVectorStore, VectorStore, _vec_literal

logger = logging.getLogger(__name__)

_MIGRATIONS_DIR = Path(__file__).resolve().parent.parent.parent / "db" / "migrations"

# avery.materials.embedding is vector(1024) (= AVERY_EMBED_DIM, DashScope text-embedding dim). An
# embedding of a different dim cannot be stored — feat-031 leaves the column NULL rather than crash.
_DEFAULT_EMBED_DIM = 1024


def _embed_dim() -> int:
    try:
        return int(os.environ.get("AVERY_EMBED_DIM", str(_DEFAULT_EMBED_DIM)))
    except (TypeError, ValueError):
        return _DEFAULT_EMBED_DIM

_PERSON_FIELDS = {f.name for f in dataclasses.fields(PersonEntity)}
_PROJECT_FIELDS = {f.name for f in dataclasses.fields(ProjectEntity)}
_SIGNAL_FIELDS = {f.name for f in dataclasses.fields(SignalEntity)}


def _entity(cls, fields: set[str], payload: dict):
    """Rebuild a dataclass entity from a stored JSONB payload, ignoring unknown keys so an OLD
    reader survives a NEWER writer's extra columns (forward compatibility)."""
    return cls(**{k: v for k, v in payload.items() if k in fields})


class PostgresContextRegistry:
    """id -> CompanyContext, persisted in Postgres. Company data survives restarts/redeploys."""

    # feat-031 cost gate: this registry PERSISTS material embeddings and get() rebuilds a pgvector
    # store that the recall side actually queries — so embedding the corpus has a reader. The /ingest
    # handler opens the vector path (prefer_vector) only behind a persistent registry like this one.
    persistent = True

    def __init__(self, url: str, *, data_dir: str | Path | None = None,
                 embedder: Embedder | None = None) -> None:
        import psycopg  # lazy: only the DB-configured path ever imports the driver

        self._psycopg = psycopg
        self._url = url
        self._data_dir = Path(data_dir) if data_dir else None
        self._embedder = embedder   # feat-031: present -> put() fills embeddings, get() -> pgvector
        self._schema_ready = False

    # --- plumbing ------------------------------------------------------------------------------

    def _connect(self):
        return self._psycopg.connect(self._url)

    def _root(self) -> Path:
        """Local materialization root: explicit data_dir beats AVERY_DATA_DIR beats OS temp."""
        return self._data_dir if self._data_dir is not None else data_root()

    def _ensure_schema(self) -> None:
        """Idempotent bootstrap: replay EVERY migration file (sorted) — the SAME files applied to
        Supabase, so local/prod schema equivalence holds by construction. Each is CREATE ... IF NOT
        EXISTS / DROP ... IF EXISTS + ADD, safe to re-run.

        feat-030 P5: a permission error means a locked-down prod role whose schema was provisioned
        out-of-band — TOLERATED only if `avery.contexts` actually exists; if it does NOT, re-raise a
        clear bootstrap error rather than letting a downstream `UndefinedTable` confuse the caller."""
        if self._schema_ready:
            return
        for path in sorted(_MIGRATIONS_DIR.glob("*.sql")):
            sql = path.read_text(encoding="utf-8")
            try:
                with self._connect() as conn:
                    conn.execute(sql)
            except self._psycopg.errors.InsufficientPrivilege as e:
                with self._connect() as conn:
                    exists = conn.execute("SELECT to_regclass('avery.contexts')").fetchone()[0]
                if exists is None:
                    raise RuntimeError(
                        "avery schema is not provisioned and this DB role lacks CREATE privilege; "
                        "apply eval-harness/db/migrations/*.sql out-of-band (or grant CREATE)."
                    ) from e
                break   # schema exists, role just can't (re)create it — assume provisioned in full
        self._schema_ready = True

    # --- red line at the storage door ------------------------------------------------------------

    @staticmethod
    def _gate_red_line(ctx: CompanyContext) -> None:
        """feat-030 P1: the FULL red-line scan (value + free text, EN+ZH) — the same gate the
        pipeline runs — BEFORE any INSERT. A smuggled score in a qualitative field (owns=['ranked
        2/10']) is refused here, so ANY direct put() writer (feat-033 notes) inherits the moat, not
        just the /ingest path. PersonEntity has no numeric field; this catches free-text smuggling."""
        rl = validate_extraction(ctx.extraction)
        if not rl.ok:
            raise ValueError(f"red line: refusing to persist a scoring extraction ({rl.summary()})")

    @staticmethod
    def _assert_no_control_chars(ctx: CompanyContext, facts: str, notes: str) -> None:
        """feat-030 P3: a NUL (0x00) is illegal in a Postgres text value and would crash the driver
        with an opaque error surfacing as HTTP 500. Parse scrubs C0 controls for the /ingest path;
        this guard makes a bypass (a directly-built context) fail LOUD and CLEAN (ValueError -> 422)
        instead. Checks every text that reaches a column."""
        blobs = [facts, notes, ctx.name, *ctx.source_files]
        blobs += [m.text for m in ctx.extraction.materials]
        blobs += [p.name for p in ctx.extraction.people]
        # feat-032: the source-document TEXT columns (filename/mime/storage_ref) must be NUL-free too
        # — the raw `content` is bytea (a NUL there is legal and preserved byte-for-byte).
        blobs += [sd.filename for sd in ctx.source_documents]
        blobs += [sd.mime for sd in ctx.source_documents]
        blobs += [sd.storage_ref for sd in ctx.source_documents]
        if any("\x00" in (b or "") for b in blobs):
            raise ValueError(
                "unsupported control character (NUL / 0x00) in the upload — cannot be stored")

    # --- feat-031: real vector RAG at the storage door -------------------------------------------

    def _material_vectors(self, ctx: CompanyContext) -> list[list[float]] | None:
        """Embeddings aligned to `ctx.extraction.materials` to persist into materials.embedding, or
        None (keyword mode -> the column stays NULL, an HONEST 'no vectors here'). It PREFERS the
        vectors the pipeline already computed (`ctx.store`, a VectorStore) so a corpus is embedded
        ONCE — no second, billable DashScope pass — and only re-embeds with the registry's own
        embedder as a fallback. A dim that does not match the vector(N) column is refused (returns
        None) so a mis-sized embedder degrades to keyword instead of crashing the INSERT.

        Embedding is done OUTSIDE the DB transaction (it may hit a network endpoint); only the
        already-computed vectors cross into put()'s transaction.

        feat-031 honesty: if vectors ARE produced but their dim != the vector(N) column (a wrong-dim
        embedder against feat-030's frozen 1024), we still degrade to NULL/keyword — but LOUDLY, via
        a warning naming actual vs expected dim, so the quality drop is visible in logs, not silent."""
        mats = ctx.extraction.materials
        if not mats:
            return None
        dim = _embed_dim()

        def _fits(vecs: list[list[float]]) -> bool:
            return len(vecs) == len(mats) and all(len(v) == dim for v in vecs)

        # Prefer the vectors the pipeline already computed (embed once); else the registry's embedder.
        store = getattr(ctx, "store", None)
        vecs: list[list[float]] | None = None
        if isinstance(store, VectorStore) and store.available:
            candidate = store.persisted_vectors()
            if _fits(candidate):
                return candidate
            vecs = candidate           # kept only to report its (wrong) dim if the embedder also fails
        if self._embedder is not None:
            candidate = self._embedder.embed([m.text for m in mats])
            if _fits(candidate):
                return candidate
            vecs = candidate

        # A dim that does not match the vector(N) column can't be stored. Degrade to keyword, but say
        # so — a wrong-dim embedder is a config error that would otherwise vanish into a silent NULL.
        if vecs and any(len(v) != dim for v in vecs):
            actual = len(vecs[0])
            logger.warning(
                "embedder produced %d-dim vectors but avery.materials.embedding is vector(%d); "
                "storing NULL embeddings for context %s — retrieval degraded to keyword",
                actual, dim, ctx.context_id)
        return None

    # --- the ContextRegistry API -----------------------------------------------------------------

    def put(self, ctx: CompanyContext) -> str:
        from psycopg.types.json import Jsonb

        # Gate BEFORE connecting — a violating context never touches the DB.
        self._gate_red_line(ctx)

        # feat-031: embed the material corpus (or reuse pipeline vectors) BEFORE opening the tx —
        # keeps a possibly-slow embedding call off the transaction. None -> embeddings stay NULL.
        vecs = self._material_vectors(ctx)

        people = [asdict(p) for p in ctx.extraction.people]
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

        self._assert_no_control_chars(ctx, facts, notes)   # P3: fail clean, not a raw driver 500
        self._ensure_schema()

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
            conn.execute("DELETE FROM avery.source_documents WHERE context_id = %s",
                         (ctx.context_id,))

            with conn.cursor() as cur:
                cur.executemany(
                    "INSERT INTO avery.entities (context_id, kind, idx, payload) "
                    "VALUES (%s, %s, %s, %s)",
                    [(ctx.context_id, kind, i, Jsonb(payload))
                     for kind, rows in (("person", people), ("project", projects),
                                        ("signal", signals))
                     for i, payload in enumerate(rows)])
                cur.executemany(
                    "INSERT INTO avery.materials "
                    "(context_id, idx, chunk_id, text, source, doc_kind, embedding) "
                    "VALUES (%s, %s, %s, %s, %s, %s, %s::vector)",   # feat-031 fills embedding
                    [(ctx.context_id, i, m.id, m.text, m.source, m.doc_kind,
                      _vec_literal(vecs[i]) if vecs is not None else None)  # None -> NULL::vector
                     for i, m in enumerate(ctx.extraction.materials)])
                cur.executemany(
                    "INSERT INTO avery.memory_files (context_id, filename, content) "
                    "VALUES (%s, %s, %s)",
                    [(ctx.context_id, "facts.md", facts), (ctx.context_id, "notes.md", notes)])
                # feat-032: the per-company file space — raw uploads (bytea + metadata). The bytes
                # are UNTRUSTED content: stored here, served for download, never followed. content
                # is bound as a Python `bytes` (psycopg maps it to bytea); NULL when absent.
                cur.executemany(
                    "INSERT INTO avery.source_documents "
                    "(context_id, idx, filename, mime, size_bytes, doc_kind, content, storage_ref, "
                    " uploaded_at) "
                    "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, COALESCE(%s::timestamptz, now()))",
                    [(ctx.context_id, i, sd.filename, sd.mime, sd.size_bytes, sd.doc_kind,
                      sd.content, sd.storage_ref, sd.uploaded_at or None)
                     for i, sd in enumerate(ctx.source_documents)])
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
            # feat-031: does this context actually carry vectors? (An embedder may be configured
            # while a context was ingested in keyword mode — then vector retrieval would be empty.)
            emb_count = conn.execute(
                "SELECT count(*) FROM avery.materials "
                "WHERE context_id = %s AND embedding IS NOT NULL", (context_id,)).fetchone()[0]
            # feat-032: the file-space manifest is METADATA ONLY — the bytea `content` is NOT pulled
            # here (a listing must not drag every uploaded file into memory); the download seam
            # (source_document_bytes) fetches one file's bytes on demand.
            srcdocs = conn.execute(
                "SELECT idx, filename, mime, size_bytes, doc_kind, storage_ref, uploaded_at "
                "FROM avery.source_documents WHERE context_id = %s ORDER BY idx",
                (context_id,)).fetchall()

        extraction = ExtractionResult(
            people=[_entity(PersonEntity, _PERSON_FIELDS, pl) for k, pl in ents if k == "person"],
            projects=[_entity(ProjectEntity, _PROJECT_FIELDS, pl) for k, pl in ents if k == "project"],
            signals=[_entity(SignalEntity, _SIGNAL_FIELDS, pl) for k, pl in ents if k == "signal"],
            materials=[MaterialChunk(id=cid, text=text, source=src, doc_kind=dk)
                       for cid, text, src, dk in mats])

        # feat-031: real vector retrieval that SURVIVES the restart — an embedder configured AND
        # vectors actually stored -> a pgvector-backed store (cosine kNN in the DB, no corpus pulled
        # into memory). Otherwise the offline KeywordStore (no embedder, or a keyword-mode context):
        # HONEST — never a vector store that would silently return nothing.
        if self._embedder is not None and emb_count > 0:
            store = PgVectorStore(self._url, context_id, self._embedder, dim=_embed_dim())
        else:
            store = KeywordStore()
            store.add(extraction.materials)

        # THE RESTART STORY: rebuild facts.md/notes.md byte-identically from the DB so the loop's
        # recall/cite run unchanged after a restart / on a fresh machine. feat-030 P2: the DB is the
        # source of truth for these PURE materializations — compare-then-write, so a STALE local file
        # (older than a re-put over the same id, a split-brain reader) is refreshed, not served.
        # Compare first to avoid needless mtime churn when the local copy already matches.
        mem_dir = self._root() / context_id
        for filename in ("facts.md", "notes.md"):
            f = mem_dir / filename
            want = memfiles.get(filename, "")
            if not f.exists() or f.read_text(encoding="utf-8") != want:
                mem_dir.mkdir(parents=True, exist_ok=True)
                f.write_text(want, encoding="utf-8")

        source_documents = [
            SourceDocument(
                filename=fn, mime=mime, size_bytes=sz, doc_kind=dk, storage_ref=sr,
                uploaded_at=ua.isoformat() if ua is not None else "", content=None)
            for _idx, fn, mime, sz, dk, sr, ua in srcdocs]

        return CompanyContext(
            context_id=context_id, extraction=extraction, store=store, memory_dir=mem_dir,
            name=name, source_files=list(source_files), source_documents=source_documents)

    def source_document_bytes(self, context_id: str, idx: int) -> bytes | None:
        """feat-032 download seam: the raw bytea of one uploaded file, pulled on demand (never in
        get()). None for an unknown context / idx or a NULL content. Short-lived connection, same
        no-pooling model as every other op."""
        self._ensure_schema()
        with self._connect() as conn:
            row = conn.execute(
                "SELECT content FROM avery.source_documents WHERE context_id = %s AND idx = %s",
                (context_id, idx)).fetchone()
        if row is None or row[0] is None:
            return None
        return bytes(row[0])

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
