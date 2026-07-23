# receipt-B · issue 07 三亚富语料 pack（B 线并行）

> AFK 夜跑 B 线收据。分支 `claude/rich-corpus-b-a68e66`（off `claude/layout-real-components-27b594`
> 的 tip `ba24144`）。一 commit，未推（push=人工闸不动）。与 A 线井水不犯河水：只碰
> 语料/seed/期望/门文件，**未动抽取器与 CRUD 前端**。

## 一句话

照 issue-01/02/03 定稿语法**照现有抽取器写满**一套原创三亚酒店富语料（虚构皮「三亚屿澜湾度假酒店」，
她方 demo 文本零抄袭），16 人 / 6 项目 / 5 份 SOP 方法卡，**原地替换** `tests/fixtures/demo-seed`
（零 env 漂移），同 commit 把 `test_demo_claim.py` 与 `verify-onboard-gate.mjs` 的期望从「云岭 2 人世界」
换到「三亚 16 人世界」并加 T9 满态断言。离线三件套下 heuristic 路径可抽全部富字段，claim 返 200 非 503。

## 语料清单（9 份，全 .md，均 ≤8MiB、格式在 SUPPORTED_EXTS、总数 ≤15）

| # | 文件 | doc_kind | 贡献 |
|---|---|---|---|
| 1 | `员工花名册.md` | roster | **16 人唯一真值源**：姓名(代号)/职位/部门/司龄/负责 五列，格式照现 seed 花名册；`负责`列→owns |
| 2 | `项目总览.md` | project | **6 项目**（6 个 `## 项目：X` 小节），每个写满 负责人/自报状态/进度/风险/里程碑(4 项)/截止/阻碍项/概述 |
| 3 | `本周周报.md` | project | **`## 人员动态` 段 16 人全员各一行自述**（`- 小X｜负载自述：NN%｜情绪自述：如常/偏紧/吃紧`）+ 进度/阻塞 prose |
| 4 | `公司概况与部门手册.md` | company | 酒店概况+业务线+部门职责（RAG 材料） |
| 5 | `婚宴BEO与协调会纪要.md` | unknown | 宴会通知单(BEO)+协调会纪要（RAG 材料） |
| 6 | `管理规范与升级红线.md` | unknown | **5 份 SOP 方法卡**（`## 方法：` + `适用：` + `要点：` 列表 + `标签：`，PRD D 节语法，供 08 抽卡） |
| 7 | `旺季排班协调纪要.md` | unknown | 旺季跨部门排班协调（RAG 材料） |
| 8 | `小马_简历.md` | resume | 市场营销/渠道背景，代号=小马（与花名册聚卡） |
| 9 | `小徐_简历.md` | resume | 宴会销售背景，代号=小徐（与花名册聚卡） |

**16 代号（跨文档逐字一致）**：小王 小张 小李 小陈 小刘 小杨 小黄 小周 小吴 小徐 小孙 小马 小林 小郑 小何 小罗。
分布=总经理×1 / 前厅×3 / 客房管家×2 / 餐饮×2 / 厨房×1 / 宴销×2 / 市场预订×2 / 康乐×1 / 工程×1 / 人力×1（对齐 issue §二）。

**6 项目**（锚定调研真实业务线）：草坪婚宴旺季档 / 亲子暑期产品线 / OTA 渠道分销 / 微信商城改版 /
宴会菜单升级 / 别墅区工程整改。

## 门绿证据（全离线，mock+heuristic+keyword 三件套，绝不碰 minimax）

1. **`pytest tests/test_demo_claim.py`（四 deselect 必带）→ 15 passed**：含 4 条新 T9 断言
   - `test_chinese_names_stay_distinct_in_a_clone`：16 代号全在 + 恰 16 人 + id 不撞（无 CJK 撞名分裂/误聚）
   - `test_sanya_claim_returns_200_not_503`：整包铸造红线零触发
   - `test_sanya_six_projects_carry_full_rich_fields`：6 项目全在，每个 progress(0–100)/risk(词表内)/milestones(name+归一 status) 键都在
   - `test_sanya_selfreport_sixteen_when_scoring_on`：开关开→顶层 scoring_enabled、16 人各一条 self_report、每条带 caliber+source 且 source 指回周报
   - `test_sanya_selfreport_absent_when_scoring_off`：开关关（默认）→ self_report 整槽不投影、无 scoring_enabled（moat 守住）
2. **全量离线套 → 3402 passed / 0 failed / 65 deselected / 4 xfailed**（基线 3398 + 本片 4 条 T9 = 3402，**additive 零回归**）。
3. **`verify-onboard-gate.mjs` → 39 PASS · 0 FAIL**（世界 A/B/C/D/E 全绿）：
   - 世界 B：demo 门渲染 → 点击真拿克隆副本 → 16 代号各自成卡（id `u_小王`…`u_小罗` 全不撞）→ demo:true →
     预铸「实时数据缺位」笔记继承 → 闸门关 → 落 `/home` → onboard status=done。
   - 🔴 **在本 worktree 自建隔离端口跑**（preview **5273** + backend **8237**，`AVERY_DEMO_SEED_DIR` 指本 worktree seed），
     **不碰 A 线的 5173/8137**。跨端口需放行 CORS：起后端时带 `AVERY_CORS_ORIGINS=http://localhost:5273,http://127.0.0.1:5273`
     （否则浏览器跨源拦 `/demo/status` 探测→demo 门不出=假红；后端日志照样 200，前端 fetch 被拦）。前端 build 走
     `VITE_AVERY_API_BASE=http://127.0.0.1:8237`（打包期内联，非运行时）。跑完已拆本片自建的 5273/8237，A 线三口原样。
4. **HTTP 实跑 `POST /demo/claim`（8237）→ 200**：demo:true、16 人（花名册顺序）、6 项目富字段（progress/risk/#ms=4/due）、
   开关关世界无 scoring_enabled、无 self_report 泄漏。`GET /demo/status` → available:true（demo 门能力探测）。
5. **越线自查（成稿免审但硬项）**：全 9 份跨文件 grep 打分/排名词表（打分|评分|得分|评级|绩效|排名|末位|垫底|淘汰|
   短板|隐患|低绩效|画像|潜力|考核|KPI|分数|榜|销冠|percentile|potential|low performer|scorecard）
   + 评分数字形（N/M、N分、N星）→ **全 CLEAN**。人身负载 NN% 只活在 self_report 专用槽（不在 `_person_text_fields` 扫描面），
   抽取红线 `validate_extraction` 实测 ok=True。

## seed 换法（E2 · 07-22 拍板：原地替换，零 env 漂移）

- **原地替换 `eval-harness/tests/fixtures/demo-seed/` 目录内容**：删旧 2 份（云岭花名册/周报）→ 写入本 9 份。
  `AVERY_DEMO_SEED_DIR` 路径**不变**（runbook §0 无需改），能力探测门与 claim 克隆隔离机制**零改动**。
- 母本 id 内容寻址 `ctx_demo_<sha1(文件名:大小)[:12]>`——seed 换了自动重铸，不删旧行；离线首次 claim 时 heuristic 秒铸。

## 设计决策与偏差（照实记）

- **6 项目全字段收口在 `项目总览.md` 一处**（Option A）：weekly 只写自述行 + prose 进度叙事，**不写结构化 `## 项目：`/字段标签行**，
  故 weekly 的整档 phantom 项目被 granularity **R4-document-not-project 稳定降级**（实测 ruling 命中），周报**零结构化项目**，
  项目源单一→跨文档 dedup 无顺序依赖，「6 项目全在」对 seed 文件排序**确定性**成立（避 CJK 文件名排序坑）。进度/阻塞
  在 weekly 走 prose（入 RAG 材料，advisor 可引），结构化进度在总览。
- **脱敏简历用 `.md` 而非 `.pdf`**（issue 原文写 pdf×2）：判断依据——(a) `.md` 在 SUPPORTED_EXTS、heuristic 确定性可抽、
  免二进制生成风险；(b) 简历人名必须=16 代号之一（小马/小徐）才能跨文档聚卡，直取 `0721-脱敏seed` 的 5 份地产销售 pdf
  会引入非代号真值名→撞破「16 人聚卡+代号逐字一致」硬约束，故按其**结构**（求职意向/核心概况/教育/工作经历/自我评价）
  原创改写为代号简历。硬约束（≤15 份、≤8MiB、格式在支持表、跨文档人名一致）全满足。
- **`extraction_mode=heuristic` 标签**：该键由 `/ingest` 端点产出（ingest_api.py:352），**`/demo/claim` payload 不带**此键
  （`_team_payload` 无此字段）——故该 acceptance 子句归薄文档/上传世界，claim 世界以「200 非 503 + 富字段真抽出」证明
  heuristic 离线通路（后端 `/health` 亦报 `extraction_mode:heuristic`）。未为此改后端（越 B 线范围）。
- **薄文档对照世界（T9 另一半）**：1–2 份真客户样例上传→诚实收起，属**上传/前端电池**相位，非 demo/claim 门；本片
  以 onboard-gate 世界 B/D 为 demo 侧准（07-22 读门后写死），薄文档断言留 A 线/收官电池覆盖。

## ⚠️ 部署提醒（写给 C 线/上线）

- **生产首次 claim 为 LLM 铸造分钟级**（离线 heuristic 秒出，生产走 LLM 一次）：**部署后需手动 `POST /demo/claim` 暖场一次**，
  把母本铸出来（顺便人工验铸造质量），之后访客 claim 全走秒级克隆。
- seed 内容一变（增删文件/改大小），母本 id 自动变→下次 claim 重铸；ops 可用 `AVERY_DEMO_CONTEXT_ID` 显式钉死。

## 未动 / 交接

- **未改** `session-handoff.md` 抬头（留给 C 线收官换头）。
- **未推**（push=Vercel 自动上产=人工闸，等 Danny）。
- 本片属 B 线，A 线（05a 前端半→05b→06 CRUD 主线）与 C 线（08→11 收尾）汇合时把本分支合回 campaign 分支。
- 像素基线：本片**零像素影响**（只换 seed 数据，未动前端源码/构建产物形态；满态渲染观感归 01–04/08 的像素门）。
