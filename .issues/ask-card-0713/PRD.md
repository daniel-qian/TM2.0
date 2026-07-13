---
status: in-progress (feat-034; 前端双面施工中, 后端阶段 deferred)
feature: ask-card / feat-034 (Ask / Quick ask / 快问 — 员工自述式快问卡 + 分享链接回执闭环)
date: 2026-07-13
blocked-by: 仅后端阶段 — 等 lite-v1 持久化链(feat/030 已 DONE 未合 main)合 main 后骑上;期间不碰 eval-harness/**(避让持久化线,见其 07-13 广播)
source: 融资团队点名功能; grill 会话 2026-07-13 十二决策全拍板 + Danny 同日指令"story+lite 双面上"
adr: docs/adr/0023-ask-employee-selfreport-redline-boundaries.md
tracker-note: 项目原生 tracker = 本地 .issues/;未建 GitHub issue(对外闸留 Danny)。feature 号避撞:持久化线已用 feat/030-033,本线=feat-034。
---

# PRD — Ask 卡：agent 生成快问，链接分享到 IM，员工点按回传

## Problem Statement

Manager 问 Avery"A 能不能负责跟乙方谈价"这类问题时，靠已有信号和文档常常推不出——**最缺的证据在员工本人嘴里**。今天 Avery 只能给出带不确定性的判断，没有任何把问题递到员工手边的通道。融资团队点名要这个能力：Avery 生成一个可分享到企微/钉钉/飞书/Slack/Teams 的快问链接，员工 10 秒点按作答（1~5 / 是·否），回执回到 Avery 成为证据。

## Solution（一句话）

**Ask**：Thread 内 agent 发起、manager 确认后出门的轻量快问——一人一链、免登录 H5 大按钮页、回执作为情境证据回到同一条 Thread。问"事"不问"人"，红线边界见 ADR-0023。

## 拍板决策记录（grill 2026-07-13，Danny 逐条确认，不 re-litigate）

| # | 决策 | 拍板 |
|---|---|---|
| Q1 | 建在哪 | **live 面真功能，独立 feature line**；硬依赖 lite-v1 持久化（链接必须扛住"员工第二天点开"+重启）。不碰 story（冻结）。 |
| Q2 | 红线边界 | **问事不问人 / 回执是情境证据永不进人卡 / 永不跨人比分**（单人=原话+数字标"本人自述"；多人=定性汇总）。详见 ADR-0023。 |
| Q3 | 出生地 | **Nexus Thread 内，agent 发起、manager 确认分享**（分享=天然人闸）。不做 Dashboard 独立"发问卷"入口（那是 SurveyMonkey）。不做 agent 直发（对外无人闸）。 |
| Q4 | 链接颗粒度 | **一人一链**：从花名册选定受访者（1~N），每人一条不可猜 token 链接，答案天然归属到人。不做公共链接（冒答+花名册泄漏面）。不做匿名（另一种产品；基础隔离档兜不住匿名承诺）。 |
| Q5 | 问卷形态 | **1~3 题封顶；题型仅 1~5 刻度 + 是/否；外加一条选填短评**（"想补充一句？"——最值钱的往往是那句"但需要报价权限"）。**题目 manager 可编辑，保存时过服务端红线门**，违规拒存。 |
| Q6 | 答题页住哪 | **FastAPI 后端直接服务（ECS，国内节点）**，URL 形如 `https://{域名}/r/{token}`。理由：国内可达性（Vercel 不可靠）；每链接独立 OG meta 需服务端渲染；员工永不进 manager SPA（actor 天然隔离）。 |
| Q7 | 回执回流 | 问卷卡显示回收状态（"2/3 已回"），**manager 打开 Thread 时 HTTP 拉取刷新**；回执织进 Thread 作证据，可 Follow-up"基于回执再判断"。不做推送通知/SSE 实时刷（v1）。 |
| Q8 | 生命周期 | **7 天过期；答完即锁定**（证据要稳定，防被要求改口）；manager 可撤回作废；过期/已答/已撤回各有状态页文案。催答提醒 v1 不做。 |
| Q9 | 平台优先级 | 验收顺序（2026-07-13 补正，Danny 告知备案域名+ECS 已在手）：**企微+飞书+钉钉同档 first**（备案域名消除企微"谨慎访问"最大诱因，国内 prospect 企微占比最大）→ Slack/Teams 验 OG 卡。同一条链接全平台通用，只是测试排序。原"飞书钉钉先行、企微降级"基于无备案假设，作废。 |
| Q10 | 命名 | 领域名 **Ask**；surface EN **"Quick ask"** / ZH **"快问"**。avoid: survey/问卷、poll/投票、打分。CONTEXT.md 已收录。 |
| Q11 | 域名 | **v1 用 `avery.ima-read.com` 子域**（零等待零花钱；答题链接 = `avery.ima-read.com/r/{token}`）。Avery 专属新域名后置。 |
| Q13 | 双面 scope（2026-07-13 Danny 指令，修订 Q1 的"不碰 story"半句） | **story 面也上**：一个 scripted Ask beat（agent 提议快问 → 卡片 → 回执归来），纯剧本、无真链接。**加性解冻**：只新增 beat/卡，既有 beats/rail/资产一律不动，story 冻结纪律对其余照旧；墙照旧（story/lite 各自实现，共用只走 shared 原子）。scripted 内容同样受 ADR-0023 约束（mock 人也不吃分数）。 |
| Q12 | ECS 资源 | **升配（A）但按需触发，现在不花钱**：先以硬内存帽（docker --memory）+ 低并发 + 上传硬门挤进 available ~540M；**部署时必装"内存哨兵"**——OOMKilled/重启计数/内存高水位被侦测到就主动冒泡给 Danny"该升配了"信号（进错误追捕/健康报告，不做完整监控栈）；真机压测把大上传内存峰值写进 evidence，给升配决策供数。 |

## 平台兼容性调研结论（2026-07-13，全文见 platform-compat-research.md）

- **零安装天花板（全平台一致）**：贴链接 → 有 OG 能力的平台出卡片 → 点开外部 H5 → 大按钮点按 → POST 回传。**五平台 webview 均不阻断外部表单提交**；token-in-URL 免登录是唯一正解（webview 无共享登录态）。
- **飞书**：唯一主动抓 OG 的国内平台（贴链接白赚卡片）；无域名拦截。v2 升级路径最便宜（自建应用→聊天内按钮回传）。
- **钉钉**：裸链接无卡片，但无备案检查、无拦截，可靠。v2 走企业内部应用+Stream 长连接（零公网要求）。
- **企业微信**：短板。无 OG；未备案域名大概率吃"谨慎访问"中间页，被举报即全拦；H5 免登被"可信域名须备案且主体与客户企业关联"堵死（第三方 SaaS 事实性走不通）。v1 接受"链接+中间页+H5"降级。
- **Slack**：OG 卡片好（tags 须在 HTML 前 32KB，og:image 1200×630）；不剥 query 参数。v2 应用自装门槛低（默认成员可自装），装后 `link_shared` unfurl 可带真按钮。
- **Teams**：OG 卡片可（加 schema.org JSON-LD 更富）；不剥 query 参数。v2 门槛高（Azure bot+商店/管理员上传），排 Slack 之后。
- **Vercel 域名现实**：`*.vercel.app` 国内间歇性被墙，**不合格**；要稳=自有域名+ICP 备案（2~4 周）+国内节点。答题页因此落 ECS 后端域名（Q6）。

## Implementation Direction（施工期可细调，方向不改）

- **数据模型（骑在 lite-v1 Supabase 层上）**：`ask`（id、company_context_id、thread 关联、题组 JSON、状态、created_at/expires_at）+ `ask_recipient`（ask_id、受访者名/roster 关联、不可猜 token、answered_at、answers JSON、comment 文本）。**status 词表锁定（2026-07-13 合流收线，对抗验证 F1）**：`draft | shared | collecting | closed | revoked | expired`——前端已实现前四态（feat/034-lite-ask），`revoked`/`expired` 后端接线时补；前端 coerce 遇未知状态必须 fail-loud 或折 `closed`，**绝不折回 `draft`**（否则已发出/已撤回的 ask 会以可编辑草稿复活）。token 与 lite-v1 的 company token 同规格（不可猜、读路径校验、未知 token 大声 404）。
- **后端端点（FastAPI）**：创建 ask（服务端 M3 生成题目→红线门）·保存/编辑题目（红线门）·生成受访者链接·`GET /r/{token}`（服务端渲染 H5：per-link OG meta + 大按钮 + 透明三要素"谁在问/问什么/给谁看"）·`POST /r/{token}/answer`（单次、答完锁定）·ask 状态读取（manager 卡）·撤回。
- **前端（src/lite）**：Ask 卡 = lite 第二种 artifact 卡（与 LiteAdvice 并列，新数据形状+组件）；Thread 内出生：agent 判断"该问本人"时在 manifest 里产出草稿卡 → manager 编辑/确认 → 逐人复制链接分享（v1 手动复制粘贴到 IM，即"分享=人闸"）。墙照旧：不 import story，共用走 shared。
- **红线机器闸（ADR-0023 后果落地）**：问句门（生成+手改均 validate，EN+ZH）；回执结构隔离（类型层不给 PersonEntity/LitePerson 挂数字）；多人视图 DOM 断言无每人一行分数表；员工页透明三要素 DOM 断言。
- **答题页 i18n**：ZH 默认（受访者主场景），lang 参数切 EN；中文文案走 M3。
- **LLM 永不进前端**（ADR-0020）：题目生成、红线校验全在服务端。

## Testing Decisions

主接缝 = HTTP 面 + 员工 H5 面，agent 当第一个用户（集成层证据，硬约束）：

- **端到端闭环**：thread 内创建 ask → 生成一人一链 → 全新无 cookie 会话 GET `/r/{token}`（断言 OG meta per-link + 透明三要素）→ POST 答案 → manager 卡显示"1/1 已回" → Follow-up advise 引用回执原话。
- **红线（独立对抗验证，真机 crafted 输入，别信自评——feat/029 教训）**：诱导 agent 生成"评价这个人能力"式问句 → 门拦下/改写；manager 手改成违规问句 → 拒存；回执数字构造进 Avery 转述 → 转述过门、人卡零数字。
- **结构断言**：回执后 PersonEntity/人卡 DOM 零新增数字；多人同题视图无跨人分数表。
- **生命周期行为**：重复作答 → 已答页；过期 token → 过期页；撤回 → 作废页；未知 token → 大声 404（不回落）。
- **持久化**：ask+回执跨 registry 重建（模拟重启）仍在；B 公司 token 读 A 的 ask → 拒绝。
- **离线套件**：内存实现全绿不依赖真 DB；真 DB 走 `@needs_db` 标记（沿用 lite-v1 契约测试规格）。

## Out of Scope（v1）

- 聊天内原生按钮卡片（Slack 应用 / 钉钉 Stream 互动卡片 / 飞书自建应用回传）——v2 逐平台解锁，顺序 飞书→Slack→钉钉→Teams→企微服务商。
- 匿名收集 / 脉搏调查形态；跨人分数对比（永久 out，红线）。
- 催答提醒、推送通知、SSE 实时刷新；答案修改；多选/矩阵题型。
- Dashboard 独立"发问卷"入口；story mode 任何改动；IM 平台 API 直发消息（v1 分享=manager 手动粘贴）。
- 完整受访者身份体系（v1 = token 即身份）。

## 基建现状（2026-07-13 Danny 告知 + 实机 SSH 只读核对；单一事实源=D:\Boyle\agent-os\infra-brief.md，项目外）

- **ICP 备案已有（主体=imaread 公司）、域名已有（ima-read.com 等，注册+解析都在阿里云云解析）、ECS 可 SSH**（agent 可自行部署——deploy 属先斩后奏范围）。原"启动备案 2~4 周关键路径"作废；企微风险降为低。
- **ECS = 唯一生产机**（120.55.97.151，杭州，2C/3.5G/79G，宝塔+nginx 1.24 全站 HTTPS）,已跑 ImaRead 全线。**⚠ 内存紧：实测 available ~540M、无 swap**——Avery 后端容器上去前必须解决资源问题（见"待 Danny"Q12），且无论如何要带硬内存帽（docker --memory）+ 低并发 + 上传硬门，防 OOM 波及 ImaRead 生产。
- 部署期动作清单（开工时执行，现在不动服务器）：阿里云加 A 记录（子域→120.55.97.151）→ 宝塔 vhost + Let's Encrypt 证书 → Avery 容器（内存帽）→ nginx 反代。
- v2 企微可信域名对第三方 SaaS 的"主体须关联客户企业"要求不因我方备案而解——该结论不变。

## 待 Danny（凭据墙/对外闸/花钱闸，不阻塞设计与离线开发）

- Supabase 项目 + 连接串；真 LLM key 进服务器 secret（与 lite-v1 共用，见 runbook §F）。
- push 授权（本分支 + main ahead 照旧未 push）。
- ~~Q11/Q12~~ 已拍（2026-07-13，见决策表补行）。

## 指针

- ADR：`docs/adr/0023-ask-employee-selfreport-redline-boundaries.md`
- 术语：`CONTEXT.md` **Ask** 条目
- 调研全文：`.issues/ask-card-0713/platform-compat-research.md`
- 依赖：`.issues/lite-v1-lean-real-0713/PRD.md`（持久化 §3.3 步骤 1-2 先行）
