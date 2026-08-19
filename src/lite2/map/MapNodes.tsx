import { Link } from 'react-router-dom'
import { useDict } from '../../shared/i18n/useDict'
import { localizePersonRead } from '../../shared/handoffCopy'
import { projectStatusText } from '../../shared/projectStatus'
import { InitialAvatar } from '../InitialAvatar'
import { docFromSource } from '../teamData'
import { detailReturnState, personDetailHref, projectDetailHref } from '../routes'
import { blockersOf, progressOf, projectStatusTone, statusKeyOf } from '../projectView'
import { moodWordOf } from '../selfReportView'
import { MAP_CELL, type MapPersonNode, type MapProjectNode, type MapZone } from './mapLayout'
import type { ZoneRead } from './zoneRead'

// team-map-revival-0804 · B2 · 板上的三种东西：部门分区 / 人节点 / 项目条。
//
// B1 时它们是三段内联 JSX，都不可点。B2 给了它们 focus 三态，于是每一种都长出了
// 「calm 一个样、被点了另一个样」的分支——继续挤在 MapScreen 里会把那一屏读成一堆三元表达式。
//
// ## 🔴 「原位长大」的两条硬约束
// ① **HTML 不许按钮嵌按钮**。被点的节点里有「打开档案」这个链接，所以节点本身不能是
//    `<button>`。用的是 `TeamScreen.PersonCard` 立下的那套结构（#48 同一个形状）：
//    容器 `<div onClick>` 保住「点哪儿都算点它」的手感，键盘/读屏路径走里面那个姓名按钮。
// ② **原位** = 卡片从节点**自己的中心**长出来。三种节点都是 `translate(-50%,-50%)` 定位在
//    自己的 pos 上，所以变高变宽时是朝四周均匀撑开的，不会像"从左上角展开"那样把整块
//    版面读成跳了一下。
//
// ## 🔴 人身零数字（本文件是最容易破口的地方）
// 人的 mini 卡只有三样：名字 / 职位 / **定性自述读**（`localizePersonRead`，与人卡逐字同源）。
// **不显自述负载那个百分数**——它是全仓唯一被特许的人身数字，特许的前提是它待在人卡的
// `data-metric-source` 出处锚点里；把它搬到地图上就等于给每个人挂了一根血条，那正是
// story 那版 `.hud-meter` 被整族拒之门外的理由。项目的 progress% / 卡点条数不在此限（项目可硬）。

/** 节点在当前 focus 下的处境。calm = 没有任何 focus；dimmed = 有 focus 但不是它。 */
export type MapNodeState = 'calm' | 'subject' | 'linked' | 'dimmed'

// 🔴 mini 卡是**挂在节点下面**的绝对定位面板（CSS 里 `top:100%`），不是把节点自己撑大。
// 第一版是撑大：节点 `translate(-50%,-50%)` 定位在 pos 上，一撑大就朝上下同时长——头像与名字
// 当场往上跳一截，还把上面那张分区卡的部门名盖掉（真机截图里一眼看得见）。
// 挂在下面之后：① 头像**一动不动**（连线的锚点就是 pos，节点跳一下线看着就是错的）；
// ② 展开方向唯一，读起来是「点开它、底下展开细节」，不是「它膨胀了」；
// ③ 不需要任何「calm 态多高」的魔法数——名字折不折行都不影响。
// 卡宽在 CSS 里给（人 268px / 项目 100%），这里不再给节点算宽度。

function classNames(parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ')
}

function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''))
}

function stateClass(state: MapNodeState): string | false {
  return state !== 'calm' && `is-${state}`
}

/**
 * 部门分区卡。B2 给它加的是**组级读数**：标签下面一句本人自述的定性短语。
 *
 * 🔴 三件事一件都不能少（`zoneRead.ts` 文件头有完整理由）：
 *   · 零计数——句子里没有"几个人"，跨人计数在本仓读作分数并列（ADR-0023 明禁）；
 *   · 说的是**本人的话**不是我们的判断——「有人自述吃紧」，不是「这个部门吃紧」；
 *   · 必须挂 `data-metric-source` 出处锚点——AFK 门 K6 相位的口径是「锚点外出现情绪词=红」，
 *     而那条口径本身是对的：一个无从追溯的情绪词，就是一次泄漏。
 */
export function MapZoneCard({
  zone,
  label,
  read,
  state,
  alertCount = 0,
  onSelect,
}: {
  zone: MapZone
  label: string
  read: ZoneRead | null
  /** B3：部门 chip 点中的那一块是 subject，其余在任何 focus 下都退后一步。 */
  state: MapNodeState
  /**
   * B4：这个部门名下有几件「需要你出手」的项目（blocked / at-risk）。
   * 🔴 这是**项目计数不是人数**——项目可硬、人不可（ADR-0023）。口径与 HUD 警报药丸、
   * 项目屏那一组**同一个函数**（`isNeedsYouStatus`），三处不许各写一遍。
   * 0 = 角标整个不出现（不印「0 件」，那是一句没人要读的话，和药丸同款处理）。
   */
  alertCount?: number
  /** B4：收拢态下点这张卡 = 原位展开它。铺开态传 undefined（卡是底板，不可点）。 */
  onSelect?: () => void
}) {
  const { t } = useDict()
  const l = t.lite2
  const inner = (
    <>
      {/* 🔴 标签上只有部门名，**没有人数徽章**——那是一个人身面上的计数。
          票面 #107 原话是「人数 + 组级读数 + 警报角标」，人数那一项按红线砍了：
          B3 的判据 F1 逐字写着「没有部门人数，那是一张人数排行榜」。规模差异由
          **展开之后的行数**表达，收拢卡连块头都不表达它（所有卡等高）。 */}
      <span className="lite-map-zone-name">{label}</span>
      {read ? (
        <span
          className="lite-map-zone-read"
          data-metric-source={read.source}
          data-metric-caliber={read.caliber}
          title={fill(l.selfReportProvenance, { source: docFromSource(read.source) })}
        >
          {fill(l.mapZoneRead, { mood: moodWordOf(read.mood, read.moodRaw, l) })}
        </span>
      ) : null}
      {/* 🔴 角标**只长在收拢卡上**。铺开的卡里，布局公式只给卡头留了 ZONE_LABEL_H=46px
          （名字 + 读数两行），第三行会直接压在第一排人像上——门的几何尺 E2 当场逮到
          （「按显示宽度：没有任何带数字的文字压在人节点的框上」）。要让它在铺开态也出现，
          得先把 ZONE_LABEL_H 加高，那会给全部既有像素基线换前提，不值。 */}
      {zone.isCollapsed && alertCount > 0 ? (
        <span
          className="lite-map-zone-alert"
          aria-label={fill(l.mapAlertAria, { group: l.projectsGroupNeedsYou, count: alertCount })}
        >
          <span className="lite-map-zone-alert-label" aria-hidden="true">
            {l.projectsGroupNeedsYou}
          </span>
          <span className="lite-map-zone-alert-count" aria-hidden="true">
            {alertCount}
          </span>
        </span>
      ) : null}
    </>
  )

  const className = classNames([
    'lite-map-zone',
    zone.isUngrouped && 'is-ungrouped',
    zone.isCollapsed && 'is-collapsed',
    stateClass(state),
  ])
  const style = {
    left: `${zone.rect.x}px`,
    top: `${zone.rect.y}px`,
    width: `${zone.rect.width}px`,
    height: `${zone.rect.height}px`,
  }

  // 🔴 收拢时它才是**按钮**，铺开时仍是底板。不能一律用 `<button>`：铺开的卡里站着人节点，
  // 而人节点自己是可点的（且 mini 卡里有「打开档案」链接）——按钮套按钮是 B2 就立过的那条
  // HTML 硬约束（MapPersonNodeView 的头注释①）。收拢的卡里什么都没有，可以放心当按钮，
  // 于是键盘 Tab 和读屏天然拿到「展开这个部门」这个动作，不用另造 role/tabIndex。
  if (zone.isCollapsed && onSelect) {
    return (
      <button
        type="button"
        className={className}
        data-zone-key={zone.key}
        style={style}
        aria-label={fill(l.mapZoneExpandAria, { zone: label })}
        onClick={onSelect}
      >
        {inner}
      </button>
    )
  }

  return (
    <div className={className} data-zone-key={zone.key} style={style}>
      {inner}
    </div>
  )
}

/**
 * 人节点。calm = 圆点 + 名字；被点 = 原位长成 mini 卡（名字 / 职位 / 定性自述读 / 打开档案）。
 *
 * 「打开档案」是 `<Link>` 而不是 `openDetail()`：它该能中键开新标签、能右键复制链接，
 * 和顶栏 tab 一致。`detailReturnState()` 把此刻的完整地址（含 `?focus=`）拍进 history state，
 * 于是合上档案回来时小徐还亮着（见 routes.ts 的 `DetailNavState.returnTo`）。
 */
export function MapPersonNodeView({
  node,
  state,
  onSelect,
}: {
  node: MapPersonNode
  state: MapNodeState
  onSelect: () => void
}) {
  const { t } = useDict()
  const l = t.lite2
  const { person, pos } = node
  const isSubject = state === 'subject'
  // 与人卡逐字同源的定性读数（feat-068：派生层只给语料原文，成句在文案层）。
  const read = localizePersonRead(person, l)
  return (
    <div
      className={classNames(['lite-map-person', stateClass(state)])}
      data-person-id={person.id}
      onClick={onSelect}
      style={{
        left: `${pos.x}px`,
        top: `${pos.y}px`,
        width: `${MAP_CELL.person.width}px`,
      }}
    >
      {/* story 用的是 PixelAvatar（sprite 表，虚构角色的资产）——这里用 lite2 自己的
          InitialAvatar：真人没有 sprite，不凭空派一张脸给客户的员工。 */}
      <InitialAvatar name={person.name} size={44} className="lite-map-person-avatar" />
      <button
        type="button"
        className="lite-map-person-name lite-card-open"
        // 键盘/读屏路径。整句模板 + 占位符——语序交给各语言自己定（feat-068 的口径）。
        aria-label={fill(l.mapFocusPersonAria, { name: person.name })}
        aria-expanded={isSubject}
        onClick={(e) => {
          e.stopPropagation()
          onSelect()
        }}
      >
        {person.name}
      </button>
      {isSubject ? (
        <span className="lite-map-node-card">
          {/* 🔴 缺了不编：文档没读到职位就整行不出现，不摆一句「文档未提及」占位——
              人的卡片上每多一行「未提及」，读起来就多一分"这个人资料不全"的暗示。
              项目那边不同（见下），因为项目的缺口本来就是要经理去补的东西。 */}
          {person.role.trim() ? <span className="lite-map-node-role">{person.role}</span> : null}
          <span className="lite-map-node-read">{read}</span>
          <Link
            className="lite-btn lite-btn--ghost lite-map-node-cta"
            to={personDetailHref(person.id)}
            state={detailReturnState()}
            onClick={(e) => e.stopPropagation()}
          >
            {l.mapOpenPersonCta} ↗
          </Link>
        </span>
      ) : null}
    </div>
  )
}

/**
 * 项目条。calm = 统一横条（标题 + 状态 + owner + 进度）；被点 = 原位长出摘要/到期/卡点。
 *
 * 长短不代表任何量（ADR-0012 修订 5 原话）——进度由条内那根细条表达，不由卡宽表达。
 */
export function MapProjectNodeView({
  node,
  state,
  onSelect,
}: {
  node: MapProjectNode
  state: MapNodeState
  onSelect: () => void
}) {
  const { t } = useDict()
  const l = t.lite2
  const { project, pos } = node
  const isSubject = state === 'subject'
  const statusKey = statusKeyOf(project.statusRaw)
  const progress = progressOf(project.progress)
  const blockers = blockersOf(project.blockers)
  const summary = project.summary?.trim()
  const dueDate = project.dueDate?.trim()
  return (
    <div
      className={classNames([
        'lite-map-project',
        statusKey === 'unknown' && 'is-status-unknown',
        stateClass(state),
      ])}
      data-project-id={project.id}
      onClick={onSelect}
      style={{
        left: `${pos.x}px`,
        top: `${pos.y}px`,
        width: `${MAP_CELL.project.width}px`,
        minHeight: `${MAP_CELL.project.height}px`,
      }}
    >
      <span className="lite-map-project-row">
        <button
          type="button"
          className="lite-map-project-title lite-card-open"
          aria-label={fill(l.mapFocusProjectAria, { title: project.title })}
          aria-expanded={isSubject}
          onClick={(e) => {
            e.stopPropagation()
            onSelect()
          }}
        >
          {project.title}
        </button>
        <span className="lite-map-project-status">
          <span
            className={classNames(['status-dot', projectStatusTone(statusKey)])}
            aria-hidden="true"
          />
          <span>{projectStatusText(project.statusRaw, l)}</span>
        </span>
      </span>
      <span className="lite-map-project-row lite-map-project-row--facts">
        {/* 🔴 owner **必须带标签**，与项目屏的 FactRow 同形。只印值的话，没读到负责人的项目
            在条上只剩孤零零一句「文档未提及」——文档未提及**什么**？ */}
        <span className="lite-map-project-owner">
          <span className="lite-map-project-owner-label">{l.projectsOwnerLabel}</span>
          <span>{project.ownerName || l.projectsUnknownValue}</span>
        </span>
        {/* 🔴 progress 缺失 → 整组不出现。画一条 0 宽的条 = 替客户的文档说「这事没进展」。 */}
        {progress !== null ? (
          <span className="lite-map-project-progress">
            <span className="lite-map-progress-track" aria-hidden="true">
              <span className="lite-map-progress-fill" style={{ width: `${progress}%` }} />
            </span>
            <span className="lite-map-progress-value">{progress}%</span>
          </span>
        ) : null}
      </span>
      {isSubject ? (
        <span className="lite-map-node-card">
          {summary ? <span className="lite-map-node-summary">{summary}</span> : null}
          {/* 到期**恒显**（有值显值、没值显「文档未提及」）：项目屏的 FactRow 就是这么做的，
              而且这里的缺口正是经理要去补的东西——收起来等于把待办藏了。 */}
          <span className={classNames(['lite-map-node-fact', !dueDate && 'is-unknown'])}>
            <span className="lite-map-node-fact-label">{l.projectsDueLabel}</span>
            <span>{dueDate || l.projectsUnknownValue}</span>
          </span>
          {/* 🔴 只在 >0 时出现，永不印「0 处卡点」：后端只在非空时才发这个键，
              「缺席」与「空列表」在契约上分不开（blockersOf 的注释）。 */}
          {blockers.length > 0 ? (
            <span className="lite-map-node-blockers">
              <span className="lite-map-node-blocker-count">
                {blockers.length === 1
                  ? l.projectsBlockersOne
                  : fill(l.projectsBlockersMany, { count: blockers.length })}
              </span>
              <span className="lite-map-node-blocker-first">{blockers[0]}</span>
            </span>
          ) : null}
          <Link
            className="lite-btn lite-btn--ghost lite-map-node-cta"
            to={projectDetailHref(project.id)}
            state={detailReturnState()}
            onClick={(e) => e.stopPropagation()}
          >
            {l.mapOpenProjectCta} ↗
          </Link>
        </span>
      ) : null}
    </div>
  )
}
