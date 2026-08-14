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

## 5. 退休既有对象：允许，但要过三道门

规矩 1 那句「增量、幂等」常被读成「绝不 DROP」，0008 的头注释也自陈 "never DROPs anything"。**这条读法从 0020（#100，2026-08-14）起不再准确**，收编成明确的口径免得下一个人要么不敢动、要么随手 DROP：

**允许**一份新迁移退休**前一份迁移所建的对象**（0020 退休 0008 建的 `account_contexts_context_key`）。**不允许**回头去改那份旧迁移 —— 全量重放（规矩 1）下，把 `CREATE UNIQUE INDEX` 从 0008 里删掉，只对**全新**的库有效：所有既有库上那条索引早就建好了，没有任何语句会去删它，本地/生产从此分叉。**退休必须是增量的，这正是规矩 1 的本意，不是它的例外。**

🔴 **先过这一关，它比下面三道门先咬人：退休了一个对象，并不能阻止建它的那份迁移下次开机再建一次。** 全量重放每次都从 0001 跑到最后一份，而建它的那份**排在你前面**。第一版 0020 把替换索引取名 `account_contexts_context_idx`，于是每次开机变成「0008 重建 UNIQUE → 0020 再删掉」，而只要库里已经有多成员数据，0008 那句 `CREATE UNIQUE INDEX` 就是 `UniqueViolation`，**整个 bootstrap 当场炸**，轮不到 0020 收拾。2026-08-14 在本机真库上实收，八条 needs_db 判据连带炸掉。

所以退休一个对象，必须让**建它的那句话永久变成 no-op**，而不是跟它每轮抢一次。可用的手法（实测 pg17）：`CREATE [UNIQUE] INDEX IF NOT EXISTS <name>` **只按名字判重** —— 名字被占就整句跳过（NOTICE `relation already exists, skipping`），不比对唯一性、不比对列、表里真有重复行也照样跳过且不报错。0020 因此让替换索引**沿用原名**。代价是名字会撒谎（`_key` 后缀按约定意味着唯一，而那条索引不唯一），这个代价要在新迁移里写明。约束/表/列各有各的对应手法，动手前先想清楚「旧那句话下次开机会发生什么」，别只想「我这句话干了什么」。

三道门，缺一不可：

1. **catalog 守卫，不许裸 `DROP ... IF EXISTS`** —— 见规矩 2 的红字：`IF EXISTS` 只保证不报错，不保证不加锁。裸写＝每次开机在那张表上取一把 ACCESS EXCLUSIVE。抄 0002 / 0020 的 `DO $mig$ ... IF EXISTS (SELECT 1 FROM pg_class/pg_index/pg_constraint ...) THEN DROP ...` 形态。守卫的谓词还要兼任幂等开关（0020 用 `x.indisunique` 区分「旧的唯一索引还在」与「已经换成非唯一的了」，否则第二次开机会把新建的那条也删掉）。
2. **就地写明为什么** —— 退休一个对象通常是在**放松**一条约束，也就是在削弱某个不变式。新迁移的头注释必须把话说到这个份上：**哪一条保证仍然由存储层扛（一个字没动）、哪一条真的退到了应用层（由谁、在哪个函数、靠什么保持原子）**。0020 的头注释是范例 —— 它把 0008 那句「唯一索引＝两个账号数据不串」拆成「隔离没动（靠 PRIMARY KEY + 存在性查询）」与「排他性真的退了（靠 `link_account_context` 在 `FOR UPDATE` 之下判断）」两半，而不是笼统说一句「退回应用层」。
3. **升级路径在一次性真库上真跑，做成常驻门**（#93 纪律） —— 不是读代码论证。形状：造回旧对象 + 存量行 → **先证明旧世界真的会拒**（对照基准落在存储层）→ `_ensure_schema` 接管 → 复查对象已换 → 新语义真跑通 → 全新实例回读。⚠ 对照基准那一步必须走**裸连**（`psycopg.connect(url)`，或退一步 `reg._connect()`）—— registry 上**每一个**公开方法都会先调 `_ensure_schema()`，拿它去验对照组等于让自愈式迁移把自己的对照组治好，「关 vs 开」当场变成「开 vs 开」。范例 `test_upgrade_path_from_the_single_owner_schema` 用的是 `psycopg.connect`：它跑在一次性库上，那一刻**根本不该存在**一个 registry 实例。⚠ 一次性库不是讲究，是必需：这条测试要造回旧世界的对象，而共享库上同一轮还有几十条 needs_db 判据在用同一张表 —— 中途任何一处 assert 挂掉，造回去的旧对象就留在原地，把后面一整批判据连坐染红，**它报的红就不再是自己的证据**。

⚠ 被退休的那份迁移**不回改**（连注释也不改，避免误伤全量重放的可审计性）—— 所以 0008 头注释里 "a context has AT MOST ONE owner account, enforced by the UNIQUE index on context_id below" 这句话**自 0020 起为假**。约定是：**退休理由与现状一律写在退休它的那一份里**，读到旧迁移里描述约束的句子，先 `grep -l` 一下后面有没有哪一份提到它。

## 6. 模板从哪抄

新写 migration 想抄现成写法：**新增**对象抄 0009、0010、0011（幂等写法 + 守卫测试 + 完整的 WHY 注释齐全）；**退休**既有对象抄 0020（规矩 5 那三道门的第一份、也是目前唯一一份范例），它的 catalog 守卫形态转手自 0002。

⚠ 别把 0001/0002 当反面教材：0001 通篇 `CREATE ... IF NOT EXISTS`，本身就是规矩 1 的范本；0002 是活的、幂等的 DROP-only 迁移，规矩 4 就出自它的头注释。它们只是年代早、注释体例不同。

⚠ 但 0002 曾**踩过规矩 2**（2026-08-13 实测逮到、当场改成守卫式，见规矩 2 的红字）——它一直是幂等的、也从不报错，**坏就坏在这不冲突**：`DROP CONSTRAINT IF EXISTS` 幂等归幂等，照样每次开机取一把 ACCESS EXCLUSIVE。**「幂等」和「不加重锁」是两件事，规矩 1 绿了不等于规矩 2 绿了**，新写 migration 两条都得单独过一遍。
