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
    REF_MAX_LINE_CHARS,
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


# ── #70 · file 引用注入的是**该文档的原文行**（不是元数据、不是兜底） ────────────────────────
# 病根实测（0808）：注入路以前用「候选行文本 == 材料块原文」做 join，而 materialize_memory 把
# 材料块**原样**写进 facts.md（bullet 带 `- `）、`memory._candidates` 读出来时 `- ` 已被剥掉——
# 于是 bullet 行恒不命中。demo-seed 的婚宴纪要 19 块只 join 到 4 行样板话（日期/场地/桌数一条
# 没进）；周报 24 块只进 4 行前言。文档正文几乎全是 bullet，所以「引了也没用」。
#
# 🔴 判据一律落在**引到的那一行原文文本**上（verifiers-that-lie 碑：兜底/元数据会把「一行正文
# 都没召回」伪装成「块非空」——断言 `lines` 非空、断言 "File: x" 在场，全都能对着零召回全绿）。

BEO = "\n".join([
    "# 婚宴通知单与协调会纪要", "",
    "## 宴会通知单",
    "- 宴会日期：2026 年 8 月 8 日（周六）晚宴",
    "- 场地：阳光草坪主场地 + 多功能厅备用（雨天启用）",
    "- 桌数与台型：主桌一席，圆桌二十七席",
    "", "## 协调会决议",
    "- 会前一到两天复核人数、菜单与台型，避免临场变更",
    "- 尾款结算条款仍需与法务对齐后写入合同",
])
# 这五行就是判据本体：全是 bullet（旧 join 一条都够不着），且**没有一个字**出现在人卡/项目卡
# 的结构化读数里——所以它们只可能来自「读了原文」这一条路。
BEO_SOURCE_LINES = [
    "- 宴会日期：2026 年 8 月 8 日（周六）晚宴",
    "- 场地：阳光草坪主场地 + 多功能厅备用（雨天启用）",
    "- 桌数与台型：主桌一席，圆桌二十七席",
    "- 会前一到两天复核人数、菜单与台型，避免临场变更",
    "- 尾款结算条款仍需与法务对齐后写入合同",
]


@pytest.fixture()
def beo_ctx(clean_registry, tmp_path):
    """一份 bullet 体的纪要 + 花名册（让文档既有正文、又有实体，两段路都能被采样）。"""
    from avery.ingest.pipeline import ingest_paths
    paths = []
    for name, text in {"花名册.md": ROSTER, "婚宴纪要.md": BEO}.items():
        p = tmp_path / name
        p.write_text(text, encoding="utf-8")
        paths.append(str(p))
    rep = ingest_paths(paths, registry=clean_registry, context_id="ctx_file70",
                       work_dir=tmp_path / "mem70")
    assert rep.ok
    c = clean_registry.get("ctx_file70")
    assert c is not None
    # 自证：这份语料真的把「bullet 正文」切成了材料块——否则下面全是空判据。
    chunks = [m for m in c.extraction.materials
              if (getattr(m, "source", "") or "").startswith("婚宴纪要.md:")]
    assert len(chunks) >= len(BEO_SOURCE_LINES), f"corpus must chunk the memo's body: {len(chunks)}"
    return c


def test_file_reference_injects_the_documents_own_source_lines(beo_ctx):
    """引 @婚宴纪要.md ⇒ 块里必须有**那几行原文**（逐字），不是「File: … status ingested」。"""
    block = build_reference_block(
        beo_ctx, [{"kind": "file", "id": "婚宴纪要.md", "label": "婚宴纪要.md"}])
    for original in BEO_SOURCE_LINES:
        assert original in block, f"注入块必须带上原文行：{original!r}\n---\n{block}"


def test_file_reference_source_lines_are_not_the_metadata_card(beo_ctx):
    """讨伐位：卡片行（File: …）在场**不算**注入到位——原文行必须自己在记录段里。"""
    block = build_reference_block(
        beo_ctx, [{"kind": "file", "id": "婚宴纪要.md", "label": "婚宴纪要.md"}])
    lines = _record_lines(block)
    assert lines, "file 引用必须带记录行"
    joined = "\n".join(lines)
    hit = [o for o in BEO_SOURCE_LINES if o in joined]
    assert len(hit) == len(BEO_SOURCE_LINES), \
        f"记录行里只找到 {len(hit)}/{len(BEO_SOURCE_LINES)} 条原文：\n{joined}"


def test_file_reference_pointers_still_resolve(beo_ctx):
    """原文进块了，可引用性一条都不许丢：每个注入指针都要 resolve_ref 得到。"""
    block = build_reference_block(
        beo_ctx, [{"kind": "file", "id": "婚宴纪要.md", "label": "婚宴纪要.md"}])
    lines = _record_lines(block)
    assert lines
    for ln in lines:
        ref, body = ln.split(None, 1)
        got = memory.resolve_ref(ref, beo_ctx.memory_dir, None)
        assert got is not None, f"{ref} 必须 resolve（cite 闸骑在这上面）"
        # 指针指的那一行就是块里印的那一行——不是"能 resolve 但指向别处"。
        assert got.strip() == body.strip(), f"{ref} 指到的是 {got!r}，块里印的是 {body!r}"


def test_file_reference_keeps_entity_lines_as_filler(beo_ctx):
    """花名册这类文档的正文被结构化进了人卡 facts 行——实体补位那一段不许被新路挤没。"""
    block = build_reference_block(
        beo_ctx, [{"kind": "file", "id": "花名册.md", "label": "花名册.md"}])
    joined = "\n".join(_record_lines(block))
    assert "周雅婷" in joined and "林小满" in joined, joined


# ── #70 · 配额边界：原文进块了，配额一条都不许被掏空 ──────────────────────────────────────
# 🔴 REF_TOTAL_DOC_LINES 为什么**没有**跟着上调（票面允许「单文件引用行预算适度上调」）：
# 24 × REF_MAX_LINE_CHARS(200) = 4800，是**可证明**装得进 REF_MAX_BLOCK_CHARS(6000) 的最大
# 预算（实测 200 行大部头单引用 = 5443 字符、零截断）。调到 30 就是 6000+，硬顶会在正文中间
# 把块切断——「多给几行」换来的是最后一条引用被腰斩。要涨预算得先涨硬顶，那是另一张票。

BIG_DOC = "\n".join(["# 大部头材料"] + [f"- 第{i}条：{'很长的一句话' * 40}" for i in range(200)])


@pytest.fixture()
def big_ctx(clean_registry, tmp_path):
    """200 行、每行远超单行截断长度的文档——配额与硬顶的压力面。"""
    from avery.ingest.pipeline import ingest_paths
    paths = []
    for name, text in {"花名册.md": ROSTER, "大部头.md": BIG_DOC}.items():
        p = tmp_path / name
        p.write_text(text, encoding="utf-8")
        paths.append(str(p))
    rep = ingest_paths(paths, registry=clean_registry, context_id="ctx_big70",
                       work_dir=tmp_path / "mem_big70")
    assert rep.ok
    c = clean_registry.get("ctx_big70")
    assert c is not None
    chunks = [m for m in c.extraction.materials
              if (getattr(m, "source", "") or "").startswith("大部头.md:")]
    assert len(chunks) > REF_TOTAL_DOC_LINES * 2, f"压力语料必须远超配额才压得到边界：{len(chunks)}"
    return c


def test_big_file_reference_stays_within_the_doc_line_budget(big_ctx):
    """拉原文不是拉全文：200 块的文档单引用也只出 REF_TOTAL_DOC_LINES 条。"""
    block = build_reference_block(big_ctx, [{"kind": "file", "id": "大部头.md", "label": "大部头.md"}])
    assert len(_record_lines(block)) <= REF_TOTAL_DOC_LINES


def test_big_file_reference_never_breaks_the_hard_ceiling(big_ctx):
    """单文件引用 + 满配额 + 每行都撞单行上限 ⇒ 仍在 6000 硬顶内，且**没有**被截断。

    「没被截断」是这条的重点：只断言 `<= 6000` 的话，一个把块腰斩的实现也全绿。"""
    block = build_reference_block(big_ctx, [{"kind": "file", "id": "大部头.md", "label": "大部头.md"}])
    assert len(block) <= REF_MAX_BLOCK_CHARS
    assert "(reference block truncated at quota)" not in block, \
        f"满配额单文件引用不该撞硬顶（实测 {len(block)} 字符）——撞上说明预算被调过头了"
    for ln in _record_lines(block):
        body = ln.split(None, 1)[1]
        assert len(body) <= REF_MAX_LINE_CHARS, "单行截断照旧生效"


def test_many_file_references_split_the_budget_with_a_floor(big_ctx):
    """八条文件引用共享总预算：每条不超按份配额，且都拿到保底行数（不许有引用空手）。"""
    refs = [{"kind": "file", "id": "大部头.md", "label": "大部头.md"}] * REF_MAX_COUNT
    block = build_reference_block(big_ctx, refs)
    assert len(block) <= REF_MAX_BLOCK_CHARS + 64
    per_ref = max(REF_MIN_DOC_LINES_PER_REF, REF_TOTAL_DOC_LINES // REF_MAX_COUNT)
    entries = block.split("### @")[1:]
    assert len(entries) == REF_MAX_COUNT
    for entry in entries:
        got = len(_record_lines(entry))
        assert got <= per_ref, f"单条引用吃超了按份配额：{got} > {per_ref}"
        assert got >= REF_MIN_DOC_LINES_PER_REF, f"引用空手（保底没兑现）：{got}"


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
