# -*- coding: utf-8 -*-
"""feat-039 — unit gates for the hard-gate primitives (offline, deterministic, no HTTP).

Covers the pieces the HTTP suite exercises end-to-end, at the seam level:
  * guards.check_type — magic-byte disguise detection (per type family);
  * guards.archive_reason — bounded zip-bomb refusal (no OOM);
  * llm_budget.BudgetedBrain — the denial-of-wallet ceiling + honest degradation;
  * extractor_factory.extraction_mode — llm / heuristic / degraded labelling;
  * the heuristic "No." guard (readiness §2-G2) — a table header never becomes a person.
"""
from __future__ import annotations

import asyncio
import io
import zipfile

import pytest

from avery.ingest import guards
from avery.ingest.parse import ParsedDoc


# ── upload_guard._client_ip — spoof-resistant rate-limit key (P1, HIGH) ───────────────────────────

def test_client_ip_ignores_xff_by_default(monkeypatch):
    """Default (AVERY_TRUSTED_PROXY_HOPS unset/0): the limiter keys on the UNSPOOFABLE TCP peer and
    IGNORES X-Forwarded-For entirely — a forged XFF can no longer mint a fresh bucket per request."""
    from service import upload_guard
    monkeypatch.delenv("AVERY_TRUSTED_PROXY_HOPS", raising=False)
    scope = {"headers": [(b"x-forwarded-for", b"9.9.9.9, 8.8.8.8")], "client": ("10.0.0.1", 5)}
    assert upload_guard._client_ip(scope) == "10.0.0.1"


def test_client_ip_trusted_proxy_hops_counts_from_the_right(monkeypatch):
    """With N trusted proxies (each APPENDS the address it received from, on the right, per the nginx
    $proxy_add_x_forwarded_for recipe), the real client is the Nth XFF hop FROM THE RIGHT — never the
    attacker-controlled leftmost hop."""
    from service import upload_guard
    scope = {"headers": [(b"x-forwarded-for", b"1.1.1.1, 2.2.2.2, 3.3.3.3")],
             "client": ("10.0.0.9", 5)}
    monkeypatch.setenv("AVERY_TRUSTED_PROXY_HOPS", "1")
    assert upload_guard._client_ip(scope) == "3.3.3.3"     # one proxy -> rightmost hop
    monkeypatch.setenv("AVERY_TRUSTED_PROXY_HOPS", "2")
    assert upload_guard._client_ip(scope) == "2.2.2.2"     # two proxies -> 2nd from right
    monkeypatch.setenv("AVERY_TRUSTED_PROXY_HOPS", "3")
    assert upload_guard._client_ip(scope) == "1.1.1.1"     # three -> the real client


def test_client_ip_hops_deeper_than_chain_falls_back_to_peer(monkeypatch):
    """If XFF is SHORTER than the configured trusted depth (a misconfig, or an attacker sending too
    few hops), fall back to the unspoofable TCP peer rather than trusting a forged leftmost value."""
    from service import upload_guard
    monkeypatch.setenv("AVERY_TRUSTED_PROXY_HOPS", "3")
    scope = {"headers": [(b"x-forwarded-for", b"7.7.7.7")], "client": ("10.0.0.2", 5)}
    assert upload_guard._client_ip(scope) == "10.0.0.2"


# ── IngestGuardMiddleware streamed backstop — honest 413, RAM bounded (P2, LOW) ───────────────────

def test_streamed_backstop_sends_413_and_stays_bounded(monkeypatch):
    """The streamed total-body backstop must (a) emit an honest 413 ITSELF (not raise into the form
    parser -> a misleading 400), and (b) stop pulling the body ~one chunk past the cap so RAM stays
    bounded on the 540M box even for a chunked / lying-Content-Length client."""
    monkeypatch.setenv("AVERY_MAX_TOTAL_UPLOAD_BYTES", "2000")
    monkeypatch.delenv("AVERY_RATE_INGEST_PER_MIN", raising=False)
    from service.upload_guard import IngestGuardMiddleware

    chunk = b"x" * 512
    n_chunks = 40                       # 20 480 bytes available >> the 2 000-byte cap
    pulled = {"bytes": 0, "calls": 0}

    async def receive():
        pulled["calls"] += 1
        if pulled["calls"] > n_chunks:  # guard against an over-pulling (broken) impl looping forever
            return {"type": "http.request", "body": b"", "more_body": False}
        pulled["bytes"] += len(chunk)
        return {"type": "http.request", "body": chunk, "more_body": True}

    sent: list[dict] = []

    async def send(message):
        sent.append(message)

    async def downstream(scope, rcv, snd):
        # like FastAPI's multipart parser: drain the body, and on the abort try to emit its own 400
        # (which the guard must swallow — the client already got our 413).
        while True:
            msg = await rcv()
            if msg["type"] == "http.disconnect":
                await snd({"type": "http.response.start", "status": 400, "headers": []})
                await snd({"type": "http.response.body", "body": b'{"detail":"parse error"}'})
                return

    scope = {"type": "http", "path": "/ingest", "method": "POST",
             "headers": [], "client": ("1.2.3.4", 5555)}
    asyncio.run(IngestGuardMiddleware(downstream)(scope, receive, send))

    starts = [m for m in sent if m["type"] == "http.response.start"]
    assert starts, "the guard sent no response"
    assert all(m["status"] == 413 for m in starts), (
        f"streamed overflow must yield an honest 413 and swallow the app's 400: {starts}")
    assert pulled["bytes"] <= 2000 + len(chunk) + 8, (
        f"the backstop over-pulled the body ({pulled['bytes']} bytes; cap 2000, chunk {len(chunk)}) "
        f"— RAM is not bounded")


# ── guards.check_type — disguise detection ────────────────────────────────────────────────────────

def test_check_type_accepts_matching_types():
    assert guards.check_type("a.txt", b"plain text, all good\n") is None
    assert guards.check_type("a.md", b"# heading\nbody\n") is None
    assert guards.check_type("a.pdf", b"%PDF-1.7\n... body ...") is None
    zip_head = b"PK\x03\x04" + b"\x00" * 40
    assert guards.check_type("a.xlsx", zip_head) is None


def test_check_type_flags_disguised_binaries():
    assert guards.check_type("notes.txt", b"%PDF-1.7 hidden") is not None       # pdf-as-txt
    assert guards.check_type("notes.txt", b"PK\x03\x04zip") is not None          # zip-as-txt
    assert guards.check_type("notes.txt", b"abc\x00def") is not None             # NUL -> binary
    assert guards.check_type("book.xlsx", b"not a zip") is not None              # non-zip xlsx
    assert guards.check_type("scan.pdf", b"not a pdf") is not None               # non-pdf pdf


def test_check_type_ignores_unsupported_extension():
    """Unsupported extensions are handled by the downstream parse-fail path (feat-032), NOT 415'd
    here — so the disguise gate never regresses the 'file marked failed' manifest behaviour."""
    assert guards.check_type("weird.xyz", b"\x89 anything") is None
    assert guards.check_type("legacy.doc", b"\xd0\xcf\x11\xe0 ole") is None


# ── guards.archive_reason — bounded zip-bomb refusal ──────────────────────────────────────────────

def _zip_with(uncompressed: int) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("payload.bin", b"\x00" * uncompressed)
    return buf.getvalue()


def test_archive_reason_passes_a_small_archive(monkeypatch):
    monkeypatch.setenv("AVERY_MAX_ARCHIVE_UNCOMPRESSED_BYTES", str(1024 * 1024))
    assert guards.archive_reason(_zip_with(10_000)) is None


def test_archive_reason_refuses_a_bomb(monkeypatch):
    monkeypatch.setenv("AVERY_MAX_ARCHIVE_UNCOMPRESSED_BYTES", str(100 * 1024))
    bomb = _zip_with(5 * 1024 * 1024)          # ~5 KiB compressed, 5 MiB decompressed
    assert len(bomb) < 100 * 1024
    reason = guards.archive_reason(bomb)
    assert reason and "bomb" in reason.lower()


def test_archive_reason_rejects_non_zip():
    assert guards.archive_reason(b"definitely not a zip") is not None


# ── llm_budget — the denial-of-wallet ceiling ─────────────────────────────────────────────────────

class _EchoBrain:
    name = "echo"

    def __init__(self):
        self.calls = 0

    def respond(self, *a, **k):
        self.calls += 1
        return type("R", (), {"text": '{"people": [], "projects": [], "signals": []}'})()


def test_budget_unlimited_by_default(monkeypatch):
    from service import llm_budget
    monkeypatch.delenv("AVERY_LLM_CALL_BUDGET", raising=False)
    llm_budget.reset()
    assert llm_budget.unlimited() and not llm_budget.exhausted()
    assert llm_budget.remaining() is None


def test_budgeted_brain_trips_at_the_ceiling(monkeypatch):
    from service import llm_budget
    monkeypatch.setenv("AVERY_LLM_CALL_BUDGET", "2")
    llm_budget.reset()
    inner = _EchoBrain()
    b = llm_budget.BudgetedBrain(inner)
    b.respond("s", [])          # 1
    b.respond("s", [])          # 2 -> now at the ceiling
    with pytest.raises(llm_budget.BudgetExceeded):
        b.respond("s", [])      # 3 -> refused
    assert inner.calls == 2, "the inner brain must NOT be called once the budget is spent"
    llm_budget.reset()


# ── extractor_factory.extraction_mode — honest labelling ──────────────────────────────────────────

def _doc(name="doc.md", text="Studio overview line long enough to chunk here\n"):
    return ParsedDoc(name=name, text=text, doc_kind="company", ext="md")


class _AlwaysFailBrain:
    name = "boom"

    def respond(self, *a, **k):
        raise RuntimeError("provider down")


class _GoodPeopleBrain:
    name = "good"

    def respond(self, *a, **k):
        payload = ('{"people": [{"name": "Alice Wong", "role": "Engineer", "line": 1}], '
                   '"projects": [], "signals": []}')
        return type("R", (), {"text": payload})()


def test_extraction_mode_heuristic():
    from avery.ingest.extract import HeuristicExtractor
    from service.extractor_factory import extraction_mode
    assert extraction_mode(HeuristicExtractor()) == "heuristic"


def test_extraction_mode_degraded_on_fallback():
    from avery.ingest.llm_extract import LLMExtractor
    from service.extractor_factory import extraction_mode
    ex = LLMExtractor(_AlwaysFailBrain(), retry_backoff_s=0.0)
    ex.extract(_doc())                       # the model raises -> heuristic fallback
    assert ex.degraded is True
    assert extraction_mode(ex) == "degraded"


def test_extraction_mode_llm_when_model_handles_the_doc():
    from avery.ingest.llm_extract import LLMExtractor
    from service.extractor_factory import extraction_mode
    ex = LLMExtractor(_GoodPeopleBrain(), retry_backoff_s=0.0)
    res = ex.extract(_doc())
    assert any(p.name == "Alice Wong" for p in res.people)
    assert ex.degraded is False
    assert extraction_mode(ex) == "llm"


def test_extraction_mode_degraded_when_budget_exhausted(monkeypatch):
    """When the process budget is already spent, make_extractor degrades to a TAGGED heuristic so
    extraction_mode reports 'degraded' (not the same signal as a natively-keyless deploy)."""
    from service import llm_budget, extractor_factory
    monkeypatch.setenv("AVERY_EXTRACTOR", "llm")
    monkeypatch.setenv("AVERY_EXTRACTOR_BRAIN", "minimax")
    monkeypatch.setenv("MINIMAX_API_KEY", "sk-fake-key-present")
    monkeypatch.setenv("AVERY_LLM_CALL_BUDGET", "1")
    llm_budget.reset()
    llm_budget.charge(1)                     # spend the whole budget
    ex = extractor_factory.make_extractor()
    assert extractor_factory.extraction_mode(ex) == "degraded"
    llm_budget.reset()


# ── heuristic "No." guard (readiness §2-G2) ───────────────────────────────────────────────────────

def test_looks_like_name_rejects_index_headers():
    from avery.ingest.extract import _looks_like_name
    for header in ("No.", "No", "S.No", "Index", "Sr.", "#"):
        assert not _looks_like_name(header), f"{header!r} must not read as a person name"
    # real names still pass
    for name in ("Alice Wong", "Marcus Reid", "Priya Shah"):
        assert _looks_like_name(name)


def test_roster_index_column_header_never_becomes_a_person():
    """A roster whose header row does NOT contain 'name' must not let an index cell ('No.') slip
    through as a PersonEntity (the §2-G2 fake-"No."-exec bug)."""
    from avery.ingest.extract import HeuristicExtractor
    doc = ParsedDoc(
        name="team_roster.csv", doc_kind="roster", ext="csv",
        text="Index | Detail\nNo. | placeholder\nAlice Wong | Engineer\n")
    res = HeuristicExtractor().extract(doc)
    names = {p.name for p in res.people}
    assert "No." not in names and "Index" not in names, f"a header cell became a person: {names}"
    assert "Alice Wong" in names, "the real person must still be extracted"
