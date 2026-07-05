import { useMemo, useState } from 'react'
import { motion, useReducedMotion, type Transition } from 'framer-motion'
import { PEOPLE, PROJECTS } from '../../data/fixtures'
import { dashboardProjectCopy, type DetailPhase } from '../../data/fixtures.p3'
import {
  HANDLED_DRAWER_LABEL,
  HOME_CLOSING,
  HOME_CLOSING_NEUTRAL,
  HOME_COPY,
  SET_ASIDE_LABEL,
  spineCountLine,
  type HomeHandoff,
} from '../../data/fixtures.home'
import { focusEntity } from '../../lib/focus'
import { PixelAvatar } from '../PixelAvatar'
import { TeamComposer } from '../TeamComposer'
import { UploadPanel } from '../UploadPanel'
import { useCanvas } from '../../store/canvasStore'
import { useHome } from '../../store/homeStore'
import { useTeamData } from '../../live/useTeamData'
import { useDict } from '../../i18n/useDict'
import type { TeamPerson } from '../../live/teamDataSource'

// live 人卡的文字首字母 avatar（live 人无 sprite——不凭空派 avatar 资产）。
function InitialAvatar({ name, size = 44, className }: { name: string; size?: number; className?: string }) {
  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')
  return (
    <span
      className={['initial-avatar', className].filter(Boolean).join(' ')}
      style={{ width: `${size}px`, height: `${size}px`, fontSize: `${Math.round(size * 0.36)}px` }}
      aria-hidden="true"
    >
      {initials}
    </span>
  )
}

// feat-014（ADR-0017 / GH #9）：卡片式今日主页 "The Morning Desk"（方向 A+）。
// 左脊柱 = 今日 Handoff checklist（判断），右双轨 = 人与项目卡带（证据）。
// hover 左卡 → 右栏关联卡提亮 + 浮依据签、其余降透明（claire 改进 1：证据层联动，
// 不是陈列墙）。人卡只有定性人话，绝无数字（ADR-0015）。

// 进度条分档与地图页同口径（<40 低 · 40–69 中 · ≥70 高），复用 strip-* 配色类。
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

// story 人卡用 PixelAvatar（fixture sprite）；live 人卡用文字首字母（无 sprite）。
// 按 TeamPerson.id 回查 fixture Person——命中即 story sprite，否则 live initials。
function personAvatar(tp: TeamPerson, size: number) {
  const fixture = PEOPLE.find((p) => p.id === tp.id)
  return fixture ? (
    <PixelAvatar person={fixture} size={size} className="home-person-avatar" />
  ) : (
    <InitialAvatar name={tp.name} size={size} className="home-person-avatar" />
  )
}

// story 项目状态标签保留原 dashboardProjectCopy（phase-aware）；live 项目（非 fixture）用
// 原始 status 兜底——项目可硬（数字/状态 OK），只是无脚本化 phase 文案。
function projectStatusLabel(id: string, status: string, phase: DetailPhase): string {
  const fixture = PROJECTS.find((p) => p.id === id)
  if (fixture) return dashboardProjectCopy(fixture, phase).statusLabel
  return status
}

// 墨迹对勾（签名元素）：手绘感 stroke 描边动画，勾下去才画完。
function InkCheck({ drawn }: { drawn: boolean }) {
  const prefersReducedMotion = useReducedMotion()
  return (
    <svg viewBox="0 0 24 24" className="ink-check" aria-hidden="true">
      <motion.path
        d="M4.5 12.8 L10 18 L19.5 6.8"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={false}
        animate={{ pathLength: drawn ? 1 : 0, opacity: drawn ? 1 : 0 }}
        transition={prefersReducedMotion ? { duration: 0 } : { duration: 0.4, ease: 'easeOut' }}
      />
    </svg>
  )
}

export function HomeScene() {
  const briefing = useCanvas((s) => s.briefing)
  const goScene = useCanvas((s) => s.goScene)
  const setFocus = useCanvas((s) => s.setFocus)
  const openDetail = useCanvas((s) => s.openDetail)
  const askQuestion = useCanvas((s) => s.askQuestion)
  const marks = useHome((s) => s.marks)
  const markDone = useHome((s) => s.markDone)
  const discard = useHome((s) => s.discard)
  const restore = useHome((s) => s.restore)
  const prefersReducedMotion = useReducedMotion()
  // feat-017：数据经 TeamDataSource seam（story = fixtures 原样；live = ingestion 产出）。
  const { source, live, liveEmpty } = useTeamData()
  const { t } = useDict()

  // hover / focus 的 handoff（右栏联动）；inking = 正在画对勾；leaving = 正在淡出。
  // 退场是手动两段式（inking 550ms → leaving 240ms → 移除 + layout 补位）——不走
  // AnimatePresence exit：presence 卸载在此列表上不可靠（动画跑完但元素滞留）。
  // 用 Set 按卡并行：一张卡动画中不锁其他卡（现场连勾两张不能有"按钮死了"的手感）。
  const [linkedId, setLinkedId] = useState<string | null>(null)
  const [inkingIds, setInkingIds] = useState<ReadonlySet<string>>(new Set())
  const [leavingIds, setLeavingIds] = useState<ReadonlySet<string>>(new Set())
  const [drawerOpen, setDrawerOpen] = useState(false)

  // story: canvasStore briefing 决定 phase（B10 后 grown）。live: 无 rail phase 概念——固定 believed。
  const activeBriefing = live ? source.briefing(live ? 'believed' : 'grown') : briefing
  const phase: DetailPhase = !live && briefing.version === 2 ? 'grown' : 'believed'
  const handoffs = source.handoffs(phase)

  const pending = handoffs.filter((h) => !marks[h.id])
  const handled = handoffs.filter((h) => marks[h.id] === 'done')
  const setAside = handoffs.filter((h) => marks[h.id] === 'discarded')
  const allSettled = pending.length === 0

  const linked = useMemo(
    () => (linkedId ? handoffs.find((h) => h.id === linkedId) ?? null : null),
    [linkedId, handoffs],
  )

  const transition: Transition = prefersReducedMotion
    ? { duration: 0 }
    : { duration: 0.28, ease: [0.16, 1, 0.3, 1] }

  const lanePeople = source.people(phase)
  const laneProjects = source.projects(phase)

  function isLinkedPerson(id: string) {
    return Boolean(linked?.personIds.includes(id))
  }

  function isLinkedProject(id: string) {
    return Boolean(linked?.projectIds.includes(id))
  }

  function addTo(set: ReadonlySet<string>, id: string): ReadonlySet<string> {
    const next = new Set(set)
    next.add(id)
    return next
  }

  function removeFrom(set: ReadonlySet<string>, id: string): ReadonlySet<string> {
    const next = new Set(set)
    next.delete(id)
    return next
  }

  // 勾 done：先画墨迹（0.55s）、再淡出（0.24s）、后收进抽屉（安静的完成感——无彩带）。
  function handleDone(id: string) {
    if (inkingIds.has(id) || leavingIds.has(id)) return
    if (prefersReducedMotion) {
      markDone(id)
      return
    }
    setInkingIds((s) => addTo(s, id))
    window.setTimeout(() => {
      setInkingIds((s) => removeFrom(s, id))
      setLeavingIds((s) => addTo(s, id))
      window.setTimeout(() => {
        markDone(id)
        setLeavingIds((s) => removeFrom(s, id))
        setLinkedId((current) => (current === id ? null : current))
      }, 240)
    }, 550)
  }

  function handleDiscard(id: string) {
    if (inkingIds.has(id) || leavingIds.has(id)) return
    if (prefersReducedMotion) {
      discard(id)
      return
    }
    setLeavingIds((s) => addTo(s, id))
    window.setTimeout(() => {
      discard(id)
      setLeavingIds((s) => removeFrom(s, id))
      setLinkedId((current) => (current === id ? null : current))
    }, 240)
  }

  // "在全景上看"：飞进 Team map 并点亮关联簇（与 rail B2 同款动作序）。
  function seeOnMap(handoff: HomeHandoff) {
    if (!handoff.mapFocus) return
    goScene('dashboard')
    setFocus(focusEntity(handoff.mapFocus.kind, handoff.mapFocus.id))
  }

  function openMap() {
    setFocus(null) // 全景入口落 calm——不带上一次钻入残留的 focus
    goScene('dashboard')
  }

  const countLine = spineCountLine(pending.length, handoffs.length)
  // believed 收尾点名 "Lin Qing is on your list"——她那张卡若被搁置则改用中性版（claire 2b）。
  const heroSetAside = marks['hh_linqing'] === 'discarded'
  const closing = phase === 'believed' && heroSetAside ? HOME_CLOSING_NEUTRAL : HOME_CLOSING[phase]

  return (
    <section className="scene scene-home is-active" aria-label="Your team — today">
      {/* 滚动在内层：composer 与滚动层平级、锚定视口底——若场景自身滚动，
          绝对定位的 composer 会留在首屏布局位置、随内容漂走（Danny 真机抓到）。 */}
      <div className="home-scroll">
      <div className="home-frame">
        {/* ── 左脊柱：问候 + 今日 checklist + 已照料抽屉 ─────────────────── */}
        <div className="home-spine">
          <header className="home-greeting">
            <p className="eyebrow">{live ? t.team.liveEyebrow : HOME_COPY.greetingEyebrow}</p>
            <h1>{activeBriefing.headline}</h1>
            <p className="home-greeting-sub">{activeBriefing.subhead}</p>
          </header>

          <div className="home-spine-head">
            <h2>{HOME_COPY.spineTitle}</h2>
            {countLine ? <p className="home-count" aria-live="polite">{countLine}</p> : null}
          </div>

          <ol className="home-handoff-list">
            {pending.map((handoff, index) => {
              const inking = inkingIds.has(handoff.id)
              const leaving = leavingIds.has(handoff.id)
              return (
                  <motion.li
                    key={handoff.id}
                    layout
                    className={classNames([
                      'home-handoff',
                      `home-tone-${handoff.tone}`,
                      inking && 'is-inking',
                      linkedId === handoff.id && 'is-linked',
                    ])}
                    initial={{ opacity: 0, y: 18, scale: 1 }}
                    animate={
                      leaving ? { opacity: 0, y: 0, scale: 0.97 } : { opacity: 1, y: 0, scale: 1 }
                    }
                    transition={
                      prefersReducedMotion
                        ? { duration: 0 }
                        : leaving
                          ? { duration: 0.22 }
                          : { ...transition, delay: index * 0.08 }
                    }
                    onMouseEnter={() => setLinkedId(handoff.id)}
                    onMouseLeave={() => setLinkedId(null)}
                    onFocus={() => setLinkedId(handoff.id)}
                    onBlur={(event) => {
                      if (!event.currentTarget.contains(event.relatedTarget as Node)) {
                        setLinkedId(null)
                      }
                    }}
                  >
                    <button
                      type="button"
                      className="home-check"
                      aria-label={`Done — ${handoff.action}`}
                      onClick={() => handleDone(handoff.id)}
                    >
                      <InkCheck drawn={inking} />
                    </button>
                    <div className="home-handoff-body">
                      <span className="home-handoff-tone">{handoff.toneLabel}</span>
                      <h3>{handoff.action}</h3>
                      <p>{handoff.evidence}</p>
                      <div className="home-handoff-links">
                        {handoff.flyToNexus ? (
                          <button
                            type="button"
                            className="handoff-fly"
                            onClick={() => askQuestion(handoff.flyToNexus as string)}
                          >
                            {HOME_COPY.flyLabel} ↗
                          </button>
                        ) : null}
                        {handoff.mapFocus ? (
                          <button
                            type="button"
                            className="home-map-card-link"
                            onClick={() => seeOnMap(handoff)}
                          >
                            {HOME_COPY.mapCardLink} →
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="home-discard"
                          onClick={() => handleDiscard(handoff.id)}
                        >
                          {HOME_COPY.discardLabel}
                        </button>
                      </div>
                    </div>
                  </motion.li>
                )
              })}
          </ol>

          {/* 收尾屏入场走 CSS 动画（home-rise-in）；撤销恢复时直接卸载，无退场需求 */}
          {allSettled ? (
            <div className="home-closing">
              <h3>{closing.title}</h3>
              <p>{closing.line}</p>
            </div>
          ) : null}

          {handled.length + setAside.length > 0 ? (
            <section className="home-drawer">
              <button
                type="button"
                className="home-drawer-toggle"
                aria-expanded={drawerOpen}
                onClick={() => setDrawerOpen((open) => !open)}
              >
                <span className="home-drawer-check" aria-hidden="true">
                  <InkCheck drawn />
                </span>
                {/* 搁置 ≠ 已处理（claire 2c-2）：分开计数，不让一个词盖两义 */}
                {HANDLED_DRAWER_LABEL} · {handled.length}
                {setAside.length > 0 ? ` · ${setAside.length} ${SET_ASIDE_LABEL}` : ''}
                <span aria-hidden="true">{drawerOpen ? '▴' : '▾'}</span>
              </button>
              {drawerOpen ? (
                <ul className="home-drawer-list">
                  {handled.map((handoff) => (
                    <li key={handoff.id}>
                      <span className="home-drawer-item">{handoff.action}</span>
                      <button type="button" onClick={() => restore(handoff.id)}>
                        {HOME_COPY.undoLabel}
                      </button>
                    </li>
                  ))}
                  {setAside.map((handoff) => (
                    <li key={handoff.id} className="is-set-aside">
                      <span className="home-drawer-item">{handoff.action}</span>
                      <button type="button" onClick={() => restore(handoff.id)}>
                        {HOME_COPY.undoLabel}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          ) : null}
        </div>

        {/* ── 右双轨：证据层（联动提亮/降透明），非陈列墙 ─────────────────── */}
        {/* live 未上传：右栏换成上传 UI（Your team 从上传长出来）。 */}
        {liveEmpty ? (
          <div className="home-lanes home-lanes-live-empty">
            <UploadPanel />
          </div>
        ) : (
        <div className={classNames(['home-lanes', linked && 'has-link'])}>
          {/* live 已上传：在卡带上方保留上传入口（可继续加文件）。 */}
          {live ? <UploadPanel /> : null}
          <div className="home-lanes-head">
            <p className="eyebrow">{HOME_COPY.peopleLane}</p>
            {!live ? (
              <button type="button" className="home-map-link" onClick={openMap}>
                {HOME_COPY.mapLink} →
              </button>
            ) : null}
          </div>
          {/* 联动 dim/lit 全走 CSS（.has-link + .is-lit 类）：确定性强，不依赖 JS 动画帧 */}
          <div className="home-lane home-lane-people" aria-label="People this week">
            {lanePeople.map((person) => {
              const lit = isLinkedPerson(person.id)
              return (
                <button
                  key={person.id}
                  type="button"
                  className={classNames([
                    'home-person-card',
                    person.read && `home-tone-${person.tone}`,
                    lit && 'is-lit',
                  ])}
                  onClick={() => openDetail('employee', person.id)}
                  aria-label={`Open ${person.name}${person.read ? ` — ${person.read}` : ''}`}
                >
                  {personAvatar(person, 44)}
                  <span className="home-person-body">
                    <h3>{person.name}</h3>
                    <p className="home-person-role">{person.role}</p>
                    {person.read ? <p className="home-person-read">{person.read}</p> : null}
                  </span>
                  {/* 人卡不浮依据签：点亮 + 定性读数已足够，浮签会压字（Danny 真机抓到） */}
                  {/* 🔴 红线：人卡永不渲染任何数字 —— 无 moodPct/capacityPct/% */}
                </button>
              )
            })}
          </div>

          <p className="eyebrow home-lane-label">{HOME_COPY.projectLane}</p>
          <div className="home-lane home-lane-projects" aria-label="Projects in motion">
            {laneProjects.map((project) => {
              const lit = isLinkedProject(project.id)
              return (
                <button
                  key={project.id}
                  type="button"
                  className={classNames([
                    'home-project-card',
                    statusTone(project.status) && `edge-${project.status}`,
                    lit && 'is-lit',
                  ])}
                  onClick={() => openDetail('project', project.id)}
                  aria-label={`Open ${project.title}`}
                >
                  <span className="home-project-row">
                    <h3>{project.title}</h3>
                    <span className="home-project-status">
                      <span className={`status-dot ${statusTone(project.status)}`} />
                      {projectStatusLabel(project.id, project.status, phase)}
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
                  {/* 依据签只在第一张关联项目卡、以文档流内 chip 出现——绝对悬浮会压字，
                      同句在人卡+多张项目卡重复三遍是噪音（Danny 真机抓到）。 */}
                  {lit && linked?.evidenceTag && linked.projectIds[0] === project.id ? (
                    <span className="home-evidence-tag">{linked.evidenceTag}</span>
                  ) : null}
                </button>
              )
            })}
          </div>
        </div>
        )}
      </div>
      </div>

      <TeamComposer />
    </section>
  )
}
