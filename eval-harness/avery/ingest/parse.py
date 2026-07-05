"""Stage 1 — parse uploaded files to plain text. Mature libs only; NO OCR heavy-lifting here.

Supported (multi-format, per ADR-0021 §2 / kickoff Scope 1):
  * .pdf            -> pypdf            (text-layer extraction)
  * .docx           -> python-docx      (paragraphs + tables)
  * .xlsx           -> openpyxl         (cells, sheet by sheet)
  * .csv / .tsv     -> stdlib csv       (rows)
  * .md / .txt      -> read as text

Design notes:
  * The LLM is reserved for STRUCTURED EXTRACTION (extract.py), never for parsing. Parsing is a
    deterministic library call so the AFK gate runs offline with no model.
  * Every optional heavy dep is imported lazily and degrades gracefully: if a PDF/docx/xlsx lib is
    missing, `parse_file` raises `ParseError` for that file only (the battery can skip that format)
    while text/csv/md always work on the stdlib. This keeps the offline keyword gate green even on
    a machine without the office libs installed.
  * Output is a `ParsedDoc`: normalized text + a `doc_kind` hint (resume / project / company / roster
    / roadmap) sniffed from filename + content, which the extractor uses to route heuristics.
"""
from __future__ import annotations

import csv
import io
import re
from dataclasses import dataclass, field
from pathlib import Path


class ParseError(Exception):
    """A single file could not be parsed (unknown/again-unsupported format or missing lib)."""


# doc_kind: coarse routing hint for the extractor. Not authoritative — the extractor still inspects
# content — but lets a resume vs a project weekly vs a roster take different heuristic paths.
DOC_KINDS = ("resume", "project", "company", "roster", "roadmap", "unknown")

_KIND_HINTS: list[tuple[str, str]] = [
    (r"resume|cv|curriculum|bio\b|profile", "resume"),
    (r"roster|directory|team[_\- ]?list|headcount|people", "roster"),
    (r"roadmap|milestone|timeline|plan\b", "roadmap"),
    (r"weekly|status|standup|update|project|sprint|retro|report|brief", "project"),
    (r"handbook|company|studio|org|policy|overview|about|charter|onboarding", "company"),
]


def sniff_kind(name: str, text: str) -> str:
    """Guess the document kind from filename first, then a peek at the head of the content."""
    hay_name = (name or "").lower()
    for rx, kind in _KIND_HINTS:
        if re.search(rx, hay_name):
            return kind
    head = "\n".join((text or "").splitlines()[:12]).lower()
    for rx, kind in _KIND_HINTS:
        if re.search(rx, head):
            return kind
    return "unknown"


@dataclass
class ParsedDoc:
    name: str                    # source filename (e.g. "Team_Roster.csv")
    text: str                    # normalized plain text
    doc_kind: str = "unknown"    # routing hint (see DOC_KINDS)
    ext: str = ""                # lower-cased extension without dot
    meta: dict = field(default_factory=dict)

    @property
    def lines(self) -> list[str]:
        return [ln.rstrip() for ln in self.text.splitlines()]


def _normalize(text: str) -> str:
    text = (text or "").replace("\r\n", "\n").replace("\r", "\n")
    # collapse >2 blank lines, strip trailing spaces per line
    text = re.sub(r"[ \t]+\n", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


# --- per-format extractors --------------------------------------------------------------------

def _parse_pdf(data: bytes) -> str:
    try:
        from pypdf import PdfReader
    except Exception as e:  # pragma: no cover - env without pypdf
        raise ParseError(f"pypdf not available for PDF parse: {e}")
    reader = PdfReader(io.BytesIO(data))
    return "\n\n".join((page.extract_text() or "") for page in reader.pages)


def _parse_docx(data: bytes) -> str:
    try:
        import docx  # python-docx
    except Exception as e:  # pragma: no cover - env without python-docx
        raise ParseError(f"python-docx not available for docx parse: {e}")
    doc = docx.Document(io.BytesIO(data))
    parts = [p.text for p in doc.paragraphs]
    for tbl in doc.tables:
        for row in tbl.rows:
            cells = [c.text.strip() for c in row.cells]
            if any(cells):
                parts.append(" | ".join(cells))
    return "\n".join(parts)


def _parse_xlsx(data: bytes) -> str:
    try:
        from openpyxl import load_workbook
    except Exception as e:  # pragma: no cover - env without openpyxl
        raise ParseError(f"openpyxl not available for xlsx parse: {e}")
    wb = load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    out: list[str] = []
    for ws in wb.worksheets:
        out.append(f"# sheet: {ws.title}")
        for row in ws.iter_rows(values_only=True):
            cells = ["" if v is None else str(v) for v in row]
            if any(c.strip() for c in cells):
                out.append(" | ".join(cells))
    return "\n".join(out)


def _parse_csv(data: bytes, delimiter: str = ",") -> str:
    text = data.decode("utf-8", errors="replace")
    rows = list(csv.reader(io.StringIO(text), delimiter=delimiter))
    return "\n".join(" | ".join(cell.strip() for cell in row) for row in rows if any(row))


def _parse_text(data: bytes) -> str:
    return data.decode("utf-8", errors="replace")


_DISPATCH = {
    "pdf": _parse_pdf,
    "docx": _parse_docx,
    "xlsx": _parse_xlsx,
    "csv": lambda d: _parse_csv(d, ","),
    "tsv": lambda d: _parse_csv(d, "\t"),
    "md": _parse_text,
    "markdown": _parse_text,
    "txt": _parse_text,
    "text": _parse_text,
    "": _parse_text,  # extension-less -> treat as text
}


def parse_bytes(name: str, data: bytes, *, ext: str | None = None) -> ParsedDoc:
    """Parse an in-memory upload (name + raw bytes) into a ParsedDoc. Used by the HTTP upload path
    and by tests that don't want to touch disk."""
    ext = (ext or Path(name).suffix.lstrip(".")).lower()
    fn = _DISPATCH.get(ext)
    if fn is None:
        raise ParseError(f"unsupported file type '.{ext}' for {name!r}")
    raw = fn(data)
    text = _normalize(raw)
    return ParsedDoc(name=name, text=text, doc_kind=sniff_kind(name, text), ext=ext,
                     meta={"bytes": len(data)})


def parse_file(path: str | Path) -> ParsedDoc:
    """Parse a file on disk into a ParsedDoc."""
    path = Path(path)
    if not path.exists():
        raise ParseError(f"no such file: {path}")
    return parse_bytes(path.name, path.read_bytes(), ext=path.suffix.lstrip("."))
