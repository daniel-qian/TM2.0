import { create } from 'zustand'
import { BRIEFING_V1, BRIEFING_V2, type Briefing, type TaskTemplate } from '../data/fixtures'
import {
  CASES,
  DEFAULT_CASE_ID,
  resolveCaseForQuestion,
  type CaseId,
  type ThreadStepKind,
} from '../data/cases'

// 单一事实源（ADR-0003）：一套 state + 一套 action，free-click 与 rail 都只走这套 action。
// rail = 之上的薄 driver（删 rail = 删 SCRIPT + DemoControls，不删任何行为）。
//
// 本文件 = ADR-0013 contract pass 的产物（P6-01，取代 P0.5 冻结形）：
// 多 thread Nexus——`threads` 按 caseId 键 + `activeCaseId`；编排表/拓扑/Manifest 全部
// 来自 per-case 定义（src/data/cases.ts），store 零 case 专属常量。
//
// ★ 契约重新冻结。锁定的 action 集（P6 wave 后续 issue 不得再扩）：
//   runAgent / dispatchTask / regenBriefing / askQuestion /
//   goScene / setFocus / openDetail / back /
//   openThread / closeThread / askFollowUp / sendEmail
//   + pinThreadProgress（feat-034 polish 唯一追加：rail"钉状态"拍的显式 set 接口，
//     见其注释——增量 consume 在快按/乱序下无法保证落拍状态唯一，故开此口）
// ADR-0006 / ADR-0012 的「不扩 canvasStore」自本 pass 后读作「不扩本契约」。
// 镜头命令仍不进 store（ADR-0012）；rail replay 机器（pristine 快照 + replay-to-target）
// 原样工作——所有 action 幂等友好 / append 序确定，seek 任意 index 自洽。

export type Scene =
  | 'onboarding'
  | 'home' // feat-014（ADR-0017）：卡片式今日主页 = 进门第一面（surface label "Your team"）
  | 'dashboard' // Team map 全景子视图（经 home 入口进入，不再是 tab）
  | 'nexus'
  | 'project'
  | 'employee'
  | 'capabilities'

// focus = calm 的反面：点亮一组关联实体（其余淡化），可由三种选择器产生。
// 单点节点也点亮"该实体 + 关联集合"，不是只亮被点那一个（beat B2「相关亮/无关淡」）。
// 集合的解析逻辑在 src/lib/focus.ts（纯函数吃 fixtures）；store 只存已解析结果，保持 dumb。
export type FocusSource = 'node' | 'tag' | 'search'

export interface Focus {
  source: FocusSource
  projectIds: string[] // 点亮的项目 → .is-related
  personIds: string[] // 点亮的人 → .is-related
  primary?: { kind: 'person' | 'project'; id: string } // 锚点（node 来源=被点那个）→ .is-focused
  selector?: { tags?: string[]; query?: string } // 顶部 UI 回显当前 tag / 搜索词
}

export type Detail = { kind: 'project' | 'employee'; id: string } | null

// step kind 全集住在 per-case 定义（src/data/cases.ts）；此处 re-export 维持既有 import 面。
export type { ThreadStepKind, CaseId }

export interface ThreadStep {
  kind: ThreadStepKind
  followUpId?: string // 来自 follow-up 段的步骤带段 id（主段步骤不带）
}

export type ThreadStatus = 'idle' | 'running' | 'complete'

// 已追加的 follow-up：question = 显示的提问文本（chip 文本或 composer 自由文本），
// segmentId 指向 case 定义里的段——步骤表由此确定性派生（threadPlan）。
export interface AskedFollowUp {
  question: string
  segmentId: string
}

// Thread（CONTEXT.md）：Nexus 内的一次编排会话，自己的 context 预算；
// 彼此独立、可关闭、可从历史重开——closeThread 只翻 isOpen，状态全保留（ADR-0013 决策 1/6）。
export interface Thread {
  caseId: CaseId
  question: string | null // 启动该 thread 的问题（askQuestion / openThread 预填）
  steps: ThreadStep[] // 随 runAgent 累积
  status: ThreadStatus
  isOpen: boolean // 关闭 ≠ 删除：tab 收起，history 可重开（P6-02）
  followUps: AskedFollowUp[] // 已追加的 follow-up 段（askFollowUp 确定性 append）
  emailSent: boolean // email case 的 Send 已点（sendEmail dedupe guard，P6-06）
}

export interface DispatchedTask extends TaskTemplate {
  id: string
}

export function pristineThread(caseId: CaseId): Thread {
  return {
    caseId,
    question: null,
    steps: [],
    status: 'idle',
    isOpen: true,
    followUps: [],
    emailSent: false,
  }
}

// thread 的有效编排表 = case 主段 + 已追加的 follow-up 段（确定性派生，replay-safe）。
// runAgent 按 steps.length 取下一步；P6-04 的 Step x/x 分母也从这里来。
export function threadPlan(thread: Thread): Array<{ kind: ThreadStepKind; followUpId?: string }> {
  const def = CASES[thread.caseId]
  if (!def) return []
  return [
    ...def.orchestration.map((kind) => ({ kind })),
    ...thread.followUps.flatMap((f) => {
      const segment = def.followUps.find((s) => s.id === f.segmentId)
      return (segment?.steps ?? []).map((kind) => ({ kind, followUpId: f.segmentId }))
    }),
  ]
}

interface CanvasState {
  scene: Scene
  focus: Focus | null // null = calm（点空白 → setFocus(null)）
  detail: Detail
  briefing: Briefing // 当前 Dashboard 上的 Briefing（B1 = V1，B10 regen → V2）
  threads: Record<CaseId, Thread> // 按 caseId 键；初始为空——不预置假历史（ADR-0013 决策 6）
  activeCaseId: CaseId | null // null = 尚无 thread（Nexus 显示 hero case 空态）
  tasks: DispatchedTask[] // B9 经人确认派出的 task

  // ── 导航 ──
  goScene: (scene: Scene) => void
  setFocus: (focus: Focus | null) => void // 三种选择器统一出口；null = 恢复 calm
  openDetail: (kind: 'project' | 'employee', id: string) => void // drill-in
  back: () => void

  // ── 编排 / 内容 ──
  askQuestion: (text: string) => void // B3 composer → 问题进对应 case 的 thread（case-aware）
  runAgent: () => void // 无参：从 active case 的编排表按 steps.length 取下一步
  dispatchTask: (template: TaskTemplate) => void // B9 派 task（不进 SCRIPT，Danny 现场点）
  regenBriefing: () => void // B10 重生成 Briefing（v1 → v2）

  // ── thread 生命周期 + follow-up（ADR-0013）──
  openThread: (caseId: CaseId) => void // 开/重开 + 置 active；幂等
  closeThread: (caseId: CaseId) => void // 只翻 isOpen，状态全保留；幂等
  askFollowUp: (text: string) => void // 追加 active case 的下一个 follow-up 段；确定性
  sendEmail: () => void // email case 的 Send；dedupe-guarded（不进 SCRIPT，同 dispatchTask）
  // feat-034 polish：把 thread 的编排进度"钉"到确定点位（rail 钉状态拍 A1/A2 专用）。
  pinThreadProgress: (caseId: CaseId, followUpCount: number, stepCount: number) => void
}

export const useCanvas = create<CanvasState>((set, get) => ({
  scene: 'home',
  focus: null,
  detail: null,
  briefing: BRIEFING_V1,
  threads: {},
  activeCaseId: null,
  tasks: [],

  goScene: (scene) => set({ scene }),
  setFocus: (focus) => set({ focus }),
  openDetail: (kind, id) => set({ scene: kind, detail: { kind, id } }),
  back: () => set({ scene: 'home', detail: null, focus: null }),

  // case-aware（ADR-0013）：文本命中某 case 默认问题 → 该 case；其余落 hero case。
  // 重复提问重置该 case 的 thread（与冻结前单 thread 行为一致）。
  askQuestion: (text) =>
    set((s) => {
      const caseId = resolveCaseForQuestion(text)
      return {
        scene: 'nexus',
        activeCaseId: caseId,
        threads: {
          ...s.threads,
          [caseId]: { ...pristineThread(caseId), question: text, status: 'running' },
        },
      }
    }),

  // 无参推进：active thread（无则在 hero case 上懒建——保住「直接进 Nexus 点 Start」的
  // free-click 路径）按其有效编排表取下一步；follow-up 段步骤自动带 followUpId。
  runAgent: () =>
    set((s) => {
      const caseId = s.activeCaseId ?? DEFAULT_CASE_ID
      const thread = s.threads[caseId] ?? pristineThread(caseId)
      const plan = threadPlan(thread)
      const next = plan[thread.steps.length]
      if (!next) {
        return {
          activeCaseId: caseId,
          threads: { ...s.threads, [caseId]: { ...thread, status: 'complete' } },
        }
      }
      const steps = [
        ...thread.steps,
        next.followUpId ? { kind: next.kind, followUpId: next.followUpId } : { kind: next.kind },
      ]
      return {
        activeCaseId: caseId,
        threads: {
          ...s.threads,
          [caseId]: {
            ...thread,
            steps,
            status: steps.length === plan.length ? 'complete' : 'running',
          },
        },
      }
    }),

  dispatchTask: (template) =>
    set((s) => {
      const alreadyDispatched = s.tasks.some(
        (task) =>
          task.title === template.title &&
          task.assigneeId === template.assigneeId &&
          task.due === template.due,
      )

      if (alreadyDispatched) return s

      return { tasks: [...s.tasks, { ...template, id: `dt_${s.tasks.length + 1}` }] }
    }),

  regenBriefing: () => set({ briefing: BRIEFING_V2 }),

  // 开/重开 thread：已存在则只翻 isOpen + 置 active（steps/Manifest 原样回来）；
  // 不存在则以 case 默认问题建新 thread。幂等：重复调用结果相同。
  openThread: (caseId) =>
    set((s) => {
      const def = CASES[caseId]
      if (!def) return s
      const existing = s.threads[caseId]
      const thread = existing
        ? { ...existing, isOpen: true }
        : { ...pristineThread(caseId), question: def.question }
      return { activeCaseId: caseId, threads: { ...s.threads, [caseId]: thread } }
    }),

  // 关 thread：只翻 isOpen，数据一根不丢（ADR-0013 决策 1）。关的是 active → 切到剩余
  // open thread 之一（注册表序），全关则 null（Nexus 空态，composer 待命——P6-02）。幂等。
  closeThread: (caseId) =>
    set((s) => {
      const existing = s.threads[caseId]
      if (!existing || !existing.isOpen) return s
      const threads = { ...s.threads, [caseId]: { ...existing, isOpen: false } }
      const activeCaseId =
        s.activeCaseId === caseId
          ? (Object.values(threads).find((t) => t.isOpen)?.caseId ?? null)
          : s.activeCaseId
      return { threads, activeCaseId }
    }),

  // follow-up（ADR-0013 决策 5）：把 active case 的下一个未消费 follow-up 段追加进该
  // thread 的编排表（步骤由 runAgent 继续走），text 作为显示的提问。确定性：第 n 次调用
  // 永远消费第 n 段；段耗尽则 no-op——同文本重放结果相同（replay-safe）。
  askFollowUp: (text) =>
    set((s) => {
      const caseId = s.activeCaseId ?? DEFAULT_CASE_ID
      const thread = s.threads[caseId]
      const def = CASES[caseId]
      if (!thread || !def) return s
      const segment = def.followUps[thread.followUps.length]
      if (!segment) return s
      return {
        threads: {
          ...s.threads,
          [caseId]: {
            ...thread,
            followUps: [...thread.followUps, { question: text, segmentId: segment.id }],
            status: 'running', // 编排表延长，等 runAgent 继续走
          },
        },
      }
    }),

  // ── feat-034 polish：钉状态（pin）语义 ─────────────────────────────────────
  // 把 caseId thread 的编排进度钉到确定点位：followUps 恰好 = case 段序列的前
  // followUpCount 段前缀，steps 恰好 = 有效编排表（threadPlan）的前 stepCount 步前缀。
  // 幂等：同参调用结果恒定——与此前 chip 是否被点过、按键多快、来路顺序全部无关。
  //
  // 为什么不用 askFollowUp+runAgent（增量 consume）：增量式的落点 = f(当前状态)，
  // 快按（同 tick 多发 runAgent）会越过等待态、free-click 先消费过段落则 rail 拍变
  // 空拍——"钉"把落点变成 f(参数)，rail 拍所见即所得（root cause 修法，非防抖贴膏药）。
  //
  // 细节：已消费段的显示问题文本保留（free-click 自由文本不被 pin 覆盖，只补缺）；
  // isOpen 强制 true（钉的拍卡必须在屏上）；status 由步数与编排表长度派生；
  // 只触碰该 caseId 的 thread——其他 case / tasks / briefing 一概不动。
  pinThreadProgress: (caseId, followUpCount, stepCount) =>
    set((s) => {
      const def = CASES[caseId]
      if (!def) return s
      const base = s.threads[caseId] ?? { ...pristineThread(caseId), question: def.question }
      const followUps = def.followUps
        .slice(0, Math.max(0, Math.min(followUpCount, def.followUps.length)))
        .map((segment, i) =>
          base.followUps[i]?.segmentId === segment.id
            ? base.followUps[i]
            : { question: segment.suggestedQuestion, segmentId: segment.id },
        )
      const pinned: Thread = { ...base, isOpen: true, followUps, steps: [], status: 'running' }
      const plan = threadPlan(pinned)
      const steps = plan
        .slice(0, Math.max(0, Math.min(stepCount, plan.length)))
        .map((next) =>
          next.followUpId ? { kind: next.kind, followUpId: next.followUpId } : { kind: next.kind },
        )
      return {
        activeCaseId: caseId,
        threads: {
          ...s.threads,
          [caseId]: {
            ...pinned,
            steps,
            status: steps.length >= plan.length ? 'complete' : 'running',
          },
        },
      }
    }),

  // Send（P6-06）：active thread 的邮件发出。dedupe guard：已发则 no-op。
  // 与 dispatchTask 同口径（ADR-0006 决策 5）：不进 rail SCRIPT，Danny 现场亲手点；
  // rail seek 重置已点状态，接受。
  sendEmail: () =>
    set((s) => {
      const caseId = s.activeCaseId
      if (!caseId) return s
      const thread = s.threads[caseId]
      if (!thread || thread.emailSent) return s
      return { threads: { ...s.threads, [caseId]: { ...thread, emailSent: true } } }
    }),
}))
