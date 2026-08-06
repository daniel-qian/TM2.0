# -*- coding: utf-8 -*-
"""员工侧 H5 的共用骨架 —— 服务端直出、零外部资源的那层壳。

出身：这三件（转义 / 内联 CSS / 页面模板）是 feat-034 的快问员工页 `service/ask_api.py` 写的，
一直只有它一个用户。T1（常驻表单，`service/form_api.py`）要的是**同一张壳**——同一套排版、同一
条「IM webview 里没有任何外部资源可拦」的纪律、同一份 og/noindex 头。所以把它们从 ask_api 提到
这里，两个员工页共用一份，而不是复制一份去漂。

⚠ 提取是**机械**的：`esc` / `H5_CSS` / `page` 与提取前逐字节相同，`page()` 新增的 `css` 参数带
默认值，ask 侧调用点一个字没改、渲染出的 HTML 也一个字节没变（`tests/test_ask_h5.py` 是这句话的
执法者）。表单页要多几条 CSS 规则，走 `page(..., css=H5_CSS + 自己的)`，不往共用表里加。

零外部资源不是审美偏好：员工在微信/企业微信内置浏览器里打开链接，任何外链（CDN 字体、图标、
统计脚本）都可能被拦、被慢、被记。所以这里只有 inline `<style>`，没有 `<script src>`、没有
`<link rel=stylesheet>`、没有远程图片。
"""
from __future__ import annotations

import html


def esc(s: str) -> str:
    return html.escape(s or "", quote=True)


H5_CSS = """
*{box-sizing:border-box;margin:0;padding:0;font-family:system-ui,-apple-system,'PingFang SC',
'Microsoft YaHei',sans-serif}
body{background:#f6f4ef;color:#1f2328;padding:16px;max-width:560px;margin:0 auto;line-height:1.55}
.h5-card{background:#fff;border:1px solid #e4dfd5;border-radius:14px;padding:20px;margin-top:12px}
h1{font-size:1.15rem;margin-bottom:6px}
.h5-meta,.h5-who,.h5-what,.h5-visibility{font-size:.85rem;color:#5b6068;margin:3px 0}
.h5-meta b,.h5-who b,.h5-what b,.h5-visibility b{color:#1f2328}
.h5-for{font-size:.85rem;color:#5b6068;margin-top:10px}
.h5-q{margin:18px 0 6px;font-size:1rem;font-weight:600}
.h5-hint{font-size:.78rem;color:#8a8f98;margin-bottom:8px}
.h5-scale,.h5-yn{display:flex;gap:8px}
.h5-scale label,.h5-yn label{flex:1;text-align:center}
.h5-scale input,.h5-yn input{position:absolute;opacity:0;width:0;height:0}
.h5-btn{display:block;padding:14px 0;border:1.5px solid #d8d2c6;border-radius:12px;font-size:1.05rem;
cursor:pointer;user-select:none;background:#faf9f6}
input:checked+.h5-btn{border-color:#1f6f5c;background:#e8f3ef;font-weight:700}
textarea{width:100%;min-height:64px;border:1.5px solid #d8d2c6;border-radius:12px;padding:10px;
font-size:1rem;margin-top:6px;background:#faf9f6}
.h5-submit{width:100%;margin-top:20px;padding:15px 0;border:0;border-radius:12px;background:#1f6f5c;
color:#fff;font-size:1.1rem;font-weight:700;cursor:pointer}
.h5-lang{display:inline-block;margin-top:14px;font-size:.8rem;color:#5b6068}
.h5-status h1{font-size:1.3rem;margin-bottom:10px}
"""


def page(L: dict, og_title: str, og_desc: str, body_html: str, lang_attr: str,
         css: str = H5_CSS) -> str:
    """一整张员工页。`L` 是该语言的文案字典（至少要有 `title` 与 `lang_switch`）。"""
    return (
        "<!doctype html>\n"
        f'<html lang="{lang_attr}"><head>\n'
        '<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
        '<meta name="robots" content="noindex">\n'
        f'<meta property="og:title" content="{esc(og_title)}">\n'
        f'<meta property="og:description" content="{esc(og_desc)}">\n'
        '<meta property="og:type" content="website">\n'
        f"<title>{esc(L['title'])}</title>\n"
        f"<style>{css}</style>\n"
        "</head><body>\n"
        f"{body_html}\n"
        f"{L['lang_switch']}\n"
        "</body></html>"
    )
