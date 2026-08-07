# -*- coding: utf-8 -*-
"""T5 · form-reflow-a2 —— 表单回流人卡 / 项目卡（gap-design-0805 §A2）。

T2 已经把一次提交变成了一份与上传文件平权的资料文档。本模块是**在那之上加的一层解析**：同一份
文档里，那一行 `周雅｜负载自述：72｜情绪自述：偏紧` 被解析层读成人卡上的自述槽，两格情境自由文本
成为带出处的情境信号，绑了项目的那条链再把同一句话追加成项目卡的阻塞原句。

🔴 命门①（A0-2，本模块存在的唯一理由）：**人身数字只能走解析层。**
`registry._apply_person_fields` 明写「不碰 self_report」、`ingest_api.PersonIn/PersonPatch` 是
`extra='forbid'` 且没有这个键——手编 HTTP 通道永远碰不到自述槽。所以这里也**不许**自己
`person.self_report = ...`：数字必须由 `HeuristicExtractor._selfreport_from_lines` 从文档文本里
读出来（`caliber` 是 dataclass 默认值「本人自述」、`source` 由解析层按 `<key>:<行>` 铸），本模块只
负责把那条读数放到对的人身上。少一条旁路，护城河就少一个缺口。

🔴 命门②（模仿攻击）：员工在自由文本里写 `张三｜负载自述：99` 不得被当真。**两道锁，互相独立**：
  1. T2 的结构锁 —— 自由文本里的 `｜`/`|` 一律转义成 `¦`，那一行在解析器眼里切不出第二格
     （`form_append.escape_vertical_bars`）。
  2. 本模块的身份锁 —— 解析出来的自述人里，**只**留下名字等于 `submission.person_name` 的那一个
     （`_person_key` 同一把尺）。谁交的表就只能给谁自述，锁 1 万一被绕过，这一条还在。
并且：工号取自 `submission.person_id` 这个**结构化字段**，绝不从文档文本里读。文档里的
「人员ID：P-0007」是渲染给人看的元数据行，它**没有分隔符可转义**——员工完全可以在自由文本里
写出一模一样的一行。任何"从文档里解析工号"的写法都是一个自带钥匙的后门。

🔴 命门③（投影不开后门）：自述**存储恒有**，人卡上显不显示由 `AVERY_ALLOW_PERSON_SCORING` 在
`registry.team_cards()` 那一处决定。本模块一次都不读那个开关。

🔴 命门④（员工的话不能弄砸提交）：答案是员工本人的话，按 ADR-0023 不过红线门。但一条
`SignalEntity` 是**卡面产物**，会进 `validate_extraction` 的扫描面。所以候选信号在这里逐条预检：
不过的那条**丢掉信号**（原话照旧逐字躺在资料里、议事室照旧引得到），绝不让它去炸整份提交——
否则员工写一句什么，`append_submission_to_context` 就 raise，页面变 thanks_pending，补灌永远失败。
"""
from __future__ import annotations

import logging

from .extract import (
    HeuristicExtractor, PersonEntity, PersonIndex, ProjectEntity, SignalEntity,
    _person_key, _project_key, _slug, doc_key_of, merge_person_reading,
)
from .form import FormSubmission, FormTemplate, answers_by_field
from .parse import ParsedDoc
from .redline_extract import validate_extraction

log = logging.getLogger("avery.ingest.form_reflow")

# 一条情境信号的长度窗口。下界挡掉「无」「暂无」这类等于没说的答案；上界不是截断而是**放弃**：
# 卡面上的情境句必须是员工的原话逐字（ADR-0023），把一段 400 字的说明砍到 120 字再打个省略号，
# 是我们替她改口。超过上界的那一格照旧整段进资料库、照旧被议事室引用，只是不长成卡上一条信号。
SIGNAL_MIN_CHARS = 4
SIGNAL_MAX_CHARS = 120

# 项目卡阻塞原句的条数上限，与 `_dedupe_entities` 给 blockers 的那把尺同一个数（extract.py 的
# `[:6]`）——不在这里发明第二个上限。
MAX_BLOCKERS = 6

FORM_PROVENANCE_ORIGIN = "form"


def stub_person_from_submission(doc: ParsedDoc,
                                submission: FormSubmission) -> PersonEntity | None:
    """从渲染出来的文档里读出**这位提交人**的自述槽；读不到就 None。

    读的是解析层（`_selfreport_from_lines`），不是答案字典 —— 这一点是刻意的：人卡上的数字与
    上传一份周报读出来的数字，走的必须是同一段代码、同一套越界即拒/词表外走 other 的判据。
    自己从 `answers` 里搭一个 `SelfReportLoad`，等于给人身数字开第二条通道。

    身份锁见文件头命门②：解析出多少行自述都不管，只认名字等于这条链主人的那一行。
    """
    parsed = HeuristicExtractor()._selfreport_from_lines(doc).people
    mine = _person_key(submission.person_name)
    for p in parsed:
        if _person_key(p.name) != mine:
            log.warning(
                "form %s rendered a self-report line for %r, which is not this link's owner (%r) — "
                "dropped; only the submitter may self-report on her own form",
                submission.id, p.name, submission.person_name)
            continue
        # 工号来自结构化字段，不来自文档文本（命门②）。
        p.person_id = (submission.person_id or "").strip()
        return p
    return None


def _first_line(text: object) -> str:
    for raw in str(text or "").splitlines():
        line = raw.strip()
        if line:
            return line
    return ""


def _signal_survives_the_red_line(sig: SignalEntity) -> bool:
    """这条候选信号送去 `validate_extraction` 单独过一遍——过不了就不生成它（命门④）。

    ONE RULER：拿真的 `validate_extraction` 去问，而不是在这里抄一份它的 person-anchor 句式。
    抄一份的下场是哪天那句锚定语改了，这里的预检与真正的门就对不上——预检放行、门拒绝，
    于是员工的一句话又能炸掉整份提交。
    """
    from .extract import ExtractionResult
    return validate_extraction(ExtractionResult(signals=[sig])).ok


def signals_from_submission(template: FormTemplate, submission: FormSubmission,
                            source_key: str, answer_lines: dict[str, int],
                            subject_ref: str) -> list[SignalEntity]:
    """情境自由文本 → 人卡上带出处的情境信号。

    只有标了 `situational=True` 的格才出信号（`form.FormField.situational` 的文件注释讲了为什么是
    字段描述上的一个开关而不是按 field.id 写死）。summary 是那一格答案的**第一行原话逐字**——
    停在情境，绝不是对人的判断/标签/评分（`SignalEntity` 的红线，extract.py 的 dataclass 注释）。
    题面本身已经把话问在情境上（「未达成及原因」「需要支持」），所以不需要、也不许在这里改写措辞。

    `subjectRef` 直接写**人卡的 id**，不写姓名：`_link_owners` 那条按名回填的路在这里够不着
    （回流不重跑整条抽取），而 `registry.signal_cards()` 投出去的 `subjectId` 就是这个字段，
    前端按 `sig.subjectId === detail.id` 挂卡。留成姓名的下场是信号永远挂不上卡，而且**不报错**。
    """
    by_field = answers_by_field(submission)
    out: list[SignalEntity] = []
    for f in template.fields:
        if not getattr(f, "situational", False) or f.kind != "text" or f.id not in by_field:
            continue
        summary = _first_line(by_field[f.id])
        if not (SIGNAL_MIN_CHARS <= len(summary) <= SIGNAL_MAX_CHARS):
            continue
        line = answer_lines.get(f.id)
        if line is None:                 # 渲染器没给行号 = 这一格没被渲染；没有出处就不出信号
            continue
        sig = SignalEntity(
            id=_slug(summary, "s"), source_kind="doc", subjectType="person",
            subjectRef=subject_ref, summary=summary, tag="",
            source=f"{source_key}:{line}")
        if not _signal_survives_the_red_line(sig):
            log.warning(
                "form %s: the answer to %r reads as a person score — the sentence stays in the "
                "materials verbatim, but it does not become a card signal", submission.id, f.id)
            continue
        out.append(sig)
    return out


def blockers_from_submission(template: FormTemplate,
                             submission: FormSubmission) -> list[str]:
    """同样两格情境自由文本 → 项目卡的阻塞原句（只在这条链绑了项目时才有人要）。

    与信号同一句话、同一把长度尺：卡上说的是同一件事，两处措辞不一样才是奇怪的。
    """
    by_field = answers_by_field(submission)
    out: list[str] = []
    for f in template.fields:
        if not getattr(f, "situational", False) or f.kind != "text" or f.id not in by_field:
            continue
        line = _first_line(by_field[f.id])
        if SIGNAL_MIN_CHARS <= len(line) <= SIGNAL_MAX_CHARS:
            out.append(line)
    return out


def find_bound_project(projects: list[ProjectEntity],
                       project_ref: str) -> ProjectEntity | None:
    """按 `_project_key`（归并认项目用的同一把尺）找这条链绑的那张项目卡；找不到 → None。

    找不到就**什么都不做**，绝不凭一个名字新建一张项目卡：`project_ref` 是经理在铸链时打的字，
    打错一个字就凭空多出一个公司里不存在的项目，比不写还糟。
    """
    want = _project_key(project_ref)
    if not want:
        return None
    for pr in projects:
        if _project_key(pr.title) == want and not getattr(pr, "archived", False):
            return pr
    return None


def clear_stale_self_report(person: PersonEntity, source_documents,
                            incoming_uploaded_at: str) -> list[str]:
    """新一份自述比人卡上现有那份**更新**时，先把旧的那个子槽腾空。返回腾了哪几个（供记账）。

    为什么要有这一步：`_dedupe_entities` 的自述合并是**每个子槽 keep-first**，而且那是对的——
    它防的是「一份花名册把一份周报的自述冲掉」。但表单这条路上追加是严格按时间来的，
    keep-first 就等于 keep-**oldest**：周雅第二周报了 85，人卡会永远停在第一周的 72 并且一直
    引用那份旧文档。腾空 + 让既有的 keep-first 规则自然填上，是这里唯一不动那条共用规则的写法。

    🔴 时间从 `uploaded_at` 来，只走 `decision_grading._uploaded_moment` 那一处解析（全仓唯一）。
    用**瞬间**而不是天粒度，与定级那条路刻意不同：定级面对的是一批同刻上传的文件，天粒度是为了
    不让文件遍历顺序当判据；这里两份读数是员工两次真的按下提交，同一天再交一份就是更新的读数。
    旧那份的时间读不出来（出处指向一份已经不在库里的文档、或者压根没有出处）→ **不腾空**，
    退回今天的 keep-first。不知道谁新，就不动——绝不拿"猜"去覆盖一条有出处的读数。
    """
    from ..decision_grading import _uploaded_moment
    if person.self_report is None:
        return []
    fresh = _uploaded_moment(incoming_uploaded_at)
    if fresh is None:
        return []
    stamps = {}
    for sd in source_documents or []:
        key = (getattr(sd, "source_key", "") or getattr(sd, "filename", "") or "").strip()
        moment = _uploaded_moment(getattr(sd, "uploaded_at", ""))
        if key and moment is not None:
            stamps[key] = moment
    cleared: list[str] = []
    for slot in ("load", "mood"):
        held = getattr(person.self_report, slot, None)
        if held is None:
            continue
        held_moment = stamps.get(doc_key_of(getattr(held, "source", "")))
        if held_moment is None or held_moment >= fresh:
            continue
        setattr(person.self_report, slot, None)
        cleared.append(slot)
    return cleared


def reflow_submission(ctx, template: FormTemplate, submission: FormSubmission,
                      doc: ParsedDoc, answer_lines: dict[str, int]) -> dict:
    """把一份**已渲染进资料库**的提交回流成卡面产物。就地改 `ctx`，返回一份记账用的小字典。

    调用点在 `form_append.append_submission_to_context` 里，位置有讲究：
      · 在幂等早返之后 —— 同一份提交灌两遍不许长出第二条信号；
      · 在 `validate_extraction` **之前** —— 新写进去的东西要接受与既有实体同一道门的检查；
      · 在 `materialize_memory` 之前 —— 信号要进 notes.md，议事室当天引得到。
    """
    stub = stub_person_from_submission(doc, submission)
    outcome = {"person_id": "", "self_report": False, "signals": 0,
               "blockers": 0, "refreshed": [], "skipped": ""}
    if stub is None:
        # 提交里没有可读的自述（模板没有 number/choice 格、或者姓名解析层不认），人卡这一半就
        # 没有落点。信号仍然可以出——但它需要一个人卡 id 才挂得上，所以这里一起收手，并留一行日志。
        log.info("form %s produced no readable self-report line — nothing reflows onto a person card",
                 submission.id)
        outcome["skipped"] = "no-self-report-line"
        return outcome

    index = PersonIndex(ctx.extraction.people)
    if not (submission.person_id or "").strip() and index.name_is_ambiguous(stub.name):
        # 这家公司有不止一个人叫这个名字，而这条链铸的时候没带工号。挑第一个是掷硬币，
        # 新开一张卡是凭空多一个人——两种都不是真话。资料照旧落地，卡这一层原样不动。
        log.warning(
            "form %s: %r is more than one person in this company and the link carried no 人员ID — "
            "the document is filed, but no card gains this reading (mint the link with the 01-sheet "
            "工号 and it lands)", submission.id, submission.person_name)
        outcome["skipped"] = "ambiguous-name-without-id"
        return outcome

    incumbent = index.slots.get(index.resolve(stub))
    if incumbent is not None:
        outcome["refreshed"] = clear_stale_self_report(
            incumbent, ctx.source_documents, submission.submitted_at)
    person = merge_person_reading(ctx.extraction.people, stub)
    outcome["person_id"] = person.id
    outcome["self_report"] = person.self_report is not None

    sigs = signals_from_submission(template, submission, doc.name, answer_lines, person.id)
    seen = {(s.subjectType, s.subjectRef, s.summary) for s in ctx.extraction.signals}
    for sig in sigs:
        if (sig.subjectType, sig.subjectRef, sig.summary) in seen:
            continue      # 同一个人同一句话已经在卡上了（同周期重铸再交）——不叠第二条
        seen.add((sig.subjectType, sig.subjectRef, sig.summary))
        ctx.extraction.signals.append(sig)
        outcome["signals"] += 1

    project = find_bound_project(ctx.extraction.projects, submission.project_ref)
    if project is not None:
        added = [b for b in blockers_from_submission(template, submission)
                 if b not in project.blockers]
        if added:
            project.blockers = (project.blockers + added)[:MAX_BLOCKERS]
            # 字段级出处 side-car（extract.ProjectEntity.provenance）。origin='form' 是第三个取值，
            # 与 'doc'（抽取）/'manual'（手编）并列：这一格最后一次是**一份表单提交**改的。
            project.provenance["blockers"] = {
                "origin": FORM_PROVENANCE_ORIGIN, "source": doc.name,
                "updated_at": submission.submitted_at or ""}
            outcome["blockers"] = len(added)
    return outcome
