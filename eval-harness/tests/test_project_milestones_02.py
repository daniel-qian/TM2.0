"""rich-align-0722 · issue 02 — project milestones (PRD A1/A2 line 3).

Locks the milestone syntax: `里程碑：` label line + following `- 名称（状态）` list lines.
  * status vocab 已完成→done / 进行中→active / 受阻→blocked / 未开始→upcoming (+English synonyms).
  * out-of-vocab status → status='other' + statusRaw keeps the doc's original word (回显, not rewritten).
  * multi-line collection stops at a blank line OR the next field label (never eats 阻塞/风险/etc).
  * projection omits the milestones key when absent (absent≠none); statusRaw only sent for other.
"""
from __future__ import annotations

from avery.ingest import ContextRegistry, ingest_docs, parse_bytes
from avery.ingest.extract import HeuristicExtractor


def _project(md_text: str):
    doc = parse_bytes("proj.md", md_text.encode("utf-8"))
    ex = HeuristicExtractor().extract(doc)
    assert ex.projects, "no project extracted"
    return ex.projects[0]


def _card(md_text: str) -> dict:
    reg = ContextRegistry()
    rep = ingest_docs([parse_bytes("proj.md", md_text.encode("utf-8"))],
                      extractor=HeuristicExtractor(), registry=reg)
    cards = rep.context.project_cards()
    assert cards, "no project card projected"
    return cards[0]


def test_milestones_four_state_vocab():
    p = _project("# 婚宴项目\n状态：进行中\n里程碑：\n- 场地确认（已完成）\n- 布置施工（进行中）\n"
                 "- 物料到位（受阻）\n- 验收交付（未开始）\n")
    got = [(m.name, m.status) for m in p.milestones]
    assert got == [("场地确认", "done"), ("布置施工", "active"),
                   ("物料到位", "blocked"), ("验收交付", "upcoming")]
    assert all(m.statusRaw == "" for m in p.milestones)


def test_milestone_english_synonyms():
    p = _project("# Vendor\n状态：进行中\nMilestones:\n- Scope sign-off (done)\n- Build (in progress)\n")
    assert [(m.name, m.status) for m in p.milestones] == [
        ("Scope sign-off", "done"), ("Build", "active")]


def test_milestone_out_of_vocab_is_other_with_raw():
    p = _project("# 项目\n状态：进行中\n里程碑：\n- 初步方案（待定）\n")
    assert len(p.milestones) == 1
    m = p.milestones[0]
    assert m.status == "other"
    assert m.statusRaw == "待定", "词表外状态必须原样回显，不改写成 upcoming 灰"


def test_milestone_list_stops_at_next_field_label():
    # 列表后紧跟 `阻塞：` —— 收集必须在标签处停，别把卡点吞进里程碑。
    p = _project("# 项目\n状态：进行中\n里程碑：\n- 场地确认（已完成）\n阻塞：供应商未定\n")
    assert [m.name for m in p.milestones] == ["场地确认"]
    assert any("供应商未定" in b for b in p.blockers), "阻塞行应仍进 blockers，不被里程碑吞掉"


def test_milestone_list_stops_at_blank_line():
    p = _project("# 项目\n状态：进行中\n里程碑：\n- 场地确认（已完成）\n\n本周稳步推进。\n")
    assert [m.name for m in p.milestones] == ["场地确认"]


def test_projection_carries_milestones_statusraw_only_for_other():
    card = _card("# 项目\n状态：进行中\n里程碑：\n- 场地确认（已完成）\n- 初步方案（待定）\n")
    assert card.get("milestones") == [
        {"name": "场地确认", "status": "done"},
        {"name": "初步方案", "status": "other", "statusRaw": "待定"},
    ]


def test_projection_omits_milestones_when_absent():
    card = _card("# 项目\n负责人：小王\n状态：进行中\n")
    assert "milestones" not in card, "没有里程碑块就不投影 milestones 键（absent≠none）"
