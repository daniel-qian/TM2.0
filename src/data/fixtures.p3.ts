/**
 * TeamMaster 2.0 — P3 详情页内容 fixtures（draft v1, 2026-06-04）
 *
 * P3 详情页（员工 / 项目）独有内容 + 派生 helper 的真相源。
 * - additive：只 import 共享 fixtures.ts，绝不修改它（P1/P2 也读共享 fixtures）。
 * - 所有 user-facing 字符串英文（Venus = 美国听众）；注释中文给 Danny。
 * - 派生 helper 是纯函数吃 fixtures，零新 store state（P5-03：详情页 state-aware）。
 *
 * 下方所有英文 copy 是 Danny 初稿，P3-05 收口逐字审。
 * ⚠ 守则：HR analysis / weekly sentiment 口径守 *no personnel judgment*
 *         （见 fixtures.ts 的 cap_hr_interrupt / MISMATCH.safeFraming）。
 */

import {
  CAPABILITIES,
  MISMATCH,
  PEOPLE,
  PROJECTS,
  SIGNALS,
  TASKS,
  TIMELINE,
  type CapabilityEntry,
  type Person,
  type Project,
  type Signal,
  type Task,
} from './fixtures'

// ───────────────────────── 派生 helper（纯函数 · 零新 store state）─────────────

export type WorkloadStatus = 'Overloaded' | 'Steady' | 'Has capacity'
export type DetailPhase = 'believed' | 'grown'

const isBelieved = (phase: DetailPhase = 'grown') => phase === 'believed'

export interface DashboardPersonCopy {
  roleLine: string
  loadLine: string
}

export interface DashboardProjectCopy {
  statusLabel: string
  summary: string
  progressLabel: string
}

const DASHBOARD_PERSON_COPY: Record<DetailPhase, Record<string, DashboardPersonCopy>> = {
  believed: {
    u_bill: {
      roleLine: 'Chasing a moving brief',
      loadLine: 'A week of changing client feedback',
    },
    u_jason: {
      roleLine: 'Some room to spare',
      loadLine: 'Could lend a hand if it helps',
    },
    u_vanessa: {
      roleLine: 'Carrying the Friday demo',
      loadLine: 'Leaning on the core guide flow',
    },
  },
  grown: {
    u_bill: {
      roleLine: 'Core flow, scope frozen',
      loadLine: 'Scope frozen · clear checklist',
    },
    u_jason: {
      roleLine: 'Lending a hand this week',
      loadLine: 'Taking a little off Lin Qing’s plate',
    },
    u_vanessa: {
      roleLine: 'Friday scope protected',
      loadLine: 'Feedback triage in motion',
    },
  },
}

const DASHBOARD_PROJECT_COPY: Record<DetailPhase, Record<string, DashboardProjectCopy>> = {
  believed: {
    p_acme: {
      statusLabel: 'at risk · core flow exposed',
      summary: 'Friday demo still leans on a core guide flow that keeps getting reworked.',
      progressLabel: '72% complete · no replan yet',
    },
    p_connector: {
      statusLabel: 'read as slow · signals say churn',
      summary: 'Unresolved feedback and no clear sign-off conflict with the "just running slow" read.',
      progressLabel: '48% complete · still being reworked',
    },
  },
  grown: {
    p_acme: {
      statusLabel: 'at risk · diagnosed · Friday held',
      summary: 'Scope is frozen and responsibilities split; the core demo is protected with Tuesday held as contingency.',
      progressLabel: '72% complete · actions in flight',
    },
    p_connector: {
      statusLabel: 'at risk · scope frozen',
      summary: 'Lin Qing owns the core guide flow on a clear checklist; non-core feedback moves to next week.',
      progressLabel: '48% complete · core path protected',
    },
  },
}

export function dashboardPersonCopy(person: Person, phase: DetailPhase): DashboardPersonCopy {
  return (
    DASHBOARD_PERSON_COPY[phase][person.id] ?? {
      roleLine: person.role,
      loadLine: `${person.capacityPct ?? 100}% load`,
    }
  )
}

export function dashboardProjectCopy(project: Project, phase: DetailPhase): DashboardProjectCopy {
  return (
    DASHBOARD_PROJECT_COPY[phase][project.id] ?? {
      statusLabel: project.status.replace('-', ' '),
      summary: project.summary ?? 'No project summary yet.',
      progressLabel: `${project.progress}% complete`,
    }
  )
}

// Status 三档（issue / ADR-0005 口径）：>110 Overloaded · 85–110 Steady · <75 Has capacity。
// 75–85 灰区归 Steady（"Has capacity" 只留给确有余量的 <75）。无 capacityPct → null。
export function deriveStatus(
  capacityPct?: number,
): { label: WorkloadStatus; tone: string } | null {
  if (capacityPct == null) return null
  if (capacityPct > 110) return { label: 'Overloaded', tone: 'tone-warning' }
  if (capacityPct < 75) return { label: 'Has capacity', tone: 'tone-stable' }
  return { label: 'Steady', tone: 'tone-stable' }
}

// 此人「所拥有项目」的 progress（u_bill→core flow 48 / u_vanessa→demo 72 / u_jason→dashboard 30）。
// 不拥有项目（多数 texture 人）→ null → 概览卡 Progress 槽走空态、不渲染占位灰条。
export function ownedProjectProgress(
  personId: string,
): { project: Project; progress: number } | null {
  const project = PROJECTS.find((p) => p.ownerId === personId)
  if (!project) return null
  return { project, progress: project.progress }
}

export function employeeOverviewFor(person: Person, phase: DetailPhase): EmployeeOverviewCopy {
  const owned = ownedProjectProgress(person.id)
  // 红线（ADR-0015）：texture 人无 override 时，fallback 也绝不把人量化成「N% / Overloaded」。
  // 走中性、护着人的人话；deriveStatus 仍是内部判据（type 不动），但不外显其量化 label。
  return (
    EMPLOYEE_OVERVIEW_COPY[phase][person.id] ?? {
      workloadLabel: 'This week',
      workloadValue: 'Going about their work',
      statusLabel: 'Steady',
      progressLabel: owned ? `Progress · ${owned.project.title}` : 'Progress',
      progressValue: owned ? `${owned.progress}%` : 'No owned project',
      hrSignal: hrSignalFor(person.id, phase),
    }
  )
}

// 挂在某人身上的工作信号（subjectType === 'person'）。Lin Qing (u_bill) = 两条 workload 证据；
// texture 人 = []（HR analysis 模块据此判断是否渲染 evidence 子段）。
export function signalsFor(personId: string, _phase: DetailPhase = 'grown'): Signal[] {
  return SIGNALS.filter(
    (signal) => signal.subjectType === 'person' && signal.subjectId === personId,
  )
}

// ───────────────────────── 概览卡 · HR signal 文本（按 id 索引）─────────────────
// story 人有文本；texture 人缺 → 概览走空态 "No HR signal — looks steady"。
// 口径：工作负载 / 路由信号，不是人格评价。

export const HR_SIGNAL: Record<string, string> = {
  u_bill: 'The brief keeps moving on her — a good moment to check in',
  u_jason: 'Could lend a hand if it helps',
  u_vanessa: 'Carrying the Friday demo deadline',
}

// ───────────────────────── Weekly summary + sentiment（按 id 索引）──────────────
// 本周工作的中性复述 + 情绪读数（描述工作处境，非对人评价）。

export type Sentiment = 'positive' | 'steady' | 'strained'

export interface WeeklySummary {
  text: string
  sentiment: Sentiment
  sentimentNote: string
}

export interface EmployeeOverviewCopy {
  workloadLabel: string
  workloadValue: string
  statusLabel: string
  progressLabel: string
  progressValue: string
  hrSignal: string | null
}

const EMPLOYEE_OVERVIEW_COPY: Record<DetailPhase, Record<string, EmployeeOverviewCopy>> = {
  believed: {
    u_bill: {
      workloadLabel: 'This week',
      workloadValue: 'Chasing a moving brief',
      statusLabel: 'Stretched right now',
      progressLabel: 'Core flow progress',
      progressValue: '48% · brief kept moving',
      hrSignal: 'The brief keeps moving on her — a good moment to check in',
    },
    u_jason: {
      workloadLabel: 'This week',
      workloadValue: 'Has some room to spare',
      statusLabel: 'Steady',
      progressLabel: 'Store dashboard progress',
      progressValue: '30% · moving along',
      hrSignal: 'Could lend a hand if it helps',
    },
    u_vanessa: {
      workloadLabel: 'This week',
      workloadValue: 'Carrying the Friday demo',
      statusLabel: 'Holding a deadline',
      progressLabel: 'Demo progress',
      progressValue: '72% · leaning on the core flow',
      hrSignal: 'Owns Friday while the core flow is shaky',
    },
  },
  grown: {
    u_bill: {
      workloadLabel: 'Scope frozen',
      workloadValue: 'Core flow + clear checklist',
      statusLabel: 'Scope protected',
      progressLabel: 'Core flow progress',
      progressValue: '48% · core path protected',
      hrSignal: 'Scope is frozen around her now — still a good moment to check in',
    },
    u_jason: {
      workloadLabel: 'Lending a hand',
      workloadValue: 'Has a bit of room to take some on',
      statusLabel: 'Helping out this week',
      progressLabel: 'Store dashboard progress',
      progressValue: '30% protected',
      hrSignal: 'Lending a hand for a couple of days',
    },
    u_vanessa: {
      workloadLabel: 'Delivery route',
      workloadValue: 'Friday scope protected',
      statusLabel: 'Scope steward',
      progressLabel: 'Demo progress',
      progressValue: '72% actions in flight',
      hrSignal: 'Friday scope protected',
    },
  },
}

// believed 态只放可观察症状，不放 agent 诊断 / 建议。
export const BELIEVED_WEEKLY_SUMMARY: Record<string, WeeklySummary> = {
  u_bill: {
    text: "Lin Qing's had a rough week — the brief kept moving (around nine client change requests in three days), so she spent it reworking screens rather than finishing the core guide flow. The work stalled because the finish line moved, not for lack of trying.",
    sentiment: 'strained',
    sentimentNote: 'Chasing a moving brief',
  },
  u_jason: {
    text: 'Jason has had a steadier week on the store dashboard and looks like he has a bit of room to spare right now.',
    sentiment: 'positive',
    sentimentNote: 'Some room to spare',
  },
  u_vanessa: {
    text: "Sun Xiaomei is holding the Friday demo, and it's leaning on the core guide flow — which is still looking shaky.",
    sentiment: 'steady',
    sentimentNote: 'Carrying the Friday demo',
  },
}

export const WEEKLY_SUMMARY: Record<string, WeeklySummary> = {
  u_bill: {
    text: "Most of Lin Qing's week went to chasing changing client feedback — 9 change requests in 3 days. The core guide flow stalled because the target kept moving, not from lack of effort.",
    sentiment: 'strained',
    sentimentNote: 'Chasing a moving brief',
  },
  u_jason: {
    text: 'Steady week on the store dashboard with room to spare. Well placed to take some of the work split off Lin Qing’s plate.',
    sentiment: 'positive',
    sentimentNote: 'Room to take on more',
  },
  u_vanessa: {
    text: 'Focused on holding the Smart Shopping Guide demo for Friday — coordinating client feedback and the core guide flow end to end.',
    sentiment: 'steady',
    sentimentNote: 'Locked on the Friday demo',
  },
}

// ───────────────────────── HR knowledge analysis（按 id 索引）──────────────────
// ⚠⚠ 守则：no personnel judgment。
// agent 据 HR / Project-Ops capability 生成的建议；口径是「工作负载路由」而非「人事评价」。
// capabilityId 指回 fixtures.ts 的 CAPABILITIES（护城河被 agent 自动优先引用）。

export interface HrAnalysis {
  // 'reading' = report 落地前，只复述看得见的处境；'grown' = report 后长出的解读 + 建议。
  // 避开医学词 diagnosis/symptom（守"永不诊断人"红线，虽不外显也塑造团队心智）。
  mode: 'reading' | 'grown'
  capabilityId?: string // 引用的 capability（auto-prioritized 护城河）
  reading: string // 对处境的中性解读（前辈口吻，不是诊断）
  recommendations?: string[] // 低风险下一步
  framing?: string // 显式的 no-personnel-judgment 护栏
}

// Act1 症状 payload：只并列 raw facts，不解释根因。
export const BELIEVED_HR_ANALYSIS: Record<string, HrAnalysis> = {
  u_bill: {
    mode: 'reading',
    reading:
      "Here's what's showing up: the brief has been moving on Lin Qing all week (about nine client change requests in three days), most of her time went into reworking screens, and the core guide flow has stalled in the meantime.",
  },
  u_jason: {
    mode: 'reading',
    reading:
      "Jason's week looks steady, and nothing worrying is showing up around him right now — he may have a little room to spare.",
  },
  u_vanessa: {
    mode: 'reading',
    reading:
      'Sun Xiaomei is carrying the Friday demo, and it depends on the core guide flow — which is still looking shaky.',
  },
}

export const HR_ANALYSIS: Record<string, HrAnalysis> = {
  u_bill: {
    mode: 'grown',
    capabilityId: 'cap_hr_interrupt',
    reading:
      'This isn’t about capability. She never knew what counted as done this week, the brief kept moving, and the client changes she quietly absorbed aren’t visible anywhere in the project — so what looks like "behind" is really a week of invisible work.',
    recommendations: [
      'Freeze this week’s demo scope first — keep the core guide path, no new client feedback added in.',
      'Split who owns what: Lin Qing on the core flow only; feedback triage, recommendation data fields, and key visuals each go to someone else.',
      'Give Lin Qing a short, completable checklist so "done" is finally clear and her contribution becomes visible.',
      'Hold a low-key 1:1 that leads with what she carried, not what’s missing — frame it as protecting the demo, not a review.',
    ],
    framing: 'This is about understanding what wore her down, not grading the person. Not a capability issue — the brief kept shifting, her work stayed invisible, and the boundaries were unclear. No formal HR involvement needed yet; it’s worth a check-in again next week to see how she’s doing.',
  },
  u_jason: {
    mode: 'grown',
    capabilityId: 'cap_hr_interrupt',
    reading:
      'Jason is running below full load with a clean picture — a natural candidate to take some of the work split off Lin Qing’s plate without risking burnout.',
    recommendations: [
      'Offer Jason a couple of the split-off responsibilities for 2 days so Lin Qing can focus the core flow.',
      'Keep the handoff time-boxed so the store dashboard work stays on track.',
    ],
    framing: 'Capacity-based suggestion. No personnel judgment is implied.',
  },
  u_vanessa: {
    mode: 'grown',
    capabilityId: 'cap_po_dep',
    reading:
      'Sun Xiaomei is best placed to hold the finish line still — the exposure is shifting client requirements close to a ship date, not delivery quality.',
    recommendations: [
      'Triage incoming client feedback into "affects Friday" vs "next iteration" so the scope stays frozen.',
      'Keep the Tuesday slip ready as a stated contingency rather than a silent fallback.',
    ],
    framing: 'Scope-stewardship guidance. No personnel judgment is implied.',
  },
}

// ───────────────────────── 故事人集合 + 空态判定 ──────────────────────────────
// 故事人 = 有完整 HR analysis 草拟内容的人（Lin Qing / Jason / Sun Xiaomei）。
// 用 HR_ANALYSIS 的 key 派生 → 单一真相源：加一个故事人只改上面的内容块。
export const STORY_PEOPLE = new Set<string>(Object.keys(HR_ANALYSIS))

export function isStoryPerson(personId: string): boolean {
  return STORY_PEOPLE.has(personId)
}

// 各模块的空态判定（缺数据模块走干净空态，不渲染占位灰条）。
export function hrSignalFor(personId: string, phase: DetailPhase = 'grown'): string | null {
  if (isBelieved(phase)) {
    if (personId === 'u_bill') return 'The brief keeps moving on her — a good moment to check in'
    if (personId === 'u_jason') return 'Could lend a hand if it helps'
    if (personId === 'u_vanessa') return 'Owns Friday while the core flow is shaky'
    return null
  }
  return HR_SIGNAL[personId] ?? null
}

export function weeklySummaryFor(personId: string, phase: DetailPhase = 'grown'): WeeklySummary | null {
  if (isBelieved(phase)) return BELIEVED_WEEKLY_SUMMARY[personId] ?? null
  return WEEKLY_SUMMARY[personId] ?? null
}

export function hrAnalysisFor(personId: string, phase: DetailPhase = 'grown'): HrAnalysis | null {
  if (isBelieved(phase)) return BELIEVED_HR_ANALYSIS[personId] ?? null
  return HR_ANALYSIS[personId] ?? null
}

export interface EmployeeTaskView extends Task {
  note: string
}

const EMPLOYEE_TASK_OVERRIDES: Record<DetailPhase, Record<string, Partial<EmployeeTaskView>>> = {
  believed: {
    t_acme_hook: {
      title: 'Wire the core flow into the demo build - stalled as the brief moved',
      note: 'Raw assignment pressure; scope still moving.',
    },
    t_con_slack: {
      title: 'Home guide entry + recommendation cards - stalled',
      note: 'No clear "done" yet; still assigned to Lin Qing.',
    },
    t_con_gh: {
      title: 'User-profile dialog - reworked against new feedback',
      note: 'Moving, but changing requirements are fragmenting focus.',
    },
    t_con_dedupe: {
      title: 'Extra visual polish pass - waiting',
      note: 'Still on the original scope.',
    },
  },
  grown: {
    t_acme_hook: {
      title: 'Wire the core flow into the demo build - on the checklist',
      note: 'Lin Qing owns the core flow; scope frozen, feedback triage routes through Sun Xiaomei.',
    },
    t_con_slack: {
      title: 'Home guide entry + recommendation cards - on the checklist',
      note: 'Core checklist item with a clear "done"; decides Friday vs Tuesday contingency.',
    },
    t_con_gh: {
      title: 'User-profile dialog - core Friday scope',
      note: 'Kept in the Friday core demo.',
    },
    t_con_dedupe: {
      title: 'Extra visual polish pass - deferred out of Friday',
      status: 'todo',
      note: 'Non-core work moved to next week.',
    },
  },
}

export function tasksForPerson(personId: string, phase: DetailPhase = 'grown'): EmployeeTaskView[] {
  return TASKS.filter((task) => task.assigneeId === personId).map((task) => ({
    ...task,
    ...EMPLOYEE_TASK_OVERRIDES[phase][task.id],
    note:
      EMPLOYEE_TASK_OVERRIDES[phase][task.id]?.note ??
      (isBelieved(phase) ? 'Current assignment from the raw board.' : 'No generated change needed.'),
  }))
}

// ════════════════════════════════════════════════════════════════════════════
// P3-02 · Project 详情页内容 + 派生 helper（additive）
// ════════════════════════════════════════════════════════════════════════════

// ───────────────────────── Delivery milestones ────────────────────────────────
// demo（p_acme）直接渲染 fixtures.ts 的 TIMELINE.milestones（6 阶段，已带 state）。
// core flow（p_connector）在此草拟（≥5 阶段）；其余项目无数据 → 模块走空态。
// state 与 TIMELINE 同口径：planned / replanned / held / deferred / conditional。

export interface Milestone {
  label: string
  when: string
  state: string
}

export interface ProjectBriefCopy {
  summary: string
  statusLabel: string
  progressLabel: string
  dependencyLabel?: string
}

const PROJECT_BRIEF_COPY: Record<DetailPhase, Record<string, ProjectBriefCopy>> = {
  believed: {
    p_acme: {
      summary:
        'Observed state: Friday is still the target, but the demo leans on a core guide flow that keeps getting reworked, and no read has been generated.',
      statusLabel: 'at risk · leaning on the core flow',
      progressLabel: '72% complete · original plan',
      dependencyLabel: 'Depends on the core guide flow - unresolved',
    },
    p_connector: {
      summary:
        'Observed state: the manager reads it as "just slow," but unresolved feedback and no sign-off say the core flow is at risk.',
      statusLabel: 'read as slow · signals say churn',
      progressLabel: '48% complete · still being reworked',
    },
  },
  grown: {
    p_acme: {
      summary:
        'Read: the dip was a moving finish line, not a delivery slip. Scope is frozen, responsibilities are split, and the Friday core demo is held.',
      statusLabel: 'at risk · read in · Friday held',
      progressLabel: '72% complete · scope frozen',
      dependencyLabel: 'Depends on the core guide flow - core scope protected',
    },
    p_connector: {
      summary:
        'Read: scope is frozen, Lin Qing owns the core guide flow on a clear checklist, and non-core feedback leaves Friday scope.',
      statusLabel: 'at risk · read in · actions in flight',
      progressLabel: '48% complete · core path protected',
    },
  },
}

// Act1 原始计划：展示 stall，不展示 B8 后的 freeze。
const ACME_BELIEVED_MILESTONES: Milestone[] = [
  { label: 'Recommendation data fields', when: 'Wed', state: 'in-progress' },
  { label: 'Wire the core flow into the demo', when: 'Thu', state: 'stalled' },
  { label: 'Demo walkthrough rehearsal', when: 'Fri am', state: 'waiting' },
  { label: 'Demo ship target', when: 'Fri', state: 'at-risk' },
]

const CONNECTOR_BELIEVED_MILESTONES: Milestone[] = [
  { label: 'Home guide entry + recommendation cards', when: 'Wed', state: 'in-progress' },
  { label: 'User-profile dialog', when: 'Thu', state: 'stalled' },
  { label: 'Core flow wired into the demo', when: 'Thu pm', state: 'stalled' },
  { label: 'Extra visual polish pass', when: 'Fri', state: 'waiting' },
]

// 核心导购 flow 的冻结范围 + checklist 计划（保住周五核心 demo）。
const CONNECTOR_MILESTONES: Milestone[] = [
  { label: 'Freeze scope · checklist agreed', when: 'Wed', state: 'planned' },
  { label: 'Lin Qing — core flow on the checklist', when: 'Thu', state: 'replanned' },
  { label: 'Core flow running end to end', when: 'Thu pm', state: 'replanned' },
  { label: 'Core demo path ships', when: 'Fri', state: 'held' },
  { label: 'Non-core feedback', when: 'Next week', state: 'deferred' },
  { label: 'Contingency slip', when: 'Tue', state: 'conditional' },
]

// 渲染用：state → 标签 + 视觉 tone class（held / conditional / deferred 视觉可辨）。
export const MILESTONE_STATE_COPY: Record<string, { label: string; tone: string }> = {
  'at-risk': { label: 'At risk', tone: 'is-stalled' },
  'in-progress': { label: 'In progress', tone: 'is-planned' },
  planned: { label: 'Planned', tone: 'is-planned' },
  replanned: { label: 'Replanned', tone: 'is-replanned' },
  held: { label: 'Held', tone: 'is-held' },
  deferred: { label: 'Deferred', tone: 'is-deferred' },
  conditional: { label: 'Conditional', tone: 'is-conditional' },
  stalled: { label: 'Stalled', tone: 'is-stalled' },
  waiting: { label: 'Waiting', tone: 'is-conditional' },
}

// 时间排序键；未知 when 落到末尾（不破坏排序）。
const MILESTONE_WHEN_ORDER: Record<string, number> = {
  Wed: 0,
  Thu: 1,
  'Thu pm': 2,
  'Fri am': 3,
  Fri: 4,
  'Next week': 5,
  Tue: 6,
}

export function milestoneOrder(when: string): number {
  return MILESTONE_WHEN_ORDER[when] ?? 99
}

export function projectMilestones(projectId: string, phase: DetailPhase = 'grown'): Milestone[] | null {
  if (isBelieved(phase)) {
    if (projectId === 'p_acme') return ACME_BELIEVED_MILESTONES
    if (projectId === 'p_connector') return CONNECTOR_BELIEVED_MILESTONES
    return null
  }
  if (projectId === 'p_acme') return [...TIMELINE.milestones]
  if (projectId === 'p_connector') return CONNECTOR_MILESTONES
  return null
}

export function projectBriefFor(project: Project, phase: DetailPhase): ProjectBriefCopy {
  return (
    PROJECT_BRIEF_COPY[phase][project.id] ?? {
      summary: project.summary ?? 'No project summary yet.',
      statusLabel: project.status.replace('-', ' '),
      progressLabel: `${project.progress}% complete`,
      dependencyLabel: project.dependsOn?.length ? 'Dependencies attached' : undefined,
    }
  )
}

// ───────────────────────── Team responsibilities ──────────────────────────────
// owner + task assignees 派生的成员集合（owner 置顶，去重）。

export interface TeamMember {
  person: Person
  role: 'Owner' | 'Contributor'
  note: string
}

const PROJECT_TEAM_NOTES: Record<DetailPhase, Record<string, Record<string, string>>> = {
  believed: {
    p_acme: {
      u_vanessa: 'Owner · holding the Friday demo target',
      u_kristen: 'Contributor · data fields wait on the core flow',
      u_bill: 'Contributor · still owns the stalled core flow',
      u_aidy: 'Contributor · walkthrough waiting',
    },
    p_connector: {
      u_bill: 'Owner · still chasing a moving brief',
    },
  },
  grown: {
    p_acme: {
      u_vanessa: 'Owner · freezes scope + triages feedback',
      u_kristen: 'Contributor · confirms the recommendation data fields',
      u_bill: 'Contributor · owns the core guide flow only',
      u_aidy: 'Contributor · walkthrough after core flow',
    },
    p_connector: {
      u_bill: 'Owner · core guide flow on a clear checklist',
    },
  },
}

export function projectTeam(projectId: string, phase: DetailPhase = 'grown'): TeamMember[] {
  const project = PROJECTS.find((p) => p.id === projectId)
  if (!project) return []
  const assigneeIds = TASKS.filter((task) => task.projectId === projectId).map(
    (task) => task.assigneeId,
  )
  const orderedIds = [project.ownerId, ...assigneeIds]
  const seen = new Set<string>()
  const team: TeamMember[] = []
  for (const id of orderedIds) {
    if (seen.has(id)) continue
    seen.add(id)
    const person = PEOPLE.find((p) => p.id === id)
    if (!person) continue
    const role = id === project.ownerId ? 'Owner' : 'Contributor'
    team.push({
      person,
      role,
      note: PROJECT_TEAM_NOTES[phase][projectId]?.[id] ?? `${role} · ${person.role}`,
    })
  }
  return team
}

// ───────────────────────── Task board（3 段映射）──────────────────────────────
// Task.status → 段：stalled → Needs decision · in-progress → In progress ·
// done + todo → Done or waiting。

export type TaskColumnKey = 'needs-decision' | 'in-progress' | 'done-waiting'

export interface TaskColumn {
  key: TaskColumnKey
  title: string
  statuses: Task['status'][]
}

export const TASK_BOARD_COLUMNS: TaskColumn[] = [
  { key: 'needs-decision', title: 'Needs decision', statuses: ['stalled'] },
  { key: 'in-progress', title: 'In progress', statuses: ['in-progress'] },
  { key: 'done-waiting', title: 'Done or waiting', statuses: ['done', 'todo'] },
]

export interface ProjectTaskView extends Task {
  note: string
}

const PROJECT_TASK_OVERRIDES: Record<DetailPhase, Record<string, Partial<ProjectTaskView>>> = {
  believed: {
    t_acme_int: {
      title: 'Recommendation data fields - blocked paths still pending',
      note: 'Raw progress; fields that depend on the core flow cannot close.',
    },
    t_acme_data: {
      title: 'Sort & prioritize client feedback - original Friday prep',
      note: 'Current assignment; no scope freeze yet.',
    },
    t_acme_hook: {
      title: 'Wire the core flow into the demo - stalled',
      note: 'Visible blocker; no plan generated.',
    },
    t_acme_uat: {
      title: 'Demo walkthrough rehearsal - waiting on the core flow',
      note: 'Friday run exposed to the core-flow stall.',
    },
    t_con_slack: {
      title: 'Home guide entry + recommendation cards - stalled',
      note: 'Open feedback still unresolved.',
    },
    t_con_gh: {
      title: 'User-profile dialog - partial progress',
      note: 'Moving while the brief keeps changing on Lin Qing.',
    },
    t_con_dedupe: {
      title: 'Extra visual polish pass - original scope waiting',
      note: 'Still included in the visible plan.',
    },
  },
  grown: {
    t_acme_int: {
      title: 'Recommendation data fields - core path guarded',
      note: 'Fields aim at the frozen Friday scope.',
    },
    t_acme_data: {
      title: 'Sort & prioritize client feedback - Friday core only',
      note: 'Non-core feedback parked for next iteration.',
    },
    t_acme_hook: {
      title: 'Wire the core flow into the demo - protected focus',
      note: 'Lin Qing focus blocks assigned; Sun Xiaomei confirms scope.',
    },
    t_acme_uat: {
      title: 'Demo walkthrough rehearsal - queued after the core flow',
      note: 'Run waits for the protected core path, not the original full scope.',
    },
    t_con_slack: {
      title: 'Home guide entry + recommendation cards - action in flight',
      note: 'Protected focus task; decides contingency.',
    },
    t_con_gh: {
      title: 'User-profile dialog - held in core demo',
      note: 'Kept as Friday core scope.',
    },
    t_con_dedupe: {
      title: 'Extra visual polish pass - deferred',
      status: 'todo',
      note: 'Moved out of Friday scope.',
    },
  },
}

export function tasksForProject(projectId: string, phase: DetailPhase = 'grown'): ProjectTaskView[] {
  return TASKS.filter((task) => task.projectId === projectId).map((task) => ({
    ...task,
    ...PROJECT_TASK_OVERRIDES[phase][task.id],
    note:
      PROJECT_TASK_OVERRIDES[phase][task.id]?.note ??
      (isBelieved(phase) ? 'Raw board item; no generated action yet.' : 'No generated change needed.'),
  }))
}

// ───────────────────────── Handoffs（按 projectId）─────────────────────────────
// Handoff = agent 产出、可直接执行的单条行动（checklist：done / discard）。
// flyToNexus 非空 = 可一键飞回 Nexus 深挖（调 askQuestion(flyToNexus)）。
// 故事项目有；texture 项目无 → 模块空态。

export interface Handoff {
  id: string
  text: string
  detail?: string
  flyToNexus?: string // askQuestion 的问题文本
}

export const HANDOFFS: Record<string, Handoff[]> = {
  p_acme: [
    {
      id: 'h_acme_scope',
      text: 'Freeze this week’s demo scope with the team today',
      detail: 'Keep only the core guide path for Friday; no new client feedback gets added in.',
    },
    {
      id: 'h_acme_split',
      text: 'Split who owns what so the work leaves Lin Qing’s plate',
      detail: 'Lin Qing = core flow · Sun Xiaomei = feedback triage · Chen Mingyuan = recommendation data fields · Zheng Zixuan = key visuals only.',
    },
    {
      id: 'h_acme_stakeholder',
      text: 'Pre-warn the client that Tuesday is the held contingency',
      detail: 'Only triggers if the core guide flow isn’t running by Thursday.',
    },
    {
      id: 'h_acme_legal',
      text: 'Check the frozen scope against what the client was promised',
      detail: 'A scope freeze may touch the signed engagement — have a legal agent confirm.',
      flyToNexus: 'Does the frozen Friday demo scope stay within what the client was promised?',
    },
  ],
  p_connector: [
    {
      id: 'h_con_checklist',
      text: 'Give Lin Qing a short, completable checklist for the core flow',
      detail: 'Home guide entry · recommendation cards · user-profile dialog · the path running end to end.',
    },
    {
      id: 'h_con_defer',
      text: 'Push every non-core piece of feedback to the next iteration',
      detail: 'So "done" is finally clear and the finish line stops moving this week.',
    },
    {
      id: 'h_con_oneonone',
      text: 'Have a low-key 1:1 that leads with what Lin Qing carried',
      detail: 'Ask which feedback affects Friday and which can wait — not "why isn’t it done."',
      flyToNexus: 'How should the manager open the 1:1 with Lin Qing about the moving brief?',
    },
  ],
}

export function handoffsForProject(projectId: string, phase: DetailPhase = 'grown'): Handoff[] {
  if (isBelieved(phase)) return []
  return HANDOFFS[projectId] ?? []
}

// ───────────────────────── Weekly team updates（按 projectId）──────────────────
// 本周成员进展。口径中性，描述工作进展非人事评价。

export interface WeeklyUpdate {
  personId: string
  update: string
}

export const WEEKLY_UPDATES: Record<string, WeeklyUpdate[]> = {
  p_acme: [
    { personId: 'u_vanessa', update: 'Froze the Friday demo scope and is triaging incoming client feedback into "affects Friday" vs "next iteration."' },
    { personId: 'u_kristen', update: 'Confirming the recommendation data fields the core flow needs so nothing blocks Lin Qing.' },
    { personId: 'u_aidy', update: 'Walkthrough plan is ready; waiting on the core flow to run before the demo.' },
  ],
  p_connector: [
    { personId: 'u_bill', update: 'On the core guide flow with a clear checklist now that the scope is frozen; non-core feedback parked for next week.' },
    { personId: 'u_jason', update: 'Free to pick up the work split off Lin Qing’s plate so the core flow can move.' },
  ],
}

// believed 态项目周更只陈列现场事实，不写 freeze / split 决策。
export const BELIEVED_WEEKLY_UPDATES: Record<string, WeeklyUpdate[]> = {
  p_acme: [
    { personId: 'u_vanessa', update: 'Friday demo scope is still the target; the core guide flow remains the exposed dependency.' },
    { personId: 'u_kristen', update: 'Recommendation data fields are moving, but the parts that depend on the core flow cannot finish yet.' },
    { personId: 'u_aidy', update: 'The walkthrough rehearsal is waiting on the core flow before it can start.' },
  ],
  p_connector: [
    { personId: 'u_bill', update: 'The user-profile dialog is moving; the home guide entry is still being reworked against new feedback.' },
    { personId: 'u_jason', update: 'The store dashboard is steady, and Jason has a bit of room to spare right now.' },
  ],
}

export function weeklyUpdatesForProject(projectId: string, phase: DetailPhase = 'grown'): WeeklyUpdate[] {
  if (isBelieved(phase)) return BELIEVED_WEEKLY_UPDATES[projectId] ?? []
  return WEEKLY_UPDATES[projectId] ?? []
}

// ───────────────────────── 次层级：Risk & evidence（过滤 SIGNALS）──────────────
// 下沉到主层级下方（护 B9b 之前的 reveal）。项目自身 + 其依赖项目的信号都纳入，
// 这样 demo（依赖 core flow）也能看到完整证据链。texture 项目无信号 → 空态。

export function signalsForProject(projectId: string, phase: DetailPhase = 'grown'): Signal[] {
  const project = PROJECTS.find((p) => p.id === projectId)
  if (!project) return []
  const projectIds = new Set<string>([projectId, ...(project.dependsOn ?? [])])
  const taskIds = new Set(
    TASKS.filter((task) => projectIds.has(task.projectId)).map((task) => task.id),
  )
  // owner(s) 的 person-signal 也纳入 → "HR signal" 那半（core flow/demo 都能追到 Lin Qing 的 workload）。
  const ownerIds = new Set<string>(
    [...projectIds]
      .map((id) => PROJECTS.find((p) => p.id === id)?.ownerId)
      .filter((id): id is string => Boolean(id)),
  )
  return SIGNALS.filter(
    (signal) =>
      (signal.subjectType === 'project' && projectIds.has(signal.subjectId)) ||
      (signal.subjectType === 'task' && taskIds.has(signal.subjectId)) ||
      (signal.subjectType === 'person' && ownerIds.has(signal.subjectId)),
  )
}

export function reportMismatchForProject(projectId: string): {
  reported: string
  signalsSay: string
  gapType: string
  rootCause: string
  safeFraming: string
} | null {
  const projectIds = new Set<string>([projectId])
  const project = PROJECTS.find((p) => p.id === projectId)
  for (const depId of project?.dependsOn ?? []) projectIds.add(depId)
  if (!projectIds.has(MISMATCH.subjectProjectId)) return null
  return MISMATCH
}

// ════════════════════════════════════════════════════════════════════════════
// P3-04 · Playbooks 页（register B · 产品页 + 「为什么值得信」横条）
// 吃既有 CAPABILITIES fixture（按 domain 分组）；此处只加页面框架文案 + 分组 helper。
// 呼应 CONTEXT 的 playbooks「第二条腿」。
// ════════════════════════════════════════════════════════════════════════════

export const CAPABILITIES_PAGE = {
  eyebrow: 'Playbooks',
  title: 'The hard-won judgment behind every recommendation.',
  // 横条三点：为什么这些 playbooks 值得信（对用户说话，VC 腔已去）。
  whyPoints: [
    'Built from how good managers actually decide',
    'Grows as your team does',
    'Always shows its reasoning',
  ],
  // 接回命题的一句 framing（公司事实 vs playbooks 的分工，带上前辈口吻）。
  framing:
    "Your team's facts tell you what's happening. The playbooks help you decide what to do about it — the way a seasoned head would.",
}

// CAPABILITIES 的 domain → 展示名（CONTEXT：库横跨 HR / Legal / PM / Finance / Ops / Sales）。
export const CAPABILITY_DOMAIN_LABEL: Record<string, string> = {
  'project-ops': 'PM',
  hr: 'HR',
  legal: 'Legal',
  finance: 'Finance',
  sales: 'Sales',
  ops: 'Ops',
}

// 库覆盖的垂直域展示顺序（coverage strip 用）。
export const CAPABILITY_DOMAIN_ORDER: string[] = [
  'hr',
  'project-ops',
  'legal',
  'finance',
  'ops',
  'sales',
]

export interface CapabilityPackage {
  domain: CapabilityEntry['domain']
  title: string
  gist: string
  previewPlaybooks: string[]
}

// P4-03 新增 Venus-facing catalog / subscription copy。
// 订阅包不带 status 字段；默认 subscribed 由 loadedCapabilityDomains() 派生，保持 loaded ⇔ subscribed。
export const CAPABILITY_SUBSCRIPTION_COPY = {
  coverageEyebrow: 'Guiding your team now',
  coverageTitle: "What's guiding your team now",
  expandEyebrow: 'More you can add',
  expandTitle: 'More playbooks you can add',
  subscribedBadge: 'On',
  availableBadge: 'Available',
  previewLabel: 'A look inside',
  subscribeAction: 'Turn on',
  unsubscribeAction: 'Turn off',
  emptyCoverage: 'Nothing turned on in this local view yet.',
  emptyExpansion: 'Every playbook is already turned on.',
}

export const CAPABILITY_PACKAGES: CapabilityPackage[] = [
  {
    // （HR gist + preview 名称）。改为反映合伙人真实 SCN playbooks / motivation drivers
    // （预览名，非全文）。SCN-001 = 本 demo 高潮卡的锚点，列在最前。
    domain: 'hr',
    title: 'HR',
    gist: 'Motivation, pay-fairness, wellbeing, and manager-loop playbooks — read the situation with evidence and alternatives before ever judging the person.',
    previewPlaybooks: [
      // 6 SCN playbook 名（合伙人 scenario_playbooks，预览短语）
      'Creative motivation drop after repeated client rejection',
      'High performer feels pay is unfair',
      'New-hire ramp-up slow in a project team',
      'Uneven project-opportunity access',
      'Manager feedback cycle broken',
      'Wellbeing risk hidden inside workload',
      // 动机驱动读法（合伙人 motivation_drivers，预览短语）
      'Reading the ten motivation drivers, not raw output',
    ],
  },
  {
    domain: 'project-ops',
    title: 'PM',
    gist: 'Delivery-risk playbooks for shifting requirements, scope freezes, and deadline tradeoffs.',
    previewPlaybooks: [
      'Shifting requirements near a ship date',
      'Freeze scope and split responsibilities',
      'Contingency date framing',
    ],
  },
  {
    domain: 'legal',
    title: 'Legal',
    gist: 'Contract, scope, and approval playbooks for deciding when execution changes need legal review.',
    previewPlaybooks: [
      'Statement-of-work scope check',
      'Customer commitment exception',
      'Approval path for delivery changes',
    ],
  },
  {
    domain: 'finance',
    title: 'Finance',
    gist: 'Margin, billing, and budget playbooks that connect operational decisions to revenue exposure.',
    previewPlaybooks: [
      'Revenue-risk prioritization',
      'Budget owner escalation',
      'Margin impact of support load',
    ],
  },
  {
    domain: 'ops',
    title: 'Ops',
    gist: 'Operating cadence playbooks for incident handoffs, SLA pressure, and cross-functional queue health.',
    previewPlaybooks: [
      'SLA breach triage',
      'Queue ownership handoff',
      'Incident-to-project escalation',
    ],
  },
  {
    domain: 'sales',
    title: 'Sales',
    gist: 'Pipeline and account-risk playbooks that help agents weigh customer urgency against delivery focus.',
    previewPlaybooks: [
      'Expansion account save',
      'Renewal-risk signal routing',
      'Executive sponsor follow-up',
    ],
  },
]

// 按 domain 分组（保持 CAPABILITIES 出现顺序）。
export function capabilitiesByDomain(): {
  domain: string
  label: string
  entries: CapabilityEntry[]
}[] {
  const order: string[] = []
  const groups: Record<string, CapabilityEntry[]> = {}
  for (const cap of CAPABILITIES) {
    if (!groups[cap.domain]) {
      groups[cap.domain] = []
      order.push(cap.domain)
    }
    groups[cap.domain].push(cap)
  }
  return order.map((domain) => ({
    domain,
    label: CAPABILITY_DOMAIN_LABEL[domain] ?? domain,
    entries: groups[domain],
  }))
}

// demo 已加载 sample playbook 的域（= CAPABILITIES 里出现的 domain）。
export function loadedCapabilityDomains(): Set<string> {
  return new Set<string>(CAPABILITIES.map((cap) => cap.domain))
}
