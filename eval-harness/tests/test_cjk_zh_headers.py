"""feat-049 GATE — the two ASCII-IN-DISGUISE holes ABOVE and INSIDE the offline roster path.
GATE-FIRST: every assertion here was written before the fix and watched go red.

Both were found during feat-048 round 2 and deliberately left out of that round's scope. Both live
on the OFFLINE/DEGRADED ingest path — the one the first customer (an all-Chinese Sanya villa hotel)
reaches whenever the model is unavailable: extractor_factory.py:87 (LLM budget exhausted) and
llm_extract.py:216/222/227 (model failure / red-line breach / no entities). Neither is hypothetical
and neither needs a contrived document; both fire on the customer's ordinary paperwork.

  HOLE 1  parse.py::sniff_kind. `_KIND_HINTS` is five ASCII regexes, matched against the FILENAME
          first and then the head of the content. A Chinese HR system exports 「员工花名册.md」/
          「本周项目周报.md」/「张伟_简历.md」 — not one of them contains an ASCII keyword, so all of
          them sniff to doc_kind='unknown'. HeuristicExtractor.extract (extract.py:582) routes on
          doc_kind, and 'unknown' hits NO branch: the document produces materials and nothing else.
          Zero people, zero projects, from a roster that is a roster. This is the next mine the
          moment Sanya uploads real Chinese filenames, and it sits ABOVE hole 2 — a file that never
          reaches _people_from_roster cannot exercise any header rule.

          feat-048's fixtures kept ASCII filenames (Sanya_Team_Roster_ZH.md) ON PURPOSE, so that
          this layer could not mask the BUG-3 gate underneath it. That choice is preserved here:
          the header-map corpus below is still ASCII-named, and hole 1 gets its own corpus
          (员工花名册.md) whose ONLY distinguishing feature is its name.

  HOLE 2  extract.py::_people_from_roster builds its `header` list only when row 0 matches
          `re.search(r"\\bname\\b", ...)` — ASCII. A real Sanya roster's header row reads
          「姓名 | 职位 | 部门 | 司龄 | 负责」, so `header` stays [] and three things follow:
            * `col.get("owns")` is always None, so the 「负责」column is NEVER read and every Chinese
              colleague gets owns=[] — the entire BODY of their person card is empty. The person
              exists and has nothing to say.
            * the `if header and cells[0] in _NOT_NAME: continue` guard never runs. feat-048 round 2
              made _looks_like_name's stop-list carry that load instead (and it works), but the
              structural guard is dead on every Chinese document.
            * role/team/tenure survive ONLY by POSITIONAL fallback (cells[1]/cells[2]/cells[3]), so
              a roster whose columns are in a different order is SILENTLY mis-filed. Silently is the
              word that matters: nothing reports it, the card just says the wrong thing.

WHY THE 「负责」COLUMN IS NOT COSMETIC: PersonEntity.owns IS the person card. role/team/tenure are
one header line; `owns` is every line under it, and it is what the advisor cites when it says what
somebody is carrying. A Sanya manager whose LLM budget ran out currently gets a team page of names
with empty bodies — which reads as "Avery knows nothing about my team", because it doesn't.

ONE RULER (feat-048 round 1's lesson, applied structurally rather than by discipline): the Chinese
header words are defined ONCE, in extract._ZH_HEADER_MAP, and _NOT_NAME is BUILT from its keys
rather than repeating them. Round 1's lesson was that duplicated identity/normalisation rules drift
apart silently — a hand-copied second list of 姓名/职位/部门 would mean that teaching the extractor a
new header word quietly stops protecting _looks_like_name from it, or vice versa, with nothing
anywhere to notice.

THE ENGLISH CONTRACT IS SAFE BY CONSTRUCTION, NOT BY MEASUREMENT — and the gates below say so
executably. _canon_header's Han steps cannot match anywhere in an ASCII string (the map's keys are
all Han; the bilingual fallback strips to Han and gets ""), so on ASCII it is exactly the old
`c.strip().lower()`, character for character. The owns splitter widens `[;,]` to `[;,；，、]`, and
the three added code points are outside ASCII by definition.
"""
from __future__ import annotations

from pathlib import Path

import pytest

from avery.ingest import HeuristicExtractor, extract_docs, parse_file
from avery.ingest.extract import _NOT_NAME, _ZH_HEADER_MAP, _canon_header, _looks_like_name
from avery.ingest.parse import sniff_kind

HERE = Path(__file__).resolve().parent
CJK = HERE / "fixtures" / "cjk"
ENG = HERE / "fixtures" / "ingest"

# Round 2's fully-Chinese roster. ASCII FILENAME ON PURPOSE (see the module docstring): it routes to
# doc_kind='roster' through the existing `roster` hint, so a red here is hole 2 and nothing else.
ZH_ROSTER = CJK / "Sanya_Team_Roster_ZH.md"

# feat-049 corpus.
#   Sanya_Roster_ColumnOrder_ZH.md — the SAME hotel, the SAME Chinese header words, a DIFFERENT
#     column order (姓名|部门|职位|司龄|负责 — department before title). Its filename is ASCII, so it
#     isolates hole 2 from hole 1. It carries an English row too, because the header governs the
#     whole table and not just its Chinese rows.
#   员工花名册.md — a genuinely Chinese-named file. Its column order matches ZH_ROSTER's, so the only
#     thing it can be red about is ROUTING (hole 1).
COLUMN_ORDER_ROSTER = CJK / "Sanya_Roster_ColumnOrder_ZH.md"
ZH_NAMED_ROSTER = CJK / "员工花名册.md"


def _heuristic(*paths: Path):
    """The real offline path, end to end: parse -> HeuristicExtractor -> dedupe -> link. No model."""
    return extract_docs([parse_file(p) for p in paths], extractor=HeuristicExtractor())


# === corpus integrity ==========================================================================
# The fixtures ARE the gate (feat-048's deepest lesson). If they drift back to ASCII this file is
# theatre, so the drift is asserted against rather than trusted.

def test_feat049_fixtures_are_really_chinese_where_it_counts():
    for f in (COLUMN_ORDER_ROSTER, ZH_NAMED_ROSTER):
        assert f.exists(), f"missing feat-049 fixture {f}"
        text = f.read_text(encoding="utf-8")
        assert "姓名" in text, f"{f.name} lost its Chinese header row"
        assert "负责" in text, f"{f.name} lost its 「负责」column"


def test_the_hole1_fixture_is_the_only_one_with_a_chinese_filename():
    """The two corpora are separated ON PURPOSE, and the separation is what keeps each gate honest.

    员工花名册.md's filename is the whole point of hole 1's corpus. Every OTHER Chinese fixture in
    this directory keeps an ASCII filename — feat-048 chose that deliberately so that a routing hole
    could not mask the header/name gates underneath it, and this test pins that choice so a future
    round cannot dissolve the boundary by renaming a fixture.
    """
    assert not ZH_NAMED_ROSTER.stem.isascii(), (
        f"{ZH_NAMED_ROSTER.name} is hole 1's entire corpus — its filename must stay Chinese"
    )
    for f in sorted(CJK.glob("*.md")):
        if f == ZH_NAMED_ROSTER:
            continue
        assert f.stem.isascii(), (
            f"{f.name} acquired a non-ASCII filename. Every fixture but 员工花名册.md is ASCII-named "
            f"so that sniff_kind routes it via the existing English hints — otherwise a routing fix "
            f"would silently stand in for the header/name rules these files exist to test."
        )


def test_the_hole1_fixture_body_carries_no_latin_letter_at_all():
    """NOT A STYLE RULE — this fixture defused its own gate once, and this is the scar.

    sniff_kind reads the FILENAME and then the head of the CONTENT. 员工花名册.md exists to prove a
    Chinese filename routes; if its prose contains any ASCII hint word, the CONTENT pass routes it
    instead and the gate goes green over an untouched hole. That is not hypothetical: the first
    draft explained the fixture's own column order by naming a sibling file, Sanya_Team_Roster_ZH.md
    — the word 'Roster' in that sentence matched the existing ASCII hint, and the file sniffed to
    'roster' BEFORE the fix. The gate was green and hole 1 was fully open.

    A whole-body ban on Latin letters is the rule that cannot be got wrong by accident, and it is
    cheap: hole 1's corpus is Chinese by definition. Note the trap is worse than an ordinary green
    test, because the leak arrives as PROSE — the part of a fixture nobody re-reads.
    """
    body = ZH_NAMED_ROSTER.read_text(encoding="utf-8")
    latin = sorted({ch for ch in body if ch.isascii() and ch.isalpha()})
    assert not latin, (
        f"员工花名册.md's body contains Latin letters {latin}. Some ASCII word in this file may be a "
        f"_KIND_HINTS keyword ('roster'/'people'/'org'/'cv' — several have no word boundary), which "
        f"would route the file by CONTENT and silently defuse the filename gate this corpus exists "
        f"for."
    )


# === HOLE 1 · sniff_kind =======================================================================

@pytest.mark.parametrize("filename,expected", [
    # the brief's own example, and the shape the customer's HR system actually emits
    ("花名册.md", "roster"),
    ("员工花名册.md", "roster"),
    ("餐饮部人员名单.xlsx", "roster"),
    ("张伟_简历.md", "resume"),
    ("个人履历.docx", "resume"),
    ("本周项目周报.md", "project"),
    ("前厅部日报.md", "project"),
    ("季度复盘.md", "project"),
    ("2026 产品路线图.md", "roadmap"),
    ("开业里程碑.xlsx", "roadmap"),
    ("员工手册.md", "company"),
    ("公司章程.docx", "company"),
])
def test_sniff_kind_routes_a_chinese_filename_HOLE1(filename, expected):
    """BORN RED — every one of these is 'unknown' today, because _KIND_HINTS is five ASCII regexes.

    doc_kind is not a label, it is the ROUTE: HeuristicExtractor.extract branches on it, and
    'unknown' matches no branch, so the file contributes materials and NOTHING else. A roster named
    「员工花名册.md」ingests as zero people.
    """
    assert sniff_kind(filename, "") == expected, (
        f"sniff_kind({filename!r}) == {sniff_kind(filename, '')!r}. This is the filename a Chinese "
        f"HR system exports; it contains no ASCII keyword, so it routes to 'unknown' and the "
        f"heuristic extracts no people from it at all."
    )


@pytest.mark.parametrize("head,expected", [
    ("# 三亚亚特兰蒂斯别墅酒店 — 员工花名册\n姓名 | 职位 | 部门", "roster"),
    ("# 个人简历\n张伟 — 餐饮总监", "resume"),
    ("# 本周项目周报\n项目：销售 FAQ 梳理", "project"),
    ("# 2026 开业路线图\n里程碑：样板间交付", "roadmap"),
    ("# 员工手册\n第一章 考勤", "company"),
])
def test_sniff_kind_falls_back_to_chinese_CONTENT_HOLE1(head, expected):
    """The content half of the same hole. sniff_kind peeks at the head of the document when the
    filename says nothing — a real path, because a scanner or a CMS names files 'scan_0042.pdf'.
    Today that peek is the same five ASCII regexes, so a Chinese document is unknown twice over."""
    assert sniff_kind("scan_0042.md", head) == expected


@pytest.mark.parametrize("filename,expected", [
    # exactly the routes the existing English corpus depends on (tests/fixtures/ingest/*)
    ("Team_Roster.xlsx", "roster"),
    ("Lena_Park_Resume.docx", "resume"),
    ("Core_Flow_Weekly.pdf", "project"),
    ("Studio_Handbook.md", "company"),
    # + one of each remaining kind, and the unknown that must STAY unknown
    ("Q3_Roadmap.md", "roadmap"),
    ("scan_0042.pdf", "unknown"),
    ("IMG_1043.png", "unknown"),
])
def test_sniff_kind_english_routing_is_frozen_HOLE1(filename, expected):
    """BORN GREEN, MUST STAY GREEN — the safety catch. Adding Chinese hints must not perturb a
    single route the existing 42 features of evidence rest on, and 'unknown' must still be reachable
    (a hint list that matches everything is not a router)."""
    assert sniff_kind(filename, "") == expected


def test_chinese_named_roster_ingests_its_people_HOLE1():
    """BORN RED. Hole 1 end to end, on the real offline path, with the ONLY unusual thing about the
    document being its name.

    Measured before the fix: people == [] — 何秀兰 and 黄立成 do not exist, because their roster was
    routed to 'unknown' and 'unknown' has no branch in HeuristicExtractor.extract. The file parses
    perfectly; its content is a well-formed roster; nothing anywhere reports that it was skipped.
    """
    doc = parse_file(ZH_NAMED_ROSTER)
    assert doc.doc_kind == "roster", (
        f"{ZH_NAMED_ROSTER.name} sniffed to {doc.doc_kind!r}. The file is a roster and says so in "
        f"its own name; sniff_kind simply cannot read it."
    )
    res = _heuristic(ZH_NAMED_ROSTER)
    assert {p.name for p in res.people} == {"何秀兰", "黄立成"}, (
        f"a roster named 员工花名册.md produced {[p.name for p in res.people]}"
    )


def test_the_zh_handover_memo_now_routes_to_project_HOLE1():
    """THE ONE EXISTING FIXTURE HOLE 1'S FIX MOVES — pinned so it is a decision and not a drift.

    Sanya_Ops_Handover_ZH.md has no ASCII keyword in its filename, so it fell through to the content
    pass and sniffed 'unknown'. Its head says 「以下阻塞项由本周项目周报原样抄录」, which now matches
    the 项目/周报 hints, so it routes to 'project'. Every OTHER fixture's kind is unchanged, English
    included (surveyed across tests/fixtures/**: this is the only move).

    THE CONSEQUENCE IS UGLY AND IT IS NOT MINE TO FIX HERE — measured rather than argued, because
    "routing a document is an improvement" is exactly the kind of claim that should be checked:

        AFTER:  projects == [('三亚亚特兰蒂斯别墅酒店 — 前厅部交接备忘',
                              summary='三亚亚特兰蒂斯别墅酒店 · 内部资料 · 请勿外传')]

    A project card titled after a handover memo, summarised by its confidentiality banner. But that
    card is NOT a new failure mode, and the measurement is what says so:

      * ON BASELINE (feat-049 not applied), Sanya_Project_Weekly_ZH.md ALREADY produces exactly this
        card — heading as title, banner as summary — because its ASCII filename already routed it to
        'project'. Chinese documents that reach _projects_from_doc have always come out this way.
      * ON BASELINE, so does ENGLISH. A memo '# Front Office Handover' / 'CONFIDENTIAL - DO NOT
        DISTRIBUTE' / '...copied from this week's project report' sniffs to 'project' and yields
        ('Front Office Handover', 'CONFIDENTIAL - DO NOT DISTRIBUTE'). Identical shape, no Han
        anywhere. This is not a CJK defect.

    So hole 1's fix moves ONE more document into a pre-existing, English-native behaviour that
    test_zh_project_axis_gap.py's H4 quarantine already owns (Layer A: _projects_from_doc keeps ONE
    scalar project per document; Layer B: its 「项目：/状态：」labels are ASCII). Routing is still the
    right call — the alternative is that a Chinese roster keeps ingesting as zero people, which is
    the whole reason this round exists — and holding it hostage to H4 would trade a fixed hole for an
    unfixed one. The junk card is H4's to remove, and H4 is quarantined strict-xfail so it cannot rot.
    """
    assert parse_file(CJK / "Sanya_Ops_Handover_ZH.md").doc_kind == "project"


# === HOLE 2 · the Chinese header row ===========================================================

def test_heuristic_zh_roster_reads_the_fuze_column_HOLE2():
    """BORN RED — the brief's first gate, and the emptiest card in the product.

    陈思雨's row says 「陈思雨 | 销售主管 | 销售部 | 3 年 | 销售 FAQ 梳理」. The last cell is what she
    owns. `header` is [] (row 0 is Chinese, the detector wants ASCII `\\bname\\b`), so
    `col.get("owns")` is None, and there is no positional fallback for owns the way there is for
    role/team/tenure. Measured: owns == [].
    """
    res = _heuristic(ZH_ROSTER)
    chen = next(p for p in res.people if p.name == "陈思雨")
    assert chen.owns == ["销售 FAQ 梳理"], (
        f"陈思雨's owns == {chen.owns!r}. Her roster row states what she owns in its 「负责」column; "
        f"the heuristic never reads that column on a Chinese roster, so her card has a header and "
        f"no body."
    )


def test_heuristic_zh_roster_gives_every_colleague_a_card_BODY_HOLE2():
    """The same hole stated over the WHOLE roster, so it cannot be satisfied one colleague at a
    time. Note the English colleague on the same roster (Lin Qing) is read through the SAME Chinese
    header — 「负责」governs her row too. A fix that special-cases Han rows fails here."""
    res = _heuristic(ZH_ROSTER)
    assert {p.name: tuple(p.owns) for p in res.people} == {
        "陈思雨": ("销售 FAQ 梳理",),
        "李明轩": ("客房清洁标准复核",),
        "周雅婷": ("别墅套餐推广物料",),
        "孙浩": ("宴会动线优化",),
        "吴桂芳": ("前台交接流程",),
        "赵倩": ("客房夜床服务",),
        "Lin Qing": ("design reviews",),
    }


def test_heuristic_reads_a_zh_roster_by_its_HEADER_not_by_column_position_HOLE2():
    """BORN RED, and this is the silent half of hole 2.

    Sanya_Roster_ColumnOrder_ZH.md is the same hotel with 部门 before 职位 — a column order the
    export template chose, not a convention anybody agreed. With `header` empty the heuristic reads
    cells[1] as the role and cells[2] as the team no matter what the header says, so measured today:

        郑海燕 -> role='客房部'      (her DEPARTMENT, filed as her job title)
                  team='客房部经理'  (her JOB TITLE, filed as her department, and rendered as the
                                      group heading of a department that does not exist)

    Nothing reports this. The card is confidently wrong, and the team page grows a 「客房部经理」
    group with one person in it.
    """
    res = _heuristic(COLUMN_ORDER_ROSTER)
    got = {p.name: (p.role, p.team, p.tenure) for p in res.people}
    assert got == {
        "郑海燕": ("客房部经理", "客房部", "6 年"),
        "冯振国": ("行李主管", "前厅部", "3 年"),
        "买买提艾力": ("宴会主管", "餐饮部", "2 年"),
        # the header governs the English row too — it is the table's header, not the language's
        "Grace Tan": ("Design Lead", "Design", "4 years"),
    }, f"people were filed by column POSITION rather than by the header that names the columns: {got}"


def test_heuristic_zh_roster_owns_column_splits_on_the_ideographic_comma_HOLE2():
    """BORN RED. The separator set `[;,]` is the same kind of ASCII-in-disguise as the header rule,
    in the same six lines, and it lands on the same column.

    Chinese enumerates with the IDEOGRAPHIC COMMA 、(U+3001) — that is the character's only job; it
    is not a sentence comma. 「客房夜床服务复核、布草间盘点」is two things 郑海燕 owns, and today it
    is one run-on blob on her card (once the header is read at all).

    ；(U+FF1B) and ，(U+FF0C) are the full-width forms of the two separators already in the set, and
    are widened with it for consistency: '「A, B」 splits but 「A，B」does not' would be a distinction
    with no reason behind it. ，inherits `,`'s KNOWN ambiguity (a sentence comma is not always a
    separator) rather than inventing a new one — that ambiguity is pre-existing English behaviour,
    accepted here on the same terms.

    ON ASCII THIS IS A NO-OP BY CONSTRUCTION: the three added code points are outside ASCII, so
    `[;,；，、]` and `[;,]` partition an ASCII string identically.
    """
    res = _heuristic(COLUMN_ORDER_ROSTER)
    zheng = next(p for p in res.people if p.name == "郑海燕")
    assert zheng.owns == ["客房夜床服务复核", "布草间盘点"], (
        f"郑海燕's owns == {zheng.owns!r}. Her 「负责」cell lists two things separated by 、, the "
        f"ordinary Chinese list separator; the splitter only knows ASCII ';' and ','."
    )


def test_heuristic_zh_roster_never_promotes_a_header_or_a_banner_to_a_person_HOLE2():
    """THE REVERSE HALF, over the new corpus. BORN GREEN and MUST STAY GREEN.

    Reading the header row is not the same as trusting it: once `header` is non-empty on a Chinese
    roster, the long-dead `if header and cells[0] in _NOT_NAME: continue` guard starts running for
    the first time — and it must reject, not admit. The banner line (「… · 内部资料 · 请勿外传」) is
    covered by the same list for the same reason (feat-048 round 3, H5b).
    """
    res = _heuristic(COLUMN_ORDER_ROSTER, ZH_NAMED_ROSTER, ZH_ROSTER)
    names = {p.name for p in res.people}
    leaked = sorted(names & {"姓名", "职位", "部门", "司龄", "负责", "内部资料", "请勿外传",
                             "制表说明", "说明"})
    assert not leaked, f"a header word or document banner became a colleague: {leaked}"


# === ONE RULER · the header map is the single source of truth ===================================

def test_every_mapped_zh_header_word_is_also_a_stop_word_ONE_RULER():
    """TRUE BY CONSTRUCTION today — _NOT_NAME is built from _ZH_HEADER_MAP's keys — and that is
    exactly what this asserts. It goes red the day someone re-splits the two into hand-maintained
    lists, which is the failure feat-048 round 1 actually shipped and round 2 had to unpick.

    The stake is concrete and it is silent in both directions: a header word the map knows but
    _NOT_NAME does not is a colleague called 「岗位」on the team page; a stop-word the map does not
    know is a column read by position again. One list, two consumers.

    NOT A TAUTOLOGY — MUTATION-PROVEN, because "guaranteed by construction" is precisely the kind of
    test that is really theatre. Deleting the `| set(_ZH_HEADER_MAP)` fold (i.e. going back to two
    hand-kept lists, with the header words no longer typed into _NOT_NAME) turns 5 assertions in this
    file RED, this one included: the header row 「姓名 | 职位 | 部门」 walks straight through
    _looks_like_name and 「姓名」 ships as a colleague. That is feat-039's "No." bug, in Chinese,
    arriving through the very list that exists to stop it.
    """
    missing = sorted(w for w in _ZH_HEADER_MAP if w not in _NOT_NAME)
    assert not missing, (
        f"{missing} are mapped as column headers but are not stop-words — _NOT_NAME is no longer "
        f"derived from _ZH_HEADER_MAP, so the two lists can now drift"
    )
    leaked = sorted(w for w in _ZH_HEADER_MAP if _looks_like_name(w))
    assert not leaked, f"column headers that _looks_like_name accepts as people: {leaked}"


def test_the_zh_header_map_only_targets_keys_the_extractor_actually_reads_ONE_RULER():
    """A Chinese header may only be mapped onto a key _people_from_roster looks up. Mapping 「职责」
    onto a key nothing reads would look like support and deliver nothing — the column would be
    canonicalised into silence, which is worse than leaving it uncanonicalised, because the next
    reader sees a mapping and assumes the column works.
    """
    # person_id 加进来是 T5/A2：`_people_from_roster` 真的读它（`col.get("person_id")`），
    # 而且它是 `_dedupe_entities` 认人的第一把尺——不是一个"映射了但没人看"的键。
    readable = {"name", "role", "team", "tenure", "owns", "focus", "projects", "person_id"}
    stray = sorted((w, k) for w, k in _ZH_HEADER_MAP.items() if k not in readable)
    assert not stray, f"header words mapped onto keys the extractor never looks up: {stray}"


# === the ENGLISH byte contract (BORN GREEN — the safety catch) ==================================

@pytest.mark.parametrize("cell", [
    "Name", " Role ", "TEAM", "Tenure", "Owns", "Full Name", "Owner", "No.", "S.No", "#",
    "Roadmap_ Q3", "Current Responsibilities", "", "   ",
])
def test_canon_header_is_the_identity_on_ascii(cell):
    """The English contract, executable rather than spoken. _canon_header replaces
    `c.strip().lower()` in _people_from_roster, and on an ASCII cell it must BE that expression,
    character for character.

    It is safe BY CONSTRUCTION, not by this measurement: every key of _ZH_HEADER_MAP is Han, so an
    ASCII cell can never hit the map; the Han-padding strip needs Han on both sides of the space; and
    the bilingual fallback strips the cell to its Han characters, which for ASCII is the empty
    string. This test corroborates the proof — it does not stand in for it.
    """
    assert _canon_header(cell) == cell.strip().lower()


@pytest.mark.parametrize("cell,expected", [
    # 「姓名 Name」— a five-star hotel's roster copies its bilingual department signage, so bilingual
    # header cells are the norm here rather than the exception (see Sanya_Bilingual_Roster.md).
    ("姓名 Name", "name"),
    ("职位 Title", "role"),
    ("部门 Department", "team"),
    ("Name 姓名", "name"),
    # Han padding inside a header cell is the same column-alignment convention as in a name
    ("姓　名", "name"),
    ("司 龄", "tenure"),
    # a cell the map does not know keeps its old shape (lower-cased, stripped) and is looked up as
    # itself — exactly what an unrecognised English header does today
    ("本周班次", "本周班次"),
    ("Guest Engagement 宾客关系部", "guest engagement 宾客关系部"),
])
def test_canon_header_maps_chinese_columns_onto_the_canonical_keys(cell, expected):
    assert _canon_header(cell) == expected


def test_english_roster_extraction_is_unchanged_HOLE2():
    """BORN GREEN, MUST STAY GREEN. The whole English ingest, field by field — not just ids.

    feat-048 froze _slug's English ids; this freezes what the English ROSTER PATH puts in the cards,
    which is the surface hole 2's fix actually touches (header detection, cell canonicalisation, the
    owns splitter). Every one of those is provably inert on ASCII; this is what says so out loud.
    """
    res = extract_docs([parse_file(ENG / "Team_Roster.xlsx"),
                        parse_file(ENG / "Lena_Park_Resume.docx")])
    got = {(p.id, p.name, p.role, p.team, p.tenure, tuple(p.owns)) for p in res.people}
    assert got == {
        ("u_lena_park", "Lena Park", "Product Designer", "Design", "18 months",
         ("Owned the core shopping-guide flow end to end",
          "Led the recommendation-cards redesign with the research team",
          "Collaborates closely with engineering on the profile dialog")),
        ("u_marcus_reid", "Marcus Reid", "Senior Engineer", "Eng", "joined 14 months ago", ()),
        ("u_priya_shah", "Priya Shah", "Design Technologist", "Eng", "7 weeks", ()),
        ("u_jordan_wells", "Jordan Wells", "Staff Engineer", "Eng", "3 years", ()),
    }, f"the English roster path moved: {sorted(got)}"
