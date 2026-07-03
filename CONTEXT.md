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
产品表面（面向使用者）默认仍像一个见过世面、站在你这边的资深同事说话——温暖、平实、指向善意的下一步。**红线（任何表面、永远有效，[ADR-0018](docs/adr/0018-renqingwei-demoted-to-redline-product-truth-decision-layer.md)）**：① 永不量化/评判/标签化任何一个人（无分数、无等级、无血条、无人格断言）；② 文案不得让被讨论的那个人觉得被处理。旧测试"像 AI 在自夸效率吗 / 温暖前辈会这样说吗"降为产品表面的风格建议，不再否决。护栏不变：**保留"它说得出依据"**（reasoning/evidence 改人话不删）。**数字政策**：mock/预估数字可上展示面（代码注释标注性质；结果形态数字加页面微标注"设计目标值"）；伪造实测口径（eval 分数、用户数据）仍禁。
_Avoid_: 给人打分/量化成数值（人不该有血条）；没有真人评分就上 eval scorecard

**Dashboard**：
ambient 空间式指挥中心 —— 把人、项目、信号画成一张平静的地图，呈现当前"组织天气"。它是**观察面**：你看，还没动手。
_Avoid_: home、canvas（canvas 是视觉手法，不是这个概念本身）

**Nexus**：
**行动面** —— manager 的一个问题在这里变成一条被编排的 Thread：specialist agents 与人类同事协同，agent 在背景聆听并交叉校对证据，按需调用 tools，最终产出供人 review 的结构化可信输出。
_Surface label_（[ADR-0015](docs/adr/0015-product-tone-human-advisor-debrand-saas-naming.md)）：user-facing 不出现 "Nexus" / "orchestration"（纯技术腔）；动作语境用 **"Working it through"**（自解释），需要名词指代该空间时才用 **"the room"**。"Nexus" 仅作内部领域概念名保留。
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

**Briefing**：
Dashboard 上呈现的一段**离散、可重新生成**的高管摘要（"组织天气"）。可以不止一条，manager 可以再取一条。
_Avoid_: summary、report（report 专指 Nexus 的结构化输出）

**Calm**：
Dashboard 的**静息态**——人与项目以最简密度铺成一张平静地图，无高亮、无展开。观察面的默认状态；点空白处即回到 calm。
_Avoid_: idle、empty（calm 是"一切尽在掌握"的平静，不是空）

**Focus**：
calm 的反面——**一组关联实体被点亮、其余淡化**的状态。由三种选择器触发：点单个节点、选 tag、搜索。关键：**单点也点亮"该实体 + 它的关联簇"**（owner / 依赖 / 被分配的人），不是只亮被点那一个。是从"观察"过渡到"将要钻入"的中间态。
_Avoid_: select、filter（filter 暗示"减项"，focus 是"点亮关联簇"）、highlight（只说了视觉、没说关联语义）

**Reality gap**：
"被相信的状态"与"实时信号"之间被检测出的矛盾（例：owner 报 on-track，但信号显示 PR 卡住、重复 blocker、任务零更新）。系统只**指出矛盾并给低风险下一步**，绝不做人身/人格评价。其中"自报 vs 信号"这一具体子类叫 **report mismatch**。
_Surface label_（[ADR-0015](docs/adr/0015-product-tone-human-advisor-debrand-saas-naming.md)）：user-facing 不用 "Reality gap" / "report mismatch"（像数据校验错误、点名时刺痛），改 **"Worth a closer look"**；底层领域概念名不变。
_Avoid_: discrepancy、conflict

**Manifest**：
一次 Nexus 编排中 agent 经思考/工作链**创造出的一切可见产物的集合**——report、图表、human chat、决策记录等。强调"显形"：过程在链上发生，产物在 Manifest 中可见、可回看、可累积。
_Avoid_: output（output 窄指结构化报告这一种产物）、artifacts（泛指、丢失"经链条显形"的语义）

**Handoff**：
agent 产出的、落在 Dashboard / 详情页表面上**可直接执行**的单条行动（checklist 形式，可 done / discard，部分可一键飞回 Nexus 深挖）。是"建议"与"已确认派出的 Task"之间的中间态：人确认后才经 dispatchTask 变成 Task。
_Avoid_: action item、todo（会跟已派出的 Task 混淆）

**Capabilities**：
Avery 自有的垂直领域专家知识层——跨 HR / Legal / PM / Finance / Ops / Sales 的真实案例、解决方案、SOP / playbook。可信性的"第二条腿"：公司事实回答"发生了什么"，Capabilities 回答"专业上该怎么判断、怎么处理"。是 agent 建议区别于普通 ChatGPT（只有泛化常识）的关键。**Avery 私有资产，订阅制提供，agent 检索时自动优先引用——产品的护城河。**
_Surface label_（[ADR-0015](docs/adr/0015-product-tone-human-advisor-debrand-saas-naming.md)）：user-facing 一律用 **"Playbooks"**（资深前辈的词，温暖、有经验感）；"Capabilities" 仅作内部领域概念名 / type / 变量名保留，不进用户界面（含"the moat"等护城河自夸不进界面）。
_Avoid_: CAPA（撞行业既有术语 Corrective-And-Preventive-Action，会让听众卡顿解码）、capabilities RAG（RAG 是检索机制，不是这个知识层本身）、专家能力库
