import { useMemo, useState } from 'react'
import { useLite } from '../store'
import { useDict } from '../../shared/i18n/useDict'
import { localizeBriefing } from '../../shared/briefing'
import { localizeHandoff, localizePersonRead } from '../../shared/handoffCopy'
import { projectStatusText } from '../../shared/projectStatus'
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

function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''))
}

// 单张人卡（分组视图与兜底 flat 视图共用）。🔴 红线：永不渲染任何数字/评分/排名。
function PersonCard({
  person,
  onOpen,
}: {
  person: LitePerson
  onOpen: (id: string) => void
}) {
  const { t } = useDict()
  // feat-068 · 读数在这里才成句（派生层只给语料原文 + owns 条目）。localizePersonRead 恒返回
  // 非空串——无信号时走 personReadNone 兜底，所以不再需要 person.read 的空值分支。
  const read = localizePersonRead(person, t.lite)
  return (
    <button
      type="button"
      className={classNames(['home-person-card', `home-tone-${person.tone}`])}
      onClick={() => onOpen(person.id)}
      // feat-068 · aria-label 以前是 `Open ${name}` 的硬编码拼接——中文屏幕阅读器会念出英文
      // 动词。整句模板 + 占位符，语序交给各语言自己定。
      aria-label={fill(t.lite.personCardOpenAria, { name: person.name, read })}
    >
      <InitialAvatar name={person.name} size={44} className="home-person-avatar" />
      <span className="home-person-body">
        <h3>{person.name}</h3>
        <p className="home-person-role">{person.role}</p>
        <p className="home-person-read">{read}</p>
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
  const countLabel = people.length === 1 ? t.lite.groupCountOne : t.lite.groupCountMany
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
          {open ? t.lite.groupCollapse : t.lite.groupExpand}
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
  const { t, locale } = useDict()
  const team = useLite((s) => s.team)
  const openDetail = useLite((s) => s.openDetail)

  // feat-068 · 后端 briefing() 只会说英文（registry.py 里三处字面量写死，无 locale 参数，
  // 线上镜像不许重建）。中文构建下在这里本地重组；EN 下原样透传，视觉零变化。
  // 详见 src/shared/briefing.ts 顶部——请不要"顺手"把这层删掉。
  const briefing = useMemo(
    () => (team ? localizeBriefing(team.briefing, team, t.lite, locale) : null),
    [team, t, locale],
  )

  // feat-068 · 分诊条目的文案层（ZH-02）。teamData.ts 的 liveHandoffs() 现在只吐结构化信号，
  // 成句在这里按当前字典拼——详见 src/shared/handoffCopy.ts 顶部。
  const handoffs = useMemo(
    () => (team?.handoffs ?? []).map((h) => localizeHandoff(h, t.lite)),
    [team, t],
  )

  return (
    <section className="scene scene-home is-active" aria-label={t.lite.teamLiveAria}>
      <div className="home-scroll">
        <div className="home-frame">
          {/* ── 左脊柱 ─────────────────────────────────────────────── */}
          <div className="home-spine">
            {team && briefing ? (
              <>
                <header className="home-greeting">
                  <p className="eyebrow">{t.lite.briefingEyebrow}</p>
                  <h1>{briefing.headline}</h1>
                  <p className="home-greeting-sub">{briefing.subhead}</p>
                  {briefing.metrics.length > 0 ? (
                    <div className="lite-metrics" aria-label={t.lite.metricsLabel}>
                      {briefing.metrics.map((m) => (
                        <span key={m.label} className="lite-metric-chip">
                          <strong>{m.value}</strong> {m.label}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </header>

                <div className="home-spine-head">
                  <h2>{t.lite.handoffsTitle}</h2>
                </div>

                {handoffs.length > 0 ? (
                  <ol className="home-handoff-list">
                    {handoffs.map((handoff) => (
                      <li
                        key={handoff.id}
                        className={classNames(['home-handoff', `home-tone-${handoff.tone}`])}
                      >
                        <div className="home-handoff-body">
                          {/* feat-068 · is-cjk：基线样式给这行加了 text-transform:uppercase +
                              0.14em 字距（英文小标签的排版语言）。中文没有大小写，宽字距只会
                              读成"喊话"，所以中文构建下关掉大写、收紧字距。 */}
                          <span
                            className={classNames([
                              'home-handoff-tone',
                              locale === 'zh' && 'is-cjk',
                            ])}
                          >
                            {handoff.toneLabel}
                          </span>
                          <h3>{handoff.action}</h3>
                          <p>{handoff.evidence}</p>
                          <div className="home-handoff-links">
                            <button
                              type="button"
                              className="home-map-card-link"
                              onClick={() => openDetail('project', handoff.projectIds[0])}
                            >
                              {t.lite.handoffOpen} →
                            </button>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="lite-handoffs-empty">{t.lite.handoffsEmpty}</p>
                )}
              </>
            ) : (
              /* ── 上传空态：live 自己的引导文案，零 scripted 占位 ── */
              <header className="home-greeting lite-empty-greeting">
                <p className="eyebrow">{t.lite.emptyEyebrow}</p>
                <h1>{t.team.emptyTitle}</h1>
                <p className="home-greeting-sub">{t.team.emptyBody}</p>
                <ul className="lite-empty-hints">
                  <li>{t.lite.emptyHintRoster}</li>
                  <li>{t.lite.emptyHintProject}</li>
                  <li>{t.lite.emptyHintPrivacy}</li>
                </ul>
              </header>
            )}
          </div>

          {/* ── 右栏：空态 = 上传；上传后 = 双轨卡带（上传入口保留可加文件）── */}
          {team ? (
            <div className="home-lanes">
              <UploadPanel />
              <div className="home-lanes-head">
                <p className="eyebrow">{t.lite.peopleLane}</p>
                <p className="eyebrow home-people-group-caption">{t.lite.groupAllLabel}</p>
              </div>
              {/* feat-025 Q2：轻量分组视图——按部门/项目归属/角色聚类，带分组容器 + 折叠。
                  人卡本身零改（.home-person-card 仍在 DOM、仍可点，门相位 C/E 不受影响）。 */}
              <div className="home-people-groups" aria-label={t.lite.peopleLane}>
                {groupPeople(
                  team.people,
                  team.projects,
                  t.lite.groupUngrouped,
                  t.lite.groupOwns,
                ).map((group) => (
                  <PeopleGroup
                    key={group.key}
                    title={group.title}
                    people={group.people}
                    onOpen={(id) => openDetail('person', id)}
                  />
                ))}
              </div>

              <p className="eyebrow home-lane-label">{t.lite.projectLane}</p>
              <div className="home-lane home-lane-projects" aria-label={t.lite.projectLane}>
                {team.projects.map((project) => (
                  <button
                    key={project.id}
                    type="button"
                    className={classNames([
                      'home-project-card',
                      statusTone(project.status) && `edge-${project.status}`,
                    ])}
                    onClick={() => openDetail('project', project.id)}
                    aria-label={fill(t.lite.projectsOpenAria, { title: project.title })}
                  >
                    <span className="home-project-row">
                      <h3>{project.title}</h3>
                      <span className="home-project-status">
                        <span className={`status-dot ${statusTone(project.status)}`} />
                        {projectStatusText(project.status, t.lite)}
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
                      <span>{project.ownerName || t.lite.projectsUnknownValue}</span>
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
