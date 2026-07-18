"""feat-054 — THE PROJECT GRANULARITY GATE: regression cover for "what counts as ONE project".

THE BUG THIS FILE HOLDS DOWN, in both of its directions — they are one hole, not two:

  * OVER-SPLIT (the reported symptom). The first customer's weekly covers SIX projects and says so
    on its own line 3 (「本期周报覆盖 6 个在跟进项目」). Each project carries a 「里程碑：」 list of
    four checkpoints, so the LLM path promoted checkpoints to projects and returned SEVENTEEN.
    It had been TOLD to: the prompt read 'one entry per distinct project, phase or engagement
    ("Phase 1" and "Phase 2" ... are two entries)'.
  * UNDER-SPLIT (the same hole, other side). The heuristic path swept a whole document into scalar
    locals and emitted ONE project, so a six-project weekly came back as a single phantom card
    named after the file. English-native — a two-`Project:` ASCII doc lost its first project too.

Nothing in the extractor had ever defined what one project IS. The gate defines it:

    A PROJECT is a unit of work the document tracks IN ITS OWN RIGHT (its own owner / status /
    progress / deadline). A MILESTONE is a checkpoint INSIDE one.

WHY THE TESTS BELOW ASSERT ON REASONS, NOT JUST COUNTS. A count cap ("keep at most 6") would make
the numeric assertions pass and would be the wrong fix: it cannot answer "why isn't 软装采购下单 a
project?", which is the question three companies will actually ask. So every demotion must cite the
rule, the parent it belongs to, and the document line — and `test_every_ruling_is_explainable` and
`test_demotion_cites_parent_and_line` fail if any decision is unexplainable.
"""
from __future__ import annotations

from pathlib import Path

from avery.ingest import HeuristicExtractor, extract_docs, parse_file
from avery.ingest.extract import ExtractionResult, ProjectEntity, _norm_status
from avery.ingest.granularity import (
    apply_gate, build_milestone_index, segment_projects, stated_project_count,
)

HERE = Path(__file__).resolve().parent
CJK = HERE / "fixtures" / "cjk"

NESTED = CJK / "Weekly_Milestone_Nesting_ZH.md"      # 2 projects x 3-4 milestones, seed-shaped
EN_NESTED = HERE / "fixtures" / "Weekly_Milestone_Nesting_EN.md"   # the same shape, pure ASCII
EN_WEEKLY = CJK / "Sanya_Project_Weekly.md"          # 2 projects, ASCII labels


def _heuristic(*paths: Path):
    return extract_docs([parse_file(p) for p in paths], extractor=HeuristicExtractor())


def _as_llm_result(doc, promote_milestones: bool):
    """Rebuild what the LLM path hands back: the real projects, plus — when `promote_milestones` —
    every 「里程碑」 row promoted to a project, which is exactly the 17-out-of-6 failure."""
    res = ExtractionResult()
    for b in segment_projects(doc):
        res.projects.append(ProjectEntity(
            id="p", title=b.title, ownerName="陈思雨", status="at-risk", progress=50,
            source=f"{doc.name}:{b.start + 1}"))
        if promote_milestones:
            for text, line in b.milestones:
                res.projects.append(ProjectEntity(id="p", title=text,
                                                  source=f"{doc.name}:{line + 1}"))
    return res


# ── the under-split half (H4 layer A) ────────────────────────────────────────────────────────────

def test_multi_project_weekly_yields_one_entity_per_project():
    """THE REGRESSION THAT MATTERS MOST. Before feat-054 this returned 1 (a phantom named after the
    document); the milestone rows must NOT push it to 6 either. Two labelled projects -> two."""
    res = _heuristic(NESTED)
    titles = [p.title for p in res.projects]
    assert titles == ["宴会厅翻新", "会员积分改版"], f"got {titles}"


def test_each_project_keeps_its_own_fields_not_the_last_ones():
    """The scalar-accumulate bug did not merely drop projects — it SMEARED them: whichever value
    came last won for every field. Each project must carry its own owner/status/progress."""
    res = _heuristic(NESTED)
    by_title = {p.title: p for p in res.projects}
    a, b = by_title["宴会厅翻新"], by_title["会员积分改版"]
    assert (a.ownerName, a.status, a.progress) == ("陈思雨", "at-risk", 58)
    assert (b.ownerName, b.status, b.progress) == ("刘嘉怡", "on-track", 74)


def test_blockers_stay_with_their_own_project():
    """「阻碍项：」 is read per block, so project 2's blocker never lands on project 1's card."""
    res = _heuristic(NESTED)
    by_title = {p.title: p for p in res.projects}
    assert any("软装采购" in x for x in by_title["宴会厅翻新"].blockers)
    assert not any("客服口径" in x for x in by_title["宴会厅翻新"].blockers)
    assert any("客服口径" in x for x in by_title["会员积分改版"].blockers)


def test_milestone_rows_are_not_emitted_as_projects_by_the_heuristic():
    """The heuristic segments at project labels only, so a 「里程碑」 row is never a candidate."""
    res = _heuristic(NESTED)
    titles = {p.title for p in res.projects}
    for row in ("拆除与结构加固", "软装采购下单", "积分规则定稿"):
        assert not any(row in t for t in titles), f"milestone {row!r} leaked into {titles}"


# ── the over-split half (the reported 17-vs-6) ───────────────────────────────────────────────────

def test_gate_demotes_promoted_milestones_back_out_of_the_project_axis():
    """The LLM path's failure, reproduced and then gated: 2 projects + 7 milestone rows -> 2."""
    doc = parse_file(NESTED)
    res = _as_llm_result(doc, promote_milestones=True)
    assert len(res.projects) == 9, "fixture drift: expected 2 projects + 7 milestone rows"
    apply_gate(res, [doc])
    assert [p.title for p in res.projects] == ["宴会厅翻新", "会员积分改版"]


def test_gate_matches_a_milestone_named_without_its_state_suffix():
    """The document line reads 「软装采购下单 — 受阻」 but a model typically returns the bare name.
    Both spellings must resolve to the same milestone, or the gate misses every real LLM output."""
    doc = parse_file(NESTED)
    res = ExtractionResult()
    res.projects = [ProjectEntity(id="p", title="软装采购下单", source=f"{doc.name}:1")]
    rulings = apply_gate(res, [doc])
    assert res.projects == []
    assert rulings[0].rule == "R1-milestone-section"
    assert rulings[0].parent == "宴会厅翻新"


def test_gate_keeps_a_genuinely_tracked_project_and_says_which_fields_prove_it():
    """R0 — the gate's job is to demote checkpoints, NOT to shrink the list. A project the document
    tracks in its own right survives, and the ruling names the evidence that kept it."""
    doc = parse_file(NESTED)
    res = _as_llm_result(doc, promote_milestones=False)
    rulings = apply_gate(res, [doc])
    assert len(res.projects) == 2
    assert all(r.verdict == "project" and r.rule == "R0-tracked" for r in rulings)
    assert "负责人" in rulings[0].reason and "进度" in rulings[0].reason


def test_checklist_row_without_a_parent_is_still_demoted():
    """R2 — a bare '<name> — <completion state>' row with no owner/progress/deadline is a checkbox,
    even when it arrives from a document whose milestone section the gate never saw."""
    doc = parse_file(NESTED)
    res = ExtractionResult()
    res.projects = [ProjectEntity(id="p", title="供应商比价 — 未开始", source="other.md:9")]
    rulings = apply_gate(res, [doc])
    assert res.projects == []
    assert rulings[0].rule == "R2-checklist-row"


def test_a_phase_of_a_tracked_project_is_demoted_but_a_standalone_phase_is_not():
    """R3, and its deliberate limit. 「宴会厅翻新 第二阶段」 is a phase OF something this document
    tracks -> milestone. A 'Phase 2' with no matching parent is left alone: some companies really do
    run one, and demoting it would be the count-cap mistake in disguise."""
    doc = parse_file(NESTED)
    res = ExtractionResult()
    res.projects = [
        ProjectEntity(id="p", title="宴会厅翻新 第二阶段", source="x.md:1"),
        ProjectEntity(id="p", title="Phase 2", ownerName="Lena Park", source="x.md:2"),
    ]
    rulings = apply_gate(res, [doc])
    assert [p.title for p in res.projects] == ["Phase 2"]
    assert rulings[0].rule == "R3-phase-of" and rulings[0].parent == "宴会厅翻新"


# ── R4: a document is not a project ──────────────────────────────────────────────────────────────

def test_a_document_titled_phantom_is_not_a_project():
    """R4. A file with no project label falls back to a card named after the file itself — a
    'project' called 「周例会纪要」, owned by nobody. That is the phantom H4 called worse than an
    empty screen: it does not read as broken, it reads as 'everything is fine'. On the first
    customer's seed corpus this was 2 of 8 extracted projects."""
    doc = parse_file(CJK / "Sanya_Ops_Handover_ZH.md")
    heading = next(l.strip().lstrip("#").strip() for l in doc.lines if l.strip().startswith("#"))
    res = ExtractionResult()
    res.projects = [ProjectEntity(id="p", title=heading, status="on-track", source=f"{doc.name}:1")]
    rulings = apply_gate(res, [doc])
    assert res.projects == []
    assert rulings[0].rule == "R4-document-not-project"
    assert rulings[0].verdict == "document"


def test_a_sniffed_status_alone_does_not_rescue_a_phantom():
    """Status is the one field the extractor may SNIFF from prose rather than read from a label, so
    it is excluded from R4's evidence test. If it counted, every phantom in a document containing
    the words 「按计划推进」 would survive as a confidently on-track project card."""
    doc = parse_file(CJK / "Sanya_Ops_Handover_ZH.md")
    heading = next(l.strip().lstrip("#").strip() for l in doc.lines if l.strip().startswith("#"))
    res = ExtractionResult()
    res.projects = [ProjectEntity(id="p", title=heading, status="on-track", source="x:1")]
    assert apply_gate(res, [doc])[0].verdict == "document"


def test_a_document_titled_project_with_real_tracking_survives():
    """R4's limit, and it is load-bearing: plenty of real project docs ARE named after their one
    project ('# Core Flow Roadmap' + 'Owner: …'). A stated owner / progress / deadline keeps it."""
    doc = parse_file(CJK / "Sanya_Ops_Handover_ZH.md")
    heading = next(l.strip().lstrip("#").strip() for l in doc.lines if l.strip().startswith("#"))
    res = ExtractionResult()
    res.projects = [ProjectEntity(id="p", title=heading, ownerName="陈思雨", progress=40,
                                  source=f"{doc.name}:1")]
    rulings = apply_gate(res, [doc])
    assert [p.title for p in res.projects] == [heading]
    assert rulings[0].rule == "R0-tracked"


def test_filename_titled_phantom_is_also_caught():
    """The fallback also reaches for the FILENAME when a document has no heading at all."""
    doc = parse_file(NESTED)
    stem = doc.name.rsplit(".", 1)[0]
    res = ExtractionResult()
    res.projects = [ProjectEntity(id="p", title=stem, source=f"{doc.name}:1")]
    assert apply_gate(res, [doc])[0].rule == "R4-document-not-project"


# ── explainability (the customer-facing requirement) ─────────────────────────────────────────────

def test_every_ruling_is_explainable():
    """No silent verdicts: every candidate — kept or demoted — carries a stable rule id and a
    non-empty human reason. This is the gate's contract with the three pilot companies."""
    doc = parse_file(NESTED)
    res = _as_llm_result(doc, promote_milestones=True)
    n = len(res.projects)
    rulings = apply_gate(res, [doc])
    assert len(rulings) == n, "a candidate was decided without a recorded ruling"
    for r in rulings:
        assert r.rule and r.reason and r.title
        assert r.verdict in ("project", "milestone", "document")
        assert r.title in r.reason, "the reason must name the thing it is about"


def test_demotion_cites_parent_and_line():
    """A demotion must be traceable to the document: which project owns it, and which line said so."""
    doc = parse_file(NESTED)
    res = _as_llm_result(doc, promote_milestones=True)
    demoted = [r for r in apply_gate(res, [doc]) if r.verdict == "milestone"]
    assert demoted
    for r in demoted:
        if r.rule == "R1-milestone-section":
            assert r.parent in ("宴会厅翻新", "会员积分改版")
            assert r.evidence.startswith(doc.name) and ":" in r.evidence
            line = int(r.evidence.rsplit(":", 1)[1])
            assert r.title.split(" —")[0] in doc.lines[line - 1]


def test_gate_is_recorded_on_the_extraction_result():
    """extract_docs must expose the audit trail, not just the filtered list."""
    res = _heuristic(NESTED)
    assert res.granularity, "extract_docs did not record any granularity ruling"
    assert {r.title for r in res.granularity} == {"宴会厅翻新", "会员积分改版"}


def test_ruling_renders_a_readable_line():
    doc = parse_file(NESTED)
    res = ExtractionResult()
    res.projects = [ProjectEntity(id="p", title="软装采购下单", source=f"{doc.name}:1")]
    line = apply_gate(res, [doc])[0].as_line()
    assert "R1-milestone-section" in line and "宴会厅翻新" in line and "里程碑" in line


# ── the document's own stated count (reconciliation signal, never a truncation rule) ─────────────

def test_stated_project_count_is_read_from_the_document():
    assert stated_project_count(parse_file(NESTED)) == 2


def test_stated_count_reconciles_with_what_was_extracted():
    """The seed weekly's line 3 says how many projects it covers. After the gate, the extracted
    count must agree — this is the check that would have caught 17-vs-6 automatically."""
    doc = parse_file(NESTED)
    res = _heuristic(NESTED)
    assert len(res.projects) == stated_project_count(doc)


def test_stated_count_reads_chinese_numerals_and_english():
    from avery.ingest.granularity import _to_int
    assert _to_int("6") == 6 and _to_int("６") == 6
    assert _to_int("六") == 6 and _to_int("十二") == 12 and _to_int("二十") == 20
    assert _to_int("") is None and _to_int("abc") is None


# ── structure helpers ────────────────────────────────────────────────────────────────────────────

def test_segmentation_finds_blocks_and_their_milestones():
    blocks = segment_projects(parse_file(NESTED))
    assert [b.title for b in blocks] == ["宴会厅翻新", "会员积分改版"]
    assert len(blocks[0].milestones) == 4 and len(blocks[1].milestones) == 3


def test_blocker_label_is_not_collected_as_a_milestone():
    """「阻碍项：」 follows the milestone list with no blank line; if it were swept in as a milestone,
    the gate would demote a project whose title happened to match a blocker."""
    blocks = segment_projects(parse_file(NESTED))
    for b in blocks:
        assert not any("阻碍项" in t for t, _ in b.milestones), b.milestones


def test_milestone_index_maps_rows_to_their_parent():
    doc = parse_file(NESTED)
    index = build_milestone_index([doc])
    parent, where = index["软装采购下单"]
    assert parent == "宴会厅翻新" and where.startswith(doc.name)


def test_document_without_project_labels_is_unchanged():
    """No project label -> the pre-054 whole-document behaviour (one heading-titled entity). Guards
    the fallback that keeps rosters/handbooks/single-topic docs exactly as they were."""
    doc = parse_file(CJK / "Sanya_Ops_Handover_ZH.md")
    assert segment_projects(doc) == []


# ── English must not move, and the ZH status vocabulary must stay honest ─────────────────────────

def test_english_two_project_weekly_segments():
    """The ASCII half: `Project:` labels segment identically, no Han required."""
    res = _heuristic(EN_WEEKLY)
    assert len(res.projects) == 2


def test_english_milestone_nesting_behaves_identically():
    """PARITY. Every behaviour this ticket adds is language-symmetric — the ZH weekly was simply the
    document that exposed it. An English weekly with nested `Milestones:` lists must segment into
    two projects, keep each project's own fields, and never promote a milestone row."""
    res = _heuristic(EN_NESTED)
    by_title = {p.title: p for p in res.projects}
    assert set(by_title) == {"Alpha Launch", "Beta Rollout"}
    assert (by_title["Alpha Launch"].ownerName, by_title["Alpha Launch"].progress) == ("Lena Park", 40)
    assert (by_title["Beta Rollout"].ownerName, by_title["Beta Rollout"].progress) == ("Marcus Reid", 15)
    for row in ("Vendor contract", "Data migration", "Pilot cohort", "Region 2 expansion"):
        assert row not in by_title, f"milestone {row!r} was emitted as a project"


def test_english_blocker_line_is_a_blocker_not_a_milestone():
    """`Blocker:` follows the `Milestones:` list with no blank line; it must close the list."""
    blocks = segment_projects(parse_file(EN_NESTED))
    assert [b.title for b in blocks] == ["Alpha Launch", "Beta Rollout"]
    assert not any("legal sign-off" in t for t, _ in blocks[0].milestones)
    res = _heuristic(EN_NESTED)
    alpha = next(p for p in res.projects if p.title == "Alpha Launch")
    assert any("legal sign-off" in b for b in alpha.blockers)


def test_english_stated_count_is_read():
    """'This report covers 2 active projects.' — the ASCII form of the reconciliation signal."""
    doc = parse_file(EN_NESTED)
    assert stated_project_count(doc) == 2
    assert len(_heuristic(EN_NESTED).projects) == 2


def test_norm_status_english_is_untouched():
    assert _norm_status("Status: blocked") == "blocked"
    assert _norm_status("at-risk") == "at-risk"
    assert _norm_status("on track") == "on-track"
    assert _norm_status("shipped") == "done"
    assert _norm_status("nothing here") == ""


def test_norm_status_reads_chinese():
    assert _norm_status("受阻") == "blocked"
    assert _norm_status("有风险") == "at-risk"
    assert _norm_status("已完成") == "done"
    assert _norm_status("正常") == "on-track"


def test_pending_confirmation_is_unknown_not_at_risk():
    """「待确认」 means nobody has signed off yet — NOT that the project is in trouble. at-risk is the
    status that drives 「多看一眼」 surfacing, so mapping it there would manufacture false alarms in
    front of a paying customer. An unstated status must render 「未知」, per the PRD."""
    assert _norm_status("待确认") == ""
