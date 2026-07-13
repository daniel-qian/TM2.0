import { create } from 'zustand'
import { createHttpTransport, type LiveTeamPayload, type LiveTransport } from './transport'
import {
  createLiveAgentSource,
  emptyRunState,
  type LiveAgentSource,
  type LiveRunState,
} from './streamSource'
import type { AdviseRequest } from './transport'
import { liteTeamFromPayload, type LiteTeam } from './teamData'

// feat-017 的 liveStore，feat-024（ADR-0022 决策 1）随立墙搬进 lite 壳并接管 lite 导航。
//
// 为什么不进 canvasStore：canvasStore 的 action 契约已冻结（ADR-0013 contract pass），
// 且 rail 回放机器（pristine 快照 + replay-to-target）不能被 live 状态污染——story mode 必须
// 零回归。本 store 是纯增量：删掉 src/lite/** 即回到 story-only demo，视觉机器一行没拆。
//
// 持有：可注入 transport（AFK 门打桩）、上传 → ingestion 的 Your team 数据、
// 一次 live /advise 运行的逐帧快照、lite 壳自己的两屏导航 + 薄详情浮层状态。
// mode 本身升到 shared/modeStore（两个壳共用的唯一地基）。

export type IngestStatus = 'idle' | 'ingesting' | 'ready' | 'error'

// lite 壳的 scene：Your team（含上传空态）· The room · Playbooks（feat-025 空态屏）·
// Vision（feat-026 定位叙事 + 能力边界 mock）。详情是浮层不是 scene。
export type LiteScreen = 'team' | 'room' | 'playbooks' | 'vision'

export type LiteDetail = { kind: 'person' | 'project'; id: string } | null

interface LiteState {
  transport: LiveTransport

  // ── lite 导航 ──
  screen: LiteScreen
  detail: LiteDetail

  // ── Your team（feat-016 ingestion 产出）──
  ingestStatus: IngestStatus
  ingestError: string | null
  team: LiteTeam | null
  contextId: string | null
  // 原始 payload 留一份（详情浮层显 source_files；AFK 门可断言契约形状）
  rawTeam: LiveTeamPayload | null

  // ── The room 一次 live 运行（feat-015 /advise）──
  run: LiveRunState
  agentSource: LiveAgentSource
  _abort: (() => void) | null

  // ── actions ──
  goScreen: (screen: LiteScreen) => void
  openDetail: (kind: 'person' | 'project', id: string) => void
  closeDetail: () => void
  setTransport: (transport: LiveTransport) => void // AFK 门注入确定性 stub
  uploadFiles: (files: File[]) => Promise<void>
  refreshTeam: () => Promise<void>
  askLive: (req: AdviseRequest) => void
  resetRun: () => void
}

const defaultTransport = createHttpTransport()

export const useLite = create<LiteState>((set, get) => ({
  transport: defaultTransport,

  screen: 'team',
  detail: null,

  ingestStatus: 'idle',
  ingestError: null,
  team: null,
  contextId: null,
  rawTeam: null,

  run: emptyRunState(),
  agentSource: createLiveAgentSource(defaultTransport),
  _abort: null,

  goScreen: (screen) => set({ screen, detail: null }),
  openDetail: (kind, id) => set({ detail: { kind, id } }),
  closeDetail: () => set({ detail: null }),

  setTransport: (transport) =>
    set({ transport, agentSource: createLiveAgentSource(transport) }),

  uploadFiles: async (files) => {
    if (files.length === 0) return
    set({ ingestStatus: 'ingesting', ingestError: null })
    try {
      const payload = await get().transport.ingest(files)
      set({
        ingestStatus: 'ready',
        team: liteTeamFromPayload(payload),
        rawTeam: payload,
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
      set({ team: liteTeamFromPayload(payload), rawTeam: payload, ingestStatus: 'ready' })
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
