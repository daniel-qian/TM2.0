"""The `company_context_id` <-> CompanyContext seam (feat-015 honor point).

`service/live_input.py::LiveSituation.company_context_id` is a stub: it threads an id through the
case file but nothing resolves it. THIS makes it real. Ingestion produces a `CompanyContext` and
registers it under an id; the advisor path resolves that id back to:

  * a `memory_dir` (materialized `facts.md` + `notes.md`) so the loop's EXISTING `avery.memory.recall`
    retrieves real company facts — the loop runs UNCHANGED (same seam `live_input` already uses), and
  * a `RetrievalStore` (keyword offline / vector real) for direct RAG queries, and
  * the extracted Your-team structures (people / project cards / briefing) for the frontend.

Why materialize facts.md rather than change recall(): the loop's memory + cite gate are already the
audited path (facts.md:<line> is what a cite() resolves to). Writing the extracted, red-line-clean,
line-addressable person/project/material facts INTO that file means every downstream gate (cite,
red line, 8-field projection) applies to ingested data with zero engine change. It is the honest
minimum: the advisor cites real lines that came from the manager's own uploads.
"""
from __future__ import annotations

import os
import tempfile
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

from .extract import ExtractionResult
from .store import RetrievalStore, RetrievalHit, KeywordStore


@dataclass
class SourceDocument:
    """feat-032 — a persisted RAW upload: the original bytes + metadata, kept in the per-company
    file space so a manager can look back at what Avery's memory is built on (User Story 4).

    The bytes are UNTRUSTED content: stored and served for download, NEVER interpreted as
    instructions (readiness §2-I injection surface — this layer only stores/lists, it does not
    follow anything inside a file). `content` is held in memory by the in-memory registry and left
    None by the Postgres registry's metadata read (get()); the bytea is pulled on demand by the
    download seam (`source_document_bytes`). `storage_ref` is the feat-035 object-store seam
    (PRD: 'may include an object-store reference') — v1 keeps bytes inline in avery.source_documents.
    """
    filename: str
    source_key: str = ""                   # feat-032 P1: the DISAMBIGUATED per-document join key
                                           # (== the parsed doc's name == a material's '<key>:<line>'
                                           # source prefix). Distinct even when two uploads share a
                                           # `filename`, so n_chunks attributes per DOCUMENT, not per
                                           # display name. Empty -> fall back to `filename` (pre-032).
    mime: str = "application/octet-stream"
    size_bytes: int = 0
    doc_kind: str = "company"
    status: str = "ingested"               # feat-032 P2: 'ingested' | 'failed' (unparseable) |
                                           # 'empty' (parsed, produced no material). The manifest
                                           # surfaces it so a failed file is not disguised as valid.
    uploaded_at: str = ""                  # ISO8601 UTC; set at ingest, or read back from the DB
    content: bytes | None = None           # raw upload bytes (in-memory) / None (pg metadata read)
    storage_ref: str = ""                  # feat-035 seam: object-store pointer; inline bytea in v1


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass
class CompanyNote:
    """feat-033 — one agent-WRITTEN observation in the company's persistent, user-visible notebook.

    `text` is Avery's observation about the company (work-focused, never a person score — the write
    gate enforces that); `source_excerpt` is the ~60-char lead of the manager's question that
    triggered it (the notes surface shows 'From your question about <excerpt>'). Free text — the red
    line is a CONTENT scan run BEFORE this ever exists (see `gate_note_red_line`)."""
    id: str
    created_at: str          # ISO8601 UTC
    text: str
    source_excerpt: str = ""


def new_note_id() -> str:
    return "note_" + uuid.uuid4().hex[:16]


def gate_note_red_line(text: str, source_excerpt: str = "") -> None:
    """🔴 The WRITE-SIDE red line for Avery's self-written notes — the moat's most load-bearing new
    face. Reuses the UNCHANGED advisor gate `avery.redline.validate` (EN+ZH); it does NOT add or
    weaken any red-line mechanism. A note that scores / ranks / profiles a PERSON (in the observation
    OR in the echoed question excerpt shown on the surface) raises ValueError, so NOTHING is stored —
    the self-written memory can never be a back door around 'no numbers on a person'.

    Both registries call this before persisting, and the service's post-advise hook re-checks
    independently (belt-and-suspenders, like feat-030's storage door).

    feat-033 (adversarial closure) — the observation and the echoed excerpt are validated
    SEPARATELY, never concatenated. Concatenating let a negation cue in one field bleed across the
    boundary and mask a real person-score in the other (e.g. an advice read ending '…never on the
    person' would suppress a scoring excerpt like '李雷:9分,排名第一'). Each field is displayed on its
    own, so each must independently pass — strictly stronger than the joined check.

    feat-033 (policy pivot, 2026-07-13) — when the operator has EXPLICITLY unblocked person scoring
    (`AVERY_ALLOW_PERSON_SCORING`, see avery.scoring_policy), the person-scoring raise is SKIPPED so a
    scoring note lands (both the in-memory and the Postgres append_note funnel through here, so one
    switch covers both). Default OFF keeps the moat: the detector (`avery.redline`) is untouched —
    only THIS enforcement decision consults the switch. The NUL / 0x00 storage-safety check is NOT a
    red-line policy and ALWAYS runs, switch or no switch."""
    from avery import redline   # core, offline, stdlib-only — safe for the offline path
    from avery.scoring_policy import person_scoring_allowed
    if not person_scoring_allowed():
        for part in (text, source_excerpt):
            if not part:
                continue
            rl = redline.validate(part)
            if not rl.passed:
                raise ValueError(f"red line: refusing to persist a scoring note ({rl.summary()})")
    if "\x00" in (text or "") or "\x00" in (source_excerpt or ""):
        raise ValueError("unsupported control character (NUL / 0x00) in a note — cannot be stored")


@dataclass
class CompanyContext:
    """The resolved company context an advisor retrieves against, keyed by `context_id`."""
    context_id: str
    extraction: ExtractionResult
    store: RetrievalStore
    memory_dir: Path                       # holds materialized facts.md / notes.md
    name: str = "company"
    source_files: list[str] = field(default_factory=list)
    source_documents: list[SourceDocument] = field(default_factory=list)  # feat-032 file space
    owner_token: str = ""                   # feat-038 tenant isolation: the unguessable holder
                                            # credential set at /ingest. A read path validates a
                                            # header token against this; empty == pre-038 / no auth
                                            # required (v1 back-compat — new /ingest always sets it).
                                            # NEVER travels in a URL (header only); the context_id
                                            # in the URL is not sufficient to read the data.

    # --- retrieval surface (what the advisor uses) --------------------------------------------

    def recall(self, query: str, limit: int = 8) -> list[RetrievalHit]:
        """RAG query over ingested material (keyword offline / vector real)."""
        return self.store.query(query, limit=limit)

    # --- Your-team structures (what the frontend renders) -------------------------------------

    def team_cards(self) -> list[dict]:
        """People cards for 'Your team' — QUALITATIVE ONLY. Note: NO moodPct / capacityPct keys are
        ever emitted (red line: live person cards have no blood bar). feat-017 renders these."""
        cards = []
        for p in self.extraction.people:
            card = {"id": p.id, "name": p.name, "role": p.role}
            if p.team:
                card["team"] = p.team
            if p.tenure:
                card["tenure"] = p.tenure
            if p.owns:
                card["owns"] = p.owns
            if p.collaboration:
                card["collaboration"] = p.collaboration
            # DELIBERATELY absent: moodPct, capacityPct, any score/rank/tier.
            cards.append(card)
        return cards

    def project_cards(self) -> list[dict]:
        """Project cards for 'Your team'. Work may be quantified (progress) when the doc stated it;
        risk 4-dims / reportedStatus are left absent (lite lacks the signal — R2 don't invent)."""
        cards = []
        for pr in self.extraction.projects:
            card = {"id": pr.id, "title": pr.title}
            if pr.ownerId:
                card["ownerId"] = pr.ownerId
            if pr.ownerName:
                card["ownerName"] = pr.ownerName
            if pr.status:
                card["status"] = pr.status
            if pr.progress is not None:
                card["progress"] = pr.progress
            if pr.dueDate:
                card["dueDate"] = pr.dueDate
            if pr.summary:
                card["summary"] = pr.summary
            if pr.blockers:
                card["blockers"] = pr.blockers
            cards.append(card)
        return cards

    def signal_cards(self) -> list[dict]:
        """Doc-derived signals. Person-directed ones stay at situation (gated upstream)."""
        return [{"id": s.id, "source": s.source_kind, "subjectType": s.subjectType,
                 "subjectId": s.subjectRef, "summary": s.summary, "tag": s.tag}
                for s in self.extraction.signals]

    def decision_cards(self, as_of=None) -> list[dict]:
        """feat-056 决策定级：给每个项目算一个 高风险/需确认/可推进，按严重度排好序。

        前端 feat-057 的「今天要决策的」直接吃这个列表（顺序即展示顺序）。等级由
        `avery/decision_rules.py` 的规则表算出——确定、可复现、可当场把口径表给客户看
        （`eval-harness/decision_grading_rules.md`）。Avery 的一句人话理由是在这之上的
        叠加层（`decision_grading.apply_review`），只许上调、不许下调；本方法产出的是
        纯规则版，reason_source == "rule"。

        `as_of` 不传则取今天——时间类规则（到期日）以它为准，显式传入即可复现。
        """
        from ..decision_grading import grade_projects
        return [d.to_dict() for d in grade_projects(self.project_cards(), self.signal_cards(),
                                                    as_of=as_of)]

    def briefing(self, as_of=None) -> dict:
        """A calm, HONEST 'organization weather' briefing. Counts are real (people/projects); it
        emits NO invented aggregate health score (R2: real-or-nothing).

        🔴 The risk judgement is NOT this method's own. It is `avery.decision_grading` — the SAME
        rule table (`avery/decision_rules.py`, human-readable twin `decision_grading_rules.md`) that
        produces `decision_cards()`. Before 2026-07-18 this method carried a private, weaker rule
        (`status in ("at-risk", "blocked")`) that read NEITHER blockers NOR signals, so a project
        self-reporting on-track — or stating no status at all — while carrying an unresolved blocker
        (i.e. the ENTIRE premise of the 「多看一眼」 surface, and a case the rule table already
        models explicitly under its 「自报『正常』但挂着未解阻塞」 entry) fell straight through into
        'No risk signals surfaced from the documents.' — a sentence printed directly beneath
        'Everything below is drawn from your uploads — nothing invented.', while the very same
        payload's decision_cards said 需确认 and listed the blocker. Two rule sets = the surface
        contradicting itself one key apart. There is now exactly one.

        Signals get counted too, and separately from the graded projects. Every SignalEntity the
        extractor emits is a risk-shaped reading by construction (the four families: unresolved /
        no sign-off / rework / interrupt), so a non-empty `signal_cards()` and the sentence 'no risk
        signals' cannot both be true. Attribution of a signal to a project is a KNOWN blind spot of
        `_match_signals` (documented there: it would rather miss than blanket-escalate) — the loose
        ones therefore reach nobody's decision card, which is exactly why the briefing must not
        swallow them.

        🔴 De-duplication is by SIGNAL IDENTITY, via the SAME `_match_signals` the grader used —
        never by comparing rule-evidence strings. The first cut of this method did the latter (a
        signal counted as accounted only when its summary text appeared VERBATIM in some flagged
        project's rule evidence) and that read the wrong thing: rule evidence only contains signals
        that hit a KEYWORD FAMILY, so a signal explicitly naming an already-flagged project — same
        project, already on a decision card, already surfaced — landed in the evidence-free case and
        was added AGAIN as if it were a separate concern. Measured on a real POST /ingest of a
        10-line weekly: 1 project, 1 decision card, briefing said 'need a look = 3'. The ZH shell
        (the production default, see src/shared/briefing.ts) renders that count as 「其中 N 个项目
        值得多看一眼」 — so the surface named three projects while one project card was on screen,
        directly beneath 「没有一处是编的」. Same sentence, same spot, same lie as the original bug.

        `look_kind` / `look_projects` / `look_signals` ship the count's SHAPE, not just its size, so
        a localized surface can pick a truthful classifier instead of hard-coding 「个项目」:
          · "projects" — every counted thing IS a graded project. `look_signals == 0`, and the total
            can never exceed the project count. 「N 个项目」 is safe here and ONLY here.
          · "items"    — part of the count is a signal that reached no decision card. Calling those
            projects would invent projects (worst case: zero projects, two signals, 「2 个项目」).
          · "none"     — nothing flagged; the calm sentence is the honest one.

        `as_of` threads through to the date-sensitive rules (due dates) — pass it to reproduce a
        briefing exactly; omitted means today, same convention as `decision_cards()`.
        """
        from ..decision_grading import grade_projects
        from ..decision_rules import CAN_PROCEED

        n_people = len(self.extraction.people)
        n_proj = len(self.extraction.projects)

        signals = self.signal_cards()
        projects = self.project_cards()
        decisions = grade_projects(projects, signals, as_of=as_of)
        flagged = [d for d in decisions if d.grade != CAN_PROCEED]
        loose_signals = self._signals_no_decision_covers(projects, signals, flagged)
        n_flagged, n_loose = len(flagged), len(loose_signals)
        n_look = n_flagged + n_loose
        look_kind = "none" if not n_look else ("items" if n_loose else "projects")

        metrics = [{"label": "people", "value": str(n_people)},
                   {"label": "active projects", "value": str(n_proj)}]
        if n_look:
            # Label kept VERBATIM ('need a look'): src/shared/briefing.ts maps the ZH surface off
            # this exact string, and its calm/risk branch is driven by whether this entry exists —
            # so emitting it is what keeps the Chinese subhead from denying what the metrics show.
            metrics.append({"label": "need a look", "value": str(n_look)})
        # feat-032 P2: reconcile with the file manifest. source_files counts only the PARSED docs;
        # source_documents counts everything UPLOADED (incl. parse-failures the manifest still shows).
        # Say "N of M" when they differ so the headline never claims fewer files than the manifest
        # lists. (No source_documents = pre-032 path -> just N.)
        n_ingested = len(self.source_files)
        n_uploaded = len(self.source_documents) or n_ingested
        files_phrase = f"{n_ingested} of {n_uploaded}" if n_uploaded != n_ingested else str(n_ingested)
        headline = f"Ingested {files_phrase} file(s): {n_people} people, {n_proj} projects."
        if look_kind == "none":
            tail = "No risk signals surfaced from the documents."
        elif look_kind == "items":
            # 'item(s)', not 'project(s)': part of this count is a signal that reached no decision
            # card, and calling it a project would be a small invention of exactly the kind this
            # method exists to stop. The all-projects case keeps the stronger word.
            tail = f"{n_look} item(s) worth a closer look."
        else:
            tail = f"{n_look} project(s) worth a closer look."
        subhead = "Everything below is drawn from your uploads — nothing invented. " + tail
        return {"tone": "alert" if n_look else "calm", "headline": headline, "subhead": subhead,
                "metrics": metrics, "look_kind": look_kind,
                "look_projects": n_flagged, "look_signals": n_loose}

    @staticmethod
    def _signal_identity(signal: dict) -> str:
        """A signal's identity for counting. `id` when the extractor gave one (it always does on the
        `signal_cards()` path); the summary text only as a defensive fallback, so a hand-built or
        legacy payload without ids still de-duplicates instead of inflating the count."""
        sid = str(signal.get("id") or "").strip()
        return sid if sid else "summary:" + str(signal.get("summary") or "").strip()

    @classmethod
    def _signals_no_decision_covers(cls, projects: list[dict], signals: list[dict],
                                    flagged) -> list[dict]:
        """Signals that no already-flagged project's decision card speaks for.

        A signal is covered when EITHER test says the manager is already being shown it. Both are
        needed; each alone under-counts one real case, and under-counting here means saying one
        project is several:

        ① ATTACHED — `decision_grading._match_signals` (the very function the grader ran, not a
           re-derivation) attributes the signal to a project whose card came back flagged. Delegating
           matters: two independently written attribution rules is the bug class this whole method
           exists to close — a private risk rule beside the rule table is what made the briefing deny
           its own payload — and a second one hiding in the de-duplication step is that same mistake
           one layer down. Test ② misses this case whenever the signal's wording hits no keyword
           family, because then it never becomes rule evidence even though its project is flagged.

        ② QUOTED — the signal's text appears VERBATIM in a flagged card's rule evidence, i.e. that
           exact sentence is already printed on screen under that project. Test ① misses this case
           routinely: the heuristic extractor stamps every doc signal with `subjectRef="the project"`
           (a literal, never a real reference — `extract.py::_signals_from_doc`), so doc signals
           attach to nothing, and a line that is simultaneously the project's blocker and its own
           signal would be counted twice.

        Everything else is returned. Those reach no decision card — the documented `_match_signals`
        blind spot, or a project the grader cleared — so dropping them would make the surface go
        silent about a risk-shaped reading out of the customer's own file. Empty-summary signals
        carry nothing to show a manager and are skipped.
        """
        from ..decision_grading import _match_signals

        flagged_subjects = {d.subject_id for d in flagged}
        covered: set[str] = set()
        for project in projects:
            # Mirrors `_Subject.subject_id` (id, else title) so the two sides key alike.
            subject_id = (str(project.get("id") or "").strip()
                          or str(project.get("title") or "").strip())
            if subject_id not in flagged_subjects:
                continue
            for signal in _match_signals(project, signals):
                covered.add(cls._signal_identity(signal))
        quoted = {ev for d in flagged for hit in d.matched_rules for ev in hit.evidence}

        out: list[dict] = []
        seen: set[str] = set()
        for signal in signals:
            summary = str(signal.get("summary") or "").strip()
            if not summary:
                continue
            key = cls._signal_identity(signal)
            if key in covered or summary in quoted or key in seen:
                continue
            seen.add(key)
            out.append(signal)
        return out

    # --- feat-032 file space (per-company uploaded-file manifest) ------------------------------

    def _chunks_per_file(self) -> dict[str, int]:
        """How many material chunks each parsed document contributed, keyed by a chunk's
        `<key>:<line>` source PREFIX (== the parsed doc's name == a SourceDocument.source_key). The
        prefix is per-DOCUMENT, so two uploads sharing a display `filename` do not merge their counts
        (feat-032 P1). Same cite seam the advisor uses."""
        counts: dict[str, int] = {}
        for m in self.extraction.materials:
            src = m.source or ""
            key = src.rsplit(":", 1)[0] if ":" in src else src
            if key:
                counts[key] = counts.get(key, 0) + 1
        return counts

    def file_cards(self) -> list[dict]:
        """The per-file manifest the 'your files' view renders — METADATA ONLY (no bytes): filename,
        size, mime, doc_kind, status, uploaded_at, and n_chunks (material chunks the file produced).
        n_chunks joins on source_key (the per-document key), falling back to filename for a pre-032
        row that has none. Content is untrusted data; the manifest lists it, the download seam serves
        the bytes separately."""
        counts = self._chunks_per_file()
        return [{"idx": i, "filename": sd.filename, "size_bytes": sd.size_bytes, "mime": sd.mime,
                 "doc_kind": sd.doc_kind, "status": sd.status, "uploaded_at": sd.uploaded_at,
                 "n_chunks": counts.get(sd.source_key or sd.filename, 0)}
                for i, sd in enumerate(self.source_documents)]


class ContextRegistry:
    """In-memory id -> CompanyContext map. Process-local — the OFFLINE default (no external service,
    what the AFK suite runs). feat-030 delivered the promised DB-backed twin behind the same get/put
    API (`pg_registry.PostgresContextRegistry`); `active_registry()` picks between them by env."""

    # feat-031 cost gate: this registry does NOT persist a store's vectors and advise never reads its
    # in-memory CompanyContext.store, so embedding a corpus for it is pure spend with no reader. The
    # /ingest handler consults this flag to open the vector path ONLY behind a persistent registry.
    persistent = False

    def __init__(self) -> None:
        self._by_id: dict[str, CompanyContext] = {}
        self._notes: dict[str, list[CompanyNote]] = {}   # feat-033: agent-written notes, per context
        self._asks: dict[str, object] = {}               # feat-034: ask_id -> Ask (deep-copied)
        self._ask_tokens: dict[str, tuple[str, int]] = {}  # share_token -> (ask_id, recipient idx)
        self._account_contexts: dict[str, list[str]] = {}  # feat-053: user_id -> [context_id]
        self._context_owner: dict[str, str] = {}           # feat-053: context_id -> user_id (1:1)

    def put(self, ctx: CompanyContext) -> str:
        self._by_id[ctx.context_id] = ctx
        return ctx.context_id

    # --- feat-033: Avery's notes (write-side, accumulating, user-visible) ----------------------

    def append_note(self, context_id: str, text: str, source_excerpt: str = "") -> CompanyNote:
        """Append one agent observation to this company's notebook. Runs the write-side red line
        FIRST (raises ValueError on a scoring/ranking/profiling note — nothing lands), then stores
        it in insertion order. In-memory holds the notes for the process; the Postgres twin persists
        them so they accumulate across sessions/restarts (same duck-typed API)."""
        gate_note_red_line(text, source_excerpt)
        note = CompanyNote(id=new_note_id(), created_at=_now_iso(), text=text,
                           source_excerpt=source_excerpt)
        self._notes.setdefault(context_id, []).append(note)
        return note

    def list_notes(self, context_id: str) -> list[CompanyNote]:
        """This company's notes, NEWEST FIRST (the notebook reads new->old)."""
        return list(reversed(self._notes.get(context_id, [])))

    # --- feat-034: Ask ("Quick ask") storage — the same seam style as notes ---------------------

    def put_ask(self, ask):
        """Store one ask snapshot (create or update). Runs the write-side red-line gate FIRST
        (raises ValueError on a person-scoring question — nothing lands), same storage-door
        discipline as append_note. Deep-copied both ways so a caller's later mutation can never
        silently edit the stored evidence."""
        import copy
        from .ask import gate_ask_red_line
        gate_ask_red_line(ask)
        snapshot = copy.deepcopy(ask)
        self._asks[snapshot.id] = snapshot
        # token index tracks the CURRENT snapshot only (re-share replaces cleanly)
        self._ask_tokens = {t: k for t, k in self._ask_tokens.items() if k[0] != snapshot.id}
        for i, r in enumerate(snapshot.recipients):
            if r.share_token:
                self._ask_tokens[r.share_token] = (snapshot.id, i)
        return copy.deepcopy(snapshot)

    def get_ask(self, ask_id: str):
        import copy
        ask = self._asks.get(ask_id)
        return copy.deepcopy(ask) if ask is not None else None

    def get_ask_by_token(self, share_token: str):
        """Resolve one employee link -> (ask, recipient index), or None (unknown token -> the
        loud 404). The token is the WHOLE credential — no enumeration path exists."""
        import copy
        hit = self._ask_tokens.get(share_token or "")
        if hit is None:
            return None
        ask_id, ridx = hit
        ask = self._asks.get(ask_id)
        if ask is None or ridx >= len(ask.recipients):
            return None
        return copy.deepcopy(ask), ridx

    def record_answer(self, share_token: str, answers: list, comment: str,
                      answered_at: str) -> str:
        """The answer-once lock: 'ok' when this FIRST answer lands, 'already' when the recipient
        answered before (nothing is overwritten — the evidence stays stable, PRD Q8), 'unknown'
        for a token that was never minted. Advances the stored status shared->collecting->closed."""
        hit = self._ask_tokens.get(share_token or "")
        if hit is None:
            return "unknown"
        ask_id, ridx = hit
        ask = self._asks.get(ask_id)
        if ask is None:
            return "unknown"
        rec = ask.recipients[ridx]
        if rec.answered_at:
            return "already"
        rec.answers = list(answers)
        rec.comment = comment or ""
        rec.answered_at = answered_at
        if ask.status in ("shared", "collecting"):
            done = sum(1 for r in ask.recipients if r.answered_at)
            ask.status = "closed" if done >= len(ask.recipients) else "collecting"
        return "ok"

    # --- feat-053: the account seam (Supabase user id <-> context ownership) -------------------
    # ABOVE feat-038, never instead of it: owner_token stays the lower-layer credential and this map
    # is a SECOND, durable way to prove ownership of a context you already own. A context with no
    # entry here is anonymous and behaves exactly as it did pre-053 (the guest path).

    def link_account_context(self, user_id: str, context_id: str) -> bool:
        """Bind a context to an account. True when it is now bound to THIS user (including a
        re-link, which is idempotent), False when another account already owns it — one context has
        at most one owner account, which is the storage-layer half of "两个账号数据不串". The
        Postgres twin gets the same answer from a UNIQUE index (migration 0008)."""
        if not user_id or not context_id:
            return False
        current = self._context_owner.get(context_id)
        if current is not None and current != user_id:
            return False
        self._context_owner[context_id] = user_id
        ctxs = self._account_contexts.setdefault(user_id, [])
        if context_id not in ctxs:
            ctxs.append(context_id)
        return True

    def contexts_for_account(self, user_id: str) -> list[str]:
        """Every context this user owns, newest link first (the order the account picker shows)."""
        if not user_id:
            return []
        return list(reversed(self._account_contexts.get(user_id, [])))

    def account_for_context(self, context_id: str) -> str | None:
        """The account that owns this context, or None when it is still anonymous."""
        return self._context_owner.get(context_id)

    def account_owns(self, user_id: str | None, context_id: str) -> bool:
        """The authorization question: may THIS signed-in user read THIS context? Requires an exact
        match — an anonymous (unowned) context is never readable via the account path, only via its
        owner_token, so signing in can never hand you someone else's un-claimed workspace."""
        if not user_id or not context_id:
            return False
        return self._context_owner.get(context_id) == user_id

    def get(self, context_id: str) -> CompanyContext | None:
        return self._by_id.get(context_id)

    def resolve_memory_dir(self, context_id: str) -> Path | None:
        """The seam live_input wants: an id -> a memory_dir the loop's recall() reads."""
        ctx = self.get(context_id)
        return ctx.memory_dir if ctx else None

    def source_document_bytes(self, context_id: str, idx: int) -> bytes | None:
        """feat-032 download seam: the raw bytes of the idx-th uploaded file, or None (unknown
        context / out-of-range idx / no content). In-memory holds the bytes; the pg twin reads
        bytea. Same duck-typed API so the /team/{id}/files/{idx} handler is registry-agnostic."""
        ctx = self.get(context_id)
        if ctx is None or idx < 0 or idx >= len(ctx.source_documents):
            return None
        return ctx.source_documents[idx].content

    def __contains__(self, context_id: str) -> bool:
        return context_id in self._by_id

    def clear(self) -> None:
        self._by_id.clear()
        self._notes.clear()
        self._asks.clear()
        self._ask_tokens.clear()
        self._account_contexts.clear()
        self._context_owner.clear()


# Process-wide default registry (the offline in-memory instance).
REGISTRY = ContextRegistry()


# --- feat-030: env-selected persistence -------------------------------------------------------

def db_url() -> str | None:
    """The persistence connection string: `AVERY_DB_URL`, with `PGVECTOR_URL` accepted as the alias
    that service/.env.example already names. Unset -> the in-memory registry (offline default)."""
    return (os.environ.get("AVERY_DB_URL") or os.environ.get("PGVECTOR_URL") or "").strip() or None


def data_root() -> Path:
    """Where materialized memory (facts.md/notes.md) lives: `AVERY_DATA_DIR` when set (a STABLE
    data dir — survives reboots; pair it with the DB registry so a restart re-materializes into
    it), else the pre-030 OS-temp default (fine for the ephemeral in-memory registry)."""
    env = (os.environ.get("AVERY_DATA_DIR") or "").strip()
    if env:
        return Path(env)
    return Path(tempfile.gettempdir()) / "avery-contexts"


_PG_REGISTRIES: dict[str, object] = {}   # url -> PostgresContextRegistry (per-process cache)


def active_registry() -> ContextRegistry:
    """THE registry the service should use right now. `AVERY_DB_URL`/`PGVECTOR_URL` set -> the
    Postgres-backed registry (company data survives restarts/redeploys); unset -> the in-memory
    REGISTRY (offline default, no external service, suite stays green with no DB).

    The DB module is imported lazily so the offline path NEVER needs psycopg installed."""
    url = db_url()
    if not url:
        return REGISTRY
    reg = _PG_REGISTRIES.get(url)
    if reg is None:
        from .pg_registry import PostgresContextRegistry  # lazy: offline suite never imports this
        from avery.embeddings import make_embedder_from_env  # feat-031: same gate the service uses
        # feat-031: a configured embedder turns the DB registry into real pgvector RAG (put() fills
        # embeddings, get() rebuilds a pgvector store). None (keyword / no key) -> KeywordStore.
        reg = _PG_REGISTRIES[url] = PostgresContextRegistry(url, embedder=make_embedder_from_env())
    return reg  # type: ignore[return-value]  # duck-typed: same get/put/resolve/__contains__ API


def new_context_id() -> str:
    return "ctx_" + uuid.uuid4().hex[:12]


def materialize_memory(extraction: ExtractionResult, dest: Path) -> Path:
    """Write extracted, red-line-clean entities to facts.md / notes.md so the EXISTING loop recall +
    cite gate work over ingested data with no engine change. Each fact is one line (facts.md:<line>).
    """
    dest = Path(dest)
    dest.mkdir(parents=True, exist_ok=True)

    facts: list[str] = ["# Company facts (ingested from uploads — qualitative, red-line-clean)", ""]
    if extraction.people:
        facts.append("## People (qualitative only — no scores, no blood bars)")
        for p in extraction.people:
            facts += p.as_facts_lines()
        facts.append("")
    if extraction.projects:
        facts.append("## Projects")
        for pr in extraction.projects:
            facts += pr.as_facts_lines()
        facts.append("")
    if extraction.materials:
        facts.append("## Company material")
        seen: set[str] = set()
        for m in extraction.materials:
            if m.text in seen:
                continue
            seen.add(m.text)
            facts.append(m.text)
        facts.append("")
    (dest / "facts.md").write_text("\n".join(facts), encoding="utf-8")

    notes: list[str] = ["# Notes (doc-derived signals — situational, never a person label)", ""]
    for s in extraction.signals:
        notes += s.as_facts_lines()
    (dest / "notes.md").write_text("\n".join(notes) + "\n", encoding="utf-8")
    return dest
