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

Persistence (feat-030, ADR-0023-postgres): `active_registry()` — Postgres-backed when AVERY_DB_URL /
PGVECTOR_URL is set (company data survives restarts/redeploys), else the process-local in-memory
registry (offline default, the pre-030 ADR-0021 §6 ephemeral behavior). Same get/put seam either way.
"""
from __future__ import annotations

import logging
import mimetypes
import secrets
import tempfile
from dataclasses import asdict
from pathlib import Path
from urllib.parse import quote

from fastapi import APIRouter, Header, HTTPException, UploadFile
from fastapi import File
from fastapi import Response
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from avery.ingest import guards, ingest_paths
from avery.ingest.file_append import append_paths_to_context, existing_source_keys
from avery.ingest.file_delete import delete_document_from_context
from avery.ingest.registry import CompanyContext, ContextRegistry, SourceDocument, active_registry

from . import account, embedding_factory, extractor_factory, upload_guard

logger = logging.getLogger(__name__)

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


def tokens_match(supplied: str, required: str) -> bool:
    """Constant-time owner_token comparison that CANNOT raise — fixD/M5.

    `secrets.compare_digest` refuses `str` operands containing non-ASCII characters and raises
    `TypeError: comparing strings with non-ASCII characters is not supported`. That exception used to
    escape `authorize_context`, so FastAPI rendered it as a 500 — and it could only ever fire AFTER
    `reg.get()` had found a real context with a non-empty owner_token. An unknown id short-circuits
    to 404 long before the compare. The status code therefore ANSWERED the one question feat-038
    exists to refuse:

        GET /team/<real-id>    X-Avery-Token: 令牌   -> 500   "this id exists"
        GET /team/<bogus-id>   X-Avery-Token: 令牌   -> 404   "this id does not"

    That is a working enumeration oracle reachable with no credential at all, on every protected
    read (/team, /notes, /files, /advise, all of ask_api, /account/claim). Encoding both sides to
    bytes first removes the raise: `compare_digest` over `bytes` accepts any byte sequence and stays
    constant-time. For a real token (url-safe base64, pure ASCII) the encode is the identity map, so
    the happy path is bit-for-bit unchanged.

    The blanket `except` is deliberate and is the point of the function: EVERY malformed-token path
    must converge on "not a match" so the caller can raise the SAME opaque 404 it raises for an
    unknown id. `surrogatepass` covers the one remaining encode failure — a lone surrogate, which a
    JSON body (/account/claim) can legally carry but UTF-8 cannot normally encode.
    """
    try:
        return secrets.compare_digest(
            supplied.encode("utf-8", "surrogatepass"),
            required.encode("utf-8", "surrogatepass"),
        )
    except Exception:
        return False   # malformed input is a NON-MATCH, never a 500 — see docstring


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
        # fixD/M5: `tokens_match` never raises — a malformed token (non-ASCII / control chars /
        # over-long / lone surrogate) is a NON-MATCH and lands on the same opaque 404 as an unknown
        # id, instead of a 500 that would confirm this context exists.
        if not token or not tokens_match(token, required):
            raise unknown
    elif getattr(reg, "persistent", False):
        # feat-038 hardening: a SERVED (DB-backed) context with no owner_token must FAIL CLOSED — a
        # legacy/direct-inserted NULL-token row is never world-readable over the API. (The in-memory
        # registry keeps the empty-token back-compat: it is a test/direct-caller seam, not served.)
        raise unknown
    return ctx


def _unique_parse_names(display_names: list[str], taken: set[str] | None = None) -> list[str]:
    """feat-032 P1: give each upload in a batch a DISTINCT on-disk basename, so two files that share
    a display name (both 'report.txt') no longer clobber the SAME temp path — which silently dropped
    the first file's content from parse -> memory/RAG. The returned name is the parsed doc's name and
    the SourceDocument.source_key (the per-document n_chunks join key); the ORIGINAL display name is
    kept separately on SourceDocument.filename. Collisions get a `(1)`/`(2)` suffix, deduped against
    every name already assigned (so it never re-collides with another original).

    T10: `taken` seeds the used-set with the keys THIS COMPANY ALREADY HOLDS. /ingest passes nothing
    (a fresh context holds none); the append endpoint passes `file_append.existing_source_keys(ctx)`.
    Without the seed,补传ing a second 「周报.md」 reuses the first one's source_key — and that key is
    half of the `<key>:<line>` citation contract, so every reading of the NEW document would be
    attributed to the OLD one (per-file chunk counts, the timeline's day, the document a conflict
    card cites — all three wrong at once, and no gate goes red)."""
    used: set[str] = set(taken or ())
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


def _registry_says_ephemeral(reg, context_id: str) -> bool:
    """T10 —— 这份 context 是一次性的示例克隆吗？Duck-typed + fail-open：没有这个方法的 registry
    （老的测试替身）或一次查询打嗝，都报 False。

    这里的 fail-open 与 `account_owns_context` 的 fail-closed 是**相反**方向，而且是故意的：
    那边答的是「要不要放行一次读」，出错必须拒绝；这边答的只是「补资料这个入口要不要藏起来」，
    出错时多显示一个入口的代价是往一份一次性克隆里补了文件（数据会随 GC 一起没），
    而少显示一个入口的代价是**真公司的经理补不了资料**。两害相权。
    """
    probe = getattr(reg, "is_ephemeral", None)
    if probe is None:
        return False
    try:
        return bool(probe(context_id))
    except Exception:
        return False


def _form_period_status(ctx: CompanyContext):
    """gap2 T9（#58）· 本期表单收集进度，喂给定级引擎的「本期还差人没交」那条规则。

    🔴 只读，绝不写。自动补铸挂在经理侧读表单区那一下（`GET /team/{ctx}/forms/submissions`），
    **不**挂在这里：`/team` 是今天页每次刷新都打的那条路，让它顺手建行等于把一次写接到了
    全站最热的读上——而且经理还没打开表单区，链接就已经悄悄发出去了。

    读不到就当没有（`forms=None`，那条规则不参评）。表单表是 T1 之后才有的，老 context、
    没跑过迁移的库、以及任何不认这几个方法的 registry 双胞胎都必须**照旧工作**——
    今天页不能因为表单这一路出问题就整屏空掉。
    """
    try:
        from avery.ingest.form_autofill import form_period_status
        return form_period_status(active_registry(), ctx.context_id)
    except Exception:
        logger.exception("T9: reading this period's form status for %s failed — the today page "
                         "renders without the this-period-form rule (every other rule is unaffected)",
                         ctx.context_id)
        return None


def _team_payload(ctx: CompanyContext, *, reg: ContextRegistry | None = None) -> dict:
    """Project a CompanyContext onto the exact LiveTeamPayload shape transport.ts expects."""
    # 🔴 同一份 forms 必须同时喂给 briefing() 与 decision_cards()：两者共用同一张规则表，
    # 只喂一边就会让「N 个值得多看一眼」和底下的卡片对不上（registry.briefing() 的长注释
    # 记着这个旧伤，B1 的 timeline 与 B2b 的 conflicts 都是照这条纪律接的）。
    forms = _form_period_status(ctx)
    payload = {
        "context_id": ctx.context_id,
        "source_files": ctx.source_files,
        "people": ctx.team_cards(),      # QUALITATIVE by default; self_report only when switch on
        "projects": ctx.project_cards(),
        "briefing": ctx.briefing(forms=forms),
        "signals": ctx.signal_cards(),
        # feat-056 决策定级（additive）：feat-057「今天要决策的」按此列表的顺序展示。
        # 纯规则产出、无 LLM —— 不增加任何请求延迟，也不受模型随机性影响。
        "decisions": ctx.decision_cards(forms=forms),
    }
    # rich-align-0722/03 — additive top-level flag, present-and-true ONLY when person scoring is
    # unblocked (mirrors account_linked's absent-when-false semantics). The frontend's layer-3 runtime
    # strip keys off this: absent/false → every number key on a person is dropped (current moat); true
    # → only the self_report whitelist is allowed through, and only inside a provenance-marked element.
    from avery.scoring_policy import person_scoring_allowed
    if person_scoring_allowed():
        payload["scoring_enabled"] = True
    # rich-align-0722/08 · SOP 方法卡（只读，无 CRUD）。空即缺席（absent≠none）——非 demo/无 SOP 的
    # context 不发 playbooks 键，前端判空降级维持 coming-soon 诚实标。
    playbooks = ctx.playbook_cards()
    if playbooks:
        payload["playbooks"] = playbooks
    # rich-align-0722/05a · softly-deleted projects for the archived collapse drawer. Key OMITTED when
    # nothing is archived (absent≠none, mirrors the decisions/scoring_enabled additive-key style).
    archived = ctx.archived_project_cards()
    if archived:
        payload["archived_projects"] = archived
    # rich-align-0722/06 · 停用（软删）的成员，投给团队目录页尾折叠区。空即缺席（absent≠none）。
    archived_ppl = ctx.archived_people_cards()
    if archived_ppl:
        payload["archived_people"] = archived_ppl
    # T10 · 一次性克隆（示例团队）——additive key，false 时**缺席**（与 scoring_enabled /
    # account_linked 同一个 absent≠none 姿态）。前端按它藏掉「给这家公司补资料」的入口。
    # 🔴 与 payload['demo'] 不是同一件事：那个只在 `POST /demo/claim` 的**首帧**出现，
    #    刷一次页面就没了（transport.ts 自己的注释写着）。这一条每次 `GET /team/{id}` 都在，
    #    所以入口禁得住刷新——判据活在服务端，不活在前端内存里。
    if reg is not None and _registry_says_ephemeral(reg, ctx.context_id):
        payload["ephemeral"] = True
    return payload


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
    # T10: 这条刷新帧要带上 `ephemeral`——「补资料」入口的判据必须禁得住刷新页面，
    # 而 `demo` 那个键只在 /demo/claim 的首帧出现（见 _team_payload 里那段 🔴）。
    return _team_payload(ctx, reg=reg)


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


@router.get("/team/{context_id}/advise-runs")
def team_advise_runs(context_id: str,
                     x_avery_token: str | None = Header(None),
                     authorization: str | None = Header(None),
                     x_avery_account: str | None = Header(None)) -> dict:
    """issue #49 — 议事室历史：这家公司持久化的问答（问题 + 投影后的建议卡/短答），NEWEST
    FIRST，上限 50 条。只读面（v1 无删除）。每条落库时都过了 redline_passed 判据（service
    的 _persist_advise_run），历史里不会出现被红线拦下的建议内容。

    门与 notes 同一张：owner_token（header）或持有账号——否则 404，无存在性 oracle。"""
    reg = active_registry()
    authorize_context(reg, context_id, extract_owner_token(x_avery_token, authorization),
                      account.resolve_account(x_avery_account))
    return {"context_id": context_id,
            "runs": [asdict(r) for r in reg.list_advise_runs(context_id)]}


@router.get("/team/{context_id}/advise-threads")
def team_advise_threads(context_id: str,
                        x_avery_token: str | None = Header(None),
                        authorization: str | None = Header(None),
                        x_avery_account: str | None = Header(None)) -> dict:
    """issue #78 — 议事室历史**按场分组**：`{context_id, threads:[{thread_id, runs:[...]}]}`。
    场按最近活动 NEWEST FIRST，场内 runs 按对话顺序（seq 升序）。上限 20 **场**。

    为什么是新端点而不是把 /advise-runs 改成分组：那条路的四条契约测试
    （tests/test_advise_runs_http.py）是现成的回归网，改它的顶层结构等于把网拆了换新的。
    平铺那条原样留着（`thread_id` 靠 asdict 自动 additive 进它的每一条），这条只加不减。

    🔴 上限数的是**场**不是行——见 registry.list_advise_threads 的 docstring：沿用行数上限会
    把最老那一场腰斩成半截对话，而调用方分辨不出「这场只有 3 轮」和「这场有 7 轮只给了 3 轮」。

    空历史是 **200 + `threads: []`**，绝不用 404 表达「这里没有场」：404 在已鉴权的读路径上
    的既有语义是「token 缺失/过期」（transport.ts 的 httpErrorMessage 就是这么解释给用户的），
    拿它表达空态会让前端把「没问过」显示成「登录失效」。

    门与 notes / advise-runs 同一张：owner_token（header）或持有账号——否则 404，无存在性 oracle。"""
    reg = active_registry()
    authorize_context(reg, context_id, extract_owner_token(x_avery_token, authorization),
                      account.resolve_account(x_avery_account))
    return {"context_id": context_id,
            "threads": [asdict(t) for t in reg.list_advise_threads(context_id)]}


class NoteIn(BaseModel):
    """input-side-0721 · 8A：onboarding 闸门页采集的「公司现状」口述。上限收紧（4000 字）——
    这是一段自我介绍，不是文件上传通道；大材料走 /ingest。"""
    text: str = Field(..., min_length=1, max_length=4000)
    source_excerpt: str = Field("", max_length=200)


@router.post("/team/{context_id}/notes")
def team_notes_append(context_id: str, body: NoteIn,
                      x_avery_token: str | None = Header(None),
                      authorization: str | None = Header(None),
                      x_avery_account: str | None = Header(None)) -> dict:
    """input-side-0721 · 8A —— 经理在 onboarding 里口述的公司状况，落进同一本 company_notes。

    语义：这条不是 Avery 的观察，是「你告诉 Avery 的话」——前端发来的 text 自带这个框架
    （「初始设置：……」），source_excerpt 是来源标记（notes 面用它显示出处）。为什么进同一本
    笔记本而不是新表：它就是公司上下文的一部分，advise 的 recall 面和 notes 面都该看到它；
    表已有（migration 0006），面已有（GET /team/{id}/notes），少一张表就少一个漂移点。

    门与读路径同一张：owner_token（或持有账号）——否则 404，无存在性 oracle。
    写侧红线原样生效（append_note 内的 gate_note_red_line，EN+ZH）：评分/排名/画像内容
    在开关默认关时进不来，ValueError → 422（与 /ingest 的 422 姿态一致）。"""
    reg = active_registry()
    authorize_context(reg, context_id, extract_owner_token(x_avery_token, authorization),
                      account.resolve_account(x_avery_account))
    try:
        note = reg.append_note(context_id, body.text.strip(),
                               (body.source_excerpt or "").strip())
    except ValueError as e:
        raise HTTPException(status_code=422,
                            detail={"error": "note rejected", "reason": str(e)})
    return {"context_id": context_id, "note": asdict(note)}


# ── rich-align-0722/05a · 真 CRUD·项目（手编赢 + 逐字段出处，ADR-0028）──────────────────────────
# 端点形状照 notes 写端点先例：owner_token 或账号二选一鉴权、失败一律同体 404 无枚举、Pydantic 校验、
# ValueError→422、软删可逆（archive/restore，**无物理删除路径**）。项目字段全量可编辑——人身数字与项目
# 无关，人身禁键在 06（人员 CRUD）侧执法。
class MilestoneIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=80)
    status: str = Field("", max_length=40)


class RiskIn(BaseModel):
    level: str = Field(..., min_length=1, max_length=20)
    reason: str = Field("", max_length=400)


class ProjectIn(BaseModel):
    """POST body — 手动添加的项目。title 必填；其余可选（absent≠none：不传即不设，绝不折 0/默认）。"""
    title: str = Field(..., min_length=1, max_length=200)
    ownerName: str = Field("", max_length=120)
    status: str = Field("", max_length=40)
    progress: int | None = Field(None, ge=0, le=100)
    dueDate: str = Field("", max_length=60)
    summary: str = Field("", max_length=2000)
    blockers: list[str] = Field(default_factory=list)
    risk: RiskIn | None = None
    milestones: list[MilestoneIn] = Field(default_factory=list)


class ProjectPatch(BaseModel):
    """PATCH body — 全字段可选。**发来的键**才动（含显式 null=清空→渲染 absent），**没发的键**不动。
    靠 model_dump(exclude_unset=True) 区分「没传」与「传了 null」，absent≠none 才活得下来。"""
    title: str | None = Field(None, max_length=200)
    ownerName: str | None = Field(None, max_length=120)
    status: str | None = Field(None, max_length=40)
    progress: int | None = Field(None, ge=0, le=100)
    dueDate: str | None = Field(None, max_length=60)
    summary: str | None = Field(None, max_length=2000)
    blockers: list[str] | None = None
    risk: RiskIn | None = None
    milestones: list[MilestoneIn] | None = None


def _project_write_404() -> HTTPException:
    # Same opaque 404 the read path uses — an unknown project inside an authorized context reveals
    # nothing more than "not here" (no enumeration oracle), consistent with authorize_context.
    return HTTPException(status_code=404, detail="unknown project")


@router.post("/team/{context_id}/projects")
def team_project_add(context_id: str, body: ProjectIn,
                     x_avery_token: str | None = Header(None),
                     authorization: str | None = Header(None),
                     x_avery_account: str | None = Header(None)) -> dict:
    """手动添加一个项目 → 写端点 → 卡即时入网格，逐字段出处标注「手动编辑」。"""
    reg = active_registry()
    authorize_context(reg, context_id, extract_owner_token(x_avery_token, authorization),
                      account.resolve_account(x_avery_account))
    try:
        pr = reg.add_project(context_id, body.model_dump())
    except KeyError:
        raise _project_write_404()
    except ValueError as e:
        raise HTTPException(status_code=422, detail={"error": "project rejected", "reason": str(e)})
    return {"context_id": context_id, "project": CompanyContext._one_project_card(pr)}


@router.patch("/team/{context_id}/projects/{project_id}")
def team_project_patch(context_id: str, project_id: str, body: ProjectPatch,
                       x_avery_token: str | None = Header(None),
                       authorization: str | None = Header(None),
                       x_avery_account: str | None = Header(None)) -> dict:
    """编辑既有项目字段（手编赢，origin=manual）。只应用**发来的键**（exclude_unset）。"""
    reg = active_registry()
    authorize_context(reg, context_id, extract_owner_token(x_avery_token, authorization),
                      account.resolve_account(x_avery_account))
    try:
        pr = reg.patch_project(context_id, project_id, body.model_dump(exclude_unset=True))
    except KeyError:
        raise _project_write_404()
    except ValueError as e:
        raise HTTPException(status_code=422, detail={"error": "project rejected", "reason": str(e)})
    return {"context_id": context_id, "project": CompanyContext._one_project_card(pr)}


@router.post("/team/{context_id}/projects/{project_id}/archive")
def team_project_archive(context_id: str, project_id: str,
                         x_avery_token: str | None = Header(None),
                         authorization: str | None = Header(None),
                         x_avery_account: str | None = Header(None)) -> dict:
    """归档 = 软删标记（可逆，绝不物理删除）→ 卡入折叠区。"""
    reg = active_registry()
    authorize_context(reg, context_id, extract_owner_token(x_avery_token, authorization),
                      account.resolve_account(x_avery_account))
    try:
        pr = reg.archive_project(context_id, project_id)
    except KeyError:
        raise _project_write_404()
    return {"context_id": context_id, "project": CompanyContext._one_project_card(pr)}


@router.post("/team/{context_id}/projects/{project_id}/restore")
def team_project_restore(context_id: str, project_id: str,
                         x_avery_token: str | None = Header(None),
                         authorization: str | None = Header(None),
                         x_avery_account: str | None = Header(None)) -> dict:
    """恢复 = 撤销软删标记 → 卡回主网格。"""
    reg = active_registry()
    authorize_context(reg, context_id, extract_owner_token(x_avery_token, authorization),
                      account.resolve_account(x_avery_account))
    try:
        pr = reg.restore_project(context_id, project_id)
    except KeyError:
        raise _project_write_404()
    return {"context_id": context_id, "project": CompanyContext._one_project_card(pr)}


# ── rich-align-0722/06 · 真 CRUD·人员（手编赢 + 逐字段出处 ADR-0028；写侧红线 B3）─────────────────────
# 端点/鉴权/404/422/软删语义同 05a 项目（复用 ProjectWriteMixin 的 person 孪生方法）。
# 🔴 model 只有**定性**字段 + extra='forbid'：POST/PATCH 带 load/mood/self_report/score/负载/情绪…任何
# 结构外键 → Pydantic 直接 422（人身数字只能来自文档自述通道，经理手填=替人打分）。夹带进定性字段的
# 评分文本（role='绩效9分'）由 registry._redline_person_write 值扫描再补一道→ValueError→422。
# self_report 结构上不可经此通道产生：模型无该字段，add/patch 只碰定性字段，投影层照旧随开关。
class PersonIn(BaseModel):
    """POST body — 手动添加的成员，**定性字段**。name 必填；其余可选（absent≠none）。"""
    model_config = {"extra": "forbid"}
    name: str = Field(..., min_length=1, max_length=80)
    role: str = Field("", max_length=120)
    team: str = Field("", max_length=120)
    tenure: str = Field("", max_length=120)
    owns: list[str] = Field(default_factory=list)
    collaboration: list[str] = Field(default_factory=list)


class PersonPatch(BaseModel):
    """PATCH body — 全字段可选（发来的键才动，含显式 null=清空→absent）。extra='forbid' 守人身禁键。"""
    model_config = {"extra": "forbid"}
    name: str | None = Field(None, max_length=80)
    role: str | None = Field(None, max_length=120)
    team: str | None = Field(None, max_length=120)
    tenure: str | None = Field(None, max_length=120)
    owns: list[str] | None = None
    collaboration: list[str] | None = None


def _person_write_404() -> HTTPException:
    # 同 authorize_context 姿态：授权 context 内的未知 person 也只回同体 404（无枚举 oracle）。
    return HTTPException(status_code=404, detail="unknown person")


def _one_person_card_now(p) -> dict:
    # 写回执卡随开关投 self_report（手编人零 self_report，故实际恒定性）；provenance 照发。
    from avery.scoring_policy import person_scoring_allowed
    return CompanyContext._one_person_card(p, person_scoring_allowed())


@router.post("/team/{context_id}/people")
def team_person_add(context_id: str, body: PersonIn,
                    x_avery_token: str | None = Header(None),
                    authorization: str | None = Header(None),
                    x_avery_account: str | None = Header(None)) -> dict:
    """手动添加一名成员（定性）→ 卡即时入目录网格，逐字段出处标注「手动编辑」。"""
    reg = active_registry()
    authorize_context(reg, context_id, extract_owner_token(x_avery_token, authorization),
                      account.resolve_account(x_avery_account))
    try:
        p = reg.add_person(context_id, body.model_dump())
    except KeyError:
        raise _person_write_404()
    except ValueError as e:
        raise HTTPException(status_code=422, detail={"error": "person rejected", "reason": str(e)})
    return {"context_id": context_id, "person": _one_person_card_now(p)}


@router.patch("/team/{context_id}/people/{person_id}")
def team_person_patch(context_id: str, person_id: str, body: PersonPatch,
                      x_avery_token: str | None = Header(None),
                      authorization: str | None = Header(None),
                      x_avery_account: str | None = Header(None)) -> dict:
    """编辑既有成员的定性字段（手编赢，origin=manual）。只应用发来的键（exclude_unset）。"""
    reg = active_registry()
    authorize_context(reg, context_id, extract_owner_token(x_avery_token, authorization),
                      account.resolve_account(x_avery_account))
    try:
        p = reg.patch_person(context_id, person_id, body.model_dump(exclude_unset=True))
    except KeyError:
        raise _person_write_404()
    except ValueError as e:
        raise HTTPException(status_code=422, detail={"error": "person rejected", "reason": str(e)})
    return {"context_id": context_id, "person": _one_person_card_now(p)}


@router.post("/team/{context_id}/people/{person_id}/archive")
def team_person_archive(context_id: str, person_id: str,
                        x_avery_token: str | None = Header(None),
                        authorization: str | None = Header(None),
                        x_avery_account: str | None = Header(None)) -> dict:
    """停用 = 软删标记（可逆，绝不物理删除）→ 卡入页尾折叠区。"""
    reg = active_registry()
    authorize_context(reg, context_id, extract_owner_token(x_avery_token, authorization),
                      account.resolve_account(x_avery_account))
    try:
        p = reg.archive_person(context_id, person_id)
    except KeyError:
        raise _person_write_404()
    return {"context_id": context_id, "person": _one_person_card_now(p)}


@router.post("/team/{context_id}/people/{person_id}/restore")
def team_person_restore(context_id: str, person_id: str,
                        x_avery_token: str | None = Header(None),
                        authorization: str | None = Header(None),
                        x_avery_account: str | None = Header(None)) -> dict:
    """恢复 = 撤销停用标记 → 卡回目录网格。"""
    reg = active_registry()
    authorize_context(reg, context_id, extract_owner_token(x_avery_token, authorization),
                      account.resolve_account(x_avery_account))
    try:
        p = reg.restore_person(context_id, person_id)
    except KeyError:
        raise _person_write_404()
    return {"context_id": context_id, "person": _one_person_card_now(p)}


@router.post("/team/{context_id}/files")
async def team_files_append(context_id: str,
                            files: list[UploadFile] = File(...),
                            x_avery_token: str | None = Header(None),
                            authorization: str | None = Header(None),
                            x_avery_account: str | None = Header(None)) -> dict:
    """T10 · 补资料 —— 把新文件 append 进**这家已经存在的公司**，卡片安静更新到新读数。

    与 `POST /ingest` 的分界，一句话：/ingest 是「开一家公司」，本端点是「给这家公司补资料」。
    /ingest 恒新建 context 并铸一个新 owner_token；本端点一个 context 都不新建、一个 token 都不铸，
    只往 `context_id` 那份资料库里加文档，并把新读数并进已有的人卡/项目卡（`file_append` 的文件头
    写了归并的四个坑与它们的答案）。

    门与读路径同一张（`authorize_context`）：owner_token（或持有账号）——否则 404，无存在性
    oracle。字节侧的闸与 /ingest **逐条同一套**，一个都不许少：批量条数（`enforce_count`）、
    逐文件大小（`read_capped`，413）、整批总量（`max_total_bytes`，413）、伪装类型/zip 炸弹
    （`enforce_type_and_archive`，415/413）；ASGI 边缘那层（限流 + Content-Length 预检 +
    流式总量兜底）由 `upload_guard._route_for` 的 `/team/*/files` 分支接上。

    🔴 新文件的 `source_key` 要拿**这家公司已经占用的那些 key** 去重（`taken=` 那个参数），
    不只是这一批内部去重：`<source_key>:<行号>` 是出处契约的一半，撞了 key 之后新文档的每一条
    读数都会被算到旧文档头上，而且没有任何一道门会红。

    422 的两种成因与 /ingest 同体：红线（抽到了对人的评分）、这批文件一份都读不出来。
    """
    if not files:
        raise HTTPException(status_code=400, detail="no files uploaded")
    upload_guard.enforce_count(len(files))

    reg = active_registry()
    # 先鉴权再读字节：认不出的调用方连一个 byte 都不该让它送进来（也拿不到「这个 id 存不存在」）。
    ctx = authorize_context(reg, context_id, extract_owner_token(x_avery_token, authorization),
                            account.resolve_account(x_avery_account))

    per_file_cap = guards.max_file_bytes()
    total_cap = guards.max_total_bytes()
    running_total = 0
    tmp = Path(tempfile.mkdtemp(prefix="avery-append-"))
    saved: list[Path] = []
    src_docs: list[SourceDocument] = []
    try:
        display_names = [Path(f.filename or "upload").name or "upload" for f in files]
        parse_names = _unique_parse_names(display_names, taken=existing_source_keys(ctx))
        for f, display, parse_name in zip(files, display_names, parse_names):
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
            src_docs.append(SourceDocument(filename=display, source_key=parse_name, mime=(
                f.content_type or mimetypes.guess_type(display)[0] or "application/octet-stream"),
                size_bytes=len(raw), content=raw))

        def _extract_and_append() -> object:
            # 与 /ingest 同一个理由跑在工作线程里：整段 parse+抽取是分钟级同步活，跑在事件循环上
            # 会冻住 /health，Docker HEALTHCHECK 会在抽取中途把容器重启掉。
            registry = active_registry()
            extractor = extractor_factory.make_extractor()
            rep = append_paths_to_context(registry, context_id, [str(p) for p in saved],
                                          src_docs, extractor=extractor)
            return rep, extractor_factory.extraction_mode(extractor)

        try:
            report, extraction_mode = await run_in_threadpool(_extract_and_append)
        except KeyError:
            # context 在鉴权之后、写之前消失了（GC / 另一路删除）——同体 404，不解释。
            raise HTTPException(status_code=404,
                                detail=f"unknown company_context_id: {context_id}")
        except ValueError as e:
            raise HTTPException(status_code=422,
                                detail={"error": "upload rejected", "reason": str(e)})

        if not report.ok or report.context is None:
            raise HTTPException(status_code=422, detail={
                "error": "extraction refused",
                "reason": ("red line: a person-scoring/ranking field was extracted"
                           if report.violations else "no parseable content in the upload"),
                "violations": [{"kind": v.kind, "person": v.person, "detail": v.detail,
                                "rule_id": v.rule_id} for v in report.violations],
                "parse_errors": report.parse_errors})

        # 回执 = 与 /team/{id} 同一张 payload（前端拿它整屏刷新，卡片当场是新读数）。
        # 🔴 **不发** owner_token：那是创建时才交出去一次的凭据，本端点没有新铸也不该重发一遍
        #    （调用方已经拿着它才走到这里）。
        payload = _team_payload(report.context, reg=reg)
        payload["extraction_mode"] = extraction_mode
        payload["appended"] = {
            "documents": [sd.source_key or sd.filename for sd in report.added_documents],
            "skipped": report.skipped_duplicates,
            "parse_errors": report.parse_errors,
            "conflicts_added": report.conflicts_added,
        }
        return payload
    finally:
        for p in saved:
            p.unlink(missing_ok=True)
        try:
            tmp.rmdir()
        except OSError:
            pass


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


@router.delete("/team/{context_id}/files/{source_key:path}")
def team_file_delete(context_id: str, source_key: str,
                     x_avery_token: str | None = Header(None),
                     authorization: str | None = Header(None),
                     x_avery_account: str | None = Header(None)) -> dict:
    """issue #77 — 删掉一份传上来的资料：原件字节 + 它孵出的材料面一起收走。

    v1 刻意没有这个端点（「不建假按钮」红线的另一半：后端没有，UI 上就一个都不许出现）。
    本票正式翻案——经理误传一份带工资的表，此前**只能整库重开**。

    🔴 寻址是 `source_key` 不是 `idx`（编排层 docstring 记了完整理由）：put() 会重排 idx，
    删完之后前端手里的旧 idx 会静默指向另一份文件——不是 404，是下错文件。
    `:path` 转换器是**必须**的：source_key 是文件名，可能自带斜杠/中文/括号。

    feat-038/053 姿态与本族其余端点逐字相同：owner_token（header）或已验证账号，否则 404。
    「这家公司不存在」与「这家公司没有这份资料」都回 404，且**同体**——不给存在性 oracle
    （同 files 端点族的既有纪律）。"""
    reg = active_registry()
    ctx = authorize_context(reg, context_id, extract_owner_token(x_avery_token, authorization),
                            account.resolve_account(x_avery_account))
    try:
        report = delete_document_from_context(reg, ctx.context_id, source_key)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"no file with key {source_key}")

    # 回执 = 与 /team/{id} 同一张 payload（前端拿它整屏刷新——facts 重物化之后卡片的出处会变，
    # 让屏自己去读权威值，别在前端猜）。🔴 同 append：**不发** owner_token。
    payload = _team_payload(report.context, reg=reg)
    payload["deleted"] = {
        "source_key": report.removed.source_key or report.removed.filename,
        "filename": report.removed.filename,
        "materials_removed": report.materials_removed,
        "signals_removed": report.signals_removed,
        "conflicts_removed": report.conflicts_removed,
        "remaining": report.remaining_documents,
    }
    return payload
