-- gap2 战役 T9 · forms-proactive（gh issue #58）—— 自动补铸的幂等护栏，落在**数据库**上。
--
-- 这是什么：T9 让「进入新周期」这件事不再需要经理动手——经理一打开资料库的表单区，服务端
-- 发现本期还没有链接、而上期有，就照着上期的名单把本期备好（form_autofill.py）。触发挂在
-- 流量上（照 service/demo.py 的 GC 与 form.py::ensure_builtin_templates 的先例），**不引 cron**。
--
-- 🔴 为什么需要一列而不是直接给 (context_id, template_id, period, person) 加唯一约束：
-- **手动铸链按设计就不是幂等的**（service/form_api.py::mint_links 的 docstring 明写：「重复调用
-- 等于再发一轮」——经理点两次「生成本周链接」是正当语义，老链接照常有效）。给那四列加全表唯一
-- 约束，等于把那句设计意图从背后废掉，而且是**静默**废掉：经理第二次点会拿到 500/409，而他
-- 什么都没做错。所以约束只能盖住自动那一路。
--
-- 做法：自动铸出来的行带一个 `auto_key`（= 那四元组的规范化拼接，由 Python 一处算出，见
-- avery/ingest/form.py::auto_mint_key），手动铸的行这一列恒为 NULL。Postgres 的唯一索引里
-- **NULL 互不冲突**，所以：
--   * 手动行：auto_key IS NULL → 想铸几条铸几条，行为一个字节不变；
--   * 自动行：同一 (context, template, period, person) 第二次 INSERT 撞索引 → ON CONFLICT DO
--     NOTHING 落空，调用方拿到「这个人本期已经有了」。
-- 这条保证是**事务级**的：两个并发请求同时判定「本期没有行」再各自 INSERT，仍然只有一条能活。
-- 先查后插挡不住这一幕（两边都查到空），所以护栏必须落在库上，不能只落在 Python 里。
--
-- ⚠ 但库上这一道**只**管自动 vs 自动。「经理已经手动给周雅铸过本期了，自动别再铸一条」是另一
-- 个威胁面（手动行没有 auto_key，索引看不见它），由 form_autofill.py 的读侧判据挡——它按本期
-- **全部**行（open/submitted/expired 任意态）算「谁已经有了」。两道锁挡两件事，各有各的门
-- （tests/test_form_autofill_t9.py 的 manual-suppresses-auto 与 tests/test_form_store_contract.py
-- 的 @needs_db 并发双写各一条），不是同一把锁加两层。
--
-- 为什么 auto_key 里不含 context_id：索引前导列就是 context_id，拼进值里只是把同一个事实存两遍。
--
-- Increment-only, avery-scoped, idempotent（ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS）
-- —— never DROPs anything, replayed by _ensure_schema() on each bootstrap（同一份文件也applied 到
-- Supabase，所以 local<->prod schema 等价按构造成立）。

SET search_path = avery, public, extensions;

ALTER TABLE avery.form_submissions
    ADD COLUMN IF NOT EXISTS auto_key text;

COMMENT ON COLUMN avery.form_submissions.auto_key IS
    '自动补铸的幂等键（template_id|period|person，由 avery/ingest/form.py::auto_mint_key 生成）；'
    'NULL = 这条是经理手动铸的，不受唯一约束管——手动重复铸链是正当语义，行为不许被改。';

-- 🔴 护栏本体。WHERE auto_key IS NOT NULL 让它只盖自动那一路；手动行（NULL）连索引都不进。
CREATE UNIQUE INDEX IF NOT EXISTS form_submissions_auto_key_uniq
    ON avery.form_submissions (context_id, auto_key) WHERE auto_key IS NOT NULL;

-- 自动补铸每次都要问「这家公司这张模板这一期有哪些行」与「上一期是哪一期」。没有这条索引，
-- 那两问会退化成对 (context_id, created_at DESC) 索引的全扫 + 过滤——本期行数不多，但历史行会
-- 随周数无限增长，扫描代价跟着涨。
CREATE INDEX IF NOT EXISTS form_submissions_ctx_tpl_period_idx
    ON avery.form_submissions (context_id, template_id, period);
