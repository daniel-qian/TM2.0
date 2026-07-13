"""feat-032 adversarial-fix gates (P1 HIGH / P2 MEDIUM / P3 LOW) — the file-space edges the first
round shipped with. Driven through the HTTP seam (FastAPI TestClient, agent as first user) on the
OFFLINE in-memory registry + heuristic extractor, so the whole file lands in the zero-network suite.

  P1 (HIGH)   two uploads sharing a basename must BOTH be parsed (no temp clobber -> silent data
              loss), each row's n_chunks must count only its own document (no filename-merged sum),
              and each idx downloads its own bytes.
  P2 (MEDIUM) a parse-failed file is marked (status='failed'), never mixed in as a valid n_chunks
              row; the briefing count reconciles with the manifest; an ALL-unparseable batch is a
              real 422 (no empty context silently published).
  P3 (LOW)    the untrusted-bytes download carries X-Content-Type-Options: nosniff (defense in depth
              on top of attachment + octet-stream).
"""
from __future__ import annotations

import pytest

pytest.importorskip("fastapi")
from fastapi.testclient import TestClient  # noqa: E402


@pytest.fixture()
def client(monkeypatch):
    """A TestClient forced onto the OFFLINE path: no DB (in-memory registry), heuristic extractor,
    keyword store — no key, no network, regardless of a developer's .env."""
    monkeypatch.delenv("AVERY_DB_URL", raising=False)
    monkeypatch.delenv("PGVECTOR_URL", raising=False)
    monkeypatch.setenv("AVERY_EXTRACTOR", "heuristic")
    monkeypatch.setenv("AVERY_EMBEDDINGS", "keyword")

    from service.app import app
    from avery.ingest.registry import REGISTRY
    REGISTRY.clear()
    with TestClient(app) as c:
        yield c
    REGISTRY.clear()


def _registry():
    from avery.ingest.registry import REGISTRY
    return REGISTRY


# ============================================================================================== P1
def test_duplicate_filenames_are_both_ingested_and_counted_per_document(client):
    """Two files BOTH named report.txt with DISTINCT content: pre-fix the second clobbered the first
    on disk (only BetaUnique reached memory/RAG) and both manifest rows reported the same merged
    n_chunks. Post-fix BOTH contents are in materials, each row counts only its own doc, and each
    idx downloads its own bytes."""
    alpha = b"AlphaUnique line one is quite long enough\nalpha second line also long enough here\n"
    beta = b"BetaUnique line one is quite long enough now\nbeta second line also long enough here\n"
    files = [("files", ("report.txt", alpha, "text/plain")),
             ("files", ("report.txt", beta, "text/plain"))]
    r = client.post("/ingest", files=files)
    assert r.status_code == 200, r.text
    cid = r.json()["context_id"]
    hdr = {"X-Avery-Token": r.json()["owner_token"]}   # feat-038: reads require the owner_token

    ctx = _registry().get(cid)
    corpus = "\n".join(m.text for m in ctx.extraction.materials)
    assert "AlphaUnique" in corpus, "the first same-named file was SILENTLY LOST from memory/RAG"
    assert "BetaUnique" in corpus, "the second same-named file is missing from memory/RAG"

    manifest = client.get(f"/team/{cid}/files", headers=hdr).json()["files"]
    assert [f["filename"] for f in manifest] == ["report.txt", "report.txt"]
    # Each row counts ONLY its own document (2 each), not the filename-merged sum (4/4 pre-fix).
    assert manifest[0]["n_chunks"] == 2 and manifest[1]["n_chunks"] == 2, manifest
    assert sum(f["n_chunks"] for f in manifest) == len(ctx.extraction.materials)

    assert client.get(f"/team/{cid}/files/0", headers=hdr).content == alpha
    assert client.get(f"/team/{cid}/files/1", headers=hdr).content == beta


# ============================================================================================== P2
def test_mixed_batch_marks_the_failed_file_and_reconciles_the_briefing(client):
    """1 parseable + 1 unparseable: the batch still publishes (the good file parsed), but the failed
    file is marked status='failed' with n_chunks=0 (not disguised as a valid entry), and the
    briefing headline reconciles with the manifest instead of claiming '1 file' while listing 2."""
    good = b"GoodContent line one is long enough to chunk\nsecond good line also long enough now\n"
    files = [("files", ("good.txt", good, "text/plain")),
             ("files", ("broken.xyz", b"\x89 not parseable as .xyz", "application/octet-stream"))]
    r = client.post("/ingest", files=files)
    assert r.status_code == 200, r.text
    body = r.json()
    cid = body["context_id"]
    hdr = {"X-Avery-Token": body["owner_token"]}   # feat-038

    manifest = client.get(f"/team/{cid}/files", headers=hdr).json()["files"]
    by = {f["filename"]: f for f in manifest}
    assert set(by) == {"good.txt", "broken.xyz"}, "the failed file dropped off the manifest"
    assert by["good.txt"]["status"] == "ingested" and by["good.txt"]["n_chunks"] > 0
    assert by["broken.xyz"]["status"] == "failed", "an unparseable file is not marked as failed"
    assert by["broken.xyz"]["n_chunks"] == 0

    # The briefing count must agree with the manifest (1 ingested of 2 uploaded), not lie either way.
    assert "1 of 2" in body["briefing"]["headline"], body["briefing"]["headline"]

    # Look-back honesty: the failed file's original bytes are still downloadable.
    assert client.get(f"/team/{cid}/files/1", headers=hdr).status_code == 200


def test_all_unparseable_batch_is_a_real_422(client):
    """An upload with content but NOTHING parseable must NOT silently publish an empty context (the
    pre-fix 200-with-empty-context hole) — it is a 422 'no parseable content', bytes dropped."""
    files = [("files", ("a.xyz", b"unparseable one", "application/octet-stream")),
             ("files", ("b.zzz", b"unparseable two", "application/octet-stream"))]
    r = client.post("/ingest", files=files)
    assert r.status_code == 422, f"all-unparseable batch published a context: {r.status_code}"
    assert "parseable" in str(r.json()).lower()


# ============================================================================================== P3
def test_download_response_sets_nosniff(client):
    """The download serves fully untrusted bytes — defense in depth: X-Content-Type-Options: nosniff
    on top of the existing attachment + generic content-type."""
    files = [("files", ("doc.txt", b"a content line long enough to chunk here\n", "text/plain"))]
    r = client.post("/ingest", files=files)
    cid = r.json()["context_id"]
    hdr = {"X-Avery-Token": r.json()["owner_token"]}   # feat-038
    dl = client.get(f"/team/{cid}/files/0", headers=hdr)
    assert dl.status_code == 200
    assert dl.headers.get("x-content-type-options") == "nosniff"
    assert "attachment" in dl.headers.get("content-disposition", "")
