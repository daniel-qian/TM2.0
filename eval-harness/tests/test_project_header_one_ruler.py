"""ONE RULER FOR "IS THIS LINE A PROJECT HEADER?".

`granularity.project_header_title` owns the project-header vocabulary. `extract._project_from_span`
used to own a hand-copied SECOND set of the same patterns, and the EN copy had already drifted:

    granularity._PROJECT_HEADER_EN  ^(?:project|initiative|workstream|title)\\s*\\d*\\s*[:\\-]\\s*(.+)$
    extract.py, inline              ^(project|title)\\s*[:\\-]\\s*(.+)$

So granularity accepted 「initiative:／workstream:」 and the ordinal 「Project 2:」; extract's copy
accepted neither. The ZH copies were byte-identical, which is the worse half of the problem — a pair
that is in sync on one side READS as if it were in sync on both, and nothing points at the EN gap.

WHY NO TEST CAUGHT IT: the drift was MASKED, not live. `segment_projects` cuts the block and hands
`labelled_title` into `_project_from_span`, so on every path the suite exercises, the narrow inline
copy never had to match anything — the title was already decided by the ruler upstream. Measured
before the change: 「Initiative: X」, 「Project 1: X」 and 「## Initiative: X」 all extract correctly
end-to-end. A masked disagreement is still a disagreement; it goes live the moment someone reaches
the span reader without a labelled title, or adds a vocabulary word to only one of the two lists.

That is the feat-048 round-1 shape exactly (see the `_ZH_HEADER_MAP`／`_NOT_NAME` notes in
granularity): a copy that stays correct only while nobody exercises it.

THE TEST IS THE AGREEMENT ITSELF, not a list of shapes — same reason the decoration suite pins
INVARIANCE rather than an enumeration of markups. A shape list only ever covers the shapes someone
thought of; the property below fails for ANY word the two sides stop agreeing on. It reaches the
span reader with NO `labelled_title`, which is precisely the path the masking hid.
"""

from __future__ import annotations

from avery.ingest import HeuristicExtractor
from avery.ingest.granularity import project_header_title
from avery.ingest.parse import ParsedDoc, sniff_kind

# The full declared vocabulary of both sides, crossed with the ordinals and separators the patterns
# allow and the markdown decorations `strip_decoration` is responsible for. Built as a CROSS PRODUCT
# rather than written out, so adding a word to granularity's pattern extends the corpus by
# construction instead of by somebody remembering to extend a literal list.
_EN_WORDS = ("project", "initiative", "workstream", "title", "Project", "INITIATIVE", "Workstream")
_ZH_WORDS = ("项目", "专案", "课题", "工程")
_EN_ORDINALS = ("", " 1", " 2", "10")
_ZH_ORDINALS = ("", " 1", "２", "一", "三")
_DECORATIONS = ("{}", "## {}", "### {}", "- {}", "* {}", "1. {}", "> {}", "**{}**", "> - **{}**")

_TITLE = "Villa Handover"
_TITLE_ZH = "别墅交付验收"


def _headers() -> list[str]:
    bare: list[str] = []
    for w in _EN_WORDS:
        for o in _EN_ORDINALS:
            for sep in (":", "-"):
                bare.append(f"{w}{o}{sep} {_TITLE}")
    for w in _ZH_WORDS:
        for o in _ZH_ORDINALS:
            for sep in ("：", ":"):
                bare.append(f"{w}{o}{sep}{_TITLE_ZH}")
    return [d.format(b) for b in bare for d in _DECORATIONS]


def _doc(text: str) -> ParsedDoc:
    return ParsedDoc(name="W.md", text=text, doc_kind=sniff_kind("W.md", text))


def _span_title(line: str) -> str:
    """What `_project_from_span` makes of a one-line span, with NO labelled title handed in — the
    unmasked path, where the inline copy actually had to do the work."""
    doc = _doc(line + "\n")
    return HeuristicExtractor()._project_from_span(doc, "", 0, len(doc.lines), False).title


def test_the_corpus_is_actually_exercising_the_drifted_vocabulary():
    """Guards the test itself: if the cross product silently stopped producing the words that
    DIFFERED between the two copies, the agreement property below would pass vacuously."""
    corpus = _headers()
    assert len(corpus) == (7 * 4 * 2 + 4 * 5 * 2) * len(_DECORATIONS)
    for probe in ("initiative: ", "Workstream: ", "Project 2: ", "## INITIATIVE: "):
        assert any(c.startswith(probe) for c in corpus), probe
    # The words the inline EN copy did NOT know are headers to the ruler — i.e. there is a real
    # disagreement to detect, not a vocabulary that happens to coincide.
    for line in ("Initiative: X", "Workstream: X", "Project 2: X"):
        assert project_header_title(line) == "X"


def test_span_reader_reads_exactly_what_the_ruler_declares():
    """THE PROPERTY. Wherever the ruler says a line declares a project, the span reader must produce
    that same title — not a narrower vocabulary's answer, and not the raw heading text."""
    for line in _headers():
        declared = project_header_title(line)
        assert declared, f"corpus line is not a header to the ruler: {line!r}"
        assert _span_title(line) == declared, line


def test_span_reader_invents_no_project_from_a_line_the_ruler_rejects():
    """The other direction, so the shared pattern cannot be widened into reading ordinary prose as a
    project header. These are NOT project labels, so the span reader must fall back to the document
    name rather than take the line's text as a title."""
    # 「projected:／titles are」 are the load-bearing pair: they START with a vocabulary word and
    # must still be rejected, which is what stops 「one ruler」 from becoming 「a wider ruler」.
    # 「初步项目：」 is the same trap in ZH — the label is not at the anchor.
    for line in ("负责人：陈思雨", "owner: Chen Siyu", "status: on track",
                 "projected: revenue up", "titles are due friday",
                 "初步项目：讨论中的想法", "项目进展顺利"):
        assert project_header_title(line) == "", line
        assert _span_title(line) == "W", line


def test_document_heading_is_still_not_a_project_header():
    """The `#`-fallback distinction f77bac8 introduced must survive the consolidation: a heading that
    is a project header yields the project's title; a heading that is the document naming itself
    yields the heading text."""
    assert _span_title("## 项目：别墅交付验收") == "别墅交付验收"
    assert _span_title("## Initiative: Villa Handover") == "Villa Handover"
    assert _span_title("# 三亚鹿山雅居 · 周报 W29") == "三亚鹿山雅居 · 周报 W29"
