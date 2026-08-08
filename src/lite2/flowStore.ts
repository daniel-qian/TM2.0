import { create } from 'zustand'
import type { LiteHandoff, LiteTeam } from './teamData'
import type { AskRef } from './askRefs'
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

// #69 · 灰提示的长度闸。placeholder 被输入框宽度硬截断（手机视口尤甚），比输入框长一倍
// 的提示只会露个开头、后半截谁也看不到。所有卡片模板都是「主体 — 理由/证据」的形状，
// 主体在最前面，所以裁尾保住"这是在问谁/问哪个项目"这一段。
//
// 🔴 闸开在**显示宽度**上而不是字符数上。第一版按 `length <= 40` 裁，中文没事，英文当场
// 出血：demo 语料里一条 43 字符的分诊标题（"Take a look at Pilot Launch - Hangzhou
// Store"）被拦腰截断，连主体都没露全——40 个汉字和 40 个字母在屏幕上差着一倍宽。
// 单位取半角：CJK/全角记 2，其余记 1。72 的量 = 36 个汉字 ≈ 540px（15px 字号），桌面
// composer（≈600px）刚好放得下；手机（≈340px）会被输入框自己截掉尾巴，那是渲染事实，
// 不是数据丢失——真正要防的是"提示比输入框还长一倍"那种纯浪费。
const HINT_MAX_WIDTH = 72

// 东亚宽字符（含全角标点/假名/汉字/谚文）——Unicode East Asian Wide/Fullwidth 的常用段。
const WIDE_CHAR = /[ᄀ-ᅟ⺀-〾ぁ-㏿㐀-䶿一-鿿ꀀ-꓏가-힣豈-﫿︰-﹯＀-｠￠-￦]/

function clampHint(text: string): string | null {
  const s = (text ?? '').trim()
  if (!s) return null
  let width = 0
  for (let i = 0; i < s.length; i += 1) {
    width += WIDE_CHAR.test(s[i]) ? 2 : 1
    if (width > HINT_MAX_WIDTH) return `${s.slice(0, i)}…`
  }
  return s
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

  // "带进议事室"的**正文**通道：只剩一个用户——悬浮胶囊（AskAveryLauncher）。那里的文字
  // 是 manager **自己刚打完并按了发送**的原话，退成灰提示等于让他到了议事室再打一遍。
  // #69 起卡片类入口（分诊/差距/人卡/项目卡/详情浮层/决策卡）一律改走下面的 hint 通道。
  composerDraft: string | null
  // #69 · "带进议事室"的**提示**通道（0808 拍板）：卡片模板产的那句话退成输入框的灰色
  // placeholder——不占正文、发送不带、一打字就消失。缘起是 chips 已经把"问的是谁/哪个
  // 项目"结构化带过去了，正文里再抄一遍模板文字只是让 manager 多按几次退格。
  // 🔴 与 composerDraft 是**两条通道**不是一个字段两种用法：URL 中继上也分成两个键
  //（`q`＝正文、`qh`＝提示，routes.ts EPHEMERAL_PARAMS），否则胶囊和决策卡在同一个 `q`
  // 上就没法各要各的语义。
  composerHint: string | null
  // #64 · 悬浮胶囊里选好的 @ 引用随问题文字一起中继进议事室。#67 起**所有**预填入口
  //（人卡/项目卡/分诊卡/差距卡/详情浮层；决策卡走 goScreen refs 中继）都传 refs——
  // 构造一律走 askRefs.refOf*（与 @ 弹层候选同一把尺），调用点不许手拼五元组。
  composerDraftRefs: AskRef[] | null
  setComposerDraft: (text: string, refs?: AskRef[]) => void
  setComposerHint: (hint: string, refs?: AskRef[]) => void
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
    composerHint: null,
    composerDraftRefs: null,
    // refs 不传即清 null——预填是一次性的整体快照，旧 refs 挂到新草稿上就是接错线。
    // 两个 setter 都把**另一条通道清掉**：一次导航只有一种语义，留着上一次的残值就是
    // 「灰提示还挂着、正文又被填了」这种没人想要的叠加态。
    setComposerDraft: (text, refs) =>
      set({
        composerDraft: text,
        composerHint: null,
        composerDraftRefs: refs && refs.length > 0 ? refs : null,
      }),
    setComposerHint: (hint, refs) =>
      set({
        composerDraft: null,
        composerHint: clampHint(hint),
        composerDraftRefs: refs && refs.length > 0 ? refs : null,
      }),
    consumeComposerDraft: () =>
      set({ composerDraft: null, composerHint: null, composerDraftRefs: null }),

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
  useFlow.setState({
    triageMarks: {},
    followups: [],
    gapMarks: {},
    composerDraft: null,
    composerHint: null,   // #69：提示通道同样带公司正文（项目名/人名），照清不误
    composerDraftRefs: null,
  })
}
