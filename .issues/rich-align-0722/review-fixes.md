# 满态对齐战役 · 校验发现修复台账（2026-07-22，20 条全落实）

| # | 改了哪 | 一句话 |
|---|---|---|
| F1 | prd.md C 节；issues/04 决策+e2e 探针；issues/03 出处锚点断言条 | 关世界定性格只许来自非 self_report 字段（focus/职责）；情绪词表词+口径角标关世界零出现，03/04 各加文本断言 |
| F2 | issues/07 决策④+T9 探针条 | 周报自述行钉死 16 人全员各一行；T9 断言 self_report 条数=16 |
| F3 | issues/11 对照板条 | 满态并排开关开（带角标）+关世界各拍一版都入 reports；像素基线维持关世界 |
| F4 | prd.md T1；issues/03 门改造条+新增出处锚点断言条 | 横向对比结构机器判据边界（禁：每人一行数值表/排序榜/跨人分数并列；不禁：筛选 chip）+ data-metric-source 锚点断言（消 F11） |
| F5 | prd.md A1+A2 表；issues/01 表（照录同步）；issues/02 schema/渲染/e2e | 里程碑词表外走真 other：独立 other 点样式+照原样回显文档用词，不落 upcoming 灰 |
| F6 | prd.md C 节裁决段；issues/04 决策+e2e | 裁决落地：筛选 chip ≠ 横向比较；情绪 chip 行挂「按本人自述筛选」角标；筛选结果禁排序/禁情绪计数徽章（组别计数可） |
| F7 | prd.md A3+US15；issues/06 红线核心；issues/11 复核项④ | 明文承认文档通道作者身份不可验证；口径改系统可自证式「《本周周报》记录的本人自述」；不对称进表单签认 |
| F8 | issues/05、issues/06 各加 acceptance 条 | PATCH 置空→键缺席/null→data-empty-kind=absent「文档未提及」，绝不 0%/空串默认 |
| F9 | issues/11 终检断言条+复核项 | footerText 含「不能只拿它当依据」、visionSummary3 含「不会成为人事决策的唯一依据」；表单加「承诺脚注原样在」 |
| F10 | issues/08 渲染决策+button-family 条 | 方法卡=非交互 div/article 不渲染 button，扫雷 D 系焦点断言免除；删「若为 button」骑墙句 |
| F11 | （并入 F4） | 情绪词表词出现在人卡且无 data-metric-source 锚点=红 |
| F12 | D:\avery\CONTEXT.md Ask 词条 _Avoid_ | 绝对句改为「Ask 回执永不成为人的属性、永不跨人比分（ADR-0023 仍有效）；人的量化呈现另走公司开关口径（见 Voice ①）」 |
| F13 | runbook §1 像素段；issues/README 像素条；issues/11 像素条+人工闸条+红线行；issues/01/02/04/08 需人眼措辞随行 | 统一为：片内目检 diff→存证 pixel-evidence/<片号>/→备份 .bak/→重冻→片内复绿；11 全量两轮含像素门；人工闸移到 Danny 晨审签认 |
| F14 | runbook §1（先读 run-battery.mjs 确认 A19/B3/C3=25、CURRENT_STICK=4、env 覆盖语义）；issues/README；issues/11；issues/01-06、08 各加 CURRENT_STICK 递增条 | 电池名单唯一权威=run-battery.mjs（25 门）；收官 `SPEC_STICK=99 node eval-harness/tools/run-battery.mjs` 两轮；删「17 门」；手写清单降级速查 |
| F15 | runbook 新增 §1b「AFK 门离线跑法」；issues/03 门改造条+波及面 | mock 三件套+照 verify-skin-phases.mjs 注入模式；03 交付全相位 headless runner；两世界=两次后端重启；🔴 禁抄 live-frontend-gate.md 的 AVERY_BRAIN=minimax；「四处改造」改「grep BLOOD_BAR_RE 全部使用位点」 |
| F16 | issues/07 seed 接入+acceptance | 拍板原地替换 tests/fixtures/demo-seed（零 env 漂移）；同片改 test_demo_claim.py+verify-onboard-gate 期望（云岭 2 人→三亚 16 人）；改目录须同 commit 改 runbook §0；demo/claim 离线验证写死=verify-onboard-gate 世界 B/D（读 mjs 确认 snippet 无 demo/claim 相位） |
| F17 | issues/10 决策三行 | 值来源=Supabase MCP get_project_url+get_publishable_keys（项目 avery）；落点=后端启动命令追加两 env（前端零配置）；30 分钟跑不通即固化线上演法；Supabase 探测出网允许 |
| F18 | issues/01、02、03 各加 acceptance 条 | 实现落地后正则接受面与字段表有出入（全角/半角/分隔符/大小写）→回填 01 字段表并标注，供 07 照写 |
| F19 | issues/README 尾部两行 | 新探针一律落 .issues/rich-align-0722/verify-*.mjs（tracked 不入 roster）；「薄文档」指名 seed/ 的 LogiPulse pdf+PrismDesign xlsx，英文只做降级断言不进 zh-purity |
| F20 | runbook §0 | 加 pytest 行并标注四个 deselect（not smoke/seedgate/needs_keys/needs_db）必带，漏抄=真出网烧钱 |

超出修复单字面的同步（防口径自相矛盾，均已在上表注明）：issues/01 字段表是 PRD A2「全表照录」，F5 改 A2 后同步照录；prd A1 词表补「词表外→other」；prd US15 口径示例随 F7 改系统可自证式；issues/01/02/04/08 需人眼的旧「重冻在 11」措辞随 F13 统一；issues/11 红线行旧像素口径随 F13 改。
