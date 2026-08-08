# -*- coding: utf-8 -*-
"""#72 · 建议追问（followup_questions）后端半边。

本文件钉死的（每条对应回执里的变异台账）：

  service（POST /advise，mock 罐头）：
    * advice 路 manifest 的 advice payload 带 followup_questions == 罐头 2 条；
    * 短答路（answer_kind='answer'）的 answer payload 同样带——两条出口都要有；
    * locale=zh 时罐头是中文那对（离线电池只有 mock，罐头不双语则 zh 判据采不到样）；
    * 罐头本身逐条过红线（自证：门语料真的是干净的，不是"没人验过"）。

  contract（投影层，直接驱动——判据不依赖 mock 罐头）：
    * 旧契约兼容：transcript 不带 followup_questions 键 ⇒ payload 不带键、契约照常通过
      （absent≠[]，与其余可选字段同纪律）；
    * 红线逐条过滤：造一条违规建议问题（人评分）⇒ 被滤掉，干净的留下，**整次建议不失败**
      ——一条坏 chip 的失败模式是"少一个 chip"，不是"整张判读卡不发"；
    * 封顶 3 条；非字符串条目丢弃（形状归一在投影层独立成立，不依赖工具层先洗过一遍）。

⚠ 违规问题语料先自证真的过不了红线（redline.validate 直接红）再进过滤判据——
「门语料不能复现病根＝整段判据空跑」（#70 碑）。
"""
from __future__ import annotations

import pytest

fastapi_testclient = pytest.importorskip("fastapi.testclient")
from fastapi.testclient import TestClient  # noqa: E402

from avery import redline  # noqa: E402
from service import contract  # noqa: E402
from service.live_input import (  # noqa: E402
    _MOCK_FOLLOWUPS_ADVICE,
    _MOCK_FOLLOWUPS_ANSWER,
)


@pytest.fixture()
def client(monkeypatch):
    monkeypatch.setenv("AVERY_BRAIN", "mock")
    monkeypatch.delenv("AVERY_DB_URL", raising=False)
    monkeypatch.delenv("PGVECTOR_URL", raising=False)
    from service.app import app
    return TestClient(app)


JUDGMENT_Q = "The team has been unusually quiet lately — how should I approach it?"
FACTUAL_Q = "When is the pilot launch?"


def _advise(client, situation, **extra):
    return client.post("/advise", json={"situation": situation, "stream": False, **extra})


# ── service · mock 罐头走通两条出口 ───────────────────────────────────────────────────────────

def test_advice_manifest_carries_canned_followups(client):
    r = _advise(client, JUDGMENT_Q)
    assert r.status_code == 200
    body = r.json()
    assert body.get("answer_kind") == "advice"
    followups = (body.get("advice") or {}).get("followup_questions")
    assert followups == _MOCK_FOLLOWUPS_ADVICE["en"]
    # 自证：罐头逐条真的过红线（canned 也一视同仁，不是"没人验过的语料"）。
    for q in followups:
        assert redline.validate(q).passed, f"canned followup crosses the red line: {q}"


def test_answer_manifest_carries_canned_followups(client):
    """短答路今天零动作按钮——追问 chips 两条出口都要有（票面原文）。"""
    r = _advise(client, FACTUAL_Q)
    assert r.status_code == 200
    body = r.json()
    assert body.get("answer_kind") == "answer", "自证：这条语料真的走了短答出口"
    followups = (body.get("answer") or {}).get("followup_questions")
    assert followups == _MOCK_FOLLOWUPS_ANSWER["en"]


def test_zh_locale_gets_zh_canned_followups(client):
    r = _advise(client, "团队最近有点安静，我该怎么开口？", locale="zh")
    assert r.status_code == 200
    followups = (r.json().get("advice") or {}).get("followup_questions")
    assert followups == _MOCK_FOLLOWUPS_ADVICE["zh"]


# ── contract · 投影层独立判据（不依赖 mock 罐头）──────────────────────────────────────────────

_CLEAN_ADVICE_TRANSCRIPT = {
    "advice": {
        "read": "The handoff stalled because nobody owns the vendor follow-up.",
        "move": "Name one owner this week and set a check-in date.",
        "framing": "Open with what you observed about the work, then ask what is going on.",
    },
    "cites": [{"claim": "handoff stalled", "source_ref": "facts.md:15",
               "snippet": "status updates late", "resolved": True}],
    "gates": {"cite_gate_passed": True, "artifact_gate_passed": True},
}

CLEAN_FOLLOWUP = "How should I open that conversation?"
# 人评分问法——与 test_service_contract 里已知能踩 PERSON-SCORE 的形状同族。
VIOLATING_FOLLOWUP = "Should I rate him 2/5 on reliability next quarter?"


def test_violating_followup_corpus_actually_trips_redline():
    """自证判据（#70 碑）：这条语料真的能让红线红——否则下面的过滤判据整段空跑。"""
    assert not redline.validate(VIOLATING_FOLLOWUP).passed


def test_contract_without_followup_slot_is_unchanged():
    res = contract.enforce(dict(_CLEAN_ADVICE_TRANSCRIPT), ["status updates late"])
    assert res.ok
    assert "followup_questions" not in res.payload, "absent≠[]：没带槽就不该有键"


def test_redline_filters_violating_followup_but_keeps_the_advice():
    transcript = {**_CLEAN_ADVICE_TRANSCRIPT,
                  "followup_questions": [CLEAN_FOLLOWUP, VIOLATING_FOLLOWUP]}
    res = contract.enforce(transcript, ["status updates late"])
    assert res.ok, "一条违规追问的失败模式是'少一个 chip'，不是整张判读卡不发"
    assert res.payload.get("followup_questions") == [CLEAN_FOLLOWUP]


def test_answer_path_filters_violating_followup_too():
    transcript = {
        "answer": "The pilot launches on May 6.",
        "cites": [{"claim": "launch date", "source_ref": "facts.md:3",
                   "snippet": "pilot launches May 6", "resolved": True}],
        "followup_questions": [VIOLATING_FOLLOWUP, CLEAN_FOLLOWUP],
    }
    res = contract.enforce_answer(transcript, ["pilot launches May 6"])
    assert res.ok
    assert res.payload.get("followup_questions") == [CLEAN_FOLLOWUP]


def test_all_followups_violating_means_no_key():
    transcript = {**_CLEAN_ADVICE_TRANSCRIPT, "followup_questions": [VIOLATING_FOLLOWUP]}
    res = contract.enforce(transcript, ["status updates late"])
    assert res.ok
    assert "followup_questions" not in res.payload, "全滤光=没键，不发空数组"


def test_followups_capped_at_three():
    many = [f"What should I check next, part {i}?" for i in range(5)]
    transcript = {**_CLEAN_ADVICE_TRANSCRIPT, "followup_questions": many}
    res = contract.enforce(transcript, ["status updates late"])
    assert res.payload.get("followup_questions") == many[:3]


def test_non_string_entries_are_dropped_at_the_projection():
    transcript = {**_CLEAN_ADVICE_TRANSCRIPT,
                  "followup_questions": [42, {"q": "not a string"}, "  ", CLEAN_FOLLOWUP]}
    res = contract.enforce(transcript, ["status updates late"])
    assert res.payload.get("followup_questions") == [CLEAN_FOLLOWUP]


def test_followup_questions_is_a_known_optional_field():
    """契约字段表登记（test_service_contract 的 known-fields 判据靠这份表；漏登记=payload
    带键即红）。"""
    assert "followup_questions" in contract.OPTIONAL_FIELDS
