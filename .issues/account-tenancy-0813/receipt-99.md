# 回执 · #99 抽取期间不持有档案：同一份档案的丢失更新

> 2026-08-14（UTC 08-13 深夜）· 分支 `main`（未 push）· 正源 `gh issue view 99`
> 病灶与四条「为什么至今没人发现」的证据：`.issues/account-tenancy-0813/exploration.md` §4

---

## 0 · 一句话

补传原本「`get()` 整档 → 抽取两三分钟 → `put()` 整档覆盖」，而 `avery.contexts` 没有版本列 ——
这两三分钟里落地的任何手编改动会被静默抹掉。**主修已上：`get()` 挪到抽取之后，窗口从两三分钟
缩到几毫秒。** 第二层（版本号 + CAS）Danny 拍板本票不做，已开 **#102** 记账，代码注释里写明了
「为什么只修了一半」。

---

## 1 · 改了什么（五个文件）

| 文件 | 改动 |
|---|---|
| `avery/ingest/file_append.py` | **主修**：`append_docs_to_context` 的顺序从「`get()` → 抽取 → `put()`」改成「窄读 key 集合 → 抽取 → `get()` → 归并 → `put()`」；模块头新增**命门④**、「为什么只修了一半」、「为什么首传路不在本票范围」三节 |
| `avery/ingest/registry.py` | 新增 `ContextRegistry.source_document_keys()` + 同名 Protocol 成员 |
| `avery/ingest/pg_registry.py` | 新增 `PostgresContextRegistry.source_document_keys()`（一句 SQL，只打 `source_documents` 一张表） |
| `service/ingest_worker.py` | `_execute_ingest` 头上一段注释：首传路为什么**故意**没跟着改 |
| `tests/test_file_append_t10.py` · `tests/test_registry_contract.py` | 新判据（见 §3） |

### 1.1 为什么是「窄读一个集合」而不是「`get()` 两次」

抽取那一段其实只需要**一个东西**：已占用的 `source_key` 集合（判「这份 key 库里是不是已经有
了」，决定哪几份文件值得花钱去读）。两个理由让它值得单独长一个方法，而不是把 `get()` 调两次：

1. **结构上拿不住**。`get()` 调两次的写法，下一个人完全可能顺手「优化」成复用第一份快照 ——
   那就是把 bug 原样装回去。窄读**没有档案可复用**。
2. **真的便宜**。`get()` 会拉全部实体、全部 material 块、两份 memory 文件，还会把
   `facts.md`/`notes.md` 重新物化到磁盘上；窄读是对一张表的一句 `SELECT`。

🔴 `None`（context 不存在）与**空集合**（存在但没有文档）**不许混**：混了就是把「档案没了」
翻译成「档案是空的」，补传会照着往一个不存在的 id 上写。两条腿都钉了判据。

### 1.2 位次一个都没动

`ctx` 之后的每一步 —— 挂清单 → 归并 → `rejudge_after_append`（#93）→ 整体红线硬门 →
`materialize_memory` → `put()` —— **相对位次一律未动**。`put()` 的快照替换语义未动。
#90 的四段计时口径未动（`persist` 仍是 materialize + put）；那次 `get()` 从「extract 段之前」
挪到「extract 段与 merge 段之间」，两处都在四段之外，所以四段数字仍然可比 —— 已写进注释。

---

## 2 · 🔴 没有用「抽取期间禁掉编辑」

票面红线，照办了，理由也写进了代码注释：共用登录 / 多设备下另一台浏览器根本不知道有人在传，
前端结构上挡不住（全仓只有 `UploadPanel.tsx` / `OnboardGate.tsx` 两处看 `ingesting`，卡片编辑
按钮绑的是它自己的 `projectWriteBusy`）。这是后端问题，在后端解了。

---

## 3 · born-red 实录（逐字对照）

判据：`tests/test_file_append_t10.py::test_a_hand_edit_that_lands_DURING_extraction_is_not_swallowed_by_the_write_back`（`@needs_db`）

注入点是**抽取器自己**（`_EditsWhileExtracting`）：它在被调用的那一刻替经理走真手编通道
（`reg.patch_project` → 他自己的 get→改→put）。用抽取器当注入点不是取巧 ——
`extract_docs(fresh_docs, extractor=extractor)` **就是**那一段慢活，从它里面落地的写与真实世界里
「经理等得无聊顺手改了一张卡」发生在**完全相同的窗口**里，而且没有墙上时钟赌注（钟碑）。

**在未修代码上真的丢**（`avery_t99_dev` 一次性库实测）：

```
E   AssertionError: issue #99 的丢失更新：worker 起跑前 负责人=周雅婷
E   → 抽取进行中经理改成 负责人=李静娴（真的落进库里了）
E   → worker 写回后 负责人=周雅婷 —— 那两三分钟里的手编被整档覆盖静默抹掉了
E   assert '周雅婷' == '李静娴'
```

**三条防空真的措施**（覆盖类判据天生空真）：

1. **动作前的基准**：先断言 `before.ownerName == 周雅婷`，基准不成立就当场失败并说清楚
   「下面那条什么都证明不了」。
2. **动作真的发生了**：`probe.fired == 1` —— 那一刀到底有没有开过枪。
3. **对照组**：同一条判据里还有一个补传**之前**就落地的手编（`summary`）。它在 worker 读到的
   快照里，活下来是必然的。两个一起断言 ⇒「没活下来」只可能是**时序**，不可能是归并规则。

**归并规则这条路先堵死了**（否则测的就不是这个 bug）：`ownerName` 虽然在
`_APPEND_REFRESHABLE['project']` 里，但 `AppendLedger.outranks()` 对 `origin == 'manual'` 的格子
恒返回 `False`（手编赢）。所以补传后负责人变回旧值**只有一个成因**：写回用了抽取之前那份快照。

### 3.1 另外两条新判据

| 判据 | 层 | 钉什么 |
|---|---|---|
| `test_the_append_still_refuses_a_context_that_vanished_mid_extraction` | `@needs_db` | 抽取跑完回来一看档案已经被删了 → 与「一开始就不存在」同一条 `KeyError`（端点转同体 404），不把这批文件写进一个不存在的档案。带「删之前它确实还在」的基准 |
| `test_source_document_keys_answers_without_pulling_the_archive` | **共享合约**（内存腿离线跑 / pg 腿 `@needs_db`） | 不存在→`None`、存在但没文档→空集合、有文档→就是那几个 key。**期望值不由被测函数算出来**：`literal` 是测试侧手写的常量，`existing_source_keys(get(...))` 是另一条独立的路（修改之前用的就是它），三份必须同时相等 |

---

## 4 · 变异实录

跑器 `scratchpad/mutate-99.py`。变异 = **把 `get()` 挪回抽取之前**（就是修之前那个形状）：
拿掉抽取之后那次拍照，在窄读头上把整档快照攥住。

```
original sha256 = 34312120d02ed2fa177af7f6e251cc7671351e8e4a1ce48dc31ad9b1921d4bc3
file EOL = '\r\n'
anchor late-get: 1 hit(s)
anchor early-narrow-read: 1 hit(s)
[target criterion]  1 failed          ← 目标判据红了
[control criterion] 1 passed          ← 对照（补传之前的手编）保持绿
restored sha256 = 34312120d02ed2fa177af7f6e251cc7671351e8e4a1ce48dc31ad9b1921d4bc3
restore verified byte-identical
VERDICT: OK — 变异被逮住，且只红了目标那一条
```

（这份是**最终字节**上的复跑。第一次跑在注释改动之前，sha 是 `2c28ea87…`；两次结论相同。）

**跑器自己差点撒谎，如实记账**：第一版锚点写的是 `\n`，而本仓这份文件是 **CRLF** ——
`late-get: 0 hit(s)`。0 命中长得跟「变异存活」一模一样（碑 `verifiers-that-lie`）。
是那条「锚点必须恰好命中 1 次，否则当场 abort」的自检把它拦下来的，不是我眼尖。
修法是**只翻译锚点、文件字节一个不动**（还原写的是原始 bytes，sha256 前后逐字相等）。

---

## 5 · 第二层：Danny 拍板不做（#102 记账）

票面 §6 待拍项已问、已拍：**不做，只修主修**。理由（问的时候摆出来的，此处存档）：

* CAS 要动迁移、要给 `CompanyContext` 加**顶层字段** —— 0009 那个老坑（加字段漏改迁移 =
  每条写入被真库拒而离线一条不红）；
* `put()` 是全仓最高频的写路径（手编 CRUD 八个写法全经它），回归面比主修大一个量级；
* 「对不上就重读重并」对快照替换语义**做不到自动重并**，现实里只能是「当场 409」——
  那是个要单独拍的产品语义。

🔴 **代码注释里写明了「为什么只修了一半」**（`file_append.py` 模块头一整节），并且明写了那句
最容易被忘掉的话：**几毫秒不是零** —— `get()` 与 `put()` 之间那几毫秒里落地的手编改动照样会
被吞掉，而且没有任何东西会报错。同一节还留了一条给下一个人的警告：**谁在这里加一段慢活，就是
在把窗口重新拉长，而今天没有任何一道门会告诉他**（新判据钉的是「抽取期间」这一个位置，不是
「`get()` 与 `put()` 之间的任何位置」）。

**#102** 已开：https://github.com/daniel-qian/avery/issues/102 —— 带三个已知的坑与两个待拍项。

---

## 6 · 首传路为什么没动（票面要求写明，别当成漏了）

`_execute_ingest`（首传）是**同一个后果、不同的机制**：`pipeline.ingest_docs` 在抽取之前
**根本不读档案** —— 它铸一份全新的 `CompanyContext` 拿去 `put`（覆盖语义，命门①），
所以那里没有「攥着旧快照」这件事可挪，真要修是把首传也改成归并，那是另一张票。
**暴露面近零**才是它今天可以不修的理由：`POST /ingest` 恒新建 context，首传那两三分钟里屏幕上
一张卡都还没有。已写进 `ingest_worker.py::_execute_ingest` 头上和 `file_append.py` 模块头。

---

## 7 · 验证账

| 项 | 结果 |
|---|---|
| 离线全仓（`TZ=UTC`，cwd = `eval-harness`） | **4218 passed · 0 failed**（基线 4217 + 新增 1 条离线合约判据；154 deselected） |
| `-m needs_db` **全仓**（一次性库 `avery_t99_test`，不按文件挑） | 见 §7.1 |
| `./init.sh`（lint + typecheck + build） | **绿** |
| born-red | 未修代码上目标判据**真的红**，逐字对照见 §3 |
| 变异「`get()` 挪回抽取之前」 | 锚点各命中 **1** 次 · 目标红 · 对照绿 · 还原后 sha256 逐字相等 |

### 7.1 真库套

口径：**全仓 `-m needs_db`，不按文件挑**（#95 的碑）。跑了两轮：

| 轮 | 一次性库 | 结果 |
|---|---|---|
| ① 主轮 | `avery_t99_test` | **145 passed · 0 failed**（4231 deselected，808s） |
| ② 最终字节复跑 | `avery_t99_final` | **145 passed · 0 failed**（4231 deselected，753s） |

**145 = 基线 142 + 本票新增 3**（t10 两条 + 合约套 pg 腿一条），与 #93/#95 的 142 对得上。

之所以跑两轮：主轮跑完之后我又落了三处**非执行**改动（两处 docstring、一处注释，都是把一个
写错的测试名改对 + 措辞），字节变了。#95 的碑说回执里只许写全仓的数字，那这个数字就得是
**跟提交出去的字节对应的那一次**跑出来的，所以重跑了一轮。

第二轮的命令（此后跑电池的标准姿势：`cd` 写进同一条，四个 marker 显式写在命令行上，见 §7.2）：

```bash
cd /d/avery/eval-harness && AVERY_DB_URL="postgresql://postgres:dev@127.0.0.1:5432/avery_t99_final?channel_binding=disable" TZ=UTC python -m pytest -q -m "needs_db and not smoke and not seedgate and not needs_keys"
```

### 7.2 🔴🔴 我在收尾时踩了「仓库根跑裸 pytest」，**真花了钱**，如实记账

复跑离线全仓时我发了一条裸的 `python -m pytest -q`，**没有把 `cd` 写进同一条命令**。
Bash 工具的 cwd **在两轮之间被重置回了会话的 primary working directory** —— 本会话那是
**`D:\avery-wt-happy-pascal-a36ee3`（worktree 根）**，不是 `D:\avery\eval-harness`。
worktree 根同样没有 `pytest.ini`，于是离线兜底那行 `addopts` 整个失效，**4372 条全被选上**，
其中 9 条是 `smoke`/`seedgate`/`needs_keys` 的花钱判据。

**花的是什么**：第一个在射程内的花钱判据是
`tests/test_extraction_prompt_coinage_b1.py::test_english_teams_are_canonical_on_the_real_model`
（收集顺序 **827/4372 ≈ 18.9%**）。它自己 docstring 写着 `_RUNS = 3`、**每次真 MiniMax-M3
调用约 3.5 分钟**。我在约 10 分钟处 kill 掉，进度停在 18–19%。
👉 **结论：约 2–3 次真 MiniMax-M3 抽取调用**（对着 `PrismDesign_TeamProfile_EN.xlsx` 一份 xlsx）。

**没花的**（这部分是硬边界，不是安慰）：其余 8 条花钱判据全在 **92% 之后**
（test_seed_gate 6 条 / semantic-recall 的真 dashscope embedding / service smoke），
进度连 19% 都没到，**一条都没够着**。`netstat` 复核：`:8137` / `:8250` 无监听，
seedgate 那个自己 spawn uvicorn 的 fixture 从没起来过；无 `/advise`、无 dashscope 向量。

**为什么既有的碑没拦住我**：那条碑写的招牌症状是「结尾那行写 `skipped` 而非 `deselected`」——
**它要求跑完**。而这次最贵的那条判据会在 19% 处卡十分钟以上，我**永远等不到那行**。
唯一及时的症状是**墙上时钟**：离线全仓正确姿势是 4218 条 / 约 130 秒（≈32 条/秒），
跑到 10 分钟还没完就已经在烧了。已把这两点（cwd 跨轮次重置 + 墙上时钟才是及时症状）
补进 `memory/pytest-cwd-repo-root-burns-money.md`。

**改法**：此后每一条跑电池的命令都把 `cd` 写在同一条里，并且把四个 marker 显式写在命令行上
（显式 `-m` 在哪个 cwd 都生效）——本回执 §7.1 第二轮用的就是这个姿势。

### 7.3 途中逮到一条**与本票无关**的离线红，如实记账

第一次跑离线全仓（不带 `TZ=UTC`）时 `tests/test_decision_grading.py::
test_a_freshly_claimed_sample_team_is_not_told_its_material_is_stale` 红了：

```
assert _uploaded_day(twin.source_documents[0].uploaded_at) == date.today()
```

`clone_context` 打的 `uploaded_at` 是 **UTC**，而 `date.today()` 是**本机时区**。本机 UTC+8，
当时本地 `2026-08-14 00:14`、UTC 还是 `2026-08-13 16:14` —— 差一天，判据必红。

* **证伪它属于本票**：`TZ=UTC` 下单跑**通过**；本票一个字节都没碰 `clone_context` /
  `_uploaded_day` / `decision_grading`；本轮开工前的基线（本地时间还在 08-13 白天）是 4217/0。
* **它是一颗每天定时炸弹**：本机时区下 **每天 00:00–08:00 之间必红**（一天里三分之一的时间）。
  产品侧无害（差一天不足以触发 45 天的 `R-STALE-EVIDENCE`），坏的是**判据**本身在赌墙上时钟。
* 没有顺手改（不在本票范围，且改它要决定「以哪个时区为准」）。**已单独记在 §8。**
* 因此本回执里的离线数字**一律是 `TZ=UTC` 下跑的**，且已落碑
  （`memory/offline-suite-false-red-local-midnight.md`）。

---

## 8 · 仍然留在台面上的

0. 🔴🔴 **我在本票收尾时真花了钱**（约 2–3 次 MiniMax-M3 调用），成因与防法见 §7.2。
   不是回归、不影响任何判据的有效性，但是**真金白银**，摆在最前面而不是埋在验证账里。
1. 🔴 **几毫秒的窗口还在** —— 第二层 **#102**，见 §5。
2. 🟠 **`test_a_freshly_claimed_sample_team_is_not_told_its_material_is_stale` 是时区炸弹**
   （§7.2）：本机 UTC+8 下每天 00:00–08:00 必红。判据在赌墙上时钟，该改成拿 UTC 日期比，
   或者让 `decision_grading` 的 `as_of` 与 `uploaded_at` 用同一个时区。**没开票**（本票范围外，
   留在这里等 Danny 决定要不要单开）。
3. ⚠ **本轮工作树是脏的、而且不是我弄脏的**：`D:\avery` 里同时有另一条线在做 **#101**
   （`src/lite2/auth/AuthPanel.tsx` / `authStore.ts` / `tools/verify-auth-form.mjs` /
   `receipt-94.md` / `scripts/ops/` 等）。本票**只提交自己那几个文件**，一个字都没碰他们的。
   ⚠ 由此，`./init.sh` 那个绿覆盖的是**混合树**（lint/typecheck/build 一起过了他们在飞的前端
   改动），不是一棵只有本票改动的树。
4. ⚠ **`dist/` 被 `./init.sh` 重打过**（`npm run build`）。下一个人跑任何上传型门或截图前，
   照既有纪律先重打带自己 `VITE_AVERY_API_BASE` 的 dist，并在浏览器里验 `apiBase`。
5. 一次性库 `avery_t99_dev` / `avery_t99_test` 用完即删（见 §9）。

---

## 9 · 收尾

* 一次性库：`avery_t99_dev`、`avery_t99_test` 已 `DROP DATABASE`。
* 🔴 **未 push**（push = 前端自动上产，统一上产窗口等 Danny 拍）。
