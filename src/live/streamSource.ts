// feat-017 · StreamSource seam（Nexus 终端 + Manifest 8 字段卡）——ADR-0020 决策 2。
//
// 终端组件只认这个接口；两实现：
//   * ScriptedStreamSource —— 现有 cases.ts stream（story mode），rail 回放机器原样，零改动。
//   * LiveAgentSource     —— 调 feat-015 /advise SSE（live mode），把 think/tool/observe 事件
//                            映射成同一套 StreamLine[]（终端 HUD 不需改），manifest.advice 映射
//                            成 8 字段 AgentOutput（结构化卡不需改）。
//
// 关键：live 复用 StreamLine / AgentOutput（现有数据契约），所以视觉组件一行不改就双模通用。

import type { StreamLine, StreamSpeaker, StreamLineType } from '../data/cases'
import type { AgentOutput } from '../data/fixtures'
import type { LiveAgentEvent, LiveTransport, AdviseRequest } from './transport'

// 一次 live 运行的快照（LiveAgentSource 逐事件累积，供终端 HUD + 卡渲染）。
export interface LiveRunState {
  status: 'idle' | 'running' | 'complete' | 'error'
  lines: StreamLine[] // 逐拍累积的终端流行（与 story 同形）
  advice: AgentOutput | null // manifest.advice（8 字段）——ready 后填
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

export interface StreamSource {
  readonly kind: 'scripted' | 'live'
}

// ── ScriptedStreamSource：story mode。cases.ts 就是它的数据；此实现只是一个 marker，
// NexusScene 的 story 路径（rail 回放 + deriveTerminalLines）原样工作，不经它取数。──
export const scriptedStreamSource: StreamSource = { kind: 'scripted' }

// ── event → StreamSpeaker 映射（feat-015 只有单 agent + tool + system；不冒充 PM/HR）──
function speakerForThink(agent: string | undefined): StreamSpeaker {
  // 真 agent 用泛 'agent'（display "AVERY"）——errand 单 agent 同款，不假装多专家。
  void agent
  return 'agent'
}

// ── LiveAgentSource：live mode。持有 transport，逐事件把 SSE 转成 StreamLine + AgentOutput。──
export interface LiveAgentSource extends StreamSource {
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

      const push = (speaker: StreamSpeaker, type: StreamLineType, text: string) => {
        if (!text || !text.trim()) return
        state.lines.push({ speaker, type, text, key: `live-${seq++}` } as StreamLine & { key: string })
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
  push: (speaker: StreamSpeaker, type: StreamLineType, text: string) => void,
): void {
  switch (ev.type) {
    case 'started':
      // 元数据帧——不落终端行（question 首行由 NexusScene 从 thread 派生，同 story）。
      break
    case 'think':
      push(speakerForThink(ev.agent), 'thought', ev.text ?? '')
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
      const advice = coerceAgentOutput(ev.advice)
      state.advice = advice
      state.contractOk = ev.contract_ok ?? null
      state.redlinePassed = ev.redline_passed ?? null
      // manifest 行：可点飞向结构化卡（ref 由 NexusScene 决定；此处只落文字提示行）。
      push('system', 'manifest', advice ? 'The read is ready' : 'Done')
      state.status = 'complete'
      break
    }
    case 'error':
      state.status = 'error'
      state.error = ev.error ?? 'unknown error'
      push('system', 'thought', 'Something went wrong reaching the room.') // ⚠ 待 Danny 审字
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
  // ⚠ 待 Danny 审字
  if (gate === 'redline') return 'Re-checking so nobody gets labelled — describing the work instead.'
  return 'Grounding the answer in the evidence before drafting it.'
}

// manifest.advice 可能来自真后端——做防御性形状归一，缺字段补空（终端仍渲染，卡按有的字段显）。
export function coerceAgentOutput(raw: unknown): AgentOutput | null {
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
            kind: h.kind === 'primary' ? 'primary' : 'alternative',
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
    nextTasks: [], // live 版不派 fixture task（红线安全：不凭空造派工对象）
  }
}
