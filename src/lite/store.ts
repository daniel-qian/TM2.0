import { create } from 'zustand'
import {
  createHttpTransport,
  type LiveFileEntry,
  type LiveNoteEntry,
  type LiveTeamPayload,
  type LiveTransport,
} from './transport'
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

// lite 壳的 scene：Your team（含上传空态）· The room · Avery's notes（feat-033 写侧笔记）·
// Playbooks（feat-025 空态屏）· Vision（feat-026 定位叙事 + 能力边界 mock）。详情是浮层不是 scene。
export type LiteScreen = 'team' | 'room' | 'notes' | 'playbooks' | 'vision'

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
  // feat-038 租户隔离：本公司 owner_token（经理凭据）。transport 已按 context_id 存下并在读端点
  // 以 header 带上；store 也挂一份供 UI/调试可见。🔴 只读展示不入 URL。
  ownerToken: string | null
  // 原始 payload 留一份（详情浮层显 source_files；AFK 门可断言契约形状）
  rawTeam: LiveTeamPayload | null
  // feat-032「你的文件」清单：持久留存的源文档元数据（重启后仍在）。
  files: LiveFileEntry[]
  // feat-033「Avery's notes」：写侧、跨会话累积的 agent 自写观察（只读，新→旧，重启后仍在）。
  notes: LiveNoteEntry[]
  // advise 完成且后端确认新笔记落库 → Room 内出一次 nudge（丢弃则不出）。切屏即消。
  noteJustAdded: boolean

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
  refreshFiles: () => Promise<void>
  refreshNotes: () => Promise<void>
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
  ownerToken: null,
  rawTeam: null,
  files: [],
  notes: [],
  noteJustAdded: false,

  run: emptyRunState(),
  agentSource: createLiveAgentSource(defaultTransport),
  _abort: null,

  // 切屏消掉 Room 内的一次性 nudge（用户已离开事发现场；nudge 是瞬态感知，不是持久红点）。
  goScreen: (screen) => set({ screen, detail: null, noteJustAdded: false }),
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
        // feat-038: 挂上本公司 owner_token（transport 已存并按 context_id 带 header）。
        ownerToken: payload.owner_token ?? null,
      })
      // feat-032：拉一次持久文件清单（含 n_chunks）。次要视图，失败不影响上传成功。
      void get().refreshFiles()
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
    void get().refreshFiles()
  },

  refreshFiles: async () => {
    const { contextId, transport } = get()
    if (!contextId) return
    try {
      const payload = await transport.fetchFiles(contextId)
      set({ files: payload.files })
    } catch {
      // 文件清单是次要回看视图——拉取失败不该打断主流程（team 已就绪）。
    }
  },

  refreshNotes: async () => {
    const { contextId, transport } = get()
    if (!contextId) return
    try {
      const payload = await transport.fetchNotes(contextId)
      set({ notes: payload.notes })
    } catch {
      // 笔记是次要只读视图——拉取失败不该打断主流程。
    }
  },

  askLive: (req) => {
    // 中止上一轮（切问题不叠流）。
    get()._abort?.()
    const { agentSource, contextId, notes } = get()
    const notesBefore = notes.length
    set({ run: { ...emptyRunState(), status: 'running' }, noteJustAdded: false })
    let settled = false
    const handle = agentSource.run(
      { ...req, company_context_id: req.company_context_id ?? contextId ?? undefined },
      (state) => {
        set({ run: state })
        // 一次 advise 落定后：拉一次笔记，**后端确认新笔记落库**（计数增长）才亮 nudge——
        // 观察被红线门丢弃时后端不落库、计数不变、nudge 不出（诚实降级，不显占位）。
        if (!settled && (state.status === 'complete' || state.status === 'error')) {
          settled = true
          const { contextId: cid, transport } = get()
          if (cid) {
            void transport
              .fetchNotes(cid)
              .then((payload) => set({ notes: payload.notes, noteJustAdded: payload.notes.length > notesBefore }))
              .catch(() => {
                /* 次要——失败不打断，只是这次不亮 nudge */
              })
          }
        }
      },
    )
    set({ _abort: handle.abort })
  },

  resetRun: () => {
    get()._abort?.()
    set({ run: emptyRunState(), _abort: null })
  },
}))
