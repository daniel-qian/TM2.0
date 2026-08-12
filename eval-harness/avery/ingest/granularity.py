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

THE SECOND INCIDENT THE DEFINITION HAD TO ABSORB (issue #92): a roster's DUTY COLUMN. The
partner's 「人员架构」 CSV lists 13 people, each with a 「当前负责事项」 cell, and the LLM returned
12 of those cells as projects — each with a perfectly good owner (the person on its row), which is
why the prompt's own "it gives that project its own owner" test could never catch it. By the
definition above these are not projects: the document tracks the PERSON, and the cell is what that
person carries. Rule R5 reads the structural tell (project candidates whose source line IS a
person's source line, row after row) and demotes them to the person — document-locally, so the
one-file-at-a-time append path and a single all-file batch rule the same way. See
`_duty_column_index` for the full mechanism and its escape hatch.

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

# ── markdown decoration ──────────────────────────────────────────────────────────────────────────
# EVERY STRUCTURAL LABEL IN THIS MODULE IS ANCHORED AT `^`, AND THAT ANCHOR WAS READING THE MARKUP
# RATHER THAN THE LABEL. This is the second half of H4 LAYER A, found on the real machine after
# feat-054 shipped: `segment_projects` matched 「项目：」 only when the label led the line, so a
# weekly whose projects are written as MARKDOWN HEADINGS — 「## 项目：别墅交付验收」, the ordinary way
# to write a weekly in a .md file — segmented into ZERO blocks and fell back to the pre-054
# whole-document scalar sweep. Measured on a three-project ZH weekly, before this block:
#
#     ## 项目：别墅交付验收 / 渠道合作拓展 / 客户投诉处理   ->  projects == 1
#       title    '三亚鹿山雅居 · 周报 W29'   <- the DOCUMENT's own heading
#       ownerName '吴桂芳'                   <- project 3's owner
#       status    'blocked'                  <- project 3's status
#       progress  30                         <- project 2's progress
#
# So it is not merely "one project instead of three": the survivor is a SMEAR, carrying three
# different projects' fields on a card named after the file. That is strictly worse than the empty
# screen — and it also defeats this module's own phantom defence, because the smeared owner/status/
# progress make `_tracked_fields` non-empty, so R4-document-not-project cannot fire and R0-tracked
# keeps the phantom while CITING the fields it was smeared from.
#
# NOT A CJK BUG, for the same reason LAYER A never was: the pure-ASCII 「## Project: Villa Handover」
# fails identically (measured: 1 project, titled 'Lushan Weekly W29'). Bullets 「- 项目：」, ordered
# rows 「1. 项目：」, bold 「**项目：**」 and blockquoted 「> 项目：」 all fail the same anchor.
#
# THE FIX IS A DECORATION STRIPPER, NOT A WIDER LABEL REGEX, and that distinction is the design:
# widening each of the six anchored patterns to tolerate `#`/`-`/`*`/`>` would be six independent
# edits that drift apart exactly the way feat-048 round 1's duplicated identity rules did. One
# ruler, every consumer — `segment_projects`, `_milestones_in`, `docs_stating_status` and
# `extract._project_from_span` all read their labels through this function.
#
# IT IS A NO-OP ON AN UNDECORATED LINE, BY CONSTRUCTION AND BY MEASUREMENT — which is what lets it
# sit under six live patterns without moving the 2953-test baseline. Every branch below requires a
# leading `>` / `#` / bullet / ordered-row marker, an embedded `**`/`__`, or a trailing `#`; a line
# carrying none of those cannot match any branch and is returned as itself. Verified:
#   * all 128 ASCII codepoints x 7 line shapes — the ONLY leading characters that change a payload
#     are `>` (bare) and `# * + -` (marker + space), i.e. exactly the decoration set and nothing else
#   * fuzz over an undecorated pool [a-zA-Z0-9 项目负责人截止：:/，、], len 0..24, seed 54,
#     n = 200,000 -> 0 lines changed
#   * idempotence fuzz over a pool that DOES include markup, same seed, n = 200,000 -> 0 violations
#
# THE OUTER CONVERGENCE LOOP IS LOAD-BEARING, not defensive padding. Stripping `**` can EXPOSE a
# leading marker the inner loop has already walked past — 「**- 项目：X**」 strips to 「- 项目：X」,
# which still leads with a bullet. A single pass left 149 such lines non-idempotent (measured, same
# fuzz); looping until the string stops changing takes it to 0. Termination is guaranteed because
# every branch strictly shortens the string.
_LEAD_MARKER_RE = re.compile(
    r"^(?:>\s*"                                   # blockquote 「> 项目：X」
    r"|#{1,6}(?=\s|$|[^\w#])\s*"                  # ATX heading 「## 项目：X」
    r"|[-*+•·]\s+"                                # bullet 「- 项目：X」
    r"|\d{1,3}[.)]\s+"                            # ordered row 「1. 项目：X」
    r")")
# Bold/emphasis wrappers. `**`/`__` only: a single `*`/`_` is left alone because it is also ordinary
# punctuation inside a title, and the paired form is what a label actually gets written in
# (「**项目：X**」 / 「**项目**：X」 — both reduce to 「项目：X」).
_EMPHASIS_RE = re.compile(r"\*\*|__")
_TRAIL_HASH_RE = re.compile(r"\s*#+\s*$")


def strip_decoration(line: str) -> str:
    """A document line -> the same line with its MARKDOWN MARKUP removed, for LABEL DETECTION only.

    「## 项目：别墅交付验收」-> 「项目：别墅交付验收」, so the `^`-anchored label patterns in this
    module see the label instead of the markup. See the block comment above for why this exists,
    why it is one shared function rather than six widened regexes, and the no-op proof.

    FOR DETECTION, NOT FOR CONTENT: callers match their label patterns against the return value and
    capture the title/field out of THAT, but nothing in the corpus is rewritten — material chunks,
    blocker text and the `#`-heading title fallback all still read the raw line.
    """
    s = (line or "").strip()
    prev = None
    while s != prev:
        prev = s
        while True:
            nxt = _LEAD_MARKER_RE.sub("", s, count=1).lstrip()
            if nxt == s:
                break
            s = nxt
        if _EMPHASIS_RE.search(s):
            s = _EMPHASIS_RE.sub("", s).strip()
        if s.endswith("#"):
            s = _TRAIL_HASH_RE.sub("", s).strip()
    return s


def project_header_title(line: str) -> str:
    """The project title this line declares ('' if it declares none), markup-tolerant.

    THE ONE PLACE that answers "is this a project header?". `extract._project_from_span` reads it
    too, so the heading-title fallback there can tell 「## 项目：X」 (a project header that happens to
    be a heading — title is X) from 「# 三亚鹿山雅居 · 周报 W29」 (the document's own heading — title
    is the whole line). Before this, that fallback saw only `^#+` and took the former as a project
    literally named 「项目：X」.
    """
    s = strip_decoration(line)
    m = _PROJECT_HEADER_ZH.match(s) or _PROJECT_HEADER_EN.match(s)
    return next((g for g in m.groups() if g), "").strip() if m else ""

# A milestone SECTION header: the label alone on its line (the items follow beneath it). An inline
# form (「里程碑：A、B、C」) is also accepted and split — same intent, one line.
_MILESTONE_HEADER = re.compile(
    r"^(?:里程碑|关键里程碑|阶段目标|任务拆解|子任务|检查点)\s*[：:]\s*(.*)$"
    r"|^(?:key\s+)?(?:milestones?|checkpoints?|sub-?tasks?)\s*[:\-]\s*(.*)$", re.I)

# A KNOWN tracking field label. These close the milestone list unconditionally — 「阻碍项：」 is a
# blocker and 「自报状态：受阻」 is this project's status, never a checkpoint, even though both LOOK
# like the "<name>: <state>" checklist shape below. Vocabulary mirrors the labels
# `extract._project_from_span` reads, so the two stay in agreement about what a field line is.
_FIELD_LABEL = re.compile(
    r"^(?:负责人|主负责人|负责|责任人|牵头人|自报状态|当前状态|状态|项目状态|进度|完成度|完成率"
    r"|截止/关键节点|截止日期|截止|交付日期|关键节点|进展摘要|摘要|概述|目标|简述"
    r"|阻碍项|阻碍|阻塞|卡点|风险点|影响面|下一步|备注|交接人|接班人)\s*[：:]"
    r"|^(?:owner|lead|dri|status|progress|due|deadline|ship(?:s|ping)?|summary|overview|goal"
    r"|blockers?|risks?|next\s+steps?|notes?|impact)\s*[:\-]", re.I)

# Any OTHER labelled field ends the milestone list (an unrecognised 「XX：」 / next project...).
_ANY_LABEL = re.compile(r"^[^：:]{1,12}[：:]\s*\S|^[a-z][a-z /]{1,20}\s*[:\-]\s*\S", re.I)

# A checklist row: "<name> — <completion state>". This is the shape milestones take in the wild, and
# a row whose whole predicate is a completion word is a checkpoint, not a tracked project.
#
# THE SEPARATOR INCLUDES THE COLON, and that is the fix for a silent whole-block failure: real
# documents write checkpoints as 「A/B 测试: 未开始」 / "Budget sign-off: done" just as often as with
# a dash. Read as a field label, such a row ended milestone collection permanently, so a block's
# milestone list came back EMPTY — not one row short, all of them — and R1 (the only rule that
# catches a milestone the LLM has already stripped the status off) could never match. The first
# customer's weekly happens to use 「 — 」 throughout, which is why the corpus never showed it.
# `_FIELD_LABEL` above is what keeps this broadening from swallowing genuine field lines.
_STATE_WORDS_ZH = r"已完成|完成|进行中|受阻|阻塞|未开始|待启动|已交付|已上线|待确认|延期"
_STATE_WORDS_EN = r"done|complete[d]?|in ?progress|blocked|not ?started|todo|delivered|shipped"
_CHECKLIST_ROW = re.compile(
    rf"^(?P<name>.{{1,60}}?)\s*(?:[—–]{{1,2}}|-{{1,2}}|[：:])\s*"
    rf"(?P<state>{_STATE_WORDS_ZH}|{_STATE_WORDS_EN})\s*$", re.I)

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
    # R5-duty-column also drops under "milestone" (machine-wise the same "belongs to a parent"
    # verdict), but its `parent` is a PERSON — the roster row the duty was written on. The closed
    # three-value set is a cross-file contract (test_every_ruling_is_explainable pins it); the
    # human-facing distinction lives in `rule` + `reason`, not in a fourth verdict.
    verdict: str                                        # "project" | "milestone" | "document"
    rule: str                                           # stable rule id, e.g. "R1-milestone-section"
    reason: str
    parent: str = ""
    evidence: str = ""                                  # "<doc>:<1-based line>"
    # issue #93 · WHICH NAMESPACE `parent` IS A NAME IN. R1/R3 name a PROJECT the same corpus
    # tracks; R5 names a PERSON (the roster row the duty was written on). Both are just strings on
    # this record, and the re-judgment path (`rejudge.py`) has to look the parent UP before it may
    # fold a card into it — so it needs to know which list to look in. Reading a person's name off
    # the project list is not a hypothetical: a company with a project literally named after a
    # colleague would fold a duty cell into a stranger, and the fold would carry a perfectly
    # citable-looking reason. "" = this rule names no parent at all (R0/R2/R4) — the one value that
    # makes `rejudge` refuse to fire, which is exactly the ticket's 「无 parent 规则禁开火」.
    parent_kind: str = ""                               # "" | "project" | "person"
    # issue #93 · WHICH CARD this ruling is about, when the answer is knowable. Deliberately EMPTY
    # on the extraction path: `apply_gate` runs before `_disambiguate_project_ids`, so the id a
    # candidate carries there is not yet the id the card will live under — recording it would be a
    # join key that silently points at the wrong card. The re-judgment path judges cards that are
    # ALREADY in the archive under their final ids, so there it is exact, and it is what answers
    # 「为什么这张卡不见了」 against a specific card after a restart.
    subject_id: str = ""

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
        # Markup-tolerant since the H4-LAYER-A follow-up: 「## 项目：X」/「- 项目：X」/「**项目：X**」
        # are the SAME declaration as 「项目：X」, and reading only the bare form segmented a
        # markdown weekly into zero blocks. See `strip_decoration`.
        title = project_header_title(s)
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
        raw = doc.lines[i].strip()
        if not raw:
            continue
        # Labels are DETECTED on the undecorated line (「## 里程碑：」/「- 阻碍项：」 are the same
        # labels as their bare forms), but the milestone ROW below is still appended from `raw` —
        # its own `^[-*••]` strip is what shapes the item text, and the milestone index keys on it.
        s = strip_decoration(raw)
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
        # A KNOWN field label (「阻碍项：」/「自报状态：」…) closes the list — checked FIRST, so a field
        # whose value happens to be a completion word ("状态：已完成") is never read as a checkpoint.
        if _FIELD_LABEL.match(s):
            collecting = False
            continue
        # An UNRECOGNISED "<x>: <y>" line closes it too, unless it is a checklist row — 「A/B 测试:
        # 未开始」 is a checkpoint that merely looks like a label.
        if _ANY_LABEL.match(s) and not _CHECKLIST_ROW.match(s):
            collecting = False
            continue
        out.append((re.sub(r"^[-*••]\s*", "", raw), i))
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


# ── R5: the duty column (issue #92) ──────────────────────────────────────────────────────────────
# THE PRODUCTION SHAPE THIS CATCHES. The partner's 「人员架构」 CSV carries a 「当前负责事项」 column:
# one row per person, each cell naming the pile of work that person is carrying. The LLM read 13
# rows and returned 12 "projects" — and the PROMPT criterion could not have stopped it, because
# "it gives that project its own owner" is TRUE of every cell (the owner is the person on that
# row). A constraint that only lives in the prompt is not a gate (the model disobeys); the gate
# has to read a STRUCTURAL signal off the extraction itself.
#
# THE SIGNAL. On the LLM path every entity carries `source="<doc>:<line>"` from the model's own
# line attribution (llm_extract._line_ref). A duty cell and the person it belongs to sit on THE
# SAME ROW, so the fake project's line == that person's line, for row after row. Real projects do
# not look like this: a weekly defines the project on its 「项目：」 header line and the owner on
# the 负责人 line below it. So: within ONE document, when most line-bearing project candidates sit
# exactly on person lines, the document is duty-column-shaped, and each such candidate is demoted
# with the person on its row as the citable parent.
#
# WHY THIS RULE IS DOCUMENT-LOCAL ON PURPOSE — it is the only defence that does not lean on the
# cross-document evidence pool. R1/R3/R4 all read other documents (milestone lists / sibling
# titles / identities), so a file re-uploaded ALONE (the append path) blinds all three at once —
# that asymmetry is exactly the production 18-vs-11. R5 judges a document against itself, so
# one-file-at-a-time and all-at-once agree BY CONSTRUCTION.
#
# THE HEURISTIC PATH IS STRUCTURALLY INERT HERE, and that is load-bearing, not luck: its `source`
# means something else. Heuristic people come from roster rows / resume headers / 自述 lines, and
# heuristic projects carry the SPAN START (the project header line, extract.py::_project_from_span)
# — a line cannot be both a project header and a person row, and doc_kind=='roster' produces no
# projects at all on that path. The one collision the heuristic CAN produce is the whole-document
# span's `<doc>:1` against a line-1 person — which the `line 1` exclusion below already refuses
# for the LLM clamp reason. So one definition serves both paths: live on the LLM path, provably
# unreachable on the heuristic one (test_granularity_duty_column_92 pins this with a real
# heuristic corpus rather than trusting this paragraph).

# Base trigger: at least this many row-aligned candidates, making up at least this share of the
# document's line-bearing candidates. Two knobs, two failure modes they guard: the MIN_HITS floor
# keeps one accidental line collision in a real weekly from ever firing (a model that cites the
# owner line for both the person and the project is one bad row, not a pattern); the RATIO keeps
# a big mixed document honest (12 duty rows above a genuine 15-project section is 44% — leave it
# alone; the same 12 above 4 real projects is 75% — fire). 宁可漏 on the fence, like the rest of
# this module.
_R5_MIN_HITS = 2
_R5_MIN_RATIO = 0.6
# doc_kind=='roster' is a BONUS SIGNAL ONLY, never the main criterion — the production file was
# called 「人员架构」, which the roster sniff does not match (measured doc_kind=='project'), so a
# rule gated on the sniff would have missed the incident entirely. When the sniff DOES say roster,
# the document has told us its rows are people, so a single row-aligned candidate is already
# suspicious: the thresholds relax, nothing else changes.
_R5_ROSTER_MIN_HITS = 1
_R5_ROSTER_MIN_RATIO = 0.5


def _line_anchored(source: str) -> tuple[str, int] | None:
    """'<doc>:<line>' -> (doc, line) when the source carries a REAL line, else None.

    ONE eligibility ruler for BOTH sides of the R5 comparison (the person line set and the project
    candidates) — deliberately one lock, not a belt-and-braces pair, so a mutation here cannot hide
    behind a twin check (progress.md 0808: two locks on one door make each immune to mutation).

    LINE 1 IS NOT A LINE for this purpose: when the model omits `line`, llm_extract._line_ref
    clamps it to 1, so `<doc>:1` means "the model did not say" — treating two such defaults as
    "the same row" would manufacture overlap out of missing data. The split mirrors
    `extract.doc_key_of` (rsplit at the LAST colon; a doc name may itself contain colons) — that
    function is not importable here without a cycle (extract.py imports this module), and a
    non-numeric tail after the last colon means the string carries no line at all.
    """
    s = source or ""
    if ":" not in s:
        return None
    head, _, tail = s.rpartition(":")
    if not tail.isdigit() or int(tail) <= 1:
        return None
    return head, int(tail)


def _independent_tracking(p) -> list[str]:
    """R5's escape hatch — R3 guard (a)'s shape with the duty-appropriate field set.

    A roster MAY double as a project ledger, and the way a document says so is by tracking the row
    BEYOND the person: a progress number, a deadline, a milestone list. Those three and NOT the
    other two `_tracked_fields` reads, because on a duty row both are noise: ownerName is the
    person on that row (its presence is the bug's whole disguise — the prompt criterion died on
    it), and status is the one field the model sniffs out of a cell like 「婚宴对接（进行中）」, the
    same reason R4 refuses sniffed status as evidence.
    """
    got = []
    if getattr(p, "progress", None) is not None:
        got.append("进度")
    if getattr(p, "dueDate", ""):
        got.append("截止日期")
    if getattr(p, "milestones", None):
        got.append("里程碑")
    return got


def _duty_column_index(projects, people, docs: list[ParsedDoc]) -> dict[int, tuple[str, str]]:
    """id(candidate) -> (person name, person source) for every candidate R5 may demote.

    Aggregation and demotion are two different scopes ON PURPOSE. The trigger is per-document
    (is this document duty-column-shaped?) so that one coincidental collision never fires; the
    demotion is per-candidate and only for candidates that actually sit on a person's row, so
    every demotion can cite ITS person and ITS line — a candidate swept up "because the document
    as a whole looked like a roster" would be exactly the unexplainable gate the module docstring
    forbids. Escape-hatch candidates stay IN the trigger arithmetic (row alignment is shape
    evidence regardless of fields) but are exempted at demotion time in `classify`, so a ledger
    row with a real deadline does not weaken its neighbours' signal and still survives itself.
    """
    person_at: dict[tuple[str, int], tuple[str, str]] = {}
    for person in people or []:
        ref = _line_anchored(getattr(person, "source", ""))
        name = (getattr(person, "name", "") or "").strip()
        if ref is None or not name:
            continue
        person_at.setdefault(ref, (name, getattr(person, "source", "")))
    if not person_at:
        return {}

    per_doc: dict[str, list[tuple[object, int]]] = {}
    for p in projects:
        ref = _line_anchored(getattr(p, "source", ""))
        if ref is None:
            continue
        per_doc.setdefault(ref[0], []).append((p, ref[1]))

    kinds = {doc.name: doc.doc_kind for doc in docs}
    out: dict[int, tuple[str, str]] = {}
    for doc_name, cands in per_doc.items():
        hits = [(p, person_at[(doc_name, n)]) for p, n in cands if (doc_name, n) in person_at]
        if kinds.get(doc_name) == "roster":
            min_hits, min_ratio = _R5_ROSTER_MIN_HITS, _R5_ROSTER_MIN_RATIO
        else:
            min_hits, min_ratio = _R5_MIN_HITS, _R5_MIN_RATIO
        if len(hits) < min_hits or len(hits) / len(cands) < min_ratio:
            continue
        for p, hit in hits:
            out[id(p)] = hit
    return out


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


_STATUS_LABEL = re.compile(
    r"^(?:自报状态|当前状态|状态|项目状态)\s*[：:]\s*\S|^status\s*[:\-]\s*\S", re.I)


def docs_stating_status(docs: list[ParsedDoc]) -> set[str]:
    """Names of documents that LABEL a status (「自报状态：受阻」 / 'Status: on-track') rather than
    merely containing prose a status can be sniffed out of.

    This is the distinction rule R4 needs and could not previously make. `ProjectEntity.status` is
    one field with two very different provenances, and the entity does not record which — so the
    provenance is recovered here, from the document, instead of widening the entity (its shape is a
    cross-line contract with the project screen and is deliberately left alone).
    """
    out: set[str] = set()
    for doc in docs:
        # Markup-tolerant for the same reason R4 needs this set at all: 「- 状态：进行中」 is a
        # LABELLED status, and reading it as unlabelled prose would let R4 demote a real
        # single-project file whose fields happen to be written as a bullet list.
        if any(_STATUS_LABEL.match(strip_decoration(ln)) for ln in doc.lines):
            out.add(doc.name)
    return out


def classify(project, milestone_index: dict[str, tuple[str, str]],
             project_titles: dict[str, str],
             doc_identities: dict[str, str] | None = None,
             stated_status_docs: set[str] | None = None,
             duty_parents: dict[int, tuple[str, str]] | None = None) -> Ruling:
    """Rule the candidate a project or a milestone, WITH a citable reason.

    Rules fire in evidence strength order — a structural fact from the document beats a shape
    heuristic, which beats a name pattern:

      R1 milestone-section  the title is literally a row under some project's 「里程碑：」 list.
                            Strongest possible evidence: the document nested it itself.
      R2 checklist-row      the title carries its own completion verdict ("… — 已完成") and the doc
                            tracks no owner/progress/deadline for it. That is a checkbox.
      R3 phase-of           the title is "<known project> + 第二阶段/Phase 2" — a phase OF something
                            this same document already tracks, whose whole name the title contains,
                            and which the document does NOT track separately. A bare "Phase 2" with
                            no matching parent is NOT demoted, and neither is a phase that carries
                            its own owner/progress/deadline: some companies really do run one.
      R4 document           the title is the DOCUMENT's own name/heading and nothing about it is
                            tracked — not an owner, a progress, a deadline, or a LABELLED status.
      R5 duty-column        the candidate sits on a PERSON's row, in a document where most
                            line-bearing candidates do (`_duty_column_index` — the roster
                            「当前负责事项」 shape). It is that person's pile of work, not a tracked
                            project; parent = the person. A row the document tracks BEYOND the
                            person (progress / deadline / milestones, `_independent_tracking`)
                            escapes — a roster may double as a project ledger. LAST demotion rule
                            on purpose: an owner is the one field a duty cell always has, so
                            R2/R3's untracked-only guards never see these, and a candidate R1 can
                            tie to a milestone list keeps that stronger, doc-nested parent.
      R0 tracked            otherwise, if the doc gave it owner/status/progress/deadline, it is a
                            project and we say which fields prove it.
    """
    title = (project.title or "").strip()
    k = _key(title)

    parent, where = milestone_index.get(k, ("", ""))
    if parent and _key(parent) != k:
        return Ruling(title=title, verdict="milestone", rule="R1-milestone-section", parent=parent,
                      parent_kind="project", evidence=where,
                      reason=f"文档把「{title}」列在项目「{parent}」的「里程碑」清单里，"
                             f"它是该项目的一个检查点，不是独立项目")

    m = _CHECKLIST_ROW.match(title)
    if m and not _tracked_fields(project):
        return Ruling(title=title, verdict="milestone", rule="R2-checklist-row",
                      evidence=getattr(project, "source", ""),
                      reason=f"「{title}」是一条自带完成状态（「{m.group('state')}」）的清单条目，"
                             f"文档没有给它负责人、进度或截止日期，属于检查点")

    # R3 carries TWO guards, both added after it was caught demoting real projects and citing a
    # parent that does not exist:
    #
    #  (a) IF THE DOCUMENT TRACKS IT IN ITS OWN RIGHT, IT IS A PROJECT — that is this module's own
    #      definition, stated at the top, and a phase marker in the name cannot outrank it. A company
    #      that runs 「营收冲刺第二期」 with its own 负责人 / 进度 / 截止 is running a project and
    #      calling it a phase. Without this guard R3 fired ahead of R0 and the evidence never got a
    #      chance to speak.
    #
    #  (b) THE PARENT'S WHOLE NAME MUST APPEAR IN THE PHASE'S NAME — the containment is one-way on
    #      purpose. The old test also accepted `bare in other_k`, which makes any SIBLING sharing a
    #      prefix look like a parent: 'Billing Rewrite Phase 2' was demoted into 'Billing Rewrite
    #      Tooling', and 「别墅营收冲刺第二期」 into 「别墅营收冲刺复盘会」. Those parent lines were
    #      fabrications, and a gate whose whole selling point is "we can say why" must not invent the
    #      why. 'X Phase 2' is a phase of 'X'; it is not a phase of 'X Tooling'.
    if _PHASE_MARKER.search(title) and not _tracked_fields(project):
        bare = _key(_PHASE_MARKER.sub("", title))
        for other_k, other_title in project_titles.items():
            if other_k == k or not bare or not other_k:
                continue
            if bare == other_k or (len(other_k) >= 4 and other_k in bare):
                return Ruling(title=title, verdict="milestone", rule="R3-phase-of",
                              parent=other_title, parent_kind="project",
                              evidence=getattr(project, "source", ""),
                              reason=f"「{title}」是同一份文档已在跟进的项目「{other_title}」的一个阶段")

    # R4 — A DOCUMENT IS NOT A PROJECT. The extractor's no-title fallback reaches for the document's
    # own `#` heading (or filename, or spreadsheet tab), so a weekly report, a meeting-minutes file
    # or a performance-review sheet becomes a "project" named after itself, owned by nobody. That
    # phantom is the failure mode H4 called worse than an empty screen: it does not read as broken,
    # it reads as "everything is fine". Measured on the first customer's seed corpus, it was 2 of 8.
    #
    # OWNER / PROGRESS / DEADLINE are the evidence here, and so is a STATUS THE DOCUMENT LABELLED.
    # Status is the one field the extractor may SNIFF from prose rather than read from a label
    # (「按计划推进」 in a paragraph of minutes -> on-track); a SNIFFED status is not evidence that the
    # document tracks this thing, and if it counted, every phantom in a file containing those three
    # characters would survive as a confidently on-track card. But the original rule excluded status
    # WHOLESALE, which threw out the labelled case with the sniffed one — and that is a net
    # regression: 'Roadmap.md' reading '# Roadmap / Status: on-track / <one paragraph>' extracted
    # ZERO projects where the pre-054 extractor gave one real card, with nothing on screen and no
    # explanation (rulings are not persisted). Sparse single-project files are exactly the shape the
    # other two companies' documents take. `docs_stating_status` recovers the provenance, so
    # 「文档写了 Status:」 counts as tracking and 「文中提到按计划推进」 still does not.
    doc_name = (doc_identities or {}).get(_key(title), "")
    if doc_name and not (
            getattr(project, "ownerName", "") or getattr(project, "ownerId", "")
            or getattr(project, "progress", None) is not None
            or getattr(project, "dueDate", "")
            or (getattr(project, "status", "") and doc_name in (stated_status_docs or set()))):
        return Ruling(title=title, verdict="document", rule="R4-document-not-project",
                      evidence=getattr(project, "source", ""),
                      reason=f"「{title}」是文档自身的标题（{doc_name}），"
                             f"文档没有给它负责人、进度或截止日期——这是一份文件，不是一个项目")

    # R5 — A DUTY CELL IS NOT A PROJECT (issue #92). See `_duty_column_index` for the structural
    # signal and the incident it pins. The demotion is refused when the document tracks this row
    # beyond its person: 「有截止日期的那一行是台账，不是职责栏」.
    duty = (duty_parents or {}).get(id(project))
    if duty and not _independent_tracking(project):
        person_name, _person_src = duty
        return Ruling(title=title, verdict="milestone", rule="R5-duty-column", parent=person_name,
                      parent_kind="person", evidence=getattr(project, "source", ""),
                      reason=f"「{title}」写在「{person_name}」名下那一行的职责栏里——这是这个人"
                             f"当前背着的一摊事；文档没有单独给它进度、截止日期或里程碑，"
                             f"不是公司单独跟进的项目")

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


def judge_projects(projects: list, people: list, docs: list[ParsedDoc]) -> list[Ruling]:
    """Rule EVERY candidate in `projects` against the evidence pool `docs`, changing nothing.

    ONE RULER, two callers (issue #93). `apply_gate` is the extraction path: it judges a freshly
    extracted batch and drops the demoted candidates. `rejudge.rejudge_archive` is the append path:
    it judges the WHOLE archive's cards against the WHOLE archive's documents and FOLDS instead of
    dropping. Those two paths must not each own a copy of "how a candidate is judged" — the whole
    point of the re-judgment is that 「一次全选」 and 「逐份补传」 reach the same verdicts, and two
    copies of the judging loop is precisely how that stops being true without a gate going red
    (`_person_key`/`_link_owners` is this repo's carved-in-stone precedent for that failure).

    Judging is a PURE read of `projects`/`people`/`docs`: nothing here mutates a card, so the
    append path can look at every verdict, decide which ones it is allowed to act on, and act on
    only those. The identity of the returned list matters — `rulings[i]` is the verdict on
    `projects[i]`.
    """
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
    stated_status = docs_stating_status(docs)
    duty_parents = _duty_column_index(projects, list(people or []), docs)
    return [classify(p, milestone_index, project_titles, identities, stated_status, duty_parents)
            for p in projects]


def apply_gate(res, docs: list[ParsedDoc]) -> list[Ruling]:
    """Demote every milestone masquerading as a project on `res`, in place. Returns one Ruling per
    candidate — kept AND demoted — so the decision is fully auditable.

    Ordering note: this runs BEFORE cross-document dedup, so a milestone is judged against the
    document that nested it rather than against a merged record whose provenance is already gone.

    R5 (issue #92) is the first rule that reads `res.people` — the person rows are the evidence a
    duty column is judged against, and they too are still pre-dedup here, so every person still
    carries the source line of the row that named them.

    #93: the judging itself moved into `judge_projects` (see there for why). What stays here is the
    EXTRACTION path's disposal rule — a demoted candidate is dropped outright. That is safe on this
    path and only on this path: these candidates were extracted seconds ago, nobody has ever seen
    them, and nothing downstream has a reference to them. The append path may NOT do this (a
    dropped card is a card the manager was already looking at, and dropping it in a rewrite is the
    「整表静默删除」 the module refused for two tickets) — it folds instead, see `rejudge.py`.
    """
    projects = list(getattr(res, "projects", []) or [])
    rulings = judge_projects(projects, list(getattr(res, "people", []) or []), docs)
    if not rulings:
        return []
    keep = [p for p, r in zip(projects, rulings) if r.verdict == "project"]
    res.projects = keep
    return rulings
