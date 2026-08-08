# -*- coding: utf-8 -*-
"""issue #61 GATE — GFM 标准表格（首尾带边框竖线）在 roster / 自述两条腿上的读法。

修复前的实测（票面复现，非推测）：`| 姓名 | 部门 |` 这种首尾都有竖线的标准 markdown 表格，
`_people_from_roster` 一个人都抽不出来——`"| 周雅婷 | MKT |".split("|")` 的 cells[0] 是空串，
`_looks_like_name('')` 为假，整行按「首格没填」丢掉；而且**全程零报错**：文件显示已读取、
briefing 说 0 people，读起来像文档里本来就没有名册。`_selfreport_from_lines` 同款切法同款死。
只有内侧竖线（`姓名 | 部门`，parse.py 三个结构化生产者的 join 产物）一直是好的。

修法是 `_strip_table_frame`：**行首第 0 列就是竖线**才算 GFM 边框，首尾各剥一根。判据落在
第 0 列而不是「strip 后以竖线开头」，是因为 join 对「首格为空」的产出是 ` | 周雅 | …`
——以空格开头。这种行今天被丢弃、必须继续被丢弃：值在第二列（role/team 的位置），
「客房部经理」这种 3~5 个汉字的岗位值恰好过 _looks_like_name，顶进 cells[0] 就是
feat-039「No.」那类幽灵人卡。所以本文件的门是**双向**的：

  · 正向 —— 带外框的表和不带外框的表抽出**同一批人，且列不错位**（表头带外框时
    _canon_header 仍认得列；逐字段断言，防「只修数据行不修表头」那种整体偏一位——
    _people_from_roster docstring 第 3 条记着这种错位真出过事故）；
  · 反向 —— docx/xlsx/csv 三个生产者仍然只发内侧竖线（行首永远不是竖线），
    空首格的 join 行仍然被丢弃、不长幽灵。防的是有人图省事去改 `" | ".join` 那一侧，
    或把剥边框的判据放宽到 lstrip 后。

变异账（修复期间手工跑过、非常驻）：①摘掉 _strip_table_frame（换回裸 split）→ 本文件
正向门全红；②只修数据行不修表头 → 列错位断言红（role 吃到部门、team 吃到职位）；
③只修表头不修数据行 → 零命中断言红。
"""
from __future__ import annotations

import io

import pytest

from avery.ingest import HeuristicExtractor, extract_docs
from avery.ingest.extract import _canon_header, _strip_table_frame
from avery.ingest.parse import parse_bytes


def _people(name: str, text: str):
    """真离线路端到端：utf-8 字节 → parse_bytes（解码+sniff）→ heuristic → dedupe。零模型。"""
    doc = parse_bytes(name, text.encode("utf-8"))
    return extract_docs([doc], extractor=HeuristicExtractor()).people


# === 正向 · 带外框 == 不带外框，逐字段 ==========================================================

# 同一批人、同一批列，默认列序（姓名|职位|部门|司龄|负责——表头映射与位置兜底指向同一个格，
# 空格子不会被 `or` 兜底顶掉，这让下面的空单元格断言是干净的）。中文字节真进语料，
# 外加一行英文同事——表头管的是整张表，不是某种语言（feat-049 的既有口径）。
_EXPECTED = {
    "郑海燕": ("客房部经理", "客房部", "6 年", ("客房夜床服务复核", "布草间盘点")),
    "买买提艾力": ("宴会主管", "餐饮部", "2 年", ("宴会动线优化",)),
    "周雅": ("", "前厅部", "", ("前台交接流程",)),          # 职位/司龄两个空格子，必须还是空格子
    "Lin Qing": ("Design Lead", "Design", "4 years", ("design reviews",)),
}

_HEADER = "姓名 | 职位 | 部门 | 司龄 | 负责"
_ROWS = [
    "郑海燕 | 客房部经理 | 客房部 | 6 年 | 客房夜床服务复核、布草间盘点",
    "买买提艾力 | 宴会主管 | 餐饮部 | 2 年 | 宴会动线优化",
    "周雅 | | 前厅部 | | 前台交接流程",
    "Lin Qing | Design Lead | Design | 4 years | design reviews",
]


def _frame(row: str) -> str:
    return f"| {row} |"


_VARIANTS = {
    # 内侧竖线（今天就好的那两种，钉住不许被修坏）
    "inner": [_HEADER] + _ROWS,
    "inner+sep": [_HEADER, "--- | --- | --- | --- | ---"] + _ROWS,
    # 外侧竖线（修复前 0 人的那两种）
    "framed": [_frame(_HEADER)] + [_frame(r) for r in _ROWS],
    "framed+sep": [_frame(_HEADER), "| --- | --- | --- | --- | --- |"] + [_frame(r) for r in _ROWS],
    # GFM 对齐语法的分隔行照旧只当分隔行（票面明确不做对齐解析，但它不许成人）
    "framed+align-sep": [_frame(_HEADER), "| :--- | ---: | :---: | --- | --- |"] + [_frame(r) for r in _ROWS],
}


@pytest.mark.parametrize("variant", sorted(_VARIANTS))
def test_framed_and_unframed_rosters_extract_the_same_people_FIELD_BY_FIELD(variant):
    """修复前：framed* 两种变体 == 0 人（BORN RED）；inner* 两种 == 4 人（born green，安全闩）。

    判据不是「抽出了 N 个人」而是逐字段——票面第 1 条别踩的：只修数据行的话列会整体偏一位，
    人数照样对得上，而 role='客房部'、team='客房部经理' 的卡片自信地全错且无人报告。
    """
    text = "\n".join(_VARIANTS[variant]) + "\n"
    got = {p.name: (p.role, p.team, p.tenure, tuple(p.owns)) for p in _people("员工花名册.md", text)}
    assert got == _EXPECTED, f"[{variant}] 与期望逐字段不符: {got}"


def test_framed_header_row_still_canonicalises_per_column():
    """表头带外框时 _canon_header 仍认得列——剥完边框后逐格命中 _ZH_HEADER_MAP，
    没有因为外框在场而整体偏一位或首尾多出空键。"""
    framed_header = "| 姓名 | 部门 | 职位 | 司龄 |"
    keys = [_canon_header(c) for c in _strip_table_frame(framed_header).split("|")]
    assert keys == ["name", "team", "role", "tenure"], keys


def test_framed_roster_with_nondefault_column_order_reads_by_HEADER():
    """变异②的击杀点：列序故意用 姓名|部门|职位（部门在前——docstring 第 3 条那次真实事故的
    列序）。「只修数据行、不修表头」的半吊子修法在这里必红：表头带着首尾空键整体偏一位，
    role 吃到部门、team 吃到职位，而人数完全正确。"""
    text = (
        "| 姓名 | 部门 | 职位 | 司龄 |\n"
        "| --- | --- | --- | --- |\n"
        "| 郑海燕 | 客房部 | 客房部经理 | 6 年 |\n"
        "| Grace Tan | Design | Design Lead | 4 years |\n"
    )
    got = {p.name: (p.role, p.team, p.tenure) for p in _people("员工花名册.md", text)}
    assert got == {
        "郑海燕": ("客房部经理", "客房部", "6 年"),
        "Grace Tan": ("Design Lead", "Design", "4 years"),
    }, f"列被按位置而不是按表头读了（外框把列顶偏了一位）: {got}"


def test_separator_rows_and_header_never_become_people():
    """分隔行 `---`（含对齐语法）与表头行永远不成人。分隔行靠 _looks_like_name 挡
    （'---' 不是名字形状），表头行靠 _NOT_NAME——剥完边框后 cells[0] 是「姓名」，
    结构闸 `cells[0] in _NOT_NAME` 对带外框的表**第一次**真正跑起来（以前 cells[0]
    是空串，这道闸对整张 GFM 表是死的）。"""
    for variant, lines in _VARIANTS.items():
        names = {p.name for p in _people("员工花名册.md", "\n".join(lines) + "\n")}
        leaked = sorted(names & {"姓名", "---", ":---", "---:", ":---:", "—", ""})
        assert not leaked, f"[{variant}] 表头/分隔行成了同事: {leaked}"


def test_a_single_bar_line_and_a_bare_frame_do_not_crash_or_invent_people():
    """边角料：光杆竖线、空表格行、只有边框没有内容——不崩、不出人。"""
    text = "| 姓名 | 职位 |\n|\n||\n|  |\n| 郑海燕 | 客房部经理 |\n"
    got = {p.name for p in _people("员工花名册.md", text)}
    assert got == {"郑海燕"}, got


# === 自述那条腿 · 同款四变体 ====================================================================

@pytest.mark.parametrize("line,label", [
    ("- 周雅婷｜负载自述：80｜情绪自述：吃紧", "unframed-bullet"),        # 今天就好的基线
    ("周雅婷 | 负载自述：80 | 情绪自述：吃紧", "unframed-ascii"),
    ("| 周雅婷｜负载自述：80｜情绪自述：吃紧 |", "framed-ascii"),          # 修复前零自述
    ("| 周雅婷 | 负载自述：80 | 情绪自述：吃紧 |", "framed-ascii-cells"),
    ("｜周雅婷｜负载自述：80｜情绪自述：吃紧｜", "framed-fullwidth"),      # 全角边框，同款死法
])
def test_selfreport_reads_the_same_through_a_table_frame(line, label):
    """`_selfreport_from_lines` 与 roster 是两把同款的尺（票面第 2 条别踩的：修一处不修另一处，
    两条路对同一份文档给出不同答案）。绝对值断言防「四个变体一起坏」的假全等。"""
    text = f"# 本周项目周报\n项目：交接\n{line}\n"
    people = [p for p in _people("本周项目周报.md", text) if p.self_report]
    got = [(p.name, p.self_report.load.value if p.self_report.load else None,
            p.self_report.mood.value if p.self_report.mood else None) for p in people]
    assert got == [("周雅婷", 80, "strained")], f"[{label}] {got}"


def test_selfreport_frame_stripping_keeps_the_bar_escape_inert():
    """form_append 用 U+00A6 BROKEN BAR 转义自述自由文本里的竖线（form_append.py 的碑）。
    ¦ 不在边框字符集里也不在切格表里——带 ¦ 的行剥边框后仍是一行普通文本，不多切一格。"""
    text = "# 本周项目周报\n项目：交接\n| 周雅婷｜负载自述：80｜情绪自述：兼顾 A ¦ B 两摊 |\n"
    people = [p for p in _people("本周项目周报.md", text) if p.self_report]
    assert len(people) == 1 and people[0].name == "周雅婷"
    mood = people[0].self_report.mood
    assert mood is not None and mood.value == "other" and "A ¦ B" in mood.valueRaw, (
        f"¦ 被当成了切格符或边框: {mood}"
    )


# === 反向 · 三个生产者仍然只发内侧竖线（防有人去改 join 那一侧） ================================
# 这条不变量是剥边框安全性的**前提**：join 的行首永远不是竖线，所以顶格判据对它们是 no-op。
# 语料故意带空首格/空末格——那正是 join 产出最像 GFM 边框的形状。

def _assert_inner_bars_only(doc, producer: str):
    for ln in doc.lines:
        if "|" in ln:
            assert not ln.startswith("|"), (
                f"{producer} 生产者发出了顶格竖线的行 {ln!r} —— `\" | \".join` 那一侧被人改了，"
                f"剥边框对它不再是 no-op，空首格行会被顶进 cells[0]（feat-039 幽灵人卡的回魂路）"
            )


def test_csv_producer_inner_bars_only_and_empty_name_cell_still_drops():
    """CSV：空首格行 join 出 ` | 客房部经理`（空格开头）——必须原样丢弃，不长幽灵。
    「客房部经理」特意选名字形状（3~5 汉字、过 _looks_like_name）的岗位值：它一旦被顶进
    cells[0] 就是一张自信的假人卡，而不是无害的空行。"""
    doc = parse_bytes("roster.csv", "姓名,职位\n,客房部经理\n周雅,前台\n郑海燕,\n".encode("utf-8"))
    _assert_inner_bars_only(doc, "csv")
    got = {p.name: p.role for p in extract_docs([doc], extractor=HeuristicExtractor()).people}
    assert got == {"周雅": "前台", "郑海燕": ""}, f"空首格的 CSV 行长出了幽灵: {got}"


def test_xlsx_producer_inner_bars_only_and_empty_name_cell_still_drops():
    openpyxl = pytest.importorskip("openpyxl")
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "01 名册 roster"
    ws.append(["姓名", "职位", "部门"])
    ws.append([None, "客房部经理", "客房部"])   # 空首格 + 名字形状的岗位值
    ws.append(["周雅", "前台", "前厅部"])
    ws.append(["郑海燕", None, None])            # 空末格们
    buf = io.BytesIO()
    wb.save(buf)
    doc = parse_bytes("roster.xlsx", buf.getvalue())
    _assert_inner_bars_only(doc, "xlsx")
    got = {p.name: (p.role, p.team) for p in extract_docs([doc], extractor=HeuristicExtractor()).people}
    assert got == {"周雅": ("前台", "前厅部"), "郑海燕": ("", "")}, f"空首格的 xlsx 行长出了幽灵: {got}"


def test_docx_producer_inner_bars_only_and_empty_name_cell_still_drops():
    docx = pytest.importorskip("docx")
    d = docx.Document()
    tbl = d.add_table(rows=3, cols=3)
    for j, v in enumerate(["姓名", "职位", "部门"]):
        tbl.rows[0].cells[j].text = v
    for j, v in enumerate(["", "客房部经理", "客房部"]):
        tbl.rows[1].cells[j].text = v
    for j, v in enumerate(["周雅", "前台", "前厅部"]):
        tbl.rows[2].cells[j].text = v
    buf = io.BytesIO()
    d.save(buf)
    doc = parse_bytes("Team_Roster.docx", buf.getvalue())
    _assert_inner_bars_only(doc, "docx")
    got = {p.name: p.role for p in extract_docs([doc], extractor=HeuristicExtractor()).people}
    assert got == {"周雅": "前台"}, f"空首格的 docx 行长出了幽灵: {got}"


# === 剥边框本身的字节契约（单元级，变异①的最小击杀面） ==========================================

@pytest.mark.parametrize("ln,expected", [
    ("| a | b |", " a | b "),      # 标准 GFM：首尾各剥一根
    ("|a|b|", "a|b"),
    ("| a | b", " a | b"),          # 只有首边框：剥首，尾不动
    ("a | b |", "a | b |"),         # 只有尾竖线：**不动**——这是 join 对「末格为空」的合法产出
    (" | a | b", " | a | b"),       # 空格开头：**不动**——这是 join 对「首格为空」的合法产出
    ("|| a |", "| a "),             # 只各剥一根：剩下的首格是空格子，空格子保位
    ("| 周雅 | | 前厅部 |", " 周雅 | | 前厅部 "),   # 中间的空格子原样在
    ("|", ""),
    ("", ""),
    ("plain text", "plain text"),
])
def test_strip_table_frame_byte_contract(ln, expected):
    assert _strip_table_frame(ln) == expected


def test_strip_table_frame_fullwidth_bars_only_when_asked():
    """全角 ｜ 只在自述那条腿的字符集里——roster 路的切格表只有 ASCII |，边框字符集跟着切格表走
    （各认各的尺，不许一条腿替另一条腿放宽）。"""
    assert _strip_table_frame("｜周雅婷｜80｜") == "｜周雅婷｜80｜"          # 默认（roster 尺）不动
    assert _strip_table_frame("｜周雅婷｜80｜", "|｜") == "周雅婷｜80"       # 自述尺剥掉
