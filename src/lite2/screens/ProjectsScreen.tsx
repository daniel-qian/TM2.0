import { useMemo } from 'react'
import { useLite } from '../store'
import { useDict } from '../../shared/i18n/useDict'
import {
  buildProjectViews,
  groupProjects,
  projectCoverage,
  projectStatusLabel,
  type ProjectGroupKey,
  type ProjectStatusKey,
  type ProjectView,
} from '../projectView'
import type { Dict } from '../../shared/i18n'

// feat-055（PRD G9）· lite2 屏 8：项目屏（整屏新建）。
//
// ## 为什么有这一屏
// 差异清单里最大的结构缺口——我们根本没有项目屏，真项目只能混在「你的团队」右栏当卡片。
// 三家外部公司会拿自己的项目文档来试，看不到项目屏说不过去。
//
// ## 🔴 本屏的核心不是布局，是「未知」态
// 真 payload 的覆盖率：title/summary 17/17 · owner 16/17 · status/blockers 13/17 ·
// **dueDate 7/17 · progress 6/17**。进度和到期只有三分之一有值。任何把缺失渲染成 `0%`、
// 空进度条或空白格的写法，都是在替客户的文档说「这事没进展」——当着他自己的文件的面撒谎。
// 所以：进度未知时**根本不画条**（不是画一条 0 宽的），到期/负责人/状态未知时显式写出
// 「文档未提及」。判据全在 `projectView.ts`（那里也解释了为什么读 rawTeam 而不是 team）。
//
// ## 布局为什么不是固定看板栏
// 离线 heuristic 抽取路径目前每篇文档只吐 1 个项目（`_projects_from_doc` 的结构性缺陷，
// 与 H4 同源，feat-054 的粒度门只覆盖 LLM 路径），所以「只有 1 个项目」甚至「0 个项目」
// 是**必然会被真实用户撞到的常态**，不是边角情况。固定三栏看板在 1 个项目时会剩两条空栏
// （看着像坏了），所以这里用「非空分组 + 自适应卡片网格」：一个项目就是一组一张卡，
// 零个项目走诚实空态。🔴 绝不画假的骨架卡撑版面。
//
// 不做（PRD G9 明确）：里程碑、成员历史时间线——我们没有这两样数据。
// 🔴 零写死数据：屏头那几个数字（项目总数、多少个没写进度/到期/状态）全是当场真算的。

type Lite2Dict = Dict['lite2']

function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''))
}

function classNames(parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ')
}

// 状态语气色。沿用既有 tone-* / edge-* 语法（与「你的团队」项目卡同一套族色）。
// 🔴 「文档没写状态」永远是中性的——不给它染成绿色（那是在替文档说"没事"）。
// unknown 给自己的 tone-unknown（中性灰）：不给 tone class 时 `.status-dot` 落回
// 默认 sage/绿——那正是 on-track 的颜色，「不知道」绝不能和它撞色。
function statusTone(statusKey: ProjectStatusKey): string {
  if (statusKey === 'blocked') return 'tone-danger'
  if (statusKey === 'at-risk') return 'tone-warning'
  if (statusKey === 'unknown') return 'tone-unknown'
  return ''
}

// edge 左缘只染「需要经理出手」的两档——on-track/done/未知一律不上色。单独算，
// 不与 statusTone 共用同一个真值判断：unknown 现在也有非空 tone，不能再用
// `tone && edge-${statusKey}` 这种耦合写法，否则会顺带画出一条 `edge-unknown` 边。
function statusEdgeClass(statusKey: ProjectStatusKey): string | null {
  if (statusKey === 'blocked') return 'edge-blocked'
  if (statusKey === 'at-risk') return 'edge-at-risk'
  return null
}

function groupLabel(key: ProjectGroupKey, l: Lite2Dict): string {
  switch (key) {
    case 'needsYou':
      return l.projectsGroupNeedsYou
    case 'moving':
      return l.projectsGroupMoving
    case 'done':
      return l.projectsGroupDone
    case 'unknown':
      return l.projectsGroupUnknown
    default:
      return l.projectsGroupOther
  }
}

// 一行「标签 · 值」。值为 null 即渲染「文档未提及」，并挂 is-unknown 让它视觉上明确是
// 缺信息（弱化、斜体），而不是一个正常的值。
function FactRow({
  label,
  value,
  unknownLabel,
}: {
  label: string
  value: string | null
  unknownLabel: string
}) {
  const known = value !== null
  return (
    <span className={classNames(['lite-project-fact', !known && 'is-unknown'])}>
      <span className="lite-project-fact-label">{label}</span>
      <span className="lite-project-fact-value">{known ? value : unknownLabel}</span>
    </span>
  )
}

function ProjectCard({ view, onOpen }: { view: ProjectView; onOpen: (id: string) => void }) {
  const { t } = useDict()
  const l = t.lite2
  const tone = statusTone(view.statusKey)
  const blockerCount = view.blockers.length

  return (
    <button
      type="button"
      className={classNames([
        'lite-project-card',
        statusEdgeClass(view.statusKey),
        view.statusKey === 'unknown' && 'is-status-unknown',
      ])}
      data-project-id={view.id}
      onClick={() => onOpen(view.id)}
      aria-label={fill(l.projectsOpenAria, { title: view.title })}
    >
      <span className="lite-project-card-head">
        <h3 className="lite-project-title">{view.title}</h3>
        <span className={classNames(['lite-project-status', view.statusKey === 'unknown' && 'is-unknown'])}>
          <span className={classNames(['status-dot', tone])} aria-hidden="true" />
          {projectStatusLabel(view, l)}
        </span>
      </span>

      {view.summary ? <p className="lite-project-summary">{view.summary}</p> : null}

      <span className="lite-project-facts">
        <FactRow
          label={l.projectsOwnerLabel}
          value={view.ownerName}
          unknownLabel={l.projectsUnknownValue}
        />
        <FactRow
          label={l.projectsDueLabel}
          value={view.dueDate}
          unknownLabel={l.projectsUnknownValue}
        />
      </span>

      {/* 🔴 进度：有值才画条。未知时画的不是 0% 的条，而是一行「文档未提及」——
          一条 0 宽的进度条和「文档没写」在屏幕上长得一模一样，那正是本条要避免的谎。 */}
      {view.progress !== null ? (
        <span className="lite-project-progress">
          <span className="lite-project-progress-row">
            <span className="lite-project-fact-label">{l.projectsProgressLabel}</span>
            <span className="lite-project-progress-value">{view.progress}%</span>
          </span>
          <span className="lite-project-progress-track" aria-hidden="true">
            <span className="lite-project-progress-fill" style={{ width: `${view.progress}%` }} />
          </span>
        </span>
      ) : (
        <span className="lite-project-progress">
          <FactRow
            label={l.projectsProgressLabel}
            value={null}
            unknownLabel={l.projectsUnknownValue}
          />
        </span>
      )}

      {blockerCount > 0 ? (
        <span className="lite-project-blockers">
          <span className="lite-project-blocker-count">
            {blockerCount === 1
              ? l.projectsBlockersOne
              : fill(l.projectsBlockersMany, { count: blockerCount })}
          </span>
          <span className="lite-project-blocker-first">{view.blockers[0]}</span>
        </span>
      ) : null}
    </button>
  )
}

export function ProjectsScreen() {
  const { t } = useDict()
  const l = t.lite2
  // 🔴 读 rawTeam：`LiteProject` 上的 status/ownerName 是**渲染文案**（历史上更糟——曾是
  // `status ?? 'on-track'` / `ownerName ?? 'Unassigned'` 这种编出来的值）。判已知/未知只认
  // 原始 payload（见 projectView.ts 的说明）。
  const rawTeam = useLite((s) => s.rawTeam)
  const openDetail = useLite((s) => s.openDetail)
  const goScreen = useLite((s) => s.goScreen)
  // feat-050 · 会话不丢：空态要分清「正在取回上次会话」和「真没有会话」（与 TeamScreen 同口径）。
  const restoring = useLite((s) => s.restoring)
  const restoreError = useLite((s) => s.restoreError)
  const restoreSession = useLite((s) => s.restoreSession)

  const views = useMemo(
    () => buildProjectViews(rawTeam?.projects, rawTeam?.people),
    [rawTeam],
  )
  const groups = useMemo(() => groupProjects(views), [views])
  const coverage = useMemo(() => projectCoverage(views), [views])

  const hasCoverageGap =
    coverage.missingProgress > 0 || coverage.missingDueDate > 0 || coverage.missingStatus > 0

  return (
    <section className="scene scene-nexus is-active lite-projects" aria-label={l.tabProjects}>
      <div className="lite-projects-scroll">
        <div className="lite-projects-frame">
          <header className="lite-projects-header">
            <p className="eyebrow">{l.projectsEyebrow}</p>
            <h1>{l.projectsTitle}</h1>
            <p className="lite-projects-lede">{l.projectsLede}</p>
            {views.length > 0 ? (
              <p className="lite-projects-count">
                {views.length === 1
                  ? l.projectsCountOne
                  : fill(l.projectsCountMany, { count: views.length })}
              </p>
            ) : null}
          </header>

          {/* 覆盖率实况。数字当场真算（projectCoverage），不是写死的统计句。
              一个缺口都没有时整块不渲染——没缺口就没必要念这段。 */}
          {views.length > 0 && hasCoverageGap ? (
            <section className="lite-projects-coverage" aria-label={l.projectsCoverageTitle}>
              <p className="eyebrow lite-projects-coverage-title">{l.projectsCoverageTitle}</p>
              <ul className="lite-projects-coverage-list">
                {coverage.missingProgress > 0 ? (
                  <li>{fill(l.projectsCoverageProgress, { count: coverage.missingProgress })}</li>
                ) : null}
                {coverage.missingDueDate > 0 ? (
                  <li>{fill(l.projectsCoverageDue, { count: coverage.missingDueDate })}</li>
                ) : null}
                {coverage.missingStatus > 0 ? (
                  <li>{fill(l.projectsCoverageStatus, { count: coverage.missingStatus })}</li>
                ) : null}
              </ul>
              <p className="lite-projects-coverage-note">{l.projectsCoverageNote}</p>
            </section>
          ) : null}

          {/* 只有 1 个项目：说清楚这可能是抽取粒度而不是「你只有一个项目」，并给可操作建议。
              离线 heuristic 路径每篇文档只吐 1 个，这是真实用户会撞到的常态。 */}
          {views.length === 1 ? (
            <p className="lite-projects-single-note">{l.projectsSingleNote}</p>
          ) : null}

          {views.length > 0 ? (
            groups.map((group) => (
              <section
                key={group.key}
                className="lite-projects-group"
                data-project-group={group.key}
                aria-label={groupLabel(group.key, l)}
              >
                <p className="eyebrow lite-projects-group-title">
                  {groupLabel(group.key, l)}
                  <span className="lite-projects-group-count">{group.views.length}</span>
                </p>
                <div className="lite-projects-grid">
                  {group.views.map((view) => (
                    <ProjectCard
                      key={view.id}
                      view={view}
                      onOpen={(id) => openDetail('project', id)}
                    />
                  ))}
                </div>
              </section>
            ))
          ) : (
            /* 0 个项目的诚实空态：不摆骨架卡、不摆假分组栏。 */
            <section className="lite-projects-empty" aria-label={l.projectsEmptyAria}>
              {restoring ? (
                <p className="lite-projects-restoring" aria-live="polite">
                  {l.restoringLabel}
                </p>
              ) : restoreError ? (
                <div className="lite-projects-restore-failed" aria-live="polite">
                  <p>{l.restoreFailed}</p>
                  <p className="lite-projects-restore-detail">{restoreError}</p>
                  <button type="button" className="lite-btn lite-btn--ghost" onClick={() => void restoreSession()}>
                    {l.restoreRetry}
                  </button>
                </div>
              ) : (
                <>
                  <h2>{l.projectsEmptyTitle}</h2>
                  <p>{l.projectsEmptyBody}</p>
                  {/* 上传入口住在「你的团队」——这里不复制一个上传面板，只把人送过去。 */}
                  <button
                    type="button"
                    className="lite-btn lite-btn--primary lite-projects-empty-cta"
                    onClick={() => goScreen('team')}
                  >
                    {l.projectsEmptyCta} →
                  </button>
                </>
              )}
            </section>
          )}
        </div>
      </div>
    </section>
  )
}
