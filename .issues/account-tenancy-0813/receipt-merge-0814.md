# 回执 · 合并复验 #98 + #100 并入本地 main（2026-08-14）

> 本轮**零新开发**：两条早就做完、各自验过、都没合的线一起进本地 main，然后整批复验。
> 合并后 main = `4ff8bd0`。**未 push**（`origin/main` 仍停在 `2c74104`，main 领先 **40** 个提交）。
> 正源 `gh issue view 98` / `gh issue view 100`；两票各自的回执
> `.issues/rls-deny-all-0813/receipt-98.md`、`.issues/account-tenancy-0813/receipt-100.md`。

---

## 0 · 一句话

**两票咬同一张表（`avery.account_contexts`），而它们各自在自己的分支上从没见过对方**，所以两份旧回执
里的数字一个都不能直接引用。本轮把它们合成一棵树，在这棵树上重跑了五项电池 + 两条专门探针，
**全绿，零回归，零删除**。合并本身没有把 RLS 开到生产上（§2）。

## 1 · 合并动作

| # | 源分支 | 提交 | merge commit | 冲突 | 解法 |
|---|---|---|---|---|---|
| #98 | `claude/inspiring-chaum-48a5ee` | `d5c1812` + `ef1c52a` | `9e0f894` | `tests/test_registry_contract.py` | 两边都往文件末尾追加，取并集 |
| #100 | `claude/reverent-carson-06fdb1` | 最新 `c8ebe6b` | `4ff8bd0` | `progress.md` | 快照文件，按本轮口径重写头部 |

#98 自陈「落后三票」是真的：它的 base 是 `6fd0400`，此后 main 上 #99（`06f9e4c`）与 **#104**
（`2b2fce3`）都改过 `test_registry_contract.py`。**#104 正是 #98 顺手逮到的那个存量问题**（0002 的
`DROP CONSTRAINT IF EXISTS` 每次开机取 ACCESS EXCLUSIVE），它已经先一步进了 main 并把那条锁门
改写过 —— 冲突就出在这里，不是随机的行号漂移。

### 1.1 冲突解得对不对，有判据不是靠眼看

- **#98 那处**：解完之后 `git diff main -- <该文件>` 是**纯 +69 行、零删除**，与 #98 原始 diffstat
  （`69 +++++`）逐字对上；`ast.parse` 通过。
- **#100 那处**：`test_registry_contract.py` **自动合上了**（#98 的 EOF 追加与 #100 的中段改动不重叠），
  只有 `progress.md` 要手解。
- **合并树 = 两条分支的精确并集**：相对合并前 main 共 13 个文件、`test_registry_contract.py`
  **+313 行 = #100 的 244 + #98 的 69**。
- **迁移连号无空洞**：`0019_enable_rls.sql`（#98）+ `0020_account_contexts_multi_member.sql`（#100），
  号无重复。#100 主动让号那件事（receipt-100 §6.3）在合并树上兑现了。

## 2 · 🔴 合并 ≠ 生产已开 RLS

**本轮只动了本地 main，生产一个字节没变。**

- main 领先 `origin/main` **40** 个提交，**一个都没推**（本轮也不推 —— push 是对外闸，归 Danny）。
- RLS 真正落到生产，是**下次上产换镜像**时由 `_ensure_schema` 的迁移懒加载重放 0019 触发的；
  在那之前生产库仍是 `0/13 RLS off`。
- 所以 receipt-98 §「还差什么」里的第 3 条（**上产后 `/health` + 一次真实读写路径确认**）
  **仍然是活账**，本轮没有也不可能替它兑现。
- 同理 0020 的索引替换也要等那次重放才落到生产库上。

## 3 · 复验：两条专门探针（因为「两票各自验过」证明不了合并树）

两票都在自己分支上验过，但**都没见过对方**。合并树上真正的新问题只有一个形状：
0019 现在**插在 0008 与 0020 之间**重放，而三份迁移咬的是同一张表。

### 3.1 探针 A · 全量重放交互（`_MIGRATIONS_DIR` 原样，一次性库）

#100 的核心技巧是「替换索引沿用原名 → 0008 那句 `CREATE UNIQUE INDEX IF NOT EXISTS` 永久 no-op」。
RLS 加进来之后这个技巧仍须成立，票面要求在合并树上**真跑**、不许读代码推断。

| 臂 | 判据 | 结果 |
|---|---|---|
| 1 | 全新库 bootstrap 后 **0019 真的跑过**：13/13 表 RLS on、0 forced、0 policy | ✅ |
| 1 | 两票共同咬的 `account_contexts` 确实带 RLS | ✅ |
| 1 | 同名索引非唯一，且 **`context_id` 单列上不存在任何唯一索引** | ✅ |
| 2 | 真塞多成员数据（两行共用一个 `context_id`）—— 这是让 0008 炸掉的燃料 | ✅ |
| 3 | 带着这份数据**再重放两轮**：bootstrap 不炸 / 索引不变回唯一 / RLS 仍 on 不 forced / 两个成员仍读得到 | ✅ ×2 轮 |
| 4 | 🔴 **born-red 对照**：把同名索引撤掉再重放 | ✅ **如实炸出** `UniqueViolation: could not create unique index "account_contexts_context_key"` |

第 4 臂是这条探针的命门。**没有它，前三臂全绿也可能是尺子根本没量到东西** —— 它证明在合并树上
0008 那句话**确实每次开机都在跑、确实会重建 UNIQUE**，同名索引是唯一挡着它的东西。

> ⚠ 一个我自己造出来的假红，记下来免得下一个人重犯：探针第一版把 `account_contexts` 上**所有**索引
> 拿来比对，于是 `account_contexts_pkey`（`user_id, context_id`，本来就该唯一）和
> `account_contexts_user_idx` 把判据打红了。**尺子太宽会造出假红，和太松造出假绿一样坏。**
> 改成「同名索引必须非唯一 + `context_id` 单列上没有任何唯一索引」—— 这才是 0020 真正承诺的不变式。

### 3.2 探针 B · RLS 在**最弱身份**下仍然对后端零影响

🔴 本地 `postgres` 角色实查 `rolsuper=t, rolbypassrls=t`，**连 FORCE 都绕**。拿它验「开了 RLS 后端
读写不受影响」等于没验（receipt-98 §「后端零影响」自陈第一版就是这么假绿的）。本轮**先查身份再量**：
专建 `NOSUPERUSER NOBYPASSRLS` 的 owner 角色，并在测量前**断言这两个标志都是 false**。

而且这次比 #98 那轮多一件事：**0020 的多成员写路径（`link_account_context(allow_shared=True)`，
跑在 `FOR UPDATE` 行锁之下）在 #98 测量时根本不存在**，本轮把它放进了指纹里。

| 臂 | 内容 | 结果 |
|---|---|---|
| 0 | 跑测量的角色 `rolsuper=f, rolbypassrls=f` | ✅ 断言通过 |
| 1 | **对照组**：迁移目录里**物理删掉 0019** 后 bootstrap（＝生产今天的样子） | ✅ `0/13 RLS on` |
| 2 | **处理组**：合并树 0001→0020 全跑 | ✅ `13/13 RLS on` |
| — | 行数逐表相同 | ✅ `contexts 1 / entities 4 / materials 13 / memory_files 2 / account_contexts 2` |
| — | 回读投影相同且非空 | ✅ 4 张人卡 |
| — | **0020 多成员花名册相同** | ✅ 两人都在 |
| — | RAG 召回**文本**相同且非空 | ✅ `Studio_Handbook.md:9 :: Reassignment and a change of scope...` |
| — | delete 清理后两边都归零 | ✅ |
| 3 | 🔴 **born-red**：同一角色 + FORCE | ✅ **如实炸出** `InsufficientPrivilege: new row violates row-level security policy for table "contexts"` |
| 4 | 对照组**跑完之后**复查没被自愈污染 | ✅ 仍是 `0/13` |

第 3 臂就是 #98 第一版**该炸却没炸**的那一臂 —— 它在弱角色下炸了，说明这把尺子这次真的够到了 RLS。
第 4 臂挡的是另一个已知陷阱：`_ensure_schema()` 会重放 0019 把手工关掉的 RLS 治好，
所以对照组做成「0019 这份文件根本不存在」，并在全部跑完后复验它没变成第二个处理组。

> ⚠ 又一条自造假红：召回判据第一版用 `recall("prism")` 比 hit 数，两边都是 **0 vs 0** ——
> 相同但**空真**。改成落在**引到的那行文本**上（且必须真含语料里的词），才算判据。

## 4 · 五项电池（全部在合并树上重跑，不引用两份旧回执的数字）

| 项 | 基线 | 本轮 | 结论 |
|---|---|---|---|
| ① #100 第 8 步「重放两轮」门 | — | `test_upgrade_path_from_the_single_owner_schema` **1 passed**（14.9s，一次性库） | ✅ |
| ② 升级路径七步 + 第 8 步 | — | 同上（七步与第 8 步在同一条常驻门里） | ✅ |
| ③ 全仓 `-m needs_db` | main **146** | **153 passed · 0 failed**（875s，一次性库；首轮有一条环境 flake，见 §4.2） | ✅ |
| ④ 离线全仓 | main **4427 passed · 4 xfailed**（实测，见 §5） | **4434 passed · 0 failed · 4 xfailed**（134.5s） | ✅ |
| ⑤ `./init.sh` | 存量 6 warning | **exit=0**，`6 problems (0 errors, 6 warnings)` | ✅ |

⑤ 那 6 条 warning 与存量基线**逐字相同**，而且不可能不同：本轮
`git diff fc5680e..HEAD -- '*.ts' '*.tsx' '*.js' '*.css' '*.jsx'` 是**空的**，两票都只碰
Python / SQL / 文档。

③④ 都是**全仓**跑的，没有按文件挑（#95 那块碑）。③ 跑在**一次性库** `avery_merge0814`
（pg17，全新建、跑完即删），不是共享本机库；升级路径那条测试自己还会再从它上面
`CREATE DATABASE` 开一个更小的一次性库。

### 4.1 增量逐条对上（collect-only set-diff，零删除口径）

**离线：4431 → 4438 收集（+7，零删除）**，7 条全是 #100 的：

```
tests/test_login_isolation_10.py::test_a_third_account_gets_the_same_404_as_an_id_that_does_not_exist
tests/test_login_isolation_10.py::test_an_anonymous_context_is_reachable_by_no_account
tests/test_login_isolation_10.py::test_two_members_read_the_same_context_byte_for_byte
tests/test_registry_contract.py::test_a_context_carries_several_member_accounts[memory]
tests/test_registry_contract.py::test_an_anonymous_context_belongs_to_no_account[memory]
tests/test_registry_contract.py::test_claim_still_refuses_a_context_owned_by_someone_else[memory]
tests/test_registry_contract.py::test_sweep_keeps_a_clone_that_has_several_members[memory]
```

#98 对离线**零贡献**（它唯一那条判据带 `@needs_db`），符合预期。

**needs_db：146 → 153**（净 +7），逐条：

```
+ test_a_context_carries_several_member_accounts[postgres]      #100
+ test_an_anonymous_context_belongs_to_no_account[postgres]     #100
+ test_claim_still_refuses_a_context_owned_by_someone_else[postgres]  #100
+ test_sweep_keeps_a_clone_that_has_several_members[postgres]   #100
+ test_upgrade_path_from_the_single_owner_schema                #100
+ test_steady_state_bootstrap_takes_no_table_lock[entities]     #100（参数化后的两臂）
+ test_steady_state_bootstrap_takes_no_table_lock[account_contexts]
+ test_rls_enabled_on_every_avery_table                         #98
- test_steady_state_bootstrap_takes_no_entities_lock            #100 把它改名并参数化
```

### 4.2 needs_db 首轮那条红：环境，不是回归 —— 但没当场判成 flake

首轮 `-m needs_db` 是 **1 failed, 152 passed**（869s），红在
`test_source_documents_round_trip[postgres]`：

```
psycopg.OperationalError: connection failed: connection to server at "127.0.0.1", port 5432
failed: Address already in use (0x00002740/10048)
```

判成环境的依据是三条**互相独立**的，不是「单跑绿所以是 flake」（那句话本身不是判据）：

1. **报错在 TCP 层不在 SQL 层**：`WSAEADDRINUSE 10048` 是 Windows 临时端口耗尽，连接压根没建起来，
   不是任何一条 SQL 被拒。
2. **这条判据合并前 main 上就有**（在 §4.1 的 set-diff 里查过，不在本轮新增名单里），
   而且它测的是 `source_documents` 往返，与 RLS / `account_contexts` 一个字都不沾。
3. **换一个全新的一次性库整轮重跑：153 passed · 0 failed**。跑完 `netstat` 的 TIME_WAIT 是 1279，
   首轮跑完时是 988 —— 这一轮的连接压力只多不少，红却没有再现。

⚠ 顺带记给下一个人：这套 needs_db 全仓在本机是 **~870s**，比 receipt-98 记的 444s 长一倍
（判据从 143 涨到 153，且每条都开短连接）。**在 Windows 上它已经贴着临时端口上限跑**，
偶发 `10048` 要按环境读，别当回归；但也别反过来当橡皮图章 —— 判成环境要拿得出上面那三条。

🔴 那条 `-` **不是丢了判据**：#100 有意把「稳态开机不锁 `entities`」扩成「不锁**任何**热表」的
参数化门（receipt-100 §5.2），`[entities]` 那一臂就是原来那条。**净 +7 而不是 +8，原因在这里**，
不是有判据被合并吃掉了。这也正好落在票面预期上：main 146 → #100 单独 152 → 再加 #98 的 1 条 = 153。

## 5 · 🔴 票面给的离线基线 4265 是旧的，本轮实测订正为 4427

交办时给的基线是「main 实测 4265 passed / #100 单独 4272」。**4265 那个数字量的是更早的 main**
（#100 干活期间 main 停在 `b54e196` 一线），此后 **#97 又并进了 main**（`632a57d`），带来一批新判据。

本轮没有拿旧数字凑，也没有拿 `4438 收集 − 4 xfailed` 推算，而是**在合并前的 main（`fc5680e`）上
真跑了一遍**（我这条线的 worktree 正好停在那个提交上）：
**`4427 passed, 155 deselected, 4 xfailed in 129.59s`**。
于是本轮的真实增量是 **4427 → 4434 = +7**，与 §4.1 的 set-diff 逐条对得上。
若照抄 4265，会得出「+169」这种看着像回归/暴涨、实际什么也不是的数字。

**教训**：跨了别人几次合并之后，票面上的基线数字必须重量再用 —— `D:\avery` 会被并发线往前推
（receipt-100 §6.2 已记过一次，本轮又踩到一次，只是这次踩的是**基线**不是分支）。

## 6 · 本轮明确没做的事

1. **没有 push**，一个提交都没有。
2. **没给 0008 加 `-- SUPERSEDED BY 0020` 指针注释**（receipt-100 §3.3 / §7.2）—— Danny 还没答，
   票面红字要求本轮别动，照办。那句自陈的安全保证自 0020 起为假这件事**仍是活账**。
3. **没动生产**，见 §2。
4. 没有新开发、没有顺手重构、没有改任何一条既有判据的语义。

## 7 · 下一个人最该知道的三句

1. **两票各自验过 ≠ 合并树验过。** 它们咬同一张表却从没见过对方；合并树上唯一的新问题是
   0019 插进了 0008 与 0020 之间的重放链，那只能真跑（§3.1）。
2. **验「开了 X 不影响 Y」之前，先查跑 Y 的身份是不是本来就豁免 X，并取最弱的那个。**
   本地 `postgres` 是 rolsuper+bypassrls，连 FORCE 都绕（§3.2）。
3. **合并只是把代码放进 main，不是把 RLS 开到生产。** 生产要等下次换镜像由迁移懒加载重放（§2），
   在那之前 receipt-98 的「上产后确认」那条一直是活账。
