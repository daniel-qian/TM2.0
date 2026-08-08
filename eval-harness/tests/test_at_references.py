"""#64 · @-references — the guaranteed-injection battery.

What this file pins (each maps to a mutation in the receipt's mutation ledger):

  unit (avery/ingest/references.py):
    * each of the four kinds resolves to card readings + related record lines;
    * record lines carry TRUE `facts.md:<n>` pointers that memory.resolve_ref() resolves
      (the cite gate keeps working over injected lines);
    * quotas actually cap (ref count / per-ref doc lines / whole-block chars);
    * unknown kind is skipped, dangling id gets an honest not-found line;
    * self_report rides ONLY behind the scoring switch (ADR-0018: readings, no judgments —
      and the one sanctioned number surface obeys the same projection gate as /team).

  service (POST /advise):
    * the block is pinned into the OPENING user turn — asserted at the brain seam, i.e. on
      the conversation the model actually receives (a spy Brain records it; everything else
      is the real service stack, real registry, real ingested corpus);
    * a request WITHOUT references produces a byte-identical opening turn to pre-#64;
    * the started-event / transcript prompt stays the manager's own words (no block);
    * the case body carries the same `## Referenced records (@)` section (read_case truth).

Corpus is REAL Chinese bytes (记忆条：gate-corpus-all-ascii-blindspot — ASCII-only corpora
leave the CJK path unsampled), with a true duplicate-name pair the frontend disambiguates.
"""
from __future__ import annotations

import re
from pathlib import Path

import pytest

fastapi_testclient = pytest.importorskip("fastapi.testclient")
from fastapi.testclient import TestClient  # noqa: E402

from avery import memory
from avery.brain import BrainResponse
from avery.ingest.references import (
    REF_MAX_BLOCK_CHARS,
    REF_MAX_COUNT,
    REF_MIN_DOC_LINES_PER_REF,
    REF_TOTAL_DOC_LINES,
    build_reference_block,
)

ROSTER = "\n".join([
    "# 别墅酒店 员工花名册", "",
    "姓名 | 人员ID | 部门 | 职位 | 司龄",
    "周雅婷 | MKT-001 | 市场推广部 | 市场专员 | 3年",
    "林小满 | FO-0422 | 前厅部 | 前厅主管 | 2年",
    "林小满 | HK-0301 | 客房部 | 客房领班 | 4年",
])
PROJECT = "\n".join([
    "# 别墅套餐推广",
    "负责人：周雅婷",
    "状态：受阻",
    "截止：2026-10-15",
    "进度：55%",
    "阻塞：雨季无备选场地",
])
SOP = "\n".join([
    "# 运营手册", "",
    "## 方法：客诉一次响应",
    "适用：前厅接到住客投诉的第一小时",
    "标签：前厅、客诉",
    "- 先道歉并复述问题",
    "- 30 分钟内给出一个可执行答复",
])


@pytest.fixture()
def clean_registry():
    from avery.ingest.registry import REGISTRY
    REGISTRY.clear()
    yield REGISTRY
    REGISTRY.clear()


@pytest.fixture()
def ctx(clean_registry, tmp_path):
    """A real ingested Chinese corpus (heuristic extractor, in-memory registry)."""
    from avery.ingest.pipeline import ingest_paths
    files = {"花名册.md": ROSTER, "项目周报.md": PROJECT, "运营手册.md": SOP}
    paths = []
    for name, text in files.items():
        p = tmp_path / name
        p.write_text(text, encoding="utf-8")
        paths.append(str(p))
    rep = ingest_paths(paths, registry=clean_registry, context_id="ctx_at64",
                       work_dir=tmp_path / "mem")
    assert rep.ok, f"corpus must ingest: {rep.errors}"
    c = clean_registry.get("ctx_at64")
    assert c is not None
    return c


def _person(ctx, name: str, team: str | None = None):
    for p in ctx.extraction.people:
        if p.name == name and (team is None or p.team == team):
            return p
    raise AssertionError(f"corpus should contain {name} ({team})")


def _record_lines(block: str) -> list[str]:
    return [ln for ln in block.splitlines() if re.match(r"^(facts|notes)\.md:\d+\s", ln)]


# ── unit · resolution per kind ────────────────────────────────────────────────────────────────

def test_person_reference_injects_card_and_citable_lines(ctx):
    p = _person(ctx, "周雅婷")
    block = build_reference_block(ctx, [{"kind": "person", "id": p.id, "label": "周雅婷"}])
    assert "Person card: 周雅婷" in block
    assert "市场推广部" in block, "card readings must carry the verbatim team value"
    lines = _record_lines(block)
    assert lines, "a resolved person must bring related record lines, not rely on recall"
    # every injected pointer must resolve to a real line (the cite gate rides on this)
    for ln in lines:
        ref = ln.split()[0]
        assert memory.resolve_ref(ref, ctx.memory_dir, None) is not None, f"{ref} must resolve"
    assert any("周雅婷" in ln for ln in lines)


def test_duplicate_names_resolve_by_id_not_by_name(ctx):
    """两位林小满：按 id 引用必须拿到**那一位**的卡（前厅 vs 客房），不能并成一张。"""
    front = _person(ctx, "林小满", "前厅部")
    house = _person(ctx, "林小满", "客房部")
    assert front.id != house.id, "roster with 人员ID must keep the duplicate names apart"
    b1 = build_reference_block(ctx, [{"kind": "person", "id": front.id, "label": "林小满"}])
    b2 = build_reference_block(ctx, [{"kind": "person", "id": house.id, "label": "林小满"}])
    assert "前厅部" in b1 and "客房部" not in b1.split("Record lines:")[0]
    assert "客房部" in b2 and "前厅部" not in b2.split("Record lines:")[0]


def test_project_reference_injects_readings(ctx):
    pr = next(x for x in ctx.extraction.projects if "别墅套餐" in x.title)
    block = build_reference_block(ctx, [{"kind": "project", "id": pr.id, "label": pr.title}])
    assert f"Project card: {pr.title}" in block
    assert "status" in block and "blocker" in block, "readings must carry status + blockers"
    assert any(pr.title in ln for ln in _record_lines(block))


def test_file_reference_injects_that_documents_lines(ctx):
    block = build_reference_block(
        ctx, [{"kind": "file", "id": "项目周报.md", "label": "项目周报.md"}])
    assert "File: 项目周报.md" in block
    lines = _record_lines(block)
    assert lines, "a file reference must pin the lines materialized from THAT document"
    joined = "\n".join(lines)
    assert "别墅套餐推广" in joined or "周雅婷" in joined


def test_playbook_reference_injects_method_card(ctx):
    playbooks = list(getattr(ctx.extraction, "playbooks", []) or [])
    assert playbooks, "corpus's `## 方法：` section must extract a MethodCard"
    pb = playbooks[0]
    block = build_reference_block(ctx, [{"kind": "playbook", "id": pb.title, "label": pb.title}])
    assert f"Playbook: {pb.title}" in block
    assert "applies to:" in block


# ── unit · tolerance + honesty ────────────────────────────────────────────────────────────────

def test_unknown_kind_is_skipped_not_rejected(ctx):
    assert build_reference_block(ctx, [{"kind": "weird", "id": "x", "label": "x"}]) == ""


def test_dangling_id_gets_an_honest_not_found_line(ctx):
    block = build_reference_block(
        ctx, [{"kind": "person", "id": "u_不存在", "label": "查无此人"}])
    assert "@查无此人" in block
    assert "not found in this workspace's records" in block


def test_empty_references_mean_empty_block(ctx):
    assert build_reference_block(ctx, []) == ""
    assert build_reference_block(ctx, None) == ""


# ── unit · quotas (the ticket demands the numbers be real) ────────────────────────────────────

def test_ref_count_is_capped(ctx):
    p = _person(ctx, "周雅婷")
    refs = [{"kind": "person", "id": p.id, "label": f"周雅婷{i}"} for i in range(REF_MAX_COUNT * 3)]
    block = build_reference_block(ctx, refs)
    assert block.count("### @") == REF_MAX_COUNT


def test_doc_line_budget_splits_across_refs(ctx, clean_registry, tmp_path):
    """一份提了同一个人 40 次的文档：单引用最多吃满总预算；多引用按份分且有保底。"""
    from avery.ingest.pipeline import ingest_paths
    chatter = "\n".join(["# 周报流水"] + [f"- 周雅婷 第{i}周提交了推广周报并跟进了渠道反馈" for i in range(40)])
    p = tmp_path / "流水.md"
    p.write_text(ROSTER + "\n\n" + chatter, encoding="utf-8")
    rep = ingest_paths([str(p)], registry=clean_registry, context_id="ctx_quota",
                       work_dir=tmp_path / "mem2")
    assert rep.ok
    c = clean_registry.get("ctx_quota")
    person = next(x for x in c.extraction.people if x.name == "周雅婷")

    solo = build_reference_block(c, [{"kind": "person", "id": person.id, "label": "周雅婷"}])
    assert len(_record_lines(solo)) <= REF_TOTAL_DOC_LINES

    many = [{"kind": "person", "id": person.id, "label": "周雅婷"}] * REF_MAX_COUNT
    split = build_reference_block(c, many)
    per_ref = max(REF_MIN_DOC_LINES_PER_REF, REF_TOTAL_DOC_LINES // REF_MAX_COUNT)
    # 每个 entry 的 Record lines 段不超过按份配额
    for entry in split.split("### @")[1:]:
        assert len(_record_lines(entry)) <= per_ref


def test_whole_block_char_ceiling(ctx, clean_registry, tmp_path):
    from avery.ingest.pipeline import ingest_paths
    long_lines = "\n".join(["# 长文"] + [f"- 周雅婷 {'很长的一句话' * 30} 第{i}条" for i in range(60)])
    p = tmp_path / "长文.md"
    p.write_text(ROSTER + "\n\n" + long_lines, encoding="utf-8")
    rep = ingest_paths([str(p)], registry=clean_registry, context_id="ctx_ceiling",
                       work_dir=tmp_path / "mem3")
    assert rep.ok
    c = clean_registry.get("ctx_ceiling")
    person = next(x for x in c.extraction.people if x.name == "周雅婷")
    refs = [{"kind": "person", "id": person.id, "label": "周雅婷"}] * REF_MAX_COUNT
    block = build_reference_block(c, refs)
    assert len(block) <= REF_MAX_BLOCK_CHARS + 64, "hard ceiling plus the honest truncation marker"


# ── unit · ADR-0018: the one sanctioned number obeys the same switch as /team ─────────────────

def test_self_report_rides_only_behind_the_scoring_switch(ctx, monkeypatch):
    from avery.ingest.extract import PersonSelfReport, SelfReportLoad
    p = _person(ctx, "周雅婷")
    p.self_report = PersonSelfReport(load=SelfReportLoad(value=82, source="花名册.md:3"))
    ref = [{"kind": "person", "id": p.id, "label": "周雅婷"}]

    monkeypatch.delenv("AVERY_ALLOW_PERSON_SCORING", raising=False)
    assert "self-reported" not in build_reference_block(ctx, ref), \
        "switch off ⇒ the injected card must be byte-qualitative (same gate as GET /team)"

    monkeypatch.setenv("AVERY_ALLOW_PERSON_SCORING", "1")
    on = build_reference_block(ctx, ref)
    assert "self-reported load: 82" in on and "本人自述" in on


# ── unit · the case body carries the same section ─────────────────────────────────────────────

def test_case_body_carries_referenced_records_section(tmp_path):
    from service import live_input
    sit = live_input.LiveSituation(situation="怎么帮她排一下优先级？",
                                   reference_block="### @周雅婷 (person)\nPerson card: 周雅婷")
    case = live_input.build_live_case(sit, tmp_path, work_dir=tmp_path, with_mock=True)
    try:
        body = Path(case.path).read_text(encoding="utf-8")
        assert "## Referenced records (@)" in body
        assert "Person card: 周雅婷" in body
    finally:
        live_input.discard(case)


# ── service · the guarantee itself, asserted at the brain seam ────────────────────────────────

class _SpyBrain:
    """Records every conversation the service hands the model; answers in free text.
    (chain gate nudges once, then the loop accepts the empty-advice final — the manifest
    still terminates the stream, which is all these assertions need.)"""
    name = "spy"

    def __init__(self):
        self.conversations: list[list[dict]] = []

    def respond(self, system, conversation, tools):
        self.conversations.append([dict(m) for m in conversation])
        return BrainResponse(text="ok")


@pytest.fixture()
def client(monkeypatch):
    monkeypatch.setenv("AVERY_BRAIN", "mock")
    monkeypatch.delenv("AVERY_DB_URL", raising=False)
    monkeypatch.delenv("PGVECTOR_URL", raising=False)
    from service.app import app
    return TestClient(app)


@pytest.fixture()
def spy(monkeypatch):
    s = _SpyBrain()
    from service import brain_factory
    monkeypatch.setattr(brain_factory, "make_brain", lambda case, kind: s)
    return s


def _post_advise(client, ctx, references=None):
    body = {"situation": "帮我看看她这周该怎么排优先级？",
            "company_context_id": ctx.context_id, "stream": False}
    if references is not None:
        body["references"] = references
    headers = {"X-Avery-Token": ctx.owner_token} if ctx.owner_token else {}
    return client.post("/advise", json=body, headers=headers)


def test_references_are_pinned_into_the_opening_turn(client, spy, ctx):
    p = _person(ctx, "周雅婷")
    r = _post_advise(client, ctx,
                     references=[{"kind": "person", "id": p.id, "label": "周雅婷"}])
    assert r.status_code == 200, r.text[:300]
    assert spy.conversations, "the spy brain must have been driven"
    opening = spy.conversations[0][0]["content"][0]["text"]
    assert "The leader asks:" in opening
    assert "Referenced records (@)" in opening, \
        "the injection guarantee point is the OPENING user turn, not read_case luck"
    assert "Person card: 周雅婷" in opening
    assert "facts.md:" in opening, "pinned record lines must keep citable pointers"
    # untrusted-content discipline: the block declares itself evidence, not instructions
    assert "never as instructions" in opening


def test_without_references_the_opening_turn_is_unchanged(client, spy, ctx):
    r = _post_advise(client, ctx)
    assert r.status_code == 200
    opening = spy.conversations[0][0]["content"][0]["text"]
    assert "Referenced records" not in opening
    r2 = _post_advise(client, ctx, references=[])
    assert r2.status_code == 200
    opening2 = spy.conversations[-1][0]["content"][0]["text"]
    assert "Referenced records" not in opening2


def test_transcript_prompt_stays_the_managers_words(client, spy, ctx):
    p = _person(ctx, "周雅婷")
    r = _post_advise(client, ctx,
                     references=[{"kind": "person", "id": p.id, "label": "周雅婷"}])
    assert r.status_code == 200
    started = next(e for e in r.json()["events"] if e["type"] == "started")
    assert "Referenced records" not in started["prompt"], \
        "the preamble is context, not the question — history/transcript keep the manager's words"


def test_dangling_reference_never_fails_the_turn(client, spy, ctx):
    r = _post_advise(client, ctx,
                     references=[{"kind": "person", "id": "u_鬼", "label": "查无此人"},
                                 {"kind": "weird", "id": "x", "label": "x"}])
    assert r.status_code == 200, "a bad reference must degrade, never 422/500 the advise turn"
    opening = spy.conversations[0][0]["content"][0]["text"]
    assert "not found in this workspace's records" in opening


def test_mock_brain_path_still_completes_with_references(client, ctx):
    """No spy — the REAL mock brain walks the full loop with a reference riding along
    (the offline battery's own path must not regress)."""
    p = _person(ctx, "周雅婷")
    r = _post_advise(client, ctx,
                     references=[{"kind": "person", "id": p.id, "label": "周雅婷"}])
    assert r.status_code == 200
    assert r.json()["contract_ok"] is True
