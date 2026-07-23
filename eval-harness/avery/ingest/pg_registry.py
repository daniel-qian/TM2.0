"""feat-030 — the Postgres-backed ContextRegistry (the DB twin feat-018's registry promised).

Same duck-typed API as the in-memory `ContextRegistry` (`put/get/resolve_memory_dir/__contains__/
clear`), so it plugs in behind the existing seam with ZERO change to the pipeline, the loop, or the
HTTP handlers — `active_registry()` (registry.py) picks it whenever `AVERY_DB_URL`/`PGVECTOR_URL`
is set. Everything a company workspace is made of goes to Postgres (schema `avery`, see
db/migrations/0001_avery_persistence.sql):

    contexts       id / name / source_files / owner_token (feat-038 tenant-isolation credential)
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
from .registry import (
    CompanyContext, CompanyNote, ProjectWriteMixin, SourceDocument, data_root, gate_note_red_line,
    materialize_memory, new_note_id,
)
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


class PostgresContextRegistry(ProjectWriteMixin):
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
        # feat-032: the source-document TEXT columns (filename/source_key/mime/storage_ref) must be
        # NUL-free too — the raw `content` is bytea (a NUL there is legal and preserved byte-for-byte).
        blobs += [sd.filename for sd in ctx.source_documents]
        blobs += [sd.source_key for sd in ctx.source_documents]
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
            # feat-038: owner_token is the tenant-isolation credential. NULL when a direct caller/
            # test builds a tokenless context (v1 back-compat); the /ingest handler always sets it.
            conn.execute(
                "INSERT INTO avery.contexts (context_id, name, source_files, owner_token) "
                "VALUES (%s, %s, %s, %s) "
                "ON CONFLICT (context_id) DO UPDATE SET "
                "  name = EXCLUDED.name, source_files = EXCLUDED.source_files, "
                "  owner_token = EXCLUDED.owner_token, updated_at = now()",
                (ctx.context_id, ctx.name, Jsonb(list(ctx.source_files)),
                 (ctx.owner_token or None)))
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
                    "(context_id, idx, filename, source_key, mime, size_bytes, doc_kind, status, "
                    " content, storage_ref, uploaded_at) "
                    "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, "
                    "        COALESCE(%s::timestamptz, now()))",
                    [(ctx.context_id, i, sd.filename, sd.source_key, sd.mime, sd.size_bytes,
                      sd.doc_kind, sd.status, sd.content, sd.storage_ref, sd.uploaded_at or None)
                     for i, sd in enumerate(ctx.source_documents)])
        return ctx.context_id

    def get(self, context_id: str) -> CompanyContext | None:
        self._ensure_schema()
        with self._connect() as conn:
            row = conn.execute(
                "SELECT name, source_files, owner_token FROM avery.contexts "
                "WHERE context_id = %s",
                (context_id,)).fetchone()
            if row is None:
                return None
            name, source_files, owner_token = row
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
                "SELECT idx, filename, source_key, mime, size_bytes, doc_kind, status, storage_ref, "
                "uploaded_at FROM avery.source_documents WHERE context_id = %s ORDER BY idx",
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
                filename=fn, source_key=sk, mime=mime, size_bytes=sz, doc_kind=dk, status=st,
                storage_ref=sr, uploaded_at=ua.isoformat() if ua is not None else "", content=None)
            for _idx, fn, sk, mime, sz, dk, st, sr, ua in srcdocs]

        return CompanyContext(
            context_id=context_id, extraction=extraction, store=store, memory_dir=mem_dir,
            name=name, source_files=list(source_files), source_documents=source_documents,
            owner_token=owner_token or "")   # feat-038: NULL -> "" (a tokenless, pre-038 context)

    # --- input-side-0721 · 3A: clone (the one-click sample-team seam) --------------------------

    def clone_context(self, src_context_id: str, *, new_context_id: str,
                      new_owner_token: str) -> bool:
        """The Postgres twin of ContextRegistry.clone_context — one transaction of SQL-level
        INSERT..SELECT row copies. Deliberately NOT get()+put() recomposition, which would
        ① re-embed the whole corpus (a second billable DashScope pass for identical vectors —
        the embedding column is copied verbatim instead) and ② silently DROP the raw upload
        bytes (get() never pulls bytea; the clone's file space would list files it cannot serve).
        Notes get FRESH ids (company_notes.id is globally unique) but keep created_at.
        No red-line re-scan: every copied row passed the storage door on its way in, and a
        byte-copy cannot manufacture new content. False = unknown source context."""
        self._ensure_schema()
        with self._connect() as conn, conn.transaction():
            row = conn.execute(
                "INSERT INTO avery.contexts (context_id, name, source_files, owner_token) "
                "SELECT %s, name, source_files, %s FROM avery.contexts WHERE context_id = %s "
                "RETURNING context_id",
                (new_context_id, new_owner_token or None, src_context_id)).fetchone()
            if row is None:
                return False
            conn.execute(
                "INSERT INTO avery.entities (context_id, kind, idx, payload) "
                "SELECT %s, kind, idx, payload FROM avery.entities WHERE context_id = %s",
                (new_context_id, src_context_id))
            conn.execute(
                "INSERT INTO avery.materials "
                "(context_id, idx, chunk_id, text, source, doc_kind, embedding) "
                "SELECT %s, idx, chunk_id, text, source, doc_kind, embedding "
                "FROM avery.materials WHERE context_id = %s",
                (new_context_id, src_context_id))
            conn.execute(
                "INSERT INTO avery.memory_files (context_id, filename, content) "
                "SELECT %s, filename, content FROM avery.memory_files WHERE context_id = %s",
                (new_context_id, src_context_id))
            conn.execute(
                "INSERT INTO avery.source_documents "
                "(context_id, idx, filename, source_key, mime, size_bytes, doc_kind, status, "
                " content, storage_ref, uploaded_at) "
                "SELECT %s, idx, filename, source_key, mime, size_bytes, doc_kind, status, "
                " content, storage_ref, uploaded_at "
                "FROM avery.source_documents WHERE context_id = %s",
                (new_context_id, src_context_id))
            notes = conn.execute(
                "SELECT text, source_excerpt, created_at FROM avery.company_notes "
                "WHERE context_id = %s ORDER BY seq", (src_context_id,)).fetchall()
            if notes:
                with conn.cursor() as cur:
                    cur.executemany(
                        "INSERT INTO avery.company_notes "
                        "(id, context_id, text, source_excerpt, created_at) "
                        "VALUES (%s, %s, %s, %s, %s)",
                        [(new_note_id(), new_context_id, t, se, ca) for t, se, ca in notes])
        return True

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

    # --- feat-033: Avery's notes (write-side, accumulating, user-visible, survives restarts) ------

    def append_note(self, context_id: str, text: str, source_excerpt: str = "") -> CompanyNote:
        """Persist one agent observation to avery.company_notes. The write-side red line runs BEFORE
        any INSERT (a scoring/ranking/profiling note raises ValueError — nothing touches the DB), so
        this new write path inherits feat-030's storage-door moat. The FK to avery.contexts means an
        unknown context is refused by construction. Notes accumulate across sessions/restarts."""
        gate_note_red_line(text, source_excerpt)   # raises before we connect — nothing lands
        self._ensure_schema()
        note_id = new_note_id()
        with self._connect() as conn, conn.transaction():
            row = conn.execute(
                "INSERT INTO avery.company_notes (id, context_id, text, source_excerpt) "
                "VALUES (%s, %s, %s, %s) RETURNING created_at",
                (note_id, context_id, text, source_excerpt)).fetchone()
        created_at = row[0]
        return CompanyNote(id=note_id, created_at=created_at.isoformat(),
                           text=text, source_excerpt=source_excerpt)

    def list_notes(self, context_id: str) -> list[CompanyNote]:
        """This company's notes, NEWEST FIRST (ORDER BY seq DESC — monotonic insert order, so rapid
        appends that share a created_at still order deterministically)."""
        self._ensure_schema()
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT id, created_at, text, source_excerpt FROM avery.company_notes "
                "WHERE context_id = %s ORDER BY seq DESC", (context_id,)).fetchall()
        return [CompanyNote(id=nid, created_at=ca.isoformat(), text=txt, source_excerpt=se or "")
                for nid, ca, txt, se in rows]

    # --- feat-034: Ask ("Quick ask") storage — the postgres twin of the registry ask seam --------

    def put_ask(self, ask):
        """Persist one ask snapshot (create or update). The write-side red-line gate runs BEFORE
        any INSERT (a person-scoring question raises ValueError — nothing touches the DB), same
        storage-door discipline as append_note. Recipients are replaced as one atomic snapshot
        (same 're-put = replace' semantics as put())."""
        from psycopg.types.json import Jsonb
        from .ask import gate_ask_red_line
        gate_ask_red_line(ask)
        self._ensure_schema()
        questions = [{"id": q.id, "kind": q.kind, "text": q.text} for q in ask.questions]
        with self._connect() as conn, conn.transaction():
            conn.execute(
                "INSERT INTO avery.asks (id, context_id, status, thread_hint, questions, "
                " comment_prompt, generation_mode, created_at, expires_at) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s, "
                "        COALESCE(%s::timestamptz, now()), "
                "        COALESCE(%s::timestamptz, now() + interval '7 days')) "
                "ON CONFLICT (id) DO UPDATE SET "
                "  status = EXCLUDED.status, thread_hint = EXCLUDED.thread_hint, "
                "  questions = EXCLUDED.questions, comment_prompt = EXCLUDED.comment_prompt, "
                "  generation_mode = EXCLUDED.generation_mode, expires_at = EXCLUDED.expires_at",
                (ask.id, ask.context_id, ask.status, ask.thread_hint, Jsonb(questions),
                 ask.comment_prompt, ask.generation_mode,
                 ask.created_at or None, ask.expires_at or None))
            conn.execute("DELETE FROM avery.ask_recipients WHERE ask_id = %s", (ask.id,))
            with conn.cursor() as cur:
                cur.executemany(
                    "INSERT INTO avery.ask_recipients "
                    "(ask_id, idx, person_id, person_name, share_token, answers, comment, "
                    " answered_at) VALUES (%s, %s, %s, %s, %s, %s, %s, %s::timestamptz)",
                    [(ask.id, i, r.id, r.name, r.share_token or None,
                      Jsonb(r.answers) if r.answers is not None else None,
                      r.comment or "", r.answered_at or None)
                     for i, r in enumerate(ask.recipients)])
        return self.get_ask(ask.id)

    def _ask_from_rows(self, row, recips):
        from .ask import Ask, AskQuestion, AskRecipient
        (aid, context_id, status, thread_hint, questions, comment_prompt,
         generation_mode, created_at, expires_at) = row
        return Ask(
            id=aid, context_id=context_id, status=status, thread_hint=thread_hint or "",
            questions=[AskQuestion(id=q.get("id", ""), kind=q.get("kind", ""),
                                   text=q.get("text", "")) for q in (questions or [])],
            recipients=[AskRecipient(id=pid or "", name=pname, share_token=tok or "",
                                     answers=list(ans) if ans is not None else None,
                                     comment=cmt or "",
                                     answered_at=aat.isoformat() if aat is not None else "")
                        for _i, pid, pname, tok, ans, cmt, aat in recips],
            comment_prompt=comment_prompt or "", generation_mode=generation_mode or "manager",
            created_at=created_at.isoformat() if created_at is not None else "",
            expires_at=expires_at.isoformat() if expires_at is not None else "")

    _ASK_COLS = ("id, context_id, status, thread_hint, questions, comment_prompt, "
                 "generation_mode, created_at, expires_at")
    _RECIP_COLS = "idx, person_id, person_name, share_token, answers, comment, answered_at"

    def get_ask(self, ask_id: str):
        self._ensure_schema()
        with self._connect() as conn:
            row = conn.execute(
                f"SELECT {self._ASK_COLS} FROM avery.asks WHERE id = %s", (ask_id,)).fetchone()
            if row is None:
                return None
            recips = conn.execute(
                f"SELECT {self._RECIP_COLS} FROM avery.ask_recipients "
                "WHERE ask_id = %s ORDER BY idx", (ask_id,)).fetchall()
        return self._ask_from_rows(row, recips)

    def get_ask_by_token(self, share_token: str):
        """Resolve one employee link -> (ask, recipient index), or None. One indexed lookup —
        the token is the whole credential (no enumeration path)."""
        if not share_token:
            return None
        self._ensure_schema()
        with self._connect() as conn:
            hit = conn.execute(
                "SELECT ask_id, idx FROM avery.ask_recipients WHERE share_token = %s",
                (share_token,)).fetchone()
        if hit is None:
            return None
        ask = self.get_ask(hit[0])
        if ask is None or hit[1] >= len(ask.recipients):
            return None
        return ask, hit[1]

    def record_answer(self, share_token: str, answers: list, comment: str,
                      answered_at: str) -> str:
        """The answer-once lock, ATOMIC in SQL: the UPDATE lands only where answered_at IS NULL,
        so two racing submits can never both write ('ok' / 'already' / 'unknown'). Advances the
        ask status shared->collecting->closed inside the same transaction."""
        from psycopg.types.json import Jsonb
        if not share_token:
            return "unknown"
        self._ensure_schema()
        with self._connect() as conn, conn.transaction():
            cur = conn.execute(
                "UPDATE avery.ask_recipients SET answers = %s, comment = %s, "
                "answered_at = %s::timestamptz "
                "WHERE share_token = %s AND answered_at IS NULL RETURNING ask_id",
                (Jsonb(list(answers)), comment or "", answered_at, share_token))
            row = cur.fetchone()
            if row is None:
                exists = conn.execute(
                    "SELECT 1 FROM avery.ask_recipients WHERE share_token = %s",
                    (share_token,)).fetchone()
                return "already" if exists else "unknown"
            ask_id = row[0]
            total, done = conn.execute(
                "SELECT count(*), count(answered_at) FROM avery.ask_recipients "
                "WHERE ask_id = %s", (ask_id,)).fetchone()
            conn.execute(
                "UPDATE avery.asks SET status = %s "
                "WHERE id = %s AND status IN ('shared', 'collecting')",
                ("closed" if done >= total else "collecting", ask_id))
        return "ok"

    # --- feat-053: the account seam (Supabase user id <-> context ownership) ----------------------
    # The Postgres twin of the in-memory map, same duck-typed API so the service layer never asks
    # which registry it holds. Storage: avery.account_contexts (migration 0008). Ownership is 1:1 by
    # a UNIQUE index on context_id — the DB, not a service-layer check, is what makes "两个账号数据
    # 不串" true even under a race between two simultaneous claims.

    def link_account_context(self, user_id: str, context_id: str) -> bool:
        """Bind a context to an account; False when another account already owns it (or the context
        does not exist — the FK refuses it). Idempotent for the SAME user: ON CONFLICT DO NOTHING on
        the primary key, then confirm the owner really is this user before reporting success. That
        re-read is what distinguishes 'already yours' from 'someone else's' — both hit a conflict."""
        if not user_id or not context_id:
            return False
        self._ensure_schema()
        try:
            with self._connect() as conn:
                conn.execute(
                    "INSERT INTO avery.account_contexts (user_id, context_id) VALUES (%s, %s) "
                    "ON CONFLICT DO NOTHING", (user_id, context_id))
        except self._psycopg.errors.ForeignKeyViolation:
            return False   # unknown context_id — nothing to claim
        return self.account_for_context(context_id) == user_id

    def contexts_for_account(self, user_id: str) -> list[str]:
        """Every context this user owns, newest link first."""
        if not user_id:
            return []
        self._ensure_schema()
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT context_id FROM avery.account_contexts WHERE user_id = %s "
                "ORDER BY created_at DESC", (user_id,)).fetchall()
        return [r[0] for r in rows]

    def account_for_context(self, context_id: str) -> str | None:
        """The account that owns this context, or None when it is still anonymous."""
        if not context_id:
            return None
        self._ensure_schema()
        with self._connect() as conn:
            row = conn.execute(
                "SELECT user_id FROM avery.account_contexts WHERE context_id = %s",
                (context_id,)).fetchone()
        return row[0] if row else None

    def account_owns(self, user_id: str | None, context_id: str) -> bool:
        """May THIS signed-in user read THIS context? Exact match only — an anonymous (unclaimed)
        context is never readable through the account path."""
        if not user_id or not context_id:
            return False
        return self.account_for_context(context_id) == user_id

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
