# -*- coding: utf-8 -*-
"""T1 · form-backend-a1a —— 常驻表单的存储契约：一套判据，两个实现（memory + postgres）。

表单骑的是 feat-030/033/034 立下的同一条 registry 缝：`ContextRegistry`（进程内）与
`PostgresContextRegistry`（真库）各长出同一组 `put_form_template / get_form_template /
list_form_templates / put_form_submission / get_form_submission(_by_token) /
list_form_submissions / record_form_answers`，`active_registry()` 依旧是服务层唯一要认的那个面。
量的是**行为**不是内部实现（照 test_ask_store_contract.py 的体例）。

  共有（memory + postgres —— 离线套只跑 memory 那条腿）：
    * 模板 put → get 整张往返：题面、help、required、choices、number 上下界、active；
    * 未知模板 id / 未知 token → None（HTTP 的 404 全靠这条）；
    * 铸链即建行：没交的人是 answers=None 的行，不是缺席（「谁没交」的真相来源）；
    * `record_form_answers` 是**单锁**：首答落地，第二次返回 'already' 且**不覆盖**
      （证据必须稳得住 —— 与快问回执同一条 PRD Q8 纪律）；
    * 🔴 存储门拒收「给人打分」的**题面**（两档：`redline.validate`，除非
      `AVERY_ALLOW_PERSON_SCORING` 开着 —— 复用 feat-033 的开关，不新造机制）；
    * 🔴 但**答案不过红线**（ADR-0023：那是员工本人的话）—— 保证在落点，不在词表；
    * 任一文本里的 NUL(0x00) 一律拒收，与开关无关（存储安全不是政策）。

  持久性（@needs_db，仅 postgres）：
    * 一个 registry 实例铸出的链接与收到的答案，对一个**全新**实例/连接可见
      （「员工明天再打开这条链接」这句承诺的真身）。

⚠ 语料含中文字节是**故意的**（MEMORY：门语料全 ASCII 盲点）——内置模板本身就是中文，答案里
也塞了中文原句，这样 jsonb 往返、编码、截断的问题才会在这里暴露而不是在客户面前。
"""
from __future__ import annotations

import uuid
from dataclasses import asdict
from pathlib import Path

import pytest

from avery.ingest import ingest_paths
from avery.ingest.form import (
    FormField, FormSubmission, FormTemplate,
    auto_mint_key, default_expiry, ensure_builtin_templates, new_submission_id, now_iso,
    weekly_template,
)
from avery.ingest.registry import ContextRegistry

HERE = Path(__file__).resolve().parent.parent          # eval-harness/
FIX = HERE / "tests" / "fixtures" / "ingest"
HANDBOOK = FIX / "Studio_Handbook.md"

needs_db = pytest.mark.needs_db


def _db_url() -> str | None:
    import os
    return (os.environ.get("AVERY_DB_URL") or os.environ.get("PGVECTOR_URL") or "").strip() or None


def _new_cid() -> str:
    return "ctx_formtest_" + uuid.uuid4().hex[:12]


class _Impl:
    def __init__(self, name: str, fresh):
        self.name = name
        self.fresh = fresh
        self.created: list[str] = []

    def track(self, cid: str) -> str:
        self.created.append(cid)
        return cid


def _pg_impl(tmp_path: Path) -> _Impl:
    url = _db_url()
    if not url:
        pytest.skip("needs AVERY_DB_URL (or PGVECTOR_URL) pointing at a Postgres — DB layer skipped")
    pytest.importorskip("psycopg")
    from avery.ingest.pg_registry import PostgresContextRegistry
    data_dir = tmp_path / "data"
    return _Impl("postgres", lambda: PostgresContextRegistry(url, data_dir=data_dir))


def _pg_cleanup(impl: _Impl) -> None:
    if impl.name != "postgres" or not impl.created:
        return
    reg = impl.fresh()
    for cid in impl.created:
        reg.delete(cid)   # 模板/提交随 context CASCADE（0013 的 FK）


@pytest.fixture(autouse=True)
def _offline_embeddings(monkeypatch):
    """三件套缺一真烧钱（MEMORY：门电池全离线配置）。本文件从不给 registry 传 embedder，所以
    今天是安全的 —— 但本机 .env 里是 `AVERY_EMBEDDINGS=dashscope` + 真 key，把它显式压成 keyword
    才是安全的**理由**，而不是巧合。"""
    monkeypatch.setenv("AVERY_EMBEDDINGS", "keyword")
    monkeypatch.setenv("AVERY_BRAIN", "mock")
    monkeypatch.setenv("AVERY_EXTRACTOR", "heuristic")


@pytest.fixture(params=["memory", pytest.param("postgres", marks=needs_db)])
def impl(request, tmp_path):
    if request.param == "memory":
        reg = ContextRegistry()
        yield _Impl("memory", lambda: reg)
        return
    pg = _pg_impl(tmp_path)
    yield pg
    _pg_cleanup(pg)


def _ingest_context(impl: _Impl, work_dir: Path) -> tuple:
    reg = impl.fresh()
    cid = impl.track(_new_cid())
    rep = ingest_paths([str(HANDBOOK)], registry=reg, work_dir=work_dir, context_id=cid,
                       name="别墅酒店", owner_token="tok_form_contract_owner")
    assert rep.ok
    return reg, cid


def _minted(cid: str, template_id: str, name: str, *, token: str | None = None,
            person_id: str = "") -> FormSubmission:
    created = now_iso()
    return FormSubmission(
        id=new_submission_id(), context_id=cid, template_id=template_id,
        person_id=person_id, person_name=name, period="2026-W32",
        share_token=token or ("tok_form_" + uuid.uuid4().hex),
        created_at=created, expires_at=default_expiry(created))


_ZH_ANSWERS = [
    {"field_id": "done", "value": "晚市高峰传菜等位超 8 分钟，本周排了 3 次加班顶上去。"},
    {"field_id": "missed", "value": "宴会厅翻台没压到 25 分钟，缺一个人。"},
    {"field_id": "next_goal", "value": "把传菜动线改一版，下周试跑。"},
    {"field_id": "load", "value": 72},
    {"field_id": "mood", "value": "偏紧"},
]


# ==============================================================================================
# 模板
# ==============================================================================================

def test_put_template_then_get_round_trips_every_field_attribute(impl, tmp_path):
    reg, cid = _ingest_context(impl, tmp_path / "mem")
    tpl = weekly_template(cid)
    reg.put_form_template(tpl)

    got = reg.get_form_template(cid, tpl.id)
    assert got is not None, "put_form_template -> get_form_template 把模板弄丢了"
    assert got.id == tpl.id and got.context_id == cid and got.title == "周报"
    assert got.active is True and got.created_at
    # 🔴 gap2 T11：判据从手写八元组换成 `asdict` **全量**比对。
    # 这条门原本叫 every_field_attribute，断言却是逐字列出的八个属性——`situational` 加进
    # dataclass 之后它一直不在里面，也就是说 pg 那侧的 jsonb 往返把它弄丢，这道号称
    # every-attribute 的门照样全绿。手写清单一定会在下一次加字段时再漏一个；全量比对不会。
    assert [asdict(f) for f in got.fields] == [asdict(f) for f in tpl.fields]
    assert "situational" in asdict(got.fields[1]), "自证：断言真的看到了那几个新属性"
    assert got.fields[1].situational is True and got.fields[4].self_report == "load"


def test_unknown_template_resolves_to_none(impl, tmp_path):
    reg, cid = _ingest_context(impl, tmp_path / "mem")
    assert reg.get_form_template(cid, "tpl_never_created") is None


def test_list_templates_is_scoped_to_one_company(impl, tmp_path):
    reg, cid = _ingest_context(impl, tmp_path / "mem")
    reg.put_form_template(weekly_template(cid))
    assert [t.id for t in reg.list_form_templates(cid)] == ["tpl_weekly"]
    assert reg.list_form_templates(_new_cid()) == []


def test_ensure_builtin_templates_is_idempotent_and_never_overwrites_an_edited_one(impl, tmp_path):
    """内置模板按需铸出；已经存在（哪怕经理改过题面）就原样不动 —— 否则每次读列表都把经理的
    修改冲掉，而且历史提交的字段含义会跟着代码漂。"""
    reg, cid = _ingest_context(impl, tmp_path / "mem")
    first = ensure_builtin_templates(reg, cid)
    assert [t.id for t in first] == ["tpl_weekly"]

    edited = reg.get_form_template(cid, "tpl_weekly")
    edited.title = "本周工作小结"
    reg.put_form_template(edited)

    second = ensure_builtin_templates(reg, cid)
    assert [t.id for t in second] == ["tpl_weekly"], "重复铸出了第二张同 id 模板"
    assert reg.get_form_template(cid, "tpl_weekly").title == "本周工作小结"


# ==============================================================================================
# 🔴 存储门：题面过红线，答案不过
# ==============================================================================================

# 🔴 题面有**四个**出口：模板 title、字段 label、字段 help、choice 的每一个选项
# （`gate_form_red_line` 的 outbound 就是这四处）。四条都要各自被量到 —— 自审的变异实验证明过：
# 把 outbound 削到只剩 label，整套门依旧全绿。一道门四个出口只有一个被尺子量到，正是本仓
# 「门全绿≠真部件被验到」点名的形态。
_SCORING = "这位同事的绩效评分是多少？"

_RED_LINE_OUTLETS = {
    "title": FormTemplate(context_id="", id="tpl_bad", title=_SCORING,
                          fields=[FormField(id="q1", kind="text", label="本周做完了什么")]),
    "label": FormTemplate(context_id="", id="tpl_bad", title="周报",
                          fields=[FormField(id="q1", kind="text", label=_SCORING)]),
    "help": FormTemplate(context_id="", id="tpl_bad", title="周报",
                         fields=[FormField(id="q1", kind="text", label="本周做完了什么",
                                           help=_SCORING)]),
    "choice": FormTemplate(context_id="", id="tpl_bad", title="周报",
                           fields=[FormField(id="q1", kind="choice", label="挑一个",
                                             choices=["还行", _SCORING])]),
}


@pytest.mark.parametrize("outlet", sorted(_RED_LINE_OUTLETS))
def test_the_storage_door_refuses_a_person_scoring_text_at_every_outlet(
        impl, tmp_path, monkeypatch, outlet):
    import copy
    monkeypatch.delenv("AVERY_ALLOW_PERSON_SCORING", raising=False)
    reg, cid = _ingest_context(impl, tmp_path / "mem")
    tpl = copy.deepcopy(_RED_LINE_OUTLETS[outlet])
    tpl.context_id = cid
    with pytest.raises(ValueError, match="red line"):
        reg.put_form_template(tpl)
    assert reg.get_form_template(cid, "tpl_bad") is None, "被拒的模板不该有任何字节落库"


def test_the_detector_really_fires_on_the_corpus_this_gate_uses(impl, tmp_path, monkeypatch):
    """反向自证：上面四条如果因为**语料不违规**而全绿，那它们量的是空气。这里直接问检测器。"""
    monkeypatch.delenv("AVERY_ALLOW_PERSON_SCORING", raising=False)
    from avery import redline
    assert not redline.validate(_SCORING).passed, "门的语料本身就不违规——上面四条在量空气"
    assert redline.validate("本周做完了什么").passed, "干净题面被误伤，判据太宽"


def test_the_same_label_is_allowed_when_the_operator_switch_is_on(impl, tmp_path, monkeypatch):
    """两档判据复用 feat-033 的同一个开关（公司开关口径，不是红线争议）——不新造机制。"""
    monkeypatch.setenv("AVERY_ALLOW_PERSON_SCORING", "1")
    reg, cid = _ingest_context(impl, tmp_path / "mem")
    tpl = FormTemplate(context_id=cid, id="tpl_switched", title="周报",
                       fields=[FormField(id="q1", kind="text", label="这位同事的绩效评分是多少？")])
    reg.put_form_template(tpl)
    assert reg.get_form_template(cid, "tpl_switched") is not None


def test_a_nul_in_a_template_is_refused_regardless_of_the_switch(impl, tmp_path, monkeypatch):
    monkeypatch.setenv("AVERY_ALLOW_PERSON_SCORING", "1")
    reg, cid = _ingest_context(impl, tmp_path / "mem")
    tpl = FormTemplate(context_id=cid, id="tpl_nul", title="周报",
                       fields=[FormField(id="q1", kind="text", label="本周做完了什么\x00")])
    with pytest.raises(ValueError, match="NUL"):
        reg.put_form_template(tpl)


def test_an_employee_answer_is_NOT_red_line_scanned(impl, tmp_path, monkeypatch):
    """🔴 ADR-0023：回答是员工**本人的声音**，不过红线、不改写。保证在落点——它挂
    (template, submission)，永不挂 avery.entities，所以 0009 的人员键 CHECK 依旧成立。
    这条如果反了，员工写一句带数字的实话就会被系统吞掉。"""
    monkeypatch.delenv("AVERY_ALLOW_PERSON_SCORING", raising=False)
    reg, cid = _ingest_context(impl, tmp_path / "mem")
    reg.put_form_template(weekly_template(cid))
    sub = _minted(cid, "tpl_weekly", "周雅")
    reg.put_form_submission(sub)

    loud = [{"field_id": "done",
             "value": "上个月的绩效评分是 2 分，我不认这个说法，这周把等位时间压下来了。"}]
    assert reg.record_form_answers(sub.share_token, loud, now_iso()) == "ok"
    got = reg.get_form_submission_by_token(sub.share_token)
    assert got.answers[0]["value"] == loud[0]["value"], "员工原话被改写或被吞了"


def test_a_nul_in_a_submission_is_refused(impl, tmp_path):
    reg, cid = _ingest_context(impl, tmp_path / "mem")
    sub = _minted(cid, "tpl_weekly", "周\x00雅")
    with pytest.raises(ValueError, match="NUL"):
        reg.put_form_submission(sub)


# ==============================================================================================
# 提交：铸链即建行、token 解析、答一次锁
# ==============================================================================================

def test_minting_creates_the_row_that_says_this_person_has_not_answered_yet(impl, tmp_path):
    """「谁没交」不是靠名单减法算出来的 —— 铸链那一刻就有一行，answers 是 None。"""
    reg, cid = _ingest_context(impl, tmp_path / "mem")
    reg.put_form_template(weekly_template(cid))
    sub = _minted(cid, "tpl_weekly", "周雅", person_id="P-0007")
    reg.put_form_submission(sub)

    got = reg.get_form_submission_by_token(sub.share_token)
    assert got is not None
    assert got.id == sub.id and got.person_name == "周雅" and got.person_id == "P-0007"
    assert got.period == "2026-W32"
    assert got.answers is None and not got.submitted_at
    assert got.created_at and got.expires_at


def test_unknown_token_resolves_to_none(impl, tmp_path):
    reg, _cid = _ingest_context(impl, tmp_path / "mem")
    assert reg.get_form_submission_by_token("tok_never_minted") is None
    assert reg.get_form_submission_by_token("") is None


def test_record_answers_is_single_lock(impl, tmp_path):
    """首答落地；第二次被拒（'already'）且**首答原封不动**——证据必须稳得住（PRD Q8）。"""
    reg, cid = _ingest_context(impl, tmp_path / "mem")
    reg.put_form_template(weekly_template(cid))
    sub = _minted(cid, "tpl_weekly", "周雅")
    reg.put_form_submission(sub)

    assert reg.record_form_answers(sub.share_token, _ZH_ANSWERS, "2026-08-06T10:00:00+00:00") == "ok"
    second = [{"field_id": "done", "value": "改口了"}, {"field_id": "load", "value": 5}]
    assert reg.record_form_answers(sub.share_token, second,
                                   "2026-08-06T11:00:00+00:00") == "already"

    got = reg.get_form_submission_by_token(sub.share_token)
    assert got.answers == _ZH_ANSWERS, "第二次提交覆盖了首答"
    assert got.submitted_at.startswith("2026-08-06T10:00")


def test_record_answers_on_an_unminted_token_is_unknown(impl, tmp_path):
    reg, _cid = _ingest_context(impl, tmp_path / "mem")
    assert reg.record_form_answers("tok_never_minted", [], now_iso()) == "unknown"
    assert reg.record_form_answers("", [], now_iso()) == "unknown"


def test_chinese_answers_survive_the_jsonb_round_trip_byte_for_byte(impl, tmp_path):
    """（MEMORY：门语料全 ASCII 盲点。）中文原句、全角符号、数字混排，逐字回来。"""
    reg, cid = _ingest_context(impl, tmp_path / "mem")
    reg.put_form_template(weekly_template(cid))
    sub = _minted(cid, "tpl_weekly", "周雅")
    reg.put_form_submission(sub)
    reg.record_form_answers(sub.share_token, _ZH_ANSWERS, now_iso())

    got = reg.get_form_submission_by_token(sub.share_token)
    by_id = {a["field_id"]: a["value"] for a in got.answers}
    assert by_id["done"].startswith("晚市高峰传菜等位超 8 分钟")
    assert by_id["mood"] == "偏紧"
    assert by_id["load"] == 72 and isinstance(by_id["load"], int)


# ==============================================================================================
# 列表：谁交了 / 谁没交
# ==============================================================================================

def test_list_submissions_shows_both_who_answered_and_who_has_not(impl, tmp_path):
    reg, cid = _ingest_context(impl, tmp_path / "mem")
    reg.put_form_template(weekly_template(cid))
    a = _minted(cid, "tpl_weekly", "周雅")
    b = _minted(cid, "tpl_weekly", "陈立")
    reg.put_form_submission(a)
    reg.put_form_submission(b)
    reg.record_form_answers(a.share_token, _ZH_ANSWERS, now_iso())

    rows = {s.person_name: s for s in reg.list_form_submissions(cid)}
    assert set(rows) == {"周雅", "陈立"}
    assert rows["周雅"].answers is not None and rows["周雅"].submitted_at
    assert rows["陈立"].answers is None and not rows["陈立"].submitted_at


def test_list_submissions_can_be_filtered_to_one_template_and_one_company(impl, tmp_path):
    reg, cid = _ingest_context(impl, tmp_path / "mem")
    reg.put_form_template(weekly_template(cid))
    other = FormTemplate(context_id=cid, id="tpl_daily", title="日报",
                         fields=[FormField(id="today", kind="text", label="今天做了什么")])
    reg.put_form_template(other)
    reg.put_form_submission(_minted(cid, "tpl_weekly", "周雅"))
    reg.put_form_submission(_minted(cid, "tpl_daily", "陈立"))

    assert [s.person_name for s in reg.list_form_submissions(cid, "tpl_weekly")] == ["周雅"]
    assert [s.person_name for s in reg.list_form_submissions(cid, "tpl_daily")] == ["陈立"]
    assert len(reg.list_form_submissions(cid)) == 2
    assert reg.list_form_submissions(_new_cid()) == []


# ==============================================================================================
# 持久性（@needs_db，仅 postgres）—— 离线套看不到这一层
# ==============================================================================================

@needs_db
def test_a_minted_link_and_its_answers_survive_a_brand_new_registry_instance(tmp_path):
    """「员工明天再打开这条链接」的真身：另起一个实例/连接，模板、链接、答案都还在。
    （MEMORY：离线套看不到 pg 持久层——这条链只有这一层能抓。）"""
    url = _db_url()
    if not url:
        pytest.skip("needs AVERY_DB_URL (or PGVECTOR_URL)")
    pytest.importorskip("psycopg")
    from avery.ingest.pg_registry import PostgresContextRegistry

    impl = _Impl("postgres", lambda: PostgresContextRegistry(url, data_dir=tmp_path / "data"))
    try:
        reg, cid = _ingest_context(impl, tmp_path / "mem")
        reg.put_form_template(weekly_template(cid))
        sub = _minted(cid, "tpl_weekly", "周雅", person_id="P-0007")
        reg.put_form_submission(sub)
        assert reg.record_form_answers(sub.share_token, _ZH_ANSWERS, now_iso()) == "ok"

        fresh = PostgresContextRegistry(url, data_dir=tmp_path / "data2")
        tpl2 = fresh.get_form_template(cid, "tpl_weekly")
        assert tpl2 is not None and [f.label for f in tpl2.fields][0] == "已完成事实"

        got = fresh.get_form_submission_by_token(sub.share_token)
        assert got is not None, "重启后员工链接解析不出来了"
        assert got.person_name == "周雅" and got.person_id == "P-0007"
        assert {a["field_id"]: a["value"] for a in got.answers}["mood"] == "偏紧"
        assert fresh.record_form_answers(sub.share_token, [], now_iso()) == "already", \
            "答一次锁没跨实例守住"
    finally:
        _pg_cleanup(impl)


@needs_db
def test_deleting_the_context_takes_its_forms_with_it(tmp_path):
    """0013 的 FK ON DELETE CASCADE：demo 克隆的 ephemeral 清扫删 context 时，模板与提交一起走
    （与 company_notes / advise_runs 同一命运）。"""
    url = _db_url()
    if not url:
        pytest.skip("needs AVERY_DB_URL (or PGVECTOR_URL)")
    pytest.importorskip("psycopg")
    from avery.ingest.pg_registry import PostgresContextRegistry

    impl = _Impl("postgres", lambda: PostgresContextRegistry(url, data_dir=tmp_path / "data"))
    reg, cid = _ingest_context(impl, tmp_path / "mem")
    reg.put_form_template(weekly_template(cid))
    sub = _minted(cid, "tpl_weekly", "周雅")
    reg.put_form_submission(sub)
    assert reg.get_form_submission_by_token(sub.share_token) is not None

    reg.delete(cid)
    impl.created.clear()
    fresh = PostgresContextRegistry(url, data_dir=tmp_path / "data2")
    assert fresh.get_form_submission_by_token(sub.share_token) is None
    assert fresh.list_form_templates(cid) == []


# ==============================================================================================
# T9 · gap2 #58 —— 自动补铸的幂等护栏（共有判据 + 真库并发）
# ==============================================================================================

def test_put_if_absent_lands_once_and_reports_the_second_call(impl, tmp_path):
    """共有判据（两个双胞胎都跑）：同一个 `auto_key` 第二次落空，返回 None 且**不覆盖**。"""
    reg, cid = _ingest_context(impl, tmp_path / "mem")
    reg.put_form_template(weekly_template(cid))

    first = _auto(cid, "周雅", person_id="P-0007")
    stored = reg.put_form_submission_if_absent(first)
    assert stored is not None and stored.id == first.id
    assert stored.auto_key == first.auto_key

    second = _auto(cid, "周雅", person_id="P-0007")     # 同一个人同一期 → 同一把 auto_key
    assert second.auto_key == first.auto_key and second.id != first.id
    assert reg.put_form_submission_if_absent(second) is None, "第二次把同一个人又铸了一条"

    rows = reg.list_form_submissions_in_period(cid, "tpl_weekly", "2026-W32")
    assert [r.id for r in rows] == [first.id], "库里多出了一行，或者首行被覆盖了"


def test_the_guard_never_touches_the_manual_path(impl, tmp_path):
    """🔴 手动铸链（auto_key 为空）想铸几条铸几条——「再发一轮」是正当语义。

    库上那条唯一索引是**部分**索引（`WHERE auto_key IS NOT NULL`），手动行连索引都不进。
    这条判据在真库那条腿上还顺带验了一件离线看不见的事：空串必须落成 SQL NULL 而不是 ''，
    否则每一条手动行都带着同一个 '' 撞进索引，经理第二次点「生成本周链接」当场 500。
    """
    reg, cid = _ingest_context(impl, tmp_path / "mem")
    reg.put_form_template(weekly_template(cid))
    for _ in range(3):
        assert reg.put_form_submission(_minted(cid, "tpl_weekly", "周雅", person_id="P-0007"))
    rows = reg.list_form_submissions_in_period(cid, "tpl_weekly", "2026-W32")
    assert len(rows) == 3 and all(r.auto_key == "" for r in rows)


def test_voiding_an_open_link_is_atomic_against_a_racing_submit(impl, tmp_path):
    """作废只落在 `submitted_at IS NULL` 的那一行 —— 已提交的答案永远赢。"""
    reg, cid = _ingest_context(impl, tmp_path / "mem")
    reg.put_form_template(weekly_template(cid))
    sub = _minted(cid, "tpl_weekly", "周雅")
    reg.put_form_submission(sub)

    assert reg.expire_form_submission(sub.id, now_iso()) == "ok"
    assert reg.expire_form_submission("sub_nope", now_iso()) == "unknown"

    other = _minted(cid, "tpl_weekly", "陈立")
    reg.put_form_submission(other)
    assert reg.record_form_answers(other.share_token, _ZH_ANSWERS, now_iso()) == "ok"
    assert reg.expire_form_submission(other.id, now_iso()) == "already", \
        "作废改动了一条已经交上来的证据"
    got = reg.get_form_submission(other.id)
    assert got.submitted_at and got.answers, "已提交行被作废动过"


@needs_db
def test_two_concurrent_autofills_mint_exactly_one_link_per_person(tmp_path):
    """🔴 事务级护栏的**唯一**真证明：两条独立连接同时抢同一把 `auto_key`。

    离线内存双胞胎在这件事上什么都证明不了（单进程、一次字典查改），硬在那边"证明"就是一条假绿
    ——所以这条判据只在真库上跑。挡的是先查后插挡不住的那一幕：两个请求都查到「本期没有行」，
    然后各自建行，员工手机上收到两条一模一样的链接。

    并发用真线程 + 每线程一个**独立 registry 实例**（各自的连接池），不是同一个连接上的两次调用
    ——后者根本进不了竞争态，是一条看起来在测并发、实际在测顺序调用的假门。
    """
    url = _db_url()
    if not url:
        pytest.skip("needs AVERY_DB_URL (or PGVECTOR_URL)")
    pytest.importorskip("psycopg")
    from concurrent.futures import ThreadPoolExecutor
    from avery.ingest.pg_registry import PostgresContextRegistry

    impl = _Impl("postgres", lambda: PostgresContextRegistry(url, data_dir=tmp_path / "data"))
    try:
        reg, cid = _ingest_context(impl, tmp_path / "mem")
        reg.put_form_template(weekly_template(cid))

        racers = [PostgresContextRegistry(url, data_dir=tmp_path / f"c{i}") for i in range(4)]
        rows = [_auto(cid, "周雅", person_id="P-0007") for _ in range(4)]
        # 四把钥匙必须是同一把，否则这条门测的是四个不同的人，恒绿。
        assert len({r.auto_key for r in rows}) == 1

        with ThreadPoolExecutor(max_workers=4) as pool:
            outcomes = list(pool.map(lambda pair: pair[0].put_form_submission_if_absent(pair[1]),
                                     zip(racers, rows)))

        winners = [o for o in outcomes if o is not None]
        assert len(winners) == 1, (
            f"四条并发补铸里活下来 {len(winners)} 条——护栏不是事务级的，"
            f"周雅手机上会收到 {len(winners)} 条链接")
        persisted = reg.list_form_submissions_in_period(cid, "tpl_weekly", "2026-W32")
        assert len(persisted) == 1 and persisted[0].id == winners[0].id
    finally:
        _pg_cleanup(impl)


def _auto(cid: str, name: str, *, person_id: str = "", period: str = "2026-W32") -> FormSubmission:
    """一条**自动补铸**形状的行：带 auto_key，其余与手动行同形。"""
    created = now_iso()
    return FormSubmission(
        id=new_submission_id(), context_id=cid, template_id="tpl_weekly",
        person_id=person_id, person_name=name, period=period,
        share_token="tok_auto_" + uuid.uuid4().hex,
        created_at=created, expires_at=default_expiry(created),
        auto_key=auto_mint_key("tpl_weekly", period, person_id, name))
