# Session Handoff — 2026-07-07 收盘(救 15–20:确诊完成 + 补救计划已拍板 → 开工 S1)

> **接续只靠本文件 + git,不回放聊天。** 上一版(07-07 早「救 15–20」任务版)存档于
> `.issues/live-rescue-0707/handoff-0707-morning.md`;07-05 战略版:`git show 25e45fa:session-handoff.md`。
> 本 session(07-07 晚)完成了早版布置的两步:**① 确诊「为什么 15–20 临近崩盘」(复现+代码+管线三重验证)
> ② grilling 六岔口 → Danny 亲拍补救计划**。产出零实现代码,全是确诊 + 决策 + 落盘。

## 0 · 一句话现状
**确诊:管道真、门面假**——服务/SSE/RAG/红线/seam 骨架全部成立且实测能跑,advisor 问答腿端到端真通;崩在**抽取吃不动真实文档**(两个官方 seed → 1 个假人 "No." + 1 个文件名项目)与 **story 从 3 个缺口渗进 live**(空态左脊柱 / TeamComposer / 详情页)。**补救计划六岔口 Danny 全拍(2026-07-07),落 ADR-0022**:C 同仓立墙 + LLM 主抽 + 双层机器门,Gate 先红 → 双线并行。下一步 = S1 开工(feat-022 + feat-023)。

## 1 · 本 session 干了什么(时间序)
1. **恢复现场**:发现上 session 的未提交改动因分支切换被自动 stash(`epitaxy: pre-switch`),checkout `feat/live-core-015-018` + `stash apply` 完整恢复(8 M + 3 ??,`eval-harness/.env` 真 key 完好)。
2. **复现崩盘**(早版 §8 路径):起 :8137(minimax + dashscope 真向量)+ :5173,`?mode=live`,经真 UI 上传两个 seed 文件(File 注入真 input → 真 POST /ingest,响应原文在案)。
3. **确诊**(证据全在 §2):三个渗漏缺口精确到行;抽取双坑实测;「174 绿为什么没拦住」的机制层答案;advisor 腿真通的实证。
4. **grilling 六岔口**(一次一题、每题带推荐,Danny 逐题亲拍)→ 终拍「通过,按此执行」。
5. **落盘**:commit `53e0ef6`(feat-021 真向量)+ `4e90966`(fix 前端两修)+ 收盘 docs 批(ADR-0022 / plan.md / kickoff ×3 / feature_list feat-021..024 / progress.md / 本文件);push 分支;drop 冗余 stash;清理临时件与服务进程。

## 2 · 确诊(全部 verified,含复现证据)
- **live 空态渗漏**:眉题 "FROM YOUR UPLOADS" 下渲染 story briefing(Smart Shopping Guide)+ Lin Qing/Venus/Kate/Jason 四张剧本卡。机制:`useTeamData.ts:31` 在 live+未上传时回退 scripted 源当"类型占位",`HomeScene.tsx:366` 只把右栏换 UploadPanel,左脊柱照渲染占位源。**07-05 曾标 "cosmetic polish",实为信任破产**(产品谎称脚本内容来自你的上传)。
- **TeamComposer 整个在缝外**(新抓到,早版 §3 没有):`TeamComposer.tsx:115` 永远走 `canvasStore.askQuestion`(story 剧本机),live 下预填 story 主打问题、@引用菜单列 fixtures 人物。live 主页最显眼的输入框,打进去的问题进 story 剧场。
- **详情页只查 fixtures**:`ProjectDetailScene.tsx:74` / `EmployeeDetailScene.tsx:53`,live id 结构性 Unknown project/teammate。(本机 headless rAF 停摆点不动场景切换——已知坑;此条靠代码焊死 + Danny 真机亲见定案。)
- **抽取双坑(真 /ingest 实测)**:`PrismDesign_TeamProfile_EN.xlsx`(20 人规整表)→ **1 个"人",名字 "No."、role "Founder"、tenure "10 years"**(表头单元格变人);`LogiPulse-Roadmap.pdf` → 1 个项目=文件名、status=全文扫词的 at-risk、0 信号。机制:`parse.py` doc_kind 靠文件名关键词,`profile` 命中优先于 team → xlsx 走**简历单人**路径;`extract.py` `_projects_from_doc` 每文档只产 1 个项目;roster 路径焊死 Name 第 0 列(强制修正路由实验后仍只出 "No."/"Case ID"×2 三个假人)。briefing 同时写着 "nothing invented"。
- **174 绿为什么没拦住**:测试 fixture `Team_Roster.xlsx` 是按抽取器自己的假设反向定制的(文件名带 roster、Name 第 0 列、竖线行)= **数据层 maker==checker**,"自己出题自己考";加上 live 集成从未被任何人点过(Story/Live 开关曾因 pointer-events 死)。两者叠加,「全绿」与「产品崩盘」并存。
- **成立的部分(实测)**:`/advise` 带 context_id 问 "who leads design" → 语义 recall 命中上传 xlsx 行(facts.md:156 Chen Mingyuan)→ cite 行号 → 红线过 → 8 字段卡齐,建议有据(58s@M3)。质量缺口:top-k 漏了 "Lin Qing | Design Director" 最佳行(已转 feat-022 gate 断言);pypdf mojibake "�" 进语料。**红线全链路零违规——垃圾抽取下也没编过任何人的分数。**

## 3 · 拍板与计划(已定,不 re-litigate)
六岔口决策表 + S1/S2/S3 施工图 + 断言清单:**`.issues/live-rescue-0707/plan.md`**;架构决策正文:**ADR-0022**。一句话版:
- **C 同仓立墙**:`src/story/**`(冻结路演资产)/ `src/lite/**`(3 屏:上传空态 · Your team · The room 薄建 + 薄只读详情浮层)/ `src/shared/**`(卡片/字体/CSS 原子);ESLint no-restricted-imports 把 lite→story import 变机器红灯。
- **LLM 主抽**:LLMExtractor 接 pluggable brain,每实体带来源行号(cite 链不断),同一红线门;无 key 退 heuristic。**brain 现实可用 = M3 + DeepSeek(Danny 07-07 亲口纠正:海外 Claude 不存在——brain_factory 的 `claude` 是无 key 未验证代码路径,勿再假设)**。
- **双层机器门**:离线 golden 层 + 集成层(真 seed 具名断言:xlsx≥15 人含 Lin Qing/Chen Mingyuan、假人黑名单=0、pdf≥2 项目、cite 命中、mojibake 门;前端浏览器自驱 + story 名词黑名单=0)。**agent 当第一个用户,Danny 只抽查不设闸**(调和 AFK 记忆与本次教训)。
- **顺序**:S1 feat-022(gate 先立,**立完必红——红是成功**)+ feat-023(修绿后端)→ S2 feat-024(立墙修绿前端 + story 回归 rail 26 拍仍绿)→ S3 合流、Danny 抽查、merge main。

## 4 · 仓库当前态(精确)
- 分支 `feat/live-core-015-018`,链:`138e6d8` ← `53e0ef6`(feat-021)← `4e90966`(fix 两修)← 收盘 docs commit(HEAD);**已 push origin**。`main` = `origin/main` = `2f76ceb` 一动不动,S3 前不 merge。
- **工作树干净**;冗余 stash 已 drop;临时 staging(`node_modules/.avery-seeds/`)已删;:8137/:5173 已停。
- `eval-harness/.env` 真 key(MINIMAX/DEEPSEEK/DASHSCOPE)gitignored 未追踪、完好。
- feature_list:feat-021 done(evidence 含 commit/测试/实测);feat-022/023/024 not-started,kickoff 在 `.issues/feat-02{2,3,4}/kickoff.md`。
- 验证态:tsc -b 零错 + pytest 174 passed(07-07 晚收盘前复跑);真 API 语义测试:`eval-harness/tests/test_semantic_recall.py`(要 .env 的 DASHSCOPE key)。

## 5 · 怎么把现状跑起来(下 session 施工/复现用)
- 后端:`AVERY_BRAIN=minimax python -m uvicorn service.app:app --host 127.0.0.1 --port 8137 --app-dir eval-harness`;健康 `GET http://127.0.0.1:8137/health`(**不是根 /**)→ 应见 `brain:minimax` + `embeddings:dashscope:text-embedding-v4/1024`。
- 前端:`npm run dev` → :5173,`?mode=live` 或右上 Live(开关已修,4e90966)。
- 全测:`python -m pytest eval-harness -q`(174,~70s)。
- seed 复现:live 传 `D:\teammaster-master\teammaster-master\seed-rag\{LogiPulse-Roadmap.pdf, PrismDesign_TeamProfile_EN.xlsx}` → Your team 现状 = 1 假人 "No." + 1 文件名项目(feat-023 修绿前保持此惨状,gate 就该红)。
- ⚠ headless 预览 rAF 停摆:场景切换/动画不可机测 → 断言走 DOM + `transition:none` 旁路;动画手感归真机(feat-014 evidence)。

## 6 · 留给 Danny 的 HITL(全部非阻塞)
- S1/S2 完工后抽查 AFK 报告(截图/断言输出);机器门判定完工,不等你。
- 旧账不变:tm2 promote(审字后 `vercel promote`,agent 不得代做)、真人 eval 评分、合伙人 IP 具名授权、feat-020 合伙人一句话(Skeppsviken PM 云/桌面版 + CAD 具体产品)。
- feat-019 酒店包插 lite Playbooks 屏 = S3 之后的事。

## 7 · 下一步(优先级)
1. **S1 开工**(一个 AFK session):feat-022 gate 先立(必红)→ feat-023 LLM 抽取修绿后端断言。开工读:`.issues/feat-022/kickoff.md` + `.issues/feat-023/kickoff.md` + `.issues/live-rescue-0707/plan.md` §S1。
2. S2:feat-024 立墙(`.issues/feat-024/kickoff.md` + plan.md §S2)。
3. S3:合流全绿 → Danny 抽查 → merge main → 旧账重看(feat-018 部署配置复验、feat-019 插屏)。

## 8 · 锁定上下文指针(开工前读)
- 本次:**ADR-0022** · `.issues/live-rescue-0707/plan.md`(§0 决策表)· progress.md `## Update — 2026-07-07`。
- 战略(不动):ADR-0020/0021 · `docs/strategy/2026-07-05-real-integration-map.md` · `docs/strategy/2026-07-05-dual-line-strategy-roundtable.md` · `git show 25e45fa:session-handoff.md`。
- 🔴 红线(不可谈):人卡永不评分/排名/画像/moodPct/capacityPct——类型层 + `redline_extract` 门 + 前端剥离;补救全程不碰。
- standing:不动 rail 回放机器 / store 契约(ADR-0013)/ camera(ADR-0012)/ terminal-stream(ADR-0014)/ 内部命名 / ADR 历史 / archived;中文一律 M3(memory `chinese-copy-via-m3`);AFK 先斩后奏,人工闸只留销毁/对外/花钱/凭据(AGENTS.md)。
