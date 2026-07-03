import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { AnimatePresence, motion, useReducedMotion, type Transition } from 'framer-motion'
import type { ReactZoomPanPinchRef } from 'react-zoom-pan-pinch'
import {
  DASHBOARD_TAGS,
  PEOPLE,
  PROJECTS,
  SIGNALS,
  type Person,
  type Project,
  type ProjectRisk,
} from '../../data/fixtures'
import { PERSON_POS, PROJECT_POS, TEAM_ZONES, type Pos } from '../../data/layout'
import { bboxOf } from '../../data/board'
import {
  dashboardPersonCopy,
  dashboardProjectCopy,
  type DetailPhase,
} from '../../data/fixtures.p3'
import { focusEntity, focusSearch, focusTags } from '../../lib/focus'
import { SvgEdgeLayer } from '../SvgEdgeLayer'
import { PanZoomCanvas } from '../PanZoomCanvas'
import { useRailCamera, type CameraTarget, type SafeInsets } from '../../lib/useRailCamera'
import { PixelAvatar } from '../PixelAvatar'
import { useCanvas, type Focus } from '../../store/canvasStore'

// world 对象的估算半宽/半高（board px），仅供镜头算包围盒。
// 修订 5：person = 名册圆点（avatar 圆 + 名牌），project = 横条（calm 即全卡后更高）。
const PERSON_HALF = { w: 80, h: 78 }
const PROJECT_HALF = { w: 360, h: 78 }

// 项目 focus 态的风险分布图（world 对象）：贴在被 focus 项目条右侧，回 calm 即消失。
const RISK_CHART_LEFT = 1958 // 图左缘 x（条右缘 1920 + 38 间隙）
const RISK_CHART_CENTER_X = 2128
const RISK_CHART_HALF = { w: 180, h: 145 }

const RISK_DIMS: Array<{ key: keyof ProjectRisk; label: string; color: string }> = [
  { key: 'progress', label: 'Progress', color: 'rgba(105, 128, 109, 0.85)' }, // sage
  { key: 'blockers', label: 'Blockers', color: 'rgba(188, 92, 73, 0.85)' }, // terracotta
  { key: 'staffing', label: 'Staffing', color: 'rgba(178, 123, 43, 0.85)' }, // honey
  { key: 'quality', label: 'Quality', color: 'rgba(82, 123, 145, 0.85)' }, // sky
]

// Dashboard inset（修订 3）：full-bleed——近零 inset 让 glance map 填满整屏；HUD（briefing/alerts/
// composer）作为可叠放角落 chrome 浮在地图边角之上。只留够清 Topbar/tag 条与 composer 的薄边。
const DASHBOARD_INSETS: SafeInsets = { top: 76, right: 28, bottom: 112, left: 28 }

// feat-014（ADR-0017）：composer / briefing HUD 已随主场迁往 HomeScene（TeamComposer 组件）；
// 本页 = Team map 全景子视图——纯地图 + tags/search + alert pills + 风险图。

// board 绝对坐标（修订 2：world 对象 board px only，禁 clamp/vw）。
function nodeStyle(pos: Pos) {
  return { left: `${pos.x}px`, top: `${pos.y}px`, x: '-50%', y: '-50%' }
}

function statusTone(status: string) {
  if (status === 'blocked') return 'tone-danger'
  if (status === 'at-risk') return 'tone-warning'
  return ''
}

// 卡根节点专用 tone 类。不能复用 tone-warning/tone-danger——那是给 status-dot 等
// 小元素的通用类，自带 background: var(--honey/terracotta)，挂到卡根会整卡涂色。
function riskToneClass(status: string) {
  if (status === 'blocked') return 'risk-danger'
  if (status === 'at-risk') return 'risk-warning'
  return ''
}

// 进度条按百分比分档着色（与 status 解耦）：<40 低档红、40–69 中档琥珀、≥70 高档绿。
function progressBand(progress: number) {
  if (progress < 40) return 'strip-low'
  if (progress < 70) return 'strip-mid'
  return 'strip-high'
}

// 个人节点 tone（修订：不再给单人贴血条/数值）。只保留一个安静的定性强调——
// 谁这周值得搭把手——绝不显示 HP/MP/load 数字。capacityPct 仍是内部判据，但不外显。
function personTone(person: Person) {
  const load = person.capacityPct ?? 100
  if (load >= 120) return 'tone-warning'
  return 'tone-stable'
}

// ── 团队级柔性信号（创始人拍板：不量化个人，改集体、人味的读数）──────────────
// 一个团队整体这周的节奏，由该组所有人的负载/心气聚合而来。措辞像前辈在描述
// 一个组的处境，而不是给谁打分；不并列任何单人数值。
function teamPace(team: string): { read: string; tone: string } | null {
  const members = PEOPLE.filter((p) => p.team === team)
  if (members.length === 0) return null
  const avgLoad =
    members.reduce((sum, p) => sum + (p.capacityPct ?? 100), 0) / members.length
  const avgMood = members.reduce((sum, p) => sum + p.moodPct, 0) / members.length
  const stretched = members.filter((p) => (p.capacityPct ?? 100) >= 120).length

  if (avgLoad >= 110 || stretched >= 2) {
    return { read: 'Stretched thin this week', tone: 'tone-warning' }
  }
  if (avgLoad >= 95 || avgMood < 60) {
    return { read: 'Carrying a full load', tone: 'tone-stable' }
  }
  if (avgLoad < 78) {
    return { read: 'Room to take more on', tone: 'tone-stable' }
  }
  return { read: 'Finding a steady rhythm', tone: 'tone-stable' }
}

function ownerName(project: Project) {
  return PEOPLE.find((p) => p.id === project.ownerId)?.name ?? 'Unassigned'
}

function isPrimary(focus: Focus | null, kind: 'person' | 'project', id: string) {
  return focus?.primary?.kind === kind && focus.primary.id === id
}

function isRelated(focus: Focus | null, kind: 'person' | 'project', id: string) {
  if (!focus) return false
  return kind === 'person' ? focus.personIds.includes(id) : focus.projectIds.includes(id)
}

function classNames(parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ')
}

// P1：Calm = low-density map. Focus = one resolved relatedness set from lib/focus.ts.
export function DashboardScene() {
  const focus = useCanvas((s) => s.focus)
  const setFocus = useCanvas((s) => s.setFocus)
  const openDetail = useCanvas((s) => s.openDetail)
  const goScene = useCanvas((s) => s.goScene)
  const briefing = useCanvas((s) => s.briefing)
  const prefersReducedMotion = useReducedMotion()
  const [searchQuery, setSearchQuery] = useState('')

  const dashboardPhase: DetailPhase = briefing.version === 2 ? 'grown' : 'believed'
  const hasFocus = Boolean(focus)
  const selectedTagIds = focus?.source === 'tag' ? focus.selector?.tags ?? [] : []
  const transition: Transition = prefersReducedMotion
    ? { duration: 0 }
    : { duration: 0.28, ease: [0.16, 1, 0.3, 1] }

  const alertPills = useMemo(() => {
    const hotspotSignals = SIGNALS.filter((s) => s.subjectId === 'p_connector')
    return [
      {
        id: 'connector-hotspot',
        label: 'Worth a look',
        title: 'The core guide flow has more churn than the status let on', // ⚠ 待 Danny 审字
        detail: `${hotspotSignals.length} things worth checking`,
        projectId: 'p_connector',
      },
      {
        id: 'acme-risk',
        label: 'Keep an eye on',
        title: 'The demo is leaning on the core guide flow to make Friday', // ⚠ 待 Danny 审字
        detail: 'Friday is getting tight',
        projectId: 'p_acme',
      },
    ]
  }, [])

  // focus 项目 → 风险分布图（world 对象，贴条右侧；回 calm 消失）。
  const riskProject = useMemo(() => {
    if (focus?.primary?.kind !== 'project') return null
    return PROJECTS.find((p) => p.id === focus.primary?.id) ?? null
  }, [focus])

  // ── rail 派生镜头（ADR-0012 决策 4）：calm = 全图 fit；focus = 飞向关联簇局部 bbox。──
  const camRef = useRef<ReactZoomPanPinchRef | null>(null)

  const cameraTarget = useMemo<CameraTarget | null>(() => {
    const items: Array<{ pos: Pos; halfW: number; halfH: number }> = []
    if (!focus) {
      PEOPLE.forEach((p) => {
        const pos = PERSON_POS[p.id]
        if (pos) items.push({ pos, halfW: PERSON_HALF.w, halfH: PERSON_HALF.h })
      })
      PROJECTS.forEach((p) => {
        const pos = PROJECT_POS[p.id]
        if (pos) items.push({ pos, halfW: PROJECT_HALF.w, halfH: PROJECT_HALF.h })
      })
      // 修订 6：calm = fit-width 顶锚可读帧（宽度装满，下方组允许出帧、靠 pan 到达）。
      const bbox = bboxOf(items)
      return bbox ? { bbox, mode: 'width-top' } : null
    }
    const personIds = new Set(focus.personIds)
    if (focus.primary?.kind === 'person') personIds.add(focus.primary.id)
    const projectIds = new Set(focus.projectIds)
    if (focus.primary?.kind === 'project') projectIds.add(focus.primary.id)
    personIds.forEach((id) => {
      const pos = PERSON_POS[id]
      if (pos) items.push({ pos, halfW: PERSON_HALF.w, halfH: PERSON_HALF.h })
    })
    projectIds.forEach((id) => {
      const pos = PROJECT_POS[id]
      if (pos) items.push({ pos, halfW: PROJECT_HALF.w, halfH: PROJECT_HALF.h })
    })
    // 项目为 primary 时，风险分布图也算进取景 bbox。
    if (focus.primary?.kind === 'project') {
      const pos = PROJECT_POS[focus.primary.id]
      if (pos) {
        items.push({
          pos: { x: RISK_CHART_CENTER_X, y: pos.y },
          halfW: RISK_CHART_HALF.w,
          halfH: RISK_CHART_HALF.h,
        })
      }
    }
    const bbox = bboxOf(items)
    return bbox ? { bbox } : null
  }, [focus])

  const cameraKey = useMemo(() => {
    if (!focus) return 'calm'
    return `${focus.source}|${[...focus.personIds].sort().join(',')}|${[...focus.projectIds]
      .sort()
      .join(',')}|${focus.primary?.id ?? ''}`
  }, [focus])

  useRailCamera(camRef, cameraTarget, DASHBOARD_INSETS, cameraKey, { maxFitScale: 1.05 })

  useEffect(() => {
    if (focus?.source === 'search') {
      setSearchQuery(focus.selector?.query ?? '')
    } else {
      setSearchQuery('')
    }
  }, [focus])

  function stopPropagation(event: MouseEvent) {
    event.stopPropagation()
  }

  function clearFocus() {
    setFocus(null)
    setSearchQuery('')
  }

  function handleTagClick(tagId: string) {
    const next = selectedTagIds.includes(tagId)
      ? selectedTagIds.filter((id) => id !== tagId)
      : [...selectedTagIds, tagId]
    setFocus(next.length > 0 ? focusTags(next) : null)
  }

  function handleSearchChange(value: string) {
    setSearchQuery(value)
    setFocus(value.trim() ? focusSearch(value) : null)
  }

  function handleNodeClick(kind: 'person' | 'project', id: string) {
    if (isPrimary(focus, kind, id)) {
      openDetail(kind === 'person' ? 'employee' : 'project', id)
      return
    }
    setFocus(focusEntity(kind, id))
  }

  return (
    <section
      className={classNames([
        'scene scene-dashboard is-active',
        hasFocus && 'has-focus',
      ])}
      aria-label="Your team"
      onClick={clearFocus}
    >
      <PanZoomCanvas ref={camRef}>
        <div className="canvas-grid board-surface" aria-hidden="true" />
        <SvgEdgeLayer />

        <div className="zone-label-layer">
          {TEAM_ZONES.map((zone) => {
            const pace = teamPace(zone.team)
            return (
              <span
                key={zone.team}
                className="team-zone-label"
                style={{ left: `${zone.labelPos.x}px`, top: `${zone.labelPos.y}px` }}
              >
                <span className="team-zone-name" aria-hidden="true">
                  {zone.label}
                </span>
                {pace ? (
                  <span
                    className={classNames(['team-zone-pace', pace.tone])}
                    aria-label={`${zone.label} — ${pace.read}`}
                  >
                    {pace.read}
                  </span>
                ) : null}
              </span>
            )
          })}
        </div>

      <div className="people-layer" aria-label="People orbit">
        {PEOPLE.map((person) => {
          const pos = PERSON_POS[person.id]
          if (!pos) return null
          const cardCopy = dashboardPersonCopy(person, dashboardPhase)
          const related = isRelated(focus, 'person', person.id)
          const primary = isPrimary(focus, 'person', person.id)
          const muted = hasFocus && !related
          return (
            <motion.button
              key={person.id}
              type="button"
              className={classNames([
                'person-node',
                personTone(person),
                muted && 'is-muted',
                related && 'is-related',
                primary && 'is-focused',
              ])}
              style={nodeStyle(pos)}
              animate={{ opacity: muted ? 0.24 : 1, scale: primary ? 1.08 : related ? 1.02 : 1 }}
              transition={transition}
              aria-label={`${primary ? 'Open' : 'Focus'} ${person.name} — ${cardCopy.roleLine}`}
              aria-pressed={primary}
              onClick={(event) => {
                event.stopPropagation()
                handleNodeClick('person', person.id)
              }}
            >
              <PixelAvatar person={person} size={56} className="person-avatar" />
              <span className="person-body">
                <h3>{person.lastInitial ? `${person.name} ${person.lastInitial}.` : person.name}</h3>
                <p className="person-role">{cardCopy.roleLine}</p>
              </span>
            </motion.button>
          )
        })}
      </div>

      <div className="project-layer" aria-label="Project layer">
        {PROJECTS.map((project) => {
          const pos = PROJECT_POS[project.id]
          if (!pos) return null
          const cardCopy = dashboardProjectCopy(project, dashboardPhase)
          const related = isRelated(focus, 'project', project.id)
          const primary = isPrimary(focus, 'project', project.id)
          const muted = hasFocus && !related
          return (
            <motion.button
              key={project.id}
              type="button"
              className={classNames([
                'project-card',
                riskToneClass(project.status),
                muted && 'is-muted',
                related && 'is-related',
                primary && 'is-focused',
              ])}
              style={nodeStyle(pos)}
              animate={{ opacity: muted ? 0.24 : 1, scale: primary ? 1.08 : related ? 1.02 : 1 }}
              transition={transition}
              aria-label={primary ? `Open ${project.title}` : `Focus ${project.title}`}
              aria-pressed={primary}
              onClick={(event) => {
                event.stopPropagation()
                handleNodeClick('project', project.id)
              }}
            >
              <span className="project-bar-row">
                <h3>{project.title}</h3>
                <span className="project-status">
                  <span className={`status-dot ${statusTone(project.status)}`} />
                  <span>{cardCopy.statusLabel}</span>
                </span>
              </span>
              <p className="project-summary">{cardCopy.summary}</p>
              <span className="project-progress" aria-label={`${project.progress}% complete`}>
                <span className="project-progress-label">Progress</span>
                <span className={`project-strip ${progressBand(project.progress)}`}>
                  <span
                    className="project-strip-fill"
                    style={{ width: `${project.progress}%` }}
                  />
                </span>
                <span className="project-progress-pct">{project.progress}%</span>
              </span>
              <div className="project-meta">
                <span>{ownerName(project)}</span>
                {project.dueDate ? <span>{project.dueDate}</span> : null}
              </div>
            </motion.button>
          )
        })}
      </div>

        <AnimatePresence>
          {riskProject?.risk ? (
            <motion.aside
              key={riskProject.id}
              className="risk-chart"
              style={{
                left: `${RISK_CHART_LEFT}px`,
                top: `${PROJECT_POS[riskProject.id]?.y ?? 0}px`,
              }}
              initial={{ opacity: 0, x: -16, y: '-50%' }}
              animate={{ opacity: 1, x: 0, y: '-50%' }}
              exit={{ opacity: 0, x: -16, y: '-50%' }}
              transition={transition}
              aria-label={`${riskProject.title} risk distribution`}
              onClick={stopPropagation}
            >
              <p className="eyebrow">Risk distribution</p>
              <div className="risk-bars">
                {RISK_DIMS.map((dim) => {
                  const value = riskProject.risk?.[dim.key] ?? 0
                  return (
                    <div key={dim.key} className="risk-bar">
                      <span className="risk-bar-value">{value}</span>
                      <span className="risk-bar-col">
                        <motion.span
                          className="risk-bar-fill"
                          style={{ background: dim.color }}
                          initial={{ height: 0 }}
                          animate={{ height: `${value}%` }}
                          transition={transition}
                        />
                      </span>
                      <span className="risk-bar-label">{dim.label}</span>
                    </div>
                  )
                })}
              </div>
            </motion.aside>
          ) : null}
        </AnimatePresence>
      </PanZoomCanvas>

      <div className="dashboard-control-layer" onClick={stopPropagation}>
        {/* feat-014：回主页的克制入口（dana 守线：地图是子视图，随时能回今天的桌面） */}
        <button type="button" className="map-back-chip" onClick={() => goScene('home')}>
          ← Back to today {/* ⚠ 待 Danny 审字 */}
        </button>
        <div className="dashboard-tags" aria-label="Focus tags">
          {DASHBOARD_TAGS.map((tag) => {
            const active = selectedTagIds.includes(tag.id)
            return (
              <button
                key={tag.id}
                type="button"
                className={classNames(['dashboard-tag', active && 'is-active'])}
                aria-pressed={active}
                onClick={() => handleTagClick(tag.id)}
              >
                {tag.label}
              </button>
            )
          })}
        </div>
        <label className="dashboard-search">
          <span>Find</span>
          <input
            type="search"
            value={searchQuery}
            placeholder="person or project"
            onChange={(event) => handleSearchChange(event.currentTarget.value)}
          />
        </label>
      </div>

      <div className="alert-pill-layer" aria-label="Team alerts" onClick={stopPropagation}>
        {alertPills.map((pill) => (
          <button
            key={pill.id}
            type="button"
            className="alert-pill"
            onClick={() => setFocus(focusEntity('project', pill.projectId))}
          >
            <span className="alert-label">{pill.label}</span>
            <span>
              <strong>{pill.title}</strong>
              <small>{pill.detail}</small>
            </span>
          </button>
        ))}
      </div>

    </section>
  )
}
