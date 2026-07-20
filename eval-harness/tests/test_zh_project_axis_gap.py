"""feat-048 ROUND 3 — H4 QUARANTINE: the Chinese project/signal axis is dead, and it is NOT a
CJK bug. Every test here is `xfail(strict=True)`: it must FAIL today, and the moment it starts
passing pytest turns RED so nobody can quietly close this gap without retiring the quarantine.

🔴 2026-07-20 UPDATE, ONE TEST RETIRED (`test_zh_weekly_surfaces_the_blocker` below), the other
two LEFT QUARANTINED. A minimal, independent fix for the zh512 production subset (adversarial
review item 2 — see tests/test_zh_blocker_risk_label.py) taught `_projects_from_doc` the label
vocabulary `阻碍项|阻碍|阻塞|卡点|风险点`. That is a whole-document scalar scan, same as the
ASCII blocker regex it sits next to, so it does not need Layer A (the segment-per-project
restructure) to fire — it just needed the word. Measured: the guard below turned RED as an
XPASS(strict) the moment that landed, exactly as designed. Retiring it here is a deliberate,
visible act, not a quiet one.
DO NOT read this as H4 being closed. Layer A (one-doc-one-project) and Layer C (Han person-signal
matching) are UNTOUCHED and still xfail below. The retired test's own blocker string still lands
on the WRONG project — the phantom "本周项目周报" card, not "销售 FAQ 梳理" — because Layer A
still overwrites per-project boundaries with one scalar accumulator. The text surfaces; the
attribution is still a lie. See the retired test's docstring for the exact measurement.

WHY QUARANTINED RATHER THAN GATED RED — the scope argument, with the measurement that drives it.

The brief framed H4 as "the label regexes are ASCII, so 「项目：」doesn't match, so Chinese docs
yield 0 projects; teach the labels Chinese." The first half is true. The prescription does not
work, and the reason is the finding of this file:

    MEASURED, on a PURE-ENGLISH document with ASCII labels and no Han anywhere:

        # Weekly
        Project: Alpha Launch      Owner: Lena Park     Status: on-track
        Project: Beta Rollout      Owner: Marcus Reid   Status: blocked

        -> projects == [('p_beta_rollout', 'Beta Rollout', 'Marcus Reid')]

    Alpha Launch is GONE. `_projects_from_doc` accumulates title/owner/status/progress into SCALAR
    locals across the whole document and appends ONE ProjectEntity at the end, so every project but
    the last is overwritten in place. The doc-per-project assumption is structural, English-native,
    and has been live since the function was written.

So the Chinese weekly's two projects (销售 FAQ 梳理, 客房夜床服务复核) would NOT come back if the
labels learned Chinese. They would collapse into one — the last one. H4 is two defects stacked:

    LAYER A (structural, English-native, invisible in every ASCII fixture because none has two
             projects in one file): one document == one project.
    LAYER B (ZH labels): 「项目：/负责人：/状态：/进度：/阻塞：」 match nothing.

and Layer B is worthless without Layer A. There is a third, equally fatal layer for signals:
`_first_person_name` is `\\b([A-Z][a-z]+...)` — ASCII-only — and the interrupt rule requires an
ASCII `\\d+`, so 「孙 浩 本周吸收了三次排期变更」 fails twice over (Han name, Han numeral 三). ZH
person-signals are unreachable no matter what the labels do.

THE SCOPE CALL — this is a separate ticket, for three reasons:

  1. FIXING IT CHANGES ENGLISH OUTPUT. Layer A's fix (segment the document, emit one entity per
     project) makes the English weekly go 1 project -> 2. That is a correction, but this round runs
     under an iron "English behavior does not move" rule with byte-level id freezes, and it needs
     its own English-impact budget and its own regression sweep — not a rider on someone else's.
  2. IT IS A RESTRUCTURE, NOT A REGEX. Scalar-accumulate -> segment-and-emit changes what a
     "document" means to the extractor, and drags in _link_owners and _signals_from_doc's project
     anchoring (`proj_ref`, currently also single-valued). Different shape of work, different review.
  3. THIS ROUND CARRIES A RED-LINE BLOCKER (H1). H1 is a live hole in the product's central
     promise; braiding a structural rewrite into the same diff makes both harder to verify and
     makes a bad H1 fix easier to miss. H1 should land small and provable.

WHAT SANYA GETS IF THIS IS NOT DONE — stated plainly, because "we deferred it" is not a finding:

  The people axis works (7/7 Han names, unique ids, real departments). The project axis ships a LIE,
  and that is worse than shipping nothing. Measured on Sanya_Project_Weekly_ZH.md today:

        projects == [('p_三亚亚特兰蒂斯别墅酒店_本周项目周报',
                      '三亚亚特兰蒂斯别墅酒店 — 本周项目周报',
                      ownerName='', status='', progress=None)]
        signals  == []

  Not zero projects — ONE PHANTOM. `_projects_from_doc`'s no-title fallback grabs the document's `#`
  heading, so the customer's weekly report becomes a "project" named after the report itself, owned
  by nobody, with no status and no progress. The two projects that exist (销售 FAQ 梳理 at 48% and
  at-risk with a legal blocker; 客房夜床服务复核) are invisible, and so is the blocker
  「退改签口径未确认，法务尚未回复」— the single most decision-relevant line in the document.

  So the failure mode is not an empty screen the customer would report as broken. It is a populated
  screen that is confidently wrong: a project card with a report's name, and a manager who believes
  Avery has read the weekly and found nothing at risk. An empty state says "give me more data"; this
  says "everything is fine." For a product whose entire claim is surfacing what a manager missed,
  silently swallowing the one at-risk item is the worst available outcome — which is why this file
  is strict-xfail and not a TODO.

  This does NOT block a Sanya pilot on the people axis, and it is not what H1 is (H1 ships harm; H4
  ships absence dressed as presence). It does mean any Sanya demo that opens the project tab is
  showing a fabrication, and the ticket should be next, not someday.
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


@pytest.mark.xfail(strict=True, reason="H4 LAYER B — ZH project labels unmatched; separate ticket")
def test_zh_weekly_yields_its_real_projects():
    """Sanya_Project_Weekly_ZH.md states two projects with 「项目：」. Today: one phantom named after
    the document's own heading."""
    res = _heuristic(ZH_WEEKLY)
    titles = {p.title for p in res.projects}
    assert titles == {"销售 FAQ 梳理", "客房夜床服务复核"}, f"got {titles}"


@pytest.mark.xfail(strict=True, reason="H4 LAYER B — 「负责人：」unmatched, ownerId unresolved")
def test_zh_weekly_resolves_owners_to_real_people():
    """「负责人：陈思雨」must resolve to a person, not sit as a bare name."""
    res = _heuristic(ZH_WEEKLY)
    owners = {p.title: p.ownerName for p in res.projects}
    assert owners.get("销售 FAQ 梳理") == "陈思雨", f"got {owners}"


def test_zh_weekly_surfaces_the_blocker():
    """RETIRED from H4 quarantine 2026-07-20. 「阻塞：退改签口径未确认，法务尚未回复」used to be
    extracted nowhere — not as a blocker, not as a signal. It is now, via the independent minimal
    fix in `_projects_from_doc` (see tests/test_zh_blocker_risk_label.py) that taught the blocker
    scan the label vocabulary `阻碍项|阻碍|阻塞|卡点|风险点`.

    🔴 STILL A LIE, JUST A SMALLER ONE. This assertion does not check WHICH project the blocker
    landed on, and it should not be read as if it does: Layer A (below, still xfail) means this
    document still yields exactly ONE project — a phantom named after the `#` heading, not either
    of the two real ones — and the blocker text is scalar-accumulated onto THAT phantom, not onto
    「销售 FAQ 梳理」 where the document actually puts it. A manager reading the real product would
    see the warning on the wrong card. That misattribution is Layer A's bug, unrelated to and not
    fixed by this test's passing, and remains open in `test_zh_weekly_yields_its_real_projects`."""
    res = _heuristic(ZH_WEEKLY)
    blockers = [b for p in res.projects for b in p.blockers]
    assert any("退改签" in b for b in blockers), f"got {blockers}"
    # pin the misattribution so it stays visible rather than silently "fixing itself" unnoticed
    titles_with_that_blocker = {p.title for p in res.projects if any("退改签" in b for b in p.blockers)}
    assert titles_with_that_blocker != {"销售 FAQ 梳理"}, (
        "if this fails, Layer A got fixed as a side effect — go update the quarantine note above, "
        "do not just delete this assertion")


@pytest.mark.xfail(strict=True, reason="H4 LAYER A — STRUCTURAL, ENGLISH-NATIVE: one doc, one project")
def test_english_weekly_with_two_projects_yields_two_projects():
    """THE LOAD-BEARING ONE. No Han anywhere in the labels; this is the pure-English half of H4 and
    the proof that 'teach the regexes Chinese' is not the fix. _projects_from_doc keeps scalar
    locals and appends once, so 销售 FAQ 梳理 is overwritten by 运营 FAQ 梳理 and only the last
    project in any document survives — in English, today, and for as long as this xfails."""
    res = _heuristic(EN_WEEKLY)
    titles = {p.title for p in res.projects}
    assert titles == {"销售 FAQ 梳理", "运营 FAQ 梳理"}, (
        f"got {titles} — an English-labelled document with two 'Project:' lines yielded "
        f"{len(res.projects)} project(s)"
    )


@pytest.mark.xfail(strict=True, reason="H4 LAYER C — _first_person_name is ASCII-only; ZH numerals unmatched")
def test_zh_person_signal_is_extracted_and_refs_an_id():
    """H2's integration ask, in the half that H2's fix CANNOT deliver — recorded here rather than in
    the H2 gate so the H2 gate stays honestly closable.

    「孙 浩 本周吸收了三次排期变更」 fails twice: _first_person_name matches `[A-Z][a-z]+` (no Han),
    and the interrupt rule needs an ASCII `\\d+` while the document says 三次. So no ZH person-signal
    exists to carry a subjectRef, whatever _looks_like_name does. Fixing _HAN_NAME_RE makes 孙 浩 a
    PERSON; it does not make him a SIGNAL SUBJECT."""
    res = _heuristic(SPACING_DUTY)
    person_sigs = [s for s in res.signals if s.subjectType == "person"]
    assert person_sigs, "no person-directed signal extracted from the ZH duty weekly"
    assert all(s.subjectRef.startswith("u_") for s in person_sigs), (
        f"subjectRef is still a name, not an id: {[s.subjectRef for s in person_sigs]}"
    )
