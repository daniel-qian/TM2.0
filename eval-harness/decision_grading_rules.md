# 决策定级口径（feat-056）

> 这份文件是**给人看的定级说明书**。当有人问"凭什么说这条高风险"，直接把下面的表给他。
> 机器真源是 `avery/decision_rules.py`（规则表）+ `avery/decision_grading.py`（判定逻辑），
> 由 `tests/test_decision_grading.py::test_rules_doc_in_sync` 保证与本文件一条不差。
>
> 🔴 口径**不在 prompt 里**。模型改不了等级——它只能读规则算出的等级、写一句人话，
> 或者**带着理由往上调**。

## 一句话原则

> **等级归规则，文字归 Avery。Avery 只许上调，不许下调。**

理由：三家外部公司拿**自己的真文件**来试。漏报一条真风险的代价，远高于多标一条需要确认的事。
所以整套口径在每一个不确定的岔路口，都往"更值得看一眼"的方向倒。

## 三档

| 等级 | 机器键 | 严重度 | 含义 |
|---|---|---|---|
| **高风险** | `high_risk` | 3 | 有明确的坏信号或硬约束已经踩线，今天就该看 |
| **需确认** | `needs_confirmation` | 2 | 有待办信号，**或者文档根本没说清楚**——需要人去确认 |
| **可推进** | `can_proceed` | 1 | 项目自己说正常，且没有任何风险信号 |

严重度就是「今天要决策的」的排序键（高 → 低；同级按标题排，稳定可复现）。

## 定级表

一条项目会同时命中多条规则；**最终等级 = 命中规则里最严重的那一档**。
每条命中都带着原文证据，在界面上展开即可逐条核对。

### 高风险

| 规则号 | 判据 | 看哪些字段 |
|---|---|---|
| `R-SIGNAL-ATTRITION` | 关联信号提到人员流失 / 离职 | signals + blockers |
| `R-SIGNAL-COMPLAINT` | 关联信号提到客户投诉 / 退订 | signals + blockers |
| `R-SIGNAL-CONFLICT` | 关联信号提到协作冲突 | signals + blockers |
| `R-SIGNAL-INCIDENT` | 关联信号提到法务 / 安全 / 停工 | signals + blockers |
| `R-STATUS-BLOCKED` | 项目自报状态为「已阻塞」 | status |
| `R-BLOCKER-STACK` | 同时挂着 2 条及以上未解阻塞 | blockers |
| `R-OVERDUE` | 到期日已过 | dueDate |
| `R-DUE-VS-PROGRESS` | 14 天内到期、但自报进度不足 60% | dueDate + progress |

### 需确认

| 规则号 | 判据 | 看哪些字段 |
|---|---|---|
| `R-STATUS-AT-RISK` | 项目自报状态为「有风险」 | status |
| `R-BLOCKER-ONE` | 挂着 1 条未解阻塞 | blockers |
| `R-DUE-SOON` | 7 天内到期 | dueDate |
| `R-PROGRESS-LOW` | 自报进度不足 40% 且未完成 | progress |
| `R-SIGNAL-WATCH` | 关联信号提到延期 / 返工 / 缺人等待办 | signals + blockers |
| `R-SELF-REPORT-MISMATCH` | 自报「正常」但挂着未解阻塞（自述与信号不一致） | status + blockers |
| `R-NO-EVIDENCE` | 文档没写状态、阻塞、进度、到期日——信息不足，不能当作没风险 | （全部字段缺失） |

### 可推进

| 规则号 | 判据 | 看哪些字段 |
|---|---|---|
| `R-DONE` | 项目自报已完成，且无风险信号 | status |
| `R-CLEAR` | 项目自报正常，无未解阻塞、无风险信号 | status + blockers |

## 关键词族

关键词做**大小写无关的子串匹配**，扫的是关联信号原文和阻塞原文。中英双写——三家公司里
两家出中文文档、一家（瑞典建筑公司）出英文文档。完整词表见
`avery/decision_rules.py` 的 `KEYWORD_FAMILIES`。

| 族 | 用在哪条规则 | 例词 |
|---|---|---|
| `attrition` 流失/离职 | `R-SIGNAL-ATTRITION` | 流失、离职、辞职、跳槽 / attrition、resign、turnover |
| `complaint` 投诉/退订 | `R-SIGNAL-COMPLAINT` | 投诉、客诉、维权、退款 / complaint、churn、refund |
| `conflict` 冲突 | `R-SIGNAL-CONFLICT` | 冲突、矛盾、内耗、扯皮 / conflict、friction、infighting |
| `incident` 法务/安全/停工 | `R-SIGNAL-INCIDENT` | 诉讼、违约、停工、工伤 / lawsuit、shutdown、safety incident |
| `watch` 待办 | `R-SIGNAL-WATCH` | 延期、返工、超支、缺人、待确认 / delay、rework、pending、on hold |

前四族是 Danny 在 kickoff 里点名的三类（流失/投诉/冲突/离职）加一族。
第四族 `incident` 是本线自行补的：三家里有一家是**建筑公司**，工地停工 / 工伤 / 违约
是这一行最贵的漏报，单列一族是为了可审计、可关。

## 阈值

| 常量 | 值 | 用途 |
|---|---|---|
| `DUE_SOON_DAYS` | 7 | 未过期但落在 7 天内 → 需确认 |
| `DUE_CRUNCH_DAYS` | 14 | 与进度联判的窗口 |
| `PROGRESS_CRUNCH_PCT` | 60 | 14 天内到期且进度低于此值 → 高风险 |
| `PROGRESS_LOW_PCT` | 40 | 进度低于此值且未完成 → 需确认 |
| `BLOCKER_STACK_N` | 2 | 达到这个条数的未解阻塞 → 高风险 |

## 🔴 缺数据怎么判（这一条最容易搞错）

我们的决策是从对方上传的文件里**自动长出来的**，不是人手敲的。实测真 payload 的字段覆盖率：

| 字段 | 覆盖 |
|---|---|
| `signals` 关键词 | 17/17 |
| `blockers` | 13/17 |
| `status` | 13/17 |
| `dueDate` | 7/17 |
| `progress` | 6/17 |

后两项只有三分之一。所以：

- **「文档没说」不等于「没风险」。** `dueDate` / `progress` 缺失**绝不**降级，它们只在
  **存在**时参与判定。缺失时对应规则直接不参评，不产生任何"看起来还行"的效果。
- **关键字段全缺 → `需确认`，不是 `可推进`**（`R-NO-EVIDENCE`）。要判 `可推进`，
  项目必须**明确自报**了 on-track / steady / done 且无风险信号——是一句正面陈述换来的，
  不是靠"什么都没写"混过去的。
- 到期日写了但解析不出来（比如"月底前"），按**未知**处理，不当作"还早"。
- 每条决策都带一份 `unknown_fields`，界面据此显示「文档未提及」——
  🔴 **绝不允许渲染成 0% 或空白**。

## 已知盲区（不藏着，这正是留给 Avery 上调的口子）

1. **没指名的信号不算数。** 信号要挂到项目上，需满足：`subjectId` 等于项目 id/标题，
   或它是负责人的 person 型信号，或项目标题出现在信号原文里。三条都不满足的信号
   **不会算到任何项目头上**——规则宁可漏，也不给全体项目无差别加码。
2. **只有三分之一的项目有 `dueDate`/`progress`**，所以时间和进度类规则天然覆盖不全。
3. **关键词是子串匹配，不懂否定式。** "客户投诉已全部关闭"里的"投诉"照样命中——
   偏向误报，与整体取向一致。
4. `blockers` 为空时，分不清"确实没有阻塞"和"文档没写阻塞"。

以上每一条，都可以由 Avery 在复核时**带着理由上调**来补。

## Avery 能做什么、不能做什么

| 动作 | 允许 | 结果 |
|---|---|---|
| 写那句人话理由 | ✅ | `reason` 换成它写的，`reason_source="avery"` |
| **上调**（配 `escalation_reason`） | ✅ | `grade` 提高，`escalated=true`，理由存进 `escalation_reason` |
| 上调但没写为什么 | ❌ | 不给调，`review_rejected="missing_reason"` |
| **下调** | ❌ **硬拦** | 等级保持规则值，`downgrade_blocked=true`，`rejected_grade` 记下它想判的那档 |
| 返回不认识的等级词 | ❌ | 整个复核作废，`review_rejected="unknown_grade"` |

下调被拦时，**它那句理由也一并丢弃**，退回机械理由。因为那句话是为更低一档写的，
贴在高一档上会自相矛盾——经理会看到「高风险」配一句「问题不大」。

`rule_grade` 字段**永远**保留规则原判，任何时候都能对账：规则说了什么、Avery 改了什么、为什么。

## 可复现性

`grade_project()` / `grade_projects()` 是纯函数：零 LLM、零网络、零随机。
同一份 payload + 同一个 `as_of` 进去，等级和命中规则逐字节一致。

时间类规则（`R-OVERDUE` / `R-DUE-SOON` / `R-DUE-VS-PROGRESS`）显式吃 `as_of` 参数
而不是在函数内部读时钟——"同一份文件连跑两次结果一致"因此是结构上成立的，不靠运气。
（到期日过了之后等级会升，这是对的：那是真实世界变了，不是判定不稳。）
