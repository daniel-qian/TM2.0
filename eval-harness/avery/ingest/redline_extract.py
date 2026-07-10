"""The red line, extended to EXTRACTION OUTPUT (feat-016 AFK gate — ADR-0021 §4).

`avery/redline.py` gates the advisor's final *advice*. Ingestion needs the same moat one stage
earlier: the moment a resume/roster/weekly becomes structured entities, a PersonEntity must be
QUALITATIVE ONLY. This module is the deterministic gate that HARD-FAILS an extraction result if a
person entity smuggles in a score / rank / rating / tier / moodPct / capacityPct — whether the
extractor was the offline heuristic or a hallucinating LLM.

Two hard checks, composed with the existing content validator:

  1. STRUCTURAL — a PersonEntity's fields. The dataclass has no numeric attribute by design, but a
     real LLM extractor might hand us a dict with an extra key or stuff a number into a text field.
     We (a) reject any person dict carrying a forbidden scoring key, and (b) reject a bare number /
     percent / N-of-M in any person text field (role/tenure/owns/collaboration) that reads as a
     rating rather than a tenure/count ("18 months", "9 requests" are allowed; "8/10", "82%",
     "rating 4" are not).

  2. CONTENT — every person's rendered free text is run through `avery.redline.validate` with the
     subject FORCED to a person, so the full person-scoring lexicon (scorecard / percentile / low
     performer / flight risk / toxic / C-player ...) fires. Project/material text is NOT gated this
     way (work may be quantified — R2), matching the advice-side asymmetry.

The result is a hard AFK gate: `validate_extraction(result).ok` must be True before a CompanyContext
is built. `pipeline.ingest_*` calls it and refuses to publish a context that fails.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

from avery import redline

from .extract import (
    ExtractionResult, PersonEntity, FORBIDDEN_PERSON_KEYS, FORBIDDEN_PERSON_KEYS_ZH,
)


@dataclass
class ExtractionViolation:
    kind: str                    # "person-score-key" | "person-score-value" | "person-score-text"
    person: str                  # which person (name/id)
    detail: str                  # what tripped it
    rule_id: str = ""            # underlying redline rule id when kind == person-score-text


@dataclass
class ExtractionRedlineResult:
    ok: bool
    violations: list[ExtractionViolation] = field(default_factory=list)

    def __bool__(self) -> bool:
        return self.ok

    def summary(self) -> str:
        if self.ok:
            return "EXTRACTION-REDLINE PASS"
        return "EXTRACTION-REDLINE FAIL[" + ", ".join(
            f"{v.kind}:{v.person}" for v in self.violations) + "]"


# A number that reads as a RATING (not a tenure/count). Tenures ("18 months", "2 years"), counts
# ("9 requests", "12 comments") and dates are allowed; a bare N/M, a percent, or "rating: 4" are not.
_TENURE_OR_COUNT = re.compile(
    r"\b\d+\+?\s*(?:years?|yrs?|months?|mos?|weeks?|days?|hours?|"
    r"people|persons?|reports?|requests?|comments?|reviews?|items?|tasks?|tickets?|"
    r"projects?|deliverables?|times?|rounds?)\b", re.I)
_RATING_NUMBER = re.compile(
    r"\b\d{1,3}(?:\.\d+)?\s*(?:/|out\s+of)\s*\d{1,3}\b"      # 8/10, 3 out of 5
    r"|\b\d{1,3}(?:\.\d+)?\s*%"                                # 82%
    r"|\b\d(?:\.\d+)?\s*stars?\b", re.I)
_SCORE_WORD_NEAR_NUM = re.compile(
    r"\b(?:score|scored|scoring|rating|rated|rank|ranked|ranking|tier|grade|graded|"
    r"percentile|potential|mood|capacity)\b\D{0,12}\d"
    # feat-029 — Chinese scoring word next to a SCORE-SHAPED number in a PERSON field ('绩效评分2分',
    # 'KPI评分88分', '情绪状态值3', '排名第2'). ROUND 2 number-shape: the digit fires only when it is
    # a score (N分/bare rating), NOT a YEAR (2023), a TENURE (8年/18个月) or a COUNT (5万用户). The
    # gap forbids ASCII letters so a JOB-GRADE token ('定级为P7') breaks the chain and passes.
    # Qualitative labels with no digit ('绩效评级：不合格', '排名倒数第一') are NOT stripped here — the
    # content gate catches them.
    r"|(?:评分|打分|得分|评级|定级|评估|排名|绩效|潜力|情绪|画像|考核|KPI|kpi|产能|工时)"
    r"[^\dA-Za-z]{0,8}(?!19\d{2}|20\d{2})\d{1,3}"
    r"(?!\s*(?:年|个月|月|周|天|日|人|名|位|万|个|次|条|封|件|台|轮|页|字|号|元|块|亿|千|百|米|公里|小时|分钟|岁))",
    re.I)


def _person_text_fields(p: PersonEntity) -> list[str]:
    return [p.role, p.tenure, *p.owns, *p.collaboration]


def _scan_person_value(p: PersonEntity) -> list[ExtractionViolation]:
    """Structural check #1b: a rating-shaped number inside any person free-text field.

    Tenures/counts ("18 months", "9 change requests") do NOT match _RATING_NUMBER / _SCORE_WORD_
    NEAR_NUM, so they pass; a bare N/M, a percent, or a scoring-word-next-to-a-number does not.
    """
    out: list[ExtractionViolation] = []
    for fld in _person_text_fields(p):
        if not fld:
            continue
        if _RATING_NUMBER.search(fld) or _SCORE_WORD_NEAR_NUM.search(fld):
            out.append(ExtractionViolation(
                kind="person-score-value", person=p.name,
                detail=f"rating-shaped number in a person field: «{fld[:80]}»"))
    return out


def validate_person_dict(name: str, data: dict) -> list[ExtractionViolation]:
    """Structural check #1a: reject a raw person dict (e.g. from an LLM extractor) that carries any
    forbidden scoring key. Call this BEFORE constructing a PersonEntity from model output."""
    out: list[ExtractionViolation] = []
    for key in data.keys():
        # feat-029 — keep CJK through normalization so a Chinese scoring key survives (the ASCII
        # path is byte-identical: English keys have no CJK). English = exact match; Chinese =
        # substring, so '绩效评分' trips '评分' and '离职风险' trips '离职风险'. ROUND 2 — fold
        # Traditional→Simplified first so 績效評分/離職風險 (Traditional keys) trip the same substrings.
        norm = re.sub(r"[^a-z0-9一-鿿]", "", redline.zh_normalize(str(key).lower()))
        if norm in FORBIDDEN_PERSON_KEYS or any(z in norm for z in FORBIDDEN_PERSON_KEYS_ZH):
            out.append(ExtractionViolation(
                kind="person-score-key", person=name,
                detail=f"forbidden scoring key on a person: '{key}'"))
    return out


def validate_extraction(result: ExtractionResult) -> ExtractionRedlineResult:
    """THE AFK gate. Hard-fail if any PersonEntity carries or reads as a person score.

    Projects and materials are intentionally NOT person-gated (work may be quantified — R2). Only
    person entities and person-directed signals are held to the qualitative-only red line.
    """
    violations: list[ExtractionViolation] = []

    for p in result.people:
        # #1b structural: rating-shaped numbers in person free text
        violations += _scan_person_value(p)
        # #2 content: full person-scoring lexicon over the rendered person text, subject forced=person
        blob = "\n".join(_person_text_fields(p))
        if blob.strip():
            # Anchor to a person so ambiguous forms fire (redline person-anchoring). Prefix a
            # pronoun/noun so _has_person() is true for the whole segment window.
            anchored = f"This teammate ({p.name}), she: {blob}"
            rl = redline.validate(anchored)
            for v in rl.violations:
                violations.append(ExtractionViolation(
                    kind="person-score-text", person=p.name,
                    detail=f"{v.rule_id}: «{v.snippet}»", rule_id=v.rule_id))

    # person-directed signals must stay at SITUATION — never a person-scoring label.
    for s in result.signals:
        if s.subjectType != "person":
            continue
        anchored = f"About this teammate, she: {s.summary}"
        rl = redline.validate(anchored)
        for v in rl.violations:
            violations.append(ExtractionViolation(
                kind="person-score-text", person=str(s.subjectRef),
                detail=f"signal {v.rule_id}: «{v.snippet}»", rule_id=v.rule_id))

    return ExtractionRedlineResult(ok=len(violations) == 0, violations=violations)
