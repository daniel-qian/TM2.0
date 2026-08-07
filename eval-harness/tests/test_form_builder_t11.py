# -*- coding: utf-8 -*-
"""gap2 T11 · 模板拼装器的后端门（离线全套：mock brain / heuristic / 内存 registry / 零网络）。

这一票动了模板的**生命周期**：经理能建表、改表、停用某一格、让 Avery 读旧表格起草。四件事各自
带一条容易静默失灵的腿，本文件逐条钉死：

 ① **控件**：新增 `yesno`（快问的姊妹实现——线上 `yes`/`no`、库里 bool、眼前的字是本地化文案）；
    「1~5 分」= number 收窄 min/max，窄档渲染成一排按钮而不是滑杆。
 ② **自述识别结构化**：哪一格是负载/情绪由 `FormField.self_report` 说了算，不再靠正则认 label
    文案。两条判据都在：**改了题面照样上卡** / **没标记的数字题绝不上卡**。
 ③ **历史不可篡改**：已经有人交过答案的 `field.id` 禁改禁删（只许停用），服务端是最后一道门。
 ④ **起草是提案不落库**，且经理点确认那一刻不许吃 422（红线在起草层就落地）。

⚠ 语料含中文字节是故意的（MEMORY：门语料全 ASCII 盲点）——题面、选项、答案全是中文。
⚠ 编排纪律沿用 `test_form_reflow_a2.py` 的三条：回流类判据一律**穿过** `append_submission_to_context`
   断言，判据打在**卡面**（`team_cards()`）而不是实体上，语料必须真带中文。
"""
from __future__ import annotations

from dataclasses import asdict
from pathlib import Path

import pytest

pytest.importorskip("fastapi.testclient")
from fastapi.testclient import TestClient  # noqa: E402

from avery.brain import BrainResponse  # noqa: E402
from avery.ingest.form import (  # noqa: E402
    FIELD_KINDS, MAX_FIELDS, MAX_STORED_FIELDS,
    FormField, FormSubmission, FormTemplate,
    answered_field_ids, backfill_builtin_markers, gate_used_fields, live_fields,
    parse_submitted_answers, validate_template_shape, weekly_template,
)

HERE = Path(__file__).resolve().parent.parent
FIX = HERE / "tests" / "fixtures" / "ingest"
HANDBOOK = FIX / "Studio_Handbook.md"

W32 = "2026-08-07T09:00:00+00:00"


@pytest.fixture()
def client(monkeypatch):
    monkeypatch.setenv("AVERY_BRAIN", "mock")
    monkeypatch.setenv("AVERY_EXTRACTOR", "heuristic")
    # 三件套缺一真烧钱（MEMORY：门电池全离线配置）。
    monkeypatch.setenv("AVERY_EMBEDDINGS", "keyword")
    monkeypatch.delenv("AVERY_DB_URL", raising=False)
    monkeypatch.delenv("PGVECTOR_URL", raising=False)
    monkeypatch.delenv("AVERY_ALLOW_PERSON_SCORING", raising=False)
    monkeypatch.delenv("AVERY_RATE_SHARE_PER_MIN", raising=False)
    from avery.ingest.registry import REGISTRY
    REGISTRY.clear()
    from service import upload_guard
    upload_guard.reset_rate_limiter()
    from service.app import app
    with TestClient(app) as c:
        yield c
    REGISTRY.clear()


def _auth(tok: str) -> dict:
    return {"X-Avery-Token": tok}


def _company(client) -> tuple[str, str]:
    files = [("files", (HANDBOOK.name, HANDBOOK.read_bytes(), "application/octet-stream"))]
    ing = client.post("/ingest", files=files).json()
    return ing["context_id"], ing["owner_token"]


def _save(client, cid, tok, template: dict):
    return client.post(f"/team/{cid}/forms", json=template, headers=_auth(tok))


def _field(fid, kind="text", label=None, **kw) -> dict:
    body = {"id": fid, "kind": kind, "label": label or f"题面-{fid}"}
    body.update(kw)
    return body


def _mint_and_submit(client, cid, tok, template_id, answers: dict,
                     name="周雅", person_id="P-0007") -> str:
    r = client.post(f"/team/{cid}/forms/{template_id}/links",
                    json={"recipients": [{"id": person_id, "name": name}]}, headers=_auth(tok))
    assert r.status_code == 200, r.text
    token = r.json()["links"][0]["token"]
    posted = client.post(f"/f/{token}/submit", data=answers)
    assert posted.status_code == 200, posted.text
    return token


# ==============================================================================================
# ① 控件：yesno 与 1~5 分
# ==============================================================================================

def test_yesno_is_a_field_kind_with_a_renderer():
    """启动期一致性断言（form_api.py 的 `_FIELD_RENDERERS` != `FIELD_KINDS` 就 RuntimeError）
    是真在跑的——本条同时钉住「词表里有 yesno」和「它有渲染函数」。"""
    from service.form_api import _FIELD_RENDERERS
    assert "yesno" in FIELD_KINDS
    assert set(_FIELD_RENDERERS) == set(FIELD_KINDS), "加了 kind 却没给渲染函数"


def test_a_yesno_answer_is_stored_as_a_bool_not_as_the_word_on_screen():
    """线上恒是 ASCII 的 yes/no，落库折成 bool。

    🔴 为什么不存「是」这两个字：同一张表在中文壳和英文壳上答的「是」/「Yes」会是两个不同的
    字符串，跨期对比时当成两个词。快问那边（ask_api.py:606-608）已经是这条口径。"""
    t = FormTemplate(context_id="c", id="tpl_x", title="小表",
                     fields=[FormField(id="need", kind="yesno", label="是否需要支援")])
    answers, err = parse_submitted_answers(t, {"f_need": "yes"}.get)
    assert err is None and answers == [{"field_id": "need", "value": True}]
    answers, err = parse_submitted_answers(t, {"f_need": "no"}.get)
    assert answers == [{"field_id": "need", "value": False}]
    # 「是」不是线上值——只有 yes/no 两个词算数。
    assert parse_submitted_answers(t, {"f_need": "是"}.get)[1] is not None
    assert parse_submitted_answers(t, {"f_need": "true"}.get)[1] is not None


def test_an_optional_yesno_left_blank_produces_no_entry_at_all():
    """absent ≠ 空：没答的选填格**不产出条目**（与 text/choice 同一条纪律）。"""
    t = FormTemplate(context_id="c", id="tpl_x", title="小表",
                     fields=[FormField(id="need", kind="yesno", label="是否需要支援",
                                       required=False)])
    assert parse_submitted_answers(t, {}.get) == ([], None)


def test_the_employee_page_renders_yesno_as_two_buttons_with_localized_words(client):
    cid, tok = _company(client)
    assert _save(client, cid, tok, {
        "title": "值班交接", "fields": [_field("need", "yesno", "是否需要支援")]}).status_code == 200
    tpl = _save(client, cid, tok, {
        "title": "值班交接", "id": "tpl_duty",
        "fields": [_field("need", "yesno", "是否需要支援")]}).json()["template"]
    r = client.post(f"/team/{cid}/forms/{tpl['id']}/links",
                    json={"recipients": [{"id": "P-1", "name": "周雅"}]}, headers=_auth(tok))
    token = r.json()["links"][0]["token"]

    zh = client.get(f"/f/{token}").text
    assert 'value="yes"' in zh and 'value="no"' in zh, "线上值必须是 ASCII 的 yes/no"
    assert ">是<" in zh and ">否<" in zh, "中文壳上员工看到的应该是「是 / 否」"
    assert 'class="h5-yn"' in zh, "复用既有的按钮组 CSS，不新加一份"
    en = client.get(f"/f/{token}?lang=en").text
    assert 'value="yes"' in en and ">Yes<" in en and ">No<" in en
    assert "是" not in en.split("<style>")[0], "英文壳上不该出现中文按钮文案"


def test_a_one_to_five_number_renders_as_buttons_and_a_wide_one_stays_a_slider(client):
    """「1~5 分」不是新 kind——是 number 收窄 min/max。窄档给按钮：滑杆**恒有值**，
    一格选填的滑杆照样会交上来一个没人选过的数。"""
    cid, tok = _company(client)
    tpl = _save(client, cid, tok, {
        "title": "本周自评", "id": "tpl_scale", "fields": [
            _field("conf", "number", "这件事你有多大把握做完", min=1, max=5),
            _field("load", "number", "负载自述", min=0, max=100),
        ]}).json()["template"]
    r = client.post(f"/team/{cid}/forms/{tpl['id']}/links",
                    json={"recipients": [{"id": "P-1", "name": "周雅"}]}, headers=_auth(tok))
    page = client.get(f"/f/{r.json()['links'][0]['token']}").text
    assert 'class="h5-scale"' in page, "1~5 应该是一排按钮（复用快问那套 CSS）"
    for v in range(1, 6):
        assert f'name="f_conf" value="{v}"' in page
    assert 'name="f_conf" value="0"' not in page, "档位不该越过 min"
    assert 'type="range" name="f_load"' in page, "0..100 这种宽档仍然是滑杆"


def test_a_number_answer_outside_the_narrowed_range_is_refused():
    t = FormTemplate(context_id="c", id="t", title="表",
                     fields=[FormField(id="conf", kind="number", label="把握", min=1, max=5)])
    assert parse_submitted_answers(t, {"f_conf": "3"}.get)[0] == [{"field_id": "conf", "value": 3}]
    assert parse_submitted_answers(t, {"f_conf": "6"}.get)[1] is not None
    assert parse_submitted_answers(t, {"f_conf": "0"}.get)[1] is not None


# ==============================================================================================
# ① 停用：不再问，但历史答案仍对得上号
# ==============================================================================================

def test_a_retired_field_is_not_asked_and_not_parsed(client):
    cid, tok = _company(client)
    tpl = _save(client, cid, tok, {
        "title": "值班交接", "id": "tpl_duty", "fields": [
            _field("now", "text", "这一班有什么要交代的"),
            _field("old", "text", "上一版才问的那格", retired=True),
        ]}).json()["template"]
    r = client.post(f"/team/{cid}/forms/{tpl['id']}/links",
                    json={"recipients": [{"id": "P-1", "name": "周雅"}]}, headers=_auth(tok))
    token = r.json()["links"][0]["token"]
    page = client.get(f"/f/{token}").text
    assert "这一班有什么要交代的" in page
    assert "上一版才问的那格" not in page, "停用的格还在问员工"
    assert 'name="f_old"' not in page

    # 就算有人手搓一个 f_old 塞进 POST 体，它也不会变成一条答案。
    client.post(f"/f/{token}/submit", data={"f_now": "冷库门没关严，已经报修。", "f_old": "偷渡"})
    subs = client.get(f"/team/{cid}/forms/submissions", headers=_auth(tok)).json()["submissions"]
    got = [a["field_id"] for a in subs[0]["answers"]]
    assert got == ["now"], f"停用的格收下了答案：{got}"


def test_the_twelve_question_cap_counts_what_is_asked_not_what_is_stored():
    """MAX_FIELDS 是「在问几格」的上限——停用的格不占名额（否则一张只增不减的表很快就动不了）。
    但存着的总数仍有界，一行 JSONB 不能无限长。"""
    asked = [FormField(id=f"q{i}", kind="text", label=f"第{i}题") for i in range(MAX_FIELDS)]
    gone = [FormField(id=f"r{i}", kind="text", label=f"停用{i}", retired=True)
            for i in range(MAX_FIELDS)]
    t = FormTemplate(context_id="c", id="t", title="表", fields=asked + gone)
    assert len(live_fields(t)) == MAX_FIELDS
    assert validate_template_shape(t) is None, "停用的格不该占用「12 题」的名额"

    over = FormTemplate(context_id="c", id="t", title="表",
                        fields=asked + [FormField(id="one_more", kind="text", label="第十三题")])
    assert "1 to 12" in (validate_template_shape(over) or ""), "在问的格数越界没被拦住"

    too_many = FormTemplate(context_id="c", id="t", title="表",
                            fields=asked + gone + [FormField(id="x", kind="text", label="超",
                                                             retired=True)])
    assert len(too_many.fields) > MAX_STORED_FIELDS
    assert "including retired" in (validate_template_shape(too_many) or "")


def test_a_form_with_only_retired_fields_is_refused():
    """一张一格都不问的表不是表——它是一个点开只有标题的空白页。"""
    t = FormTemplate(context_id="c", id="t", title="表",
                     fields=[FormField(id="a", kind="text", label="旧题", retired=True)])
    assert validate_template_shape(t) is not None


# ==============================================================================================
# ② 三个语义开关：落点判据（标了却读不到 = 静默失灵，这一族最贵的失败）
# ==============================================================================================

@pytest.mark.parametrize("field, needle", [
    (FormField(id="a", kind="number", label="数", situational=True), "only a free-text"),
    (FormField(id="a", kind="choice", label="选", choices=["甲", "乙"], situational=True),
     "only a free-text"),
    (FormField(id="a", kind="text", label="忙不忙", self_report="load"), "not number"),
    (FormField(id="a", kind="number", label="忙不忙", min=1, max=5, self_report="load"),
     "reads 0..100"),
    (FormField(id="a", kind="number", label="心情", self_report="mood"), "not choice"),
    (FormField(id="a", kind="text", label="心情", self_report="mood"), "not choice"),
    (FormField(id="a", kind="text", label="随便", self_report="vibes"), "unknown self-report"),
])
def test_a_switch_that_the_reflow_layer_could_never_read_is_refused(field, needle):
    """开关标在读不到它的 kind 上 = 死开关。界面上像标成功了、卡上永远不长东西、还不报错——
    所以这里 422，不许静默无视。"""
    t = FormTemplate(context_id="c", id="t", title="表", fields=[field])
    assert needle in (validate_template_shape(t) or ""), validate_template_shape(t)


def test_two_fields_cannot_claim_the_same_self_report_slot():
    """人卡上负载只有一格。两格都标 load，「哪个数上卡」没有正确答案。"""
    t = FormTemplate(context_id="c", id="t", title="表", fields=[
        FormField(id="a", kind="number", label="忙碌自述", self_report="load"),
        FormField(id="b", kind="number", label="工作量自述", self_report="load"),
    ])
    assert "both claim" in (validate_template_shape(t) or "")


def test_the_builtin_weekly_carries_the_two_markers():
    t = weekly_template("c")
    slots = {f.id: f.self_report for f in t.fields}
    assert slots["load"] == "load" and slots["mood"] == "mood"
    assert all(not slots[k] for k in ("done", "missed", "next_goal", "support"))
    assert validate_template_shape(t) is None


# ==============================================================================================
# ② 回流：改了题面照样上卡 / 没标记的数字题绝不上卡（票面两条判据）
# ==============================================================================================

def _person(cid, person_name="周雅"):
    """这家公司花名册上那个人（实体）。

    ⚠ 自述读数**故意**不从 `/team` 的卡面读：卡面投影由 `AVERY_ALLOW_PERSON_SCORING` 在
    `registry.team_cards()` 那一处决定（命门③，存储恒有、显示随开关），而本 fixture 把开关删了。
    拿卡面当判据会让这几条门在开关关着的时候恒绿——量的是开关，不是本票改的那条腿。
    卡面投影本身另有 `test_form_reflow_a2` 那条门在钉。"""
    from avery.ingest.registry import REGISTRY
    people = REGISTRY.get(cid).extraction.people
    for p in people:
        if p.name == person_name:
            return p
    raise AssertionError(f"花名册上没有 {person_name}：{[p.name for p in people]}")


def test_a_renamed_self_report_question_still_lands_on_the_card(client):
    """🔴 票面判据其一。经理把「负载自述」改成「这一周有多忙」——认文案的老正则到这里就断了，
    认结构的标记照旧读到。"""
    cid, tok = _company(client)
    tpl = _save(client, cid, tok, {
        "title": "周报", "id": "tpl_renamed", "fields": [
            _field("busy", "number", "这一周有多忙", min=0, max=100, self_report="load"),
            _field("feel", "choice", "这一周状态怎么样", choices=["如常", "偏紧", "吃紧"],
                   self_report="mood"),
        ]}).json()["template"]
    _mint_and_submit(client, cid, tok, tpl["id"], {"f_busy": "85", "f_feel": "吃紧"})

    her = _person(cid)
    assert her.self_report is not None, "改了题面，读数就不上卡了"
    assert her.self_report.load.value == 85
    assert her.self_report.mood.value == "strained"
    assert her.self_report.load.caliber == "本人自述", "口径不是「本人自述」"
    # 出处仍指着资料库里那一行（`<source_key>:<行号>`，与上传文件同一条引用契约）。
    from avery.ingest.registry import REGISTRY
    sd = REGISTRY.get(cid).source_documents[-1]
    body = sd.content.decode("utf-8").splitlines()
    key, _, line = her.self_report.load.source.rpartition(":")
    assert key == sd.source_key
    assert "85" in body[int(line) - 1] and "周雅" in body[int(line) - 1], "出处指着一行没有它的文本"


def test_an_unmarked_number_question_never_climbs_onto_a_card(client):
    """🔴 票面判据其二。一格叫「产能自述」的数字题，只要没标记，那个数就不上卡。

    这正是老正则的反向失败：它认 label 里的「××自述」四个字，所以这一格在改这条腿之前
    **会**爬上人卡——一个经理从没打算公布的数字。"""
    cid, tok = _company(client)
    tpl = _save(client, cid, tok, {
        "title": "产能表", "id": "tpl_unmarked", "fields": [
            _field("cap", "number", "产能自述", min=0, max=100),
            _field("note", "text", "这一周有什么要说的"),
        ]}).json()["template"]
    _mint_and_submit(client, cid, tok, tpl["id"],
                     {"f_cap": "93", "f_note": "冷库门没关严，已经报修。"})

    assert _person(cid).self_report is None, "没标记的数字题爬上了人卡"
    # 资料本身照旧逐字有它——不上卡不等于不入库（议事室照旧引得到）。
    files = client.get(f"/team/{cid}/files", headers=_auth(tok)).json()["files"]
    assert any(f["filename"].startswith("产能表-") for f in files)


def test_a_text_only_form_still_grows_a_situational_signal(client):
    """一张**全是自由文本**的自建表：一条自述都没有，情境信号照样该长出来。

    改这条腿之前「读不出自述」会把信号一起收手（那时候两件事恒是同一件，因为内置周报总带
    load/mood 两格）。拼装器让这种表成为常态，所以身份与读数在回流层分成了两段。"""
    cid, tok = _company(client)
    tpl = _save(client, cid, tok, {
        "title": "值班交接", "id": "tpl_text_only", "fields": [
            _field("stuck", "text", "这一班哪儿卡住了", situational=True),
        ]}).json()["template"]
    _mint_and_submit(client, cid, tok, tpl["id"], {"f_stuck": "洗碗机坏了，晚市全靠手洗。"})

    body = client.get(f"/team/{cid}", headers=_auth(tok)).json()
    mine = [s for s in body.get("signals", []) if "洗碗机" in (s.get("summary") or "")]
    assert mine, f"全文本表没长出情境信号：{[s.get('summary') for s in body.get('signals', [])]}"
    assert mine[0].get("sourceRef"), "情境信号没有出处"


def test_a_reading_with_no_line_of_the_document_behind_it_is_dropped():
    """取证闸（0807 HITL 那道的同族）：出处那一行必须真写着名字 + 题面 + 值。

    今天渲染器自己交行号、结构上不会错——判据不能建立在「今天的渲染器不会错」上。渲染器与回流
    是两段可以各自改的代码，这道闸是它们之间那份可执行的合同。"""
    from avery.ingest.form_reflow import stub_person_from_submission
    from avery.ingest.parse import ParsedDoc
    doc = ParsedDoc(name="周报.md#s1", ext="md",
                    text="# 周报\n\n记录ID：s1\n\n## 本人自述\n\n周雅｜负载自述：72\n")
    tpl = weekly_template("c")
    sub = FormSubmission(id="s1", context_id="c", template_id=tpl.id, person_name="周雅",
                         submitted_at=W32, answers=[{"field_id": "load", "value": 72}])
    # 行号从文档本身推，不写死一个魔数（同 test_form_reflow_a2._line_of 的理由）。
    real = next(i for i, ln in enumerate(doc.lines, 1) if "负载自述：72" in ln)
    assert stub_person_from_submission(doc, tpl, sub, {"load": real}).self_report.load.value == 72
    # 行号指到一行**没有**这个读数的文本上 —— 丢掉，不是照收。
    assert stub_person_from_submission(doc, tpl, sub, {"load": 3}) is None
    assert stub_person_from_submission(doc, tpl, sub, {"load": 999}) is None


# ==============================================================================================
# ② 存量回填：库里那张老 tpl_weekly 也要认得新标记
# ==============================================================================================

def test_a_template_already_in_the_library_gains_the_markers_on_the_next_read(client):
    """`ensure_builtin_templates` 见到已存在就原样复用（题面必须被快照住），所以给内置模板加的
    新标记**只对新公司生效**——生产上任何点开过一次表单页的公司，库里那张 tpl_weekly 是老快照。
    不回填 = 新开关在那些公司上静默失灵，且没有一道门会红。"""
    from avery.ingest.registry import REGISTRY
    cid, tok = _company(client)
    client.get(f"/team/{cid}/forms", headers=_auth(tok))          # 铸出内置周报
    # 造一份「T11 之前铸的」快照：把两个标记抹掉。
    old = REGISTRY.get_form_template(cid, "tpl_weekly")
    for f in old.fields:
        f.self_report = ""
    REGISTRY.put_form_template(old)

    fresh = client.get(f"/team/{cid}/forms", headers=_auth(tok)).json()["templates"]
    slots = {f["id"]: f["self_report"] for f in fresh[0]["fields"]}
    assert slots["load"] == "load" and slots["mood"] == "mood", "存量模板没被回填"
    assert REGISTRY.get_form_template(cid, "tpl_weekly").fields[4].self_report == "load", \
        "回填只改了返回值，没落库"


def test_the_backfill_keeps_its_hands_off_a_question_the_manager_touched():
    """判据是「这一格还没被经理接管」。题面改过 = 老正则**本来就已经读不到了**，这里不补 =
    保持它今天的行为，把要不要上卡交回给经理在拼装器里勾——补上才是替他断言。"""
    fresh = weekly_template("c")
    stored = weekly_template("c")
    for f in stored.fields:
        f.self_report = ""
    stored.fields[4].label = "这一周有多忙"          # 经理改过题面的那一格
    stored.fields[5].self_report = "load"            # 经理自己标过的那一格
    touched = backfill_builtin_markers(stored, fresh)

    assert touched == [], "改过题面 / 已经自己标过的格被回填覆盖了"
    assert stored.fields[4].self_report == ""
    assert stored.fields[5].self_report == "load", "经理自己标的槽被内置版盖掉了"


# ==============================================================================================
# ③ 历史不可篡改：已被引用的 field.id 禁改禁删（服务端是最后一道门）
# ==============================================================================================

@pytest.fixture()
def answered(client):
    """一张已经有人交过一份答案的自建表。返回 (cid, tok, template_id)。"""
    cid, tok = _company(client)
    _save(client, cid, tok, {"title": "值班交接", "id": "tpl_duty", "fields": [
        _field("hand", "text", "这一班要交代什么"),
        _field("stuck", "text", "哪儿卡住了", situational=True),
    ]})
    _mint_and_submit(client, cid, tok, "tpl_duty",
                     {"f_hand": "冷库门没关严，已经报修。", "f_stuck": "洗碗机还没修好。"})
    return cid, tok, "tpl_duty"


def test_deleting_an_answered_field_is_refused(answered, client):
    cid, tok, tid = answered
    r = _save(client, cid, tok, {"title": "值班交接", "id": tid,
                                 "fields": [_field("hand", "text", "这一班要交代什么")]})
    assert r.status_code == 422, r.text
    assert "'stuck'" in r.json()["detail"]["reason"], r.json()
    assert "retired but not deleted" in r.json()["detail"]["reason"]


def test_changing_the_kind_of_an_answered_field_is_refused(answered, client):
    """同一个格里躺着的一句话，换成 number 之后会被当成一个数。"""
    cid, tok, tid = answered
    r = _save(client, cid, tok, {"title": "值班交接", "id": tid, "fields": [
        _field("hand", "text", "这一班要交代什么"),
        _field("stuck", "number", "哪儿卡住了", min=0, max=10),
    ]})
    assert r.status_code == 422 and "'stuck'" in r.json()["detail"]["reason"]


def test_retiring_renaming_and_adding_all_stay_allowed(answered, client):
    """禁的是**篡改**，不是编辑。停用 / 改题面 / 加题都照旧——否则这张表只能烂在那儿。"""
    cid, tok, tid = answered
    r = _save(client, cid, tok, {"title": "值班交接（新版）", "id": tid, "fields": [
        _field("hand", "text", "这一班有什么要交代的"),                 # 改题面
        _field("stuck", "text", "哪儿卡住了", situational=True, retired=True),   # 停用
        _field("who", "text", "接班的是谁"),                            # 加题
    ]})
    assert r.status_code == 200, r.text
    # 老答案仍然对得上号：它按 field.id 落，那个 id 还在。
    subs = client.get(f"/team/{cid}/forms/submissions", headers=_auth(tok)).json()["submissions"]
    assert {a["field_id"] for a in subs[0]["answers"]} == {"hand", "stuck"}


def test_a_form_nobody_answered_yet_can_still_be_reshaped_freely(client):
    """还没人交过 = 没有历史可篡改。这道门不许连「改还没发出去的草稿」也一起禁掉。"""
    cid, tok = _company(client)
    _save(client, cid, tok, {"title": "草稿", "id": "tpl_draft",
                             "fields": [_field("a", "text", "第一版的题")]})
    r = _save(client, cid, tok, {"title": "草稿", "id": "tpl_draft",
                                 "fields": [_field("b", "number", "彻底换一题", min=0, max=10)]})
    assert r.status_code == 200, r.text


def test_the_used_field_gate_is_a_pure_function_over_what_was_answered():
    """把门本身单独量一遍（HTTP 那几条量的是它接对了没）。"""
    stored = FormTemplate(context_id="c", id="t", title="表", fields=[
        FormField(id="a", kind="text", label="甲"), FormField(id="b", kind="text", label="乙")])
    assert gate_used_fields(None, stored, {"a"}) is None, "新表没有历史"
    assert gate_used_fields(stored, stored, set()) is None, "没人交过就没有约束"
    keep = FormTemplate(context_id="c", id="t", title="表", fields=[
        FormField(id="a", kind="text", label="改过的甲", retired=True),
        FormField(id="b", kind="text", label="乙")])
    assert gate_used_fields(stored, keep, {"a"}) is None, "停用被误判成删除"
    gone = FormTemplate(context_id="c", id="t", title="表",
                        fields=[FormField(id="b", kind="text", label="乙")])
    assert gate_used_fields(stored, gone, {"a"}) is not None


def test_answered_field_ids_reads_only_answers_that_exist():
    """没交的那条链是 status='open' 的**行**（铸链即建行），它的 answers 是 None——
    不该把它算成「这一格被引用过」。"""
    open_row = FormSubmission(id="s1", context_id="c", template_id="t")
    done = FormSubmission(id="s2", context_id="c", template_id="t",
                          answers=[{"field_id": "a", "value": "话"}])
    assert answered_field_ids([open_row, done]) == {"a"}
    assert answered_field_ids([]) == set()


# ==============================================================================================
# ③ HTTP 往返：三个开关一个都不许被静默抹平
# ==============================================================================================

def test_every_field_attribute_survives_the_http_round_trip(client):
    """🔴 这条门的由来是一次真事故：`situational` 当年**加在了 FormFieldIn 上、`save_form` 里却
    没往回传**。那时前端一个调用者都没有，所以没人踩到；本票让经理真能存模板，它当场就会发作
    ——经理存一次，内置周报的两个 situational 被抹平，T5 的回流从此不响且不报错。

    判据故意是「asdict 全量比对」而不是手写元组：手写元组会在下一次加字段时再漏一个
    （`test_form_store_contract` 那条号称 every-attribute 的门就是这么漏掉 situational 的）。"""
    cid, tok = _company(client)
    sent = {"title": "全开关表", "id": "tpl_all", "fields": [
        _field("stuck", "text", "哪儿卡住了", help="随便写", required=False, situational=True),
        _field("busy", "number", "这一周有多忙", min=0, max=100, self_report="load"),
        _field("feel", "choice", "状态", choices=["如常", "偏紧", "吃紧"], self_report="mood"),
        _field("gone", "text", "上一版的题", retired=True),
    ]}
    got = _save(client, cid, tok, sent).json()["template"]
    for want, back in zip(sent["fields"], got["fields"]):
        for key, value in want.items():
            assert back[key] == value, f"{want['id']}.{key} 在往返里被改成了 {back[key]!r}"
    # 再读一次（这次经过存储层），三个开关仍在。
    again = client.get(f"/team/{cid}/forms", headers=_auth(tok)).json()["templates"]
    mine = [t for t in again if t["id"] == "tpl_all"][0]
    assert [f["situational"] for f in mine["fields"]] == [True, False, False, False]
    assert [f["self_report"] for f in mine["fields"]] == ["", "load", "mood", ""]
    assert [f["retired"] for f in mine["fields"]] == [False, False, False, True]


def test_the_stored_dataclass_holds_exactly_what_the_payload_said(client):
    """投影层（asdict）与 dataclass 之间不许有第三种形状。"""
    cid, tok = _company(client)
    _save(client, cid, tok, {"title": "表", "id": "tpl_one", "fields": [
        _field("stuck", "text", "哪儿卡住了", situational=True)]})
    from avery.ingest.registry import REGISTRY
    stored = REGISTRY.get_form_template(cid, "tpl_one")
    assert asdict(stored.fields[0]) == {
        "id": "stuck", "kind": "text", "label": "哪儿卡住了", "help": "", "required": True,
        "choices": [], "min": 0, "max": 100, "situational": True, "self_report": "",
        "retired": False}


# ==============================================================================================
# ① 资料文档：yesno 不许在客户的资料里印出 True
# ==============================================================================================

def test_a_yesno_answer_reads_as_chinese_in_the_filed_document(client):
    """落库存 bool，渲染进资料时翻成是/否——`str(True)` 是 `'True'`，直接进文档就是在客户的
    资料里印一个英文关键字（下载下来的原件、议事室引用里都是它）。"""
    cid, tok = _company(client)
    _save(client, cid, tok, {"title": "值班交接", "id": "tpl_duty", "fields": [
        _field("need", "yesno", "是否需要支援"),
        _field("hand", "text", "这一班要交代什么")]})
    _mint_and_submit(client, cid, tok, "tpl_duty",
                     {"f_need": "yes", "f_hand": "冷库门没关严，已经报修。"})
    from avery.ingest.registry import REGISTRY
    body = REGISTRY.get(cid).source_documents[-1].content.decode("utf-8")
    assert "## 是否需要支援" in body and "\n是\n" in body, body
    assert "True" not in body, "客户的资料里印出了 True"


def test_an_unmarked_number_does_not_move_into_the_self_report_section(client):
    """「本周直播场次：12」是一条普通读数。把它塞进「本人自述」那一节，是给它安一个它没有的
    身份——而那一节正是解析层认自述行的地方。"""
    cid, tok = _company(client)
    _save(client, cid, tok, {"title": "运营周报", "id": "tpl_ops", "fields": [
        _field("shows", "number", "本周直播场次", min=0, max=100),
        _field("busy", "number", "负载自述", min=0, max=100, self_report="load")]})
    _mint_and_submit(client, cid, tok, "tpl_ops", {"f_shows": "12", "f_busy": "70"})
    from avery.ingest.registry import REGISTRY
    body = REGISTRY.get(cid).source_documents[-1].content.decode("utf-8")
    head, _, tail = body.partition("## 本人自述")
    assert "## 本周直播场次" in head, "普通读数没有自己的一节"
    assert "本周直播场次" not in tail, "普通读数被塞进了自述行"
    assert "周雅｜负载自述：70" in tail


def test_the_builtin_weekly_still_renders_byte_for_byte_as_before():
    """渲染契约没变：内置周报只有 load/mood 两格非文本且都带标记，所以这一票对它一个字节都没动。"""
    from avery.ingest.form_append import render_submission_markdown
    tpl = weekly_template("c")
    sub = FormSubmission(id="sub_1", context_id="c", template_id=tpl.id, person_name="周雅",
                         person_id="P-0007", period="2026-W32", submitted_at=W32, answers=[
                             {"field_id": "done", "value": "开了三场直播。"},
                             {"field_id": "missed", "value": "复盘没做完。"},
                             {"field_id": "next_goal", "value": "补复盘。"},
                             {"field_id": "load", "value": 72},
                             {"field_id": "mood", "value": "偏紧"}])
    md = render_submission_markdown(tpl, sub)
    assert md.endswith("## 本人自述\n\n周雅｜负载自述：72｜情绪自述：偏紧\n")
    assert "## 已完成事实\n\n开了三场直播。" in md


# ==============================================================================================
# ④ 起草：提案不落库、红线在起草层落地、降级诚实
# ==============================================================================================

_OLD_SHEET = (
    "本周工作汇报表\n\n"
    "项目名称｜本周进展｜是否需要支援｜员工绩效排名\n"
    "海棠湾一期｜开了三场直播｜是｜A\n"
).encode("utf-8")


def _upload_old_sheet(client, cid, tok, name="旧汇报表.md", data=_OLD_SHEET) -> int:
    """把一份旧表格塞进这家公司的资料库，返回它在 `source_documents` 里的 idx。"""
    from avery.ingest.registry import REGISTRY, SourceDocument, _now_iso
    ctx = REGISTRY.get(cid)
    ctx.source_documents.append(SourceDocument(
        filename=name, source_key=f"{name}#1", mime="text/markdown", size_bytes=len(data),
        doc_kind="other", status="ingested", uploaded_at=_now_iso(), content=data))
    REGISTRY.put(ctx)
    return len(REGISTRY.get(cid).source_documents) - 1


def test_drafting_reads_the_old_sheet_and_says_what_it_dropped(client):
    cid, tok = _company(client)
    idx = _upload_old_sheet(client, cid, tok)
    r = client.post(f"/team/{cid}/forms/draft-from-file", json={"file_index": idx},
                    headers=_auth(tok))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["origin"] == "heading", "mock brain 下必须诚实标成 heading，不许假装 llm"
    labels = [f["label"] for f in body["template"]["fields"]]
    assert labels[:3] == ["项目名称", "本周进展", "是否需要支援"]
    assert "员工绩效排名" not in labels, "带红线字眼的那列被原样带进了提案"
    assert any(d["label"] == "员工绩效排名" for d in body["dropped"]), "丢了却没说"
    assert body["source"]["filename"] == "旧汇报表.md"
    # 「是否…」是表头本身唯一能读出来的控件类型。
    assert [f["kind"] for f in body["template"]["fields"]][2] == "yesno"


def test_a_draft_is_a_proposal_and_writes_nothing(client):
    cid, tok = _company(client)
    idx = _upload_old_sheet(client, cid, tok)
    before = client.get(f"/team/{cid}/forms", headers=_auth(tok)).json()["templates"]
    r = client.post(f"/team/{cid}/forms/draft-from-file", json={"file_index": idx},
                    headers=_auth(tok))
    assert r.json()["template"]["id"] == "", "提案不该带 id——落成哪个 id 是确认那一步的事"
    after = client.get(f"/team/{cid}/forms", headers=_auth(tok)).json()["templates"]
    assert [t["id"] for t in after] == [t["id"] for t in before], "起草偷偷落库了"


def test_confirming_a_draft_never_eats_a_422(client):
    """🔴 票面判据：起草层已经把红线处理掉了，所以经理点确认走的是既有 `POST /forms`，必须 200。
    这条门是「预检与真门用同一把尺」那句话的执法者。"""
    cid, tok = _company(client)
    idx = _upload_old_sheet(client, cid, tok)
    draft = client.post(f"/team/{cid}/forms/draft-from-file", json={"file_index": idx},
                        headers=_auth(tok)).json()["template"]
    saved = _save(client, cid, tok, {"title": draft["title"] or "本周工作汇报表",
                                     "fields": draft["fields"]})
    assert saved.status_code == 200, saved.text


def test_drafting_from_a_file_that_has_no_bytes_is_a_409_not_a_500(client):
    cid, tok = _company(client)
    from avery.ingest.registry import REGISTRY, SourceDocument, _now_iso
    ctx = REGISTRY.get(cid)
    ctx.source_documents.append(SourceDocument(
        filename="空的.md", source_key="空的.md#1", mime="text/markdown", size_bytes=0,
        doc_kind="other", status="ingested", uploaded_at=_now_iso(), content=None))
    REGISTRY.put(ctx)
    idx = len(REGISTRY.get(cid).source_documents) - 1
    r = client.post(f"/team/{cid}/forms/draft-from-file", json={"file_index": idx},
                    headers=_auth(tok))
    assert r.status_code == 409, r.text


def test_drafting_needs_the_owner_token_like_every_other_manager_endpoint(client):
    cid, tok = _company(client)
    idx = _upload_old_sheet(client, cid, tok)
    assert client.post(f"/team/{cid}/forms/draft-from-file",
                       json={"file_index": idx}).status_code == 404
    assert client.post(f"/team/{cid}/forms/draft-from-file", json={"file_index": idx},
                       headers=_auth("nope")).status_code == 404


def test_an_unknown_file_index_is_a_404(client):
    cid, tok = _company(client)
    r = client.post(f"/team/{cid}/forms/draft-from-file", json={"file_index": 99},
                    headers=_auth(tok))
    assert r.status_code == 404


class _ScriptedBrain:
    """一台离线替身。`AVERY_BRAIN=mock` 下起草的 LLM 分支**根本不执行**（`resolve_brain_kind()`
    早退），所以纯 env 的离线套对那条分支是结构性瞎的——必须把它换出来才验得到。"""
    name = "fake-live"

    def __init__(self, text: str):
        self.text, self.calls = text, 0

    def respond(self, system, conversation, tools):
        self.calls += 1
        self.seen = conversation
        return BrainResponse(tool_calls=[], text=self.text)


def _live_brain(monkeypatch, text: str) -> _ScriptedBrain:
    from service import brain_factory
    fake = _ScriptedBrain(text)
    monkeypatch.setenv("AVERY_BRAIN", "minimax")
    monkeypatch.setattr(brain_factory, "make_brain", lambda case, kind=None: fake)
    return fake


def test_the_live_brain_branch_parses_a_json_proposal(client, monkeypatch):
    fake = _live_brain(monkeypatch, """好的，给你：
{"title": "本周工作汇报", "fields": [
  {"kind": "text", "label": "本周进展", "help": "写具体做完的事"},
  {"kind": "choice", "label": "这一周状态", "choices": ["如常", "偏紧", "吃紧"]},
  {"kind": "number", "label": "把握程度", "min": 1, "max": 5},
  {"kind": "yesno", "label": "是否需要支援"}]}""")
    cid, tok = _company(client)
    idx = _upload_old_sheet(client, cid, tok)
    body = client.post(f"/team/{cid}/forms/draft-from-file", json={"file_index": idx},
                       headers=_auth(tok)).json()

    assert fake.calls == 1, "真 brain 那条分支压根没被走到"
    assert body["origin"] == "llm"
    assert body["template"]["title"] == "本周工作汇报"
    assert [f["kind"] for f in body["template"]["fields"]] == \
        ["text", "choice", "number", "yesno"]
    assert body["template"]["fields"][2]["min"] == 1 and body["template"]["fields"][2]["max"] == 5
    # 喂给模型的只有文档开头那一截（旧表格的表头在最上面，多喂既贵又会把数据当题目）。
    assert "项目名称" in fake.seen[0]["content"][0]["text"]


def test_a_brain_that_answers_with_prose_degrades_to_the_heading_reader(client, monkeypatch):
    """诚实降级：读不出 JSON 就退回表头启发式，`origin` 如实标成 heading，绝不假装 llm。"""
    _live_brain(monkeypatch, "我觉得这张表挺好的，不用改。")
    cid, tok = _company(client)
    idx = _upload_old_sheet(client, cid, tok)
    body = client.post(f"/team/{cid}/forms/draft-from-file", json={"file_index": idx},
                       headers=_auth(tok)).json()
    assert body["origin"] == "heading"
    assert [f["label"] for f in body["template"]["fields"]][0] == "项目名称"


def test_a_brain_that_explodes_does_not_turn_into_a_500(client, monkeypatch):
    from service import brain_factory

    class _Boom:
        name = "boom"

        def respond(self, *a, **kw):
            raise RuntimeError("model down")

    monkeypatch.setenv("AVERY_BRAIN", "minimax")
    monkeypatch.setattr(brain_factory, "make_brain", lambda case, kind=None: _Boom())
    cid, tok = _company(client)
    idx = _upload_old_sheet(client, cid, tok)
    r = client.post(f"/team/{cid}/forms/draft-from-file", json={"file_index": idx},
                    headers=_auth(tok))
    assert r.status_code == 200 and r.json()["origin"] == "heading"


def test_a_model_that_ignores_the_red_line_still_cannot_get_a_scoring_question_through(client,
                                                                                       monkeypatch):
    """提示词里的约束不是判据——模型会不听。落地层这道闸才是判据。"""
    _live_brain(monkeypatch, '{"title": "考评", "fields": ['
                             '{"kind": "text", "label": "员工绩效排名"},'
                             '{"kind": "text", "label": "本周进展"}]}')
    cid, tok = _company(client)
    idx = _upload_old_sheet(client, cid, tok)
    body = client.post(f"/team/{cid}/forms/draft-from-file", json={"file_index": idx},
                       headers=_auth(tok)).json()
    labels = [f["label"] for f in body["template"]["fields"]]
    assert labels == ["本周进展"]
    assert any("红线" in d["reason"] for d in body["dropped"])


def test_a_model_that_returns_a_broken_shape_never_reaches_the_manager(client, monkeypatch):
    """一格 choice 只给一个选项、两个重复选项、number 上下界反了——每一种都会让确认那一刻
    吃 422。起草层要么收拾干净，要么整份清空，不许原样递出去。"""
    _live_brain(monkeypatch, '{"title": "表", "fields": ['
                             '{"kind": "choice", "label": "只有一个选项", "choices": ["甲"]},'
                             '{"kind": "choice", "label": "重复选项", "choices": ["甲","甲","乙"]},'
                             '{"kind": "number", "label": "反了的范围", "min": 9, "max": 2},'
                             '{"kind": "number", "label": "越界的范围", "min": -5, "max": 900}]}')
    cid, tok = _company(client)
    idx = _upload_old_sheet(client, cid, tok)
    body = client.post(f"/team/{cid}/forms/draft-from-file", json={"file_index": idx},
                       headers=_auth(tok)).json()
    fields = body["template"]["fields"]
    assert fields[0]["kind"] == "text", "只有一个选项的 choice 应该退成 text"
    assert fields[1]["choices"] == ["甲", "乙"]
    assert (fields[2]["min"], fields[2]["max"]) == (0, 100)
    assert (fields[3]["min"], fields[3]["max"]) == (0, 100)
    saved = _save(client, cid, tok, {"title": "表", "fields": fields})
    assert saved.status_code == 200, saved.text


def test_a_model_that_returns_more_than_twelve_questions_is_capped_and_says_so(client, monkeypatch):
    fields = ",".join(f'{{"kind": "text", "label": "第{i}题"}}' for i in range(1, 16))
    _live_brain(monkeypatch, '{"title": "长表", "fields": [' + fields + "]}")
    cid, tok = _company(client)
    idx = _upload_old_sheet(client, cid, tok)
    body = client.post(f"/team/{cid}/forms/draft-from-file", json={"file_index": idx},
                       headers=_auth(tok)).json()
    assert len(body["template"]["fields"]) == MAX_FIELDS
    assert len([d for d in body["dropped"] if "最多" in d["reason"]]) == 3


def test_a_scoring_title_is_dropped_and_the_manager_is_told(client, monkeypatch):
    _live_brain(monkeypatch, '{"title": "员工绩效排名", "fields": ['
                             '{"kind": "text", "label": "本周进展"}]}')
    cid, tok = _company(client)
    idx = _upload_old_sheet(client, cid, tok)
    body = client.post(f"/team/{cid}/forms/draft-from-file", json={"file_index": idx},
                       headers=_auth(tok)).json()
    assert body["template"]["title"] == "", "带红线字眼的表名被原样带出来了"
    assert any("表名" in d["reason"] for d in body["dropped"])


def test_a_document_with_nothing_readable_hands_back_an_empty_proposal(client):
    """一格都读不出来就说读不出来。编两道题填满界面，比交白表糟得多。"""
    cid, tok = _company(client)
    idx = _upload_old_sheet(client, cid, tok, name="随笔.md",
                            data="今天天气不错。\n出去走了走。\n".encode("utf-8"))
    body = client.post(f"/team/{cid}/forms/draft-from-file", json={"file_index": idx},
                       headers=_auth(tok)).json()
    assert body["origin"] == "none" and body["template"]["fields"] == []
