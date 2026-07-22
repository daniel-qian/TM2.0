"""rich-align-0722 · issue 01 — project rich fields: risk + progress reject-not-clamp.

Locks the field syntax defined in PRD A2 / issue 01:
  * 「风险：等级/原因」 → ProjectEntity.risk = {level, reason?}; vocab 高|中|低 + high|medium|low.
  * 「风险点：…」 STAYS a blocker (long-label-first, no collision with the new risk reader).
  * 词表外等级 → whole line not extracted (整行不抽), risk stays None.
  * 「进度：150%」 → progress None (超界拒收, NOT clamped to 100); 「进度：0%」 → 0 (0 is legal).
  * projection omits the risk key when absent (absent≠none / None-空不发键).

These assertions are the red-first gate for the heuristic path; the LLM path converges on the same
ProjectEntity shape (parity by construction — see llm_extract._llm_risk).
"""
from __future__ import annotations

from avery.ingest import ContextRegistry, ingest_docs, parse_bytes
from avery.ingest.extract import HeuristicExtractor


def _project(md_text: str):
    """Extract the single project out of a one-project mini doc (heuristic path, deterministic)."""
    doc = parse_bytes("proj.md", md_text.encode("utf-8"))
    ex = HeuristicExtractor().extract(doc)
    assert ex.projects, "no project extracted from the mini doc"
    return ex.projects[0]


def _card(md_text: str) -> dict:
    """Full pipeline projection: the project_cards() dict the transport payload carries."""
    reg = ContextRegistry()
    rep = ingest_docs([parse_bytes("proj.md", md_text.encode("utf-8"))],
                      extractor=HeuristicExtractor(), registry=reg)
    cards = rep.context.project_cards()
    assert cards, "no project card projected"
    return cards[0]


# === risk extraction ==========================================================================

def test_risk_level_and_reason_extracted():
    p = _project("# 婚宴项目\n负责人：小王\n状态：进行中\n进度：58%\n风险：高/雨季无备选场地\n")
    assert p.risk is not None
    assert p.risk.level == "high"
    assert p.risk.reason == "雨季无备选场地"
    assert p.progress == 58


def test_risk_level_only_no_reason():
    p = _project("# 采购项目\n风险：中\n")
    assert p.risk is not None
    assert p.risk.level == "medium"
    assert p.risk.reason == ""


def test_risk_english_level_and_dash_separator():
    p = _project("# Vendor project\n风险：low —— minor slippage only\n")
    assert p.risk is not None
    assert p.risk.level == "low"
    assert p.risk.reason == "minor slippage only"


# === no collision with 风险点 → blockers =======================================================

def test_riskpoint_stays_blocker_not_risk():
    p = _project("# 场地项目\n负责人：小张\n风险点：预算缺口未确认\n")
    assert p.risk is None, "风险点 must NOT be read as the new risk field"
    assert any("预算缺口未确认" in b for b in p.blockers), "风险点 should still land in blockers"


def test_risk_reason_with_english_blocker_word_not_double_caught():
    # A risk reason containing an English blocker keyword ('waiting on') must NOT also be swept
    # into blockers by the generic English blocker sniff — the `风险：` arm `continue`s.
    p = _project("# 依赖项目\n风险：高/waiting on vendor signoff\n")
    assert p.risk is not None and p.risk.level == "high"
    assert "waiting on vendor signoff" in p.risk.reason
    assert not any("waiting on" in b for b in p.blockers), "risk line double-caught as a blocker"


# === out-of-vocab / out-of-range are rejected, never faked ====================================

def test_risk_out_of_vocab_not_extracted():
    p = _project("# 测试项目\n风险：紧急/需要立即处理\n")
    assert p.risk is None, "词表外等级必须整行不抽（不落 other/默认）"


def test_progress_over_100_rejected_not_clamped():
    p = _project("# 超界项目\n进度：150%\n")
    assert p.progress is None, "超界进度必须拒收，绝不 clamp 成 100 这种假值"


def test_progress_zero_is_legal():
    p = _project("# 零进度项目\n进度：0%\n")
    assert p.progress == 0, "0% 是文档真写了的合法已知值"


# === projection: absent ≠ none ================================================================

def test_projection_carries_risk_when_present():
    card = _card("# 婚宴项目\n进度：58%\n风险：高/雨季无备选场地\n")
    assert card.get("risk") == {"level": "high", "reason": "雨季无备选场地"}
    assert card.get("progress") == 58


def test_projection_omits_risk_when_absent():
    card = _card("# 平静项目\n负责人：小王\n状态：进行中\n")
    assert "risk" not in card, "缺席不发键：没有风险行就不投影 risk"
    assert "progress" not in card, "没有进度行就不投影 progress（absent≠none）"


def test_projection_risk_omits_empty_reason():
    # 状态行让项目过 R4「有跟踪字段才算项目」（risk 本身不是 tracked field，risk-only 会被降级）。
    card = _card("# 采购项目\n状态：进行中\n风险：低\n")
    assert card.get("risk") == {"level": "low"}, "reason 省略时不发 reason 键"
