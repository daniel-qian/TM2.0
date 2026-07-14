"""feat-028 (demo-harden cluster-1, fix #1) — the requirements.txt completeness gate.

THE #1 ship-stopper this catches: `service/ingest_api.py` declares `UploadFile = File(...)`, and
Starlette/FastAPI's multipart form parsing REQUIRES the third-party `python-multipart` package. It
happens to be installed in the local dev env (so every local test passes), but the Docker image
installs ONLY `eval-harness/requirements.txt` — so if the package is absent there, `/ingest` 500s on
every upload in the container while `/health` stays green (a silent, deploy-only failure).

This is a static scan (no import, no network): if any FastAPI form/file symbol is used anywhere in
`service/**`, then `python-multipart` MUST be declared in requirements.txt.
"""
from __future__ import annotations

import re
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent          # eval-harness/
SERVICE_DIR = HERE / "service"
REQUIREMENTS = HERE / "requirements.txt"

# Symbols whose presence means Starlette will parse a multipart body, which needs python-multipart.
_MULTIPART_MARKERS = ("File(", "Form(", "UploadFile")


def _service_files_using_multipart() -> list[tuple[Path, str]]:
    hits: list[tuple[Path, str]] = []
    for py in SERVICE_DIR.rglob("*.py"):
        text = py.read_text(encoding="utf-8")
        for marker in _MULTIPART_MARKERS:
            if marker in text:
                hits.append((py, marker))
    return hits


def _declared_packages() -> set[str]:
    names: set[str] = set()
    for raw in REQUIREMENTS.read_text(encoding="utf-8").splitlines():
        line = raw.split("#", 1)[0].strip()
        if not line:
            continue
        # normalize `python-multipart>=0.0.9` -> `python-multipart`
        name = re.split(r"[<>=!~\[ ]", line, maxsplit=1)[0].strip().lower()
        if name:
            names.add(name)
    return names


def test_service_uses_multipart_somewhere():
    """Guard the guard: if this stops being true, the regression below is vacuous — revisit."""
    assert _service_files_using_multipart(), (
        "no File(/Form(/UploadFile found under service/ — did the ingest upload surface move?")


def test_python_multipart_declared_when_service_uses_forms():
    hits = _service_files_using_multipart()
    if not hits:
        return  # nothing needs it
    declared = _declared_packages()
    where = ", ".join(f"{p.name}:{m}" for p, m in hits)
    assert "python-multipart" in declared, (
        f"service/ uses FastAPI form/file parsing ({where}) which REQUIRES the `python-multipart` "
        f"package, but it is NOT declared in {REQUIREMENTS.name}. The Docker image installs only "
        f"requirements.txt, so /ingest will 500 in the container. Add `python-multipart>=0.0.9`.")


def test_psycopg_declared_when_a_db_registry_exists():
    """feat-030, same failure shape as the multipart gate: `avery/ingest/pg_registry.py` imports
    psycopg LAZILY, so every offline test passes without it — but a deploy that sets AVERY_DB_URL
    would 500 on first /ingest if the Docker image (which installs ONLY requirements.txt) doesn't
    ship the driver. Static scan, no import, no network."""
    pg_module = HERE / "avery" / "ingest" / "pg_registry.py"
    if not pg_module.exists():
        return  # no DB registry, nothing needs the driver
    text = pg_module.read_text(encoding="utf-8")
    if "import psycopg" not in text:
        return
    declared = _declared_packages()
    assert "psycopg" in declared, (
        f"avery/ingest/pg_registry.py imports psycopg (lazily — offline tests can't catch the "
        f"absence) but `psycopg` is NOT declared in {REQUIREMENTS.name}; a DB-configured deploy "
        f"would 500 on first use. Add `psycopg[binary]>=3.1`.")


def _repo_uses(needle: str, *rel_paths: str) -> bool:
    """True if `needle` appears in any of the given repo-relative files (static scan, no import)."""
    for rel in rel_paths:
        p = HERE / rel
        if p.exists() and needle in p.read_text(encoding="utf-8"):
            return True
    return False


def test_defusedxml_declared_when_used():
    """feat-039, same lazy-import failure shape as the psycopg/multipart gates: `parse.py` calls
    `defusedxml.defuse_stdlib()` LAZILY to harden openpyxl's XML against entity/quadratic bombs, so
    every offline test passes without it — but the Docker image (which installs ONLY requirements.txt)
    would ship WITHOUT the hardening. Static scan; if defusedxml is used it must be declared."""
    if not _repo_uses("defusedxml", "avery/ingest/parse.py"):
        return
    assert "defusedxml" in _declared_packages(), (
        f"avery/ingest/parse.py uses defusedxml (lazily) but it is NOT declared in "
        f"{REQUIREMENTS.name}; the Docker image would lose XML-bomb hardening. Add `defusedxml>=0.7`.")


def test_psutil_declared_when_used():
    """feat-039: the memory sentinel (`service/mem_sentinel.py`) reads process RSS via psutil (lazy —
    it falls back to cgroup/proc, so offline tests never require the package). A deploy that relies on
    the sentinel needs psutil in the image; if the sentinel imports it, it must be declared."""
    if not _repo_uses("import psutil", "service/mem_sentinel.py"):
        return
    assert "psutil" in _declared_packages(), (
        f"service/mem_sentinel.py imports psutil (lazily) but it is NOT declared in "
        f"{REQUIREMENTS.name}; the ECS memory sentinel would fall back to cgroup/proc only. "
        f"Add `psutil>=5.9`.")
