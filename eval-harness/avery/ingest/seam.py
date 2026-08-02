"""The feat-015 <-> feat-016 seam, as a thin composition helper (no feat-015 rewrite).

`service/live_input.py::build_live_case` already accepts a `memory_dir` and threads a
`company_context_id`. Ingestion (this package) registers a `CompanyContext` under that id whose
`memory_dir` holds red-line-clean, line-addressable facts. The ONLY missing wire is: given a
request's `company_context_id`, hand the advisor the INGESTED memory_dir instead of the default
demo memory — then the loop's own `recall`/`cite`/red-line run over the manager's uploaded facts,
unchanged.

This module is that wire, expressed as a compose-not-modify helper the service can adopt:

  * `resolve_memory_dir(id, default)`  — id -> ingested memory_dir, else the default. Pure lookup.

Keeping it here (not in service/live_input.py) honors the constraint "don't rewrite feat-015 — the
integrator wires it in"; the seam is real and covered, and adoption in app.py is a 2-line change
the integrator can drop in (resolve the id, pass the dir).
"""
from __future__ import annotations

from pathlib import Path

from .registry import ContextRegistry, active_registry


def resolve_memory_dir(company_context_id: str | None, default: Path,
                       registry: ContextRegistry | None = None) -> Path:
    """Return the ingested context's memory_dir for a registered id, else the default demo memory.

    This is what turns the `company_context_id` stub real: a registered id routes the advisor to the
    facts.md/notes.md materialized from the manager's own uploads. registry=None -> the env-selected
    registry (feat-030): Postgres when AVERY_DB_URL is set — a restart re-materializes the memory
    from the DB, so a pre-restart id keeps resolving — else the in-memory default.
    """
    registry = registry if registry is not None else active_registry()
    if company_context_id:
        mem = registry.resolve_memory_dir(company_context_id)
        if mem is not None:
            return mem
    return Path(default)
