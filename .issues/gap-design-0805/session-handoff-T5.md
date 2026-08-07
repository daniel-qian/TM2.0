# T5 · form-reflow-a2 交接（2026-08-07 · 分支 claude/sad-sutherland-a696e5）

**状态：done，已合 main。** issue [#55](https://github.com/daniel-qian/avery/issues/55)，feature_list `feat-101`。
前置核对：T2（e70d492）确认在 main 后才开工；同批 main 上已有 T7（e8d3882）的 conflicts 机制。

## 交付了什么（票面「目标」三句，逐句可证）

1. **人卡出现「本人自述：负载 72 · 情绪偏紧」**：周雅提交 → `form_reflow.stub_person_from_submission`
   用 `HeuristicExtractor._selfreport_from_lines` 从**渲染出来的那份文档**里读出自述槽 → 按工号并进人卡。
   `caliber` 恒「本人自述」（dataclass 默认值，写手没有改它的机会），`source` = `<source_key>:<行>`。
   投影随 `AVERY_ALLOW_PERSON_SCORING`，**存储恒有**。前端零改动即渲染（`TeamScreen.SelfReportRow`
   是 rich-align-0722/03 就有的）。
2. **自由文本里的风险句成为带出处的情境信号**：`SignalEntity(subjectType='person', subjectRef=<人卡 id>,
   summary=<那一格答案的第一行原话逐字>, source='<source_key>:<行>')`。
3. **绑定项目的表单追加项目卡 blockers**：`ProjectEntity.blockers` + `provenance['blockers'] =
   {origin:'form', source:<表单文档>, updated_at:<提交时刻>}`。

## 本票动到的骨头：归并第一次有了真身份信号

票面写「按人员ID归并」，但开工核代码发现**两边都没有这个东西**：`PersonEntity` 没有工号字段，
`_ZH_HEADER_MAP` 不认「人员ID」，`_people_from_roster` 一个字都没读过它（01 表那一列走到人卡的路
从来没修过）。`_person_key` 的 docstring 自己写着「两个同名的同事会并成一张卡，要分开得有真身份
信号（工号/邮箱），lite 没有」——**T5 就是那个信号到货的票**。

- `PersonEntity.person_id`（新字段）。0009 allowlist **就地改**（该文件头明令不许加新迁移），
  `test_person_keys_allowlist_covers_exactly_person_fields` 是它的看门狗。
- `_ZH_HEADER_MAP` += 人员ID / 人員ID / 人员id / 人員id / 工号 / 工號 → `person_id`；
  `_people_from_roster` **只从表头读，没有位置兜底**（01 表把它放第 6 列，位置兜底只到 cells[3]，
  编一个位置等于把部门当工号存进归并的第一把尺）。原来手列在 `_NOT_NAME` 里的「工号/工號」删了——
  它们现在从 `_ZH_HEADER_MAP` 自动折进去，两份抄本就是 feat-048 round 1 付过学费的漂移。
- `PersonIndex`（extract.py）取代原来那一行 `key = _person_key(p.name)`，四条规则：
  工号对上 → 同一个人（花名也认得出）；工号不同 → **永不**并（同名两个人）；
  这个名字底下已经有两个人而这条读数**没有**工号 → 也不并（挑第一个是不报错的错误归属）；
  都对不上 → 开新的一格。**没有任何工号时逐字退化成旧行为**——T6 的钉死门全绿就是这句话的证明。
- `_disambiguate_person_ids`：同名两张卡不许撞 `_slug` 出来的同一个 id（id 是前端 join 的键，
  撞了就是 A 的信号显示在 B 的详情里，不报错、门也全绿）。
- `_link_owners` 的 `by_name` 现在**丢掉有歧义的名字**：同名两个人存在之后，那个 dict 会静默
  last-wins 挑一个。今天所有没有工号的语料上这是 no-op。

## 关键取舍（后续票别再推导一遍）

- **回流不调 `_dedupe_entities`，改用 `merge_person_reading`（共用 `PersonIndex` + `_absorb_person`）。**
  票面写的是「调 `_dedupe_entities`」，读完代码后**故意不照做**，四条伤都在代码里核过：
  ① 它结尾整表重写 `res.people` / `res.signals`，而 `ctx.extraction` 是跑过归并、之后又被手编 CRUD
  改过的清单——手加的人（`um-…`）会被同名并掉，而 `archived`（软删）和 `provenance`（手编出处）
  **根本不在合并规则里**，连人带证据一起消失。一次员工提交不该有权撤销经理手动归档过的一张卡。
  ② `conflict_index` 每次调用新建、`res.conflicts` 跨 `get()` 持久 → 重跑会追加重复冲突（T7 渲染两遍）。
  ③ `held_src` 同理重建，会把某个格子的出处认成「活下来那条实体的整条 source」。
  ④ signals 那段按 `_signal_key` 重筛，而回流时 subjectRef 已经是 id 不是姓名。
  **契约（一把身份尺、enrich 不 clobber）照守，字面调用不守**，两条路的一致性由门
  `test_the_form_writer_and_the_pipeline_merge_a_person_the_same_way` 咬着。
- **模仿攻击两道锁，互相独立**：T2 的竖线转义（结构锁）+ T5 的身份锁（解析出来的自述行里，
  只认名字等于这条链主人的那一行）。**工号取自 `submission.person_id` 这个结构化字段，绝不从文档
  文本里读**——文档里的「人员ID：P-0007」是一行渲染给人看的元数据，它**没有分隔符可转义**，员工
  完全可以在自由文本里写出一模一样的一行。任何"从文档解析工号"的写法都是一个自带钥匙的后门
  （门：`test_a_forged_person_id_line_in_free_text_does_not_move_the_identity`）。
- **不走完整 `HeuristicExtractor.extract()`**：渲染出来的文档叫「周报-…」，`sniff_kind` 认成
  `doc_kind='project'`，跑完整 extract 会顺带跑 `_projects_from_doc`，让员工的自由文本凭空造项目卡。
  回流只调它要的那几个零件。（`_signals_from_doc` 也用不上——它四条触发正则全是 ASCII，
  `_first_person_name` 要求英文大写名 + 英文动词，对中文答案恒零命中。**没动它**。）
- **时间性：新一份自述比人卡上现有那份新时，先腾空旧子槽，再让既有 keep-first 自然填上。**
  `_dedupe_entities` 的 keep-first 是对的（防花名册冲掉周报），但表单追加严格按时间来，
  keep-first 就等于 keep-**oldest**：周雅第二周报 85，卡会永远停在第一周的 72 并一直引那份旧文档。
  腾空是唯一不动那条共用规则的写法。时间只走 `decision_grading._uploaded_moment`（本票把
  `_uploaded_day` 拆成它的一层薄壳，**全仓仍然只有一处**解析 uploaded_at）。
  ⚠ 这里刻意用**瞬间**不是天粒度：定级那条路用天粒度是因为一批上传彼此差微秒；这里两份读数是
  员工两次真的按下提交，同一天再交一份就是更新的读数。
- **员工的一句话不许弄砸提交**：答案按 ADR-0023 不过红线门，但 `SignalEntity` 是卡面产物、会进
  `validate_extraction` 的扫描面。所以候选信号**逐条预检**（拿真的 `validate_extraction` 去问，
  不抄一份它的 person-anchor 句式）：不过的丢掉信号，原话照旧逐字躺在资料里。不预检的话，员工
  写一句「我这周绩效 3/10」就能让 `append_submission_to_context` raise → 页面变 thanks_pending →
  补灌永远失败。
- **哪几格出信号由字段描述决定，不是按 field.id 写死**：`FormField.situational`（新），内置周报只有
  「未达成及原因」「需要支持」标了。模板可编辑，按 id 写死意味着经理一改题面回流就静默失灵。
  长度窗口 4–120 字：下界挡「无/暂无」，上界**不截断而是放弃**（砍到 120 再打省略号是替她改口；
  超长那一格照旧整段进资料库、议事室照旧引得到）。
- **项目绑定是逐条链的事实**：`FormSubmission.project_ref`（迁移 `0014`，ADD COLUMN IF NOT EXISTS）+
  `FormRecipientIn.project_ref`，经理铸链时选，**员工的 H5 上根本不存在这个字段**——填的人不该能
  决定自己那句话挂到哪张项目卡上。存**项目名称**不是 ID：`ProjectEntity` 至今没有外部项目ID，
  归并认项目用的是 `_project_key(title)`；存一个下游没人比对的 ID 等于存一列废字符串。
  `project_ref` 对不上任何项目 → 什么都不做，**绝不凭一个名字新建项目卡**。
- **`signal_cards()` 补 `sourceRef`**：那个叫 `source` 的键装的是 `source_kind`（类型词），
  文档指针此前根本没投出去。在此之前每条信号都来自上传文档，不引出处只是少一句话；表单回流之后
  卡上会出现「员工本人这周说的一句话」，跟一份八周前的文档长得一模一样——不说它是哪份资料来的，
  卡就在替我们撒一个关于时间的谎。键名与 `_decision_subjects` 逐字一致。
- **`docFromSource` 现在也剥 `#sub_<hex>` 尾缀**，并从 TeamScreen 提到 `teamData`（两个消费方一处
  定义）。T2 的 source_key 是 `<文件名>#<提交id>`，不剥的话人卡自述角标会当着客户的面显示
  「《周报-周雅-2026-W32.md#sub_9f3a2b…》记录的本人自述」。判据卡死在 `sub_`+十六进制这个形状上，
  客户自己文件名里的 `#`（`Q3#定稿.md`）一个字不会被吃掉。

## 门与取证

- 离线全套 **3776 passed / 107 deselected / 4 xfailed**（四 deselect 齐）。新门
  `tests/test_form_reflow_a2.py` **31 离线 + 2 真库**。
- `@needs_db` 全套 **98 passed**（本地 `teammaster-postgres-1`，throwaway 库 `avery_t5_test`，用完已 drop）。
- 🔴 **反假绿变异 20/20 被咬**。第一轮 17/20，两条活口**都是门洞不是代码 bug**：
  ①「工号归并退回按姓名」——所有用例里工号相同时姓名也相同，`by_id` 那本索引只在「格子按姓名开、
  工号后来补上、再来一条花名读数」这一趟里不可替代 → 补
  `test_an_id_adopted_mid_pass_is_immediately_usable_as_the_merge_key`；
  ②「同名歧义时挑第一个」——回流那道显式挡板把 `PersonIndex` 自己的规则挡住了 → 补一条直接问
  `_dedupe_entities` 的上传路门。补完全灭。
- **迁移升级路真机彩排**（不是只在新库上跑过）：旧 0009 约束的库 + 一行存量 person → 换上新 0009
  重放 → 旧行仍在、约束换成含 `person_id` 的新版、`0014` 的 `project_ref` 在存量库上补出来、
  新人员写入成功。反向也验过：代码有 `person_id` 而迁移是旧的 → 每一次人员写入 CheckViolation
  （这正是 0009 文件头警告的那个「离线全绿、生产全 500」）。
- **真链路人眼取证**（门语料未必展开过新 UI）：真 mock 后端 8158 + 真 `/ingest` + 真铸链（带
  `project_ref`）+ 真提交 + `build`&`preview` 4181，zh/en 两壳：
  `t5-team-selfreport-{zh,en}.png` / `t5-person-detail-{zh,en}.png` / `t5-project-blockers-{zh,en}.png`。
  屏幕上读到的：人卡「自述负载 72% · 自述情绪 偏紧」+ tooltip「《周报-周雅-2026-W32.md》记录的本人自述」
  （UUID 已剥）；人卡详情「文件里提到的」两条情境句各带「（来自《周报-周雅-2026-W32.md》）」；
  项目详情「值得注意 [来自周报填写]」+ 两条阻塞原句。团队页的情绪筛选 chip 自动多出「偏紧」。
- `./init.sh` 绿（chunk-size warning 是存量）；`node scripts/i18n-orphans.mjs` 孤儿键 **0**。
- **没跑全 A/B/C 前端电池**：本票前端改动面是三处文本追加（信号引文 / blockers 出处角标 /
  出处名剥 UUID），由 typecheck + build + i18n 双门 + 上面六张真链路截图覆盖；worktree 里
  visual 门是几十张「没有基线」假红（同 T4/T7 判断）。

## ⚠ 一条给下一个人的警告

**别跑 `node scripts/i18n-zh-lite2-delta.mjs`。** 本 session 手贱跑了一次，它把 `src/shared/i18n/zh.ts`
整个重写（-293 行），把文件头那一整段「哪些键是手写的、哪些过了 M3、Danny 审到哪」的仓库史全删了。
已 `git checkout` 回滚、两个新键手工加回，最终 diff 只有 +2 行。M3 口径 2026-08-03 就废止了
（AGENTS.md「中英文都由当前 session 自己写」），那个脚本现在只剩破坏力。

## 留给后面的话

1. **工号缺失 + 同名 = 这一份自述回流不了**（诚实记录，不是 bug 是设计）。资料照进，卡上不动，
   日志有一行说明。出口已经在手上：`POST /team/{ctx}/forms/{tpl}/links` 的 `recipients[].id` 就是
   01 表工号，经理选人时带上即可。**T3（资料库前端第④段）请把选人控件做成带工号的**，否则这条
   出口在 UI 上不存在。同理 `recipients[].project_ref`（项目绑定）也只有 API 面，没有 UI。
2. **LLM 抽取路不读工号**：`llm_extract._build` 造 PersonEntity 时 `person_id` 恒 `""`（默认值），
   所以开了 LLM 抽取的公司，工号只来自花名册表头那条路。不是回归，是这条路本来就没接——
   要接就在 `llm_extract` 的 prompt/映射里加一格，另开票。
3. **`_signals_from_doc` 仍然是英文专用且 `_situationalize` 是个空函数**，`proj_ref` 从初始化起
   就没被赋过值（每条项目信号的 subjectRef 都是字面量 `"the project"`）。本票**没动它**（那是
   几十个已上产 feature 坐着的路），但它是中文语料上一整块死代码，值得单独开票。
4. **`provenance` 的 origin 现在是三态** `doc|manual|form`。前端加了 `provenanceBadgeKind` 三态
   helper（`projectView.ts`）替掉两处裸 `=== 'manual'`；再加第四种取值时 TypeScript 会在那里报错，
   不会悄悄落进 `null` 分支。
5. **`ProjectEntity.blockers` 的 provenance 是整格的**（「最近一次改这一格的是表单」），不是逐条
   阻塞句的。这与手编 `_mark_manual` 的既有语义一致，不是本票新造的模糊，但卡上并排两条来源
   不同的阻塞句时角标只说得出一个来源。要逐条出处得给 blockers 换数据结构，另开票。
6. **票面没做也不该做的**：周期实例/催收（A3）、防转发/实名绑定、资料库第④段（T3）。
