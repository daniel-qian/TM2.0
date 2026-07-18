import { useMemo, useState } from 'react'
import { useLite } from '../store'
import { useFlow, selectTriagePending, selectTriageHandled, selectTriageSetAside } from '../flowStore'
import { draftMailForHandoff } from '../draftLinks'
import { useDict } from '../../shared/i18n/useDict'
import { UploadPanel } from '../UploadPanel'
import { InitialAvatar } from '../InitialAvatar'
import { LiteComposer } from '../LiteComposer'
import { groupPeople } from '../teamGroups'
import type { LiteHandoff, LitePerson } from '../teamData'

// feat-024 · lite 屏 1+2：上传空态 · Your team——ADR-0022 决策 1。
// 空态：左脊柱是 live 自己的引导文案（不渲染任何 scripted 占位——story 渗漏的第一现场）；
// 右栏 = 上传。上传后：briefing 真数顶栏（人数/项目数来自 ingestion，聚合数字 R2 真算才显）
// + 人卡/项目卡双轨 + 晨间分诊区（feat-036，PRD F2 / ADR-0017 原判执行）。
// 🔴 红线：人卡永不渲染任何数字——LitePerson 类型层就没有评分键的位置。
//
// feat-036 · 晨间分诊三动作（ADR-0017 决策 5）：分诊条目本身仍是 teamData.ts liveHandoffs()
// 的真派生（handoffs ← 项目 blockers，零捏造）；这里只加真接线的三动作 + "今天已照料"堆：
//   done → 收进堆、pending 计数安静更新；discard → 直接消失（同样收进堆，标"搁置"）；
//   带进议事室 → composer 预填该条目上下文，切到 The room（不自动提交——人审过再问）。
// marks 态与 Follow-ups 一样走 flowStore 的 localStorage（key 带 lite2 前缀）。

function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''))
}

// 进度条分档与 story 地图页同口径（<40 低 · 40–69 中 · ≥70 高），复用 strip-* 配色类。
function progressBand(progress: number) {
  if (progress < 40) return 'strip-low'
  if (progress < 70) return 'strip-mid'
  return 'strip-high'
}

function statusTone(status: string) {
  if (status === 'blocked') return 'tone-danger'
  if (status === 'at-risk') return 'tone-warning'
  return ''
}

function classNames(parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ')
}

// 单张人卡（分组视图与兜底 flat 视图共用）。🔴 红线：永不渲染任何数字/评分/排名。
function PersonCard({
  person,
  onOpen,
}: {
  person: LitePerson
  onOpen: (id: string) => void
}) {
  return (
    <button
      type="button"
      className={classNames(['home-person-card', person.read && `home-tone-${person.tone}`])}
      onClick={() => onOpen(person.id)}
      aria-label={`Open ${person.name}${person.read ? ` — ${person.read}` : ''}`}
    >
      <InitialAvatar name={person.name} size={44} className="home-person-avatar" />
      <span className="home-person-body">
        <h3>{person.name}</h3>
        <p className="home-person-role">{person.role}</p>
        {person.read ? <p className="home-person-read">{person.read}</p> : null}
      </span>
      {/* 🔴 红线：人卡永不渲染任何数字 —— 无 moodPct/capacityPct/% */}
    </button>
  )
}

// 一个可折叠的人卡分组容器（feat-025 Q2：分组标题 + 人数 + 折叠）。
function PeopleGroup({
  title,
  people,
  onOpen,
}: {
  title: string
  people: LitePerson[]
  onOpen: (id: string) => void
}) {
  const { t } = useDict()
  const [open, setOpen] = useState(true)
  const countLabel = people.length === 1 ? t.lite2.groupCountOne : t.lite2.groupCountMany
  return (
    <section className="home-people-group" aria-label={title}>
      <button
        type="button"
        className="home-people-group-head"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="home-people-group-title">{title}</span>
        <span className="home-people-group-count">
          {people.length} {countLabel}
        </span>
        <span className="home-people-group-toggle">
          {open ? t.lite2.groupCollapse : t.lite2.groupExpand}
        </span>
      </button>
      {open ? (
        <div className="home-lane home-lane-people" aria-label={title}>
          {people.map((person) => (
            <PersonCard key={person.id} person={person} onOpen={onOpen} />
          ))}
        </div>
      ) : null}
    </section>
  )
}

export function TeamScreen() {
  const { t } = useDict()
  const team = useLite((s) => s.team)
  const openDetail = useLite((s) => s.openDetail)
  const goScreen = useLite((s) => s.goScreen)
  // feat-050 · 会话不丢：空态下要分清"正在取回上次会话"和"真没有会话"。
  const restoring = useLite((s) => s.restoring)
  const restoreError = useLite((s) => s.restoreError)
  const restoreSession = useLite((s) => s.restoreSession)

  const triageMarks = useFlow((s) => s.triageMarks)
  const markTriageDone = useFlow((s) => s.markTriageDone)
  const discardTriage = useFlow((s) => s.discardTriage)
  const restoreTriage = useFlow((s) => s.restoreTriage)
  const addFollowup = useFlow((s) => s.addFollowup)
  const setComposerDraft = useFlow((s) => s.setComposerDraft)

  const [drawerOpen, setDrawerOpen] = useState(false)
  const [addedFollowupIds, setAddedFollowupIds] = useState<ReadonlySet<string>>(new Set())

  const pending = useMemo(() => selectTriagePending(team, triageMarks), [team, triageMarks])
  const handled = useMemo(() => selectTriageHandled(team, triageMarks), [team, triageMarks])
  const setAside = useMemo(() => selectTriageSetAside(team, triageMarks), [team, triageMarks])
  const totalHandoffs = team?.handoffs.length ?? 0

  function handleTakeToRoom(handoff: LiteHandoff) {
    // 分隔符用 " — " 而非换行：composer 是 <input type="text">，换行被剥掉后两段文字会
    // 连成一坨不可读（feat-044 对抗验证发现的同根 bug，与 CloserLookScreen 的 ask 预填
    // 一并修，见该处注释）。
    setComposerDraft(`${handoff.action} — ${handoff.evidence}`)
    goScreen('room')
  }

  function handleAddFollowup(handoff: LiteHandoff) {
    addFollowup({ title: handoff.action, source: 'triage', dueGroup: 'today', note: handoff.evidence })
    setAddedFollowupIds((prev) => {
      const next = new Set(prev)
      next.add(handoff.id)
      return next
    })
  }

  return (
    <section className="scene scene-home is-active" aria-label="Your team — live">
      <div className="home-scroll">
        <div className="home-frame">
          {/* ── 左脊柱 ─────────────────────────────────────────────── */}
          <div className="home-spine">
            {team ? (
              <>
                <header className="home-greeting">
                  <p className="eyebrow">{t.lite2.briefingEyebrow}</p>
                  <h1>{team.briefing.headline}</h1>
                  <p className="home-greeting-sub">{team.briefing.subhead}</p>
                  {team.briefing.metrics.length > 0 ? (
                    <div className="lite-metrics" aria-label={t.lite2.metricsLabel}>
                      {team.briefing.metrics.map((m) => (
                        <span key={m.label} className="lite-metric-chip">
                          <strong>{m.value}</strong> {m.label}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </header>

                <div className="home-spine-head">
                  <h2>{t.lite2.handoffsTitle}</h2>
                  {totalHandoffs > 0 && pending.length > 0 ? (
                    <p className="home-count" aria-live="polite">
                      {fill(t.lite2.triageRemaining, { pending: pending.length, total: totalHandoffs })}
                    </p>
                  ) : null}
                </div>

                {pending.length > 0 ? (
                  <ol className="home-handoff-list">
                    {pending.map((handoff) => (
                      <li
                        key={handoff.id}
                        className={classNames(['home-handoff', `home-tone-${handoff.tone}`])}
                      >
                        <button
                          type="button"
                          className="home-check"
                          aria-label={fill(t.lite2.triageDoneAria, { action: handoff.action })}
                          onClick={() => markTriageDone(handoff.id)}
                        >
                          <span className="lite-triage-checkmark" aria-hidden="true">
                            ✓
                          </span>
                        </button>
                        <div className="home-handoff-body">
                          <span className="home-handoff-tone">{handoff.toneLabel}</span>
                          <h3>{handoff.action}</h3>
                          <p>{handoff.evidence}</p>
                          <div className="home-handoff-links">
                            <button
                              type="button"
                              className="home-map-card-link"
                              onClick={() => openDetail('project', handoff.projectIds[0])}
                            >
                              {t.lite2.handoffOpen} →
                            </button>
                            <button
                              type="button"
                              className="lite-triage-room"
                              onClick={() => handleTakeToRoom(handoff)}
                            >
                              {t.lite2.triageTakeToRoomLabel} ↗
                            </button>
                            <button
                              type="button"
                              className="lite-triage-addfollowup"
                              disabled={addedFollowupIds.has(handoff.id)}
                              onClick={() => handleAddFollowup(handoff)}
                            >
                              {addedFollowupIds.has(handoff.id)
                                ? t.lite2.followupAdded
                                : t.lite2.triageAddFollowupLabel}
                            </button>
                            <a className="lite-triage-draftmail" href={draftMailForHandoff(handoff)}>
                              {t.lite2.triageDraftMailLabel}
                            </a>
                            <button
                              type="button"
                              className="home-discard"
                              onClick={() => discardTriage(handoff.id)}
                            >
                              {t.lite2.triageDiscardLabel}
                            </button>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="lite-handoffs-empty">
                    {totalHandoffs > 0 ? t.lite2.triageAllDone : t.lite2.handoffsEmpty}
                  </p>
                )}

                {handled.length + setAside.length > 0 ? (
                  <section className="home-drawer">
                    <button
                      type="button"
                      className="home-drawer-toggle"
                      aria-expanded={drawerOpen}
                      onClick={() => setDrawerOpen((open) => !open)}
                    >
                      {t.lite2.triageDrawerLabel} · {handled.length}
                      {setAside.length > 0 ? ` · ${setAside.length} ${t.lite2.triageSetAsideLabel}` : ''}
                      <span aria-hidden="true">{drawerOpen ? '▴' : '▾'}</span>
                    </button>
                    {drawerOpen ? (
                      <ul className="home-drawer-list">
                        {handled.map((handoff) => (
                          <li key={handoff.id}>
                            <span className="home-drawer-item">{handoff.action}</span>
                            <button type="button" onClick={() => restoreTriage(handoff.id)}>
                              {t.lite2.triageRestoreLabel}
                            </button>
                          </li>
                        ))}
                        {setAside.map((handoff) => (
                          <li key={handoff.id} className="is-set-aside">
                            <span className="home-drawer-item">{handoff.action}</span>
                            <button type="button" onClick={() => restoreTriage(handoff.id)}>
                              {t.lite2.triageRestoreLabel}
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </section>
                ) : null}
              </>
            ) : (
              /* ── 上传空态：live 自己的引导文案，零 scripted 占位 ── */
              <header className="home-greeting lite-empty-greeting">
                <p className="eyebrow">{t.lite2.emptyEyebrow}</p>
                <h1>{t.team.emptyTitle}</h1>
                <p className="home-greeting-sub">{t.team.emptyBody}</p>
                {/* feat-050 · 会话不丢：有存下的 contextId 时，先说"正在取回"，别让人对着
                    上传引导以为数据没了。取不回来（且非 404）就一行说明 + 重试，不堆红字；
                    404 走干净空态（下面的默认分支）——context 真没了，上传引导就是诚实答案。 */}
                {restoring ? (
                  <p className="lite-empty-restoring" aria-live="polite">
                    {t.lite2.restoringLabel}
                  </p>
                ) : restoreError ? (
                  <div className="lite-empty-restore-failed" aria-live="polite">
                    <p className="lite-empty-restore-note">{t.lite2.restoreFailed}</p>
                    <p className="lite-empty-restore-detail">{restoreError}</p>
                    <button
                      type="button"
                      className="lite-empty-restore-retry"
                      onClick={() => void restoreSession()}
                    >
                      {t.lite2.restoreRetry}
                    </button>
                  </div>
                ) : (
                  <ul className="lite-empty-hints">
                    <li>{t.lite2.emptyHintRoster}</li>
                    <li>{t.lite2.emptyHintProject}</li>
                    <li>{t.lite2.emptyHintPrivacy}</li>
                  </ul>
                )}
              </header>
            )}
          </div>

          {/* ── 右栏：空态 = 上传；上传后 = 双轨卡带（上传入口保留可加文件）── */}
          {team ? (
            <div className="home-lanes">
              <UploadPanel />
              <div className="home-lanes-head">
                <p className="eyebrow">{t.lite2.peopleLane}</p>
                <p className="eyebrow home-people-group-caption">{t.lite2.groupAllLabel}</p>
              </div>
              {/* feat-025 Q2：轻量分组视图——按部门/项目归属/角色聚类，带分组容器 + 折叠。
                  人卡本身零改（.home-person-card 仍在 DOM、仍可点，门相位 C/E 不受影响）。 */}
              <div className="home-people-groups" aria-label={t.lite2.peopleLane}>
                {groupPeople(team.people, team.projects, t.lite2.groupUngrouped).map((group) => (
                  <PeopleGroup
                    key={group.key}
                    title={group.title}
                    people={group.people}
                    onOpen={(id) => openDetail('person', id)}
                  />
                ))}
              </div>

              <p className="eyebrow home-lane-label">{t.lite2.projectLane}</p>
              <div className="home-lane home-lane-projects" aria-label={t.lite2.projectLane}>
                {team.projects.map((project) => (
                  <button
                    key={project.id}
                    type="button"
                    className={classNames([
                      'home-project-card',
                      statusTone(project.status) && `edge-${project.status}`,
                    ])}
                    onClick={() => openDetail('project', project.id)}
                    aria-label={`Open ${project.title}`}
                  >
                    <span className="home-project-row">
                      <h3>{project.title}</h3>
                      <span className="home-project-status">
                        <span className={`status-dot ${statusTone(project.status)}`} />
                        {project.status}
                      </span>
                    </span>
                    {typeof project.progress === 'number' ? (
                      <span className="home-project-strip-row" aria-hidden="true">
                        <span className={`project-strip ${progressBand(project.progress)}`}>
                          <span
                            className="project-strip-fill"
                            style={{ width: `${project.progress}%` }}
                          />
                        </span>
                      </span>
                    ) : null}
                    <span className="home-project-meta">
                      <span>{project.ownerName}</span>
                      {project.dueDate ? <span className="home-project-due">{project.dueDate}</span> : null}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="home-lanes home-lanes-live-empty">
              <UploadPanel />
            </div>
          )}
        </div>
      </div>

      <LiteComposer />
    </section>
  )
}
