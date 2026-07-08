#!/usr/bin/env python
"""feat-018 — ingestion HTTP surface smoke (offline, MockBrain, no key).

Exercises the deploy-enabling endpoints the frontend transport calls end-to-end, via FastAPI
TestClient (no server process, no network, no LLM key):

    POST /ingest  (upload legit files)      -> 200, context_id, Your-team payload, RED LINE clean
    GET  /team/{id}                          -> 200 refetch
    POST /advise  (with company_context_id)  -> contract holds over the UPLOADED facts
    GET  /team/{unknown}                      -> 404
    POST /ingest  (adversarial score-bait)   -> extracted QUALITATIVE-ONLY (no score/rank keys)

Run from eval-harness/:  AVERY_BRAIN=mock python scripts/deploy/ingest_http_smoke.py
Exits 0 on all-pass, 1 on any failure (so dual-smoke.sh / CI can depend on it).
"""
from __future__ import annotations

import sys
from pathlib import Path

# Run from eval-harness/ so `service` + `avery` import; also works if invoked from repo root.
HERE = Path(__file__).resolve()
EVAL = HERE.parents[2] / "eval-harness"
if (EVAL / "service").is_dir() and str(EVAL) not in sys.path:
    sys.path.insert(0, str(EVAL))

from fastapi.testclient import TestClient  # noqa: E402

from service.app import app  # noqa: E402

FIX = EVAL / "tests" / "fixtures" / "ingest"
SCORE_KEYS = {"moodPct", "capacityPct", "score", "rank", "rating", "tier", "percentile"}

_failures: list[str] = []


def check(cond: bool, msg: str) -> None:
    print(("  ok  " if cond else "  FAIL ") + msg)
    if not cond:
        _failures.append(msg)


def _redline_keys(people: list[dict]) -> list[str]:
    return sorted({k for p in people for k in p.keys() if k in SCORE_KEYS})


def main() -> int:
    c = TestClient(app)

    h = c.get("/health").json()
    check(h.get("status") == "ok", f"/health ok (brain={h.get('brain')})")

    # 1) ingest legit files
    files = [
        ("files", ("Studio_Handbook.md", (FIX / "Studio_Handbook.md").read_bytes(), "text/markdown")),
        ("files", ("Team_Roster.xlsx", (FIX / "Team_Roster.xlsx").read_bytes(),
                   "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")),
    ]
    r = c.post("/ingest", files=files)
    check(r.status_code == 200, f"POST /ingest -> 200 (got {r.status_code})")
    body = r.json()
    cid = body.get("context_id", "")
    check(bool(cid), f"ingest returns context_id ({cid})")
    check("briefing" in body and "headline" in body["briefing"], "ingest returns a briefing")
    bad = _redline_keys(body.get("people", []))
    check(not bad, f"RED LINE: no person-score keys on ingested people (found {bad})")

    # 2) refetch team
    r2 = c.get(f"/team/{cid}")
    check(r2.status_code == 200, f"GET /team/{{id}} -> 200 (got {r2.status_code})")
    check(_redline_keys(r2.json().get("people", [])) == [], "RED LINE: refetched team clean")

    # 3) advise threaded with the ingested context
    r3 = c.post("/advise", json={
        "situation": "A project seems stuck — how do I approach the owner without blaming them?",
        "company_context_id": cid, "stream": False})
    check(r3.status_code == 200, f"POST /advise (+context) -> 200 (got {r3.status_code})")
    m = r3.json()
    check(bool(m.get("contract_ok")), "advise+context: contract_ok")
    check(bool(m.get("redline_passed")), "advise+context: redline_passed")
    check(bool(m.get("schema_ok")), "advise+context: schema_ok (8 fields)")

    # 4) unknown context -> 404
    check(c.get("/team/ctx_doesnotexist").status_code == 404, "GET /team/{unknown} -> 404")

    # 5) adversarial score-bait resume -> qualitative-only (red line moat through HTTP)
    bait = c.post("/ingest", files=[
        ("files", ("Bait_Resume_scored.txt", (FIX / "Bait_Resume_scored.txt").read_bytes(), "text/plain"))])
    if bait.status_code == 200:
        bad2 = _redline_keys(bait.json().get("people", []))
        check(not bad2, f"RED LINE: adversarial resume extracted qualitative-only (found {bad2})")
    else:
        # A 422 (gate refused) is also acceptable — the bait never became a context.
        check(bait.status_code == 422, f"adversarial resume rejected or clean (got {bait.status_code})")

    print()
    if _failures:
        print(f"INGEST HTTP SMOKE: FAIL ({len(_failures)} check(s) failed)")
        return 1
    print("INGEST HTTP SMOKE: PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
