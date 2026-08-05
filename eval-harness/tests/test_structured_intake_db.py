# -*- coding: utf-8 -*-
"""结构化入口 × **真 Postgres** —— onboarding-accounts-0805 ①（@needs_db）。

为什么非跑真库不可：离线套跑的是内存 registry，它看不见持久层，而持久层是本仓踩过五种真库
bug 的地方（`.issues/*` 旧账；`get()` 不读的列会被 `put()` 静默抹掉是其中最阴的一种）。
结构化入口是**新的写路径**，它往库里塞的东西恰好都是内存套证明不了的形状：

  * 人卡 id 是客户的工号（`MKT-001`），不是 `_slug` 产出的 `u_…` —— 主键/外键那一层没见过；
  * 材料 source 是 `表单录入:01:行1`：**汉字 + 冒号 + 行号**，而 file-space 的 n_chunks 统计
    正是靠 `source.rsplit(":", 1)` 切前缀的（`pipeline._finalize_source_documents`）；
  * 混合发的一个 context 里同时有「文件抽出来的人」和「表格映射出来的人」，两批人的
    provenance 形状不同。

所以这里量的不是映射对不对（那在 test_structured_intake.py 里），而是**存进去再读出来还是
不是同一份**：重开一个连接、拿一个全新的 registry 实例读回来，逐字段比对。

跑法（本机 pg17 :5433，与 feat-030 起的那套同一个）：
    AVERY_DB_URL='postgresql://postgres:avery_local_dev@127.0.0.1:5433/postgres' \
        python -m pytest tests/test_structured_intake_db.py -m needs_db -q
没有 URL 时干净跳过（与 @needs_db 的既有约定一致），默认离线套不受影响。
"""
from __future__ import annotations

import os
import uuid
from pathlib import Path

import pytest

from avery.ingest import ingest_paths
from avery.ingest.structured import build_intake

needs_db = pytest.mark.needs_db

HERE = Path(__file__).resolve().parent
FIX = HERE / "fixtures" / "ingest"
ROSTER_XLSX = FIX / "Team_Roster.xlsx"

ROSTER_ROWS = [
    {"姓名": "陈思雨", "岗位": "市场经理", "部门": "市场部", "司龄": "3 年",
     "主要负责": "华东区渠道投放的方案与执行、秋季发布会统筹", "人员ID": "MKT-001",
     "直属上级ID": "", "任职状态": "在职", "入职日期": "2023-04-10"},
]
PROJECT_ROWS = [
    {"项目ID": "PRJ-2026-01", "项目名称": "秋季新品发布会", "负责人ID": "MKT-001",
     "当前状态": "进行中", "开始日期": "2026-06-01", "计划完成日期": "2026-09-20",
     "完成进度": "45", "项目目标": "覆盖 3 家行业媒体、留资 500 条"},
]
ISSUE_ROWS = [
    {"事项ID": "ISS-002", "事项类型": "风险", "优先级": "高", "关联项目ID": "PRJ-2026-01",
     "发现日期": "2026-07-10", "处理截止日": "", "责任人ID": "MKT-001",
     "处理状态": "待处理", "事实描述": "主媒体档期与发布会当天冲突", "证据来源": "邮件往来"},
]


def _db_url() -> str | None:
    return (os.environ.get("AVERY_DB_URL") or os.environ.get("PGVECTOR_URL") or "").strip() or None


@pytest.fixture()
def pg(tmp_path):
    url = _db_url()
    if not url:
        pytest.skip("needs AVERY_DB_URL (or PGVECTOR_URL) pointing at a Postgres")
    pytest.importorskip("psycopg")
    from avery.ingest.pg_registry import PostgresContextRegistry

    data_dir = tmp_path / "data"
    created: list[str] = []

    def fresh():
        # 每次都是**新实例、新连接** —— 复用同一个实例会让「内存里还留着」冒充「库里真有」。
        return PostgresContextRegistry(url, data_dir=data_dir)

    yield fresh, created
    reg = fresh()
    for cid in created:
        reg.delete(cid)


def _cid() -> str:
    return "ctx_test_" + uuid.uuid4().hex[:12]


def _ingest(fresh, created, work_dir: Path, *, tables, files=None):
    reg = fresh()
    cid = _cid()
    created.append(cid)
    intake = build_intake(tables)
    assert intake.ok, f"fixture 语料自己就红线了：{intake.violations}"
    rep = ingest_paths([str(p) for p in (files or [])], registry=reg, work_dir=work_dir,
                       context_id=cid, name="structured-db",
                       extra_extraction=intake.result)
    assert rep.ok, f"ingest failed: {rep.redline.summary()}"
    return cid, rep


@needs_db
def test_structured_rows_survive_a_new_connection(pg, tmp_path):
    fresh, created = pg
    cid, _ = _ingest(fresh, created, tmp_path / "mem",
                     tables={"01": ROSTER_ROWS, "02": PROJECT_ROWS, "05": ISSUE_ROWS})

    ctx = fresh().get(cid)                    # 全新实例、全新连接
    assert ctx is not None, "结构化写路径的 context 在库里没了"

    people = {p.id: p for p in ctx.extraction.people}
    assert set(people) == {"MKT-001"}, "工号当主键的人卡没能原样存回来"
    chen = people["MKT-001"]
    # 🔴 逐字段比对，不是"非空即过"：`get()` 不读的列会被下一次 `put()` 抹掉，而那种缺陷的
    # 症状恰好是"某几个字段悄悄变空"（旧账：offline-suite-blind-to-pg-persistence）。
    assert chen.name == "陈思雨"
    assert chen.role == "市场经理"
    assert chen.team == "市场部"
    assert chen.tenure == "3 年"
    assert chen.owns == ["华东区渠道投放的方案与执行", "秋季发布会统筹"]
    assert chen.source == "表单录入:01:行1"
    assert chen.self_report is None, "结构化入口凭空造出了人身自述数字"

    projects = {p.id: p for p in ctx.extraction.projects}
    launch = projects["PRJ-2026-01"]
    assert launch.title == "秋季新品发布会"
    assert launch.ownerId == "MKT-001" and launch.ownerName == "陈思雨"
    assert launch.status == "on-track"
    assert launch.progress == 45
    assert launch.dueDate == "2026-09-20"
    assert launch.source == "表单录入:02:行1"
    # 05 表充实的风险是**嵌套 dataclass**，pg 存的是 asdict、读回来是 dict —— ProjectEntity
    # 的 __post_init__ 负责再变回对象。这一条就是在量那条 coercion 还活着。
    assert launch.risk is not None and launch.risk.level == "high"
    assert "主媒体档期" in launch.risk.reason


@needs_db
def test_cjk_material_sources_round_trip(pg, tmp_path):
    """材料的 source 是 `表单录入:01:行1` —— 汉字 + 冒号。存回来必须逐字相同，
    否则 file-space 的 n_chunks（靠 `rsplit(':', 1)` 切前缀）与检索出处会一起歪掉。"""
    fresh, created = pg
    cid, _ = _ingest(fresh, created, tmp_path / "mem", tables={"01": ROSTER_ROWS})
    ctx = fresh().get(cid)
    sources = {m.source for m in ctx.extraction.materials}
    assert "表单录入:01" in sources, "表头那条材料丢了"
    assert "表单录入:01:行1" in sources
    assert all(s.startswith("表单录入:") for s in sources)


@needs_db
def test_mixed_submit_keeps_both_populations_in_one_row_of_the_db(pg, tmp_path):
    """混合发：文件抽出的人 + 表格映射的人同存一个 context，重开连接后两批都还在。"""
    fresh, created = pg
    files_cid, files_rep = _ingest(fresh, created, tmp_path / "a", tables={},
                                   files=[ROSTER_XLSX])
    from_files = len(files_rep.context.extraction.people)
    assert from_files > 0, "基线为空 —— 下面那条会恒真"

    mixed_cid, _ = _ingest(fresh, created, tmp_path / "b",
                           tables={"01": ROSTER_ROWS}, files=[ROSTER_XLSX])
    ctx = fresh().get(mixed_cid)
    assert len(ctx.extraction.people) == from_files + len(ROSTER_ROWS)
    assert any(p.name == "陈思雨" for p in ctx.extraction.people)
    assert ctx.context_id != files_cid


@needs_db
def test_no_new_entity_kind_and_no_new_person_key_reach_the_db(pg, tmp_path):
    """ADR-0034 拍板 1 的那句「**不新建实体类型**」，在库里量一遍。

    拍板原话是「`avery.entities` 的 kind CHECK 与 person 键 allowlist 都不动」。Python 侧看不出
    违反：新 kind / 新键要等到 `put()` 撞上 `entities_kind_check` 才炸，而 08 的 'playbook' kind
    正是这样只在生产 demo 上才失败的（pg_registry.py:91 那段旧账）。所以这条判据直接读库里
    落下来的行——不是读代码，也不是读 payload 投影。

    🔴 这不是「重复 test_registry_contract 的 CHECK 测试」：那道量的是**约束本身**存不存在，
    这道量的是**结构化这条新写路径**有没有绕开它、有没有塞进一个约束管不到的形状。
    """
    fresh, created = pg
    cid, _ = _ingest(fresh, created, tmp_path / "mem",
                     tables={"01": ROSTER_ROWS, "02": PROJECT_ROWS, "05": ISSUE_ROWS})
    reg = fresh()
    with reg._connect() as conn:
        rows = conn.execute(
            "SELECT kind, payload FROM avery.entities WHERE context_id = %s", (cid,)).fetchall()
    assert rows, "结构化写路径一行实体都没落库 —— 下面的判据会恒真"
    kinds = {r[0] for r in rows}
    assert kinds <= {"person", "project", "signal", "playbook"}, (
        f"结构化入口造出了新的 entity kind：{sorted(kinds)}")

    from avery.ingest.extract import PersonEntity
    allowed = set(PersonEntity.__dataclass_fields__)
    for kind, payload in rows:
        if kind != "person":
            continue
        extra = set(payload) - allowed
        assert not extra, f"人身 payload 长出了 PersonEntity 之外的键：{sorted(extra)}"
