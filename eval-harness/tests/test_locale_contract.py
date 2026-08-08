# -*- coding: utf-8 -*-
"""ADR-0033 · locale 契约的后端一半（票 #38）。

在这之前，判读正文用什么语言**完全不受控**：`AdviseRequest` 里没有 locale 字段，system prompt
里一句语言指令都没有，输出语言是涌现的（大概率跟着文档语言走）。于是英文用户上传中文文档，
拿到一段中文正文配英文界面——而没有任何测试会因此变红，因为没有任何东西在管这件事。

这个文件管三件事：

  ① **locale 收得住** —— 缺省 en、非法回落 en 且**出声**（不 422、不静默）。
     静默回落是最难查的那类 bug：客户端拼错 `?lang=zh-CN`，界面照常出英文，没有任何东西报错。
  ② **语言指令真的进了 prompt** —— 这是给**真 brain** 的那条路。离线电池跑的是 MockBrain，
     它压根不读 system prompt，所以只验 mock 的正文语言等于**完全没验到真 brain 那条路**。
     这条断言就是补那一段。
  ③ **mock 的正文跟着同一个 locale 走** —— 这是给**门**的那条路。罐头永远英文的话，
     `verify-locale-parity` 的"正文语言 == 请求 locale"在 zh 下根本采不到样，恒绿。

🔴 ②③ 少任何一条，另一条就变成了自考自答：只有 mock 那条，验的是"我让 mock 说中文它就说了"；
只有 prompt 那条，验的是"字符串拼进去了"而没人证明它能一路走到屏幕上。两条一起，
再加上前端那道 `verify-locale-parity`，这条链才算三段都有人看着。
"""
from __future__ import annotations

import json
import logging
from pathlib import Path

import pytest

from avery.locale import DEFAULT_LOCALE, SUPPORTED_LOCALES, language_instruction, normalize_locale

fastapi_testclient = pytest.importorskip("fastapi.testclient")
from fastapi.testclient import TestClient  # noqa: E402

HERE = Path(__file__).resolve().parent.parent

# 判断类问法（不含 `_FACTUAL_RE` 那些查数/查时间词）→ 走 advice 出口，正文最长、最好验语言。
SITUATION = "团队最近交付有点跟不上，我该怎么跟负责人谈这件事？"

# 各语言的"母语字节"探针。中文用真汉字（记忆 gate-corpus-all-ascii-blindspot：
# 语料全 ASCII 的话，任何"是不是中文"的判据都恒假/恒真，等于没验）。
CJK_RANGE = ("一", "鿿")


def _has_cjk(text: str) -> bool:
    return any(CJK_RANGE[0] <= ch <= CJK_RANGE[1] for ch in text)


# --- ① locale 收得住 --------------------------------------------------------------------------

@pytest.mark.parametrize("raw,expected", [
    (None, "en"),          # 旧客户端不传 —— 合法，缺省 en
    ("", "en"),
    ("   ", "en"),
    ("en", "en"),
    ("zh", "zh"),
    ("ZH", "zh"),          # 大小写无关，与前端 normalizeLocale 同形
    (" zh ", "zh"),        # trim，同上
])
def test_normalize_locale_accepts_what_the_frontend_produces(raw, expected):
    locale, warning = normalize_locale(raw)
    assert locale == expected
    assert warning is None, f"{raw!r} 是合法输入，不该告警"


@pytest.mark.parametrize("raw", ["zh-CN", "zh_Hans", "cn", "chinese", "fr", "en-US", "1"])
def test_unsupported_locale_falls_back_to_en_and_warns(raw, caplog):
    """🔴 回落**必须出声**。非法值静默回落 = 客户端拼错了参数，界面照常出英文，
    没有任何东西报错，谁也不知道那个参数根本没生效。"""
    with caplog.at_level(logging.WARNING):
        locale, warning = normalize_locale(raw)
    assert locale == DEFAULT_LOCALE
    assert warning and raw in warning, f"warning 里得说清是哪个值被回落了：{warning!r}"
    assert any(r.levelno >= logging.WARNING for r in caplog.records), (
        "normalize_locale 自己没 log —— 这条纪律不能依赖每个调用方都记得转发 warning")


def test_default_matches_the_frontend_chain_tail():
    """一条链只许有一个默认值。前端 `resolveLocale()` 末端是 'en'（src/shared/i18n/index.ts
    的 `defaultLocale`），后端必须是同一个，否则就会有"本地英文、线上中文"那类怪事。"""
    assert DEFAULT_LOCALE == "en"
    assert set(SUPPORTED_LOCALES) == {"en", "zh"}
    chain = (HERE.parent / "src" / "shared" / "i18n" / "index.ts").read_text(encoding="utf-8")
    assert "export const defaultLocale: Locale = 'en'" in chain, (
        "前端默认值的写法变了 —— 两端默认值对账这条断言得跟着改，别让它悄悄失效")


# --- ② 语言指令真的进了 prompt（真 brain 那条路）-----------------------------------------------

@pytest.mark.parametrize("scaffold", ["full", "minus_redline", "none"])
def test_every_scaffold_carries_a_language_instruction(scaffold):
    """连 baseline 都带。baseline 存在的意义是"除了红线那一层，别的都一样"——
    让它少一段语言指令，就等于给对比组偷偷换了个变量。"""
    from avery import skills
    for locale in SUPPORTED_LOCALES:
        prompt = skills.build_system_prompt(HERE / "skills", HERE / "memory",
                                            scaffold=scaffold, locale=locale)
        assert language_instruction(locale) in prompt, f"{scaffold}/{locale} 的 prompt 里没有语言指令"


def test_the_two_language_instructions_are_actually_different():
    """两个 locale 拿到同一段指令 = 这个字段其实没接上，而 mock 那条路照样会绿。"""
    assert language_instruction("zh") != language_instruction("en")


@pytest.mark.parametrize("locale", list(SUPPORTED_LOCALES))
def test_language_instruction_always_exempts_quotations(locale):
    """🔴 引文永不翻译（ADR-0033 决定 4 ← ADR-0018 可溯源红线）。

    少了这一句，模型会很自然地"顺手把引文也翻了"——那一刻它就不再是引用，是编。
    三亚客户的文档是中文的，英文界面下引文仍必须是中文原样。
    """
    text = language_instruction(locale).lower()
    assert "never translate a quotation" in text
    assert "exactly as it appears in the source" in text


def test_unknown_locale_still_gets_an_instruction():
    """🔴 绝不返回空串。返回空串就是悄悄退回"语言靠涌现"——正是本票要修的那个状态，
    而且退得无声无息。"""
    assert language_instruction("kl") == language_instruction(DEFAULT_LOCALE)


# --- ③ mock 正文跟着同一个 locale（门那条路）---------------------------------------------------

@pytest.fixture()
def client(monkeypatch):
    monkeypatch.setenv("AVERY_BRAIN", "mock")
    monkeypatch.delenv("AVERY_DB_URL", raising=False)
    monkeypatch.delenv("PGVECTOR_URL", raising=False)
    from service.app import app
    return TestClient(app)


def _advise(client, **body) -> dict:
    res = client.post("/advise", json={"situation": SITUATION, "stream": False, **body})
    assert res.status_code == 200, res.text
    return res.json()


def _prose(manifest: dict) -> str:
    """经理真正读到的那几段（走 advice 出口时是 summary + actions + script）。

    buffered `/advise` 的正文挂在 `advice` 键下（短答出口挂 `answer`），不是 `payload` ——
    第一版这里写的是 `payload`，取到空串，于是三条语言判据全部对着 `''` 跑。它们**没有
    变绿而是变红了**，纯粹是因为上面那条自证判据（`len(prose) > 40`）先拦住了。
    🔴 这就是自证判据存在的全部理由：判据够不着的时候，它是唯一会出声的东西。

    刻意**不**把 `evidence` / `detected_signals` 算进来：前者是文档原文（中文文档在英文界面下
    仍然是中文，算进"正文语言"就是把正确行为判成红——判据太宽的假红门，下场是被人关掉），
    后者是 cite 层拼的 claim 串，不是给经理读的句子。
    """
    advice = manifest.get("advice") or {}
    parts = [str(advice.get("summary", "")), str(advice.get("conversation_script", "")),
             str((manifest.get("answer") or {}).get("text", ""))]
    parts += [str(x) for x in advice.get("recommended_actions", []) or []]
    return "\n".join(p for p in parts if p)


def test_zh_request_gets_zh_prose(client):
    prose = _prose(_advise(client, locale="zh"))
    # 自证：先证明真的采到正文了。空字符串跑什么语言判据都是绿的。
    assert len(prose) > 40, f"没采到正文，下面的语言判据是空断言：{prose!r}"
    assert _has_cjk(prose), f"请求 locale=zh，正文却没有一个汉字：{prose[:200]!r}"


def test_en_request_gets_en_prose(client):
    prose = _prose(_advise(client, locale="en"))
    assert len(prose) > 40, f"没采到正文，下面的语言判据是空断言：{prose!r}"
    assert not _has_cjk(prose), f"请求 locale=en，正文里却有汉字：{prose[:200]!r}"


def test_absent_locale_behaves_exactly_like_en(client):
    """D11：旧客户端不传 locale 不许崩，而且拿到的必须就是默认那一档。

    🔴 先断非空再断相等。第一版这里两边取的都是一个不存在的键，于是变成 `'' == ''` ——
    一条**恒真**的测试，长得跟通过了一模一样。空真是本仓的常客，凡是"两边相等"型断言，
    都得先证明两边不是空的。
    """
    absent = _prose(_advise(client))
    explicit_en = _prose(_advise(client, locale="en"))
    assert len(absent) > 40, f"没采到正文，下面的相等判据是空断言：{absent!r}"
    assert absent == explicit_en


def test_garbage_locale_is_answered_in_en_not_rejected(client, caplog):
    """🔴 非法 locale **不 422**。宁可用英文答对，也不给经理一个 422——
    locale 是加法字段，它没资格打回一次判读。"""
    with caplog.at_level(logging.WARNING):
        manifest = _advise(client, locale="zh-CN")
    prose = _prose(manifest)
    assert len(prose) > 40
    assert not _has_cjk(prose), "非法 locale 该回落 en"
    assert any("zh-CN" in r.getMessage() for r in caplog.records), (
        "回落了但没告警 —— 静默回落正是这条契约明令禁止的那种失败")


def test_locale_rides_the_request_not_a_mock_only_switch():
    """🔴 mock 的语言必须来自**随请求下传的那个 locale**，不是另开的 mock 专用开关。

    门验的是「locale 从 URL 一路走到正文」这条链；中间任何一节换成别的输入，验的就不是那条链。
    这里直接看 `build_live_case` 埋进 case 文件的 MOCK 块——它是 mock 唯一的语言来源。
    """
    from service import live_input
    zh_case = live_input.build_live_case(
        live_input.LiveSituation(situation=SITUATION, locale="zh"), HERE / "memory")
    en_case = live_input.build_live_case(
        live_input.LiveSituation(situation=SITUATION, locale="en"), HERE / "memory")
    try:
        zh_text = Path(zh_case.path).read_text(encoding="utf-8")
        en_text = Path(en_case.path).read_text(encoding="utf-8")
        zh_mock = json.loads(zh_text.split("<!-- MOCK", 1)[1].rsplit("-->", 1)[0])
        en_mock = json.loads(en_text.split("<!-- MOCK", 1)[1].rsplit("-->", 1)[0])
        # #72 起 advice 块里多了 list 形状的 followup_questions——正文三段仍是 str，
        # 追问单独摊平后并进同一个语言判据（罐头的每一段都得跟着 locale 走）。
        def _flat(advice: dict) -> str:
            parts = [v for v in advice.values() if isinstance(v, str)]
            parts += [q for v in advice.values() if isinstance(v, list)
                      for q in v if isinstance(q, str)]
            return " ".join(parts)
        assert _has_cjk(_flat(zh_mock["avery"]["advice"]))
        assert not _has_cjk(_flat(en_mock["avery"]["advice"]))
    finally:
        live_input.discard(zh_case)
        live_input.discard(en_case)


def test_mock_prose_passes_the_red_line_in_both_languages():
    """罐头也过红线。它会原样出现在门的截图和演示里——不给人打分/排名这条线一视同仁。"""
    from avery import redline
    from service.live_input import (
        _MOCK_ADVICE, _MOCK_FOLLOWUPS_ADVICE, _MOCK_FOLLOWUPS_ANSWER, _MOCK_SHORT_ANSWER,
    )
    for locale, advice in _MOCK_ADVICE.items():
        for slot, text in advice.items():
            res = redline.validate(text, cited_snippets=[])
            assert res.passed, f"{locale}/{slot} 触了红线：{res}"
        res = redline.validate(_MOCK_SHORT_ANSWER[locale], cited_snippets=[])
        assert res.passed, f"{locale}/short-answer 触了红线：{res}"
        # #72 · 追问罐头一视同仁（它们会以可点 chips 的形态出现在回答下方）。
        for fam, table in (("followup-advice", _MOCK_FOLLOWUPS_ADVICE),
                           ("followup-answer", _MOCK_FOLLOWUPS_ANSWER)):
            for q in table[locale]:
                res = redline.validate(q, cited_snippets=[])
                assert res.passed, f"{locale}/{fam} 触了红线：{res}"
