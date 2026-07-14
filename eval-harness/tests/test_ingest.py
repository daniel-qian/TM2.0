"""feat-016 AFK gate — the ingestion engine battery.

maker != checker: the fixture files (a real .xlsx roster, a real .docx resume, a hand-built .pdf
weekly with a text layer, a company handbook, and an ADVERSARIAL score-inducing resume) are run
through the full pipeline and we assert:

  (a) multi-format parse works (PDF/docx/xlsx/csv/md) and routes by doc kind;
  (b) entities are extracted correctly — people (qualitative), projects (with owner + progress),
      doc-derived signals (person-signal stays at situation);
  (c) THE RED LINE on extraction output: heuristic stays qualitative (PASS), and any extractor that
      scores a person HARD-FAILS; moodPct/capacityPct never appear on a person card;
  (d) retrieval returns the right hit for a query — keyword path (offline/deterministic) AND the
      vector path (real cosine via a deterministic embedder);
  (e) the feat-015 seam: a company_context_id resolves to a memory_dir the UNCHANGED advisor
      recall/cite run over — ingested facts become citable evidence.

Everything here is OFFLINE and deterministic (no LLM, no live embedding service, no DB). The vector
path uses HashingEmbedder so the VECTOR code path itself is exercised without a service; a real
BGE/OpenAI embedder + pgvector drop in behind the same interface (marked needs-service).
"""
from pathlib import Path

import pytest

from avery import memory
from avery.ingest import (
    parse_file, parse_bytes, extract_docs, validate_extraction, ingest_paths, ingest_docs,
    PersonEntity, ProjectEntity, SignalEntity, ExtractionResult, HashingEmbedder,
    KeywordStore, VectorStore, build_store, ContextRegistry,
)
from avery.ingest.redline_extract import validate_person_dict
from avery.ingest import seam

HERE = Path(__file__).resolve().parent
FIX = HERE / "fixtures" / "ingest"

ROSTER = FIX / "Team_Roster.xlsx"
RESUME = FIX / "Lena_Park_Resume.docx"
WEEKLY = FIX / "Core_Flow_Weekly.pdf"
HANDBOOK = FIX / "Studio_Handbook.md"
BAIT = FIX / "Bait_Resume_scored.txt"

ALL_FILES = [ROSTER, RESUME, WEEKLY, HANDBOOK]


def _fresh_registry() -> ContextRegistry:
    return ContextRegistry()


# === (a) multi-format parse ===================================================================

def test_fixtures_present():
    for f in [ROSTER, RESUME, WEEKLY, HANDBOOK, BAIT]:
        assert f.exists(), f"missing fixture {f}"


@pytest.mark.parametrize("path,ext,expect_kind", [
    (ROSTER, "xlsx", "roster"),
    (RESUME, "docx", "resume"),
    (WEEKLY, "pdf", "project"),
    (HANDBOOK, "md", "company"),
])
def test_multiformat_parse_and_kind(path, ext, expect_kind):
    doc = parse_file(path)
    assert doc.ext == ext
    assert doc.text.strip(), f"no text extracted from {path.name}"
    assert doc.doc_kind == expect_kind, f"{path.name}: kind {doc.doc_kind} != {expect_kind}"


def test_parse_strips_nul_and_c0_control_chars():
    """feat-030 P3: a real PDF/xlsx can carry a stray NUL (0x00) or other C0 control char in its
    text layer. Those must be scrubbed at the parse seam — a NUL crashes the Postgres driver on
    write (0x00 is illegal in a Postgres text value), and control chars corrupt the citable corpus.
    Newline and tab are preserved (they are legitimate layout)."""
    doc = parse_bytes("dirty.txt", b"alpha\x00beta\x01gamma\x1f\tdelta\nomega")
    assert "\x00" not in doc.text, "NUL byte survived parse — put() would 500 on the DB write"
    for cc in ("\x01", "\x1f"):
        assert cc not in doc.text, f"C0 control char {cc!r} survived parse"
    # content is preserved (minus the stripped controls); tab + newline stay.
    assert "alpha" in doc.text and "omega" in doc.text
    assert "\t" in doc.text and "\n" in doc.text


def test_pdf_text_layer_extracted():
    doc = parse_file(WEEKLY)
    assert "unresolved feedback comments" in doc.text
    assert "Lena Park" in doc.text


# === (b) entity extraction ====================================================================

def test_people_extracted_from_roster_and_resume():
    docs = [parse_file(ROSTER), parse_file(RESUME)]
    ex = extract_docs(docs)
    names = {p.name for p in ex.people}
    assert {"Lena Park", "Marcus Reid", "Priya Shah", "Jordan Wells"} <= names
    lena = next(p for p in ex.people if p.name == "Lena Park" and p.role)
    assert "Designer" in lena.role
    assert lena.team == "Design"
    assert "18 months" in lena.tenure


def test_projects_extracted_with_owner_and_progress():
    ex = extract_docs([parse_file(ROSTER), parse_file(WEEKLY)])
    assert ex.projects, "no project extracted from the weekly"
    proj = ex.projects[0]
    assert "shopping-guide flow" in proj.title.lower()
    assert proj.status == "at-risk"
    assert proj.progress == 48                     # real number, stated in the doc (R2: not invented)
    assert proj.ownerId, "owner should link to an extracted person id"
    assert proj.blockers, "blocker lines should be captured"


def test_doc_derived_signals_extracted():
    ex = extract_docs([parse_file(ROSTER), parse_file(WEEKLY)])
    kinds = {(s.subjectType, s.tag) for s in ex.signals}
    # a project-level signal (unresolved comments / acceptance) and a person interrupt signal
    assert any(st == "project" for st, _ in kinds)
    person_sigs = [s for s in ex.signals if s.subjectType == "person"]
    assert person_sigs, "expected a doc-derived person signal (interrupt load)"
    # the person signal must be linked to a person id (Your-team wiring)
    assert person_sigs[0].subjectRef.startswith("u_")


# === (c) THE RED LINE on extraction output ====================================================

def test_heuristic_extraction_is_redline_clean():
    """The offline heuristic never derives a person score, even from the adversarial resume."""
    ex = extract_docs([parse_file(BAIT)])
    res = validate_extraction(ex)
    assert res.ok, f"heuristic extraction crossed the red line: {res.summary()}"
    # and the qualitative content is still there
    marcus = next(p for p in ex.people if "Marcus" in p.name)
    assert marcus.owns, "qualitative ownership should survive"
    blob = " ".join([marcus.role, marcus.tenure, *marcus.owns]).lower()
    for banned in ("9/10", "top 5%", "percentile", "flight risk", "5/5", "rating", "a-player"):
        assert banned not in blob, f"scoring token leaked into person fields: {banned!r}"


POISONED_PEOPLE = [
    ("score-in-role", PersonEntity(id="u_m", name="Marcus", role="Engineer rated 9/10")),
    ("percent-in-owns", PersonEntity(id="u_m", name="Marcus", role="Eng", owns=["impact score 92%"])),
    ("tier-label", PersonEntity(id="u_m", name="Marcus", role="A-player and top performer")),
    ("flight-risk", PersonEntity(id="u_m", name="Marcus", collaboration=["flight risk: high"])),
    ("percentile", PersonEntity(id="u_m", name="Marcus", owns=["95th percentile on the team"])),
    ("bare-scale", PersonEntity(id="u_m", name="Marcus", collaboration=["she's a 2 out of 5"])),
]


@pytest.mark.parametrize("label,person", POISONED_PEOPLE)
def test_extractor_that_scores_a_person_hard_fails(label, person):
    """Simulate a hallucinating LLM extractor: any person score MUST hard-fail the AFK gate."""
    res = validate_extraction(ExtractionResult(people=[person]))
    assert not res.ok, f"[{label}] a person-scoring extraction escaped the gate"


def test_forbidden_person_keys_rejected():
    """An LLM handing us a person dict with moodPct/capacityPct/rating is rejected structurally."""
    for bad in ({"name": "X", "moodPct": 40}, {"name": "X", "capacityPct": 134},
                {"name": "X", "rating": 4}, {"name": "X", "performance": "low"}):
        assert validate_person_dict(bad["name"], bad), f"should reject {bad}"
    # a qualitative dict is clean
    assert not validate_person_dict("X", {"name": "X", "role": "Eng", "tenure": "18 months"})


def test_tenure_and_counts_are_not_flagged():
    """Allowed numbers — tenure and event counts — must NOT trip the person red line."""
    ok = PersonEntity(id="u_m", name="Marcus", role="Engineer", tenure="joined 14 months ago",
                      owns=["absorbed 9 change requests in 3 days", "mentors 2 junior engineers"])
    assert validate_extraction(ExtractionResult(people=[ok])).ok


def test_person_directed_signal_stays_situational():
    """A signal pointing at a person describes what she's carrying, never a label/score (red line)."""
    ex = extract_docs([parse_file(ROSTER), parse_file(WEEKLY)])
    person_sigs = [s for s in ex.signals if s.subjectType == "person"]
    assert person_sigs
    assert validate_extraction(ex).ok
    # a person signal that DID carry a label must be caught
    bad = SignalEntity(id="s_x", source_kind="doc", subjectType="person", subjectRef="u_m",
                       summary="she is a low performer and a flight risk")
    assert not validate_extraction(ExtractionResult(signals=[bad])).ok


def test_team_cards_never_carry_mood_or_capacity():
    """The moat as an output property: live person cards have NO moodPct / capacityPct — ever."""
    rep = ingest_paths(ALL_FILES, registry=_fresh_registry())
    assert rep.ok
    for card in rep.context.team_cards():
        assert "moodPct" not in card and "capacityPct" not in card
        for k in card:
            assert k.lower() not in ("mood", "capacity", "score", "rating", "rank", "tier")


def test_pipeline_refuses_to_publish_a_scoring_extraction():
    """End-to-end: if extraction scored a person, ingest returns ok=False and NO context is made."""
    class ScoringExtractor:
        def extract(self, doc):
            return ExtractionResult(people=[
                PersonEntity(id="u_bad", name="Marcus", role="Engineer, rated 9/10, top 5%")])
    reg = _fresh_registry()
    rep = ingest_docs([parse_file(RESUME)], extractor=ScoringExtractor(), registry=reg)
    assert not rep.ok
    assert rep.context is None
    assert rep.context_id == ""
    assert rep.violations, "violations should be reported"
    assert len(reg._by_id) == 0, "a scoring extraction must never register a context"


# === (d) retrieval: keyword (offline) + vector (real cosine) ==================================

def test_keyword_retrieval_returns_the_right_hit():
    rep = ingest_paths(ALL_FILES, registry=_fresh_registry())          # keyword store by default
    assert rep.context.store.backend == "keyword"
    hits = rep.context.recall("unresolved feedback acceptance criteria", limit=5)
    assert hits, "keyword recall returned nothing"
    assert "unresolved feedback comments" in hits[0].text
    assert hits[0].source.endswith(tuple(f":{n}" for n in range(1, 200))) or ":" in hits[0].source


def test_keyword_retrieval_is_deterministic():
    reg = _fresh_registry()
    a = ingest_paths(ALL_FILES, registry=reg, context_id="ctx_a").context.recall("acceptance criteria")
    b = ingest_paths(ALL_FILES, registry=reg, context_id="ctx_b").context.recall("acceptance criteria")
    assert [(h.source, h.text) for h in a] == [(h.source, h.text) for h in b]


def test_vector_retrieval_path_returns_the_right_hit():
    """The VECTOR path (real cosine kNN) with a deterministic embedder — proves the vector code path,
    not just keyword. A real BGE/OpenAI embedder + pgvector plug in behind this same interface."""
    rep = ingest_paths(ALL_FILES, embedder=HashingEmbedder(), prefer_vector=True,
                       registry=_fresh_registry())
    assert rep.context.store.backend.startswith("vector(")
    hits = rep.context.recall("unresolved feedback acceptance criteria", limit=5)
    assert hits, "vector recall returned nothing"
    assert 0.0 < hits[0].score <= 1.0                # cosine on normalized vectors
    assert "unresolved feedback comments" in hits[0].text


def test_vector_store_without_embedder_is_needs_service():
    """No embedder configured => vector store is unavailable and build_store falls back to keyword,
    so the AFK gate NEVER depends on a live embedding endpoint."""
    vs = VectorStore(embedder=None, persistence="pgvector")
    assert vs.available is False
    vs.add([])                                       # no-op, no crash
    assert vs.query("anything") == []
    # the factory falls back to keyword when asked for vector with no embedder
    store = build_store(embedder=None, prefer_vector=True)
    assert isinstance(store, KeywordStore)


# === (e) feat-015 seam: company_context_id -> advisor-recallable memory ========================

def test_company_context_id_resolves_to_advisor_memory(tmp_path):
    reg = _fresh_registry()
    rep = ingest_paths(ALL_FILES, work_dir=tmp_path, registry=reg, context_id="ctx_seam")
    assert rep.ok

    # the seam resolver: an id -> the ingested memory_dir (else the default demo memory)
    mem_dir = seam.resolve_memory_dir("ctx_seam", default=HERE.parent / "memory", registry=reg)
    assert (mem_dir / "facts.md").exists()

    # the UNCHANGED advisor recall now retrieves ingested company facts, line-addressable:
    hits = memory.recall("acceptance criteria unresolved feedback", mem_dir, limit=3)
    assert hits, "advisor recall found nothing in the ingested facts.md"
    assert any("unresolved feedback" in h.text or "acceptance" in h.text for h in hits)

    # and a cite() against one of those lines RESOLVES (cite gate works over ingested data):
    from avery.tools import ToolContext, dispatch
    ctx = ToolContext(memory_dir=mem_dir, case_path=mem_dir / "facts.md", case_id="x")
    obs = dispatch("cite", {"claim": "the brief kept moving", "source_ref": hits[0].source}, ctx)
    assert ctx.cites[0].resolved, f"ingested cite did not resolve: {obs}"


def test_seam_resolver_falls_back_to_default_for_unknown_id():
    default = HERE.parent / "memory"
    got = seam.resolve_memory_dir("ctx_does_not_exist", default=default, registry=_fresh_registry())
    assert got == default
    got2 = seam.resolve_memory_dir(None, default=default, registry=_fresh_registry())
    assert got2 == default


def test_build_live_case_for_context_uses_ingested_memory(tmp_path):
    """Compose with feat-015's build_live_case: a registered context routes the advisor to ingested
    facts. Proves the stub goes real without rewriting service/live_input.py."""
    from service.live_input import LiveSituation
    reg = _fresh_registry()
    ingest_paths(ALL_FILES, work_dir=tmp_path, registry=reg, context_id="ctx_live")
    sit = LiveSituation(situation="Delivery on the core flow feels off — help me read it.",
                        company_context_id="ctx_live")
    case = seam.build_live_case_for_context(sit, HERE.parent / "memory", with_mock=True,
                                            work_dir=tmp_path, registry=reg)
    try:
        # the MOCK block's cites were synthesized against the INGESTED facts.md, not the demo memory
        assert case.mock, "expected a mock plan"
        cited_refs = [c["source_ref"] for c in case.mock["avery"]["cites"]]
        assert any(r.startswith("facts.md:") for r in cited_refs)
    finally:
        from service.live_input import discard
        discard(case)
