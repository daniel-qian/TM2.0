"""Live-input path: turn a manager's typed situation into what the loop eats.

The engine's `read_case` tool reads `ToolContext.case_path` — a file on disk. Read-only demo mode
fed it a frozen case fixture. The service instead accepts a manager's *typed* management situation
and materializes it into a temporary case file (same on-disk shape the loop already knows), so the
loop runs UNCHANGED. Nothing in `avery/` is touched.

For MockBrain (deterministic, no key) the loop needs a MOCK block naming which memory lines to
cite; we synthesize a minimal one that cites real `facts.md` lines so the cite gate + red line are
still exercised on the live path. RealBrain / OpenAICompatBrain ignore the MOCK block entirely and
reason over the free text.
"""
from __future__ import annotations

import json
import re
import tempfile
from dataclasses import dataclass
from pathlib import Path

from avery import memory
from avery.cases import Case, load_case
from avery.locale import DEFAULT_LOCALE


@dataclass
class LiveSituation:
    """A management situation typed in live (replaces the read-only case fixture)."""
    situation: str                         # free-text: what's going on + the ask
    title: str | None = None               # optional short label
    company_context_id: str | None = None  # feat-016 stub — ingested company RAG handle
    case_id: str | None = None             # optional stable id; else derived
    # ADR-0033: 判读正文的语言，由请求带下来（前端 `?lang= > localStorage > env > en` 那条链）。
    # 真 brain 从 system prompt 里的语言指令拿它；MockBrain 从下面的 MOCK 块拿它。
    locale: str = DEFAULT_LOCALE
    # #64 · @ 引用的注入块（服务层用 avery.ingest.references.build_reference_block 造好后
    # 挂在这里）。两个去处：① case 正文长一段 `## Referenced records (@)`（read_case 看得见）；
    # ② app.py 把同一块作为 preamble 交给 stream_advice，**保证**进开场 user 轮。
    # None = 这次提问没带引用（或引用全部无效）——case 与开场轮都一字不多。
    reference_block: str | None = None


def _slugify(text: str, fallback: str = "live-situation") -> str:
    """Derive a case_id from the manager's typed situation.

    THE CHARACTER CLASS IS THE SAME LORE AS avery/ingest/extract.py::_slug — READ THAT DOCSTRING.
    This was `[^a-z0-9]+`, which is ASCII-only: every Han character fell outside the class, the
    string emptied, and the fallback fired — so EVERY Chinese situation became the same case_id,
    the literal string "live-situation". The all-Chinese Sanya path walks straight through here
    (build_live_case below: `case_id = sit.case_id or _slugify(...)`), so two different situations
    typed by the same manager were one case.

    `[\\W_]` and not the obvious `[^\\w]`: on str patterns `\\w` is unicode-aware (Han passes) but it
    also counts '_' as a word character, so `[^\\w]+` would stop folding underscores next to a space
    and change ENGLISH case ids ('Roadmap_ Q3' -> 'roadmap--q3'). On ASCII input `[\\W_]` is
    provably identical to the old `[^a-z0-9]` (after .lower(), \\w == [a-z0-9_], so
    [\\W_] == complement([a-z0-9]); verified exhaustively over all 128 ASCII codepoints).
    test_cjk_identity.py freezes the English half row by row.
    """
    slug = re.sub(r"[\W_]+", "-", (text or "").lower()).strip("-")
    return (slug[:48] or fallback)


# 0729/03 · 事实查询判别（mock 专用，窄正则宁漏勿错杀——详见 _default_mock_block 内注释）。
# 命中=纯查数/查时间/查日期/查状态的问法；判断类问题（谁需要帮助/该怎么办/为什么）不命中。
# ⚠ 只收「疑问式查询」短语；deadline/截止 这类**话题词**不进正则——判断类问题
# （"quiet before deadlines, how should I approach it"）撞上话题词被劈成短答就是错杀。
_FACTUAL_RE = re.compile(
    r"(几点|几号|哪一?天|什么时候|何时|多少|几个|几人|几位|"
    r"what time|when is|when does|how many|how much|which date)",
    re.IGNORECASE,
)


def _looks_factual(situation: str) -> bool:
    return bool(_FACTUAL_RE.search(situation or ""))


# ── MockBrain 的罐头正文，按 locale 取（ADR-0033 决定 3）────────────────────────────────────
#
# 为什么罐头也要双语：真 brain 的语言由 system prompt 那段指令管，但**离线电池跑的是 mock**。
# 罐头永远是英文的话，"正文语言 == 请求 locale"这条判据在 AFK 环境里根本采不到 zh 的样，
# 于是这条判据恒绿——恰好是本仓反复栽的那种"采不到样的判据"（记忆 verifiers-that-lie）。
#
# 🔴 它读的必须是**同一个** locale 字段（随请求下传的那个），不许另开一个 mock 专用开关：
# 门验的是「locale 从 URL 一路走到正文」这条链，中间任何一节换成别的输入，验的就不是那条链了。
#
# 🔴 红线（ADR-0018）在罐头上一视同仁：不给人打分/排名、不替客户断言"你文档里没有 X"、
# 一切结论挂在被引用的那行原文上。中英两版说的是同一件事，不是互相翻译练习。
_MOCK_ADVICE = {
    "en": {
        "read": ("Here is the situation as the evidence actually reads, not a judgment of "
                 "the person: the pattern you describe is real and worth understanding, "
                 "and nobody has yet heard the story behind it. Name the work and its "
                 "effect on the team; keep the read on the situation, never on the person."),
        "move": ("Have the direct conversation this week, in a 1:1, not over chat. Lead "
                 "with the specific, observable pattern and its effect on the team, then "
                 "genuinely ask what is going on and listen. Agree on what 'back on track' "
                 "looks like and a near date to check it — supportive if there is a "
                 "fixable cause, and still clear about what has to change either way."),
        "framing": ("Open as a colleague who noticed, not a manager who is policing: "
                    "'I've noticed the last few weeks have been bumpy, and that's not "
                    "where you usually are. I'm not here to put you on the spot — I want "
                    "to understand what's going on and help get you back to solid. Walk me "
                    "through it.' Specific, owned, no surprises — and no scoring anyone."),
    },
    "zh": {
        "read": ("先按文件里真实写着的东西说，这不是对人的评价：你描述的那个情况是真的，"
                 "值得弄清楚，而到现在为止还没人听过背后的原委。把话说在这件事和它对团队的"
                 "影响上，不要落到人身上。"),
        "move": ("这周就当面谈一次，一对一，别在群里说。开场先说清楚你具体看到了什么、"
                 "它对团队产生了什么影响，然后真的问一句「到底怎么回事」，并且听完。"
                 "谈完约定「回到正轨」具体是什么样子，再定一个近期的时间点回看一次——"
                 "如果原因是能解决的就给支持，但不管原因是什么，该变的地方都要说清楚。"),
        "framing": ("用「同事注意到了」的姿态开口，别用「经理来查岗」的姿态：「这几周好像不太顺，"
                    "跟你平时的状态不一样。我不是来问责的，是想知道发生了什么，"
                    "看看怎么帮你缓过来。你跟我说说。」具体、认账、不搞突然袭击——"
                    "也不给任何人打分。"),
    },
}

_MOCK_SHORT_ANSWER = {
    "en": ("Direct answer, grounded in the cited line — (mock backend: this canned sentence "
           "demonstrates the short-answer path; a real brain reads the actual fact out of your "
           "documents here)."),
    "zh": ("直接回答，依据就是上面引的那一行——（mock 后端：这句罐头只是把「短答」这条出口"
           "走通给你看；真 brain 在这里读的是你文档里那个实际的事实）。"),
}

# #72 · 建议追问的罐头（固定 2 条，离线门可跑）。与 _MOCK_ADVICE/_MOCK_SHORT_ANSWER 同一套
# 纪律：① 按 locale 取（离线电池只有 mock，罐头不双语则 zh 判据永远采不到样）；② 文案自报
# mock 身份（诚实口径——真 brain 在这个槽里产出的才是贴合语境的追问）；③ 红线一视同仁：
# 问"事"，不问"人"的评分/排名——这两对问题会逐条过 contract._project_followups 的问题门。
_MOCK_FOLLOWUPS_ADVICE = {
    "en": ["How should I open that conversation? (mock sample)",
           "What if nothing changes after the talk? (mock sample)"],
    "zh": ["这场谈话我该怎么开场？（mock 示例追问）",
           "谈完之后情况没改善，下一步怎么办？（mock 示例追问）"],
}
_MOCK_FOLLOWUPS_ANSWER = {
    "en": ["What other records touch on this? (mock sample)",
           "Is there anything here I should verify in person? (mock sample)"],
    "zh": ["相关的记录还有哪些可以看？（mock 示例追问）",
           "这件事还有哪里需要当面核实？（mock 示例追问）"],
}


def _default_mock_block(memory_dir: Path, situation: str, locale: str = DEFAULT_LOCALE) -> dict:
    """A minimal deterministic plan for MockBrain on the live path.

    Picks up to a few real facts.md lines related to the typed situation (via the same keyword
    recall the loop uses) and cites them, then drafts humane, red-line-clean advice grounded in
    the typed text. This keeps the AFK contract battery exercising the FULL path (cite gate + red
    line + 8-field projection) with no API key. RealBrain ignores this block.

    `locale` picks which canned prose comes back — see `_MOCK_ADVICE` for why that matters.
    """
    hits = memory.recall(situation, memory_dir, limit=3)
    # Fall back to the always-present head lines if the keyword recall finds nothing.
    if not hits:
        cites = [{"claim": "Grounding this in the company's own record before advising",
                  "source_ref": "facts.md:1"}]
        recall_queries = [situation[:60]]
    else:
        cites = [{"claim": f"Grounded in the record: {h.text[:80]}", "source_ref": h.source}
                 for h in hits]
        recall_queries = [situation[:60]]

    # 0729/03 分流短答（mock 侧）：事实查询型问题（几点/哪天/多少这类）给 answer 罐头，
    # 让门电池能离线测到两条出口。真 brain 由提示词判据自行选工具，不走这个正则。
    # 🔴 判据刻意收窄：只认明确的「查数/查时间」词，宁可漏（漏=多给一张结构卡，无害）
    # 不可错杀（错杀=判断类问题被降成一句话）。「谁的项目最需要我搭把手」这类含疑问词
    # 但要判断的问题必须继续走 advice 路。
    # 🔴 未知 locale 在这里**不静默兜底成一份空罐头**：取不到就退 DEFAULT_LOCALE 的那份。
    # 服务层入口已经 normalize 过（app.py），这里是第二道保险——mock 罐头缺席会让门看到一段
    # 空正文，而"空"最容易被误读成"语言判据没采到样"。
    lang = locale if locale in _MOCK_ADVICE else DEFAULT_LOCALE

    if _looks_factual(situation):
        return {
            "prompt": situation.strip(),
            "avery": {
                "recall_queries": recall_queries,
                "cites": cites,
                # #72 · followup_questions 与 text 同层：make_mock_brain 会把它带进
                # answer_direct 的工具入参（短答路的追问 chips 由此可离线测到）。
                "answer": {"text": _MOCK_SHORT_ANSWER[lang],
                           "followup_questions": list(_MOCK_FOLLOWUPS_ANSWER[lang])},
            },
        }

    return {
        "prompt": situation.strip(),
        "avery": {
            "recall_queries": recall_queries,
            "cites": cites,
            "advice": {**_MOCK_ADVICE[lang],
                       # #72 · 同上：advice 路的罐头追问（draft_advice 工具入参）。
                       "followup_questions": list(_MOCK_FOLLOWUPS_ADVICE[lang])},
        },
    }


def build_live_case(sit: LiveSituation, memory_dir: Path, *, work_dir: Path | None = None,
                    with_mock: bool = True) -> Case:
    """Materialize a temporary case file from a typed situation and load it as a `Case`.

    with_mock=True  -> embed a deterministic MOCK block (MockBrain runs green AFK).
    with_mock=False -> raw situation only (real brains reason over it; no scripted plan).

    Returns a `Case` whose `.path` is a real temp file the loop's read_case can read. Caller may
    delete the file after the loop finishes (see `discard`).
    """
    work_dir = Path(work_dir) if work_dir else Path(tempfile.gettempdir()) / "avery-live-cases"
    work_dir.mkdir(parents=True, exist_ok=True)

    case_id = sit.case_id or _slugify(sit.title or sit.situation)
    title = sit.title or "Live situation"

    parts = [
        f"# Case: {title}",
        "",
        "Raw management situation typed in by the manager (live input).",
        "",
        "## The situation",
        sit.situation.strip(),
        "",
        "## The ask",
        sit.situation.strip(),
    ]
    # #64: the same reference block the service pins into the opening user turn also lands in
    # the case body — read_case must show exactly what the opening turn pinned (one truth).
    if sit.reference_block:
        parts += ["", "## Referenced records (@)", "", sit.reference_block]
    if sit.company_context_id:
        # feat-016 stub: when ingestion is wired, the company RAG behind this id feeds recall().
        parts += ["", f"<!-- company_context_id: {sit.company_context_id} (feat-016 stub) -->"]
    body = "\n".join(parts)

    if with_mock:
        mock = _default_mock_block(memory_dir, sit.situation, sit.locale)
        body += "\n\n<!-- MOCK\n" + json.dumps(mock, ensure_ascii=False, indent=2) + "\n-->\n"

    # Unique filename so concurrent requests never collide.
    fd, name = tempfile.mkstemp(prefix=f"{case_id}-", suffix=".md", dir=str(work_dir))
    path = Path(name)
    import os
    os.close(fd)
    path.write_text(body, encoding="utf-8")

    case = load_case(path)
    return case


def discard(case: Case) -> None:
    """Delete a live case's temp file (sampler = ephemeral session; nothing persists)."""
    try:
        Path(case.path).unlink(missing_ok=True)
    except OSError:
        pass
