// feat-017 · live 流源（The room 终端 + 8 字段卡）——ADR-0020 决策 2。
// feat-024（ADR-0022 决策 1）：立墙后本文件属 lite 壳——类型全部 lite 本地
// （与 story 终端行同形，但**不 import story**；story 的 StreamLine 留在 story/data/cases.ts）。
//
// LiveAgentSource：调 feat-015 /advise SSE，把 think/tool/observe 事件映射成终端行，
// manifest.advice 映射成 8 字段 LiteAdvice（服务端 contract.py 已投影 + 重跑红线）。

import type { LiveAgentEvent, LiveTransport, AdviseRequest } from './transport'

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
  contractOk: boolean | null
  redlinePassed: boolean | null
  error: string | null
}

export function emptyRunState(): LiveRunState {
  return {
    status: 'idle',
    lines: [],
    advice: null,
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
