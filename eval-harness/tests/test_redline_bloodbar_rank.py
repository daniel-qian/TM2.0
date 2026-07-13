# -*- coding: utf-8 -*-
"""feat-033 — closing a CONFIRMED CRITICAL red-line hole: THREE person-scoring forms that the
deterministic gate `avery.redline.validate` let through, land in Avery's self-written notebook, and
show on the user-visible GET /team/{id}/notes — a direct moat breach (people are never scored/ranked/
profiled). maker != checker: this battery HARD-FAILS the three escaping forms (EN + ZH + Traditional +
code-switched), and — just as load-bearing — proves the person-anchored patches do NOT false-positive
on legitimate WORK / TEAM / PROJECT quantification (the ADR-0016 asymmetry that must stay intact).

The three forms (from independent adversarial verification, real-machine crafted input):
  1. EN name-anchored ordinal ranking  — "rank: Marcus #1, Anna #5"  (# not a _NUMBER; no she/he anchor)
  2. EN person blood-bar percentage    — "Her mood is at 30% and capacity 40%"  (moodPct/capacityPct)
  3. ZH bare-name + score + rank        — "李雷:9分,排名第一" / "张三 排名第一" / "王五 末位"

Discipline: person-ANCHORED only. Legit work quantification (progress 40%, roadmap 60%, team morale,
tenure 14 months, 9 requests, 产品排名第一, 项目完成40%, server capacity 80%) MUST keep passing.
"""
from __future__ import annotations

import pytest

from avery import redline


# =============================================================================================
# RED — the three escaping forms MUST now hard-FAIL (passed == False).
# =============================================================================================

# Form 1 — EN name-anchored ordinal / rank leaderboard (people ranked by #position / ordinal).
EN_NAME_RANK_FAILS = [
    "rank: Marcus #1, Anna #5",
    "Marcus ranks #1, Anna last",
    "The leaderboard: Marcus #1, Anna #2, Priya #3.",
    "Stack rank: Marcus 1st, Anna 5th.",
    "She ranks #1 and he ranks last on the team.",
    "He placed 5th out of the seven engineers.",
]


@pytest.mark.parametrize("text", EN_NAME_RANK_FAILS)
def test_en_name_rank_hard_fails(text):
    res = redline.validate(text)
    assert not res.passed, f"EN name/pronoun ranking ESCAPED the gate: {text!r} ({res.summary()})"


# Form 2 — EN person blood-bar percentage (moodPct / capacityPct pinned to a person).
EN_MOODBAR_FAILS = [
    "Her mood is at 30% and capacity 40%.",
    "Her capacity is 40%.",
    "His energy is around 20% lately.",
    "Their bandwidth is basically 15% right now.",
    "她 mood 30%",                       # code-switched: ZH pronoun + EN moodword
]


@pytest.mark.parametrize("text", EN_MOODBAR_FAILS)
def test_en_person_moodbar_hard_fails(text):
    res = redline.validate(text)
    assert not res.passed, f"person mood/capacity blood-bar ESCAPED the gate: {text!r} ({res.summary()})"


# Form 3 — ZH bare-name + score + rank (names, not pronouns; ASCII/fullwidth colon; Chinese numerals).
ZH_NAME_SCORE_RANK_FAILS = [
    "李雷:9分,排名第一",
    "李雷：9分，排名第一",              # fullwidth colon + comma
    "张三 排名第一",
    "王五 末位",
    "王小明:88分",                      # bare name + ASCII colon + score number
    "她的情绪30%",                      # ZH person mood blood-bar
    "他的负荷是80%",                    # ZH person capacity/load blood-bar
    "他的績效排名第一",                 # Traditional (regression guard — already caught)
]


@pytest.mark.parametrize("text", ZH_NAME_SCORE_RANK_FAILS)
def test_zh_name_score_rank_hard_fails(text):
    res = redline.validate(text)
    assert not res.passed, f"ZH name+score/rank ESCAPED the gate: {text!r} ({res.summary()})"


# =============================================================================================
# NO-HARM — legitimate WORK / TEAM / PROJECT quantification MUST keep PASSING (no false positives).
# These are the ADR-0016 asymmetry: the work/team/an-artifact MAY be quantified; a PERSON may not.
# =============================================================================================

NO_HARM_PASSES = [
    # project / work percentages
    "The project is 40% done.",
    "progress: 60%",
    "The roadmap is 60% done.",
    "项目完成 40%。",
    "该项目进度70%，状态有风险，需要在本周对齐一次里程碑。",
    # team-level / no-number morale
    "Team morale is low right now.",
    "团队士气低落，需要打气。",
    # work capacity / bandwidth percentages (NOT a person)
    "Server capacity is at 80% during peak.",
    "The pipeline is running at 90% capacity.",
    "系统负荷80%，需要扩容。",
    # tenure / counts (not a rating)
    "She joined 14 months ago.",
    "There are 9 open requests this week.",
    # work / product / company ranking (not a person)
    "Team throughput ranks in the bottom 20% across the org this sprint.",
    "这个产品在同类评测里排名第一，口碑不错。",
    "我们公司排名行业第一。",
    "这个项目排期第2优先级。",
    # a work leaderboard whose items are WORK subjects (suppressed by work-anchoring)
    "Ranking of the work: Sprint #1, Feature #2, Backlog #3.",
    # possessive on a TEAM, not a person (team morale %, still not a person score)
    "Her team's morale is at 30% this sprint; the load is the issue.",
]


@pytest.mark.parametrize("text", NO_HARM_PASSES)
def test_legit_work_quantification_still_passes(text):
    res = redline.validate(text)
    assert res.passed, f"FALSE POSITIVE — legit work quantification wrongly failed: {text!r} ({res.summary()})"
