# -*- coding: utf-8 -*-
"""T9 · forms-proactive（gap2 战役，gh issue #58）—— 进入新周期时**自动把本期链接备好**。

## 这一段解决什么

到 T8 为止，「常驻表单」是全手动的：经理每周得自己想起来打开资料库、挑人、点「生成本周链接」。
想不起来 = 这一周没有任何人被问到。Danny 0807 复盘里那句「主动」，落到站内就是这件事：
**经理一打开表单区，本期的链接已经按上期的名单备好了**，他只需要看一眼、要改再改。

## 三条拍板口径（0807 grill，逐条对得上）

1. **半径 = 站内为先**：不出 App、零新通道基建。这里只建行，**不发任何消息**——转发依然是人的闸
   （拍板 #4 的老规矩，`form_api.mint_links` 的 docstring 讲过）。
2. **代办深度 = 照抄上期、可改**：沿用上期的收件人与 `project_ref` 绑定。名单是经理上期**亲手选
   的**，照抄它不算替经理断言；界面上明写「沿用上期（N 人）· 去调整」，改的入口一直在。
3. **不引 cron/调度器**：触发挂在流量上。本仓已有两个同形先例——demo 克隆的 GC（`service/demo.py`
   顺着请求顺手清）与内置模板的「首次 GET 按需铸」（`form.ensure_builtin_templates`）。

## 🔴 两道锁挡两件不同的事（别当成一把锁加两层）

自动补铸必须在两个方向上都不重复，而这两个方向的威胁**不是同一件事**：

* **「经理已经手动铸过本期了」** —— 手动行在库里没有 `auto_key`（0015 迁移文件头讲了为什么不能给
  手动路径加唯一约束：那会把「重复调用等于再发一轮」这条设计意图静默废掉）。所以库上那条索引
  **看不见**手动行。挡它的是本模块 `_已经有链接的人` 这一步：按本期**全部**行算，
  `open / submitted / expired` 任意态都算「这个人已经有了」。
  ⚠ 过期行尤其要算进去——过期是读时现算、没人清也不该清（`form.effective_submission_status`），
  把 expired 当成「没铸过」的后果是每周给同一个人重复发链接。
* **「两个请求同时判定本期没有行」** —— 两边都查到空、两边都建行。先查后插挡不住这一幕，
  所以挡它的是 Postgres 那条部分唯一索引（0015）+ `put_form_submission_if_absent` 的
  `ON CONFLICT DO NOTHING`，事务级。

两把锁 → 两道门（`tests/test_form_autofill_t9.py` 的手动抑制自动那条，与
`tests/test_form_store_contract.py` 的 `@needs_db` 并发双写那条），各验各的，不互相顶替。

## 不做什么

* **不碰手动路径**：`mint_links` 一个字节不改。
* **不猜项目**：上期绑的项目今天在项目卡里找不到（改了名 / 归档了 / 当初就打错字），这一格
  **退回不绑**，绝不凭一个名字新建项目卡（`form_reflow.find_bound_project` 的同一条纪律）。
* **不替经理决定周期**：`period` 只在服务端由 `form.current_period()` 算，前端不许自己再算一遍
  ISO 周（跨年/跨时区各错一次，而且会得出第二个真相）。
"""
from __future__ import annotations

import logging
import secrets
from dataclasses import dataclass
from datetime import date

from .form import (
    FormSubmission, auto_mint_key, current_period, default_expiry, new_submission_id, now_iso,
    person_key,
)

log = logging.getLogger(__name__)

SHARE_TOKEN_BYTES = 32     # 与 form_api.mint_links 同一熵级（~256 bit, url-safe）

# 一次自动补铸最多建多少行。这**不是** `MAX_RECIPIENTS_PER_MINT`（那条 30 的上限管的是一次手动
# 请求体能点多少人——「一次铸链不是群发」）：上期的名单本来就可能由两三次手动铸链累积而成，
# 按 30 截断等于**静默漏掉**几个人这一周没收到表单，那是最坏的一种失败。
# 这里的 200 纯粹是失控护栏：一次 GET 顺手写这么多行已经不正常了，与其闷头写下去，不如整批
# 不铸并留一条日志，让人来看一眼。🔴 绝不截断后照铸——半份名单比没有名单更难发现。
MAX_AUTO_MINT_PER_PERIOD = 200


@dataclass(frozen=True)
class AutoMintOutcome:
    """这一次自动补铸干了什么。给 HTTP 面照实投出去用（界面那句「沿用上期（N 人）」的数就是它）。"""
    period: str = ""
    template_id: str = ""
    copied_from: str = ""              # 照抄的是哪一期；空 = 这次没铸
    minted: tuple[FormSubmission, ...] = ()
    # 上期绑的项目今天找不到了，于是这一格退回不绑。带出去只为可解释（回执/日志），不上界面。
    dropped_bindings: tuple[str, ...] = ()

    @property
    def count(self) -> int:
        return len(self.minted)


@dataclass(frozen=True)
class _Recipient:
    """上期名单里的一个人（照抄的单位）。"""
    person_id: str
    person_name: str
    project_ref: str


def _recipients_of(rows: list) -> list[_Recipient]:
    """上一期那批行 → 照抄用的收件人名单，**按人去重**。

    同一个人上期可能有两行（经理点了两次「再发一轮」）。去重认 `person_key`（有工号认工号，
    没有才退回姓名——0807 HITL 上同名两位同事被并成一张卡的那笔账就是这条尺立起来的）。
    重复时取**最后**一行的绑定：那是经理上期最后一次表态，比第一次更接近他现在的意思。

    顺序稳定 = 上期首次出现的顺序（不是 set 迭代序）：同样的输入必须铸出同样顺序的一批行，
    否则回执与门都跟着抖。
    """
    order: list[str] = []
    by_key: dict[str, _Recipient] = {}
    for s in rows:
        name = (s.person_name or "").strip()
        if not name:
            # 名字是 mint 的必填项（`FormRecipientIn.name` min_length=1）。真出现空名，说明这行
            # 是别的路径写进来的——照抄一个没名字的人只会铸出一条谁也认不出的链接，跳过。
            continue
        key = person_key(s.person_id, name)
        if key not in by_key:
            order.append(key)
        by_key[key] = _Recipient(person_id=(s.person_id or "").strip(), person_name=name,
                                 project_ref=(s.project_ref or "").strip())
    return [by_key[k] for k in order]


def _binding_survives(project_ref: str, projects) -> bool:
    """上期绑的那个项目今天还在不在。`projects` 为 None = 调用方没有项目卡可比 → **保留原绑定**。

    🔴 「拿不到项目列表」和「项目确实没了」是两回事。前者按后者处理，等于每次读不到项目卡就把
    全公司的绑定悄悄清一遍——那是替客户断言一件我们并不知道的事（本仓 absent≠none 的老规矩）。
    """
    if not project_ref:
        return True          # 本来就不绑，没有可掉的绑定
    if projects is None:
        return True
    from .form_reflow import find_bound_project
    return find_bound_project(list(projects), project_ref) is not None


def ensure_current_period_links(reg, context_id: str, *, today: date | None = None,
                                projects=None) -> list[AutoMintOutcome]:
    """本期还没有链接、而上期有 → 照着上期的名单把本期备好。返回每张模板各自的结果。

    调用点是经理侧读表单区那一下（`GET /team/{ctx}/forms/submissions`），与内置模板的
    「首次 GET 按需铸」同一个位置、同一条理由：**触发挂在流量上，不引调度器**。

    `today` 只为可复现（测试与回放显式传）；`projects` 是这家公司当前的项目卡，用来判断上期的
    绑定今天还在不在——传 None 表示调用方拿不到，此时绑定原样保留（见 `_binding_survives`）。

    🔴 这个函数**只对 active 模板动手**。停用的模板按 `mint_links` 的既有口径是 409「这张表撤了，
    不再发新链接」——自动路径当然更不该替它发。
    """
    period = current_period(today)
    outcomes: list[AutoMintOutcome] = []
    for template in reg.list_form_templates(context_id):
        if not getattr(template, "active", True):
            continue
        outcomes.append(_ensure_one_template(reg, context_id, template, period, projects))
    return [o for o in outcomes if o.count or o.dropped_bindings]


def _ensure_one_template(reg, context_id: str, template, period: str,
                         projects) -> AutoMintOutcome:
    current = reg.list_form_submissions_in_period(context_id, template.id, period)
    previous_period = reg.latest_form_period_before(context_id, template.id, period)
    if not previous_period:
        # 这张表从来没铸过链接。自动补铸**照抄**上期，没有上期就没有可照抄的东西——
        # 第一轮永远由经理亲手发起（挑谁、绑哪个项目是他的决定，不是我们的）。
        return AutoMintOutcome(period=period, template_id=template.id)

    previous = reg.list_form_submissions_in_period(context_id, template.id, previous_period)
    recipients = _recipients_of(previous)
    # 🔴 本期**任意态**的行都算「这个人已经有了」——open / submitted / expired 一视同仁。
    # 过期行没人清也不该清（读时现算是设计），把它当成「没铸过」＝每周给同一个人重复发链接。
    already = {person_key(s.person_id, s.person_name) for s in current}
    todo = [r for r in recipients if person_key(r.person_id, r.person_name) not in already]
    if not todo:
        return AutoMintOutcome(period=period, template_id=template.id,
                               copied_from=previous_period)
    if len(todo) > MAX_AUTO_MINT_PER_PERIOD:
        log.warning(
            "T9 autofill: %s/%s would mint %d links for %s (ceiling %d) — minting NONE. "
            "A half-copied roster hides better than an absent one; look at this company by hand.",
            context_id, template.id, len(todo), period, MAX_AUTO_MINT_PER_PERIOD)
        return AutoMintOutcome(period=period, template_id=template.id,
                               copied_from=previous_period)

    created = now_iso()
    minted: list[FormSubmission] = []
    dropped: list[str] = []
    for r in todo:
        project_ref = r.project_ref
        if project_ref and not _binding_survives(project_ref, projects):
            dropped.append(project_ref)
            project_ref = ""          # 找不到就退回不绑，绝不猜一个近似的项目
        sub = FormSubmission(
            id=new_submission_id(), context_id=context_id, template_id=template.id,
            person_id=r.person_id, person_name=r.person_name, period=period,
            project_ref=project_ref,
            share_token=secrets.token_urlsafe(SHARE_TOKEN_BYTES),
            created_at=created, expires_at=default_expiry(created),
            auto_key=auto_mint_key(template.id, period, r.person_id, r.person_name))
        try:
            stored = reg.put_form_submission_if_absent(sub)
        except ValueError:
            # 存储门（NUL 之类）。一个人的名字带控制字符，不该让**整批**补铸失败——那会让
            # 其余同事这一周静默收不到表单。记一条、跳过这一个人。
            log.exception("T9 autofill: refused to store an auto link for one recipient in %s",
                          context_id)
            continue
        if stored is None:
            # 并发的另一次补铸抢先建了这一行（库上唯一索引判的）。这不是错误——本期这个人有链接了，
            # 目的已经达成。
            continue
        minted.append(stored)
    return AutoMintOutcome(period=period, template_id=template.id, copied_from=previous_period,
                           minted=tuple(minted), dropped_bindings=tuple(dropped))


# ── 「本期还差谁没交」——今天页那条同名规则的数据面 ──────────────────────────────────────────
# 🔴 这里只**读与数**，一个判断都不下：什么算「快到期了」、够不够上今天页，全部归
# `avery/decision_rules.py` 那张表（口径的唯一机器真源）。本模块要是自己判一次，屏幕上就会有
# 两套口径——那正是 `registry.briefing()` 那段长注释记着的旧伤。


@dataclass(frozen=True)
class FormPeriodStatus:
    """一张模板在**本期**的收集进度。喂给定级引擎的输入，不是给人看的句子。"""
    template_id: str
    template_title: str
    period: str
    # 还没交的那些人：`(姓名, 这条链的到期时刻 ISO)`。为什么带姓名进来——规则的证据面要逐条列出
    # 「谁」还没交（那是经理唯一能据此行动的东西），而计数就是这张列表的长度，不另存一个会漂的数。
    missing: tuple[tuple[str, str], ...] = ()
    submitted: int = 0
    expired: int = 0

    @property
    def total(self) -> int:
        return len(self.missing) + self.submitted + self.expired


def form_period_status(reg, context_id: str, *, today: date | None = None,
                       now=None) -> list[FormPeriodStatus]:
    """这家公司**本期**每张 active 模板的收集进度（没有本期行的模板不出现在结果里）。

    只读，绝不写——自动补铸是 `ensure_current_period_links` 的事，两件事不能挤在一个函数里：
    定级那条路（`/team` 回帧）每次都会调用本函数，让它顺手建行等于把写操作接到了另一条流量上。
    """
    from .form import effective_submission_status
    period = current_period(today)
    out: list[FormPeriodStatus] = []
    for template in reg.list_form_templates(context_id):
        if not getattr(template, "active", True):
            continue
        rows = reg.list_form_submissions_in_period(context_id, template.id, period)
        if not rows:
            continue
        missing: list[tuple[str, str]] = []
        submitted = expired = 0
        for s in rows:
            state = effective_submission_status(s, now)
            if state == "submitted":
                submitted += 1
            elif state == "expired":
                expired += 1
            else:
                missing.append(((s.person_name or "").strip(), s.expires_at or ""))
        out.append(FormPeriodStatus(
            template_id=template.id, template_title=template.title or "", period=period,
            missing=tuple(missing), submitted=submitted, expired=expired))
    return out
