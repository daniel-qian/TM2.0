import { create } from 'zustand'
import type { Dict } from '../shared/i18n'

// feat-045 · lite2 onboarding 状态（PRD F7；input-side-0721 起承载全屏闸门页 OnboardGate；
// onboarding-accounts-0805 ③ 起是**合伙人稿的 5 步向导**，ADR-0034 拍板 7/8/9）。
//
// 本 store 只管五件事：
//   ① 生命周期：unseen（首访，自动掀开闸门）→ in-progress（走到哪步记到哪步，Escape/先逛逛
//      下次续进度）→ skipped（明确跳过，永不再骚扰）/ done（走完）。
//   ② 管理范围本地配置（公司/部门/称呼/人数/职位——供问候语用；只存本机 localStorage）。
//   ③ 8A「公司现状」口述（companyNote——**这一格会送后端** company_notes，送出机制在
//      onboardNote.ts，幂等账本 companyNoteSentTo）。
//   ④ 连接意向（tools）与管理框架（frameworks）：**只存本机、不影响分析**，界面如实标注。
//   ⑤ 预览模式（preview）：自由步进、跳过校验、**任何数据不落库不发请求**（拍板 8）。
// 持久化走 localStorage（lite2 前缀 key），手写同步 load/save——与 flowStore.ts 同一模式、
// 同一理由（zustand persist 中间件的异步 hydrate 首帧闪空态；这里 store 创建时即最终态）。
//
// 🔴 红线仍在，只是措辞随事实更新了：以前这里写着「不做假『连接工具』步、不做假『创建账号』
// 步」。ADR-0034 之后两步都**真的做**了，但做法不是造假：连接工具步只登记意向并明说「暂未
// 开通连接」（不造假连接态、不发假 OAuth），账号步接的是真 Supabase GoTrue（feat-053 那套，
// 生产实探 /account/status 200）。红线从来不是「不许有这一步」，而是「屏幕上不许出现假的
// 状态」——两步都守着后者。

// input-side-0721 → onboarding-accounts-0805：持久化键升 v2。旧 v1 里只有问候语字段、
// playbook 勾选与步骤位置，而步骤名整套换了（upload/team/playbooks → intake/scope/prefs…），
// 作废无害：新用户从头走，老用户丢的只是"上次停在第几步"。刻意**不写迁移**——为三个字符串
// 写一段一次性映射代码，比让它自然过期更贵，也更容易在下一次改步骤时被忘掉。
const STORAGE_KEY = 'lite2:onboard:v2'

export type OnboardStatus = 'unseen' | 'in-progress' | 'skipped' | 'done'

// 合伙人静态稿的五步（ADR-0034 拍板 10 的开发顺序也照这个序）：
//   intake  ① 录入标准数据包（7 张表 + 文件上传并存，一发提交 → 一个 context）
//   tools   ② 连接日常工作工具（纯登记意向，明说暂未开通）
//   scope   ③ 确认管理范围（公司/部门/人数/称呼/岗位 + 公司现状口述）
//   prefs   ④ 选择管理偏好（5 个管理框架）
//   account ⑤ 创建管理者账号（可跳过；未配置 Supabase 时整步隐去）
// doors 与 done 不是编号步：前者是进门的三扇门（拍板 7 保留），后者是总结页。
export type OnboardStep = 'doors' | 'intake' | 'tools' | 'scope' | 'prefs' | 'account' | 'done'

/** 底部 chips 上出现的那五步（编号 1–5）。doors/done 不进 chips。 */
export const WIZARD_STEPS: OnboardStep[] = ['intake', 'tools', 'scope', 'prefs', 'account']

/** 全部步骤的**导航序**（上一步/下一步按它走）。 */
export const ONBOARD_STEPS: OnboardStep[] = ['doors', ...WIZARD_STEPS, 'done']

// 🔴 账号步是**可缺席**的：没配 Supabase（或后端没挂账号路由）时整步隐去，向导四步走完
// （票 #43）。所以导航序不能写死成模块常量——两个选择器按"这份部署有没有账号能力"算出
// 当前真实的序。不出死按钮，也不出一个点了没反应的 chip。
export function visibleWizardSteps(accountAvailable: boolean): OnboardStep[] {
  return accountAvailable ? WIZARD_STEPS : WIZARD_STEPS.filter((s) => s !== 'account')
}

export function visibleSteps(accountAvailable: boolean): OnboardStep[] {
  return ['doors', ...visibleWizardSteps(accountAvailable), 'done']
}

// ── ② 连接日常工作工具（ADR-0034 拍板 9）──────────────────────────────────────────────────
// 六张卡照合伙人静态稿。点选 = **登记意向**，只存本机；界面同屏明说「暂未开通连接」。
// 🔴 绝不造假连接态：没有"已连接"绿点、没有假 OAuth 跳转、没有假同步计数。一个只登记意向的
// 复选框是诚实的；一个写着"已连接"的开关是撒谎，而这条线上撒过的谎最后都要还。
export interface OnboardChoice {
  id: string
  title: (l: Dict['lite2']) => string
  body: (l: Dict['lite2']) => string
}

export const TOOL_CATALOG: OnboardChoice[] = [
  { id: 'wecom', title: (l) => l.onboardToolWecomTitle, body: (l) => l.onboardToolWecomBody },
  { id: 'feishu', title: (l) => l.onboardToolFeishuTitle, body: (l) => l.onboardToolFeishuBody },
  { id: 'dingtalk', title: (l) => l.onboardToolDingtalkTitle, body: (l) => l.onboardToolDingtalkBody },
  { id: 'oa', title: (l) => l.onboardToolOaTitle, body: (l) => l.onboardToolOaBody },
  { id: 'bi', title: (l) => l.onboardToolBiTitle, body: (l) => l.onboardToolBiBody },
  { id: 'crm', title: (l) => l.onboardToolCrmTitle, body: (l) => l.onboardToolCrmBody },
]

// ── ④ 管理偏好：合伙人的 5 个管理框架（ADR-0034 拍板 9）────────────────────────────────────
// 与 Playbooks 屏那 8 项目录**不互斥**：那 8 项讲的是"你的 SOP 会长成什么"，这 5 项讲的是
// "你习惯用哪套管理语言"。选择只存本地、不影响分析——界面如实标注，不假装它改变了什么。
export const FRAMEWORK_CATALOG: OnboardChoice[] = [
  { id: 'goal-alignment', title: (l) => l.onboardFrameworkGoalTitle, body: (l) => l.onboardFrameworkGoalBody },
  { id: 'coaching', title: (l) => l.onboardFrameworkCoachingTitle, body: (l) => l.onboardFrameworkCoachingBody },
  { id: 'fairness', title: (l) => l.onboardFrameworkFairnessTitle, body: (l) => l.onboardFrameworkFairnessBody },
  { id: 'raci', title: (l) => l.onboardFrameworkRaciTitle, body: (l) => l.onboardFrameworkRaciBody },
  { id: 'reality-gap', title: (l) => l.onboardFrameworkGapTitle, body: (l) => l.onboardFrameworkGapBody },
]

// 静态稿的默认：前两项 + 现实差距检测。
export const DEFAULT_FRAMEWORKS = ['goal-alignment', 'coaching', 'reality-gap']

// ── Playbooks 屏仍在用的 8 项目录（feat-045）─────────────────────────────────────────────
// 向导里那一步已被 5 个管理框架取代（拍板 9），但目录本身**不动**——PlaybooksScreen 的
// 「你在设置里选的」槽位仍读 `playbooks`。
// 🔴 默认值从「勾 3 项」改成**空数组**，这是随步骤消失必须一起改的一处诚实：那三项曾是
// 用户在向导里真勾的，现在没有任何界面能勾它们，再默认勾上就等于替用户宣称他选过。
// picks 为空时 PlaybooksScreen 自己回落到通用槽位预告（它本来就有那条分支）。
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

interface PersistedOnboard {
  status: OnboardStatus
  step: OnboardStep
  company: string
  dept: string
  yourName: string
  teamCount: string
  yourRole: string
  companyNote: string
  // companyNote 已送达过的 context id 清单（幂等账本：同一个 context 只送一次；
  // 新 context ——新上传/新示例副本——各送一次，因为每个 context 是独立的工作区）。
  companyNoteSentTo: string[]
  tools: string[]
  frameworks: string[]
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
  tools: [],
  frameworks: [...DEFAULT_FRAMEWORKS],
  playbooks: [],
}

function isStatus(v: unknown): v is OnboardStatus {
  return v === 'unseen' || v === 'in-progress' || v === 'skipped' || v === 'done'
}

function isStep(v: unknown): v is OnboardStep {
  return (ONBOARD_STEPS as string[]).includes(v as string)
}

function strList(v: unknown, fallback: string[]): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : fallback
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
      companyNoteSentTo: strList(parsed.companyNoteSentTo, []),
      tools: strList(parsed.tools, []),
      frameworks: strList(parsed.frameworks, [...DEFAULT_FRAMEWORKS]),
      playbooks: strList(parsed.playbooks, []),
    }
  } catch {
    // 解析失败/无痕模式——退回内存态，不崩页面（同 flowStore 兜底）。
    return { ...EMPTY_PERSISTED }
  }
}

function snapshot(s: PersistedOnboard): PersistedOnboard {
  const { status, step, company, dept, yourName, teamCount, yourRole, companyNote,
          companyNoteSentTo, tools, frameworks, playbooks } = s
  return { status, step, company, dept, yourName, teamCount, yourRole, companyNote,
           companyNoteSentTo: [...companyNoteSentTo], tools: [...tools],
           frameworks: [...frameworks], playbooks: [...playbooks] }
}

function savePersisted(state: PersistedOnboard) {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot(state)))
  } catch {
    // 写满/被拒——本次仍在内存态生效，不抛错。
  }
}

interface OnboardState extends PersistedOnboard {
  // × 关闭 = 本次会话内不再弹（session-only，不持久化）；status 留 in-progress，
  // 下次访问从记住的 step 续进度——"可中途关闭下次续进度"（PRD F7）。
  pausedThisSession: boolean

  // open-loop-0720 · 手动重看向导的开关（session-only）。与 selectWizardOpen 的"要不要自动弹"
  // 是两条独立判据：hadContextOnLoad 对老客户恒真，只改 status 会被它按回去，而"重看"这个
  // 入口服务的恰恰是有数据的老客户。OnboardGate 里用 `||` 合并。
  forceOpen: boolean

  // ── 预览模式（ADR-0034 拍板 8）────────────────────────────────────────────────────────
  // 「可以直接查看全部步骤；未填写的数据不会保存，也不会用于分析」。三件事同时成立：
  //   ① 自由步进：chips 与上一步/下一步随便走，跳过所有校验；
  //   ② 不落库：所有写操作只改内存，`persist()` 整个跳过；
  //   ③ 不发请求：提交按钮、注册按钮、companyNote 送出全部让路（各组件按 preview 判）。
  // 退出预览时把进入前的快照原样还回去——否则"不会保存"就只是一句话，进过一次预览就把
  // 用户真填过的东西改掉了。
  preview: boolean
  previewRestore: PersistedOnboard | null

  begin: () => void // unseen → in-progress（向导首次挂载时调）
  goStep: (step: OnboardStep) => void
  setField: (
    field: 'company' | 'dept' | 'yourName' | 'teamCount' | 'yourRole' | 'companyNote',
    value: string,
  ) => void
  // 8A 幂等账本：companyNote 已送达某 context 后记一笔（onboardNote.ts 是唯一写方）。
  markCompanyNoteSent: (contextId: string) => void
  toggleTool: (id: string) => void
  toggleFramework: (id: string) => void
  pause: () => void // × 关闭（session-only）
  skip: () => void // 明确跳过 → 永不再骚扰
  finish: () => void // 走完 → 永不再弹，勾选生效
  enterPreview: () => void
  exitPreview: () => void
  // open-loop-0720 的「重看上手引导」入口（Playbooks 屏）。ADR-0034 拍板 8 之后它走**预览
  // 模式**：这批人恰恰是已经有数据的老客户，让他们重走一遍真向导等于给自己的工作区上风险。
  reopen: () => void
}

export const useOnboard = create<OnboardState>((set, get) => {
  const initial = loadPersisted()

  function persist() {
    // 🔴 新增持久字段必须同时进 `snapshot()` 的解构——漏一个，那个字段就"看起来能存、刷新即
    // 蒸发"（savePersisted 读到 undefined，JSON 里键直接消失，load 回来落默认值）。
    // 预览模式下整个跳过：这是"不落库"那句话的兑现处，不是优化。
    if (get().preview) return
    savePersisted(get())
  }

  return {
    ...initial,
    pausedThisSession: false,
    forceOpen: false,
    preview: false,
    previewRestore: null,

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
    toggleTool: (id) => {
      set((s) => ({
        tools: s.tools.includes(id) ? s.tools.filter((t) => t !== id) : [...s.tools, id],
      }))
      persist()
    },
    toggleFramework: (id) => {
      set((s) => ({
        frameworks: s.frameworks.includes(id)
          ? s.frameworks.filter((f) => f !== id)
          : [...s.frameworks, id],
      }))
      persist()
    },
    // 三条关闭路径（× / 跳过 / 走完）都顺手落 forceOpen=false，并**退出预览**——否则重看
    // 一次再关掉，屏幕上还挂着，或者下次进来还在预览态里。
    pause: () => {
      const { preview, previewRestore } = get()
      set({
        pausedThisSession: true, forceOpen: false, preview: false, previewRestore: null,
        ...(preview && previewRestore ? previewRestore : {}),
      })
    },
    skip: () => {
      const { preview, previewRestore } = get()
      if (preview) {
        // 预览态里的「跳过」不是"我决定不做 onboarding"，只是关掉这次预览——预览按定义
        // 不改任何持久状态，把 status 落成 skipped 就是拿一次浏览替用户做了决定。
        set({ preview: false, previewRestore: null, forceOpen: false,
              ...(previewRestore ?? {}) })
        return
      }
      set({ status: 'skipped', forceOpen: false })
      persist()
    },
    finish: () => {
      const { preview, previewRestore } = get()
      if (preview) {
        set({ preview: false, previewRestore: null, forceOpen: false,
              ...(previewRestore ?? {}) })
        return
      }
      set({ status: 'done', forceOpen: false })
      persist()
    },
    enterPreview: () => {
      if (get().preview) return
      set({
        preview: true,
        previewRestore: snapshot(get()),
        forceOpen: true,
        pausedThisSession: false,
        // 预览从第 ① 步起：三扇门是"怎么开始"，而预览要看的正是门后面那五步。
        step: 'intake',
      })
    },
    exitPreview: () => {
      const restore = get().previewRestore
      set({
        preview: false,
        previewRestore: null,
        forceOpen: false,
        ...(restore ?? {}),
      })
    },
    reopen: () => get().enterPreview(),
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
// 本 store 刻意独立于 store.ts（"减冲突面"切分原则），调用方那边已经在读 useLite 了。
//
// 🔴 调用方契约：hasStoredContext 必须是"这次页面加载一开始"就定下的快照（同 store.ts
// 自己 restoredContextId 的"只读一次、不订阅"套路），不能是响应式的当前 contextId——
// 否则向导自己①录入步一成功、contextId 落地，会在用户正走②③④步时被这条新规则回头
// 把向导关掉（好心办坏事：一个全新用户会被自己刚完成的动作误伤）。
export function selectWizardOpen(s: OnboardState, hasStoredContext: boolean): boolean {
  if (hasStoredContext) return false
  return (s.status === 'unseen' || s.status === 'in-progress') && !s.pausedThisSession
}

// ── arch-0802 · 公司域清扫收口 ────────────────────────────────────────────────────────────
// 同 flowStore.resetFlowCompanyScope 的口径：清单与 state 形状同文件共置。向导采集的全部
// 是公司数据（公司名/部门/称呼/团队规模/角色/「公司现状」口述/送达账本/连接意向/管理框架），
// 换账号一个都不许活。🔴 往 PersistedOnboard/OnboardState 加字段时必须同步决定进不进这里；
// pausedThisSession / preview / previewRestore 是内存态（EMPTY_PERSISTED 不含它们），别漏。
// frameworks 给新数组，不共享 DEFAULT_FRAMEWORKS 模块常量的引用。
export function resetOnboardCompanyScope(): void {
  useOnboard.setState({
    ...EMPTY_PERSISTED,
    tools: [],
    frameworks: [...DEFAULT_FRAMEWORKS],
    playbooks: [],
    pausedThisSession: false,
    preview: false,
    previewRestore: null,
  })
}
