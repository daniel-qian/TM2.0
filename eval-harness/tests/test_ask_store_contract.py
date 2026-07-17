# -*- coding: utf-8 -*-
"""feat-034 stage C — the Ask storage contract: ONE suite, TWO implementations (memory + postgres).

The Ask ("Quick ask" / 快问) rides the SAME registry seam feat-030/033 established: the in-memory
`ContextRegistry` and the `PostgresContextRegistry` both grow `put_ask/get_ask/get_ask_by_token/
record_answer` behind one duck-typed API, so `active_registry()` keeps being the single seam the
service talks to. Behavior, not internals, is the contract (mirrors test_registry_contract.py):

  SHARED (memory + postgres — the offline suite runs the memory leg with no DB):
    * put_ask -> get_ask round-trips the whole ask: questions (kind/text), recipients, status,
      comment_prompt, thread_hint, generation_mode, created_at/expires_at;
    * unknown ask id -> None (the HTTP 404 depends on this);
    * share tokens resolve via get_ask_by_token to (ask, recipient index); unknown token -> None;
    * record_answer is SINGLE-LOCK: first write lands, the second returns 'already' and does NOT
      overwrite (PRD Q8 — evidence must be stable, no coerced re-answers);
    * the ask status the STORE holds advances shared -> collecting -> closed as answers land
      (server-side status is the source of truth — F1);
    * 🔴 the storage door refuses a person-scoring QUESTION (two-tier: `redline.validate` unless
      `AVERY_ALLOW_PERSON_SCORING` is on — reuses the feat-033 switch, no new mechanism);
    * a NUL (0x00) in any text field is refused regardless of the switch (storage safety).

  DURABILITY (@needs_db, postgres only):
    * an ask put by one registry instance — tokens, answers, comments included — is visible to a
      BRAND-NEW instance/connection (the "employee opens the link tomorrow" restart claim).
"""
from __future__ import annotations

import uuid
from pathlib import Path

import pytest

from avery.ingest import ingest_paths
from avery.ingest.registry import ContextRegistry

HERE = Path(__file__).resolve().parent.parent          # eval-harness/
FIX = HERE / "tests" / "fixtures" / "ingest"
HANDBOOK = FIX / "Studio_Handbook.md"
ROSTER = FIX / "Team_Roster.xlsx"

needs_db = pytest.mark.needs_db


def _db_url() -> str | None:
    import os
    return (os.environ.get("AVERY_DB_URL") or os.environ.get("PGVECTOR_URL") or "").strip() or None


def _new_cid() -> str:
    return "ctx_asktest_" + uuid.uuid4().hex[:12]


class _Impl:
    def __init__(self, name: str, fresh):
        self.name = name
        self.fresh = fresh
        self.created: list[str] = []

    def track(self, cid: str) -> str:
        self.created.append(cid)
        return cid


def _pg_impl(tmp_path: Path) -> _Impl:
    url = _db_url()
    if not url:
        pytest.skip("needs AVERY_DB_URL (or PGVECTOR_URL) pointing at a Postgres — DB layer skipped")
    pytest.importorskip("psycopg")
    from avery.ingest.pg_registry import PostgresContextRegistry
    data_dir = tmp_path / "data"
    return _Impl("postgres", lambda: PostgresContextRegistry(url, data_dir=data_dir))


def _pg_cleanup(impl: _Impl) -> None:
    if impl.name != "postgres" or not impl.created:
        return
    reg = impl.fresh()
    for cid in impl.created:
        reg.delete(cid)   # asks/recipients cascade with the context


@pytest.fixture(params=["memory", pytest.param("postgres", marks=needs_db)])
def impl(request, tmp_path):
    if request.param == "memory":
        reg = ContextRegistry()
        yield _Impl("memory", lambda: reg)
        return
    pg = _pg_impl(tmp_path)
    yield pg
    _pg_cleanup(pg)


def _ingest_context(impl: _Impl, work_dir: Path) -> tuple:
    reg = impl.fresh()
    cid = impl.track(_new_cid())
    rep = ingest_paths([str(HANDBOOK)], registry=reg, work_dir=work_dir, context_id=cid,
                       name="prism", owner_token="tok_ask_contract_owner")
    assert rep.ok
    return reg, cid


def _sample_ask(cid: str):
    from avery.ingest.ask import Ask, AskQuestion, AskRecipient, new_ask_id, now_iso, default_expiry
    created = now_iso()
    return Ask(
        id=new_ask_id(),
        context_id=cid,
        status="draft",
        questions=[
            AskQuestion(id="q1", kind="scale",
                        text="How confident are you that the pilot launch lands on the current date?"),
            AskQuestion(id="q2", kind="yesno",
                        text="Do you have everything you need to hold that date?"),
        ],
        recipients=[
            AskRecipient(id="p1", name="Lena Park"),
            AskRecipient(id="p2", name="Marcus Reid"),
        ],
        comment_prompt="Anything to add, in one line?",
        thread_hint="the pilot launch date",
        generation_mode="manager",
        created_at=created,
        expires_at=default_expiry(created),
    )


# ==============================================================================================
# SHARED CONTRACT — memory + postgres
# ==============================================================================================

def test_put_ask_then_get_ask_round_trips(impl, tmp_path):
    reg, cid = _ingest_context(impl, tmp_path / "mem")
    ask = _sample_ask(cid)
    reg.put_ask(ask)
    got = reg.get_ask(ask.id)
    assert got is not None, "put_ask -> get_ask lost the ask"
    assert got.id == ask.id
    assert got.context_id == cid
    assert got.status == "draft"
    assert [(q.id, q.kind, q.text) for q in got.questions] == \
           [(q.id, q.kind, q.text) for q in ask.questions]
    assert [(r.id, r.name) for r in got.recipients] == [("p1", "Lena Park"), ("p2", "Marcus Reid")]
    assert got.comment_prompt == "Anything to add, in one line?"
    assert got.thread_hint == "the pilot launch date"
    assert got.generation_mode == "manager"
    assert got.created_at and got.expires_at


def test_unknown_ask_id_resolves_to_none(impl, tmp_path):
    reg = impl.fresh()
    assert reg.get_ask("ask_never_registered") is None


def test_share_tokens_resolve_by_token(impl, tmp_path):
    reg, cid = _ingest_context(impl, tmp_path / "mem")
    ask = _sample_ask(cid)
    ask.status = "shared"
    ask.recipients[0].share_token = "tok_share_a_" + uuid.uuid4().hex
    ask.recipients[1].share_token = "tok_share_b_" + uuid.uuid4().hex
    reg.put_ask(ask)

    hit = reg.get_ask_by_token(ask.recipients[1].share_token)
    assert hit is not None, "a minted share token must resolve"
    got, ridx = hit
    assert got.id == ask.id and ridx == 1
    assert reg.get_ask_by_token("tok_never_minted") is None


def test_record_answer_is_single_lock(impl, tmp_path):
    """First answer lands; the second is refused ('already') and the FIRST answer is preserved —
    the evidence is stable (PRD Q8: answered == locked)."""
    reg, cid = _ingest_context(impl, tmp_path / "mem")
    ask = _sample_ask(cid)
    ask.status = "shared"
    tok_a = "tok_lock_a_" + uuid.uuid4().hex
    tok_b = "tok_lock_b_" + uuid.uuid4().hex
    ask.recipients[0].share_token = tok_a
    ask.recipients[1].share_token = tok_b
    reg.put_ask(ask)

    first = reg.record_answer(tok_a, [{"question_id": "q1", "value": 4},
                                      {"question_id": "q2", "value": True}],
                              "Confident on the build itself.", "2026-07-14T10:00:00+00:00")
    assert first == "ok"
    second = reg.record_answer(tok_a, [{"question_id": "q1", "value": 1},
                                       {"question_id": "q2", "value": False}],
                               "changed my mind", "2026-07-14T11:00:00+00:00")
    assert second == "already", "a second answer must be refused, not overwrite"

    got, ridx = reg.get_ask_by_token(tok_a)
    r = got.recipients[ridx]
    assert r.answers == [{"question_id": "q1", "value": 4}, {"question_id": "q2", "value": True}]
    assert r.comment == "Confident on the build itself."
    assert r.answered_at.startswith("2026-07-14T10")

    assert reg.record_answer("tok_never_minted", [], "", "2026-07-14T10:00:00+00:00") == "unknown"


def test_status_advances_shared_collecting_closed(impl, tmp_path):
    reg, cid = _ingest_context(impl, tmp_path / "mem")
    ask = _sample_ask(cid)
    ask.status = "shared"
    tok_a = "tok_st_a_" + uuid.uuid4().hex
    tok_b = "tok_st_b_" + uuid.uuid4().hex
    ask.recipients[0].share_token = tok_a
    ask.recipients[1].share_token = tok_b
    reg.put_ask(ask)

    assert reg.get_ask(ask.id).status == "shared"
    reg.record_answer(tok_a, [{"question_id": "q1", "value": 4}], "", "2026-07-14T10:00:00+00:00")
    assert reg.get_ask(ask.id).status == "collecting", "one of two in -> collecting"
    reg.record_answer(tok_b, [{"question_id": "q1", "value": 3}], "", "2026-07-14T10:05:00+00:00")
    assert reg.get_ask(ask.id).status == "closed", "all in -> closed"


# ==============================================================================================
# 🔴 the storage door — two-tier question red line + NUL safety (mirrors gate_note_red_line)
# ==============================================================================================

_SWITCH = "AVERY_ALLOW_PERSON_SCORING"
# Crafted so the FROZEN detector actually fires (EN ALWAYS construct; ZH scoring verb + target).
_BAD_EN = "How would you score her competence, 1 to 5?"
_BAD_ZH = "你觉得他自己的能力可以打几分？1到5分。"


@pytest.mark.parametrize("bad", [_BAD_EN, _BAD_ZH])
def test_storage_door_refuses_a_person_scoring_question(impl, tmp_path, monkeypatch, bad):
    monkeypatch.delenv(_SWITCH, raising=False)
    reg, cid = _ingest_context(impl, tmp_path / "mem")
    ask = _sample_ask(cid)
    ask.questions[0].text = bad
    with pytest.raises(ValueError, match="red line"):
        reg.put_ask(ask)
    assert reg.get_ask(ask.id) is None, "a refused scoring ask must NOT land"


def test_storage_door_lets_the_same_question_through_when_unblocked(impl, tmp_path, monkeypatch):
    monkeypatch.setenv(_SWITCH, "1")
    reg, cid = _ingest_context(impl, tmp_path / "mem")
    ask = _sample_ask(cid)
    ask.questions[0].text = _BAD_EN
    reg.put_ask(ask)
    assert reg.get_ask(ask.id).questions[0].text == _BAD_EN


def test_storage_door_refuses_a_nul_even_when_unblocked(impl, tmp_path, monkeypatch):
    monkeypatch.setenv(_SWITCH, "1")
    reg, cid = _ingest_context(impl, tmp_path / "mem")
    ask = _sample_ask(cid)
    ask.thread_hint = "a hint with a\x00hidden nul"
    with pytest.raises(ValueError, match="control character|NUL"):
        reg.put_ask(ask)
    assert reg.get_ask(ask.id) is None


# ==============================================================================================
# DURABILITY — postgres only (@needs_db): the "employee opens the link tomorrow" claim
# ==============================================================================================

@pytest.fixture()
def pg(tmp_path):
    impl = _pg_impl(tmp_path)
    yield impl
    _pg_cleanup(impl)


@needs_db
def test_pg_ask_survives_a_new_registry_instance(pg, tmp_path):
    reg_a, cid = _ingest_context(pg, tmp_path / "mem")
    ask = _sample_ask(cid)
    ask.status = "shared"
    tok = "tok_surv_" + uuid.uuid4().hex
    ask.recipients[0].share_token = tok
    reg_a.put_ask(ask)
    reg_a.record_answer(tok, [{"question_id": "q1", "value": 5},
                              {"question_id": "q2", "value": False}],
                        "I can hold the date if the pricing approval lands.",
                        "2026-07-14T10:00:00+00:00")

    reg_b = pg.fresh()   # brand-new connections — the simulated restart
    got = reg_b.get_ask(ask.id)
    assert got is not None, "the ask vanished for a new registry instance — persistence is fake"
    assert got.status == "collecting"
    hit = reg_b.get_ask_by_token(tok)
    assert hit is not None
    got2, ridx = hit
    r = got2.recipients[ridx]
    assert r.answers == [{"question_id": "q1", "value": 5}, {"question_id": "q2", "value": False}]
    assert r.comment == "I can hold the date if the pricing approval lands."
    # single-lock survives the restart too. `answered_at` must be a REAL timestamp even on the
    # path we expect to be refused: the pg twin binds it into `answered_at = %s::timestamptz` in the
    # same atomic `UPDATE ... WHERE answered_at IS NULL` that enforces the lock, so Postgres parses
    # the value BEFORE the WHERE can filter the row out — a sentinel like "x" raises
    # InvalidDatetimeFormat instead of returning "already". (The in-memory twin returns early on
    # `if rec.answered_at`, never looking at the argument, which is why a sentinel silently passed
    # there and this contract test only caught it the first time it ran against a real Postgres.)
    assert reg_b.record_answer(tok, [{"question_id": "q1", "value": 1}], "",
                               "2026-07-14T12:00:00+00:00") == "already"
