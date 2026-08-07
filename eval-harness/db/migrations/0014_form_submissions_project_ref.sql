-- 差距战役 T5 · form-reflow-a2 —— 一条表单链可以绑定到一个项目。
--
-- 为什么需要它：A2 的兑现里有一条是「绑定项目的表单，答案追加成项目卡的阻塞原句」
-- （design-options.md §A2）。今天 `avery.form_submissions` 里没有任何一列说得出「这条链是关于
-- 哪个项目的」，所以这句承诺在数据层根本没有落脚点。
--
-- 为什么绑在**提交**上而不是模板上：一张「周报」模板全公司共用，而周雅这一周填的是「宴会厅翻台」、
-- 传菜组另一个人填的是别的项目——绑定是**逐条链**的事实，铸链那一刻由经理决定。
--
-- 为什么存**项目名称**而不是项目ID：`ProjectEntity` 至今没有外部项目ID 这个格子，归并认项目用的
-- 是 `extract._project_key(title)`（折空白与 _ -）。存一个下游没有任何一处会去比对的 ID，等于存一
-- 列谁也用不上的字符串；存名称才接得上那把尺。等哪天项目卡长出 02 表的「项目ID」，这一列再跟着改。
--
-- 为什么是经理填而不是员工填：填表的人不该能决定自己那句话挂到哪张项目卡上。这一列在员工的 H5
-- 上不存在（`/f/{token}` 一个字都读不到它），只由 `POST /team/{ctx}/forms/{tpl}/links` 写入。
--
-- 迁移纪律照旧：increment-only、绝不 DROP、可重放（ADD COLUMN IF NOT EXISTS 天然幂等）。
-- 空串 = 这条链不绑项目（与 person_id / period 同一姿态：NOT NULL DEFAULT ''，绝不用 NULL 表达
-- 「没有」——两种「空」会让读侧每一处都要写两遍判断）。

SET search_path = avery, public, extensions;

ALTER TABLE avery.form_submissions
    ADD COLUMN IF NOT EXISTS project_ref text NOT NULL DEFAULT '';

COMMENT ON COLUMN avery.form_submissions.project_ref IS
    '这条链绑定的项目名称（= ProjectEntity.title / 02 表「项目名称」）；空 = 不绑项目，回流只走人卡。';
