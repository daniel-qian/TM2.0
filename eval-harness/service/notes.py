"""feat-033 — the post-advise NOTE-WRITING hook (service layer, NOT the frozen engine).

After an /advise completes, the service turns Avery's own read of the situation into a persistent,
user-visible observation in the company's notebook. This lives here, driven by app.py, so the
advisor engine (loop.py / engine.py / tools.py) is untouched — the note is derived from the manifest
the engine already produced, with NO extra LLM call (no new spend, no new hallucination surface).

The observation = the advice `read` field (already work-focused, already past the advisor red line).
The source excerpt = the ~60-char lead of the manager's triggering question (provenance shown on the
notes surface: "From your question about <excerpt>").

🔴 RED LINE (the命门): before persisting, the hook re-validates the observation INDEPENDENTLY through
the UNCHANGED `avery.redline.validate` (belt-and-suspenders, like feat-030's storage door — even
though the read already passed the advisor gate). A crossing observation is DISCARDED: no note, no
nudge, no "what it wanted to write" placeholder (honest degradation). The registry's append_note()
runs the SAME gate again as the storage door, so the self-written memory can never become a back door
around 'no numbers on a person'.
"""
from __future__ import annotations

import logging

from avery import redline
from avery.ingest.registry import CompanyNote

logger = logging.getLogger(__name__)

SOURCE_EXCERPT_CHARS = 60


def observation_from_transcript(transcript: dict | None) -> str:
    """The agent's observation = the advice `read` (a situational read, never a person verdict). No
    extra model call — it is lifted from the transcript the engine already produced."""
    advice = (transcript or {}).get("advice") or {}
    return (advice.get("read") or "").strip()


def source_excerpt(situation: str | None, limit: int = SOURCE_EXCERPT_CHARS) -> str:
    """The ~60-char lead of the manager's question — the provenance line on the notes surface."""
    s = " ".join((situation or "").split())   # collapse whitespace/newlines
    if len(s) <= limit:
        return s
    return s[:limit].rstrip()


def write_note_from_manifest(registry, context_id: str | None, manifest: dict | None,
                             situation: str | None) -> CompanyNote | None:
    """The post-advise step. Returns the persisted CompanyNote, or None when nothing is written
    (no company context, no observation, the advice itself crossed, the observation crosses the
    write-side red line, or a persistence hiccup). None -> the caller emits NO nudge.

    Never raises: an /advise has already succeeded by the time this runs; a note-write problem must
    not turn a good answer into an error."""
    if not context_id or not manifest:
        return None
    # If the advice's own red-line gate flagged a crossing, do not even try to derive a note from it.
    if manifest.get("redline_passed") is not True:
        return None

    observation = observation_from_transcript(manifest.get("transcript"))
    if not observation:
        return None
    excerpt = source_excerpt(situation)

    # Independent re-validation (belt-and-suspenders). A crossing observation OR a crossing echoed
    # question excerpt is DISCARDED — no note, no nudge, no placeholder. feat-033: validate the two
    # fields SEPARATELY (never concatenated) so a negation in the advice read ('…never on the person')
    # cannot bleed across and mask a person-score in the echoed question excerpt ('李雷:9分,排名第一').
    if not redline.validate(observation).passed or (excerpt and not redline.validate(excerpt).passed):
        logger.info("feat-033: discarding a note whose observation/excerpt crossed the red line")
        return None

    try:
        return registry.append_note(context_id, observation, excerpt)
    except ValueError:
        # append_note's own storage-door gate refused (should not diverge from the check above, but
        # if it ever does, the stricter verdict wins) — discard cleanly.
        logger.info("feat-033: append_note refused the observation at the storage door")
        return None
    except Exception as e:   # a DB hiccup must never break a successful advise
        logger.warning("feat-033: could not persist a note (%s: %s)", type(e).__name__, e)
        return None
