import { useState } from 'react'
import { PEOPLE, PROJECTS, type Signal } from '../../data/fixtures'
import {
  MILESTONE_STATE_COPY,
  TASK_BOARD_COLUMNS,
  handoffsForProject,
  milestoneOrder,
  projectBriefFor,
  projectMilestones,
  projectTeam,
  reportMismatchForProject,
  signalsForProject,
  tasksForProject,
  weeklyUpdatesForProject,
  type DetailPhase,
} from '../../data/fixtures.p3'
import { DetailSection, DetailShell, SourceAnchor } from '../DetailShell'
import { PixelAvatar } from '../PixelAvatar'
import { useCanvas } from '../../store/canvasStore'
import { BILL_ACME_CASE_ID } from '../../data/cases'

// P5-03：项目详情页 state-aware。Nexus 完成前只显 raw facts；B9 后智能层长出。
// 主层级：brief / milestones / team / task board / handoffs / weekly updates。
// 次层级（下沉护 reveal）：Risk & HR signal · Evidence。
// 故事项目全模块；texture 项目走派生数据 + 干净空态。复用 DetailShell。

const nameOf = (id: string) => PEOPLE.find((p) => p.id === id)?.name ?? id
const titleOf = (id: string) => PROJECTS.find((p) => p.id === id)?.title ?? id

function statusTone(status: string) {
  if (status === 'blocked') return 'tone-danger'
  if (status === 'at-risk') return 'tone-warning'
  return ''
}

// grown 态项目状态文案。
const GROWN_STATUS_LABEL: Record<string, string> = {
  p_acme: 'at risk · diagnosed · actions in flight · Friday held',
  p_connector: 'at risk · diagnosed · actions in flight',
}

// Act1/Act3 detail shell copy.
const NO_HANDOFFS_COPY = 'Nothing to hand off yet — no next steps drawn up so far.'
const RISK_CALLOUT_LABEL = {
  believed: 'Reported vs signals',
  grown: 'Worth a closer look',
} satisfies Record<DetailPhase, string>

function statusLabel(projectId: string, status: string, phase: DetailPhase) {
  if (phase === 'grown') return GROWN_STATUS_LABEL[projectId] ?? status.replace('-', ' ')
  return status.replace('-', ' ')
}

function actionSignalsFor(handoffText: string, symptomSignals: Signal[], interruptSignals: Signal[]) {
  // 行动文案命中"人/反馈/1:1/checklist"语义 → 用 person-level（workload）证据；否则用症状证据。
  if (/Lin Qing|feedback|focus|checklist|1:1/i.test(handoffText) && interruptSignals.length > 0) {
    return interruptSignals
  }
  return symptomSignals
}

type HandoffState = 'open' | 'done' | 'discarded'

export function ProjectDetailScene() {
  const detail = useCanvas((s) => s.detail)
  const askQuestion = useCanvas((s) => s.askQuestion)
  // believed→grown 看的是 hero case（bill/acme）的 thread——report 落地与否决定详情页相位
  //（ADR-0009），与当前 active thread 是哪个 case 无关（P6-01 多 thread 化后语义不变）。
  const isGrown = useCanvas(
    (s) =>
      s.threads[BILL_ACME_CASE_ID]?.steps.some((step) => step.kind === 'structured-output') ??
      false,
  )
  const project = PROJECTS.find((p) => p.id === detail?.id)
  // handoff checklist = 本地交互（不入 store，符合「不扩 store」铁律）。
  const [handoffState, setHandoffState] = useState<Record<string, HandoffState>>({})

  if (!project) {
    return (
      <DetailShell ariaLabel="Project detail" eyebrow="Project detail" title="Unknown project">
        <DetailSection title="Not found" empty="This project is no longer on the board." />
      </DetailShell>
    )
  }

  const phase: DetailPhase = isGrown ? 'grown' : 'believed'
  const brief = projectBriefFor(project, phase)
  const milestones = projectMilestones(project.id, phase)
  const sortedMilestones = milestones
    ? [...milestones].sort((a, b) => milestoneOrder(a.when) - milestoneOrder(b.when))
    : null
  const team = projectTeam(project.id, phase)
  const tasks = tasksForProject(project.id, phase)
  const handoffs = handoffsForProject(project.id, phase)
  const weekly = weeklyUpdatesForProject(project.id, phase)
  const signals = signalsForProject(project.id, phase)
  const mismatch = reportMismatchForProject(project.id)
  const milestoneEyebrow = isGrown ? 'Re-baselined' : 'Original plan'
  const symptomSourceSignals = signals.filter((signal) => signal.tag !== 'interrupt')
  const interruptSourceSignals = signals.filter((signal) => signal.tag === 'interrupt')
  const fallbackSymptomSignals = symptomSourceSignals.length > 0 ? symptomSourceSignals : signals
  const fallbackInterruptSignals = interruptSourceSignals.length > 0 ? interruptSourceSignals : signals

  const setHandoff = (id: string, state: HandoffState) =>
    setHandoffState((prev) => ({ ...prev, [id]: state }))

  return (
    <DetailShell
      ariaLabel="Project detail"
      sceneClass="scene-project"
      eyebrow="Project detail"
      title={project.title}
      subtitle={`${project.status.replace('-', ' ')} · owned by ${nameOf(project.ownerId)}`}
    >
      {/* 1 · Project brief */}
      <section className="brief-card" aria-label="Project brief">
        <p className="brief-summary">{brief.summary}</p>
        <div className="progress-track" aria-hidden="true">
          <div className="progress-fill" style={{ width: `${project.progress}%` }} />
        </div>
        <div className="brief-meta">
          <span className={`brief-status ${statusTone(project.status)}`}>
            <span className="status-dot" aria-hidden="true" />
            {brief.statusLabel || statusLabel(project.id, project.status, phase)}
          </span>
          <span>{brief.progressLabel}</span>
          {project.dueDate ? <span>Due {project.dueDate}</span> : null}
          {project.dependsOn?.map((depId) => (
            <span key={depId} className="brief-dep">
              {brief.dependencyLabel ?? `Depends on ${titleOf(depId)}`}
            </span>
          ))}
          {mismatch ? (
            <>
              <span className="brief-mismatch">Read as {mismatch.reported.toLowerCase()}</span>
              <span className="brief-mismatch">
                Signals say {mismatch.signalsSay.toLowerCase()}
                <SourceAnchor signals={fallbackSymptomSignals} />
              </span>
            </>
          ) : null}
        </div>
        {mismatch ? (
          <div className={`anchored-claim-panel ${isGrown ? 'is-grown' : 'is-believed'}`}>
            <p className="overview-label">{RISK_CALLOUT_LABEL[phase]}</p>
            {isGrown ? (
              <>
                <strong>
                  {mismatch.gapType}: read in, actions in flight, still at-risk.
                  <SourceAnchor signals={fallbackSymptomSignals} />
                </strong>
                <span>
                  {mismatch.rootCause}
                  <SourceAnchor signals={fallbackInterruptSignals} />
                </span>
                <em>
                  {mismatch.safeFraming}
                  <SourceAnchor signals={fallbackInterruptSignals} />
                </em>
              </>
            ) : (
              <>
                <strong>
                  The core guide flow is the visible blocker: read as just slow, but the live signals say churn.
                  <SourceAnchor signals={fallbackSymptomSignals} />
                </strong>
                <span>
                  The week of changing feedback Lin Qing absorbed is visible, but no read has been generated yet.
                  <SourceAnchor signals={fallbackInterruptSignals} />
                </span>
              </>
            )}
          </div>
        ) : null}
      </section>

      <DetailSection
        eyebrow={milestoneEyebrow}
        title="Delivery milestones"
        empty={sortedMilestones ? undefined : 'No milestone plan yet — nothing scheduled.'}
      >
        {sortedMilestones ? (
          <ol className="milestone-track">
            {sortedMilestones.map((milestone) => {
              const copy = MILESTONE_STATE_COPY[milestone.state] ?? {
                label: milestone.state,
                tone: '',
              }
              const milestoneSignals = ['stalled', 'at-risk', 'waiting'].includes(milestone.state)
                ? fallbackSymptomSignals
                : []
              return (
                <li key={`${milestone.when}-${milestone.label}`} className={`milestone ${copy.tone}`}>
                  <span className="milestone-when">{milestone.when}</span>
                  <span className="milestone-dot" aria-hidden="true" />
                  <div className="milestone-body">
                    <strong>
                      {milestone.label}
                      <SourceAnchor signals={milestoneSignals} />
                    </strong>
                    <span className="milestone-state">{copy.label}</span>
                  </div>
                </li>
              )
            })}
          </ol>
        ) : null}
      </DetailSection>

      {/* 3 · Team responsibilities */}
      <DetailSection
        eyebrow="Who's on it"
        title="Team responsibilities"
        empty={team.length === 0 ? 'No one assigned yet.' : undefined}
      >
        <div className="team-avatars">
          {team.map(({ person, role, note }) => (
            <div key={person.id} className="team-member">
              <PixelAvatar person={person} size={34} />
              <div>
                <strong>{person.name}</strong>
                <span>
                  {note || `${role} · ${person.role}`}
                </span>
              </div>
            </div>
          ))}
        </div>
      </DetailSection>

      {/* 4 · Task board（3 段：Needs decision / In progress / Done or waiting）*/}
      <DetailSection
        eyebrow="Current work"
        title="Task board"
        empty={tasks.length === 0 ? 'No tasks on this project yet.' : undefined}
      >
        <div className="task-board">
          {TASK_BOARD_COLUMNS.map((column) => {
            const columnTasks = tasks.filter((task) => column.statuses.includes(task.status))
            return (
              <div key={column.key} className={`task-column is-${column.key}`}>
                <p className="task-column-head">
                  {column.title} <span>{columnTasks.length}</span>
                </p>
                <div className="task-column-list">
                  {columnTasks.length === 0 ? (
                    <p className="task-column-empty">Nothing here</p>
                  ) : (
                    columnTasks.map((task) => {
                      const directSignals = signals.filter(
                        (signal) => signal.subjectType === 'task' && signal.subjectId === task.id,
                      )
                      const taskSignals =
                        directSignals.length > 0
                          ? directSignals
                          : task.status === 'stalled'
                            ? fallbackSymptomSignals
                            : []
                      return (
                        <article key={task.id} className="board-card">
                          <strong>
                            {task.title}
                            <SourceAnchor signals={taskSignals} />
                          </strong>
                          <span>{nameOf(task.assigneeId)}</span>
                          <p className="phase-note">{task.note}</p>
                        </article>
                      )
                    })
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </DetailSection>

      {/* 5 · Handoffs（checklist：done / discard · 部分一键飞回 Nexus）*/}
      <DetailSection
        eyebrow="Ready to act"
        title="Handoffs"
        empty={handoffs.length === 0 ? NO_HANDOFFS_COPY : undefined}
      >
        <div className="handoff-list">
          {handoffs.map((handoff) => {
            const state = handoffState[handoff.id] ?? 'open'
            const handoffSignals = actionSignalsFor(
              handoff.text,
              fallbackSymptomSignals,
              fallbackInterruptSignals,
            )
            return (
              <article key={handoff.id} className={`handoff-card is-${state}`}>
                <div className="handoff-body">
                  <strong>
                    {handoff.text}
                    <SourceAnchor signals={handoffSignals} label="Why" />
                  </strong>
                  {handoff.detail ? (
                    <p>
                      {handoff.detail}
                      <SourceAnchor signals={handoffSignals} />
                    </p>
                  ) : null}
                  {handoff.flyToNexus ? (
                    <button
                      type="button"
                      className="handoff-fly"
                      onClick={() => askQuestion(handoff.flyToNexus as string)}
                    >
                      Take this into the room →
                    </button>
                  ) : null}
                </div>
                <div className="handoff-actions">
                  {state === 'open' ? (
                    <>
                      <button
                        type="button"
                        className="handoff-done"
                        onClick={() => setHandoff(handoff.id, 'done')}
                      >
                        Done
                      </button>
                      <button
                        type="button"
                        className="handoff-discard"
                        onClick={() => setHandoff(handoff.id, 'discarded')}
                      >
                        Discard
                      </button>
                    </>
                  ) : (
                    <span className="handoff-tag">
                      {state === 'done' ? 'Done' : 'Discarded'}
                      <button
                        type="button"
                        className="handoff-undo"
                        onClick={() => setHandoff(handoff.id, 'open')}
                      >
                        Undo
                      </button>
                    </span>
                  )}
                </div>
              </article>
            )
          })}
        </div>
      </DetailSection>

      {/* 6 · Weekly team updates */}
      <DetailSection
        eyebrow="This week"
        title="Weekly team updates"
        empty={weekly.length === 0 ? 'No updates logged this week.' : undefined}
      >
        <div className="weekly-update-list">
          {weekly.map((update) => {
            const personSignals = signals.filter(
              (signal) => signal.subjectType === 'person' && signal.subjectId === update.personId,
            )
            const updateSignals =
              personSignals.length > 0 ||
              /core (guide )?flow|feedback|reworked|stalled|dependency|walkthrough|demo/i.test(update.update)
                ? personSignals.length > 0
                  ? personSignals
                  : fallbackSymptomSignals
                : []
            return (
              <div key={update.personId} className="weekly-update-row">
                <strong>{nameOf(update.personId)}</strong>
                <p>
                  {update.update}
                  <SourceAnchor signals={updateSignals} />
                </p>
              </div>
            )
          })}
        </div>
      </DetailSection>
    </DetailShell>
  )
}
