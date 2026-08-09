# -*- coding: utf-8 -*-
"""issue #78 — advise-threads 真线程 over the HTTP surface, fully offline.

配置与 test_advise_runs_http.py 同款（mock brain / keyword recall / heuristic extractor / 无 DB），
所以它跑在默认离线套里，零网络零 DB。pg 孪生在 test_registry_contract.py（`impl` 参数化 +
@needs_db 的重启腿）。

每条测试盯一种**具体的假实现**：

  * `test_server_mints_and_echoes_a_thread_id`
      —— 假实现：落库了但不回传。前端于是永远不知道自己在写哪一场，续问只能开新场，
         而界面还显示着「在这场里」。判据落在 **started 与 manifest 两帧的 thread_id 值**上，
         不是「请求 200」。
  * `test_two_turns_with_the_same_thread_id_land_in_one_thread`
      —— 假实现：thread_id 被 pydantic 收下但没进落库参数（`extra='ignore'` 让这一幕悄无声息）。
  * `test_no_thread_id_means_each_turn_is_its_own_thread`
      —— 兼容闸：旧前端不带这个键，行为必须与 #78 之前逐字节相同。
  * `test_threads_group_newest_activity_first_and_turns_in_order`
      —— 假实现：场内按 seq **降序**回（照抄了平铺那条读路径的 ORDER BY），于是 hydrate 出来
         的对话是倒着的；以及老场被追问后不浮上来。
  * `test_malformed_thread_id_is_treated_as_absent_never_422`
      —— 假实现：给 thread_id 加 Literal/正则校验，坏值 422 —— 一次正常提问被一个 additive
         optional 的坏值打死。
  * `test_a_thread_id_from_another_company_does_not_merge_the_two`
      —— 分组永远 `WHERE context_id = %s` 收口：拿 A 的 id 去问 B，B 那边最多多一个同名的场，
         **A 的历史一行都不动**。
  * `test_threads_surface_is_gated_like_notes` / `test_legacy_rows_without_a_thread_each_stand_alone`
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

fastapi_testclient = pytest.importorskip("fastapi.testclient")
from fastapi.testclient import TestClient  # noqa: E402

HERE = Path(__file__).resolve().parent.parent
FIX = HERE / "tests" / "fixtures" / "ingest"
HANDBOOK = FIX / "Studio_Handbook.md"
ROSTER = FIX / "Team_Roster.xlsx"


@pytest.fixture()
def client(monkeypatch):
    monkeypatch.setenv("AVERY_BRAIN", "mock")
    monkeypatch.setenv("AVERY_EMBEDDINGS", "keyword")
    monkeypatch.setenv("AVERY_EXTRACTOR", "heuristic")
    monkeypatch.delenv("AVERY_DB_URL", raising=False)
    monkeypatch.delenv("PGVECTOR_URL", raising=False)
    from avery.ingest.registry import REGISTRY
    REGISTRY.clear()
    from service.app import app
    return TestClient(app)


def _ingest(client):
    files = [("files", (p.name, p.read_bytes(), "application/octet-stream"))
             for p in (HANDBOOK, ROSTER)]
    r = client.post("/ingest", files=files)
    assert r.status_code == 200, f"/ingest failed: {r.text[:300]}"
    body = r.json()
    return body["context_id"], {"X-Avery-Token": body["owner_token"]}


def _advise(client, cid, situation, hdr, thread_id=None, stream=False):
    payload = {"situation": situation, "company_context_id": cid, "stream": stream}
    if thread_id is not None:
        payload["thread_id"] = thread_id
    return client.post("/advise", json=payload, headers=hdr)


def _threads(client, cid, hdr):
    r = client.get(f"/team/{cid}/advise-threads", headers=hdr)
    assert r.status_code == 200, f"advise-threads failed: {r.text[:300]}"
    return r.json()["threads"]


def _sse_frames(raw: str) -> list[dict]:
    """把 SSE 正文切成事件字典。记录分隔是 CRLF-safe 的空行（sse-starlette 发 \\r\\n，
    只找 '\\n\\n' 会一条都切不出来——transport.ts:1204-1208 记着同一个坑）。"""
    out = []
    for record in raw.replace("\r\n", "\n").split("\n\n"):
        for line in record.split("\n"):
            if line.startswith("data:"):
                out.append(json.loads(line[5:].strip()))
    return out


def test_server_mints_and_echoes_a_thread_id(client):
    """没带 thread_id 时服务端铸一个，并把它贴在 started 与 manifest 两帧上。

    两帧都要：started 是早期对账（第一帧就知道在写哪一场），manifest 是 stream:false 那条
    缓冲路唯一回给调用方的东西。少任何一帧，就有一类调用方拿不到 id。
    """
    cid, hdr = _ingest(client)
    r = client.post("/advise", json={"situation": "How do I rebalance the onboarding backlog?",
                                     "company_context_id": cid, "stream": True}, headers=hdr)
    assert r.status_code == 200
    frames = _sse_frames(r.text)
    started = [f for f in frames if f.get("type") == "started"]
    manifests = [f for f in frames if f.get("type") == "manifest"]
    assert started and manifests, f"stream shape changed: {[f.get('type') for f in frames]}"
    tid = started[0].get("thread_id")
    assert isinstance(tid, str) and tid.startswith("thr_") and len(tid) > 4, (
        f"started frame carries no minted thread_id: {started[0]!r}")
    assert manifests[0].get("thread_id") == tid, (
        "manifest must carry the SAME thread_id as started (缓冲路只看得到 manifest)")

    # 落库的那一行带的就是这个 id —— 回传与持久化不许是两个值。
    runs = client.get(f"/team/{cid}/advise-runs", headers=hdr).json()["runs"]
    assert len(runs) == 1 and runs[0]["thread_id"] == tid

    # 缓冲路（stream:false）同样带得到。
    br = _advise(client, cid, "Who most needs a hand this week?", hdr)
    assert br.status_code == 200
    btid = br.json().get("thread_id")
    assert isinstance(btid, str) and btid.startswith("thr_"), (
        f"buffered body carries no thread_id: {sorted(br.json())}")
    assert btid != tid, "两次不带 thread_id 的提问必须是两场，不是一场"


def test_two_turns_with_the_same_thread_id_land_in_one_thread(client):
    cid, hdr = _ingest(client)
    first = _advise(client, cid, "How do I rebalance the onboarding backlog?", hdr)
    tid = first.json()["thread_id"]

    second = _advise(client, cid, "And which squad do I move first?", hdr, thread_id=tid)
    assert second.status_code == 200
    assert second.json()["thread_id"] == tid, "带上 thread_id 时服务端必须原样沿用，不许改铸"

    threads = _threads(client, cid, hdr)
    assert len(threads) == 1, f"两问带同一个 thread_id 应当是一场，实得 {len(threads)} 场"
    assert threads[0]["thread_id"] == tid
    assert [r["question"] for r in threads[0]["runs"]] == [
        "How do I rebalance the onboarding backlog?",
        "And which squad do I move first?",
    ], "场内必须按对话顺序（seq 升序），不是新->旧"


def test_no_thread_id_means_each_turn_is_its_own_thread(client):
    """兼容闸：旧前端不带这个键，行为与 #78 之前逐字节相同（每问自成一场）。"""
    cid, hdr = _ingest(client)
    for q in ("How do I rebalance the onboarding backlog?", "Who most needs a hand this week?"):
        assert _advise(client, cid, q, hdr).status_code == 200
    threads = _threads(client, cid, hdr)
    assert len(threads) == 2, "不带 thread_id 的两问是两场"
    assert all(len(t["runs"]) == 1 for t in threads)
    # 平铺那条读路径一个字节没变（它的四条既有测试仍是回归网）。
    runs = client.get(f"/team/{cid}/advise-runs", headers=hdr).json()["runs"]
    assert len(runs) == 2


def test_threads_group_newest_activity_first_and_turns_in_order(client):
    """场按**最近活动**新->旧，不是按开场时间：老场被追问之后要浮到最前面。

    按开场时间排的假实现在「问了 A、问了 B、又在 A 里追问」之后会把 A 沉在底下——
    而 A 恰恰是用户刚碰过、最可能想接着问的那一场。
    """
    cid, hdr = _ingest(client)
    a = _advise(client, cid, "Question A: how do I rebalance the backlog?", hdr).json()["thread_id"]
    b = _advise(client, cid, "Question B: who needs a hand?", hdr).json()["thread_id"]
    _advise(client, cid, "Question A follow-up: which squad first?", hdr, thread_id=a)

    threads = _threads(client, cid, hdr)
    assert [t["thread_id"] for t in threads] == [a, b], (
        "A 被追问后必须浮到最前（按场内最后一轮排，不是按首轮）")
    assert len(threads[0]["runs"]) == 2 and len(threads[1]["runs"]) == 1
    assert [r["question"] for r in threads[0]["runs"]] == [
        "Question A: how do I rebalance the backlog?",
        "Question A follow-up: which squad first?"]


def test_malformed_thread_id_is_treated_as_absent_never_422(client):
    """坏值当没带、铸新的——绝不 422（同 locale 的降级纪律）。

    一个 additive optional 字段的坏值把一次正常提问打死，是最没道理的一种失败。
    """
    cid, hdr = _ingest(client)
    for bad in ("", "   ", "has spaces", "semi:colon", "x" * 65, "汉字"):
        r = _advise(client, cid, "How do I rebalance the backlog?", hdr, thread_id=bad)
        assert r.status_code == 200, f"thread_id={bad!r} 不该 422/500：{r.text[:200]}"
        tid = r.json()["thread_id"]
        assert tid.startswith("thr_"), f"坏值 {bad!r} 应当被当成没带并铸新的，实得 {tid!r}"
    # 非字符串也不许炸（pydantic 会先拦成 422 — 这里确认的是它不会 500）
    r = _advise(client, cid, "One more", hdr, thread_id=123)
    assert r.status_code in (200, 422), f"非字符串 thread_id 走出了第三种结局：{r.status_code}"


def test_a_thread_id_from_another_company_does_not_merge_the_two(client):
    """跨公司复用 thread_id：分组永远 WHERE context_id 收口，A 的历史一行都不动。"""
    cid_a, hdr_a = _ingest(client)
    cid_b, hdr_b = _ingest(client)
    tid = _advise(client, cid_a, "A 公司的问题：怎么排班？", hdr_a).json()["thread_id"]
    assert _advise(client, cid_b, "B 公司的问题：怎么排班？", hdr_b,
                   thread_id=tid).status_code == 200

    a_threads = _threads(client, cid_a, hdr_a)
    b_threads = _threads(client, cid_b, hdr_b)
    assert len(a_threads) == 1 and len(a_threads[0]["runs"]) == 1, (
        "B 公司用了同一个 thread_id，A 公司的那一场必须仍然只有自己那一轮")
    assert [r["question"] for r in a_threads[0]["runs"]] == ["A 公司的问题：怎么排班？"]
    assert len(b_threads) == 1 and len(b_threads[0]["runs"]) == 1


def test_legacy_rows_without_a_thread_each_stand_alone(client):
    """存量行（thread_id 空）每条自成一场，绝不并成一场假对话。

    直接走 registry 写两条无场归属的行（模拟 #78 之前落的库），它们必须分成两场、
    而不是被空串这个「共同的键」缝在一起。
    """
    cid, hdr = _ingest(client)
    from avery.ingest.registry import active_registry
    reg = active_registry()
    reg.append_advise_run(cid, "老行一", advice={"summary": "s1"})
    reg.append_advise_run(cid, "老行二", advice={"summary": "s2"})

    threads = _threads(client, cid, hdr)
    assert len(threads) == 2, f"两条无场归属的老行必须是两场，实得 {len(threads)}"
    assert all(t["thread_id"] == "" for t in threads), (
        "老行的 thread_id 对外就是空串——不许给它编一个场 id")
    assert all(len(t["runs"]) == 1 for t in threads)
    assert [t["runs"][0]["question"] for t in threads] == ["老行二", "老行一"]


def test_threads_surface_is_gated_like_notes(client):
    cid, hdr = _ingest(client)
    assert _advise(client, cid, "Where is the coordination seam?", hdr).status_code == 200
    assert client.get(f"/team/{cid}/advise-threads").status_code == 404, (
        "缺 owner_token 必须 404（无存在性 oracle），与 notes / advise-runs 同一张门")
    assert client.get("/team/ctx_does_not_exist/advise-threads", headers=hdr).status_code == 404


def test_a_fresh_company_gets_200_and_an_empty_list_not_404(client):
    """空历史是 200 + `threads: []`。用 404 表达空态会让前端把「没问过」显示成「登录失效」
    （transport 的 httpErrorMessage 对已鉴权读路径的 404 就是这么解释的）。"""
    cid, hdr = _ingest(client)
    r = client.get(f"/team/{cid}/advise-threads", headers=hdr)
    assert r.status_code == 200 and r.json()["threads"] == []
    assert r.json()["context_id"] == cid


def test_thread_id_never_rides_inside_the_advice_payload(client):
    """thread_id 是 manifest 的**顶层**键，绝不进 manifest['advice']。

    advice 载荷有一条 `set(payload) <= REQUIRED|OPTIONAL` 的闭包断言
    （test_service_contract.py），多一个键当场红——这里从正面把它钉住，
    免得有人「顺手」把 id 塞进卡里。
    """
    cid, hdr = _ingest(client)
    body = _advise(client, cid, "How do I rebalance the backlog?", hdr).json()
    assert "thread_id" in body, "顶层要有"
    assert isinstance(body.get("advice"), dict)
    assert "thread_id" not in body["advice"], "advice 载荷里不许有"
