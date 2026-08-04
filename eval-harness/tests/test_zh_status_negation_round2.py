# -*- coding: utf-8 -*-
"""中文否定 × 状态梯子，**第二轮**。第一轮的白名单射程不够，而且自己造出了一条反向失实。

*** FIXED。下面每一条都已修好，本文件是它们的回归门。过去式是刻意的：第三列是实测记录，
    不是对当前行为的描述。***

第一轮（20f9763）把「本月无法完成 → done」这条 blocker 的**机制**修对了：四条梯子共用一个边界
精确的反向否定扫描。对抗复核确认那条链通到底了。但复核同时量出三件事，全部在本文件里收口：

一、射程是白名单，缺口按同一条链输出同一句失实的话。同一句客户话换个说法，原 bug 原样活着：

        没办法完成 / 很难完成 / 不太可能完成 / 完成不了 / 无把握完成   -> "done"

    「没办法完成」「很难完成」不是生僻写法，三亚那种周报里就是这么写的。

二、**第一轮自己造出来的 blocker**，方向和它要修的那条一模一样：

        不得不推迟 / 不得不延期上线     修复前 "at-risk" -> 第一轮 ""
        不得不停工 / 不得不搁置 / 不得不中止   修复前 "blocked"  -> 第一轮 ""

    成因：「不」紧贴关键词 → depth=1；再往回扫「不得」时「得」不在链接字表里，外层那个「不」
    数不进来，于是中文最常见的双重否定成语被数成**单重**否定，直接反号。对照组「不是没有风险」
    修复前后都对 —— 因为「是」碰巧在表里。这不是漏一个词，是机制对双重否定的判定依赖链接字表
    的完整性。修法是把「得」加进 `_ZH_NEG_LINK`（`不得不延期` depth=2 → at-risk，
    而 `不得延期` depth=1 → "" 仍合理），本文件两个方向都钉。

三、压成留白**在产品表面不成立**，所以「读到了负面陈述」不再压成留白。
    `registry.project_cards()` 是 `if pr.status:` —— status="" 时整个键不写进 wire；前端
    `teamData.ts` 是 `card.status ?? 'on-track'`，`??` 只吃 null/undefined，键缺失正好命中，
    于是编出 on-track。所以「未按计划推进」「进展不顺利」这一类**客户自己写下的负面陈述**改读
    at-risk（`_ZH_OFF_PLAN`），不再留白。留白仍然保留给真正归不出方向的（「不是正常」「不在轨」）。
    🔴 键消失 → 前端编 on-track 这条**本身**在 registry.py / teamData.ts，不在本轮边界内，
    见 progress-fixC.md 的 needsOtherFiles。本文件只负责不再往那条路径上多送文档。

误报侧照上一波「别墅」立的规矩量：`_UNMOVED` 那张表 78 条，逐条断言**第一轮和第二轮读数完全
相同**，在进程里跑两遍真 `_norm_status`，不是写在注释里。语料全部真汉字。
"""
from __future__ import annotations

import re
from contextlib import contextmanager
from datetime import date
from pathlib import Path

import pytest

from avery import decision_rules as R
from avery.ingest import extract
from avery.ingest.extract import _norm_status
from avery.ingest.parse import ParsedDoc
from avery.ingest.registry import CompanyContext

TODAY = date(2026, 7, 18)


# =============================================================================================
# 第一轮的实现，原样搬回来 —— 每张表都要证明自己真的咬得动
# =============================================================================================

# `git show 20f9763:eval-harness/avery/ingest/extract.py` 的逐字原文。
_R1_NEG_LINK = (r"(?:及时|按时|按期|如期|准时|存在|出现|发现|达到|明显|重大|实质|任何|完全"
                r"|能|会|有|是|太|够|予|再|曾|见|及|法|从|力)")
_SHIPPED_AT_ROUND_ONE = {
    "_ZH_NEG_LINK": _R1_NEG_LINK,
    "_ZH_CANNOT_DELIVER": (r"(?:无法|未能|不能|没能|难以|无从)(?:按时|按期|如期|准时|及时)?"
                           r"(?:完成|交付|上线|结项|验收|完工|竣工|收尾|达成)"),
    # 第二轮才有的两条，用永不匹配的模式表示「当时没有这条」。
    "_ZH_OFF_PLAN": r"(?!)",
}


@contextmanager
def at_round_one():
    """把 extract 就地退回第一轮：链接字表、能力短语表换回原文，后置否定停掉，
    `_ZH_NEG_RE` 按第一轮的构造重编（第一轮没有 `_ZH_NEG_ALT`）。

    在进程里改真模块，不在测试里抄一份 `_norm_status` 的旧副本 —— 抄一份会随实现漂移，然后某天
    变成「证明了一个早就没人跑的函数有 bug」。这里跑的是真的 `_norm_status`。
    """
    saved = {k: getattr(extract, k) for k in _SHIPPED_AT_ROUND_ONE}
    saved_re, saved_post = extract._ZH_NEG_RE, extract._ZH_POST_NEG_RE
    try:
        for k, v in _SHIPPED_AT_ROUND_ONE.items():
            setattr(extract, k, v)
        extract._ZH_NEG_RE = re.compile(
            rf"(?:{extract._ZH_NEG_HEAD}{_R1_NEG_LINK}*|难[以于])\Z")
        extract._ZH_POST_NEG_RE = re.compile(r"(?!)")
        yield
    finally:
        for k, v in saved.items():
            setattr(extract, k, v)
        extract._ZH_NEG_RE, extract._ZH_POST_NEG_RE = saved_re, saved_post


# =============================================================================================
# 语料。(真中文, 第二轮应读作, 第一轮实测读作) —— 第三列是跑出来的
# =============================================================================================

# 一、能力否定，第一轮的六个词头够不着。**这批是原 blocker 的存活缺口**：读成 done 之后
# decision_grading 的原话是「按规则判为可推进：项目自报已完成，且无风险信号。」
_INABILITY_OUTSIDE_THE_ROUND_ONE_WHITELIST = [
    ("没办法完成", "at-risk", "done"),
    ("没办法按时完成", "at-risk", "done"),
    ("没法完成", "at-risk", ""),
    ("无办法完成", "at-risk", "done"),
    ("很难完成", "at-risk", "done"),
    ("太难完成", "at-risk", "done"),
    ("极难完成", "at-risk", "done"),
    ("不太可能完成", "at-risk", "done"),
    ("基本不可能完成", "at-risk", "done"),
    ("不可能完成", "at-risk", "done"),
    ("无把握完成", "at-risk", "done"),
    ("没把握完成", "at-risk", "done"),
    ("没信心完成", "at-risk", "done"),
    ("无信心按时交付", "at-risk", ""),
    ("不确定能否完成", "at-risk", "done"),
    ("不会按时完成", "at-risk", ""),
    ("不会如期完成", "at-risk", ""),
    ("无力完成", "at-risk", ""),
    ("来不及完成", "at-risk", ""),
    ("赶不上完成", "at-risk", "done"),
]

# 二、**后置**否定。中文把可能补语放在动词后面，反向扫描按构造够不着 ——
# 「完成不了」在第一轮读成 done。
_TRAILING_NEGATION = [
    ("完成不了", "at-risk", "done"),
    ("验收通过不了", "at-risk", "done"),
    ("这个月怕是完成不了", "at-risk", "done"),
    ("交付不了", "at-risk", ""),
    ("上线不下去", "at-risk", ""),
]

# 三、🔴 **第一轮自己造出来的反向失实**。这批修复前（3ef4224）是**对的**，第一轮把它们弄坏了。
_DOUBLE_NEGATIVE_IDIOM_BROKEN_BY_ROUND_ONE = [
    ("不得不推迟", "at-risk", ""),
    ("不得不延期", "at-risk", ""),
    ("不得不延期交付", "at-risk", ""),
    ("不得不推迟上线", "at-risk", ""),
    ("因集团批复未下，本月不得不推迟上线", "at-risk", ""),
    ("不得不停工", "blocked", ""),
    ("不得不停工整改", "blocked", ""),
    ("不得不搁置", "blocked", ""),
    ("不得不中止", "blocked", ""),
    ("不得不中止验收", "blocked", ""),
]

# 四、否定掉的「正常」，第一轮链接字表收了「太」「够」，没收「算」「甚」「很」「大」，
# 于是同族里这几条**仍然反向**。
_STILL_REVERSED_AT_ROUND_ONE = [
    ("不算顺利", "at-risk", "on-track"),
    ("不甚顺利", "at-risk", "on-track"),
    ("不大顺利", "at-risk", "on-track"),
    ("不很正常", "", "on-track"),
]

# 五、客户写下的负面陈述，第一轮压成了留白 —— 而留白经 wire 掉键、前端 `?? 'on-track'`
# 又变回 on-track，经理看到的和修复前一模一样。见模块 docstring 第三点。
_OFF_PLAN_FLATTENED_TO_BLANK = [
    ("未按计划推进", "at-risk", ""),
    ("没有按计划推进", "at-risk", ""),
    ("未按原计划执行", "at-risk", ""),
    ("进展不顺利", "at-risk", ""),
    ("不太顺利", "at-risk", ""),
    ("不够顺利", "at-risk", ""),
    ("进展不理想", "at-risk", ""),
    ("进展不乐观", "at-risk", ""),
]

_BORN_RED = (_INABILITY_OUTSIDE_THE_ROUND_ONE_WHITELIST
             + _TRAILING_NEGATION
             + _DOUBLE_NEGATIVE_IDIOM_BROKEN_BY_ROUND_ONE
             + _STILL_REVERSED_AT_ROUND_ONE
             + _OFF_PLAN_FLATTENED_TO_BLANK)

# 六、误报侧。**没有这张表，上面五张表毫无意义** —— 把否定扫描调得足够狠也能让它们全绿。
# 这些必须在第一轮和第二轮读出**完全相同**的结果，逐条实测，见
# `test_the_false_positive_side_did_not_move_at_all`。
#
# 前半张表针对第二轮**新加的每一个**链接字（得 很 甚 算 大 可能 办法 把握 信心）和两条新
# 备选（V不C 可能补语、后置「不了」）—— 新加的东西自己带控制组，不靠别人的表兜底。
_UNMOVED = [
    # 「得」是第二轮血溅面最大的一个字：它出现在大量非否定词里
    ("值得推广的做法，本项目已完成", "done"),
    ("取得批复，已上线", "done"),
    ("获得验收通过", "done"),
    ("客户觉得正常", "on-track"),
    ("赢得客户认可，已交付", "done"),
    ("来得及完成", "done"),
    ("难得顺利", "on-track"),
    ("不得已停工整改", "blocked"),      # 「已」不是链接字，够不着 停工
    # 度量副词 很 / 甚 / 大 / 算 —— 只有跟在否定词头后面才算否定
    ("很顺利", "on-track"), ("很正常", "on-track"), ("进展很顺利", "on-track"),
    ("风险很大", "at-risk"), ("甚至已经完成", "done"), ("大部分已完成", "done"),
    ("打算完成收尾", "done"), ("核算完成", "done"), ("结算完成", "done"), ("预算完成", "done"),
    # 多字链接 可能 / 办法 / 把握 / 信心 —— 没有否定词头就什么都不做
    ("可能延期", "at-risk"), ("有可能延期", "at-risk"), ("存在延期可能", "at-risk"),
    ("想办法完成", "done"), ("有把握完成", "done"), ("很有把握完成", "done"),
    ("有信心完成", "done"),
    # V不C 可能补语：多 / 定 / 待 不是补语，不许被吃掉
    ("差不多完成了", "done"), ("说不定完成", "done"), ("迫不及待要上线，已完成", "done"),
    ("做不完成本核算", ""),
    # 后置否定刻意**排除**「不成」：这两条是好消息，读成否定就是反号
    ("按时完成不成问题", "done"), ("如期交付不成问题", "on-track"),
    ("已完成不再变更", "done"), ("已完成不含税结算", "done"),
    # 「难」必须带度量副词才算否定 —— 困难 / 万难 / 灾难 / 难免 / 难点都不是
    ("克服困难完成了交付", "done"), ("排除万难完成验收", "done"), ("灾难演练已完成", "done"),
    ("难免延期", "at-risk"), ("难点已解决，已完成", "done"),
    # _ZH_OFF_PLAN 不许对正面的「顺利 / 计划」开火
    ("一切顺利", "on-track"), ("非常顺利", "on-track"), ("总体顺利", "on-track"),
    ("进展顺利，按计划推进", "on-track"), ("已按计划完成", "done"),
    ("按原计划推进", ""), ("计划下月上线", ""),
    ("并非不顺利", ""), ("没有不顺利的地方", ""),
    # 第一轮的「别墅」控制组，一条不许丢
    ("未来风险较大", "at-risk"), ("非常正常", "on-track"), ("不过完成了", "done"),
    ("无论如何都要如期交付", "on-track"), ("异常已排除", ""),
    ("待完成", ""), ("未完成", ""), ("待确认", ""),
    # 否定掉的风险 / 阻塞仍然安静
    ("没有风险", ""), ("未发现风险", ""), ("无明显风险", ""), ("无重大风险", ""),
    ("不存在风险", ""), ("未受阻", ""), ("没有卡住", ""), ("不会停工", ""), ("不再搁置", ""),
    # 双重否定的两个方向都不许动
    ("并非没有风险", "at-risk"), ("不是没有风险", "at-risk"), ("不无风险", "at-risk"),
    ("并非无法完成", ""),
    # 英文臂一个字都不许动
    ("Status: blocked", "blocked"), ("at-risk", "at-risk"), ("behind schedule", "at-risk"),
    ("shipped", "done"), ("done", "done"), ("on track", "on-track"),
    ("on schedule", "on-track"), ("nothing here", ""),
]


# =============================================================================================
# BORN RED —— 逐条
# =============================================================================================

@pytest.mark.parametrize("text,want,_r1", _INABILITY_OUTSIDE_THE_ROUND_ONE_WHITELIST)
def test_inability_outside_the_round_one_whitelist_is_not_completion(text, want, _r1):
    """BORN RED。**原 blocker 的存活缺口**：机制修对了方向，射程是白名单。

    读成 done 之后整条链的原话是「按规则判为可推进：项目自报已完成，且无风险信号。」——
    对一份写着「没办法完成」的周报。
    """
    got = _norm_status(text)
    assert got != "done", (
        f"「{text}」 被读成 done：项目在说它做不完，产品把它读成了已完成。"
        f"done 经 `_m_done` 变成「可推进 / 项目自报已完成，且无风险信号」。")
    assert got == want, f"「{text}」 -> {got!r}，应为 {want!r}"


@pytest.mark.parametrize("text,want,_r1", _TRAILING_NEGATION)
def test_a_negation_that_trails_the_keyword_still_counts(text, want, _r1):
    """BORN RED。反向扫描按构造看不见后置否定，而中文的可能补语就在动词后面。"""
    got = _norm_status(text)
    assert got != "done", f"「{text}」 被读成 done：否定在关键词后面，扫描没看见。"
    assert got == want, f"「{text}」 -> {got!r}，应为 {want!r}"


@pytest.mark.parametrize("text,want,_r1", _DOUBLE_NEGATIVE_IDIOM_BROKEN_BY_ROUND_ONE)
def test_the_bu_de_bu_idiom_is_two_negations_not_one(text, want, _r1):
    """🔴 BORN RED，而且是**第一轮自己造出来的**。这批在 3ef4224 上是对的。

    「不得不推迟上线」被数成单重否定 → "" → wire 掉键 → 前端 `?? 'on-track'` → 卡片显示
    「按计划推进」。三亚那份周报写「因批复未下，本月不得不推迟上线」，首屏告诉经理这个项目
    一切正常 —— 方向和第一轮要修的那条 blocker 完全一样。
    """
    got = _norm_status(text)
    assert got != "", (
        f"「{text}」 被压成留白：「不得不」是双重否定，数成一层就反号了。"
        f"留白到 wire 上是 status 键消失，前端 `card.status ?? 'on-track'` 会把它编成 on-track。")
    assert got == want, f"「{text}」 -> {got!r}，应为 {want!r}"


@pytest.mark.parametrize("text,want,_r1", _STILL_REVERSED_AT_ROUND_ONE)
def test_negated_on_track_the_round_one_link_set_could_not_reach(text, want, _r1):
    """BORN RED。第一轮收了「太」「够」，没收「算」「甚」「很」「大」，同族这几条仍然反向。"""
    got = _norm_status(text)
    assert got != "on-track", (
        f"「{text}」 被读成 on-track：这是把否定式读成了正面自述。"
        f"on-track 会经 `_m_clear` 变成「可推进 / 项目自报正常」。")
    assert got == want, f"「{text}」 -> {got!r}，应为 {want!r}"


@pytest.mark.parametrize("text,want,_r1", _OFF_PLAN_FLATTENED_TO_BLANK)
def test_a_stated_setback_is_read_not_flattened_to_blank(text, want, _r1):
    """BORN RED。「我没读到」和「客户说没有」是两件事，压成留白把前者变成了后者。

    第一轮把这批从「反向」救到了「留白」，净方向是改善。但留白在产品表面不成立：
    `registry.project_cards()` 的 `if pr.status:` 让键整个消失，前端 `?? 'on-track'` 把它编回
    on-track —— 经理看到的和修复前一模一样。而决策卡那句「没读到状态、阻塞、进度、到期日中的
    任何一项」，是对一份第三行就写着「进展不顺利」的文档说的。

    「进展不顺利」不是缺失，是陈述。照读，落 at-risk（`多看一眼` 那一档），这是文档自己说的。
    """
    got = _norm_status(text)
    assert got != "", (
        f"「{text}」 被压成留白：文档写了负面陈述，产品却当作什么都没读到。")
    assert got == want, f"「{text}」 -> {got!r}，应为 {want!r}"


# =============================================================================================
# 误报侧 —— 0 误报是量出来的，不是假设的
# =============================================================================================

@pytest.mark.parametrize("text,want", _UNMOVED)
def test_the_false_positive_side_reads_what_it_should(text, want):
    """BORN GREEN，控制组。**这张表才是上面五张表的意义所在。**

    否定扫描只要调得够狠，五条梯子集体变哑，上面每一条 BORN RED 都会变绿，看起来像修好了。
    这里逐条钉死正面自报、真风险、真阻塞，以及第二轮**新加的每一个链接字**最容易误伤的那些词。
    """
    got = _norm_status(text)
    assert got == want, (
        f"「{text}」 -> {got!r}，应为 {want!r}。否定扫描做过头了：它把正常的读数也一起吃掉了。")


def test_the_false_positive_side_did_not_move_at_all():
    """BORN GREEN，而它比上一条强：不是断言控制组等于某个写死的期望值，而是断言它在**第一轮和
    第二轮上读出同一个东西**，两遍都在进程里跑真 `_norm_status`。

    写死期望值只能证明「和我以为的一样」；跑两遍能证明「这次改动一个字都没碰到它们」。
    上一波「别墅」栽的就是误报侧靠假设，没有量。
    """
    after = {t: _norm_status(t) for t, _ in _UNMOVED}
    with at_round_one():
        before = {t: _norm_status(t) for t, _ in _UNMOVED}

    moved = [f"「{t}」第一轮 {before[t]!r} → 第二轮 {after[t]!r}" for t, _ in _UNMOVED
             if before[t] != after[t]]
    assert not moved, (
        f"第二轮改动了 {len(moved)} 条本该纹丝不动的读数 —— 这是误报，不是修复：\n  "
        + "\n  ".join(moved))


def test_every_born_red_case_flips_under_the_round_one_ladder():
    """BORN GREEN，而它是上面五张 BORN RED 表的**担保**。

    把 extract 就地退回第一轮，逐条断言它给出实测的那个**错**答案。任何一条不再翻转，就说明它
    已经不是在测这个 bug 了 —— 要么是装饰，要么是别的东西顺手修掉的，两种情况都该从表里删掉，
    而不是留在那里看着像保护。
    """
    not_flipping, wrong_record = [], []
    with at_round_one():
        for text, want, r1 in _BORN_RED:
            got = _norm_status(text)
            if got != r1:
                wrong_record.append(f"「{text}」第一轮实测应为 {r1!r}，突变下得到 {got!r}")
            if got == want:
                not_flipping.append(f"「{text}」在第一轮的代码上就已经是 {want!r} 了")

    assert not wrong_record, (
        "语料表第三列（第一轮读数）和把实现退回去实际跑出来的结果对不上：\n  "
        + "\n  ".join(wrong_record)
        + "\n第三列是实测记录。对不上说明 `_SHIPPED_AT_ROUND_ONE` 抄错了，"
          "整个突变证明连同它担保的五张表都不再成立。")
    assert not not_flipping, (
        "这些「BORN RED」用例在第一轮的代码上就是绿的，它们没有在测这一轮的 bug：\n  "
        + "\n  ".join(not_flipping))

    # 还原真的还原了 —— 否则本 session 后面每个测试都在跑一个 mutant
    assert _norm_status("不得不推迟上线") == "at-risk", "突变没还原，extract 还是被 patch 的状态"


def test_bu_de_and_bu_de_bu_are_different_readings():
    """BORN GREEN。把「得」这个链接字的**两个方向**同时钉住，而不是只钉住它修好的那一边。

    加一个链接字总能让 BORN RED 变绿；难的是证明它没有把相邻的读数一起吃掉。
    「不得不延期」= 被迫延期 → 陈述了风险；「不得延期」= 规定不许延期 → 不是状态自述。
    """
    assert extract._zh_negation_depth("不得不延期", len("不得不")) == 2, "不得不 = 双重否定"
    assert extract._zh_negation_depth("不得延期", len("不得")) == 1, "不得 = 单重否定"
    assert _norm_status("不得不延期") == "at-risk"
    assert _norm_status("不得延期") == ""


def test_the_scan_is_still_boundary_exact_after_round_two():
    """BORN GREEN。第二轮往链接字表里加了九个字、往备选里加了两条构造 —— 每一条都是让否定
    **够得更远**的改动，所以「边界精确」这条契约本身必须重新钉一次。

    这是没有重蹈 B3（「别墅」把红线整段关掉）的唯一原因：后果会随词表变，机制不会。
    """
    # 新链接字仍然要求否定正好结束在关键词起点
    assert extract._zh_negation_depth("没办法完成", len("没办法")) == 1
    assert extract._zh_negation_depth("想办法完成", len("想办法")) == 0, "「想办法」没有否定词头"
    assert extract._zh_negation_depth("很难完成", len("很难")) == 1
    assert extract._zh_negation_depth("克服困难完成了交付", len("克服困难")) == 0, "「困难」不是否定"
    assert extract._zh_negation_depth("赶不上完成", len("赶不上")) == 1
    assert extract._zh_negation_depth("差不多完成了", len("差不多")) == 0, "「差不多」不是否定"
    # 隔着整个小句的否定仍然不算数 —— 滑动窗口会算，这里不算
    far = "没办法确认上游排期，本周该项目按计划推进"
    assert extract._zh_negation_depth(far, far.index("按计划")) == 0, (
        "一个隔着整个小句的否定影响到了后面的关键词 —— 扫描退化成滑动窗口了，这就是 B3。")


def test_risk_first_precedence_is_the_known_cost_of_the_off_plan_rung():
    """BORN GREEN，而它记录的是一笔**已知代价**，不是一个胜利。

    `_ZH_OFF_PLAN` 让「不顺利」参与到既有的 risk-first 优先级里（blocked > at-risk > done >
    on-track），于是「不顺利的阶段已经过去，现已完成」读作 at-risk 而不是 done。这是误报。

    钉在这里是因为它**不是新的一类**：既有的 `风险 / 延期 / 受阻` 早就这样了，下面两条对照
    在第一轮乃至 3ef4224 上就是同样的结果。偏向「让项目被多看一眼」是 `_norm_status` docstring
    里写明的取舍。把它写下来，是为了下一个人是在**改一条已知取舍**，而不是在发现一个惊喜。
    """
    assert _norm_status("风险已解除，已完成") == "at-risk", "既有行为：risk-first"
    assert _norm_status("受阻已排除，已完成") == "blocked", "既有行为：risk-first"
    # 新的一条，落在同一条既有取舍上
    assert _norm_status("不顺利的阶段已经过去，现已完成") == "at-risk"


# =============================================================================================
# 集成层 —— 从客户的文件一路走到经理眼前的那句话
# =============================================================================================

class _NullStore:
    def query(self, q, limit=8):
        return []


_WEEKLY = "\n".join([
    "# 三期外立面涂装",
    "负责人：林岚",
    "状态：因集团批复未下，本月不得不推迟上线",
    "进展摘要：脚手架已搭设完毕，涂料进场等批复。",
])


def _grade_the_weekly() -> dict:
    """三亚那份周报的形状，跑完整条链：文档 → 抽取 → 项目卡 → 决策定级。

    HERMETIC —— HeuristicExtractor 是确定性规则，无 key、无网络、无模型。
    """
    doc = ParsedDoc(name="三亚鹿山雅居_周报.md", text=_WEEKLY, doc_kind="project", ext="md")
    res = extract.HeuristicExtractor().extract(doc)
    assert res.projects, "周报没抽出项目，下面的断言就什么都证明不了"
    ctx = CompanyContext(context_id="c_fixc2", extraction=res, store=_NullStore(),
                         memory_dir=Path("."))
    cards = ctx.decision_cards(as_of=TODAY)
    assert len(cards) == 1
    return cards[0]


def _hit_titles(card: dict) -> str:
    """命中规则的标题连成一串，供"那句会摆到经理面前的话"类断言用。

    🔴 为什么绕这一道：ADR-0033 之后后端**不再发那句话**（`reason` 恒为空串，句子由前端 i18n
    按 rule_id 渲染），所以原来「断言 reason 里有/没有某几个字」的写法会变成对空串断言——恒真，
    一条永远绿的假门。改成从载荷里读**真正命中的规则**，再回后端规则表取它的中文标题：
    那正是前端 zh 文案的出处，也是 decision_grading_rules.md 里给客户看的那一行。
    🔴 rule_id 只作为**从载荷读出来的值**出现，绝不写成字面量——`test_no_rule_text_in_any_prompt`
    全仓禁止规则号出现在这三个文件之外。
    """
    return " / ".join(R.RULES_BY_ID[h["rule_id"]].title_zh for h in card["matched_rules"])


def test_a_forced_postponement_reaches_the_manager_as_at_risk():
    """BORN RED，整条链，**这才是「不得不」被定为 blocker 的原因**。

    单测只能说明 `_norm_status` 返回了什么。真正摆到经理面前的是卡片上的状态和决策卡那句理由，
    而第一轮之后它们是：

        项目卡   status 键**不存在** → 前端 `card.status ?? 'on-track'` → 显示「按计划推进」
        决策卡   reason = 没读到状态、阻塞、进度、到期日中的任何一项

    文档原话是「因集团批复未下，本月不得不推迟上线」。产品对客户说了两句他文件里没有的话：
    一句说项目正常，一句说他什么都没写。
    """
    card = _grade_the_weekly()
    assert "没读到状态" not in _hit_titles(card), (
        f"命中了那条说「没读到状态」的规则，而文档第三行就写着「不得不推迟上线」："
        f"{_hit_titles(card)!r}")
    evidence = [e for hit in card["matched_rules"] for e in hit["evidence"]]
    assert 'status="at-risk"' in evidence, (
        f"命中的规则里没有一条是 at-risk 状态引出来的：{card['matched_rules']}")
    assert card["grade"] == R.NEEDS_CONFIRMATION, f"应为 需确认，实际 {card['grade']!r}"


def test_the_project_card_actually_carries_a_status_on_the_wire():
    """BORN RED，而且它盯的是**第一轮报告漏掉的那一层**。

    第一轮的报告说「前端零改动，浏览器层没有可观察的新行为」—— 这是错的，行为变在 wire 上。
    `registry.project_cards()` 是 `if pr.status:`，status="" 时整个键不写出去；前端
    `teamData.ts` 的 `card.status ?? 'on-track'` 里 `??` 只吃 null/undefined，键缺失正好命中。
    所以「留白」在经理屏幕上不是留白，是 on-track。

    这条断言落在 **wire 上键存不存在**，不是落在 `_norm_status` 的返回值 —— 后者第一轮就验过，
    验到那里就停正是漏掉这一层的原因。
    """
    doc = ParsedDoc(name="三亚鹿山雅居_周报.md", text=_WEEKLY, doc_kind="project", ext="md")
    res = extract.HeuristicExtractor().extract(doc)
    ctx = CompanyContext(context_id="c_fixc3", extraction=res, store=_NullStore(),
                         memory_dir=Path("."))
    cards = ctx.project_cards()
    assert cards, "没有项目卡"
    assert "status" in cards[0], (
        "项目卡在 wire 上没有 status 键 —— 前端 `card.status ?? 'on-track'` 会把它编成 "
        "「按计划推进」，而文档写的是「不得不推迟上线」。")
    assert cards[0]["status"] == "at-risk", f"卡片状态 {cards[0]['status']!r}"


def test_the_same_weekly_was_silently_dropped_at_round_one():
    """BORN GREEN，上一组的突变担保 —— 也是这份 bug 报告的证据本身。

    把 extract 退回第一轮，同一份周报、同一条链再跑一遍，断言 status 键**真的消失了**、
    决策理由**真的**说了「没读到状态」。不是转述，是把当年真会显示给经理的那句话跑出来。
    """
    with at_round_one():
        doc = ParsedDoc(name="三亚鹿山雅居_周报.md", text=_WEEKLY, doc_kind="project", ext="md")
        res = extract.HeuristicExtractor().extract(doc)
        ctx = CompanyContext(context_id="c_fixc4", extraction=res, store=_NullStore(),
                             memory_dir=Path("."))
        assert "status" not in ctx.project_cards()[0], (
            "第一轮的项目卡上 status 键是存在的 —— 那么上面那条 wire 层的测试并没有在守它"
            "自称守的东西，重新量。")
        card = ctx.decision_cards(as_of=TODAY)[0]
        assert "没读到状态" in _hit_titles(card), (
            f"第一轮命中的规则里没有「没读到状态」那条：{_hit_titles(card)!r} —— "
            f"bug 报告的原文对不上，重新量。")
