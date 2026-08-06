# 差距设计方案对比（0805 会后 · 常驻表单 + 交叉对比）

> 来源：五路深读 + 架构综合（ultracode workflow wf_602e76b3-524）。作为后续 AFK 票的 PRD 底稿。
> Danny 拍板记录见文末（待补）。

## 方案 A 组：常驻表单闭环（周报/日报/工作汇报 → 员工填 → 直接进 Avery）

### A0 · 先钉死三条改不动的边界（后面每个方案都在这三条里跳舞）

1. **人卡上唯一合法的人身数字是 `self_report`，且只有两个子槽**：`load`(0-100 int) 与 `mood`(steady/stretched/strained/other 枚举)，`caliber` 恒 `"本人自述"`、`source` 必填（`eval-harness/avery/ingest/extract.py:93-124`）。"本周做了什么""需要什么支持"这类自由文本**结构上进不了人卡**——`PersonEntity` 没有那个字段，`0009_person_keys_allowlist_richalign.sql:65-71` 的 CHECK 也只放行 11 个键。它们只能落 `SignalEntity`（`extract.py:337-346`）或 `ProjectEntity.blockers/summary`（`extract.py:279-302`）或 `MaterialChunk`。
2. **手编 HTTP 通道永远碰不到 `self_report`**：`registry.py:172` 明写"不碰 self_report——人身数字禁经手编通道"，`ingest_api.py:573-576` 的 Pydantic model 是 `extra='forbid'` 且无该字段。任何"表单→人卡"的写手**必须复用解析层**（`_selfreport_from_lines`，`extract.py:1299-1342`），不能复用 `patch_person`。
3. **advise 的引用面是 facts.md/notes.md，不是向量库**：`avery/tools.py:157` 走 `memory.recall(query, ctx.memory_dir)`，而 facts.md 由 `materialize_memory(ctx.extraction)` 在 `put()` 内重写（`pg_registry.py:301-306`）。**只要表单内容并进 `ctx.extraction`，议事室当天就能引用到它**，不必碰 pgvector。这是 A 组最便宜的落点，也是下面所有方案的技术地基。

---

### A1 · 「表单即资料」——最小可兑现（推荐先做）

**用户故事**：经理在资料库点「周报模板 → 生成本周链接」，选中传菜领班周雅，拿到 `https://avery.../f/<token>`，微信转发。周雅手机打开，看到 5 个字段（本周完成 / 未达成及原因 / 下周目标 / 需要支持 / 负载 0-100 + 情绪三选一），填完点提交，看到"已收到，这条已经进了你们公司的资料"。经理刷新资料库，**当前资料**里多出一行「周报-周雅-2026W32.md · 已读取 · 6 段」，可下载原件。经理在议事室问"传菜组这周怎么样"，Avery 引用「《周报-周雅-2026W32》：晚市高峰传菜等位超 8 分钟，缺一个人」。人卡、今天页此轮不变。

**动哪些层**
- 新迁移 `0013_form_templates.sql`：`avery.form_templates`（context_id, id, title, fields jsonb, active）+ `avery.form_submissions`（id, context_id, template_id, person_id/person_name, share_token UNIQUE partial, answers jsonb, submitted_at, expires_at）。**不复用 `avery.asks`**：`asks.status` 的六词 CHECK 被服务端钉死（`0007_ask.sql:29-31`）、`MAX_QUESTIONS=3`（`ask.py:33`）、`QUESTION_KINDS=("scale","yesno")`（`ask.py:30`）、状态机是一次性 draft→shared（`ask_api.py:363-384`）。改这四处等于把快问的红线门一起重写；迁移目录的纪律是 increment-only / never DROP（0006/0007 文件头），改既有 CHECK 直接违纪。
- 复用（原样搬，不改）：H5 骨架 `_page()`/内联 CSS/双语 `_lang`（`ask_api.py:486-536`）、`_resolve_link()` 的 410/404 诚实三态（`ask_api.py:601-613`）、`UPDATE ... WHERE answered_at IS NULL` 的原子答一次锁（`pg_registry.py:754-`）、题面红线 `gate_ask_red_line` + `redline.validate`、manager 侧双通道鉴权 `owner_token | X-Avery-Account`（`ask_api.py:96-115`）。
- 新渲染分支：`text`(textarea) / `choice`(单选按钮组) / `number`(0-100 滑杆) 三种 kind。现状 `_form_page` 是 f-string 硬拼两分支（`ask_api.py:562-581`）；A1 就把它改成**字段描述驱动的 for 循环**（field.kind → 渲染函数表），这是后面 A2/A3 不用重写渲染层的唯一前提。
- 新端点 `POST /team/{context_id}/forms/{submission_id}/ingest`（内部调用，提交时直接触发）——形状照抄 `POST /team/{id}/notes`（`ingest_api.py:429-454`）：`authorize_context` → 写 → `ValueError → 422`。

**持久层写入通道**
走 **`get(ctx) → mutate → put(ctx)`**，不走 `/ingest`（`/ingest` 恒新建 context 并重铸 owner_token，`ingest_api.py:228-250`）。具体：
1. 把答案按 `scripts/make-intake-xlsx.py:189-208` 的 06 表字段名渲染成一份 Markdown 文本（字段名与 Danny 已经发给客户的 xlsx 表头逐字一致，客户看得懂来龙去脉）。
2. `ctx.source_documents.append(SourceDocument(filename="周报-周雅-2026W32.md", source_key=<唯一键>, mime="text/markdown", content=bytes, uploaded_at=now))`——`0004_source_documents.sql:24-35` 的主键只有 `(context_id, idx)`，filename 无唯一约束，追加合法。
3. 用 `parse.py` 把同一份文本变成 `ParsedDoc`，切出 `MaterialChunk` 追加进 `ctx.extraction.materials`。**这一步不能省**：`_finalize_source_documents`（`pipeline.py:80-88`）的规则是"parse 了但零 chunk → status='empty'"，前端 `FileManifest.tsx:41-58` 会把 empty 渲染成"传了读不到"——当着酒店客户的面把刚提交的周报标成读不到，是自伤。
4. `validate_extraction(ctx.extraction)` 再 `put(ctx)`。

**怎么绕开两个陷阱**
- **列覆盖陷阱：已被 arch-0802 补掉，但只保护"没提到的行"**。`put()` 是 DELETE+INSERT 快照替换（`pg_registry.py:361-366`），靠 `_prior_src_bytes` / `_prior_mat_vecs` 两张 `ON COMMIT DROP` 临时表回填 NULL 单元（`pg_registry.py:324-421`）。所以纪律是：**必须 `get()` 回来的那个 ctx 对象上原地 append，绝不新造 `CompanyContext`**——新造的对象 `source_documents` 是空的，回填只补"值为 NULL 的行"，补不回"整行不存在"。这条要写进新写手的文件头注释。
- **⚠ 本次现读发现的新坑（深读没覆盖，是 A 组最贵的一项）**：`_material_vectors()`（`pg_registry.py:227-262`）优先复用 `ctx.store` 的已算向量，但判据是 `isinstance(store, VectorStore)`；而 `get()` 重建出来的是 **`PgVectorStore`**，`PgVectorStore.add()` 本身是 no-op（`store.py:217-221`）。于是每一次 append-put 都落到 fallback 分支，用注册表自己的 embedder **把整个语料重嵌一遍**——生产 `active_registry()` 恒带 embedder（`registry.py:1080`）。10 人 × 每周一份周报 = 每周 10 次全语料重嵌，全部计费（有 `AVERY_EMBED_CALL_BUDGET` 花费闸兜底，但兜到的是"降级成 NULL 向量"，不是省钱）。**修法很短**：把 `_prior_mat_vecs` 已经证明可行的那招提到 `_material_vectors` 里——先按 `(chunk_id, text)` 从库里捞回已有向量，只对新增块调 embedder。半天工，但必须和 A1 同批做，否则 A1 上线即漏钱。
  - 另一半：新块若最终 embedding 为 NULL，`PgVectorStore.query` 的 `WHERE embedding IS NOT NULL`（`store.py:230`）会让它在向量面隐身。但按 A0-3，advise 走的是 facts.md，所以**功能不受影响，只是检索质量**——可以诚实地把这条写进 roadmap 而不是阻塞发布。
- **entities allowlist**：A1 完全不写 `entities` 的 person 行，CHECK 不涉及。

**三处呈现**
- 资料库（`src/lite2/screens/FilesScreen.tsx`）：第①段「当前资料」自然多一行，零改动；第④段新增「常驻表单」，仿 `SwitchSection` 的"没有就整段不渲染"模式（`FilesScreen.tsx:92-96`），列模板 + 「生成本周链接」+ 「本周谁交了/谁没交」。
- 人卡：**不变**（A1 的诚实边界，别在演示里暗示它变了）。
- 今天页：**不变**。

**工程量 / 风险 / 门的代价**
- 后端 2 个 AFK session（迁移+表单 CRUD+H5 三题型渲染+提交入库 1 个；append-writer + `_material_vectors` 复用修 1 个），前端 1 个 session（资料库第④段+生成链接+状态列表），共 **≈ 3 session / 4-5 人日**。
- 风险：① 免登录 token 谁拿到谁能填（`ask_api.py:618` 的既有姿态），周报比快问更敏感（写的是绩效素材），但加身份校验就破了"IM 里一点就填"的产品前提 → 建议维持免登录 + 链接单人单次 + 7 天过期（`ask.py:34,83-86`），把"防转发"明确写进 roadmap；② 表单文本是**未受信内容**（和上传文件同级），进 facts.md 后会被 advise 读到 → 必须过 `validate_extraction` 与 `put()` 内的 `_gate_red_line`，且渲染成文档时**不得**把答案拼成"周雅：负载 72"这类可被误当抽取标签的行（见 A2）。
- 离线门：新增 `test_form_submission_appends_context`（`@needs_db`，本地 Docker PG）+ 纯离线的渲染/解析单测。**注意 MEMORY 的"离线套看不到 pg 持久层"** —— 这条链的 5 型真库 bug 只有 `needs_db` 层能抓到，不跑就是假绿。
- 双语：H5 表单页 ZH/EN 两份文案（`_COPY` 已有机制），前端第④段约 12 个 i18n 键 × 2 语言。半天。
- **留给 roadmap 口头讲**：定时自动催发、未交自动提醒、按角色自动分发、模板自定义编辑器、防转发/实名绑定。

---

### A2 · 「表单回流人卡/项目卡」——在 A1 上加一层解析（Danny 那句话的完整兑现）

**用户故事增量**：周雅提交后，经理点开周雅的人卡，看到「本人自述：负载 72（《周报-周雅-2026W32》记录）· 情绪 偏紧」，以及一条情境信号「晚市高峰传菜等位超 8 分钟，缺一个人（周报自述，8/6）」。她名下的「宴会厅翻台」项目卡上多了一条阻塞原句。

**动哪些层（只讲增量）**
- 渲染文档时**故意生成解析层认得的那一行**：`周雅｜负载自述：72｜情绪自述：偏紧`——这正是 `_selfreport_from_lines` 的语法（分隔符 `｜`/`|`，cell 0 = 姓名，`<label>自述：<value>`，`extract.py:1299-1342`，负载越界即拒、情绪走 `norm_mood_selfreport` 词表 `extract.py:79-90`）。
- 服务端直接调用 `_selfreport_from_lines(ParsedDoc)` → 得到只带 self_report 的 stub `PersonEntity` → 调**模块级纯函数** `_dedupe_entities()`（`extract.py:1648-1712`）按姓名并进 `ctx.extraction.people`（它保留每人第一个非空 load/mood 子槽，`extract.py:1699-1706`）→ `put()`。**不碰 `patch_person`，不碰 CRUD 端点**（A0-2）。
- 自由文本字段 → `SignalEntity(subjectType='person', subjectRef='周雅', summary=<原句逐字>, source='<表单文档>:<行>')`。红线：`SignalEntity` 的 summary "停在情境，绝不是对人的判断/标签/评分"（`extract.py:338-339`）——表单字段名本身就得是情境式的（"未达成及原因""需要支持"），这一点 06 表已经写对了（`make-intake-xlsx.py:189-208`）。
- 表单若绑定项目 → 追加 `ProjectEntity.blockers` 并写 `provenance[{field}] = {origin:'form', source:'<表单文档>', updated_at:now}`（`extract.py:294-302` 的 side-car 机制现成）。

**必须由 Danny 拍的一个开关**：`self_report` 的**存储恒有、投影随开关**（`registry.py:327-333, 358`）。`AVERY_ALLOW_PERSON_SCORING` 关着时人卡上一个自述数字都不显示，`scoring_enabled` 键干脆不发（`transport.ts:112-115`）。**要给酒店客户演示"负载/情绪进人卡"，这台后端就得开这个开关**——这是公司开关口径，不是红线争议，一句话确认即可。

**工程量**：在 A1 之上 **+1.5 session / 2 人日**。风险：① 姓名归并靠 `_dedupe_entities` 的按名匹配，酒店有同名/花名（"小周""周姐"）会并错人 → 表单里带 `人员ID`（01 表已有该列，`make-intake-xlsx.py:80-99`），按 ID 归并、姓名只做兜底；② 表单渲染出的那一行如果被员工在自由文本里模仿（"我的负载自述：99"），会被解析层当真 → 渲染时把自由文本区与自述行分节，并对自由文本做 `｜` 转义。这条要写门。
- 离线门：`_selfreport_from_lines` 是纯函数，"表单答案 → 文本 → stub person → dedupe" 全链可离线钉死，成本低。**语料必须含中文字节**（MEMORY: 门语料全 ASCII 盲点）。

---

### A3 · 「常驻表单 = 模板 + 周期实例 + 催收视图」——完整形态

在 A2 上加：模板与实例分离（同一张表按周生成新实例）、经理侧「本周 8 人交了 5 人」聚合视图、今天页新增一条「传菜组还有 3 人没交本周周报」条目（走 B 组的决策卡通道，见交叉分析）。
**工程量 +2 session / 3 人日**；主要成本在实例状态机（open/collecting/closed）与聚合读端点。**定时自动催发一律留 roadmap 口头讲**——它需要一个当前架构里根本不存在的调度器（无 cron、无 worker），现在硬做等于新开一整条基建。

---

## 方案 B 组：交叉对比 / 差距强化

### B0 · 现有「值得注意」到底是什么（结论：三套同名异物，且都不跨资料）

| | 计算在哪 | 判据 | 跨文档？ |
|---|---|---|---|
| 前端 gap 卡 | `src/lite2/gapDerive.ts:80-112` 纯函数 | 同一 `LiveProjectCard` 内部：`statusRaw ∈ {on-track,steady}` 且 `blockers` 非空 | 否（数据已拍平，看不到"多份资料"） |
| 后端 need-a-look 计数 | `src/shared/briefing.ts:106-112` 读后端 `briefing.metrics` | 决策定级引擎的分级计数 | 否 |
| advise 的 detected_signals | `eval-harness/service/contract.py:39-55` | 单次问答 transcript 的 cites 投影 | 否 |

三者无任何互相对账的代码路径。**结论：强化应该长在决策定级引擎那条上，不是长在 `gapDerive.ts` 上。** 理由有三：① `decision_rules.py` 已经是"后端出机器键、前端 i18n 出句子"的成熟模式（ADR-0033），加一条规则的边际成本≈一个 `Rule(...)` + 两条 i18n 词条；② 它已经有一条 `R-SELF-REPORT-MISMATCH`（`decision_rules.py:160`），语义就是"自述与信号不一致"，新规则是它的自然家族；③ `gapDerive.ts` 读的是拍平后的卡，**物理上拿不到多份原始资料**，在它上面做跨资料对比是死路。

### B1 · 时间轴归因 + 陈旧证据（确定性，零 LLM，零新表）——推荐先做

**关键发现（本次现读，深读未覆盖）**：时间性**已经可以确定性推导出来，不需要任何新字段**。链路是：`MaterialChunk.source` / `ProjectEntity.source` 的格式是 `"<source_key>:<line>"`（`extract.py:357`），而 `source_key` 正是 `_finalize_source_documents` 与 `source_documents` 表的 join key（`pipeline.py:66-70`），`source_documents.uploaded_at` 是 timestamptz（`0004_source_documents.sql:33`），已经一路投到前端（`registry.py:722` → `transport.ts:443`）。**所以"这条判据读自哪份资料、那份资料多新"是一个字符串前缀 join 就能算出来的东西。**

新增两条规则（`decision_rules.py` 的 `RULES` 元组 + 两条 i18n）：
- `R-STALE-EVIDENCE`（需确认）："这条判断的依据来自 {days} 天前的《{doc}》，之后没有更新的资料"。阈值具名进 `RULE_PARAMS`（`decision_rules.py:191-198` 的现成机制），前端用 `{days}` 占位符填。
- `R-FRESH-CONTRADICTS-STALE`（高风险）：同一 subject 的同一字段，在两份 `uploaded_at` 不同的文档里读出不同值，且新的那份说的更糟。

**今天页完整数据流**（对齐深读5）：`decision_rules.py` 加 Rule → `decision_grading.py` 判据函数（读 subject + 新增的 `source→uploaded_at` 映射）→ `LiveDecisionCard.matched_rules`（`transport.ts:326-352`，additive，缺席≠none）→ `src/shared/i18n/{zh,en}.ts` 的 `lite2.decisionRules` 各加一条（`zh.ts:1018-1036`）→ `composeRuleReason()` 拼句 → `HomeScreen.tsx:416-501` 的「今天要决策的」区块渲染，**一行前端渲染代码都不用改**。
**门是硬的**：`tests/test_decision_i18n_contract.py:95-107` 的 `test_frontend_i18n_covers_every_rule` 双语齐全 + 无孤儿键，`test_rules_doc_in_sync` 还要求 `eval-harness/decision_grading_rules.md`（给客户当场看的口径说明书）同步。加一条规则 = 改四处（rules.py / zh.ts / en.ts / .md），漏一处门就红。这是**优点**，不是负担。

**工程量**：**1.5 session / 2 人日**。风险：**同一 context 内所有文档几乎是同一刻上传的**（`/ingest` 一批全进，`uploaded_at` 差几十毫秒）→ 在 A 组落地前，B1 的时间轴基本是平的，只在"经理隔周补传一份"时才有信号。**这就是两组之间最强的耦合论据：A 组的表单提交是唯一天然按时间拉开的新数据源**（一周一次、按人分散）。B1 单独上线只兑现一半；A1+B1 一起上线，第二周就有真正的"新旧资料对不上"可看。

### B2 · 跨文档字段冲突（确定性对照）——真正的"多种资料互相不一样"

**核心工程量在一个反直觉的地方**：冲突信息**在归并那一刻就被吃掉了**。`_dedupe_entities()`（`extract.py:1648-1712`）按姓名合并同一人的多份读数，"保留第一个非空子槽"（`extract.py:1699-1706`）——花名册说"周雅 / 前厅部"、周报说"周雅 / 传菜组"，合并后只剩一个，**第二个读数连同它的出处一起被丢弃**。所以 B2 不是"再写一个比较器"，而是"**让归并把丢弃的候选记下来**"：
- `ExtractionResult` 新增 `conflicts: list[FieldConflict]`（`{subject_kind, subject_ref, field, values:[{value, source, doc_key}]}`），`_dedupe_entities` 在丢弃非空候选时 append 一条。additive 字段，`asdict()` 落 `entities` 之外（建议单独 kind 或挂 `ExtractionResult` 顶层 → 需要 `_ENTITY_KINDS` 扩一个 kind，`0010_entities_kind_playbook.sql` 就是这个动作的现成先例）。
- 覆盖字段先收窄到 4 个确定性可比的：**部门/团队、人员在职状态、项目状态、到期日**。人数/进度这类数值先不做（口径歧义大，假阳性高）。
- 新规则 `R-CROSS-DOC-CONFLICT`（需确认）：证据是两条 verbatim 原句 + 两个文档名 + 两个 uploaded_at，句子在前端 i18n。

**⚠ 措辞红线点名**：ADR-0018 + `zh.ts:1005-1007` 的注释——**只许说"读到 / 没读到什么"，绝不许替客户断言"你的文档里没写 X"**。所以这条卡的中文必须是「《花名册》里读到周雅在前厅部，《周报-8/6》里读到她在传菜组——两份对不上」，**不能**是「你的花名册写错了」。

**工程量**：后端 2 session（conflicts 结构 + dedupe 改造 + 规则 + 迁移）、前端 0.5 session（证据双栏渲染）、i18n 0.5 天，**≈ 2.5 session / 3.5 人日**。风险：① `_dedupe_entities` 是抽取链的核心纯函数，改它会波及每一条抽取路径（heuristic + LLM）与全部既有门 → 必须先把它现有行为用离线单测钉死再动；② 假阳性来源是**同义不同写**（"传菜组"vs"传菜"vs"前厅-传菜"）→ v1 只报**完全不相等**的字符串，并在卡上给"这不是错，可能只是叫法不同"的出口按钮（沿用 `flowStore.ts:226-236` 的 dismiss 分桶机制，零新前端状态）。

### B3 · LLM 辅助——取舍结论：**不让 LLM 找矛盾，只让它说话，且只在已命中的卡上**

- **成本**：跨文档两两比对的候选集是 O(n²) 段落，交给 LLM 扫一遍 = 每次刷新一次全语料级调用。相比之下 B2 的确定性扫描是本地 O(n)。
- **离线门**：`decision_grading` 全套离线可跑（`tests/test_briefing_look_count.py` 直接构造实体、零模型调用）。LLM 找矛盾会让这条门要么变成 `needs_keys`（真烧钱，`AGENTS.md:57` 四个 deselect 不是可选的），要么变成 fixture 自考自答（MEMORY: 假绿八型之一）。
- **红线**：ADR-0033 后端不发人话。LLM 生成的句子**只有一个合法出口**——`LiveDecisionCard.reason` + `reason_source='avery'`（`transport.ts:343-347`），且引擎只许 Avery **上调**等级、不许下调（`downgrade_blocked` / `rejected_grade` 已在契约里）。
- **结论**：B3 = 在 B2 已经确定性命中的冲突卡上，允许 Avery 写一句大白话理由并可上调等级。**它不产出新条目、不决定等级下限、不进 i18n 表**。工程量 +0.5 session（复用现成的 review/escalation 管线）。**默认关**，演示前手动开。

---

## 交叉分析

### 两组共享的基建（先做谁另一个变便宜）

1. **`source_key → uploaded_at` 的时间轴映射**（B1 的核心，A1 的副产品）。A1 每提交一份表单就 append 一个带真实 `uploaded_at` 的 `SourceDocument`——**A 组是 B 组唯一的时间维度数据源**。反过来，B1 先做则映射函数就位，A1 上线当天就有"新旧对不上"可展示。**净收益方向：A1 先做，B1 立刻变得有内容可显示。**
2. **`get→mutate→put` 的 append-writer + `_material_vectors` 向量复用修**（A1 必做）。B2 若要在 conflicts 结构上做增量写，用的是同一条通道、同一套陷阱注释。
3. **决策卡通道**（B 组的落点）也是 A3 "3 人没交周报"条目的落点——A3 因此不需要新前端区块。
4. **verbatim + 出处的证据契约**：`GapCard.evidence`（`gapDerive.ts:55-70`）、`LiveDecisionRuleHit` 的原文字段、`SelfReportLoad.source`——三处已经是同一个纪律。新东西照抄，不发明新形状。

### 推荐组合与排序（一周，按 AFK session 切）

| # | Session | 内容 | 产出 |
|---|---|---|---|
| 1 | 后端·A1a | 迁移 0013 + 表单模板/实例 CRUD + H5 字段驱动渲染（text/choice/number）+ 提交入库 | `/f/<token>` 能填能存 |
| 2 | 后端·A1b | append-writer（`get→mutate→put`，SourceDocument + MaterialChunk）+ **`_material_vectors` 按 chunk_id 复用向量修** + `@needs_db` 门 | 提交进资料库、议事室能引用、不漏钱 |
| 3 | 前端·A1c | 资料库第④段「常驻表单」+ 生成链接 + 交没交状态 + 双语 | Danny 能整段演示第①句承诺 |
| 4 | 后端·B1 | `source→uploaded_at` 映射 + `R-STALE-EVIDENCE` / `R-FRESH-CONTRADICTS-STALE` + 四处同步（rules.py / zh / en / rules.md） | 今天页出时间性大白话条目 |
| 5 | 后端·A2 | `_selfreport_from_lines` + `_dedupe_entities` 回流人卡/项目卡 + 按人员ID归并 + 转义门 | 第①句承诺的"更新人卡"落地 |
| 6 | 后端·B2a | `_dedupe_entities` 现有行为离线钉死 → 加 `conflicts` 结构 | 冲突不再被归并吃掉 |
| 7 | 后端+前端·B2b | `R-CROSS-DOC-CONFLICT` + 双栏证据渲染 + dismiss 出口 | 第②句承诺落地 |

**为什么是这个序**：A1 三个 session 是唯一一条**每一步都能单独给客户看**的路径（能填 → 进资料 → 界面上看得见），而 B 组在 A 组之前做，时间轴是平的、冲突源只有一批同刻上传的文档，做出来在酒店真实数据上大概率**一条都不命中**——那比不做更伤。A2 排在 B1 之后，是因为 A2 依赖一个待 Danny 确认的开关（`AVERY_ALLOW_PERSON_SCORING`），不该卡住主线。B3 不进这一周。

**一周内跑不完就砍哪个**：砍 B2（保 A1+A2+B1）。第②句承诺退到 B1 的"新旧资料时间性冲突"，仍然是真兑现，只是覆盖面窄。

### 每个方案「绝不能破」的既有纪律（逐条点名）

**A1**
- `put()` 只在 `get()` 回来的 ctx 上原地 append，**绝不新造 `CompanyContext`**（arch-0802 回填只补 NULL 单元，补不回缺失行，`pg_registry.py:324-421`）。
- 表单文本必须切出 chunk，否则 `status='empty'` → 界面说"传了读不到"（`pipeline.py:80-88` + `FileManifest.tsx:41-58`）。
- 不改 `avery.asks` 的 status CHECK、不改 `QUESTION_KINDS`、迁移 increment-only 不 DROP。
- 表单文本是**未受信内容**，只存不听（`0004` 文件头的注入边界）。
- 双语：H5 与前端新文案 ZH/EN 同批出，`i18n-orphans` 不留孤儿键。

**A2**
- 人身数字**只能进 `self_report.load/mood`**，caliber 恒「本人自述」、source 必填（`extract.py:93-124`）。
- **不得**经 `patch_person` / CRUD 端点写自述（`registry.py:172`、`ingest_api.py:573-576`）。
- 投影随 `AVERY_ALLOW_PERSON_SCORING`，存储恒有（`registry.py:327-333`）——不许为了演示在投影层开后门。
- `SignalEntity.summary` 停在情境，绝不是对人的判断/标签（`extract.py:338-339`）。
- ADR-0023 的结构护栏仍在：**快问回执**继续挂 `(ask, recipient)`，A2 打通的是**表单**这条新通道，不是把 ask 回执搬上人卡。

**B1 / B2**
- ADR-0033：后端只发机器键 + verbatim，**一个中文字都不进载荷**；句子在 `src/shared/i18n/{zh,en}.ts`。
- ADR-0018 措辞：只说"读到 / 没读到"，绝不断言"你没写"（`zh.ts` 决策块红线注释）。
- `unknown_fields` / `unparsed_fields` 互斥且都必须显式渲染，**绝不渲染成 0% 或空白**（`transport.ts:336-342`）。
- 加规则 = 同步四处（`decision_rules.py` / `zh.ts` / `en.ts` / `decision_grading_rules.md`），`test_frontend_i18n_covers_every_rule` + `test_rules_doc_in_sync` 是硬门。
- 阈值归后端 `RULE_PARAMS`，句子归前端模板——**别把数字硬编码进中文句子**（`decision_rules.py:184-190` 的明文警告）。
- 派生层 locale-free：新前端派生只出结构化字段 + verbatim，一个字都不拼（`handoffCopy.ts:1-30` 的 ZH-02 教训）。
- `_dedupe_entities` 改造前先用离线单测钉死现有行为——它在 heuristic 与 LLM 两条抽取路径上都是共用的。

**B3**
- LLM 只能写 `reason`（`reason_source='avery'`）、只许**上调**等级；等级口径永不进 prompt（`decision_rules.py:16` 红线）。
- 离线电池必须保持 `not needs_keys` 全绿——LLM 那条路默认关，门里不跑。