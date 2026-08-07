# -*- coding: utf-8 -*-
"""T1 · form-backend-a1a —— 常驻表单的 HTTP 面：经理端点 + 员工侧 `/f/{token}` H5。

用户故事（gap-design-0805 §A1）：经理在资料库点「周报模板 → 生成本周链接」，选中传菜领班周雅，
拿到 `https://avery.../f/<token>`，微信转发。周雅手机打开，看到六格（06 表表头逐字 + 负载/情绪
自述），填完点提交，看到「已收到」。

COMPOSE, not modify（feat-018 纪律）：这个 router 骑的全是既有的缝——
  * `active_registry()` 存储、`authorize_context` / `extract_owner_token` 经理侧租户门
    （owner_token | X-Avery-Account 双通道，`ingest_api.py:133-165`）；
  * 员工页壳复用 `service/h5.py`（就是快问 `/r/{token}` 那张壳，T1 提取共用）；
  * 未知/过期的诚实姿态、`UPDATE ... WHERE submitted_at IS NULL` 的原子答一次锁，
    都照抄 feat-034 的做法，不发明第二套。

两个 token 世界，严格分开（与快问同一条契约）：
  * owner_token —— 经理凭据。**只走 header**，永不进 URL。未知 context 与错/缺 token 抛**同一个**
    404，surface 从不确认某个 context 存在（无枚举 oracle）。
  * share_token —— 员工凭据，铸链时 `secrets.token_urlsafe(32)`，一人一链。它**按设计**骑在
    `/f/<token>` URL 上：那是 IM webview 里唯一免登录能走通的路（拍板 #4）。它只读写恰好一个人
    的那一份提交。

🔴 渲染是**字段描述驱动**的（`_FIELD_RENDERERS`：kind → 渲染函数）。这不是风格偏好——这是后续票
（A2 回流人卡、A3 周期实例）不用重写渲染层的唯一前提。加题型 = 往表里加一项，改不到别处。

🔴 头号纪律（0805 拍板 #5）：表单只是与上传文件平权的又一路数据源。T2 · form-append-a1b 起，
提交落库后会被渲染成一份真正的资料文档 append 进 context（`avery.ingest.form_append`，走与
上传文件完全相同的 chunk/出处/引用契约——get→原地 mutate→put，绝不新造 CompanyContext）。
那是资料的**正门**，不是旁路；除它之外这里仍不许有任何通往资料层的通道。
"""
from __future__ import annotations

import logging
import secrets
from dataclasses import asdict
from typing import Any

from fastapi import APIRouter, Header, HTTPException, Query, Request
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field

from avery.ingest.form import (
    FIELD_KINDS, MAX_HELP_CHARS, MAX_LABEL_CHARS, MAX_RECIPIENTS_PER_MINT, MAX_TITLE_CHARS,
    NUMBER_MAX_CEIL, NUMBER_MIN_FLOOR,
    FormField, FormSubmission, FormTemplate,
    current_period, default_expiry, effective_submission_status, ensure_builtin_templates,
    new_submission_id, new_template_id, now_iso, parse_submitted_answers,
    validate_template_shape,
)
from avery.ingest.form_append import append_submission_to_context
from avery.ingest.form_autofill import ensure_current_period_links
from avery.ingest.registry import active_registry

from . import account, h5
from .ask_api import public_base
from .ingest_api import authorize_context, extract_owner_token

logger = logging.getLogger(__name__)

router = APIRouter()

SHARE_TOKEN_BYTES = 32     # 与 owner_token / 快问 share_token 同一熵级（~256 bit，url-safe）


# ── 经理侧请求体 ────────────────────────────────────────────────────────────────────────────────

class FormRecipientIn(BaseModel):
    """铸链发给谁。`id` 是 01 表的人员ID —— 归并按 ID 不按姓名（酒店有同名/花名，按名会并错人）。

    T5/A2：`id` 留空**不是**等价选项。公司里只要有两个人同名，没带工号的那份提交就回流不到任何
    一张人卡（挑一个是掷硬币）——资料照样进库，卡上不会多出那个数字。经理侧选人时请带上工号。

    `project_ref` 是这条链绑的项目名称（02 表「项目名称」/ 项目卡标题）。绑了，这个人这一格
    「未达成及原因 / 需要支持」的原话就会追加成那张项目卡的阻塞原句；不绑，回流只走人卡。
    逐条链绑而不是整张模板绑：同一张周报，不同的人本来就在不同的项目上。
    """
    model_config = {"extra": "forbid"}
    id: str = Field("", max_length=120)
    name: str = Field(..., min_length=1, max_length=120)
    project_ref: str = Field("", max_length=200)


class MintLinksBody(BaseModel):
    model_config = {"extra": "forbid"}
    recipients: list[FormRecipientIn] = Field(default_factory=list)
    period: str = Field("", max_length=40)


class FormFieldIn(BaseModel):
    """一格的**字段描述**。`extra=forbid`：新键必须先在 `avery.ingest.form.FormField` 上立起来，
    不许从 HTTP 面偷偷长出一个渲染层和校验层都不认识的属性。"""
    model_config = {"extra": "forbid"}
    id: str = Field(..., min_length=1, max_length=60)
    kind: str = Field(..., min_length=1, max_length=20)
    label: str = Field(..., min_length=1, max_length=MAX_LABEL_CHARS)
    help: str = Field("", max_length=MAX_HELP_CHARS)
    required: bool = True
    choices: list[str] = Field(default_factory=list)
    min: int = NUMBER_MIN_FLOOR
    max: int = NUMBER_MAX_CEIL
    # T5/A2 —— 这一格的答案是一句情境陈述（回流成人卡情境信号 / 项目卡阻塞原句）。
    # 必须在这里出现：`extra='forbid'` + `FormFieldIn(**...)` 往回建 FormField，漏了这个键，
    # 经理在前端存一次模板就把内置周报的两个 `situational=True` 静默抹平了，回流从此不响。
    situational: bool = False


class FormTemplateIn(BaseModel):
    model_config = {"extra": "forbid"}
    id: str = Field("", max_length=60)          # 空 = 服务端铸一个新 id
    title: str = Field(..., min_length=1, max_length=MAX_TITLE_CHARS)
    fields: list[FormFieldIn] = Field(default_factory=list)
    active: bool = True


# ── 经理端点（门与 notes / advise-runs 同一张：owner_token 或持有账号，否则 404）──────────────

@router.get("/team/{context_id}/forms")
def list_forms(context_id: str,
               x_avery_token: str | None = Header(None),
               authorization: str | None = Header(None),
               x_avery_account: str | None = Header(None)) -> dict:
    """这家公司的常驻表单模板。内置模板（「周报」）在这里**按需铸进**这家公司的表单库——
    见 `form.ensure_builtin_templates` 的注释：铸成真行是为了把题面快照住，否则哪天代码里改了
    字段，去年的提交会跟着变意思。"""
    reg = active_registry()
    authorize_context(reg, context_id, extract_owner_token(x_avery_token, authorization),
                      account.resolve_account(x_avery_account))
    templates = ensure_builtin_templates(reg, context_id)
    return {"context_id": context_id,
            "templates": [_template_payload(t) for t in templates]}


@router.post("/team/{context_id}/forms")
def save_form(context_id: str, body: FormTemplateIn,
              x_avery_token: str | None = Header(None),
              authorization: str | None = Header(None),
              x_avery_account: str | None = Header(None)) -> dict:
    """建一张模板，或按 id 覆盖一张已有的（形状照 `POST /team/{id}/notes` 的先例：鉴权 → 写 →
    ValueError→422）。**两道门都在这**：

      1. 结构门 `validate_template_shape` —— 坏形状永不落库（未知 kind、重复字段 id、choice 少于
         两个选项、number 上下界越界…），422 带人话原因；
      2. 🔴 红线门 `gate_form_red_line`（在 registry 的 `put_form_template` 里，两个双胞胎共用的
         那道存储门）—— 一张给人打分的题面在任何 INSERT 之前就被拒，422。

    ⚠ 已有提交的模板被覆盖时，老提交的答案是按 `field.id` 落的：改 label 安全，**改/删 field.id
    会让老答案对不上号**。所以这里不动 id 就只是改题面，动 id 等于开一张新表。"""
    reg = active_registry()
    authorize_context(reg, context_id, extract_owner_token(x_avery_token, authorization),
                      account.resolve_account(x_avery_account))
    template = FormTemplate(
        context_id=context_id,
        id=(body.id or "").strip() or new_template_id(),
        title=body.title.strip(),
        fields=[FormField(id=f.id.strip(), kind=f.kind.strip(), label=f.label.strip(),
                          help=(f.help or "").strip(), required=bool(f.required),
                          choices=[c.strip() for c in f.choices], min=f.min, max=f.max)
                for f in body.fields],
        active=bool(body.active),
        created_at=now_iso())
    reason = validate_template_shape(template)
    if reason:
        raise HTTPException(status_code=422,
                            detail={"error": "form rejected", "reason": reason})
    try:
        stored = reg.put_form_template(template)
    except ValueError as e:   # 🔴 存储门（红线 / NUL）—— 干净的 422，绝不 500
        raise HTTPException(status_code=422,
                            detail={"error": "form rejected", "reason": str(e)})
    return {"context_id": context_id, "template": _template_payload(stored)}


@router.post("/team/{context_id}/forms/{template_id}/links")
def mint_links(context_id: str, template_id: str, body: MintLinksBody,
               x_avery_token: str | None = Header(None),
               authorization: str | None = Header(None),
               x_avery_account: str | None = Header(None)) -> dict:
    """给选中的人各铸一条不可猜的 `/f/<token>` 链接（一人一链，7 天过期 —— 拍板 #4）。
    经理自己去粘贴转发：**转发这个动作就是人的闸**，服务端不发消息、不碰 IM。

    每次调用都铸**新**链接（不是幂等的）——「这周的周报」和「上周的周报」是两份不同的提交，
    重复调用等于再发一轮，老链接照常有效直到过期或被填。"""
    reg = active_registry()
    authorize_context(reg, context_id, extract_owner_token(x_avery_token, authorization),
                      account.resolve_account(x_avery_account))
    recipients = body.recipients or []
    if not (1 <= len(recipients) <= MAX_RECIPIENTS_PER_MINT):
        raise HTTPException(status_code=422, detail={
            "error": "form link mint rejected",
            "reason": f"a mint goes to 1 to {MAX_RECIPIENTS_PER_MINT} named people "
                      f"(got {len(recipients)})"})
    ensure_builtin_templates(reg, context_id)
    template = reg.get_form_template(context_id, template_id)
    if template is None:
        raise HTTPException(status_code=404, detail=f"unknown form template: {template_id}")
    if not template.active:
        raise HTTPException(status_code=409, detail={
            "error": "not mintable", "reason": "this form is retired — no new links go out"})

    period = (body.period or "").strip() or current_period()
    created = now_iso()
    minted = []
    for r in recipients:
        sub = FormSubmission(
            id=new_submission_id(), context_id=context_id, template_id=template.id,
            person_id=(r.id or "").strip(), person_name=r.name.strip(), period=period,
            project_ref=(r.project_ref or "").strip(),
            share_token=secrets.token_urlsafe(SHARE_TOKEN_BYTES),
            created_at=created, expires_at=default_expiry(created))
        try:
            minted.append(reg.put_form_submission(sub))
        except ValueError as e:   # 存储门（NUL 之类）——干净的 422，绝不 500
            raise HTTPException(status_code=422, detail={
                "error": "form link mint rejected", "reason": str(e)})
    return {"context_id": context_id, "template_id": template.id, "period": period,
            "links": [_submission_payload(s, with_answers=False) for s in minted]}


@router.get("/team/{context_id}/forms/submissions")
def list_submissions(context_id: str,
                     template_id: str | None = Query(None),
                     limit: int = Query(200, ge=1, le=500),
                     x_avery_token: str | None = Header(None),
                     authorization: str | None = Header(None),
                     x_avery_account: str | None = Header(None)) -> dict:
    """「本周谁交了 / 谁没交」的唯一真相。铸链即建行，所以没交的人在这里是 `status='open'` 的行，
    不是缺席——前端不用去猜「名单减去交了的」。答案原样带回（员工的原话，不改写）。

    🔴 gap2 T9（#58）—— 这支端点现在**顺手把本期备好**：本期还没有链接、而上期有，就照着上期
    的名单铸出来（`form_autofill.ensure_current_period_links`）。为什么把一次写挂在读上：

      * 这是本仓的正统范式，不是新发明——内置模板就是「首次 GET 按需铸」（`ensure_builtin_templates`，
        本文件上面那支 `list_forms` 已经这么干了三票），demo 克隆的 GC 也是顺着请求顺手做的
        （`service/demo.py`）。**拍板口径明写不引 cron/调度器**（0807 grill 第 3 条）。
      * 挂在**这一支**而不是 `/team`：`/team` 是今天页每次刷新都打的那条路，经理可能根本没打开
        表单区，链接却已经悄悄发出去了。这支端点的语义就是「经理正在看表单收集」。

    幂等由两道锁保证（各挡各的，见 form_autofill 文件头）：本期已有行的人一律不铸（手动铸的
    也算），并发两发由库上唯一索引顶住。**手动铸链那一路一个字节没动。**

    补铸失败绝不吃掉这次读取：名单读得出来才是这支端点的本职，「本期没自动备好」是可以再来一次
    的事（下次经理刷新就补上），而「谁交了没交都看不到」不是。
    """
    reg = active_registry()
    ctx = authorize_context(reg, context_id, extract_owner_token(x_avery_token, authorization),
                            account.resolve_account(x_avery_account))
    autofilled: list[dict] = []
    try:
        ensure_builtin_templates(reg, context_id)
        outcomes = ensure_current_period_links(
            reg, context_id,
            # 上期绑的项目今天还在不在，要拿这家公司**当前**的项目卡去比；拿不到就传 None，
            # 此时绑定原样保留（absent≠none：读不到项目列表不等于项目没了）。
            projects=getattr(getattr(ctx, "extraction", None), "projects", None))
        autofilled = [{"template_id": o.template_id, "period": o.period,
                       "copied_from": o.copied_from, "minted": o.count}
                      for o in outcomes if o.count]
    except Exception:
        logger.exception(
            "T9: auto-filling this period's form links for %s failed — the submission list below "
            "is still the real one; the next refresh retries the fill", context_id)
    rows = reg.list_form_submissions(context_id, template_id, limit)
    payload: dict[str, Any] = {
        "context_id": context_id,
        "submissions": [_submission_payload(s, with_answers=True) for s in rows]}
    # additive key，空即缺席（同 playbooks / scoring_enabled 的姿态）：只有**这一次调用真的铸了
    # 链接**才出现。前端据此弹「本期已按上期名单备好（N 人）· 去调整」，并合成一条 'form' 通知
    # ——判据是一次真实的状态迁移，不是「本期有行」这种每次刷新都为真的静态事实。
    if autofilled:
        payload["auto_filled"] = autofilled
    return payload


@router.post("/team/{context_id}/forms/submissions/{submission_id}/void")
def void_submission(context_id: str, submission_id: str,
                    x_avery_token: str | None = Header(None),
                    authorization: str | None = Header(None),
                    x_avery_account: str | None = Header(None)) -> dict:
    """T9（#58）· 作废一条**还没交**的链接——「沿用上期（N 人）· 去调整」里的「去调整」。

    自动补铸照抄的是上期名单，而名单会过时：有人离职了、有人这周轮休、经理本来就想换人。
    没有这个出口，那几条链接会一直挂在「本期还差 N 人没交」里，把一个经理**无法消除**的数字
    印在今天页上——一条永远做不完的待办比没有待办更糟。

    作废 = 把到期时刻拨到此刻（`expire_form_submission` 的 docstring 讲了为什么不是删行：
    已交的不许动、删了会与自动补铸打成死循环、而「已过期」那张诚实页面是现成的）。
    要换人就照常走手动铸链——那条路本票一个字节没动。

    ⚠ 刻意**不**限定只有自动铸的行才能作废。经理在「谁没交」那一段里看到的是一排状态一样的行，
    他分不出哪条是系统备好的、哪条是他自己上周点出来的（也不该要求他分）；只在其中一部分上
    长出按钮，是把一个内部实现细节做成了界面规则。风险为零：作废非破坏性，随时可以再铸一条。

    门与本文件其余经理端点同一张：owner_token 或持有账号，否则同体 404 无枚举。"""
    reg = active_registry()
    authorize_context(reg, context_id, extract_owner_token(x_avery_token, authorization),
                      account.resolve_account(x_avery_account))
    sub = reg.get_form_submission(submission_id)
    # 🔴 跨租户越权与"不存在"必须**同体** 404：否则这支端点就成了一个"这个 id 在不在"的
    # 枚举 oracle（与 authorize_context 的无枚举姿态同一条线）。
    if sub is None or sub.context_id != context_id:
        raise HTTPException(status_code=404, detail=f"unknown form submission: {submission_id}")
    outcome = reg.expire_form_submission(submission_id, now_iso())
    if outcome == "unknown":
        raise HTTPException(status_code=404, detail=f"unknown form submission: {submission_id}")
    if outcome == "already":
        raise HTTPException(status_code=409, detail={
            "error": "already submitted",
            "reason": "this link has been filled in — the answers stay exactly as they are"})
    fresh = reg.get_form_submission(submission_id)
    return {"context_id": context_id, "submission_id": submission_id,
            "submission": _submission_payload(fresh, with_answers=False) if fresh else None}


def _template_payload(t) -> dict[str, Any]:
    return {"id": t.id, "title": t.title, "active": bool(t.active),
            "created_at": t.created_at, "fields": [asdict(f) for f in t.fields]}


def _submission_payload(s, *, with_answers: bool) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "id": s.id, "template_id": s.template_id,
        "person_id": s.person_id, "person_name": s.person_name, "period": s.period,
        "project_ref": s.project_ref,
        "status": effective_submission_status(s),
        "created_at": s.created_at, "expires_at": s.expires_at,
        "submitted_at": s.submitted_at or None,
        # T9 · 这一行是系统按上期名单**自动备好**的（True）还是经理亲手点出来的（False）。
        # 只发这个布尔，不发 `auto_key` 本身：那是幂等护栏的内部键（含姓名/工号），前端没有任何
        # 一处需要它，投出去只会多一个日后必须跟着维护的公开契约。
        "auto": bool(s.auto_key),
    }
    if s.share_token:
        payload["token"] = s.share_token
        payload["link"] = f"{public_base()}/f/{s.share_token}"
    if with_answers and s.answers is not None:
        payload["answers"] = list(s.answers)
    return payload


# ── 员工 H5（服务端直出，ZH 默认，零外部资源）─────────────────────────────────────────────────
# 文案两份 zh/en 同批出（AGENTS.md：大白话，SaaS 感可以接受；红线不变——不给人打分、不替客户断言）。

_COPY = {
    "zh": {
        "title": "填一份表单 · Avery",
        "og_desc": "你们负责人发来的一份常驻表单 —— 填完直接进你们公司的资料，几分钟的事。",
        "who_label": "谁在收",
        "who": "{company} 的负责人，通过 Avery 收集",
        "who_nocompany": "你们的负责人，通过 Avery 收集",
        "what_label": "填的是什么",
        "what": "{title}（{period}）",
        "vis_label": "填完给谁看",
        "vis": "原样进你们公司的资料库，负责人看得到。这是你自己对这段工作的说法，不是对你的评分。",
        "for_line": "这条链接是发给 {name} 的 —— 一人一链，交完即锁定。",
        "optional": "选填",
        "number_hint": "拖一下滑杆（默认停在 {value}）。",
        "submit": "提交",
        "submitted_title": "你已经交过了",
        "submitted_body": "提交后即锁定，无法修改 —— 这样你的原话才稳得住。",
        "submitted_at": "提交时间",
        "thanks_title": "已收到，谢谢！",
        "thanks_body": "这份内容已经进了你们公司的资料，负责人那边看得到。已锁定，不用再填一次。",
        "thanks_pending_title": "已收到，谢谢！",
        "thanks_pending_body": "你的回答已经存好并锁定，不用再填一次。转成公司资料的那一步这次"
                               "没走完，负责人稍后能补上——你这边不用再做什么。",
        "expired_title": "这条链接已过期",
        "expired_body": "链接超过了有效期（7 天）。如果还需要你填，请让负责人重新发一条。",
        "unknown_title": "链接不存在",
        "unknown_body": "没有找到这份表单 —— 请和发链接给你的人确认一下。",
        "gone_title": "这份表单已被撤下",
        "gone_body": "发起方把这张表撤了，这条链接不用填了。",
        "invalid_title": "还差一点",
        "invalid_body": "带 * 的几格都要填（写着「选填」的可以空着）。请返回上一页补齐后再提交。",
        "lang_switch": '<a class="h5-lang" href="?lang=en">English</a>',
    },
    "en": {
        "title": "Fill in a form · Avery",
        "og_desc": "A standing form from your manager — what you write goes straight into your "
                   "company's records. A few minutes.",
        "who_label": "Who collects this",
        "who": "Your manager at {company}, via Avery",
        "who_nocompany": "Your manager, via Avery",
        "what_label": "What this is",
        "what": "{title} ({period})",
        "vis_label": "Who sees it",
        "vis": "It goes verbatim into your company's records, where your manager can read it. "
               "This is your own account of the work — not a rating of you.",
        "for_line": "This link was made for {name} — one person, one link; it locks once sent.",
        "optional": "optional",
        "number_hint": "Drag the slider (it starts at {value}).",
        "submit": "Send it",
        "submitted_title": "You already sent this one",
        "submitted_body": "It locks on submit and can't be changed — that keeps your words yours.",
        "submitted_at": "Sent",
        "thanks_title": "Got it — thank you!",
        "thanks_body": "This is now part of your company's records and your manager can read it. "
                       "It's locked; no need to fill it again.",
        "thanks_pending_title": "Got it — thank you!",
        "thanks_pending_body": "Your answers are saved and locked; no need to fill it again. "
                               "Filing them into your company's records didn't complete this "
                               "time — your manager can finish that step later. Nothing more "
                               "needed from you.",
        "expired_title": "This link expired",
        "expired_body": "It outlived its window (seven days). Ask your manager for a fresh one "
                        "if they still need it.",
        "unknown_title": "Link not found",
        "unknown_body": "No form lives at this link — check it with whoever sent it to you.",
        "gone_title": "This form was withdrawn",
        "gone_body": "Whoever set it up has retired this form — nothing to fill in.",
        "invalid_title": "Nearly there",
        "invalid_body": "Every box marked * needs an answer (the ones marked optional can stay "
                        "empty). Go back and complete it.",
        "lang_switch": '<a class="h5-lang" href="?lang=zh">中文</a>',
    },
}

# 表单页多出来的几条规则（滑杆 + 读数 + 必填记号）。共用表 h5.H5_CSS 保持不动 —— 快问页的渲染
# 字节不许因为表单页多了个滑杆而变。
_FORM_CSS = """
.h5-opt{font-weight:400;color:#8a8f98;font-size:.8rem;margin-left:6px}
.h5-req{color:#1f6f5c;margin-left:4px}
.h5-num{display:flex;align-items:center;gap:12px;margin-top:8px}
.h5-num input[type=range]{flex:1;height:34px;accent-color:#1f6f5c}
.h5-num output{min-width:3.2rem;text-align:center;font-size:1.25rem;font-weight:700;
border:1.5px solid #d8d2c6;border-radius:10px;padding:6px 0;background:#faf9f6}
"""

_esc = h5.esc


def _lang(lang: str | None) -> dict:
    return _COPY["en"] if (lang or "").lower().startswith("en") else _COPY["zh"]


def _page(L: dict, og_title: str, og_desc: str, body_html: str) -> str:
    return h5.page(L, og_title, og_desc, body_html, "zh" if L is _COPY["zh"] else "en",
                   css=h5.H5_CSS + _FORM_CSS)


def _status_page(L: dict, key: str, status_code: int, extra: str = "") -> HTMLResponse:
    body = (
        '<div class="h5-card h5-status">'
        f"<h1>{_esc(L[key + '_title'])}</h1>"
        f"<p>{_esc(L[key + '_body'])}</p>{extra}"
        "</div>"
    )
    return HTMLResponse(_page(L, L[key + "_title"], L["og_desc"], body),
                        status_code=status_code)


def _submitted_extra(L: dict, sub) -> str:
    when = _esc((sub.submitted_at or "")[:16].replace("T", " "))
    return f'<p class="h5-meta">{_esc(L["submitted_at"])}: {when} UTC</p>' if when else ""


# ── 🔴 字段描述驱动的渲染表：kind → 渲染函数 ─────────────────────────────────────────────────
# 加一种题型 = 在这张表里加一项 + 在 form.parse_submitted_answers 里加一支判据。别的地方一个字
# 都不用改 —— 这正是本票要立的那条缝。

def _field_head(L: dict, f) -> str:
    mark = ('<span class="h5-req">*</span>' if f.required
            else f'<span class="h5-opt">{_esc(L["optional"])}</span>')
    head = f'<p class="h5-q">{_esc(f.label)}{mark}</p>'
    if f.help:
        head += f'<p class="h5-hint">{_esc(f.help)}</p>'
    return head


def _render_text(L: dict, f) -> str:
    from avery.ingest.form import MAX_TEXT_ANSWER_CHARS
    return (f'<textarea name="f_{_esc(f.id)}" maxlength="{MAX_TEXT_ANSWER_CHARS}"'
            f'{" required" if f.required else ""}></textarea>')


def _render_choice(L: dict, f) -> str:
    out = ['<div class="h5-yn">']
    for i, choice in enumerate(f.choices):
        rid = f"f_{f.id}_{i}"
        out.append(
            f'<label for="{_esc(rid)}">'
            f'<input type="radio" id="{_esc(rid)}" name="f_{_esc(f.id)}" '
            f'value="{_esc(choice)}"{" required" if f.required else ""}>'
            f'<span class="h5-btn">{_esc(choice)}</span></label>')
    out.append("</div>")
    return "".join(out)


def _render_number(L: dict, f) -> str:
    """0-100 滑杆 + 一直看得见的读数。

    ⚠ 诚实说明：滑杆**恒有值**（HTML range 没有「没选」这个态），初值停在中点。所以读数是常显的、
    hint 也把初值写出来 —— 员工提交前一定看得到即将交上去的那个数，没有藏起来的默认值。
    `oninput` 是内联属性、不是外部脚本；即便 webview 不跑它，滑杆本身照样提交（诚实降级）。"""
    start = (f.min + f.max) // 2
    return (
        '<div class="h5-num">'
        f'<input type="range" name="f_{_esc(f.id)}" min="{int(f.min)}" max="{int(f.max)}" '
        f'value="{start}" step="1" oninput="this.nextElementSibling.value=this.value">'
        f'<output>{start}</output>'
        "</div>"
        f'<p class="h5-hint">{_esc(L["number_hint"].format(value=start))}</p>'
    )


_FIELD_RENDERERS = {"text": _render_text, "choice": _render_choice, "number": _render_number}

if set(_FIELD_RENDERERS) != set(FIELD_KINDS):
    # 新增题型却忘了给渲染函数，页面上会静默少一格 —— 宁可起不来也不许静默少题。
    raise RuntimeError(
        f"form field kinds {sorted(FIELD_KINDS)} and renderers {sorted(_FIELD_RENDERERS)} "
        "drifted apart — every kind needs a renderer")


def _form_page(L: dict, template, sub, company: str, token: str) -> str:
    action = f"/f/{_esc(token)}/submit" + ("?lang=en" if L is _COPY["en"] else "")
    about = L["what"].format(title=template.title, period=sub.period or "—")
    # /ingest 给每个 context 起的名字恒是占位符 "company"（ingest_api.py:309），真公司名目前没有
    # 采集面。与其在员工眼前印出「company 的负责人」这种半英文，不如说「你们的负责人」——
    # 一样准确，读着是人话。有真名字时照常带上。
    who = (L["who"].format(company=company) if company and company != "company"
           else L["who_nocompany"])
    rows = []
    for f in template.fields:
        rows.append(_field_head(L, f))
        rows.append(_FIELD_RENDERERS[f.kind](L, f))
    body = (
        '<div class="h5-card">'
        f"<h1>{_esc(template.title)}</h1>"
        f'<p class="h5-who"><b>{_esc(L["who_label"])}</b>：{_esc(who)}</p>'
        f'<p class="h5-what"><b>{_esc(L["what_label"])}</b>：{_esc(about)}</p>'
        f'<p class="h5-visibility"><b>{_esc(L["vis_label"])}</b>：{_esc(L["vis"])}</p>'
        f'<p class="h5-for">{_esc(L["for_line"].format(name=sub.person_name))}</p>'
        f'<form method="post" action="{action}">'
        + "".join(rows)
        + f'<button type="submit" class="h5-submit">{_esc(L["submit"])}</button>'
        "</form></div>"
    )
    return _page(L, f"{template.title}·{sub.person_name}", L["og_desc"], body)


def _resolve_link(token: str, L: dict):
    """GET/POST 共用的解析：-> (submission, template) 或一张诚实的状态页。

    三态都是大声说出来的（feat-028 纪律，不做兜底渲染）：未知 token → 404；过期 → 404；
    模板被撤下 → 410。已提交由调用方各自处理（GET 给锁定页 200，POST 给 409）。"""
    reg = active_registry()
    sub = reg.get_form_submission_by_token(token)
    if sub is None:
        return _status_page(L, "unknown", 404)
    if effective_submission_status(sub) == "expired":
        return _status_page(L, "expired", 404)
    template = reg.get_form_template(sub.context_id, sub.template_id)
    if template is None:
        return _status_page(L, "gone", 410)
    return sub, template


@router.get("/f/{token}", response_class=HTMLResponse)
def form_page(token: str, lang: str | None = None):
    """员工填写页（按设计免登录 —— token 就是凭据，且只读到恰好一个人的那一份）。
    页面上只出现**这一个人**；同一轮铸出去的其他人的姓名/答案永不在这里出现（一人一链）。"""
    L = _lang(lang)
    resolved = _resolve_link(token, L)
    if isinstance(resolved, HTMLResponse):
        return resolved
    sub, template = resolved
    if sub.submitted_at:
        return _status_page(L, "submitted", 200, _submitted_extra(L, sub))
    reg = active_registry()
    ctx = reg.get(sub.context_id)
    company = getattr(ctx, "name", "") or "company"
    return HTMLResponse(_form_page(L, template, sub, company, token))


@router.post("/f/{token}/submit", response_class=HTMLResponse)
async def form_submit(token: str, request: Request, lang: str | None = None):
    """收下这一份，只收一次。锁在服务端且是原子的（registry 的 record_form_answers 只落在
    `submitted_at IS NULL` 的那一行）——重复提交拿到 409 的「已交过」页，**首答原封不动**。

    T2 · form-append-a1b：落库拿到首答锁之后，同一请求内把这份提交渲染成一份与上传文件平权的
    资料文档 append 进公司 context（`avery.ingest.form_append`）。append 失败**不回滚提交**——
    答案已经安全落地、锁已经拿到，重走一遍只会撞 409；资料层由经理侧
    `POST /team/{context_id}/forms/{submission_id}/ingest` 补灌，员工页则换一份不撒谎的文案
    （thanks_pending：不说「已经进了资料」这句此刻不真的话）。"""
    L = _lang(lang)
    resolved = _resolve_link(token, L)
    if isinstance(resolved, HTMLResponse):
        return resolved
    sub, template = resolved
    if sub.submitted_at:
        return _status_page(L, "submitted", 409, _submitted_extra(L, sub))
    form = await request.form()
    answers, err = parse_submitted_answers(template, form.get)
    if err:
        logger.info("T1: form submission refused (%s)", err)
        return _status_page(L, "invalid", 422)
    reg = active_registry()
    outcome = reg.record_form_answers(token, answers, now_iso())
    if outcome == "already":
        return _status_page(L, "submitted", 409)
    if outcome == "unknown":
        return _status_page(L, "unknown", 404)
    filed = False
    try:
        fresh = reg.get_form_submission_by_token(token)   # 库里的定稿行：answers + submitted_at 已盖章
        if fresh is not None:
            append_submission_to_context(reg, template, fresh)
            filed = True
    except Exception:
        # token 是凭据，日志只留提交 id（可定位、不可冒用）。
        logger.exception(
            "T2: appending submission %s into context %s failed — the answers ARE saved; "
            "POST /team/{context_id}/forms/{submission_id}/ingest re-files it", sub.id,
            sub.context_id)
    return _status_page(L, "thanks" if filed else "thanks_pending", 200)


@router.post("/team/{context_id}/forms/{submission_id}/ingest")
def refile_submission(context_id: str, submission_id: str,
                      x_avery_token: str | None = Header(None),
                      authorization: str | None = Header(None),
                      x_avery_account: str | None = Header(None)) -> dict:
    """T2 —— 把一份已提交的表单（重新）灌进资料库。正常路径不需要它：员工提交那一刻就 append 了。
    它是修复面：提交时 append 失败（员工看到 thanks_pending 那一版文案）后，经理凭这支端点补灌。

    幂等：这份提交已在资料库里 → `appended: false`，绝不落第二份（判据是铸进 source_key 里的
    提交 id）。门与 notes / forms 同一张：owner_token 或持有账号，否则同体 404 无枚举。"""
    reg = active_registry()
    authorize_context(reg, context_id, extract_owner_token(x_avery_token, authorization),
                      account.resolve_account(x_avery_account))
    sub = reg.get_form_submission(submission_id)
    if sub is None or sub.context_id != context_id:
        raise HTTPException(status_code=404, detail=f"unknown form submission: {submission_id}")
    if sub.answers is None:
        raise HTTPException(status_code=409, detail={
            "error": "not submitted yet",
            "reason": "this link has not been filled in — there is nothing to file"})
    template = reg.get_form_template(context_id, sub.template_id)
    if template is None:   # 与员工页 _resolve_link 的 410 同一姿态：模板被撤，说撤了
        raise HTTPException(status_code=410, detail={
            "error": "template withdrawn",
            "reason": f"form template {sub.template_id} no longer exists for this company"})
    try:
        sd, appended = append_submission_to_context(reg, template, sub)
    except KeyError:   # authorize 之后 context 理论上恒在；防御性同体 404（无存在性 oracle）
        raise HTTPException(status_code=404,
                            detail=f"unknown company_context_id: {context_id}")
    except ValueError as e:
        raise HTTPException(status_code=422,
                            detail={"error": "append rejected", "reason": str(e)})
    return {"context_id": context_id, "submission_id": submission_id, "appended": appended,
            "file": {"filename": sd.filename, "source_key": sd.source_key,
                     "status": sd.status, "uploaded_at": sd.uploaded_at}}
