发现于 #105 的上产预检（回执 `.issues/deploy-0817/receipt-105.md` §4-③）。**不拦上产**——生产已经这样开机好几个月了，见下面的对照实验。

## 病灶

`#104` 修好了 `0002` 的裸 `DROP CONSTRAINT IF EXISTS`，但**同一个 bug class 还有两个漏网的**：

| 文件 | 语句形状 | 每次开机锁住 |
|---|---|---|
| `0005_source_documents_status.sql` | 裸 `ALTER TABLE ... ` | `avery.source_documents` |
| `0011_contexts_ephemeral_gc.sql` | 裸 `ALTER TABLE ... ` | `avery.contexts` |
| `0017_source_documents_content_sha256.sql` | `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` | `avery.source_documents` |

`ALTER TABLE` 在判断 `IF NOT EXISTS` / `IF EXISTS` **之前**就取 ACCESS EXCLUSIVE，所以「什么都没改」的那 99.99% 次开机照样抢一把排他锁——正是 2026-07-23 停摆的形状（orphaned idle-in-transaction 占住表 → bootstrap 堵在后面 → 500）。而 `avery.contexts` 是**每一次授权读**都要碰的表。

## 实测（2026-08-17，生产机上的一次性 pgvector:pg17 预检库）

方法照 #104：另一连接持 `avery.<表>` 的 ACCESS SHARE，`AVERY_BOOTSTRAP_LOCK_TIMEOUT_MS=3000`、`AVERY_BOOTSTRAP_RETRIES=1`，锁在每次测试**前后各验一次**仍握着。

| 被占住的表 | 新镜像（0001..0020）稳态 bootstrap |
|---|---|
| `entities` | PASS 0.47s |
| `account_contexts` | PASS 0.46s |
| `materials` | PASS 0.46s |
| `contexts` | 🔴 **BLOCKED 3.35s** |
| `source_documents` | 🔴 **BLOCKED 3.29s** |
| `entities` / **旧**镜像（born-red 对照） | BLOCKED 3.26s |

逐文件重放定位到的元凶就是上表那三个文件；`entities` 一个文件都不再 BLOCKED（#104 的修生效）。

**为什么不拦上产**：对照实验里，**现在正在生产跑的那个镜像**（`main-20260812-070519`，只含 0001..0016）对着 `contexts` 与 `source_documents` **同样 BLOCKED**。也就是说这两张表从来就没被守卫过，不是这批引入的。这批唯一的变化是 0017 在**已经被 0005 锁着的同一张表**上多取一次锁，不新增受影响的表。

## 为什么一直看不见

常驻门 `tests/test_registry_contract.py::test_steady_state_bootstrap_takes_no_table_lock` 只参数化了 **`entities`** 与 **`account_contexts`** 两张手写的表。另外 10 张从来没被量过——**判据够不着，不是判据写错**。

`pg_registry.py:_ensure_schema` 的 docstring 与 `db/migrations/README.md` 规矩 2 现在声称的是「稳态 bootstrap 不取 ACCESS EXCLUSIVE」，这句话**目前仍是假的**（#104 只把它从「对 entities 假」修成「对 entities 真、对另外两张仍假」）。

## 建议的修法

1. `0005` / `0011` / `0017` 的 `ALTER TABLE` 改成 catalog 守卫式（形状照 `0002` 修后 / `0009` / `0010`：先查 `pg_attribute` / `pg_constraint`，真缺才 ALTER）。
2. 🔴 **把常驻门从手写表名改成按 catalog 遍历 avery 全表参数化**——手写清单就是「同一份真相的两份抄本」（`0019` 头注释里那条 README 规矩 3 的现场），今天漏的这两张正是这么漏的。改完这道门会**当场变红**，先红后修。
3. 顺带订正 `pg_registry.py` 的 docstring 与 `README.md` 规矩 2（两处都还在声称一件不成立的事）。

## 一个诊断陷阱，值得单独记

旧镜像的报错信息**写死了** `could not lock the entities table`，哪怕真正卡住的是 `contexts`——上面两次控制实验的报错都是这句。#100 已经把它改成不点名（真表名在链上的 psycopg 异常里）。**按旧日志的字面去查 entities，会查错方向。**
