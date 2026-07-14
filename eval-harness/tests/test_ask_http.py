# -*- coding: utf-8 -*-
"""feat-034 stage C — the Ask manager HTTP surface (agent as first user), fully offline.

Contract (stage-C docking contract, kickoff-dev.md — the iron rules):
  * every MANAGER endpoint (POST /ask, POST /ask/{id}, /share, GET /ask/{id}, /revoke) requires the
    company's owner_token in a HEADER (X-Avery-Token / Bearer) — 404 on missing/wrong, byte-identical
    to the unknown-ask 404 (no enumeration oracle); the owner_token NEVER rides a URL;
  * question red line is TWO-TIER: asking about the WORK always passes; a person-scoring question is
    422 unless AVERY_ALLOW_PERSON_SCORING is on (reuses avery.scoring_policy — no new mechanism);
  * status vocabulary is SERVER-OWNED: draft | shared | collecting | closed | revoked | expired;
  * share mints one unguessable token per recipient and returns full links
    {AVERY_PUBLIC_BASE}/r/{token}; re-share is idempotent (links must survive a double click);
  * no questions in the body -> the server GENERATES 1..3 (mock/keyless -> deterministic template,
    honestly labeled generation_mode='template');
  * lifecycle: revoke -> revoked (terminal); expiry derives 'expired' past expires_at; a closed ask
    refuses revoke (the evidence is in);
  * /ask and /r/ ride the feat-039 rate-limit gate (env-configured, default off).

Runs with mock brain / heuristic extractor / in-memory registry — zero network, zero keys, no DB.
"""
from __future__ import annotations

import re
from pathlib import Path

import pytest

pytest.importorskip("fastapi.testclient")
from fastapi.testclient import TestClient  # noqa: E402

HERE = Path(__file__).resolve().parent.parent
FIX = HERE / "tests" / "fixtures" / "ingest"
HANDBOOK = FIX / "Studio_Handbook.md"
ROSTER = FIX / "Team_Roster.xlsx"

_SWITCH = "AVERY_ALLOW_PERSON_SCORING"
_BAD_EN = "How would you score her competence, 1 to 5?"
_BAD_ZH = "你觉得他自己的能力可以打几分？1到5分。"


@pytest.fixture()
def client(monkeypatch):
    monkeypatch.setenv("AVERY_BRAIN", "mock")
    monkeypatch.setenv("AVERY_EMBEDDINGS", "keyword")
    monkeypatch.setenv("AVERY_EXTRACTOR", "heuristic")
    monkeypatch.delenv("AVERY_DB_URL", raising=False)
    monkeypatch.delenv("PGVECTOR_URL", raising=False)
    monkeypatch.delenv(_SWITCH, raising=False)
    monkeypatch.delenv("AVERY_RATE_ASK_PER_MIN", raising=False)
    monkeypatch.delenv("AVERY_RATE_SHARE_PER_MIN", raising=False)
    from avery.ingest.registry import REGISTRY
    REGISTRY.clear()
    from service import upload_guard
    upload_guard.reset_rate_limiter()
    from service.app import app
    with TestClient(app) as c:
        yield c
    REGISTRY.clear()
    upload_guard.reset_rate_limiter()


def _ingest(client):
    files = [("files", (p.name, p.read_bytes(), "application/octet-stream"))
             for p in (HANDBOOK, ROSTER)]
    r = client.post("/ingest", files=files)
    assert r.status_code == 200, f"/ingest failed: {r.text[:300]}"
    body = r.json()
    return body["context_id"], body["owner_token"]


def _draft_body(cid, questions=None, recipients=None, **kw):
    body = {
        "company_context_id": cid,
        "questions": questions if questions is not None else [
            {"kind": "scale",
             "text": "How confident are you that the pilot launch lands on the current date?"},
            {"kind": "yesno", "text": "Do you have everything you need to hold that date?"},
        ],
        "recipients": recipients if recipients is not None else [
            {"id": "p1", "name": "Lena Park"},
            {"id": "p2", "name": "Marcus Reid"},
        ],
        "comment_prompt": "Anything to add, in one line?",
        "thread_hint": "the pilot launch date",
    }
    body.update(kw)
    return body


def _create(client, cid, tok, **kw):
    r = client.post("/ask", json=_draft_body(cid, **kw), headers={"X-Avery-Token": tok})
    assert r.status_code == 200, f"POST /ask failed: {r.status_code} {r.text[:300]}"
    return r.json()


def _share(client, ask_id, tok):
    r = client.post(f"/ask/{ask_id}/share", headers={"X-Avery-Token": tok})
    assert r.status_code == 200, f"share failed: {r.status_code} {r.text[:300]}"
    return r.json()


# ==============================================================================================
# 1) create / save — shape, server-minted id, 7-day expiry, generation honesty
# ==============================================================================================

def test_create_ask_returns_a_server_draft(client):
    cid, tok = _ingest(client)
    body = _create(client, cid, tok)
    assert body["status"] == "draft"
    assert body["id"].startswith("ask_"), "the server must mint the ask id"
    assert body["company_context_id"] == cid
    assert [q["kind"] for q in body["questions"]] == ["scale", "yesno"]
    assert all(q["id"] for q in body["questions"])
    assert [r["name"] for r in body["recipients"]] == ["Lena Park", "Marcus Reid"]
    assert body["generation_mode"] == "manager", "manager-written questions are labeled 'manager'"
    assert body["created_at"] and body["expires_at"]
    # ~7 days between created_at and expires_at (PRD Q8)
    from datetime import datetime
    dt = (datetime.fromisoformat(body["expires_at"]) - datetime.fromisoformat(body["created_at"]))
    assert 6.9 < dt.total_seconds() / 86400 < 7.1
    # recipients carry NO token/link before share
    assert all(not r.get("token") and not r.get("link") for r in body["recipients"])


def test_create_without_questions_generates_templates_honestly(client):
    """Mock brain / no key -> the server falls back to deterministic template questions and SAYS SO
    (generation_mode='template', never a silently invented 'llm')."""
    cid, tok = _ingest(client)
    body = _create(client, cid, tok, questions=[])
    assert 1 <= len(body["questions"]) <= 3
    assert all(q["kind"] in ("scale", "yesno") and q["text"].strip() for q in body["questions"])
    assert body["generation_mode"] == "template"
    # the generated questions themselves pass the question gate (about the work, not the person)
    from avery import redline
    for q in body["questions"]:
        assert redline.validate(q["text"]).passed, f"template question crossed: {q['text']}"


def test_save_edit_revalidates_and_share_freezes(client):
    cid, tok = _ingest(client)
    ask = _create(client, cid, tok)
    # edit while draft: OK
    r = client.post(f"/ask/{ask['id']}", json=_draft_body(cid, questions=[
        {"kind": "yesno", "text": "Is the vendor quote signed yet?"}]),
        headers={"X-Avery-Token": tok})
    assert r.status_code == 200
    assert [q["text"] for q in r.json()["questions"]] == ["Is the vendor quote signed yet?"]
    # after share, editing is refused (the questions are out the door)
    _share(client, ask["id"], tok)
    r = client.post(f"/ask/{ask['id']}", json=_draft_body(cid), headers={"X-Avery-Token": tok})
    assert r.status_code == 409


def test_save_edit_cannot_rebind_context_to_another_tenant(client):
    """Adversarial finding: save_ask authorized against the ask's ORIGINAL context, then rebuilt
    with the body's company_context_id — an authorized owner could rebind their ask into another
    tenant (owner lockout + cross-tenant injection). Context is immutable on edit: a crafted body
    context is ignored, the ask stays bound to A, and A keeps reading it."""
    cid_a, tok_a = _ingest(client)
    cid_b, tok_b = _ingest(client)
    assert cid_a != cid_b
    ask = _create(client, cid_a, tok_a)
    # A edits its own ask but smuggles B's context into the body
    r = client.post(f"/ask/{ask['id']}", json=_draft_body(cid_b, questions=[
        {"kind": "yesno", "text": "Is the vendor quote signed yet?"}]),
        headers={"X-Avery-Token": tok_a})
    assert r.status_code == 200
    assert r.json()["company_context_id"] == cid_a  # NOT rebound to B
    # A is not locked out of its own ask
    assert client.get(f"/ask/{ask['id']}", headers={"X-Avery-Token": tok_a}).status_code == 200
    # B's owner cannot read A's ask (no cross-tenant injection landed)
    assert client.get(f"/ask/{ask['id']}", headers={"X-Avery-Token": tok_b}).status_code == 404


def test_answer_rejects_non_decimal_digit_lookalikes(client):
    """Adversarial finding F-1: superscript/enclosed unicode 'digits' (² ①) pass str.isdigit()
    but int() rejects them -> crafted POST reached a 500. Now a clean 422, link stays unanswered."""
    cid, tok = _ingest(client)
    ask = _create(client, cid, tok, questions=[{"kind": "scale", "text": "How doable is it?"}])
    share = _share(client, ask["id"], tok)
    token = share["recipients"][0]["token"]
    qid = ask["questions"][0]["id"]
    for lookalike in ("²", "①"):  # ² , ①
        r = client.post(f"/r/{token}/answer", data={f"q_{qid}": lookalike})
        assert r.status_code == 422, f"{lookalike!r} -> {r.status_code} (expected 422, not 500)"
    # a real answer still lands (the link was never locked by the failed attempts)
    assert client.post(f"/r/{token}/answer", data={f"q_{qid}": "4"}).status_code == 200


# ==============================================================================================
# 2) 🔴 the two-tier question red line at the HTTP door
# ==============================================================================================

@pytest.mark.parametrize("bad", [_BAD_EN, _BAD_ZH])
def test_person_scoring_question_is_422_when_switch_off(client, bad):
    cid, tok = _ingest(client)
    r = client.post("/ask", json=_draft_body(cid, questions=[{"kind": "scale", "text": bad}]),
                    headers={"X-Avery-Token": tok})
    assert r.status_code == 422, f"a person-scoring question must be refused: {r.status_code}"
    detail = r.json()["detail"]
    assert "red line" in str(detail), "the refusal must SAY WHY (question gate)"


def test_person_scoring_question_passes_when_switch_on(client, monkeypatch):
    monkeypatch.setenv(_SWITCH, "1")
    cid, tok = _ingest(client)
    r = client.post("/ask", json=_draft_body(cid, questions=[{"kind": "scale", "text": _BAD_EN}]),
                    headers={"X-Avery-Token": tok})
    assert r.status_code == 200, "with the operator switch ON the same question is allowed"


def test_work_question_always_passes(client):
    cid, tok = _ingest(client)
    r = client.post("/ask", json=_draft_body(cid, questions=[
        {"kind": "scale", "text": "你对这次谈判有多少把握？"}]), headers={"X-Avery-Token": tok})
    assert r.status_code == 200, "asking about the WORK must always pass (two-tier, tier 1)"


def test_scoring_comment_prompt_is_422(client):
    cid, tok = _ingest(client)
    r = client.post("/ask", json=_draft_body(cid, comment_prompt=_BAD_EN),
                    headers={"X-Avery-Token": tok})
    assert r.status_code == 422


# ==============================================================================================
# 3) structural validation — bad shapes never land (server = final door, frontend F3 mirrors)
# ==============================================================================================

@pytest.mark.parametrize("questions", [
    [{"kind": "scale", "text": f"How is workstream {i} pacing?"} for i in range(4)],  # > 3
    [{"kind": "matrix", "text": "Pick all that apply"}],                              # unknown kind
    [{"kind": "scale", "text": "   "}],                                               # empty text
])
def test_bad_question_shapes_are_422(client, questions):
    cid, tok = _ingest(client)
    r = client.post("/ask", json=_draft_body(cid, questions=questions),
                    headers={"X-Avery-Token": tok})
    assert r.status_code == 422, f"bad question shape must be refused: {questions!r}"


def test_no_recipients_is_422(client):
    cid, tok = _ingest(client)
    r = client.post("/ask", json=_draft_body(cid, recipients=[]), headers={"X-Avery-Token": tok})
    assert r.status_code == 422


# ==============================================================================================
# 4) owner_token — 404 on mismatch, no oracle, header-only
# ==============================================================================================

def test_manager_endpoints_404_without_or_with_wrong_token(client):
    cidA, tokA = _ingest(client)
    cidB, tokB = _ingest(client)
    ask = _create(client, cidA, tokA)
    aid = ask["id"]

    unknown = client.get("/ask/ask_never_existed", headers={"X-Avery-Token": tokA})
    assert unknown.status_code == 404

    for headers in (None, {"X-Avery-Token": tokB}, {"X-Avery-Token": "wrong"}):
        for method, url in (("GET", f"/ask/{aid}"), ("POST", f"/ask/{aid}/share"),
                            ("POST", f"/ask/{aid}/revoke"), ("POST", f"/ask/{aid}")):
            if method == "GET":
                r = client.get(url, headers=headers)
            else:
                body = _draft_body(cidA) if url.endswith(aid) else None
                r = client.post(url, json=body, headers=headers)
            assert r.status_code == 404, f"{method} {url} with bad auth -> {r.status_code}"
            # NO enumeration oracle: same body as the unknown-ask 404 (never names the context)
            assert r.json() == {"detail": f"unknown ask id: {aid}"} or \
                   r.json()["detail"].startswith("unknown ask id"), r.text
            assert cidA not in r.text, "the 404 must not leak the context id"

    # creation without a token is refused the same way (404 against the context)
    r = client.post("/ask", json=_draft_body(cidA))
    assert r.status_code == 404


def test_owner_token_never_appears_in_links(client):
    cid, tok = _ingest(client)
    ask = _create(client, cid, tok)
    shared = _share(client, ask["id"], tok)
    assert tok not in str(shared), "the owner_token must never ride a URL / response link"


# ==============================================================================================
# 5) share — one unguessable token per recipient, full links, idempotent
# ==============================================================================================

def test_share_mints_one_link_per_recipient(client, monkeypatch):
    monkeypatch.setenv("AVERY_PUBLIC_BASE", "https://avery.ima-read.com")
    cid, tok = _ingest(client)
    ask = _create(client, cid, tok)
    shared = _share(client, ask["id"], tok)
    assert shared["status"] == "shared"
    recips = shared["recipients"]
    assert len(recips) == 2
    tokens = [r["token"] for r in recips]
    assert all(t and len(t) >= 32 for t in tokens), "share tokens must be unguessable"
    assert len(set(tokens)) == 2, "one token PER recipient (one-person-one-link)"
    for r in recips:
        assert r["link"] == f"https://avery.ima-read.com/r/{r['token']}"
    # idempotent: a re-share returns the SAME links (a double click must not invalidate pasted links)
    again = _share(client, ask["id"], tok)
    assert [r["token"] for r in again["recipients"]] == tokens


def test_share_respects_public_base_env(client, monkeypatch):
    monkeypatch.setenv("AVERY_PUBLIC_BASE", "https://staging.example.cn")
    cid, tok = _ingest(client)
    ask = _create(client, cid, tok)
    shared = _share(client, ask["id"], tok)
    assert shared["recipients"][0]["link"].startswith("https://staging.example.cn/r/")


# ==============================================================================================
# 6) lifecycle — receipts flow, revoke, expiry (server-owned status vocabulary)
# ==============================================================================================

def _answer(client, token, values, comment=""):
    data = dict(values)
    if comment:
        data["comment"] = comment
    return client.post(f"/r/{token}/answer", data=data)


def test_receipts_flow_shared_collecting_closed(client):
    cid, tok = _ingest(client)
    ask = _create(client, cid, tok)
    shared = _share(client, ask["id"], tok)
    q_scale = next(q for q in shared["questions"] if q["kind"] == "scale")
    q_yesno = next(q for q in shared["questions"] if q["kind"] == "yesno")
    t1, t2 = [r["token"] for r in shared["recipients"]]

    r = _answer(client, t1, {f"q_{q_scale['id']}": "4", f"q_{q_yesno['id']}": "yes"},
                comment="Confident on the build; the vendor quote is the one open piece.")
    assert r.status_code == 200

    mid = client.get(f"/ask/{ask['id']}", headers={"X-Avery-Token": tok}).json()
    assert mid["status"] == "collecting"
    answered = [r for r in mid["recipients"] if r.get("receipt")]
    assert len(answered) == 1
    receipt = answered[0]["receipt"]
    assert {a["question_id"]: a["value"] for a in receipt["answers"]} == \
           {q_scale["id"]: 4, q_yesno["id"]: True}
    assert receipt["comment"].startswith("Confident on the build")
    assert receipt["answered_at"]
    assert mid.get("receipts_summary") is None, "summary only when ALL replies are in"

    r = _answer(client, t2, {f"q_{q_scale['id']}": "3", f"q_{q_yesno['id']}": "no"})
    assert r.status_code == 200
    done = client.get(f"/ask/{ask['id']}", headers={"X-Avery-Token": tok}).json()
    assert done["status"] == "closed"
    assert all(r.get("receipt") for r in done["recipients"])
    # multi-recipient, all-in -> a QUALITATIVE summary exists, passes the red line, and pairs
    # no recipient name with a number (ADR-0023 boundary 3)
    summary = done.get("receipts_summary")
    assert summary and isinstance(summary, str)
    from avery import redline
    assert redline.validate(summary).passed
    for name in ("Lena Park", "Marcus Reid"):
        assert not re.search(re.escape(name) + r"[^\n]{0,40}\d", summary), \
            "the summary must never pair a person with a number"


def test_single_recipient_has_no_summary(client):
    cid, tok = _ingest(client)
    ask = _create(client, cid, tok, recipients=[{"id": "p1", "name": "Lena Park"}])
    shared = _share(client, ask["id"], tok)
    t1 = shared["recipients"][0]["token"]
    qids = {q["kind"]: q["id"] for q in shared["questions"]}
    _answer(client, t1, {f"q_{qids['scale']}": "5", f"q_{qids['yesno']}": "yes"})
    done = client.get(f"/ask/{ask['id']}", headers={"X-Avery-Token": tok}).json()
    assert done["status"] == "closed"
    assert done.get("receipts_summary") is None, \
        "single receipt = verbatim voice, no aggregate paraphrase"


def test_revoke_lifecycle(client):
    cid, tok = _ingest(client)
    ask = _create(client, cid, tok)
    shared = _share(client, ask["id"], tok)
    t1 = shared["recipients"][0]["token"]

    r = client.post(f"/ask/{ask['id']}/revoke", headers={"X-Avery-Token": tok})
    assert r.status_code == 200 and r.json()["status"] == "revoked"
    # idempotent
    r = client.post(f"/ask/{ask['id']}/revoke", headers={"X-Avery-Token": tok})
    assert r.status_code == 200 and r.json()["status"] == "revoked"
    # a revoked link answers no more
    r = _answer(client, t1, {})
    assert r.status_code == 410
    # share after revoke is refused
    r = client.post(f"/ask/{ask['id']}/share", headers={"X-Avery-Token": tok})
    assert r.status_code == 409


def test_revoking_a_closed_ask_is_refused(client):
    cid, tok = _ingest(client)
    ask = _create(client, cid, tok, recipients=[{"id": "p1", "name": "Lena Park"}])
    shared = _share(client, ask["id"], tok)
    t1 = shared["recipients"][0]["token"]
    qids = {q["kind"]: q["id"] for q in shared["questions"]}
    _answer(client, t1, {f"q_{qids['scale']}": "4", f"q_{qids['yesno']}": "yes"})
    r = client.post(f"/ask/{ask['id']}/revoke", headers={"X-Avery-Token": tok})
    assert r.status_code == 409, "the evidence is in — a closed ask cannot be un-happened"


def test_expiry_derives_expired_status(client):
    cid, tok = _ingest(client)
    ask = _create(client, cid, tok)
    _share(client, ask["id"], tok)
    # backdate the stored expiry (server-side truth), then read: the STATUS must say expired
    from avery.ingest.registry import active_registry
    reg = active_registry()
    stored = reg.get_ask(ask["id"])
    stored.expires_at = "2026-07-01T00:00:00+00:00"
    reg.put_ask(stored)
    got = client.get(f"/ask/{ask['id']}", headers={"X-Avery-Token": tok}).json()
    assert got["status"] == "expired"
    # an expired ask cannot be shared again
    r = client.post(f"/ask/{ask['id']}/share", headers={"X-Avery-Token": tok})
    assert r.status_code == 409


# ==============================================================================================
# 7) feat-039 hard gates on the new surfaces (env-configured, default off)
# ==============================================================================================

def test_ask_rate_limit_429(client, monkeypatch):
    from service import upload_guard
    monkeypatch.setenv("AVERY_RATE_ASK_PER_MIN", "2")
    monkeypatch.setenv("AVERY_RATE_ASK_BURST", "2")
    upload_guard.reset_rate_limiter()
    cid, tok = _ingest(client)
    assert client.post("/ask", json=_draft_body(cid), headers={"X-Avery-Token": tok}).status_code == 200
    assert client.post("/ask", json=_draft_body(cid), headers={"X-Avery-Token": tok}).status_code == 200
    r = client.post("/ask", json=_draft_body(cid), headers={"X-Avery-Token": tok})
    assert r.status_code == 429, "the third rapid /ask must be rate-limited"
    upload_guard.reset_rate_limiter()


def test_share_page_rate_limit_429(client, monkeypatch):
    from service import upload_guard
    cid, tok = _ingest(client)
    ask = _create(client, cid, tok)
    shared = _share(client, ask["id"], tok)
    t1 = shared["recipients"][0]["token"]
    monkeypatch.setenv("AVERY_RATE_SHARE_PER_MIN", "2")
    monkeypatch.setenv("AVERY_RATE_SHARE_BURST", "2")
    upload_guard.reset_rate_limiter()
    assert client.get(f"/r/{t1}").status_code == 200
    assert client.get(f"/r/{t1}").status_code == 200
    r = client.get(f"/r/{t1}")
    assert r.status_code == 429, "the employee H5 must ride the same edge rate limiter"
    upload_guard.reset_rate_limiter()


# ==============================================================================================
# 8) @needs_db — tenant isolation over the REAL DB path (B's owner_token reads A's ask -> 404)
# ==============================================================================================

@pytest.mark.needs_db
def test_pg_b_token_cannot_read_a_ask(monkeypatch, tmp_path):
    import os
    url = (os.environ.get("AVERY_DB_URL") or os.environ.get("PGVECTOR_URL") or "").strip()
    if not url:
        pytest.skip("needs AVERY_DB_URL (or PGVECTOR_URL) — DB-backed isolation skipped")
    pytest.importorskip("psycopg")
    monkeypatch.setenv("AVERY_BRAIN", "mock")
    monkeypatch.setenv("AVERY_EXTRACTOR", "heuristic")
    monkeypatch.setenv("AVERY_DATA_DIR", str(tmp_path / "data"))
    from service.app import app
    created: list[str] = []
    try:
        with TestClient(app) as c:
            files = [("files", (HANDBOOK.name, HANDBOOK.read_bytes(), "application/octet-stream"))]
            a = c.post("/ingest", files=files).json()
            b = c.post("/ingest", files=files).json()
            created += [a["context_id"], b["context_id"]]
            ask = c.post("/ask", json=_draft_body(a["context_id"]),
                         headers={"X-Avery-Token": a["owner_token"]}).json()
            ok = c.get(f"/ask/{ask['id']}", headers={"X-Avery-Token": a["owner_token"]})
            assert ok.status_code == 200
            crossed = c.get(f"/ask/{ask['id']}", headers={"X-Avery-Token": b["owner_token"]})
            assert crossed.status_code == 404, "B's owner_token read A's ask — tenant isolation broken"
            assert crossed.json()["detail"].startswith("unknown ask id")
    finally:
        from avery.ingest.pg_registry import PostgresContextRegistry
        reg = PostgresContextRegistry(url)
        for cid in created:
            reg.delete(cid)
