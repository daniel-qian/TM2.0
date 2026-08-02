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
    * schema reserves the feat-031/038 seams: `materials.embedding vector` + `contexts.owner_token`.

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
            source_documents=None, owner_token: str = ""):
    """Drive the REAL pipeline (parse -> extract -> red-line gate -> store -> put) at the registry
    under test — the contract exercises the same write path the service uses."""
    reg = impl.fresh()
    cid = impl.track(_new_cid())
    paths = [str(p) for p in (files or [HANDBOOK, ROSTER])]
    rep = ingest_paths(paths, registry=reg, work_dir=work_dir, context_id=cid, name="prism",
                       source_documents=source_documents, owner_token=owner_token)
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


# ==============================================================================================
# feat-038 — the owner_token persistence contract (shared: memory + postgres). The tenant-isolation
# credential minted at /ingest must round-trip through put/get on BOTH backends, so the HTTP read
# gate (authorize_context) validates against a token that actually survived storage. A tokenless
# context (a pre-038 / direct caller) round-trips as "" (no auth required — v1 back-compat).
# ==============================================================================================

def test_owner_token_round_trips_through_storage(impl, tmp_path):
    reg, cid, _ = _ingest(impl, tmp_path / "mem", owner_token="tok_secret_holder_credential_xyz")
    got = reg.get(cid)
    assert got is not None
    assert got.owner_token == "tok_secret_holder_credential_xyz", (
        "owner_token did not survive the put/get round-trip — the read gate would validate against "
        "an empty token and let anyone in")


def test_tokenless_context_round_trips_as_empty(impl, tmp_path):
    """A context ingested WITHOUT an owner_token (the pre-038 / direct-caller path) reads back with
    an empty token — never a crash, never a spurious credential. Back-compat: such a context is
    readable without a token (the HTTP gate only enforces when owner_token is non-empty)."""
    reg, cid, _ = _ingest(impl, tmp_path / "mem")
    assert reg.get(cid).owner_token == ""


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


def test_manual_crud_does_not_destroy_the_uploaded_bytes(impl, tmp_path):
    """files-hub-0729/01 · An UNRELATED write (add a project by hand) must not wipe the raw uploads.

    The bug this pins: every manual-CRUD entry point is `get() -> mutate -> put()`
    (registry.py add_project / patch_project / add_person / archive_*), and the postgres `get()`
    deliberately does NOT pull the bytea (pg_registry.py, `content=None` — a multi-MB upload has no
    business loading just to read a roster). So `put()` used to re-INSERT `content=None` right after
    DELETEing the real rows: one "add a project" click permanently destroyed every original file the
    customer uploaded, and `GET /team/{id}/files/{idx}` 404'd forever after while the manifest kept
    listing the files with correct sizes.

    Two things ride on this, and the second is the heavier one:
      1. the file hub's per-file Download becomes a button that is visible, clickable and always
         fails — precisely the 「不建假按钮」 red line, arriving through the back door;
      2. the user's ORIGINAL uploads are gone, which is data loss independent of any UI.

    Memory passes trivially (it hands back the same objects); postgres is the real subject. Both owe
    the same contract, so the assertion lives in the shared section rather than under @needs_db —
    a future third implementation inherits it automatically."""
    src_docs = _sample_source_docs()
    reg, cid, _ = _ingest(impl, tmp_path / "mem", source_documents=src_docs)
    assert reg.source_document_bytes(cid, 0) == HANDBOOK.read_bytes(), "fixture precondition"

    # The most ordinary write there is — nothing to do with files.
    reg.add_project(cid, {"name": "Harbor refit", "status": "active"})

    fresh = impl.fresh()
    assert fresh.source_document_bytes(cid, 0) == HANDBOOK.read_bytes(), (
        "a manual project write destroyed the first upload's bytes")
    assert fresh.source_document_bytes(cid, 1) == ROSTER.read_bytes(), (
        "a manual project write destroyed the second upload's bytes")
    # The manifest must still agree with what is actually downloadable — a list that promises files
    # the download seam cannot serve is the same lie in a different place.
    got = fresh.get(cid)
    assert [c["filename"] for c in got.file_cards()] == [HANDBOOK.name, ROSTER.name]

    # And it must survive REPEATED writes, not just the first one (the round-trip re-reads what the
    # previous put wrote back, so a fix that only works once would pass the assertion above).
    reg.add_person(cid, {"name": "Wu Lei", "role": "Front office"})
    assert impl.fresh().source_document_bytes(cid, 0) == HANDBOOK.read_bytes(), (
        "the bytes survived one write but not two")


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
# feat-033 POLICY PIVOT (2026-07-13) — the AVERY_ALLOW_PERSON_SCORING switch, tested BIDIRECTIONALLY
# at the storage door. The in-memory and Postgres registries share ONE gate (gate_note_red_line), so
# these prove BOTH honor the switch — the pg case (@needs_db) rules out a memory-only bypass. OFF (the
# shipped default) still blocks; ON persists the SAME observation; the detector stays untouched.
# ==============================================================================================

_SWITCH = "AVERY_ALLOW_PERSON_SCORING"
_SCORING_OBS = "She is a low performer — score her 2 out of 10 on delivery."


def test_notes_switch_off_still_blocks_a_scoring_observation(impl, tmp_path, monkeypatch):
    """Regression guard (fail-closed direction): with the switch UNSET the moat holds exactly as
    shipped — the scoring observation is refused and nothing lands."""
    monkeypatch.delenv(_SWITCH, raising=False)
    reg, cid, _ = _ingest(impl, tmp_path / "mem")
    with pytest.raises(ValueError, match="red line"):
        reg.append_note(cid, _SCORING_OBS, "how is she doing this quarter")
    assert reg.list_notes(cid) == [], "switch OFF must keep blocking a scoring observation"


def test_notes_switch_on_persists_a_scoring_observation(impl, tmp_path, monkeypatch):
    """Unblock direction: with the switch ON the SAME scoring observation — and a scoring excerpt —
    now lands and is user-visible. Runs against memory AND Postgres, so pg's append_note is proven to
    honor the switch through the shared gate (not a memory-only code path)."""
    monkeypatch.setenv(_SWITCH, "1")
    reg, cid, _ = _ingest(impl, tmp_path / "mem")
    note = reg.append_note(cid, _SCORING_OBS, "李雷:9分,排名第一")   # both fields would cross when OFF
    got = reg.list_notes(cid)
    assert len(got) == 1 and got[0].text == _SCORING_OBS, "switch ON must persist the scoring note"
    assert got[0].source_excerpt == "李雷:9分,排名第一", "a scoring excerpt persists too when unblocked"


def test_notes_switch_on_still_refuses_a_nul(impl, tmp_path, monkeypatch):
    """The switch unblocks the RED LINE only. A NUL (0x00) is a storage-safety guard (it crashes the
    Postgres text write), NOT a red-line policy, so it is STILL refused with scoring unblocked."""
    monkeypatch.setenv(_SWITCH, "1")
    reg, cid, _ = _ingest(impl, tmp_path / "mem")
    with pytest.raises(ValueError, match="control character|NUL"):
        reg.append_note(cid, "a note with a\x00hidden nul", "a real question")
    assert reg.list_notes(cid) == [], "a NUL note must never land, switch on or off"


# ==============================================================================================
# OFFLINE GUARD — runs with NO database. See the 2026-07-23 lesson: `not needs_db` makes the whole
# postgres layer invisible to the default suite, so a pg-only defect ships green and only surfaces
# on a deploy. The behavioral proof of this invariant is
# `test_manual_crud_does_not_destroy_the_uploaded_bytes` above (its postgres parametrization);
# this guard exists so the *offline* suite still fails when someone deletes the fix.
# ==============================================================================================

def test_pg_put_restores_bytes_that_get_deliberately_dropped():
    """files-hub-0729/01 · Structural pin on a two-method invariant that no single method owns.

    `PostgresContextRegistry.get()` intentionally returns `content=None` (not loading multi-MB
    uploads to read a roster). That is fine ONLY while `put()` compensates — otherwise the ordinary
    `get -> mutate -> put` of every manual CRUD call silently destroys the customer's originals.

    A source-level assertion is a poor substitute for behavior and is used here on purpose: the real
    thing needs a live database, and this suite must stay runnable without one. If this ever fights
    a legitimate refactor, the fix is to make the postgres behavioral test reachable — not to relax
    this into nothing."""
    import inspect
    from avery.ingest.pg_registry import PostgresContextRegistry

    get_src = inspect.getsource(PostgresContextRegistry.get)
    assert "content=None" in get_src.replace(" ", ""), (
        "get() no longer drops the bytea — re-check whether put()'s restore is still needed, and "
        "update this guard deliberately rather than deleting it")

    put_src = inspect.getsource(PostgresContextRegistry.put)
    assert "prior_bytes" in put_src, (
        "put() lost the prior-bytes restore: every manual CRUD write now NULLs avery.source_documents"
        ".content, permanently destroying uploaded originals and turning the file hub's Download into"
        " a button that always fails")
    assert "sd.content is not None" in put_src, (
        "put() must only FALL BACK to the stored bytes — overwriting caller-supplied content would "
        "make a genuine re-ingest resurrect stale bytes")


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
def test_pg_owner_token_survives_a_new_registry_instance(pg, tmp_path):
    """feat-038 the restart story for tenant isolation: the owner_token put by one registry instance
    is read back by a BRAND-NEW instance/connection (the redeploy). This is what lets a company still
    prove ownership after the service restarts — the credential lives in the DB, not process memory."""
    reg_a, cid, _ = _ingest(pg, tmp_path / "mem", owner_token="tok_survives_the_redeploy")
    reg_b = pg.fresh()
    assert reg_b.get(cid).owner_token == "tok_survives_the_redeploy", (
        "owner_token vanished across a new registry instance — isolation would reset to open on a "
        "redeploy")


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
    # rich-align-0722/03+06 REGRESSION: pg_registry.put() writes asdict(PersonEntity), which ALWAYS
    # emits self_report/archived/provenance (even at defaults). The hand-built minimal dict above
    # never exercised that — so the stale 0002 allowlist rejected every REAL campaign-code person
    # write in prod while this DB test stayed green. Insert a FULL PersonEntity, self_report
    # populated (the 03 sanctioned slot), and REQUIRE acceptance (allowlist realigned in 0009).
    from dataclasses import asdict
    from avery.ingest.extract import PersonEntity, PersonSelfReport, SelfReportLoad
    rich = asdict(PersonEntity(
        id="u_full", name="Rich Person", role="Lead", team="Sales", tenure="3y",
        owns=["banquet ops"], collaboration=["Ops"], source="roster:3",
        self_report=PersonSelfReport(load=SelfReportLoad(value=70)),
        archived=False, provenance={"role": {"origin": "manual", "source": "手动编辑"}}))
    with psycopg.connect(_db_url()) as conn, conn.transaction():
        conn.execute(
            "INSERT INTO avery.entities (context_id, kind, idx, payload) "
            "VALUES (%s, 'person', 9997, %s)", (cid, Jsonb(rich)))


def test_person_keys_allowlist_covers_exactly_person_fields():
    """OFFLINE regression guard (no DB — runs in the standard `not needs_db` suite) for the class of
    bug that shipped in rich-align-0722. Two failure modes, both invisible offline (the in-memory
    registry never hits a real CHECK) and fatal in prod:
      (1) drift — pg_registry.put() writes asdict(PersonEntity), which ALWAYS emits every field, so a
          field added to PersonEntity without extending the allowlist REJECTS every person write;
      (2) replay-safety — _ensure_schema replays every migration and the ADD validates all rows WHEN
          IT FIRES, so a STALE allowlist ADD (a strict subset of the current fields) aborts the WHOLE
          bootstrap once any row carries a newer key (0002's pre-03 8-key ADD did exactly this after
          the demo's self_report rows existed).
    So EVERY ALTER-ADD of the allowlist — not just the last — must equal PersonEntity's fields. (Since
    gc-demo-clones-0724 the ADD is guarded to SKIP when the constraint is already present & correct —
    but it still fires on a fresh DB or an in-place edit, so the array must stay in sync regardless;
    the real-pg oid-stability check is test_pg_bootstrap_constraint_guard_skips_re_add.) A static parse
    of the migrations closes both gaps at commit time, no live DB required."""
    import dataclasses
    from avery.ingest.extract import PersonEntity
    person_fields = {f.name for f in dataclasses.fields(PersonEntity)}

    migrations = sorted((HERE / "db" / "migrations").glob("*.sql"))
    adds = []   # (migration, allowed set) for EVERY ALTER-ADD of the allowlist (all are re-validated)
    for path in migrations:
        sql = re.sub(r"--[^\n]*", "", path.read_text(encoding="utf-8"))   # strip comments (hold DDL prose)
        for m in re.finditer(
            r"ADD\s+CONSTRAINT\s+entities_person_keys_allowlist\b.*?payload\s*-\s*ARRAY\s*\[(.*?)\]",
            sql, re.S | re.I):
            adds.append((path.name, set(re.findall(r"'([^']+)'", m.group(1)))))
    assert adds, "no migration ADDs entities_person_keys_allowlist"

    bad = {name: sorted(s ^ person_fields) for name, s in adds if s != person_fields}
    assert not bad, (
        "A person-keys allowlist ADD is out of sync with PersonEntity. pg_registry writes "
        "asdict(PersonEntity) and _ensure_schema re-validates every ADD on each bootstrap, so a "
        "mismatch either rejects person writes or aborts bootstrap.\n"
        f"  PersonEntity fields: {sorted(person_fields)}\n"
        f"  out-of-sync ADDs (migration -> symmetric diff vs PersonEntity): {bad}\n"
        "Edit 0009's allowlist IN PLACE to match PersonEntity (never add a superseding migration).")


def test_entities_kind_check_covers_written_kinds():
    """OFFLINE regression guard (no DB) — sibling to the person-keys guard, same two failure modes
    (drift + replay-safety). entities_kind_check must allow EXACTLY the entity kinds pg_registry.put()
    writes (_ENTITY_KINDS); 08 added the "playbook" kind to the writer but not the CHECK, so real
    Postgres rejected the demo cast. Every ALTER-ADD of the CHECK validates rows WHEN IT FIRES (since
    gc-demo-clones-0724 it is guarded to skip when unchanged, but still fires on a fresh DB / in-place
    edit), so all must equal _ENTITY_KINDS. (0001's inline CREATE-TABLE CHECK is exempt — CREATE TABLE
    IF NOT EXISTS is a no-op on replay and never re-validates — so this inspects only `ADD CONSTRAINT`.)"""
    from avery.ingest.pg_registry import _ENTITY_KINDS
    kinds = set(_ENTITY_KINDS)

    migrations = sorted((HERE / "db" / "migrations").glob("*.sql"))
    adds = []   # (migration, allowed set) for every ALTER-ADD of entities_kind_check
    for path in migrations:
        sql = re.sub(r"--[^\n]*", "", path.read_text(encoding="utf-8"))
        for m in re.finditer(
            r"ADD\s+CONSTRAINT\s+entities_kind_check\b.*?ARRAY\s*\[([^\]]*)\]", sql, re.S | re.I):
            adds.append((path.name, set(re.findall(r"'([^']+)'", m.group(1)))))
    assert adds, "no migration ADDs entities_kind_check"

    bad = {name: sorted(s ^ kinds) for name, s in adds if s != kinds}
    assert not bad, (
        "An entities_kind_check ADD is out of sync with the kinds pg_registry.put() writes "
        "(_ENTITY_KINDS); _ensure_schema re-validates every ADD on each bootstrap.\n"
        f"  _ENTITY_KINDS: {sorted(kinds)}\n"
        f"  out-of-sync ADDs (migration -> symmetric diff): {bad}\n"
        "Edit the kind-check migration IN PLACE to match _ENTITY_KINDS.")


def test_entity_pg_roundtrip_coerces_nested_dataclasses():
    """OFFLINE regression guard (no DB) for the pg persistence round-trip. pg_registry stores
    asdict(entity) as JSONB and rebuilds via Entity(**payload) (_entity). Every nested-dataclass
    field — ProjectEntity.risk/milestones, PersonEntity.self_report — MUST coerce back to its type in
    __post_init__; otherwise consumers hit `dict.attr` (e.g. project.risk.level) on the PERSISTED read
    path, which the in-memory offline suite never exercises. rich-align/01/02 shipped exactly this:
    the demo claim 500'd on `'dict' object has no attribute 'level'`. Simulate the round-trip with
    asdict -> dict -> reconstruct and assert the nested fields come back typed, not as dicts."""
    from dataclasses import asdict
    from avery.ingest.extract import (
        PersonEntity, PersonSelfReport, SelfReportLoad, ProjectEntity, ProjectRisk, ProjectMilestone)

    proj = ProjectEntity(id="p1", title="Banquet", risk=ProjectRisk(level="high", reason="rain"),
                         milestones=[ProjectMilestone(name="tasting", status="done")])
    proj2 = ProjectEntity(**asdict(proj))    # the exact pg read: _entity(ProjectEntity, .., payload)
    assert isinstance(proj2.risk, ProjectRisk) and proj2.risk.level == "high"
    assert proj2.milestones and all(isinstance(m, ProjectMilestone) for m in proj2.milestones)
    assert proj2.milestones[0].status == "done"

    person = PersonEntity(id="u1", name="Z",
                          self_report=PersonSelfReport(load=SelfReportLoad(value=70)))
    person2 = PersonEntity(**asdict(person))
    assert isinstance(person2.self_report, PersonSelfReport)
    assert isinstance(person2.self_report.load, SelfReportLoad) and person2.self_report.load.value == 70


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
    """feat-031 (embedding vector column, nullable, unfilled here) and feat-038 (owner_token, the
    tenant-isolation credential) are pinned in the schema so those features land on it."""
    import psycopg

    reg, cid, _ = _ingest(pg, tmp_path / "mem")   # also forces schema bootstrap on a blank DB
    with psycopg.connect(_db_url()) as conn:
        cols = {(r[0], r[1], r[2]) for r in conn.execute(
            "SELECT table_name, column_name, udt_name FROM information_schema.columns "
            "WHERE table_schema = 'avery'").fetchall()}
        emb_filled = conn.execute(
            "SELECT count(*) FROM avery.materials WHERE context_id = %s "
            "AND embedding IS NOT NULL", (cid,)).fetchone()[0]
    assert ("contexts", "owner_token", "text") in cols, "feat-038 seam missing: contexts.owner_token"
    assert ("materials", "embedding", "vector") in cols, "feat-031 seam missing: materials.embedding"
    assert emb_filled == 0, "feat-030 must NOT fill embeddings (that is feat-031's job)"


# ==============================================================================================
# CLONE CONTRACT — input-side-0721 · 3A 一键示例团队的底座（memory + postgres 同一张合约）
# ==============================================================================================
# 为什么是克隆：demo 母本是共享的，而 /advise 落笔记、/ask 落行——发同一个 owner_token 给所有
# 访客等于让他们互相写脏。clone_context 把母本整体复制成一个新 id + 新 token 的私有副本。
# pg 侧必须是 SQL 级 INSERT..SELECT：get()+put() 重组会 ① 重新烧一遍 embedding（纯花钱）、
# ② 丢 source_documents 的 bytea（get() 刻意不拉字节），两条都是这张合约要钉死的行为。


def test_clone_makes_a_readable_twin_with_its_own_credentials(impl, tmp_path):
    reg, cid, _ = _ingest(impl, tmp_path / "mem", source_documents=_sample_source_docs(),
                          owner_token="token-master")
    new_cid = impl.track(_new_cid())
    ok = reg.clone_context(cid, new_context_id=new_cid, new_owner_token="token-clone")
    assert ok is True, "母本存在时克隆必须成功"
    twin = reg.get(new_cid)
    assert twin is not None, "克隆出来的副本读不回来"
    assert twin.owner_token == "token-clone", "副本必须持有自己的 owner_token"
    master = reg.get(cid)
    assert master.owner_token == "token-master", "克隆不许动母本的凭据"
    assert [p.name for p in twin.extraction.people] == [p.name for p in master.extraction.people]
    assert [m.text for m in twin.extraction.materials] == [m.text for m in master.extraction.materials]
    assert twin.source_files == master.source_files


def test_clone_copies_source_document_bytes(impl, tmp_path):
    """file space 不缩水：副本的「你的文件」必须能下载到和母本一字不差的原始字节。
    （pg 陷阱：get() 刻意不拉 bytea——克隆若走 get()+put() 重组，这里就会拿到 None。）"""
    reg, cid, _ = _ingest(impl, tmp_path / "mem", source_documents=_sample_source_docs(),
                          owner_token="token-master")
    new_cid = impl.track(_new_cid())
    assert reg.clone_context(cid, new_context_id=new_cid, new_owner_token="token-clone")
    for idx in (0, 1):
        want = reg.source_document_bytes(cid, idx)
        got = reg.source_document_bytes(new_cid, idx)
        assert want, "合约前提：母本自己有字节"
        assert got == want, f"副本第 {idx} 份文件的字节丢了或变了"


def test_clone_copies_notes_then_isolates_them(impl, tmp_path):
    """预铸母本的「实时数据缺位」笔记要跟着副本走；克隆之后两边各写各的，互不可见。"""
    reg, cid, _ = _ingest(impl, tmp_path / "mem", owner_token="token-master")
    reg.append_note(cid, "示例工作区：实时数据还没接入。", "初始设置")
    new_cid = impl.track(_new_cid())
    assert reg.clone_context(cid, new_context_id=new_cid, new_owner_token="token-clone")
    twin_notes = reg.list_notes(new_cid)
    assert len(twin_notes) == 1 and "实时数据" in twin_notes[0].text, "预铸笔记没跟上副本"
    assert twin_notes[0].id != reg.list_notes(cid)[0].id, "副本笔记必须换新 id（company_notes.id 全局唯一）"
    reg.append_note(new_cid, "副本自己的新观察。", "")
    assert len(reg.list_notes(cid)) == 1, "副本的写入渗进了母本（克隆隔离失守）"
    reg.append_note(cid, "母本这边的新观察。", "")
    assert len(reg.list_notes(new_cid)) == 2, "母本的后续写入不该再影响已克隆的副本"


def test_clone_of_a_missing_context_is_a_clean_no(impl, tmp_path):
    reg = impl.fresh()
    assert reg.clone_context("ctx_never_existed", new_context_id=impl.track(_new_cid()),
                             new_owner_token="t") is False


# ==============================================================================================
# gc-demo-clones-0724 · 访客克隆的 TTL 回收（sweep_ephemeral）
# 每次 /demo/claim 把母本整体克隆成访客私有副本（三亚 seed = 16 人 + 12 项目 + 5 方法卡 + 212 材料/份），
# 永不回收就是 avery.contexts/entities/materials 无界增长，早晚拖慢 _ensure_schema 的 ADD CONSTRAINT。
# 克隆打 ephemeral 标（母本走 put() 不带标）；sweep 只删「够旧 + 未登账号」的 ephemeral 克隆——母本
# （ctx_demo_*）和 account_contexts 里的克隆一律豁免。两个 registry 走同一份合约。


def _demo_clone(impl, master_cid: str, *, ephemeral: bool = True) -> str:
    """A guest twin off a demo master (like /demo/claim), tracked for post-test DB cleanup."""
    reg = impl.fresh()
    new = impl.track(_new_cid())
    assert reg.clone_context(master_cid, new_context_id=new, new_owner_token="tok-" + new,
                             ephemeral=ephemeral)
    return new


def test_sweep_collects_only_old_unlinked_ephemeral_clones(impl, tmp_path):
    reg, master, _ = _ingest(impl, tmp_path / "mem", owner_token="token-master")
    guest = _demo_clone(impl, master)             # an anonymous demo guest clone
    linked = _demo_clone(impl, master)            # a guest who then signs in
    assert reg.link_account_context("user_signed_in", linked)

    # a generous TTL collects nothing — none of these clones is old enough yet.
    assert reg.sweep_ephemeral(older_than_hours=99999, limit=50) == 0
    assert master in reg and guest in reg and linked in reg

    # ttl=0 = "collect every eligible ephemeral clone now": only the unlinked guest goes.
    assert reg.sweep_ephemeral(older_than_hours=0, limit=50) == 1
    assert guest not in reg, "过期访客克隆没被回收"
    assert master in reg, "母本（非 ephemeral）被误删"
    assert linked in reg, "已登账号的克隆被误删（link 应清 ephemeral 标 + sweep 有 account 守卫）"


def test_sweep_respects_the_batch_limit(impl, tmp_path):
    """A bounded sweep deletes at most `limit`, leaving the rest for the next claim's sweep — so an
    opportunistic claim-time GC is a small, cheap delete, never an unbounded one on the hot path."""
    reg, master, _ = _ingest(impl, tmp_path / "mem", owner_token="token-master")
    clones = [_demo_clone(impl, master) for _ in range(3)]
    assert reg.sweep_ephemeral(older_than_hours=0, limit=2) == 2
    assert len([c for c in clones if c in reg]) == 1, "batch 上限没生效（应留 1 份给下次 claim 扫）"
    assert reg.sweep_ephemeral(older_than_hours=0, limit=50) == 1
    assert all(c not in reg for c in clones)


def test_a_non_ephemeral_clone_is_never_swept(impl, tmp_path):
    """clone_context(ephemeral=False) — a real (non-demo) copy — is exempt from GC even when old."""
    reg, master, _ = _ingest(impl, tmp_path / "mem", owner_token="token-master")
    keep = _demo_clone(impl, master, ephemeral=False)
    assert reg.sweep_ephemeral(older_than_hours=0, limit=50) == 0
    assert keep in reg


@needs_db
def test_pg_ephemeral_flag_round_trips(pg, tmp_path):
    """The clone's ephemeral flag actually lands in avery.contexts (GC keys on it): a default clone is
    ephemeral=true, an ephemeral=False clone is false, and a master (put()) is false."""
    reg, master, _ = _ingest(pg, tmp_path / "mem", owner_token="tm")
    guest = _demo_clone(pg, master)
    plain = _demo_clone(pg, master, ephemeral=False)

    def _eph(cid: str):
        with reg._connect() as conn:
            return conn.execute("SELECT ephemeral FROM avery.contexts WHERE context_id = %s",
                                (cid,)).fetchone()[0]
    assert _eph(master) is False, "母本不该是 ephemeral"
    assert _eph(guest) is True, "默认克隆应是 ephemeral（可回收）"
    assert _eph(plain) is False, "ephemeral=False 克隆不该被标记"


@needs_db
def test_pg_sweep_honors_created_at_ttl(pg, tmp_path):
    """The REAL age gate over the created_at column (the shared ttl=0 test can't exercise it): a clone
    backdated past the 48h TTL is swept; a fresh one within the TTL survives."""
    reg, master, _ = _ingest(pg, tmp_path / "mem", owner_token="tm")
    old = _demo_clone(pg, master)
    fresh = _demo_clone(pg, master)
    with reg._connect() as conn:
        conn.execute("UPDATE avery.contexts SET created_at = now() - interval '72 hours' "
                     "WHERE context_id = %s", (old,))
    assert reg.sweep_ephemeral(older_than_hours=48, limit=50) == 1
    assert old not in reg, "超过 48h TTL 的克隆没被回收"
    assert fresh in reg, "48h 内的新克隆被误删"


@needs_db
def test_pg_link_clears_ephemeral_flag(pg, tmp_path):
    """A guest who signs in and links their demo clone: the ephemeral flag flips false, so a later
    sweep (even ttl=0) never touches it — belt-and-suspenders with the sweep's account guard."""
    reg, master, _ = _ingest(pg, tmp_path / "mem", owner_token="tm")
    clone = _demo_clone(pg, master)
    assert reg.link_account_context("user_a", clone)
    with reg._connect() as conn:
        flag = conn.execute("SELECT ephemeral FROM avery.contexts WHERE context_id = %s",
                            (clone,)).fetchone()[0]
    assert flag is False, "link 之后 ephemeral 标没清"
    assert reg.sweep_ephemeral(older_than_hours=0, limit=50) == 0
    assert clone in reg


@needs_db
def test_pg_bootstrap_constraint_guard_skips_re_add(pg, tmp_path):
    """Fix #2 Tier 2: 0009/0010's guarded ADD CONSTRAINT SKIPS the DROP+ADD (and its full-table
    re-validation under ACCESS EXCLUSIVE) when the constraint is already present & correct — proven by
    the constraint OID staying constant across a second _ensure_schema (a re-DROP would mint a new oid).
    This is also the real-pg check that 0009/0010's skip-comparison `want` matches Postgres's own
    rendering of the ADD: a mismatch would re-DROP every bootstrap and this oid would move."""
    reg = pg.fresh()
    reg._ensure_schema()

    def _oids() -> dict:
        with pg.fresh()._connect() as conn:
            return dict(conn.execute(
                "SELECT conname, oid::text FROM pg_constraint "
                "WHERE conrelid = 'avery.entities'::regclass "
                "AND conname IN ('entities_person_keys_allowlist', 'entities_kind_check')").fetchall())
    before = _oids()
    assert set(before) == {"entities_person_keys_allowlist", "entities_kind_check"}

    pg.fresh()._ensure_schema()   # a second bootstrap; the schema is already present & correct
    assert _oids() == before, (
        "guarded ADD CONSTRAINT re-DROPped an unchanged constraint — the skip comparison (`want`) is "
        "out of sync with pg_get_constraintdef, so every bootstrap re-validates the whole table")


@needs_db
def test_pg_manual_crud_roundtrip_erases_no_column_anywhere(pg, tmp_path):
    """arch-0802 — 关掉类而不是实例：put/get 不对称快照的全列守卫。

    get() 是有损投影（source_documents.content 刻意不拉 bytea、materials.embedding 不读回），
    put() 是整快照 DELETE+INSERT，而全部手编 CRUD 都是 get→改→put——投影丢掉的任何列都会被
    往返静默抹掉。bytes 列真踩过（files-hub-0729），当时的钉子只看 bytes 一列。本守卫在一次
    get→add_project→put 往返之后对 avery.* 里**每张带 context_id 的表逐列** diff（时间戳审计列
    updated_at/created_at 除外；uploaded_at 是业务数据，**不豁免**）：未来任何进快照的新列被
    往返抹掉，这里直接红——不需要有人预言是哪一列。
    """
    import psycopg

    reg, cid, _ = _ingest(pg, tmp_path / "mem", source_documents=_sample_source_docs())

    AUDIT_COLS = {"updated_at", "created_at"}

    def _norm(v):
        if isinstance(v, memoryview):
            return bytes(v)
        if hasattr(v, "isoformat"):
            return v.isoformat()
        return v

    def dump(conn) -> dict[str, list[dict]]:
        tables = [r[0] for r in conn.execute(
            "SELECT table_name FROM information_schema.tables WHERE table_schema='avery' "
            "AND table_type='BASE TABLE' ORDER BY table_name").fetchall()]
        snap: dict[str, list[dict]] = {}
        for t in tables:
            cols = [r[0] for r in conn.execute(
                "SELECT column_name FROM information_schema.columns "
                "WHERE table_schema='avery' AND table_name=%s ORDER BY ordinal_position",
                (t,)).fetchall()]
            if "context_id" not in cols:
                continue  # 与单个 context 快照无关的表（如迁移台账）不属于本守卫
            keep = [c for c in cols if c not in AUDIT_COLS]
            rows = conn.execute(
                f'SELECT {", ".join(keep)} FROM avery.{t} WHERE context_id = %s',
                (cid,)).fetchall()
            snap[t] = sorted(
                (dict(zip(keep, (_norm(v) for v in row))) for row in rows),
                key=lambda d: str(sorted((k, str(v)) for k, v in d.items())))
        return snap

    with psycopg.connect(_db_url()) as conn:
        before = dump(conn)
    assert any(r.get("content") for r in before.get("source_documents", [])), (
        "fixture胎里就没有字节——守卫没有测到东西")

    reg.add_project(cid, {"title": "Roundtrip Guard"})   # 最典型的 get→改→put 路径

    with psycopg.connect(_db_url()) as conn:
        after = dump(conn)

    # entities 本来就该多一行（新项目）：非 project 行必须逐列原样，project 旧行原样 +1 新行。
    ent_before = before.pop("entities")
    ent_after = after.pop("entities")
    assert [r for r in ent_before if r["kind"] != "project"] == \
           [r for r in ent_after if r["kind"] != "project"], "非 project 实体行被往返改写"
    pj_before = sorted((r for r in ent_before if r["kind"] == "project"), key=lambda r: r["idx"])
    pj_after = sorted((r for r in ent_after if r["kind"] == "project"), key=lambda r: r["idx"])
    assert len(pj_after) == len(pj_before) + 1 and pj_after[:-1] == pj_before, (
        "已有 project 行没有原样活过一次 add_project")
    assert pj_after[-1]["payload"].get("title") == "Roundtrip Guard"

    erased = {
        t: [k for k in {c for row in before[t] for c in row}
            if any(b.get(k) not in (None, "") for b in before[t])
            and all(a.get(k) in (None, "") for a in after[t])]
        for t in before if before[t] != after.get(t)
    }
    assert before == after, (
        f"get→改→put 往返改写了快照列。整列被抹掉的: { {t: v for t, v in erased.items() if v} }; "
        f"全部差异表: {sorted(t for t in before if before[t] != after.get(t))}")
