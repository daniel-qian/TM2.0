# -*- coding: utf-8 -*-
"""input-side-0721 · 3A 一键示例团队 —— /demo/status + /demo/claim 的 HTTP 合约（全离线）。

拍板背景（.issues/cr-align-0721/decisions.md 第 3 项，Danny 2026-07-21 追加「一键示例团队放进
onboarding 闸门页」）：后端预铸一个共享 demo 母本 context，访客一键领取时**克隆**成自己的私有
副本（新 context_id + 新 owner_token）。为什么必须克隆而不是共享读写：/advise 会往 context 追加
公司笔记、/ask 会落 ask 行——共享一个 token 等于所有访客互相写脏对方看到的示例。为什么不是
「只读共享」：把只读特判撒进每个写端点，是比克隆大得多的散布面（且永远防不住下一个新写端点）。

机制合约（本文件断言的全部行为）：
  * 未配置（无 AVERY_DEMO_SEED_DIR）→ /demo/status 说 available=false，/demo/claim 404 ——
    前端按 status 探测决定「示例团队」那扇门露不露面（能力探测，同 AuthPanel 的 /account/status
    套路；探不到就不出假按钮）。
  * 配置了 seed 目录 → 首次 claim 时服务端自己把 seed 铸成母本（离线=heuristic 秒出；生产=LLM
    一次），此后 claim 全部走克隆。status.ready 反映母本是否已铸。
  * 每次 claim 返回**不同的** context_id + owner_token；副本能用自己的 token 读 /team/{id}；
    副本之间、副本与母本之间互不写脏（对 A 副本 /advise 落的笔记，B 副本看不见）。
  * 中文名不塌卡：seed 里两个中文名的人在克隆副本里仍是两张不同 id 的卡（issue #10 的 demo
    车道回归——修复本体的判别语料在 test_cjk_identity*.py，这里只守住克隆不把它们再合回去）。
  * 预铸母本自带一条「实时数据缺位」笔记（Danny 3A 附注：示例要呈现缺实时数据的故事），
    克隆副本继承它。
"""
from __future__ import annotations

from pathlib import Path

import pytest

fastapi_testclient = pytest.importorskip("fastapi.testclient")
from fastapi.testclient import TestClient  # noqa: E402

HERE = Path(__file__).resolve().parent.parent          # eval-harness/
SEED_DIR = HERE / "tests" / "fixtures" / "demo-seed"


def _offline_env(monkeypatch):
    monkeypatch.setenv("AVERY_BRAIN", "mock")
    monkeypatch.setenv("AVERY_EMBEDDINGS", "keyword")
    monkeypatch.setenv("AVERY_EXTRACTOR", "heuristic")
    monkeypatch.delenv("AVERY_DB_URL", raising=False)
    monkeypatch.delenv("PGVECTOR_URL", raising=False)
    from avery.ingest.registry import REGISTRY
    REGISTRY.clear()


@pytest.fixture()
def client(monkeypatch):
    """离线 + seed 目录已配置（demo 面开启）。"""
    _offline_env(monkeypatch)
    monkeypatch.setenv("AVERY_DEMO_SEED_DIR", str(SEED_DIR))
    monkeypatch.delenv("AVERY_DEMO_CONTEXT_ID", raising=False)
    from service.app import app
    return TestClient(app)


@pytest.fixture()
def client_unconfigured(monkeypatch):
    """离线 + 未配置 demo（默认姿态：这个面不存在）。"""
    _offline_env(monkeypatch)
    monkeypatch.delenv("AVERY_DEMO_SEED_DIR", raising=False)
    monkeypatch.delenv("AVERY_DEMO_CONTEXT_ID", raising=False)
    from service.app import app
    return TestClient(app)


def _claim(client) -> tuple[str, dict, dict]:
    r = client.post("/demo/claim")
    assert r.status_code == 200, f"/demo/claim failed: {r.text[:300]}"
    body = r.json()
    return body["context_id"], {"X-Avery-Token": body["owner_token"]}, body


# ── 未配置：面不存在 ──────────────────────────────────────────────────────────────────────


def test_unconfigured_status_says_unavailable(client_unconfigured):
    r = client_unconfigured.get("/demo/status")
    assert r.status_code == 200
    assert r.json()["available"] is False


def test_unconfigured_claim_404s(client_unconfigured):
    assert client_unconfigured.post("/demo/claim").status_code == 404


# ── 配置了：status 探测 + 首铸 + 克隆 ────────────────────────────────────────────────────


def test_status_available_then_ready_after_first_claim(client):
    before = client.get("/demo/status").json()
    assert before["available"] is True
    assert before["ready"] is False, "还没人 claim 过，母本不该已存在（REGISTRY 已清）"
    _claim(client)
    after = client.get("/demo/status").json()
    assert after["ready"] is True, "首次 claim 应当顺手把母本铸出来"


def test_claim_returns_a_readable_private_context(client):
    cid, hdr, body = _claim(client)
    assert body.get("demo") is True, "claim 响应要自报 demo 身份（前端要标注示例语义）"
    assert body["people"], "示例团队不能是空团队"
    r = client.get(f"/team/{cid}", headers=hdr)
    assert r.status_code == 200, "副本必须能用自己的 owner_token 读回来"
    assert client.get(f"/team/{cid}").status_code == 404, "没有 token 读不动（feat-038 不因 demo 松动）"


def test_two_claims_are_two_isolated_copies(client):
    cid_a, hdr_a, body_a = _claim(client)
    cid_b, hdr_b, body_b = _claim(client)
    assert cid_a != cid_b, "两个访客各领各的副本"
    assert hdr_a["X-Avery-Token"] != hdr_b["X-Avery-Token"]
    # A 的 token 开不了 B 的门。
    assert client.get(f"/team/{cid_b}", headers=hdr_a).status_code == 404


def test_chinese_names_stay_distinct_in_a_clone(client):
    _, _, body = _claim(client)
    names = [p["name"] for p in body["people"]]
    ids = [p["id"] for p in body["people"]]
    assert "林晓梅" in names and "郑国豪" in names, f"seed 里两个中文名的人都要在：{names}"
    assert len(ids) == len(set(ids)), f"克隆副本里 id 撞车（#10 的 demo 车道回归）：{ids}"


def test_precast_realtime_gap_note_rides_along(client):
    cid, hdr, _ = _claim(client)
    notes = client.get(f"/team/{cid}/notes", headers=hdr).json()["notes"]
    assert len(notes) == 1, f"预铸母本应带且只带一条「实时数据缺位」笔记，克隆继承：{len(notes)} 条"
    assert "实时" in notes[0]["text"], "那条笔记讲的是实时数据还没接入的故事"


def test_mutating_a_clone_never_leaks_into_the_next_claim(client):
    cid_a, hdr_a, _ = _claim(client)
    # 对 A 副本真跑一次 /advise（mock 脑）——post-advise 钩子会往 A 的笔记本追加一条。
    r = client.post("/advise", json={
        "situation": "渠道协议回签卡在法务复核，我该怎么推进？",
        "company_context_id": cid_a, "stream": False}, headers=hdr_a)
    assert r.status_code == 200
    notes_a = client.get(f"/team/{cid_a}/notes", headers=hdr_a).json()["notes"]
    assert len(notes_a) == 2, "A 副本：预铸 1 条 + advise 落 1 条"
    # 下一个访客的副本干干净净：只有预铸那条。
    cid_b, hdr_b, _ = _claim(client)
    notes_b = client.get(f"/team/{cid_b}/notes", headers=hdr_b).json()["notes"]
    assert len(notes_b) == 1, f"B 副本被 A 写脏了（克隆隔离失守）：{len(notes_b)} 条"


# ── 8A · onboarding 采集：POST /team/{id}/notes（经理口述，落 company_notes）────────────────


def test_onboard_note_append_lands_and_lists(client):
    cid, hdr, _ = _claim(client)
    r = client.post(f"/team/{cid}/notes", headers=hdr, json={
        "text": "初始设置：公司做旅游度假地产营销，现在最操心渠道回款周期变长。",
        "source_excerpt": "初始设置 · 公司情况"})
    assert r.status_code == 200, f"经理口述笔记应能落库：{r.text[:300]}"
    note = r.json()["note"]
    assert note["id"] and note["created_at"]
    notes = client.get(f"/team/{cid}/notes", headers=hdr).json()["notes"]
    assert notes[0]["text"].startswith("初始设置"), "最新一条在最上（notebook 新到旧）"


def test_onboard_note_requires_the_owner_token(client):
    cid, _, _ = _claim(client)
    r = client.post(f"/team/{cid}/notes", json={"text": "无凭据写入"})
    assert r.status_code == 404, "无 token 写笔记必须 404（与读路径同一张不透明门）"


def test_onboard_note_scoring_text_is_refused(client, monkeypatch):
    monkeypatch.delenv("AVERY_ALLOW_PERSON_SCORING", raising=False)
    cid, hdr, _ = _claim(client)
    # 触发句用检测器的既有词形（同 test_notes_scoring_toggle 的 SCORING_OBS_ZH 句式）——
    # 本测试证明端点接进了既有写侧闸门，不测检测器词表覆盖度（那是 H6 的已知延期项）。
    r = client.post(f"/team/{cid}/notes", headers=hdr, json={
        "text": "综合来看，李雷这个季度的绩效评分是9分，排名第一。"})
    assert r.status_code == 422, "写侧红线对经理口述同样生效（开关默认关时评分内容进不来）"
