# Session Handoff — 2026-07-05（双线战略圆桌：Avery Live 毕业 + 两引擎内核 / ADR-0020·0021）

> **接续只靠本文件 + `progress.md` + `feature_list.json`，不回放聊天记录。** 本 session 是**战略圆桌**（无编码，`src/` 一行没碰），产出决策 + 文档 + 下几个 session 的启动资料。完整讨论记录见 `docs/strategy/2026-07-05-dual-line-strategy-roundtable.md`。
> ⚠ **本 session 的战略文档均未提交**（见 §3）——Danny 审后拍板提交；agent 未代提交。

## 0 · 一句话现状
路演 + 酒店/建筑洽谈后定**双线并行**，本圆桌把架构逐条 grill 锁死：
- **Line A（给国内融资团队）= 真 LLM 顾问**，**graduate 现有 Vite demo → "Avery Live"**（story+live 双模），后端复用 `eval-harness`。
- **Line B（酒店先行，婚宴亮点）= 换皮**（Capabilities 包 + skin + 客户上传数据）。
- **内核 = 两个引擎**：advisor（`eval-harness`，已存在）+ **ingestion（新建、更重：上传→解析→全向量 RAG→填 Your team→喂回答卡）**。

决策落 **ADR-0020**（graduate+seam，超越 ADR-0001）+ **ADR-0021**（两引擎+换皮+双端）；新工作项 **feat-015..020** + 各 kickoff。

## 1 · 本 session 产出（文档，未提交）
- 战略记录：`docs/strategy/2026-07-05-dual-line-strategy-roundtable.md`（缘起 / 反转 / 10 决策 / 两引擎 / 换皮 / 双端 / AFK / 路线图）。
- ADR：`docs/adr/0020-avery-graduates-from-demo-only-to-live-lite-product.md`、`docs/adr/0021-two-engine-core-vertical-packs-skins-dual-deploy.md`。
- 术语：`CONTEXT.md` 新增 **Product surface** 组（Avery Live / Story-Live mode / Ingestion / Company context / Vertical pack / Skin / Sampler）+ Capabilities/Dashboard 各补一句指针。
- 工作项：`feature_list.json` feat-015..020（全 not-started，JSON 已 `node` 验证 21 条）+ `.issues/feat-015..020/kickoff.md`（AFK 冷启动可读）。
- memory：`afk-self-loop-minimize-danny`（AFK 自循环硬约束）。
- **真实集成图**：`docs/strategy/2026-07-05-real-integration-map.md`（逐表面 现脚本源→live 真源 + R1/R2/R3 决策 + 三颗红线地雷；feat-016/017 施工图）。

## 2 · 锁定事实（不要 re-litigate；★ = 本圆桌新增）
- **★ ADR-0020**：demo 不再 demo-only，graduate 成 **Avery Live**（story+live 双模）。两道 seam：`StreamSource`（Nexus 终端）+ `TeamDataSource`（Your team），story=脚本 / live=真数据。**story mode 保留 = 不动 rail 回放机器**（ADR-0003/0006/0012/0013/0014 全 honored）。ADR-0001 被超越。后端 = Python agent 服务（FastAPI+SSE 包 eval-harness），LLM key/loop 不上前端。
- **★ ADR-0021**：内核=两引擎（advisor + ingestion **全向量 RAG**）。换皮=Capabilities 包+skin+客户上传数据；**酒店先行（婚宴亮点）**。**红线内建到 ingestion 抽取**（简历→人卡只到定性，绝不评分/排名/画像）；红线扫描扩到 **live 产出**。双端（境内中文 MiniMax / 海外英文 Claude，pluggable brain+embeddings+retrieval）。
- **★ 内核 = 两引擎**（Danny 纠正抬高的定义）：advisor 不只是唯一核；ingestion（上传→公司事实）是更重的一条腿，且 v1 一步到位全向量 RAG（AFK 让工程量由 agent 吃）。
- **★ 真实集成取舍（07-05，见 `docs/strategy/2026-07-05-real-integration-map.md`）**：demo 的 `ONBOARDING` 已演的就是 ingestion；live 把 `PEOPLE/PROJECTS/SIGNALS/AGENT_OUTPUT/BRIEFING` 从写死常量换成 ingestion 实体 + agent 生成，经两道 seam。**R1** reality-gap 混合（live 文档内弱版 + story 满血）；**R2** 聚合数字真算或不显示（不编）；**R3** v1 core five live（Onboarding/人卡/项目卡/终端流/8 字段卡/Briefing）+ 弱版 gap，多人 Chat/满血 gap/Team map 关系留 v2。🔴 `Person.moodPct/capacityPct` live 永空。
- **★ 客户事实（07-05 晚，Danny 校正）**：Line B 两真实客户 = **三亚绿杉壹居度假酒店**（度假酒店，婚宴=业务线之一，非“婚庆公司”；包按酒店建模、婚宴作亮点）+ **byggsamverkan**（瑞典建筑，https://www.byggsamverkan.se/ ；已知栈=Teams/Outlook/CAD/一款纯建筑项目软件[查看费用材料、类 Excel，待查清产品]）。**国内调研走 `/mmx-cli`、境外走普通 web；调研结果落 `D:\Boyle\research\`（项目外）**（memory `domestic-research-use-mmx-cli`）。
- **商业模式（现行口径，committed）**：四层付费、**无免费层**——付费 Pilot → Setup → Manager seats（经常性收入主体，按 manager 计费，playbooks 折席位内不单卖）→ Benchmark。**口径以 committed `CONTEXT.md` § Commercial language 为准**（旧"advisor 免费+playbooks 付费"作废）。Line A **sampler=漏斗顶端演示面，非免费产品层**（ADR-0021 §6 护栏）。独立 ADR = **ADR-0019，已落盘并提交**（07-05 Danny 确认恢复，见 §3）。
- 品牌 Avery；overseas-first 英文默认，但 **Line A 双端要境内中文**；中文一律 M3 生成（memory `chinese-copy-via-m3`）；ADR-0018 定调（产品真理=管理决策层，人情味降红线）；ADR-0016 果断双向。
- **★ AFK 硬约束**（memory `afk-self-loop-minimize-danny`）：dev+test 自跑自验自修，HITL 只留审字/价值观/授权/评分/promote。
- **★ ADR 编号**：0019=商业模式（已落盘）、0020=graduate、0021=两引擎。别撞号，**代码类下一篇从 0022 起**。
- standing 约束不变：不动 rail replay 机器 / store 契约(ADR-0013) / camera(ADR-0012) / terminal-stream(ADR-0014) / 内部命名 / ADR 历史 / archived。

## 3 · 仓库当前态
- 分支 `main`，HEAD `2f76ceb`（Danny 的 ADR-0019 恢复提交；与 `origin/main` 同步）。**代码 `src/` 一行没碰。**
- 本 session 只加/改**文档**（全部**未提交**，Danny 审后拍板）：
  - 改（tracked）：`CONTEXT.md`、`feature_list.json`、`progress.md`、本文件。
  - 新（untracked）：`docs/strategy/2026-07-05-dual-line-strategy-roundtable.md`、`docs/strategy/2026-07-05-real-integration-map.md`、`docs/adr/0020-*`、`docs/adr/0021-*`、`.issues/feat-015..020/`。
- **⚠ 会话中途磁盘变化（如实记录）**：会话开始时未追踪存在的 `docs/adr/0019-commercial-model-*.md` 与 `docs/commercial-alignment-for-cythia-*.md` 现已**从磁盘消失**（被清理）；`docs/adr/0019` 从未 commit。**商业模式决策未丢**——它在 committed `CONTEXT.md` § Commercial language。若要恢复 ADR-0019 文档形态，需 Danny 确认（我未擅自重建被清理的文件）。→ **已解决（07-05 晚）**：Danny 确认，商业线 session 原样重建三文件（`docs/adr/0019-*` + Cythia 对齐清单 en/zh）并已单独提交。
- 无代码改动 → `./init.sh` 状态不变（上次绿于 feat-014 修复后）。

## 4 · 留给 Danny 的 HITL
- **旧账（仍有效）**：feat-014 全部新英文 copy 审字（`src/data/fixtures.home.ts` 等）+ **tm2 promote**（停在 `tm2-osj7dqiwv`，审字后 `vercel promote`，**agent 不得代做**）；路演 landing `en.ts` 审字；真人 eval 评分；合伙人 IP 具名授权。
- **本圆桌新增**：
  1. 审阅 + 提交 2026-07-05 战略文档（§1/§3）。
  2. ~~决定是否恢复 ADR-0019 商业模式文档~~ → 已确认恢复并提交（07-05，商业线 session）。
  3. feat-016 的 embeddings/向量库选型确认（默认 pgvector+pluggable，可异步"按推荐"）。
  4. feat-019 补酒店/婚宴内行 know-how（几条）。
  5. ~~有无酒店/建筑下次见面硬日期~~ → **无硬日期**（07-05 Danny 确认）；feat-019 按 AFK 常规节奏，不冲刺。

## 5 · 下一步（路线图详见 strategy doc §9）
**D5「并行起跑」三条立即可 AFK 起跑线：**
1. **feat-015** Agent service（FastAPI+SSE 包 eval-harness，live-input）——`.issues/feat-015/kickoff.md`。
2. **feat-019 的 pack-authoring**（酒店行业调研 + 起草 v1 包，/mmx-cli，混合 authoring）——`.issues/feat-019/kickoff.md`。
3. **feat-020** 办公软件集成可行性调研——`.issues/feat-020/kickoff.md`。

**紧随**：feat-016（ingestion 大核，←015）→ feat-017（前端毕业+两 seam+i18n，←015+016）→ feat-018（双端部署，←017）；feat-019 全链演示 ←016+017。

**旁支（不急）**：feat-014 审字 → promote；营销工作区 `D:\Boyle\marketing-resource\avery`（注意 ADR-0018/0020/0021 + 现行商业模式后定调/架构已变，需按新 `CONTEXT.md` 校对）；死 CSS 清理。

## 6 · AFK 线进展（本 session 起跑，integrator 滚动更新）
- **feat-020（建筑调研）✅ done（07-05，核心+supplement）**：产出 `D:\Boyle\research\skeppsviken-construction\`（README 全报告+§0.A-C Skeppsviken 画像 + feasibility-table + sources）。★反转已解：`byggsamverkan.se` = 建筑 PM 软件 **Next Project**（厂商 NEXT，前身 Byggsamordnaren）厂商页、**非客户官网**；**真实客户 = Skeppsviken**（skeppsviken.se）= 西瑞典建筑+地产集团（Göteborg+Skövde，约 152 人，自营土建，做学校/养老/体育馆/住宅），Teams+Outlook+CAD+建筑 PM 教科书契合。四款软件全开放 API（Teams/Outlook=MS Graph；CAD 假设 Autodesk APS；PM=Next Project REST）；roadmap lite=导出上传、企业 live 优先 Graph>Next Project>APS。**HITL 余（合伙人一句话，决定 API 路径）：PM 是云 Next Project 还是旧桌面 Byggsamordnaren + CAD 具体产品**（内部工具公开查不到）。
- **feat-015（agent service）✅ done（07-05，AFK 门全绿）**：新包 `eval-harness/service/`（FastAPI+SSE 包 engine，3 端点 /health·/advise·/advise/sample；contract.py 把 3 字段投影成 8 字段 + API 边界重跑红线）。pytest 141 passed（零回归）+ 真 API 冒烟过（MiniMax-M3 39s）。**代码在 worktree `.claude/worktrees/agent-ac44e3f46118f46ca`（branch worktree-agent-...），未 commit、src/ 未碰、待整合进 main**。HITL：contract.py 英文 fallback 串待审字。（旧账：清掉前次残留 :8137 uvicorn PID 38924。）
- **★ D5 三条并行线全部回（07-05）**：feat-015 ✅ / feat-019 研究+包 slice ✅ / feat-020 ✅。
- **★ AFK 串行链 `feat/live-core-015-018`（07-05，Danny 授权逐步自合并、终验收）**：f965bad docs → 4517f0e feat-015（pytest 141）→ 4e1bac0 feat-016（pytest 169，红线抽取门绿）→ **feat-017 WIP（前端毕业→Avery Live，`./init.sh` 构建绿，但 agent 被 session 限流[8:40pm Asia/Shanghai 重置]打断、runtime AFK 门未跑完——已提交保命，待补验 story 回归/live DOM/红线扫描/i18n-zh）**。**feat-018 未起**。主 `main` 不动，Danny 分支终验收后 merge。
- **feat-019（酒店包）✅ 研究+包草稿 slice done（07-05）**：mmx smoke ✅；客户核实=三亚绿杉壹居度假酒店（海棠湾豪华度假村，2024-12 开业，阳光保险投资，211 房+30 别墅，962㎡ 阳光草坪=婚宴 showcase）。外置 `D:\Boyle\research\sanya-lushan-yiju-hotel\`：00-findings + pack-draft（5 案 htl-001..005 同 HR 包形状 + 5 PB+6 信号+5 护栏，红线自检零人评分，MOCK JSON valid）。**待 feat-016/017**：skin+demo+repo 集成。**HITL：Danny 补 9 条内行 know-how**（pack-draft 9 TODO / 00-findings §F）。

## 7 · 指针
- 本圆桌：`docs/strategy/2026-07-05-dual-line-strategy-roundtable.md` · **`docs/strategy/2026-07-05-real-integration-map.md`（feat-016/017 施工图）** · `docs/adr/0020-*` · `docs/adr/0021-*` · `.issues/feat-015..020/kickoff.md`
- 内核基础：`eval-harness/`（advisor engine，feat-011 evidence）· `src/components/scenes/{NexusScene,HomeScene}.tsx` · `src/data/{cases,fixtures.home}.ts` · `src/store/*`
- feat-014：GH #9 · `docs/adr/0017-*` · `.issues/feat-014/plan.md` · evidence 在 `feature_list.json`
- 路演线：`.issues/roadshow-landing-0703/session-handoff.md` · `docs/adr/0018-*`
- 定调/红线/商业：`CONTEXT.md`（ADR-0018 后新版 + Product surface + Commercial language）· ADR-0015/0016/0018
- 角色班子：`roles.md`（Dana 收窄为红线门神）
