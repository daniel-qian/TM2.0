# receipt-104 — 0002 的裸 `DROP CONSTRAINT IF EXISTS` 每次开机取 ACCESS EXCLUSIVE

分支 `claude/fix-0002-entities-lock`（基于当前 main `06f9e4c`），**未合 main**。
issue [#104](https://github.com/daniel-qian/avery/issues/104)。发现于 #98（写 0019 时按 README 规矩 2
自查，顺手逐文件量了一遍锁）——所以回执放在同一个 `.issues/` 目录下。

## 病灶

```sql
ALTER TABLE avery.entities DROP CONSTRAINT IF EXISTS entities_person_no_scoring_keys;
```

**`IF EXISTS` 不会在加锁前先判断。** 这句话每次 bootstrap 都对 `avery.entities` 取一把
ACCESS EXCLUSIVE，哪怕那条约束早就退休、它一个东西都没删。而 `_ensure_schema` 每次 bootstrap
重放**每一个**迁移文件（README 规矩 1）→ **每次开机一把重锁，落在最热的那张表上**。

正是 2026-07-23 停摆的形状（orphaned idle-in-transaction 的 `/demo/claim` 占住 entities →
bootstrap 堵在后面 → `/demo/*` 500）。0724 加的 lock_timeout + retry 把「挂死」变成「快速失败」，
但开机照样失败。

## 规矩自己是假的

`migrations/README.md` 规矩 2 与 `pg_registry.py:147` docstring **都**声称稳态 bootstrap 对
entities 不取 ACCESS EXCLUSIVE，两处都只把 0009/0010 算作守卫、**漏了 0002**——因为
「删不掉东西的 DROP」看着无害。规矩从 0724 写下那天起就没成立过，三周后才被实测逮到。
两处已订正，并写明：**幂等 ≠ 不加重锁，规矩 1 绿了不等于规矩 2 绿了**。

## 改了什么

| 文件 | 内容 |
| --- | --- |
| `db/migrations/0002_person_keys_allowlist.sql` | 裸 DROP → `$mig$` 守卫式（头注释全保留，规矩 4 出处在里面） |
| `tests/test_registry_contract.py` | 新增 `test_steady_state_bootstrap_takes_no_entities_lock` |
| `avery/ingest/pg_registry.py` | docstring 订正 + 留下「这句话曾是假的」的自陈 |
| `db/migrations/README.md` | 规矩 2 补 0002 与守卫测试；规矩 5 补「幂等≠不加锁」 |

## 实测（一次性 pgvector:pg16 容器，口令 `dev`）

方法：另一 session 开 `BEGIN; SELECT count(*) FROM avery.entities;` 持住 ACCESS SHARE
（ACCESS EXCLUSIVE 与它冲突），再跑重放。**锁在每次测试前后各验一次仍握着**——否则「通过」
可能只是 blocker 提前松手了。

| 检查 | 结果 |
| --- | --- |
| 持锁跑整轮 `_ensure_schema()`，**修前** | `RuntimeError: could not lock the entities table`（born-red） |
| 持锁跑整轮 `_ensure_schema()`，**修后** | OK |
| 持锁逐文件重放，修前 | **只有 0002 BLOCKED**；0001、0003–0018 全 ok |
| 持锁逐文件重放，修后 | 全部 ok，无 BLOCKED |
| 守卫是不是死针（先手工把约束种回去） | `1 → 0`，约束真存在时照样删 |
| 全新库 boot1（0001:67 建约束 → 0002 删） | 退休约束 0；0009 allowlist 1、0010 kind_check 1，完好 |
| 同库 boot2 持锁 | OK —— 稳态确实无重锁 |
| 全仓 `-m needs_db`（不按文件挑） | **146 passed** |
| `test_registry_contract.py` 离线半边 | 49 passed |

⚠ 判据未使用任何 `created_at < now()` 形态，规避该容器 ~115s 时钟跳变导致的间歇假红。

## 新增守卫的变异（两条判据各配专属变异）

| 变异 | 打中的判据 | 结果 |
| --- | --- | --- |
| 还原成未修的裸 0002 | 主判据（`_ensure_schema()` 完成） | 🔴 红，RuntimeError |
| blocker 改 `autocommit=True`（不持锁） | 「锁根本没拿到，这轮没被竞争」 | 🔴 红 |

第二条是**防空真**的：没有它，blocker 万一提前松手，这个测试会对着一轮**从未被竞争过**的
bootstrap 报成功。写 #98 时就在同一个坑上栽过一次（pg_sleep 到期、锁没了却差点把「没锁」当结论），
所以这次把「锁还在」做成了判据本身。

born-red 用的是**手工复制文件改回去**，不是 `git stash`——stash 是仓库全局的，别的并发线会遭殃。

## 还差什么

**合 main 留给 Danny 点头。** 理由与 #98 同源：迁移进 main → 下次部署 `_ensure_schema` 重放到生产。

但风险面比 #98 小得多，值得说清：

- **不改任何 schema**。生产里 `entities_person_no_scoring_keys` 本来就不存在（0001 建、0002 删，
  早就删掉了），守卫版在生产上是**彻底的 no-op**。
- 唯一的生产变化是**少拿一把每次开机白拿的 ACCESS EXCLUSIVE 锁**，严格更安全。
- 回滚 = 把那段 `DO $mig$` 换回一行裸 DROP，无数据变更。
