"""Semantic recall (real vector RAG) — the advisor's retrieval, embedding-ranked.

This guards the change that makes `memory.recall()` semantic when an embedder is present, WITHOUT
touching the audited cite path:

  * the semantic path returns line-addressable `facts.md:<line>` hits, and a cite() against one
    RESOLVES (the evidence gate is untouched);
  * no embedder  -> identical keyword behavior (backward compatible — every existing caller);
  * a broken embedder -> silent fallback to keyword (a live endpoint can't break an advise turn).

Offline assertions use the deterministic HashingEmbedder (no service). One test hits the REAL
Bailian text-embedding-v4 endpoint and proves the semantic WIN — it finds evidence that shares no
keywords with the query, where keyword recall returns nothing. It skips when DASHSCOPE_API_KEY is
absent, so CI / the AFK gate never depends on a live embedding service.
"""
from pathlib import Path

import pytest

from avery import memory
from avery.env import load_dotenv
from avery.ingest import HashingEmbedder

HERE = Path(__file__).resolve().parent


def _write_memory(tmp: Path, facts: list[str], notes: list[str] | None = None) -> Path:
    (tmp / "facts.md").write_text("\n".join(facts), encoding="utf-8")
    (tmp / "notes.md").write_text("\n".join(notes or ["# Notes"]), encoding="utf-8")
    return tmp


class _BrokenEmbedder:
    name = "broken"
    def embed(self, texts):
        raise RuntimeError("embedding endpoint down")


# --- offline: path is correct, cite-safe, backward compatible ---------------------------------

def test_semantic_recall_returns_cite_valid_sources(tmp_path):
    mem = _write_memory(tmp_path, [
        "# Company facts",
        "Lena Park owns the shopping-guide flow and absorbed a week of shifting client feedback.",
        "Marcus Reid keeps the build pipeline green.",
    ])
    hits = memory.recall("shifting client feedback shopping guide", mem, embedder=HashingEmbedder())
    assert hits, "semantic recall returned nothing"
    top = hits[0]
    assert top.source.startswith("facts.md:"), f"source not line-addressable: {top.source}"
    # the source must resolve to a real line (this is exactly what cite() -> resolve_ref does)
    assert memory.resolve_ref(top.source, mem, None) is not None
    assert "Lena Park" in top.text


def test_semantic_hit_can_be_cited(tmp_path):
    """A cite() against a semantic hit RESOLVES — the evidence gate works over vector retrieval."""
    mem = _write_memory(tmp_path, [
        "# Company facts",
        "The checkout redesign kept getting reworked as requirements moved week to week.",
    ])
    hits = memory.recall("requirements moved rework checkout", mem, embedder=HashingEmbedder())
    assert hits
    from avery.tools import ToolContext, dispatch
    ctx = ToolContext(memory_dir=mem, case_path=mem / "facts.md", case_id="x")
    dispatch("cite", {"claim": "the brief kept moving", "source_ref": hits[0].source}, ctx)
    assert ctx.cites[0].resolved, "a semantic-recall hit failed to cite-resolve"


def test_no_embedder_is_keyword_unchanged(tmp_path):
    """Backward compatibility: recall() with no embedder == the original keyword behavior."""
    mem = _write_memory(tmp_path, [
        "# Company facts",
        "Lena Park absorbed a week of shifting client feedback.",
        "Marcus Reid keeps the build pipeline green.",
    ])
    hits = memory.recall("pipeline green build", mem)     # keyword path
    assert hits
    assert "Marcus Reid" in hits[0].text
    assert all(isinstance(h.score, float) for h in hits)


def test_broken_embedder_falls_back_to_keyword(tmp_path):
    """An embedding failure must NOT break retrieval — it silently falls back to keyword."""
    mem = _write_memory(tmp_path, [
        "# Company facts",
        "Marcus Reid keeps the build pipeline green.",
    ])
    hits = memory.recall("pipeline green", mem, embedder=_BrokenEmbedder())
    assert hits, "fallback to keyword did not happen"
    assert "Marcus Reid" in hits[0].text


# --- online: the semantic WIN (real Bailian text-embedding-v4) --------------------------------

def _dashscope_available() -> bool:
    load_dotenv(HERE.parent / ".env")
    import os
    return bool((os.environ.get("DASHSCOPE_API_KEY") or "").strip())


@pytest.mark.skipif(not _dashscope_available(), reason="no DASHSCOPE_API_KEY (offline / AFK)")
def test_real_embeddings_find_what_keyword_misses(tmp_path):
    """The money proof: semantic recall surfaces the right line even when it shares NO keywords with
    the query — exactly the case keyword recall cannot handle."""
    from avery.embeddings import make_dashscope_embedder
    embedder = make_dashscope_embedder()
    assert embedder is not None

    mem = _write_memory(tmp_path, [
        "# Company facts",
        "Priya Shah has been absorbing a week of shifting client feedback on the checkout redesign.",
        "Marcus Reid keeps the build pipeline green and mentors two junior engineers.",
    ])
    # Query shares NO salient tokens with the target line (churn/overwhelmed vs absorbing/shifting).
    query = "who is overwhelmed by constant churn and moving goalposts?"

    keyword_hits = memory.recall(query, mem)                      # keyword: expected to miss
    semantic_hits = memory.recall(query, mem, embedder=embedder)  # vector: expected to find it

    assert semantic_hits, "semantic recall returned nothing"
    assert "Priya Shah" in semantic_hits[0].text, (
        f"semantic top hit was not the churn line: {semantic_hits[0].text!r}")
    # keyword either finds nothing or ranks the wrong line first — the semantic delta is the point.
    assert not any("Priya Shah" in h.text for h in keyword_hits[:1]), (
        "keyword unexpectedly ranked the target first; pick a harder query")
