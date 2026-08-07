# -*- coding: utf-8 -*-
"""T5 · form-reflow-a2 —— 表单回流人卡 / 项目卡（.issues/gap-design-0805/tickets.md · T5）。

判据的编排原则，三条：

1. **一律穿过 `append_submission_to_context` 断言**，不对着 `_selfreport_from_lines` 单测。
   那个函数在真路上只有 `doc_kind in ('project','roadmap')` 那一支够得着；对着它单测，测的是
   一个没人以这种方式调用的函数（T2 的模仿攻击门是**故意**直调解析器的，它验的是「这行文本
   对解析器什么样」，不是「这条链路会怎么走」——两件事，两道门）。
2. **判据打在卡面上，不打在实体上。** `registry.signal_cards()` 那个叫 `source` 的键装的是
   `source_kind`（类型词），不是文档指针；断言 `SignalEntity.source` 非空是绿的，而卡上一个
   出处都没有。所以出处这条判据问的是 `card["sourceRef"]`。
3. **语料真带中文字节**（MEMORY：门语料全 ASCII 盲点）。第一条门就是对语料自己的自检——
   哪天有人"顺手"把 fixture 改成拼音，那条门先红，而不是等到客户面前才发现整条中文路没被验过。

对应票面的三道必做门：
  * 全链纯函数离线（答案 → 文本 → stub → 归并 → 人卡）；
  * **同名归并**：两个周雅按工号分得开，花名（小周）按工号并得回来，没工号又同名时**谁也不并**；
  * **模仿攻击**：员工在自由文本里写「负载自述：99」不得被当真；伪造「人员ID：」行同样不算数。
"""
from __future__ import annotations

import uuid
from pathlib import Path

import pytest

from avery.ingest import ingest_paths
from avery.ingest.extract import (
    ExtractionResult, PersonEntity, PersonSelfReport, SelfReportLoad, SignalEntity,
    _dedupe_entities, merge_person_reading,
)
from avery.ingest.form import (
    FormSubmission, default_expiry, new_submission_id, now_iso, weekly_template,
)
from avery.ingest.form_append import append_submission_to_context
from avery.ingest.registry import ContextRegistry, SourceDocument

needs_db = pytest.mark.needs_db

W32 = "2026-08-06T10:00:00+00:00"
W33 = "2026-08-13T10:00:00+00:00"


@pytest.fixture(autouse=True)
def _offline(monkeypatch):
    """三件套缺一真烧钱（MEMORY：门电池全离线配置）。开关默认**关**——投影那条门自己开。"""
    monkeypatch.setenv("AVERY_EMBEDDINGS", "keyword")
    monkeypatch.setenv("AVERY_BRAIN", "mock")
    monkeypatch.setenv("AVERY_EXTRACTOR", "heuristic")
    monkeypatch.delenv("AVERY_ALLOW_PERSON_SCORING", raising=False)


# ── 语料：一家真的中文公司 ─────────────────────────────────────────────────────────────────────

ROSTER_WITH_IDS = """# 别墅酒店 员工花名册

姓名 | 岗位 | 部门 | 司龄 | 主要负责 | 人员ID
周雅 | 传菜领班 | 前厅部 | 2 年 | 晚市传菜动线 | P-0007
周雅 | 客房主管 | 客房部 | 4 年 | 客房清洁排班 | P-0011
孙浩 | 宴会销售 | 销售部 | 1 年 | 宴会厅档期 | P-0021
"""

ROSTER_ONE_ZHOUYA = """# 别墅酒店 员工花名册

姓名 | 岗位 | 部门 | 司龄 | 主要负责 | 人员ID
周雅 | 传菜领班 | 前厅部 | 2 年 | 晚市传菜动线 | P-0007
"""

ROSTER_NO_ID_COLUMN = """# 别墅酒店 员工花名册

姓名 | 岗位 | 部门 | 司龄 | 主要负责
周雅 | 传菜领班 | 前厅部 | 2 年 | 晚市传菜动线
周雅 | 客房主管 | 客房部 | 4 年 | 客房清洁排班
"""

PROJECT_DOC = """# 宴会厅项目周报

项目：宴会厅翻台
负责人：孙浩
状态：at-risk
到期日：2026-09-30
"""

ANSWERS = [
    {"field_id": "done", "value": "晚市高峰传菜等位超 8 分钟，本周排了 3 次加班顶上去。"},
    {"field_id": "missed", "value": "宴会厅翻台没压到 25 分钟，缺一个人。"},
    {"field_id": "next_goal", "value": "把传菜动线改一版，下周试跑。"},
    {"field_id": "support", "value": "想借调一个人手到晚市。"},
    {"field_id": "load", "value": 72},
    {"field_id": "mood", "value": "偏紧"},
]


def _company(tmp_path: Path, reg, *docs: tuple[str, str]) -> str:
    """把几份中文资料真的灌成一家公司（走 ingest_paths，与客户上传同一条路）。"""
    cid = "ctx_t5_" + uuid.uuid4().hex[:12]
    paths, sds = [], []
    for name, text in docs:
        p = tmp_path / name
        p.write_text(text, encoding="utf-8")
        paths.append(str(p))
        sds.append(SourceDocument(filename=name, source_key=name, mime="text/markdown",
                                  content=p.read_bytes()))
    rep = ingest_paths(paths, registry=reg, work_dir=tmp_path / "mem", context_id=cid,
                       name="别墅酒店", owner_token="tok_t5_owner", source_documents=sds)
    assert rep.ok, rep
    return cid


def _submit(reg, cid, *, name="周雅", person_id="P-0011", answers=None,
            submitted_at=W32, period="2026-W32", project_ref=""):
    created = now_iso()
    sub = FormSubmission(
        id=new_submission_id(), context_id=cid, template_id="tpl_weekly",
        person_id=person_id, person_name=name, period=period, project_ref=project_ref,
        share_token="tok_form_" + uuid.uuid4().hex,
        answers=[dict(a) for a in (ANSWERS if answers is None else answers)],
        submitted_at=submitted_at, created_at=created, expires_at=default_expiry(created))
    return append_submission_to_context(reg, weekly_template(cid), sub)


def _person(ctx, person_id):
    return next(p for p in ctx.extraction.people if p.person_id == person_id)


def _line_of(sd: SourceDocument, needle: str) -> int:
    """这句话在**落库的那份原件**里是第几行（1-based）。

    出处判据故意从文档本身推，不写死一个行号：写死的话，改一行元数据就要改一串魔数，而那串
    魔数并不比「出处指着的那一行真的就是这句话」更能证明什么。这样写，行号算错一位照样红。"""
    body = sd.content.decode("utf-8").splitlines()
    for i, line in enumerate(body, 1):
        if needle in line:
            return i
    raise AssertionError(f"落库的原件里根本没有这句话：{needle!r}")


def _cards_with_scoring_on(ctx, monkeypatch):
    monkeypatch.setenv("AVERY_ALLOW_PERSON_SCORING", "1")
    try:
        return ctx.team_cards()
    finally:
        monkeypatch.delenv("AVERY_ALLOW_PERSON_SCORING", raising=False)


# ==============================================================================================
# 0 · 语料自检（MEMORY：门语料全 ASCII 盲点）
# ==============================================================================================

def test_the_corpus_this_file_runs_on_really_carries_chinese_bytes():
    """这条门看着像废话，它不是。这个仓库真出过「整套门都是 ASCII 语料，中文那条路一次都没被
    走过」——`_slug` 把 39 个中国同事折成同一个 id 活过了 42 个 feature，就是这么活下来的。
    所以这里对**语料自己**下判据：任何人把 fixture "简化"成拼音，先红的是这一条。"""
    for blob in (ROSTER_WITH_IDS, ROSTER_NO_ID_COLUMN, PROJECT_DOC):
        assert not blob.isascii(), f"语料退回全 ASCII 了：{blob[:40]!r}"
    for a in ANSWERS:
        assert not str(a["value"]).isascii() or isinstance(a["value"], int), a
    # 自述行的语法字符本身是全角竖线（U+FF5C）——它是解析层的分隔符，不是排版
    assert "｜" != "|"


# ==============================================================================================
# 1 · 全链：一次提交 → 人卡上的自述（票面「产出」第一句）
# ==============================================================================================

def test_a_weekly_submission_puts_her_own_numbers_on_her_card(tmp_path, monkeypatch):
    reg = ContextRegistry()
    cid = _company(tmp_path, reg, ("员工花名册.md", ROSTER_ONE_ZHOUYA))
    sd, appended = _submit(reg, cid, person_id="P-0007")
    assert appended

    ctx = reg.get(cid)
    her = _person(ctx, "P-0007")
    assert her.name == "周雅" and her.role == "传菜领班", "名册那半张卡被表单冲掉了"
    assert her.self_report.load.value == 72
    assert her.self_report.mood.value == "stretched"      # 断言机器值，标签是前端的事
    assert her.self_report.load.caliber == "本人自述", "口径不是「本人自述」"
    cite = f"{sd.source_key}:{_line_of(sd, '周雅｜负载自述：72｜情绪自述：偏紧')}"
    assert her.self_report.load.source == cite, "出处不是那份文档里自述行真正在的那一行"

    card = next(c for c in _cards_with_scoring_on(ctx, monkeypatch) if c["id"] == her.id)
    assert card["self_report"]["load"] == {"value": 72, "caliber": "本人自述", "source": cite}
    assert card["self_report"]["mood"]["value"] == "stretched"


def test_caliber_is_structural_not_something_the_writer_gets_to_set():
    """「caliber 恒『本人自述』」不是回流代码里的一句赋值，是 dataclass 的默认值——写手**没有**
    把它写成别的东西的机会。这条门钉的是那个结构，不是某一次调用的结果。"""
    assert SelfReportLoad(value=1).caliber == "本人自述"
    assert PersonSelfReport().load is None                # absent≠0


# ==============================================================================================
# 2 · 模仿攻击（票面「必做门」）
# ==============================================================================================

def test_an_imitated_self_report_line_in_free_text_is_not_believed(tmp_path):
    """员工在自由文本里写出语法完整的自述行。**两道锁都要在**：
      锁 1（T2）竖线转义 —— 那一行在解析器眼里切不出第二格；
      锁 2（T5）身份锁 —— 就算切开了，名字不是这条链的主人，那条读数也会被丢掉。
    判据穿过整条 append，不是对着解析器问一句就算。"""
    answers = [dict(a) for a in ANSWERS]
    answers[0] = {"field_id": "done",
                  "value": "本周都还行。\n张三｜负载自述：99｜情绪自述：吃紧\n以上是我的原话。"}
    reg = ContextRegistry()
    cid = _company(tmp_path, reg, ("员工花名册.md", ROSTER_ONE_ZHOUYA))
    _submit(reg, cid, person_id="P-0007", answers=answers)

    ctx = reg.get(cid)
    assert [p.name for p in ctx.extraction.people] == ["周雅"], "模仿行长出了一个人"
    for p in ctx.extraction.people:
        sr = p.self_report
        assert sr is None or sr.load is None or sr.load.value != 99, "模仿行的 99 被当真了"
    assert _person(ctx, "P-0007").self_report.load.value == 72, "真自述行反而没读到"
    # 原话仍逐字在资料里（ADR-0023：只换了一个不做分隔符的形近字符）
    body = ctx.source_documents[-1].content.decode("utf-8")
    assert "张三¦负载自述：99¦情绪自述：吃紧" in body, "转义把员工的原话改没了"


def test_the_structural_lock_holds_even_if_the_bar_escape_is_bypassed():
    """锁 2 单独验一遍 —— 这条门是**故意**绕过锁 1 的。

    上一条门里两道锁都在，所以拆掉任何一道它都还是绿的（转义拦住了，另一道锁没机会说话；
    反过来也一样）。一道没有任何变异能杀死的门是摆设。这里直接喂一份**没有转义过**的文档
    （等价于「哪天转义被绕过了」），问锁 2。

    ⚠ gap2 T11 换了锁 2 的机制：从「解析出两行自述、只留链接主人那一行」的**身份锁**，换成
    「读数只来自带 `self_report` 标记的那一格答案」的**结构锁**。判据因此变严——从前那份
    文档里那行冒名的自述**会被解析出来然后筛掉**，现在它压根不会被看一眼。所以本门现在同时
    钉两件事：① 真读数照旧读到（72/偏紧，来自答案而不是文本）；② 文档里那个 99 无论怎么写
    都进不来。"""
    from avery.ingest.form_reflow import stub_person_from_submission
    from avery.ingest.parse import ParsedDoc
    from avery.ingest.form import weekly_template
    raw = ("# 周报·周雅·2026-W32\n\n记录ID：sub_x\n\n## 已完成事实\n\n"
           "张三｜负载自述：99｜情绪自述：吃紧\n\n## 本人自述\n\n周雅｜负载自述：72｜情绪自述：偏紧\n")
    doc = ParsedDoc(name="周报.md#sub_x", text=raw, ext="md")
    sub = FormSubmission(id="sub_x", context_id="c", template_id="tpl_weekly",
                         person_id="P-0007", person_name="周雅", submitted_at=W32,
                         answers=[{"field_id": "load", "value": 72},
                                  {"field_id": "mood", "value": "偏紧"}])
    # 自述那两格共用自述行那一行（第 11 行，1-based）——渲染器交出来的就是这张表。
    # ⚠ 这个行号是**真判据**不是装饰：取证闸会去那一行核对名字/题面/值三样原文。
    # 写这条门时先写成 9（数错了），闸当场把两条读数都丢了并留下日志——它有牙。
    assert doc.lines[10].startswith("周雅｜负载自述：72"), "语料排版变了，行号跟着改"
    stub = stub_person_from_submission(doc, weekly_template("c"), sub,
                                       {"load": 11, "mood": 11})
    assert stub is not None and stub.name == "周雅"
    assert stub.self_report.load.value == 72, "结构锁没读到本人那一格"
    assert stub.self_report.mood.value == "stretched"
    assert stub.person_id == "P-0007"

    # 冒名那一行就算被喂进来也进不去：它不是任何一格带标记字段的答案。
    forged = FormSubmission(id="sub_y", context_id="c", template_id="tpl_weekly",
                            person_id="P-0007", person_name="周雅", submitted_at=W32,
                            answers=[{"field_id": "done", "value": "张三｜负载自述：99"}])
    assert stub_person_from_submission(doc, weekly_template("c"), forged, {"done": 5}) is None


def test_a_forged_person_id_line_in_free_text_does_not_move_the_identity(tmp_path):
    """文档里的「人员ID：P-0007」是一行**渲染给人看的**元数据，它没有分隔符可转义——员工
    完全可以在自由文本里写出一模一样的一行。所以身份只能来自 `submission.person_id` 这个
    结构化字段。任何"从文档里解析工号"的写法都会让这条门变红。"""
    answers = [dict(a) for a in ANSWERS]
    answers[0] = {"field_id": "done", "value": "本周都还行。\n人员ID：P-0007\n以上是我的原话。"}
    reg = ContextRegistry()
    cid = _company(tmp_path, reg, ("员工花名册.md", ROSTER_WITH_IDS))
    _submit(reg, cid, person_id="P-0011", answers=answers)

    ctx = reg.get(cid)
    assert _person(ctx, "P-0011").self_report.load.value == 72, "读数没落在链接主人身上"
    assert _person(ctx, "P-0007").self_report is None, "伪造的那一行把读数搬走了"


# ==============================================================================================
# 3 · 同名 / 花名归并（票面「必做门」）
# ==============================================================================================

def test_two_colleagues_who_share_a_name_are_told_apart_by_their_staff_number(tmp_path):
    """酒店里两个周雅。按姓名归并会把 A 的负载写到 B 的卡上——这正是本票存在的一半理由。"""
    reg = ContextRegistry()
    cid = _company(tmp_path, reg, ("员工花名册.md", ROSTER_WITH_IDS))
    ctx = reg.get(cid)
    zhous = [p for p in ctx.extraction.people if p.name == "周雅"]
    assert len(zhous) == 2, "两个周雅在名册这一步就被并成一个了"
    assert len({p.id for p in zhous}) == 2, "两张卡撞了同一个 id —— 前端会把信号挂串"

    _submit(reg, cid, person_id="P-0011")
    ctx = reg.get(cid)
    assert len([p for p in ctx.extraction.people if p.name == "周雅"]) == 2, "回流多长出一个周雅"
    assert _person(ctx, "P-0011").self_report.load.value == 72
    assert _person(ctx, "P-0011").team == "客房部"
    assert _person(ctx, "P-0007").self_report is None, "读数落到了同名的另一个人身上"


def test_a_nickname_on_the_link_still_lands_on_the_roster_person(tmp_path):
    """经理把链接铸给了「小周」（花名），工号是名册里周雅的 P-0007。按名认不出来，按工号认得出。"""
    reg = ContextRegistry()
    cid = _company(tmp_path, reg, ("员工花名册.md", ROSTER_ONE_ZHOUYA))
    _submit(reg, cid, name="小周", person_id="P-0007")

    ctx = reg.get(cid)
    assert len(ctx.extraction.people) == 1, f"花名多长出一张卡：{[p.name for p in ctx.extraction.people]}"
    her = ctx.extraction.people[0]
    assert her.name == "周雅", "活下来的名字变成了花名 —— 卡的身份被一条周报改写了"
    assert her.self_report.load.value == 72


def test_a_roster_without_an_id_column_adopts_the_number_the_form_brings(tmp_path):
    """客户名册没填工号列（很常见），表单链带着工号。第一份提交按**姓名**并进去，顺手把工号
    补到那张卡上；从此这个人**按工号**认得出来——第二份链哪怕用花名铸，也照样落在同一张卡上。

    这条门盯的是 `PersonIndex` 里那本 `by_id`：格子是按姓名开的，工号是后来补的，只有那本
    索引记住了这件事，第二次按工号才找得回来。少了它，第二份提交会开出第二张卡，而且不报错。"""
    reg = ContextRegistry()
    cid = _company(tmp_path, reg, ("员工花名册.md",
                                   "# 别墅酒店 员工花名册\n\n姓名 | 岗位 | 部门 | 司龄\n"
                                   "周雅 | 传菜领班 | 前厅部 | 2 年\n"))
    assert reg.get(cid).extraction.people[0].person_id == "", "名册里本来就不该有工号"

    _submit(reg, cid, name="周雅", person_id="P-0007", submitted_at=W32, period="2026-W32")
    assert _person(reg.get(cid), "P-0007").team == "前厅部", "第一份没并进名册那张卡"

    w33 = [dict(a) for a in ANSWERS]
    w33[4] = {"field_id": "load", "value": 85}
    _submit(reg, cid, name="小周", person_id="P-0007", answers=w33,
            submitted_at=W33, period="2026-W33")

    ctx = reg.get(cid)
    assert len(ctx.extraction.people) == 1, \
        f"花名那一份开了第二张卡：{[(p.name, p.person_id) for p in ctx.extraction.people]}"
    assert ctx.extraction.people[0].self_report.load.value == 85


def test_an_id_adopted_mid_pass_is_immediately_usable_as_the_merge_key():
    """一趟归并里三条读数：名册（没工号）→ 周报甲（周雅 + P-0007）→ 周报乙（**花名**小周 + P-0007）。

    第二条按姓名并进去并把工号**补**到那张卡上；第三条的名字对不上任何人，只能靠那本刚补上的
    工号索引找回来。这是 `PersonIndex.by_id` / `adopt_id` 唯一真正不可替代的场景——键的形状
    （`#id:…`）在别的路径上碰巧也能对上，所以不造出这一趟，那本索引拆掉都不会有门红。"""
    res = ExtractionResult(people=[
        PersonEntity(id="u_zhou", name="周雅", role="传菜领班", source="名册.md:2"),
        PersonEntity(id="u_zhou", name="周雅", person_id="P-0007", source="周报甲.md:5",
                     self_report=PersonSelfReport(
                         load=SelfReportLoad(value=72, source="周报甲.md:5"))),
        PersonEntity(id="u_xiaozhou", name="小周", person_id="P-0007", source="周报乙.md:8",
                     collaboration=["和宴会厅对接档期"]),
    ])
    _dedupe_entities(res)
    assert len(res.people) == 1, \
        f"花名那条没顺着刚补上的工号找回来：{[(p.name, p.person_id) for p in res.people]}"
    survivor = res.people[0]
    assert (survivor.name, survivor.person_id, survivor.role) == ("周雅", "P-0007", "传菜领班")
    assert survivor.collaboration == ["和宴会厅对接档期"]
    assert survivor.self_report.load.value == 72


def test_an_upload_path_weekly_with_no_id_does_not_pick_one_of_two_same_named_people():
    """同一条歧义规则在**上传**那条路上也要成立：花名册里两个周雅（工号不同），一份周报写
    「周雅｜负载自述：85」但没有工号——那个数字是谁的不可知。归并宁可多留一条认不出主人的
    记录，也不从两个人里挑第一个：挑，是一次不会报错的错误归属。

    （回流那条路另有一道显式的挡板，所以这条门直接问 `_dedupe_entities`——否则那道挡板会把
    这里的判据挡住，规则本身反而没人验。）"""
    res = ExtractionResult(people=[
        PersonEntity(id="u_zhou", name="周雅", person_id="P-0007", team="前厅部",
                     source="名册.md:2"),
        PersonEntity(id="u_zhou", name="周雅", person_id="P-0011", team="客房部",
                     source="名册.md:3"),
        PersonEntity(id="u_zhou", name="周雅", source="周报.md:9",
                     self_report=PersonSelfReport(
                         load=SelfReportLoad(value=85, source="周报.md:9"))),
    ])
    _dedupe_entities(res)
    assert len(res.people) == 3, "没工号的那条读数被挂到了某一个周雅身上"
    assert res.people[0].self_report is None and res.people[1].self_report is None
    assert len({p.id for p in res.people}) == 3, "三张卡里有两张撞了 id"


def test_without_a_staff_number_an_ambiguous_name_reflows_onto_nobody(tmp_path, caplog):
    """名册没有工号列 + 两个周雅（按名并成了一张卡是既有行为），链接也没带工号。
    这时候「这个数字是谁的」是**不可知**的。诚实的做法是资料照进、卡上不动——
    掷硬币挑一个，是一次不报错的错误归属。"""
    reg = ContextRegistry()
    cid = _company(tmp_path, reg, ("员工花名册.md", ROSTER_WITH_IDS))
    _submit(reg, cid, name="周雅", person_id="")

    ctx = reg.get(cid)
    assert all(p.self_report is None for p in ctx.extraction.people), \
        "没工号又同名，读数却挂到了某一个人身上"
    assert len(ctx.extraction.people) == 3, "凭空多开了一张认不出主人的卡"
    assert ctx.source_documents[-1].filename.startswith("周报-"), "资料本身也没进去 —— 过头了"


def test_a_person_the_roster_never_mentioned_gets_a_card_of_her_own(tmp_path):
    """新同事第一次交表：名册里没有她。追加一条新实体是对的（经理铸链时点了她的名），
    但必须追加在**末尾** —— 活下来那条的 id 是前端编辑/归档的靶子，换掉就等于让老卡失联。"""
    reg = ContextRegistry()
    cid = _company(tmp_path, reg, ("员工花名册.md", ROSTER_ONE_ZHOUYA))
    before = [p.id for p in reg.get(cid).extraction.people]
    _submit(reg, cid, name="孙浩", person_id="P-0021")

    ctx = reg.get(cid)
    assert [p.id for p in ctx.extraction.people][:len(before)] == before, "老卡的 id 被挤动了"
    assert _person(ctx, "P-0021").self_report.load.value == 72


# ==============================================================================================
# 4 · 旧行为一个字节没动（没有工号的世界 = 今天的世界）
# ==============================================================================================

def test_with_no_staff_numbers_anywhere_the_merge_is_the_old_merge():
    """`PersonIndex` 在没有任何工号时必须逐字退化成旧的「按 `_person_key(name)` 归并」。
    这条门 + T6 的整套钉死门（test_dedupe_characterization_b2a）一起，是「存量语料没被动过」
    的证明。这里挑的是那个仓库反复引用的 Lena Park enrichment 形状。"""
    res = ExtractionResult(people=[
        PersonEntity(id="u_lena_park", name="Lena Park", team="Design", source="roster.csv:2"),
        PersonEntity(id="u_lena_park", name="Lena  Park", owns=["A", "B", "C"],
                     source="weekly.md:9"),
    ])
    _dedupe_entities(res)
    assert len(res.people) == 1
    assert (res.people[0].team, res.people[0].owns) == ("Design", ["A", "B", "C"])
    assert res.people[0].source == "roster.csv:2"


def test_the_form_writer_and_the_pipeline_merge_a_person_the_same_way():
    """表单回流走 `merge_person_reading`，上传走 `_dedupe_entities`。两处必须是同一句话——
    它们共用 `PersonIndex` + `_absorb_person`，这条门是那句话的可证伪版本：同一对实体，
    两条路给出同一张卡。哪天有谁在其中一条上"顺手"改了合并规则，这里先红。"""
    def pair():
        return (PersonEntity(id="u_zhou", name="周雅", person_id="P-0007", team="前厅部",
                             source="名册.md:2"),
                PersonEntity(id="u_zhou", name="周雅", person_id="P-0007", source="周报.md:9",
                             self_report=PersonSelfReport(
                                 load=SelfReportLoad(value=72, source="周报.md:9"))))
    a, b = pair()
    res = ExtractionResult(people=[a, b])
    _dedupe_entities(res)
    c, d = pair()
    survivor = merge_person_reading([c], d)
    for field in ("id", "name", "person_id", "team", "role", "source"):
        assert getattr(res.people[0], field) == getattr(survivor, field), field
    assert res.people[0].self_report.load.value == survivor.self_report.load.value


def test_merge_person_reading_refuses_a_reading_it_cannot_account_for():
    """它只收「身份 + 自述」。带着 T6 冲突口径字段（team/…）的读数需要 `_note_conflicts` 那一整套
    出处账本，本函数刻意没有——静默吞掉一条冲突读数，比拒绝写糟得多。"""
    with pytest.raises(ValueError, match="conflict bookkeeping"):
        merge_person_reading([], PersonEntity(id="u_x", name="周雅", team="前厅部"))


# ==============================================================================================
# 5 · 时间性：第二周的数字必须赢
# ==============================================================================================

def test_a_later_submission_refreshes_the_number_an_earlier_one_does_not(tmp_path):
    """`_dedupe_entities` 的自述合并是每个子槽 keep-first，那是对的（防一份花名册冲掉一份周报）。
    但表单这条路上追加严格按时间来，keep-first 就等于 keep-**oldest**：人卡会永远停在第一周。
    回流因此在合并**之前**按 `uploaded_at` 腾空过时的子槽，让既有规则自然填上新的。

    ⚠ 用写死的时间串，不用墙上时钟（MEMORY：Docker PG 容器时钟来回跳 115 秒，任何比"现在"
    的判据都是间歇假红，招牌症状是"单跑绿、整轮红"）。"""
    reg = ContextRegistry()
    cid = _company(tmp_path, reg, ("员工花名册.md", ROSTER_ONE_ZHOUYA))
    _submit(reg, cid, person_id="P-0007", submitted_at=W32, period="2026-W32")

    w33 = [dict(a) for a in ANSWERS]
    w33[4] = {"field_id": "load", "value": 85}
    w33[5] = {"field_id": "mood", "value": "吃紧"}
    sd33, _ = _submit(reg, cid, person_id="P-0007", answers=w33,
                      submitted_at=W33, period="2026-W33")

    her = _person(reg.get(cid), "P-0007")
    assert her.self_report.load.value == 85, "第二周的自述被 keep-first 吃掉了"
    assert her.self_report.mood.value == "strained"
    assert her.self_report.load.source.startswith(sd33.source_key), \
        "数字换了、出处还指着上周那份文档 —— 卡在撒一个关于时间的谎"


def test_a_late_filed_older_submission_does_not_overwrite_the_fresher_one(tmp_path):
    """补灌一份**更旧**的提交（经理事后补交上周那份）不许把这周的数字盖掉。
    腾空的判据是 `uploaded_at` 的先后，不是 append 的先后。"""
    reg = ContextRegistry()
    cid = _company(tmp_path, reg, ("员工花名册.md", ROSTER_ONE_ZHOUYA))
    fresh = [dict(a) for a in ANSWERS]
    fresh[4] = {"field_id": "load", "value": 85}
    _submit(reg, cid, person_id="P-0007", answers=fresh, submitted_at=W33, period="2026-W33")
    _submit(reg, cid, person_id="P-0007", submitted_at=W32, period="2026-W32")   # load=72，更旧

    assert _person(reg.get(cid), "P-0007").self_report.load.value == 85


# ==============================================================================================
# 6 · 情境信号
# ==============================================================================================

def test_a_situational_answer_becomes_a_sourced_signal_on_her_card(tmp_path):
    """判据打在**卡面**上：`signal_cards()` 里那个叫 `source` 的键是类型词，不是文档指针，
    所以断言 `sourceRef`。`subjectId` 必须是人卡 id 而不是姓名——留成姓名的话信号永远挂不上卡，
    而且不报错、门也全绿。"""
    reg = ContextRegistry()
    cid = _company(tmp_path, reg, ("员工花名册.md", ROSTER_ONE_ZHOUYA))
    sd, _ = _submit(reg, cid, person_id="P-0007")

    ctx = reg.get(cid)
    her = _person(ctx, "P-0007")
    mine = [c for c in ctx.signal_cards() if c["subjectId"] == her.id]
    assert [c["summary"] for c in mine] == [
        "宴会厅翻台没压到 25 分钟，缺一个人。", "想借调一个人手到晚市。"], \
        f"情境信号不是这两格的原话：{[c['summary'] for c in mine]}"
    assert mine[0]["sourceRef"] == \
        f"{sd.source_key}:{_line_of(sd, '宴会厅翻台没压到 25 分钟')}", "信号引不回它那一行"
    assert mine[0]["subjectType"] == "person"


def test_accomplishments_plans_and_essays_do_not_become_signals(tmp_path):
    """「已完成事实」是成绩、「下一周期目标」是计划——都不是需要经理今天看一眼的情境。
    超长的那一格也不出信号：卡上的情境句必须是原话逐字，砍到 120 字再打省略号是我们替她改口。
    这两格照旧整段进资料库、照旧被议事室引用。"""
    answers = [dict(a) for a in ANSWERS]
    answers[3] = {"field_id": "support", "value": "需要支持。" * 40}      # 200 字，超上界
    reg = ContextRegistry()
    cid = _company(tmp_path, reg, ("员工花名册.md", ROSTER_ONE_ZHOUYA))
    _submit(reg, cid, person_id="P-0007", answers=answers)

    ctx = reg.get(cid)
    summaries = [c["summary"] for c in ctx.signal_cards()]
    assert summaries == ["宴会厅翻台没压到 25 分钟，缺一个人。"], summaries
    assert any("需要支持。需要支持。" in m.text for m in ctx.extraction.materials), \
        "超长答案连资料都没进去 —— 过头了"


def test_a_sentence_that_reads_as_a_person_score_loses_its_signal_not_the_submission(tmp_path):
    """员工的话按 ADR-0023 不过红线门。但一条 `SignalEntity` 是**卡面产物**，会进
    `validate_extraction` 的扫描面。所以候选信号逐条预检：不过的丢掉信号，绝不让它炸掉整份提交
    （否则员工写一句什么，页面就变 thanks_pending，补灌永远失败）。原话照旧躺在资料里。"""
    answers = [dict(a) for a in ANSWERS]
    answers[1] = {"field_id": "missed", "value": "我这周的绩效 3/10，属于末位。"}
    reg = ContextRegistry()
    cid = _company(tmp_path, reg, ("员工花名册.md", ROSTER_ONE_ZHOUYA))
    sd, appended = _submit(reg, cid, person_id="P-0007", answers=answers)

    assert appended, "员工的一句话把整份提交炸掉了"
    ctx = reg.get(cid)
    assert all("3/10" not in c["summary"] for c in ctx.signal_cards()), "打分句进了卡"
    assert "绩效 3/10" in ctx.source_documents[-1].content.decode("utf-8"), "原话被改写了"
    assert _person(ctx, "P-0007").self_report.load.value == 72, "自述这一半被牵连了"


# ==============================================================================================
# 7 · 项目卡
# ==============================================================================================

def test_a_bound_form_adds_the_blocker_with_form_provenance(tmp_path):
    reg = ContextRegistry()
    cid = _company(tmp_path, reg, ("员工花名册.md", ROSTER_ONE_ZHOUYA),
                   ("宴会厅项目周报.md", PROJECT_DOC))
    sd, _ = _submit(reg, cid, person_id="P-0007", project_ref="宴会厅翻台")

    ctx = reg.get(cid)
    proj = next(p for p in ctx.extraction.projects if p.title == "宴会厅翻台")
    assert "宴会厅翻台没压到 25 分钟，缺一个人。" in proj.blockers
    assert proj.provenance["blockers"] == {
        "origin": "form", "source": sd.source_key, "updated_at": W32}


def test_an_unbound_form_touches_no_project(tmp_path):
    """不绑项目 = 回流只走人卡。也绝不凭 `project_ref` 里的一个名字新建项目卡——
    经理打错一个字就凭空多出一个公司里不存在的项目，比不写还糟。"""
    reg = ContextRegistry()
    cid = _company(tmp_path, reg, ("员工花名册.md", ROSTER_ONE_ZHOUYA),
                   ("宴会厅项目周报.md", PROJECT_DOC))
    before = [(p.title, list(p.blockers), dict(p.provenance)) for p in reg.get(cid).extraction.projects]
    _submit(reg, cid, person_id="P-0007", project_ref="根本不存在的项目")

    after = [(p.title, list(p.blockers), dict(p.provenance)) for p in reg.get(cid).extraction.projects]
    assert after == before


# ==============================================================================================
# 8 · 不许弄坏已经在库里的东西
# ==============================================================================================

def test_the_reflow_does_not_mint_projects_out_of_the_form_document(tmp_path):
    """渲染出来的文档名叫「周报-…」，`sniff_kind` 把它认成 `doc_kind='project'`——所以走一趟
    完整的 `HeuristicExtractor.extract()` 会顺带跑 `_projects_from_doc`，让员工的自由文本
    有机会凭空造出项目卡。回流刻意**只**调它要的那几个零件。"""
    answers = [dict(a) for a in ANSWERS]
    answers[0] = {"field_id": "done", "value": "项目：我编的项目\n状态：blocked\n负责人：张三"}
    reg = ContextRegistry()
    cid = _company(tmp_path, reg, ("员工花名册.md", ROSTER_ONE_ZHOUYA),
                   ("宴会厅项目周报.md", PROJECT_DOC))
    before = {p.title for p in reg.get(cid).extraction.projects}
    _submit(reg, cid, person_id="P-0007", answers=answers)

    assert {p.title for p in reg.get(cid).extraction.projects} == before


def test_filing_the_same_submission_twice_changes_nothing(tmp_path):
    reg = ContextRegistry()
    cid = _company(tmp_path, reg, ("员工花名册.md", ROSTER_ONE_ZHOUYA))
    created = now_iso()
    sub = FormSubmission(
        id=new_submission_id(), context_id=cid, template_id="tpl_weekly",
        person_id="P-0007", person_name="周雅", period="2026-W32",
        share_token="tok_form_x", answers=[dict(a) for a in ANSWERS], submitted_at=W32,
        created_at=created, expires_at=default_expiry(created))
    tpl = weekly_template(cid)
    append_submission_to_context(reg, tpl, sub)
    snap = reg.get(cid)
    shape = (len(snap.extraction.people), len(snap.extraction.signals),
             len(snap.source_documents))

    _, appended = append_submission_to_context(reg, tpl, sub)
    assert appended is False
    again = reg.get(cid)
    assert (len(again.extraction.people), len(again.extraction.signals),
            len(again.source_documents)) == shape


def test_a_hand_edited_person_keeps_her_provenance_and_her_archived_flag(tmp_path):
    """回流**不**重跑 `_dedupe_entities`。重跑会把手加的人（`um-…`）与同名的抽取实体并掉，
    而 `archived`（软删）和 `provenance`（手编出处）根本不在合并规则里——它们会连人带证据
    一起消失。一次员工提交不该有权删掉经理手动归档过的一张卡。"""
    reg = ContextRegistry()
    cid = _company(tmp_path, reg, ("员工花名册.md", ROSTER_ONE_ZHOUYA))
    ctx = reg.get(cid)
    ctx.extraction.people.append(PersonEntity(
        id="um_zhouya_manual", name="周雅", role="临时工",
        archived=True, provenance={"role": {"origin": "manual", "source": "手动编辑",
                                            "updated_at": W32}}))
    reg.put(ctx)

    _submit(reg, cid, person_id="P-0007")

    ctx = reg.get(cid)
    manual = next(p for p in ctx.extraction.people if p.id == "um_zhouya_manual")
    assert manual.archived is True, "手动归档被一次表单提交撤销了"
    assert manual.provenance["role"]["origin"] == "manual", "手编出处被抹掉了"


def test_an_existing_conflict_is_not_duplicated_by_a_form_append(tmp_path):
    """T6 的 `conflict_index` 是每次调用新建的，而 `res.conflicts` 跨 `get()` 持久。
    回流要是重跑一遍归并，能再撞一次的字段就会往 conflicts 上追加重复记录（T7 渲染两遍）。"""
    reg = ContextRegistry()
    # ⚠ 文件名决定 doc_kind：叫「周报-…」会被 sniff 成 project，`_people_from_roster` 根本不跑，
    # 这条门就会对着空气跑。要造出「两份资料对同一个人的部门读数不同」，第二份也得是一张名册。
    cid = _company(tmp_path, reg, ("员工花名册.md", ROSTER_ONE_ZHOUYA),
                   ("上周人员名单.md",
                    "姓名 | 岗位 | 部门 | 人员ID\n周雅 | 传菜领班 | 传菜组 | P-0007\n"))
    before = [(c.subject_kind, c.field, [v.value for v in c.values])
              for c in reg.get(cid).extraction.conflicts]
    assert before, "语料没造出冲突 —— 这条门在对着空气跑"
    _submit(reg, cid, person_id="P-0007")

    after = [(c.subject_kind, c.field, [v.value for v in c.values])
             for c in reg.get(cid).extraction.conflicts]
    assert after == before


# ==============================================================================================
# 9 · 红线与开关（存储恒有，投影随开关，手编通道永远够不着）
# ==============================================================================================

def test_the_switch_gates_the_projection_and_never_the_storage(tmp_path, monkeypatch):
    reg = ContextRegistry()
    cid = _company(tmp_path, reg, ("员工花名册.md", ROSTER_ONE_ZHOUYA))
    _submit(reg, cid, person_id="P-0007")
    ctx = reg.get(cid)

    assert ctx.extraction.people[0].self_report is not None, "存储被开关影响了"
    assert all("self_report" not in c for c in ctx.team_cards()), "开关关着还投出了自述"
    assert any("self_report" in c for c in _cards_with_scoring_on(ctx, monkeypatch))


def test_the_handwritten_person_endpoints_still_cannot_reach_the_identity_or_the_numbers():
    """A0-2：人身数字只能走解析层。工号是归并的第一把尺，同样不许从手编通道改——
    让经理在 UI 上把一个人的工号改成另一个人的，等于让她把两张卡的历史读数搬来搬去。"""
    from service.ingest_api import PersonIn, PersonPatch
    for model in (PersonIn, PersonPatch):
        assert model.model_config["extra"] == "forbid"
        for banned in ("person_id", "self_report", "load", "mood"):
            assert banned not in model.model_fields, f"{model.__name__} 长出了 {banned}"


def test_the_weekly_template_marks_exactly_the_two_situational_boxes():
    """回流读的是**字段描述**上的开关，不是写死的 field.id —— 模板可编辑，按 id 写死意味着
    经理一改题面，回流就静默失灵。这条门钉的是内置周报那两格的标注。"""
    tpl = weekly_template("ctx_any")
    assert [f.id for f in tpl.fields if f.situational] == ["missed", "support"]


def test_the_form_field_shape_survives_the_http_round_trip():
    """`FormFieldIn` 是 `extra='forbid'`：漏了 `situational` 这个键，经理在前端存一次模板
    就把内置周报的两个标注静默抹平了，回流从此不响、而且没有任何一处会红。"""
    from dataclasses import asdict
    from service.form_api import FormFieldIn
    for f in weekly_template("ctx_any").fields:
        assert FormFieldIn(**asdict(f)).situational == f.situational


# ==============================================================================================
# 10 · 真库（离线套看不到 pg 持久层 —— MEMORY：5 型真库 bug 只有这一层抓得到）
# ==============================================================================================

@needs_db
def test_the_reflow_survives_a_round_trip_through_postgres(tmp_path, monkeypatch):
    """`person_id` 是 PersonEntity 的新字段，而 `put()` 写的是 `asdict(p)` —— 0009 的
    allowlist CHECK 少一个键，生产上每一次人员写入都 500，而离线套一次都碰不到那条 CHECK。"""
    import os
    url = (os.environ.get("AVERY_DB_URL") or os.environ.get("PGVECTOR_URL") or "").strip()
    if not url:
        pytest.skip("no AVERY_DB_URL / PGVECTOR_URL")
    pytest.importorskip("psycopg")
    from avery.ingest.pg_registry import PostgresContextRegistry

    reg = PostgresContextRegistry(url, data_dir=tmp_path / "data")
    cid = _company(tmp_path, reg, ("员工花名册.md", ROSTER_WITH_IDS))
    sd, _ = _submit(reg, cid, person_id="P-0011")

    ctx = reg.get(cid)                       # 真的从库里读回来
    her = _person(ctx, "P-0011")
    assert her.self_report.load.value == 72
    assert her.self_report.load.caliber == "本人自述"
    assert _person(ctx, "P-0007").self_report is None
    assert any(c.get("sourceRef", "").startswith(sd.source_key) for c in ctx.signal_cards())


@needs_db
def test_a_bound_submission_round_trips_its_project_ref(tmp_path):
    """`project_ref` 是 form_submissions 的新列（0014）。列序对不上、SELECT 漏了它，
    离线套（内存 registry 直接存 dataclass 快照）一个字都看不见。"""
    import os
    url = (os.environ.get("AVERY_DB_URL") or os.environ.get("PGVECTOR_URL") or "").strip()
    if not url:
        pytest.skip("no AVERY_DB_URL / PGVECTOR_URL")
    pytest.importorskip("psycopg")
    from avery.ingest.pg_registry import PostgresContextRegistry

    reg = PostgresContextRegistry(url, data_dir=tmp_path / "data")
    cid = _company(tmp_path, reg, ("员工花名册.md", ROSTER_ONE_ZHOUYA),
                   ("宴会厅项目周报.md", PROJECT_DOC))
    created = now_iso()
    sub = reg.put_form_submission(FormSubmission(
        id=new_submission_id(), context_id=cid, template_id="tpl_weekly",
        person_id="P-0007", person_name="周雅", period="2026-W32", project_ref="宴会厅翻台",
        share_token="tok_" + uuid.uuid4().hex, created_at=created,
        expires_at=default_expiry(created)))
    assert reg.get_form_submission(sub.id).project_ref == "宴会厅翻台"


# --- 0807 HITL：工号投到人卡上（铸链界面才拿得到身份尺）-----------------------------------------
# `_one_person_card` 以前只发内部键 `id`（`u_周雅`），不发 `person_id`。后果不是抽象的：
# 铸链界面因此只能送空工号（FilesScreen 那段长注释写着「跨后端的一刀」），
# 花名册里两位同名同事交的周报永远认不出是谁，自述被诚实跳过——经理看到的是「交了却没反应」。

_ROSTER_WITH_IDS_MD = "\n".join([
    "# 花名册",
    "",
    "姓名 | 人员ID | 职位 | 部门",
    "周雅 | SY-0308 | 宴会厅领班 | 餐饮部",
    "陈明远 | | 中餐厨师长 | 厨房",
    "",
])


def _cards_from(md: str) -> dict:
    from avery.ingest import ContextRegistry, HeuristicExtractor, ingest_docs
    from avery.ingest.parse import parse_bytes
    rep = ingest_docs([parse_bytes("roster.md", md.encode("utf-8"))],
                      extractor=HeuristicExtractor(), registry=ContextRegistry())
    return {c["name"]: c for c in rep.context.team_cards()}


def test_person_card_carries_the_staff_number():
    cards = _cards_from(_ROSTER_WITH_IDS_MD)
    assert cards["周雅"]["person_id"] == "SY-0308"
    # 🔴 内部键与工号是两件事，绝不可互相冒充（送错工号比不送更糟：PersonIndex 规则 2
    # 会把同一个人判成「两个恰好同名的人」而彻底不并卡）。
    assert cards["周雅"]["id"] != cards["周雅"]["person_id"]


def test_person_card_omits_the_key_when_there_is_no_staff_number():
    """absent≠none：没工号的公司一个字节都不多收，前端据此退回按姓名认人。"""
    cards = _cards_from(_ROSTER_WITH_IDS_MD)
    assert "person_id" not in cards["陈明远"]
