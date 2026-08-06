-- T1 · form-backend-a1a（差距战役 gap-design-0805）—— 常驻表单：模板 + 单人单链提交。
--
-- 这是什么：经理在资料库点「周报模板 → 生成本周链接」，选中一个人拿到 /f/<token>，微信转发；
-- 员工手机打开填几格、提交入库。第一张内置模板是「周报」，字段名与我们已经发给客户的那张
-- xlsx（scripts/make-intake-xlsx.py 的「06 周报与述职事实」表）**逐字一致**——客户看得懂来龙去脉。
--
-- 🔴 头号纪律（0805 拍板 #5）：表单提交**不是**信息的特殊来源，它与「公司上传文件 + LLM 解析」
-- 完全平权。落地形态是：一次提交 = 又一份带 uploaded_at 的 SourceDocument，走与上传文件**完全
-- 相同**的 chunk/出处/引用契约（那一步是 T2 的活，不在本迁移里）。所以这两张表存的是**表单这个
-- 采集器**本身（模板长什么样、链接发给了谁、谁交了），**不是**资料的第二条存储通道。禁止任何
-- 「表单专用旁路」。
--
-- 为什么不复用 avery.asks（快问）：那套的形状被红线门钉死了，改它等于把快问的门一起重写——
--   * asks.status 六词 CHECK（0007_ask.sql:29-31）是服务端拥有的词表，表单的生命周期不是那六个词；
--   * 题型只有 scale|yesno（avery/ingest/ask.py:30），表单要 text|choice|number；
--   * 一次性 draft→shared 状态机（service/ask_api.py:363-384）与「一张模板反复铸链」正相反；
--   * MAX_QUESTIONS=3（ask.py:33），周报是 6 格。
-- 迁移目录的纪律是 increment-only / never DROP（见 README 规矩 1 与 0006/0007 文件头），改既有
-- CHECK 直接违纪。所以：新表，不动老表一个字节。
--
-- 🔴 红线：与 0007 同一姿态。**题面**（模板的 title/字段 label/help/choices，是经理或我们写的、
-- 要发到员工眼前的文本）在 Python 写侧过 avery.redline.validate（EN+ZH，两档，见
-- avery/ingest/form.py::gate_form_red_line）才可 INSERT；**答案**（employee 自己的话）刻意**不**过
-- 红线——ADR-0023：那是他本人的声音。结构保证在于落点：答案挂 (template, submission)，永远不挂
-- avery.entities，所以 0009 的人员键 allowlist CHECK 依旧保证「没有数字能落到人身行上」。
-- 表单文本一律是**未受信内容**（0004 文件头的注入边界）：只存不听。
--
-- GC：两张表都 context_id FK ON DELETE CASCADE —— demo 克隆的 ephemeral 清扫（0011）删 context 时
-- 顺带带走模板与提交，与 company_notes / advise_runs 同一命运。clone_context 刻意**不**复制这两张表
-- （照 0012 advise_runs 的先例）：示例团队克隆应当以空表单库开局，把别人的周报塞给新访客是假数据；
-- 内置「周报」模板由 avery/ingest/form.py::ensure_builtin_templates 在首次读取时按需铸出，克隆体
-- 一样拿得到，不需要复制。
--
-- Increment-only, avery-scoped, idempotent (CREATE ... IF NOT EXISTS) —— never touches
-- public/existing objects, never DROPs anything. Replayed by _ensure_schema() on each bootstrap
-- (the SAME file applied to Supabase, so local<->prod schema equivalence holds by construction).
--
--   avery.form_templates    一家公司的一张常驻表单模板。fields 是**字段描述**（渲染由描述驱动，
--                           不是硬拼分支）：[{id, kind: text|choice|number, label, help, required,
--                           choices[], min, max}]。active=false 的模板不再发新链接，但**老链接
--                           照常可填**（已发出去的链接不能因为经理归档模板就白屏）。
--                           主键 (context_id, id)：模板 id 在一家公司内唯一，跨公司可同名
--                           （内置模板在每家公司都叫 tpl_weekly）。
--   avery.form_submissions  一次「发给某一个人的一份表单」。铸链即建行（answers 为 NULL），
--                           员工提交时把 answers 填上——所以这张表同时是「谁交了/谁没交」的
--                           唯一真相（T3 的状态列表读它）。share_token 是员工侧唯一凭据
--                           （UNIQUE partial，NULL 直到铸链）；答一次锁由写路径的
--                           `UPDATE ... WHERE submitted_at IS NULL` 原子保证（照抄 0007 的做法）。

SET search_path = avery, public, extensions;

CREATE TABLE IF NOT EXISTS avery.form_templates (
    context_id  text NOT NULL REFERENCES avery.contexts(context_id) ON DELETE CASCADE,
    id          text NOT NULL,
    title       text NOT NULL,
    fields      jsonb NOT NULL DEFAULT '[]'::jsonb,
    active      boolean NOT NULL DEFAULT true,
    created_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (context_id, id)
);

-- 经理侧的读法恒是「这家公司还在用的模板」——部分索引只覆盖 active 行，随停用增长而不随历史增长。
CREATE INDEX IF NOT EXISTS form_templates_ctx_active_idx
    ON avery.form_templates (context_id) WHERE active;

CREATE TABLE IF NOT EXISTS avery.form_submissions (
    id            text PRIMARY KEY,
    context_id    text NOT NULL REFERENCES avery.contexts(context_id) ON DELETE CASCADE,
    template_id   text NOT NULL,
    person_id     text NOT NULL DEFAULT '',   -- 01 表的人员ID；归并按 ID 不按姓名（同名/花名会并错人）
    person_name   text NOT NULL,              -- 一人一链：这条链是发给谁的（页面上只出现他一个人）
    period        text NOT NULL DEFAULT '',   -- 述职周期，06 表表头之一（如 2026-W32）；T2 的文档名用它
    share_token   text,                       -- NULL 直到铸链；不可猜（secrets.token_urlsafe(32)）
    answers       jsonb,                      -- NULL 直到提交；[{field_id, value}]
    submitted_at  timestamptz,                -- NULL 直到提交；答一次锁的判据列
    created_at    timestamptz NOT NULL DEFAULT now(),
    expires_at    timestamptz NOT NULL DEFAULT now() + interval '7 days'   -- 拍板 #4：7 天过期
);

-- 员工侧的读路径是「拿 token 解析出唯一一份提交」——token 就是全部凭据，没有枚举面。
CREATE UNIQUE INDEX IF NOT EXISTS form_submissions_share_token_key
    ON avery.form_submissions (share_token) WHERE share_token IS NOT NULL;

-- 经理侧的读路径是「这家公司这张模板的提交，新的在前」。
CREATE INDEX IF NOT EXISTS form_submissions_ctx_created_idx
    ON avery.form_submissions (context_id, created_at DESC);
