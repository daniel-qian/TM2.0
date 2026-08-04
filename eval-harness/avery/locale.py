# -*- coding: utf-8 -*-
"""ADR-0033 · locale 是**请求字段**（判读链路唯一的语言输入）。

前端已经有一条解析链（`src/shared/i18n/index.ts::resolveLocale`）：
`?lang=` > localStorage（语言开关） > 构建期 `VITE_AVERY_LOCALE` > 默认 `en`。
它解析出来的结果随 `/advise` 请求下传，后端**不再自己猜**——判读用什么语言，从此由用户控制。

本模块只做一件事：把请求里那个字段收成一个可信的 locale，并在它非法时**出声**。

🔴 三条纪律（都被 PRD/ADR 逐条拍过板）：
  · 缺省 `en` —— 与前端解析链末端**同一个默认值**。一条链只许有一个默认值，两处各写一个
    就是下一个"为什么本地是英文线上是中文"的怪事。
  · 非法值回落 `en` 并**告警**，不静默 —— 静默回落是最难查的那类 bug：客户端拼错了
    `?lang=zh-CN`，界面照常出英文，没有任何东西报错，谁也不知道那个参数根本没生效。
  · 不 422 —— locale 是 optional 的加法字段，旧客户端不传、传错都不许把一次判读打回。
    宁可用英文答对，也不给经理一个 422。

🔴 与「输入侧检测词表」无关，别搞混（ADR-0033 §输入侧）：本模块决定的是**界面/判读语言**，
不是**文档语言**。`extract.py` / `redline.py` / `granularity.py` 里那几百条中文是用来
**读中文文档**的匹配模式，界面切英文时它们必须仍是中文，与本模块一个字的关系都没有。
"""
from __future__ import annotations

import logging

logger = logging.getLogger(__name__)

SUPPORTED_LOCALES: tuple[str, ...] = ("en", "zh")
DEFAULT_LOCALE = "en"


def normalize_locale(raw: str | None) -> tuple[str, str | None]:
    """把请求里的 locale 收成 `('en'|'zh', warning|None)`。

    与前端 `normalizeLocale()` 逐条同形：trim + 小写，只认 `en` / `zh`。

        None / ""  -> ("en", None)      缺省，合法，不告警
        "zh" "ZH " -> ("zh", None)
        "zh-CN"    -> ("en", "…")       非法，回落 + 告警（**不是** 422）

    返回 warning 而不是直接抛，是为了让调用方决定怎么把它送出去（日志 / 事件 / 响应字段）；
    本函数自己也会 log 一条 —— "不要静默" 这条纪律不能依赖每个调用方都记得转发。
    """
    if raw is None:
        return DEFAULT_LOCALE, None
    value = str(raw).strip().lower()
    if not value:
        return DEFAULT_LOCALE, None
    if value in SUPPORTED_LOCALES:
        return value, None
    warning = (f"unsupported locale {raw!r} — falling back to {DEFAULT_LOCALE!r} "
               f"(supported: {', '.join(SUPPORTED_LOCALES)})")
    logger.warning("locale.normalize_locale: %s", warning)
    return DEFAULT_LOCALE, warning


# --- 给 LLM 的语言指令（ADR-0033 决定 3）--------------------------------------------------------
# 在此之前 prompt 里**没有任何语言指令**：判读正文用什么语言完全是涌现的（大概率跟着文档语言
# 走）。于是英文用户上传中文文档，拿到的是一段中文正文配英文界面。语言必须是**受控输入**。
#
# 🔴 引文例外写死在指令里：evidence / cite 的原文**永不翻译**（ADR-0033 决定 4 ← ADR-0018
# 可溯源红线）。少了这一句，模型很自然地会"顺手把引文也翻了"——那一刻它就不再是引用，是编。
_LANGUAGE_INSTRUCTION = {
    "zh": (
        "Language: write EVERY word the manager reads — your read, your move, your framing, "
        "your direct answers — in Simplified Chinese. This is not a preference; it is the "
        "language the manager chose in the product. Do not mix in English sentences. "
        "EXCEPTION, and it is absolute: when you quote the manager's own documents, reproduce "
        "the quoted text EXACTLY as it appears in the source — never translate a quotation. "
        "Quoting is quoting; a translated quote is something you made up."
    ),
    "en": (
        "Language: write EVERY word the manager reads — your read, your move, your framing, "
        "your direct answers — in English. This is not a preference; it is the language the "
        "manager chose in the product, and it holds even when the source documents are in "
        "another language. "
        "EXCEPTION, and it is absolute: when you quote the manager's own documents, reproduce "
        "the quoted text EXACTLY as it appears in the source — never translate a quotation. "
        "Quoting is quoting; a translated quote is something you made up."
    ),
}


def language_instruction(locale: str) -> str:
    """给定 locale 的语言指令段（进 system prompt）。未知 locale 按默认值给，绝不返回空串——
    返回空串就等于悄悄退回"语言靠涌现"，而那正是本票要修的东西。"""
    return _LANGUAGE_INSTRUCTION.get(locale, _LANGUAGE_INSTRUCTION[DEFAULT_LOCALE])
