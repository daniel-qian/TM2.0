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
# English scoring word next to a number. Kept as its own pattern so the GATE (`_scan_person_value`)
# can pair it with the precise, suppression-aware ZH scan below — while `_SCORE_WORD_NEAR_NUM`
# (English + a broad ZH strip) stays byte-stable for llm_extract._strip_person_ratings' pre-gate salvage.
_SCORE_WORD_NEAR_NUM_EN = re.compile(
    r"\b(?:score|scored|scoring|rating|rated|rank|ranked|ranking|tier|grade|graded|"
    r"percentile|potential|mood|capacity)\b\D{0,12}\d", re.I)

# feat-029 ROUND 3 — the ZH person-score-number scan for the GATE. The topic word is GROUP 1 so
# work-suppression can test whether it is bound to a WORK ARTIFACT (评分系统 / 排名算法 / KPI体系), in
# lock-step with the advice gate's `_zh_about_work`. Number-shape: the digit fires only when it is a
# SCORE (N分/bare rating), NOT a YEAR (2023), a TENURE (8年/18个月), a COUNT (5万用户), a classifier/
# counter (3成/3组/3版/5项/3份/…), or a VERSION dot-number (系统2.0). The gap forbids ASCII letters so a
# JOB-GRADE token ('定级为P7') breaks the chain and passes. Qualitative labels with no digit
# ('绩效评级：不合格', '排名倒数第一') are NOT scanned here — the content gate catches them.
_ZH_SCORE_NEAR_NUM = re.compile(
    r"(评分|打分|得分|评级|定级|评估|排名|绩效|潜力|情绪|画像|考核|KPI|kpi|产能|工时)"
    r"[^\dA-Za-z]{0,8}(?!19\d{2}|20\d{2})\d{1,3}"
    r"(?!\s*(?:年|个月|月|周|天|日|人|名|位|万|个|千|百|亿|次|条|封|件|台|轮|页|字|号|元|块|"
    r"米|公里|小时|分钟|岁|成|组|版本|版|项|份|期|章|节))"
    r"(?!\.\d)",
    re.I)

# Combined pattern retained for `llm_extract._strip_person_ratings` (a broad pre-gate salvage strip;
# the GATE below uses `_SCORE_WORD_NEAR_NUM_EN` + `_ZH_SCORE_NEAR_NUM`, which are suppression-aware).
_SCORE_WORD_NEAR_NUM = re.compile(
    _SCORE_WORD_NEAR_NUM_EN.pattern
    + r"|(?:评分|打分|得分|评级|定级|评估|排名|绩效|潜力|情绪|画像|考核|KPI|kpi|产能|工时)"
      r"[^\dA-Za-z]{0,8}(?!19\d{2}|20\d{2})\d{1,3}"
      r"(?!\s*(?:年|个月|月|周|天|日|人|名|位|万|个|次|条|封|件|台|轮|页|字|号|元|块|亿|千|百|米|公里|小时|分钟|岁))",
    re.I)


def _zh_score_num_is_work(fld: str, m: re.Match) -> bool:
    """Port of redline._zh_about_work to the extraction number scan: the score topic word (group 1)
    NAMES or is used to BUILD a work artifact (评分系统 / 排名算法 / KPI体系), so the adjacent number is
    about WORK, not a score OF the person. Reuses redline's artifact/build lexicon so the extraction
    layer never rejects a work deliverable the advice gate would accept."""
    after = fld[m.end(1): m.end(1) + 12]
    if redline._ZH_AFTER_ARTIFACT.match(after):
        return True
    before = fld[max(0, m.start(1) - 12): m.start(1)]
    if redline._ZH_BUILD_RE.search(before) and redline._ZH_ARTIFACT_RE.search(after):
        return True
    return False


def _person_text_fields(p: PersonEntity) -> list[str]:
    """Every person free-text field the red line must see.

    `name` IS ON THIS LIST, AND IT IS feat-060's HOLE 1 (READ BEFORE REMOVING IT).
    `name` is the ONE person field that is never derived from a model's judgement and never
    sanitised: `llm_extract` runs `_strip_person_ratings` over role/tenure/owns/collaboration and
    deliberately does NOT run it over `name` — you do not silently rewrite what somebody is called.
    That is the right call, and it is exactly why `name` has to be GATED instead: the only honest
    response to a person called 「绩效8分」 is to refuse the upload, not to rename them to 「绩效」.

    HOW TEXT GETS IN THERE (this is not a hypothetical shape): `extract.py:801`, the resume path,
    falls back to the FILE NAME when no name-like header is found —
        name = re.sub(r"\\.[a-z0-9]+$", "", doc.name).replace("_", " ").strip()
    So `绩效8分.docx` produces a person literally named 「绩效8分」, and `张三-KPI95.pdf` a person named
    「张三-KPI95」. Three external companies are about to upload their own files.

    MEASURED, before the fix — every one of these built a context with ok=True, no violations:
        name='绩效8分'            -> 0 violations      (now caught)
        name='张三-KPI95'         -> 0 violations      (now caught)
        name='王五(离职风险高)'    -> 0 violations      (now caught)
        name='赵六 末位淘汰名单'   -> 0 violations      (now caught)
        name='Bob low performer'  -> 0 violations      (now caught)
    TWO independent bugs produced that, and both are fixed by putting `name` here:
      1. `_scan_person_value` iterates THIS list, so no structural rating-number scan ever saw the
         name — 「张三-KPI95」 passed even with every other field populated.
      2. `validate_extraction` guards the CONTENT scan with `if blob.strip()`. The anchored blob it
         builds mentions `p.name`, so a scoring name in the company of a role WAS caught by luck —
         but a resume with no detectable role/tenure/owns leaves the blob EMPTY, the guard skips,
         and nothing is scanned at all. That is precisely the file-name-fallback person.

    WHY IT IS SAFE TO SCAN (checked by running it, not by reasoning — a false positive here is worse
    than the bug, because validate_extraction failing is a HARD FAIL at pipeline.ingest_docs:130 and
    rejects the customer's ENTIRE upload): both scans fire on rating SHAPES (N/M, N%, N stars, a
    score word next to a score-shaped number) and a person-scoring LEXICON. A personal name is a
    proper noun and carries neither. Verified over Sanya's real 20-person roster, the English names
    the corpus and both stub transports emit, and the file-name-derived shapes the resume fallback
    actually produces (`test_real_names_are_not_violations`).

    `team` IS ON THIS LIST, AND IT IS THE WHOLE OF feat-048 ROUND 3's H1 (READ BEFORE REMOVING IT).
    It was absent for 47 features, and that absence was SAFE for exactly one reason: `team` was a
    closed enumeration. `extract._norm_team` mapped every stated department onto TEAMS or to "", so
    the only values that could reach this dataclass were 'Founders'/'Eng'/'Product'/'Design'/'GTM'/
    'Ops'/'' — no document text could land here, so there was nothing to scan.

    Round 2's BUG-4 pass-through REVOKED that premise: an unmappable department ('前厅部') is now kept
    VERBATIM, so `team` holds arbitrary document text. The premise died; the exclusion did not, and
    the gap was argued the wrong way round in writing (extract._norm_team's docstring claimed
    "team is NOT part of the red line's scan surface ... so pass-through cannot smuggle text past
    that gate" — not-scanned is not a defence, it IS the hole; that sentence has been corrected).

    MEASURED, before and after (the round-2 author reasoned about this and got it backwards, so this
    note reports runs, not readings). role='绩效 8/10 low performer' -> 3 violations; the same string
    in team -> 0 violations BEFORE / 3 AFTER. End-to-end, a roster with the performance-review column
    pasted into the department column built a CompanyContext successfully with ok=True — the exact
    document AVERY_ALLOW_PERSON_SCORING exists to refuse.

    WHY IT IS SAFE TO SCAN (checked, not assumed — a false positive here is worse than the bug it
    fixes, because validate_extraction failing is a HARD FAIL at pipeline.ingest_docs:130 and rejects
    the customer's ENTIRE upload, not one card): the two scans fire on rating SHAPES (N/M, N%, N
    stars) and a scoring LEXICON. A department name is a NOUN and contains neither. Verified over
    Sanya's real org chart plus every English value the corpus and both stub transports emit — 24
    values, all clean (test_real_departments_in_team_are_not_violations_H1).
    """
    return [p.name, p.role, p.tenure, p.team, *p.owns, *p.collaboration]


def _scan_person_value(p: PersonEntity) -> list[ExtractionViolation]:
    """Structural check #1b: a rating-shaped number inside any person free-text field.

    Tenures/counts ("18 months", "9 change requests") do NOT match _RATING_NUMBER / _SCORE_WORD_
    NEAR_NUM, so they pass; a bare N/M, a percent, or a scoring-word-next-to-a-number does not.
    """
    out: list[ExtractionViolation] = []
    for fld in _person_text_fields(p):
        if not fld:
            continue
        hit = bool(_RATING_NUMBER.search(fld) or _SCORE_WORD_NEAR_NUM_EN.search(fld))
        if not hit:
            # ZH: a score topic word next to a score-shaped number, UNLESS it is bound to a work
            # artifact (parity with the advice gate's work-suppression). Iterate so a suppressed
            # first match ('排名算法…3') doesn't mask a later genuine one.
            for zm in _ZH_SCORE_NEAR_NUM.finditer(fld):
                if not _zh_score_num_is_work(fld, zm):
                    hit = True
                    break
        if hit:
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
            # feat-060 — `p.name` is now INSIDE the blob too (_person_text_fields), which is what
            # makes this `if` reachable for a person who has nothing but a name. It is deliberately
            # ALSO left in the prefix: the prefix is the person-anchor, not the payload, and the
            # duplication costs one extra snippet in `detail` at worst.
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
