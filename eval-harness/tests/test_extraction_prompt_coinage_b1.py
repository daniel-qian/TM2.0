# -*- coding: utf-8 -*-
"""B1 — R4's fallback branch tells the model to COIN a word, and _norm_team does not speak coinage.

*** FIXED (R5). The fallback now ENUMERATES its permitted answers instead of asking for a noun:
    "map it onto EXACTLY ONE of these six words ... Founders | Eng | Product | Design | GTM | Ops.
     Use one of those six and nothing else — never a word of your own invention."
    The self-contradictory "ONE short capitalized noun, in the document's language" is gone. The
    measurements below are kept in the past tense as the record of what was observed. ***

R5 ACCEPTANCE, measured against the SHIPPED prompt (production extract() path, real MiniMax-M3,
temperature=0, both real corpora — the offline suite cannot see any of this, see below):
    ENGLISH (no department column -> this is the FALLBACK branch, i.e. B1's own branch)
      4 answered runs, 4/4 BYTE-IDENTICAL, 4/4 CANONICAL, coined: NONE
        {"Founders": 1, "Design": 13, "Product": 3, "Ops": 3}
      Chen Mingyuan ("Founder / CEO") -> Founders. Not 「Founding」. The coinage is gone at 0/4,
      and the distribution is now identical to the OLD forced-menu prompt's.
    SANYA (real 20-person villa roster, HAS a 所属组 column -> the VERBATIM main path)
      3/3 answered, 3/3 exact: all six real departments, exact headcounts, missing=[] invented=[]
    Testing BOTH corpora is the point: R4 regressed English precisely by testing Sanya only.

WHAT THE REAL MACHINE SAID (real MiniMax-M3, real PrismDesign_TeamProfile_EN.xlsx, production
extract() path, temperature=0 — re-run by me, not taken on report):

    OLD prompt (`team = one of Founders|Eng|Product|Design|GTM|Ops`), 6 runs:
        {"Founders": 1, "Design": 13, "Product": 3, "Ops": 3}   — 6/6 BYTE-IDENTICAL, all canonical.
    R4 prompt (verbatim-first, fallback = "answer with ONE short capitalized noun"):
        {"Founders": 1, "Design": 12, "Product": 3, "Ops": 3, "research": 1}
                                                        ^^^^^^^^^^^^^^^^^^

    I REPRODUCED THE BUG WITH A DIFFERENT WORD THAN THE ORIGINAL REPORT, AND THAT IS THE POINT.
    The report said 「Founding」 (for Chen Mingyuan, Founder / CEO). I got 「research」. Same prompt,
    same model, same temperature=0 — a different invented word. So the finding is NOT "the model
    says Founding": it is that an un-enumerated fallback coins ARBITRARY vocabulary. That kills the
    tempting fix (add 'founding' to _TEAM_ALIASES) on the evidence rather than on principle: there
    is no finite list to add.

    Two further things fell out of my run that the report did not mention:
      * the coinage STEALS a person from a real bucket — Design goes 13 -> 12 as one person is
        re-filed under 「research」. So it is not an extra group, it is a WRONG group.
      * 「research」 is LOWERCASE, though the instruction demands "ONE short capitalized noun". The
        model did not obey the very clause that induced it — see
        test_fallback_instruction_is_not_self_contradictory.

THE MECHANISM, MEASURED AT THE UNIT LEVEL (see test_norm_team_does_not_speak_coinage):

    _TEAM_ALIASES knows 'founder' and 'founders'. It does NOT know 'founding'.
    _norm_team('Founding') -> 'Founding'   (pass-through, R2's fix, working exactly as designed)

    So the coined word survives to the page and renders as a group titled 「Founding」. R2's
    pass-through is CORRECT — it is what puts 「别墅销售组」 on the page. R4's fallback is what feeds
    it a word no human wrote. The two are individually right and jointly wrong, which is why neither
    author saw it.

THE INSTRUCTION IS ALSO SELF-CONTRADICTORY, independent of the model's behaviour:

    "answer with ONE short capitalized noun, in the document's language"

    Chinese has no capitalization. For an all-Chinese document with no 部门 column — the customer's
    own shape — this instruction cannot be followed as written. That is a defect readable off the
    page, and test_fallback_instruction_is_not_self_contradictory asserts it without a model.

WHAT CAN AND CANNOT BE GATED HERE — the honest part, stated before the assertions.

  ** The offline suite CANNOT see prompt changes at all. ** tests/test_llm_extract.py:34's
  FakeBrain.respond(self, system, conversation, tools) ignores `system` and `conversation` by
  construction. Every FakeBrain-based "before/after" on a prompt edit is a tautology: the fake
  returns its scripted payload whichever prompt you hand it. So there is no behavioural offline gate
  available for B1, and any test claiming to be one would be lying. Two honest layers remain:

    (a) STRING GATES over the bytes actually sent to the brain (below, default-on). They read the
        prompt through a recording fake via the real extract() path, so moving the text to a
        constant/f-string/template does not dodge them. They are string gates. Saying otherwise
        would be worse than admitting it.
    (b) A REAL-MODEL GATE (@pytest.mark.seedgate, default-off, needs MINIMAX_API_KEY) that freezes
        the measured conclusion so it is re-checkable rather than folklore.

  RESIDUAL HOLE, named rather than discovered later: a string gate cannot know which words a model
  will invent. It can only check that the prompt does not ASK for an invented word. A fallback
  phrased in some new way that still induces coinage would pass (a) and be caught only by (b) — or,
  if nobody runs (b), by a customer. That is the honest limit, and it is the reason (b) exists.

THE STRUCTURAL FINDING THAT DRIVES B2 — read this before touching either gate.

    B1's fix and R4's gate rule are LOGICALLY CONTRADICTORY, and no real-model data is needed to
    see it:
      * B1 says: if the fallback asks the model for a CATEGORY, the permitted answers must be
        ENUMERATED — otherwise the model coins a word _norm_team cannot map.
      * R4's gate (test_cjk_team_axis_r4) says: >=3 taxonomy words within 120 chars is a menu,
        ANYWHERE in the prompt, unconditionally.
      * Enumerating the permitted answers IS >=3 taxonomy words within 120 chars.
    So R4's gate makes B1's only string-checkable fix unreachable, and the prompt R4 actually
    shipped — coin-a-noun — is what is left once the gate has vetoed enumeration. The gate did not
    merely permit a worse prompt; it selected for one. That is the argument (independent of the
    model runs) for the scope correction made in test_cjk_team_axis_r4.py.
"""
from __future__ import annotations

import json
import os
import re

import pytest

from avery.brain import BrainResponse
from avery.ingest import LLMExtractor
from avery.ingest.extract import TEAMS, _TEAM_ALIASES, _norm_team
from avery.ingest.parse import ParsedDoc


# =============================================================================================
# The unit-level mechanism — no model, no prompt, just the fact the whole bug rests on
# =============================================================================================

# Words a "name the function this title implies" instruction actually pulls out of a model. The
# first two are NOT hypothetical: 'research' is what MY run produced (lowercase, in a group of 1
# stolen from Design), 'Founding' is what the original report's run produced. Two runs of the same
# prompt against the same model invented two different words — which is the whole argument for
# fixing this in the prompt rather than in the alias table. The rest are the same morphological
# family. None is in _TEAM_ALIASES.
_COINED = ["research", "Founding", "Admin", "Project", "Research", "Leadership", "Strategy",
           "Management"]


@pytest.mark.parametrize("word", _COINED)
def test_norm_team_does_not_speak_coinage(word):
    """BORN GREEN — a CHARACTERIZATION, not a wish. This is the load-bearing fact of B1, recorded so
    the next reader does not have to re-derive it, and so that a future 'fix' that quietly teaches
    _norm_team every coinage in existence shows up as a change here rather than passing unnoticed.

    _norm_team passes unknown values through VERBATIM (R2/BUG-4, and correctly — that pass-through
    is what puts 「别墅销售组」 on the page). The consequence is that a coined English noun is not
    rejected, not mapped, and not empty: it becomes a GROUP TITLE. 'Founding' renders as a group
    called 「Founding」 sitting next to 「Founders」.

    ASSERTED AS !=, DELIBERATELY. The temptation is to assert _norm_team('Founding') == 'Founders'
    — i.e. to fix B1 by widening the alias table. That is the wrong layer and this test says so:
    the alias table cannot enumerate every word a model might invent, and chasing coinages there is
    an infinite game the prompt should never have started. The prompt must stop asking for invented
    words; the alias table stays a map of REAL spellings.
    """
    assert word.lower() not in _TEAM_ALIASES, (
        f"'{word}' is now an alias. If B1 was fixed by widening _TEAM_ALIASES, that is the wrong "
        f"layer: the model can coin words faster than the table can list them. The prompt must stop "
        f"asking for a coined word — see this file's docstring."
    )
    assert _norm_team(word) not in TEAMS, (
        f"_norm_team({word!r}) now maps into the canonical taxonomy. See above — if this became "
        f"true via the alias table, B1 was fixed at the wrong layer."
    )
    assert _norm_team(word) == word, (
        f"_norm_team({word!r}) -> {_norm_team(word)!r}: expected verbatim pass-through (R2). If "
        f"pass-through changed, re-derive B1 — this file's analysis assumes it."
    )


def test_founder_maps_but_founding_does_not_the_whole_bug_in_two_lines():
    """BORN GREEN — B1 compressed to its smallest reproduction, because the one-glyph difference is
    the entire finding and it deserves to be readable at a glance.

    The bug is a MORPHOLOGY MISS: the prompt asks for 'the function the title names', the model
    answers with a gerund, and the alias table lists agent nouns. Nobody wrote anything wrong; the
    two halves just do not share a word list.
    """
    assert _norm_team("Founder") == "Founders", "precondition: the alias table maps the agent noun"
    assert _norm_team("Founding") == "Founding", (
        "precondition changed: 'Founding' now maps. If someone added it to _TEAM_ALIASES, that is "
        "the wrong-layer fix — see test_norm_team_does_not_speak_coinage.")


# =============================================================================================
# The prompt, read through the real extract() path
# =============================================================================================

_DOC = ParsedDoc(name="roster.xlsx", text="# sheet: r\n姓名 | 职位\n陈思雨 | 别墅销售顾问",
                 doc_kind="roster", ext="xlsx")


class RecordingBrain:
    """Captures the exact system+user bytes the extractor puts on the wire (same device as
    test_cjk_team_axis_r4.RecordingBrain — a prompt gate must read what is SENT, not what is
    written, or moving the text to a new constant dodges it)."""
    name = "recording"

    def respond(self, system, conversation, tools):
        user = "".join(part.get("text", "") for msg in conversation
                       for part in msg.get("content", []))
        self.prompt = f"{system}\n{user}"
        return BrainResponse(text=json.dumps(
            {"people": [{"name": "陈思雨", "role": "别墅销售顾问", "team": "别墅销售组", "line": 3}],
             "projects": [], "signals": []}))


def _wire_prompt() -> str:
    brain = RecordingBrain()
    LLMExtractor(brain, retry_backoff_s=0).extract(_DOC)
    assert getattr(brain, "prompt", None), "the extractor never called the brain — the gate saw nothing"
    return brain.prompt


def _team_rule(prompt: str) -> str:
    """The `team = ...` field rule, sliced out of the prompt so the gates below reason about the
    branch that defines `team` rather than about the whole document. Bounded by the next field rule
    (tenure/owns) — the prompt's own structure, not a magic offset."""
    m = re.search(r"team\s*=", prompt, re.I)
    assert m, "no `team =` field rule in the prompt — has the prompt's shape changed?"
    rest = prompt[m.start():]
    end = re.search(r"\n\s*(?:tenure|owns)\s*=", rest, re.I)
    return rest[:end.start()] if end else rest[:1200]


# The instruction that induced 'Founding'. Matched on the SEMANTIC shape — a request for a WORD the
# model must produce itself ("answer with a noun", "give one word") — not on R4's exact phrasing, so
# a re-worded coin-a-noun fallback stays caught while a legitimate rewrite ("copy the department the
# document states") does not trip it.
#
# TWO CALIBRATION BUGS, FOUND BY RUNNING IT AGAINST THE REAL PROMPT rather than by reading it. Both
# would have made the gate VACUOUSLY GREEN on the exact bug it exists for — the failure mode a
# string gate actually dies of, so they are recorded here instead of quietly fixed:
#   1. the gap was {0,40}; the real span ('answer with' -> 'ONE') is 41 chars. One character.
#   2. `[^.\n]` forbade newlines — but _INSTRUCTIONS is LINE-WRAPPED, so the request routinely
#      straddles a line break ("ONE short capitalized noun, in the\n  document's language").
# Hence: newlines allowed, generous gaps, and test_the_coin_request_detector_is_not_blind now pins
# the real prompt's own fragment as a case so this cannot silently regress again.
_COIN_REQUEST = re.compile(
    r"\b(?:answer|reply|respond|give|use|output|produce|return|invent|coin)\b"
    r"(?:\s+with)?[^.]{0,60}?\b(?:one|a|an|single|same)\b[^.]{0,40}?"
    r"\b(?:noun|word|term|label|category|bucket)\b",
    re.I)


def test_fallback_instruction_is_not_self_contradictory():
    """BORN RED (as of R4's shipped prompt). Readable off the page — no model needed.

        "answer with ONE short capitalized noun, in the document's language"

    Chinese has no capitalization. The customer is a Chinese hotel. For the exact document shape
    this branch exists to serve — an all-Chinese doc that names no 部门 — the instruction is
    unfollowable as written, and a model handed an unfollowable instruction does something
    unpredictable, which is precisely what 'temperature=0 but non-deterministic' looks like.

    This asserts only the CONTRADICTION (a capitalization demand scoped to a language that has
    none), not the wording around it. Dropping either half satisfies it.
    """
    rule = _team_rule(_wire_prompt())
    m = re.search(r"capitali[sz]ed?", rule, re.I)
    if not m:
        return  # no capitalization demand at all — nothing to contradict
    window = rule[max(0, m.start() - 160): m.end() + 160]
    assert not re.search(r"document'?s\s+own\s+language|in\s+the\s+document'?s\s+language|"
                         r"document'?s\s+language", window, re.I), (
        "the team fallback demands a CAPITALIZED answer 'in the document's language':\n"
        f"    ...{window.strip()}...\n\n"
        "Chinese has no capitalization, and the customer's documents are Chinese. This branch is "
        "the one that fires for a doc with no 部门 column — i.e. the Chinese case it cannot serve. "
        "Either the capitalization demand goes, or the branch stops claiming to be language-general."
    )


def test_prompt_fallback_does_not_ask_the_model_to_coin_a_team_word():
    """BORN RED. The gate for B1 proper.

    R4's fallback says: "answer with ONE short capitalized noun ... the function that title already
    names". That is a request for a word the model MUST GENERATE, with no statement of which words
    are acceptable. The model generated 'Founding'. _norm_team does not know 'Founding'. The page
    got a group called 「Founding」.

    THE RULE: if the prompt asks the model to PRODUCE a category word for `team` (rather than copy
    one out of the document), the acceptable answers must be ENUMERATED in that same branch. An
    un-enumerated generate-a-category request is the coinage machine, and it is the only prompt
    shape this test forbids.

    Copy-verbatim is untouched: it does not ask the model to produce anything, so it never trips
    this. Enumerating (Founders|Eng|Product|Design|GTM|Ops) inside the fallback satisfies it — and
    is exactly what R4's gate used to forbid, which is the contradiction documented in the file
    docstring and resolved in test_cjk_team_axis_r4.py's scope correction.

    HONEST LIMIT: this reads the prompt, not the model. It cannot prove a compliant prompt stops
    the coinage — only test_english_teams_are_canonical_on_the_real_model (@seedgate) touches that.
    """
    rule = _team_rule(_wire_prompt())
    req = _COIN_REQUEST.search(rule)
    if not req:
        return  # the prompt never asks the model to produce a word — nothing to constrain

    # a generate-a-word request exists; the permitted answers must be named near it
    scope = rule[max(0, req.start() - 80): req.end() + 260]
    vocab = {t.lower() for t in TEAMS} | {k.lower() for k in _TEAM_ALIASES}
    named = {w for w in vocab
             if re.search(rf"(?<![A-Za-z]){re.escape(w)}(?![A-Za-z])", scope, re.I)}

    assert len(named) >= 3, (
        "the team rule asks the model to PRODUCE a category word without saying which words are "
        f"acceptable:\n    ...{req.group(0).strip()}...\n"
        f"    (taxonomy words named nearby: {sorted(named) or 'none'})\n\n"
        "A model asked to name a function invents one. Measured on the real machine: Chen Mingyuan "
        "('Founder / CEO') came back as 「Founding」 — and _norm_team knows 'founder'/'founders' and "
        "NOT 'founding', so the coinage passes through R2 verbatim and renders as its own group.\n"
        "Either copy the document's own word (no generation), or enumerate the permitted answers in "
        "this branch. Do not ask for a word and leave the vocabulary unstated."
    )


def test_the_coin_request_detector_is_not_blind():
    """The detector above decides whether the gate fires at all, so it is proved in both directions
    rather than trusted — a detector that never matches makes the gate vacuously green, which is the
    failure mode a string gate dies of.
    """
    # R4's ACTUAL bytes, line wrapping and all — the case the first draft of this detector missed
    # by one character and by a newline. Kept verbatim so a future tightening cannot re-introduce
    # the miss without this going red.
    r4_verbatim = ("and answer with the function that title already names — ONE short capitalized "
                   "noun, in the\n  document's language: a \"Design Director\" works in design")

    for coining in (r4_verbatim,
                    "answer with ONE short capitalized noun, in the document's language",
                    "reply with a single word naming the function",
                    "give one short label for their function",
                    "produce a category term for this person"):
        assert _COIN_REQUEST.search(coining), f"detector blind to a coin-a-word request: {coining!r}"

    for fine in ("team = the department the document states, copied verbatim",
                 'copy the 部门 column exactly as written, e.g. "别墅销售组"',
                 "tenure = stated experience phrase, e.g. '8 years of B2B design'"):
        assert not _COIN_REQUEST.search(fine), f"detector fires on a legitimate instruction: {fine!r}"


# =============================================================================================
# The REAL-MODEL gate — default off. The only layer that can actually see this bug.
# =============================================================================================

_HAS_KEY = bool(os.environ.get("MINIMAX_API_KEY"))


@pytest.mark.seedgate
@pytest.mark.skipif(not _HAS_KEY, reason="needs MINIMAX_API_KEY (real MiniMax-M3 run)")
def test_english_teams_are_canonical_on_the_real_model():
    """REAL MODEL. Default-off (@seedgate), needs a key, slow, and honestly flaky — which is why it
    is a marker rather than a suite member, following the existing seedgate precedent
    (test_seed_gate.py / test_e2e_first_user.py).

    This is the ONLY assertion in the repo that can see B1. The offline suite is structurally blind:
    FakeBrain ignores `system`, so no offline test can distinguish any two prompts.

    WHAT IT FREEZES (measured by me, temperature=0, the real PrismDesign_TeamProfile_EN.xlsx): the
    English corpus has NO department column, so it exercises the FALLBACK branch — the branch B1 is
    about. Every team the model returns for it must be a value _norm_team maps into TEAMS.

        OLD forced-menu prompt   7/7 answered, BYTE-IDENTICAL, all canonical
                                 {Founders:1, Design:13, Product:3, Ops:3}
        R4 coin-a-noun prompt    4/4 answered, 4/4 COINED, FOUR DIFFERENT sets at temperature=0:
                                 {research} / {HR, Research} / {HR} / {Administration, Research}
        COND (fallback enumerates its answers)
                                 2/2 answered, canonical, IDENTICAL to OLD

    The four-different-sets result is the finding: R4's fallback is not wrong in one fixed way, it
    is NON-DETERMINISTIC at temperature=0 and invents a fresh vocabulary each time.

    Deliberately asserts CANONICAL-NESS, not a specific distribution. Pinning {Design: 13, ...}
    exactly would make this a snapshot that goes red when the model is upgraded, and it would be
    read as noise and deleted. 'Every team is a real bucket' is the invariant that actually matters
    and it survives model drift.

    *** IT SAMPLES _RUNS TIMES, AND THAT IS THE VALIDITY OF THE GATE, NOT PADDING. ***
    The first version of this test ran ONCE. Executed against the live (coining) R4 prompt with a
    real key, IT PASSED — that particular run just happened not to coin. A single-shot assertion
    against a NON-DETERMINISTIC failure is not a gate, it is a coin flip that reports green some of
    the time, which is worse than no gate because it launders the bug as verified. Measured this
    round: my raw probes coined 4/4; this code path coined 0/1. High, but nowhere near 1.0.
    Sampling and demanding EVERY answered run be canonical is what turns a flaky observation into a
    usable signal. The cost is honest: up to _RUNS real calls at ~3.5 min each — it is default-off.

    A run that DEGRADES (all windows unparseable -> heuristic fallback) is NOT counted as canonical:
    the heuristic returns teams the model never chose, so counting it would be scoring the wrong
    extractor and would manufacture a pass out of a provider hiccup. No answered run at all is a
    SKIP, not a pass — absence of evidence is not evidence.
    """
    import pathlib

    from avery.brain import OpenAICompatBrain
    from avery.ingest.parse import parse_file

    _RUNS = 3

    # anchored to THIS file, not to pytest's cwd — a real-model gate that skips because it cannot
    # find its fixture would look like a pass
    fixture = pathlib.Path(__file__).parent / "fixtures" / "seed" / "PrismDesign_TeamProfile_EN.xlsx"
    assert fixture.exists(), f"the English seed fixture is missing: {fixture}"
    doc = parse_file(fixture)

    answered, offences = 0, []
    for i in range(_RUNS):
        ex = LLMExtractor(OpenAICompatBrain(name="minimax"), retry_backoff_s=1.0)
        res = ex.extract(doc)
        if ex.degraded or not res.people:
            continue                       # the MODEL did not answer — not evidence either way
        answered += 1
        junk = sorted({p.team for p in res.people if p.team and p.team not in TEAMS})
        if junk:
            offences.append((i + 1, junk, sorted({p.team for p in res.people})))

    if not answered:
        pytest.skip(f"the real model produced no usable JSON in {_RUNS} runs (M3 aborts/truncates "
                    f"intermittently) — no evidence gathered, so this SKIPS rather than passes")

    assert not offences, (
        f"the real model returned team values outside the canonical taxonomy in "
        f"{len(offences)}/{answered} answered run(s):\n"
        + "\n".join(f"  run {n}: coined {junk}   (all teams: {allt})" for n, junk, allt in offences)
        + "\n\nThe English corpus states no department, so this is the prompt's FALLBACK branch "
          "talking. A value outside TEAMS means the model COINED a word and _norm_team passed it "
          "through verbatim (R2) — it renders as its own group on the page, stealing people out of "
          "a real bucket (Design 13 -> 12 in my runs). Measured with R4's 'ONE short capitalized "
          "noun' fallback: research / Research / HR / Administration — plus 「Founding」 in the "
          "original report. A DIFFERENT invention each run, which is exactly why widening "
          "_TEAM_ALIASES cannot fix this.\n"
        "This is B1. See this file's docstring."
    )
