# -*- coding: utf-8 -*-
"""T9 · forms-proactive（gap2 战役，gh issue #58）—— 自动补铸 + 今天页缺交规则，全离线。

三段判据，各盯一件事：

  **① 幂等护栏**（`form_autofill` + registry 双胞胎的 `put_form_submission_if_absent`）
     本期已经有行的人不再铸，`open / submitted / expired` 任意态都算「已经有了」。
     🔴 而且 **手动铸链的行为一个字节不许变**——「再发一轮」是正当语义（`mint_links` 的
     docstring 明写）。本文件专门为它立了一条**回归钉**（`test_manual_mint_stays_non_idempotent`）：
     T9 之前全仓没有任何一条测试钉着这件事（侦察实测：grep 全 tests 树无一命中），
     所以这条护栏最可能的死法就是有人顺手给那四列加个唯一约束、而没有任何东西会红。
     并发那一半在 `test_form_store_contract.py::@needs_db`——库上那条部分唯一索引才是事务级保证，
     离线内存双胞胎证明不了它，硬要在这里"证明"就是一条假绿。

  **② 照抄上期**：收件人与 `project_ref` 沿用上期；上期绑的项目今天不在了 → 那一格退回不绑，
     **绝不猜**（`form_reflow.find_bound_project` 的同一条纪律）。

  **③ 今天页规则**（`decision_grading.grade_form_period`）：本期有人没交 **且** 最早那条链接
     快到期了才响；句子里那个人数**就是**证据行数（结构上不可能对不上）；项目卡永不命中它。

⚠ 语料含中文字节是故意的（MEMORY：门语料全 ASCII 盲点）——姓名、模板名、项目名都是中文，
`person_key` 的空白折叠、jsonb 往返、拼接键的编码问题要在这里暴露，不要在客户面前。
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import pytest

from avery.decision_grading import grade_form_period, grade_projects
from avery.ingest.form import (
    FormSubmission, auto_mint_key, current_period, new_submission_id, now_iso, person_key,
    weekly_template,
)
from avery.ingest.form_autofill import (
    MAX_AUTO_MINT_PER_PERIOD, ensure_current_period_links, form_period_status,
)
from avery.ingest.registry import ContextRegistry

HERE = Path(__file__).resolve().parent.parent
FIX = HERE / "tests" / "fixtures" / "ingest"
HANDBOOK = FIX / "Studio_Handbook.md"

TODAY = date(2026, 8, 7)                                  # 2026-W32
THIS_PERIOD = current_period(TODAY)
LAST_PERIOD = "2026-W31"


@pytest.fixture(autouse=True)
def _offline(monkeypatch):
    """三件套缺一真烧钱（MEMORY：门电池全离线配置）。本文件不给 registry 传 embedder，所以今天
    安全——但把它显式压成 keyword 才是安全的**理由**，而不是巧合。"""
    monkeypatch.setenv("AVERY_BRAIN", "mock")
    monkeypatch.setenv("AVERY_EXTRACTOR", "heuristic")
    monkeypatch.setenv("AVERY_EMBEDDINGS", "keyword")


def _reg_with_template() -> tuple[ContextRegistry, str]:
    reg = ContextRegistry()
    cid = "ctx_t9"
    reg.put_form_template(weekly_template(cid))
    return reg, cid


def _row(cid: str, *, name: str, period: str, person_id: str = "", project_ref: str = "",
         submitted: bool = False, expires_at: str = "", auto: bool = False) -> FormSubmission:
    created = now_iso()
    return FormSubmission(
        id=new_submission_id(), context_id=cid, template_id="tpl_weekly",
        person_id=person_id, person_name=name, period=period, project_ref=project_ref,
        share_token="tok_" + new_submission_id(),
        answers=[{"field_id": "done", "value": "交了"}] if submitted else None,
        submitted_at=now_iso() if submitted else "",
        created_at=created,
        expires_at=expires_at or (datetime.now(timezone.utc) + timedelta(days=7)).isoformat(),
        auto_key=auto_mint_key("tpl_weekly", period, person_id, name) if auto else "")


def _seed_last_period(reg, cid, people) -> None:
    for kw in people:
        reg.put_form_submission(_row(cid, period=LAST_PERIOD, **kw))


# ── ① 幂等护栏 ────────────────────────────────────────────────────────────────────────────────

def test_autofill_copies_last_periods_roster_and_bindings():
    reg, cid = _reg_with_template()
    _seed_last_period(reg, cid, [
        {"name": "周雅", "person_id": "P-0007", "project_ref": "宴会厅翻台"},
        {"name": "陈立", "person_id": "P-0008"},
    ])
    out = ensure_current_period_links(reg, cid, today=TODAY,
                                      projects=[_FakeProject("宴会厅翻台")])
    assert len(out) == 1 and out[0].count == 2
    assert out[0].copied_from == LAST_PERIOD and out[0].period == THIS_PERIOD

    rows = reg.list_form_submissions_in_period(cid, "tpl_weekly", THIS_PERIOD)
    # ⚠ 断言**内容**不断言顺序。同一批自动铸出来的行共用一个 `created_at`（一次调用一个时间戳），
    # 于是排序键 `(created_at, id)` 并列时退化成随机 uuid 序。这仍然是**确定的**（同一批行永远
    # 排出同一个顺序，所以规则的证据面是稳的），只是不等于上期名单的顺序。断言名单顺序会得到
    # 一条间歇假红的门。「照抄上期时保持上期的顺序」是一条可以做但本票没做的事，记在回执 Notes 里。
    assert {(r.person_name, r.person_id, r.project_ref) for r in rows} == {
        ("周雅", "P-0007", "宴会厅翻台"), ("陈立", "P-0008", "")}
    # 每人一条**不可猜的新**链接（不是把上期那条 token 抄过来——那会让上周填过的人以为还没填）。
    assert len({r.share_token for r in rows}) == 2
    assert all(r.auto_key and r.answers is None for r in rows)


def test_autofill_is_idempotent_across_repeated_reads():
    """经理在同一周里刷十次表单区，只该被备好一次。"""
    reg, cid = _reg_with_template()
    _seed_last_period(reg, cid, [{"name": "周雅", "person_id": "P-0007"}])
    first = ensure_current_period_links(reg, cid, today=TODAY)
    assert first and first[0].count == 1
    for _ in range(9):
        assert ensure_current_period_links(reg, cid, today=TODAY) == []
    assert len(reg.list_form_submissions_in_period(cid, "tpl_weekly", THIS_PERIOD)) == 1


def test_a_manual_row_this_period_suppresses_the_auto_one():
    """🔴 锁之一：经理已经手动给周雅铸过本期了 → 自动路径不许再给她铸一条。

    这道判据挡的**不是**库上那条唯一索引能挡的事：手动行的 `auto_key` 是空的，索引压根看不见它
    （0015 迁移文件头讲了为什么不能让索引盖住手动路径）。两把锁挡两件事，这是其中一件。
    """
    reg, cid = _reg_with_template()
    _seed_last_period(reg, cid, [{"name": "周雅", "person_id": "P-0007"},
                                 {"name": "陈立", "person_id": "P-0008"}])
    reg.put_form_submission(_row(cid, name="周雅", person_id="P-0007", period=THIS_PERIOD))

    out = ensure_current_period_links(reg, cid, today=TODAY)
    assert out and out[0].count == 1, "只该给还没有链接的那个人补"
    rows = reg.list_form_submissions_in_period(cid, "tpl_weekly", THIS_PERIOD)
    assert sorted(r.person_name for r in rows) == ["周雅", "陈立"]
    # 周雅那条仍是**手动**的原样一行——没有被自动路径再补一条，也没有被改写。
    hers = [r for r in rows if r.person_name == "周雅"]
    assert len(hers) == 1 and hers[0].auto_key == ""


@pytest.mark.parametrize("state", ["submitted", "expired"])
def test_any_state_this_period_counts_as_already_has_a_link(state):
    """🔴 点名的坑：本期**任意态**都算「他已经有链接了」。

    过期行没人清、也不该清（读时现算是设计，`form.effective_submission_status`）。把 expired
    当成「没铸过」的后果，是每周给同一个人重复发链接——而且是**静默**重复：屏幕上只多一行。
    """
    reg, cid = _reg_with_template()
    _seed_last_period(reg, cid, [{"name": "周雅", "person_id": "P-0007"}])
    stale = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    reg.put_form_submission(_row(
        cid, name="周雅", person_id="P-0007", period=THIS_PERIOD,
        submitted=(state == "submitted"),
        expires_at=stale if state == "expired" else ""))

    assert ensure_current_period_links(reg, cid, today=TODAY) == []
    assert len(reg.list_form_submissions_in_period(cid, "tpl_weekly", THIS_PERIOD)) == 1


def test_no_previous_period_means_nothing_to_copy():
    """第一轮永远由经理亲手发起——挑谁、绑哪个项目是他的决定，不是我们的。"""
    reg, cid = _reg_with_template()
    assert ensure_current_period_links(reg, cid, today=TODAY) == []
    assert reg.list_form_submissions_in_period(cid, "tpl_weekly", THIS_PERIOD) == []


def test_retired_template_never_auto_mints():
    """停用的模板按既有口径是 409「这张表撤了，不再发新链接」——自动路径更不该替它发。"""
    reg, cid = _reg_with_template()
    _seed_last_period(reg, cid, [{"name": "周雅", "person_id": "P-0007"}])
    tpl = reg.get_form_template(cid, "tpl_weekly")
    tpl.active = False
    reg.put_form_template(tpl)
    assert ensure_current_period_links(reg, cid, today=TODAY) == []


def test_the_period_before_is_the_latest_one_not_the_oldest():
    """上期 = **最近**那一期。按最早那期照抄等于拿三个月前的名单发本周的表。"""
    reg, cid = _reg_with_template()
    reg.put_form_submission(_row(cid, name="老同事", period="2026-W20"))
    reg.put_form_submission(_row(cid, name="周雅", period=LAST_PERIOD))
    out = ensure_current_period_links(reg, cid, today=TODAY)
    assert out and out[0].copied_from == LAST_PERIOD
    assert [r.person_name
            for r in reg.list_form_submissions_in_period(cid, "tpl_weekly", THIS_PERIOD)] == ["周雅"]


def test_ceiling_mints_nothing_rather_than_half_a_roster():
    """失控护栏：宁可整批不铸并留一条日志，也不截断后照铸——半份名单比没有名单更难发现。"""
    reg, cid = _reg_with_template()
    _seed_last_period(reg, cid, [{"name": f"同事{i}", "person_id": f"P-{i:04d}"}
                                 for i in range(MAX_AUTO_MINT_PER_PERIOD + 1)])
    assert ensure_current_period_links(reg, cid, today=TODAY) == []
    assert reg.list_form_submissions_in_period(cid, "tpl_weekly", THIS_PERIOD) == []


# ── 🔴 回归钉：手动铸链的现行为一个字节不许变 ─────────────────────────────────────────────────

def test_manual_mint_stays_non_idempotent(client):
    """「再发一轮」是正当语义（`mint_links` docstring）。T9 加的护栏只挂自动那一路。

    这条钉子在 T9 之前**不存在**（侦察实测：全 tests 树 grep 无一命中）。所以护栏最可能的死法
    就是有人顺手给 (context, template, period, person) 加一条全表唯一约束——经理第二次点
    「生成本周链接」当场拿到 500/409，而他什么都没做错，且没有任何东西会红。
    """
    cid, tok = _company(client)
    client.get(f"/team/{cid}/forms", headers=_auth(tok))
    body = {"recipients": [{"id": "P-0007", "name": "周雅"}], "period": THIS_PERIOD}
    first = client.post(f"/team/{cid}/forms/tpl_weekly/links", json=body, headers=_auth(tok))
    second = client.post(f"/team/{cid}/forms/tpl_weekly/links", json=body, headers=_auth(tok))
    assert first.status_code == 200 and second.status_code == 200, second.text
    a, b = first.json()["links"][0], second.json()["links"][0]
    assert a["id"] != b["id"], "第二次铸链没有建出新的一行——手动路径被改成幂等的了"
    assert a["token"] != b["token"], "两轮拿到了同一条链接"
    # 老链接照常有效（「重复调用等于再发一轮，老链接照常有效直到过期或被填」）。
    assert client.get(f"/f/{a['token']}").status_code == 200
    # 🔴 判据只落在**手动铸的那两行**上，不是「名单里所有行」（#82）。读名单那一下会顺手把
    # 本期备好，`THIS_PERIOD` 一旦成了上期，名单里就多出一条 auto=True 的本期空行——那是
    # T9 在干正事，不是手动路径被改坏了。`all(...)` 把这两件事混成了一条判据，W33 翻周当天炸。
    # 先钉「这两行确实在名单里」：过滤式判据最常见的死法是过滤出空集然后恒真。
    rows = {row["id"]: row for row in _submissions(client, cid, tok)}
    manual = [a["id"], b["id"]]
    assert set(manual) <= set(rows), \
        f"手动铸的两行不在名单里，判据在空跑：manual={manual} 名单={sorted(rows)}"
    assert [rows[i]["auto"] for i in manual] == [False, False], \
        "手动铸出来的行被标成了 auto——自动路径的 `auto_key` 漏到手动路径上了"


# ── ② 照抄上期：绑定与去重 ────────────────────────────────────────────────────────────────────

class _FakeProject:
    """`find_bound_project` 只读 `.title` 与 `.archived`。"""

    def __init__(self, title: str, archived: bool = False):
        self.title = title
        self.archived = archived


def test_a_binding_whose_project_is_gone_falls_back_to_unbound():
    reg, cid = _reg_with_template()
    _seed_last_period(reg, cid, [{"name": "周雅", "person_id": "P-0007",
                                  "project_ref": "已经改名的项目"}])
    out = ensure_current_period_links(reg, cid, today=TODAY, projects=[_FakeProject("别的项目")])
    assert out and out[0].dropped_bindings == ("已经改名的项目",)
    rows = reg.list_form_submissions_in_period(cid, "tpl_weekly", THIS_PERIOD)
    assert rows[0].project_ref == "", "找不到项目就该退回不绑，绝不猜一个近似的"


def test_an_archived_project_also_counts_as_gone():
    reg, cid = _reg_with_template()
    _seed_last_period(reg, cid, [{"name": "周雅", "project_ref": "宴会厅翻台"}])
    out = ensure_current_period_links(reg, cid, today=TODAY,
                                      projects=[_FakeProject("宴会厅翻台", archived=True)])
    assert out and out[0].dropped_bindings == ("宴会厅翻台",)


def test_unavailable_project_list_keeps_the_binding():
    """🔴 absent≠none：读不到项目卡，不等于项目没了。

    把「拿不到列表」按「项目确实没了」处理，等于每次读不到就把全公司的绑定悄悄清一遍——
    那是替客户断言一件我们并不知道的事。
    """
    reg, cid = _reg_with_template()
    _seed_last_period(reg, cid, [{"name": "周雅", "project_ref": "宴会厅翻台"}])
    out = ensure_current_period_links(reg, cid, today=TODAY, projects=None)
    assert out and out[0].dropped_bindings == ()
    rows = reg.list_form_submissions_in_period(cid, "tpl_weekly", THIS_PERIOD)
    assert rows[0].project_ref == "宴会厅翻台"


def test_two_rows_for_one_person_last_period_copy_once_with_the_latest_binding():
    """上期经理点了两次「再发一轮」，本期照抄仍是**一条**，绑定取他最后一次的表态。"""
    reg, cid = _reg_with_template()
    reg.put_form_submission(_row(cid, name="周雅", person_id="P-0007", period=LAST_PERIOD,
                                 project_ref="旧项目"))
    reg.put_form_submission(_row(cid, name="周雅", person_id="P-0007", period=LAST_PERIOD,
                                 project_ref="宴会厅翻台"))
    out = ensure_current_period_links(reg, cid, today=TODAY,
                                      projects=[_FakeProject("旧项目"),
                                                _FakeProject("宴会厅翻台")])
    assert out and out[0].count == 1
    rows = reg.list_form_submissions_in_period(cid, "tpl_weekly", THIS_PERIOD)
    assert rows[0].project_ref == "宴会厅翻台"


def test_person_key_keeps_employee_numbers_and_names_in_separate_namespaces():
    """🔴 工号与姓名必须分命名空间。

    一家公司里某人的工号恰好等于另一个人的姓名（酒店花名就是这么来的），不分命名空间就会把两个人
    判成同一个人 → 少铸一条链接 = 有人这周根本没收到表单，而且**没有任何报错**。
    """
    assert person_key("周雅", "") != person_key("", "周雅")
    # 姓名归一只折**排版噪音**：两侧空白、连续空白压成一个。
    assert person_key("", " 周雅 ") == person_key("", "周雅") == person_key("", "周雅  ")
    assert person_key("", "Anna  Smith") == person_key("", "Anna Smith")
    # 🔴 但内部空格不删光。两种错的代价不对等：误合并 = 有人这周静默收不到表单（没有任何一处
    # 会报错）；误拆分 = 他多收到一条链接，经理在「谁没交」那一段一眼就看见。宁可犯后者。
    assert person_key("", "周 雅") != person_key("", "周雅")
    # 有工号一律认工号——改了显示名不影响他是同一个人。
    assert person_key("P-0007", "周雅") == person_key("P-0007", "小周")


def test_same_name_two_people_with_employee_numbers_both_get_a_link():
    """0807 HITL 上同名两位同事被并成一张卡的那笔账，在这条路上的形态是「少发一条链接」。"""
    reg, cid = _reg_with_template()
    _seed_last_period(reg, cid, [{"name": "林小满", "person_id": "P-0011"},
                                 {"name": "林小满", "person_id": "P-0012"}])
    out = ensure_current_period_links(reg, cid, today=TODAY)
    assert out and out[0].count == 2
    rows = reg.list_form_submissions_in_period(cid, "tpl_weekly", THIS_PERIOD)
    assert sorted(r.person_id for r in rows) == ["P-0011", "P-0012"]


# ── ③ 今天页规则 ──────────────────────────────────────────────────────────────────────────────

NOW = datetime(2026, 8, 7, 12, 0, tzinfo=timezone.utc)


def _status(reg, cid, *, now=NOW):
    return form_period_status(reg, cid, today=TODAY, now=now)


def _seed_this_period(reg, cid, people):
    for kw in people:
        reg.put_form_submission(_row(cid, period=THIS_PERIOD, **kw))


def test_the_rule_fires_only_when_the_first_link_is_nearly_due():
    reg, cid = _reg_with_template()
    far = (NOW + timedelta(days=5)).isoformat()
    _seed_this_period(reg, cid, [{"name": "周雅", "expires_at": far}])
    assert grade_form_period(_status(reg, cid)[0], now=NOW) is None, (
        "链接还有五天到期就开始催人，等于每周有五天在提醒同一件事")

    reg2, cid2 = _reg_with_template()
    soon = (NOW + timedelta(hours=5)).isoformat()
    _seed_this_period(reg2, cid2, [{"name": "周雅", "expires_at": soon}])
    assert grade_form_period(_status(reg2, cid2)[0], now=NOW) is not None


def test_the_count_in_the_sentence_is_the_number_of_evidence_lines():
    """🔴 句子里那个人数**就是**证据行数，不是另算的第二个数——结构上不可能对不上。"""
    reg, cid = _reg_with_template()
    soon = (NOW + timedelta(hours=5)).isoformat()
    _seed_this_period(reg, cid, [{"name": n, "expires_at": soon} for n in ("周雅", "陈立", "林小满")])
    decided = grade_form_period(_status(reg, cid)[0], now=NOW)
    hit = decided.matched_rules[0].to_dict()
    assert hit["params"]["n"] == len(hit["evidence"]) == 3
    assert all(line.startswith('person="') and 'expires_at="' in line
               for line in hit["evidence"])
    # 证据面是**机器键 + 我们库里那一行的真值**（ADR-0033 第 ③ 类），语言中立、逐字可核。
    assert 'person="周雅"' in hit["evidence"][0]


def test_people_who_already_submitted_or_expired_are_not_counted_as_missing():
    """催一条今天已经打不开的链接，是给经理派一件做不成的事。"""
    reg, cid = _reg_with_template()
    soon = (NOW + timedelta(hours=5)).isoformat()
    gone = (NOW - timedelta(hours=1)).isoformat()
    _seed_this_period(reg, cid, [
        {"name": "周雅", "expires_at": soon},
        {"name": "陈立", "expires_at": soon, "submitted": True},
        {"name": "林小满", "expires_at": gone},
    ])
    status = _status(reg, cid)[0]
    assert [n for n, _ in status.missing] == ["周雅"]
    assert (status.submitted, status.expired, status.total) == (1, 1, 3)
    hit = grade_form_period(status, now=NOW).matched_rules[0].to_dict()
    assert hit["params"]["n"] == 1


def test_an_unreadable_expiry_keeps_the_rule_quiet():
    """读不出到期时刻就说不出「快到期了」。不猜"快到了"（拿一件我们并不知道的事打扰经理），
    也不猜"还早"——前者更贵，两者都不猜。"""
    reg, cid = _reg_with_template()
    _seed_this_period(reg, cid, [{"name": "周雅", "expires_at": "下周五之前"}])
    assert grade_form_period(_status(reg, cid)[0], now=NOW) is None


def test_a_period_with_nobody_missing_produces_no_card():
    reg, cid = _reg_with_template()
    soon = (NOW + timedelta(hours=5)).isoformat()
    _seed_this_period(reg, cid, [{"name": "周雅", "expires_at": soon, "submitted": True}])
    assert grade_form_period(_status(reg, cid)[0], now=NOW) is None


def test_a_project_card_can_never_pick_up_the_forms_rule():
    """🔴 项目主体上没有表单那一格，所以全表遍历时这条规则干净地返回空。

    它要是能命中项目，屏幕上就会在**每一张**项目卡上重复印同一句公司级的话。

    规则号从**产品自己那条路**取（跑一次公司级定级，读它发出来的 rule_id），不写字面量：
    `test_decision_grading.py::test_no_rule_text_in_any_prompt` 全仓禁止规则号出现在
    decision_rules.py / decision_grading.py / decision_grading_rules.md 之外。
    附带一个好处——写死字面量的话，规则改号时这条门会以"恒真"的形态静默失效。
    """
    reg, cid = _reg_with_template()
    soon = (NOW + timedelta(hours=5)).isoformat()
    _seed_this_period(reg, cid, [{"name": "周雅", "expires_at": soon}])
    forms_rule_id = grade_form_period(_status(reg, cid)[0], now=NOW).matched_rules[0].rule_id

    project = {"id": "p_1", "title": "宴会厅翻台", "status": "blocked",
               "blockers": ["等法务回复"], "progress": 20}
    decisions = grade_projects([project], [], as_of=TODAY)
    assert decisions, "构造的项目卡一条规则都没命中——这条门在空跑"
    assert all(hit.rule_id != forms_rule_id
               for d in decisions for hit in d.matched_rules), "项目卡命中了公司级的表单规则"


def test_the_forms_card_rides_the_same_sorted_list_as_project_cards():
    """公司级卡与项目卡在**同一个**列表里排序——刻意不另开一条返回通道，否则
    `decision_cards()` 与 `briefing()` 又会看到两份不同的真相。"""
    reg, cid = _reg_with_template()
    soon = (NOW + timedelta(hours=5)).isoformat()
    _seed_this_period(reg, cid, [{"name": "周雅", "expires_at": soon}])
    project = {"id": "p_1", "title": "宴会厅翻台", "status": "blocked", "blockers": ["等法务"]}
    decisions = grade_projects([project], [], as_of=TODAY, forms=_status(reg, cid), now=NOW)
    kinds = [d.subject_type for d in decisions]
    assert kinds == ["project", "forms"], "高风险的项目卡必须排在需确认的表单卡前面"
    assert decisions[1].subject_title == "周报" and decisions[1].owner_name == ""


def test_status_skips_templates_with_no_rows_this_period():
    reg, cid = _reg_with_template()
    _seed_last_period(reg, cid, [{"name": "周雅"}])
    assert _status(reg, cid) == []


# ── HTTP 面 ──────────────────────────────────────────────────────────────────────────────────

pytest.importorskip("fastapi.testclient")
from fastapi.testclient import TestClient  # noqa: E402


@pytest.fixture()
def client(monkeypatch):
    monkeypatch.setenv("AVERY_BRAIN", "mock")
    monkeypatch.setenv("AVERY_EXTRACTOR", "heuristic")
    monkeypatch.setenv("AVERY_EMBEDDINGS", "keyword")
    monkeypatch.delenv("AVERY_DB_URL", raising=False)
    monkeypatch.delenv("PGVECTOR_URL", raising=False)
    from avery.ingest.registry import REGISTRY
    REGISTRY.clear()
    from service import upload_guard
    upload_guard.reset_rate_limiter()
    from service.app import app
    with TestClient(app) as c:
        yield c
    REGISTRY.clear()


def _company(client) -> tuple[str, str]:
    files = [("files", (HANDBOOK.name, HANDBOOK.read_bytes(), "application/octet-stream"))]
    ing = client.post("/ingest", files=files).json()
    return ing["context_id"], ing["owner_token"]


def _auth(tok: str) -> dict:
    return {"X-Avery-Token": tok}


def _submissions(client, cid, tok) -> list[dict]:
    r = client.get(f"/team/{cid}/forms/submissions", headers=_auth(tok))
    assert r.status_code == 200, r.text
    return r.json()["submissions"]


def _submission_row(client, cid, tok, sid: str) -> dict:
    """名单里 id 为 `sid` 的那一行。

    🔴 **按 id 选，不按位置选**（#82）。这支端点读时会顺手把本期备好，名单又是 newest-first——
    只要被测的那条链接不在本期，`[0]` 就是自动铸出的本期空行。本文件两处 `[0]` 至今没红是因为
    它们铸的链接**正好落在本期**（于是没有"上一期"可照抄、自动路径不开火），那是布景的巧合，
    不是判据的保证。找不到就当场红，不让过滤式判据退化成空集恒真。
    """
    rows = {r["id"]: r for r in _submissions(client, cid, tok)}
    assert sid in rows, f"提交 {sid} 不在名单里，名单是 {[(k, v['period']) for k, v in rows.items()]}"
    return rows[sid]


def test_reading_the_forms_area_fills_this_period_in(client):
    """流量触发：经理**读**表单区那一下就把本期备好了（照 `ensure_builtin_templates` 的先例）。"""
    cid, tok = _company(client)
    client.get(f"/team/{cid}/forms", headers=_auth(tok))
    client.post(f"/team/{cid}/forms/tpl_weekly/links", headers=_auth(tok),
                json={"recipients": [{"id": "P-0007", "name": "周雅"},
                                     {"id": "P-0008", "name": "陈立"}],
                      "period": "2026-W01"})   # 一个铁定早于"本期"的周期

    r = client.get(f"/team/{cid}/forms/submissions", headers=_auth(tok))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["auto_filled"] == [
        {"template_id": "tpl_weekly", "period": current_period(), "copied_from": "2026-W01",
         "minted": 2}]
    fresh = [s for s in body["submissions"] if s["period"] == current_period()]
    assert sorted(s["person_name"] for s in fresh) == ["周雅", "陈立"]
    assert all(s["auto"] is True and s["status"] == "open" for s in fresh)

    # 🔴 additive key，空即缺席：第二次读没有真的铸出任何东西 → 这个键不出现。
    # 它是前端合成 'form' 通知的判据，判据必须是**一次真实的状态迁移**，不是"本期有行"
    # 这种每次刷新都为真的静态事实（否则铃铛每刷一次响一声）。
    assert "auto_filled" not in _second_read(client, cid, tok)


def _second_read(client, cid, tok) -> dict:
    r = client.get(f"/team/{cid}/forms/submissions", headers=_auth(tok))
    assert r.status_code == 200, r.text
    return r.json()


# ── 🔴 周翻转：自动铸链在新的一周开火（#82 正面判据）─────────────────────────────────────────
# 2026-08-10 周一 UTC 进 W33，是 T9 上线后第一个 ISO 周翻转。产品**正确开火**了——照着 W32 的
# 名单把 W33 备好——但那一刻全仓没有任何一条判据在看着这件事：直调用例都注入 `today=TODAY`
# （周期是死的，永远翻不了周），HTTP 用例照抄的是 `2026-W01` 这种「铁定早于本期」的远古周期，
# 形状对但不是**翻周**。于是产品干对了活，我们是从三条测试红里才发现它干了活的。
# 下面两条把这条路钉死：一条把钟拨到指定的那一天（含跨年），一条不打任何补丁跑真钟。


def _pin_autofill_clock(monkeypatch, day: date) -> None:
    """把自动补铸这一路的「今天」钉在 `day`。

    只补 `form_autofill` 模块里那个名字：被测的是 `ensure_current_period_links` 经 HTTP 走的
    那条路，它算周期就是调本模块的 `current_period`。ISO 周的**算法本身不替换**——lambda 里
    调的还是产品那支真函数，换掉的只有喂给它的日期。手动铸链走 `form_api` 自己那份 import，
    这里**没**被钉住，所以下面铸上期名单时一律显式传 `period`，不吃默认值。
    """
    from avery.ingest import form_autofill
    monkeypatch.setattr(form_autofill, "current_period",
                        lambda today=None: current_period(today or day))


@pytest.mark.parametrize("pinned, this_week, last_week", [
    ("2026-08-10", "2026-W33", "2026-W32"),   # #82 那一幕的原样复现：周一早上翻进新的一周
    ("2026-08-16", "2026-W33", "2026-W32"),   # 同一周的周日——周内哪天读，「本期」都得是同一期
    ("2027-01-04", "2027-W01", "2026-W53"),   # 跨年翻周（2026 是 53 周年，字典序仍然递增）
])
def test_a_new_iso_week_auto_fills_from_last_weeks_roster_over_http(
        client, monkeypatch, pinned, this_week, last_week):
    """经理在新的一周第一次打开表单区 → 本期已按**上一个 ISO 周**的名单备好。

    钉三天而不是一天：周一（翻周那一下）、同周周日（「本期」在一周内不许漂）、跨年那一次
    （`latest_form_period_before` 全靠 `YYYY-Www` 的字典序，W53→W01 是它唯一会崩的形状）。
    """
    day = date.fromisoformat(pinned)
    # 先验尺子再量东西：ISO 周算错了，下面每一条断言都会以「看着对」的样子测错东西。
    assert current_period(day) == this_week
    assert current_period(day - timedelta(days=7)) == last_week
    assert last_week < this_week, "上期没排在本期前面——字典序=时间序这条前提破了"
    _pin_autofill_clock(monkeypatch, day)

    cid, tok = _company(client)
    client.get(f"/team/{cid}/forms", headers=_auth(tok))
    r = client.post(f"/team/{cid}/forms/tpl_weekly/links", headers=_auth(tok),
                    json={"recipients": [{"id": "P-0007", "name": "周雅"},
                                         {"id": "P-0008", "name": "陈立"}],
                          "period": last_week})
    assert r.status_code == 200, r.text
    last_tokens = {lk["token"] for lk in r.json()["links"]}

    body = _second_read(client, cid, tok)
    assert body.get("auto_filled") == [
        {"template_id": "tpl_weekly", "period": this_week,
         "copied_from": last_week, "minted": 2}], \
        f"翻进 {this_week} 之后读表单区，本期没有按 {last_week} 的名单备好"

    fresh = [s for s in body["submissions"] if s["period"] == this_week]
    assert sorted(s["person_name"] for s in fresh) == ["周雅", "陈立"]
    assert all(s["auto"] is True and s["status"] == "open" for s in fresh)
    # 备好的是**空白**链接：照抄的是名单，不是上期的答案。
    assert all("answers" not in s for s in fresh)
    # 每人一条不可猜的新链接——把上期的 token 抄过来，会让上周填过的人以为自己还没填。
    assert not ({s["token"] for s in fresh} & last_tokens)
    # 上期那两行原样还在（照抄不是搬走）。
    assert len([s for s in body["submissions"] if s["period"] == last_week]) == 2

    # 同一周里再读一次不再铸（additive key，空即缺席——否则铃铛每刷一次响一声）。
    assert "auto_filled" not in _second_read(client, cid, tok)


def test_the_real_wall_clock_copies_last_iso_week_into_this_one(client):
    """同一条路，**不打任何补丁**跑真钟——一个周期字面量都不含，哪一天跑都该绿。

    上一条钉的是「钟拨到那天时的行为」，这一条钉的是「产品此刻读真钟算出来的那一期」确实
    就是自动补铸落地的那一期。两条缺一不可：只有钉钟那条，`current_period` 被改成返回常量
    也照样全绿（判据自己喂自己）；只有真钟这条，就永远测不到跨年和周一那一下。

    ⚠ 「本期」只问产品要一次（`current_period()`），不自己拿 `datetime.now()` 另算一遍：两次
    读钟之间隔着一整个 HTTP 请求，跨周那一瞬间（周日 23:59:59.999 → 周一）两个答案会不一样，
    那就又是一颗墙钟炸弹，只不过引信从「一周」缩到了「一毫秒」。**上期**则必须独立算出来
    （真钟减 7 天），否则整条判据就变成产品自己跟自己对答案。
    """
    last_week = current_period(datetime.now(timezone.utc).date() - timedelta(days=7))

    cid, tok = _company(client)
    client.get(f"/team/{cid}/forms", headers=_auth(tok))
    client.post(f"/team/{cid}/forms/tpl_weekly/links", headers=_auth(tok),
                json={"recipients": [{"id": "P-0007", "name": "周雅"}], "period": last_week})

    body = _second_read(client, cid, tok)
    filled = body.get("auto_filled")
    assert filled and len(filled) == 1, \
        f"真钟走到 {current_period()} 了，读表单区却没有按 {last_week} 的名单把本期备好"
    got = filled[0]
    assert got["template_id"] == "tpl_weekly" and got["minted"] == 1
    assert got["copied_from"] == last_week, "照抄的不是上一个 ISO 周"
    assert got["period"] == current_period(), "备好的不是产品此刻认的那一期"
    assert got["period"] > last_week, (
        f"本期 {got['period']} 没有排在上期 {last_week} 之后——`current_period` 要么不随周走，"
        f"要么 ISO 周的字典序被打破了（`latest_form_period_before` 全靠它）")

    fresh = [s for s in body["submissions"] if s["period"] == got["period"]]
    assert len(fresh) == 1 and fresh[0]["auto"] is True and fresh[0]["status"] == "open"
    assert fresh[0]["person_name"] == "周雅"


def test_voiding_an_open_link_expires_it_and_stops_the_autofill_loop(client):
    """作废 = 拨到期。行还在，所以自动补铸仍认为「他本期已经有过链接」——不会立刻发回来一条。"""
    cid, tok = _company(client)
    client.get(f"/team/{cid}/forms", headers=_auth(tok))
    client.post(f"/team/{cid}/forms/tpl_weekly/links", headers=_auth(tok),
                json={"recipients": [{"id": "P-0007", "name": "周雅"}], "period": "2026-W01"})
    auto = [s for s in _submissions(client, cid, tok) if s["auto"]]
    assert len(auto) == 1
    token = auto[0]["token"]

    r = client.post(f"/team/{cid}/forms/submissions/{auto[0]['id']}/void", headers=_auth(tok))
    assert r.status_code == 200, r.text
    assert r.json()["submission"]["status"] == "expired"
    # 员工那头看到的是现成的诚实页面，不是一种新造的状态。
    assert client.get(f"/f/{token}").status_code == 404
    # 再读一次不会把它补回来（否则经理点一次作废、系统立刻发回来一条，无限循环）。
    body = _second_read(client, cid, tok)
    assert "auto_filled" not in body
    assert len([s for s in body["submissions"] if s["period"] == current_period()]) == 1


def test_voiding_a_submitted_link_is_refused(client):
    """已提交是终态。答案是员工本人的话，作废按钮不许碰它。"""
    cid, tok = _company(client)
    client.get(f"/team/{cid}/forms", headers=_auth(tok))
    link = client.post(f"/team/{cid}/forms/tpl_weekly/links", headers=_auth(tok),
                       json={"recipients": [{"name": "周雅"}]}).json()["links"][0]
    client.post(f"/f/{link['token']}/submit",
                data={"f_done": "做完了三场", "f_missed": "没有", "f_next_goal": "继续",
                      "f_load": "60", "f_mood": "如常"})
    r = client.post(f"/team/{cid}/forms/submissions/{link['id']}/void", headers=_auth(tok))
    assert r.status_code == 409, r.text
    row = _submission_row(client, cid, tok, link["id"])
    assert row["status"] == "submitted" and row["submitted_at"]


def test_void_is_tenant_scoped_and_has_no_enumeration_oracle(client):
    """越权与"不存在"必须同体 404，否则这支端点就成了一个"这个 id 在不在"的探针。"""
    cid_a, tok_a = _company(client)
    cid_b, tok_b = _company(client)
    client.get(f"/team/{cid_a}/forms", headers=_auth(tok_a))
    link = client.post(f"/team/{cid_a}/forms/tpl_weekly/links", headers=_auth(tok_a),
                       json={"recipients": [{"name": "周雅"}]}).json()["links"][0]

    real_id_wrong_tenant = client.post(
        f"/team/{cid_b}/forms/submissions/{link['id']}/void", headers=_auth(tok_b))
    made_up_id = client.post(
        f"/team/{cid_b}/forms/submissions/sub_doesnotexist/void", headers=_auth(tok_b))
    assert real_id_wrong_tenant.status_code == made_up_id.status_code == 404
    # 两个响应体只许差在**调用方自己送进来的那个 id** 上——把它回显回去泄不了任何东西，
    # 但除此之外一个字都不许不同，否则「这个 id 存在」就能从响应里读出来。
    assert (real_id_wrong_tenant.json()["detail"].replace(link["id"], "<id>")
            == made_up_id.json()["detail"].replace("sub_doesnotexist", "<id>")), (
        "A 公司的真 id 与一个瞎编的 id，在 B 公司手里换来了两种不同的 404 —— 枚举 oracle")
    # 没有 token 也是同一个 404（门与本文件其余经理端点同一张）。
    assert client.post(f"/team/{cid_a}/forms/submissions/{link['id']}/void").status_code == 404
    assert _submission_row(client, cid_a, tok_a, link["id"])["status"] == "open", \
        "越权调用改动了别人的行"


# ── 端到端：新管线真的接到了 /team 的载荷上 ─────────────────────────────────────────────────
# 🔴 上面那些规则判据量的是 `grade_form_period` 这一个函数。**函数对了不等于管线通了**——
# T9 最长的一段新活恰恰是"把表单聚合喂进 grade 输入"，而那一段跨了三层
# （registry → form_autofill.form_period_status → ingest_api._team_payload → grade_projects）。
# 任何一层没接上，上面每一条都照旧全绿。所以这里走**真 HTTP**，判据落在 /team 回帧上。

def _seed_open_row_due_soon(context_id: str, name: str, hours: float = 5.0) -> None:
    """直接往 registry 里放一条**快到期**的本期 open 行。

    为什么不走 HTTP 铸链：`expires_at` 由服务端按 7 天算死，HTTP 面**没有**把它调近的入口
    （那是对的——经理不该能决定链接什么时候过期）。要造出"快到期"这个条件，只能从存储层进。
    ⚠ 这不是绕过判据：被验的是 `/team` 回帧里有没有那张卡，而不是这一行怎么进的库。
    """
    from avery.ingest.registry import active_registry
    reg = active_registry()
    created = now_iso()
    reg.put_form_submission(FormSubmission(
        id=new_submission_id(), context_id=context_id, template_id="tpl_weekly",
        person_id="", person_name=name, period=current_period(),
        share_token="tok_duesoon_" + new_submission_id(), created_at=created,
        expires_at=(datetime.now(timezone.utc) + timedelta(hours=hours)).isoformat()))


def test_the_today_page_payload_really_carries_the_forms_card(client):
    """本期有人没交 + 最早那条快到期 → `/team` 回帧里多出一张**公司级**决策卡。"""
    cid, tok = _company(client)
    client.get(f"/team/{cid}/forms", headers=_auth(tok))
    before = client.get(f"/team/{cid}", headers=_auth(tok)).json()
    assert all(d["subject_type"] == "project" for d in before["decisions"]), \
        "还没有任何表单行的时候就冒出了表单卡"

    _seed_open_row_due_soon(cid, "周雅")
    _seed_open_row_due_soon(cid, "陈立")
    after = client.get(f"/team/{cid}", headers=_auth(tok)).json()

    forms_cards = [d for d in after["decisions"] if d["subject_type"] == "forms"]
    assert len(forms_cards) == 1, (
        "整条新管线没通——三层里任何一层没接上，这里就是空的，而上面那些只测函数的判据照旧全绿")
    card = forms_cards[0]
    assert card["subject_title"] == "周报" and card["owner_name"] == ""
    assert card["grade"] == "needs_confirmation" and card["reason"] == "", \
        "ADR-0033：规则版不产出句子，句子归前端 i18n"
    hit = card["matched_rules"][0]
    assert hit["params"]["n"] == len(hit["evidence"]) == 2
    # 阈值仍归后端配置，随载荷一起发（前端句子里那个 {hours} 就吃它）。
    from avery.decision_rules import FORM_DUE_SOON_HOURS
    assert hit["params"]["hours"] == FORM_DUE_SOON_HOURS


def test_the_briefing_count_stops_calling_a_forms_card_a_project(client):
    """🔴 `look_kind == 'projects'` 的意思是「数出来的每一样东西都是一张项目卡」，中文壳据此
    印「其中 N 个项目值得多看一眼」。混进一张公司级表单卡还说 'projects'，屏幕上就会写着
    「2 个项目」而只有 1 张项目卡在场——这个方法的长注释里记着因为同一个原因栽过两次。"""
    cid, tok = _company(client)
    client.get(f"/team/{cid}/forms", headers=_auth(tok))
    before = client.get(f"/team/{cid}", headers=_auth(tok)).json()["briefing"]
    n_before = next((int(m["value"]) for m in before["metrics"] if m["label"] == "need a look"), 0)

    _seed_open_row_due_soon(cid, "周雅")
    after = client.get(f"/team/{cid}", headers=_auth(tok)).json()["briefing"]
    n_after = next((int(m["value"]) for m in after["metrics"] if m["label"] == "need a look"), 0)
    assert n_after == n_before + 1, "表单卡没被算进「值得多看一眼」——两边喂的不是同一份数据"
    assert after["look_kind"] == "items", (
        f"数进去一张不是项目的卡，look_kind 却还是 {after['look_kind']!r}——"
        f"中文壳会把它印成「{n_after} 个项目」")
