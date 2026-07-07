# Session Handoff — 2026-07-07 S1 收盘(feat-022 门立必红 + feat-023 修绿后端 → 开工 S2)

> **接续只靠本文件 + git,不回放聊天。** 上一版(07-07 晚确诊+拍板版)存档于
> `.issues/live-rescue-0707/handoff-0707-evening.md`;早版 `handoff-0707-morning.md`;
> 07-05 战略版 `git show 25e45fa:session-handoff.md`。
> 本 session 按 ADR-0022 执行 S1:**门先立、立完必红 → LLM 抽取把后端断言修绿**。全程机器证据,无自报。

## 0 · 一句话现状
**S1 完成**:feat-022(seed 端到端双层机器门)done——出生即红,红有实录;feat-023(LLMExtractor)done——完工判定 = 022 后端断言全绿,`pytest -m seedgate` **连续两跑 6 passed、server 日志零 fallback**(xlsx→20/20 具名人卡、假人=0、pdf→Phase 1/2 两项目、人卡零数字、无 mojibake、advise cite 命中 Lin Qing 行)。前端门 023 后复驱:teamRendered/postUploadClean 翻绿,**emptyStateClean/detailIsLive 按计划保持红** = S2 feat-024(同仓立墙)的活。途中门另抓到两条真 bug 并修掉(红线 vs allocation %、collaboration 契约崩 HomeScene,见 §3)。main(2f76ceb)未动。

## 1 · 本 session 干了什么(时间序)
1. 基线确认:init.sh 绿 + pytest 174 passed。
2. **feat-022 立门**(commit `4398caa`):seed 拷 tracked fixtures(`eval-harness/tests/fixtures/seed/`);后端双层门 `tests/test_seed_gate.py`(离线层无 key 绿 + 集成层 `@seedgate` 具名断言);前端门 `scripts/gates/live-frontend-gate.{md,snippet.js}`(浏览器自驱协议 + DOM 断言包)。**立完实跑:后端 3 红 3 绿、前端 verdict RED**——与 07-07 确诊逐条对上(1 假人 "No."/1 文件名项目/空态 7 处 story 名词/点卡 Unknown teammate)。
3. `.gitattributes`(commit `0d1981c`):git 要对 tracked PDF 做 CRLF 归一化,会毁二进制 fixture,钉死 binary。
4. **feat-023 修绿**(commit `ad7ad13`):`avery/ingest/llm_extract.py` + `service/extractor_factory.py` + parse.py 清洗 + /health 曝 extractor + 离线电池 13 tests。真模型探针:xlsx 71s 20/20 人;pdf 初版失败→修两个真问题(见 §3)→193s 10 人+2 项目。终跑 `-m seedgate` 6 passed(7:07)。
5. 收盘 docs(本 commit):progress.md、feature_list evidence ×2、本文件。

## 2 · 交付物与证据(全 verified)
- **后端门**:`eval-harness/tests/test_seed_gate.py`。离线层 2 passed(TestClient 真 HTTP 线、`AVERY_EXTRACTOR=heuristic` 强制、断安全不断质量:红线/契约形状/facts 物化/无 U+FFFD——无 key 环境 AFK 门保绿)。集成层 `@seedgate`(无 key 自动 skip):真 uvicorn :8137(minimax+dashscope+llm:minimax,fixture 自动清残留端口占用)、真 POST /ingest 两 seed。**修绿后 6 passed in 427s**。
- **前端门**:`scripts/gates/live-frontend-gate.md`(协议)+ `.snippet.js`(断言包,单一事实源)。相位:A 空态黑名单→B 真 File 注入→C 团队渲染(≥15 人+具名+零血条)→D 上传后黑名单→E 薄详情→F composer。**立门实跑 RED**:A=7 hits、C=1 假人卡、E="Unknown teammate"(实证在 feature_list feat-022 evidence);B/D/F(静态)绿。**注意口径**:Lin Qing/Chen Mingyuan/Sun Xiaomei/Zheng Zixuan 四名 story 与真 seed 复用,黑名单只用 story 独占名词+文案句式;"New Retail" 不入黑(真 seed 有 "New Retail Smart Shopper Mini Program")。
- **LLM 抽取**:`LLMExtractor` 接 pluggable brain(现实=M3 默认/DeepSeek 可切,claude 仍无 key 代码路径不得假设);行号喂入,**每实体带来源行号**(cite 链 facts.md:<line> 不断);三层红线 = 白名单 sanitizer(走私评分键只杀该条)→ 抽取器内 `validate_extraction`(正文评分→整篇退兜底)→ pipeline 复验(422 后备);任何失败退 `HeuristicExtractor`(正则未修,降级为测试/兜底)。材料 chunk 走确定性老路(模型不重写 RAG 语料)。
- **env 旋钮**(`service/.env.example` 已文档化):`AVERY_EXTRACTOR`=auto(默认,有 key 即 llm)/llm/heuristic;`AVERY_EXTRACTOR_BRAIN`=minimax/deepseek;`AVERY_EXTRACT_TIMEOUT_S`(默认 240)。
- **验证态**:init.sh 绿;离线全量 `pytest --ignore=test_seed_gate` 187 passed + seed 离线 2 = **189 离线绿**;集成 `-m seedgate` 6 passed;`test_llm_extract.py` 13 passed(FakeBrain 零网络)。
- **flake 与根因(S1 最有价值的一课)**:全量跑时 `test_pdf_yields_real_projects` 间歇红(得到过 1 failed 194 passed)。最初猜 provider 限流——**错**;给 gate fixture 落 server 日志(`runs/seed-gate-uvicorn.log`)+ 抽取器 fallback 加 logging 后定谳:**红线在工作**。LogiPulse pdf 团队表带人均 Allocation %(~10%–80%,pdf 行 48–90),M3 有概率把 "80%" 抄进人字段 → `redline_extract` person-score-value ×8 → 整篇退 heuristic → 文件名项目 → 断言红。修法不改弱红线:**sanitizer 剥离 rating 形数字**(`_strip_person_ratings`,复用 redline 同源正则;纯 % 条目整条丢;与前端剥离哲学一致,门仍是后盾)+ prompt 明令禁抄 allocation % + **词库类违规(如 "low performer")仍整篇回退**(测试钉死,见 `test_scoring_lexicon_still_falls_back_whole_doc`)。顺手强壮化:两 seed 单窗(220→320)、逐窗 3 试带退避(`retry_backoff_s`,测试注 0)、抽取 brain 240s per-call timeout(无超时实测吊死过 20 分钟)。若 S2/S3 再见 flake:先看 `runs/seed-gate-uvicorn.log`,别盲修、别改弱断言。

## 3 · 本 session 学到的坑(下 session 别再踩)
- **collaboration 契约崩(gate 抓到,已修 7ef9e31)**:`team_cards()` 一直发 `collaboration: list[str]`,transport.ts 却写 `string`、`liveRead()` 对它 `.trim()`——heuristic 从不产 collaboration,潜伏到 LLM 第一次真发 → live 上传后 HomeScene 白屏。契约改 `string[]`。**S2 立墙时警惕同类:凡"契约注释说严格对齐后端"的类型,拿真 payload 核一遍。**
- **vite 全量重载会清 ephemeral 状态**:/@fs/ 取过的文件被编辑会触发页面重载,上传的 team 状态清零——浏览器自驱相位全部跑完之前不要动仓库文件。
- **M3 是 reasoning 模型**:`<think>` 计入 max_tokens,8k 预算下长文档 JSON 尾巴被截断 → 抽取 brain 用 32k 输出预算 + 逐窗容错(单窗重试一次,全败才退兜底)。
- **provider 调用必须显式超时**:openai SDK 默认 600s×2 重试,一次网络吊死实测挂 20 分钟 → `with_options(timeout=240)`。没有这个,/ingest 会被吊死。
- **GBK 控制台是骗子**:EM DASH/á 渲染成 "��",看着像 mojibake 实为假象;U+FFFD 判定只信代码断言(门里已断)。07-07 晚 handoff 记的 "pypdf mojibake 进语料" 磁盘路径复测不存在,但 parse 层清洗(U+FFFD/连字/软连字)已加,门永久看住。
- **git autocrlf 会毁二进制 fixture**:tracked PDF 曾被标记 LF→CRLF 归一化;`.gitattributes` 已钉。
- 残留 uvicorn 清理已固化进 gate fixture(netstat+taskkill);别再手工。

## 4 · 仓库当前态(精确)
- 分支 `feat/live-core-015-018`,链:…`37ff2db`(07-07 晚 docs)← `4398caa`(feat-022 门,出生即红)← `0d1981c`(.gitattributes)← `ad7ad13`(feat-023 LLM 抽取)← `6a5f32e`(fix:rating 剥离,flake 根因)← `7ef9e31`(fix:collaboration 契约 + 黑名单假阳性)← 收盘 docs commit(HEAD,已 push)。`main` = `origin/main` = `2f76ceb` 一动不动,S3 前不 merge。
- 工作树干净;:8137/:5173 已停;`eval-harness/.env` 真 key(MINIMAX/DEEPSEEK/DASHSCOPE)gitignored 完好。
- feature_list:feat-021/022/023 done(evidence 含断言输出与 commit)、feat-024 not-started(kickoff 在 `.issues/feat-024/kickoff.md`)。
- seed fixtures 已 tracked:`eval-harness/tests/fixtures/seed/{LogiPulse-Roadmap.pdf, PrismDesign_TeamProfile_EN.xlsx}`(源目录 `D:\teammaster-master\...\seed-rag\` 不再是运行依赖)。

## 5 · 怎么把现状跑起来
- 后端(live 形态):`AVERY_BRAIN=minimax python -m uvicorn service.app:app --host 127.0.0.1 --port 8137 --app-dir eval-harness`;健康 `GET /health` → `brain:minimax` + `embeddings:dashscope:...` + **`extractor:llm:minimax`**(新字段)。
- 前端:`npm run dev` → :5173 `?mode=live`。上传两 seed 现在长出 **20+ 具名人卡 + 真项目卡**(023 后的新现状;空态渗漏/详情 Unknown 仍在,S2 修)。
- 门:离线 `python -m pytest eval-harness -q`(189,~70s;集成层无 key 自动 skip);集成 `python -m pytest eval-harness/tests/test_seed_gate.py -m seedgate -q`(~7 分钟,要 .env 双 key);前端门按 `scripts/gates/live-frontend-gate.md` 协议自驱。

## 6 · 下一步(优先级)
1. **S2 = feat-024 同仓立墙**(读 `.issues/feat-024/kickoff.md` + plan.md §S2):`src/story/**`/`src/lite/**`/`src/shared/**` + ESLint no-restricted-imports 机器闸;lite 3 屏(上传空态自己的引导文案/Your team/The room 薄建)+ 薄详情浮层;composer 接 askLive。**完工判定 = 前端门 verdict 全绿 + story 回归(rail 26 拍)仍绿**;后端门保持绿(顺手复跑 `-m seedgate`)。
2. S3:合流全绿 → AFK 报告 → Danny 抽查 → merge main → 旧账(feat-018 部署复验、feat-019 插屏)。

## 7 · 留给 Danny 的 HITL(全部非阻塞)
- S1 报告抽查:本文件 §2 证据 + feature_list feat-022/023 evidence(断言输出原文在内)。
- 旧账不变:tm2 promote、真人 eval 评分、合伙人 IP 具名授权、feat-020 合伙人一句话。

## 8 · 锁定上下文指针(S2 开工前读)
- 本次:ADR-0022 · `.issues/live-rescue-0707/plan.md`(§S2)· `.issues/feat-024/kickoff.md` · progress.md `## Update — 2026-07-07 · S1`。
- 🔴 红线(不可谈):人卡永不评分/排名/画像/moodPct/capacityPct——类型层 + `redline_extract` 门 + 前端剥离。抽取换 LLM 后红线三层化(sanitizer/门内/pipeline),别拆。
- standing:不动 rail 回放机器 / store 契约(ADR-0013)/ camera(ADR-0012)/ terminal-stream(ADR-0014);story 资产 URL/构建不变;中文一律 M3;AFK 先斩后奏,人工闸只留销毁/对外/花钱/凭据(AGENTS.md)。
- 已知坑:本文件 §3 全部 + headless rAF 停摆(断言走 DOM+transition:none 旁路)。
