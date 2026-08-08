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

// T9（gap2 #58）· 'form' = 常驻表单这一路：本期已按上期名单备好 / 有人交了本期的表单。
// 🔴 两个触发合用**同一个** kind 而不是拆成两个，是被上面那条红线逼出来的：文案永不点名员工
// 个人，所以「谁交了」只能说「有人交了本期的表单」。既然文案已经泛化到这一步，再拆一个 kind
// 也说不出更多东西——只会多一处必须同步维护的枚举。
export type NotifKind = 'ingest' | 'run' | 'ask' | 'gap' | 'form'

// 🔴 一处真源：加 kind 时改这里，下面三处（类型、NOTIF_TARGET 的完整性、isKind 的运行时判据）
// 全部跟着走。此前 `isKind` 是一份**手写的第二份枚举**（`v === 'ingest' || …` 的布尔链），
// 与 NotifKind 之间没有任何类型联系——漏改它不是编译错误，而是**刷新页面后这一类通知静默消失**
// （persisted items 被过滤掉了）。这种缺陷只有真人重开页面才看得见。
const NOTIF_KINDS = ['ingest', 'run', 'ask', 'gap', 'form'] as const

export interface NotifItem {
  id: string
  kind: NotifKind
  createdAt: string
  read: boolean
}

// 点击通知跳对应 tab（kind → 屏）。`Record<NotifKind, …>` 保证漏一个就是编译错误。
export const NOTIF_TARGET: Record<NotifKind, LiteScreen> = {
  ingest: 'team',
  run: 'room',
  ask: 'room',
  // #63 ·「值得注意」屏并进「今天」的差距摘要块后，gap 通知落 home——对照卡现在住在
  // 那儿（'closerlook' 已从 LiteScreen 退休，写回去是编译错误）。接线判据在
  // verify-flow-gap-phases 的 gapNotifRoute 步：点真通知条目、断言 data-scene 落 home。
  gap: 'home',
  // 表单这一路的落点是「文件与表单」屏——「本期备好了」和「有人交了」两件事都在那一屏上
  // 有真东西可看（名单、链接、谁交了）。
  form: 'files',
}

interface PersistedNotify {
  items: NotifItem[]
  seenGapIds: string[]
  seenAskIds: string[]
  // T9 · 已经通知过的「有人交了」提交 id（同 seenAskIds 的去重姿态）。没有它，每一次刷新都会
  // 把库里所有 submitted 行重新认成"新交的"，铃铛按已提交人数刷屏。
  seenFormIds: string[]
  // T9 · 已经通知过的「本期已备好」周期键（`<template>|<period>`）。服务端的 auto_filled 只在
  // 真的铸了行的那一次出现，但经理可能在两台设备/两个标签页上各触发一次，各自都是真事件——
  // 对同一期只提醒一次就够了。
  seenFormPeriods: string[]
}

const EMPTY_PERSISTED: PersistedNotify = {
  items: [], seenGapIds: [], seenAskIds: [], seenFormIds: [], seenFormPeriods: [],
}

function isKind(v: unknown): v is NotifKind {
  return (NOTIF_KINDS as readonly string[]).includes(v as string)
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
    return {
      items,
      seenGapIds: strArr(parsed.seenGapIds),
      seenAskIds: strArr(parsed.seenAskIds),
      // T9 加的两个去重集：老的持久化载荷里没有这两个键，strArr 会给出 []，于是升级后的
      // 第一次刷新会把已有的 submitted 行都认成"新交的"。刻意接受这一次——把 items 里
      // 已有的通知拿来反推"哪些通知过了"是猜；一次性多几条真事件的提醒，比记错账便宜。
      seenFormIds: strArr(parsed.seenFormIds),
      seenFormPeriods: strArr(parsed.seenFormPeriods),
    }
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
        seenFormIds: state.seenFormIds,
        seenFormPeriods: state.seenFormPeriods,
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
  _rememberForms: (ids: string[]) => void
  _rememberFormPeriod: (key: string) => void
}

export const useNotify = create<NotifyState>((set, get) => {
  const initial = loadPersisted()

  function persist() {
    // 逐字段解构（不是 `savePersisted(get())`）是刻意的：`get()` 还带着 `open` 与那几个 action，
    // 全塞进 localStorage 就是把 UI 态和函数一起序列化。代价是加字段时要在这里也补一笔——
    // 而 `savePersisted` 的入参类型是 `PersistedNotify`，漏了就是 tsc 报错，不是静默丢数据。
    const { items, seenGapIds, seenAskIds, seenFormIds, seenFormPeriods } = get()
    savePersisted({ items, seenGapIds, seenAskIds, seenFormIds, seenFormPeriods })
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
    _rememberForms: (ids) => {
      if (ids.length === 0) return
      set((s) => ({ seenFormIds: [...s.seenFormIds, ...ids] }))
      persist()
    },
    _rememberFormPeriod: (key) => {
      set((s) => ({ seenFormPeriods: [...s.seenFormPeriods, key] }))
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

    // ⑤ T9（gap2 #58）· 常驻表单这一路，两个触发。
    //
    // 🔴 两个都必须是**真实状态迁移**，不是"当下为真的静态事实"（本文件开头那条红线）。
    //    这一路最容易写错的形态是拿「本期有 open 行」或「有人交过」当判据——那两句话在此后
    //    每一次刷新上都为真，铃铛会按刷新次数刷屏。所以两边都按 id/周期去重，且**先记账再推**。

    // ⑤a 有人交了：库里出现了一条我们没见过的 submitted 行。
    //     去重认 submission id（一条链一个人一次提交，id 是它的终身标识）。
    if (state.formSubmissions && state.formSubmissions !== prev.formSubmissions) {
      const fresh = state.formSubmissions
        .filter((s) => s.submitted_at && !notify.seenFormIds.includes(s.id))
        .map((s) => s.id)
      if (fresh.length > 0) {
        notify._rememberForms(fresh)
        for (let i = 0; i < fresh.length; i++) notify._push('form')
      }
    }

    // ⑤b 本期已备好：服务端**这一次**真的按上期名单铸了行（`auto_filled` 键缺席就是没铸）。
    //     再按 `<模板>|<周期>` 去重一层：同一期在两台设备上各触发一次都是真事件，但提醒一次够了。
    if (state.formsAutoFilled && state.formsAutoFilled !== prev.formsAutoFilled) {
      for (const filled of state.formsAutoFilled) {
        const key = `${filled.template_id}|${filled.period}`
        if (useNotify.getState().seenFormPeriods.includes(key)) continue
        useNotify.getState()._rememberFormPeriod(key)
        useNotify.getState()._push('form')
      }
    }
  })
}

// ── arch-0802 · 公司域清扫收口 ────────────────────────────────────────────────────────────
// 同 flowStore.resetFlowCompanyScope 的口径：清单与 state 形状同文件共置，AuthPanel 只组合
// 调用。🔴 往 NotifyState 加字段时必须同步决定进不进这里（通知条目/已见 id 是公司数据；
// open 是 UI 态，宁可多清）。
export function resetNotifyCompanyScope(): void {
  useNotify.setState({
    items: [], seenGapIds: [], seenAskIds: [],
    // T9 加的两个去重集同样是**公司数据**（提交 id / 周期都属于那一家公司）。留着它们，
    // 换到 B 公司之后 B 的第一批提交会被当成"通知过了"而静默不响。
    seenFormIds: [], seenFormPeriods: [],
    open: false,
  })
}
