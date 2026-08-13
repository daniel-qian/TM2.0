# receipt-98 — avery schema 全表 ENABLE ROW LEVEL SECURITY（deny-all 防御纵深）

分支 `claude/inspiring-chaum-48a5ee`，**未合 main、未动生产**。状态：等 Danny 点头。

🔴 为什么不能顺手合 main：迁移文件一旦进 main，下次构建部署后 `_ensure_schema` 会在首次访问
registry 时自动重放到生产——等于绕过人工闸把生产改了。合并动作本身就是上产动作。

## 改了什么

| 文件 | 内容 |
| --- | --- |
| `eval-harness/db/migrations/0019_enable_rls.sql` | 新增。按 catalog 遍历 avery schema 开 RLS，无 policy、无 FORCE |
| `eval-harness/tests/test_registry_contract.py` | 新增 `test_rls_enabled_on_every_avery_table`（`@needs_db`） |

## 票面两处与实查不符

1. **12 张表 → 实为 13 张。** 票面清单写于 0018 之前，漏了 `avery.ingest_jobs`（#90 加的）。
   照抄票面会让这张表裸奔。0019 因此不写死表名，改为从 `pg_class` 遍历——手写清单等于
   「同一份真相的两份抄本」，正是 migrations/README 规矩 3 反复警告的漂移源。

2. **票面写「12 条 `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`」，这个写法不能用。**
   实测（pg16 一次性库）：`ALTER TABLE ... ENABLE ROW LEVEL SECURITY` **即使 RLS 已经是开的**
   仍然取 ACCESS EXCLUSIVE 锁，不会提前短路。而 `_ensure_schema` 每次 bootstrap 重放**每一个**
   迁移文件（README 规矩 1）——裸写法＝每次开机都对 `entities` 抢一次 ACCESS EXCLUSIVE，正是
   2026-07-23 停摆的形状，README 规矩 2 明令禁止。

   对照实验（另一 session 持 ACCESS SHARE，`lock_timeout=3000`，锁在测试前后都验过还握着）：

   | 写法 | 结果 |
   | --- | --- |
   | 裸 `ALTER ... ENABLE`（表上 RLS 已开） | `ERROR: canceling statement due to lock timeout` |
   | 守卫式（`NOT relrowsecurity` 才 ALTER） | 通过——走不到锁那一步，只是一次 catalog 查表 |

   守卫不是死针：在 RLS 未开的表上实测 `relrowsecurity` `f → t`，该开的照样开。

## 顺手逮到的存量问题（不在本票范围，已另开卡）

`0002_person_keys_allowlist.sql` 结尾的 `ALTER TABLE avery.entities DROP CONSTRAINT IF EXISTS ...`
**同样每次 bootstrap 取 ACCESS EXCLUSIVE**（`DROP ... IF EXISTS` 也不提前短路）。

逐文件实测（持 entities ACCESS SHARE，每个迁移单独跑）：**0002 是唯一一个 BLOCKED**，
0001 与 0003–0019 全部 ok。也就是说 `pg_registry.py:147` 的 docstring 与 README 规矩 2 声称的
「稳态 bootstrap 对 entities 不取 ACCESS EXCLUSIVE」**目前是假的**，病灶在 0002 不在本票。

对照实验确认与本票无关：把 0019 移走再跑，同样红；放回去跑，还是同样的红。

## 后端零影响——实测，不是读代码论证

⚠ **第一版实验是假绿，必须记下来**：本地容器的 `postgres` 角色是 `rolsuper=t, rolbypassrls=t`，
无条件绕过 RLS（连 FORCE 都绕）。用它跑出来的三个库指纹完全一致——**但 FORCE 那一臂本该炸却没炸**，
说明尺子根本没量到东西。改用 `avery_owner`（`NOSUPERUSER NOBYPASSRLS`，且拥有全部 avery 表）重做。
选最弱的角色是刻意的：弱角色上成立，更强的角色必然成立。

另一个自己造出来的假绿：探针跑 `_ensure_schema()` 会重放 0019，把我手工关掉的 RLS 又打开了——
所谓「对照组」其实也是 RLS 开着的。真对照组改成**把 0019 移走后 bootstrap 的库**（＝生产今天的状态），
并在探针跑完后复验它仍是 `0 on / 13 tables`，确认没被污染。

驱动的是真 pipeline（`ingest_paths`：parse → extract → 红线闸 → store → put），随后新建 registry
回读、再 delete。三个库除 RLS 标志外完全同构：

| 库 | RLS | write | 回读 | 行数 contexts/entities/materials/memory_files | delete |
| --- | --- | --- | --- | --- | --- |
| `avery_ctl2`（0001–0018，无 0019） | 0/13 | ok | 命中 `prism` | 1 / 4 / 13 / 2 | 干净 |
| `avery_rls`（0001–0019） | 13/13 | ok | 命中 `prism` | 1 / 4 / 13 / 2 | 干净 |
| `avery_force`（0019 + FORCE） | 13/13 + force | **炸** | — | — | — |

- 前两行**逐字段一致** → 开 RLS 后端行为不变。
- 第三行是 born-red 对照，证明这把尺子真的量到了 RLS：
  `InsufficientPrivilege: new row violates row-level security policy for table "contexts"`。
  这就是 0019 里那条「🔴 永远不要加 FORCE」的实测依据——FORCE 会把 deny-all 对准后端自己。

## deny-all 确实买到了东西（反向实测）

`avery_stranger`：非 owner、`NOBYPASSRLS`，但**故意**给了 avery schema 的 USAGE + 全表增删改查
——模拟「哪天误 `GRANT` 一下」。

| 操作 | RLS 关（今天的生产） | RLS 开（0019 之后） |
| --- | --- | --- |
| SELECT | **1（读到了）** | 0 |
| INSERT | 成功 | `ERROR: violates row-level security policy` |
| UPDATE | **改掉 2 行** | 0 行 |
| DELETE | **删掉 2 行** | 0 行 |
| owner 事后还剩 | **0 行（数据被外人删光）** | 1 行（完好） |

## anon / authenticated 零影响（票面第 4 项反证）

本地建 `anon_like`（无 avery schema USAGE），对 RLS 关 / 开两个库结果**完全一致**：

```
has_schema_privilege(anon_like,'avery','USAGE') = f      （两边都是 f）
SELECT avery.contexts → ERROR: permission denied for schema avery
INSERT avery.contexts → ERROR: permission denied for schema avery
```

机制上先被 schema 门挡住，RLS 根本轮不到出场 → 开 RLS 对它们是纯 no-op。

⚠ 生产侧的 `has_schema_privilege` 实查数字来自票面（0813 记录），本 session **没有** Supabase MCP
工具，无法重新实查生产复核——上面是机制层面的本地兑现，不是对生产的重新测量。

## 迁移路径

| 路径 | 结果 |
| --- | --- |
| 升级（已有 0001–0018 的库加 0019） | 13/13 开，0 forced，0 policy |
| 全新库（0001→0019 从零） | 13/13 开，0 forced，0 policy |
| 同库再 bootstrap 一次（幂等） | 同上，无变化 |
| 持 entities 锁时重放 0019 | ok（唯一 BLOCKED 的是存量的 0002） |

## 守卫测试与变异

`test_rls_enabled_on_every_avery_table`，四条判据各配专属变异（一条变异红一条判据 ≠ 能红旁边那条）：

| 变异 | 判据 | 结果 |
| --- | --- | --- |
| 某表 FORCE | `forced` | 🔴 红，点名 `asks` |
| 某表加 policy | `policied` | 🔴 红，点名 `asks` |
| 全新库 + 假 0020 建表（真实漂移场景） | `no_rls` | 🔴 红，点名 `drift_probe` |
| 手工关掉某表 RLS | `no_rls` | ⚠ **绿**——见下 |

最后一行是真实局限，已写进 docstring 自陈：测试自己会先跑 `_ensure_schema()` 重放 0019，把手工关掉的
表又治好了。同一个假 0020 在**第二次** bootstrap 同库时也会变绿（0019 重放补上了）。所以这条判据
的牙齿在**首次 bootstrap**（CI 与新环境正是这条路），长命库上够不着。行数下限（≥13）是防空真的
兜底：其余三条都是「没有行违反 X」，空结果集会让它们同时假绿。

## 全仓 needs_db

```
python -m pytest -m needs_db -q     →  143 passed, 4230 deselected in 444s
```

按 #90 教训跑的是**全仓**不是按文件挑。库为一次性 pgvector:pg16 容器（口令 `dev`）。
判据未使用任何 `created_at < now()` 形态，规避该容器 ~115s 时钟跳变导致的间歇假红。

## 还差什么

1. **Danny 点头**（唯一人工闸：动生产库）。
2. 合 main —— 合并即上产，见顶部红字。
3. 上产后 `/health` + 一次真实读写路径确认。
4. 回滚：`ALTER TABLE avery.<t> DISABLE ROW LEVEL SECURITY` ×13，无数据变更，随时可逆。
