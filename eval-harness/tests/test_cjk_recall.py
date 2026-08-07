"""关键词 recall 对中文语料的可达性（T8/#57 收官自检逮到的洞）。

在这之前 `memory._tokens` 只认 `[a-z0-9]+`：一整句中文切不出任何 token，于是关键词 recall
对**中文语料恒返回空列表**。三亚这类中文客户走到关键词那条腿（离线门、mock demo、以及生产上
embedding key 缺失/轮换后的降级路径）时，Avery 是一行证据都检索不到的——而 mock 侧的兜底
引用 `facts.md:1`（service/live_input.py:139）让屏幕上照样有一条形状完美的引用，
所以没有任何一道门红过。这个文件把那条腿钉死。

判据故意写成「找得到 / 排在最前」而不是「返回若干条」——bigram 索引天然会带回一些弱相关行
（共享一个二元组即算命中），这不是缺陷；真正会伤人的是**一条都回不来**与**相关的那条排不到前面**。
"""
from pathlib import Path

import pytest

from avery import memory


def _mem(tmp: Path, facts: list[str], notes: list[str] | None = None) -> Path:
    (tmp / "facts.md").write_text("\n".join(facts), encoding="utf-8")
    (tmp / "notes.md").write_text("\n".join(notes or ["# Notes"]), encoding="utf-8")
    return tmp


ZH_FACTS = [
    "# Facts",
    "周雅 — 宴会厅领班 (餐饮部).",
    "把宴会厅传菜等位压到五分钟以内。",
    "草坪婚宴旺季档 — blocker: 外部婚庆的进场时点与尾款结算条款尚未与法务对齐.",
    "泳池儿童乐园暑期加派两名看护。",
    "Kickoff moved to Thursday because the vendor slipped.",
]


def test_chinese_query_reaches_chinese_lines(tmp_path):
    """回归本体：中文问句必须能召回中文语料行（此前恒为 0 条）。"""
    hits = memory.recall("传菜等位现在压到几分钟", _mem(tmp_path, ZH_FACTS), limit=3)
    assert hits, "中文查询一条都召不回来——关键词那条腿对中文又瞎了"
    assert hits[0].source.startswith("facts.md:")
    assert "传菜等位" in hits[0].text


def test_the_right_chinese_line_ranks_first(tmp_path):
    """相关的那条要排在最前，不是「回来一堆里碰巧有」。"""
    hits = memory.recall("婚宴的阻碍是什么", _mem(tmp_path, ZH_FACTS), limit=5)
    assert "婚庆" in hits[0].text and "法务" in hits[0].text, [h.text for h in hits]


def test_unrelated_chinese_query_does_not_match_everything(tmp_path):
    """够得着 ≠ 什么都命中：问泳池不该把宴会厅那几行也判成同分最高。"""
    hits = memory.recall("泳池看护", _mem(tmp_path, ZH_FACTS), limit=5)
    assert hits and "泳池" in hits[0].text
    assert hits[0].score > (hits[1].score if len(hits) > 1 else 0)


def test_cite_refs_stay_line_addressable(tmp_path):
    """出处契约不许因为分词变了就漂——命中行必须仍能被 resolve_ref 逐字取回。"""
    mem = _mem(tmp_path, ZH_FACTS)
    hit = memory.recall("传菜等位", mem, limit=1)[0]
    assert memory.resolve_ref(hit.source, mem, None) == hit.text


def test_ascii_behavior_is_unchanged(tmp_path):
    """英文那条腿逐字不变：停用词照丢、单字母照丢、命中照旧。"""
    mem = _mem(tmp_path, ZH_FACTS)
    assert memory.recall("vendor slipped", mem, limit=3)[0].text.startswith("Kickoff moved")
    # 纯停用词的问句仍然什么都不该召回（没有可用 token）。
    assert memory.recall("the a of to", mem) == []


def test_mixed_script_query_uses_both_legs(tmp_path):
    """一句话里中英混排（客户资料里到处都是）时两边的 token 都要参与打分。"""
    mem = _mem(tmp_path, ZH_FACTS + ["BEO 台型确认由宴会销售部出。"])
    hits = memory.recall("BEO 台型", mem, limit=3)
    assert "BEO" in hits[0].text


@pytest.mark.parametrize("query,expect", [("人", True), ("周雅", True), ("龘", False)])
def test_single_character_runs_survive(tmp_path, query, expect):
    """单字段（一个字自成一段）保底收自己，否则那一段在索引里直接消失。"""
    mem = _mem(tmp_path, ["# Facts", "周雅 是 人 事 口 的 联络 人。"])
    assert bool(memory.recall(query, mem)) is expect
