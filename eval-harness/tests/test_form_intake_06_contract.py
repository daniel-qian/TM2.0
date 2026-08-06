# -*- coding: utf-8 -*-
"""内置「周报」表单 ↔ 我们发给客户的那张 xlsx 的契约门 —— T1 · form-backend-a1a。

我们**主动发给客户**一套 xlsx 空白件（`scripts/make-intake-xlsx.py` 生成），其中「06 周报与述职
事实」那张表就是纸面版的周报。现在 Avery 里内置了一张同名的电子表单，员工在手机上填的就是它。
于是这两张表之间有了一份契约，而契约的两头都会单方面漂：

  * 改 xlsx 的人不知道 Avery 里那张表单长什么样；
  * 改表单的人不知道外面已经发出去多少份 xlsx（客户是照着那张表理解我们的）。

所以两头在这里被**同一把尺**量：本文件直接 import 那个生成器模块（不是抄一份常量下来），任一侧
改动都会在这里对峙。这条纪律与 `test_partner_intake_form_contract.py` 是同一条，只是量的是另一张表。

--- 门 1：八列一列不许掉 -------------------------------------------------------------------
06 表八列，每一列要么是**员工要填的一格**（form 字段，label 与表头逐字一致），要么是**系统填的**
（铸链/提交时服务端自己知道，不该问员工）。两边加起来必须盖全八列，且不许重叠。

漏的后果是具体的：少一格 = 客户手里那张表有的信息，电子版收不上来；多一格系统列 = 我们把本来
该系统填的东西又问了员工一遍。

--- 门 2：必填记号跟着表头走 ---------------------------------------------------------------
xlsx 里的 ` *` 是必填记号（表头文案的一部分，不是题面）。「需要支持」是八列里**唯一**没有 `*` 的，
它在表单里就必须是选填 —— 那张 xlsx 的提示语明写着这栏经常被留空。

--- 门 3：负载/情绪**不在** 06 表里，而且不许被"顺手补进去" ---------------------------------
这两格是人卡上唯一合法的两个人身自述子槽（`extract.py:93-124`），来源是产品设计不是那张 xlsx。
如果哪天有人往 06 表里加一列「负载」，就会出现两个来源各写各的 —— 本门在那一刻先红。

--- 门 4：语料真的含中文字节 ---------------------------------------------------------------
（MEMORY：门语料全 ASCII 盲点。）这一整套判据如果被写成对 ASCII 键名的比较，中文表头改成什么样
它都全绿。所以显式钉住：每一条被比较的题面都必须含 CJK 字节。
"""
from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

from avery.ingest.form import (
    INTAKE_06_SYSTEM_COLUMNS, INTAKE_SHEET_06,
    intake_header_base, weekly_template,
)

REPO = Path(__file__).resolve().parents[2]
GENERATOR = REPO / "scripts" / "make-intake-xlsx.py"


def _load_generator():
    """把 scripts/make-intake-xlsx.py 当模块加载（文件名带连字符，import 不了）。"""
    spec = importlib.util.spec_from_file_location("make_intake_xlsx", GENERATOR)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


gen = pytest.importorskip("openpyxl") and _load_generator()

FORM_BY_NAME = {name: (purpose, cols, dv) for name, purpose, cols, dv in gen.FORMS}
TEMPLATE = weekly_template("ctx_contract_probe")
LABELS = {f.label: f for f in TEMPLATE.fields}


def _sheet_06_headers() -> list[str]:
    assert INTAKE_SHEET_06 in FORM_BY_NAME, (
        f"{INTAKE_SHEET_06!r} 不在我们发出去的 xlsx 里了 —— 表单的题面来源没了")
    _purpose, columns, _dropdowns = FORM_BY_NAME[INTAKE_SHEET_06]
    return [h for h, _w, _n in columns]


def _has_cjk(text: str) -> bool:
    return any("一" <= ch <= "鿿" for ch in text)


# --- 门 1 ---------------------------------------------------------------------------------

def test_every_06_column_is_either_a_form_field_or_a_named_system_column():
    """八列一列不许掉，也不许有一列既是字段又是系统列。"""
    unaccounted = []
    for header in _sheet_06_headers():
        base = intake_header_base(header)
        is_field = base in LABELS
        is_system = base in INTAKE_06_SYSTEM_COLUMNS
        if is_field and is_system:
            pytest.fail(f"06 表的「{base}」既被当字段问员工、又被当系统列自动填 —— 只能二选一")
        if not (is_field or is_system):
            unaccounted.append(base)
    assert not unaccounted, (
        f"06 表这几列在内置周报表单里无人认领：{unaccounted}。"
        "要么在 weekly_template 里加一格（label 逐字照抄表头），"
        "要么在 INTAKE_06_SYSTEM_COLUMNS 里写明它由服务端哪一列填。")


def test_every_declared_system_column_really_exists_in_the_sheet():
    """反向：INTAKE_06_SYSTEM_COLUMNS 里不许有 06 表根本没有的列（陈年映射会假装盖全）。"""
    bases = {intake_header_base(h) for h in _sheet_06_headers()}
    ghosts = sorted(set(INTAKE_06_SYSTEM_COLUMNS) - bases)
    assert not ghosts, f"这些系统列在 06 表里根本不存在，映射是陈的：{ghosts}"


def test_every_form_field_label_that_claims_to_come_from_the_sheet_is_verbatim():
    """表单里凡是与 06 表同源的题面，必须与表头**逐字**一致（客户是照着那张纸理解我们的）。"""
    bases = {intake_header_base(h) for h in _sheet_06_headers()}
    from_sheet = [f for f in TEMPLATE.fields if f.label in bases]
    assert len(from_sheet) == 4, (
        f"预期正好 4 格来自 06 表（已完成事实/未达成及原因/下一周期目标/需要支持），"
        f"实得 {[f.label for f in from_sheet]}")
    for f in from_sheet:
        assert f.label in bases, f"「{f.label}」不是 06 表的表头原文"


def test_the_sheet_sourced_fields_keep_the_sheet_order():
    """纸面表和电子表的顺序一致 —— 客户对着 xlsx 教员工填，顺序对不上会当场卡壳。"""
    order = [intake_header_base(h) for h in _sheet_06_headers()]
    in_form = [f.label for f in TEMPLATE.fields if f.label in order]
    assert in_form == [b for b in order if b in LABELS], (
        f"表单里同源字段的顺序 {in_form} 与 06 表列序对不上")


# --- 门 2 ---------------------------------------------------------------------------------

def test_required_marks_follow_the_asterisk_on_the_sheet():
    """xlsx 的 ` *` 是必填记号；表单的 required 必须跟着它走，不许各写各的。"""
    for header in _sheet_06_headers():
        base = intake_header_base(header)
        if base not in LABELS:
            continue
        starred = header.strip().endswith("*")
        assert LABELS[base].required is starred, (
            f"「{base}」在 xlsx 里{'带' if starred else '不带'} *，"
            f"但表单里 required={LABELS[base].required}")


def test_support_is_the_one_optional_column_and_it_is_optional_in_the_form():
    """钉死这条具体事实：八列里只有「需要支持」不带 *（那张表的提示语也明说它常被留空）。"""
    optional = [intake_header_base(h) for h in _sheet_06_headers()
                if not h.strip().endswith("*")]
    assert optional == ["需要支持"], f"06 表的选填列变了：{optional}"
    assert LABELS["需要支持"].required is False


# --- 门 3 ---------------------------------------------------------------------------------

def test_self_report_fields_are_not_sourced_from_the_sheet():
    """负载/情绪自述是产品设计（人卡上唯一合法的两个人身自述子槽），**不是** 06 表的列。
    哪天有人往 06 表里补一列同名的，这门先红 —— 一份数据不能有两个来源各写各的。"""
    bases = {intake_header_base(h) for h in _sheet_06_headers()}
    for label in ("负载自述", "情绪自述"):
        assert label in LABELS, f"内置周报少了「{label}」这一格"
        assert label not in bases, (
            f"「{label}」出现在了 06 表里 —— 现在它有两个来源了。"
            "要么从 xlsx 撤掉，要么把它改成同源字段并在这里改判据。")


def test_the_self_report_fields_keep_the_shapes_the_person_card_can_accept():
    """负载是 0-100 的数、情绪是三选一，且三个选项正是解析层情绪词表三个桶各自的头一个词
    （`extract.py:79-90`）—— T5 把它们渲染进文档时才是 1:1，不用再造一层翻译。"""
    from avery.ingest.extract import norm_mood_selfreport

    load = LABELS["负载自述"]
    assert (load.kind, load.min, load.max) == ("number", 0, 100)

    mood = LABELS["情绪自述"]
    assert mood.kind == "choice"
    assert mood.choices == ["如常", "偏紧", "吃紧"]
    assert [norm_mood_selfreport(c) for c in mood.choices] == \
           ["steady", "stretched", "strained"], (
        "情绪选项不再逐一落到解析层的三个桶上了 —— T5 回流人卡会读出 other")


# --- 门 4 ---------------------------------------------------------------------------------

def test_the_corpus_this_gate_compares_really_carries_chinese_bytes():
    """（MEMORY：门语料全 ASCII 盲点。）本门比较的每一条题面都必须真含中文字节，否则整套判据
    可能在对着 ASCII 键名自娱自乐、中文改成什么样都全绿。"""
    for header in _sheet_06_headers():
        assert _has_cjk(header), f"06 表表头 {header!r} 不含中文 —— 这门在量什么？"
    for f in TEMPLATE.fields:
        assert _has_cjk(f.label), f"表单题面 {f.label!r} 不含中文"
    assert _has_cjk(TEMPLATE.title)
