"""feat-048 ROUND 3 -> feat-054: H4, the Chinese project axis. QUARANTINE RETIRED FOR LAYERS A & B.

WHAT THIS FILE WAS. Five `xfail(strict=True)` tests holding a measured, argued record that the
project axis was dead — and dead in a way no amount of teaching the regexes Chinese would fix. The
original diagnosis, preserved because it is what made the fix findable:

    MEASURED, on a PURE-ENGLISH document with ASCII labels and no Han anywhere:

        Project: Alpha Launch      Owner: Lena Park     Status: on-track
        Project: Beta Rollout      Owner: Marcus Reid   Status: blocked

        -> projects == [('p_beta_rollout', 'Beta Rollout', 'Marcus Reid')]

    Alpha Launch is GONE. `_projects_from_doc` accumulated title/owner/status/progress into SCALAR
    locals across the whole document and appended ONE ProjectEntity at the end, so every project but
    the last was overwritten in place.

    LAYER A (structural, English-native): one document == one project.
    LAYER B (ZH labels): 「项目：/负责人：/状态：/进度：/阻塞：」 matched nothing.
    LAYER C (signals): `_first_person_name` is `\\b([A-Z][a-z]+...)` — ASCII-only — and the interrupt
            rule requires an ASCII `\\d+`, so 「孙 浩 本周吸收了三次排期变更」 fails twice over.

    and Layer B was worthless without Layer A: teaching the labels Chinese would have collapsed the
    ZH weekly's two projects into one (the last), not surfaced two.

WHAT CHANGED (feat-054). Layers A and B are FIXED, and the four tests below now run as ordinary
regression gates rather than xfails:

  * LAYER A — `granularity.segment_projects` cuts a document at its own project labels and
    `_projects_from_doc` scans each span independently, so N labelled projects yield N entities.
    A document with one labelled project still scans whole-document, so every pre-054 English
    fixture is byte-identical.
  * LAYER B — the field labels are read in both languages.

The same ticket closed the OPPOSITE failure on this axis (the LLM path promoting 「里程碑」 rows to
projects — 17 "projects" out of a 6-project weekly); see test_project_granularity.py. Both were the
same hole: nothing ever defined what one project IS.

WHAT IS STILL QUARANTINED. Exactly one test, and it is NOT the project axis:
`test_zh_person_signal_is_extracted_and_refs_an_id` is LAYER C, the SIGNAL axis. It needs
`_first_person_name` to stop being ASCII-only and the interrupt rule to read Han numerals (「三次」;
note the English line in that fixture says "three rounds" and fails the same `\\d+` test, so this is
not a CJK bug either). That is a different function, a different surface, and a different
regression budget from project granularity — feat-054 deliberately did not touch it rather than
braid an unrelated rewrite into an extraction fix. It stays strict-xfail so it cannot rot: the day
someone fixes signals, pytest turns red here and this note gets retired with it.
"""
from __future__ import annotations

from pathlib import Path

import pytest

from avery.ingest import HeuristicExtractor, extract_docs, parse_file

HERE = Path(__file__).resolve().parent
CJK = HERE / "fixtures" / "cjk"

ZH_WEEKLY = CJK / "Sanya_Project_Weekly_ZH.md"
EN_WEEKLY = CJK / "Sanya_Project_Weekly.md"
SPACING_DUTY = CJK / "Spacing_Variant_Duty_Weekly.md"


def _heuristic(*paths: Path):
    return extract_docs([parse_file(p) for p in paths], extractor=HeuristicExtractor())


def test_zh_weekly_yields_its_real_projects():
    """H4 LAYER B, CLOSED. Sanya_Project_Weekly_ZH.md states two projects with 「项目：」. Before
    feat-054 this returned ONE PHANTOM named after the document's own `#` heading — a project card
    called 'the weekly report', owned by nobody. That is the failure mode worth remembering: not an
    empty screen the customer reports as broken, but a populated screen that is confidently wrong."""
    res = _heuristic(ZH_WEEKLY)
    titles = {p.title for p in res.projects}
    assert titles == {"销售 FAQ 梳理", "客房夜床服务复核"}, f"got {titles}"


def test_zh_weekly_resolves_owners_to_real_people():
    """H4 LAYER B, CLOSED. 「负责人：陈思雨」must resolve to a person, not sit as a bare name."""
    res = _heuristic(ZH_WEEKLY)
    owners = {p.title: p.ownerName for p in res.projects}
    assert owners.get("销售 FAQ 梳理") == "陈思雨", f"got {owners}"


def test_zh_weekly_surfaces_the_blocker():
    """H4 LAYER B, CLOSED. 「阻塞：退改签口径未确认，法务尚未回复」is the most decision-relevant line
    in the weekly and used to be extracted nowhere — not as a blocker, not as a signal. Losing it
    meant a manager saw a weekly with nothing at risk, which for a product whose whole claim is
    surfacing what you missed is the worst available outcome."""
    res = _heuristic(ZH_WEEKLY)
    blockers = [b for p in res.projects for b in p.blockers]
    assert any("退改签" in b for b in blockers), f"got {blockers}"


def test_english_weekly_with_two_projects_yields_two_projects():
    """H4 LAYER A, CLOSED — THE LOAD-BEARING ONE. No Han anywhere in the labels; this is the
    pure-English half of H4 and the proof that 'teach the regexes Chinese' was never the fix. Until
    feat-054 segmented the document, 销售 FAQ 梳理 was overwritten by 运营 FAQ 梳理 and only the last
    project in any document survived — in English, and in every language."""
    res = _heuristic(EN_WEEKLY)
    titles = {p.title for p in res.projects}
    assert titles == {"销售 FAQ 梳理", "运营 FAQ 梳理"}, (
        f"got {titles} — an English-labelled document with two 'Project:' lines yielded "
        f"{len(res.projects)} project(s)"
    )


@pytest.mark.xfail(strict=True, reason="H4 LAYER C — SIGNAL axis, not the project axis: "
                                       "_first_person_name is ASCII-only and the interrupt rule "
                                       "needs an ASCII \\d+. Out of feat-054's scope; see module "
                                       "docstring.")
def test_zh_person_signal_is_extracted_and_refs_an_id():
    """STILL QUARANTINED — and deliberately so; see the module docstring for the scope argument.

    「孙 浩 本周吸收了三次排期变更」 fails twice: _first_person_name matches `[A-Z][a-z]+` (no Han),
    and the interrupt rule needs an ASCII `\\d+` while the document says 三次. Note the same fixture's
    ENGLISH line ("Lena Park absorbed three rounds of unplanned changes") fails on the identical
    `\\d+` test, so this is a numeral-parsing and name-regex gap, not a CJK gap."""
    res = _heuristic(SPACING_DUTY)
    person_sigs = [s for s in res.signals if s.subjectType == "person"]
    assert person_sigs, "no person-directed signal extracted from the ZH duty weekly"
    assert all(s.subjectRef.startswith("u_") for s in person_sigs), (
        f"subjectRef is still a name, not an id: {[s.subjectRef for s in person_sigs]}"
    )
