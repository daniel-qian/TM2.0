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

from .granularity import Ruling, apply_gate, segment_projects
from .parse import ParsedDoc

# The preset buckets _norm_team maps onto WHERE IT HONESTLY CAN; a department this startup taxonomy
# cannot express (前厅部, Growth) passes through verbatim rather than being squeezed or blanked —
# see _norm_team. NOT a closed set of the values `team` may hold: the consumer (src/lite2/teamData.ts
# `team?: string`) types it as free text and renders it as the group title. The old comment here
# claimed these "mirror the frontend Person['team'] union"; that union lives only in
# src/story/data/fixtures.ts, the old demo app, which does not consume ingest output (feat-048).
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
    # FREE TEXT since feat-048 BUG-4, not a closed set: a department the TEAMS taxonomy cannot
    # express ('别墅销售组', 'Growth') reaches the page verbatim — see _norm_team, which maps onto a
    # TEAMS bucket only where that is honest. The consumer types it as free text and renders it as
    # the group title (src/lite2/teamData.ts `team?: string`).
    team: str = ""                              # the stated department, mapped where honest; "" if unknown — never guessed hard
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
    # feat-054 — the granularity gate's audit trail: one Ruling per project candidate, kept AND
    # demoted, each citing the rule and document line behind the call. Populated by extract_docs;
    # an extractor's own per-doc result leaves it empty. NOT merged (see merge below).
    granularity: list[Ruling] = field(default_factory=list)

    def merge(self, other: "ExtractionResult") -> "ExtractionResult":
        # `granularity` is intentionally NOT concatenated: merge() folds together partial results
        # from before the gate has run, and the gate assigns the finished list once, post-merge.
        self.people += other.people
        self.projects += other.projects
        self.signals += other.signals
        self.materials += other.materials
        return self


class Extractor(Protocol):
    """Pluggable extraction backend (heuristic offline / LLM in prod). Output is always gated."""
    def extract(self, doc: ParsedDoc) -> ExtractionResult: ...


# --- helpers ----------------------------------------------------------------------------------

# Whitespace with a Han character on BOTH sides — i.e. COLUMN PADDING, not a word separator
# (feat-048 round 3, H2). Chinese does not space words, so whitespace between two Han characters is
# a layout artifact: a roster pads 「孙　浩」with U+3000 to align it against 「李明轩」. Between Latin
# words the same whitespace IS a separator and must stay one, or 'Jo Anna' and 'Joanna' would become
# the same colleague — hence the TWO-SIDED lookaround rather than a blanket strip.
#
# That lookaround is also what makes the English contract safe BY CONSTRUCTION rather than by
# measurement: an ASCII string contains no Han character, so this pattern cannot match anywhere in
# one. _slug and _person_key both apply it, and both are byte-stable on ASCII as a result.
# (U+3000 is matched by `\s` — unicode-aware on str patterns — and is NOT itself inside [一-鿿];
# both verified rather than assumed.)
_HAN_PAD_RE = re.compile(r"(?<=[一-鿿])\s+(?=[一-鿿])")


def _slug(text: str, prefix: str) -> str:
    """Stable id from a name/title. MUST stay a pure function of `text` — no counters, no call
    ordering, no hashes-of-position: `_link_owners` re-derives a person's id from her name alone
    (`by_name`, below), so two calls with the same text must always agree.

    THE CHARACTER CLASS IS LORE, READ BEFORE TOUCHING IT (feat-048).
    This used to be `[^a-z0-9]+`, which is ASCII-only: every Han character fell outside the class,
    became '_', got shaved by .strip('_'), emptied the string and fired the 'x' fallback — so
    '陈思雨' '李明轩' '周雅婷' '孙浩' ALL became 'u_x'. 39 people, 1 id; every person card opened the
    same colleague. It survived 42 features because no Han character had ever entered a name field
    (the seed is *_EN.xlsx and both stub transports use pinyin), i.e. the gate was ASCII in disguise.

    `[\\W_]` — not the more obvious `[^\\w]` — is deliberate, and the difference is the whole point:
      * On str patterns Python 3's `\\w` is unicode-aware by default (no re.UNICODE needed), so
        `\\W` already lets Han/accented Latin/Cyrillic through. That is the fix.
      * But `\\w` also counts '_' as a word character, so a bare `[^\\w]+` would STOP folding
        underscores that sit next to a space or punctuation: 'Roadmap_ Q3' -> 'p_roadmap__q3'
        instead of 'p_roadmap_q3'. That is a byte-level change to ENGLISH ids, which the existing
        evidence rests on. Adding '_' back into the class restores the old folding exactly.
    So `[\\W_]` == "the old [^a-z0-9], plus unicode letters and digits" and nothing else.

    ON ASCII THIS IS AN IDENTITY, NOT A STATISTIC. After `.lower()`, `\\w` == [a-z0-9_], so
    [\\W_] == complement([a-z0-9_]) | {_} == complement([a-z0-9]) == the old class, character for
    character. Verified exhaustively over all 128 ASCII codepoints: 0 membership mismatches. The
    fuzz below only corroborates it; the proof is what makes the English contract safe.

    Measured (feat-048 round 2) — the numbers are meaningless without the POOL, which is why the
    two earlier figures in this comment's history (22,650 and 222,541) could not be reproduced and
    three verifiers independently got 23,765 / 24,754 / 57,587 instead:
        pool [A-Za-z0-9 _-.] (66 symbols, uniform), length uniform 1..24, inputs filtered to those
        containing at least one '_', seed 48, n = 300,000
      -> `[\\W_]+` vs the old `[^a-z0-9]+`:     0 differences (0.0%)  — as the proof above requires
      -> `[^\\w]+` vs the old `[^a-z0-9]+`: 25,924 differences (8.6%) — why the obvious fix is wrong
    test_cjk_identity.py pins both halves of this contract.

    HAN PADDING IS REMOVED FIRST (feat-048 round 3, H2) — and this closes a hole that ROUND 3 ITSELF
    OPENED, which is why it lands here rather than in a follow-up ticket. Widening _HAN_NAME_RE to
    accept 「孙　浩」made a padded name EXTRACTABLE for the first time; before that it was dropped at
    the door and never reached _slug, so the defect below was unreachable and no gate covers it:
        _slug('孙　浩') == 'u_孙_浩'   !=   _slug('孙浩') == 'u_孙浩'
    _dedupe_entities keeps the FIRST-SEEN record, so 孙浩's id flipped with DOCUMENT ORDER — measured,
    both ways, on the same two rosters:
        spaced roster first   -> ('u_孙_浩', '孙　浩')
        unspaced roster first -> ('u_孙浩',  '孙浩')
    English never had this problem: `[\\W_]+` folds a whitespace RUN into ONE '_', so 'Lena Park' and
    'Lena  Park' both give 'u_lena_park'. Han was strictly worse than English until this line, and
    padding is a COLUMN-LAYOUT artifact — it must not reach an identity. This also keeps _slug in
    agreement with _person_key, which removes the same padding for the same reason (one ruler).

    ON ASCII THE HAN STRIP IS A NO-OP, BY CONSTRUCTION AND BY MEASUREMENT. _HAN_PAD_RE requires a Han
    character on BOTH sides of the whitespace, and an ASCII string contains none, so it cannot match:
    the English contract above is preserved exactly, 'Roadmap_ Q3' -> 'p_roadmap_q3' included.
    Verified over all 128 ASCII codepoints (0 mismatches) and by fuzz against the pre-round-3 _slug
    (pool [A-Za-z0-9 _-.], length 1..24, seed 48, n = 300,000 -> 0 differences).
    """
    s = re.sub(r"[\W_]+", "_", _HAN_PAD_RE.sub("", text or "").lower()).strip("_")
    return f"{prefix}_{s[:32] or 'x'}"


# --- normalization keys (feat-048) -------------------------------------------------------------
# ONE definition each, shared by llm_extract._build (within-document dedup) and _dedupe_entities
# (cross-document dedup). Do NOT inline a second copy: the two key shapes below already drifted
# apart once (people fold whitespace only, projects also fold _ and -), and a hand-copied third
# variant is how within-doc and cross-doc dedup silently start disagreeing about who is who.
#
# These key on the NAME/TITLE, never on the id: `_slug` truncates at 32 chars, so two different long
# titles can share an id — keying on the id would merge two genuinely different projects into one.

def _person_key(name: str) -> str:
    """Identity key for a person. Han padding REMOVED, then whitespace-folded, case-folded.

    THE HAN STEP IS HALF OF feat-048 ROUND 3's H2, AND IT IS WHY H2 IS NOT A ONE-REGEX FIX. Widening
    _HAN_NAME_RE to accept 「孙　浩」without this line does not merely fail to help — it MANUFACTURES a
    duplicate, which is strictly worse than the bug it fixes. Measured under exactly that naive fix:
        people == [('u_孙_浩', '孙　浩'), ('u_孙浩', '孙浩')]      # two cards, one man
    because folding \\s+ COLLAPSES a whitespace run to one space, it does not REMOVE it:
        _person_key('孙　浩') == '孙 浩'  !=  _person_key('孙浩') == '孙浩'
    Today that duplicate is invisible only because 孙　浩 is dropped by the shape rule before he can
    collide — round 2's dedup gate is passing on a corpse, so it would not have caught this either.
    Both halves have to land together; test_sun_hao_is_one_person_across_spacing_and_zh_rosters_H2
    asserts PRESENT and SINGULAR at once for that reason.

    WHY REMOVE RATHER THAN FOLD, AND ONLY BETWEEN HAN: whitespace between Han characters is COLUMN
    PADDING (U+3000 aligning 「孙　浩」against 「李明轩」), not a word separator — Chinese does not
    space words. Between Latin words it IS a separator and must stay a separator, or 'Jo Anna' and
    'Joanna' would merge into one colleague. So the removal is scoped to a space with Han on BOTH
    sides, and everything else still folds exactly as before.

    THE ENGLISH CONTRACT IS UNTOUCHED BY CONSTRUCTION, not by measurement: the substitution requires
    a Han character on either side of the whitespace, and an ASCII string has none, so the regex
    cannot match anywhere in it — 'Lena  Park' -> 'lena park', byte-for-byte as before.

    Deliberately NOT punctuation-folded (unlike _project_key): a person's name is not a slug, and
    aggressive folding starts merging people who merely look alike. Known and accepted limitation:
    two DIFFERENT colleagues who share a name (张伟, 王芳 — far likelier in Chinese than English)
    merge into one card. Splitting them needs a real identity signal (email/employee id), which lite
    does not have; name-only is the same rule llm_extract._build has always used within a document.
    """
    text = _HAN_PAD_RE.sub("", name or "")
    return re.sub(r"\s+", " ", text.lower()).strip()


def _project_key(title: str) -> str:
    """Identity key for a project. Folds whitespace AND _ / - so 'Core-Flow' == 'core flow'."""
    return re.sub(r"[\s_\-]+", " ", (title or "").lower()).strip()


def _signal_key(subject_type: str, subject_ref: str, summary: str) -> tuple[str, str, str]:
    """Identity key for a signal: a LITERAL-CLONE key, on purpose.

    SignalEntity has no count/strength/weight field, so a repeated signal cannot mean "louder" — it
    renders as two identical cards, i.e. noise. But two documents PHRASING the same risk differently
    produce different keys and both survive, which is the behaviour we want: exact clones collapse,
    genuine restatements do not. Real reinforcement ("3 docs said this") is a schema change
    (occurrences: list[str]), not a dedup rule.

    Must be computed BEFORE _link_owners rewrites subjectRef from a name to an id — extract_docs
    already orders it that way.
    """
    return (
        (subject_type or "").strip().lower(),
        (subject_ref or "").strip().lower(),
        re.sub(r"\s+", " ", (summary or "").lower()).strip(),
    )


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

# --- Chinese roster column headers (feat-049) --------------------------------------------------
# ONE LIST, TWO CONSUMERS. These words are needed in two places that must never disagree:
#   * _canon_header maps a header CELL onto the canonical key _people_from_roster looks up, so the
#     roster is read by what its header SAYS rather than by column position.
#   * _NOT_NAME (below) must contain every one of them, or the header ROW becomes a person card —
#     feat-039's "No." bug in Chinese.
# So _NOT_NAME is BUILT from this dict's keys rather than repeating them. feat-048 round 1's lesson
# was that duplicated identity/normalisation rules drift apart silently, and this pair would drift in
# both directions with nothing to notice: teaching the extractor 「岗位」without teaching the
# stop-list ships a colleague named 「岗位」; the reverse reads her column by position again.
#
# THE VALUES ARE KEYS THE EXTRACTOR ACTUALLY LOOKS UP, and that constraint is gated
# (test_the_zh_header_map_only_targets_keys_the_extractor_actually_reads_ONE_RULER). Mapping a column
# onto a key nothing reads is worse than not mapping it: the column is canonicalised into silence,
# and the next reader sees a mapping and assumes it works.
#
# THE OMISSIONS ARE THE DESIGN, so they are named rather than left to be re-derived:
#   * 负责人/負責人 is NOT here. 「负责」is what a person owns; 「负责人」is WHO owns it — a name
#     column in a roster, an owner column in a project table. Mapping it to 'owns' would file a
#     person's name as the thing she works on. It stays a plain stop-word, where it already was.
#   * 职责/職責 is NOT here, and that is symmetry rather than oversight: its ASCII sibling
#     'responsibilities' is on _NOT_NAME too but is NOT in _people_from_roster's owns lookup
#     (`owns|focus|projects`). Teaching Chinese a column English does not read would make the two
#     languages disagree about the same table. 负责 ≈ owns, 职责 ≈ responsibilities; both languages
#     read the first and neither reads the second.
#   * 入职时间/入職時間 is NOT mapped to tenure. It is a hire DATE ("2020-03-01"), while
#     PersonEntity.tenure is a duration in free text ("3 年", "joined 14 months ago"). 司龄/工龄 are
#     durations and are mapped; a date is a different fact wearing a similar hat.
# Simplified + Traditional throughout (a Sanya hotel takes HK/TW paperwork too).
_ZH_HEADER_MAP: dict[str, str] = {
    "姓名": "name", "名字": "name", "员工姓名": "name", "員工姓名": "name",
    "职位": "role", "職位": "role", "职务": "role", "職務": "role",
    "岗位": "role", "崗位": "role", "职称": "role", "職稱": "role",
    "部门": "team", "部門": "team", "团队": "team", "團隊": "team",
    "司龄": "tenure", "司齡": "tenure", "工龄": "tenure", "工齡": "tenure",
    "负责": "owns", "負責": "owns", "主要负责": "owns", "主要負責": "owns",
    "负责事项": "owns", "負責事項": "owns", "负责项目": "owns", "負責項目": "owns",
    "项目": "projects", "項目": "projects",
}

# The name-column headers, DERIVED (never hand-listed — see above). Substring-searched over the whole
# header row, which is the direct analogue of the ASCII `\bname\b` row search rather than a looser
# rule: Han has no word boundaries for `\b` to find, so 「员工姓名 | 职位」can only be reached by
# substring. It buys the same thing `\bname\b` buys for 'Full Name | Role' — the row is recognised,
# and the cell that did the recognising is canonicalised separately.
_ZH_NAME_HEADER_RE = re.compile("|".join(w for w, k in _ZH_HEADER_MAP.items() if k == "name"))

# Everything that is NOT a Han character. Used to reduce a BILINGUAL header cell (「姓名 Name」) to
# its Han half. A five-star hotel's roster copies its bilingual department signage, so 「姓名 Name |
# 职位 Title | 部门 Department」is the norm here, not a curiosity (Sanya_Bilingual_Roster.md).
# On an ASCII cell this yields "", which is why the bilingual step cannot touch English.
_NON_HAN_RE = re.compile(r"[^一-鿿]")


def _canon_header(cell: str) -> str:
    """A roster header cell -> the canonical key _people_from_roster looks up ('role', 'team', ...).

    This REPLACES the bare `c.strip().lower()` that built the header list, and on an ASCII cell it
    IS that expression, character for character — BY CONSTRUCTION, not by measurement, which is what
    lets the English contract survive a rule that changes how every roster is read:
      * every key of _ZH_HEADER_MAP is Han, so an ASCII cell can never hit the map;
      * _HAN_PAD_RE needs a Han character on BOTH sides of the whitespace (see _slug);
      * the bilingual step reduces the cell to its Han characters, which for ASCII is "" — falsy, so
        the lookup is skipped entirely rather than merely missing.
    Deliberately NO English aliases ('position' -> role, 'department' -> team). They would be an
    improvement to English behaviour, and English behaviour does not move in this round; a header
    cell the map does not know keeps passing through as its own lower-cased self, exactly as today.

    THE ASCII IDENTITY IS PROVEN, and the fuzz only corroborates the proof above:
        all 128 ASCII codepoints x 4 cell shapes (bare / embedded / doubled / padded): 0 mismatches
        fuzz vs `c.strip().lower()`, pool [A-Fa-f0-9 _-.#/], len 0..24, seed 49, n = 300,000:
            0 differences
    """
    text = _HAN_PAD_RE.sub("", (cell or "").strip())
    if text in _ZH_HEADER_MAP:
        return _ZH_HEADER_MAP[text]
    han = _NON_HAN_RE.sub("", text)
    if han and han in _ZH_HEADER_MAP:
        return _ZH_HEADER_MAP[han]
    return text.lower()


def _is_roster_header_row(row: str) -> bool:
    """Does this row NAME the columns, rather than hold a colleague?

    The ASCII branch is UNCHANGED and stays first — it is a row-level `\\bname\\b` search, loose on
    purpose ('Full Name | Role' must be recognised), and 42 features rest on exactly its behaviour.
    The Han branch is added beside it, never in place of it, and is gated on a NAME column
    specifically (not on any recognisable header word) for the same reason English is: a row of
    「项目 | 状态 | 负责人」is a project table, not a roster, and must keep falling through.
    """
    if re.search(r"\bname\b", row, re.I):
        return True
    return bool(_ZH_NAME_HEADER_RE.search(row))


# Separators inside a single roster cell that lists several things ('a; b' / 「甲、乙」).
# 、(U+3001 IDEOGRAPHIC COMMA) is the point: enumerating a list is its ONLY job in Chinese — it is
# not a sentence comma — so 「客房夜床服务复核、布草间盘点」is unambiguously two things a colleague
# owns, and the ASCII-only `[;,]` rendered it as one run-on blob on her card. ；/， are the
# full-width forms of the two separators already here, widened with them because '「a, b」 splits but
# 「a，b」does not' is a distinction with nothing behind it; ，thereby inherits `,`'s known ambiguity
# (a sentence comma is not always a separator) rather than introducing a new one.
# ON ASCII THIS IS A NO-OP BY CONSTRUCTION: the three added code points are outside ASCII, so this
# class and the old `[;,]` partition an ASCII string identically. (Corroborated, not established, by
# fuzz: pool [A-Fa-f0-9 _-.#/;,], len 0..24, seed 49, n = 300,000 -> 0 differences in split output.)
_OWNS_SPLIT_RE = re.compile(r"[;,；，、]")

# STOP words for names — header cells / labels that are not people.
#
# THIS SET IS THE SOURCE OF TRUTH FOR BOTH EXTRACTION PATHS — edit it here and nowhere else.
# The heuristic reads it via _looks_like_name/_han_name_ok; the LLM path reads it via
# llm_extract._not_a_person (with _INDEX_TOKEN_RE below, which carries 序号/编号). A word added here
# is enforced on both. feat-048's round-2 follow-up wired that up after the two lists — kept in
# sync BY HAND — drifted apart in both languages: the LLM's copy had no Chinese at all, and was also
# missing ~18 English labels this set had grown (date/dept/designation/index/manager/roster/...).
#
# feat-039 (readiness §2-G2): the heuristic used to accept "No." (a common roster INDEX column header)
# as a person, so a degraded/keyless extraction rendered a fake exec card named "No." while /health
# claimed llm. That is the bug this set was born for; the Chinese entries below are the same bug in
# the first customer's language.
_NOT_NAME = {
    "name", "role", "team", "email", "tenure", "title", "person", "people", "member", "members",
    "roster", "directory", "project", "owner", "status", "notes", "department", "manager",
    # index / numbering column headers (the "No." bug) + common label cells:
    "no.", "no", "s.no", "s.no.", "sr", "sr.", "sl", "sl.", "sn", "s/n", "id", "index", "seq", "#",
    "background", "responsibilities", "current responsibilities", "profile", "total", "designation",
    "dept", "dept.", "date", "phone", "n/a", "na", "none", "unknown", "tbd",
    # feat-048 round 2 — the SAME stop-list in Chinese, and it is load-bearing rather than
    # decorative. Once _looks_like_name accepts Han (below), a Chinese roster's header row is
    # indistinguishable from its name column BY SHAPE: 「姓名」is exactly two Han characters and so
    # is the real colleague 「孙浩」, so no length/charset rule can separate them — only this list
    # can. Without it, widening for Han re-creates feat-039's "No." bug in Chinese and ships a
    # colleague called 「姓名」.
    #
    # THE COLUMN HEADERS THEMSELVES ARE NO LONGER LISTED HERE — they are folded in from
    # _ZH_HEADER_MAP at the bottom of this literal, because feat-049 needs the same words to also map
    # a header cell onto a canonical key, and two hand-kept copies of one list is the drift feat-048
    # round 1 already paid for. What stays below is everything that is a Chinese label but NOT a
    # mappable column: 负责人 (a name, not a thing owned), contact/index columns nothing reads, and
    # the summary/placeholder cells.
    #
    # HISTORICAL NOTE, because it was true for two rounds and is now false: this list used to be the
    # heuristic's ONLY defence against a Chinese header row, since _people_from_roster built its
    # `header` list only when row 0 matched `\bname\b` (ASCII) and so never ran its
    # `cells[0] in _NOT_NAME` guard on a Chinese document. feat-049 taught the header detector Han
    # (_is_roster_header_row), so that structural guard is live again and this list is now the
    # SECOND of two defences rather than the only one. It is not thereby less important: the guard
    # only fires on row 0 of a table, while _looks_like_name is what protects every other line of
    # every other document (banners, resume headers — see the round-3 block below).
    # Simplified + Traditional (a Sanya hotel takes HK/TW paperwork too); .lower() is a no-op on Han.
    "负责人", "負責人", "工号", "工號", "邮箱",
    "郵箱", "电话", "電話", "手机", "手機", "状态", "狀態", "备注", "備註",
    "日期", "入职", "入職", "入职时间", "入職時間", "性别", "性別", "年龄", "年齡", "合计", "合計",
    "总计", "總計", "小计", "小計", "未知", "无", "無", "暂无", "暫無", "待定", "其他", "简历",
    "履历", "履歷", "个人简历", "個人履歷", "职责", "職責", "主要职责", "主要職責",
    # feat-048 round 3 (H5b) — DOCUMENT BANNERS, not column headers. Round 2 populated the list
    # above from a ROSTER's header row and stopped there; the string that actually leads a Chinese
    # document is the confidentiality banner, and it is 4 Han characters, so the shape rule accepts
    # it as a name. Measured on round-2 code: _looks_like_name('内部资料') is True, and
    # Zhang_Wei_Resume_ZH.md ingested as people == [('u_内部资料', '内部资料')] — 张伟 the 餐饮总监
    # replaced by a colleague called "Internal Material". That is feat-039's "No." bug reborn in
    # Chinese, INSIDE the rule round 2 added to prevent it: _people_from_resume scans the first six
    # lines and takes the first name-shaped thing, and the banner leads the file.
    # Reachability is layout-dependent (the banner must stand ALONE on a line; written inline as
    # 「… · 内部资料 · 请勿外传」 the interpunct is not in _people_from_resume's split set, so the whole
    # line is tested as one string and fails the shape rule harmlessly) — but the over-acceptance
    # itself is unconditional, and a banner line followed by a blank is ordinary ZH typography.
    "内部资料", "內部資料", "请勿外传", "請勿外傳", "机密文件", "機密文件", "机密", "機密",
    "绝密", "絕密", "秘密", "保密", "内部文件", "內部文件", "内部", "內部", "制表说明", "製表說明",
    "制表", "製表", "制表人", "製表人", "填表说明", "填表說明", "注意事项", "注意事項",
    "免责声明", "免責聲明", "版权所有", "版權所有", "仅供参考", "僅供參考", "草稿", "附件",
} | set(_ZH_HEADER_MAP)   # feat-049: ONE list — see _ZH_HEADER_MAP. Never re-type these by hand.

# A real Chinese personal name, SEGMENT-WISE: runs of Han separated by optional internal whitespace
# ('孙　浩' / '欧阳　菲'). This does NOT try to be a name ORACLE: length is provably not one
# (「姓名」== 2 chars == 「孙浩」), so _NOT_NAME above is what actually separates a colleague from a
# label, and this only says "the right shape".
#
# WHY SEGMENT-WISE AND NOT `^[一-鿿\s]{2,5}$` (feat-048 round 3, H2) — the obvious one-character edit
# is BOTH unsafe and a non-fix, measured both ways:
#   * Non-fix: whitespace eats the length budget, so 「欧阳　菲」(5 chars incl. the space) stays
#     rejected — the very compound-surname case H2 is about.
#   * Unsafe at any budget: it says nothing about WHERE the space is, so it would admit any
#     Han/space soup that fits.
# The segments are what carry the rule, because each one can be checked against _NOT_NAME
# independently — which is the ONLY thing that keeps 「姓名 职位」out (see _looks_like_name).
#
# U+3000 IS THE POINT, NOT A TYPO. Padding a two-character name with an IDEOGRAPHIC SPACE to align it
# against a three-character name in the same column is standard Chinese roster typography. Round 2
# unified the identity ruler on _person_key (which folds \s+) and justified that work with exactly
# this convention — then shipped `^[一-鿿]{2,4}$`, which forbids internal whitespace and threw those
# names away at the door, so the ruler it was unified with was never reached. Both fixes were in the
# tree; the path they shared was dead. `\s` and str.split() are unicode-aware on str patterns, so
# both U+3000 and U+0020 are handled, and U+3000 is NOT inside [一-鿿] (verified).
_HAN_SEG = "[一-鿿]"
_HAN_NAME_RE = re.compile(rf"^{_HAN_SEG}{{1,5}}(?:\s+{_HAN_SEG}{{1,5}})*$")

# Han characters in a personal name, ignoring padding. 2 = 孙浩; 5 = 买买提艾力 (feat-048 round 3,
# H5): Uyghur/Mongolian/Kazakh transliterated names run to five Han characters as a matter of course
# and are ordinary Chinese citizens' legal names. Round 2's {2,4} dropped them.
_HAN_NAME_MIN, _HAN_NAME_MAX = 2, 5

# Function words — particles, adverbs, negations. THE discriminator that lets the bound move to 5.
#
# Length ALONE cannot go to 5: measured, `{2,5}` turns 「本周很顺利」/「项目已完成」/「大家辛苦了」/
# 「这周没问题」into colleagues. What separates those from 「买买提艾力」is not length but that each
# carries a function word (很/已/了/没), and Chinese personal names do not contain function words.
#
# EVERY ENTRY IS CHECKED AGAINST 百家姓 AND AGAINST GIVEN-NAME USE — a function word that is also a
# surname (or an ordinary given-name morpheme) would reject a REAL name, which is the one failure
# this list must not have, and it fails SILENTLY: the colleague is simply never extracted. So the
# list stays SHORT and boring rather than thorough. Deliberately EXCLUDED after checking:
#   于 (于洋), 和 (和平), 过, 都, 是, 太, 尚 (尚雯婕) — all real, if sometimes rare, SURNAMES.
#   其 (陈其美), 又, 更, 最, 每, 此, 该, 仍 — used, or plausibly used, as GIVEN-name morphemes.
# The four the fixtures actually turn on are 很/已/了/没; the rest are close cousins with the same
# non-name character. When in doubt an entry was LEFT OUT: a missed phrase is bounded by position
# (below), while a rejected name is a person who vanishes.
#
# THIS IS NOT A COMPLETE ORACLE AND IS NOT CLAIMED AS ONE. A 5-character function-word-free noun
# phrase — 「宴会动线图」— is NOT distinguishable from 「买买提艾力」by any rule at this layer: both are
# five content morphemes, and a 百家姓 gate fails too (买 is a rare surname, but 买买提 is phonetic
# Uyghur, not a Han surname, so the gate would reject the real name it exists to admit). No fixture
# asserts 「宴会动线图」, because a gate no honest rule can satisfy gets weakened later, and a weakened
# gate is worse than an absent one. The residual is bounded by POSITION, not shape: _looks_like_name
# only ever sees a table row's cells[0] and a resume's first six lines.
_HAN_FUNCTION_WORDS = frozenset("很已了没不也就还的地着请勿别")

# A bare index/numbering token ("No.", "S.No", "序号", "编号", "#3") is never a person.
_INDEX_TOKEN_RE = re.compile(r"^(?:no|s\.?\s*no|sl|sr|sn|seq|id|#\d*|序号|编号|序號|編號)\.?$", re.I)


def _han_name_ok(token: str) -> bool:
    """Does a Han-shaped token (already matched by _HAN_NAME_RE) read as a PERSON?

    Three tests, and the ORDER of the first two is the same design as _looks_like_name's: the
    stop-list decides, the shape rule only proposes.

      1. EVERY SEGMENT against _NOT_NAME — this is what makes internal whitespace safe to allow.
         A SPACED header PAIR is a string no upstream guard can catch: _people_from_roster's
         `cells[0] in _NOT_NAME` guard tests the whole cell, and 「姓名 职位」is not on the list (nor
         is its concatenation 「姓名职位」) — only the per-segment test below rejects it. Measured:
         without this, 「姓名 职位」/「部门 司龄」/「职位 部门」/「姓名 部门 司龄」all become colleagues
         and the roster grows a teammate called 「姓名 职位」. Per-SEGMENT is what closes it, and it
         closes it by rule rather than by example.
      2. The de-padded whole against _NOT_NAME, so a padded label 「姓　名」cannot slip past (1) by
         splitting a listed word in half.
      3. Function words (see _HAN_FUNCTION_WORDS) — what permits the length bound to reach 5 for
         「买买提艾力」without 「本周很顺利」coming with it.
    """
    segments = token.split()
    if any(s.lower() in _NOT_NAME for s in segments):
        return False
    bare = "".join(segments)
    if bare.lower() in _NOT_NAME:
        return False
    if not _HAN_NAME_MIN <= len(bare) <= _HAN_NAME_MAX:
        return False
    return not any(ch in _HAN_FUNCTION_WORDS for ch in bare)


def _looks_like_name(token: str) -> bool:
    """Is this cell a person, or is it a header/label? (feat-048 BUG-3.)

    THE STOP-LISTS RUN FIRST, AND THAT ORDER IS THE WHOLE DESIGN. Both shape rules below are
    permissive by construction, so 「姓名」/"No." are rejected because they are ON THE LIST, never
    because of their shape. Reversing the order, or reaching for a shape rule clever enough to
    exclude headers, is how the "No." bug (feat-039) and its Chinese twin get shipped.
    """
    token = token.strip()
    if not token or token.lower() in _NOT_NAME or _INDEX_TOKEN_RE.match(token):
        return False
    # Han names. Before feat-048 no Han name could reach here at all — the ASCII-uppercase rule below
    # rejected all of them, so a degraded/offline ingest handed the (all-Chinese) first customer an
    # empty team page. (feat-049 note: _NOT_NAME's Chinese column headers are now folded in from
    # _ZH_HEADER_MAP, so a word taught to the header mapper is rejected here automatically — one
    # list, two consumers. See _ZH_HEADER_MAP.)
    if _HAN_NAME_RE.match(token):
        return _han_name_ok(token)
    # 1-3 capitalized words, letters/space/dot/hyphen only. UNCHANGED — the English contract.
    return bool(re.match(r"^[A-Z][A-Za-z.\-]+(?: [A-Z][A-Za-z.\-]+){0,2}$", token))


_TEAM_ALIASES = {"engineering": "Eng", "design": "Design", "product": "Product",
                 "gtm": "GTM", "sales": "GTM", "go-to-market": "GTM", "operations": "Ops",
                 "ops": "Ops", "founder": "Founders", "founders": "Founders"}


def _norm_team(raw: str) -> str:
    """Map a stated team/department onto TEAMS where that is honest, and PASS IT THROUGH where it
    is not (feat-048 BUG-4). Two defects lived in the six lines this replaces:

      1. `for t in TEAMS: if raw in t.lower(): return t` — THE EMPTY STRING IS A SUBSTRING OF EVERY
         STRING, so _norm_team("") / ("  ") / (None) all returned TEAMS[0] == "Founders". A blank
         cell was silently promoted to the single most consequential bucket available: the owners.
      2. TEAMS is a STARTUP taxonomy. No real hotel department maps onto it, so 前厅部/客房部/餐饮部/
         市场推广部/销售部 all normalized to "" — and then, via (1), to "Founders". Observed on the
         real machine: 「陈思雨 项目负责人 · Founders」— a Sanya hotel's sales lead filed as a founder.

    PASS-THROUGH IS THE DESIGN CALL, and it is checked rather than assumed:
      * The consumer types team as FREE TEXT (src/lite2/teamData.ts:21 `team?: string`) and
        src/lite2/teamGroups.ts groups by that raw string and renders it AS the group title — so
        pass-through is what puts a 「前厅部」group on the page.
      * The strict `'Founders'|'Eng'|...` union lives only in src/story/data/fixtures.ts, the old
        demo app, which does not consume ingest output. The comment at the top of this file
        ("Teams mirror the frontend Person['team'] union") is a fossil of that.
      * The frontend already eats non-TEAMS values daily: the stub transports ship 'Engineering',
        'Operations', 'Sales'.
      * PASS-THROUGH MAKES `team` FREE TEXT, SO THE RED LINE MUST SCAN IT — and as of round 3 it
        does (`redline_extract._person_text_fields` includes `p.team`). Round 2 shipped this bullet
        asserting the exact opposite ("team is NOT part of the red line's scan surface ... so
        pass-through cannot smuggle text past that gate"). That was a correct observation wired to
        an inverted conclusion: not-scanned is not a defence, it is the hole, and it was THE hole —
        a roster with the performance column pasted into the department column built a context with
        ok=True. Pass-through is only safe BECAUSE the scan surface now follows the free text.
    The alternative — squeezing an unmappable department into the nearest bucket — would file
    前厅部/客房部/餐饮部 all under 'Ops': three real departments rendered as one group. That is the
    same information loss as the bug, only tidier.

    This DOES change English output for values TEAMS/aliases cannot express ('Growth', 'Marketing':
    "" -> themselves), and that is deliberate — an English startup's Growth team has no more
    business being dropped on the floor than 前厅部 does. The iron "English must not change" rule is
    about _slug's ids byte-for-byte and about the team values the real English corpus contains
    (Team_Roster.xlsx ships 'Design' and 'Eng'); every mapping the code already gets right is frozen
    in test_norm_team_english_mapping_is_frozen_BUG4.
    """
    text = (raw or "").strip()
    if not text:
        # Unknown is UNKNOWN — exactly what PersonEntity.team already documents ('"" if unknown —
        # never guessed hard'). This early return is what kills defect (1) at the root.
        return ""
    low = text.lower()
    for t in TEAMS:
        # WHOLE WORD, not substring (feat-048 round 3, H3). Round 2 killed the REVERSE direction of
        # this match (`raw in t.lower()`, where "" is a substring of every bucket -> Founders) and
        # kept the FORWARD direction on purpose. Both directions are the SAME BUG CLASS, and the
        # forward one bites a real customer: 'Eng' is a substring of 'Guest ENGagement', so a
        # bilingual five-star hotel's guest-relations department was filed under Engineering — a
        # department the hotel does not have. Measured before this line:
        #     _norm_team('Guest Engagement 宾客关系部') == 'Eng'
        #     _norm_team('Engagement Team')            == 'Eng'
        # `\b` is what separates the accidental match from the honest one: 'Design Team' still maps
        # to Design (design is a WORD there), while 'Engagement' no longer donates its first three
        # letters to Eng. Han is \w, so 'Eng宾客' has no boundary either and correctly does not match.
        #
        # THE ENGLISH SURFACE IS MOSTLY NOT HELD UP BY THIS LOOP — worth knowing before trusting the
        # freeze list. 'Engineering' -> 'Eng' does NOT survive via this loop (there is no word break
        # inside 'engineering'); it falls through to _TEAM_ALIASES below, which is what has always
        # mapped it. Of the frozen English mappings only 'Design'/'Design Team'/'Eng'/'Product'/
        # 'GTM'/'Ops'/'Founders' come through here. Verified against every team value the real corpus
        # and both stub transports actually emit (Design/design/Operations/Product/product/Marketing/
        # Growth/GTM/Engineering): all unchanged.
        if re.search(rf"\b{re.escape(t.lower())}\b", low):
            return t
    if low in _TEAM_ALIASES:
        return _TEAM_ALIASES[low]
    # Unmappable but STATED: the document knows something the taxonomy cannot express. Keep it.
    return text


# Chinese status vocabulary. THE ENGLISH-ONLY VERSION OF THIS FUNCTION COLLAPSED THE WHOLE
# GRADING LADDER ON CHINESE DOCUMENTS (feat-056 review, finding 2). Two of the three companies
# in this wave hand us Chinese weekly reports, where 「状态：进行中」 is the normal way to write
# it. Every one of those normalised to "" and two things followed downstream:
#   1. decision_grading's can_proceed rules (_m_done / _m_clear) BOTH require a normalised English
#      status, so no project in a Chinese-only document could ever reach 可推进 — the three-tier
#      ladder silently collapsed to two, which is precisely the partner-parity target we were
#      aligning to.
#   2. the project fell through to the no-evidence rule, whose reason text told the manager the
#      document never stated a status — while his own report says 进行中 in plain sight.
# Chinese has no word boundaries, so these are substring matches; the negative lookbehinds are
# what keep 未完成 / 没完成 / 待完成 out of "done" and 无风险 / 没风险 out of "at-risk".
# 🔴 Precedence is deliberately risk-first (blocked > at-risk > done > on-track), matching the
# English arm: when a line supports two readings, take the one that gets the project LOOKED AT.
_ZH_BLOCKED = r"受阻|已阻断|阻塞|卡住|停滞|停工|中止|搁置|无法推进|推不动"
_ZH_AT_RISK = r"(?<![无没])风险|延期|逾期|滞后|落后|推迟|拖期|告急|吃紧|超期"
_ZH_DONE = r"(?<![未没待])完成|已交付|已上线|已结项|已验收|验收通过"
_ZH_ON_TRACK = r"进行中|推进中|(?<![不异])正常|按计划|如期|顺利|在轨"


def _norm_status(text: str, *, risk_only: bool = False) -> str:
    """Normalize a stated status onto on-track|at-risk|blocked|done, or '' when the document does not
    state one we can read honestly.

    The Chinese vocabulary is PURELY ADDITIVE — every ASCII branch below is untouched and runs
    first, so English output cannot move.

    `risk_only=True` suppresses the two POSITIVE readings. It is for the whole-document fallback
    (no 'Status:' line anywhere, so we are scanning prose). Downgrading a project on prose is not
    symmetric with escalating it: the grading rules require an EXPLICIT positive self-report to
    hand out 可推进, and the word 正常 happening to appear somewhere in a weekly report is not that
    project stating it is fine. Reading risk out of prose stays on, because there the bias points
    at getting a second look.

    ONE WORD IS DELIBERATELY LEFT UNMAPPED: 「待确认」 (pending confirmation), which the first
    customer's weekly uses for two of its six projects. It is tempting to call it at-risk, and that
    would be INVENTING RISK: "nobody has confirmed this yet" is not "this is in trouble", and
    at-risk is the status that drives「多看一眼」surfacing. A false alarm in front of a paying
    customer costs more than an honest blank. So 待确认 returns '' HERE.

    WHAT THE CARD ACTUALLY SHOWS IS NOT '' — and this docstring used to claim it was. Returning ''
    hands the decision to `_project_from_span`, which then sniffs the project's own block for a
    status (extract.py, `if not status:`). On the first customer's weekly that sniff finds real
    blocker lines — 「佣金测算 — 受阻」, 「…卡住」 — inside the very blocks that self-report 待确认,
    so 「销售绩效与佣金方案」 and 「新人带教与团队士气」 render BLOCKED, which is heavier than the
    at-risk this function refused to assign. The inference is documented and line-citable, not
    invented, so it stands for now; but the outcome is a product call, not a settled one, and the
    contradiction is recorded here rather than papered over. See
    test_pending_confirmation_falls_through_to_block_level_inference for the end-to-end behaviour
    this actually produces.
    """
    t = text.lower()
    if re.search(r"\bblocked\b", t) or re.search(_ZH_BLOCKED, t):
        return "blocked"
    if re.search(r"\bat[\s-]?risk\b|behind|slipping|delayed", t) or re.search(_ZH_AT_RISK, t):
        return "at-risk"
    if risk_only:
        return ""
    if re.search(r"\b(done|shipped|complete|launched)\b", t) or re.search(_ZH_DONE, t):
        return "done"
    if re.search(r"\bon[\s-]?track\b|on schedule", t) or re.search(_ZH_ON_TRACK, t):
        return "on-track"
    # 054 and 056 each grew a Chinese ladder independently and the merge stacked them. The second
    # one is DELETED, not kept "for safety": it ran after this point with NO negative lookbehinds,
    # so 「无风险」 matched 风险 → at-risk and 「未完成」 matched 完成 → done. Every word it carried
    # is covered above (受阻 / 已阻断 were the only two missing and are now in _ZH_BLOCKED), and
    # the surviving ladder is the one that reads negation correctly.
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
        """Roster/CSV: 'Name | Role | Team | Tenure' style rows -> PersonEntity per row.

        THE HEADER ROW IS READ IN BOTH LANGUAGES (feat-049). Until then, `header` was built only when
        row 0 matched `\\bname\\b` — ASCII — so on the first customer's roster, whose header row reads
        「姓名 | 职位 | 部门 | 司龄 | 负责」, `header` stayed [] and three things followed:

          1. `col.get("owns")` was always None and owns has NO positional fallback, so the 「负责」
             column was never read: every Chinese colleague got owns=[]. That is not a missing field,
             it is the BODY of the person card — role/team/tenure are one header line and `owns` is
             everything under it. The degraded path handed a Sanya manager a team page of names with
             nothing beneath them.
          2. The `if header and cells[0] in _NOT_NAME` guard below never ran on a Chinese document.
             feat-048 round 2 moved that load onto _looks_like_name's stop-list, which works — but the
             structural guard was dead, and it is live again now.
          3. role/team/tenure survived only POSITIONALLY (cells[1]/cells[2]/cells[3]), so a roster
             whose columns are in a different order was SILENTLY mis-filed. Measured, on a real HR
             export ordered 姓名|部门|职位: 郑海燕 came out with role='客房部' (her department, as her
             job title) and team='客房部经理' (her job title, as her department — rendered as the
             heading of a department group that does not exist). Nothing reported it; the card was
             confidently wrong.

        The positional fallbacks BELOW ARE KEPT, and only their reachability changes: they are what a
        headerless table still runs on, and on a table WITH a header they are inert for any column
        the header names (col[k] and cells[n] are the same cell). They are not a second opinion — the
        header wins wherever it speaks.
        """
        res = ExtractionResult()
        rows = [ln for ln in doc.lines if "|" in ln]
        header: list[str] = []
        if rows and _is_roster_header_row(rows[0]):
            header = [_canon_header(c) for c in rows[0].split("|")]
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
                owns = [o.strip() for o in _OWNS_SPLIT_RE.split(owns_val) if o.strip()]
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
        """Project weekly / roadmap -> ONE ProjectEntity PER PROJECT THE DOCUMENT LABELS.

        feat-054 / H4 LAYER A — THE STRUCTURAL FIX. This function used to accumulate title / owner /
        status / progress into SCALAR locals across the whole document and append a single entity at
        the end, so every project but the last was overwritten in place. One document == one project,
        by construction, since the function was written. It was invisible in every ASCII fixture only
        because none of them had two projects in one file; a pure-English document with two
        `Project:` lines lost the first one exactly the same way (see test_zh_project_axis_gap.py).

        Now the document is SEGMENTED at its own project labels (`granularity.segment_projects`) and
        each span is scanned independently, so six projects come back as six.

        WHY A SINGLE BLOCK STILL SCANS THE WHOLE DOCUMENT: when a document labels exactly one
        project, the doc-per-project assumption is simply TRUE for it, and scanning the whole file
        keeps every pre-054 English fixture byte-identical — fields stated in a preamble above the
        `Project:` line (a `#` heading, a `Summary:`, a trailing blocker paragraph) are still picked
        up as they always were. Scoping only kicks in where it is the fix: 2+ labelled projects.
        A document with NO project label keeps the old heading/filename-titled single entity.
        """
        blocks = segment_projects(doc)
        res = ExtractionResult()
        if len(blocks) <= 1:
            spans: list[tuple[str, int, int]] = [
                (blocks[0].title if blocks else "", 0, len(doc.lines))]
        else:
            spans = [(b.title, b.start, b.end) for b in blocks]
        for labelled_title, lo, hi in spans:
            res.projects.append(self._project_from_span(doc, labelled_title, lo, hi,
                                                        whole_doc=len(blocks) <= 1))
        return res

    def _project_from_span(self, doc: ParsedDoc, labelled_title: str, lo: int, hi: int,
                           whole_doc: bool) -> ProjectEntity:
        """Read one project's fields out of one span of lines. Labels are read in BOTH languages
        (feat-054 / H4 LAYER B): 「负责人：/自报状态：/进度：/截止：/进展摘要：/阻碍项：」 next to the
        ASCII forms, so the first customer's weekly stops coming back blank-owned and blank-status."""
        title = labelled_title
        owner = ""
        status = ""
        progress: int | None = None
        summary = ""
        due = ""
        blockers: list[str] = []
        for i in range(lo, min(hi, len(doc.lines))):
            s = doc.lines[i].strip()
            m = re.match(r"^#+\s*(.+)$", s)
            if m and not title:
                title = m.group(1).strip()
                continue
            m = re.match(r"^(project|title)\s*[:\-]\s*(.+)$", s, re.I)
            if m:
                title = m.group(2).strip()
            m = re.match(r"^(?:项目|专案|课题|工程)\s*[0-9０-９一二三四五六七八九十]*\s*[：:]\s*(.+)$", s)
            if m:
                title = m.group(1).strip()
            m = re.match(r"^(owner|lead|dri)\s*[:\-]\s*(.+)$", s, re.I)
            if m:
                owner = m.group(2).strip()
            # The Chinese label lines. 054 and 056 each grew their own set independently; this is
            # the UNION of both vocabularies. They stay separate patterns rather than extra
            # alternatives bolted onto the English ones, because they REQUIRE a colon:
            # 「截止」「负责」 are ordinary words that start ordinary sentences, and an optional
            # separator would let 「截止到目前为止…」 be read as a due date. The English arms keep
            # their optional separator so nothing about their behaviour changes.
            m = re.match(r"^(?:负责人|主负责人|项目负责人|责任人|牵头人|负责)\s*[:：]\s*(.+)$", s)
            if m:
                owner = m.group(1).strip()
            m = re.match(r"^status\s*[:\-]\s*(.+)$", s, re.I)
            if m:
                status = _norm_status(m.group(1)) or status
            # 状态 / 进展 + colon: the Chinese label line. Without it the only thing that could
            # see 「状态：进行中」 was the whole-document fallback below, which is risk_only and so
            # can never return the positive reading the line actually states.
            m = re.match(r"^(?:自报状态|当前状态|项目状态|状态|进展)\s*[:：]\s*(.+)$", s)
            if m:
                status = _norm_status(m.group(1)) or status
            m = re.search(r"\bprogress\s*[:\-]?\s*(\d{1,3})\s*%", s, re.I)
            if m:
                progress = max(0, min(100, int(m.group(1))))
            m = re.match(r"^(?:进度|完成度|完成率)\s*[:：]?\s*(\d{1,3})\s*%", s)
            if m:
                progress = max(0, min(100, int(m.group(1))))
            m = re.match(r"^(due|deadline|ship(?:s|ping)?)\s*[:\-]?\s*(.+)$", s, re.I)
            if m:
                due = m.group(2).strip()
            m = re.match(r"^(?:截止/关键节点|截止日?期?|到期日?|交付日期|关键节点|上线时间|完成时间)"
                         r"\s*[:：]\s*(.+)$", s)
            if m:
                due = m.group(1).strip()
            m = re.match(r"^(summary|overview|goal)\s*[:\-]\s*(.+)$", s, re.I)
            if m and not summary:
                summary = m.group(2).strip()
            m = re.match(r"^(?:进展摘要|摘要|概述|目标|简述)\s*[：:]\s*(.+)$", s)
            if m and not summary:
                summary = m.group(1).strip()
            m = re.match(r"^(?:阻碍项|阻碍|阻塞|卡点|风险点)\s*[：:]\s*(.+)$", s)
            if m:
                blockers.append(m.group(1).strip()[:180])
                continue
            if re.search(r"\b(blocker|blocked|waiting on|stuck|unresolved|no sign-?off|"
                         r"acceptance (?:not|un)|not defined)\b", s, re.I):
                blockers.append(s.lstrip("-*• ").strip()[:180])
        if not title:
            title = re.sub(r"\.[a-z0-9]+$", "", doc.name).replace("_", " ").strip()
        if not status:
            # Two independent guards on the same fallback, one from each line — both kept:
            # 054: sniffing the WHOLE document for a status only makes sense when the document is
            #      about one project; across a segmented weekly it would smear project 3's
            #      「受阻」 onto all six. So scope the sniff to this project's own span.
            # 056: risk_only, because this is PROSE, not a self-report. Escalating on prose is
            #      fine (bias points at a second look); handing out 可推进 because the word 正常
            #      happens to appear somewhere in the weekly is not.
            status = _norm_status(doc.text if whole_doc
                                  else "\n".join(doc.lines[lo:min(hi, len(doc.lines))]),
                                  risk_only=True)
        if not summary:
            first = next((doc.lines[i].strip() for i in range(lo, min(hi, len(doc.lines)))
                          if doc.lines[i].strip() and not doc.lines[i].strip().startswith("#")), "")
            summary = first[:200]
        return ProjectEntity(
            id=_slug(title, "p"), title=title, ownerName=owner, status=status, progress=progress,
            dueDate=due, summary=summary, blockers=blockers[:6], source=f"{doc.name}:{lo + 1}")

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

    # feat-054 — THE GRANULARITY GATE, before dedup on purpose: a milestone is judged against the
    # document that nested it, and after dedup that provenance is already merged away. Every
    # decision (kept and demoted alike) is recorded on the result so "why isn't this a project?"
    # has an answer that cites the document rather than a threshold.
    out.granularity = apply_gate(out, docs)

    _dedupe_entities(out)
    _link_owners(out)
    return out


def _dedupe_entities(res: ExtractionResult) -> None:
    """Collapse the SAME person/project seen in DIFFERENT documents into one record (feat-048).

    WHY HERE AND NOT IN `merge()`: merge() is also called 5x inside HeuristicExtractor.extract
    (above) to fold together disjoint categories of a SINGLE doc, where dedup is a no-op. Teaching
    merge() to dedup would overload "concatenate two partial results" with "reconcile identities
    across sources" — and would silently start dropping data the day someone adds a second
    people-producing branch to extract(). merge() stays a pure concat; identity reconciliation is
    one explicit pass over the finished corpus. (Same shape as materialize_memory, which likewise
    dedups at its own boundary rather than upstream.)

    WHY BEFORE `_link_owners`: _link_owners builds `by_name` as a dict, so it is last-wins — with
    duplicates present it can resolve an owner to whichever copy happened to land last. Dedup first,
    then link, and the two agree by construction.

    MERGE-ENRICH, NOT KEEP-FIRST — this is the load-bearing choice, and it is measured, not assumed.
    Sources are complementary by nature: a roster carries IDENTITY (role/team/tenure) and no
    ownership; a weekly/resume carries BEHAVIOUR (owns/status/blockers) and no identity. NEITHER
    RECORD IS COMPLETE. The English fixtures prove it independently of any CJK concern — Lena Park
    arrives twice, once as (team='Design', owns=0) and once as (team='', owns=3). keep-first drops
    the 3 things she owns (the entire body of her card); keep-last drops her team. Only enrichment
    yields the person who actually exists. It is also exactly what llm_extract._build already does
    across windows WITHIN a document ("same person across windows: enrich, don't duplicate") — this
    extends that established rule across documents rather than inventing a second one.

    "First non-empty wins" means INPUT ORDER decides when two docs both state a scalar. Lite does not
    parse document dates, so a stale progress from last week's report can beat this week's if it is
    uploaded first. Known limitation, recorded in the gate; fixing it needs doc recency, not a
    different dedup rule.

    MATERIALS ARE NEVER TOUCHED. Their ids are already `<doc>:<line>` (globally unique, so id-dedup
    is a no-op) and text-dedup is pure damage: the same line in two documents is two independently
    citable pieces of evidence. Chinese documents repeat headers/footers/disclaimers across files as
    a matter of course — text-dedup would delete that corpus from every file but the first, break
    the cite chain to the rest, and make registry.py's `_chunks_per_file` under-report chunk counts.
    """
    # people — enrich into the first record, preserving first-seen order
    people: dict[str, PersonEntity] = {}
    for p in res.people:
        key = _person_key(p.name)
        cur = people.get(key)
        if cur is None:
            people[key] = p
            continue
        cur.role = cur.role or p.role
        cur.team = cur.team or p.team
        cur.tenure = cur.tenure or p.tenure
        cur.source = cur.source or p.source
        # union, order-preserving, capped at the same 6 _slist/_build use
        cur.owns = (cur.owns + [o for o in p.owns if o and o not in cur.owns])[:6]
        cur.collaboration = (
            cur.collaboration + [c for c in p.collaboration if c and c not in cur.collaboration]
        )[:6]
    res.people = list(people.values())

    # projects — same rule; blockers/dependsOn union because two docs list complementary ones
    projects: dict[str, ProjectEntity] = {}
    for pr in res.projects:
        key = _project_key(pr.title)
        cur = projects.get(key)
        if cur is None:
            projects[key] = pr
            continue
        cur.ownerId = cur.ownerId or pr.ownerId
        cur.ownerName = cur.ownerName or pr.ownerName
        cur.status = cur.status or pr.status
        cur.dueDate = cur.dueDate or pr.dueDate
        cur.summary = cur.summary or pr.summary
        cur.source = cur.source or pr.source
        if cur.progress is None:
            cur.progress = pr.progress
        cur.blockers = (cur.blockers + [b for b in pr.blockers if b and b not in cur.blockers])[:6]
        cur.dependsOn = (
            cur.dependsOn + [d for d in pr.dependsOn if d and d not in cur.dependsOn]
        )[:6]
    res.projects = list(projects.values())

    # signals — keep-first on literal clones only (see _signal_key); never enriched
    seen_signals: set[tuple[str, str, str]] = set()
    kept: list[SignalEntity] = []
    for s in res.signals:
        key = _signal_key(s.subjectType, s.subjectRef, s.summary)
        if key in seen_signals:
            continue
        seen_signals.add(key)
        kept.append(s)
    res.signals = kept

    # res.materials: INTENTIONALLY UNTOUCHED — see the docstring.


def _link_owners(res: ExtractionResult) -> None:
    """Best-effort: match a project's ownerName to an extracted person's id (Your-team wiring).

    ONE RULER (feat-048 round 2). `by_name` is built with `_person_key` — the SAME function
    _dedupe_entities uses to decide "same person". It used to fold nothing (`p.name.lower()`) while
    dedup folded whitespace, and two rulers for one identity is a silent data-loss bug:
    _dedupe_entities merges 「孙　浩」(U+3000 — the standard way a Chinese roster pads a two-character
    name into a three-character column) with 「孙 浩」and keeps the FIRST spelling, so by_name held
    only 「孙　浩」while the signal still pointed at 「孙 浩」. Miss. And a missed lookup here is
    SILENT: subjectRef just stays a name, the signal never reaches the person's card, and nothing
    reports it. Projects survived on luck (the first-name fallback below); signals have no fallback.
    """
    by_name = {_person_key(p.name): p.id for p in res.people}
    for proj in res.projects:
        if proj.ownerName and not proj.ownerId:
            key = _person_key(proj.ownerName)
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
            key = _person_key(sig.subjectRef)
            if key in by_name:
                sig.subjectRef = by_name[key]
