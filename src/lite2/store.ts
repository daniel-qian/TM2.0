import { create } from 'zustand'
import type {
  AskDraft,
  AskQuestionKind,
  LiveFileEntry,
  LiveNoteEntry,
  LiveTeamPayload,
  LiveTransport,
} from './transport'
import { createHttpTransport } from './transport'
import { resolveTransport } from './stubTransport'
import {
  coerceAskDraft,
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

// lite2 壳的 scene（feat-035 · PRD 6-tab 顺序 + feat-047 第 7 tab）：Your team（含上传空态）·
// The room · Follow-ups（空态占位，feat-036 真派生）· notes（feat-047 移植自 src/lite，
// 放在 Follow-ups 之后——本棒的 tab 顺序决定，见 progress.md）· A closer look（空态占位，
// feat-037 真派生）· Playbooks（空态屏）· Vision/Where this goes（定位叙事 + 能力边界 mock）。
// 详情是浮层不是 scene。
export type LiteScreen =
  | 'team'
  | 'room'
  | 'followups'
  | 'notes'
  | 'closerlook'
  | 'playbooks'
  | 'vision'

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
  // feat-047 移植（持久化链 feat-038 租户隔离）：本公司 owner_token（经理凭据）。transport 已
  // 按 context_id 存下并在读端点以 header 带上；store 也挂一份供 UI/调试可见。🔴 只读展示不入 URL。
  ownerToken: string | null
  // 原始 payload 留一份（详情浮层显 source_files；AFK 门可断言契约形状）
  rawTeam: LiveTeamPayload | null
  // feat-047 移植（feat-032）「你的文件」清单：持久留存的源文档元数据（重启后仍在）。
  files: LiveFileEntry[]
  // feat-047 移植（feat-033）「Avery's notes」：写侧、跨会话累积的 agent 自写观察（只读，
  // 新→旧，重启后仍在）。
  notes: LiveNoteEntry[]
  // advise 完成且后端确认新笔记落库 → Room 内出一次 nudge（丢弃则不出）。切屏即消。
  noteJustAdded: boolean

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
  refreshFiles: () => Promise<void>
  refreshNotes: () => Promise<void>
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
// feat-068 — DEV-ONLY：stub 通道只在 dev 存在。stub 编的是一整套以假乱真的团队/建议数据，
// 而线上这个 URL 是要发给真公司的——任何人往地址后面挂个 ?transport=stub，看到的就是编造的
// 内容，且与真输出肉眼不可分（demo 诚实性事故）。`import.meta.env.DEV` 在生产构建里被静态
// 求值成 false，Vite 据此把整条 stub 分支连同 stubTransport 模块一起 DCE 掉——线上根本不存在
// 这个开关。dev 下行为一字不变（AFK/DOM 门就靠 ?v=2&mode=live&transport=stub 驱动）。
// 与 src/main.tsx 的 __AVERY_LITE__ 测试缝同一个写法。
const defaultTransport = import.meta.env.DEV ? resolveTransport() : createHttpTransport()

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

  ask: null,
  askBusy: 'idle',
  askError: null,

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
        // feat-047: 挂上本公司 owner_token（transport 已存并按 context_id 带 header）。
        ownerToken: payload.owner_token ?? null,
      })
      // feat-047（feat-032）：拉一次持久文件清单（含 n_chunks）。次要视图，失败不影响上传成功。
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
    // 中止上一轮（切问题不叠流）。新一轮开跑即撤旧 Ask 卡（与 advice 卡同生命周期：
    // 一个 Thread 问题一张卡；旧草稿随旧 run 退场）。
    get()._abort?.()
    const { agentSource, contextId, notes } = get()
    const notesBefore = notes.length
    set({
      run: { ...emptyRunState(), status: 'running' },
      ask: null,
      askBusy: 'idle',
      askError: null,
      noteJustAdded: false,
    })
    let settled = false
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
    // feat-047 打回复验：白名单守卫——**只有 draft 可确认**。此前写作 `status !== 'draft'` 的
    // 黑名单式否定，与 coerce 折 draft 的 bug 叠加后，一张已撤回的 ask 能被重新 saveAsk+shareAsk。
    if (!ask || ask.status !== 'draft') return
    if (get().askBusy !== 'idle') return
    set({ askBusy: 'saving', askError: null })
    try {
      // 保存（题目经服务端红线门，阶段 C）→ 一人一链。两步各自大声失败，不吞错。
      const saved = await transport.saveAsk({
        ...ask,
        company_context_id: ask.company_context_id ?? contextId ?? undefined,
      })
      const shared = await transport.shareAsk(saved.id)
      set({ ask: adoptAsk(shared), askBusy: 'idle' })
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
      set({ ask: adoptAsk(next), askBusy: 'idle' })
    } catch (err) {
      set({ askBusy: 'idle', askError: err instanceof Error ? err.message : String(err) })
    }
  },
}))

// feat-047 打回复验：transport 回来的 ask 一律过同一把防御 coerce 再进 store——未知 status 折
// closed、坏形状（超题数/未知题型/值域外回执）宁可不出卡（抛错走 askError 大声显示）。
// 服务端是最终门；这里只是"坏形状绝不渲染"的客户端半边。
// 此前 lite2 把 transport 原始响应直接 set 进 store（零 coerce）——而 fetchAsk/refreshAsk
// 正是真后端交付 revoked/expired 的主路径，只修 coerceAskDraft 堵不住它（照 src/lite 的
// adoptAsk 先例补齐；拷贝不引用）。
function adoptAsk(raw: AskDraft): AskDraft {
  const coerced = coerceAskDraft(raw)
  if (!coerced) throw new Error('ask payload failed shape validation — refusing to render it')
  return coerced
}

// feat-047 门缝：live-frontend-gate 的 tokenDiscipline 相位读 contextId/ownerToken 断言 token
// 纪律（门是唯一消费者；产品代码不经 window 读 store）——同 src/lite/store.ts 的 __liteStore
// 先例，独立命名 __lite2Store 避免与 v01 撞名。
if (typeof window !== 'undefined') {
  ;(window as unknown as Record<string, unknown>).__lite2Store = useLite
}


