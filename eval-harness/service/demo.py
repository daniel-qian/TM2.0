"""input-side-0721 · 3A 一键示例团队 — GET /demo/status + POST /demo/claim.

拍板（.issues/cr-align-0721/decisions.md 第 3 项 + Danny 0721 追加）：onboarding 闸门页第一屏
放「用示例团队先看看」，点一下拿到一个**已经有真团队**的工作区——投资人/客户 30 秒内看到
指挥室有数据的样子，不必先上传自己的文件。

机制（合约在 tests/test_demo_claim.py，克隆底座在 tests/test_registry_contract.py）：

  * 服务端从 `AVERY_DEMO_SEED_DIR` 里的 seed 文件**自铸**一个 demo 母本 context（首次 claim 时，
    加锁防并发双铸）。同一套机制两个世界都能跑：离线门 = heuristic 抽取秒出；生产 = LLM 抽取
    一次（部署后手动 claim 一次做暖场，顺便人工验质量）。母本 id 是内容寻址的
    （`ctx_demo_<sha1(文件名:大小)[:12]>`）——seed 换了自动重铸，不删旧行；
    `AVERY_DEMO_CONTEXT_ID` 可显式钉死（ops 覆盖口）。
  * 每次 claim 把母本**克隆**成访客私有副本（新 context_id + 新 owner_token，
    registry.clone_context）。为什么不共享母本：/advise 落笔记、/ask 落行，共享 token =
    访客互相写脏；为什么不做只读特判：要撒进每个写端点、还防不住下一个新写端点。
  * 母本的 owner_token 铸完即弃——没有任何 HTTP 路径能读母本本体，它只被克隆。
  * 母本自带一条「实时数据缺位」预铸笔记（Danny 3A 附注：示例要讲清 Avery 只看到文件成稿
    那天的世界），克隆副本继承。
  * 未配置 seed → /demo/status 报 available=false、/demo/claim 404 —— 前端按 status 能力探测
    决定那扇门露不露面（同 AuthPanel 探 /account/status 的套路，探不到就不出假按钮）。

红线：这里没有新的写自由度——铸造走的就是 /ingest 同一条 ingest_paths（红线门原样），克隆是
已过门内容的字节复制（见 clone_context 的注释）。/demo/claim 可选限流：AVERY_RATE_DEMO_PER_MIN
（upload_guard，默认关，ECS runbook 调）。
"""
from __future__ import annotations

import hashlib
import logging
import mimetypes
import os
import threading
from pathlib import Path

from fastapi import APIRouter, HTTPException
from starlette.concurrency import run_in_threadpool

from avery.ingest import ingest_paths
from avery.ingest.guards import SUPPORTED_EXTS
from avery.ingest.registry import SourceDocument, active_registry, new_context_id

from . import embedding_factory, extractor_factory
from .ingest_api import _team_payload, mint_owner_token

logger = logging.getLogger(__name__)

router = APIRouter()

# 首铸互斥：两个访客同时打第一个 claim，只有一个真的去跑（生产 LLM 铸造要两分钟 + 真钱）。
# 单 worker 部署（服务的既有姿态，见 ingest 的 threadpool 注释）下进程内锁就是全局锁。
_BUILD_LOCK = threading.Lock()

# 预铸笔记：Danny 3A 附注「除固定团队/项目/公司信息外，实时数据缺位也要呈现」。文案刻意
# 不点名文件数/文件名——离线小语料与生产三亚 seed 共用同一套机制，这条对两个世界都得是真话。
_GAP_NOTE = ("这是一个示例工作区：Avery 只读过这里的几份示例文件，看到的世界停在文件成稿的"
             "那一天。签约、回款、到访这类实时数据还没有接入——接入你们自己的系统之后，"
             "这里会跟着当天的数字走。")
_GAP_NOTE_EXCERPT = "示例团队 · 实时数据还没接入"


def _int_env(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, str(default)))
    except (TypeError, ValueError):
        return default


def _sweep_expired_clones(reg) -> None:
    """gc-demo-clones-0724: opportunistically TTL-collect stale demo guest clones on the claim path —
    the traffic that MINTS clones is what cleans them (GC scales with demo load, no scheduler/new
    infra). BEST-EFFORT by construction: the clone already committed, so a sweep failure NEVER fails
    the claim — it is logged and swallowed. The registry-side sweep is bounded (LIMIT) and self-timing-
    out (its own lock_timeout/statement_timeout), so this can't stall the claim. TTL/batch are env
    knobs (AVERY_DEMO_TTL_HOURS default 48h; AVERY_DEMO_GC_BATCH default 50)."""
    sweep = getattr(reg, "sweep_ephemeral", None)
    if sweep is None:                       # a registry without the GC seam — nothing to do
        return
    try:
        ttl = _int_env("AVERY_DEMO_TTL_HOURS", 48)
        n = sweep(older_than_hours=ttl, limit=_int_env("AVERY_DEMO_GC_BATCH", 50))
        if n:
            logger.info("demo GC: swept %d expired guest clone(s) (ttl=%dh)", n, ttl)
    except Exception:                        # noqa: BLE001 — GC must never break a successful claim
        logger.warning("demo GC sweep failed (ignored; claim already succeeded)", exc_info=True)


def _seed_dir() -> Path | None:
    raw = (os.environ.get("AVERY_DEMO_SEED_DIR") or "").strip()
    if not raw:
        return None
    d = Path(raw)
    return d if d.is_dir() else None


def _pinned_id() -> str:
    return (os.environ.get("AVERY_DEMO_CONTEXT_ID") or "").strip()


def _seed_files(d: Path) -> list[Path]:
    """Seed 目录里可解析的文件，排序后固定顺序（内容寻址 id 的输入必须稳定）。"""
    return sorted(
        p for p in d.iterdir()
        if p.is_file() and p.suffix.lstrip(".").lower() in SUPPORTED_EXTS and p.suffix)


def _master_id(files: list[Path]) -> str:
    pinned = _pinned_id()
    if pinned:
        return pinned
    h = hashlib.sha1(
        "\n".join(f"{p.name}:{p.stat().st_size}" for p in files).encode("utf-8")).hexdigest()
    return "ctx_demo_" + h[:12]


def _build_master(reg, master_id: str, files: list[Path]) -> None:
    """铸造母本：/ingest 同款管线（同一红线门、同一 prefer_vector 成本闸），加一条预铸笔记。"""
    embedder = embedding_factory.make_embedder()
    prefer_vector = embedder is not None and getattr(reg, "persistent", False)
    extractor = extractor_factory.make_extractor()
    src_docs = []
    for p in files:
        raw = p.read_bytes()
        mime = mimetypes.guess_type(p.name)[0] or "application/octet-stream"
        # source_key == 磁盘 basename == parse 名（目录里天然唯一），n_chunks 才能按文档归账。
        src_docs.append(SourceDocument(filename=p.name, source_key=p.name, mime=mime,
                                       size_bytes=len(raw), content=raw))
    rep = ingest_paths([str(p) for p in files], registry=reg, name="company",
                       context_id=master_id, extractor=extractor,
                       embedder=embedder if prefer_vector else None,
                       prefer_vector=prefer_vector,
                       source_documents=src_docs,
                       # 母本凭据铸完即弃：没有 HTTP 路径读母本，它只被克隆。
                       owner_token=mint_owner_token())
    if not rep.ok or rep.context is None:
        raise HTTPException(status_code=503, detail={
            "error": "demo seed failed to build",
            "reason": "red line refused the extraction" if rep.violations
                      else "no parseable content in the seed dir"})
    reg.append_note(master_id, _GAP_NOTE, _GAP_NOTE_EXCERPT)


@router.get("/demo/status")
def demo_status() -> dict:
    """能力探测（无鉴权、无副作用、不泄露任何 id/token）：这台后端有没有示例团队可领。"""
    d = _seed_dir()
    files = _seed_files(d) if d else []
    if not files:
        # 只钉了 id 没给 seed：母本在库里才算可用（丢了也不假装能领）。
        pinned = _pinned_id()
        ready = bool(pinned) and pinned in active_registry()
        return {"available": ready, "ready": ready}
    return {"available": True, "ready": _master_id(files) in active_registry()}


@router.post("/demo/claim")
async def demo_claim() -> dict:
    """领一个示例团队：克隆母本成访客私有副本，响应与 /ingest 同形（+ demo: true）。"""
    d = _seed_dir()
    files = _seed_files(d) if d else []
    pinned = _pinned_id()
    if not files and not pinned:
        raise HTTPException(status_code=404, detail="demo is not configured here")

    def _work() -> dict:
        reg = active_registry()
        master = _master_id(files) if files else pinned
        if master not in reg:
            if not files:
                raise HTTPException(status_code=404, detail="demo is not configured here")
            with _BUILD_LOCK:
                if master not in reg:      # 双检：排队的那位进来时母本可能已经铸好了
                    _build_master(reg, master, files)
        new_id = new_context_id()
        token = mint_owner_token()
        if not reg.clone_context(master, new_context_id=new_id, new_owner_token=token):
            raise HTTPException(status_code=503, detail="demo master vanished mid-claim")
        ctx = reg.get(new_id)
        if ctx is None:
            raise HTTPException(status_code=503, detail="demo clone did not land")
        # T10: 传 reg —— 克隆是 ephemeral 的，这一帧就要把 `ephemeral: true` 带出去，
        # 否则「补资料」入口会在领到示例团队之后闪一下才被下一次刷新收走。
        payload = _team_payload(ctx, reg=reg)
        payload["owner_token"] = token
        payload["demo"] = True     # 前端要标注「这是示例」语义，不许冒充用户自己的数据
        _sweep_expired_clones(reg)   # gc-demo-clones-0724: opportunistic TTL GC, best-effort
        return payload

    # 铸造（生产 LLM 路径分钟级）+ 克隆都是同步工作——丢线程池，别冻住单 worker 的事件循环
    # （同 /ingest 的 run_in_threadpool 理由：冻住 /health 会让 HEALTHCHECK 重启容器）。
    return await run_in_threadpool(_work)
