-- issue #49 (2026-08-05) — 议事室问答持久化：每次成功的 /advise 落一行「问题 + 最终建议卡/
-- 短答」，前端议事室的历史列表（GET /team/{id}/advise-runs）从这里读。此前一次问答的全部
-- 内容只活在浏览器内存里，F5 即彻底丢——本表是它的第一层持久化。
--
-- 存什么/不存什么（grill 拍板，issue #49）：
--   * 存：问题原文（question）、可选标题（title）、locale、契约投影后的 8 字段建议卡
--     （advice jsonb —— manifest.advice，service/contract.py 的投影，引用以 evidence 字段
--     形态在卡内）、分流短答（answer text，与 advice 互斥）。
--   * 不存：原始 SSE 事件流、四相过程、完整 transcript——历史回看的核心是「当时问了什么、
--     Avery 判了什么」，不是逐帧回放；transcript 里的 recall 原文块会让行体积膨胀两个数量级。
--
-- 🔴 红线：只有 `redline_passed is True` 的 manifest 才会被写入（service 层 hook 判，
-- 与 notes hook 同一判据）——历史里永远不会出现被红线拦下的建议内容。question 是经理
-- 自己的原话、只回显给他本人（与 composer 输入面同一受众），不做内容改写。
--
-- GC：context_id FK ON DELETE CASCADE —— demo 克隆的 ephemeral 清扫（0011）删 context 时
-- 顺带带走全部历史，与 company_notes 同一命运。clone_context 刻意**不**复制 advise_runs：
-- 示例团队克隆应当以空历史开局（master 经 put() 铸造、本就没有历史；即便未来有，把别人
-- 的问答塞给新访客也是假历史）。
--
-- Increment-only, avery-scoped, idempotent (CREATE ... IF NOT EXISTS) — never touches
-- public/existing objects, never DROPs anything. Replayed by _ensure_schema() on each bootstrap
-- (the SAME file applied to Supabase, so local<->prod schema equivalence holds by construction).
--
--   seq         monotonic insert order — the deterministic new->old sort key (created_at can tie).
--   id          opaque non-guessable handle for one run (external reference).

SET search_path = avery, public, extensions;

CREATE TABLE IF NOT EXISTS avery.advise_runs (
    seq         bigserial PRIMARY KEY,
    id          text NOT NULL,
    context_id  text NOT NULL REFERENCES avery.contexts(context_id) ON DELETE CASCADE,
    question    text NOT NULL,
    title       text,
    locale      text NOT NULL DEFAULT 'en',
    advice      jsonb,
    answer      text,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS advise_runs_id_key
    ON avery.advise_runs (id);

-- The list read is "this company's runs, newest first" — index the (context_id, seq DESC) path.
CREATE INDEX IF NOT EXISTS advise_runs_ctx_seq_idx
    ON avery.advise_runs (context_id, seq DESC);
