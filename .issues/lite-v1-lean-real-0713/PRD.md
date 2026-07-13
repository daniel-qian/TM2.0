---
status: ready-for-agent
feature: lite-v1-lean-real (Avery lite v1 — 精悍准真产品:持久化 + agent 基本功做真)
date: 2026-07-13
source: .issues/lite-v1-lean-real-0713/session-close-and-direction.md
tracker-note: 项目原生 tracker = 本地 .issues/;未建 GitHub issue(对外闸留 Danny)。
supersedes: ADR-0021 §6(REGISTRY 故意进程内/ephemeral)——本 PRD 为 lean-real 产品引入持久化,建议补一条短 ADR 记录。
---

# PRD — Avery lite v1:精悍准真产品(持久化 + agent 基本功做真)

## Problem Statement

融资团队会把 Avery lite 的链接**甩给他们手上的真实公司**;这些公司自己打开、**用自己的真实数据实际玩**。今天的 Avery lite 撑不起这个用法:

- 公司上传自己的文件后,数据**只活在后端进程内存里**(`ContextRegistry` 是进程内 dict,materialize 的记忆写在 OS 临时目录)。**一次重启 / 一次重新部署,这家公司的一切就没了**;它下次打开链接是一片空白,像个坏掉的东西。
- **多家公司之间零隔离**——任何人拿到 `context_id` 就能读别家的花名册。真实公司不敢用。
- 检索(RAG)是 **keyword 占位**(pgvector 只是个字符串标签,没有真实现),advise 引用质量撑不住真实文档。
- Avery 只会**读**你上传的东西,不会**沉淀**——用起来像查询工具,不像"一个已经在为我公司工作的 agent"。

对一个以**钓鱼(lead-gen)** 为目的的产品,这些都是致命的:公司玩过后必须觉得"这东西有料、是个真 agent",才会想请 Danny 去谈**深度搭建 agent + 服务合作**。现在它给不了这个印象,还会当场露馅。

## Solution

给每家公司一个**持久的、专属的 Avery 工作区**——一次上传,长期留存;跨会话记得你的公司、引用你的真实文档;并且 Avery 会**自己攒一份关于你公司的、你看得见的笔记**,越用越厚。从公司用户视角:

- **上传一次,数据就在了**:关掉再回来、我们那边升级重启,你的团队、你的文件、Avery 对你的记忆都还在。
- **只有你能看到你的数据**:别家公司看不到你的花名册,你也看不到别家的。
- **答得有据**:问 Avery 管理问题,它引用**你自己文档里的真实事实**(真向量检索),而不是编。
- **像个活的 agent**:Avery 把它对你公司的观察**主动写进一份"Avery 的笔记"**,你能翻、能看它怎么越来越懂你——这正是"想请他深入合作"的那口钩子。
- 服务器/数据库/用户面**扛得住真实公司的零星并发和大文件**,不会被一个上传拖垮或烧光额度。

范围克制:功能有限、**不做**完整登录鉴权体系、**不做**长远完整运维,重点是"真能跑 + 有 agent 基本功 + 引起兴趣"。

## User Stories

**真实公司用户(manager,通过融资团队拿到链接)**
1. As a company manager, I want 我上传的公司文件在我下次打开链接时仍然在, so that 我不用每次重传、这东西看起来是真产品。
2. As a company manager, I want Avery 在我们那边重启/升级后仍记得我的公司, so that 我对它的信任不会被一次运维动作清零。
3. As a company manager, I want 我上传后当场看到"我的团队"从我的真实文档长出来, so that 我立刻感到它真读懂了我的资料。
4. As a company manager, I want 我能回看我上传过的文件清单(每家公司自己的文件空间), so that 我知道 Avery 的记忆基于哪些材料。
5. As a company manager, I want Avery 回答管理问题时引用我文档里的真实事实(带出处), so that 我能核对、敢信它的建议。
6. As a company manager, I want Avery 的检索能在几十人的花名册里找到对的那条, so that 大公司也不会"召回丢人"。
7. As a company manager, I want 看到一份 Avery 自己维护的"关于我公司的笔记",随我使用越来越厚, so that 我感到它在持续为我工作,而不是一次性问答。
8. As a company manager, I want 这份 Avery 笔记永远不给我的员工打分/排名/贴标签, so that 我敢把它拿给团队看、不担心伤人或违规。
9. As a company manager, I want 别的公司绝对看不到我的数据、我也看不到别人的, so that 我敢上传真实员工信息。
10. As a company manager, I want 上传一个很大的文件或十几个文件时系统不崩、给我合理反馈, so that 我第一次用就不被劝退。
11. As a company manager, I want 上传解析失败/部分失败时得到诚实提示(而不是"团队已就绪"盖着空网格), so that 我不会被假成功误导。
12. As a company manager, I want 抽取降级到低质模式时(如额度耗尽)被明确告知, so that 我不会把一张假"No."人卡当真。
13. As a company manager, I want 一个基本的"你的数据如何被处理"说明, so that 我上传真实员工数据时心里有数。
14. As a company manager, I want 我的会话在一次上传的长解析期间不被冻住、健康检查不误杀, so that 体验顺畅不掉线。

**融资团队(把链接分发出去)**
15. As a financing-team member, I want 把一个链接甩给我资源里的公司、他们自己就能玩起来, so that 我不用现场陪演示。
16. As a financing-team member, I want 每家公司拿到的是自己隔离的空间, so that 我不担心 A 公司的数据泄给 B 公司让我丢脸。
17. As a financing-team member, I want 产品足够像真东西以勾起公司兴趣, so that 公司主动想请 Danny 深入合作。

**Danny(运营者 / 开发者)**
18. As the operator, I want 公司数据落在托管数据库(Supabase Postgres),而非进程内存, so that 部署/重启不丢数据、可以最小规模扩。
19. As the operator, I want 真向量检索用 pgvector 落地(不再是标签), so that 召回质量撑得住真实文档、且诚实(不再挂假 pgvector 名)。
20. As the operator, I want 每公司一个不可猜的访问 token/id 做基础隔离(不上完整登录系统), so that 用最小工作量拿到"够用的隔离"。
21. As the operator, I want 上传硬门(大小/数量/类型上限 + 限流 + LLM 花费闸), so that 一个大上传或脚本循环不会 OOM 单 task 或烧光 M3 额度。
22. As the operator, I want 后端能扛住真实公司零星并发, so that 演示期不出丢人事故。
23. As the operator, I want Python 后端容器上 ECS、前端静态上 Vercel, so that 复用已跑通、带红线闸的引擎而不是重写。
24. As the operator, I want 端到端 + 基本压力测试作为收尾证据, so that 我 AFK 也知道它真能跑。
25. As the operator, I want 红线(含中文)对 Avery 自写的笔记同样生效, so that 新增的写侧记忆不会成为绕过人卡零数字的后门。
26. As the operator, I want 持久化改动不碰红线门 / advisor 引擎 / extractor-advisor 分离, so that 已验证的护城河零回归。
27. As the operator, I want 离线测试套件在没有真实 DB 时仍全绿, so that 日常 gate 不依赖外部服务。

**agent(把 agent 当第一个用户 — 集成层证据)**
28. As the agent's integration test, I want 一条"上传→持久化→重启后仍在→隔离→advise 引用真实事实 + 笔记累积"的端到端断言, so that "done" 有真机证据而非单元自考自答。

## Implementation Decisions

- **数据库 = Supabase(Postgres + pgvector),接现有 Python FastAPI 后端。**★DECIDED。**不引入 Java Spring**——那等于把已跑通、带红线闸的 extractor/advisor 引擎推倒重写,浪费有限精力。
- **持久化落在既有 `ContextRegistry` get/put 接缝之后。** 用一个 Supabase-backed 实现替换进程内 dict 单例;`CompanyContext` 的记忆(facts/notes)与源文件 corpus 落 Postgres。feat-018 注释已预留"a DB-backed registry plugs in behind the same get/put"——沿用该接缝,**不新开**。
- **真 RAG 落在既有 `RetrievalStore` / `Embedder` 接缝之后。** pgvector 作为向量存储的真实现(替掉 `store.py` 里 `persistence="pgvector"` 的空标签);embedding 复用 `service/embedding_factory.py`(DashScope),`app.py` 不再传 `embedder=None`。检索 top-k 需能在几十人花名册里命中(修 07-07 起 held-open 的召回缺口)。
- **每公司文件空间 = 上传的源文档持久留存**(Postgres,可含对象存储引用),agent 可引用、用户可回看。区别于今天"解析后即删"。
- **"Avery 的笔记" = 写侧、可见、跨会话累积的记忆。** advisor 在一次 advise 之后,把**它对该公司的观察**追加进该 `CompanyContext` 的一份持久 notes(与今天只读、从文档抽取的 `notes.md` 区分:这是 agent 自写)。**必须过既有红线门**(`redline.validate` / 抽取门):agent 自写观察一样不许出现给人打分/排名/画像的内容——写入前红线校验,违规则丢弃/改写,绝不落库。用户面(lite)以只读方式展示这份笔记。
- **基础租户隔离 = 每 `CompanyContext` 一个不可猜的 token/id;所有读路径(`/team/{id}`、`/advise` 的 company_context_id)校验持有者。** 不建完整登录/账号系统(v1 克制档)。未知/无权 id **大声失败**(沿用 feat-028 已落的 404,不静默回落 demo 记忆)。
- **基本抗压 = 上传硬门 + 花费闸。** `/ingest` 加 size/count/type 上限、基础限流、LLM 调用花费/额度闸;沿用 feat-028 已落的事件循环卸载(`run_in_threadpool`)+ advise 超时。
- **抽取诚实降级。** `/ingest` 响应标注 extraction_mode(llm / heuristic / degraded);LLM 抽取静默回落 heuristic(如 429/无 key)时显式告知,`/health` 不谎报 llm。
- **部署:Python 后端一个 Docker 镜像上 ECS(单 / 最小规模 task)+ 前端静态上 Vercel。** 复用 `eval-harness/Dockerfile` + `vercel.json` + `docs/deploy/dual-deploy-runbook.md`(runbook 里 demo-first/演示段以本 PRD 为准更新:公司用自己真数据,非策展假集)。CORS 生产源 + TLS(前端 HTTPS→后端必须 HTTPS)。
- **ADR:** 本 PRD 为 lean-real 产品引入持久化,**取代 ADR-0021 §6 的"REGISTRY 故意 ephemeral/进程内"**;建议补一条短 ADR 记录该决策转向及 Supabase 选型。
- **不动**(零回归):`avery/redline.py`、`avery/ingest/redline_extract.py`、`PersonEntity` 结构、`redline_rules.md`/`FROZEN.lock.json`(冻结)、advisor 引擎(`loop.py`/`engine.py`/`tools.py`)、extractor↔advisor 分离结构。

## Testing Decisions

好测试 = **只测外部行为,不测实现细节**。持久化/隔离/记忆/笔记是行为契约,不是内部数据结构。

- **主接缝(最高、既有)= HTTP 面**(`/ingest`、`/team/{id}`、`/advise`、`/health`)。在此写端到端集成断言(agent 当第一个用户):
  - **持久化**:上传公司 A → 读到团队 → **换一个新的 registry 实例 / 重连 DB(模拟重启)** → A 的团队/文件/记忆仍在。
  - **隔离**:上传公司 B → 用 B 的 token 读 A 的 `context_id` → 拒绝;A 看不到 B。
  - **真 RAG**:advise 关于 A 的问题 → 证据引用 A 文档里的真实事实行(含修好后能在大花名册召回对的行)。
  - **Avery 的笔记**:多轮 advise → 笔记累积、可经 team/context 读路径可见;且**红线**——构造会诱使 agent 写出"给某人打分"的情形,断言写侧被红线拦下、笔记里零人卡数字。
  - **诚实降级**:强制抽取回落 → 响应 extraction_mode=degraded、无假"No."人卡。
  - 先例:`tests/test_seed_gate.py`(@seedgate 真机整链)、`tests/test_service_http.py`、feat-028 的 `test_ingest_nonblocking.py` / `test_advise_context_id.py`。
- **一个下沉接缝(把既有正式化,非新增)= `ContextRegistry` + `RetrievalStore`/`Embedder` 持久化契约测试。** 一套契约,**内存实现与 Supabase 实现都要过** → DB 适配器被行为证明,且**离线默认套件用内存实现即可全绿、不依赖真 DB**;真 DB 走带标记(如 `@needs_db`)的集成层,与 `@seedgate @needs_keys` 同规格(无凭据时干净跳过)。
- **红线复用既有接缝**:笔记写侧走 `redline.validate` / 抽取门,**不新增红线机制**;沿用 `test_redline*.py` 的先例(EN+ZH 均覆盖)。红线/持久化收盘**必经独立对抗验证**(真机执行 crafted 输入,别信自评——feat/029 的教训)。
- **压测 = 基本档**:真实公司零星并发 + 上传硬门边界(超大文件/超量/超频/超额)的行为断言,不做穷尽运维级压测。

## Out of Scope

- 完整登录/账号/鉴权体系(v1 只做不可猜 token 的基础隔离)。
- 长远完整运维:监控/告警/追踪/DR/自动扩缩、完整 on-call。
- 重合规工程:完整 PIPL/DPA/ToS/隐私政策(v1 只做一个基础的数据处理说明口径)。
- 完整"agent 自己的文件空间"(agent 自管一片工作区)——**保持 Vision mock 当 lead-gen 钩子**,不在 v1 建。
- Showcase / 接 agent 展示分析 的打磨——**那是 story 面的活**(墙不打洞)。
- 上传进度 UI(job 队列 + 前端轮询);多 worker / 水平自动扩缩。
- 堆新功能;`src/story/**` 任何改动;`git push origin`(对外闸,留 Danny)。

## Further Notes

- **一路依赖持久化**:记忆存住、真 RAG、租户隔离、Avery 笔记全骑在 Supabase 层上——**先接 Supabase,其余顺序展开**(见 source 文件 §3.3)。
- **硬约束(standing)**:🔴 红线(人/mock/agent 自写笔记永不评分/排名/画像;EN+ZH;门断言不削弱)· story/lite 墙不打洞 · story 冻结 · 中文走 M3 · AFK 先斩后奏、人工闸只留销毁/对外/花钱/凭据 · 任何 lite 表面 done 必含集成层证据。
- **待 Danny 输入(非阻塞开发,但上线要)**:ECS host + 真 LLM key + 域名/DNS + Vercel 连接(`VITE_AVERY_API_BASE`)+ Supabase 项目 + 连接串(见 runbook §F);push 授权;Avery 笔记露出 UX 抽查;数据处理口径。
- **指针**:就绪册 `.issues/live-polish-0709/pre-ecs-readiness-open-loop.md`(必读)· 部署 runbook `docs/deploy/dual-deploy-runbook.md` · 收盘方向 `.issues/lite-v1-lean-real-0713/session-close-and-direction.md` · 根 `session-handoff.md`。
- **当前 git**:全链(polish 波 + feat/027/028/029)已 merge 本地 `main`(`34cfaf9`),ahead origin 16,**未 push**。离线套件 329 passed / 冻结 OK。
- **编排形态(下个 session 复用)**:main 只编排 → 每 feature 起 AFK 实现子代理(gate-first)→ 完工起独立对抗验证 workflow(真机执行)→ clean 才推进;子代理撞 session limit 用 SendMessage 恢复或新子代理承接 WIP。
