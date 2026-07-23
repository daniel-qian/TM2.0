# -*- coding: utf-8 -*-
"""rich-align-0722/10 · 登录隔离演示线 —— 隔离断言（后端测试层 mock resolve_account，全离线）。

issue-10 验收「隔离断言（mock resolve_account）」：账号 A claim 三亚 demo 副本 → A 的 contexts 含它、
B 的 contexts 不含、且 B 以自己身份动这个 ctx → 同体 404（无枚举 oracle）；未登录 → 401；坏 token /
坏 ctx / 抢已被 A 认领的 ctx → 一律同体 404。

🔴 凭据墙：真登录（输账号密码走 Supabase）是 Danny 人手；本文件把 Supabase **整层 mock 掉**——
`resolve_account` 直接把账号 header 映射成用户 id（TOKEN_A→USER_A / TOKEN_B→USER_B），Supabase 一次
不碰。token 验证是 Supabase 的活；本文件拥有的是「验证过的 user id 之上」的隔离不变式。

现有 test_account_auth.py（25 例，mock verify_access_token）已覆盖同一隔离矩阵；本文件按 issue-10 的
措辞另立一份 **mock resolve_account** 的专门断言，并把 claim 素材换成**三亚 demo 副本**（贴合演示线）。
"""
from __future__ import annotations

from pathlib import Path

import pytest

pytest.importorskip("fastapi.testclient")
from fastapi.testclient import TestClient  # noqa: E402

HERE = Path(__file__).resolve().parent.parent
SEED_DIR = HERE / "tests" / "fixtures" / "demo-seed"

TOKEN_A = "sb-access-token-alice"
TOKEN_B = "sb-access-token-bob"
USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
USER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
_USERS = {TOKEN_A: USER_A, TOKEN_B: USER_B}


@pytest.fixture()
def client(monkeypatch):
    """离线 + 账号层 CONFIGURED（SUPABASE_* stub）+ demo 面开 + resolve_account 整层 mock。"""
    monkeypatch.setenv("AVERY_BRAIN", "mock")
    monkeypatch.setenv("AVERY_EMBEDDINGS", "keyword")
    monkeypatch.setenv("AVERY_EXTRACTOR", "heuristic")
    monkeypatch.delenv("AVERY_DB_URL", raising=False)
    monkeypatch.delenv("PGVECTOR_URL", raising=False)
    # configured => auth_configured() True；验证本身被下面的 mock 顶掉，Supabase 零触碰。
    monkeypatch.setenv("SUPABASE_URL", "https://stub.supabase.co")
    monkeypatch.setenv("SUPABASE_ANON_KEY", "stub-anon-key")
    monkeypatch.setenv("AVERY_DEMO_SEED_DIR", str(SEED_DIR))
    monkeypatch.delenv("AVERY_DEMO_CONTEXT_ID", raising=False)

    from service import account
    account.reset_cache()
    # 🔴 mock resolve_account：账号 header → user id（Supabase 一次不碰）。read 端点/claim/status 都走它。
    monkeypatch.setattr(account, "resolve_account", lambda hdr: _USERS.get((hdr or "").strip()))

    from avery.ingest.registry import REGISTRY
    REGISTRY.clear()
    from service.app import app
    with TestClient(app) as c:
        yield c
    REGISTRY.clear()
    account.reset_cache()


def _acct(token: str) -> dict:
    return {"X-Avery-Account": token}


def _demo_claim(client) -> tuple[str, str]:
    """三亚 demo 一键领取（匿名克隆副本：自带 owner_token，尚未归任何账号）。"""
    r = client.post("/demo/claim")
    assert r.status_code == 200, r.text
    b = r.json()
    return b["context_id"], b["owner_token"]


# ── 能力探测 + 未登录边界 ────────────────────────────────────────────────────────────────


def test_status_reflects_configured_and_signed_in(client):
    """/account/status：无 header → configured:true/signed_in:false；带 A 的 token → signed_in:true。"""
    assert client.get("/account/status").json() == {"configured": True, "signed_in": False}
    signed = client.get("/account/status", headers=_acct(TOKEN_A)).json()
    assert signed["configured"] is True and signed["signed_in"] is True


def test_unauth_boundary_is_401(client):
    """未登录：GET /account/contexts → 401；POST /account/claim → 401（先验登录，早于同体 404）。"""
    assert client.get("/account/contexts").status_code == 401
    cid, tok = _demo_claim(client)
    assert client.post("/account/claim", json={"context_id": cid, "owner_token": tok}).status_code == 401


# ── 隔离不变式：A claim 三亚 → 只有 A 看得见/动得了 ────────────────────────────────────────


def test_A_claims_demo_and_only_A_sees_it(client):
    cid, tok = _demo_claim(client)
    r = client.post("/account/claim", headers=_acct(TOKEN_A), json={"context_id": cid, "owner_token": tok})
    assert r.status_code == 200 and r.json().get("claimed") is True, r.text
    # A 的 contexts 含它。
    a_ctxs = client.get("/account/contexts", headers=_acct(TOKEN_A)).json()["context_ids"]
    assert cid in a_ctxs, f"A 认领后应在 A 的 contexts 里：{a_ctxs}"
    # B 的 contexts 不含它。
    b_ctxs = client.get("/account/contexts", headers=_acct(TOKEN_B)).json()["context_ids"]
    assert cid not in b_ctxs, f"B 不该看得见 A 的 context：{b_ctxs}"
    # B 以自己身份动这个 ctx（无 owner_token）→ 同体 404（无枚举 oracle）。
    r2 = client.get(f"/team/{cid}", headers=_acct(TOKEN_B))
    assert r2.status_code == 404, r2.text
    assert r2.json()["detail"] == f"unknown company_context_id: {cid}"


def test_B_cannot_steal_an_already_claimed_context(client):
    """B 拿着正确的 owner_token 想抢已被 A 认领的 ctx → 同体 404（一个 context 至多一个账号）。"""
    cid, tok = _demo_claim(client)
    client.post("/account/claim", headers=_acct(TOKEN_A), json={"context_id": cid, "owner_token": tok})
    r = client.post("/account/claim", headers=_acct(TOKEN_B), json={"context_id": cid, "owner_token": tok})
    assert r.status_code == 404, r.text
    assert r.json()["detail"] == f"unknown company_context_id: {cid}"


def test_bad_token_and_unknown_ctx_share_the_same_404_body(client):
    """坏 owner_token 与未知 ctx id → 一律同体 404（无「存在与否」的 oracle）。"""
    cid, tok = _demo_claim(client)
    bad_tok = client.post("/account/claim", headers=_acct(TOKEN_A),
                          json={"context_id": cid, "owner_token": "wrong-token"})
    unknown = client.post("/account/claim", headers=_acct(TOKEN_A),
                          json={"context_id": "ctx_does_not_exist", "owner_token": tok})
    assert bad_tok.status_code == 404 and unknown.status_code == 404
    assert bad_tok.json()["detail"] == f"unknown company_context_id: {cid}"
    assert unknown.json()["detail"] == "unknown company_context_id: ctx_does_not_exist"
