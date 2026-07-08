# 内核 = 两个引擎（Advisor + Ingestion/RAG）；垂直 = 换 Capabilities 包 + 皮肤；双端部署

> 与 [ADR-0020](0020-avery-graduates-from-demo-only-to-live-lite-product.md) 同批（2026-07-05 圆桌）。Ingestion 的红线过滤器延续 [ADR-0015](0015-product-tone-human-advisor-debrand-saas-naming.md)/[ADR-0018](0018-renqingwei-demoted-to-redline-product-truth-decision-layer.md)（绝不评分/标签化个人）+ feat-014 人卡定性纪律。商业定位护栏对齐 [ADR-0019](0019-commercial-model-four-layer-paid-no-free-tier.md)（四层付费·无免费层；口径亦见 [CONTEXT.md](../../CONTEXT.md) § Commercial language）。
> **状态：** Accepted（Danny 拍板 2026-07-05；圆桌记录 [docs/strategy/2026-07-05-dual-line-strategy-roundtable.md](../strategy/2026-07-05-dual-line-strategy-roundtable.md)）

## 背景

圆桌拍定：Line A 是真 LLM 顾问、一套内核 + 垂直包 + 皮肤、双端。**关键纠正（Danny）**：内核**不只是** `eval-harness`——Line A lite 的真身不是"顾问版 ChatGPT"，而是"**上传公司文件 → Avery 解析 → 进 RAG → 长出你自己的 Your team（项目进度 + 员工资料）→ 顾问回答落在你上传的真实数据上**"。这条 ingestion 腿**更重、更重要**，且 v1 就要**一步到位全向量 RAG**（AFK 让工程量由 agent 吃，不占 Danny 时间）。

## 决策

1. **内核 = 两个引擎。**
   - **Advisor engine**（`eval-harness`，已存在）：`think→tool→observe`、红线校验器、cite-before-number、8 字段输出。检索源 = 公司 RAG + Playbooks。
   - **Ingestion engine**（新建）：见 §2。
2. **Ingestion 管线**：`上传（简历/项目/公司材料）→ 解析（多格式）→ 红线安全结构化抽取 → 全向量 RAG 库 → 填充 Your team（人卡/项目卡/briefing）→ 喂回答卡`。**用"上传→解析"替代"一对一数据接入"**（lite 版不接他们的钉钉/系统，但拿到同样的"公司事实"腿）。
3. **换皮。** 垂直 = **Capabilities 包**（案例+playbook+信号阈值，跟合伙人 HR 包同形）+ **skin**（行业视觉主题）+ 客户**自己上传的数据**。两个引擎 + 两道 seam **完全共享**。**酒店先行（婚宴亮点）**（feat-019，客户=三亚绿杉壹居度假酒店）；建筑（byggsamverkan）紧随。
4. **红线内建到抽取（护城河 + 硬约束）。** 简历 → 人卡**必须停在定性**（角色、负责什么、在职时长、协作关系），**绝不从简历推出评分/排名/画像**。`eval-harness/avery/redline.py` 校验器**扩展覆盖抽取产物**，成为 ingestion 的 AFK 门。
5. **双端。** 前端静态 SPA 双 target（Vercel 海外 EN / 境内静态托管 ZH）；Python 服务双 host（境内 MiniMax / 海外 Claude）。**pluggable brain**（已有）+ **pluggable embeddings** + **pluggable retrieval**（keyword 供离线/AFK 测试、vector 供真跑）。
6. **商业护栏（对齐现行商业模式=四层付费·无免费层，口径见 [CONTEXT.md](../../CONTEXT.md) § Commercial language，不翻案）。** Line A sampler = 漏斗顶端**演示/营销面**，**不是**"免费产品层"。用**临时会话 / 上传样本**，不持久化成公司工作区；pitch = "一口尝鲜；真家伙 live 接入 + 持久化 + benchmark"。**不得定位成"免费的 Avery"**。

## 取舍 / 理由

- **为什么 ingestion 是核而非锦上添花**：Line A 的 wow = "上传→当场看自己公司长出来"（融资现场让 prospect 传 3 份简历 + 1 份周报，30 秒后 Your team 长出人卡/项目卡，再问"项目卡在哪"回答卡引用他们刚传的周报）。没有它，Line A 退回"结构化一点的 ChatGPT"。
- **为什么全向量 RAG 一步到位（否掉薄切）**：AFK 自循环让工程量由 agent 承担、不占 Danny 时间——最强的核值得从一开始做对。
- **为什么换皮成立**：ingestion + advisor + 两 seam 都 domain-agnostic；只有 Capabilities 包 + skin 是 domain-specific。加行业 = 加 pack + 皮，不重写内核。
- **被否**：① 等客户给知识再做（下次见面前做不出，wow 不了）；② 每垂直独立 bespoke demo（3 行业 = 3× 代码 + 维护，跟 AFK 冲突）。
- **stack 默认（按推荐，Danny 可异步拍）**：向量库 **pgvector**（双端可自托管，避开境内不稳的托管服务）；embeddings 境内国产/海外 OpenAI 二选一 pluggable；解析用成熟库（pypdf/python-docx/unstructured），LLM 只做结构化抽取。细节见 [.issues/feat-016/kickoff.md](../../.issues/feat-016/kickoff.md)。

## 后果

- 落地 `feature_list.json` **feat-016**（ingestion engine）+ **feat-019**（酒店换皮）+ **feat-020**（建筑 byggsamverkan 调研 + 办公软件集成可行性）。
- `CONTEXT.md` 新增 **Ingestion** / **Company context (uploaded)** / **Vertical pack** / **Skin** / **Sampler**；**Capabilities** 补"公司 RAG 是并列的另一条腿"；**Dashboard/Your team** 补"可由上传文件填充"。（已随本 ADR 落地）
- `eval-harness/avery/redline.py` 扩展覆盖抽取产物（新 AFK 门 + 测试）。
- 办公软件 **live 连接器 = mock / roadmap**；真集成可行性由 feat-020 调研，签约后再建。
