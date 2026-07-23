# -*- coding: utf-8 -*-
"""rich-align-0722/08 · playbooks 方法卡 —— SOP 文档 → {title, description, tags[]} 抽取 + 投影合约（全离线）。

PRD D 定稿语法（07 语料 `管理规范与升级红线.md` 已按此写）：
  `## 方法：<标题>` 小节 + `适用：…`（→ description）+ `要点：` 列表（卡内不展开，留详情）+
  `标签：a、b、c`（→ tags，、分隔）。`## 说明` 免责段不是方法卡。

本文件断言的行为：
  * 抽取器把 5 个 `## 方法：` 小节抽成 5 张方法卡，标题/标签逐字对上 SOP，description 取自适用行。
  * `## 说明` 段不被误抽成卡（边界止于下一个 `##`）。
  * absent≠none：非 SOP 文档（花名册/周报）→ 零方法卡 → payload 不发 `playbooks` 键。
  * /demo/claim（三亚满态）payload 带 `playbooks`，5 张卡，标题/标签对得上。
  * 方法卡不过人身评分红线（materials/method 面，非 person/signal）——claim 仍 200。
  * LLM 抽取路径（生产暖场）也确定性地投出方法卡（复用 heuristic chunker，同 materials）。
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

fastapi_testclient = pytest.importorskip("fastapi.testclient")
from fastapi.testclient import TestClient  # noqa: E402

HERE = Path(__file__).resolve().parent.parent          # eval-harness/
SEED_DIR = HERE / "tests" / "fixtures" / "demo-seed"
SOP_FILE = SEED_DIR / "管理规范与升级红线.md"

# 5 张方法卡（`管理规范与升级红线.md` 的 5 个 `## 方法：` 小节，逐字标题）。
SANYA_METHOD_TITLES = [
    "重大宴会跨部门协作闭环",
    "旺季跨部门产能协调",
    "项目事项红黄蓝过程管控",
    "升级与红线判定",
    "新人爬坡期公平判断",
]
# 标签逐字对照（、分隔，_OWNS_SPLIT_RE 覆盖）。
SANYA_METHOD_TAGS = {
    "重大宴会跨部门协作闭环": ["宴会", "跨部门", "协调会", "BEO", "复盘"],
    "旺季跨部门产能协调": ["旺季", "产能", "排班", "看板", "协调"],
    "项目事项红黄蓝过程管控": ["项目", "周例会", "预警", "过程管控"],
    "升级与红线判定": ["升级", "红线", "法务", "安全", "关怀"],
    "新人爬坡期公平判断": ["新人", "爬坡", "协助", "公平"],
}


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
    _offline_env(monkeypatch)
    monkeypatch.setenv("AVERY_DEMO_SEED_DIR", str(SEED_DIR))
    monkeypatch.delenv("AVERY_DEMO_CONTEXT_ID", raising=False)
    from service.app import app
    return TestClient(app)


def _claim(client) -> tuple[str, dict, dict]:
    r = client.post("/demo/claim")
    assert r.status_code == 200, f"/demo/claim failed: {r.text[:300]}"
    body = r.json()
    return body["context_id"], {"X-Avery-Token": body["owner_token"]}, body


# ── 抽取器单元层 ──────────────────────────────────────────────────────────────────────────


def test_extractor_parses_five_method_cards():
    from avery.ingest.parse import parse_file
    from avery.ingest.extract import HeuristicExtractor
    res = HeuristicExtractor().extract(parse_file(SOP_FILE))
    titles = [c.title for c in res.playbooks]
    assert len(res.playbooks) == 5, f"应抽出 5 张方法卡，实到 {len(titles)}：{titles}"
    assert titles == SANYA_METHOD_TITLES, f"标题/顺序与 SOP 不符：{titles}"
    for c in res.playbooks:
        assert c.description, f"方法卡「{c.title}」description（适用行）为空"
        assert c.tags == SANYA_METHOD_TAGS[c.title], f"方法卡「{c.title}」标签不符：{c.tags}"


def test_shuoming_section_is_not_a_method_card():
    """`## 说明` 免责段不是方法卡——边界止于下一个 `##`，count 仍是 5。"""
    from avery.ingest.parse import parse_file
    from avery.ingest.extract import HeuristicExtractor
    res = HeuristicExtractor().extract(parse_file(SOP_FILE))
    assert all("说明" not in c.title for c in res.playbooks)
    assert len(res.playbooks) == 5


def test_non_sop_doc_yields_no_playbooks():
    """absent≠none：花名册/周报无 `## 方法：` → 零方法卡。"""
    from avery.ingest.parse import parse_bytes
    from avery.ingest.extract import HeuristicExtractor
    roster = "\n".join(["# 花名册", "", "姓名 | 职位 | 部门", "小王 | 经理 | 前厅部", ""])
    weekly = "\n".join(["# 周报", "", "## 项目：渠道分销", "负责人：小王", "进度：60%", ""])
    ex = HeuristicExtractor()
    assert ex.extract(parse_bytes("roster.md", roster.encode("utf-8"))).playbooks == []
    assert ex.extract(parse_bytes("weekly.md", weekly.encode("utf-8"))).playbooks == []


def test_payload_omits_playbooks_key_when_absent():
    """absent≠none 投影层：无方法卡的 context → _team_payload 不发 `playbooks` 键。"""
    from avery.ingest.parse import parse_bytes
    from avery.ingest import ingest_docs
    from avery.ingest.extract import HeuristicExtractor
    from service.ingest_api import _team_payload
    roster = "\n".join(["# 花名册", "", "姓名 | 职位 | 部门", "小王 | 经理 | 前厅部", ""])
    report = ingest_docs([parse_bytes("roster.md", roster.encode("utf-8"))],
                         extractor=HeuristicExtractor())
    payload = _team_payload(report.context)
    assert "playbooks" not in payload, "无方法卡时 payload 不该带 playbooks 键（absent≠none）"


def test_payload_carries_playbooks_when_present():
    """满态投影：含 SOP 的 context → _team_payload 带 `playbooks`，5 张卡，形状对。"""
    from avery.ingest.parse import parse_file
    from avery.ingest import ingest_docs
    from avery.ingest.extract import HeuristicExtractor
    from service.ingest_api import _team_payload
    report = ingest_docs([parse_file(SOP_FILE)], extractor=HeuristicExtractor())
    payload = _team_payload(report.context)
    pb = payload.get("playbooks")
    assert pb and len(pb) == 5, f"含 SOP 的 context 应投 5 张方法卡：{pb}"
    for card in pb:
        assert set(card) >= {"title", "description", "tags"}, f"方法卡键不全：{card}"
        assert isinstance(card["tags"], list) and card["tags"]


# ── /demo/claim（三亚满态）──────────────────────────────────────────────────────────────


def test_sanya_claim_carries_five_method_cards(client):
    _, _, body = _claim(client)
    pb = body.get("playbooks")
    assert pb, "三亚满态 demo 应投影 playbooks 方法卡（管理规范与升级红线.md 的 5 张）"
    titles = [c["title"] for c in pb]
    assert len(pb) == 5, f"应 5 张方法卡，实到 {len(titles)}：{titles}"
    missing = [t for t in SANYA_METHOD_TITLES if t not in titles]
    assert not missing, f"缺方法卡：{missing}（实到：{titles}）"
    for c in pb:
        assert c.get("description"), f"方法卡「{c['title']}」缺 description"
        assert c.get("tags") == SANYA_METHOD_TAGS[c["title"]], f"方法卡「{c['title']}」标签不符：{c.get('tags')}"


def test_method_cards_carry_no_person_score(client):
    """方法卡是 SOP 面（含「升级红线」「新人爬坡」等提到员工的卡）——但零人身评分数字/词。"""
    _, _, body = _claim(client)
    blob = json.dumps(body["playbooks"], ensure_ascii=False)
    for banned in ("打分", "评分", "得分", "绩效", "排名", "画像", "KPI", "分数"):
        assert banned not in blob, f"方法卡泄漏评分词「{banned}」：{blob[:200]}"


# ── LLM 抽取路径（生产暖场也确定性投卡）─────────────────────────────────────────────────


def test_llm_extractor_still_emits_method_cards():
    """LLM 路径 _build 复用 heuristic chunker（同 materials）确定性投方法卡——即便模型没读到结构化实体。"""
    from avery.ingest.parse import parse_file
    from avery.ingest.llm_extract import LLMExtractor

    class _EmptyBrain:
        def respond(self, *a, **k):
            class _R:
                text = "{}"
            return _R()

    res = LLMExtractor(_EmptyBrain(), retry_backoff_s=0.0)._build(parse_file(SOP_FILE), {})
    assert len(res.playbooks) == 5, f"LLM _build 应确定性投 5 张方法卡，实到 {len(res.playbooks)}"
