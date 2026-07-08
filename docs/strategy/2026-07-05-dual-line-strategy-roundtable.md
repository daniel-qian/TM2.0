# 双线战略圆桌 — 2026-07-05

> 本文件是 2026-07-05 战略圆桌讨论的**记录 + 下几个 session 的启动索引**。
> 决策落盘为 [ADR-0020](../adr/0020-avery-graduates-from-demo-only-to-live-lite-product.md) + [ADR-0021](../adr/0021-two-engine-core-vertical-packs-skins-dual-deploy.md)，
> 术语进 [CONTEXT.md](../../CONTEXT.md)，工作项进 `feature_list.json`（feat-015..020）+ `.issues/<feat>/kickoff.md`。
> 相对路径以本文件（`docs/strategy/`）为基准。

## 0 · 缘起

Avery 做了几次路演 + 跟两家公司洽谈，结果都好——听众有兴趣，但**没法直观地用、玩**。由此定下**双线并行**：

- **Line A（通用版 / 给国内融资团队）**：一个能**实际部署、直接拿给各种团队用**的最小版本。不针对某一家公司，是**给管理者用的顾问型 AI**。融资团队拿它做调研 + 营销。
- **Line B（针对性定制 / 度假酒店 + 建筑公司）**：两个真实客户——**三亚绿杉壹居度假酒店**（度假酒店，婚宴是其业务线之一，非"婚庆公司"）+ **byggsamverkan**（瑞典建筑公司，https://www.byggsamverkan.se/）。调研他们的业务日常、常用办公软件，给更贴合的 UI/UX + 专业知识库 + 解决案例，调查集成办公软件的可行性。下次洽谈只需一个**贴合他们的 demo，让他们眼前一亮**。

## 1 · 核心反转（本次圆桌的关键洞察）

**现在的 demo 根本"不能用"**——它是 Lin Qing 故事线的**录像回放**（rail replay + 写死的 `fixtures`）。观众只能看，没法把**自己公司的情况**打进去。所以"没法直观地去用去玩"**不是部署没做，是产品压根不接受真实输入**。

两条线要的其实是**同一个缺失能力**：接真实输入 → 出真实 Avery 回答。这个能力已经 80% 存在于 `eval-harness`（Python `think→tool→observe` loop，红线 + cite + 8 字段，MiniMax-M3 已接通）。

## 2 · 锁定决策（不再翻；本圆桌逐条 grill 拍板）

| # | 决策 | 结论 |
|---|---|---|
| D1 | Line A 本质 | **真 LLM 顾问**，复用 `eval-harness` 当 advisor engine（不是脚本沙盒） |
| D2 | 架构 | **一套 domain-agnostic 内核 + 垂直知识包 + 行业皮肤**（"换皮"） |
| D3 | 部署 / 语言 | **双端都要**：境内中文 + 海外英文；同一 codebase，双 target / 双 brain |
| D4 | 企业 demo 真度 | 可信 mock 办公软件集成 **+ 真顾问核**；且**升级为**"当场上传真文件→看自己的 team 长出来" |
| D5 | 排期 | **内核 + 首个垂直包并行起跑** |
| D6 | 首个垂直 | **酒店先行（婚宴亮点）** |
| D7 | 垂直包来源 | **混合**：agent web 调研起草 v1 + Danny 补内行 know-how |
| D8 | repo 拓扑 | **graduate 现有 Vite demo → "Avery Live"**（story + live 双模）；`eval-harness`+FastAPI 当后端；landing 不动；**ADR-0001 被 ADR-0020 超越** |
| D9 | **内核 = 两个引擎**（Danny 纠正，抬高了"内核"定义） | Advisor engine（已存在）+ **Ingestion engine（新建、更重、更重要）** |
| D10 | v1 ingestion 深度 | **一步到位**：上传 + **全向量 RAG** + 填 Your team + 喂回答卡 |

## 3 · 内核 = 两个引擎 + 两道 seam

**内核不只是 `eval-harness`。** 它是两个引擎：

| 引擎 | 是什么 | 状态 |
|---|---|---|
| **Advisor engine** | `eval-harness`：`think→tool→observe`、红线校验器、cite-before-number、8 字段结构化输出。检索源 = 公司 RAG + Playbooks | 已存在（feat-011 done） |
| **Ingestion engine** | 上传（简历/项目/公司材料）→ 解析 → **红线安全的结构化抽取** → **全向量 RAG 库** → **填充 Your team**（人卡/项目卡/briefing）→ 喂回答卡（公司事实这条腿） | 新建，工程量大（feat-016） |

**用"上传→解析"替代"一对一数据接入"**：lite 版不接他们的钉钉/系统，但通过上传拿到同样的"公司事实"腿。

**两道数据 seam（同一个纪律：脚本=story mode / 真数据=live mode）：**

- `StreamSource`：脚本 `cases.ts` vs 真 agent 流 → 喂 Nexus 终端（"Working it through"）。
- `TeamDataSource`：脚本 `fixtures.home.ts` vs 真·解析上传（RAG store）→ 喂 "Your team" 人卡/项目卡。

seam 同时是 **AFK 测试的缝**：把 live 源打桩成确定性 → 前端 DOM 断言不碰真 LLM，绕开 headless rAF 老坑。

**关键：story mode 保留=不动 rail replay 机器**（ADR-0003/0006/0012/0013/0014 全部 honored）。live 是**增量并行源**，不改回放机器。

## 4 · "换皮"：垂直如何复用（D2/D6/D7）

酒店（婚宴亮点）= **换 Capabilities 包 + 换皮肤**，两个引擎 + 两道 seam **完全共享**：

```
酒店上传他们的文件 → 同一个 ingestion engine → 酒店的 Your team 长出来
                                                  → advisor 落在他们数据 + 酒店/婚宴 Playbooks 上
```

所以下次给酒店看的 demo，不用假装接钉钉——**当场传真文件、看自己的 team 长出来**，比 mock 更 wow 更诚实。（live 办公软件连接器仍是 mock / roadmap。）

垂直包 = **Capabilities 包**（案例 + playbook + 信号阈值，跟合伙人 HR 包同形）+ **skin**（行业视觉主题）+ 客户**自己上传的数据**。

## 5 · 双端部署（D3）

- **前端**：Vite SPA 静态构建 → Vercel（海外 EN）+ 境内静态托管（ZH）。同一 codebase，i18n 走 en/zh（复用 landing 的 `scripts/i18n-zh.mjs` + M3）。
- **后端 agent 服务**：Python（FastAPI）→ 境内主机（brain=MiniMax/DeepSeek，低延迟合规）+ 海外（brain=Claude）。pluggable brain 已支持（`eval-harness/avery/brain.py`）。
- 双端主要是"多一个部署目标 + 多一个 brain/embeddings 后端"，**不是 2× 重写**（i18n + pluggable brain 架构本来就为这个留了口）。

## 6 · AFK 自检自循环模型（贯穿所有 feature）

Danny 硬约束：dev+test 做成 **AFK 自跑自验自修**，压缩人工环节（见 memory `afk-self-loop-minimize-danny`）。落到三道门：

1. **后端契约门**：`eval-harness` 跑情境电池——红线 / cite / 8 字段 schema / ingestion 抽取红线（非确定性锁在可机检契约后）。
2. **前端门**：seam 打桩成确定性 agent/team 回复 → DOM 断言（绕开真 LLM 不确定 + headless rAF）。
3. **真 API 冒烟**：一条真调用，只断言"契约成立"而非逐字文案。

HITL 只留：审字（venus-facing 英文定稿）、价值观抉择、IP 授权、真人 eval 评分、生产 promote。

## 7 · 红线在 Ingestion 的落点（护城河 + 硬约束）

解析简历 → 人卡，**必须停在定性**（角色、负责什么、在职时长、协作关系），**绝不从简历推出评分/排名/画像**。这是 feat-014 "人卡全定性"纪律，现在**内建成 ingestion 抽取阶段的红线过滤器**——既是护城河（别人上传简历就打分，我们不），也是写死的约束。`eval-harness/avery/redline.py` 的校验器扩展到覆盖"抽取产物"。

## 8 · 商业定位护栏（对齐现行商业模式，不翻案）

Line A sampler 是**漏斗顶端的演示/营销面**，**不是**"免费产品层"（四层付费·无免费层，见 [ADR-0019](../adr/0019-commercial-model-four-layer-paid-no-free-tier.md) + [CONTEXT.md](../../CONTEXT.md) § Commercial language）。护栏：sampler 用**临时会话 / 上传的样本数据**（不持久化成公司工作区），pitch 是"这是一口尝鲜；真家伙会 live 接入 + 持久化 + benchmark"。**不要把 sampler 定位成"免费的 Avery"**。

## 9 · 接下来几个 session 的路线图

新工作项进 `feature_list.json`（feat-015..020）。依赖 + 并行关系：

```
feat-011 (eval-harness, done)
   └── feat-015  Agent service (advisor engine → FastAPI+SSE, live input)   ← 立即可起
          └── feat-016  Ingestion engine (upload→parse→vector RAG→Your team) ← 更重的核
                 └── feat-017  Frontend graduate → Avery Live (两道 seam, live mode, i18n)
                        └── feat-018  Dual deployment (双端)
feat-016 + feat-017
   └── feat-019  酒店 vertical pack + skin + demo                            ← 换皮首例
feat-019 (研究部分) + feat-020 可与内核并行，立即起
feat-020  建筑(byggsamverkan) 调研 + 办公软件可行性（research deliverable）           ← 立即可起，AFK web 调研
```

**D5「并行起跑」的具体三条立即可 AFK 起跑的线：**
1. **feat-015**（agent service）——把已存在的 advisor engine 包成 API。
2. **feat-019 的 pack-authoring**（酒店知识研究 + 起草，/mmx-cli）——纯研究/authoring，不等代码。
3. **feat-020**（办公软件调研）——web 调研，喂"live sync roadmap"叙事。

feat-016 紧随 feat-015；feat-017 需要 015+016；feat-018 收尾。

> **feat-016/017 的逐表面施工图 = [`2026-07-05-real-integration-map.md`](2026-07-05-real-integration-map.md)**：现有页面/卡片（Your team 人卡·项目卡·Nexus 终端·8 字段卡·Briefing·reality-gap）怎么从脚本换成真数据，含 R1（reality-gap 混合弱版）/ R2（聚合数字真算或不显示）/ R3（v1 核心五件 live）三决策 + 三颗红线地雷。

## 10 · 开放的 stack 问题（按 consultant-agent-open-questions.md 惯例，默认"按推荐"，Danny 可异步拍）

- **Embeddings**：pluggable（境内默认 MiniMax/BGE-M3 等国产；海外默认 OpenAI/Voyage）。镜像 pluggable-brain 模式。
- **向量库**：自托管、双端可跑优先——**默认 pgvector**（Postgres+pgvector，阿里云 RDS 支持；本地测试用 SQLite 或内存）；备选 Qdrant/Milvus。避开境内访问不稳的托管服务。
- **解析**：多格式（PDF/docx/xlsx）——默认成熟库（unstructured / pypdf / python-docx），LLM 只做结构化抽取不做 OCR 重活。
- **检索**：pluggable retrieval——keyword（`eval-harness` 现成，供离线/AFK 测试）/ vector（真跑）。

细节在 [feat-016 kickoff](../../.issues/feat-016/kickoff.md)。

## 11 · 指针

- 决策：[ADR-0020](../adr/0020-avery-graduates-from-demo-only-to-live-lite-product.md)（graduate + seam）· [ADR-0021](../adr/0021-two-engine-core-vertical-packs-skins-dual-deploy.md)（两引擎 + 换皮 + 双端）
- 术语：[CONTEXT.md](../../CONTEXT.md)（新增 Avery Live / Story-Live mode / Ingestion / Company context / Vertical pack / Skin / Sampler）
- **真实集成图**（feat-016/017 施工图）：[`2026-07-05-real-integration-map.md`](2026-07-05-real-integration-map.md)（逐表面 现脚本源→live 真源 · R1/R2/R3 · 红线地雷）
- 启动资料：`.issues/feat-015/kickoff.md`、`.issues/feat-016/kickoff.md`、`.issues/feat-017/kickoff.md`、`.issues/feat-019/kickoff.md`、`.issues/feat-020/kickoff.md`
- 上游约束：红线 ADR-0015/0018 · 决策层产品真理 ADR-0018 · 商业模式 [ADR-0019](../adr/0019-commercial-model-four-layer-paid-no-free-tier.md)（+ [CONTEXT.md](../../CONTEXT.md) § Commercial language）· Avery 果断双向 ADR-0016 · 中文经 M3（memory `chinese-copy-via-m3`）· AFK 自循环（memory `afk-self-loop-minimize-danny`）
