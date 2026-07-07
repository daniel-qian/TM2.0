"""feat-022 — the seed end-to-end acceptance gate (double-layer machine gate, ADR-0022 §3).

2026-07-07 the product nearly shipped a lie: 174 green tests coexisted with an integration collapse
(the two OFFICIAL seed files produced one fake person called "No." and one filename-titled project),
because the data fixtures were reverse-engineered to the extractor's own assumptions (maker==checker)
and no machine ever walked the live integration. This file is the fix for the *eyes*, per ADR-0022:
the manual 07-07 repro, frozen into assertions. It was BORN RED on the named assertions — red is the
success condition; feat-023 (LLM extraction) turns the backend green, feat-024 the frontend.

Two layers:

  OFFLINE (always runs, no key, deterministic)
      The heuristic-fallback floor: the same two tracked seeds through the real HTTP surface
      (in-process TestClient), extractor FORCED to heuristic. Asserts the pipeline never crashes,
      the red line holds structurally (no numeric/scored person fields), the payload contract shape
      is stable, and no mojibake (U+FFFD) enters the corpus. This layer keeps the AFK gate green in
      a no-key environment — it asserts SAFETY, deliberately not extraction QUALITY.

  INTEGRATION (@seedgate; skips cleanly without live keys)
      The product truth: a REAL uvicorn on 127.0.0.1:8137 (the exact process shape `?mode=live`
      talks to), the two OFFICIAL seed files really POSTed to /ingest, and NAMED assertions:
        * xlsx roster -> >=15 people, including Lin Qing (Design Director) and Chen Mingyuan
          (Founder/CEO);
        * fake-person blacklist = 0 (no header cell — "No." / "Case ID" / "Name" ... — as a person);
        * pdf alone -> >=2 projects, no project titled by the filename;
        * person cards: zero numeric fields + no scoring keys (red line, same rule as redline_extract);
        * no U+FFFD mojibake anywhere in the payloads;
        * /advise with the context: "who leads design" must CITE the facts line naming Lin Qing
          (retrieval-quality gate — 07-07 the top-k missed her row).

Seeds are tracked fixtures (tests/fixtures/seed/), copied from the official seed-rag corpus.
Keys: integration needs MINIMAX_API_KEY (brain/extractor) + DASHSCOPE_API_KEY (semantic recall);
both live in eval-harness/.env (gitignored). CI / keyless AFK runs: integration SKIPS, offline runs.
"""
from __future__ import annotations

import json
import os
import re
import socket
import subprocess
import sys
import time
from pathlib import Path

import pytest

from avery.env import load_dotenv
from avery.ingest.extract import FORBIDDEN_PERSON_KEYS

HERE = Path(__file__).resolve().parent
HARNESS = HERE.parent                      # eval-harness/
SEED_DIR = HERE / "fixtures" / "seed"
SEED_XLSX = SEED_DIR / "PrismDesign_TeamProfile_EN.xlsx"
SEED_PDF = SEED_DIR / "LogiPulse-Roadmap.pdf"

load_dotenv(HARNESS / ".env")  # real keys live here, gitignored; absent in CI -> integration skips

SERVICE_PORT = 8137
SERVICE_URL = f"http://127.0.0.1:{SERVICE_PORT}"

# Header/table cells from the ACTUAL seed sheets that must never become a "person". This is the
# fake-person blacklist from the 07-07 diagnosis (the xlsx produced a person literally named "No.").
FAKE_PERSON_BLACKLIST = {
    "no", "no.", "case id", "case-id", "caseid", "name", "role", "title", "team", "owner",
    "status", "background", "current responsibilities", "responsibilities", "notes",
    "industry", "scale", "size range", "team structure", "tools", "communication channel",
    "problem category", "problem title", "problem description", "severity", "frequency",
    "affected roles", "pain score", "project type", "team size", "solution", "member", "members",
    "company overview", "founded", "profile", "sheet", "department", "manager", "email", "tenure",
}

# Filename-derived strings that must NOT be a project title (07-07: the pdf became exactly this).
FILENAME_TITLES = {"logipulse-roadmap", "logipulse roadmap", "logipulse_roadmap"}


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "").strip().lower()).rstrip(".")


def _numeric_leaves(obj, path="") -> list[str]:
    """Every numeric-typed leaf inside a JSON-ish structure, as 'path=value' strings."""
    out: list[str] = []
    if isinstance(obj, bool):
        return out
    if isinstance(obj, (int, float)):
        return [f"{path}={obj}"]
    if isinstance(obj, dict):
        for k, v in obj.items():
            out += _numeric_leaves(v, f"{path}.{k}" if path else str(k))
    elif isinstance(obj, (list, tuple)):
        for i, v in enumerate(obj):
            out += _numeric_leaves(v, f"{path}[{i}]")
    return out


def _assert_person_cards_redline(people: list[dict]) -> None:
    """The red line on the wire: person cards carry NO scoring key and NO numeric-typed field.
    (Digits inside free text like tenure '10 years' are fine — a typed number is not.)"""
    for card in people:
        for key in card.keys():
            norm_key = re.sub(r"[^a-z0-9]", "", str(key).lower())
            assert norm_key not in FORBIDDEN_PERSON_KEYS, (
                f"forbidden scoring key on person card {card.get('name')!r}: {key!r}")
        leaves = _numeric_leaves(card)
        assert not leaves, (
            f"numeric-typed field on person card {card.get('name')!r}: {leaves} "
            f"(red line: live person cards have no blood bar / score)")


def _assert_no_mojibake(blob: str, where: str) -> None:
    assert "�" not in blob, f"mojibake U+FFFD found in {where}"


# ==============================================================================================
# OFFLINE LAYER — heuristic-fallback floor. Always runs, no key, no network, deterministic.
# ==============================================================================================

@pytest.fixture()
def offline_client(monkeypatch):
    """In-process app forced into the fully-offline configuration (mock brain, keyword recall,
    heuristic extractor) regardless of which keys exist on the machine."""
    monkeypatch.setenv("AVERY_BRAIN", "mock")
    monkeypatch.setenv("AVERY_EMBEDDINGS", "keyword")
    monkeypatch.setenv("AVERY_EXTRACTOR", "heuristic")   # feat-023 knob; harmless before it lands
    from fastapi.testclient import TestClient
    from service.app import app
    return TestClient(app)


def _post_seeds(client, paths: list[Path]):
    files = [("files", (p.name, p.read_bytes(),
                        "application/octet-stream")) for p in paths]
    return client.post("/ingest", files=files)


def test_offline_seed_ingest_shape_and_redline(offline_client):
    """The two OFFICIAL seeds through the real HTTP wire on the heuristic floor: must not crash,
    must keep the payload contract shape, must hold the red line, must not emit mojibake."""
    r = _post_seeds(offline_client, [SEED_XLSX, SEED_PDF])
    assert r.status_code == 200, f"/ingest failed on the official seeds: {r.text[:400]}"
    payload = r.json()

    for key in ("context_id", "source_files", "people", "projects", "briefing", "signals"):
        assert key in payload, f"payload contract drifted: missing {key}"
    assert set(payload["source_files"]) == {SEED_XLSX.name, SEED_PDF.name}

    _assert_person_cards_redline(payload["people"])
    _assert_no_mojibake(json.dumps(payload, ensure_ascii=False), "offline /ingest payload")

    # briefing counts are REAL counts (R2 honesty), whatever quality the extractor managed
    metrics = {m["label"]: m["value"] for m in payload["briefing"]["metrics"]}
    assert metrics.get("people") == str(len(payload["people"]))
    assert metrics.get("active projects") == str(len(payload["projects"]))

    # /team/{id} replay returns the same payload (registry round-trip)
    r2 = offline_client.get(f"/team/{payload['context_id']}")
    assert r2.status_code == 200
    assert r2.json()["people"] == payload["people"]


def test_offline_seed_facts_materialize_cleanly(monkeypatch, tmp_path):
    """The heuristic floor materializes a citable facts.md for the seeds — line-addressable,
    mojibake-free — so the advisor seam never breaks even in fallback mode."""
    monkeypatch.setenv("AVERY_EXTRACTOR", "heuristic")
    from avery.ingest import ingest_paths
    from avery.ingest.registry import ContextRegistry

    rep = ingest_paths([str(SEED_XLSX), str(SEED_PDF)], registry=ContextRegistry(),
                       work_dir=tmp_path)
    assert rep.ok, f"heuristic floor failed the red-line gate: {rep.redline.summary()}"
    facts = (rep.context.memory_dir / "facts.md").read_text(encoding="utf-8")
    _assert_no_mojibake(facts, "materialized facts.md (heuristic floor)")
    assert facts.strip(), "facts.md is empty — the seeds produced no citable memory"

    from avery import memory
    hits = memory.recall("design director founder", rep.context.memory_dir)
    assert hits, "keyword recall over seed facts returned nothing"
    assert memory.resolve_ref(hits[0].source, rep.context.memory_dir, None) is not None


# ==============================================================================================
# INTEGRATION LAYER — @seedgate. The product truth on a REAL :8137. Born red; 023 turns it green.
# ==============================================================================================

def _integration_keys_present() -> bool:
    return bool((os.environ.get("MINIMAX_API_KEY") or "").strip()) and \
           bool((os.environ.get("DASHSCOPE_API_KEY") or "").strip())


seedgate = pytest.mark.seedgate
needs_keys = pytest.mark.skipif(
    not _integration_keys_present(),
    reason="no MINIMAX_API_KEY/DASHSCOPE_API_KEY (offline / CI) — integration seed gate skipped")


def _port_free(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        return s.connect_ex(("127.0.0.1", port)) != 0


def _kill_port_owner(port: int) -> None:
    """Kill a leftover uvicorn holding the gate port (07-05 lesson: stray servers linger)."""
    if sys.platform != "win32":  # pragma: no cover - dev box is Windows
        return
    try:
        out = subprocess.run(["netstat", "-ano", "-p", "tcp"], capture_output=True, text=True,
                             timeout=15).stdout
    except Exception:
        return
    pids = {ln.split()[-1] for ln in out.splitlines()
            if f":{port}" in ln and "LISTENING" in ln}
    for pid in pids:
        if pid.isdigit() and int(pid) > 4:
            subprocess.run(["taskkill", "/F", "/T", "/PID", pid], capture_output=True, timeout=15)


@pytest.fixture(scope="module")
def live_service():
    """A REAL uvicorn on :8137 in the production-live shape (minimax brain + dashscope embeddings),
    exactly what `?mode=live` talks to. Killed hard on teardown, leftovers killed on setup."""
    if not _port_free(SERVICE_PORT):
        _kill_port_owner(SERVICE_PORT)
        deadline = time.time() + 10
        while not _port_free(SERVICE_PORT) and time.time() < deadline:
            time.sleep(0.5)
    assert _port_free(SERVICE_PORT), f"port {SERVICE_PORT} still occupied; kill the stray uvicorn"

    env = {**os.environ, "AVERY_BRAIN": "minimax", "AVERY_EMBEDDINGS": "dashscope"}
    proc = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "service.app:app",
         "--host", "127.0.0.1", "--port", str(SERVICE_PORT)],
        cwd=str(HARNESS), env=env,
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    import httpx
    try:
        deadline = time.time() + 60
        last_err = None
        while time.time() < deadline:
            if proc.poll() is not None:
                out = proc.stdout.read().decode(errors="replace") if proc.stdout else ""
                pytest.fail(f"uvicorn died on startup:\n{out[-2000:]}")
            try:
                r = httpx.get(f"{SERVICE_URL}/health", timeout=5)
                if r.status_code == 200:
                    health = r.json()
                    assert health["brain"] == "minimax", f"gate needs the live brain, got {health}"
                    assert health["embeddings"].startswith("dashscope"), (
                        f"gate needs real embeddings, got {health['embeddings']} "
                        f"(is DASHSCOPE_API_KEY loaded?)")
                    break
            except (httpx.HTTPError, OSError) as e:
                last_err = e
            time.sleep(0.5)
        else:
            pytest.fail(f"service never became healthy on {SERVICE_URL}: {last_err}")
        yield SERVICE_URL
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait(timeout=10)
        if not _port_free(SERVICE_PORT):
            _kill_port_owner(SERVICE_PORT)


def _http_ingest(base: str, paths: list[Path]) -> dict:
    import httpx
    files = [("files", (p.name, p.read_bytes(), "application/octet-stream")) for p in paths]
    r = httpx.post(f"{base}/ingest", files=files, timeout=600)
    assert r.status_code == 200, f"real /ingest failed: HTTP {r.status_code}: {r.text[:500]}"
    return r.json()


@pytest.fixture(scope="module")
def seed_payload(live_service) -> dict:
    """One real upload of BOTH official seeds, shared by the named assertions below."""
    return _http_ingest(live_service, [SEED_XLSX, SEED_PDF])


@seedgate
@needs_keys
def test_xlsx_yields_the_named_team(seed_payload):
    """The 20-person roster must become a team: >=15 people, and the two anchor humans by name+role.
    (07-07 reality: exactly ONE 'person', named 'No.'.)"""
    people = seed_payload["people"]
    names = sorted(p["name"] for p in people)
    assert len(people) >= 15, f"expected >=15 people from the roster, got {len(people)}: {names}"

    by_name = {_norm(p["name"]): p for p in people}
    lin = by_name.get("lin qing")
    assert lin, f"Lin Qing missing from extracted people: {names}"
    assert "design director" in _norm(lin.get("role", "")), (
        f"Lin Qing's role lost: {lin.get('role')!r}")

    chen = by_name.get("chen mingyuan")
    assert chen, f"Chen Mingyuan missing from extracted people: {names}"
    assert re.search(r"founder|ceo", _norm(chen.get("role", ""))), (
        f"Chen Mingyuan's role lost: {chen.get('role')!r}")


@seedgate
@needs_keys
def test_no_fake_people_from_headers(seed_payload):
    """Fake-person blacklist = 0: no header/table cell may become a person."""
    fakes = [p["name"] for p in seed_payload["people"]
             if _norm(p["name"]) in FAKE_PERSON_BLACKLIST]
    assert not fakes, f"header cells became 'people': {fakes}"


@seedgate
@needs_keys
def test_pdf_yields_real_projects(live_service):
    """The roadmap pdf ALONE must yield >=2 projects (Phase 1 delivered + Phase 2 active at
    minimum), none of them titled by the filename. (07-07 reality: 1 project == the filename.)"""
    payload = _http_ingest(live_service, [SEED_PDF])
    projects = payload["projects"]
    titles = [pr["title"] for pr in projects]
    assert len(projects) >= 2, f"expected >=2 projects from the roadmap pdf, got {titles}"
    for t in titles:
        assert _norm(t) not in FILENAME_TITLES, f"project title is just the filename: {t!r}"


@seedgate
@needs_keys
def test_person_cards_hold_the_redline_on_the_wire(seed_payload):
    """Zero numeric fields / zero scoring keys on every person card that crossed the REAL wire."""
    _assert_person_cards_redline(seed_payload["people"])


@seedgate
@needs_keys
def test_no_mojibake_on_the_wire(seed_payload):
    """U+FFFD must never reach the product surface (07-07: '�' was observed in the corpus)."""
    _assert_no_mojibake(json.dumps(seed_payload, ensure_ascii=False), "live /ingest payload")


@seedgate
@needs_keys
def test_advise_cites_the_design_lead(live_service, seed_payload):
    """The retrieval-quality gate: asking the ingested company 'who leads design' must produce
    advice whose CITED EVIDENCE includes the facts line naming Lin Qing (Design Director).
    07-07: the advise leg ran true end-to-end but top-k recall missed her row — that quality gap
    is exactly what this assertion holds open until it is fixed."""
    import httpx
    r = httpx.post(f"{live_service}/advise", json={
        "situation": "In this team, who leads design? I need to know who owns design direction "
                     "before I reshuffle review duties.",
        "title": "who leads design",
        "company_context_id": seed_payload["context_id"],
        "stream": False,
    }, timeout=600)
    assert r.status_code == 200, f"/advise failed: HTTP {r.status_code}: {r.text[:500]}"
    body = r.json()

    assert body.get("contract_ok") is True, f"advise contract failed: {body.get('reason')}"
    assert body.get("redline_passed") is True
    assert body["gates"]["cite_gate_passed"] is True

    evidence = body["advice"]["evidence"]
    _assert_no_mojibake(json.dumps(body["advice"], ensure_ascii=False), "/advise advice payload")
    assert any("lin qing" in e.lower() for e in evidence), (
        "advice evidence never cites the Lin Qing (Design Director) facts line — "
        f"retrieval missed the best row. evidence={evidence}")
