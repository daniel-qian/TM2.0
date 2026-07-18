import { useState } from 'react'
import { useLite } from './store'
import { useDict } from '../shared/i18n/useDict'
import type { AskDraft, AskQuestion } from './transport'

// feat-034 阶段 B · Ask（Quick ask / 快问）卡——lite 第二种 artifact 卡，与 LiteAdviceCard
// 并列（The room 内、同画布）。manager 流程：draft（逐字编辑、1~3 题增删、点选具名受访者）
// → 确认（保存=服务端红线门 · 阶段 C）→ shared（一人一链 + 每条复制按钮；v1 手动粘贴到 IM，
// 分享=人闸）→ collecting（回收 chip）→ closed（回执呈现）。
//
// 🔴 ADR-0023 结构护栏（本卡的存在方式，不是文案约定）：
//   · 单人回执 = 数字/是否 + "本人自述"标注 + 员工原话短评——员工说自己对这件事的把握，合法。
//   · 多人同题 = 只渲染一段定性汇总（receipts_summary，真实现由服务端生成并过红线门）。
//     组件树里**不存在**"每人一行 + 数值"的列表/表格路径——想比分在这张卡上无码可走。
//   · 回执只读自 ask.recipients[].receipt——人卡/LitePerson 零字段、零渲染。

function classNames(parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ')
}

function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''))
}

// 已回执数（回收 chip 的分子）。
function answeredCount(ask: AskDraft): number {
  return ask.recipients.filter((r) => r.receipt).length
}

export function AskCard() {
  const { t } = useDict()
  const ask = useLite((s) => s.ask)
  const askBusy = useLite((s) => s.askBusy)
  const askError = useLite((s) => s.askError)
  const team = useLite((s) => s.team)
  const editAskQuestion = useLite((s) => s.editAskQuestion)
  const addAskQuestion = useLite((s) => s.addAskQuestion)
  const removeAskQuestion = useLite((s) => s.removeAskQuestion)
  const toggleAskRecipient = useLite((s) => s.toggleAskRecipient)
  const confirmAsk = useLite((s) => s.confirmAsk)
  const refreshAsk = useLite((s) => s.refreshAsk)

  const [copiedId, setCopiedId] = useState<string | null>(null)

  if (!ask) return null

  const isDraft = ask.status === 'draft'
  const isClosed = ask.status === 'closed'
  const collecting = ask.status === 'shared' || ask.status === 'collecting'
  // feat-047 打回复验：两个终态（阶段 C F1 词表补全）。已撤回/已过期只剩一句状态说明——
  // 链接区、编辑区全撤（isDraft/collecting/isClosed 三个分支都不命中，天然不渲染）。
  const isRevoked = ask.status === 'revoked'
  const isExpired = ask.status === 'expired'
  const answered = answeredCount(ask)
  const total = ask.recipients.length

  // 受访者候选 = 当前 team 花名册的具名人（Q4）；无花名册时退回草稿自带的具名人。
  const rosterChips =
    team && team.people.length > 0
      ? team.people.map((p) => ({ id: p.id, name: p.name }))
      : ask.recipients.map((r) => ({ id: r.id, name: r.name }))

  const canConfirm =
    isDraft &&
    askBusy === 'idle' &&
    ask.recipients.length >= 1 &&
    ask.questions.length >= 1 &&
    ask.questions.every((q) => q.text.trim().length > 0)

  async function copyLink(link: string, recipientId: string) {
    // clipboard 可能被拒（headless / 权限）——降级 execCommand，两条都失败也不崩，
    // 链接文本本身恒可见可选。
    let ok = false
    try {
      await navigator.clipboard.writeText(link)
      ok = true
    } catch {
      try {
        const ta = document.createElement('textarea')
        ta.value = link
        document.body.appendChild(ta)
        ta.select()
        ok = document.execCommand('copy')
        document.body.removeChild(ta)
      } catch {
        ok = false
      }
    }
    if (ok) setCopiedId(recipientId)
  }

  const kindLabel = (q: AskQuestion) => (q.kind === 'scale' ? t.ask.kindScale : t.ask.kindYesNo)

  return (
    <section
      className="lite-ask-card"
      data-ask-status={ask.status}
      aria-label={t.ask.eyebrow}
    >
      <header className="lite-ask-header">
        <div>
          <p className="eyebrow">{t.ask.eyebrow}</p>
          <h2>
            {isDraft
              ? t.ask.draftTitle
              : isClosed
                ? t.ask.receiptsTitle
                : isRevoked
                  ? t.ask.revokedTitle
                  : isExpired
                    ? t.ask.expiredTitle
                    : t.ask.sharedTitle}
          </h2>
        </div>
        {!isDraft ? (
          <span className="ask-status-chip">
            {isClosed
              ? t.ask.closedChip
              : isRevoked
                ? t.ask.revokedChip
                : isExpired
                  ? t.ask.expiredChip
                  : fill(t.ask.repliesChip, { answered, total })}
          </span>
        ) : null}
      </header>

      {isDraft ? (
        <>
          <p className="ask-lede">{t.ask.draftLede}</p>
          {/* 诚实提示：红线校验发生在保存时、在服务端（阶段 C）——预览里还没真跑过。 */}
          <p className="ask-redline-note">{t.ask.redlineNote}</p>

          <div className="ask-questions">
            {ask.questions.map((q) => (
              <div key={q.id} className="ask-q-row">
                <span className={classNames(['ask-q-kind', `is-${q.kind}`])}>{kindLabel(q)}</span>
                <input
                  className="ask-q-input"
                  type="text"
                  value={q.text}
                  aria-label={t.ask.questionAria}
                  onChange={(e) => editAskQuestion(q.id, e.currentTarget.value)}
                />
                <button
                  type="button"
                  className="ask-q-remove"
                  disabled={ask.questions.length <= 1}
                  aria-label={t.ask.removeQuestion}
                  onClick={() => removeAskQuestion(q.id)}
                >
                  ×
                </button>
              </div>
            ))}
            <div className="ask-q-actions">
              <button
                type="button"
                className="ask-q-add"
                data-kind="scale"
                disabled={ask.questions.length >= 3}
                onClick={() => addAskQuestion('scale')}
              >
                {t.ask.addScale}
              </button>
              <button
                type="button"
                className="ask-q-add"
                data-kind="yesno"
                disabled={ask.questions.length >= 3}
                onClick={() => addAskQuestion('yesno')}
              >
                {t.ask.addYesNo}
              </button>
              <span className="ask-q-hint">{t.ask.maxQuestionsHint}</span>
            </div>
          </div>

          {ask.comment_prompt ? (
            <p className="ask-comment-prompt">
              {t.ask.commentPromptLabel} <em>“{ask.comment_prompt}”</em>
            </p>
          ) : null}

          <div className="ask-recipients">
            <p className="ask-section-label">{t.ask.recipientsLabel}</p>
            <p className="ask-recipients-hint">{t.ask.recipientsHint}</p>
            <div className="ask-recipient-chips">
              {rosterChips.map((p) => {
                const selected = ask.recipients.some((r) => r.id === p.id)
                return (
                  <button
                    key={p.id}
                    type="button"
                    className={classNames(['ask-recipient-chip', selected && 'is-selected'])}
                    aria-pressed={selected}
                    onClick={() => toggleAskRecipient(p.id, p.name)}
                  >
                    {p.name}
                  </button>
                )
              })}
            </div>
          </div>

          <footer className="ask-footer">
            <button
              type="button"
              className="ask-confirm"
              disabled={!canConfirm}
              onClick={() => void confirmAsk()}
            >
              {askBusy === 'saving' ? t.ask.confirmBusy : t.ask.confirm}
            </button>
          </footer>
        </>
      ) : null}

      {collecting ? (
        <>
          <p className="ask-lede">{t.ask.sharedLede}</p>
          <div className="ask-links">
            {ask.recipients.map((r) => (
              <div key={r.id} className="ask-link-row">
                <span className="ask-link-name">{r.name}</span>
                <code className="ask-link-url">{r.link ?? ''}</code>
                <button
                  type="button"
                  className="ask-copy-btn"
                  onClick={() => void copyLink(r.link ?? '', r.id)}
                >
                  {copiedId === r.id ? t.ask.copied : t.ask.copy}
                </button>
              </div>
            ))}
          </div>
          <footer className="ask-footer">
            <button
              type="button"
              className="ask-refresh"
              disabled={askBusy !== 'idle'}
              onClick={() => void refreshAsk()}
            >
              {askBusy === 'refreshing' ? t.ask.refreshing : t.ask.refresh}
            </button>
          </footer>
        </>
      ) : null}

      {isClosed ? (
        <div className="ask-receipts">
          {total === 1 && ask.recipients[0]?.receipt ? (
            // 单人回执：数字/是否 + 本人自述标注 + 原话短评（ADR-0023 允许的唯一带数呈现）。
            <div className="ask-receipt-single">
              <p className="ask-receipt-who">{ask.recipients[0].name}</p>
              <p className="ask-self-label">
                {t.ask.selfReported}
                <span className="ask-self-hint">{t.ask.selfReportedHint}</span>
              </p>
              {ask.questions.map((q) => {
                const answer = ask.recipients[0].receipt?.answers.find(
                  (a) => a.question_id === q.id,
                )
                if (!answer) return null
                return (
                  <div key={q.id} className="ask-receipt-q">
                    <span className="ask-receipt-q-text">{q.text}</span>
                    <span className="ask-receipt-value">
                      {q.kind === 'scale'
                        ? `${answer.value} ${t.ask.receiptScaleSuffix}`
                        : answer.value === true
                          ? t.ask.receiptYes
                          : t.ask.receiptNo}
                    </span>
                  </div>
                )
              })}
              {ask.recipients[0].receipt?.comment ? (
                <blockquote className="ask-receipt-comment">
                  “{ask.recipients[0].receipt.comment}”
                </blockquote>
              ) : null}
              {ask.recipients[0].receipt?.answered_at ? (
                <p className="ask-receipt-when">
                  {t.ask.answeredAt} {ask.recipients[0].receipt.answered_at.slice(0, 16).replace('T', ' ')}
                </p>
              ) : null}
            </div>
          ) : (
            // 多人同题：只有这一段定性汇总——结构上不存在每人一行的分数表组件。
            <div className="ask-receipt-summary-block">
              <p className="ask-section-label">{t.ask.summaryTitle}</p>
              <p className="ask-receipt-summary">
                {ask.receipts_summary ?? fill(t.ask.repliesChip, { answered, total })}
              </p>
            </div>
          )}
        </div>
      ) : null}

      {/* feat-047 打回复验：两个终态各一句状态说明（文案走既有 shared ask.* 命名空间——
          AskCard 全篇本就消费 t.ask.*，阶段 C 已把 revoked / expired 两族文案定稿并过 M3，
          无需新 key）。链接区/编辑区在上面的三个分支里天然不命中，此处不重复否定。 */}
      {isRevoked ? <p className="ask-revoked-note">{t.ask.revokedNote}</p> : null}
      {isExpired ? <p className="ask-expired-note">{t.ask.expiredNote}</p> : null}

      {askError ? <p className="ask-error">{t.ask.errorGeneric}</p> : null}
    </section>
  )
}
