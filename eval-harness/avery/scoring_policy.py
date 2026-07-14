# -*- coding: utf-8 -*-
"""feat-033 (policy pivot, 2026-07-13) — the person-scoring UNBLOCK switch.

Danny reversed the "a person is never scored / ranked / profiled" red line for REAL companies:
scoring their people on performance / mood is now considered unavoidable. The execution stance is
UNBLOCK ONLY, do NOT build features — so this module is the single switch that decides whether the
(UNCHANGED) red-line MECHANISM still DISCARDS / REJECTS a person-scoring observation at the write and
ingest seams, or lets it through to persist.

What this is NOT: it does NOT touch the detector. `avery.redline`, `avery.ingest.redline_extract`,
the frozen advisor engine, and `PersonEntity` are all byte-for-byte unchanged. Only the non-frozen
ENFORCEMENT decision (registry.gate_note_red_line, service.notes.write_note_from_manifest,
pipeline.ingest_docs) consults this switch before it discards / raises / rejects.

Default OFF = the shipped moat behavior. Every existing red-line assertion stays green and the
zero-key offline suite is unchanged, because when the switch is off nothing below it changes. Flip
``AVERY_ALLOW_PERSON_SCORING`` to a truthy value (1 / true / yes / on, case- and space-insensitive)
to let person-scoring notes and extractions persist.

Read LIVE on every call (never captured at import) so a test can ``monkeypatch.setenv`` the value and
the very next append_note / ingest honors it — and so a long-running service picks up the flag from
the process env without a restart-time snapshot.
"""
from __future__ import annotations

import os

ENV_VAR = "AVERY_ALLOW_PERSON_SCORING"
_TRUTHY = frozenset({"1", "true", "yes", "on"})


def person_scoring_allowed() -> bool:
    """True only when the operator has EXPLICITLY unblocked person scoring.

    ``AVERY_ALLOW_PERSON_SCORING`` in {1, true, yes, on} (case-insensitive, surrounding whitespace
    stripped) -> True. Everything else — unset, empty, "0", "false", "off", or any garbage — -> False,
    so the moat holds by default and a typo can only FAIL CLOSED (keep blocking), never fail open.
    Evaluated fresh on every call; there is no cached / import-time value to go stale."""
    return os.environ.get(ENV_VAR, "").strip().lower() in _TRUTHY
