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
import { getDict, resolveLocale } from '../shared/i18n'

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
  //   缺省 / 'advice'  → advice = 8 字段 AgentOutput 契约 payload（现有消费者零破坏）
  //   'ask-draft'      → ask = AskDraft 形状（agent 起草的 Quick ask，等 manager 确认）
  kind?: 'advice' | 'ask-draft'
  advice?: unknown
  ask?: unknown
  contract_ok?: boolean
  redline_passed?: boolean
  schema_ok?: boolean
  // error
  error?: string
  // 允许后端附带额外字段而不破类型
  [key: string]: unknown
}

export interface AdviseRequest {
  situation: string
  title?: string
  company_context_id?: string
}

// ── ingestion 契约（feat-016 registry.py 的 dict 形状，经 feat-018 HTTP 暴露）──────────────
// 严格对齐 CompanyContext.team_cards()/project_cards()/briefing()/signal_cards()。
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
}

// 人卡：定性 ONLY。🔴 红线：moodPct/capacityPct 等血条字段 live 永不出现——
// 类型里根本不给这些键留位置（结构性护栏），LiveTeamSource 再做一次运行时剥离兜底。
export interface LivePersonCard {
  id: string
  name: string
  role?: string
  team?: string
  tenure?: string
  owns?: string[]
  // team_cards() 发的是 list[str]（PersonEntity.collaboration）。feat-023 的 LLM 抽取第一次
  // 真的填了它，暴露此处曾误写 string（heuristic 从不产 collaboration，一直潜伏到 gate 抓到）。
  collaboration?: string[]
}

export interface LiveProjectCard {
  id: string
  title: string
  ownerId?: string
  ownerName?: string
  status?: string
  progress?: number // 可量化（文档写了就抽）；risk 4 维/reportedStatus 缺信号 → 不出现
  dueDate?: string
  summary?: string
  blockers?: string[]
}

// feat-056 决策定级契约。口径真源在后端 `eval-harness/avery/decision_rules.py`，
// 人类可读说明在 `eval-harness/decision_grading_rules.md`（客户问"凭什么高风险"就给他看那份）。
// 🔴 等级只由后端规则决定；前端不得自行判级、不得改写 grade。
export type LiveDecisionGrade = 'high_risk' | 'needs_confirmation' | 'can_proceed'

export interface LiveDecisionRuleHit {
  rule_id: string // 如 'R-BLOCKER-STACK' —— 可引用编号，展开时逐条列给经理
  grade: LiveDecisionGrade
  grade_label: string // 高风险 / 需确认 / 可推进
  severity: number // 3 / 2 / 1
  title: string // 这条规则说的是什么（中文一行）
  basis: string // 依据哪些字段（可审计）
  evidence: string[] // 原文证据，verbatim —— 原样展示，不要转述
}

// 文档写了、但后端解析不出一个可比较的值的字段。raw 是**文档原文**，原样展示。
export interface LiveDecisionUnparsedField {
  field: string // 'dueDate' 等机器键
  field_label: string // 中文字段名，如「到期日」——用户面显示这个
  raw: string // 文档里原本写的那几个字，如「月底前」
}

export interface LiveDecisionCard {
  subject_type: 'project' // 当前只有项目型；留着以便后续扩人/任务
  subject_id: string
  subject_title: string
  owner_name: string
  grade: LiveDecisionGrade // 最终等级（= rule_grade，除非 Avery 合法上调）
  grade_label: string
  severity: number // 排序键：3 高风险 / 2 需确认 / 1 可推进
  rule_grade: LiveDecisionGrade // 规则原判，永远保留，可对账
  rule_grade_label: string
  rule_severity: number
  matched_rules: LiveDecisionRuleHit[] // 永不为空 —— 每条决策都能展开看到命中了哪条规则
  // 🔴 文档**确实没写**的字段（'status' | 'progress' | 'dueDate'）。界面必须显示「文档未提及」，
  // 绝不能渲染成 0% 或空白 —— "文档没说"不等于"没风险"。
  unknown_fields: string[]
  // 🔴 文档**写了、但后端读不准**的字段，与 unknown_fields 互斥（一个字段只会出现在其中一个里）。
  // 界面必须把原文摆出来，例如「到期日写的是『月底前』，无法确定具体日期」——
  // 绝不能把这些说成「文档未提及」：客户手上就有原件，说他没写等于当场自证不可信。
  unparsed_fields: LiveDecisionUnparsedField[]
  reason: string // 那句人话理由
  reason_source: 'rule' | 'avery' // rule = 机械拼装可溯源；avery = 模型写的
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
  source?: string
  subjectType: 'person' | 'project' | 'task'
  subjectId: string
  summary: string
  tag?: string
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
  link?: string // https://avery.ima-read.com/r/{token}（服务端拼好整链，域名归属后端）
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
export interface LiveFileEntry {
  idx: number
  filename: string
  size_bytes: number
  mime: string
  doc_kind: string
  uploaded_at: string
  n_chunks: number
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

// ── 传输接口：seam 只认这个，AFK 门注入确定性 stub ─────────────────────────────────────
export interface LiveTransport {
  // 打开 /advise SSE，逐事件回调；返回一个可 abort 的 handle。
  streamAdvise: (
    req: AdviseRequest,
    onEvent: (event: LiveAgentEvent) => void,
    onDone: (error?: Error) => void,
  ) => { abort: () => void }

  // 上传文件 → ingestion → context_id + 首帧 Your team 结构。
  ingest: (files: File[]) => Promise<LiveTeamPayload>

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

  // feat-047 移植：按 context_id 拉取「Avery's notes」累积笔记（feat-033；只读、新→旧、重启后仍在）。
  fetchNotes: (contextId: string) => Promise<LiveNotesPayload>

  // ── 账号（feat-053）。可选实现：stub transport 不提供，调用方须判空 ──────────────────
  // 🔴 可选（`?:`）是刻意的——LiveTransport 有第二个实现（stubTransport，AFK 门/离线演示），
  // 加必填方法会让它编译不过。账号是**联网后端能力**，stub 天然没有，判空即降级成游客。
  // 本账号登记在案的公司 context（登录后恢复用）。
  fetchAccountContexts?: () => Promise<AccountContextsPayload>
  // 把匿名 context 认领进本账号（凭 owner_token 证明所有权）。
  claimContext?: (contextId: string, ownerToken: string) => Promise<void>
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
// useDict 自己内部就在用的那条**非 hook 路径**：getDict(resolveLocale())。
//   · 两者都是纯函数，shared/i18n/index.ts 不 import React——本模块因此仍然零 React 依赖。
//   · 和 useDict 同一条 locale 解析（?lang= > VITE_AVERY_LOCALE > en），传输层文案和界面
//     文案不可能各说各的语言。
// 没选"把 resolver 当参数传进来"：那要改 LiveTransport seam，并让 AFK 门的 stub transport
// 也背一个它不需要的参数。也没选"抛结构化错误、让 UI 自己本地化"：那要求每个消费者
// （UploadPanel / OnboardWizard / RoomScreen / ask 链）各写一份 status→key 的 switch，四份
// 拷贝迟早分叉。TransportError 把后者的**好处**单独拿了过来——见下。
export function httpErrorMessage(res?: Response): string {
  const t = getDict(resolveLocale()).transport
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

  constructor(message: string, endpoint: string, status?: number) {
    super(message)
    this.name = 'TransportError'
    this.endpoint = endpoint
    this.status = status
  }
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
            body: JSON.stringify({ ...req, stream: true }),
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

    async fetchTeam(contextId) {
      const res = await send('team', `${base}/team/${encodeURIComponent(contextId)}`, {
        headers: authHeader(contextId),
      })
      if (!res.ok) throw transportError('team', res)
      return (await res.json()) as LiveTeamPayload
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

    // feat-047 移植：按 context_id 拉取「Avery's notes」累积笔记——同上 header-only 纪律。
    async fetchNotes(contextId) {
      const res = await send('notes', `${base}/team/${encodeURIComponent(contextId)}/notes`, {
        headers: authHeader(contextId),
      })
      if (!res.ok) throw transportError('notes', res)
      return (await res.json()) as LiveNotesPayload
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
