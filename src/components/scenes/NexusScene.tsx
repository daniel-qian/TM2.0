import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type MouseEvent,
  type ReactNode,
} from 'react'
import type { ReactZoomPanPinchRef } from 'react-zoom-pan-pinch'
import {
  AGENT_OUTPUT,
  HERO_QUESTION,
  HUMAN_LOOP,
  LIN_QING_CHECKLIST,
  MISMATCH,
  PEOPLE,
  SCOPE_SPLIT,
  SIGNALS,
  TIMELINE,
  type AgentOutput,
  type Person,
  type Signal,
  type TaskTemplate,
} from '../../data/fixtures'
import {
  APPLE_POLICY_SCREENSHOT,
  APPLE_POLICY_URL_DISPLAY,
  CASES,
  DEFAULT_CASE_ID,
  type CardAnchor,
  type CaseDefinition,
  type StreamLine,
  type StreamSpeaker,
} from '../../data/cases'
import { NEXUS_BOARD, bboxOf, type Pos } from '../../data/board'
import {
  pristineThread,
  threadPlan,
  useCanvas,
  type Thread,
  type ThreadStepKind,
} from '../../store/canvasStore'
import { PanZoomCanvas } from '../PanZoomCanvas'
import { flyToTarget, useRailCamera, type CameraTarget, type SafeInsets } from '../../lib/useRailCamera'
import { PixelAvatar } from '../PixelAvatar'
import { useLive } from '../../store/liveStore'
import { useDict } from '../../i18n/useDict'

// feat-004 (ADR-0014 决策 1)：终端 = viewport-fixed 左栏 HUD。镜头只对 Manifest 区取景，
// insets.left 加宽为终端栏宽（440 + 边距）；其余薄边清 Topbar / advance-bar。
const NEXUS_INSETS: SafeInsets = { top: 80, right: 28, bottom: 100, left: 496 }

// P6-01 (ADR-0013)：step labels / Manifest 锚点全部住在 per-case 定义（data/cases.ts），
// 本 scene 只读 active case。feat-004 (ADR-0014)：节点链渲染退役，思考过程改终端流。

function classNames(parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ')
}

// Manifest 列卡槽（修订 5）：定位到该拍的列内堆叠锚点；活跃拍的卡高亮、历史卡留存淡显。
// P6-03：卡可点——镜头飞向该卡（onInspect = 组件本地镜头命令，不进 store）；卡内
// 交互件（按钮/输入框等）的点击不触发飞行。chip 槽：锚定的 follow-up chip 挂在卡下缘。
function CardSlot({
  anchor,
  isActive,
  onInspect,
  chip,
  children,
}: {
  anchor: CardAnchor | undefined
  isActive: boolean
  onInspect?: () => void
  chip?: ReactNode
  children: ReactNode
}) {
  if (!anchor) return <>{children}</>
  const handleClick = onInspect
    ? (event: MouseEvent<HTMLDivElement>) => {
        const target = event.target as HTMLElement
        if (target.closest('button, input, textarea, select, a, label')) return
        onInspect()
      }
    : undefined
  return (
    <div
      className={classNames(['nexus-card-slot', isActive && 'is-active', onInspect && 'is-inspectable'])}
      style={{ left: `${anchor.pos.x}px`, top: `${anchor.pos.y}px` }}
      onClick={handleClick}
    >
      {children}
      {chip}
    </div>
  )
}

const mismatchEvidence = MISMATCH.evidenceSignalIds
  .map((signalId) => SIGNALS.find((signal) => signal.id === signalId))
  .filter((signal): signal is Signal => Boolean(signal))

const TIMELINE_WHEN_ORDER: Record<string, number> = {
  Thu: 0,
  'Thu pm': 1,
  'Fri am': 2,
  Fri: 3,
  'Next week': 4,
  Tue: 5,
}

const TIMELINE_STATE_COPY: Record<string, { label: string; detail: string }> = {
  replanned: { label: 'Replanned', detail: 'Moved into the trimmed Friday path.' },
  planned: { label: 'Planned', detail: 'Kept in the main Friday path.' },
  held: { label: 'Held', detail: 'Main plan focus: Friday still ships.' },
  deferred: { label: 'Deferred', detail: 'Cut from core scope to protect Friday.' },
  conditional: {
    label: 'Conditional',
    detail: 'Contingency only if the core guide flow is not running by Thursday.',
  },
}

function taskTemplateKey(task: TaskTemplate) {
  return `${task.title}::${task.assigneeId}::${task.due}`
}

function nameOf(personId: string) {
  return PEOPLE.find((person) => person.id === personId)?.name ?? personId
}

// 人名标签 → Person。chat speaker 用精确名（"Lin Qing" / "You"）；report confirmation 用前导词
// （"Sun Xiaomei — the responsibility split" → "Sun Xiaomei"）。agent 名（"PM agent"）取不到 person → 返回 undefined。
function personByName(label: string) {
  const token = label.split(/\s[—(–-]/)[0].trim()
  return PEOPLE.find((person) => person.name === token)
}

const BILL_PERSON = PEOPLE.find((person) => person.id === 'u_bill')

// ── feat-004 (ADR-0014)：终端流 HUD ──────────────────────────────────────────
// per-speaker 前缀 + 专色（决策 4）；MANIFEST 行自带前缀与强调色（决策 3）。
const SPEAKER_META: Record<StreamSpeaker, { label: string; className: string }> = {
  you: { label: 'YOU', className: 'is-you' },
  pm: { label: 'PM', className: 'is-pm' },
  hr: { label: 'PEOPLE', className: 'is-hr' },
  agent: { label: 'AVERY', className: 'is-agent' },
  tool: { label: 'TOOL', className: 'is-tool' },
  system: { label: '·', className: 'is-system' },
  bill: { label: 'LIN QING', className: 'is-bill' }, // token 'bill' = 内部 StreamSpeaker，display 改 Lin Qing
}

// 决定 3（Danny）：去掉机器人腔的 "agent" 字与 "AIDE" 名，保留「多专家协同」实质。
// chat 里的专家 badge：内部 agentKind（'pm'|'hr'，type 不动）→ 人味专业身份标签。
// HR 用 "People" 更有人味；不再拼 "… agent"。
const SPECIALIST_BADGE: Record<'pm' | 'hr', string> = {
  pm: 'PM',
  hr: 'People',
}

interface TerminalLine extends StreamLine {
  key: string
  attachment?: { src: string; name: string }
}

// 行集合 = (caseDef, thread) 纯函数（决策 5）：question 首行（含附件 chip，决策 9）+
// 每 step 的脚本行；follow-up 段首步前插入该次提问行。replay-safe——seek 任意 index
// 重算即得，store 零新增。burstStart = 最新一拍行组的起点（行级 stagger 只动这一段）。
function deriveTerminalLines(
  caseDef: CaseDefinition,
  thread: Thread,
): { lines: TerminalLine[]; burstStart: number } {
  const lines: TerminalLine[] = []
  lines.push({
    speaker: 'you',
    type: 'thought',
    text: thread.question ?? caseDef.question,
    key: 'question',
    attachment: caseDef.questionAttachment,
  })
  let burstStart = 0
  thread.steps.forEach((step, i) => {
    burstStart = lines.length
    const prev = thread.steps[i - 1]
    if (step.followUpId && step.followUpId !== prev?.followUpId) {
      const asked = thread.followUps.find((f) => f.segmentId === step.followUpId)
      if (asked) {
        lines.push({ speaker: 'you', type: 'thought', text: asked.question, key: `fu-${step.followUpId}` })
      }
    }
    ;(caseDef.stream[step.kind] ?? []).forEach((line, j) => {
      lines.push({ ...line, key: `${i}:${step.kind}:${j}` })
    })
  })
  return { lines, burstStart }
}

// 终端栏（viewport-fixed 左栏 HUD，决策 1）：1:1 永远可读、自滚动；等宽小字。
// MANIFEST 行 = 可点锚（决策 3）→ onInspect 飞向对应卡（不画跨层连线）。
// 底部「运行中 ▌」光标行仅视觉提示、不可点（决策 8）；Lin Qing 行内联像素头像（决策 9）。
function NexusTerminal({
  caseDef,
  thread,
  onInspect,
}: {
  caseDef: CaseDefinition
  thread: Thread
  onInspect: (step: ThreadStepKind) => void
}) {
  const { lines, burstStart } = useMemo(() => deriveTerminalLines(caseDef, thread), [caseDef, thread])
  const logRef = useRef<HTMLDivElement | null>(null)

  // 新行落地 / 切 thread → 滚到底（终端语义：永远看最新输出）。
  useEffect(() => {
    const log = logRef.current
    if (log) log.scrollTop = log.scrollHeight
  }, [lines.length, caseDef.id])

  return (
    <section className="nexus-terminal" aria-label="How it's thinking it through">
      <header className="nexus-terminal-bar" aria-hidden="true">
        <span className="nexus-terminal-dots">
          <i />
          <i />
          <i />
        </span>
        <span className="nexus-terminal-title">thinking it through</span>
      </header>
      <div className="nexus-terminal-log" ref={logRef}>
        {lines.map((line, index) => {
          const meta = SPEAKER_META[line.speaker]
          const isNew = index >= burstStart
          const style = isNew ? ({ '--line-i': index - burstStart } as CSSProperties) : undefined
          const prefix = line.type === 'manifest' ? 'MANIFEST' : meta.label
          const prefixClass = line.type === 'manifest' ? 'is-manifest' : meta.className
          const body = (
            <>
              <span className={classNames(['terminal-prefix', prefixClass])}>
                {line.speaker === 'bill' && line.type !== 'manifest' && BILL_PERSON ? (
                  <PixelAvatar person={BILL_PERSON} size={14} className="terminal-avatar" />
                ) : null}
                {prefix}
              </span>
              <span className="terminal-text">
                {line.text}
                {line.attachment ? (
                  <span className="terminal-attachment-chip">
                    <img src={line.attachment.src} alt="Attached memo draft photo" draggable={false} />
                    {line.attachment.name}
                  </span>
                ) : null}
              </span>
            </>
          )
          if (line.type === 'manifest' && line.ref) {
            const ref = line.ref
            return (
              <button
                key={line.key}
                type="button"
                className={classNames(['terminal-line', `is-${line.type}`, isNew && 'is-new'])}
                style={style}
                onClick={() => onInspect(ref)}
              >
                {body}
              </button>
            )
          }
          return (
            <p
              key={line.key}
              className={classNames(['terminal-line', `is-${line.type}`, isNew && 'is-new'])}
              style={style}
            >
              {body}
            </p>
          )
        })}
        {thread.status !== 'complete' ? (
          <p className="terminal-line terminal-cursor-line" aria-hidden="true">
            <span className="terminal-prefix is-system">·</span>
            <span className="terminal-text">
              {thread.status === 'running' ? 'running ' : ''}
              <span className="terminal-cursor">▌</span>
            </span>
          </p>
        ) : null}
      </div>
    </section>
  )
}

function TimelineCard() {
  const milestones = [...TIMELINE.milestones].sort(
    (a, b) => TIMELINE_WHEN_ORDER[a.when] - TIMELINE_WHEN_ORDER[b.when],
  )

  // checklist = 本地交互（check/uncheck），不入 store——与 ChatCard 的 draft 同口径。
  const [checked, setChecked] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(LIN_QING_CHECKLIST.map((item) => [item.id, item.done])),
  )
  const toggle = (id: string) => setChecked((prev) => ({ ...prev, [id]: !prev[id] }))
  const linQing = PEOPLE.find((person) => person.id === 'u_bill')

  return (
    <section className="timeline-card" aria-label="Scope frozen — the plan for Friday">
      <div className="timeline-card-header">
        <div>
          <p className="eyebrow">Scope frozen for Friday</p>
          <h2>{TIMELINE.title}</h2>
        </div>
        <span>Friday protected</span>
      </div>

      <div className="timeline-track" aria-label="The plan once scope is frozen">
        {milestones.map((milestone) => {
          const stateCopy = TIMELINE_STATE_COPY[milestone.state]
          return (
            <article
              key={`${milestone.when}-${milestone.label}`}
              className={classNames([
                'timeline-milestone',
                `is-${milestone.state}`,
                milestone.state === 'held' && 'is-focus',
              ])}
            >
              <span className="timeline-when">{milestone.when}</span>
              <div className="timeline-marker" aria-hidden="true" />
              <div className="timeline-body">
                <div className="timeline-title-row">
                  <h3>{milestone.label}</h3>
                  <span>{stateCopy.label}</span>
                </div>
                <p>{stateCopy.detail}</p>
              </div>
            </article>
          )
        })}
      </div>

      {/* 责任拆分：把活儿从 Lin Qing 一个人手里拆给团队 ⚠ 待 Danny 审字 */}
      <div className="scope-split" aria-label="Who owns what once scope is frozen">
        <p className="scope-split-label">Who owns what</p>
        <div className="scope-split-list">
          {SCOPE_SPLIT.map((row) => {
            const person = PEOPLE.find((p) => p.id === row.ownerId)
            return (
              <div key={row.ownerId} className="scope-split-row">
                <span className="scope-split-owner">
                  {person ? (
                    <PixelAvatar person={person} size={20} className="inline-avatar" />
                  ) : null}
                  {nameOf(row.ownerId)}
                </span>
                <span className="scope-split-scope">{row.scope}</span>
              </div>
            )
          })}
        </div>
      </div>

      {/* Lin Qing 的可完成 checklist：清楚的交付边界 + "什么算做完" ⚠ 待 Danny 审字 */}
      <div className="lin-checklist" aria-label="A completable checklist for Lin Qing">
        <p className="lin-checklist-label">
          {linQing ? (
            <PixelAvatar person={linQing} size={20} className="inline-avatar" />
          ) : null}
          A clear, completable checklist for Lin Qing
        </p>
        <ul className="lin-checklist-items">
          {LIN_QING_CHECKLIST.map((item) => {
            const isDone = checked[item.id]
            return (
              <li key={item.id} className={classNames(['lin-checklist-item', isDone && 'is-done'])}>
                <button
                  type="button"
                  className="lin-checklist-toggle"
                  aria-pressed={isDone}
                  onClick={() => toggle(item.id)}
                >
                  <span className="lin-checklist-box" aria-hidden="true">
                    {isDone ? '✓' : ''}
                  </span>
                  <span className="lin-checklist-text">{item.label}</span>
                </button>
              </li>
            )
          })}
        </ul>
      </div>
    </section>
  )
}

function MismatchCard() {
  return (
    <section className="mismatch-card" aria-label="Worth a closer look">
      <div className="mismatch-card-header">
        <p className="eyebrow">Worth a closer look</p>
        <h2>{MISMATCH.gapType}</h2>
      </div>

      <div className="mismatch-collision" aria-label="Reported status compared with work signals">
        <article className="mismatch-side">
          <span className="mismatch-label">Manager sees</span>
          <strong>{MISMATCH.reported}</strong>
          <p>How it reads from the outside.</p>
        </article>

        <div className="mismatch-versus" aria-hidden="true">
          <span />
        </div>

        <article className="mismatch-side is-signal">
          <span className="mismatch-label">What she’s carrying</span>
          <strong>{MISMATCH.signalsSay}</strong>
          <p>Evidence from the design files and feedback rounds.</p>
        </article>
      </div>

      <div className="mismatch-evidence">
        {mismatchEvidence.map((signal) => (
          <div key={signal.id} className="mismatch-evidence-row">
            <span>{signal.id}</span>
            <p>{signal.summary}</p>
          </div>
        ))}
      </div>

      <p className="mismatch-safe-framing">{MISMATCH.safeFraming}</p>
    </section>
  )
}

function StructuredOutputCard({
  dispatchedTaskKeys,
  onDispatchTask,
  onReturnDashboard,
  output = AGENT_OUTPUT,
}: {
  dispatchedTaskKeys: Set<string>
  onDispatchTask: (template: TaskTemplate) => void
  onReturnDashboard: () => void
  output?: AgentOutput // feat-017：story 用 fixture AGENT_OUTPUT；live 传入真 agent 8 字段产出
}) {
  return (
    <section className="structured-output-card" aria-label="What it found — the read">
      <header className="structured-output-header">
        <div>
          <p className="eyebrow">What it found</p>
          <h2>The read</h2>
        </div>
        <span>Yours to sign off</span>
      </header>

      {/* ── ZONE 1 · THE READ（hero）= summary + detected_signals + diagnosis_hypotheses ── */}
      <div className="report-zone report-zone-read" aria-label="The read">
        {/* 1 · summary（原 conclusion）——⚠ Danny 审字 label 用「The read」*/}
        <section className="report-section report-conclusion" aria-label="Summary — the read">
          <p className="report-section-label">The read</p>
          <strong>{output.summary}</strong>
        </section>

        {/* 2 · detected_signals（NEW）——观察到的具体信号，有 evidence 锚 */}
        <section className="report-section" aria-label="Signals it picked up">
          <p className="report-section-label">Signals it picked up {/* ⚠ 待 Danny 审字 */}</p>
          <ul className="report-list">
            {output.detected_signals.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>

        {/* 3 · diagnosis_hypotheses（NEW）——带 alternative 的假设，绝不当事实断言 */}
        <section className="report-section" aria-label="What might be going on">
          <p className="report-section-label">What might be going on — a read, not a verdict {/* ⚠ 待 Danny 审字 */}</p>
          <ul className="report-list report-hypotheses">
            {output.diagnosis_hypotheses.map((h) => (
              <li key={h.label} className={classNames(['hypothesis-item', `is-${h.kind}`])}>
                <span className="hypothesis-kind">{h.kind === 'primary' ? 'Most likely' : 'Also possible'}</span>
                {h.label}
              </li>
            ))}
          </ul>
        </section>
      </div>

      <hr className="report-zone-rule" aria-hidden="true" />

      {/* ── ZONE 2 · THE BACKING（secondary, calmer）= evidence + confidence ── */}
      <div className="report-zone report-zone-backing" aria-label="The backing">
        <p className="report-zone-label">The backing {/* ⚠ 待 Danny 审字 */}</p>
        <div className="report-grid">
        {/* 4 · evidence（保留） */}
        <section className="report-section" aria-label="Why I'm saying this">
          <p className="report-section-label">Why I&rsquo;m saying this</p>
          <ol className="report-list">
            {output.evidence.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ol>
        </section>

        {/* 6 · confidence（NEW）——明确 level + 什么会改变它 */}
          <section className="report-section report-confidence" aria-label="How sure it is">
            <p className="report-section-label">
              How sure it is {/* ⚠ 待 Danny 审字 */}
              <span className={classNames(['confidence-badge', `is-${output.confidence.level}`])}>
                {output.confidence.level}
              </span>
            </p>
            <p className="confidence-rationale">{output.confidence.rationale}</p>
            {/* 渐进披露：wouldChange 折叠成一行 teaser，仍在场（可审计），首屏不占满高 */}
            <details className="report-disclosure">
              <summary>
                <span className="disclosure-caret" aria-hidden="true" />
                What would change it {/* ⚠ 待 Danny 审字 */}
                <span className="disclosure-count">{output.confidence.wouldChange.length}</span>
              </summary>
              <ul className="report-list">
                {output.confidence.wouldChange.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </details>
          </section>
        </div>
      </div>

      <hr className="report-zone-rule" aria-hidden="true" />

      {/* ── ZONE 3 · THE MOVE（actionable tail）= actions + script + metrics + escalation + tasks ── */}
      <div className="report-zone report-zone-move" aria-label="The move">
        <p className="report-zone-label">The move {/* ⚠ 待 Danny 审字 */}</p>

        {/* 5 · recommended_actions（原 recommendedActions） */}
        <section className="report-section" aria-label="Recommended actions">
          <p className="report-section-label">Recommended actions</p>
          <ol className="report-list report-actions">
            {output.recommended_actions.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ol>
        </section>

        {/* + · conversation_script（1:1 开场白，"senior 在耳边"的声音） */}
        <section className="report-section report-script" aria-label="If you open the 1:1">
          <p className="report-section-label">If you open the 1:1 {/* ⚠ 待 Danny 审字 */}</p>
          <p className="report-script-line">{output.conversation_script}</p>
        </section>

        {/* 8 · metrics_to_track（NEW）——看什么才知道奏效。渐进披露：折叠成一行 teaser，仍在场 */}
        <section className="report-section" aria-label="What to watch">
          <details className="report-disclosure">
            <summary>
              <span className="disclosure-caret" aria-hidden="true" />
              What to watch to know it worked {/* ⚠ 待 Danny 审字 */}
              <span className="disclosure-count">{output.metrics_to_track.length}</span>
            </summary>
            <ul className="report-list report-actions">
              {output.metrics_to_track.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </details>
        </section>

        <div className="report-grid report-bottom-grid">
        {/* 7 · escalation（NEW）——何时把 HR 拉进来 + 谁来确认 */}
        <section className="report-section" aria-label="HR / who confirms">
          <p className="report-section-label">
            When to pull in HR {/* ⚠ 待 Danny 审字 */}
            <span className={classNames(['escalation-badge', `is-${output.escalation.level}`])}>
              {output.escalation.level === 'none' ? 'not yet' : output.escalation.level}
            </span>
          </p>
          <p className="escalation-note">{output.escalation.note}</p>
          <p className="report-subtle-label">Who confirms</p>
          <div className="confirmation-list">
            {output.escalation.confirmWith.map((label) => {
              const person = personByName(label)
              return (
                <span key={label} className="confirmation-chip">
                  {person ? <PixelAvatar person={person} size={20} className="inline-avatar" /> : null}
                  {label}
                </span>
              )
            })}
          </div>
        </section>

        {output.nextTasks.length > 0 ? (
        <section className="report-section" aria-label="Next tasks">
          <p className="report-section-label">Next tasks</p>
          <div className="next-task-list">
            {output.nextTasks.map((task) => {
              const dispatched = dispatchedTaskKeys.has(taskTemplateKey(task))
              const assigneePerson = PEOPLE.find((person) => person.id === task.assigneeId)
              return (
                <article key={taskTemplateKey(task)} className="next-task-row">
                  <div>
                    <strong>{task.title}</strong>
                    <span className="next-task-assignee">
                      {assigneePerson ? (
                        <PixelAvatar person={assigneePerson} size={20} className="inline-avatar" />
                      ) : null}
                      {nameOf(task.assigneeId)} · due {task.due}
                    </span>
                  </div>
                  <button
                    type="button"
                    className={classNames(['dispatch-task-button', dispatched && 'is-dispatched'])}
                    disabled={dispatched}
                    onClick={() => onDispatchTask(task)}
                  >
                    {dispatched ? 'Sent' : 'Send to the team'}
                  </button>
                </article>
              )
            })}
          </div>
        </section>
        ) : null}
        </div>
      </div>

      <footer className="report-footer">
        <button type="button" className="return-dashboard-button" onClick={onReturnDashboard}>
          Return to your team {/* ⚠ 待 Danny 审字 — surface label per ADR-0015 (dashboard → Your team) */}
        </button>
      </footer>
    </section>
  )
}

// P6-03 (ADR-0013 决策 5)：bill/acme follow-up 段的 Manifest 卡——谁这周能搭把手。
// 红线修复（ADR-0015）：不给人排替补榜、不打分、不贴 risk 等级。每人一句情境化、
// 同事互助口吻的话——"这周手头怎样 + 能怎么帮"，而非"谁能替掉谁"。
// 名字实时引用 PEOPLE fixture；定性 copy 为 demo fixture 文案。
const ALTERNATIVE_CANDIDATES: Array<{
  personId: string
  note: string
}> = [
  // ⚠ 待 Danny 审字（note 整组 copy）
  {
    personId: 'u_fred',
    note: "Fred knows the guide screens well, and his week looks light enough to pick a bit of this up.",
  },
  {
    personId: 'u_nasim',
    note: "Nasim could step in on the motion and interactions, though she's mid-sprint and hasn't worked on the core flow before.",
  },
  {
    personId: 'u_aidy',
    note: "Aidy knows the review side, but design QA tends to get busy right before a Friday demo.",
  },
]

function AlternativesCard({ question }: { question: string }) {
  return (
    <section className="alternatives-card" aria-label="Follow-up: who could help out this week">
      <header className="alternatives-header">
        <div>
          <p className="eyebrow">Follow-up {/* ⚠ 待 Danny 审字 */}</p>
          <h2>Who might have room to help out? {/* ⚠ 待 Danny 审字 */}</h2>
        </div>
        <span>A second look {/* ⚠ 待 Danny 审字 */}</span>
      </header>

      <p className="alternatives-question">&ldquo;{question}&rdquo;</p>

      <p className="alternatives-intro">
        {/* ⚠ 待 Danny 审字 */}
        A few people on the team might have a little room this week — here's how each is placed,
        so you can decide who to ask.
      </p>

      <div className="alternatives-list">
        {ALTERNATIVE_CANDIDATES.map((candidate) => {
          const person = PEOPLE.find((p) => p.id === candidate.personId)
          if (!person) return null
          return (
            <article key={candidate.personId} className="alternatives-row">
              <div className="alternatives-person">
                <PixelAvatar person={person} size={26} className="inline-avatar" />
                <div>
                  <strong>{person.name}</strong>
                  <span>{person.role}</span>
                </div>
              </div>
              <p className="alternatives-note">{candidate.note}</p>
            </article>
          )
        })}
      </div>

      <p className="alternatives-verdict">
        {/* ⚠ 待 Danny 审字 */}
        Whoever you ask, it's worth keeping the hand-off to a couple of days so it stays a favour,
        not a new burden — and so Friday stays protected.
      </p>
    </section>
  )
}

// ── P6-05 (ADR-0013 决策 3)：web-search errand case 的 Manifest 卡组 ──────────────
// ① 浏览器预览卡：迷你浏览器窗——URL 栏显示真实 developer.apple.com 地址 + padlock，
// 卡内可滚动看 Apple App Review guidelines 页高清长图。fixture 截图（public/ 资产），
// 非 live iframe（Apple 发 X-Frame-Options/CSP 拒绝被框 + 会场断网风险）；零运行时网络依赖。
function WebPreviewCard() {
  return (
    <section className="browser-preview-card" aria-label="Web tool output: page preview">
      <div className="browser-chrome-bar">
        <span className="browser-dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span className="browser-url-bar">
          <svg
            className="browser-padlock"
            viewBox="0 0 10 12"
            aria-hidden="true"
            focusable="false"
          >
            <rect x="1" y="5" width="8" height="6" rx="1.4" fill="currentColor" />
            <path
              d="M3 5V3.6a2 2 0 1 1 4 0V5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
            />
          </svg>
          {APPLE_POLICY_URL_DISPLAY}
        </span>
      </div>
      <div className="browser-viewport" aria-label="App Review Guidelines page (scrollable capture)">
        <img
          className="browser-screenshot"
          src={APPLE_POLICY_SCREENSHOT}
          alt="Apple App Review Guidelines — developer.apple.com page capture"
          loading="lazy"
          draggable={false}
        />
      </div>
    </section>
  )
}

// ② policy gist 卡：agent 的实际回答——guideline 要点引文 + 回链 URL 引用
//（是 agent 不是搜索引擎的证据）。fixture copy 摘自 Apple 官方口径（演示用转述）。
const POLICY_GIST_POINTS: Array<{ point: string; quote: string; ref: string }> = [
  // ⚠ 待 Danny 审字（point / quote 整组 copy）
  {
    point: 'Expedited review exists, but only for extenuating circumstances.',
    quote:
      'You can request an expedited review to fix a critical bug or to release your app ahead of an event you are directly associated with.',
    ref: 'developer.apple.com/contact/app-store/?topic=expedite',
  },
  {
    point: 'The standard queue is already fast — plan for it first.',
    quote: 'On average, 90% of submissions are reviewed in less than 24 hours.',
    ref: 'developer.apple.com/distribute/app-review/',
  },
  {
    point: 'The build must be complete before any review, expedited or not.',
    quote:
      'Submissions should be final versions with all necessary metadata — placeholder content or obvious bugs are rejected under Guideline 2.1.',
    ref: 'developer.apple.com/app-store/review/guidelines/#app-completeness',
  },
]

function PolicyGistCard() {
  return (
    <section className="policy-gist-card" aria-label="The short version of Apple's policy">
      <header className="policy-gist-header">
        <div>
          <p className="eyebrow">The short version</p>
          <h2>Expedited App Review — what it comes down to</h2>
        </div>
        <span>Sources cited</span>
      </header>

      <div className="policy-gist-list">
        {POLICY_GIST_POINTS.map((item) => (
          <article key={item.ref} className="policy-gist-row">
            <strong>{item.point}</strong>
            <p className="policy-gist-quote">&ldquo;{item.quote}&rdquo;</p>
            <span className="policy-gist-ref">{item.ref}</span>
          </article>
        ))}
      </div>

      <p className="policy-gist-verdict">
        {/* ⚠ 待 Danny 审字 */}
        For the Smart Shopping Guide companion launch: submit a final build through the normal
        queue now, and file the expedited request citing the launch date — Apple grants these on a
        limited, case-by-case basis.
      </p>
    </section>
  )
}

// ③ follow-up 合规判定卡：2–3 bullet 结论 + guideline 引用（短 Manifest，决策 3）。
const COMPLIANCE_CHECKS: Array<{
  verdict: string
  guideline: string
  status: 'pass' | 'attention'
}> = [
  // ⚠ 待 Danny 审字（verdict 整组 copy）
  {
    verdict: 'Release candidate is final — no placeholder content, no known crashes.',
    guideline: 'Guideline 2.1 — App Completeness',
    status: 'pass',
  },
  {
    verdict: 'Privacy labels are stale: the new analytics SDK is not declared yet.',
    guideline: 'Guideline 5.1.1 — Data Collection and Storage',
    status: 'attention',
  },
  {
    verdict: 'Expedited request is justifiable — the Smart Shopping Guide launch is a dated event.', // ⚠ 待 Danny 审字
    guideline: 'Expedited review criteria',
    status: 'pass',
  },
]

function ComplianceCard({ question }: { question: string }) {
  return (
    <section className="compliance-card" aria-label="Follow-up output: compliance check">
      <header className="compliance-header">
        <div>
          <p className="eyebrow">Follow-up · Compliance check {/* ⚠ 待 Danny 审字 */}</p>
          <h2>Does the companion-app build comply? {/* ⚠ 待 Danny 审字 */}</h2>
        </div>
        <span>Against cited guidelines {/* ⚠ 待 Danny 审字 */}</span>
      </header>

      {question ? <p className="compliance-question">&ldquo;{question}&rdquo;</p> : null}

      <div className="compliance-list">
        {COMPLIANCE_CHECKS.map((check) => (
          <article key={check.guideline} className={`compliance-row is-${check.status}`}>
            <span className="compliance-status" aria-hidden="true">
              {check.status === 'pass' ? '✓' : '!'}
            </span>
            <div>
              <p>{check.verdict}</p>
              <span className="compliance-guideline">{check.guideline}</span>
            </div>
          </article>
        ))}
      </div>

      <p className="compliance-verdict">
        {/* ⚠ 待 Danny 审字 */}
        Fix the privacy labels, then submit — everything else is ready for an expedited request.
      </p>
    </section>
  )
}

// ── P6-06 (ADR-0013 决策 4)：email errand case 的 Manifest 卡组 ──────────────────
// 收件人实时派生自 PEOPLE fixture——不复制名单。设计团队 re-flavor 后大部分人在 Design 队，
// 故取 Design + Eng 两队（= 工作团队），稳定取前 6 人保持 errand 的"6 recipients"口径。
const ENG_RECIPIENTS = PEOPLE.filter(
  (person) => person.team === 'Design' || person.team === 'Eng',
).slice(0, 6)
const EMAIL_DOMAIN = 'avery.io' // ⚠ 待 Danny 审字（演示用公司域名）

function emailAddressOf(person: Person) {
  // handle = 名字各词用 '.' 连接、去空格小写（"Lin Qing" → lin.qing）；
  // 单词名才附 lastInitial（"Jason" → jason.s），避免渲染出带空格的 handle。
  const parts = person.name.trim().toLowerCase().split(/\s+/)
  const handle =
    parts.length > 1
      ? parts.join('.')
      : `${parts[0]}${person.lastInitial ? `.${person.lastInitial.toLowerCase()}` : ''}`
  return `${handle}@${EMAIL_DOMAIN}`
}

// agent 预填的邮件草稿（fixture copy，呼应 memo 占位照片上的要点）。
const EMAIL_SUBJECT = 'Friday demo: design freeze + client-support rotation' // ⚠ 待 Danny 审字
// ⚠ 待 Danny 审字（草稿 body 整段 copy）
const EMAIL_DRAFT_BODY = `Team,

Two changes for the Smart Shopping Guide demo this Friday:

1. Design freeze starts Thursday 6pm — only Friday-path fixes go in after that.
2. Client-support pings now route to the on-call rotation, not directly to Lin Qing.

If either of these blocks you, raise it in #team before Thursday standup.

Thanks,
Danny`

// Manifest ①：可编辑草稿卡。编辑是**组件本地态**（NexusScene 持有，store 零额外字段）——
// 不入 rail replay（ADR-0006 决策 5 口径）；编辑实时流入 ② email-tool 卡的 body。
function MemoDraftCard({ body, onChange }: { body: string; onChange: (text: string) => void }) {
  return (
    <section className="memo-draft-card" aria-label="A draft you can edit">
      <header className="memo-draft-header">
        <div>
          <p className="eyebrow">Draft · yours to edit</p>
          <h2>Memo, turned into an email</h2>
        </div>
        <span>From the memo photo</span>
      </header>
      <textarea
        className="memo-draft-textarea"
        value={body}
        onChange={(event) => onChange(event.target.value)}
        aria-label="Editable email draft"
        spellCheck={false}
      />
      <p className="memo-draft-hint">
        Edit anything — changes flow straight into the email below. {/* ⚠ 待 Danny 审字 */}
      </p>
    </section>
  )
}

// Manifest ②：email-tool 卡。To: 全部 Eng 6 人（PEOPLE 派生）、subject/body 已填、
// Send 待命。点 Send → sendEmail()（store action，dedupe-guarded）→ 卡翻 "Sent ✓"。
// ★ Send 不进 rail SCRIPT（同 dispatchTask 先例，ADR-0006 决策 5）：现场 Danny 亲手点，
// "人扣扳机"必须可见是人的手；rail seek 重置已点状态（replay 不含 sendEmail），接受。
function EmailToolCard({ body, sent, onSend }: { body: string; sent: boolean; onSend: () => void }) {
  return (
    <section className="email-tool-card" aria-label="The email, ready for you to send">
      <header className="email-tool-header">
        <div>
          <p className="eyebrow">Drafted by Avery · you send it {/* ⚠ 待 Danny 审字 */}</p>
          <h2>Ready for you to send</h2>
        </div>
        <span className={classNames(['email-tool-status', sent && 'is-sent'])}>
          {sent ? 'You sent this' : 'Waiting on you'}
        </span>
      </header>

      <div className="email-field">
        <span className="email-field-label">From</span>
        <p className="email-from">You {/* ⚠ 待 Danny 审字 */}</p>
      </div>

      <div className="email-field">
        <span className="email-field-label">To</span>
        <div className="email-recipient-list">
          {ENG_RECIPIENTS.map((person) => (
            <span key={person.id} className="email-recipient-chip">
              <PixelAvatar person={person} size={20} className="inline-avatar" />
              {person.name}
              <i className="email-recipient-address">{emailAddressOf(person)}</i>
            </span>
          ))}
        </div>
      </div>

      <div className="email-field">
        <span className="email-field-label">Subject</span>
        <p className="email-subject">{EMAIL_SUBJECT}</p>
      </div>

      <div className="email-field is-body">
        <span className="email-field-label">Body</span>
        <p className="email-body">{body}</p>
      </div>

      <footer className="email-tool-footer">
        <button
          type="button"
          className={classNames(['email-send-button', sent && 'is-sent'])}
          disabled={sent}
          onClick={onSend}
        >
          {/* ⚠ 待 Danny 审字（Send / Sent ✓ 按钮文案） */}
          {sent ? `Sent ✓ — from you, to ${ENG_RECIPIENTS.length} people` : 'Send it yourself'}
        </button>
      </footer>
    </section>
  )
}

// follow-up：Slack-message 小 Manifest——短版发 #team（决策 4；chip 锚在 email-tool 卡）。
const SLACK_SHORT_VERSION = // ⚠ 待 Danny 审字（Slack 短版整段 copy）
  "Heads-up for Friday's Smart Shopping Guide demo — design freeze Thursday 6pm, and client support now goes to the on-call rotation (not straight to Lin Qing). I've just emailed the team the full details."

function SlackMessageCard({ question }: { question: string }) {
  return (
    <section className="slack-message-card" aria-label="Follow-up: a short version for you to post to #team">
      <header className="slack-message-header">
        <div>
          <p className="eyebrow">Drafted by Avery · you post it {/* ⚠ 待 Danny 审字 */}</p>
          <h2>A short version for #team {/* ⚠ 待 Danny 审字 */}</h2>
        </div>
        <span>#team {/* ⚠ 待 Danny 审字 */}</span>
      </header>

      {question ? <p className="slack-message-question">&ldquo;{question}&rdquo;</p> : null}

      <div className="slack-message-bubble">
        <span className="slack-message-author">You {/* ⚠ 待 Danny 审字 */}</span>
        <p>{SLACK_SHORT_VERSION}</p>
        <span className="slack-message-byline">Drafted by Avery {/* ⚠ 待 Danny 审字 */}</span>
      </div>
    </section>
  )
}

// P6-03：常驻自由文本 follow-up composer（HUD，bottom-left）。任意文本被接受、作为显示的
// follow-up 问题、走 active case 的脚本段——与 B3 askQuestion 同构（ADR-0001 demo-only 诚实）。
// 注意：不复用 .nexus-empty-composer（那是空态专用、走 askQuestion 会重置 thread）。
function FollowUpComposer({ onAsk }: { onAsk: (text: string) => void }) {
  const [draft, setDraft] = useState('')

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const text = draft.trim()
    if (!text) return
    onAsk(text)
    setDraft('')
  }

  return (
    <form className="nexus-followup-composer" aria-label="Ask a follow-up" onSubmit={handleSubmit}>
      <input
        type="text"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        placeholder="Ask a follow-up on this thread..." /* ⚠ 待 Danny 审字 */
        aria-label="Follow-up question"
      />
      <button type="submit">Ask {/* ⚠ 待 Danny 审字 */}</button>
    </form>
  )
}

// 第二轮（Danny）：原 .nexus-brief 大居中横幅（问题 + step 进度 + Context%）压住 Manifest
// 卡。改成顶部一条紧凑 bar——eyebrow「Working it through」+ 问题截断 + 步骤进度；
// hover / click 掉落一张浮层卡（drop-down），露出完整问题 + follow-up + step 进度。
// 掉落卡 absolute 挂 bar 下缘，不占文档流 → 不再遮挡画布上的 Manifest 卡。
// 红线修复（ADR-0015）：去掉「Context X%」——那是 AI 在谈自己的内存，用户不关心；
// 只留人话的步骤进度（Step n of m）。
function NexusBriefHud({
  question,
  latestFollowUpQuestion,
  stepLabel,
  stepCount,
  planLength,
}: {
  question: string
  latestFollowUpQuestion: string | null
  stepLabel: string
  stepCount: number
  planLength: number
}) {
  // 决定 2（Danny）：摘要行常驻，详情卡只靠点击展开/收起——去掉 hover 触发（与 Dashboard 同口径）。
  const [open, setOpen] = useState(false)
  const showCard = open
  const stepRead = stepCount === 0 ? 'Just getting started' : `Step ${stepCount} of ${planLength}`

  return (
    <div className={classNames(['nexus-brief-hud', open && 'is-open'])}>
      <button
        type="button"
        className="nexus-brief-bar"
        aria-expanded={showCard}
        aria-label="Working it through — open the full thread read"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="nexus-brief-bar-eyebrow">Working it through</span>
        <span className="nexus-brief-bar-question">&ldquo;{question}&rdquo;</span>
        <span className="nexus-brief-step">{stepRead}</span>
        <span className="nexus-brief-bar-caret" aria-hidden="true">
          {showCard ? '▴' : '▾'}
        </span>
      </button>

      {showCard ? (
        <section className="nexus-brief-card" aria-label="The full thread read">
          <p className="eyebrow">Working it through</p>
          <p className="nexus-brief-card-question">&ldquo;{question}&rdquo;</p>
          {latestFollowUpQuestion ? (
            <p className="nexus-brief-followup">
              Follow-up: &ldquo;{latestFollowUpQuestion}&rdquo;
            </p>
          ) : null}
          <p
            className="nexus-context-line"
            aria-label={`${stepLabel} · ${stepRead.toLowerCase()}`}
          >
            <span className="nexus-context-step-label">{stepLabel}</span>
            <span className="nexus-brief-step">{stepRead}</span>
          </p>
        </section>
      ) : null}
    </div>
  )
}

// 人类发言者的像素头像（agent 发言无 person sprite，返回 null 保持文字 badge）。
function ChatAvatar({ role, speaker }: { role: string; speaker: string }) {
  if (role !== 'human') return null
  const person = personByName(speaker)
  return person ? <PixelAvatar person={person} size={24} className="chat-avatar" /> : null
}

// P5-02 (ADR-0008)：B7 human-loop 的中央 Chat 卡。与 mismatch/timeline/output 同级，
// 读扩写后的 HUMAN_LOOP fixture，消息逐条渐显（CSS stagger）。不扩 store。
function ChatCard() {
  const [draft, setDraft] = useState('')

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setDraft('')
  }

  return (
    <section className="nexus-chat-card" aria-label="Human loop — chat">
      <header className="nexus-chat-header">
        <div>
          <p className="eyebrow">Human loop · Chat</p>
          <h2>{HUMAN_LOOP.title}</h2>
        </div>
        <span>Lin Qing · PM · People</span>
      </header>
      <div className="nexus-chat-log">
        {HUMAN_LOOP.messages.map((message, index) => (
          <article
            key={message.id}
            className={classNames([
              'chat-msg',
              message.speaker === 'You' ? 'is-you' : 'is-room',
              `is-${message.role}`,
              message.agentKind && `is-${message.agentKind}`,
            ])}
            style={{ '--chat-i': index } as CSSProperties}
          >
            <div className="chat-speaker-row">
              <ChatAvatar role={message.role} speaker={message.speaker} />
              <span className="chat-speaker">{message.speaker}</span>
              {message.agentKind ? (
                <span className="chat-agent-badge">{SPECIALIST_BADGE[message.agentKind]}</span>
              ) : null}
            </div>
            <p className="chat-text">{message.text}</p>
            {message.reference ? <span className="chat-ref">{message.reference}</span> : null}
          </article>
        ))}
      </div>
      <form className="nexus-chat-composer" aria-label="Reply in human-loop chat" onSubmit={handleSubmit}>
        <input
          type="text"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Reply, or ask for more…"
          aria-label="Chat reply draft"
        />
        <button type="submit" aria-label="Send chat reply">
          Send
        </button>
      </form>
    </section>
  )
}

// 无 thread 时的 Nexus 静息态：hero case 的空 thread（question staged）——与冻结前
// 「初始单 thread 槽位」行为同构；模块级常量保住 zustand selector 的引用稳定。
const FALLBACK_THREAD = pristineThread(DEFAULT_CASE_ID)

// P6-02 (ADR-0013 决策 6)：thread chrome——Nexus HUD 的 tab strip + history popover。
// 只在 Nexus（Dashboard 是平静观察面，thread 管理是行动面家具）；viewport-fixed HUD，
// 不进画板（ADR-0012 world/HUD 分层）。全部经核心 action（openThread / closeThread）——
// free-click 可达、rail 可脚本（P6-07）。popover 开合 = 组件本地态，不进 store。
// 不预置装饰性假历史：tab/列表只显示真实存在的 thread（Record 插入序 = 创建时序）。
function ThreadChrome() {
  const threads = useCanvas((s) => s.threads)
  const activeCaseId = useCanvas((s) => s.activeCaseId)
  const openThread = useCanvas((s) => s.openThread)
  const closeThread = useCanvas((s) => s.closeThread)
  const [historyOpen, setHistoryOpen] = useState(false)

  const threadList = Object.values(threads)
  if (threadList.length === 0) return null
  const openThreads = threadList.filter((t) => t.isOpen)

  return (
    <div className="nexus-thread-chrome" aria-label="Threads">
      <div className="nexus-tab-strip" role="tablist" aria-label="Open threads">
        {openThreads.map((t) => {
          const def = CASES[t.caseId]
          const isActiveTab = t.caseId === activeCaseId
          const title = def?.title ?? t.caseId
          return (
            <div
              key={t.caseId}
              className={classNames(['nexus-thread-tab', isActiveTab && 'is-active'])}
            >
              <button
                type="button"
                role="tab"
                aria-selected={isActiveTab}
                className="nexus-thread-tab-label"
                onClick={() => openThread(t.caseId)}
              >
                {title}
              </button>
              <button
                type="button"
                className="nexus-thread-tab-close"
                aria-label={`Close thread: ${title}`}
                onClick={() => closeThread(t.caseId)}
              >
                ×
              </button>
            </div>
          )
        })}
      </div>

      <div className="nexus-history">
        <button
          type="button"
          className={classNames(['nexus-history-toggle', historyOpen && 'is-open'])}
          aria-expanded={historyOpen}
          aria-haspopup="menu"
          onClick={() => setHistoryOpen((open) => !open)}
        >
          History {/* ⚠ 待 Danny 审字 */}
        </button>
        {historyOpen ? (
          <div className="nexus-history-popover" role="menu" aria-label="Thread history">
            <p className="eyebrow">Threads {/* ⚠ 待 Danny 审字 */}</p>
            {threadList.map((t) => {
              const def = CASES[t.caseId]
              return (
                <button
                  key={t.caseId}
                  type="button"
                  role="menuitem"
                  className={classNames(['nexus-history-item', !t.isOpen && 'is-closed'])}
                  onClick={() => {
                    openThread(t.caseId)
                    setHistoryOpen(false)
                  }}
                >
                  <span className="nexus-history-item-title">{def?.title ?? t.caseId}</span>
                  {t.question ? (
                    <span className="nexus-history-item-question">{t.question}</span>
                  ) : null}
                  <span className="nexus-history-item-meta">
                    {/* ⚠ 待 Danny 审字（Open/Closed badge 文案） */}
                    {t.steps.length}/{threadPlan(t).length} steps · {t.isOpen ? 'Open' : 'Closed'}
                  </span>
                </button>
              )
            })}
          </div>
        ) : null}
      </div>
    </div>
  )
}

// P6-02：Nexus 空态（activeCaseId === null——尚无 thread 或全部关闭）。composer 待命：
// 自由文本走 askQuestion（case-aware，与 B3 同构）；case 建议 chip 走 openThread（已存在
// 的关闭 thread 经此重开、状态完整恢复——保住「直接进 Nexus 起 hero case」的 free-click 路径）。
function NexusEmptyState() {
  const askQuestion = useCanvas((s) => s.askQuestion)
  const openThread = useCanvas((s) => s.openThread)
  const [draft, setDraft] = useState('')

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const text = draft.trim()
    if (!text) return
    askQuestion(text)
    setDraft('')
  }

  return (
    <section className="nexus-empty" aria-label="Working it through — nothing open right now">
      <p className="eyebrow">Working it through</p>
      <h2>Nothing in the room right now</h2>
      <p>Ask anything to start working something through, or pick one back up from History.</p>
      <form className="nexus-empty-composer" aria-label="Start a new thread" onSubmit={handleSubmit}>
        <input
          type="text"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Ask your team anything..." /* ⚠ 待 Danny 审字 */
          aria-label="New thread question"
        />
        <button type="submit">Ask {/* ⚠ 待 Danny 审字 */}</button>
      </form>
      <div className="nexus-empty-suggestions" aria-label="Suggested threads">
        {Object.values(CASES).map((caseDef) => (
          <button
            key={caseDef.id}
            type="button"
            className="nexus-empty-suggestion"
            onClick={() => openThread(caseDef.id)}
          >
            {caseDef.title}
          </button>
        ))}
      </div>
    </section>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// feat-017 · LIVE mode Nexus（ADR-0020 决策 2/3）。
// 完全独立于 scripted 路径（rail 回放机器一行不碰）：终端从 liveStore.run.lines 逐帧渲染，
// 结构化卡从 run.advice（真 agent 8 字段产出）渲染。红线扫描扩到 live 产出（contract.py 已在
// 服务端校验；前端 coerceAgentOutput 不引入任何人评分/%）。
// ════════════════════════════════════════════════════════════════════════════

// live 终端：直接吃 StreamLine[]（与 story 同 chrome/CSS），不经 caseDef/thread 派生。
function LiveTerminal({ lines, running }: { lines: StreamLine[]; running: boolean }) {
  const logRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const log = logRef.current
    if (log) log.scrollTop = log.scrollHeight
  }, [lines.length])

  return (
    <section className="nexus-terminal" aria-label="How it's thinking it through">
      <header className="nexus-terminal-bar" aria-hidden="true">
        <span className="nexus-terminal-dots">
          <i />
          <i />
          <i />
        </span>
        <span className="nexus-terminal-title">thinking it through</span>
      </header>
      <div className="nexus-terminal-log" ref={logRef}>
        {lines.map((line, index) => {
          const meta = SPEAKER_META[line.speaker]
          const prefix = line.type === 'manifest' ? 'MANIFEST' : meta.label
          const prefixClass = line.type === 'manifest' ? 'is-manifest' : meta.className
          return (
            <p
              key={(line as StreamLine & { key?: string }).key ?? `live:${index}`}
              className={classNames(['terminal-line', `is-${line.type}`, 'is-new'])}
              style={{ '--line-i': 0 } as CSSProperties}
            >
              <span className={classNames(['terminal-prefix', prefixClass])}>{prefix}</span>
              <span className="terminal-text">{line.text}</span>
            </p>
          )
        })}
        {running ? (
          <p className="terminal-line terminal-cursor-line" aria-hidden="true">
            <span className="terminal-prefix is-system">·</span>
            <span className="terminal-text">
              running <span className="terminal-cursor">▌</span>
            </span>
          </p>
        ) : null}
      </div>
    </section>
  )
}

// live 提问 composer（空态 + 运行后追问共用）。走 liveStore.askLive → feat-015 /advise SSE。
function LiveAskComposer({
  placeholder,
  submitLabel,
  onAsk,
}: {
  placeholder: string
  submitLabel: string
  onAsk: (text: string) => void
}) {
  const [draft, setDraft] = useState('')
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const text = draft.trim()
    if (!text) return
    onAsk(text)
    setDraft('')
  }
  return (
    <form className="nexus-followup-composer" aria-label="Ask your team" onSubmit={handleSubmit}>
      <input
        type="text"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        placeholder={placeholder}
        aria-label="Live question"
      />
      <button type="submit">{submitLabel}</button>
    </form>
  )
}

function LiveNexusScene() {
  const run = useLive((s) => s.run)
  const askLive = useLive((s) => s.askLive)
  const goScene = useCanvas((s) => s.goScene)
  const { t } = useDict()

  const running = run.status === 'running'
  const hasStarted = run.status !== 'idle'
  const advice = run.advice
  const noop = useMemo(() => new Set<string>(), [])

  return (
    <section className="scene scene-nexus is-active" aria-label="The room">
      <PanZoomCanvas board={NEXUS_BOARD}>
        <div className="canvas-grid board-surface" aria-hidden="true" />
        {advice ? (
          <div
            className="nexus-card-slot is-active"
            style={{ left: '760px', top: '520px' }}
          >
            <StructuredOutputCard
              output={advice}
              dispatchedTaskKeys={noop}
              onDispatchTask={() => {}}
              onReturnDashboard={() => goScene('home')}
            />
          </div>
        ) : null}
      </PanZoomCanvas>

      {hasStarted ? (
        <>
          <LiveTerminal lines={run.lines} running={running} />
          <div className="nexus-brief-hud">
            <div className="nexus-brief-bar" aria-label={t.nexus.liveThinking}>
              <span className="nexus-brief-bar-eyebrow">{t.nexus.liveThinking}</span>
              <span className="nexus-brief-step">
                {run.status === 'error'
                  ? t.nexus.liveError
                  : running
                    ? t.nexus.liveRunning
                    : t.nexus.liveReady}
              </span>
            </div>
          </div>
          <LiveAskComposer
            placeholder={t.nexus.askPlaceholder}
            submitLabel={t.nexus.ask}
            onAsk={(text) => askLive({ situation: text })}
          />
        </>
      ) : (
        <section className="nexus-empty" aria-label="Working it through — ask your team">
          <p className="eyebrow">{t.nexus.liveThinking}</p>
          <h2>{t.team.emptyTitle}</h2>
          <p>{t.nexus.askPlaceholder}</p>
          <div className="nexus-empty-composer-wrap">
            <LiveAskComposer
              placeholder={t.nexus.askPlaceholder}
              submitLabel={t.nexus.ask}
              onAsk={(text) => askLive({ situation: text })}
            />
          </div>
        </section>
      )}
    </section>
  )
}

export function NexusScene() {
  const mode = useLive((s) => s.mode)
  // feat-017：live mode 走独立 LiveNexusScene（rail 回放机器不碰）；story mode 原样。
  if (mode === 'live') return <LiveNexusScene />
  return <ScriptedNexusScene />
}

function ScriptedNexusScene() {
  // null = 尚无 thread 或全部关闭 → 空态（composer 待命）；非空走 active case 渲染。
  // caseDef 仍 fallback 到 hero case——保持 hooks 无条件调用，空态下只是不渲染 world 内容。
  const rawActiveCaseId = useCanvas((s) => s.activeCaseId)
  const isEmpty = rawActiveCaseId === null
  const activeCaseId = rawActiveCaseId ?? DEFAULT_CASE_ID
  const caseDef = CASES[activeCaseId]
  const thread = useCanvas((s) => s.threads[activeCaseId]) ?? FALLBACK_THREAD
  const tasks = useCanvas((s) => s.tasks)
  const runAgent = useCanvas((s) => s.runAgent)
  const askFollowUp = useCanvas((s) => s.askFollowUp)
  const dispatchTask = useCanvas((s) => s.dispatchTask)
  const sendEmail = useCanvas((s) => s.sendEmail)
  const regenBriefing = useCanvas((s) => s.regenBriefing)
  const goScene = useCanvas((s) => s.goScene)
  const question = thread.question ?? caseDef.question ?? HERO_QUESTION
  const activeStep = thread.steps[thread.steps.length - 1]?.kind
  // 修订 5：结果卡在 Manifest 列累积——到过的拍永久留存，活跃拍高亮。
  const reached = (kind: ThreadStepKind) => thread.steps.some((s) => s.kind === kind)
  const showMismatch = reached('cross-check')
  const showTimeline = reached('timeline')
  const showStructuredOutput = reached('structured-output')
  const showChat = reached('human-loop')
  const showAlternatives = reached('follow-up-alternatives')
  // P6-05：web-search errand case 的卡显形条件（步骤 kind 只存在于该 case 的 thread——
  // bill/acme thread 永远 reached() === false，零串扰）。
  const showWebPreview = reached('web-search')
  const showPolicyGist = reached('policy-gist')
  const showCompliance = reached('follow-up-compliance')
  // P6-06：email errand case 的卡显形条件（kind 只存在于该 case 的 thread，零串扰）。
  const showMemoDraft = reached('memo-draft')
  const showEmailTool = reached('email-ready')
  const showSlackMessage = reached('follow-up-slack')
  // P6-06：草稿编辑 = 组件本地态（store 零额外字段，ADR-0006 决策 5）。null = 未编辑
  //（用 agent 预填 fixture）。不入 replay；切 thread / 重挂载丢编辑——issue 接受口径。
  const [memoDraftEdit, setMemoDraftEdit] = useState<string | null>(null)
  const emailBody = memoDraftEdit ?? EMAIL_DRAFT_BODY
  const dispatchedTaskKeys = useMemo(() => new Set(tasks.map(taskTemplateKey)), [tasks])
  // P6-04（修订 · 红线 ADR-0015）：原 context-window HUD 显示「Context X%」（AI 谈自己内存）
  // 已移除——brief 只留人话的步骤进度（Step n of m，派生自 steps.length / threadPlan）。
  // Step 分母 = 主段 + 已追加 follow-up 段总步数（threadPlan 确定性派生）。
  const planLength = threadPlan(thread).length
  // P6-05：末态判定泛化为「编排表走完」（原 hard-code structured-output 只对 hero 成立；
  // errand case 末步不同。askFollowUp 延长 planLength → 标签自动回到 Advance）。
  const advanceLabel =
    thread.steps.length === 0 ? 'Start' : thread.steps.length >= planLength ? 'Hold' : 'Advance'
  const returnToDashboard = () => {
    regenBriefing()
    goScene('home') // feat-014（ADR-0017）：回到卡片式今日主页（B10 同款落点）
  }

  // ── feat-004 (ADR-0014 决策 6)：镜头收敛——方程不再含节点簇。
  // calm = fit Manifest 区宽度顶锚（width-top）；有新卡的拍温和飞向该卡（maxFitScale
  // 收紧，scale 基本恒定）；纯思考拍镜头不动（depKey 只随「最近显形卡」变化）。──
  const camRef = useRef<ReactZoomPanPinchRef | null>(null)
  const lastCardStep = useMemo<ThreadStepKind | null>(() => {
    for (let i = thread.steps.length - 1; i >= 0; i -= 1) {
      const kind = thread.steps[i].kind
      if (caseDef.cardAnchors[kind]) return kind
    }
    return null
  }, [caseDef, thread.steps])

  const cameraTarget = useMemo<CameraTarget | null>(() => {
    if (isEmpty) return null // 空态不取景；重开 thread 时 depKey 变化触发重取景
    if (lastCardStep) {
      const anchor = caseDef.cardAnchors[lastCardStep]
      if (anchor) {
        const bbox = bboxOf([{ pos: anchor.pos, halfW: anchor.half.w, halfH: anchor.half.h }])
        if (bbox) return { bbox }
      }
    }
    // 尚无卡显形：Manifest 双列瀑布全宽 + 列标题的可读帧。
    const items: Array<{ pos: Pos; halfW: number; halfH: number }> = [
      { pos: caseDef.manifestLabelPos, halfW: 0, halfH: 60 },
    ]
    for (const anchor of Object.values(caseDef.cardAnchors)) {
      if (!anchor) continue
      items.push({ pos: anchor.pos, halfW: anchor.half.w, halfH: anchor.half.h })
    }
    const bbox = bboxOf(items)
    return bbox ? { bbox, mode: 'width-top' } : null
  }, [caseDef, lastCardStep, isEmpty])

  // depKey 带 caseId：切 thread 即重取景；纯思考拍 lastCardStep 不变 → 镜头不动。
  useRailCamera(
    camRef,
    cameraTarget,
    NEXUS_INSETS,
    isEmpty ? 'empty' : `${caseDef.id}:${lastCardStep ?? 'calm'}`,
    { maxFitScale: 0.8 },
  )

  // ── P6-03 (ADR-0013 决策 5)：Manifest 点击 → 镜头飞向该卡 + follow-up chip 显出。──
  // 镜头/chip 可见性均为组件本地态（store 零额外字段）。inspected 集合按 `${caseId}:${step}`
  // 键——切 thread 不串台；rail seek 不重置它也无妨（chip 只是建议入口，action 才是事实）。
  const [inspectedKeys, setInspectedKeys] = useState<ReadonlySet<string>>(() => new Set())
  const inspectCard = (step: ThreadStepKind) => {
    const anchor = caseDef.cardAnchors[step]
    if (!anchor) return
    const bbox = bboxOf([{ pos: anchor.pos, halfW: anchor.half.w, halfH: anchor.half.h }])
    if (bbox) flyToTarget(camRef.current, { bbox }, NEXUS_INSETS)
    const key = `${caseDef.id}:${step}`
    setInspectedKeys((keys) => {
      if (keys.has(key)) return keys
      const next = new Set(keys)
      next.add(key)
      return next
    })
  }

  // 下一个未消费的 follow-up 段（askFollowUp 第 n 次永远消费第 n 段——确定性）。
  // chip 只出现在该段锚定的卡上，且该卡被点过（镜头飞向过）后才显出。
  const nextFollowUp = caseDef.followUps[thread.followUps.length]
  const chipStep =
    nextFollowUp &&
    reached(nextFollowUp.anchorStep) &&
    inspectedKeys.has(`${caseDef.id}:${nextFollowUp.anchorStep}`)
      ? nextFollowUp.anchorStep
      : null

  // chip / composer 共用出口：追加 follow-up 段（确定性 append）后立即推进一步——
  // 两个都是核心 action，free-click 与 rail 同构（rail P6-07 同序脚本化即可）。
  const handleFollowUp = (text: string) => {
    askFollowUp(text)
    runAgent()
  }

  const followUpChip =
    chipStep && nextFollowUp ? (
      <button
        type="button"
        className="nexus-followup-chip"
        onClick={() => handleFollowUp(nextFollowUp.suggestedQuestion)}
      >
        <span className="nexus-followup-chip-eyebrow">You might also ask</span>
        {nextFollowUp.suggestedQuestion}
      </button>
    ) : null

  const latestFollowUp = thread.followUps[thread.followUps.length - 1]
  // follow-up 卡显示「启动它的那次提问」（chip 文本或 composer 自由文本，按 segmentId 回查）。
  const followUpQuestionFor = (step: ThreadStepKind) =>
    thread.followUps.find((f) =>
      caseDef.followUps.find((segment) => segment.id === f.segmentId)?.steps.includes(step),
    )?.question ?? ''
  const alternativesQuestion = followUpQuestionFor('follow-up-alternatives')
  const complianceQuestion = followUpQuestionFor('follow-up-compliance')
  const slackQuestion = followUpQuestionFor('follow-up-slack')

  return (
    <section className="scene scene-nexus is-active" aria-label="The room">
      <PanZoomCanvas ref={camRef} board={NEXUS_BOARD}>
        <div className="canvas-grid board-surface" aria-hidden="true" />
        {/* P6-02：空态（无 active thread）不渲染 world 内容——只留画板格栅 + HUD 空态面板。
            feat-004 (ADR-0014)：节点链层退役——world 上只剩 Manifest 列；思考过程在左栏终端。 */}
        {!isEmpty ? (
          <>
        {/* Manifest 列标题（world 对象，修订 5）。 */}
        <span
          className="manifest-label"
          aria-hidden="true"
          style={{
            left: `${caseDef.manifestLabelPos.x}px`,
            top: `${caseDef.manifestLabelPos.y}px`,
          }}
        >
          What Avery put together
        </span>

        {showMismatch ? (
          <CardSlot
            anchor={caseDef.cardAnchors['cross-check']}
            isActive={activeStep === 'cross-check'}
            onInspect={() => inspectCard('cross-check')}
            chip={chipStep === 'cross-check' ? followUpChip : undefined}
          >
            <MismatchCard />
          </CardSlot>
        ) : null}
        {showChat ? (
          <CardSlot
            anchor={caseDef.cardAnchors['human-loop']}
            isActive={activeStep === 'human-loop'}
            onInspect={() => inspectCard('human-loop')}
            chip={chipStep === 'human-loop' ? followUpChip : undefined}
          >
            <ChatCard />
          </CardSlot>
        ) : null}
        {showTimeline ? (
          <CardSlot
            anchor={caseDef.cardAnchors['timeline']}
            isActive={activeStep === 'timeline'}
            onInspect={() => inspectCard('timeline')}
            chip={chipStep === 'timeline' ? followUpChip : undefined}
          >
            <TimelineCard />
          </CardSlot>
        ) : null}
        {showStructuredOutput ? (
          <CardSlot
            anchor={caseDef.cardAnchors['structured-output']}
            isActive={activeStep === 'structured-output'}
            onInspect={() => inspectCard('structured-output')}
            chip={chipStep === 'structured-output' ? followUpChip : undefined}
          >
            <StructuredOutputCard
              dispatchedTaskKeys={dispatchedTaskKeys}
              onDispatchTask={dispatchTask}
              onReturnDashboard={returnToDashboard}
            />
          </CardSlot>
        ) : null}
        {/* P6-03：follow-up 段的新 Manifest 卡——落进 Manifest 列底部（cases.ts 堆叠锚点）。 */}
        {showAlternatives ? (
          <CardSlot
            anchor={caseDef.cardAnchors['follow-up-alternatives']}
            isActive={activeStep === 'follow-up-alternatives'}
            onInspect={() => inspectCard('follow-up-alternatives')}
            chip={chipStep === 'follow-up-alternatives' ? followUpChip : undefined}
          >
            <AlternativesCard question={alternativesQuestion} />
          </CardSlot>
        ) : null}
        {/* P6-05：web-search errand case 的 Manifest 卡组（CardSlot 接法同上）。 */}
        {showWebPreview ? (
          <CardSlot
            anchor={caseDef.cardAnchors['web-search']}
            isActive={activeStep === 'web-search'}
            onInspect={() => inspectCard('web-search')}
            chip={chipStep === 'web-search' ? followUpChip : undefined}
          >
            <WebPreviewCard />
          </CardSlot>
        ) : null}
        {showPolicyGist ? (
          <CardSlot
            anchor={caseDef.cardAnchors['policy-gist']}
            isActive={activeStep === 'policy-gist'}
            onInspect={() => inspectCard('policy-gist')}
            chip={chipStep === 'policy-gist' ? followUpChip : undefined}
          >
            <PolicyGistCard />
          </CardSlot>
        ) : null}
        {showCompliance ? (
          <CardSlot
            anchor={caseDef.cardAnchors['follow-up-compliance']}
            isActive={activeStep === 'follow-up-compliance'}
            onInspect={() => inspectCard('follow-up-compliance')}
            chip={chipStep === 'follow-up-compliance' ? followUpChip : undefined}
          >
            <ComplianceCard question={complianceQuestion} />
          </CardSlot>
        ) : null}
        {/* P6-06：email errand case 的 Manifest 卡组（CardSlot 接法同上）。CardSlot 已
            排除 textarea/button 的点击触发飞行——草稿编辑与 Send 都不会误触镜头。 */}
        {showMemoDraft ? (
          <CardSlot
            anchor={caseDef.cardAnchors['memo-draft']}
            isActive={activeStep === 'memo-draft'}
            onInspect={() => inspectCard('memo-draft')}
            chip={chipStep === 'memo-draft' ? followUpChip : undefined}
          >
            <MemoDraftCard body={emailBody} onChange={setMemoDraftEdit} />
          </CardSlot>
        ) : null}
        {showEmailTool ? (
          <CardSlot
            anchor={caseDef.cardAnchors['email-ready']}
            isActive={activeStep === 'email-ready'}
            onInspect={() => inspectCard('email-ready')}
            chip={chipStep === 'email-ready' ? followUpChip : undefined}
          >
            <EmailToolCard body={emailBody} sent={thread.emailSent} onSend={sendEmail} />
          </CardSlot>
        ) : null}
        {showSlackMessage ? (
          <CardSlot
            anchor={caseDef.cardAnchors['follow-up-slack']}
            isActive={activeStep === 'follow-up-slack'}
            onInspect={() => inspectCard('follow-up-slack')}
            chip={chipStep === 'follow-up-slack' ? followUpChip : undefined}
          >
            <SlackMessageCard question={slackQuestion} />
          </CardSlot>
        ) : null}
          </>
        ) : null}

      </PanZoomCanvas>

      {/* P6-02：thread chrome（tab strip + history popover），viewport-fixed HUD。 */}
      <ThreadChrome />

      {!isEmpty ? (
        <>
          {/* feat-004 (ADR-0014)：终端流左栏 HUD——思考过程逐拍打印，MANIFEST 行可点飞卡。 */}
          <NexusTerminal caseDef={caseDef} thread={thread} onInspect={inspectCard} />
          {/* 第二轮（Danny）：原大横幅压成顶部紧凑 bar + hover/click 掉落卡（见 NexusBriefHud）。 */}
          <NexusBriefHud
            question={question}
            latestFollowUpQuestion={latestFollowUp?.question ?? null}
            stepLabel={activeStep ? caseDef.stepLabels[activeStep] : 'Question staged'}
            stepCount={thread.steps.length}
            planLength={planLength}
          />

          <div className="nexus-advance-bar">
            <button type="button" className="nexus-advance" onClick={runAgent}>
              {advanceLabel}
            </button>
          </div>

          {/* P6-03：常驻自由文本 follow-up composer（HUD，bottom-left；不复用空态 composer）。 */}
          <FollowUpComposer onAsk={handleFollowUp} />
        </>
      ) : (
        <NexusEmptyState />
      )}
    </section>
  )
}
