"""feat-041 — THE end-to-end, agent-as-first-user acceptance chain (PRD User Story 28), @needs_db.

ONE narrative walked over the REAL HTTP surface (a real uvicorn subprocess pointed at a real Postgres,
mock brain / heuristic extractor / keyword recall — persistence + isolation + memory are the claims,
NOT LLM quality), covering the whole lean-real product in a single flow rather than a bag of unit
tests. Each leg is the integration-layer twin of a feature that already went green on its own:

  1. UPLOAD company A (the two OFFICIAL seed files) -> 200 + context_id + owner_token.            [030]
  2. TEAM grows from A's real docs: source_files == the seeds, briefing counts are REAL counts.   [018]
  3. FILE SPACE: /files manifest carries n_chunks>0 and the raw bytes download byte-identical.     [032]
  4. UPLOAD company B (distinct docs, distinct people) -> its own context_id + token.
  5. HARD RESTART (kill the process; a fresh process + a fresh AVERY_DATA_DIR = fresh-machine
     semantics): A's team, files (manifest + bytes) and memory all SURVIVE.                        [030/032]
  6. ISOLATION after the restart: B's token / no token / a wrong token reading A -> 404 on EVERY
     read path (byte-identical to the unknown-id 404 — no existence oracle); A's token -> B 404.   [038]
  7. REAL RAG + CITATION: advise A cites a real fact line from A's OWN facts.md and NEVER B's roster
     names; advise B cites a real B fact and never A's case ids — bidirectional recall isolation.  [031]
  8. NOTES accumulate: several advise rounds thicken /team/{id}/notes, newest-first, cross-session. [033]
  9. RED-LINE SWITCH, BOTH states over the PERSISTENT DB path: default OFF -> a person-scoring
     question's note is DISCARDED; a life-3 process with AVERY_ALLOW_PERSON_SCORING=1 -> the SAME
     scoring question now PERSISTS a note. Two states on the SAME persisted context.               [033 pivot]

Honesty boundary (mock brain / heuristic / keyword): the NAMED-team claim (Lin Qing, Chen Mingyuan)
and semantic top-k live behind the @seedgate / @needs_keys LLM gate (test_seed_gate.py). Here the
extractor is heuristic — A's 20-row roster collapses to a single placeholder "person" offline, which
is EXPECTED and is exactly why the named-team assertion is not made here. What this chain proves is
the LLM-independent spine: persistence across a real restart, tenant isolation, that recall/cite runs
over the RIGHT company's uploaded corpus (and only that company's), notes accumulation, and the
write-side red line — the contracts a redeploy or a cross-tenant leak would actually break.

@needs_db: skips cleanly without AVERY_DB_URL/PGVECTOR_URL, so the offline suite stays autonomous.
"""
from __future__ import annotations

import os
import socket
import subprocess
import sys
import time
from pathlib import Path

import pytest

pytest.importorskip("httpx")
import httpx  # noqa: E402

from avery.env import load_dotenv

HERE = Path(__file__).resolve().parent
HARNESS = HERE.parent                      # eval-harness/
SEED_DIR = HERE / "fixtures" / "seed"
SEED_XLSX = SEED_DIR / "PrismDesign_TeamProfile_EN.xlsx"
SEED_PDF = SEED_DIR / "LogiPulse-Roadmap.pdf"
INGEST_FIX = HERE / "fixtures" / "ingest"
B_HANDBOOK = INGEST_FIX / "Studio_Handbook.md"
B_ROSTER = INGEST_FIX / "Team_Roster.xlsx"

load_dotenv(HARNESS / ".env")

needs_db = pytest.mark.needs_db

# Distinctive, corpus-specific strings — each appears in ONE company's uploads only, so an evidence
# line carrying it proves recall ran over THAT company's own facts (and a leak of the other set would
# prove a cross-tenant recall bug). A = the PrismDesign case sheet; B = the Team_Roster people.
A_FACTS = ("UI-DAILY", "Review Conflict", "Design Handoff", "Zhao Yifan", "competitive analysis")
B_PEOPLE = ("Lena Park", "Marcus Reid", "Priya Shah", "Jordan Wells")


def _db_url() -> str | None:
    return (os.environ.get("AVERY_DB_URL") or os.environ.get("PGVECTOR_URL") or "").strip() or None


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _start_service(env_extra: dict, log_path: Path):
    """A REAL uvicorn subprocess (the production process shape), offline brains forced."""
    port = _free_port()
    env = {**os.environ, **env_extra, "PYTHONUNBUFFERED": "1"}
    log_file = open(log_path, "a", encoding="utf-8", errors="replace")
    proc = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "service.app:app",
         "--host", "127.0.0.1", "--port", str(port), "--log-level", "warning"],
        cwd=str(HARNESS), env=env, stdout=log_file, stderr=subprocess.STDOUT)
    base = f"http://127.0.0.1:{port}"
    deadline = time.time() + 90
    last_err: Exception | None = None
    while time.time() < deadline:
        if proc.poll() is not None:
            log_file.flush()
            tail = log_path.read_text(encoding="utf-8", errors="replace")[-2000:]
            pytest.fail(f"uvicorn died on startup:\n{tail}")
        try:
            if httpx.get(f"{base}/health", timeout=5).status_code == 200:
                return proc, log_file, base
        except (httpx.HTTPError, OSError) as e:
            last_err = e
        time.sleep(0.4)
    proc.kill()
    log_file.close()
    pytest.fail(f"service never became healthy on {base}: {last_err}")


def _stop_hard(proc, log_file):
    """The crash/redeploy being simulated: no graceful shutdown, no atexit — kill."""
    proc.kill()
    proc.wait(timeout=15)
    log_file.close()


def _ingest(base: str, paths: list[Path]) -> dict:
    files = [("files", (p.name, p.read_bytes(), "application/octet-stream")) for p in paths]
    r = httpx.post(f"{base}/ingest", files=files, timeout=300)
    assert r.status_code == 200, f"/ingest failed on {[p.name for p in paths]}: {r.text[:400]}"
    return r.json()


def _advise(base: str, cid: str, situation: str, hdr: dict) -> dict:
    r = httpx.post(f"{base}/advise", json={
        "situation": situation, "company_context_id": cid, "stream": False},
        headers=hdr, timeout=180)
    assert r.status_code == 200, f"/advise failed: {r.status_code} {r.text[:300]}"
    return r.json()


def _notes(base: str, cid: str, hdr: dict) -> list:
    r = httpx.get(f"{base}/team/{cid}/notes", headers=hdr, timeout=30)
    assert r.status_code == 200, f"/notes failed: {r.status_code} {r.text[:200]}"
    return r.json()["notes"]


def _read_paths(cid: str):
    """Every gated READ on `cid`: (method, url, json-body-or-None) — the whole isolation surface."""
    return [
        ("GET", f"/team/{cid}", None),
        ("GET", f"/team/{cid}/notes", None),
        ("GET", f"/team/{cid}/files", None),
        ("GET", f"/team/{cid}/files/0", None),
        ("POST", "/advise", {"situation": "List everyone and what they own.",
                             "company_context_id": cid, "stream": False}),
    ]


def _do(base: str, method: str, url: str, body, hdr):
    if method == "GET":
        return httpx.get(f"{base}{url}", headers=hdr, timeout=30)
    return httpx.post(f"{base}{url}", json=body, headers=hdr, timeout=60)


@needs_db
def test_e2e_first_user_full_chain(tmp_path):
    url = _db_url()
    if not url:
        pytest.skip("needs AVERY_DB_URL (or PGVECTOR_URL) — the e2e chain skips")
    base_env = {
        "AVERY_DB_URL": url,
        "AVERY_BRAIN": "mock",            # persistence/isolation/wiring are the claims, not the LLM
        "AVERY_EXTRACTOR": "heuristic",
        "AVERY_EMBEDDINGS": "keyword",
    }
    log = tmp_path / "e2e-uvicorn.log"
    cidA = cidB = None
    xlsx_bytes = SEED_XLSX.read_bytes()

    try:
        # ============================================================= life 1: A + B are born ======
        proc1, lf1, base1 = _start_service(
            {**base_env, "AVERY_DATA_DIR": str(tmp_path / "data-life1")}, log)
        try:
            # (1) upload A
            a = _ingest(base1, [SEED_XLSX, SEED_PDF])
            cidA, tokA = a["context_id"], a["owner_token"]
            hdrA = {"X-Avery-Token": tokA}
            assert tokA and len(tokA) >= 32, "A's owner_token is missing / too short to be unguessable"
            assert set(a["source_files"]) == {SEED_XLSX.name, SEED_PDF.name}

            # (2) the team grew from A's real docs — briefing counts are REAL counts (honesty, R2)
            r_team = httpx.get(f"{base1}/team/{cidA}", headers=hdrA, timeout=30)
            assert r_team.status_code == 200
            team_before = r_team.json()
            assert "owner_token" not in team_before, "the /team refetch must NOT echo the token back"
            metrics = {m["label"]: m["value"] for m in team_before["briefing"]["metrics"]}
            assert metrics.get("people") == str(len(team_before["people"]))
            assert metrics.get("active projects") == str(len(team_before["projects"]))

            # (3) the file space: manifest with n_chunks, and the raw bytes download byte-identical
            r_files = httpx.get(f"{base1}/team/{cidA}/files", headers=hdrA, timeout=30)
            assert r_files.status_code == 200
            manifest_before = r_files.json()["files"]
            names = [f["filename"] for f in manifest_before]
            assert set(names) == {SEED_XLSX.name, SEED_PDF.name}
            assert all("size_bytes" in f and "mime" in f and "n_chunks" in f for f in manifest_before)
            assert sum(f["n_chunks"] for f in manifest_before) > 0, "no file linked to any chunk"
            xlsx_idx = names.index(SEED_XLSX.name)
            r_dl = httpx.get(f"{base1}/team/{cidA}/files/{xlsx_idx}", headers=hdrA, timeout=30)
            assert r_dl.status_code == 200 and r_dl.content == xlsx_bytes, "download not byte-identical"
            assert "attachment" in r_dl.headers.get("content-disposition", ""), (
                "untrusted upload must be served as an attachment, not rendered inline")

            # (4) upload B — a DIFFERENT company, different docs, different people
            b = _ingest(base1, [B_HANDBOOK, B_ROSTER])
            cidB, tokB = b["context_id"], b["owner_token"]
            hdrB = {"X-Avery-Token": tokB}
            assert cidB != cidA and tokB != tokA
        finally:
            _stop_hard(proc1, lf1)   # (5) HARD KILL — the redeploy / crash

        # ================================ life 2: fresh process, fresh data dir (fresh machine) ====
        proc2, lf2, base2 = _start_service(
            {**base_env, "AVERY_DATA_DIR": str(tmp_path / "data-life2")}, log)
        try:
            # (5) A SURVIVED the restart — team byte-identical, files + bytes still there
            r_team2 = httpx.get(f"{base2}/team/{cidA}", headers=hdrA, timeout=60)
            assert r_team2.status_code == 200, (
                f"company A VANISHED across the restart (HTTP {r_team2.status_code}) — the pre-030 "
                f"in-memory registry failure mode")
            assert r_team2.json() == team_before, "A's team payload drifted across the restart"

            r_files2 = httpx.get(f"{base2}/team/{cidA}/files", headers=hdrA, timeout=30)
            assert r_files2.status_code == 200
            assert r_files2.json()["files"] == manifest_before, "A's file manifest drifted post-restart"
            xlsx_idx = [f["filename"] for f in manifest_before].index(SEED_XLSX.name)
            r_dl2 = httpx.get(f"{base2}/team/{cidA}/files/{xlsx_idx}", headers=hdrA, timeout=30)
            assert r_dl2.status_code == 200 and r_dl2.content == xlsx_bytes, "A's bytes lost on restart"

            # (6) ISOLATION after the restart — the credential is real, persisted, checked in the
            # fresh process. B's token, NO token, and a WRONG token all 404 on EVERY read path for A.
            for label, hdr in (("B's token", hdrB), ("no token", None),
                               ("a wrong token", {"X-Avery-Token": "not-the-real-token"})):
                for method, u, body in _read_paths(cidA):
                    r = _do(base2, method, u, body, hdr)
                    assert r.status_code == 404, (
                        f"CROSS-TENANT LEAK post-restart: {label} read A via {method} {u} ({r.status_code})")
            # symmetric: A cannot read B
            assert httpx.get(f"{base2}/team/{cidB}", headers=hdrA, timeout=30).status_code == 404
            # no existence oracle: wrong-token 404 on a real id == unknown-id 404 (same body template)
            wrong = httpx.get(f"{base2}/team/{cidA}", headers={"X-Avery-Token": "x"}, timeout=30)
            ghost = httpx.get(f"{base2}/team/ctx_never_registered",
                              headers={"X-Avery-Token": "x"}, timeout=30)
            assert wrong.status_code == ghost.status_code == 404
            assert wrong.json() == {"detail": f"unknown company_context_id: {cidA}"}

            # (7) REAL RAG + CITATION, bidirectional isolation of recall. Advise A about A's material:
            # the cited evidence must be A's OWN facts.md lines and must never carry B's roster names.
            advA = _advise(base2, cidA,
                           "Which recurring design review conflicts keep coming up, and who owns "
                           "product direction here?", hdrA)
            assert advA.get("contract_ok") is True and advA.get("redline_passed") is True
            assert advA["gates"]["cite_gate_passed"] is True
            evA = advA["advice"]["evidence"]
            assert evA and all("facts.md:" in e for e in evA), (
                f"A's advice did not cite line-addressable facts from A's uploads: {evA}")
            assert any(tok in e for e in evA for tok in A_FACTS), (
                f"A's evidence cited no distinctive A fact — recall may not be over A's corpus: {evA}")
            assert not any(name in e for e in evA for name in B_PEOPLE), (
                f"CROSS-TENANT RECALL LEAK: A's advice cited a B roster name: {evA}")

            # advise B about B's people: cites a real B fact, never A's distinctive case ids
            advB = _advise(base2, cidB,
                           "How should I support Lena Park and Marcus Reid given their current "
                           "responsibilities?", hdrB)
            evB = advB["advice"]["evidence"]
            assert evB and all("facts.md:" in e for e in evB)
            assert any(name in e for e in evB for name in B_PEOPLE), (
                f"B's evidence cited no distinctive B fact: {evB}")
            assert not any(tok in e for e in evB for tok in A_FACTS), (
                f"CROSS-TENANT RECALL LEAK: B's advice cited an A case id: {evB}")

            # (8) NOTES accumulate, newest-first, cross-session (they were written on this process and
            # persisted to the DB). A already has notes from the advise rounds above; add two more.
            n_before = len(_notes(base2, cidA, hdrA))
            assert n_before >= 1, "the earlier clean advise on A should have left at least one note"
            _advise(base2, cidA, "Two handoffs bounced back this week — how do I tighten the seam?", hdrA)
            _advise(base2, cidA, "Design and delivery keep colliding; how should I sequence them?", hdrA)
            notes = _notes(base2, cidA, hdrA)
            assert len(notes) == n_before + 2, (
                f"two more advise rounds should add two notes: {n_before} -> {len(notes)}")
            assert "sequence" in notes[0]["source_excerpt"] or "colliding" in notes[0]["source_excerpt"], (
                "notes must list newest-first (the last question's excerpt heads the list)")

            # (9a) RED-LINE SWITCH, default OFF (this process sets no AVERY_ALLOW_PERSON_SCORING): a
            # person-scoring question's note is DISCARDED at the write-side gate — the notebook does
            # not grow, even though the advice itself passes clean.
            n_pre_score = len(notes)
            scoring_q = "She is a low performer, score her 2/10 — how do I coach the whole team back up?"
            sc = _advise(base2, cidA, scoring_q, hdrA)
            assert sc.get("redline_passed") is True, "the advice READ is clean; the DISCARD is note-side"
            assert len(_notes(base2, cidA, hdrA)) == n_pre_score, (
                "switch OFF: a person-scoring question must NOT become a persisted note")
        finally:
            _stop_hard(proc2, lf2)

        # ================= life 3: a redeploy with the scoring switch ON (Danny's policy pivot) =====
        proc3, lf3, base3 = _start_service(
            {**base_env, "AVERY_DATA_DIR": str(tmp_path / "data-life3"),
             "AVERY_ALLOW_PERSON_SCORING": "1"}, log)
        try:
            # A is still there (persistence again), and its notebook carried across from life 2.
            n_pre_on = len(_notes(base3, cidA, hdrA))
            on = _advise(base3, cidA,
                         "She is a low performer, score her 2/10 — how do I coach the whole team "
                         "back up?", hdrA)
            assert on.get("redline_passed") is True
            after = _notes(base3, cidA, hdrA)
            assert len(after) == n_pre_on + 1, (
                "switch ON: the SAME scoring question must now persist a note over the DB path")
            assert "score her 2/10" in after[0]["source_excerpt"], (
                "the newly-persisted note echoes the scoring excerpt that OFF had dropped")
        finally:
            _stop_hard(proc3, lf3)
    finally:
        # DB hygiene: drop the two contexts this chain created.
        try:
            from avery.ingest.pg_registry import PostgresContextRegistry
            reg = PostgresContextRegistry(url, data_dir=tmp_path / "cleanup")
            for cid in (cidA, cidB):
                if cid:
                    try:
                        reg.delete(cid)
                    except Exception:
                        pass
        except Exception:
            pass
