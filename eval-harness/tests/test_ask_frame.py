# -*- coding: utf-8 -*-
"""feat-034 stage C — the `manifest{kind:'ask-draft'}` SSE frame, injected at the SERVICE layer.

🔴 Placement is the point: the frame is appended in app.py's SSE assembly AFTER the engine's own
terminal manifest — the FROZEN advisor engine (loop/engine/tools/redline) is untouched. The frontend
already treats a missing `kind` as 'advice' (zero breakage) and adopts an 'ask-draft' frame into the
AskCard.

Heuristic (deterministic, honest — never force a card):
  * the situation names at least one ROSTER person (full-name hit against the ingested context's
    people) -> ONE ask-draft frame after the advice manifest, recipients = the matched people;
  * no roster name in the situation -> NO frame (don't invent a "who to ask");
  * no company_context_id -> NO frame (the demo company is not a roster).

The draft's questions are server-generated (template under mock/keyless — honestly labeled) and
every question passed the two-tier red-line gate BEFORE the frame goes out the door.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

pytest.importorskip("fastapi.testclient")
from fastapi.testclient import TestClient  # noqa: E402

HERE = Path(__file__).resolve().parent.parent
FIX = HERE / "tests" / "fixtures" / "ingest"
HANDBOOK = FIX / "Studio_Handbook.md"
ROSTER = FIX / "Team_Roster.xlsx"


@pytest.fixture()
def client(monkeypatch):
    monkeypatch.setenv("AVERY_BRAIN", "mock")
    monkeypatch.setenv("AVERY_EXTRACTOR", "heuristic")
    monkeypatch.delenv("AVERY_DB_URL", raising=False)
    monkeypatch.delenv("PGVECTOR_URL", raising=False)
    from avery.ingest.registry import REGISTRY
    REGISTRY.clear()
    from service.app import app
    with TestClient(app) as c:
        yield c
    REGISTRY.clear()


def _ingest(client):
    files = [("files", (p.name, p.read_bytes(), "application/octet-stream"))
             for p in (HANDBOOK, ROSTER)]
    body = client.post("/ingest", files=files).json()
    return body["context_id"], body["owner_token"]


def _sse_events(text: str) -> list[dict]:
    events = []
    for record in text.replace("\r\n", "\n").split("\n\n"):
        for line in record.split("\n"):
            if line.startswith("data:"):
                try:
                    events.append(json.loads(line[5:].strip()))
                except json.JSONDecodeError:
                    pass
    return events


def test_roster_name_hit_appends_one_ask_draft_frame(client):
    cid, tok = _ingest(client)
    r = client.post("/advise", json={
        "situation": "Can Marcus Reid own the vendor negotiation for the pilot?",
        "company_context_id": cid, "stream": True},
        headers={"X-Avery-Token": tok})
    assert r.status_code == 200
    events = _sse_events(r.text)

    advice = [e for e in events if e.get("type") == "manifest" and e.get("kind") in (None, "advice")]
    frames = [e for e in events if e.get("type") == "manifest" and e.get("kind") == "ask-draft"]
    assert len(advice) == 1, "the engine's own terminal manifest must still be there, exactly once"
    assert len(frames) == 1, "a roster-name situation must draft exactly ONE quick ask"
    # order: the ask-draft frame comes AFTER the advice manifest (the run completes on advice)
    assert events.index(frames[0]) > events.index(advice[0])

    ask = frames[0]["ask"]
    assert ask["id"].startswith("ask_")
    assert ask["status"] == "draft"
    assert ask["company_context_id"] == cid
    assert 1 <= len(ask["questions"]) <= 3
    assert all(q["kind"] in ("scale", "yesno") and q["text"].strip() for q in ask["questions"])
    # the matched roster person is preselected — this is WHY the card is offered
    assert [rec["name"] for rec in ask["recipients"]] == ["Marcus Reid"]
    assert all(rec.get("id") for rec in ask["recipients"])
    # every question crossed the gate BEFORE going out the door
    from avery import redline
    for q in ask["questions"]:
        assert redline.validate(q["text"]).passed, f"frame question crossed the red line: {q['text']}"
    # honest generation labeling (mock/keyless run -> template)
    assert ask.get("generation_mode") == "template"


def test_no_roster_name_no_frame(client):
    cid, tok = _ingest(client)
    r = client.post("/advise", json={
        "situation": "How is the studio pacing against the roadmap this quarter?",
        "company_context_id": cid, "stream": True},
        headers={"X-Avery-Token": tok})
    assert r.status_code == 200
    events = _sse_events(r.text)
    frames = [e for e in events if e.get("type") == "manifest" and e.get("kind") == "ask-draft"]
    assert frames == [], "no roster name -> no ask-draft frame (honesty: don't invent recipients)"


def test_no_context_no_frame(client):
    r = client.post("/advise", json={
        "situation": "Can Marcus Reid own the vendor negotiation?", "stream": True})
    assert r.status_code == 200
    events = _sse_events(r.text)
    frames = [e for e in events if e.get("type") == "manifest" and e.get("kind") == "ask-draft"]
    assert frames == [], "no company context -> no roster -> no frame"


# ── #72 · 触发收敛：词边界 + 「短答终局不弹卡」两头都要有用例 ─────────────────────────────
# 太宽=假红、太松=对着坏行为全绿——「该出仍出」由上面 test_roster_name_hit_* 钉着，
# 下面钉「不该弹」的两种形态，各配各的变异（回执台账）：
#   * 恢复裸子串（`p.name.lower() in hay`）→ test_name_inside_longer_word_no_frame 红；
#   * 拆掉 answer_kind 语义闸 → test_factual_lookup_naming_roster_person_no_frame 红。

def test_factual_lookup_naming_roster_person_no_frame(client):
    """提到人名但明显无需问卷：事实查询（短答终局）已经把事实从记录里直接读出来了——
    没有什么需要向谁发问卷核实的。此前短答后照样弹卡，是「一直弹」的另一半病根。"""
    cid, tok = _ingest(client)
    r = client.post("/advise", json={
        "situation": "When does Marcus Reid's vendor negotiation wrap up?",
        "company_context_id": cid, "stream": True},
        headers={"X-Avery-Token": tok})
    assert r.status_code == 200
    events = _sse_events(r.text)
    # 自证：这条语料真的走了短答出口（否则本判据验的就不是语义闸，而是别的什么）。
    answers = [e for e in events if e.get("type") == "manifest"
               and e.get("answer_kind") == "answer"]
    assert answers, "corpus must actually route to answer_direct for this test to bite"
    frames = [e for e in events if e.get("type") == "manifest" and e.get("kind") == "ask-draft"]
    assert frames == [], "a factual lookup answered from the record must NOT draft a quick ask"


def test_name_inside_longer_word_no_frame(client):
    """词边界：'Marcus Reid' 是 'Marcus Reidenbach' 的前缀——裸子串必中（16 人花名册下
    这正是「一直弹」的机制），词边界匹配下 'd' 后面紧贴着拉丁字母 'e'，不算命中。"""
    cid, tok = _ingest(client)
    r = client.post("/advise", json={
        "situation": "We just hired Marcus Reidenbach for the studio — how should I "
                     "help him settle in?",
        "company_context_id": cid, "stream": True},
        headers={"X-Avery-Token": tok})
    assert r.status_code == 200
    events = _sse_events(r.text)
    # 自证：这条语料走的是 advice 终局（语义闸不背这条判据的书——红只能红在词边界上）。
    advice = [e for e in events if e.get("type") == "manifest" and e.get("kind") in (None, "advice")
              and e.get("answer_kind") != "answer"]
    assert advice, "corpus must route to the advice terminal so only the boundary rule decides"
    frames = [e for e in events if e.get("type") == "manifest" and e.get("kind") == "ask-draft"]
    assert frames == [], "a roster name embedded in a longer word must NOT trigger the card"


# ── #72 · _name_mentioned 的纯函数判据（中文语料必须真进来——门语料全 ASCII 盲点碑）────────

def test_name_mentioned_word_boundary_matrix():
    from service.ask_api import _name_mentioned

    # 中文：无空格连写是常态，CJK 邻接不阻断（裸抄英文 \b 会把这些全杀掉——反向病根）。
    assert _name_mentioned("小王", "问一下小王这周的排班情况")
    assert _name_mentioned("周雅婷", "周雅婷负责的别墅套餐推广卡住了")
    assert _name_mentioned("小王", "小王")
    # 英文：词边界起步——长词的一截不算提到人。
    assert _name_mentioned("Marcus Reid", "Can Marcus Reid own the vendor negotiation?")
    assert _name_mentioned("marcus reid", "MARCUS REID is on leave this week")
    assert not _name_mentioned("Marcus Reid", "We hired Marcus Reidenbach yesterday")
    assert not _name_mentioned("Li", "the list of open items keeps growing")
    assert not _name_mentioned("Ann", "planning the launch for next week")
    assert _name_mentioned("Li", "ask Li about the schedule")
    # 同一句里先撞一次假命中、后面还有真命中——按出现逐个判，不是首处即中止（verifiers-that-lie）。
    assert _name_mentioned("Li", "the list is long, but Li owns it")
    # 中英混排：中文名后面紧跟拉丁字母不阻断（名字的边是汉字，不是拉丁词的一截）。
    assert _name_mentioned("小王", "小王owner是谁定的")
    assert not _name_mentioned("", "anything")


def test_buffered_advise_still_picks_the_advice_manifest(client):
    """The buffered (stream=false) body must keep being built from the ADVICE manifest even when an
    ask-draft frame follows it in the event list (regression guard on the reversed() scan)."""
    cid, tok = _ingest(client)
    r = client.post("/advise", json={
        "situation": "Can Marcus Reid own the vendor negotiation for the pilot?",
        "company_context_id": cid, "stream": False},
        headers={"X-Avery-Token": tok})
    assert r.status_code == 200
    body = r.json()
    assert "advice" in body and body.get("kind") in (None, "advice"), \
        "the buffered manifest must be the ADVICE one, not the ask-draft frame"
    frames = [e for e in body.get("events", [])
              if e.get("type") == "manifest" and e.get("kind") == "ask-draft"]
    assert len(frames) == 1, "the buffered event list carries the frame too (one consistent contract)"
