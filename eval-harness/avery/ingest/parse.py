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

import codecs
import csv
import io
import re
from dataclasses import dataclass, field
from pathlib import Path


class ParseError(Exception):
    """A single file could not be parsed (unknown/again-unsupported format or missing lib)."""


class DecodeError(ParseError):
    """fixB/B1 — the bytes could not be decoded as text under ANY candidate encoding.

    A SUBCLASS of ParseError on purpose: every existing caller (`ingest_paths`, the /ingest handler,
    the AFK battery) already handles ParseError by marking that file 'failed' and surfacing the
    message, so this inherits the honest failure path without a single change upstream. The subclass
    exists so a caller that wants to say "probably an encoding problem" in its own words can tell an
    undecodable file apart from a missing-library / unsupported-format failure."""


# feat-039 (readiness §2-D): defence-in-depth against XML entity-expansion / quadratic-blowup
# ("billion laughs") bombs in docx/xlsx. IMPORTANT ATTRIBUTION (corrected): openpyxl AND python-docx
# read OOXML XML via **lxml** when it is installed (both fall back to the stdlib xml.etree only when
# lxml is absent). `defusedxml.defuse_stdlib()` patches the STDLIB stack (xml.etree, xml.sax, ...) in
# place — so it hardens ONLY the lxml-absent fallback path, NOT lxml itself. On the common (lxml
# present) path the billion-laughs protection actually comes from lxml/libxml2's own parser, which by
# default does not resolve external/parameter entities and caps internal entity expansion; a crafted
# bomb is refused there, not by defuse_stdlib. We still call defuse_stdlib() to cover the fallback
# path (and it is cheap + idempotent). The residual attack surface via lxml's remaining internal-
# entity handling is narrow, and the zip-bomb guard in guards.archive_reason is the primary
# decompression-bomb defence at the HTTP edge regardless. Best-effort: if defusedxml is absent the
# parse still works and lxml/libxml2's limits still apply.
_XML_DEFUSED = False


def _defuse_xml() -> None:
    global _XML_DEFUSED
    if _XML_DEFUSED:
        return
    try:
        import warnings
        with warnings.catch_warnings():
            # defuse_stdlib touches the deprecated cElementTree shim; the hardening still applies.
            warnings.simplefilter("ignore", DeprecationWarning)
            import defusedxml
            defusedxml.defuse_stdlib()
    except Exception:  # pragma: no cover - env without defusedxml degrades gracefully
        pass
    _XML_DEFUSED = True


# doc_kind: coarse routing hint for the extractor. Not authoritative — the extractor still inspects
# content — but lets a resume vs a project weekly vs a roster take different heuristic paths.
DOC_KINDS = ("resume", "project", "company", "roster", "roadmap", "unknown")

# EVERY PATTERN HERE WAS AN ASCII WORD UNTIL feat-049, AND THIS LIST IS A ROUTER, NOT A LABEL.
# HeuristicExtractor.extract (extract.py) branches on doc_kind and 'unknown' matches NO branch, so a
# document that sniffs to 'unknown' contributes material chunks and nothing else — no people, no
# projects. A Chinese HR system exports 「员工花名册.md」/「本周项目周报.md」/「张伟_简历.md」; not one
# contains an ASCII keyword, so the first customer's ordinary paperwork routed to 'unknown' and their
# roster ingested as zero colleagues. The content pass below did not save it either: it runs the same
# five ASCII regexes over the head of a Chinese document.
#
# THE CHINESE ALTERNATIONS MIRROR THE ENGLISH ONES RATHER THAN EXTENDING THEM. Each is the direct
# rendering of a word already on its line — 周报 for weekly, 项目 for project, 名册 for roster — so
# the router's breadth is unchanged and only its alphabet grows. Two English words are deliberately
# NOT rendered, because their Chinese equivalents are far broader than the originals:
#   * update -> 更新 is ordinary prose ("花名册由人事部于每月初更新" — a line in our own roster
#     fixture), so it would route half the corpus to 'project'.
#   * about  -> 关于 is the same problem, one kind lower.
# Likewise the roster line takes the compounds 员工名单/人员名单/团队名单 but NOT bare 名单: 名单 is
# any list of names (获奖名单, 客户名单), while 名册 is a register OF PEOPLE and nothing else.
# Simplified + Traditional throughout — a Sanya hotel takes HK/TW paperwork too. `.lower()` in
# sniff_kind is a no-op on Han, and no Han character can appear in an ASCII filename, so the English
# routes below are untouched BY CONSTRUCTION (frozen in test_sniff_kind_english_routing_is_frozen).
#
# ORDER IS LOAD-BEARING AND UNCHANGED: first match wins, so 「员工手册」-style compounds reach
# 'company' only after roster/roadmap/project have declined them, exactly as 'Company_Roster.xlsx'
# has always resolved to roster rather than company.
_KIND_HINTS: list[tuple[str, str]] = [
    (r"resume|cv|curriculum|bio\b|profile"
     r"|简历|簡歷|履历|履歷", "resume"),
    (r"roster|directory|team[_\- ]?list|headcount|people"
     r"|名册|名冊|员工名单|員工名單|人员名单|人員名單|团队名单|團隊名單|通讯录|通訊錄", "roster"),
    (r"roadmap|milestone|timeline|plan\b"
     r"|路线图|路線圖|里程碑|时间线|時間線|排期表", "roadmap"),
    (r"weekly|status|standup|update|project|sprint|retro|report|brief"
     r"|周报|週報|日报|日報|月报|月報|项目|項目|站会|站會|冲刺|衝刺|复盘|復盤|简报|簡報|汇报|匯報"
     r"|报告|報告|状态|狀態", "project"),
    (r"handbook|company|studio|org|policy|overview|about|charter|onboarding"
     r"|手册|手冊|公司|工作室|组织架构|組織架構|规章制度|規章制度|政策|概览|概覽|章程", "company"),
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


# feat-023: pdf text layers (pypdf) leak typographic ligatures, soft hyphens and U+FFFD
# replacement chars into the corpus — and facts.md is the advisor's citable memory, so the
# mojibake gate (test_seed_gate) demands a clean corpus. Fixed at the parse seam for every format.
#
# fixB/B1 RE-AUDIT of the U+FFFD entry. Scrubbing the replacement character kept the corpus clean
# and simultaneously destroyed the only evidence that a decode had failed: a whole GB18030 roster
# came through as a handful of Latin characters with nothing anywhere saying so. U+FFFD is therefore
# no longer a plain translate entry. It is now handled by `_audit_replacement_chars` BEFORE
# normalization, which keeps the two cases apart instead of treating them alike:
#   * a HANDFUL of them  = a broken glyph in a PDF text layer. Scrubbed, exactly as feat-023 wanted,
#     but the count is recorded on ParsedDoc.meta['replacement_chars'] so the evidence survives.
#   * a DOCUMENT FULL of them = the bytes were never decoded. Raise DecodeError; a file we could not
#     read must be reported as unread, never quietly reduced to its ASCII residue.
_MOJIBAKE_MAP = {
    "ﬀ": "ff", "ﬁ": "fi", "ﬂ": "fl", "ﬃ": "ffi", "ﬄ": "ffl",
    "ﬅ": "st", "ﬆ": "st",
    "­": "",          # soft hyphen
    "​": "", "‌": "", "‍": "", "﻿": "",   # zero-widths / BOM
    "�": "",          # U+FFFD — scrubbed ONLY after _audit_replacement_chars has ruled it sporadic
}
_MOJIBAKE_TRANS = str.maketrans(_MOJIBAKE_MAP)

REPLACEMENT_CHAR = "�"
# Thresholds for "the decode failed" vs "one bad glyph". Both must trip, so a short document with a
# single artifact (feat-023's `Ofﬁce workﬂow � broken sh­yphen`, 1 in 31 chars) stays scrubbed while
# a mojibake'd CJK document — where replacement characters are a third of the text or more — fails
# loudly. The gap between 3% and 8% is wide enough that neither case is near the line.
_FFFD_MIN_COUNT = 8
_FFFD_MIN_RATIO = 0.08


def _audit_replacement_chars(text: str, name: str) -> int:
    """Count U+FFFD in freshly-parsed text; raise DecodeError if the document is MADE of them.

    Text-family formats can no longer reach here with mojibake (`decode_text` is strict), so this
    guards the formats whose libraries do their own decoding — a PDF with a broken /ToUnicode map, an
    xlsx written by a tool that mangled its own strings. Those used to be silently emptied too."""
    n = text.count(REPLACEMENT_CHAR)
    if n >= _FFFD_MIN_COUNT and text and n / len(text) >= _FFFD_MIN_RATIO:
        label = f"{name!r}" if name else "this file"
        raise DecodeError(
            f"could not read the text in {label}: {n} of its {len(text)} characters came back as "
            f"U+FFFD (unreadable). The file's text is stored in an encoding or font map we could "
            f"not decode — a scanned/image-only PDF or a re-saved copy usually fixes it."
        )
    return n


# feat-030 P3: a NUL (0x00) is ILLEGAL in a Postgres text value — a stray one in a PDF/xlsx text
# layer would crash the DB write with an opaque error. Other C0 control chars corrupt the citable
# corpus. Scrub them all at the parse seam (every format flows through here), preserving TAB (0x09)
# and NEWLINE (0x0a) which are legitimate layout. \r is already folded to \n above.
_C0_CONTROL_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f]")


def _normalize(text: str) -> str:
    text = (text or "").replace("\r\n", "\n").replace("\r", "\n")
    text = text.translate(_MOJIBAKE_TRANS)
    text = _C0_CONTROL_RE.sub("", text)   # strip NUL + other C0 controls (keep \t and \n)
    # collapse >2 blank lines, strip trailing spaces per line
    text = re.sub(r"[ \t]+\n", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


# --- text decoding (fixB/B1) --------------------------------------------------------------------
#
# THE BUG THIS REPLACES: `data.decode('utf-8', errors='replace')`. On a Chinese Windows box Excel's
# "CSV" and Notepad's "ANSI" are GB18030, not UTF-8 — the default save format for two of the three
# companies this ships to. Every Han character became U+FFFD, and `_normalize`'s _MOJIBAKE_MAP then
# mapped U+FFFD to the empty string, DESTROYING THE ONLY EVIDENCE THAT THE DECODE HAD FAILED. What
# survived was a short string of Latin garbage: doc_kind still sniffed 'roster', extraction found
# zero people, the red-line scanner found no 绩效评分 to catch (a SCORING sheet sailed through the
# gate it exists to fail), and the whole chain answered HTTP 200 / "Ingested 1 file(s)". The customer
# concludes Avery cannot read Chinese and has no way to discover otherwise.
#
# THE RULE THIS ENCODES: "I could not read it" and "the customer did not write it" are different
# facts and may never be conflated. So decoding is now STRICT — a candidate either round-trips
# cleanly or it is rejected — and when no candidate survives we raise DecodeError instead of
# inventing a plausible-looking empty document.
#
# WHY NO chardet / charset-normalizer: neither is a declared dependency (requirements.txt /
# requirements-service.txt), and adding one would make parsing depend on a statistical model that
# behaves differently in the dev venv and in the shipped image. The candidate ladder below is
# deterministic, needs nothing but the stdlib, and is exhaustively testable.
#
# WHY latin-1 IS NOT ON THE LADDER (the spec suggested it; this is a deliberate departure):
# latin-1 maps ALL 256 byte values, so it can never fail. Putting it last would mean no file is ever
# reported as undecodable — the silent-destruction bug, reintroduced one layer down. cp1252 is the
# useful part of that idea (it IS what "ANSI" means on a Western Windows box) and it CAN fail: five
# byte values (0x81/0x8D/0x8F/0x90/0x9D) are undefined, which is exactly what makes it a test rather
# than a rubber stamp.

# BOM first: an explicit byte-order mark is the file telling us its encoding outright, and no
# heuristic may overrule it. ORDER IS LOAD-BEARING — the UTF-32-LE BOM (FF FE 00 00) STARTS WITH the
# UTF-16-LE BOM (FF FE), so UTF-32 must be tested first or every UTF-32-LE file is misread as UTF-16.
_BOM_ENCODINGS: tuple[tuple[bytes, str], ...] = (
    (codecs.BOM_UTF8, "utf-8-sig"),
    (codecs.BOM_UTF32_LE, "utf-32"),
    (codecs.BOM_UTF32_BE, "utf-32"),
    (codecs.BOM_UTF16_LE, "utf-16"),
    (codecs.BOM_UTF16_BE, "utf-16"),
)

# utf-8 always leads: it is what every modern exporter writes, and CJK text in any legacy code page
# is overwhelmingly unlikely to be valid UTF-8 (so a legacy file will not be stolen by this rung).
_ENC_UTF8 = "utf-8"
# Multi-byte CJK rung. gb18030 leads (Simplified is the dominant case for all three target
# customers) but the two are decided by plausibility, not by order — see `_decode_rung`: Big5 bytes
# are frequently ALSO valid gb18030, so first-match-wins would silently render a Traditional-Chinese
# roster from a Hong Kong/Taiwan supplier as wrong Han characters. A Sanya hotel takes HK/TW
# paperwork, so that case is real rather than theoretical.
_ENC_CJK: tuple[str, ...] = ("gb18030", "big5")
# Western single-byte rung — Windows "ANSI" in a Latin locale (the Swedish customer's Excel).
_ENC_LATIN: tuple[str, ...] = ("cp1252",)

# Unicode blocks that correctly-decoded business paperwork essentially never contains, but that a
# CJK code page misread as the OTHER CJK code page produces constantly. The Private Use Area is the
# sharpest tell: it has no assigned meaning at all, so a decoder emitting it is guessing.
# Measured on 「姓名,職位,團隊 / 張偉,產品經理,產品組」 in Big5 (25 non-ASCII chars):
#   read as big5   -> 0 implausible characters
#   read as gb18030 -> 8, several of them PUA (U+E6BD, U+E794, ...)
# and on the Simplified equivalent in GBK the verdict flips the same way. One number separates them.
def _implausibility(text: str) -> float:
    """Share of characters that indicate the decoder guessed wrong. 0.0 == nothing suspicious."""
    if not text:
        return 0.0
    bad = 0
    for ch in text:
        o = ord(ch)
        if 0xE000 <= o <= 0xF8FF or o >= 0xF0000:
            bad += 2          # Private Use Area — unassigned by definition
        elif 0x2E80 <= o < 0x4E00 or 0xA000 <= o <= 0xA4CF:
            bad += 1          # radicals / Kangxi / Yi — the debris of a CJK cross-decode
    return bad / len(text)


def _looks_multibyte(data: bytes) -> bool:
    """Do the high bytes come in RUNS (a multi-byte CJK code page) or as ISOLATED singles (a Western
    single-byte code page)? This one signal is what keeps the two families from stealing each other's
    files, and it reads the RAW BYTES, so it cannot be fooled by a decode that already went wrong.

    Why it works: in GB18030/Big5 every non-ASCII character costs >= 2 consecutive high bytes, and
    Han text runs several characters at a time — so essentially every run is length >= 2. In cp1252
    Swedish/German/French prose the accented letters sit INSIDE otherwise-ASCII words ('Björn',
    'Malmö'), so essentially every run is length 1.

    This matters in both directions. Without it, 'Björn' (42 6A F6 72 6E) decodes CLEANLY as
    gb18030 — 0xF6 is a lead byte and 0x72 a valid trail byte — turning a Swedish surname into a
    stray Han character with no error raised anywhere. Ordering the ladder by this signal instead of
    hardcoding one order is what lets the Sanya hotel and the Swedish builder use the same code."""
    runs: list[int] = []
    run = 0
    for b in data:
        if b >= 0x80:
            run += 1
        elif run:
            runs.append(run)
            run = 0
    if run:
        runs.append(run)
    total = sum(runs)
    if total == 0:
        return False   # pure ASCII: the families are indistinguishable and it does not matter
    return sum(r for r in runs if r >= 2) / total >= 0.7


def _candidate_ladder(data: bytes) -> tuple[tuple[str, ...], ...]:
    """The ordered ladder for this payload, as RUNGS. utf-8 first always; then the family the raw
    bytes look like; then the other family as a long shot. Encodings that share a rung are siblings
    decided on plausibility rather than on order (`_decode_rung`)."""
    if _looks_multibyte(data):
        return ((_ENC_UTF8,), _ENC_CJK, _ENC_LATIN)
    return ((_ENC_UTF8,), _ENC_LATIN, _ENC_CJK)


def _decode_rung(data: bytes, rung: tuple[str, ...]) -> tuple[str, str] | None:
    """Decode with every encoding on one rung and return the most plausible reading, or None if the
    bytes are valid under none of them. Ties keep the rung's declared order (`min` returns the first
    minimal element), so gb18030 still wins whenever Big5 offers nothing better."""
    results: list[tuple[float, str, str]] = []
    for enc in rung:
        try:
            text = data.decode(enc)
        except (UnicodeDecodeError, LookupError):
            continue
        results.append((_implausibility(text), enc, text))
    if not results:
        return None
    _score, enc, text = min(results, key=lambda r: r[0])
    return text, enc


def decode_text(data: bytes, name: str = "") -> tuple[str, str]:
    """Decode uploaded bytes to text. Returns (text, encoding_used); raises DecodeError if nothing
    fits. STRICT throughout — this function never returns a string containing damage it invented."""
    if not data:
        return "", _ENC_UTF8
    for bom, enc in _BOM_ENCODINGS:
        if data.startswith(bom):
            try:
                return data.decode(enc), enc
            except UnicodeDecodeError:
                # A BOM whose body does not decode is a truncated/corrupt file, not a hint worth
                # trusting. Fall through to the ladder rather than fail outright.
                break
    tried: list[str] = []
    for rung in _candidate_ladder(data):
        tried.extend(rung)
        won = _decode_rung(data, rung)
        if won is not None:
            return won
    label = f"{name!r}" if name else "this file"
    raise DecodeError(
        f"could not read {label} as text: its bytes are not valid in any encoding we try "
        f"({', '.join(tried)}). It is most likely saved in a different character encoding — "
        f"re-save it as UTF-8 (in Excel: 'CSV UTF-8') and upload it again."
    )


# --- per-format extractors --------------------------------------------------------------------

def _parse_pdf(data: bytes) -> str:
    try:
        from pypdf import PdfReader
    except Exception as e:  # pragma: no cover - env without pypdf
        raise ParseError(f"pypdf not available for PDF parse: {e}")
    reader = PdfReader(io.BytesIO(data))
    # feat-039 (readiness §2-D): cap page count before extracting — a pathological PDF with a huge /
    # cyclic page tree is a CPU/RAM DoS. `len(reader.pages)` reads the (cheap) page tree; refuse over
    # the cap rather than iterate a hostile document. (A true wall-clock timeout is not portable to
    # Windows dev; the page cap is the deterministic, cross-platform guard.)
    from . import guards
    n_pages = len(reader.pages)
    if n_pages > guards.max_pdf_pages():
        raise ParseError(f"PDF has {n_pages} pages (limit {guards.max_pdf_pages()}) — refused")
    return "\n\n".join((page.extract_text() or "") for page in reader.pages)


def _parse_docx(data: bytes) -> str:
    try:
        import docx  # python-docx
    except Exception as e:  # pragma: no cover - env without python-docx
        raise ParseError(f"python-docx not available for docx parse: {e}")
    _defuse_xml()
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
    _defuse_xml()
    wb = load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    out: list[str] = []
    for ws in wb.worksheets:
        out.append(f"# sheet: {ws.title}")
        for row in ws.iter_rows(values_only=True):
            cells = ["" if v is None else str(v) for v in row]
            if any(c.strip() for c in cells):
                out.append(" | ".join(cells))
    return "\n".join(out)


# The text-family parsers return the detected encoding alongside the text, so `parse_bytes` can put
# it on ParsedDoc.meta. Knowing a roster was read as gb18030 rather than utf-8 is the difference
# between diagnosing a support ticket in a minute and guessing at it.

def _parse_csv(data: bytes, name: str = "", delimiter: str = ",") -> tuple[str, str]:
    text, enc = decode_text(data, name)
    rows = list(csv.reader(io.StringIO(text), delimiter=delimiter))
    return "\n".join(" | ".join(cell.strip() for cell in row) for row in rows if any(row)), enc


def _parse_text(data: bytes, name: str = "") -> tuple[str, str]:
    return decode_text(data, name)


# Binary/OOXML formats: the library owns the decode, so there is no encoding of ours to report.
_DISPATCH = {
    "pdf": lambda d, n="": (_parse_pdf(d), ""),
    "docx": lambda d, n="": (_parse_docx(d), ""),
    "xlsx": lambda d, n="": (_parse_xlsx(d), ""),
    "csv": lambda d, n="": _parse_csv(d, n, ","),
    "tsv": lambda d, n="": _parse_csv(d, n, "\t"),
    "md": _parse_text,
    "markdown": _parse_text,
    "txt": _parse_text,
    "text": _parse_text,
    "": _parse_text,  # extension-less -> treat as text
}


def parse_bytes(name: str, data: bytes, *, ext: str | None = None) -> ParsedDoc:
    """Parse an in-memory upload (name + raw bytes) into a ParsedDoc. Used by the HTTP upload path
    and by tests that don't want to touch disk.

    fixB/B1: raises DecodeError (a ParseError) rather than returning a plausible-looking husk when
    the bytes cannot be decoded. Callers already treat ParseError as 'this file failed', which is
    the truth we owe the user."""
    ext = (ext or Path(name).suffix.lstrip(".")).lower()
    fn = _DISPATCH.get(ext)
    if fn is None:
        raise ParseError(f"unsupported file type '.{ext}' for {name!r}")
    raw, encoding = fn(data, name)
    n_replacement = _audit_replacement_chars(raw, name)
    text = _normalize(raw)
    meta: dict = {"bytes": len(data)}
    if encoding:
        meta["encoding"] = encoding
    if n_replacement:
        # Evidence, not decoration: _normalize is about to delete these characters, and something
        # has to remember they were there.
        meta["replacement_chars"] = n_replacement
    return ParsedDoc(name=name, text=text, doc_kind=sniff_kind(name, text), ext=ext, meta=meta)


def parse_file(path: str | Path) -> ParsedDoc:
    """Parse a file on disk into a ParsedDoc."""
    path = Path(path)
    if not path.exists():
        raise ParseError(f"no such file: {path}")
    return parse_bytes(path.name, path.read_bytes(), ext=path.suffix.lstrip("."))
