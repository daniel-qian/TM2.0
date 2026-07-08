"""The feat-015 <-> feat-016 seam, as a thin composition helper (no feat-015 rewrite).

`service/live_input.py::build_live_case` already accepts a `memory_dir` and threads a
`company_context_id`. Ingestion (this package) registers a `CompanyContext` under that id whose
`memory_dir` holds red-line-clean, line-addressable facts. The ONLY missing wire is: given a
request's `company_context_id`, hand the advisor the INGESTED memory_dir instead of the default
demo memory — then the loop's own `recall`/`cite`/red-line run over the manager's uploaded facts,
unchanged.

This module is that wire, expressed as compose-not-modify helpers the service can adopt:

  * `resolve_memory_dir(id, default)`  — id -> ingested memory_dir, else the default. Pure lookup.
  * `build_live_case_for_context(...)` — build the live case against the resolved memory_dir. A
    one-line wrapper over the feat-015 `build_live_case`, passing the ingested memory in.

Keeping it here (not in service/live_input.py) honors the constraint "don't rewrite feat-015 — the
integrator wires it in"; the seam is real and covered, and adoption in app.py is a 2-line change
the integrator can drop in (resolve the id, pass the dir).
"""
from __future__ import annotations

from pathlib import Path

from .registry import ContextRegistry, REGISTRY


def resolve_memory_dir(company_context_id: str | None, default: Path,
                       registry: ContextRegistry | None = None) -> Path:
    """Return the ingested context's memory_dir for a registered id, else the default demo memory.

    This is what turns the `company_context_id` stub real: a registered id routes the advisor to the
    facts.md/notes.md materialized from the manager's own uploads.
    """
    registry = registry if registry is not None else REGISTRY
    if company_context_id:
        mem = registry.resolve_memory_dir(company_context_id)
        if mem is not None:
            return mem
    return Path(default)


def build_live_case_for_context(sit, default_memory_dir: Path, *, with_mock: bool = True,
                                work_dir: Path | None = None, registry: ContextRegistry | None = None):
    """feat-015 `build_live_case`, but with the memory_dir resolved from `sit.company_context_id`.

    Imported lazily so this package never hard-depends on the service layer at import time.
    """
    from service.live_input import build_live_case  # lazy: avoid import cycle / optional service dep

    mem_dir = resolve_memory_dir(getattr(sit, "company_context_id", None), default_memory_dir,
                                 registry=registry)
    return build_live_case(sit, mem_dir, work_dir=work_dir, with_mock=with_mock)
