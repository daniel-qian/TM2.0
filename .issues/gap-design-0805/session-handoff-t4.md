# T4 · time-rules-b1 交接（本线专用）

> 分支 `claude/nostalgic-curie-5f7b32`（worktree），基线 `main@c517975`。
> 根 `progress.md` / 根 `session-handoff.md` 归主检出的集成者，本文件只记本线。
> feature 记账：`feature_list.json#feat-097` → `feature_archive.json#feat-097`。

## 一句话

时间轴做完了，**但只交付了票面两条规则里的一条**——`R-STALE-EVIDENCE` 上产，
`R-FRESH-CONTRADICTS-STALE` 整条移交 T7（理由见 `tickets.md` T4 节顶部那个框，写得很细）。

## 做了什么

**时间轴（零新表、零新字段，纯 join）** —— `eval-harness/avery/decision_grading.py`
- `DocStamp` / `DocTimeline` / `build_doc_timeline(source_documents)`：
  `source_key → 上传日`。鸭子类型（只要有 `source_key`/`filename`/`uploaded_at`），
  定级层因此仍不认识 `SourceDocument`，纯数据进出、离线可测。
- `_uploaded_day()`：**全仓唯一一处** UTC 归一。这是本文件第一条跨 date/datetime 边界的规则
  （`as_of` 是服务端本地 naive date，`uploaded_at` 是带时区瞬间），两处各归一一次早晚归出两个日子。
- `DocTimeline.stamp_for()`：出处 `"<key>:<line>"` → 那份资料。**先精确匹配、再回退 rsplit**，
  是 `registry._chunks_per_file()` 口径的严格超集（客户真会把文件命名成 `2026:上半年:复盘.md`）。

**规则** —— `R-STALE-EVIDENCE`（需确认级，`STALE_EVIDENCE_DAYS = 45`），四处同步齐：
`decision_rules.py` / `zh.ts` / `en.ts` / `decision_grading_rules.md`。

**接线** —— `eval-harness/avery/ingest/registry.py`
- `CompanyContext._decision_subjects()`：`project_cards()` + `sourceRef`。
  为什么不直接给 `_one_project_card` 加键：`sourceRef` 是定级内部的 join key，
  前端 `LiveProjectCard` 零消费者，塞进 `/team` 回帧就是把内部键写进公开契约。
- `CompanyContext.doc_timeline()`：`decision_cards()` 与 `briefing()` **都**吃它。
  只喂一边 = 今天页卡片和它上面那句「N 个值得多看一眼」对不上，正是 `briefing()` 长注释里记着的旧伤。

## 三个绕不开的设计取舍（都是撞了硬门/实证之后定的，不是口味）

1. **《{doc}》与实际天数都进不了句子**。`RULE_PARAMS` 是 `dict[str, dict[str, int]]` 且有明文红线
   只放静态阈值；中文文档名进 `params` 直接触 `test_no_backend_prose_anywhere_in_the_payload`
   （`matched_rules` 里只有 `evidence` 放行 CJK）。
   → 句子里只留**静态阈值** `{days}`，文档名 + 上传日作为**字段读数**进 evidence，
   照 `R-OVERDUE` 把日期摆 evidence 的既有做法。实际天数不写进句子还有第二个理由：
   它要拿本地 date 减 UTC 时间戳，跨日差一天就是屏幕上一句假话；evidence 里那个日期差一天也仍然为真。

2. **判据取「全 context 最新一份资料」，不是这个项目自己那份**。
   归并（`_dedupe_entities`）只留得下一个 `source`，一个项目的 status 与 dueDate 可能读自两份不同资料
   → 按项目自己那份算，会说出「关于它没有更新的资料」这种**当场可被推翻**的假话
   （一份昨晚刚传、只是没提到这个项目的周报就能证伪）。
   取全库最新则与归并怎么洗无关，恒为真。**代价**：命中面粗——整块公司齐命中或齐不命中。

3. **不给「只打可推进卡」开特例**。等级取最严重一档，所以这条只会把「可推进」抬成「需确认」，
   高风险卡该是高风险还是高风险（只是展开后多一行）。开这个特例会让
   `decision_grading_rules.md` 不再是「每行独立可读」的平表，客户下一句必然是
   「那还有哪几条是这样的」。

## 已知局限（不藏，也写进了给客户看的 `decision_grading_rules.md`）

- **今天这条规则的粒度是「整块公司」**：每次 `POST /ingest` 都铸新 `context_id`
  （`pipeline.py:154`），今天**没有**「给已有公司追加上传」的端点，所以同一 context 的
  `source_documents` 必然同批同刻。要按项目/按人分出新旧，得等 **T2 表单线**
  （一周一交、按人分散，那才是真正把时间轴拉开的数据源）。
- **命中效果**：一批资料超过 45 天，该公司所有原「可推进」卡一起变「需确认」，
  理由是「资料太旧」。这是**特性**——拿一个半月前的纸换来的绿灯本来就不该展示成绿灯，
  与本仓「漏报比误报贵」的明文取向一致。但它今天是**清不掉**的（除非重新整批上传），
  所以 T2 若滑期，值得回头看一眼要不要加运维开关。
- **需确认卡的理由句会变长**：`composeRuleReason` 只拼同档命中，所以一张本就需确认的卡
  会在句尾多一个分句。高风险卡不受影响（不同档，不进那句话）。
- 演示提醒：现场新灌的 context `days≈0`，**这条规则一条都不会亮**。要演它得备一个
  `uploaded_at` 往前挪过的种子 context。

## 门（跑法与结果）

```bash
cd eval-harness && AVERY_BRAIN=mock AVERY_EXTRACTOR=heuristic AVERY_EMBEDDINGS=keyword \
  python -m pytest -m "not smoke and not seedgate and not needs_keys and not needs_db" -q
```
→ **3565 passed / 77 deselected / 4 xfailed**。新增 18 条时间轴门在
`tests/test_decision_grading.py` 第 10、11 节（新测试**必须**写在这个文件里：
`test_no_rule_text_in_any_prompt` 的白名单只有四个文件，另起文件写规则号就触门）。

`./init.sh` 全绿（lint + typecheck + vite build）；`node scripts/i18n-orphans.mjs` 孤儿键 0。

🔴 **反假绿取证**（这条最要紧）：把 `decision_cards` 与 `briefing` 的 timeline 接线**各断一次**，
`test_decision_cards_really_carry_the_timeline_through` 与
`test_briefing_and_decision_cards_agree_about_staleness` 分别变红 →
可达性门不是恒绿，两处接线各自 load-bearing。
（没有这一步，「判据函数单测全绿 + 线上一次都不命中」是完全可能的。）

新门当场抓到两条真 bug，都已修：
1. `stamp_for` 对含冒号文件名在**无行号后缀**时切错 → 改成先精确匹配再回退。
2. 手编标记那条门初版是**黑名单式假门**（造了个名叫「手动编辑」的文档去撞）→
   改成考真接缝：`sourceRef` 恒取 `pr.source`、**从不**读 `provenance`，手加卡干脆不发这个键。

**没跑前端行为电池**：本线前端改动只有 zh/en 各一行 i18n，零组件代码、零布局变化，
而在新 worktree 里跑全套有实打实的风险（visual 门是 40 张「没有基线」的假红；
`dist` 可能被某道门重打成指向生产域名，此后任何上传类门就是往生产库写测试数据）。
init.sh + i18n-orphans + 后端契约门已覆盖这次改动的全部面。

## 给下一个人的坑（按会被咬的概率排）

1. **`signal_cards()` 里字面叫 `source` 的键装的是 `source_kind`**（'doc'/'figma' 类型词），
   不是文档引用；真正的 `SignalEntity.source` 根本没被投影。拿类型词去当文档 key 比较
   **不报错、门也全绿**。定级这一路走 `sourceRef`，已在 `signal_cards()` 上方写了 NAMING TRAP 注释。
2. **UTC 归一只许走 `_uploaded_day()`**。再推一遍就会有两个「今天」。
3. **日期比较一律天粒度**。同批上传彼此差微秒，用原始时间戳等于让文件遍历顺序当判据。
4. 加规则永远是**四处同步 + 两道硬门**；新测试写进 `test_decision_grading.py`，别另起文件。

## 下一步

- 本线完。T7 开工时先读 `tickets.md` 的 T4 收尾框 + T7 范围节（第二条规则的所有权已写明）。
- 主检出集成者：本线可合 main，无跨线冲突（只碰 decision_* / registry.py 的两个新方法 /
  两个 i18n 文件各一行 / 票册 / feature 记账）。
