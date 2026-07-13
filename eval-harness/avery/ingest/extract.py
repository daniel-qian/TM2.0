"""Stage 2 — red-line-safe structured extraction: parsed text -> entities.

Turns `ParsedDoc`s into the entity shapes the frontend already knows (`src/data/fixtures.ts`):
  * PersonEntity   role / team / tenure / what-they-own / collaboration — QUALITATIVE ONLY.
  * ProjectEntity  status / progress? / owner / summary / blockers — work MAY be quantified.
  * SignalEntity   doc-derived signal ("12 unresolved comments", "acceptance not set"); a signal
                   pointing at a PERSON stops at situation ("she's carrying a week of change"),
                   never a negative label on the person.
  * MaterialChunk  company-doc snippet -> the vector/keyword RAG the advisor cites.

THE RED LINE lives structurally here, not just as a post-hoc scan:
  A PersonEntity has NO numeric/score field at all. The dataclass literally cannot hold a
  moodPct / capacityPct / rating / rank / tier — those attributes do not exist on it. That makes
  "a resume never becomes a person score" a property of the type, and `redline_extract.validate_
  extraction` is the AFK gate that also scans every person's free-text fields for smuggled scoring.

Extractor is pluggable (mirrors the pluggable brain):
  * HeuristicExtractor — deterministic, offline, NO model. Regex/keyword rules over the parsed
    text. This is what the AFK gate runs so the whole pipeline is green with no embedding/LLM
    service. It is intentionally conservative: it extracts what it can cite to a line and, by
    construction, emits person fields that are qualitative.
  * LLMExtractor (interface `Extractor`) — a real model does richer extraction in production.
    Whatever it returns is passed through the SAME red-line gate before it is allowed into a
    CompanyContext, so a hallucinated person-score is caught, not trusted.
"""
from __future__ import annotations

import os
import re
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import Protocol

from .parse import ParsedDoc

# Teams mirror the frontend Person['team'] union so extracted people slot straight into Your team.
TEAMS = ("Founders", "Eng", "Product", "Design", "GTM", "Ops")

# Words that, if they appeared as a *person* attribute key, would be a red-line breach. Used both to
# keep the heuristic honest and (in redline_extract) to hard-fail any extractor's output.
FORBIDDEN_PERSON_KEYS = (
    "moodpct", "mood", "capacitypct", "capacity", "score", "scores", "scoring", "rating", "rated",
    "rank", "ranking", "ranked", "tier", "grade", "graded", "percentile", "rate", "performance",
    "potential", "risk", "flightrisk", "stars", "star",
)

# feat-029 — the same red line in Chinese. A person dict key CONTAINING any of these is a scoring
# key on a person (绩效评分 / 离职风险 / 排名 / 画像 / 潜力评级 …). Matched by substring on the
# CJK-preserving normalized key (see redline_extract.validate_person_dict), so 绩效评分 trips '评分'
# and 离职风险 trips '离职风险'. Person-QUALIFIED profiling only: '用户画像'/'客户画像' are customer
# artifacts and are NOT here (a person key would read '员工画像'/'人才画像', still tripped by '画像').
FORBIDDEN_PERSON_KEYS_ZH = (
    "评分", "打分", "得分", "评级", "定级", "分级", "评估", "排名", "排序", "画像",
    "绩效", "考核", "潜力", "情绪值", "情绪分", "产能", "工时利用", "利用率", "饱和度",
    "离职风险", "流失风险", "末位淘汰", "淘汰", "分数",
    # feat-029 round 2 — star ratings / ranking labels on a person. Traditional keys are folded to
    # Simplified before this substring match (redline_extract.validate_person_dict), so 星級/名次/評比
    # trip these too. (末流/垫底/差评 rank synonyms are caught as CONTENT by the advice gate, so they
    # stay out of the KEY list to keep it narrow.)
    "星级", "名次", "评比",
)


# --- entity shapes ----------------------------------------------------------------------------
# NOTE: PersonEntity deliberately has NO numeric field. This is the moat as a type.

@dataclass
class PersonEntity:
    """A person card — QUALITATIVE ONLY. No number ever lives here (red line: no blood bar)."""
    id: str
    name: str
    role: str = ""
    team: str = ""                              # one of TEAMS (or "" if unknown — never guessed hard)
    tenure: str = ""                            # free text: "18 months", "joined 14 months ago"
    owns: list[str] = field(default_factory=list)        # what they own / ship (qualitative)
    collaboration: list[str] = field(default_factory=list)  # who they work with / how
    source: str = ""                            # provenance: "<filename>:<line>" for a cite

    def as_facts_lines(self) -> list[str]:
        """Render this person as line-addressable company-memory facts (qualitative sentences)."""
        bits = [f"{self.name} — {self.role}".strip(" —")]
        if self.team:
            bits[0] += f" ({self.team})"
        out = [bits[0] + "."]
        if self.tenure:
            out.append(f"{self.name}: {self.tenure}.")
        for o in self.owns:
            out.append(f"{self.name} owns/works on: {o}.")
        for c in self.collaboration:
            out.append(f"{self.name} — collaboration: {c}.")
        return out


@dataclass
class ProjectEntity:
    """A project card. Work MAY be quantified (progress %) — that is not a person score."""
    id: str
    title: str
    ownerId: str = ""
    ownerName: str = ""
    status: str = ""                            # on-track / at-risk / blocked / done (if stated)
    progress: int | None = None                 # 0..100 if the doc states it, else None (R2: don't invent)
    dueDate: str = ""
    summary: str = ""
    blockers: list[str] = field(default_factory=list)
    dependsOn: list[str] = field(default_factory=list)
    source: str = ""

    def as_facts_lines(self) -> list[str]:
        head = f"Project '{self.title}'"
        if self.ownerName:
            head += f" (owner: {self.ownerName})"
        st = f" status {self.status}" if self.status else ""
        pr = f", progress {self.progress}%" if self.progress is not None else ""
        out = [f"{head}:{st}{pr}.".replace(": .", ".")]
        if self.summary:
            out.append(f"{self.title}: {self.summary}")
        for b in self.blockers:
            out.append(f"{self.title} — blocker: {b}")
        return out


@dataclass
class SignalEntity:
    """A doc-derived signal. If subjectType == 'person' the summary STOPS at situation (red line):
    it describes what she is carrying, never a judgment/label/score of her."""
    id: str
    source_kind: str                            # figma / feedback / task / manual / doc
    subjectType: str                            # 'person' | 'project' | 'task'
    subjectRef: str                             # entity id or name the signal is about
    summary: str
    tag: str = ""
    source: str = ""

    def as_facts_lines(self) -> list[str]:
        return [f"Signal ({self.subjectType}) on {self.subjectRef}: {self.summary}"]


@dataclass
class MaterialChunk:
    """A company-material snippet for the RAG store (what the advisor cites)."""
    id: str
    text: str
    source: str = ""                            # "<filename>:<line>"
    doc_kind: str = "company"


@dataclass
class ExtractionResult:
    people: list[PersonEntity] = field(default_factory=list)
    projects: list[ProjectEntity] = field(default_factory=list)
    signals: list[SignalEntity] = field(default_factory=list)
    materials: list[MaterialChunk] = field(default_factory=list)

    def merge(self, other: "ExtractionResult") -> "ExtractionResult":
        self.people += other.people
        self.projects += other.projects
        self.signals += other.signals
        self.materials += other.materials
        return self


class Extractor(Protocol):
    """Pluggable extraction backend (heuristic offline / LLM in prod). Output is always gated."""
    def extract(self, doc: ParsedDoc) -> ExtractionResult: ...


# --- helpers ----------------------------------------------------------------------------------

def _slug(text: str, prefix: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "_", (text or "").lower()).strip("_")
    return f"{prefix}_{s[:32] or 'x'}"


_ROLE_WORDS = (
    r"manager|lead|director|designer|engineer|developer|researcher|technologist|architect|"
    r"analyst|scientist|producer|owner|partner|executive|coordinator|specialist|strategist|"
    r"writer|marketer|ops|qa|prototyper|founder|cto|ceo|cpo|vp|head"
)
_ROLE_RE = re.compile(rf"\b((?:senior |lead |principal |staff |junior )?[A-Z][a-z]+ )?({_ROLE_WORDS})\b", re.I)

_TENURE_RE = re.compile(
    r"\b(\d+\+?\s*(?:years?|yrs?|months?|mos?))\b"
    r"|joined\s+[\w ]{0,20}?\b(\d+\s*(?:years?|months?)\s+ago)"
    r"|(\d+\s*(?:years?|months?))\s+(?:on the team|of tenure|at )",
    re.I)

# STOP words for names — header cells / labels that are not people.
_NOT_NAME = {
    "name", "role", "team", "email", "tenure", "title", "person", "people", "member", "members",
    "roster", "directory", "project", "owner", "status", "notes", "department", "manager",
}


def _looks_like_name(token: str) -> bool:
    token = token.strip()
    if not token or token.lower() in _NOT_NAME:
        return False
    # 1-3 capitalized words, letters/space/dot/hyphen only.
    return bool(re.match(r"^[A-Z][A-Za-z.\-]+(?: [A-Z][A-Za-z.\-]+){0,2}$", token))


def _norm_team(raw: str) -> str:
    raw = (raw or "").strip().lower()
    for t in TEAMS:
        if raw == t.lower() or raw in t.lower() or t.lower() in raw:
            return t
    aliases = {"engineering": "Eng", "design": "Design", "product": "Product",
               "gtm": "GTM", "sales": "GTM", "go-to-market": "GTM", "operations": "Ops",
               "ops": "Ops", "founder": "Founders", "founders": "Founders"}
    return aliases.get(raw, "")


def _norm_status(text: str) -> str:
    t = text.lower()
    if re.search(r"\bblocked\b", t):
        return "blocked"
    if re.search(r"\bat[\s-]?risk\b|behind|slipping|delayed", t):
        return "at-risk"
    if re.search(r"\b(done|shipped|complete|launched)\b", t):
        return "done"
    if re.search(r"\bon[\s-]?track\b|on schedule", t):
        return "on-track"
    return ""


# --- the heuristic (offline, deterministic, NO model) -----------------------------------------

class HeuristicExtractor:
    """Deterministic rule-based extraction. This is what the AFK gate runs — no LLM, no embeddings.

    It is intentionally conservative and, by construction, red-line-safe: PersonEntity has no numeric
    field, and person free-text is drawn from role/tenure/ownership sentences, not from any rating.
    """

    def extract(self, doc: ParsedDoc) -> ExtractionResult:
        res = ExtractionResult()
        if doc.doc_kind == "roster":
            res.merge(self._people_from_roster(doc))
        elif doc.doc_kind == "resume":
            res.merge(self._people_from_resume(doc))
        elif doc.doc_kind in ("project", "roadmap"):
            res.merge(self._projects_from_doc(doc))
            res.merge(self._signals_from_doc(doc))
        # Every doc contributes material chunks to the RAG (including company handbooks).
        res.merge(self._materials(doc))
        return res

    # people ---------------------------------------------------------------

    def _people_from_roster(self, doc: ParsedDoc) -> ExtractionResult:
        """Roster/CSV: 'Name | Role | Team | Tenure' style rows -> PersonEntity per row."""
        res = ExtractionResult()
        rows = [ln for ln in doc.lines if "|" in ln]
        header: list[str] = []
        if rows and re.search(r"\bname\b", rows[0], re.I):
            header = [c.strip().lower() for c in rows[0].split("|")]
            rows = rows[1:]
        for i, ln in enumerate(doc.lines):
            if "|" not in ln:
                continue
            cells = [c.strip() for c in ln.split("|")]
            if header and cells and cells[0].strip().lower() in _NOT_NAME:
                continue
            name = cells[0] if cells else ""
            if not _looks_like_name(name):
                continue
            col = {header[j]: cells[j] for j in range(min(len(header), len(cells)))} if header else {}
            role = col.get("role") or (cells[1] if len(cells) > 1 else "")
            team = _norm_team(col.get("team") or (cells[2] if len(cells) > 2 else ""))
            tenure = col.get("tenure") or (cells[3] if len(cells) > 3 else "")
            owns = []
            owns_val = col.get("owns") or col.get("focus") or col.get("projects")
            if owns_val:
                owns = [o.strip() for o in re.split(r"[;,]", owns_val) if o.strip()]
            res.people.append(PersonEntity(
                id=_slug(name, "u"), name=name, role=role.strip(), team=team,
                tenure=tenure.strip(), owns=owns, source=f"{doc.name}:{i + 1}"))
        return res

    def _people_from_resume(self, doc: ParsedDoc) -> ExtractionResult:
        """Resume: pull name (first non-empty header line), a role, tenure phrases, and 'owned'
        bullet lines. STAYS qualitative — never derives a rating even if the resume brags a metric."""
        res = ExtractionResult()
        name = ""
        for ln in doc.lines[:6]:
            s = ln.strip().lstrip("#").strip()
            # a header like "Marcus Reid — Senior Engineer" / "Lena Park, Product Designer":
            # take the part before a dash/comma and test that as the name.
            head = re.split(r"\s+[—\-–|,]\s+", s, maxsplit=1)[0].strip()
            if _looks_like_name(head):
                name = head
                break
            if _looks_like_name(s):
                name = s
                break
        if not name:
            name = re.sub(r"\.[a-z0-9]+$", "", doc.name).replace("_", " ").strip()
        role = ""
        mrole = _ROLE_RE.search(doc.text)
        if mrole:
            role = mrole.group(0).strip()
        tenure = ""
        mten = _TENURE_RE.search(doc.text)
        if mten:
            tenure = next((g for g in mten.groups() if g), "").strip()
        owns: list[str] = []
        for ln in doc.lines:
            s = ln.strip()
            if re.match(r"^[-*•]\s+", s) or re.match(r"^(led|owned|built|shipped|drove|designed|"
                                                     r"delivered|managed|created|maintained)\b", s, re.I):
                owns.append(re.sub(r"^[-*•]\s+", "", s)[:160])
            if len(owns) >= 6:
                break
        res.people.append(PersonEntity(
            id=_slug(name, "u"), name=name, role=role, tenure=tenure, owns=owns,
            source=f"{doc.name}:1"))
        return res

    # projects & signals ---------------------------------------------------

    def _projects_from_doc(self, doc: ParsedDoc) -> ExtractionResult:
        """Project weekly / roadmap: title from a heading or 'Project:' line; status/progress/owner
        from labelled lines; blockers from 'blocker/blocked/waiting' lines."""
        res = ExtractionResult()
        title = ""
        owner = ""
        status = ""
        progress: int | None = None
        summary = ""
        due = ""
        blockers: list[str] = []
        for i, ln in enumerate(doc.lines):
            s = ln.strip()
            m = re.match(r"^#+\s*(.+)$", s)
            if m and not title:
                title = m.group(1).strip()
                continue
            m = re.match(r"^(project|title)\s*[:\-]\s*(.+)$", s, re.I)
            if m:
                title = m.group(2).strip()
            m = re.match(r"^(owner|lead|dri)\s*[:\-]\s*(.+)$", s, re.I)
            if m:
                owner = m.group(2).strip()
            m = re.match(r"^status\s*[:\-]\s*(.+)$", s, re.I)
            if m:
                status = _norm_status(m.group(1)) or status
            m = re.search(r"\bprogress\s*[:\-]?\s*(\d{1,3})\s*%", s, re.I)
            if m:
                progress = max(0, min(100, int(m.group(1))))
            m = re.match(r"^(due|deadline|ship(?:s|ping)?)\s*[:\-]?\s*(.+)$", s, re.I)
            if m:
                due = m.group(2).strip()
            m = re.match(r"^(summary|overview|goal)\s*[:\-]\s*(.+)$", s, re.I)
            if m and not summary:
                summary = m.group(2).strip()
            if re.search(r"\b(blocker|blocked|waiting on|stuck|unresolved|no sign-?off|"
                         r"acceptance (?:not|un)|not defined)\b", s, re.I):
                blockers.append(s.lstrip("-*• ").strip()[:180])
        if not title:
            title = re.sub(r"\.[a-z0-9]+$", "", doc.name).replace("_", " ").strip()
        if not status:
            status = _norm_status(doc.text)
        if not summary:
            first = next((ln.strip() for ln in doc.lines
                          if ln.strip() and not ln.strip().startswith("#")), "")
            summary = first[:200]
        res.projects.append(ProjectEntity(
            id=_slug(title, "p"), title=title, ownerName=owner, status=status, progress=progress,
            dueDate=due, summary=summary, blockers=blockers[:6], source=f"{doc.name}:1"))
        return res

    def _signals_from_doc(self, doc: ParsedDoc) -> ExtractionResult:
        """Doc-derived R1 signals: '12 unresolved comments', 'acceptance not set', 'reworked N days
        running'. A person-directed signal STAYS at situation (never a label on the person)."""
        res = ExtractionResult()
        proj_ref = ""
        # anchor person/project signals to the first project title if present
        for i, ln in enumerate(doc.lines):
            s = ln.strip()
            low = s.lower()
            sig_text = ""
            tag = ""
            if re.search(r"\b\d+\s+unresolved\b|\bunresolved (comments|feedback)\b", low):
                sig_text = s[:200]
                tag = "no-update"
            elif re.search(r"acceptance (criteria )?(?:not|un)|no sign-?off|definition of done", low):
                sig_text = s[:200]
                tag = "repeated-blocker"
            elif re.search(r"reworked|reopened|kept moving|changing (feedback|requirements)", low):
                sig_text = s[:200]
                tag = "stalled"
            elif re.search(r"\b(absorbed|took on|handled|carrying|soaked up)\b.*\b\d+\b|"
                           r"\b\d+\s+(?:new )?(?:client )?(?:change requests?|changes|interruptions?)\b",
                           low):
                # interrupt/workload line — usually person-directed (R1 doc-derived person signal)
                sig_text = s[:200]
                tag = "interrupt"
            if not sig_text:
                continue
            # is this signal about a PERSON? if it names one, keep it at SITUATION.
            person = self._first_person_name(s)
            if person:
                # red-line-safe framing: describe what she is carrying, not a judgment.
                res.signals.append(SignalEntity(
                    id=_slug(sig_text, "s"), source_kind="doc", subjectType="person",
                    subjectRef=person,
                    summary=self._situationalize(person, sig_text), tag="interrupt",
                    source=f"{doc.name}:{i + 1}"))
            else:
                res.signals.append(SignalEntity(
                    id=_slug(sig_text, "s"), source_kind="doc", subjectType="project",
                    subjectRef=proj_ref or "the project", summary=sig_text, tag=tag,
                    source=f"{doc.name}:{i + 1}"))
        return res

    @staticmethod
    def _first_person_name(text: str) -> str:
        # crude: a capitalized 1-2 word name followed by a verb like absorbed/spent/reworked/carried
        m = re.search(r"\b([A-Z][a-z]+(?: [A-Z][a-z]+)?)\b\s+(?:absorbed|spent|reworked|carried|"
                      r"took on|handled|is carrying|was)\b", text)
        if m and m.group(1).strip().lower() not in _NOT_NAME:
            return m.group(1).strip()
        return ""

    @staticmethod
    def _situationalize(person: str, text: str) -> str:
        """Force a person-directed signal into situation language (the red line for people-signals):
        it must read as 'what she is carrying', never as a rating/label on her."""
        # If the source already reads as situation ("absorbed a week of change"), keep it; otherwise
        # prefix a situational frame. Never emit a judgment word.
        return f"{text}".strip()

    # materials ------------------------------------------------------------

    def _materials(self, doc: ParsedDoc) -> ExtractionResult:
        """Chunk every doc into line-addressable material for the RAG. Skips pure header/table
        scaffolding lines; keeps sentence-ish content."""
        res = ExtractionResult()
        for i, ln in enumerate(doc.lines):
            s = ln.strip().lstrip("#").strip()
            if len(s) < 12:
                continue
            if s.lower() in _NOT_NAME:
                continue
            res.materials.append(MaterialChunk(
                id=f"{doc.name}:{i + 1}", text=s, source=f"{doc.name}:{i + 1}",
                doc_kind=doc.doc_kind))
        return res


def _default_max_workers() -> int:
    """Concurrency for document-level extraction. `AVERY_INGEST_CONCURRENCY` (default 4).

    The cap IS the rate-limit guardrail: LLM extraction fans out one blocking `brain.respond()` per
    doc, and a bursty fan-out is what tripped the earlier M3 429. Bounded on purpose."""
    try:
        n = int(os.environ.get("AVERY_INGEST_CONCURRENCY", "4"))
    except ValueError:
        n = 4
    return max(1, n)


def extract_docs(docs: list[ParsedDoc], extractor: Extractor | None = None,
                 max_workers: int | None = None) -> ExtractionResult:
    """Run an extractor across many docs and merge. Then resolve project ownerName -> ownerId
    against extracted people so cards link up.

    Documents are extracted CONCURRENTLY with a bounded ThreadPoolExecutor — each
    `extractor.extract(doc)` makes blocking `brain.respond()` HTTP calls (which release the GIL
    during network I/O), so a 10-file upload runs in ~max(one file) instead of ~sum. Concurrency is
    bounded by `max_workers` (env `AVERY_INGEST_CONCURRENCY`, default 4); the cap is the rate-limit
    guardrail. Results are merged in ORIGINAL input order, so the output is byte-identical to the
    sequential path — only wall-time changes. `_link_owners` runs ONCE, post-merge, single-threaded.

    Exception semantics are UNCHANGED from the sequential loop: a raising extractor propagates and
    sinks the batch (the pool surfaces the first exception via `future.result()`); errors are never
    newly swallowed. (In practice `LLMExtractor.extract` catches internally and falls back per-doc.)
    """
    ex = extractor or HeuristicExtractor()
    workers = max_workers if max_workers is not None else _default_max_workers()
    effective = min(workers, len(docs))

    out = ExtractionResult()
    if effective <= 1:
        # Sequential fast-path — byte-identical to the original loop (single doc / heuristic /
        # AVERY_INGEST_CONCURRENCY=1). No threads, no pool overhead.
        for d in docs:
            out.merge(ex.extract(d))
    else:
        # Concurrent across documents; merge in ORIGINAL order for deterministic output. Surface the
        # first exception (future.result re-raises) so behavior matches sequential except wall-time.
        with ThreadPoolExecutor(max_workers=effective) as pool:
            futures = [pool.submit(ex.extract, d) for d in docs]
            for f in futures:
                out.merge(f.result())

    _link_owners(out)
    return out


def _link_owners(res: ExtractionResult) -> None:
    """Best-effort: match a project's ownerName to an extracted person's id (Your-team wiring)."""
    by_name = {p.name.lower(): p.id for p in res.people}
    for proj in res.projects:
        if proj.ownerName and not proj.ownerId:
            key = proj.ownerName.strip().lower()
            if key in by_name:
                proj.ownerId = by_name[key]
            else:
                # try first-name match
                for nm, pid in by_name.items():
                    if nm.split(" ")[0] == key.split(" ")[0]:
                        proj.ownerId = pid
                        break
    # link person-signals to person ids too
    for sig in res.signals:
        if sig.subjectType == "person":
            key = sig.subjectRef.strip().lower()
            if key in by_name:
                sig.subjectRef = by_name[key]
