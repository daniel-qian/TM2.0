import { create } from 'zustand'
import type { LiteHandoff, LiteTeam } from './teamData'
import { deriveGaps, type GapCard } from './gapDerive'

// feat-036 · lite2 晨间分诊 + Follow-ups 跟进（PRD F2+F3, ADR-0017 原判的真正执行）。
// 独立于 store.ts（kickoff-dev.md §Feature 切分：减冲突面）——这里只管两件事：
//   ① 分诊三动作态（done/discard，纯 mark，派生本身仍在 teamData.ts liveHandoffs() 里，
//      不重复实现——marks 只决定一个 handoff 今天显示在 pending / 已照料堆 / 搁置堆）。
//   ② Follow-ups 条目（今天/本周/之后分组 + 来源标签 + 完成/编辑/删除/历史）。
// 都走 localStorage（key 带 lite2 前缀），同步读写——不用 zustand persist 中间件：
// 该中间件的 hydrate() 走 Promise 链（即便 storage 本身同步），首帧会有一次"空态闪一下再
// 冒出数据"的窗口；这里手写同步 load/save，store 创建时就是最终态，无闪烁、也不需要门相位
// 用 poll 等 hydration——与本仓库其它小 store（如 story/homeStore.ts）手写风格一致。
//
// 🔴 红线：分诊/跟进条目上只出现人名与定性描述，零数字/评分/排名——marks 与 FollowupItem
// 结构本身就没有数字字段的位置（结构性护栏，同 teamData.ts 对 LitePerson 的做法）。
//
// feat-044（PRD F4）追加第三件事：③ "A closer look" 矛盾卡的 resolve/dismiss marks——同一
// localStorage blob（`gapMarks` 字段），同一手写同步 load/save 机制（复用 followupsPersist
// 已经过 reload 实证过的那条代码路径，不新起一套持久化）。

const STORAGE_KEY = 'lite2:flow:v1'

export type TriageMark = 'done' | 'discarded'
export type GapMark = 'resolved' | 'dismissed'

// 0721 对齐棒（合伙人反馈 B4 · 决策→待办闭环）：新增 'decision'——首页决策卡的「加入跟进」。
// 旧持久化数据没有这个值，读回来照常渲染（sourceLabel 对未知值走 default），零迁移。
export type FollowupSource = 'triage' | 'room' | 'ask' | 'closer-look' | 'manual' | 'decision'
export type FollowupDueGroup = 'today' | 'week' | 'later'

export interface FollowupItem {
  id: string
  title: string
  source: FollowupSource
  dueGroup: FollowupDueGroup
  note?: string
  done: boolean
  doneAt?: string
  createdAt: string
}

interface PersistedShape {
  triageMarks: Record<string, TriageMark>
  followups: FollowupItem[]
  gapMarks: Record<string, GapMark>
}

const EMPTY_PERSISTED: PersistedShape = { triageMarks: {}, followups: [], gapMarks: {} }

function loadPersisted(): PersistedShape {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return { ...EMPTY_PERSISTED }
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...EMPTY_PERSISTED }
    const parsed = JSON.parse(raw) as Partial<PersistedShape>
    return {
      triageMarks: parsed.triageMarks && typeof parsed.triageMarks === 'object' ? parsed.triageMarks : {},
      followups: Array.isArray(parsed.followups) ? parsed.followups : [],
      // gapMarks is new as of feat-044 — older persisted blobs (pre-feat-044) simply lack the
      // field; default to {} rather than choking on it (forward-compatible read).
      gapMarks: parsed.gapMarks && typeof parsed.gapMarks === 'object' ? parsed.gapMarks : {},
    }
  } catch {
    // 解析失败/无痕模式拒绝访问——退回内存态，不崩页面。
    return { ...EMPTY_PERSISTED }
  }
}

function savePersisted(state: PersistedShape) {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ triageMarks: state.triageMarks, followups: state.followups, gapMarks: state.gapMarks }),
    )
  } catch {
    // 写满/被拒——本次操作仍在内存态生效，只是不持久化；不抛错不打断交互。
  }
}

let idSeq = 0
function nextId(prefix: string): string {
  idSeq += 1
  return `${prefix}_${Date.now().toString(36)}_${idSeq}`
}

interface FlowState {
  triageMarks: Record<string, TriageMark>
  markTriageDone: (id: string) => void
  discardTriage: (id: string) => void
  restoreTriage: (id: string) => void

  followups: FollowupItem[]
  addFollowup: (input: {
    title: string
    source: FollowupSource
    dueGroup: FollowupDueGroup
    note?: string
  }) => string
  completeFollowup: (id: string) => void
  reopenFollowup: (id: string) => void
  deleteFollowup: (id: string) => void
  editFollowup: (id: string, patch: Partial<Pick<FollowupItem, 'title' | 'dueGroup' | 'note'>>) => void

  // "带进议事室"：分诊条目一键飞进 The room——composer 预填该条目上下文（不自动提交，
  // manager 审过再发问；与 AskCard 的 authorship 原则同一条线：起草由 Avery，动手由人）。
  composerDraft: string | null
  setComposerDraft: (text: string) => void
  consumeComposerDraft: () => void

  // feat-044（PRD F4）· "A closer look" 矛盾卡的 resolve/dismiss marks——同一 localStorage
  // blob，同一 mark-only 模式（不重新派生 gapDerive.ts 的结果，只按 id 分桶，同 triage marks）。
  gapMarks: Record<string, GapMark>
  resolveGap: (id: string) => void
  dismissGap: (id: string) => void
  restoreGap: (id: string) => void
}

export const useFlow = create<FlowState>((set, get) => {
  const initial = loadPersisted()

  function persist() {
    const { triageMarks, followups, gapMarks } = get()
    savePersisted({ triageMarks, followups, gapMarks })
  }

  return {
    triageMarks: initial.triageMarks,
    markTriageDone: (id) => {
      set((s) => ({ triageMarks: { ...s.triageMarks, [id]: 'done' } }))
      persist()
    },
    discardTriage: (id) => {
      set((s) => ({ triageMarks: { ...s.triageMarks, [id]: 'discarded' } }))
      persist()
    },
    restoreTriage: (id) => {
      set((s) => {
        const marks = { ...s.triageMarks }
        delete marks[id]
        return { triageMarks: marks }
      })
      persist()
    },

    followups: initial.followups,
    addFollowup: (input) => {
      const id = nextId('fu')
      const item: FollowupItem = {
        id,
        title: input.title,
        source: input.source,
        dueGroup: input.dueGroup,
        note: input.note,
        done: false,
        createdAt: new Date().toISOString(),
      }
      set((s) => ({ followups: [item, ...s.followups] }))
      persist()
      return id
    },
    completeFollowup: (id) => {
      set((s) => ({
        followups: s.followups.map((f) =>
          f.id === id ? { ...f, done: true, doneAt: new Date().toISOString() } : f,
        ),
      }))
      persist()
    },
    reopenFollowup: (id) => {
      set((s) => ({
        followups: s.followups.map((f) => (f.id === id ? { ...f, done: false, doneAt: undefined } : f)),
      }))
      persist()
    },
    deleteFollowup: (id) => {
      set((s) => ({ followups: s.followups.filter((f) => f.id !== id) }))
      persist()
    },
    editFollowup: (id, patch) => {
      set((s) => ({ followups: s.followups.map((f) => (f.id === id ? { ...f, ...patch } : f)) }))
      persist()
    },

    composerDraft: null,
    setComposerDraft: (text) => set({ composerDraft: text }),
    consumeComposerDraft: () => set({ composerDraft: null }),

    gapMarks: initial.gapMarks,
    resolveGap: (id) => {
      set((s) => ({ gapMarks: { ...s.gapMarks, [id]: 'resolved' } }))
      persist()
    },
    dismissGap: (id) => {
      set((s) => ({ gapMarks: { ...s.gapMarks, [id]: 'dismissed' } }))
      persist()
    },
    restoreGap: (id) => {
      set((s) => {
        const marks = { ...s.gapMarks }
        delete marks[id]
        return { gapMarks: marks }
      })
      persist()
    },
  }
})

// ── 分诊纯函数选择器（输入 = LiteTeam.handoffs，本身已是 teamData.ts liveHandoffs() 的真派生；
// 这里不重新派生，只按 marks 分桶——避免红线审计过的派生逻辑在两处各长一份）。────────────
export function selectTriagePending(team: LiteTeam | null, marks: Record<string, TriageMark>): LiteHandoff[] {
  return (team?.handoffs ?? []).filter((h) => !marks[h.id])
}

export function selectTriageHandled(team: LiteTeam | null, marks: Record<string, TriageMark>): LiteHandoff[] {
  return (team?.handoffs ?? []).filter((h) => marks[h.id] === 'done')
}

export function selectTriageSetAside(team: LiteTeam | null, marks: Record<string, TriageMark>): LiteHandoff[] {
  return (team?.handoffs ?? []).filter((h) => marks[h.id] === 'discarded')
}

// ── feat-044 · gap 纯函数选择器（输入 = deriveGaps(team)，gapDerive.ts 的真派生；这里同样
// 不重新派生，只按 marks 分桶——同 triage 选择器的分工原则）。────────────────────────────
export function selectGapsActive(team: LiteTeam | null, marks: Record<string, GapMark>): GapCard[] {
  return deriveGaps(team).filter((g) => !marks[g.id])
}

export function selectGapsResolved(team: LiteTeam | null, marks: Record<string, GapMark>): GapCard[] {
  return deriveGaps(team).filter((g) => marks[g.id] === 'resolved')
}

export function selectGapsDismissed(team: LiteTeam | null, marks: Record<string, GapMark>): GapCard[] {
  return deriveGaps(team).filter((g) => marks[g.id] === 'dismissed')
}

// ── arch-0802 · 公司域清扫收口 ────────────────────────────────────────────────────────────
// 换账号/「重新开始」时本 store 哪些字段必须清，由本文件自己说了算——此前这份清单以
// setState 字面量寄居在 AuthPanel（多份手工同步），新增字段漏清扫的后果是跨租户串数据
// （fixD 战役反复修的 bug 类）。🔴 往 FlowState 加 state 字段时必须同步决定它进不进这里：
// 公司数据（条目/标记/草稿正文）必进；找不到不清的理由就清。
// 对象/数组给新字面量而非 spread EMPTY_PERSISTED——模块常量的内层引用不进活 state。
export function resetFlowCompanyScope(): void {
  useFlow.setState({ triageMarks: {}, followups: [], gapMarks: {}, composerDraft: null })
}
