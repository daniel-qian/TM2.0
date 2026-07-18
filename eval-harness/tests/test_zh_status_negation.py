# -*- coding: utf-8 -*-
"""中文否定短语 × 状态梯子 —— 「本月无法完成」被读成「已完成」的回归门。

*** FIXED. 下面描述的每一条都已经修好，本文件是它的回归门。过去式是刻意的：这些数字是实测记录，
    不是对当前行为的描述。***

THE BUG. `extract._norm_status` 的四条中文梯子各自带一个**单字**否定前瞻 ——
`(?<![未没待])完成` / `(?<![无没])风险` / `(?<![不异])正常` —— 而中文用**短语**否定。
单字前瞻只能往回看一个字，所以它挡得住「未完成」，挡不住「无法完成」（前一个字是「法」）。
实测，逐条跑出来的，不是读正则推出来的：

    无法完成 / 未能完成 / 不能完成 / 没能完成 / 难以完成 / 无从完成   -> "done"      ← blocker
    没有风险 / 未发现风险 / 无明显风险 / 无重大风险 / 不存在风险      -> "at-risk"   ← 假警报
    未按计划推进 / 未能如期交付 / 进展不顺利 / 不太顺利 / 不是正常    -> "on-track"  ← 反向
    未受阻 / 没有卡住 / 不会停工 / 不再搁置                          -> "blocked"   ← 假警报

第一行是 blocker 而不是普通 bug 的原因在下游：`status="done"` 正是 decision_grading `_m_done`
读的字段，于是一个自述「本月无法完成」的项目被定级 **可推进**，理由写
**「项目自报已完成，且无风险信号」**（decision_rules.py 里那条"完成"规则的原文）。不是漏报，
是把客户自己文件里的话读成了**反面**。end-to-end 那条在
`test_a_project_that_says_it_cannot_finish_reaches_the_manager_as_at_risk` 里整条跑出来。

THE FIX，在 extract.py：四条梯子共用一个**边界精确**的反向扫描 `_zh_states` / `_zh_negation_depth`，
不再各自带前瞻。刻意**不是**滑动窗口 —— redline._negated 的 32 字窗口就是 B3（「别墅」把红线
整段关掉）的成因。这里否定必须**正好结束在关键词开始的位置**才算数，所以
「未来风险」「非常正常」「不过完成了」原样通过（来 / 常 / 过 不是连接字，否定够不着关键词）。
误报侧在本文件 `_LOOKALIKES` / `_STILL_READS` 两张表里量出来：**0 漏报 0 误报**。

两处不对称，都是刻意的，都在下面有门：
  1. 「无法完成」→ at-risk，不是 ""。「未完成」是中性事实（还没做完 = 正在做），留白；
     「无法完成」是项目在告诉经理它会 miss，压成留白是诚实但装聋，而且那个留白到了
     decision_grading 就变成「文档没陈述状态」——对一份写得清清楚楚的文档说这句话，本身又是
     一次失实。
  2. 双重否定：「并非没有风险」= 确实有风险 → at-risk（depth 2 当 depth 0 用）；
     「并非无法完成」= 还有机会做完 ≠「已完成」→ ""（正面档要求 depth 严格为 0）。

CORPUS 全部是**真汉字**。上一波「别墅」栽的就是「整套门语料是 ASCII 拼音伪装」——
拼音语料测不到 CJK 无词边界这件事本身，而 CJK 无词边界正是这个 bug 的全部成因。
"""
from __future__ import annotations

import re
from contextlib import contextmanager
from datetime import date
from pathlib import Path

import pytest

from avery import decision_rules as R
from avery.ingest import extract
from avery.ingest.extract import ExtractionResult, _norm_status
from avery.ingest.parse import ParsedDoc
from avery.ingest.registry import CompanyContext

TODAY = date(2026, 7, 18)


# =============================================================================================
# 修复前的实现，原样搬回来 —— 每张表都要证明自己真的咬得动
# =============================================================================================

# 修复前四条梯子的**逐字原文**（`git show 3ef4224:eval-harness/avery/ingest/extract.py`）。
# `_ZH_CANNOT_DELIVER` 当时不存在，用一个永不匹配的模式表示"没有这条"。
_SHIPPED_BEFORE_THE_FIX = {
    "_ZH_BLOCKED": r"受阻|已阻断|阻塞|卡住|停滞|停工|中止|搁置|无法推进|推不动",
    "_ZH_AT_RISK": r"(?<![无没])风险|延期|逾期|滞后|落后|推迟|拖期|告急|吃紧|超期",
    "_ZH_DONE": r"(?<![未没待])完成|已交付|已上线|已结项|已验收|验收通过",
    "_ZH_ON_TRACK": r"进行中|推进中|(?<![不异])正常|按计划|如期|顺利|在轨",
    "_ZH_CANNOT_DELIVER": r"(?!)",
}


@contextmanager
def before_the_fix():
    """把 extract 模块**就地**退回修复前：四条常量换回带单字前瞻的原文，`_zh_states` 换回当时
    那句裸 `re.search`。

    在进程里改真模块，而不是在测试里抄一份 `_norm_status` 的旧副本 —— 抄一份会随实现漂移，
    然后某天变成「证明了一个早就没人跑的函数有 bug」。这里跑的是真的 `_norm_status`。
    """
    saved = {k: getattr(extract, k) for k in _SHIPPED_BEFORE_THE_FIX}
    saved_states = extract._zh_states
    try:
        for k, v in _SHIPPED_BEFORE_THE_FIX.items():
            setattr(extract, k, v)
        extract._zh_states = lambda t, pattern, **kw: bool(re.search(pattern, t))
        yield
    finally:
        for k, v in saved.items():
            setattr(extract, k, v)
        extract._zh_states = saved_states


# =============================================================================================
# 语料。(真中文, 修复后应读作, 修复前实测读作) —— 第三列是跑出来的，见本文件顶部
# =============================================================================================

# 一、否定式，修复前全部翻成了正面或翻成了假警报。这是 BORN RED 的那一批。
_NEGATED_BUT_READ_POSITIVE = [
    # 「做不完」被读成「做完了」—— blocker 本体
    ("本月无法完成", "at-risk", "done"),
    ("无法完成", "at-risk", "done"),
    ("未能完成", "at-risk", "done"),
    ("不能完成", "at-risk", "done"),
    ("没能完成", "at-risk", "done"),
    ("难以完成", "at-risk", "done"),
    ("无从完成", "at-risk", "done"),
    ("无法按时完成", "at-risk", "done"),
    ("未能如期完成", "at-risk", "done"),
    ("无法如期完成", "at-risk", "done"),
    ("本季度难以完成收尾", "at-risk", "done"),
    # 同族的「交付/上线/验收」，修复前落进留白或落进 on-track
    ("无法交付", "at-risk", ""),
    ("未能交付", "at-risk", ""),
    ("不能上线", "at-risk", ""),
    ("无法验收", "at-risk", ""),
    ("难以达成", "at-risk", ""),
    ("无法按期上线", "at-risk", ""),
    ("未能如期交付", "at-risk", "on-track"),   # 「如期」命中 on-track，否定被无视
]

# 二、否定掉的风险，修复前变成假警报。方向和上面相反：这类是「客户说没有，产品说有」。
_NEGATED_RISK = [
    ("没有风险", "", "at-risk"),
    ("未发现风险", "", "at-risk"),
    ("无明显风险", "", "at-risk"),
    ("无重大风险", "", "at-risk"),
    ("不存在风险", "", "at-risk"),
    ("未出现风险", "", "at-risk"),
    ("没有延期", "", "at-risk"),
    ("不会延期", "", "at-risk"),
    ("未见滞后", "", "at-risk"),
    ("不存在逾期", "", "at-risk"),
    ("没有落后", "", "at-risk"),
]

# 三、否定掉的「正常」，修复前 on-track。任务书点名要查的「不是正常」在这里。
_NEGATED_ON_TRACK = [
    ("未按计划推进", "", "on-track"),
    ("没有按计划推进", "", "on-track"),
    ("不按计划", "", "on-track"),
    ("未能如期", "", "on-track"),
    ("无法如期", "", "on-track"),
    ("进展不顺利", "", "on-track"),
    ("不太顺利", "", "on-track"),
    ("不够顺利", "", "on-track"),
    ("不是正常", "", "on-track"),
    ("不太正常", "", "on-track"),
    ("不在轨", "", "on-track"),
]

# 四、否定掉的阻塞。修复前 `_ZH_BLOCKED` **一个前瞻都没有**，所以「未受阻」直接读成 blocked。
# 方向偏安全侧（顶多多看一眼），但它仍然是在对客户的文档作失实陈述，一并修。
_NEGATED_BLOCKED = [
    ("未受阻", "", "blocked"),
    ("没有受阻", "", "blocked"),
    ("不存在阻塞", "", "blocked"),
    ("没有卡住", "", "blocked"),
    ("不会停工", "", "blocked"),
    ("未搁置", "", "blocked"),
    ("不再搁置", "", "blocked"),
    ("没有停滞", "", "blocked"),
]

_BORN_RED = (_NEGATED_BUT_READ_POSITIVE + _NEGATED_RISK
             + _NEGATED_ON_TRACK + _NEGATED_BLOCKED)

# 五、误报侧的控制组。**没有这张表，上面四张表毫无意义** —— 把四条梯子整个删掉也能让它们全绿。
# 这些必须原样保持原来的读数。
_STILL_READS = [
    # 正面自报
    ("已完成", "done"), ("如期完成", "done"), ("按时完成", "done"),
    ("验收通过", "done"), ("已上线", "done"), ("已交付", "done"),
    ("进行中", "on-track"), ("正常推进", "on-track"), ("按计划推进", "on-track"),
    ("一切顺利", "on-track"), ("在轨", "on-track"),
    # 真风险 / 真阻塞
    ("有风险", "at-risk"), ("存在延期风险", "at-risk"), ("已经逾期两周", "at-risk"),
    ("受阻", "blocked"), ("已阻塞", "blocked"), ("无法推进", "blocked"), ("推不动", "blocked"),
    # 修复前那几个单字前瞻**确实**挡住的，不许被这次改动弄丢
    ("未完成", ""), ("没完成", ""), ("待完成", ""), ("尚未完成", ""),
    ("无风险", ""), ("没风险", ""), ("异常", ""), ("不正常", ""),
    # 拍板过不映射的词（feat-054），保持留白
    ("待确认", ""),
]

# 六、**「别墅」那一课**：字里带否定字、但根本不是否定的词。边界精确扫描 vs 滑动窗口的分水岭 ——
# 滑动窗口会把这六条全部误伤。
_LOOKALIKES = [
    ("未来风险较大", "at-risk", "「未来」是 future，不是「未」+ 风险"),
    ("未来三周仍有延期风险", "at-risk", "同上，长句"),
    ("非常正常", "on-track", "「非常」是 very，不是「非」+ 正常"),
    ("非常顺利", "on-track", "同上"),
    ("不过完成了", "done", "「不过」是 but，不是「不」+ 完成"),
    ("无论如何都要如期交付", "on-track", "「无论」是 regardless，「如期」照读"),
]

# 七、双重否定。两个方向**不对称**，而且是刻意的，见模块 docstring 第 2 点。
_DOUBLE_NEGATION = [
    ("并非没有风险", "at-risk", "= 确实有风险。修复前碰巧也对，这次不许把它弄坏"),
    ("不无风险", "at-risk", "= 有风险。修复前读成留白（「无」挡掉了），现在读对了"),
    ("并非无法完成", "", "= 还有机会做完 ≠ 已完成。修复前读成 done，正面档要求 depth 严格为 0"),
]

# 八、英文臂。中文词表是纯增量，英文一个字都不许动。
_ENGLISH = [
    ("Status: blocked", "blocked"), ("at-risk", "at-risk"), ("behind schedule", "at-risk"),
    ("shipped", "done"), ("done", "done"), ("on track", "on-track"),
    ("on schedule", "on-track"), ("nothing here", ""),
]


# =============================================================================================
# BORN RED —— 四条梯子逐条
# =============================================================================================

@pytest.mark.parametrize("text,want,_before", _NEGATED_BUT_READ_POSITIVE)
def test_inability_is_never_read_as_completion(text, want, _before):
    """BORN RED，blocker 本体。

    「无法完成」和「未完成」不是一回事，两者都不是「已完成」。单字否定前瞻只看得见紧邻的一个字，
    而中文用短语否定 —— 「无法」的「法」、「未能」的「能」、「难以」的「以」都不在
    `[未没待]` 里，于是整句穿过前瞻直接命中「完成」。
    """
    got = _norm_status(text)
    assert got != "done", (
        f"「{text}」 被读成 done：{got!r}\n"
        f"这是把项目自述的「做不完」读成了「做完了」。下游 decision_grading `_m_done` 会据此判"
        f"「可推进」，理由写「项目自报已完成，且无风险信号」——和文档说的正好相反。")
    assert got == want, f"「{text}」 -> {got!r}，应为 {want!r}"


@pytest.mark.parametrize("text,want,_before", _NEGATED_RISK)
def test_negated_risk_is_not_a_risk_alarm(text, want, _before):
    """BORN RED，方向相反的那一半：客户写「未发现风险」，产品报「有风险」。

    `(?<![无没])风险` 只挡得住「无风险」「没风险」两种写法。中国人更常写「没**有**风险」
    「未**发现**风险」「无**明显**风险」—— 中间隔一个字，前瞻就瞎了。
    """
    got = _norm_status(text)
    assert got != "at-risk", (
        f"「{text}」 被读成 at-risk：文档说没有，产品说有。假警报摆在付费客户面前，"
        f"代价比留白高（见 `_norm_status` docstring 里 待确认 那一段的同一条论证）。")
    assert got == want, f"「{text}」 -> {got!r}，应为 {want!r}"


@pytest.mark.parametrize("text,want,_before", _NEGATED_ON_TRACK)
def test_negated_on_track_is_not_on_track(text, want, _before):
    """BORN RED。任务书点名的「不是正常」在这张表里，和它同族的一整批也在。

    最狠的是「未能如期交付」：它命中 `如期` 读成 on-track —— 一个明说没交付的项目，
    首屏显示「按计划推进」。
    """
    got = _norm_status(text)
    assert got != "on-track", (
        f"「{text}」 被读成 on-track：这是把否定式读成了正面自述。"
        f"on-track 会经 `_m_clear` 变成「可推进 / 项目自报正常」。")
    assert got == want, f"「{text}」 -> {got!r}，应为 {want!r}"


@pytest.mark.parametrize("text,want,_before", _NEGATED_BLOCKED)
def test_negated_blocked_is_not_blocked(text, want, _before):
    """BORN RED。`_ZH_BLOCKED` 修复前**一个否定前瞻都没有** —— 另外三条至少还各有一个。

    偏安全侧不等于可以留着：对一份写着「未受阻」的文档说「已阻塞」，同样是产品在说客户
    文件里没有的话，只是这次说的是坏消息。
    """
    got = _norm_status(text)
    assert got != "blocked", f"「{text}」 被读成 blocked：文档说的是没受阻。"
    assert got == want, f"「{text}」 -> {got!r}，应为 {want!r}"


# =============================================================================================
# 误报侧 —— 0 误报是量出来的，不是假设的
# =============================================================================================

@pytest.mark.parametrize("text,want", _STILL_READS)
def test_ordinary_statements_still_read_the_same(text, want):
    """BORN GREEN，控制组。**这张表才是上面四张表的意义所在。**

    否定这件事只要做过了头，四条梯子就会集体变哑 —— 而那样上面每一条 BORN RED 都会变绿，
    看起来像修好了。这里逐条钉死正面自报、真风险、真阻塞，外加修复前那几个单字前瞻**确实**
    挡住的词（未完成 / 无风险 / 异常），一个都不许在这次改动里丢掉。
    """
    assert _norm_status(text) == want, (
        f"「{text}」 -> {_norm_status(text)!r}，应为 {want!r}。"
        f"否定扫描做过头了：它把正常的读数也一起吃掉了。")


@pytest.mark.parametrize("text,want,why", _LOOKALIKES)
def test_words_that_merely_contain_a_negator_glyph_are_not_negations(text, want, why):
    """BORN GREEN —— 「别墅」那一课，换成状态梯子的版本。

    「未来」「非常」「不过」「无论」都带着一个否定字，但都不是否定。B3 之所以能把红线整段关掉，
    就是因为 `redline._negated` 用的是 32 字滑动窗口：附近**任何地方**出现一个否定线索，后面
    全部失效。这里的扫描要求否定**正好结束在关键词开始的位置**，所以「未来风险」的「未」够不到
    「风险」（中间隔着「来」，而「来」不是连接字）。

    这不是一个白名单：「未来」「非常」不需要被特别豁免，它们是**按构造**通过的 —— 这正是
    B3 的结论（「别墅白名单几乎什么都修不了」）在这里的重演。
    """
    assert _norm_status(text) == want, (
        f"「{text}」 -> {_norm_status(text)!r}，应为 {want!r} —— {why}。\n"
        f"否定扫描误伤了一个只是碰巧带否定字的词。如果这条红了，检查扫描是不是退化成了"
        f"滑动窗口（那就是 B3 在状态梯子上重演）。")


@pytest.mark.parametrize("text,want,why", _DOUBLE_NEGATION)
def test_double_negation(text, want, why):
    """BORN GREEN（第三条 BORN RED）。中文双重否定，两个方向刻意不对称。

    「并非没有风险」= 确实有风险 → at-risk。若否定只是一个 True/False 开关而不是**计数**，
    这句会被读成留白 —— 一句在明说有风险的话被压成「文档没说」。
    「并非无法完成」= 我们还能做完 ≠「已完成」→ 留白。正面档要求 depth 严格为 0。
    """
    assert _norm_status(text) == want, (
        f"「{text}」 -> {_norm_status(text)!r}，应为 {want!r} —— {why}")


@pytest.mark.parametrize("text,want", _ENGLISH)
def test_the_english_arm_is_untouched(text, want):
    """BORN GREEN。中文词表是纯增量，两家外部公司里有一家是瑞典的，英文臂一个字都不许动。"""
    assert _norm_status(text) == want


# =============================================================================================
# 突变证明 —— 每一条 BORN RED 都要证明自己真的咬得动，在进程里跑，不是写在注释里
# =============================================================================================

def test_every_born_red_case_flips_under_the_pre_fix_ladder():
    """BORN GREEN，而它是上面四张 BORN RED 表的**担保**。

    把 extract 就地退回修复前，逐条断言它给出当年实测的那个**错**答案。任何一条不再翻转，就说明
    它已经不是在测这个 bug 了 —— 要么是装饰，要么是别的东西顺手修掉的，两种情况都该从表里删掉，
    而不是留在那里看着像保护。这是 B3 那份文件（`test_the_negation_mutation_actually_bites`）
    立的规矩，照抄。
    """
    not_flipping, wrong_record = [], []
    with before_the_fix():
        for text, want, before in _BORN_RED:
            got = _norm_status(text)
            if got != before:
                wrong_record.append(f"「{text}」修复前实测应为 {before!r}，突变下得到 {got!r}")
            if got == want:
                not_flipping.append(f"「{text}」在修复前的代码上就已经是 {want!r} 了")

    assert not wrong_record, (
        "语料表第三列（修复前读数）和把实现退回去实际跑出来的结果对不上：\n  "
        + "\n  ".join(wrong_record)
        + "\n第三列是实测记录。对不上说明 `_SHIPPED_BEFORE_THE_FIX` 抄错了，"
          "整个突变证明连同它担保的四张表都不再成立。")
    assert not not_flipping, (
        "这些「BORN RED」用例在修复前的代码上就是绿的，它们没有在测这次的 bug：\n  "
        + "\n  ".join(not_flipping))

    # 还原真的还原了 —— 否则本 session 后面每个测试都在跑一个 mutant
    assert _norm_status("本月无法完成") == "at-risk", "突变没还原，extract 还是被 patch 的状态"


def test_the_negation_scan_is_boundary_exact_not_a_window():
    """BORN GREEN。把「边界精确」这条契约本身钉住，而不是钉住它的某几个后果。

    直接对 `_zh_negation_depth` 提问：否定必须**正好结束在**关键词起点才算数。这是 `_LOOKALIKES`
    整张表背后唯一的机制，也是这次没有重蹈 B3 的唯一原因 —— 后果会随词表变，机制不会。
    """
    # 「无法完成」：否定紧贴关键词
    assert extract._zh_negation_depth("无法完成", len("无法")) == 1
    # 「未来风险」：「未」和「风险」之间隔着「来」，够不着
    assert extract._zh_negation_depth("未来风险较大", len("未来")) == 0
    # 「并非没有风险」：非 → 没有，两层
    assert extract._zh_negation_depth("并非没有风险", len("并非没有")) == 2
    # 远处的否定不算数 —— 滑动窗口会算，这里不算
    far = "无法确认上游排期，本周该项目按计划推进"
    assert extract._zh_negation_depth(far, far.index("按计划")) == 0, (
        "一个隔着整个小句的否定影响到了后面的关键词 —— 扫描退化成滑动窗口了，这就是 B3。")


# =============================================================================================
# 集成层 —— 从客户的文件一路走到经理眼前的那句话
# =============================================================================================

class _NullStore:
    def query(self, q, limit=8):
        return []


_WEEKLY = "\n".join([
    "# 别墅二期精装交付",
    "负责人：陈曦",
    "状态：本月无法完成",
    "进展摘要：样板间已封样，大货排产在等集团批复。",
])


def _grade_the_weekly() -> dict:
    """三亚那份周报的形状，跑完整条链：文档 → 抽取 → 项目卡 → 决策定级。

    HERMETIC —— HeuristicExtractor 是确定性规则，无 key、无网络、无模型。
    """
    doc = ParsedDoc(name="三亚鹿山雅居_周报.md", text=_WEEKLY, doc_kind="project", ext="md")
    res = extract.HeuristicExtractor().extract(doc)
    assert res.projects, "周报没抽出项目，下面的断言就什么都证明不了"
    ctx = CompanyContext(context_id="c_fixc", extraction=res, store=_NullStore(),
                         memory_dir=Path("."))
    cards = ctx.decision_cards(as_of=TODAY)
    assert len(cards) == 1
    return cards[0]


def test_a_project_that_says_it_cannot_finish_reaches_the_manager_as_at_risk():
    """BORN RED，整条链，**这才是这条被定为 blocker 的原因**。

    单测只能说明 `_norm_status` 返回了什么。真正摆到经理面前的是决策卡上的等级和那句理由，
    而修复前它们是：

        grade  = 可推进
        reason = 项目自报已完成，且无风险信号        ← decision_rules.py 那条"完成"规则的原文

    文档原话是「本月无法完成」。这不是漏报，是把客户自己写的话读成了反面 —— 三家公司面前
    当场自证不可信的那一类。

    断言落在**用户看得见的东西**上（等级、理由、证据），不落在规则号上 —— 规则号只许住在
    decision_rules.py / decision_grading.py / decision_grading_rules.md 里，
    `test_no_rule_text_in_any_prompt` 全仓扫这件事，本文件的第一版就撞上了它。
    """
    card = _grade_the_weekly()
    assert card["grade"] != R.CAN_PROCEED, (
        f"一个自述「本月无法完成」的项目被定级 可推进：{card.get('reason')!r}")
    assert card["grade"] == R.NEEDS_CONFIRMATION, f"应为 需确认，实际 {card['grade']!r}"
    assert "自报已完成" not in (card.get("reason") or ""), (
        f"决策理由对客户的文档作了失实陈述：{card['reason']!r}\n"
        f"文档原话是「本月无法完成」。")
    evidence = [e for hit in card["matched_rules"] for e in hit["evidence"]]
    assert 'status="at-risk"' in evidence, (
        f"命中的规则里没有一条是 at-risk 状态引出来的：{card['matched_rules']}")


def test_the_same_weekly_used_to_be_graded_can_proceed():
    """BORN GREEN，上一条的突变担保 —— 也是这份 bug 报告的证据本身。

    把 extract 退回修复前，同一份周报、同一条链再跑一遍，断言它给出那个错的等级**和那句错的
    理由**。理由文本是逐字对照 `decision_rules.py` 里那条"完成"规则的，所以这不是转述，是把
    当年真会显示给经理的那句话跑出来了：

        按规则判为可推进：项目自报已完成，且无风险信号。（未读到：进度、到期日——未知不等于没风险。）
    """
    with before_the_fix():
        card = _grade_the_weekly()
        assert card["grade"] == R.CAN_PROCEED, (
            f"修复前这份周报并不是被定级 可推进（{card['grade']!r}），"
            f"那么上一条测试并没有在守它自称守的东西。")
        assert "自报已完成" in (card.get("reason") or ""), (
            f"修复前的理由里没有「自报已完成」：{card.get('reason')!r} —— "
            f"bug 报告的原文对不上，重新量。")

    assert _grade_the_weekly()["grade"] == R.NEEDS_CONFIRMATION, "突变没还原"
