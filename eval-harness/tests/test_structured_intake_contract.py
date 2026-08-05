# -*- coding: utf-8 -*-
"""表定义的**唯一真源**契约门 —— onboarding-accounts-0805 ①（ADR-0034 后果节点名的那条）。

ADR-0034 之后，同一份「列名 / 列序 / 必填 / 下拉词表 / 填写提示」被四方消费：

  1. `scripts/make-intake-xlsx.py` 的 FORMS —— 生成**发给客户**的 xlsx 空白件（真源）
  2. `eval-harness/avery/ingest/intake_schema.json` —— 后端运行时读（生成产物）
  3. `src/shared/intakeSchema.ts` —— 前端画网格 + 单元格校验（生成产物）
  4. `avery/ingest/structured.py` 的映射表 —— 「哪一列去哪个字段」（手写语义层）

前三者靠 `scripts/gen-intake-schema.py` 编译，本文件把编译结果**逐字节**对峙一遍：改了 FORMS
忘了重跑、或者有人手改了生成产物，两个方向都在这里红。第四者（映射表）另有一道：它提到的每
一个列键都必须在真源里存在——写错一个字，那一列就静默失联，而"静默"正是这类 bug 唯一的症状
（make-intake-xlsx.py 文件头记着实测：表头多两个汉字 → 整张表抽出 0 人、没有任何报错）。

与 `test_partner_intake_form_contract.py` 的分工：那道门量的是**表 ↔ 抽取器词表**（状态词、
列序、表头纯度）；这道门量的是**表 ↔ 生成产物 ↔ 结构化入口**。两道都直接 import 真源，都不
经过任何中间层。
"""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
GEN_SCRIPT = REPO / "scripts" / "gen-intake-schema.py"
JSON_OUT = REPO / "eval-harness" / "avery" / "ingest" / "intake_schema.json"
TS_OUT = REPO / "src" / "shared" / "intakeSchema.ts"


def _load(path: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


def _gen():
    return _load(GEN_SCRIPT, "gen_intake_schema")


# ── 门 1：生成产物是最新的（两个方向都拦）────────────────────────────────────────────────────
def test_generated_json_is_up_to_date():
    gen = _gen()
    wanted = gen.render_json(gen.build_payload(gen.load_generator()))
    assert JSON_OUT.exists(), "intake_schema.json 不见了；跑 python scripts/gen-intake-schema.py"
    assert JSON_OUT.read_text(encoding="utf-8") == wanted, (
        "intake_schema.json 与 make-intake-xlsx.py 的 FORMS 不一致 —— "
        "跑 `python scripts/gen-intake-schema.py` 重新生成")


def test_generated_ts_is_up_to_date():
    gen = _gen()
    wanted = gen.render_ts(gen.build_payload(gen.load_generator()))
    assert TS_OUT.exists(), "src/shared/intakeSchema.ts 不见了；跑 python scripts/gen-intake-schema.py"
    assert TS_OUT.read_text(encoding="utf-8") == wanted, (
        "前端表定义与 FORMS 不一致 —— 跑 `python scripts/gen-intake-schema.py` 重新生成。"
        "🔴 这一条红了就是「前端手写了第二份表定义」，正是票 #41 明令不许的那件事")


# ── 门 2：列名/列序逐张对峙真源（不经过生成脚本，独立一把尺）──────────────────────────────────
def test_columns_match_the_forms_source_verbatim():
    """故意不复用 `gen.build_payload`：门 1 已经量过"生成脚本的输出 == 库里的文件"，这一条量的是
    "库里的文件 == FORMS 本身"。两条都走同一个函数就成了自己考自己（fixture 自考自答的旧账）。"""
    mod = _load(REPO / "scripts" / "make-intake-xlsx.py", "make_intake_xlsx")
    schema = json.loads(JSON_OUT.read_text(encoding="utf-8"))
    forms = {f["sheet"]: f for f in schema["forms"]}

    assert len(schema["forms"]) == len(mod.FORMS) == 7
    for sheet, purpose, columns, dropdowns in mod.FORMS:
        assert sheet in forms, f"生成产物里少了整张表：{sheet}"
        form = forms[sheet]
        assert form["purpose"] == purpose
        assert form["tier"], f"{sheet} 缺 tier（核心必填/建议补充）"
        assert (form["tier"], form["when"]) == mod.WHEN[sheet]
        assert form["intake"] == mod.INTAKE[sheet]
        assert len(form["columns"]) == len(columns), f"{sheet} 列数对不上"
        for got, (header, width, note) in zip(form["columns"], columns):
            # 🔴 表头原文逐字相等 —— 后端 `_canon_header` 靠汉字认列，一个字的出入就是整列失联。
            assert got["header"] == header, f"{sheet}: 表头漂了 {got['header']!r} != {header!r}"
            assert got["required"] == ("*" in header)
            assert got["width"] == width
            assert got["hint"] == (note or "").replace("\n", "")
        for col_no, options in dropdowns.items():
            assert form["columns"][col_no - 1]["options"] == list(options), (
                f"{sheet} 第 {col_no} 列的下拉词表漂了 —— 它决定了用户填出来的词落不落在"
                f"Avery 读得懂的范围内")
        for i, col in enumerate(form["columns"], start=1):
            if i not in dropdowns:
                assert col["options"] == [], f"{sheet} 第 {i} 列凭空长出了下拉词表"


# ── 门 3：映射表提到的每个列键都真的存在（写错一个字 = 那一列静默失联）───────────────────────
def test_every_mapped_column_key_exists_in_the_source():
    from avery.ingest import structured

    known = {f["id"]: {c["key"] for c in f["columns"]} for f in structured.FORMS}
    referenced: list[tuple[str, tuple[str, ...]]] = [
        ("01", structured._PERSON_TEXT_COLS),
        ("01", ("姓名", "岗位", "部门", "司龄", "主要负责", "人员ID")),
        ("02", ("项目ID", "项目名称", "负责人ID", "当前状态", "完成进度",
                "计划完成日期", "项目目标")),
        ("04", ("项目ID", "当前阻塞")),
        ("05", ("事项类型", "优先级", "关联项目ID", "事实描述")),
        ("07", structured._REVIEW_TEXT_COLS),
        ("07", ("被评议人员ID",)),
    ]
    for form_id, keys in referenced:
        for key in keys:
            assert key in known[form_id], (
                f"structured.py 引用了表 {form_id} 里不存在的列「{key}」 —— "
                f"这一列会静默读成空串，没有任何报错。真源现有列：{sorted(known[form_id])}")


def test_form_ids_are_the_seven_sheets():
    from avery.ingest import structured
    assert structured.FORM_IDS == ("01", "02", "03", "04", "05", "06", "07")


def test_table_and_column_aliases_all_resolve():
    """一张表三种点名法、一列两种写法——都必须通向同一份真源（票 #40：不许有第三套键名）。"""
    from avery.ingest import structured

    for form in structured.FORMS:
        for alias in (form["id"], form["sheet"], form["title"]):
            assert structured.FORM_BY_ALIAS[structured._norm_col(alias)] is form
        cols = structured.COLS_BY_FORM[form["id"]]
        for col in form["columns"]:
            assert cols[structured._norm_col(col["key"])] == col["key"]
            assert cols[structured._norm_col(col["header"])] == col["key"]
