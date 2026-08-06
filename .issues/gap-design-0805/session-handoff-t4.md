# T4 · time-rules-b1 交接（本线专用）

> 分支 `claude/nostalgic-curie-5f7b32`（worktree）。起点 `main@c517975`；收尾前并入了
> 期间合进 main 的 **T1 常驻表单后端**（feature 记账因此让号：T1 占 feat-097，本线改为 feat-098）。
> 根 `progress.md` / 根 `session-handoff.md` 归主检出的集成者，本文件只记本线。
> feature 记账：`feature_list.json#feat-098` → `feature_archive.json#feat-098`。

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

## 对抗复审逮到的 6 条真缺陷（都已修，每条配了门）

初版四处同步做完、离线套 3565 全绿之后跑了一轮三视角对抗复审（假绿 / 诚实性 / 契约），
报 17 条、反驳后剩 6 条成立。**全绿之后才发现的，所以这一节比上面任何一节都值得读。**

1. **手加的项目卡也被判「资料陈旧」**（诚实性，high）。经理一分钟前手敲的卡（`source` 恒空、
   不读自任何资料）被降级成「需确认」，证据行还点名了一份与它毫无关系的月报。
   → 修：`own_doc is None` 不命中。这句话对那张卡结构上不成立。
2. **`newest_material` 会点名一份解析失败 / 零 chunk 的上传**（诚实性，high）。那份文件一个字
   都没被读到，却被摆成"判断读自它"；而且它一新，就把整批的真实陈旧藏了起来。
   → 修：`build_doc_timeline` 只收 `status == 'ingested'` 的行。
3. **demo 母本的上传日被克隆逐字继承**（契约，high）。母本内容寻址、一次铸成常驻，所以满 45 天
   之后，**每一位三秒前才领到示例团队、一个文件都没传过**的访客一进门就是整块看板变黄。
   → 修：`clone_context` 给副本重打上传时间（内存版 + pg 版 `INSERT..SELECT` 的 `now()`）。
   对那位访客来说，这些文件确实是此刻才进他工作区的。
4. **`status='done'` 的项目被拖累**（一致性，medium）。本文件另外三条时间规则都豁免 done
   （`test_done_project_is_not_dragged_by_dates` 钉着），我这条没有。→ 修：同一豁免。
5. **`_decision_subjects()` 把 archived 过滤抄了第二份**（假绿，medium）。删掉它，全仓 255 条门
   一条不红——而后果是用户扔进折叠抽屉的项目从今天页爬回来。
   → 修：收成唯一过滤点 `_active_projects()`，两个投影都走它；补直守门。
6. **en 文案在恰好第 45 天那天是假的**（文案，low）。判据是 `>=`，而 'over 45 days ago' 说的是
   `>`。→ 修：改成本表已有的包含式惯用语 `{days} or more days ago`（照抄 R-BLOCKER-STACK）。

**还补了一批门覆盖缺口**——复审用变异证明它们当时是零覆盖：
- 🔴 最要紧的一条：整节 18 条门里，**没有一条**的语料满足「项目自己那份 ≠ 全库最新那份」
  （要么多文档但无 sourceRef，要么有 sourceRef 但单文档），所以本票最核心的那一刀
  （比全库最新、不比项目自己那份）**零覆盖**——把判据改成 `(own_doc or newest_doc)` 全仓 3565 全绿。
  连那条名字就叫「印一个、比另一个」的门，语料也是单份文档，对它自己声称要防的 bug 结构上是瞎的。
- 同批同名上传（`周报.md` / `周报(1).md`，`_unique_parse_names` 的生产常态）从没进过语料。
- pre-032 行（`source_key=''`）的 filename 回退、evidence 的行数与整行形状、
  同日多份选谁的**具体**结果（原来只断言"两次调用彼此相等"——那对 set 迭代序实现同进程恒绿）。

**变异验证**（这一轮的收尾，逐条证明门不是装饰）：8 个变异逐个打进去再还原，
`✅ 全部被抓到` —— 判据改用自己那份 / 印一个比另一个 / 去掉 archived 过滤 / 去掉 filename 回退 /
evidence 印 source_key 而非 filename / join key 改 filename 优先 / 克隆不重打时间戳 /
不再跳过解析失败的文件 / 撤掉手加卡与 done 豁免。基线 99 passed。
（第一轮跑时其中两条**没被抓到**，是我门写漏了——语料里最新那份恰好 filename==source_key——
补语料后才真抓到。变异验证不做，这两个洞会带着「99 全绿」交付。）

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
→ **3638 passed / 99 deselected / 4 xfailed**（已含并进来的 T1）。新增 28 条时间轴门在
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
- 本线已自行合入 main（AGENTS.md 先斩后奏）。与 T1 的唯一交叉是 `registry.py` / `pg_registry.py`
  与两个 feature 记账 JSON：代码侧 git 自动并干净，JSON 侧两条线都取了 feat-097，已让号解决。
- ⚠ T1 的交接里记了一条**与本票无关但会影响 needs_db 轮**的既有红：
  `sweep_ephemeral` 子查询的 LIMIT 没有 ORDER BY。本票动了 `clone_context`（给副本重打
  `uploaded_at`），跑 needs_db 时别把那条红算到这次头上。
