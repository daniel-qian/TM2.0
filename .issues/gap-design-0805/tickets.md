# 差距战役票册（0805 会后 · 常驻表单 + 交叉对比）

> PRD 底稿：同目录 `design-options.md`（含全部 文件:行号 证据，每票开工前必读对应节）。
> 会战目标：下周三亚碰头前，两句对客承诺（内置常驻表单收集信息 / 主动时间交叉对比）从话术变成真部件。

## 拍板记录（2026-08-05 晚，Danny）

1. **形态**：A1 用户故事（资料库常驻表单区 → 生成链接微信转发 → 员工手机填五格 → 直接进公司资料）✔
2. **深度**：A1+A2（提交进资料库 + 回流人卡自述/项目卡信号）✔
3. **B2 排进本周**，不用砍 ✔
4. **员工免登录**：单人单链 + 7 天过期；防转发/实名绑定进 roadmap ✔
5. **⚠ 头号纪律（每票必守）**：常驻表单**不是**信息的唯一来源——公司上传文件 + LLM 解析仍是平权来源。
   重点是**数据契约、交叉对比接口、时间戳规范对所有来源对齐**：表单提交 = 又一份带 `uploaded_at` 的
   `SourceDocument`，走与上传文件完全相同的 chunk/出处/引用契约；时间轴与冲突检测对来源无差别。
   禁止为表单发明任何「特殊旁路」。

## GitHub issue 正源（0805 起开票规范：票号=issue 号，commit 走 feat(#N)，收尾关 issue）

| 票 | issue | 票 | issue |
|---|---|---|---|
| T1 表单后端 | [#50](https://github.com/daniel-qian/avery/issues/50) | T3 资料库前端 | [#54](https://github.com/daniel-qian/avery/issues/54) |
| T4 时间轴规则 | [#51](https://github.com/daniel-qian/avery/issues/51) | T5 表单回流 | [#55](https://github.com/daniel-qian/avery/issues/55) |
| T6 归并记冲突 | [#52](https://github.com/daniel-qian/avery/issues/52) | T7 冲突上今天页 | [#56](https://github.com/daniel-qian/avery/issues/56) |
| T2 表单进资料 | [#53](https://github.com/daniel-qian/avery/issues/53) | | |

## 点票顺序（依赖关系）

```
现在可同时开：T1/#50（表单后端）· T4/#51（时间轴规则）· T6/#52（归并记冲突）
#50 合 main 后 → T2/#53（表单进资料）
#53 合 main 后 → T3/#54（资料库前端）· T5/#55（回流人卡）
#51+#52 合 main 后 → T7/#56（冲突上今天页）
全部收尾 → 回主会话做 HITL 端到端轮
```

通用纪律（每票）：AGENTS.md 全部规矩照走（init.sh、门电池、progress.md、feature_list 记账、先斩后奏合 main 即上产）；
双语文案自己写大白话（zh/en 同批、无孤儿键）；后端一个人话字都不发（ADR-0033）；worktree 开发、commit 前后核对分支。

---

## T1 · form-backend-a1a：表单存储 + 员工填写页

**前置**：无。**规模**：1 个 session。

**目标**：常驻表单的库表与员工侧 H5 全链：建模板 → 铸单人单链 → 员工打开 `/f/{token}` 填写 → 提交入库。

**范围与锚点**（详见 design-options.md §A1）：
- 新迁移 `0013_form_templates.sql`：`avery.form_templates`（context_id, id, title, fields jsonb, active）
  + `avery.form_submissions`（id, context_id, template_id, person_id, person_name, share_token UNIQUE,
  answers jsonb, submitted_at, expires_at）。**不复用 `avery.asks`**（其 CHECK/题型/状态机被红线门钉死）；
  迁移 increment-only、绝不 DROP。
- 员工页复用 ask 的 H5 基建：`_page()`/内联 CSS/双语 `_lang`（ask_api.py:486-536）、`_resolve_link()`
  的 404/410 诚实三态（ask_api.py:601-613）、`UPDATE … WHERE answered_at IS NULL` 原子答一次锁
  （pg_registry.py:754-）、manager 侧 `owner_token | X-Avery-Account` 双通道鉴权（ask_api.py:96-115）。
- 渲染必须改成**字段描述驱动**（field.kind → 渲染函数表），三题型：`text`(textarea) / `choice`(单选) /
  `number`(0-100 滑杆)。这是后续票不重写渲染层的前提。
- 内置第一张模板「周报」五字段：本周完成 / 未达成及原因 / 下周目标 / 需要支持 / 负载(0-100)+情绪(三选)。
  字段名与 `scripts/make-intake-xlsx.py:189-208` 的 06 表表头逐字一致（客户已拿到那张 xlsx）。
- 题面过红线门（沿用 gate + redline.validate）；表单文本=未受信内容，只存不听（0004 迁移文件头的注入边界）。
- 免登录 + 单人单链 + 7 天过期（拍板 #4）。

**门**：pytest 离线（渲染/校验/过期/防重复）+ `@needs_db`（新表真库全链，本地 Docker PG——离线套看不到持久层，
不跑=假绿）；生产迁移走懒加载核对。

**产出**：curl 可证全链（建模板→铸链→GET /f/{token}→POST 提交→库里有）；本票**不做** context 追加（T2 的活）。

---

## T2 · form-append-a1b：表单提交进资料（统一数据契约的关键一票）

**前置**：T1 已合 main。**规模**：1 个 session。

**目标**：提交落库后，把表单渲染成一份**真正的资料文档**追加进当前 context——与上传文件完全同构，
资料库出现「周报-{姓名}-{周}.md」一行，议事室 recall 立即可引用。

**范围与锚点**（design-options.md §A1「持久层写入通道」全节 + §A0）：
- 通道：`get(ctx) → 原地 mutate → put(ctx)`，形状照抄 `POST /team/{id}/notes`（ingest_api.py:429-454）。
  **⚠ 绝不新造 `CompanyContext`**——arch-0802 的回填只补 NULL 单元、补不回缺失行（pg_registry.py:324-421）。
  这条写进新写手的文件头注释。
- 渲染 md：字段名=06 表表头；**自由文本区与自述行分节、自由文本转义 `｜`**（防员工模仿自述行语法，T5 的门在此基础上验）。
- `parse.py` 切 chunk **必须非零**——零 chunk → `status='empty'` → 前端渲染「传了读不到」（pipeline.py:80-88
  + FileManifest.tsx:41-58），当客户面自伤。
- `ctx.source_documents.append(SourceDocument(...))`（0004 主键只有 (context_id, idx)，追加合法）+
  `ctx.extraction.materials` 追加 chunk + `validate_extraction` + 红线门 + `put()`。
- **⚠ 同批必修：`_material_vectors` 向量复用**（design-options.md A1 新坑一节）：pg_registry.py:227-262 的
  `isinstance(store, VectorStore)` 判据对 `get()` 重建的 `PgVectorStore` 失效（其 add() 是 no-op，store.py:217-221），
  每次 append-put 会**全语料重嵌**烧钱。修法：先按 (chunk_id, text) 捞回库里已有向量，只对新增块调 embedder。
  不修则本票上线即漏钱。

**门**：`@needs_db` 端到端：append 后旧文档字节仍在、向量只嵌增量（数调用次数）、facts.md 含表单内容、
议事室 recall 命中（mock brain 离线跑）。

**产出**：提交 → 资料库多一行可下载 → 议事室引用表单原句，三点可证。

---

## T3 · form-frontend-a1c：资料库「常驻表单」区

**前置**：T2 已合 main。**规模**：1 个 session（前端）。

**目标**：FilesScreen 新增第④段「常驻表单」：模板列表 + 「生成本周链接」（选人、复制链接）+
本周谁交了/谁没交状态列表。Danny 能整段演示线一故事。

**范围与锚点**：仿 `SwitchSection` 的「没有内容整段不渲染」（FilesScreen.tsx:92-96）；提交状态读 T1 的
manager 端点；复制链接用现有剪贴板套路；**手机端不承诺**（经理侧桌面为主，员工侧 H5 是 T1 的服务端页面）。
i18n 约 12 键 zh/en 自写大白话，跑 i18n-orphans。

**门**：前端门电池按 AGENTS.md 的 A→B→C 铁律跑（memory：build+preview 不用 dev、--mode development 不能省）；
像素基线随新区块更新；**改完布局必截图人眼过**。

---

## T4 · time-rules-b1：时间轴两条规则（零 LLM）

**前置**：无（与 T1-T3 并行）。**规模**：1 个 session。

**目标**：今天页出两类大白话条目：「这条判断依据来自 {days} 天前的《{doc}》，之后没有更新的资料」
（R-STALE-EVIDENCE，需确认级）；「同一事在两份新旧资料里读数不同且新的更糟」（R-FRESH-CONTRADICTS-STALE，高风险级）。

**范围与锚点**（design-options.md §B1）：
- 时间轴是纯 join：`MaterialChunk/ProjectEntity.source = "<source_key>:<line>"`（extract.py:357）×
  `source_documents.uploaded_at`（0004:33），已投前端（registry.py:722 → transport.ts:443）。零新表零新字段。
- 加规则=**四处同步**：decision_rules.py / zh.ts（1018-1036 段）/ en.ts / decision_grading_rules.md；
  硬门 `test_frontend_i18n_covers_every_rule` + `test_rules_doc_in_sync` 会抓漏。
- 阈值具名进 `RULE_PARAMS`（decision_rules.py:184-190 明文警告：数字别硬编码进句子）；前端 `{days}` 占位符。
- 措辞 ADR-0018：只说「读到/没读到」，绝不断言「你的文档里没写」。
- 已知局限（诚实记进票尾）：一批上传的文档时间戳几乎同刻，T2 落地前该规则少有命中——表单提交是把时间轴
  拉开的数据源，这正是设计里 A 先 B 后的原因。

**门**：决策定级离线电池全绿；两条规则的判据函数纯离线单测（构造实体即可，零模型调用）。

---

## T5 · form-reflow-a2：表单回流人卡/项目卡

**前置**：T2 已合 main。**规模**：1-1.5 个 session。

**目标**：周雅提交周报后——人卡出现「本人自述：负载 72（《周报-周雅-W32》）· 情绪偏紧」；
自由文本里的风险句成为带出处的情境信号；绑定项目的表单追加项目卡 blockers。

**范围与锚点**（design-options.md §A2）：
- 渲染文档时**故意生成解析层认得的自述行**：`周雅｜负载自述：72｜情绪自述：偏紧`
  （`_selfreport_from_lines` 语法 extract.py:1299-1342；情绪词表 extract.py:79-90；负载越界即拒）。
- 服务端调用链：`_selfreport_from_lines(ParsedDoc)` → stub `PersonEntity` → `_dedupe_entities`
  （extract.py:1648-1712）按**人员ID**归并（01 表已有该列，make-intake-xlsx.py:80-99），姓名只做兜底
  （防同名/花名并错人）。
- **绝不**经 `patch_person`/CRUD 写自述（registry.py:172 明令；ingest_api.py:573-576 extra=forbid）——
  人身数字只能走解析层，caliber 恒「本人自述」、source 必填（extract.py:93-124）。
- 投影随 `AVERY_ALLOW_PERSON_SCORING`（存储恒有，registry.py:327-333；该开关生产在开）。**不许开投影后门**。
- 自由文本 → `SignalEntity(summary=原句逐字, source=表单文档:行)`——summary 停在情境，绝不是对人的判断/标签
  （extract.py:338-339）。项目字段 → `ProjectEntity.blockers` + `provenance[field]={origin:'form',...}`
  （extract.py:294-302 side-car 现成）。
- **模仿攻击门**：员工在自由文本里写「负载自述：99」不得被当真——验 T2 的分节+转义在解析端真的挡住。

**门**：全链纯函数离线测试（表单答案→文本→stub→dedupe→人卡），**语料必须含中文字节**（memory：门语料
全 ASCII 盲点）；同名/花名归并案例；模仿攻击案例。

---

## T6 · conflicts-record-b2a：归并不再吃掉矛盾

**前置**：无（可与 T1/T4 并行）。**规模**：1 个 session。

**目标**：两份资料对同一人/项目给出不同读数时，`_dedupe_entities` 不再静默丢弃败方——记入
`ExtractionResult.conflicts`，连同双方 value+source+doc_key。

**范围与锚点**（design-options.md §B2）：
- **第一步（独立 commit）**：用离线单测把 `_dedupe_entities` 现有行为钉死（extract.py:1648-1712，
  「保留第一个非空子槽」1699-1706）——它是 heuristic+LLM 两条抽取路共用的核心纯函数，先钉死再动。
- 新增 `conflicts: list[FieldConflict]`：`{subject_kind, subject_ref, field, values:[{value, source, doc_key}]}`；
  丢弃非空候选时 append。
- 覆盖字段 v1 收窄 4 个：**部门/团队、人员在职状态、项目状态、到期日**。数值类（人数/进度）不做（假阳性高）。
- 落库：entities kind 扩展，先例照抄 `0010_entities_kind_playbook.sql`。
- v1 只报**完全不相等**的字符串（同义不同写的假阳性交给 T7 的 dismiss 出口）。

**门**：离线单测（含中文语料）：钉死案例全绿 + 冲突记录案例 + `asdict()` 往返。`@needs_db` 验 kind 落库。

---

## T7 · conflicts-rule-b2b：冲突上今天页

**前置**：T6 与 T4 均已合 main。**规模**：1 个 session。

**目标**：今天页出双引文卡：「《花名册》里读到周雅在前厅部，《周报-8/6》里读到她在传菜组——两份对不上」，
带两份文档名+两个时间；配「可能只是叫法不同」关闭出口。

**范围与锚点**：
- 新规则 `R-CROSS-DOC-CONFLICT`（需确认级）：证据=两条 verbatim 原句 + 两文档名 + 两 uploaded_at
  （时间映射复用 T4）。四处同步 + 两道硬门，同 T4。
- 前端：双栏证据渲染（照抄现有 verbatim+出处证据契约：gapDerive.ts:55-70 与 LiveDecisionRuleHit 同一纪律，
  不发明新形状）；dismiss 沿用 flowStore.ts:226-236 分桶，零新状态机制。
- **措辞红线**：只说「读到…读到…对不上」，绝不「你写错了」（ADR-0018 + zh.ts 决策块注释）。

**门**：决策电池 + i18n 双门 + 前端门电池相关区 + 截图人眼。
