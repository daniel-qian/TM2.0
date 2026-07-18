"""R4 — the TEAM axis on the LLM path: the prompt is the bottleneck, not the Python.

WHAT THE REAL MACHINE SAID (Playwright + AVERY_BRAIN=minimax + the real Sanya villa-hotel corpus,
3 files). The identity axis is fixed: people 20 / uniqueNames 20 / uniquePersonIds 20, ids like
u_陈思雨, 0 duplicate-key warnings, three different cards open three different people. But:

    groups: ["GTM"]          <- all 20 people in ONE group

The corpus states SIX departments (别墅销售组 5 / 渠道合作组 3 / 客户运营组 4 / 市场投放组 5 /
策略分析组 2 / 活动策划组 1 = 20). Before R2 the page showed four WRONG groups; now it shows one.

THE ROOT CAUSE IS IN THE PROMPT, AND THIS FILE IS SHAPED AROUND THAT FACT.
llm_extract.py::_INSTRUCTIONS says:

    team = one of Founders|Eng|Product|Design|GTM|Ops if it can be honestly mapped, else ""

The prompt COMMANDS the model to pick from a startup taxonomy. A Sanya hotel's sales team reads as
go-to-market under any honest application of that menu, so the model never gets the chance to say
「别墅销售组」 — it says GTM, twenty times, and it is obeying us when it does.

  *** R2/R3's lesson, mirrored. *** R2 fixed _norm_team to pass unmappable departments through, and
  it fixed it correctly — but only the HEURISTIC path was ever exercised, and R2/R3's checkers
  verified there, saw real Chinese departments survive, and called the axis green. Production
  defaults to the LLM path (health reports extractor=llm:minimax). Downstream of a prompt that
  forbids the answer, no amount of correct Python can produce it. R1's checker warned "two blockers
  fixed != the Sanya path works"; this is that sentence running in reverse.

WHAT IS BORN RED HERE, AND WHAT IS NOT — stated up front because the ratio is the finding:

  * test_extraction_prompt_does_not_force_team_into_the_preset_taxonomy  -> BORN RED. The only
    assertion in this file that bites the live bug.
  * every other test in this file                                        -> BORN GREEN, and each is
    mutation-proved below. They are NOT evidence that Sanya works. They are the net that keeps the
    Python honest once the prompt stops lying — measured, not assumed:
        _build(...) on the LLM path already returns team='别墅销售组' verbatim TODAY.
    R2's pass-through is live on both paths. The team axis is broken in exactly one place.

HONEST LIMITS OF THE PROMPT GATE — read this before trusting it (and before weakening it).
A prompt's output comes from a model, so the ONLY deterministic thing a test can examine is the
prompt's text. This IS a string assertion. There is no way around that, and pretending otherwise
would be worse than admitting it. Three things make it a rule rather than a spelling test:

  1. It reads the bytes ACTUALLY SENT to the brain, captured through extract() via a recording
     fake. Moving the text into a new constant, an f-string, a template or a .txt file does not
     dodge it — only changing what the model is told does.
  2. Its token list is DERIVED from extract.TEAMS and extract._TEAM_ALIASES. Adding a seventh
     bucket, or re-spelling the menu with alias words ("Sales|Marketing|Engineering"), stays caught.
  3. It asserts the ABSENCE OF A GOVERNING MENU (>=3 taxonomy words clustered inside one 120-char
     window, outside a properly scoped fallback), not the presence of blessed wording. Any sane
     rewrite — "copy the stated department verbatim" — passes without being told how to phrase
     itself. Prose that happens to mention "design" in a tenure example does not trip it, because a
     menu is a LIST and prose is not.

  Residual hole, named so nobody discovers it as a surprise: a menu built entirely from bucket
  words that appear in NEITHER TEAMS nor _TEAM_ALIASES (e.g. "Hospitality|Retail|Logistics") would
  slip through. That is not fixable by string-matching; it is what the real-model @seedgate layer
  is for. The gate stops the REGRESSION that actually happened, not every prompt sin imaginable.

*** R5 AMENDMENT — THIS RULE WAS TOO BROAD AND HAS BEEN CORRECTED. Read _forced_menu_clusters. ***
As shipped, item 3 banned a taxonomy menu ANYWHERE, unconditionally. That was over-broad in a way
that did real damage: R4's own implementer proposed a verbatim-first prompt whose menu lived ONLY in
the "the document names no department" fallback, and VETOED IT to satisfy this rule — shipping
instead a fallback that tells the model to invent a noun. On the real model that fallback invented
「Founding」 for a Founder / CEO, which _norm_team does not know (it knows 'founder'), so R2's
pass-through rendered it as its own group. The gate did not merely permit a worse prompt: by
forbidding the only string-checkable fix (enumerating the fallback's permitted answers), it SELECTED
for one. See tests/test_extraction_prompt_coinage_b1.py for that argument in full, and this round's
report for the real-model numbers behind it (OLD 5/5 byte-identical & canonical on English).

The rule is now a DISTINCTION, not a ban: a menu that GOVERNS the answer stays red; a menu reachable
only inside a fallback branch, after a verbatim-copy instruction has claimed the main path, is
accepted — it cannot produce groups=['GTM'] for Sanya, whose roster HAS a 部门 column and never
reaches that branch. The teeth are proved by execution, not by argument:
test_the_corrected_rule_still_bites_r4s_original_bug re-installs R4's exact forced menu and demands
this gate fire.

REJECTED, on purpose: a fake brain that "obeys the prompt" — parses the menu out of the prompt and
answers GTM when it finds one, departments when it does not — so the grouping assertion itself
would go red today. It looks like a behavioural gate and is not one: its reading of the prompt is
the SAME TEAMS-derived detector used below, so it would be that detector wearing a costume,
reporting its own opinion back to itself as if it were evidence. One honest string gate beats a
circular behavioural one.

NOT FIXED HERE, and not a classification bug (flagged, not silently touched): the real run extracts
22 projects where the corpus has 6 — the model is promoting milestones to projects. That is an
extraction-GRANULARITY problem in the projects prompt, it has no gate, and it does not belong in a
team-axis file. It is not the same bug and must not be fixed by whoever fixes this one.
"""
from __future__ import annotations

import json
import re

import pytest

from avery.brain import BrainResponse
from avery.ingest import LLMExtractor
from avery.ingest.extract import TEAMS, _TEAM_ALIASES
from avery.ingest.parse import ParsedDoc


# --- the real corpus, as measured ---------------------------------------------------------------
# The Sanya roster's actual org: six departments, twenty people. 活动策划组 has exactly ONE member —
# that is what the document says, and a "tidier" gate that merges it into 市场投放组 would be
# inventing an org chart the customer does not have. The single-member group is load-bearing: it is
# the one a bucketing regression squeezes away first.
_SANYA_ORG: dict[str, tuple[str, ...]] = {
    "别墅销售组": ("陈思雨", "李明轩", "赵天宇", "吴梦洁", "郑伟豪"),
    "渠道合作组": ("周雅婷", "孙浩", "黄志强"),
    "客户运营组": ("林晓彤", "徐国栋", "何静怡", "罗嘉明"),
    "市场投放组": ("高子涵", "谢文博", "邓丽华", "曹俊杰", "韩雪松"),
    "策略分析组": ("冯语嫣", "唐博文"),
    "活动策划组": ("蒋依琳",),
}
_ROLE_BY_TEAM = {
    "别墅销售组": "别墅销售顾问", "渠道合作组": "渠道合作专员", "客户运营组": "客户运营专员",
    "市场投放组": "市场投放专员", "策略分析组": "策略分析师", "活动策划组": "活动策划专员",
}

# The SAME org chart written a SECOND time, by hand, on purpose. _SANYA_ORG builds the model's
# answer; this is what the page must show. Deriving the expectation from the fixture would make the
# headcount assertion a tautology — and that is not a hypothetical: the first draft of this file did
# exactly that, and the mutation that merged 活动策划组 into 市场投放组 sailed through GREEN, because
# both sides of the `==` moved together. Two independent literals is what gives the count teeth; a
# fixture edit now has to be made twice, which is the point at which someone notices they are
# editing the customer's org chart to make a test pass.
_EXPECTED_GROUP_SIZES = {
    "别墅销售组": 5, "渠道合作组": 3, "客户运营组": 4,
    "市场投放组": 5, "策略分析组": 2, "活动策划组": 1,
}


def _sanya_rows() -> list[tuple[str, str, str]]:
    return [(n, _ROLE_BY_TEAM[t], t) for t, names in _SANYA_ORG.items() for n in names]


SANYA_ROSTER_DOC = ParsedDoc(
    name="三亚别墅酒店_花名册.xlsx",
    text="\n".join(
        ["# sheet: 花名册", "序号 | 姓名 | 职位 | 部门"]
        + [f"{i + 1} | {n} | {r} | {t}" for i, (n, r, t) in enumerate(_sanya_rows())]
    ),
    doc_kind="roster", ext="xlsx")


def _sanya_payload() -> dict:
    """What the model returns ONCE THE PROMPT LETS IT — the department copied off the row."""
    return {
        "people": [{"name": n, "role": r, "team": t, "line": i + 3}
                   for i, (n, r, t) in enumerate(_sanya_rows())],
        "projects": [], "signals": [],
    }


class RecordingBrain:
    """Captures the exact system+user bytes the extractor puts on the wire, then answers."""
    name = "recording"

    def __init__(self, payload=None):
        self.prompts: list[str] = []
        self._payload = payload if payload is not None else _sanya_payload()

    def respond(self, system, conversation, tools):
        user = "".join(part.get("text", "") for msg in conversation
                       for part in msg.get("content", []))
        self.prompts.append(f"{system}\n{user}")
        return BrainResponse(text=json.dumps(self._payload))


# === THE GATE THAT BITES · the prompt must not command classification ===========================

# Every word the codebase itself treats as a preset-taxonomy bucket. Derived, never hand-listed:
# TEAMS is the menu, _TEAM_ALIASES is the same menu's other spellings (sales/engineering/
# operations/go-to-market...). A dodge that re-words the menu with alias names stays caught.
_TAXONOMY_WORDS = tuple(sorted(
    {t.lower() for t in TEAMS} | {k.lower() for k in _TEAM_ALIASES},
    key=len, reverse=True))
_MENU_WINDOW = 120      # chars — a menu is a LIST; scattered prose mentions are not
_MENU_MIN_DISTINCT = 3  # 2 buckets cannot express an org taxonomy; 3+ in one breath is a menu


def _menu_clusters(prompt: str) -> list[tuple[str, set[str]]]:
    """Return every span of the prompt that ENUMERATES the preset taxonomy.

    Semantics over spelling: a closed menu names several buckets in one breath
    ("Founders|Eng|Product|Design|GTM|Ops"). Prose that mentions one bucket incidentally
    ("8 years of B2B design") names one, far from any other. Adjacency is the difference, so it is
    adjacency that is measured — not punctuation, not the phrase "one of", nothing a rewrite would
    disturb.

    RAW detector: it finds menus, and says nothing about whether a menu is legitimate. The judgement
    lives in _forced_menu_clusters below — see the R5 SCOPE CORRECTION note there.
    """
    hits = []
    for w in _TAXONOMY_WORDS:
        for m in re.finditer(rf"(?<![A-Za-z]){re.escape(w)}(?![A-Za-z])", prompt, re.I):
            hits.append((m.start(), w))
    hits.sort()
    clusters = []
    for i, (pos, _w) in enumerate(hits):
        near = {w for p, w in hits[i:] if p - pos <= _MENU_WINDOW}
        if len(near) >= _MENU_MIN_DISTINCT:
            clusters.append((prompt[pos:pos + _MENU_WINDOW].replace("\n", " "), near))
    return clusters


# === R5 SCOPE CORRECTION — this rule was TOO BROAD and was selecting for a worse prompt ==========
#
# WHAT CHANGED AND WHY. The rule above ("no taxonomy menu ANYWHERE in the prompt, unconditionally")
# was written to stop `team = one of Founders|Eng|Product|Design|GTM|Ops`, and it does. But it bans
# the menu by LOCATION-BLIND pattern, and that had two consequences neither visible from this file:
#
#   1. STRUCTURAL (provable without any model — see test_extraction_prompt_coinage_b1.py):
#      the English corpus states NO department, so it runs the prompt's FALLBACK branch. A fallback
#      that asks the model to produce a bucket WITHOUT enumerating the permitted answers makes the
#      model coin one — and _norm_team knows 'founder', not 'founding', so R2's pass-through renders
#      the coinage as its own group. The only string-checkable fix is to ENUMERATE the permitted
#      answers in that branch. Enumerating IS >=3 taxonomy words in 120 chars. So the old rule made
#      the fix unreachable and left "coin a noun" as the best prompt that could pass it. The gate did
#      not merely tolerate a worse prompt; it SELECTED for one.
#
#   2. MEASURED — real MiniMax-M3, temperature=0, the real corpora, re-run by me rather than taken
#      on report. English has NO 部门 column so it exercises the FALLBACK branch; Sanya HAS one so it
#      exercises the VERBATIM main path. Both branches, both prompts:
#
#        ENGLISH (PrismDesign_TeamProfile_EN.xlsx)
#          OLD   7/7 answered, BYTE-IDENTICAL {Founders:1, Design:13, Product:3, Ops:3} — canonical
#          COND  2/2 answered canonical, IDENTICAL to OLD
#          R4    4/4 answered and 4/4 COINED, with FOUR DIFFERENT coinage sets at temperature=0:
#                  {research} / {HR, Research} / {HR} / {Administration, Research}
#                (the original report saw a fifth word, 「Founding」.) None is in _TEAM_ALIASES, so
#                R2's pass-through renders each as its own group, stealing people out of Design/Ops.
#
#        SANYA (the real 20-person villa-hotel roster)
#          COND  5/5 answered and 5/5 EXACTLY RIGHT — all six departments, exact headcounts,
#                including the single-member 活动策划组. missing=[] invented=[]
#          OLD   0/4 parseable (finish_reason=abort, JSON truncated)
#          R4    0/2 parseable
#          Order confound CONTROLLED: interleaved COND->OLD->COND back-to-back gave
#          stop/perfect -> abort -> stop/perfect, so this is the prompt, not provider drift.
#
#      => COND is STRICTLY BETTER than the prompt R4 shipped AND than the one R4 replaced, on both
#         corpora. The variant this gate vetoed was the best of the three.
#
#   3. R5 IMPLEMENTATION — COND IS NOW THE LIVE PROMPT, and these are the acceptance numbers
#      measured against the SHIPPED llm_extract._INSTRUCTIONS (production extract() path, real
#      MiniMax-M3, temperature=0, both real corpora, EN+ZH interleaved to control provider drift):
#
#        ENGLISH (PrismDesign_TeamProfile_EN.xlsx — no department column -> FALLBACK branch)
#          4 answered runs, 4/4 BYTE-IDENTICAL and 4/4 CANONICAL:
#            {"Founders": 1, "Design": 13, "Product": 3, "Ops": 3}     coined: NONE
#          Chen Mingyuan ("Founder / CEO") -> Founders, not 「Founding」. R4's coinage
#          (research / HR / Research / Administration / Founding) is GONE at 0/4.
#          (M3 aborted on 3 further EN attempts — those are NO ANSWER, not evidence; see below.)
#
#        SANYA (鹿山雅居-团队花名册.xlsx, the REAL 20-person villa-hotel roster)
#          3/3 answered and 3/3 EXACTLY RIGHT, all six departments, exact headcounts,
#          including the single-member 活动策划组:  missing=[] invented=[]
#            {别墅销售组:5, 渠道合作组:3, 客户运营组:4, 市场投放组:5, 策略分析组:2, 活动策划组:1}
#
#      NOTE the real roster's column is 「所属组」, not 「部门」 — the verbatim rule reads it anyway.
#      NOTE M3 aborts/truncates intermittently on BOTH prompts; a degraded run falls back to the
#      heuristic and is counted as NO ANSWER rather than as a pass, because the heuristic returns
#      teams the model never chose. Sampling until N ANSWERED is what makes this a measurement.
#
#      NOT REPRODUCED, stated so the file is not read as claiming more than it measured: I never got
#      OLD to emit groups=['GTM'] on Sanya, because OLD does not parse on that roster for me at all.
#      The original groups=['GTM'] observation came off a live Playwright run and is not re-verified
#      here. It does not affect the correction: COND's 5/5 is the load-bearing number.
#
# THE CORRECTED RULE, stated as a distinction rather than a ban:
#   * a FORCED menu — one that governs the answer for a document that DOES state departments — is
#     the bug, and stays RED.
#   * a SCOPED menu — one reachable only after a verbatim-copy instruction has claimed the main path
#     AND a fallback conditional has narrowed it to "the document names no department" — is not the
#     bug. It cannot produce groups=['GTM'] for Sanya, because Sanya's roster HAS a 部门 column and
#     never reaches that branch.
#
# THIS IS A CORRECTION OF AN OVER-BROAD GATE, NOT A WEAKENING TO FIT AN IMPLEMENTATION. The
# distinguishing test is whether it still bites the original bug, and that is not left to prose:
# test_the_corrected_rule_still_bites_r4s_original_bug re-installs R4's exact forced menu into the
# live prompt and asserts this gate fires. If that test ever goes green, the correction has eaten
# the gate's teeth and must be reverted.

_FALLBACK_CUE = re.compile(
    r"only\s+if|only\s+when|otherwise|fall\s*back|"
    r"if\s+(?:the\s+)?(?:doc|document)\s+(?:names|states|gives|lists|has)\s+no|"
    r"if\s+(?:the\s+)?(?:doc|document)\s+does\s+not\s+(?:name|state|give|list)|"
    r"when\s+(?:the\s+)?(?:doc|document)\s+(?:names|states|gives)\s+no", re.I)

# The main path must be claimed by COPYING, not by choosing. Without this, a bare "otherwise" high in
# the prompt would launder any menu below it.
_VERBATIM_CUE = re.compile(
    r"verbatim|copied?\s+exactly|copy\s+(?:it\s+)?exactly|exactly\s+as\s+written|"
    r"as\s+written|the\s+document'?s?\s+own\s+words|in\s+the\s+document'?s?\s+own", re.I)

# How far a menu may sit from the conditional that scopes it. A fallback cue does not license a menu
# on the other side of the prompt — see test_scope_filter_does_not_launder_a_distant_menu.
_FALLBACK_REACH = 400


def _forced_menu_clusters(prompt: str) -> list[tuple[str, set[str]]]:
    """Menus that GOVERN the answer — i.e. every menu except one properly scoped to a fallback
    branch. This is what the gate asserts against; _menu_clusters is only the raw finder.

    A cluster is excused only when ALL THREE hold, which is deliberately hard to satisfy by accident:
      * a fallback conditional appears before it ("Only if the document names no department..."),
      * that conditional is within _FALLBACK_REACH chars (a cue cannot reach across the prompt),
      * and a VERBATIM-copy instruction appears before that conditional, so the main path is
        already spoken for by copying rather than by choosing.

    RESIDUAL HOLE, named so it is not discovered as a surprise (the same courtesy the original file
    paid its own hole): the cues are matched over the WHOLE wire prompt, system message included. If
    someone later writes "verbatim" into _SYSTEM and an "otherwise" lands within 400 chars before a
    menu, that menu would be excused without the team rule ever promising to copy anything. Nothing
    string-shaped can close this — the fix would be to parse the prompt's branch structure, which is
    not a thing a regex does honestly. It is bounded in practice by _FALLBACK_REACH and by the cue
    having to be the NEAREST one before the menu, and it is backstopped by the real-model layer
    (test_extraction_prompt_coinage_b1.py::test_english_teams_are_canonical_on_the_real_model).
    """
    hits = []
    for w in _TAXONOMY_WORDS:
        for m in re.finditer(rf"(?<![A-Za-z]){re.escape(w)}(?![A-Za-z])", prompt, re.I):
            hits.append((m.start(), w))
    hits.sort()

    forced = []
    for i, (pos, _w) in enumerate(hits):
        near = {w for p, w in hits[i:] if p - pos <= _MENU_WINDOW}
        if len(near) < _MENU_MIN_DISTINCT:
            continue
        cues = list(_FALLBACK_CUE.finditer(prompt[:pos]))
        scoped = bool(cues) and (pos - cues[-1].end() <= _FALLBACK_REACH) and \
            bool(_VERBATIM_CUE.search(prompt[:cues[-1].start()]))
        if not scoped:
            forced.append((prompt[pos:pos + _MENU_WINDOW].replace("\n", " "), near))
    return forced


def test_extraction_prompt_does_not_force_team_into_the_preset_taxonomy():
    """BORN RED — the live bug, and the only assertion here that touches it.

    The prompt currently orders the model: `team = one of Founders|Eng|Product|Design|GTM|Ops if it
    can be honestly mapped, else ""`. Twenty Sanya employees across six departments come back as
    GTM ×20, and the model is being obedient. Downstream Python cannot repair this: _norm_team never
    sees 「别墅销售组」, it sees "GTM", and "GTM" is a perfectly valid mapping it must honour.

    The taxonomy may keep existing — TEAMS is still a fine thing for _norm_team to map ONTO when a
    document honestly says "Engineering". What must stop is the prompt presenting it to the model as
    the set of permitted ANSWERS. The document's own word for the department is the answer.

    Read the file docstring for why this is a string assertion, what makes it a rule rather than a
    spelling test, and the one hole it does not close.
    """
    brain = RecordingBrain()
    LLMExtractor(brain, retry_backoff_s=0).extract(SANYA_ROSTER_DOC)
    assert brain.prompts, "the extractor never called the brain — this gate saw nothing"

    clusters = _forced_menu_clusters(brain.prompts[0])
    assert not clusters, (
        "the extraction prompt ENUMERATES the preset team taxonomy to the model, in a scope that "
        "GOVERNS documents which state their own departments:\n"
        + "\n".join(f"  {sorted(words)} within {_MENU_WINDOW} chars: ...{span}..."
                    for span, words in clusters[:3])
        + "\n\nA prompt that offers a closed menu gets a menu item back. The real Sanya run returned"
          "\ngroups=['GTM'] for 20 people across 6 real departments (别墅销售组/渠道合作组/客户运营组/"
          "\n市场投放组/策略分析组/活动策划组) — not because the model was wrong, but because it obeyed."
          "\nAsk for the department the DOCUMENT states, verbatim; let _norm_team map it afterwards."
          "\n\nNOTE (R5 scope correction): a menu is NOT forbidden outright any more. One reachable "
          "\nonly inside the 'document names no department' fallback — after a verbatim-copy "
          "\ninstruction has claimed the main path — is accepted, because it cannot touch Sanya (whose "
          "\nroster HAS a 部门 column). What is still forbidden is a menu that governs the main path. "
          "\nSee the R5 SCOPE CORRECTION block above for the measured reason."
    )


# R4's ORIGINAL field rule, byte-for-byte off the last commit that shipped it (git show
# HEAD:...llm_extract.py). This is the bug the gate exists for, kept as a literal so the teeth test
# below cannot drift away from what actually shipped.
_R4_ORIGINAL_FORCED_MENU = (
    '- people: one entry per real named individual. In a roster/table: one per data row (skip header\n'
    '  rows). role = their stated title. team = one of Founders|Eng|Product|Design|GTM|Ops if it can be\n'
    '  honestly mapped, else "". tenure = stated experience/tenure phrase (e.g. "8 years of B2B design",\n'
    '  free text). owns = up to 6 short phrases of what they own / are responsible for, from the doc.'
)


def test_the_corrected_rule_still_bites_r4s_original_bug():
    """THE TEETH TEST FOR THE R5 SCOPE CORRECTION. Executed, not asserted in prose.

    A loosened gate is only legitimate if it still catches what it was built to catch. So this does
    not reason about the rule — it re-installs R4's EXACT original forced menu into the live
    _INSTRUCTIONS, drives the real extract() path, and demands the gate fire.

    If this goes green, the scope correction has eaten the gate and must be reverted: it would mean
    `team = one of Founders|Eng|Product|Design|GTM|Ops` sails through, which is precisely the prompt
    that produced groups=['GTM'] over 20 Sanya employees on the real machine.

    Note the mutation is applied to the MODULE the extractor reads, not to a copy of the string, so
    it exercises the same wire-capture path as the gate itself.
    """
    from avery.ingest import llm_extract as LX

    original = LX._INSTRUCTIONS
    try:
        LX._INSTRUCTIONS = original.split("Field rules:")[0] + "Field rules:\n" + \
            _R4_ORIGINAL_FORCED_MENU
        brain = RecordingBrain()
        LLMExtractor(brain, retry_backoff_s=0).extract(SANYA_ROSTER_DOC)
        forced = _forced_menu_clusters(brain.prompts[0])
        assert forced, (
            "THE SCOPE CORRECTION REMOVED THE GATE'S TEETH. R4's original forced menu\n"
            f"    {_R4_ORIGINAL_FORCED_MENU.splitlines()[1].strip()}\n"
            "is no longer detected as a FORCED menu. That prompt is the live bug: 20 Sanya employees "
            "across 6 departments came back as groups=['GTM'] on the real machine. Revert the "
            "correction — an over-broad gate is bad, a toothless one is worse."
        )
        # and it must be caught for the RIGHT reason: the whole taxonomy, named in one breath
        words = set().union(*[w for _s, w in forced])
        assert {"founders", "product", "design"} <= words, (
            f"the forced menu was detected but on the wrong words: {sorted(words)}")
    finally:
        LX._INSTRUCTIONS = original

    # the restore actually happened — otherwise every later test runs against a mutant prompt
    brain = RecordingBrain()
    LLMExtractor(brain, retry_backoff_s=0).extract(SANYA_ROSTER_DOC)
    assert not _forced_menu_clusters(brain.prompts[0]), \
        "the mutation was not restored — _INSTRUCTIONS is still patched"


def test_scoped_fallback_menu_is_accepted_but_only_when_truly_scoped():
    """The CORRECTION's own contract, in both directions — the reason it is a distinction rather
    than a hole.

    ACCEPTED: verbatim claims the main path, and the menu is reachable only via an explicit
    "document names no department" conditional. This is the variant R4's implementer proposed and
    then vetoed to satisfy the old rule; measured on the real model it was strictly better than what
    shipped (English canonical, Sanya's six departments verbatim). B1 additionally REQUIRES this
    shape — an un-enumerated fallback is what coins 「Founding」.

    STILL FORCED: everything that only LOOKS scoped —
      * a menu with no verbatim instruction claiming the main path (a bare "otherwise" would
        otherwise launder any menu),
      * a menu whose conditional is about something other than the document naming no department,
      * R4's original, which has no conditional before the menu at all.
    """
    verbatim = ("team = the department the document states, copied VERBATIM in the document's own "
                "words. ")

    accepted = verbatim + ("Only if the document names no department for ANYONE, map the person's "
                           "stated title onto exactly one of: Founders|Eng|Product|Design|GTM|Ops.")
    assert not _forced_menu_clusters(accepted), (
        "a menu properly scoped to the fallback branch was still reported as FORCED — the "
        "correction does not work, and B1's fix (enumerate the fallback's answers) stays unreachable")
    assert _menu_clusters(accepted), (
        "precondition: the raw detector must still SEE this menu — otherwise the scope filter is "
        "not what is accepting it and this test proves nothing")

    for still_bad, why in [
        ('team = one of Founders|Eng|Product|Design|GTM|Ops if it can be honestly mapped, else ""',
         "R4's original: no conditional, no verbatim — the live bug"),
        ("Only if the document names no department, use one of Founders|Eng|Product|Design|GTM|Ops.",
         "a conditional with NO verbatim instruction claiming the main path"),
        (verbatim + "If the person is senior, pick one of: Founders, Eng, Product, Design.",
         "a conditional about something other than the document naming no department"),
    ]:
        assert _forced_menu_clusters(still_bad), f"scope filter excused a forced menu ({why}): {still_bad!r}"


def test_scope_filter_does_not_launder_a_distant_menu():
    """A fallback cue must not license a menu on the far side of the prompt.

    Without the _FALLBACK_REACH bound, the correction would be trivially defeatable: write one
    "copy verbatim ... only if the document names no department ..." sentence at the top, then put
    an unconditional menu anywhere below it, and every menu in the file is excused forever. The
    bound is what keeps the correction a scope rule instead of a magic password.
    """
    laundered = ("team = copy the department VERBATIM. Only if the document names no department, "
                 "use the title.\n" + ("  filler filler filler filler.\n" * 30)
                 + "  team = one of Founders|Eng|Product|Design|GTM|Ops.")
    assert _forced_menu_clusters(laundered), (
        "a distant unconditional menu was excused by a fallback cue 700+ chars earlier — the scope "
        "filter is a password, not a scope. Tighten _FALLBACK_REACH.")


def test_prompt_menu_detector_is_not_blind():
    """The detector is the load-bearing half of the gate above, so it gets its own proof rather than
    being trusted. Two directions, because a detector that always fires and a detector that never
    fires are both useless:
      * it FIRES on menus it has never seen, including one re-worded entirely in alias spellings —
        the exact dodge available to someone who wants the gate quiet;
      * it STAYS SILENT on the shape a real fix takes, so the gate above cannot be satisfied only by
        deleting the taxonomy from a prompt that still needs to name a bucket in passing.
    Without this, `assert not clusters` could be passing because _menu_clusters returns [] always.
    """
    for menu in ("team = one of Founders|Eng|Product|Design|GTM|Ops if it can be mapped",
                 "team: choose Sales, Engineering or Operations",
                 "pick the closest: founders / product / ops"):
        assert _menu_clusters(menu), f"detector blind to a closed menu: {menu!r}"

    for ok in ('team = the department the document states for this person, copied verbatim '
               '(e.g. "别墅销售组", "Design"). "" if the document does not state one.',
               'tenure = stated experience phrase, e.g. "8 years of B2B design"'):
        assert not _menu_clusters(ok), f"detector fires on a legitimate prompt: {ok!r}"


# === THE NET · born green, each mutation-proved ==================================================
#
# None of the below is red today. Measured, not assumed: _build already returns '别墅销售组'
# verbatim. They exist so that the axis cannot be re-broken from the Python side once the prompt is
# fixed — the R2 pass-through has no gate at all on the LLM path today.


@pytest.mark.parametrize("dept", sorted(_SANYA_ORG))
def test_llm_path_keeps_a_real_chinese_department_verbatim(dept):
    """BORN GREEN. Forward direction: _build routes team through _norm_team (llm_extract.py:320) and
    R2 made _norm_team pass unmappable values through, so the LLM path is already correct.

    MUTATION PROOF (this is not a decorative assertion):
        _norm_team's `return text` (extract.py, last line) -> `return ""`
            -> every dept becomes '' -> RED for all 6.
        _norm_team's `return text` -> `return TEAMS[0]`
            -> '别墅销售组' becomes 'Founders' -> RED for all 6 (the pre-R2 bug exactly).
        _build's `team=_norm_team(...)` -> `team=""` (i.e. the LLM path stops asking)
            -> RED for all 6 while every heuristic-path team test stays green — which is the
               R2/R3 blind spot itself, and this is the gate that would have caught it.
    """
    res = LLMExtractor(RecordingBrain(), retry_backoff_s=0)._build(
        SANYA_ROSTER_DOC,
        {"people": [{"name": _SANYA_ORG[dept][0], "role": _ROLE_BY_TEAM[dept],
                     "team": dept, "line": 3}]})
    assert [p.team for p in res.people] == [dept], (
        f"the model reported the real department {dept!r} and the LLM path returned "
        f"{[p.team for p in res.people]!r} — a stated department must reach the page as itself, "
        f"not squeezed into the startup taxonomy"
    )


def test_llm_path_yields_the_six_real_groups_not_one_bucket():
    """BORN GREEN. The whole-roster shape, written as the mirror image of the machine-observed
    failure: the real run produced groups=['GTM'] over 20 people, and this asserts the six the
    document actually states — WITH their real headcounts, because 'six groups exist' is satisfiable
    by a mapping that shuffles people between them.

    活动策划组 having exactly one member is asserted on purpose. It is true, it is ugly, and it is
    the first thing a re-bucketing regression eats.

    CONDITIONAL, AND THE CONDITION IS THE POINT: this feeds the model's answer in, so it assumes a
    model that reports departments — i.e. it assumes the prompt gate above is green. It is a net, not
    proof that Sanya works. Only a real-model run proves that.

    MUTATION PROOF:
        _norm_team's `return text` -> `return ""`
            -> 20 people, 1 group ('') -> RED: "20 people collapsed onto 1 group".
        _norm_team's `return text` -> `return "GTM"`
            -> reproduces the observed groups=['GTM'] BYTE FOR BYTE -> RED, message reads
               "the page will group by these teams: ['GTM']".
        merge 活动策划组 into 市场投放组 in _SANYA_ORG (fixture mutation)
            -> RED: 市场投放组 6 != 5, and 活动策划组 goes missing.
               ^ this one FAILED TO GO RED on the first draft and is why _EXPECTED_GROUP_SIZES
                 exists. See the comment there: the expectation used to be derived from the fixture,
                 so both sides moved together and the count could not fail. The proof caught the
                 gate, which is the entire reason to run the proof.
    """
    res = LLMExtractor(RecordingBrain(), retry_backoff_s=0)._build(
        SANYA_ROSTER_DOC, _sanya_payload())

    assert len(res.people) == 20, f"expected the 20-person roster, got {len(res.people)}"
    groups: dict[str, list[str]] = {}
    for p in res.people:
        groups.setdefault(p.team, []).append(p.name)

    assert set(groups) == set(_EXPECTED_GROUP_SIZES), (
        f"the page will group by these teams: {sorted(groups)}\n"
        f"the document states these:        {sorted(_EXPECTED_GROUP_SIZES)}\n"
        f"(the real machine produced ['GTM'] — 20 people, one bucket)"
    )
    assert {k: len(v) for k, v in groups.items()} == _EXPECTED_GROUP_SIZES, (
        f"headcounts drifted: {({k: len(v) for k, v in groups.items()})} != "
        f"{_EXPECTED_GROUP_SIZES}"
    )


@pytest.mark.parametrize("raw,expected", [
    # the values the real English corpus and both stub transports actually emit
    ("Design", "Design"), ("Eng", "Eng"), ("Engineering", "Eng"), ("Product", "Product"),
    ("GTM", "GTM"), ("Sales", "GTM"), ("Operations", "Ops"), ("Ops", "Ops"),
    ("Founder", "Founders"), ("Founders", "Founders"),
])
def test_llm_path_english_team_mapping_is_frozen(raw, expected):
    """BORN GREEN — the ANTI-OVER-FIT catch. Whoever fixes the prompt may be tempted to help it
    along in Python ("stop mapping, just pass everything through"), and that would silently unmap
    every English team the existing corpus ships. Lena Park is 'Design'; an Engineering row is
    'Eng'. The bug is the prompt; the mapping is not the bug.

    (The same freeze exists at the _norm_team unit level in test_cjk_identity.py. This one is not a
    duplicate: it pins the LLM PATH — the path R2/R3 never exercised and the one production runs.)

    MUTATION PROOF:
        _build's `team=_norm_team(_s(raw.get("team"), 40))` -> `team=_s(raw.get("team"), 40)`
            -> 'Engineering'/'Sales'/'Operations'/'Founder' pass through unmapped -> RED on 4 cases,
               while every Chinese assertion above stays green. That is exactly the over-fit this
               catches, and it proves the case list has teeth rather than restating pass-through.
    """
    res = LLMExtractor(RecordingBrain(), retry_backoff_s=0)._build(
        SANYA_ROSTER_DOC, {"people": [{"name": "Lena Park", "role": "Director",
                                       "team": raw, "line": 3}]})
    assert [p.team for p in res.people] == [expected], (
        f"English team mapping changed on the LLM path: {raw!r} -> "
        f"{[p.team for p in res.people]!r}, expected {expected!r}"
    )


@pytest.mark.parametrize("raw", ["", "   ", "　", None, [], {}])
def test_llm_path_unknown_team_never_becomes_founders(raw):
    """BORN GREEN — R2 killed this at the _norm_team level ('' is a substring of every TEAMS entry,
    so every blank cell became TEAMS[0]). Gated here on the LLM path because the model returns ""
    for team more often than any other value — the prompt literally instructs it to ("else ''") —
    so this path is where a Founders regression would land first, and it would land on the single
    most consequential wrong guess available: the owners of the company.

    Non-string inputs are included because _s() coerces the model's JSON and a model returns null
    and [] where a schema says string; all three flow to "" and must land where "" lands.

    `0` IS DELIBERATELY NOT IN THIS LIST, and the omission is a finding, not an oversight. I put it
    here on the assumption it was another route to Founders; it is not — measured:
        _s(0) == "0" -> _norm_team("0") == "0"
    so a model that returns `0` for team yields a person on a team literally named "0", which would
    render as a group titled 「0」. That is junk, but it is (a) not the Founders bug this test is
    about, and (b) backed by no evidence — unlike groups=['GTM'], I have never seen a model emit it.
    Gating speculation is how a suite grows assertions nobody can justify later, so it is reported
    instead of gated. If it should be gated, that is a decision to make on purpose.

    MUTATION PROOF:
        _norm_team's early `if not text: return ""` -> `return TEAMS[0]`
            -> RED for all 7 (the pre-R2 bug, restored).
        delete the early return entirely, restoring R2's original `for t in TEAMS: if raw in
        t.lower(): return t` substring loop
            -> '' matches 'founders' -> RED for all 7.
    """
    res = LLMExtractor(RecordingBrain(), retry_backoff_s=0)._build(
        SANYA_ROSTER_DOC, {"people": [{"name": "陈思雨", "role": "别墅销售顾问",
                                       "team": raw, "line": 3}]})
    assert [p.team for p in res.people] == [""], (
        f"an unstated team ({raw!r}) became {[p.team for p in res.people]!r} on the LLM path — "
        f"unknown must stay unknown; guessing 'Founders' files a hotel clerk as a company founder"
    )


def test_field_comments_still_claim_team_is_one_of_teams():
    """BORN RED (documentation drift, asserted rather than reported).

    R2 made team FREE TEXT — an unmappable department passes through verbatim, and 「别墅销售组」 is
    a legal value today. Two comments never got the memo and still declare the old closed set:

        extract.py    PersonEntity.team  # one of TEAMS (or "" if unknown — never guessed hard)
        llm_extract.py _INSTRUCTIONS      "team": ""  ... one of Founders|Eng|...

    This is not pedantry, it is THE MECHANISM OF THIS BUG FAMILY. R2's own analysis quoted that
    PersonEntity comment as evidence for what the code should do — an out-of-date comment was read
    as a spec and reasoned FROM. A comment that describes behaviour the code abandoned is a trap
    primed for the next reader, and the next reader has already been caught once.

    Scoped to the DECLARATION line so it cannot be satisfied by deleting a comment somewhere else,
    and it stays green afterwards no matter how the replacement is worded — it only forbids the one
    claim that is false.
    """
    import inspect
    from avery.ingest import extract as E

    src = inspect.getsource(E)
    decl = next((ln for ln in src.splitlines()
                 if re.match(r"\s*team:\s*str\s*=", ln)), None)
    assert decl is not None, "PersonEntity.team declaration not found — has the field moved?"
    assert "one of TEAMS" not in decl, (
        f"PersonEntity.team still documents a closed set it no longer has:\n    {decl.strip()}\n"
        f"Since R2 an unmappable department passes through verbatim, so '别墅销售组' is a legal "
        f"value and this comment is false. R2's reasoning was built on reading this exact line as "
        f"a spec — stale comments in this file are how the team axis broke twice."
    )
