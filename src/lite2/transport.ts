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
// fixB/M4：后端每份文件都带 `status`，前端类型里一直没有这个键，界面也就永远不显示它。
// 后果不是少一个徽章——是**读进去了和没读进去长得一模一样**：一份扫描版 PDF 一个字都没抽出来，
// 和一份读全了的花名册在「你的文件」里像素级相同，headline 还照样说「Ingested 1 file(s)」。
// 🔴 三个词的口径由后端 registry.SourceDocument.status 定，前端不得自行判定、不得改写：
//   'ingested' 真读进去了并产出了引用 · 'empty' 解析成功但没抽到内容（扫描件/空表）
//   'failed'   根本没解析成（编码不认、格式不认、库缺）
// optional + 兜底 string：老后端不发这个键，stub transport 也不发——缺席时界面显示「未知」，
// 绝不默认当成 ingested（"我没读到" 和 "客户说没有" 是两件事，这里是同一条纪律的下游）。
export type LiveFileStatus = 'ingested' | 'empty' | 'failed'

export interface LiveFileEntry {
  idx: number
  filename: string
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

// ── feat-068：HTTP 状态码 → 人话 ───────────────────────────────────────────────────────
// 上线前每个失败点都是 `throw new Error(\`ingest HTTP ${res.status}\`)`，被限流的经理读到的是
// 「读不出这些文件 — ingest HTTP 429」。生产护栏是真的会跳的：/ingest 10/min(burst 3)、
// /advise 30/min(burst 10) → 429；超上传上限 → 413；魔数嗅探不认 → 415/422；owner_token
// 缺/错 → 404（后端故意不发 403，避免把"这个 context 存在"泄露出去）。
// 本函数是**传输层兜底文案**：英文、短句（i18n 词典另有其人，调用方可覆盖）；endpoint 名保留
// 在句首，线上排查仍能一眼分辨是哪一次调用。
export function httpErrorMessage(name: string, res?: Response): string {
  // 配错的构建：一切失败都先说这句。否则"打不通"会被一路误读成服务器故障。
  if (apiBaseMisconfigured()) {
    return `${name} failed — this build is misconfigured: VITE_AVERY_API_BASE was not set, so calls go to ${LOCAL_API_BASE}.`
  }
  // 没有 Response = fetch 自己 reject 了（连接被拒 / 混合内容拦截 / CORS / 离线），无 status 可读。
  if (!res) return `${name} failed — couldn't reach the server. Check your connection and try again.`
  const status = res.status
  if (status === 429) {
    const wait = retryAfterSeconds(res)
    return wait
      ? `${name}: too many requests — wait ${wait}s and try again.`
      : `${name}: too many requests — wait a moment and try again.`
  }
  // fixB/M2：这里曾经写死「the server caps 10 files, 10MB each」——**两个数字都是错的**
  // （真值 15 个文件 / 每个 8 MiB，见 avery/ingest/guards.py）。更糟的是单文件那个数字比真上限
  // 还大，用户照着它压到 10MB 重试，永远撞同一堵墙。第三份副本已经删掉：真值只有服务端知道，
  // 服务端在 413 的 body 里会说清楚（service/upload_guard.py 的 human_bytes 已经把它讲成人话），
  // 由 withServerDetail() 原样转达。本函数只负责「哪一步、什么性质」，绝不复述任何上限数字。
  if (status === 413) return `${name}: too much at once — the server refused this upload as over its limit.`
  if (status === 415 || status === 422)
    return `${name}: that file type isn't accepted, or its contents couldn't be read.`
  // 🔴 404 在已鉴权的读路径上几乎从不是"空"——是这台浏览器手里的 owner_token 缺失/过期，
  // 后端按"不泄露存在性"的规矩回 404 而不是 403。说成"没有数据"会让人白等一场。
  if (status === 404)
    return `${name}: not found — your access token for this company is missing or stale (not "no data yet").`
  if (status >= 500) return `${name}: the server hit a problem (HTTP ${status}). Try again shortly.`
  return `${name} failed — HTTP ${status}.`
}

// ── fixB/B1+M2：把**服务端自己的说法**带到用户眼前 ────────────────────────────────────────
//
// 两条修复共用这一个出口，因为它们是同一个病：前端在替服务端编话。
//   · M2：上限的真值只有服务端知道（guards.max_files/max_file_bytes）。前端复述 = 第三份副本 =
//     迟早又错一次。服务端的 413 body 里已经写好人话上限，照抄即可。
//   · B1：一份 GB18030 的花名册读不进去时，服务端现在会说「这份文件的字节在我们试过的编码里都
//     不合法……请另存为 UTF-8」。这句诊断是用户唯一能自救的线索——它必须走到界面上，
//     而不是被压成一句笼统的「that file type isn't accepted」。
//
// 🔴 body 里的内容（含文件名）是**不可信数据**：只当文本显示，绝不解析、绝不当指令。React 默认
// 转义，再加长度截断防止一屏红字。读 body 失败一律吞掉——它只是锦上添花，绝不能把一次
// 「服务端说了什么」的好奇心变成第二个错误。
const SERVER_DETAIL_MAX = 400

function pickDetailText(body: unknown): string | null {
  if (typeof body === 'string') return body
  if (!body || typeof body !== 'object') return null
  const b = body as Record<string, unknown>
  // FastAPI 的 HTTPException(detail=...) 包在 `detail` 下；ASGI 中间件直接发平铺的 {error, detail}。
  const parts: string[] = []
  const detail = b.detail
  if (typeof detail === 'string') parts.push(detail)
  else if (detail && typeof detail === 'object') {
    const d = detail as Record<string, unknown>
    for (const key of ['detail', 'reason']) {
      if (typeof d[key] === 'string') parts.push(d[key] as string)
    }
    // 422「no parseable content」时，逐份文件的失败原因在这里——B1 的编码诊断就在其中。
    if (Array.isArray(d.parse_errors)) {
      parts.push(...d.parse_errors.filter((e): e is string => typeof e === 'string'))
    }
  } else if (typeof b.detail === 'undefined' && typeof b.error === 'string') {
    parts.push(b.error)
  }
  const text = parts.join(' ').trim()
  return text || null
}

/**
 * 在传输层兜底文案后面，附上服务端自己给的解释（有就附，没有就算）。
 * 🔴 会消耗 Response body，所以只在**失败路径**上调用（那条路径不会再读 body）。
 */
export async function withServerDetail(name: string, res: Response): Promise<string> {
  const base = httpErrorMessage(name, res)
  try {
    const body = await res.json()
    const detail = pickDetailText(body)
    if (!detail) return base
    const trimmed =
      detail.length > SERVER_DETAIL_MAX ? `${detail.slice(0, SERVER_DETAIL_MAX)}…` : detail
    return `${base} ${trimmed}`
  } catch {
    return base
  }
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
      throw new Error(httpErrorMessage(name))
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
            throw new Error(httpErrorMessage('advise', res))
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
      // fixB/M2+B1：上传是唯一会撞上 413（超上限）/ 415（格式）/ 422（读不出内容，含编码失败）
      // 的调用，也是唯一一处「服务端知道确切原因、用户照着就能自救」的地方。所以这条路径把
      // 服务端的原话带出来，而不是只报一句分类。
      if (!res.ok) throw new Error(await withServerDetail('ingest', res))
      const payload = (await res.json()) as LiveTeamPayload
      // feat-047: store this company's owner_token so every later read/advise can present it.
      rememberToken(payload.context_id, payload.owner_token)
      return payload
    },

    async fetchTeam(contextId) {
      const res = await send('team', `${base}/team/${encodeURIComponent(contextId)}`, {
        headers: authHeader(contextId),
      })
      if (!res.ok) throw new Error(httpErrorMessage('team', res))
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
      if (!res.ok) throw new Error(httpErrorMessage('ask', res))
      const saved = (await res.json()) as AskDraft
      rememberAskContext(saved.id, saved.company_context_id ?? draft.company_context_id)
      return saved
    },

    async shareAsk(askId) {
      const res = await send('ask share', `${base}/ask/${encodeURIComponent(askId)}/share`, {
        method: 'POST',
        headers: authHeader(askContexts[askId]),
      })
      if (!res.ok) throw new Error(httpErrorMessage('ask share', res))
      return (await res.json()) as AskDraft
    },

    async fetchAsk(askId) {
      const res = await send('ask', `${base}/ask/${encodeURIComponent(askId)}`, {
        headers: authHeader(askContexts[askId]),
      })
      if (!res.ok) throw new Error(httpErrorMessage('ask', res))
      return (await res.json()) as AskDraft
    },

    // feat-047 移植：按 context_id 拉取「你的文件」清单——header-only owner_token（缺/伪 token
    // → 后端 404，前端不静默回落）。
    async fetchFiles(contextId) {
      const res = await send('files', `${base}/team/${encodeURIComponent(contextId)}/files`, {
        headers: authHeader(contextId),
      })
      if (!res.ok) throw new Error(httpErrorMessage('files', res))
      return (await res.json()) as LiveFilesPayload
    },

    // feat-047 移植：按 context_id 拉取「Avery's notes」累积笔记——同上 header-only 纪律。
    async fetchNotes(contextId) {
      const res = await send('notes', `${base}/team/${encodeURIComponent(contextId)}/notes`, {
        headers: authHeader(contextId),
      })
      if (!res.ok) throw new Error(httpErrorMessage('notes', res))
      return (await res.json()) as LiveNotesPayload
    },

    // ── 账号（feat-053）────────────────────────────────────────────────────────────────
    // 登录后恢复：本账号名下的 context id。未登录 → 后端 401 → 大声失败（不静默回落）。
    // fixB/m5：这两个端点曾是全 transport 仅有的两处**裸 fetch**——绕开 send()，也就绕开了
    // 「fetch 自己 reject 时没有 Response 可读」的那层包装。症状是：跨境/离线/混合内容被拦时
    // 抛出的是浏览器原文（`Failed to fetch`），而 api base 配错这个最常见的部署事故在这里
    // 完全说不出话。集成方修 ingest 那处时漏了这两个，一并收口——形状不变，只补错误文案。
    async fetchAccountContexts() {
      const res = await send('account contexts', `${base}/account/contexts`, {
        headers: accountHeader(),
      })
      if (!res.ok) throw new Error(httpErrorMessage('account contexts', res))
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
      if (!res.ok) throw new Error(httpErrorMessage('account claim', res))
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
