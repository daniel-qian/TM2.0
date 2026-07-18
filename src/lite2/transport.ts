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

  // feat-047 移植：按 context_id 拉取「你的文件」清单（feat-032 file space；重启后仍在）。
  fetchFiles: (contextId: string) => Promise<LiveFilesPayload>

  // feat-047 移植：按 context_id 拉取「Avery's notes」累积笔记（feat-033；只读、新→旧、重启后仍在）。
  fetchNotes: (contextId: string) => Promise<LiveNotesPayload>
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
  if (status === 413) return `${name}: too much at once — the server caps 10 files, 10MB each.`
  if (status === 415 || status === 422)
    return `${name}: that file type isn't accepted, or its contents couldn't be read.`
  // 🔴 404 在已鉴权的读路径上几乎从不是"空"——是这台浏览器手里的 owner_token 缺失/过期，
  // 后端按"不泄露存在性"的规矩回 404 而不是 403。说成"没有数据"会让人白等一场。
  if (status === 404)
    return `${name}: not found — your access token for this company is missing or stale (not "no data yet").`
  if (status >= 500) return `${name}: the server hit a problem (HTTP ${status}). Try again shortly.`
  return `${name} failed — HTTP ${status}.`
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

function loadTokenStore(): Record<string, string> {
  try {
    if (typeof localStorage === 'undefined') return {}
    const raw = localStorage.getItem(TOKEN_STORE_KEY)
    return raw ? (JSON.parse(raw) as Record<string, string>) : {}
  } catch {
    return {}
  }
}

function persistTokenStore(store: Record<string, string>): void {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(TOKEN_STORE_KEY, JSON.stringify(store))
  } catch {
    /* private-mode / quota — in-memory map still carries the token for this session */
  }
}

// ── 真 HTTP/SSE 传输（浏览器 fetch + 流式解析）──────────────────────────────────────────
// 用 fetch + ReadableStream 手解 SSE（而非 EventSource）：POST body + Abort 都需要，EventSource 只支持 GET。
export function createHttpTransport(base: string = apiBase()): LiveTransport {
  // Per-context owner_token map, seeded from localStorage so a page reload keeps the credential.
  const tokens: Record<string, string> = loadTokenStore()
  const rememberToken = (contextId: string | undefined, token: string | undefined): void => {
    if (!contextId || !token) return
    tokens[contextId] = token
    persistTokenStore(tokens)
  }
  // 🔴 header-only：给某 context 的读/写调用附上 owner_token（有则带，无则空），绝不进 URL。
  const authHeader = (contextId: string | undefined): Record<string, string> => {
    const tok = contextId ? tokens[contextId] : undefined
    return tok ? { [OWNER_TOKEN_HEADER]: tok } : {}
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
      const res = await send('ingest', `${base}/ingest`, { method: 'POST', body: form })
      if (!res.ok) throw new Error(httpErrorMessage('ingest', res))
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
