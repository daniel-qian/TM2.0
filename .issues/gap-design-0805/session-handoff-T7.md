# T7 · conflicts-rule-b2b — 本线交接（worktree: reverent-bell-79f3fc / issue #56）

> 差距战役 0805 收官票。前置 T4（#51）/ T6（#52）合 main 已核（`6baf6a0` / `98ec459`）。
> 根 `progress.md` / 根 `session-handoff.md` 归主检出集成者，本文件只记本线。
> feature 记账：`feature_list.json#feat-099` → `feature_archive.json#feat-099`。

## 一句话

「多种资料互相不一样」这句对客承诺上今天页了：T6 记下的落败读数经两条新规则
（`R-CROSS-DOC-CONFLICT` + T4 移交的 `R-FRESH-CONTRADICTS-STALE`，**同为需确认**）
变成双栏对照的双引文卡，配「可能只是叫法不同」关闭出口。

## 做了什么

**后端**（`decision_rules.py` / `decision_grading.py` / `registry.py`）
- 两条规则进 RULES 需确认段；`STATUS_BADNESS`（blocked>at-risk>其余=0）是「更糟」的唯一排序。
- `decision_grading` 新增鸭子型冲突进气口：`_conflicts_for()`（归属+归一）→
  `_SubjectConflict/_ConflictReading` → 两个匹配器。`grade_project/grade_projects` 加
  `conflicts=None` 参数，不传=规则闭嘴，老调用方零感知。
- `registry.decision_cards()` 与 `briefing()` **两边都喂** `extraction.conflicts`
  （B1 时间轴那次的旧伤：只喂一边=卡片和「N 个值得多看一眼」对不上）。
- 时间映射全部复用 T4：`stamp_for()` 定位、`stamp.day` 直接进 evidence——
  **印的日期就是比较用的日期**，没有第二次归一。

**四处同步**：decision_rules.py / zh.ts / en.ts / decision_grading_rules.md（含新增
「几份资料对同一件事说法不一」整节，客户可当场看）。两道 i18n 硬门全绿。

**前端**（HomeScreen.tsx / lite2.css / zh.ts / en.ts）
- 冲突类命中（两个 rule_id 的 Set）证据渲染成 `--split` 双栏格（照差距卡对照语法收窄到
  规则展开区），**零新载荷形状**——数据仍是 `LiveDecisionRuleHit.evidence: string[]`。
- dismiss「可能只是叫法不同」：**零新状态机制**，直接写 `gapMarks`（键
  `conflict_<subject>_<rule>_<evidence.join('|')>`，与 `gap_` 前缀不撞；
  `resetFlowCompanyScope` 清扫免费继承；键从证据内容派生——读数变了自动重新浮出）。
  收起只藏证据面+留说明行+恢复按钮；**等级徽章不动**（前端下调无门，含这道前门）。

## 设计定案（票面留白处，本票拍的）

1. **两条规则同为需确认**（T4 交接明令别一高一低）。理由记在 decision_rules.py 注释：
   冲突=「哪份为准待确认」的形状；已知假阳性面配着 dismiss 出口，「高风险」+「可能没事」按钮
   自相矛盾；坏读数真胜出自有高风险规则接手，Avery 可上调。
2. **「verbatim 原句」=读数本身，不是文档原行**。T6 钉死行号是块级兜底（可能指向标题行），
   照行取原文会引到标题——evidence 刻意**不带行号**，文档名+上传日是今天能背书的全部。
   真双引文（字段级出处）要改抽取器，独立一票。
3. **一条冲突只上一条规则**：够得着时间方向（恰好两读数、都定位到上传日、天粒度严格一早一晚、
   新读数按词表严格更糟）归 FRESH，其余全归 CROSS-DOC。变异验证：撤掉互斥当场红。
4. **同一份文档内部的分歧不进场**（`doc_key` 集合 <2 跳过）：规则号叫 CROSS-DOC、文案说
   「不同资料」，对同文档分歧说这句话是撒谎。T6 限制 1 的正面处置，v1 明写不覆盖。
5. **person 冲突走「负责人处境=项目证据」通道**（`subject_ref == ownerId`，字段加 `owner.`
   前缀）。与 `_match_signals` 同款已知盲区：不指向任何在场负责人的冲突到不了任何卡——宁漏。
6. **FRESH 不做 done 豁免**：触发不是时间流逝而是新资料白纸黑字读到更糟；卡面 done、
   最新读到 blocked 正是最该确认的形状（匹配器 docstring 有全文）。

## 门（跑法与结果）

- 离线电池：`AVERY_BRAIN=mock AVERY_EXTRACTOR=heuristic AVERY_EMBEDDINGS=keyword
  python -m pytest -m "not smoke and not seedgate and not needs_keys and not needs_db" -q`
  → **3731 passed / 103 deselected / 4 xfailed**（新增 17 条，全在 test_decision_grading.py
  第 12/12b 节——那个文件是规则号白名单，别另起文件）。
- **变异验证 7/7 被抓**：M1 decision_cards 断线 / M1b briefing 断线 / M2 撤互斥 /
  M3 撤同日闸 / M4 撤跨文档闸 / M5 person 冲突无差别扩散 / M6 evidence 印 source_key 而非
  filename。M6 第一轮**没被抓到**（语料里 filename==source_key，T4 交接点过名的同一个坑），
  补 `test_conflict_evidence_prints_the_display_filename_not_the_join_key` 后真抓到。
- `./init.sh` 绿；`node scripts/i18n-orphans.mjs` 孤儿键 0。
- 前端相关区门（隔离端口：后端 8151 + preview 4179 + VERIFY_BASE，5173 被别的线占着没动）：
  button-family 13P / zh-purity（/home 干净，17 处残留全是既有已接受项）/ aria-zh 4P /
  contrast-smalltext 41P / flow-gap-phases 8P。
- **门语料未必展开过新 UI**（全绿≠采样过），所以另拍真链路截图人眼过：真 mock 后端 + 四文件
  真上传（T6 的真管道语料）→ zh/en 两壳 × 展开/收起/恢复/刷新持久 全流程。
  证据：`t7-card-zh.png` / `t7-dismissed-zh.png` / `t7-card-en.png`（本目录）。
  dismiss 刷新后持久=真（localStorage 分桶）。
- 新元素对比度手测两皮：setaside 说明行 4.97 ≥ AA 4.5。
- **没跑全 A 电池**：worktree 里 visual 门是几十张「没有基线」假红 + 5173 归属他线（同 T4 判断）；
  本票改动面（决策卡展开区）由上面五道门+人眼截图覆盖。

## 已知局限（不藏）

1. **R-FRESH-CONTRADICTS-STALE 今天在生产一次都不会亮**：每次 /ingest 铸新 context、同批
   `uploaded_at` 同刻，天粒度下永远排不出新旧（这正是同日闸的本意）。等 **T2 表单线**把时间轴
   拉开后它才有命中面——与 T4 的 R-STALE-EVIDENCE 同款局限，同款理由，已写进说明书。
   演示要看它得备 `uploaded_at` 挪开过的种子。
2. **已知假阳性=设计内**：同日期两种写法/同部门两种叫法会报「对不上」（T6 v1 不做归一化），
   dismiss 出口就是为它开的。测试语料故意用了这个形状并注明。
3. **subject_ref 撞 id**（T6 限制 4，`_slug` 截断）：两个共用 id 的项目会共享冲突命中。
   本票没修（是 `_slug` 的既有限制），发生面极窄。
4. **evidence 的 `owner.team` 等机器键原样上屏**——与既有 `status="blocked"` 同一口径，
   不是漏译（zh-purity 对 /home 判干净）。
5. dismiss 按 evidence 内容派生键：同一冲突在 zh/en 壳下键相同（evidence 语言中立），
   但**换设备不同步**（localStorage 本地账，与差距卡 dismiss 同款局限）。

## 给下一个人的坑

1. 造冲突语料时**让 filename ≠ source_key 至少一条**，否则「印错哪个名字」类变异恒绿（M6 教训）。
2. `_conflicts_for` 的两条归属通道都用**实体 id**（subject_ref / ownerId），不是姓名——
   `_link_owners` 在 dedupe 后跑，id 已对齐（T6 有门钉着）。
3. 想给冲突加字段：改 T6 的 `_CONFLICT_FIELD_ALLOWLIST` 只解决「记账」，上卡侧无需改
   （`_conflicts_for` 字段泛型）；但「更糟」方向只认 status，新字段想进 FRESH 要自己给排序。
4. 前端 `CONFLICT_RULE_IDS` 是 HomeScreen 里的 Set——加第三条冲突类规则记得同步，否则新规则
   渲染成普通竖排证据（不算错，只是没双栏没出口）。

## 记账口径

- issue **#56** 正源，commit 走 `feat(#56)`，收尾关 issue。
- `feature_list.json#feat-099`（done 四字段指针）→ `feature_archive.json#feat-099` 完整记录。
  T6 没建条目、T1/T4 建了——按 AGENTS.md DoD 从 T4 口径。
- dist 收尾时指向 `http://127.0.0.1:8151`（本线验证残留，端口已死，**无毒**；下次 init.sh
  的 build 会重打。真正危险的是被 bundle-privacy 重打成生产域名那种，本线没跑 C 区）。
