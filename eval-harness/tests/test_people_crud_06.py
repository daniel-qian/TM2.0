# -*- coding: utf-8 -*-
"""rich-align-0722/06 · 真 CRUD·人员（手编赢 + 逐字段出处 + 软删可逆 + 🔴写侧红线）—— 复用 05a 的
ProjectWriteMixin 骨架，全离线。

强制全离线（mock brain / keyword recall / heuristic extractor / 无 DB），进默认套跑，零网络零 DB。
覆盖：
  · registry 内存 CRUD 合约（add/patch/archive/restore/provenance/无物理删除）——与 05a 项目同形；
  · 🔴 写侧红线（06·B3）：POST/PATCH 带人身禁键（load/mood/self_report/score/负载/情绪…）→ 422（PersonIn
    extra=forbid 结构挡），夹带进定性字段的评分文本（role='绩效9分'）→ 422（值扫描）；**开关开也照禁**
    （经理手填=替人打分，恒禁，不随投影开关解禁）；
  · 开关关：手编人员卡零数字；开关开：手编人无自述数据 → 卡上无 self_report（absent 收起，不编造）；
  · pg 序列化往返保住 archived + provenance；
  · HTTP 端点：同体 404 / 422 / 停用可恢复 / archived_people / 无 DELETE 路由。
"""
from __future__ import annotations

import tempfile
from dataclasses import asdict
from pathlib import Path

import pytest

from avery.ingest.extract import ExtractionResult, PersonEntity
from avery.ingest.registry import ContextRegistry, CompanyContext, MANUAL_SOURCE
from avery.ingest.store import KeywordStore

fastapi_testclient = pytest.importorskip("fastapi.testclient")
from fastapi.testclient import TestClient  # noqa: E402

HERE = Path(__file__).resolve().parent.parent
FIX = HERE / "tests" / "fixtures" / "ingest"
HANDBOOK = FIX / "Studio_Handbook.md"
ROSTER = FIX / "Team_Roster.xlsx"


# ── registry 内存实现的 CRUD 合约 ────────────────────────────────────────────────────────────────
def _mk_registry_ctx():
    reg = ContextRegistry()
    ctx = CompanyContext(context_id="c1", extraction=ExtractionResult(),
                         store=KeywordStore(), memory_dir=Path(tempfile.gettempdir()))
    reg.put(ctx)
    return reg, ctx


def test_add_person_marks_every_field_manual_and_is_qualitative():
    reg, ctx = _mk_registry_ctx()
    p = reg.add_person("c1", {"name": "陈静", "role": "前厅主管", "team": "前厅部",
                              "tenure": "3 年", "owns": ["草坪婚宴档"]})
    assert p.id.startswith("um-")
    for f in ("name", "role", "team", "tenure", "owns"):
        assert p.provenance[f]["origin"] == "manual"
        assert p.provenance[f]["source"] == MANUAL_SOURCE
    card = ctx.team_cards()[0]
    assert card["name"] == "陈静" and card["role"] == "前厅主管"
    assert card["provenance"]["name"]["source"] == MANUAL_SOURCE
    # 🔴 手编人零人身数字：卡上无 self_report（哪怕开关，见 HTTP 测试）。
    assert "self_report" not in card


def test_patch_person_null_clears_field_absent():
    reg, ctx = _mk_registry_ctx()
    p = reg.add_person("c1", {"name": "小王", "role": "主管", "team": "客房部"})
    reg.patch_person("c1", p.id, {"team": None, "role": "领班"})
    card = ctx.team_cards()[0]
    assert "team" not in card, "置空的 team 必须从卡上消失（absent≠none）"
    assert card["role"] == "领班"
    assert card["provenance"]["role"]["origin"] == "manual"


def test_archive_person_soft_reversible_no_physical_delete():
    reg, ctx = _mk_registry_ctx()
    p = reg.add_person("c1", {"name": "小张"})
    reg.archive_person("c1", p.id)
    assert len(ctx.team_cards()) == 0 and len(ctx.archived_people_cards()) == 1
    assert any(x.id == p.id for x in ctx.extraction.people)  # 未物理删除
    reg.restore_person("c1", p.id)
    assert len(ctx.team_cards()) == 1 and len(ctx.archived_people_cards()) == 0
    assert not any(hasattr(reg, m) for m in ("delete_person", "remove_person", "drop_person"))


def test_unknown_ctx_or_person_raises_keyerror():
    reg, ctx = _mk_registry_ctx()
    with pytest.raises(KeyError):
        reg.add_person("missing_ctx", {"name": "x"})
    with pytest.raises(KeyError):
        reg.patch_person("c1", "no_such_person", {"name": "x"})


# ── 🔴 写侧红线（06 核心）：人身数字禁键 + 夹带评分值，均 → ValueError（端点转 422）───────────────────
def test_smuggled_score_in_qualitative_field_raises():
    reg, ctx = _mk_registry_ctx()
    # 把评分藏进定性字段（role='绩效9分'）→ 值扫描逮住 → ValueError。
    with pytest.raises(ValueError):
        reg.add_person("c1", {"name": "老李", "role": "绩效9分"})
    # 半改防护：被拒后 people 里没有这个人（add 未 append）。
    assert not any(x.name == "老李" for x in ctx.extraction.people)


def test_patch_smuggled_score_leaves_entity_unchanged():
    reg, ctx = _mk_registry_ctx()
    p = reg.add_person("c1", {"name": "阿珍", "role": "主管"})
    with pytest.raises(ValueError):
        reg.patch_person("c1", p.id, {"tenure": "KPI 95 分"})
    # 🔴 红线失败不留半改：实体 role/tenure 一字未动（内存活引用不许被污染）。
    fresh = ctx._find_person(p.id)
    assert fresh.role == "主管" and fresh.tenure == ""


def test_redline_unconditional_even_when_scoring_switch_on(monkeypatch):
    # 🔴 手填即禁，不随投影开关解禁（开关只管文档自述通道的投影）。
    monkeypatch.setenv("AVERY_ALLOW_PERSON_SCORING", "1")
    import avery.scoring_policy as sp
    assert sp.person_scoring_allowed() is True
    reg, ctx = _mk_registry_ctx()
    with pytest.raises(ValueError):
        reg.add_person("c1", {"name": "王姐", "role": "情绪 3 分"})


# ── pg 实现：序列化往返保住 additive 字段（离线，无 live DB）────────────────────────────────────
def test_pg_serialization_roundtrip_preserves_archived_and_provenance():
    from avery.ingest.pg_registry import _entity, _PERSON_FIELDS
    prov = {"name": {"origin": "manual", "source": MANUAL_SOURCE, "updated_at": "2026-07-23T00:00:00Z"}}
    p = PersonEntity(id="um-x", name="陈静", archived=True, provenance=prov)
    rebuilt = _entity(PersonEntity, _PERSON_FIELDS, asdict(p))
    assert rebuilt.archived is True, "archived 必须存活于 JSONB 往返"
    assert rebuilt.provenance == prov, "provenance side-car 必须逐字存活于 JSONB 往返"


# ── HTTP 端点 ────────────────────────────────────────────────────────────────────────────────────
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


def test_http_person_add_edit_archive_restore_flow(client):
    cid, hdr = _ingest(client)
    r = client.post(f"/team/{cid}/people",
                    json={"name": "周敏", "role": "餐饮主管", "team": "餐饮部"}, headers=hdr)
    assert r.status_code == 200, r.text
    card = r.json()["person"]
    pid = card["id"]
    assert card["provenance"]["name"]["source"] == MANUAL_SOURCE
    assert "self_report" not in card  # 手编人零人身数字
    people = client.get(f"/team/{cid}", headers=hdr).json()["people"]
    assert any(x["id"] == pid for x in people), "手动加的成员应即时进目录网格"

    # 编辑 → 值变 + origin manual。
    r = client.patch(f"/team/{cid}/people/{pid}", json={"role": "餐饮部经理"}, headers=hdr)
    assert r.status_code == 200 and r.json()["person"]["role"] == "餐饮部经理"

    # PATCH 置空 team → absent。
    r = client.patch(f"/team/{cid}/people/{pid}", json={"team": None}, headers=hdr)
    assert "team" not in r.json()["person"], "置空 team 必须 absent"

    # 停用 → 出目录、进 archived_people；恢复 → 回来。
    assert client.post(f"/team/{cid}/people/{pid}/archive", headers=hdr).status_code == 200
    payload = client.get(f"/team/{cid}", headers=hdr).json()
    assert not any(x["id"] == pid for x in payload["people"])
    assert any(x["id"] == pid for x in payload.get("archived_people", []))
    assert client.post(f"/team/{cid}/people/{pid}/restore", headers=hdr).status_code == 200
    payload = client.get(f"/team/{cid}", headers=hdr).json()
    assert any(x["id"] == pid for x in payload["people"])
    assert "archived_people" not in payload  # 空即缺席


def test_http_person_body_forbidden_keys_422(client):
    cid, hdr = _ingest(client)
    # 🔴 人身数字禁键 → Pydantic extra=forbid → 422（人身数字只能来自文档自述通道）。
    for bad in ({"name": "x", "load": 80},
                {"name": "x", "mood": "吃紧"},
                {"name": "x", "self_report": {"load": {"value": 90}}},
                {"name": "x", "score": 9},
                {"name": "x", "负载": 70}):
        r = client.post(f"/team/{cid}/people", json=bad, headers=hdr)
        assert r.status_code == 422, f"禁键 {list(bad)[1]} 应 422，实得 {r.status_code}"


def test_http_person_smuggled_score_value_422(client):
    cid, hdr = _ingest(client)
    # 夹带进定性字段的评分文本 → 值扫描 → 422。
    r = client.post(f"/team/{cid}/people", json={"name": "老李", "role": "绩效9分"}, headers=hdr)
    assert r.status_code == 422, r.text


def test_http_auth_and_validation(client):
    cid, hdr = _ingest(client)
    assert client.post(f"/team/{cid}/people", json={"name": "x"}).status_code == 404       # 无鉴权→同体 404
    assert client.post(f"/team/{cid}/people", json={"name": "x"},
                       headers={"X-Avery-Token": "wrong"}).status_code == 404               # 坏 token→404
    assert client.post(f"/team/{cid}/people", json={"role": "x"}, headers=hdr).status_code == 422  # 缺 name→422
    assert client.patch(f"/team/{cid}/people/nope", json={"name": "x"}, headers=hdr).status_code == 404
    assert client.post(f"/team/{cid}/people/nope/archive", headers=hdr).status_code == 404


def test_http_no_physical_delete_route(client):
    cid, hdr = _ingest(client)
    pid = client.post(f"/team/{cid}/people", json={"name": "x"}, headers=hdr).json()["person"]["id"]
    assert client.delete(f"/team/{cid}/people/{pid}", headers=hdr).status_code == 405
