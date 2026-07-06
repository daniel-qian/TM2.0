/**
 * TeamMaster 2.0 — Venus Pitch Demo Fixtures (draft v1, 2026-06-03)
 *
 * 这是 demo 的内容真相源（见 demo-brief.md §6）。
 * - 所有 user-facing 字符串用英文（Venus = 美国听众）；注释中文给 Danny。
 * - 按 ADR-0003：scripted 内容当 data 存，喂 dumb 组件；rail 与 free-click 共用。
 * - 本文件即 app 的 live fixtures（src/data/fixtures.ts）；导出的 types = state 数据契约。
 *   设计稿原在 docs/20260603-design/，已于 P0 scaffold 时迁来。
 *
 * 命名：虚构同事用 SNL 2012 黄金期 cast 名（好记）；You / Wang 保留真名（真创始人 = meta 点）。
 *
 * 高 narrative 价值、需你逐字审的块（其余 = orbit 纹理，可随手改名）：
 *   AGENT_OUTPUT（Venus 盯着读）· MISMATCH · BRIEFING_V1/V2 · CAPABILITIES。
 */

import { AVATAR_SPRITES, type AvatarSprite } from './avatarSprites'

// ───────────────────────── Types（即 state 数据契约）─────────────────────────

export type ProjectStatus = 'on-track' | 'at-risk' | 'blocked' | 'done'
// 设计团队信号来源（ADR-0015 re-flavor）：figma = 设计文件/原型；feedback = 客户反馈轮次/评审；
// task = 任务板；manual = 经理手记。旧工程源（slack/github）退役。
export type SignalSource = 'figma' | 'feedback' | 'task' | 'manual'

export interface Person {
  id: string
  name: string
  lastInitial?: string // 名册名牌 "Firstname L."（ADR-0012 修订 5）；You/Wang 真名无姓缩写
  role: string
  team: 'Founders' | 'Eng' | 'Product' | 'Design' | 'GTM' | 'Ops'
  capacityPct?: number // 100 = 满载；>100 = 超载
  moodPct: number // 0..100；calm 卡 MP HUD
  avatarSprite: AvatarSprite
  storyCritical?: boolean
}

// 项目风险分布（Dashboard focus 态图表的 4 维，0..100）。手工编剧（守 ADR-0003：
// scripted 内容当 data 存），story-critical 项目按叙事调，其余给平静纹理。
export interface ProjectRisk {
  progress: number // 进度风险（落后/依赖拖累）
  blockers: number // 阻塞风险（卡点/外部依赖）
  staffing: number // 人力风险（过载/单点）
  quality: number // 质量风险
}

export interface Project {
  id: string
  title: string
  ownerId: string
  status: ProjectStatus // 系统判断的真实状态
  reportedStatus?: ProjectStatus // owner 自报（与 status 不一致 = report mismatch）
  progress: number // 0..100
  dueDate?: string
  dependsOn?: string[] // project ids
  summary?: string
  storyCritical?: boolean
  hotspot?: boolean // Dashboard「Hot spots」tag 手工标记；语义独立于 status
  risk?: ProjectRisk
}

export interface Task {
  id: string
  projectId: string
  title: string
  assigneeId: string
  status: 'todo' | 'in-progress' | 'stalled' | 'done'
}

export interface Signal {
  id: string
  source: SignalSource
  subjectType: 'person' | 'project' | 'task'
  subjectId: string
  summary: string
  ageDays: number
  // interrupt = 打断类信号（用于 HR 线区分"被打断"而非"低产"）
  tag?: 'stalled' | 'repeated-blocker' | 'no-update' | 'interrupt' | 'self-report'
}

export interface CapabilityEntry {
  id: string
  domain: 'project-ops' | 'hr' | 'legal' | 'finance' | 'sales' | 'ops'
  title: string
  gist: string // 一句话判断框架（agent 引用它）
}

// 合伙人 knowledge-pack 的 8 段式 advice_output_schema（advice_output_schema.required）。
// 规则（合伙人 escalation_guardrails · diagnosis）：所有诊断都是 hypothesis，要给 evidence + alternatives，
// 绝不给"人"贴标签/打分。这是 demo 高潮卡的 canonical 形状。
export interface DiagnosisHypothesis {
  label: string // 一句话读法（对"处境"，不对"人"）
  kind: 'primary' | 'alternative'
}

export interface AgentOutput {
  // 8-field contract（partner advice_output_schema）：
  summary: string // 1 · 经理向的平实读法（不是对人的裁决）
  detected_signals: string[] // 2 · 观察到的具体信号（有 evidence 锚，不是标签）
  diagnosis_hypotheses: DiagnosisHypothesis[] // 3 · 带 alternative 的假设（不当事实断言）
  evidence: string[] // 4 · 支撑每条判断的可引用指针
  recommended_actions: string[] // 5 · 具体下一步（谁 / 何时 / 为什么）
  confidence: {
    // 6 · 明确的信心水平 + 什么会改变它（校准）
    level: 'low' | 'medium' | 'high'
    rationale: string
    wouldChange: string[] // 会推高/推低信心的东西（吸收原 uncertainties）
  }
  escalation: {
    // 7 · 何时把 HR/legal 拉进来（legal / pay / wellbeing / fairness）+ 谁来确认
    level: 'none' | 'HRBP' | 'legal' | 'wellbeing' | 'compensation' | 'executive'
    note: string
    confirmWith: string[] // 这一步需要谁点头（沿用原 needsConfirmationFrom 语义槽）
  }
  metrics_to_track: string[] // 8 · 看什么才知道有没有奏效
  conversation_script: string // + · 1:1 开场白（"senior 在耳边"的声音）
  nextTasks: TaskTemplate[] // UI 仍用：可派发的任务模板
}

export interface TaskTemplate {
  title: string
  assigneeId: string
  due: string
}

export interface Briefing {
  id: string
  version: 1 | 2
  tone: 'calm' | 'alert'
  headline: string
  subhead: string
  metrics: { label: string; value: string }[]
}

// Dashboard 顶部标签（P1）。curated 列表 + 声明式匹配规则；
// 选 tag → focus.ts 据 match 算"根集合"→ 同单点 relatedness 展开。多选 = 并集。
export interface DashboardTag {
  id: string
  label: string
  match:
    | { by: 'due'; within: 'this-week' } // 时间
    | { by: 'status'; status: ProjectStatus } // 属性
    | { by: 'project'; projectId: string } // 具体实体
    | { by: 'team'; team: Person['team'] } // 人群
    | { by: 'hotspot' } // Project.hotspot 标记
}

// ───────────────────────── People（~14；You/Wang 真名，其余 SNL）─────────────

export const PEOPLE: Person[] = [
  // （全部 display name / role）。id 保持稳定不动（守引用）；
  // display name re-map 成合伙人场景的 Prism Design Team（New Retail Smart Shopping Guide）。
  { id: 'u_you', name: 'You', role: 'Design Manager', team: 'Founders', capacityPct: 95, moodPct: 72, avatarSprite: AVATAR_SPRITES.paladin, storyCritical: true },
  { id: 'u_wang', name: 'Wang', role: 'Design Lead', team: 'Founders', capacityPct: 90, moodPct: 80, avatarSprite: AVATAR_SPRITES.cleric, storyCritical: true },
  // Sun Xiaomei（原 Vanessa）= 客户反馈整理 / 优先级
  { id: 'u_vanessa', name: 'Sun Xiaomei', lastInitial: 'S', role: 'UX Researcher', team: 'Product', capacityPct: 88, moodPct: 62, avatarSprite: AVATAR_SPRITES.archer, storyCritical: true },
  // Lin Qing（原 Bill）= 核心 UI flow 和页面体验（本 case 动力下降的主角）
  { id: 'u_bill', name: 'Lin Qing', lastInitial: 'L', role: 'Product Designer', team: 'Design', capacityPct: 134, moodPct: 24, avatarSprite: AVATAR_SPRITES.mage, storyCritical: true }, // 工作量高（消化一整周变动反馈）
  // Jason（搭把手的余量同事）→ 本场景重铸为可分担反馈整理的设计同事
  { id: 'u_jason', name: 'Jason', lastInitial: 'S', role: 'Product Designer', team: 'Design', capacityPct: 70, moodPct: 76, avatarSprite: AVATAR_SPRITES.swordsman, storyCritical: true }, // 有余量
  // Chen Mingyuan（原 Kristen）= 接口和数据联调 / 推荐数据字段
  { id: 'u_kristen', name: 'Chen Mingyuan', lastInitial: 'C', role: 'Design Technologist', team: 'Eng', capacityPct: 92, moodPct: 68, avatarSprite: AVATAR_SPRITES.alchemist, storyCritical: true },
  // ── orbit 纹理（非本 case 主角，填团队地图）──
  { id: 'u_nasim', name: 'Nasim', lastInitial: 'P', role: 'Motion Designer', team: 'Design', capacityPct: 85, moodPct: 74, avatarSprite: AVATAR_SPRITES.kid },
  // Zheng Zixuan（原 Andy）= 视觉组件和交互细节
  { id: 'u_andy', name: 'Zheng Zixuan', lastInitial: 'Z', role: 'Visual Designer', team: 'Design', capacityPct: 80, moodPct: 78, avatarSprite: AVATAR_SPRITES.merchant, storyCritical: true },
  { id: 'u_kate', name: 'Kate', lastInitial: 'M', role: 'Client Partner', team: 'GTM', capacityPct: 108, moodPct: 56, avatarSprite: AVATAR_SPRITES.farmer },
  { id: 'u_will', name: 'Will', lastInitial: 'F', role: 'Account Executive', team: 'GTM', capacityPct: 75, moodPct: 73, avatarSprite: AVATAR_SPRITES.thief },
  { id: 'u_cecily', name: 'Cecily', lastInitial: 'S', role: 'Content Designer', team: 'GTM', capacityPct: 65, moodPct: 82, avatarSprite: AVATAR_SPRITES.demon },
  { id: 'u_kenan', name: 'Kenan', lastInitial: 'T', role: 'Design Ops', team: 'Ops', capacityPct: 60, moodPct: 79, avatarSprite: AVATAR_SPRITES.witch },
  { id: 'u_fred', name: 'Fred', lastInitial: 'A', role: 'Prototyper', team: 'Design', capacityPct: 78, moodPct: 70, avatarSprite: AVATAR_SPRITES.skeletonGeneral },
  { id: 'u_aidy', name: 'Aidy', lastInitial: 'B', role: 'Design QA', team: 'Design', capacityPct: 82, moodPct: 69, avatarSprite: AVATAR_SPRITES.kid },
]

// ───────────────────────── Projects（~7）────────────────────────────────────

export const PROJECTS: Project[] = [
  {
    // id 'p_acme' 保持不动（守 store / 详情页引用）；retitle 成合伙人 Demo。
    id: 'p_acme',
    title: 'New Retail Smart Shopping Guide',
    ownerId: 'u_vanessa',
    status: 'at-risk',
    progress: 72,
    dueDate: 'This Friday',
    dependsOn: ['p_connector'], // ← Friday Demo 交付依赖核心导购 flow
    summary: 'Client demo for the retail smart shopping guide — user profiles, product recommendations, store dashboard, mobile experience. Ships Friday. Held up while the core guide flow keeps getting reworked.',
    storyCritical: true,
    risk: { progress: 72, blockers: 64, staffing: 38, quality: 30 }, // 依赖核心导购 flow 拖累进度
  },
  {
    // id 'p_connector' 保持不动；retitle 成 Lin Qing 负责的核心导购 flow。
    id: 'p_connector',
    title: 'Core shopping-guide flow',
    ownerId: 'u_bill',
    status: 'at-risk', // 系统判断
    reportedStatus: 'on-track', // ← 经理以为只是更新慢，制造 manager-view mismatch
    progress: 48,
    dueDate: 'This Thursday',
    summary: 'The core guide journey — home entry, recommendation cards, the user-profile dialog. The whole Demo leans on it.',
    storyCritical: true,
    hotspot: true, // briefing「1 hot spot」= 这里（mismatch / Lin Qing 所在）
    risk: { progress: 62, blockers: 86, staffing: 74, quality: 42 }, // Lin Qing 消化变动反馈 + 验收不清
  },
  {
    id: 'p_pitch',
    title: 'Venus Pitch / Prototype 2.0',
    ownerId: 'u_you',
    status: 'on-track',
    progress: 80,
    dueDate: 'Today',
    summary: 'The very demo Venus is watching. 🙂', // 自指 wink
    risk: { progress: 22, blockers: 12, staffing: 30, quality: 18 },
  },
  {
    id: 'p_capabilities',
    title: 'Writing the playbooks',
    ownerId: 'u_wang',
    status: 'on-track',
    progress: 55,
    summary: "Wang is writing down how good managers actually decide — HR, project ops, and more — so the team's advice keeps getting wiser.",
    risk: { progress: 30, blockers: 18, staffing: 26, quality: 20 },
  },
  { id: 'p_designsys', title: 'Design System', ownerId: 'u_andy', status: 'on-track', progress: 64, risk: { progress: 24, blockers: 14, staffing: 22, quality: 26 } },
  { id: 'p_csonboard', title: 'Client Onboarding Kit', ownerId: 'u_kate', status: 'on-track', progress: 40, risk: { progress: 36, blockers: 24, staffing: 48, quality: 22 } }, // Kate 108% load
  { id: 'p_billing', title: 'Store Dashboard polish', ownerId: 'u_jason', status: 'on-track', progress: 30, risk: { progress: 28, blockers: 18, staffing: 16, quality: 24 } },
]

// ───────────────────────── Tasks（聚焦 Demo + 核心导购 flow）─────────────────
// （task title）。id 全部保持不动（fixtures.p3 override 按 id 索引）。

export const TASKS: Task[] = [
  // New Retail Smart Shopping Guide（Demo）
  { id: 't_acme_int', projectId: 'p_acme', title: 'Recommendation data fields', assigneeId: 'u_kristen', status: 'in-progress' }, // Chen Mingyuan
  { id: 't_acme_data', projectId: 'p_acme', title: 'Sort & prioritize client feedback', assigneeId: 'u_vanessa', status: 'in-progress' }, // Sun Xiaomei
  { id: 't_acme_hook', projectId: 'p_acme', title: 'Wire the core flow into the demo build', assigneeId: 'u_bill', status: 'stalled' }, // ← 卡点（Lin Qing）
  { id: 't_acme_uat', projectId: 'p_acme', title: 'Demo walkthrough rehearsal', assigneeId: 'u_aidy', status: 'todo' },
  // Core shopping-guide flow（Lin Qing 负责的核心页面体验）
  { id: 't_con_slack', projectId: 'p_connector', title: 'Home guide entry + recommendation cards', assigneeId: 'u_bill', status: 'stalled' },
  { id: 't_con_gh', projectId: 'p_connector', title: 'User-profile dialog', assigneeId: 'u_bill', status: 'in-progress' },
  { id: 't_con_dedupe', projectId: 'p_connector', title: 'Extra visual polish pass', assigneeId: 'u_bill', status: 'todo' },
]

// ───────────────────────── Signals（reality gap 的证据链）────────────────────

// （全部 summary）。设计世界证据链：Figma frame 反复重做 / 反馈文档未解决评论 /
// 没有明确验收标准。id / subjectId / tag 保持不动（卡片按 id 索引）。
export const SIGNALS: Signal[] = [
  { id: 's_pr', source: 'figma', subjectType: 'project', subjectId: 'p_connector', summary: 'Home guide flow reopened and reworked 6 days running — still no signed-off version', ageDays: 6, tag: 'stalled' },
  { id: 's_blocker', source: 'feedback', subjectType: 'project', subjectId: 'p_connector', summary: '"What counts as done for the recommendation cards?" raised 3 days running, never answered', ageDays: 3, tag: 'repeated-blocker' },
  { id: 's_noupdate', source: 'task', subjectType: 'task', subjectId: 't_con_slack', summary: 'Core flow frames: 12 unresolved feedback comments, no acceptance criteria set', ageDays: 4, tag: 'no-update' },
  { id: 's_report', source: 'manual', subjectType: 'project', subjectId: 'p_connector', summary: 'Manager read the core flow as "just running a little slow" on Monday', ageDays: 2, tag: 'self-report' },
  // ── 根因（People 线）：Lin Qing 不是慢，是 finish line 一直在动（Maslow 安全感/尊重）──
  // tag 'interrupt' 是内部 type 值（不外显），沿用旧标签；summary 已改 Maslow 取景。
  { id: 's_mentions', source: 'feedback', subjectType: 'person', subjectId: 'u_bill', summary: 'Lin Qing absorbed ~9 new client change requests in 3 days — the brief kept moving under her', ageDays: 3, tag: 'interrupt' },
  { id: 's_commits', source: 'figma', subjectType: 'person', subjectId: 'u_bill', summary: "Her week went into reworking screens against new feedback, not finishing the core guide flow", ageDays: 2, tag: 'interrupt' },
]

// ───────────────────────── Capabilities（被 agent 自动优先引用）──────────────
// ⚠ 高价值：这是护城河的"内容证据"。

export const CAPABILITIES: CapabilityEntry[] = [
  {
    id: 'cap_po_dep',
    domain: 'project-ops',
    title: 'Shifting requirements near a ship date',
    gist: 'When the finish line keeps moving — new feedback, unclear acceptance — the first move is to freeze this week’s scope and split who owns what. Protect the core path before reading anyone as slow. A moving target is a project problem, not a person problem.',
  },
  {
    id: 'cap_hr_interrupt',
    domain: 'hr',
    title: 'Reading motivation, not output — Maslow’s ladder',
    gist: 'Before reading slow delivery as low effort, read where someone sits on the motivation ladder: is the workload sustainable, does "done" feel safe and clear, do they feel part of the work or alone in the mess, is their real contribution being seen? Most stalls are a dip in safety and recognition, not capability. Never infer performance from a single signal.',
  },
]

// ───────────────────────── Reality gap / Mismatch 卡 ─────────────────────────
// ⚠ 高价值：killer beat 的卡片内容

// （整块）。Maslow 重写：从"自报 vs 信号"的 report-mismatch
// 改成"经理看到的（Lin Qing 页面更新慢）vs 她实际在扛的（一整周变动的客户反馈）"
// ——贡献没被正确识别（esteem gap）。字段名 / signal id / gapType 语义槽位不动。
export const MISMATCH = {
  subjectPersonId: 'u_bill',
  subjectProjectId: 'p_connector',
  reported: 'Behind — the pages keep slipping',
  signalsSay: 'Carrying a week of changing feedback',
  gapType: 'What the manager sees vs. what Lin Qing is carrying',
  evidenceSignalIds: ['s_pr', 's_blocker', 's_noupdate'],
  rootCause: 'The work didn’t get easier — the brief kept moving. Lin Qing absorbed a week of changing client feedback and rework with no clear sign-off; what looks like "slow" is a week of churn that never showed up as visible progress.',
  rootCauseSignalIds: ['s_mentions', 's_commits'],
  safeFraming: 'This is about understanding what wore her down this week, not grading the person. The fix is freezing the demo scope and making her work visible — not a performance call.',
}

// ───────────────────────── Nexus inspector（B4 / B6 / B7 轻量步）─────────────

const signalById = Object.fromEntries(SIGNALS.map((signal) => [signal.id, signal])) as Record<string, Signal>
const capabilityById = Object.fromEntries(
  CAPABILITIES.map((capability) => [capability.id, capability]),
) as Record<string, CapabilityEntry>

// P5-02 (ADR-0008)：B7 = in-thread Chat 对象。agent 发起、绑定单个决策、用完即合；
// agent 在场抛 evidence + Capabilities；产出沉淀进 report。
export interface HumanLoopMessage {
  id: string
  speaker: string
  role: 'human' | 'agent'
  agentKind?: 'pm' | 'hr'
  text: string
  reference?: string
}

// B7 Chat transcript（Venus-facing 英文）。
// （整段 transcript）。Maslow 重写：1:1 不问"为什么还没好"，
// 改成"我看到你这周处理了很多反馈——先保护核心 Demo 路径，哪些反馈影响交付、
// 哪些能放到下一版"。Avery 起草开场白，真人来发（ADR-0015）。
const HUMAN_LOOP_MESSAGES: HumanLoopMessage[] = [
  {
    id: 'hl_hr_open',
    speaker: 'People',
    role: 'agent',
    agentKind: 'hr',
    text: 'Before anything about the work — open by checking in, not checking up. Something like: "How are you holding up? This week looked rough." Then give her a beat to talk.',
    reference: 'Drafted for you to send',
  },
  {
    id: 'hl_pm_q',
    speaker: 'PM',
    role: 'agent',
    agentKind: 'pm',
    text: 'Once she’s talked, you can steer it gently: "Let’s protect the core guide path together — which of the client changes actually affect Friday, and which can wait for the next version?"',
    reference: 'Drafted for you to send',
  },
  {
    id: 'hl_bill_reveal',
    speaker: 'Lin Qing',
    role: 'human',
    text: "Honestly the brief kept moving — new client feedback every day, and I was never sure what counted as done. I spent the week reworking screens instead of finishing the core guide flow.",
  },
  {
    id: 'hl_hr_frame',
    speaker: 'People',
    role: 'agent',
    agentKind: 'hr',
    text: 'That tracks — she never knew what counted as done, and the week of changes she absorbed isn’t visible anywhere. That wears anyone down, and it’s not about effort. Freezing the scope is the kind move here, not a performance read.',
    reference: 'Playbook · Maslow’s ladder',
  },
  {
    id: 'hl_you_decide',
    speaker: 'You',
    role: 'human',
    text: 'So if we freeze this week’s feedback and make it clear what "done" is, the core demo lands?',
  },
  {
    id: 'hl_bill_commit',
    speaker: 'Lin Qing',
    role: 'human',
    text: 'Yes. If no new feedback comes in this week and I just own the core guide flow, I can have the path working by Thursday and hand it over clean.',
  },
  {
    id: 'hl_pm_plan',
    speaker: 'PM',
    role: 'agent',
    agentKind: 'pm',
    text: "Then let’s freeze scope, split the rest off Lin Qing’s plate — feedback triage, recommendation data fields, key visuals each go to someone else — and give her a short, completable checklist. I’ll lay it out now.",
    reference: 'Next · frozen scope + checklist',
  },
]

export const HUMAN_LOOP = {
  title: 'Lin Qing enters the loop',
  description:
    'Avery drafts the opener — the warm one, not the "why isn’t it done" one — and stays in the room with the evidence and the playbook, so you send it in your own voice.',
  messages: HUMAN_LOOP_MESSAGES,
}

export const NEXUS_INSPECTOR_CONTENT = {
  // （inspector body）。
  'pm-agent': {
    title: 'PM checks delivery evidence',
    body: 'Core-flow evidence is pulled from your design files and feedback rounds, then read against what the team already knows and the Project-Ops playbook on shifting requirements.',
    artifacts: [
      { label: 'Core-flow evidence · s_pr', detail: signalById.s_pr.summary },
      { label: 'Core-flow evidence · s_blocker', detail: signalById.s_blocker.summary },
      { label: 'Core-flow evidence · s_noupdate', detail: signalById.s_noupdate.summary },
      { label: 'Playbook · cap_po_dep', detail: capabilityById.cap_po_dep.gist },
    ],
  },
  'hr-root-cause': {
    title: 'People side checks root cause',
    body: MISMATCH.rootCause,
    artifacts: [
      { label: 'Root cause', detail: 'A moving finish line and invisible contribution — not low output.' },
      { label: 'Workload signal · s_mentions', detail: signalById.s_mentions.summary },
      { label: 'Workload signal · s_commits', detail: signalById.s_commits.summary },
      { label: 'Playbook · cap_hr_interrupt', detail: capabilityById.cap_hr_interrupt.gist },
      { label: 'Safe framing', detail: MISMATCH.safeFraming },
    ],
  },
  // P5-02：human-loop 已毕业到中央 ChatCard，inspector 不再承载（fallback 到 active-nodes）。
} as const

// ───────────────────────── Agent 结构化输出（8 段式 · partner schema）────────
// ⚠⚠ 最高价值：Venus 会逐字读这一段。请你审。
//
// 重构：从旧 6 段式对齐合伙人 advice_output_schema 的 canonical 8 字段
// (summary / detected_signals / diagnosis_hypotheses / evidence / recommended_actions /
//  confidence / escalation / metrics_to_track) + conversation_script。
// 场景不变 = SCN-001「Creative motivation drop after repeated client rejection」
// （Lin Qing：客户反馈反复变动 → 创作动力下降）。红线：只对"处境"给建议，绝不给"人"打分/贴标签/下诊断。
export const AGENT_OUTPUT: AgentOutput = {
  // 1 · summary（原 conclusion，措辞基本保留；已是对"处境"的读法，未改判断）
  summary:
    "Lin Qing’s drop in motivation isn’t about responsibility — the project’s sense of safety and accomplishment have been worn down. Constantly changing client feedback keeps the definition of done unstable, and her real contribution this week — absorbing a week of feedback and rework — isn’t visible anywhere in the project’s progress. The Smart Shopping Guide demo is still holdable for Friday: freeze this week’s demo scope, split the client feedback into priorities, and give Lin Qing a clear, completable checklist, and the core guide path lands.",

  // 2 · detected_signals（NEW · Venus 逐字读）
  // 观察到的具体信号，每条有 evidence 锚（映射真实 signal fixtures s_pr/s_blocker/s_noupdate/s_mentions/s_commits），
  // 是信号不是标签——对应 SCN-001 的 detected_signals（revision cycle rising / idea count down / missed sessions）。
  detected_signals: [
    'Revision loops rising: the home guide flow has been reopened and reworked 6 days running, never signed off (Figma · s_pr).',
    'A moving target: "what counts as done for the recommendation cards?" was asked 3 days running and never answered (Feedback · s_blocker).',
    'Acceptance never set: the core-flow frames carry 12 unresolved feedback comments with no acceptance criteria (Task · s_noupdate).',
    'Interrupt load climbing: ~9 new client change requests landed on Lin Qing in 3 days — the brief kept moving under her (Feedback · s_mentions).',
    'Effort not converting to progress: her week went into reworking screens against new feedback, not finishing the core guide flow (Figma · s_commits).',
  ],

  // 3 · diagnosis_hypotheses（NEW · Venus 逐字读）
  // 关键改动：把单一读法改写成"带至少一个 alternative 的假设"，绝不当事实断言（partner guardrail: diagnosis）。
  // primary 对齐 SCN-001「challenging-work / recognition-of-work」driver；alternatives 留住其他可能，避免误诊。
  diagnosis_hypotheses: [
    {
      label:
        'Most likely: a challenging-work + recognition rupture — the finish line kept moving and a week of absorbed rework stayed invisible, so the work started to feel not worth the creative effort. (A read of the situation, not a verdict on Lin Qing.)',
      kind: 'primary',
    },
    {
      label:
        'Alternative: unclear client acceptance criteria rather than motivation — if "done" were defined up front, the same effort might land as visible progress. Worth ruling out before concluding it is motivation.',
      kind: 'alternative',
    },
    {
      label:
        'Alternative: workload / early wellbeing strain from the interrupt load — check pace and hours in the 1:1 before assuming it is only scope. Do not infer anything about health.',
      kind: 'alternative',
    },
  ],

  // 4 · evidence（保留原文，已 cited）
  evidence: [
    'The Friday demo leans on the core guide flow, and the wire-up task has stalled.',
    'The home guide flow has been reopened and reworked 6 days running — the work is in motion, just never signed off.',
    '"What counts as done for the recommendation cards?" was raised 3 days running and never answered — an unclear, moving target.',
    'The core-flow frames carry 12 unresolved feedback comments with no acceptance criteria, so the week’s effort never landed as visible progress.',
    'Lin Qing absorbed ~9 new client change requests in 3 days; her time went into reworking screens, not finishing the core guide flow.',
  ],

  // 5 · recommended_actions（原 recommendedActions；话术那条拆去 conversation_script，其余保留）
  recommended_actions: [
    // 1 · 不先谈绩效，先冻结本周范围
    'Don’t open with performance — freeze this week’s demo scope first. The Friday demo keeps only the core guide path; no new client feedback gets added in.',
    // 2 · 把责任拆清楚（写进 Project Detail）
    'Split who owns what: Lin Qing takes the core guide flow only; Sun Xiaomei triages and prioritizes incoming client feedback; Chen Mingyuan confirms the recommendation data fields; Zheng Zixuan does the key visuals and nothing extra.',
    // 3 · 给 Lin Qing 一个可完成的 checklist
    'Give Lin Qing a short, completable checklist — home guide entry, recommendation cards, the user-profile dialog, the path running end to end — and push every non-core piece of feedback to the next iteration.',
    // 4 · 客户侧把"什么算做完"定下来（对齐 SCN-001 recommendation: clarify success criteria）
    'Agree the client-side "definition of done" for the core flow before the next review, so the same effort finally lands as accepted progress instead of another rework loop.',
  ],

  // 6 · confidence（NEW · Venus 逐字读）
  // 明确 level + 什么会改变它（吸收原 uncertainties，改成"会推高/推低信心的条件"）。SCN-001 risk_level = medium。
  confidence: {
    level: 'medium',
    rationale:
      'The delivery signals (rework loops, unanswered "done", interrupt load) line up cleanly, but they come from work-trail data, not from Lin Qing herself — the motivation read stays a hypothesis until the 1:1 confirms it.',
    wouldChange: [
      'Higher if the 1:1 confirms the moving brief is what wore her down, and the team actually holds "no new client feedback this week".',
      'Lower if the client would rather take a proactive Tuesday slip than a thinner-but-on-time Friday demo, which would change the whole plan.',
    ],
  },

  // 7 · escalation（NEW · Venus 逐字读）
  // 何时把 HR/legal 拉进来 + 谁来确认。对齐 SCN-001 hrbp_escalation（burnout / unfair treatment / performance risk）
  // 与 partner guardrails。confirmWith 沿用原 needsConfirmationFrom 语义槽（守 personByName 头像引用）。
  escalation: {
    level: 'none',
    note:
      'No HR involvement needed yet — this reads as scope and workload, not capability, conduct, or pay. Pull in HRBP if the 1:1 surfaces burnout, if the client feedback tips into unfair or unsafe treatment, or if this keeps recurring after the reset. Check in again next week.',
    confirmWith: ['You (manager) — freezing this week’s demo scope', 'Sun Xiaomei — the responsibility split'],
  },

  // 8 · metrics_to_track（NEW · Venus 逐字读）
  // 看什么才知道奏效——对齐 SCN-001 metrics_to_track，但只用场景已支撑的量、不编造数字。
  metrics_to_track: [
    'Core guide path running end to end by Thursday, then holding through the Friday demo.',
    'No new client-feedback items added to this week’s frozen scope (the freeze is respected).',
    'Revision loops on the core flow settling once acceptance criteria are set.',
    'A quick check-in next week on how Lin Qing is doing after the reset.',
  ],

  // + · conversation_script（surface 原第 4 条 1:1 话术；"senior 在耳边"的开场白）
  conversation_script:
    'In the 1:1, lead with what she carried, not what’s missing: "I saw you handled a lot of client feedback this week — which of it actually affects Friday, and which can move to the next version?"',

  nextTasks: [
    { title: 'Own the core guide flow only — work the completable checklist to a running path', assigneeId: 'u_bill', due: 'Thursday' },
    { title: 'Triage incoming client feedback into "affects Friday" vs "next iteration"', assigneeId: 'u_vanessa', due: 'Today' },
    { title: 'Confirm the recommendation data fields the core flow needs', assigneeId: 'u_kristen', due: 'Today' },
  ],
}

// ───────────────────────── Timeline（B8 工具产出）──────────────────────────

// Maslow 重写：从"re-baseline"改成"冻结范围 + 责任拆分"取景；
// state 值（replanned/held/deferred/conditional）不动——MILESTONE_STATE_COPY 据此渲染。
export const TIMELINE = {
  title: 'Smart Shopping Guide demo — scope frozen, core path protected for Friday',
  milestones: [
    { label: 'Freeze this week’s demo scope (no new feedback)', when: 'Thu', state: 'replanned' },
    { label: 'Lin Qing — core guide flow running end to end', when: 'Thu pm', state: 'replanned' },
    { label: 'Client demo walkthrough', when: 'Fri am', state: 'planned' },
    { label: 'Core demo lands', when: 'Fri', state: 'held' }, // ← 主方案的胜利点
    { label: 'Non-core feedback', when: 'Next week', state: 'deferred' },
    { label: 'Slip to Tue', when: 'Tue', state: 'conditional' }, // 仅当核心路径周四前走不通才触发
  ],
}

// （整块）。合伙人案例的核心产物，作为 TimelineCard 内的明确组件呈现：
// (1) 责任拆分——把活儿从 Lin Qing 一个人手里拆给团队；(2) 给 Lin Qing 的可完成 checklist
// （清楚的交付边界 + "什么算做完"），非核心反馈进 next iteration。owner 用 person id（守头像引用）。
export const SCOPE_SPLIT: { ownerId: string; scope: string }[] = [
  { ownerId: 'u_bill', scope: 'Core guide flow — and only the core flow' },
  { ownerId: 'u_vanessa', scope: 'Triage and prioritize the client feedback' },
  { ownerId: 'u_kristen', scope: 'Confirm the recommendation data fields' },
  { ownerId: 'u_andy', scope: 'Key visuals only — no extra polishing' },
]

export const LIN_QING_CHECKLIST: { id: string; label: string; done: boolean }[] = [
  { id: 'ck_entry', label: 'Home guide entry', done: false },
  { id: 'ck_cards', label: 'Recommendation cards', done: false },
  { id: 'ck_dialog', label: 'User-profile dialog', done: false },
  { id: 'ck_path', label: 'Whole guide path runs end to end', done: false },
  { id: 'ck_defer', label: 'Non-core feedback → next iteration', done: true },
]

// ───────────────────────── Briefings（B1 calm / B10 updated）────────────────
// ⚠ 高价值：开场与收尾的"组织天气"

// （headline / subhead）。
export const BRIEFING_V1: Briefing = {
  id: 'b_v1',
  version: 1,
  tone: 'calm',
  headline: 'The Smart Shopping Guide demo ships Friday. Team health looks steady.',
  subhead: 'One quiet hot-spot sits around the core guide flow.',
  metrics: [
    { label: 'health', value: '82%' },
    { label: 'active projects', value: '7' },
    { label: 'hot spots', value: '1' },
  ],
}

// （headline / subhead）。
export const BRIEFING_V2: Briefing = {
  id: 'b_v2',
  version: 2,
  tone: 'alert', // 仍非 calm：风险是真的，只是已被看见并接管
  headline: 'The demo still ships Friday — the hidden risk is caught and owned.',
  subhead: 'The dip was a moving finish line, not a delivery slip. Scope frozen this week · responsibilities split · Lin Qing on a clear checklist · Tuesday held as contingency.',
  metrics: [
    { label: 'health', value: '82%' }, // 不再是"乐观盲值"，而是已校验、风险已 owned
    { label: 'risks owned', value: '1' },
    { label: 'actions in flight', value: '3' },
  ],
}

// ───────────────────────── Onboarding（B0 prologue）─────────────────────────

// （onboarding 段全部英文 copy）。设计团队 re-flavor：源换成 Figma / 反馈渠道。
export const ONBOARDING = {
  sampleFiles: [
    { name: 'Studio_Handbook.pdf', kind: 'pdf' },
    { name: 'Smart_Shopping_Guide_Brief.docx', kind: 'docx' },
    { name: 'Team_Roster.csv', kind: 'csv' },
    { name: 'Demo_Roadmap.md', kind: 'md' },
  ],
  // 连接动态事实源（Figma/反馈渠道）——注入团队动态记忆前过三道安全工序，产物只落本地。
  connectSources: [
    { name: 'Figma', detail: 'Files · frames · comments' },
    { name: 'Feedback', detail: 'Client rounds · design reviews' },
  ],
  connectPipeline: ['Names kept private', 'Tidied up', 'Checked for anything sensitive'],
  connectNote: 'Everything it learns stays on your machine — nothing leaves, nothing goes to a server.',
  parsedInto: ['Studio profile', 'Team roster (14 people)', '7 active projects', 'Recent work signals'],
  capabilitiesMatched: ['Project Ops playbooks', 'HR playbooks'], // 自动优先
  caption:
    "Give it what you'd hand a new design manager on day one — the files, the feedback, the context — and it'll learn your team from there.",
}

// ───────────────────────── Dashboard tags（B1/B2 自由交互，最多 5）─────────────

export const DASHBOARD_TAGS: DashboardTag[] = [
  { id: 'tag_week', label: 'This week', match: { by: 'due', within: 'this-week' } },
  { id: 'tag_risk', label: 'At risk', match: { by: 'status', status: 'at-risk' } },
  { id: 'tag_acme', label: 'Shopping Guide demo', match: { by: 'project', projectId: 'p_acme' } },
  { id: 'tag_eng', label: 'Design', match: { by: 'team', team: 'Design' } },
  { id: 'tag_hot', label: 'Hot spots', match: { by: 'hotspot' } },
]

// ───────────────────────── Hero 问题（B3 composer）──────────────────────────

export const HERO_QUESTION = 'Are we on track to ship the Smart Shopping Guide demo this Friday?'
