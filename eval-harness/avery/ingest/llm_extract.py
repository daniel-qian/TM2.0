"""feat-023 — LLMExtractor: the real extraction engine (ADR-0022 decision 2).

2026-07-07 the heuristic extractor met the two OFFICIAL seed files and produced one fake person
called "No." and one filename-titled project. ADR-0022: the game of regexes cannot be won against
real-world documents — extraction goes to an LLM, the regexes stay as the offline/test fallback.

Shape of the thing:

  * `LLMExtractor` implements the `Extractor` protocol (extract.py). It feeds the brain the doc as
    LINE-NUMBERED text and demands ONE strict-JSON result naming every person / project / signal —
    **each entity carrying the source line number**, so `source="<file>:<line>"` keeps the cite
    chain unbroken (the same `facts.md:<line>` audit trail the advisor already runs on).
  * The brain is PLUGGABLE (mirrors avery/brain.py). In reality that is MiniMax-M3 or DeepSeek —
    an OpenAI-compatible endpoint; `claude` exists in brain_factory as an unkeyed code path only
    and must never be assumed. The extractor takes any `Brain` (respond()) — tests hand it a
    scripted fake, no network.
  * SAFETY IS LAYERED, not trusted:
      1. structural sanitizer — only whitelisted fields survive the model's JSON; a smuggled
         scoring key (moodPct / rating / ...) dies here (validate_person_dict), numbers are
         coerced to strings or dropped;
      2. the SAME red-line gate (`redline_extract.validate_extraction`) runs over the built
         result INSIDE the extractor — a person-scoring extraction falls back, per doc, to the
         heuristic rather than poisoning the payload;
      3. `pipeline.ingest_*` runs the gate AGAIN over the merged batch — the backstop that
         refuses to publish a context (never removed).
  * ANY failure — no key, timeout, refusal, unparseable JSON, red-line breach — falls back to
    `HeuristicExtractor` for that doc. The offline AFK gate therefore never needs a key: forced
    heuristic mode (AVERY_EXTRACTOR=heuristic) and keyless auto mode behave exactly like today.
  * Materials (the RAG corpus the advisor cites) stay DETERMINISTIC: line-addressed chunks from
    the same code path the heuristic uses. The LLM extracts entities; it never rewrites the
    corpus the cite gate resolves against.
"""
from __future__ import annotations

import json
import logging
import re
import time

log = logging.getLogger("avery.ingest.llm_extract")

from .extract import (
    ExtractionResult, Extractor, HeuristicExtractor, PersonEntity, ProjectEntity,
    SignalEntity, _norm_status, _norm_team, _slug,
)
from .parse import ParsedDoc
from .redline_extract import (
    _RATING_NUMBER, _SCORE_WORD_NEAR_NUM, validate_extraction, validate_person_dict,
)

# One extraction call sees at most this many numbered lines; longer docs are windowed and merged.
# Sized so BOTH official seeds fit in a single window (xlsx 44 / pdf 264 lines): fewer calls =
# fewer flake surfaces — the full-suite run caught a real one-window-dropped flake at 220.
MAX_LINES_PER_CALL = 320

_ALLOWED_STATUS = {"on-track", "at-risk", "blocked", "done", ""}

_SYSTEM = """You extract structured company data from ONE workplace document (roster, roadmap,
resume, weekly, handbook...). You return STRICT JSON only — no prose, no markdown fences.

HARD RULES (a compliance gate rejects your output if you break them):
- PEOPLE ARE QUALITATIVE ONLY. Never output a score, rating, ranking, tier, grade, percentage,
  mood or capacity number about a person — not as a field, not inside text. This INCLUDES
  allocation/utilization percentages from staffing tables ('80%', '~10%'): drop the number,
  keep the qualitative part ('project lead, throughout' — never '80% allocated').
- NEVER invent. Only entities the document actually states. A field the document does not state
  is "" (or [] for lists).
- Header/label cells are NOT people: "No.", "Name", "Case ID", "Role", "Title", column headers,
  numbering — never a person. Real people have real human names.
- Every entity carries "line": the 1-based line number (from the numbered input) where that
  entity is defined or first appears. This is the audit trail; it must point at a real line.
"""

_INSTRUCTIONS = """Return exactly this JSON shape:
{
  "people": [
    {"name": "", "role": "", "team": "", "tenure": "", "owns": [""], "collaboration": [""], "line": 0}
  ],
  "projects": [
    {"title": "", "ownerName": "", "status": "", "progress": null, "dueDate": "", "summary": "",
     "blockers": [""], "line": 0}
  ],
  "signals": [
    {"subjectType": "person|project", "subjectRef": "", "summary": "", "tag": "", "line": 0}
  ]
}

Field rules:
- people: one entry per real named individual. In a roster/table: one per data row (skip header
  rows). role = their stated title. team = one of Founders|Eng|Product|Design|GTM|Ops if it can be
  honestly mapped, else "". tenure = stated experience/tenure phrase (e.g. "8 years of B2B design",
  free text). owns = up to 6 short phrases of what they own / are responsible for, from the doc.
- projects: one entry per distinct project, phase or engagement THE DOC DESCRIBES AS WORK (e.g.
  "Phase 1" and "Phase 2" of an engagement are two entries). title must be a meaningful name from
  the content — NEVER the source filename. status only from: on-track|at-risk|blocked|done|"".
  progress: integer 0-100 ONLY if the doc states a completion number for that project, else null.
- signals: notable, doc-stated situation signals (blockers, unresolved feedback, workload spikes).
  For a person-directed signal, summary describes the SITUATION they are carrying — never a
  judgment or label about the person.
- Output at most 40 people, 12 projects, 12 signals. JSON only."""


def _numbered(lines: list[str], start: int, end: int) -> str:
    out = []
    for i in range(start, min(end, len(lines))):
        ln = lines[i].strip()
        if ln:
            out.append(f"{i + 1}| {ln[:400]}")
    return "\n".join(out)


def _parse_json_block(text: str) -> dict:
    """Parse the model's JSON, tolerating fences/prose around a single top-level object."""
    t = (text or "").strip()
    t = re.sub(r"^```(?:json)?\s*|\s*```$", "", t, flags=re.S)
    try:
        return json.loads(t)
    except json.JSONDecodeError:
        start, end = t.find("{"), t.rfind("}")
        if start >= 0 and end > start:
            return json.loads(t[start:end + 1])
        raise


def _s(v, cap: int = 200) -> str:
    """Coerce a model value to a clean bounded string ('' for None/objects)."""
    if v is None or isinstance(v, (dict, list)):
        return ""
    return str(v).strip()[:cap]


def _strip_person_ratings(text: str) -> str:
    """Excise rating-shaped numbers from a PERSON free-text field (the same shapes the red-line
    gate rejects: percents, N/M, score-word-near-number). Real docs carry per-person allocation
    tables ('Aarav Patel — 80%'); the model sometimes copies them despite instructions, and one
    smuggled percent must not collapse the whole doc to the heuristic. Mirrors the frontend's
    strip philosophy: the number is removed, the qualitative text survives, the gate stays the
    backstop for anything this misses."""
    if not text:
        return text
    out = _SCORE_WORD_NEAR_NUM.sub("", _RATING_NUMBER.sub("", text))
    out = re.sub(r"[~≈]\s*(?=$|[,;.)])", "", out)          # orphaned approx-markers
    out = re.sub(r"\(\s*\)|\[\s*\]", "", out)              # emptied brackets
    out = re.sub(r"\s{2,}", " ", out).strip(" ,;-—·")
    return out


def _slist(v, cap_items: int = 6, cap_len: int = 180) -> list[str]:
    if not isinstance(v, list):
        return []
    out = [_s(x, cap_len) for x in v]
    return [x for x in out if x][:cap_items]


def _line_ref(doc: ParsedDoc, v, default: int = 1) -> str:
    try:
        n = int(v)
    except (TypeError, ValueError):
        n = default
    n = max(1, min(n, max(1, len(doc.lines))))
    return f"{doc.name}:{n}"


# names that are obviously not a human (header/label cells) — belt to the model's suspenders
_NOT_A_PERSON = re.compile(
    r"^(no\.?|name|role|title|team|owner|status|case[\s\-]?id.*|member(s)?|people|background|"
    r"current responsibilities|responsibilities|department|email|tenure|profile|sheet.*|total|"
    r"n/?a|none|unknown|tbd|\d+)$", re.I)


class LLMExtractor:
    """Real-model extraction behind the `Extractor` protocol. Sanitize -> gate -> fallback."""

    def __init__(self, brain, fallback: Extractor | None = None,
                 max_lines_per_call: int = MAX_LINES_PER_CALL, retry_backoff_s: float = 2.0):
        self._brain = brain
        self._fallback = fallback or HeuristicExtractor()
        self._window = max(20, int(max_lines_per_call))
        self._backoff = max(0.0, retry_backoff_s)   # tests pass 0 — no sleeping on a fake brain
        # deterministic material chunking (the citable RAG corpus) reuses the heuristic's path
        self._chunker = HeuristicExtractor()

    # -- public -----------------------------------------------------------------------------

    def extract(self, doc: ParsedDoc) -> ExtractionResult:
        try:
            res = self._extract_with_model(doc)
        except Exception as e:
            log.warning("LLM extraction failed for %s -> heuristic fallback: %s: %s",
                        doc.name, type(e).__name__, str(e)[:300])
            return self._fallback.extract(doc)
        # the same red-line gate, INSIDE the extractor: a scoring extraction never leaves here
        rl = validate_extraction(res)
        if not rl.ok:
            log.warning("LLM extraction for %s failed the red line -> heuristic fallback: %s",
                        doc.name, rl.summary())
            return self._fallback.extract(doc)
        if not (res.people or res.projects or res.signals):
            # the model saw nothing structurable — the conservative regexes get a shot
            log.warning("LLM extraction for %s returned no entities -> heuristic fallback", doc.name)
            return self._fallback.extract(doc)
        return res

    # -- model round-trip -------------------------------------------------------------------

    def _extract_with_model(self, doc: ParsedDoc) -> ExtractionResult:
        lines = doc.lines
        merged: dict = {"people": [], "projects": [], "signals": []}
        windows = attempted = 0
        for start in range(0, max(1, len(lines)), self._window):
            body = _numbered(lines, start, start + self._window)
            if not body.strip():
                continue
            attempted += 1
            user = (f"Document: {doc.name} (kind hint: {doc.doc_kind})\n"
                    f"Lines {start + 1}-{min(start + self._window, len(lines))} of {len(lines)}, "
                    f"numbered `N| text`:\n\n{body}\n\n{_INSTRUCTIONS}")
            # One failed window must not sink the doc — partial extraction beats full fallback.
            # (M3 is a reasoning model: a long think can truncate the JSON tail of ONE window;
            # rapid-fire windows can also trip provider rate limits.) Retry with backoff.
            data = None
            for attempt in range(3):
                try:
                    data = self._call_once(user)
                    break
                except Exception as e:
                    log.warning("extraction window %s..%s of %s attempt %d failed: %s: %s",
                                start + 1, min(start + self._window, len(lines)), doc.name,
                                attempt + 1, type(e).__name__, str(e)[:300])
                    if attempt < 2 and self._backoff:
                        time.sleep(self._backoff * (attempt + 1))
            if data is None:
                continue
            windows += 1
            for key in merged:
                val = data.get(key)
                if isinstance(val, list):
                    merged[key].extend(val)
        if attempted and not windows:
            raise RuntimeError(f"all {attempted} extraction windows failed for {doc.name}")
        return self._build(doc, merged)

    def _call_once(self, user: str) -> dict:
        resp = self._brain.respond(
            _SYSTEM, [{"role": "user", "content": [{"type": "text", "text": user}]}], tools=[])
        return _parse_json_block(resp.text or "")

    # -- sanitize + build (whitelist only — a smuggled key dies here) ------------------------

    def _build(self, doc: ParsedDoc, data: dict) -> ExtractionResult:
        res = ExtractionResult()
        seen_people: dict[str, PersonEntity] = {}
        for raw in data.get("people", [])[:40]:
            if not isinstance(raw, dict):
                continue
            name = _s(raw.get("name"), 80)
            if not name or _NOT_A_PERSON.match(name):
                continue
            # structural red line on the RAW dict: any forbidden scoring key kills this record
            if validate_person_dict(name, raw):
                continue
            key = re.sub(r"\s+", " ", name.lower())
            person = seen_people.get(key)
            if person is None:
                person = PersonEntity(
                    id=_slug(name, "u"), name=name,
                    role=_strip_person_ratings(_s(raw.get("role"), 120)),
                    team=_norm_team(_s(raw.get("team"), 40)),
                    tenure=_strip_person_ratings(_s(raw.get("tenure"), 120)),
                    owns=[_strip_person_ratings(o) for o in _slist(raw.get("owns")) if
                          _strip_person_ratings(o)],
                    collaboration=[_strip_person_ratings(c) for c in
                                   _slist(raw.get("collaboration")) if _strip_person_ratings(c)],
                    source=_line_ref(doc, raw.get("line")))
                seen_people[key] = person
                res.people.append(person)
            else:
                # same person across windows: enrich, don't duplicate
                extra = [_strip_person_ratings(o) for o in _slist(raw.get("owns"))]
                person.owns = (person.owns + [o for o in extra if o])[:6]
                person.role = person.role or _strip_person_ratings(_s(raw.get("role"), 120))

        seen_titles: set[str] = set()
        stem = re.sub(r"\.[a-z0-9]+$", "", doc.name, flags=re.I).lower()
        for raw in data.get("projects", [])[:12]:
            if not isinstance(raw, dict):
                continue
            title = _s(raw.get("title"), 140)
            norm_title = re.sub(r"[\s_\-]+", " ", title.lower()).strip()
            if not title or norm_title in seen_titles:
                continue
            if norm_title == re.sub(r"[\s_\-]+", " ", stem):
                continue                      # a filename is not a project title
            seen_titles.add(norm_title)
            status = _s(raw.get("status"), 20).lower()
            if status not in _ALLOWED_STATUS:
                status = _norm_status(status)
            progress = raw.get("progress")
            if isinstance(progress, bool) or not isinstance(progress, (int, float)):
                progress = None
            else:
                progress = max(0, min(100, int(progress)))
            res.projects.append(ProjectEntity(
                id=_slug(title, "p"), title=title,
                ownerName=_s(raw.get("ownerName"), 80),
                status=status, progress=progress,
                dueDate=_s(raw.get("dueDate"), 60),
                summary=_s(raw.get("summary"), 240),
                blockers=_slist(raw.get("blockers"), 6, 180),
                source=_line_ref(doc, raw.get("line"))))

        for raw in data.get("signals", [])[:12]:
            if not isinstance(raw, dict):
                continue
            summary = _s(raw.get("summary"), 220)
            if not summary:
                continue
            subject_type = _s(raw.get("subjectType"), 20).lower()
            if subject_type not in ("person", "project", "task"):
                subject_type = "project"
            res.signals.append(SignalEntity(
                id=_slug(summary, "s"), source_kind="doc",
                subjectType=subject_type,
                subjectRef=_s(raw.get("subjectRef"), 80) or "the project",
                summary=summary, tag=_s(raw.get("tag"), 30),
                source=_line_ref(doc, raw.get("line"))))

        # deterministic, line-addressable RAG corpus — same path as the heuristic (cite gate
        # resolves against these lines; the model never rewrites them)
        res.materials = self._chunker._materials(doc).materials
        return res


class FallbackExtractor:
    """`Extractor` that tries a primary and falls back per doc — used when the primary itself
    may be absent (no key): behaves as pure heuristic then."""

    def __init__(self, primary: Extractor | None, fallback: Extractor | None = None):
        self._primary = primary
        self._fallback = fallback or HeuristicExtractor()

    def extract(self, doc: ParsedDoc) -> ExtractionResult:
        if self._primary is None:
            return self._fallback.extract(doc)
        try:
            return self._primary.extract(doc)
        except Exception:
            return self._fallback.extract(doc)
