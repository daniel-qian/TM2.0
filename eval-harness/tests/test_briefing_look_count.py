# -*- coding: utf-8 -*-
"""fixA 收口 · 「多看一眼」这个数字，以及前端拿它当什么量词用。

`test_briefing_risk_honesty.py` 锁的是**有没有**风险信号（B2 原病灶：简报否认它自己那份 payload
里的阻塞）。本文件锁的是紧接着的一步：**数出来的那个数字对不对、以及它是不是项目**。

第一版把否认治好了，但新判据把计数算错了，而错法正好落回同一句话、同一个位置。中文生产壳
（线上 `VITE_AVERY_LOCALE=zh`，见 `src/shared/briefing.ts` 顶部说明）把这个数字填进

    以下内容全部来自你上传的文件，没有一处是编的。其中 {N} 个项目值得多看一眼。

真 ingest 一份 10 行英文周报（1 个项目、1 张决策卡）实测吐出 need a look = 3，而屏幕上只有一张
项目卡；更极端的一档是 0 个项目 + 2 条信号 → 「0 个进行中的项目 … 其中 2 个项目值得多看一眼」,
凭空点名两个不存在的项目——就摆在「没有一处是编的」正下方。

病根两条，下面一条一条钉：
  ① 去重只认「signal 原文逐字出现在某条 flagged 决策的规则证据里」。规则证据只装命中关键词族的
     信号，所以一条**指名道姓挂在已 flagged 项目上**、措辞却没撞上关键词的信号会被当成 loose
     再加一次 —— 同一个项目被数两遍。
  ② 计数的**形状**没发出来，前端只能把它一律叫「个项目」。

🔴 判据只许收紧不许放松：把 loose 信号直接丢掉能让数字好看，但那是 B2 原病灶（简报替客户否认
   他文件里的读数）。这里要的是「数清楚 + 叫对名字」，不是「少数一点」。
"""
from __future__ import annotations

from datetime import date

from avery.ingest.extract import ExtractionResult, ProjectEntity, SignalEntity
from avery.ingest.registry import CompanyContext
from avery.ingest.store import KeywordStore

AS_OF = date(2026, 7, 18)
CALM_DENIAL = "No risk signals surfaced"


def _ctx(tmp_path, projects, signals=()) -> CompanyContext:
    extraction = ExtractionResult(people=[], projects=list(projects), signals=list(signals))
    return CompanyContext(context_id="ctx_fixa", extraction=extraction, store=KeywordStore(),
                          memory_dir=tmp_path, name="fixa", source_files=["weekly.md"])


def _need_look(briefing: dict) -> int | None:
    for m in briefing["metrics"]:
        if m["label"] == "need a look":
            return int(m["value"])
    return None


def _look(briefing: dict) -> tuple[str, int, int]:
    """计数的形状：(kind, 项目条数, 挂不上任何决策卡的信号条数)。"""
    return briefing["look_kind"], briefing["look_projects"], briefing["look_signals"]


def test_a_signal_naming_a_flagged_project_is_not_counted_as_a_second_thing(tmp_path):
    """信号指名道姓挂在一个已经 flagged 的项目上 → 它已经被那张决策卡数过一次，不许再数第二次。

    这条信号的措辞（「还在等一份排期表」）撞不上规则表的任何关键词族，所以它进不了规则证据——
    第一版的「原文逐字比对」去重法看不见它，于是 1 个项目被数成 2，屏幕上却只有一张项目卡。
    """
    ctx = _ctx(
        tmp_path,
        [ProjectEntity(id="p1", title="Roadmap Q3", ownerName="李娜", status="on-track",
                       summary="设计评审已完成。", blockers=["合同条款还压在法务那边"])],
        [SignalEntity(id="s1", source_kind="doc", subjectType="project", subjectRef="p1",
                      summary="客户那边还在等一份排期表", tag="no-update", source="weekly.md:7")],
    )

    graded = ctx.decision_cards(as_of=AS_OF)
    assert len(graded) == 1 and graded[0]["grade"] != "can_proceed", graded

    b = ctx.briefing(as_of=AS_OF)
    assert _need_look(b) == 1, b["metrics"]
    assert _look(b) == ("projects", 1, 0), _look(b)


def test_a_person_signal_on_the_owner_of_a_flagged_project_is_not_counted_twice(tmp_path):
    """负责人处境型信号：定级时它作为**该项目**的证据参与，所以也已经被那张卡数过了。"""
    ctx = _ctx(
        tmp_path,
        [ProjectEntity(id="p1", title="门店验收", ownerId="u_wang", ownerName="王强",
                       status="on-track", blockers=["验收标准还没签字"])],
        [SignalEntity(id="s1", source_kind="doc", subjectType="person", subjectRef="王强",
                      summary="王强这周还在盯着交付现场", tag="interrupt", source="weekly.md:9")],
    )

    b = ctx.briefing(as_of=AS_OF)
    assert _need_look(b) == 1, b["metrics"]
    assert _look(b) == ("projects", 1, 0), _look(b)


def test_a_signal_already_quoted_on_a_flagged_card_is_not_counted_twice(tmp_path):
    """同一句话既是项目的 blocker、又被抽成一条信号（真 ingest 的常态：抽取层两边都收）。

    那张决策卡已经把这句原文打在屏幕上了，简报不许把它当成另一件事再数一遍。
    （这条在第一版下就是绿的——留着是因为按 signal 身份去重的新写法**单独**用会漏掉它。）
    """
    line = "12 unresolved comments on the spec"
    ctx = _ctx(
        tmp_path,
        [ProjectEntity(id="p1", title="Roadmap Q3", ownerName="李娜", status="on-track",
                       blockers=[line])],
        [SignalEntity(id="s1", source_kind="doc", subjectType="project", subjectRef="the project",
                      summary=line, tag="no-update", source="weekly.md:8")],
    )

    b = ctx.briefing(as_of=AS_OF)
    assert _need_look(b) == 1, b["metrics"]
    assert _look(b) == ("projects", 1, 0), _look(b)


def test_never_calls_it_a_project_count_unless_every_counted_thing_is_a_project(tmp_path):
    """🔴 本轮的总闸：只有在「数出来的每一样都确实是项目」时，形状才许是 projects。

    中文壳把 need-a-look 的数字填进「其中 {N} 个项目值得多看一眼」。所以后端必须发出计数的
    **形状**，否则前端只能一律叫「个项目」——而这个数字随时可能大过项目总数。
    """
    ctx = _ctx(
        tmp_path,
        [ProjectEntity(id="p1", title="Roadmap Q3", ownerName="李娜", status="on-track",
                       summary="按计划推进。")],
        [SignalEntity(id="s1", source_kind="doc", subjectType="project", subjectRef="the project",
                      summary="12 unresolved comments on the spec", tag="no-update",
                      source="weekly.md:8"),
         SignalEntity(id="s2", source_kind="doc", subjectType="project", subjectRef="the project",
                      summary="acceptance has not been signed off", tag="no-update",
                      source="weekly.md:9")],
    )

    b = ctx.briefing(as_of=AS_OF)
    kind, n_projects, n_signals = _look(b)
    assert kind == "items", b            # 两条信号挂不到任何项目上 → 它们不是项目
    assert (n_projects, n_signals) == (0, 2), _look(b)
    assert "project(s)" not in b["subhead"], b["subhead"]


def test_zero_projects_with_loose_signals_never_names_a_project(tmp_path):
    """最狠的一档：0 个项目 + 2 条信号。旧行为让中文壳说出「0 个进行中的项目 … 其中 2 个项目
    值得多看一眼」——凭空点名两个不存在的项目，就在「没有一处是编的」正下方。"""
    ctx = _ctx(
        tmp_path, [],
        [SignalEntity(id="s1", source_kind="doc", subjectType="project", subjectRef="the project",
                      summary="12 unresolved comments on the spec", tag="no-update",
                      source="weekly.md:3"),
         SignalEntity(id="s2", source_kind="doc", subjectType="project", subjectRef="the project",
                      summary="acceptance has not been signed off", tag="no-update",
                      source="weekly.md:4")],
    )

    b = ctx.briefing(as_of=AS_OF)
    assert _look(b) == ("items", 0, 2), _look(b)
    assert "project(s)" not in b["subhead"], b["subhead"]
    assert CALM_DENIAL not in b["subhead"], b["subhead"]   # 信号非空，仍然不许否认它们存在


def test_duplicate_signals_are_counted_once(tmp_path):
    """同一条信号在 payload 里出现两次（两份文件抽到同一句）→ 只算一处。"""
    dup = SignalEntity(id="s1", source_kind="doc", subjectType="project", subjectRef="the project",
                       summary="供应商那边一直没有回信", tag="no-update", source="weekly.md:11")
    b = _ctx(tmp_path, [], [dup, dup]).briefing(as_of=AS_OF)
    assert _look(b) == ("items", 0, 1), _look(b)


def test_look_shape_always_reconciles_with_the_number_on_screen(tmp_path):
    """形状与数字同源：look_projects + look_signals 恒等于 metrics 上那个数；
    projects 形状恒不超过项目总数（= 中文壳说「N 个项目」时，这 N 个永远点得出来）。"""
    ctx = _ctx(
        tmp_path,
        [ProjectEntity(id="p1", title="官网改版", ownerName="陈曦", status="on-track",
                       summary="按计划推进。"),
         ProjectEntity(id="p2", title="佣金方案", ownerName="王强", status="on-track",
                       summary="口径讨论中。", blockers=["等法务确认合同条款"]),
         ProjectEntity(id="p3", title="门店验收", ownerName="李娜", status="blocked",
                       summary="停在验收。", blockers=["验收标准未签字", "工期与预算都在重谈"])],
        [SignalEntity(id="s1", source_kind="doc", subjectType="project", subjectRef="the project",
                      summary="供应商那边一直没有回信", tag="no-update", source="weekly.md:11")],
    )

    b = ctx.briefing(as_of=AS_OF)
    kind, n_projects, n_signals = _look(b)
    assert n_projects + n_signals == _need_look(b), (b["metrics"], _look(b))
    assert kind == ("projects" if n_signals == 0 else "items"), _look(b)
    if kind == "projects":
        assert _need_look(b) <= len(ctx.extraction.projects), (b["metrics"], _look(b))


def test_calm_payload_reports_the_none_shape(tmp_path):
    """反向闸：真干净的 payload 形状是 none，前端据此走 calm 分支。"""
    b = _ctx(tmp_path, [ProjectEntity(id="p1", title="官网改版", ownerName="陈曦",
                                      status="on-track", summary="按计划推进。")]
             ).briefing(as_of=AS_OF)
    assert _look(b) == ("none", 0, 0), _look(b)
    assert b["tone"] == "calm", b


def test_real_ingest_of_a_weekly_never_counts_one_project_as_three(tmp_path):
    """端到端（真 parse + 真确定性抽取，无 mock）：审查现场那份 10 行英文周报。

    实测旧行为 need a look = 3，屏幕上一张项目卡。抽取层给每条 doc 信号写死
    `subjectRef="the project"`（`extract.py::_signals_from_doc` 里 `proj_ref` 从未被赋值），
    信号因此挂不到任何项目上——那条盲区不在本次可改文件范围内，但简报至少不许把它翻译成
    「N 个项目」，也不许把同一句话数两遍。
    """
    from avery.ingest.extract import HeuristicExtractor, extract_docs
    from avery.ingest.parse import parse_bytes

    md = (
        "# Weekly report\n\n"
        "## Project: Roadmap Q3\n"
        "Owner: Li Na\n"
        "Status: on-track\n"
        "Progress: 40%\n\n"
        "12 unresolved comments on the spec.\n"
        "Acceptance has not been signed off by the client.\n"
        "The pricing page was reworked twice this week.\n"
    )
    extraction = extract_docs([parse_bytes("weekly.md", md.encode("utf-8"))],
                              HeuristicExtractor())
    ctx = CompanyContext(context_id="ctx_fixa", extraction=extraction, store=KeywordStore(),
                         memory_dir=tmp_path, name="fixa", source_files=["weekly.md"])

    assert len(extraction.projects) == 1, [p.title for p in extraction.projects]
    flagged = [d for d in ctx.decision_cards(as_of=AS_OF) if d["grade"] != "can_proceed"]
    assert len(flagged) == 1, flagged

    b = ctx.briefing(as_of=AS_OF)
    # 「12 unresolved comments」既是项目的 blocker 又被抽成信号 → 已经在卡上，不重复计数；
    # 剩下那条 rework 挂不到项目上，所以形状是 items（不许叫「2 个项目」）。
    assert _look(b) == ("items", 1, 1), (_look(b), b["metrics"])
    assert _need_look(b) == 2, b["metrics"]
    assert "project(s)" not in b["subhead"], b["subhead"]
