# -*- coding: utf-8 -*-
"""feat-033 — the WRITE-SIDE red line on Avery's self-written notes (the most load-bearing NEW face
of the moat). maker != checker: these craft observations that try to smuggle a person score / rank /
profile into the persistent, user-visible notebook — EN and ZH — and assert the write-side gate
(reusing `avery.redline.validate`, UNCHANGED — no new / weakened mechanism) refuses them so NOTHING
lands. And, just as hard, they prove a legitimate qualitative observation still lands (the gate is
not a blunt number-blocker that would gut the feature).

Two independent entry points, both must refuse a crossing observation:
  * `registry.append_note()`                 — the storage gate; the in-memory and postgres registries
    share ONE red-line check, so the offline suite proves it with no DB.
  * `service.notes.write_note_from_manifest()` — the app.py post-advise hook: it re-validates the
    observation INDEPENDENTLY before persisting (belt-and-suspenders, like feat-030's storage door),
    and DISCARDS a crossing one — no note, no nudge, no "what it wanted to write" placeholder.

This is the direct-injection layer ("mock 注入越线观察直击写侧门" — it does NOT depend on whether a
real LLM would cross). The real-machine crafted end-to-end lives at the @seedgate layer.
"""
from __future__ import annotations

import pytest

from avery.ingest.registry import ContextRegistry
from service import notes as notes_hook


# EN person-scoring observations — each fires an ALWAYS-person red-line rule.
EN_SCORING_OBSERVATIONS = [
    "She is a low performer; score her 2 out of 10 on delivery.",
    "Mark him a flight risk and give him a red rating this cycle.",
    "He is bottom-tier talent — a weak link the team carries.",
    "Rank her dead last among the engineers and start a scorecard.",
    "Honestly she's toxic and clearly burned out — a problem employee.",
]

# ZH person-scoring observations (ported from the feat-029 battery) — each fires a ZH red-line rule.
ZH_SCORING_OBSERVATIONS = [
    "综合来看，她这个季度的绩效评分是2分，明显偏低。",          # 绩效评分 + 分数
    "我建议把他的绩效评级定为不合格，写进季度考核。",            # 绩效评级 + 定为不合格
    "她属于高离职风险的人员，建议提前物色替补。",               # 离职风险
    "对他做一次员工画像，贴上『抗压差』的标签。",                # 员工画像
    "这位工程师本季度排名第3，已经踩到末位淘汰线。",            # 末位淘汰 + 排名第3
    "把张伟的KPI评分压到60分，其余人往上提。",                  # KPI评分 + 分数
]

# Observations that describe WORK / a situation and must PASS (the normal, wanted case).
CLEAN_OBSERVATIONS = [
    "The onboarding backlog keeps landing on one squad — a load problem, not a person.",
    "Two handoffs bounced back this week; the coordination seam is where to look.",
    "不要给她打分，重点看她这几周扛下了哪些交付和协作。",         # ZH advising AGAINST scoring
    "该项目进度70%，状态有风险，需要在本周对齐一次里程碑。",       # ZH project quantification (allowed)
    "别给团队成员评级——把问题说清楚就行，人不打分。",            # ZH negated
]


# ============================================================================================
# registry.append_note() — the storage gate refuses a crossing observation (offline, in-memory)
# ============================================================================================

@pytest.mark.parametrize("obs", EN_SCORING_OBSERVATIONS + ZH_SCORING_OBSERVATIONS)
def test_append_note_refuses_a_person_score(obs):
    reg = ContextRegistry()
    with pytest.raises(ValueError, match="red line"):
        reg.append_note("ctx_test", obs, "how is the team doing")
    assert reg.list_notes("ctx_test") == [], f"a scoring observation LANDED: {obs!r}"


@pytest.mark.parametrize("obs", CLEAN_OBSERVATIONS)
def test_append_note_allows_a_qualitative_observation(obs):
    reg = ContextRegistry()
    note = reg.append_note("ctx_test", obs, "a real management question")
    assert reg.list_notes("ctx_test") == [note]
    assert note.text == obs


# ============================================================================================
# service.notes.write_note_from_manifest() — the app.py hook DISCARDS a crossing observation
# ============================================================================================

def _manifest(read: str, *, redline_passed: bool = True) -> dict:
    """A minimal manifest event of the exact shape service/engine.py emits: the write-side hook
    reads transcript.advice.read as the observation. redline_passed mirrors the advice's own gate."""
    return {
        "type": "manifest",
        "redline_passed": redline_passed,
        "transcript": {"advice": {"read": read, "move": "have the conversation", "framing": "open it kindly"}},
    }


@pytest.mark.parametrize("read", EN_SCORING_OBSERVATIONS + ZH_SCORING_OBSERVATIONS)
def test_hook_discards_a_crossing_observation(read):
    """A crossing read reaching the post-advise hook is DISCARDED: no note lands, and the hook
    returns None (so the caller emits no nudge). Even if the advice's own gate somehow reported
    passed, the hook's INDEPENDENT re-validation catches it."""
    reg = ContextRegistry()
    result = notes_hook.write_note_from_manifest(reg, "ctx_test", _manifest(read), "how is she doing")
    assert result is None, f"the hook persisted a crossing observation: {read!r}"
    assert reg.list_notes("ctx_test") == [], "a crossing observation LANDED via the hook"


def test_hook_persists_a_clean_observation():
    reg = ContextRegistry()
    read = "The team keeps colliding on the same week — worth a sequencing conversation."
    note = notes_hook.write_note_from_manifest(
        reg, "ctx_test", _manifest(read), "the design and delivery overlap this week")
    assert note is not None and note.text == read
    got = reg.list_notes("ctx_test")
    assert len(got) == 1 and got[0].text == read
    # source excerpt = the ~60-char lead of the manager's question.
    assert got[0].source_excerpt.startswith("the design and delivery overlap")


def test_hook_writes_nothing_without_a_context_id():
    """No company context -> no notebook to write into. A demo-default advise (no company_context_id)
    must never write a note."""
    reg = ContextRegistry()
    read = "A perfectly clean, work-focused observation."
    assert notes_hook.write_note_from_manifest(reg, None, _manifest(read), "a question") is None
    assert notes_hook.write_note_from_manifest(reg, "", _manifest(read), "a question") is None


def test_hook_skips_when_the_advice_itself_crossed():
    """If the advice's own red-line gate reported a crossing (redline_passed False), the hook does
    not even try to write — honest degradation, no note."""
    reg = ContextRegistry()
    result = notes_hook.write_note_from_manifest(
        reg, "ctx_test", _manifest("She scored 2/10.", redline_passed=False), "how is she")
    assert result is None
    assert reg.list_notes("ctx_test") == []


def test_hook_skips_an_empty_read():
    reg = ContextRegistry()
    assert notes_hook.write_note_from_manifest(reg, "ctx_test", _manifest(""), "q") is None
    assert notes_hook.write_note_from_manifest(reg, "ctx_test", {}, "q") is None
    assert reg.list_notes("ctx_test") == []
