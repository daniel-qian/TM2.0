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

  "unknown_fields": ["progress"],
  "unparsed_fields": [
    { "field": "dueDate", "field_label": "到期日", "raw": "月底前" }
  ],

  "reason": "按规则判为高风险：关联信号提到人员流失 / 离职；同时挂着 2 条及以上未解阻塞。（未读到：进度；到期日写的是「月底前」，无法确定具体日期——未知不等于没风险。）",
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
3. 🔴 **两个"没值"的列表，措辞不一样，别混用**（见 §6 复核修复）：
   - `unknown_fields`（文档确实没写）→ 显示「文档未提及：进度」
   - `unparsed_fields`（文档写了、后端读不准）→ 显示「到期日写的是**「月底前」**，无法确定具体日期」，
     `raw` 是**文档原文，原样摆出来**
   一个字段只会出现在其中一个列表里。🔴 两边都**绝不能渲染成 0% 或空白**。
   🔴 也绝不许把 `unparsed_fields` 说成「文档未提及」——客户手上就有原件，说他没写等于当场自证不可信。
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

---

## 6 · 复核修复（第二轮，2026-07-18）

复核判定 `needs-fix`，两条 major。逐条修完，门全绿。核心是同一件事：
**系统绝不能对客户自己的文档作失实陈述。** 判错一档还能靠展开的证据自证；
当着客户的面否认他写过的字，这份说明书的说服力当场归零——而三家里两家交中文文件。

### 6.1 major · `unknown_fields` 把「文档没写」和「我读不准」混为一谈（已修）

**原症状**：`dueDate="8月15日"` → `parse_due_date` 返回 None → 被塞进 `unknown_fields` →
理由输出「（文档未提及：到期日）」。而周报上白纸黑字写着 8月15日。

**改法**（两层）：

1. **拆成两个互斥字段。** `unknown_fields` = 文档确实没写；新增 `unparsed_fields` =
   文档写了、读不出可比较的值，每项带 `{field, field_label, raw}`，`raw` 是**原文**。
   理由文案改成「到期日写的是「月底前」，无法确定具体日期」。
   🔴 **定级方向上两者完全一视同仁**（都不触发"还早"、都不降级）——只有措辞分开。
2. **把最常见的那类真的读出来。** 中文周报写到期日几乎不写年份。
   `parse_due_date(text, *, as_of)` 现在认 `8月15日` / `8月15号` / `7月20日前`：
   月日无歧义，年份按 `DUE_YEAR_LOOKBACK_DAYS=90` 推断——先按 `as_of` 当年算，
   已过去超 90 天则认为说的是下一年同一天（`1月10日` 在 7 月不会被谎称逾期半年）。
   🔴 不传 `as_of` 一律返回 None，**绝不在函数内部读时钟**（那会毁掉可复现性）。
   `月底前`/`第三季度末` 这类定不到某一天的，仍然不猜 → 进 `unparsed_fields`。

**顺带修的措辞**：`R-NO-EVIDENCE` 的标题从「文档没写状态、阻塞、进度、到期日」改成
「没读到状态、阻塞、进度、到期日中的任何一项」；兜底理由里的「文档未提及」改成「未读到」。
差别在于：抽取层读不出来时，「我没读到」仍是真话，「文档没写」是失实陈述。
加了一条常设门 `test_no_rule_asserts_what_the_customers_document_does_not_contain`
扫全部规则标题 + 兜底理由，禁止「文档没写 / 文档未写 / 文档里没有 / 没有提到」再回来。

### 6.2 major · `_norm_status` 只认英文，中文侧三档塌成两档（已修）

**原症状**：`_norm_status('进行中') == ''` → 走 `R-NO-EVIDENCE`，且 `_m_done`/`_m_clear`
都要求归一后的英文状态，所以**纯中文文档里没有一个项目够得着「可推进」**。

**改法**（在 `extract.py`，即根因所在层，不是在 056 里打补丁遮掩）：

1. `_norm_status` 加中文词表，沿用英文侧的风险优先次序（blocked > at-risk > done > on-track）。
   否定式用负向后顾堵死：`未完成`/`没完成`/`待完成` 不会被读成 done、`无风险`/`没风险`
   不会被读成 at-risk。🔴 **正面误读会把有问题的项目说成没问题，那个方向必须堵死**；
   风险方向的误报保持开放（与全局取向一致）。
2. `_norm_status(text, *, risk_only=False)`：整篇文档兜底扫描（没有任何「状态：」行时）
   改为 `risk_only=True`，**只读风险方向，不从正文里读「正常」「已完成」**。
   理由：可推进必须由**明确自报**换来，「正常」两个字碰巧出现在周报某处不是自报。
   这条同时收紧了英文侧——是本轮唯一一处主动加严，写在这里备查。
3. 补中文标签行。原先 `状态：进行中` / `到期：8月15日` / `进度：30%` / `负责人：陈曦`
   **一行都读不到**（标签正则全英文），修完 1 之后 dueDate 仍然进不了项目卡，
   等于第 6.1 条的解析改进在真链路上够不着。中文标签**强制要求冒号**
   （`截止`/`负责` 是普通词，可选分隔符会把「截止到目前为止…」读成到期日）；
   英文分支保持原样，行为不变。

### 6.3 minor · 复核两次可以把上调走回去（已修）

`apply_review` 的比较基线原本只取 `rule_grade`。一条 `可推进` 被合法上调到 `高风险` 后，
第二次复核提 `需确认` 仍算"相对规则原判的上调"→ 被采纳，等级实质从高风险掉回需确认，
且 `downgrade_blocked` 仍是 `False`，**一点痕迹都不留**——下调红线被后门绕过。
基线改成 `max(SEVERITY[rule_grade], SEVERITY[grade])`。当前无调用方，但理由层一接回路就会踩到。

### 6.4 minor · heuristic 路径信号覆盖（**没修**，见 §7）

### 6.5 契约变更（057 必看）

`LiveDecisionCard` **加了一个必填键 `unparsed_fields`**（`LiveDecisionUnparsedField[]`）。
057 尚未消费 decisions，此时改代价最小。渲染口径见 §2 第 3 条。

### 6.6 门（全部在 `D:\avery-wt\056` 下真跑）

```
$ python -m pytest eval-harness/tests/ -q
975 passed, 61 skipped, 8 xfailed in 19.72s
```

969（上一轮）+ 6（本轮新增门）= 975。**skipped 61 / xfailed 8 一个没变**，没有把绿的跑红、
也没有把红的偷偷 skip 掉。前端：`npm run typecheck` 零输出；`npm run build` ✓ built in 2.75s
（仅既有 chunk>500kB 警告）。

**变异验证**（逐个撤回修复，确认对应门变红，改完还原、`git status` 复查）：

| 撤回的修复 | 结果 |
|---|---|
| `unparsed` 拆分 | CAUGHT（2 failed） |
| 中文年份推断 | CAUGHT（1 failed） |
| 中文 `_norm_status` | CAUGHT（1 failed） |
| 复核基线 `max(...)` | CAUGHT（1 failed） |
| `R-NO-EVIDENCE` 措辞 | CAUGHT（1 failed） |

**集成层真跑**（in-process ASGI，无 LLM key，走 heuristic）——修复前后同一份中文周报对比：

```
修复前：projects: status="" dueDate 缺失 ownerName 缺失
        [需确认] unknown=['status','progress','dueDate']
        reason: 按规则判为需确认：没读到状态…（文档未提及：状态、进度、到期日）   ← 文档明明写了

修复后：projects: [{"title":"别墅二期交付","ownerName":"陈曦","status":"on-track","dueDate":"8月15日"},
                   {"title":"泳池区域改造","ownerName":"林岚","status":"at-risk","dueDate":"7月20日前",
                    "blockers":["等待集团法务对合同模板签字"]}]
        [可推进] 别墅二期交付  rules=['R-CLEAR']                      ← 中文侧终于够得着第三档
        [需确认] 泳池区域改造  rules=['R-STATUS-AT-RISK','R-BLOCKER-ONE','R-DUE-SOON','R-SIGNAL-WATCH']
                                                                       ← R-DUE-SOON 在中文侧首次可达
        reason 不再出现「文档未提及：状态/到期日」

「到期：月底前 / 进度：30%」那份：
        unknown=[]  unparsed=[{"field":"dueDate","field_label":"到期日","raw":"月底前"}]
        reason: 按规则判为需确认：自报进度不足 40% 且未完成。
                （到期日写的是「月底前」，无法确定具体日期——未知不等于没风险。）

GET /team 连跑两次 JSON 逐字节相同: True | ingest==team: True | 无 token /team -> 404
```

---

## 7 · 复核提出但**没修**的（及理由）

**minor · heuristic 路径 `_signals_from_doc` 覆盖太窄、`proj_ref` 初始化后从未赋值**
（`extract.py:876/880`，复核 finding 4）。

没修，理由：这是 `_signals_from_doc` / `_projects_from_doc` 的结构性缺陷，与 §5-1 那条
「heuristic 只吐 1 个项目」**同源**，属 feat-054 的地盘，正在被那条线重写。本轮我已经因为
中文标签不得不动了 `_projects_from_doc` 的标签正则（6.2-3），再去改信号构建会把与 054 的
合并冲突面从"几行正则"扩大到"整个函数"，且 `proj_ref` 一旦真赋值会改变所有项目型信号的
挂载关系，影响面远超本线能验证的范围。

复核对这条的判断我同意：「056 本身没错（给什么判什么），且已在 rules.md 盲区章节公开」。
🔴 但**集成时必须确认 054 已并入**——否则演示走无 key 路径时，离职/投诉这两个最贵的信号
一个都进不了定级，「今天要决策的」会明显偏少偏弱。

## Notes（顺手发现的，**没有顺手修**）

- `avery/ingest/extract.py::HeuristicExtractor` 里 `proj_ref` 初始化为 `""` 之后从未被赋值
  （`extract.py` 约 880 行，注释写着 "anchor person/project signals to the first project title
  if present"，但赋值没实现）。结果是所有项目型信号的 `subjectRef` 都落成 `"the project"`，
  挂不到任何具体项目上。本线用"项目标题出现在信号原文里"做了兜底通道，但根子在抽取层。
  与 feat-054 同源，建议并入 054 一起看。
- ~~`_norm_status` 只认英文，中文一律归一成空串~~ —— **第二轮已修，见 §6.2。**
  当时判断成"不算错、只是偏保守"是**低估了**：它让「可推进」在中文侧完全不可达（三档塌成两档），
  并让理由谎称文档没写状态。复核把它升到 major 是对的。
