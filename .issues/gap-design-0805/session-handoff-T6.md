# T6 · conflicts-record-b2a — 本线交接（worktree: keen-keller-1b746a）

> 差距战役 0805 · 票册见 `.issues/gap-design-0805/tickets.md`（**该目录在主检出里 untracked**，
> 不在 git 里，本 worktree 看不到——整合者注意）。本票与 T1/T4 并行，无前置。

## 状态：**做完，两次 commit，已全绿**

| commit | 内容 |
|---|---|
| `51cb2de` | test(T6/B2a) 第一步：把 `_dedupe_entities` 现有行为钉死（**纯测试，零生产代码**） |
| `f166afe` | feat(T6/B2a) 第二步：`ExtractionResult.conflicts` + 归并记账 + 落库 |
| `a22caf3` | refactor：冲突字段表改名 `_CONFLICT_FIELD_ALLOWLIST`，消掉与 pg_registry 的同名两义 |
| `7ebeb19` | test：补一道 `@needs_db`——手编 CRUD 的 `get→改→put` 不许抹掉冲突 |
| （见下）  | fix + 复核轮补的门 |

## 做了什么

两份资料对同一人/项目的同一格子给出不同读数时，`_dedupe_entities` 不再静默丢弃败方，而是
连同 value + source + doc_key 记进 `ExtractionResult.conflicts`。
**归并结果本身一个字没改**——人卡上还是那个胜出值，本票只改"记不记账"。

结构：`FieldConflict{subject_kind, subject_ref, field, values:[ConflictValue{value, source, doc_key}]}`
- `subject_ref` = 活下来那条实体的 id（卡就是按它作键的）
- `values[0]` 恒为胜出读数，其后按到达顺序是被丢弃的读数
- 第三份资料往同一条上追加，不新开一条

## 字段 v1：三个落地 + 一个明写不可达

落地：`部门/团队`(PersonEntity.team)、`项目状态`(ProjectEntity.status)、`到期日`(ProjectEntity.dueDate)

**票面点了四个，第四个「人员在职状态」今天在数据模型里没有落脚点**：`PersonEntity` 没这个格子、
`_ZH_HEADER_MAP` 不认「任职状态」、`_people_from_roster` 位置兜底只读到 cells[3]（司龄）为止，
而 01 表的「任职状态」在第 7 列。合伙人表里确实有这一列（在职/试用期/待离职）。

没有在字段表里放一个指向空气的条目——那是**静默 no-op**，跑起来永远零命中，报告里却读作
「四个字段都覆盖了」。改成一条会说话的门 `test_employment_status_still_has_no_home`：
哪天 T1/T5 给 PersonEntity 加上任职状态，那条门变红并指回 `_CONFLICT_FIELD_ALLOWLIST` 说
「该补这一行了」。

## 给 T7 的接口（下一票直接用）

- 读 `ctx.extraction.conflicts`，每条给 `subject_kind` / `subject_ref`（=卡的 id）/ `field`（机器键）
- 每个 value 带 `doc_key` = 文档名，可直接 join `source_documents` 取 `uploaded_at`（T4 的时间映射）
- `values[0]` 是我们采信的那个（= 实体上那个值），其余是对不上的
- 措辞红线 ADR-0018：只说「读到…读到…对不上」，绝不「你写错了」。后端一个中文句子都没拼
  （ADR-0033），句子全在前端 i18n。

### ⚠ T7 开工前必须知道的四条限制（每条都有门钉着，别自己再踩一遍）

1. **两个 value 可能来自同一份文档**（一份花名册把同一个人列了两行、部门写得不一样）。
   卡面**不能写死**「两份资料对不上」。
   钉在 `test_two_readings_inside_ONE_document_still_conflict_and_share_a_doc_key`。

2. **`source` 的行号是块级的，不是字段级的**，而且状态可以是**整篇推断**出来的。实测：台账写明
   「状态：进行中」，周报一个字没提状态、只有散文「摄影师档期迟迟没定下来…推进不了」，抽取器整篇
   兜底读成 `blocked`，出处记作 `周报.md:1` —— 那行是标题 `# 本周周报`，不是证据所在。
   → **T7 不能把 `source` 当成「逐字引用这一行」的凭据**，照那行取原文会引到标题。
   要做真双引文卡，得先解决字段级出处（改抽取器，独立一票）。
   钉在 `test_KNOWN_LIMITATION_project_source_is_BLOCK_level_not_field_level`。

3. **已知假阳性：同一个日期两种写法会被报成对不上**（`2026年9月30日` vs `2026-09-30`）。
   v1 只报完全不相等、不做任何归一化，这属于设计里已预见并接受的那类（同义不同写），
   所以**「可能只是叫法不同」的 dismiss 出口不是可选项**。
   钉在 `test_KNOWN_FALSE_POSITIVE_same_date_written_two_ways_reports_as_a_disagreement`。

4. **一个 `subject_ref` 可能对应多于一条冲突记录，极端情况下对应的是不同主体**。
   `_slug` 折叠标点并在 32 字符处截断，而身份尺 `_project_key` 只折叠空白与 `_ -`，所以
   「别墅套餐推广（八月）」与「别墅套餐推广(八月)」是**两张独立的卡共用一个 id**。这是 `_slug`
   的既有限制，本票没动。冲突记录本身的**分组**是对的（各自配对正确，见下），但按 id 查卡时要防重。
   钉在 `test_two_projects_sharing_a_slug_id_do_not_fuse_their_conflicts`。

## 三处工程要害（改这块代码前先读）

1. **出处精度**：胜出读数的出处**不能拿 `cur.source`**——那是 keep-first 的整条出处，而某个格子
   完全可能是后来某份文档补上的（enrichment）。天真写法会让卡面引用一份**从没提过这件事**的文档，
   比不报冲突更糟（一条看起来有出处、实际撒谎的证据）。改为逐 `(身份key, 字段)` 记 `held_src`，
   人员与项目**各一本**（两者 key 命名空间会撞：一个人叫 X、一个项目也叫 X）。
   钉在 `test_the_kept_reading_cites_the_document_that_ACTUALLY_stated_it`。

2. **落库走 entities 新 kind，不是顶层字段**。反面教材就在同一个类里：`granularity` 同样是顶层
   列表，而 `pg_registry.get()` 根本不重建它 → 真库往返**静默丢失**，离线套用 in-memory registry
   永远考不到。`_ENTITY_KINDS` / `by_kind` / `get()` 三处都补齐了 conflict 这一路。

3. **迁移就地改 `0010`，不新加 0013**。`test_entities_kind_check_covers_written_kinds` 扫**每一条**
   `ADD CONSTRAINT entities_kind_check` 要求全部等于 `_ENTITY_KINDS`——新加超越迁移会让 0010 当场
   out-of-sync；更要命的是 `_ensure_schema` 每次引导重放全部迁移，留一条严格子集的 ADD 等于库里
   有 conflict 行之后每次引导都重验失败、**整个后端起不来**（0002 的 8 键 allowlist 就这样炸过）。
   这也是 `db/migrations/README.md` 的成文规矩，不是本票的发明。

   🔴 **部署提示（给发版的人）**：就地改 CHECK 的代价是**回滚方向**——库里一旦落了第一条
   `kind='conflict'` 行，**旧镜像就起不来了**（它那份 0010 只认四个 kind，重放时 ADD 会
   「violated by some row」而中止引导）。这不是本票独有（每一次 person 写入都武装着 0009 的同类
   炸点，而且触发面比这宽），但排期上要知道：**上了这版之后，越过这条迁移的回滚不再是安全动作**，
   要回退得先清掉 conflict 行。swap 窗口里还活着的旧容器被 HEALTHCHECK 重启也是同一回事。

## 顺带做的一处 ONE RULER

`source.rsplit(":",1)[0]`——决定「这条读数算哪份文档的」的判据——仓库里本来已**手抄两遍**
（`pipeline.py` 的 chunk_counts、`registry.py._chunks_per_file` 的文件清单块数）。本票需要第三处，
于是提成 `extract.doc_key_of`，那两处改成调它，**逐字符不变**（刻意不加 `.strip()` 之类顺手改进）。
漂移的后果是冲突卡引用的文档和清单上数块数的文档变成两份不同的东西。

## 复核轮（4 lens 对抗式，18 个 agent）

跑了一轮对抗复核：4 个 lens（正确性 / 持久化与迁移 / 门是否说谎 / 范围与契约）提了 14 条，
再逐条派**独立的反驳位**去证伪。**14 条全部被证伪**——但其中三条改变了我的做法，值得记一笔：

- **索引键用 `cur.id` 是真的错**（我自己复现了）：两个共用 slug 的不同项目，冲突会被融成一条，
  里面混着别的项目的读数，违反 FieldConflict 自己的契约。已改成用身份尺当键。
  反驳位说得也对：**这修的是分组，不是 id 碰撞本身**，`subject_ref` 仍会重（见上面限制 4）。
  两边都对，措辞按反驳位的口径校正了。
- **「项目冲突没走过真抽取器」这条被实测推翻**：`_note_conflicts` 是字段泛型的（只做字符串比较、
  没有任何分支看 value 内容），所以 `"进行中"` 与 `"on-track"` 走逐字节相同的代码，手搓语料并不
  失真。那条真管道门**留着当可达性钉子**，但 docstring 已改成诚实口径——**不是**在补洞。
- **「任职状态改个名就绕过提醒」**：真正 name-agnostic 的网**早就存在**——
  `test_person_keys_allowlist_covers_exactly_person_fields` 拿 `dataclasses.fields(PersonEntity)`
  与迁移 0009 做对称差，PersonEntity 加任何名字的字段都会当场红。我一度想加一份字段快照，
  **撤了**：那会是第三份 PersonEntity 字段清单抄本，正是本仓库反复吃亏的"同一份真相两份抄本"。
  改成在注释里指向那道真网。

顺带补的两道**离线**静态守卫（都做过变异验证：制造对应漂移 → 当场红）：
- `test_put_by_kind_covers_exactly_the_entity_kinds`——`put()` 的 `by_kind` 是 `_ENTITY_KINDS` 的
  第二副本，少一个 key 就是每次 put 全挂 KeyError，多一个是静默丢那一路数据。
- `test_migration_0010_guard_literal_matches_its_own_ADD`——0010 内部**自己有两处** kind 列表
  （比对用的 `want` + 真执行的 `ADD`），而既有漂移门只扫 ADD。只改 ADD 不改 `want` 会让整段 ALTER
  被跳过、库里 CHECK 停在旧集合、新 kind 被真库拒收而离线全绿。0010 自己的注释也说这道门"pins both"
  ——在此之前那句话不成立，现在成立了。

## 明写的盲区（不假装覆盖）

`llm_extract._build` 的跨窗口 enrich 分支只处理 owns/role/self_report，**没有 team 这一行**，
所以同一份文档两个窗口的部门分歧在 `_dedupe_entities` 见到它之前就没了。跨文档（本票靶心）不受影响。
钉成 `test_KNOWN_BLIND_SPOT_*`——哪天那个分支补上 team，门会变红要求换成真行为断言。

## 门（三条腿，缺一条就是假绿）

- 离线电池 **3544 → 3612 全绿**（79 deselected / 4 xfailed / 81s），语料含**真中文字节**
- `asdict()` 往返 + 嵌套 `ConflictValue` 回读强转（不强转只在持久化那条路上炸——rich-align 真炸过 `pr.risk.level`）
- `@needs_db` 真 Postgres（本机 `teammaster-postgres-1`，pgvector:pg17）：put→全新实例 get 冲突带类型回来；
  无冲突 context 照常往返；**`get()→改→put()` 的手编 CRUD 往返不抹掉冲突**（这是本仓库最毒的那类
  读写不对称 bug 的位置，实测过）。库里实抓 `kind='conflict'` 行与更新后的 `entities_kind_check`，测试自清理。
- 前端 `npm run typecheck` 绿（本票零前端改动）

跑 needs_db 的姿势（本机）：
```
cd eval-harness && AVERY_DB_URL="postgresql://postgres:dev@127.0.0.1:5432/teammaster" \
  python -m pytest tests/test_conflicts_record_b2a.py -m needs_db -q
```

## 合并后的门（在 main 的新基线上重量过）

合 main 时 main 已经吃进了 T1（#50）与 T4（#51），且 T1 同时动了 `pg_registry.py` / `registry.py`
（我这票也动了这两个文件）。git 说无冲突，但**文本不冲突不等于语义不冲突**，所以合完重跑了两套：

- 离线电池 **3713 全绿**（102 deselected / 4 xfailed / 74s）
- `@needs_db` 真 Postgres **全套 93 条**（不是只跑自己那 3 条）——T1 新加的 `0013_form_templates.sql`
  与我这票就地改的 `0010` 一起重放，没打架；`by_kind` 守卫也证明 T1 没有偷偷加 kind。

### ⚠ 一条**既有**的真库 flake（不是本票引入，别记到 T6 头上）

> **✅ 已定案并修复（2026-08-06 晚，T1 线认领）。** 你这条记录是对的，而且你多给了一个我没有的
> 关键数据点——「两次红的不是同一条测试」。真因：**本机 Docker 容器时钟会来回跳 ~115 秒**
> （连续采样当场抓到 delta 在 −0.25s 与 +115s 之间横跳）。在「跳到未来」窗口里建的行拿到未来的
> `created_at`，`created_at < now()` 恒假，那一行对 sweep 隐身 ~115 秒；跳窗口撞上哪条测试就红哪条
> ——这正是你观察到的「红在不同测试上」。
> 你猜的方向（`older_than_hours=0` 落到 `created_at` 上）是对的。
> ⚠ 顺带更正：T1 交接里此前写的根因「子查询 LIMIT 缺 ORDER BY」**是错的**（纯逻辑即可证伪：
> 无序 `LIMIT 50` 只要有合格行就必删至少一条，返回 0 只能是 WHERE 没匹配——过滤问题不是排序问题）。
> 修法与证据见 `session-handoff-T1.md` 末尾的「更正」一节。


`test_registry_contract.py` 的 GC sweep 那两条
（`test_sweep_collects_only_old_unlinked_ephemeral_clones` / `test_sweep_respects_the_batch_limit`）
在**跑全套 needs_db** 时会有一条红，断言都是同一句
`sweep_ephemeral(older_than_hours=0, limit=50) == 1` 实得 0。

已定位为**既有且不确定性**的，证据三条：
1. 单条跑 **绿**；整个 `test_registry_contract.py` 跑 **绿**（45 条）；只有全套 needs_db 才红。
2. 在 **main（6baf6a0，不含本票任何改动）** 的临时 worktree 上跑同一套，**同样红**。
3. 两次红的**不是同一条测试**（main 上是 batch_limit，本线上是 unlinked_clones）——同一套件两次跑
   红在不同测试 = 不确定性，不是确定性 bug。

猜测方向（没深挖，留给认领 GC 的人）：`older_than_hours=0` 落到 `created_at < now()` 的边界上，
而 `now()` 在 Postgres 里是**事务开始时刻**且事务内恒定；全套跑到那里时的时序与单跑不同。
共用同一个本地库的跨文件测试也可能互相留状态。

**本票不修**（不在范围内，且是别人家的门）。记在这里是为了下一个跑全套 needs_db 的人不要以为是自己
弄坏的——我为了排除这一点，专门在 main 上开了个临时 worktree 对跑了一遍。

## 记账口径

本票对应 **GitHub issue #52**（`T6 conflicts-record-b2a: 归并不再吃掉矛盾读数`）。
按 AGENTS.md，issue 是正源；0805 差距战役七票 = issues #50–#56，票册 `tickets.md` 是底稿。
**没有**给 T6 造 `feature_list.json` 条目——这场战役里 T1（#50）、T4（#51）合 main 时都没造，
只给 T6 单独补一条会造成半迁移的不一致。

## 本票**不做**（T7 的活）

规则（`R-CROSS-DOC-CONFLICT`）、四处同步（decision_rules.py / zh.ts / en.ts / decision_grading_rules.md）、
前端双栏证据渲染、dismiss 出口。已验 `conflicts` 不进任何 service 载荷与投影。
