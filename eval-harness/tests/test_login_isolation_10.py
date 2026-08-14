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
TOKEN_C = "sb-access-token-carol"          # #100: 第三个账号 —— 没被绑进任何公司的那个
USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
USER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
USER_C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
_USERS = {TOKEN_A: USER_A, TOKEN_B: USER_B, TOKEN_C: USER_C}


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
    """B 拿着正确的 owner_token 想抢已被 A 认领的 ctx → 同体 404。

    ⚠ #100 之后这条**行为没变、理由换了**，别照旧读法维护它：过去的理由是「一个 context 至多一个
    账号」（0008 的唯一索引），那句话自 0019 起不成立 —— 一份档案现在**可以**挂多个成员账号。
    今天的理由是产品语义（Danny 0814）：**认领不是加入公司的路径**。owner_token 是设备级凭据，
    谁翻到过那台电脑的 localStorage 谁就能拿着它敲门，所以这扇门对它永远是关的；加人只走 admin
    脚本（`link_account_context(..., allow_shared=True)`）。多成员那一半由
    `test_two_members_read_the_same_context_byte_for_byte` 正面证明。"""
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


# ── #100 · 一家公司多个账号：放松了排他性之后，正面证明隔离边界还在 ────────────────────────
#
# 🔴 这一段的存在理由：#100 删掉了 0008 的 UNIQUE(context_id)，而那条索引正是「两个账号数据不串」
#    的存储层保证之一。**证明多人能用是不够的** —— 多人能用和边界还在是两件事，一个放松了边界的
#    改动只交出前者，等于用「新功能能跑」换掉了「旧保证还成立」。所以下面三条全是**边界**判据，
#    多人能用只是它们的副产品。
#
# 加成员走 registry 的 `allow_shared=True`（admin 脚本那条路），不是 HTTP —— 产品上**没有**自助
# 加入的入口，这里也就不该有。想经 HTTP 加入的那条路由 `test_B_cannot_steal_...` 钉死在 404。


def _member(cid: str, user_id: str) -> None:
    """admin 侧绑人：把一个已存在账号加进一份已存在档案（scripts/ops/link-account-context.py 那条路）。"""
    from avery.ingest.registry import REGISTRY
    assert REGISTRY.link_account_context(user_id, cid, allow_shared=True) is True, (
        f"admin 绑人失败：{user_id} -> {cid}")


def _id_blind(resp, cid: str) -> bytes:
    """把响应正文里那串 context id 抹成占位符 —— 剩下的必须逐字节相同。

    为什么不是直接比 `.content`：两条 404 的正文本来就各自回显自己被问到的那个 id，直接比永远不等，
    比 `detail` 字符串又太松（它只看得见一个字段，看不见「其中一条多带了个 hint 字段」这类泄露）。
    抹掉 id 之后**整个正文**必须一模一样，这才是「无存在性 oracle」的完整说法。"""
    return resp.content.replace(cid.encode(), b"<CTX>")


def test_two_members_read_the_same_context_byte_for_byte(client):
    """A 认领 + B 被 admin 绑进来 → 两人各自读同一份档案，都 200 且正文**逐字节相同**。

    逐字节而不是「都 200」：#100 的产品承诺是「文件、数据属于同一家公司，改动同步」，一个按 user
    分叉的读路径（谁绑的谁看得见、后加的看得见一半）照样每次都 200，只有逐字节比对能把它逼出来。"""
    cid, tok = _demo_claim(client)
    r = client.post("/account/claim", headers=_acct(TOKEN_A),
                    json={"context_id": cid, "owner_token": tok})
    assert r.status_code == 200, r.text
    _member(cid, USER_B)

    a = client.get(f"/team/{cid}", headers=_acct(TOKEN_A))
    b = client.get(f"/team/{cid}", headers=_acct(TOKEN_B))
    assert a.status_code == 200, a.text
    assert b.status_code == 200, b.text
    assert a.content == b.content, "两个成员读同一份档案拿到的正文不一致 —— 数据没真共用"

    # 而且两人各自的公司列表里都有它（登录后自动打开的那条路，两边都得通）。
    for token in (TOKEN_A, TOKEN_B):
        ctxs = client.get("/account/contexts", headers=_acct(token)).json()["context_ids"]
        assert cid in ctxs, f"{token} 的 contexts 里没有这份档案：{ctxs}"


def test_a_third_account_gets_the_same_404_as_an_id_that_does_not_exist(client):
    """没被绑进来的第三个账号 C → 404，且与「这个 id 根本不存在」**逐字节同体**（无存在性 oracle）。

    这是本票放松边界后最要紧的一条：档案上现在挂着两个人，C 问起来必须和问一个凭空捏造的 id
    得到**完全一样**的回答 —— 状态码、content-type、正文（抹掉回显的 id 之后）全都一样。
    只要有一处不同，C 就能拿这个差别当探针枚举出「这份档案存在、只是不归我」。"""
    cid, tok = _demo_claim(client)
    client.post("/account/claim", headers=_acct(TOKEN_A),
                json={"context_id": cid, "owner_token": tok})
    _member(cid, USER_B)
    ghost = "ctx_test_never_existed_00"

    outsider = client.get(f"/team/{cid}", headers=_acct(TOKEN_C))
    unknown = client.get(f"/team/{ghost}", headers=_acct(TOKEN_C))

    assert outsider.status_code == unknown.status_code == 404, (
        f"外人 {outsider.status_code} / 不存在 {unknown.status_code}")
    assert outsider.headers.get("content-type") == unknown.headers.get("content-type")
    assert _id_blind(outsider, cid) == _id_blind(unknown, ghost), (
        "「有这份档案但不归你」与「压根没这个 id」两种 404 的正文不同 —— 这个差别就是存在性 oracle")
    # C 的公司列表里当然也不该冒出它。
    assert cid not in client.get("/account/contexts", headers=_acct(TOKEN_C)).json()["context_ids"]


def test_an_anonymous_context_is_reachable_by_no_account(client):
    """匿名（谁都没绑过）的 context：三个账号一个都够不着，全是同体 404。

    🔴 对照基准不能省：先证明这份档案**确实存在且读得到**（拿 owner_token 走 feat-038 那条路 200），
       否则「三个账号都 404」在一个压根不存在的 id 上恒真，这条判据会变成空真的摆设。"""
    cid, tok = _demo_claim(client)          # 领完还没认领给任何账号 —— 匿名态

    with_token = client.get(f"/team/{cid}", headers={"X-Avery-Token": tok})
    assert with_token.status_code == 200, (
        f"对照基准塌了：这份匿名档案连 owner_token 都读不到，下面三条 404 什么也证明不了 —— {with_token.text}")

    for token in (TOKEN_A, TOKEN_B, TOKEN_C):
        r = client.get(f"/team/{cid}", headers=_acct(token))
        assert r.status_code == 404, f"{token} 不带 owner_token 就够着了匿名档案：{r.text}"
        assert r.json()["detail"] == f"unknown company_context_id: {cid}"
