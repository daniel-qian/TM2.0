-- #100 — 一家公司多个账号：退休 0008 的 UNIQUE(context_id)，让同一份档案能挂多个成员账号。
-- 来源：Danny 0813 拍板「公司的每个成员一个账号，文件与数据属于同一家公司，改动同步」。
--
-- ⚠ 本仓第一份**退休前一份迁移所建对象**的迁移。README 规矩 5 就是为它写的 —— 先读那一条，
--   它给出一个前置陷阱（建它的那份迁移还会继续跑）加三道门（catalog 守卫 / 就地写明为什么 /
--   升级路径在一次性库上真跑），本文件逐条兑现。
--
-- ── 这次到底放松了什么，别含糊 ───────────────────────────────────────────────────────────
--
-- 0008 自陈那条唯一索引是「两个账号数据不串」在**存储层**的保证。这句话半对，而半对的那半正是
-- 本文件必须说清的地方：
--
--   · 仍然由存储层保证的（**本文件一个字都没动**）：一个账号够得着一份档案，当且仅当
--     `avery.account_contexts` 里真有 `(那个 user_id, 那个 context_id)` 这一行。这条才是隔离本身，
--     它由 PRIMARY KEY (user_id, context_id) 与 `account_owns` 的存在性查询共同承担，与唯一索引无关。
--     匿名档案（一行都没有）照旧任何账号都够不着。
--
--   · 从存储层退到应用层的（**本文件真的削弱了的**）：**排他性** —— 「一份档案至多一个账号」。
--     过去第二个账号想绑一份已被绑走的档案，库直接抛 UniqueViolation；今天库照收，改由
--     `pg_registry.link_account_context` 判断。为了不把一条**原子**的拒绝换成一条可以被并发绕过的
--     拒绝，那个判断跑在 `SELECT ... FROM avery.contexts WHERE context_id = %s FOR UPDATE` 之下：
--     同一份档案上的两次认领被那把行锁串起来，后到的那次一定看得见先到的那一行。
--     判据：tests/test_registry_contract.py::test_claim_still_refuses_a_context_owned_by_someone_else
--
-- 产品语义（Danny 0814 拍板，写在这里免得下一个人从代码反推）：`/account/claim` **仍然拒绝**
-- 已有主人的档案。owner_token 是**设备级**凭据，不该成为加入一家公司的门票 —— 任何翻过那台电脑
-- localStorage 的人（离职员工、外包、修电脑的）都能拿它把自己塞进公司，且没有一个人会收到通知。
-- 加第二个人的唯一路径是 admin 脚本（scripts/ops/link-account-context.py），它显式传
-- `allow_shared=True`。默认参数就是今天的 claim 语义，所以既有两个调用点行为逐字未变。
-- 本票不做角色（只读/可编辑）：绑进来的成员权限完全相同。这不是疏漏，是票面边界。
--
-- ── 🔴 为什么替换索引沿用**同一个名字** ────────────────────────────────────────────────
--
-- 因为**建它的那份迁移还会继续跑**。全量重放（README 规矩 1）每次开机都从 0001 跑到最后一份，
-- 0008 里那句 `CREATE UNIQUE INDEX IF NOT EXISTS account_contexts_context_key` 一次不落，而且它
-- 排在本文件**前面**。第一版本文件把替换索引取名 `account_contexts_context_idx`，于是每次开机是：
--
--     0008: 名字没被占 → 真的重建那条 UNIQUE 索引   ← 一旦库里已经有两个成员的档案，这句直接
--                                                     UniqueViolation，**整个 bootstrap 当场炸**
--     0020: 把它再删一遍 —— 但已经轮不到它了
--
-- 不是推演，是 2026-08-14 在本机真库上撞出来的：`could not create unique index
-- "account_contexts_context_key" / Key (context_id)=(ctx_test_...) is duplicated`，八条 needs_db
-- 判据连带炸掉。**一份迁移退休了一个对象，并不能阻止建它的那份迁移下次开机再建一次。**
--
-- 解法是让 0008 那句话**永久变成 no-op**，而不是跟它每轮抢一次。实测（pg17，一次性库）：
-- `CREATE [UNIQUE] INDEX IF NOT EXISTS <name>` 只按**名字**判重 —— 名字被占就整句跳过（NOTICE
-- "relation already exists, skipping"），既不比对唯一性、也不比对列，表里真有重复行照样跳过、
-- 不报错。所以下面的替换索引沿用 `account_contexts_context_key` 这个名字，0008 从此永远跳过。
--
-- 代价，写在这里免得下一个人读 catalog 读错：`_key` 后缀在 Postgres 的约定里意味着唯一，而这条
-- 索引**不唯一**。名字是这套增量纪律的赎金 —— 想改名就必须回改 0008，而回改旧迁移会让所有既有
-- 库上那条 UNIQUE 索引永远没人删（README 规矩 5）。判据：
-- test_upgrade_path_from_the_single_owner_schema 的第 8 步专门重放两轮，钉死这条索引不会变回唯一
-- 且 bootstrap 不炸 —— 那一步实测可达（把第 5 步临时放行后，`_ensure_schema()` 自己抛出
-- UniqueViolation），不是一条恰好被前面判据挡住的死枝。
--
-- ── 为什么是 DO 块守卫而不是裸 `DROP INDEX IF EXISTS` ──────────────────────────────────
--
-- `IF EXISTS` 在加锁之前不判断任何东西（0002 的头注释是这条教训的第一手现场，2026-08-13 实测）。
-- 裸写的话，`DROP INDEX IF EXISTS` 会在**每一次** bootstrap 重放（README 规矩 1）时对
-- `avery.account_contexts` 取一把 ACCESS EXCLUSIVE —— 包括索引早就换完、这句话什么都删不掉的
-- 那 99.99% 次开机。而 `account_contexts` 是**每一次已登录授权读**都要查的表（`account_owns`），
-- 在它上面每次开机抢一把排他锁，就是 2026-07-23 那次停摆的形状换一张表重演。
-- 先查 catalog 不要钱，`indisunique` 那一条谓词同时兼任幂等开关：唯一索引还在才删，换完就是纯查表。
-- 判据：tests/test_registry_contract.py::test_steady_state_bootstrap_takes_no_table_lock[account_contexts]
--
-- ── 升级路径 ──────────────────────────────────────────────────────────────────────────
--
-- 存量数据零改动：既有每行 `(user_id, context_id)` 在弱化后的约束下全部合法，不搬不补不回填。
-- 七步升级路径在一次性真库上真跑（#93 纪律），常驻门：
-- tests/test_registry_contract.py::test_upgrade_path_from_the_single_owner_schema
--
-- 🔴 RED LINE: unchanged. 本表依旧只存两个不透明 id，零人员数据；0002/0009 的 person-key allowlist
-- 与写侧红线本文件一个字没碰。

SET search_path = avery, public, extensions;

-- ① 退休 0008 的 UNIQUE(context_id)。守卫形态与 0002 一致：先读 catalog，真有那条**唯一**索引
--    才 DROP。`x.indisunique` 不是装饰，它是本文件的幂等开关 —— 少了它，第二次开机会把下面刚
--    建好的**同名非唯一**索引再删一遍，然后重建，既不幂等也每次取一把 ACCESS EXCLUSIVE。
DO $mig$
BEGIN
    IF EXISTS (
        SELECT 1
          FROM pg_class      i
          JOIN pg_index      x ON x.indexrelid  = i.oid
          JOIN pg_namespace  n ON n.oid         = i.relnamespace
         WHERE n.nspname = 'avery'
           AND i.relname = 'account_contexts_context_key'
           AND x.indisunique
    ) THEN
        DROP INDEX avery.account_contexts_context_key;
    END IF;
END
$mig$;

-- ② 换成**同名**的非唯一索引（为什么必须同名：见上面那段红字 —— 这是让 0008 永久 no-op 的唯一
--    办法，否则 0008 每次开机把 UNIQUE 重建回来，有多成员数据时直接炸掉整个 bootstrap）。
--    这条索引撑的是「这份档案上都有谁」：GC 的 NOT EXISTS 反连接、`accounts_for_context`、以及
--    `account_owns` 的存在性查询都走它。
CREATE INDEX IF NOT EXISTS account_contexts_context_key
    ON avery.account_contexts (context_id);
