# -*- coding: utf-8 -*-
"""T1 · form-backend-a1a —— 常驻表单的 HTTP 面（经理端点 + 员工 `/f/{token}` H5），全离线。

契约（gap-design-0805 §A1 + ADR-0023 透明三件套）：
  * 经理侧四个端点与 notes / advise-runs 同一张门：owner_token（header）或持有账号，否则**同体**
    404（无枚举 oracle）；
  * 🔴 渲染是**字段描述驱动**的：`kind → 渲染函数` 一张表，text→textarea、choice→单选按钮组、
    number→0-100 滑杆。加题型只动那张表 —— 这是后续票不重写渲染层的前提，所以这里钉死；
  * 员工页的透明三件套在 DOM 里：谁在收 / 填的是什么 / 填完给谁看（员工**知情**，这是这个功能
    站得住的道德地基）；
  * 零外部资源（IM webview 里没有任何东西可拦、可慢、可记）；ZH 默认，`?lang=en` 翻面；
  * 交一次即锁：第二次提交 409 且**首答原封不动**；
  * 状态页大声说话（feat-028 纪律，不做兜底渲染）：未知 token → 404、过期 → 404、模板被撤下 → 410；
  * 🔴 零跨人泄漏：页面只渲染**这一个人**，同一轮铸出去的其他人的姓名/答案永不出现（一人一链）。

⚠ 语料含中文字节是故意的（MEMORY：门语料全 ASCII 盲点）—— 内置模板与答案都是中文，编码/转义/
截断的毛病要在这里暴露，不要在客户面前。
"""
from __future__ import annotations

import re
from pathlib import Path

import pytest

pytest.importorskip("fastapi.testclient")
from fastapi.testclient import TestClient  # noqa: E402

HERE = Path(__file__).resolve().parent.parent
FIX = HERE / "tests" / "fixtures" / "ingest"
HANDBOOK = FIX / "Studio_Handbook.md"


@pytest.fixture()
def client(monkeypatch):
    monkeypatch.setenv("AVERY_BRAIN", "mock")
    monkeypatch.setenv("AVERY_EXTRACTOR", "heuristic")
    # 三件套缺一真烧钱（MEMORY：门电池全离线配置）。本机 .env 里 AVERY_EMBEDDINGS=dashscope +
    # 真 key，不显式压成 keyword 的话，哪天有人把这条链接到持久 registry 上就会真出网。
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


def _company(client) -> tuple[str, str]:
    files = [("files", (HANDBOOK.name, HANDBOOK.read_bytes(), "application/octet-stream"))]
    ing = client.post("/ingest", files=files).json()
    return ing["context_id"], ing["owner_token"]


def _auth(tok: str) -> dict:
    return {"X-Avery-Token": tok}


def _mint(client, cid: str, tok: str, recipients=None, template_id="tpl_weekly",
          period: str | None = None) -> list[dict]:
    body: dict = {"recipients": recipients or [{"id": "P-0007", "name": "周雅"}]}
    if period is not None:
        body["period"] = period
    r = client.post(f"/team/{cid}/forms/{template_id}/links", json=body, headers=_auth(tok))
    assert r.status_code == 200, r.text
    return r.json()["links"]


def _one_link(client) -> tuple[str, str, str]:
    """一条可填的链接：返回 (context_id, owner_token, share_token)。"""
    cid, tok = _company(client)
    client.get(f"/team/{cid}/forms", headers=_auth(tok))   # 内置模板按需铸出
    return cid, tok, _mint(client, cid, tok)[0]["token"]


_FULL_ANSWER = {
    "f_done": "晚市高峰传菜等位超 8 分钟，本周排了 3 次加班顶上去。",
    "f_missed": "宴会厅翻台没压到 25 分钟，缺一个人。",
    "f_next_goal": "把传菜动线改一版，下周试跑。",
    "f_support": "想借调一个人手到晚市。",
    "f_load": "72",
    "f_mood": "偏紧",
}


# ==============================================================================================
# 经理端点：门、内置模板、铸链、状态列表
# ==============================================================================================

def test_the_builtin_weekly_form_appears_for_a_company_that_never_had_one(client):
    cid, tok = _company(client)
    body = client.get(f"/team/{cid}/forms", headers=_auth(tok)).json()
    tpls = {t["id"]: t for t in body["templates"]}
    assert "tpl_weekly" in tpls, "内置「周报」没有按需铸出来"
    weekly = tpls["tpl_weekly"]
    assert weekly["title"] == "周报" and weekly["active"] is True
    assert [f["label"] for f in weekly["fields"]] == [
        "已完成事实", "未达成及原因", "下一周期目标", "需要支持", "负载自述", "情绪自述"]
    assert [f["kind"] for f in weekly["fields"]] == [
        "text", "text", "text", "text", "number", "choice"]


def test_every_manager_endpoint_404s_without_the_owner_token(client):
    """与 notes / advise-runs 同一张门，失败一律同体 404（不确认 context 是否存在）。"""
    cid, tok = _company(client)
    client.get(f"/team/{cid}/forms", headers=_auth(tok))
    for method, path, kwargs in (
        ("get", f"/team/{cid}/forms", {}),
        ("post", f"/team/{cid}/forms", {"json": {"title": "周报", "fields": [
            {"id": "a", "kind": "text", "label": "本周做完了什么"}]}}),
        ("post", f"/team/{cid}/forms/tpl_weekly/links",
         {"json": {"recipients": [{"name": "周雅"}]}}),
        ("get", f"/team/{cid}/forms/submissions", {}),
    ):
        r = getattr(client, method)(path, **kwargs)
        assert r.status_code == 404, f"{method.upper()} {path} 没被 owner_token 门拦住"
        r2 = getattr(client, method)(path, headers={"X-Avery-Token": "tok_wrong"}, **kwargs)
        assert r2.status_code == 404


def test_minting_gives_one_unguessable_link_per_person(client):
    cid, tok = _company(client)
    client.get(f"/team/{cid}/forms", headers=_auth(tok))
    links = _mint(client, cid, tok, [{"id": "P-1", "name": "周雅"}, {"id": "P-2", "name": "陈立"}])
    assert [l["person_name"] for l in links] == ["周雅", "陈立"]
    assert len({l["token"] for l in links}) == 2, "两个人拿到了同一条链接"
    for l in links:
        assert len(l["token"]) >= 32 and l["link"].endswith("/f/" + l["token"])
        assert l["status"] == "open" and l["submitted_at"] is None
        assert l["expires_at"]


def test_minting_defaults_the_period_to_the_current_iso_week(client):
    from avery.ingest.form import current_period
    cid, tok = _company(client)
    client.get(f"/team/{cid}/forms", headers=_auth(tok))
    r = client.post(f"/team/{cid}/forms/tpl_weekly/links",
                    json={"recipients": [{"name": "周雅"}]}, headers=_auth(tok))
    assert r.json()["period"] == current_period()
    assert re.fullmatch(r"\d{4}-W\d{2}", r.json()["period"])


def test_minting_refuses_an_empty_recipient_list_and_an_unknown_template(client):
    cid, tok = _company(client)
    client.get(f"/team/{cid}/forms", headers=_auth(tok))
    r = client.post(f"/team/{cid}/forms/tpl_weekly/links", json={"recipients": []},
                    headers=_auth(tok))
    assert r.status_code == 422
    r2 = client.post(f"/team/{cid}/forms/tpl_nope/links",
                     json={"recipients": [{"name": "周雅"}]}, headers=_auth(tok))
    assert r2.status_code == 404


def test_the_submissions_list_is_the_truth_about_who_has_not_answered(client):
    cid, tok = _company(client)
    client.get(f"/team/{cid}/forms", headers=_auth(tok))
    links = _mint(client, cid, tok, [{"name": "周雅"}, {"name": "陈立"}])
    client.post(f"/f/{links[0]['token']}/submit", data=_FULL_ANSWER)

    rows = client.get(f"/team/{cid}/forms/submissions", headers=_auth(tok)).json()["submissions"]
    by_name = {r["person_name"]: r for r in rows}
    assert by_name["周雅"]["status"] == "submitted" and by_name["周雅"]["submitted_at"]
    assert by_name["陈立"]["status"] == "open" and by_name["陈立"]["submitted_at"] is None
    assert "answers" not in by_name["陈立"], "没交的人不该有 answers 键（absent ≠ 空）"
    answers = {a["field_id"]: a["value"] for a in by_name["周雅"]["answers"]}
    assert answers["load"] == 72 and answers["mood"] == "偏紧"
    assert answers["done"].startswith("晚市高峰传菜等位超 8 分钟")


# ==============================================================================================
# 🔴 模板写侧的两道门
# ==============================================================================================

def test_a_person_scoring_field_label_is_refused_with_a_reason(client):
    cid, tok = _company(client)
    r = client.post(f"/team/{cid}/forms", headers=_auth(tok), json={
        "id": "tpl_bad", "title": "周报",
        "fields": [{"id": "q1", "kind": "text", "label": "这位同事的绩效评分是多少？"}]})
    assert r.status_code == 422, r.text
    assert "red line" in r.json()["detail"]["reason"]
    assert all(t["id"] != "tpl_bad"
               for t in client.get(f"/team/{cid}/forms", headers=_auth(tok)).json()["templates"])


def test_bad_shapes_never_land(client):
    cid, tok = _company(client)
    for fields, why in (
        ([{"id": "q1", "kind": "slider", "label": "本周负载"}], "未知题型"),
        ([{"id": "q1", "kind": "choice", "label": "本周状态", "choices": ["还行"]}], "只有一个选项"),
        ([{"id": "q1", "kind": "number", "label": "本周负载", "min": 80, "max": 20}], "上下界反了"),
        ([{"id": "q1", "kind": "text", "label": "甲"},
          {"id": "q1", "kind": "text", "label": "乙"}], "字段 id 撞车"),
    ):
        r = client.post(f"/team/{cid}/forms", headers=_auth(tok),
                        json={"title": "周报", "fields": fields})
        assert r.status_code == 422, f"{why} 竟然被收下了"
        assert r.json()["detail"]["reason"]


def test_the_upper_bounds_are_actually_enforced_not_just_declared(client):
    """上限不是装饰。**每一条都判据引常量**，所以改常量测试跟着走、删判据测试立刻红。

    为什么单立一条：自审做过变异实验 —— 把 `<= MAX_FIELDS`、`<= MAX_CHOICES`、
    `<= MAX_RECIPIENTS_PER_MINT` 三处上界和 `[:MAX_TEXT_ANSWER_CHARS]` 截断一起删掉，
    当时的 59 条门**全绿**。这四条恰恰是**没有第二道门**的：`fields` / `recipients` 两个
    list 在 pydantic 侧没有 max_length，0013 两张表零 CHECK 约束，`/f/` 走 share 表盘只吃限流
    不吃 413 体积门 —— 所以服务端就这一道。（MAX_TITLE/LABEL/HELP/CHOICE_CHARS 另有 pydantic
    `Field(max_length=)` 兜着，不在这条里重复量。）"""
    from avery.ingest.form import MAX_CHOICES, MAX_FIELDS, MAX_RECIPIENTS_PER_MINT
    cid, tok = _company(client)

    def _save(fields):
        return client.post(f"/team/{cid}/forms", headers=_auth(tok),
                           json={"title": "周报", "fields": fields})

    just_fits = [{"id": f"q{i}", "kind": "text", "label": f"第 {i} 格"}
                 for i in range(MAX_FIELDS)]
    assert _save(just_fits).status_code == 200, "刚好 MAX_FIELDS 格应该收下"
    one_too_many = just_fits + [{"id": "extra", "kind": "text", "label": "多出来的一格"}]
    r = _save(one_too_many)
    assert r.status_code == 422 and str(MAX_FIELDS) in r.json()["detail"]["reason"]

    fits = [{"id": "c", "kind": "choice", "label": "挑一个",
             "choices": [f"选项{i}" for i in range(MAX_CHOICES)]}]
    assert _save(fits).status_code == 200, "刚好 MAX_CHOICES 个选项应该收下"
    too_many = [{"id": "c", "kind": "choice", "label": "挑一个",
                 "choices": [f"选项{i}" for i in range(MAX_CHOICES + 1)]}]
    assert _save(too_many).status_code == 422

    client.get(f"/team/{cid}/forms", headers=_auth(tok))
    ok = [{"name": f"员工{i}"} for i in range(MAX_RECIPIENTS_PER_MINT)]
    assert client.post(f"/team/{cid}/forms/tpl_weekly/links", json={"recipients": ok},
                       headers=_auth(tok)).status_code == 200
    over = ok + [{"name": "第 31 个人"}]
    r2 = client.post(f"/team/{cid}/forms/tpl_weekly/links", json={"recipients": over},
                     headers=_auth(tok))
    assert r2.status_code == 422 and str(MAX_RECIPIENTS_PER_MINT) in r2.json()["detail"]["reason"]


def test_an_over_long_answer_is_truncated_at_the_declared_bound(client):
    """员工自由文本的**唯一**服务端界（`/f/` 是公开无鉴权面，没有 413 体积门兜着）。
    语料用中文字（MEMORY：门语料全 ASCII 盲点）—— 按**字符**截断，不是按字节。"""
    from avery.ingest.form import MAX_TEXT_ANSWER_CHARS
    cid, tok, token = _one_link(client)
    payload = dict(_FULL_ANSWER)
    payload["f_done"] = "工" * (MAX_TEXT_ANSWER_CHARS + 500)
    assert client.post(f"/f/{token}/submit", data=payload).status_code == 200

    from avery.ingest.registry import REGISTRY
    stored = {a["field_id"]: a["value"]
              for a in REGISTRY.get_form_submission_by_token(token).answers}["done"]
    assert len(stored) == MAX_TEXT_ANSWER_CHARS, (
        f"超长答案没有被截到 {MAX_TEXT_ANSWER_CHARS} 字（实得 {len(stored)}）")
    assert stored == "工" * MAX_TEXT_ANSWER_CHARS


def test_a_manager_authored_form_renders_and_collects(client):
    """自建模板走的是同一条渲染/校验路径 —— 内置模板不是特例。"""
    cid, tok = _company(client)
    r = client.post(f"/team/{cid}/forms", headers=_auth(tok), json={
        "id": "tpl_daily", "title": "日报",
        "fields": [{"id": "today", "kind": "text", "label": "今天做完了什么"},
                   {"id": "blocked", "kind": "choice", "label": "有没有卡住的",
                    "choices": ["没有", "有"]}]})
    assert r.status_code == 200, r.text
    token = _mint(client, cid, tok, [{"name": "陈立"}], template_id="tpl_daily")[0]["token"]
    page = client.get(f"/f/{token}").text
    assert "今天做完了什么" in page and "有没有卡住的" in page
    assert client.post(f"/f/{token}/submit",
                       data={"f_today": "盘了库存", "f_blocked": "没有"}).status_code == 200


# ==============================================================================================
# 🔴 字段描述驱动的渲染
# ==============================================================================================

def test_every_field_kind_has_a_renderer_and_no_renderer_is_orphaned(client):
    """加题型 = 往表里加一项。这条如果漂了，页面上会**静默少一格**（服务端起不来才是对的）。"""
    from avery.ingest.form import FIELD_KINDS
    from service.form_api import _FIELD_RENDERERS
    assert set(_FIELD_RENDERERS) == set(FIELD_KINDS)


def test_each_kind_renders_the_control_it_promises(client):
    cid, tok, token = _one_link(client)
    page = client.get(f"/f/{token}").text
    # text -> textarea（四格自由文本）
    assert page.count("<textarea") == 4
    # choice -> 单选按钮组，选项逐字
    for choice in ("如常", "偏紧", "吃紧"):
        assert f'value="{choice}"' in page
    assert page.count('type="radio"') == 3
    # number -> 0-100 滑杆 + 一直看得见的读数
    assert 'type="range"' in page and 'min="0"' in page and 'max="100"' in page
    assert "<output>" in page


def test_a_number_only_form_renders_a_slider_and_nothing_else(client):
    """渲染层不认字段名、只认 kind —— 换一张只有一格数字的表，出来的就只该是滑杆。"""
    cid, tok = _company(client)
    client.post(f"/team/{cid}/forms", headers=_auth(tok), json={
        "id": "tpl_one", "title": "就一格",
        "fields": [{"id": "load", "kind": "number", "label": "本周忙不忙", "min": 0, "max": 10}]})
    token = _mint(client, cid, tok, [{"name": "周雅"}], template_id="tpl_one")[0]["token"]
    page = client.get(f"/f/{token}").text
    assert 'type="range"' in page and 'max="10"' in page
    assert "<textarea" not in page and 'type="radio"' not in page


def test_optional_fields_are_marked_and_required_ones_are_not_optional(client):
    cid, tok, token = _one_link(client)
    page = client.get(f"/f/{token}").text
    assert "选填" in page, "「需要支持」是选填，页面上要说出来"
    assert page.count('class="h5-req"') == 5, "五格必填各要一个 * 记号"


# ==============================================================================================
# 员工页：透明三件套、零外部资源、双语、零跨人泄漏
# ==============================================================================================

def test_the_transparency_triple_is_in_the_dom(client):
    """员工**知道**：谁在收、填的是什么、填完给谁看。这是这个功能站得住的道德地基（ADR-0023）。"""
    cid, tok, token = _one_link(client)
    page = client.get(f"/f/{token}").text
    assert "谁在收" in page and "填的是什么" in page and "填完给谁看" in page
    assert "不是对你的评分" in page, "必须明说这不是给他打分"
    assert "周雅" in page and "一人一链" in page


def test_the_page_has_zero_external_resources(client):
    """IM webview 里任何外链都可能被拦、被慢、被记 —— 一条都不许有。"""
    cid, tok, token = _one_link(client)
    page = client.get(f"/f/{token}").text
    assert "http://" not in page and "https://" not in page
    assert "<script src" not in page and "<link " not in page
    assert "<img" not in page and "@import" not in page


def test_zh_is_the_default_and_lang_en_flips_the_whole_page(client):
    cid, tok, token = _one_link(client)
    zh = client.get(f"/f/{token}").text
    assert '<html lang="zh"' in zh and "谁在收" in zh
    en = client.get(f"/f/{token}?lang=en").text
    assert '<html lang="en"' in en and "Who collects this" in en
    assert "谁在收" not in en
    assert 'action="/f/' in en and "?lang=en" in en, "英文页提交后要停在英文"
    # 题面是内容（客户的字），不随界面语言翻译 —— 这一点要说清楚，不是漏翻
    assert "已完成事实" in en


def test_one_persons_link_never_shows_another_persons_name(client):
    """🔴 一人一链：同一轮铸出去的其他人，在这一页上不存在。"""
    cid, tok = _company(client)
    client.get(f"/team/{cid}/forms", headers=_auth(tok))
    links = _mint(client, cid, tok, [{"name": "周雅"}, {"name": "陈立"}])
    page_a = client.get(f"/f/{links[0]['token']}").text
    assert "周雅" in page_a and "陈立" not in page_a
    # 别人的答案更不许出现
    client.post(f"/f/{links[1]['token']}/submit", data=_FULL_ANSWER)
    assert "晚市高峰传菜等位" not in client.get(f"/f/{links[0]['token']}").text


# ==============================================================================================
# 提交：校验、答一次锁、诚实状态页
# ==============================================================================================

def test_a_full_submission_lands_and_says_so(client):
    cid, tok, token = _one_link(client)
    r = client.post(f"/f/{token}/submit", data=_FULL_ANSWER)
    assert r.status_code == 200
    assert "已收到" in r.text and "已经进了你们公司的资料" in r.text

    from avery.ingest.registry import REGISTRY
    got = REGISTRY.get_form_submission_by_token(token)
    answers = {a["field_id"]: a["value"] for a in got.answers}
    assert answers["load"] == 72 and isinstance(answers["load"], int)
    assert answers["mood"] == "偏紧"
    assert answers["done"] == _FULL_ANSWER["f_done"], "员工原话没有被逐字存下来"
    assert got.submitted_at


def test_an_optional_field_left_blank_is_absent_not_empty(client):
    """absent ≠ 空字符串：「他没写」和「他写了个空」不是一回事，别在这里折成同一个
    （T2 渲染成文档时要靠这个区分）。"""
    cid, tok, token = _one_link(client)
    payload = dict(_FULL_ANSWER)
    payload["f_support"] = "   "
    assert client.post(f"/f/{token}/submit", data=payload).status_code == 200
    from avery.ingest.registry import REGISTRY
    got = REGISTRY.get_form_submission_by_token(token)
    assert "support" not in {a["field_id"] for a in got.answers}


@pytest.mark.parametrize("mutate,why", [
    ({"f_done": ""}, "必填自由文本留空"),
    ({"f_mood": "还行"}, "选项不在这张表上"),
    ({"f_mood": ""}, "必填单选没选"),
    ({"f_load": "120"}, "数字越界"),
    ({"f_load": "-3"}, "负数"),
    ({"f_load": "七十二"}, "不是数字"),
    ({"f_load": "²"}, "上标数字（isdigit 为真但 int() 会炸）"),
    ({"f_load": ""}, "必填数字留空"),
])
def test_a_bad_answer_is_a_clean_422_and_nothing_lands(client, mutate, why):
    cid, tok, token = _one_link(client)
    payload = dict(_FULL_ANSWER)
    payload.update(mutate)
    r = client.post(f"/f/{token}/submit", data=payload)
    assert r.status_code == 422, f"{why} 竟然被收下了"
    assert "还差一点" in r.text
    from avery.ingest.registry import REGISTRY
    assert REGISTRY.get_form_submission_by_token(token).answers is None, f"{why} 落库了"


def test_submitting_twice_is_refused_and_the_first_answer_stands(client):
    cid, tok, token = _one_link(client)
    assert client.post(f"/f/{token}/submit", data=_FULL_ANSWER).status_code == 200
    second = dict(_FULL_ANSWER)
    second["f_done"] = "我改口了"
    r = client.post(f"/f/{token}/submit", data=second)
    assert r.status_code == 409 and "已经交过了" in r.text

    from avery.ingest.registry import REGISTRY
    got = REGISTRY.get_form_submission_by_token(token)
    assert {a["field_id"]: a["value"] for a in got.answers}["done"] == _FULL_ANSWER["f_done"]


def test_revisiting_an_answered_link_shows_the_locked_page_not_the_form(client):
    cid, tok, token = _one_link(client)
    client.post(f"/f/{token}/submit", data=_FULL_ANSWER)
    r = client.get(f"/f/{token}")
    assert r.status_code == 200 and "已经交过了" in r.text
    assert "<textarea" not in r.text, "已交过的链接不该再给出可填的表"


def test_an_unknown_token_is_a_loud_404(client):
    for path in ("/f/tok_never_minted", "/f/tok_never_minted/submit"):
        r = (client.get(path) if path.endswith("minted")
             else client.post(path, data=_FULL_ANSWER))
        assert r.status_code == 404
        assert "链接不存在" in r.text


def test_an_expired_link_is_a_loud_404(client):
    """7 天过期（拍板 #4）。过期不是白屏、不是「稍后再试」——是一句说得清的话。"""
    cid, tok, token = _one_link(client)
    from avery.ingest.registry import REGISTRY
    sub = REGISTRY.get_form_submission_by_token(token)
    sub.expires_at = "2020-01-01T00:00:00+00:00"
    REGISTRY.put_form_submission(sub)

    r = client.get(f"/f/{token}")
    assert r.status_code == 404 and "已过期" in r.text
    assert client.post(f"/f/{token}/submit", data=_FULL_ANSWER).status_code == 404


def test_an_already_submitted_link_stays_submitted_even_past_its_expiry(client):
    """已交是终态：证据已经在了，不能因为时间到了就改口说链接失效。"""
    cid, tok, token = _one_link(client)
    client.post(f"/f/{token}/submit", data=_FULL_ANSWER)
    from avery.ingest.registry import REGISTRY
    sub = REGISTRY.get_form_submission_by_token(token)
    sub.expires_at = "2020-01-01T00:00:00+00:00"
    REGISTRY.put_form_submission(sub)
    r = client.get(f"/f/{token}")
    assert r.status_code == 200 and "已经交过了" in r.text


def test_a_link_whose_template_vanished_says_so_with_a_410(client):
    """诚实三态的第三态：链接是真的、人是对的，但表被撤下了 —— 说「已被撤下」，不说「不存在」。"""
    cid, tok, token = _one_link(client)
    from avery.ingest.registry import REGISTRY
    REGISTRY._form_templates[cid].pop("tpl_weekly")
    r = client.get(f"/f/{token}")
    assert r.status_code == 410 and "已被撤下" in r.text


def test_the_employee_face_shares_the_public_rate_limit_dial(client, monkeypatch):
    """/f/ 与 /r/ 是同一张公开无鉴权的脸，共用 'share' 表盘 —— 多开一个入口不该多一份配置。"""
    from service.upload_guard import _route_for
    assert _route_for("/f/abc") == "share"
    assert _route_for("/f/abc/submit") == "share"
