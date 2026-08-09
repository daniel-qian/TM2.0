-- issue #78 (2026-08-09) — advise-threads 真线程：让「一场对话」成为可查询的第一类概念。
--
-- 0012 起 advise_runs 是一行一问的平铺流水，议事室历史只能逐条回看：三次追问在列表里是三条
-- 互不相干的记录，回看时对话结构永久丢失。本列给每一行挂一个「场」（thread），于是
--   * 历史面板按场分组（GET /team/{id}/advise-threads）；
--   * 点开一场能把整场按对话顺序恢复进议事室；
--   * 在那场里接着问，新行落回同一个 thread_id。
--
-- 🔴 为什么是可空列、且**不做回填 UPDATE**：
--   本文件每次 bootstrap 由 _ensure_schema() 全量重放（db/migrations/README.md 规矩 1），
--   一条 `UPDATE ... WHERE thread_id IS NULL` 虽然幂等，却会变成**每次开机对全表扫一遍**，
--   而且是跑在 lock_timeout=3000ms 底下（pg_registry.py::_ensure_schema）。
--   更重要的是语义：0012 起已落库的历史行本来就没有场归属，给它们编一个场就是编事实。
--   NULL = 这一行来自 thread_id 之前，读侧一律呈现为「自成一场的单轮」，绝不追认归属。
--
-- 🔴 thread_id 由**服务端**铸并经 SSE 回传（service/app.py 的 /advise handler），不是客户端
--   自己发一个 id：客户端自铸时，老后端静默忽略这个键的那一幕没有任何信号——前端会以为
--   续问落同场、实际每问一场新的。服务端回传就是那条对账通道（没回传 → 前端 threadId 停在
--   null → 界面老实地每问自成一场，不谎称在续场）。副产品是 NULL 无歧义：新行永远有值。
--
-- Increment-only, avery-scoped, idempotent（ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT
-- EXISTS）—— never DROPs anything, replayed by _ensure_schema() on each bootstrap（同一份文件
-- 也 applied 到 Supabase，所以 local<->prod schema 等价按构造成立）。

SET search_path = avery, public, extensions;

ALTER TABLE avery.advise_runs
    ADD COLUMN IF NOT EXISTS thread_id text;

COMMENT ON COLUMN avery.advise_runs.thread_id IS
    '这一轮问答所属的「场」（avery/ingest/registry.py::new_thread_id 生成，续问原样回传）；'
    'NULL = issue #78 之前的存量行，读侧按「自成一场的单轮」呈现，绝不追认归属。';

-- 两问都走这条索引：「这家公司有哪些场（新->旧）」与「点开一场，按对话顺序取整场」。
-- seq 升序即场内对话顺序（0012 头注：seq 是确定性排序键，created_at 会并列）。
-- 0012 的 (context_id, seq DESC) 保留——它仍是「不分组的最近 N 条」那条读路径。
CREATE INDEX IF NOT EXISTS advise_runs_ctx_thread_seq_idx
    ON avery.advise_runs (context_id, thread_id, seq);
