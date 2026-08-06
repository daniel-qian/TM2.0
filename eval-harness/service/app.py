"""FastAPI app — the Avery agent service (feat-015).

Endpoints
---------
GET  /health
        Liveness + which brain is configured (no keys revealed).

POST /advise
        Live-input advice. Body: {situation, title?, company_context_id?, stream?}.
        Default streams SSE: think/tool/observe events, then a terminal `manifest` event with the
        8-field contract payload. Set {"stream": false} (or Accept: application/json) for a single
        buffered JSON body with the same manifest content.
        feat-038: when company_context_id is set, the request MUST carry that context's owner_token
        (header X-Avery-Token or Authorization: Bearer); a missing/wrong token 404s (tenant isolation).

The service WRAPS the existing engine (`avery/loop.py`, `avery/redline.py`, `avery/brain.py`). The
red line + cite gate + 8-field schema are enforced through this API by `service/contract.py`.
Keys stay server-side (`service/brain_factory.py`); the frontend only ever sees SSE events.

feat-038 (tenant isolation): /ingest mints an unguessable owner_token per company and returns it to
the uploader; every read path (/team/{id}[/notes|/files|/files/{idx}] and /advise-with-context)
validates a header-supplied token against it (404 on mismatch). The interactive docs (/docs, /redoc,
/openapi.json) and the token-burning /advise/sample demo are removed.
"""
from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from typing import Any, Iterator

from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sse_starlette.sse import EventSourceResponse

from avery import skills
from avery.env import load_dotenv
from avery.locale import DEFAULT_LOCALE, normalize_locale  # ADR-0033: locale 是请求字段

from . import account  # feat-053: verify a Supabase access token -> user id (header-only)
from . import brain_factory, embedding_factory, extractor_factory, live_input, llm_budget, mem_sentinel
from .ask_api import maybe_ask_draft_frame  # feat-034: the ask-draft frame (service-layer, not engine)
from .ask_api import router as ask_router   # feat-034: /ask manager endpoints + /r/{token} employee H5
from .auth_api import router as auth_router  # feat-053: /account/status|contexts|claim
from .demo import router as demo_router  # input-side-0721: /demo/status|claim（一键示例团队）
from .engine import stream_advice
from .form_api import router as form_router  # T1: 常驻表单 manager 端点 + /f/{token} 员工 H5
from .ingest_api import router as ingest_router  # feat-018: /ingest + /team/{id} (compose over feat-016)
from .ingest_api import authorize_context, extract_owner_token  # feat-038: reuse the read-path gate
from .upload_guard import IngestGuardMiddleware  # feat-039: edge rate-limit + total-body size cap

logger = logging.getLogger(__name__)

HERE = Path(__file__).resolve().parent.parent          # eval-harness/
SKILLS_DIR = HERE / "skills"
MEMORY_DIR = HERE / "memory"

# Pick up MINIMAX_*/DEEPSEEK_*/ANTHROPIC_* from eval-harness/.env if present (real shell wins).
load_dotenv(HERE / ".env")

# feat-038: close the interactive docs surface (readiness §2-A). /docs, /redoc, and /openapi.json
# turn an IDOR into a clickable console and expose the API shape; a lead-gen deploy has no need for
# them. docs_url=None + redoc_url=None + openapi_url=None make all three 404.
app = FastAPI(
    title="Avery agent service",
    version="0.1.0",
    summary="LiveAgentSource backend — advisor engine (think->tool->observe) over FastAPI + SSE.",
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)

# feat-039: the upload hard-gate EDGE — per-IP rate limit + total-body size cap on POST /ingest
# (and /advise rate limit). Added BEFORE CORS so CORS ends up OUTERMOST and decorates the guard's
# 429/413 responses with the ACAO headers a browser needs to read them. Pure ASGI (wraps `receive`
# to count streamed bytes). Limits are env-configured (default off/generous — the ECS runbook tunes).
app.add_middleware(IngestGuardMiddleware)

# Browser live mode (frontend :5173 -> this service :8137) needs CORS. Origins are env-configurable
# for deploy (AVERY_CORS_ORIGINS, comma-separated); dev defaults to the Vite dev ports.
_cors_origins = [
    o.strip()
    for o in os.getenv(
        "AVERY_CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
    ).split(",")
    if o.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

# feat-018: the ingestion HTTP surface (upload → Your team). Thin wrapper over feat-016's
# ingest_paths + registry; nothing in the engine changes. Endpoints: POST /ingest, GET /team/{id}.
app.include_router(ingest_router)

# feat-034 stage C: the Ask ("Quick ask") surface — manager endpoints (POST /ask · /ask/{id} ·
# /ask/{id}/share · GET /ask/{id} · /ask/{id}/revoke, all owner_token-gated) + the employee H5
# (GET /r/{token}, POST /r/{token}/answer — the share token in the URL is the one deliberate
# exception, the login-free employee path). Composes over the registry seam; engine untouched.
app.include_router(ask_router)

# feat-053: the account surface — GET /account/status (is auth even configured here) · GET
# /account/contexts (my companies, post-login restore) · POST /account/claim (adopt the anonymous
# context I built as a guest). Supabase owns sign-up/in/out; this service only maps a VERIFIED user
# to the context ids they own. The whole layer is dormant when SUPABASE_URL/ANON_KEY are unset —
# /ingest and every read path keep working exactly as they did, which is what keeps the
# `?v=2&mode=live&skin=paper&lang=zh` guest link alive.
app.include_router(auth_router)

# input-side-0721 · 3A 一键示例团队：GET /demo/status（能力探测）+ POST /demo/claim（克隆母本
# 成访客私有副本）。未配置 AVERY_DEMO_SEED_DIR 时整个面 404/false —— 与 auth 层同一"不配置
# 即不存在"姿态。机制与合约见 service/demo.py 模块注释。
app.include_router(demo_router)

# T1 · form-backend-a1a 常驻表单：经理端点（GET /team/{id}/forms · POST /team/{id}/forms/{tpl}/links
# · GET /team/{id}/forms/submissions，与 notes 同一张 owner_token/账号门）+ 员工侧免登录 H5
# （GET /f/{token} · POST /f/{token}/submit —— share token 骑 URL，与快问 /r/{token} 同一条契约）。
# 🔴 表单只是与上传文件平权的又一路数据源：本层只做到提交落库，「提交进资料」是 T2 的活。
app.include_router(form_router)


class AdviseRequest(BaseModel):
    situation: str = Field(..., min_length=1,
                           description="The manager's typed management situation + the ask.")
    title: str | None = Field(None, description="Optional short label for the situation.")
    company_context_id: str | None = Field(
        None, description="feat-016 stub: handle for an ingested company RAG context.")
    stream: bool = Field(True, description="SSE stream (default) vs a single buffered JSON body.")
    # ADR-0033: the language the manager reads the advice in. Optional and DELIBERATELY typed
    # `str | None`, not `Literal['en','zh']` — a bad value must fall back to 'en' with a warning,
    # never 422 a manager's advise turn (D11). Normalization lives in `avery.locale`.
    locale: str | None = Field(
        None, description="Reply language: 'en' (default) or 'zh'. Unknown values fall back to "
                          "'en' with a server-side warning; they are never rejected.")


def _system_prompt(locale: str = DEFAULT_LOCALE) -> str:
    return skills.build_system_prompt(SKILLS_DIR, MEMORY_DIR, scaffold="full", locale=locale)


def _resolve_memory_dir(company_context_id: str | None) -> Path:
    """feat-018: route an ingested company_context_id to its materialized facts.md/notes.md dir so
    the loop's own recall + cite gate run over the manager's UPLOADED facts (feat-016 seam). Falls
    back to the default demo memory for an UNSET id (the /advise handler rejects a given-but-unknown
    id up front, so this only ever sees a known id or none). Import is lazy so the service still runs
    if the ingest package is absent."""
    if not company_context_id:
        return MEMORY_DIR
    try:
        from avery.ingest.seam import resolve_memory_dir
        return resolve_memory_dir(company_context_id, MEMORY_DIR)
    except Exception:
        return MEMORY_DIR


def _run_events(sit: live_input.LiveSituation) -> tuple[Iterator[dict[str, Any]], Any]:
    """Build the live case, pick the brain, and return the engine event iterator + the case (so
    the caller can discard the temp file when done). Brain-config errors surface as an error event
    iterator rather than a 500, keeping the SSE contract stable."""
    kind = brain_factory.resolve_brain_kind()
    # Mock needs a MOCK block in the case; real brains reason over raw text.
    with_mock = (kind == "mock")
    memory_dir = _resolve_memory_dir(sit.company_context_id)
    case = live_input.build_live_case(sit, memory_dir, with_mock=with_mock)

    # 0805 走查修闸: /advise goes THROUGH the feat-039 spend gate. This was the actual
    # denial-of-wallet hole the walkthrough smelled (and mis-attributed): one advise turn is an
    # agentic loop of up to MAX_ITERS(12) uncharged model calls, while extractor and /ask drafting
    # were already BudgetedBrain-wrapped. A spent budget short-circuits BEFORE the stream starts
    # (clean error event, brain never built); a mid-loop exhaustion raises BudgetExceeded inside
    # engine.stream_advice, whose catch-all already surfaces it as an honest `error` event. The
    # mock brain is exempt (pure/local, no key, no cost) — the offline suite stays green.
    if kind != "mock" and llm_budget.exhausted():
        msg = (f"LLM call budget exhausted ({llm_budget.used()}/{llm_budget.budget()}) — "
               "/advise is paused to protect spend")

        def _budget_err() -> Iterator[dict[str, Any]]:
            yield {"type": "error", "error": msg,
                   "hint": "raise AVERY_LLM_CALL_BUDGET (or redeploy — the counter is per-process)."}
        return _budget_err(), case

    try:
        brain = brain_factory.make_brain(case, kind)
        if kind != "mock":
            brain = llm_budget.BudgetedBrain(brain)
    except RuntimeError as e:
        # 🔴 `msg` must be bound HERE, not read inside the generator. Python 3 implicitly deletes
        # the `except ... as e` name when the except block exits, and this generator is lazy — it
        # first runs when the SSE layer iterates it, which is long after that. Reading `str(e)`
        # from inside therefore raised `NameError: cannot access free variable 'e'`, so the branch
        # whose entire job is "surface brain-config errors as a clean error event rather than a
        # 500" did the exact opposite of its own docstring: the manager got a broken stream.
        # This fires on the most likely production failure of all — LLM key missing/expired/over
        # budget — i.e. precisely when a clear message matters most.
        msg = str(e)

        def _err() -> Iterator[dict[str, Any]]:
            yield {"type": "error", "error": msg,
                   "hint": "set AVERY_BRAIN + the matching key, or use AVERY_BRAIN=mock."}
        return _err(), case

    events = stream_advice(
        # ADR-0033: 语言指令随 locale 进 system prompt —— 真 brain 的正文语言从此是受控输入。
        # （MockBrain 不看 system prompt，它的语言来自 build_live_case 埋进 case 的 MOCK 块，
        #  同一个 sit.locale，两条路一个来源。）
        brain, case, _system_prompt(sit.locale), agent_name=getattr(brain, "name", kind),
        scaffold="full", memory_dir=memory_dir, enforce_chain=True, enforce_redline=True,
        embedder=embedding_factory.make_embedder())  # None -> keyword recall (key stays server-side)
    return events, case


def _sse(events: Iterator[dict[str, Any]], case, on_manifest=None) -> EventSourceResponse:
    """Wrap engine events as Server-Sent Events. Each event: `event:` = type, `data:` = JSON.

    feat-033: `on_manifest(ev)` runs the post-advise note hook the moment the terminal manifest is
    seen — BEFORE it is yielded — so the note is persisted by the time the client's stream ends and
    a follow-up GET /team/{id}/notes reliably sees it. The manifest stays the terminal event (no
    extra frame is emitted); the Room nudge is driven by the client re-reading the notebook."""
    def gen():
        try:
            for ev in events:
                # feat-034: the note hook keys on the ADVICE manifest only — the appended
                # ask-draft frame is a different animal (no transcript, nothing to note).
                if (on_manifest is not None and ev.get("type") == "manifest"
                        and ev.get("kind") in (None, "advice")):
                    try:
                        on_manifest(ev)
                    except Exception:   # a note-write problem must never break the stream
                        pass
                yield {"event": ev.get("type", "message"),
                       "data": json.dumps(ev, ensure_ascii=False)}
        finally:
            live_input.discard(case)
    return EventSourceResponse(gen())


def _with_ask_frame(events: Iterator[dict[str, Any]], req: "AdviseRequest") -> Iterator[dict[str, Any]]:
    """feat-034 stage C: append ONE `manifest{kind:'ask-draft'}` frame after a SUCCESSFUL advice
    manifest, when the situation names a roster person (ask_api.maybe_ask_draft_frame — the
    deterministic heuristic; no hit = no frame). This is the SERVICE-layer assembly point the
    stage-C contract pins: the frozen advisor engine emits exactly what it always did; old
    consumers ignore the extra frame (`kind` defaults to advice). Frame-building problems are
    swallowed — a quick-ask proposal must never break an advise that already succeeded."""
    saw_advice = False
    for ev in events:
        if ev.get("type") == "manifest" and ev.get("kind") in (None, "advice"):
            saw_advice = True
        yield ev
    if saw_advice:
        try:
            frame = maybe_ask_draft_frame(req.company_context_id, req.situation)
        except Exception:
            frame = None
        if frame:
            yield frame


def _post_advise_note(company_context_id: str | None, situation: str, manifest: dict) -> None:
    """feat-033 post-advise hook: append Avery's observation to the company notebook (write-side red
    line inside). Best-effort — a failure here never affects the advise response."""
    if not company_context_id:
        return
    try:
        from avery.ingest.registry import active_registry
        from . import notes
        notes.write_note_from_manifest(active_registry(), company_context_id, manifest, situation)
    except Exception:   # lazy import / registry problems must not surface to the caller
        pass


def _persist_advise_run(company_context_id: str | None, situation: str, title: str | None,
                        locale: str, manifest: dict) -> None:
    """issue #49 post-advise hook: persist this room Q&A (question + projected advice card / short
    answer) so the room's history survives a refresh. Rides the SAME manifest moment as the notes
    hook. Best-effort — a persistence problem never affects the advise response.

    🔴 只落 redline_passed 的 manifest（与 notes hook 同一判据）——被红线拦下的建议内容
    永远不进历史。无 context 不落（demo 默认公司没有历史归属可言）。"""
    if not company_context_id:
        return
    if manifest.get("redline_passed") is not True:
        return
    advice = manifest.get("advice") if isinstance(manifest.get("advice"), dict) else None
    answer = ""
    if manifest.get("answer_kind") == "answer":   # 0729/03 分流短答：与 advice 互斥
        a = manifest.get("answer")
        if isinstance(a, dict) and isinstance(a.get("text"), str):
            answer = a["text"]
        advice = None
    if advice is None and not answer:
        return   # 没有可回看的产出（异常收尾）——不落空行
    try:
        from avery.ingest.registry import active_registry
        active_registry().append_advise_run(company_context_id, situation,
                                            title=title or "", locale=locale,
                                            advice=advice, answer=answer)
    except Exception:   # lazy import / registry problems must not surface to the caller
        pass


def _post_advise_hooks(company_context_id: str | None, situation: str, title: str | None,
                       locale: str, manifest: dict) -> None:
    """The one post-advise assembly point: notes (feat-033) + run history (issue #49). Each hook
    swallows its own failures — one must never starve the other."""
    _post_advise_note(company_context_id, situation, manifest)
    _persist_advise_run(company_context_id, situation, title, locale, manifest)


@app.get("/health")
def health() -> dict:
    kind = brain_factory.resolve_brain_kind()
    # feat-039: sample the memory sentinel on the health hook and bubble a `degraded` flag when RSS
    # crosses AVERY_MEM_WARN_MB (Danny Q12 — the "time to upsize the ECS box" signal).
    mem = mem_sentinel.sample()
    # /health must not lie about extraction. `extractor` is the CONFIGURED intent ('heuristic' or
    # 'llm:<brain>'); `extraction_mode` is what it will ACTUALLY do right now — when a real brain is
    # configured but the per-process LLM spend budget is exhausted, extraction degrades to the offline
    # heuristic (denial-of-wallet fallback), so report 'degraded' and flip the operator `degraded`
    # flag rather than claim a healthy 'llm'. A natively keyless deploy stays honestly 'heuristic',
    # and a spent budget is moot there (no LLM extractor is in play).
    extractor = extractor_factory.active_extractor()             # "heuristic" or "llm:<brain>"
    llm_configured = extractor.startswith("llm:")
    extraction_degraded = llm_configured and llm_budget.exhausted()
    extraction_mode = "degraded" if extraction_degraded else ("llm" if llm_configured else "heuristic")
    return {"status": "ok", "service": "avery-agent", "brain": kind,
            "live": brain_factory.brain_is_live(),
            "embeddings": embedding_factory.active_embeddings(),  # "keyword" or "dashscope:<model>/<dim>"
            "extractor": extractor,                               # configured intent
            "extraction_mode": extraction_mode,                  # effective now: llm / heuristic / degraded
            "memory": mem,                                        # {rss_mb, warn_mb, high, available}
            "llm_calls_remaining": llm_budget.remaining(),        # None = unlimited (gate disabled)
            # 0805 走查修闸: embeddings burn on their OWN counter (AVERY_EMBED_CALL_BUDGET —
            # DashScope batches are ~2 orders cheaper than a chat call; mixing them into
            # llm_calls_remaining would corrupt the number Danny already watches in production).
            "embed_calls_remaining": llm_budget.embed_remaining(),  # None = unlimited
            "degraded": bool(mem.get("high")) or extraction_degraded}  # operator-facing: needs attention


@app.post("/advise")
def advise(req: AdviseRequest,
           x_avery_token: str | None = Header(None),
           authorization: str | None = Header(None),
           x_avery_account: str | None = Header(None)):
    # feat-028: a GIVEN-but-unknown company_context_id must 404 (consistent with GET /team/{id}),
    # not silently answer over the demo company. A missing id is the legitimate demo default.
    # feat-038: it must ALSO carry the owner_token (header) — otherwise advising over another
    # company's context (RAG over their facts + notes-write to their notebook) would be an IDOR. A
    # missing/wrong token 404s exactly like an unknown id (no existence oracle). A tokenless (pre-038)
    # context requires none. The token NEVER rides the URL — header only.
    # feat-053: a signed-in owner of this context is authorized WITHOUT the owner_token (same gate,
    # additive account path) — advising over your own company from a new device needs no token.
    if req.company_context_id:
        from avery.ingest.registry import active_registry
        authorize_context(active_registry(), req.company_context_id,
                          extract_owner_token(x_avery_token, authorization),
                          account.resolve_account(x_avery_account))
    # ADR-0033 · locale：缺省 en、非法回落 en 并告警（**不 422**，见 avery/locale.py 三条纪律）。
    locale, locale_warning = normalize_locale(req.locale)
    if locale_warning:
        # normalize_locale 自己已经 log 过一条；这里再挂一条带 endpoint 身份的，方便按路由捞。
        logger.warning("POST /advise: %s", locale_warning)
    sit = live_input.LiveSituation(
        situation=req.situation, title=req.title,
        company_context_id=req.company_context_id, locale=locale)
    events, case = _run_events(sit)
    events = _with_ask_frame(events, req)   # feat-034: maybe one ask-draft frame after the manifest

    if req.stream:
        return _sse(events, case,
                    on_manifest=lambda m: _post_advise_hooks(
                        req.company_context_id, req.situation, req.title, locale, m))

    # Buffered: drain to the terminal manifest (or error) and return one JSON body.
    try:
        collected: list[dict] = list(events)
    finally:
        live_input.discard(case)
    # feat-034: the buffered body is built from the ADVICE manifest — never the trailing
    # ask-draft frame (which is also a type=='manifest' event, discriminated by `kind`).
    manifest = next((e for e in reversed(collected)
                     if e["type"] == "manifest" and e.get("kind") in (None, "advice")), None)
    # feat-033 notes + issue #49 run history: the same post-advise assembly point as the SSE path.
    if manifest is not None:
        _post_advise_hooks(req.company_context_id, req.situation, req.title, locale, manifest)
    if manifest is None:
        err = next((e for e in collected if e["type"] == "error"), None)
        return JSONResponse(status_code=502,
                            content={"error": (err or {}).get("error", "no manifest produced"),
                                     "events": collected})
    return JSONResponse(content={**manifest, "events": collected})


# feat-038: /advise/sample is TAKEN DOWN. It was a zero-body, unauthenticated, unrate-limited SSE
# demo (readiness §2-A: a clickable IDOR console that also BURNS real LLM tokens — denial-of-wallet
# on a public URL). v1 has no need for it; the real surface is POST /advise with a situation. The
# route no longer exists, so GET /advise/sample now 404s.
