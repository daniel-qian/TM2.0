# -*- coding: utf-8 -*-
"""合伙人标准表单 ↔ 抽取器 的契约门 —— partner-docs-0728。

我们**主动发给客户**一套 xlsx 空白件（`scripts/make-intake-xlsx.py` 生成，
`public/paperwork/forms/avery-intake-forms.xlsx`）。发出去的表和读它的抽取器之间因此有了
一份契约，而这份契约有两头，两头都会单方面漂：改表的人不知道抽取器读什么，改抽取器的人
不知道外面已经发出去几百份表。所以两头在这里被**同一把尺**量。

本文件直接 import 那个生成器模块（不是复制一份常量），所以任何一侧改动都会在这里对峙。

--- 门 1：表 02「当前状态」的四个下拉选项 -------------------------------------------------
FIXED（过去式是刻意的，这是实测记录）：补丁之前，四个选项里有两个在 `_norm_status` 的
任何一张词表里都不存在 ——

    未开始 -> ''        已暂停 -> ''        进行中 -> 'on-track'   已完成 -> 'done'

而 `''` 到了前端 `projectView.ts:87` 是 `!value -> 'unknown'`，渲染成中性灰的「状态未知」。
也就是说：用户照着我们发的表，从我们自己给的下拉里选了「已暂停」，项目卡上写「状态未知」。
这不是抽取不准，是我们发的表和自己的词表对不上。

修法（Danny 2026-07-28 拍板）：`_ZH_BLOCKED` 补 `暂停`；`未开始` **有意不补**——它是计划态、
不是健康度，留空并归到「状态未知」是诚实的。里程碑词表里的 `未开始 -> upcoming` 是另一个轴，
别拿来对齐。

--- 门 2：表 01 的前五列列序 --------------------------------------------------------------
`_people_from_roster` 里姓名恒取 `cells[0]`（没有表头可言），role/team/tenure 另有位置兜底
`cells[1]/[2]/[3]`。所以 01 表的前四列必须是 姓名|岗位|部门|司龄 —— 表头映射和位置兜底才会
指向同一个格，两条读法给出同一张人卡。实测：把「人员ID」放回第一列，整张表抽出 0 人。

--- 门 3：表头单元格里不许有多余汉字 -------------------------------------------------------
`_canon_header` 的兜底是「剥掉所有非汉字再查表」。`姓名 *` 能命中（`*` 是 ASCII，被剥掉），
`姓名（仅贵司内部留存）` 命不中（括号里的汉字跟着留下）。实测：带中文括号的版本抽出 0 人。
"""
from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

from avery.ingest.extract import (
    _canon_header,
    _is_roster_header_row,
    _norm_status,
    norm_milestone_status,
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
ROSTER_SHEET = "01 组织与人员名册"
LEDGER_SHEET = "02 项目台账"


# --- 门 1 ---------------------------------------------------------------------------------

# 表 02「当前状态」列的下拉选项 -> 抽取器该读出的项目状态。'' = 有意留空（见文件头）。
EXPECTED_STATUS = {
    "未开始": "",
    "进行中": "on-track",
    "已暂停": "blocked",
    "已完成": "done",
}


def test_the_status_dropdown_we_ship_is_exactly_the_vocabulary_we_assert_ONE_RULER():
    """下拉选项若被改动，本门先红——别让表单和门各自漂。"""
    _purpose, columns, dropdowns = FORM_BY_NAME[LEDGER_SHEET]
    status_col = next(i for i, (h, _w, _n) in enumerate(columns, start=1) if h.startswith("当前状态"))
    assert dropdowns[status_col] == list(EXPECTED_STATUS), (
        "表 02「当前状态」的下拉选项变了，但本门的期望表没跟着改")


@pytest.mark.parametrize("option,expected", list(EXPECTED_STATUS.items()))
def test_every_status_option_we_ship_reads_back_as_documented(option, expected):
    assert _norm_status(option) == expected


def test_paused_is_blocked_in_every_shape_a_user_might_type():
    for text in ("已暂停", "暂停", "状态：已暂停", "项目暂停中", "本月暂停"):
        assert _norm_status(text) == "blocked", text


def test_negated_pause_is_not_blocked():
    """否定由 _zh_states 统一处理——补词表不许把「尚未暂停」读成「已暂停」。"""
    for text in ("尚未暂停", "没有暂停", "不会暂停", "未暂停"):
        assert _norm_status(text) != "blocked", text


def test_the_pre_existing_blocked_vocabulary_is_untouched():
    """暂停 是加进去的，不是换掉别的——同一列里原有的词一个都不许掉。"""
    for text in ("受阻", "已阻断", "阻塞", "卡住", "停滞", "停工", "中止", "搁置",
                 "无法推进", "推不动"):
        assert _norm_status(text) == "blocked", text


def test_not_started_stays_blank_on_the_project_axis_but_is_upcoming_on_the_milestone_axis():
    """两个轴不是一回事，别为了「看起来对齐」把它们焊在一起。"""
    assert _norm_status("未开始") == ""
    assert norm_milestone_status("未开始") == "upcoming"


# --- 门 2 ---------------------------------------------------------------------------------

def test_the_roster_sheet_leads_with_the_four_columns_the_extractor_reads_positionally():
    _purpose, columns, _dv = FORM_BY_NAME[ROSTER_SHEET]
    heads = [h for h, _w, _n in columns]
    assert [h.rstrip(" *") for h in heads[:4]] == ["姓名", "岗位", "部门", "司龄"], (
        "01 表前四列的顺序被改了。_people_from_roster 的位置兜底是 "
        "cells[0]=name / [1]=role / [2]=team / [3]=tenure，改了列序就会把岗位填进司龄。")
    assert heads[4].rstrip(" *") == "主要负责", (
        "第五列必须是「主要负责」——_ZH_HEADER_MAP 只认 负责/主要负责 这一族，"
        "「核心职责」不在表里（职责 ≈ responsibilities，两种语言都不读它）。")


def test_the_roster_header_row_is_recognised_as_a_roster_header_row():
    _purpose, columns, _dv = FORM_BY_NAME[ROSTER_SHEET]
    row = " | ".join(h for h, _w, _n in columns)
    assert _is_roster_header_row(row), "01 表的表头行没被认成花名册表头，整张表会抽出 0 人"


def test_the_roster_sheet_name_carries_the_roster_routing_hint():
    """HeuristicExtractor 按 doc_kind 分支；判成 project 就永远不调 _people_from_roster。
    线索放在 sheet 名（= 正文）而不是文件名，用户重命名文件也带得走。"""
    from avery.ingest.parse import sniff_kind
    assert "名册" in ROSTER_SHEET
    assert sniff_kind("avery-intake-forms.xlsx", f"# sheet: {ROSTER_SHEET}\n姓名 | 岗位") == "roster"


# --- 门 3 ---------------------------------------------------------------------------------

# 表头 -> 抽取器真正读的键。只列被映射的那几个；其余列没有 canonical key，本来就该原样落下。
MAPPED_HEADERS = {"姓名": "name", "岗位": "role", "部门": "team", "司龄": "tenure",
                  "主要负责": "owns"}


def test_every_mapped_header_we_ship_survives_canonicalisation():
    _purpose, columns, _dv = FORM_BY_NAME[ROSTER_SHEET]
    for head, _w, _n in columns:
        bare = head.rstrip(" *")
        if bare in MAPPED_HEADERS:
            assert _canon_header(head) == MAPPED_HEADERS[bare], (
                f"表头 {head!r} canonicalise 之后不是 {MAPPED_HEADERS[bare]!r}，这一列会失联")


def test_no_header_cell_carries_extra_han_or_a_newline():
    """加中文括号提示 = 静默废掉那一列；加换行 = 表头行被切碎和数据混行。两者都实测过。"""
    for name, (_purpose, columns, _dv) in FORM_BY_NAME.items():
        for head, _w, _n in columns:
            assert "\n" not in head, f"{name} 的表头 {head!r} 带换行"
            assert "（" not in head and "(" not in head, f"{name} 的表头 {head!r} 带括号提示"
