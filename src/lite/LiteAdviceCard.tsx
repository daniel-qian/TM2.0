import type { LiteAdvice } from './streamSource'
import { useDict } from '../shared/i18n/useDict'
import { confidenceLevelText, escalationLevelText } from '../shared/adviceLevels'

// feat-024 · 8 字段卡（lite 版）——复用 shared 的 .structured-output-card / .report-* CSS
// chrome（同一张卡的观感），代码零 story 依赖：confirmWith 是纯文本 chip（无 fixture 头像），
// 不派 fixture task（live 不凭空造派工对象）。红线由服务端 contract.py 复验；本卡只渲染。
//
// avery-sync zh-purity：这张卡此前的全部结构标签（"What it found" / "The read" / …9+ 处）都是
// 硬编码英文字面量，零 i18n——ZH 是生产默认（averylite.dannyqian.com 裸链此前就是 v01），中文
// 客户每次真跑一次问答都会在判读卡上看见英文标签包着自己的中文内容。confidence/escalation
// 两处徽章同理（枚举值直接渲染），修法见 src/shared/adviceLevels.ts。现在全卡按字典出词，
// 复用 v02 twin（src/lite2/LiteAdviceCard.tsx）同一批 t.lite.advice* 键（两侧文案目前一致，
// 命名各自独立的 t.lite/t.lite2 section，以便未来分叉）。

function classNames(parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ')
}

export function LiteAdviceCard({ advice }: { advice: LiteAdvice }) {
  const { t } = useDict()
  return (
    <section className="structured-output-card" aria-label={t.lite.adviceCardAria}>
      <header className="structured-output-header">
        <div>
          <p className="eyebrow">{t.lite.adviceEyebrow}</p>
          <h2>{t.lite.adviceReadTitle}</h2>
        </div>
        <span>{t.lite.adviceSignOff}</span>
      </header>

      {/* ── ZONE 1 · THE READ（hero）── */}
      <div className="report-zone report-zone-read" aria-label={t.lite.adviceReadTitle}>
        <section className="report-section report-conclusion" aria-label={t.lite.adviceSummaryAria}>
          <p className="report-section-label">{t.lite.adviceReadTitle}</p>
          <strong>{advice.summary}</strong>
        </section>

        {advice.detected_signals.length > 0 ? (
          <section className="report-section" aria-label={t.lite.adviceSignalsLabel}>
            <p className="report-section-label">{t.lite.adviceSignalsLabel}</p>
            <ul className="report-list">
              {advice.detected_signals.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
        ) : null}

        {advice.diagnosis_hypotheses.length > 0 ? (
          <section className="report-section" aria-label={t.lite.adviceHypothesesLabel}>
            <p className="report-section-label">{t.lite.adviceHypothesesLabel}</p>
            <ul className="report-list report-hypotheses">
              {advice.diagnosis_hypotheses.map((h) => (
                <li key={h.label} className={classNames(['hypothesis-item', `is-${h.kind}`])}>
                  <span className="hypothesis-kind">
                    {h.kind === 'primary' ? t.lite.adviceMostLikely : t.lite.adviceAlsoPossible}
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
      <div className="report-zone report-zone-backing" aria-label={t.lite.adviceBackingLabel}>
        <p className="report-zone-label">{t.lite.adviceBackingLabel}</p>
        <div className="report-grid">
          <section className="report-section" aria-label={t.lite.adviceEvidenceLabel}>
            <p className="report-section-label">{t.lite.adviceEvidenceLabel}</p>
            <ol className="report-list">
              {advice.evidence.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ol>
          </section>

          {/* 0729/02 absent≠none（随 API 砍样板同步的守卫，v01 不重设计）：缺席整节不渲染 */}
          {advice.confidence ? (
            <section className="report-section report-confidence" aria-label={t.lite.adviceConfidenceLabel}>
              <p className="report-section-label">
                {t.lite.adviceConfidenceLabel}{' '}
                <span className={classNames(['confidence-badge', `is-${advice.confidence.level}`])}>
                  {confidenceLevelText(advice.confidence.level, t.lite)}
                </span>
              </p>
              <p className="confidence-rationale">{advice.confidence.rationale}</p>
              {advice.confidence.wouldChange.length > 0 ? (
                <details className="report-disclosure">
                  <summary>
                    <span className="disclosure-caret" aria-hidden="true" />
                    {t.lite.adviceConfidenceWouldChange}{' '}
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
      <div className="report-zone report-zone-move" aria-label={t.lite.adviceMoveLabel}>
        <p className="report-zone-label">{t.lite.adviceMoveLabel}</p>

        <section className="report-section" aria-label={t.lite.adviceActionsLabel}>
          <p className="report-section-label">{t.lite.adviceActionsLabel}</p>
          <ol className="report-list report-actions">
            {advice.recommended_actions.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ol>
        </section>

        {advice.conversation_script ? (
          <section className="report-section report-script" aria-label={t.lite.adviceScriptLabel}>
            <p className="report-section-label">{t.lite.adviceScriptLabel}</p>
            <p className="report-script-line">{advice.conversation_script}</p>
          </section>
        ) : null}

        {advice.metrics_to_track.length > 0 ? (
          <section className="report-section" aria-label={t.lite.adviceWatchLabel}>
            <details className="report-disclosure">
              <summary>
                <span className="disclosure-caret" aria-hidden="true" />
                {t.lite.adviceWatchLabel}{' '}
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

        {/* 0729/02 absent≠none：escalation 缺席=系统这轮没做升级判断，整节不渲染 */}
        {advice.escalation ? (
          <section className="report-section" aria-label={t.lite.adviceHrAria}>
            <p className="report-section-label">
              {t.lite.adviceHrLabel}{' '}
              <span className={classNames(['escalation-badge', `is-${advice.escalation.level}`])}>
                {escalationLevelText(advice.escalation.level, t.lite)}
              </span>
            </p>
            {advice.escalation.note ? <p className="escalation-note">{advice.escalation.note}</p> : null}
            {advice.escalation.confirmWith.length > 0 ? (
              <>
                <p className="report-subtle-label">{t.lite.adviceConfirmsLabel}</p>
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
