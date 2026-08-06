"""差距战役 T6 · B2a 第一步 —— 把 `_dedupe_entities` 的现有行为整个钉死。

**这一票分两步，这个文件是第一步，且刻意是独立的一次 commit。** `_dedupe_entities`
（**extract.py:1648-1751** —— 票面上写的 1648-1712 只到 people 那一段，见下）是 heuristic 与 LLM
两条抽取路**共用**的核心纯函数：`extract_docs` 在两条路上都在 `apply_gate` 之后、`_link_owners`
之前调它一次。改它 = 同时改两条路上每一份人卡和项目卡。所以第二步（给它加 `conflicts` 记录）动手
之前，先在这里把它今天**到底怎么合的**逐字段写下来——不是"应该怎么合"，是"现在就是这么合的"。

⚠ 这个文件自己就吃过一次行号的亏，记在这儿当方法论：第一版按票面的 `1648-1712` 读完就动笔，于是
断言了"信号完全不被 dedupe 碰"——**当场红**。真实函数体一直写到 1751，1740-1749 是一整段按
`_signal_key` 做字面克隆折叠的信号处理。**行号是转述，函数体才是事实**；第 8b 节就是那个红换来的。

WHY A CHARACTERIZATION FILE AND NOT "既有门已经覆盖了"：既有门覆盖的是**互补**那一半。
`test_cjk_identity.py::test_cross_doc_person_merge_enriches_scalars_from_either_direction_M5`
把「两份文档各说一半」钉得很死（吴桂芳的 role 只在文档一、tenure 只在文档二，两头都不能丢），
而它自己的姊妹测试在 docstring 里明写了另一半**没钉**：

    "(The known and documented limitation stands: order still decides when two documents both
     state the SAME scalar — these two never do.)"

「两份文档都说了同一个格子、而且说得不一样」——**碰撞**那一半——今天在整个电池里没有一条断言。
而这正好是 T6 要改的那一半：花名册说「周雅婷 / 市场推广部」、周报说「周雅婷 / 前厅部」，今天合完
只剩一个，输的那个**连同它的出处一起人间蒸发**。要在这种地方动刀，先把蒸发的现场拍下来。

钉的口径（三条，都是刻意的）：
  1. **单元层为主**：直接构造实体、直接调 `_dedupe_entities`，不经 parse/路由。碰撞行为跟文档长
     什么样无关，隔着 parse 钉等于把 routing 的 bug 算进 dedupe 的账。文件末尾另有一小节走**真
     pipeline**（`extract_docs` + 真中文文档），证明单元层钉的那条路在真语料上确实可达——只钉单
     元层是"假绿八型"里的够不着型。
  2. **语料必须有真中文字节**（MEMORY: 门语料全 ASCII 盲点）。`_person_key` 对 Han 和对 ASCII 走
     的**是两条不同的分支**（`_HAN_PAD_RE` 只在 Han 两侧成立），全 ASCII 的语料永远考不到中文那
     条。本文件的碰撞主语料一律是中文，另配 ASCII 对照。
  3. **只描述，不评判**。下面有几条现有行为是可以争的（`or` 把 `""`/`0`/`False` 一视同仁、
     `milestones` 用 falsy 判据而 `progress`/`risk` 用 `is None`、list 并集只对**新来的**去重不
     对**已有的**去重）。它们在这里**按现状钉住**，红字注在 `# 现状存疑` 里，本票一律不修——
     改行为是另一票的事，这一票只负责让改动可见。
"""
from __future__ import annotations

from dataclasses import asdict

import pytest

from avery.ingest import HeuristicExtractor, extract_docs, parse_bytes
from avery.ingest.extract import (
    ExtractionResult,
    MaterialChunk,
    MethodCard,
    PersonEntity,
    PersonSelfReport,
    ProjectEntity,
    ProjectMilestone,
    ProjectRisk,
    SelfReportLoad,
    SelfReportMood,
    SignalEntity,
    _dedupe_entities,
    _person_key,
    _project_key,
)

# 三亚酒店语料里真实存在的人和部门（Sanya_Team_Roster_ZH.md）。中文字节写在源码里而不是 fixture
# 文件里，是为了不去碰 tests/fixtures/cjk/ —— 那个目录被
# test_cjk_zh_headers.py::test_the_hole1_fixture_is_the_only_one_with_a_chinese_filename 用
# `CJK.glob("*.md")` 全目录扫着，往里加文件会连带改动一道无关的门。
ZHOU = "周雅婷"
ROSTER_TEAM = "市场推广部"      # 花名册的读数
WEEKLY_TEAM = "前厅部"          # 周报的读数（与花名册完全不相等 —— T6 v1 只报完全不相等）


def _person(name: str = ZHOU, **kw) -> PersonEntity:
    """一条最小人员读数。id 默认按名字派生，模仿 _slug 的产物但不依赖它。"""
    kw.setdefault("id", f"u_{name}")
    return PersonEntity(name=name, **kw)


def _project(title: str = "别墅套餐推广", **kw) -> ProjectEntity:
    kw.setdefault("id", f"p_{title}")
    return ProjectEntity(title=title, **kw)


def _dedupe(*, people=(), projects=(), **kw) -> ExtractionResult:
    """构造 → 调用 → 交还。`_dedupe_entities` 原地改 res 并返回 None，这里替调用方兜住。"""
    res = ExtractionResult(people=list(people), projects=list(projects), **kw)
    assert _dedupe_entities(res) is None, "_dedupe_entities 是原地改写，不返回新结果"
    return res


# === 0 · 语料自检 ==============================================================================
# 门语料 ASCII 化是这个仓库真被咬过的盲点，所以语料本身也要被断言，而不是被信任。

def test_the_collision_corpus_is_really_chinese():
    """碰撞主语料必须是真中文字节。退化成 ASCII 的那天，本文件钉的就不再是中文那条分支。"""
    for s in (ZHOU, ROSTER_TEAM, WEEKLY_TEAM):
        assert not s.isascii(), f"{s!r} 退化成 ASCII 了 —— 中文分支就没人考了"
    assert ROSTER_TEAM != WEEKLY_TEAM, "两个部门读数必须真不一样，否则碰撞语料自己先失效"


# === 1 · 身份判据 ==============================================================================
# 合谁不合谁由 _person_key / _project_key 说了算。这两把尺子在别处已被 CJK 门钉过，这里只在
# dedupe 的调用面上再确认一次：换一把尺子会直接改变本文件下面每一条的前提。

def test_person_identity_folds_han_padding_whitespace_and_case():
    """人：Han 之间的空白**删掉**（列对齐用的 U+3000，不是词分隔），其余空白折叠、大小写折叠。"""
    assert _person_key("孙　浩") == _person_key("孙浩") == "孙浩"
    assert _person_key("  周雅婷 ") == ZHOU
    assert _person_key("Lena  Park") == "lena park"      # Latin 之间的空白是分隔符，只折叠不删
    assert _person_key("LENA PARK") == "lena park"


def test_person_identity_is_NOT_punctuation_folded_unlike_project():
    """人名不是 slug：`-`/`_` 不折叠。项目才折。两把尺子的差别是有意的，钉住防止有人"统一"掉。"""
    assert _person_key("Jo-Anna") != _person_key("Jo Anna")
    assert _project_key("Core-Flow") == _project_key("core flow") == "core flow"


def test_same_person_across_two_docs_collapses_to_one_record():
    res = _dedupe(people=[_person(ZHOU), _person("周雅婷")])
    assert len(res.people) == 1


def test_different_people_are_not_merged():
    res = _dedupe(people=[_person("周雅婷"), _person("孙浩")])
    assert [p.name for p in res.people] == ["周雅婷", "孙浩"]


# === 2 · 人 · 碰撞 —— 本票要改的就是这一节 ======================================================
# 「两份文档都说了同一个格子、说得不一样」。今天：先到的赢，后到的**消失且不留痕**。

def test_person_team_collision_keeps_the_FIRST_reading_B2A():
    """部门碰撞：先到的花名册赢，后到的周报读数被丢弃。

    这是 T6 的靶心，也是 B2 设计文档里点名的场景。`cur.team = cur.team or p.team`
    （extract.py:1693）—— `cur.team` 已经非空，`or` 直接短路，`p.team` 连看都不看一眼。
    """
    res = _dedupe(people=[
        _person(team=ROSTER_TEAM, source="员工花名册.md:4"),
        _person(team=WEEKLY_TEAM, source="本周周报.md:9"),
    ])
    assert len(res.people) == 1
    assert res.people[0].team == ROSTER_TEAM, "先到的读数应当胜出（输入顺序即优先级）"


def test_person_team_collision_flips_with_INPUT_ORDER_B2A():
    """同一份语料换个上传顺序，答案就换一个 —— 这不是 bug 报告，是把「顺序即优先级」钉死。

    docstring（extract.py:1673-1676）自己写了：「"First non-empty wins" means INPUT ORDER decides
    when two docs both state a scalar ... a stale progress from last week's report can beat this
    week's if it is uploaded first. Known limitation.」本条把那句话变成可执行的。
    """
    forward = _dedupe(people=[_person(team=ROSTER_TEAM), _person(team=WEEKLY_TEAM)])
    reverse = _dedupe(people=[_person(team=WEEKLY_TEAM), _person(team=ROSTER_TEAM)])
    assert forward.people[0].team == ROSTER_TEAM
    assert reverse.people[0].team == WEEKLY_TEAM
    assert forward.people[0].team != reverse.people[0].team


def test_the_LOSING_reading_and_its_source_vanish_without_trace_B2A():
    """输家连同它的出处一起蒸发 —— **这就是 T6 第二步要堵的洞**，先拍照。

    合并后去整个 ExtractionResult 里翻，翻不到 `前厅部` 三个字，也翻不到周报那一行的出处。
    信息不是"被降级"或"被标记"，是**没了**：没有任何下游（决策规则、前端、facts.md）还有机会
    知道两份资料在这个格子上对不上。
    """
    res = _dedupe(people=[
        _person(team=ROSTER_TEAM, source="员工花名册.md:4"),
        _person(team=WEEKLY_TEAM, source="本周周报.md:9"),
    ])
    blob = repr(asdict(res.people[0]))
    assert WEEKLY_TEAM not in blob, "输掉的读数居然还留在人卡上"
    assert "本周周报.md:9" not in blob, "输掉的那份出处居然还留在人卡上"
    whole = repr([asdict(p) for p in res.people])
    assert WEEKLY_TEAM not in whole and "本周周报.md:9" not in whole


def test_the_discarded_reading_is_now_RECORDED_in_conflicts_B2A():
    """**跳闸开关已跳闸**（T6 第二步落地）。

    这一条在第一步的 commit（51cb2de）里写的是 `assert not hasattr(res, "conflicts")` —— 一个刻意
    留给第二步的红。第二步给 `ExtractionResult` 加上 `conflicts` 的那一刻它变红，那个红就是"功能
    真的落地了"的 red-first 证据。现在把它翻成正向断言：**上面
    test_the_LOSING_reading_and_its_source_vanish_without_trace_B2A 拍下来的那个蒸发现场，
    从此有了收容所** —— 输家不再进人卡（那条断言依然全绿，实体上确实没有它），而是进 conflicts。
    """
    res = _dedupe(people=[
        _person(team=ROSTER_TEAM, source="员工花名册.md:4"),
        _person(team=WEEKLY_TEAM, source="本周周报.md:9"),
    ])
    assert len(res.conflicts) == 1
    c = res.conflicts[0]
    assert (c.subject_kind, c.field) == ("person", "team")
    assert c.subject_ref == res.people[0].id, "subject_ref 应当是活下来那条实体的 id"
    assert [v.value for v in c.values] == [ROSTER_TEAM, WEEKLY_TEAM], "values[0] 恒为胜出的读数"
    assert [v.source for v in c.values] == ["员工花名册.md:4", "本周周报.md:9"]
    assert [v.doc_key for v in c.values] == ["员工花名册.md", "本周周报.md"]


def test_person_role_tenure_source_collide_the_same_way():
    """role / tenure / source 与 team 同一条规则（同一个 `or` 块，extract.py:1692-1695）。"""
    res = _dedupe(people=[
        _person(role="市场推广专员", tenure="2 年", source="员工花名册.md:4"),
        _person(role="前厅接待", tenure="1 年", source="本周周报.md:9"),
    ])
    p = res.people[0]
    assert (p.role, p.tenure, p.source) == ("市场推广专员", "2 年", "员工花名册.md:4")


def test_person_id_and_name_always_come_from_the_FIRST_record():
    """id 与 name 根本不参与合并 —— 第一条记录**整个对象**被留下，后来者只往它身上补空格子。

    所以后到的那份哪怕名字写法不同（「孙　浩」带 U+3000），最终卡上显示的是**先到**的写法。
    extract.py:462 明写过这个后果：「_dedupe_entities keeps the FIRST-SEEN record, so 孙浩's id
    flipped with DOCUMENT ORDER」。
    """
    res = _dedupe(people=[
        PersonEntity(id="u_sun_hao", name="孙浩"),
        PersonEntity(id="u_sun__hao", name="孙　浩", role="餐饮部领班"),
    ])
    assert len(res.people) == 1
    assert (res.people[0].id, res.people[0].name) == ("u_sun_hao", "孙浩")
    assert res.people[0].role == "餐饮部领班", "补空格子照常发生，只有 id/name 不动"


def test_the_surviving_person_IS_the_first_input_object_not_a_copy():
    """别名：活下来的是**第一个输入对象本身**，被原地改写，不是新造的副本。

    这条对第二步很要紧：如果第二步在记冲突时顺手把候选值挂回实体上，改的是调用方还攥在手里的
    那个对象。测试里 `first is res.people[0]` 成立，也说明 `_dedupe_entities` 不适合被当成纯
    函数重复调用（它对同一份输入不是幂等无副作用的）。
    """
    first = _person(team=ROSTER_TEAM)
    second = _person(role="市场推广专员")
    res = _dedupe(people=[first, second])
    assert res.people[0] is first
    assert first.role == "市场推广专员", "第二条的值被写进了第一个对象里"
    assert second.role == "市场推广专员", "第二个对象自己没被改"


def test_output_order_is_first_seen_order():
    """输出顺序 = 各人**首次出现**的顺序（dict 插入序），不是最后一次出现的顺序。"""
    res = _dedupe(people=[
        _person("周雅婷"), _person("孙浩"), _person("周雅婷", role="市场推广专员"), _person("吴桂芳"),
    ])
    assert [p.name for p in res.people] == ["周雅婷", "孙浩", "吴桂芳"]


# === 3 · 人 · 空值口径 ==========================================================================

def test_empty_string_never_beats_a_stated_value_in_either_direction():
    """空串不是"一个读数"，是"这份文档没说"。所以它既不该赢，也不该被记成冲突。

    第二步的判据必须建在这条上：**只有两边都非空且不相等**才算冲突。这里把两个方向都钉住。
    """
    later_fills = _dedupe(people=[_person(team=""), _person(team=WEEKLY_TEAM)])
    assert later_fills.people[0].team == WEEKLY_TEAM, "先到的是空，应当被后到的填上"

    earlier_holds = _dedupe(people=[_person(team=ROSTER_TEAM), _person(team="")])
    assert earlier_holds.people[0].team == ROSTER_TEAM, "后到的是空，不该把已有读数抹掉"


def test_two_docs_stating_the_SAME_value_is_not_a_disagreement():
    """两份文档说得一样：合并后当然还是它。第二步不许把这种情况记成冲突（v1 只报完全不相等）。"""
    res = _dedupe(people=[_person(team=ROSTER_TEAM), _person(team=ROSTER_TEAM)])
    assert res.people[0].team == ROSTER_TEAM


# === 4 · 人 · self_report 嵌套槽 ================================================================

def test_self_report_is_taken_WHOLE_when_the_survivor_has_none():
    """先到的人没有自述槽时，后到的整个槽（同一个对象，非拷贝）被挂上去。"""
    weekly = PersonSelfReport(load=SelfReportLoad(value=72, source="周报-周雅婷-W32.md:5"))
    res = _dedupe(people=[_person(team=ROSTER_TEAM), _person(self_report=weekly)])
    assert res.people[0].self_report is weekly
    assert res.people[0].self_report.load.value == 72


def test_self_report_merges_PER_SUB_SLOT_keep_first():
    """两份都有自述槽时，逐子槽 keep-first：load 与 mood 各自独立、互不牵连。

    rich-align-0722/03 的原话（extract.py:1696-1698）：花名册带身份没自述、周报带自述没身份，
    合完那个"真实存在的人"两样都要有，且**后一份周报不许覆盖前一份**。
    """
    first = PersonSelfReport(load=SelfReportLoad(value=72, source="W32.md:5"))
    second = PersonSelfReport(
        load=SelfReportLoad(value=95, source="W33.md:5"),
        mood=SelfReportMood(value="strained", source="W33.md:6"),
    )
    res = _dedupe(people=[_person(self_report=first), _person(self_report=second)])
    sr = res.people[0].self_report
    assert sr.load.value == 72, "先到的 load 应当守住（后到的 95 被丢弃）"
    assert sr.load.source == "W32.md:5"
    assert sr.mood is not None and sr.mood.value == "strained", "空着的 mood 子槽应当被补上"


def test_a_self_report_object_with_both_sub_slots_None_is_still_TRUTHY():
    """现状存疑（钉住不修）：`if p.self_report:` 判的是**对象存在**，不是**里面有东西**。

    `PersonSelfReport` 是个没有 `__bool__`/`__len__` 的 dataclass，所以哪怕 load 和 mood 都是
    None，它也恒为真。后果：一个"空自述槽"会占住 `cur.self_report is None` 这个位置，让真正带
    数字的那一份只能走逐子槽那条路（结果仍然对，因为子槽判据是 `is None`）。行为是对的，判据是
    巧合。钉住它，免得将来有人把子槽判据也改成 `or` 时以为这里是安全的。
    """
    assert bool(PersonSelfReport()) is True
    empty, real = PersonSelfReport(), PersonSelfReport(load=SelfReportLoad(value=72))
    res = _dedupe(people=[_person(self_report=empty), _person(self_report=real)])
    assert res.people[0].self_report is empty, "占位的空槽守住了位置"
    assert res.people[0].self_report.load.value == 72, "但真数字仍然经子槽路径补了进来"


def test_self_report_absent_on_both_stays_None():
    res = _dedupe(people=[_person(), _person(role="市场推广专员")])
    assert res.people[0].self_report is None


# === 5 · 人 · 列表字段（并集，不是碰撞） ========================================================
# owns / collaboration 是**并集**语义：两份文档各列一部分，合起来才完整。所以它们天然没有"冲突"
# 可言 —— T6 v1 的四个字段一个都不在这里，这一节钉的是"别把并集误当成碰撞"。

def test_owns_is_an_order_preserving_union_that_skips_falsy_and_duplicates():
    res = _dedupe(people=[
        _person(owns=["销售 FAQ 梳理", "别墅套餐推广物料"]),
        _person(owns=["别墅套餐推广物料", "", "宴会动线优化"]),
    ])
    assert res.people[0].owns == ["销售 FAQ 梳理", "别墅套餐推广物料", "宴会动线优化"]


def test_owns_union_dedupes_only_the_INCOMING_side():
    """现状存疑（钉住不修）：去重只对**新来的**做，已经在 `cur.owns` 里的重复项原样留着。

    第一份文档自己列重了，合并不会替它清理。这不影响 T6（并集字段不入冲突表），但它是"并集实现
    只看单边"的证据，将来谁要在这里做归一化会先撞到这条。
    """
    res = _dedupe(people=[
        _person(owns=["宴会动线优化", "宴会动线优化"]),
        _person(owns=["宴会动线优化"]),
    ])
    assert res.people[0].owns == ["宴会动线优化", "宴会动线优化"]


def test_owns_and_collaboration_are_capped_at_six():
    """并集封顶 6（`[:6]`，与 _slist/_build 同一个数）。**超出的静默丢弃**，不留任何痕迹。"""
    res = _dedupe(people=[
        _person(owns=[f"事项{i}" for i in range(5)], collaboration=[f"同事{i}" for i in range(5)]),
        _person(owns=[f"事项{i}" for i in range(5, 10)],
                collaboration=[f"同事{i}" for i in range(5, 10)]),
    ])
    assert res.people[0].owns == [f"事项{i}" for i in range(6)]
    assert res.people[0].collaboration == [f"同事{i}" for i in range(6)]


def test_a_full_survivor_list_swallows_the_incoming_one_entirely():
    """先到的已经满 6 格，后到的一条都进不来 —— 封顶发生在合并**之后**，不是按人配额。"""
    res = _dedupe(people=[
        _person(owns=[f"事项{i}" for i in range(6)]),
        _person(owns=["周报里才提到的这件事"]),
    ])
    assert "周报里才提到的这件事" not in res.people[0].owns


# === 6 · 人 · 不参与合并的字段 ==================================================================

def test_archived_and_provenance_are_not_merged_at_all():
    """archived / provenance 是手编 CRUD（ADR-0028）的字段，dedupe 完全不碰它们。

    后果就是"第一条记录整个留下"的直接推论：活下来的那份带着自己的 archived/provenance，后到的
    那份的手编痕迹**不会**被并进来。抽取路本来也不产生手编字段，这里钉的是"dedupe 不该越界去动
    CRUD 的地盘"。
    """
    res = _dedupe(people=[
        _person(archived=False),
        _person(archived=True, provenance={"team": {"origin": "manual", "source": "手动编辑"}}),
    ])
    assert res.people[0].archived is False
    assert res.people[0].provenance == {}


# === 7 · 项目 · 碰撞（T6 v1 的另外两个字段：项目状态 / 到期日） =================================

def test_project_status_and_dueDate_collide_keep_first_B2A():
    """项目状态与到期日碰撞 —— T6 v1 四个字段里的两个，同样是先到的赢、后到的蒸发。"""
    res = _dedupe(projects=[
        _project(status="进行中", dueDate="2026-09-30", source="项目台账.md:7"),
        _project(status="受阻", dueDate="2026-10-15", source="本周周报.md:12"),
    ])
    assert len(res.projects) == 1
    pr = res.projects[0]
    assert (pr.status, pr.dueDate, pr.source) == ("进行中", "2026-09-30", "项目台账.md:7")
    blob = repr(asdict(pr))
    assert "受阻" not in blob and "2026-10-15" not in blob, "输掉的读数还留在项目卡上"


def test_project_owner_and_summary_collide_the_same_way():
    res = _dedupe(projects=[
        _project(ownerId="u_周雅婷", ownerName=ZHOU, summary="别墅套餐三季度推广"),
        _project(ownerId="u_孙浩", ownerName="孙浩", summary="改口径后的推广摘要"),
    ])
    pr = res.projects[0]
    assert (pr.ownerId, pr.ownerName, pr.summary) == ("u_周雅婷", ZHOU, "别墅套餐三季度推广")


def test_project_progress_uses_is_None_so_ZERO_is_a_real_reading():
    """现状要害：`progress` 判的是 `is None`（extract.py:1728-1729），**不是** `or`。

    所以 `progress=0` 是"文档真说了 0%"，守得住，不会被后一份的 58% 顶掉。这条必须钉死，因为
    T6 第二步的"非空"判据如果偷懒写成 `if a or b`，就会把合法的 0 当成"没读到"——那是把一个真读数
    静默降级成缺席。（`progress` 不在 v1 四个字段里，但判据的写法会被照抄。）
    """
    res = _dedupe(projects=[_project(progress=0), _project(progress=58)])
    assert res.projects[0].progress == 0

    filled = _dedupe(projects=[_project(progress=None), _project(progress=58)])
    assert filled.projects[0].progress == 58


def test_project_risk_is_keep_first_via_is_None():
    res = _dedupe(projects=[
        _project(risk=ProjectRisk(level="low")),
        _project(risk=ProjectRisk(level="high", reason="雨季无备选场地")),
    ])
    assert res.projects[0].risk.level == "low"
    assert res.projects[0].risk.reason == ""


def test_project_milestones_use_a_FALSY_check_not_is_None():
    """现状存疑（钉住不修）：`if not cur.milestones`（extract.py:1732），空 list 会被后来者替换。

    与 `progress`/`risk` 的 `is None` 判据**不一致**：那两个区分"没说"和"说了个空/零"，这个不区分。
    对 milestones 恰好无害（空列表本来就等于没说），但同一个函数里三种判据并存这件事本身值得被
    看见——第二步写"非空"判据时必须自己选一种，而不是"照上一行抄"。
    """
    later = [ProjectMilestone(name="场地确认", status="done")]
    res = _dedupe(projects=[_project(milestones=[]), _project(milestones=later)])
    assert res.projects[0].milestones == later

    first = [ProjectMilestone(name="立项", status="done")]
    held = _dedupe(projects=[_project(milestones=first), _project(milestones=later)])
    assert held.projects[0].milestones == first


def test_milestones_are_relisted_by_post_init_so_the_LIST_is_a_copy_but_items_are_not():
    """`ProjectEntity.__post_init__` 用列表推导重建 `milestones`（extract.py:1313-1314），所以
    传进去的 list 对象**不是**实体上的那个 list —— 但里面的 ProjectMilestone 元素是同一批对象。

    钉这条是因为第一版这个文件在这里写错过（断言 `is later` 直接红）。半深拷贝是很容易想当然的
    地方：dedupe 的 `cur.milestones = pr.milestones` 确实是别名赋值，只不过它别名的是
    `__post_init__` 重建出来的那个 list，不是调用方手里的那个。
    """
    later = [ProjectMilestone(name="场地确认", status="done")]
    holder = _project(milestones=later)
    assert holder.milestones is not later, "__post_init__ 应当重建 list"
    assert holder.milestones[0] is later[0], "元素本身不拷贝"

    res = _dedupe(projects=[_project(milestones=[]), holder])
    assert res.projects[0].milestones is holder.milestones, "dedupe 内部是别名赋值"


def test_project_blockers_and_dependsOn_are_capped_unions():
    res = _dedupe(projects=[
        _project(blockers=["场地未定"], dependsOn=["市场部预算"]),
        _project(blockers=["场地未定", "摄影师档期"], dependsOn=["设计稿"]),
    ])
    pr = res.projects[0]
    assert pr.blockers == ["场地未定", "摄影师档期"]
    assert pr.dependsOn == ["市场部预算", "设计稿"]

    capped = _dedupe(projects=[
        _project(blockers=[f"阻碍{i}" for i in range(5)]),
        _project(blockers=[f"阻碍{i}" for i in range(5, 10)]),
    ])
    assert capped.projects[0].blockers == [f"阻碍{i}" for i in range(6)]


def test_project_id_and_title_come_from_the_first_record():
    res = _dedupe(projects=[
        ProjectEntity(id="p_core_flow", title="Core-Flow"),
        ProjectEntity(id="p_core flow", title="core flow", status="进行中"),
    ])
    assert len(res.projects) == 1
    assert (res.projects[0].id, res.projects[0].title) == ("p_core_flow", "Core-Flow")
    assert res.projects[0].status == "进行中"


# === 8 · 完全不被 dedupe 触碰的东西 =============================================================
# 「没动」也是行为，也要钉 —— 第二步如果在函数里多写一行顺手动了这些，这一节会红。

def test_materials_are_never_deduped_even_when_byte_identical():
    """同一句话出现在两份文档里 = 两条**各自可引用**的证据，绝不许合并。

    extract.py:1678-1682 点名了原因：中文文档天然在每份文件里重复页眉/页脚/免责声明，按文本去重
    会把除第一份以外所有文件的这段语料删掉、切断引用链，还让 registry 的 `_chunks_per_file` 少报。
    """
    same = "花名册由人事部于每月初更新，口径以人事系统为准。"
    res = _dedupe(
        people=[_person()],
        materials=[
            MaterialChunk(id="员工花名册.md:12", text=same, source="员工花名册.md:12"),
            MaterialChunk(id="本周周报.md:20", text=same, source="本周周报.md:20"),
        ],
    )
    assert len(res.materials) == 2
    assert {m.source for m in res.materials} == {"员工花名册.md:12", "本周周报.md:20"}


def test_playbooks_pass_through_untouched():
    """方法卡：`_dedupe_entities` 一行都没写过它们，哪怕逐字重复也原样两条。"""
    card = MethodCard(title="宴会动线标准", description="适用于 200 人以上宴会")
    res = _dedupe(people=[_person()], playbooks=[card, card])
    assert len(res.playbooks) == 2


# === 8b · 信号 · 字面克隆折叠（第一版这个文件漏读了整整一节） ===================================
# ⚠ 记一笔方法上的教训：`_dedupe_entities` 真正的范围是 **extract.py:1648-1751**，不是票面上写的
# 1648-1712 —— 1740-1749 还有一整段信号折叠。第一版本文件按票面行号读，断言"信号不被碰"，当场红。
# 行号是转述，函数体才是事实；下面这一节就是那个红换来的。

def test_signals_that_are_LITERAL_CLONES_collapse_to_one():
    """信号按 (subjectType, subjectRef, summary) 折叠，keep-first，且**从不 enrich**。

    `_signal_key`（extract.py:529-545）自己写了理由：SignalEntity 没有 count/strength 字段，重复
    一条不等于"更响"，只等于同一张卡渲染两遍 = 噪音。
    """
    sig = SignalEntity(id="s1", source_kind="doc", subjectType="person",
                       subjectRef=ZHOU, summary="本周同时压着两场宴会", source="本周周报.md:9")
    dup = SignalEntity(id="s2", source_kind="doc", subjectType="person",
                       subjectRef=ZHOU, summary="本周同时压着两场宴会", source="八月复盘.md:3")
    res = _dedupe(people=[_person()], signals=[sig, dup])
    assert len(res.signals) == 1
    assert res.signals[0] is sig, "keep-first：先到的整条留下"
    assert res.signals[0].source == "本周周报.md:9", "后到的那份出处随整条一起丢弃"


def test_signal_key_folds_case_and_whitespace_but_a_RESTATEMENT_survives():
    """折叠只吃**字面克隆**（大小写/空白折叠后相等）；换个说法的同一件事两条都活。"""
    a = SignalEntity(id="s1", source_kind="doc", subjectType="person",
                     subjectRef=ZHOU, summary="本周同时压着  两场宴会")
    b = SignalEntity(id="s2", source_kind="doc", subjectType="person",
                     subjectRef=ZHOU, summary="本周同时压着 两场宴会")
    assert len(_dedupe(people=[_person()], signals=[a, b]).signals) == 1

    restated = SignalEntity(id="s3", source_kind="doc", subjectType="person",
                            subjectRef=ZHOU, summary="两场宴会撞在同一周")
    assert len(_dedupe(people=[_person()], signals=[a, restated]).signals) == 2


def test_granularity_is_left_exactly_as_it_was():
    """粒度裁决簿在 dedupe 之前就装配好了（extract.py:1641），dedupe 不许碰它。

    ⚠ 顺带记一条第二步必须知道的事实（本条不断言，注在这里）：`granularity` 是
    `ExtractionResult` 的顶层字段，而 `pg_registry.get()` 重建 ExtractionResult 时**根本不读它**
    （pg_registry.py:456-463 只重建 people/projects/signals/playbooks/materials）——它在真库往返
    里是**静默丢失**的。所以第二步的 `conflicts` 如果只当个顶层字段加上去，离线全绿、生产全丢。
    落库必须走 entities 的新 kind。
    """
    marker = ["ruling-sentinel"]
    res = _dedupe(people=[_person(team=ROSTER_TEAM), _person(team=WEEKLY_TEAM)], granularity=marker)
    assert res.granularity is marker


# === 9 · 真 pipeline 可达性 =====================================================================
# 上面全是单元层。只钉单元层是"判据够不着"型假绿：万一真语料根本走不到碰撞那一步，钉了也白钉。
# 这一节用**真中文文档**跑完整的 parse → HeuristicExtractor → extract_docs（含 dedupe）。

_ROSTER_DOC = """# 三亚亚特兰蒂斯别墅酒店 — 员工花名册

姓名 | 职位 | 部门 | 司龄 | 负责
周雅婷 | 市场推广专员 | 市场推广部 | 2 年 | 别墅套餐推广物料
孙浩 | 餐饮部领班 | 餐饮部 | 4 年 | 宴会动线优化
"""

# 同一个人、同一个格子、不同读数 —— 部门从「市场推广部」变成了「前厅部」。
_LATER_ROSTER_DOC = """# 三亚亚特兰蒂斯别墅酒店 — 八月部门调整后名册

姓名 | 职位 | 部门 | 司龄 | 负责
周雅婷 | 前厅接待 | 前厅部 | 2 年 | 前台交接流程
"""


def _pipeline(*docs):
    """真离线路：parse_bytes → HeuristicExtractor → extract_docs（内含 _dedupe_entities）。"""
    parsed = [parse_bytes(name, text.encode("utf-8")) for name, text in docs]
    return extract_docs(parsed, extractor=HeuristicExtractor())


def test_the_collision_is_REACHABLE_through_the_real_offline_pipeline_B2A():
    """真语料确认：两份真中文花名册，周雅婷的部门就是会碰撞，而且输家真的不见了。

    这条是单元层那些断言的"可达性证明"。它同时也是第二步的验收锚点：第二步之后，同样这两份文档
    必须让 `conflicts` 里出现一条 {subject_kind:'person', field:'team'}，两个 value 各带
    source 与 doc_key。
    """
    res = _pipeline(("roster_a.md", _ROSTER_DOC), ("roster_b.md", _LATER_ROSTER_DOC))

    zhou = [p for p in res.people if p.name == ZHOU]
    assert len(zhou) == 1, f"周雅婷没合成一条：{[(p.name, p.team) for p in res.people]}"
    assert zhou[0].team == ROSTER_TEAM, "先到的花名册读数应当胜出"

    people_blob = repr([asdict(p) for p in res.people])
    assert WEEKLY_TEAM not in people_blob, (
        f"{WEEKLY_TEAM} 竟然还在人员结果里 —— 碰撞语料没生效，本节的可达性证明失效了"
    )


def test_the_pipeline_collision_also_flips_with_upload_order():
    """真 pipeline 上同样是"谁先传谁赢"，把单元层的顺序结论在真路上再确认一次。"""
    res = _pipeline(("roster_b.md", _LATER_ROSTER_DOC), ("roster_a.md", _ROSTER_DOC))
    zhou = next(p for p in res.people if p.name == ZHOU)
    assert zhou.team == WEEKLY_TEAM


def test_the_pipeline_corpus_really_produces_two_readings_before_dedupe():
    """语料自检：两份文档**各自**确实抽出了周雅婷，且部门不同。

    没有这一条，上面两条会在语料退化（比如第二份根本没抽出人）时依然全绿 —— 那正是"空真"型假绿。
    """
    a = HeuristicExtractor().extract(parse_bytes("roster_a.md", _ROSTER_DOC.encode("utf-8")))
    b = HeuristicExtractor().extract(parse_bytes("roster_b.md", _LATER_ROSTER_DOC.encode("utf-8")))
    za = next((p for p in a.people if p.name == ZHOU), None)
    zb = next((p for p in b.people if p.name == ZHOU), None)
    assert za is not None, "第一份文档没抽出周雅婷 —— 语料或路由退化了"
    assert zb is not None, "第二份文档没抽出周雅婷 —— 语料或路由退化了"
    assert za.team == ROSTER_TEAM and zb.team == WEEKLY_TEAM
    assert za.source.startswith("roster_a.md:") and zb.source.startswith("roster_b.md:"), (
        f"出处不是 <文档名>:<行> 形状：{za.source!r} / {zb.source!r} —— "
        f"第二步的 doc_key 就是从这个形状上切出来的"
    )
