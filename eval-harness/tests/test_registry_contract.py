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


def _ingest(impl: _Impl, work_dir: Path, files: list[Path] | None = None):
    """Drive the REAL pipeline (parse -> extract -> red-line gate -> store -> put) at the registry
    under test — the contract exercises the same write path the service uses."""
    reg = impl.fresh()
    cid = impl.track(_new_cid())
    paths = [str(p) for p in (files or [HANDBOOK, ROSTER])]
    rep = ingest_paths(paths, registry=reg, work_dir=work_dir, context_id=cid, name="prism")
    assert rep.ok, f"fixture ingest failed the red-line gate: {rep.redline.summary()}"
    return reg, cid, rep


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
    """The red line is structural IN THE SCHEMA: a person payload carrying a scoring key is refused
    by the DB itself (CHECK constraint), so even a buggy future writer cannot open the hole."""
    import psycopg
    from psycopg.types.json import Jsonb

    reg, cid, _ = _ingest(pg, tmp_path / "mem")
    with psycopg.connect(_db_url()) as conn:
        for bad in ({"name": "Mallory", "score": 88},
                    {"name": "Mallory", "rank": 1},
                    {"name": "Mallory", "tier": "B"},
                    {"name": "Mallory", "moodPct": 40},
                    {"name": "Mallory", "capacityPct": 90}):
            with pytest.raises(psycopg.errors.CheckViolation):
                with conn.transaction():
                    conn.execute(
                        "INSERT INTO avery.entities (context_id, kind, idx, payload) "
                        "VALUES (%s, 'person', 9999, %s)", (cid, Jsonb(bad)))


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
