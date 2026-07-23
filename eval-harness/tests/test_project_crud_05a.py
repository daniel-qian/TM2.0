# -*- coding: utf-8 -*-
"""rich-align-0722/05a · 真 CRUD·项目（手编赢 + 逐字段出处 + 软删可逆）—— 写端点先例，全离线。

强制全离线配置（mock brain / keyword recall / heuristic extractor / 无 DB），进默认套跑，零网络零 DB。
覆盖三层：
  · registry 内存实现的 CRUD 合约（add/patch/archive/restore/provenance/无物理删除）；
  · pg 实现的**序列化往返**（asdict→_entity 保住 archived + provenance 两个 additive 字段，离线可验——
    pg 的 CRUD 方法是 ProjectWriteMixin 的 get→mutate→put，与内存结构同形，唯一 pg 特有风险=存储往返，
    此处覆盖之；带 live DB 的 pg CRUD 走 @needs_db，非本套）；
  · HTTP 端点（照 notes 先例）：无鉴权/坏 token 同体 404；坏体 422；PATCH 置空→absent；archive 后可
    restore；无 DELETE 路由（软删可逆，无物理删除）。
"""
from __future__ import annotations

import tempfile
from dataclasses import asdict
from pathlib import Path

import pytest

from avery.ingest.extract import ExtractionResult, ProjectEntity
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


def test_add_project_marks_every_field_manual():
    reg, ctx = _mk_registry_ctx()
    pr = reg.add_project("c1", {"title": "草坪婚宴档", "status": "at-risk", "progress": 60,
                                "risk": {"level": "高", "reason": "雨季"},
                                "milestones": [{"name": "场地确认", "status": "已完成"}]})
    assert pr.id.startswith("pm-")
    # 每个提供的字段（含 title）都置 manual 出处，source=系统自证式短语。
    for f in ("title", "status", "progress", "risk", "milestones"):
        assert pr.provenance[f]["origin"] == "manual"
        assert pr.provenance[f]["source"] == MANUAL_SOURCE
    card = ctx.project_cards()[0]
    assert card["risk"]["level"] == "high"          # 归一
    assert card["milestones"][0]["status"] == "done"
    assert card["provenance"]["title"]["source"] == MANUAL_SOURCE


def test_patch_null_clears_field_absent_not_zero():
    reg, ctx = _mk_registry_ctx()
    pr = reg.add_project("c1", {"title": "A", "progress": 50, "status": "on-track"})
    # 置空 progress（显式 None）→ 卡上该键缺席（absent≠none：绝不 0%）。
    reg.patch_project("c1", pr.id, {"progress": None, "status": "blocked"})
    card = ctx.project_cards()[0]
    assert "progress" not in card, "置空的 progress 必须从卡上消失，不折算成 0%"
    assert card["status"] == "blocked"
    assert card["provenance"]["status"]["origin"] == "manual"


def test_archive_is_soft_and_reversible_no_physical_delete():
    reg, ctx = _mk_registry_ctx()
    pr = reg.add_project("c1", {"title": "B"})
    reg.archive_project("c1", pr.id)
    assert len(ctx.project_cards()) == 0 and len(ctx.archived_project_cards()) == 1
    # 实体仍在 extraction（未物理删除）——只是 archived 标记。
    assert any(p.id == pr.id for p in ctx.extraction.projects)
    reg.restore_project("c1", pr.id)
    assert len(ctx.project_cards()) == 1 and len(ctx.archived_project_cards()) == 0
    # registry 上不存在任何删除项目的方法（软删哲学=无物理删除路径）。
    assert not any(hasattr(reg, m) for m in ("delete_project", "remove_project", "drop_project"))


def test_unknown_ctx_or_project_raises_keyerror():
    reg, ctx = _mk_registry_ctx()
    with pytest.raises(KeyError):
        reg.add_project("missing_ctx", {"title": "x"})
    with pytest.raises(KeyError):
        reg.patch_project("c1", "no_such_project", {"title": "x"})


# ── pg 实现：序列化往返保住 additive 字段（离线，无 live DB）────────────────────────────────────
def test_pg_serialization_roundtrip_preserves_archived_and_provenance():
    from avery.ingest.pg_registry import _entity, _PROJECT_FIELDS
    prov = {"title": {"origin": "manual", "source": MANUAL_SOURCE, "updated_at": "2026-07-23T00:00:00Z"}}
    pr = ProjectEntity(id="pm-x", title="草坪", archived=True, provenance=prov)
    rebuilt = _entity(ProjectEntity, _PROJECT_FIELDS, asdict(pr))
    assert rebuilt.archived is True, "archived 必须存活于 JSONB 往返"
    assert rebuilt.provenance == prov, "provenance side-car 必须逐字存活于 JSONB 往返"


# ── HTTP 端点（照 notes 写端点先例）────────────────────────────────────────────────────────────
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


def test_http_add_edit_archive_restore_flow(client):
    cid, hdr = _ingest(client)
    # 添加 → 200 + 出处「手动编辑」+ 进主网格。
    r = client.post(f"/team/{cid}/projects",
                    json={"title": "草坪婚宴旺季档", "status": "at-risk", "progress": 40}, headers=hdr)
    assert r.status_code == 200, r.text
    card = r.json()["project"]
    pid = card["id"]
    assert card["provenance"]["title"]["source"] == MANUAL_SOURCE
    projects = client.get(f"/team/{cid}", headers=hdr).json()["projects"]
    assert any(p["id"] == pid for p in projects), "手动加的项目应即时进主网格"

    # 编辑 → 值变 + origin manual。
    r = client.patch(f"/team/{cid}/projects/{pid}", json={"status": "blocked"}, headers=hdr)
    assert r.status_code == 200
    assert r.json()["project"]["status"] == "blocked"

    # PATCH 置空 progress → 卡上 absent（不 0%）。
    r = client.patch(f"/team/{cid}/projects/{pid}", json={"progress": None}, headers=hdr)
    assert "progress" not in r.json()["project"], "置空 progress 必须 absent，绝不 0%"

    # 归档 → 出主网格、进 archived_projects；恢复 → 回来。
    assert client.post(f"/team/{cid}/projects/{pid}/archive", headers=hdr).status_code == 200
    payload = client.get(f"/team/{cid}", headers=hdr).json()
    assert not any(p["id"] == pid for p in payload["projects"])
    assert any(p["id"] == pid for p in payload.get("archived_projects", []))
    assert client.post(f"/team/{cid}/projects/{pid}/restore", headers=hdr).status_code == 200
    payload = client.get(f"/team/{cid}", headers=hdr).json()
    assert any(p["id"] == pid for p in payload["projects"])
    assert "archived_projects" not in payload  # 空即缺席（absent≠none）


def test_http_auth_and_validation(client):
    cid, hdr = _ingest(client)
    # 无鉴权 → 同体 404（无存在性 oracle）。
    assert client.post(f"/team/{cid}/projects", json={"title": "x"}).status_code == 404
    # 坏 token → 同体 404。
    assert client.post(f"/team/{cid}/projects", json={"title": "x"},
                       headers={"X-Avery-Token": "wrong"}).status_code == 404
    # 坏体（缺 title）→ 422。
    assert client.post(f"/team/{cid}/projects", json={"status": "on-track"}, headers=hdr).status_code == 422
    # 未知 project → 404。
    assert client.patch(f"/team/{cid}/projects/nope", json={"title": "x"}, headers=hdr).status_code == 404
    assert client.post(f"/team/{cid}/projects/nope/archive", headers=hdr).status_code == 404


def test_http_no_physical_delete_route(client):
    cid, hdr = _ingest(client)
    pid = client.post(f"/team/{cid}/projects", json={"title": "x"}, headers=hdr).json()["project"]["id"]
    # 无 DELETE 路由（归档=软删可逆，绝不物理删除）→ 405 Method Not Allowed。
    assert client.delete(f"/team/{cid}/projects/{pid}", headers=hdr).status_code == 405
