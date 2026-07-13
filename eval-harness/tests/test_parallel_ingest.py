"""feat-027 — bounded-concurrency across documents in `extract_docs` (Q1 playtest fix).

Uploading 10+ files was unusably slow because LLM extraction ran SEQUENTIALLY: each
`LLMExtractor.extract(doc)` makes blocking `brain.respond()` HTTP calls (~200s/file) and the
`extract_docs` loop waited for one document before starting the next. The fix runs the per-document
extractions concurrently with a bounded `ThreadPoolExecutor`, then merges results in ORIGINAL input
order (deterministic output identical to the sequential path) and links owners once, single-threaded.

These tests prove the MECHANICS with NO network / NO tokens using fake extractors:

  (a) actually parallel — max observed concurrency > 1 — AND bounded — never exceeds the cap;
  (b) order-preserving + identical merge — the concurrent result equals the sequential result,
      same entities in the same order;
  (c) sequential fast-path — a single doc (or max_workers<=1) never runs >1 extraction at once;
  (d) exception semantics UNCHANGED — an extractor that raises on one doc propagates out of
      `extract_docs` (the concurrent path does not newly swallow errors).

The concurrency assertion in (a) is a genuine red→green gate: it FAILS against a sequential
`extract_docs` (max concurrency == 1) and passes only once the pool is real.
"""
import threading
import time

import pytest

from avery.ingest.extract import (
    ExtractionResult, PersonEntity, ProjectEntity, SignalEntity, MaterialChunk, extract_docs,
)
from avery.ingest.parse import ParsedDoc


def _doc(name: str) -> ParsedDoc:
    """A minimal ParsedDoc — the fake extractors below key their output off doc.name only."""
    return ParsedDoc(name=name, text=name, doc_kind="company", ext="md")


class ConcurrencyProbeExtractor:
    """Fake `Extractor`: sleeps a fixed time so overlap is observable, records max concurrency.

    Each `.extract` emits exactly one person/project/signal/material tagged with the doc name so the
    merged result is order-checkable. A shared counter (guarded by a lock) tracks how many extractions
    are in flight at once; `max_seen` is the high-water mark across the whole run.
    """

    def __init__(self, sleep_s: float = 0.10):
        self.sleep_s = sleep_s
        self._lock = threading.Lock()
        self._active = 0
        self.max_seen = 0
        self.calls = 0

    def extract(self, doc: ParsedDoc) -> ExtractionResult:
        with self._lock:
            self._active += 1
            self.calls += 1
            if self._active > self.max_seen:
                self.max_seen = self._active
        try:
            time.sleep(self.sleep_s)          # hold the "call" open so real overlap shows up
        finally:
            with self._lock:
                self._active -= 1
        n = doc.name
        return ExtractionResult(
            people=[PersonEntity(id=f"u_{n}", name=n, role="Eng")],
            projects=[ProjectEntity(id=f"p_{n}", title=n, ownerName=n)],
            signals=[SignalEntity(id=f"s_{n}", source_kind="doc", subjectType="project",
                                  subjectRef=n, summary=n)],
            materials=[MaterialChunk(id=f"m_{n}", text=n, source=f"{n}:1")],
        )


class RaisingOnOneExtractor:
    """Fake `Extractor` that raises on a specific doc — to prove exception propagation is preserved."""

    def __init__(self, boom_name: str):
        self.boom_name = boom_name

    def extract(self, doc: ParsedDoc) -> ExtractionResult:
        if doc.name == self.boom_name:
            raise ValueError(f"boom on {doc.name}")
        return ExtractionResult(people=[PersonEntity(id=f"u_{doc.name}", name=doc.name)])


def _signature(res: ExtractionResult):
    """Order-sensitive fingerprint of an ExtractionResult across all four entity lists."""
    return (
        [(p.id, p.name, p.role) for p in res.people],
        [(p.id, p.title, p.ownerName) for p in res.projects],
        [(s.id, s.subjectRef, s.summary) for s in res.signals],
        [(m.id, m.text) for m in res.materials],
    )


DOCS = [_doc(f"doc{i}") for i in range(8)]


# === (a) actually parallel, and bounded =======================================================

def test_extract_docs_runs_concurrently_bounded():
    """max_workers=4 over 8 slow docs: real overlap (>1) but never more than the cap (<=4)."""
    probe = ConcurrencyProbeExtractor(sleep_s=0.10)
    extract_docs(DOCS, extractor=probe, max_workers=4)
    assert probe.calls == len(DOCS)
    assert probe.max_seen > 1, "extractions did not actually overlap — still sequential"
    assert probe.max_seen <= 4, f"concurrency exceeded the cap: {probe.max_seen} > 4"


def test_effective_workers_capped_by_doc_count():
    """min(concurrency, len(docs)): 8 workers over 3 docs never exceeds 3 in flight."""
    probe = ConcurrencyProbeExtractor(sleep_s=0.10)
    extract_docs(DOCS[:3], extractor=probe, max_workers=8)
    assert probe.max_seen <= 3, f"concurrency exceeded doc count: {probe.max_seen} > 3"
    assert probe.max_seen > 1, "3 docs with 8 workers should still overlap"


# === (b) order-preserving, identical merge ====================================================

def test_concurrent_merge_is_order_preserved_and_identical_to_sequential():
    """The concurrent result must be byte-for-byte the sequential result: same entities, same order."""
    seq = extract_docs(DOCS, extractor=ConcurrencyProbeExtractor(0.0), max_workers=1)
    par = extract_docs(DOCS, extractor=ConcurrencyProbeExtractor(0.0), max_workers=4)
    assert _signature(par) == _signature(seq)
    # explicit order check: people appear in DOCS order, not completion order
    assert [p.name for p in par.people] == [d.name for d in DOCS]


def test_link_owners_still_runs_once_post_merge():
    """A project's ownerName resolves to the extracted person id — proving _link_owners ran on the
    merged result (post-merge, single-threaded), unchanged by parallelism."""
    res = extract_docs(DOCS, extractor=ConcurrencyProbeExtractor(0.0), max_workers=4)
    for proj in res.projects:
        assert proj.ownerId == f"u_{proj.ownerName}", "owner linking must run once over the merge"


# === (c) sequential fast-path preserved =======================================================

def test_single_doc_takes_sequential_path():
    """len(docs)==1 never runs more than one extraction concurrently (fast-path, no pool)."""
    probe = ConcurrencyProbeExtractor(sleep_s=0.05)
    extract_docs(DOCS[:1], extractor=probe, max_workers=4)
    assert probe.max_seen == 1


def test_max_workers_one_is_sequential():
    """max_workers=1 forces the exact sequential loop — concurrency never exceeds 1."""
    probe = ConcurrencyProbeExtractor(sleep_s=0.05)
    extract_docs(DOCS, extractor=probe, max_workers=1)
    assert probe.max_seen == 1


# === (d) exception semantics unchanged ========================================================

def test_raising_extractor_propagates_concurrent():
    """A raising extractor sinks the batch — the pool surfaces the first exception (not swallowed)."""
    with pytest.raises(ValueError, match="boom on doc3"):
        extract_docs(DOCS, extractor=RaisingOnOneExtractor("doc3"), max_workers=4)


def test_raising_extractor_propagates_sequential():
    """Same contract on the sequential fast-path — a raise still propagates."""
    with pytest.raises(ValueError, match="boom on doc0"):
        extract_docs(DOCS, extractor=RaisingOnOneExtractor("doc0"), max_workers=1)
