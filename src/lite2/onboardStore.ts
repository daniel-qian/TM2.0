import { create } from 'zustand'
import type { Dict } from '../shared/i18n'

// feat-045 · lite2 onboarding 状态（PRD F7；input-side-0721 起承载全屏闸门页 OnboardGate）。
// 独立于 store.ts / flowStore.ts（同 feat-036 的"减冲突面"切分原则）——这里只管四件事：
//   ① 生命周期：unseen（首访，自动掀开闸门）→ in-progress（走到哪步记到哪步，Escape/先逛逛
//      下次续进度）→ skipped（明确跳过，永不再骚扰）/ done（走完）。
//   ② 团队信息本地配置（公司/部门/称呼/人数/职位——供问候语用；只存本机 localStorage）。
//   ③ 8A「公司现状」口述（companyNote——**这一格会送后端** company_notes，送出机制在
//      onboardNote.ts，幂等账本 companyNoteSentTo）。
//   ④ playbook 勾选（8 项候选，默认勾 3；持久化，Playbooks tab 槽位按所选呈现）。
// 持久化走 localStorage（lite2 前缀 key），手写同步 load/save——与 flowStore.ts 同一模式、
// 同一理由（zustand persist 中间件的异步 hydrate 首帧闪空态；这里 store 创建时即最终态）。
//
// 🔴 红线（PRD F7 明令）：不做假"连接工具"步（假 OAuth 不诚实）、不做假"创建账号"步
// （账号有真的，在 AuthPanel——闸门不抢它的活）。步子全部真接线：上传步真调
// store.uploadFiles；示例团队门真打 /demo/claim；勾选步真写本配置。

const STORAGE_KEY = 'lite2:onboard:v1'

export type OnboardStatus = 'unseen' | 'in-progress' | 'skipped' | 'done'
// input-side-0721（Danny 拍板：onboarding 从浮层改全屏闸门页）：新增第 0 步 'doors'——
// 三扇门（一键示例团队 / 上传自己的材料 / 先自己逛逛）。老用户 localStorage 里存的
// 'upload'/'team'/... 仍是合法值（isStep 放行），中途关闭的续进度不受影响。
export type OnboardStep = 'doors' | 'upload' | 'team' | 'playbooks' | 'done'

export const ONBOARD_STEPS: OnboardStep[] = ['doors', 'upload', 'team', 'playbooks', 'done']

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
  // input-side-0721 · 8A：闸门页团队信息步扩展。teamCount/yourRole 与上面三个同性质
  // （问候语/本机配置）；companyNote 是**要送后端**的那段「公司现状」口述（见 onboardNote.ts
  // 的送出机制与 companyNoteSentTo 的幂等账本）。
  teamCount: string
  yourRole: string
  companyNote: string
  // companyNote 已送达过的 context id 清单（幂等账本：同一个 context 只送一次；
  // 新 context ——新上传/新示例副本——各送一次，因为每个 context 是独立的工作区）。
  companyNoteSentTo: string[]
  playbooks: string[]
}

const EMPTY_PERSISTED: PersistedOnboard = {
  status: 'unseen',
  step: 'doors',
  company: '',
  dept: '',
  yourName: '',
  teamCount: '',
  yourRole: '',
  companyNote: '',
  companyNoteSentTo: [],
  playbooks: [...DEFAULT_PLAYBOOKS],
}

function isStatus(v: unknown): v is OnboardStatus {
  return v === 'unseen' || v === 'in-progress' || v === 'skipped' || v === 'done'
}

function isStep(v: unknown): v is OnboardStep {
  return v === 'doors' || v === 'upload' || v === 'team' || v === 'playbooks' || v === 'done'
}

function loadPersisted(): PersistedOnboard {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return { ...EMPTY_PERSISTED }
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...EMPTY_PERSISTED }
    const parsed = JSON.parse(raw) as Partial<PersistedOnboard>
    return {
      status: isStatus(parsed.status) ? parsed.status : 'unseen',
      step: isStep(parsed.step) ? parsed.step : 'doors',
      company: typeof parsed.company === 'string' ? parsed.company : '',
      dept: typeof parsed.dept === 'string' ? parsed.dept : '',
      yourName: typeof parsed.yourName === 'string' ? parsed.yourName : '',
      teamCount: typeof parsed.teamCount === 'string' ? parsed.teamCount : '',
      yourRole: typeof parsed.yourRole === 'string' ? parsed.yourRole : '',
      companyNote: typeof parsed.companyNote === 'string' ? parsed.companyNote : '',
      companyNoteSentTo: Array.isArray(parsed.companyNoteSentTo)
        ? parsed.companyNoteSentTo.filter((c): c is string => typeof c === 'string')
        : [],
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
        teamCount: state.teamCount,
        yourRole: state.yourRole,
        companyNote: state.companyNote,
        companyNoteSentTo: state.companyNoteSentTo,
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
  // 所以 forceOpen 必须是独立于 hasStoredContext 的第二条门（OnboardGate 里 `||` 合并），
  // 手动点开就无视"有没有数据"这条自动弹出的规矩——用户自己要看，不是产品硬塞。
  forceOpen: boolean

  begin: () => void // unseen → in-progress（向导首次挂载时调）
  goStep: (step: OnboardStep) => void
  setField: (
    field: 'company' | 'dept' | 'yourName' | 'teamCount' | 'yourRole' | 'companyNote',
    value: string,
  ) => void
  // 8A 幂等账本：companyNote 已送达某 context 后记一笔（onboardNote.ts 是唯一写方）。
  markCompanyNoteSent: (contextId: string) => void
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
    // 🔴 新增持久字段必须同时进这里的解构——漏一个，那个字段就"看起来能存、刷新即蒸发"
    // （savePersisted 读到 undefined，JSON 里键直接消失，load 回来落默认值）。
    const { status, step, company, dept, yourName, teamCount, yourRole, companyNote,
            companyNoteSentTo, playbooks } = get()
    savePersisted({ status, step, company, dept, yourName, teamCount, yourRole, companyNote,
                    companyNoteSentTo, playbooks })
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
    markCompanyNoteSent: (contextId) => {
      if (!contextId || get().companyNoteSentTo.includes(contextId)) return
      set((s) => ({ companyNoteSentTo: [...s.companyNoteSentTo, contextId] }))
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
    // input-side-0721：重看从三扇门起（'doors' 取代 'upload'）——重看的人里恰有"想试试示例
    // 团队"的老客户，把最有用的那扇门放在他重看的第一眼。
    reopen: () => set({ forceOpen: true, pausedThisSession: false, step: 'doors' }),
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
// hasStoredContext 由调用方（OnboardGate）传入，不在本文件里直接 import useLite——
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

// ── arch-0802 · 公司域清扫收口 ────────────────────────────────────────────────────────────
// 同 flowStore.resetFlowCompanyScope 的口径：清单与 state 形状同文件共置。向导采集的全部
// 是公司数据（公司名/部门/称呼/团队规模/角色/「公司现状」口述/送达账本），换账号一个
// 都不许活。🔴 往 PersistedOnboard/OnboardState 加字段时必须同步决定进不进这里；
// pausedThisSession 是内存态（EMPTY_PERSISTED 不含它），别漏。playbooks 给新数组，
// 不共享 DEFAULT_PLAYBOOKS 模块常量的引用。
export function resetOnboardCompanyScope(): void {
  useOnboard.setState({
    ...EMPTY_PERSISTED,
    playbooks: [...DEFAULT_PLAYBOOKS],
    pausedThisSession: false,
  })
}
