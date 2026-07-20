"""H4 LAYER A, THE SECOND HALF: a project label wearing MARKDOWN MARKUP.

WHAT feat-054 ACTUALLY CLOSED, AND WHAT IT DID NOT. feat-054 fixed the structural half of LAYER A —
`_projects_from_doc` no longer sweeps a whole document into scalar locals — and
test_zh_project_axis_gap.py records that as closed. It is closed ONLY FOR A LABEL THAT LEADS ITS
LINE. Every structural label in `granularity` is anchored at `^`, so the anchor was reading the
MARKUP rather than the label, and the pre-054 whole-document sweep stayed reachable through it.

MEASURED ON THE REAL MACHINE (2026-07-18, AVERY_BRAIN=stub, POST /ingest), on a three-project ZH
weekly whose projects are written the ordinary markdown way, 「## 项目：」:

    projects == 1
      title     '三亚鹿山雅居 · 周报 W29'   <- the DOCUMENT's own heading
      ownerName '吴桂芳'                    <- project 3's owner
      status    'blocked'                   <- project 3's status
      progress  30                          <- project 2's progress

SO IT IS NOT "ONE PROJECT INSTEAD OF THREE". The survivor is a SMEAR: one card, named after the
file, carrying three different projects' fields. That is the failure mode H4 called worse than an
empty screen — a manager reads a populated project screen and nothing about it says it is wrong.

AND IT DEFEATS THE GATE'S OWN PHANTOM DEFENCE. `R4-document-not-project` exists precisely to drop a
card named after its document, but it only fires when nothing is tracked — and the smear FILLS
owner/status/progress, so `_tracked_fields` is non-empty and `R0-tracked` keeps the phantom while
citing the very fields it was smeared from. Measured ruling, before the fix:

    R0-tracked · 「三亚鹿山雅居 · 周报 W29」→ project：文档单独跟进…，给出了负责人、状态、进度

NOT A CJK BUG — same as LAYER A was not. The pure-ASCII 「## Project: Villa Handover」 collapses
identically (measured: 1 project, titled 'Lushan Weekly W29'). Bullets 「- 项目：」, ordered rows
「1. 项目：」, bold 「**项目：**」 and blockquotes 「> 项目：」 fail the same anchor. That is why the
load-bearing test here is INVARIANCE (below) rather than a list of shapes: a shape list only ever
covers the decorations someone thought of.

THE FIELD LABELS HAD THE SAME HOLE, and it is the more damaging half. A weekly that writes its
fields as a bullet list — 「- 负责人：陈思雨」/「- 状态：进行中」, ordinary .md — matched none of the
`^`-anchored field patterns, so every project came back blank-owned and blank-status. Those are
exactly the fields `granularity._tracked_fields` reads, so the projects then looked untracked and
R4 demoted them: not a thin card, NO card.
"""
from __future__ import annotations

import random
import re
from pathlib import Path

from avery.ingest import HeuristicExtractor, extract_docs, parse_file
from avery.ingest.extract import ProjectEntity
from avery.ingest.granularity import (
    build_milestone_index, classify, project_header_title, segment_projects, strip_decoration,
)
from avery.ingest.parse import ParsedDoc, sniff_kind

HERE = Path(__file__).resolve().parent
CJK = HERE / "fixtures" / "cjk"

MD_ZH = CJK / "Weekly_Markdown_Headings_ZH.md"          # 3 projects, 「## 项目：」 + bulleted fields
MD_EN = HERE / "fixtures" / "Weekly_Markdown_Headings_EN.md"   # the same shape, pure ASCII
BARE_ZH = CJK / "Sanya_Project_Weekly_ZH.md"            # 2 projects, bare 「项目：」 labels
BARE_EN = CJK / "Sanya_Project_Weekly.md"               # 2 projects, bare ASCII labels


def _heuristic(*paths: Path):
    return extract_docs([parse_file(p) for p in paths], extractor=HeuristicExtractor())


def _doc(name: str, text: str) -> ParsedDoc:
    return ParsedDoc(name=name, text=text, doc_kind=sniff_kind(name, text))


def _extract_text(name: str, text: str):
    return extract_docs([_doc(name, text)], extractor=HeuristicExtractor())


def _key_of(index: dict, row: str) -> str:
    """The parent `build_milestone_index` filed `row` under ('' if it filed it at all). The index is
    keyed by `granularity._key`, so look the row up the way the gate itself would."""
    from avery.ingest.granularity import _key
    return index.get(_key(row), ("", ""))[0]


# The comparable shape of a project. `summary` is DELIBERATELY ABSENT — see
# test_summary_is_the_one_field_decoration_moves, which pins that difference rather than hiding it.
def _shape(res):
    return sorted((p.title, p.ownerName, p.status, p.progress, p.dueDate, tuple(p.blockers),
                   p.source) for p in res.projects)


# ── the reported defect ──────────────────────────────────────────────────────────────────────────

def test_markdown_heading_weekly_yields_every_project_ZH():
    """THE REPORTED BUG. Three 「## 项目：」 headings must yield three projects, not one smear."""
    res = _heuristic(MD_ZH)
    titles = {p.title for p in res.projects}
    assert titles == {"别墅交付验收", "渠道合作拓展", "客户投诉处理"}, f"got {titles}"


def test_markdown_heading_weekly_yields_every_project_EN():
    """THE SAME BUG WITH NO HAN ANYWHERE — the proof that this is markup, not Chinese. Until the
    decoration stripper landed, this ASCII document also collapsed to a single card named
    'Weekly Markdown Headings EN'."""
    res = _heuristic(MD_EN)
    titles = {p.title for p in res.projects}
    assert titles == {"Villa Handover", "Channel Partnerships", "Complaint Handling"}, f"got {titles}"


def test_the_document_heading_never_becomes_a_project():
    """The smear's most visible symptom: a card named after the FILE. Neither document may produce
    one, in either language."""
    for path, phantom in ((MD_ZH, "三亚鹿山雅居 · 周报 W29"), (MD_EN, "Lushan Villas — Weekly W29")):
        titles = {p.title for p in _heuristic(path).projects}
        assert phantom not in titles, f"{path.name}: document heading came back as a project"


def test_no_project_carries_another_projects_fields():
    """THE SMEAR ITSELF, asserted as a property rather than by count. Each project must hold the
    owner/status/progress stated INSIDE its own block. The pre-fix single card held 吴桂芳 (project
    3), 'blocked' (project 3) and 30% (project 2) at once."""
    by_title = {p.title: p for p in _heuristic(MD_ZH).projects}
    assert by_title["别墅交付验收"].ownerName == "陈思雨"
    assert by_title["别墅交付验收"].status == "on-track"
    assert by_title["别墅交付验收"].progress == 60
    assert by_title["渠道合作拓展"].ownerName == "赵倩"
    assert by_title["渠道合作拓展"].progress == 30
    assert by_title["客户投诉处理"].ownerName == "吴桂芳"
    assert by_title["客户投诉处理"].status == "blocked"
    assert by_title["客户投诉处理"].progress is None, (
        "客户投诉处理 states no progress; a number here means project 2's 30% smeared onto it"
    )


def test_bulleted_field_labels_are_read():
    """The field-label half. 「- 负责人：」/「- 自报状态：」/「- 进度：」/「- 截止：」 are ordinary
    markdown and used to match nothing, which made every project look untracked to
    `_tracked_fields` — and an untracked project is DEMOTED by R4, not merely thin."""
    p = {x.title: x for x in _heuristic(MD_ZH).projects}["别墅交付验收"]
    assert (p.ownerName, p.status, p.progress, p.dueDate) == ("陈思雨", "on-track", 60, "2026-08-15")


def test_bulleted_blockers_are_read():
    """「- 阻碍项：…」 is the most decision-relevant line in a weekly. Losing it means a manager sees
    a report with nothing at risk."""
    blockers = [b for p in _heuristic(MD_ZH).projects for b in p.blockers]
    assert any("佣金口径" in b for b in blockers), f"got {blockers}"
    assert any("退改签" in b for b in blockers), f"got {blockers}"


def test_a_decorated_milestone_section_is_still_read_as_one():
    """The gate must keep working THROUGH the decoration. 「### 里程碑：」 is a milestone SECTION
    header; if `_milestones_in` cannot see it past the `###`, its rows are not indexed as
    checkpoints and R1 loses the evidence it demotes on.

    ASSERTED ON THE INDEX, NOT ON A DEMOTION COUNT, and the distinction matters: the HEURISTIC path
    never proposes a milestone row as a project (it only emits one entity per project block), so
    `res.granularity` correctly contains no demotions here. It is the LLM path that over-splits, and
    what protects it is this index — built from the same segmentation. Asserting "something was
    demoted" would therefore be asserting the wrong path's behaviour, and would pass for the wrong
    reason the day the heuristic started over-splitting too.
    """
    doc = parse_file(MD_ZH)
    index = build_milestone_index([doc])
    for row in ("隐蔽工程复验", "精装收口验收", "园林移交"):
        assert _key_of(index, row) == "别墅交付验收", (
            f"milestone 「{row}」 not indexed under its project — the 「### 里程碑：」 header was "
            f"not read; index={index}"
        )
    # …and the rows must not have leaked onto the project axis.
    titles = {p.title for p in _heuristic(MD_ZH).projects}
    for row in ("隐蔽工程复验", "精装收口验收", "园林移交"):
        assert row not in titles, f"milestone 「{row}」 was promoted to a project"


def test_a_decorated_milestone_row_is_demoted_when_a_candidate_proposes_it():
    """The other half: feed the gate a candidate named after a decorated milestone row — which is
    exactly what the LLM path hands back — and R1 must demote it, citing the parent and the line."""
    doc = parse_file(MD_ZH)
    ruling = classify(ProjectEntity(id="p", title="隐蔽工程复验"),
                      build_milestone_index([doc]), {}, {}, set())
    assert ruling.verdict == "milestone", f"got {ruling.as_line()}"
    assert ruling.rule == "R1-milestone-section"
    assert ruling.parent == "别墅交付验收"
    assert ruling.evidence.startswith(MD_ZH.name), f"no citable line: {ruling.evidence}"


# ── the load-bearing property: decoration must not change the answer ─────────────────────────────

_DECORATIONS = (
    ("h2", lambda lbl: f"## {lbl}"),
    ("h3", lambda lbl: f"### {lbl}"),
    ("bullet-dash", lambda lbl: f"- {lbl}"),
    ("bullet-star", lambda lbl: f"* {lbl}"),
    ("ordered", lambda lbl: f"1. {lbl}"),
    ("bold", lambda lbl: f"**{lbl}**"),
    ("bold-label", lambda lbl: re.sub(r"^([^：:]+[：:])", r"**\1**", lbl)),
    ("blockquote", lambda lbl: f"> {lbl}"),
    ("quoted-heading", lambda lbl: f"> ## {lbl}"),
    ("closed-atx", lambda lbl: f"## {lbl} ##"),
)

_LABEL_LINE = re.compile(r"^(?:项目|专案|课题|工程|负责人|自报状态|状态|进度|截止|阻碍项|进展摘要"
                         r"|project|owner|status|progress|due|blockers|summary)\s*\d*\s*[：:]", re.I)


def _decorate(text: str, wrap) -> str:
    """Wrap every LABEL line in one decoration, leaving line COUNT and order untouched — so `source`
    line numbers stay comparable and the assertion below can be an equality, not a subset."""
    return "\n".join(wrap(ln) if _LABEL_LINE.match(ln.strip()) else ln
                     for ln in text.splitlines())


def test_decoration_never_changes_what_is_extracted():
    """THE LOAD-BEARING TEST. For every decoration above, the extracted projects must be IDENTICAL
    to the undecorated document's — same titles, owners, statuses, progress, deadlines, blockers,
    and the same `<doc>:<line>` provenance.

    This is asserted as an INVARIANCE rather than as a list of expected outputs on purpose. A
    per-shape expectation only ever covers the decorations someone thought to write down, and the
    bug being fixed here is precisely a decoration nobody thought to write down. Stated this way,
    the next markup style either satisfies the property or fails loudly.
    """
    for src in (BARE_ZH, BARE_EN):
        base = src.read_text(encoding="utf-8")
        want = _shape(_extract_text(src.name, base))
        assert want, f"{src.name}: baseline extracted no projects — the fixture is not exercising this"
        for label, wrap in _DECORATIONS:
            got = _shape(_extract_text(src.name, _decorate(base, wrap)))
            assert got == want, (
                f"{src.name} decorated as {label!r} extracted differently:\n"
                f"  bare      {want}\n  decorated {got}"
            )


def test_decoration_never_changes_the_project_count_on_the_md_fixtures():
    """The same invariance from the other end: STRIPPING the decoration off the markdown fixtures
    must not change their extraction either."""
    for src in (MD_ZH, MD_EN):
        base = src.read_text(encoding="utf-8")
        undecorated = "\n".join(strip_decoration(ln) if _LABEL_LINE.match(strip_decoration(ln))
                                else ln for ln in base.splitlines())
        assert _shape(_extract_text(src.name, base)) == _shape(_extract_text(src.name, undecorated))


def test_summary_is_the_one_field_decoration_moves():
    """A KNOWN, DELIBERATE ASYMMETRY — pinned here so it is not mistaken for the invariance above.

    `_project_from_span`'s summary fallback takes the first line in the span that does not start
    with '#'. On a bare 「项目：X」 document that first line IS the label, so the summary reads
    「项目：销售 FAQ 梳理」 — a restatement of the title. Decorated as 「## 项目：X」 the label is a
    heading, gets skipped, and the summary becomes the next real line.

    Neither is obviously right (the bare form's summary is redundant with the title), and NEITHER IS
    A REGRESSION FROM THIS CHANGE: before it, the decorated document produced one phantom card and
    had no per-project summary at all. Aligning the two means touching the summary fallback, which
    moves output for documents that are extracting correctly today — a separate call from fixing an
    extraction that is wrong. Recorded rather than quietly folded into an unrelated fix.
    """
    base = BARE_ZH.read_text(encoding="utf-8")
    # Decorate ONLY the project-label lines, so the summary fallback is the single moving part.
    headed = "\n".join(f"## {ln}" if ln.startswith("项目：") else ln
                       for ln in base.splitlines())
    bare = {p.title: p.summary for p in _extract_text(BARE_ZH.name, base).projects}
    dec = {p.title: p.summary for p in _extract_text(BARE_ZH.name, headed).projects}

    assert set(bare) == set(dec), "titles must still match — only the summary may differ"
    # Bare: the summary restates the title, because the label line is the span's first line.
    assert bare["销售 FAQ 梳理"] == "项目：销售 FAQ 梳理"
    # Decorated: the label is a heading and is skipped, so the first real content line wins.
    assert dec["销售 FAQ 梳理"] == "负责人：陈思雨"
    # The direction of the difference is the point: decorating never makes the summary a bare
    # restatement of the title, which is what the undecorated path produces.
    for title, summary in dec.items():
        assert summary != f"项目：{title}", f"「{title}」 summary is just its title again"


# ── strip_decoration's own contract ──────────────────────────────────────────────────────────────

def test_strip_decoration_reads_the_shapes_it_claims_to():
    for raw, want in (
        ("## 项目：别墅交付验收", "项目：别墅交付验收"),
        ("### 项目 1：别墅交付验收", "项目 1：别墅交付验收"),
        ("- 项目：别墅交付验收", "项目：别墅交付验收"),
        ("* 负责人：陈思雨", "负责人：陈思雨"),
        ("1. 项目：别墅交付验收", "项目：别墅交付验收"),
        ("**项目：别墅交付验收**", "项目：别墅交付验收"),
        ("**项目**：别墅交付验收", "项目：别墅交付验收"),
        ("> - **项目：别墅交付验收**", "项目：别墅交付验收"),
        ("## 项目：别墅交付验收 ##", "项目：别墅交付验收"),
        ("• 阻碍项：法务尚未回复", "阻碍项：法务尚未回复"),
        ("## Project: Villa Handover", "Project: Villa Handover"),
    ):
        assert strip_decoration(raw) == want, f"{raw!r} -> {strip_decoration(raw)!r}"


def test_strip_decoration_is_a_no_op_on_an_undecorated_line_ASCII_IDENTITY():
    """THE CONTRACT THAT LETS THIS SIT UNDER SIX LIVE PATTERNS. A line carrying no markup must come
    back byte-identical, or the 2953-test baseline moves. Proven by construction (every branch
    requires a leading `>`/`#`/bullet/ordered marker, an embedded `**`/`__`, or a trailing `#`) and
    checked exhaustively here: across all 128 ASCII codepoints, the ONLY leading characters that
    change a payload are exactly those markers."""
    changed_bare, changed_spaced = set(), set()
    for cp in range(128):
        c = chr(cp)
        if strip_decoration(f"{c}项目：X") != f"{c}项目：X".strip():
            changed_bare.add(c)
        if strip_decoration(f"{c} 项目：X") != f"{c} 项目：X".strip():
            changed_spaced.add(c)
    assert changed_bare == {">"}, f"unexpected bare-prefix strippers: {sorted(changed_bare)}"
    assert changed_spaced == {"#", "*", "+", "-", ">"}, (
        f"unexpected marker+space strippers: {sorted(changed_spaced)}")


def test_strip_decoration_no_op_fuzz_over_an_undecorated_pool():
    """Corroborates the proof above over whole strings rather than single prefixes: pool
    [a-zA-Z0-9 项目负责人截止：:/，、], length 0..24, seed 54, n = 20,000 -> 0 lines changed."""
    rnd = random.Random(54)
    pool = "abcXYZ0123 项目负责人截止：:/，、"
    for _ in range(20_000):
        s = "".join(rnd.choice(pool) for _ in range(rnd.randint(0, 24))).strip()
        assert strip_decoration(s) == s, f"undecorated line was rewritten: {s!r}"


def test_strip_decoration_is_idempotent():
    """Stripping `**` can EXPOSE a leading marker the inner pass already walked past —
    「**- 项目：X**」 -> 「- 项目：X」, still a bullet. A single pass left 149 such lines
    non-idempotent (fuzz, seed 54, n = 200,000); the outer convergence loop takes it to 0. Without
    idempotence, whether a label is seen would depend on how many times it happened to be stripped."""
    rnd = random.Random(54)
    pool = "abcXY 项目负责人：:#*->_1.•·\t"
    for _ in range(20_000):
        s = "".join(rnd.choice(pool) for _ in range(rnd.randint(0, 24)))
        once = strip_decoration(s)
        assert strip_decoration(once) == once, f"not idempotent: {s!r} -> {once!r}"


def test_project_header_title_separates_a_project_heading_from_a_document_heading():
    """The distinction `_project_from_span`'s title fallback needs. 「## 项目：X」 is a project header
    that happens to be a heading (title X); 「# 三亚鹿山雅居 · 周报 W29」 is the document naming
    itself (no project title). Reading only `^#+` took the former as a project literally named
    「项目：X」."""
    assert project_header_title("## 项目：别墅交付验收") == "别墅交付验收"
    assert project_header_title("## Project: Villa Handover") == "Villa Handover"
    assert project_header_title("# 三亚鹿山雅居 · 周报 W29") == ""
    assert project_header_title("负责人：陈思雨") == ""


def test_segmentation_is_what_moved_not_the_bare_path():
    """Guards the blast radius: the bare-label fixtures must segment EXACTLY as they did pre-fix
    (2 blocks each). If this ever changes, the stripper started rewriting undecorated lines."""
    for path, want in ((BARE_ZH, 2), (BARE_EN, 2), (MD_ZH, 3), (MD_EN, 3)):
        got = len(segment_projects(parse_file(path)))
        assert got == want, f"{path.name}: {got} block(s), want {want}"
