import { create } from 'zustand'
import type { Dict } from '../shared/i18n'

// feat-045 · lite2 onboarding 向导状态（PRD F7）。独立于 store.ts / flowStore.ts（同 feat-036
// 的"减冲突面"切分原则）——这里只管三件事：
//   ① 向导生命周期：unseen（首访，自动弹出）→ in-progress（走到哪步记到哪步，中途 × 关闭
//      下次续进度）→ skipped（明确跳过，永不再骚扰）/ done（走完）。
//   ② 团队信息本地配置（公司/部门/称呼——供问候语用；只存本机 localStorage，不出网）。
//   ③ playbook 勾选（8 项候选，默认勾 3；持久化，Playbooks tab 槽位按所选呈现）。
// 持久化走 localStorage（lite2 前缀 key），手写同步 load/save——与 flowStore.ts 同一模式、
// 同一理由（zustand persist 中间件的异步 hydrate 首帧闪空态；这里 store 创建时即最终态）。
//
// 🔴 红线（PRD F7 明令）：不做假"连接工具"步（假 OAuth 不诚实）、不做假"创建账号"步
// （无账号体系）。向导四步全部真接线：上传步真调 store.uploadFiles；勾选步真写本配置。

const STORAGE_KEY = 'lite2:onboard:v1'

export type OnboardStatus = 'unseen' | 'in-progress' | 'skipped' | 'done'
export type OnboardStep = 'upload' | 'team' | 'playbooks' | 'done'

export const ONBOARD_STEPS: OnboardStep[] = ['upload', 'team', 'playbooks', 'done']

// ── playbook 候选目录（PRD F7：8 项，参考合伙人版语义、文案全部重写——备忘录腔，
// 每项 = 标题 + 一句人话说明；EN 定稿在 en.ts lite2.playbook*，此处只持有稳定 id 与
// i18n selector，避免把 copy 写死在两处）。──────────────────────────────────────────
export interface PlaybookEntry {
  id: string
  title: (l: Dict['lite2']) => string
  body: (l: Dict['lite2']) => string
}

export const PLAYBOOK_CATALOG: PlaybookEntry[] = [
  { id: 'onboarding-handover', title: (l) => l.playbookOnboardingTitle, body: (l) => l.playbookOnboardingBody },
  { id: 'weekly-review', title: (l) => l.playbookWeeklyTitle, body: (l) => l.playbookWeeklyBody },
  { id: 'stuck-project', title: (l) => l.playbookStuckTitle, body: (l) => l.playbookStuckBody },
  { id: 'handoff-cover', title: (l) => l.playbookHandoffTitle, body: (l) => l.playbookHandoffBody },
  { id: 'tough-conversation', title: (l) => l.playbookToughTalkTitle, body: (l) => l.playbookToughTalkBody },
  { id: 'first-ninety', title: (l) => l.playbookNinetyTitle, body: (l) => l.playbookNinetyBody },
  { id: 'quiet-risks', title: (l) => l.playbookRisksTitle, body: (l) => l.playbookRisksBody },
  { id: 'after-ship', title: (l) => l.playbookShipTitle, body: (l) => l.playbookShipBody },
]

// 默认勾 3（PRD F7）——新经理最先用得上的三件事。
export const DEFAULT_PLAYBOOKS = ['onboarding-handover', 'weekly-review', 'stuck-project']

interface PersistedOnboard {
  status: OnboardStatus
  step: OnboardStep
  company: string
  dept: string
  yourName: string
  playbooks: string[]
}

const EMPTY_PERSISTED: PersistedOnboard = {
  status: 'unseen',
  step: 'upload',
  company: '',
  dept: '',
  yourName: '',
  playbooks: [...DEFAULT_PLAYBOOKS],
}

function isStatus(v: unknown): v is OnboardStatus {
  return v === 'unseen' || v === 'in-progress' || v === 'skipped' || v === 'done'
}

function isStep(v: unknown): v is OnboardStep {
  return v === 'upload' || v === 'team' || v === 'playbooks' || v === 'done'
}

function loadPersisted(): PersistedOnboard {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return { ...EMPTY_PERSISTED }
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...EMPTY_PERSISTED }
    const parsed = JSON.parse(raw) as Partial<PersistedOnboard>
    return {
      status: isStatus(parsed.status) ? parsed.status : 'unseen',
      step: isStep(parsed.step) ? parsed.step : 'upload',
      company: typeof parsed.company === 'string' ? parsed.company : '',
      dept: typeof parsed.dept === 'string' ? parsed.dept : '',
      yourName: typeof parsed.yourName === 'string' ? parsed.yourName : '',
      playbooks: Array.isArray(parsed.playbooks)
        ? parsed.playbooks.filter((p): p is string => typeof p === 'string')
        : [...DEFAULT_PLAYBOOKS],
    }
  } catch {
    // 解析失败/无痕模式——退回内存态，不崩页面（同 flowStore 兜底）。
    return { ...EMPTY_PERSISTED }
  }
}

function savePersisted(state: PersistedOnboard) {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        status: state.status,
        step: state.step,
        company: state.company,
        dept: state.dept,
        yourName: state.yourName,
        playbooks: state.playbooks,
      }),
    )
  } catch {
    // 写满/被拒——本次仍在内存态生效，不抛错。
  }
}

interface OnboardState extends PersistedOnboard {
  // × 关闭 = 本次会话内不再弹（session-only，不持久化）；status 留 in-progress，
  // 下次访问从记住的 step 续进度——"可中途关闭下次续进度"（PRD F7）。
  pausedThisSession: boolean

  // open-loop-0720 · Danny 拍板「有数据就不弹」时选的那个选项原话是「弹窗保留在菜单里
  // 随时能再看」——但那个"随时能再看"的入口从没被造出来（Playbooks 屏加了一个按钮调
  // reopen()）。session-only、不持久化，同 pausedThisSession 一个道理：这只是"这次访问
  // 里向导正被强制掀开"的开关，不是持久状态的一部分。
  //
  // 🔴 为什么不能只调 begin()：① begin() 守着 `status !== 'unseen'` 才生效，对已经
  // done/skipped 的老客户是空操作；② 就算 status 变回来了，selectWizardOpen 第一行
  // `if (hasStoredContext) return false` 会把它按回去——hadContextOnLoad 对老客户恒真，
  // 这条线直接杀死"已有数据"的返回客户，而这批人恰恰是「重看」这个入口要服务的对象。
  // 所以 forceOpen 必须是独立于 hasStoredContext 的第二条门（OnboardWizard 里 `||` 合并），
  // 手动点开就无视"有没有数据"这条自动弹出的规矩——用户自己要看，不是产品硬塞。
  forceOpen: boolean

  begin: () => void // unseen → in-progress（向导首次挂载时调）
  goStep: (step: OnboardStep) => void
  setField: (field: 'company' | 'dept' | 'yourName', value: string) => void
  togglePlaybook: (id: string) => void
  pause: () => void // × 关闭（session-only）
  skip: () => void // 明确跳过 → 永不再骚扰
  finish: () => void // 走完 → 永不再弹，勾选生效
  reopen: () => void // open-loop-0720：菜单里的「重看上手引导」入口调这个——强制掀开，
  // 从第①步起（不续旧进度："重看"是完整再走一遍，不是"接着上次卡住的地方"）。
}

export const useOnboard = create<OnboardState>((set, get) => {
  const initial = loadPersisted()

  function persist() {
    const { status, step, company, dept, yourName, playbooks } = get()
    savePersisted({ status, step, company, dept, yourName, playbooks })
  }

  return {
    ...initial,
    pausedThisSession: false,
    forceOpen: false,

    begin: () => {
      if (get().status !== 'unseen') return
      set({ status: 'in-progress' })
      persist()
    },
    goStep: (step) => {
      set({ step })
      persist()
    },
    setField: (field, value) => {
      set({ [field]: value } as Partial<OnboardState>)
      persist()
    },
    togglePlaybook: (id) => {
      set((s) => ({
        playbooks: s.playbooks.includes(id)
          ? s.playbooks.filter((p) => p !== id)
          : [...s.playbooks, id],
      }))
      persist()
    },
    // forceOpen 一并落回 false——三条关闭路径（× / 跳过 / 走完）都是"这次强制掀开的向导
    // 该收起了"，不然 reopen 之后再关一次，屏幕上还是照样挂着。
    pause: () => set({ pausedThisSession: true, forceOpen: false }),
    skip: () => {
      set({ status: 'skipped', forceOpen: false })
      persist()
    },
    finish: () => {
      set({ status: 'done', forceOpen: false })
      persist()
    },
    reopen: () => set({ forceOpen: true, pausedThisSession: false, step: 'upload' }),
  }
})

// 向导是否应该在壳里挂载（Lite2App 消费）——首访或续进度中，且本会话没被 × 掉。
//
// 07-20 · Danny 拍板「已经有数据就不弹」，不是「点过一次就不弹」（bug：老客户上周传过
// 数据，今天重进照样先吃一个"开始上手"挡住自己的数据——begin() 在向导**首次挂载**
// 时就把 unseen 落成 in-progress 并持久化，此后每次刷新 pausedThisSession 都重置为
// false，于是 status==='in-progress' && !pausedThisSession 永远为真，跟有没有数据
// 毫无关系）。
//
// hasStoredContext 由调用方（OnboardWizard）传入，不在本文件里直接 import useLite——
// 本 store 刻意独立于 store.ts（见文件头注释的"减冲突面"切分原则），调用方那边已经在读
// useLite 了（上传接线那条路径），让它多带一个算好的布尔值过来，比在这儿新开一条跨
// store 依赖更便宜、冲突面更小。
//
// 🔴 调用方契约：hasStoredContext 必须是"这次页面加载一开始"就定下的快照（同 store.ts
// 自己 restoredContextId 的"只读一次、不订阅"套路），不能是响应式的当前 contextId——
// 否则向导自己①上传步一成功、contextId 落地，会在用户正走②③④步时被这条新规则回头
// 把向导关掉（好心办坏事：一个全新用户会被自己刚完成的动作误伤）。
//
// 不看 status 是 unseen 还是 in-progress 就直接拦：老客户完全可能从没点开过向导本身
// （数据是从别的路径——UploadPanel——传的），这种人 persisted status 仍是 unseen；
// 也可能上周点开过一次又 × 掉，这种人 status 早被 begin() 落成 in-progress。两种人
// 的共同点只有一个——"已经有数据"——这正是 Danny 拍板要认的那把尺子。
export function selectWizardOpen(s: OnboardState, hasStoredContext: boolean): boolean {
  if (hasStoredContext) return false
  return (s.status === 'unseen' || s.status === 'in-progress') && !s.pausedThisSession
}
