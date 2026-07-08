import { CAPABILITIES, PEOPLE, PROJECTS, type Task } from '../../data/fixtures'
import {
  employeeOverviewFor,
  hrAnalysisFor,
  signalsFor,
  tasksForPerson,
  weeklySummaryFor,
  type DetailPhase,
} from '../../data/fixtures.p3'
import { DetailSection, DetailShell, SourceAnchor } from '../DetailShell'
import { PixelAvatar } from '../PixelAvatar'
import { useCanvas } from '../../store/canvasStore'
import { useRail } from '../../store/railStore'
import { BILL_ACME_CASE_ID } from '../../data/cases'

// feat-006 红线（ADR-0015/0016）：录屏帧里，人身上不能出现数字/分数。
// `progressValue` 形如 "48% · core path protected"——48% 是项目完成度，但渲染在 Lin Qing
// 详情页的 stat 槽里、紧挨她名字，镜头里会被读成「给人打分」。capture 时摘掉前导百分数，
// 只留护着人的人话（"core path protected"）；若摘完为空则整个 Progress 槽不渲染。
function stripPersonNumber(value: string): string {
  return value.replace(/^\s*\d+%\s*(?:·\s*)?/, '').trim()
}

// P5-03：员工详情页 state-aware。Nexus 完成前只显 raw facts；B9 后智能层长出。
// 概览卡 / current tasks / weekly summary+sentiment / HR knowledge analysis。
// 故事人四模块全有；texture 人走派生卡 + tasks，缺数据模块走干净空态。

const projectTitleOf = (id: string) => PROJECTS.find((p) => p.id === id)?.title ?? '—'
const capabilityTitleOf = (id: string) => CAPABILITIES.find((c) => c.id === id)?.title ?? id

const TASK_STATUS_LABEL: Record<Task['status'], string> = {
  todo: 'To do',
  'in-progress': 'In progress',
  stalled: 'Stalled',
  done: 'Done',
}

// believed/grown 模块深度标签。
const HR_ANALYSIS_EYEBROW = {
  believed: "What's showing up",
  grown: 'Playbook-backed',
} satisfies Record<DetailPhase, string>

export function EmployeeDetailScene() {
  const detail = useCanvas((s) => s.detail)
  // believed→grown 看的是 hero case（bill/acme）的 thread——report 落地与否决定详情页相位
  //（ADR-0009），与当前 active thread 是哪个 case 无关（P6-01 多 thread 化后语义不变）。
  const isGrown = useCanvas(
    (s) =>
      s.threads[BILL_ACME_CASE_ID]?.steps.some((step) => step.kind === 'structured-output') ??
      false,
  )
  const person = PEOPLE.find((p) => p.id === detail?.id)

  if (!person) {
    return (
      <DetailShell ariaLabel="Employee detail" eyebrow="Employee detail" title="Unknown teammate">
        <DetailSection title="Not found" empty="This teammate is no longer on the roster." />
      </DetailShell>
    )
  }

  const capture = useRail((s) => s.capture)
  const phase: DetailPhase = isGrown ? 'grown' : 'believed'
  const overview = employeeOverviewFor(person, phase)
  // capture 时把 progress 数字摘成人话；非空才渲染 Progress 槽。
  const progressDisplay = capture ? stripPersonNumber(overview.progressValue) : overview.progressValue
  const tasks = tasksForPerson(person.id, phase)
  const weekly = weeklySummaryFor(person.id, phase)
  const analysis = hrAnalysisFor(person.id, phase)
  const personSignals = signalsFor(person.id, phase)
  const analysisRecommendations = analysis?.recommendations ?? []

  return (
    <DetailShell
      ariaLabel="Employee detail"
      sceneClass="scene-employee"
      eyebrow="Employee detail"
      title={person.name}
      subtitle={`${person.role} · ${person.team}`}
      media={<PixelAvatar person={person} size={56} className="detail-avatar" />}
    >
      {/* 1 · 概览卡：Workload / Status / Progress / HR signal */}
      <section className="overview-card" aria-label="Overview">
        <div className="overview-grid">
          <div className="overview-stat">
            <span className="overview-label">{overview.workloadLabel}</span>
            <strong>{overview.workloadValue}</strong>
          </div>

          <div className="overview-stat">
            <span className="overview-label">Status</span>
            <strong>
              <span className={`status-dot ${isGrown ? 'tone-stable' : 'tone-warning'}`} aria-hidden="true" />
              {overview.statusLabel}
            </strong>
          </div>

          {progressDisplay ? (
            <div className="overview-stat">
              <span className="overview-label">{overview.progressLabel}</span>
              <strong>{progressDisplay}</strong>
            </div>
          ) : null}

          <div className="overview-stat">
            <span className="overview-label">HR signal</span>
            <strong className={overview.hrSignal ? undefined : 'is-empty'}>
              {overview.hrSignal ?? 'No HR signal — looks steady'}
              <SourceAnchor signals={personSignals} />
            </strong>
          </div>
        </div>
      </section>

      {/* 2 · Current project tasks（TASKS by assignee）*/}
      <DetailSection
        eyebrow="Workload"
        title="Current project tasks"
        empty={tasks.length === 0 ? 'No active tasks right now.' : undefined}
      >
        <div className="task-card-list">
          {tasks.map((task) => (
            <article key={task.id} className={`task-card is-${task.status}`}>
              <strong>{task.title}</strong>
              <span className="task-card-meta">
                <span>{projectTitleOf(task.projectId)}</span>
                <span className="task-status-pill">{TASK_STATUS_LABEL[task.status]}</span>
              </span>
              <p className="phase-note">{task.note}</p>
            </article>
          ))}
        </div>
      </DetailSection>

      {/* 3 · How the week went（去掉情绪 badge，让护着人的 prose 承载——ADR-0015 红线）*/}
      <DetailSection
        eyebrow="This week"
        title="How the week went"
        empty={weekly ? undefined : 'Nothing notable came up this week.'}
      >
        {weekly ? (
          <div className="weekly-block">
            <p>
              {weekly.text}
              <SourceAnchor signals={personSignals} />
            </p>
          </div>
        ) : null}
      </DetailSection>

      {/* 4 · HR knowledge analysis（capability-backed · no personnel judgment）*/}
      <DetailSection
        eyebrow={HR_ANALYSIS_EYEBROW[phase]}
        title="What this looks like"
        empty={analysis ? undefined : 'Nothing to flag — things look steady here.'}
      >
        {analysis ? (
          <div className="hr-analysis">
            {analysis.capabilityId ? (
              <p className="hr-analysis-capability">
                Playbook · {capabilityTitleOf(analysis.capabilityId)}
              </p>
            ) : null}
            <p className="hr-analysis-reading">
              {analysis.reading}
              <SourceAnchor signals={personSignals} />
            </p>
            {analysisRecommendations.length > 0 ? (
              <ol className="hr-analysis-recs">
                {analysisRecommendations.map((rec) => (
                  <li key={rec}>
                    {rec}
                    <SourceAnchor signals={personSignals} label="Why" />
                  </li>
                ))}
              </ol>
            ) : null}
            {analysis.framing ? (
              <p className="hr-analysis-framing">
                {analysis.framing}
                <SourceAnchor signals={personSignals} />
              </p>
            ) : null}
          </div>
        ) : null}
      </DetailSection>
    </DetailShell>
  )
}
