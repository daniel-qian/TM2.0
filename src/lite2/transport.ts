// feat-017：live 源的可注入传输层 —— 把"怎么打后端"从"seam 逻辑"里剥出来，
// 让 AFK 门能把 live 源打桩成 DETERMINISTIC 响应（不依赖真起 Python 服务 / 真 LLM）。
//
// 两个后端契约（都在 eval-harness，本前端只经 HTTP/SSE 调，绝不 import Python、绝不上 LLM key）：
//   * feat-015 agent service：POST /advise（SSE：started/think/tool/observe/nudge/manifest/error）。
//   * feat-016 ingestion：上传 → ingest → { context_id }；再拉 Your team 结构（人卡/项目卡/briefing/signals）。
//     注意：feat-016 目前是 Python 包（registry.py 已产出这些 dict 形状），其 HTTP 端点由部署端
//     （feat-018）薄包 ingest_paths + registry 暴露。本传输层按该文档化契约打，端点未起时
//     AFK 门用 stub transport 全程走通 seam。
//
// LLM key 绝不触碰前端（ADR-0020 决策 4）：live mode 一律走 HTTP 到 feat-015 服务。

import { currentAccessToken } from './auth/authStore'

// feat-068 · ZH-03：非 hook 的 i18n 取词路径（useDict 内部用的就是这两个纯函数）。
// 🔴 只 import index.ts，绝不 import useDict.ts——那个才带 React，本模块必须保持零 React。
import { activeLocale, getDict, type Locale } from '../shared/i18n'

// ── SSE 事件（feat-015 /advise 契约，见 service/engine.py::stream_advice）───────────────
export type LiveAgentEventType =
  | 'started'
  | 'think'
  | 'tool'
  | 'observe'
  | 'nudge'
  | 'manifest'
  | 'error'

export interface LiveAgentEvent {
  type: LiveAgentEventType
  // started
  agent?: string
  scaffold?: string
  case_id?: string
  prompt?: string
  // think
  text?: string
  // tool / observe
  name?: string
  input?: Record<string, unknown>
  observation?: string
  is_error?: boolean
  // nudge
  gate?: 'chain' | 'redline'
  message?: string
  // manifest：可选判别字段 kind（feat-034 契约提案，additive）：
  //   缺省 / 'advice'  → advice = 契约 payload（现有消费者零破坏）
  //   'ask-draft'      → ask = AskDraft 形状（agent 起草的 Quick ask，等 manager 确认）
  kind?: 'advice' | 'ask-draft'
  advice?: unknown
  ask?: unknown
  // 0729/03 分流短答（additive）：answer_kind='answer' 时 advice=null、answer={text}——
  // 事实查询的一段话直答；'advice'/缺省 = 判读卡路径，旧消费者零破坏。
  answer_kind?: 'advice' | 'answer'
  answer?: unknown
  contract_ok?: boolean
  redline_passed?: boolean
  schema_ok?: boolean
  // error
  error?: string
  // 允许后端附带额外字段而不破类型
  [key: string]: unknown
}

// #64 · @ 引用（additive）：被 @ 的实体随请求结构化下发，后端**保证**把它的卡片读数与
// 相关文档行注入模型上下文（不看 recall 脸色）。老后端不认识这个键 → FastAPI 静默忽略——
// 所以提交层必须同时把引用织进 situation 文字兜底（askRefs.weaveRefs），任何后端版本下
// 答案不至于比今天差。id 语义按 kind：person/project=实体 id；file=文件名；playbook=标题。
export type AdviseReferenceKind = 'person' | 'project' | 'file' | 'playbook'

export interface AdviseReference {
  kind: AdviseReferenceKind
  id: string
  label: string
}

// #71 · 会话流的一轮历史（前几轮的问题 + 终局产物摘要）。轻量到只有两段文字：
// 前端不把整份判读卡塞回去（那是几 KB 的结构体），后端也只需要"上一轮问了什么、答出了
// 什么"这一句就够接住追问。配额（轮数/字数）在 askHistory.ts，后端 service/history.py
// 有一份权威的同款闸——两处都要改。
export interface AdviseHistoryTurn {
  question: string
  answer: string
}

export interface AdviseRequest {
  situation: string
  title?: string
  company_context_id?: string
  // ADR-0033：判读正文的语言。调用方**不用填**——`streamAdvise` 自己从界面那条 locale 链补上
  // （见下面 withLocale 的注释）。留在契约里是因为它确实是请求的一部分，后端按它写 prompt。
  locale?: Locale
  // #64 · 可选（additive）：没有引用时**整键不发**（absent≠none——空数组和「没带」在
  // 后端是同一回事，但请求体里不多送一个键）。
  references?: AdviseReference[]
  // #71 · 可选（additive，同 references 的纪律）：本场会话前几轮。第一问不带这个键；
  // 旧前端一个字节都不改也照常工作（后端 default None）。**不落库、不持久化**——它只
  // 活在这次请求里。
  history?: AdviseHistoryTurn[]
  // #78 · 可选（additive，同上）：这一问接在哪一场后面。缺键 = 开新的一场。
  // 🔴 与 `history` 分工明确，别混：**thread_id 管归档**（落库时这一行挂在哪一场下），
  // **history 管推理**（这一问带多少上下文）。服务端不会因为收到 thread_id 就去库里补历史轮，
  // 两者同时出现不冲突。
  // 🔴 它没有 references 那种「织进 situation」的文字兜底——老后端忽略这个键时**没有任何
  // 信号**。对账通道是服务端在 started/manifest 帧回传 thread_id：没回传，store 的 threadId
  // 就停在 null，界面老老实实每问自成一场，不谎称在续场。
  thread_id?: string
}

// 🔴 一处补全，不要在每个调用点各写一遍。
// AdviseRequest 是从 RoomScreen / 决策卡「问问 Avery」/ v01 议事室等多个地方拼出来的；
// 让每个调用点自己记得带 locale，就是给"哪天有人新加一个入口忘了带"留位置——而那个 bug 的
// 症状是"英文界面偶尔回一段中文正文"，最难复现的那类。所以在传输层出口统一补。
//
// 语言取 activeLocale()：界面语言的当下真值（开关点过就是开关的选择，否则是 `?lang=` >
// localStorage > env > en 那条链）。**与 useDict 同源**——界面语言和判读语言不可能各说各的。
// 调用方显式传了就尊重它（测试/门可以指定），没传才补。
function withLocale(req: AdviseRequest): AdviseRequest & { locale: Locale } {
  return { ...req, locale: req.locale ?? activeLocale() }
}

// ── ingestion 契约（feat-016 registry.py 的 dict 形状，经 feat-018 HTTP 暴露）──────────────
// 严格对齐 CompanyContext.team_cards()/project_cards()/briefing()/signal_cards()。
/**
 * T10 · 一次补传的回执。
 * `documents` 是**服务端最终采用的 source_key**，不一定等于用户选的文件名——同名文件补传第二次
 * 会拿到 `周报(1).md`（`<source_key>:<行号>` 是出处契约的一半，两份文档不许共用一个 key）。
 * `skipped` 是被判为重复而没落第二份的；`conflicts_added` 是这一趟新开的冲突条数。
 */
export interface LiveAppendReceipt {
  documents: string[]
  skipped: string[]
  parse_errors: string[]
  conflicts_added: number
}

export interface LiveTeamPayload {
  context_id: string
  source_files?: string[]
  people: LivePersonCard[]
  projects: LiveProjectCard[]
  briefing: LiveBriefingPayload
  signals?: LiveSignalCard[]
  // feat-056 决策定级。后端规则表算出，按严重度排好序 —— feat-057「今天要决策的」
  // 直接按数组顺序展示，不要在前端重排（排序口径属于后端，前端重排会和"凭什么这么排"
  // 的说明书对不上）。optional：老后端（pre-056）不发这个键。
  decisions?: LiveDecisionCard[]
  // feat-047（移植自 src/lite，持久化链 feat-038 租户隔离）：/ingest 首帧回传本公司的
  // 不可猜 owner_token（经理凭据）。客户端存下（按 context_id）、后续所有读端点
  // （team/files/notes/advise）以 HTTP header 带上。
  // 🔴 只走 header，绝不进 URL（URL 会进 Referer/access log/CDN log/浏览器历史）。
  // /team/{id} 刷新帧不回传此字段（那次调用本就已用 token 证过身）。
  owner_token?: string
  // feat-053：上传时已登录 → 后端当场把这份 context 绑到该账号，并在 /ingest 首帧回传结果。
  // 未登录上传时后端根本不发这个键（不是 false，是缺席）。/team/{id} 刷新帧同样没有。
  // UI 据此判断"这份数据到底归没归到账号名下"，别对着已绑好的数据说"还没绑"。
  account_linked?: boolean
  // input-side-0721 · 3A：POST /demo/claim 的首帧自报"这是示例团队的克隆副本"。
  // /team/{id} 刷新帧不发（demo 身份只在领取那一刻有叙事意义；副本此后就是一份普通工作区）。
  demo?: boolean
  // T10 · 这份工作区是**一次性**的吗（示例克隆，会被 TTL 回收）。缺席即 false（additive-key，
  // 仿 account_linked / scoring_enabled）。
  // 🔴 与上面的 `demo` 是两件事，别混：`demo` 只在领取那一帧出现，刷新一次就没了；`ephemeral`
  // **每次 `GET /team/{id}` 都在**（服务端读的是 GC 用的同一个标记）。"补资料"入口按它藏起来，
  // 判据必须禁得住刷新页面——往一份马上会被回收的克隆里补文件，经理会以为资料存下来了。
  ephemeral?: boolean
  // T10 · `POST /team/{id}/files` 的首帧附带："这一趟到底加了什么"。仅补传回执有，
  // /ingest 与 /team/{id} 都不发。
  appended?: LiveAppendReceipt
  // rich-align-0722 · issue 03：人身自述投影开关（后端 AVERY_ALLOW_PERSON_SCORING）。
  // present-and-true ONLY when 开关开（仿 account_linked 缺席即 false 语义）。true 时后端才会在人卡上
  // 投影 self_report；缺席/false 时人卡零自述数字。前端运行时剥离据此决定放不放行 self_report 白名单。
  scoring_enabled?: boolean
  // rich-align-0722 · issue 05a：软删（归档）的项目卡，投给网格下方折叠区（灰化 + 恢复键）。
  // 🔴 缺席 = 没有归档项目（absent≠none：后端 archived_project_cards 为空时整键不发，仿
  // decisions/scoring_enabled 的 additive-key 语义）。前端 `?? []` 收敛，绝不把缺席当成异常。
  archived_projects?: LiveProjectCard[]
  // rich-align-0722 · issue 06：停用（软删）的成员卡，投给团队目录页尾折叠区（灰化 + 恢复文字键）。
  // 同 archived_projects 的 absent≠none 语义（空即缺席）。
  archived_people?: LivePersonCard[]
  // rich-align-0722 · issue 08：SOP 方法卡（只读方法库，无 CRUD）。后端从文档 `## 方法：` 小节抽取。
  // 🔴 缺席 = 没有 SOP 方法（absent≠none：playbook_cards() 为空时整键不发）。前端 playbooks 屏
  // `?? []` 收敛——缺席维持 coming-soon 诚实空态，绝不为凑网格造空卡墙（踩 absent≠none）。
  playbooks?: LivePlaybookCard[]
}

// input-side-0721 · 3A：GET /demo/status 的能力探测契约（无鉴权、无副作用）。
// available=false ⇒ 这台后端没配示例团队 —— 前端**不出那扇门**（4A 拍板的"不出假按钮"纪律）。
export interface DemoStatusPayload {
  available: boolean
  ready: boolean
}

// rich-align-0722 · issue 03：人员自述读数（负载/情绪）。人身数字红线 07-21 解禁 + 07-22 拍板后的
// 唯一合法人身数字面——且**只能是本人自述**，caliber(口径)+source(出处) 必带。这不是"血条"（不是系统
// 对人打的分），是把文档里本人自己报的负载/情绪原样转呈，渲染层凭 source 说「《X》记录的本人自述」。
export interface LiveSelfReportLoad {
  value: number // 0..100，本人自述负载
  caliber: string // 恒『本人自述』
  source: string // 出处 <文档名>:<行>
}
export interface LiveSelfReportMood {
  value: 'steady' | 'stretched' | 'strained' | 'other' // 情绪定性枚举；other=词表外
  caliber: string
  source: string
  valueRaw?: string // 仅 other 时发：文档原词，原样回显不改写
}
export interface LivePersonSelfReport {
  load?: LiveSelfReportLoad // 缺席=文档没报负载（absent≠none，前端不编 0）
  mood?: LiveSelfReportMood // 缺席=文档没报情绪
}

// 人卡：定性为主。🔴 红线：moodPct/capacityPct 等**系统打分式**血条字段 live 永不出现——
// 类型里根本不给这些键留位置（结构性护栏），teamData.stripPersonNumbers 再做一次运行时剥离兜底。
// self_report 是**唯一例外**且**只在开关开时**才由后端投影（见 scoring_enabled），运行时剥离据此放行。
export interface LivePersonCard {
  id: string
  // 🔴 `id` 是人卡的**内部键**（`u_周雅` 之类），`person_id` 才是花名册上那个工号
  // （01 表「人员ID」，T5 的 `PersonIndex` 拿它当身份尺）。两者绝不可互相冒充：
  // 拿内部键当工号送去铸链，会让 PersonIndex 规则 2 判成「两个恰好同名的人」而彻底不并卡。
  // 0807 HITL 起后端才投它（缺席=这家公司的资料里没有工号，不是 0 也不是空对象）。
  person_id?: string
  name: string
  role?: string
  team?: string
  tenure?: string
  owns?: string[]
  // team_cards() 发的是 list[str]（PersonEntity.collaboration）。feat-023 的 LLM 抽取第一次
  // 真的填了它，暴露此处曾误写 string（heuristic 从不产 collaboration，一直潜伏到 gate 抓到）。
  collaboration?: string[]
  // rich-align-0722/03：本人自述负载/情绪。**仅当 payload.scoring_enabled===true 时**后端才投影它；
  // 运行时剥离在开关关时会连它一并丢弃（双世界执法）。
  self_report?: LivePersonSelfReport
  // rich-align-0722/06：字段级出处 side-car（同项目卡）。key=定性字段名（name/role/team/tenure/owns/
  // collaboration），value=出处。缺席=纯文档抽取卡。🔴 self_report **不在** provenance 里（禁经手编通道）。
  // stripPersonNumbers 放行本键（是对象非裸数字、非血条键），两世界都留——出处角标与人身数字开关无关。
  provenance?: Record<string, LiveFieldProvenance>
  // #85 · 文档血缘 side-car。缺席=这张卡没有任何文档血缘（手编卡恒缺席）。
  // 🔴 人卡血缘里**结构上没有数字的位置**：后端 `_lineage_fields('person')` 只跟
  //    role/team/tenure/owns/collaboration，刻意不含 self_report（那一格自带出处）。
  //    stripPersonNumbers 只剥顶层裸数字、对象整键放行，所以护栏必须长在跟踪面那一侧——
  //    后端 `test_no_person_number_can_ride_in_on_the_lineage` 扫真 payload 的每个叶子钉着它。
  lineage?: LiveEntityLineage
}

// rich-align-0722 · issue 01：项目级风险（PRD A1）。这是**项目**属性（进度/范围/资源风险），
// 不是人身分数——`离职风险/流失风险` 仍在 person 禁键表里、只对人执法。缺席不发键（后端
// registry.project_cards 只在 pr.risk 时才发；reason 省略时连 reason 键都不发）。
export interface LiveProjectRisk {
  level: 'high' | 'medium' | 'low'
  reason?: string // 文档原句，原样回显；缺席=文档没给原因
}

// rich-align-0722 · issue 02：里程碑（PRD A1）。status 归一四态 + 词表外 other（statusRaw 回显原词）。
export interface LiveProjectMilestone {
  name: string
  status: 'done' | 'active' | 'blocked' | 'upcoming' | 'other'
  statusRaw?: string // 仅 other 时发：文档原状态词，原样回显不改写
}

// rich-align-0722 · issue 08：SOP 方法卡（PRD D）。文档 `## 方法：<标题>` 小节抽出的只读方法卡。
// description 取自「适用：」行、tags 取自「标签：」行（、分隔）；缺席的子字段整键不发（absent≠none）。
// 🔴 非交互（渲染成 article/div，不渲染 button）——将来加详情展开再升 button。
export interface LivePlaybookCard {
  title: string
  description?: string // 「适用：」行；缺席=文档没写适用范围
  tags?: string[] // 「标签：」行；缺席=文档没写标签
}

// rich-align-0722 · issue 05a：字段级出处（ADR-0028）。后端 side-car，缺就不发键（absent≠none）。
// origin='doc' = 文档抽取（source=<文件名>:<行>）；origin='manual' = 人手编（source 恒『手动编辑』）。
// 🔴 前端凭 origin==='manual' 才挂「手动编辑」角标——doc 出处或键缺席都不挂（不替文档冒充手编）。
// 差距战役 T5/A2 加了第三个取值 origin='form'：这一格最后一次是**一份员工表单提交**改的
// （source=那份周报文档）。它既不是「我们从公司资料里读到的」，也不是「经理手打的」——挂
// 「手动编辑」是假话，什么都不挂则是把员工本人这周说的话冒充成一份存量文档。所以它自己一个角标。
export interface LiveFieldProvenance {
  origin: 'doc' | 'manual' | 'form'
  source: string // 手编='手动编辑'；文档/表单=<filename>:<line>
  updated_at: string // ISO8601
}

// ── #87 建的文档血缘 side-car，#85 起投给浏览器（additive key，缺就不发）────────────────
// 🔴 与 `provenance` 是**两本账，答两个问题**，别混着用（extract.py 那一节的长注释是正源）：
//   · `provenance[f].origin` —— 这一格**现在归谁**（doc/manual/form，手编赢）。
//   · `lineage.fields[f]`    —— 这一格的**文档血缘**：哪份文档的哪一行给的、它顶掉了什么。
// 手编改一格**不动** lineage，所以经理接管过的格子上，lineage 说的是「上一次由文档说了算时
// 是谁说的」，不是屏幕上那个值的出处。#85 的流水正因如此要同时读两本（changeLog.ts 边界②）。
//
// ⚠ 契约是**开的**（后端 `dict(entity.lineage)` 原样投）：这里描述的是今天的形状，不是闭集。
// 新键出现时前端只会忽略它，不会崩——这与 `LiveFieldProvenance` 那个**闭**契约刻意相反。
export interface LiveLineageLink {
  value?: unknown // 被顶掉的那个读数（写入时就拍平成 JSON 原生形状）
  source?: string // 它当时的出处 <filename>:<line>
  prev?: LiveLineageLink // 再往前一次；链在后端封顶 8 环
  truncated?: boolean // 🔴 链在这里被砍过——「更早的旧值还在」不成立
  batch_id?: string
  seeded?: boolean
}

export interface LiveLineageField {
  source?: string // <filename>:<line>
  batch_id?: string // 这一格是哪一批补传写的；首次上传没有
  seeded?: boolean // 记录是**推**出来的（构造时按实体 source 播的），不是写路记下来的
  prev?: LiveLineageLink // 缺席 = 这一次没毁掉任何读数（enrichment）
}

export interface LiveEntityLineage {
  docs?: string[] // 提到过这张卡的文档（doc_key 粒度，不设上限）
  fields?: Record<string, LiveLineageField>
  added_in?: string // 这张卡是哪一批补传**新建**的；缺席=首次上传铸的/手编建的
}

export interface LiveProjectCard {
  id: string
  title: string
  ownerId?: string
  ownerName?: string
  status?: string
  progress?: number // 可量化（文档写了就抽）；reportedStatus 缺信号 → 不出现
  dueDate?: string
  summary?: string
  blockers?: string[]
  risk?: LiveProjectRisk // rich-align-0722/01：文档写了才有；absent≠none（缺席=文档未提及）
  milestones?: LiveProjectMilestone[] // rich-align-0722/02：文档写了才有；缺席=空/不发键
  // rich-align-0722/05a：字段级出处 side-car。key=字段名（title/ownerName/status/dueDate/summary/
  // progress/blockers/risk/milestones），value=出处。缺席=纯文档抽取的老卡（前端一律当 doc 出处，不挂角标）。
  provenance?: Record<string, LiveFieldProvenance>
  // #85 · 文档血缘 side-car（同人卡）。⚠ 它跟的格子比这张卡投出来的**多一个**：`dependsOn`
  // 在血缘里有、在卡上没有。changeLog.ts 的边界① 就是为它写的——卡上读不出现值的格子不进流水。
  lineage?: LiveEntityLineage
}

// ── rich-align-0722 · issue 05a：项目手编 CRUD 写端点契约（后端 f1ca46d，service/ingest_api.py）──
// 端点：POST /team/{ctx}/projects · PATCH …/{id} · POST …/{id}/archive · POST …/{id}/restore。
// 鉴权同读端点（owner_token header 或账号，缺/错→同体 404 无枚举）；title 校验失败→422。
// 🔴 归档=软删可逆，**无物理删除端点**（销毁类人工闸哲学延伸到产品语义）。
export interface ProjectRiskInput {
  level: string // 高/中/低 | high/medium/low（后端归一，词表外整块不抽）
  reason?: string
}
export interface ProjectMilestoneInput {
  name: string
  status?: string
}
// POST body：title 必填；其余可选（absent≠none：不传即不设，绝不折 0/默认）。
export interface ProjectAddInput {
  title: string
  ownerName?: string
  status?: string
  progress?: number | null
  dueDate?: string
  summary?: string
  blockers?: string[]
  risk?: ProjectRiskInput | null
  milestones?: ProjectMilestoneInput[]
}
// PATCH body：只发**要改的键**（后端 exclude_unset），显式 null=清空→渲染 absent。没发的键不动。
// 🔴 调用方只把真正改了的字段塞进来（含用户手动置空得到的 null），绝不整体回灌——那会把没碰过的
// 字段也盖成 manual 出处（后端 _mark_manual 只标发来的键）。
export type ProjectPatchInput = {
  title?: string | null
  ownerName?: string | null
  status?: string | null
  progress?: number | null
  dueDate?: string | null
  summary?: string | null
  blockers?: string[] | null
  risk?: ProjectRiskInput | null
  milestones?: ProjectMilestoneInput[] | null
}
// 四个写端点同形回执：{context_id, project:<更新后的卡（含 provenance）>}。
export interface ProjectWriteResult {
  context_id: string
  project: LiveProjectCard
}

// ── rich-align-0722 · issue 06：人员手编 CRUD 写端点契约（复用 05a 骨架；🔴 写侧红线 B3）──────────────
// 端点：POST /team/{ctx}/people · PATCH …/{id} · POST …/{id}/archive · POST …/{id}/restore。
// 🔴 只发**定性**字段——后端 PersonIn extra='forbid' 把 load/mood/self_report/score/负载/情绪…任何人身
// 数字键挡成 422（人身数字只能来自文档自述通道，经理手填=替人打分）。前端类型层也只留定性字段位。
export interface PersonAddInput {
  name: string
  role?: string
  team?: string
  tenure?: string
  owns?: string[]
  collaboration?: string[]
}
export type PersonPatchInput = {
  name?: string | null
  role?: string | null
  team?: string | null
  tenure?: string | null
  owns?: string[] | null
  collaboration?: string[] | null
}
export interface PersonWriteResult {
  context_id: string
  person: LivePersonCard
}

// feat-056 决策定级契约。口径真源在后端 `eval-harness/avery/decision_rules.py`，
// 人类可读说明在 `eval-harness/decision_grading_rules.md`（客户问"凭什么高风险"就给他看那份）。
// 🔴 等级只由后端规则决定；前端不得自行判级、不得改写 grade。
//
// 🔴 ADR-0033 一刀切（2026-08-03）：后端**不再发任何人话**，只发机器键 + 结构化字段。
// 删掉的字段：`grade_label` · `rule_grade_label` · 命中里的 `title`/`basis` ·
// `unparsed_fields[].field_label` · 规则版的 `reason` 句子。它们的句子现在由前端
// `src/shared/i18n/{en,zh}.ts` 的 `lite2.decisionGrades` / `lite2.decisionRules` 渲染，zh/en 各一份。
// 不做新旧并存——并存等于留着"后端仍在产出中文"的破口，那正是这次要铲掉的东西。
export type LiveDecisionGrade = 'high_risk' | 'needs_confirmation' | 'can_proceed'

export interface LiveDecisionRuleHit {
  rule_id: string // 如 'R-BLOCKER-STACK' —— 可引用编号；也是前端 i18n 查规则文案的键
  grade: LiveDecisionGrade
  severity: number // 3 / 2 / 1
  // 这条规则文案模板的占位符实参（如 { n: 2 } / { days: 7, pct: 60 }）。
  // 阈值归后端配置（Danny 调 DUE_SOON_DAYS 就该跟着变），句子归前端 i18n —— 别把这些数字
  // 抄进前端硬编码，那就是又开了一个会静默漂的事实源。没有占位符的规则发 `{}`。
  params: Record<string, number>
  // 原文证据，verbatim —— 原样展示，不要转述、**不要翻译**（ADR-0033 决定 4：翻译＝编）。
  // 里面只有两种东西，都与界面语言无关：① 文档原句 ② 字段读数（`status="blocked"`）。
  evidence: string[]
}

// 文档写了、但后端解析不出一个可比较的值的字段。raw 是**文档原文**，原样展示。
export interface LiveDecisionUnparsedField {
  field: string // 'dueDate' 等机器键 —— 人话字段名由前端 i18n 出
  raw: string // 文档里原本写的那几个字，如「月底前」。永远原样，不翻译。
}

export interface LiveDecisionCard {
  subject_type: 'project' // 当前只有项目型；留着以便后续扩人/任务
  subject_id: string
  subject_title: string
  owner_name: string
  grade: LiveDecisionGrade // 最终等级（= rule_grade，除非 Avery 合法上调）
  severity: number // 排序键：3 高风险 / 2 需确认 / 1 可推进
  rule_grade: LiveDecisionGrade // 规则原判，永远保留，可对账
  rule_severity: number
  matched_rules: LiveDecisionRuleHit[] // 永不为空 —— 每条决策都能展开看到命中了哪条规则
  // 🔴 文档**确实没写**的字段（'status' | 'progress' | 'dueDate'）。界面必须显示「文档未提及」，
  // 绝不能渲染成 0% 或空白 —— "文档没说"不等于"没风险"。
  unknown_fields: string[]
  // 🔴 文档**写了、但后端读不准**的字段，与 unknown_fields 互斥（一个字段只会出现在其中一个里）。
  // 界面必须把原文摆出来，例如「到期日写的是『月底前』，无法确定具体日期」——
  // 绝不能把这些说成「文档未提及」：客户手上就有原件，说他没写等于当场自证不可信。
  unparsed_fields: LiveDecisionUnparsedField[]
  // 🔴 ADR-0033：`reason_source === 'rule'` 时这里是**空串**——规则版的那句话由前端
  // `composeRuleReason()` 用 i18n 模板从 grade + matched_rules + unknown/unparsed_fields 拼出来。
  // 只有 Avery 真写了人话时才非空（此时它的语言由请求 locale 决定，进了 prompt）。
  reason: string
  reason_source: 'rule' | 'avery' // rule = 结构化事实，句子在前端；avery = 模型写的
  escalated: boolean // Avery 是否上调了等级
  escalation_reason: string // 上调必须写明为什么；未上调时为空串
  downgrade_blocked: boolean // Avery 试图下调、被硬拦（下调永不生效）
  rejected_grade: string // 被拦下的那档（仅 downgrade_blocked 时非空）
  review_rejected: string // '' | 'missing_reason' | 'downgrade' | 'unknown_grade'
}

export interface LiveBriefingPayload {
  tone: 'calm' | 'alert'
  headline: string
  subhead: string
  metrics: { label: string; value: string }[]
}

export interface LiveSignalCard {
  id: string
  // 🔴 命名陷阱：这个 `source` 是 `source_kind`（'doc' / 'figma' / 'feedback' 这类**类型词**），
  // 不是文档指针。要把一条信号连回它那份资料，读的是下面的 `sourceRef`。
  source?: string
  subjectType: 'person' | 'project' | 'task'
  subjectId: string
  summary: string
  tag?: string
  // 差距战役 T5/A2：`'<文件名>:<行>'`，与决策那一路的 `sourceRef` 同一个键名。缺席=这条信号
  // 没有出处（手加的、老 context），前端据此不引，而不是引一个空串。
  sourceRef?: string
}

// ── Ask / Quick ask 契约（feat-034 阶段 B；后端契约提案，阶段 C 落 FastAPI）──────────────
// 端点（全部新增，additive）：POST /ask（保存，服务端 redline.validate）· POST /ask/{id}/share
// （一人一链）· GET /ask/{id}（状态/回执，manager 侧）。/ask/{id}/revoke 与员工侧
// GET|POST /r/{token} 属后端阶段，前端不打。
// 🔴 ADR-0023 结构护栏：回执只挂在 AskDraft.recipients[].receipt 上——LivePersonCard /
// LitePerson 一个字段都不加；类型层就没有可把答案挂到"人"身上的槽位。

export type AskQuestionKind = 'scale' | 'yesno' // 1~5 刻度 · 是/否（PRD Q5：仅这两种）
// status 词表锁定（阶段 C 对接契约，服务端为真源）：draft|shared|collecting|closed|revoked|expired。
// feat-047 打回复验补齐（lite2 拷贝分叉于阶段 C 之前，带的是旧四词表——真后端发 revoked/expired
// 时前端会把已撤回/已过期的 ask 复活成可编辑草稿，违反 ADR-0023 + 阶段 C F1 明文）。
// F1：coerce 遇未知词折 closed（绝不折 draft——已发出/已撤回的 ask 不得以可编辑草稿复活）。
export type AskStatus = 'draft' | 'shared' | 'collecting' | 'closed' | 'revoked' | 'expired'

export interface AskQuestion {
  id: string
  kind: AskQuestionKind
  text: string // 问"事"不问"人"——保存时过服务端红线门（阶段 C）
}

// 单个受访者的回执：员工本人的自述（数值/是否 + 可选原话短评）。
// 是情境证据，不是人的属性——永不写进人卡（ADR-0023 边界 2）。
export interface AskReceipt {
  answers: { question_id: string; value: number | boolean }[]
  comment?: string // 员工原话短评，原样呈现，不转述
  answered_at: string // ISO 8601
}

export interface AskRecipient {
  id: string
  name: string // 当前 team 花名册的具名人（PRD Q4：一人一链，答案天然归属到人）
  token?: string // share 后由服务端发（不可猜）；前端永不自造
  link?: string // https://avery.dannyqian.com/r/{token}（服务端拼好整链，域名归属后端）
  receipt?: AskReceipt
}

export interface AskDraft {
  id: string
  status: AskStatus
  questions: AskQuestion[] // 1..3（PRD Q5）
  recipients: AskRecipient[]
  comment_prompt?: string // 选填短评的提示语（"想补充一句？"）
  company_context_id?: string
  created_at?: string
  expires_at?: string // 7 天过期（PRD Q8）——由服务端计算
  // 多人同题的定性汇总（ADR-0023 边界 3：不做每人一行的分数表）。由服务端生成并过
  // 同一红线门（阶段 C）；回执到齐前缺省。
  receipts_summary?: string
}

// ── file space（feat-047 移植自 src/lite/transport.ts feat-032：GET /team/{id}/files 清单契约）──
// 每公司「你的文件」薄清单：回看上传过哪些材料、Avery 的记忆基于什么。
// 纯元数据（不含字节）；n_chunks = 该文件贡献的 material chunk 数（经 materials.source 前缀链接）。
// 🔴 文件内容是不可信数据——此处只列/只显，绝不作指令跟随。
// 对抗复审 fixB1（找回 07-19 fixB 的修复——合流时被一次"整份取 ours"的冲突解决悄悄丢掉，见
// git show 6f838f3/a45bb4a）：后端每份文件都带 `status`，前端类型里此前没有这个键，界面也就
// 永远不显示它。后果不是少一个徽章——是**读进去了和没读进去长得一模一样**：一份扫描版 PDF
// 一个字都没抽出来，和一份读全了的花名册在「你的文件」里像素级相同，headline 还照样说
// 「团队已就绪」。
// 🔴 三个词的口径由后端 registry.SourceDocument.status 定，前端不得自行判定、不得改写：
//   'ingested' 真读进去了并产出了引用 · 'empty' 解析成功但没抽到内容（扫描件/空表）
//   'failed'   根本没解析成（编码不认、格式不认、库缺）
// optional + 兜底 string：老后端不发这个键，stub transport 也不发——缺席时界面显示「未知」，
// 绝不默认当成 ingested（"我没读到" 和 "客户说没有" 是两件事，这里是同一条纪律的下游）。
export type LiveFileStatus = 'ingested' | 'empty' | 'failed'

export interface LiveFileEntry {
  idx: number
  filename: string
  // issue #74 · 服务端消歧后的**每文档**键（== SourceDocument.source_key == 材料块 '<key>:<line>'
  // 前缀）。`filename` 是展示名，补传重名时后端刻意保留原样；被消歧的是这一把。@ 引用必须按
  // 这把键送 id，否则 references._file_entry 的 `source_key == want or filename == want` 对两份
  // 同名文档都成立、`next()` 恒取第一份——引用看起来健康，读到的却是另一份文档（#70 实证）。
  // optional：老后端/stub 不发这个键，缺席时调用点退回 filename（additive 契约，同 status 那条
  // 纪律）。后端发的是**已解析**值（`sd.source_key or sd.filename`），所以永不为空串。
  source_key?: string
  size_bytes: number
  mime: string
  doc_kind: string
  uploaded_at: string
  n_chunks: number
  status?: LiveFileStatus | string
}

export interface LiveFilesPayload {
  context_id: string
  files: LiveFileEntry[]
}

// ── Avery's notes（feat-047 移植自 src/lite/transport.ts feat-033：GET /team/{id}/notes 契约）──
// 写侧、可见、跨会话累积的 agent 自写观察。只读；🔴 红线：写侧后端 redline.validate（EN+ZH）
// 已把评分/排名/画像文本拦在落库前——本清单永不含人卡数字/评分文本。新→旧（newest first）。
export interface LiveNoteEntry {
  id: string
  created_at: string // ISO8601 UTC
  text: string // Avery 的观察正文（1–3 句，work-focused）
  source_excerpt: string // 触发该笔记的提问前 ~60 字符（来源指引）
}

export interface LiveNotesPayload {
  context_id: string
  notes: LiveNoteEntry[]
}

// ── 议事室历史（issue #49：GET /team/{id}/advise-runs 契约）─────────────────────────────
// 每次成功 /advise 服务端落一行「问题 + 契约投影后的建议卡/短答」；F5/换设备不再丢。
// 只读、新→旧、上限 50。🔴 服务端只落 redline_passed 的 manifest——历史里不会出现被
// 红线拦下的建议内容。advice 与 answer 互斥（同 manifest 契约）。
export interface LiveAdviseRunEntry {
  id: string
  created_at: string // ISO8601 UTC
  question: string // 经理的提问原文（只回显给本人）
  title: string
  locale: string
  advice: Record<string, unknown> | null // manifest.advice 投影——回放时经 coerceAdvice 归一
  answer: string // 0729/03 分流短答（与 advice 互斥）
  // #78 · 这一轮属于哪一场。空串 = 无场归属（#78 之前的存量行），读侧按「自成一场的单轮」呈现。
  thread_id: string
}

export interface LiveAdviseRunsPayload {
  context_id: string
  runs: LiveAdviseRunEntry[]
}

// ── 议事室历史 · 按场分组（issue #78：GET /team/{id}/advise-threads 契约）──────────────
// 场按**最近活动**新→旧，场内 runs 按**对话顺序**（seq 升序）。上限 20 **场**（不是 20 行：
// 按行截会把最老那场腰斩成半截对话，而调用方分辨不出「这场只有 3 轮」和「这场有 7 轮只给了
// 3 轮」）。空历史是 200 + `threads: []`，**绝不是 404**——已鉴权读路径上的 404 语义是
// 「token 缺失/过期」，拿它表达空态会让界面把「没问过」显示成「登录失效」。
export interface LiveAdviseThread {
  thread_id: string // "" = 无场归属的单轮；稳定 key 用 `thread_id || runs[0].id`
  runs: LiveAdviseRunEntry[]
}

export interface LiveAdviseThreadsPayload {
  context_id: string
  threads: LiveAdviseThread[]
}

// ── 常驻表单（T1 · form-backend-a1a：`/team/{id}/forms*` 契约，gap-design-0805 §A1）────────
// 经理侧三件事：这家公司挂着哪几张常驻表单、给谁铸了链接、这一期谁交了。
//
// 🔴 两个 token 世界严格分开（form_api.py:15-20）：owner_token 是经理凭据，**只走 header**；
// 员工的 share_token 按设计骑在 `/f/<token>` URL 上——那是 IM webview 里唯一免登录走得通的
// 路。下面 LiveFormSubmission.link 是**服务端拼好的整条链接**，前端永不自造（见 :16 注释）。
//
// 🔴 词表由服务端定（form.py:35 FIELD_KINDS / :116 effective_submission_status），前端只照做。
// 闭合联合 + `| string` 兜底：后端哪天多一个词，界面显示「未知」而不是默认按 happy 值渲染
//（与 LiteFileStatus 同一条 absent≠none 纪律，见 :435）。
export type LiveFormFieldKind = 'text' | 'choice' | 'number' | 'yesno'
export type LiveFormStatus = 'open' | 'submitted' | 'expired'
// gap2 T11 · 自述标记。'' = 这一格的答案只进资料库那份提交文档，不上任何卡。
export type LiveFormSelfReport = '' | 'load' | 'mood'

export interface LiveFormField {
  id: string // ASCII 稳定键——答案按它落，改 label 不动老答案
  kind: LiveFormFieldKind | string
  label: string
  help: string
  required: boolean
  choices: string[] // 仅 choice
  min: number // 仅 number（'1~5 分' 就是把这一对收窄，不是新 kind）
  max: number // 仅 number
  // ⚠ 这三个键**必须**在这里出现。GET /forms 是 `asdict(f)` 原样投出来的，而拼装器保存时走的是
  // 「读回来的模板 → 按这个类型重建 payload → POST 回去」——类型里少一个键，那一趟就把它抹成
  // 后端的默认值，回流从此不响且**没有任何一道门会红**。
  // `situational` 当年就是这么漏的：后端 dataclass 有、FormFieldIn 有，前端类型与 save_form 的
  // 赋值点两处都没有。那时前端一个调用者都没有所以没人踩到，本票让经理真能存模板，它当场发作。
  situational: boolean // 这一格写的是处境 → 人卡情境信号 / 项目卡阻塞原句
  self_report: LiveFormSelfReport | string // 本人自述 → 人卡负载/情绪读数
  retired: boolean // 停用：不再问，但历史答案仍按这个 id 对得上号
}

export interface LiveFormTemplate {
  id: string // 内置「周报」恒为 'tpl_weekly'
  title: string
  active: boolean
  created_at: string
  fields: LiveFormField[]
}

export interface LiveFormsPayload {
  context_id: string
  templates: LiveFormTemplate[]
}

// 一次「发给某一个人的一份表单」。🔴 铸链即建行——没交的人在这里是 `status:'open'` 的**行**，
// 不是缺席（form_api.py:210-211）。前端因此不许用「名册减去交了的」去猜谁没交：那会把
// 从来没收到过链接的人也算成"没交"，是替客户断言一件我们并不知道的事。
export interface LiveFormSubmission {
  id: string
  template_id: string
  person_id: string
  person_name: string
  period: string // 述职周期，ISO 周如 '2026-W32'（铸链时定，不是从 submitted_at 倒推）
  status: LiveFormStatus | string
  created_at: string
  expires_at: string
  submitted_at: string | null // 后端写的是 `s.submitted_at or None` —— 未提交是 null，不是空串
  token?: string // 键**缺席**（不是空串）当这条没有 share_token
  link?: string // 同上。服务端拼好的整链，见本段头部注释
  // T5 · 铸链时绑的项目（`form.py` 存的是空串默认，所以这里可能是 ''）。
  // 空/缺席 = 这份周报没绑项目：只回流人卡，不碰项目卡。
  project_ref?: string
  // 仅 submissions 端点、且已提交。`boolean` 是 yesno（gap2 T11）——后端存的是 bool 不是文案，
  // 中文壳和英文壳答的「是」/「Yes」才是同一个值。
  answers?: Array<{ field_id: string; value: string | number | boolean }>
  // T9（gap2 #58）· 这一行是系统按上期名单**自动备好**的（true），还是经理亲手点出来的（false）。
  // 老后端不发这个键 → undefined，一律按「不知道」处理，绝不折成 false（absent≠none）。
  auto?: boolean
}

// T9 · 这一次读取**真的**自动补铸了什么。🔴 键**缺席**表示这次调用一行都没铸——不是 `[]`，
// 也不是「本期没有行」。前端合成通知的判据必须是一次真实的状态迁移；拿「本期有行」这种每次
// 刷新都为真的静态事实当判据，铃铛会每刷一次响一声（notifyStore 文件头那条红线）。
export interface FormAutoFilled {
  template_id: string
  period: string // 备好的是哪一期（服务端算的 ISO 周，前端永不自己再算一遍）
  copied_from: string // 照抄的是上面哪一期
  minted: number // 这次真的铸了几条 —— 界面上「沿用上期（N 人）」的 N 就是它
}

export interface LiveFormSubmissionsPayload {
  context_id: string
  submissions: LiveFormSubmission[]
  auto_filled?: FormAutoFilled[]
}

// T9 · 作废一条**还没交**的链接（= 把到期时刻拨到此刻）。已提交的 409、不是你的 404。
export interface FormVoidResult {
  context_id: string
  submission_id: string
  submission: LiveFormSubmission | null
}

// 铸链请求体。⚠ 后端 pydantic 两个模型都是 `extra: "forbid"`（form_api.py:67/73）——
// 多送一个键就是 422，别顺手往里塞前端自己的字段。
export interface FormLinkRecipient {
  id: string // 01 表的人员ID。归并按 ID 不按姓名——酒店有同名/花名，按名会并错人
  name: string
  // T5 · 这份周报「是关于哪个项目的」。填了它，员工自由文本里的风险原话才会带着
  // 「来自周报填写」的角标进那张项目卡的阻塞（`form_reflow.find_bound_project` 按标题找）。
  // 0807 HITL 之前这个字段**在界面上没有任何入口**，于是那条回流路真人永远走不到。
  // 省略 = 不绑（后端 `project_ref` 默认空串，回流只落人卡，不碰项目卡）。
  project_ref?: string
}

export interface FormLinksInput {
  recipients: FormLinkRecipient[] // 1..30（MAX_RECIPIENTS_PER_MINT），越界 422
  period?: string // 省略即服务端按当前 ISO 周填（form.py:109）
}

// 铸链回执。🔴 每次调用铸**新**链接，不幂等——「这周的周报」和「上周的周报」是两份不同的
// 提交，重复调用等于再发一轮（form_api.py:166-167）。调用方必须挡住双击。
export interface FormLinksResult {
  context_id: string
  template_id: string
  period: string
  links: LiveFormSubmission[] // with_answers=False，所以这一批永远没有 answers 键
}

// ── gap2 T11 · 模板拼装器的写侧 ────────────────────────────────────────────────────────────────
// 建一张表 / 按 id 覆盖一张已有的（`POST /team/{id}/forms`）。⚠ 后端两个 pydantic 模型都是
// `extra: "forbid"` —— payload 里多一个键（临时行 key、拖拽序号…）就是 422。
export interface FormTemplateInput {
  id?: string // 省略/空 = 服务端铸一个新 id
  title: string
  fields: LiveFormField[]
  active?: boolean
}

// 让 Avery 读一份**已经在资料库里的**文档，起草一张表。
export interface FormDraftInput {
  // `GET /team/{id}/files` 那一行里的 idx。⚠ 它是 source_documents 的**位置**不是稳定键，
  // 只在这一次请求里有效——别缓存（追加上传会改变这个 list）。
  file_index: number
  title?: string
}

// 起草回执。🔴 这是**提案不是落库**：`template.id` 恒为空串，落不落库由经理在拼装器里点确认，
// 走的仍是既有的 saveFormTemplate。
export interface FormDraftResult {
  context_id: string
  // 'llm' = 真模型读懂了；'heading' = 退回表头启发式；'none' = 一格都没读出来。
  // 服务端诚实标注，前端照实说——绝不把降级过的结果讲成「Avery 读懂了」。
  origin: 'llm' | 'heading' | 'none' | string
  // 起草层拿掉的东西。**必须**投到界面上：旧表格里「员工绩效排名」这种列很常见，
  // 悄悄少两列的提案比明说「这两列我没带过来，因为…」的提案危险得多。
  dropped: Array<{ label: string; reason: string }>
  source: { filename: string; source_key: string }
  template: LiveFormTemplate
}

// ── 端点分歧台账（wire-contract-duplicated-endpoint-asymmetry-unledgered）──────────────────
// 两壳各自持一份 LiveTransport（src/lite/transport.ts vs 本文件），端点早就不对称了。
// 区分信息只活在 commit message 里，代码与 AGENTS.md 均无痕迹——本台账把它挖出来钉在这里，
// 免得下次合并把真端点当缺陷补丢，或者反过来把刻意的缺口当 bug 修。
//
// 仅 v01（src/lite/transport.ts）有、v02（本文件）没有（1 个）：
//   · revokeAsk —— 刻意。出处 commit 8a2ec6c（feat-047 引擎同步）message 原话：
//     「刻意不带：revokeAsk/offlinePreview/AskStatus revoked|expired（lite 的 Ask 阶段 C
//     后续加法，kickoff 合流契约附录 §2 只点名 owner_token/header/fetchFiles/fetchNotes
//     这一段 delta）」。（offlinePreview 那时也没带，但 feat-068 后来补齐了——见下方
//     offlinePreview 字段注释；revokeAsk 至今仍是那唯一没补的缺口。）
//
// 仅 v02（本文件）有、v01 没有（17 个）—— 未裁定：
//   downloadFile（files-hub-0729/01）、fetchAccountContexts / claimContext（feat-053）、
//   demoStatus / demoClaim / appendNote（input-side-0721）、addProject / patchProject /
//   archiveProject / restoreProject（rich-align-0722 issue 05a）、addPerson / patchPerson /
//   archivePerson / restorePerson（rich-align-0722 issue 06）、fetchForms / createFormLinks /
//   fetchFormSubmissions（gap-design-0805 T3 · 常驻表单）。这 17 个全部诞生在
//   2026-07-19 v01 冻结（src/shared/version.ts:8，Danny 拍板）之后——冻结之后所有新功能
//   只往 v02 加，v01 没跟进不是逐条比对后"判定 v01 不需要"，只是没轮到。没有任何一条
//   commit message 像 revokeAsk 那样写"刻意不给 v01"，所以标未裁定。
//
// 上提共享类型到 src/shared/liveContract.ts 的建议本台账不做，留给 grilling。
//
// ── 传输接口：seam 只认这个，AFK 门注入确定性 stub ─────────────────────────────────────
export interface LiveTransport {
  // 打开 /advise SSE，逐事件回调；返回一个可 abort 的 handle。
  streamAdvise: (
    req: AdviseRequest,
    onEvent: (event: LiveAgentEvent) => void,
    onDone: (error?: Error) => void,
  ) => { abort: () => void }

  // 上传文件 → ingestion → context_id + 首帧 Your team 结构。**每次都新开一家公司。**
  ingest: (files: File[]) => Promise<LiveTeamPayload>

  // T10 · 给**这家已经存在的公司**补资料 → 同一个 context_id + 刷新过的 Your team 结构。
  // 与 `ingest` 的分界就是这一句：那个开公司，这个补资料。回执里的 context_id 恒等于入参，
  // 也不会回传 owner_token（凭据只在创建时交出去一次）。
  // 可选：老的 stub/离线通道没有这个方法，调用方按 `!!transport.appendFiles` 探测能力
  //（同 demoClaim 的先例——不做假按钮）。
  appendFiles?: (contextId: string, files: File[]) => Promise<LiveTeamPayload>

  // issue #77 · 删掉一份已经传进来的资料。回执与 appendFiles 同形（整张 team payload，
  // 前端拿它整屏刷新——删完之后卡片上来自那份资料的出处会变，让屏去读权威值别在前端猜）。
  // 🔴 寻址是 **source_key** 不是 idx：服务端 put() 会重排 idx，删完之后前端手里的旧 idx
  // 会静默指向另一份文件（不是 404，是下错文件）。
  // 可选：老后端/stub 没有这个方法，调用方按 `!!transport.deleteFile` 探测能力——探测不到
  // 就**一个删除键都不渲染**（不建假按钮红线的落点）。
  deleteFile?: (contextId: string, sourceKey: string) => Promise<LiveTeamPayload>

  // #86 ·「清空这份档案」—— 把上传来的一切收走，但**档案本身留着**：`context_id` 与
  // `owner_token` 一个字节不变，所以清空之后手上这份锚点、这个 token、外面发出去的员工
  // H5 链接全部继续有效。回执与 deleteFile 同形（整张 team payload，此刻是空世界）。
  //
  // 🔴 它**不是** delete：后端确实有一个删 context 行本身的方法（pg 侧的 `delete()`），
  // 那是本方法的反面，永远不挂 HTTP。「不要有新建的概念」这句拍板的落点就是这一条：
  // 一个人从头到尾就一份档案，加文件、删文件，真要从头来是清空这一份。
  //
  // 可选：老后端/stub 没有这个端点，调用方按 `!!transport.emptyContext` 探测能力——探测不到
  // 就**一个清空键都不渲染**（不建假按钮红线的落点，同 deleteFile 的先例）。
  emptyContext?: (contextId: string) => Promise<LiveTeamPayload>

  // 按 context_id 重新拉取 Your team（上传后填充/刷新）。
  fetchTeam: (contextId: string) => Promise<LiveTeamPayload>

  // ── Ask（feat-034）。未知 id 一律大声失败（与 feat-028 的 404 行为同规格，不静默回落）──
  // 保存草稿（题目经服务端红线门校验后落库；违规 → 4xx 大声失败）。
  saveAsk: (draft: AskDraft) => Promise<AskDraft>
  // 生成一人一链（服务端发不可猜 token + 完整链接）。
  shareAsk: (askId: string) => Promise<AskDraft>
  // manager 侧拉取状态/回执（PRD Q7：打开时 HTTP 拉取刷新，无推送）。
  fetchAsk: (askId: string) => Promise<AskDraft>

  // feat-068 · 从 v01 补齐（此前只有 lite 壳有）：离线预览通道（stub）自我声明。
  // 🔴 用途已不止"链接是假的"——AskCard 的红线提示按它二选一：真 HTTP 通道下 saveAsk 打
  // POST /ask，服务端 redline.validate 每次保存都真跑；stub 通道 saveAsk 只做结构校验、
  // 明确不假装校验过红线文本。文案必须跟着通道走，不能两边都说同一句。
  // 真 HTTP transport 恒缺省（undefined = 联网、红线在跑、链接是真的）。
  readonly offlinePreview?: boolean

  // feat-047 移植：按 context_id 拉取「你的文件」清单（feat-032 file space；重启后仍在）。
  fetchFiles: (contextId: string) => Promise<LiveFilesPayload>

  // files-hub-0729/01 · 取回某一份原始文件的字节（`GET /team/{id}/files/{idx}`，feat-032 起
  // 就在后端，前端从未接过）。
  //
  // 🔴 为什么必须走 transport 拿 Blob，而不是给一行 `<a href="…/files/0" download>`：
  // 这个端点吃 **owner_token header**（feat-038 租户隔离，缺/错一律 404），而 `<a href>`
  // 发的是一次浏览器裸导航——带不上任何自定义 header。裸链接的结果不是"下载失败"，是
  // **一个看起来能点、点了必 404 的假按钮**，正是本战役的红线所禁。
  //
  // 🔴 返回 Blob 而不是直接触发下载：副作用留给调用方（objectURL 的建/撤要成对，见
  // FileManifest 的 downloadOne），transport 只管"把字节取回来"。
  downloadFile: (contextId: string, idx: number) => Promise<Blob>

  // feat-047 移植：按 context_id 拉取「Avery's notes」累积笔记（feat-033；只读、新→旧、重启后仍在）。
  fetchNotes: (contextId: string) => Promise<LiveNotesPayload>

  // issue #49 · 议事室历史（只读、新→旧）。可选：stub 通道无持久层，判空即整块不渲染
  //（与 fetchAccountContexts 同款降级纪律）。
  // ⚠ #78 起议事室界面读的是下面按场分组的那条；这条平铺读法留着是因为它仍是后端的公开读面
  // （四条契约测试盯着它），前端目前无人调用。
  fetchAdviseRuns?: (contextId: string) => Promise<LiveAdviseRunsPayload>

  // issue #78 · 议事室历史**按场分组**。同为可选（stub 通道没有它 → 判空即整块不渲染，
  // 这正是离线门看到「零历史面板」的原因，不是 bug）。
  fetchAdviseThreads?: (contextId: string) => Promise<LiveAdviseThreadsPayload>

  // ── 常驻表单（gap-design-0805 T3）。同为可选：联网后端能力，stub 天然没有；判空即整段
  // 不渲染（与 fetchAdviseRuns 同款降级纪律）。三条全走 owner_token/账号双通道 header。────
  //
  // ⚠ GET /forms 在服务端**首次调用会写**：`ensure_builtin_templates` 把内置「周报」铸进
  // 这家公司的表单库（form_api.py:113 → form.py:360）。按模板 id 幂等（已存在则原样不动，
  // 经理改过的题面不会被内置版覆盖），所以重复调用安全——但别把它当成一次免费的读，
  // 挂在"经理打开资料库屏"这个动作上，不要挂进每次上传/恢复的扇出。
  fetchForms?: (contextId: string) => Promise<LiveFormsPayload>
  // 给选中的人各铸一条不可猜的 `/f/<token>` 链接（一人一链、7 天过期，拍板 #4）。
  // 🔴 服务端不发消息、不碰 IM——**转发这个动作本身就是人的闸**，经理自己去粘。
  createFormLinks?: (
    contextId: string,
    templateId: string,
    input: FormLinksInput,
  ) => Promise<FormLinksResult>
  // 「这一期谁交了 / 谁没交」的唯一真相（未交 = status 'open' 的行，不是名单里的缺席）。
  fetchFormSubmissions?: (contextId: string) => Promise<LiveFormSubmissionsPayload>
  // T9 · 作废一条还没交的链接。可选（同上面三条）：不认这个方法的通道上，界面那颗按钮不渲染。
  voidFormSubmission?: (contextId: string, submissionId: string) => Promise<FormVoidResult>
  // gap2 T11 · 拼装器的写侧：建一张表，或按 id 覆盖一张已有的。
  // 🔴 失败必须能说清**哪一条**超限/撞门——服务端的 422 body 里有 `detail.reason`，
  // 抛出来的 TransportError 会把它带在 `serverReason` 上（见 readServerReason）。
  saveFormTemplate?: (contextId: string, input: FormTemplateInput) => Promise<LiveFormTemplate>
  // gap2 T11 · 让 Avery 读一份已传的旧表格，起草一份提案（不落库）。
  draftFormFromFile?: (contextId: string, input: FormDraftInput) => Promise<FormDraftResult>

  // ── 账号（feat-053）。可选实现：stub transport 不提供，调用方须判空 ──────────────────
  // 🔴 可选（`?:`）是刻意的——LiveTransport 有第二个实现（stubTransport，AFK 门/离线演示），
  // 加必填方法会让它编译不过。账号是**联网后端能力**，stub 天然没有，判空即降级成游客。
  // 本账号登记在案的公司 context（登录后恢复用）。
  fetchAccountContexts?: () => Promise<AccountContextsPayload>
  // 把匿名 context 认领进本账号（凭 owner_token 证明所有权）。
  claimContext?: (contextId: string, ownerToken: string) => Promise<void>

  // ── 示例团队（input-side-0721 · 3A）。同为可选：联网后端能力，stub 天然没有 ─────────────
  // 探测这台后端有没有示例团队可领（闸门页/首页骨架据此决定那扇门露不露面）。
  demoStatus?: () => Promise<DemoStatusPayload>
  // 领一份：后端把预铸母本克隆成本访客私有副本（新 context_id + 新 owner_token），
  // 响应与 /ingest 同形 —— 调用方走与上传完全相同的落地路径。
  demoClaim?: () => Promise<LiveTeamPayload>

  // ── onboarding 采集（input-side-0721 · 8A）。可选：stub 无处可送，调用方判空降级 ────────
  // 把经理在初始设置里口述的公司情况追加进本公司的 company_notes（owner_token 门后）。
  // 🔴 服务端写侧红线原样把关（评分/排名文本 422）——这条通道不绕任何闸。
  appendNote?: (contextId: string, text: string, sourceExcerpt: string) => Promise<void>

  // ── 项目手编 CRUD（rich-align-0722 · issue 05a）。同为可选：联网后端能力，stub 天然没有 ────
  // 🔴 store 侧 action 判空降级（同 claimDemoTeam 判 demoClaim 先例）——stub/离线态无 contextId，
  // CRUD 入口本就不该出现。四端点全走 owner_token header 鉴权（authHeader），回执 {context_id, project}。
  addProject?: (contextId: string, input: ProjectAddInput) => Promise<ProjectWriteResult>
  patchProject?: (
    contextId: string,
    projectId: string,
    patch: ProjectPatchInput,
  ) => Promise<ProjectWriteResult>
  archiveProject?: (contextId: string, projectId: string) => Promise<ProjectWriteResult>
  restoreProject?: (contextId: string, projectId: string) => Promise<ProjectWriteResult>

  // ── 人员手编 CRUD（rich-align-0722 · issue 06）。同为可选（stub 无）；store 判空降级。 ────────
  addPerson?: (contextId: string, input: PersonAddInput) => Promise<PersonWriteResult>
  patchPerson?: (
    contextId: string,
    personId: string,
    patch: PersonPatchInput,
  ) => Promise<PersonWriteResult>
  archivePerson?: (contextId: string, personId: string) => Promise<PersonWriteResult>
  restorePerson?: (contextId: string, personId: string) => Promise<PersonWriteResult>
}

// ── 账号契约（feat-053；后端 service/auth_api.py）────────────────────────────────────────
// GET /account/contexts —— 只回本账号拥有的 context id，不回 owner_token
//（账号已授权的调用方不需要 token，把长效凭据经 API 发回来正是 token 进日志的路径）。
export interface AccountContextsPayload {
  context_ids: string[]
}

// 服务基址：默认打本机 feat-015 服务；部署端经 VITE_AVERY_API_BASE 覆盖。
const LOCAL_API_BASE = 'http://127.0.0.1:8137'

// feat-068：读 build 期注入的 base。🔴 Vite 是在**打包时**把 VITE_* 内联成字面量的——
// 运行时再改环境变量对已发出去的 bundle 毫无作用。空串/未定义一律算"没配"；尾斜杠剥掉
// （下游全是 `${base}/xxx` 拼接，留着会拼出 //advise）。
function envApiBase(): string | undefined {
  const raw = typeof import.meta !== 'undefined' ? import.meta.env?.VITE_AVERY_API_BASE : undefined
  const trimmed = raw ? String(raw).replace(/\/$/, '') : ''
  return trimmed || undefined
}

// feat-068：「env 没配 + 页面走 https」= 部署配错，没有第二种解释。本机 dev 缺 env 是正常的
// （就该打 127.0.0.1），所以判据必须带上 protocol，不能只看 env。
// 🔴 typeof location 守卫：SSR / node 测试 / 非浏览器环境里没有 location，这里不许炸。
function apiBaseMisconfigured(): boolean {
  if (envApiBase() !== undefined) return false
  return typeof location !== 'undefined' && location.protocol === 'https:'
}

let misconfigLogged = false

export function apiBase(): string {
  const fromEnv = envApiBase()
  if (fromEnv) return fromEnv
  // feat-068：配错的生产构建会静默把 localhost 烤进 bundle——UI 照常渲染，然后每一次调用都
  // 打到**访客自己的机器**上（https 页还会被浏览器当混合内容直接掐断）。现场表现和"后端挂了"
  // 一模一样，会把人整队送去查一个根本没问题的后端。所以这里吼一声。
  // 🔴 只吼不 throw：apiBase() 在 render 路径上被调用，throw 会把整个应用白屏——把一个配置
  // 事故升级成完全打不开。用户可见的那句话由 httpErrorMessage() 改口（说"构建配错"）。
  if (apiBaseMisconfigured() && !misconfigLogged) {
    misconfigLogged = true
    console.error(
      '[avery] VITE_AVERY_API_BASE was not set at build time — this build fell back to ' +
        `${LOCAL_API_BASE}, which points at the visitor's own machine. This build is ` +
        'misconfigured; the backend is not down. Set VITE_AVERY_API_BASE and rebuild.',
    )
  }
  return LOCAL_API_BASE
}

// ── feat-068 · ZH-03：HTTP 状态码 → 人话（本地化）────────────────────────────────────────
// 上线前每个失败点都是 `throw new Error(\`ingest HTTP ${res.status}\`)`；feat-068 把它们换成了
// 人话，但那一波正是把中文设成生产默认的同一波——于是被限流的三亚经理读到的是
// 「无法读取这些文件」压着一行 `ingest: too many requests — wait 34s and try again.`：
// 中文那句只说"出错了"，**真正带信息的是他读不懂的那行英文**。ZH-03 修的就是这个。
//
// 生产护栏是真的会跳的：/ingest 10/min(burst 3)、/advise 30/min(burst 10) → 429；超上传上限
// → 413；魔数嗅探不认 → 415/422；owner_token 缺/错 → 404（后端故意不发 403，避免把"这个
// context 存在"泄露出去）。
//
// ── 分层选择（本次的关键决定）─────────────────────────────────────────────────────────
// transport.ts 是传输层不是组件，没有 useDict() 可用（hook 只能在 render 里跑）。这里走
// useDict 自己内部就在用的那条**非 hook 路径**：getDict(activeLocale())。
//   · 两者都是纯函数，shared/i18n/index.ts 不 import React——本模块因此仍然零 React 依赖。
//   · 和 useDict 同一条 locale 解析（?lang= > VITE_AVERY_LOCALE > en），传输层文案和界面
//     文案不可能各说各的语言。
// 没选"把 resolver 当参数传进来"：那要改 LiveTransport seam，并让 AFK 门的 stub transport
// 也背一个它不需要的参数。也没选"抛结构化错误、让 UI 自己本地化"：那要求每个消费者
// （UploadPanel / OnboardWizard / RoomScreen / ask 链）各写一份 status→key 的 switch，四份
// 拷贝迟早分叉。TransportError 把后者的**好处**单独拿了过来——见下。
export function httpErrorMessage(res?: Response): string {
  const t = getDict(activeLocale()).transport
  // 配错的构建：一切失败都先说这句。否则"打不通"会被一路误读成服务器故障。
  // env 变量名 / localhost 地址属开发者细节，留在 apiBase() 那声 console.error 里。
  if (apiBaseMisconfigured()) return t.misconfigured
  // 没有 Response = fetch 自己 reject 了（连接被拒 / 混合内容拦截 / CORS / 离线），无 status 可读。
  if (!res) return t.offline
  const status = res.status
  if (status === 429) {
    // Retry-After 读得出就把秒数折进句子；读不出就说"稍等片刻"，绝不编一个具体秒数。
    const wait = retryAfterSeconds(res)
    return wait ? fill(t.rateLimited, { seconds: wait }) : t.rateLimitedWait
  }
  if (status === 413) return t.tooLarge
  if (status === 415 || status === 422) return t.unsupportedType
  // 🔴 404 在已鉴权的读路径上几乎从不是"空"——是这台浏览器手里的 owner_token 缺失/过期，
  // 后端按"不泄露存在性"的规矩回 404 而不是 403。说成"还没有数据"是在对客户谎报他自己的
  // 数据，必须写明"数据还在，是这台浏览器打不开了"。
  if (status === 404) return t.staleToken
  if (status >= 500) return fill(t.serverError, { status })
  return fill(t.generic, { status })
}

// 词典占位符替换（与 lite2/OnboardWizard.tsx 的 fill 同形——传输层不 import 组件里的局部 helper）。
function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''))
}

/**
 * feat-068 · ZH-03：带身份的传输层错误。
 *
 * message —— 已本地化、可直接上屏的**整句**，句子里没有 endpoint 名。
 * endpoint / status —— 这次失败的身份，留给控制台与调用方排查。
 *
 * 🔴 为什么身份不能进 message：`ingest: ` / `team: ` 是开发者输出。UI 就是把 err.message
 * 原样贴在中文标题下面的（lite2/OnboardWizard.tsx、lite2/UploadPanel.tsx 都这么渲染），
 * 客户于是读到半句英文技术词。身份挂到字段上，客户的句子和排查线索两边都不牺牲。
 */
export class TransportError extends Error {
  readonly endpoint: string
  readonly status?: number
  /**
   * gap2 T11 —— 服务端 422 body 里那句 `detail.reason`（英文、面向开发者的一句人话原因）。
   *
   * 🔴 它**不是**给用户看的整句：`message` 才是（已本地化）。它的用途只有一个——让 UI 能把
   * 「这次为什么没保存成」定位到**哪一条**规则上（哪个 field.id、超了哪个上限），从而说出
   * 一句比「保存失败」有用的话，或者在最坏情况下把它作为诊断附在报错后面。
   *
   * 为什么不复用既有的 formsError 三态：那三个取值的文案分别在讲「一次发给 1 到 30 个人」这类
   * 铸链的事，套到模板保存上就是对经理撒谎（同一个 422，两件完全不同的事）。
   *
   * ⚠ 这不是 `withServerDetail` 的复活：那个函数早在某次合并里丢了（transport.ts 的
   * 「端点分歧台账」警告的正是这种丢法），今天全仓零引用。这里是重新写的一小段，只服务
   * 拼装器这一条路。
   */
  readonly serverReason?: string

  constructor(message: string, endpoint: string, status?: number, serverReason?: string) {
    super(message)
    this.name = 'TransportError'
    this.endpoint = endpoint
    this.status = status
    this.serverReason = serverReason
  }
}

/**
 * 把 `{"detail": {"error": …, "reason": "…"}}` 里那句 reason 读出来（读不出就 undefined）。
 * body 只读一次——`res.json()` 会消费流，调用方拿到错误之后不该再去读它。
 */
async function readServerReason(res: Response): Promise<string | undefined> {
  try {
    const body = (await res.clone().json()) as { detail?: unknown }
    const detail = body?.detail
    if (typeof detail === 'string') return detail
    if (detail && typeof detail === 'object') {
      const reason = (detail as { reason?: unknown }).reason
      if (typeof reason === 'string' && reason.trim()) return reason
    }
  } catch {
    // 非 JSON / 空 body / 已被读过——没有诊断可给，不是错误。
  }
  return undefined
}

// 写侧专用：与 transportError 同一条身份/本地化纪律，另外把服务端那句 reason 带上。
export async function transportErrorDetailed(name: string, res: Response): Promise<TransportError> {
  const reason = await readServerReason(res)
  const message = httpErrorMessage(res)
  console.debug(`[avery] ${name}: HTTP ${res.status} — ${message}${reason ? ` (${reason})` : ''}`)
  return new TransportError(message, name, res.status, reason)
}

// 抛给调用方的错误：人话 message + 可排查的身份。
// 开发者那行（`ingest: HTTP 429`）从用户句子里搬到了 console.debug——没有丢，只是不再上屏。
export function transportError(name: string, res?: Response): TransportError {
  const message = httpErrorMessage(res)
  console.debug(`[avery] ${name}: ${res ? `HTTP ${res.status}` : 'network failure'} — ${message}`)
  return new TransportError(message, name, res?.status)
}

// 429 的 Retry-After：规范允许「秒数」或「HTTP-date」两种写法。只认纯数字——不是数字就当没有
// （宁可说"稍等片刻"，也不敢编一个具体秒数出来）。
function retryAfterSeconds(res: Response): number | null {
  try {
    const raw = res.headers.get('Retry-After')
    if (!raw) return null
    const secs = Number(raw.trim())
    return Number.isFinite(secs) && secs > 0 ? Math.ceil(secs) : null
  } catch {
    return null
  }
}

// ── feat-047 移植（持久化链 feat-038 租户隔离）：owner_token 客户端存储（按 context_id）──────
// /ingest 首帧回传 owner_token；transport 存下，后续 team/files/notes/advise 以 header 带上。
// 落 localStorage 让一次会话内刷新页面仍持有 token（后端持久化让数据本身也还在）。
// 🔴 token 只进 header，绝不拼进 URL；读/写失败静默降级（不阻断主流程）。
// 独立命名空间 `lite2:` 前缀（与 flowStore/notifyStore/onboardStore 同族）——不与
// src/lite 的 `avery.ownerTokens` 共享存储，两壳各自持有各自会话的 token。
const TOKEN_STORE_KEY = 'lite2:ownerTokens:v1'
export const OWNER_TOKEN_HEADER = 'X-Avery-Token'

// ── feat-053 账号凭据 header ──────────────────────────────────────────────────────────────
// 🔴 与 owner_token **分开两个 header**，刻意不复用 `Authorization: Bearer`——那个已经被
// feat-038 的 owner_token 占了，一个 header 塞两种凭据 = 带 A 的调用方被当成 B 校验。
// 两种凭据，两个 header，服务端各查各的（service/account.py 的同一条注释）。
// 未登录 → 不发这个 header（游客路径原样走 owner_token，行为零变化）。
export const ACCOUNT_TOKEN_HEADER = 'X-Avery-Account'

// 直接读 authStore 的内存 token（不落我们自己的 localStorage——supabase-js 已在管持久化，
// 再存一份就是多一个会失效、会泄漏的凭据副本）。未登录/未配置 → null → 不带 header。
function accountHeader(): Record<string, string> {
  const tok = currentAccessToken()
  return tok ? { [ACCOUNT_TOKEN_HEADER]: tok } : {}
}

function loadTokenStore(): Record<string, string> {
  try {
    if (typeof localStorage === 'undefined') return {}
    const raw = localStorage.getItem(TOKEN_STORE_KEY)
    return raw ? (JSON.parse(raw) as Record<string, string>) : {}
  } catch {
    return {}
  }
}

// feat-050（会话不丢）：按 context_id 读回已存的 owner_token。transport 内部本就从
// localStorage 播种 tokens（刷新后 header 一直是对的）——这个导出只是让 store 在恢复会话时
// 把同一份 token 挂回 state 供 UI/门可见，与 feat-047 的 `ownerToken` 语义一致。
// 🔴 只读；调用方一样只许把它放进 header，绝不进 URL。
export function storedOwnerToken(contextId: string | null | undefined): string | null {
  if (!contextId) return null
  return loadTokenStore()[contextId] ?? null
}

function persistTokenStore(store: Record<string, string>): void {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(TOKEN_STORE_KEY, JSON.stringify(store))
  } catch {
    /* private-mode / quota — in-memory map still carries the token for this session */
  }
}

// 🔴 模块级单份，不放进 createHttpTransport 的闭包（feat-053 复核 finding 1）。
// 两个理由：① 多个 transport 实例本来就读写同一个 localStorage key，各持一份内存副本
// 只会互相覆盖；② 更要命的是闭包私有副本**清不掉**——登出时把 localStorage 抹了，
// 已建好的 transport 手里那份仍在，authHeader 继续发上一个账号的 owner_token。
let tokenCache: Record<string, string> | null = null

function tokenStore(): Record<string, string> {
  if (!tokenCache) tokenCache = loadTokenStore()
  return tokenCache
}

/**
 * feat-053 · 抹掉本机存着的**全部** owner_token（内存 + localStorage）。
 *
 * 登出/换账号时调用。登出的语义是"这台浏览器上不再留我的凭据"——只清手上那一条的话，
 * 早先几次上传留下的 token 仍躺在 localStorage 里，仍然是活的读权限。
 * 代价（有意承担）：游客期传过、又始终没点"绑定到我的账号"的 context，登出后就找不回来了。
 * 共享浏览器不该留下活凭据；面板里的绑定按钮就是留住它们的正路。
 *
 * 🔴 游客路径不受影响：游客从不登出，这个函数在游客会话里永远不会被调用。
 */
export function forgetAllOwnerTokens(): void {
  tokenCache = {}
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.removeItem(TOKEN_STORE_KEY)
  } catch {
    /* private-mode — 内存那份已经空了，本会话不会再发出去 */
  }
}

// ── 真 HTTP/SSE 传输（浏览器 fetch + 流式解析）──────────────────────────────────────────
// 用 fetch + ReadableStream 手解 SSE（而非 EventSource）：POST body + Abort 都需要，EventSource 只支持 GET。
export function createHttpTransport(base: string = apiBase()): LiveTransport {
  // Per-context owner_token map, seeded from localStorage so a page reload keeps the credential.
  // 🔴 每次都经 tokenStore() 现取，绝不在这里 `const tokens = tokenStore()` 存进闭包——
  // 那样 forgetAllOwnerTokens() 换掉模块级引用后，这里握着的还是登出前那份（finding 1 的成因）。
  const rememberToken = (contextId: string | undefined, token: string | undefined): void => {
    if (!contextId || !token) return
    const tokens = tokenStore()
    tokens[contextId] = token
    persistTokenStore(tokens)
  }
  // 🔴 header-only：给某 context 的读/写调用附上 owner_token（有则带，无则空），绝不进 URL。
  // feat-053：同时带上账号 token（已登录才有）。两个凭据互为备份而非互斥——
  // 服务端任一成立即放行（authorize_context 先看账号，再看 owner_token），所以
  //   · 游客：只有 owner_token → 原样工作
  //   · 换设备登录：只有账号 token → 服务端按 user 查到 context 再放行
  //   · 本机已登录：两个都有 → 任一成立即可
  const authHeader = (contextId: string | undefined): Record<string, string> => {
    const tok = contextId ? tokenStore()[contextId] : undefined
    return { ...(tok ? { [OWNER_TOKEN_HEADER]: tok } : {}), ...accountHeader() }
  }
  // feat-047 打回复验：askId → company_context_id（saveAsk 成功时记下），share/fetch 据此带
  // owner_token header。进程内即可——ask 卡与 run 同生命周期，刷新后重新走 saveAsk。
  // （此前 lite2 的 saveAsk/shareAsk/fetchAsk 零 header，对上已加固的真后端全部 404。）
  const askContexts: Record<string, string> = {}
  const rememberAskContext = (askId: string | undefined, contextId: string | undefined): void => {
    if (askId && contextId) askContexts[askId] = contextId
  }
  // feat-068：fetch 自己 reject 时压根没有 Response/status 可读（连接被拒、https 页的混合内容
  // 拦截、CORS、离线）——而"api base 配错"最常见的落地形态正是这一类。所有请求统一从这里出
  // 错文案：配错的构建说"构建配错了"，其余说网络不通。
  // 🔴 只包一层错误文案，url/init 原样透传——请求形状、header、URL 一个字节都没动。
  // AbortError 原样抛回（streamAdvise 靠 controller.signal.aborted 判定，但不让包装吃掉调用方
  // 可能依赖的错误类型）；不用 instanceof——老浏览器的 DOMException 不是 Error 子类。
  const send = async (name: string, url: string, init?: RequestInit): Promise<Response> => {
    try {
      return await fetch(url, init)
    } catch (err) {
      if ((err as { name?: string } | null)?.name === 'AbortError') throw err
      throw transportError(name)
    }
  }

  return {
    streamAdvise(req, onEvent, onDone) {
      const controller = new AbortController()
      ;(async () => {
        try {
          const res = await send('advise', `${base}/advise`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'text/event-stream',
              ...authHeader(req.company_context_id), // feat-047: tenant token (header only)
            },
            body: JSON.stringify({ ...withLocale(req), stream: true }),
            signal: controller.signal,
          })
          if (!res.ok || !res.body) {
            throw transportError('advise', res)
          }
          const reader = res.body.getReader()
          const decoder = new TextDecoder()
          let buffer = ''
          for (;;) {
            const { done, value } = await reader.read()
            if (done) break
            buffer += decoder.decode(value, { stream: true })
            // SSE 记录以空行分隔（LF-LF 或 CRLF-CRLF——sse-starlette 按 SSE 惯例发 CRLF，
            // 只找 '\n\n' 一条记录都切不出来：流"正常"走完但零帧。S2 前端门相位 F2
            //（askLive SSE 事件到帧）抓到的真 bug；od -c 实证 `…"}\r\n\r\nevent: think…`）。
            let m: RegExpExecArray | null
            while ((m = /\r?\n\r?\n/.exec(buffer)) !== null) {
              const rawEvent = buffer.slice(0, m.index)
              buffer = buffer.slice(m.index + m[0].length)
              const parsed = parseSseRecord(rawEvent)
              if (parsed) onEvent(parsed)
            }
          }
          onDone()
        } catch (err) {
          if (controller.signal.aborted) {
            onDone()
          } else {
            onDone(err instanceof Error ? err : new Error(String(err)))
          }
        }
      })()
      return { abort: () => controller.abort() }
    },

    async ingest(files) {
      const form = new FormData()
      for (const f of files) form.append('files', f, f.name)
      // feat-053：上传**不要求**登录（游客路径是硬要求，登录墙会作废整条演示链）。
      // 已登录时带上账号 header，服务端顺手把新 context 绑到账号，省掉一次认领。
      // feat-068 的 send() 包装必须保留：ingest 真要 100–120 秒（后端在法兰克福、LLM 在国内），
      // 那层带跨境重试与统一错误文案。裸 fetch 会把部署线刚修好的等待态又打回去。
      const res = await send('ingest', `${base}/ingest`, {
        method: 'POST',
        body: form,
        headers: accountHeader(),
      })
      if (!res.ok) throw transportError('ingest', res)
      const payload = (await res.json()) as LiveTeamPayload
      // feat-047: store this company's owner_token so every later read/advise can present it.
      rememberToken(payload.context_id, payload.owner_token)
      return payload
    },

    // T10 · 补资料。与 ingest 逐条同形（同一层 send 包装 —— 抽取同样是分钟级、同样跨境），
    // 三处刻意不同：
    //   ① 带 `authHeader(contextId)` —— 这是**已有公司**的写口，要凭 owner_token 才进得去；
    //   ② **不** rememberToken —— 服务端没有新铸 token，也没回传（凭据只在创建时交出去一次）；
    //   ③ 回执的 context_id 恒等于入参，所以 store 侧走的是"原地刷新"而不是 adoptContext
    //      （那条路会把上一家公司的 team/files/notes 清掉，正是这一票要拆掉的那堵墙）。
    async appendFiles(contextId, files) {
      const form = new FormData()
      for (const f of files) form.append('files', f, f.name)
      const res = await send('ingest', `${base}/team/${encodeURIComponent(contextId)}/files`, {
        method: 'POST',
        body: form,
        headers: { ...authHeader(contextId), ...accountHeader() },
      })
      if (!res.ok) throw transportError('ingest', res)
      return (await res.json()) as LiveTeamPayload
    },

    // issue #77 · 删一份资料。同 appendFiles 的 owner_token 纪律；`source_key` 是文件名，
    // 可能带中文/括号/斜杠 —— 必须 encodeURIComponent（服务端那条路由用 `:path` 转换器接）。
    async deleteFile(contextId, sourceKey) {
      const res = await send(
        'file delete',
        `${base}/team/${encodeURIComponent(contextId)}/files/${encodeURIComponent(sourceKey)}`,
        { method: 'DELETE', headers: { ...authHeader(contextId), ...accountHeader() } },
      )
      if (!res.ok) throw transportError('file delete', res)
      return (await res.json()) as LiveTeamPayload
    },

    // #86 ·「清空这份档案」。同 deleteFile 的 owner_token 纪律；**不** rememberToken——
    // 服务端没有铸新 token 也没回传，档案的凭据自始至终是同一个（那正是本票的意义）。
    async emptyContext(contextId) {
      const res = await send(
        'archive empty',
        `${base}/team/${encodeURIComponent(contextId)}/empty`,
        { method: 'POST', headers: { ...authHeader(contextId), ...accountHeader() } },
      )
      if (!res.ok) throw transportError('archive empty', res)
      return (await res.json()) as LiveTeamPayload
    },

    async fetchTeam(contextId) {
      const res = await send('team', `${base}/team/${encodeURIComponent(contextId)}`, {
        headers: authHeader(contextId),
      })
      if (!res.ok) throw transportError('team', res)
      return (await res.json()) as LiveTeamPayload
    },

    // ── 示例团队（input-side-0721 · 3A；后端 service/demo.py）─────────────────────────────
    async demoStatus() {
      const res = await send('demo', `${base}/demo/status`)
      if (!res.ok) throw transportError('demo', res)
      return (await res.json()) as DemoStatusPayload
    },

    async demoClaim() {
      // 与 ingest 同款收尾：记 token、回同形 payload —— store 侧走同一条落地路径。
      // 已登录时带账号 header 没有额外语义（后端 claim 不做绑定；示例副本是随手可弃的
      // 演示工作区，绑到账号反而把垃圾留在账号名下）。这里刻意**不带**。
      const res = await send('demo', `${base}/demo/claim`, { method: 'POST' })
      if (!res.ok) throw transportError('demo', res)
      const payload = (await res.json()) as LiveTeamPayload
      rememberToken(payload.context_id, payload.owner_token)
      return payload
    },

    // ── onboarding 采集（input-side-0721 · 8A；POST /team/{id}/notes）─────────────────────
    async appendNote(contextId, text, sourceExcerpt) {
      const res = await send('notes', `${base}/team/${encodeURIComponent(contextId)}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader(contextId) },
        body: JSON.stringify({ text, source_excerpt: sourceExcerpt }),
      })
      if (!res.ok) throw transportError('notes', res)
    },

    // ── 项目手编 CRUD（rich-align-0722 · issue 05a；service/ingest_api.py 写端点）──────────────
    // header-only owner_token（同读端点纪律，缺/伪 token → 后端 404，前端大声失败不静默回落）。
    // body 只发调用方给的键（PATCH 的 exclude_unset 语义靠 store 侧只塞改动键实现，见 ProjectPatchInput）。
    async addProject(contextId, input) {
      const res = await send(
        'project add',
        `${base}/team/${encodeURIComponent(contextId)}/projects`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeader(contextId) },
          body: JSON.stringify(input),
        },
      )
      if (!res.ok) throw transportError('project add', res)
      return (await res.json()) as ProjectWriteResult
    },

    async patchProject(contextId, projectId, patch) {
      const res = await send(
        'project patch',
        `${base}/team/${encodeURIComponent(contextId)}/projects/${encodeURIComponent(projectId)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', ...authHeader(contextId) },
          body: JSON.stringify(patch),
        },
      )
      if (!res.ok) throw transportError('project patch', res)
      return (await res.json()) as ProjectWriteResult
    },

    async archiveProject(contextId, projectId) {
      const res = await send(
        'project archive',
        `${base}/team/${encodeURIComponent(contextId)}/projects/${encodeURIComponent(projectId)}/archive`,
        { method: 'POST', headers: authHeader(contextId) },
      )
      if (!res.ok) throw transportError('project archive', res)
      return (await res.json()) as ProjectWriteResult
    },

    async restoreProject(contextId, projectId) {
      const res = await send(
        'project restore',
        `${base}/team/${encodeURIComponent(contextId)}/projects/${encodeURIComponent(projectId)}/restore`,
        { method: 'POST', headers: authHeader(contextId) },
      )
      if (!res.ok) throw transportError('project restore', res)
      return (await res.json()) as ProjectWriteResult
    },

    // ── 人员手编 CRUD（rich-align-0722 · issue 06；service/ingest_api.py people 写端点）──────────
    async addPerson(contextId, input) {
      const res = await send(
        'person add',
        `${base}/team/${encodeURIComponent(contextId)}/people`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeader(contextId) },
          body: JSON.stringify(input),
        },
      )
      if (!res.ok) throw transportError('person add', res)
      return (await res.json()) as PersonWriteResult
    },

    async patchPerson(contextId, personId, patch) {
      const res = await send(
        'person patch',
        `${base}/team/${encodeURIComponent(contextId)}/people/${encodeURIComponent(personId)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', ...authHeader(contextId) },
          body: JSON.stringify(patch),
        },
      )
      if (!res.ok) throw transportError('person patch', res)
      return (await res.json()) as PersonWriteResult
    },

    async archivePerson(contextId, personId) {
      const res = await send(
        'person archive',
        `${base}/team/${encodeURIComponent(contextId)}/people/${encodeURIComponent(personId)}/archive`,
        { method: 'POST', headers: authHeader(contextId) },
      )
      if (!res.ok) throw transportError('person archive', res)
      return (await res.json()) as PersonWriteResult
    },

    async restorePerson(contextId, personId) {
      const res = await send(
        'person restore',
        `${base}/team/${encodeURIComponent(contextId)}/people/${encodeURIComponent(personId)}/restore`,
        { method: 'POST', headers: authHeader(contextId) },
      )
      if (!res.ok) throw transportError('person restore', res)
      return (await res.json()) as PersonWriteResult
    },

    // ── Ask（feat-034；阶段 C 端点已落地）────────────────────────────────────────────────
    // feat-047 打回复验对齐：manager 侧 ask 端点全部要求 owner_token header（404-on-mismatch，
    // 无枚举 oracle）。share/fetch 只有 askId——saveAsk 成功时记下 askId→context 映射，后续
    // 调用按它取 header。🔴 token 只进 header，绝不进 URL。
    // 未知 id 一律大声失败（与 feat-028 的 404 纪律同规格，绝不静默回落假数据）。
    async saveAsk(draft) {
      const res = await send('ask', `${base}/ask`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeader(draft.company_context_id),
        },
        body: JSON.stringify(draft),
      })
      if (!res.ok) throw transportError('ask', res)
      const saved = (await res.json()) as AskDraft
      rememberAskContext(saved.id, saved.company_context_id ?? draft.company_context_id)
      return saved
    },

    async shareAsk(askId) {
      const res = await send('ask share', `${base}/ask/${encodeURIComponent(askId)}/share`, {
        method: 'POST',
        headers: authHeader(askContexts[askId]),
      })
      if (!res.ok) throw transportError('ask share', res)
      return (await res.json()) as AskDraft
    },

    async fetchAsk(askId) {
      const res = await send('ask', `${base}/ask/${encodeURIComponent(askId)}`, {
        headers: authHeader(askContexts[askId]),
      })
      if (!res.ok) throw transportError('ask', res)
      return (await res.json()) as AskDraft
    },

    // feat-047 移植：按 context_id 拉取「你的文件」清单——header-only owner_token（缺/伪 token
    // → 后端 404，前端不静默回落）。
    async fetchFiles(contextId) {
      const res = await send('files', `${base}/team/${encodeURIComponent(contextId)}/files`, {
        headers: authHeader(contextId),
      })
      if (!res.ok) throw transportError('files', res)
      return (await res.json()) as LiveFilesPayload
    },

    // files-hub-0729/01 · 逐份下载。同 fetchFiles 的 header-only owner_token 纪律；
    // 后端以 `Content-Disposition: attachment` + `X-Content-Type-Options: nosniff` 发
    // application/octet-stream（bytes 是完全不可信的用户内容，浏览器绝不许内联渲染）。
    // 这里只把字节收成 Blob —— 文件名不从响应头里抠，用清单里那一份（同一个 filename，
    // 且已经在 UI 上给用户看过；抠 header 反而多一条要防注入的路径）。
    async downloadFile(contextId, idx) {
      const res = await send(
        'file download',
        `${base}/team/${encodeURIComponent(contextId)}/files/${encodeURIComponent(String(idx))}`,
        { headers: authHeader(contextId) },
      )
      if (!res.ok) throw transportError('file download', res)
      return await res.blob()
    },

    // feat-047 移植：按 context_id 拉取「Avery's notes」累积笔记——同上 header-only 纪律。
    async fetchNotes(contextId) {
      const res = await send('notes', `${base}/team/${encodeURIComponent(contextId)}/notes`, {
        headers: authHeader(contextId),
      })
      if (!res.ok) throw transportError('notes', res)
      return (await res.json()) as LiveNotesPayload
    },

    // issue #49 · 议事室历史——同上 header-only 纪律（owner_token 缺/错一律 404）。
    async fetchAdviseRuns(contextId) {
      const res = await send('history', `${base}/team/${encodeURIComponent(contextId)}/advise-runs`, {
        headers: authHeader(contextId),
      })
      if (!res.ok) throw transportError('history', res)
      return (await res.json()) as LiveAdviseRunsPayload
    },

    // issue #78 · 议事室历史**按场分组**——同一张门、同一个 endpoint 身份（'history'）。
    // ⚠ 空历史一定是 200 + `threads: []`；这里的 404 与上面那条一样只意味着 token 缺/错。
    async fetchAdviseThreads(contextId) {
      const res = await send(
        'history',
        `${base}/team/${encodeURIComponent(contextId)}/advise-threads`,
        { headers: authHeader(contextId) },
      )
      if (!res.ok) throw transportError('history', res)
      return (await res.json()) as LiveAdviseThreadsPayload
    },

    // ── 常驻表单（gap-design-0805 T3）——同上 header-only 纪律（owner_token 缺/错一律 404）。
    // 🔴 404 在这三条上**不是**「这家公司没有表单」：后端按"不泄露存在性"的规矩，把「不存在」
    // 与「你证明不了这是你的」编码成同一个 404（见 httpErrorMessage 的 staleToken 那段）。
    // 空清单只能来自 200 + `templates: []`，调用方不许从 404 推出空态。
    async fetchForms(contextId) {
      const res = await send('forms', `${base}/team/${encodeURIComponent(contextId)}/forms`, {
        headers: authHeader(contextId),
      })
      if (!res.ok) throw transportError('forms', res)
      return (await res.json()) as LiveFormsPayload
    },

    // 铸链。templateId 同样 encodeURIComponent——今天恒是 'tpl_weekly'，但经理自建的模板 id
    // 来自 new_template_id()，这里不赌它永远是 ASCII 安全串（同 downloadFile 连数字都编的先例）。
    async createFormLinks(contextId, templateId, input) {
      const res = await send(
        'form links',
        `${base}/team/${encodeURIComponent(contextId)}/forms/${encodeURIComponent(templateId)}/links`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeader(contextId) },
          body: JSON.stringify(input),
        },
      )
      if (!res.ok) throw transportError('form links', res)
      return (await res.json()) as FormLinksResult
    },

    async fetchFormSubmissions(contextId) {
      const res = await send(
        'form submissions',
        `${base}/team/${encodeURIComponent(contextId)}/forms/submissions`,
        { headers: authHeader(contextId) },
      )
      if (!res.ok) throw transportError('form submissions', res)
      return (await res.json()) as LiveFormSubmissionsPayload
    },

    // T9 · 作废一条还没交的链接。submissionId 同样 encodeURIComponent——它来自服务端的
    // `new_submission_id()`（'sub_' + hex），今天是 ASCII 安全串，但不赌它永远是。
    async voidFormSubmission(contextId, submissionId) {
      const res = await send(
        'form void',
        `${base}/team/${encodeURIComponent(contextId)}/forms/submissions/${encodeURIComponent(
          submissionId,
        )}/void`,
        { method: 'POST', headers: authHeader(contextId) },
      )
      if (!res.ok) throw transportError('form void', res)
      return (await res.json()) as FormVoidResult
    },

    // gap2 T11 · 拼装器写侧。这条与上面三条只读的不同：失败要能说清**哪一条**规则拦的，
    // 所以走 transportErrorDetailed（读 body 里那句 detail.reason）而不是 transportError。
    async saveFormTemplate(contextId, input) {
      const res = await send('form save', `${base}/team/${encodeURIComponent(contextId)}/forms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader(contextId) },
        body: JSON.stringify(input),
      })
      if (!res.ok) throw await transportErrorDetailed('form save', res)
      return ((await res.json()) as { template: LiveFormTemplate }).template
    },

    async draftFormFromFile(contextId, input) {
      const res = await send(
        'form draft',
        `${base}/team/${encodeURIComponent(contextId)}/forms/draft-from-file`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeader(contextId) },
          body: JSON.stringify(input),
        },
      )
      if (!res.ok) throw await transportErrorDetailed('form draft', res)
      return (await res.json()) as FormDraftResult
    },

    // ── 账号（feat-053）────────────────────────────────────────────────────────────────
    // 登录后恢复：本账号名下的 context id。未登录 → 后端 401 → 大声失败（不静默回落）。
    async fetchAccountContexts() {
      // feat-068：走 send() + transportError()，不再裸 fetch。这两条曾是 ZH-03 那个缺陷的
      // 最后残留——抛的是 `account contexts HTTP 401` 这种开发者串，中文用户读到的就是它。
      // 今天打不到（Supabase env 未配 → 登录入口不渲染），但配上 env 的那一刻就可达，
      // 所以先拆掉，别把雷留在开关背后。
      const res = await send('account contexts', `${base}/account/contexts`, { headers: accountHeader() })
      if (!res.ok) throw transportError('account contexts', res)
      return (await res.json()) as AccountContextsPayload
    },

    // 认领：把游客期建的 context 绑进本账号。owner_token 走 **body**——它是被交出的"标的"，
    // 不是授权本次调用的凭据（授权的是账号 header）。🔴 仍然绝不进 URL。
    async claimContext(contextId, ownerToken) {
      const res = await send('account claim', `${base}/account/claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...accountHeader() },
        body: JSON.stringify({ context_id: contextId, owner_token: ownerToken }),
      })
      if (!res.ok) throw transportError('account claim', res)
    },
  }
}

// 解析一条 SSE 记录（`event: <type>\n data: <json>` 或多行 data:）。
export function parseSseRecord(raw: string): LiveAgentEvent | null {
  let eventType = 'message'
  const dataLines: string[] = []
  for (const line of raw.split(/\r?\n/)) {
    if (line.startsWith(':')) continue // comment/heartbeat
    if (line.startsWith('event:')) {
      eventType = line.slice(6).trim()
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).replace(/^\s/, ''))
    }
  }
  if (dataLines.length === 0) return null
  try {
    const payload = JSON.parse(dataLines.join('\n')) as LiveAgentEvent
    // data JSON 自带 type（engine.py 每事件都放 type）；缺失时用 event: 行兜底。
    if (!payload.type && eventType !== 'message') {
      payload.type = eventType as LiveAgentEventType
    }
    return payload
  } catch {
    return null
  }
}
