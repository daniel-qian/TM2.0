# 07 · 三亚富语料 pack

## What to build

原创写成 9 份三亚酒店文档（她方 demo 文本零抄袭），16 人/6 项目，富字段按 01-03 定稿语法**全写满**，SOP 3-6 份按 PRD D 节语法写进管理规范文档；接进 demo seed 目录（env 指向新目录或替换目录内容，**零代码**）；「示例团队」门一键 claim 即进三亚满态。语料与抽取器同稿共测：heuristic 路径（离线三件套）必须抽得出全部富字段。

引用 PRD User Stories：19（一键 30 秒进满态）、23（每个富字段能指回源文档）、26（「实时数据缺位」等诚实边界继续存在——预铸笔记由后端产生，语料不自带）。

## 字段/接口决策

（PRD F 节+语料摸底）
- **9 份文档**：①员工花名册.md（16 人唯一真值源：姓名/职位/部门/司龄/负责表格行，heuristic 友好，格式照抄现 seed 花名册最安全）②公司概况与部门手册.md ③项目总览.md（人↔项目关系）④本周周报.md（进度/阻塞主命中面+「人员动态」段负载/情绪自述行——**16 人全员各一行，覆盖钉死**）⑤婚宴 BEO 与协调会纪要.md ⑥管理规范与升级红线.md（SOP 按 `## 方法：` 语法 3-6 份）⑦旺季排班协调纪要.md ⑧⑨脱敏简历 pdf×2（直取 0721-脱敏seed）。
- **6 项目**锚定调研真实业务线：草坪婚宴旺季档/亲子暑期产品线/OTA 渠道分销/微信商城改版/宴会菜单升级/别墅区工程整改；每项目配 `进度：`+`风险：`+`里程碑：` 全语法行（01/02 定稿表）；状态/负责人/截止/阻碍项既有语法照写。
- **16 人分布**照语料摸底 §二（总经理/前厅 3/客房管家 2/餐饮 2/厨房 1/宴销 2/市场预订 2/康乐 1/工程 1/人力 1）；人名一律小王/小张式代号，**跨文档逐字一致**（CJK 聚卡教训）。
- **硬约束**：打分/排名文字触发抽取红线→整包 503 拒铸（pack-draft cases 的 `baseline_raw` 是故意越线样本，**绝不带入**）；≤15 份、单文件 ≤8MiB、格式在 SUPPORTED_EXTS；虚构皮沿用（真实酒店只当素材源）。
- **seed 接入（E2，07-22 拍板）**：**原地替换 `tests/fixtures/demo-seed` 目录内容（零 env 漂移）**；母本内容寻址（文件名:大小）自动重铸；能力探测门与 claim 克隆隔离机制零改动。同片更新依赖该 seed 的 `eval-harness/tests/test_demo_claim.py` 与 verify-onboard-gate 期望（云岭 2 人世界→三亚 16 人世界：中文名断言、聚卡数等）。
- 素材源：`D:\Boyle\research\sanya-lushan-yiju-hotel\{00-findings.md, pack-draft\, 0721-脱敏seed\}`；facts.md 行号契约被 case 引用——**只抄不动原件**。

## Acceptance criteria

机器可验：
- [ ] T9 满态断言探针：`POST /demo/claim` → payload 断言 16 人聚卡数恰对（无 CJK 撞名分裂/误聚）、**self_report 条数=16（全员各一行）**、6 项目全在、每项目 progress/risk/milestones 键在且值对、周报自述行入 self_report（开关开世界验，开关关键缺席）、SOP 小节可供 08 抽出 3-6 张卡。
- [ ] claim 返回 200 非 503（红线零触发）；extraction_mode=heuristic 诚实标签在。
- [ ] test_demo_claim.py **同片改期望后**绿（seed 换内容→母本自动重铸；云岭中文名/2 人断言→三亚 16 人）；verify-onboard-gate **同片改期望后**绿（世界 B 的「林晓梅/郑国豪」断言→三亚代号；demo 门渲染+claim 成功进 home）。
- [ ] 若最终改用新目录而非原地替换：必须同 commit 更新 runbook §0 后端启动行的 `AVERY_DEMO_SEED_DIR`。
- [ ] 薄文档对照（T9 另一世界）：1-2 份真客户样例上传→诚实收起+降级标签（富字段键缺席不编造）。
- [ ] demo/claim 离线验证=verify-onboard-gate 世界 B/D 对应世界绿（heuristic 路径全字段可抽）——AFK snippet 无 demo/claim 相位，此处以 onboard-gate 门为准（07-22 读 verify-onboard-gate.mjs 后写死）。

需人眼：
- [ ] 语料通读一遍自查：原创性（她方文本零抄袭）、代号跨文档一致、无任何打分/排名文字。成稿免审字（07-22 拍板），越线自查仍是硬项。

## 波及面与红线

既有门波及：verify-onboard-gate（demo seed，世界 B/D）、test_demo_claim.py、demo 能力探测（/demo/status）。

红线（runbook §2/§4）：原创零抄袭；打分文字=红线炸整包；成稿免审但界面文案照旧 en.ts 纪律（语料文档为中文原创不走翻译管道）；人名代号+逐字一致；ADR-0029（语料是真管道的输入，不是注入）。

陷阱：生产 LLM 铸造分钟级→部署后手动 claim 暖场一次（写进 handoff）；同名文件防互踩；写语料前先读 01-03 的落地注释（语法以实现为准复核一遍）。

## Blocked by

01、02、03（字段语法定稿并落地后，语料才能同稿共测）
