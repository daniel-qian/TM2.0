"""feat-030 — the Postgres-backed ContextRegistry (the DB twin feat-018's registry promised).

Same API as the in-memory `ContextRegistry` — the full ~26-member surface is written down as
`registry.ContextRegistryProtocol`, and `tests/test_registry_protocol.py` asserts OFFLINE that both
adapters implement every member with identical parameter lists (this docstring used to claim a
5-method API; that was stale by ~21 methods). It plugs in behind the existing seam with ZERO change
to the pipeline, the loop, or the HTTP handlers — `active_registry()` (registry.py) picks it
whenever `AVERY_DB_URL`/`PGVECTOR_URL` is set. The one deliberate pg-only extra is `delete()`
(shared-dev-DB hygiene; not seam surface — the conformance test pins this asymmetry as intended). Everything a company workspace is made of goes to Postgres (schema `avery`, see
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
import time
from dataclasses import asdict
from pathlib import Path

from .extract import (
    ExtractionResult, FieldConflict, MaterialChunk, MethodCard, PersonEntity, ProjectEntity,
    SignalEntity,
)
from .granularity import Ruling                                             # issue #93
from .redline_extract import validate_extraction
from .registry import (
    AdviseRun, AdviseThread, CompanyContext, CompanyNote, ProjectWriteMixin, SourceDocument, data_root,
    gate_note_red_line, materialize_memory, new_note_id, new_run_id,
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


def _int_env(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, str(default)))
    except (TypeError, ValueError):
        return default

_PERSON_FIELDS = {f.name for f in dataclasses.fields(PersonEntity)}
_PROJECT_FIELDS = {f.name for f in dataclasses.fields(ProjectEntity)}
_SIGNAL_FIELDS = {f.name for f in dataclasses.fields(SignalEntity)}
_PLAYBOOK_FIELDS = {f.name for f in dataclasses.fields(MethodCard)}  # rich-align-0722/08
_CONFLICT_FIELDS = {f.name for f in dataclasses.fields(FieldConflict)}   # T6/B2a
_RULING_FIELDS = {f.name for f in dataclasses.fields(Ruling)}           # issue #93

# The entity `kind` column values put() writes — the SINGLE source of truth the DB `entities_kind_check`
# CHECK (migration 0001 + 0010) must match. Add a kind here WITHOUT extending that CHECK and real
# Postgres rejects the write in prod, invisible to the offline suite (`not needs_db` never hits the
# CHECK) — exactly how 08's "playbook" kind shipped and only failed on the prod demo cast. The offline
# guard test_entities_kind_check_covers_written_kinds asserts the two never drift again.
_ENTITY_KINDS = ("person", "project", "signal", "playbook", "conflict",
                 "ruling")   # T6/B2a added "conflict"; issue #93 added "ruling"


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
        clear bootstrap error rather than letting a downstream `UndefinedTable` confuse the caller.

        gc-demo-clones-0724 (lock-cheap bootstrap): each migration runs under a short lock_timeout +
        statement_timeout, and the whole replay retries with backoff. So a bootstrap that races a
        concurrent /demo/claim holding an entities lock — or an ORPHANED idle-in-transaction claim, the
        exact 2026-07-23 outage — FAILS FAST and retries instead of hanging until Supabase's 2-min
        statement_timeout and tripping the container HEALTHCHECK. Paired with 0009/0010's guarded ADD
        CONSTRAINT (a no-op catalog lookup on the normal boot where nothing changed), the steady-state
        bootstrap takes NO ACCESS EXCLUSIVE lock on entities at all — the lock_timeout is the backstop
        for the rare apply path (a genuine schema change, or a fresh DB) and for a stuck writer."""
        if self._schema_ready:
            return
        lock_ms = _int_env("AVERY_BOOTSTRAP_LOCK_TIMEOUT_MS", 3000)
        stmt_ms = _int_env("AVERY_BOOTSTRAP_STMT_TIMEOUT_MS", 30000)
        retries = max(1, _int_env("AVERY_BOOTSTRAP_RETRIES", 4))
        contended = (self._psycopg.errors.LockNotAvailable, self._psycopg.errors.QueryCanceled)
        for attempt in range(1, retries + 1):
            try:
                self._replay_migrations(lock_ms, stmt_ms)
                self._schema_ready = True
                return
            except contended as e:
                if attempt >= retries:
                    raise RuntimeError(
                        f"avery schema bootstrap could not lock the entities table after {retries} "
                        f"attempts (lock_timeout={lock_ms}ms) — a concurrent /demo/claim or an "
                        "orphaned idle-in-transaction connection is likely holding it; clear it "
                        "(SELECT pg_terminate_backend(pid) on the blocker) and restart."
                    ) from e
                logger.warning(
                    "schema bootstrap attempt %d/%d hit a lock/timeout (%s); retrying",
                    attempt, retries, type(e).__name__)
                time.sleep(min(2.0, 0.25 * (2 ** (attempt - 1))))   # 0.25 / 0.5 / 1.0s backoff

    def _replay_migrations(self, lock_ms: int, stmt_ms: int) -> None:
        """Run each migration file in its own short-lived, time-bounded connection. lock_ms / stmt_ms
        are millisecond GUCs (bare-int units for lock_timeout/statement_timeout); coerced to int so
        they are injection-safe when inlined into SET."""
        for path in sorted(_MIGRATIONS_DIR.glob("*.sql")):
            sql = path.read_text(encoding="utf-8")
            try:
                with self._connect() as conn:
                    conn.execute(f"SET lock_timeout = {int(lock_ms)}")
                    conn.execute(f"SET statement_timeout = {int(stmt_ms)}")
                    conn.execute(sql)
            except self._psycopg.errors.InsufficientPrivilege as e:
                with self._connect() as conn:
                    exists = conn.execute("SELECT to_regclass('avery.contexts')").fetchone()[0]
                if exists is None:
                    raise RuntimeError(
                        "avery schema is not provisioned and this DB role lacks CREATE privilege; "
                        "apply eval-harness/db/migrations/*.sql out-of-band (or grant CREATE)."
                    ) from e
                return   # schema exists, role just can't (re)create it — assume provisioned in full

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

    def _prior_vector_keys(self, context_id: str) -> set[tuple[str, str]]:
        """T2/#53 —— 这个 context 库里**已带非 NULL 向量**的块的 (chunk_id, text) 键集。
        键故意与 put() 事务内 `_prior_mat_vecs` 回填的 join 条件逐字同口径（chunk_id + text 双键：
        text 变了说明块真变了，不给旧向量）——`_material_vectors` 靠它决定哪些块**不必**重嵌。"""
        self._ensure_schema()
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT chunk_id, text FROM avery.materials "
                "WHERE context_id = %s AND embedding IS NOT NULL", (context_id,)).fetchall()
        return {(cid, text) for cid, text in rows}

    def _material_vectors(self, ctx: CompanyContext) -> "list[list[float] | None] | None":
        """Embeddings aligned to `ctx.extraction.materials` to persist into materials.embedding, or
        None (keyword mode -> the column stays NULL, an HONEST 'no vectors here'). It PREFERS the
        vectors the pipeline already computed (`ctx.store`, a VectorStore) so a corpus is embedded
        ONCE — no second, billable DashScope pass — and only re-embeds with the registry's own
        embedder as a fallback. A dim that does not match the vector(N) column is refused (returns
        None) so a mis-sized embedder degrades to keyword instead of crashing the INSERT.

        Embedding is done OUTSIDE the DB transaction (it may hit a network endpoint); only the
        already-computed vectors cross into put()'s transaction.

        T2/#53（gap-design-0805 · A1 的成本命门）：`get()` 重建的 store 是 `PgVectorStore` ——
        它**不是** `VectorStore` 的子类（store.py 里是两个独立类，add() 还是 no-op），所以下面的
        isinstance 对 get→mutate→put 的每一次手编/append 写回**恒假**，修前每次都落到 fallback
        把整个语料重嵌一遍（10 人×每周一份周报 = 每周 10 次全语料计费）。修法是把事务内
        `_prior_mat_vecs` 已证明可行的那招提前用上：先按 (chunk_id, text) 问库里哪些块已有向量，
        那些块返回 **None 占位**（INSERT 落 NULL → 同一事务的 UPDATE...FROM 原库回填，向量全程
        不出库），只对真正新增/文本变过的块调 embedder。返回列表因此是 per-row Optional。

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
            # T2/#53：只嵌库里还没有向量的块。首次 ingest（库里零行）时 missing=全部，行为与修前
            # 完全一致；append/手编写回时 missing=新增那几行。键查询失败不该挡 put ——
            # 退化成「全嵌」（修前行为），贵但正确。
            try:
                prior = self._prior_vector_keys(ctx.context_id)
            except Exception as e:
                logger.warning(
                    "reading prior vector keys failed (%s: %s) — falling back to a full re-embed "
                    "for context %s", type(e).__name__, str(e)[:200], ctx.context_id)
                prior = set()
            missing = [i for i, m in enumerate(mats) if (m.id, m.text) not in prior]
            # 0805 走查修闸: this fallback re-embed is billable too (and now passes the
            # AVERY_EMBED_CALL_BUDGET spend gate). A failure — endpoint outage or the gate refusing
            # the batch — must degrade to NULL embeddings (keyword retrieval at get()), never fail
            # the whole put(): the manager's upload lands either way. (旧块的向量仍由事务内回填
            # 保住 —— 一次失败的 append 不会把已有检索面拖回 keyword。)
            try:
                fresh = self._embedder.embed([mats[i].text for i in missing]) if missing else []
            except Exception as e:
                logger.warning(
                    "embedding the material corpus failed (%s: %s) — storing NULL embeddings for "
                    "context %s; retrieval degraded to keyword",
                    type(e).__name__, str(e)[:200], ctx.context_id)
                return None
            if len(fresh) == len(missing) and all(len(v) == dim for v in fresh):
                out: "list[list[float] | None]" = [None] * len(mats)
                for i, v in zip(missing, fresh):
                    out[i] = v
                return out
            vecs = fresh

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

    @staticmethod
    def _canon_payload(payload: dict) -> str:
        """One canonical JSON text for jsonb equality checks. The two sides of the #90 diff have
        different shapes of the SAME value: `asdict()` output (may hold tuples, insertion-ordered
        keys) vs a psycopg jsonb round trip (lists, jsonb's own key order). dumps(sort_keys=True)
        maps both onto identical text, so "row unchanged" is judged on VALUE, never on
        serialization accidents. Used for comparison only — the INSERT still binds the raw dict."""
        import json
        return json.dumps(payload, ensure_ascii=False, sort_keys=True)

    @staticmethod
    def _first_divergence(existing: list, desired: list) -> int:
        """#90 · the positional-diff pivot: index of the first row where the stored table and the
        desired snapshot disagree. Everything before it is byte-identical and is NOT rewritten;
        everything from it on is replaced (DELETE idx>=pivot + INSERT the tail). Equal prefixes of
        unequal lengths diverge at min(len) — an append diverges exactly at the old length, so the
        common "补传 adds rows at the end" case writes ONLY the new rows."""
        n = min(len(existing), len(desired))
        for i in range(n):
            if existing[i] != desired[i]:
                return i
        return n

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
        playbooks = [asdict(p) for p in getattr(ctx.extraction, "playbooks", [])]  # rich-align-0722/08
        # T6/B2a — 归并丢弃的读数必须**随 context 落库**。
        conflicts = [asdict(c) for c in getattr(ctx.extraction, "conflicts", [])]
        # issue #93 — 粒度闸的裁决记录随 context 落库。上面这段注释原本拿 `granularity` 当**反面
        # 教材**（「也是顶层列表，但 get() 从不重建它，于是真库往返里静默丢失，而离线套用的是
        # in-memory registry，永远考不到这件事」）。那笔账现在结清了，理由不是整洁，是**必须**：
        # #93 起补传路会**折叠**卡（`rejudge.py`），而这个模块唯一的合法性根据是「每一次降级都
        # 说得出为什么」。裁决不落库 = 容器一重启，「这张卡为什么不见了」就永远答不出来了 ——
        # 一张看不见的卡加一个答不出的问题，比当初那 7 张假项目卡还坏。
        rulings = [asdict(r) for r in getattr(ctx.extraction, "granularity", [])]

        # The materialized memory FULL TEXT is what a restart re-materializes from. If the caller
        # somehow hands a context whose files are not on disk yet, materialize first — the DB row
        # must never be emptier than the loop's recall surface.
        mem = Path(ctx.memory_dir)
        if not (mem / "facts.md").exists():
            materialize_memory(ctx.extraction, mem)
        facts = (mem / "facts.md").read_text(encoding="utf-8")
        notes = (mem / "notes.md").read_text(encoding="utf-8") if (mem / "notes.md").exists() else ""

        self._assert_no_control_chars(ctx, facts, notes)   # P3: fail clean, not a raw driver 500

        # #90 · content idempotency belt: any writer that hands us bytes without their hash gets it
        # computed here, OUTSIDE the transaction — so the INSERT below always carries a real digest
        # and the idempotency map never misses a row for "the caller forgot".
        import hashlib
        for sd in ctx.source_documents:
            if sd.content is not None and not sd.content_sha256:
                sd.content_sha256 = hashlib.sha256(sd.content).hexdigest()

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
            # files-hub-0729/01 → arch-0802 · 保住已存的原始字节，改为**纯 SQL 回填**
            # （老注释里"再往上抬就该改成临时表 + UPDATE...FROM"的那一步，现在就是）。
            #
            # 病灶不变：`get()` 的清单投影刻意不拉 bytea（`content=None`），而全部手编 CRUD 都是
            # `get() → 改 → put()`（registry.py:190-238），被重写的行（#90 的 diff 下=分歧点之后
            # 的行；#90 之前=每一行）会把 content 落成 NULL——
            #   ① `GET /team/{id}/files/{idx}` 永远 404 而清单照列（「不建假按钮」红线走后门）；
            #   ② 用户上传的**原件被永久销毁**（与 UI 无关，更重）。
            #
            # 老修法（prior_bytes dict）有两处硬伤，都已实锤：内存峰值与上传闸耦合
            # （AVERY_MAX_TOTAL_UPLOAD_BYTES，最坏 ~32MiB/次写）；以及 key 口径分裂——
            # SQL 侧 COALESCE 只认 NULL 而 source_key 实际存 ''（INSERT 从不落 NULL），
            # Python 侧 `sd.source_key or sd.filename` 认空串，于是无 source_key 的文档
            # 回填必落空、bytes 照样被抹（arch-0802 的 roundtrip 全列守卫第一跑当场抓获，
            # 既有 bytes 钉子的 pg 腿同刻复红——它此前一直被离线反选静默跳过）。
            # 现在：同事务内先把原行 content 存进 ON COMMIT DROP 临时表（字节全程不出库，
            # 内存耦合消失——guards 那头想调多大都与本函数无关了），INSERT 后 UPDATE...FROM
            # 只回填**新行为 NULL**的格子；key 统一为 COALESCE(NULLIF(source_key,''), filename)，
            # 与 Python 侧 `or` 同义。🔴 只回填 NULL：真 ingest 带真 content，临时表不说话。
            conn.execute(
                "CREATE TEMP TABLE _prior_src_bytes ON COMMIT DROP AS "
                "SELECT DISTINCT ON (COALESCE(NULLIF(source_key, ''), filename)) "
                "       COALESCE(NULLIF(source_key, ''), filename) AS key, content, "
                # #90: the hash rides the SAME lifeboat as the bytes it digests — a rewritten row
                # whose caller had neither content nor hash (the get()->put() metadata round trip
                # before a divergence rewrite) gets BOTH backfilled from the prior row below.
                "       content_sha256 "
                "FROM avery.source_documents "
                "WHERE context_id = %s AND content IS NOT NULL "
                "ORDER BY COALESCE(NULLIF(source_key, ''), filename), idx DESC",
                (ctx.context_id,))
            # arch-0802 · 同类第二实例：materials.embedding 同样不在 get() 投影里——无 embedder
            # 的 put 会把已嵌入 context 的向量抹成 NULL（检索静默降级 keyword）。同一张方子。
            conn.execute(
                "CREATE TEMP TABLE _prior_mat_vecs ON COMMIT DROP AS "
                "SELECT DISTINCT ON (chunk_id) chunk_id, text, embedding "
                "FROM avery.materials "
                "WHERE context_id = %s AND embedding IS NOT NULL "
                "ORDER BY chunk_id, idx DESC",
                (ctx.context_id,))

            # re-put = replace — STILL the contract (a context is one atomic snapshot, never a merge
            # of two ingests; the caller hands the WHOLE desired state every time). #90 changes only
            # the IMPLEMENTATION: "delete everything, reinsert everything" became a per-table
            # POSITIONAL DIFF — compare the stored rows against the desired snapshot in idx order,
            # keep the untouched prefix, rewrite only from the first divergent row on. Why: the old
            # shape made the Nth 补传 rewrite the SUM of batches 1..N (bytea + vectors + text, the
            # measured 118→163→224s production slowdown, exploration.md 症状②); an append diverges
            # exactly at the old length, so it now writes ONLY the new rows. Worst case (a rewrite
            # from idx 0 — e.g. a file deletion reshuffling everything) degenerates to precisely the
            # old full-replace cost, never worse. The @needs_db gate pins this with xmin: rows before
            # the divergence keep their transaction id — not even a DELETE touched them.
            with conn.cursor() as cur:
                # entities — per (kind) positional diff; payload equality via _canon_payload so
                # asdict-vs-jsonb serialization accidents never masquerade as changes. Iterate
                # _ENTITY_KINDS (the set entities_kind_check allows) so the constant stays the one
                # place a new entity kind must be registered.
                by_kind = {"person": people, "project": projects,
                           "signal": signals, "playbook": playbooks, "conflict": conflicts,
                           "ruling": rulings}
                stored_by_kind: dict[str, list[str]] = {}
                for kind, payload in conn.execute(
                        "SELECT kind, payload FROM avery.entities WHERE context_id = %s "
                        "ORDER BY kind, idx", (ctx.context_id,)).fetchall():
                    stored_by_kind.setdefault(kind, []).append(self._canon_payload(payload))
                for kind in _ENTITY_KINDS:
                    desired = by_kind[kind]
                    desired_fp = [self._canon_payload(p) for p in desired]
                    stored_fp = stored_by_kind.get(kind, [])
                    div = self._first_divergence(stored_fp, desired_fp)
                    if div < len(stored_fp):
                        cur.execute(
                            "DELETE FROM avery.entities "
                            "WHERE context_id = %s AND kind = %s AND idx >= %s",
                            (ctx.context_id, kind, div))
                    cur.executemany(
                        "INSERT INTO avery.entities (context_id, kind, idx, payload) "
                        "VALUES (%s, %s, %s, %s)",
                        [(ctx.context_id, kind, i, Jsonb(desired[i]))
                         for i in range(div, len(desired))])

                # materials — positional diff on (chunk_id, text, source, doc_kind).
                mats = ctx.extraction.materials
                stored_mats = [
                    (mcid, mtext, msrc, mdk) for mcid, mtext, msrc, mdk in conn.execute(
                        "SELECT chunk_id, text, source, doc_kind FROM avery.materials "
                        "WHERE context_id = %s ORDER BY idx", (ctx.context_id,)).fetchall()]
                desired_mats = [(m.id, m.text, m.source, m.doc_kind) for m in mats]
                div = self._first_divergence(stored_mats, desired_mats)
                if div < len(stored_mats):
                    cur.execute(
                        "DELETE FROM avery.materials WHERE context_id = %s AND idx >= %s",
                        (ctx.context_id, div))
                cur.executemany(
                    "INSERT INTO avery.materials "
                    "(context_id, idx, chunk_id, text, source, doc_kind, embedding) "
                    "VALUES (%s, %s, %s, %s, %s, %s, %s::vector)",   # feat-031 fills embedding
                    # T2/#53：vecs 是 per-row Optional —— 行内 None = 「库里已有这块的向量」，
                    # 先落 NULL，交给下面的 _prior_mat_vecs 回填在库内补齐（向量不出库）。
                    # #90 之后回填只涉及 tail：前缀行连 DELETE 都没经历，向量原地未动。
                    [(ctx.context_id, i, mats[i].id, mats[i].text, mats[i].source, mats[i].doc_kind,
                      _vec_literal(vecs[i]) if vecs is not None and vecs[i] is not None else None)
                     for i in range(div, len(mats))])

                # memory_files — two rows, keyed (context_id, filename): write only what changed.
                # facts.md is a WHOLE-file materialization, so an append rewrites its one row in
                # full — that is the nature of a materialized file, not a diff failure; it is one
                # text row, not N bytea rows.
                stored_mem = dict(conn.execute(
                    "SELECT filename, content FROM avery.memory_files WHERE context_id = %s",
                    (ctx.context_id,)).fetchall())
                for fname, want in (("facts.md", facts), ("notes.md", notes)):
                    if stored_mem.get(fname) != want:
                        cur.execute(
                            "INSERT INTO avery.memory_files (context_id, filename, content) "
                            "VALUES (%s, %s, %s) "
                            "ON CONFLICT (context_id, filename) "
                            "DO UPDATE SET content = EXCLUDED.content",
                            (ctx.context_id, fname, want))

                # source_documents — positional diff on the metadata + content_sha256 (the bytes'
                # 64-hex stand-in: get() never pulls bytea, so equality is judged on the digest —
                # feat-032: the rows hold raw uploads (bytea + metadata), UNTRUSTED content that is
                # stored, served for download, never followed). An unchanged row is not rewritten,
                # which is what keeps its bytea safe WITHOUT the temp-table lifeboat; the lifeboat
                # below still guards every row that IS rewritten by a caller holding no bytes.
                stored_docs = [
                    (fn, sk, mime, sz, dk, st, sr,
                     ua.isoformat() if ua is not None else "", sha or "")
                    for fn, sk, mime, sz, dk, st, sr, ua, sha in conn.execute(
                        "SELECT filename, source_key, mime, size_bytes, doc_kind, status, "
                        "storage_ref, uploaded_at, content_sha256 "
                        "FROM avery.source_documents WHERE context_id = %s ORDER BY idx",
                        (ctx.context_id,)).fetchall()]
                desired_docs = [
                    (sd.filename, sd.source_key, sd.mime, sd.size_bytes, sd.doc_kind, sd.status,
                     sd.storage_ref, sd.uploaded_at or "", sd.content_sha256 or "")
                    for sd in ctx.source_documents]
                div = self._first_divergence(stored_docs, desired_docs)
                if div < len(stored_docs):
                    cur.execute(
                        "DELETE FROM avery.source_documents WHERE context_id = %s AND idx >= %s",
                        (ctx.context_id, div))
                cur.executemany(
                    "INSERT INTO avery.source_documents "
                    "(context_id, idx, filename, source_key, mime, size_bytes, doc_kind, status, "
                    " content, storage_ref, uploaded_at, content_sha256) "
                    "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, "
                    "        COALESCE(%s::timestamptz, now()), %s)",
                    [(ctx.context_id, i, sd.filename, sd.source_key, sd.mime, sd.size_bytes,
                      sd.doc_kind, sd.status,
                      # arch-0802：调用方给了字节就写字节；没给（get→put 往返恒 None）先落
                      # NULL，由下面的 UPDATE...FROM 在库内回填——字节不再过 Python。
                      sd.content,
                      sd.storage_ref, sd.uploaded_at or None, sd.content_sha256 or "")
                     for i, sd in ((j, ctx.source_documents[j])
                                   for j in range(div, len(ctx.source_documents)))])
                # arch-0802 · 库内回填（只补 NULL，绝不覆盖真值）。key 口径见上面临时表注释。
                cur.execute(
                    "UPDATE avery.source_documents sd SET content = pb.content "
                    "FROM _prior_src_bytes pb "
                    "WHERE sd.context_id = %s AND sd.content IS NULL "
                    "  AND COALESCE(NULLIF(sd.source_key, ''), sd.filename) = pb.key",
                    (ctx.context_id,))
                # #90 · the hash backfill, PARALLEL to the bytes one (same key, same only-fill-empty
                # discipline): a rewritten row whose caller had no bytes gets its digest back from
                # the prior row, so the idempotency map never loses a document to a metadata rewrite.
                cur.execute(
                    "UPDATE avery.source_documents sd SET content_sha256 = pb.content_sha256 "
                    "FROM _prior_src_bytes pb "
                    "WHERE sd.context_id = %s AND sd.content_sha256 = '' "
                    "  AND pb.content_sha256 <> '' "
                    "  AND COALESCE(NULLIF(sd.source_key, ''), sd.filename) = pb.key",
                    (ctx.context_id,))
                # chunk_id+text 双键：text 变了说明块真变了，不给旧向量（诚实降级）。
                # T2/#53 起本条兼任**复用**的落点：_material_vectors 对库里已有向量的块刻意
                # 落 NULL（per-row None 占位），正是靠这条 UPDATE...FROM 在库内原样补回——
                # 「CRUD/append 重嵌的成本问题」那张票就是这么修的，向量全程不出库。
                cur.execute(
                    "UPDATE avery.materials m SET embedding = pv.embedding "
                    "FROM _prior_mat_vecs pv "
                    "WHERE m.context_id = %s AND m.embedding IS NULL "
                    "  AND m.chunk_id = pv.chunk_id AND m.text = pv.text",
                    (ctx.context_id,))
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
            # #90: content_sha256 rides the metadata read (64 hex bytes — no "pull every file into
            # memory" concern). It is what existing_content_hashes() answers the idempotency
            # question from, and what keeps the hash surviving a get() -> put() round trip.
            srcdocs = conn.execute(
                "SELECT idx, filename, source_key, mime, size_bytes, doc_kind, status, storage_ref, "
                "uploaded_at, content_sha256 FROM avery.source_documents WHERE context_id = %s "
                "ORDER BY idx",
                (context_id,)).fetchall()

        extraction = ExtractionResult(
            people=[_entity(PersonEntity, _PERSON_FIELDS, pl) for k, pl in ents if k == "person"],
            projects=[_entity(ProjectEntity, _PROJECT_FIELDS, pl) for k, pl in ents if k == "project"],
            signals=[_entity(SignalEntity, _SIGNAL_FIELDS, pl) for k, pl in ents if k == "signal"],
            # rich-align-0722/08: SOP 方法卡随 context 往返（否则 pg-backed 生产 demo get() 会丢卡）。
            playbooks=[_entity(MethodCard, _PLAYBOOK_FIELDS, pl) for k, pl in ents if k == "playbook"],
            # T6/B2a: 冲突随 context 往返（否则 pg-backed 生产 get() 回来冲突全没了，而离线全绿）。
            conflicts=[_entity(FieldConflict, _CONFLICT_FIELDS, pl) for k, pl in ents
                       if k == "conflict"],
            # issue #93: 粒度闸裁决随 context 往返 —— 「这张卡为什么不见了」重启后的唯一答案。
            granularity=[_entity(Ruling, _RULING_FIELDS, pl) for k, pl in ents if k == "ruling"],
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
                storage_ref=sr, uploaded_at=ua.isoformat() if ua is not None else "", content=None,
                content_sha256=sha or "")
            for _idx, fn, sk, mime, sz, dk, st, sr, ua, sha in srcdocs]

        return CompanyContext(
            context_id=context_id, extraction=extraction, store=store, memory_dir=mem_dir,
            name=name, source_files=list(source_files), source_documents=source_documents,
            owner_token=owner_token or "")   # feat-038: NULL -> "" (a tokenless, pre-038 context)

    # --- input-side-0721 · 3A: clone (the one-click sample-team seam) --------------------------

    def clone_context(self, src_context_id: str, *, new_context_id: str,
                      new_owner_token: str, ephemeral: bool = True) -> bool:
        """The Postgres twin of ContextRegistry.clone_context — one transaction of SQL-level
        INSERT..SELECT row copies. Deliberately NOT get()+put() recomposition, which would
        ① re-embed the whole corpus (a second billable DashScope pass for identical vectors —
        the embedding column is copied verbatim instead) and ② silently DROP the raw upload
        bytes (get() never pulls bytea; the clone's file space would list files it cannot serve).
        Notes get FRESH ids (company_notes.id is globally unique) but keep created_at.
        No red-line re-scan: every copied row passed the storage door on its way in, and a
        byte-copy cannot manufacture new content. False = unknown source context.

        gc-demo-clones-0724: `ephemeral` (default True — the sole caller is /demo/claim minting a
        disposable guest twin) marks the clone for TTL garbage-collection (sweep_ephemeral). The
        SOURCE master keeps its own flag (a master built via put() is ephemeral=false), so cloning
        a master never marks the master; only the new twin is ephemeral."""
        self._ensure_schema()
        with self._connect() as conn, conn.transaction():
            row = conn.execute(
                "INSERT INTO avery.contexts (context_id, name, source_files, owner_token, ephemeral) "
                "SELECT %s, name, source_files, %s, %s FROM avery.contexts WHERE context_id = %s "
                "RETURNING context_id",
                (new_context_id, new_owner_token or None, ephemeral, src_context_id)).fetchone()
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
                # 🔴 uploaded_at 重打成 now()，不逐字继承（gap-design-0805 · B1，与内存版
                # ContextRegistry.clone_context 同口径——那边有完整理由）：母本内容寻址、一次
                # 铸成就常驻，逐字继承会让「资料多久没更新」在母本满 45 天后，对每一位刚领到
                # 示例团队、一个文件都没传过的访客整块判「需确认」。列顺序与上面的列表一一对应，
                # 改这里必须同时数两行。
                "INSERT INTO avery.source_documents "
                "(context_id, idx, filename, source_key, mime, size_bytes, doc_kind, status, "
                " content, storage_ref, uploaded_at, content_sha256) "
                "SELECT %s, idx, filename, source_key, mime, size_bytes, doc_kind, status, "
                " content, storage_ref, now(), content_sha256 "
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

    def sweep_ephemeral(self, *, older_than_hours: int, limit: int = 50) -> int:
        """gc-demo-clones-0724: garbage-collect stale demo guest clones. Deletes up to `limit`
        contexts that are (a) ephemeral — clone_context set the flag; masters/real uploads are
        false — AND (b) older than `older_than_hours` AND (c) NOT linked to any account. Returns the
        number deleted. The ON DELETE CASCADE from every child table takes each clone's
        entities/materials/memory/notes/... with it, so this one DELETE reclaims the whole footprint.

        NEVER touches a demo master (ctx_demo_*, built via put() -> ephemeral=false) or an
        account-linked context (the NOT EXISTS guard, belt-and-suspenders with link_account_context's
        ephemeral -> false). Runs under its own short lock_timeout/statement_timeout and a bounded
        LIMIT, so an opportunistic call on the /demo/claim path can never stall the claim.

        **OLDEST FIRST**（`ORDER BY created_at`）—— 一个有上限的 sweep 必须回答「这一批收哪几个」，
        而这是个**语义选择**，不该交给规划器。三条理由：
          ① 双胞胎对齐：内存孪生一直就是最旧优先（`registry.py` 的 `sorted(self._ephemeral_at...)`），
             pg 侧此前是无序 LIMIT —— 同一条被合约套双跑的缝，两边给的答案可以不同；
          ② GC 语义本来就该先收最旧的：积压时新克隆不该插队，回收顺序可预期；
          ③ 几乎免费：0011 的部分索引正是 `(created_at) WHERE ephemeral`，排序直接走它。
             实测（5000 行 ephemeral，`EXPLAIN (COSTS OFF)`）：
                 Limit -> Incremental Sort (Presorted Key: c.created_at)
                        -> Nested Loop Anti Join
                             -> Index Scan using contexts_ephemeral_created_idx
             索引同时承担过滤与排序；`context_id` 的 tie-break 只在 created_at 相等的那一小撮里
             增量排一下，代价可忽略。它保证「同一刻创建的两条」也有确定顺序 —— 不留任何一处
             「实际上不会发生所以无所谓」的缝，本条修的就是这种缝。

        ⚠ 这**不是** 2026-08-06 那次 `test_sweep_respects_the_batch_limit[postgres]` 变红的原因。
        那次的真因是**本机 Docker 容器时钟会来回跳 ~115 秒**：在「跳到未来」的窗口里建的行拿到
        未来的 `created_at`，`created_at < now()` 恒假，于是它对 sweep 隐身 ~115 秒。逻辑上也对得
        上：无序 LIMIT 只要有合格行就必删至少一条，返回 0 只能是 WHERE 一条都没匹配。排序与过滤是
        两件事，别把它们混成一条。（生产上同样成立：时钟向前跳一步，那一步之内建的克隆会短暂
        GC 隐身，之后自动恢复 —— TTL 是 48h 量级，无害，故不改这条谓词。）"""
        self._ensure_schema()
        hours = max(0, int(older_than_hours))
        batch = max(1, int(limit))
        with self._connect() as conn:
            conn.execute(f"SET lock_timeout = {_int_env('AVERY_BOOTSTRAP_LOCK_TIMEOUT_MS', 3000)}")
            conn.execute(f"SET statement_timeout = {_int_env('AVERY_BOOTSTRAP_STMT_TIMEOUT_MS', 30000)}")
            cur = conn.execute(
                "DELETE FROM avery.contexts WHERE context_id IN ("
                "  SELECT c.context_id FROM avery.contexts c"
                "  WHERE c.ephemeral"
                "    AND c.created_at < now() - make_interval(hours => %s)"
                "    AND NOT EXISTS (SELECT 1 FROM avery.account_contexts a"
                "                    WHERE a.context_id = c.context_id)"
                "  ORDER BY c.created_at, c.context_id"
                "  LIMIT %s)",
                (hours, batch))
            return cur.rowcount

    def is_ephemeral(self, context_id: str) -> bool:
        """T10（内存孪生见 registry.ContextRegistry.is_ephemeral）—— 这份 context 是一次性的
        克隆副本吗？读的就是 `sweep_ephemeral` 用来选收割对象的**同一列**，不是第二份口径。
        未知 id → False（不存在的东西不是「一次性的」，也不给存在性 oracle 一个新出口）。"""
        self._ensure_schema()
        with self._connect() as conn:
            row = conn.execute(
                "SELECT ephemeral FROM avery.contexts WHERE context_id = %s",
                (context_id,)).fetchone()
        return bool(row[0]) if row is not None and row[0] is not None else False

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

    def source_document_bytes_by_key(self, context_id: str, source_key: str) -> bytes | None:
        """issue #93 — one document's bytea, addressed by `source_key`. See the in-memory twin for
        why the re-judgment path must not address by position.

        🔴 The key expression is `COALESCE(NULLIF(source_key, ''), filename)` — byte-for-byte the
        SAME ruler as `put()`'s temp-table lifeboat and as Python's `sd.source_key or sd.filename`.
        A private rsplit/`source_key = %s` here would miss every document uploaded without a
        source_key (INSERT never writes NULL, it writes ''), and a missed document is not a 404 in
        this caller: it is a re-judgment that quietly gives up (or, if the caller were sloppier,
        one judged against an archive it cannot see).
        """
        key = (source_key or "").strip()
        if not key:
            return None
        self._ensure_schema()
        with self._connect() as conn:
            row = conn.execute(
                "SELECT content FROM avery.source_documents "
                "WHERE context_id = %s AND COALESCE(NULLIF(source_key, ''), filename) = %s "
                "ORDER BY idx LIMIT 1",
                (context_id, key)).fetchone()
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

    # --- issue #49: advise-run history — the postgres twin of the registry run seam ---------------
    # ⚠ 列序就是 `_advise_run_from_row` 的解包顺序 —— 加列一律**追加在末尾**。#78 加 thread_id
    # 时把这里从「SELECT 字面量 + 就地七元组解包」提成了常量 + 单点解包，理由与 _FORM_SUB_COLS
    # （:874-879）那次一模一样：question / title / locale / answer / thread_id 全是 text，插错
    # 位置是 text↔text 对调，**Postgres 不会吭声、pytest 也不会红**。列表分叉过一次就够了。

    _ADVISE_COLS = "id, created_at, question, title, locale, advice, answer, thread_id"

    @staticmethod
    def _advise_run_from_row(row) -> AdviseRun:
        rid, ca, q, t, loc, adv, ans, tid = row
        return AdviseRun(id=rid, created_at=ca.isoformat(), question=q, title=t or "",
                         locale=loc or "en", advice=adv, answer=ans or "",
                         thread_id=tid or "")

    def append_advise_run(self, context_id: str, question: str, *, title: str = "",
                          locale: str = "en", advice: dict | None = None,
                          answer: str = "", thread_id: str = "") -> AdviseRun:
        """Persist one completed room Q&A to avery.advise_runs. No content gate BY DESIGN (see the
        in-memory twin's docstring: the service hook only calls this for redline_passed manifests,
        and the question is self-facing). The FK to avery.contexts refuses unknown contexts by
        construction; the ON DELETE CASCADE ties a run's lifetime to its context (ephemeral GC).

        issue #78: 空 thread_id 落成 **NULL**（沿用本文件 title/answer 的空串->NULL 惯例）。
        这与「NULL = #78 之前的存量行」不冲突——两者读回来都是空串、读侧都按「自成一场的单轮」
        呈现，是同一个语义的两种来路，不需要分辨。"""
        from psycopg.types.json import Jsonb
        self._ensure_schema()
        run_id = new_run_id()
        with self._connect() as conn, conn.transaction():
            row = conn.execute(
                "INSERT INTO avery.advise_runs "
                "(id, context_id, question, title, locale, advice, answer, thread_id) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s, %s) RETURNING created_at",
                (run_id, context_id, question, title or None, locale or "en",
                 Jsonb(advice) if advice is not None else None, answer or None,
                 thread_id or None)).fetchone()
        created_at = row[0]
        return AdviseRun(id=run_id, created_at=created_at.isoformat(), question=question,
                         title=title or "", locale=locale or "en", advice=advice,
                         answer=answer or "", thread_id=thread_id or "")

    def list_advise_runs(self, context_id: str, limit: int = 50) -> list[AdviseRun]:
        """This company's persisted Q&A, NEWEST FIRST, capped (ORDER BY seq DESC — same
        deterministic ordering rationale as list_notes)."""
        self._ensure_schema()
        with self._connect() as conn:
            rows = conn.execute(
                f"SELECT {self._ADVISE_COLS} "
                "FROM avery.advise_runs WHERE context_id = %s ORDER BY seq DESC LIMIT %s",
                (context_id, max(1, int(limit)))).fetchall()
        return [self._advise_run_from_row(r) for r in rows]

    def list_advise_threads(self, context_id: str, limit: int = 20) -> list[AdviseThread]:
        """issue #78 — 这家公司的对话**按场分组**：场按最近活动新->旧，场内按 seq 升序。

        🔴 `limit` 数的是**场**，不是行（与 list_advise_runs 的 limit 是两种单位）。所以这里是
        两趟：先只查「最近 N 个场」的 key，再把这些场的行整批取回。一趟带 LIMIT 的写法会把最老
        那一场腰斩成半截对话，而调用方分辨不出「这场只有 3 轮」和「这场有 7 轮只给了 3 轮」。

        分组键：`COALESCE(thread_id, 'run:' || id)` —— 无场归属的行（NULL = #78 之前的存量行）
        各自成一场，绝不并成假对话。冒号保证这个合成键撞不上任何真 thread_id：形状闸
        （service/threads.py）只放行 [A-Za-z0-9_-]。⚠ 别把前缀写成 NUL 字节那种「肯定不冲突」的
        哨兵——**Postgres 的 text 不允许 \\x00**，`E'\\x00...'` 是直接报错不是安全。"""
        self._ensure_schema()
        with self._connect() as conn:
            keys = conn.execute(
                "SELECT COALESCE(thread_id, 'run:' || id) AS k, max(seq) AS last_seq "
                "FROM avery.advise_runs WHERE context_id = %s "
                "GROUP BY k ORDER BY last_seq DESC LIMIT %s",
                (context_id, max(1, int(limit)))).fetchall()
            if not keys:
                return []
            wanted = [k for k, _ in keys]
            rows = conn.execute(
                f"SELECT {self._ADVISE_COLS}, COALESCE(thread_id, 'run:' || id) AS k "
                "FROM avery.advise_runs WHERE context_id = %s AND "
                "COALESCE(thread_id, 'run:' || id) = ANY(%s) ORDER BY seq ASC",
                (context_id, wanted)).fetchall()
        grouped: dict[str, list[AdviseRun]] = {}
        for row in rows:
            grouped.setdefault(row[-1], []).append(self._advise_run_from_row(row[:-1]))
        return [AdviseThread(thread_id=grouped[k][0].thread_id, runs=grouped[k])
                for k in wanted if k in grouped]

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

    # --- T1 · form-backend-a1a: 常驻表单存储 —— registry 表单 seam 的 postgres 双胞胎 -------------
    # 表在 db/migrations/0013_form_templates.sql。⚠ 这两组方法存的是「表单这个采集器」，**不是**
    # 资料的第二条存储通道：一次提交在提交那一刻被 form_append 渲染成一份与上传文件平权的
    # SourceDocument，走 get→原地 append→put 进 context（T2）。

    _FORM_TPL_COLS = "context_id, id, title, fields, active, created_at"
    # ⚠ 列序就是 `_form_submission_from_row` 的解包顺序 —— 加列一律**追加在末尾**，改中间等于
    # 把两个字段的值对调，而两个都是 text，Postgres 与 Python 都不会吭一声。
    _FORM_SUB_COLS = ("id, context_id, template_id, person_id, person_name, period, "
                      "share_token, answers, submitted_at, created_at, expires_at, project_ref, "
                      "auto_key")

    @staticmethod
    def _form_template_from_row(row):
        from .form import FormField, FormTemplate
        context_id, tid, title, fields, active, created_at = row
        known = set(FormField.__dataclass_fields__)
        return FormTemplate(
            context_id=context_id, id=tid, title=title or "",
            fields=[FormField(**{k: v for k, v in f.items() if k in known})
                    for f in (fields or []) if isinstance(f, dict)],
            active=bool(active),
            created_at=created_at.isoformat() if created_at is not None else "")

    @staticmethod
    def _form_submission_from_row(row):
        from .form import FormSubmission
        (sid, context_id, template_id, person_id, person_name, period, share_token,
         answers, submitted_at, created_at, expires_at, project_ref, auto_key) = row
        return FormSubmission(
            id=sid, context_id=context_id, template_id=template_id,
            person_id=person_id or "", person_name=person_name or "", period=period or "",
            project_ref=project_ref or "", share_token=share_token or "",
            auto_key=auto_key or "",
            answers=list(answers) if answers is not None else None,
            submitted_at=submitted_at.isoformat() if submitted_at is not None else "",
            created_at=created_at.isoformat() if created_at is not None else "",
            expires_at=expires_at.isoformat() if expires_at is not None else "")

    def put_form_template(self, template):
        """Persist one template snapshot (create or update). The write-side red-line gate runs BEFORE
        any INSERT (a person-scoring 题面 raises ValueError — nothing touches the DB), same storage-door
        discipline as put_ask. Fields ride as one jsonb document (the 字段描述 the renderer reads)."""
        from dataclasses import asdict
        from psycopg.types.json import Jsonb
        from .form import gate_form_red_line
        gate_form_red_line(template)
        self._ensure_schema()
        fields = [asdict(f) for f in template.fields]
        with self._connect() as conn, conn.transaction():
            conn.execute(
                "INSERT INTO avery.form_templates (context_id, id, title, fields, active, "
                " created_at) "
                "VALUES (%s, %s, %s, %s, %s, COALESCE(%s::timestamptz, now())) "
                "ON CONFLICT (context_id, id) DO UPDATE SET "
                "  title = EXCLUDED.title, fields = EXCLUDED.fields, active = EXCLUDED.active",
                (template.context_id, template.id, template.title, Jsonb(fields),
                 bool(template.active), template.created_at or None))
        return self.get_form_template(template.context_id, template.id)

    def get_form_template(self, context_id: str, template_id: str):
        self._ensure_schema()
        with self._connect() as conn:
            row = conn.execute(
                f"SELECT {self._FORM_TPL_COLS} FROM avery.form_templates "
                "WHERE context_id = %s AND id = %s", (context_id, template_id)).fetchone()
        return self._form_template_from_row(row) if row is not None else None

    def list_form_templates(self, context_id: str) -> list:
        """This company's templates, oldest first (built-ins are minted first, so they lead).
        Inactive ones are INCLUDED — 「不再发新链接」和「从库里消失」不是一回事。"""
        self._ensure_schema()
        with self._connect() as conn:
            rows = conn.execute(
                f"SELECT {self._FORM_TPL_COLS} FROM avery.form_templates "
                "WHERE context_id = %s ORDER BY created_at, id", (context_id,)).fetchall()
        return [self._form_template_from_row(r) for r in rows]

    def put_form_submission(self, submission):
        """Persist one submission snapshot (minted link, or a re-put). Storage-safety gate only —
        answers are the employee's OWN words and are deliberately NOT red-line scanned (ADR-0023);
        the guarantee is placement: they hang off (template, submission), never off avery.entities."""
        from .form import gate_submission_storage_safety
        gate_submission_storage_safety(submission)
        self._ensure_schema()
        with self._connect() as conn, conn.transaction():
            conn.execute(self._FORM_SUB_INSERT + "ON CONFLICT (id) DO UPDATE SET "
                         "  template_id = EXCLUDED.template_id, person_id = EXCLUDED.person_id, "
                         "  person_name = EXCLUDED.person_name, period = EXCLUDED.period, "
                         "  share_token = EXCLUDED.share_token, answers = EXCLUDED.answers, "
                         "  submitted_at = EXCLUDED.submitted_at, expires_at = EXCLUDED.expires_at, "
                         "  project_ref = EXCLUDED.project_ref, auto_key = EXCLUDED.auto_key",
                         self._form_sub_params(submission))
        return self.get_form_submission(submission.id)

    # 两条写路径（`put_form_submission` 覆盖式 upsert / `put_form_submission_if_absent` 幂等落行）
    # 共用同一句 INSERT 与同一份参数打包 —— 列表分叉过一次就够了：`_FORM_SUB_COLS` 的注释里那句
    # 「加列一律追加在末尾」讲的正是列序错位不会有任何一层吭声。
    _FORM_SUB_INSERT = (
        "INSERT INTO avery.form_submissions (id, context_id, template_id, person_id, "
        " person_name, period, share_token, answers, submitted_at, created_at, expires_at, "
        " project_ref, auto_key) "
        "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s::timestamptz, "
        "        COALESCE(%s::timestamptz, now()), "
        "        COALESCE(%s::timestamptz, now() + interval '7 days'), %s, %s) ")

    @staticmethod
    def _form_sub_params(submission) -> tuple:
        from psycopg.types.json import Jsonb
        return (submission.id, submission.context_id, submission.template_id,
                submission.person_id or "", submission.person_name,
                submission.period or "", submission.share_token or None,
                Jsonb(submission.answers) if submission.answers is not None else None,
                submission.submitted_at or None,
                submission.created_at or None, submission.expires_at or None,
                submission.project_ref or "",
                # 🔴 空串必须落成 SQL NULL，不是 ''：0015 那条唯一索引的 `WHERE auto_key IS NOT NULL`
                # 谓词认的是 NULL。存 '' 的话每一条**手动**铸的链都会带着同一个 '' 进索引，
                # 于是经理第二次点「生成本周链接」会撞唯一约束——正好把本票明令不许动的那条
                # 行为（重复铸链＝再发一轮）废掉。
                (submission.auto_key or "").strip() or None)

    def get_form_submission(self, submission_id: str):
        self._ensure_schema()
        with self._connect() as conn:
            row = conn.execute(
                f"SELECT {self._FORM_SUB_COLS} FROM avery.form_submissions WHERE id = %s",
                (submission_id,)).fetchone()
        return self._form_submission_from_row(row) if row is not None else None

    def get_form_submission_by_token(self, share_token: str):
        """Resolve one employee link -> that submission, or None. One indexed lookup — the token is
        the whole credential (no enumeration path)."""
        if not share_token:
            return None
        self._ensure_schema()
        with self._connect() as conn:
            row = conn.execute(
                f"SELECT {self._FORM_SUB_COLS} FROM avery.form_submissions WHERE share_token = %s",
                (share_token,)).fetchone()
        return self._form_submission_from_row(row) if row is not None else None

    def list_form_submissions(self, context_id: str, template_id: str | None = None,
                              limit: int = 200) -> list:
        """This company's submissions, NEWEST FIRST, optionally one template's. 「谁交了/谁没交」的
        唯一真相：铸链即建行，所以没交的人是 answers IS NULL 的行，不是缺席。"""
        self._ensure_schema()
        sql = (f"SELECT {self._FORM_SUB_COLS} FROM avery.form_submissions WHERE context_id = %s")
        params: list = [context_id]
        if template_id is not None:
            sql += " AND template_id = %s"
            params.append(template_id)
        sql += " ORDER BY created_at DESC, id DESC LIMIT %s"
        params.append(max(1, int(limit)))
        with self._connect() as conn:
            rows = conn.execute(sql, tuple(params)).fetchall()
        return [self._form_submission_from_row(r) for r in rows]

    # --- T9 · gap2 #58：自动补铸要的两问一写 ------------------------------------------------

    def list_form_submissions_in_period(self, context_id: str, template_id: str,
                                        period: str) -> list:
        """这家公司这张模板这一期的**全部**行——刻意没有 LIMIT。

        `list_form_submissions` 那条有 limit（默认 200 / 上限 500），拿它回答「本期有没有行」
        会在重铸历史多的公司上被截断成「没有」，而那句错答的代价是给全公司每个人再发一条链接。
        判据要多少行就读多少行。走 0015 的 (context_id, template_id, period) 索引。"""
        self._ensure_schema()
        with self._connect() as conn:
            rows = conn.execute(
                f"SELECT {self._FORM_SUB_COLS} FROM avery.form_submissions "
                "WHERE context_id = %s AND template_id = %s AND period = %s "
                "ORDER BY created_at, id", (context_id, template_id, period)).fetchall()
        return [self._form_submission_from_row(r) for r in rows]

    def latest_form_period_before(self, context_id: str, template_id: str,
                                  period: str) -> str | None:
        """这张模板在 `period` 之前最近的一个有行的周期，没有则 None。

        比较交给 Postgres 的文本序，与内存双胞胎的 Python 字符串序同解：ISO 周 `YYYY-Www` 的
        字典序即时间序（年在前、周补零两位）。`period <> ''` 把没写周期的历史行挡在外面——
        拿它当「上期」等于照着一份没有周期语义的名单发链接。"""
        self._ensure_schema()
        with self._connect() as conn:
            row = conn.execute(
                "SELECT max(period) FROM avery.form_submissions "
                "WHERE context_id = %s AND template_id = %s AND period <> '' AND period < %s",
                (context_id, template_id, period)).fetchone()
        return (row[0] or None) if row is not None else None

    def put_form_submission_if_absent(self, submission):
        """自动补铸专用的写：`auto_key` 没被占则落行并返回它，已被占则返回 **None**（绝不覆盖）。

        🔴 这就是护栏本体，而且它是**事务级**的：`ON CONFLICT ... DO NOTHING` 撞的是 0015 那条
        唯一索引，所以两个并发请求各自查到「本期没有行」再各自 INSERT 时，仍然只有一条能活。
        先查后插挡不住那一幕（两边都查到空）——护栏必须在库上，Python 里那道只是省一次往返。

        手动铸链完全不走这条路（`put_form_submission` 照旧），而且手动行的 auto_key 落成 NULL、
        连索引都不进，所以「重复调用等于再发一轮」一个字节没变。"""
        from .form import gate_submission_storage_safety
        if not (submission.auto_key or "").strip():
            raise ValueError("put_form_submission_if_absent needs a non-empty auto_key")
        gate_submission_storage_safety(submission)
        self._ensure_schema()
        with self._connect() as conn, conn.transaction():
            row = conn.execute(
                # 🔴 `WHERE auto_key IS NOT NULL` 不是装饰：0015 那条是**部分**唯一索引，
                # Postgres 只有在 ON CONFLICT 的推断子句里同样写出谓词时才认得出该用哪条索引；
                # 漏掉它会当场 InvalidColumnReference（"no unique or exclusion constraint
                # matching the ON CONFLICT specification"），不是静默退化。
                self._FORM_SUB_INSERT + "ON CONFLICT (context_id, auto_key) "
                                        "WHERE auto_key IS NOT NULL DO NOTHING "
                                        "RETURNING id",
                self._form_sub_params(submission)).fetchone()
        if row is None:
            return None
        return self.get_form_submission(submission.id)

    def record_form_answers(self, share_token: str, answers: list,
                            submitted_at: str) -> str:
        """The answer-once lock, ATOMIC in SQL: the UPDATE lands only where submitted_at IS NULL, so
        two racing submits can never both write ('ok' / 'already' / 'unknown'). Same shape as
        record_answer — 证据必须稳得住，重复提交不覆盖首答（PRD Q8 的同一条纪律）。"""
        from psycopg.types.json import Jsonb
        if not share_token:
            return "unknown"
        self._ensure_schema()
        with self._connect() as conn, conn.transaction():
            row = conn.execute(
                "UPDATE avery.form_submissions SET answers = %s, submitted_at = %s::timestamptz "
                "WHERE share_token = %s AND submitted_at IS NULL RETURNING id",
                (Jsonb(list(answers)), submitted_at, share_token)).fetchone()
            if row is None:
                exists = conn.execute(
                    "SELECT 1 FROM avery.form_submissions WHERE share_token = %s",
                    (share_token,)).fetchone()
                return "already" if exists else "unknown"
        return "ok"

    def expire_form_submission(self, submission_id: str, at_iso: str) -> str:
        """T9 · 作废一条还没交的链接 = 把 expires_at 拨到此刻。'ok' / 'already' / 'unknown'。

        与 `record_form_answers` 同一形状的原子写：UPDATE 只落在 `submitted_at IS NULL` 的那一行，
        所以「员工正在按提交、经理同时点作废」这一幕里，**答案永远赢**——先落地的提交把这一行
        锁成终态，作废拿到 'already' 而不是把一条已经交上来的证据改成过期。
        （已提交是终态，过了期也仍然是 submitted：`form.effective_submission_status`。）"""
        if not submission_id:
            return "unknown"
        self._ensure_schema()
        with self._connect() as conn, conn.transaction():
            row = conn.execute(
                "UPDATE avery.form_submissions SET expires_at = %s::timestamptz "
                "WHERE id = %s AND submitted_at IS NULL RETURNING id",
                (at_iso, submission_id)).fetchone()
            if row is None:
                exists = conn.execute(
                    "SELECT 1 FROM avery.form_submissions WHERE id = %s",
                    (submission_id,)).fetchone()
                return "already" if exists else "unknown"
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
                # gc-demo-clones-0724: a context now bound to THIS account is a real owned workspace,
                # never GC'd — clear the ephemeral flag (only when the link actually landed for this
                # user, so a losing race against another owner does not touch their row).
                conn.execute(
                    "UPDATE avery.contexts SET ephemeral = false WHERE context_id = %s "
                    "AND EXISTS (SELECT 1 FROM avery.account_contexts a "
                    "            WHERE a.context_id = %s AND a.user_id = %s)",
                    (context_id, context_id, user_id))
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

    # --- #90 · async deposit (the pg twin — semantics live on the in-memory docstrings) ----------

    _JOB_COLS = "id, context_id, kind, status, reason, extraction_mode, file_keys, created_at, updated_at"

    @staticmethod
    def _job_from_row(row) -> "IngestJob":
        from .registry import IngestJob
        jid, cid, kind, status, reason, mode, keys, ca, ua = row
        return IngestJob(id=jid, context_id=cid, kind=kind, status=status, reason=reason or "",
                         extraction_mode=mode or "", file_keys=list(keys or []),
                         created_at=ca.isoformat() if ca is not None else "",
                         updated_at=ua.isoformat() if ua is not None else "")

    @staticmethod
    def _assert_deposit_no_control_chars(source_documents: list[SourceDocument]) -> None:
        """feat-030 P3 for the deposit door: the deposited TEXT columns must be NUL-free (a NUL is
        illegal in a Postgres text value — an opaque driver crash otherwise). Bytea `content` is
        exempt (a NUL there is legal and preserved). Same wording as put()'s guard so the endpoint
        maps it onto the same clean 422."""
        blobs: list[str] = []
        for sd in source_documents:
            blobs += [sd.filename, sd.source_key, sd.mime, sd.storage_ref]
        if any("\x00" in (b or "") for b in blobs):
            raise ValueError(
                "unsupported control character (NUL / 0x00) in the upload — cannot be stored")

    @staticmethod
    def _ensure_doc_hashes(source_documents: list[SourceDocument]) -> None:
        import hashlib
        for sd in source_documents:
            if sd.content is not None and not sd.content_sha256:
                sd.content_sha256 = hashlib.sha256(sd.content).hexdigest()

    _SRC_DOC_INSERT = (
        "INSERT INTO avery.source_documents "
        "(context_id, idx, filename, source_key, mime, size_bytes, doc_kind, status, "
        " content, storage_ref, uploaded_at, content_sha256) "
        "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, "
        "        COALESCE(%s::timestamptz, now()), %s)")

    def _src_doc_params(self, context_id: str, idx: int, sd: SourceDocument) -> tuple:
        return (context_id, idx, sd.filename, sd.source_key, sd.mime, sd.size_bytes,
                sd.doc_kind, sd.status, sd.content, sd.storage_ref,
                sd.uploaded_at or None, sd.content_sha256 or "")

    def deposit_new_context(self, *, context_id: str, name: str, owner_token: str,
                            source_documents: list[SourceDocument], job: "IngestJob") -> None:
        """#90 · ONE transaction: skeleton context row + 'reading' file rows (bytes included) +
        empty-materialization memory_files + the queued job. The owner_token is durable from this
        moment — a dropped connection no longer orphans the archive (the #0812 暗伤①′)."""
        from psycopg.types.json import Jsonb
        self._assert_deposit_no_control_chars(source_documents)
        self._ensure_doc_hashes(source_documents)
        self._ensure_schema()
        # The skeleton's facts/notes are the EMPTY materialization (the #86 empty_context product,
        # byte-identical across both twins) — a GET before the worker lands must read a coherent
        # empty world, not missing files.
        mem_dir = self._root() / context_id
        materialize_memory(ExtractionResult(), mem_dir)
        facts = (mem_dir / "facts.md").read_text(encoding="utf-8")
        notes = (mem_dir / "notes.md").read_text(encoding="utf-8")
        with self._connect() as conn, conn.transaction():
            conn.execute(
                "INSERT INTO avery.contexts (context_id, name, source_files, owner_token) "
                "VALUES (%s, %s, %s, %s)",
                (context_id, name, Jsonb([]), owner_token or None))
            with conn.cursor() as cur:
                cur.executemany(
                    self._SRC_DOC_INSERT,
                    [self._src_doc_params(context_id, i, sd)
                     for i, sd in enumerate(source_documents)])
                cur.executemany(
                    "INSERT INTO avery.memory_files (context_id, filename, content) "
                    "VALUES (%s, %s, %s)",
                    [(context_id, "facts.md", facts), (context_id, "notes.md", notes)])
            conn.execute(
                "INSERT INTO avery.ingest_jobs (id, context_id, kind, status, file_keys) "
                "VALUES (%s, %s, %s, 'queued', %s)",
                (job.id, context_id, job.kind, Jsonb(list(job.file_keys))))

    def deposit_append(self, context_id: str, source_documents: list[SourceDocument],
                       job: "IngestJob") -> None:
        """#90 · ONE transaction: 'reading' file rows appended after the existing manifest + the
        queued job. KeyError = unknown context (the endpoint's opaque 404). The advisory xact lock
        serializes concurrent deposits into the SAME context — two racing 补传 would otherwise
        compute the same MAX(idx)+1 and collide on the (context_id, idx) primary key."""
        from psycopg.types.json import Jsonb
        self._assert_deposit_no_control_chars(source_documents)
        self._ensure_doc_hashes(source_documents)
        self._ensure_schema()
        with self._connect() as conn, conn.transaction():
            conn.execute("SELECT pg_advisory_xact_lock(hashtext(%s))", (context_id,))
            exists = conn.execute(
                "SELECT 1 FROM avery.contexts WHERE context_id = %s", (context_id,)).fetchone()
            if exists is None:
                raise KeyError(context_id)
            base = conn.execute(
                "SELECT COALESCE(MAX(idx) + 1, 0) FROM avery.source_documents "
                "WHERE context_id = %s", (context_id,)).fetchone()[0]
            with conn.cursor() as cur:
                cur.executemany(
                    self._SRC_DOC_INSERT,
                    [self._src_doc_params(context_id, base + i, sd)
                     for i, sd in enumerate(source_documents)])
            conn.execute(
                "INSERT INTO avery.ingest_jobs (id, context_id, kind, status, file_keys) "
                "VALUES (%s, %s, %s, 'queued', %s)",
                (job.id, context_id, job.kind, Jsonb(list(job.file_keys))))

    def claim_next_ingest_job(self) -> "IngestJob | None":
        """Atomically claim the OLDEST queued job (queued -> processing), or None. FOR UPDATE SKIP
        LOCKED keeps two claimers (the worker thread + a test driving run_pending_jobs) from ever
        double-executing one job — the loser simply sees the next row or none."""
        self._ensure_schema()
        with self._connect() as conn, conn.transaction():
            row = conn.execute(
                "UPDATE avery.ingest_jobs SET status = 'processing', updated_at = now() "
                "WHERE id = (SELECT id FROM avery.ingest_jobs WHERE status = 'queued' "
                "            ORDER BY created_at, id LIMIT 1 FOR UPDATE SKIP LOCKED) "
                f"RETURNING {self._JOB_COLS}").fetchone()
        return self._job_from_row(row) if row is not None else None

    def finish_ingest_job(self, job_id: str, *, status: str, reason: str = "",
                          extraction_mode: str = "") -> None:
        if status not in ("done", "failed"):
            raise ValueError(f"finish_ingest_job wants 'done' or 'failed', got {status!r}")
        self._ensure_schema()
        with self._connect() as conn, conn.transaction():
            row = conn.execute(
                "UPDATE avery.ingest_jobs SET status = %s, reason = %s, extraction_mode = %s, "
                "updated_at = now() WHERE id = %s RETURNING id",
                (status, reason or "", extraction_mode or "", job_id)).fetchone()
        if row is None:
            raise KeyError(job_id)

    def latest_ingest_job(self, context_id: str) -> "IngestJob | None":
        self._ensure_schema()
        with self._connect() as conn:
            row = conn.execute(
                f"SELECT {self._JOB_COLS} FROM avery.ingest_jobs WHERE context_id = %s "
                "ORDER BY created_at DESC, id DESC LIMIT 1", (context_id,)).fetchone()
        return self._job_from_row(row) if row is not None else None

    def recover_orphan_ingest_jobs(self) -> int:
        """#90 · startup orphan recovery (semantics on the in-memory twin's docstring): every
        `processing` row at process start belonged to a worker that died mid-flight — mark it
        failed and drop its still-'reading' file rows. `queued` rows are NOT touched: their bytes
        are already in the DB and the worker will simply run them — THE restart answer the pure
        in-memory `_BUILD_LOCK` never had."""
        self._ensure_schema()
        recovered = 0
        with self._connect() as conn, conn.transaction():
            orphans = conn.execute(
                "UPDATE avery.ingest_jobs SET status = 'failed', reason = 'server restarted', "
                "updated_at = now() WHERE status = 'processing' "
                "RETURNING context_id, file_keys").fetchall()
            for context_id, file_keys in orphans:
                keys = [k for k in (file_keys or []) if k]
                if keys:
                    conn.execute(
                        "DELETE FROM avery.source_documents "
                        "WHERE context_id = %s AND status = 'reading' "
                        "  AND COALESCE(NULLIF(source_key, ''), filename) = ANY(%s)",
                        (context_id, keys))
                recovered += 1
        return recovered

    def empty_context(self, context_id: str) -> bool:
        """#86 · `ContextRegistry.empty_context` 的 Postgres 双胞胎——清掉这家公司上传来的一切，
        **`avery.contexts` 那一行几乎原地不动**（`context_id` / `name` / `owner_token`
        一个字节不改；`ephemeral` 是 #88 加的唯一例外，见下面④）。语义、保留清单、以及
        「留着答卷 = 清空不会自己保持为空」那颗雷，全部见内存腿那份 docstring，
        这里只记 pg 侧独有的四条。

        🔴 **① 不许用 `put()` 凑数**，哪怕把 ctx 清空了再 put 看上去也能达到同一个结果。
        `put()` 是「快照替换（#90 起按 positional diff 实现）+ 在库内回填」：它先把
        `_prior_src_bytes` / `_prior_mat_vecs` 两张临时表装满旧字节与旧向量，再按分歧点
        DELETE+INSERT，最后 `UPDATE ... FROM` 把重写行里为 NULL 的格子补回去。
        空 ctx 之所以清得空，靠的是「分歧点=0 → 全删 + 回填匹配不到新行」这串巧合，不是靠语义。
        那两张临时表的存在理由正是「让数据活下来」，把销毁类动作架在它上面，
        下一次有人给回填加一条「行没了也补一条回来」的兜底，清空就会静默地不再清空，而没有一道门会红。
        显式 DELETE 是**说得出口的**空。

        🔴 **② `memory_files` 写的是空抽取的重物化结果，不是删行**。`get()` 对缺行读作 `""`，
        而内存腿走的是 `materialize_memory(空)`——那会写下两行标题（`# Company facts …`）。
        两条腿必须逐字节同结果，否则 `test_registry_contract` 的 impl 参数化跑到 pg 那一遍就会
        以「facts.md 内容不一致」的形态红——而那是真分歧，不是测试太严。

        🔴 **③ `granularity` 不需要单独一句 DELETE**（口径 2026-08-12 · #93 起变了，结论没变）：
        它现在**真的落库**了（`kind='ruling'` 的 entities 行），而下面那句
        `DELETE FROM avery.entities` 是按 context 整片删的，不点名 kind——所以裁决记录跟着一起走。
        ⚠ 这正是那句 DELETE **不许**加 `AND kind IN (…)` 的理由：一加，下一个新 kind 就会在
        「清空之后还剩几行」这件事上静默地活下来。

        🔴 **④ `ephemeral` 清成 false（#88「清空＝这份档案从此归你」）**。为什么这么做见内存腿
        的 docstring；pg 侧要多记一句：这一列**不能**跟 `source_files` 挤进同一句 UPDATE 的
        SET 里草草带过——它改的是**档案的身份**（GC 收不收它），和「清单空了」不是一回事。
        单独一句、带自己的注释，下一个改清单逻辑的人才不会顺手把它一起改掉。
        与 `link_account_context` 里那句 `SET ephemeral = false` 是同一条判断的两个触发点；
        两处都动过之后 `sweep_ephemeral` 的选行口径（`WHERE c.ephemeral`）一个字没变。
        """
        self._ensure_schema()
        with self._connect() as conn:
            exists = conn.execute(
                "SELECT 1 FROM avery.contexts WHERE context_id = %s", (context_id,)).fetchone()
        if exists is None:
            return False

        # 空档案的 facts.md / notes.md —— 与内存腿逐字节同一个产物（理由见 ②）。落盘也顺手做了：
        # 本进程后续的 recall 直接读这个目录，不必等下一次 get() 去比对刷新。
        mem_dir = self._root() / context_id
        materialize_memory(ExtractionResult(), mem_dir)
        facts = (mem_dir / "facts.md").read_text(encoding="utf-8")
        notes = (mem_dir / "notes.md").read_text(encoding="utf-8")

        from psycopg.types.json import Jsonb
        with self._connect() as conn, conn.transaction():
            # 文件与文件推出来的一切。四张表逐条点名——`avery.entities` 一句就带走全部六类
            # （person/project/signal/playbook/conflict/ruling），它们同表不同 kind。
            conn.execute("DELETE FROM avery.entities WHERE context_id = %s", (context_id,))
            conn.execute("DELETE FROM avery.materials WHERE context_id = %s", (context_id,))
            conn.execute("DELETE FROM avery.source_documents WHERE context_id = %s", (context_id,))
            conn.execute("DELETE FROM avery.memory_files WHERE context_id = %s", (context_id,))
            with conn.cursor() as cur:
                cur.executemany(
                    "INSERT INTO avery.memory_files (context_id, filename, content) "
                    "VALUES (%s, %s, %s)",
                    [(context_id, "facts.md", facts), (context_id, "notes.md", notes)])
            # 清单也要空。⚠ 只动 source_files 与 updated_at —— name / owner_token
            # 是**档案的身份**，本方法的全部意义就是它们活下来。
            conn.execute(
                "UPDATE avery.contexts SET source_files = %s, updated_at = now() "
                "WHERE context_id = %s", (Jsonb([]), context_id))
            # #88 · 清空即认领（理由见 docstring ④）。刻意单独一句：它改的是档案的身份，
            # 不是清单内容。对本来就 ephemeral=false 的档案这是一次无操作。
            conn.execute(
                "UPDATE avery.contexts SET ephemeral = false WHERE context_id = %s",
                (context_id,))
        return True

    def delete(self, context_id: str) -> None:
        """Remove one context (entities/materials/memory cascade). Test + ops hygiene.

        ⚠ 别把它当「清空」用（#86）：它删的是 `avery.contexts` **那一行本身**，`context_id` 与
        `owner_token` 跟着一起没——正好是 `empty_context()` 的反面。"""
        self._ensure_schema()
        with self._connect() as conn:
            conn.execute("DELETE FROM avery.contexts WHERE context_id = %s", (context_id,))

    def clear(self) -> None:
        """Drop ALL contexts — the in-memory API parity call. Test hygiene against a disposable
        local DB; NEVER wire this to a shared/production database path."""
        self._ensure_schema()
        with self._connect() as conn:
            conn.execute("DELETE FROM avery.contexts")
