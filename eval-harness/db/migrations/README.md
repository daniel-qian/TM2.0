# migrations 契约

这四条规矩此前散落在 0002/0009/0010/0011 的内联注释与 pg_registry.py 里，各写各的、互相不指。本文件是收编后的权威版——内联注释保留不删（它们贴着具体 DDL，是各自的第一手证据），这里只做汇总入口。

## 1. 全量重放幂等

bootstrap 按文件名排序重放**每一个** migration 文件（不是只跑增量），所以每条 DDL 必须写成 `CREATE ... IF NOT EXISTS` / `DROP ... IF EXISTS` + `ADD` 这种形态，永久可重跑。写成一次性语句，第二次 bootstrap 就会因为对象已存在而炸。

出处：`eval-harness/avery/ingest/pg_registry.py:132-135`（`_ensure_schema` docstring）。

## 2. 稳态禁 ACCESS EXCLUSIVE

稳态 bootstrap 对 `entities` 表不得取 ACCESS EXCLUSIVE 锁——0002 的 `DROP CONSTRAINT` 与 0009/0010 的 `ADD CONSTRAINT` 都做成「已存在/不存在就跳过」的守卫写法，正常 boot 只是一次 catalog 查表，不是真的重新校验+加锁。

出处：`eval-harness/avery/ingest/pg_registry.py:147`。守卫：`test_steady_state_bootstrap_takes_no_entities_lock`（`eval-harness/tests/test_registry_contract.py`）——真持一把 ACCESS SHARE 锁再跑整轮重放，不是读代码论证。

⚠ **这条规矩从写下那天起就没成立过，三周后（0724 → 2026-08-13）才被实测逮到**：当时只把 0009/0010 算作守卫，而 0002 结尾是裸的 `ALTER TABLE avery.entities DROP CONSTRAINT IF EXISTS ...`。**`IF EXISTS` 不会在加锁前先判断**——它照样取 ACCESS EXCLUSIVE，哪怕那条约束早就退休、这句话一个东西都没删。逐文件对着一把持住的 ACCESS SHARE 锁重放，**只有 0002 挂**。教训：**「删不掉东西的 DROP」不是免费语句**，`IF EXISTS` / `IF NOT EXISTS` 只保证不报错，不保证不加锁。写守卫看的是「会不会取重锁」，不是「会不会报错」。

反面教材，2026-07-23 停摆：一个被 kill 掉的 claim curl 留下 idle-in-transaction 连接，卡住 entities 锁；未加守卫的 `ADD CONSTRAINT` 想拿 ACCESS EXCLUSIVE，等到 statement_timeout 才 QueryCanceled，整个 `/demo/*` 500。出处：`.issues/rich-align-0722/receipt-deploy-0723.md:27,32`。

## 3. 新增 entity kind 必须双处同改

`pg_registry.py:91-96` 的 `_ENTITY_KINDS` 与 `entities_kind_check` 约束必须同时扩，二者是同一份真相的两份抄本。

反面教材：Slice 08 只改了 Python 的 `_ENTITY_KINDS`，没同步改 CHECK，真 Postgres 在 demo master cast 上直接拒写 `kind='playbook'` 的行。出处：`0010_entities_kind_playbook.sql:4-6`。

守卫：`test_entities_kind_check_covers_written_kinds`（`eval-harness/tests/test_registry_contract.py:723`）。

## 4. 人员键 allowlist 只许**原地改 0009**，不许叠新迁移

改 person-keys allowlist 时编辑 `0009_*.sql` 本身，**永远不要**再加一份 superseding migration 去覆盖它——全量重放（规矩 1）下后加的那份会和 0009 打架。

出处：`0002_person_keys_allowlist.sql:15-16`（原话 "To change the allowlist, edit 0009 IN PLACE — never add a superseding migration."）。守卫：`test_person_keys_allowlist_covers_exactly_person_fields`（`eval-harness/tests/test_registry_contract.py:684`）。

## 5. 模板从哪抄

新写 migration 想抄现成写法，抄 0009、0010、0011——这三份是当前最近、最合规的范例（幂等写法 + 守卫测试 + 完整的 WHY 注释齐全）。

⚠ 别把 0001/0002 当反面教材：0001 通篇 `CREATE ... IF NOT EXISTS`，本身就是规矩 1 的范本；0002 是活的、幂等的 DROP-only 迁移，规矩 4 就出自它的头注释。它们只是年代早、注释体例不同。

⚠ 但 0002 曾**踩过规矩 2**（2026-08-13 实测逮到、当场改成守卫式，见规矩 2 的红字）——它一直是幂等的、也从不报错，**坏就坏在这不冲突**：`DROP CONSTRAINT IF EXISTS` 幂等归幂等，照样每次开机取一把 ACCESS EXCLUSIVE。**「幂等」和「不加重锁」是两件事，规矩 1 绿了不等于规矩 2 绿了**，新写 migration 两条都得单独过一遍。
