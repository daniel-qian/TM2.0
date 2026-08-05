"""`POST /ingest/structured` —— 表格行直接进 context，跳过抽取（onboarding-accounts-0805 ①）。

ADR-0034 拍板 1/2/3。与 `/ingest` 的关系是**并列的第二个写入口**，不是替代：

    /ingest             文件 ──▶ parse ──▶ LLM/启发式抽取（100–120s，有损）──▶ 红线门 ──▶ context
    /ingest/structured  表格行 ─▶ 确定性映射（秒级，零损）─┐
                        文件 ──▶ parse ──▶ 同一个抽取器 ───┴▶ 同一道红线门 ──▶ **同一个** context

所以本模块是一层薄 HTTP 壳，语义全部照抄 `ingest_api.py`——owner_token 铸造、
`LiveTeamPayload` 形状、422 体、404 姿态、guards、账号绑定，逐条复用**同一个函数**而不是
复述一遍。凡是这里出现的分支，都是表格入口独有的那部分：

  * `tables` 的解析与映射（`avery/ingest/structured.py`）；
  * 表格红线的**提前**整发拒（拿到格坐标就不必等到管线里那道，用户能被指到具体的格）；
  * 「一行没有、一个文件也没有」这种空提交的 400。

🔴 红线的权威门仍然是管线里那一道（`pipeline.ingest_docs` → `validate_extraction`）。本模块
提前跑的那一遍是为了**坐标**，不是为了替代它——见 `structured.scan_roster_rows` 的注释。
"""
from __future__ import annotations

import json
import mimetypes
import tempfile
from pathlib import Path

from fastapi import APIRouter, File, Form, Header, HTTPException, UploadFile
from starlette.concurrency import run_in_threadpool

from avery.ingest import guards, ingest_paths
from avery.ingest.registry import SourceDocument, active_registry
from avery.ingest.structured import (
    FORM_IDS,
    IntakeError,
    build_intake,
    max_rows_per_table,
)

from . import account, embedding_factory, extractor_factory, upload_guard
from .ingest_api import _team_payload, _unique_parse_names, mint_owner_token

router = APIRouter()


def _violation_body(violations, cells) -> dict:
    """422 体 —— `violations` 与 `/ingest` **逐键相同**，坐标走并列的加法字段。

    形状不许分家：前端已经有一段读 /ingest 422 的代码，第二个入口发第二种形状 = 第二段解析
    代码 + 两边各漂。`cells` 是加法字段（空即缺席，absent≠none 的房规），只有表格入口填得出。
    """
    body = {
        "error": "extraction refused",
        "reason": "red line: a person-scoring/ranking field was submitted",
        "violations": [{"kind": v.kind, "person": v.person, "detail": v.detail,
                        "rule_id": v.rule_id} for v in violations],
        "parse_errors": [],
    }
    if cells:
        body["cells"] = [c.as_dict() for c in cells]
    return body


@router.post("/ingest/structured")
async def ingest_structured(
    tables: str = Form("{}"),
    files: list[UploadFile] = File(default=[]),
    x_avery_account: str | None = Header(None),
) -> dict:
    """表格行（+ 可选附带文件）→ 一个 CompanyContext + 首帧 Your-team payload。

    `tables` 是 multipart 里的一个 **JSON 字符串 part**（不是 body——同一发里还要带文件）。
    形状：`{"01": [{"姓名": "…", "岗位": "…"}, …], "02": [...]}`。表名可写编号、sheet 全名或
    去编号的表名；列键可写规范键或表头原文（含 ` *`）——三种写法都通向同一份
    `intake_schema.json`，前端不必发明第三套键名（票 #40 硬约束）。

    feat-053 照 /ingest：**不要求登录**（游客路径是硬性产品要求）；已登录则顺手绑账号。
    """
    try:
        parsed_tables = json.loads(tables or "{}")
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=400, detail={
            "error": "bad tables payload", "reason": f"tables 不是合法 JSON：{e}"})

    try:
        intake = build_intake(parsed_tables)
    except IntakeError as e:
        # 结构错误（未知表名 / 行数超限 / 行不是对象）是**请求格式**问题，不是红线。
        # 分开报，用户才知道是"表填错了"还是"写了不许写的东西"。
        raise HTTPException(status_code=400, detail={
            "error": "bad tables payload", "reason": str(e),
            "known_tables": list(FORM_IDS), "max_rows_per_table": max_rows_per_table()})

    # 🔴 红线在**碰任何字节之前**整发拒（拍板 2）：没有 context 被注册，附带文件一个都不读。
    # 提前到这里是为了那句承诺的完整性——「同一批里的其他表也会一起失败」。
    if not intake.ok:
        raise HTTPException(status_code=422, detail=_violation_body(intake.violations, intake.cells))

    if intake.row_count == 0 and not files:
        raise HTTPException(status_code=400, detail={
            "error": "nothing submitted",
            "reason": "这一发既没有表格行也没有文件"})

    if files:
        upload_guard.enforce_count(len(files))

    owner_token = mint_owner_token()

    per_file_cap = guards.max_file_bytes()
    total_cap = guards.max_total_bytes()
    running_total = 0
    tmp = Path(tempfile.mkdtemp(prefix="avery-intake-"))
    saved: list[Path] = []
    src_docs: list[SourceDocument] = []
    try:
        # 文件侧与 /ingest 逐行同构（basename 防穿越 → 去重命名 → 逐文件读进上限 → 类型/压缩弹
        # 检查 → 落盘 + 建 SourceDocument）。这里不做任何"表格入口所以宽一点"的让步。
        display_names = [Path(f.filename or "upload").name or "upload" for f in files]
        parse_names = _unique_parse_names(display_names)
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
            mime = f.content_type or mimetypes.guess_type(display)[0] or "application/octet-stream"
            src_docs.append(SourceDocument(filename=display, source_key=parse_name, mime=mime,
                                           size_bytes=len(raw), content=raw))

        def _ingest() -> object:
            registry = active_registry()
            embedder = embedding_factory.make_embedder()
            prefer_vector = embedder is not None and getattr(registry, "persistent", False)
            # 纯表格提交不需要抽取器，但**仍然构造**它：混合发里的文件要用；而且
            # extraction_mode 是发给前端的诚实标签，它必须报告这一发真正用了什么。
            extractor = extractor_factory.make_extractor() if saved else None
            rep = ingest_paths([str(p) for p in saved], registry=registry, name="company",
                               extractor=extractor,
                               embedder=embedder if prefer_vector else None,
                               prefer_vector=prefer_vector,
                               source_documents=src_docs,
                               owner_token=owner_token,
                               extra_extraction=intake.result)
            mode = extractor_factory.extraction_mode(extractor) if extractor else "structured"
            return rep, mode

        try:
            report, extraction_mode = await run_in_threadpool(_ingest)
        except ValueError as e:
            raise HTTPException(status_code=422, detail={
                "error": "upload rejected", "reason": str(e)})

        if not report.ok or report.context is None:
            # 权威红线门（或整批不可解析）拒了。坐标这一层给不出——那道门扫的是拼起来的人身
            # 文本，不是格（见 structured.scan_roster_rows 的口径差说明），所以这里如实不发 cells。
            raise HTTPException(status_code=422, detail={
                "error": "extraction refused",
                "reason": ("red line: a person-scoring/ranking field was extracted"
                           if report.violations else "no parseable content in the upload"),
                "violations": [{"kind": v.kind, "person": v.person, "detail": v.detail,
                                "rule_id": v.rule_id} for v in report.violations],
                "parse_errors": report.parse_errors,
            })

        payload = _team_payload(report.context)
        payload["owner_token"] = owner_token
        uploader = account.resolve_account(x_avery_account)
        if uploader:
            try:
                link = getattr(active_registry(), "link_account_context", None)
                if link is not None:
                    payload["account_linked"] = bool(link(uploader, report.context.context_id))
            except Exception:
                payload["account_linked"] = False
        # 'structured' = 这一发一个模型都没调用（纯表格）。混合发照实报文件侧真正走的那条路
        # （llm / heuristic / degraded）——前端的等待态与诚实标都按它分支。
        payload["extraction_mode"] = extraction_mode
        # 表格入口独有的加法字段：映射时记下的黄色提醒（悬空引用 / 读不懂的值 / 重复 ID）。
        # 它们**不拒**这一发，但用户有权知道哪几格没能长成卡片。空即缺席。
        if intake.warnings:
            payload["intake_warnings"] = [w.as_dict() for w in intake.warnings]
        payload["intake_rows"] = intake.row_count
        return payload
    finally:
        for p in saved:
            p.unlink(missing_ok=True)
        try:
            tmp.rmdir()
        except OSError:
            pass
