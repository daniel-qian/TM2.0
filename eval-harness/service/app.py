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
from avery.ingest.registry import new_thread_id  # #78: 服务端铸场 id（理由见 _with_thread_id）

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
from .threads import normalize_thread_id  # #78: advise-thread id 的形状闸（坏值当没带，不 422）
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


class AdviseReference(BaseModel):
    """#64 · one @-reference riding an advise turn. Every field is DELIBERATELY a tolerant
    plain str (the D11 locale precedent — never 422 a manager's advise turn): an unknown kind
    or a dangling id degrades to "skipped / honest not-found line" inside the builder, never
    to a rejected question."""
    kind: str = Field("", description="person | project | file | playbook (unknown: skipped).")
    id: str = Field("", description="entity id / filename / playbook title (kind-dependent).")
    label: str = Field("", description="display label; also the resolve fallback + weave text.")


class AdviseHistoryTurn(BaseModel):
    """#71 · one earlier turn of this Room conversation. Both fields are tolerant plain str
    with a default (same D11 discipline as AdviseReference): a malformed history entry
    degrades to "that turn contributes nothing", never to a rejected question. The quota and
    the drop/truncate rules live in `service/history.py`, not here — this model only says
    what shape the wire carries."""
    question: str = Field("", description="What the manager asked that turn (their own words).")
    answer: str = Field("", description="That turn's terminal artifact, summarized to one blob.")


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
    # #64 · additive optional: entities the manager @-referenced. Their card readings + related
    # record lines are GUARANTEED into the model context (avery/ingest/references.py, quota-capped)
    # — not left to recall luck. Absent/empty = the pre-#64 request, byte-identical behavior.
    references: list[AdviseReference] | None = Field(
        None, description="#64 @-references: [{kind, id, label}]; readings of these entities are "
                          "pinned into the model context, quota-capped.")
    # #71 · additive optional, same discipline as `references` above: a pre-#71 client omits
    # the key and gets the pre-#71 prompt byte for byte (the whole existing pytest suite
    # passing unchanged IS that guarantee's gate). NOT persisted — `advise_runs` still stores
    # one row per question with its own terminal artifact, so this ticket is zero-migration.
    history: list[AdviseHistoryTurn] | None = Field(
        None, description="#71 conversation so far: [{question, answer}], oldest first. "
                          "Prepended as plain user/assistant turns before this question; "
                          "quota-capped and truncation-marked server-side.")
    # #78 · additive optional, same discipline as `references`/`history`: 这一问接在哪一场后面。
    # 缺键 = 开新的一场（旧前端一个字节不改照常工作）。坏值当没带，绝不 422（同 locale 的降级
    # 纪律）——形状闸在 service/threads.py。
    # 🔴 它**只管归档**：服务端不会因为收到 thread_id 就去库里补历史轮。推理面的上下文仍然只
    # 来自上面那个 `history` 数组（service/history.py 的配额闸原样生效）。两者同时出现不冲突，
    # 因为它们回答的是两个问题：thread_id = 这一行属于哪一场，history = 这一问带多少上下文。
    thread_id: str | None = Field(
        None, description="#78 advise-thread this turn belongs to. Absent = start a new thread; "
                          "the server mints one and echoes it back on the `started` and "
                          "`manifest` frames. Malformed values are treated as absent.")


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


def _build_reference_block(company_context_id: str | None, references) -> str | None:
    """#64: resolve the @-references against the (already authorized) context and build the
    injectable block. Best-effort by design — a builder problem degrades to "no injection"
    (the woven situation text still carries the labels), NEVER to a failed advise turn.
    No context id ⇒ no injection (the default demo memory has no entity cards to read)."""
    if not references or not company_context_id:
        return None
    try:
        from avery.ingest.references import build_reference_block
        from avery.ingest.registry import active_registry
        ctx = active_registry().get(company_context_id)
        if ctx is None:
            return None
        block = build_reference_block(
            ctx, [{"kind": r.kind, "id": r.id, "label": r.label} for r in references])
        return block or None
    except Exception as e:   # noqa: BLE001 — injection must never break the advise path
        logger.warning("POST /advise: reference injection skipped (%s: %s)", type(e).__name__, e)
        return None


def _run_events(sit: live_input.LiveSituation,
                history: list[Any] | None = None) -> tuple[Iterator[dict[str, Any]], Any]:
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
        embedder=embedding_factory.make_embedder(),  # None -> keyword recall (key stays server-side)
        # #64: @ 引用的注入块钉进开场 user 轮——「保证进上下文」的兑现点（engine.py 该参注释）。
        preamble=sit.reference_block,
        # #71: 本场会话的前几轮，作为独立的 user/assistant 轮排在开场轮**之前**。
        # 刻意不塞进 LiveSituation：那个 dataclass 会被 build_live_case 写进 case 文件正文
        # （read_case 读得到），而历史轮是**对话**不是**材料**——写进 case 等于把上一轮的
        # 回答伪装成一份公司资料，recall/cite 会在上面引出处。
        history=history)
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
    swallowed — a quick-ask proposal must never break an advise that already succeeded.

    #72：整个终局 manifest 交给 maybe_ask_draft_frame（不再只是"看见过 manifest"这一位布尔）
    ——短答终局（answer_kind='answer'，事实已从记录里直接读出）不再弹快问卡，判据收敛的
    语义半边在那边实现。"""
    terminal: dict[str, Any] | None = None
    for ev in events:
        if ev.get("type") == "manifest" and ev.get("kind") in (None, "advice"):
            terminal = ev
        yield ev
    if terminal is not None:
        try:
            frame = maybe_ask_draft_frame(req.company_context_id, req.situation, terminal)
        except Exception:
            frame = None
        if frame:
            yield frame


def _with_thread_id(events: Iterator[dict[str, Any]], thread_id: str) -> Iterator[dict[str, Any]]:
    """issue #78 — 把这一场的 id 贴到 `started` 与 `manifest` 两种帧上（additive 顶层键）。

    为什么是这两种、为什么不新开一种帧：
      * `started` 是第一帧 —— 前端一开口就知道自己在写哪一场（早期对账）。
      * `manifest` 是 stream:false 那条缓冲路**唯一**回给调用方的东西（handler 末尾返回
        `{**manifest, "events": collected}`），不贴它，缓冲调用方就永远拿不到 id。
      * 🔴 绝不新开一种事件类型：前端 applyEvent 是 `switch (ev.type)` + `default: break`
        （src/lite2/streamSource.ts），未知帧型**整帧静默丢弃**，症状是「后端日志里发了、
        前端一点反应没有、没有任何报错」。

    🔴 也绝不塞进 `manifest["advice"]`：tests/test_service_contract.py 对 advice 载荷有一条
    `set(payload) <= REQUIRED|OPTIONAL` 的闭包断言，多一个键当场红。顶层是安全的。

    注入点在这里而不是 `_sse` 的 on_manifest hook 里：那个 hook 被 `except Exception: pass`
    整个包着，在那里赋值失败会静默——而「前端拿不到 thread_id」正是本票最不该静默的一件事。"""
    for ev in events:
        if thread_id and ev.get("type") in ("started", "manifest"):
            ev["thread_id"] = thread_id
        yield ev


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
                        locale: str, manifest: dict, thread_id: str = "") -> None:
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
    # ⚠ issue #78 的一条语义，写在这里因为它是这几行的直接后果：被按停的那一轮通常**不进历史**
    # （中止时根本没有 manifest，本 hook 一次都不会被调）。唯一的例外是「服务端已经答完、帧还
    # 没送到浏览器」那个窗口——那一轮会落库，于是它出现在历史场里而前端当时显示的是已中断。
    # 所以：历史场里只有完整轮，但「我按停的那轮一定不在」不是绝对保证。
    try:
        from avery.ingest.registry import active_registry
        active_registry().append_advise_run(company_context_id, situation,
                                            title=title or "", locale=locale,
                                            advice=advice, answer=answer,
                                            thread_id=thread_id)
    except Exception:   # lazy import / registry problems must not surface to the caller
        pass


def _post_advise_hooks(company_context_id: str | None, situation: str, title: str | None,
                       locale: str, manifest: dict, thread_id: str = "") -> None:
    """The one post-advise assembly point: notes (feat-033) + run history (issue #49; threads #78).
    Each hook swallows its own failures — one must never starve the other."""
    _post_advise_note(company_context_id, situation, manifest)
    _persist_advise_run(company_context_id, situation, title, locale, manifest, thread_id)


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
        company_context_id=req.company_context_id, locale=locale,
        # #64: authorize_context 已在上面把过门——这里解析引用只可能读到**本公司**的卡。
        reference_block=_build_reference_block(req.company_context_id, req.references))
    # #78 · 这一问属于哪一场。归一在 service/threads.py（坏值当没带，绝不 422）；没带就**服务端
    # 铸一个**并经 started/manifest 回传。铸点在 handler 而不是 _sse 的 on_manifest hook 里：
    # 那个 hook 被 `except Exception: pass` 整个包着，在那儿铸失败会静默，而「前端拿不到
    # thread_id」恰恰是本票最不该静默的一件事（前端会以为在续场、实际每问一场新的）。
    thread_id = normalize_thread_id(req.thread_id) or new_thread_id()
    events, case = _run_events(sit, req.history)
    events = _with_ask_frame(events, req)   # feat-034: maybe one ask-draft frame after the manifest
    events = _with_thread_id(events, thread_id)   # #78: additive 顶层键，贴 started + manifest

    if req.stream:
        return _sse(events, case,
                    on_manifest=lambda m: _post_advise_hooks(
                        req.company_context_id, req.situation, req.title, locale, m,
                        thread_id))

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
        _post_advise_hooks(req.company_context_id, req.situation, req.title, locale, manifest,
                           thread_id)
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
