import { create } from 'zustand'
import { resolveMode, type AveryMode } from '../live/mode'
import { createHttpTransport, type LiveTeamPayload, type LiveTransport } from '../live/transport'
import {
  createLiveAgentSource,
  emptyRunState,
  type LiveAgentSource,
  type LiveRunState,
} from '../live/streamSource'
import type { AdviseRequest } from '../live/transport'

// feat-017：live mode 的并行 store（ADR-0020 决策 2/3）。
//
// 为什么不进 canvasStore：canvasStore 的 action 契约已冻结（ADR-0013 contract pass），
// 且 rail 回放机器（pristine 快照 + replay-to-target）不能被 live 状态污染——story mode 必须
// 零回归。liveStore 是纯增量：删掉它 + 两个 Live*Source 即回到今日 story-only demo，视觉机器一行没拆。
//
// 持有：解析出的 mode、可注入 transport（AFK 门打桩）、上传 → ingestion 的 Your team payload、
// 一次 live /advise 运行的逐帧快照。

export type IngestStatus = 'idle' | 'ingesting' | 'ready' | 'error'

interface LiveState {
  mode: AveryMode
  transport: LiveTransport

  // ── Your team（feat-016 ingestion 产出）──
  ingestStatus: IngestStatus
  ingestError: string | null
  team: LiveTeamPayload | null
  contextId: string | null

  // ── Nexus 一次 live 运行（feat-015 /advise）──
  run: LiveRunState
  agentSource: LiveAgentSource
  _abort: (() => void) | null

  // ── actions ──
  setMode: (mode: AveryMode) => void
  setTransport: (transport: LiveTransport) => void // AFK 门注入确定性 stub
  uploadFiles: (files: File[]) => Promise<void>
  refreshTeam: () => Promise<void>
  askLive: (req: AdviseRequest) => void
  resetRun: () => void
}

const defaultTransport = createHttpTransport()

export const useLive = create<LiveState>((set, get) => ({
  mode: resolveMode(),
  transport: defaultTransport,

  ingestStatus: 'idle',
  ingestError: null,
  team: null,
  contextId: null,

  run: emptyRunState(),
  agentSource: createLiveAgentSource(defaultTransport),
  _abort: null,

  setMode: (mode) => set({ mode }),

  setTransport: (transport) =>
    set({ transport, agentSource: createLiveAgentSource(transport) }),

  uploadFiles: async (files) => {
    if (files.length === 0) return
    set({ ingestStatus: 'ingesting', ingestError: null })
    try {
      const payload = await get().transport.ingest(files)
      set({
        ingestStatus: 'ready',
        team: payload,
        contextId: payload.context_id,
      })
    } catch (err) {
      set({
        ingestStatus: 'error',
        ingestError: err instanceof Error ? err.message : String(err),
      })
    }
  },

  refreshTeam: async () => {
    const { contextId, transport } = get()
    if (!contextId) return
    try {
      const payload = await transport.fetchTeam(contextId)
      set({ team: payload, ingestStatus: 'ready' })
    } catch (err) {
      set({ ingestError: err instanceof Error ? err.message : String(err) })
    }
  },

  askLive: (req) => {
    // 中止上一轮（切问题不叠流）。
    get()._abort?.()
    const { agentSource, contextId } = get()
    set({ run: { ...emptyRunState(), status: 'running' } })
    const handle = agentSource.run(
      { ...req, company_context_id: req.company_context_id ?? contextId ?? undefined },
      (state) => set({ run: state }),
    )
    set({ _abort: handle.abort })
  },

  resetRun: () => {
    get()._abort?.()
    set({ run: emptyRunState(), _abort: null })
  },
}))
