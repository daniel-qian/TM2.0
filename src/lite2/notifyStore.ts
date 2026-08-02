import { create } from 'zustand'
import { useLite, type LiteScreen } from './store'
import { deriveGaps } from './gapDerive'

// feat-045 · lite2 通知铃铛（PRD F5 / decisions.md 拍板#1）。
//
// 🔴 本文件的存在理由就是那条拍板红线：通知只由真实事件驱动，零手写假通知（合伙人版的
// 5 条硬编码通知是反例）。这里没有任何 seed 数据——items 只能经 initNotifications() 里的
// store 订阅在真事件发生的那一刻 push 进来：
//   · ingest 完成（ingestStatus: ingesting → ready）→ "你的团队已就绪"类
//   · run 完成（run.status: running → complete）→ "议事室的解读好了"类
//   · 快问回执收齐（ask.status 变为 closed，按 ask.id 去重）→ "回复都到了"类
//   · 新矛盾卡（team 更新后 deriveGaps 出现没见过的 gap id）→ "有处值得多看一眼"类
// 文案永不点名员工个人（kind → 泛化 i18n 文案，结构上没有携带人名的槽位——同 flowStore
// 对数字字段的结构性护栏思路）；未读计数是"通知条数"不是任何人的读数。
//
// 持久化（localStorage `lite2:notify:v1`，手写同步 load/save，同 flowStore/onboardStore
// 模式）：items 本身 + 两个去重集（seenGapIds / seenAskIds）——reload 后同一张矛盾卡、
// 同一次快问不会重复通知。

const STORAGE_KEY = 'lite2:notify:v1'
const MAX_ITEMS = 50

export type NotifKind = 'ingest' | 'run' | 'ask' | 'gap'

export interface NotifItem {
  id: string
  kind: NotifKind
  createdAt: string
  read: boolean
}

// 点击通知跳对应 tab（kind → 屏）。
export const NOTIF_TARGET: Record<NotifKind, LiteScreen> = {
  ingest: 'team',
  run: 'room',
  ask: 'room',
  gap: 'closerlook',
}

interface PersistedNotify {
  items: NotifItem[]
  seenGapIds: string[]
  seenAskIds: string[]
}

const EMPTY_PERSISTED: PersistedNotify = { items: [], seenGapIds: [], seenAskIds: [] }

function isKind(v: unknown): v is NotifKind {
  return v === 'ingest' || v === 'run' || v === 'ask' || v === 'gap'
}

function loadPersisted(): PersistedNotify {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return { ...EMPTY_PERSISTED }
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...EMPTY_PERSISTED }
    const parsed = JSON.parse(raw) as Partial<PersistedNotify>
    const items = Array.isArray(parsed.items)
      ? parsed.items.filter(
          (it): it is NotifItem =>
            !!it && typeof it === 'object' && typeof (it as NotifItem).id === 'string' &&
            isKind((it as NotifItem).kind),
        )
      : []
    const strArr = (v: unknown): string[] =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
    return { items, seenGapIds: strArr(parsed.seenGapIds), seenAskIds: strArr(parsed.seenAskIds) }
  } catch {
    return { ...EMPTY_PERSISTED }
  }
}

function savePersisted(state: PersistedNotify) {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        items: state.items,
        seenGapIds: state.seenGapIds,
        seenAskIds: state.seenAskIds,
      }),
    )
  } catch {
    // 写满/被拒——通知仍在内存态可见，不抛错。
  }
}

let notifSeq = 0
function nextNotifId(): string {
  notifSeq += 1
  return `nt_${Date.now().toString(36)}_${notifSeq}`
}

interface NotifyState extends PersistedNotify {
  open: boolean

  toggleOpen: () => void
  closePop: () => void
  markRead: (id: string) => void
  markAllRead: () => void

  // 内部：只被 initNotifications 的订阅调用——组件层没有任何入口能凭空造通知。
  _push: (kind: NotifKind) => void
  _rememberGaps: (ids: string[]) => void
  _rememberAsk: (id: string) => void
}

export const useNotify = create<NotifyState>((set, get) => {
  const initial = loadPersisted()

  function persist() {
    const { items, seenGapIds, seenAskIds } = get()
    savePersisted({ items, seenGapIds, seenAskIds })
  }

  return {
    ...initial,
    open: false,

    toggleOpen: () => set((s) => ({ open: !s.open })),
    closePop: () => set({ open: false }),
    markRead: (id) => {
      set((s) => ({ items: s.items.map((it) => (it.id === id ? { ...it, read: true } : it)) }))
      persist()
    },
    markAllRead: () => {
      set((s) => ({ items: s.items.map((it) => (it.read ? it : { ...it, read: true })) }))
      persist()
    },

    _push: (kind) => {
      const item: NotifItem = {
        id: nextNotifId(),
        kind,
        createdAt: new Date().toISOString(),
        read: false,
      }
      set((s) => ({ items: [item, ...s.items].slice(0, MAX_ITEMS) }))
      persist()
    },
    _rememberGaps: (ids) => {
      if (ids.length === 0) return
      set((s) => ({ seenGapIds: [...s.seenGapIds, ...ids] }))
      persist()
    },
    _rememberAsk: (id) => {
      set((s) => ({ seenAskIds: [...s.seenAskIds, id] }))
      persist()
    },
  }
})

export function selectUnreadCount(s: NotifyState): number {
  return s.items.reduce((n, it) => n + (it.read ? 0 : 1), 0)
}

// ── 事件接线：订阅 useLite 的真状态转移。Lite2App 挂载时调一次；模块级 guard 保证
// StrictMode 双跑 effect / 多次挂载都只接一次线（订阅活在组件树之外，屏切换不掉线）。──
let wired = false

export function initNotifications() {
  if (wired) return
  wired = true

  useLite.subscribe((state, prev) => {
    const notify = useNotify.getState()

    // ① ingest 完成——上传的文件读完、团队长出来了。
    if (prev.ingestStatus === 'ingesting' && state.ingestStatus === 'ready') {
      notify._push('ingest')
    }

    // ② run 完成——议事室把这一轮想完了。
    if (prev.run.status === 'running' && state.run.status === 'complete') {
      notify._push('run')
    }

    // ③ 快问回执收齐——ask 进入 closed（按 ask.id 去重：同一次快问只通知一次）。
    const ask = state.ask
    if (ask && ask.status === 'closed' && !notify.seenAskIds.includes(ask.id)) {
      notify._rememberAsk(ask.id)
      notify._push('ask')
    }

    // ④ 新矛盾卡——团队数据更新后，deriveGaps 出现没见过的 gap id（按 id 去重：
    // reload 重新 ingest 同一语料不会重复通知）。派生逻辑复用 gapDerive.ts 纯函数，
    // 不在这里长第二份（同 flowStore 选择器的分工原则）。
    if (state.team && state.team !== prev.team) {
      const fresh = deriveGaps(state.team).filter((g) => !notify.seenGapIds.includes(g.id))
      if (fresh.length > 0) {
        notify._rememberGaps(fresh.map((g) => g.id))
        for (let i = 0; i < fresh.length; i++) notify._push('gap')
      }
    }
  })
}

// ── arch-0802 · 公司域清扫收口 ────────────────────────────────────────────────────────────
// 同 flowStore.resetFlowCompanyScope 的口径：清单与 state 形状同文件共置，AuthPanel 只组合
// 调用。🔴 往 NotifyState 加字段时必须同步决定进不进这里（通知条目/已见 id 是公司数据；
// open 是 UI 态，宁可多清）。
export function resetNotifyCompanyScope(): void {
  useNotify.setState({ items: [], seenGapIds: [], seenAskIds: [], open: false })
}
