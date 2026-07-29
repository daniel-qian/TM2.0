import { useState } from 'react'
import type { LiteAdvice } from './streamSource'
import { useFlow } from './flowStore'
import { useDict } from '../shared/i18n/useDict'
import { confidenceLevelText, escalationLevelText } from '../shared/adviceLevels'

// feat-024 · 8 字段卡（lite 版）——复用 shared 的 .structured-output-card / .report-* CSS
// chrome（同一张卡的观感），代码零 story 依赖：confirmWith 是纯文本 chip（无 fixture 头像），
// 不派 fixture task（live 不凭空造派工对象）。红线由服务端 contract.py 复验；本卡只渲染。
//
// feat-036（PRD F3）：Recommended actions 每条挂"加入跟进"——真写 flowStore
// （source='room'），不是假按钮；点过一次变"Added"防重复堆。
//
// avery-sync zh-purity：这张卡此前的全部结构标签（"What it found" / "The read" / …9+ 处）
// 都是硬编码英文字面量，零 i18n——ZH 是生产默认，中文客户每次真跑一次问答都会在判读卡上
// 看见英文标签包着自己的中文内容。confidence/escalation 两处徽章同理（枚举值直接渲染），
// 修法见 src/shared/adviceLevels.ts。现在全卡按字典出词，v01 twin（src/lite/LiteAdviceCard.tsx）
// 复用同一批 t.lite2.advice*/t.lite.advice* 键（两侧目前文案一致，命名各自独立以便未来分叉）。

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
    <section className="structured-output-card" aria-label={t.lite2.adviceCardAria}>
      <header className="structured-output-header">
        <div>
          <p className="eyebrow">{t.lite2.adviceEyebrow}</p>
          <h2>{t.lite2.adviceReadTitle}</h2>
        </div>
        <span>{t.lite2.adviceSignOff}</span>
      </header>

      {/* ── ZONE 1 · THE READ（hero）── */}
      <div className="report-zone report-zone-read" aria-label={t.lite2.adviceReadTitle}>
        <section className="report-section report-conclusion" aria-label={t.lite2.adviceSummaryAria}>
          <p className="report-section-label">{t.lite2.adviceReadTitle}</p>
          <strong>{advice.summary}</strong>
        </section>

        {advice.detected_signals.length > 0 ? (
          <section className="report-section" aria-label={t.lite2.adviceSignalsLabel}>
            <p className="report-section-label">{t.lite2.adviceSignalsLabel}</p>
            <ul className="report-list">
              {advice.detected_signals.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
        ) : null}

        {advice.diagnosis_hypotheses.length > 0 ? (
          <section className="report-section" aria-label={t.lite2.adviceHypothesesLabel}>
            <p className="report-section-label">{t.lite2.adviceHypothesesLabel}</p>
            <ul className="report-list report-hypotheses">
              {advice.diagnosis_hypotheses.map((h) => (
                <li key={h.label} className={classNames(['hypothesis-item', `is-${h.kind}`])}>
                  <span className="hypothesis-kind">
                    {h.kind === 'primary' ? t.lite2.adviceMostLikely : t.lite2.adviceAlsoPossible}
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
      <div className="report-zone report-zone-backing" aria-label={t.lite2.adviceBackingLabel}>
        <p className="report-zone-label">{t.lite2.adviceBackingLabel}</p>
        <div className="report-grid">
          <section className="report-section" aria-label={t.lite2.adviceEvidenceLabel}>
            <p className="report-section-label">{t.lite2.adviceEvidenceLabel}</p>
            <ol className="report-list">
              {advice.evidence.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ol>
          </section>

          {/* 0729/02 absent≠none：confidence 缺席=系统这轮没做置信度判断，整节不渲染 */}
          {advice.confidence ? (
            <section className="report-section report-confidence" aria-label={t.lite2.adviceConfidenceLabel}>
              <p className="report-section-label">
                {t.lite2.adviceConfidenceLabel}{' '}
                <span className={classNames(['confidence-badge', `is-${advice.confidence.level}`])}>
                  {confidenceLevelText(advice.confidence.level, t.lite2)}
                </span>
              </p>
              <p className="confidence-rationale">{advice.confidence.rationale}</p>
              {advice.confidence.wouldChange.length > 0 ? (
                <details className="report-disclosure">
                  <summary>
                    <span className="disclosure-caret" aria-hidden="true" />
                    {t.lite2.adviceConfidenceWouldChange}{' '}
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
          ) : null}
        </div>
      </div>

      <hr className="report-zone-rule" aria-hidden="true" />

      {/* ── ZONE 3 · THE MOVE ── */}
      <div className="report-zone report-zone-move" aria-label={t.lite2.adviceMoveLabel}>
        <p className="report-zone-label">{t.lite2.adviceMoveLabel}</p>

        <section className="report-section" aria-label={t.lite2.adviceActionsLabel}>
          <p className="report-section-label">{t.lite2.adviceActionsLabel}</p>
          <ol className="report-list report-actions">
            {advice.recommended_actions.map((item) => (
              <li key={item} className="lite-advice-action-row">
                <span>{item}</span>
                <button
                  type="button"
                  className="lite-btn lite-btn--soft lite-advice-add-followup"
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
          <section className="report-section report-script" aria-label={t.lite2.adviceScriptLabel}>
            <p className="report-section-label">{t.lite2.adviceScriptLabel}</p>
            <p className="report-script-line">{advice.conversation_script}</p>
          </section>
        ) : null}

        {advice.metrics_to_track.length > 0 ? (
          <section className="report-section" aria-label={t.lite2.adviceWatchLabel}>
            <details className="report-disclosure">
              <summary>
                <span className="disclosure-caret" aria-hidden="true" />
                {t.lite2.adviceWatchLabel}{' '}
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

        {/* 0729/02 absent≠none：escalation 缺席=系统这轮没做升级判断，整节不渲染——
            绝不用默认 none 替系统说「暂时不用拉 HR」这句它没说过的话 */}
        {advice.escalation ? (
          <section className="report-section" aria-label={t.lite2.adviceHrAria}>
            <p className="report-section-label">
              {t.lite2.adviceHrLabel}{' '}
              <span className={classNames(['escalation-badge', `is-${advice.escalation.level}`])}>
                {escalationLevelText(advice.escalation.level, t.lite2)}
              </span>
            </p>
            {advice.escalation.note ? <p className="escalation-note">{advice.escalation.note}</p> : null}
            {advice.escalation.confirmWith.length > 0 ? (
              <>
                <p className="report-subtle-label">{t.lite2.adviceConfirmsLabel}</p>
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
        ) : null}
      </div>
    </section>
  )
}
