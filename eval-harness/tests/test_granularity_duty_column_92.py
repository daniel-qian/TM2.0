# -*- coding: utf-8 -*-
"""issue #92 — R5-duty-column + the 「一次全选 == 逐份补传」 invariant gate.

THE INCIDENT (production, 0811-0812). The partner's 「人员架构」 CSV lists 13 people, one row each,
with a 「当前负责事项」 duty column. The LLM returned 12 of those duty cells as PROJECTS — and the
prompt's own criterion ("it gives that project its own owner") was structurally unable to object,
because every cell DOES have an owner: the person on its row. Uploaded one file at a time, all 12
survived (R1/R3/R4 need the cross-document evidence pool, and a single-file append batch blinds
all three at once); uploaded all at once, the gate folded 7 and kept 5. That asymmetry is the
production 18-vs-11 project-card split. 提示词里的约束不是判据 — the fix is a STRUCTURAL rule.

WHAT THIS FILE HOLDS DOWN, in two layers:

  * R5 itself (unit layer, hand-built extractions against `apply_gate`): the line-overlap signal,
    the per-document trigger arithmetic (both thresholds), the line-1 clamp exclusion, the
    per-document scoping, the escape hatch for rows tracked beyond their person, and the
    roster-sniff bonus being a bonus rather than a requirement.
  * THE INVARIANT (end-to-end layer, through `ingest_paths` + `append_paths_to_context` — the same
    modules production's /ingest and file-append handlers call): one corpus shaped like the
    partner's three files, ingested all-at-once vs one-file-at-a-time, must land the SAME project
    cards. Before this ticket `apply_gate`/`build_milestone_index` had NEVER been fed more than one
    document by any test in the suite (17 call sites, all single-doc) — the cross-batch dimension
    was structurally invisible, which is exactly how the asymmetry lived to production.

The LLM-shaped runs go through the REAL LLM path (`LLMExtractor` around a scripted brain — the
`_build`/`_line_ref` sanitizer chain the real model feeds), not hand-assembled entities: on this
path `source` line attribution is the model's own, which is the very signal R5 reads. The
heuristic path's `source` means something else (a project carries its SPAN START, and a roster
produces no projects at all), so R5 must stay structurally inert there — pinned end-to-end below,
not just asserted in a comment.

Scope note (#92 vs #93): R5 makes the DUTY-COLUMN failure batch-order-independent because it is
document-local. Cross-document demotions (a candidate in file A that is a milestone row of file B)
still depend on both files sharing a batch — that is #93's whole-archive re-run, deliberately not
covered by the invariant corpus here (its one cross-file overlap is arranged so both modes drop
the card, through different rules).
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from avery.brain import BrainResponse
from avery.ingest import HeuristicExtractor, LLMExtractor, extract_docs, ingest_paths, parse_file
from avery.ingest.extract import ExtractionResult, PersonEntity, ProjectEntity, ProjectMilestone, _slug
from avery.ingest.file_append import append_paths_to_context
from avery.ingest.granularity import apply_gate
from avery.ingest.parse import ParsedDoc
from avery.ingest.registry import ContextRegistry, SourceDocument


@pytest.fixture(autouse=True)
def _offline(monkeypatch):
    """三件套缺一真烧钱（AGENTS.md「后端全离线配置」）。LLM 形状的用例走 scripted brain，
    不出网；这里的 env 守的是任何一步意外落回 env 路由时仍然离线。"""
    monkeypatch.setenv("AVERY_EMBEDDINGS", "keyword")
    monkeypatch.setenv("AVERY_BRAIN", "mock")
    monkeypatch.setenv("AVERY_EXTRACTOR", "heuristic")
    monkeypatch.delenv("AVERY_ALLOW_PERSON_SCORING", raising=False)
    monkeypatch.delenv("AVERY_EMBED_DIM", raising=False)


# ── hand-built shapes for the unit layer ─────────────────────────────────────────────────────────

ROSTER_NAME = "人员架构.csv"          # her actual filename shape: the roster sniff does NOT match it


def _person(name: str, doc: str, line: int, **kw) -> PersonEntity:
    kw.setdefault("id", _slug(name, "u"))
    kw.setdefault("source", f"{doc}:{line}")
    return PersonEntity(name=name, **kw)


def _project(title: str, doc: str, line: int, **kw) -> ProjectEntity:
    kw.setdefault("id", _slug(title, "p"))
    kw.setdefault("source", f"{doc}:{line}")
    return ProjectEntity(title=title, **kw)


def _duty_doc(name: str = ROSTER_NAME, doc_kind: str = "project") -> ParsedDoc:
    """The roster document as a ParsedDoc. doc_kind='project' BY DEFAULT because that is what
    production measured on her file (「人员架构」 matches no roster hint; the duty text does contain
    项目) — every unit test that fires R5 on this default is therefore also proof that the sniff
    is not the main criterion."""
    rows = ["姓名 | 职位 | 当前负责事项"]
    rows += [f"员工{i:02d} | 职位{i:02d} | 事项{i:02d}" for i in range(13)]
    return ParsedDoc(name=name, doc_kind=doc_kind, text="\n".join(rows))


def _duty_result(n_people: int = 13, n_duties: int = 12, doc: str = ROSTER_NAME) -> ExtractionResult:
    """The LLM-shaped extraction off that roster: person i on line i+2 (line 1 is the header), and
    duty candidate i on THE SAME line — each with the row's person as its perfectly-good owner,
    which is exactly the disguise that beat the prompt criterion."""
    res = ExtractionResult()
    res.people = [_person(f"员工{i:02d}", doc, i + 2) for i in range(n_people)]
    res.projects = [_project(f"事项{i:02d}", doc, i + 2, ownerName=f"员工{i:02d}")
                    for i in range(n_duties)]
    return res


# ── R5: the main structural signal ───────────────────────────────────────────────────────────────

def test_a_duty_column_roster_is_demoted_to_its_people():
    """THE FIX ITSELF: 13 people + 12 row-aligned duty candidates -> 0 projects, and every demotion
    cites the person on its row. doc_kind is 'project' (production truth), so the ONLY thing that
    fired here is the line-overlap signal."""
    doc = _duty_doc()
    res = _duty_result()
    rulings = apply_gate(res, [doc])
    assert res.projects == []
    assert [r.rule for r in rulings] == ["R5-duty-column"] * 12
    assert [r.parent for r in rulings] == [f"员工{i:02d}" for i in range(12)]
    assert all(r.verdict == "milestone" for r in rulings)
    # evidence carries the duty row's own source — file-delete cleanup keys on doc_key_of(evidence)
    assert [r.evidence for r in rulings] == [f"{doc.name}:{i + 2}" for i in range(12)]
    # the gate only ever mutates the project axis; the 13 colleagues are untouched
    assert len(res.people) == 13


def test_r5_rulings_stay_inside_the_explainability_contract():
    """裁决要说得出为什么 (granularity 模块头是唯一合法性根据): the closed verdict set holds, the
    reason names the card AND the person, and the human line renders both."""
    res = _duty_result()
    rulings = apply_gate(res, [_duty_doc()])
    for r in rulings:
        assert r.verdict in ("project", "milestone", "document")
        assert r.rule and r.reason and r.title
        assert r.title in r.reason, "the reason must name the thing it is about"
        assert r.parent in r.reason, "the reason must name the person the duty belongs to"
    line = rulings[0].as_line()
    assert "R5-duty-column" in line and "员工00" in line and "事项00" in line


def test_a_row_tracked_beyond_its_person_escapes_r5():
    """THE ESCAPE HATCH (R3 guard (a)'s shape): a roster may double as a project LEDGER, and the
    document says so by tracking a row beyond its person — a progress number, a deadline, a
    milestone list. Those rows survive (R0 cites the fields); their presence does NOT weaken the
    trigger for the bare rows beside them."""
    doc = _duty_doc()
    res = ExtractionResult()
    res.people = [_person(f"员工{i:02d}", doc.name, i + 2) for i in range(5)]
    res.projects = [
        _project("台账A", doc.name, 2, ownerName="员工00", progress=60),
        _project("台账B", doc.name, 3, ownerName="员工01", dueDate="2026-09-30"),
        _project("台账C", doc.name, 4, ownerName="员工02",
                 milestones=[ProjectMilestone(name="验收", status="upcoming")]),
        _project("事项D", doc.name, 5, ownerName="员工03"),
        _project("事项E", doc.name, 6, ownerName="员工04"),
    ]
    rulings = apply_gate(res, [doc])
    assert [p.title for p in res.projects] == ["台账A", "台账B", "台账C"]
    assert [r.rule for r in rulings] == ["R0-tracked", "R0-tracked", "R0-tracked",
                                        "R5-duty-column", "R5-duty-column"]
    # ownerName alone is NEVER the escape — it is the disguise the prompt criterion died on
    assert all("负责人" not in r.reason for r in rulings[3:])


def test_line_one_is_the_clamp_default_not_a_row():
    """When the model omits `line`, llm_extract._line_ref clamps it to 1 — so `<doc>:1` on BOTH
    sides means 'the model did not say'. Two such defaults must never be read as 'the same row',
    or every no-line extraction would look duty-column-shaped."""
    doc = _duty_doc()
    res = ExtractionResult()
    res.people = [_person(f"员工{i:02d}", doc.name, 1) for i in range(6)]
    res.projects = [_project(f"事项{i:02d}", doc.name, 1, ownerName=f"员工{i:02d}", status="on-track")
                    for i in range(6)]
    rulings = apply_gate(res, [doc])
    assert [r.rule for r in rulings] == ["R0-tracked"] * 6
    assert len(res.projects) == 6


def test_unlined_candidates_do_not_dilute_the_signal():
    """The denominator counts LINE-BEARING candidates only. A model that gives real lines for two
    row-aligned candidates and clamps the rest to 1 has still shown the shape for those two: the
    line-1 ones are missing data, not counter-evidence (2/2 fires, not 2/6)."""
    doc = _duty_doc()
    res = ExtractionResult()
    res.people = [_person("员工00", doc.name, 5), _person("员工01", doc.name, 6)]
    res.projects = [
        _project("事项A", doc.name, 5, ownerName="员工00"),
        _project("事项B", doc.name, 6, ownerName="员工01"),
        _project("散卡C", doc.name, 1, ownerName="别人", status="on-track"),
        _project("散卡D", doc.name, 1, ownerName="别人", status="on-track"),
        _project("散卡E", doc.name, 1, ownerName="别人", status="on-track"),
        _project("散卡F", doc.name, 1, ownerName="别人", status="on-track"),
    ]
    rulings = apply_gate(res, [doc])
    assert [r.rule for r in rulings[:2]] == ["R5-duty-column"] * 2
    assert [r.rule for r in rulings[2:]] == ["R0-tracked"] * 4
    assert [p.title for p in res.projects] == ["散卡C", "散卡D", "散卡E", "散卡F"]


def test_one_collision_in_a_real_weekly_never_fires():
    """THE HITS FLOOR. In a real weekly the model occasionally cites the owner line for both the
    person and the project — one bad row, not a pattern. A single collision must never demote
    anything (min hits = 2)."""
    doc = ParsedDoc(name="周报.md", doc_kind="project", text="# 周报")
    res = ExtractionResult()
    res.people = [_person("赵敏", doc.name, 3)]
    res.projects = [
        _project("秋季营销冲刺", doc.name, 3, ownerName="赵敏", status="on-track"),  # the collision
        _project("真项目B", doc.name, 10, ownerName="赵敏", status="on-track"),
        _project("真项目C", doc.name, 20, ownerName="赵敏", status="on-track"),
        _project("真项目D", doc.name, 30, ownerName="赵敏", status="on-track"),
        _project("真项目E", doc.name, 40, ownerName="赵敏", status="on-track"),
        _project("真项目F", doc.name, 50, ownerName="赵敏", status="on-track"),
    ]
    rulings = apply_gate(res, [doc])
    assert [r.rule for r in rulings] == ["R0-tracked"] * 6
    assert len(res.projects) == 6


def test_a_minority_of_collisions_never_fires():
    """THE RATIO FLOOR, separately from the hits floor: two collisions clear min-hits, but 2 of 6
    line-bearing candidates is a mixed document, not a duty column (33% < 60%). 宁可漏。"""
    doc = ParsedDoc(name="混合文档.md", doc_kind="project", text="# 混合")
    res = ExtractionResult()
    res.people = [_person("员工00", doc.name, 3), _person("员工01", doc.name, 5)]
    res.projects = [
        _project("事项A", doc.name, 3, ownerName="员工00"),
        _project("事项B", doc.name, 5, ownerName="员工01"),
        _project("真项目C", doc.name, 10, ownerName="员工00", status="on-track"),
        _project("真项目D", doc.name, 20, ownerName="员工01", status="on-track"),
        _project("真项目E", doc.name, 30, ownerName="员工00", status="on-track"),
        _project("真项目F", doc.name, 40, ownerName="员工01", status="on-track"),
    ]
    rulings = apply_gate(res, [doc])
    assert not any(r.rule == "R5-duty-column" for r in rulings)
    assert len(res.projects) == 6


def test_the_roster_sniff_relaxes_the_floor_but_is_never_required():
    """doc_kind=='roster' is a BONUS: the sniffer has already said 'these rows are people', so ONE
    row-aligned candidate is enough there. The same single-collision shape under doc_kind='project'
    stays untouched — and the main tests above all fire under 'project', which together is the
    ticket's 「doc_kind 只能当加分项不能当主判据」 in both directions."""
    def one_collision(kind: str):
        doc = _duty_doc(name="小名册.csv", doc_kind=kind)
        res = ExtractionResult()
        res.people = [_person("员工00", doc.name, 2)]
        res.projects = [_project("事项00", doc.name, 2, ownerName="员工00")]
        return apply_gate(res, [doc]), res

    rulings, res = one_collision("roster")
    assert rulings[0].rule == "R5-duty-column" and res.projects == []
    rulings, res = one_collision("project")
    assert rulings[0].rule == "R0-tracked" and len(res.projects) == 1


def test_a_person_in_another_document_is_not_this_documents_row():
    """PER-DOCUMENT SCOPING: line numbers only collide within one document. Two candidates in doc B
    on the same line NUMBERS as two people from doc A share nothing with them — firing there would
    demote a real project to a person the document never mentioned (a fabricated why, the exact
    thing R3's guard (b)碑 forbids)."""
    roster = ParsedDoc(name="花名册.csv", doc_kind="roster", text="名册")
    weekly = ParsedDoc(name="周报.md", doc_kind="project", text="# 周报")
    res = ExtractionResult()
    res.people = [_person("员工00", roster.name, 5), _person("员工01", roster.name, 6)]
    res.projects = [
        _project("真项目A", weekly.name, 5, ownerName="员工00", status="on-track"),
        _project("真项目B", weekly.name, 6, ownerName="员工01", status="on-track"),
    ]
    rulings = apply_gate(res, [roster, weekly])
    assert [r.rule for r in rulings] == ["R0-tracked"] * 2
    assert len(res.projects) == 2


def test_r1_still_outranks_r5_when_the_document_nested_the_row_itself():
    """Rule order: a duty candidate that is ALSO a row under some project's 「里程碑：」 list keeps
    the R1 ruling — the document nesting it is stronger evidence than the row shape, and the parent
    a manager sees is the project the document itself named."""
    weekly = ParsedDoc(name="周报.md", doc_kind="project", text="\n".join([
        "项目：秋季营销冲刺",
        "负责人：赵敏",
        "里程碑：",
        "场地布置 — 进行中",
    ]))
    roster = _duty_doc()
    res = ExtractionResult()
    res.people = [_person("员工00", roster.name, 2), _person("员工01", roster.name, 3)]
    res.projects = [
        _project("场地布置", roster.name, 2, ownerName="员工00"),
        _project("事项01", roster.name, 3, ownerName="员工01"),
    ]
    rulings = apply_gate(res, [roster, weekly])
    assert rulings[0].rule == "R1-milestone-section" and rulings[0].parent == "秋季营销冲刺"
    assert rulings[1].rule == "R5-duty-column" and rulings[1].parent == "员工01"
    assert res.projects == []


# ═════════════════════════════════════════════════════════════════════════════════════════════════
# THE INVARIANT GATE — 一次全选 == 逐份补传, end to end through the production modules.
#
# The corpus mirrors the partner's three files: a duty-column roster whose filename beats the
# roster sniff (13 people, 12 duties), a genuine project ledger whose rows are ALSO person-aligned
# (the symmetric shape — only the escape hatch tells it apart), and a weekly whose milestone list
# shares one row with the roster's duty column (the cross-file overlap that made all-at-once fold
# what one-at-a-time kept: pre-R5 this exact corpus lands 18 cards one-by-one vs 17 all-at-once).
# ═════════════════════════════════════════════════════════════════════════════════════════════════

ROSTER_FILE = "人员架构.csv"
LEDGER_FILE = "项目清单.csv"
WEEKLY_FILE = "本周周报.md"

# 13 rows; 许安's duty 「场地布置」 is the weekly's milestone row; 苏茜 carries no duty (12 duties).
# 「亲子园设备巡检项目跟进」 keeps 项目 inside the first 12 lines so the content sniff routes this
# file to doc_kind='project' exactly as production measured on her file.
ROSTER_CSV = "\n".join([
    "姓名,职位,部门,当前负责事项",
    "王慧,总经理,管理层,统筹全店运营与旺季排班",
    "李国栋,前厅经理,前厅部,大堂接待流程优化",
    "张小芸,客房主管,客房部,客房翻新验收对接",
    "赵敏,市场经理,市场部,秋季营销物料筹备",
    "陈立,销售顾问,销售部,别墅看房动线设计",
    "周婷,人事专员,人事部,新员工入职培训安排",
    "吴晓东,采购主管,采购部,旺季食材供应商比价",
    "郑阳,工程主管,工程部,亲子园设备巡检项目跟进",
    "冯洁,餐饮主管,餐饮部,婚宴菜单季度更新",
    "许安,前台领班,前厅部,场地布置",
    "何静,客服专员,客服部,客户回访话术整理",
    "杨帆,保安队长,安保部,停车场改造对接",
    "苏茜,财务专员,财务部,",
])

LEDGER_CSV = "\n".join([
    "项目名称,负责人,进度,截止日期",
    "婚宴宴会厅翻新,李国栋,60,2026-09-30",
    "亲子乐园二期,张小芸,35,2026-10-15",
    "别墅套餐推广,陈立,50,2026-09-15",
    "会员体系升级,何静,20,2026-11-01",
    "停车场改造,杨帆,10,2026-12-01",
])

WEEKLY_MD = "\n".join([
    "# 本周周报",
    "项目：秋季营销冲刺",
    "负责人：赵敏",
    "进度：40%",
    "里程碑：",
    "场地布置 — 进行中",
    "物料采购 — 未开始",
])

ROSTER_NAMES = ["王慧", "李国栋", "张小芸", "赵敏", "陈立", "周婷", "吴晓东",
                "郑阳", "冯洁", "许安", "何静", "杨帆", "苏茜"]
ROSTER_DUTIES = ["统筹全店运营与旺季排班", "大堂接待流程优化", "客房翻新验收对接",
                 "秋季营销物料筹备", "别墅看房动线设计", "新员工入职培训安排",
                 "旺季食材供应商比价", "亲子园设备巡检项目跟进", "婚宴菜单季度更新",
                 "场地布置", "客户回访话术整理", "停车场改造对接"]
LEDGER_ROWS = [("婚宴宴会厅翻新", "李国栋", 60, "2026-09-30"),
               ("亲子乐园二期", "张小芸", 35, "2026-10-15"),
               ("别墅套餐推广", "陈立", 50, "2026-09-15"),
               ("会员体系升级", "何静", 20, "2026-11-01"),
               ("停车场改造", "杨帆", 10, "2026-12-01")]
REAL_TITLES = sorted([t for t, *_ in LEDGER_ROWS] + ["秋季营销冲刺"])

# What the real model handed back on this shape (the incident's geometry): every entity carries
# the 1-based line of its row, so the roster's duties sit EXACTLY on their people's lines — and
# the ledger's owners do too, which is why only the escape hatch separates the two files.
PAYLOADS = {
    ROSTER_FILE: {
        "people": [{"name": n, "role": "员工", "line": i + 2}
                   for i, n in enumerate(ROSTER_NAMES)],
        "projects": [{"title": d, "ownerName": ROSTER_NAMES[i], "line": i + 2}
                     for i, d in enumerate(ROSTER_DUTIES)],
        "signals": [],
    },
    LEDGER_FILE: {
        "people": [{"name": owner, "role": "负责人", "line": i + 2}
                   for i, (_, owner, _, _) in enumerate(LEDGER_ROWS)],
        "projects": [{"title": t, "ownerName": owner, "progress": prog, "dueDate": due,
                      "line": i + 2}
                     for i, (t, owner, prog, due) in enumerate(LEDGER_ROWS)],
        "signals": [],
    },
    WEEKLY_FILE: {
        "people": [{"name": "赵敏", "role": "市场经理", "line": 3}],
        "projects": [{"title": "秋季营销冲刺", "ownerName": "赵敏", "progress": 40, "line": 2}],
        "signals": [],
    },
}


class CorpusBrain:
    """Scripted brain keyed by DOCUMENT (it reads the `Document: <name>` line the extractor
    sends), not by call order — `extract_docs` fans documents out concurrently, so an
    order-cycled fake would be racy."""
    name = "scripted-corpus"

    def respond(self, system, conversation, tools):
        user = conversation[0]["content"][0]["text"]
        doc_name = user.split("Document: ", 1)[1].split(" (kind hint", 1)[0].strip()
        return BrainResponse(text=json.dumps(PAYLOADS[doc_name]))


def _llm_extractor() -> LLMExtractor:
    """A fresh extractor per ingest/append call, exactly as the /ingest handler builds one —
    reused instances would leak the degraded counters across batches."""
    return LLMExtractor(CorpusBrain(), retry_backoff_s=0)


CORPUS = {ROSTER_FILE: ROSTER_CSV, LEDGER_FILE: LEDGER_CSV, WEEKLY_FILE: WEEKLY_MD}
BATCH_AT = ["2026-08-12T09:00:00+00:00", "2026-08-12T09:05:00+00:00", "2026-08-12T09:10:00+00:00"]


def _write_corpus(tmp: Path) -> dict[str, Path]:
    tmp.mkdir(parents=True, exist_ok=True)
    out = {}
    for name, text in CORPUS.items():
        p = tmp / name
        p.write_text(text, encoding="utf-8")
        out[name] = p
    return out


def _sd(path: Path, uploaded_at: str) -> SourceDocument:
    return SourceDocument(filename=path.name, source_key=path.name, mime="text/plain",
                          size_bytes=path.stat().st_size, content=path.read_bytes(),
                          uploaded_at=uploaded_at)


def _ingest_all_at_once(tmp: Path, order: list[str], *, extractor_factory) -> object:
    reg = ContextRegistry()
    files = _write_corpus(tmp)
    paths = [files[n] for n in order]
    rep = ingest_paths([str(p) for p in paths], registry=reg, work_dir=tmp / "mem",
                       context_id="ctx_all", name="度假酒店", owner_token="tok92_all",
                       extractor=extractor_factory(),
                       source_documents=[_sd(p, BATCH_AT[0]) for p in paths])
    assert rep.ok, f"all-at-once seed failed: {rep.parse_errors}"
    return reg.get("ctx_all")


def _ingest_one_by_one(tmp: Path, order: list[str], *, extractor_factory) -> object:
    reg = ContextRegistry()
    files = _write_corpus(tmp)
    first, *rest = order
    rep = ingest_paths([str(files[first])], registry=reg, work_dir=tmp / "mem",
                       context_id="ctx_one", name="度假酒店", owner_token="tok92_one",
                       extractor=extractor_factory(),
                       source_documents=[_sd(files[first], BATCH_AT[0])])
    assert rep.ok, f"first single-file batch failed: {rep.parse_errors}"
    for i, name in enumerate(rest, start=1):
        rep = append_paths_to_context(reg, "ctx_one", [str(files[name])],
                                      [_sd(files[name], BATCH_AT[i])],
                                      extractor=extractor_factory())
        assert rep.ok, f"append batch {name} failed: {rep.parse_errors}"
    return reg.get("ctx_one")


def _titles(ctx) -> list[str]:
    return sorted(p.title for p in ctx.extraction.projects)


def test_the_roster_filename_defeats_the_roster_sniff_as_in_production(tmp_path):
    """Pins the incident's precondition: 「人员架构.csv」 routes to doc_kind='project', NOT 'roster'
    — which is why R5's main criterion cannot be the sniff. If the sniff vocabulary ever grows to
    catch this name, this test goes red so the R5 thresholds get re-argued, not silently re-shaped."""
    files = _write_corpus(tmp_path)
    doc = parse_file(files[ROSTER_FILE])
    assert doc.doc_kind == "project", (
        f"the sniff now says {doc.doc_kind!r} for her roster's filename shape — R5's roster bonus "
        f"thresholds were argued against it NOT matching; re-argue them before relying on it")
    # and the parse preserves row == line, which is the geometry every R5 assertion keys on
    assert doc.lines[0].startswith("姓名") and "许安" in doc.lines[10]


def test_all_at_once_equals_one_by_one_on_the_llm_shaped_corpus(tmp_path):
    """THE INVARIANT (#92's second deliverable): the same three files, ingested as one batch vs
    one at a time through the REAL append path, land the SAME project cards — and the equality is
    not vacuous: the survivors are exactly the real projects, and the 13 colleagues arrive whole
    either way. Pre-R5 this corpus measured 18 cards one-by-one vs 17 all-at-once (the roster's 12
    duties all survived the single-file batch; all-at-once, the weekly's milestone list folded
    「场地布置」 via R1)."""
    ctx_all = _ingest_all_at_once(tmp_path / "a", [ROSTER_FILE, LEDGER_FILE, WEEKLY_FILE],
                                  extractor_factory=_llm_extractor)
    ctx_one = _ingest_one_by_one(tmp_path / "b", [ROSTER_FILE, LEDGER_FILE, WEEKLY_FILE],
                                 extractor_factory=_llm_extractor)
    assert _titles(ctx_all) == _titles(ctx_one)
    assert _titles(ctx_all) == REAL_TITLES
    assert len(ctx_all.extraction.people) == len(ctx_one.extraction.people) == 13
    # the duty demotions are on the audit trail in BOTH modes (different rules may claim the
    # weekly-overlapped row — R1 with the full pool, R5 in the roster-alone batch — but every
    # duty cell is accounted for either way)
    for ctx in (ctx_all, ctx_one):
        folded = {r.title for r in ctx.extraction.granularity if r.verdict != "project"}
        assert set(ROSTER_DUTIES) <= folded


def test_the_invariant_holds_in_reverse_upload_order_too(tmp_path):
    """Increment order must not matter either: weekly first, roster last (the roster batch then
    has NO weekly beside it, so R5 alone carries what R1 carried in the other order)."""
    order = [WEEKLY_FILE, LEDGER_FILE, ROSTER_FILE]
    ctx_all = _ingest_all_at_once(tmp_path / "a", order, extractor_factory=_llm_extractor)
    ctx_one = _ingest_one_by_one(tmp_path / "b", order, extractor_factory=_llm_extractor)
    assert _titles(ctx_all) == _titles(ctx_one) == REAL_TITLES


def test_all_at_once_equals_one_by_one_on_the_heuristic_path(tmp_path):
    """The same invariant on the OTHER extraction path, with its own source semantics: a true
    roster (sniffed 'roster' — people only, no projects) and a weekly whose milestones fold
    WITHIN the document. R5 must stay structurally inert here (heuristic projects carry span
    starts, never person rows), and the counts must agree between modes."""
    heur_corpus = {
        "员工名册.md": "\n".join([
            "姓名 | 职位 | 部门",
            "王慧 | 总经理 | 管理层",
            "李国栋 | 前厅经理 | 前厅部",
            "赵敏 | 市场经理 | 市场部",
        ]),
        "项目周报.md": "\n".join([
            "# 项目周报",
            "项目 1：宴会厅翻新",
            "负责人：李国栋",
            "进度：58%",
            "里程碑：",
            "拆除与结构加固 — 已完成",
            "软装采购下单 — 受阻",
            "项目 2：会员积分改版",
            "负责人：赵敏",
            "进度：74%",
        ]),
    }

    def _run(mode_dir: Path, one_by_one: bool):
        reg = ContextRegistry()
        paths = {}
        for name, text in heur_corpus.items():
            p = mode_dir / name
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(text, encoding="utf-8")
            paths[name] = p
        ordered = [paths["员工名册.md"], paths["项目周报.md"]]
        if one_by_one:
            rep = ingest_paths([str(ordered[0])], registry=reg, work_dir=mode_dir / "mem",
                               context_id="ctx_h", name="度假酒店", owner_token="tok_h",
                               extractor=HeuristicExtractor(),
                               source_documents=[_sd(ordered[0], BATCH_AT[0])])
            assert rep.ok
            rep = append_paths_to_context(reg, "ctx_h", [str(ordered[1])],
                                          [_sd(ordered[1], BATCH_AT[1])],
                                          extractor=HeuristicExtractor())
            assert rep.ok
        else:
            rep = ingest_paths([str(p) for p in ordered], registry=reg, work_dir=mode_dir / "mem",
                               context_id="ctx_h", name="度假酒店", owner_token="tok_h",
                               extractor=HeuristicExtractor(),
                               source_documents=[_sd(p, BATCH_AT[0]) for p in ordered])
            assert rep.ok
        return reg.get("ctx_h")

    ctx_all = _run(tmp_path / "a", one_by_one=False)
    ctx_one = _run(tmp_path / "b", one_by_one=True)
    assert _titles(ctx_all) == _titles(ctx_one) == ["会员积分改版", "宴会厅翻新"]
    assert len(ctx_all.extraction.people) == len(ctx_one.extraction.people) == 3
    for ctx in (ctx_all, ctx_one):
        assert not any(r.rule == "R5-duty-column" for r in ctx.extraction.granularity), (
            "R5 fired on the heuristic path — its source semantics make that a false overlap")
