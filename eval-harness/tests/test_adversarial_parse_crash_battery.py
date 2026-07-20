# -*- coding: utf-8 -*-
"""7/25 demo hardening — adversarial battery, ROUND 1: the parser layer trusts its libraries.

CONTEXT: three external companies upload REAL files on 7/25. The product has a documented history
of "product speaks for the customer" bugs — a file is eaten and the response still claims success.
This file is the opposite hunt: throw content at `/ingest` that is *malformed*, not merely wrong-
typed or oversized, and check whether a single hostile/broken file can take the whole request down
with an HTTP 500 instead of landing on the honest, ALREADY-BUILT failure paths (`ParseError` ->
manifest `failed`, or the feat-032 all-unparseable-batch 422).

🔴 THE FINDING (one root cause, four doors). `avery/ingest/parse.py`'s per-format parsers each wrap
ONLY the *import* of their optional library in try/except — never the parsing call itself:

    _parse_pdf   (parse.py:643-657)  — `PdfReader(io.BytesIO(data))` is unguarded
    _parse_docx  (parse.py:660-673)  — `docx.Document(io.BytesIO(data))` is unguarded
    _parse_xlsx  (parse.py:676-690)  — `load_workbook(io.BytesIO(data), ...)` is unguarded
    _parse_csv   (parse.py:698-702)  — `csv.reader(...)` is unguarded (stdlib `_csv.Error`, not
                                        an import failure at all)

Every OTHER failure mode in this codebase funnels through `ParseError` (parse.py's own contract:
"if a PDF/docx/xlsx lib is missing, `parse_file` raises `ParseError` for that file only"), and
`ingest_paths` (pipeline.py:164-168) catches ONLY `ParseError` — by design, so one bad file among
many is marked 'failed' in the manifest while the rest of the batch still ingests. But a CORRUPT
(not missing-library, not wrong-extension, not oversized) PDF/xlsx/docx, or a CSV/TSV cell over
Python's `csv.field_size_limit()` (131072 bytes, stdlib default, unrelated to any of this product's
own upload caps), raises a library-native exception that is NOT a `ParseError`:

    pypdf.errors.PdfStreamError      (corrupt/truncated PDF)
    KeyError                         (a zip missing the OOXML '[Content_Types].xml' part —
                                       openpyxl AND python-docx both throw this the same way)
    lxml.etree.XMLSyntaxError        (a present-but-malformed internal XML part)
    _csv.Error                       (a single CSV/TSV field over the stdlib's 131072-byte cap)

None of these is caught by `ingest_paths`'s per-file loop, and none is caught by the ONE other
guard in the chain — `service/ingest_api.py:294-302`'s `except ValueError` around the threadpool
call. So the exception propagates all the way out of the ASGI app uncaught, and (verified with
`TestClient(app, raise_server_exceptions=False)`, which mirrors real uvicorn behavior instead of
re-raising into the test process) the caller gets a bare **HTTP 500 "Internal Server Error"** —
not 415, not 422, not a manifest entry, nothing actionable, and — the worst part, proven below —
if the hostile file rides in a batch WITH a perfectly good file, the good file's content is lost
too, because the whole synchronous `_extract_and_ingest()` unit aborts before `registry.put()` ever
runs. No `owner_token` is even minted for the caller to retry with.

WHY THIS MATTERS MORE than a "wrong status code" nit: every one of these four inputs is realistic
for 7/25 — a `.pdf` a colleague forwarded that got truncated in an email attachment, a `.xlsx`
someone "repaired" badly, a CSV export with one merged/pasted mega-cell. None of them are attacks;
they are the ordinary failure modes of real office files. And the size gate, the type/magic-byte
gate, and the zip-bomb gate (all feat-039, all thoroughly tested in test_upload_hardgate_http.py)
do NOT catch any of these — the files here are well under every byte/count cap and pass every
magic-byte check, because the corruption is *inside* a structurally-valid container.

STATUS (2026-07-20): FIXED and now GREEN. These began as `xfail(strict=True)` born-red gates; the
fix landed in `avery/ingest/parse.py` — each of `_parse_pdf`/`_parse_docx`/`_parse_xlsx`/`_parse_csv`
now wraps its parser body (not just the library import) and re-raises any library exception as
`ParseError`, so a structurally-valid-but-internally-corrupt file is contained to a per-file
`failed` (feat-032) instead of a bare HTTP 500 that also sinks the rest of the batch. `_parse_csv`
additionally lifts stdlib `csv.field_size_limit()` to the per-file upload cap so a legitimate large
cell parses. The strict-xfail forcing function did its job (unexpected-pass → markers removed); these
now stand as plain regression tests that go red again if anyone reintroduces an uncaught parser path.

The two tests at the bottom are the safety-net check: even mid-crash, the registry is never left
holding a half-built context, and the process is not otherwise wedged.
"""
from __future__ import annotations

import io
import zipfile
from pathlib import Path

import pytest

pytest.importorskip("fastapi.testclient")
from fastapi.testclient import TestClient  # noqa: E402

HERE = Path(__file__).resolve().parent.parent


def _reset_all():
    from avery.ingest.registry import REGISTRY
    from service import upload_guard, llm_budget, mem_sentinel
    REGISTRY.clear()
    upload_guard.reset_rate_limiter()
    llm_budget.reset()
    mem_sentinel.reset()


@pytest.fixture()
def client(monkeypatch):
    """Fully-offline app: mock brain, keyword recall, heuristic extractor, NO DB. `raise_server_
    exceptions=False` is the load-bearing bit here — it makes TestClient behave like a real deployed
    uvicorn worker (an uncaught exception becomes an HTTP 500 response) instead of re-raising the
    exception into the pytest process, which is what the DEFAULT TestClient does and would turn every
    crash below into a pytest ERROR instead of a clean, xfail-able assertion."""
    monkeypatch.setenv("AVERY_BRAIN", "mock")
    monkeypatch.setenv("AVERY_EMBEDDINGS", "keyword")
    monkeypatch.setenv("AVERY_EXTRACTOR", "heuristic")
    monkeypatch.delenv("AVERY_DB_URL", raising=False)
    monkeypatch.delenv("PGVECTOR_URL", raising=False)
    _reset_all()
    from service.app import app
    with TestClient(app, raise_server_exceptions=False) as c:
        yield c
    _reset_all()


def _registry_size() -> int:
    from avery.ingest.registry import REGISTRY
    return len(REGISTRY._by_id)


# ==================================================================================================
# 1) A truncated/corrupt PDF — valid '%PDF-' magic, garbage body -> pypdf.errors.PdfStreamError
# ==================================================================================================

TRUNCATED_PDF = b"%PDF-1.7\n1 0 obj\n<< garbage not a real pdf object stream at all, no xref, no EOF"


def test_truncated_pdf_yields_a_clean_failure_not_a_500(client):
    r = client.post("/ingest", files=[
        ("files", ("weekly.pdf", TRUNCATED_PDF, "application/pdf"))])
    assert r.status_code in (200, 422), (
        f"a corrupt PDF must fail cleanly (manifest 'failed' or a 422), not crash: "
        f"{r.status_code} {r.text[:200]}")


# ==================================================================================================
# 2) A well-formed ZIP (passes the PK magic-byte gate) that is NOT an Office document at all ->
#    openpyxl / python-docx both raise KeyError looking for '[Content_Types].xml'
# ==================================================================================================

def _zip_with_files(entries: dict[str, str]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for name, content in entries.items():
            zf.writestr(name, content)
    return buf.getvalue()


NOT_AN_OFFICE_DOC = _zip_with_files({"random.txt": "this is not an office document at all"})


def test_valid_zip_that_is_not_really_an_xlsx_yields_a_clean_failure_not_a_500(client):
    r = client.post("/ingest", files=[
        ("files", ("book.xlsx", NOT_AN_OFFICE_DOC,
                  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"))])
    assert r.status_code in (200, 422), (
        f"a valid-zip-but-not-xlsx upload must fail cleanly, not crash: "
        f"{r.status_code} {r.text[:200]}")


def test_valid_zip_that_is_not_really_a_docx_yields_a_clean_failure_not_a_500(client):
    r = client.post("/ingest", files=[
        ("files", ("resume.docx", NOT_AN_OFFICE_DOC,
                  "application/vnd.openxmlformats-officedocument.wordprocessingml.document"))])
    assert r.status_code in (200, 422), (
        f"a valid-zip-but-not-docx upload must fail cleanly, not crash: "
        f"{r.status_code} {r.text[:200]}")


# ==================================================================================================
# 3) An xlsx-shaped zip whose internal XML is present but malformed -> lxml.etree.XMLSyntaxError
# ==================================================================================================

CORRUPT_INTERNAL_XML_XLSX = _zip_with_files({
    "[Content_Types].xml": "<not><valid/><xml sort of",
    "xl/workbook.xml": "<not valid either",
})


def test_xlsx_with_malformed_internal_xml_yields_a_clean_failure_not_a_500(client):
    r = client.post("/ingest", files=[
        ("files", ("book2.xlsx", CORRUPT_INTERNAL_XML_XLSX, "application/octet-stream"))])
    assert r.status_code in (200, 422), (
        f"an xlsx with malformed internal XML must fail cleanly, not crash: "
        f"{r.status_code} {r.text[:200]}")


# ==================================================================================================
# 4) A CSV/TSV cell over Python's OWN 131072-byte field-size cap -> stdlib _csv.Error
#    NOTE: this is a completely different limit from every one of THIS product's own caps
#    (AVERY_MAX_UPLOAD_BYTES default 8 MiB, AVERY_MAX_TOTAL_UPLOAD_BYTES default 32 MiB) — a
#    ~200 KB file, comfortably under every size/count gate this product enforces, still crashes it.
# ==================================================================================================

_BIG_CELL = "A" * 200_000   # > csv.field_size_limit() default (131072); the WHOLE FILE is ~200 KB


def test_oversized_csv_field_yields_a_clean_failure_not_a_500(client):
    csv_body = f"name,note\nAlice,{_BIG_CELL}\n".encode()
    r = client.post("/ingest", files=[("files", ("big.csv", csv_body, "text/csv"))])
    assert r.status_code in (200, 422), (
        f"a CSV with one oversized field must fail cleanly, not crash: "
        f"{r.status_code} {r.text[:200]}")


def test_oversized_tsv_field_yields_a_clean_failure_not_a_500(client):
    tsv_body = f"name\tnote\nAlice\t{_BIG_CELL}\n".encode()
    r = client.post("/ingest", files=[("files", ("big.tsv", tsv_body, "text/tab-separated-values"))])
    assert r.status_code in (200, 422), (
        f"a TSV with one oversized field must fail cleanly, not crash: "
        f"{r.status_code} {r.text[:200]}")


# ==================================================================================================
# 5) Collateral damage: a poison file bundled WITH a good file loses BOTH, not just the poison one.
#    This is the sharpest form of the finding — feat-032's whole design point ("one bad file among
#    many gets marked 'failed'; the rest of the batch still ingests") is silently defeated the moment
#    the bad file's failure mode is one of the four uncaught exceptions above.
# ==================================================================================================

GOOD_FILE = (b"Weekly note: the onboarding backlog keeps landing on one squad and needs "
            b"rebalancing across the pod. This line is long enough to chunk cleanly on its own.\n")


def test_mixed_batch_poison_file_does_not_destroy_the_good_file(client):
    r = client.post("/ingest", files=[
        ("files", ("good.txt", GOOD_FILE, "text/plain")),
        ("files", ("poison.pdf", TRUNCATED_PDF, "application/pdf")),
    ])
    assert r.status_code == 200, (
        f"a good file bundled with a corrupt one must still ingest (poison marked 'failed'), "
        f"not crash the whole batch: {r.status_code} {r.text[:200]}")
    manifest = client.get(f"/team/{r.json()['context_id']}/files",
                          headers={"X-Avery-Token": r.json()["owner_token"]})
    by_name = {f["filename"]: f["status"] for f in manifest.json()["files"]}
    assert by_name.get("good.txt") == "ingested", by_name
    assert by_name.get("poison.pdf") == "failed", by_name


# ==================================================================================================
# 6) The safety net that DOES hold, even mid-crash: no half-built context leaks into the registry,
#    and the crash does not otherwise wedge the process. These are real (non-xfail) assertions.
# ==================================================================================================

def test_crash_never_leaves_a_partial_context_in_the_registry(client):
    """Whatever HTTP status a crash produces, it must not be a 200 with a mangled context, and it
    must not silently register a half-built CompanyContext either. The failure is total-and-honest
    (nothing registered) rather than partial-and-silent (something registered, unusably)."""
    before = _registry_size()
    r = client.post("/ingest", files=[("files", ("weekly.pdf", TRUNCATED_PDF, "application/pdf"))])
    after = _registry_size()
    assert after == before, (
        f"a crashed ingest left a partial context in the registry ({before} -> {after}) — worse than "
        f"the 500 itself: a caller who retries now has an orphaned, half-built context nobody can "
        f"reach (no owner_token was ever returned for it)")
    if r.status_code == 200:
        assert r.json().get("owner_token"), "a 200 with no owner_token is a context nobody can read back"


def test_service_survives_a_parse_crash_and_health_stays_ok(client):
    """The crash must degrade ONE request, not the process. /health must still answer 200 right after,
    proving a single hostile upload cannot wedge or kill the single-worker box other adversarial
    inputs are also hitting concurrently on 7/25."""
    client.post("/ingest", files=[("files", ("weekly.pdf", TRUNCATED_PDF, "application/pdf"))])
    client.post("/ingest", files=[
        ("files", ("book.xlsx", NOT_AN_OFFICE_DOC,
                  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"))])
    h = client.get("/health")
    assert h.status_code == 200, "the service must survive a parse crash and keep answering /health"
