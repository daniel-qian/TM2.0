import { useEffect, useRef, useState } from 'react'
import { useDraft } from './draftStore'
import { useFlow } from './flowStore'
import { useLite } from './store'
import { useDict } from '../shared/i18n/useDict'
import { LiteModal } from './LiteModal'
import { clipboardTextForDraft, mailtoForDraft, type LiteDraft } from './draftLinks'

// feat-058（PRD G6 · Danny 点名）· 应用内草稿框。
//
// 改掉的现状：「起草消息」曾是一条裸 `mailto:` 链接——点一下人就被甩进系统邮件客户端，
// manager 连 Avery 写了什么都没看见，而且国内团队根本不在邮件里干活。
//
// 对齐参考库的形状（收件人 + 主题 + 预写正文 + 三个出口），但三处**有意超过**它：
//   🟢 ① 正文可编辑——她那份是只读预览。正文是从真数据派生出来的草稿，不可编辑等于不可用：
//        manager 一定要按自己的口气改一句再发。主题同理。
//   🟢 ② **复制到聊天应用是主出口**，mailto 降为次出口（国内团队在微信/飞书，mailto 基本是
//        死路）。复制**必须有确定反馈**：按钮改字 + aria-live 状态行，剪贴板被拒时如实说
//        失败并给出手动办法，绝不静默假装成功。
//   🟢 ③ 「完成」**真写进跟进队列**（flowStore → localStorage，刷新仍在）——她的「加入待办」
//        只弹一个 toast，不落库。
//
// 🔴 收件人是**人名不是邮箱**（我们从没有他们的邮箱），mailto 的 To 恒为空——弹层里明说这件事。
// 🔴 弹层行为（背景点击 / Esc / 滚动锁 / 焦点 / 层级 / 动画）全部由 feat-052 的 LiteModal 基座
//    提供，这里一行都不自己实现。常驻挂载（Lite2App）+ open 属性驱动，父层条件挂载会让出场
//    动画没机会跑。

type DraftStatus = 'idle' | 'copied' | 'copyFailed' | 'added' | 'completed'

export function DraftComposer() {
  const { t } = useDict()
  const liveDraft = useDraft((s) => s.draft)
  const closeDraft = useDraft((s) => s.closeDraft)
  const setSubject = useDraft((s) => s.setSubject)
  const setBody = useDraft((s) => s.setBody)
  const addFollowup = useFlow((s) => s.addFollowup)
  const completeFollowup = useFlow((s) => s.completeFollowup)
  const goScreen = useLite((s) => s.goScreen)

  const open = Boolean(liveDraft)

  // 出场动画期间 store.draft 已是 null，面板却还在屏上——留住最后一帧，否则关闭瞬间内容
  // 整块闪没、只剩空壳在缩（DetailOverlay 同款写法，见 LiteModal 顶注）。
  const lastRef = useRef<LiteDraft | null>(null)
  if (liveDraft) lastRef.current = liveDraft
  const draft = liveDraft ?? lastRef.current

  const [status, setStatus] = useState<DraftStatus>('idle')

  // 换一份草稿才清状态。**不在关闭时清**：draftId 变 null 会把「已写进跟进队列」这行字在
  // 出场动画跑到一半时抹掉，最后一眼看到的反而是空状态行。
  const draftId = liveDraft?.id ?? null
  useEffect(() => {
    if (draftId) setStatus('idle')
  }, [draftId])

  const subject = draft?.subject ?? ''
  const body = draft?.body ?? ''
  const copyText = draft ? clipboardTextForDraft(draft) : ''
  const isEmpty = copyText.trim().length === 0

  // 改过字之后，「已复制」就不再成立了（剪贴板里躺的是旧版本）——把复制类状态退回 idle，
  // 别让一行过期的成功提示留在屏上。但 added/completed 不退：那两件事是真发生过的。
  function clearCopyStatus() {
    if (status === 'copied' || status === 'copyFailed') setStatus('idle')
  }

  async function handleCopy() {
    if (!draft || isEmpty) return
    // clipboard 可能被拒（无 https / headless / 权限）——降级 execCommand；两条都失败就如实
    // 报失败，让 manager 手动选中复制。绝不假装成功（本仓 AskCard 同款降级路径）。
    let ok = false
    try {
      await navigator.clipboard.writeText(copyText)
      ok = true
    } catch {
      try {
        const ta = document.createElement('textarea')
        ta.value = copyText
        document.body.appendChild(ta)
        ta.select()
        ok = document.execCommand('copy')
        document.body.removeChild(ta)
      } catch {
        ok = false
      }
    }
    setStatus(ok ? 'copied' : 'copyFailed')
  }

  function handleDone() {
    if (!draft || isEmpty) return
    if (draft.completion.mode === 'complete') {
      completeFollowup(draft.completion.followupId)
      setStatus('completed')
      return
    }
    if (draft.completion.mode !== 'add') return
    // 标题空了就用正文首行兜底——队列里长出一条没有标题的空条目比什么都糟。
    const trimmedBody = body.trim()
    const title = subject.trim() || trimmedBody.split('\n')[0]
    // note 恒等于**整份正文**，只在它与标题逐字相同时省掉（"主题空 + 正文只有一行"的情形，
    // 再存一遍等于队列条目上同一句话印两遍）。
    // 🔴 这里原先写的是「主题非空才存 note」：主题一空，manager 刚改完的正文除首行外**整段
    //    被丢掉**，队列里只剩一行残句，且屏上照样报"已写进跟进队列"——静默丢数据。
    const note = trimmedBody && trimmedBody !== title ? trimmedBody : undefined
    addFollowup({ title, source: draft.source, dueGroup: 'today', note })
    setStatus('added')
  }

  function handleGoFollowups() {
    closeDraft()
    goScreen('followups')
  }

  const statusText =
    status === 'copied'
      ? t.lite2.draftCopiedStatus
      : status === 'copyFailed'
        ? t.lite2.draftCopyFailed
        : status === 'added'
          ? t.lite2.draftAddedStatus
          : status === 'completed'
            ? t.lite2.draftCompletedStatus
            : ''

  const wroteToQueue = status === 'added' || status === 'completed'
  const completionMode = draft?.completion.mode ?? 'none'

  return (
    <LiteModal
      open={open}
      onClose={closeDraft}
      ariaLabel={t.lite2.draftAria}
      backdropLabel={t.lite2.draftClose}
      panelClassName="lite-draft-card"
      panelData={{ 'data-draft-id': draft?.id, 'data-draft-status': status }}
    >
      <button type="button" className="lite-btn lite-btn--ghost lite-draft-close" onClick={closeDraft}>
        {t.lite2.draftClose}
      </button>

      <header className="lite-draft-head">
        <p className="eyebrow">{t.lite2.draftEyebrow}</p>
        <h2>{t.lite2.draftTitle}</h2>
      </header>

      <section className="lite-draft-field">
        <p className="eyebrow">{t.lite2.draftRecipients}</p>
        {draft && draft.recipients.length > 0 ? (
          <>
            <p className="lite-draft-chips">
              {draft.recipients.map((name) => (
                <span key={name} className="upload-source-chip">
                  {name}
                </span>
              ))}
            </p>
            {/* 🔴 名字 ≠ 邮箱：mailto 的 To 恒为空，这句话是它的诚实告示。 */}
            <p className="lite-draft-hint">{t.lite2.draftRecipientHint}</p>
          </>
        ) : (
          <p className="lite-draft-hint">{t.lite2.draftNoRecipient}</p>
        )}
      </section>

      <label className="lite-draft-field">
        <span className="eyebrow">{t.lite2.draftSubject}</span>
        <input
          className="lite-draft-subject"
          type="text"
          value={subject}
          onChange={(e) => {
            setSubject(e.currentTarget.value)
            clearCopyStatus()
          }}
        />
      </label>

      <label className="lite-draft-field">
        <span className="eyebrow">{t.lite2.draftBody}</span>
        <textarea
          className="lite-draft-body"
          rows={8}
          value={body}
          onChange={(e) => {
            setBody(e.currentTarget.value)
            clearCopyStatus()
          }}
        />
      </label>

      <p className="lite-draft-hint">{t.lite2.draftBodyHint}</p>

      {/* 状态行常驻渲染（不是只在有话说时才挂）——aria-live 区域要先在 DOM 里存在，读屏才
          播报后来填进去的文字；挂载的同时塞字是播不出来的。 */}
      <p
        className="lite-draft-status"
        role="status"
        aria-live="polite"
        // 成功与失败共用同一行字、同一个位置——颜色是唯一能一眼分开两者的信号。
        data-tone={status === 'copyFailed' ? 'fail' : undefined}
      >
        {statusText}
      </p>

      <footer className="lite-draft-actions">
        {/* 主出口。 */}
        <button
          type="button"
          className="lite-btn lite-btn--soft lite-draft-copy"
          disabled={isEmpty}
          onClick={() => void handleCopy()}
        >
          {status === 'copied' ? t.lite2.draftCopied : t.lite2.draftCopy}
        </button>

        {/* 次出口：mailto 由**当前**主题/正文实时重算，manager 改过的字带得进去。
            空草稿时和另两个出口一起失效——`<a>` 没有 disabled，只能 aria-disabled + 拦点击。
            兜底 href 用裸 `mailto:` 而不是 `#`：`#` 会往 router 历史里塞一条空导航。 */}
        <a
          className="lite-draft-mailto"
          href={draft && !isEmpty ? mailtoForDraft(draft) : 'mailto:'}
          aria-disabled={isEmpty || undefined}
          onClick={(e) => {
            if (isEmpty) e.preventDefault()
          }}
        >
          {t.lite2.draftMailto}
        </a>

        {completionMode !== 'none' ? (
          <button
            type="button"
            className="lite-btn lite-btn--primary lite-draft-done"
            disabled={isEmpty || wroteToQueue}
            onClick={handleDone}
          >
            {completionMode === 'complete' ? t.lite2.draftDoneComplete : t.lite2.draftDoneAdd}
          </button>
        ) : null}

        {wroteToQueue ? (
          <button type="button" className="lite-btn lite-btn--ghost lite-draft-goqueue" onClick={handleGoFollowups}>
            {t.lite2.draftGoFollowups}
          </button>
        ) : null}
      </footer>
    </LiteModal>
  )
}
