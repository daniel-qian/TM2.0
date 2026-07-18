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
import threading
import time

log = logging.getLogger("avery.ingest.llm_extract")

from .extract import (
    ExtractionResult, Extractor, HeuristicExtractor, PersonEntity, ProjectEntity,
    SignalEntity, _INDEX_TOKEN_RE, _NOT_NAME, _norm_status, _norm_team, _person_key,
    _project_key, _slug,
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
resume, weekly, handbook...). Documents may be in English or Chinese. You return STRICT JSON only
— no prose, no markdown fences.

HARD RULES (a compliance gate rejects your output if you break them):
- PEOPLE ARE QUALITATIVE ONLY. Never output a score, rating, ranking, tier, grade, percentage,
  mood or capacity number about a person — not as a field, not inside text. This INCLUDES
  allocation/utilization percentages from staffing tables ('80%', '~10%'): drop the number,
  keep the qualitative part ('project lead, throughout' — never '80% allocated').
- 人只做定性描述,绝不评分。中文同样禁止:对某个人输出 评分/打分/得分、评级/定级、排名、绩效分、
  KPI分、潜力评估/潜力值、员工画像/人才画像、情绪值/情绪状态值、离职风险/流失风险、末位淘汰、
  甲乙丙丁等级 —— 无论作为字段还是写进文本。把数字/等级/标签删掉,只保留定性内容:
  '主导支付网关交付、与设计紧密协作'(而不是 '绩效评分2分' 或 '排名倒数')。
  注意区分:项目可以量化(进度70%、状态:有风险),客户/产品可以有 用户画像/产品排名 —— 这些不是
  给人打分,照常抽取;只有把数字/名次/等级/风险标签钉在【某个人】身上才违规。
- NEVER invent. Only entities the document actually states. A field the document does not state
  is "" (or [] for lists).
- Header/label cells are NOT people: "No.", "Name", "Case ID", "Role", "Title", "姓名", "序号",
  "编号", column headers, numbering — never a person. Real people have real human names.
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
  rows). role = their stated title.
  team = the department / team / group THE DOCUMENT ITSELF gives this person, copied VERBATIM in
  the document's own words and language — from a 部门/团队/组 column, a section heading they sit
  under, or a sentence that says so. Do NOT translate it, do NOT tidy it, and do NOT map it onto
  any preset category list: 「别墅销售组」 comes back as 「别墅销售组」, never as an English bucket.
  Only if the document names no department for ANYONE, fall back to the person's OWN stated title
  and map it onto EXACTLY ONE of these six words, copied letter-for-letter:
  Founders | Eng | Product | Design | GTM | Ops
  Use one of those six and nothing else — never a word of your own invention: a "Design Director"
  -> Design; a "Founder / CEO" -> Founders; a "Head of Sales" -> GTM; an "Office Manager" -> Ops.
  If a title maps onto none of the six, "".
  tenure = stated experience/tenure phrase (e.g. "8 years of B2B design", free text).
  owns = up to 6 short phrases of what they own / are responsible for, from the doc.
- projects: one entry per project THE DOCUMENT TRACKS IN ITS OWN RIGHT — it gives that project its
  own owner, status, progress or deadline. A MILESTONE, phase, checkpoint or task INSIDE a project
  is NOT a project: do not emit it. Concretely, a row under a 「里程碑：」/"Milestones:" list
  (「预算缺口确认 — 受阻」, "Budget sign-off — done") belongs to the project above it and must be
  left out. If the document says how many projects it covers (「本期周报覆盖 6 个在跟进项目」),
  that is the number of entries to return.
  title must be a meaningful name from the content — NEVER the source filename, and never a
  milestone's name. status only from: on-track|at-risk|blocked|done|"".
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


# Label/header cells that are obviously not a human — belt to the model's suspenders (_SYSTEM
# already forbids them; this catches the model DISOBEYING, so it may not assume compliance).
#
# ONE LIST, NOT TWO (feat-048, round-2 follow-up — spotted by inspection in r2, out of r2's scope;
# NOT "round 4", which is the TEAM-axis line). This used to be a self-contained regex that copied the
# heuristic's `_NOT_NAME` words, and the copy did what copies do: by round 3 the regex was missing
# every Chinese header (「姓名」/「职位」/「部门」— shipping a colleague named "Name" to an all-Chinese
# customer, feat-039's "No." bug reborn) AND ~18 English labels the heuristic had since grown
# (date/dept/designation/directory/id/index/manager/notes/person/phone/project/roster/s.no/sl/sn/
# sr/seq/#). Both paths guard the SAME question — "is this cell a person or a label?" — so they now
# read the SAME answer, and a word added to _NOT_NAME is covered here for free.
#
# _NOT_NAME + _INDEX_TOKEN_RE together, because the heuristic's defence is both: _looks_like_name
# consults the pair, and 序号/编号 live only in the regex half. Only these three patterns are
# genuinely regex-shaped (prefix/numeric matches with no literal to list) and so stay local.
_NOT_A_PERSON_EXTRA = re.compile(r"^(?:case[\s\-]?id.*|sheet.*|\d+)$", re.I)


def _not_a_person(name: str) -> bool:
    token = (name or "").strip()
    if not token:
        return True
    # .lower() is a no-op on Han; _NOT_NAME is stored lowercased for the ASCII half
    if token.lower() in _NOT_NAME or _INDEX_TOKEN_RE.match(token):
        return True
    return bool(_NOT_A_PERSON_EXTRA.match(token))


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
        # feat-039: honest-degradation telemetry — how many docs the MODEL handled vs how many fell
        # back to the heuristic (429 / no key / red-line breach / budget exhausted / no entities). The
        # /ingest handler reads `degraded` to label extraction_mode (llm vs degraded). extract_docs
        # may call extract() concurrently over ONE instance, so the counters are lock-guarded.
        self._tlock = threading.Lock()
        self._llm_docs = 0
        self._fallback_docs = 0

    # -- public -----------------------------------------------------------------------------

    def _fell_back(self, doc: ParsedDoc) -> ExtractionResult:
        with self._tlock:
            self._fallback_docs += 1
        return self._fallback.extract(doc)

    @property
    def degraded(self) -> bool:
        """True when the model handled NO document (all fell back) OR at least one doc silently fell
        back to the heuristic — the honest 'this extraction was (partly) low-quality' signal."""
        with self._tlock:
            return self._fallback_docs > 0 or self._llm_docs == 0

    def extract(self, doc: ParsedDoc) -> ExtractionResult:
        try:
            res = self._extract_with_model(doc)
        except Exception as e:
            log.warning("LLM extraction failed for %s -> heuristic fallback: %s: %s",
                        doc.name, type(e).__name__, str(e)[:300])
            return self._fell_back(doc)
        # the same red-line gate, INSIDE the extractor: a scoring extraction never leaves here
        rl = validate_extraction(res)
        if not rl.ok:
            log.warning("LLM extraction for %s failed the red line -> heuristic fallback: %s",
                        doc.name, rl.summary())
            return self._fell_back(doc)
        if not (res.people or res.projects or res.signals):
            # the model saw nothing structurable — the conservative regexes get a shot
            log.warning("LLM extraction for %s returned no entities -> heuristic fallback", doc.name)
            return self._fell_back(doc)
        with self._tlock:
            self._llm_docs += 1
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
            if _not_a_person(name):
                continue
            # structural red line on the RAW dict: any forbidden scoring key kills this record
            if validate_person_dict(name, raw):
                continue
            # shared with cross-document dedup (extract._dedupe_entities) — one definition of
            # "same person", so within-doc and cross-doc can never drift apart
            key = _person_key(name)
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
            norm_title = _project_key(title)   # shared with cross-document dedup — see _person_key
            if not title or norm_title in seen_titles:
                continue
            if norm_title == _project_key(stem):
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
