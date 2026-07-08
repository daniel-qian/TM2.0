"""Server-side brain selection. Keys stay here — never toward the frontend.

The service picks a brain from env, mirroring the pluggable-brain design already in
`avery/brain.py` (境内 MiniMax/DeepSeek · 海外 Claude). Nothing here is exposed to a client; the
frontend only ever sees SSE events, never a key or a provider credential.

    AVERY_BRAIN = mock      -> MockBrain (deterministic, no key)   [default, AFK-safe]
                = minimax   -> OpenAICompatBrain on MiniMax-M3     (MINIMAX_API_KEY)
                = deepseek  -> OpenAICompatBrain on DeepSeek       (DEEPSEEK_API_KEY)
                = claude    -> RealBrain claude-opus-4-8           (ANTHROPIC_API_KEY)
                = openai-compat -> OpenAICompatBrain, fully env-driven

`make_brain` needs the `case` only for the mock brain (it replays the case's MOCK block); real
brains ignore it.
"""
from __future__ import annotations

import os

from avery.brain import (
    MINIMAX_BASE_URL, MINIMAX_MODEL, Brain, OpenAICompatBrain, make_mock_brain,
)

DEEPSEEK_BASE_URL = "https://api.deepseek.com/v1"
DEEPSEEK_MODEL = "deepseek-chat"


def resolve_brain_kind() -> str:
    return (os.environ.get("AVERY_BRAIN") or "mock").strip().lower()


def brain_is_live() -> bool:
    """True when the configured brain is a real provider (not the deterministic mock)."""
    return resolve_brain_kind() != "mock"


def make_brain(case, kind: str | None = None) -> Brain:
    """Build the brain named by `kind` (or AVERY_BRAIN). Raises RuntimeError with a clear message
    when a real brain is requested but its key/SDK is missing (caller maps to a clean HTTP error)."""
    kind = (kind or resolve_brain_kind()).strip().lower()

    if kind == "mock":
        return make_mock_brain(case, "avery")

    if kind == "minimax":
        return OpenAICompatBrain(
            name="avery-minimax", api_key_env="MINIMAX_API_KEY",
            base_url=os.environ.get("MINIMAX_BASE_URL", MINIMAX_BASE_URL),
            model=os.environ.get("MINIMAX_MODEL", MINIMAX_MODEL))

    if kind == "deepseek":
        return OpenAICompatBrain(
            name="avery-deepseek", api_key_env="DEEPSEEK_API_KEY",
            base_url=os.environ.get("DEEPSEEK_BASE_URL", DEEPSEEK_BASE_URL),
            model=os.environ.get("DEEPSEEK_MODEL", DEEPSEEK_MODEL))

    if kind == "claude":
        from avery.brain import RealBrain
        return RealBrain(name="avery-opus")

    if kind in ("openai-compat", "openai", "compat"):
        # Fully env-driven OpenAI-compatible endpoint.
        return OpenAICompatBrain(
            name="avery-openai-compat",
            api_key_env=os.environ.get("AVERY_OPENAI_KEY_ENV", "OPENAI_API_KEY"),
            base_url=os.environ.get("AVERY_OPENAI_BASE_URL"),
            model=os.environ.get("AVERY_OPENAI_MODEL"))

    raise RuntimeError(f"unknown AVERY_BRAIN={kind!r} "
                       f"(expected mock | minimax | deepseek | claude | openai-compat)")
