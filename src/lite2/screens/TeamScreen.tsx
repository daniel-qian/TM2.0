import { useState } from 'react'
import { useLite } from '../store'
import { useDict } from '../../shared/i18n/useDict'
import { UploadPanel } from '../UploadPanel'
import { InitialAvatar } from '../InitialAvatar'
import { LiteComposer } from '../LiteComposer'
import { groupPeople } from '../teamGroups'
import type { LitePerson } from '../teamData'

// feat-024 · lite 屏 1+2：上传空态 · Your team——ADR-0022 决策 1。
// 空态：左脊柱是 live 自己的引导文案（不渲染任何 scripted 占位——story 渗漏的第一现场）；
// 右栏 = 上传。上传后：briefing 真数顶栏（人数/项目数来自 ingestion，聚合数字 R2 真算才显）
// + 人卡/项目卡双轨 + 弱 handoffs（只从项目 blocker 派生，缺信号不造）。
// 🔴 红线：人卡永不渲染任何数字——LitePerson 类型层就没有评分键的位置。

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
                </div>

                {team.handoffs.length > 0 ? (
                  <ol className="home-handoff-list">
                    {team.handoffs.map((handoff) => (
                      <li
                        key={handoff.id}
                        className={classNames(['home-handoff', `home-tone-${handoff.tone}`])}
                      >
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
                          </div>
                        </div>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="lite-handoffs-empty">{t.lite2.handoffsEmpty}</p>
                )}
              </>
            ) : (
              /* ── 上传空态：live 自己的引导文案，零 scripted 占位 ── */
              <header className="home-greeting lite-empty-greeting">
                <p className="eyebrow">{t.lite2.emptyEyebrow}</p>
                <h1>{t.team.emptyTitle}</h1>
                <p className="home-greeting-sub">{t.team.emptyBody}</p>
                <ul className="lite-empty-hints">
                  <li>{t.lite2.emptyHintRoster}</li>
                  <li>{t.lite2.emptyHintProject}</li>
                  <li>{t.lite2.emptyHintPrivacy}</li>
                </ul>
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
