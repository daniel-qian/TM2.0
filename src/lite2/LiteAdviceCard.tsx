import { useState } from 'react'
import type { LiteAdvice } from './streamSource'
import { useFlow } from './flowStore'
import { useDict } from '../shared/i18n/useDict'

// feat-024 · 8 字段卡（lite 版）——复用 shared 的 .structured-output-card / .report-* CSS
// chrome（同一张卡的观感），代码零 story 依赖：confirmWith 是纯文本 chip（无 fixture 头像），
// 不派 fixture task（live 不凭空造派工对象）。红线由服务端 contract.py 复验；本卡只渲染。
//
// feat-036（PRD F3）：Recommended actions 每条挂"加入跟进"——真写 flowStore
// （source='room'），不是假按钮；点过一次变"Added"防重复堆。

function classNames(parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ')
}

export function LiteAdviceCard({ advice }: { advice: LiteAdvice }) {
  const { t } = useDict()
  const addFollowup = useFlow((s) => s.addFollowup)
  const [added, setAdded] = useState<ReadonlySet<string>>(new Set())

  function handleAdd(item: string) {
    addFollowup({ title: item, source: 'room', dueGroup: 'today' })
    setAdded((prev) => {
      const next = new Set(prev)
      next.add(item)
      return next
    })
  }

  return (
    <section className="structured-output-card" aria-label="What it found — the read">
      <header className="structured-output-header">
        <div>
          <p className="eyebrow">What it found</p>
          <h2>The read</h2>
        </div>
        <span>Yours to sign off</span>
      </header>

      {/* ── ZONE 1 · THE READ（hero）── */}
      <div className="report-zone report-zone-read" aria-label="The read">
        <section className="report-section report-conclusion" aria-label="Summary — the read">
          <p className="report-section-label">The read</p>
          <strong>{advice.summary}</strong>
        </section>

        {advice.detected_signals.length > 0 ? (
          <section className="report-section" aria-label="Signals it picked up">
            <p className="report-section-label">Signals it picked up</p>
            <ul className="report-list">
              {advice.detected_signals.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
        ) : null}

        {advice.diagnosis_hypotheses.length > 0 ? (
          <section className="report-section" aria-label="What might be going on">
            <p className="report-section-label">What might be going on — a read, not a verdict</p>
            <ul className="report-list report-hypotheses">
              {advice.diagnosis_hypotheses.map((h) => (
                <li key={h.label} className={classNames(['hypothesis-item', `is-${h.kind}`])}>
                  <span className="hypothesis-kind">
                    {h.kind === 'primary' ? 'Most likely' : 'Also possible'}
                  </span>
                  {h.label}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>

      <hr className="report-zone-rule" aria-hidden="true" />

      {/* ── ZONE 2 · THE BACKING ── */}
      <div className="report-zone report-zone-backing" aria-label="The backing">
        <p className="report-zone-label">The backing</p>
        <div className="report-grid">
          <section className="report-section" aria-label="Why I'm saying this">
            <p className="report-section-label">Why I&rsquo;m saying this</p>
            <ol className="report-list">
              {advice.evidence.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ol>
          </section>

          <section className="report-section report-confidence" aria-label="How sure it is">
            <p className="report-section-label">
              How sure it is{' '}
              <span className={classNames(['confidence-badge', `is-${advice.confidence.level}`])}>
                {advice.confidence.level}
              </span>
            </p>
            <p className="confidence-rationale">{advice.confidence.rationale}</p>
            {advice.confidence.wouldChange.length > 0 ? (
              <details className="report-disclosure">
                <summary>
                  <span className="disclosure-caret" aria-hidden="true" />
                  What would change it{' '}
                  <span className="disclosure-count">{advice.confidence.wouldChange.length}</span>
                </summary>
                <ul className="report-list">
                  {advice.confidence.wouldChange.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </details>
            ) : null}
          </section>
        </div>
      </div>

      <hr className="report-zone-rule" aria-hidden="true" />

      {/* ── ZONE 3 · THE MOVE ── */}
      <div className="report-zone report-zone-move" aria-label="The move">
        <p className="report-zone-label">The move</p>

        <section className="report-section" aria-label="Recommended actions">
          <p className="report-section-label">Recommended actions</p>
          <ol className="report-list report-actions">
            {advice.recommended_actions.map((item) => (
              <li key={item} className="lite-advice-action-row">
                <span>{item}</span>
                <button
                  type="button"
                  className="lite-advice-add-followup"
                  disabled={added.has(item)}
                  onClick={() => handleAdd(item)}
                >
                  {added.has(item) ? t.lite2.followupAdded : t.lite2.adviceAddFollowup}
                </button>
              </li>
            ))}
          </ol>
        </section>

        {advice.conversation_script ? (
          <section className="report-section report-script" aria-label="If you open the 1:1">
            <p className="report-section-label">If you open the 1:1</p>
            <p className="report-script-line">{advice.conversation_script}</p>
          </section>
        ) : null}

        {advice.metrics_to_track.length > 0 ? (
          <section className="report-section" aria-label="What to watch">
            <details className="report-disclosure">
              <summary>
                <span className="disclosure-caret" aria-hidden="true" />
                What to watch to know it worked{' '}
                <span className="disclosure-count">{advice.metrics_to_track.length}</span>
              </summary>
              <ul className="report-list report-actions">
                {advice.metrics_to_track.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </details>
          </section>
        ) : null}

        <section className="report-section" aria-label="HR / who confirms">
          <p className="report-section-label">
            When to pull in HR{' '}
            <span className={classNames(['escalation-badge', `is-${advice.escalation.level}`])}>
              {advice.escalation.level === 'none' ? 'not yet' : advice.escalation.level}
            </span>
          </p>
          {advice.escalation.note ? <p className="escalation-note">{advice.escalation.note}</p> : null}
          {advice.escalation.confirmWith.length > 0 ? (
            <>
              <p className="report-subtle-label">Who confirms</p>
              <div className="confirmation-list">
                {advice.escalation.confirmWith.map((label) => (
                  <span key={label} className="confirmation-chip">
                    {label}
                  </span>
                ))}
              </div>
            </>
          ) : null}
        </section>
      </div>
    </section>
  )
}
