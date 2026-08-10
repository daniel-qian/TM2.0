# 回执 · #87 实体血缘地基（0810 设计轮票 5）

> 正源：`.issues/design-0810/design-plan.md` §6.1 + §7.2（Danny 2026-08-10 已审过）· issue #87
> 日期：2026-08-10 · 分支 `claude/jolly-fermi-36d83a` · commit `c72dc34`
> 🔴 **未 push、未上产。** 纯后端，前端零字节。

---

## 1 · 一句话

给 `PersonEntity` / `ProjectEntity` 加一个顶层 `lineage` side-car，让每张卡记住
**它来自哪几份文件**、**每一格是哪一份文件的哪一行给的**、以及**每一次被顶掉时毁掉了什么**。
`delete_document_from_context` 的行为**一个字节没改**（票面明写「本票只做地基」）。

---

## 2 · 病与它的两个下游（票面已写，这里只留落点）

Avery 读一份文件时干两件事：①把原文与切片存起来 ②**从原文得出结论写到卡片上**。
`delete_document_from_context` 只收走①。#77 当时的裁定写在 `file_delete.py:27-33`：不是偷懒，是
**血缘不够**——实体只有单值 `source`、归并 keep-first，删完只知道「少了一份来源」，
不知道「少了之后该变成什么」。

撤回（票 7）缺的是**同一块东西**：旧值在 `AppendLedger.absorb` 里被 `setattr` 抹掉，
`reg.put()` 是整快照 DELETE+INSERT，无历史无 journal。

本票把那块东西补上。两条下游各自开票，本票不碰。

---

## 3 · 形状

```
lineage = {
  "docs":   ["旺季排班协调纪要.md", "项目台账.md"],
  "fields": {"ownerName": {"source": "旺季排班协调纪要.md:12",
                           "batch_id": "b-7973c658c417",   # 只有补传批次才有
                           "seeded":  True,                # 见 §4「推出来的 vs 记下来的」
                           "prev": {"value": "老周", "source": "项目台账.md:7",
                                    "prev": {...}, "truncated": True}}}
}
```

### 两个键回答**两个不同的问题**（别混着用）

| 键 | 答的问题 | 用途 |
|---|---|---|
| `docs` | **哪些文档提到过这张卡** —— 输给 keep-first 的读数、手编赢挡下来的读数、逐字复述的读数，只要落到这张卡上，那份文档就在这里 | 「删光之后这张卡还有没有文档依据」（整张该走 vs 只该收缩一格） |
| `fields[f]` | **这一格最后一次由文档/表单写入时，出处是什么** | 「删掉之后该变成什么」「撤回之后写回什么」 |

### 与 `provenance` 的分工（🔴 必须连读）

- `provenance[f].origin` 答「**这一格现在归谁**」（`doc`/`manual`/`form`，手编赢）。
- `lineage.fields[f]` 答「**这一格的文档血缘**」。

**手编改一格不动 lineage**（`_mark_manual` 只写 provenance）。所以经理接管过的格子上，
lineage 说的是「上一次由文档说了算时是谁说的」，**不是**屏幕上那个值的出处。
票 7 正好两个都要：`origin` 判该不该给这一格撤回钮（经理已接管的不该给），`lineage` 判撤回之后写回什么。
钉在 `test_a_manual_edit_leaves_the_document_lineage_standing`（同一条判据里两句都断）。

---

## 4 · 三个设计决定与它们的理由

### ① 🔴 订正票面「嵌进 `provenance` 里免迁移」——三条都是读码 + 实测核过的

票面 §7.2 给的是一张**成本表**（嵌套免迁移 / 顶层要迁移 / 新 kind 走 0010），不是指令。
「来源文档集合」按定义是实体级属性，顶层字段与迁移**无论如何都躲不掉**；既然迁移已经付了，
把 `prev` 也放进同一个新键，比污染 `provenance` 严格更好：

1. `registry._one_person_card` / `_one_project_card` 把 `dict(provenance)` **原样**投给浏览器，
   而 `LiveFieldProvenance`（`transport.ts:270`）是 `{origin, source, updated_at}` 的**闭**契约。
   往里塞 prev 链 = 一串旧值上线 + 载荷违约，且前端不报错、只是不显示；还要穿过
   `stripPersonNumbers`（它对 `provenance` **整键放行**）。
2. **首次上传的格子根本没有 `provenance`**——`stamp()` 只在补传/手编/表单回流三处开火。
   而本票要修的那张卡（《旺季排班协调纪要.md》喂出来的 `ownerName`）恰好是首次上传铸的：
   **provenance 结构上装不下它。**
3. `origin:'doc'` 在屏幕上的意思是「**被后来的上传顶掉过**」
   （`projectView.provenanceBadgeKind:91-102` + `DetailOverlay.tsx:314`），
   也正是 #85 只读清单便宜的全部理由（design-plan §7.1①）。
   首次上传就写 provenance，会把那枚角标变成**一句集体谎话**，顺带把 #85 的地基拆掉。

变异 M17 是这个决定的守门人：往 `stamp()` 的记录里加一个键 → `test_the_wire_contract_for_provenance_is_untouched` 红。

### ② 「推出来的」与「记下来的」——`seeded`

一张卡刚被抽取器铸出来时，它每一格都来自 `source` 那一份文档，所以 `__post_init__` 就地播种一次，
**那一趟是精确的**。同一条路顺带接住 **#87 之前落库的存量卡**（没有 lineage 键，回读时按 `source` 推一次）。

- 推出来的记录带 `seeded: True`；写路（归并/补传）真记下来的**不带**。
- 存量多文档卡上，enrichment 来的那几格可能记错文档 → 打标让消费方自己决定信不信
  （`docs` 只有一条时它恒精确）。
- 🔴 **红线**：`provenance[f].origin` 不是 `doc` 的格子**不认领**。否则一张文档卡上经理手填的那一格，
  会在下一次 `get()` 回读时被推成「某份文档说的」——一句凭空造出来的出处，而且没人查得出来。
  变异 M2 钉着它。

**手编卡（`um-…`/`pm-…`，`source` 恒空）`lineage == {}`** ——这就是正确答案：没有任何文档喂过它，
删光所有文档也不该动它。⚠ 空 lineage 有两种成因（手编卡 / 没有出处的老卡），区分它们要看 `provenance`。

### ③ 上限与截断

- `docs` **不设上限**：上限会让「这张卡不是这份文档喂的」变成假话，正是 `[:6]` 在并集字段上那条
  票面点名的伤。
- `prev` 链封顶 `_LINEAGE_CHAIN_DEPTH = 8`，砍**最老**那一头（撤回从最新往回走），
  **砍处打 `truncated: True`**。静默截断会让「第 N 次之前的旧值还在」读成真话。M8/M9 各钉一条。
- `prev.value` **写入那一刻**就拍平成 JSON 原生形状（`_jsonable`）。理由是这个仓库吃过的那口：
  `pg_registry` 存 `asdict`、回读走 `Entity(**payload)`，于是内存里是 `ProjectRisk` 对象、
  库里回来是 dict——`risk`/`milestones` 当年就这么在**持久化那条路上**炸的。
  血缘是没有强转的 side-car，只能靠写入时消差。M10 + `@needs_db` 的 `test_prev_holds_the_same_shape_on_both_legs` 双保险。

---

## 5 · 改了什么（6 个文件，+1270 / −22）

| 文件 | 改动 |
|---|---|
| `avery/ingest/extract.py` | 新增「#87 · 实体血缘」一节（常量 + 7 个函数）· 两个 dataclass 各加 `lineage` 字段与 `__post_init__` 播种 · `_absorb_person`/`_absorb_project` 的 `or` 改写成显式 if（**结果逐字未变**，只为让「这一格是不是它填的」问得出来）· `AppendLedger` 收 `batch_keys` + 三处 `note_field_source` |
| `avery/ingest/file_append.py` | `AppendLedger(..., batch_keys=本趟新文件的 key)` + 一段「两个参数问的是两件事」的碑 |
| `avery/ingest/form_reflow.py` | 表单回流写 blockers 时记血缘（一份提交也是一份 SourceDocument） |
| `avery/ingest/file_delete.py` | **只改文档**：#77 那段裁定的前提已经变了，但行为没变——把「还差什么」写成三条 |
| `db/migrations/0009_…richalign.sql` | allowlist **就地**加 `'lineage'`（`want` 与 ADD 两处同改）+ 说明 |
| `tests/test_entity_lineage_t87.py` | **新**：38 条离线 + 3 条 `@needs_db` |

**没改**：`registry.py`（投影层一字未动）· `pg_registry.py`（`_entity` 本来就忽略未知键、
`_PERSON_FIELDS` 从 dataclass 反射）· `ContextRegistryProtocol`（**没加任何方法**，
所以 `test_registry_protocol.py` 的成员数断言原样未动——与 #86 的串行担心无关）· 前端零字节。

---

## 6 · 验证账

| 项 | 结果 |
|---|---|
| **离线全套** `TZ=UTC python -m pytest -q` | **4114 passed · 0 failed · 136 deselected · 4 xfailed**（128s）。基线 4076 + 本票 38 = 4114 ✅ 对得上 |
| **真库套** throwaway `avery_t87_test`（docker `teammaster-postgres-1` / pgvector pg17） | **73 passed · 0 failed**（`-m needs_db`，含 `test_entity_lineage_t87` 3 条 + registry_contract/protocol/append/delete/empty/form_reflow 全部） |
| **变异** | **18 条逐条独立跑、跑完还原原始字节 → 18/18 全红**（台账见 §7） |
| `./init.sh`（typecheck + build） | 绿 |
| 前端门电池 | **未跑**，理由：`git diff --stat` 显示改动全在 `eval-harness/`，前端零字节、零渲染改动、像素按构造不漂 |
| 行尾自查 | 6 个文件全部 `bare LF == 0` |

### 🔴 迁移的真实升级路径 —— 真跑过，不是读码推断

在两个一次性库上跑完整剧本（脚本见 §8）：

| 步 | 结果 |
|---|---|
| ① 用**旧** 0009（allowlist 无 `lineage`）+ **新**代码引导 | **`CheckViolation`：每一条人卡写入被真库拒掉** ← 这就是「迁移必须改」的实证，不是推断 |
| ② 库上先落一条 #87 之前形状的存量人卡行（无 `lineage` 键） | ok |
| ③ 换回 #87 的 0009，**重放引导** | ok（守卫式 DROP+ADD 就地升级） |
| ④ 库里的 CHECK 现在含 `lineage` | ✅（`pg_get_constraintdef` 实查） |
| ⑤ 带 `lineage` 的人卡行现在能插 | ✅ |
| ⑥ 护城河没被捅漏：表外顶层键（`绩效评分`）照旧被拒 | ✅ |
| ⑦ 存量行活过了那次全表重验 | ✅ 1 行仍在（ADDITIVE，严格超集，不可能拒掉既有行） |

**上产结论：#87 需要 0009 的就地修订，不是新增迁移。** `_ensure_schema` 每次引导自动重放，
所以换容器即生效；但**先换后端容器再回滚代码**会让库停在新 CHECK（无害，严格超集）。

---

## 7 · 变异台账（18/18）

| # | 变异 | 判据 |
|---|---|---|
| M1 | 播种只记 docs、逐格血缘一格不播 | `…every_document_writable_cell_is_seeded…` |
| M2 | 播种连手编过的格子一起认领（去掉 origin 护栏） | `…hand_edited_cell_is_never_claimed_by_a_document_on_reload` |
| M3 | 每次构造都重播种（写路记录被推定值覆盖） | `…seeding_never_overwrites_a_lineage_that_is_already_written` |
| M4 | `absorb_sources` 空转（来源集合不吸收输家） | `…a_reading_that_lost_keep_first_still_names_its_document` |
| M5 | enrichment 血缘退回「活下来那条实体的整条 source」 | `…the_document_that_enriched_a_cell_owns_that_cell` |
| M6 | 顶掉旧值时不拍照（prev 恒缺席） | `…a_newer_document_records_the_reading_it_destroys` |
| M7 | enrichment 也挂 prev（把补全谎报成覆盖） | `…enrichment_records_no_prev_because_nothing_was_destroyed` |
| M8 | 链静默截断（砍了不说） | `…the_chain_is_capped_and_says_so_where_it_cuts` |
| M9 | 封顶砍掉**最新**那一头 | 同上（末条断言） |
| M10 | `prev.value` 存 dataclass 原对象 | `…prev_holds_a_json_native_value_even_for_risk_and_milestones` |
| M11 | 并集字段不记它替换掉的那张列表 | `…every_unioned_cell_records_the_list_it_replaced` |
| M12 | 来源文档集合不去重 | `…a_restated_value_does_not_churn_the_lineage` |
| M13 | 批次号按**全表**算 | `…the_ledger_batch_is_the_new_files_not_the_whole_library` |
| M14 | 血缘只跟可刷新字段、不跟并集字段 | `…every_document_writable_cell_is_seeded…` |
| M15 | 手编赢的格子也被文档改写血缘 | `…hand_edited_cell_keeps_its_document_lineage_and_gains_no_prev` |
| M16 | 0009 **真执行**的 ADD 漏掉 `lineage` | `test_person_keys_allowlist_covers_exactly_person_fields` |
| M16b | 0009 的 **`want`** 落后于 ADD | `test_migration_0009_guard_literal_matches_its_own_ADD`（**本票新增**） |
| M17 | 把血缘挤进 `provenance` | `test_the_wire_contract_for_provenance_is_untouched` |

### 🔴 第一轮有 2 条活了下来，两条都是门洞（碑值最高的一段）

**M14 —— 尺子长在被量的东西上。**
「逐格播种」那条判据原本写成 `set(got) == set(_lineage_fields(kind))`，而 M14 改的正是
`_lineage_fields`。**它一缩水，期望值跟着缩水**，「血缘只跟一半字段」当场 2 passed 全绿。
→ 期望值改成取自**两张源表**（`_APPEND_REFRESHABLE | _APPEND_UNIONED` = 「一份文档写得动哪些格子」），
并补一条「跟踪面与源表按定义相等」的断言。
**教训：判据的期望值不许由被测函数算出来**（与 `_jsonish` 刻意不 import `_jsonable` 同一条）。

**M16b —— 变异自己打错了地方，反而炸出一个既有门洞。**
第一版 M16 的锚点 `,''lineage'']::text[]` 只命中 `want` 字面量、**没碰**真执行的 `ADD`，
而既有门 `test_person_keys_allowlist_covers_exactly_person_fields` 正则扫的**只有 ADD**——
所以「存活」不是代码有 bug，是这条变异没碰到被判的性质。
**但顺着它查下去，发现 0009 的 `want` 与它自己的 ADD 此前无人比对**：
`test_conflicts_record_b2a.py::test_migration_0010_guard_literal_matches_its_own_ADD` 早就为
**0010** 关了这个洞（那条 docstring 逐字点名「不看 `want`」），**0009 一直没有孪生门**——
而 #87 正是它的数组被就地改动的第一次。两种漂法各有各的坏：
- 只改 ADD、`want` 落后 → 引导时 `have`(旧) 与 `want`(旧) **相等** → 整个 IF 被跳过 →
  **那条新 ADD 永不执行** → 库里 CHECK 停在旧集合 → 带新键的人卡被真库拒收，而离线全绿
  （08 的 playbook kind 当年翻车的同一种形状）；
- 只改 `want`、ADD 落后 → **每次**引导都 DROP+ADD+全表重验（ACCESS EXCLUSIVE 锁），
  正是 0724 那次把部署拖过 `statement_timeout` 的成本。
→ 补 `test_migration_0009_guard_literal_matches_its_own_ADD`，拆成 M16 / M16b 两条变异各钉一处。
⚠ 写这条门时自己也踩了一次：`want` 前面还有 `kind <> ''person''`，不排除它 `'person'` 会混进键集，
让门对着两边完全一致的迁移**恒红**——碑留在测试里。

---

## 8 · 复现命令

```bash
# 离线（三件套 + TZ=UTC）
cd eval-harness && TZ=UTC python -m pytest -q

# 真库（throwaway，跑完自己 drop）
docker exec teammaster-postgres-1 psql -U postgres -c "CREATE DATABASE avery_t87_test;"
docker exec teammaster-postgres-1 psql -U postgres -d avery_t87_test -c "CREATE EXTENSION IF NOT EXISTS vector;"
AVERY_DB_URL="postgresql://postgres:dev@127.0.0.1:5432/avery_t87_test?channel_binding=disable" \
  TZ=UTC python -m pytest -q -m needs_db tests/test_entity_lineage_t87.py tests/test_registry_contract.py \
  tests/test_registry_protocol.py tests/test_file_append_t10.py tests/test_file_delete_t77.py \
  tests/test_context_empty_t86.py tests/test_form_reflow_a2.py
```

⚠ 本机 docker PG 的口令是 `dev` 不是 `postgres`（`docker inspect teammaster-postgres-1` 可查）。
迁移升级剧本的脚本是一次性的，没入库；步骤写在 §6 的表里，照着重搭 10 分钟。

---

## 9 · 交给下一张票的账

### 9.1 「逐条撤回」（票 7）—— 票面要求先摸清的四笔成本，逐条已量

| 账 | 现状 | 量级 |
|---|---|---|
| **① 冲突要 retract 并重选胜者** | 🔴 **需要产品拍板，代码这边没有正确答案**。`FieldConflict` 是一句「这两份资料对同一格给出了不同读数」的陈述；撤回一方之后由谁胜出，`file_delete.py` 头明说这等于「替抽取器编一个它从没做过的判断」。血缘帮不上这一条 | 拍板 → 中 |
| **② `ownerName` 撤回不是一个字段** | 已钉成判据（`test_retracting_ownerName_is_not_one_field`）：顶掉时 `ownerId` 被清空、由 `_link_owners` 重连；`ownerId` **没有独立血缘**（它是派生 join key）。写回名字之后必须**再跑一次 `_link_owners`**，否则信号还挂在错的人身上 | 小·但必须成对做 |
| **③ 并集字段 `[:6]` 前向有损** | 已钉成判据（`test_the_union_cap_is_lossy_forward_and_the_prev_still_restores_the_old_list`）：prev **还原得回补料前那张完整列表**，但那一趟被截掉的新条目谁也捡不回来。**UI 不该给这些字段一枚看起来无损的撤回钮** | 产品口径，零代码 |
| **④ `facts.md` 必须重 materialize** | 现成：`file_append`/`file_delete` 都已经是「先 `materialize_memory` 再 `put`」（命门③）。撤回照抄这条顺序即可，否则顾问还在引用被撤回的值 | 极小 |

**另外三笔血缘这边的边界（票 7 动手前先读）**：
- **存量公司拿不到追溯撤回**（票面已认）：#87 之前落库的卡只有 `seeded` 推定值，没有 prev。
- **手编接管过的格子不该给撤回钮**：判 `provenance[f].origin == 'manual'`，见 §3 的连读口径。
- **prev 链封顶 8 环**，第 9 次之前的旧值带 `truncated: True` 明示不可达。

### 9.2 「删文件收回结论」—— 🔴 **它今天没有票**

design-plan §8 的排期表里，#87「同时解锁」两条下游，但只有「逐条撤回」列了票 7，
**「删文件收回结论」一张票都没有**。地基已经就位，建议开票，本票已量到的成本：

- **卡整张走 vs 只收缩一格**：`docs` 删空 → 整张走；`docs` 还剩别的 → 逐格看 `fields`。
  两种情况现在分得开（`test_a_card_backed_only_by_the_deleted_document_is_now_identifiable`）。
- **收缩一格之后写回什么**：`prev` 有就退回 prev，没有就清空。
- **卡住它的仍是 §9.1① 那条产品拍板**（删掉冲突的一方之后谁胜出）——与撤回**同一个**问题，
  一次拍板同时解锁两张票。
- `test_file_delete_t77.py::test_delete_keeps_the_person_cards` 是它的 born-red 靶子：
  那张票落地的那一刻这条判据必须被**改判**（不是删掉），并在同 commit 配变异。

### 9.3 #85「这次补料改了什么」可以直接吃现成的

- `batch_id` 就是「这一批」的确定性名字（`batch_id_for(新文件的 source_key 集合)`），
  不用再靠 `uploaded_at` 猜分组。
- 「从 X 改成 Y」的 X 现在**每一格都有**（`prev.value`），不再只有 `conflicts` 里那 3/10 个字段。
  §7.1 那条「加一个 additive `payload["conflicts"]`」仍然可以做，但**不再是唯一出路**。
- ⚠ 但 `lineage` **今天不投给前端**（本票是纯后端地基，`test_the_wire_contract_for_provenance_is_untouched`
  正面钉住「卡上没有 lineage 键」）。#85／票 7 要用，得自己加一个 additive 投影 key，
  并**同步改那条判据**（它会红，那个红是对的）。

---

## 10 · 顺手发现、没顺手修

- 🔴 **0009 的 `want`/ADD 漂移此前无门**——已在本票封上（§7 M16b）。同族的其它守卫式迁移
  （只有 0009/0010 是这个形状）现在两条都有门了。
- ⚠ **`_absorb_person` 的并集 `[:6]` 会静默扔掉新条目**（不是本票造的，是 T5 就在的）。
  血缘让它**第一次可见**：截断发生时 `prev.value` 恰好等于当前值。要不要报给用户是产品问题。
- ⚠ **`lineage` 让 `test_the_LOSING_reading_and_its_source_vanish_without_trace_B2A` 的措辞
  变微妙**：输掉的**读数**与它的**出处行**（`本周周报.md:9`）确实仍然不在卡上（那条门原样全绿），
  但输家那份**文档名**（`本周周报.md`）从此在 `docs` 里。这是有意的（见 §3 `docs` 的定义），
  不是那条门漏判——但下一个读它的人可能会愣一下。
- ⚠ **`./init.sh` 会不带 api base 重打 dist** → `dist/` 现在指向生产域名。本 session 之后没跑任何
  上传型门/截图，但下一个人跑之前记得重打（progress.md 里那条老碑）。
