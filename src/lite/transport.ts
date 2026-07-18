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
  // feat-038 租户隔离：/ingest 首帧回传本公司的不可猜 owner_token（经理凭据）。
  // 客户端存下（按 context_id）、后续所有读端点（team/files/notes/advise）以 HTTP header 带上。
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

// ── file space（feat-032：GET /team/{id}/files 清单契约）─────────────────────────────────────
// 每公司「你的文件」薄清单：回看上传过哪些材料、Avery 的记忆基于什么（User Story 4）。
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

// ── Avery's notes（feat-033：GET /team/{id}/notes 契约）──────────────────────────────────────
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
  // 撤回作废（PRD Q8；阶段 C 端点已落）。closed 后不可撤——服务端 409 大声失败。
  revokeAsk: (askId: string) => Promise<AskDraft>

  // 阶段 C F2（demo 诚实性）：离线预览通道（stub）自我声明——shared 态的链接不可真开，
  // UI 据此加"离线预览"标注。真 HTTP transport 恒缺省（undefined = 链接是真的）。
  readonly offlinePreview?: boolean

  // 按 context_id 拉取「你的文件」清单（feat-032 file space；重启后仍在）。
  fetchFiles: (contextId: string) => Promise<LiveFilesPayload>

  // 按 context_id 拉取「Avery's notes」累积笔记（feat-033；只读、新→旧、重启后仍在）。
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
 * 原样贴在中文标题下面的（lite/UploadPanel.tsx、lite2/OnboardWizard.tsx 都这么渲染），
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

// ── feat-038 租户隔离：owner_token 客户端存储（按 context_id）─────────────────────────────────
// /ingest 首帧回传 owner_token；transport 存下，后续 team/files/notes/advise 以 header 带上。
// 落 localStorage 让一次会话内刷新页面仍持有 token（后端持久化让数据本身也还在）。
// 🔴 token 只进 header，绝不拼进 URL；读/写失败静默降级（不阻断主流程）。
const TOKEN_STORE_KEY = 'avery.ownerTokens'
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
  // 阶段 C：askId → company_context_id（saveAsk 成功时记下），share/fetch/revoke 据此带
  // owner_token header。进程内即可——ask 卡与 run 同生命周期，刷新后重新走 saveAsk。
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
              ...authHeader(req.company_context_id), // feat-038: tenant token (header only)
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
      const res = await send('ingest', `${base}/ingest`, { method: 'POST', body: form })
      if (!res.ok) throw transportError('ingest', res)
      const payload = (await res.json()) as LiveTeamPayload
      // feat-038: store this company's owner_token so every later read/advise can present it.
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
    // feat-038 对齐（阶段 C 对接契约）：manager 侧 ask 端点全部要求 owner_token header
    //（404-on-mismatch，无枚举 oracle）。share/fetch/revoke 只有 askId——saveAsk 成功时
    // 记下 askId→context 映射，后续调用按它取 header。🔴 token 只进 header，绝不进 URL。
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

    async revokeAsk(askId) {
      const res = await send('ask revoke', `${base}/ask/${encodeURIComponent(askId)}/revoke`, {
        method: 'POST',
        headers: authHeader(askContexts[askId]),
      })
      if (!res.ok) throw transportError('ask revoke', res)
      return (await res.json()) as AskDraft
    },

    async fetchFiles(contextId) {
      const res = await send('files', `${base}/team/${encodeURIComponent(contextId)}/files`, {
        headers: authHeader(contextId),
      })
      if (!res.ok) throw transportError('files', res)
      return (await res.json()) as LiveFilesPayload
    },

    async fetchNotes(contextId) {
      const res = await send('notes', `${base}/team/${encodeURIComponent(contextId)}/notes`, {
        headers: authHeader(contextId),
      })
      if (!res.ok) throw transportError('notes', res)
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
