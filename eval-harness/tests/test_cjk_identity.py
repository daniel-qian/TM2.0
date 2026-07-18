"""feat-048 GATE — CJK identity + cross-document dedup. GATE-FIRST: written to be BORN RED.

WHY THIS FILE EXISTS (the deepest lesson of this round): the entire gate/corpus surface was
ASCII IN DISGUISE. The official seed is PrismDesign_TeamProfile_EN.xlsx; both stub transports
(src/lite/stubTransport.ts, src/lite2/stubTransport.ts) staff a Chinese company with pinyin names
(Lin Qing / Chen Mingyuan / Sun Xiaomei). NOT ONE HAN CHARACTER EVER ENTERED A NAME FIELD, so two
production-fatal bugs lived for 42 features under a full green board. The first customer is an
all-Chinese Sanya villa hotel. Fixing the code without landing real Han corpus in the gate is
indistinguishable from not fixing it — hence tests/fixtures/cjk/*.md (real 汉字, UTF-8).

The two blockers these assertions pin down:

  BUG-1  extract.py::_slug uses `re.sub(r"[^a-z0-9]+", "_", ...)`. Han characters are outside
         [a-z0-9], so every one becomes "_", .strip("_") shaves them off, the string empties and
         the 'x' fallback fires: '陈思雨' '李明轩' '周雅婷' '孙浩' ALL collapse to 'u_x'. Real
         machine: 39 people -> 1 unique id. Downstream, DetailOverlay.tsx:37 `.find(p => p.id ===
         detail.id)` returns the first match, so tapping ANY person card opens 陈思雨, signals
         cross-wire via :33, and TeamScreen.tsx:103 `key={person.id}` emits 303 duplicate-key
         warnings. Partial-ASCII strings collide too: 「销售 FAQ」and「运营 FAQ」both -> 'p_faq'.

  BUG-2  extract.py::merge is a pure concat. llm_extract.py::_build dedupes people WITHIN one doc
         (seen_people, key = re.sub(r"\\s+", " ", name.lower())), but extract_docs merges docs with
         no equivalent step. Real machine: 3 seed files -> people=39 but only 20 unique names.
         This one is live in ENGLISH TOO (see test_english_lena_park_is_deduped_across_docs) —
         it has simply never been asserted.

DETERMINISM: no network, no key, no real model. The LLM path is driven by _DocKeyedBrain, a
scripted brain that answers off the doc name in the prompt (so it is stable no matter which order
extract_docs' thread pool calls it in). This matters: the real-machine u_x collapse comes from the
LLM path, and the offline heuristic cannot reach _slug with a Han name at all (see BUG-3 below).

ROUND 2 (feat-048 second pass) — BUG-3 IS NOW IN SCOPE, plus three more findings the round-1
adversarial verification dug out. The `bug3` marker is RETIRED: what was a quarantined trap at the
bottom of this file is now a gate that must go green.

  BUG-3  extract.py::_looks_like_name requires `^[A-Z][A-Za-z.\\-]+...` — ASCII uppercase. Han has
         no case, so the HEURISTIC drops every Chinese name before _slug is ever called. The
         heuristic is a REAL PRODUCTION PATH, not a test-only fallback: extractor_factory.py:87
         (LLM budget exhausted) and llm_extract.py:216/222/227 (model failure / red-line breach /
         no entities) all fall back to it. Measured on a real Han roster: people ==
         [("u_lin_qing", "Lin Qing")] — zero Chinese colleagues, empty projects. In any degraded
         ingest the Sanya customer gets an empty team. Its sibling is service/live_input.py:34
         `_slugify`, which collapses EVERY Chinese situation to the constant "live-situation".
         The reverse half matters as much as the forward half: widening the regex must NOT start
         accepting 「姓名」「职位」「部门」as people (see the _NOT_NAME stop-list, which r2's follow-up
         made the single source of truth for BOTH paths — llm_extract._not_a_person now reads it
         rather than hand-copying it, and llm_extract.py:76-77 tells the model the same in prose).

  BUG-4  extract.py::_norm_team loops `if raw in t.lower(): return t` — and the EMPTY STRING is a
         substring of every string, so _norm_team("") / ("  ") / (None) all return TEAMS[0] ==
         "Founders". Worse, TEAMS is a startup taxonomy (Founders/Eng/Product/Design/GTM/Ops) that
         no real hotel department maps onto, so 前厅部/客房部/餐饮部/市场推广部/销售部 ALL become ""
         and then "Founders". Observed on the real machine through Playwright: 「陈思雨 项目负责人
         · Founders」— a Sanya hotel's sales lead filed under Founders.

  RULER MISMATCH (a real regression round 1 introduced): _dedupe_entities keys people with
         _person_key (folds \\s+), while _link_owners:516 keys `by_name` with a bare `p.name.lower()`
         (folds nothing). Two rulers for "same person": dedup collapses spelling variants onto the
         FIRST spelling, so by_name never contains the second — and a person-signal pointing at the
         second spelling is silently orphaned (subjectRef stays a name, never becomes an id).
         Projects escape via _link_owners' first-name fallback; signals have NO fallback.

  GATE HOLES M5/M9 (round 1's gate was not as strict as it looked — mutation-proven):
         M5  the scalar enrichment (role/team/tenure) was an EMPTY assertion: every fixture put the
             identity-bearing roster FIRST, so keep-first and merge-enrich are indistinguishable.
             Replacing the whole `cur.role = cur.role or p.role` block with `pass` kept the gate
             green. The round-2 gate breaks the ordering assumption on purpose.
         M9  signal dedup was ZERO-COVERAGE: no fixture had the same signal in two documents, so
             `_signal_key` and the dedup loop never executed. Replacing `continue` with `pass`
             (i.e. deleting dedup) kept the gate green.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from avery.brain import BrainResponse
from avery.ingest import LLMExtractor, HeuristicExtractor, extract_docs, parse_file
from avery.ingest.extract import _looks_like_name, _norm_team, _slug

HERE = Path(__file__).resolve().parent
CJK = HERE / "fixtures" / "cjk"
ENG = HERE / "fixtures" / "ingest"

CJK_ROSTER = CJK / "Sanya_Team_Roster.md"
CJK_WEEKLY = CJK / "Sanya_Project_Weekly.md"

# --- round-2 corpus -----------------------------------------------------------------------------
# WHY NEW FILES INSTEAD OF EDITING THE ROUND-1 ONES: Sanya_Team_Roster.md is REAL Han in the *name*
# column, but its header row and its Team column are still ASCII (Name|Role|Team|Tenure|Owns,
# Operations/Growth/Design) — i.e. the gate that was built to end "ASCII in disguise" was itself
# still ASCII in disguise on the team field. A real Sanya roster writes 「姓名|职位|部门|司龄|负责」
# and puts 「前厅部」in the department column. Rather than edit the round-1 fixtures (which 33 green
# assertions are pinned to, and whose edit could silently defuse them), round 2 ADDS corpus:
#
#   Sanya_Team_Roster_ZH.md      fully-Chinese roster: Chinese header row + Chinese departments.
#                                Drives BUG-3 (names) and BUG-4 (departments) through the HEURISTIC.
#   Sanya_Project_Weekly_ZH.md   fully-Chinese weekly (项目/负责人/状态/进度/阻塞).
#   Sanya_Ops_Handover_ZH.md     a handover memo that COPY-PASTES the weekly's blocker line verbatim
#                                and then restates the same risk in the writer's own words — the
#                                most ordinary way a literal cross-document signal clone is born.
#   Spacing_Variant_Roster.md    the whitespace-variant pair for the ruler-mismatch gate: a roster
#   Spacing_Variant_Duty_Weekly.md  padding 「孙　浩」with U+3000 (the standard Chinese way to align a
#                                two-character name against a three-character one) and a second,
#                                separately-authored table padding the same name with a half-width
#                                space — plus 'Lena  Park' / 'Lena Park', the English paste artifact.
ZH_ROSTER = CJK / "Sanya_Team_Roster_ZH.md"
ZH_WEEKLY = CJK / "Sanya_Project_Weekly_ZH.md"
ZH_HANDOVER = CJK / "Sanya_Ops_Handover_ZH.md"
SPACING_ROSTER = CJK / "Spacing_Variant_Roster.md"
SPACING_WEEKLY = CJK / "Spacing_Variant_Duty_Weekly.md"


def test_cjk_fixtures_present_and_actually_contain_han():
    """The fixtures are the point. If they ever drift back to ASCII the whole file is theatre."""
    for f in (CJK_ROSTER, CJK_WEEKLY):
        assert f.exists(), f"missing CJK fixture {f}"
        text = f.read_text(encoding="utf-8")
        assert any("一" <= ch <= "鿿" for ch in text), f"{f.name} has no Han characters"
    # the names we assert on must really be in the corpus, as real Han, in BOTH docs
    for name in ("陈思雨", "李明轩", "周雅婷"):
        assert name in CJK_ROSTER.read_text(encoding="utf-8")
    for name in ("陈思雨", "周雅婷"):
        assert name in CJK_WEEKLY.read_text(encoding="utf-8")


# === scripted brain (deterministic, offline) ===================================================

class _DocKeyedBrain:
    """Answers off the document name in the prompt, not off call order.

    extract_docs fans out across a ThreadPoolExecutor (max_workers defaults to 4), so a
    counter-based fake (test_llm_extract.FakeBrain) would hand payloads to whichever doc's thread
    happened to call first. Keying on the prompt's `Document: <name>` line makes these gates
    deterministic under concurrency.
    """
    name = "cjk-fake"

    def __init__(self, by_doc: dict):
        self._by_doc = dict(by_doc)

    def respond(self, system, conversation, tools):
        user = conversation[0]["content"][0]["text"]
        for doc_name, payload in self._by_doc.items():
            if f"Document: {doc_name}" in user:
                return BrainResponse(text=json.dumps(payload, ensure_ascii=False))
        return BrainResponse(text=json.dumps({"people": [], "projects": [], "signals": []}))


# The roster carries IDENTITY (role/team/tenure) and no ownership; the weekly carries BEHAVIOUR
# (owns) and no identity. This mirrors the real English split (Team_Roster.xlsx has team but no
# owns; Lena_Park_Resume.docx has owns but no team) — neither record is complete on its own, which
# is exactly why cross-doc dedup must MERGE-ENRICH rather than keep-first.
_ROSTER_PAYLOAD = {
    "people": [
        {"name": "陈思雨", "role": "前厅部经理", "team": "Operations", "tenure": "3 年",
         "owns": [], "line": 6},
        {"name": "李明轩", "role": "客房部主管", "team": "Operations", "tenure": "5 年",
         "owns": [], "line": 7},
        {"name": "周雅婷", "role": "市场推广专员", "team": "Growth", "tenure": "2 年",
         "owns": [], "line": 8},
        {"name": "孙浩", "role": "餐饮部领班", "team": "Operations", "tenure": "4 年",
         "owns": [], "line": 9},
        {"name": "Lin Qing", "role": "Design Director", "team": "Design", "tenure": "8 years",
         "owns": [], "line": 10},
    ],
    # The roster's Owns column names the same two projects the weekly reports on — so projects, like
    # people, arrive from BOTH docs and are half-filled in each (roster: title+owner only; weekly:
    # status/progress/blockers). Without this the project-dedup gate would be vacuously green.
    "projects": [
        {"title": "销售 FAQ 梳理", "ownerName": "陈思雨", "line": 6},
        {"title": "运营 FAQ 梳理", "ownerName": "李明轩", "line": 7},
    ],
    "signals": [],
}

_WEEKLY_PAYLOAD = {
    "people": [
        {"name": "陈思雨", "role": "", "team": "", "tenure": "",
         "owns": ["销售 FAQ 梳理", "前台交接流程重写"], "line": 16},
        {"name": "李明轩", "role": "", "team": "", "tenure": "",
         "owns": ["运营 FAQ 梳理"], "line": 12},
        {"name": "周雅婷", "role": "", "team": "", "tenure": "",
         "owns": ["别墅套餐推广物料返工"], "line": 17},
    ],
    "projects": [
        {"title": "销售 FAQ 梳理", "ownerName": "陈思雨", "status": "at-risk", "progress": 48,
         "blockers": ["等待法务确认退改签口径"], "line": 5},
        {"title": "运营 FAQ 梳理", "ownerName": "李明轩", "status": "on-track", "progress": 70,
         "blockers": [], "line": 11},
    ],
    "signals": [
        {"subjectType": "person", "subjectRef": "陈思雨", "tag": "interrupt",
         "summary": "本周吸收了三次排期变更，前台交接流程重写了两遍", "line": 16},
        {"subjectType": "person", "subjectRef": "周雅婷", "tag": "interrupt",
         "summary": "承接了别墅套餐推广物料的全部返工", "line": 17},
    ],
}

_CJK_NAMES = {"陈思雨", "李明轩", "周雅婷", "孙浩", "Lin Qing"}


def _cjk_extract():
    """Real parse -> real extract_docs -> real _slug / merge. Only the model is scripted."""
    return _scripted_extract([(CJK_ROSTER, _ROSTER_PAYLOAD), (CJK_WEEKLY, _WEEKLY_PAYLOAD)])


def _scripted_extract(files_and_payloads):
    """Round 2's generalisation of _cjk_extract: run the REAL pipeline over the given documents in
    the given ORDER, with a scripted answer per document.

    Order is a parameter because it is load-bearing: the M5 hole existed precisely because every
    round-1 fixture happened to feed the identity-bearing roster first.
    """
    docs = [parse_file(f) for f, _ in files_and_payloads]
    brain = _DocKeyedBrain({f.name: payload for f, payload in files_and_payloads})
    ex = LLMExtractor(brain, retry_backoff_s=0)
    res = extract_docs(docs, extractor=ex)
    assert not ex.degraded, (
        "the scripted brain fell back to the heuristic — this gate would then be testing "
        "BUG-3 (_looks_like_name drops Han names), not the bug it is named after. Fix the "
        "payload, not the gate."
    )
    return res


# === BUG-1 · unit: _slug =======================================================================

def test_slug_gives_distinct_ids_to_distinct_cjk_names():
    """THE MAIN EVENT. Four different colleagues must not be four copies of the same id.

    Today all four are 'u_x': [^a-z0-9] eats every Han char -> strip('_') empties the string ->
    the 'x' fallback fires. On the real machine this is what makes 39 people share one id and
    makes every person card open 陈思雨.
    """
    names = ["陈思雨", "李明轩", "周雅婷", "孙浩"]
    ids = [_slug(n, "u") for n in names]
    assert len(set(ids)) == len(names), (
        f"CJK names collapsed to {len(set(ids))} id(s) for {len(names)} people: "
        f"{dict(zip(names, ids))}"
    )


def test_slug_never_falls_back_to_the_x_placeholder_for_a_real_cjk_name():
    """Tightening test above: N distinct ids could in principle be reached by counter suffixes
    (u_x_1, u_x_2). That would be WRONG — id must stay a pure function of the normalized name
    (extract.py:516 `by_name` and the whole owner/signal link chain depend on it). A real name
    must produce a real id, and the Han must survive INTO it."""
    for name in ("陈思雨", "李明轩", "周雅婷", "孙浩"):
        sid = _slug(name, "u")
        assert sid != "u_x", f"{name!r} degraded to the empty-string placeholder {sid!r}"
        assert any("一" <= ch <= "鿿" for ch in sid), (
            f"{name!r} -> {sid!r}: the Han was dropped rather than carried into the id"
        )


def test_slug_does_not_silently_drop_the_cjk_half_of_a_mixed_name():
    """'张伟 Wei' and '李娜 Wei' are different people. Today both -> 'u_wei': the Han segment is
    discarded without a trace. Any fix that merely FILTERS non-ASCII re-creates this collision."""
    assert _slug("张伟 Wei", "u") != _slug("李娜 Wei", "u"), (
        f"mixed CJK/ASCII names collided: 张伟 Wei -> {_slug('张伟 Wei', 'u')!r}, "
        f"李娜 Wei -> {_slug('李娜 Wei', 'u')!r}"
    )


def test_slug_mixed_cjk_ascii_titles_do_not_collide():
    """Proof that PARTIAL ASCII is not safety: 「销售 FAQ 梳理」and「运营 FAQ 梳理」are two
    different projects whose only ASCII is the shared token 'FAQ' — so today they are both
    'p_faq'. This is why the real machine reports 26 projects / 2 unique ids: 「销售 FAQ」was the
    single survivor precisely because FAQ is ASCII."""
    a, b = _slug("销售 FAQ 梳理", "p"), _slug("运营 FAQ 梳理", "p")
    assert a != b, f"销售 FAQ 梳理 and 运营 FAQ 梳理 both slugged to {a!r}"


def test_slug_long_cjk_titles_stay_distinct_and_keep_their_han():
    """A realistic Sanya-length project title (24-25 chars, i.e. inside the s[:32] cut) must keep
    its Han and stay distinct from its sibling. Today BOTH collapse to 'p_x'.

    SCOPE NOTE — the s[:32] truncation itself is deliberately NOT gated here. It is a real
    collision source, but measurement says it is neither CJK-specific nor made worse by CJK: two
    English titles sharing 32 characters already collide today ('...east wing' and '...west wing'
    both -> 'p_front_desk_guest_arrival_and_lug'), while Chinese is information-dense enough that
    32 characters usually carry a whole title. So truncation is a pre-existing, English-included,
    orthogonal defect — it belongs to its own ticket, not to the two blockers. Gating it here would
    hold the CJK fix hostage to an unrelated redesign of the id scheme.
    """
    a = _slug("三亚亚特兰蒂斯别墅酒店前厅部宾客接待动线优化项目", "p")
    b = _slug("三亚亚特兰蒂斯别墅酒店前厅部宾客接待满意度回访项目", "p")
    assert a != b, f"two long CJK titles both slugged to {a!r}"
    assert "三亚" in a and "满意度" in b, f"long CJK titles lost their Han: {a!r} / {b!r}"


# === BUG-1 · the ENGLISH BYTE CONTRACT (this one is BORN GREEN — it is the safety catch) =======
#
# 42 features' worth of evidence rests on English ids. This test does not describe a bug; it turns
# the spoken iron rule ("English behaviour must not change, byte for byte") into an executable one,
# so that the CJK fix cannot buy Chinese correctness with an English regression. It must be GREEN
# BEFORE the fix and GREEN AFTER.

@pytest.mark.parametrize("text,prefix,expected", [
    ("Lin Qing", "p", "p_lin_qing"),
    ("Lin Qing", "u", "u_lin_qing"),
    ("Chen Mingyuan", "p", "p_chen_mingyuan"),
    ("Chen Mingyuan", "u", "u_chen_mingyuan"),
    ("Sales FAQ", "u", "u_sales_faq"),
    ("Lena Park", "u", "u_lena_park"),
    ("Sun Xiaomei", "u", "u_sun_xiaomei"),
    # underscore folding — the discriminating case. `\w` counts '_' as a word char, so a naive
    # `[^\w]+` fix yields 'p_roadmap__q3' (a byte-level English regression). `[\W_]+` keeps this
    # green. This row is the audit's conclusion, nailed down permanently.
    ("Roadmap_ Q3", "p", "p_roadmap_q3"),
    ("Phase 1 rollout", "p", "p_phase_1_rollout"),
    ("Core-Flow  Weekly", "p", "p_core_flow_weekly"),
    ("  Jordan Wells  ", "u", "u_jordan_wells"),
    # empty/degenerate input keeps its historical placeholder — only REAL names must stop being 'x'
    ("", "u", "u_x"),
    ("!!!", "u", "u_x"),
])
def test_slug_ascii_output_is_byte_frozen(text, prefix, expected):
    assert _slug(text, prefix) == expected


def test_slug_ascii_truncation_boundary_is_byte_frozen():
    """s[:32] is part of the English contract too — pin the exact cut, not just the charset."""
    long_en = "Shopping guide flow acceptance and rollout plan"
    # 'shopping_guide_flow_acceptance_a' is exactly 32 chars — the cut lands mid-word, which is
    # itself part of the frozen behaviour.
    assert _slug(long_en, "p") == "p_shopping_guide_flow_acceptance_a"


# === BUG-1 · integration: real fixtures through extract_docs ===================================

def test_cjk_ingest_gives_every_person_a_unique_id():
    """Integration-level BUG-1: this is the assertion that would have caught the real machine's
    'uniquePersonIds=1' and every person card opening 陈思雨."""
    res = _cjk_extract()
    ids = [p.id for p in res.people]
    assert len(set(ids)) == len(ids), (
        f"{len(ids)} people share only {len(set(ids))} id(s): "
        f"{[(p.name, p.id) for p in res.people]}"
    )


def test_cjk_ingest_gives_every_project_a_unique_id():
    """Integration-level BUG-1 on projects: 「销售 FAQ 梳理」vs「运营 FAQ 梳理」-> both 'p_faq'."""
    res = _cjk_extract()
    ids = [pr.id for pr in res.projects]
    assert len(set(ids)) == len(ids), (
        f"{len(ids)} projects share only {len(set(ids))} id(s): "
        f"{[(pr.title, pr.id) for pr in res.projects]}"
    )


def test_cjk_person_signals_link_to_the_right_person():
    """The串人 regression at the data layer. _link_owners (extract.py:529-533) rewrites a person
    signal's subjectRef to the person's id; with every id == 'u_x' both signals point at the same
    person and DetailOverlay.tsx:33 (sig.subjectId === detail.id) shows 周雅婷's load on 陈思雨's
    card. Two signals about two different people must resolve to two different ids."""
    res = _cjk_extract()
    by_name = {p.name: p.id for p in res.people}
    person_sigs = [s for s in res.signals if s.subjectType == "person"]
    assert len(person_sigs) == 2, f"expected 2 person signals, got {len(person_sigs)}"
    refs = {s.subjectRef for s in person_sigs}
    assert len(refs) == 2, f"two people's signals collapsed onto one subjectRef: {refs}"
    assert refs == {by_name["陈思雨"], by_name["周雅婷"]}


def test_cjk_project_owner_links_resolve_to_distinct_people():
    """Owner wiring under CJK: 销售 FAQ 梳理 is 陈思雨's, 运营 FAQ 梳理 is 李明轩's."""
    res = _cjk_extract()
    by_name = {p.name: p.id for p in res.people}
    owners = {pr.title: pr.ownerId for pr in res.projects}
    assert owners.get("销售 FAQ 梳理") == by_name["陈思雨"]
    assert owners.get("运营 FAQ 梳理") == by_name["李明轩"]
    assert owners["销售 FAQ 梳理"] != owners["运营 FAQ 梳理"]


# === BUG-2 · cross-document dedup ==============================================================
#
# These assert the OBSERVABLE CONTRACT of extract_docs, not the implementation site. Dedup may land
# in ExtractionResult.merge or (as the audit recommends) in extract_docs between the merge loop and
# _link_owners(extract.py:510) — either satisfies these. Pinning merge() by name would over-
# constrain the fix and force merge() to stop being a pure concat, which it is also called as from
# HeuristicExtractor.extract (extract.py:251-258).

def test_cjk_people_are_deduped_across_documents():
    """BUG-2 head-on: 陈思雨/李明轩/周雅婷 appear in BOTH docs. extract_docs concatenates, so the
    team page renders 陈思雨 three times."""
    res = _cjk_extract()
    names = [p.name for p in res.people]
    assert len(names) == len(set(names)), (
        f"people={len(names)} but unique names={len(set(names))}; duplicates: "
        f"{sorted({n for n in names if names.count(n) > 1})}"
    )
    assert set(names) == _CJK_NAMES


def test_cjk_person_count_equals_unique_name_count():
    """The headcount the briefing reports (registry.py:192/206 `n_people = len(people)`) must be
    the real headcount. Real machine: 39 people / 20 names."""
    res = _cjk_extract()
    assert len(res.people) == len({p.name for p in res.people}) == 5


def test_cjk_cross_doc_person_merge_enriches_rather_than_keeps_first():
    """Dedup must MERGE, not pick. 陈思雨's identity (role/team/tenure) is only in the roster and
    her ownership (owns) is only in the weekly — neither record is complete. keep-first loses her
    entire card body; keep-last loses her role. This mirrors llm_extract.py:307's own
    within-document rule ('same person across windows: enrich, don't duplicate')."""
    res = _cjk_extract()
    chen = [p for p in res.people if p.name == "陈思雨"]
    assert len(chen) == 1, f"陈思雨 appears {len(chen)} times"
    p = chen[0]
    assert p.role == "前厅部经理", f"role lost in the merge: {p.role!r}"
    assert p.tenure == "3 年", f"tenure lost in the merge: {p.tenure!r}"
    assert "销售 FAQ 梳理" in p.owns, f"ownership from the weekly lost in the merge: {p.owns!r}"
    assert "前台交接流程重写" in p.owns


def test_cjk_projects_are_deduped_across_documents():
    """Same title in two docs must land as one project card, not two."""
    res = _cjk_extract()
    titles = [pr.title for pr in res.projects]
    assert len(titles) == len(set(titles)), (
        f"projects={len(titles)} but unique titles={len(set(titles))}: {titles}"
    )
    assert set(titles) == {"销售 FAQ 梳理", "运营 FAQ 梳理"}


def test_cjk_cross_doc_project_merge_enriches_rather_than_keeps_first():
    """Projects split across docs the same way people do: the roster knows WHO owns 销售 FAQ 梳理,
    the weekly knows it is at-risk at 48% and blocked on 法务. keep-first drops the entire status
    of the project. 'First non-empty wins' is the rule the audit recommends — note it means input
    order decides when two docs BOTH state a value (lite does not parse doc dates, so a stale
    progress can win; that is a known, documented limitation, not something this gate hides)."""
    res = _cjk_extract()
    sales = [pr for pr in res.projects if pr.title == "销售 FAQ 梳理"]
    assert len(sales) == 1, f"销售 FAQ 梳理 appears {len(sales)} times"
    pr = sales[0]
    assert pr.ownerName == "陈思雨", f"owner lost in the merge: {pr.ownerName!r}"
    assert pr.status == "at-risk", f"status from the weekly lost in the merge: {pr.status!r}"
    assert pr.progress == 48, f"progress from the weekly lost in the merge: {pr.progress!r}"
    assert pr.blockers == ["等待法务确认退改签口径"], f"blockers lost in the merge: {pr.blockers!r}"


def test_english_lena_park_is_deduped_across_docs():
    """BUG-2 IS ALREADY LIVE IN ENGLISH — it has just never been asserted. The real fixtures
    Team_Roster.xlsx + Lena_Park_Resume.docx yield people=5 / unique names=4, with two half-filled
    Lena Parks (roster: team='Design', owns=0; resume: team='', owns=3).

    test_ingest.py:97's `next(p for p in ex.people if p.name == "Lena Park" and p.role)` is a
    fossil of exactly this bug — that `and p.role` filter exists to step over the wrong duplicate.

    NOTE FOR THE IMPLEMENTER (needs Danny's call): fixing this moves the English people count 5->4
    and the briefing headline from '5 people' to '4 people'. That is BUG-2's definition, not a
    regression — Lena Park always WAS one person. The 'English must not change byte for byte' rule
    was written for BUG-1 (id generation) and cannot be applied to BUG-2 without making BUG-2
    unfixable. No existing test asserts the count.
    """
    res = extract_docs([parse_file(ENG / "Team_Roster.xlsx"), parse_file(ENG / "Lena_Park_Resume.docx")])
    lenas = [p for p in res.people if p.name == "Lena Park"]
    assert len(lenas) == 1, (
        f"Lena Park extracted {len(lenas)} times: "
        f"{[(p.team, len(p.owns)) for p in lenas]} — cross-doc dedup missing in English too"
    )
    lena = lenas[0]
    assert lena.team == "Design", f"roster identity lost: team={lena.team!r}"
    assert len(lena.owns) == 3, f"resume ownership lost: owns={lena.owns!r}"
    assert "Designer" in lena.role


def test_english_ingest_ids_are_byte_frozen():
    """Integration-level English contract (BORN GREEN): the CJK fix must not perturb the ids the
    existing 42 features' evidence is built on. Note this asserts the id SET, so it survives the
    5->4 people count change that BUG-2's fix legitimately causes."""
    res = extract_docs([parse_file(ENG / "Team_Roster.xlsx"), parse_file(ENG / "Lena_Park_Resume.docx")])
    assert {p.id for p in res.people} == {
        "u_lena_park", "u_marcus_reid", "u_priya_shah", "u_jordan_wells",
    }


# === the ANTI-OVER-FIX guard (BORN GREEN) ======================================================

def test_materials_are_never_deduped_across_documents():
    """BORN GREEN, and it must STAY green: BUG-2's fix must touch people/projects ONLY.

    Both CJK fixtures carry the same boilerplate line ('三亚亚特兰蒂斯别墅酒店 · 内部资料 ·
    请勿外传') — a header/footer repeating across files is the norm in real Chinese documents, and
    the two occurrences are two legitimate, separately citable pieces of evidence. Deduping
    materials by text would (a) delete citable corpus and break the cite chain to the second doc,
    and (b) make registry.py:215-227 `_chunks_per_file` under-report chunk counts to feat-032's
    file list. MaterialChunk ids are already `<doc>:<line>` and globally unique, so id-dedup is a
    no-op and text-dedup is pure damage.
    """
    res = _cjk_extract()
    ids = [m.id for m in res.materials]
    assert len(ids) == len(set(ids)), "material ids should already be unique (doc:line)"

    boiler = "三亚亚特兰蒂斯别墅酒店 · 内部资料 · 请勿外传"
    hits = [m for m in res.materials if m.text == boiler]
    assert len(hits) == 2, (
        f"the shared boilerplate line survives in {len(hits)} doc(s), expected 2 — materials were "
        f"deduped by text, which deletes citable evidence"
    )
    assert {m.source.rsplit(":", 1)[0] for m in hits} == {
        "Sanya_Team_Roster.md", "Sanya_Project_Weekly.md",
    }


# === BUG-3 · the heuristic drops Han names before _slug is ever called =========================
#
# ROUND 2: the `bug3` marker is GONE from this test. In round 1 this was a quarantined trap ("stays
# red, do not be fooled"); it is now a first-class gate that must go green. The heuristic is not a
# test-only curiosity — extractor_factory.py:87 (LLM budget exhausted) and llm_extract.py:216/222/
# 227 (model failure / red-line breach / no entities) reach it in production — so this red IS "the
# Sanya customer's team page is empty whenever the model is unavailable".

def test_heuristic_roster_extracts_cjk_names_BUG3():
    """The round-1 quarantine, promoted to a gate that must go green.

    extract.py:212 `_looks_like_name` requires `^[A-Z][A-Za-z.\\-]+...`; no Han character can start
    with [A-Z]. So the OFFLINE HEURISTIC discards Chinese names at extract.py:278, before _slug is
    ever called. Measured: a CJK roster containing 陈思雨 / 李明轩 / Lin Qing yields exactly
    [('u_lin_qing', 'Lin Qing')] — the Chinese colleagues produce ZERO people, they do not even
    collapse to u_x.
    """
    res = HeuristicExtractor().extract(parse_file(CJK_ROSTER))
    names = {p.name for p in res.people}
    assert {"陈思雨", "李明轩", "周雅婷", "孙浩"} <= names, (
        f"the heuristic dropped every Han name before _slug could see it; it kept only {names}"
    )


# The corpus fact the next gates rest on: a REAL Sanya roster, Chinese header row and all.
_ZH_ROSTER_PEOPLE = {"陈思雨", "李明轩", "周雅婷", "孙浩", "吴桂芳", "赵倩", "Lin Qing"}
# Column headers from that same roster. 「姓名」is exactly two Han characters — and so is the real
# colleague 「孙浩」. That is deliberate: it makes "2-4 Han characters == a name" (the obvious lazy
# widening of _looks_like_name) provably insufficient, and forces a real stop-list.
_ZH_HEADERS = ("姓名", "职位", "部门", "司龄", "负责", "序号", "编号")


def test_zh_roster_fixture_is_really_chinese_all_the_way_down():
    """Guards the corpus itself. The round-1 CJK roster had Han names but an ASCII header row and an
    ASCII Team column, so the team half of the pipeline was never actually tested against Chinese.
    If this fixture ever drifts back to ASCII, every gate below turns into theatre."""
    text = ZH_ROSTER.read_text(encoding="utf-8")
    for header in ("姓名", "职位", "部门", "司龄", "负责"):
        assert header in text, f"the ZH roster lost its Chinese header {header!r}"
    for dept in ("前厅部", "客房部", "餐饮部", "市场推广部", "销售部"):
        assert dept in text, f"the ZH roster lost its Chinese department {dept!r}"
    for name in _ZH_ROSTER_PEOPLE:
        assert name in text, f"the ZH roster lost {name!r}"


def test_heuristic_zh_roster_extracts_every_chinese_colleague_BUG3():
    """BUG-3 through the FULL offline path (parse -> heuristic -> extract_docs -> dedupe -> link).

    This is the assertion that says "a Sanya manager whose LLM budget ran out still sees her team".
    Before the fix: only Lin Qing survives, because she is the one colleague with an ASCII name.
    """
    res = extract_docs([parse_file(ZH_ROSTER)])
    names = {p.name for p in res.people}
    assert names == _ZH_ROSTER_PEOPLE, (
        f"heuristic roster extraction lost people (or invented some): got {sorted(names)}, "
        f"expected {sorted(_ZH_ROSTER_PEOPLE)}"
    )
    ids = [p.id for p in res.people]
    assert len(set(ids)) == len(ids), f"people share ids: {[(p.name, p.id) for p in res.people]}"


def test_heuristic_zh_roster_never_promotes_a_chinese_header_to_a_person_BUG3():
    """THE REVERSE HALF — the guard against fixing BUG-3 by opening the floodgates.

    BORN GREEN AND MUST STAY GREEN. It is green today for a degenerate reason (the heuristic
    extracts no Chinese anything, so it cannot extract a Chinese header either); it only acquires
    teeth once _looks_like_name starts accepting Han. That is exactly when it is needed: the
    cheapest widening — "any short run of Han characters is a name" — turns this roster's header row
    into a colleague called 「姓名」, which is feat-039's "No." bug reborn in Chinese.

    (Teeth verified by mutation in round 2 — widening _looks_like_name to accept any 2-4 Han run
    turns this red while the forward gate above goes green.)

    HISTORICAL NOTE — this docstring used to add that _looks_like_name was "the only thing standing
    here", because _people_from_roster built its `header` list only when row 0 matched `\\bname\\b`
    (ASCII), leaving the `cells[0] in _NOT_NAME` guard dead on every Chinese roster. feat-049 taught
    the header detector Han, so that guard is live again and this gate now has TWO defences behind
    it. The gate is unchanged and still earns its keep: the guard only fires on row 0 of a table,
    while _looks_like_name protects every other line of every other document.
    """
    res = extract_docs([parse_file(ZH_ROSTER)])
    names = {p.name for p in res.people}
    leaked = sorted(h for h in _ZH_HEADERS if h in names)
    assert not leaked, f"column headers became people: {leaked}"


@pytest.mark.parametrize("header", _ZH_HEADERS)
def test_looks_like_name_rejects_chinese_column_headers_BUG3(header):
    """Unit-level reverse half. 序号/编号 are already covered by _INDEX_TOKEN_RE (born green, and a
    widened regex must not un-cover them); 姓名/职位/部门/司龄/负责 have no defence at all today
    beyond the `^[A-Z]` accident that is about to be removed. llm_extract.py:76-77 already names
    these words to the model — the heuristic's stop-list is the one that lags.
    (Postscript from r2's follow-up: the belt that BACKS that prompt was ASCII-only and did NOT name
    them, so the LLM path had the same hole; it now reads _NOT_NAME below rather than a copy.)"""
    assert _looks_like_name(header) is False, f"{header!r} is a column header, not a person"


@pytest.mark.parametrize("name", ["陈思雨", "李明轩", "周雅婷", "孙浩", "吴桂芳", "赵倩"])
def test_looks_like_name_accepts_real_chinese_names_BUG3(name):
    """The forward half at unit level: these are real colleagues on the first customer's roster."""
    assert _looks_like_name(name) is True, f"{name!r} is a real person and must survive"


@pytest.mark.parametrize("token", ["Lin Qing", "Lena Park", "Marcus Reid", "Jordan Wells"])
def test_looks_like_name_english_acceptance_is_unchanged_BUG3(token):
    """BORN GREEN — the safety catch. Widening for Han must not disturb the ASCII names the existing
    corpus and 42 features of evidence are built on."""
    assert _looks_like_name(token) is True


@pytest.mark.parametrize("token", ["No.", "name", "Role", "Team", "S.No", "#", "tbd", "n/a"])
def test_looks_like_name_english_rejection_is_unchanged_BUG3(token):
    """BORN GREEN — the other safety catch: feat-039's "No." bug must not be reintroduced by a
    widening that loosens the ASCII branch on its way to letting Han through."""
    assert _looks_like_name(token) is False


# --- BUG-3's sibling: service/live_input.py::_slugify -------------------------------------------
# Same defect, same character class, a different file — `re.sub(r"[^a-z0-9]+", "-", ...)`. Every
# Han character falls outside [a-z0-9], the string empties, and the fallback fires: EVERY Chinese
# live situation becomes the same case_id, "live-situation". The all-Chinese Sanya path walks
# straight through it (build_live_case:96 `case_id = sit.case_id or _slugify(...)`).

def test_live_input_slugify_keeps_chinese_situations_distinct_BUG3():
    """Two different Chinese situations must not be the same case. Measured before the fix: both
    are literally the string 'live-situation'."""
    from service.live_input import _slugify

    a = _slugify("前厅部交接流程反复重写")
    b = _slugify("餐饮部宴会动线迟迟定不下来")
    assert a != "live-situation", f"a real Chinese situation degraded to the fallback: {a!r}"
    assert b != "live-situation", f"a real Chinese situation degraded to the fallback: {b!r}"
    assert a != b, f"two different Chinese situations produced the same case_id: {a!r}"


@pytest.mark.parametrize("text,expected", [
    ("A teammate keeps going quiet before deadlines",
     "a-teammate-keeps-going-quiet-before-deadlines"),
    ("Lena Park", "lena-park"),
    # the same underscore trap _slug has: a naive `[^\\w]+` fix yields 'roadmap--q3'. `[\\W_]+` keeps
    # this row green, exactly as it does for _slug.
    ("Roadmap_ Q3", "roadmap-q3"),
    # the 48-char cut is part of the frozen behaviour, trailing '-' and all
    ("Shopping guide flow acceptance and rollout plan review",
     "shopping-guide-flow-acceptance-and-rollout-plan-"),
    # degenerate input keeps its historical fallback — only REAL text must stop becoming it
    ("", "live-situation"),
    ("!!!", "live-situation"),
])
def test_live_input_slugify_english_is_byte_frozen_BUG3(text, expected):
    """BORN GREEN — _slugify's English contract, so the CJK fix cannot buy Chinese case ids with an
    English case-id change."""
    from service.live_input import _slugify

    assert _slugify(text) == expected


# === BUG-4 · _norm_team ========================================================================
#
# Two defects in six lines. (1) `for t in TEAMS: if raw in t.lower(): return t` — the empty string
# is a substring of every string, so every unknown/blank team is TEAMS[0], "Founders". (2) TEAMS is
# a startup taxonomy; a Sanya hotel's departments do not live in it, and the LLM prompt
# (llm_extract.py:87) honestly returns team="" when it cannot map one — straight into defect (1).
# Together that is the Playwright-observed 「陈思雨 项目负责人 · Founders」: a hotel sales lead
# rendered as a founder of the company.

_ZH_DEPARTMENTS = ("前厅部", "客房部", "餐饮部", "市场推广部", "销售部")


@pytest.mark.parametrize("raw", ["", "   ", "　", "\t\n", None])
def test_norm_team_empty_input_is_not_a_team_BUG4(raw):
    """Pure logic bug, no CJK required: _norm_team("") is "Founders" today because "" is a substring
    of "founders". Unknown must be UNKNOWN — the empty string the PersonEntity field already
    documents ('one of TEAMS (or "" if unknown — never guessed hard)'). Guessing "Founders" is the
    single most consequential wrong guess available: it is the owner/exec bucket."""
    got = _norm_team(raw)
    assert got != "Founders", (
        f"_norm_team({raw!r}) == 'Founders' — a blank team field is being promoted to the founder "
        f"bucket because '' is a substring of every TEAMS entry"
    )
    assert got == "", f"_norm_team({raw!r}) should be '' (unknown), got {got!r}"


def test_norm_team_does_not_collapse_real_hotel_departments_BUG4():
    """The first customer's org chart must survive contact with the extractor. Today all five map to
    the SAME value ('') and then, wherever a blank cell is involved, on to 'Founders'."""
    got = {d: _norm_team(d) for d in _ZH_DEPARTMENTS}
    assert len(set(got.values())) == len(_ZH_DEPARTMENTS), (
        f"{len(_ZH_DEPARTMENTS)} real departments collapsed onto {len(set(got.values()))} "
        f"value(s): {got}"
    )
    assert "Founders" not in got.values(), f"a hotel department was filed under Founders: {got}"


@pytest.mark.parametrize("dept", _ZH_DEPARTMENTS)
def test_norm_team_passes_an_unmappable_department_through_unchanged_BUG4(dept):
    """THE DESIGN CALL, made explicit so it can be argued with rather than inferred from a diff:
    a department the preset taxonomy cannot honestly express is passed through VERBATIM, not
    squeezed into the nearest English bucket and not blanked.

    Evidence it is safe (checked, not assumed):
      * The consumer types it as free text. src/lite2/teamData.ts:21 declares `team?: string`, and
        src/lite2/teamGroups.ts groups people by that raw string and renders it AS the group title.
        Pass-through therefore renders a 「前厅部」group — which is the thing Danny actually asked
        for. The strict `'Founders' | 'Eng' | ...` union lives only in src/story/data/fixtures.ts,
        the old demo app, which does not consume ingest output at all.
      * The stub transports already ship team values that are NOT in TEAMS ('Engineering',
        'Operations', 'Sales' — src/lite2/stubTransport.ts:34-45), so free-form team strings are
        already what the frontend eats every day.
      * No existing assertion pins an unmappable value: the only team assertion in the whole suite
        is test_ingest.py:99 `lena.team == "Design"`, which is a preset and stays a preset.
    Squeezing instead of passing through would map 前厅部/客房部/餐饮部 all onto 'Ops' — three real
    departments rendered as one group, which is the same information loss as the bug, just tidier.
    """
    assert _norm_team(dept) == dept, (
        f"_norm_team({dept!r}) == {_norm_team(dept)!r}: an unmappable department must pass through "
        f"verbatim, not be blanked or squeezed into the startup taxonomy"
    )


def test_norm_team_pass_through_is_not_a_cjk_special_case_BUG4():
    """ANTI-OVER-FIT. 'Growth' is an ordinary English team name that TEAMS/aliases cannot express,
    and it is unmappable for exactly the same reason 前厅部 is — so it must take exactly the same
    route. A fix shaped like `if re.search(r'[\\u4e00-\\u9fff]', raw): return raw` would pass the
    department gates above while leaving every English startup with a Growth team on the floor.

    (Scope note, deliberate: this DOES change _norm_team's output for English values that are not in
    TEAMS/aliases — 'Growth'/'Marketing' go '' -> themselves. The iron 'English must not change'
    rule is about _slug's ids, byte for byte, and about the team values the existing English corpus
    actually contains — Team_Roster.xlsx ships 'Design' and 'Eng', both frozen in the test below.
    'Growth' appears only in the round-1 CJK fixture's ASCII-disguised Team column and is asserted
    by nothing.)
    """
    assert _norm_team("Growth") == "Growth"
    assert _norm_team("Marketing") == "Marketing"


@pytest.mark.parametrize("raw,expected", [
    # exactly what the existing English corpus contains (Team_Roster.xlsx: Design / Eng)
    ("Design", "Design"),
    ("Eng", "Eng"),
    # + every mapping TEAMS/aliases claims to perform, pinned so the fix cannot quietly drop one
    ("Engineering", "Eng"),
    ("engineering", "Eng"),
    ("Product", "Product"),
    ("GTM", "GTM"),
    ("Sales", "GTM"),
    ("go-to-market", "GTM"),
    ("Operations", "Ops"),
    ("Ops", "Ops"),
    ("Founders", "Founders"),
    ("Founder", "Founders"),
    ("Design Team", "Design"),
])
def test_norm_team_english_mapping_is_frozen_BUG4(raw, expected):
    """BORN GREEN — the safety catch. Fixing the empty-string bug and adding pass-through must not
    perturb a single mapping the code already gets right."""
    assert _norm_team(raw) == expected


def test_heuristic_zh_roster_groups_people_by_their_real_department_BUG4():
    """INTEGRATION: the number of groups the Sanya team page renders must equal the number of
    departments the roster actually has.

    The corpus has 7 people across 6 distinct departments (客房部 holds two of them — 李明轩 and
    赵倩 — so the count is not trivially 'everyone is their own group'). Today the heuristic never
    reaches _norm_team with a Chinese department at all (BUG-3 discards the people first), and if it
    did, all five Chinese departments would arrive as ''.
    """
    res = extract_docs([parse_file(ZH_ROSTER)])
    by_name = {p.name: p.team for p in res.people}
    assert by_name == {
        "陈思雨": "销售部",
        "李明轩": "客房部",
        "周雅婷": "市场推广部",
        "孙浩": "餐饮部",
        "吴桂芳": "前厅部",
        "赵倩": "客房部",
        "Lin Qing": "Design",
    }, f"people are not filed under their real department: {by_name}"
    groups = {t for t in by_name.values() if t}
    assert len(groups) == 6, f"expected 6 department groups, got {len(groups)}: {sorted(groups)}"
    assert "Founders" not in groups, (
        "a Sanya hotel employee is filed under Founders — this is the exact card Danny saw: "
        "「陈思雨 项目负责人 · Founders」"
    )


# === RULER MISMATCH · _link_owners vs _person_key ==============================================

_SPACING_ROSTER_PAYLOAD = {
    # the roster's spelling: U+3000 between 孙 and 浩 (a two-character name padded to align with the
    # three-character 李明轩), and a stray double space in the pasted English column.
    "people": [
        {"name": "孙　浩", "role": "餐饮部领班", "team": "餐饮部", "tenure": "", "owns": [],
         "line": 4},
        {"name": "李明轩", "role": "客房部主管", "team": "客房部", "tenure": "", "owns": [],
         "line": 5},
        {"name": "Lena  Park", "role": "Product Designer", "team": "Design", "tenure": "",
         "owns": [], "line": 6},
    ],
    "projects": [],
    "signals": [],
}

_SPACING_WEEKLY_PAYLOAD = {
    # the duty table's spelling of the same three people: half-width spaces throughout.
    "people": [
        {"name": "孙 浩", "role": "", "team": "", "tenure": "", "owns": ["早班"], "line": 4},
        {"name": "李明轩", "role": "", "team": "", "tenure": "", "owns": ["晚班"], "line": 5},
        {"name": "Lena Park", "role": "", "team": "", "tenure": "", "owns": ["远程"], "line": 6},
    ],
    "projects": [],
    "signals": [
        {"subjectType": "person", "subjectRef": "孙 浩", "tag": "interrupt",
         "summary": "本周吸收了三次排期变更，宴会动线改了两遍", "line": 9},
        {"subjectType": "person", "subjectRef": "Lena Park", "tag": "interrupt",
         "summary": "absorbed three rounds of unplanned changes this week", "line": 10},
    ],
}


def test_person_signals_survive_a_whitespace_spelling_variant_RULER():
    """THE TWO-RULERS REGRESSION, at the exact place it bites.

    _dedupe_entities decides "same person" with _person_key (folds \\s+), so 「孙　浩」(U+3000, the
    roster) and 「孙 浩」(half-width, the duty table) correctly become ONE person — and dedup keeps
    the FIRST spelling, 「孙　浩」. Then _link_owners:516 builds `by_name = {p.name.lower(): p.id}`,
    which folds NOTHING. The only key in by_name is 「孙　浩」. The signal points at 「孙 浩」. Miss.

    A missed lookup is SILENT: subjectRef simply stays a name, so the signal is orphaned — it never
    reaches the person's card, and nothing anywhere reports that it did not. Projects escape this by
    luck (_link_owners has a first-name fallback for owners); signals have no fallback at all. Note
    the old, pre-dedup code did NOT have this failure mode: both spellings were present as separate
    people, so both keys were in by_name and both signals linked (to two half-people, which is
    BUG-2 — but not to nothing). This is a regression round 1 introduced, not a pre-existing hole.

    The fix is ~3 lines: build by_name with _person_key, the same ruler dedup uses. Any fix that
    makes one ruler out of two satisfies this gate; it asserts the observable contract (a person
    signal ends up holding an id), not the mechanism.
    """
    res = _scripted_extract([(SPACING_ROSTER, _SPACING_ROSTER_PAYLOAD),
                             (SPACING_WEEKLY, _SPACING_WEEKLY_PAYLOAD)])

    # precondition — if dedup did not merge the variants, this gate would be red for the wrong
    # reason, so state it separately and loudly.
    assert len(res.people) == 3, (
        f"the whitespace variants did not merge; this gate is about what happens AFTER they do: "
        f"{[(p.name, p.id) for p in res.people]}"
    )
    ids = {p.id for p in res.people}
    assert len(ids) == 3, f"people share ids: {[(p.name, p.id) for p in res.people]}"

    sun = next(p for p in res.people if p.name.replace("　", " ") == "孙 浩")
    lena = next(p for p in res.people if p.name.replace("  ", " ") == "Lena Park")
    sigs = {s.summary: s.subjectRef for s in res.signals if s.subjectType == "person"}
    assert len(sigs) == 2, f"expected 2 person signals, got {sigs}"

    assert sigs["本周吸收了三次排期变更，宴会动线改了两遍"] == sun.id, (
        f"孙浩's signal was orphaned: subjectRef is still "
        f"{sigs['本周吸收了三次排期变更，宴会动线改了两遍']!r}, never became {sun.id!r} — "
        f"_link_owners' by_name ruler ({sun.name!r}) disagrees with _dedupe_entities' _person_key"
    )
    assert sigs["absorbed three rounds of unplanned changes this week"] == lena.id, (
        f"Lena Park's signal was orphaned: subjectRef is still "
        f"{sigs['absorbed three rounds of unplanned changes this week']!r}, never became "
        f"{lena.id!r} — the same two-ruler mismatch, in English"
    )


def test_person_signal_subject_refs_are_ids_not_leftover_names_RULER():
    """The same defect stated as a blanket invariant, so it cannot be satisfied one name at a time:
    after extract_docs, NO person signal may still be carrying a person's NAME. Either it resolved
    to an id or it is pointing at somebody who was never extracted."""
    res = _scripted_extract([(SPACING_ROSTER, _SPACING_ROSTER_PAYLOAD),
                             (SPACING_WEEKLY, _SPACING_WEEKLY_PAYLOAD)])
    ids = {p.id for p in res.people}
    stranded = [(s.subjectRef, s.summary) for s in res.signals
                if s.subjectType == "person" and s.subjectRef not in ids]
    assert not stranded, (
        f"person signals never resolved to an id and are stranded on a name: {stranded}; "
        f"extracted ids were {sorted(ids)}"
    )


# === GATE HOLE M5 · scalar enrichment, with the ordering assumption broken ======================
#
# Round 1's enrichment assertions were empty: every fixture fed the identity-bearing roster FIRST,
# so keep-first and merge-enrich produce the same answer and the role/tenure assertions could not
# tell them apart (mutation-proven: replacing the whole scalar block with `pass` kept the gate
# green). The pair below puts the WEEKLY first and splits the scalars so that NEITHER document
# holds a complete person and NO single-source rule — keep-first or keep-last — can pass.
#
# HONESTY OF THE SCRIPT: each payload claims only fields its own document actually states. It claims
# LESS than the document states in places (吴桂芳's title is in the roster too, but the roster
# payload leaves role=""). That is UNDER-extraction — a model filling only some of what it sees —
# which is the ordinary real behaviour merge-enrich exists to survive, not fabrication.

_M5_WEEKLY_PAYLOAD = {
    # doc 1 (FIRST) — the weekly. Behaviour, and only the title it happens to print inline.
    "people": [
        # role stated inline at line 15 ("前厅接待 吴桂芳 ..."); the weekly never states her tenure
        {"name": "吴桂芳", "role": "前厅接待", "team": "", "tenure": "",
         "owns": ["前台交接流程重写"], "line": 15},
        # the weekly names 赵倩 but never says what she is
        {"name": "赵倩", "role": "", "team": "", "tenure": "",
         "owns": ["客房夜床服务复核"], "line": 16},
    ],
    "projects": [],
    "signals": [],
}

_M5_ROSTER_PAYLOAD = {
    # doc 2 (SECOND) — the roster. Identity, and the halves the weekly is missing.
    "people": [
        {"name": "吴桂芳", "role": "", "team": "", "tenure": "1 年", "owns": [], "line": 10},
        {"name": "赵倩", "role": "客房部服务员", "team": "", "tenure": "2 年", "owns": [],
         "line": 11},
    ],
    "projects": [],
    "signals": [],
}


def test_cross_doc_person_merge_enriches_scalars_from_either_direction_M5():
    """M5, closed. Each person's scalars are SPLIT ACROSS THE TWO DOCUMENTS, and split in opposite
    directions, so the gate has teeth against every single-source rule:

      吴桂芳   role   from doc 1 only   -> keep-LAST loses it
               tenure from doc 2 only   -> keep-FIRST loses it
      赵倩     role   from doc 2 only   -> keep-FIRST loses it
               tenure from doc 2 only

    The document order is (weekly, roster) — the OPPOSITE of every round-1 fixture — so "the roster
    happens to be first" can no longer stand in for enrichment.

    ACCEPTANCE (verified by mutation, round 2): replacing the `cur.role = cur.role or p.role` /
    `cur.team` / `cur.tenure` / `cur.source` block in _dedupe_entities with `pass` (owns union left
    intact — the round-1 hole exactly) turns this test RED on 吴桂芳's tenure and 赵倩's role.
    Round 1's equivalent test stayed green under that same mutation.
    """
    res = _scripted_extract([(ZH_WEEKLY, _M5_WEEKLY_PAYLOAD), (ZH_ROSTER, _M5_ROSTER_PAYLOAD)])

    assert len(res.people) == 2, (
        f"expected 2 merged people, got {[(p.name, p.role, p.tenure) for p in res.people]}"
    )
    wu = next(p for p in res.people if p.name == "吴桂芳")
    zhao = next(p for p in res.people if p.name == "赵倩")

    # --- the half each person owns in the FIRST document (a keep-LAST rule loses these)
    assert wu.role == "前厅接待", f"吴桂芳's role came from doc 1 and was lost: {wu.role!r}"
    assert wu.owns == ["前台交接流程重写"], f"吴桂芳's ownership was lost: {wu.owns!r}"
    assert zhao.owns == ["客房夜床服务复核"], f"赵倩's ownership was lost: {zhao.owns!r}"

    # --- the half each person owns in the SECOND document (a keep-FIRST rule loses these; this is
    #     the half round 1 never actually asserted)
    assert wu.tenure == "1 年", (
        f"吴桂芳's tenure is stated ONLY in the second document and was lost: {wu.tenure!r} — "
        f"the merge kept the first record instead of enriching it"
    )
    assert zhao.role == "客房部服务员", (
        f"赵倩's role is stated ONLY in the second document and was lost: {zhao.role!r} — "
        f"the merge kept the first record instead of enriching it"
    )
    assert zhao.tenure == "2 年", f"赵倩's tenure was lost: {zhao.tenure!r}"


def test_cross_doc_person_merge_is_order_independent_for_disjoint_scalars_M5():
    """The same corpus with the document order REVERSED must yield the same two complete people.
    A keep-first implementation produces two DIFFERENT answers depending on upload order; a real
    merge produces one. (The known and documented limitation stands: order still decides when two
    documents both state the SAME scalar — these two never do.)"""
    forward = _scripted_extract([(ZH_WEEKLY, _M5_WEEKLY_PAYLOAD), (ZH_ROSTER, _M5_ROSTER_PAYLOAD)])
    reverse = _scripted_extract([(ZH_ROSTER, _M5_ROSTER_PAYLOAD), (ZH_WEEKLY, _M5_WEEKLY_PAYLOAD)])

    def scalars(res):
        return {p.name: (p.role, p.tenure, tuple(sorted(p.owns))) for p in res.people}

    assert scalars(forward) == scalars(reverse), (
        f"upload order changed who these people are:\n  weekly-first: {scalars(forward)}\n  "
        f"roster-first: {scalars(reverse)}"
    )


# === GATE HOLE M9 · signal dedup, which round 1 never executed once =============================
#
# Round 1's corpus had 0 signals in the roster and 2 in the weekly, so no signal could ever repeat
# across documents: _signal_key and the whole dedup loop were dead code under the gate (mutation-
# proven: deleting the dedup kept the gate green). The pair below is the ordinary way a literal
# clone is born — a handover memo that copy-pastes the weekly's blocker line — and it carries the
# other half of the contract too: the SAME risk restated in different words must SURVIVE.

_M9_WEEKLY_PAYLOAD = {
    "people": [],
    "projects": [
        {"title": "销售 FAQ 梳理", "ownerName": "陈思雨", "status": "at-risk", "progress": 48,
         "blockers": ["退改签口径未确认，法务尚未回复"], "line": 5},
    ],
    "signals": [
        {"subjectType": "project", "subjectRef": "销售 FAQ 梳理", "tag": "repeated-blocker",
         "summary": "退改签口径未确认，法务尚未回复", "line": 9},
    ],
}

_M9_HANDOVER_PAYLOAD = {
    "people": [],
    "projects": [],
    "signals": [
        # (a) the LITERAL CLONE — line 7 of the memo is the weekly's blocker line, copy-pasted
        {"subjectType": "project", "subjectRef": "销售 FAQ 梳理", "tag": "repeated-blocker",
         "summary": "退改签口径未确认，法务尚未回复", "line": 7},
        # (b) the RESTATEMENT — the same risk, the handover writer's own words, line 9
        {"subjectType": "project", "subjectRef": "销售 FAQ 梳理", "tag": "repeated-blocker",
         "summary": "法务对退改签的口径至今没有给出结论，本周仍然只能继续等待", "line": 9},
    ],
}

_M9_CLONE = "退改签口径未确认，法务尚未回复"
_M9_RESTATEMENT = "法务对退改签的口径至今没有给出结论，本周仍然只能继续等待"


def test_literal_signal_clones_collapse_across_documents_M9():
    """M9 forward half, and the first time the signal-dedup code is executed by any test at all.

    SignalEntity has no count/strength field, so a repeated signal cannot render as 'louder' — it
    renders as two identical cards, i.e. noise on the manager's screen.

    ACCEPTANCE (verified by mutation, round 2): replacing `if key in seen_signals: continue` with
    `pass` — that is, deleting signal dedup entirely — turns this test RED (2 copies of the clone).
    Round 1's gate stayed green under that mutation because no fixture ever repeated a signal.
    """
    res = _scripted_extract([(ZH_WEEKLY, _M9_WEEKLY_PAYLOAD),
                             (ZH_HANDOVER, _M9_HANDOVER_PAYLOAD)])
    clones = [s for s in res.signals if s.summary == _M9_CLONE]
    assert len(clones) == 1, (
        f"the same blocker line, copy-pasted into two documents, produced {len(clones)} signal "
        f"cards: {[(s.source, s.summary) for s in clones]}"
    )


def test_a_restated_signal_is_not_over_merged_M9():
    """M9 reverse half — the guard against 'fixing' the clone by merging anything that rhymes.
    BORN GREEN and must stay green: _signal_key is a LITERAL-clone key on purpose. Two documents
    phrasing the same risk differently are two independent pieces of evidence with two separate
    cites; collapsing them is data loss, and 'three documents said this' is a schema change
    (occurrences: list[str]), not a dedup rule."""
    res = _scripted_extract([(ZH_WEEKLY, _M9_WEEKLY_PAYLOAD),
                             (ZH_HANDOVER, _M9_HANDOVER_PAYLOAD)])
    summaries = [s.summary for s in res.signals]
    assert _M9_RESTATEMENT in summaries, (
        f"the handover writer's own restatement of the risk was swallowed by dedup: {summaries}"
    )
    assert sorted(summaries) == sorted([_M9_CLONE, _M9_RESTATEMENT]), (
        f"expected exactly the clone (once) + the restatement (once), got {summaries}"
    )


def test_signal_dedup_keeps_the_first_cite_M9():
    """Which of the two clones survives is not arbitrary — keep-first means the surviving card cites
    the document that stated it first (the weekly, line 9), not the memo that copied it. The cite
    chain is the product; a signal citing the photocopy instead of the original is a worse cite."""
    res = _scripted_extract([(ZH_WEEKLY, _M9_WEEKLY_PAYLOAD),
                             (ZH_HANDOVER, _M9_HANDOVER_PAYLOAD)])
    clone = next(s for s in res.signals if s.summary == _M9_CLONE)
    assert clone.source == "Sanya_Project_Weekly_ZH.md:9", (
        f"the surviving clone cites {clone.source!r}; it should cite the document that said it "
        f"first, not the handover memo that copy-pasted it"
    )
