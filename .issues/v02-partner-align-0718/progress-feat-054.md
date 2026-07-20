# feat-054 · 抽取粒度门（项目粒度收敛）

分支 `feat/054-project-granularity` · 工作树 `D:\avery-wt\054` · 后端/抽取

---

## 结论先说

**三亚 seed 全量语料：项目数 8 → 6，正好等于文档自己写的数（「本期周报覆盖 6 个在跟进项目」）。**
六个项目的 负责人/状态/进度/截止 四个字段 **6/6 全覆盖**，负责人全部 link 到真人 id。

同时修好了反方向的病：启发式抽取器过去**一份文档只出 1 个项目**（且是以文件名/标题命名的幽灵卡）。
H4 那 5 条 strict xfail **转正 4 条**，剩 1 条写明为什么不在本条范围。

---

## 根因：不是两个 bug，是同一个洞的两面

盘之前先按 kickoff 的要求把「抽太多」和「抽太少」放在一起看，结论是**它们是同一个洞**：

> **抽取器里从来没有任何地方定义过「一个项目」是什么。**

两条路径于是各自朝自己机制的方向塌：

| 路径 | 方向 | 机制根因 |
|---|---|---|
| LLM (`llm_extract.py`) | **抽太多**（17 个） | prompt **明确命令它拆**：`'one entry per distinct project, phase or engagement ("Phase 1" and "Phase 2" ... are two entries)'`。这行字本身就是「里程碑当项目」的 bug。 |
| 启发式 (`extract.py`) | **抽太少**（1 个） | `_projects_from_doc` 把 title/owner/status/progress 累进**标量局部变量**，全文扫完只 append 一次 → 除最后一个外全部被就地覆盖。 |

第二条是 **H4 LAYER A**，而且**跟中文无关**：纯 ASCII、两行 `Project:` 的英文文档同样只出 1 个。
这正是 `test_zh_project_axis_gap.py` 早就论证过的 —— 「教正则认中文」根本不是解，Layer B 离了 Layer A 毫无价值。

**为什么三亚 seed 是 17：** `鹿山雅居-项目周报.docx` 有 6 个项目，每个带 4 条 `里程碑：` 检查点 = 24 条里程碑，
和 6 个真项目一起挤 LLM 那 12 条的预算。17 就是这么来的。

---

## 做了什么

### 1. 新模块 `eval-harness/avery/ingest/granularity.py`（新增，385 行）

先把定义写下来，所有规则都能拿它来吵：

> **项目** = 文档**单独跟进**的一个工作单元（有自己的负责人 / 状态 / 进度 / 截止日期）。
> **里程碑** = 项目**内部**的检查点。

- `segment_projects(doc)` —— 按文档自己的项目标签切块（`项目 N：` / `Project:`），并采集每块下 `里程碑：` 的子条目。**这一个结构认知同时服务两侧**：切块修「抽太少」，里程碑索引喂「抽太多」的门。
- `apply_gate(res, docs)` —— 降级伪项目，返回**每个候选**（保留的和降级的都有）的 `Ruling`。
- `stated_project_count(doc)` —— 读文档自己声明的项目数（中文数字/全角/英文都认）。

### 2. 🔴 门可解释 —— 4 条具名规则，每条降级都引用文档

**没有用数量上限，也没有用「文档说 6 个就留前 6 个」。** 两者都能让数字好看，但都答不出三家公司必问的那句「凭什么这条不是项目」。
每条判定都落成 `Ruling(rule, reason, parent, evidence)`，reason 是**中文、面向用户**的：

| 规则 | 判据 | 证据强度 |
|---|---|---|
| `R1-milestone-section` | 该标题就是某项目 `里程碑：` 清单里的一行 | 最强：**文档自己把它嵌套进去的** |
| `R2-checklist-row` | 标题自带完成状态（`— 已完成`）且无负责人/进度/截止 | 形状：这是个复选框 |
| `R3-phase-of` | 「X 第二阶段」而 X 是本文档已跟进的项目 | 命名：**光有 `Phase 2` 不降级**（有公司真的这么开项目） |
| `R4-document-not-project` | 标题就是文档自己的标题/文件名/sheet 名，且无负责人/进度/截止 | 这是一份文件，不是一个项目 |
| `R0-tracked` | 以上都不命中 → 保留，并**说出是哪几个字段留下的它** | — |

实际输出长这样（真实运行结果，非编造）：

```
R1-milestone-section · 「预算缺口确认 — 受阻」→ milestone（归入「年度别墅营收冲刺」）：
文档把「预算缺口确认 — 受阻」列在项目「年度别墅营收冲刺」的「里程碑」清单里，
它是该项目的一个检查点，不是独立项目 [鹿山雅居-项目周报.docx:15]
```

**文档声明的数量只做对账信号，绝不用来截断** —— 截断等于凭一个数字扔掉客户数据，且答不出「为什么砍的是这条」。

### 3. `extract.py` —— Layer A 结构修复 + Layer B 中文标签

- `_projects_from_doc` 改为**按块切分**，新增 `_project_from_span` 独立读每块字段。
- **单块仍扫全文** —— 这样每一个 pre-054 的英文 fixture 字节不变（前言里的 `#` 标题 / `Summary:` 照旧读得到），切分只在「2 个以上标签项目」时生效，正好落在病灶上。
- 字段标签双语：`负责人：/自报状态：/进度：/截止：/进展摘要：/阻碍项：`。
- `_norm_status` 加中文词表（**纯追加**，ASCII 分支原封不动且先跑）。
- `ExtractionResult.granularity` 新字段承载审计轨迹；`merge()` 刻意不拼接它（门在 merge 之后一次性赋值）。
- 门挂在 `extract_docs` 里、**dedup 之前** —— 跨文档 dedup 会把出处合并掉，之后就没法判「谁是谁的里程碑」了。

### 4. `llm_extract.py` —— 拆掉那行命令它拆的 prompt

改成：只输出文档**单独跟进**的项目；`里程碑：`/`Milestones:` 下的行**不要输出**；文档若声明了项目数就按那个数返回。

### 5. 一个诚实性决定：`待确认` 不映射成 `at-risk`

seed 里 6 个项目有 2 个 `自报状态：待确认`。映射成 `at-risk` 很顺手，但那是**凭空造风险** ——
「还没人确认」不等于「这事出问题了」，而 `at-risk` 是驱动「多看一眼」的状态。
在付费客户面前造假警报的代价高于一个诚实的空值，PRD 对未声明字段的规矩也是显示「未知」。
所以 `待确认 → ""`，卡片显示未知。已落测试 `test_pending_confirmation_is_unknown_not_at_risk`。

---

## 5 条 strict xfail 的重新评估

| 测试 | 结果 | 说明 |
|---|---|---|
| `test_zh_weekly_yields_its_real_projects` | ✅ **转正** | Layer B |
| `test_zh_weekly_resolves_owners_to_real_people` | ✅ **转正** | Layer B |
| `test_zh_weekly_surfaces_the_blocker` | ✅ **转正** | Layer B，「退改签」阻塞项终于出得来 |
| `test_english_weekly_with_two_projects_yields_two_projects` | ✅ **转正** | Layer A，**最吃重的一条** |
| `test_zh_person_signal_is_extracted_and_refs_an_id` | ⛔ **仍 xfail** | **Layer C，是 signal 轴不是 project 轴** |

**第 5 条为什么不做（不是偷懒，是范围）**：它要的是 `_first_person_name` 不再只认 ASCII，且中断规则能读中文数字（「三次」）。
注意同一个 fixture 的**英文**行（"Lena Park absorbed three rounds"）栽在一模一样的 `\d+` 上 —— **这也不是 CJK bug**。
那是另一个函数、另一个面、另一份回归预算。feat-054 是项目粒度门，把一个无关的 signal 重写编进来会让两边都更难验。
保留 strict xfail 所以它烂不掉：哪天有人修了 signal，pytest 在这里变红，注释跟着退休。
文件顶部的 quarantine 论证已改写成「A/B 已关、C 为何仍开」。

---

## 验收：跑过的门与真实输出

### 后端全量（硬门）

```
$ python -m pytest eval-harness/tests/ -q
941 passed, 61 skipped, 4 xfailed in 19.90s
```

**基线对比**（本机实测基线，非 kickoff 里写的 907）：

| | 基线 | 现在 | 差 |
|---|---|---|---|
| passed | 906 | **941** | +35（31 条新测试 + 4 条转正） |
| skipped | 61 | 61 | 0 |
| xfailed | 8 | **4** | −4（转正的 4 条） |
| **failed** | **0** | **0** | **0 —— 没有把绿的跑红** |

### 新增回归测试

```
$ python -m pytest eval-harness/tests/test_project_granularity.py -q
31 passed in 0.56s
```

覆盖：切块/字段归属/阻塞项归属（Layer A）、四条降级规则各自的正例与**反例**（`Phase 2` 无父项目**不**降级、
有真跟进字段的文档标题项目**不**降级）、**可解释性契约**（每个候选必有 rule+reason，reason 必须点名对象；
每条降级必须能回指父项目和文档行号）、声明数量对账、中英数字解析、**英文平价**（同形状英文 fixture 行为一致）、
`_norm_status` 英文分支不动 + 中文分支 + `待确认` 诚实空值。

### 前端硬门（本条没动前端，仍按要求跑）

```
$ npm run typecheck     → tsc -b，零输出零错
$ npm run build         → ✓ built in 2.99s
```

### 真实 seed 语料实测（启发式路径，端到端 `ingest_paths`）

```
ok= True  redline ok= True  ctx= True
people= 20  PROJECTS= 6  materials= 114
   - 年度别墅营收冲刺     | u_陈思雨 | at-risk  | 58
   - 国庆亲子别墅预订单   | u_刘嘉怡 | at-risk  | 66
   - 销售绩效与佣金方案   | u_黄若琳 | blocked  | 42
   - 新人带教与团队士气   | u_陈思雨 | blocked  | 51
   - 市场承诺与前厅协同   | u_孙浩   | at-risk  | 49
   - 服务式别墅内容投放   | u_郑婉婷 | on-track | 74
granularity rulings= 8   （6 保留 + 2 条 R4 降级）
```

被 R4 降级的 2 条：`鹿山雅居别墅酒店 · 周例会纪要`（会议纪要文件本身）和 `sheet: 绩效评估`（REDLINE 探针表）。
两者都是「文档标题变成项目卡、无主、无进度」的幽灵 —— 正是 H4 说的**比空屏更坏**的那种：它不像坏了，它像「一切正常」。

**字段覆盖率 6/6 全满**（对比 PRD 记录的 17 个时代：dueDate 7/17、progress 6/17）。

---

## 真 LLM 调用：验证到什么程度（诚实交代）

**没有 `AVERY_BRAIN=minimax` 的 key，真模型调用没跑过。** 工作树无 `.env`，环境无相关变量。

替代验证（`_build` 是纯函数，给定 JSON 即可复现）：用真 seed 文档构造「pre-054 LLM 的输出」——
6 个真项目 + 把全部 24 条里程碑行都提升成项目 = **30 个候选**，过门后 **→ 6**，每条降级都带父项目和行号。
测试 `test_gate_demotes_promoted_milestones_back_out_of_the_project_axis` 把这条路径固化了。
另有 `test_gate_matches_a_milestone_named_without_its_state_suffix` 覆盖真模型的典型输出形态
（文档行是「软装采购下单 — 受阻」，模型通常只回「软装采购下单」）。

**所以：门的逻辑在 LLM 形态输入上验证过；prompt 改动本身没有用真模型验证过。** 建议集成后拿真 key 跑一次三亚 seed 复核。

---

## 没做什么

- **不产出里程碑实体**。kickoff 明确「不做：里程碑」，造一个没人渲染的实体类型是死重。里程碑文本**仍在 RAG material chunks 里**，检索侧不丢东西，只是不再占项目卡。
- **不碰 signal 轴**（H4 Layer C，见上）。
- **不碰前端**。feat-055 的项目屏是另一条线。
- **不动** `feature_list.json` / `package.json` / 根 `progress.md` / 根 `session-handoff.md`。

---

## 给集成方 / feat-055 的风险提示

1. **合并冲突面**：`extract.py` 改动集中在 `_projects_from_doc`（整块重写）、`_norm_status`（追加中文分支）、
   `ExtractionResult`（加字段）、`extract_docs`（加一行调门）。别的线若也改 `extract.py` 需留意后两处。
   `llm_extract.py` 只改了 `_INSTRUCTIONS` 里 projects 那一段。
2. **`granularity` 字段不持久化**。`pg_registry` 是按实体 `asdict` 存的（people/projects/signals），
   `ExtractionResult` 整体不落库 —— 所以**不需要 DB 迁移**，但也意味着**从 Postgres 重载 context 后审计轨迹没了**。
   项目数据本身是对的（门在持久化之前跑），丢的只是「为什么」。
   feat-055 若要在 UI 上做「为什么这条不是项目」，需要另开一条把 rulings 落库/透出的活。
3. **feat-055 可以直接依赖的契约**：`extraction.projects` 现在是收敛后的真项目列表；
   `extraction.granularity: list[Ruling]`（`title/verdict/rule/reason/parent/evidence`，`as_line()` 出可读中文）。
   `verdict` 三值：`project` 保留，`milestone` / `document` 被丢弃。
4. **不需要新装任何包**。纯 stdlib（`re`/`dataclasses`）。
5. **状态推断的一个已知行为**：块内没有可读的自报状态时，会从该块文本兜底嗅探。
   seed 里 `销售绩效与佣金方案`、`新人带教与团队士气` 自报是「待确认」（按上面的决定映射为空），
   兜底从各自的 `阻碍项：…卡住` 嗅到 `blocked`。这有文档明写的阻碍项做依据、可追行，不是凭空造；
   但它确实**覆盖了负责人的自报状态**。若产品侧认为该以自报为准，这是个一行改动的策略点，我没有擅自定。

---

## Notes（顺手发现，**没有顺手修**，避免合并冲突）

- `_signals_from_doc` / `_first_person_name` 是 ASCII-only，且中断规则要 ASCII `\d+`：
  中文人物 signal 全线不可达，**英文写 "three rounds" 也一样丢**。这是 H4 Layer C，值得单开一条。
  实测：`Spacing_Variant_Duty_Weekly.md` 出 0 条 signal。
- 三亚 seed 全量跑下来 `signals = 0`。会议纪要里有大量高价值信号（「12 个高意向预订单平均确认超过 6 小时」、
  「佣金方案讨论已经两周没有正式落地」、「至少 3 处市场活动承诺与前厅实际可交付不一致」），
  一条都没抽出来 —— 同一个 Layer C 根因。这直接影响「今天要决策的」（G4）和决策定级（G5/feat-056）有没有米下锅，建议优先级排高。
- `鹿山雅居-绩效评估表-REDLINE探针.xlsx` 被 `parse` 判成 `doc_kind=project`。R4 已经挡住它变成项目卡，
  但 doc_kind 分类本身可能值得看一眼（它是张绩效表）。


---

# 复核轮次 2 —— 修复记录（verdict: needs-fix，3 条 major + 1 条 minor）

复核判定 `needs-fix`，诚实性检查通过（逐条复跑全部对上，无夸大），验收 9 项里 8 项 `yes`、
1 项 `unverifiable`（真 LLM 无凭据，仍然无凭据，见下）。问题全部出在**门的判定逻辑本身**，
不在交付范围或诚实性上。3 条 major 全修，1 条 minor 也修了。

**这 3 条的共同点，也是最该记住的一点：它们全都静默。** 门照常输出 ruling、照常给理由、
照常"看起来在工作"，只是答案是错的。一个卖点是「说得出为什么」的门，最危险的失效不是不给理由，
是**理直气壮地给错理由**。所以下面每条都先复现、再修、再拿测试钉死。

## 修复 1 —— 里程碑行带冒号会清空整块里程碑索引（major，granularity.py:213）

**复现（修前实测）**：
```
输入块：项目 1：营收冲刺 / 负责人：陈思雨 / 里程碑： /
       "A/B 测试: 未开始" / "预算缺口确认 — 受阻" / "数据回收 — 进行中" / 阻碍项：预算未批
_milestones_in 实测 →  []            ← 不是少一行，是全空
英文同样：Budget sign-off: done      →  []
LLM 形态 4 个候选过 apply_gate 后     →  4 个全保留 ['营收冲刺','A/B 测试','预算缺口确认','数据回收']
                                        rules = R0-tracked / R0-kept / R0-kept / R0-kept
```
`A/B 测试: 未开始` 命中 `_ANY_LABEL`（当成"下一个字段标签"）且不命中 `_CHECKLIST_ROW`（没破折号），
`collecting` 置 False 且**再也不恢复** → 整块里程碑归零 → `build_milestone_index` 里没有这些行 →
R1 永远匹配不上。而 R1 是**唯一**能拦住"LLM 已经把状态剥掉的里程碑"的规则（R2 要求标题自带完成状态后缀）。
复核者说得对：客户文档里只要有一行这种写法，本 ticket 要修的碎片化就原样复发。

**修法**：把冒号加进 `_CHECKLIST_ROW` 的分隔符，让 `A/B 测试: 未开始` 被认成检查点行。
但光这样会**反向误伤** —— `自报状态：已完成` 也长这个样子，会被当成里程碑收进去。
所以配套引入 `_FIELD_LABEL`（已知字段标签词表，中英双语，词表对齐 `_project_from_span` 实际读的标签），
**先判已知字段标签、再判检查点行**：

- `阻碍项：预算未批` / `自报状态：已完成` → 已知字段标签 → 关闭列表 ✅
- `A/B 测试: 未开始` / `Budget sign-off: done` → 不是已知标签 + 是检查点行 → 收进里程碑 ✅

**修后实测**：里程碑 3 行全收回；4 个候选过门后只剩 `['营收冲刺']`，另 3 条判 `R1-milestone-section`、
parent 全部正确指向 `营收冲刺`。

## 修复 2 —— R3 用子串包含判"阶段"，吞掉真项目并编造父子关系（major，granularity.py:316）

**复现（修前实测）**：两个都带 owner+status+progress+dueDate 的独立项目：
```
'Billing Rewrite Phase 2' (Lena Park/at-risk/40%/Aug 1)
'Billing Rewrite Tooling' (Marcus Reid/on-track/70%/Sep 1)
→ 存活只剩 ['Billing Rewrite Tooling']
→ 前者 R3-phase-of，parent 写成 'Billing Rewrite Tooling'
中文同理：'别墅营收冲刺第二期'(陈思雨/at-risk/58%/7-17) 被 '别墅营收冲刺复盘会' 吞掉
```
**双重损害**，其中第二条更严重：一是四项跟进字段俱全的项目卡整张消失；
二是门对客户的解释是「这是项目『Billing Rewrite Tooling』的一个阶段」——**这个父子关系在文档里不存在，是编的**。

**修法**（两道闸，复核者建议的两条都采纳，第二条我改得比建议更严）：

1. **有独立跟进字段就不降级**。原来 R3 排在 R0-tracked 之前，跟进证据根本没机会说话。
   本模块自己的定义就是「文档单独跟进 = 项目」，名字里有个 Phase 压不过这条。
2. **子串包含改成单向**：要求 `other_k == bare` 或 `other_k in bare`（父项目的完整名字出现在阶段名里），
   **删掉 `bare in other_k` 这个方向**。被删的正是这个方向 —— 它让任何"共享前缀的兄弟"看起来像父项目。
   复核者建议的是"other_k 以 bare 开头或相等"，但我实测那样 `billingrewritetooling`.startswith(`billingrewrite`)
   仍然成立、`Billing Rewrite Phase 2` 还是会被吞。单向包含才真正堵住，且 R3 该干的活一点没丢
   （`宴会厅翻新 第二阶段` → `宴会厅翻新` 照常降级，原有测试不变）。

**修后实测**：两个独立项目全部存活、rules 均为 R0-tracked、无任何 R3 命中。

## 修复 3 —— R4 把 status 整体排除，稀疏单项目文档被整条丢弃（major，granularity.py:332）

**复现（修前实测）**：
```
Roadmap.md = "# Roadmap / Status: on-track / We are shipping the new billing flow this quarter."
→ 抽出 0 个项目，ruling = R4-document-not-project
同文件加一行 "Owner: Lena Park" → 恢复成 1 个项目
```
这是 **pre-054 行为的净回退**（原来出 1 张真项目卡），而且 `res.projects` 为空时项目屏一片空白、
用户看不到任何解释（ruling 不落库，跨线契约）。而 kickoff/PRD 明确记录另两家公司的文档就是稀疏的
（dueDate 7/17、progress 6/17 覆盖率），瑞典建筑公司那种「一个文件描述一个工程、写了状态没写负责人」
正是这个形状。这条我上一轮的 risks 清单里确实没有，是漏了，不是藏了。

**根因**：注释里排除 status 的理由是对的（status 可能是从散文嗅出来的），但**代码分不清两种来源**，
于是把「文档明写 `Status:` 标签」和「从散文嗅到」一起扔了。

**修法**：把 provenance 从文档侧找回来，新增 `docs_stating_status(docs) -> set[str]`
（`_STATUS_LABEL` 扫每份文档有没有显式状态标签行），R4 的证据条件改成
`owner / progress / dueDate / (status 且该文档明写了状态标签)`。

🔴 **刻意没动 `ProjectEntity` 的形状** —— 加字段是最直接的做法，但它被 `pg_registry.py:231` 的
`asdict(p)` 直接序列化进库、也是和 feat-055 项目屏的跨线契约。所以 provenance 从文档侧恢复，
实体一个字段没加，feat-055 仍然不需要适配。

**修后实测**：`Roadmap.md` → 1 个项目，ruling = R0-tracked。
**反向闸仍然成立**：`Sanya_Ops_Handover_ZH.md`（全文没有状态标签、只能靠散文嗅）
喂 `status="on-track"` 进去，照样判 R4-document-not-project —— 嗅出来的状态救不了幽灵，原意保住。

## 修复 4 —— `待确认 → 未知` 这个承诺端到端不成立（minor，extract.py:711）

`_norm_status` 的 docstring 写「So 待确认 returns '' and the card reads unknown」，
测试也断言「An unstated status must render 「未知」」。**但卡片上不是 unknown。**
返回 `''` 之后 `_project_from_span` 会兜底再嗅一次块文本，seed 上真 seed 实测：
`销售绩效与佣金方案`、`新人带教与团队士气` 自报「待确认」，端到端 status **都是 `blocked`** ——
比它拒绝赋予的 at-risk 还重。测试只断言了单元层 `_norm_status('待确认') == ''`，形状恰好避开了集成行为。

我**没有改行为**（推断有文档明写的阻碍项做依据、可追行，且这是产品定夺，不是我该擅自定的），
但把 docstring 改成了实情、并补了一条端到端测试
`test_pending_confirmation_falls_through_to_block_level_inference` 把当前真实行为钉死。
下次有人读这段注释不会再被误导。

## 回归测试（+9 条，全部先复现后设防）

`eval-harness/tests/test_project_granularity.py` 新增 9 条，**每条修前都实测复现过、回退即红**：

| 测试 | 守住什么 |
|---|---|
| `..._colon_does_not_wipe_the_milestone_list` | 修复 1 主路径 + LLM 形态端到端 |
| `..._colon_shaped_milestone_list_survives_in_english_too` | 修复 1 英文同构 |
| `..._field_line_whose_value_is_a_completion_word_is_never_a_milestone` | 修复 1 的**反向闸**（别把字段行吞成里程碑） |
| `test_r3_does_not_demote_a_phase_the_document_tracks_in_its_own_right` | 修复 2 闸一 |
| `test_r3_does_not_invent_a_parent_out_of_a_sibling_...` | 修复 2 闸二（不编造 parent） |
| `test_r3_still_demotes_a_phase_whose_real_parent_is_tracked` | 修复 2 的**反向闸**（R3 该干的活没丢） |
| `..._labelled_status_is_tracking_evidence_and_keeps_a_sparse_single_project_doc` | 修复 3 主路径 |
| `test_a_sniffed_status_still_does_not_rescue_a_phantom` | 修复 3 的**反向闸**（嗅出来的状态仍救不了幽灵） |
| `test_pending_confirmation_falls_through_to_block_level_inference` | 修复 4，钉死端到端真实行为 |

三条 major 每条都配了一条反向闸测试 —— 因为这三个 bug 有两个（1 和 3）本身就是
"修一个方向、捅穿另一个方向"造成的，只测正向等于给下一轮埋雷。

## 门（全部我自己跑过，输出如实）

```
$ python -m pytest eval-harness/tests/test_project_granularity.py -q
40 passed in 0.54s                      （31 原有 + 9 新增）

$ python -m pytest eval-harness/tests/ -q
950 passed, 61 skipped, 4 xfailed in 19.15s      0 failed
   —— 对比复核基线 941/61/4：+9 新测试，failed 恒为 0，没把绿的跑红

$ npm run typecheck        （tsc -b）  零输出零错
$ npm run build                        ✓ built in 2.92s
```

**真 seed 端到端复跑**（读 `D:\avery\.issues\...\e2e-seeds\`，只读，唯一允许的例外）：
```
DOCS = 5   PROJECTS = 6   RULINGS = 8
6 个项目 owner/status/progress/dueDate 全部有值，标题与文档 6 个「项目 N：」头逐一对应
2 条 R4-document-not-project（周例会纪要 / 绩效评估表）
```
**收敛结果与修复前一致 —— 6，等于数出来的 ground truth**（周报第 3 行「本期周报覆盖 6 个在跟进项目」）。
这三条修复都是**边界行为**，没有动这份 seed 上已经正确的主路径，这正是预期。
反过来说也印证了复核者的核心论点：**这个 seed 测不出这三个洞**，而本波成功标准是三家公司拿自己的真文件来试。

## 没做 / 仍然遗留

- **真 LLM 端到端仍未验证**（验收里唯一的 `unverifiable`）。仍然没有 `AVERY_BRAIN=minimax` key，
  凭据墙没动。门逻辑本身是用 `_build` 纯函数路径以 LLM 形态输入验证的（复核者独立复现过），
  `pipeline.py:117 → extract.py:1091 apply_gate` 这条链确认覆盖 LLM 路径而非只覆盖启发式路径；
  但 prompt 文本在真模型上的效果仍未验证。**拿到 key 必须复跑。**

  > ### 🔴 07-19 更正 ·「没有 key、属凭据墙」是错的（原文保留）
  >
  > **key 一直都在** —— `eval-harness/.env` 里有真的 MiniMax key，且 `service/app.py`
  > **导入时就会加载它**。这正是「跑全量 pytest 会真调 MiniMax、约 11 分钟真实计费」的原因；
  > 那条计费警告和这条「无 key」写在同一波文档里，互相矛盾。
  >
  > 所以这条 `unverifiable` **不是凭据墙挡住的，是没跑**。要验随时能验，代价是真金白银，
  > 不是权限。**别再把它当作「等 Danny 给 key」的待办**——没有人在等谁。
  >
  > 同一处错误在 `feature_list.json` 的 feat-054 evidence 里也有一份，已一并就地纠正。
  > `.issues/feat-068-frontend-deploy/session-handoff.md` 在 07-19 上午就点名了这两处该改，
  > 但当时**并没有真的改**，所以拖到现在。
- **`待确认` 的产品定夺没动**（见修复 4）。现在是 docstring 和测试都说实话，行为原样。
- **Layer C（signal 轴）没动**，第 5 条 strict xfail 仍保留。理由同上一轮，复核者核实成立。
- **`granularity` 仍不落库** —— ruling 只在内存里，项目屏为空时用户看不到解释。
  修复 3 把「稀疏文档被整条清空」这个最常见的空屏来源堵掉了，但**契约本身没变**，
  仍然是跨线遗留（要落库需要和 feat-055 一起定）。
