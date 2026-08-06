# T2 · form-append-a1b 交接（2026-08-06 · 分支 claude/dazzling-lewin-b9a13f）

**状态：done，已合 main。** issue [#53](https://github.com/daniel-qian/avery/issues/53)，feature_list `feat-099`。
前置核对：T1（290de59）确认在 main 后才开工。

## 交付了什么（三点可证，对应票面「产出」）

1. **提交 → 资料库多一行可下载**：员工 `/f/{token}` 提交那一刻，`service/form_api.form_submit`
   调 `avery/ingest/form_append.append_submission_to_context`，资料库出现
   「周报-{姓名}-{周}.md · ingested · n_chunks>0」，`GET /team/{id}/files/{idx}` 可下原件。
2. **议事室引用表单原句**：append 后 `materialize_memory` 重写 facts.md（⚠ put() 只在文件
   **缺失**时才物化，这一步不能省），`memory.recall`（tools.py 的 advise 面）当天命中表单原句。
3. **不漏钱**：`pg_registry._material_vectors` 修好向量复用——append 只嵌新增块（真库门用
   计数 embedder 钉死流水账），旧向量走事务内 `_prior_mat_vecs` 回填，全程不出库。

## 关键取舍（后续票别再推导一遍）

- **通道**：`get(ctx) → 原地 append → put(ctx)`，与手编 CRUD 同形。🔴 绝不新造 CompanyContext
  ——写进了 form_append.py 文件头（arch-0802 回填只补 NULL 单元，补不回缺失行）。
- **source_key = `<filename>#<submission.id>`**：display 名允许重复（同人同周期重铸再交），
  唯一性和幂等判据都押在铸进 key 里的提交 id 上。幂等 = append 二次触发返回 `appended=False`。
- **转义字符选了 `¦`（U+00A6）**：形近可读、不在 `_selfreport_from_lines` 的 `[｜|]` 切格表里，
  也不满足 `_people_from_table` 的 `"|" in ln`。员工原话逐字保留，只换竖线。
- **自述行本票就按解析层原语法渲染**（`周雅｜负载自述：72｜情绪自述：偏紧`，单独 `## 本人自述`
  节）：T5 接 `_selfreport_from_lines` 时零翻译层，存量文档直接可读。
- **uploaded_at = submitted_at**（不是 append 跑到的时刻）——表单是把时间轴拉开的数据源（§B1），
  T4 的 R-STALE-EVIDENCE 从第二周起才因此有落差可量。
- **append 失败不回滚提交**：首答锁已拿到，重走只会 409。员工侧换 `thanks_pending` 文案
  （不说「已经进了资料」的假话），经理侧新端点 `POST /team/{ctx}/forms/{id}/ingest` 补灌
  （幂等；门与 notes 同张：无 token 同体 404 / 未提交 409 / 模板被撤 410）。
- **_material_vectors 返回值改 per-row Optional**：行内 None = 「库里已有这块的向量」，INSERT
  落 NULL 交给事务内回填补齐。put() 里 INSERT 的行内条件同步改了（`vecs[i] is not None`）。

## 门与取证

- 离线全套 **3728 passed / 105 deselected / 4 xfailed**（四 deselect 齐）；`@needs_db` 全套
  **96 passed**（本地 `teammaster-postgres-1`，throwaway 库 `avery_t2_test`，用完可 drop）。
- 新门在 `tests/test_form_append.py`（14 离线 + 2 真库）：渲染表头逐字 / 分节唯一竖线行 /
  模仿行对解析器不可读（直接问 `_selfreport_from_lines`，不赌字符串外观）/ 最简提交非零 chunk /
  旧字节保全 / briefing 口径 / 幂等 / facts+recall / **增量嵌入流水账** / keyword 模式不炸。
- 🔴 反假绿变异 5/5 被咬：撤向量复用→真库增量门红；撤转义→模仿门红；撤 materialize→recall 门红；
  撤 source_files.append→briefing 门红；撤幂等判→幂等门红。
- init.sh 全绿（前端零改动，chunk-size warning 是存量）。

## 留给后面的话

- **T3（资料库前端）**：清单/下载零新契约——表单文档就是普通 file_cards 行。补灌端点响应形状
  `{appended, file:{filename, source_key, status, uploaded_at}}` 可直接拿去做「重新入库」按钮。
- **T5（回流人卡）**：自述行已按 canonical 语法渲染且分节转义已有门；T5 只需接
  `_selfreport_from_lines` → stub PersonEntity → `_dedupe_entities` 按 person_id 归并。
  person_id 在文档元数据行（`人员ID：P-0007`）和 FormSubmission 上都有。模仿攻击门可直接
  复用 `test_an_imitated_selfreport_line_in_free_text_is_escaped_and_unparseable` 的姿势。
- **已知边界（诚实记录，非阻塞）**：①新块若嵌入失败落 NULL，向量面隐身但 facts.md/advise 不受
  影响（design-options A1 的既有结论，roadmap 项）；②`memory.recall` keyword 路是 ASCII token，
  纯中文查询靠数字 token 命中——生产语义检索走 embedder 路，不受此限；③员工页 `thanks_pending`
  极小概率出现（本地事务失败），出现即有 log + 补灌路径，不是静默丢。
- **票面没做也不该做的**：表单回流人卡/项目卡（T5）、前端第④段（T3）、周期实例/催收（A3）。
