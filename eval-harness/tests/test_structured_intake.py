# -*- coding: utf-8 -*-
"""`POST /ingest/structured` 的行为电池 —— onboarding-accounts-0805 ①（ADR-0034 拍板 1/2/3）。

全程离线（mock brain + keyword recall + heuristic extractor + 无 DB），与 test_notes_http.py
同一套 fixture 纪律。量四件事：

  (a) **确定性映射**：01→人卡、02→项目卡、04/05 充实项目卡、03/06/07 进材料库——逐字段对着
      我们发出去的那份 xlsx 说明页（INTAKE）的承诺量，不是对着实现量。
  (b) **红线整发拒**（拍板 2）：07 表写分数 → 422，`violations` 与 /ingest 逐键同形，
      `cells` 指得到具体的表/行/列，且**没有任何 context 被注册**（同一批里的 01/02 一起作废）。
  (c) **混合发 = 一个 context**（拍板 3）：行 + 文件同发，人数 = 行人数 + 文件抽取人数
      （刻意不跨源去重，理由见 pipeline.ingest_docs 的 extra_extraction 注释）。
  (d) **悬空引用不硬拒**：02 的负责人ID 在 01 里找不到 → warnings，200 照常。

🔴 语料里必须有真汉字（AGENTS.md「门语料全 ASCII 盲点」是旧账）：本文件的每一条表格行都是
中文，红线用例用的也是中文写法（「绩效 2 分」「排名倒数第一」），不是 ASCII 的 "8/10"。
"""
from __future__ import annotations

from pathlib import Path

import pytest

fastapi_testclient = pytest.importorskip("fastapi.testclient")
from fastapi.testclient import TestClient  # noqa: E402

HERE = Path(__file__).resolve().parent
FIX = HERE / "fixtures" / "ingest"
ROSTER_XLSX = FIX / "Team_Roster.xlsx"
HANDBOOK = FIX / "Studio_Handbook.md"


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


# ── 语料：一份真实形状的小公司填表结果（全中文）────────────────────────────────────────────
ROSTER_ROWS = [
    {"姓名": "陈思雨", "岗位": "市场经理", "部门": "市场部", "司龄": "3 年",
     "主要负责": "华东区渠道投放的方案与执行、秋季发布会统筹", "人员ID": "MKT-001",
     "直属上级ID": "MKT-000", "任职状态": "在职", "入职日期": "2023-04-10"},
    {"姓名": "李明轩", "岗位": "内容主管", "部门": "市场部", "司龄": "1 年 6 个月",
     "主要负责": "公众号与短视频内容", "人员ID": "MKT-002",
     "直属上级ID": "MKT-001", "任职状态": "试用期", "入职日期": "2025-01-06"},
]

PROJECT_ROWS = [
    {"项目ID": "PRJ-2026-01", "项目名称": "秋季新品发布会", "负责人ID": "MKT-001",
     "当前状态": "进行中", "开始日期": "2026-06-01", "计划完成日期": "2026-09-20",
     "完成进度": "45", "项目目标": "覆盖 3 家行业媒体、留资 500 条"},
    {"项目ID": "PRJ-2026-02", "项目名称": "渠道投放优化", "负责人ID": "MKT-404",
     "当前状态": "已暂停", "开始日期": "2026-05-01", "计划完成日期": "2026-08-31",
     "完成进度": "八成", "项目目标": "把留资成本压到 40 元以内"},
]


def _post(client, tables, files=None, headers=None):
    data = {"tables": __import__("json").dumps(tables, ensure_ascii=False)}
    return client.post("/ingest/structured", data=data, files=files or None, headers=headers)


def _ok(client, tables, files=None):
    r = _post(client, tables, files)
    assert r.status_code == 200, f"structured ingest failed: {r.status_code} {r.text[:400]}"
    return r.json()


# === (a) 确定性映射 ==========================================================================

def test_roster_rows_become_person_cards(client):
    body = _ok(client, {"01": ROSTER_ROWS})
    people = {p["name"]: p for p in body["people"]}
    assert set(people) == {"陈思雨", "李明轩"}
    chen = people["陈思雨"]
    assert chen["role"] == "市场经理"
    assert chen["team"] == "市场部"
    assert chen["tenure"] == "3 年"
    # 「主要负责」按 [,，、;；] 拆成多条 —— 与抽取器同一把尺（_OWNS_SPLIT_RE），不是新写的。
    assert chen["owns"] == ["华东区渠道投放的方案与执行", "秋季发布会统筹"]
    # 工号直接当卡 id —— 02/04/05/06/07 全靠它互指，跨表引用才连得起来。
    assert chen["id"] == "MKT-001"


def test_every_entity_carries_a_source(client):
    """票 #40 硬约束：每个实体都要有 source。

    🔴 断言落在**实体**上而不是 payload 上：`_one_person_card` 从来不投 source（/ingest 的
    人卡也没有），对着 payload 断言只会写出一条量错东西的判据。
    """
    body = _ok(client, {"01": ROSTER_ROWS, "02": PROJECT_ROWS})
    from avery.ingest.registry import active_registry
    ctx = active_registry().get(body["context_id"])
    assert len(ctx.extraction.people) == 2 and len(ctx.extraction.projects) == 2
    assert [p.source for p in ctx.extraction.people] == ["表单录入:01:行1", "表单录入:01:行2"]
    assert [p.source for p in ctx.extraction.projects] == ["表单录入:02:行1", "表单录入:02:行2"]


def test_person_card_carries_no_numbers(client):
    """红线的结构面：表格入口不许比文件入口多长出任何人身数字键。"""
    body = _ok(client, {"01": ROSTER_ROWS})
    forbidden = {"score", "moodPct", "capacityPct", "load", "mood", "rating", "rank"}
    for p in body["people"]:
        assert not (set(p) & forbidden), f"人卡长出了禁键：{sorted(set(p) & forbidden)}"


def test_project_rows_become_project_cards_with_status_vocabulary(client):
    body = _ok(client, {"01": ROSTER_ROWS, "02": PROJECT_ROWS})
    projects = {p["title"]: p for p in body["projects"]}
    assert set(projects) == {"秋季新品发布会", "渠道投放优化"}
    launch = projects["秋季新品发布会"]
    assert launch["ownerName"] == "陈思雨"          # 负责人ID 从 01 行解析出姓名
    assert launch["status"] == "on-track"           # 「进行中」走 extract._norm_status
    assert launch["progress"] == 45
    assert launch["dueDate"] == "2026-09-20"
    assert launch["summary"] == "覆盖 3 家行业媒体、留资 500 条"
    # 「已暂停」必须读成 blocked —— partner-docs-0728 的补丁就是为这个下的（下拉里给的词，
    # 卡上却写「状态未知」曾经是真发生过的）。
    assert projects["渠道投放优化"]["status"] == "blocked"


def test_unstated_progress_is_absent_not_zero(client):
    """「八成」不是 0–100 的整数 → 进度留空 + 一条 warning。**绝不折 0**（absent≠none）。"""
    body = _ok(client, {"01": ROSTER_ROWS, "02": PROJECT_ROWS})
    paused = next(p for p in body["projects"] if p["title"] == "渠道投放优化")
    assert paused.get("progress") in (None, ""), "读不懂的进度被折成了一个数字"
    kinds = {(w["table"], w["column"], w["kind"]) for w in body["intake_warnings"]}
    assert ("02", "完成进度", "unreadable-value") in kinds


def test_dangling_owner_id_warns_but_does_not_reject(client):
    """票 #40 明写：02 的负责人ID 悬空 **不硬拒**，ownerName 留空 + warnings。"""
    body = _ok(client, {"01": ROSTER_ROWS, "02": PROJECT_ROWS})
    paused = next(p for p in body["projects"] if p["title"] == "渠道投放优化")
    assert not paused.get("ownerName"), "悬空的负责人ID 不该编出一个名字"
    warned = [w for w in body["intake_warnings"]
              if w["table"] == "02" and w["column"] == "负责人ID"]
    assert warned and "MKT-404" in warned[0]["detail"]


def test_table_04_blocker_lands_on_the_project_card(client):
    """xlsx 说明页答应的是「『当前阻塞』进项目卡的阻塞项；其余进材料库」。"""
    updates = [{"更新ID": "UPD-20260724-01", "项目ID": "PRJ-2026-01", "更新日期": "2026-07-24",
                "责任人ID": "MKT-001", "下次截止日": "2026-08-01",
                "本期完成": "确认了三家媒体的档期", "下期动作": "出主视觉终稿",
                "当前阻塞": "主视觉终稿自 6 月 10 日起无更新，在等设计定稿",
                "需管理者决策": ""}]
    body = _ok(client, {"01": ROSTER_ROWS, "02": PROJECT_ROWS, "04": updates})
    launch = next(p for p in body["projects"] if p["title"] == "秋季新品发布会")
    assert any("主视觉终稿" in b for b in launch["blockers"])
    # 其余列没有被偷偷做成别的卡片：项目数没变。
    assert len(body["projects"]) == 2


def test_table_05_risk_and_blocker_enrich_the_project(client):
    issues = [
        {"事项ID": "ISS-001", "事项类型": "风险", "优先级": "低", "关联项目ID": "PRJ-2026-01",
         "发现日期": "2026-07-01", "处理截止日": "", "责任人ID": "MKT-001",
         "处理状态": "处理中", "事实描述": "场地合同尚未签署", "证据来源": "7 月 15 日周会纪要第 3 条"},
        {"事项ID": "ISS-002", "事项类型": "风险", "优先级": "高", "关联项目ID": "PRJ-2026-01",
         "发现日期": "2026-07-10", "处理截止日": "", "责任人ID": "MKT-001",
         "处理状态": "待处理", "事实描述": "主媒体档期与发布会当天冲突", "证据来源": "邮件往来"},
        {"事项ID": "ISS-003", "事项类型": "阻塞", "优先级": "中", "关联项目ID": "PRJ-2026-01",
         "发现日期": "2026-07-12", "处理截止日": "", "责任人ID": "MKT-002",
         "处理状态": "处理中", "事实描述": "物料报价单缺一版", "证据来源": "采购群 7-12 消息"},
        {"事项ID": "ISS-004", "事项类型": "客户反馈", "优先级": "中", "关联项目ID": "PRJ-2026-01",
         "发现日期": "2026-07-13", "处理截止日": "", "责任人ID": "",
         "处理状态": "已关闭", "事实描述": "客户希望增加一场闭门会", "证据来源": "客户邮件"},
    ]
    body = _ok(client, {"01": ROSTER_ROWS, "02": PROJECT_ROWS, "05": issues})
    launch = next(p for p in body["projects"] if p["title"] == "秋季新品发布会")
    # 多条风险取最重的那条（单值槽；拼接会造出谁也没写过的句子）。
    assert launch["risk"]["level"] == "high"
    assert "主媒体档期" in launch["risk"]["reason"]
    assert any("物料报价单" in b for b in launch["blockers"])
    # 「客户反馈」只进材料库，不许变成阻塞。
    assert not any("闭门会" in b for b in launch["blockers"])


def test_tables_03_06_07_only_reach_the_material_library(client):
    """三张表都只进材料库——不长卡片，但**可检索**（说明页答应的「回答时会引用」）。"""
    kpis = [{"指标ID": "KPI-001", "指标名称": "渠道留资量", "关联对象": "项目",
             "关联对象ID": "PRJ-2026-01", "统计周期": "月", "单位": "条",
             "目标值": "500", "当前值": "180", "数据截止日": "2026-07-31",
             "数据来源": "巨量引擎后台－秋季发布会计划－7月周报"}]
    reports = [{"记录ID": "RPT-20260724-001", "人员ID": "MKT-002", "述职周期": "2026-W30",
                "提交日期": "2026-07-24", "已完成事实": "完成 3 场直播，累计观看 1.2 万",
                "未达成及原因": "短视频改版被发布会挤了", "下一周期目标": "上线新栏目",
                "需要支持": "需要设计排期"}]
    body = _ok(client, {"01": ROSTER_ROWS, "02": PROJECT_ROWS, "03": kpis, "06": reports})
    assert len(body["people"]) == 2 and len(body["projects"]) == 2, "03/06 偷偷长出了卡片"
    files_r = client.get(f"/team/{body['context_id']}/files",
                         headers={"X-Avery-Token": body["owner_token"]})
    assert files_r.status_code == 200
    # 材料真的进了检索面：问一个只有 03 表才知道的词，advise 的 recall 面要够得着。
    from avery.ingest.registry import active_registry
    ctx = active_registry().get(body["context_id"])
    blob = "\n".join(m.text for m in ctx.extraction.materials)
    assert "巨量引擎后台" in blob, "03 表没进材料库"
    assert "累计观看 1.2 万" in blob, "06 表没进材料库"
    assert "指标名称" in blob, "材料库里没有表头行，检索命中了也读不懂是哪一列"


def test_every_material_chunk_has_a_source(client):
    body = _ok(client, {"01": ROSTER_ROWS, "02": PROJECT_ROWS})
    from avery.ingest.registry import active_registry
    ctx = active_registry().get(body["context_id"])
    assert ctx.extraction.materials
    for m in ctx.extraction.materials:
        assert m.source.startswith("表单录入:"), f"材料缺出处：{m}"


# === (b) 红线整发拒（拍板 2）==================================================================

REVIEW_CLEAN = {"评议ID": "REV-2026Q3-001", "被评议人员ID": "MKT-002", "评议人ID": "MKT-001",
                "评议周期": "2026Q3", "评议日期": "2026-07-20",
                "确认的优势": "三次跨部门协调都在周会前完成了对齐",
                "需改进事项": "两次物料交付在截止日当天才提出风险",
                "沟通后约定动作": "8 月起每周三同步一次物料进度"}


def test_a_clean_07_row_passes(client):
    """先证「按填写要点写就不会被拦」——没有这一条，下面的硬拒可能只是尺子太宽。"""
    body = _ok(client, {"01": ROSTER_ROWS, "07": [REVIEW_CLEAN]})
    assert len(body["people"]) == 2


@pytest.mark.parametrize("bad", [
    "绩效 2 分，需要提高",
    "完成度只有 82%",
    "本季度排名倒数第一",
    "绩效评级：不合格",
])
def test_scores_in_table_07_reject_the_whole_batch(client, bad):
    """拍板 2：07 表写分数 = **整发**作废，同一批里的 01/02 一起失败。

    这正是我们印在发出去的 xlsx 说明页上的那句话（make-intake-xlsx.py 的「00 读我」）——
    新入口不兑现它，就是用户照着我们的话填、我们自己的通道放行。
    """
    row = {**REVIEW_CLEAN, "需改进事项": bad}
    r = _post(client, {"01": ROSTER_ROWS, "02": PROJECT_ROWS, "07": [row]})
    assert r.status_code == 422, f"07 表的「{bad}」没被拦下来：{r.status_code} {r.text[:300]}"
    detail = r.json()["detail"]
    # 形状与 /ingest 的 422 逐键相同（前端只有一段解析代码）。
    assert detail["error"] == "extraction refused"
    assert detail["violations"] and all(
        set(v) == {"kind", "person", "detail", "rule_id"} for v in detail["violations"])
    # 坐标：指得到表 / 行 / 列（票 #41 要把 422 映射回具体的格）。
    cells = detail["cells"]
    assert any(c["table"] == "07" and c["row"] == 1 and c["column"] == "需改进事项" for c in cells)
    # 被评议人指名的是**姓名**（从 01 行解析），不是一串工号 —— 报错要给人看。
    assert any(v["person"] == "李明轩" for v in detail["violations"])


def test_a_rejected_batch_registers_no_context(client):
    """整发拒不是"拒一半"：库里必须一个 context 都没多出来。"""
    from avery.ingest.registry import active_registry
    before = len(active_registry().list_ids()) if hasattr(active_registry(), "list_ids") else None
    row = {**REVIEW_CLEAN, "需改进事项": "绩效 2 分"}
    r = _post(client, {"01": ROSTER_ROWS, "07": [row]})
    assert r.status_code == 422
    if before is not None:
        assert len(active_registry().list_ids()) == before


def test_scores_in_the_roster_reject_too_and_point_at_the_cell(client):
    """01 的人身列走的是 /ingest 那道权威门；这里多量的是「指得回哪一格」。"""
    rows = [dict(ROSTER_ROWS[0]), dict(ROSTER_ROWS[1])]
    rows[1]["岗位"] = "内容主管（绩效 2 分）"
    r = _post(client, {"01": rows})
    assert r.status_code == 422
    detail = r.json()["detail"]
    assert any(c["table"] == "01" and c["row"] == 2 and c["column"] == "岗位"
               for c in detail["cells"])


def test_work_quantification_still_passes(client):
    """ADR-0016 的不对称必须守住：公司/工作产物的量化不是人身评分。
    这一条是防「尺子太宽」的自证——它红了说明上面那批硬拒是误伤堆出来的。"""
    kpis = [{"指标ID": "KPI-001", "指标名称": "渠道留资量", "关联对象": "项目",
             "关联对象ID": "PRJ-2026-01", "统计周期": "月", "单位": "条",
             "目标值": "500", "当前值": "180", "数据截止日": "2026-07-31",
             "数据来源": "7 月周报"}]
    reports = [{"记录ID": "RPT-1", "人员ID": "MKT-002", "述职周期": "2026-W30",
                "提交日期": "2026-07-24", "已完成事实": "转化率从 8% 提到 12%",
                "未达成及原因": "预算未到位", "下一周期目标": "上线新栏目", "需要支持": "设计排期"}]
    body = _ok(client, {"01": ROSTER_ROWS, "02": PROJECT_ROWS, "03": kpis, "06": reports})
    assert len(body["people"]) == 2


# === (c) 混合发 = 一个 context（拍板 3）=======================================================

def _file_part(path: Path):
    return ("files", (path.name, path.read_bytes(), "application/octet-stream"))


def test_rows_and_files_land_in_one_context(client):
    """一次提交 = 一个 context（拍板 3），人数 = 行人数 + 文件抽取人数（票 #40 验收原话）。"""
    files_only = _ok(client, {}, files=[_file_part(ROSTER_XLSX)])
    from_files = len(files_only["people"])
    assert from_files > 0, "基线为空 —— 这条断言会恒真（空真是验证器撒谎的第一形态）"

    mixed = _ok(client, {"01": ROSTER_ROWS, "02": PROJECT_ROWS},
                files=[_file_part(ROSTER_XLSX), _file_part(HANDBOOK)])
    assert mixed["context_id"] != files_only["context_id"]
    assert len(mixed["people"]) == from_files + len(ROSTER_ROWS)
    assert any(p["name"] == "陈思雨" for p in mixed["people"]), "表格里的人不见了"
    # 文件也真的进了这**同一个** context 的文件空间。
    manifest = client.get(f"/team/{mixed['context_id']}/files",
                          headers={"X-Avery-Token": mixed["owner_token"]}).json()
    assert {f["filename"] for f in manifest["files"]} == {ROSTER_XLSX.name, HANDBOOK.name}


def test_pure_table_submit_reports_structured_mode(client):
    """纯表格提交一个模型都没调用——诚实标必须说出来（前端的等待态按它分支）。"""
    body = _ok(client, {"01": ROSTER_ROWS})
    assert body["extraction_mode"] == "structured"
    assert body["intake_rows"] == len(ROSTER_ROWS)


def test_mixed_submit_reports_the_real_file_extraction_mode(client):
    body = _ok(client, {"01": ROSTER_ROWS}, files=[_file_part(HANDBOOK)])
    assert body["extraction_mode"] == "heuristic"


def test_owner_token_gates_the_new_context_like_any_other(client):
    """租户语义照抄 /ingest：没 token 一律同体 404，无存在性 oracle。"""
    body = _ok(client, {"01": ROSTER_ROWS})
    cid = body["context_id"]
    assert client.get(f"/team/{cid}").status_code == 404
    assert client.get(f"/team/{cid}", headers={"X-Avery-Token": "wrong"}).status_code == 404
    assert client.get(f"/team/{cid}",
                      headers={"X-Avery-Token": body["owner_token"]}).status_code == 200


# === (d) 请求格式错误与 guards ================================================================

def test_unknown_table_name_is_a_400_not_a_500(client):
    r = _post(client, {"08 我编的表": []})
    assert r.status_code == 400
    assert "08 我编的表" in r.json()["detail"]["reason"]
    assert r.json()["detail"]["known_tables"] == ["01", "02", "03", "04", "05", "06", "07"]


def test_malformed_tables_json_is_a_400(client):
    r = client.post("/ingest/structured", data={"tables": "{not json"})
    assert r.status_code == 400
    assert r.json()["detail"]["error"] == "bad tables payload"


def test_empty_submission_is_a_400(client):
    r = _post(client, {})
    assert r.status_code == 400
    assert r.json()["detail"]["error"] == "nothing submitted"


def test_row_cap_is_enforced(client, monkeypatch):
    monkeypatch.setenv("AVERY_MAX_INTAKE_ROWS", "3")
    r = _post(client, {"01": ROSTER_ROWS * 2})
    assert r.status_code == 400
    assert "上限" in r.json()["detail"]["reason"]


def test_column_aliases_are_accepted(client):
    """表头原文（含 ` *`）与规范键都认——前端发哪一种都不该踩坑。"""
    row = {"姓名 *": "周雅婷", "岗位 *": "运营", "部门 *": "运营部",
           "主要负责 *": "会员日活动", "人员ID *": "OPS-001", "任职状态 *": "在职"}
    body = _ok(client, {"01 组织与人员名册": [row]})
    assert [p["name"] for p in body["people"]] == ["周雅婷"]


def test_a_row_without_a_name_stays_in_the_material_library(client):
    """说明页答应的话：「若贵司选择不提供该列……本表就只会进材料库、不会长出人卡」。"""
    row = {"岗位": "运营", "部门": "运营部", "主要负责": "会员日活动", "人员ID": "OPS-001"}
    body = _ok(client, {"01": [row]})
    assert body["people"] == []
    from avery.ingest.registry import active_registry
    ctx = active_registry().get(body["context_id"])
    assert any("会员日活动" in m.text for m in ctx.extraction.materials)
