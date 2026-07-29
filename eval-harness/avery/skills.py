"""Tiered system-prompt assembly (RESOLVED Q3: markdown skill files + fixed chain).

stable identity/discipline (skills/*.md) -> context (facts head) -> volatile (the case prompt).
Baselines can be built from a *subset* of these tiers so the eval can show exactly which tier
(the red line) is the differentiator — see scaffold levels below.
"""
from __future__ import annotations

from pathlib import Path

from . import memory

# Which skill files belong to which scaffold level. Order is load order.
_FULL = ["00-relational-model.md", "01-red-line.md", "02-kind-read-can-be-wrong.md"]
_MINUS_REDLINE = ["00-relational-model.md", "02-kind-read-can-be-wrong.md"]  # 011b baseline B

# 0729/03 分流短答：链的地板不变（cite 先行），终局出口按问题类型二选一。
CHAIN_HINT = (
    "Work in this fixed order, and only this order: read_case -> recall -> cite (once per "
    "grounded claim) -> then ONE of two exits. You cannot finish without at least one resolved "
    "cite. Exit A — answer_direct(text): the ask is a plain factual lookup (a time, a date, a "
    "number, a name, a status); answer in one to three sentences, no more. Exit B — "
    "draft_advice(read, move, framing): the ask needs judgment (a situation to read, a person "
    "dynamic, a 'what should I do'). Keep each of read/move/framing tight — a short paragraph "
    "each, no padding; length should match the weight of the question."
)


def _strip_html_comments(md: str) -> str:
    out, depth = [], 0
    i = 0
    while i < len(md):
        if md.startswith("<!--", i):
            end = md.find("-->", i)
            i = len(md) if end == -1 else end + 3
            continue
        out.append(md[i])
        i += 1
    return "".join(out)


def build_system_prompt(skills_dir: Path, memory_dir: Path, *, scaffold: str = "full") -> str:
    """scaffold:
        'full'            -> Avery: all skills incl. the red line + kind-read discipline.
        'minus_redline'   -> baseline B: advisor framing + chain, but NO red-line skill.
        'none'            -> baseline A (raw): no skills at all, just a bare consultant ask.
    """
    parts: list[str] = []

    if scaffold == "none":
        parts.append(
            "You are a management advisor. A manager will describe a situation with a report "
            "and ask what to do. You have tools to read the case and company memory. Give your "
            "best, specific advice.")
        files: list[str] = []
    elif scaffold == "minus_redline":
        files = _MINUS_REDLINE
    else:
        files = _FULL

    for fname in files:
        path = Path(skills_dir) / fname
        if path.exists():
            parts.append(_strip_html_comments(path.read_text(encoding="utf-8")).strip())

    if scaffold != "none":
        parts.append("## The fixed chain\n" + CHAIN_HINT)

    facts_head = memory.load_facts_head(memory_dir)
    if facts_head:
        parts.append("## What you already know (the rest is in memory; use recall())\n" + facts_head)

    return "\n\n---\n\n".join(p for p in parts if p)
