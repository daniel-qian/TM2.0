# feat-016 Kickoff — Ingestion engine（内核更重的一条腿）

> 依赖 feat-015。内核里工程量最大、也最重要的一块（Danny 纠正抬高的"内核"定义）。

## 目标
`上传 → 解析 → 红线安全抽取 → 全向量 RAG → 填 Your team + 喂回答卡`。用上传替代"一对一数据接入"（lite 版拿到"公司事实"这条腿）。

## 先读
- **施工图（必读第一份）**：`docs/strategy/2026-07-05-real-integration-map.md`——§0（`ONBOARDING` 已演的就是本引擎）· §3 抽取契约（Person 永空数字 / Project / **doc-derived Signal** / Material）· §5 三颗红线地雷 · §6 AFK 门。
- `docs/strategy/2026-07-05-dual-line-strategy-roundtable.md` §3/§7 · `docs/adr/0021-*` §2/§4（红线抽取）· `CONTEXT.md` 新词条 **Ingestion** / **Company context**
- `eval-harness/avery/{memory,tools,redline}.py` · `feature_list.json` feat-014 evidence（人卡定性纪律）· `assets/0630-partner-docs/`（合伙人 HR 包形状参考）

## Scope
1. **上传 + 解析**：多格式（PDF/docx/xlsx），成熟库（pypdf/python-docx/openpyxl 或 unstructured）。
2. **红线安全结构化抽取**：LLM 把解析文本抽成结构化实体——`person`（角色/职责/在职时长/协作关系，**定性 only**）、`project`（状态/进度/blocker）、`material`（公司资料片段）。**绝不**抽出或推断人的评分/排名/画像。
3. **全向量 RAG**：embeddings + 向量库；`recall` 类工具从 company RAG + Capabilities 检索。
4. **填 Your team**：抽取实体 → 供前端渲染的人卡/项目卡/briefing 结构（跟 8 字段卡兼容）。
5. **红线门**：扩展 `redline.py` 校验**抽取产物**（`person` 实体无任何评分字段），成为新 AFK 门 + 新测试。
6. **挂进 feat-015 服务**：`company_context` 从 stub 变实。
7. **R1 doc-derived Signal**：lite 无 live 连接器 → 从上传文档抽"文档内信号"（如"12 条未解决评论""验收未定"），支撑弱版 reality-gap；**指向人的信号停在情境**（红线）。满血时间序列信号留企业版连接器。抽取实体形状严格对齐现 `fixtures.ts` 的 `Person/Project/Signal` type（喂 `TeamDataSource` live）。

## AFK 验证门
- fixture 文件电池（几份样本简历/项目周报/公司资料）→ 断言：抽取实体齐、`person` 零评分字段（红线）、检索命中相关片段、Your team 结构可渲染。
- `redline.py` 新测试：喂"能诱导打分的简历" → 断言抽取不产出评分。
- pytest 全绿不回退。

## Stack 默认（按推荐，可异步拍）
- 向量库 **pgvector**（本地测试可 SQLite/内存 fallback；双端自托管，避开境内不稳托管服务）。
- **pluggable embeddings**（境内国产 e.g. BGE-M3/MiniMax；海外 OpenAI/Voyage）——镜像 pluggable brain。
- **pluggable retrieval**：keyword（现成，供 AFK 离线）/ vector（真跑）。
- 解析用成熟库，LLM 只做结构化抽取、不做 OCR 重活。

## DoD / HITL
- 管线端到端跑、AFK 门绿、红线扫描记入 evidence；`progress.md` + evidence 更新。
- HITL：embeddings/向量库最终选型确认（默认可跑，Danny 异步拍）。
