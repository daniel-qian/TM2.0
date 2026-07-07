# story/lite 同仓立墙(quarantine + lint 边界);抽取主引擎换 LLM;验收 = 双层机器门

> 修订 [ADR-0020](0020-avery-graduates-from-demo-only-to-live-lite-product.md) 决策 3 的半句——"两模共用**全部**视觉组件"降为"共用 **shared 原子层**(卡片/字体/CSS tokens),场景容器分家";ADR-0020 其余(graduate、story+live 双模、两道 seam、Python 后端)与 [ADR-0021](0021-two-engine-core-vertical-packs-skins-dual-deploy.md)(两引擎、红线内建抽取、换皮、双端)全部不动。红线仍受 [ADR-0015](0015-product-tone-human-advisor-debrand-saas-naming.md)/[ADR-0018](0018-renqingwei-demoted-to-redline-product-truth-decision-layer.md) 约束。
> **状态:** Accepted(Danny 拍板 2026-07-07,grilling 六岔口记录见 [.issues/live-rescue-0707/plan.md](../../.issues/live-rescue-0707/plan.md))

## 背景

feat-015–020 一次 AFK 串行链建完 Avery Live 内核:174 单测全绿、服务能起、真向量已通——但 2026-07-07 Danny 亲测 + 复现确诊,作为集成产品临近崩盘,三个机制(全部 verified):

1. **story 渗漏**:seam 设计正确但只覆盖半张网——live 空态回退 scripted 源且 HomeScene 只把右栏换上传面板(左脊柱照渲染 Venus/Kate/Jason);TeamComposer 整个在缝外(live 下预填 story 问题、提交进 story 剧本机);详情页只查 fixtures(live 卡必 "Unknown project")。**mode-gating 已以最佳形态(真 seam)试过一次,仍漏 6 处**——它的失败模式是"每个渲染点都要记得接缝",而 AFK agent 没有"记得",只有闸门有。
2. **抽取抓瞎**:HeuristicExtractor 每文档只产 1 个项目、roster 焊死 Name 在第 0 列、doc_kind 靠文件名关键词。两个官方 seed 双双拓欻:20 人规整 xlsx → 1 个叫 "No." 的假人;多阶段 roadmap PDF → 1 个文件名项目。`LLMExtractor` 接口在、从未接。
3. **验收器没长眼睛**:测试 fixture 按抽取器自己的假设反向定制(文件名带 roster、Name 第 0 列、竖线行)= 数据层的 maker==checker;live 集成从未被任何人点过一遍(Story/Live 开关曾是死的)。"174 绿"与"产品崩盘"因此并存。

同时确诊了**成立的部分**:advisor+RAG 腿端到端真跑通(上传→facts.md→语义 recall→cite 行号→红线→8 字段卡),红线全链路零违规。故补救 = 三件套,不是拆迁重建。

## 决策

1. **同仓立墙(拆/修岔路取 C)。** 一个 repo,三个区:
   - `src/story/**`:fixtures、cases、rail、满血场景(地图/多人 Chat/满血 reality-gap/剧场 NexusScene)。**冻结为路演/视频资产**,rail 回放机器原样(ADR-0003/0006/0012/0013/0014 继续 honored)。
   - `src/lite/**`:产品壳,v1 = 3 屏(上传空态 · Your team · The room)+ 薄只读详情浮层(~百行,纯 live payload 渲染,零 fixtures 依赖)。The room **薄建**(live SSE 控制台 + 8 字段卡),不搬 1400 行剧场 NexusScene。
   - `src/shared/**`:卡片/字体/CSS 原子,两侧共用。
   - **边界是机器闸不是纪律**:ESLint `no-restricted-imports`——lite import story 直接红灯。渗漏从"忘了就漏"翻转为"漏需要违法"。
2. **抽取主引擎换 LLM。** `LLMExtractor` 接 pluggable brain(**现实可用 = MiniMax-M3 + DeepSeek;`claude` 仅 brain_factory 代码路径、无 key、未验证,不得假设存在**):喂带行号解析文本 → 结构化输出多人/多项目/信号,每实体带来源行号(cite 链不断)→ 产物过**同一个红线门**(PersonEntity 类型层无数字字段不变)。无 key/失败自动退回 heuristic(离线 AFK 门保绿);正则不再修、降级为测试/兜底。顺带 pypdf mojibake 清洗。
3. **验收 = 双层机器门,agent 当第一个用户。** ① 离线层(每次必跑):golden-payload 回放 + 现有 pytest。② 集成层(feature 标 done 前必跑):真起后端、真传两个 seed 文件,断言具名抽取(xlsx ≥15 人含 Lin Qing/Chen Mingyuan、假人黑名单=0、pdf ≥2 项目且标题≠文件名、问答 cite 命中);前端真浏览器自驱走完整流,DOM 全程扫 story 专有名词黑名单 = 0。**Danny 只事后抽查报告+截图,不设人工闸**(与 AFK 记忆调和:机器把"真人验收"的活干了)。

## 取舍 / 理由

- **为什么不是 B(原地修 gating)**:B 已经以最佳形态败过一次(见背景 1)。逐点修完今天的 6 处,明天每个新表面仍默认渗漏。
- **为什么不是 A(硬拆两 app)**:A 的真实代价是共享视觉原子要么复制(双维护)要么建 shared 包(= C 的多仓版);The room 薄建之后 A/C 差别只剩"同不同仓",同仓保住一套 CI、一套视觉语言、feat-018 双端部署配置基本可保。若边界被侵蚀,A 是升级路径。
- **为什么抽取不修正则**:seed 证据说明这场游戏正则赢不了(真实世界文档的格式方差);抽取每次上传只跑一次,LLM 延迟/成本不是瓶颈。
- **为什么 gate 先于修复**:不先立眼睛,墙和抽取的"完工"又是自说自话——这正是本次崩盘的复发模式。
- **回退成本**:立墙是加性重组(移动文件 + lint 规则),story 侧冻结不动,删 lite/** 即回 story-only demo;LLMExtractor 失败退 heuristic,一键回今日行为。

## 后果

- 落 `feature_list.json`:**feat-021**(真向量语义检索,done,commit 53e0ef6)/ **feat-022**(seed 端到端双层机器门,先立必红)/ **feat-023**(LLM 抽取,修绿后端断言)/ **feat-024**(立墙 + lite 3 屏壳,修绿前端断言 + story 回归仍绿)。施工顺序:022 先行 → 023/024 双线并行 → 合流全绿 → Danny 抽查 → merge main。
- ADR-0020 的"两模共用全部视觉组件"按本 ADR 决策 1 修订;`?mode=` 开关语义由"同一棵场景树换数据源"变为"两个壳"(实现期定 URL/构建形态,story 资产 URL 不变是硬约束)。
- AFK 门定义扩展(施工图 §6 之上):**任何 lite 表面的 done 判定必须含集成层证据**,单测绿不再单独构成 done。
- 红线扫描继续覆盖 live 产出(ADR-0021 §4);本补救全程不触碰红线机制。
