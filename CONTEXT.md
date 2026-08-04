# Avery

（旧称 TeamMaster；品牌已锁定 Avery，见 [ADR-0015](docs/adr/0015-product-tone-human-advisor-debrand-saas-naming.md)。内部领域概念名 Nexus / Capabilities / Reality-gap 等仍保留，只换 user-facing surface label。）

面向小公司 manager / founder / CEO 的人与项目管理平台。把公司事实、专家方法论、实时工作信号合成为可追溯、可校对、可执行、且经人确认的管理建议。

定调（[ADR-0018](docs/adr/0018-renqingwei-demoted-to-redline-product-truth-decision-layer.md)，修订 ADR-0015）：**产品真理 = 管理决策层**——帮 manager 做出更稳妥、可追溯、算得清账的人事与项目决策。人情味 / 前辈人设退为**红线 + 风格资产**：产品表面默认仍是温暖的顾问声音，但它不再是产品的自我定义，也不再否决 dashboard / 效率 / 商业语言。

本文件只是术语表（glossary），不放实现细节、不放 demo 脚本、不放架构决策。

## Language

**Positioning（定调）**：
**产品真理 = 管理决策层**：帮 manager 做出更稳妥、可追溯、算得清账的人事与项目决策。"资深前辈在你耳边"的人设是产品表面的默认风格资产，不再是总开关；商业/路演/投资表面可自由使用 dashboard / 效率 / 降本增效 / ROI 语言。见 [ADR-0018](docs/adr/0018-renqingwei-demoted-to-redline-product-truth-decision-layer.md)（修订 ADR-0015）。
_Avoid_: 把人情味当产品自我定义来写（它是红线与风格，不是真理）

**Voice（品牌声音）**：
产品表面（面向使用者）默认仍像一个见过世面、站在你这边的资深同事说话——温暖、平实、指向善意的下一步。**红线（任何表面、永远有效，[ADR-0018](docs/adr/0018-renqingwei-demoted-to-redline-product-truth-decision-layer.md)；①句 2026-07-21 解禁拍板改为开关口径，07-22 满态对齐战役随行）**：① **默认**不量化/评判/标签化任何一个人（无分数、无等级、无血条、无人格断言）；人的量化呈现（负载、情绪等）**只在公司主动开启的开关下**出现，且必须写明口径与出处（谁说的、哪份文件、自述还是他述）——绝对句「永不打分」已废止，别再抄回来；② 文案不得让被讨论的那个人觉得被处理。旧测试"像 AI 在自夸效率吗 / 温暖前辈会这样说吗"降为产品表面的风格建议，不再否决。护栏不变：**保留"它说得出依据"**（reasoning/evidence 改人话不删）。**数字政策**：mock/预估数字可上展示面（代码注释标注性质；结果形态数字加页面微标注"设计目标值"）；伪造实测口径（eval 分数、用户数据）仍禁。
_Avoid_: 给人打分/量化成数值（人不该有血条）；没有真人评分就上 eval scorecard

**Dashboard**：
进门第一面（surface label "Team"／「团队」，0729 大白话命名 [ADR-0031](docs/adr/0031-plain-speak-naming-pass.md) 前为 "Your team"）——回答"**今天该把心思花在哪**"：分析浏览区（人与项目双轨卡片）+ 今日 Handoff checklist 区，分区混排、概念不混。（live mode 下这些卡片由 **Ingestion** 从上传文件填充，story mode 下由 `fixtures`；见 [ADR-0020](docs/adr/0020-avery-graduates-from-demo-only-to-live-lite-product.md)。）它是**观察 + 轻照料面**：看清处境、勾掉/搁置今天的小事；重的编排仍去 Nexus。地图不再是这一面的主形态，退为页内的全景子视图（见 Team map）。见 [ADR-0017](docs/adr/0017-card-home-demotes-team-map.md)。
_Avoid_: home、canvas（canvas 是视觉手法，不是这个概念本身）、PM 仪表盘语言（P0 徽章 / 统计数字 chips / capacity 读数——SaaS 腔，违反 [ADR-0015](docs/adr/0015-product-tone-human-advisor-debrand-saas-naming.md)）

**Team map**：
Dashboard 页内的**全景子视图**——把人、项目、信号画成一张平静的空间地图。经卡片上的"在全景上看"类入口进入，镜头推进、关联簇点亮；calm / focus 语义都属于这一层。它是 demo 的高光时刻与关系全景，不再是进门第一眼。
_Avoid_: 把它当独立页面/tab（已降级，见 [ADR-0017](docs/adr/0017-card-home-demotes-team-map.md)）、glance map（旧称，暗示"进门第一眼"）

**Nexus**：
**行动面** —— manager 的一个问题在这里变成一条被编排的 Thread：specialist agents 与人类同事协同，agent 在背景聆听并交叉校对证据，按需调用 tools，最终产出供人 review 的结构化可信输出。
_Surface label_（[ADR-0015](docs/adr/0015-product-tone-human-advisor-debrand-saas-naming.md)，0729 更新 [ADR-0031](docs/adr/0031-plain-speak-naming-pass.md)）：user-facing 不出现 "Nexus" / "orchestration"（纯技术腔）；现行入口名 **"Ask Avery"／「问 Avery」**（0729 前为 "The room"／「议事室」——「空间」隐喻整体退役，指代一律落在 Avery 本人身上）。"Nexus" 仅作内部领域概念名保留。
_Avoid_: 把**整个** Nexus 等同于 chat / conversation / 一个聊天 thread（会抹掉多 agent 编排本质）。注意：Nexus 内部确实嵌着一个**窄口径**的子面 **Chat**（见下条），但 Nexus ≠ Chat——Chat 只是编排走到"需要人裁断"那一步时临时开出的决策面。

**Thread**：
Nexus 内的**一次编排会话**：一个问题（及其 Follow-up）、其链上工作与 Manifest、**自己的 context 预算**。Thread 之间彼此独立；可关闭、可从历史重开，关闭不丢失任何状态。
_Avoid_: conversation / chat（抹掉编排本质）、session（泛指，不带"编排 + context 预算"语义）

**Follow-up**：
在既有 Thread 的某个 Manifest 上**追加的问题**；延长**同一条 Thread**（同一 context、同一链、Manifest 继续累积），不开新 Thread。是"能不能基于产出继续问/继续执行"这个问题的产品答案。
_Avoid_: new question（暗示开新 Thread）、reply（暗示聊天往复，丢失"基于产出行动"语义）

**Chat**：
Nexus thread **内部**、在编排需要人判断时由 **agent 发起**开出的多人协同面（相关同事 + 在场 agents 来回）。三条约束让它**不是 Slack / ChatGPT**：① **agent 发起**——只在靠信号 / Capabilities 推不出、必须要人裁断时召集，不是随手能开的频道；② **绑定单个决策、用完即合**——只围绕该 thread 的问题，结论达成即关，非常驻；③ agent 是**在场协同方**（主动抛具体 evidence + Capabilities），且对话产出**结构化沉淀进 report、成为 provenance（可追溯）**。是 pitch "经人确认" 唯一真正发生的地方。
_Avoid_: Slack 频道 / 群聊（暗示常驻、随手开、什么都聊 = 把护城河稀释成"带 AI 的 Slack"）、聊天机器人（agent 不是被 @ 才动的 bot，是在场协同方）

**Ask**：
Thread 内由 agent 发起、经 manager 确认后递到**具名员工**手边的轻量快问（分享链接、免登录，1~3 题快答 + 选填短评），回执作为**情境证据**回到同一条 Thread。它问"事"不问"人"：员工自述对某件事的把握不是给人打的分——答案永不成为人的属性、永不跨人比分（边界见 [ADR-0023](docs/adr/0023-ask-employee-selfreport-redline-boundaries.md)）。是 Chat 之外第二个"经人确认"触点：Chat 拉同事进房间裁断，Ask 把一个具体问题递出门。
_Surface label_：EN **"Quick ask"**、ZH **"快问"**；员工侧页面必须明写谁在问、问的什么事、回答会给谁看。
_Avoid_: survey / 问卷（表单工具腔，暗示题海与匿名收集）、poll / 投票（匿名聚合语义，Ask 是具名自述）、打分 / 评分——Ask 回执永不成为人的属性、永不跨人比分（[ADR-0023](docs/adr/0023-ask-employee-selfreport-redline-boundaries.md) 边界仍有效）；人的量化呈现另走公司开关口径（见 Voice ①）

**Briefing**：
Dashboard 上呈现的一段**离散、可重新生成**的高管摘要（"组织天气"）。可以不止一条，manager 可以再取一条。
_Avoid_: summary、report（report 专指 Nexus 的结构化输出）

**Calm**：
Team map（全景子视图）的**静息态**——人与项目以最简密度铺成一张平静地图，无高亮、无展开。全景的默认状态；点空白处即回到 calm。
_Avoid_: idle、empty（calm 是"一切尽在掌握"的平静，不是空）

**Focus**：
calm 的反面——**一组关联实体被点亮、其余淡化**的状态。由四种选择器触发：点单个节点、选 tag、搜索、从 Dashboard 卡片经"在全景上看"入口飞入。关键：**单点也点亮"该实体 + 它的关联簇"**（owner / 依赖 / 被分配的人），不是只亮被点那一个。是从"观察"过渡到"将要钻入"的中间态。
_Avoid_: select、filter（filter 暗示"减项"，focus 是"点亮关联簇"）、highlight（只说了视觉、没说关联语义）

**Reality gap**：
"被相信的状态"与"实时信号"之间被检测出的矛盾（例：owner 报 on-track，但信号显示 PR 卡住、重复 blocker、任务零更新）。系统只**指出矛盾并给低风险下一步**，绝不做人身/人格评价。其中"自报 vs 信号"这一具体子类叫 **report mismatch**。
_Surface label_（[ADR-0015](docs/adr/0015-product-tone-human-advisor-debrand-saas-naming.md)，0729 更新 [ADR-0031](docs/adr/0031-plain-speak-naming-pass.md)）：user-facing 不用 "Reality gap" / "report mismatch"（像数据校验错误、点名时刺痛），现行 **"Worth noting"／「值得注意」**（0729 前为 "A closer look"／「多看一眼」）；底层领域概念名不变，不刺痛判据不变。
_Avoid_: discrepancy、conflict

**Manifest**：
一次 Nexus 编排中 agent 经思考/工作链**创造出的一切可见产物的集合**——report、图表、human chat、决策记录等。强调"显形"：过程在链上发生，产物在 Manifest 中可见、可回看、可累积。
_Avoid_: output（output 窄指结构化报告这一种产物）、artifacts（泛指、丢失"经链条显形"的语义）

**Handoff**：
agent 产出的、落在 Dashboard / 详情页表面上**可直接执行**的单条行动（checklist 形式，可 done / discard，部分可一键飞回 Nexus 深挖）。是"建议"与"已确认派出的 Task"之间的中间态：人确认后才经 dispatchTask 变成 Task。自 [ADR-0017](docs/adr/0017-card-home-demotes-team-map.md) 起，Dashboard 的今日 Handoff checklist 区是进门第一眼的主体之一；完成感是安静的（勾掉、收进"今天已照料"），不游戏化。
_Avoid_: action item、todo（会跟已派出的 Task 混淆）

**Capabilities**：
Avery 自有的垂直领域专家知识层——跨 HR / Legal / PM / Finance / Ops / Sales 的真实案例、解决方案、SOP / playbook。可信性的"第二条腿"：公司事实回答"发生了什么"，Capabilities 回答"专业上该怎么判断、怎么处理"。是 agent 建议区别于普通 ChatGPT（只有泛化常识）的关键。lite 版的公司事实来自 **Ingestion** 上传（见 **Company context**）。**Avery 私有资产，随 Manager seat 订阅提供、不单卖，agent 检索时自动优先引用——产品的护城河，也是席位定价的依据（席位贵在有 playbooks 背书的判断，不是贵在 UI）。**
_Surface label_（[ADR-0015](docs/adr/0015-product-tone-human-advisor-debrand-saas-naming.md)）：user-facing 一律用 **"Playbooks"**（资深前辈的词，温暖、有经验感）；"Capabilities" 仅作内部领域概念名 / type / 变量名保留，不进用户界面（含"the moat"等护城河自夸不进界面）。
_Avoid_: CAPA（撞行业既有术语 Corrective-And-Preventive-Action，会让听众卡顿解码）、capabilities RAG（RAG 是检索机制，不是这个知识层本身）、专家能力库

**Language surface（语言面）**（2026-08-03 新增，见 [ADR-0033](docs/adr/0033-locale-is-a-request-field-backend-stops-emitting-prose.md)）：
说"产品是中文还是英文"这句话时，**必须先说清是哪个面**——它们互相独立，可以各说各话：
① **界面壳文案**（`src/shared/i18n/`，前端 `?lang= > VITE_AVERY_LOCALE > en`）；
② **后端派生文案**（规则推导出的句子——ADR-0033 后改为只回机器键，句子归前端）；
③ **LLM 判读正文**（由请求 locale 写进 prompt 决定，不再涌现）；
④ **引文 evidence**（**永远是原文语言**，跟界面语言无关——逐字引用，翻译＝编）。
🔴 与上述四者**都不是一回事**的第五样东西：**输入侧检测词表/正则**
（`extract.py` / `redline.py` / `granularity.py` 里那几百条中文）。那是用来**读中文文档**、
守红线的匹配模式，**「文档语言」≠「界面语言」**——界面切英文时它们必须仍是中文。
把它当"没本地化的文案"顺手双语化，会当场砸掉解析与红线。
_Avoid_: 笼统说"把产品翻译成英文"（不指明面，必然有人误伤词表）；
把 locale 当"UI 开关"（它现在是判读请求的输入，决定正文语言）

## Product surface（2026-07-05 圆桌新增，见 [ADR-0020](docs/adr/0020-avery-graduates-from-demo-only-to-live-lite-product.md) / [ADR-0021](docs/adr/0021-two-engine-core-vertical-packs-skins-dual-deploy.md)）

**Avery Live**：
毕业后的 Avery——现有 Vite demo 从 demo-only 升级成的真·lite 产品（[ADR-0020](docs/adr/0020-avery-graduates-from-demo-only-to-live-lite-product.md) 超越 [ADR-0001](docs/adr/0001-prototype-demo-only-engineering-docs-are-reference.md)）。同一 codebase、双模（story / live）。user-facing 不出现 "Avery Live" 这种内部区分，用户看到的就是 "Avery"。
_Avoid_: 把它当独立于 demo 的新 app（是 demo 毕业，不是重造）；把 landing 也算进来（landing 是独立营销页，不动）

**Story mode / Live mode**：
Avery Live 的两种数据来源模式。**Story mode** = 脚本（`cases.ts`/`fixtures.home.ts`）驱动的可控叙事，供路演与视频（feat-013），保留原 rail 回放机器。**Live mode** = 真 agent 服务 + 真 Ingestion 驱动，接受用户真实输入/上传，是部署给融资团队的可用 Sampler。
_Avoid_: 把 live mode 说成"实时/real-time"（那指数据新鲜度）；把两模当两个产品（同一 codebase 一个开关）

**Ingestion**：
把客户自己的文件（员工简历、项目材料、公司资料）变成 Avery 可用"公司事实"的管线：上传 → 解析 → **红线安全的结构化抽取** → 全向量 RAG → 填充 Your team + 喂回答卡。lite 版用它**替代"一对一数据接入"**。红线：抽取人相关信息**只到定性**，绝不评分/排名/画像（[ADR-0021](docs/adr/0021-two-engine-core-vertical-packs-skins-dual-deploy.md) §4）。
_Avoid_: connector / 数据接入（那是 live 直连他们系统，是 roadmap，不是 Ingestion）；"上传附件给聊天"（Ingestion 产出结构化实体 + 填 Your team，不是塞进 prompt）

**Company context (uploaded)**：
Ingestion 产出的、**某一家公司**的事实层——人（定性）、项目、材料，进 RAG 供 agent 检索。可信性的一条腿（"发生了什么"），与 Capabilities（"专业上该怎么判断"）并列。lite 版来自上传；企业版将来可来自 live 连接器。
_Avoid_: company brain（太大词，那是 Setup 层的完整对接）；跟 Capabilities 混（一个是这家公司的事实，一个是跨客户的专家方法论）

**Vertical pack**：
一个行业的 Avery 实例 = **Capabilities 包**（该行业案例/playbook/信号阈值，跟合伙人 HR 包同形）+ **Skin**（行业视觉主题）+ 客户**自己上传的数据**。两个引擎（advisor + ingestion）+ 两道 seam 全部共享——加行业 = "换皮"，不重写内核（[ADR-0021](docs/adr/0021-two-engine-core-vertical-packs-skins-dual-deploy.md)）。酒店先行（婚宴亮点；客户=三亚绿杉壹居度假酒店）。
_Avoid_: fork / 分支（不是 codebase 分叉，是同一内核换配置）；vertical product（暗示独立产品线）

**Skin**：
垂直包里的行业视觉主题——配色/措辞/示例贴合该行业（酒店 vs 建筑），但布局与交互机器不变。
_Avoid_: theme（太泛）；把 skin 当"改功能"（skin 只换表皮，功能在内核）

**Sampler**：
部署给国内融资团队、拿去给 prospect 试玩的 Line A live-mode 表面。漏斗顶端的**演示/营销面**，不是付费产品（商业模式见 [ADR-0019](docs/adr/0019-commercial-model-four-layer-paid-no-free-tier.md) + 本文件 **Commercial language** 段）——用临时会话/上传样本，不持久化成公司工作区。
_Avoid_: free tier / 免费版 Avery（违反"无免费层"，见本文件 Commercial language 段；sampler 是尝鲜演示，不是产品免费档）；trial（暗示产品试用期）

## Tenancy & surfaces（2026-07-18 新增，前端首次真部署时补齐）

这一组词在每一份 PRD、每一次交接、8 条并行线里天天出现，此前术语表零记录。

**Context（公司上下文）**：
一次上传所建立的、属于**某一家公司**的全部事实——人、项目、信号、笔记、文件都挂在它下面。它是租户边界：Avery 眼里"一家公司"就是一个 Context。由上传动作诞生，不需要注册。
_Avoid_: workspace / tenant / account（都暗示一个先于数据存在的容器；Context 是被数据创建出来的）、session（Context 跨会话存活）

**Owner token（主人凭证）**：
证明"这个 Context 是我的"的凭证。**建立 Context 时只发一次**，此后每一次读取和提问都要出示它。出示不了的人得到的答案是"没有这个东西"，而不是"你没权限"——**刻意不告诉外人它是否存在**。
_Avoid_: 登录 / 密码 / API key（它不是身份，是持有即所有权的凭证）、把它写进网址（凭证进网址等于泄露）

**Lite（v01）/ Lite2（v02）**：
同一个产品的两代外壳。**Lite 是当前对外默认**；Lite2 是正在成型的下一代（更多分面、更完整的日常动线）。两者共用同一个后端与同一套事实，差别只在外壳。
_Avoid_: 新版/旧版（暗示 v01 会被直接替换，实际是 v01 网址全程不动）、MVP/正式版（两者都在真实使用）

**Look（长相：paper / aurora）**：
**同一个产品的两种长相**，按客户挑：`paper` 是暖纸编辑风（默认），`aurora` 是极光玻璃风。**它是选给客户的，不是客户自选的装饰**——同一家公司每次进来都该看到为它选定的那一张。只存在于 Lite2。与 **Skin** 是**正交**的两条轴：Skin 管"哪个行业"（酒店 vs 建筑，见上），Look 管"哪张脸"——一家酒店客户可以同时要酒店 Skin 和 aurora Look。
_Avoid_: skin（**已被行业主题占用**，2026-07-18 定名时正是为了拆开这两个概念）、theme / 主题 / 换肤（都暗示用户自选的装饰偏好）、"saas 版"（aurora **不是另一个产品层级或价位**）

## Commercial language

（口径 = 合伙人 2026-07-02 revenue deck，经 2026-07-03 对齐讨论确认。取代旧口径"advisor AI + tools 免费，playbooks 付费"——**无免费层**，最低入场门槛就是付费 Pilot。价格数字不进本文件。）

**Commercial thesis（商业主线）**：
**服务开路换信任，订阅是生意本身**——service-heavy 起步（Pilot → Setup → Consulting），可重复工作流成熟后收入重心迁向 Manager seats + Benchmark data。卖的是"更安全的管理决策"，不是 generic AI chat。
_Avoid_: 非订阅制 / 买断 / 一次性收费为主（旧 to-C 误读——一次性只在单客户第一年现金流里占大头，不是收入结构）

**Pilot / Proof Pack**：
**付费**入场动作——用买家真实数据跑一轮有限范围的证明服务，证明 Avery 能发现隐藏的人与项目风险。付费本身是筛选器：滤掉不认真的买家。
_Avoid_: free trial / 免费试用（无免费层）、demo（demo 是演示我们的数据，pilot 是收费跑买家的数据）

**Setup（company brain build）**：
一次性信任层服务——公司数据对接、私有部署、SSO / 权限边界、内部知识库配置（"脏活累活"）。是敲门砖与信任钱，不是生意本身：规模化后占比最小的一层。
_Avoid_: onboarding（太轻，像自助引导）、implementation fee（丢失"买的是安全边界与本地化"语义）

**Manager seat**：
经常性收入主体——manager 按月付费的访问权（Dashboard / 详情 / Nexus / follow-up），Playbooks 折在席位价内不单卖。计费单位是 **manager**，不是全员。
_Avoid_: license / user seat（付费单位是 manager）、工具费（席位贵在有 playbooks 背书的判断，不是贵在 UI）

**Benchmark layer**：
隐私安全的跨客户对比数据订阅——回答"你们公司这样，算正常吗"：按 workload / project risk / operating cadence 聚合 normalize。**数据护城河：客户越多越值钱；客户数不足时该层收入为零**，是"晚熟"层。三条不可破的边界（与"绝不评判个人"红线同源）：① 只聚合**组织级**运转模式，任何能定位到具体个人的东西永不进池；② 客户明确知情、可退出（opt-in/opt-out）；③ 同段样本不足时不出对比数（防反匿名化）。
_Avoid_: 行业报告（是持续订阅的对比层，不是一次性报告）、卖数据（买家听到的必须是"匿名对比智能"，且边界可自证）

**Consulting retainer**：
按月的人工服务——playbook 调优、决策校验、escalation 语言打磨、workflow 评估。信任变现的一层，规模化后让位给 seats。
_Avoid_: 客服 / support（卖的是专家判断，不是技术支持）

**Files hub（资料库）**：
用户**传给** Avery 的东西住的那一屏（surface label ZH「资料库」、EN "Files"，第 10 个屏、tab 排队尾，[ADR-0032](docs/adr/0032-files-hub-tab-and-vision-demotion.md)）。三段：当前这一批的文件清单 + 逐份下载、上传新一批（并诚实说明「再传一批 = 另建一份画像，不合并」）、你上传过的几批（多库切换）。它回答的是首访之后最先冒出来的三个问题：我传过什么 / 现在用的是哪一批 / 能不能拿回来。**v1 只管用户上传的文件**——「agent 自己的文件空间」那个愿景留在 Vision 页当预告，不进这一屏。删除 / 重传 / 替换后端端点还没有，所以 UI 上一个都不出现（不建假按钮）。文件这一族统一说「资料」：页名「资料库」、首页板块「资料概览」、屏内小节「当前资料」。
_Avoid_: 文档中心 / 知识库（暗示它是可检索的内容产品，它只是"你给我的原件"的落点）、文件管理器（暗示增删改齐全，v1 只能读和下载）、网盘 / 存储（卖点不是存，是"Avery 读了什么"）、与 **Paperwork** 混用（那是**你要填给我们的表单**，方向相反，见下条）

**Paperwork（文件与表单）**：
公司要**填给** Avery 的标准表单，加上围绕它的几份协议**样本**——两类东西同住一页（surface label ZH「文件与表单」、EN "Forms and agreements"）。表单侧回答首访者的「我到底该传什么给你」；样本侧是给谈合作的人看的物料。**它是资料，不是法律面**：可预览、可下载，不签署、不勾同意、不留痕（[ADR-0030](docs/adr/0030-paperwork-page-samples-not-a-signing-surface.md)）。
_Avoid_: 合同 / 协议中心（暗示这里能签、能生效——签署一律走线下盖章）、条款 / 法律声明（那是产品对用户的承诺面，这一页不是）、模板库（表单是唯一信息来源，不是可选模板集）

**Intake form（标准表单）**：
Paperwork 里公司填写的那 7 张表（组织与人员名册 / 项目台账 / 目标与指标 / 项目进度更新 / 风险与事项 / 周报与述职事实 / 评议与反馈）。填好之后从**普通上传口**进来，与任何其他材料同一条路径——它是**一种格式规范**，不是一条独立的导入通道。每张表在页面上都标注 Avery 现在吃到哪一层：有的直接长成人卡/项目卡，有的只进材料库供检索引用。
_Avoid_: 问卷 / 调查（那是 Ask 的语义，且暗示匿名收集）、导入向导 / import（没有独立通道，就是上传）、数据字典（它是给人填的，不是给工程师看的 schema）

**Drafter's note（起草者内部批注）**：
协议草案里夹着的、**写给我方自己人**的话（谈判提示、措辞风险提示），不是协议条款。产品里默认隐藏、开出来也必须带可见标签与条款隔开——它包含我方的谈判取舍，混进正文渲染等于哪天带客户看时把底牌念出来。
_Avoid_: 注释 / comment（听起来像可有可无的补充，它其实是不该外流的内容）、备注（同样弱化了"不属于正文"这层）
