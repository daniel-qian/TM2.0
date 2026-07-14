"""feat-039 — upload hard-gate primitives (pure, offline, no HTTP).

Readiness §2-D (OOM / DoS / denial-of-wallet): before feat-039 `/ingest` was UNBOUNDED — no size /
count / type limit, whole files read into RAM, no zip-bomb guard. On the production ECS box (2C/3.5G,
~540M free, no swap, ImaRead alongside) a single 400MB upload or a `100000x100000` xlsx OOMs the task
and takes the whole service (and its neighbours) down. This module holds the DETERMINISTIC, offline
checks the HTTP surface (`service/upload_guard.py`, `service/ingest_api.py`) enforces:

  * env-configured byte / count limits (conservative defaults for a 540M box),
  * magic-byte sniffing so a DISGUISED file (a binary renamed `.txt`, garbage renamed `.xlsx`) is
    refused BEFORE parse (honest 415) rather than trusted on its extension alone, and
  * a bounded zip-bomb check for OOXML (docx/xlsx) that streams the archive with a running cap so a
    small file that decompresses to gigabytes is rejected WITHOUT OOM.

Everything here is pure `bytes -> reason|None`; heavy stdlib (`zipfile`) is imported lazily so import
stays cheap and the offline suite needs no new runtime dependency. `check_type` is intentionally
narrow: it only enforces the magic for a RECOGNISED type — an UNSUPPORTED extension is left alone so
the feat-032 "unparseable file is marked failed in the manifest" behaviour is preserved (the size gate
and the total-body cap defend RAM regardless of type).
"""
from __future__ import annotations

import os
from pathlib import Path

# ── env-configured limits (read DYNAMICALLY so a per-request env / test monkeypatch is honoured) ──
# Conservative defaults sized for the ~540M-free ECS box (kickoff ECS hard constraint).

_MiB = 1024 * 1024


def _int_env(name: str, default: int) -> int:
    try:
        return int(str(os.environ.get(name, "")).strip() or default)
    except ValueError:
        return default


def max_file_bytes() -> int:
    """Per-FILE byte ceiling (default 8 MiB). A single upload over this is a 413."""
    return _int_env("AVERY_MAX_UPLOAD_BYTES", 8 * _MiB)


def max_files() -> int:
    """Per-REQUEST file-count ceiling (default 15). More files than this is a 413."""
    return _int_env("AVERY_MAX_FILES", 15)


def max_total_bytes() -> int:
    """Per-REQUEST total-body ceiling (default 32 MiB). Enforced BEFORE the body is read into RAM
    (Content-Length pre-check + streamed byte counter in the ASGI guard)."""
    return _int_env("AVERY_MAX_TOTAL_UPLOAD_BYTES", 32 * _MiB)


def max_pdf_pages() -> int:
    """Per-PDF page ceiling (default 500). A pathological page tree is refused before text extract."""
    return _int_env("AVERY_MAX_PDF_PAGES", 500)


def max_archive_uncompressed() -> int:
    """OOXML decompressed-size ceiling (default 100 MiB). The zip-bomb cap: streaming stops here."""
    return _int_env("AVERY_MAX_ARCHIVE_UNCOMPRESSED_BYTES", 100 * _MiB)


def max_archive_entries() -> int:
    """OOXML entry-count ceiling (default 4096). A pathological central directory is refused."""
    return _int_env("AVERY_MAX_ARCHIVE_ENTRIES", 4096)


# ── type whitelist + magic-byte sniff ────────────────────────────────────────────────────────────
# Mirrors parse._DISPATCH. Two families: OOXML (zip container) and text. A binary magic that
# contradicts a declared type == a disguised upload -> honest 415. An UNSUPPORTED extension is NOT
# rejected here (feat-032 marks it 'failed' downstream); size/total caps defend RAM either way.

SUPPORTED_EXTS = frozenset(
    {"pdf", "docx", "xlsx", "csv", "tsv", "md", "markdown", "txt", "text", ""})
_ZIP_EXTS = frozenset({"docx", "xlsx"})
_TEXT_EXTS = frozenset({"csv", "tsv", "md", "markdown", "txt", "text", ""})

# Leading signatures of common binary formats. If a TEXT-typed upload starts with one of these it is
# a disguised binary (a PDF/zip/image/executable renamed `.txt`) — refuse it.
_BINARY_MAGICS: tuple[bytes, ...] = (
    b"%PDF-",            # PDF
    b"PK\x03\x04", b"PK\x05\x06", b"PK\x07\x08",  # zip / OOXML / jar
    b"\x89PNG\r\n\x1a\n",  # PNG
    b"GIF87a", b"GIF89a",  # GIF
    b"\xff\xd8\xff",     # JPEG
    b"MZ",               # DOS/PE executable
    b"\x7fELF",          # ELF executable
    b"Rar!\x1a\x07",     # RAR
    b"\x1f\x8b",         # gzip
    b"BZh",              # bzip2
    b"7z\xbc\xaf\x27\x1c",  # 7-zip
    b"\xd0\xcf\x11\xe0",  # OLE2 (legacy .doc/.xls/.ppt)
    b"\xfd7zXZ\x00",     # xz
)


def resolve_ext(name: str) -> str:
    """The lower-cased extension without the dot ('' for extension-less)."""
    return Path(name or "").suffix.lstrip(".").lower()


def is_supported(ext: str) -> bool:
    return ext in SUPPORTED_EXTS


def check_type(name: str, data: bytes) -> str | None:
    """Return a human reason to REFUSE (415), or None if the upload's content is consistent with its
    (recognised) type. An UNSUPPORTED extension returns None (handled by the downstream parse-fail
    path, feat-032) — this gate only catches DISGUISE for types we do recognise."""
    ext = resolve_ext(name)
    if ext not in SUPPORTED_EXTS:
        return None  # unsupported -> not our concern here; parse marks it 'failed' (feat-032)
    head = data[:8192]
    if ext == "pdf":
        if b"%PDF-" not in data[:1024]:
            return f"declared '.pdf' but the content is not a PDF (magic-byte mismatch)"
        return None
    if ext in _ZIP_EXTS:
        if not head.startswith((b"PK\x03\x04", b"PK\x05\x06", b"PK\x07\x08")):
            return f"declared '.{ext}' but the content is not an Office (zip) file (magic-byte mismatch)"
        return None
    # text family: reject a disguised binary (NUL in the head, or a known binary signature)
    if b"\x00" in head:
        return f"declared '.{ext}' (text) but the content is binary (NUL byte in the header)"
    for magic in _BINARY_MAGICS:
        if head.startswith(magic):
            return f"declared '.{ext}' (text) but the content is a disguised binary"
    return None


def archive_reason(data: bytes) -> str | None:
    """For an OOXML (docx/xlsx zip) upload: return a reason to REFUSE (413) a zip/decompression bomb,
    or None if the archive is within caps. The check is BOUNDED — it streams every entry through a
    running total and stops the moment the cap is crossed, so a small archive that expands to
    gigabytes is refused WITHOUT ever materialising it (no OOM). Runs BEFORE openpyxl/python-docx."""
    import io
    import zipfile

    try:
        zf = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile:
        return "not a valid Office (zip) file"
    except Exception as e:  # pragma: no cover - defensive
        return f"could not read the Office archive: {type(e).__name__}"

    infos = zf.infolist()
    if len(infos) > max_archive_entries():
        return (f"archive has {len(infos)} entries (limit {max_archive_entries()}) "
                f"— refused as a possible zip bomb")

    cap = max_archive_uncompressed()
    # Cheap central-directory pre-check (honest bombs declare their huge sizes here).
    declared = sum(max(0, i.file_size) for i in infos)
    if declared > cap:
        return (f"archive declares {declared} decompressed bytes (cap {cap}) "
                f"— refused as a zip bomb")

    # Verified streaming check (catches a LYING central directory): decompress with a running cap.
    seen = 0
    for info in infos:
        try:
            with zf.open(info) as fh:
                while True:
                    chunk = fh.read(65536)
                    if not chunk:
                        break
                    seen += len(chunk)
                    if seen > cap:
                        return (f"archive decompresses past {cap} bytes "
                                f"— refused as a zip bomb")
        except Exception as e:  # a corrupt/hostile entry: refuse rather than hand it to the parser
            return f"archive entry could not be safely read: {type(e).__name__}"
    return None
