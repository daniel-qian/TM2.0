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

  begin: () => void // unseen → in-progress（向导首次挂载时调）
  goStep: (step: OnboardStep) => void
  setField: (field: 'company' | 'dept' | 'yourName', value: string) => void
  togglePlaybook: (id: string) => void
  pause: () => void // × 关闭（session-only）
  skip: () => void // 明确跳过 → 永不再骚扰
  finish: () => void // 走完 → 永不再弹，勾选生效
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
    pause: () => set({ pausedThisSession: true }),
    skip: () => {
      set({ status: 'skipped' })
      persist()
    },
    finish: () => {
      set({ status: 'done' })
      persist()
    },
  }
})

// 向导是否应该在壳里挂载（Lite2App 消费）——首访或续进度中，且本会话没被 × 掉。
export function selectWizardOpen(s: OnboardState): boolean {
  return (s.status === 'unseen' || s.status === 'in-progress') && !s.pausedThisSession
}
