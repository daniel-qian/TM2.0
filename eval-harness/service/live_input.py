"""Live-input path: turn a manager's typed situation into what the loop eats.

The engine's `read_case` tool reads `ToolContext.case_path` — a file on disk. Read-only demo mode
fed it a frozen case fixture. The service instead accepts a manager's *typed* management situation
and materializes it into a temporary case file (same on-disk shape the loop already knows), so the
loop runs UNCHANGED. Nothing in `avery/` is touched.

For MockBrain (deterministic, no key) the loop needs a MOCK block naming which memory lines to
cite; we synthesize a minimal one that cites real `facts.md` lines so the cite gate + red line are
still exercised on the live path. RealBrain / OpenAICompatBrain ignore the MOCK block entirely and
reason over the free text.
"""
from __future__ import annotations

import json
import re
import tempfile
from dataclasses import dataclass
from pathlib import Path

from avery import memory
from avery.cases import Case, load_case


@dataclass
class LiveSituation:
    """A management situation typed in live (replaces the read-only case fixture)."""
    situation: str                         # free-text: what's going on + the ask
    title: str | None = None               # optional short label
    company_context_id: str | None = None  # feat-016 stub — ingested company RAG handle
    case_id: str | None = None             # optional stable id; else derived


def _slugify(text: str, fallback: str = "live-situation") -> str:
    """Derive a case_id from the manager's typed situation.

    THE CHARACTER CLASS IS THE SAME LORE AS avery/ingest/extract.py::_slug — READ THAT DOCSTRING.
    This was `[^a-z0-9]+`, which is ASCII-only: every Han character fell outside the class, the
    string emptied, and the fallback fired — so EVERY Chinese situation became the same case_id,
    the literal string "live-situation". The all-Chinese Sanya path walks straight through here
    (build_live_case below: `case_id = sit.case_id or _slugify(...)`), so two different situations
    typed by the same manager were one case.

    `[\\W_]` and not the obvious `[^\\w]`: on str patterns `\\w` is unicode-aware (Han passes) but it
    also counts '_' as a word character, so `[^\\w]+` would stop folding underscores next to a space
    and change ENGLISH case ids ('Roadmap_ Q3' -> 'roadmap--q3'). On ASCII input `[\\W_]` is
    provably identical to the old `[^a-z0-9]` (after .lower(), \\w == [a-z0-9_], so
    [\\W_] == complement([a-z0-9]); verified exhaustively over all 128 ASCII codepoints).
    test_cjk_identity.py freezes the English half row by row.
    """
    slug = re.sub(r"[\W_]+", "-", (text or "").lower()).strip("-")
    return (slug[:48] or fallback)


def _default_mock_block(memory_dir: Path, situation: str) -> dict:
    """A minimal deterministic plan for MockBrain on the live path.

    Picks up to a few real facts.md lines related to the typed situation (via the same keyword
    recall the loop uses) and cites them, then drafts humane, red-line-clean advice grounded in
    the typed text. This keeps the AFK contract battery exercising the FULL path (cite gate + red
    line + 8-field projection) with no API key. RealBrain ignores this block.
    """
    hits = memory.recall(situation, memory_dir, limit=3)
    # Fall back to the always-present head lines if the keyword recall finds nothing.
    if not hits:
        cites = [{"claim": "Grounding this in the company's own record before advising",
                  "source_ref": "facts.md:1"}]
        recall_queries = [situation[:60]]
    else:
        cites = [{"claim": f"Grounded in the record: {h.text[:80]}", "source_ref": h.source}
                 for h in hits]
        recall_queries = [situation[:60]]

    return {
        "prompt": situation.strip(),
        "avery": {
            "recall_queries": recall_queries,
            "cites": cites,
            "advice": {
                "read": ("Here is the situation as the evidence actually reads, not a judgment of "
                         "the person: the pattern you describe is real and worth understanding, "
                         "and nobody has yet heard the story behind it. Name the work and its "
                         "effect on the team; keep the read on the situation, never on the person."),
                "move": ("Have the direct conversation this week, in a 1:1, not over chat. Lead "
                         "with the specific, observable pattern and its effect on the team, then "
                         "genuinely ask what is going on and listen. Agree on what 'back on track' "
                         "looks like and a near date to check it — supportive if there is a "
                         "fixable cause, and still clear about what has to change either way."),
                "framing": ("Open as a colleague who noticed, not a manager who is policing: "
                            "'I've noticed the last few weeks have been bumpy, and that's not "
                            "where you usually are. I'm not here to put you on the spot — I want "
                            "to understand what's going on and help get you back to solid. Walk me "
                            "through it.' Specific, owned, no surprises — and no scoring anyone."),
            },
        },
    }


def build_live_case(sit: LiveSituation, memory_dir: Path, *, work_dir: Path | None = None,
                    with_mock: bool = True) -> Case:
    """Materialize a temporary case file from a typed situation and load it as a `Case`.

    with_mock=True  -> embed a deterministic MOCK block (MockBrain runs green AFK).
    with_mock=False -> raw situation only (real brains reason over it; no scripted plan).

    Returns a `Case` whose `.path` is a real temp file the loop's read_case can read. Caller may
    delete the file after the loop finishes (see `discard`).
    """
    work_dir = Path(work_dir) if work_dir else Path(tempfile.gettempdir()) / "avery-live-cases"
    work_dir.mkdir(parents=True, exist_ok=True)

    case_id = sit.case_id or _slugify(sit.title or sit.situation)
    title = sit.title or "Live situation"

    parts = [
        f"# Case: {title}",
        "",
        "Raw management situation typed in by the manager (live input).",
        "",
        "## The situation",
        sit.situation.strip(),
        "",
        "## The ask",
        sit.situation.strip(),
    ]
    if sit.company_context_id:
        # feat-016 stub: when ingestion is wired, the company RAG behind this id feeds recall().
        parts += ["", f"<!-- company_context_id: {sit.company_context_id} (feat-016 stub) -->"]
    body = "\n".join(parts)

    if with_mock:
        mock = _default_mock_block(memory_dir, sit.situation)
        body += "\n\n<!-- MOCK\n" + json.dumps(mock, ensure_ascii=False, indent=2) + "\n-->\n"

    # Unique filename so concurrent requests never collide.
    fd, name = tempfile.mkstemp(prefix=f"{case_id}-", suffix=".md", dir=str(work_dir))
    path = Path(name)
    import os
    os.close(fd)
    path.write_text(body, encoding="utf-8")

    case = load_case(path)
    return case


def discard(case: Case) -> None:
    """Delete a live case's temp file (sampler = ephemeral session; nothing persists)."""
    try:
        Path(case.path).unlink(missing_ok=True)
    except OSError:
        pass
