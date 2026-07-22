# 03 · 人员负载/情绪·开关口径

## What to build

端到端：周报「人员动态」段的自述行 → 抽取器**永远抽取**入 person 实体专用 `self_report` 槽 → payload 投影按开关决定发不发：开关关=整槽不投影，人面照旧零数字（现行为）；开关开=投影并在 payload 顶层带 additive 键 `scoring_enabled: true` → 成员卡按开关渲染：开=负载/情绪显示且**必带口径+出处**（系统可自证式措辞：「《<文档名>》记录的本人自述」标记元素——不直接断言「本人自述」，作者身份系统验不了）；关=一个数字都没有。四层加固全部改为开关化两世界执法；分数表/排行榜/横向对比结构**两世界无条件禁**（机器判据边界：禁=每人一行数值表/排序榜/跨人分数并列；不禁=目录筛选 chip，见 PRD C 节裁决）。两世界都进门（真栅栏：开考「必须带出处」，关考「一个数字没有」）。

引用 PRD User Stories：15（开关开＋口径出处）、16（开关关零数字）、27（只自述+开关才展示）、28（关=卡上零数字）、30（任何界面无横向比较分数表/排行榜）；29 由既有信号情境化机制回归保障，本片不改它但不许弄坏。

## 字段/接口决策

（PRD A3，本战役最要紧的设计决策）
- **存储**：person 实体加 `self_report` 子对象 `{load?: {value, caliber, source}, mood?: {value, caliber, source}}`，caliber+source 必填；既有人身禁键表语义不变——**合法数字只能活在自述槽**（把红线写进结构）。
- **抽取**：语法照 01 定稿表第 4 行（`- 小王｜负载自述：85%｜情绪自述：吃紧`）；只认带 `自述` 后缀标签，无「自述」字样的人身数字一律不抽；负载仅收 0–100；情绪词表 如常\|偏紧\|吃紧 映射定性枚举；caliber=本人自述、source=所在文档名。LLM prompt 同步，两路形状一致。
- **红线门**：抽取红线只放行 self_report 槽；散落在 person 上的自由数字键仍全禁。
- **投影开关**：走既有 AVERY_ALLOW_PERSON_SCORING（scoring_policy，默认关）；关→self_report 整个不投影；开→投影+顶层 `scoring_enabled: true`（仿 demo/account_linked 缺席语义）。demo 母本不随开关重铸（内容寻址只看文件，开关只影响投影）。
- **前端**：transport LivePersonCard 加 optional `self_report?`（类型层仍无自由数字键，第②层护栏不松）；第③层运行时剥离改两世界：scoring_enabled 缺席/false→现行为一切 number 键全丢；true→仅放行 self_report 白名单，渲染处强制带口径+出处标记元素（如 `data-metric-source` 属性锚点）；第④层渲染纪律注释改开关口径，**不回抄「永不打分」绝对句**。

## Acceptance criteria

机器可验：
- [ ] AFK 门（live-frontend-gate.snippet.js）血条正则改造：**grep BLOOD_BAR_RE 全部使用位点逐个改造**（当前已知位点：assertTeamRendered / assertTriageRenders / notes numberLeak / vision mock person，以 grep 结果为准）+ assertAskRedline K6「人卡任意数字即红」改两世界：读壳上开关标记；关=零数字断言原样跑；开=数字只许出现在出处标记元素内，元素外仍跑 BLOOD_BAR_RE；score-table/leaderboard/横向对比结构（每人一行数值表/排序榜/跨人分数并列）两世界无条件禁，筛选 chip 不在禁列。**两世界各实跑一遍全绿**（本片交付全相位 headless runner，跑法照 runbook §1b「AFK 门离线跑法」——mock 三件套+verify-skin-phases 注入模式，两世界=两次后端重启，🔴 绝不照抄 live-frontend-gate.md 的 AVERY_BRAIN=minimax）。
- [ ] 出处锚点断言（门改造一部分）：凡渲染 self_report（含情绪定性枚举词）的元素必须带 `data-metric-source` 锚点；情绪词表词（如常/偏紧/吃紧）出现在人卡且无锚点=红；关世界加「情绪词表词零出现」文本断言。
- [ ] verify-p0 的「0%」正则收窄到项目进度元素（防负载恰 0% 的人误伤；01 的项目栅栏语义不丢），收窄后门绿。
- [ ] 后端单测：自述行入 self_report（caliber/source 必填）；无「自述」字样的人身数字不入；散落数字键仍被红线拒；开关关 payload 无 self_report 无 scoring_enabled，开关开两者都在；heuristic/LLM 形状一致。
- [ ] e2e 探针：mini 周报含自述行 → 开关开 payload 断言 self_report 全形状；开关关 → 键缺席且人卡 innerText 零数字。
- [ ] verify-home-skeleton 绿（骨架块零数字不受影响）。
- [ ] 开关默认态=关（env 不设即关；收官验收复核项③的证据在本片落）。
- [ ] 实现落地后，若正则实际接受面与 01 字段表（自述行）有出入（全角/半角、分隔符、大小写），回填 01 字段表并标注，供 07 照写。
- [ ] 本片交付后把 run-battery.mjs 的 CURRENT_STICK 递增到本片 stick 号（8）。

需人眼：
- [ ] 开关开时成员卡口径+出处角标措辞（zh 文案 draft 待审字纪律照旧）。

## 波及面与红线

既有门波及（门影响面摸底 A 节，最重的门改造）：AFK 门 BLOOD_BAR_RE 全位点+K6、verify-p0（0% 收窄）、verify-home-skeleton；渲染落点=现 `.home-person-card`（目录形态归 04，DOM 类名锚点保留）。cr-align-spec 如需行用 **stick 8**（开关开形态走断言不走像素，见 PRD T10）。

红线（runbook §2）：人面数字=开关口径（07-21 解禁+07-22 拍板，CONTEXT.md 已改，别抄绝对句）；absent≠none；ADR-0029；出处必带；en.ts+zh 增量；判据吃 raw。

陷阱：AFK 门离线三件套（mock+heuristic+keyword）缺一真出网；开关只影响投影不影响存储——库里恒有自述数据是拍板代价（验收复核项②）。

## Blocked by

01（自述行语法定稿表）
