# 回执 · #93 全档案重跑粒度闸：folded_into 软折叠 + 血缘完整性前置 + 裁决落库

> 正源：GitHub issue #93 · 背景 `.issues/ingest-root-cause-0812/exploration.md` §S2 第二刀 +
> 侦查线 A4 选项 a。2026-08-12。前置 #90 / #92 已确认合入 main（`git merge-base --is-ancestor`
> 逐条验过）。改动全在 `eval-harness/`（后端 6 文件 + 迁移 1 条就地改 + 新模块 1 + 新测试 1），
> **前端零字节**、**未 push**。

## 0 · 一句话

补传结束前，拿**整个档案的字节重建出全量 docs**，把粒度闸重跑一遍；判出来的降级**只折叠、
不删除**，而且只在「说得出并去哪里」时才敢动手。作者那句「整表静默删除，宁可漏」
（`file_append.py:133-136`）**保留成了实现约束**，不再是方向否决 —— 这是同一块碑的第二次订正
（第一次是 `file_delete.py:36-52`）。

**实测**：同一份三件套语料，逐份补传 **7 张 → 4 张**，与一次全选**逐字相等**。

---

## 1 · 三道锁：每一道为什么是这个形状

### 锁① 只折叠不删除 —— 而且它是**两把分开的锁、两扇分开的门**

降级要动手，必须同时满足：

| 锁 | 判据 | 挡住谁 |
|---|---|---|
| ①-a **命名空间** | `ruling.parent_kind == "project"` | R2/R4（根本没有 parent）与 **R5（parent 是一个人）** |
| ①-b **在场性** | `_title_key(parent)` 在**当下可见**的卡里查得到 | 只活在文档标题里的 parent；被经理归档了的母卡；**本轮自己也在被降级**的母卡 |

- **为什么新开 `parent_kind`（`Ruling` 加字段）而不是「按规则号白名单」**：白名单是第二把尺，
  会和规则表漂开。`parent_kind` 让每条规则**自己声明**它的 parent 是哪个命名空间里的名字，
  R1/R3 写 `"project"`、R5 写 `"person"`、其余留空 —— 一次判定同时覆盖「没有 parent」和
  「parent 是个人」两种禁开火。
- **R5 的危险是真的、不是假想**：它的 parent 是职责栏那一行的**主人**。度假酒店拿人名给项目
  起名不是奇事；一旦撞上，职责格会被折进一个毫不相干的项目，而折叠理由（「写在 XXX 名下
  那一行的职责栏里」）读起来完全站得住。判据落地层挡住它，不靠「不会那么巧」。
- 🔴 **两把锁刻意不写在一处**（progress.md 0808 碑：belt-and-braces 会让内层规则免疫变异）。
  为此测试侧专门造了**哨兵**：一张**无标题**卡（`_title_key("") == ""`，恰好占住母卡池的 `""`
  格），于是拆掉①-a 之后 R4 的空 parent 会**真的**在池里命中它 —— 没有哨兵，两把锁会一起
  拒绝同一个输入，拆掉任何一把都不会红。变异 M2 / M3 各自单独被逮住，实证这扇门是两扇。
- **「本轮母卡自己也在被降级」是第三种在场性失败**，语料喂不到，所以另起了一份链形状哨兵语料
  （乙 是 甲 的里程碑、甲 又是 丙 的里程碑）—— 见 §4 与变异 M15。

### 锁② 血缘完整性前置断言（fail closed）

判之前先算 ∪(待判卡 `lineage["docs"]`)。这些文档里只要有一份**在档案里、字节却重建不出来**，
**整个重判放弃**、退回今天的行为、回执写清原因。三种成因逐条对着票面：字节拉不回 /
content 为 NULL 的存量行 / parse 失败。

**两个刻意的分辨，都写进了代码注释：**

1. **来源文档已被 #77 删掉 ≠ 锁② 的成因**。那三种是**存储完整性坏了**（我们不知道自己少看了
   什么）；删除是经理**自己**做的，#77 已按「诚实的降级」结过案。把它升级成「整趟放弃」
   等于让一次删除**永久且静默**地关掉这条防线 —— 而「静默」正是本票存在的理由。
   处置精确落在危险的那一点上：**判一张卡时缺的是它自己那份文档才会误判**，所以只把**那张卡**
   排除在待判之外，邻居照判。
2. **没有任何待判卡引用的坏文件不 fail closed**。证据池变小对本模块是**安全方向**：
   R1 少几条里程碑、R3 少几个候选母项目、R4 少几个文档身份 —— 三条规则**全部**因此更少开火。
   记账（`docs_unrebuilt`）、继续跑。

### 锁③ 软折叠：新字段 `folded_into`

- **Danny 0812 拍板不复用 `archived`**，理由落成了 `ProjectEntity.folded_into` 上的一段碑：
  `archived` 是**经理手编领域**（`_absorb_project` 的规则表明写「一个都不碰」），系统往里写 =
  两个作者写同一格，「谁把它收走的」从此答不出来。
- 语义与 `archived` **平行但不相交**：只在投影层生效（`registry._active_projects()` 是**唯一**
  过滤点，`project_cards()` 与 `_decision_subjects()` 都从这里取）、**可逆**（清空这一格卡就回来，
  一个读数都没丢）、**绝不物理删除**。差别是它还带着「并去哪里」的答案。
- 文档改不动它：不在 `_APPEND_REFRESHABLE`/`_APPEND_UNIONED`、不在 `_lineage_fields`，
  `merge_project_reading` 与 `_absorb_project` 都碰不到。写它的只有 `rejudge.py` 一处。

### 锁① 之外，一条**票面没有、我加上的收紧**

**经理亲手改过的卡（`provenance[格].origin == 'manual'`）系统不收走**（`_manually_touched`）。
不是票面要求，是照这个仓库自己的纪律推出来的：补传路「手编格子恒不被文档顶掉」，而折叠比
顶掉一格重得多 —— 它把整张卡从经理眼前收走。一个刚给某张卡填过负责人的人，第二天补一份周报
就发现卡不见了，是这条防线能造成的最坏一次体验，换来的只是少折一张。宁可漏。
逐卡生效（不是「这家公司从此不折」）—— 反向判据 + 变异 M19/M20 各一条钉着。

---

## 2 · 裁决落库（票面②）

`ExtractionResult.granularity` 此前**不进 pg**（`pg_registry.py` 里白纸黑字拿它当反面教材：
「get() 从不重建它，于是真库往返里静默丢失，而离线套用的是 in-memory registry，永远考不到」）。
这笔账现在结清，理由不是整洁是**必须**：补传路一旦开始折叠卡，「为什么这张卡不见了」重启后
必须答得出，而**说得出为什么**是这个模块唯一的合法性根据（`granularity.py` 模块头）。

- **落法**：`kind='ruling'` 的 `avery.entities` 行（与 T6/B2a 的 `conflict` 同一条路），
  `_ENTITY_KINDS` + `_RULING_FIELDS` + put/get 两侧。
- **迁移**：**就地改 `0010`**（该文件自己的碑：「加 kind 改这一条，永不叠新的」），
  **`want` 与 `ADD` 两处清单同改**。
- 🔴 **顺手补了一道 #87 那口坑的孪生门**：`test_entities_kind_check_covers_written_kinds`
  只扫 `ADD`、**看不见 `want`** —— 0009 在 #87 时被补过孪生门，0010 一直没有。
  新增 `test_migration_0010_want_and_add_agree_with_the_kinds_put_writes`（变异 M17 实证）。
- **`folded_into` 不需要迁移**：0009 那条 payload allowlist 只管 `kind='person'`，项目行没有
  键白名单。但判据把这个**前提**钉住了（`asdict` 恒发全字段 + `folded_into` 不在 `_PERSON_FIELDS`），
  哪天有人把它搬到人卡上或给项目行加 allowlist，会**先红**而不是在生产上每条写入被库拒。
- **增长可控**：折叠裁决**每张卡至多一条**（被折的卡下一轮不再进待判）；被拒绝的降级
  **不进** `granularity`（那张表是「这张卡为什么不见了」的答案簿，而被拒的卡还在屏幕上），
  只进回执与日志。
- `subject_id` **只在重判路记**：抽取路的 `apply_gate` 跑在 `_disambiguate_project_ids` 之前，
  那里的 id 不是卡最终活下来的 id，记了就是一把静默指错的 join key。这条「故意留空」也有判据。

---

## 3 · `file_delete` 的 `Ruling.evidence` 过滤语义（票面③）

**结论：既有的按 `doc_key_of(evidence)` 清理保持不变，但给它补上了一个后果。**

新增不变量（`_unfold_unexplained` 是它唯一的守卫）：**一张 `folded_into` 非空的卡，
`granularity` 里必须有一条 `subject_id` 指向它的裁决**。删掉那份文档 = 删掉解释，
于是**折叠跟着撤销**，卡回到经理眼前（4 张 → 7 张，真库上也验过）。
一张看不见又说不出理由的卡，正是这个模块最不该造出来的东西。
撤销是**加法**：母卡吸收过去的格子不回收（keep-first 语义，收回去等于替抽取器编一个它从没
做过的判断 —— 与本模块「冲突为什么整条删而不是只摘掉一方」逐字同一条纪律）。

**查清楚了但没消灭的残留**（写进 `_unfold_unexplained` docstring，不藏在绿灯后面）：
不同规则的 `evidence` 语义不一致。**R1**（补传路唯一真正在开火的折叠规则）的 evidence 就是
**凭以折叠的那一行**，语义闭合；**R3** 的 evidence 是候选自己的 `source`（实体级 keep-first 出处），
归并后可能指向另一份文档 —— 删掉真正提供证据的那份时，裁决与折叠都活着。没消灭它是因为要给
`Ruling` 再开一个「凭据文档」字段，而 `classify` 是**两条路共用**的，会改到抽取路的审计语义；
R3 在补传路是窄口（要同时满足阶段标记 + 零跟踪字段 + parent 是可见卡）。
残留的**方向**在可接受那一侧：卡多折着一会儿，而不是卡被删掉。

---

## 4 · 不变式门与对照基准

🔴 **销毁/收缩类判据天生空真**，所以每一条都配了动作之前的基准：

| 判据 | 对照基准 | 怎么造出来的 |
|---|---|---|
| 主不变式 | **7 张 → 4 张** | 同一份语料、同一个顺序，逐份补传跑**两遍**：把 `rejudge_archive` monkeypatch 成空桩（= #93 之前的行为）量到 7，打开量到 4，且 `== 一次全选`、`== SURVIVORS` |
| 链不连锁 | **3 张 → 2 张** | 哨兵语料：乙→甲、甲→丙 同一轮判出来；折的只有甲，乙被拒且留在屏幕上 |
| 删除撤销折叠 | **4 张 → 7 张** | 先断言撤销之前是 4 张 |
| 每一条锁 | **「夹具本来折得动」单独一条钉子** | `test_the_two_batch_fixture_folds_three_when_nothing_is_tampered_with`：没有它，所有「一张都没折」会对着一个本来就折不动的夹具全绿 |

**语料**（fixture 造影，不含合伙人真实字节）：`人员架构.csv`（13 人 12 职责格，R5 在两种模式下
都文档局部折掉 —— #92 成果的**在位控制组**）+ `项目台账.csv`（6 个真项目，带负责人/进度/截止）+
`本周周报.md`（1 个真项目，「里程碑：」清单**逐字点名台账里的三个项目**）。

🔴 **判据落在投影上（`project_cards()`），不落在 `extraction.projects` 那张原始列表上** ——
这是一个**刻意的非对称**，不是 bug：抽取路对降级候选是**丢弃**（那些候选几秒钟前刚抽出来、
没有任何人见过），补传路是**折叠+并入母卡**（这些卡经理正对着编辑）。两条路跑完原始列表本来
就不等长。不变式说的是「经理看到的一样」。

另外三条方向性判据：逆序上传（周报先到）、`_absorb_project` 真把读数并进了母卡、
以及 R5 的 12 个职责格在两种模式下都不上项目轴。

---

## 5 · 改动清单

- **`avery/ingest/rejudge.py`（新，~300 行）**：三道锁 + 全档案字节重建 + `RejudgeReport`。
  模块头写清了「为什么这件事被推迟了两票」以及两条刻意的非对称。
- `avery/ingest/granularity.py`：`Ruling` 加 `parent_kind` / `subject_id`；R1/R3 声明 `"project"`、
  R5 声明 `"person"`；**判定循环提成 `judge_projects`（ONE RULER，两条路共用）**，`apply_gate`
  变成「`judge_projects` + 抽取路的处置规则（丢弃）」。
- `avery/ingest/extract.py`：`ProjectEntity.folded_into` + `_absorb_project` 的「不碰清单」加它
  （🔴 这个函数**正是**折叠时搬读数的通道，顺手复制这一格会让母卡在吸收的同一刻把自己折掉）。
- `avery/ingest/registry.py`：`_active_projects()` 同门过滤 `folded_into`；
  新增 `source_document_bytes_by_key`（🔴 按 key 不按 idx —— 补传进行中，调用方手里那份清单的
  下标与库里的 idx **结构上**就不同，按位置取会拿 B 的字节当 A 重建，闸照跑判据照绿）。
- `avery/ingest/pg_registry.py`：`kind='ruling'` 的写与读；`source_document_bytes_by_key`
  （key 表达式与 put() 的临时表救生艇逐字同一把尺）；`empty_context` 的 ③ 号注释订正。
- `avery/ingest/file_append.py`：归并之后、整体红线与 put() 之前调 `rejudge_after_append`；
  `AppendReport.rejudge`；原来那条「宁可漏，写在这里」的 ⚠ 就地订正。
- `avery/ingest/file_delete.py`：`_unfold_unexplained` + `DeleteReport.unfolded` + 语义分析。
- `db/migrations/0010_entities_kind_playbook.sql`：**就地**加 `'ruling'`（want + ADD 两处）。
- `tests/test_granularity_rejudge_93.py`（新，29 条）。

**08-13 收尾追加（§8）**

- `avery/ingest/extract.py`：`hidden_reason(entity)` —— 「这张卡今天在经理屏幕上吗」的**唯一**判据。
- `avery/ingest/registry.py`：三处改问 `hidden_reason`（`_active_projects` /
  `archived_*_cards` / `materialize_memory`）；新增 `folded_project_cards()`；
  **`ProjectWriteMixin._commit()`** —— 手编 CRUD 的唯一落盘出口（先重物化 facts.md 再 put）。
- `avery/ingest/rejudge.py`：`visible` 改问 `hidden_reason`（第三份手写谓词退役）。
- `service/ingest_api.py`：`/team` 载荷新增 `folded_projects`（absent≠none）。
- `src/lite2/transport.ts`：`RawTeam.folded_projects` + `LiveProjectCard` 的五个 `folded*` 键。
- `src/lite2/projectView.ts`：`ProjectFoldView` + `ProjectView.fold` + `foldViewOf()`。
- `src/lite2/screens/ProjectsScreen.tsx`：`FoldedDrawer`（无恢复键，理由写在组件头上）。
- `src/lite2/styles/lite2.css`：`.lite-projects-folded*` 一族（APPEND-ONLY，列表不是卡网格）。
- `src/shared/i18n/{zh,en}.ts`：七个 `projectsFolded*` 键。
- `eval-harness/tools/verify-folded-drawer-93.mjs`（新，17 判据）+ `run-battery.mjs` ROSTER 注册。
- `tests/test_granularity_rejudge_93.py` +10 条（facts.md 过滤 / 投影枚举门 / 抽屉载荷 /
  两抽屉划分 / 单批不折叠 / 真库一路验到投影）；
  `tests/test_registry_contract.py` 的全列往返守卫改判（§8.3 a′）。

---

## 6 · 验证账

- **离线电池**：`TZ=UTC` → **4204 passed · 0 failed · 4 xfailed**（基线 4175 + 新 29）。
- **真库套**：一次性库 `avery_t93_final`（docker `teammaster-postgres-1`，口令 `dev`），
  `-m needs_db` **全仓** 142 选中 → **137 passed · 5 failed**。
  **五条逐条销账，没有一条归本票**：

  - 🔴 **四条是本票之前就红的**，已在**干净 HEAD** 上复现证明（把 7 个被改的 tracked 文件
    `git checkout --` 回 HEAD、换一个全新一次性库重跑 → **同样这四条红**，跑完逐字节写回并
    assert 相等；**没用 git stash** —— stash 是仓库全局的，worktree 里裸 pop 会弹别人的存货）：
    `test_e2e_first_user_full_chain` / `test_company_survives_a_service_restart` /
    `test_file_space_survives_a_service_restart` /
    `test_ingest_over_http_persists_pgvector_and_survives_restart`。
    症状统一是 `0/0 materials` —— **#90 异步 deposit 的落账**：HTTP `/ingest` 现在秒回，
    这四条仍按同步路断言「请求回来时库里就该有东西」。#90 回执写的是「既有**五文件**
    needs_db 78/78」，这四条**不在那五个文件里**，属于当时没扫到的暗区。
    已记进 progress.md 的 Notes 并开了一张后续票建议（不在本票顺手修 —— AGENTS.md「Stay in scope」）。
  - 🟠 **第五条 `test_stress_concurrency_survival_and_health_not_blocked` 是机器负载下的延迟 flake**，
    不是回归。判据是 `max(health_latencies) < 8.0`，整轮里量到 **8.8s**；机器空下来之后
    **单跑连过 2/2**（16s / 17s，整轮那次 47s）。而且它**结构上够不着本票的代码**：
    压测打的是 8 路并发 `/ingest`，worker 的 `_execute_ingest` 走 `ingest_paths`，
    **`rejudge_after_append` 只有 `append_docs_to_context` 一个调用点**。
    ⚠ 留个碑：这条判据只采到 **2 个** health 样本（`[8.77, 1.70]`）—— 轮询线程自己被饿着了，
    「最大延迟」在这种采样密度下本来就不该当硬门。
- **#93 自己的真库四条 4/4 绿**：往返（折叠 + 裁决 + `subject_id`）/ kind CHECK 收 ruling 且
  没被捅漏（对照基准：别的 kind 照旧被拒）/ **升级路径七步** / 删除撤销折叠。
- **升级路径真跑（0810 纪律，做成常驻 needs_db 门）**：一个在跑的库 → 把 `entities_kind_check`
  打回 #93 之前的五 kind、并把存量项目行的 payload 去掉 `folded_into` 键（造 6 行）→
  **对照基准：此状态下 INSERT ruling 行真被库拒** → 新代码 `_ensure_schema` 接管 →
  复查 CHECK 已含 'ruling' → 升级后的库上真跑一次会折叠的补传 → 全新实例回读折叠与裁决都在。
  ⚠ 第一版这一步就红了，红得对：库里已经有 ruling 行，旧 CHECK 根本 ADD 不上去
  （`violated by some row`）—— 真实的 pre-#93 库没有那类行，所以先清再打回，并在注释里写明
  本用例**必须**跑一次性库。
- **变异实证 21/21 全歼**（逐条独立、锚点命中数 == 1、跑完 `write_bytes(原始 bytes)` 并 assert 相等）：

  | # | 打哪 | 落位 |
  |---|---|---|
  | M1 | `_active_projects` 不看 folded_into | 主不变式 |
  | M2 | 锁①-a（parent_kind）拆掉 | **R4 哨兵 + R5 同名两条各自红** |
  | M3 | 锁①-b（在场性）退化成「随便找一张」 | 归档母卡 / 只在文档里的母卡 |
  | M4 | 锁②（字节拉不回）不 abort | 存量 NULL 那条 |
  | M5 | 锁②（parse 失败）不 abort | 坏 xlsx 那条 |
  | M6 | 重跑根本不调 | 主不变式 |
  | M7 | 裁决不记 | 落库判据 + 「折了必有解释」不变量 |
  | M8 | 不 absorb | 母卡吸收判据 |
  | M9 | pg put 丢裁决 | **needs_db 往返门** |
  | M10 | 回执 FoldRecord 丢 id | 回执 id 判据（**第一轮存活 → 补的判据**）|
  | M10b | 裁决丢 subject_id | 落库判据 |
  | M11 | 撤销折叠 no-op | 删除撤销门 |
  | M12 | 撤销折叠恒真 | **删无关文档不该动折叠**（反向门）|
  | M13 | 「文档被删」升级成致命 | skipped_missing_docs 那条 |
  | M14 | 血缘为空的卡照判 | skipped_no_lineage 那条 |
  | M15 | 母卡池不排除本轮降级对象 | **链哨兵语料**（**第一轮存活 → 补的语料**）|
  | M16 | 不打 folded_into 标 | 主不变式 |
  | M17 | 0010 的 `want` 落后 | **新补的 want/ADD 孪生门** |
  | M18 | R5 谎称 parent 是 project | 锁①-a 的 R5 那条 |
  | M19 | 手编护盾拆掉 | 手编卡不折那条 |
  | M20 | 手编护盾做成全局 | **逐卡生效的反向门** |

  ⚠ **第一轮两条存活，查下去都不是门洞、但都换来了一条真判据**（0808 碑：变异存活先查它有没有
  真的碰到被判的性质）：M10 打的是**回执**字段而裁决的 `subject_id` 是另一行代码（**打歪了**，
  重新瞄准成 M10b 当场红）；M15 打的性质在原语料里**一个实例都没有**（三条降级的 parent 全指
  同一张活卡）—— 补了链形状哨兵语料之后当场红。
- `./init.sh` 绿（本票前端零字节）。两个新文件行尾自查 `bare_lf == 0`。
- 🔴 **未 push**（票面铁律）。

---

## 7 · 已知边界与缺口（明写，不藏在绿灯后面）

1. ~~🟠 **被折叠的卡今天对经理是不可见的**~~ → **✅ 2026-08-13 收尾补完，见 §8.1**。
   （原文：折叠抽屉 UI 不在本票内，票面明写「UI 抽屉不进本票，报告即可」。后端答得出
   「为什么这张卡不见了」，但今天只有后端答得出。）Danny 08-13 拍板：欠着的全部在本轮一起做完。
2. ~~🟠 **被折叠的卡仍然进 `facts.md`**~~ → **✅ 2026-08-13 收尾补完，见 §8.2**。
   （原文：`materialize_memory` 对 `archived` 从来也没过滤过，顾问仍可能引用一张经理在项目轴上
   看不到的卡。）修的时候挖出一个更深的：这个函数**根本没在手编 CRUD 之后被调用过**。
3. **重跑成本随档案线性涨**：每次补传要把整个档案的字节重建一遍（每份一次 bytea 查询 + 一次
   parse）。CSV 秒级；大 PDF 的缓存策略票面说「先不做，量出来再说」—— 计时已埋
   （`ingest-timing stage=rejudge ... files=<档案文档数>`，⚠ 这一段的 `files=` 数的是**整个档案**，
   其余四段数的是本批，正是要并排看的两个数）。
4. **R5 在重判路上结构性不开火**（不只是被锁①-a 拒绝）：重判看到的是**归并后**的人卡
   （一人一张、keep-first 单一 source），而抽取路看到的是**逐文档**的人。所以行对齐的算术
   在重判路上本来就更弱。这不影响任何东西（R5 是文档局部规则，抽取路已经在每一批上判过），
   写在这里是免得下一个人把「重判从不产生 R5 折叠」读成 bug。
5. **一条卡折进一张后来自己也被折的卡**（跨轮的链，A→B 第一轮、B→C 第二轮）是允许的：
   两环各自都有解释，`_active_projects` 两张都过滤掉。同一轮内的链被禁（§1 锁①-b）。
6. **`file_delete` 的 R3 evidence 残留**：见 §3 末段。
7. 🔴 **本 session 跑过 `./init.sh`，所以 `dist/` 现在指向生产域名**（既有碑）——
   下一个人跑任何上传型门/截图前先重打带 `VITE_AVERY_API_BASE` 的 dist 并在浏览器里验 apiBase。
8. 🔴 **发现的、不属于本票的真问题**：四条 needs_db 测试自 #90 起就红（§6）。修它属于 #90 线
   的收尾，不是 #93 的范围 —— 本票没有顺手修（AGENTS.md「Stay in scope」），只留了可复现的证据。
   → 已在 #95 结清（`receipt-95.md`）。

---

## 8 · 收尾（2026-08-13，Danny 授权把欠账一起做完）

§7 的头两条本来是「明写在绿灯外面」的缺口，这一节把它们关掉。**两条修的是同一件事的两面**：
折叠把一张卡从经理眼前拿走了，那么 ① 他得看得到它去哪了，② 顾问不能反过来还在引用它。

### 8.1 「已并入其他项目」区（§7.1）

`GET /team/{id}` 新增 `folded_projects`（同 absent≠none，一张没折就不发键），前端项目屏在归档区
**之下**多一个默认折起的区。展开后每条一行：**标题 · 已并入「母卡」· 闸自己写的那句理由 ·
依据 `本周周报.md:6`**。这就是 #93 把裁决落库换来的东西第一次真被读出来。

**三个刻意的不同，都不是省事：**

| | 归档抽屉 | 已并入区 |
|---|---|---|
| 谁收的 | 经理自己 | 粒度闸 |
| 有没有恢复键 | **有** | **没有** |
| 卡形 | 灰化项目卡（负责人/进度…） | 一行文字（去向 + 理由 + 原文行号） |

🔴 **没有恢复键是想清楚的，不是漏做**。`rejudge_archive` 每次补传都对**全档案**重跑一遍，
所以手动放回来的卡下一次上传就会被原样再折 —— 那是一个会自己撤销的按钮，比没有按钮更伤。
真要给「放回来」，得连带把这张卡钉成手编领域（吃 `_manually_touched` 那条豁免），
等于让经理给单张卡**永久关掉**粒度闸。那是一个独立的产品决定，不在这里替 Danny 做。
今天卡回来只有一条路而且是自动的：解释它的那份文档被删 → `file_delete` 撤销折叠。
这条路写进了区尾那句话（「原文都还在。删掉判定它的那份资料，它会自动回到上面的网格。」）。

🔴 **卡形不同**也不是审美：那些读数已经被 `_absorb_project` 并到母卡上了，在这儿再摆一遍卡面事实
就是拿同一摊事跟经理说两遍 —— 而那正是 `_active_projects()` 过滤它们的理由。

🔴 **理由用后端原句**（`Ruling.reason`），前端不按 `rule` id 编人话。编一句 = 同一条口径长两处，
闸改了措辞这边不会红。`rule` 是给工程师看的，**不渲染**。

**门**：`eval-harness/tools/verify-folded-drawer-93.mjs`，**17 判据 · 0 FAIL**，已进 run-battery
ROSTER 的 A 区（A 区 38 → 39 道）。剧本就是合伙人真实的动作序列：传台账（6 张，**此刻没有这个区**
——对照基准）→ 补周报 → 网格 4 张 + 「已并入其他项目（3）」→ 展开逐条验去向/理由/行号 →
区里除展开键零按钮（配一条自证：归档抽屉那边**有**恢复键，证明不是 CRUD 挂了）。

**born-red 实证**：把 `foldedIntoTitle` 那一格打歪（恒走 unknown 分支）→ 重打 dist → 跑门 →
**16 PASS · 1 FAIL，红的正是「每行都说得出并进了哪张母卡」那一条，邻居一条都没跟着塌**。
判据是各自锚住的，不是靠一条塌带一片。还原后 17/17。

**人眼过图**：`scratchpad/folded-drawer.png`（1440×960 中文壳）+ `folded-en.png`（EN 壳，
壳文案全英、尾注也没进渐隐带；那句仍是中文的理由见 §8.6.4）。
⚠ **第一版截图是假的** —— 见 §8.3(b)。

**真库那一层单独验到投影为止**：「已并入」区那四格是 `folded_into` 与 `granularity` 现场
join 出来的（`subject_id` 是 join key），真库往返只要丢一格，抽屉就退化成「它没了，别问」，
而**离线套 100% 全绿**（内存腿从来不 asdict→JSONB→回读）。所以
`test_a_fold_and_its_ruling_survive_a_real_snapshot_replace` 从实体一路验到
`folded_project_cards()` 和 `_team_payload()`，不停在 `folded_into` 上。

### 8.2 `facts.md` 不再写收走的卡（§7.2）

`materialize_memory` 在这之前把 `extraction.people/projects` **原样全写**。于是顾问引得到
经理软删的项目、停用的成员，以及 #93 新加的被折叠的卡。屏幕上没有、顾问却张口就来，
是最难自证的一类错：经理没法点开那张卡去对，只会觉得这东西在胡说。

**判据收成一处**：`extract.hidden_reason(entity)` —— `""`=在屏幕上 / `"archived"` / `"folded"`。
三条路现在问同一个函数：`registry._active_projects()`、`materialize_memory()`、
`rejudge.rejudge_archive()`。之前是**三份手写谓词、其中一份压根不存在**。

⚠ **折叠掉的那张卡的原文并没有从检索里消失**：文档正文照旧进 `materials` → RAG 分块。
去掉的只是「存在一个叫 X 的项目」这句**由卡合成的断言** —— 而那张卡确实已经不在了。
这一条有专门的反向哨兵判据（不然「把标题从语料里一律抹掉」也能让主判据全绿）。

### 8.3 修的过程里挖出来的两个真问题

**(a) 手编 CRUD 从来不重物化 `facts.md`。** 写完过滤，测试红了 —— `archive_project` 之后
facts.md 一个字节没变。`ProjectWriteMixin` 的八个写法都是裸 `self.put(ctx)`，而 `put()`
不碰 facts.md。**pg 腿更难看**：`PostgresContextRegistry.put()` 是**从磁盘读** facts.md 存进 DB 行的，
所以陈旧那份会被就地烤进数据库，下一次 `get()` 再原样写回磁盘 —— 自愈不会发生，它**反过来固化**。
修法是给这个 mixin 一个唯一落盘出口 `_commit(ctx)`（先重物化、再 put，顺序不能反），
八个写法全走它。防复发的门按 AST 扫这个类：除 `_commit` 外谁再调 `self.put(` 就红。

**(a′) 那个修复自己炸出一条真库红，而红的是判据不是代码。**
`test_pg_manual_crud_roundtrip_erases_no_column_anywhere`（全列往返守卫）在 `-m needs_db` 全仓
里唯一一条红，报 `memory_files` 变了。实测差异是 **facts.md 多了一行
`Project 'Roundtrip Guard':.`**（notes.md 逐字相同、`整列被抹掉的: {}`）—— 那正是修复要的效果：
在这之前，经理手加的这张卡，议事室的 recall **一个字都不知道**。
改判据不是把这张表从 diff 里划掉（那会连「整列被抹掉」也一起放过），换的是一条**更严的**：
notes.md 必须逐字不变 + facts.md 必须**只增不减**（旧行一行不少，新增的必须包含新卡那一行、
其余只许是段标题）。⚠ 第一版判据写成「新增的正好是那一行」，红了 —— 这份 fixture 的语料本来
一个项目都没有，所以还会长出 `## Projects` 段标题。判据写死行数就会跟着语料形状漂。

**(b) 我自己的截图骗了我一次。** 第一张人眼过的图上，区尾那句话是糊的、像被屏底家具压住。
查下去两层都不是我以为的：`window.scrollTo` 是**空动作**（滚动条在 `.lite-projects-scroll` 上），
而 `scrollIntoView({block:'end'})` 只把这一段底边对齐到容器底边、**还剩 90px 没滚**，
尾注正好落进容器末尾 44px 的**渐隐遮罩**里。滚到真底之后：尾注 y730–750、渐隐线 796、
发射器 874 —— 完全干净，**布局没有缺陷，缺陷在我的量法**。

这件事的后果不止一张图：`elementFromPoint` **看不见 mask**（被遮罩淡成透明的元素照样命中自己、
`opacity` 照样是 1），所以第一版那条「没被压住」的判据对着一片看不见的字**是绿的**。
门里现在是三条一起：真命中 + 几何式的「底边在渐隐带之上」（遮罩宽度**从计算值读**，不写死 44）+
最后一行取的是**尾注**不是最后一个 item（第一版只探 item，尾注整行糊掉而门全绿）。

### 8.4 像素基线为什么不会漂 —— 前提写成了判据

这个 worktree 里 visual 基线 **0 张**（gitignored 的 per-worktree 产物），在这儿跑 visual 是空跑
——「新 worktree 里 visual 门是 40 张『没有基线』，一张都没比对」那条碑的现场。所以没跑它，
改成把**论证的前提**钉成判据：`visual-data.spec.mjs` 把 demo-seed 九份文件**一次全选**上传，
而一次全选**永远折不出卡**（抽取路对降级候选是丢弃，折叠只发生在补传路）→ `folded_projects` 恒缺席
→ 这个区一次都不渲染 → 新加的那族 CSS 一条都匹配不上。
判据：`test_a_single_batch_upload_never_produces_a_folded_card`，带补传路 3 张的对照。

### 8.5 收尾验证账

| 项 | 结果 |
|---|---|
| 离线全仓 | **4217 passed · 0 failed**（收尾前 4207 → 新增 10 条） |
| `-m needs_db` **全仓**（一次性库 `avery_t93b`） | **142 passed · 0 failed**（约 13 分钟；不按文件挑） |
| 途中那条唯一的红 | `test_pg_manual_crud_roundtrip_erases_no_column_anywhere` —— **判据该改，不是代码坏**，见 §8.3(a′) |
| `#93` 那个文件 | 39 passed |
| 前端 typecheck / lint / css-brace / css-scope / i18n-orphans | 全绿（lint 的 6 条 warning 是既有的、无关文件） |
| `verify-folded-drawer-93.mjs` | **17 PASS · 0 FAIL**（含 390×780 手机视口） |
| born-red | 打歪 `foldedIntoTitle` → 只红目标那一条（16/1） |
| 一次性库清理 | `avery_t95b` / `avery_t95c`（#95 遗留）已删；本轮 `avery_t93b` 用完即删 |

🔴 **收尾时我自己踩了一次「缺一真烧钱」，如实记账**：有一轮离线全仓是从**仓库根**跑的裸
`pytest`，而离线兜底那行 `addopts = -m "not smoke and not seedgate and not needs_keys and not
needs_db"` **只住在 `eval-harness/pytest.ini`，仓库根一个 pytest 配置都没有**。于是 `seedgate`
被一起选上，而 `test_seed_gate.py::live_service` 这个 fixture **自己 spawn 一个
`AVERY_BRAIN=minimax` + `AVERY_EMBEDDINGS=dashscope` 的 uvicorn**（`.env` 里两把真 key 都在）。
日志实录：2 次 `/ingest`（真 LLM 抽取）+ 1 次 `/advise`（真生成 + dashscope 向量），全 200 —— **真花了钱**。
* **招牌症状**：结尾那行是 **`142 skipped`** 而不是 **`151 deselected`**。看到 `skipped` 就是
  cwd 错了，别去查代码。带路径参数时不会踩（pytest 会沿参数往上找到那份 ini），**只有裸
  `pytest` 会踩**，而那正是「跑一遍全仓」最自然的写法。
* 那 3 条 seedgate 红**不是本票的回归**：它们要真 key + 真 `:8137`，默认排除，本仓的「绿」
  从不包含它们；失败形态是 `advice: None`（模型没返回可用内容），本票的 diff 造不出这个。
  没有为了定性再跑一遍去二次花钱。
* fixture 的 teardown 把 `:8137` 收干净了（实测无监听），没留下一个付费形状的后端在跑。
* 已落碑：`memory/pytest-cwd-repo-root-burns-money.md`。

⚠ **`dist/` 现在指向 `http://127.0.0.1:8393`**（本轮为跑门重打过）。下一个人跑任何上传型门或
截图前，照 §7.7 那条先重打带自己 `VITE_AVERY_API_BASE` 的 dist，并在浏览器里验 `apiBase`。

### 8.6 仍然留在台面上的

1. 🟠 **「放回来」按钮**：见 §8.1，是一个独立的产品决定（等于给单张卡永久关掉粒度闸）。
   今天唯一的回退路是删掉判它的那份资料，并且已经写在界面上。
2. **母卡被经理归档之后**，「已并入」区仍然显示 `已并入「<母卡名>」`（母卡查得到，只是不在网格上）。
   这是刻意的：经理问的是「它并去哪了」，不是「母卡此刻在不在网格上」。
3. `SignalEntity`（notes.md）没有可见性标记，所以一条挂在被停用成员身上的信号仍会进 notes.md。
   `hidden_reason` 是 duck-typed 的，那天要加只是给它一个字段的事 —— 但今天信号上没有那个字段，
   不假装有。
4. 🟠 **EN 壳下那句理由仍是中文**（实测截图 `scratchpad/folded-en.png`）。壳本身全英
   （`Merged into other projects (3)` / lede / 尾注都对），中文的是 `Ruling.reason` ——
   **后端派生文案，`granularity.py` 无条件写中文，今天整个模块没有 locale 这个概念**。
   这是本票**第一次**把它投上屏（此前它只活在回执和日志里），所以缺口是这一票暴露的、不是造的。
   没有顺手翻：那句话把文档自己的词整段引进去了（「…列在项目「秋季营销冲刺」的「里程碑」清单里」），
   给中文引文套一层英文框架仍然是混排；而且它与回执里那句**逐字相同**是刻意的。真要做，
   是给整个粒度闸加 locale 的一张独立票。
   ⚠ **今天没有任何一道门够得着它**：`verify-locale-parity` 用的是**一次全选**的 demo-seed 语料
   （见 §8.4），那条路永远折不出卡，这个区一次都不渲染。记在这里，别指望门会提醒。
