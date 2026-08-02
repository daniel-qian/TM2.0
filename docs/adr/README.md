# ADR 索引

`docs/adr/` 下现有 33 个 ADR 文件（0001–0032，其中 0023 被两个文件双占，见下节）。本索引只做「编号 + 标题 + status」的一行对照，不复述正文；细节进各文件自己看。

status 列：能在文件里找到显式 status 字段的照抄（英文 frontmatter `status:` 或正文 `**状态：**`），找不到的写「无 status 字段」——早期 ADR（大致 0001–0015 一带，0005/0009/0011 除外）没有这个惯例，不是我漏抄。

## 索引

| 编号 | 标题 | status |
|---|---|---|
| ADR-0001 | Prototype 2.0 是 demo-only；工程类 design docs 仅作 reference | 无 status 字段（早期 ADR） |
| ADR-0002 | 前端 stack = Vite + React + framer-motion（非 Next、非 vanilla） | 无 status 字段（早期 ADR） |
| ADR-0003 | Demo rail = free-click core 之上的可拆 driver | 无 status 字段（早期 ADR） |
| ADR-0004 | Nexus = 独立放射编排画布，线性推进 + 预置语义拓扑 | 无 status 字段（早期 ADR） |
| ADR-0005 | 详情页静态恒显，killer beat 靠 beat 顺序而非 state-gating 保护 | superseded by ADR-0009 |
| ADR-0006 | Demo rail = 冻结 store 之上的无状态 replay-to-target driver | 无 status 字段（早期 ADR） |
| ADR-0007 | Nexus 思考流不可打断；整页 drill-in 仅前戏/落地段；Capabilities 独立成收尾 beat | 无 status 字段（早期 ADR） |
| ADR-0008 | Nexus thread 内嵌 Chat 对象；B7 human-loop 升级为中央 chat 卡（amend ADR-0004 §5） | 无 status 字段（早期 ADR） |
| ADR-0009 | 详情页改为 state-aware「智能层随 thread 生长」，supersede ADR-0005 的静态恒显模型 | accepted（supersedes ADR-0005；显隐机制 amended by ADR-0011） |
| ADR-0010 | Calm 人卡采用游戏化 HP/MP HUD（HP=headroom, MP=mood）；地图层守 calm；仅限 calm 卡片 | 无 status 字段（早期 ADR） |
| ADR-0011 | 详情页 believed/grown 改为「模块恒显、内容随 thread 生长」——amend ADR-0009 的「隐藏整模块」机制 | accepted（amends ADR-0009：反剧透目标保留，隐藏机制反转） |
| ADR-0012 | Dashboard & Nexus 升级为可平移/缩放画板（react-zoom-pan-pinch）；chrome/canvas 分层 + rail 派生镜头 | 无 status 字段（早期 ADR） |
| ADR-0013 | 多 Thread Nexus：一次性解冻 canvasStore 契约、per-case 定义数据形、Follow-up 与 errand cases | 无 status 字段（早期 ADR） |
| ADR-0014 | Nexus 终端流 HUD：左侧节点链退役，改终端式流式打印；Manifest 画板留存、镜头收敛 | 无 status 字段（早期 ADR） |
| ADR-0015 | 产品定调：人性化顾问而非 AI SaaS 效率工具；品牌声音 + 命名候选 + 全局去-SaaS pass；人卡退游戏化量化 | 无 status 字段（早期 ADR） |
| ADR-0016 | Avery 在两个方向上都果断：红线「不给人打分」≠「永远回避硬对话」 | Accepted（Danny 拍板 2026-06-21） |
| ADR-0017 | 「Your team」改为卡片式今日主页，空间地图降级为页内全景子视图 | Accepted（Danny 拍板 2026-07-03） |
| ADR-0018 | 定调修订：「人情味打法」从产品真理退为红线；产品真理改为「管理决策层」；展示面数字政策放宽 | 无 status 字段 |
| ADR-0019 | 商业模式：四层付费取代「advisor AI + tools 免费、playbooks 付费」——无免费层，订阅为主体、服务开路 | 无 status 字段 |
| ADR-0020 | Avery 从 demo-only 毕业为 live lite 产品；脚本层保留为一等 "story mode" | Accepted（Danny 拍板 2026-07-05） |
| ADR-0021 | 内核 = 两个引擎（Advisor + Ingestion/RAG）；垂直 = 换 Capabilities 包 + 皮肤；双端部署 | Accepted（Danny 拍板 2026-07-05） |
| ADR-0022 | story/lite 同仓立墙(quarantine + lint 边界)；抽取主引擎换 LLM；验收 = 双层机器门 | Accepted（Danny 拍板 2026-07-07） |
| ADR-0023-ask | Ask 卡：员工自述式快问的红线边界（问事不问人 / 证据不进人卡 / 永不跨人比分） | Accepted（Danny 拍板 2026-07-13） |
| ADR-0023-postgres | lite v1 公司工作区落 Postgres(Supabase)：ContextRegistry 持久化，取代"故意 ephemeral" | Accepted（feat-030，2026-07-13，AFK 实现，Danny 事后抽查） |
| ADR-0024 | 单端部署：一个 Vercel 前端（ZH 默认）+ 一台法兰克福后端 —— 取代 ADR-0021 §5 的对称双端 | Accepted（2026-07-18） |
| ADR-0025 | Command Room 对齐：命名部分解锁 + aurora 转默认 + 评分承诺开关化 | 已采纳（Danny 拍板，2026-07-21） |
| ADR-0026 | onboarding 全屏闸门页 + 克隆制一键示例团队 | 已采纳（Danny 2026-07-21 拍板） |
| ADR-0027 | cr 视觉对齐战役：规格驱动 + 缺陷类扫雷 + 偏差台账 | 已采纳（Danny 批准战役计划 + 四项拍板） |
| ADR-0028 | 真 CRUD：手编赢 + 逐字段出处（provenance） | Accepted（2026-07-22，满态对齐盘问·决策批②） |
| ADR-0029 | 满态对齐走真管道，不走 demo 注入 | Accepted（2026-07-22，满态对齐盘问·决策批①） |
| ADR-0030 | 合伙人文件进 app 走「样本资料页」，不做同意面、不做签署流 | Accepted（2026-07-28，partner-docs-0728 盘问） |
| ADR-0031 | 大白话命名 pass：抽象词族退役，企业白话上岗（v02 全词表） | 已定（Danny 逐词审字通过） |
| ADR-0032 | 资料库升 tab，「完整版预告」降设置菜单 | 已定（Danny 盘问 ×3 轮逐项拍板） |

## 编号冲突

`0023` 这个编号被两个文件双占，起名的时候没人发现撞了：

- `ADR-0023-ask` = `0023-ask-employee-selfreport-redline-boundaries.md`
- `ADR-0023-postgres` = `0023-postgres-persistence-for-lite-v1-context-registry.md`

**规定：此后引用一律带后缀**（`ADR-0023-ask` / `ADR-0023-postgres`），裸写 `ADR-0023` 视为歧义——不知道指哪个。这条规则不追溯改历史引用（全仓约 105 处裸写 ADR-0023 的地方不逐个清），只管住以后新写的引用。

## 取代关系图

全部照 ADR 正文原话记，不脑补没写的关系：

- **0001 ← 0020**：0020 第 3 行「超越 [ADR-0001]（demo-only）——其后果段设的重启条件（"Venus 验证后才重启架构"）已由路演验证达成」。
- **0005 → 0009**：0005 第 2 行 frontmatter `status: superseded by ADR-0009`、第 7 行「本 ADR 已被 ADR-0009 supersede」；0009 第 2 行 frontmatter `status: accepted（supersedes ADR-0005…）`、第 5 行标题自带「supersede ADR-0005 的静态恒显模型」、第 29 行「supersede ADR-0005（标记其 status）」。
- **0009 ← 0011 amend**：0011 第 33 行「amend ADR-0009：反剧透目标保留；机制『隐藏整模块』→『模块恒显 + 内容随 thread 生长』。ADR-0005 仍被 supersede（不回退到静态恒显含诊断）」。
- **0004 的空间表达 + 0012 的节点链部分 → 0014**：0014 第 3 行「取代 [ADR-0004] 的放射画布**表达**（其推进模型——无参 `runAgent()` 线性走编排表、ADR-0003 litmus——全部保留），并取代 [ADR-0012] 修订 5 决策 4 / 修订 6 §3–§6 的 **Nexus 节点链部分**（Dashboard 部分一概不动）」。

**不要重命名任何 ADR 文件。** 两类东西会断，别混为一谈：**相对 markdown 链接**（ADR 之间以及各文档指向 ADR 的 `[…](0023-….md)`）会真断成 404；散文里裸写的 `ADR-0023` 字符串（全仓 118 处，其中只有 13 处带了后缀消歧，即 105 处裸写）不会"断"，但会继续指代不明——那正是本索引与 `ADR-0023-postgres` 后缀写法要解决的问题，靠改号解决不了它，只会再加一层重定向。
