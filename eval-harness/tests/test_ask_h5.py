# -*- coding: utf-8 -*-
"""feat-034 stage C — the employee H5 (`GET /r/{token}` + `POST /r/{token}/answer`), fully offline.

The employee-facing face of the Ask loop: a server-rendered, no-SPA, mobile-first single page.
Contract (PRD Q5/Q6/Q8 + ADR-0023 transparency):
  * per-link OG meta (og:title = the question lead, og:description = the transparent what-this-is);
  * the transparency triple IN THE DOM: who is asking / what it is about / who sees the answer
    (the moral ground the feature stands on — the employee KNOWS);
  * big-button inputs: 1..5 radios per scale question, yes/no per yesno, an optional one-line
    comment, one submit — ZH by default (the recipient's home turf), `?lang=en` flips to EN;
  * ZERO external resources (works inside every IM webview, nothing to block or track);
  * answer-once: the second submit is 409 and the first answer stays;
  * status pages: answered -> locked page; revoked -> 410; expired -> loud 404; unknown token ->
    loud 404 (feat-028 discipline, no fallback rendering);
  * 🔴 zero cross-person leakage: the page renders THIS recipient only — the other recipients'
    names/answers never appear (one-person-one-link, Q4).
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


@pytest.fixture()
def client(monkeypatch):
    monkeypatch.setenv("AVERY_BRAIN", "mock")
    monkeypatch.setenv("AVERY_EXTRACTOR", "heuristic")
    monkeypatch.delenv("AVERY_DB_URL", raising=False)
    monkeypatch.delenv("PGVECTOR_URL", raising=False)
    monkeypatch.delenv("AVERY_ALLOW_PERSON_SCORING", raising=False)
    monkeypatch.delenv("AVERY_RATE_SHARE_PER_MIN", raising=False)
    from avery.ingest.registry import REGISTRY
    REGISTRY.clear()
    from service import upload_guard
    upload_guard.reset_rate_limiter()
    from service.app import app
    with TestClient(app) as c:
        yield c
    REGISTRY.clear()


def _shared_ask(client, recipients=None):
    files = [("files", (HANDBOOK.name, HANDBOOK.read_bytes(), "application/octet-stream"))]
    ing = client.post("/ingest", files=files).json()
    cid, tok = ing["context_id"], ing["owner_token"]
    body = {
        "company_context_id": cid,
        "questions": [
            {"kind": "scale",
             "text": "How confident are you that the pilot launch lands on the current date?"},
            {"kind": "yesno", "text": "Do you have everything you need to hold that date?"},
        ],
        "recipients": recipients or [{"id": "p1", "name": "Lena Park"},
                                     {"id": "p2", "name": "Marcus Reid"}],
        "comment_prompt": "Anything to add, in one line?",
        "thread_hint": "the pilot launch date",
    }
    ask = client.post("/ask", json=body, headers={"X-Avery-Token": tok}).json()
    shared = client.post(f"/ask/{ask['id']}/share", headers={"X-Avery-Token": tok}).json()
    return cid, tok, shared


def _qids(shared):
    return {q["kind"]: q["id"] for q in shared["questions"]}


# ==============================================================================================
# 1) the answer page — OG, transparency triple, big buttons, ZH default / EN switch
# ==============================================================================================

def test_answer_page_renders_og_and_transparency_zh_default(client):
    cid, tok, shared = _shared_ask(client)
    t1 = shared["recipients"][0]["token"]
    r = client.get(f"/r/{t1}")
    assert r.status_code == 200
    assert "text/html" in r.headers["content-type"]
    html = r.text

    # per-link OG meta, inside the head (Slack wants tags in the first 32KB — ours is one page)
    m = re.search(r'<meta property="og:title" content="([^"]+)"', html)
    assert m, "og:title missing"
    assert "pilot launch" in m.group(1), "og:title must carry the question lead"
    assert re.search(r'<meta property="og:description" content="[^"]+"', html)

    # the transparency triple — machine-assertable classes, not just copy
    for cls in ("h5-who", "h5-what", "h5-visibility"):
        assert f'class="{cls}"' in html, f"transparency element .{cls} missing"
    # ZH default: the three labels speak Chinese
    for marker in ("谁在问", "问的什么", "谁看"):
        assert marker in html, f"ZH transparency label {marker!r} missing (ZH is the default)"

    # big buttons: five scale radios + yes/no radios + the optional comment + one submit
    qids = _qids(shared)
    scale_inputs = re.findall(rf'name="q_{qids["scale"]}" value="([1-5])"', html)
    assert sorted(scale_inputs) == ["1", "2", "3", "4", "5"]
    yn_inputs = re.findall(rf'name="q_{qids["yesno"]}" value="(yes|no)"', html)
    assert sorted(yn_inputs) == ["no", "yes"]
    assert 'name="comment"' in html
    assert "<form" in html and 'method="post"' in html

    # this recipient only — the OTHER recipient must never be on this page
    assert "Lena Park" in html
    assert "Marcus Reid" not in html, "cross-person leakage: another recipient rendered"

    # zero external resources: no external stylesheet/script/img/font
    assert not re.search(r'<(?:script|link|img)[^>]+(?:src|href)="https?://', html), \
        "the H5 must be self-contained (IM webviews, nothing external)"


def test_answer_page_lang_en_switch(client):
    cid, tok, shared = _shared_ask(client)
    t1 = shared["recipients"][0]["token"]
    html = client.get(f"/r/{t1}?lang=en").text
    assert "Who is asking" in html
    assert "谁在问" not in html


def test_unknown_token_is_a_loud_404(client):
    _shared_ask(client)
    r = client.get("/r/tok_never_minted_anywhere")
    assert r.status_code == 404
    r = client.post("/r/tok_never_minted_anywhere/answer", data={})
    assert r.status_code == 404


# ==============================================================================================
# 2) answer-once — submit, lock, 409 on the second try
# ==============================================================================================

def test_answer_then_locked_then_409(client):
    cid, tok, shared = _shared_ask(client)
    t1 = shared["recipients"][0]["token"]
    qids = _qids(shared)

    r = client.post(f"/r/{t1}/answer", data={
        f"q_{qids['scale']}": "4", f"q_{qids['yesno']}": "yes",
        "comment": "Confident on the build itself."})
    assert r.status_code == 200
    assert "已提交" in r.text or "已收到" in r.text

    # the GET now shows the locked "you already answered" page, not the form again
    locked = client.get(f"/r/{t1}")
    assert locked.status_code == 200
    assert "你已答过" in locked.text
    assert "<form" not in locked.text.split("</header>")[-1] or 'method="post"' not in locked.text, \
        "an answered link must not offer the form again"

    # answer-once: the second submit is 409 and does not overwrite
    r2 = client.post(f"/r/{t1}/answer", data={
        f"q_{qids['scale']}": "1", f"q_{qids['yesno']}": "no"})
    assert r2.status_code == 409
    assert "你已答过" in r2.text
    got = client.get(f"/ask/{shared['id']}", headers={"X-Avery-Token": tok}).json()
    receipt = next(rr["receipt"] for rr in got["recipients"] if rr.get("receipt"))
    assert {a["question_id"]: a["value"] for a in receipt["answers"]} == \
           {qids["scale"]: 4, qids["yesno"]: True}


def test_answer_validation_rejects_bad_values(client):
    cid, tok, shared = _shared_ask(client)
    t1 = shared["recipients"][0]["token"]
    qids = _qids(shared)
    # out-of-scale value
    r = client.post(f"/r/{t1}/answer", data={f"q_{qids['scale']}": "99",
                                             f"q_{qids['yesno']}": "yes"})
    assert r.status_code == 422
    # missing an answer
    r = client.post(f"/r/{t1}/answer", data={f"q_{qids['scale']}": "3"})
    assert r.status_code == 422
    # nothing landed — the link is still answerable
    assert "你已答过" not in client.get(f"/r/{t1}").text


# ==============================================================================================
# 3) status pages — revoked (410) / expired (404)
# ==============================================================================================

def test_revoked_link_shows_the_revoked_page(client):
    cid, tok, shared = _shared_ask(client)
    t1 = shared["recipients"][0]["token"]
    client.post(f"/ask/{shared['id']}/revoke", headers={"X-Avery-Token": tok})
    r = client.get(f"/r/{t1}")
    assert r.status_code == 410
    assert "已撤回" in r.text
    r = client.post(f"/r/{t1}/answer", data={})
    assert r.status_code == 410


def test_expired_link_is_a_loud_404_with_expired_copy(client):
    cid, tok, shared = _shared_ask(client)
    t1 = shared["recipients"][0]["token"]
    from avery.ingest.registry import active_registry
    reg = active_registry()
    stored = reg.get_ask(shared["id"])
    stored.expires_at = "2026-07-01T00:00:00+00:00"
    reg.put_ask(stored)
    r = client.get(f"/r/{t1}")
    assert r.status_code == 404
    assert "已过期" in r.text
    r = client.post(f"/r/{t1}/answer", data={})
    assert r.status_code == 404


# ==============================================================================================
# 4) hygiene — question text is HTML-escaped (manager text is untrusted on the employee page)
# ==============================================================================================

def test_question_text_is_html_escaped(client):
    files = [("files", (HANDBOOK.name, HANDBOOK.read_bytes(), "application/octet-stream"))]
    ing = client.post("/ingest", files=files).json()
    cid, tok = ing["context_id"], ing["owner_token"]
    body = {
        "company_context_id": cid,
        "questions": [{"kind": "yesno",
                       "text": 'Is the <script>alert(1)</script> "quote" signed & sealed?'}],
        "recipients": [{"id": "p1", "name": "Lena Park"}],
    }
    ask = client.post("/ask", json=body, headers={"X-Avery-Token": tok}).json()
    shared = client.post(f"/ask/{ask['id']}/share", headers={"X-Avery-Token": tok}).json()
    html = client.get(f"/r/{shared['recipients'][0]['token']}").text
    assert "<script>alert(1)</script>" not in html, "manager text must be escaped on the H5"
    assert "&lt;script&gt;" in html
