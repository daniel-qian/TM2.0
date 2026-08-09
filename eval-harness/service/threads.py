"""issue #78 — advise-thread id 的形状闸（服务层，与 history.py 同一种住法）。

一句话分工：**thread_id 回答「这一行属于哪一场」，history 回答「这一问带多少上下文」。**
两者互不代班——服务端**不**根据 thread_id 去库里补历史轮（那会让 service/history.py 头注
「Nothing here is persisted」直接作废，还会与请求体里的 history 变成双份上下文）。

为什么只做形状校验、不查库：
  被中止或被红线拦下的第一轮**根本不落行**（app.py::_persist_advise_run 的空产出闸），
  那一刻客户端已经握着这一场的 id。要是这里加一条「这个 thread_id 必须在本 context 有行」，
  用户眼里连续的一场就会被劈成两场——校验反过来咬自己。

为什么坏值降级而不是 422：
  与 locale 同一条纪律（app.py 的 locale 刻意不写 Literal）。thread_id 是 additive optional，
  它的坏值不该让一次正常提问失败；当没带处理即可，服务端会铸一个新的并回传。

跨公司复用不在这里挡：所有分组查询都 `WHERE context_id = %s` 收口，拿 A 公司的 id 去问 B 公司
既不泄露也不并场，最坏是 B 公司下多一个同名的场。前端侧把 threadId 放进了公司域清理清单
（src/lite2/store.ts 三抄本），自家 UI 产不出这一幕。
"""

from __future__ import annotations

import re

# 与 avery/ingest/registry.py::new_thread_id 的产物（"thr_" + hex16 = 20 字符）留足余量。
# 上限不是为了防溢出，是为了让「一个明显不是 id 的长串」当场落地成「没带」。
THREAD_ID_MAX_CHARS = 64

# 🔴 这个字符集与 pg_registry.list_advise_threads 的分组键强耦合：那里用 `'run:' || id` 给
# 无场归属的行造合成键，靠的正是**冒号不在这个集合里**。放宽这个正则前先去改那处。
_THREAD_ID_RE = re.compile(r"[A-Za-z0-9_-]{1,%d}" % THREAD_ID_MAX_CHARS)


def normalize_thread_id(raw: object) -> str:
    """把请求体里的 thread_id 归一成「可用的 id」或空串（= 当作没带，调用方去铸新的）。

    非字符串、空白、超长、含集合外字符 —— 一律返回空串，不抛异常。
    """
    if not isinstance(raw, str):
        return ""
    s = raw.strip()
    if not s or len(s) > THREAD_ID_MAX_CHARS:
        return ""
    return s if _THREAD_ID_RE.fullmatch(s) else ""
