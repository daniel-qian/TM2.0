// feat-017 · live 流源（The room 终端 + 8 字段卡）——ADR-0020 决策 2。
// feat-024（ADR-0022 决策 1）：立墙后本文件属 lite 壳——类型全部 lite 本地
// （与 story 终端行同形，但**不 import story**；story 的 StreamLine 留在 story/data/cases.ts）。
//
// LiveAgentSource：调 feat-015 /advise SSE，把 think/tool/observe 事件映射成终端行，
// manifest.advice 映射成 8 字段 LiteAdvice（服务端 contract.py 已投影 + 重跑红线）。

import type {
  AdviseRequest,
  AskDraft,
  AskQuestion,
  AskReceipt,
  AskRecipient,
  AskStatus,
  LiveAgentEvent,
  LiveTransport,
} from './transport'

// ── lite 终端行（与 story 终端同 CSS chrome，类型独立）───────────────────────
export type LiteSpeaker = 'agent' | 'tool' | 'system'
export type LiteLineType = 'thought' | 'tool-call' | 'tool-result' | 'manifest'

export interface LiteStreamLine {
  speaker: LiteSpeaker
  type: LiteLineType
  text: string
  key: string
}

// ── 8 字段 advice 契约（feat-015 manifest.advice；对齐 service/contract.py 投影）──
// 🔴 红线：没有任何"人评分"槽位——诊断是对处境的 hypothesis，不是对人的裁决。
export interface LiteAdvice {
  summary: string
  detected_signals: string[]
  diagnosis_hypotheses: { label: string; kind: 'primary' | 'alternative' }[]
  evidence: string[]
  recommended_actions: string[]
  confidence: {
    level: 'low' | 'medium' | 'high'
    rationale: string
    wouldChange: string[]
  }
  escalation: {
    level: 'none' | 'HRBP' | 'legal' | 'wellbeing' | 'compensation' | 'executive'
    note: string
    confirmWith: string[]
  }
  metrics_to_track: string[]
  conversation_script: string
}

// 一次 live 运行的快照（LiveAgentSource 逐事件累积，供终端 + 卡渲染）。
export interface LiveRunState {
  status: 'idle' | 'running' | 'complete' | 'error'
  lines: LiteStreamLine[] // 逐拍累积的终端流行
  advice: LiteAdvice | null // manifest.advice（8 字段）——ready 后填
  // feat-034：manifest{kind:'ask-draft'} 落进来的 Quick ask 草稿（出生帧）。
  // 后续编辑/分享/回执的活体状态归 store 持有——这里只是"流里出生了一张草稿"的快照。
  askDraft: AskDraft | null
  contractOk: boolean | null
  redlinePassed: boolean | null
  error: string | null
}

export function emptyRunState(): LiveRunState {
  return {
    status: 'idle',
    lines: [],
    advice: null,
    askDraft: null,
    contractOk: null,
    redlinePassed: null,
    error: null,
  }
}

// ── LiveAgentSource：持有 transport，逐事件把 SSE 转成终端行 + LiteAdvice。──
export interface LiveAgentSource {
  readonly kind: 'live'
  run: (
    req: AdviseRequest,
    onUpdate: (state: LiveRunState) => void,
  ) => { abort: () => void }
}

export function createLiveAgentSource(transport: LiveTransport): LiveAgentSource {
  return {
    kind: 'live',
    run(req, onUpdate) {
      const state = emptyRunState()
      state.status = 'running'
      let seq = 0
      const emit = () => onUpdate({ ...state, lines: [...state.lines] })

      const push = (speaker: LiteSpeaker, type: LiteLineType, text: string) => {
        if (!text || !text.trim()) return
        state.lines.push({ speaker, type, text, key: `live-${seq++}` })
      }

      emit() // 首帧：running 空态（终端立即显"running ▌"）

      const handle = transport.streamAdvise(
        req,
        (ev: LiveAgentEvent) => {
          applyEvent(state, ev, push)
          emit()
        },
        (error) => {
          if (error) {
            state.status = 'error'
            state.error = error.message
          } else if (state.status !== 'error' && state.status !== 'complete') {
            // 流正常结束但没 manifest（罕见）——收成 complete，避免卡在 running。
            state.status = 'complete'
          }
          emit()
        },
      )
      return handle
    },
  }
}

// 把单个 SSE 事件折进运行态（纯函数副作用限定在 state + push）。导出供 AFK 门直接断言映射正确。
export function applyEvent(
  state: LiveRunState,
  ev: LiveAgentEvent,
  push: (speaker: LiteSpeaker, type: LiteLineType, text: string) => void,
): void {
  switch (ev.type) {
    case 'started':
      // 元数据帧——不落终端行（question 首行由 RoomScreen 从提问态派生）。
      break
    case 'think':
      // 真 agent 用泛 'agent'（display "AVERY"）——单 agent 不冒充多专家。
      push('agent', 'thought', ev.text ?? '')
      break
    case 'tool':
      push('agent', 'tool-call', formatToolCall(ev.name, ev.input))
      break
    case 'observe':
      push('tool', 'tool-result', ev.observation ?? '')
      break
    case 'nudge':
      // gate 把模型推回——system 行提示（人话，不暴露 rule id）。
      push('system', 'thought', nudgeText(ev.gate))
      break
    case 'manifest': {
      // feat-034 契约提案：可选判别字段 kind（缺省 = advice，现有路径零破坏）。
      if (ev.kind === 'ask-draft') {
        const draft = coerceAskDraft(ev.ask)
        if (draft) {
          state.askDraft = draft
          push('system', 'manifest', 'A quick ask is drafted — yours to confirm')
        }
        // ask-draft 帧不判 run 完成——advice 帧（或流自然收尾）才收 status。
        break
      }
      const advice = coerceAdvice(ev.advice)
      state.advice = advice
      state.contractOk = ev.contract_ok ?? null
      state.redlinePassed = ev.redline_passed ?? null
      push('system', 'manifest', advice ? 'The read is ready' : 'Done')
      state.status = 'complete'
      break
    }
    case 'error':
      state.status = 'error'
      state.error = ev.error ?? 'unknown error'
      push('system', 'thought', 'Something went wrong reaching the room.')
      break
    default:
      break
  }
}

function formatToolCall(name: string | undefined, input: Record<string, unknown> | undefined): string {
  if (!name) return 'tool call'
  const arg =
    input && typeof input === 'object'
      ? Object.entries(input)
          .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
          .join(' ')
      : ''
  return arg ? `${name} ${arg}` : name
}

function nudgeText(gate: 'chain' | 'redline' | undefined): string {
  if (gate === 'redline') return 'Re-checking so nobody gets labelled — describing the work instead.'
  return 'Grounding the answer in the evidence before drafting it.'
}

// manifest.advice 可能来自真后端——做防御性形状归一，缺字段补空（终端仍渲染，卡按有的字段显）。
export function coerceAdvice(raw: unknown): LiteAdvice | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const strArr = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  const confidence = (r.confidence ?? {}) as Record<string, unknown>
  const escalation = (r.escalation ?? {}) as Record<string, unknown>
  const level = confidence.level
  const escLevel = escalation.level
  return {
    summary: typeof r.summary === 'string' ? r.summary : '',
    detected_signals: strArr(r.detected_signals),
    diagnosis_hypotheses: Array.isArray(r.diagnosis_hypotheses)
      ? (r.diagnosis_hypotheses as unknown[])
          .filter((h): h is Record<string, unknown> => !!h && typeof h === 'object')
          .map((h) => ({
            label: typeof h.label === 'string' ? h.label : '',
            kind: h.kind === 'primary' ? ('primary' as const) : ('alternative' as const),
          }))
      : [],
    evidence: strArr(r.evidence),
    recommended_actions: strArr(r.recommended_actions),
    confidence: {
      level: level === 'low' || level === 'medium' || level === 'high' ? level : 'medium',
      rationale: typeof confidence.rationale === 'string' ? confidence.rationale : '',
      wouldChange: strArr(confidence.wouldChange),
    },
    escalation: {
      level:
        escLevel === 'none' ||
        escLevel === 'HRBP' ||
        escLevel === 'legal' ||
        escLevel === 'wellbeing' ||
        escLevel === 'compensation' ||
        escLevel === 'executive'
          ? escLevel
          : 'none',
      note: typeof escalation.note === 'string' ? escalation.note : '',
      confirmWith: strArr(escalation.confirmWith),
    },
    metrics_to_track: strArr(r.metrics_to_track),
    conversation_script: typeof r.conversation_script === 'string' ? r.conversation_script : '',
  }
}

// manifest{kind:'ask-draft'}.ask 的防御性形状归一（与 coerceAdvice 同规格）。
// 契约硬边界（PRD Q5 / ADR-0023 / 阶段 C F1+F3 收紧）：
//   · 题数 >3、未知题型、值域外回执（99 "out of 5"、yesno 收到数字）→ 返回 null，
//     **宁可不出卡**，绝不出一张半坏/静默改形的卡（F3：不再截断、不再折 scale）。
//   · status 词表 = 服务端六词（draft|shared|collecting|closed|revoked|expired）；
//     未知词一律折 **closed**——绝不折 draft，否则已发出/已撤回的 ask 会以可编辑草稿复活（F1）。
//   · 回执只存在于 recipients[].receipt——没有任何可挂到"人"身上的槽位（结构性红线）。
export function coerceAskDraft(raw: unknown): AskDraft | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (typeof r.id !== 'string' || !r.id) return null

  if (!Array.isArray(r.questions)) return null
  const rawQuestions = (r.questions as unknown[]).filter(
    (q): q is Record<string, unknown> => !!q && typeof q === 'object',
  )
  if (rawQuestions.length !== (r.questions as unknown[]).length) return null // 非对象题项 = 坏形状
  if (rawQuestions.length > 3) return null // F3：超题数不出卡（不再静默截断）
  const questions: AskQuestion[] = []
  for (let i = 0; i < rawQuestions.length; i++) {
    const q = rawQuestions[i]
    if (q.kind !== 'scale' && q.kind !== 'yesno') return null // F3：未知题型不出卡（不再折 scale）
    const text = typeof q.text === 'string' ? q.text : ''
    if (!text.trim()) continue // 空题文照旧丢弃（阶段 B 行为，不算毒形状）
    questions.push({
      id: typeof q.id === 'string' && q.id ? q.id : `q${i + 1}`,
      kind: q.kind,
      text,
    })
  }
  if (questions.length < 1) return null
  const kindById = new Map(questions.map((q) => [q.id, q.kind]))

  const recipients: AskRecipient[] = []
  const rawRecipients = Array.isArray(r.recipients)
    ? (r.recipients as unknown[]).filter(
        (x): x is Record<string, unknown> => !!x && typeof x === 'object',
      )
    : []
  for (let i = 0; i < rawRecipients.length; i++) {
    const x = rawRecipients[i]
    const name = typeof x.name === 'string' ? x.name : ''
    if (!name.trim()) continue
    const receipt = coerceAskReceipt(x.receipt, kindById)
    if (receipt === 'poisoned') return null // F3：值域外/错型回执 = 整卡不出
    recipients.push({
      id: typeof x.id === 'string' && x.id ? x.id : `r${i + 1}`,
      name,
      token: typeof x.token === 'string' ? x.token : undefined,
      link: typeof x.link === 'string' ? x.link : undefined,
      receipt,
    })
  }

  // F1：已知六词原样保留；未知词折 closed（fail-safe 方向 = 不可编辑、不可再分享）。
  const status: AskStatus =
    r.status === 'draft' ||
    r.status === 'shared' ||
    r.status === 'collecting' ||
    r.status === 'closed' ||
    r.status === 'revoked' ||
    r.status === 'expired'
      ? r.status
      : 'closed'

  return {
    id: r.id,
    status,
    questions,
    recipients,
    comment_prompt: typeof r.comment_prompt === 'string' ? r.comment_prompt : undefined,
    company_context_id:
      typeof r.company_context_id === 'string' ? r.company_context_id : undefined,
    created_at: typeof r.created_at === 'string' ? r.created_at : undefined,
    expires_at: typeof r.expires_at === 'string' ? r.expires_at : undefined,
    receipts_summary: typeof r.receipts_summary === 'string' ? r.receipts_summary : undefined,
  }
}

// 回执归一：undefined = 没有回执；'poisoned' = 回执存在但值域/类型对不上它的题——
// F3 收紧后由调用方把整卡打回 null（渲染 "99 out of 5" 是对证据的歪曲，宁可不渲染）。
function coerceAskReceipt(
  raw: unknown,
  kindById: Map<string, AskQuestion['kind']>,
): AskReceipt | undefined | 'poisoned' {
  if (!raw || typeof raw !== 'object') return undefined
  const r = raw as Record<string, unknown>
  if (!Array.isArray(r.answers)) return undefined
  const answers: { question_id: string; value: number | boolean }[] = []
  for (const a of r.answers as unknown[]) {
    if (!a || typeof a !== 'object') return 'poisoned'
    const rec = a as Record<string, unknown>
    const qid = typeof rec.question_id === 'string' ? rec.question_id : ''
    const kind = kindById.get(qid)
    if (!kind) return 'poisoned' // 回执答了一道不存在的题
    const v = rec.value
    if (kind === 'scale') {
      if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > 5) return 'poisoned'
    } else {
      if (typeof v !== 'boolean') return 'poisoned'
    }
    answers.push({ question_id: qid, value: v })
  }
  if (answers.length === 0) return undefined
  return {
    answers,
    comment: typeof r.comment === 'string' && r.comment.trim() ? r.comment : undefined,
    answered_at: typeof r.answered_at === 'string' ? r.answered_at : '',
  }
}

// 阶段 C 门缝：把防御性 coerce 暴露给 live-frontend-gate 的 F1/F3 相位直接断言
// （门是唯一消费者；产品代码不读它）。
if (typeof window !== 'undefined') {
  ;(window as unknown as Record<string, unknown>).__liteAsk = { coerceAskDraft }
}
