import { create } from 'zustand'
import type {
  AskDraft,
  AskQuestionKind,
  LiveTeamPayload,
  LiveTransport,
} from './transport'
import { resolveTransport } from './stubTransport'
import {
  createLiveAgentSource,
  emptyRunState,
  type LiveAgentSource,
  type LiveRunState,
} from './streamSource'
import type { AdviseRequest } from './transport'
import { liteTeamFromPayload, type LiteTeam } from './teamData'

// feat-017 的 liveStore 血统，feat-035（lite-live-v02 kickoff §架构拍板 1）copy-then-wall
// 复制进 src/lite2/**，与 src/lite/store.ts 各自独立生长——lite ↔ lite2 零交叉 import。
//
// 为什么不进 canvasStore：canvasStore 的 action 契约已冻结（ADR-0013 contract pass），
// 且 rail 回放机器（pristine 快照 + replay-to-target）不能被 live 状态污染——story mode 必须
// 零回归。本 store 是纯增量：删掉 src/lite2/** 即回到没有 v02 的今天，v01/story 一行没拆。
//
// 持有：可注入 transport（AFK 门打桩）、上传 → ingestion 的 Your team 数据、
// 一次 live /advise 运行的逐帧快照、lite2 壳自己的六屏导航 + 薄详情浮层状态。
// mode 本身升到 shared/modeStore（story/lite/lite2 三者共用的唯一地基）。

export type IngestStatus = 'idle' | 'ingesting' | 'ready' | 'error'

// lite2 壳的 scene（feat-035 · PRD 6-tab 顺序）：Your team（含上传空态）· The room ·
// Follow-ups（空态占位，feat-036 真派生）· A closer look（空态占位，feat-037 真派生）·
// Playbooks（空态屏）· Vision/Where this goes（定位叙事 + 能力边界 mock）。
// 详情是浮层不是 scene。
export type LiteScreen = 'team' | 'room' | 'followups' | 'closerlook' | 'playbooks' | 'vision'

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

  // ── Ask / Quick ask（feat-034 阶段 B）——当前 Thread 的一张活体 Quick ask。
  // 🔴 回执数据只活在这里（AskDraft.recipients[].receipt）——LitePerson / 人卡零新增字段。
  ask: AskDraft | null
  askBusy: 'idle' | 'saving' | 'refreshing'
  askError: string | null

  // ── actions ──
  goScreen: (screen: LiteScreen) => void
  openDetail: (kind: 'person' | 'project', id: string) => void
  closeDetail: () => void
  setTransport: (transport: LiveTransport) => void // AFK 门注入确定性 stub
  uploadFiles: (files: File[]) => Promise<void>
  refreshTeam: () => Promise<void>
  askLive: (req: AdviseRequest) => void
  resetRun: () => void

  // Ask 草稿态编辑（status==='draft' 才生效；manager 逐字改题、1~3 内增删、点选受访者）
  editAskQuestion: (questionId: string, text: string) => void
  addAskQuestion: (kind: AskQuestionKind) => void
  removeAskQuestion: (questionId: string) => void
  toggleAskRecipient: (personId: string, name: string) => void
  // 确认 = 保存（服务端红线门，阶段 C）+ 生成一人一链 → shared
  confirmAsk: () => Promise<void>
  // manager 拉取回收状态/回执（PRD Q7：拉取式，无推送）
  refreshAsk: () => Promise<void>
}

// `?transport=stub` → 确定性 stub（AFK 门/离线演示）；默认真 HTTP（行为零变化）。
const defaultTransport = resolveTransport()

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

  ask: null,
  askBusy: 'idle',
  askError: null,

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
    // 中止上一轮（切问题不叠流）。新一轮开跑即撤旧 Ask 卡（与 advice 卡同生命周期：
    // 一个 Thread 问题一张卡；旧草稿随旧 run 退场）。
    get()._abort?.()
    const { agentSource, contextId } = get()
    set({ run: { ...emptyRunState(), status: 'running' }, ask: null, askBusy: 'idle', askError: null })
    const handle = agentSource.run(
      { ...req, company_context_id: req.company_context_id ?? contextId ?? undefined },
      (state) => {
        // 流里出生 ask-draft（一次性收养）：之后的编辑/分享/回执活体在 store，不再被流覆盖。
        const current = get().ask
        if (state.askDraft && (!current || current.id !== state.askDraft.id)) {
          set({ run: state, ask: state.askDraft })
        } else {
          set({ run: state })
        }
      },
    )
    set({ _abort: handle.abort })
  },

  resetRun: () => {
    get()._abort?.()
    set({ run: emptyRunState(), _abort: null, ask: null, askBusy: 'idle', askError: null })
  },

  // ── Ask 草稿态编辑（只在 draft 生效——shared 之后题目/受访者即定格）──────────────
  editAskQuestion: (questionId, text) => {
    const { ask } = get()
    if (!ask || ask.status !== 'draft') return
    set({
      ask: {
        ...ask,
        questions: ask.questions.map((q) => (q.id === questionId ? { ...q, text } : q)),
      },
    })
  },

  addAskQuestion: (kind) => {
    const { ask } = get()
    if (!ask || ask.status !== 'draft' || ask.questions.length >= 3) return
    // id 在本草稿内单调递增（q1..qN 之上继续编号，避免与被删 id 撞车）。
    const maxN = ask.questions.reduce((n, q) => {
      const m = /^q(\d+)$/.exec(q.id)
      return m ? Math.max(n, Number(m[1])) : n
    }, 0)
    set({
      ask: {
        ...ask,
        questions: [...ask.questions, { id: `q${maxN + 1}`, kind, text: '' }],
      },
    })
  },

  removeAskQuestion: (questionId) => {
    const { ask } = get()
    if (!ask || ask.status !== 'draft' || ask.questions.length <= 1) return
    set({ ask: { ...ask, questions: ask.questions.filter((q) => q.id !== questionId) } })
  },

  toggleAskRecipient: (personId, name) => {
    const { ask } = get()
    if (!ask || ask.status !== 'draft') return
    const has = ask.recipients.some((r) => r.id === personId)
    set({
      ask: {
        ...ask,
        recipients: has
          ? ask.recipients.filter((r) => r.id !== personId)
          : [...ask.recipients, { id: personId, name }],
      },
    })
  },

  confirmAsk: async () => {
    const { ask, transport, contextId } = get()
    if (!ask || ask.status !== 'draft' || get().askBusy !== 'idle') return
    set({ askBusy: 'saving', askError: null })
    try {
      // 保存（题目经服务端红线门，阶段 C）→ 一人一链。两步各自大声失败，不吞错。
      const saved = await transport.saveAsk({
        ...ask,
        company_context_id: ask.company_context_id ?? contextId ?? undefined,
      })
      const shared = await transport.shareAsk(saved.id)
      set({ ask: shared, askBusy: 'idle' })
    } catch (err) {
      set({ askBusy: 'idle', askError: err instanceof Error ? err.message : String(err) })
    }
  },

  refreshAsk: async () => {
    const { ask, transport } = get()
    if (!ask || (ask.status !== 'shared' && ask.status !== 'collecting')) return
    if (get().askBusy !== 'idle') return
    set({ askBusy: 'refreshing', askError: null })
    try {
      const next = await transport.fetchAsk(ask.id)
      set({ ask: next, askBusy: 'idle' })
    } catch (err) {
      set({ askBusy: 'idle', askError: err instanceof Error ? err.message : String(err) })
    }
  },
}))


