# -*- coding: utf-8 -*-
"""fixA · B2 —— 首屏简报不许和它自己那份 payload 打架。

`CompanyContext.briefing()` 的 subhead 紧跟在一句信任声明后面：

    Everything below is drawn from your uploads — nothing invented. No risk signals surfaced …

在 2026-07-18 的对抗审查里，这句话被实测证伪：同一份 payload 里 `decision_cards()` 判「需确认」
并列出命中规则、`signal_cards()` 非空、前端 deriveGaps 产出对照卡，而 subhead 仍然否认风险信号
存在。原因是 briefing 自己造了一套判据（`p.status in ("at-risk", "blocked")`），既不看 blockers
也不看 signals——而 `avery/decision_rules.py` 里专门有一条「自报『正常』但挂着未解阻塞」的规则，
说明代码库本来就把这类输入当预期输入建模。
（本文件按 `test_no_rule_text_in_any_prompt` 的约束，只引规则的中文标题，不写规则编号。）

本文件锁死的行为：**briefing 的风险判据与决策定级同源**，且 tone / metrics / subhead 三者自洽。
🔴 判据只许收紧不许放松：「我没读到」永远不许被渲染成「客户说没事」。
"""
from __future__ import annotations

from datetime import date

from avery.ingest.extract import ExtractionResult, ProjectEntity, SignalEntity
from avery.ingest.registry import CompanyContext
from avery.ingest.store import KeywordStore

# 固定 as_of：时间类规则（到期日）显式吃它，测试才可复现。
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


def test_on_track_project_with_a_blocker_is_not_reported_as_calm(tmp_path):
    """自报 on-track、却挂着一条未解阻塞——「多看一眼」这个功能存在的**前提场景**。

    同一份 payload 里决策定级判它「需确认」（命中「自报正常却挂着阻塞」与「挂着一条未解阻塞」）。
    简报必须跟着说同一句话，不能一边列着阻塞一边宣布「文件里没有风险信号」。
    """
    ctx = _ctx(tmp_path, [ProjectEntity(
        id="p1", title="Roadmap Q3", ownerName="李娜", status="on-track",
        summary="设计评审已完成，进入开发。",
        blockers=["合同条款还压在法务那边，已经两周没有回音"])])

    graded = ctx.decision_cards(as_of=AS_OF)
    assert [d["grade"] for d in graded] != ["can_proceed"], "前提：决策定级确实认为这条要看"

    b = ctx.briefing()
    assert CALM_DENIAL not in b["subhead"], b["subhead"]
    assert b["tone"] == "alert", b
    assert _need_look(b) == 1, b["metrics"]


def test_project_with_no_stated_status_but_a_blocker_is_not_reported_as_calm(tmp_path):
    """文档没写状态（实测约四分之一的项目）+ 一条阻塞。「没读到状态」不是「客户说没事」。"""
    ctx = _ctx(tmp_path, [ProjectEntity(
        id="p1", title="佣金测算", ownerName="王强", status="",
        blockers=["口径没定，等财务确认"])])

    b = ctx.briefing()
    assert CALM_DENIAL not in b["subhead"], b["subhead"]
    assert b["tone"] == "alert", b
    assert _need_look(b) == 1, b["metrics"]


def test_a_risk_signal_is_never_denied_even_when_no_project_is_flagged(tmp_path):
    """`signal_cards()` 非空、subhead 却否认 risk signal 存在——自相矛盾只隔一个 key。

    抽取层的 signals 按构造就是风险类读数（unresolved / no sign-off / rework / interrupt 四族），
    所以「signals 数组非空」与「文件里没有风险信号」不可能同时为真。这条信号挂不到任何项目上
    （`_match_signals` 的已知盲区），正因如此它更不能被简报静默吞掉。
    """
    ctx = _ctx(
        tmp_path,
        [ProjectEntity(id="p1", title="Roadmap Q3", ownerName="李娜", status="on-track",
                       summary="设计评审已完成。")],
        [SignalEntity(id="s1", source_kind="doc", subjectType="project", subjectRef="the project",
                      summary="12 unresolved comments on the spec", tag="no-update",
                      source="weekly.md:12")],
    )

    assert ctx.signal_cards(), "前提：这份 payload 确实带着信号"

    b = ctx.briefing()
    assert CALM_DENIAL not in b["subhead"], b["subhead"]
    assert b["tone"] == "alert", b
    assert _need_look(b) == 1, b["metrics"]


def test_genuinely_clear_payload_still_reads_calm(tmp_path):
    """反向闸：判据只许收紧到「真有信号」，不许变成人人喊狼。

    自报正常、无阻塞、无信号 → 决策定级判「可推进」，简报也得是 calm，且不冒出 need-a-look 格子。
    """
    ctx = _ctx(tmp_path, [ProjectEntity(
        id="p1", title="官网改版", ownerName="陈曦", status="on-track",
        summary="按计划推进，本周完成首页。")])

    assert [d["grade"] for d in ctx.decision_cards(as_of=AS_OF)] == ["can_proceed"]

    b = ctx.briefing()
    assert b["tone"] == "calm", b
    assert _need_look(b) is None, b["metrics"]
    assert CALM_DENIAL in b["subhead"], b["subhead"]


def test_briefing_and_decision_cards_never_contradict_each_other(tmp_path):
    """混合 payload 上的总闸：只要决策定级里有任何一条不是「可推进」，简报就不许是 calm，
    而且 need-a-look 的数字不许少于那些项目的条数（signals 只会让它更大，不会更小）。"""
    ctx = _ctx(
        tmp_path,
        [
            ProjectEntity(id="p1", title="官网改版", ownerName="陈曦", status="on-track",
                          summary="按计划推进。"),
            ProjectEntity(id="p2", title="佣金方案", ownerName="王强", status="on-track",
                          summary="口径讨论中。", blockers=["等法务确认合同条款"]),
            ProjectEntity(id="p3", title="门店验收", ownerName="李娜", status="blocked",
                          summary="停在验收。", blockers=["验收标准未签字", "工期与预算都在重谈"]),
        ],
    )

    graded = ctx.decision_cards(as_of=AS_OF)
    flagged = [d for d in graded if d["grade"] != "can_proceed"]
    assert len(flagged) == 2, [d["grade"] for d in graded]

    b = ctx.briefing()
    assert b["tone"] == "alert", b
    assert _need_look(b) >= len(flagged), b["metrics"]
    assert "2" in b["subhead"], b["subhead"]


def test_briefing_is_reproducible_for_the_same_as_of(tmp_path):
    """同一份 payload + 同一个 as_of → 逐字节同一份简报（口径可当场给客户复算）。"""
    projects = [ProjectEntity(id="p1", title="佣金方案", ownerName="王强", status="on-track",
                              blockers=["等法务确认"])]
    a = _ctx(tmp_path, projects).briefing()
    b = _ctx(tmp_path, projects).briefing()
    assert a == b
