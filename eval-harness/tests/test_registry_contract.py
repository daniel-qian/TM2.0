"""feat-030 — the ContextRegistry persistence contract: ONE suite, TWO implementations.

The registry seam (`avery/ingest/registry.py::ContextRegistry`, feat-018: "a DB-backed registry
would plug in behind the same get/put API") gets its DB implementation here. Behavior, not
internals, is the contract:

  SHARED (memory + postgres both must pass — the offline suite runs the memory leg with no DB):
    * put -> get returns the same company: id, name, source_files, team/project/signal cards,
      briefing — byte-equal payloads;
    * unknown id -> None / not-contained / no memory_dir (the feat-028 404 depends on this);
    * recall over a stored context stays line-addressable (`<file>:<line>` — the cite seam);
    * team_cards carry NO scoring key and NO numeric-typed field (red line on the stored path:
      persistence must not open a hole the extraction gate closed);
    * `AVERY_DATA_DIR` routes materialized memory to a STABLE dir (not the OS temp dir the
      pre-030 pipeline used — a reboot-survivable location is the point of persistence).

  DURABILITY (@needs_db, postgres only — a process dict legitimately cannot pass these):
    * a context put by one registry instance is visible to a BRAND-NEW instance/connection
      (the restart claim at module level);
    * memory_dir re-materializes from the DB after the local files are wiped, byte-identical,
      and the loop's own `avery.memory.recall` works over the restored dir;
    * the DB itself refuses a person row carrying a scoring key (CHECK constraint — the red
      line is structural in the schema, not just in Python);
    * schema reserves the feat-031/034 seams: `materials.embedding vector` + `contexts.owner_token`.

`@needs_db` follows the @seedgate/@smoke convention: no AVERY_DB_URL/PGVECTOR_URL -> clean skip,
so the offline default suite stays green with no external service.
"""
from __future__ import annotations

import os
import re
import shutil
import uuid
from pathlib import Path

import pytest

from avery.ingest import ingest_paths
from avery.ingest.extract import FORBIDDEN_PERSON_KEYS
from avery.ingest.registry import ContextRegistry

HERE = Path(__file__).resolve().parent.parent          # eval-harness/
FIX = HERE / "tests" / "fixtures" / "ingest"
HANDBOOK = FIX / "Studio_Handbook.md"
ROSTER = FIX / "Team_Roster.xlsx"

needs_db = pytest.mark.needs_db


def _db_url() -> str | None:
    return (os.environ.get("AVERY_DB_URL") or os.environ.get("PGVECTOR_URL") or "").strip() or None


def _new_cid() -> str:
    return "ctx_test_" + uuid.uuid4().hex[:12]


class _Impl:
    """A registry implementation under contract. `fresh()` returns a handle onto the same
    underlying storage; `track(cid)` registers a context id for post-test DB hygiene."""

    def __init__(self, name: str, fresh):
        self.name = name
        self.fresh = fresh
        self.created: list[str] = []

    def track(self, cid: str) -> str:
        self.created.append(cid)
        return cid


def _pg_impl(tmp_path: Path) -> _Impl:
    url = _db_url()
    if not url:
        pytest.skip("needs AVERY_DB_URL (or PGVECTOR_URL) pointing at a Postgres — DB layer skipped")
    pytest.importorskip("psycopg")
    from avery.ingest.pg_registry import PostgresContextRegistry

    data_dir = tmp_path / "data"
    return _Impl("postgres", lambda: PostgresContextRegistry(url, data_dir=data_dir))


def _pg_cleanup(impl: _Impl) -> None:
    if impl.name != "postgres" or not impl.created:
        return
    reg = impl.fresh()
    for cid in impl.created:
        reg.delete(cid)


@pytest.fixture(params=["memory", pytest.param("postgres", marks=needs_db)])
def impl(request, tmp_path):
    """The two implementations behind ONE contract. Memory = the offline default (no DB, no skip);
    postgres = the feat-030 persistence layer (@needs_db, clean-skips without a URL)."""
    if request.param == "memory":
        reg = ContextRegistry()
        yield _Impl("memory", lambda: reg)
        return
    pg = _pg_impl(tmp_path)
    yield pg
    _pg_cleanup(pg)


def _ingest(impl: _Impl, work_dir: Path, files: list[Path] | None = None,
            source_documents=None):
    """Drive the REAL pipeline (parse -> extract -> red-line gate -> store -> put) at the registry
    under test — the contract exercises the same write path the service uses."""
    reg = impl.fresh()
    cid = impl.track(_new_cid())
    paths = [str(p) for p in (files or [HANDBOOK, ROSTER])]
    rep = ingest_paths(paths, registry=reg, work_dir=work_dir, context_id=cid, name="prism",
                       source_documents=source_documents)
    assert rep.ok, f"fixture ingest failed the red-line gate: {rep.redline.summary()}"
    return reg, cid, rep


def _sample_source_docs():
    """The raw uploads (bytes + metadata) a company's file space keeps (feat-032). Mirrors what the
    /ingest handler builds from `await f.read()`."""
    from avery.ingest.registry import SourceDocument
    return [
        SourceDocument(filename=HANDBOOK.name, mime="text/markdown",
                       size_bytes=HANDBOOK.stat().st_size, content=HANDBOOK.read_bytes()),
        SourceDocument(filename=ROSTER.name,
                       mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                       size_bytes=ROSTER.stat().st_size, content=ROSTER.read_bytes()),
    ]


# ==============================================================================================
# SHARED CONTRACT — memory + postgres
# ==============================================================================================

def test_put_then_get_returns_the_same_company(impl, tmp_path):
    reg, cid, rep = _ingest(impl, tmp_path / "mem")
    got = reg.get(cid)
    assert got is not None, "put -> get lost the context"
    assert got.context_id == cid
    assert got.name == "prism"
    assert got.source_files == [HANDBOOK.name, ROSTER.name]
    src = rep.context
    assert got.team_cards() == src.team_cards()
    assert got.project_cards() == src.project_cards()
    assert got.signal_cards() == src.signal_cards()
    assert got.briefing() == src.briefing()
    assert cid in reg


def test_unknown_id_resolves_to_nothing(impl):
    reg = impl.fresh()
    ghost = "ctx_never_registered"
    assert reg.get(ghost) is None
    assert ghost not in reg
    assert reg.resolve_memory_dir(ghost) is None


def test_recall_over_a_stored_context_stays_line_addressable(impl, tmp_path):
    reg, cid, _ = _ingest(impl, tmp_path / "mem")
    got = reg.get(cid)
    hits = got.recall("weekly written status update Friday")
    assert hits, "recall over a stored context returned nothing"
    for h in hits:
        assert re.match(r"^.+:\d+$", h.source), (
            f"hit source {h.source!r} is not line-addressable (<file>:<line>) — the cite seam breaks")
        assert h.text.strip()


def test_team_cards_from_storage_never_carry_scoring_keys(impl, tmp_path):
    """The red line survives the storage round-trip: no scoring key, no numeric-typed field on any
    person card (same rule the wire-level seed gate pins)."""
    reg, cid, _ = _ingest(impl, tmp_path / "mem")
    for card in reg.get(cid).team_cards():
        for key in card.keys():
            norm = re.sub(r"[^a-z0-9]", "", str(key).lower())
            assert norm not in FORBIDDEN_PERSON_KEYS, (
                f"forbidden scoring key on stored person card {card.get('name')!r}: {key!r}")
        numeric = [k for k, v in card.items()
                   if isinstance(v, (int, float)) and not isinstance(v, bool)]
        assert not numeric, (
            f"numeric-typed field on stored person card {card.get('name')!r}: {numeric} "
            f"(red line: person cards have no blood bar / score)")


def test_resolve_memory_dir_points_at_materialized_memory(impl, tmp_path):
    reg, cid, _ = _ingest(impl, tmp_path / "mem")
    mem = reg.resolve_memory_dir(cid)
    assert mem is not None
    assert (Path(mem) / "facts.md").exists(), "resolved memory_dir has no facts.md — recall would find nothing"


def test_ingest_materializes_under_avery_data_dir(monkeypatch, tmp_path):
    """No explicit work_dir + AVERY_DATA_DIR set -> memory materializes under the STABLE data dir,
    not the OS temp dir (pre-030 behavior). Registry-independent pipeline behavior."""
    stable = tmp_path / "stable-data"
    monkeypatch.setenv("AVERY_DATA_DIR", str(stable))
    reg = ContextRegistry()
    rep = ingest_paths([str(HANDBOOK)], registry=reg, context_id="ctx_datadir_gate")
    assert rep.ok
    mem = Path(rep.context.memory_dir).resolve()
    assert stable.resolve() in mem.parents, (
        f"memory materialized at {mem}, not under AVERY_DATA_DIR={stable} — a redeploy wipes it")


# ==============================================================================================
# feat-032 — the per-company FILE SPACE contract (shared: memory + postgres). The raw uploads are
# kept (bytes + metadata), a manifest projects them with n_chunks, and the bytes are retrievable.
# ==============================================================================================

def test_source_documents_round_trip(impl, tmp_path):
    """put(context with source_documents) -> get() returns the same file MANIFEST (filename / mime /
    size / doc_kind), each file's n_chunks links to the material chunks it produced, and the raw
    bytes are retrievable through the registry — the same behavior memory and postgres both owe."""
    src_docs = _sample_source_docs()
    reg, cid, _ = _ingest(impl, tmp_path / "mem", source_documents=src_docs)

    got = reg.get(cid)
    assert got is not None
    cards = got.file_cards()
    assert [c["filename"] for c in cards] == [HANDBOOK.name, ROSTER.name], (
        "the file manifest lost/ reordered the uploaded files")
    by_name = {c["filename"]: c for c in cards}
    assert by_name[HANDBOOK.name]["size_bytes"] == HANDBOOK.stat().st_size
    assert by_name[HANDBOOK.name]["mime"] == "text/markdown"
    # n_chunks links a file to the material chunks it produced (materials.source '<filename>:<line>').
    assert by_name[HANDBOOK.name]["n_chunks"] > 0, "handbook produced material but manifest shows 0"
    assert sum(c["n_chunks"] for c in cards) == len(got.extraction.materials), (
        "manifest n_chunks must account for every material chunk")

    # The raw bytes survive the round-trip and are retrievable by (context_id, idx) — memory holds
    # them, postgres reads them back from bytea. Both must return the ORIGINAL upload byte-for-byte.
    fresh = impl.fresh()
    assert fresh.source_document_bytes(cid, 0) == HANDBOOK.read_bytes()
    assert fresh.source_document_bytes(cid, 1) == ROSTER.read_bytes()
    assert fresh.source_document_bytes(cid, 99) is None, "out-of-range idx must be None, not a crash"


def test_source_documents_absent_is_empty_manifest(impl, tmp_path):
    """A context ingested WITHOUT source_documents (the pre-032 path) has an empty file manifest and
    None bytes — never a crash. Backward-compatible with every existing ingest."""
    reg, cid, _ = _ingest(impl, tmp_path / "mem")
    got = reg.get(cid)
    assert got.file_cards() == []
    assert impl.fresh().source_document_bytes(cid, 0) is None


def test_source_documents_with_duplicate_filenames_survive_the_round_trip(impl, tmp_path):
    """feat-032 P1 durability: two uploads sharing a display `filename` but with DISTINCT
    `source_key`s keep their OWN n_chunks and OWN bytes across the storage round-trip (postgres reads
    source_key back from the column; a filename-only join would silently MERGE them). This is the
    persisted twin of the /ingest-time repro."""
    from avery.ingest.registry import SourceDocument

    alpha = b"AlphaUnique line one is quite long enough\nalpha second line also long enough here\n"
    beta = b"BetaUnique line one is quite long enough now\nbeta second line also long enough here\n"
    up = tmp_path / "up"
    up.mkdir()
    # DISTINCT on-disk names (what the /ingest handler now writes) -> distinct ParsedDoc names ->
    # distinct material source prefixes; the SourceDocument.filename stays the shared display name.
    pa = up / "report.txt"
    pa.write_bytes(alpha)
    pb = up / "report(1).txt"
    pb.write_bytes(beta)
    src_docs = [
        SourceDocument(filename="report.txt", source_key="report.txt", mime="text/plain",
                       size_bytes=len(alpha), content=alpha),
        SourceDocument(filename="report.txt", source_key="report(1).txt", mime="text/plain",
                       size_bytes=len(beta), content=beta),
    ]
    reg, cid, _ = _ingest(impl, tmp_path / "mem", files=[pa, pb], source_documents=src_docs)

    got = reg.get(cid)
    cards = got.file_cards()
    assert [c["filename"] for c in cards] == ["report.txt", "report.txt"], (
        "duplicate-named uploads were dropped/reordered")
    # Each row attributes ONLY its own document's chunks (>0 each); a filename merge would double one
    # row and zero the other, or sum both onto both.
    assert all(c["n_chunks"] > 0 for c in cards), f"a duplicate-named file lost its chunks: {cards}"
    assert sum(c["n_chunks"] for c in cards) == len(got.extraction.materials)
    assert cards[0]["n_chunks"] == cards[1]["n_chunks"], (
        "two equal-sized same-named files should each own an equal share of chunks")

    # Each file's OWN bytes survive, addressed by idx (postgres reads bytea back per row).
    fresh = impl.fresh()
    assert fresh.source_document_bytes(cid, 0) == alpha
    assert fresh.source_document_bytes(cid, 1) == beta


# ==============================================================================================
# feat-033 — the "Avery's notes" write-side contract (shared: memory + postgres). Agent-written
# observations accumulate, list new->old, and — the whole point — a person-scoring observation is
# REFUSED at append() before anything lands. The SAME red-line gate (`redline.validate`, EN+ZH) the
# advisor output passes governs the self-written note, so the new write path is not a back door
# around "no numbers on a person".
# ==============================================================================================

def test_notes_append_then_list_new_to_old(impl, tmp_path):
    reg, cid, _ = _ingest(impl, tmp_path / "mem")
    assert reg.list_notes(cid) == [], "a fresh context has no notes"
    n1 = reg.append_note(
        cid, "The onboarding backlog keeps landing on one squad — a load problem, not a person.",
        "the onboarding backlog")
    n2 = reg.append_note(
        cid, "Two handoffs bounced back this week; the coordination seam is where to look.",
        "the two bounced handoffs")
    got = reg.list_notes(cid)
    assert [n.text for n in got] == [n2.text, n1.text], "notes must list new->old (newest first)"
    assert got[0].source_excerpt == "the two bounced handoffs"
    assert all(n.id and n.created_at for n in got), "every note carries an id + created_at"
    assert got[0].id != got[1].id, "note ids are distinct"


@pytest.mark.parametrize("bad", [
    "She is a low performer — score her 2 out of 10 on delivery.",   # EN: two ALWAYS hits
    "综合来看，她这个季度的绩效评分是2分，明显偏低。",                    # ZH: 绩效评分 + 分数
])
def test_notes_redline_refuses_a_scoring_observation(impl, tmp_path, bad):
    """A self-written observation that scores/ranks a PERSON (EN or ZH) is refused at append_note —
    the same moat the advisor output crosses. Nothing lands; the notebook stays clean."""
    reg, cid, _ = _ingest(impl, tmp_path / "mem")
    with pytest.raises(ValueError, match="red line"):
        reg.append_note(cid, bad, "how is she doing this quarter")
    assert reg.list_notes(cid) == [], "a refused scoring observation must NOT land in the notebook"


def test_notes_redline_refuses_a_scoring_source_excerpt(impl, tmp_path):
    """The source excerpt is echoed onto the (user-visible) notes surface, so a person-score in the
    manager's OWN quoted question must not land there either — even with a clean observation. The
    notes surface never displays scoring text, regardless of origin."""
    reg, cid, _ = _ingest(impl, tmp_path / "mem")
    with pytest.raises(ValueError, match="red line"):
        reg.append_note(cid, "There is a real coordination gap worth a direct conversation.",
                        "why did I score her 2/10 last cycle")
    assert reg.list_notes(cid) == []


def test_notes_qualitative_observation_passes(impl, tmp_path):
    """The gate is not a blunt number-blocker: a qualitative, work-focused observation (the normal
    case) lands. Guards against the red-line write gate over-blocking legitimate notes."""
    reg, cid, _ = _ingest(impl, tmp_path / "mem")
    note = reg.append_note(
        cid, "Design and delivery keep colliding on the same week — worth a sequencing chat.",
        "the design/delivery overlap")
    assert reg.list_notes(cid)[0].text == note.text


# ==============================================================================================
# DURABILITY CONTRACT — postgres only (@needs_db). A process dict cannot pass these; that gap is
# exactly what feat-030 closes.
# ==============================================================================================

@pytest.fixture()
def pg(tmp_path):
    impl = _pg_impl(tmp_path)
    yield impl
    _pg_cleanup(impl)


@needs_db
def test_pg_context_survives_a_new_registry_instance(pg, tmp_path):
    """A brand-new registry instance (new connections — the module-level restart) still resolves
    the context with byte-equal cards."""
    reg_a, cid, rep = _ingest(pg, tmp_path / "mem")
    reg_b = pg.fresh()
    assert cid in reg_b
    got = reg_b.get(cid)
    assert got is not None, "context vanished for a new registry instance — persistence is fake"
    assert got.team_cards() == rep.context.team_cards()
    assert got.project_cards() == rep.context.project_cards()
    assert got.source_files == rep.context.source_files


@needs_db
def test_pg_source_documents_survive_a_new_registry_instance(pg, tmp_path):
    """feat-032 durability: the raw uploads (bytes + metadata) put by one registry instance are
    visible to a BRAND-NEW instance — metadata AND the bytea content — after a simulated restart."""
    src_docs = _sample_source_docs()
    reg_a, cid, _ = _ingest(pg, tmp_path / "mem", source_documents=src_docs)

    reg_b = pg.fresh()
    got = reg_b.get(cid)
    assert got is not None
    cards = got.file_cards()
    assert [c["filename"] for c in cards] == [HANDBOOK.name, ROSTER.name]
    # metadata read must NOT require pulling the bytea content (the manifest is metadata-only).
    assert all(sd.content is None for sd in got.source_documents), (
        "get() eagerly loaded bytea content — the manifest read should be metadata-only")
    # the bytes are still there, byte-for-byte, on a fresh instance (the restart claim).
    assert reg_b.source_document_bytes(cid, 0) == HANDBOOK.read_bytes()
    assert reg_b.source_document_bytes(cid, 1) == ROSTER.read_bytes()


@needs_db
def test_pg_notes_accumulate_and_survive_a_new_registry_instance(pg, tmp_path):
    """feat-033 the restart story for Avery's notes: observations appended by one registry instance
    are visible — in order, new->old — to a BRAND-NEW instance (the redeploy). This is what makes
    the notebook 'get thicker the longer you work together' across sessions, not just in-process."""
    reg_a, cid, _ = _ingest(pg, tmp_path / "mem")
    reg_a.append_note(cid, "First: the onboarding backlog concentrates on one squad.", "onboarding backlog")
    reg_a.append_note(cid, "Second: two handoffs bounced — a coordination seam to watch.", "bounced handoffs")

    reg_b = pg.fresh()   # a fresh instance / new connections — the simulated restart
    got = reg_b.list_notes(cid)
    assert [n.text for n in got] == [
        "Second: two handoffs bounced — a coordination seam to watch.",
        "First: the onboarding backlog concentrates on one squad.",
    ], "notes did not survive the restart in new->old order"
    # appending on the new instance keeps accumulating on top of the persisted history.
    reg_b.append_note(cid, "Third: sequencing design and delivery would ease the crunch.", "sequencing")
    assert reg_b.list_notes(cid)[0].text.startswith("Third"), "post-restart append did not accumulate"
    assert len(reg_b.list_notes(cid)) == 3


@needs_db
def test_pg_notes_refuse_a_scoring_observation_before_insert(pg, tmp_path):
    """feat-033: the Python storage gate on the notes write path runs the FULL red-line scan BEFORE
    any INSERT — a scoring self-written observation (EN or ZH) never touches the DB and never lands
    in the notebook. This is the moat feat-030's storage door promised the new write path inherits."""
    reg = pg.fresh()
    reg_seed, cid, _ = _ingest(pg, tmp_path / "mem")
    for bad in ("Give him a red rating and mark him a flight risk.",             # EN ALWAYS hits
                "把张伟的KPI评分压到60分，其余人往上提。"):                          # ZH KPI评分 + 分数
        with pytest.raises(ValueError, match="red line"):
            reg.append_note(cid, bad, "how is the team doing")
    assert reg.list_notes(cid) == [], "a scoring observation LANDED despite the append gate"


@needs_db
def test_pg_memory_dir_rematerializes_after_local_wipe(pg, tmp_path):
    """Wipe the materialized local files (what a redeploy/new machine does) -> get() rebuilds
    facts.md/notes.md from the DB byte-identically, and the loop's own recall works over the
    restored dir (the /advise seam after a restart)."""
    reg_a, cid, _ = _ingest(pg, tmp_path / "mem")
    mem_a = Path(reg_a.get(cid).memory_dir)
    facts_before = (mem_a / "facts.md").read_text(encoding="utf-8")
    notes_before = (mem_a / "notes.md").read_text(encoding="utf-8")
    assert facts_before.strip()

    shutil.rmtree(tmp_path / "data", ignore_errors=True)   # the local materialization cache
    shutil.rmtree(tmp_path / "mem", ignore_errors=True)    # the original ingest work_dir too
    reg_b = pg.fresh()
    mem_b = reg_b.resolve_memory_dir(cid)
    assert mem_b is not None and (Path(mem_b) / "facts.md").exists(), (
        "memory_dir did not re-materialize from the DB after a local wipe")
    assert (Path(mem_b) / "facts.md").read_text(encoding="utf-8") == facts_before
    assert (Path(mem_b) / "notes.md").read_text(encoding="utf-8") == notes_before

    from avery import memory
    hits = memory.recall("weekly written status update Friday", Path(mem_b))
    assert hits, "loop recall over the re-materialized memory_dir returned nothing"


@needs_db
def test_pg_schema_refuses_a_scoring_person_row(pg, tmp_path):
    """The red line is structural IN THE SCHEMA: a person payload with ANY key outside PersonEntity's
    own qualitative fields is refused by the DB itself (ALLOWLIST CHECK). feat-030 P1: this is an
    allowlist, not a denylist — so it catches Chinese scoring keys (绩效评分/排名/离职风险) and
    compound English keys (zscore/stack_rank/attrition_risk/nine_box) a wordlist would miss, by
    construction (the 'moat as a type' at the storage layer)."""
    import psycopg
    from psycopg.types.json import Jsonb

    reg, cid, _ = _ingest(pg, tmp_path / "mem")
    bad_payloads = [
        # the original denylist cases (must still be refused)
        {"name": "Mallory", "score": 88},
        {"name": "Mallory", "rank": 1},
        {"name": "Mallory", "tier": "B"},
        {"name": "Mallory", "moodPct": 40},
        {"name": "Mallory", "capacityPct": 90},
        # Chinese scoring keys — a denylist of English words misses these entirely
        {"name": "Mallory", "绩效评分": 88},
        {"name": "Mallory", "排名": 1},
        {"name": "Mallory", "离职风险": "high"},
        # compound English keys — substring/exact English denylists miss these
        {"name": "Mallory", "zscore": 1.4},
        {"name": "Mallory", "stack_rank": 3},
        {"name": "Mallory", "attrition_risk": 0.7},
        {"name": "Mallory", "nine_box": "1A"},
    ]
    with psycopg.connect(_db_url()) as conn:
        for bad in bad_payloads:
            with pytest.raises(psycopg.errors.CheckViolation):
                with conn.transaction():
                    conn.execute(
                        "INSERT INTO avery.entities (context_id, kind, idx, payload) "
                        "VALUES (%s, 'person', 9999, %s)", (cid, Jsonb(bad)))
    # a CLEAN person payload (only PersonEntity fields) must still be accepted.
    with psycopg.connect(_db_url()) as conn, conn.transaction():
        conn.execute(
            "INSERT INTO avery.entities (context_id, kind, idx, payload) "
            "VALUES (%s, 'person', 9998, %s)",
            (cid, Jsonb({"id": "u_ok", "name": "Ok Person", "role": "Engineer",
                         "team": "Eng", "tenure": "2 years", "owns": ["the flow"],
                         "collaboration": ["Design"], "source": "roster:2"})))


@needs_db
def test_pg_put_refuses_free_text_scoring(pg, tmp_path):
    """feat-030 P1: the Python storage gate is LOAD-BEARING and does the FULL red-line scan (value +
    free text), not just a key check — so a person whose qualitative fields SMUGGLE a score
    ('ranked 2/10', 'bottom quartile performer') is refused by put() before any INSERT. This is the
    gate feat-033 (Avery's self-written notes) will rely on when it adds a new write path."""
    from avery.ingest.extract import PersonEntity, MaterialChunk, ExtractionResult
    from avery.ingest.registry import CompanyContext, materialize_memory
    from avery.ingest.store import KeywordStore

    reg = pg.fresh()
    for owns, collab in (["ranked 2/10 on delivery"], []), ([], ["bottom quartile performer"]):
        cid = _new_cid()   # NOT tracked: the whole point is nothing lands
        person = PersonEntity(id="u_mal", name="Mallory", role="Engineer",
                              owns=owns, collaboration=collab)
        extraction = ExtractionResult(
            people=[person], materials=[MaterialChunk(id="m1", text="hello", source="x:1")])
        mem = materialize_memory(extraction, tmp_path / "leak" / cid)
        ctx = CompanyContext(context_id=cid, extraction=extraction, store=KeywordStore(),
                             memory_dir=mem, name="leaky", source_files=["x"])
        with pytest.raises(ValueError, match="red line"):
            reg.put(ctx)
        assert cid not in reg, "a scoring person's context LANDED despite the put() gate"


@needs_db
def test_pg_get_refreshes_stale_memory_dir(pg, tmp_path):
    """feat-030 P2: the DB is the source of truth for the (pure) materialized memory. If a reader
    host has a STALE local facts.md (older than a re-put over the same id), get() must overwrite it
    to match the DB — never serve the stale copy to the loop's recall/cite (split-brain)."""
    reg, cid, _ = _ingest(pg, tmp_path / "mem")
    mem = Path(reg.resolve_memory_dir(cid))
    truth = (mem / "facts.md").read_text(encoding="utf-8")
    assert truth.strip()

    # simulate a stale reader host: local file diverges from the DB truth.
    (mem / "facts.md").write_text("STALE — from an older ingest", encoding="utf-8")

    mem2 = Path(pg.fresh().resolve_memory_dir(cid))
    assert (mem2 / "facts.md").read_text(encoding="utf-8") == truth, (
        "get() served a STALE local facts.md instead of refreshing from the DB truth")


@needs_db
def test_pg_put_rejects_nul_bytes_cleanly(pg, tmp_path):
    """feat-030 P3: a NUL (0x00) that slipped past parse must fail put() with a clean ValueError
    (which /ingest maps to 422), NOT a raw psycopg DataError surfacing as an opaque HTTP 500."""
    from avery.ingest.extract import PersonEntity, MaterialChunk, ExtractionResult
    from avery.ingest.registry import CompanyContext, materialize_memory
    from avery.ingest.store import KeywordStore

    reg = pg.fresh()
    cid = _new_cid()   # not tracked — must not land
    extraction = ExtractionResult(
        people=[PersonEntity(id="u_a", name="Ann", role="Engineer")],
        materials=[MaterialChunk(id="m1", text="contains a \x00 null byte", source="x:1")])
    mem = materialize_memory(extraction, tmp_path / "nulbytes" / cid)
    ctx = CompanyContext(context_id=cid, extraction=extraction, store=KeywordStore(),
                         memory_dir=mem, name="nulcase", source_files=["x"])
    with pytest.raises(ValueError, match="control character"):
        reg.put(ctx)
    assert cid not in reg


@needs_db
def test_pg_schema_reserves_the_next_seams(pg, tmp_path):
    """feat-031 (embedding vector column, nullable, unfilled here) and feat-034 (owner_token,
    column only, no auth logic here) are pinned in the schema so the next features land on it."""
    import psycopg

    reg, cid, _ = _ingest(pg, tmp_path / "mem")   # also forces schema bootstrap on a blank DB
    with psycopg.connect(_db_url()) as conn:
        cols = {(r[0], r[1], r[2]) for r in conn.execute(
            "SELECT table_name, column_name, udt_name FROM information_schema.columns "
            "WHERE table_schema = 'avery'").fetchall()}
        emb_filled = conn.execute(
            "SELECT count(*) FROM avery.materials WHERE context_id = %s "
            "AND embedding IS NOT NULL", (cid,)).fetchone()[0]
    assert ("contexts", "owner_token", "text") in cols, "feat-034 seam missing: contexts.owner_token"
    assert ("materials", "embedding", "vector") in cols, "feat-031 seam missing: materials.embedding"
    assert emb_filled == 0, "feat-030 must NOT fill embeddings (that is feat-031's job)"
