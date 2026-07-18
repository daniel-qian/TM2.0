# feat-056 · 决策定级（规则 + Avery 理由）· 收工报告

分支 `feat/056-decision-grading` · 工作树 `D:\avery-wt\056` · 2026-07-18

对应 PRD G5 / kickoff-dev.md §feat-056 / decisions.md 三·6（Danny 拍板 a+b）。

---

## 1 · 做了什么

**规则算等级、文字归 Avery、只许上调不许下调**，口径落成可读配置 + 可读文档，一行都没埋进 prompt。

### 新增文件

| 文件 | 作用 |
|---|---|
| `eval-harness/avery/decision_rules.py` | **口径的机器真源**。只有数据：三档词表、5 个关键词族、5 个阈值常量、18 条规则条目。零逻辑。 |
| `eval-harness/avery/decision_grading.py` | 引擎。`grade_project()` / `grade_projects()` 纯函数定级；`apply_review()` 贴 Avery 理由并硬拦下调；`parse_due_date()` 自由文本到期日解析。 |
| `eval-harness/decision_grading_rules.md` | **给人看的定级说明书**——客户问"凭什么说这条高风险"，当场给他看这份。与代码由测试保证同步。 |
| `eval-harness/tests/test_decision_grading.py` | 63 条门。 |

### 改动文件

| 文件 | 改了什么 |
|---|---|
| `eval-harness/avery/ingest/registry.py` | `CompanyContext.decision_cards(as_of=None)` —— 定级结果的唯一出口（内存 registry 与 pg_registry 共用同一个 `CompanyContext`，一处加两处都有）。 |
| `eval-harness/service/ingest_api.py` | `_team_payload()` 增发 `decisions` 键（additive）。`/ingest` 与 `/team/{id}` 两条路都带。 |
| `src/lite2/transport.ts` | 加 `LiveDecisionCard` / `LiveDecisionRuleHit` / `LiveDecisionGrade` 类型 + `LiveTeamPayload.decisions?`。**只加类型，没动任何运行时代码。** |
| `eval-harness/tests/test_ingest_nonblocking.py` | 该测试用 `SimpleNamespace` 手搓了一个 CompanyContext 假体，`_team_payload` 多要一个方法后它 AttributeError。给假体补上 `decision_cards=lambda: []`。该测试考的是事件循环不被阻塞，与 payload 形状无关，补假体是正解，没有削弱它。 |

### 三档与规则表

`高风险 high_risk (3)` / `需确认 needs_confirmation (2)` / `可推进 can_proceed (1)`。
严重度即 057「今天要决策的」的排序键。**最终等级 = 所有命中规则里最严重的那一档。**

高风险 8 条：`R-SIGNAL-ATTRITION`（流失/离职）· `R-SIGNAL-COMPLAINT`（投诉/退订）·
`R-SIGNAL-CONFLICT`（冲突）· `R-SIGNAL-INCIDENT`（法务/安全/停工）· `R-STATUS-BLOCKED` ·
`R-BLOCKER-STACK`（≥2 条阻塞）· `R-OVERDUE` · `R-DUE-VS-PROGRESS`

需确认 7 条：`R-STATUS-AT-RISK` · `R-BLOCKER-ONE` · `R-DUE-SOON` · `R-PROGRESS-LOW` ·
`R-SIGNAL-WATCH` · `R-SELF-REPORT-MISMATCH`（自报正常却挂阻塞，与前端 `gapDerive.ts` 同口径）·
`R-NO-EVIDENCE`

可推进 2 条：`R-DONE` · `R-CLEAR`

前三族关键词是 kickoff 点名的（流失/投诉/冲突/离职）。**第四族 `incident`（诉讼/违约/停工/工伤）
是本线自行加的**：三家里有一家是建筑公司，工地停工和工伤是那一行最贵的漏报。单列成族是为了可审计、
可关——如果 Danny 认为超范围，删掉 `R-SIGNAL-INCIDENT` 一行 + 词表一族即可，不影响其他规则。

### 🔴 缺数据怎么判（本条最要紧）

- `dueDate`/`progress` **缺失绝不降级**，它们只在存在时参与判定。
- **关键字段全缺 → `需确认`，不是 `可推进`**（`R-NO-EVIDENCE`）。要判 `可推进`，项目必须
  **明确自报**了 on-track/steady/done 且无风险信号——是一句正面陈述换来的，不是靠什么都没写混过去的。
- 到期日写了但解析不了（"月底前"），按未知处理，不当作"还早"。
- 兜底分支（既非正常也非全空的中间态，如抽取层没归一的 status）一律给 `需确认`。
- 每条决策带 `unknown_fields`（`status`/`progress`/`dueDate`），057 据此显示「文档未提及」。

### Avery 能做什么

| 动作 | 结果 |
|---|---|
| 只换那句人话理由 | `reason` 换掉，`reason_source="avery"` |
| 上调 + 写明 `escalation_reason` | `grade` 提高，`escalated=true` |
| 上调但没写为什么 | 不给调，`review_rejected="missing_reason"` |
| **下调** | **硬拦**：等级保持 `rule_grade`，`downgrade_blocked=true`，`rejected_grade` 记下它想判的那档，**并把它那句理由一并丢弃**（那话是为低一档写的，贴高一档上会让经理看到「高风险」配「问题不大」） |
| 返回词表外的等级 | 整个复核作废，`review_rejected="unknown_grade"` |

`rule_grade` 永远保留规则原判，任何时候可对账。

---

## 2 · 🔴 输出契约（feat-057 照着接）

后端 `/ingest` 与 `GET /team/{id}` 回帧新增 `decisions: LiveDecisionCard[]`，
**已按严重度排好序，前端按数组顺序展示即可，不要在前端重排**（排序口径属于后端，
前端重排会和说明书对不上）。TS 类型已写进 `src/lite2/transport.ts`，直接 import。

```json
{
  "subject_type": "project",
  "subject_id": "p_villa",
  "subject_title": "别墅二期交付",
  "owner_name": "陈曦",

  "grade": "high_risk",
  "grade_label": "高风险",
  "severity": 3,

  "rule_grade": "high_risk",
  "rule_grade_label": "高风险",
  "rule_severity": 3,

  "matched_rules": [
    {
      "rule_id": "R-SIGNAL-ATTRITION",
      "grade": "high_risk",
      "grade_label": "高风险",
      "severity": 3,
      "title": "关联信号提到人员流失 / 离职",
      "basis": "signals + blockers",
      "evidence": ["陈曦提出离职意向，交接尚未安排"]
    },
    {
      "rule_id": "R-BLOCKER-STACK",
      "grade": "high_risk",
      "grade_label": "高风险",
      "severity": 3,
      "title": "同时挂着 2 条及以上未解阻塞",
      "basis": "blockers",
      "evidence": ["等待集团法务对合同模板签字", "精装分包商未确认进场时间"]
    }
  ],

  "unknown_fields": ["progress", "dueDate"],

  "reason": "按规则判为高风险：关联信号提到人员流失 / 离职；同时挂着 2 条及以上未解阻塞。（文档未提及：进度、到期日——未知不等于没风险。）",
  "reason_source": "rule",

  "escalated": false,
  "escalation_reason": "",
  "downgrade_blocked": false,
  "rejected_grade": "",
  "review_rejected": ""
}
```

**057 接的时候注意：**

1. `severity` 3/2/1 就是排序键，也是分组键。用户面只准显示 `grade_label`（高风险/需确认/可推进），
   不要显示机器键。
2. `matched_rules` **永不为空**——"每条决策能展开看到命中了哪条规则"就靠它。
   `evidence` 是**原文**，原样展示，不要转述、不要截断成省略号后丢掉原文。
3. 🔴 `unknown_fields` 里的字段必须显示「文档未提及」，**绝不能渲染成 0% 或空白**。
4. `reason_source === "rule"` 时那句话是机械拼装的（可溯源，不是编的）；`"avery"` 才是模型写的。
   两种都能直接显示，不需要前端加工。
5. `downgrade_blocked` / `escalated` 目前后端产出恒为 `false`（见下"没做什么"），
   字段先占位，前端不必为它做 UI。

---

## 3 · 验收怎么过的

全部在 `D:\avery-wt\056` 下真跑。

### 后端全量（硬门：不许把绿的跑红）

```
$ python -m pytest eval-harness/tests/ -q
969 passed, 61 skipped, 8 xfailed in 19.66s
```

改动前基线是 `906 passed, 61 skipped, 8 xfailed`。906 + 63（本线新增）= 969，
skipped / xfailed 数一个没变——**没有把任何绿的跑红**。

（中途确实红过一次：`test_ingest_nonblocking.py` 的 `SimpleNamespace` 假体缺 `decision_cards`
导致 AttributeError。已给假体补上该方法，见上表。）

### 本线门

```
$ python -m pytest eval-harness/tests/test_decision_grading.py -q
63 passed in 0.69s
```

逐条对应验收：

| 验收项 | 测试 |
|---|---|
| 同一份文件连跑两次等级完全一致 | `test_same_input_same_output_twice`（JSON 逐字节比对）· `test_no_clock_leak` |
| 每条决策能展开看到命中哪条规则 | `test_every_decision_names_its_rules`（matched_rules 非空 + 规则号真实存在 + 每条带证据）· `test_evidence_is_verbatim_from_source` |
| Avery 上调有覆盖 | `test_avery_can_escalate_with_reason` · `test_escalation_without_a_reason_is_refused` |
| **下调被硬拦** | `test_avery_downgrade_is_blocked` · `test_every_downgrade_direction_is_blocked`（三个方向全测）· `test_blocked_downgrade_also_discards_its_wording` · `test_unknown_grade_from_the_model_is_refused` |
| 缺 dueDate/progress 不许默认低危 | `test_missing_due_and_progress_never_downgrades` · `test_empty_project_is_needs_confirmation_not_can_proceed` · `test_can_proceed_requires_a_positive_statement` · `test_unparseable_due_date_is_unknown_not_far_away` |
| 口径不埋 prompt | `test_no_rule_text_in_any_prompt`（全 eval-harness 扫 124 个 .py/.md，规则号只许出现在三个允许文件里） |
| 口径与文档同步 | `test_rules_doc_in_sync`（规则号 / 三档 / 关键词族 / 5 个阈值的**值**全部核对） |
| 红线不被绕过 | `test_composed_reasons_pass_the_red_line`（理由过既有 `redline.validate`）· `test_decision_dict_has_no_person_score_keys` |

### 门是真的会咬人（做了变异验证，不是自考自答）

两条最要紧的门做了变异测试：

1. **prompt 泄漏门**：在 `eval-harness/` 下种一个含 `R-BLOCKER-STACK` 的假 prompt 文件 →
   `test_no_rule_text_in_any_prompt` **FAILED**；删掉 → passed。
2. **下调硬拦门**：把 `apply_review` 里的拦截改成放行（`_with(decision, grade=proposed)`）→
   **4 条测试同时 FAILED**（`test_avery_downgrade_is_blocked` + 三个方向的参数化）；改回 → 63 passed。
   变异已还原，`git status` 干净。

### 前端硬门

```
$ npm run typecheck     # tsc -b
（零输出 = 零错误）

$ npm run build
✓ built in 2.48s
```

### 集成层：真跑 /ingest，不是自己造 dict

用 in-process ASGI 打真 app，上传一份真中文周报（无 LLM key，走 heuristic 抽取）：

```
POST /ingest -> 200
payload keys: ['briefing','context_id','decisions','extraction_mode','owner_token',
               'people','projects','signals','source_files']
decisions present: True | count: 1
  [高风险] sev=3  unknown=['progress','dueDate']  reason_source=rule
       R-BLOCKER-STACK  ['blocker: 等待集团法务对合同模板签字', 'blocker: 精装分包商未确认进场时间']
       R-STATUS-AT-RISK ['status="at-risk"']
       R-SIGNAL-WATCH   ['blocker: 等待集团法务对合同模板签字']

GET /team -> 200 | decisions: 1
two consecutive /team calls identical: True
no-token /team -> 404   （继承红线仍然成立，没被我改坏）
```

---

## 4 · 没做什么（范围内但没做，及原因）

- **没有真的去调 LLM 写理由。** `apply_review()` + `AveryReview` 这条缝已经建好、已被测试覆盖，
  但**没有接进任何 agent 回路**——所以线上目前每条 `reason_source` 都是 `"rule"`，
  `escalated` / `downgrade_blocked` 恒为 `false`。
  原因：真接 LLM 要动 agent 回路和 prompt 组织，那是 `avery/loop.py` / `skills.py` 的地盘，
  与本波多条线（尤其 059 议事室输出）撞车，且会引入网络依赖，让本线的确定性门变得不可离线跑。
  **本线交付的是"等级 + 可插的理由缝"，理由的真接入建议单开一条线。**
  规则理由是机械拼装的（只由等级 + 命中规则标题构成，一个字不是编的），前端现在就能直接显示，
  不是占位假文案。
- **没做人 / 任务的定级。** `subject_type` 目前恒为 `"project"`，字段留着以便扩。
  kickoff 的覆盖率表全是项目字段，本波只做项目。
- **没动前端任何运行时代码。** `transport.ts` 只加类型。「今天要决策的」的渲染是 057 的活。

---

## 5 · 遗留问题 / 给集成方的提示

1. 🔴 **本线的产出质量被 feat-054 卡着。** 集成验证里那份含 3 个项目的中文周报，
   heuristic 抽取只吐出 **1 个**项目（标题还是文件名 "weekly"）。
   这是既有的、已被隔离的 H4 缺陷（`tests/test_zh_project_axis_gap.py` 5 条 `xfail(strict=True)`，
   本线跑完仍是 5 xfailed，没动过）：`_projects_from_doc` 把 title/owner/status 累进**标量局部变量**、
   整篇文档只 append 一个 ProjectEntity，**纯英文双项目文档也一样只出 1 个**。
   定级逻辑本身没问题（给什么项目就正确判什么），但 **feat-054 不落地，057 的「今天要决策的」
   就只有一两条**。建议集成时确认 054 已并入。
2. **合并冲突面**：`_team_payload`（+1 键）、`CompanyContext`（+1 方法）、
   `transport.ts`（+1 可选字段 + 一段类型）。都是 additive，冲突面小。
   `transport.ts` 与 057 那条线可能同时改——我只在 `LiveBriefingPayload` 上方插了一段新类型、
   在 `LiveTeamPayload` 里加了一行 `decisions?`，没碰任何已有行。
3. **不需要任何新包**，不需要凭据。全离线、纯标准库（`re` / `dataclasses` / `datetime`）。
4. `decision_cards(as_of=None)` 默认取 `date.today()`。到期日过了之后等级会升——这是对的
   （真实世界变了），但如果哪天要做"某日快照回放"，显式传 `as_of` 即可，缝已经留好。
5. `R-SIGNAL-INCIDENT`（法务/安全/停工族）是本线自行补的，非 kickoff 点名。理由见上。
   若判定超范围，删一条规则 + 一族词表即可。

## Notes（顺手发现的，**没有顺手修**）

- `avery/ingest/extract.py::HeuristicExtractor` 里 `proj_ref` 初始化为 `""` 之后从未被赋值
  （`extract.py` 约 880 行，注释写着 "anchor person/project signals to the first project title
  if present"，但赋值没实现）。结果是所有项目型信号的 `subjectRef` 都落成 `"the project"`，
  挂不到任何具体项目上。本线用"项目标题出现在信号原文里"做了兜底通道，但根子在抽取层。
  与 feat-054 同源，建议并入 054 一起看。
- `_norm_status` 只认英文（`blocked` / `at-risk` / `on-track` / `done`），中文文档里的
  「已阻塞」「有风险」「进行中」一律归一成空串 → 走 `R-NO-EVIDENCE` 判需确认。
  不算错（信息不足判需确认是对的），但中文文档的定级精度会因此偏保守。属 feat-054/060 地盘。
