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

import mimetypes
import secrets
import tempfile
from dataclasses import asdict
from pathlib import Path
from urllib.parse import quote

from fastapi import APIRouter, Header, HTTPException, UploadFile
from fastapi import File
from fastapi import Response
from starlette.concurrency import run_in_threadpool

from avery.ingest import guards, ingest_paths
from avery.ingest.registry import CompanyContext, ContextRegistry, SourceDocument, active_registry

from . import account, embedding_factory, extractor_factory, upload_guard

router = APIRouter()


# ── feat-038 tenant isolation: the read-path holder check ────────────────────────────────────────
# THE critical IDOR (readiness §2-A): before feat-038, any caller holding a context_id could read a
# company's whole workspace. Now /ingest mints an unguessable owner_token (secrets.token_urlsafe),
# returns it to the uploader, and every read path validates a caller-supplied token against it.
#
# TRANSPORT RULE: the token travels ONLY in an HTTP header (X-Avery-Token, or Authorization: Bearer)
# — NEVER in the URL path/query, which would leak into Referer / access logs / CDN logs / browser
# history. The context_id stays in the URL (it always was), but on its own it no longer reads data.
#
# FAILURE MODE: a missing / wrong token (or an unknown id) is a 404 with the SAME body as an unknown
# id — NOT a 403 — so the surface never confirms whether a given context_id exists (no enumeration
# oracle; sticks with feat-028's loud-404-for-unknown-id semantics). Comparison is constant-time
# (secrets.compare_digest). A tokenless context (owner_token == "") requires no token — v1 back-compat
# for direct/test callers; every real /ingest context carries one.

TOKEN_BYTES = 32   # secrets.token_urlsafe(32) -> ~43 url-safe chars, ~256 bits of entropy


def mint_owner_token() -> str:
    """A fresh, unguessable owner_token for a newly ingested company workspace."""
    return secrets.token_urlsafe(TOKEN_BYTES)


def extract_owner_token(x_avery_token: str | None, authorization: str | None) -> str | None:
    """Pull the caller's token from the request headers: prefer the explicit `X-Avery-Token`, else a
    `Authorization: Bearer <token>`. Returns None when neither is present. Header-only by design —
    this function never looks at the URL."""
    if x_avery_token and x_avery_token.strip():
        return x_avery_token.strip()
    if authorization:
        parts = authorization.split(None, 1)
        if len(parts) == 2 and parts[0].lower() == "bearer" and parts[1].strip():
            return parts[1].strip()
    return None


def account_owns_context(reg: ContextRegistry, user_id: str | None, context_id: str) -> bool:
    """feat-053: does this VERIFIED Supabase user own this context? Duck-typed and fail-closed — a
    registry without the account seam (an old fake/stub in a test) simply reports False, which falls
    the caller back to the unchanged owner_token path rather than erroring."""
    if not user_id:
        return False
    owns = getattr(reg, "account_owns", None)
    if owns is None:
        return False
    try:
        return bool(owns(user_id, context_id))
    except Exception:
        return False   # a registry/DB hiccup must never GRANT access


def authorize_context(reg: ContextRegistry, context_id: str,
                      token: str | None,
                      account_user_id: str | None = None) -> CompanyContext:
    """Resolve a context the caller is authorized to read, or raise 404. Unknown id AND wrong/missing
    token both raise the SAME 404 (no existence oracle). A context whose owner_token is empty (pre-038
    / a direct caller) requires no token. Constant-time compare avoids a token-timing side channel.

    feat-053 adds a SECOND way to be authorized — `account_user_id`, an ALREADY-VERIFIED Supabase user
    id (verification happens in service/account.py; this function trusts its caller did that). If that
    user OWNS this context (avery.account_contexts), the read is allowed without an owner_token: this
    is what lets a manager sign in on a new device and see their company, and it is the whole of
    "服务端按 user 查到 context 再取 token". feat-038 is otherwise untouched — the account path only
    ever WIDENS access to a context the user provably owns, and every failure still lands on the same
    opaque 404. An anonymous (unclaimed) context is owned by nobody, so no account can reach it."""
    ctx = reg.get(context_id)
    unknown = HTTPException(status_code=404, detail=f"unknown company_context_id: {context_id}")
    if ctx is None:
        raise unknown
    if account_owns_context(reg, account_user_id, context_id):
        return ctx
    required = getattr(ctx, "owner_token", "") or ""
    if required:
        if not token or not secrets.compare_digest(token, required):
            raise unknown
    elif getattr(reg, "persistent", False):
        # feat-038 hardening: a SERVED (DB-backed) context with no owner_token must FAIL CLOSED — a
        # legacy/direct-inserted NULL-token row is never world-readable over the API. (The in-memory
        # registry keeps the empty-token back-compat: it is a test/direct-caller seam, not served.)
        raise unknown
    return ctx


def _unique_parse_names(display_names: list[str]) -> list[str]:
    """feat-032 P1: give each upload in a batch a DISTINCT on-disk basename, so two files that share
    a display name (both 'report.txt') no longer clobber the SAME temp path — which silently dropped
    the first file's content from parse -> memory/RAG. The returned name is the parsed doc's name and
    the SourceDocument.source_key (the per-document n_chunks join key); the ORIGINAL display name is
    kept separately on SourceDocument.filename. Collisions get a `(1)`/`(2)` suffix, deduped against
    every name already assigned (so it never re-collides with another original)."""
    used: set[str] = set()
    out: list[str] = []
    for name in display_names:
        candidate = name
        if candidate in used:
            stem, suffix = Path(name).stem, Path(name).suffix
            k = 1
            candidate = f"{stem}({k}){suffix}"
            while candidate in used:
                k += 1
                candidate = f"{stem}({k}){suffix}"
        used.add(candidate)
        out.append(candidate)
    return out


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
async def ingest(files: list[UploadFile] = File(...),
                 x_avery_account: str | None = Header(None)) -> dict:
    """Upload company files → CompanyContext + first Your-team payload.

    The uploaded bytes are written to a temp dir, parsed + extracted + RAG-loaded by the existing
    pipeline, then the temp inputs are discarded (sampler = ephemeral). Real LLM keys are NEVER
    needed for the offline heuristic extractor; a pluggable LLM extractor/embedder drops in via env
    (see service/.env.example) without changing this endpoint.

    feat-053: /ingest stays OPEN (no account required) — that is the guest path, and gating it would
    put the whole product behind a login wall. When the uploader IS signed in, the fresh context is
    linked to their account on the way out, so they never have to claim what they just created.
    """
    if not files:
        raise HTTPException(status_code=400, detail="no files uploaded")

    # feat-039 upload hard-gate (readiness §2-D): refuse an over-COUNT batch before touching any
    # bytes. Per-file SIZE and TYPE/zip-bomb checks run per file below (before the file is written to
    # disk); the total-body cap already ran at the ASGI edge (upload_guard.IngestGuardMiddleware).
    upload_guard.enforce_count(len(files))

    # feat-038: mint the owner_token BEFORE ingest so it is persisted with the context in the SAME
    # write (no second put()), and returned to the uploader below. Header-transported thereafter.
    owner_token = mint_owner_token()

    per_file_cap = guards.max_file_bytes()
    total_cap = guards.max_total_bytes()
    running_total = 0
    tmp = Path(tempfile.mkdtemp(prefix="avery-upload-"))
    saved: list[Path] = []
    src_docs: list[SourceDocument] = []
    try:
        # Guard against path traversal in the client-provided filename (basename only), then give
        # the batch DISTINCT on-disk names so two same-named uploads don't clobber one temp path.
        display_names = [Path(f.filename or "upload").name or "upload" for f in files]
        parse_names = _unique_parse_names(display_names)
        for f, display, parse_name in zip(files, display_names, parse_names):
            # Read in bounded chunks (RAM stays <= per-file cap), refuse an oversize file (413) and a
            # DISGUISED type / zip bomb (415 / 413) BEFORE it is parsed or written to disk.
            raw = await upload_guard.read_capped(f, display, per_file_cap)
            running_total += len(raw)
            if running_total > total_cap:
                raise HTTPException(status_code=413, detail={
                    "error": "upload too large",
                    "detail": f"batch exceeds the {total_cap}-byte per-request limit"})
            upload_guard.enforce_type_and_archive(display, raw)
            dest = tmp / parse_name
            dest.write_bytes(raw)
            saved.append(dest)
            # feat-032: keep the raw upload (bytes + metadata) for the per-company file space —
            # we already have the bytes, so build the SourceDocument here rather than re-reading.
            # The temp file is STILL deleted below (disk hygiene); the bytes are what persist, in
            # the DB (Postgres registry) or in memory (offline). Content is UNTRUSTED — stored and
            # listed, never followed as instructions. `filename` keeps the ORIGINAL display name;
            # `source_key` is the disambiguated per-document key (== parse_name) the manifest counts
            # n_chunks on, so two 'report.txt' rows attribute chunks to their OWN document.
            mime = f.content_type or mimetypes.guess_type(display)[0] or "application/octet-stream"
            src_docs.append(SourceDocument(filename=display, source_key=parse_name, mime=mime,
                                           size_bytes=len(raw), content=raw))

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
            # feat-039: build the extractor HERE so we can read its honest-degradation telemetry after
            # ingest (llm / heuristic / degraded) and surface it on the response (readiness §2-G2/W).
            extractor = extractor_factory.make_extractor()
            rep = ingest_paths([str(p) for p in saved], registry=registry, name="company",
                               extractor=extractor,
                               embedder=embedder if prefer_vector else None,
                               prefer_vector=prefer_vector,
                               source_documents=src_docs,
                               owner_token=owner_token)
            return rep, extractor_factory.extraction_mode(extractor)

        try:
            report, extraction_mode = await run_in_threadpool(_extract_and_ingest)
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
        # feat-038: hand the freshly-minted owner_token back to the UPLOADER (once, at creation) so
        # the client can store it and present it as a header on every later read. It is NOT included
        # in the /team/{id} refetch payload (that call already had to prove ownership to reach it).
        payload = _team_payload(report.context)
        payload["owner_token"] = owner_token
        # feat-053: a SIGNED-IN uploader owns what they just uploaded — bind it now so this company
        # follows their account (new device / cleared browser) with no claim step. Anonymous uploads
        # skip this entirely and stay owner_token-only, exactly as before. Best-effort: a linking
        # failure must never fail an ingest that already succeeded — the context is still reachable
        # by its owner_token, and /account/claim can bind it afterwards.
        uploader = account.resolve_account(x_avery_account)
        if uploader:
            try:
                link = getattr(active_registry(), "link_account_context", None)
                if link is not None:
                    payload["account_linked"] = bool(link(uploader, report.context.context_id))
            except Exception:
                payload["account_linked"] = False
        # feat-039: honest extraction label so the client is TOLD when it fell back (never a silent
        # low-quality result presented as a real team). 'degraded' => a model was configured but at
        # least one document dropped to the heuristic (429 / red-line / budget) — no fake person card.
        payload["extraction_mode"] = extraction_mode
        return payload
    finally:
        # Ephemeral: never persist the raw upload.
        for p in saved:
            p.unlink(missing_ok=True)
        try:
            tmp.rmdir()
        except OSError:
            pass


@router.get("/team/{context_id}")
def team(context_id: str,
         x_avery_token: str | None = Header(None),
         authorization: str | None = Header(None),
         x_avery_account: str | None = Header(None)) -> dict:
    """Re-fetch the Your-team payload for a registered context_id (post-upload refresh).

    feat-038: gated — the caller must present the owner_token (header) minted at /ingest, else 404.
    feat-053: OR a verified Supabase account that owns this context (signing in on a new device)."""
    reg = active_registry()
    ctx = authorize_context(reg, context_id, extract_owner_token(x_avery_token, authorization),
                            account.resolve_account(x_avery_account))
    return _team_payload(ctx)


@router.get("/team/{context_id}/notes")
def team_notes(context_id: str,
               x_avery_token: str | None = Header(None),
               authorization: str | None = Header(None),
               x_avery_account: str | None = Header(None)) -> dict:
    """feat-033 — Avery's notes: the accumulating, agent-WRITTEN observations about this company,
    NEWEST FIRST. Read-only surface (v1 has no delete). Every note here already passed the write-side
    red line (`redline.validate`, EN+ZH) at append time — the notebook never contains scoring text.

    feat-038: gated — the owner_token (header) is required, else 404.
    feat-053: OR a verified account that owns this context."""
    reg = active_registry()
    authorize_context(reg, context_id, extract_owner_token(x_avery_token, authorization),
                      account.resolve_account(x_avery_account))
    return {"context_id": context_id, "notes": [asdict(n) for n in reg.list_notes(context_id)]}


@router.get("/team/{context_id}/files")
def team_files(context_id: str,
               x_avery_token: str | None = Header(None),
               authorization: str | None = Header(None),
               x_avery_account: str | None = Header(None)) -> dict:
    """feat-032 — the per-company FILE SPACE manifest: what this company uploaded, so a manager can
    see what Avery's memory is built on (User Story 4). METADATA ONLY (filename / size / mime /
    doc_kind / uploaded_at / n_chunks); the bytes live behind the /files/{idx} download seam. The
    manifest is derived from stored data — nothing in a file's CONTENT is executed here.

    feat-038: gated — the owner_token (header) is required, else 404.
    feat-053: OR a verified account that owns this context."""
    reg = active_registry()
    ctx = authorize_context(reg, context_id, extract_owner_token(x_avery_token, authorization),
                            account.resolve_account(x_avery_account))
    return {"context_id": ctx.context_id, "files": ctx.file_cards()}


@router.get("/team/{context_id}/files/{idx}")
def team_file_download(context_id: str, idx: int,
                       x_avery_token: str | None = Header(None),
                       authorization: str | None = Header(None),
                       x_avery_account: str | None = Header(None)) -> Response:
    """feat-032 — download one uploaded file's ORIGINAL bytes (look-back enhancement). The bytes are
    UNTRUSTED user content, so they are served as an attachment with a generic content-type — a
    browser must never render/execute them inline. The filename is RFC 5987 percent-encoded, which
    also neutralizes header injection (newlines/quotes/CJK in a stored filename).

    feat-038: gated — the owner_token (header) is required, else 404 (BEFORE any bytes are read).
    feat-053: OR a verified account that owns this context."""
    reg = active_registry()
    ctx = authorize_context(reg, context_id, extract_owner_token(x_avery_token, authorization),
                            account.resolve_account(x_avery_account))
    if idx < 0 or idx >= len(ctx.source_documents):
        raise HTTPException(status_code=404, detail=f"no file at idx {idx}")
    data = reg.source_document_bytes(context_id, idx)
    if data is None:
        raise HTTPException(status_code=404, detail="file content is not available")
    safe_name = Path(ctx.source_documents[idx].filename).name or "download"
    disposition = "attachment; filename*=UTF-8''" + quote(safe_name)
    # feat-032 P3: defense in depth on fully-untrusted bytes — nosniff stops a browser from MIME-
    # sniffing the generic octet-stream into an executable type (on top of attachment, which already
    # forces a download rather than inline rendering).
    return Response(content=data, media_type="application/octet-stream",
                    headers={"Content-Disposition": disposition,
                             "X-Content-Type-Options": "nosniff"})
