"""#71 · 议事室会话流的后端半边——`history` 是 additive optional，追问带得上上下文。

本文件钉死的（每条对应回执里的变异台账）：

  unit（service/history.py）：
    * 轮数超配额丢**最早**的，并在留下的第一轮上留 `[earlier turns omitted]` 标记；
    * 单项字数超配额截断，并留 `…[truncated]` 标记；
    * 整块字数还有最后一道闸，同样从最早的一轮开始丢；
    * 半截的一轮（只有问 / 只有答）整轮不进——宁可少一轮，也不让模型去圆一个它没看见的答案；
    * dict 与对象两种入参都吃，畸形条目降级成"这一轮不贡献"，不抛。

  service（POST /advise）：
    * history 落成开场轮**之前**的 user/assistant 真轮次——判据落在 spy brain 真收到的那份
      conversation 上（模型真看见了才算，不是"请求体里有这个键"）；
    * 不带 history 时 conversation 与 #71 之前**逐字节相同**（就一条开场轮）；
    * history 与 #64 的 @ 引用共存：历史轮在前，引用块仍在开场轮里；
    * 畸形 history 不 422/500 掉一次提问（同 references 的 D11 纪律）；
    * `started.prompt` 仍是 manager 自己的话；
    * **history 不进 case 正文**——read_case 的观察里一个字都不该有它（历史是对话不是材料，
      写进 case 等于把上一轮的回答伪装成一份公司资料，recall/cite 会在上面引出处）。

⚠ MockBrain 完全不看 conversation（brain.py::MockBrain.respond 只走自己的 plan），所以
「prompt 真的组装对了」这件事**只能**在 brain seam 上用 spy 断言——把判据落在 mock 的输出上
是采不到样的空跑。
"""
from __future__ import annotations

import pytest

fastapi_testclient = pytest.importorskip("fastapi.testclient")
from fastapi.testclient import TestClient  # noqa: E402

from avery.brain import BrainResponse  # noqa: E402
from service.history import (  # noqa: E402
    DROPPED_MARK,
    HISTORY_MAX_ANSWER_CHARS,
    HISTORY_MAX_QUESTION_CHARS,
    HISTORY_MAX_TOTAL_CHARS,
    HISTORY_MAX_TURNS,
    TRUNCATION_MARK,
    history_conversation_turns,
    normalize_history,
)


def _turns(n: int, *, q: str = "第{i}问", a: str = "第{i}答") -> list[dict]:
    return [{"question": q.format(i=i), "answer": a.format(i=i)} for i in range(n)]


# ── unit · 配额 ───────────────────────────────────────────────────────────────────────────────

def test_absent_history_is_empty_history():
    assert normalize_history(None) == []
    assert normalize_history([]) == []
    assert history_conversation_turns(None) == []


def test_turn_count_cap_keeps_the_most_recent_and_marks_the_drop():
    out = normalize_history(_turns(HISTORY_MAX_TURNS + 3))
    assert len(out) == HISTORY_MAX_TURNS
    # 留的是最近的那几轮——追问要解析的指代几乎总是指最近说的。
    assert out[-1]["question"] == f"第{HISTORY_MAX_TURNS + 2}问"
    # 且模型被明确告知"这不是对话的开头"。
    assert out[0]["question"].startswith(DROPPED_MARK)
    assert "第3问" in out[0]["question"]


def test_no_drop_mark_when_everything_fits():
    out = normalize_history(_turns(2))
    assert len(out) == 2
    assert DROPPED_MARK not in out[0]["question"]
    assert TRUNCATION_MARK not in out[0]["answer"]


def test_over_long_fields_are_truncated_with_a_visible_mark():
    long_q = "问" * (HISTORY_MAX_QUESTION_CHARS + 50)
    long_a = "答" * (HISTORY_MAX_ANSWER_CHARS + 50)
    out = normalize_history([{"question": long_q, "answer": long_a}])
    assert len(out) == 1
    assert out[0]["question"].endswith(TRUNCATION_MARK)
    assert out[0]["answer"].endswith(TRUNCATION_MARK)
    assert len(out[0]["question"]) == HISTORY_MAX_QUESTION_CHARS + len(TRUNCATION_MARK)
    assert len(out[0]["answer"]) == HISTORY_MAX_ANSWER_CHARS + len(TRUNCATION_MARK)


def test_total_char_ceiling_drops_oldest_until_it_fits():
    # 每轮都在单项配额内，但四轮加起来必然撞整块闸。
    fat = [{"question": "问" * HISTORY_MAX_QUESTION_CHARS,
            "answer": "答" * HISTORY_MAX_ANSWER_CHARS} for _ in range(HISTORY_MAX_TURNS)]
    out = normalize_history(fat)
    total = sum(len(t["question"]) + len(t["answer"]) for t in out)
    # 整块闸生效后总量落回天花板附近（首轮多出来的是 drop 标记本身）。
    assert total <= HISTORY_MAX_TOTAL_CHARS + len(DROPPED_MARK) + 1
    assert len(out) < HISTORY_MAX_TURNS, "整块闸必须真的丢掉了几轮"
    assert out[0]["question"].startswith(DROPPED_MARK)


def test_half_a_turn_is_dropped_whole():
    out = normalize_history([
        {"question": "只有问", "answer": ""},
        {"question": "", "answer": "只有答"},
        {"question": "完整的问", "answer": "完整的答"},
    ])
    assert out == [{"question": "完整的问", "answer": "完整的答"}]


def test_malformed_entries_degrade_instead_of_raising():
    class _Obj:
        question = "对象形状的问"
        answer = "对象形状的答"

    out = normalize_history([_Obj(), {"question": None, "answer": None}, "不是个东西", 42])
    assert out == [{"question": "对象形状的问", "answer": "对象形状的答"}]


def test_conversation_turns_alternate_user_then_assistant():
    msgs = history_conversation_turns(_turns(2))
    assert [m["role"] for m in msgs] == ["user", "assistant", "user", "assistant"]
    assert msgs[0]["content"][0]["text"] == "第0问"
    assert msgs[1]["content"][0]["text"] == "第0答"
    # 刻意是纯文本轮：不重放 tool_use/tool_result（那些 id 属于上一次 run，本次请求从没发过）。
    for m in msgs:
        assert [b["type"] for b in m["content"]] == ["text"]


# ── service · 判据落在 brain 真收到的 conversation 上 ─────────────────────────────────────────

class _SpyBrain:
    """Records every conversation the service hands the model; answers in free text.
    （与 test_at_references 的同名替身同一形状：chain 门 nudge 一次后循环接受空 advice 终局，
    manifest 仍然终结流——这些断言要的就是那一份 conversation。）"""
    name = "spy"

    def __init__(self):
        self.conversations: list[list[dict]] = []

    def respond(self, system, conversation, tools):
        self.conversations.append([dict(m) for m in conversation])
        return BrainResponse(text="ok")


@pytest.fixture()
def client(monkeypatch):
    monkeypatch.setenv("AVERY_BRAIN", "mock")
    monkeypatch.delenv("AVERY_DB_URL", raising=False)
    monkeypatch.delenv("PGVECTOR_URL", raising=False)
    from service.app import app
    return TestClient(app)


@pytest.fixture()
def spy(monkeypatch):
    s = _SpyBrain()
    from service import brain_factory
    monkeypatch.setattr(brain_factory, "make_brain", lambda case, kind: s)
    return s


FOLLOWUP = "那这周该先动哪一头？"
PRIOR_Q = "别墅套餐推广现在卡在哪儿？"
PRIOR_A = "卡在雨季没有备选场地，负责人周雅婷已经在找。"


def _post(client, *, history=None, references=None, situation=FOLLOWUP):
    body = {"situation": situation, "stream": False}
    if history is not None:
        body["history"] = history
    if references is not None:
        body["references"] = references
    return client.post("/advise", json=body)


def _texts(conversation) -> str:
    out = []
    for m in conversation:
        for block in m.get("content", []):
            if isinstance(block, dict) and block.get("type") == "text":
                out.append(block.get("text", ""))
    return "\n".join(out)


def test_history_becomes_real_turns_before_the_opening_turn(client, spy):
    r = _post(client, history=[{"question": PRIOR_Q, "answer": PRIOR_A}])
    assert r.status_code == 200, r.text[:300]
    assert spy.conversations, "the spy brain must have been driven"
    conv = spy.conversations[0]
    assert len(conv) == 3, f"history(2) + opening(1); got roles {[m['role'] for m in conv]}"
    assert [m["role"] for m in conv] == ["user", "assistant", "user"]
    assert conv[0]["content"][0]["text"] == PRIOR_Q
    assert conv[1]["content"][0]["text"] == PRIOR_A
    opening = conv[2]["content"][0]["text"]
    assert "The leader asks:" in opening and FOLLOWUP in opening
    # 🔴 历史**不进**开场轮的正文——它是自己的轮次，不是塞进这一问里的一段引文。
    assert PRIOR_Q not in opening and PRIOR_A not in opening


def test_without_history_the_conversation_is_the_pre_71_one(client, spy):
    r = _post(client)
    assert r.status_code == 200
    conv = spy.conversations[0]
    assert len(conv) == 1 and conv[0]["role"] == "user"
    assert "The leader asks:" in conv[0]["content"][0]["text"]
    # 空数组与"没带"同义（additive：absent≠[] 在线上，但语义上都必须是"没有历史"）。
    # ⚠ 取**这次请求的第一次** respond：spy 跨请求累积，而一次 advise 会被 chain 门 nudge
    #   一发再问一次模型——`conversations[-1]` 是那条带 nudge 的（长度 2），不是开场轮。
    before = len(spy.conversations)
    r2 = _post(client, history=[])
    assert r2.status_code == 200
    assert len(spy.conversations[before]) == 1


def test_history_quota_is_enforced_server_side(client, spy):
    """前端那份镜像配额是善意，真闸在这儿——直接灌 3 倍轮数。"""
    r = _post(client, history=_turns(HISTORY_MAX_TURNS * 3))
    assert r.status_code == 200
    conv = spy.conversations[0]
    assert len(conv) == HISTORY_MAX_TURNS * 2 + 1
    assert DROPPED_MARK in conv[0]["content"][0]["text"]


def test_history_and_at_references_coexist(client, spy):
    r = _post(client,
              history=[{"question": PRIOR_Q, "answer": PRIOR_A}],
              references=[{"kind": "person", "id": "u_鬼", "label": "查无此人"}])
    assert r.status_code == 200
    conv = spy.conversations[0]
    # 历史轮在前，@ 引用块仍钉在开场轮里（两条通道互不吃对方的字节）。
    assert conv[0]["content"][0]["text"] == PRIOR_Q
    opening = conv[-1]["content"][0]["text"]
    assert "The leader asks:" in opening
    # 无 context id ⇒ 引用块本来就不注入（_build_reference_block 的既有语义），
    # 这里只钉住"历史没有把开场轮挤掉"这一件事。
    assert FOLLOWUP in opening


def test_malformed_history_never_fails_the_turn(client, spy):
    r = _post(client, history=[{"question": "", "answer": ""}, {"question": "只有问"}])
    assert r.status_code == 200, "坏 history 必须降级成'少点上下文'，不是 422/500 掉一次提问"
    assert len(spy.conversations[0]) == 1, "两条都不合格 ⇒ 回落成纯开场轮"


def test_started_prompt_stays_the_managers_words(client, spy):
    r = _post(client, history=[{"question": PRIOR_Q, "answer": PRIOR_A}])
    assert r.status_code == 200
    started = next(e for e in r.json()["events"] if e["type"] == "started")
    assert started["prompt"].strip() == FOLLOWUP
    assert PRIOR_Q not in started["prompt"]


def test_history_never_lands_in_the_case_body(client):
    """真 mock brain 走全程（无 spy）：它第一步就是 read_case，观察里带回 case 正文全文。
    历史是**对话**不是**材料**——进了 case 正文，recall/cite 就会在上一轮的回答上引出处。"""
    r = _post(client, history=[{"question": PRIOR_Q, "answer": PRIOR_A}])
    assert r.status_code == 200
    payload = r.json()
    assert payload["contract_ok"] is True, "带 history 的一问仍要走完整条链"
    observations = [e.get("observation", "") for e in payload["events"]
                    if e.get("type") == "observe" and e.get("name") == "read_case"]
    assert observations, "mock brain 的第一步就是 read_case——采不到样就是这条判据够不着了"
    joined = "\n".join(observations)
    assert PRIOR_Q not in joined and PRIOR_A not in joined
    assert FOLLOWUP in joined, "自证：case 正文里确实有**这一问**（判据不是恒真）"
