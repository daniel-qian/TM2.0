"""The advice contract — enforced THROUGH the API.

The engine's native artifact (`avery/tools.py::Advice`) is 3 fields: read / move / framing. The
partner `advice_output_schema` remains the UPPER-BOUND shape (8 fields + conversation_script):

    summary · detected_signals · diagnosis_hypotheses · evidence · recommended_actions ·
    confidence · escalation · metrics_to_track   (+ conversation_script)

0729 输出形态战役 02（Danny 拍板「分流+砍样板」）：REQUIRED 收缩到真内容三件套
（summary/evidence/recommended_actions）；其余字段**按需出现**（absent≠none）——投影层
不再用硬编码常量把 confidence/escalation/metrics_to_track/diagnosis_hypotheses 补齐成
每答必贴的样板文。对外口径同步：schema 字段仍全部有效，但除三件套外均为 optional，
「absent 表示引擎这一轮没有产出该判断」，不是空值。

This module PROJECTS one onto the other WITHOUT touching the engine:

  * `project_advice()` deterministically maps a finished loop transcript onto the contract shape.
    The mapping is structural (no new LLM call): read->summary, cited claims->detected_signals,
    resolved cite lines->evidence, move->recommended_actions, framing->conversation_script.
  * `enforce()` then RE-RUNS the red-line validator over the fully-assembled payload and asserts
    schema completeness (required trio + shape checks on whatever optional fields are present).
    The moat is verified on what the API actually returns, not only on the loop's internal
    artifact. A crossing anywhere in the projected copy fails the contract.

The schema field list is asserted against the frontend render contracts by the contract tests,
so the two never silently drift.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from avery import redline

# 0729 输出形态战役 02（Danny 拍板「分流+砍样板」，用户侧证据 persona-review P1）：
# 必填集从 9 字段收缩到真内容三件套；其余字段改为「有真内容才发键」（absent≠none）。
# 完整 9 字段形状仍是对外 advice_output_schema 的上限形状（OPTIONAL_FIELDS 记录），
# 与前端渲染契约的锁步测试改为「必填 ⊆ 前端」+「可选字段前端都认识」。
REQUIRED_FIELDS = [
    "summary",
    "evidence",
    "recommended_actions",
]

# 按需出现的字段：真 brain 在建议文本里真的给出判断时才有；投影层绝不用硬编码常量补齐
# （旧行为：confidence/escalation/metrics_to_track/diagnosis_hypotheses.alternative 是每答
# 必贴的 500+ 字符样板文——问「例会几点」也带一段「何时拉 HR」。已砍。）
OPTIONAL_FIELDS = [
    "detected_signals",
    "diagnosis_hypotheses",
    "confidence",
    "escalation",
    "metrics_to_track",
    "conversation_script",
]

CONFIDENCE_LEVELS = {"low", "medium", "high"}
ESCALATION_LEVELS = {"none", "HRBP", "legal", "wellbeing", "compensation", "executive"}


@dataclass
class ContractResult:
    ok: bool
    payload: dict[str, Any]
    redline_passed: bool
    redline_summary: str
    schema_ok: bool
    missing_fields: list[str] = field(default_factory=list)
    redline_violations: list[dict] = field(default_factory=list)
    reason: str = ""


# --- projection: engine transcript -> 8-field payload -----------------------------------------

def _sentences(text: str) -> list[str]:
    import re
    parts = re.split(r"(?<=[.!?])\s+", (text or "").strip())
    return [p.strip() for p in parts if p.strip()]


def _actions_from_move(move: str) -> list[str]:
    """Split the decisive 'move' into discrete recommended actions (one per sentence, capped)."""
    sents = _sentences(move)
    # Group into at most a handful of actions so the card stays readable.
    return sents[:6] if sents else ([move.strip()] if move.strip() else [])


def project_advice(transcript: dict) -> dict[str, Any]:
    """Map a finished loop transcript onto the 8-field AgentOutput contract. Deterministic; adds
    no LLM call. Fields the engine does not natively emit are derived as calibrated HYPOTHESES."""
    advice = transcript.get("advice") or {}
    read = (advice.get("read") or "").strip()
    move = (advice.get("move") or "").strip()
    framing = (advice.get("framing") or "").strip()

    cites = transcript.get("cites") or []
    resolved = [c for c in cites if c.get("resolved")]

    # 2 · detected_signals: the observable things the loop actually grounded (from cite claims).
    detected_signals = [c["claim"] for c in resolved if c.get("claim")]
    if not detected_signals:
        # No resolved cites should never happen past the gate, but keep the shape valid.
        detected_signals = [s for s in _sentences(read)][:3]

    # 4 · evidence: the concrete lines the cites resolved to (line-addressable, honest).
    evidence = [f"{c['source_ref']} — {c.get('snippet') or c.get('claim')}"
                for c in resolved if c.get("source_ref")]
    if not evidence:
        evidence = detected_signals[:]

    # 1 · summary: the read, verbatim — it is already a situation-level read, not a person verdict.
    summary = read

    # 5 · recommended_actions: the decisive move, split into discrete steps.
    recommended_actions = _actions_from_move(move)

    # + · conversation_script: the safe-framing opener, verbatim ('senior in your ear').
    conversation_script = framing

    # 0729/02 砍样板：diagnosis_hypotheses（复读 read 的首句 + 固定 alternative 段）、
    # confidence（恒 medium + 固定 rationale/wouldChange）、escalation（恒 none + 固定
    # 「何时拉 HR」）、metrics_to_track（固定 3 条）——四块全是与问题无关的常量文，
    # 投影层不再补齐。absent≠none：缺席=引擎这轮没有真判断，前端对应节不渲染。
    # 真 brain 若在建议文本里给出这些判断，仍由建议正文承载并过红线；
    # 未来引擎原生产出这些槽时（分流片 03+），在这里按真值透传即可。
    payload: dict[str, Any] = {
        "summary": summary,
        "evidence": evidence,
        "recommended_actions": recommended_actions,
    }
    if detected_signals:
        payload["detected_signals"] = detected_signals
    if conversation_script:
        payload["conversation_script"] = conversation_script
    return payload


# --- schema + red-line enforcement over the assembled payload ---------------------------------

def _redline_text(payload: dict[str, Any]) -> str:
    """Flatten every human-facing string in the 8-field payload into one blob so the red line is
    checked over EVERYTHING the API returns — summary, signals, hypotheses, actions, script, the
    escalation/confidence prose — not just the loop's internal artifact."""
    parts: list[str] = [str(payload.get("summary", "")),
                        str(payload.get("conversation_script", ""))]
    for key in ("detected_signals", "evidence", "recommended_actions", "metrics_to_track"):
        parts.extend(str(x) for x in payload.get(key, []) or [])
    for h in payload.get("diagnosis_hypotheses", []) or []:
        parts.append(str(h.get("label", "")))
    conf = payload.get("confidence", {}) or {}
    parts.append(str(conf.get("rationale", "")))
    parts.extend(str(x) for x in conf.get("wouldChange", []) or [])
    esc = payload.get("escalation", {}) or {}
    parts.append(str(esc.get("note", "")))
    return "\n".join(p for p in parts if p)


def check_schema(payload: dict[str, Any]) -> list[str]:
    """Return the list of missing/empty required fields ([] == schema-complete).

    0729/02: required 收缩到三件套；calibration 字段（confidence/escalation）改为
    「在场才验形状」——absent 合法（≠none），在场就必须是合法枚举。"""
    missing: list[str] = []
    for f in REQUIRED_FIELDS:
        if f not in payload:
            missing.append(f)
            continue
        val = payload[f]
        if val is None or (isinstance(val, (str, list, dict)) and len(val) == 0):
            missing.append(f)
    # Nested calibration shape — only when the field is actually present.
    if "confidence" in payload:
        conf = payload.get("confidence") or {}
        if not isinstance(conf, dict) or conf.get("level") not in CONFIDENCE_LEVELS:
            missing.append("confidence.level")
    if "escalation" in payload:
        esc = payload.get("escalation") or {}
        if not isinstance(esc, dict) or esc.get("level") not in ESCALATION_LEVELS:
            missing.append("escalation.level")
    return missing


def enforce(transcript: dict, cited_snippets: list[str] | None = None) -> ContractResult:
    """Project the transcript to the 8-field contract, then RE-VALIDATE red line + schema over the
    assembled payload. This is the API-level contract gate."""
    payload = project_advice(transcript)

    missing = check_schema(payload)
    schema_ok = not missing

    rl = redline.validate(_redline_text(payload), cited_snippets or [])
    redline_passed = rl.passed

    ok = schema_ok and redline_passed
    reason = ""
    if not schema_ok:
        reason = "schema incomplete: missing " + ", ".join(missing)
    elif not redline_passed:
        reason = "red-line crossing in projected payload: " + rl.summary()

    return ContractResult(
        ok=ok,
        payload=payload,
        redline_passed=redline_passed,
        redline_summary=rl.summary(),
        schema_ok=schema_ok,
        missing_fields=missing,
        redline_violations=[{"rule_id": v.rule_id, "snippet": v.snippet, "note": v.note}
                            for v in rl.violations],
        reason=reason,
    )
