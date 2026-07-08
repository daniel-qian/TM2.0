# Session Handoff — 2026-07-07 · 救 15–20（Avery Live 内核集成临近崩盘 → 补救）

> **接续只靠本文件 + git，不回放聊天。** 本 session 的使命交接给下一个：**救 feat-015–020**。
> 两步走：**① 先分析"为什么 15–20 临近崩盘"（根因，非症状）→ ② 再 grill 补救计划**（用 grilling skill，先别写代码）。
> 上一版（2026-07-05 战略圆桌 handoff）在 git 里：`git show 25e45fa:session-handoff.md`。战略/锁定事实见 §9。

---

## 0 · 一句话现状
15–20 的**管道全建好、单测全绿（174 passed）、后端能起、真向量本 session 刚接通并验证**——但作为**集成产品**被人真正点起来时**临近崩盘**：live 模式里 story 内容到处渗漏、上传解析几乎抽不出东西、live 项目详情点开 "Unknown project"、端到端根本无从验收。**核心教训：单测绿 ≠ 产品能用；AFK one-shot 自报"✅ done"是基于 UNIT 测试，从没做过集成/真人验收。**

---

## 1 · 本 session 干了什么（对话 transcript，时间序）
1. **起点**：Danny 截图报 Story/Live 开关点不动。
2. **诊断+修①**：根因 = 顶栏 `.prototype-topbar` 设了 `pointer-events:none`（空白穿透到画板），可点子元素要各自 `pointer-events:auto`；`.scene-tabs` 有、feat-017 加的 `.mode-switch` 漏了 → Story/Live 死。修 `src/styles/global.css` 补一行。用真鼠标事件序列验证 story↔live 双向可切、无拦截。
3. **Danny 喊停**，关服务，列三个怀疑：①前端乱 ②没配 RAG/向量怎么就能上传解析 ③live/story 混。
4. **诚实诊断**（读代码，非手挥）：
   - **#2 RAG 真相**：填 Your team 靠 `HeuristicExtractor`（纯正则）+ `KeywordStore`（词重叠检索），**根本没用向量**；真 `VectorStore` 搭了骨架、没通电（`HashingEmbedder` 是源码里写明"非语义、仅测试"的占位）。抽取也是正则、非 LLM → 抽得浅。**你的怀疑对，不是造假，是没做完。**
   - **#3 混叠根因**：`src/components/AmbientCanvasShell.tsx` **无条件**挂 `<DemoControls />`（剧本 rail：标题卡 / "Are we on track…Friday?" / 3-of-26 计数器），**完全不看 mode**。修 → `{mode === 'story' && <DemoControls />}`。tsc 绿。
5. **Danny 授权接真向量**，给百炼 key（`DASHSCOPE_API_KEY`），让 agent 自己选模型。
6. **选型 + 关键发现**：选 `text-embedding-v4 @1024`（纯文本、100+ 语言一套索引覆盖 ZH+EN、真 API 验证过 1024 维）；rerank(`qwen3-rerank`)故意先不做。**关键发现**：顾问答问走的是 `avery/memory.py::recall` **关键词**路径，cite 焊死在 `facts.md:<行号>`；光把 embedder 塞进另一个 store（`CompanyContext.store`）是**摆设**——顾问根本不读它。
7. **实现（feat-021 级新功能）**：把 `memory.recall()` 做成**可选语义**（有 embedder=向量余弦排序，无=退回关键词），来源仍 `facts.md:<行号>` → **cite 闸、红线一个字没动**；无 key/失败自动退回关键词。从 env 把 embedder 一路穿到 loop。
8. **验证**：174 测试全过（+5 新）；含一个**真打百炼 API** 的测试：查询"who is overwhelmed by constant churn and moving goalposts?"（与目标行零共同词）被正确排到第一，关键词版搜不到 → 向量的价值坐实。`/health` 报 `embeddings:dashscope:text-embedding-v4/1024`。流式 `/advise/sample` 实测跑通：read_case→recall(返回 facts.md 行)→cite×5→draft_advice。
9. **起服务器让 Danny 自测 → 暴露更深的集成崩盘**（见 §3）。Danny 喊停开发，要交接，下 session 救 15–20。

---

## 2 · 已修好的（本 session，未提交，见 §7）
- **前端**：Story/Live 可点（`global.css`）+ 剧本 rail 只在 story 模式挂（`AmbientCanvasShell.tsx`，+`data-mode`）。tsc 绿。
- **后端**：真向量语义检索接通（`text-embedding-v4`），174 测试绿，红线/ cite 不动，无 key 退回关键词。

## 3 · Danny 亲测暴露的问题（本 session 末，关键症状）
1. **🔴 live 的 "Your team" 仍显示 story 内容**：截图里是 story 的 handoff 卡——"Give the Venus pitch one last read"、"Say hello to Kate"、"Ask Jason if he could lend the demo a hand"——**这些是 `src/data/fixtures.home.ts` 的 `HOME_HANDOFFS_BELIEVED` 死数据**，不该出现在 live。**Danny 直觉：要彻底 lite 版分离、story demo 独立（倾向 yes）。** ← **核心岔路，下 session 重点。**
2. **上传解析几乎抽不出东西**：传 `MediPath-Roadmap.pdf` → 只出 1 个 project（`MediPath-Roadmap / done / Unassigned`）、**0 people**。正则抽取对 roadmap 型文档基本抓瞎。
3. **live 项目详情点开 = "Unknown project / Not found"**：症状指向——detail scenes 仍按 story fixtures 的 id 查，live 项目 id 进不去（下 session 确认具体机制：`ProjectDetailScene`/`EmployeeDetailScene` 是否读 live 源）。
4. **`/health` 显示 `{"detail":"Not Found"}`**：**正常**——Danny 打开的是根 `/`（无路由）→ FastAPI 404。健康页是 **`/health`** 不是根。（不是 bug，是 UX 困惑；可考虑给根加一句自述。）
5. **端到端无从验收**：缺"上传已知文件 → 期望 Your team → 期望回答"的验收锚（§6 seed 文件正是为补这个）。

---

## 4 · 崩盘根因初判（下 session 先做确诊，可能比这更深）
- **A · live 从没被人真正驱动过**：Story/Live 开关本 session 前是死的（pointer-events bug）。AFK 门只验 **UNIT**（pytest 绿 + DOM smoke），**没有一个真人从头点过 live 集成体验**。→ "测试绿"给了虚假安全感。**对照证据**：`git show 25e45fa:session-handoff.md` 里 feat-017/018 写着"✅ done / story 零回归 / dual-build 3/3"——全是单测口径，与现在的集成崩盘并存。
- **B · 一个 app 伺候两个主人（核心张力）**：story demo（脚本、像素级、给路演/视频）和 live lite（上传自有团队、freeform）挤在同一批 scenes+组件里，靠一个 `mode` flag 区分，但 story 到处渗进 live。**这就是 Danny 想彻底拆的那条岔路。**
- **C · scenes 是 story-first，没完全迁到 seam**：`TeamDataSource`/`StreamSource` 两道缝建了，但 `HomeScene` 的 Today/handoff spine 在 live 下仍渲染 story handoff 卡（§3.1）；detail scenes 大概率完全走 story id（§3.3）。**半切换 = story 渗漏。**
- **D · 抽取太浅（正则）**：`HeuristicExtractor` 保守正则，对非简历/花名册文档（roadmap/OKR/FAQ）基本抓瞎（§3.2）。`LLMExtractor` 接口在、没接。"上传→团队生长"的产品承诺被浅抽取拖垮。
- **E · 没有 live 路径的验收 gate**：pytest 测引擎、不测集成产品。没有端到端验收锚，所以没 gate 挡住"live 集成坏了"。

---

## 5 · 补救待决岔路（下 session grill 这些，别现在拍板）
**核心岔路（Danny 直觉 = 拆）：**
- **A) 硬拆**：story demo 独立成自己的 build/route（冻结，给路演/视频用）；lite 产品独立成干净 app，只吃 live seam，零 story 渗漏。**Danny 倾向这个。**
- **B) 原地修 mode gating**：每个 scene 按 mode 完全切"数据 + chrome"，消除 story 渗漏。便宜但保留"两主人"张力。
- **C) 折中**：共享底层原子组件，但 live/story 各自独立的 scene 容器 + 硬数据边界。

**其它要 grill 的：**
- **抽取**：正则 → 接 `LLMExtractor`（百炼 brain 已在），让非简历文档也抽得出人/项目；输出照过红线门。
- **验收锚**：用 §6 两个 seed 文件做端到端 smoke（"这2个文件 → 应抽出什么人/项目 → 顾问应能答什么"）。
- **live 详情**：detail scenes 要认 live 数据源（不然点开就崩）；或 v1 lite 干脆砍掉详情、只留 Your team + The room 两屏？
- **v1 lite 范围**：到底要哪几屏？别把 story demo 的全套 scene 硬塞进 lite。

---

## 6 · Seed-RAG 文件（Danny 定，下 session 的验收锚）
**主 seed（先跑这 2 个）：**
- `D:\teammaster-master\teammaster-master\seed-rag\LogiPulse-Roadmap.pdf`（12.9 KB）
- `D:\teammaster-master\teammaster-master\seed-rag\PrismDesign_TeamProfile_EN.xlsx`（16.7 KB）

**同目录扩展语料**（可做更全测试集）：`Engineering-Onboarding.txt`、`FAQ.pdf`、`Q1-OKR.pdf`、`Resume-Mid-UX-Designer.pdf`、`Resume-Senior-Motion-Designer.pdf`、`Sales-Playbook.docx`、`MediPath-Roadmap.pdf`（Danny 本 session 传的那个）、`hr_tools_database.json`、`ui_scale_industry_case.json`。

**用途**：定义"上传这 2 个 → 应该抽出哪些人/项目（PrismDesign xlsx 是团队画像→应出人；LogiPulse pdf 是 roadmap→应出项目）→ 顾问用近义词提问应能语义命中并 cite"。这是缺失的端到端验收 gate。

---

## 7 · 仓库/工作树当前态（精确）
- 分支 `feat/live-core-015-018`，**HEAD = `138e6d8`**（"clear 225 retired 待审字 markers"）。主 `main` 在 `2f76ceb` 不动，等分支验收后 merge。
- **Danny 的 33 文件审字-strip 已提交**（`138e6d8` + `2fbda32` lift-gates），**我上一段的 2 处语法塌行修复（fixtures.home.ts / teamDataSource.ts）已随 `138e6d8` 一起进去**。→ **没有传说中的"33 文件未提交乱麻"了。**
- **工作树 = 10 处未提交改动，全是本 session 的、全我写、全绿**，分 2 组（界限干净）：
  - **B · 前端两修**（2 M）：`src/styles/global.css`、`src/components/AmbientCanvasShell.tsx`。
  - **C · 后端真向量**（5 M + 3 ??，feat-021 级）：
    - 改：`eval-harness/avery/memory.py`（recall+embedder）、`avery/tools.py`（ToolContext.embedder）、`service/engine.py`（stream_advice embedder）、`service/app.py`（接线 + /health embeddings）、`.env.example`（模板）。
    - 新：`eval-harness/avery/embeddings.py`、`service/embedding_factory.py`、`tests/test_semantic_recall.py`。
- `eval-harness/.env` 改了（含真 `DASHSCOPE_API_KEY`）但 **gitignored、不进 commit**。
- **没有一样是 agent 提交的**（等 Danny 拍板）。C 干净、可独立 `git add` 成一个 feat commit，不碰 B。
- 复查用：`git diff --stat`；C 的 8 个文件路径见上，`git add` 它们即可单独提。

---

## 8 · 怎么把现状跑起来（下 session 复现用）
- **后端**：`AVERY_BRAIN=minimax python -m uvicorn service.app:app --host 127.0.0.1 --port 8137 --app-dir eval-harness`（key 在 `eval-harness/.env`）。健康：`GET http://127.0.0.1:8137/health`（**不是根 /**）→ 应见 `brain:minimax` + `embeddings:dashscope:text-embedding-v4/1024`。
- **前端**：`npm run dev` → :5173；`?mode=live` 或点右上 Live。
- **全测**：`python -m pytest eval-harness -q`（174 passed，~90s）。
- **真向量语义证明**：`python -m pytest eval-harness/tests/test_semantic_recall.py::test_real_embeddings_find_what_keyword_misses -q`（要 .env 里 DASHSCOPE key）。
- **复现崩盘**：起两个服务 → live 模式 → 传 §6 两个 seed → 看 Your team（story 渗漏？抽出几个人？）→ 点项目详情（Unknown project？）→ The room 提问看 recall/cite。

---

## 9 · 锁定的战略上下文（别 re-litigate，直接引用）
- **07-05 战略/决策/锁定事实**：`git show 25e45fa:session-handoff.md` + `docs/strategy/2026-07-05-dual-line-strategy-roundtable.md` + `docs/strategy/2026-07-05-real-integration-map.md`（feat-016/017 施工图）+ `docs/adr/0020-*`（graduate+seam）、`0021-*`（两引擎+换皮+双端）+ `CONTEXT.md`。
- **🔴 红线（不可谈）**：人卡永不评分/排名/画像/moodPct/capacityPct。类型层焊死（`PersonEntity` 无数字字段）+ `redline_extract` 门 + 前端剥离。**本 session 的向量改动保持红线不动，补救也必须守。**
- **双端**：境内中文 MiniMax / 海外英文 Claude；pluggable brain + embeddings（现 embeddings 默认 = 百炼 text-embedding-v4，可 env 切）。
- **AFK 硬约束**（memory `afk-self-loop-minimize-danny`）：dev+test 自跑自验自修，人工闸只留销毁/对外/花钱/凭据。**但本 session 的教训 = AFK 缺"集成/真人验收"这道 gate（§4-E），补救计划要补上。**
- **客户/商业**：见 07-05 handoff §2（三亚绿杉壹居度假酒店 / Skeppsviken；四层付费无免费层）。

---

## 10 · 给下 session 的开场剧本（建议）
1. **读**本文件 + §9 引用。
2. **第一步（诊断，先别写码）**：按 §8 复现崩盘，亲眼确认 §3 症状 + §4 根因；产出一份"为什么 15–20 临近崩盘"的确诊（欢迎比 §4 更深/更准）。
3. **第二步（grill）**：用 grilling skill，对 §5 岔路（尤其 **A 硬拆 vs B 原地修**）逐条压，逼出一个 Danny 拍板的补救计划。
4. 计划定了、Danny 拍板，再按 AFK 常规推进。**在此之前不写实现代码。**
