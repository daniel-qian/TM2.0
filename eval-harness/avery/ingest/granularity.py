"""feat-054 — THE PROJECT GRANULARITY GATE: what counts as ONE project.

THE FINDING. "Too many projects" and "too few projects" are not two bugs. They are the same hole
seen from both sides: NOTHING IN THE EXTRACTOR EVER DEFINED WHAT ONE PROJECT IS. Both paths then
failed in whichever direction their mechanics pushed them.

  * THE LLM PATH OVER-SPLITS — and it was TOLD to. `llm_extract._INSTRUCTIONS` read:
        'one entry per distinct project, phase or engagement ... ("Phase 1" and "Phase 2" of an
         engagement are two entries)'
    That instruction IS the milestone-promotion bug, written down. On the first customer's weekly
    (鹿山雅居-项目周报.docx) every project carries a 「里程碑：」 list of four checkpoints, so 6
    projects x 4 checkpoints is 24 milestone rows competing with 6 real projects for the same
    12-entry budget. Measured before this ticket: 17 "projects".

  * THE HEURISTIC PATH UNDER-SPLITS — `_projects_from_doc` accumulated title/owner/status/progress
    into SCALAR locals across the whole document and appended ONE entity at the end, so every
    project but the last was overwritten in place. One document == one project, structurally, since
    the function was written. That is H4 LAYER A (see test_zh_project_axis_gap.py), and it is
    ENGLISH-NATIVE: a pure-ASCII document with two `Project:` lines lost the first one too.

THE GROUND TRUTH, counted rather than assumed. 鹿山雅居-项目周报.docx says so itself, on line 3:
「本期周报覆盖 6 个在跟进项目」 — SIX. It then lays out 「项目 1：」…「项目 6：」, each with its own
负责人 / 自报状态 / 进度 / 截止 / 进展摘要 / 里程碑(x4) / 阻碍项. So: 6 projects, 24 milestones.

THE DEFINITION this module enforces, stated once so every rule below can be argued against it:

    A PROJECT is a unit of work the document tracks IN ITS OWN RIGHT — it gets its own owner,
    status, progress or deadline.
    A MILESTONE is a checkpoint INSIDE such a unit — it is listed under a project's milestone
    section, or named as a phase of one, and the document tracks no owner/progress of its own for it.

WHY THE RULES ARE STRUCTURAL, NOT A COUNT CAP. The obvious "fix" is to cap projects at N, or to
trust the doc's stated 「6 个」 and keep the first six. Both are rejected here, because both throw
away the customer's data on a number's say-so and NEITHER CAN ANSWER "why this one?". Three
companies will ask exactly that. Every demotion this module makes cites the document: the line that
demoted it, the parent it belongs to, and the rule that fired — see `Ruling`. The stated count is
still read (`stated_project_count`) but it is used ONLY as a reconciliation signal to report
against, never to truncate. An unexplainable gate is worse than the fragmentation it fixes.

WHAT IS DELIBERATELY NOT DONE: milestones are DROPPED from the project axis, not re-emitted as a
milestone entity. The kickoff puts milestones out of scope for this wave ("不做：里程碑"), and
inventing a new entity type nothing renders would be dead weight. Their text survives in the RAG
material chunks either way, so nothing is lost from retrieval — only from the project cards.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

from .parse import ParsedDoc

# ── document structure ───────────────────────────────────────────────────────────────────────────
# A project block STARTS at an explicit project label. Both languages, and the ZH form carries an
# optional ordinal (「项目 1：」/「项目一：」/「项目：」) because that is how the customer's weekly
# is actually written. `title:` is kept on the EN side because the pre-054 extractor honoured it.

_PROJECT_HEADER_ZH = re.compile(
    r"^(?:项目|专案|课题|工程)\s*[0-9０-９一二三四五六七八九十]*\s*[：:]\s*(.+)$")
_PROJECT_HEADER_EN = re.compile(
    r"^(?:project|initiative|workstream|title)\s*\d*\s*[:\-]\s*(.+)$", re.I)

# A milestone SECTION header: the label alone on its line (the items follow beneath it). An inline
# form (「里程碑：A、B、C」) is also accepted and split — same intent, one line.
_MILESTONE_HEADER = re.compile(
    r"^(?:里程碑|关键里程碑|阶段目标|任务拆解|子任务|检查点)\s*[：:]\s*(.*)$"
    r"|^(?:key\s+)?(?:milestones?|checkpoints?|sub-?tasks?)\s*[:\-]\s*(.*)$", re.I)

# Any OTHER labelled field ends the milestone list (「阻碍项：」/「影响面：」/next project...).
_ANY_LABEL = re.compile(r"^[^：:]{1,12}[：:]\s*\S|^[a-z][a-z /]{1,20}\s*[:\-]\s*\S", re.I)

# A checklist row: "<name> — <completion state>". This is the shape milestones take in the wild, and
# a row whose whole predicate is a completion word is a checkpoint, not a tracked project.
_STATE_WORDS_ZH = r"已完成|完成|进行中|受阻|阻塞|未开始|待启动|已交付|已上线|待确认|延期"
_STATE_WORDS_EN = r"done|complete[d]?|in ?progress|blocked|not ?started|todo|delivered|shipped"
_CHECKLIST_ROW = re.compile(
    rf"^(?P<name>.{{1,60}}?)\s*[—–\-]{{1,2}}\s*(?P<state>{_STATE_WORDS_ZH}|{_STATE_WORDS_EN})\s*$",
    re.I)

# 「阶段 / 第N期 / Phase N / M1」 — a phase MARKER. On its own this proves nothing (a company may
# genuinely run "Phase 2" as its own tracked project); it only demotes when stripping the marker
# leaves the name of a project the SAME document already tracks. See rule R3.
_PHASE_MARKER = re.compile(
    r"(?:第\s*[0-9０-９一二三四五六七八九十]+\s*(?:期|阶段|步)|[0-9０-９一二三四五六七八九十]+\s*期"
    r"|阶段\s*[0-9０-９一二三四五六七八九十]+|里程碑\s*[0-9０-９一二三四五六七八九十]*"
    r"|\bphase\s*\d+|\bstage\s*\d+|\bmilestone\s*\d+|\bM\d\b|\bP[0-9]\b)", re.I)

# 「本期周报覆盖 6 个在跟进项目」 — the document telling us its own project count.
_STATED_COUNT = re.compile(
    r"(?:覆盖|包含|共|涉及|跟进|在跑|合计)\s*([0-9０-９一二三四五六七八九十]+)\s*个[^。\n]{0,8}项目"
    r"|\b(\d+)\s+(?:active|ongoing|live)?\s*projects?\b", re.I)

_ZH_DIGITS = {"零": 0, "一": 1, "二": 2, "两": 2, "三": 3, "四": 4, "五": 5,
              "六": 6, "七": 7, "八": 8, "九": 9, "十": 10}


def _to_int(raw: str) -> int | None:
    """'6' / '６' / '六' / '十二' -> int. Returns None for anything it cannot read honestly."""
    s = (raw or "").strip()
    if not s:
        return None
    s = s.translate(str.maketrans("０１２３４５６７８９", "0123456789"))
    if s.isdigit():
        return int(s)
    if all(c in _ZH_DIGITS for c in s):
        if "十" in s:                                   # 十=10, 十二=12, 二十=20, 二十三=23
            head, _, tail = s.partition("十")
            return (_ZH_DIGITS[head] if head else 1) * 10 + (_ZH_DIGITS[tail] if tail else 0)
        return _ZH_DIGITS[s] if len(s) == 1 else None
    return None


@dataclass
class ProjectBlock:
    """One project's span in a document: where it starts, and the milestone rows nested under it."""
    title: str
    start: int                                          # 0-based index of the header line
    end: int                                            # exclusive
    milestones: list[tuple[str, int]] = field(default_factory=list)   # (text, 0-based line)


@dataclass(frozen=True)
class Ruling:
    """WHY a candidate was kept or demoted — the audit record. `reason` is user-facing Chinese: it is
    what we show a manager who asks 'why isn't 预算缺口确认 a project?'."""
    title: str
    # "project" keeps the card; "milestone" and "document" both drop it. They are kept DISTINCT
    # rather than folded into one "rejected" because the explanation a manager gets differs: one
    # says "this belongs to that project", the other says "this is your file, not a project".
    verdict: str                                        # "project" | "milestone" | "document"
    rule: str                                           # stable rule id, e.g. "R1-milestone-section"
    reason: str
    parent: str = ""
    evidence: str = ""                                  # "<doc>:<1-based line>"

    def as_line(self) -> str:
        tail = f"（归入「{self.parent}」）" if self.parent else ""
        where = f" [{self.evidence}]" if self.evidence else ""
        return f"{self.rule} · 「{self.title}」→ {self.verdict}{tail}：{self.reason}{where}"


def stated_project_count(doc: ParsedDoc) -> int | None:
    """The project count the DOCUMENT states about itself, if it states one. Reconciliation signal
    only — never a truncation rule (see the module docstring)."""
    for ln in doc.lines[:40]:
        m = _STATED_COUNT.search(ln.strip())
        if m:
            n = _to_int(m.group(1) or m.group(2) or "")
            if n and 0 < n < 100:
                return n
    return None


def segment_projects(doc: ParsedDoc) -> list[ProjectBlock]:
    """Split a document into project blocks at its explicit project labels.

    THIS IS THE LAYER-A FIX (H4). The pre-054 extractor never segmented at all — it swept the whole
    document into one set of scalars, so only the LAST project in a file survived. Blocks are cut at
    the labels the document itself uses, so a weekly listing six projects yields six spans and each
    keeps its own owner/status/progress instead of overwriting its predecessor.

    Returns [] when the document uses no project labels — the caller then keeps the pre-054
    whole-document behaviour (heading-titled single project), so documents that genuinely describe
    one thing are unaffected.
    """
    heads: list[tuple[int, str]] = []
    for i, ln in enumerate(doc.lines):
        s = ln.strip()
        if not s:
            continue
        m = _PROJECT_HEADER_ZH.match(s) or _PROJECT_HEADER_EN.match(s)
        if m:
            title = next((g for g in m.groups() if g), "").strip()
            if title:
                heads.append((i, title))
    if not heads:
        return []

    blocks: list[ProjectBlock] = []
    for n, (start, title) in enumerate(heads):
        end = heads[n + 1][0] if n + 1 < len(heads) else len(doc.lines)
        blocks.append(ProjectBlock(title=title, start=start, end=end,
                                   milestones=_milestones_in(doc, start, end)))
    return blocks


def _milestones_in(doc: ParsedDoc, start: int, end: int) -> list[tuple[str, int]]:
    """The milestone rows nested under one project block.

    Two shapes are read: a bare 「里程碑：」 header whose items follow on later lines (the customer's
    weekly), and an inline 「里程碑：A、B、C」. Collection stops at the next labelled field, so
    「阻碍项：」 is a blocker and never a milestone.
    """
    out: list[tuple[str, int]] = []
    collecting = False
    for i in range(start, min(end, len(doc.lines))):
        s = doc.lines[i].strip()
        if not s:
            continue
        m = _MILESTONE_HEADER.match(s)
        if m:
            inline = next((g for g in m.groups() if g), "").strip()
            if inline:
                for part in re.split(r"[、,;；]|\s{2,}", inline):
                    if part.strip():
                        out.append((part.strip(), i))
                collecting = False
            else:
                collecting = True
            continue
        if not collecting:
            continue
        # a new labelled field (「阻碍项：」…) closes the milestone list
        if _ANY_LABEL.match(s) and not _CHECKLIST_ROW.match(s):
            collecting = False
            continue
        out.append((re.sub(r"^[-*••]\s*", "", s), i))
    return out


# ── the gate ─────────────────────────────────────────────────────────────────────────────────────

def _key(title: str) -> str:
    """Comparison key for titles: fold case, whitespace, and the punctuation a doc varies freely."""
    return re.sub(r"[\s_\-—–·:：/、,，.。]+", "", (title or "").lower()).strip()


def _strip_state(text: str) -> str:
    """'预算缺口确认 — 受阻' -> '预算缺口确认'. The row's name without its completion verdict."""
    m = _CHECKLIST_ROW.match((text or "").strip())
    return m.group("name").strip() if m else (text or "").strip()


def _tracked_fields(p) -> list[str]:
    """Which independent-tracking fields the document filled in for this candidate. This is the
    evidence rule R0 keeps a project on, and its absence is what rule R2 leans on."""
    got = []
    if getattr(p, "ownerName", "") or getattr(p, "ownerId", ""):
        got.append("负责人")
    if getattr(p, "status", ""):
        got.append("状态")
    if getattr(p, "progress", None) is not None:
        got.append("进度")
    if getattr(p, "dueDate", ""):
        got.append("截止日期")
    return got


def document_identities(docs: list[ParsedDoc]) -> dict[str, str]:
    """title-key -> document name, for every way a document names ITSELF: its filename (with and
    without extension), its first `#` heading, and any 'sheet: X' tab title the parser emits.

    This is what rule R4 tests against. It is the identity a no-title fallback reaches for, which is
    precisely how the phantom gets made.
    """
    out: dict[str, str] = {}
    for doc in docs:
        stem = re.sub(r"\.[a-z0-9]+$", "", doc.name, flags=re.I)
        names = {doc.name, stem, stem.replace("_", " ").replace("-", " ")}
        for i, ln in enumerate(doc.lines[:20]):
            s = ln.strip()
            m = re.match(r"^#+\s*(.+)$", s)
            if m:
                names.add(m.group(1).strip())
                break
        for ln in doc.lines:
            m = re.match(r"^sheet\s*[:：]\s*(.+)$", ln.strip(), re.I)
            if m:
                names.add(ln.strip())
                names.add(m.group(1).strip())
        for n in names:
            if _key(n):
                out.setdefault(_key(n), doc.name)
    return out


def classify(project, milestone_index: dict[str, tuple[str, str]],
             project_titles: dict[str, str],
             doc_identities: dict[str, str] | None = None) -> Ruling:
    """Rule the candidate a project or a milestone, WITH a citable reason.

    Rules fire in evidence strength order — a structural fact from the document beats a shape
    heuristic, which beats a name pattern:

      R1 milestone-section  the title is literally a row under some project's 「里程碑：」 list.
                            Strongest possible evidence: the document nested it itself.
      R2 checklist-row      the title carries its own completion verdict ("… — 已完成") and the doc
                            tracks no owner/progress/deadline for it. That is a checkbox.
      R3 phase-of           the title is "<known project> + 第二阶段/Phase 2" — a phase OF something
                            this same document already tracks. A bare "Phase 2" with no matching
                            parent is NOT demoted: some companies really do run one.
      R0 tracked            otherwise, if the doc gave it owner/status/progress/deadline, it is a
                            project and we say which fields prove it.
    """
    title = (project.title or "").strip()
    k = _key(title)

    parent, where = milestone_index.get(k, ("", ""))
    if parent and _key(parent) != k:
        return Ruling(title=title, verdict="milestone", rule="R1-milestone-section", parent=parent,
                      evidence=where,
                      reason=f"文档把「{title}」列在项目「{parent}」的「里程碑」清单里，"
                             f"它是该项目的一个检查点，不是独立项目")

    m = _CHECKLIST_ROW.match(title)
    if m and not _tracked_fields(project):
        return Ruling(title=title, verdict="milestone", rule="R2-checklist-row",
                      evidence=getattr(project, "source", ""),
                      reason=f"「{title}」是一条自带完成状态（「{m.group('state')}」）的清单条目，"
                             f"文档没有给它负责人、进度或截止日期，属于检查点")

    if _PHASE_MARKER.search(title):
        bare = _key(_PHASE_MARKER.sub("", title))
        for other_k, other_title in project_titles.items():
            if other_k == k or not bare or not other_k:
                continue
            if bare == other_k or (len(bare) >= 4 and (bare in other_k or other_k in bare)):
                return Ruling(title=title, verdict="milestone", rule="R3-phase-of",
                              parent=other_title, evidence=getattr(project, "source", ""),
                              reason=f"「{title}」是同一份文档已在跟进的项目「{other_title}」的一个阶段")

    # R4 — A DOCUMENT IS NOT A PROJECT. The extractor's no-title fallback reaches for the document's
    # own `#` heading (or filename, or spreadsheet tab), so a weekly report, a meeting-minutes file
    # or a performance-review sheet becomes a "project" named after itself, owned by nobody. That
    # phantom is the failure mode H4 called worse than an empty screen: it does not read as broken,
    # it reads as "everything is fine". Measured on the first customer's seed corpus, it was 2 of 8.
    #
    # OWNER / PROGRESS / DEADLINE are the evidence here, and STATUS IS DELIBERATELY EXCLUDED: status
    # is the one field the extractor may SNIFF from surrounding prose rather than read from a label
    # (「按计划推进」 in a paragraph of minutes -> on-track), so a sniffed status is not evidence that
    # the document tracks this thing as a project. A real project doc that states an owner, a
    # progress or a due date keeps its heading title and is untouched.
    if doc_identities and _key(title) in doc_identities and not (
            getattr(project, "ownerName", "") or getattr(project, "ownerId", "")
            or getattr(project, "progress", None) is not None
            or getattr(project, "dueDate", "")):
        return Ruling(title=title, verdict="document", rule="R4-document-not-project",
                      evidence=getattr(project, "source", ""),
                      reason=f"「{title}」是文档自身的标题（{doc_identities[_key(title)]}），"
                             f"文档没有给它负责人、进度或截止日期——这是一份文件，不是一个项目")

    got = _tracked_fields(project)
    if got:
        return Ruling(title=title, verdict="project", rule="R0-tracked",
                      evidence=getattr(project, "source", ""),
                      reason=f"文档单独跟进「{title}」，给出了{'、'.join(got)}")
    return Ruling(title=title, verdict="project", rule="R0-kept",
                  evidence=getattr(project, "source", ""),
                  reason=f"没有任何降级规则命中「{title}」，按项目保留")


def build_milestone_index(docs: list[ParsedDoc]) -> dict[str, tuple[str, str]]:
    """title-key -> (parent project title, '<doc>:<line>') for every milestone row in the corpus.

    Both the raw row and the row stripped of its completion verdict are indexed, because the LLM
    path tends to hand back 「预算缺口确认」 where the document line reads 「预算缺口确认 — 受阻」.
    """
    index: dict[str, tuple[str, str]] = {}
    for doc in docs:
        for block in segment_projects(doc):
            for text, line in block.milestones:
                where = f"{doc.name}:{line + 1}"
                for variant in {_key(text), _key(_strip_state(text))}:
                    if variant and variant not in index:
                        index[variant] = (block.title, where)
    return index


def apply_gate(res, docs: list[ParsedDoc]) -> list[Ruling]:
    """Demote every milestone masquerading as a project on `res`, in place. Returns one Ruling per
    candidate — kept AND demoted — so the decision is fully auditable.

    Ordering note: this runs BEFORE cross-document dedup, so a milestone is judged against the
    document that nested it rather than against a merged record whose provenance is already gone.
    """
    projects = list(getattr(res, "projects", []) or [])
    if not projects:
        return []
    milestone_index = build_milestone_index(docs)
    # Titles that survive as projects are the comparison set R3 matches phases against; seed it with
    # the document's own project headers so a phase is caught even if its parent is a later entry.
    project_titles: dict[str, str] = {}
    for doc in docs:
        for block in segment_projects(doc):
            project_titles.setdefault(_key(block.title), block.title)
    for p in projects:
        project_titles.setdefault(_key(p.title), p.title)

    identities = document_identities(docs)
    rulings = [classify(p, milestone_index, project_titles, identities) for p in projects]
    keep = [p for p, r in zip(projects, rulings) if r.verdict == "project"]
    res.projects = keep
    return rulings
