# -*- coding: utf-8 -*-
"""feat-056 · 决策定级的**规则表**（口径的唯一机器真源）。

Danny 拍板 a+b（`.issues/v02-partner-align-0718/decisions.md` 三·6）：
**等级归规则、文字归 Avery；Avery 只许上调、不许下调。**

本文件只放**数据**：等级词表、关键词族、阈值、规则条目。判定逻辑在
`avery/decision_grading.py`，人类可读的说明在 `eval-harness/decision_grading_rules.md`
（三家外部公司问"凭什么说这条高风险"时，当场给他们看的就是那份 .md）。
`tests/test_decision_grading.py::test_rules_doc_in_sync` 保证三者不脱节。

🔴 口径**不许埋进 prompt**：LLM 拿不到改判等级的权力，它只能读本表算出的等级、写一句人话，
或者带着理由**往上**调。

设计取舍（基于实测真 payload 覆盖率，不是想象）：
    signals 关键词 17/17 · blockers 13/17 · status 13/17 · dueDate 7/17 · progress 6/17
后两项只有三分之一覆盖 → 纯规则必有盲区，这正是留给 Avery 上调的口子。
🔴 **绝不能因为 dueDate/progress 缺失就默认判低危**——"文档没说"不等于"没风险"。
落在规则里就是 `R-NO-EVIDENCE`：关键字段全缺 → `需确认`（而不是 `可推进`）。
"""
from __future__ import annotations

from dataclasses import dataclass

# --- 三档等级 ---------------------------------------------------------------------------------
# 机器键稳定（前端 057 按它排序/分组）。用户面的三个词由**前端 i18n 表**出
# （ADR-0033：后端不再产出人话），后端只发这三个键。
HIGH_RISK = "high_risk"
NEEDS_CONFIRMATION = "needs_confirmation"
CAN_PROCEED = "can_proceed"

GRADES: tuple[str, ...] = (HIGH_RISK, NEEDS_CONFIRMATION, CAN_PROCEED)

# 数值越大越紧急 —— 「今天要决策的」的排序键，也是"只许上调不许下调"的比较依据。
SEVERITY: dict[str, int] = {CAN_PROCEED: 1, NEEDS_CONFIRMATION: 2, HIGH_RISK: 3}

# 🔴 ADR-0033 之后 LABEL_ZH **不再进任何 HTTP 载荷**。它只剩一个用途：`decision_grading_rules.md`
# ——那份给客户当场看的中文口径说明书——里的三档词必须和这里一致（`test_rules_doc_in_sync`
# 是唯一读它的地方）。用户面的三档词住在 `src/shared/i18n/{en,zh}.ts` 的
# `lite2.decisionGrades`，zh/en 各一份，`test_frontend_i18n_covers_every_rule` 守它不缺项。
# 谁要是在 `to_dict()` 里把它加回去，就等于把"后端发中文、英文用户看中英夹杂"整类缺陷复活。
LABEL_ZH: dict[str, str] = {
    HIGH_RISK: "高风险",
    NEEDS_CONFIRMATION: "需确认",
    CAN_PROCEED: "可推进",
}


# --- 阈值（全部具名，不许在逻辑里写魔法数字）-------------------------------------------------
# dueDate 已过 → 高风险；未过但落在 DUE_SOON_DAYS 内 → 需确认。
DUE_SOON_DAYS = 7
# 进度与到期日不匹配：dueDate 落在 DUE_CRUNCH_DAYS 内（含已过期）且 progress < PROGRESS_CRUNCH_PCT
# → 高风险。两个字段都到齐才算，所以只覆盖约三分之一的项目——剩下的交给 Avery 上调。
DUE_CRUNCH_DAYS = 14
PROGRESS_CRUNCH_PCT = 60
# 自报进度落后（与到期日无关）→ 需确认。
PROGRESS_LOW_PCT = 40
# 未解阻塞：>= BLOCKER_STACK_N 条并存 → 高风险；1 条 → 需确认。
BLOCKER_STACK_N = 2
# 年份推断窗口。中文周报写到期日几乎不写年份（"8月15日"），要判时间类规则就得补一个年份：
# 先按 as_of 当年算，算出来的日子若已过去超过这么多天，就认为说的是下一年的同一天。
# 90 天 = 一个季度：周报提到的到期日不会是三个月前的事，但很可能是下一个一月。
DUE_YEAR_LOOKBACK_DAYS = 90
# 资料陈旧窗口（gap-design-0805 · B1）：**手上最新的一份资料**都已经这么多天没更新了 → 需确认。
# 45 天怎么来的：这套系统吃的是周报与月度进度报告，而**上传**节奏比撰写节奏稀疏得多——
# 经理是想起来才灌一批。30 天正落在正常呼吸区间里（春节停三四周、淡季漏一个月报都算正常经营），
# 那时开口是在客户最不投入的时候指责他；60 天则让整整一个季度的判断骑在没人肯背书的资料上。
# 45 = 漏掉一个完整月度周期 + 两周宽限，是"连着两个月没交东西"第一次可被证明为真的那个点。
# 附带一个工程理由：这是唯一一条要把 as_of（date）与 uploaded_at（带时区的 datetime）对齐的规则，
# 窗口取大 = 对那个跨日边界的减震（45 天上差一天是 2% 误差，7 天上就是 14%）。
STALE_EVIDENCE_DAYS = 45


# --- 关键词族 ---------------------------------------------------------------------------------
# 匹配方式：对 signal.summary / signal.tag / blockers 行做**大小写无关的子串**匹配。中文没有词边界，
# 子串是唯一稳的做法；英文条目一律用小写、且尽量选不会误伤的长词（不放 "quit" 之外的短词）。
# 三家外部公司一家中文（三亚鹿山雅居）、一家英文（瑞典建筑）、一家中文（融资团队）→ 中英双写。

# 高风险族一：流失 / 离职（kickoff 点名）
KW_ATTRITION: tuple[str, ...] = (
    "流失", "离职", "辞职", "请辞", "辞呈", "跳槽", "挖角", "出走", "走人", "人员流动",
    "attrition", "resign", "resignation", "quit", "turnover", "notice period",
    "headhunt", "leaving the company", "left the company", "stepping down",
)

# 高风险族二：投诉 / 客诉（kickoff 点名）
KW_COMPLAINT: tuple[str, ...] = (
    "投诉", "客诉", "差评", "维权", "索赔", "退款", "退订", "退房", "退单", "不满",
    "complaint", "complained", "escalation", "churn", "refund", "cancellation",
    "bad review", "dissatisf",
)

# 高风险族三：冲突（kickoff 点名）
KW_CONFLICT: tuple[str, ...] = (
    "冲突", "矛盾", "争执", "内耗", "对立", "扯皮", "吵", "翻脸", "互相推",
    "conflict", "clash", "friction", "infighting", "standoff", "fell out",
    "blame", "disagree",
)

# 高风险族四：法务 / 安全 / 停工。kickoff 没点名，但三家里有一家是**建筑公司**，
# 漏报比误报贵（Danny 明文），所以单列一族、可审计、可关。
KW_INCIDENT: tuple[str, ...] = (
    "诉讼", "违约", "仲裁", "起诉", "罚款", "查封", "停工", "停摆", "罢工", "事故",
    "工伤", "安全隐患", "合规风险", "资金链",
    "lawsuit", "litigation", "arbitration", "breach of contract", "penalty",
    "shutdown", "work stoppage", "strike", "safety incident", "injury", "non-compliance",
)

# 需确认族：够不上高风险、但明确是个待办的信号。
KW_WATCH: tuple[str, ...] = (
    "延期", "推迟", "拖期", "逾期", "返工", "重做", "加班", "超支", "超预算", "缺人",
    "人手不足", "等待", "待定", "未定", "待确认", "待批", "审批中", "风险", "卡住", "搁置",
    "delay", "delayed", "postpone", "slip", "rework", "overtime", "over budget",
    "understaffed", "short-handed", "waiting on", "pending", "unclear", "tbd",
    "at risk", "blocked on", "on hold", "stalled",
)

KEYWORD_FAMILIES: dict[str, tuple[str, ...]] = {
    "attrition": KW_ATTRITION,
    "complaint": KW_COMPLAINT,
    "conflict": KW_CONFLICT,
    "incident": KW_INCIDENT,
    "watch": KW_WATCH,
}

# status 词表（`avery/ingest/extract.py::_norm_status` 的产出，唯一来源）。
STATUS_BLOCKED = "blocked"
STATUS_AT_RISK = "at-risk"
STATUS_DONE = "done"
STATUS_STEADY: frozenset[str] = frozenset({"on-track", "steady"})


# --- 规则表 -----------------------------------------------------------------------------------

@dataclass(frozen=True)
class Rule:
    """一条定级规则。`id` 是给经理看的可引用编号——前端 057 展开决策时逐条列出。"""
    id: str
    grade: str
    title_zh: str      # 一行中文：这条规则说的是什么
    basis: str         # 依据哪个字段（可审计：告诉对方这个判断的数据来源）


RULES: tuple[Rule, ...] = (
    # ---- 高风险 ----
    # 关键词族的四条：扫的是**关联信号原文 + 阻塞原文**（两处都可能写着"客户投诉""等法务"），
    # 所以 basis 如实写两个字段，不写成只看 signals。
    Rule("R-SIGNAL-ATTRITION", HIGH_RISK, "关联信号提到人员流失 / 离职", "signals + blockers"),
    Rule("R-SIGNAL-COMPLAINT", HIGH_RISK, "关联信号提到客户投诉 / 退订", "signals + blockers"),
    Rule("R-SIGNAL-CONFLICT", HIGH_RISK, "关联信号提到协作冲突", "signals + blockers"),
    Rule("R-SIGNAL-INCIDENT", HIGH_RISK, "关联信号提到法务 / 安全 / 停工", "signals + blockers"),
    Rule("R-STATUS-BLOCKED", HIGH_RISK, "项目自报状态为「已阻塞」", "status"),
    Rule("R-BLOCKER-STACK", HIGH_RISK,
         f"同时挂着 {BLOCKER_STACK_N} 条及以上未解阻塞", "blockers"),
    Rule("R-OVERDUE", HIGH_RISK, "到期日已过", "dueDate"),
    Rule("R-DUE-VS-PROGRESS", HIGH_RISK,
         f"{DUE_CRUNCH_DAYS} 天内到期、但自报进度不足 {PROGRESS_CRUNCH_PCT}%",
         "dueDate + progress"),

    # ---- 需确认 ----
    Rule("R-STATUS-AT-RISK", NEEDS_CONFIRMATION, "项目自报状态为「有风险」", "status"),
    Rule("R-BLOCKER-ONE", NEEDS_CONFIRMATION, "挂着 1 条未解阻塞", "blockers"),
    Rule("R-DUE-SOON", NEEDS_CONFIRMATION, f"{DUE_SOON_DAYS} 天内到期", "dueDate"),
    Rule("R-PROGRESS-LOW", NEEDS_CONFIRMATION,
         f"自报进度不足 {PROGRESS_LOW_PCT}% 且未完成", "progress"),
    Rule("R-SIGNAL-WATCH", NEEDS_CONFIRMATION, "关联信号提到延期 / 返工 / 缺人等待办",
         "signals + blockers"),
    Rule("R-SELF-REPORT-MISMATCH", NEEDS_CONFIRMATION,
         "自报「正常」但挂着未解阻塞（自述与信号不一致）", "status + blockers"),
    # gap-design-0805 · B1：判断的**新鲜度**。这条不看项目字段，看的是这些字段读自的那批资料
    # 有多老 —— 拿一个半月前的纸换来的「可推进」，本来就不该被展示成可推进。
    # 🔴 措辞只说"我们手上最新的一份资料"，不说"你没有再传"：谁传没传是他的事，我们只报读到什么。
    # 🔴 判据取的是**全库最新一份**的上传时间，不是这个项目自己那份 —— 理由见
    # decision_grading.py 的 `_m_stale_evidence`（归并会让"这个项目自己那份"指错文档）。
    Rule("R-STALE-EVIDENCE", NEEDS_CONFIRMATION,
         f"手上最新的一份资料也是 {STALE_EVIDENCE_DAYS} 天以前上传的，之后没再读到新的",
         "资料上传时间"),
    # 🔴 措辞：说的是"我没读到"，不是"文档没写"。抽取层读不出来（中文标签、非常规排版）时，
    # 后者是当着客户的面否认他自己写过的字——这句话会原样打到经理屏幕上。
    Rule("R-NO-EVIDENCE", NEEDS_CONFIRMATION,
         "没读到状态、阻塞、进度、到期日中的任何一项——信息不足，不能当作没风险",
         "（全部字段缺失）"),
    # 🔴 对抗复审 fixB2：`grade_project()` 真跑到"一条规则都没命中"时的手动兜底（decision_
    # grading.py 的 else 分支）此前直接借用了上面这条 R-NO-EVIDENCE 的标题——但触发场景往往
    # 恰恰是「字段没有全缺」（如 progress=80、status 是抽取层没归一的词），于是卡面印着
    # 「80%」，理由却写「没读到...进度中的任何一项」，自相矛盾。等级判断没错（仍是需确认，
    # 不是可推进）；这条规则只是把那句话换成不借别人名字的措辞。
    Rule("R-UNCLASSIFIED", NEEDS_CONFIRMATION,
         "读到的字段没有落在任何一条现有规则的判据里，无法直接归类，需要人工确认",
         "（未命中任何规则）"),

    # ---- 可推进 ----
    Rule("R-DONE", CAN_PROCEED, "项目自报已完成，且无风险信号", "status"),
    Rule("R-CLEAR", CAN_PROCEED, "项目自报正常，无未解阻塞、无风险信号", "status + blockers"),
)

RULE_IDS: tuple[str, ...] = tuple(r.id for r in RULES)
RULES_BY_ID: dict[str, Rule] = {r.id: r for r in RULES}

# --- 规则展示参数（ADR-0033）-------------------------------------------------------------------
# 上面 `title_zh` 里那几个 f-string 插值（"7 天内到期"、"同时挂着 2 条及以上"）在 ADR-0033 之后
# **不再随载荷发中文句子**——句子由前端 i18n 表按 rule_id 渲染。但阈值本身是**后端配置**
# （Danny 调 DUE_SOON_DAYS 就该跟着变），所以句子归前端、数字仍归后端：这张表随每条命中一起发，
# 前端拿它填模板占位符。
#
# 🔴 别把这些数字抄进前端硬编码——那就是又开了一个会静默漂的事实源，正是本 ADR 要铲掉的东西。
# 这里只放**静态阈值**；「已过 12 天」这类每次命中都不同的数不进来，它们的载体是 evidence
# 里那行字段读数（`dueDate="2026-07-10"`），本来就是语言中立的。
RULE_PARAMS: dict[str, dict[str, int]] = {
    "R-BLOCKER-STACK": {"n": BLOCKER_STACK_N},
    "R-DUE-SOON": {"days": DUE_SOON_DAYS},
    "R-DUE-VS-PROGRESS": {"days": DUE_CRUNCH_DAYS, "pct": PROGRESS_CRUNCH_PCT},
    "R-PROGRESS-LOW": {"pct": PROGRESS_LOW_PCT},
    # 🔴 这里放的是**阈值**（"45 天以上"），不是这批资料的实际年龄（"已经 62 天了"）。
    # 后者每次命中都不同，按上面那条红线一律不进 params —— 它的载体是 evidence 里
    # 那行 `uploaded_at="2026-06-20"`，语言中立、且差一天也仍然为真（实际天数要拿
    # 服务端本地 date 减 UTC 时间戳，跨日会差一天，写进句子就是屏幕上一句假话）。
    "R-STALE-EVIDENCE": {"days": STALE_EVIDENCE_DAYS},
}


def rule(rule_id: str) -> Rule:
    return RULES_BY_ID[rule_id]
