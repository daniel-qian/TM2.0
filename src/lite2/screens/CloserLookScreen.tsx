import { useMemo, useState } from 'react'
import { useLite } from '../store'
import { useFlow, selectGapsActive, selectGapsResolved, selectGapsDismissed } from '../flowStore'
import { useDict } from '../../shared/i18n/useDict'
import { gapClaimText, type GapCard } from '../gapDerive'

// feat-044 · lite2 屏 4：A closer look — 矛盾点独立页（PRD F4 / decisions.md 拍板#4）。
// 替换 feat-035 立的空态占位屏。对照卡（左"文件里的说法" claim / 右"实际信号" evidence，
// 均引真实项目字段原文，可溯源零捏造——gapDerive.ts 纯函数派生）+ 解决/忽略 + 历史折叠 +
// "直接问问本人"→ The room 预填。
//
// 🔴 红线：卡的主语=项目；owner 只以人名出现，零数字零评判（本屏结构上不渲染任何数字——
// 连 project.progress/dueDate 都不显，claim/evidence 引用的是纯文本自述/blocker 行）；
// 点名类矛盾（沉默成员等）本期不做（gapDerive.ts 结构上只读项目字段，够不到人身信号）；
// 命名走锁定词族——本屏与其文案永不出现 gap/差距/现实差距/Nexus 字样（组件/CSS 内部命名
// 用 "gap" 是内部领域概念名，ADR-0015 只管 user-facing 标签）。
// 墙不打洞（不 import src/story/**、不 import src/lite/**）。

function classNames(parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ')
}

export function CloserLookScreen() {
  const { t } = useDict()
  const team = useLite((s) => s.team)
  const goScreen = useLite((s) => s.goScreen)
  const openDetail = useLite((s) => s.openDetail)

  const gapMarks = useFlow((s) => s.gapMarks)
  const resolveGap = useFlow((s) => s.resolveGap)
  const dismissGap = useFlow((s) => s.dismissGap)
  const restoreGap = useFlow((s) => s.restoreGap)
  const addFollowup = useFlow((s) => s.addFollowup)
  const setComposerDraft = useFlow((s) => s.setComposerDraft)

  const [historyOpen, setHistoryOpen] = useState(false)
  const [addedIds, setAddedIds] = useState<ReadonlySet<string>>(new Set())

  const active = useMemo(() => selectGapsActive(team, gapMarks), [team, gapMarks])
  const resolved = useMemo(() => selectGapsResolved(team, gapMarks), [team, gapMarks])
  const dismissed = useMemo(() => selectGapsDismissed(team, gapMarks), [team, gapMarks])
  const historyCount = resolved.length + dismissed.length

  function handleAsk(gap: GapCard) {
    // 预填含项目引用 + claim/evidence 上下文；正文不携带人身评判语（只谈项目自述与信号，
    // 不谈"你为什么没说实话"一类归咎措辞）。不自动提交——manager 审过再问，同分诊
    // "带进议事室"的 authorship 原则（feat-036）。
    // 分隔符用 " — " 而非换行：composer 是 <input type="text">，换行被剥掉后三段文字会
    // 连成一坨不可读（对抗验证 redline 路发现，2026-07-14；TeamScreen 的 take-to-room
    // 预填是同根问题，已一并修）。
    setComposerDraft(`${gap.projectTitle} — ${gapClaimText(gap, t.lite2)} — ${gap.evidence}`)
    goScreen('room')
  }

  function handleAddFollowup(gap: GapCard) {
    addFollowup({
      title: `Take a closer look at ${gap.projectTitle}`,
      source: 'closer-look',
      dueGroup: 'today',
      note: gap.evidence,
    })
    setAddedIds((prev) => {
      const next = new Set(prev)
      next.add(gap.id)
      return next
    })
  }

  return (
    <section className="scene scene-nexus is-active lite-closerlook" aria-label={t.lite2.tabCloserLook}>
      <div className="lite-closerlook-scroll">
        <div className="lite-closerlook-frame">
          <header className="lite-closerlook-header">
            <p className="eyebrow">{t.lite2.gapPageEyebrow}</p>
            <h1>{t.lite2.gapPageTitle}</h1>
            <p className="lite-closerlook-lede">{t.lite2.gapPageBody}</p>
          </header>

          {active.length > 0 ? (
            <ol className="lite-gap-list">
              {active.map((gap) => (
                <li key={gap.id} className="lite-gap-card" data-gap-id={gap.id}>
                  <div className="lite-gap-compare">
                    <div className="lite-gap-pane lite-gap-pane-claim">
                      <p className="lite-badge lite-gap-pane-label">{t.lite2.gapCardClaimLabel}</p>
                      <p className="lite-gap-pane-text">{gapClaimText(gap, t.lite2)}</p>
                    </div>
                    <div className="lite-gap-pane lite-gap-pane-evidence">
                      <p className="lite-badge lite-gap-pane-label">{t.lite2.gapCardEvidenceLabel}</p>
                      <p className="lite-gap-pane-text">{gap.evidence}</p>
                    </div>
                  </div>
                  <div className="lite-gap-meta">
                    <button
                      type="button"
                      className="lite-gap-project-link"
                      onClick={() => openDetail('project', gap.projectId)}
                    >
                      <span className="lite-gap-project-title">{gap.projectTitle}</span> →
                    </button>
                    <span className="lite-gap-owner">
                      {/* 兜底在渲染层（Blockers 5c）：gapDerive 透传的是原值或空串。 */}
                      {t.lite2.gapOwnerPrefix} {gap.ownerName || t.lite2.projectsUnknownValue}
                    </span>
                  </div>
                  <div className="lite-gap-actions">
                    <button type="button" className="lite-btn lite-btn--primary lite-gap-resolve" onClick={() => resolveGap(gap.id)}>
                      {t.lite2.gapResolveLabel}
                    </button>
                    <button type="button" className="lite-btn lite-btn--ghost lite-gap-dismiss" onClick={() => dismissGap(gap.id)}>
                      {t.lite2.gapDismissLabel}
                    </button>
                    <button type="button" className="lite-btn lite-btn--ghost lite-gap-ask" onClick={() => handleAsk(gap)}>
                      {t.lite2.gapAskLabel} ↗
                    </button>
                    <button
                      type="button"
                      className="lite-btn lite-btn--soft lite-gap-addfollowup"
                      disabled={addedIds.has(gap.id)}
                      onClick={() => handleAddFollowup(gap)}
                    >
                      {addedIds.has(gap.id) ? t.lite2.followupAdded : t.lite2.gapAddFollowupLabel}
                    </button>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <section className="lite-gap-empty" aria-label={t.lite2.gapEmptyAria}>
              <h2>{t.lite2.gapEmptyTitle}</h2>
              <p>{t.lite2.gapEmptyBody}</p>
            </section>
          )}

          {/* 0721 对齐棒 · Danny 2C 拍板：实时分析不做 tab 名（现功能是离线文档对照，改名
              = 名字替产品许诺不存在的能力），改在页内用条件时态预告「连接公司数据后变实时」。
              语法对齐 Vision 屏的诚实 Coming 标注：不写日期、不装已接线。 */}
          <aside className="lite-gap-realtime-note" data-realtime-note="">
            <p className="lite-gap-realtime-title">{t.lite2.gapRealtimeTitle}</p>
            <p className="lite-gap-realtime-body">{t.lite2.gapRealtimeBody}</p>
          </aside>

          {historyCount > 0 ? (
            <section className="lite-gap-history">
              <button
                type="button"
                className="lite-gap-history-toggle"
                aria-expanded={historyOpen}
                onClick={() => setHistoryOpen((open) => !open)}
              >
                {t.lite2.gapHistoryToggleLabel} · {historyCount}
                <span aria-hidden="true">{historyOpen ? '▴' : '▾'}</span>
              </button>
              {historyOpen ? (
                <ul className="lite-gap-history-list">
                  {resolved.map((gap) => (
                    <li
                      key={gap.id}
                      className="lite-gap-history-item"
                      data-gap-id={gap.id}
                      data-gap-status="resolved"
                    >
                      <span className="lite-gap-history-title">{gap.projectTitle}</span>
                      <span className={classNames(['lite-badge', 'lite-gap-history-badge', 'is-resolved'])}>
                        {t.lite2.gapResolvedBadge}
                      </span>
                      <button type="button" className="lite-btn lite-btn--ghost lite-gap-restore" onClick={() => restoreGap(gap.id)}>
                        {t.lite2.gapRestoreLabel}
                      </button>
                    </li>
                  ))}
                  {dismissed.map((gap) => (
                    <li
                      key={gap.id}
                      className="lite-gap-history-item"
                      data-gap-id={gap.id}
                      data-gap-status="dismissed"
                    >
                      <span className="lite-gap-history-title">{gap.projectTitle}</span>
                      <span className={classNames(['lite-badge', 'lite-gap-history-badge', 'is-dismissed'])}>
                        {t.lite2.gapDismissedBadge}
                      </span>
                      <button type="button" className="lite-btn lite-btn--ghost lite-gap-restore" onClick={() => restoreGap(gap.id)}>
                        {t.lite2.gapRestoreLabel}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          ) : null}
        </div>
      </div>
    </section>
  )
}
