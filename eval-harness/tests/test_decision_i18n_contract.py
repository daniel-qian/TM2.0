# -*- coding: utf-8 -*-
"""ADR-0033 · 决策文案搬到前端之后，谁来看着它。

背景（读这段再改这个文件）：在 2026-08-03 之前，判读卡上那些句子——三个档位词、每条规则的
标题与依据、"按规则判为…"那一整句——是**后端拼好了随载荷发下来的**，而且写死中文。于是
英文用户拿到的是中英夹杂的核心判读面板。ADR-0033 把它们搬到了 `src/shared/i18n/{en,zh}.ts`，
后端只发机器键。

搬家会顺手弄丢三样东西，这个文件就是把它们接住：

  ① **完整性** —— 后端加一条规则、前端忘了加文案，屏幕上就会印一个裸 `R-XYZ` 给客户看。
     没有这条测试，那种缺失只有真人打开那一屏展开规则才看得见。
  ② **占位符对账** —— 规则标题里的 `{n}`/`{days}`/`{pct}` 由后端 `RULE_PARAMS` 填。
     模板写了个后端不发的占位符，用户读到的就是字面的 `{days}`；反过来后端发了个没人用的
     参数，说明有人改阈值时漏改了句子。两个方向都得对。
  ③ **红线** —— 原来后端那套禁词/红线校验（`test_decision_grading.py` 里的两条）跑的是
     后端那句话。那句话没了之后，如果只把断言留在原地，它就变成对空串断言——恒真。
     真文案在这两个 .ts 里，尺子必须跟着搬过来。

🔴 为什么 Python 测试去读 TypeScript：因为**文案在那儿**。本仓已有先例
（`test_rules_doc_in_sync` 读 .md、`test_no_rule_text_in_any_prompt` 扫全仓）。
判据"够不着"就换个够得着的量法，而不是把判据删掉——够不着的判据是恒绿的，那种绿最骗人。

🔴 解析器故意脆：解析不出预期条数就**直接失败**，绝不返回一个空字典让下面的断言"全绿"。
（`for x in {}: assert ...` 是本仓栽过的经典空真。）
"""
from __future__ import annotations

import re
from pathlib import Path

import pytest

from avery import decision_rules as R

REPO_ROOT = Path(__file__).resolve().parents[2]
EN_PATH = REPO_ROOT / "src" / "shared" / "i18n" / "en.ts"
ZH_PATH = REPO_ROOT / "src" / "shared" / "i18n" / "zh.ts"

# 每条规则在两个 .ts 里都是**单行**：
#   '<RULE-ID>': { title: 'Due within {days} days', basis: 'Due date' },
#   "<RULE-ID>": { "title": "{days} 天内到期", "basis": "到期日" },
# （这里刻意不写真的规则号：`test_no_rule_text_in_any_prompt` 全仓禁止规则号出现在
#   decision_rules.py / decision_grading.py / decision_grading_rules.md 之外。）
_RULE_LINE = re.compile(
    r"""["']?(?P<id>R-[A-Z-]+)["']?\s*:\s*\{\s*"""
    r"""["']?title["']?\s*:\s*(?P<q1>['"])(?P<title>.*?)(?P=q1)\s*,\s*"""
    r"""["']?basis["']?\s*:\s*(?P<q2>['"])(?P<basis>.*?)(?P=q2)\s*,?\s*\}""",
)
_GRADE_LINE = re.compile(
    r"""["']?(?P<key>high_risk|needs_confirmation|can_proceed)["']?\s*:\s*"""
    r"""(?P<q>['"])(?P<label>.*?)(?P=q)""",
)


def _read(path: Path) -> str:
    assert path.exists(), (
        f"{path} 不在了。文案搬家搬到别处去了？把本文件的路径跟着改，别把测试删掉——"
        f"删掉之后没有任何东西会告诉你规则文案缺了一条。")
    return path.read_text(encoding="utf-8")


def _rules(path: Path) -> dict[str, dict[str, str]]:
    hits = {m.group("id"): {"title": m.group("title"), "basis": m.group("basis")}
            for m in _RULE_LINE.finditer(_read(path))}
    # 🔴 解析器自证：条数对不上就当场失败。宁可红在这里（"解析器瞎了"），也不要下面几十条
    # 断言对着一个空字典全绿——那是本仓反复栽的"判据够不着 = 恒绿"。
    assert len(hits) == len(R.RULE_IDS), (
        f"{path.name} 里解析出 {len(hits)} 条规则文案，规则表有 {len(R.RULE_IDS)} 条。\n"
        f"要么是真缺了文案，要么是那张表的写法变了（比如换行了）而这里的正则没跟上。\n"
        f"解析到的：{sorted(hits)}")
    return hits


def _grades(path: Path) -> dict[str, str]:
    text = _read(path)
    # 🔴 认的是**键定义**（`decisionGrades: {`），不是"文件里出现过这个词"——zh.ts 的
    # 手写注释里就提到了它一次，`find()` 会先撞上注释、再截一段没有档位词的窗口，
    # 于是这条门会以"少了三个词"的形态假红。
    m = re.search(r"[\"']?decisionGrades[\"']?\s*:\s*\{", text)
    assert m, f"{path.name} 里找不到 decisionGrades 的键定义 —— 三个档位词搬走了？"
    block = text[m.end():m.end() + 400]
    hits = {m.group("key"): m.group("label") for m in _GRADE_LINE.finditer(block)}
    assert len(hits) == len(R.GRADES), (
        f"{path.name} 的 decisionGrades 只解析出 {sorted(hits)}，应有 {list(R.GRADES)}")
    return hits


ALL_LOCALES = [("en", EN_PATH), ("zh", ZH_PATH)]


# --- ① 完整性 ---------------------------------------------------------------------------------

@pytest.mark.parametrize("locale,path", ALL_LOCALES)
def test_frontend_i18n_covers_every_rule(locale, path):
    """规则表加一条、前端忘了加文案 → 屏幕上印裸 `R-XYZ` 给客户看。这条门就是防它。"""
    table = _rules(path)
    missing = [rid for rid in R.RULE_IDS if rid not in table]
    assert not missing, f"{locale} 缺这些规则的文案：{missing}"
    extra = [rid for rid in table if rid not in R.RULE_IDS]
    assert not extra, (
        f"{locale} 有规则表里已经没有的文案：{extra} —— 规则删了文案没删，是"
        f"孤儿键（i18n-orphans 扫不到嵌套表，只有这条门看得见）")
    for rid, entry in table.items():
        assert entry["title"].strip(), f"{locale}/{rid} 的 title 是空的"
        assert entry["basis"].strip(), f"{locale}/{rid} 的 basis 是空的"


@pytest.mark.parametrize("locale,path", ALL_LOCALES)
def test_frontend_i18n_covers_every_grade(locale, path):
    table = _grades(path)
    for grade in R.GRADES:
        assert table.get(grade, "").strip(), f"{locale} 缺档位词 {grade}"


def test_zh_grade_words_match_the_customer_facing_rulebook():
    """zh 的三个档位词必须和 `decision_grading_rules.md` 里那三个字一致。

    那份 .md 是客户问"凭什么说这条高风险"时当场给他看的口径说明书（LABEL_ZH 是它的真源）。
    说明书写「高风险」而屏幕上写「高危」，是同一个产品对同一件事用两个词——ADR-0033
    搬家搬的是**载体**，不是允许中文措辞自己漂。
    英文侧没有对应的说明书，所以不做这条对账（en 文案由本 session 自己定稿）。
    """
    table = _grades(ZH_PATH)
    for grade in R.GRADES:
        assert table[grade] == R.LABEL_ZH[grade], (
            f"{grade}：i18n 写「{table[grade]}」，说明书写「{R.LABEL_ZH[grade]}」")


# --- ② 占位符对账 -----------------------------------------------------------------------------

@pytest.mark.parametrize("locale,path", ALL_LOCALES)
def test_rule_copy_placeholders_match_backend_params(locale, path):
    """`{n}`/`{days}`/`{pct}` 两个方向都要对上。

    模板多写一个占位符 → 用户读到字面的 `{days}`；后端多发一个没人用的参数 → 有人调阈值时
    漏改了句子。阈值本身仍归后端配置（`decision_rules.py`），前端只出句子——
    🔴 谁要是图省事把数字抄进句子里，这条门是唯一会拦下他的东西。
    """
    table = _rules(path)
    for rid, entry in table.items():
        used = set(re.findall(r"\{(\w+)\}", entry["title"] + entry["basis"]))
        available = _available_params(rid)
        assert used <= available, (
            f"{locale}/{rid} 的文案用了后端不发的占位符 {sorted(used - available)}；"
            f"后端只发 {sorted(available)}")
        assert available <= used, (
            f"{locale}/{rid}：后端发了 {sorted(available - used)} 但文案没用——"
            f"要么是句子里把阈值写死了（下一次调阈值就撒谎），要么是这个参数该删")


def _available_params(rule_id: str) -> set[str]:
    """这条规则**发得出来**的占位符名，两个来源合起来算（gap2 T9 · #58）：

      · `RULE_PARAMS` —— 静态阈值（「7 天内到期」的 7），归后端配置；
      · `RULE_DYNAMIC_PARAMS` —— 每次命中都不同的数（「还差 3 人没交」的 3），值由匹配器当场算，
        随 `RuleHit.params` 逐条发。

    🔴 为什么要开这第二张表、而不是把动态值塞进 `RULE_PARAMS` 凑数：那张表的红线注释写着
    "只放阈值"，塞一个假的静态值进去等于把碑推倒还假装它还立着。两张表在**这道门**面前是一张
    ——占位符对账两个方向都照旧严格，只是"后端发得出什么"的定义诚实地变宽了一格。
    `test_dynamic_params_are_declared` 守住第二张表不是随便写的：登记了名字就必须真有一条
    匹配器发它，反过来也一样。"""
    return set(R.RULE_PARAMS.get(rule_id, {})) | set(R.RULE_DYNAMIC_PARAMS.get(rule_id, ()))


def test_dynamic_params_are_declared():
    """`RULE_DYNAMIC_PARAMS` 是给上面那道门看的**声明**，声明就有对不上的可能，所以要对账：

      ① 登记的规则号必须真在规则表里（改了规则号、这张表没跟着改 → 声明成了孤儿，
         而孤儿的后果是那条规则的 `{n}` 突然变成"后端不发的占位符"，i18n 门以一句
         看不懂的话红掉）；
      ② 登记的名字不许与静态表撞（同一个名字两个来源，合并时谁赢是隐式的）；
      ③ 反向：真有匹配器在发的动态参数，必须登记进来——否则 i18n 文案里那个 `{n}`
         会被上面那道门判成"用了后端不发的占位符"。这一条用**真跑一次**来验，不靠人记得。
    """
    for rid, names in R.RULE_DYNAMIC_PARAMS.items():
        assert rid in R.RULES_BY_ID, f"{rid} 登记在 RULE_DYNAMIC_PARAMS 里，但规则表里没有它"
        assert names, f"{rid} 登记了一个空的动态参数表——那就该整条删掉"
        overlap = set(names) & set(R.RULE_PARAMS.get(rid, {}))
        assert not overlap, f"{rid} 的 {sorted(overlap)} 同时登记成了静态阈值和动态参数"

    # ③ 真跑一次那条唯一带动态参数的规则，看它实际发出去的 params 键与声明逐字相等。
    #    🔴 不 mock、不构造 RuleHit——那样量的是我自己写的假数据，不是产品那条路。
    from datetime import datetime, timedelta, timezone

    from avery.decision_grading import grade_form_period
    from avery.ingest.form_autofill import FormPeriodStatus

    now = datetime(2026, 8, 7, 12, 0, tzinfo=timezone.utc)
    soon = (now + timedelta(hours=5)).isoformat()
    decided = grade_form_period(
        FormPeriodStatus(template_id="tpl_weekly", template_title="周报", period="2026-W32",
                         missing=(("周雅", soon), ("陈立", soon))),
        now=now)
    assert decided is not None, "构造的 fixture 没让那条规则命中——这条门在空跑"
    hit = decided.matched_rules[0].to_dict()
    declared = _available_params(hit["rule_id"])
    assert set(hit["params"]) == declared, (
        f"{hit['rule_id']} 实际发 {sorted(hit['params'])}，两张表加起来声明的是 {sorted(declared)}")


def test_placeholder_sets_agree_across_locales():
    """两种语言的同一条规则必须吃同一组占位符——不然改阈值时只有一种语言跟着变。"""
    en, zh = _rules(EN_PATH), _rules(ZH_PATH)
    for rid in R.RULE_IDS:
        pen = set(re.findall(r"\{(\w+)\}", en[rid]["title"]))
        pzh = set(re.findall(r"\{(\w+)\}", zh[rid]["title"]))
        assert pen == pzh, f"{rid}: en 用 {sorted(pen)}，zh 用 {sorted(pzh)}"


def test_composed_reason_template_has_both_slots():
    """"按规则判为{grade}：{rules}。" 这句是后端搬过来的整句，两个槽缺一它就成了半句话。"""
    for locale, path in ALL_LOCALES:
        text = _read(path)
        m = re.search(r"homeDecisionReasonByRule[\"']?\s*:\s*(['\"])(.*?)\1", text)
        assert m, f"{locale} 找不到 homeDecisionReasonByRule"
        template = m.group(2)
        assert "{grade}" in template and "{rules}" in template, (
            f"{locale} 的 homeDecisionReasonByRule 缺槽：{template!r}")


# --- ③ 红线（原来长在后端那句话上，跟着文案一起搬过来）-------------------------------------

def test_frontend_rule_copy_never_asserts_absence():
    """🔴 用户面文字只许陈述"我读到/没读到什么"，不许替客户断言"你的文档里没写什么"。

    抽取层读不出来的原因很多（中文标签、非常规排版、还没支持的写法）。把这些一律说成
    "文档没写"，就是当着客户的面否认他自己写过的字——而他手上就有原件，一翻就露馅。
    这张禁词表原样搬自 `test_decision_grading.py`，只是尺子对准的东西从后端那句话换成了
    前端这几十条文案。
    """
    zh_forbidden = ("文档没写", "文档未写", "文档里没有", "没有提到")
    for rid, entry in _rules(ZH_PATH).items():
        for bad in zh_forbidden:
            assert bad not in entry["title"], f"zh/{rid} 替客户断言了文档内容：{entry['title']}"
    # 英文侧同一条线。"not in the document" / "the file does not" 是同一句话的英文写法。
    en_forbidden = ("not in the document", "not in the file", "the document does not",
                    "the file does not", "never wrote", "you did not write")
    for rid, entry in _rules(EN_PATH).items():
        low = entry["title"].lower()
        for bad in en_forbidden:
            assert bad not in low, f"en/{rid} 替客户断言了文档内容：{entry['title']}"


def test_frontend_rule_copy_passes_the_red_line():
    """定级文案要能过既有红线校验器——定级不许变成给人贴标签的后门（ADR-0018）。

    只对 zh 跑：`avery/redline.py` 的中文规则由 `_has_cjk()` 分支把关，英文规则常驻，
    对一段纯英文文案跑的是英文那半张表——两边都跑才叫两边都验过。
    """
    from avery import redline
    for locale, path in ALL_LOCALES:
        for rid, entry in _rules(path).items():
            res = redline.validate(entry["title"], cited_snippets=[])
            assert res.passed, f"{locale}/{rid} 触了红线：{entry['title']} / {res}"
    for locale, path in ALL_LOCALES:
        for grade, label in _grades(path).items():
            res = redline.validate(label, cited_snippets=[])
            assert res.passed, f"{locale}/{grade} 档位词触了红线：{label} / {res}"
